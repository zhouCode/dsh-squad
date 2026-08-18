import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { SQUAD_VERSION } from "../shared/version.ts";
import {
  loadUpdaterConfig,
  updaterConfigSchema,
  type UpdaterConfig,
} from "./config.ts";
import { executeUpdater, updaterStatusText } from "./executor.ts";
import { installSystemdUpdater } from "./systemd.ts";

function optionValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${name} requires a value`);
      }
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function option(args: string[], name: string): string | undefined {
  const values = optionValues(args, name);
  if (values.length > 1) throw new Error(`${name} may only be provided once`);
  return values[0];
}

function requiredOption(args: string[], name: string): string {
  const value = option(args, name)?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function executableOnPath(name: string): Promise<string> {
  const path = process.env.PATH ?? "";
  for (const directory of path.split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = resolve(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  throw new Error(`${name} was not found on PATH; pass --pnpm-command`);
}

function usage(): string {
  return `DSH Squad updater ${SQUAD_VERSION}

Usage:
  dsh-squad-update install-systemd --dsh-home PATH --service-unit NAME --base-url URL --data-path PATH [options]
  dsh-squad-update run --config PATH
  dsh-squad-update status --config PATH
  dsh-squad-update version

install-systemd options:
  --profile NAME          DSH profile (default: web)
  --state-dir PATH        Shared update state (default: DSH_HOME/squad-updates)
  --data-path PATH        Data directory or file to back up; repeat as needed
  --scope user            systemd scope; v0.5 accepts user only (default: user)
  --repository OWNER/REPO Release repository (default: zhouCode/dsh-squad)
  --node-command PATH     Node executable for systemd (default: current Node)
  --pnpm-command PATH     pnpm executable (default: discovered on PATH)
  --retain-backups NUMBER Number of successful backups retained (default: 3)
`;
}

async function configFromInstallArgs(args: string[]): Promise<UpdaterConfig> {
  const dshHomeValue = option(args, "--dsh-home") ?? process.env.DSH_HOME;
  if (dshHomeValue === undefined || dshHomeValue.trim().length === 0) {
    throw new Error("--dsh-home is required when DSH_HOME is not set");
  }
  const dshHome = resolve(dshHomeValue);
  const baseUrl = requiredOption(args, "--base-url").replace(/\/$/u, "");
  const scope = option(args, "--scope") ?? "user";
  const retainBackups = Number(option(args, "--retain-backups") ?? "3");
  return updaterConfigSchema.parse({
    schemaVersion: 1,
    repository: option(args, "--repository") ?? "zhouCode/dsh-squad",
    stateDir: option(args, "--state-dir") ?? join(dshHome, "squad-updates"),
    dshHome,
    profile: option(args, "--profile") ?? "web",
    serviceUnit: requiredOption(args, "--service-unit"),
    scope,
    healthUrl: `${baseUrl}/squad/v1/health`,
    stateUrl: `${baseUrl}/squad/v1/local/state`,
    dataPaths: optionValues(args, "--data-path"),
    nodeCommand: option(args, "--node-command") ?? process.execPath,
    pnpmCommand:
      option(args, "--pnpm-command") ?? (await executableOnPath("pnpm")),
    retainBackups,
  });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === "help" || command === "--help") {
    process.stdout.write(usage());
    return;
  }
  if (command === "version" || command === "--version") {
    process.stdout.write(`${SQUAD_VERSION}\n`);
    return;
  }
  if (command === "install-systemd") {
    const automation = await installSystemdUpdater(
      await configFromInstallArgs(args),
    );
    process.stdout.write(`${JSON.stringify(automation, null, 2)}\n`);
    return;
  }
  if (command === "run" || command === "status") {
    const config = await loadUpdaterConfig(requiredOption(args, "--config"));
    if (command === "run") await executeUpdater(config);
    process.stdout.write(`${await updaterStatusText(config)}\n`);
    return;
  }
  throw new Error(`unknown command: ${command}\n\n${usage()}`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `dsh-squad-update: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
