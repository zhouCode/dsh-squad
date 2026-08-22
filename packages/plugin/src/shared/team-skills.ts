import { z } from "zod";
import {
  idSchema,
  nodeIdSchema,
  signatureSchema,
  timestampSchema,
} from "./contracts.ts";

export const TEAM_SKILL_PROTOCOL_VERSION = 1 as const;
export const MAX_TEAM_SKILL_FILES = 500;
export const MAX_TEAM_SKILL_CONTENT_BYTES = 1024 * 1024;
export const MAX_TEAM_SKILL_UNPACKED_BYTES = 10 * 1024 * 1024;
export const MAX_TEAM_SKILL_BUNDLE_BYTES = 15 * 1024 * 1024;

const SEMVER_IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const TEAM_SKILL_SEMVER_PATTERN = new RegExp(
  `^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)` +
    `(?:-${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?` +
    "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
  "u",
);

export const teamSkillNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    "Skill name must use lowercase kebab-case",
  );

export const teamSkillSemverSchema = z
  .string()
  .max(100)
  .regex(
    TEAM_SKILL_SEMVER_PATTERN,
    "Skill version must be semantic versioning",
  );

export const teamSkillActivationSchema = z.enum([
  "DISABLED",
  "MANUAL",
  "LOCAL",
  "DELEGATION",
]);
export type TeamSkillActivation = z.infer<typeof teamSkillActivationSchema>;

export const teamSkillFileSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(240)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.startsWith("\\") &&
        !value.includes("\\") &&
        !value.includes("\0") &&
        value !== "SKILL.md" &&
        value !== "bundle.json" &&
        value
          .split("/")
          .every((part) => part !== "" && part !== "." && part !== ".."),
      { message: "Skill resource path must be a safe relative POSIX path" },
    ),
  contentBase64: z
    .string()
    .max(Math.ceil((MAX_TEAM_SKILL_UNPACKED_BYTES * 4) / 3) + 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
});
export type TeamSkillFile = z.infer<typeof teamSkillFileSchema>;

export const teamSkillBundleSchema = z.strictObject({
  version: z.literal(TEAM_SKILL_PROTOCOL_VERSION),
  content: z.string().min(1).max(MAX_TEAM_SKILL_CONTENT_BYTES),
  files: z.array(teamSkillFileSchema).max(MAX_TEAM_SKILL_FILES),
});
export type TeamSkillBundle = z.infer<typeof teamSkillBundleSchema>;

export const unsignedTeamSkillReleaseSchema = z.strictObject({
  version: z.literal(TEAM_SKILL_PROTOCOL_VERSION),
  releaseId: idSchema,
  organizationId: idSchema,
  skillName: teamSkillNameSchema,
  skillVersion: teamSkillSemverSchema,
  description: z.string().trim().min(1).max(500),
  whenToUse: z.string().trim().min(1).max(2_000).optional(),
  changelog: z.string().trim().min(1).max(10_000).optional(),
  publisherMembershipId: idSchema,
  publisherNodeId: nodeIdSchema,
  bundleSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bundleSize: z.number().int().positive().max(MAX_TEAM_SKILL_BUNDLE_BYTES),
  fileCount: z
    .number()
    .int()
    .positive()
    .max(MAX_TEAM_SKILL_FILES + 1),
  unpackedSize: z.number().int().positive().max(MAX_TEAM_SKILL_UNPACKED_BYTES),
  createdAt: timestampSchema,
});
export type UnsignedTeamSkillRelease = z.infer<
  typeof unsignedTeamSkillReleaseSchema
>;

export const teamSkillReleaseSchema = unsignedTeamSkillReleaseSchema
  .extend({ signature: signatureSchema })
  .strict();
export type TeamSkillRelease = z.infer<typeof teamSkillReleaseSchema>;

export const teamSkillReviewActionSchema = z.enum(["APPROVE", "REVOKE"]);
export type TeamSkillReviewAction = z.infer<typeof teamSkillReviewActionSchema>;

export const unsignedTeamSkillReviewSchema = z.strictObject({
  version: z.literal(TEAM_SKILL_PROTOCOL_VERSION),
  reviewId: idSchema,
  organizationId: idSchema,
  organizationRevision: z.number().int().positive(),
  releaseId: idSchema,
  action: teamSkillReviewActionSchema,
  reviewerMembershipId: idSchema,
  reviewerNodeId: nodeIdSchema,
  reason: z.string().trim().min(1).max(1_000).optional(),
  reviewedAt: timestampSchema,
});
export type UnsignedTeamSkillReview = z.infer<
  typeof unsignedTeamSkillReviewSchema
>;

export const teamSkillReviewSchema = unsignedTeamSkillReviewSchema
  .extend({ signature: signatureSchema })
  .strict();
export type TeamSkillReview = z.infer<typeof teamSkillReviewSchema>;

export const teamSkillReleaseStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REVOKED",
]);
export type TeamSkillReleaseStatus = z.infer<
  typeof teamSkillReleaseStatusSchema
>;

export const teamSkillCatalogEntrySchema = z.strictObject({
  release: teamSkillReleaseSchema,
  status: teamSkillReleaseStatusSchema,
  latestReview: teamSkillReviewSchema.optional(),
});
export type TeamSkillCatalogEntry = z.infer<typeof teamSkillCatalogEntrySchema>;

export const teamSkillInstallationSchema = z.strictObject({
  release: teamSkillReleaseSchema,
  localName: teamSkillNameSchema,
  activation: teamSkillActivationSchema,
  installedAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type TeamSkillInstallation = z.infer<typeof teamSkillInstallationSchema>;

export const publishTeamSkillInputSchema = z.strictObject({
  organizationId: idSchema,
  sourceName: teamSkillNameSchema,
  skillVersion: teamSkillSemverSchema,
  changelog: z.string().trim().min(1).max(10_000).optional(),
});
export type PublishTeamSkillInput = z.infer<typeof publishTeamSkillInputSchema>;

export const installTeamSkillInputSchema = z.strictObject({
  localName: teamSkillNameSchema.optional(),
  activation: teamSkillActivationSchema.default("MANUAL"),
});
export type InstallTeamSkillInput = z.infer<typeof installTeamSkillInputSchema>;

export interface PublishableSkillView {
  name: string;
  description: string;
  whenToUse?: string;
  source: string;
  provider: string;
}

export function unsignedTeamSkillRelease(
  release: TeamSkillRelease,
): UnsignedTeamSkillRelease {
  const { signature: _signature, ...unsigned } = release;
  return unsigned;
}

export function unsignedTeamSkillReview(
  review: TeamSkillReview,
): UnsignedTeamSkillReview {
  const { signature: _signature, ...unsigned } = review;
  return unsigned;
}

export function compareTeamSkillVersions(left: string, right: string): number {
  const split = (value: string): [string[], string[] | undefined] => {
    const withoutBuild = teamSkillSemverSchema.parse(value).split("+", 1)[0]!;
    const prereleaseAt = withoutBuild.indexOf("-");
    const core =
      prereleaseAt < 0 ? withoutBuild : withoutBuild.slice(0, prereleaseAt);
    const prerelease =
      prereleaseAt < 0
        ? undefined
        : withoutBuild.slice(prereleaseAt + 1).split(".");
    return [core.split("."), prerelease];
  };
  const [leftCore, leftPre] = split(teamSkillSemverSchema.parse(left));
  const [rightCore, rightPre] = split(teamSkillSemverSchema.parse(right));
  const compareNumeric = (leftValue: string, rightValue: string): number => {
    if (leftValue.length !== rightValue.length) {
      return leftValue.length - rightValue.length;
    }
    return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
  };
  for (let index = 0; index < 3; index += 1) {
    const difference = compareNumeric(leftCore[index]!, rightCore[index]!);
    if (difference !== 0) return difference;
  }
  if (leftPre === undefined && rightPre === undefined) return 0;
  if (leftPre === undefined) return 1;
  if (rightPre === undefined) return -1;
  for (
    let index = 0;
    index < Math.max(leftPre.length, rightPre.length);
    index += 1
  ) {
    const leftPart = leftPre[index];
    const rightPart = rightPre[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return compareNumeric(leftPart, rightPart);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}
