import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { envelopeDigest } from "../shared/canonical.ts";
import {
  unsignedOrganizationDocumentSchema,
  unsignedOrganizationMembershipCertificateSchema,
} from "../shared/organizations.ts";
import { NodeIdentity } from "./identity.ts";
import { SquadDatabase } from "./database.ts";
import { OrganizationAuthority } from "./organization.ts";

describe("SquadDatabase", () => {
  it("migrates repeatedly and deduplicates request envelopes", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-db-"));
    const dbPath = join(root, "node.sqlite");
    const identity = NodeIdentity.load(join(root, "identity.json"));
    const sender = NodeIdentity.load(join(root, "sender.json"));
    const db = new SquadDatabase(dbPath);
    db.bindIdentity(identity.nodeId, identity.publicKey, identity.createdAt);
    db.upsertPeer({
      nodeId: sender.nodeId,
      displayName: "Sender",
      publicKey: sender.publicKey,
      enabled: true,
      policy: {
        canMessage: false,
        canDelegate: true,
        autoExecute: "NEVER",
        maxConcurrent: 1,
        maxDelegationDepth: 1,
        maxRuntimeMinutes: 30,
      },
    });
    const now = new Date();
    const delegationId = randomUUID();
    const unsigned = {
      protocolVersion: 1 as const,
      envelopeId: randomUUID(),
      kind: "DELEGATION_REQUEST" as const,
      senderNodeId: sender.nodeId,
      recipientNodeId: identity.nodeId,
      correlationId: delegationId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      payload: {
        delegationId,
        objective: "Count the entries",
        acceptanceCriteria: ["Return an exact count"],
        attachmentRefs: [],
        delegationDepth: 0,
      },
    };
    const envelope = sender.signEnvelope(unsigned);
    const digest = envelopeDigest(envelope);
    expect(db.receiveRequest(envelope, digest)).toBe("INSERTED");
    expect(db.receiveRequest(envelope, digest)).toBe("DUPLICATE");
    expect(db.listDelegations()).toHaveLength(1);
    db.close();

    const versionTwo = new DatabaseSync(dbPath);
    versionTwo.exec(`
      DROP TABLE team_plan_items;
      DROP TABLE team_plans;
      UPDATE schema_meta SET version = 2 WHERE singleton = 1;
    `);
    versionTwo.close();

    const reopened = new SquadDatabase(dbPath);
    expect(reopened.identityNodeId()).toBe(identity.nodeId);
    expect(reopened.listDelegations()).toHaveLength(1);
    expect(reopened.listTeamPlans()).toEqual([]);
    reopened.close();

    const migrated = new DatabaseSync(dbPath);
    const schema = migrated
      .prepare("SELECT version FROM schema_meta WHERE singleton = 1")
      .get();
    expect(schema?.version).toBe(6);
    migrated.close();
  });

  it("commits selected HumanTodos and resumes only after every item is done", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-todo-"));
    const identity = NodeIdentity.load(join(root, "receiver.json"));
    const sender = NodeIdentity.load(join(root, "sender.json"));
    const db = new SquadDatabase(join(root, "node.sqlite"));
    db.bindIdentity(identity.nodeId, identity.publicKey, identity.createdAt);
    db.upsertPeer({
      nodeId: sender.nodeId,
      displayName: "Sender",
      publicKey: sender.publicKey,
      enabled: true,
      policy: {
        canMessage: false,
        canDelegate: true,
        autoExecute: "NEVER",
        maxConcurrent: 1,
        maxDelegationDepth: 1,
        maxRuntimeMinutes: 30,
      },
    });
    const delegationId = randomUUID();
    const now = new Date();
    const envelope = sender.signEnvelope({
      protocolVersion: 1,
      envelopeId: randomUUID(),
      kind: "DELEGATION_REQUEST",
      senderNodeId: sender.nodeId,
      recipientNodeId: identity.nodeId,
      correlationId: delegationId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      payload: {
        delegationId,
        objective: "Finish two physical checks",
        acceptanceCriteria: [],
        attachmentRefs: [],
        delegationDepth: 0,
      },
    });
    db.receiveRequest(envelope, envelopeDigest(envelope));
    db.transition(delegationId, "TRIAGING");
    db.transition(delegationId, "RUNNING", {
      sessionId: `squad-${delegationId}`,
    });
    const firstId = randomUUID();
    const secondId = randomUUID();
    db.handoff(
      delegationId,
      [firstId, secondId].map((id, index) => ({
        id,
        delegationId,
        title: `Check ${index + 1}`,
        blockingReason: "requires the owner",
        status: "OPEN" as const,
        attachmentRefs: [],
        createdAt: new Date().toISOString(),
      })),
      "Automatic portion complete",
    );
    const partial = db.resolveTodosAndMaybeResume(delegationId, {
      todoIds: [firstId],
      response: "first done",
      attachmentRefs: [],
    });
    expect(partial.resumed).toBe(false);
    expect(partial.delegation.status).toBe("WAITING_HUMAN");
    expect(
      partial.delegation.todos.find((todo) => todo.id === firstId)?.status,
    ).toBe("DONE");
    expect(
      partial.delegation.todos.find((todo) => todo.id === secondId)?.status,
    ).toBe("OPEN");
    db.close();

    const reopened = new SquadDatabase(join(root, "node.sqlite"));
    const finished = reopened.resolveTodosAndMaybeResume(delegationId, {
      todoIds: [secondId],
      response: "second done",
      attachmentRefs: [],
    });
    expect(finished.resumed).toBe(true);
    expect(finished.delegation.status).toBe("RUNNING");
    expect(finished.delegation.sessionId).toBe(`squad-${delegationId}`);
    expect(
      finished.delegation.todos.every((todo) => todo.status === "DONE"),
    ).toBe(true);
    reopened.close();
  });

  it("backs off the same outbox envelope and ignores remote state regressions", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-outbox-"));
    const identity = NodeIdentity.load(join(root, "sender.json"));
    const peer = NodeIdentity.load(join(root, "peer.json"));
    const db = new SquadDatabase(join(root, "node.sqlite"));
    db.bindIdentity(identity.nodeId, identity.publicKey, identity.createdAt);
    db.upsertPeer({
      nodeId: peer.nodeId,
      displayName: "Peer",
      publicKey: peer.publicKey,
      enabled: true,
      policy: {
        canMessage: false,
        canDelegate: true,
        autoExecute: "NEVER",
        maxConcurrent: 1,
        maxDelegationDepth: 1,
        maxRuntimeMinutes: 30,
      },
    });
    const delegationId = randomUUID();
    const now = new Date();
    const envelope = identity.signEnvelope({
      protocolVersion: 1,
      envelopeId: randomUUID(),
      kind: "DELEGATION_REQUEST",
      senderNodeId: identity.nodeId,
      recipientNodeId: peer.nodeId,
      correlationId: delegationId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      payload: {
        delegationId,
        objective: "Summarize",
        acceptanceCriteria: [],
        attachmentRefs: [],
        delegationDepth: 0,
      },
    });
    db.createOutgoing(envelope.payload, envelope, envelopeDigest(envelope));
    expect(db.pendingEnvelopes()).toHaveLength(1);
    db.markEnvelopeAttemptFailed(
      envelope.envelopeId,
      new Error("token=hidden"),
    );
    expect(db.pendingEnvelopes()).toHaveLength(0);
    db.retryEnvelopeNow(envelope.envelopeId);
    expect(db.pendingEnvelopes()).toHaveLength(1);
    db.applyRemoteUpdate({
      delegationId,
      status: "RUNNING",
      revision: 2,
      updatedAt: new Date().toISOString(),
    });
    db.applyRemoteUpdate({
      delegationId,
      status: "QUEUED",
      revision: 3,
      updatedAt: new Date().toISOString(),
    });
    expect(db.getDelegation(delegationId)?.status).toBe("RUNNING");
    db.applyRemoteResult({
      delegationId,
      status: "COMPLETED",
      summary: "stale",
      outputs: [],
      revision: 2,
      completedAt: new Date().toISOString(),
    });
    expect(db.getDelegation(delegationId)?.status).toBe("RUNNING");
    db.applyRemoteResult({
      delegationId,
      status: "COMPLETED",
      summary: "done",
      outputs: [],
      revision: 4,
      completedAt: new Date().toISOString(),
    });
    expect(db.getDelegation(delegationId)?.status).toBe("COMPLETED");
    db.close();
  });

  it("persists team plans and resumes partial dispatch with stable delegation IDs", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-plan-"));
    const dbPath = join(root, "node.sqlite");
    const bob = NodeIdentity.load(join(root, "bob.json"));
    const carol = NodeIdentity.load(join(root, "carol.json"));
    const db = new SquadDatabase(dbPath);
    const policy = {
      canMessage: false,
      canDelegate: true,
      autoExecute: "NEVER" as const,
      maxConcurrent: 1,
      maxDelegationDepth: 1,
      maxRuntimeMinutes: 30,
    };
    db.upsertPeer({
      nodeId: bob.nodeId,
      displayName: "Bob",
      publicKey: bob.publicKey,
      enabled: true,
      policy,
    });
    db.upsertPeer({
      nodeId: carol.nodeId,
      displayName: "Carol",
      publicKey: carol.publicKey,
      enabled: true,
      policy,
    });
    const peers = [db.findPeer("Bob"), db.findPeer("Carol")];
    expect(peers.every((peer) => peer !== undefined)).toBe(true);
    const plan = db.createTeamPlan(
      {
        title: "Release follow-up",
        sourceSummary: "Two owners, two deliverables.",
        items: [
          { to: "Bob", objective: "Draft release notes" },
          { to: "Carol", objective: "Verify the installation guide" },
        ],
      },
      peers.filter((peer) => peer !== undefined),
    );
    expect(plan.status).toBe("DRAFT");
    expect(plan.items).toHaveLength(2);

    db.beginTeamPlanDispatch(plan.id);
    const first = plan.items[0];
    const second = plan.items[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    db.markTeamPlanItemDispatched(plan.id, first!.id, first!.id);
    db.markTeamPlanItemFailed(
      plan.id,
      second!.id,
      new Error("token=hidden temporary failure"),
    );
    const partial = db.finishTeamPlanDispatch(plan.id);
    expect(partial.status).toBe("PARTIAL");
    expect(partial.items[0]?.delegationId).toBe(first!.id);
    expect(partial.items[1]?.error).toContain("token=[REDACTED]");
    db.close();

    const reopened = new SquadDatabase(dbPath);
    const resumed = reopened.beginTeamPlanDispatch(plan.id);
    expect(resumed.status).toBe("DISPATCHING");
    reopened.markTeamPlanItemDispatched(plan.id, second!.id, second!.id);
    const finished = reopened.finishTeamPlanDispatch(plan.id);
    expect(finished.status).toBe("DISPATCHED");
    expect(finished.items.every((item) => item.status === "DISPATCHED")).toBe(
      true,
    );
    reopened.close();
  });

  it("persists a verified organization, local member policy, and Session scope", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-org-db-"));
    const dbPath = join(root, "node.sqlite");
    const owner = NodeIdentity.load(join(root, "owner.json"));
    const member = NodeIdentity.load(join(root, "member.json"));
    const authority = OrganizationAuthority.create(
      join(root, "authority.json"),
    );
    const organizationId = randomUUID();
    const ownerMembershipId = randomUUID();
    const memberMembershipId = randomUUID();
    const now = new Date().toISOString();
    const unsignedDocument = unsignedOrganizationDocumentSchema.parse({
      version: 1,
      organizationId,
      name: "Persistence Team",
      authorityId: authority.authorityId,
      authorityPublicKey: authority.publicKey,
      ownerMembershipId,
      createdAt: now,
    });
    const document = {
      ...unsignedDocument,
      signature: authority.sign(unsignedDocument),
    };
    const unsignedOwner = unsignedOrganizationMembershipCertificateSchema.parse(
      {
        version: 1,
        organizationId,
        organizationRevision: 1,
        membershipId: ownerMembershipId,
        memberRevision: 1,
        nodeId: owner.nodeId,
        publicKey: owner.publicKey,
        displayName: "Owner",
        role: "OWNER",
        status: "ACTIVE",
        issuer: { kind: "AUTHORITY", authorityId: authority.authorityId },
        issuedAt: now,
      },
    );
    const ownerCertificate = {
      ...unsignedOwner,
      signature: authority.sign(unsignedOwner),
    };
    const unsignedMember =
      unsignedOrganizationMembershipCertificateSchema.parse({
        version: 1,
        organizationId,
        organizationRevision: 2,
        membershipId: memberMembershipId,
        memberRevision: 1,
        nodeId: member.nodeId,
        publicKey: member.publicKey,
        displayName: "Member",
        role: "MEMBER",
        status: "ACTIVE",
        issuer: {
          kind: "MEMBER",
          membershipId: ownerMembershipId,
          nodeId: owner.nodeId,
        },
        issuedAt: now,
      });
    const memberCertificate = {
      ...unsignedMember,
      signature: owner.sign(unsignedMember),
    };
    const bundle = {
      document,
      revision: 2,
      events: [ownerCertificate, memberCertificate],
      selfStatus: "ACTIVE" as const,
      pendingJoinRequests: [],
    };

    const db = new SquadDatabase(dbPath);
    db.bindIdentity(owner.nodeId, owner.publicKey, owner.createdAt);
    expect(db.applyOrganizationBundle(bundle, owner.nodeId)).toBe(true);
    expect(db.applyOrganizationBundle(bundle, owner.nodeId)).toBe(false);
    expect(db.listPeers()).toEqual([]);
    expect(db.findPeer(member.nodeId)).toBeUndefined();
    db.updateOrganizationMemberPolicy(organizationId, memberMembershipId, {
      autoExecute: "SAFE",
    });
    const organizationMember = db.findOrganizationMember(
      organizationId,
      memberMembershipId,
      owner.nodeId,
    );
    if (organizationMember === undefined) {
      throw new Error("organization member was not projected");
    }
    const plan = db.createTeamPlan(
      {
        title: "Organization-only plan",
        items: [{ to: memberMembershipId, objective: "Review the draft" }],
      },
      [
        {
          nodeId: organizationMember.nodeId,
          displayName: organizationMember.displayName,
          publicKey: organizationMember.publicKey,
          enabled: true,
          transport: "RELAY",
          policy: organizationMember.policy,
          organizationId,
          membershipId: memberMembershipId,
          senderMembershipId: ownerMembershipId,
        },
      ],
      organizationId,
    );
    const delegationId = randomUUID();
    const request = {
      delegationId,
      objective: "Organization-only delegation",
      acceptanceCriteria: [],
      attachmentRefs: [],
      delegationDepth: 0,
    };
    const envelope = owner.signEnvelope({
      protocolVersion: 2,
      envelopeId: randomUUID(),
      kind: "DELEGATION_REQUEST",
      senderNodeId: owner.nodeId,
      recipientNodeId: member.nodeId,
      correlationId: delegationId,
      createdAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      organizationId,
      senderMembershipId: ownerMembershipId,
      recipientMembershipId: memberMembershipId,
      payload: request,
    });
    db.createOutgoing(request, envelope, envelopeDigest(envelope));
    db.setSessionOrganization(
      "session-persistence",
      organizationId,
      owner.nodeId,
    );
    db.close();

    const reopened = new SquadDatabase(dbPath);
    const organization = reopened.findOrganization(
      organizationId,
      owner.nodeId,
    );
    expect(organization).toMatchObject({
      name: "Persistence Team",
      role: "OWNER",
      membershipStatus: "ACTIVE",
      revision: 2,
    });
    expect(
      organization?.members.find(
        (candidate) => candidate.membershipId === memberMembershipId,
      )?.policy.autoExecute,
    ).toBe("SAFE");
    expect(reopened.sessionOrganization("session-persistence")).toBe(
      organizationId,
    );
    expect(reopened.getTeamPlan(plan.id)?.organizationId).toBe(organizationId);
    expect(reopened.getDelegation(delegationId)).toMatchObject({
      organizationId,
      senderMembershipId: ownerMembershipId,
      recipientMembershipId: memberMembershipId,
    });
    expect(reopened.listPeers()).toEqual([]);
    reopened.close();
  });
});
