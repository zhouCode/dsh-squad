import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeIdentity } from "../host/identity.ts";
import {
  decodePairingBundle,
  encodePairingBundle,
  unsignedPairingBundleSchema,
} from "./pairing.ts";

describe("signed peer pairing bundles", () => {
  it("round-trips bounded public connection metadata", () => {
    const identity = NodeIdentity.load(
      join(mkdtempSync(join(tmpdir(), "dsh-pairing-")), "identity.json"),
    );
    const unsigned = unsignedPairingBundleSchema.parse({
      version: 1,
      nodeId: identity.nodeId,
      displayName: "Alice",
      publicKey: identity.publicKey,
      relayUrl: "https://relay.example.com",
      directUrl: "https://alice.example.com",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const bundle = { ...unsigned, signature: identity.sign(unsigned) };
    expect(decodePairingBundle(encodePairingBundle(bundle))).toEqual(bundle);
  });

  it("rejects arbitrary text and oversized input", () => {
    expect(() => decodePairingBundle("Alice public key")).toThrow(
      "invalid Squad pairing bundle",
    );
    expect(() =>
      decodePairingBundle(`squad-peer-v1.${"x".repeat(40_000)}`),
    ).toThrow("invalid Squad pairing bundle");
  });
});
