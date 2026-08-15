import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function bundle(entry, output) {
  await mkdir(dirname(output), { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node24"],
    external: ["@deepseek-ai/*"],
    legalComments: "none",
    sourcemap: false,
  });
}

await Promise.all([
  bundle(
    resolve(root, "src/host/plugin.ts"),
    resolve(root, "dist/host/plugin.js"),
  ),
  bundle(
    resolve(root, "src/shared/index.ts"),
    resolve(root, "dist/shared/index.js"),
  ),
]);
