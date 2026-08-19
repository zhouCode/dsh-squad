import { describe, expect, it } from "vitest";
import {
  compareVersions,
  countUpdateActiveWork,
  summarizeUpdateReadiness,
  type UpdateSnapshot,
} from "./updates.ts";

function snapshot(overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot {
  return {
    currentVersion: "0.7.0",
    policy: {
      schemaVersion: 1,
      mode: "NOTIFY",
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
    status: {
      schemaVersion: 1,
      phase: "AVAILABLE",
      currentVersion: "0.7.0",
      updatedAt: "2026-08-20T00:00:00.000Z",
      latestVersion: "0.8.0",
      available: true,
    },
    automation: {
      schemaVersion: 1,
      configuredAt: "2026-08-20T00:00:00.000Z",
      scope: "user",
      serviceUnit: "dsh-web.service",
      updaterUnit: "dsh-squad-update.service",
      timerUnit: "dsh-squad-update.timer",
      pathUnit: "dsh-squad-update.path",
      configPath: "/srv/dsh/update.json",
    },
    installRequested: false,
    ...overrides,
  };
}

describe("Squad update versions", () => {
  it("orders stable and prerelease semantic versions", () => {
    expect(compareVersions("0.5.0", "0.4.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.10")).toBeGreaterThan(0);
    expect(compareVersions("2.1.3", "2.1.3")).toBe(0);
  });

  it("rejects non-semantic release identifiers", () => {
    expect(() => compareVersions("latest", "0.5.0")).toThrow(
      "invalid semantic version",
    );
  });

  it("counts only work that makes a restart unsafe", () => {
    expect(
      countUpdateActiveWork({
        delegations: [
          { status: "QUEUED" },
          { status: "TRIAGING" },
          { status: "RUNNING" },
          { status: "WAITING_HUMAN" },
        ],
        plans: [{ status: "DRAFT" }, { status: "DISPATCHING" }],
      }),
    ).toEqual({ activeDelegations: 2, dispatchingPlans: 1 });
  });

  it("reports a ready verified release on an idle configured Node", () => {
    expect(
      summarizeUpdateReadiness(snapshot(), {
        delegations: [{ status: "COMPLETED" }],
        plans: [{ status: "DISPATCHED" }],
      }),
    ).toEqual({
      ready: true,
      updaterConfigured: true,
      verifiedReleaseAvailable: true,
      installRequested: false,
      activeDelegations: 0,
      dispatchingPlans: 0,
      blockers: [],
    });
  });

  it("explains every preflight blocker without hiding active work", () => {
    const { automation: _automation, ...withoutAutomation } = snapshot({
      installRequested: true,
      status: {
        schemaVersion: 1,
        phase: "UP_TO_DATE",
        currentVersion: "0.7.0",
        updatedAt: "2026-08-20T00:00:00.000Z",
        available: false,
      },
    });
    const readiness = summarizeUpdateReadiness(withoutAutomation, {
      delegations: [{ status: "RUNNING" }],
      plans: [{ status: "DISPATCHING" }],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual([
      "UPDATER_NOT_CONFIGURED",
      "NO_VERIFIED_RELEASE",
      "INSTALL_ALREADY_REQUESTED",
      "ACTIVE_DELEGATIONS",
      "DISPATCHING_PLANS",
    ]);
  });
});
