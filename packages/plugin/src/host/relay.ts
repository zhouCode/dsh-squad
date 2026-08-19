import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  canonicalBytes,
  sha256Hex,
  unsignedEnvelope,
} from "../shared/canonical.ts";
import {
  MAX_ENVELOPE_BYTES,
  assertEnvelopeSemantics,
  envelopePayloadBytes,
  envelopeSchema,
  nodeIdSchema,
  signatureSchema,
  timestampSchema,
  type Envelope,
} from "../shared/contracts.ts";
import {
  organizationDirectoryBundleSchema,
  organizationDirectoryEventSchema,
  organizationDissolutionEventSchema,
  organizationDocumentSchema,
  organizationIdFromInvitation,
  organizationInvitation,
  organizationInvitationViewSchema,
  organizationJoinRequestSchema,
  organizationMembershipCertificateSchema,
  organizationOwnershipTransferEventSchema,
  organizationOwnershipTransferProposalSchema,
  organizationRenameEventSchema,
  type OrganizationDirectoryEvent,
  unsignedOrganizationJoinRequest,
  type OrganizationDirectoryBundle,
  type OrganizationDocument,
  type OrganizationJoinRequest,
  type OrganizationInvitationView,
  type OrganizationMembershipCertificate,
  type OrganizationOwnershipTransferEvent,
  type OrganizationOwnershipTransferProposal,
} from "../shared/organizations.ts";
import { nodeIdFromPublicKey, verifySignature } from "./identity.ts";
import {
  applyOrganizationDirectoryEvent,
  applyOrganizationCertificate,
  verifyOrganizationOwnershipTransferProposal,
  verifyOrganizationDirectory,
  verifyOrganizationDocument,
} from "./organization.ts";
import type { RelayInviteConfig } from "./config.ts";

const enrollmentSchema = z.strictObject({
  invitation: z.string().min(16).max(512),
  nodeId: nodeIdSchema,
  displayName: z.string().trim().min(1).max(120),
  publicKey: z.string().min(1).max(10_000),
});

const authHeadersSchema = z.strictObject({
  nodeId: nodeIdSchema,
  timestamp: z.string().datetime({ offset: true }),
  nonce: z.string().uuid(),
  signature: z.string().min(1).max(256),
});

const createOrganizationSchema = z.strictObject({
  document: organizationDocumentSchema,
  ownerCertificate: organizationMembershipCertificateSchema,
});

const joinOrganizationSchema = z.strictObject({
  invitation: z.string().min(48).max(512),
  request: organizationJoinRequestSchema,
});

const approveJoinRequestSchema = z.strictObject({
  certificate: organizationMembershipCertificateSchema,
});

const updateMemberCertificateSchema = z.strictObject({
  certificate: organizationMembershipCertificateSchema,
});

const proposeOwnershipTransferSchema = z.strictObject({
  proposal: organizationOwnershipTransferProposalSchema,
});

const acceptOwnershipTransferSchema = z.strictObject({
  acceptedAt: timestampSchema,
  acceptanceSignature: signatureSchema,
});

const renameOrganizationSchema = z.strictObject({
  event: organizationRenameEventSchema,
});

const dissolveOrganizationSchema = z.strictObject({
  event: organizationDissolutionEventSchema,
});

const createOrganizationInvitationSchema = z.strictObject({
  expiresInMinutes: z.number().int().min(5).max(10_080).default(1_440),
});

type SqlRow = Record<string, unknown>;

interface MailboxStream {
  response: ServerResponse;
  heartbeat: ReturnType<typeof setInterval>;
}

function inviteHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.byteLength;
    if (size > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function jsonBody(buffer: Buffer): unknown {
  try {
    return JSON.parse(buffer.toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_JSON");
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": bytes.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(bytes);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

export interface RelayServerOptions {
  databasePath: string;
  invites: RelayInviteConfig[];
  maxMailboxItems: number;
  maxRequestsPerMinute: number;
}

export class RelayServer {
  readonly #db: DatabaseSync;
  readonly #maxMailboxItems: number;
  readonly #maxRequestsPerMinute: number;
  readonly #rate = new Map<string, { minute: number; count: number }>();
  readonly #mailboxStreams = new Map<string, Set<MailboxStream>>();

  constructor(options: RelayServerOptions) {
    mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(options.databasePath);
    this.#db.exec(
      "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;",
    );
    this.#maxMailboxItems = options.maxMailboxItems;
    this.#maxRequestsPerMinute = options.maxRequestsPerMinute;
    this.migrate();
    for (const invite of options.invites) this.seedInvite(invite);
  }

  private migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO schema_meta(singleton, version) VALUES (1, 1);
      CREATE TABLE IF NOT EXISTS relay_nodes (
        node_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        enrolled_at TEXT NOT NULL,
        disabled_at TEXT
      );
      CREATE TABLE IF NOT EXISTS relay_invites (
        token_hash TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        used_by_node_id TEXT,
        used_at TEXT,
        created_at TEXT,
        created_by_node_id TEXT,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS relay_envelopes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        envelope_id TEXT NOT NULL UNIQUE,
        digest TEXT NOT NULL,
        sender_node_id TEXT NOT NULL,
        recipient_node_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY(sender_node_id) REFERENCES relay_nodes(node_id),
        FOREIGN KEY(recipient_node_id) REFERENCES relay_nodes(node_id)
      );
      CREATE TABLE IF NOT EXISTS relay_deliveries (
        envelope_id TEXT PRIMARY KEY,
        recipient_node_id TEXT NOT NULL,
        acknowledged_at TEXT,
        FOREIGN KEY(envelope_id) REFERENCES relay_envelopes(envelope_id) ON DELETE CASCADE,
        FOREIGN KEY(recipient_node_id) REFERENCES relay_nodes(node_id)
      );
      CREATE INDEX IF NOT EXISTS relay_mailbox_idx
        ON relay_deliveries(recipient_node_id, acknowledged_at, envelope_id);
      CREATE TABLE IF NOT EXISTS relay_nonces (
        node_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY(node_id, nonce)
      );

      CREATE TABLE IF NOT EXISTS relay_organizations (
        organization_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        document_json TEXT NOT NULL,
        authority_id TEXT NOT NULL UNIQUE,
        owner_membership_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        dissolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relay_organization_events (
        organization_id TEXT NOT NULL,
        organization_revision INTEGER NOT NULL,
        membership_id TEXT NOT NULL,
        member_revision INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        certificate_json TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        PRIMARY KEY(organization_id, organization_revision),
        UNIQUE(organization_id, membership_id, member_revision),
        FOREIGN KEY(organization_id) REFERENCES relay_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY(node_id) REFERENCES relay_nodes(node_id)
      );

      CREATE TABLE IF NOT EXISTS relay_organization_members (
        organization_id TEXT NOT NULL,
        membership_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
        organization_revision INTEGER NOT NULL,
        member_revision INTEGER NOT NULL,
        issued_at TEXT NOT NULL,
        PRIMARY KEY(organization_id, membership_id),
        UNIQUE(organization_id, node_id),
        FOREIGN KEY(organization_id) REFERENCES relay_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY(node_id) REFERENCES relay_nodes(node_id)
      );
      CREATE INDEX IF NOT EXISTS relay_organization_members_node_idx
        ON relay_organization_members(node_id, status);

      CREATE TABLE IF NOT EXISTS relay_organization_invites (
        token_hash TEXT PRIMARY KEY,
        invitation_id TEXT UNIQUE,
        organization_id TEXT NOT NULL,
        created_by_membership_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_by_request_id TEXT,
        used_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(organization_id) REFERENCES relay_organizations(organization_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relay_organization_join_requests (
        organization_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        membership_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        PRIMARY KEY(organization_id, request_id),
        UNIQUE(organization_id, membership_id),
        UNIQUE(organization_id, node_id),
        FOREIGN KEY(organization_id) REFERENCES relay_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY(node_id) REFERENCES relay_nodes(node_id)
      );

      CREATE TABLE IF NOT EXISTS relay_organization_owner_transfers (
        organization_id TEXT NOT NULL,
        transfer_id TEXT NOT NULL,
        proposal_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED', 'STALE')),
        proposed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT,
        PRIMARY KEY(organization_id, transfer_id),
        FOREIGN KEY(organization_id) REFERENCES relay_organizations(organization_id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS relay_organization_owner_transfer_pending_idx
        ON relay_organization_owner_transfers(organization_id)
        WHERE status = 'PENDING';
    `);
    let version = Number(
      (
        this.#db
          .prepare("SELECT version FROM schema_meta WHERE singleton = 1")
          .get() as SqlRow
      ).version,
    );
    if (version === 1) {
      this.#db.exec("UPDATE schema_meta SET version = 2 WHERE singleton = 1");
      version = 2;
    }
    if (version === 2) {
      const inviteColumns = this.#db
        .prepare("PRAGMA table_info(relay_invites)")
        .all() as SqlRow[];
      for (const column of [
        ["created_at", "TEXT"],
        ["created_by_node_id", "TEXT"],
        ["revoked_at", "TEXT"],
      ] as const) {
        if (!inviteColumns.some((candidate) => candidate.name === column[0])) {
          this.#db.exec(
            `ALTER TABLE relay_invites ADD COLUMN ${column[0]} ${column[1]}`,
          );
        }
      }
      this.#db
        .prepare(
          "UPDATE relay_invites SET created_at = coalesce(created_at, ?) WHERE created_at IS NULL",
        )
        .run(new Date().toISOString());
      this.#db.exec("UPDATE schema_meta SET version = 3 WHERE singleton = 1");
      version = 3;
    }
    if (version === 3) {
      const columns = this.#db
        .prepare("PRAGMA table_info(relay_organization_invites)")
        .all() as SqlRow[];
      for (const column of [
        ["invitation_id", "TEXT"],
        ["revoked_at", "TEXT"],
      ] as const) {
        if (!columns.some((candidate) => candidate.name === column[0])) {
          this.#db.exec(
            `ALTER TABLE relay_organization_invites ADD COLUMN ${column[0]} ${column[1]}`,
          );
        }
      }
      const invitations = this.#db
        .prepare(
          "SELECT token_hash FROM relay_organization_invites WHERE invitation_id IS NULL",
        )
        .all() as SqlRow[];
      const assignId = this.#db.prepare(
        "UPDATE relay_organization_invites SET invitation_id = ? WHERE token_hash = ?",
      );
      for (const invitation of invitations) {
        assignId.run(randomUUID(), String(invitation.token_hash));
      }
      this.#db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS relay_organization_invitation_id_idx ON relay_organization_invites(invitation_id)",
      );
      this.#db.exec("UPDATE schema_meta SET version = 4 WHERE singleton = 1");
      version = 4;
    }
    if (version === 4) {
      this.#db.exec("UPDATE schema_meta SET version = 5 WHERE singleton = 1");
      version = 5;
    }
    if (version === 5) {
      const columns = this.#db
        .prepare("PRAGMA table_info(relay_organizations)")
        .all() as SqlRow[];
      if (!columns.some((column) => column.name === "dissolved_at")) {
        this.#db.exec(
          "ALTER TABLE relay_organizations ADD COLUMN dissolved_at TEXT",
        );
      }
      this.#db.exec("UPDATE schema_meta SET version = 6 WHERE singleton = 1");
      version = 6;
    }
    if (version !== 6) {
      throw new Error(
        `unsupported Squad Relay database version ${String(version)}`,
      );
    }
  }

  private seedInvite(invite: RelayInviteConfig): void {
    const expires = Date.parse(invite.expiresAt);
    if (!Number.isFinite(expires))
      throw new Error("relay invite has invalid expiresAt");
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO relay_invites(token_hash, expires_at, created_at) VALUES (?, ?, ?)",
      )
      .run(
        inviteHash(invite.token),
        new Date(expires).toISOString(),
        new Date().toISOString(),
      );
  }

  private cleanupExpired(now = new Date().toISOString()): void {
    this.#db
      .prepare("DELETE FROM relay_envelopes WHERE expires_at <= ?")
      .run(now);
    this.#db.prepare("DELETE FROM relay_nonces WHERE expires_at <= ?").run(now);
  }

  close(): void {
    for (const streams of this.#mailboxStreams.values()) {
      for (const stream of streams) {
        clearInterval(stream.heartbeat);
        stream.response.end();
      }
    }
    this.#mailboxStreams.clear();
    this.#db.close();
  }

  private streamMailbox(
    req: IncomingMessage,
    res: ServerResponse,
    nodeId: string,
  ): void {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");

    const stream: MailboxStream = {
      response: res,
      heartbeat: setInterval(() => {
        if (!res.destroyed && !res.writableEnded) {
          res.write(`: heartbeat ${Date.now()}\n\n`);
        }
      }, 15_000),
    };
    stream.heartbeat.unref?.();
    const streams = this.#mailboxStreams.get(nodeId) ?? new Set();
    streams.add(stream);
    this.#mailboxStreams.set(nodeId, streams);

    let closed = false;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(stream.heartbeat);
      streams.delete(stream);
      if (streams.size === 0) this.#mailboxStreams.delete(nodeId);
    };
    req.once("close", cleanup);
    res.once("close", cleanup);
    res.once("finish", cleanup);
  }

  private notifyMailbox(nodeId: string, envelopeId: string): void {
    const streams = this.#mailboxStreams.get(nodeId);
    if (streams === undefined) return;
    const event = `event: mailbox\ndata: ${JSON.stringify({ envelopeId })}\n\n`;
    for (const stream of streams) {
      if (!stream.response.destroyed && !stream.response.writableEnded) {
        try {
          stream.response.write(event);
        } catch {
          clearInterval(stream.heartbeat);
          streams.delete(stream);
          stream.response.destroy();
        }
      }
    }
    if (streams.size === 0) this.#mailboxStreams.delete(nodeId);
  }

  private rateLimit(nodeId: string): void {
    const minute = Math.floor(Date.now() / 60_000);
    const current = this.#rate.get(nodeId);
    if (current === undefined || current.minute !== minute) {
      this.#rate.set(nodeId, { minute, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > this.#maxRequestsPerMinute) {
      throw new HttpError(429, "RATE_LIMITED");
    }
  }

  private authenticate(
    req: IncomingMessage,
    path: string,
    body: Buffer,
  ): { nodeId: string; publicKey: string } {
    const headers = authHeadersSchema.safeParse({
      nodeId: req.headers["x-squad-node-id"],
      timestamp: req.headers["x-squad-timestamp"],
      nonce: req.headers["x-squad-nonce"],
      signature: req.headers["x-squad-signature"],
    });
    if (!headers.success) throw new HttpError(401, "AUTH_REQUIRED");
    const timestamp = Date.parse(headers.data.timestamp);
    if (Math.abs(Date.now() - timestamp) > 5 * 60_000) {
      throw new HttpError(401, "AUTH_EXPIRED");
    }
    const row = this.#db
      .prepare(
        "SELECT public_key, disabled_at FROM relay_nodes WHERE node_id = ?",
      )
      .get(headers.data.nodeId) as SqlRow | undefined;
    if (row === undefined || row.disabled_at !== null) {
      throw new HttpError(403, "NODE_NOT_ENROLLED");
    }
    const signed = {
      method: req.method ?? "GET",
      path,
      nodeId: headers.data.nodeId,
      timestamp: headers.data.timestamp,
      nonce: headers.data.nonce,
      bodySha256: sha256Hex(body),
    };
    const publicKey = String(row.public_key);
    if (!verifySignature(signed, headers.data.signature, publicKey)) {
      throw new HttpError(401, "INVALID_AUTH_SIGNATURE");
    }
    try {
      this.#db
        .prepare(
          "INSERT INTO relay_nonces(node_id, nonce, expires_at) VALUES (?, ?, ?)",
        )
        .run(
          headers.data.nodeId,
          headers.data.nonce,
          new Date(Date.now() + 10 * 60_000).toISOString(),
        );
    } catch {
      throw new HttpError(409, "AUTH_REPLAY");
    }
    this.#db
      .prepare("DELETE FROM relay_nonces WHERE expires_at < ?")
      .run(new Date().toISOString());
    this.rateLimit(headers.data.nodeId);
    return { nodeId: headers.data.nodeId, publicKey };
  }

  private enroll(value: unknown): { nodeId: string; enrolled: boolean } {
    const input = enrollmentSchema.parse(value);
    if (nodeIdFromPublicKey(input.publicKey) !== input.nodeId) {
      throw new HttpError(400, "IDENTITY_FINGERPRINT_MISMATCH");
    }
    const existing = this.#db
      .prepare("SELECT public_key FROM relay_nodes WHERE node_id = ?")
      .get(input.nodeId) as SqlRow | undefined;
    if (existing !== undefined && existing.public_key !== input.publicKey) {
      throw new HttpError(409, "NODE_ID_CONFLICT");
    }
    const hash = inviteHash(input.invitation);
    const invite = this.#db
      .prepare(
        "SELECT expires_at, used_by_node_id, revoked_at FROM relay_invites WHERE token_hash = ?",
      )
      .get(hash) as SqlRow | undefined;
    if (invite === undefined) throw new HttpError(403, "INVALID_INVITATION");
    if (invite.revoked_at !== null) {
      throw new HttpError(410, "INVITATION_REVOKED");
    }
    if (invite.used_by_node_id !== null) {
      if (existing !== undefined && invite.used_by_node_id === input.nodeId) {
        return { nodeId: input.nodeId, enrolled: false };
      }
      throw new HttpError(409, "INVITATION_ALREADY_USED");
    }
    if (Date.parse(String(invite.expires_at)) <= Date.now()) {
      throw new HttpError(410, "INVITATION_EXPIRED");
    }
    const now = new Date().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (existing === undefined) {
        this.#db
          .prepare(
            "INSERT INTO relay_nodes(node_id, display_name, public_key, enrolled_at) VALUES (?, ?, ?, ?)",
          )
          .run(input.nodeId, input.displayName, input.publicKey, now);
      } else {
        this.#db
          .prepare("UPDATE relay_nodes SET display_name = ? WHERE node_id = ?")
          .run(input.displayName, input.nodeId);
      }
      const consumed = this.#db
        .prepare(
          "UPDATE relay_invites SET used_by_node_id = ?, used_at = ? WHERE token_hash = ? AND used_by_node_id IS NULL AND revoked_at IS NULL",
        )
        .run(input.nodeId, now, hash);
      if (consumed.changes !== 1) {
        throw new HttpError(409, "INVITATION_ALREADY_USED");
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { nodeId: input.nodeId, enrolled: existing === undefined };
  }

  private organizationDirectory(organizationId: string): {
    document: OrganizationDocument;
    name: string;
    revision: number;
    events: OrganizationDirectoryEvent[];
    members: Map<string, OrganizationMembershipCertificate>;
    dissolvedAt?: string;
    dissolvedByMembershipId?: string;
  } {
    const row = this.#db
      .prepare(
        "SELECT document_json, name, revision, dissolved_at FROM relay_organizations WHERE organization_id = ?",
      )
      .get(organizationId) as SqlRow | undefined;
    if (row === undefined) throw new HttpError(404, "ORGANIZATION_NOT_FOUND");
    const document = organizationDocumentSchema.parse(
      JSON.parse(String(row.document_json)) as unknown,
    );
    const events = (
      this.#db
        .prepare(
          "SELECT certificate_json FROM relay_organization_events WHERE organization_id = ? ORDER BY organization_revision",
        )
        .all(organizationId) as SqlRow[]
    ).map((event) =>
      organizationDirectoryEventSchema.parse(
        JSON.parse(String(event.certificate_json)) as unknown,
      ),
    );
    const verified = verifyOrganizationDirectory(document, events);
    if (
      verified.revision !== Number(row.revision) ||
      verified.name !== String(row.name) ||
      verified.dissolvedAt !==
        (typeof row.dissolved_at === "string" ? row.dissolved_at : undefined)
    ) {
      throw new Error("Relay organization revision is inconsistent");
    }
    return {
      document,
      name: verified.name,
      revision: verified.revision,
      events,
      members: verified.members,
      ...(verified.dissolvedAt === undefined
        ? {}
        : { dissolvedAt: verified.dissolvedAt }),
      ...(verified.dissolvedByMembershipId === undefined
        ? {}
        : { dissolvedByMembershipId: verified.dissolvedByMembershipId }),
    };
  }

  private assertOrganizationActive(
    directory: ReturnType<RelayServer["organizationDirectory"]>,
  ): void {
    if (directory.dissolvedAt !== undefined) {
      throw new HttpError(410, "ORGANIZATION_DISSOLVED");
    }
  }

  private organizationMemberForNode(
    directory: ReturnType<RelayServer["organizationDirectory"]>,
    nodeId: string,
  ): OrganizationMembershipCertificate | undefined {
    return [...directory.members.values()].find(
      (member) => member.nodeId === nodeId,
    );
  }

  private assertOrganizationManager(
    directory: ReturnType<RelayServer["organizationDirectory"]>,
    nodeId: string,
  ): OrganizationMembershipCertificate {
    this.assertOrganizationActive(directory);
    const member = this.organizationMemberForNode(directory, nodeId);
    if (
      member === undefined ||
      member.status !== "ACTIVE" ||
      !["OWNER", "ADMIN"].includes(member.role)
    ) {
      throw new HttpError(403, "ORGANIZATION_MANAGER_REQUIRED");
    }
    return member;
  }

  private pendingOwnershipTransfer(
    organizationId: string,
    currentRevision: number,
  ): OrganizationOwnershipTransferProposal | undefined {
    const row = this.#db
      .prepare(
        "SELECT transfer_id, proposal_json, expires_at FROM relay_organization_owner_transfers WHERE organization_id = ? AND status = 'PENDING'",
      )
      .get(organizationId) as SqlRow | undefined;
    if (row === undefined) return undefined;
    const proposal = organizationOwnershipTransferProposalSchema.parse(
      JSON.parse(String(row.proposal_json)) as unknown,
    );
    if (
      Date.parse(String(row.expires_at)) <= Date.now() ||
      proposal.organizationRevision !== currentRevision + 1
    ) {
      this.#db
        .prepare(
          "UPDATE relay_organization_owner_transfers SET status = 'STALE', resolved_at = ? WHERE organization_id = ? AND transfer_id = ? AND status = 'PENDING'",
        )
        .run(new Date().toISOString(), organizationId, String(row.transfer_id));
      return undefined;
    }
    return proposal;
  }

  private proposeOwnershipTransfer(
    organizationId: string,
    value: unknown,
    authenticatedNodeId: string,
  ): { organizationId: string; transferId: string; status: "PENDING" } {
    const { proposal } = proposeOwnershipTransferSchema.parse(value);
    const directory = this.organizationDirectory(organizationId);
    this.assertOrganizationActive(directory);
    const owner = this.organizationMemberForNode(
      directory,
      authenticatedNodeId,
    );
    if (
      owner === undefined ||
      owner.status !== "ACTIVE" ||
      owner.role !== "OWNER"
    ) {
      throw new HttpError(403, "ORGANIZATION_OWNER_REQUIRED");
    }
    if (
      proposal.organizationId !== organizationId ||
      proposal.previousOwnerCertificate.membershipId !== owner.membershipId
    ) {
      throw new HttpError(400, "OWNERSHIP_TRANSFER_MISMATCH");
    }
    const proposedAt = Date.parse(proposal.proposedAt);
    const expiresAt = Date.parse(proposal.expiresAt);
    if (
      Math.abs(Date.now() - proposedAt) > 5 * 60_000 ||
      expiresAt <= Date.now() ||
      expiresAt - proposedAt > 7 * 24 * 60 * 60_000
    ) {
      throw new HttpError(400, "OWNERSHIP_TRANSFER_EXPIRY_INVALID");
    }
    try {
      verifyOrganizationOwnershipTransferProposal(
        directory.document,
        directory.members,
        directory.revision,
        proposal,
      );
    } catch (error) {
      throw new HttpError(
        400,
        "OWNERSHIP_TRANSFER_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
    const existing = this.#db
      .prepare(
        "SELECT proposal_json, status FROM relay_organization_owner_transfers WHERE organization_id = ? AND transfer_id = ?",
      )
      .get(organizationId, proposal.transferId) as SqlRow | undefined;
    if (existing !== undefined) {
      if (
        existing.status === "PENDING" &&
        String(existing.proposal_json) === JSON.stringify(proposal)
      ) {
        return {
          organizationId,
          transferId: proposal.transferId,
          status: "PENDING",
        };
      }
      throw new HttpError(409, "OWNERSHIP_TRANSFER_CONFLICT");
    }
    if (this.pendingOwnershipTransfer(organizationId, directory.revision)) {
      throw new HttpError(409, "OWNERSHIP_TRANSFER_ALREADY_PENDING");
    }
    this.#db
      .prepare(
        `
        INSERT INTO relay_organization_owner_transfers(
          organization_id, transfer_id, proposal_json, status,
          proposed_at, expires_at
        ) VALUES (?, ?, ?, 'PENDING', ?, ?)
      `,
      )
      .run(
        organizationId,
        proposal.transferId,
        JSON.stringify(proposal),
        proposal.proposedAt,
        proposal.expiresAt,
      );
    return {
      organizationId,
      transferId: proposal.transferId,
      status: "PENDING",
    };
  }

  private acceptOwnershipTransfer(
    organizationId: string,
    transferId: string,
    value: unknown,
    authenticatedNodeId: string,
  ): { organizationId: string; transferId: string; revision: number } {
    const acceptance = acceptOwnershipTransferSchema.parse(value);
    const row = this.#db
      .prepare(
        "SELECT proposal_json, status FROM relay_organization_owner_transfers WHERE organization_id = ? AND transfer_id = ?",
      )
      .get(organizationId, transferId) as SqlRow | undefined;
    if (row === undefined) {
      throw new HttpError(404, "OWNERSHIP_TRANSFER_NOT_FOUND");
    }
    if (row.status !== "PENDING") {
      throw new HttpError(409, "OWNERSHIP_TRANSFER_ALREADY_RESOLVED");
    }
    const proposal = organizationOwnershipTransferProposalSchema.parse(
      JSON.parse(String(row.proposal_json)) as unknown,
    );
    if (
      proposal.newOwnerCertificate.nodeId !== authenticatedNodeId ||
      proposal.transferId !== transferId
    ) {
      throw new HttpError(403, "OWNERSHIP_TRANSFER_TARGET_REQUIRED");
    }
    const directory = this.organizationDirectory(organizationId);
    this.assertOrganizationActive(directory);
    if (
      proposal.organizationRevision !== directory.revision + 1 ||
      Date.parse(proposal.expiresAt) <= Date.now()
    ) {
      this.#db
        .prepare(
          "UPDATE relay_organization_owner_transfers SET status = 'STALE', resolved_at = ? WHERE organization_id = ? AND transfer_id = ? AND status = 'PENDING'",
        )
        .run(new Date().toISOString(), organizationId, transferId);
      throw new HttpError(409, "OWNERSHIP_TRANSFER_STALE");
    }
    if (
      Math.abs(Date.now() - Date.parse(acceptance.acceptedAt)) > 5 * 60_000 ||
      Date.parse(acceptance.acceptedAt) > Date.parse(proposal.expiresAt)
    ) {
      throw new HttpError(400, "OWNERSHIP_TRANSFER_ACCEPTANCE_EXPIRED");
    }
    const event: OrganizationOwnershipTransferEvent =
      organizationOwnershipTransferEventSchema.parse({
        ...proposal,
        ...acceptance,
      });
    try {
      applyOrganizationDirectoryEvent(
        directory.document,
        directory.members,
        directory.revision,
        event,
      );
    } catch (error) {
      throw new HttpError(
        400,
        "OWNERSHIP_TRANSFER_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.insertOrganizationEventUnsafe(event);
      const resolved = this.#db
        .prepare(
          "UPDATE relay_organization_owner_transfers SET status = 'ACCEPTED', resolved_at = ? WHERE organization_id = ? AND transfer_id = ? AND status = 'PENDING'",
        )
        .run(new Date().toISOString(), organizationId, transferId);
      if (resolved.changes !== 1) {
        throw new HttpError(409, "OWNERSHIP_TRANSFER_ALREADY_RESOLVED");
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return {
      organizationId,
      transferId,
      revision: event.organizationRevision,
    };
  }

  private declineOwnershipTransfer(
    organizationId: string,
    transferId: string,
    authenticatedNodeId: string,
  ): {
    organizationId: string;
    transferId: string;
    status: "CANCELED" | "REJECTED";
  } {
    const row = this.#db
      .prepare(
        "SELECT proposal_json, status FROM relay_organization_owner_transfers WHERE organization_id = ? AND transfer_id = ?",
      )
      .get(organizationId, transferId) as SqlRow | undefined;
    if (row === undefined) {
      throw new HttpError(404, "OWNERSHIP_TRANSFER_NOT_FOUND");
    }
    if (row.status !== "PENDING") {
      throw new HttpError(409, "OWNERSHIP_TRANSFER_ALREADY_RESOLVED");
    }
    const proposal = organizationOwnershipTransferProposalSchema.parse(
      JSON.parse(String(row.proposal_json)) as unknown,
    );
    const status =
      proposal.previousOwnerCertificate.nodeId === authenticatedNodeId
        ? "CANCELED"
        : proposal.newOwnerCertificate.nodeId === authenticatedNodeId
          ? "REJECTED"
          : undefined;
    if (status === undefined) {
      throw new HttpError(403, "OWNERSHIP_TRANSFER_PARTICIPANT_REQUIRED");
    }
    this.#db
      .prepare(
        "UPDATE relay_organization_owner_transfers SET status = ?, resolved_at = ? WHERE organization_id = ? AND transfer_id = ? AND status = 'PENDING'",
      )
      .run(status, new Date().toISOString(), organizationId, transferId);
    return { organizationId, transferId, status };
  }

  private renameOrganization(
    organizationId: string,
    value: unknown,
    authenticatedNodeId: string,
  ): { organizationId: string; revision: number; name: string } {
    const { event } = renameOrganizationSchema.parse(value);
    const directory = this.organizationDirectory(organizationId);
    this.assertOrganizationActive(directory);
    const owner = this.organizationMemberForNode(
      directory,
      authenticatedNodeId,
    );
    if (
      owner === undefined ||
      owner.status !== "ACTIVE" ||
      owner.role !== "OWNER"
    ) {
      throw new HttpError(403, "ORGANIZATION_OWNER_REQUIRED");
    }
    if (
      event.organizationId !== organizationId ||
      event.issuer.membershipId !== owner.membershipId ||
      event.issuer.nodeId !== authenticatedNodeId
    ) {
      throw new HttpError(400, "ORGANIZATION_RENAME_MISMATCH");
    }
    let name: string;
    try {
      name =
        applyOrganizationDirectoryEvent(
          directory.document,
          directory.members,
          directory.revision,
          event,
          directory.name,
        ) ?? directory.name;
    } catch (error) {
      throw new HttpError(
        400,
        "ORGANIZATION_RENAME_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.insertOrganizationEventUnsafe(event);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { organizationId, revision: event.organizationRevision, name };
  }

  private dissolveOrganization(
    organizationId: string,
    value: unknown,
    authenticatedNodeId: string,
  ): { organizationId: string; revision: number; dissolvedAt: string } {
    const { event } = dissolveOrganizationSchema.parse(value);
    const directory = this.organizationDirectory(organizationId);
    this.assertOrganizationActive(directory);
    const owner = this.organizationMemberForNode(
      directory,
      authenticatedNodeId,
    );
    if (
      owner === undefined ||
      owner.status !== "ACTIVE" ||
      owner.role !== "OWNER"
    ) {
      throw new HttpError(403, "ORGANIZATION_OWNER_REQUIRED");
    }
    if (
      event.organizationId !== organizationId ||
      event.issuer.membershipId !== owner.membershipId ||
      event.issuer.nodeId !== authenticatedNodeId
    ) {
      throw new HttpError(400, "ORGANIZATION_DISSOLUTION_MISMATCH");
    }
    if (Math.abs(Date.now() - Date.parse(event.dissolvedAt)) > 5 * 60_000) {
      throw new HttpError(400, "ORGANIZATION_DISSOLUTION_EXPIRED");
    }
    try {
      applyOrganizationDirectoryEvent(
        directory.document,
        directory.members,
        directory.revision,
        event,
        directory.name,
      );
    } catch (error) {
      throw new HttpError(
        400,
        "ORGANIZATION_DISSOLUTION_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
    const now = new Date().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.insertOrganizationEventUnsafe(event);
      this.#db
        .prepare(
          "UPDATE relay_organization_invites SET revoked_at = coalesce(revoked_at, ?) WHERE organization_id = ? AND used_by_request_id IS NULL",
        )
        .run(now, organizationId);
      this.#db
        .prepare(
          "UPDATE relay_organization_join_requests SET status = 'REJECTED', resolved_at = coalesce(resolved_at, ?) WHERE organization_id = ? AND status = 'PENDING'",
        )
        .run(now, organizationId);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return {
      organizationId,
      revision: event.organizationRevision,
      dissolvedAt: event.dissolvedAt,
    };
  }

  private insertOrganizationEventUnsafe(
    event: OrganizationDirectoryEvent,
  ): void {
    const membershipId =
      "transferId" in event
        ? event.newOwnerCertificate.membershipId
        : "eventId" in event
          ? event.eventId
          : event.membershipId;
    const memberRevision =
      "transferId" in event
        ? event.newOwnerCertificate.memberRevision
        : "eventId" in event
          ? 1
          : event.memberRevision;
    const nodeId =
      "transferId" in event
        ? event.newOwnerCertificate.nodeId
        : "eventId" in event
          ? event.issuer.nodeId
          : event.nodeId;
    const issuedAt =
      "transferId" in event
        ? event.acceptedAt
        : "kind" in event && event.kind === "ORGANIZATION_RENAME"
          ? event.renamedAt
          : "kind" in event && event.kind === "ORGANIZATION_DISSOLVED"
            ? event.dissolvedAt
            : event.issuedAt;
    this.#db
      .prepare(
        `
        INSERT INTO relay_organization_events(
          organization_id, organization_revision, membership_id,
          member_revision, node_id, certificate_json, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        event.organizationId,
        event.organizationRevision,
        membershipId,
        memberRevision,
        nodeId,
        JSON.stringify(event),
        issuedAt,
      );
    const upsertMember = this.#db.prepare(
      `
        INSERT INTO relay_organization_members(
          organization_id, membership_id, node_id, display_name, public_key,
          role, status, organization_revision, member_revision, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, membership_id) DO UPDATE SET
          display_name = excluded.display_name,
          role = excluded.role,
          status = excluded.status,
          organization_revision = excluded.organization_revision,
          member_revision = excluded.member_revision,
          issued_at = excluded.issued_at
      `,
    );
    const members =
      "transferId" in event
        ? [event.previousOwnerCertificate, event.newOwnerCertificate]
        : "eventId" in event
          ? []
          : [event];
    for (const certificate of members) {
      upsertMember.run(
        certificate.organizationId,
        certificate.membershipId,
        certificate.nodeId,
        certificate.displayName,
        certificate.publicKey,
        certificate.role,
        certificate.status,
        certificate.organizationRevision,
        certificate.memberRevision,
        certificate.issuedAt,
      );
    }
    this.#db
      .prepare(
        "UPDATE relay_organizations SET revision = ?, updated_at = ? WHERE organization_id = ?",
      )
      .run(
        event.organizationRevision,
        new Date().toISOString(),
        event.organizationId,
      );
    if ("transferId" in event) {
      this.#db
        .prepare(
          "UPDATE relay_organizations SET owner_membership_id = ? WHERE organization_id = ?",
        )
        .run(event.newOwnerCertificate.membershipId, event.organizationId);
      this.#db
        .prepare(
          "UPDATE relay_organization_owner_transfers SET status = 'STALE', resolved_at = ? WHERE organization_id = ? AND status = 'PENDING' AND transfer_id <> ?",
        )
        .run(new Date().toISOString(), event.organizationId, event.transferId);
    } else {
      if ("kind" in event && event.kind === "ORGANIZATION_RENAME") {
        this.#db
          .prepare(
            "UPDATE relay_organizations SET name = ? WHERE organization_id = ?",
          )
          .run(event.name, event.organizationId);
      }
      if ("kind" in event && event.kind === "ORGANIZATION_DISSOLVED") {
        this.#db
          .prepare(
            "UPDATE relay_organizations SET dissolved_at = ? WHERE organization_id = ?",
          )
          .run(event.dissolvedAt, event.organizationId);
      }
      this.#db
        .prepare(
          "UPDATE relay_organization_owner_transfers SET status = 'STALE', resolved_at = ? WHERE organization_id = ? AND status = 'PENDING'",
        )
        .run(new Date().toISOString(), event.organizationId);
    }
  }

  private createOrganization(
    value: unknown,
    authenticatedNodeId: string,
    authenticatedPublicKey: string,
  ): { organizationId: string; revision: number } {
    const input = createOrganizationSchema.parse(value);
    const document = verifyOrganizationDocument(input.document);
    const verified = verifyOrganizationDirectory(document, [
      input.ownerCertificate,
    ]);
    const owner = verified.members.get(document.ownerMembershipId);
    if (
      owner === undefined ||
      owner.nodeId !== authenticatedNodeId ||
      owner.publicKey !== authenticatedPublicKey
    ) {
      throw new HttpError(403, "ORGANIZATION_OWNER_MISMATCH");
    }
    const existing = this.#db
      .prepare(
        "SELECT document_json, revision FROM relay_organizations WHERE organization_id = ?",
      )
      .get(document.organizationId) as SqlRow | undefined;
    if (existing !== undefined) {
      if (String(existing.document_json) !== JSON.stringify(document)) {
        throw new HttpError(409, "ORGANIZATION_ID_CONFLICT");
      }
      return {
        organizationId: document.organizationId,
        revision: Number(existing.revision),
      };
    }
    const now = new Date().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare(
          `
          INSERT INTO relay_organizations(
            organization_id, name, document_json, authority_id,
            owner_membership_id, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        `,
        )
        .run(
          document.organizationId,
          document.name,
          JSON.stringify(document),
          document.authorityId,
          document.ownerMembershipId,
          document.createdAt,
          now,
        );
      this.insertOrganizationEventUnsafe(input.ownerCertificate);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { organizationId: document.organizationId, revision: 1 };
  }

  private organizationBundles(nodeId: string): OrganizationDirectoryBundle[] {
    const ids = (
      this.#db
        .prepare(
          `
          SELECT organization_id FROM relay_organization_members
          WHERE node_id = ?
          UNION
          SELECT organization_id FROM relay_organization_join_requests
          WHERE node_id = ? AND status = 'PENDING'
          ORDER BY organization_id
        `,
        )
        .all(nodeId, nodeId) as SqlRow[]
    ).map((row) => String(row.organization_id));
    return ids.map((organizationId) => {
      const directory = this.organizationDirectory(organizationId);
      const selfMember = this.organizationMemberForNode(directory, nodeId);
      const selfPending = this.#db
        .prepare(
          "SELECT request_json FROM relay_organization_join_requests WHERE organization_id = ? AND node_id = ? AND status = 'PENDING'",
        )
        .get(organizationId, nodeId) as SqlRow | undefined;
      const mayManage =
        selfMember?.status === "ACTIVE" &&
        ["OWNER", "ADMIN"].includes(selfMember.role);
      const pendingJoinRequests = mayManage
        ? (
            this.#db
              .prepare(
                "SELECT request_json FROM relay_organization_join_requests WHERE organization_id = ? AND status = 'PENDING' ORDER BY requested_at, request_id",
              )
              .all(organizationId) as SqlRow[]
          ).map((row) =>
            organizationJoinRequestSchema.parse(
              JSON.parse(String(row.request_json)) as unknown,
            ),
          )
        : selfPending === undefined
          ? []
          : [
              organizationJoinRequestSchema.parse(
                JSON.parse(String(selfPending.request_json)) as unknown,
              ),
            ];
      const selfStatus =
        selfMember === undefined
          ? "PENDING"
          : selfMember.status === "ACTIVE"
            ? "ACTIVE"
            : "DISABLED";
      const pendingOwnerTransfer =
        selfMember?.status === "ACTIVE"
          ? this.pendingOwnershipTransfer(organizationId, directory.revision)
          : undefined;
      const relevantOwnerTransfer =
        pendingOwnerTransfer !== undefined &&
        [
          pendingOwnerTransfer.previousOwnerCertificate.membershipId,
          pendingOwnerTransfer.newOwnerCertificate.membershipId,
        ].includes(selfMember?.membershipId ?? "")
          ? pendingOwnerTransfer
          : undefined;
      return organizationDirectoryBundleSchema.parse({
        document: directory.document,
        revision: directory.revision,
        events: directory.events,
        selfStatus,
        pendingJoinRequests,
        ...(relevantOwnerTransfer === undefined
          ? {}
          : { pendingOwnerTransfer: relevantOwnerTransfer }),
      });
    });
  }

  private createOrganizationInvitation(
    organizationId: string,
    value: unknown,
    authenticatedNodeId: string,
  ): { invitation: string; invitationId: string; expiresAt: string } {
    const input = createOrganizationInvitationSchema.parse(value);
    const directory = this.organizationDirectory(organizationId);
    const manager = this.assertOrganizationManager(
      directory,
      authenticatedNodeId,
    );
    const expiresAt = new Date(
      Date.now() + input.expiresInMinutes * 60_000,
    ).toISOString();
    const created = this.insertOrganizationInvitation(
      organizationId,
      manager.membershipId,
      expiresAt,
    );
    return { ...created, expiresAt };
  }

  private organizationInvitationView(row: SqlRow): OrganizationInvitationView {
    const usedAt =
      row.used_at === null || row.used_at === undefined
        ? undefined
        : String(row.used_at);
    const revokedAt =
      row.revoked_at === null || row.revoked_at === undefined
        ? undefined
        : String(row.revoked_at);
    const status =
      revokedAt !== undefined
        ? "REVOKED"
        : row.used_by_request_id !== null &&
            row.used_by_request_id !== undefined
          ? "USED"
          : Date.parse(String(row.expires_at)) <= Date.now()
            ? "EXPIRED"
            : "ACTIVE";
    return organizationInvitationViewSchema.parse({
      invitationId: row.invitation_id,
      organizationId: row.organization_id,
      createdByMembershipId: row.created_by_membership_id,
      status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      ...(usedAt === undefined ? {} : { usedAt }),
      ...(revokedAt === undefined ? {} : { revokedAt }),
    });
  }

  private organizationInvitations(
    organizationId: string,
    authenticatedNodeId: string,
  ): OrganizationInvitationView[] {
    const directory = this.organizationDirectory(organizationId);
    this.assertOrganizationManager(directory, authenticatedNodeId);
    return (
      this.#db
        .prepare(
          `SELECT invitation_id, organization_id, created_by_membership_id,
                  expires_at, used_by_request_id, used_at, revoked_at, created_at
             FROM relay_organization_invites
            WHERE organization_id = ?
            ORDER BY created_at DESC, invitation_id DESC
            LIMIT 200`,
        )
        .all(organizationId) as SqlRow[]
    ).map((row) => this.organizationInvitationView(row));
  }

  private revokeOrganizationInvitation(
    organizationId: string,
    invitationId: string,
    authenticatedNodeId: string,
  ): OrganizationInvitationView {
    const directory = this.organizationDirectory(organizationId);
    this.assertOrganizationManager(directory, authenticatedNodeId);
    const row = this.#db
      .prepare(
        "SELECT * FROM relay_organization_invites WHERE organization_id = ? AND invitation_id = ?",
      )
      .get(organizationId, invitationId) as SqlRow | undefined;
    if (row === undefined) {
      throw new HttpError(404, "ORGANIZATION_INVITATION_NOT_FOUND");
    }
    const current = this.organizationInvitationView(row);
    if (current.status === "REVOKED") return current;
    if (current.status === "USED") {
      throw new HttpError(409, "ORGANIZATION_INVITATION_ALREADY_USED");
    }
    if (current.status === "EXPIRED") {
      throw new HttpError(410, "ORGANIZATION_INVITATION_EXPIRED");
    }
    const revokedAt = new Date().toISOString();
    this.#db
      .prepare(
        "UPDATE relay_organization_invites SET revoked_at = ? WHERE organization_id = ? AND invitation_id = ? AND revoked_at IS NULL AND used_by_request_id IS NULL",
      )
      .run(revokedAt, organizationId, invitationId);
    return organizationInvitationViewSchema.parse({
      ...current,
      status: "REVOKED",
      revokedAt,
    });
  }

  private insertEnrollmentInvitation(
    expiresAt: string,
    createdByNodeId: string,
  ): string {
    const invitation = `squad-relay-v1.${randomBytes(32).toString("base64url")}`;
    this.#db
      .prepare(
        `
        INSERT INTO relay_invites(
          token_hash, expires_at, created_at, created_by_node_id
        ) VALUES (?, ?, ?, ?)
      `,
      )
      .run(
        inviteHash(invitation),
        expiresAt,
        new Date().toISOString(),
        createdByNodeId,
      );
    return invitation;
  }

  private insertOrganizationInvitation(
    organizationId: string,
    createdByMembershipId: string,
    expiresAt: string,
  ): { invitation: string; invitationId: string } {
    const secret = randomBytes(32).toString("base64url");
    const invitation = organizationInvitation(organizationId, secret);
    const invitationId = randomUUID();
    this.#db
      .prepare(
        `
        INSERT INTO relay_organization_invites(
          token_hash, invitation_id, organization_id, created_by_membership_id,
          expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        inviteHash(invitation),
        invitationId,
        organizationId,
        createdByMembershipId,
        expiresAt,
        new Date().toISOString(),
      );
    return { invitation, invitationId };
  }

  private createOrganizationJoinPackage(
    organizationId: string,
    value: unknown,
    authenticatedNodeId: string,
  ): {
    enrollmentInvitation: string;
    organizationInvitation: string;
    expiresAt: string;
  } {
    const input = createOrganizationInvitationSchema.parse(value);
    const directory = this.organizationDirectory(organizationId);
    const manager = this.assertOrganizationManager(
      directory,
      authenticatedNodeId,
    );
    const expiresAt = new Date(
      Date.now() + input.expiresInMinutes * 60_000,
    ).toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const enrollmentInvitation = this.insertEnrollmentInvitation(
        expiresAt,
        authenticatedNodeId,
      );
      const { invitation: organizationInvitation } =
        this.insertOrganizationInvitation(
          organizationId,
          manager.membershipId,
          expiresAt,
        );
      this.#db.exec("COMMIT");
      return { enrollmentInvitation, organizationInvitation, expiresAt };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  private joinOrganization(
    value: unknown,
    authenticatedNodeId: string,
    authenticatedPublicKey: string,
  ): { organizationId: string; requestId: string; status: "PENDING" } {
    const input = joinOrganizationSchema.parse(value);
    const organizationId = organizationIdFromInvitation(input.invitation);
    const request = input.request;
    if (
      request.organizationId !== organizationId ||
      request.nodeId !== authenticatedNodeId ||
      request.publicKey !== authenticatedPublicKey ||
      nodeIdFromPublicKey(request.publicKey) !== request.nodeId ||
      !verifySignature(
        unsignedOrganizationJoinRequest(request),
        request.signature,
        request.publicKey,
      )
    ) {
      throw new HttpError(400, "INVALID_JOIN_REQUEST");
    }
    if (Math.abs(Date.now() - Date.parse(request.requestedAt)) > 5 * 60_000) {
      throw new HttpError(400, "JOIN_REQUEST_EXPIRED");
    }
    const directory = this.organizationDirectory(organizationId);
    this.assertOrganizationActive(directory);
    const existingMember = this.#db
      .prepare(
        "SELECT membership_id FROM relay_organization_members WHERE organization_id = ? AND node_id = ?",
      )
      .get(organizationId, authenticatedNodeId) as SqlRow | undefined;
    if (existingMember !== undefined) {
      throw new HttpError(409, "ALREADY_ORGANIZATION_MEMBER");
    }
    const existingRequest = this.#db
      .prepare(
        "SELECT request_id, request_json, status FROM relay_organization_join_requests WHERE organization_id = ? AND node_id = ?",
      )
      .get(organizationId, authenticatedNodeId) as SqlRow | undefined;
    if (existingRequest !== undefined) {
      if (
        existingRequest.status === "PENDING" &&
        String(existingRequest.request_json) === JSON.stringify(request)
      ) {
        return {
          organizationId,
          requestId: request.requestId,
          status: "PENDING",
        };
      }
      throw new HttpError(409, "JOIN_REQUEST_CONFLICT");
    }
    const invitation = this.#db
      .prepare(
        "SELECT organization_id, expires_at, used_by_request_id, revoked_at FROM relay_organization_invites WHERE token_hash = ?",
      )
      .get(inviteHash(input.invitation)) as SqlRow | undefined;
    if (
      invitation === undefined ||
      invitation.organization_id !== organizationId
    ) {
      throw new HttpError(403, "INVALID_ORGANIZATION_INVITATION");
    }
    if (invitation.used_by_request_id !== null) {
      throw new HttpError(409, "ORGANIZATION_INVITATION_ALREADY_USED");
    }
    if (invitation.revoked_at !== null) {
      throw new HttpError(410, "ORGANIZATION_INVITATION_REVOKED");
    }
    if (Date.parse(String(invitation.expires_at)) <= Date.now()) {
      throw new HttpError(410, "ORGANIZATION_INVITATION_EXPIRED");
    }
    const now = new Date().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare(
          `
          INSERT INTO relay_organization_join_requests(
            organization_id, request_id, membership_id, node_id,
            request_json, status, requested_at
          ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
        `,
        )
        .run(
          organizationId,
          request.requestId,
          request.membershipId,
          request.nodeId,
          JSON.stringify(request),
          request.requestedAt,
        );
      this.#db
        .prepare(
          "UPDATE relay_organization_invites SET used_by_request_id = ?, used_at = ? WHERE token_hash = ? AND used_by_request_id IS NULL",
        )
        .run(request.requestId, now, inviteHash(input.invitation));
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { organizationId, requestId: request.requestId, status: "PENDING" };
  }

  private approveOrganizationJoin(
    organizationId: string,
    requestId: string,
    value: unknown,
    authenticatedNodeId: string,
  ): { organizationId: string; revision: number } {
    const input = approveJoinRequestSchema.parse(value);
    const directory = this.organizationDirectory(organizationId);
    this.assertOrganizationActive(directory);
    const manager = this.assertOrganizationManager(
      directory,
      authenticatedNodeId,
    );
    const row = this.#db
      .prepare(
        "SELECT request_json, status FROM relay_organization_join_requests WHERE organization_id = ? AND request_id = ?",
      )
      .get(organizationId, requestId) as SqlRow | undefined;
    if (row === undefined) throw new HttpError(404, "JOIN_REQUEST_NOT_FOUND");
    if (row.status !== "PENDING") {
      throw new HttpError(409, "JOIN_REQUEST_ALREADY_RESOLVED");
    }
    const request = organizationJoinRequestSchema.parse(
      JSON.parse(String(row.request_json)) as unknown,
    );
    const certificate = input.certificate;
    if (
      certificate.organizationId !== organizationId ||
      certificate.membershipId !== request.membershipId ||
      certificate.nodeId !== request.nodeId ||
      certificate.publicKey !== request.publicKey ||
      certificate.displayName !== request.displayName ||
      certificate.role !== "MEMBER" ||
      certificate.status !== "ACTIVE" ||
      certificate.memberRevision !== 1 ||
      certificate.issuer.kind !== "MEMBER" ||
      certificate.issuer.membershipId !== manager.membershipId ||
      certificate.issuer.nodeId !== authenticatedNodeId
    ) {
      throw new HttpError(400, "JOIN_CERTIFICATE_MISMATCH");
    }
    applyOrganizationCertificate(
      directory.document,
      directory.members,
      directory.revision,
      certificate,
    );
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.insertOrganizationEventUnsafe(certificate);
      this.#db
        .prepare(
          "UPDATE relay_organization_join_requests SET status = 'APPROVED', resolved_at = ? WHERE organization_id = ? AND request_id = ?",
        )
        .run(new Date().toISOString(), organizationId, requestId);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { organizationId, revision: certificate.organizationRevision };
  }

  private rejectOrganizationJoin(
    organizationId: string,
    requestId: string,
    authenticatedNodeId: string,
  ): { organizationId: string; requestId: string; status: "REJECTED" } {
    const directory = this.organizationDirectory(organizationId);
    this.assertOrganizationManager(directory, authenticatedNodeId);
    const row = this.#db
      .prepare(
        "SELECT status FROM relay_organization_join_requests WHERE organization_id = ? AND request_id = ?",
      )
      .get(organizationId, requestId) as SqlRow | undefined;
    if (row === undefined) throw new HttpError(404, "JOIN_REQUEST_NOT_FOUND");
    if (row.status !== "PENDING") {
      throw new HttpError(409, "JOIN_REQUEST_ALREADY_RESOLVED");
    }
    this.#db
      .prepare(
        "UPDATE relay_organization_join_requests SET status = 'REJECTED', resolved_at = ? WHERE organization_id = ? AND request_id = ? AND status = 'PENDING'",
      )
      .run(new Date().toISOString(), organizationId, requestId);
    return { organizationId, requestId, status: "REJECTED" };
  }

  private updateOrganizationMember(
    organizationId: string,
    membershipId: string,
    value: unknown,
    authenticatedNodeId: string,
  ): { organizationId: string; revision: number } {
    const input = updateMemberCertificateSchema.parse(value);
    const directory = this.organizationDirectory(organizationId);
    const manager = this.assertOrganizationManager(
      directory,
      authenticatedNodeId,
    );
    const certificate = input.certificate;
    if (
      certificate.organizationId !== organizationId ||
      certificate.membershipId !== membershipId ||
      certificate.issuer.kind !== "MEMBER" ||
      certificate.issuer.membershipId !== manager.membershipId ||
      certificate.issuer.nodeId !== authenticatedNodeId
    ) {
      throw new HttpError(400, "MEMBER_CERTIFICATE_MISMATCH");
    }
    applyOrganizationCertificate(
      directory.document,
      directory.members,
      directory.revision,
      certificate,
    );
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.insertOrganizationEventUnsafe(certificate);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { organizationId, revision: certificate.organizationRevision };
  }

  private leaveOrganization(
    organizationId: string,
    value: unknown,
    authenticatedNodeId: string,
  ): { organizationId: string; revision: number; status: "DISABLED" } {
    const input = updateMemberCertificateSchema.parse(value);
    const directory = this.organizationDirectory(organizationId);
    this.assertOrganizationActive(directory);
    const member = this.organizationMemberForNode(
      directory,
      authenticatedNodeId,
    );
    if (member === undefined || member.status !== "ACTIVE") {
      throw new HttpError(403, "ORGANIZATION_MEMBERSHIP_REJECTED");
    }
    if (member.role === "OWNER") {
      throw new HttpError(409, "OWNER_TRANSFER_REQUIRED");
    }
    const certificate = input.certificate;
    if (
      certificate.organizationId !== organizationId ||
      certificate.membershipId !== member.membershipId ||
      certificate.nodeId !== authenticatedNodeId ||
      certificate.publicKey !== member.publicKey ||
      certificate.displayName !== member.displayName ||
      certificate.role !== member.role ||
      certificate.status !== "DISABLED" ||
      certificate.memberRevision !== member.memberRevision + 1 ||
      certificate.issuer.kind !== "MEMBER" ||
      certificate.issuer.membershipId !== member.membershipId ||
      certificate.issuer.nodeId !== authenticatedNodeId
    ) {
      throw new HttpError(400, "LEAVE_CERTIFICATE_MISMATCH");
    }
    applyOrganizationCertificate(
      directory.document,
      directory.members,
      directory.revision,
      certificate,
    );
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.insertOrganizationEventUnsafe(certificate);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return {
      organizationId,
      revision: certificate.organizationRevision,
      status: "DISABLED",
    };
  }

  private submit(
    value: unknown,
    authenticatedNodeId: string,
  ): {
    envelopeId: string;
    accepted: boolean;
  } {
    const envelope = envelopeSchema.parse(value);
    if (envelopePayloadBytes(envelope) > MAX_ENVELOPE_BYTES) {
      throw new HttpError(413, "ENVELOPE_TOO_LARGE");
    }
    if (envelope.senderNodeId !== authenticatedNodeId) {
      throw new HttpError(403, "SENDER_MISMATCH");
    }
    try {
      assertEnvelopeSemantics(envelope);
    } catch (error) {
      throw new HttpError(
        400,
        "INVALID_ENVELOPE_SEMANTICS",
        error instanceof Error ? error.message : "invalid envelope semantics",
      );
    }
    if (Date.parse(envelope.expiresAt) <= Date.now()) {
      throw new HttpError(410, "ENVELOPE_EXPIRED");
    }
    this.cleanupExpired();
    const sender = this.#db
      .prepare(
        "SELECT public_key FROM relay_nodes WHERE node_id = ? AND disabled_at IS NULL",
      )
      .get(envelope.senderNodeId) as SqlRow | undefined;
    const recipient = this.#db
      .prepare(
        "SELECT node_id, public_key FROM relay_nodes WHERE node_id = ? AND disabled_at IS NULL",
      )
      .get(envelope.recipientNodeId) as SqlRow | undefined;
    if (sender === undefined || recipient === undefined) {
      throw new HttpError(404, "NODE_NOT_FOUND");
    }
    if (envelope.protocolVersion === 2) {
      const organizationId = envelope.organizationId;
      const senderMembershipId = envelope.senderMembershipId;
      const recipientMembershipId = envelope.recipientMembershipId;
      if (
        organizationId === undefined ||
        senderMembershipId === undefined ||
        recipientMembershipId === undefined
      ) {
        throw new HttpError(400, "ORGANIZATION_ROUTING_REQUIRED");
      }
      const directory = this.organizationDirectory(organizationId);
      this.assertOrganizationActive(directory);
      const senderMember = directory.members.get(senderMembershipId);
      const recipientMember = directory.members.get(recipientMembershipId);
      if (
        senderMember?.status !== "ACTIVE" ||
        senderMember.nodeId !== envelope.senderNodeId ||
        senderMember.publicKey !== sender.public_key ||
        recipientMember?.status !== "ACTIVE" ||
        recipientMember.nodeId !== envelope.recipientNodeId ||
        recipientMember.publicKey !== recipient.public_key
      ) {
        throw new HttpError(403, "ORGANIZATION_MEMBERSHIP_REJECTED");
      }
    }
    if (
      !verifySignature(
        unsignedEnvelope(envelope),
        envelope.signature,
        String(sender.public_key),
      )
    ) {
      throw new HttpError(401, "INVALID_ENVELOPE_SIGNATURE");
    }
    const digest = sha256Hex(canonicalBytes(envelope));
    const existing = this.#db
      .prepare("SELECT digest FROM relay_envelopes WHERE envelope_id = ?")
      .get(envelope.envelopeId) as SqlRow | undefined;
    if (existing !== undefined) {
      if (existing.digest !== digest) {
        throw new HttpError(409, "ENVELOPE_ID_CONFLICT");
      }
      return { envelopeId: envelope.envelopeId, accepted: false };
    }
    const mailbox = this.#db
      .prepare(
        "SELECT count(*) AS count FROM relay_deliveries WHERE recipient_node_id = ? AND acknowledged_at IS NULL",
      )
      .get(envelope.recipientNodeId) as SqlRow;
    if (Number(mailbox.count) >= this.#maxMailboxItems) {
      throw new HttpError(429, "MAILBOX_FULL");
    }
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare(
          `
          INSERT INTO relay_envelopes(
            envelope_id, digest, sender_node_id, recipient_node_id, kind,
            envelope_json, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          envelope.envelopeId,
          digest,
          envelope.senderNodeId,
          envelope.recipientNodeId,
          envelope.kind,
          JSON.stringify(envelope),
          envelope.createdAt,
          envelope.expiresAt,
        );
      this.#db
        .prepare(
          "INSERT INTO relay_deliveries(envelope_id, recipient_node_id) VALUES (?, ?)",
        )
        .run(envelope.envelopeId, envelope.recipientNodeId);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    this.notifyMailbox(envelope.recipientNodeId, envelope.envelopeId);
    return { envelopeId: envelope.envelopeId, accepted: true };
  }

  private mailbox(
    nodeId: string,
    url: URL,
  ): {
    cursor: number;
    items: Array<{ cursor: number; envelope: Envelope }>;
  } {
    this.cleanupExpired();
    const requestedAfter = Number(url.searchParams.get("after") ?? "0");
    const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
    if (!Number.isSafeInteger(requestedAfter) || requestedAfter < 0) {
      throw new HttpError(400, "INVALID_CURSOR");
    }
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
      throw new HttpError(400, "INVALID_LIMIT");
    }
    const limit = Math.min(500, requestedLimit);
    const rows = this.#db
      .prepare(
        `
        SELECT e.sequence, e.envelope_json
        FROM relay_deliveries d
        JOIN relay_envelopes e ON e.envelope_id = d.envelope_id
        WHERE d.recipient_node_id = ? AND d.acknowledged_at IS NULL
          AND e.expires_at > ?
        ORDER BY e.sequence
        LIMIT ?
      `,
      )
      .all(nodeId, new Date().toISOString(), limit) as SqlRow[];
    const items = rows.map((row) => ({
      cursor: Number(row.sequence),
      envelope: envelopeSchema.parse(
        JSON.parse(String(row.envelope_json)) as unknown,
      ),
    }));
    return {
      cursor: Math.max(requestedAfter, ...items.map((item) => item.cursor)),
      items,
    };
  }

  private acknowledge(nodeId: string, envelopeId: string): void {
    const row = this.#db
      .prepare(
        "SELECT recipient_node_id FROM relay_deliveries WHERE envelope_id = ?",
      )
      .get(envelopeId) as SqlRow | undefined;
    if (row === undefined) throw new HttpError(404, "ENVELOPE_NOT_FOUND");
    if (row.recipient_node_id !== nodeId) {
      throw new HttpError(403, "MAILBOX_FORBIDDEN");
    }
    this.#db
      .prepare(
        "UPDATE relay_deliveries SET acknowledged_at = coalesce(acknowledged_at, ?) WHERE envelope_id = ?",
      )
      .run(new Date().toISOString(), envelopeId);
  }

  private nodes(requesterNodeId: string): Array<{
    nodeId: string;
    displayName: string;
    publicKey: string;
  }> {
    return (
      this.#db
        .prepare(
          `
          SELECT DISTINCT n.node_id, n.display_name, n.public_key
          FROM relay_nodes n
          WHERE n.disabled_at IS NULL
            AND (
              n.node_id = ?
              OR EXISTS (
                SELECT 1
                FROM relay_organization_members self
                JOIN relay_organization_members teammate
                  ON teammate.organization_id = self.organization_id
                JOIN relay_organizations organization
                  ON organization.organization_id = self.organization_id
                 AND organization.dissolved_at IS NULL
                WHERE self.node_id = ?
                  AND self.status = 'ACTIVE'
                  AND teammate.node_id = n.node_id
                  AND teammate.status = 'ACTIVE'
              )
            )
          ORDER BY lower(n.display_name), n.node_id
        `,
        )
        .all(requesterNodeId, requesterNodeId) as SqlRow[]
    ).map((row) => ({
      nodeId: String(row.node_id),
      displayName: String(row.display_name),
      publicKey: String(row.public_key),
    }));
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const base = `http://${req.headers.host ?? "localhost"}`;
    const url = new URL(req.url ?? "/", base);
    const path = `${url.pathname}${url.search}`;
    try {
      if (req.method === "GET" && url.pathname === "/squad/v1/health") {
        reply(res, 200, { ok: true, protocolVersions: [1, 2] });
        return true;
      }
      if (req.method === "POST" && url.pathname === "/squad/v1/enrollment") {
        const body = await readBody(req, 32 * 1024);
        reply(res, 200, this.enroll(jsonBody(body)));
        return true;
      }
      if (req.method === "POST" && url.pathname === "/squad/v1/envelopes") {
        const body = await readBody(req, MAX_ENVELOPE_BYTES + 1_024);
        const auth = this.authenticate(req, path, body);
        reply(res, 200, this.submit(jsonBody(body), auth.nodeId));
        return true;
      }
      if (req.method === "GET" && url.pathname === "/squad/v1/mailbox") {
        const auth = this.authenticate(req, path, Buffer.alloc(0));
        reply(res, 200, this.mailbox(auth.nodeId, url));
        return true;
      }
      if (req.method === "GET" && url.pathname === "/squad/v1/mailbox/events") {
        const auth = this.authenticate(req, path, Buffer.alloc(0));
        this.streamMailbox(req, res, auth.nodeId);
        return true;
      }
      if (req.method === "GET" && url.pathname === "/squad/v1/nodes") {
        const auth = this.authenticate(req, path, Buffer.alloc(0));
        reply(res, 200, { nodes: this.nodes(auth.nodeId) });
        return true;
      }
      if (req.method === "POST" && url.pathname === "/squad/v1/organizations") {
        const body = await readBody(req, 128 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          201,
          this.createOrganization(jsonBody(body), auth.nodeId, auth.publicKey),
        );
        return true;
      }
      if (req.method === "GET" && url.pathname === "/squad/v1/organizations") {
        const auth = this.authenticate(req, path, Buffer.alloc(0));
        reply(res, 200, {
          organizations: this.organizationBundles(auth.nodeId),
        });
        return true;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/squad/v1/organizations/join"
      ) {
        const body = await readBody(req, 64 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          202,
          this.joinOrganization(jsonBody(body), auth.nodeId, auth.publicKey),
        );
        return true;
      }
      const organizationInvitationRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/invitations$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        organizationInvitationRoute?.[1] !== undefined
      ) {
        const body = await readBody(req, 8 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          201,
          this.createOrganizationInvitation(
            organizationInvitationRoute[1],
            jsonBody(body),
            auth.nodeId,
          ),
        );
        return true;
      }
      if (
        req.method === "GET" &&
        organizationInvitationRoute?.[1] !== undefined
      ) {
        const auth = this.authenticate(req, path, Buffer.alloc(0));
        reply(res, 200, {
          invitations: this.organizationInvitations(
            organizationInvitationRoute[1],
            auth.nodeId,
          ),
        });
        return true;
      }
      const revokeOrganizationInvitationRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/invitations\/([0-9a-f-]{36})$/u.exec(
          url.pathname,
        );
      if (
        req.method === "DELETE" &&
        revokeOrganizationInvitationRoute?.[1] !== undefined &&
        revokeOrganizationInvitationRoute[2] !== undefined
      ) {
        const auth = this.authenticate(req, path, Buffer.alloc(0));
        reply(
          res,
          200,
          this.revokeOrganizationInvitation(
            revokeOrganizationInvitationRoute[1],
            revokeOrganizationInvitationRoute[2],
            auth.nodeId,
          ),
        );
        return true;
      }
      const organizationJoinPackageRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/join-packages$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        organizationJoinPackageRoute?.[1] !== undefined
      ) {
        const body = await readBody(req, 8 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          201,
          this.createOrganizationJoinPackage(
            organizationJoinPackageRoute[1],
            jsonBody(body),
            auth.nodeId,
          ),
        );
        return true;
      }
      const approveOrganizationJoinRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/join-requests\/([0-9a-f-]{36})\/approve$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        approveOrganizationJoinRoute?.[1] !== undefined &&
        approveOrganizationJoinRoute[2] !== undefined
      ) {
        const body = await readBody(req, 64 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          200,
          this.approveOrganizationJoin(
            approveOrganizationJoinRoute[1],
            approveOrganizationJoinRoute[2],
            jsonBody(body),
            auth.nodeId,
          ),
        );
        return true;
      }
      const rejectOrganizationJoinRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/join-requests\/([0-9a-f-]{36})\/reject$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        rejectOrganizationJoinRoute?.[1] !== undefined &&
        rejectOrganizationJoinRoute[2] !== undefined
      ) {
        const body = await readBody(req, 1_024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          200,
          this.rejectOrganizationJoin(
            rejectOrganizationJoinRoute[1],
            rejectOrganizationJoinRoute[2],
            auth.nodeId,
          ),
        );
        return true;
      }
      const renameOrganizationRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/name$/u.exec(
          url.pathname,
        );
      if (req.method === "POST" && renameOrganizationRoute?.[1] !== undefined) {
        const body = await readBody(req, 32 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          200,
          this.renameOrganization(
            renameOrganizationRoute[1],
            jsonBody(body),
            auth.nodeId,
          ),
        );
        return true;
      }
      const dissolveOrganizationRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/dissolve$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        dissolveOrganizationRoute?.[1] !== undefined
      ) {
        const body = await readBody(req, 32 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          200,
          this.dissolveOrganization(
            dissolveOrganizationRoute[1],
            jsonBody(body),
            auth.nodeId,
          ),
        );
        return true;
      }
      const ownershipTransferCollectionRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/owner-transfers$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        ownershipTransferCollectionRoute?.[1] !== undefined
      ) {
        const body = await readBody(req, 128 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          202,
          this.proposeOwnershipTransfer(
            ownershipTransferCollectionRoute[1],
            jsonBody(body),
            auth.nodeId,
          ),
        );
        return true;
      }
      const acceptOwnershipTransferRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/owner-transfers\/([0-9a-f-]{36})\/accept$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        acceptOwnershipTransferRoute?.[1] !== undefined &&
        acceptOwnershipTransferRoute[2] !== undefined
      ) {
        const body = await readBody(req, 16 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          200,
          this.acceptOwnershipTransfer(
            acceptOwnershipTransferRoute[1],
            acceptOwnershipTransferRoute[2],
            jsonBody(body),
            auth.nodeId,
          ),
        );
        return true;
      }
      const declineOwnershipTransferRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/owner-transfers\/([0-9a-f-]{36})$/u.exec(
          url.pathname,
        );
      if (
        req.method === "DELETE" &&
        declineOwnershipTransferRoute?.[1] !== undefined &&
        declineOwnershipTransferRoute[2] !== undefined
      ) {
        const auth = this.authenticate(req, path, Buffer.alloc(0));
        reply(
          res,
          200,
          this.declineOwnershipTransfer(
            declineOwnershipTransferRoute[1],
            declineOwnershipTransferRoute[2],
            auth.nodeId,
          ),
        );
        return true;
      }
      const organizationMemberRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})\/certificate$/u.exec(
          url.pathname,
        );
      if (
        req.method === "POST" &&
        organizationMemberRoute?.[1] !== undefined &&
        organizationMemberRoute[2] !== undefined
      ) {
        const body = await readBody(req, 64 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          200,
          this.updateOrganizationMember(
            organizationMemberRoute[1],
            organizationMemberRoute[2],
            jsonBody(body),
            auth.nodeId,
          ),
        );
        return true;
      }
      const leaveOrganizationRoute =
        /^\/squad\/v1\/organizations\/([0-9a-f-]{36})\/leave$/u.exec(
          url.pathname,
        );
      if (req.method === "POST" && leaveOrganizationRoute?.[1] !== undefined) {
        const body = await readBody(req, 64 * 1024);
        const auth = this.authenticate(req, path, body);
        reply(
          res,
          200,
          this.leaveOrganization(
            leaveOrganizationRoute[1],
            jsonBody(body),
            auth.nodeId,
          ),
        );
        return true;
      }
      const ack = /^\/squad\/v1\/envelopes\/([0-9a-f-]{36})\/ack$/u.exec(
        url.pathname,
      );
      if (req.method === "POST" && ack?.[1] !== undefined) {
        const body = await readBody(req, 1_024);
        const auth = this.authenticate(req, path, body);
        this.acknowledge(auth.nodeId, ack[1]);
        reply(res, 200, { acknowledged: true });
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof HttpError) {
        reply(res, error.status, {
          error: { code: error.code, message: error.message },
        });
      } else if (error instanceof z.ZodError) {
        reply(res, 400, {
          error: {
            code: "INVALID_REQUEST",
            message: "request schema rejected",
          },
        });
      } else {
        reply(res, 500, {
          error: { code: "INTERNAL", message: "relay request failed" },
        });
      }
      return true;
    }
  }
}

export interface AuthenticatedRequest {
  headers: Record<string, string>;
  body: Buffer;
}

export function signedRequest(
  identity: { nodeId: string; sign(value: unknown): string },
  method: string,
  path: string,
  value?: unknown,
): AuthenticatedRequest {
  const body =
    value === undefined
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(value), "utf8");
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const signed = {
    method,
    path,
    nodeId: identity.nodeId,
    timestamp,
    nonce,
    bodySha256: sha256Hex(body),
  };
  return {
    body,
    headers: {
      "x-squad-node-id": identity.nodeId,
      "x-squad-timestamp": timestamp,
      "x-squad-nonce": nonce,
      "x-squad-signature": identity.sign(signed),
      ...(value === undefined ? {} : { "content-type": "application/json" }),
    },
  };
}
