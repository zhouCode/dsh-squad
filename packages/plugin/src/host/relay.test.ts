import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NodeIdentity } from "./identity.ts";
import { RelayServer, signedRequest } from "./relay.ts";
import { RelayClient } from "./relay-client.ts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("Relay mailbox", () => {
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
