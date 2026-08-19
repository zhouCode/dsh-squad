import { z } from "zod";
import {
  idSchema,
  nodeIdSchema,
  peerPolicySchema,
  signatureSchema,
  timestampSchema,
  type PeerPolicy,
} from "./contracts.ts";

export const ORGANIZATION_DOCUMENT_VERSION = 1 as const;
export const ORGANIZATION_DIRECTORY_VERSION = 1 as const;

export const organizationRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const organizationMemberStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
export type OrganizationMemberStatus = z.infer<
  typeof organizationMemberStatusSchema
>;

export const authorityIdSchema = z
  .string()
  .regex(/^authority_[A-Za-z0-9_-]{43}$/, "invalid authority fingerprint");

export const unsignedOrganizationDocumentSchema = z.strictObject({
  version: z.literal(ORGANIZATION_DOCUMENT_VERSION),
  organizationId: idSchema,
  name: z.string().trim().min(1).max(120),
  authorityId: authorityIdSchema,
  authorityPublicKey: z.string().min(1).max(10_000),
  ownerMembershipId: idSchema,
  createdAt: timestampSchema,
});
export type UnsignedOrganizationDocument = z.infer<
  typeof unsignedOrganizationDocumentSchema
>;

export const organizationDocumentSchema = unsignedOrganizationDocumentSchema
  .extend({ signature: signatureSchema })
  .strict();
export type OrganizationDocument = z.infer<typeof organizationDocumentSchema>;

export const organizationCertificateIssuerSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("AUTHORITY"),
      authorityId: authorityIdSchema,
    }),
    z.strictObject({
      kind: z.literal("MEMBER"),
      membershipId: idSchema,
      nodeId: nodeIdSchema,
    }),
  ],
);
export type OrganizationCertificateIssuer = z.infer<
  typeof organizationCertificateIssuerSchema
>;

export const unsignedOrganizationMembershipCertificateSchema = z.strictObject({
  version: z.literal(ORGANIZATION_DIRECTORY_VERSION),
  organizationId: idSchema,
  organizationRevision: z.number().int().positive(),
  membershipId: idSchema,
  memberRevision: z.number().int().positive(),
  nodeId: nodeIdSchema,
  publicKey: z.string().min(1).max(10_000),
  displayName: z.string().trim().min(1).max(120),
  role: organizationRoleSchema,
  status: organizationMemberStatusSchema,
  issuer: organizationCertificateIssuerSchema,
  issuedAt: timestampSchema,
});
export type UnsignedOrganizationMembershipCertificate = z.infer<
  typeof unsignedOrganizationMembershipCertificateSchema
>;

export const organizationMembershipCertificateSchema =
  unsignedOrganizationMembershipCertificateSchema
    .extend({ signature: signatureSchema })
    .strict();
export type OrganizationMembershipCertificate = z.infer<
  typeof organizationMembershipCertificateSchema
>;

export const unsignedOrganizationOwnershipTransferProposalSchema =
  z.strictObject({
    version: z.literal(ORGANIZATION_DIRECTORY_VERSION),
    kind: z.literal("OWNER_TRANSFER"),
    transferId: idSchema,
    organizationId: idSchema,
    organizationRevision: z.number().int().positive(),
    previousOwnerCertificate: organizationMembershipCertificateSchema,
    newOwnerCertificate: organizationMembershipCertificateSchema,
    proposedAt: timestampSchema,
    expiresAt: timestampSchema,
  });
export type UnsignedOrganizationOwnershipTransferProposal = z.infer<
  typeof unsignedOrganizationOwnershipTransferProposalSchema
>;

export const organizationOwnershipTransferProposalSchema =
  unsignedOrganizationOwnershipTransferProposalSchema
    .extend({ proposerSignature: signatureSchema })
    .strict();
export type OrganizationOwnershipTransferProposal = z.infer<
  typeof organizationOwnershipTransferProposalSchema
>;

export const organizationOwnershipTransferAcceptanceSchema = z.strictObject({
  proposal: organizationOwnershipTransferProposalSchema,
  acceptedAt: timestampSchema,
});
export type OrganizationOwnershipTransferAcceptance = z.infer<
  typeof organizationOwnershipTransferAcceptanceSchema
>;

export const organizationOwnershipTransferEventSchema =
  organizationOwnershipTransferProposalSchema
    .extend({
      acceptedAt: timestampSchema,
      acceptanceSignature: signatureSchema,
    })
    .strict();
export type OrganizationOwnershipTransferEvent = z.infer<
  typeof organizationOwnershipTransferEventSchema
>;

export const unsignedOrganizationRenameEventSchema = z.strictObject({
  version: z.literal(ORGANIZATION_DIRECTORY_VERSION),
  kind: z.literal("ORGANIZATION_RENAME"),
  eventId: idSchema,
  organizationId: idSchema,
  organizationRevision: z.number().int().positive(),
  previousName: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  issuer: z.strictObject({
    membershipId: idSchema,
    nodeId: nodeIdSchema,
  }),
  renamedAt: timestampSchema,
});
export type UnsignedOrganizationRenameEvent = z.infer<
  typeof unsignedOrganizationRenameEventSchema
>;

export const organizationRenameEventSchema =
  unsignedOrganizationRenameEventSchema
    .extend({ signature: signatureSchema })
    .strict();
export type OrganizationRenameEvent = z.infer<
  typeof organizationRenameEventSchema
>;

export const organizationDirectoryEventSchema = z.union([
  organizationOwnershipTransferEventSchema,
  organizationRenameEventSchema,
  organizationMembershipCertificateSchema,
]);
export type OrganizationDirectoryEvent = z.infer<
  typeof organizationDirectoryEventSchema
>;

export const unsignedOrganizationJoinRequestSchema = z.strictObject({
  version: z.literal(ORGANIZATION_DIRECTORY_VERSION),
  requestId: idSchema,
  organizationId: idSchema,
  membershipId: idSchema,
  nodeId: nodeIdSchema,
  publicKey: z.string().min(1).max(10_000),
  displayName: z.string().trim().min(1).max(120),
  requestedAt: timestampSchema,
});
export type UnsignedOrganizationJoinRequest = z.infer<
  typeof unsignedOrganizationJoinRequestSchema
>;

export const organizationJoinRequestSchema =
  unsignedOrganizationJoinRequestSchema
    .extend({ signature: signatureSchema })
    .strict();
export type OrganizationJoinRequest = z.infer<
  typeof organizationJoinRequestSchema
>;

export const organizationJoinRequestStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);
export type OrganizationJoinRequestStatus = z.infer<
  typeof organizationJoinRequestStatusSchema
>;

export const organizationInvitationStatusSchema = z.enum([
  "ACTIVE",
  "USED",
  "EXPIRED",
  "REVOKED",
]);
export type OrganizationInvitationStatus = z.infer<
  typeof organizationInvitationStatusSchema
>;

export const organizationInvitationViewSchema = z.strictObject({
  invitationId: idSchema,
  organizationId: idSchema,
  createdByMembershipId: idSchema,
  status: organizationInvitationStatusSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  usedAt: timestampSchema.optional(),
  revokedAt: timestampSchema.optional(),
});
export type OrganizationInvitationView = z.infer<
  typeof organizationInvitationViewSchema
>;

export const organizationDirectoryBundleSchema = z.strictObject({
  document: organizationDocumentSchema,
  revision: z.number().int().positive(),
  events: z.array(organizationDirectoryEventSchema).min(1).max(10_000),
  selfStatus: z.enum(["ACTIVE", "PENDING", "DISABLED"]),
  pendingJoinRequests: z.array(organizationJoinRequestSchema).max(10_000),
  pendingOwnerTransfer: organizationOwnershipTransferProposalSchema.optional(),
});
export type OrganizationDirectoryBundle = z.infer<
  typeof organizationDirectoryBundleSchema
>;

export interface OrganizationMemberView {
  organizationId: string;
  membershipId: string;
  nodeId: string;
  displayName: string;
  publicKey: string;
  role: OrganizationRole;
  status: OrganizationMemberStatus;
  organizationRevision: number;
  memberRevision: number;
  issuedAt: string;
  isSelf: boolean;
  policy: PeerPolicy;
}

export interface OrganizationView {
  organizationId: string;
  name: string;
  role?: OrganizationRole;
  selfMembershipId?: string;
  membershipStatus: "ACTIVE" | "PENDING" | "DISABLED";
  revision: number;
  createdAt: string;
  members: OrganizationMemberView[];
  pendingJoinRequests: OrganizationJoinRequest[];
  pendingOwnerTransfer?: OrganizationOwnershipTransferProposal;
}

export const defaultOrganizationPeerPolicy: PeerPolicy = peerPolicySchema.parse(
  {
    canMessage: true,
    canDelegate: true,
    autoExecute: "NEVER",
    maxConcurrent: 1,
    maxDelegationDepth: 1,
    maxRuntimeMinutes: 30,
  },
);

export function unsignedOrganizationDocument(
  document: OrganizationDocument,
): UnsignedOrganizationDocument {
  const { signature: _signature, ...unsigned } = document;
  return unsigned;
}

export function unsignedOrganizationMembershipCertificate(
  certificate: OrganizationMembershipCertificate,
): UnsignedOrganizationMembershipCertificate {
  const { signature: _signature, ...unsigned } = certificate;
  return unsigned;
}

export function unsignedOrganizationOwnershipTransferProposal(
  proposal: OrganizationOwnershipTransferProposal,
): UnsignedOrganizationOwnershipTransferProposal {
  const { proposerSignature: _signature, ...unsigned } = proposal;
  return unsigned;
}

export function organizationOwnershipTransferAcceptance(
  proposal: OrganizationOwnershipTransferProposal,
  acceptedAt: string,
): OrganizationOwnershipTransferAcceptance {
  return organizationOwnershipTransferAcceptanceSchema.parse({
    proposal,
    acceptedAt,
  });
}

export function unsignedOrganizationRenameEvent(
  event: OrganizationRenameEvent,
): UnsignedOrganizationRenameEvent {
  const { signature: _signature, ...unsigned } = event;
  return unsigned;
}

export function unsignedOrganizationJoinRequest(
  request: OrganizationJoinRequest,
): UnsignedOrganizationJoinRequest {
  const { signature: _signature, ...unsigned } = request;
  return unsigned;
}

const invitationPattern =
  /^squad-org-v1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,128})$/u;

export function organizationIdFromInvitation(invitation: string): string {
  const match = invitationPattern.exec(invitation.trim());
  if (match?.[1] === undefined) {
    throw new Error("invalid Squad organization invitation");
  }
  return idSchema.parse(match[1]);
}

export function organizationInvitation(
  organizationId: string,
  secret: string,
): string {
  idSchema.parse(organizationId);
  const invitation = `squad-org-v1.${organizationId}.${secret}`;
  organizationIdFromInvitation(invitation);
  return invitation;
}
