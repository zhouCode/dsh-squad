import { chmodSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { NodeIdentity, verifySignature } from "./identity.ts";

describe("NodeIdentity", () => {
  it("is restart-stable and detects tampering", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-identity-"));
    const path = join(root, "identity.json");
    const first = NodeIdentity.load(path);
    const second = NodeIdentity.load(path, first.nodeId);
    const signature = first.sign({ b: 2, a: 1 });
    expect(second.nodeId).toBe(first.nodeId);
    expect(verifySignature({ a: 1, b: 2 }, signature, first.publicKey)).toBe(
      true,
    );
    expect(verifySignature({ a: 1, b: 3 }, signature, first.publicKey)).toBe(
      false,
    );
  });

  it("fails closed when a bound identity disappears or permissions widen", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-identity-"));
    const path = join(root, "identity.json");
    const identity = NodeIdentity.load(path);
    rmSync(path);
    expect(() => NodeIdentity.load(path, identity.nodeId)).toThrow(/refusing/u);

    const replacement = NodeIdentity.load(path);
    chmodSync(path, 0o644);
    expect(() => NodeIdentity.load(path, replacement.nodeId)).toThrow(/0600/u);
  });
});
