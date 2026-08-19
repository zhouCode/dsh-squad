import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { canonicalBytes } from "../shared/canonical.ts";
import {
  organizationDirectoryEventSchema,
  authorityIdSchema,
  organizationDocumentSchema,
  organizationMembershipCertificateSchema,
  organizationOwnershipTransferAcceptance,
  organizationOwnershipTransferEventSchema,
  organizationOwnershipTransferProposalSchema,
  unsignedOrganizationDocument,
  unsignedOrganizationMembershipCertificate,
  unsignedOrganizationOwnershipTransferProposal,
  type OrganizationDirectoryEvent,
  type OrganizationDocument,
  type OrganizationMembershipCertificate,
  type OrganizationOwnershipTransferEvent,
  type OrganizationOwnershipTransferProposal,
} from "../shared/organizations.ts";
import { nodeIdFromPublicKey, verifySignature } from "./identity.ts";

const authorityFileSchema = z.strictObject({
  version: z.literal(1),
  authorityId: authorityIdSchema,
  publicKey: z.string().min(1),
  privateKey: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
});

type AuthorityFile = z.infer<typeof authorityFileSchema>;

export function authorityIdFromPublicKey(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der",
  });
  return `authority_${createHash("sha256").update(der).digest("base64url")}`;
}

function validateAuthority(authority: AuthorityFile): void {
  if (authorityIdFromPublicKey(authority.publicKey) !== authority.authorityId) {
    throw new Error("organization authority fingerprint does not match");
  }
  const probe = Buffer.from("dsh-squad-organization-authority-probe", "utf8");
  const signature = cryptoSign(
    null,
    probe,
    createPrivateKey(authority.privateKey),
  );
  if (
    !cryptoVerify(null, probe, createPublicKey(authority.publicKey), signature)
  ) {
    throw new Error("organization authority key pair does not match");
  }
}

export class OrganizationAuthority {
  readonly authorityId: string;
  readonly publicKey: string;
  readonly createdAt: string;
  readonly #privateKey: string;

  private constructor(value: AuthorityFile) {
    this.authorityId = value.authorityId;
    this.publicKey = value.publicKey;
    this.createdAt = value.createdAt;
    this.#privateKey = value.privateKey;
  }

  static create(path: string): OrganizationAuthority {
    if (existsSync(path)) {
      throw new Error(`organization authority already exists at ${path}`);
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const privateKeyPem = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const value = authorityFileSchema.parse({
      version: 1,
      authorityId: authorityIdFromPublicKey(publicKeyPem),
      publicKey: publicKeyPem,
      privateKey: privateKeyPem,
      createdAt: new Date().toISOString(),
    });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    return new OrganizationAuthority(value);
  }

  static load(path: string): OrganizationAuthority {
    if (!existsSync(path)) {
      throw new Error(`organization authority is missing at ${path}`);
    }
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `organization authority permissions must be 0600, found ${mode.toString(8)}`,
      );
    }
    const value = authorityFileSchema.parse(
      JSON.parse(readFileSync(path, "utf8")) as unknown,
    );
    validateAuthority(value);
    return new OrganizationAuthority(value);
  }

  sign(value: unknown): string {
    return cryptoSign(
      null,
      canonicalBytes(value),
      createPrivateKey(this.#privateKey),
    ).toString("base64url");
  }
}

export function verifyOrganizationDocument(
  candidate: OrganizationDocument,
): OrganizationDocument {
  const document = organizationDocumentSchema.parse(candidate);
  if (
    authorityIdFromPublicKey(document.authorityPublicKey) !==
    document.authorityId
  ) {
    throw new Error("organization authority public key is mismatched");
  }
  if (
    !verifySignature(
      unsignedOrganizationDocument(document),
      document.signature,
      document.authorityPublicKey,
    )
  ) {
    throw new Error("organization document signature is invalid");
  }
  return document;
}

export interface VerifiedOrganizationDirectory {
  document: OrganizationDocument;
  revision: number;
  members: Map<string, OrganizationMembershipCertificate>;
}

function verifyCertificateSignature(
  document: OrganizationDocument,
  members: Map<string, OrganizationMembershipCertificate>,
  certificate: OrganizationMembershipCertificate,
): void {
  const unsigned = unsignedOrganizationMembershipCertificate(certificate);
  if (certificate.issuer.kind === "AUTHORITY") {
    if (certificate.issuer.authorityId !== document.authorityId) {
      throw new Error("membership certificate authority is mismatched");
    }
    if (
      !verifySignature(
        unsigned,
        certificate.signature,
        document.authorityPublicKey,
      )
    ) {
      throw new Error("membership authority signature is invalid");
    }
    return;
  }
  const issuer = members.get(certificate.issuer.membershipId);
  if (
    issuer === undefined ||
    issuer.nodeId !== certificate.issuer.nodeId ||
    issuer.status !== "ACTIVE"
  ) {
    throw new Error("membership certificate issuer is not active");
  }
  if (!verifySignature(unsigned, certificate.signature, issuer.publicKey)) {
    throw new Error("membership certificate signature is invalid");
  }
}

export function applyOrganizationCertificate(
  documentCandidate: OrganizationDocument,
  members: Map<string, OrganizationMembershipCertificate>,
  currentRevision: number,
  candidate: OrganizationMembershipCertificate,
): void {
  const document = verifyOrganizationDocument(documentCandidate);
  const certificate = organizationMembershipCertificateSchema.parse(candidate);
  if (certificate.organizationId !== document.organizationId) {
    throw new Error("membership certificate belongs to another organization");
  }
  if (certificate.organizationRevision !== currentRevision + 1) {
    throw new Error("organization certificate revision is not contiguous");
  }
  if (nodeIdFromPublicKey(certificate.publicKey) !== certificate.nodeId) {
    throw new Error("membership public key fingerprint is mismatched");
  }
  const previous = members.get(certificate.membershipId);
  if (certificate.memberRevision !== (previous?.memberRevision ?? 0) + 1) {
    throw new Error("member certificate revision is not contiguous");
  }
  if (
    previous !== undefined &&
    (previous.nodeId !== certificate.nodeId ||
      previous.publicKey !== certificate.publicKey)
  ) {
    throw new Error("membership identity cannot be replaced");
  }
  verifyCertificateSignature(document, members, certificate);

  if (currentRevision === 0) {
    if (
      certificate.issuer.kind !== "AUTHORITY" ||
      certificate.membershipId !== document.ownerMembershipId ||
      certificate.role !== "OWNER" ||
      certificate.status !== "ACTIVE" ||
      certificate.memberRevision !== 1
    ) {
      throw new Error("the first directory event must establish the owner");
    }
  } else {
    if (certificate.issuer.kind !== "MEMBER") {
      throw new Error("only the initial owner may be issued by the authority");
    }
    const issuer = members.get(certificate.issuer.membershipId);
    if (issuer === undefined) throw new Error("missing certificate issuer");
    if (previous?.role === "OWNER" || certificate.role === "OWNER") {
      throw new Error(
        "owner changes require an accepted ownership transfer event",
      );
    }
    const selfDeparture =
      previous !== undefined &&
      issuer.membershipId === certificate.membershipId &&
      previous.status === "ACTIVE" &&
      certificate.status === "DISABLED" &&
      certificate.role === previous.role;
    if (!selfDeparture) {
      if (issuer.role === "MEMBER") {
        throw new Error("members cannot change the organization directory");
      }
      if (issuer.role === "ADMIN") {
        if (
          issuer.membershipId === certificate.membershipId ||
          certificate.role !== "MEMBER" ||
          (previous !== undefined && previous.role !== "MEMBER")
        ) {
          throw new Error("admins may only manage ordinary members");
        }
      }
    }
    if (previous === undefined && certificate.role !== "MEMBER") {
      throw new Error("new organization members must start as Member");
    }
  }
  members.set(certificate.membershipId, certificate);
}

export function verifyOrganizationOwnershipTransferProposal(
  documentCandidate: OrganizationDocument,
  members: Map<string, OrganizationMembershipCertificate>,
  currentRevision: number,
  candidate: OrganizationOwnershipTransferProposal,
): OrganizationOwnershipTransferProposal {
  const document = verifyOrganizationDocument(documentCandidate);
  const proposal = organizationOwnershipTransferProposalSchema.parse(candidate);
  if (proposal.organizationId !== document.organizationId) {
    throw new Error("ownership transfer belongs to another organization");
  }
  if (proposal.organizationRevision !== currentRevision + 1) {
    throw new Error("ownership transfer revision is not contiguous");
  }
  if (Date.parse(proposal.expiresAt) <= Date.parse(proposal.proposedAt)) {
    throw new Error("ownership transfer expiry is invalid");
  }
  const activeOwners = [...members.values()].filter(
    (member) => member.role === "OWNER" && member.status === "ACTIVE",
  );
  if (activeOwners.length !== 1) {
    throw new Error("ownership transfer requires exactly one active owner");
  }
  const owner = activeOwners[0]!;
  const previous = proposal.previousOwnerCertificate;
  const next = proposal.newOwnerCertificate;
  const target = members.get(next.membershipId);
  if (
    previous.membershipId !== owner.membershipId ||
    target === undefined ||
    target.membershipId === owner.membershipId ||
    target.status !== "ACTIVE"
  ) {
    throw new Error("ownership transfer members do not match the directory");
  }
  for (const certificate of [previous, next]) {
    if (
      certificate.organizationId !== document.organizationId ||
      certificate.organizationRevision !== proposal.organizationRevision ||
      certificate.issuer.kind !== "MEMBER" ||
      certificate.issuer.membershipId !== owner.membershipId ||
      certificate.issuer.nodeId !== owner.nodeId
    ) {
      throw new Error("ownership transfer certificate issuer is mismatched");
    }
    if (nodeIdFromPublicKey(certificate.publicKey) !== certificate.nodeId) {
      throw new Error("ownership transfer public key is mismatched");
    }
    verifyCertificateSignature(document, members, certificate);
  }
  if (
    previous.memberRevision !== owner.memberRevision + 1 ||
    previous.nodeId !== owner.nodeId ||
    previous.publicKey !== owner.publicKey ||
    previous.displayName !== owner.displayName ||
    previous.role !== "ADMIN" ||
    previous.status !== "ACTIVE"
  ) {
    throw new Error("previous owner transition is invalid");
  }
  if (
    next.memberRevision !== target.memberRevision + 1 ||
    next.nodeId !== target.nodeId ||
    next.publicKey !== target.publicKey ||
    next.displayName !== target.displayName ||
    next.role !== "OWNER" ||
    next.status !== "ACTIVE"
  ) {
    throw new Error("new owner transition is invalid");
  }
  if (
    !verifySignature(
      unsignedOrganizationOwnershipTransferProposal(proposal),
      proposal.proposerSignature,
      owner.publicKey,
    )
  ) {
    throw new Error("ownership transfer proposal signature is invalid");
  }
  return proposal;
}

export function applyOrganizationOwnershipTransfer(
  documentCandidate: OrganizationDocument,
  members: Map<string, OrganizationMembershipCertificate>,
  currentRevision: number,
  candidate: OrganizationOwnershipTransferEvent,
): void {
  const event = organizationOwnershipTransferEventSchema.parse(candidate);
  const {
    acceptedAt: _acceptedAt,
    acceptanceSignature: _acceptanceSignature,
    ...proposalCandidate
  } = event;
  const proposal =
    organizationOwnershipTransferProposalSchema.parse(proposalCandidate);
  verifyOrganizationOwnershipTransferProposal(
    documentCandidate,
    members,
    currentRevision,
    proposal,
  );
  if (
    Date.parse(event.acceptedAt) < Date.parse(event.proposedAt) ||
    Date.parse(event.acceptedAt) > Date.parse(event.expiresAt)
  ) {
    throw new Error("ownership transfer acceptance time is invalid");
  }
  const target = members.get(event.newOwnerCertificate.membershipId);
  if (
    target === undefined ||
    !verifySignature(
      organizationOwnershipTransferAcceptance(proposal, event.acceptedAt),
      event.acceptanceSignature,
      target.publicKey,
    )
  ) {
    throw new Error("ownership transfer acceptance signature is invalid");
  }
  members.set(
    event.previousOwnerCertificate.membershipId,
    event.previousOwnerCertificate,
  );
  members.set(
    event.newOwnerCertificate.membershipId,
    event.newOwnerCertificate,
  );
}

export function applyOrganizationDirectoryEvent(
  document: OrganizationDocument,
  members: Map<string, OrganizationMembershipCertificate>,
  currentRevision: number,
  candidate: OrganizationDirectoryEvent,
): void {
  const event = organizationDirectoryEventSchema.parse(candidate);
  if ("transferId" in event) {
    applyOrganizationOwnershipTransfer(
      document,
      members,
      currentRevision,
      event,
    );
    return;
  }
  applyOrganizationCertificate(document, members, currentRevision, event);
}

export function verifyOrganizationDirectory(
  documentCandidate: OrganizationDocument,
  eventCandidates: OrganizationDirectoryEvent[],
): VerifiedOrganizationDirectory {
  const document = verifyOrganizationDocument(documentCandidate);
  const members = new Map<string, OrganizationMembershipCertificate>();
  let revision = 0;
  for (const event of eventCandidates) {
    applyOrganizationDirectoryEvent(document, members, revision, event);
    revision = event.organizationRevision;
  }
  if (revision === 0) throw new Error("organization directory has no owner");
  const owners = [...members.values()].filter(
    (member) => member.role === "OWNER" && member.status === "ACTIVE",
  );
  if (owners.length !== 1) {
    throw new Error("organization directory must contain one active owner");
  }
  return { document, revision, members };
}
