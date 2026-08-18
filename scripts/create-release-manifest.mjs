import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { lstat, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageManifest = JSON.parse(
  await readFile(resolve(root, "packages/plugin/package.json"), "utf8"),
);
const version = String(packageManifest.version);
const expectedAssetName = `dsh-squad-plugin-${version}.tgz`;
const assetPath = resolve(
  process.argv[2] ?? resolve(root, "artifacts", expectedAssetName),
);
if (basename(assetPath) !== expectedAssetName) {
  throw new Error(`release package must be named ${expectedAssetName}`);
}

const signingKeyPath = process.env.DSH_SQUAD_RELEASE_SIGNING_KEY?.trim();
if (signingKeyPath === undefined || signingKeyPath.length === 0) {
  throw new Error(
    "DSH_SQUAD_RELEASE_SIGNING_KEY must point to the Ed25519 release private key",
  );
}
const keyMetadata = await lstat(signingKeyPath);
if (keyMetadata.isSymbolicLink() || !keyMetadata.isFile()) {
  throw new Error("the release signing key must be a regular file");
}
if ((keyMetadata.mode & 0o077) !== 0) {
  throw new Error(
    "the release signing key must not be accessible by group/other",
  );
}
if (
  typeof process.getuid === "function" &&
  keyMetadata.uid !== process.getuid()
) {
  throw new Error("the release signing key must be owned by the current user");
}

const privateKey = createPrivateKey(await readFile(signingKeyPath, "utf8"));
if (privateKey.asymmetricKeyType !== "ed25519") {
  throw new Error("the release signing key must be Ed25519");
}
const derivedPublic = createPublicKey(privateKey);
const pinnedPublic = createPublicKey(
  await readFile(
    resolve(root, "packages/plugin/release-signing-public.pem"),
    "utf8",
  ),
);
const publicDer = derivedPublic.export({ type: "spki", format: "der" });
const pinnedDer = pinnedPublic.export({ type: "spki", format: "der" });
if (!Buffer.from(publicDer).equals(Buffer.from(pinnedDer))) {
  throw new Error(
    "the signing key does not match the public key shipped by Squad",
  );
}

function canonical(value, at = "$") {
  if (value === null) return "null";
  if (["string", "boolean"].includes(typeof value))
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${at} is not finite`);
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonical(item, `${at}[${index}]`)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical(value[key], `${at}.${key}`)}`,
      )
      .join(",")}}`;
  }
  throw new TypeError(`${at} has unsupported type ${typeof value}`);
}

const packageMetadata = await stat(assetPath);
if (!packageMetadata.isFile() || packageMetadata.size <= 0) {
  throw new Error("release package is not a non-empty regular file");
}
if (packageMetadata.size > 100 * 1024 * 1024) {
  throw new Error("release package exceeds the 100 MiB safety limit");
}
const packageBytes = await readFile(assetPath);
const sha256 = createHash("sha256").update(packageBytes).digest("hex");
const publishedAt =
  process.env.DSH_SQUAD_RELEASE_PUBLISHED_AT?.trim() ||
  new Date().toISOString();
if (Number.isNaN(Date.parse(publishedAt))) {
  throw new Error("DSH_SQUAD_RELEASE_PUBLISHED_AT is not an ISO timestamp");
}
const manifest = {
  schemaVersion: 1,
  package: "@dsh-squad/plugin",
  version,
  tag: `v${version}`,
  keyId: createHash("sha256").update(publicDer).digest("hex"),
  publishedAt,
  asset: {
    name: expectedAssetName,
    size: packageMetadata.size,
    sha256,
  },
  minDshVersion: "0.1.0-rc.6",
};
const signature = sign(
  null,
  Buffer.from(canonical(manifest), "utf8"),
  privateKey,
);
const manifestPath = resolve(
  dirname(assetPath),
  `dsh-squad-update-manifest-${version}.json`,
);
const signaturePath = `${manifestPath}.sig`;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o644,
});
await writeFile(signaturePath, `${signature.toString("base64")}\n`, {
  mode: 0o644,
});
await writeFile(`${assetPath}.sha256`, `${sha256}  ${expectedAssetName}\n`, {
  mode: 0o644,
});
process.stdout.write(
  `Signed ${expectedAssetName}\nManifest: ${manifestPath}\nSignature: ${signaturePath}\nKey ID: ${manifest.keyId}\n`,
);
