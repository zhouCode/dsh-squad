import { createHash, randomUUID } from "node:crypto";
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
  type Envelope,
} from "../shared/contracts.ts";
import { nodeIdFromPublicKey, verifySignature } from "./identity.ts";
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

type SqlRow = Record<string, unknown>;

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
        used_at TEXT
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
    `);
  }

  private seedInvite(invite: RelayInviteConfig): void {
    const expires = Date.parse(invite.expiresAt);
    if (!Number.isFinite(expires))
      throw new Error("relay invite has invalid expiresAt");
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO relay_invites(token_hash, expires_at) VALUES (?, ?)",
      )
      .run(inviteHash(invite.token), new Date(expires).toISOString());
  }

  private cleanupExpired(now = new Date().toISOString()): void {
    this.#db
      .prepare("DELETE FROM relay_envelopes WHERE expires_at <= ?")
      .run(now);
    this.#db.prepare("DELETE FROM relay_nonces WHERE expires_at <= ?").run(now);
  }

  close(): void {
    this.#db.close();
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
    if (existing !== undefined) {
      if (existing.public_key !== input.publicKey) {
        throw new HttpError(409, "NODE_ID_CONFLICT");
      }
      return { nodeId: input.nodeId, enrolled: false };
    }
    const hash = inviteHash(input.invitation);
    const invite = this.#db
      .prepare(
        "SELECT expires_at, used_by_node_id FROM relay_invites WHERE token_hash = ?",
      )
      .get(hash) as SqlRow | undefined;
    if (invite === undefined) throw new HttpError(403, "INVALID_INVITATION");
    if (invite.used_by_node_id !== null) {
      throw new HttpError(409, "INVITATION_ALREADY_USED");
    }
    if (Date.parse(String(invite.expires_at)) <= Date.now()) {
      throw new HttpError(410, "INVITATION_EXPIRED");
    }
    const now = new Date().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare(
          "INSERT INTO relay_nodes(node_id, display_name, public_key, enrolled_at) VALUES (?, ?, ?, ?)",
        )
        .run(input.nodeId, input.displayName, input.publicKey, now);
      this.#db
        .prepare(
          "UPDATE relay_invites SET used_by_node_id = ?, used_at = ? WHERE token_hash = ? AND used_by_node_id IS NULL",
        )
        .run(input.nodeId, now, hash);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { nodeId: input.nodeId, enrolled: true };
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
        "SELECT node_id FROM relay_nodes WHERE node_id = ? AND disabled_at IS NULL",
      )
      .get(envelope.recipientNodeId) as SqlRow | undefined;
    if (sender === undefined || recipient === undefined) {
      throw new HttpError(404, "NODE_NOT_FOUND");
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

  private nodes(): Array<{
    nodeId: string;
    displayName: string;
    publicKey: string;
  }> {
    return (
      this.#db
        .prepare(
          "SELECT node_id, display_name, public_key FROM relay_nodes WHERE disabled_at IS NULL ORDER BY lower(display_name), node_id",
        )
        .all() as SqlRow[]
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
        reply(res, 200, { ok: true, protocolVersion: 1 });
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
      if (req.method === "GET" && url.pathname === "/squad/v1/nodes") {
        this.authenticate(req, path, Buffer.alloc(0));
        reply(res, 200, { nodes: this.nodes() });
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
