import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalBytes, sha256Hex } from "../shared/canonical.ts";
import {
  compareVersions,
  releaseManifestSchema,
  type ReleaseManifest,
} from "../shared/updates.ts";
import { DSH_VERSION } from "../shared/version.ts";

const MAX_METADATA_BYTES = 256 * 1024;
const MAX_REDIRECTS = 5;
const DEFAULT_REPOSITORY = "zhouCode/dsh-squad";

export const PINNED_RELEASE_PUBLIC_KEY = readFileSync(
  new URL("../../release-signing-public.pem", import.meta.url),
  "utf8",
);

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: GithubAsset[];
}

export interface VerifiedRelease {
  manifest: ReleaseManifest;
  releaseUrl: string;
  assetUrl: string;
}

export interface ReleaseCheck {
  checkedAt: string;
  available: boolean;
  latestVersion: string;
  release?: VerifiedRelease;
}

function publicKeyObject(publicKeyPem: string): KeyObject {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("release public key must be Ed25519");
  }
  return key;
}

export function releaseKeyId(publicKeyPem: string): string {
  const der = publicKeyObject(publicKeyPem).export({
    type: "spki",
    format: "der",
  });
  return createHash("sha256").update(der).digest("hex");
}

export function verifyReleaseManifest(
  value: unknown,
  signatureBase64: string,
  publicKeyPem = PINNED_RELEASE_PUBLIC_KEY,
): ReleaseManifest {
  const manifest = releaseManifestSchema.parse(value);
  if (manifest.tag !== `v${manifest.version}`) {
    throw new Error("release manifest tag/version mismatch");
  }
  if (manifest.keyId !== releaseKeyId(publicKeyPem)) {
    throw new Error("release manifest key ID is not pinned");
  }
  const normalizedSignature = signatureBase64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(normalizedSignature)) {
    throw new Error("release manifest signature is not valid base64");
  }
  const signature = Buffer.from(normalizedSignature, "base64");
  if (signature.byteLength !== 64) {
    throw new Error("release manifest signature has an invalid length");
  }
  if (
    !verify(
      null,
      canonicalBytes(manifest),
      publicKeyObject(publicKeyPem),
      signature,
    )
  ) {
    throw new Error("release manifest signature verification failed");
  }
  return manifest;
}

function assertRepository(repository: string): string {
  const normalized = repository.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized)) {
    throw new Error(
      "updates.repository must use the GitHub owner/repository form",
    );
  }
  return normalized;
}

function allowedUrl(url: URL, repository: string, metadata: boolean): boolean {
  if (url.protocol !== "https:") return false;
  if (metadata) {
    return (
      url.hostname === "api.github.com" &&
      url.pathname.startsWith(`/repos/${repository}/releases/`)
    );
  }
  if (url.hostname === "github.com") {
    return url.pathname.startsWith(`/${repository}/releases/download/`);
  }
  return [
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
  ].includes(url.hostname);
}

async function fetchFollowingTrustedRedirects(
  initialUrl: string,
  repository: string,
  options: RequestInit,
  metadata: boolean,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let url = new URL(initialUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!allowedUrl(url, repository, metadata)) {
      throw new Error(`untrusted update URL: ${url.origin}`);
    }
    const response = await fetchImpl(url, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (location === null) throw new Error("update redirect has no location");
    url = new URL(location, url);
    metadata = false;
    options = {
      ...options,
      headers: Object.fromEntries(
        Object.entries(options.headers ?? {}).filter(
          ([name]) => name.toLowerCase() !== "authorization",
        ),
      ),
    };
  }
  throw new Error("update download exceeded the redirect limit");
}

async function responseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.ok) {
    throw new Error(`update server returned HTTP ${response.status}`);
  }
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      throw new Error("update response has an invalid content length");
    }
    if (declaredBytes > maxBytes) {
      throw new Error("update response exceeds the configured size limit");
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error("update response exceeds the configured size limit");
  }
  return bytes;
}

async function fetchMetadata(
  url: string,
  repository: string,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const response = await fetchFollowingTrustedRedirects(
    url,
    repository,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": `dsh-squad-update/${process.version}`,
        "x-github-api-version": "2022-11-28",
        ...(token === undefined || token.length === 0
          ? {}
          : { authorization: `Bearer ${token}` }),
      },
    },
    true,
    fetchImpl,
  );
  return responseBytes(response, MAX_METADATA_BYTES);
}

async function fetchReleaseAsset(
  url: string,
  repository: string,
  maxBytes: number,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  const response = await fetchFollowingTrustedRedirects(
    url,
    repository,
    {
      headers: {
        accept: "application/octet-stream",
        "user-agent": `dsh-squad-update/${process.version}`,
      },
    },
    false,
    fetchImpl,
  );
  return responseBytes(response, maxBytes);
}

function asset(release: GithubRelease, name: string): GithubAsset {
  const matches = release.assets.filter((candidate) => candidate.name === name);
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`release must contain exactly one ${name} asset`);
  }
  return matches[0];
}

export async function checkLatestRelease(
  currentVersion: string,
  repository = DEFAULT_REPOSITORY,
  fetchImpl: typeof fetch = fetch,
  publicKeyPem = PINNED_RELEASE_PUBLIC_KEY,
): Promise<ReleaseCheck> {
  const checkedAt = new Date().toISOString();
  const normalizedRepository = assertRepository(repository);
  const apiUrl = `https://api.github.com/repos/${normalizedRepository}/releases/latest`;
  const release = JSON.parse(
    Buffer.from(
      await fetchMetadata(apiUrl, normalizedRepository, fetchImpl),
    ).toString("utf8"),
  ) as GithubRelease;
  if (
    typeof release.tag_name !== "string" ||
    typeof release.html_url !== "string" ||
    release.draft ||
    release.prerelease ||
    !Array.isArray(release.assets)
  ) {
    throw new Error("GitHub latest release metadata is invalid");
  }
  const version = release.tag_name.startsWith("v")
    ? release.tag_name.slice(1)
    : release.tag_name;
  const manifestName = `dsh-squad-update-manifest-${version}.json`;
  const signatureName = `${manifestName}.sig`;
  const manifestAsset = asset(release, manifestName);
  const signatureAsset = asset(release, signatureName);
  const manifestValue = JSON.parse(
    Buffer.from(
      await fetchReleaseAsset(
        manifestAsset.browser_download_url,
        normalizedRepository,
        MAX_METADATA_BYTES,
        fetchImpl,
      ),
    ).toString("utf8"),
  ) as unknown;
  const signature = Buffer.from(
    await fetchReleaseAsset(
      signatureAsset.browser_download_url,
      normalizedRepository,
      16 * 1024,
      fetchImpl,
    ),
  ).toString("utf8");
  const manifest = verifyReleaseManifest(
    manifestValue,
    signature,
    publicKeyPem,
  );
  if (manifest.version !== version || manifest.tag !== release.tag_name) {
    throw new Error("GitHub release and signed manifest do not match");
  }
  const expectedReleaseUrl = `https://github.com/${normalizedRepository}/releases/tag/${release.tag_name}`;
  if (release.html_url !== expectedReleaseUrl) {
    throw new Error(
      "GitHub release page URL is outside the configured repository",
    );
  }
  if (manifest.asset.name !== `dsh-squad-plugin-${version}.tgz`) {
    throw new Error("signed manifest contains an unexpected package filename");
  }
  if (compareVersions(manifest.minDshVersion, DSH_VERSION) > 0) {
    throw new Error(
      `release requires DSH ${manifest.minDshVersion}, but this updater is pinned to ${DSH_VERSION}`,
    );
  }
  const packageAsset = asset(release, manifest.asset.name);
  if (packageAsset.size !== manifest.asset.size) {
    throw new Error("GitHub asset size and signed manifest do not match");
  }
  const checksumName = `${manifest.asset.name}.sha256`;
  const checksumAsset = asset(release, checksumName);
  const checksum = Buffer.from(
    await fetchReleaseAsset(
      checksumAsset.browser_download_url,
      normalizedRepository,
      4 * 1024,
      fetchImpl,
    ),
  )
    .toString("utf8")
    .trim();
  if (checksum !== `${manifest.asset.sha256}  ${manifest.asset.name}`) {
    throw new Error(
      "release checksum asset does not match the signed manifest",
    );
  }
  const verifiedRelease: VerifiedRelease = {
    manifest,
    releaseUrl: release.html_url,
    assetUrl: packageAsset.browser_download_url,
  };
  return {
    checkedAt,
    available: compareVersions(manifest.version, currentVersion) > 0,
    latestVersion: manifest.version,
    release: verifiedRelease,
  };
}

export async function downloadVerifiedRelease(
  release: VerifiedRelease,
  repository = DEFAULT_REPOSITORY,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const normalizedRepository = assertRepository(repository);
  const bytes = await fetchReleaseAsset(
    release.assetUrl,
    normalizedRepository,
    release.manifest.asset.size,
    fetchImpl,
  );
  if (bytes.byteLength !== release.manifest.asset.size) {
    throw new Error("downloaded package size does not match signed manifest");
  }
  if (sha256Hex(bytes) !== release.manifest.asset.sha256) {
    throw new Error(
      "downloaded package SHA-256 does not match signed manifest",
    );
  }
  return bytes;
}
