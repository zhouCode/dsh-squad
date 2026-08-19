import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.ts";
import { TeamPlanEditConflictError } from "./database.ts";
import { NodeIdentity } from "./identity.ts";
import { SquadService } from "./service.ts";

const policy = {
  canMessage: true,
  canDelegate: true,
  autoExecute: "NEVER" as const,
  maxConcurrent: 1,
  maxDelegationDepth: 1,
  maxRuntimeMinutes: 30,
};

describe("team plan drafts", () => {
  it("re-resolves recipients and protects newer revisions while editing", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-team-plan-"));
    const service = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "alice"),
        displayName: "Alice",
        updates: { stateDir: join(root, "updates") },
      }),
    );
    const bob = NodeIdentity.load(join(root, "bob.json"));
    const carol = NodeIdentity.load(join(root, "carol.json"));
    try {
      await service.addPeer({
        nodeId: bob.nodeId,
        displayName: "Bob",
        publicKey: bob.publicKey,
        policy,
      });
      await service.addPeer({
        nodeId: carol.nodeId,
        displayName: "Carol",
        publicKey: carol.publicKey,
        policy,
      });
      const plan = await service.createTeamPlan({
        title: "Launch",
        items: [{ to: "Bob", objective: "Draft notes" }],
      });
      const updated = await service.updateTeamPlan(plan.id, {
        revision: plan.revision,
        title: "Launch review",
        items: [
          {
            id: plan.items[0]!.id,
            to: "Carol",
            objective: "Review the notes",
          },
        ],
      });
      expect(updated).toMatchObject({ title: "Launch review", revision: 2 });
      expect(updated.items[0]).toMatchObject({
        id: plan.items[0]!.id,
        peerNodeId: carol.nodeId,
        peerDisplayName: "Carol",
      });
      expect(() =>
        service.updateTeamPlan(plan.id, {
          revision: plan.revision,
          title: "Stale",
          items: [{ to: "Bob", objective: "Overwrite" }],
        }),
      ).toThrow(TeamPlanEditConflictError);
    } finally {
      await service.close();
    }
  });
});
