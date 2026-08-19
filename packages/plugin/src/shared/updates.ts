import { z } from "zod";

export const updateModeSchema = z.enum(["DISABLED", "NOTIFY", "AUTOMATIC"]);
export type UpdateMode = z.infer<typeof updateModeSchema>;

export const updatePhaseSchema = z.enum([
  "IDLE",
  "CHECKING",
  "UP_TO_DATE",
  "AVAILABLE",
  "REQUESTED",
  "DOWNLOADING",
  "VERIFYING",
  "BLOCKED",
  "BACKING_UP",
  "INSTALLING",
  "RESTARTING",
  "INSTALLED",
  "ROLLED_BACK",
  "FAILED",
]);
export type UpdatePhase = z.infer<typeof updatePhaseSchema>;

export const updatePolicySchema = z.object({
  schemaVersion: z.literal(1),
  mode: updateModeSchema,
  updatedAt: z.string().datetime(),
});
export type UpdatePolicy = z.infer<typeof updatePolicySchema>;

export const releaseAssetSchema = z.object({
  name: z.string().min(1).max(240),
  size: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

export const releaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  package: z.literal("@dsh-squad/plugin"),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  tag: z.string().regex(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  keyId: z.string().regex(/^[0-9a-f]{64}$/u),
  publishedAt: z.string().datetime(),
  asset: releaseAssetSchema,
  minDshVersion: z.string().min(1).max(80),
});
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const updateStatusSchema = z.object({
  schemaVersion: z.literal(1),
  phase: updatePhaseSchema,
  currentVersion: z.string().min(1),
  updatedAt: z.string().datetime(),
  latestVersion: z.string().min(1).optional(),
  available: z.boolean().optional(),
  checkedAt: z.string().datetime().optional(),
  releaseUrl: z.string().url().optional(),
  errorCode: z.string().min(1).max(120).optional(),
  detail: z.string().min(1).max(2_000).optional(),
});
export type UpdateStatus = z.infer<typeof updateStatusSchema>;

export const updateRequestSchema = z.object({
  schemaVersion: z.literal(1),
  requestedAt: z.string().datetime(),
  requestedVersion: z.string().min(1).optional(),
});
export type UpdateRequest = z.infer<typeof updateRequestSchema>;

export const updateAutomationSchema = z.object({
  schemaVersion: z.literal(1),
  configuredAt: z.string().datetime(),
  scope: z.literal("user"),
  serviceUnit: z.string().min(1).max(240),
  updaterUnit: z.string().min(1).max(240),
  timerUnit: z.string().min(1).max(240),
  pathUnit: z.string().min(1).max(240),
  configPath: z.string().min(1),
});
export type UpdateAutomation = z.infer<typeof updateAutomationSchema>;

export interface UpdateSnapshot {
  currentVersion: string;
  policy: UpdatePolicy;
  status: UpdateStatus;
  automation?: UpdateAutomation;
  installRequested: boolean;
}

export const updateReadinessBlockers = [
  "UPDATER_NOT_CONFIGURED",
  "NO_VERIFIED_RELEASE",
  "INSTALL_ALREADY_REQUESTED",
  "ACTIVE_DELEGATIONS",
  "DISPATCHING_PLANS",
] as const;
export type UpdateReadinessBlocker = (typeof updateReadinessBlockers)[number];

export interface UpdateActiveWork {
  activeDelegations: number;
  dispatchingPlans: number;
}

export interface UpdateReadiness extends UpdateActiveWork {
  ready: boolean;
  updaterConfigured: boolean;
  verifiedReleaseAvailable: boolean;
  installRequested: boolean;
  blockers: UpdateReadinessBlocker[];
}

export function countUpdateActiveWork(source: {
  delegations: readonly { status?: string | undefined }[];
  plans: readonly { status?: string | undefined }[];
}): UpdateActiveWork {
  return {
    activeDelegations: source.delegations.filter((item) =>
      ["TRIAGING", "RUNNING"].includes(item.status ?? ""),
    ).length,
    dispatchingPlans: source.plans.filter(
      (item) => item.status === "DISPATCHING",
    ).length,
  };
}

export function summarizeUpdateReadiness(
  snapshot: UpdateSnapshot,
  source: {
    delegations: readonly { status?: string | undefined }[];
    plans: readonly { status?: string | undefined }[];
  },
): UpdateReadiness {
  const activeWork = countUpdateActiveWork(source);
  const updaterConfigured = snapshot.automation !== undefined;
  const verifiedReleaseAvailable =
    snapshot.status.available === true &&
    snapshot.status.latestVersion !== undefined;
  const blockers: UpdateReadinessBlocker[] = [];
  if (!updaterConfigured) blockers.push("UPDATER_NOT_CONFIGURED");
  if (!verifiedReleaseAvailable) blockers.push("NO_VERIFIED_RELEASE");
  if (snapshot.installRequested) blockers.push("INSTALL_ALREADY_REQUESTED");
  if (activeWork.activeDelegations > 0) blockers.push("ACTIVE_DELEGATIONS");
  if (activeWork.dispatchingPlans > 0) blockers.push("DISPATCHING_PLANS");
  return {
    ...activeWork,
    ready: blockers.length === 0,
    updaterConfigured,
    verifiedReleaseAvailable,
    installRequested: snapshot.installRequested,
    blockers,
  };
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(value: string): Semver {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(
    value.trim(),
  );
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    throw new Error(`invalid semantic version: ${value}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right, "en");
}

/** Returns a negative value when left is older, zero when equal, and positive when newer. */
export function compareVersions(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    const compared = compareIdentifier(aPart, bPart);
    if (compared !== 0) return compared;
  }
  return 0;
}
