import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedVersion = process.argv[2];
const supportedCompatibilityVersions = new Set(["0.1.0-rc.6"]);
const legacyDshPackages = [
  "@deepseek-ai/dsh-client-schema-form",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-web",
  "@deepseek-ai/dsh-client-web-react",
];

if (
  requestedVersion === undefined ||
  !supportedCompatibilityVersions.has(requestedVersion)
) {
  throw new Error(
    `usage: node scripts/test-dsh-compat.mjs ${[
      ...supportedCompatibilityVersions,
    ].join("|")}`,
  );
}

const temporaryRoot = await mkdtemp(
  join(tmpdir(), `dsh-squad-compat-${requestedVersion.replaceAll(".", "-")}-`),
);
const workspace = join(temporaryRoot, "workspace");
const keep = process.env.SQUAD_COMPAT_KEEP === "1";
const compatibilitySources = [
  ".npmrc",
  "package.json",
  "packages",
  "pnpm-workspace.yaml",
  "scripts",
  "tests",
  "tsconfig.json",
  "vitest.config.ts",
];

function includeSource(source) {
  const path = relative(sourceRoot, source);
  if (path === "") return true;
  if (path === "pnpm-lock.yaml") return false;
  const segments = path.split(sep);
  if (
    segments.some((segment) =>
      [".git", "artifacts", "coverage", "dist", "node_modules"].includes(
        segment,
      ),
    )
  ) {
    return false;
  }
  return !segments.some(
    (segment) =>
      segment.startsWith(".env") ||
      /^release-signing-key.*\.pem$/u.test(segment),
  );
}

async function updateManifest(path, update) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  update(manifest);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${String(result.status)}`,
    );
  }
}

try {
  process.stdout.write(
    `Creating isolated DeepSeek Harness ${requestedVersion} compatibility workspace at ${workspace}\n`,
  );
  await mkdir(workspace, { recursive: true });
  for (const source of compatibilitySources) {
    await cp(join(sourceRoot, source), join(workspace, source), {
      recursive: true,
      filter: includeSource,
    });
  }
  const sourceLockfile = await readFile(
    join(sourceRoot, "pnpm-lock.yaml"),
    "utf8",
  );
  const dshPackageNames = new Set([
    ...legacyDshPackages,
    ...[
      ...sourceLockfile.matchAll(
        /^ {2}['"]?(@deepseek-ai\/dsh(?:-[^@'":\s]+)?)@/gmu,
      ),
    ].map((match) => match[1]),
  ]);
  await updateManifest(join(workspace, "package.json"), (manifest) => {
    manifest.devDependencies["@deepseek-ai/dsh"] = requestedVersion;
    manifest.pnpm ??= {};
    manifest.pnpm.overrides = Object.fromEntries(
      [...dshPackageNames]
        .sort()
        .map((packageName) => [packageName, requestedVersion]),
    );
  });
  await updateManifest(
    join(workspace, "packages", "plugin", "package.json"),
    (manifest) => {
      for (const name of Object.keys(manifest.devDependencies)) {
        if (name.startsWith("@deepseek-ai/dsh-")) {
          manifest.devDependencies[name] = requestedVersion;
        }
      }
    },
  );

  run("pnpm", ["install", "--no-frozen-lockfile"]);
  run("pnpm", ["typecheck"]);
  run("pnpm", ["build"]);
  run("pnpm", ["test"]);
  run("pnpm", ["smoke:delegation"]);
  process.stdout.write(
    `PASS: Squad is compatible with DeepSeek Harness ${requestedVersion}\n`,
  );
} finally {
  if (keep) {
    process.stdout.write(`Compatibility workspace retained at ${workspace}\n`);
  } else {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
