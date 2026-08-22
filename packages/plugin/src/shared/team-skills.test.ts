import { describe, expect, it } from "vitest";
import {
  compareTeamSkillVersions,
  teamSkillBundleSchema,
  teamSkillNameSchema,
  teamSkillSemverSchema,
} from "./team-skills.ts";

describe("team Skill contracts", () => {
  it("accepts native kebab-case names and semantic versions", () => {
    expect(teamSkillNameSchema.parse("release-notes")).toBe("release-notes");
    expect(teamSkillSemverSchema.parse("1.2.0-beta.1")).toBe("1.2.0-beta.1");
    expect(teamSkillSemverSchema.parse("1.2.0+build.7")).toBe("1.2.0+build.7");
    expect(() => teamSkillNameSchema.parse("Release Notes")).toThrow();
    expect(() => teamSkillSemverSchema.parse("v1.2")).toThrow();
    expect(() => teamSkillSemverSchema.parse("1.2.0-beta.01")).toThrow();
  });

  it("rejects resource path traversal and platform-specific paths", () => {
    for (const path of [
      "../secret",
      "assets/../secret",
      "/etc/passwd",
      "a\\b",
      "SKILL.md",
      "bundle.json",
    ]) {
      expect(() =>
        teamSkillBundleSchema.parse({
          version: 1,
          content: "Use the reference.",
          files: [{ path, contentBase64: "eA==" }],
        }),
      ).toThrow();
    }
  });

  it("orders stable releases after prereleases", () => {
    expect(compareTeamSkillVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(
      0,
    );
    expect(compareTeamSkillVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(
      compareTeamSkillVersions("1.0.0-beta.10", "1.0.0-beta.2"),
    ).toBeGreaterThan(0);
    expect(compareTeamSkillVersions("1.0.0+one", "1.0.0+two")).toBe(0);
    expect(compareTeamSkillVersions("2.0.0", "2.0.0")).toBe(0);
  });
});
