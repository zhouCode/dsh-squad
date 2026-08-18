import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";
import { z } from "zod";

const unitSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.@:-]+\.service$/u)
  .max(240);
const absolutePathSchema = z
  .string()
  .min(1)
  .refine(isAbsolute, "path must be absolute");

function loopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export const updaterConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
    stateDir: absolutePathSchema,
    dshHome: absolutePathSchema,
    profile: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
    serviceUnit: unitSchema,
    // v0.5 intentionally supports only user services. A system-scoped unit
    // would otherwise execute updater code from a user-writable DSH profile
    // with root privileges.
    scope: z.literal("user"),
    healthUrl: z
      .string()
      .refine(loopbackUrl, "healthUrl must use loopback HTTP"),
    stateUrl: z.string().refine(loopbackUrl, "stateUrl must use loopback HTTP"),
    dataPaths: z.array(absolutePathSchema).min(1).max(20),
    nodeCommand: absolutePathSchema,
    pnpmCommand: absolutePathSchema,
    retainBackups: z.number().int().min(1).max(20).default(3),
  })
  .transform((config) => ({
    ...config,
    stateDir: resolve(config.stateDir),
    dshHome: resolve(config.dshHome),
    dataPaths: config.dataPaths.map((path) => resolve(path)),
    nodeCommand: resolve(config.nodeCommand),
    pnpmCommand: resolve(config.pnpmCommand),
  }));

export type UpdaterConfig = z.infer<typeof updaterConfigSchema>;

export function updaterProfileDir(config: UpdaterConfig): string {
  return join(config.dshHome, "profiles", config.profile);
}

export function assertSafeUpdaterPaths(config: UpdaterConfig): void {
  const forbidden = new Set([
    resolve("/"),
    resolve(homedir()),
    resolve(config.dshHome),
    resolve(config.stateDir),
    resolve(updaterProfileDir(config)),
  ]);
  const profileDir = resolve(updaterProfileDir(config));
  const stateDir = resolve(config.stateDir);
  for (const dataPath of config.dataPaths) {
    const path = resolve(dataPath);
    if (forbidden.has(path)) {
      throw new Error(`unsafe updater data path: ${path}`);
    }
    if (
      profileDir.startsWith(`${path}/`) ||
      stateDir.startsWith(`${path}/`) ||
      path.startsWith(`${profileDir}/`) ||
      path.startsWith(`${stateDir}/`)
    ) {
      throw new Error(`updater paths must not overlap: ${path}`);
    }
  }
}

export async function assertSafeUpdaterPathsOnDisk(
  config: UpdaterConfig,
): Promise<void> {
  assertSafeUpdaterPaths(config);
  const profileDir = updaterProfileDir(config);
  const profileMetadata = await lstat(profileDir);
  if (profileMetadata.isSymbolicLink() || !profileMetadata.isDirectory()) {
    throw new Error("the DSH profile must be a real directory");
  }
  const resolvedHome = await realpath(homedir());
  const resolvedDshHome = await realpath(config.dshHome);
  const resolvedState = await realpath(config.stateDir);
  const resolvedProfile = await realpath(profileDir);
  const forbidden = new Set([
    resolve("/"),
    resolvedHome,
    resolvedDshHome,
    resolvedState,
    resolvedProfile,
  ]);
  const seen = new Set<string>();
  for (const dataPath of config.dataPaths) {
    const metadata = await lstat(dataPath);
    if (
      metadata.isSymbolicLink() ||
      (!metadata.isDirectory() && !metadata.isFile())
    ) {
      throw new Error(
        `updater data path must be a real file or directory: ${dataPath}`,
      );
    }
    const path = await realpath(dataPath);
    if (forbidden.has(path) || seen.has(path)) {
      throw new Error(`unsafe or duplicate updater data path: ${dataPath}`);
    }
    if (
      resolvedProfile.startsWith(`${path}/`) ||
      resolvedState.startsWith(`${path}/`) ||
      path.startsWith(`${resolvedProfile}/`) ||
      path.startsWith(`${resolvedState}/`)
    ) {
      throw new Error(`updater paths must not overlap: ${dataPath}`);
    }
    seen.add(path);
  }
}

export async function loadUpdaterConfig(path: string): Promise<UpdaterConfig> {
  const resolved = resolve(path);
  const metadata = await lstat(resolved);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("updater config must be a regular file");
  }
  if (metadata.size > 256 * 1024) {
    throw new Error("updater config exceeds the size limit");
  }
  const config = updaterConfigSchema.parse(
    JSON.parse(await readFile(resolved, "utf8")),
  );
  assertSafeUpdaterPaths(config);
  return config;
}
