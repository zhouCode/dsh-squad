import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  attachmentRefSchema,
  assertEnvelopeSemantics,
  createDelegationInputSchema,
  delegationRequestSchema,
  envelopeSchema,
  humanInputSchema,
} from "./contracts.ts";
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
      protocolVersion: 2,
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
