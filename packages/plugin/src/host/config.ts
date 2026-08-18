import { resolve } from "node:path";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { peerPolicySchema, type PeerPolicy } from "../shared/contracts.ts";
import { updateModeSchema, type UpdateMode } from "../shared/updates.ts";

export interface PeerConfig {
  nodeId: string;
  displayName: string;
  publicKey: string;
  enabled?: boolean;
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
  updates?: {
    repository?: string;
    stateDir?: string;
    defaultMode?: UpdateMode;
  };
}

export interface ResolvedSquadConfig {
  dataDir: string;
  displayName: string;
  pollIntervalMs: number;
  envelopeTtlMinutes: number;
  peers: Array<
    Omit<PeerConfig, "enabled" | "policy"> & {
      enabled: boolean;
      policy: PeerPolicy;
    }
  >;
  execution: {
    cwd: string;
    preset?: string;
    safeObjectivePrefixes: string[];
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

export function resolveConfig(config: SquadConfig = {}): ResolvedSquadConfig {
  const dataDir = resolve(config.dataDir ?? dshHomePath("squad"));
  const relayUrl = optionalNonEmpty(config.relay?.url);
  const preset = optionalNonEmpty(config.execution?.preset);
  const invitation = optionalNonEmpty(config.relay?.invitation);
  const repository =
    optionalNonEmpty(config.updates?.repository) ?? "zhouCode/dsh-squad";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error(
      "squad updates.repository must use the GitHub owner/repository form",
    );
  }
  if (
    relayUrl !== undefined &&
    !relayUrl.startsWith("https://") &&
    !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/u.test(relayUrl)
  ) {
    throw new Error(
      "squad relay.url must use HTTPS (loopback HTTP is allowed for local development)",
    );
  }
  return {
    dataDir,
    displayName: optionalNonEmpty(config.displayName) ?? "Personal Agent",
    pollIntervalMs: Math.max(1_000, config.pollIntervalMs ?? 5_000),
    envelopeTtlMinutes: Math.min(
      24 * 60,
      Math.max(1, config.envelopeTtlMinutes ?? 60),
    ),
    peers: (config.peers ?? []).map((peer) => ({
      nodeId: peer.nodeId,
      displayName: peer.displayName,
      publicKey: peer.publicKey,
      enabled: peer.enabled ?? true,
      policy: peerPolicySchema.parse(peer.policy ?? {}),
    })),
    execution: {
      cwd: resolve(config.execution?.cwd ?? process.cwd()),
      ...(preset === undefined ? {} : { preset }),
      safeObjectivePrefixes: (
        config.execution?.safeObjectivePrefixes ?? []
      ).map((value) => value.trim().toLowerCase()),
    },
    relay: {
      enabled: config.relay?.enabled ?? false,
      ...(relayUrl === undefined ? {} : { url: relayUrl.replace(/\/$/u, "") }),
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
