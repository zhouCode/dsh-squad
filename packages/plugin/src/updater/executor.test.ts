import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../shared/canonical.ts";
import type { ReleaseManifest } from "../shared/updates.ts";
import { SQUAD_VERSION } from "../shared/version.ts";
import type { VerifiedRelease } from "../update/release.ts";
import { UpdateStore } from "../update/storage.ts";
import { updaterConfigSchema, updaterProfileDir } from "./config.ts";
import { executeUpdater, type UpdaterDependencies } from "./executor.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "squad-updater-"));
  temporaryDirectories.push(root);
  const packageBytes = Buffer.from("verified update package");
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    package: "@dsh-squad/plugin",
    version: "0.6.0",
    tag: "v0.6.0",
    keyId: "1".repeat(64),
    publishedAt: "2026-08-19T00:00:00.000Z",
    asset: {
      name: "dsh-squad-plugin-0.6.0.tgz",
      size: packageBytes.byteLength,
      sha256: sha256Hex(packageBytes),
    },
    minDshVersion: "0.1.0-rc.6",
  };
  const release: VerifiedRelease = {
    manifest,
    releaseUrl: "https://github.com/zhouCode/dsh-squad/releases/tag/v0.6.0",
    assetUrl:
      "https://github.com/zhouCode/dsh-squad/releases/download/v0.6.0/dsh-squad-plugin-0.6.0.tgz",
  };
  const config = updaterConfigSchema.parse({
    schemaVersion: 1,
    repository: "zhouCode/dsh-squad",
    stateDir: join(root, "update-state"),
    dshHome: join(root, "dsh-home"),
    profile: "web",
    serviceUnit: "squad-test-relay.service",
    scope: "user",
    healthUrl: "http://127.0.0.1:37100/squad/v1/health",
    stateUrl: "http://127.0.0.1:37100/squad/v1/local/state",
    dataPaths: [join(root, "node-data"), join(root, "relay-data")],
    nodeCommand: process.execPath,
    pnpmCommand: "/test/pnpm",
    retainBackups: 3,
  });
  const profile = updaterProfileDir(config);
  await mkdir(profile, { recursive: true });
  await mkdir(config.dataPaths[0]!, { recursive: true });
  await mkdir(config.dataPaths[1]!, { recursive: true });
  await writeFile(join(profile, "version.txt"), SQUAD_VERSION);
  await writeFile(join(config.dataPaths[0]!, "node.txt"), "node data");
  await writeFile(join(config.dataPaths[1]!, "relay.txt"), "relay data");
  const store = new UpdateStore(config.stateDir);
  await store.initialize();
  await store.writePolicy({
    schemaVersion: 1,
    mode: "AUTOMATIC",
    updatedAt: "2026-08-19T00:00:00.000Z",
  });
  return { config, profile, release, packageBytes, store };
}

function dependencies(
  profile: string,
  release: VerifiedRelease,
  packageBytes: Uint8Array,
  failNewHealth: boolean,
): UpdaterDependencies {
  return {
    checkRelease: async () => ({
      checkedAt: "2026-08-19T01:00:00.000Z",
      available: true,
      latestVersion: release.manifest.version,
      release,
    }),
    downloadRelease: async () => packageBytes,
    runCommand: async (command) => {
      if (command === "/test/pnpm") {
        await writeFile(join(profile, "version.txt"), release.manifest.version);
      }
    },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/local/state")) {
        const installed = await readFile(join(profile, "version.txt"), "utf8");
        return new Response(
          JSON.stringify({
            identity: { nodeId: "node_test_relay" },
            delegations: [],
            plans: [],
            updates: { currentVersion: installed },
          }),
        );
      }
      const installed = await readFile(join(profile, "version.txt"), "utf8");
      return new Response(
        JSON.stringify({
          ok: true,
          version:
            failNewHealth && installed === release.manifest.version
              ? "unhealthy"
              : installed,
        }),
      );
    },
    sleep: async () => undefined,
  };
}

describe("external updater execution", () => {
  it("backs up, installs, restarts, and records the new version", async () => {
    const value = await fixture();
    await executeUpdater(
      value.config,
      dependencies(value.profile, value.release, value.packageBytes, false),
    );
    expect(await readFile(join(value.profile, "version.txt"), "utf8")).toBe(
      "0.6.0",
    );
    expect((await value.store.readStatus())?.phase).toBe("INSTALLED");
    expect((await value.store.readStatus())?.currentVersion).toBe("0.6.0");
    expect((await readdir(join(value.config.stateDir, "backups"))).length).toBe(
      1,
    );
  });

  it("restores profile and data when the upgraded Relay fails health checks", async () => {
    const value = await fixture();
    await expect(
      executeUpdater(
        value.config,
        dependencies(value.profile, value.release, value.packageBytes, true),
      ),
    ).rejects.toThrow("Relay health check failed");
    expect(await readFile(join(value.profile, "version.txt"), "utf8")).toBe(
      SQUAD_VERSION,
    );
    expect(
      await readFile(join(value.config.dataPaths[0]!, "node.txt"), "utf8"),
    ).toBe("node data");
    expect((await value.store.readStatus())?.phase).toBe("ROLLED_BACK");
  });

  it("defers installation while a delegation is active", async () => {
    const value = await fixture();
    const base = dependencies(
      value.profile,
      value.release,
      value.packageBytes,
      false,
    );
    const commands: string[] = [];
    await executeUpdater(value.config, {
      ...base,
      runCommand: async (command) => {
        commands.push(command);
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/local/state")) {
          return new Response(
            JSON.stringify({
              identity: { nodeId: "node_test_relay" },
              delegations: [{ status: "RUNNING" }],
              plans: [],
              updates: { currentVersion: SQUAD_VERSION },
            }),
          );
        }
        return new Response(
          JSON.stringify({ ok: true, version: SQUAD_VERSION }),
        );
      },
    });
    expect(commands).toEqual([]);
    expect((await value.store.readStatus())?.phase).toBe("BLOCKED");
    expect((await value.store.readStatus())?.errorCode).toBe("ACTIVE_WORK");
    expect(await readFile(join(value.profile, "version.txt"), "utf8")).toBe(
      SQUAD_VERSION,
    );
  });

  it("fails closed when the local Node state cannot be authenticated", async () => {
    const value = await fixture();
    const base = dependencies(
      value.profile,
      value.release,
      value.packageBytes,
      false,
    );
    const commands: string[] = [];
    await executeUpdater(value.config, {
      ...base,
      runCommand: async (command) => {
        commands.push(command);
      },
      fetchImpl: async () =>
        new Response(JSON.stringify({ delegations: [], plans: [] })),
    });
    expect(commands).toEqual([]);
    expect((await value.store.readStatus())?.phase).toBe("BLOCKED");
    expect((await value.store.readStatus())?.errorCode).toBe(
      "NODE_STATE_UNAVAILABLE",
    );
  });

  it("rolls back when the restarted endpoint belongs to a different Node", async () => {
    const value = await fixture();
    const base = dependencies(
      value.profile,
      value.release,
      value.packageBytes,
      false,
    );
    await expect(
      executeUpdater(value.config, {
        ...base,
        fetchImpl: async (input) => {
          const installed = await readFile(
            join(value.profile, "version.txt"),
            "utf8",
          );
          if (String(input).endsWith("/local/state")) {
            return new Response(
              JSON.stringify({
                identity: {
                  nodeId:
                    installed === value.release.manifest.version
                      ? "node_wrong_relay"
                      : "node_test_relay",
                },
                delegations: [],
                plans: [],
                updates: { currentVersion: installed },
              }),
            );
          }
          return new Response(JSON.stringify({ ok: true, version: installed }));
        },
      }),
    ).rejects.toThrow("expected Node node_test_relay");
    expect(await readFile(join(value.profile, "version.txt"), "utf8")).toBe(
      SQUAD_VERSION,
    );
    expect((await value.store.readStatus())?.phase).toBe("ROLLED_BACK");
  });

  it("does not reclaim an old lock while its owning updater is alive", async () => {
    const value = await fixture();
    await writeFile(
      value.store.lockPath,
      `${JSON.stringify({
        pid: process.pid,
        token: "123e4567-e89b-42d3-a456-426614174000",
        createdAt: "2026-08-19T00:00:00.000Z",
      })}\n`,
    );
    const old = new Date(Date.now() - 3 * 60 * 60_000);
    await utimes(value.store.lockPath, old, old);
    let checked = false;
    await executeUpdater(value.config, {
      checkRelease: async () => {
        checked = true;
        throw new Error("must not check while another updater is alive");
      },
    });
    expect(checked).toBe(false);
    expect(await readFile(value.store.lockPath, "utf8")).toContain(
      String(process.pid),
    );
  });

  it("rechecks for active work after staging and before shutdown", async () => {
    const value = await fixture();
    const base = dependencies(
      value.profile,
      value.release,
      value.packageBytes,
      false,
    );
    const commands: string[] = [];
    let stateReads = 0;
    await executeUpdater(value.config, {
      ...base,
      runCommand: async (command) => {
        commands.push(command);
      },
      fetchImpl: async (input) => {
        if (String(input).endsWith("/local/state")) {
          stateReads += 1;
          return new Response(
            JSON.stringify({
              identity: { nodeId: "node_test_relay" },
              delegations: stateReads === 1 ? [] : [{ status: "RUNNING" }],
              plans: [],
              updates: { currentVersion: SQUAD_VERSION },
            }),
          );
        }
        return new Response(
          JSON.stringify({ ok: true, version: SQUAD_VERSION }),
        );
      },
    });
    expect(stateReads).toBe(2);
    expect(commands).toEqual([]);
    expect((await value.store.readStatus())?.phase).toBe("BLOCKED");
    expect((await value.store.readStatus())?.errorCode).toBe("ACTIVE_WORK");
  });
});
