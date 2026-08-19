import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  attachmentRefSchema,
  assertEnvelopeSemantics,
  createDelegationInputSchema,
  createTeamPlanInputSchema,
  delegationRequestSchema,
  envelopeSchema,
  humanInputSchema,
  updateTeamPlanInputSchema,
} from "./contracts.ts";
import { summarizeAttention } from "./state.ts";
import { canonicalJson } from "./canonical.ts";
import { assertTransition, canTransition, isTerminalStatus } from "./state.ts";

describe("Squad contracts", () => {
  it("canonicalizes object keys without changing array order", () => {
    expect(canonicalJson({ z: [2, 1], a: { y: true, x: null } })).toBe(
      '{"a":{"x":null,"y":true},"z":[2,1]}',
    );
    expect(() => canonicalJson({ bad: undefined })).toThrow(/undefined/u);
  });

  it("keeps delegation input capability-free and strict", () => {
    expect(
      createDelegationInputSchema.safeParse({
        to: "Bob",
        objective: "Summarize the supplied notes",
        skillName: "remote-skill",
      }).success,
    ).toBe(false);
    expect(
      createDelegationInputSchema.safeParse({
        to: "Bob",
        objective: "Summarize the supplied notes",
        shellCommand: "rm -rf /",
      }).success,
    ).toBe(false);
  });

  it("keeps team plans bounded, strict, and capability-free", () => {
    expect(
      createTeamPlanInputSchema.safeParse({
        title: "Launch follow-up",
        sourceSummary: "The team agreed on two independent workstreams.",
        items: [
          {
            to: "Bob",
            objective: "Draft the release notes",
            acceptanceCriteria: ["Return a reviewable Markdown draft"],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      createTeamPlanInputSchema.safeParse({
        title: "Unsafe plan",
        items: [
          {
            to: "Bob",
            objective: "Run a private tool",
            skillName: "remote-skill",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      createTeamPlanInputSchema.safeParse({
        title: "Too many items",
        items: Array.from({ length: 33 }, (_, index) => ({
          to: "Bob",
          objective: `Task ${index}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      updateTeamPlanInputSchema.safeParse({
        revision: 1,
        title: "Duplicate IDs",
        items: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            to: "Bob",
            objective: "First",
          },
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            to: "Carol",
            objective: "Second",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts only bounded HTTPS attachment references", () => {
    expect(
      attachmentRefSchema.safeParse({
        url: "https://example.test/input.txt",
        sha256: "a".repeat(64),
        size: 12,
        name: "input.txt",
      }).success,
    ).toBe(true);
    expect(
      attachmentRefSchema.safeParse({
        url: "http://example.test/input.txt",
        sha256: "a".repeat(64),
        size: 12,
        name: "input.txt",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown envelope versions and unknown fields", () => {
    const base = {
      protocolVersion: 3,
      envelopeId: randomUUID(),
      kind: "DELEGATION_REQUEST",
      senderNodeId: `node_${"a".repeat(43)}`,
      recipientNodeId: `node_${"b".repeat(43)}`,
      correlationId: randomUUID(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      payload: delegationRequestSchema.parse({
        delegationId: randomUUID(),
        objective: "test",
        acceptanceCriteria: [],
        attachmentRefs: [],
      }),
      signature: "a".repeat(86),
    };
    expect(envelopeSchema.safeParse(base).success).toBe(false);
    expect(
      envelopeSchema.safeParse({
        ...base,
        protocolVersion: 1,
        remoteTool: "bash",
      }).success,
    ).toBe(false);
  });

  it("requires complete organization routing on protocol v2 envelopes", () => {
    const delegationId = randomUUID();
    const now = new Date();
    const base = envelopeSchema.parse({
      protocolVersion: 2,
      envelopeId: randomUUID(),
      kind: "DELEGATION_REQUEST",
      senderNodeId: `node_${"a".repeat(43)}`,
      recipientNodeId: `node_${"b".repeat(43)}`,
      correlationId: delegationId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      payload: {
        delegationId,
        objective: "test",
        acceptanceCriteria: [],
        attachmentRefs: [],
        delegationDepth: 0,
      },
      signature: "a".repeat(86),
    });
    expect(() => assertEnvelopeSemantics(base)).toThrow(
      "organization envelopes require",
    );
    expect(() =>
      assertEnvelopeSemantics({
        ...base,
        organizationId: randomUUID(),
        senderMembershipId: randomUUID(),
        recipientMembershipId: randomUUID(),
      }),
    ).not.toThrow();
  });

  it("binds correlation IDs and validates HumanTodo submissions", () => {
    const delegationId = randomUUID();
    const now = new Date();
    const envelope = envelopeSchema.parse({
      protocolVersion: 1,
      envelopeId: randomUUID(),
      kind: "DELEGATION_REQUEST",
      senderNodeId: `node_${"a".repeat(43)}`,
      recipientNodeId: `node_${"b".repeat(43)}`,
      correlationId: delegationId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      payload: {
        delegationId,
        objective: "test",
        acceptanceCriteria: [],
        attachmentRefs: [],
        delegationDepth: 0,
      },
      signature: "a".repeat(86),
    });
    expect(() => assertEnvelopeSemantics(envelope)).not.toThrow();
    expect(() =>
      assertEnvelopeSemantics({ ...envelope, correlationId: randomUUID() }),
    ).toThrow(/correlationId/u);
    expect(
      humanInputSchema.safeParse({
        todoIds: [randomUUID()],
        response: "done",
        attachmentRefs: [],
      }).success,
    ).toBe(true);
    expect(
      humanInputSchema.safeParse({
        todoIds: [randomUUID()],
        attachmentRefs: [],
      }).success,
    ).toBe(false);
  });
});

describe("delegation state machine", () => {
  it("allows the documented path and freezes terminal states", () => {
    expect(canTransition("QUEUED", "RECEIVED")).toBe(true);
    expect(canTransition("TRIAGING", "WAITING_HUMAN")).toBe(true);
    expect(canTransition("WAITING_HUMAN", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "COMPLETED")).toBe(true);
    expect(isTerminalStatus("COMPLETED")).toBe(true);
    expect(() => assertTransition("COMPLETED", "RUNNING")).toThrow(
      /invalid delegation transition/u,
    );
  });
});

describe("Squad attention summary", () => {
  it("counts only actionable work and manager-visible join requests", () => {
    expect(
      summarizeAttention({
        revision: 9,
        setupRequired: false,
        delegations: [
          {
            direction: "INCOMING",
            status: "WAITING_HUMAN",
            deliveryStatus: "RECEIVED_LOCAL",
          },
          {
            direction: "OUTGOING",
            status: "FAILED",
            deliveryStatus: "RECEIVED_BY_NODE",
          },
          {
            direction: "OUTGOING",
            status: "QUEUED",
            deliveryStatus: "DELIVERY_EXPIRED",
          },
          {
            direction: "INCOMING",
            status: "COMPLETED",
            deliveryStatus: "RECEIVED_LOCAL",
          },
        ],
        plans: [{ status: "DRAFT" }, { status: "DISPATCHED" }],
        organizations: [
          {
            role: "OWNER",
            membershipStatus: "ACTIVE",
            pendingJoinRequests: [{}, {}],
          },
          {
            role: "MEMBER",
            membershipStatus: "ACTIVE",
            pendingJoinRequests: [{}],
          },
        ],
        updateAvailable: true,
      }),
    ).toEqual({
      revision: 9,
      setupRequired: false,
      waitingHuman: 1,
      failedOutgoing: 2,
      pendingJoinRequests: 2,
      draftPlans: 1,
      updateAvailable: true,
      total: 7,
    });
  });
});
