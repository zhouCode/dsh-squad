import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Hex } from "../shared/canonical.ts";
import type { ReleaseManifest } from "../shared/updates.ts";
import {
  assertCompatibleDshVersion,
  checkLatestRelease,
  installedDshVersion,
  releaseKeyId,
  verifyReleaseManifest,
} from "./release.ts";

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({
      type: "spki",
      format: "pem",
    })
    .toString();
  const packageBytes = Buffer.from("signed Squad package fixture", "utf8");
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    package: "@dsh-squad/plugin",
    version: "0.6.0",
    tag: "v0.6.0",
    keyId: releaseKeyId(publicKeyPem),
    publishedAt: "2026-08-19T00:00:00.000Z",
    asset: {
      name: "dsh-squad-plugin-0.6.0.tgz",
      size: packageBytes.byteLength,
      sha256: sha256Hex(packageBytes),
    },
    minDshVersion: "0.1.0-rc.6",
  };
  const signature = sign(null, canonicalBytes(manifest), privateKey).toString(
    "base64",
  );
  return { manifest, signature, publicKeyPem, packageBytes };
}

describe("signed Squad releases", () => {
  it("checks the release minimum against the installed Harness version", () => {
    expect(installedDshVersion()).toMatch(/^0\.1\.[01]-rc\.\d+$/u);
    expect(() =>
      assertCompatibleDshVersion("0.1.1-rc.2", "0.1.0-rc.6"),
    ).toThrow("this Node runs 0.1.0-rc.6");
    expect(() =>
      assertCompatibleDshVersion("0.1.0-rc.6", "0.1.1-rc.2"),
    ).not.toThrow();
  });

  it("accepts a manifest signed by the pinned key argument", () => {
    const value = fixture();
    expect(
      verifyReleaseManifest(
        value.manifest,
        value.signature,
        value.publicKeyPem,
      ),
    ).toEqual(value.manifest);
  });

  it("rejects a manifest changed after signing", () => {
    const value = fixture();
    expect(() =>
      verifyReleaseManifest(
        {
          ...value.manifest,
          asset: { ...value.manifest.asset, sha256: "0".repeat(64) },
        },
        value.signature,
        value.publicKeyPem,
      ),
    ).toThrow("signature verification failed");
  });

  it("binds GitHub metadata, signed metadata, and the package asset", async () => {
    const value = fixture();
    const manifestBytes = Buffer.from(JSON.stringify(value.manifest));
    const signatureBytes = Buffer.from(`${value.signature}\n`);
    const checksumBytes = Buffer.from(
      `${value.manifest.asset.sha256}  ${value.manifest.asset.name}\n`,
    );
    const base =
      "https://github.com/zhouCode/dsh-squad/releases/download/v0.6.0";
    const release = {
      tag_name: "v0.6.0",
      html_url: "https://github.com/zhouCode/dsh-squad/releases/tag/v0.6.0",
      draft: false,
      prerelease: false,
      assets: [
        {
          name: "dsh-squad-update-manifest-0.6.0.json",
          size: manifestBytes.byteLength,
          browser_download_url: `${base}/dsh-squad-update-manifest-0.6.0.json`,
        },
        {
          name: "dsh-squad-update-manifest-0.6.0.json.sig",
          size: signatureBytes.byteLength,
          browser_download_url: `${base}/dsh-squad-update-manifest-0.6.0.json.sig`,
        },
        {
          name: value.manifest.asset.name,
          size: value.packageBytes.byteLength,
          browser_download_url: `${base}/${value.manifest.asset.name}`,
        },
        {
          name: `${value.manifest.asset.name}.sha256`,
          size: checksumBytes.byteLength,
          browser_download_url: `${base}/${value.manifest.asset.name}.sha256`,
        },
      ],
    };
    const responses = new Map<string, Uint8Array>([
      [
        "https://api.github.com/repos/zhouCode/dsh-squad/releases/latest",
        Buffer.from(JSON.stringify(release)),
      ],
      [release.assets[0]!.browser_download_url, manifestBytes],
      [release.assets[1]!.browser_download_url, signatureBytes],
      [release.assets[3]!.browser_download_url, checksumBytes],
    ]);
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      const bytes = responses.get(url);
      if (bytes === undefined) return new Response("missing", { status: 404 });
      return new Response(Buffer.from(bytes).toString("utf8"), {
        status: 200,
        headers: { "content-length": String(bytes.byteLength) },
      });
    };
    const checked = await checkLatestRelease(
      "0.5.0",
      "zhouCode/dsh-squad",
      fetchImpl,
      value.publicKeyPem,
    );
    expect(checked.available).toBe(true);
    expect(checked.release?.manifest).toEqual(value.manifest);
  });
});
