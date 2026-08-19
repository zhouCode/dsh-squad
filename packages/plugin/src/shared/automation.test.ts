import { describe, expect, it } from "vitest";
import {
  applyAutomationLimits,
  automationRuleInputSchema,
  matchesAutomationRule,
  matchesObjectiveGlob,
} from "./automation.ts";

describe("automation rules", () => {
  it.each([
    ["summarize *", "Summarize this report", true],
    ["summarize *", "please summarize this report", false],
    ["check ?.md", "CHECK a.md", true],
    ["check ?.md", "check readme.md", false],
    ["*release*notes*", "Draft release candidate notes", true],
  ])(
    "matches a full, case-insensitive glob",
    (pattern, objective, expected) => {
      expect(matchesObjectiveGlob(pattern, objective)).toBe(expected);
    },
  );

  it("requires attachment permission in addition to an objective match", () => {
    const rule = automationRuleInputSchema.parse({
      name: "Summaries",
      objectivePattern: "summarize *",
      allowedTools: [],
    });
    expect(
      matchesAutomationRule(rule, {
        objective: "Summarize the notes",
        attachmentCount: 0,
      }),
    ).toBe(true);
    expect(
      matchesAutomationRule(rule, {
        objective: "Summarize the notes",
        attachmentCount: 1,
      }),
    ).toBe(false);
  });

  it("rejects duplicate and reserved tool names", () => {
    expect(
      automationRuleInputSchema.safeParse({
        name: "Bad",
        objectivePattern: "*",
        allowedTools: ["files.read", "files.read"],
      }).success,
    ).toBe(false);
    expect(
      automationRuleInputSchema.safeParse({
        name: "Bad",
        objectivePattern: "*",
        allowedTools: ["run_code"],
      }).success,
    ).toBe(false);
  });

  it("can only tighten peer runtime and token limits", () => {
    expect(
      applyAutomationLimits(
        {
          canMessage: true,
          canDelegate: true,
          autoExecute: "SAFE",
          maxConcurrent: 2,
          maxDelegationDepth: 1,
          maxRuntimeMinutes: 30,
          maxTokens: 20_000,
        },
        automationRuleInputSchema.parse({
          name: "Small task",
          objectivePattern: "small *",
          allowedTools: [],
          maxRuntimeMinutes: 5,
          maxTokens: 5_000,
        }),
      ),
    ).toMatchObject({ maxRuntimeMinutes: 5, maxTokens: 5_000 });
  });
});
