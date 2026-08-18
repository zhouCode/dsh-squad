import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { UpdateStatus } from "../shared/updates.ts";
import { SQUAD_VERSION } from "../shared/version.ts";
import {
  checkLatestRelease,
  downloadVerifiedRelease,
  type ReleaseCheck,
  type VerifiedRelease,
} from "../update/release.ts";
import { atomicWriteJson, UpdateStore } from "../update/storage.ts";
import {
  assertSafeUpdaterPaths,
  assertSafeUpdaterPathsOnDisk,
  updaterProfileDir,
  type UpdaterConfig,
} from "./config.ts";

const localStateSchema = z
  .object({
    identity: z.object({ nodeId: z.string().min(1) }).passthrough(),
    delegations: z.array(
      z.object({ status: z.string().optional() }).passthrough(),
    ),
    plans: z.array(z.object({ status: z.string().optional() }).passthrough()),
    updates: z.object({ currentVersion: z.string().min(1) }).passthrough(),
  })
  .passthrough();

const updateLockSchema = z.object({
  pid: z.number().int().positive(),
  token: z.string().uuid(),
  createdAt: z.string().datetime(),
});

interface BackupEntry {
  source: string;
  payload: string;
  existed: boolean;
}

interface BackupRecord {
  path: string;
  entries: BackupEntry[];
}

export interface UpdaterDependencies {
  fetchImpl?: typeof fetch;
  runCommand?: (command: string, args: string[]) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  checkRelease?: (
    currentVersion: string,
    repository: string,
    fetchImpl: typeof fetch,
  ) => Promise<ReleaseCheck>;
  downloadRelease?: (
    release: VerifiedRelease,
    repository: string,
    fetchImpl: typeof fetch,
  ) => Promise<Uint8Array>;
}

interface ResolvedUpdaterDependencies {
  fetchImpl: typeof fetch;
  runCommand: (command: string, args: string[]) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
  checkRelease: NonNullable<UpdaterDependencies["checkRelease"]>;
  downloadRelease: NonNullable<UpdaterDependencies["downloadRelease"]>;
}

class UpdateBlockedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function detail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2_000,
  );
}

async function defaultRunCommand(
  command: string,
  args: string[],
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        reject(
          new Error(
            `${basename(command)} ${args.join(" ")} failed (${code ?? signal})`,
          ),
        );
      }
    });
  });
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function writeStatus(
  store: UpdateStore,
  phase: UpdateStatus["phase"],
  currentVersion: string,
  values: Omit<
    UpdateStatus,
    "schemaVersion" | "phase" | "currentVersion" | "updatedAt"
  > = {},
): Promise<void> {
  await store.writeStatus({
    schemaVersion: 1,
    phase,
    currentVersion,
    updatedAt: new Date().toISOString(),
    ...values,
  });
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`local Node returned HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) {
    throw new Error("local Node state exceeds the updater size limit");
  }
  return JSON.parse(text) as unknown;
}

async function assertNodeIdle(
  config: UpdaterConfig,
  fetchImpl: typeof fetch,
): Promise<string> {
  let state: z.infer<typeof localStateSchema>;
  try {
    state = localStateSchema.parse(await fetchJson(config.stateUrl, fetchImpl));
  } catch (error) {
    throw new UpdateBlockedError(
      "NODE_STATE_UNAVAILABLE",
      `could not verify that the Node is idle: ${detail(error)}`,
    );
  }
  if (state.updates.currentVersion !== SQUAD_VERSION) {
    throw new UpdateBlockedError(
      "NODE_VERSION_MISMATCH",
      `updater ${SQUAD_VERSION} is connected to Squad ${state.updates.currentVersion}`,
    );
  }
  const activeDelegations = state.delegations.filter((item) =>
    ["TRIAGING", "RUNNING"].includes(item.status ?? ""),
  );
  const activePlans = state.plans.filter(
    (item) => item.status === "DISPATCHING",
  );
  if (activeDelegations.length > 0 || activePlans.length > 0) {
    throw new UpdateBlockedError(
      "ACTIVE_WORK",
      `update deferred: ${activeDelegations.length} active delegation(s) and ${activePlans.length} dispatching plan(s)`,
    );
  }
  return state.identity.nodeId;
}

function systemctlArgs(
  config: UpdaterConfig,
  action: "start" | "stop",
): string[] {
  return ["--user", action, config.serviceUnit];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function createBackup(
  config: UpdaterConfig,
  fromVersion: string,
  toVersion: string,
): Promise<BackupRecord> {
  const backupRoot = join(config.stateDir, "backups");
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const id = `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${fromVersion}-to-${toVersion}`;
  const temporary = join(backupRoot, `.${id}.${randomUUID()}.tmp`);
  const finalPath = join(backupRoot, id);
  await mkdir(join(temporary, "payload"), { recursive: true, mode: 0o700 });
  const sources = [updaterProfileDir(config), ...config.dataPaths];
  const entries: BackupEntry[] = [];
  try {
    for (const [index, source] of sources.entries()) {
      const existed = await pathExists(source);
      const payload = join(
        "payload",
        index === 0 ? "profile" : `data-${index}-${basename(source) || "root"}`,
      );
      entries.push({ source, payload, existed });
      if (existed) {
        await cp(source, join(temporary, payload), {
          recursive: true,
          preserveTimestamps: true,
          errorOnExist: true,
        });
      }
    }
    await atomicWriteJson(join(temporary, "backup.json"), {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      fromVersion,
      toVersion,
      entries,
    });
    await rename(temporary, finalPath);
    return { path: finalPath, entries };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function rollbackBackup(backup: BackupRecord): Promise<string[]> {
  const preserved: string[] = [];
  const suffix = `.failed-update-${Date.now()}`;
  for (const entry of backup.entries) {
    const backupPath = join(backup.path, entry.payload);
    const currentExists = await pathExists(entry.source);
    if (currentExists) {
      const failedPath = `${entry.source}${suffix}`;
      if (await pathExists(failedPath)) {
        throw new Error(
          `rollback preservation path already exists: ${failedPath}`,
        );
      }
      await rename(entry.source, failedPath);
      preserved.push(failedPath);
    }
    if (entry.existed) {
      await mkdir(dirname(entry.source), { recursive: true, mode: 0o700 });
      await cp(backupPath, entry.source, {
        recursive: true,
        preserveTimestamps: true,
        errorOnExist: true,
      });
    }
  }
  return preserved;
}

async function retainRecentBackups(config: UpdaterConfig): Promise<void> {
  const backupRoot = join(config.stateDir, "backups");
  let entries;
  try {
    entries = await readdir(backupRoot, { withFileTypes: true });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of directories.slice(config.retainBackups)) {
    await rm(join(backupRoot, name), { recursive: true, force: true });
  }
}

async function atomicWritePackage(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function waitForVersion(
  config: UpdaterConfig,
  expectedVersion: string,
  expectedNodeId: string,
  fetchImpl: typeof fetch,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  let lastError = "health check did not run";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const value = (await fetchJson(config.healthUrl, fetchImpl)) as {
        ok?: boolean;
        version?: string;
      };
      if (value.ok !== true || value.version !== expectedVersion) {
        lastError = `expected ${expectedVersion}, received ${value.version ?? "unknown"}`;
      } else {
        const state = localStateSchema.parse(
          await fetchJson(config.stateUrl, fetchImpl),
        );
        if (state.identity.nodeId !== expectedNodeId) {
          lastError = `expected Node ${expectedNodeId}, received ${state.identity.nodeId}`;
        } else if (state.updates.currentVersion !== expectedVersion) {
          lastError = `local state reports Squad ${state.updates.currentVersion}`;
        } else {
          return;
        }
      }
    } catch (error) {
      lastError = detail(error);
    }
    await sleep(1_000);
  }
  throw new Error(`Relay health check failed: ${lastError}`);
}

async function acquireLock(store: UpdateStore): Promise<() => Promise<void>> {
  const path = store.lockPath;
  const token = randomUUID();
  let created = false;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "wx", 0o600);
    created = true;
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`,
    );
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close();
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error("the update lock must be a regular file");
      }
      if (metadata.size > 4 * 1024) {
        throw new Error("the update lock exceeds the size limit");
      }
      let ownerIsRunning = Date.now() - metadata.mtimeMs <= 5 * 60_000;
      try {
        const lock = updateLockSchema.parse(
          JSON.parse(await readFile(path, "utf8")),
        );
        try {
          process.kill(lock.pid, 0);
          ownerIsRunning = true;
        } catch (signalError) {
          ownerIsRunning = !(
            signalError instanceof Error &&
            "code" in signalError &&
            (signalError as NodeJS.ErrnoException).code === "ESRCH"
          );
        }
      } catch {
        // A newly created lock can briefly be empty. Only reclaim malformed
        // locks after a grace period so concurrent startup remains fail-safe.
      }
      if (ownerIsRunning) {
        throw new UpdateBlockedError(
          "UPDATE_ALREADY_RUNNING",
          "another Squad updater process holds the update lock",
        );
      }
      await rm(path, { force: true });
      return acquireLock(store);
    }
    if (created) await rm(path, { force: true });
    throw error;
  }
  return async () => {
    try {
      const lock = updateLockSchema.parse(
        JSON.parse(await readFile(path, "utf8")),
      );
      if (lock.token === token) await rm(path, { force: true });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  };
}

async function installRelease(
  config: UpdaterConfig,
  release: VerifiedRelease,
  currentVersion: string,
  expectedNodeId: string,
  store: UpdateStore,
  dependencies: ResolvedUpdaterDependencies,
): Promise<void> {
  let stopAttempted = false;
  let backup: BackupRecord | undefined;
  const latestVersion = release.manifest.version;
  const statusBase = {
    latestVersion,
    available: true,
    checkedAt: new Date().toISOString(),
    releaseUrl: release.releaseUrl,
  };
  try {
    await writeStatus(store, "DOWNLOADING", currentVersion, statusBase);
    const bytes = await dependencies.downloadRelease(
      release,
      config.repository,
      dependencies.fetchImpl,
    );
    const packagePath = resolve(
      config.stateDir,
      "packages",
      release.manifest.asset.name,
    );
    await atomicWritePackage(packagePath, bytes);
    await writeStatus(store, "VERIFYING", currentVersion, statusBase);
    const confirmedNodeId = await assertNodeIdle(
      config,
      dependencies.fetchImpl,
    );
    if (confirmedNodeId !== expectedNodeId) {
      throw new UpdateBlockedError(
        "NODE_ID_CHANGED",
        `update endpoint changed from ${expectedNodeId} to ${confirmedNodeId}`,
      );
    }
    stopAttempted = true;
    await dependencies.runCommand("systemctl", systemctlArgs(config, "stop"));
    await writeStatus(store, "BACKING_UP", currentVersion, statusBase);
    backup = await createBackup(config, currentVersion, latestVersion);
    await writeStatus(store, "INSTALLING", currentVersion, statusBase);
    await dependencies.runCommand(config.pnpmCommand, [
      "--dir",
      updaterProfileDir(config),
      "add",
      packagePath,
      "--offline",
    ]);
    await writeStatus(store, "RESTARTING", currentVersion, statusBase);
    await dependencies.runCommand("systemctl", systemctlArgs(config, "start"));
    await waitForVersion(
      config,
      latestVersion,
      expectedNodeId,
      dependencies.fetchImpl,
      dependencies.sleep,
    );
  } catch (error) {
    if (
      error instanceof UpdateBlockedError &&
      !stopAttempted &&
      backup === undefined
    ) {
      throw error;
    }
    if (stopAttempted || backup !== undefined) {
      let rollbackDetail = detail(error);
      try {
        if (backup !== undefined) {
          const preserved = await rollbackBackup(backup);
          rollbackDetail += `; failed installation preserved at ${preserved.join(", ")}`;
        }
        await dependencies.runCommand(
          "systemctl",
          systemctlArgs(config, "start"),
        );
        await waitForVersion(
          config,
          currentVersion,
          expectedNodeId,
          dependencies.fetchImpl,
          dependencies.sleep,
        );
        await writeStatus(store, "ROLLED_BACK", currentVersion, {
          ...statusBase,
          errorCode: "UPDATE_INSTALL_FAILED",
          detail: rollbackDetail.slice(0, 2_000),
        });
      } catch (rollbackError) {
        await writeStatus(store, "FAILED", currentVersion, {
          ...statusBase,
          errorCode: "UPDATE_ROLLBACK_FAILED",
          detail:
            `${detail(error)}; rollback failed: ${detail(rollbackError)}`.slice(
              0,
              2_000,
            ),
        });
      }
    } else {
      await writeStatus(store, "FAILED", currentVersion, {
        ...statusBase,
        errorCode: "UPDATE_INSTALL_FAILED",
        detail: detail(error),
      });
    }
    try {
      await store.clearRequest();
    } catch {
      // Preserve the original transaction/rollback error.
    }
    throw error;
  }
  const finalizationWarnings: string[] = [];
  try {
    await store.clearRequest();
  } catch (error) {
    finalizationWarnings.push(`request cleanup failed: ${detail(error)}`);
  }
  try {
    await retainRecentBackups(config);
  } catch (error) {
    finalizationWarnings.push(`backup retention failed: ${detail(error)}`);
  }
  try {
    await writeStatus(store, "INSTALLED", latestVersion, {
      ...statusBase,
      available: false,
      ...(finalizationWarnings.length === 0
        ? {}
        : {
            errorCode: "UPDATE_FINALIZATION_WARNING",
            detail: finalizationWarnings.join("; ").slice(0, 2_000),
          }),
    });
  } catch {
    // The new service is already healthy. A metadata write failure must never
    // roll a valid installation back; the next scheduled run reconciles it.
  }
}

export async function executeUpdater(
  config: UpdaterConfig,
  dependencies: UpdaterDependencies = {},
): Promise<void> {
  assertSafeUpdaterPaths(config);
  const resolvedDependencies: ResolvedUpdaterDependencies = {
    fetchImpl: dependencies.fetchImpl ?? fetch,
    runCommand: dependencies.runCommand ?? defaultRunCommand,
    sleep: dependencies.sleep ?? defaultSleep,
    checkRelease: dependencies.checkRelease ?? checkLatestRelease,
    downloadRelease: dependencies.downloadRelease ?? downloadVerifiedRelease,
  };
  const store = new UpdateStore(config.stateDir);
  await store.initialize();
  await assertSafeUpdaterPathsOnDisk(config);
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireLock(store);
    const policy = await store.policy("NOTIFY");
    const request = await store.readRequest();
    const previousStatus = await store.readStatus();
    if (policy.mode === "DISABLED" && request === undefined) return;
    await writeStatus(store, "CHECKING", SQUAD_VERSION);
    const result = await resolvedDependencies.checkRelease(
      SQUAD_VERSION,
      config.repository,
      resolvedDependencies.fetchImpl,
    );
    const statusBase = {
      latestVersion: result.latestVersion,
      available: result.available,
      checkedAt: result.checkedAt,
      ...(result.release === undefined
        ? {}
        : { releaseUrl: result.release.releaseUrl }),
    };
    if (!result.available || result.release === undefined) {
      await writeStatus(store, "UP_TO_DATE", SQUAD_VERSION, statusBase);
      await store.clearRequest();
      return;
    }
    if (
      request?.requestedVersion !== undefined &&
      request.requestedVersion !== result.latestVersion
    ) {
      await writeStatus(store, "BLOCKED", SQUAD_VERSION, {
        ...statusBase,
        errorCode: "REQUEST_VERSION_CHANGED",
        detail:
          "the latest release changed after approval; review and approve the new version",
      });
      await store.clearRequest();
      return;
    }
    const shouldInstall = request !== undefined || policy.mode === "AUTOMATIC";
    if (!shouldInstall) {
      await writeStatus(store, "AVAILABLE", SQUAD_VERSION, statusBase);
      return;
    }
    if (
      request === undefined &&
      previousStatus?.phase === "ROLLED_BACK" &&
      previousStatus.latestVersion === result.latestVersion
    ) {
      await writeStatus(store, "BLOCKED", SQUAD_VERSION, {
        ...statusBase,
        errorCode: "ROLLED_BACK_VERSION_SUPPRESSED",
        detail:
          "automatic retry is suppressed for a version that previously failed; install it explicitly to retry",
      });
      return;
    }
    try {
      const expectedNodeId = await assertNodeIdle(
        config,
        resolvedDependencies.fetchImpl,
      );
      await installRelease(
        config,
        result.release,
        SQUAD_VERSION,
        expectedNodeId,
        store,
        resolvedDependencies,
      );
    } catch (error) {
      if (error instanceof UpdateBlockedError) {
        await writeStatus(store, "BLOCKED", SQUAD_VERSION, {
          ...statusBase,
          errorCode: error.code,
          detail: error.message,
        });
        return;
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof UpdateBlockedError) return;
    const previous = await store.readStatus();
    if (
      previous?.phase !== "ROLLED_BACK" &&
      previous?.errorCode !== "UPDATE_ROLLBACK_FAILED"
    ) {
      await writeStatus(store, "FAILED", SQUAD_VERSION, {
        ...(previous?.latestVersion === undefined
          ? {}
          : { latestVersion: previous.latestVersion }),
        ...(previous?.releaseUrl === undefined
          ? {}
          : { releaseUrl: previous.releaseUrl }),
        available: previous?.available ?? false,
        checkedAt: new Date().toISOString(),
        errorCode: "UPDATE_RUN_FAILED",
        detail: detail(error),
      });
    }
    throw error;
  } finally {
    await releaseLock?.();
  }
}

export async function updaterStatusText(
  config: UpdaterConfig,
): Promise<string> {
  const store = new UpdateStore(config.stateDir);
  await store.initialize();
  const status = await store.readStatus();
  const request = await store.readRequest();
  const automation = await store.readAutomation();
  return JSON.stringify(
    {
      policy: await store.policy("NOTIFY"),
      ...(status === undefined ? {} : { status }),
      ...(request === undefined ? {} : { request }),
      ...(automation === undefined ? {} : { automation }),
    },
    null,
    2,
  );
}
