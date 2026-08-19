import { z } from "zod";
import { idSchema, timestampSchema, type PeerPolicy } from "./contracts.ts";

const toolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_.:/-]+$/, "invalid DSH tool name")
  .refine(
    (value) => !["run_code", "squad_publish_outcome"].includes(value),
    "transport and outcome tools are managed by Squad",
  );

const automationRuleInputShape = {
  name: z.string().trim().min(1).max(120),
  objectivePattern: z.string().trim().min(1).max(500),
  allowedTools: z.array(toolNameSchema).max(64).default([]),
  preset: z.string().trim().min(1).max(160).optional(),
  allowAttachments: z.boolean().default(false),
  maxRuntimeMinutes: z.number().int().min(1).max(1_440).default(10),
  maxTokens: z.number().int().min(256).max(1_000_000).optional(),
  priority: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true),
};

function rejectDuplicateTools(
  value: { allowedTools: string[] },
  context: z.core.$RefinementCtx,
): void {
  if (new Set(value.allowedTools).size !== value.allowedTools.length) {
    context.addIssue({
      code: "custom",
      path: ["allowedTools"],
      message: "allowedTools must not contain duplicates",
    });
  }
}

export const automationRuleInputSchema = z
  .strictObject(automationRuleInputShape)
  .superRefine(rejectDuplicateTools);

export type AutomationRuleInput = z.infer<typeof automationRuleInputSchema>;

export const automationRuleSchema = z
  .strictObject({
    ...automationRuleInputShape,
    id: idSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .superRefine(rejectDuplicateTools);

export type AutomationRule = z.infer<typeof automationRuleSchema>;

export interface AutomationRuleView extends AutomationRuleInput {
  id: string;
  source: "FILE" | "INTERFACE";
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Case-insensitive, full-string glob matching. `*` matches any number of
 * characters and `?` matches one character. The greedy implementation is
 * linear and does not execute user-provided regular expressions.
 */
export function matchesObjectiveGlob(pattern: string, objective: string) {
  const glob = pattern.trim().toLocaleLowerCase("en-US");
  const value = objective.trim().toLocaleLowerCase("en-US");
  let globIndex = 0;
  let valueIndex = 0;
  let starIndex = -1;
  let starValueIndex = -1;
  while (valueIndex < value.length) {
    if (
      globIndex < glob.length &&
      (glob[globIndex] === "?" || glob[globIndex] === value[valueIndex])
    ) {
      globIndex += 1;
      valueIndex += 1;
    } else if (glob[globIndex] === "*") {
      starIndex = globIndex;
      starValueIndex = valueIndex;
      globIndex += 1;
    } else if (starIndex >= 0) {
      globIndex = starIndex + 1;
      starValueIndex += 1;
      valueIndex = starValueIndex;
    } else {
      return false;
    }
  }
  while (glob[globIndex] === "*") globIndex += 1;
  return globIndex === glob.length;
}

export function matchesAutomationRule(
  rule: AutomationRuleInput,
  input: { objective: string; attachmentCount: number },
): boolean {
  return (
    rule.enabled &&
    (rule.allowAttachments || input.attachmentCount === 0) &&
    matchesObjectiveGlob(rule.objectivePattern, input.objective)
  );
}

export function applyAutomationLimits(
  policy: PeerPolicy,
  rule: AutomationRuleInput,
): PeerPolicy {
  const maxTokens =
    policy.maxTokens === undefined
      ? rule.maxTokens
      : rule.maxTokens === undefined
        ? policy.maxTokens
        : Math.min(policy.maxTokens, rule.maxTokens);
  return {
    ...policy,
    maxRuntimeMinutes: Math.min(
      policy.maxRuntimeMinutes,
      rule.maxRuntimeMinutes,
    ),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}
