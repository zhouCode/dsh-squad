import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { NodeIdentity } from "./identity.ts";
import { RelayServer, signedRequest } from "./relay.ts";
import { RelayClient } from "./relay-client.ts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("Relay mailbox", () => {
  it("migrates existing organization invitations to opaque management IDs", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-relay-migration-"));
    const databasePath = join(root, "relay.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE schema_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO schema_meta(singleton, version) VALUES (1, 3);
      CREATE TABLE relay_organization_invites (
        token_hash TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        created_by_membership_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_by_request_id TEXT,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
    `);
    database
      .prepare(
        `INSERT INTO relay_organization_invites(
          token_hash, organization_id, created_by_membership_id,
          expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "legacy-token-hash",
        randomUUID(),
        randomUUID(),
        "2026-08-21T00:00:00.000Z",
        "2026-08-20T00:00:00.000Z",
      );
    database.close();

    const relay = new RelayServer({
      databasePath,
      invites: [],
      maxMailboxItems: 100,
      maxRequestsPerMinute: 1_000,
    });
    relay.close();

    const migrated = new DatabaseSync(databasePath);
    expect(
      (
        migrated
          .prepare("SELECT version FROM schema_meta WHERE singleton = 1")
          .get() as Record<string, unknown>
      ).version,
    ).toBe(6);
    const transferTable = migrated
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'relay_organization_owner_transfers'",
      )
      .get() as Record<string, unknown> | undefined;
    expect(transferTable?.name).toBe("relay_organization_owner_transfers");
    const organizationColumns = migrated
      .prepare("PRAGMA table_info(relay_organizations)")
      .all() as Array<{ name?: string }>;
    expect(
      organizationColumns.some((column) => column.name === "dissolved_at"),
    ).toBe(true);
    const row = migrated
      .prepare(
        "SELECT invitation_id, revoked_at FROM relay_organization_invites WHERE token_hash = ?",
      )
      .get("legacy-token-hash") as Record<string, unknown>;
    expect(row.invitation_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(row.revoked_at).toBeNull();
    migrated.close();
  });

  it("enrolls once, persists offline delivery, isolates and explicitly acks", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-relay-"));
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const relayOptions = {
      databasePath: join(root, "relay.sqlite"),
      invites: [
        { token: "invite-alice-0000000001", expiresAt },
        { token: "invite-bob-000000000002", expiresAt },
      ],
      maxMailboxItems: 100,
      maxRequestsPerMinute: 1_000,
    };
    let relay = new RelayServer(relayOptions);
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
    if (address === null || typeof address === "string")
      throw new Error("missing address");
    const base = `http://127.0.0.1:${address.port}`;
    const aliceIdentity = NodeIdentity.load(join(root, "alice.json"));
    const bobIdentity = NodeIdentity.load(join(root, "bob.json"));
    const eveIdentity = NodeIdentity.load(join(root, "eve.json"));
    const alice = new RelayClient(base, aliceIdentity);
    const bob = new RelayClient(base, bobIdentity);
    await alice.enroll("invite-alice-0000000001", "Alice");
    await alice.enroll("invite-alice-0000000001", "Alice");
    await bob.enroll("invite-bob-000000000002", "Bob");
    await expect(
      new RelayClient(base, eveIdentity).enroll(
        "invite-alice-0000000001",
        "Eve",
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "INVITATION_ALREADY_USED",
    });

    const eventController = new AbortController();
    let notificationCount = 0;
    let resolveReady!: () => void;
    let resolveMailboxEvent!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const mailboxEvent = new Promise<void>((resolve) => {
      resolveMailboxEvent = resolve;
    });
    const watching = bob
      .watchMailbox(eventController.signal, () => {
        notificationCount += 1;
        if (notificationCount === 1) resolveReady();
        if (notificationCount === 2) resolveMailboxEvent();
      })
      .catch((error: unknown) => {
        if (!eventController.signal.aborted) throw error;
      });
    cleanups.push(async () => {
      eventController.abort();
      await watching;
    });
    await ready;

    const delegationId = randomUUID();
    const now = new Date();
    const envelope = aliceIdentity.signEnvelope({
      protocolVersion: 1,
      envelopeId: randomUUID(),
      kind: "DELEGATION_REQUEST",
      senderNodeId: aliceIdentity.nodeId,
      recipientNodeId: bobIdentity.nodeId,
      correlationId: delegationId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      payload: {
        delegationId,
        objective: "Produce a deterministic summary",
        acceptanceCriteria: [],
        attachmentRefs: [],
        delegationDepth: 0,
      },
    });
    await alice.submit(envelope);
    await mailboxEvent;
    eventController.abort();
    await watching;
    await alice.submit(envelope);
    await expect(bob.submit(envelope)).rejects.toMatchObject({
      status: 403,
      code: "SENDER_MISMATCH",
    });
    await expect(
      alice.submit({
        ...envelope,
        payload: { ...envelope.payload, objective: "tampered" },
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: "INVALID_ENVELOPE_SIGNATURE",
    });
    const { signature: _signature, ...unsignedEnvelope } = envelope;
    const conflicting = aliceIdentity.signEnvelope({
      ...unsignedEnvelope,
      payload: { ...envelope.payload, objective: "validly re-signed conflict" },
    });
    await expect(alice.submit(conflicting)).rejects.toMatchObject({
      status: 409,
      code: "ENVELOPE_ID_CONFLICT",
    });
    expect((await alice.mailbox(0)).items).toHaveLength(0);
    const first = await bob.mailbox(0);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.envelope.envelopeId).toBe(envelope.envelopeId);
    expect((await bob.mailbox(first.cursor)).items).toHaveLength(1);
    relay.close();
    relay = new RelayServer(relayOptions);
    expect((await bob.mailbox(first.cursor)).items).toHaveLength(1);
    await expect(alice.acknowledge(envelope.envelopeId)).rejects.toMatchObject({
      status: 403,
      code: "MAILBOX_FORBIDDEN",
    });
    await bob.acknowledge(envelope.envelopeId);
    expect((await bob.mailbox(first.cursor)).items).toHaveLength(0);
    relay.close();
    relay = new RelayServer(relayOptions);
    expect((await bob.mailbox(first.cursor)).items).toHaveLength(0);

    const replayPath = "/squad/v1/mailbox?after=0&limit=1";
    const auth = signedRequest(aliceIdentity, "GET", replayPath);
    const firstAuth = await fetch(`${base}${replayPath}`, {
      headers: auth.headers,
    });
    expect(firstAuth.status).toBe(200);
    const replay = await fetch(`${base}${replayPath}`, {
      headers: auth.headers,
    });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({
      error: { code: "AUTH_REPLAY" },
    });
  });
});
