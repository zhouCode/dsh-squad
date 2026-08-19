import { describe, expect, it } from "vitest";
import { localSyncHealth } from "./live-sync.ts";

describe("localSyncHealth", () => {
  it("treats an open event stream as current even without recent changes", () => {
    expect(
      localSyncHealth({
        eventStream: "LIVE",
        lastRefreshedAt: 1_000,
        now: 100_000,
      }),
    ).toBe("LIVE");
  });

  it("marks a disconnected snapshot stale after the grace period", () => {
    expect(
      localSyncHealth({
        eventStream: "RECONNECTING",
        lastRefreshedAt: 1_000,
        now: 31_001,
      }),
    ).toBe("STALE");
  });

  it("keeps a recent reconnect in its recoverable state", () => {
    expect(
      localSyncHealth({
        eventStream: "RECONNECTING",
        lastRefreshedAt: 1_000,
        now: 30_000,
      }),
    ).toBe("RECONNECTING");
  });
});
