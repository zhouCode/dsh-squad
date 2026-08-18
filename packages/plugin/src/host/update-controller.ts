import { canonicalJson } from "../shared/canonical.ts";
import {
  updateModeSchema,
  type UpdateMode,
  type UpdateSnapshot,
  type UpdateStatus,
} from "../shared/updates.ts";
import { SQUAD_VERSION } from "../shared/version.ts";
import { checkLatestRelease } from "../update/release.ts";
import { UpdateStore } from "../update/storage.ts";
import type { ResolvedSquadConfig } from "./config.ts";

function initialStatus(): UpdateStatus {
  return {
    schemaVersion: 1,
    phase: "IDLE",
    currentVersion: SQUAD_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

function safeDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2_000,
  );
}

export class UpdateController {
  readonly store: UpdateStore;
  readonly repository: string;
  readonly defaultMode: UpdateMode;
  #snapshot: UpdateSnapshot | undefined;
  #checking: Promise<UpdateSnapshot> | undefined;

  constructor(config: ResolvedSquadConfig["updates"]) {
    this.store = new UpdateStore(config.stateDir);
    this.repository = config.repository;
    this.defaultMode = config.defaultMode;
  }

  async start(): Promise<void> {
    await this.store.initialize();
    const policy = await this.store.policy(this.defaultMode);
    let status = (await this.store.readStatus()) ?? initialStatus();
    if (status.currentVersion !== SQUAD_VERSION) {
      status = {
        schemaVersion: 1,
        phase: status.latestVersion === SQUAD_VERSION ? "INSTALLED" : "IDLE",
        currentVersion: SQUAD_VERSION,
        updatedAt: new Date().toISOString(),
        ...(status.latestVersion === undefined
          ? {}
          : { latestVersion: status.latestVersion }),
        ...(status.checkedAt === undefined
          ? {}
          : { checkedAt: status.checkedAt }),
        ...(status.releaseUrl === undefined
          ? {}
          : { releaseUrl: status.releaseUrl }),
        available: false,
      };
      await this.store.writeStatus(status);
    } else if ((await this.store.readStatus()) === undefined) {
      await this.store.writeStatus(status);
    }
    const automation = await this.store.readAutomation();
    this.#snapshot = {
      currentVersion: SQUAD_VERSION,
      policy,
      status,
      ...(automation === undefined ? {} : { automation }),
      installRequested: (await this.store.readRequest()) !== undefined,
    };
  }

  snapshot(): UpdateSnapshot {
    if (this.#snapshot === undefined) {
      throw new Error("Squad update controller has not started");
    }
    return this.#snapshot;
  }

  async refresh(): Promise<boolean> {
    const previous = canonicalJson(this.snapshot());
    const policy =
      (await this.store.readPolicy()) ??
      (await this.store.policy(this.defaultMode));
    const status = (await this.store.readStatus()) ?? initialStatus();
    const automation = await this.store.readAutomation();
    this.#snapshot = {
      currentVersion: SQUAD_VERSION,
      policy,
      status: { ...status, currentVersion: SQUAD_VERSION },
      ...(automation === undefined ? {} : { automation }),
      installRequested: (await this.store.readRequest()) !== undefined,
    };
    return previous !== canonicalJson(this.#snapshot);
  }

  async setMode(value: unknown): Promise<UpdateSnapshot> {
    const mode = updateModeSchema.parse(value);
    await this.store.writePolicy({
      schemaVersion: 1,
      mode,
      updatedAt: new Date().toISOString(),
    });
    await this.refresh();
    return this.snapshot();
  }

  checkNow(): Promise<UpdateSnapshot> {
    if (this.#checking !== undefined) return this.#checking;
    this.#checking = this.#performCheck().finally(() => {
      this.#checking = undefined;
    });
    return this.#checking;
  }

  async #performCheck(): Promise<UpdateSnapshot> {
    if (await this.store.isUpdateLocked()) {
      await this.refresh();
      throw new Error("the external Squad updater is currently running");
    }
    const now = new Date().toISOString();
    await this.store.writeStatus({
      schemaVersion: 1,
      phase: "CHECKING",
      currentVersion: SQUAD_VERSION,
      updatedAt: now,
    });
    await this.refresh();
    try {
      const result = await checkLatestRelease(SQUAD_VERSION, this.repository);
      await this.store.writeStatus({
        schemaVersion: 1,
        phase: result.available ? "AVAILABLE" : "UP_TO_DATE",
        currentVersion: SQUAD_VERSION,
        updatedAt: new Date().toISOString(),
        latestVersion: result.latestVersion,
        available: result.available,
        checkedAt: result.checkedAt,
        ...(result.release === undefined
          ? {}
          : { releaseUrl: result.release.releaseUrl }),
      });
    } catch (error) {
      await this.store.writeStatus({
        schemaVersion: 1,
        phase: "FAILED",
        currentVersion: SQUAD_VERSION,
        updatedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        available: false,
        errorCode: "UPDATE_CHECK_FAILED",
        detail: safeDetail(error),
      });
    }
    await this.refresh();
    return this.snapshot();
  }

  async requestInstall(): Promise<UpdateSnapshot> {
    const snapshot = this.snapshot();
    if (snapshot.automation === undefined) {
      throw new Error(
        "the external Squad updater is not configured on this Node",
      );
    }
    if (
      snapshot.status.available !== true ||
      snapshot.status.latestVersion === undefined
    ) {
      throw new Error("there is no verified update available to install");
    }
    await this.store.writeRequest({
      schemaVersion: 1,
      requestedAt: new Date().toISOString(),
      requestedVersion: snapshot.status.latestVersion,
    });
    await this.store.writeStatus({
      ...snapshot.status,
      phase: "REQUESTED",
      updatedAt: new Date().toISOString(),
    });
    await this.refresh();
    return this.snapshot();
  }
}
