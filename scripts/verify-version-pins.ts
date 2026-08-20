import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  DSH_VERSION,
  SQUAD_VERSION,
} from "../packages/plugin/src/shared/version.ts";

const root = new URL("../", import.meta.url);
const expectedDsh = "0.1.0-rc.6";
const expectedCordis = "4.0.1";
const expectedSquad = "0.7.2";
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

interface PackageManifest {
  name?: string;
  version?: string;
  packageManager?: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

async function packageFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".git"
    )
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await packageFiles(path)));
    else if (entry.name === "package.json") files.push(path);
  }
  return files;
}

const projectRoot = root.pathname;
const failures: string[] = [];
if (SQUAD_VERSION !== expectedSquad) {
  failures.push(
    `packages/plugin/src/shared/version.ts SQUAD_VERSION must be ${expectedSquad}, found ${SQUAD_VERSION}`,
  );
}
if (DSH_VERSION !== expectedDsh) {
  failures.push(
    `packages/plugin/src/shared/version.ts DSH_VERSION must be ${expectedDsh}, found ${DSH_VERSION}`,
  );
}
for (const path of await packageFiles(projectRoot)) {
  const manifest = JSON.parse(await readFile(path, "utf8")) as PackageManifest;
  if (
    ["dsh-squad", "@dsh-squad/plugin"].includes(manifest.name ?? "") &&
    manifest.version !== expectedSquad
  ) {
    failures.push(
      `${relative(projectRoot, path)}: version must be ${expectedSquad}, found ${manifest.version ?? "missing"}`,
    );
  }
  for (const field of dependencyFields) {
    const dependencies = manifest[field] ?? {};
    for (const [name, version] of Object.entries(dependencies)) {
      if (
        (name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-")) &&
        version !== expectedDsh
      ) {
        failures.push(
          `${relative(projectRoot, path)}: ${name} must be ${expectedDsh}, found ${version}`,
        );
      }
      if (name === "@deepseek-ai/cordis" && version !== expectedCordis) {
        failures.push(
          `${relative(projectRoot, path)}: ${name} must be ${expectedCordis}, found ${version}`,
        );
      }
    }
  }
}

const rootManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as PackageManifest;
if (rootManifest.packageManager !== "pnpm@10.28.2") {
  failures.push("package.json packageManager must be pnpm@10.28.2");
}
if (rootManifest.engines?.node !== ">=24.18.0 <25") {
  failures.push("package.json engines.node must be >=24.18.0 <25");
}
for (const filename of [".node-version", ".nvmrc"]) {
  const value = (
    await readFile(new URL(`../${filename}`, import.meta.url), "utf8")
  ).trim();
  if (value !== "24.18.0") failures.push(`${filename} must pin Node 24.18.0`);
}

if (failures.length > 0) {
  throw new Error(`version pin verification failed:\n${failures.join("\n")}`);
}

console.log(
  `Verified Squad ${expectedSquad}, Node 24.18.0, pnpm 10.28.2, DSH ${expectedDsh}, and Cordis ${expectedCordis} pins.`,
);
