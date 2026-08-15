import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "src/client/index.tsx");
const output = resolve(root, "dist/client.js");

const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  external: [
    "react",
    "react/jsx-runtime",
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-client-runtime/client",
    "@deepseek-ai/dsh-client-ui-layout/client",
    "@deepseek-ai/dsh-client-ui-sidebar/client",
  ],
  legalComments: "none",
  sourcemap: false,
});

const bundled = result.outputFiles?.[0];
if (bundled === undefined) throw new Error("esbuild produced no client bundle");
const code = bundled.text;
const wrapped = `window.__ModuleLoader__.load({
  id: "@dsh-squad/plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${code
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
    return module.exports;
  }
});
`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, wrapped, "utf8");

const manifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
if (manifest.dsh?.client?.platform !== "web") {
  throw new Error("plugin manifest must declare dsh.client.platform=web");
}
