import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.ts";
import { SquadService } from "./service.ts";

describe("peer pairing lifecycle", () => {
  it("imports a signed bundle and supports disable, remove, and re-pair", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-pairing-"));
    const alice = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "alice"),
        updates: { stateDir: join(root, "alice-updates") },
      }),
    );
    const bob = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "bob"),
        updates: { stateDir: join(root, "bob-updates") },
      }),
    );
    try {
      await alice.start();
      await bob.start();
      await alice.configureNode({
        mode: "DIRECT",
        displayName: "Alice",
        directEnabled: true,
        directPublicUrl: "http://127.0.0.1:37101",
      });
      await bob.configureNode({
        mode: "DIRECT",
        displayName: "Bob",
        directEnabled: false,
      });
      const exported = alice.createPairingBundle(60);
      const paired = await bob.importPairingBundle({ bundle: exported.bundle });
      expect(paired).toMatchObject({
        nodeId: alice.identity.nodeId,
        displayName: "Alice",
        transport: "DIRECT",
        directUrl: "http://127.0.0.1:37101",
        enabled: true,
        policy: { autoExecute: "NEVER", canDelegate: true },
      });

      await bob.updatePeerConnection(alice.identity.nodeId, {
        displayName: "Alice laptop",
        enabled: false,
      });
      expect(bob.database.findPeer(alice.identity.nodeId)).toMatchObject({
        displayName: "Alice laptop",
        enabled: false,
      });
      await bob.removePeer(alice.identity.nodeId);
      expect(bob.database.findPeer(alice.identity.nodeId)).toBeUndefined();
      await bob.importPairingBundle({ bundle: exported.bundle });
      expect(bob.database.findPeer(alice.identity.nodeId)?.enabled).toBe(true);

      const tampered = `${exported.bundle.slice(0, -1)}${exported.bundle.endsWith("A") ? "B" : "A"}`;
      await expect(
        bob.importPairingBundle({ bundle: tampered }),
      ).rejects.toThrow();
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});
