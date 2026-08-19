import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  unsignedOrganizationDocumentSchema,
  unsignedOrganizationJoinRequestSchema,
  unsignedOrganizationMembershipCertificateSchema,
  type OrganizationMembershipCertificate,
} from "../shared/organizations.ts";
import { NodeIdentity } from "./identity.ts";
import { OrganizationAuthority } from "./organization.ts";
import { RelayClient } from "./relay-client.ts";
import { RelayServer } from "./relay.ts";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("Relay organization directory", () => {
  it("creates, joins, promotes, delegates management, and revokes", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-relay-org-"));
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const relay = new RelayServer({
      databasePath: join(root, "relay.sqlite"),
      invites: ["alice", "bob", "carol", "dave"].map((name) => ({
        token: `relay-invite-${name}-000000000000`,
        expiresAt,
      })),
      maxMailboxItems: 100,
      maxRequestsPerMinute: 1_000,
    });
    const server = createServer((req, res) => {
      void relay.handle(req, res).then((handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
      () => relay.close(),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("missing Relay address");
    }
    const base = `http://127.0.0.1:${address.port}`;
    const aliceIdentity = NodeIdentity.load(join(root, "alice.json"));
    const bobIdentity = NodeIdentity.load(join(root, "bob.json"));
    const carolIdentity = NodeIdentity.load(join(root, "carol.json"));
    const daveIdentity = NodeIdentity.load(join(root, "dave.json"));
    const alice = new RelayClient(base, aliceIdentity);
    const bob = new RelayClient(base, bobIdentity);
    const carol = new RelayClient(base, carolIdentity);
    const dave = new RelayClient(base, daveIdentity);
    await alice.enroll("relay-invite-alice-000000000000", "Alice");
    await bob.enroll("relay-invite-bob-000000000000", "Bob");
    await carol.enroll("relay-invite-carol-000000000000", "Carol");
    await dave.enroll("relay-invite-dave-000000000000", "Dave");
    expect((await alice.nodes()).map(({ displayName }) => displayName)).toEqual(
      ["Alice"],
    );

    const authority = OrganizationAuthority.create(
      join(root, "authority.json"),
    );
    const organizationId = randomUUID();
    const ownerMembershipId = randomUUID();
    const now = new Date().toISOString();
    const unsignedDocument = unsignedOrganizationDocumentSchema.parse({
      version: 1,
      organizationId,
      name: "Distributed Product",
      authorityId: authority.authorityId,
      authorityPublicKey: authority.publicKey,
      ownerMembershipId,
      createdAt: now,
    });
    const document = {
      ...unsignedDocument,
      signature: authority.sign(unsignedDocument),
    };
    const ownerUnsigned = unsignedOrganizationMembershipCertificateSchema.parse(
      {
        version: 1,
        organizationId,
        organizationRevision: 1,
        membershipId: ownerMembershipId,
        memberRevision: 1,
        nodeId: aliceIdentity.nodeId,
        publicKey: aliceIdentity.publicKey,
        displayName: "Alice",
        role: "OWNER",
        status: "ACTIVE",
        issuer: { kind: "AUTHORITY", authorityId: authority.authorityId },
        issuedAt: now,
      },
    );
    const ownerCertificate = {
      ...ownerUnsigned,
      signature: authority.sign(ownerUnsigned),
    };
    await alice.createOrganization(document, ownerCertificate);

    const bobInvitation = await alice.createOrganizationInvitation(
      organizationId,
      60,
    );
    const bobMembershipId = randomUUID();
    const bobRequestUnsigned = unsignedOrganizationJoinRequestSchema.parse({
      version: 1,
      requestId: randomUUID(),
      organizationId,
      membershipId: bobMembershipId,
      nodeId: bobIdentity.nodeId,
      publicKey: bobIdentity.publicKey,
      displayName: "Bob",
      requestedAt: new Date().toISOString(),
    });
    const bobRequest = {
      ...bobRequestUnsigned,
      signature: bobIdentity.sign(bobRequestUnsigned),
    };
    await bob.joinOrganization(bobInvitation.invitation, bobRequest);
    expect((await bob.organizations())[0]?.selfStatus).toBe("PENDING");
    expect(
      (await alice.organizations())[0]?.pendingJoinRequests[0]?.displayName,
    ).toBe("Bob");

    const bobMemberUnsigned =
      unsignedOrganizationMembershipCertificateSchema.parse({
        version: 1,
        organizationId,
        organizationRevision: 2,
        membershipId: bobMembershipId,
        memberRevision: 1,
        nodeId: bobIdentity.nodeId,
        publicKey: bobIdentity.publicKey,
        displayName: "Bob",
        role: "MEMBER",
        status: "ACTIVE",
        issuer: {
          kind: "MEMBER",
          membershipId: ownerMembershipId,
          nodeId: aliceIdentity.nodeId,
        },
        issuedAt: new Date().toISOString(),
      });
    const bobMember = {
      ...bobMemberUnsigned,
      signature: aliceIdentity.sign(bobMemberUnsigned),
    };
    await alice.approveOrganizationJoin(
      organizationId,
      bobRequest.requestId,
      bobMember,
    );
    expect((await bob.organizations())[0]?.selfStatus).toBe("ACTIVE");
    expect((await alice.nodes()).map(({ displayName }) => displayName)).toEqual(
      ["Alice", "Bob"],
    );

    const promoteBobUnsigned =
      unsignedOrganizationMembershipCertificateSchema.parse({
        ...bobMemberUnsigned,
        organizationRevision: 3,
        memberRevision: 2,
        role: "ADMIN",
        issuedAt: new Date().toISOString(),
      });
    const promotedBob = {
      ...promoteBobUnsigned,
      signature: aliceIdentity.sign(promoteBobUnsigned),
    };
    await alice.updateOrganizationMember(
      organizationId,
      bobMembershipId,
      promotedBob,
    );

    const carolInvitation = await bob.createOrganizationInvitation(
      organizationId,
      60,
    );
    const carolMembershipId = randomUUID();
    const carolRequestUnsigned = unsignedOrganizationJoinRequestSchema.parse({
      version: 1,
      requestId: randomUUID(),
      organizationId,
      membershipId: carolMembershipId,
      nodeId: carolIdentity.nodeId,
      publicKey: carolIdentity.publicKey,
      displayName: "Carol",
      requestedAt: new Date().toISOString(),
    });
    const carolRequest = {
      ...carolRequestUnsigned,
      signature: carolIdentity.sign(carolRequestUnsigned),
    };
    await carol.joinOrganization(carolInvitation.invitation, carolRequest);
    const carolMemberUnsigned =
      unsignedOrganizationMembershipCertificateSchema.parse({
        version: 1,
        organizationId,
        organizationRevision: 4,
        membershipId: carolMembershipId,
        memberRevision: 1,
        nodeId: carolIdentity.nodeId,
        publicKey: carolIdentity.publicKey,
        displayName: "Carol",
        role: "MEMBER",
        status: "ACTIVE",
        issuer: {
          kind: "MEMBER",
          membershipId: bobMembershipId,
          nodeId: bobIdentity.nodeId,
        },
        issuedAt: new Date().toISOString(),
      });
    const carolMember = {
      ...carolMemberUnsigned,
      signature: bobIdentity.sign(carolMemberUnsigned),
    };
    await bob.approveOrganizationJoin(
      organizationId,
      carolRequest.requestId,
      carolMember,
    );
    expect((await carol.nodes()).map(({ displayName }) => displayName)).toEqual(
      ["Alice", "Bob", "Carol"],
    );
    await expect(
      carol.createOrganizationInvitation(organizationId, 60),
    ).rejects.toMatchObject({ code: "ORGANIZATION_MANAGER_REQUIRED" });

    const daveInvitation = await alice.createOrganizationInvitation(
      organizationId,
      60,
    );
    const daveRequestUnsigned = unsignedOrganizationJoinRequestSchema.parse({
      version: 1,
      requestId: randomUUID(),
      organizationId,
      membershipId: randomUUID(),
      nodeId: daveIdentity.nodeId,
      publicKey: daveIdentity.publicKey,
      displayName: "Dave",
      requestedAt: new Date().toISOString(),
    });
    const daveRequest = {
      ...daveRequestUnsigned,
      signature: daveIdentity.sign(daveRequestUnsigned),
    };
    await dave.joinOrganization(daveInvitation.invitation, daveRequest);
    await expect(
      carol.rejectOrganizationJoin(organizationId, daveRequest.requestId),
    ).rejects.toMatchObject({ code: "ORGANIZATION_MANAGER_REQUIRED" });
    await alice.rejectOrganizationJoin(organizationId, daveRequest.requestId);
    expect(await dave.organizations()).toEqual([]);
    expect((await alice.organizations())[0]?.pendingJoinRequests).toEqual([]);
    await expect(
      alice.rejectOrganizationJoin(organizationId, daveRequest.requestId),
    ).rejects.toMatchObject({ code: "JOIN_REQUEST_ALREADY_RESOLVED" });

    const disableBobUnsigned =
      unsignedOrganizationMembershipCertificateSchema.parse({
        ...promoteBobUnsigned,
        organizationRevision: 5,
        memberRevision: 3,
        status: "DISABLED",
        issuedAt: new Date().toISOString(),
      });
    const disabledBob = {
      ...disableBobUnsigned,
      signature: aliceIdentity.sign(disableBobUnsigned),
    };
    await alice.updateOrganizationMember(
      organizationId,
      bobMembershipId,
      disabledBob,
    );
    expect((await bob.organizations())[0]?.selfStatus).toBe("DISABLED");
    expect((await alice.nodes()).map(({ displayName }) => displayName)).toEqual(
      ["Alice", "Carol"],
    );

    const delegationId = randomUUID();
    const envelope = bobIdentity.signEnvelope({
      protocolVersion: 2,
      envelopeId: randomUUID(),
      kind: "DELEGATION_REQUEST",
      senderNodeId: bobIdentity.nodeId,
      recipientNodeId: carolIdentity.nodeId,
      correlationId: delegationId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      organizationId,
      senderMembershipId: bobMembershipId,
      recipientMembershipId: carolMembershipId,
      payload: {
        delegationId,
        objective: "Must not be delivered after revocation",
        acceptanceCriteria: [],
        attachmentRefs: [],
        delegationDepth: 0,
      },
    });
    await expect(bob.submit(envelope)).rejects.toMatchObject({
      code: "ORGANIZATION_MEMBERSHIP_REJECTED",
    });
  });
});
