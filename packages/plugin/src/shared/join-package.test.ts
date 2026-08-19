import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeIdentity } from "../host/identity.ts";
import {
  decodeJoinPackage,
  encodeJoinPackage,
  unsignedJoinPackage,
  unsignedJoinPackageSchema,
} from "./join-package.ts";

describe("Squad join packages", () => {
  it("round-trips a signed Relay and organization invitation", () => {
    const identity = NodeIdentity.load(
      join(mkdtempSync(join(tmpdir(), "dsh-squad-join-package-")), "id.json"),
    );
    const unsigned = unsignedJoinPackageSchema.parse({
      version: 1,
      relayUrl: "https://relay.example.com",
      organizationId: "11111111-1111-4111-8111-111111111111",
      organizationName: "Product",
      enrollmentInvitation:
        "squad-relay-v1.abcdefghijklmnopqrstuvwxyz0123456789",
      organizationInvitation:
        "squad-org-v1.11111111-1111-4111-8111-111111111111.abcdefghijklmnopqrstuvwxyz012345",
      issuer: {
        nodeId: identity.nodeId,
        displayName: "Alice",
        publicKey: identity.publicKey,
      },
      issuedAt: "2026-08-20T00:00:00.000Z",
      expiresAt: "2026-08-21T00:00:00.000Z",
    });
    const encoded = encodeJoinPackage({
      ...unsigned,
      signature: identity.sign(unsigned),
    });
    const decoded = decodeJoinPackage(encoded);
    expect(unsignedJoinPackage(decoded)).toEqual(unsigned);
    expect(encoded.startsWith("squad-join-v1.")).toBe(true);
  });

  it("rejects malformed and oversized packages", () => {
    expect(() => decodeJoinPackage("not-a-package")).toThrow();
    expect(() =>
      decodeJoinPackage(`squad-join-v1.${"x".repeat(40_000)}`),
    ).toThrow();
  });
});
