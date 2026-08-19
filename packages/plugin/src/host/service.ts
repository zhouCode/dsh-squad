import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Service, type Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent-default-model";
import type {} from "@deepseek-ai/dsh-agent-presets";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-session-persistence";
import { ZodError } from "zod";
import {
  canonicalBytes,
  envelopeDigest,
  unsignedEnvelope,
} from "../shared/canonical.ts";
import {
  MAX_ENVELOPE_BYTES,
  assertEnvelopeSemantics,
  createDelegationInputSchema,
  createTeamPlanInputSchema,
  delegationResultSchema,
  delegationUpdateSchema,
  envelopePayloadBytes,
  envelopeSchema,
  humanInputSchema,
  idSchema,
  nodeIdSchema,
  peerPolicySchema,
  unsignedNodeReceiptSchema,
  updateTeamPlanInputSchema,
  type CreateDelegationInput,
  type CreateTeamPlanInput,
  type DelegationResult,
  type Envelope,
  type HumanInput as HumanInputValue,
  type PeerPolicy,
  type PeerTransport,
  type ResultOutput,
  type StructuredOutcome,
  type TeamPlan,
  type UnsignedEnvelope,
  type UpdateTeamPlanInput,
} from "../shared/contracts.ts";
import {
  applyAutomationLimits,
  automationRuleInputSchema,
  matchesAutomationRule,
  type AutomationRuleInput,
  type AutomationRuleView,
} from "../shared/automation.ts";
import {
  decodeJoinPackage,
  encodeJoinPackage,
  unsignedJoinPackage,
  unsignedJoinPackageSchema,
  type ImportJoinPackage,
  type JoinPackage,
} from "../shared/join-package.ts";
import {
  organizationIdFromInvitation,
  organizationRoleSchema,
  unsignedOrganizationDocumentSchema,
  unsignedOrganizationJoinRequestSchema,
  unsignedOrganizationMembershipCertificateSchema,
  type OrganizationDocument,
  type OrganizationJoinRequest,
  type OrganizationMemberView,
  type OrganizationMembershipCertificate,
  type OrganizationRole,
  type OrganizationView,
} from "../shared/organizations.ts";
import {
  decodePairingBundle,
  encodePairingBundle,
  unsignedPairingBundle,
  unsignedPairingBundleSchema,
  type ImportPairingBundle,
  type PairingBundle,
  type UpdatePeerConnection,
} from "../shared/pairing.ts";
import {
  isTerminalStatus,
  summarizeAttention,
  type SquadConnectionDiagnostics,
  type SquadAttentionSummary,
} from "../shared/state.ts";
import type { UpdateMode, UpdateSnapshot } from "../shared/updates.ts";
import { SQUAD_VERSION } from "../shared/version.ts";
import {
  resolveDirectBaseUrl,
  resolveRelayBaseUrl,
  type NodeSetupInput,
  type NodeSetupMode,
  type ResolvedSquadConfig,
} from "./config.ts";
import {
  SquadDatabase,
  TeamPlanEditConflictError,
  type DelegationRecord,
  type OrganizationDirectoryRecord,
  type PeerRecord,
  type ResolvedDelegationRecipient,
} from "./database.ts";
import {
  NodeIdentity,
  nodeIdFromPublicKey,
  verifySignature,
} from "./identity.ts";
import { AttachmentVerifier } from "./attachments.ts";
import {
  ExecutionFailure,
  NativeDelegationExecutor,
  makeTodos,
} from "./native-executor.ts";
import { RelayClient, RelayClientError } from "./relay-client.ts";
import { RelayServer } from "./relay.ts";
import { OrganizationAuthority } from "./organization.ts";
import { UpdateController } from "./update-controller.ts";
import {
  DirectEnvelopeTransport,
  DirectTransportError,
  RelayEnvelopeTransport,
  type EnvelopeTransport,
} from "./transport.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    squad: SquadService;
  }
}

export interface DelegationView extends DelegationRecord {}

export type HumanInput = HumanInputValue;

type SetupSource = "UNCONFIGURED" | "FILE" | "INTERFACE" | "EXISTING_DATA";

type SquadConfigurationErrorCode =
  | "SQUAD_SERVICE_CLOSED"
  | "SQUAD_CONFIGURATION_IN_PROGRESS"
  | "INVALID_RELAY_URL"
  | "INVALID_DIRECT_URL"
  | "RELAY_ENROLLMENT_REQUIRED"
  | "RELAY_CONNECTION_FAILED"
  | "DIRECT_PUBLIC_URL_REQUIRED";

export class SquadConfigurationError extends Error {
  constructor(
    readonly code: SquadConfigurationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

interface RuntimeNodeSettings {
  displayName: string;
  setupRequired: boolean;
  setupMode?: NodeSetupMode;
  setupSource: SetupSource;
  relayUrl?: string;
  directEnabled: boolean;
  directPublicUrl?: string;
}

export interface SquadLocalState {
  setup: {
    required: boolean;
    mode?: NodeSetupMode;
    source: SetupSource;
  };
  identity: { nodeId: string; displayName: string; publicKey: string };
  relay: { configured: boolean; serving: boolean; url?: string };
  direct: { serving: boolean; publicUrl?: string };
  automation: {
    rules: AutomationRuleView[];
    legacyPrefixCount: number;
  };
  peers: PeerRecord[];
  organizations: OrganizationView[];
  sessionOrganizations: Record<string, string>;
  revision: number;
  plans: TeamPlan[];
  delegations: DelegationRecord[];
  updates: UpdateSnapshot;
  connection: SquadConnectionDiagnostics;
}

class PermanentEnvelopeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

function shareableText(value: string): string {
  return value
    .replace(
      /(?:[A-Za-z]:\\|\/)(?:[^\s<>:"|?*]+[\\/])+[^\s<>:"|?*]*/gu,
      "[local path omitted]",
    )
    .replace(
      /\b(?:token|secret|credential|private[-_ ]?key)\s*[:=]\s*\S+/giu,
      "[secret omitted]",
    )
    .slice(0, 20_000);
}

function shareableOutputs(outputs: ResultOutput[]): ResultOutput[] {
  return outputs.map((output) =>
    output.type === "text"
      ? { type: "text", content: shareableText(output.content) }
      : output,
  );
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const complete = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", complete);
      resolve();
    };
    const timer = setTimeout(complete, milliseconds);
    timer.unref?.();
    signal.addEventListener("abort", complete, { once: true });
  });
}

export class SquadService extends Service {
  readonly config: ResolvedSquadConfig;
  readonly database: SquadDatabase;
  readonly identity: NodeIdentity;
  readonly relayServer?: RelayServer;
  relayClient: RelayClient | undefined = undefined;
  relayTransport: RelayEnvelopeTransport | undefined = undefined;
  readonly directTransport: DirectEnvelopeTransport;
  readonly executor: NativeDelegationExecutor;
  readonly attachments: AttachmentVerifier;
  readonly updates: UpdateController;
  readonly #starting = new Set<string>();
  readonly #dispatchingPlans = new Map<string, Promise<TeamPlan>>();
  readonly #stateListeners = new Set<(revision: number) => void>();
  #stateRevision = 1;
  #timer?: ReturnType<typeof setInterval>;
  #pumping = false;
  #pumpRequested = false;
  #flushing: Promise<void> | undefined;
  #relayEventsAbort: AbortController | undefined = undefined;
  #relayEventsTask: Promise<void> | undefined = undefined;
  #relayEventStream: "CONNECTED" | "POLLING" | "DISABLED" = "DISABLED";
  #relayLastSuccessfulAt: string | undefined = undefined;
  #relayLastError: string | undefined = undefined;
  #relayRemoteVersion: string | undefined = undefined;
  #relayProtocolVersions: number[] | undefined = undefined;
  #directLastReceivedAt: string | undefined = undefined;
  #directVerifiedAt: string | undefined = undefined;
  #directLastError: string | undefined = undefined;
  #connectionsCheckedAt: string | undefined = undefined;
  #configurationTask: Promise<SquadLocalState> | undefined = undefined;
  #reconfiguring = false;
  #started = false;
  #closed = false;
  #nodeSettings: RuntimeNodeSettings;
  #startupInvitation: string | undefined = undefined;

  constructor(ctx: Context, config: ResolvedSquadConfig) {
    super(ctx, "squad");
    this.config = config;
    this.database = new SquadDatabase(join(config.dataDir, "node.sqlite"));
    this.identity = NodeIdentity.load(
      join(config.dataDir, "identity.json"),
      this.database.identityNodeId(),
    );
    this.database.bindIdentity(
      this.identity.nodeId,
      this.identity.publicKey,
      this.identity.createdAt,
    );
    for (const peer of config.peers) {
      nodeIdSchema.parse(peer.nodeId);
      if (nodeIdFromPublicKey(peer.publicKey) !== peer.nodeId) {
        throw new Error(
          `configured peer ${peer.displayName} has a mismatched public key`,
        );
      }
      this.database.upsertPeer(peer);
    }
    const persistedSetup = this.database.nodeSetup();
    const hasExistingTeamData =
      this.database.listPeers().length > 0 ||
      this.database.listOrganizations(this.identity.nodeId).length > 0;
    const staticSetupMode =
      config.relay.url !== undefined
        ? "RELAY"
        : config.direct.enabled
          ? "DIRECT"
          : undefined;
    this.#nodeSettings =
      persistedSetup === undefined
        ? {
            displayName: config.displayName,
            setupRequired: config.setupRequired && !hasExistingTeamData,
            ...(staticSetupMode === undefined
              ? {}
              : { setupMode: staticSetupMode }),
            setupSource: config.setupRequired
              ? hasExistingTeamData
                ? "EXISTING_DATA"
                : "UNCONFIGURED"
              : "FILE",
            ...(config.relay.url === undefined
              ? {}
              : { relayUrl: config.relay.url }),
            directEnabled: config.direct.enabled,
            ...(config.direct.publicUrl === undefined
              ? {}
              : { directPublicUrl: config.direct.publicUrl }),
          }
        : {
            displayName: persistedSetup.displayName,
            setupRequired: false,
            setupMode: persistedSetup.mode,
            setupSource: "INTERFACE",
            ...(persistedSetup.relayUrl === undefined
              ? {}
              : { relayUrl: persistedSetup.relayUrl }),
            directEnabled: persistedSetup.directEnabled,
            ...(persistedSetup.directPublicUrl === undefined
              ? {}
              : { directPublicUrl: persistedSetup.directPublicUrl }),
          };
    this.#startupInvitation =
      persistedSetup === undefined ? config.relay.invitation : undefined;
    if (config.relay.enabled) {
      this.relayServer = new RelayServer({
        databasePath: config.relay.databasePath,
        invites: config.relay.invites,
        maxMailboxItems: config.relay.maxMailboxItems,
        maxRequestsPerMinute: config.relay.maxRequestsPerMinute,
      });
    }
    if (this.#nodeSettings.relayUrl !== undefined) {
      this.relayClient = new RelayClient(
        this.#nodeSettings.relayUrl,
        this.identity,
      );
      this.relayTransport = new RelayEnvelopeTransport(this.relayClient);
    }
    this.directTransport = new DirectEnvelopeTransport(
      this.identity,
      (nodeId) => this.database.findPeer(nodeId),
    );
    this.executor = new NativeDelegationExecutor(ctx, config.execution);
    this.attachments = new AttachmentVerifier(
      join(config.dataDir, "attachments"),
    );
    this.updates = new UpdateController(config.updates);
  }

  async start(): Promise<void> {
    await this.updates.start();
    if (
      this.relayClient !== undefined &&
      this.#startupInvitation !== undefined
    ) {
      await this.relayClient.enroll(
        this.#startupInvitation,
        this.#nodeSettings.displayName,
      );
      this.#startupInvitation = undefined;
    }
    for (const interrupted of this.database.interruptedExecutions()) {
      const failed = this.database.transition(interrupted.id, "FAILED", {
        summary:
          "The receiving DSH process stopped while execution was active. Potential external side effects were not replayed.",
        errorCode: "EXECUTION_INTERRUPTED",
        completedAt: new Date().toISOString(),
      });
      this.enqueueResult(failed);
    }
    this.#started = true;
    await this.pump();
    this.startRelayEvents();
    this.#timer = setInterval(() => {
      void this.pump();
    }, this.config.pollIntervalMs);
    this.#timer.unref?.();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    await this.stopRelayEvents();
    await this.#configurationTask?.catch(() => undefined);
    while (this.#pumping) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await this.#flushing?.catch(() => undefined);
    this.#stateListeners.clear();
    await this.executor.dispose();
    this.relayServer?.close();
    this.database.close();
  }

  listPeers(): Promise<PeerRecord[]> {
    return Promise.resolve(this.database.listPeers());
  }

  subscribeLocalState(listener: (revision: number) => void): () => void {
    this.#stateListeners.add(listener);
    listener(this.#stateRevision);
    return () => this.#stateListeners.delete(listener);
  }

  private touchLocalState(): void {
    this.#stateRevision += 1;
    for (const listener of this.#stateListeners) {
      listener(this.#stateRevision);
    }
  }

  private connectionError(error: unknown): string {
    return shareableText(
      error instanceof Error ? error.message : String(error),
    ).slice(0, 2_000);
  }

  private markRelaySuccess(): void {
    const recovered = this.#relayLastError !== undefined;
    this.#relayLastSuccessfulAt = new Date().toISOString();
    this.#relayLastError = undefined;
    if (recovered) this.touchLocalState();
  }

  private markRelayFailure(error: unknown): void {
    const next = this.connectionError(error);
    if (next === this.#relayLastError) return;
    this.#relayLastError = next;
    this.touchLocalState();
  }

  connectionDiagnostics(): SquadConnectionDiagnostics {
    const queue = this.database.outboxDiagnostics();
    const relayConfigured = this.relayClient !== undefined;
    const relayServing = this.relayServer !== undefined;
    const relayStatus = relayConfigured
      ? this.#relayLastError !== undefined
        ? "UNREACHABLE"
        : this.#relayLastSuccessfulAt !== undefined
          ? "CONNECTED"
          : "UNVERIFIED"
      : relayServing
        ? "SERVING"
        : "NOT_CONFIGURED";
    const directStatus = !this.#nodeSettings.directEnabled
      ? "NOT_CONFIGURED"
      : this.#directLastError !== undefined
        ? "UNREACHABLE"
        : this.#directVerifiedAt !== undefined
          ? "READY"
          : "UNVERIFIED";
    return {
      ...(this.#connectionsCheckedAt === undefined
        ? {}
        : { checkedAt: this.#connectionsCheckedAt }),
      relay: {
        status: relayStatus,
        configured: relayConfigured,
        serving: relayServing,
        ...(this.#nodeSettings.relayUrl === undefined
          ? {}
          : { url: this.#nodeSettings.relayUrl }),
        ...(this.#relayLastSuccessfulAt === undefined
          ? {}
          : { lastSuccessfulAt: this.#relayLastSuccessfulAt }),
        ...(this.#relayLastError === undefined
          ? {}
          : { lastError: this.#relayLastError }),
        eventStream: relayConfigured ? this.#relayEventStream : "DISABLED",
        ...(this.#relayRemoteVersion === undefined
          ? {}
          : { remoteVersion: this.#relayRemoteVersion }),
        ...(this.#relayProtocolVersions === undefined
          ? {}
          : { protocolVersions: this.#relayProtocolVersions }),
      },
      direct: {
        status: directStatus,
        serving: this.#nodeSettings.directEnabled,
        ...(this.#nodeSettings.directPublicUrl === undefined
          ? {}
          : { publicUrl: this.#nodeSettings.directPublicUrl }),
        ...(this.#directLastReceivedAt === undefined
          ? {}
          : { lastReceivedAt: this.#directLastReceivedAt }),
        ...(this.#directLastError === undefined
          ? {}
          : { lastError: this.#directLastError }),
      },
      queue,
    };
  }

  async checkConnections(): Promise<SquadConnectionDiagnostics> {
    const relay = this.relayClient;
    if (relay !== undefined) {
      try {
        const health = await relay.health();
        await relay.mailbox(
          this.database.mailboxCursor(
            this.#nodeSettings.relayUrl ?? relay.baseUrl,
          ),
          1,
        );
        this.#relayRemoteVersion = health.version;
        this.#relayProtocolVersions = health.protocolVersions;
        this.markRelaySuccess();
      } catch (error) {
        this.markRelayFailure(error);
      }
    }
    const directUrl = this.#nodeSettings.directPublicUrl;
    if (this.#nodeSettings.directEnabled && directUrl !== undefined) {
      try {
        const health = await new RelayClient(directUrl, this.identity).health();
        if (health.nodeId !== this.identity.nodeId) {
          throw new Error(
            "Direct public URL resolves to a different Squad Node identity",
          );
        }
        this.#directVerifiedAt = new Date().toISOString();
        this.#directLastError = undefined;
      } catch (error) {
        this.#directLastError = this.connectionError(error);
      }
    }
    this.#connectionsCheckedAt = new Date().toISOString();
    this.touchLocalState();
    return this.connectionDiagnostics();
  }

  async configureNode(input: NodeSetupInput): Promise<SquadLocalState> {
    if (this.#closed) {
      throw new SquadConfigurationError(
        "SQUAD_SERVICE_CLOSED",
        "Squad service is closed",
      );
    }
    if (this.#configurationTask !== undefined) {
      throw new SquadConfigurationError(
        "SQUAD_CONFIGURATION_IN_PROGRESS",
        "another Squad configuration change is in progress",
      );
    }
    const task = this.configureNodeNow(input);
    this.#configurationTask = task;
    try {
      return await task;
    } finally {
      if (this.#configurationTask === task) {
        this.#configurationTask = undefined;
      }
    }
  }

  private async configureNodeNow(
    input: NodeSetupInput,
  ): Promise<SquadLocalState> {
    let nextRelayClient: RelayClient | undefined;
    let nextRelayTransport: RelayEnvelopeTransport | undefined;
    let nextSettings: RuntimeNodeSettings;

    if (input.mode === "RELAY") {
      let relayUrl: string | undefined;
      let directPublicUrl: string | undefined;
      try {
        relayUrl = resolveRelayBaseUrl(input.relayUrl, "Relay URL");
      } catch (error) {
        throw new SquadConfigurationError(
          "INVALID_RELAY_URL",
          "Relay URL must be an HTTPS origin",
          { cause: error },
        );
      }
      if (relayUrl === undefined) {
        throw new SquadConfigurationError(
          "INVALID_RELAY_URL",
          "Relay URL is required",
        );
      }
      try {
        directPublicUrl = resolveDirectBaseUrl(
          input.directPublicUrl,
          "Direct public URL",
        );
      } catch (error) {
        throw new SquadConfigurationError(
          "INVALID_DIRECT_URL",
          "Direct public URL must be an HTTPS origin",
          { cause: error },
        );
      }
      if (input.directEnabled === true && directPublicUrl === undefined) {
        throw new SquadConfigurationError(
          "DIRECT_PUBLIC_URL_REQUIRED",
          "Direct public URL is required when Direct receiving is enabled",
        );
      }
      nextRelayClient = new RelayClient(relayUrl, this.identity);
      try {
        if (input.invitation !== undefined) {
          await nextRelayClient.enroll(input.invitation, input.displayName);
        }
        await nextRelayClient.mailbox(this.database.mailboxCursor(relayUrl), 1);
        this.#relayLastSuccessfulAt = new Date().toISOString();
        this.#relayLastError = undefined;
      } catch (error) {
        if (
          input.invitation === undefined &&
          error instanceof RelayClientError &&
          [401, 403].includes(error.status)
        ) {
          throw new SquadConfigurationError(
            "RELAY_ENROLLMENT_REQUIRED",
            "this Node is not enrolled at that Relay; enter a one-time invitation",
            { cause: error },
          );
        }
        if (!(error instanceof RelayClientError)) {
          throw new SquadConfigurationError(
            "RELAY_CONNECTION_FAILED",
            "could not connect to the Relay",
            { cause: error },
          );
        }
        throw error;
      }
      nextRelayTransport = new RelayEnvelopeTransport(nextRelayClient);
      nextSettings = {
        displayName: input.displayName,
        setupRequired: false,
        setupMode: "RELAY",
        setupSource: "INTERFACE",
        relayUrl,
        directEnabled: input.directEnabled === true,
        ...(directPublicUrl === undefined ? {} : { directPublicUrl }),
      };
    } else {
      let directPublicUrl: string | undefined;
      try {
        directPublicUrl = resolveDirectBaseUrl(
          input.directPublicUrl,
          "Direct public URL",
        );
      } catch (error) {
        throw new SquadConfigurationError(
          "INVALID_DIRECT_URL",
          "Direct public URL must be an HTTPS origin",
          { cause: error },
        );
      }
      if (input.directEnabled && directPublicUrl === undefined) {
        throw new SquadConfigurationError(
          "DIRECT_PUBLIC_URL_REQUIRED",
          "Direct public URL is required when Direct receiving is enabled",
        );
      }
      nextSettings = {
        displayName: input.displayName,
        setupRequired: false,
        setupMode: "DIRECT",
        setupSource: "INTERFACE",
        directEnabled: input.directEnabled,
        ...(directPublicUrl === undefined ? {} : { directPublicUrl }),
      };
    }

    this.#reconfiguring = true;
    try {
      await this.stopRelayEvents();
      while (this.#pumping) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await this.#flushing?.catch(() => undefined);
      this.database.saveNodeSetup({
        mode: input.mode,
        displayName: nextSettings.displayName,
        ...(nextSettings.relayUrl === undefined
          ? {}
          : { relayUrl: nextSettings.relayUrl }),
        directEnabled: nextSettings.directEnabled,
        ...(nextSettings.directPublicUrl === undefined
          ? {}
          : { directPublicUrl: nextSettings.directPublicUrl }),
      });
      this.#nodeSettings = nextSettings;
      this.relayClient = nextRelayClient;
      this.relayTransport = nextRelayTransport;
      this.#relayEventStream = nextRelayClient ? "POLLING" : "DISABLED";
      if (nextRelayClient === undefined) {
        this.#relayLastSuccessfulAt = undefined;
        this.#relayLastError = undefined;
        this.#relayRemoteVersion = undefined;
        this.#relayProtocolVersions = undefined;
      }
      this.#directVerifiedAt = undefined;
      this.#directLastError = undefined;
      this.#startupInvitation = undefined;
    } finally {
      this.#reconfiguring = false;
      if (this.#started && !this.#closed) this.startRelayEvents();
    }
    this.touchLocalState();
    if (this.#started) void this.pump();
    return this.localState();
  }

  addPeer(input: {
    nodeId: string;
    displayName: string;
    publicKey: string;
    enabled?: boolean;
    transport?: PeerTransport;
    directUrl?: string;
    policy?: Partial<PeerPolicy>;
  }): Promise<PeerRecord> {
    nodeIdSchema.parse(input.nodeId);
    if (nodeIdFromPublicKey(input.publicKey) !== input.nodeId) {
      throw new Error("peer public key fingerprint does not match nodeId");
    }
    const transport = input.transport ?? "RELAY";
    const directUrl = resolveDirectBaseUrl(
      input.directUrl,
      `squad peer ${input.displayName} directUrl`,
    );
    if (transport === "DIRECT" && directUrl === undefined) {
      throw new Error("DIRECT peer requires a direct URL");
    }
    this.database.upsertPeer({
      nodeId: input.nodeId,
      displayName: input.displayName,
      publicKey: input.publicKey,
      enabled: input.enabled ?? true,
      transport,
      ...(directUrl === undefined ? {} : { directUrl }),
      policy: peerPolicySchema.parse(input.policy ?? {}),
    });
    const peer = this.database.findPeer(input.nodeId);
    if (peer === undefined) throw new Error("peer was not persisted");
    this.touchLocalState();
    return Promise.resolve(peer);
  }

  createPairingBundle(expiresInMinutes = 10_080): {
    bundle: string;
    expiresAt: string;
  } {
    if (
      !Number.isInteger(expiresInMinutes) ||
      expiresInMinutes < 5 ||
      expiresInMinutes > 43_200
    ) {
      throw new Error("pairing bundle lifetime must be 5 to 43200 minutes");
    }
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + expiresInMinutes * 60_000,
    ).toISOString();
    const unsigned = unsignedPairingBundleSchema.parse({
      version: 1,
      nodeId: this.identity.nodeId,
      displayName: this.#nodeSettings.displayName,
      publicKey: this.identity.publicKey,
      ...(this.#nodeSettings.relayUrl === undefined
        ? {}
        : { relayUrl: this.#nodeSettings.relayUrl }),
      ...(!this.#nodeSettings.directEnabled ||
      this.#nodeSettings.directPublicUrl === undefined
        ? {}
        : { directUrl: this.#nodeSettings.directPublicUrl }),
      issuedAt: issuedAt.toISOString(),
      expiresAt,
    });
    const signed: PairingBundle = {
      ...unsigned,
      signature: this.identity.sign(unsigned),
    };
    return { bundle: encodePairingBundle(signed), expiresAt };
  }

  async importPairingBundle(input: ImportPairingBundle): Promise<PeerRecord> {
    const bundle = decodePairingBundle(input.bundle);
    if (bundle.nodeId === this.identity.nodeId) {
      throw new Error("cannot pair this Node with itself");
    }
    if (nodeIdFromPublicKey(bundle.publicKey) !== bundle.nodeId) {
      throw new Error("pairing bundle public key does not match its Node ID");
    }
    if (
      !verifySignature(
        unsignedPairingBundle(bundle),
        bundle.signature,
        bundle.publicKey,
      )
    ) {
      throw new Error("pairing bundle signature is invalid");
    }
    const issuedAt = Date.parse(bundle.issuedAt);
    const expiresAt = Date.parse(bundle.expiresAt);
    if (issuedAt > Date.now() + 5 * 60_000 || expiresAt <= issuedAt) {
      throw new Error("pairing bundle timestamps are invalid");
    }
    if (expiresAt <= Date.now()) throw new Error("pairing bundle has expired");

    const requestedDirectUrl = input.directUrl ?? bundle.directUrl;
    const transport =
      input.transport ??
      (requestedDirectUrl !== undefined ? "DIRECT" : "RELAY");
    if (transport === "RELAY") {
      if (this.relayClient === undefined) {
        throw new Error("a Relay connection is required for Relay pairing");
      }
      if (
        bundle.relayUrl !== undefined &&
        resolveRelayBaseUrl(bundle.relayUrl, "pairing Relay URL") !==
          this.#nodeSettings.relayUrl
      ) {
        throw new Error(
          "the peer uses a different Relay; choose Direct or connect both Nodes to the same Relay",
        );
      }
    }
    const directUrl = resolveDirectBaseUrl(
      requestedDirectUrl,
      `pairing bundle for ${bundle.displayName}`,
    );
    if (transport === "DIRECT" && directUrl === undefined) {
      throw new Error("the pairing bundle has no Direct URL");
    }
    return await this.addPeer({
      nodeId: bundle.nodeId,
      displayName: bundle.displayName,
      publicKey: bundle.publicKey,
      enabled: true,
      transport,
      ...(directUrl === undefined ? {} : { directUrl }),
      policy: peerPolicySchema.parse({
        canMessage: true,
        canDelegate: true,
        autoExecute: "NEVER",
        maxConcurrent: 1,
        maxDelegationDepth: 1,
        maxRuntimeMinutes: 30,
        ...input.policy,
      }),
    });
  }

  updatePeerConnection(
    nodeId: string,
    input: UpdatePeerConnection,
  ): Promise<PeerRecord> {
    const parsedNodeId = nodeIdSchema.parse(nodeId);
    const current = this.database.findPeer(parsedNodeId);
    if (current === undefined) throw new Error("unknown direct peer");
    if (
      (input.transport ?? current.transport) === "RELAY" &&
      this.relayClient === undefined
    ) {
      throw new Error("a Relay connection is required for Relay peers");
    }
    const directUrl =
      input.directUrl === undefined || input.directUrl === null
        ? input.directUrl
        : resolveDirectBaseUrl(input.directUrl, "peer Direct URL");
    const peer = this.database.updatePeerConnection(parsedNodeId, {
      ...(input.displayName === undefined
        ? {}
        : { displayName: input.displayName.trim() }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.transport === undefined ? {} : { transport: input.transport }),
      ...(directUrl === undefined ? {} : { directUrl }),
    });
    this.touchLocalState();
    return Promise.resolve(peer);
  }

  removePeer(nodeId: string): Promise<void> {
    this.database.removePeer(nodeIdSchema.parse(nodeId));
    this.touchLocalState();
    return Promise.resolve();
  }

  updatePeerPolicy(
    nodeId: string,
    policy: Partial<PeerPolicy>,
  ): Promise<PeerRecord> {
    const peer = this.database.updatePeerPolicy(nodeId, policy);
    this.touchLocalState();
    return Promise.resolve(peer);
  }

  createAutomationRule(
    input: AutomationRuleInput,
  ): Promise<AutomationRuleView> {
    const rule = this.database.createAutomationRule(
      automationRuleInputSchema.parse(input),
    );
    this.touchLocalState();
    return Promise.resolve({ ...rule, source: "INTERFACE" });
  }

  updateAutomationRule(
    id: string,
    input: AutomationRuleInput,
  ): Promise<AutomationRuleView> {
    const rule = this.database.updateAutomationRule(
      id,
      automationRuleInputSchema.parse(input),
    );
    this.touchLocalState();
    return Promise.resolve({ ...rule, source: "INTERFACE" });
  }

  deleteAutomationRule(id: string): Promise<void> {
    this.database.deleteAutomationRule(id);
    this.touchLocalState();
    return Promise.resolve();
  }

  private automationRules(): AutomationRuleView[] {
    const interfaceRules: AutomationRuleView[] = this.database
      .listAutomationRules()
      .map((rule) => ({ ...rule, source: "INTERFACE" }));
    const fileRules: AutomationRuleView[] =
      this.config.execution.automationRules.map((rule, index) => ({
        ...rule,
        id: `file-${index + 1}`,
        source: "FILE",
      }));
    return [...interfaceRules, ...fileRules].sort(
      (left, right) =>
        left.priority - right.priority ||
        (left.source === right.source
          ? left.id.localeCompare(right.id)
          : left.source === "INTERFACE"
            ? -1
            : 1),
    );
  }

  private matchingAutomationRule(
    input: Pick<DelegationRecord, "objective" | "attachmentRefs">,
  ): AutomationRuleView | undefined {
    return this.automationRules().find((rule) =>
      matchesAutomationRule(rule, {
        objective: input.objective,
        attachmentCount: input.attachmentRefs.length,
      }),
    );
  }

  listOrganizations(): Promise<OrganizationView[]> {
    return Promise.resolve(
      this.database.listOrganizations(this.identity.nodeId),
    );
  }

  sessionOrganization(sessionId?: string): OrganizationView | undefined {
    if (sessionId === undefined) return undefined;
    const organizationId = this.database.sessionOrganization(sessionId);
    return organizationId === undefined
      ? undefined
      : this.database.findOrganization(organizationId, this.identity.nodeId);
  }

  listRecipients(sessionId?: string): Promise<{
    organization?: OrganizationView;
    members: ResolvedDelegationRecipient[];
  }> {
    const organization = this.sessionOrganization(sessionId);
    if (organization === undefined) {
      return Promise.resolve({ members: this.database.listPeers() });
    }
    if (organization.selfMembershipId === undefined) {
      throw new Error("the Session organization is not active for this Node");
    }
    const senderMembershipId = organization.selfMembershipId;
    return Promise.resolve({
      organization,
      members: organization.members
        .filter((member) => !member.isSelf && member.status === "ACTIVE")
        .map((member) => ({
          nodeId: member.nodeId,
          displayName: member.displayName,
          publicKey: member.publicKey,
          enabled: true,
          transport: "RELAY",
          policy: member.policy,
          organizationId: organization.organizationId,
          membershipId: member.membershipId,
          senderMembershipId,
        })),
    });
  }

  private requireRelayClient(): RelayClient {
    if (this.relayClient === undefined) {
      throw new Error("a Relay connection is required for organizations");
    }
    return this.relayClient;
  }

  private selfOrganizationMember(
    directory: OrganizationDirectoryRecord,
  ): OrganizationMembershipCertificate {
    const member = [...directory.members.values()].find(
      (candidate) =>
        candidate.nodeId === this.identity.nodeId &&
        candidate.status === "ACTIVE",
    );
    if (member === undefined) {
      throw new Error("this Node is not an active organization member");
    }
    return member;
  }

  private async syncOrganizations(): Promise<boolean> {
    const relayClient = this.relayClient;
    if (relayClient === undefined) return false;
    const bundles = await relayClient.organizations();
    let changed = false;
    for (const bundle of bundles) {
      changed =
        this.database.applyOrganizationBundle(bundle, this.identity.nodeId) ||
        changed;
    }
    if (changed) this.touchLocalState();
    return changed;
  }

  async createOrganization(nameCandidate: string): Promise<OrganizationView> {
    const name = nameCandidate.trim();
    if (name.length < 1 || name.length > 120) {
      throw new Error("organization name must contain 1 to 120 characters");
    }
    const relay = this.requireRelayClient();
    const organizationId = randomUUID();
    const ownerMembershipId = randomUUID();
    const authority = OrganizationAuthority.create(
      join(
        this.config.dataDir,
        "organizations",
        organizationId,
        "authority.json",
      ),
    );
    const createdAt = new Date().toISOString();
    const unsignedDocument = unsignedOrganizationDocumentSchema.parse({
      version: 1,
      organizationId,
      name,
      authorityId: authority.authorityId,
      authorityPublicKey: authority.publicKey,
      ownerMembershipId,
      createdAt,
    });
    const document: OrganizationDocument = {
      ...unsignedDocument,
      signature: authority.sign(unsignedDocument),
    };
    const unsignedOwner = unsignedOrganizationMembershipCertificateSchema.parse(
      {
        version: 1,
        organizationId,
        organizationRevision: 1,
        membershipId: ownerMembershipId,
        memberRevision: 1,
        nodeId: this.identity.nodeId,
        publicKey: this.identity.publicKey,
        displayName: this.#nodeSettings.displayName,
        role: "OWNER",
        status: "ACTIVE",
        issuer: { kind: "AUTHORITY", authorityId: authority.authorityId },
        issuedAt: createdAt,
      },
    );
    const ownerCertificate: OrganizationMembershipCertificate = {
      ...unsignedOwner,
      signature: authority.sign(unsignedOwner),
    };
    await relay.createOrganization(document, ownerCertificate);
    await this.syncOrganizations();
    const organization = this.database.findOrganization(
      organizationId,
      this.identity.nodeId,
    );
    if (organization === undefined) {
      throw new Error("created organization was not synchronized");
    }
    return organization;
  }

  async createOrganizationInvitation(
    organizationSelector: string,
    expiresInMinutes = 1_440,
  ): Promise<{ invitation: string; expiresAt: string }> {
    await this.syncOrganizations();
    const organization = this.database.findOrganization(
      organizationSelector,
      this.identity.nodeId,
    );
    if (
      organization === undefined ||
      organization.membershipStatus !== "ACTIVE"
    ) {
      throw new Error("unknown active organization");
    }
    if (!organization.role || !["OWNER", "ADMIN"].includes(organization.role)) {
      throw new Error("Owner or Admin role is required to create invitations");
    }
    return this.requireRelayClient().createOrganizationInvitation(
      organization.organizationId,
      expiresInMinutes,
    );
  }

  async createOrganizationJoinPackage(
    organizationSelector: string,
    expiresInMinutes = 1_440,
  ): Promise<{ bundle: string; expiresAt: string }> {
    await this.syncOrganizations();
    const organization = this.database.findOrganization(
      organizationSelector,
      this.identity.nodeId,
    );
    if (
      organization === undefined ||
      organization.membershipStatus !== "ACTIVE"
    ) {
      throw new Error("unknown active organization");
    }
    if (!organization.role || !["OWNER", "ADMIN"].includes(organization.role)) {
      throw new Error(
        "Owner or Admin role is required to create join packages",
      );
    }
    const relayUrl = this.#nodeSettings.relayUrl;
    if (relayUrl === undefined) {
      throw new Error("a Relay connection is required for join packages");
    }
    const invitations =
      await this.requireRelayClient().createOrganizationJoinPackage(
        organization.organizationId,
        expiresInMinutes,
      );
    const issuedAt = new Date().toISOString();
    const unsigned = unsignedJoinPackageSchema.parse({
      version: 1,
      relayUrl,
      organizationId: organization.organizationId,
      organizationName: organization.name,
      enrollmentInvitation: invitations.enrollmentInvitation,
      organizationInvitation: invitations.organizationInvitation,
      issuer: {
        nodeId: this.identity.nodeId,
        displayName: this.#nodeSettings.displayName,
        publicKey: this.identity.publicKey,
      },
      issuedAt,
      expiresAt: invitations.expiresAt,
    });
    const signed: JoinPackage = {
      ...unsigned,
      signature: this.identity.sign(unsigned),
    };
    return {
      bundle: encodeJoinPackage(signed),
      expiresAt: invitations.expiresAt,
    };
  }

  async importJoinPackage(input: ImportJoinPackage): Promise<{
    organizationId: string;
    organizationName: string;
    status: "PENDING";
  }> {
    const bundle = decodeJoinPackage(input.bundle);
    if (nodeIdFromPublicKey(bundle.issuer.publicKey) !== bundle.issuer.nodeId) {
      throw new Error("join package issuer identity is invalid");
    }
    if (
      !verifySignature(
        unsignedJoinPackage(bundle),
        bundle.signature,
        bundle.issuer.publicKey,
      )
    ) {
      throw new Error("join package signature is invalid");
    }
    const issuedAt = Date.parse(bundle.issuedAt);
    const expiresAt = Date.parse(bundle.expiresAt);
    if (issuedAt > Date.now() + 5 * 60_000 || expiresAt <= issuedAt) {
      throw new Error("join package timestamps are invalid");
    }
    if (expiresAt <= Date.now()) throw new Error("join package has expired");
    if (
      organizationIdFromInvitation(bundle.organizationInvitation) !==
      bundle.organizationId
    ) {
      throw new Error("join package organization invitation does not match");
    }
    const relayUrl = resolveRelayBaseUrl(
      bundle.relayUrl,
      "join package Relay URL",
    );
    if (relayUrl === undefined)
      throw new Error("join package Relay URL is invalid");
    if (
      this.#nodeSettings.relayUrl !== undefined &&
      this.#nodeSettings.relayUrl !== relayUrl
    ) {
      throw new Error(
        "this Node is connected to a different Relay; switching Relays requires an explicit settings change",
      );
    }
    await this.configureNode({
      mode: "RELAY",
      displayName: input.displayName ?? this.#nodeSettings.displayName,
      relayUrl,
      invitation: bundle.enrollmentInvitation,
      directEnabled: this.#nodeSettings.directEnabled,
      ...(this.#nodeSettings.directPublicUrl === undefined
        ? {}
        : { directPublicUrl: this.#nodeSettings.directPublicUrl }),
    });
    await this.joinOrganization(bundle.organizationInvitation);
    return {
      organizationId: bundle.organizationId,
      organizationName: bundle.organizationName,
      status: "PENDING",
    };
  }

  async joinOrganization(invitationCandidate: string): Promise<void> {
    const invitation = invitationCandidate.trim();
    const organizationId = organizationIdFromInvitation(invitation);
    const unsignedRequest = unsignedOrganizationJoinRequestSchema.parse({
      version: 1,
      requestId: randomUUID(),
      organizationId,
      membershipId: randomUUID(),
      nodeId: this.identity.nodeId,
      publicKey: this.identity.publicKey,
      displayName: this.#nodeSettings.displayName,
      requestedAt: new Date().toISOString(),
    });
    const request: OrganizationJoinRequest = {
      ...unsignedRequest,
      signature: this.identity.sign(unsignedRequest),
    };
    await this.requireRelayClient().joinOrganization(invitation, request);
    await this.syncOrganizations();
  }

  private memberCertificate(
    directory: OrganizationDirectoryRecord,
    target: {
      membershipId: string;
      memberRevision: number;
      nodeId: string;
      publicKey: string;
      displayName: string;
      role: OrganizationRole;
      status: "ACTIVE" | "DISABLED";
    },
  ): OrganizationMembershipCertificate {
    const issuer = this.selfOrganizationMember(directory);
    const unsigned = unsignedOrganizationMembershipCertificateSchema.parse({
      version: 1,
      organizationId: directory.document.organizationId,
      organizationRevision: directory.revision + 1,
      ...target,
      issuer: {
        kind: "MEMBER",
        membershipId: issuer.membershipId,
        nodeId: issuer.nodeId,
      },
      issuedAt: new Date().toISOString(),
    });
    return { ...unsigned, signature: this.identity.sign(unsigned) };
  }

  async approveOrganizationJoin(
    organizationId: string,
    requestId: string,
  ): Promise<void> {
    await this.syncOrganizations();
    const directory = this.database.organizationDirectory(organizationId);
    if (directory === undefined) throw new Error("unknown organization");
    const request = directory.pendingJoinRequests.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (request === undefined) throw new Error("unknown pending join request");
    const certificate = this.memberCertificate(directory, {
      membershipId: request.membershipId,
      memberRevision: 1,
      nodeId: request.nodeId,
      publicKey: request.publicKey,
      displayName: request.displayName,
      role: "MEMBER",
      status: "ACTIVE",
    });
    await this.requireRelayClient().approveOrganizationJoin(
      organizationId,
      requestId,
      certificate,
    );
    await this.syncOrganizations();
  }

  async rejectOrganizationJoin(
    organizationId: string,
    requestId: string,
  ): Promise<void> {
    await this.syncOrganizations();
    const directory = this.database.organizationDirectory(organizationId);
    if (directory === undefined) throw new Error("unknown organization");
    if (
      !directory.pendingJoinRequests.some(
        (candidate) => candidate.requestId === requestId,
      )
    ) {
      throw new Error("unknown pending join request");
    }
    await this.requireRelayClient().rejectOrganizationJoin(
      organizationId,
      requestId,
    );
    await this.syncOrganizations();
  }

  private async changeOrganizationMember(
    organizationId: string,
    membershipId: string,
    change: { role?: OrganizationRole; status?: "ACTIVE" | "DISABLED" },
  ): Promise<void> {
    await this.syncOrganizations();
    const directory = this.database.organizationDirectory(organizationId);
    if (directory === undefined) throw new Error("unknown organization");
    const current = directory.members.get(membershipId);
    if (current === undefined) throw new Error("unknown organization member");
    const certificate = this.memberCertificate(directory, {
      membershipId: current.membershipId,
      memberRevision: current.memberRevision + 1,
      nodeId: current.nodeId,
      publicKey: current.publicKey,
      displayName: current.displayName,
      role: change.role ?? current.role,
      status: change.status ?? current.status,
    });
    await this.requireRelayClient().updateOrganizationMember(
      organizationId,
      membershipId,
      certificate,
    );
    await this.syncOrganizations();
  }

  async setOrganizationMemberRole(
    organizationId: string,
    membershipId: string,
    roleCandidate: string,
  ): Promise<void> {
    const role = organizationRoleSchema.parse(roleCandidate);
    if (role === "OWNER") {
      throw new Error("Owner transfer is not supported in directory v1");
    }
    const organization = this.database.findOrganization(
      organizationId,
      this.identity.nodeId,
    );
    if (organization?.role !== "OWNER") {
      throw new Error("only the Owner can appoint or demote Admins");
    }
    await this.changeOrganizationMember(organizationId, membershipId, { role });
  }

  async setOrganizationMemberEnabled(
    organizationId: string,
    membershipId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.changeOrganizationMember(organizationId, membershipId, {
      status: enabled ? "ACTIVE" : "DISABLED",
    });
  }

  updateOrganizationMemberPolicy(
    organizationId: string,
    membershipId: string,
    policy: Partial<PeerPolicy>,
  ): Promise<OrganizationMemberView> {
    const member = this.database.updateOrganizationMemberPolicy(
      organizationId,
      membershipId,
      policy,
    );
    this.touchLocalState();
    return Promise.resolve(member);
  }

  selectSessionOrganization(
    sessionId: string,
    organizationSelector?: string,
  ): Promise<void> {
    const organizationId =
      organizationSelector === undefined
        ? undefined
        : this.database.findOrganization(
            organizationSelector,
            this.identity.nodeId,
          )?.organizationId;
    if (organizationSelector !== undefined && organizationId === undefined) {
      throw new Error(`unknown organization ${organizationSelector}`);
    }
    this.database.setSessionOrganization(
      sessionId,
      organizationId,
      this.identity.nodeId,
    );
    this.touchLocalState();
    return Promise.resolve();
  }

  private createEnvelope(
    kind: Envelope["kind"],
    recipientNodeId: string,
    correlationId: string,
    payload: unknown,
    routing?: {
      organizationId: string;
      senderMembershipId: string;
      recipientMembershipId: string;
    },
  ): Envelope {
    const createdAt = new Date();
    const unsigned = {
      protocolVersion: routing === undefined ? 1 : 2,
      envelopeId: randomUUID(),
      kind,
      senderNodeId: this.identity.nodeId,
      recipientNodeId,
      correlationId,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + this.config.envelopeTtlMinutes * 60_000,
      ).toISOString(),
      ...(routing === undefined ? {} : routing),
      payload,
    } as UnsignedEnvelope;
    return envelopeSchema.parse(this.identity.signEnvelope(unsigned));
  }

  private routingForDelegation(delegation: DelegationRecord):
    | {
        organizationId: string;
        senderMembershipId: string;
        recipientMembershipId: string;
      }
    | undefined {
    if (delegation.organizationId === undefined) return undefined;
    if (
      delegation.senderMembershipId === undefined ||
      delegation.recipientMembershipId === undefined
    ) {
      throw new Error(
        "organization delegation has incomplete membership routing",
      );
    }
    return delegation.direction === "OUTGOING"
      ? {
          organizationId: delegation.organizationId,
          senderMembershipId: delegation.senderMembershipId,
          recipientMembershipId: delegation.recipientMembershipId,
        }
      : {
          organizationId: delegation.organizationId,
          senderMembershipId: delegation.recipientMembershipId,
          recipientMembershipId: delegation.senderMembershipId,
        };
  }

  async delegate(
    candidate: CreateDelegationInput,
    initiatingSessionId?: string,
  ): Promise<DelegationView> {
    return this.delegateWithId(candidate, randomUUID(), initiatingSessionId);
  }

  private async delegateWithId(
    candidate: CreateDelegationInput,
    delegationIdCandidate: string,
    initiatingSessionId?: string,
    organizationIdOverride?: string,
  ): Promise<DelegationView> {
    const input = createDelegationInputSchema.parse(candidate);
    const delegationId = idSchema.parse(delegationIdCandidate);
    const parentFromSession =
      initiatingSessionId === undefined
        ? undefined
        : this.database.getDelegationBySession(initiatingSessionId);
    if (
      parentFromSession !== undefined &&
      input.parentDelegationId !== undefined &&
      input.parentDelegationId !== parentFromSession.id
    ) {
      throw new Error(
        "parentDelegationId does not match the calling DSH session",
      );
    }
    const parentId = parentFromSession?.id ?? input.parentDelegationId;
    const parent =
      parentId === undefined
        ? undefined
        : this.database.getDelegation(parentId);
    if (parentId !== undefined && parent === undefined) {
      throw new Error("parentDelegationId is not local to this Node");
    }
    const sessionOrganizationId =
      initiatingSessionId === undefined
        ? undefined
        : this.database.sessionOrganization(initiatingSessionId);
    const organizationId =
      organizationIdOverride ?? sessionOrganizationId ?? parent?.organizationId;
    const peer = this.resolveRecipient(input.to, organizationId);
    const depth = (parent?.delegationDepth ?? -1) + 1;
    const existing = this.database.getDelegation(delegationId);
    if (existing !== undefined) {
      const sameRequest =
        existing.direction === "OUTGOING" &&
        existing.peerNodeId === peer.nodeId &&
        existing.organizationId === peer.organizationId &&
        existing.senderMembershipId === peer.senderMembershipId &&
        existing.recipientMembershipId === peer.membershipId &&
        existing.parentDelegationId === parentId &&
        existing.objective === input.objective &&
        existing.context === input.context &&
        JSON.stringify(existing.acceptanceCriteria) ===
          JSON.stringify(input.acceptanceCriteria ?? []) &&
        JSON.stringify(existing.attachmentRefs) ===
          JSON.stringify(input.attachmentRefs ?? []) &&
        existing.delegationDepth === depth;
      if (!sameRequest) {
        throw new Error(
          `delegation ${delegationId} conflicts with an existing record`,
        );
      }
      return existing;
    }
    if (!peer.enabled) {
      throw new Error(`recipient ${input.to} is unavailable or disabled`);
    }
    if (!peer.policy.canDelegate) {
      throw new Error(`peer ${peer.displayName} does not allow delegation`);
    }
    if (depth > peer.policy.maxDelegationDepth) {
      throw new Error(
        `delegation depth ${depth} exceeds peer policy limit ${peer.policy.maxDelegationDepth}`,
      );
    }
    const request = {
      delegationId,
      ...(parentId === undefined ? {} : { parentDelegationId: parentId }),
      objective: input.objective,
      ...(input.context === undefined ? {} : { context: input.context }),
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      attachmentRefs: input.attachmentRefs ?? [],
      delegationDepth: depth,
    };
    const envelope = this.createEnvelope(
      "DELEGATION_REQUEST",
      peer.nodeId,
      delegationId,
      request,
      peer.organizationId === undefined ||
        peer.senderMembershipId === undefined ||
        peer.membershipId === undefined
        ? undefined
        : {
            organizationId: peer.organizationId,
            senderMembershipId: peer.senderMembershipId,
            recipientMembershipId: peer.membershipId,
          },
    );
    this.database.createOutgoing(request, envelope, envelopeDigest(envelope));
    await this.flushOutbox();
    const record = this.database.getDelegation(delegationId);
    if (record === undefined) throw new Error("delegation was not persisted");
    this.touchLocalState();
    return record;
  }

  private resolveRecipient(
    selector: string,
    organizationId?: string,
  ): ResolvedDelegationRecipient {
    if (organizationId === undefined) {
      const peer = this.database.findPeer(selector);
      if (peer === undefined) {
        throw new Error(`peer ${selector} is not paired or is disabled`);
      }
      return peer;
    }
    const organization = this.database.findOrganization(
      organizationId,
      this.identity.nodeId,
    );
    if (
      organization === undefined ||
      organization.membershipStatus !== "ACTIVE" ||
      organization.selfMembershipId === undefined
    ) {
      throw new Error("the selected organization is not active on this Node");
    }
    const member = this.database.findOrganizationMember(
      organization.organizationId,
      selector,
      this.identity.nodeId,
    );
    if (member === undefined || member.status !== "ACTIVE" || member.isSelf) {
      throw new Error(
        `member ${selector} is not active in organization ${organization.name}`,
      );
    }
    return {
      nodeId: member.nodeId,
      displayName: member.displayName,
      publicKey: member.publicKey,
      enabled: true,
      policy: member.policy,
      transport: "RELAY",
      organizationId: organization.organizationId,
      membershipId: member.membershipId,
      senderMembershipId: organization.selfMembershipId,
    };
  }

  createTeamPlan(
    candidate: CreateTeamPlanInput,
    initiatingSessionId?: string,
  ): Promise<TeamPlan> {
    const input = createTeamPlanInputSchema.parse(candidate);
    const organizationId =
      initiatingSessionId === undefined
        ? undefined
        : this.database.sessionOrganization(initiatingSessionId);
    const peers = input.items.map((item) => {
      const peer = this.resolveRecipient(item.to, organizationId);
      if (!peer.enabled)
        throw new Error(`recipient ${item.to} is unavailable or disabled`);
      if (!peer.policy.canDelegate) {
        throw new Error(`peer ${peer.displayName} does not allow delegation`);
      }
      return peer;
    });
    const plan = this.database.createTeamPlan(input, peers, organizationId);
    this.touchLocalState();
    return Promise.resolve(plan);
  }

  updateTeamPlan(
    idCandidate: string,
    candidate: UpdateTeamPlanInput,
  ): Promise<TeamPlan> {
    const id = idSchema.parse(idCandidate);
    const input = updateTeamPlanInputSchema.parse(candidate);
    const existing = this.database.getTeamPlan(id);
    if (existing === undefined) throw new Error(`unknown team plan ${id}`);
    if (existing.status !== "DRAFT") {
      throw new TeamPlanEditConflictError(
        `team plan ${id} cannot be edited from ${existing.status}`,
      );
    }
    if (existing.revision !== input.revision) {
      throw new TeamPlanEditConflictError(
        `team plan ${id} changed from revision ${input.revision} to ${existing.revision}; reload before saving`,
      );
    }
    const peers = input.items.map((item) => {
      const peer = this.resolveRecipient(item.to, existing.organizationId);
      if (!peer.enabled) {
        throw new Error(`recipient ${item.to} is unavailable or disabled`);
      }
      if (!peer.policy.canDelegate) {
        throw new Error(`peer ${peer.displayName} does not allow delegation`);
      }
      return peer;
    });
    const updated = this.database.updateTeamPlanDraft(id, input, peers);
    this.touchLocalState();
    return Promise.resolve(updated);
  }

  getTeamPlan(id: string): Promise<TeamPlan | undefined> {
    return Promise.resolve(this.database.getTeamPlan(idSchema.parse(id)));
  }

  approveTeamPlan(idCandidate: string): Promise<TeamPlan> {
    const id = idSchema.parse(idCandidate);
    const active = this.#dispatchingPlans.get(id);
    if (active !== undefined) return active;
    const dispatch = this.dispatchTeamPlan(id).finally(() => {
      this.#dispatchingPlans.delete(id);
    });
    this.#dispatchingPlans.set(id, dispatch);
    return dispatch;
  }

  private async dispatchTeamPlan(id: string): Promise<TeamPlan> {
    const existing = this.database.getTeamPlan(id);
    if (existing?.status === "DISPATCHED") return existing;
    const plan = this.database.beginTeamPlanDispatch(id);
    for (const item of plan.items) {
      if (item.status === "DISPATCHED" || item.status === "CANCELED") continue;
      try {
        await this.delegateWithId(
          {
            to: item.peerNodeId,
            objective: item.objective,
            ...(item.context === undefined ? {} : { context: item.context }),
            acceptanceCriteria: item.acceptanceCriteria,
            attachmentRefs: item.attachmentRefs,
          },
          item.id,
          undefined,
          plan.organizationId,
        );
        this.database.markTeamPlanItemDispatched(id, item.id, item.id);
      } catch (error) {
        this.database.markTeamPlanItemFailed(id, item.id, error);
        this.database.diagnostic(
          "TEAM_PLAN_ITEM_FAILED",
          item.id,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return this.database.finishTeamPlanDispatch(id);
  }

  cancelTeamPlan(idCandidate: string): Promise<TeamPlan> {
    const id = idSchema.parse(idCandidate);
    if (this.#dispatchingPlans.has(id)) {
      throw new Error(`team plan ${id} is currently dispatching`);
    }
    return Promise.resolve(this.database.cancelTeamPlan(id));
  }

  getDelegation(id: string): Promise<DelegationView | undefined> {
    return Promise.resolve(this.database.getDelegation(id));
  }

  listInbox(): Promise<DelegationView[]> {
    return Promise.resolve(this.database.listDelegations());
  }

  async acceptDelegation(id: string): Promise<void> {
    const delegation = this.database.getDelegation(id);
    if (delegation === undefined || delegation.direction !== "INCOMING") {
      throw new Error(`unknown incoming delegation ${id}`);
    }
    if (delegation.status !== "WAITING_HUMAN") {
      throw new Error(`delegation ${id} is not waiting for local acceptance`);
    }
    if (delegation.todos.some((todo) => todo.status === "OPEN")) {
      throw new Error(
        "delegation has open HumanTodo items; submit human input instead",
      );
    }
    this.ensureExecutionAllowed(delegation);
    await this.startExecution(delegation);
  }

  async submitHumanInput(id: string, input: HumanInput): Promise<void> {
    const parsed = humanInputSchema.parse(input);
    const delegation = this.database.getDelegation(id);
    if (
      delegation === undefined ||
      delegation.direction !== "INCOMING" ||
      delegation.status !== "WAITING_HUMAN"
    ) {
      throw new Error(`delegation ${id} is not waiting for human input`);
    }
    const openTodos = delegation.todos.filter((todo) => todo.status === "OPEN");
    if (openTodos.length === 0) {
      throw new Error("delegation has no open HumanTodo items");
    }
    await this.attachments.verifyAll([
      ...delegation.todos.flatMap((todo) => todo.attachmentRefs),
      ...parsed.attachmentRefs,
    ]);
    const completesAll = openTodos.every((todo) =>
      parsed.todoIds.includes(todo.id),
    );
    if (completesAll) this.ensureExecutionAllowed(delegation);
    const resolution = this.database.resolveTodosAndMaybeResume(id, parsed);
    if (!resolution.resumed) return;
    this.enqueueUpdate(resolution.delegation);
    await this.flushOutbox();
    const completedTodos = resolution.delegation.todos
      .filter((todo) => todo.status === "DONE")
      .map((todo) => ({
        todoId: todo.id,
        title: todo.title,
        response: todo.humanResponse ?? null,
        attachments: todo.attachmentRefs.map((ref) => ({
          ...ref,
          verifiedLocalPath: this.attachments.pathFor(ref),
        })),
      }));
    await this.startExecution(
      resolution.delegation,
      JSON.stringify({ completedTodos }, null, 2),
      true,
    );
  }

  async rejectDelegation(id: string, reason: string): Promise<void> {
    const delegation = this.database.getDelegation(id);
    if (
      delegation === undefined ||
      delegation.direction !== "INCOMING" ||
      delegation.status !== "WAITING_HUMAN"
    ) {
      throw new Error(`delegation ${id} cannot be rejected`);
    }
    this.database.dismissTodos(id);
    const terminal = this.database.transition(id, "REJECTED", {
      summary: shareableText(reason || "Rejected by the receiving owner."),
      errorCode: "REJECTED_BY_OWNER",
      completedAt: new Date().toISOString(),
    });
    this.enqueueResult(terminal);
    await this.flushOutbox();
    await this.executor.release(id);
  }

  async retryDelivery(id: string): Promise<void> {
    const delegation = this.database.getDelegation(id);
    if (delegation === undefined || delegation.direction !== "OUTGOING") {
      throw new Error(`unknown outgoing delegation ${id}`);
    }
    this.database.retryEnvelopeNow(delegation.requestEnvelopeId);
    await this.flushOutbox();
  }

  async requestCancel(id: string, reason?: string): Promise<void> {
    const delegation = this.database.getDelegation(id);
    if (delegation === undefined) throw new Error(`unknown delegation ${id}`);
    if (isTerminalStatus(delegation.status)) return;
    if (
      delegation.direction === "OUTGOING" &&
      ["QUEUED_LOCAL", "WAITING_FOR_PEER"].includes(delegation.deliveryStatus)
    ) {
      this.database.discardPendingEnvelope(delegation.requestEnvelopeId);
      this.database.transition(id, "CANCELED", {
        summary: "Canceled before the receiving Node acknowledged delivery.",
        completedAt: new Date().toISOString(),
      });
      return;
    }
    if (delegation.direction === "INCOMING") {
      await this.cancelIncoming(id, reason);
      return;
    }
    const envelope = this.createEnvelope(
      "DELEGATION_CANCEL_REQUEST",
      delegation.peerNodeId,
      delegation.id,
      {
        delegationId: delegation.id,
        ...(reason === undefined ? {} : { reason }),
        requestedAt: new Date().toISOString(),
      },
      this.routingForDelegation(delegation),
    );
    this.database.enqueue(envelope, envelopeDigest(envelope));
    await this.flushOutbox();
  }

  private async cancelIncoming(id: string, reason?: string): Promise<void> {
    const delegation = this.database.getDelegation(id);
    if (delegation === undefined || isTerminalStatus(delegation.status)) return;
    await this.executor.cancel(id);
    const terminal = this.database.transition(id, "CANCELED", {
      summary: shareableText(
        reason ??
          "Cancellation was confirmed locally. External side effects, if any, were not rolled back.",
      ),
      errorCode: "CANCELED_BY_SENDER",
      completedAt: new Date().toISOString(),
    });
    this.enqueueResult(terminal);
    await this.flushOutbox();
    await this.executor.release(id);
  }

  private policyFor(delegation: DelegationRecord): PeerPolicy {
    if (
      delegation.organizationId !== undefined &&
      delegation.senderMembershipId !== undefined
    ) {
      const member = this.database.findOrganizationMember(
        delegation.organizationId,
        delegation.senderMembershipId,
        this.identity.nodeId,
      );
      if (
        member === undefined ||
        member.status !== "ACTIVE" ||
        member.nodeId !== delegation.peerNodeId
      ) {
        throw new ExecutionFailure(
          "PEER_DISABLED",
          "sender organization membership is no longer active",
        );
      }
      return member.policy;
    }
    const peer = this.database.findPeer(delegation.peerNodeId);
    if (peer === undefined || !peer.enabled) {
      throw new ExecutionFailure(
        "PEER_DISABLED",
        "sender peer is no longer enabled",
      );
    }
    return peer.policy;
  }

  private ensureExecutionAllowed(
    delegation: DelegationRecord,
    alreadyRunning = false,
  ): PeerPolicy {
    const policy = this.policyFor(delegation);
    const running = this.database.countRunningFromPeer(
      delegation.peerNodeId,
      delegation.organizationId,
    );
    const competing = alreadyRunning ? Math.max(0, running - 1) : running;
    if (competing >= policy.maxConcurrent) {
      throw new ExecutionFailure(
        "CONCURRENCY_LIMIT",
        "peer concurrency limit is currently exhausted",
      );
    }
    return policy;
  }

  private async startExecution(
    candidate: DelegationRecord,
    humanResponse?: string,
    alreadyRunning = false,
    automationRule?: AutomationRuleInput,
  ): Promise<void> {
    if (this.#starting.has(candidate.id)) return;
    this.#starting.add(candidate.id);
    let running: DelegationRecord | undefined;
    try {
      const peerPolicy = this.ensureExecutionAllowed(candidate, alreadyRunning);
      const policy =
        automationRule === undefined
          ? peerPolicy
          : applyAutomationLimits(peerPolicy, automationRule);
      if (automationRule !== undefined) {
        await this.executor.validateAutomationRule(automationRule);
      }
      const verifiedAttachments =
        humanResponse === undefined
          ? await this.attachments.verifyAll(candidate.attachmentRefs)
          : [];
      const sessionId =
        candidate.sessionId ?? this.executor.sessionIdFor(candidate.id);
      running = alreadyRunning
        ? candidate
        : this.database.transition(candidate.id, "RUNNING", {
            sessionId,
            summary:
              humanResponse === undefined
                ? "Running on the receiving Personal Agent."
                : "Resumed after local human input.",
          });
      if (running.organizationId !== undefined) {
        this.database.setSessionOrganization(
          sessionId,
          running.organizationId,
          this.identity.nodeId,
        );
      }
      if (!alreadyRunning) {
        this.enqueueUpdate(running);
        await this.flushOutbox();
      }
      this.touchLocalState();
      const outcome =
        humanResponse === undefined
          ? await this.executor.execute(
              running,
              policy,
              verifiedAttachments,
              automationRule,
            )
          : await this.executor.resume(running, policy, humanResponse);
      await this.handleOutcome(running.id, outcome);
    } catch (error) {
      const current = this.database.getDelegation(candidate.id);
      if (current !== undefined && current.status === "RUNNING") {
        const code =
          error instanceof ExecutionFailure ? error.code : "EXECUTION_FAILED";
        const failed = this.database.transition(current.id, "FAILED", {
          summary: shareableText(
            error instanceof Error
              ? error.message
              : "Local agent execution failed",
          ),
          errorCode: code,
          completedAt: new Date().toISOString(),
        });
        this.enqueueResult(failed);
        await this.flushOutbox();
        await this.executor.release(current.id);
      } else if (current?.status === "TRIAGING") {
        const waiting = this.database.transition(current.id, "WAITING_HUMAN", {
          summary: `Automatic execution paused: ${shareableText(error instanceof Error ? error.message : "local policy requires review")}`,
        });
        this.enqueueUpdate(waiting);
        await this.flushOutbox();
      } else {
        throw error;
      }
    } finally {
      this.#starting.delete(candidate.id);
      this.touchLocalState();
    }
  }

  private async handleOutcome(
    delegationId: string,
    outcome: StructuredOutcome,
  ): Promise<void> {
    if (outcome.kind === "HANDOFF") {
      const waiting = this.database.handoff(
        delegationId,
        makeTodos(delegationId, outcome),
        shareableText(outcome.completedSummary),
      );
      this.enqueueUpdate(waiting);
      await this.flushOutbox();
      return;
    }
    if (outcome.kind === "UNSUPPORTED") {
      const failed = this.database.transition(delegationId, "FAILED", {
        summary: shareableText(outcome.reason),
        errorCode: "UNSUPPORTED",
        completedAt: new Date().toISOString(),
      });
      this.enqueueResult(failed);
      await this.flushOutbox();
      await this.executor.release(delegationId);
      return;
    }
    const completed = this.database.transition(delegationId, "COMPLETED", {
      summary: shareableText(outcome.summary),
      outputs: shareableOutputs(outcome.outputs),
      completedAt: new Date().toISOString(),
    });
    this.enqueueResult(completed);
    await this.flushOutbox();
    await this.executor.release(delegationId);
  }

  private enqueueUpdate(delegation: DelegationRecord): void {
    const publicStatus =
      delegation.status === "WAITING_HUMAN"
        ? "WAITING_HUMAN"
        : delegation.status === "RUNNING"
          ? "RUNNING"
          : "QUEUED";
    const payload = delegationUpdateSchema.parse({
      delegationId: delegation.id,
      status: publicStatus,
      ...(delegation.summary === undefined
        ? {}
        : {
            shareableSummary:
              publicStatus === "WAITING_HUMAN"
                ? "Waiting for the receiving owner."
                : shareableText(delegation.summary),
          }),
      revision: delegation.revision,
      updatedAt: delegation.updatedAt,
    });
    const envelope = this.createEnvelope(
      "DELEGATION_UPDATE",
      delegation.peerNodeId,
      delegation.id,
      payload,
      this.routingForDelegation(delegation),
    );
    this.database.enqueue(envelope, envelopeDigest(envelope));
  }

  private enqueueResult(delegation: DelegationRecord): void {
    if (!isTerminalStatus(delegation.status)) {
      throw new Error("cannot publish a non-terminal result");
    }
    const payload = delegationResultSchema.parse({
      delegationId: delegation.id,
      status: delegation.status,
      summary: shareableText(delegation.summary ?? delegation.status),
      outputs: shareableOutputs(delegation.outputs),
      ...(delegation.errorCode === undefined
        ? {}
        : { errorCode: delegation.errorCode }),
      revision: delegation.revision,
      completedAt: delegation.completedAt ?? new Date().toISOString(),
    });
    const envelope = this.createEnvelope(
      "DELEGATION_RESULT",
      delegation.peerNodeId,
      delegation.id,
      payload,
      this.routingForDelegation(delegation),
    );
    this.database.enqueue(envelope, envelopeDigest(envelope));
  }

  private validateIncoming(envelope: Envelope): ResolvedDelegationRecipient {
    if (envelopePayloadBytes(envelope) > MAX_ENVELOPE_BYTES) {
      throw new PermanentEnvelopeError(
        "incoming envelope exceeds the configured size boundary",
      );
    }
    try {
      assertEnvelopeSemantics(envelope);
    } catch (error) {
      throw new PermanentEnvelopeError(
        "incoming envelope semantics are invalid",
        {
          cause: error,
        },
      );
    }
    if (envelope.recipientNodeId !== this.identity.nodeId) {
      throw new PermanentEnvelopeError(
        "incoming envelope is addressed to a different Node",
      );
    }
    if (Date.parse(envelope.expiresAt) <= Date.now()) {
      throw new PermanentEnvelopeError("incoming envelope has expired");
    }
    let peer: ResolvedDelegationRecipient;
    if (envelope.protocolVersion === 2) {
      const organizationId = envelope.organizationId;
      const senderMembershipId = envelope.senderMembershipId;
      const recipientMembershipId = envelope.recipientMembershipId;
      if (
        organizationId === undefined ||
        senderMembershipId === undefined ||
        recipientMembershipId === undefined
      ) {
        throw new PermanentEnvelopeError(
          "incoming organization routing is incomplete",
        );
      }
      const organization = this.database.findOrganization(
        organizationId,
        this.identity.nodeId,
      );
      const sender = this.database.findOrganizationMember(
        organizationId,
        senderMembershipId,
        this.identity.nodeId,
      );
      const recipient = this.database.findOrganizationMember(
        organizationId,
        recipientMembershipId,
        this.identity.nodeId,
      );
      if (
        organization?.membershipStatus !== "ACTIVE" ||
        sender === undefined ||
        sender.status !== "ACTIVE" ||
        sender.nodeId !== envelope.senderNodeId ||
        recipient === undefined ||
        recipient.status !== "ACTIVE" ||
        !recipient.isSelf
      ) {
        throw new PermanentEnvelopeError(
          "incoming organization membership is not active",
        );
      }
      peer = {
        nodeId: sender.nodeId,
        displayName: sender.displayName,
        publicKey: sender.publicKey,
        enabled: true,
        transport: "RELAY",
        policy: sender.policy,
        organizationId,
        membershipId: sender.membershipId,
        senderMembershipId: recipient.membershipId,
      };
    } else {
      const directPeer = this.database.findPeer(envelope.senderNodeId);
      if (directPeer === undefined || !directPeer.enabled) {
        throw new PermanentEnvelopeError(
          "incoming envelope sender is not an enabled local peer",
        );
      }
      peer = directPeer;
    }
    if (
      !verifySignature(
        unsignedEnvelope(envelope),
        envelope.signature,
        peer.publicKey,
      )
    ) {
      throw new PermanentEnvelopeError(
        "incoming envelope signature is invalid",
      );
    }
    return peer;
  }

  private incomingEnvelopeMatchesDelegation(
    envelope: Envelope,
    delegation: DelegationRecord,
  ): boolean {
    if (delegation.organizationId === undefined) {
      return envelope.organizationId === undefined;
    }
    if (
      envelope.organizationId !== delegation.organizationId ||
      delegation.senderMembershipId === undefined ||
      delegation.recipientMembershipId === undefined
    ) {
      return false;
    }
    return delegation.direction === "OUTGOING"
      ? envelope.senderMembershipId === delegation.recipientMembershipId &&
          envelope.recipientMembershipId === delegation.senderMembershipId
      : envelope.senderMembershipId === delegation.senderMembershipId &&
          envelope.recipientMembershipId === delegation.recipientMembershipId;
  }

  private async processEnvelope(envelope: Envelope): Promise<void> {
    const parsed = envelopeSchema.parse(envelope);
    const peer = this.validateIncoming(parsed);
    const digest = envelopeDigest(parsed);
    if (parsed.kind === "DELEGATION_REQUEST") {
      const received = this.database.receiveRequest(parsed, digest);
      if (received === "DUPLICATE") return;
      let delegation = this.database.getDelegation(parsed.payload.delegationId);
      if (delegation === undefined)
        throw new Error("received delegation was not persisted");
      delegation = this.database.transition(delegation.id, "TRIAGING");
      if (
        !peer.policy.canDelegate ||
        parsed.payload.delegationDepth > peer.policy.maxDelegationDepth
      ) {
        const rejected = this.database.transition(delegation.id, "REJECTED", {
          summary: "The receiving Node policy rejected this delegation.",
          errorCode: "POLICY_REJECTED",
          completedAt: new Date().toISOString(),
        });
        this.enqueueResult(rejected);
        return;
      }
      const automationRule =
        peer.policy.autoExecute === "SAFE"
          ? this.matchingAutomationRule(delegation)
          : undefined;
      if (
        peer.policy.autoExecute === "NEVER" ||
        (peer.policy.autoExecute === "SAFE" && automationRule === undefined)
      ) {
        const waiting = this.database.transition(
          delegation.id,
          "WAITING_HUMAN",
          {
            summary: "Awaiting local acceptance.",
          },
        );
        this.enqueueUpdate(waiting);
      } else {
        void this.startExecution(
          delegation,
          undefined,
          false,
          automationRule,
        ).catch((error: unknown) => {
          this.database.diagnostic(
            "EXECUTION_START_FAILED",
            delegation.id,
            error instanceof Error ? error.message : String(error),
          );
        });
      }
      return;
    }
    if (parsed.kind === "MESSAGE") {
      if (!peer.policy.canMessage) {
        throw new PermanentEnvelopeError("peer policy rejects messages");
      }
      this.database.recordMessage(parsed, digest);
      return;
    }
    const receipt = this.database.recordReceipt(parsed, digest);
    if (receipt === "DUPLICATE") return;
    if (parsed.kind === "DELEGATION_UPDATE") {
      const local = this.database.getDelegation(parsed.payload.delegationId);
      if (
        local?.peerNodeId === peer.nodeId &&
        this.incomingEnvelopeMatchesDelegation(parsed, local)
      ) {
        this.database.applyRemoteUpdate(parsed.payload);
      }
      return;
    }
    if (parsed.kind === "DELEGATION_RESULT") {
      const local = this.database.getDelegation(parsed.payload.delegationId);
      if (
        local?.peerNodeId === peer.nodeId &&
        this.incomingEnvelopeMatchesDelegation(parsed, local)
      ) {
        this.database.applyRemoteResult(parsed.payload);
      }
      return;
    }
    if (parsed.kind === "DELEGATION_CANCEL_REQUEST") {
      const local = this.database.getDelegation(parsed.payload.delegationId);
      if (
        local?.peerNodeId === peer.nodeId &&
        local.direction === "INCOMING" &&
        this.incomingEnvelopeMatchesDelegation(parsed, local)
      ) {
        await this.cancelIncoming(local.id, parsed.payload.reason);
      }
      return;
    }
  }

  async receiveDirectEnvelope(candidate: unknown): Promise<{
    version: 1;
    envelopeId: string;
    senderNodeId: string;
    recipientNodeId: string;
    receivedAt: string;
    signature: string;
  }> {
    if (this.#closed) {
      throw new Error("Squad service is closed");
    }
    if (!this.#nodeSettings.directEnabled) {
      throw new Error("Direct transport is not enabled on this Node");
    }
    const envelope = envelopeSchema.parse(candidate);
    if (envelope.protocolVersion !== 1) {
      throw new Error(
        "Direct transport currently accepts only direct Peer envelopes",
      );
    }
    await this.processEnvelope(envelope);
    this.#directLastReceivedAt = new Date().toISOString();
    this.#directLastError = undefined;
    const unsigned = unsignedNodeReceiptSchema.parse({
      version: 1,
      envelopeId: envelope.envelopeId,
      senderNodeId: this.identity.nodeId,
      recipientNodeId: envelope.senderNodeId,
      receivedAt: new Date().toISOString(),
    });
    const receipt = { ...unsigned, signature: this.identity.sign(unsigned) };
    this.touchLocalState();
    void this.flushOutbox().catch((error: unknown) => {
      if (this.#closed) return;
      this.database.diagnostic(
        "DIRECT_RESPONSE_DELIVERY_FAILED",
        "delegationId" in envelope.payload
          ? envelope.payload.delegationId
          : undefined,
        error instanceof Error ? error.message : String(error),
      );
    });
    return receipt;
  }

  private transportFor(envelope: Envelope): EnvelopeTransport {
    if (envelope.organizationId !== undefined) {
      if (this.relayTransport === undefined) {
        throw new Error(
          "Relay transport is required for organization envelopes",
        );
      }
      return this.relayTransport;
    }
    const peer = this.database.findPeer(envelope.recipientNodeId);
    if (peer?.transport === "DIRECT") return this.directTransport;
    if (this.relayTransport === undefined) {
      throw new Error(
        `Relay transport is not configured for ${envelope.recipientNodeId}`,
      );
    }
    return this.relayTransport;
  }

  async flushOutbox(): Promise<void> {
    if (this.#reconfiguring) {
      this.#pumpRequested = true;
      return;
    }
    if (this.#flushing !== undefined) return this.#flushing;
    const flushing = this.flushOutboxNow().finally(() => {
      if (this.#flushing === flushing) this.#flushing = undefined;
    });
    this.#flushing = flushing;
    return flushing;
  }

  private async flushOutboxNow(): Promise<void> {
    let changed = false;
    for (const pending of this.database.pendingEnvelopes()) {
      if (Date.parse(pending.envelope.expiresAt) <= Date.now()) {
        this.database.expireEnvelope(pending.envelope.envelopeId);
        changed = true;
        continue;
      }
      const directPeer =
        pending.envelope.organizationId === undefined
          ? this.database.findPeer(pending.envelope.recipientNodeId)
          : undefined;
      const expectsDirect = directPeer?.transport === "DIRECT";
      try {
        const transport = this.transportFor(pending.envelope);
        const deliveryStatus = await transport.submit(pending.envelope);
        this.database.markEnvelopeDelivered(
          pending.envelope.envelopeId,
          deliveryStatus,
        );
        changed = true;
      } catch (error) {
        this.database.markEnvelopeAttemptFailed(
          pending.envelope.envelopeId,
          error,
          expectsDirect
            ? {
                deliveryStatus: "WAITING_FOR_PEER",
                retryAfterMs: this.config.direct.retryIntervalMs,
              }
            : { deliveryStatus: "QUEUED_LOCAL" },
        );
        if (error instanceof DirectTransportError) {
          this.database.diagnostic(
            error.code,
            "delegationId" in pending.envelope.payload
              ? pending.envelope.payload.delegationId
              : undefined,
            error.message,
          );
        }
        changed = true;
      }
    }
    if (changed) this.touchLocalState();
  }

  private async pollMailbox(): Promise<void> {
    const relayClient = this.relayClient;
    const relayUrl = this.#nodeSettings.relayUrl;
    if (relayClient === undefined || relayUrl === undefined) return;
    const after = this.database.mailboxCursor(relayUrl);
    let mailbox: Awaited<ReturnType<RelayClient["mailbox"]>>;
    try {
      mailbox = await relayClient.mailbox(after);
      this.markRelaySuccess();
    } catch (error) {
      this.markRelayFailure(error);
      throw error;
    }
    for (const item of mailbox.items) {
      let permanentFailure = false;
      try {
        await this.processEnvelope(item.envelope);
      } catch (error) {
        this.database.diagnostic(
          error instanceof PermanentEnvelopeError || error instanceof ZodError
            ? "ENVELOPE_REJECTED"
            : "ENVELOPE_COMMIT_FAILED",
          "delegationId" in item.envelope.payload
            ? item.envelope.payload.delegationId
            : undefined,
          error instanceof Error ? error.message : String(error),
        );
        permanentFailure =
          error instanceof PermanentEnvelopeError || error instanceof ZodError;
        if (!permanentFailure) break;
      }
      await relayClient.acknowledge(item.envelope.envelopeId);
      this.database.advanceMailboxCursor(relayUrl, item.cursor);
    }
    if (mailbox.items.length > 0) this.touchLocalState();
  }

  private startRelayEvents(): void {
    const relayClient = this.relayClient;
    if (relayClient === undefined || this.#relayEventsTask !== undefined)
      return;
    const controller = new AbortController();
    this.#relayEventStream = "POLLING";
    this.#relayEventsAbort = controller;
    this.#relayEventsTask = this.watchRelayEvents(
      relayClient,
      controller.signal,
    );
  }

  private async stopRelayEvents(): Promise<void> {
    const controller = this.#relayEventsAbort;
    const task = this.#relayEventsTask;
    this.#relayEventsAbort = undefined;
    this.#relayEventsTask = undefined;
    controller?.abort();
    await task?.catch(() => undefined);
    this.#relayEventStream = this.relayClient ? "POLLING" : "DISABLED";
  }

  private async watchRelayEvents(
    relayClient: RelayClient,
    signal: AbortSignal,
  ): Promise<void> {
    let retryAfterMs = 1_000;
    let reportedFailure = false;
    while (!signal.aborted && !this.#closed) {
      try {
        await relayClient.watchMailbox(signal, () => {
          if (this.#relayEventStream !== "CONNECTED") {
            this.#relayEventStream = "CONNECTED";
            this.touchLocalState();
          }
          this.markRelaySuccess();
          void this.pump();
        });
        this.#relayEventStream = "POLLING";
        retryAfterMs = 1_000;
      } catch (error) {
        if (signal.aborted || this.#closed) return;
        if (error instanceof RelayClientError && error.status === 404) {
          this.#relayEventStream = "POLLING";
          return;
        }
        this.#relayEventStream = "POLLING";
        if (!reportedFailure) {
          reportedFailure = true;
          this.database.diagnostic(
            "RELAY_EVENT_STREAM_FAILED",
            undefined,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      await abortableDelay(retryAfterMs, signal);
      retryAfterMs = Math.min(retryAfterMs * 2, 30_000);
    }
  }

  async pump(): Promise<void> {
    if (this.#closed) return;
    if (this.#reconfiguring) {
      this.#pumpRequested = true;
      return;
    }
    if (this.#pumping) {
      this.#pumpRequested = true;
      return;
    }
    this.#pumping = true;
    try {
      while (!this.#closed && !this.#reconfiguring) {
        this.#pumpRequested = false;
        try {
          await this.syncOrganizations();
          await this.flushOutbox();
          await this.pollMailbox();
          await this.flushOutbox();
          if (await this.updates.refresh()) this.touchLocalState();
        } catch (error) {
          this.database.diagnostic(
            "TRANSPORT_PUMP_FAILED",
            undefined,
            error instanceof Error ? error.message : String(error),
          );
        }
        if (this.#reconfiguring || !this.#pumpRequested) break;
      }
    } finally {
      this.#pumping = false;
    }
  }

  localState(): SquadLocalState {
    return {
      setup: {
        required: this.#nodeSettings.setupRequired,
        ...(this.#nodeSettings.setupMode === undefined
          ? {}
          : { mode: this.#nodeSettings.setupMode }),
        source: this.#nodeSettings.setupSource,
      },
      identity: {
        nodeId: this.identity.nodeId,
        displayName: this.#nodeSettings.displayName,
        publicKey: this.identity.publicKey,
      },
      relay: {
        configured: this.relayClient !== undefined,
        serving: this.relayServer !== undefined,
        ...(this.#nodeSettings.relayUrl === undefined
          ? {}
          : { url: this.#nodeSettings.relayUrl }),
      },
      direct: {
        serving: this.#nodeSettings.directEnabled,
        ...(this.#nodeSettings.directPublicUrl === undefined
          ? {}
          : { publicUrl: this.#nodeSettings.directPublicUrl }),
      },
      automation: {
        rules: this.automationRules(),
        legacyPrefixCount:
          this.config.execution.legacySafeObjectivePrefixes.length,
      },
      peers: this.database.listPeers(),
      organizations: this.database.listOrganizations(this.identity.nodeId),
      sessionOrganizations: this.database.sessionOrganizations(),
      revision: this.#stateRevision,
      plans: this.database.listTeamPlans(),
      delegations: this.database.listDelegations(),
      updates: this.updates.snapshot(),
      connection: this.connectionDiagnostics(),
    };
  }

  localAttentionSummary(): SquadAttentionSummary {
    const state = this.localState();
    return summarizeAttention({
      revision: state.revision,
      setupRequired: state.setup.required,
      delegations: state.delegations,
      plans: state.plans,
      organizations: state.organizations,
      updateAvailable: state.updates.status.available === true,
    });
  }

  version(): string {
    return SQUAD_VERSION;
  }

  nodeId(): string {
    return this.identity.nodeId;
  }

  async setUpdateMode(mode: UpdateMode): Promise<UpdateSnapshot> {
    const snapshot = await this.updates.setMode(mode);
    this.touchLocalState();
    return snapshot;
  }

  async checkForUpdates(): Promise<UpdateSnapshot> {
    const checking = this.updates.checkNow();
    this.touchLocalState();
    const snapshot = await checking;
    this.touchLocalState();
    return snapshot;
  }

  async requestUpdateInstall(): Promise<UpdateSnapshot> {
    const snapshot = await this.updates.requestInstall();
    this.touchLocalState();
    return snapshot;
  }

  async nativeHostSelfTest(): Promise<{
    sessionId: string;
    liveRead: boolean;
    persistedRead: boolean;
    sameSessionResumed: boolean;
    toolsAvailable: boolean;
    preset: string;
  }> {
    const sessionId = SessionId(`squad-self-test-${randomUUID()}`);
    const preset = await this.ctx.agentPresets.resolve(
      this.config.execution.preset,
    );
    const setup = async (agentCtx: Context): Promise<void> => {
      await this.ctx.agentPresets.mount(agentCtx, preset.id);
    };
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: {
        cwd: this.config.execution.cwd,
        delegationDepth: 0,
        agentPreset: preset.id,
      },
      agentOptions: this.ctx.agentDefaultModel.currentSelection(),
      setup,
    });
    let disposed = false;
    try {
      const liveRead = this.ctx.agents.get(sessionId)?.id === sessionId;
      handle.agent.send(
        createUserMessage({
          content: [
            {
              type: "text",
              text: "DSH Squad native session persistence probe",
            },
          ],
          source: {
            kind: "plugin",
            plugin: "@dsh-squad/plugin",
            form: "relay",
          },
        }),
        "next-turn",
        false,
      );
      await handle.dispose();
      disposed = true;
      const persisted = await this.ctx.sessionPersistence.inspect(sessionId);
      const resumed = await this.ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: this.ctx.agentDefaultModel.currentSelection(),
        setup,
      });
      try {
        return {
          sessionId,
          liveRead,
          persistedRead:
            persisted.meta.id === sessionId && persisted.events.length > 0,
          sameSessionResumed: resumed.agent.id === sessionId,
          toolsAvailable:
            this.ctx.tools.get("delegate_to_agent") !== undefined &&
            this.ctx.tools.get("get_delegation_status") !== undefined &&
            this.ctx.tools.get("list_squad_peers") !== undefined &&
            this.ctx.tools.get("propose_team_plan") !== undefined &&
            this.ctx.tools.get("list_squad_organizations") !== undefined &&
            this.ctx.tools.get("select_squad_organization") !== undefined,
          preset: preset.id,
        };
      } finally {
        await resumed.dispose();
      }
    } finally {
      if (!disposed) await handle.dispose();
    }
  }
}
