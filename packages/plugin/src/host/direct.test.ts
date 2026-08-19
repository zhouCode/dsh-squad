import { createServer, type RequestListener } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "./config.ts";
import { createHttpHandler } from "./http.ts";
import { NodeIdentity } from "./identity.ts";
import { SquadService } from "./service.ts";
import { DirectEnvelopeTransport } from "./transport.ts";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function listen(handler: RequestListener): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function peerPolicy() {
  return {
    canMessage: true,
    canDelegate: true,
    autoExecute: "NEVER" as const,
    maxConcurrent: 1,
    maxDelegationDepth: 1,
    maxRuntimeMinutes: 30,
  };
}

describe("Direct peer transport", () => {
  it("accepts loopback development origins and rejects unsafe Direct origins", () => {
    expect(
      resolveConfig({
        direct: { enabled: true, publicUrl: "http://127.0.0.1:37100/" },
      }).direct.publicUrl,
    ).toBe("http://127.0.0.1:37100");
    expect(
      resolveConfig({
        direct: { enabled: true, publicUrl: "http://[::1]:37100" },
      }).direct.publicUrl,
    ).toBe("http://[::1]:37100");
    expect(() =>
      resolveConfig({
        direct: { enabled: true, publicUrl: "http://agent.example.com" },
      }),
    ).toThrow(/must use HTTPS/u);
    expect(() =>
      resolveConfig({
        direct: { enabled: true, publicUrl: "http://127.example.com" },
      }),
    ).toThrow(/must use HTTPS/u);
    expect(() =>
      resolveConfig({
        direct: { enabled: true, publicUrl: "https://agent.example.com/path" },
      }),
    ).toThrow(/only an origin/u);
    expect(() =>
      resolveConfig({
        peers: [
          {
            nodeId: "node_placeholder",
            displayName: "Bob",
            publicKey: "placeholder",
            transport: "DIRECT",
          },
        ],
      }),
    ).toThrow(/requires directUrl/u);
  });

  it("persists at the receiving Node and returns a signed node receipt", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-direct-"));
    let alice: SquadService | undefined;
    let bob: SquadService | undefined;
    const aliceHttp = await listen((req, res) => {
      if (alice === undefined) throw new Error("Alice service is not ready");
      void createHttpHandler(alice)(req, res);
    });
    const bobHttp = await listen((req, res) => {
      if (bob === undefined) throw new Error("Bob service is not ready");
      void createHttpHandler(bob)(req, res);
    });
    cleanups.push(aliceHttp.close, bobHttp.close);

    alice = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "alice"),
        displayName: "Alice",
        direct: { enabled: true, publicUrl: aliceHttp.url },
        updates: { stateDir: join(root, "alice-updates") },
      }),
    );
    bob = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "bob"),
        displayName: "Bob",
        direct: { enabled: true, publicUrl: bobHttp.url },
        updates: { stateDir: join(root, "bob-updates") },
      }),
    );
    cleanups.push(
      () => alice?.close(),
      () => bob?.close(),
    );

    await alice.addPeer({
      nodeId: bob.identity.nodeId,
      displayName: "Bob",
      publicKey: bob.identity.publicKey,
      transport: "DIRECT",
      directUrl: bobHttp.url,
      policy: peerPolicy(),
    });
    await bob.addPeer({
      nodeId: alice.identity.nodeId,
      displayName: "Alice",
      publicKey: alice.identity.publicKey,
      transport: "DIRECT",
      directUrl: aliceHttp.url,
      policy: peerPolicy(),
    });

    const outgoing = await alice.delegate({
      to: "Bob",
      objective: "Review the direct transport",
      acceptanceCriteria: ["Return a concise result"],
    });
    expect(outgoing.deliveryStatus).toBe("RECEIVED_BY_NODE");
    expect(outgoing.deliveryAttempts).toBe(0);

    await vi.waitFor(() => {
      expect(alice?.database.getDelegation(outgoing.id)?.status).toBe(
        "WAITING_HUMAN",
      );
    });
    const incoming = bob.database.getDelegation(outgoing.id);
    expect(incoming).toMatchObject({
      direction: "INCOMING",
      deliveryStatus: "RECEIVED_LOCAL",
      status: "WAITING_HUMAN",
    });
  });

  it("automatically delivers the same queued task after the peer comes online", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-direct-offline-"));
    let alice: SquadService | undefined;
    let bob: SquadService | undefined;
    let bobOnline = false;
    let bobHandler: RequestListener | undefined;
    const aliceHttp = await listen((req, res) => {
      if (alice === undefined) throw new Error("Alice service is not ready");
      void createHttpHandler(alice)(req, res);
    });
    const bobHttp = await listen((req, res) => {
      if (!bobOnline || bobHandler === undefined) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { code: "PEER_OFFLINE", message: "Bob is offline" },
          }),
        );
        return;
      }
      bobHandler(req, res);
    });
    cleanups.push(aliceHttp.close, bobHttp.close);

    alice = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "alice"),
        displayName: "Alice",
        pollIntervalMs: 1_000,
        direct: { enabled: true, retryIntervalMs: 1_000 },
        updates: { stateDir: join(root, "alice-updates") },
      }),
    );
    bob = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "bob"),
        displayName: "Bob",
        pollIntervalMs: 1_000,
        direct: { enabled: true, retryIntervalMs: 1_000 },
        updates: { stateDir: join(root, "bob-updates") },
      }),
    );
    bobHandler = createHttpHandler(bob);
    cleanups.push(
      () => alice?.close(),
      () => bob?.close(),
    );
    await alice.addPeer({
      nodeId: bob.identity.nodeId,
      displayName: "Bob",
      publicKey: bob.identity.publicKey,
      transport: "DIRECT",
      directUrl: bobHttp.url,
      policy: peerPolicy(),
    });
    await bob.addPeer({
      nodeId: alice.identity.nodeId,
      displayName: "Alice",
      publicKey: alice.identity.publicKey,
      transport: "DIRECT",
      directUrl: aliceHttp.url,
      policy: peerPolicy(),
    });
    await alice.start();
    await bob.start();

    const delegation = await alice.delegate({
      to: "Bob",
      objective: "Wait until Bob is reachable",
    });
    expect(delegation).toMatchObject({
      status: "QUEUED",
      deliveryStatus: "WAITING_FOR_PEER",
      deliveryAttempts: 1,
    });
    expect(delegation.lastDeliveryError).toBeTruthy();
    expect(delegation.nextDeliveryAttemptAt).toBeTruthy();
    expect(alice.database.pendingEnvelopes()).toHaveLength(0);

    bobOnline = true;
    await vi.waitFor(
      () => {
        expect(alice?.database.getDelegation(delegation.id)).toMatchObject({
          deliveryStatus: "RECEIVED_BY_NODE",
          status: "WAITING_HUMAN",
          deliveryAttempts: 1,
        });
      },
      { timeout: 5_000, interval: 100 },
    );
    expect(
      bob.database
        .listDelegations()
        .filter((candidate) => candidate.id === delegation.id),
    ).toHaveLength(1);
  });

  it("rejects a node receipt that is not signed by the pinned peer", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-direct-receipt-"));
    const alice = NodeIdentity.load(join(root, "alice.json"));
    const bob = NodeIdentity.load(join(root, "bob.json"));
    const mallory = NodeIdentity.load(join(root, "mallory.json"));
    const delegationId = randomUUID();
    const envelope = alice.signEnvelope({
      protocolVersion: 1,
      envelopeId: randomUUID(),
      kind: "DELEGATION_REQUEST",
      senderNodeId: alice.nodeId,
      recipientNodeId: bob.nodeId,
      correlationId: delegationId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      payload: {
        delegationId,
        objective: "Reject a forged receipt",
        acceptanceCriteria: [],
        attachmentRefs: [],
        delegationDepth: 0,
      },
    });
    const unsignedReceipt = {
      version: 1 as const,
      envelopeId: envelope.envelopeId,
      senderNodeId: bob.nodeId,
      recipientNodeId: alice.nodeId,
      receivedAt: new Date().toISOString(),
    };
    const endpoint = await listen((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ...unsignedReceipt,
          signature: mallory.sign(unsignedReceipt),
        }),
      );
    });
    cleanups.push(endpoint.close);
    const transport = new DirectEnvelopeTransport(alice, (nodeId) =>
      nodeId === bob.nodeId
        ? {
            nodeId: bob.nodeId,
            publicKey: bob.publicKey,
            transport: "DIRECT",
            directUrl: endpoint.url,
          }
        : undefined,
    );

    await expect(transport.submit(envelope)).rejects.toMatchObject({
      code: "DIRECT_INVALID_RECEIPT",
    });
  });
});
