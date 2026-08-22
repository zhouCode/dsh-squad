import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { describe, expect, it, vi } from "vitest";
import { unsignedTeamSkillReleaseSchema } from "../shared/team-skills.ts";
import { resolveConfig } from "./config.ts";
import { SquadDatabase } from "./database.ts";
import { NodeIdentity } from "./identity.ts";
import type { RelayClient } from "./relay-client.ts";
import { SquadService } from "./service.ts";
import { TeamSkillManager, measureTeamSkillBundle } from "./team-skills.ts";

function installedFixture(activation: "MANUAL" | "LOCAL" | "DELEGATION") {
  const root = mkdtempSync(join(tmpdir(), "dsh-squad-team-skill-"));
  const ctx = new Context();
  void new SkillRegistry(ctx);
  const database = new SquadDatabase(join(root, "node.sqlite"));
  const identity = NodeIdentity.load(join(root, "identity.json"));
  const manager = new TeamSkillManager(ctx, database, root);
  const bundle = {
    version: 1 as const,
    content: "Always return a concise team summary.",
    files: [{ path: "references/style.md", contentBase64: "Y2xlYXI=" }],
  };
  const metrics = measureTeamSkillBundle(bundle);
  const unsigned = unsignedTeamSkillReleaseSchema.parse({
    version: 1,
    releaseId: randomUUID(),
    organizationId: randomUUID(),
    skillName: "team-summary",
    skillVersion: "1.0.0",
    description: "Summarize team work",
    publisherMembershipId: randomUUID(),
    publisherNodeId: identity.nodeId,
    bundleSha256: metrics.sha256,
    bundleSize: metrics.bundleSize,
    fileCount: metrics.fileCount,
    unpackedSize: metrics.unpackedSize,
    createdAt: new Date().toISOString(),
  });
  const release = { ...unsigned, signature: identity.sign(unsigned) };
  const installPath = manager.materialize(release, bundle);
  database.saveTeamSkillInstallation({
    release,
    localName: "team-summary",
    activation,
    installPath,
  });
  const dispose = ctx.skills.registerProvider((control) => {
    const provider = manager.provider(control);
    return provider;
  });
  return { ctx, database, manager, release, dispose };
}

describe("TeamSkillManager", () => {
  it("places manual team Skills beside native Skills in the standard registry", async () => {
    const fixture = installedFixture("MANUAL");
    const disposeNative = fixture.ctx.skills.register({
      name: "native-helper",
      description: "A native helper",
      source: "runtime",
      content: "Help locally.",
    });
    try {
      const catalog = await fixture.ctx.skills.list();
      expect(catalog.map((skill) => skill.name)).toEqual([
        "native-helper",
        "team-summary",
      ]);
      expect(
        catalog.find((skill) => skill.name === "team-summary"),
      ).toMatchObject({
        invocation: { userInvocable: true, modelInvocable: false },
        provider: "squad-team-skills",
      });
      await expect(
        fixture.ctx.skills.get("team-summary"),
      ).resolves.toMatchObject({
        content: "Always return a concise team summary.",
        resourceBase: { kind: "directory" },
      });
    } finally {
      disposeNative();
      fixture.dispose();
      fixture.database.close();
    }
  });

  it("keeps LOCAL model selection out of delegated Agent scopes", async () => {
    const fixture = installedFixture("LOCAL");
    const delegatedAgent = {};
    try {
      expect(
        (await fixture.ctx.skills.list()).find(
          (skill) => skill.name === "team-summary",
        )?.invocation,
      ).toEqual({ userInvocable: true, modelInvocable: true });

      fixture.manager.markDelegationScope(delegatedAgent);
      expect(
        (await fixture.ctx.skills.list({ scope: delegatedAgent })).find(
          (skill) => skill.name === "team-summary",
        )?.invocation,
      ).toEqual({ userInvocable: true, modelInvocable: false });

      fixture.database.setTeamSkillActivation(
        fixture.release.releaseId,
        "DELEGATION",
      );
      fixture.manager.invalidate();
      expect(
        (await fixture.ctx.skills.list({ scope: delegatedAgent })).find(
          (skill) => skill.name === "team-summary",
        )?.invocation,
      ).toEqual({ userInvocable: true, modelInvocable: true });

      fixture.database.setTeamSkillActivation(
        fixture.release.releaseId,
        "DISABLED",
      );
      fixture.manager.invalidate();
      expect(
        (await fixture.ctx.skills.list()).some(
          (skill) => skill.name === "team-summary",
        ),
      ).toBe(false);
    } finally {
      fixture.dispose();
      fixture.database.close();
    }
  });

  it("packages directory resources but blocks secret-like files", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-native-skill-"));
    const skillRoot = join(root, "native-helper");
    mkdirSync(join(skillRoot, "references"), { recursive: true });
    writeFileSync(join(skillRoot, "SKILL.md"), "source", "utf8");
    writeFileSync(join(skillRoot, "references", "guide.md"), "guide", "utf8");
    const ctx = new Context();
    void new SkillRegistry(ctx);
    const database = new SquadDatabase(join(root, "node.sqlite"));
    const manager = new TeamSkillManager(ctx, database, root);
    const disposeNative = ctx.skills.register({
      name: "native-helper",
      description: "Native helper",
      source: "runtime",
      content: "Use references/guide.md.",
      path: join(skillRoot, "SKILL.md"),
      resourceBase: { kind: "directory", path: skillRoot },
    });
    try {
      const packaged = await manager.bundleSource("native-helper");
      expect(packaged.bundle.files).toEqual([
        {
          path: "references/guide.md",
          contentBase64: Buffer.from("guide").toString("base64"),
        },
      ]);
      writeFileSync(join(skillRoot, ".env"), "TOKEN=do-not-share", "utf8");
      await expect(manager.bundleSource("native-helper")).rejects.toThrow(
        /secret-like resource/u,
      );
      const disposePrivate = ctx.skills.register({
        name: "private-material",
        description: "Must never be shared",
        source: "runtime",
        content: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key",
      });
      try {
        await expect(manager.bundleSource("private-material")).rejects.toThrow(
          /private key data/u,
        );
      } finally {
        disposePrivate();
      }
    } finally {
      disposeNative();
      database.close();
    }
  });

  it("does not let an unavailable Team Skill catalog block mailbox polling", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-squad-team-skill-sync-"));
    const service = new SquadService(
      new Context(),
      resolveConfig({
        dataDir: join(root, "node"),
        relay: { url: "http://127.0.0.1:37199" },
        updates: { stateDir: join(root, "updates") },
      }),
    );
    await service.updates.start();
    const mailbox = vi.fn(async () => ({ cursor: 0, items: [] }));
    service.relayClient = {
      organizations: async () => [],
      teamSkills: async () => {
        throw new Error("old Relay has no Team Skill endpoint");
      },
      mailbox,
    } as unknown as RelayClient;
    try {
      await service.pump();
      expect(mailbox).toHaveBeenCalledOnce();
    } finally {
      await service.close();
    }
  });
});
