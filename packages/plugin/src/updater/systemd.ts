import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { UpdateAutomation } from "../shared/updates.ts";
import { atomicWriteJson, UpdateStore } from "../update/storage.ts";
import {
  assertSafeUpdaterPaths,
  assertSafeUpdaterPathsOnDisk,
  updaterConfigSchema,
  updaterProfileDir,
  type UpdaterConfig,
} from "./config.ts";

function quoteSystemd(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function updaterUnitNames(serviceUnit: string): {
  updaterUnit: string;
  timerUnit: string;
  pathUnit: string;
} {
  const base = serviceUnit.replace(/\.service$/u, "");
  return {
    updaterUnit: `${base}-updater.service`,
    timerUnit: `${base}-updater.timer`,
    pathUnit: `${base}-updater.path`,
  };
}

export interface SystemdBundle {
  automation: UpdateAutomation;
  files: Record<string, string>;
}

export function renderSystemdBundle(
  config: UpdaterConfig,
  executable: string,
  configPath: string,
): SystemdBundle {
  const names = updaterUnitNames(config.serviceUnit);
  const requestPath = join(config.stateDir, "update-request.json");
  const updater = `[Unit]
Description=Check and safely install DSH Squad updates
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
Environment=${quoteSystemd(`PATH=${dirname(config.nodeCommand)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`)}
ExecStart=${quoteSystemd(executable)} run --config ${quoteSystemd(configPath)}
`;
  const timer = `[Unit]
Description=Periodic DSH Squad update check

[Timer]
OnBootSec=5min
OnUnitActiveSec=6h
RandomizedDelaySec=30min
Persistent=true
Unit=${names.updaterUnit}

[Install]
WantedBy=timers.target
`;
  const path = `[Unit]
Description=Install a user-approved DSH Squad update

[Path]
PathChanged=${quoteSystemd(requestPath)}
Unit=${names.updaterUnit}

[Install]
WantedBy=default.target
`;
  const automation: UpdateAutomation = {
    schemaVersion: 1,
    configuredAt: new Date().toISOString(),
    scope: config.scope,
    serviceUnit: config.serviceUnit,
    updaterUnit: names.updaterUnit,
    timerUnit: names.timerUnit,
    pathUnit: names.pathUnit,
    configPath,
  };
  return {
    automation,
    files: {
      [names.updaterUnit]: updater,
      [names.timerUnit]: timer,
      [names.pathUnit]: path,
    },
  };
}

async function runSystemctl(args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("systemctl", ["--user", ...args], {
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`systemctl ${args.join(" ")} failed (${code ?? signal})`),
        );
    });
  });
}

async function systemctlOutput(args: string[]): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn("systemctl", ["--user", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8"));
      else {
        reject(
          new Error(
            `systemctl ${args.join(" ")} failed (${code ?? signal}): ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
      }
    });
  });
}

export async function installSystemdUpdater(
  rawConfig: unknown,
): Promise<UpdateAutomation> {
  const config = updaterConfigSchema.parse(rawConfig);
  assertSafeUpdaterPaths(config);
  const profileDir = updaterProfileDir(config);
  const executable = resolve(
    profileDir,
    "node_modules",
    ".bin",
    "dsh-squad-update",
  );
  await access(executable, constants.X_OK);
  await access(config.nodeCommand, constants.X_OK);
  await access(config.pnpmCommand, constants.X_OK);
  const store = new UpdateStore(config.stateDir);
  await store.initialize();
  await assertSafeUpdaterPathsOnDisk(config);
  const loadState = (
    await systemctlOutput([
      "show",
      config.serviceUnit,
      "--property=LoadState",
      "--value",
    ])
  ).trim();
  if (loadState !== "loaded") {
    throw new Error(
      `${config.serviceUnit} is not loaded in the selected systemd scope`,
    );
  }
  const configPath = join(config.stateDir, "updater-config.json");
  await atomicWriteJson(configPath, config);
  const bundle = renderSystemdBundle(config, executable, configPath);
  const unitDirectory = join(homedir(), ".config", "systemd", "user");
  await mkdir(unitDirectory, { recursive: true, mode: 0o755 });
  for (const [name, content] of Object.entries(bundle.files)) {
    const path = join(unitDirectory, basename(name));
    await writeFile(path, content, { encoding: "utf8", mode: 0o644 });
    await chmod(path, 0o644);
  }
  await runSystemctl(["daemon-reload"]);
  await runSystemctl([
    "enable",
    "--now",
    bundle.automation.timerUnit,
    bundle.automation.pathUnit,
  ]);
  await store.writeAutomation(bundle.automation);
  return bundle.automation;
}
