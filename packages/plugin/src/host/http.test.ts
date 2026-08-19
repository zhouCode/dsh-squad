import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createHttpHandler } from "./http.ts";
import type { SquadService } from "./service.ts";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        }),
    ),
  );
});

describe("Squad host health", () => {
  it("reports the running plugin version even when Relay also handles health", async () => {
    const squad = {
      version: () => "0.6.0",
      nodeId: () => "node_test-health-identity",
      relayServer: {
        handle: async () => {
          throw new Error("Relay handler must not shadow host health");
        },
      },
    } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/health`,
    );
    expect(await response.json()).toEqual({
      ok: true,
      version: "0.6.0",
      nodeId: "node_test-health-identity",
      protocolVersions: [1, 2],
    });
  });

  it("accepts validated guided setup through the loopback management API", async () => {
    const configureNode = vi.fn(async (input: unknown) => ({ input }));
    const squad = { configureNode } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/setup`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "DIRECT",
          displayName: "Alice",
          directEnabled: false,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      input: {
        mode: "DIRECT",
        displayName: "Alice",
        directEnabled: false,
      },
    });
    expect(configureNode).toHaveBeenCalledOnce();
  });

  it("exposes a lightweight actionable-work summary", async () => {
    const squad = {
      relayServer: undefined,
      localAttentionSummary: () => ({
        revision: 3,
        setupRequired: false,
        waitingHuman: 2,
        failedOutgoing: 1,
        pendingJoinRequests: 0,
        draftPlans: 1,
        updateAvailable: false,
        total: 4,
      }),
    } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not bind");
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/squad/v1/local/attention`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ total: 4, revision: 3 });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("runs connection diagnostics through the loopback management API", async () => {
    const checkConnections = vi.fn(async () => ({
      checkedAt: new Date().toISOString(),
      relay: {
        status: "CONNECTED",
        configured: true,
        serving: false,
        eventStream: "CONNECTED",
      },
      direct: { status: "NOT_CONFIGURED", serving: false },
      queue: { pending: 0, retrying: 0 },
    }));
    const squad = { checkConnections } as unknown as SquadService;
    const server = createServer(createHttpHandler(squad));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/squad/v1/local/connections/check`,
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      relay: { status: "CONNECTED" },
      queue: { pending: 0 },
    });
    expect(checkConnections).toHaveBeenCalledOnce();
  });
});
