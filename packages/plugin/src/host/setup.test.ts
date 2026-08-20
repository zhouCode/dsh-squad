import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { SQUAD_VERSION } from "../shared/version.ts";
import { resolveConfig } from "./config.ts";
import { createHttpHandler } from "./http.ts";
import { NodeIdentity } from "./identity.ts";
import { SquadService } from "./service.ts";

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

describe("guided Node setup", () => {
  it("requires explicit confirmation before a Relay host becomes a member Node", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-guided-hybrid-"));
    const invitation = "relay-self-membership-invitation-1234";
    const relay = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "relay-node"),
        displayName: "Relay",
        relay: {
          enabled: true,
          databasePath: join(root, "relay.sqlite"),
          invites: [
            {
              token: invitation,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          ],
        },
        updates: { stateDir: join(root, "relay-updates") },
      }),
    );
    await relay.start();
    const http = await listen(createHttpHandler(relay));
    try {
      expect(relay.localState()).toMatchObject({
        relay: { serving: true, configured: false },
        direct: { serving: false },
      });
      await expect(
        relay.configureNode({
          mode: "RELAY",
          displayName: "Relay member",
          relayUrl: http.url,
          invitation,
        }),
      ).rejects.toMatchObject({
        code: "RELAY_HOST_MEMBERSHIP_CONFIRMATION_REQUIRED",
      });
      expect(relay.database.nodeSetup()).toBeUndefined();

      await relay.configureNode({
        mode: "RELAY",
        displayName: "Relay member",
        relayUrl: http.url,
        invitation,
        confirmRelayHostMembership: true,
      });
      expect(relay.localState()).toMatchObject({
        identity: { displayName: "Relay member" },
        relay: { serving: true, configured: true, url: http.url },
      });
      expect(relay.database.nodeSetup()).not.toHaveProperty(
        "confirmRelayHostMembership",
      );
    } finally {
      await http.close();
      await relay.close();
    }
  });

  it("persists Direct setup and restores it without YAML configuration", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-guided-direct-"));
    const config = resolveConfig({
      dataDir: join(root, "node"),
      updates: { stateDir: join(root, "updates") },
    });
    const first = new SquadService(new Context(), config);
    await first.start();
    expect(first.localState().setup).toMatchObject({
      required: true,
      source: "UNCONFIGURED",
    });
    await expect(
      first.configureNode({
        mode: "DIRECT",
        displayName: "Alice",
        directEnabled: true,
      }),
    ).rejects.toMatchObject({ code: "DIRECT_PUBLIC_URL_REQUIRED" });
    expect(first.database.nodeSetup()).toBeUndefined();
    const configured = await first.configureNode({
      mode: "DIRECT",
      displayName: "Alice",
      directEnabled: true,
      directPublicUrl: "http://127.0.0.1:37100/",
    });
    expect(configured).toMatchObject({
      setup: {
        required: false,
        mode: "DIRECT",
        source: "INTERFACE",
      },
      identity: { displayName: "Alice" },
      relay: { configured: false },
      direct: {
        serving: true,
        publicUrl: "http://127.0.0.1:37100",
      },
    });
    await first.close();

    const reopened = new SquadService(new Context(), config);
    await reopened.start();
    expect(reopened.localState()).toMatchObject({
      setup: {
        required: false,
        mode: "DIRECT",
        source: "INTERFACE",
      },
      identity: { displayName: "Alice" },
      direct: {
        serving: true,
        publicUrl: "http://127.0.0.1:37100",
      },
    });
    await reopened.close();
  });

  it("validates Relay enrollment before saving and never persists the invitation", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-guided-relay-"));
    const invitation = "guided-setup-invitation-1234567890";
    const relay = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "relay-node"),
        displayName: "Relay",
        relay: {
          enabled: true,
          databasePath: join(root, "relay.sqlite"),
          invites: [
            {
              token: invitation,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          ],
        },
        updates: { stateDir: join(root, "relay-updates") },
      }),
    );
    const http = await listen(createHttpHandler(relay));
    const node = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "alice"),
        updates: { stateDir: join(root, "alice-updates") },
      }),
    );
    await node.start();
    const nodeHttp = await listen(createHttpHandler(node));
    try {
      await expect(
        node.configureNode({
          mode: "RELAY",
          displayName: "Alice",
          relayUrl: http.url,
        }),
      ).rejects.toMatchObject({ code: "RELAY_ENROLLMENT_REQUIRED" });
      expect(node.database.nodeSetup()).toBeUndefined();
      await node.configureNode({
        mode: "RELAY",
        displayName: "Alice",
        relayUrl: `${http.url}/`,
        invitation,
        directEnabled: true,
        directPublicUrl: nodeHttp.url,
      });
      expect(node.localState()).toMatchObject({
        setup: { required: false, mode: "RELAY", source: "INTERFACE" },
        identity: { displayName: "Alice" },
        relay: { configured: true, url: http.url },
        direct: {
          serving: true,
          publicUrl: nodeHttp.url,
        },
      });
      expect(JSON.stringify(node.database.nodeSetup())).not.toContain(
        invitation,
      );

      await node.configureNode({
        mode: "RELAY",
        displayName: "Alice workstation",
        relayUrl: http.url,
        directEnabled: true,
        directPublicUrl: nodeHttp.url,
      });
      expect(node.localState().identity.displayName).toBe("Alice workstation");
      await expect(node.checkConnections()).resolves.toMatchObject({
        relay: { status: "CONNECTED", remoteVersion: SQUAD_VERSION },
        direct: { status: "READY" },
        queue: { pending: 0, retrying: 0 },
      });
    } finally {
      await node.close();
      await nodeHttp.close();
      await http.close();
      await relay.close();
    }
  });

  it("does not force upgraded Nodes with existing Peer data through onboarding", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-guided-upgrade-"));
    const config = resolveConfig({
      dataDir: join(root, "node"),
      updates: { stateDir: join(root, "updates") },
    });
    const peer = NodeIdentity.load(join(root, "peer.json"));
    const first = new SquadService(new Context(), config);
    await first.start();
    await first.addPeer({
      nodeId: peer.nodeId,
      displayName: "Existing peer",
      publicKey: peer.publicKey,
      policy: {
        canMessage: true,
        canDelegate: true,
        autoExecute: "NEVER",
        maxConcurrent: 1,
        maxDelegationDepth: 1,
        maxRuntimeMinutes: 30,
      },
    });
    await first.close();

    const reopened = new SquadService(new Context(), config);
    await reopened.start();
    expect(reopened.localState().setup).toEqual({
      required: false,
      source: "EXISTING_DATA",
    });
    await reopened.close();
  });
});
