import { resolve } from "node:path";
import { isIP } from "node:net";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { z } from "zod";
import {
  peerPolicySchema,
  peerTransportSchema,
  type PeerPolicy,
  type PeerTransport,
} from "../shared/contracts.ts";
import {
  automationRuleInputSchema,
  type AutomationRuleInput,
} from "../shared/automation.ts";
import { updateModeSchema, type UpdateMode } from "../shared/updates.ts";

export interface PeerConfig {
  nodeId: string;
  displayName: string;
  publicKey: string;
  enabled?: boolean;
  transport?: PeerTransport;
  directUrl?: string;
  policy?: Partial<PeerPolicy>;
}

export interface RelayInviteConfig {
  token: string;
  expiresAt: string;
}

export interface SquadConfig {
  dataDir?: string;
  displayName?: string;
  pollIntervalMs?: number;
  envelopeTtlMinutes?: number;
  peers?: PeerConfig[];
  execution?: {
    cwd?: string;
    preset?: string;
    automationRules?: AutomationRuleInput[];
    /** @deprecated Prefix-only SAFE authorization is ignored. Use automationRules. */
    safeObjectivePrefixes?: string[];
  };
  relay?: {
    enabled?: boolean;
    url?: string;
    invitation?: string;
    databasePath?: string;
    invites?: RelayInviteConfig[];
    maxMailboxItems?: number;
    maxRequestsPerMinute?: number;
  };
  direct?: {
    enabled?: boolean;
    publicUrl?: string;
    retryIntervalMs?: number;
  };
  updates?: {
    repository?: string;
    stateDir?: string;
    defaultMode?: UpdateMode;
  };
}

export const nodeSetupInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("RELAY"),
    displayName: z.string().trim().min(1).max(120),
    relayUrl: z.string().trim().min(1).max(2_048),
    invitation: z.string().trim().min(16).max(512).optional(),
    directEnabled: z.boolean().optional(),
    directPublicUrl: z.string().trim().min(1).max(2_048).optional(),
  }),
  z.strictObject({
    mode: z.literal("DIRECT"),
    displayName: z.string().trim().min(1).max(120),
    directEnabled: z.boolean().default(true),
    directPublicUrl: z.string().trim().min(1).max(2_048).optional(),
  }),
]);

export type NodeSetupInput = z.infer<typeof nodeSetupInputSchema>;
export type NodeSetupMode = NodeSetupInput["mode"];

export interface ResolvedSquadConfig {
  dataDir: string;
  displayName: string;
  setupRequired: boolean;
  pollIntervalMs: number;
  envelopeTtlMinutes: number;
  peers: Array<
    Omit<PeerConfig, "enabled" | "policy"> & {
      enabled: boolean;
      transport: PeerTransport;
      directUrl?: string;
      policy: PeerPolicy;
    }
  >;
  execution: {
    cwd: string;
    preset?: string;
    automationRules: AutomationRuleInput[];
    legacySafeObjectivePrefixes: string[];
  };
  relay: {
    enabled: boolean;
    url?: string;
    invitation?: string;
    databasePath: string;
    invites: RelayInviteConfig[];
    maxMailboxItems: number;
    maxRequestsPerMinute: number;
  };
  direct: {
    enabled: boolean;
    publicUrl?: string;
    retryIntervalMs: number;
  };
  updates: {
    repository: string;
    stateDir: string;
    defaultMode: UpdateMode;
  };
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveTransportBaseUrl(
  candidate: string | undefined,
  label: string,
): string | undefined {
  const value = optionalNonEmpty(candidate);
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  const loopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    (isIP(hostname) === 4 && hostname.split(".")[0] === "127");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      `${label} must use HTTPS (loopback HTTP is allowed for local development)`,
    );
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !["", "/"].includes(url.pathname)
  ) {
    throw new Error(
      `${label} must contain only an origin without credentials or a path`,
    );
  }
  return url.origin;
}

export function resolveRelayBaseUrl(
  candidate: string | undefined,
  label = "squad relay.url",
): string | undefined {
  return resolveTransportBaseUrl(candidate, label);
}

export function resolveDirectBaseUrl(
  candidate: string | undefined,
  label: string,
): string | undefined {
  return resolveTransportBaseUrl(candidate, label);
}

export function resolveConfig(config: SquadConfig = {}): ResolvedSquadConfig {
  const dataDir = resolve(config.dataDir ?? dshHomePath("squad"));
  const relayUrl = resolveRelayBaseUrl(config.relay?.url);
  const preset = optionalNonEmpty(config.execution?.preset);
  const invitation = optionalNonEmpty(config.relay?.invitation);
  const directPublicUrl = resolveDirectBaseUrl(
    config.direct?.publicUrl,
    "squad direct.publicUrl",
  );
  const repository =
    optionalNonEmpty(config.updates?.repository) ?? "zhouCode/dsh-squad";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error(
      "squad updates.repository must use the GitHub owner/repository form",
    );
  }
  return {
    dataDir,
    displayName: optionalNonEmpty(config.displayName) ?? "Personal Agent",
    setupRequired:
      config.relay?.enabled !== true &&
      relayUrl === undefined &&
      config.direct?.enabled !== true &&
      (config.peers?.length ?? 0) === 0,
    pollIntervalMs: Math.max(1_000, config.pollIntervalMs ?? 5_000),
    envelopeTtlMinutes: Math.min(
      24 * 60,
      Math.max(1, config.envelopeTtlMinutes ?? 60),
    ),
    peers: (config.peers ?? []).map((peer) => {
      const transport = peerTransportSchema.parse(peer.transport ?? "RELAY");
      const directUrl = resolveDirectBaseUrl(
        peer.directUrl,
        `squad peer ${peer.displayName} directUrl`,
      );
      if (transport === "DIRECT" && directUrl === undefined) {
        throw new Error(
          `squad peer ${peer.displayName} requires directUrl for DIRECT transport`,
        );
      }
      return {
        nodeId: peer.nodeId,
        displayName: peer.displayName,
        publicKey: peer.publicKey,
        enabled: peer.enabled ?? true,
        transport,
        ...(directUrl === undefined ? {} : { directUrl }),
        policy: peerPolicySchema.parse(peer.policy ?? {}),
      };
    }),
    execution: {
      cwd: resolve(config.execution?.cwd ?? process.cwd()),
      ...(preset === undefined ? {} : { preset }),
      automationRules: (config.execution?.automationRules ?? []).map((rule) =>
        automationRuleInputSchema.parse(rule),
      ),
      legacySafeObjectivePrefixes: (
        config.execution?.safeObjectivePrefixes ?? []
      )
        .map((value) => value.trim())
        .filter(Boolean),
    },
    relay: {
      enabled: config.relay?.enabled ?? false,
      ...(relayUrl === undefined ? {} : { url: relayUrl }),
      ...(invitation === undefined ? {} : { invitation }),
      databasePath: resolve(
        config.relay?.databasePath ?? `${dataDir}/relay.sqlite`,
      ),
      invites: config.relay?.invites ?? [],
      maxMailboxItems: Math.min(
        100_000,
        Math.max(100, config.relay?.maxMailboxItems ?? 10_000),
      ),
      maxRequestsPerMinute: Math.min(
        10_000,
        Math.max(10, config.relay?.maxRequestsPerMinute ?? 300),
      ),
    },
    direct: {
      enabled: config.direct?.enabled ?? false,
      ...(directPublicUrl === undefined ? {} : { publicUrl: directPublicUrl }),
      retryIntervalMs: Math.min(
        5 * 60_000,
        Math.max(1_000, config.direct?.retryIntervalMs ?? 5_000),
      ),
    },
    updates: {
      repository,
      stateDir: resolve(
        config.updates?.stateDir ?? dshHomePath("squad-updates"),
      ),
      defaultMode: updateModeSchema.parse(
        config.updates?.defaultMode ?? "NOTIFY",
      ),
    },
  };
}
