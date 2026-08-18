import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  unsignedOrganizationDocumentSchema,
  unsignedOrganizationMembershipCertificateSchema,
} from "../shared/organizations.ts";
import { NodeIdentity } from "./identity.ts";
import {
  OrganizationAuthority,
  verifyOrganizationDirectory,
} from "./organization.ts";

describe("organization signed directory", () => {
  it("accepts an authority owner and owner/admin member chain", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-org-"));
    const owner = NodeIdentity.load(join(root, "owner.json"));
    const admin = NodeIdentity.load(join(root, "admin.json"));
    const member = NodeIdentity.load(join(root, "member.json"));
    const authority = OrganizationAuthority.create(
      join(root, "authority.json"),
    );
    const organizationId = randomUUID();
    const ownerMembershipId = randomUUID();
    const now = new Date().toISOString();
    const unsignedDocument = unsignedOrganizationDocumentSchema.parse({
      version: 1,
      organizationId,
      name: "Product",
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
        nodeId: owner.nodeId,
        publicKey: owner.publicKey,
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
    const adminUnsigned = unsignedOrganizationMembershipCertificateSchema.parse(
      {
        version: 1,
        organizationId,
        organizationRevision: 2,
        membershipId: randomUUID(),
        memberRevision: 1,
        nodeId: admin.nodeId,
        publicKey: admin.publicKey,
        displayName: "Bob",
        role: "MEMBER",
        status: "ACTIVE",
        issuer: {
          kind: "MEMBER",
          membershipId: ownerMembershipId,
          nodeId: owner.nodeId,
        },
        issuedAt: now,
      },
    );
    const adminMember = {
      ...adminUnsigned,
      signature: owner.sign(adminUnsigned),
    };
    const promoteUnsigned =
      unsignedOrganizationMembershipCertificateSchema.parse({
        ...adminUnsigned,
        organizationRevision: 3,
        memberRevision: 2,
        role: "ADMIN",
        issuer: {
          kind: "MEMBER",
          membershipId: ownerMembershipId,
          nodeId: owner.nodeId,
        },
      });
    const promotedAdmin = {
      ...promoteUnsigned,
      signature: owner.sign(promoteUnsigned),
    };
    const memberUnsigned =
      unsignedOrganizationMembershipCertificateSchema.parse({
        version: 1,
        organizationId,
        organizationRevision: 4,
        membershipId: randomUUID(),
        memberRevision: 1,
        nodeId: member.nodeId,
        publicKey: member.publicKey,
        displayName: "Carol",
        role: "MEMBER",
        status: "ACTIVE",
        issuer: {
          kind: "MEMBER",
          membershipId: promotedAdmin.membershipId,
          nodeId: admin.nodeId,
        },
        issuedAt: now,
      });
    const memberCertificate = {
      ...memberUnsigned,
      signature: admin.sign(memberUnsigned),
    };
    const verified = verifyOrganizationDirectory(document, [
      ownerCertificate,
      adminMember,
      promotedAdmin,
      memberCertificate,
    ]);
    expect(verified.revision).toBe(4);
    expect(verified.members.get(promotedAdmin.membershipId)?.role).toBe(
      "ADMIN",
    );
  });

  it("rejects an ordinary member issuing a directory event", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-org-reject-"));
    const owner = NodeIdentity.load(join(root, "owner.json"));
    const member = NodeIdentity.load(join(root, "member.json"));
    const target = NodeIdentity.load(join(root, "target.json"));
    const authority = OrganizationAuthority.create(
      join(root, "authority.json"),
    );
    const organizationId = randomUUID();
    const ownerMembershipId = randomUUID();
    const now = new Date().toISOString();
    const unsignedDocument = unsignedOrganizationDocumentSchema.parse({
      version: 1,
      organizationId,
      name: "Security",
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
      ...ownerUnsigned,
      signature: authority.sign(ownerUnsigned),
    };
    const memberMembershipId = randomUUID();
    const memberUnsigned =
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
      ...memberUnsigned,
      signature: owner.sign(memberUnsigned),
    };
    const forgedUnsigned =
      unsignedOrganizationMembershipCertificateSchema.parse({
        version: 1,
        organizationId,
        organizationRevision: 3,
        membershipId: randomUUID(),
        memberRevision: 1,
        nodeId: target.nodeId,
        publicKey: target.publicKey,
        displayName: "Target",
        role: "MEMBER",
        status: "ACTIVE",
        issuer: {
          kind: "MEMBER",
          membershipId: memberMembershipId,
          nodeId: member.nodeId,
        },
        issuedAt: now,
      });
    const forged = {
      ...forgedUnsigned,
      signature: member.sign(forgedUnsigned),
    };
    expect(() =>
      verifyOrganizationDirectory(document, [
        ownerCertificate,
        memberCertificate,
        forged,
      ]),
    ).toThrow("members cannot change");
  });
});
