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
  delegationResultSchema,
  delegationUpdateSchema,
  envelopePayloadBytes,
  envelopeSchema,
  humanInputSchema,
  nodeIdSchema,
  peerPolicySchema,
  type CreateDelegationInput,
  type DelegationResult,
  type Envelope,
  type HumanInput as HumanInputValue,
  type PeerPolicy,
  type ResultOutput,
  type StructuredOutcome,
  type UnsignedEnvelope,
} from "../shared/contracts.ts";
import { isTerminalStatus } from "../shared/state.ts";
import type { ResolvedSquadConfig } from "./config.ts";
import {
  SquadDatabase,
  type DelegationRecord,
  type PeerRecord,
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
import { RelayClient } from "./relay-client.ts";
import { RelayServer } from "./relay.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    squad: SquadService;
  }
}

export interface DelegationView extends DelegationRecord {}

export type HumanInput = HumanInputValue;

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

export class SquadService extends Service {
  readonly config: ResolvedSquadConfig;
  readonly database: SquadDatabase;
  readonly identity: NodeIdentity;
  readonly relayServer?: RelayServer;
  readonly relayClient?: RelayClient;
  readonly executor: NativeDelegationExecutor;
  readonly attachments: AttachmentVerifier;
  readonly #starting = new Set<string>();
  #timer?: ReturnType<typeof setInterval>;
  #pumping = false;
  #closed = false;

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
    if (config.relay.enabled) {
      this.relayServer = new RelayServer({
        databasePath: config.relay.databasePath,
        invites: config.relay.invites,
        maxMailboxItems: config.relay.maxMailboxItems,
        maxRequestsPerMinute: config.relay.maxRequestsPerMinute,
      });
    }
    if (config.relay.url !== undefined) {
      this.relayClient = new RelayClient(config.relay.url, this.identity);
    }
    this.executor = new NativeDelegationExecutor(ctx, config.execution);
    this.attachments = new AttachmentVerifier(
      join(config.dataDir, "attachments"),
    );
  }

  async start(): Promise<void> {
    if (
      this.relayClient !== undefined &&
      this.config.relay.invitation !== undefined
    ) {
      await this.relayClient.enroll(
        this.config.relay.invitation,
        this.config.displayName,
      );
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
    await this.pump();
    this.#timer = setInterval(() => {
      void this.pump();
    }, this.config.pollIntervalMs);
    this.#timer.unref?.();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    await this.executor.dispose();
    this.relayServer?.close();
    this.database.close();
  }

  listPeers(): Promise<PeerRecord[]> {
    return Promise.resolve(this.database.listPeers());
  }

  addPeer(input: {
    nodeId: string;
    displayName: string;
    publicKey: string;
    enabled?: boolean;
    policy?: Partial<PeerPolicy>;
  }): Promise<PeerRecord> {
    nodeIdSchema.parse(input.nodeId);
    if (nodeIdFromPublicKey(input.publicKey) !== input.nodeId) {
      throw new Error("peer public key fingerprint does not match nodeId");
    }
    this.database.upsertPeer({
      nodeId: input.nodeId,
      displayName: input.displayName,
      publicKey: input.publicKey,
      enabled: input.enabled ?? true,
      policy: peerPolicySchema.parse(input.policy ?? {}),
    });
    const peer = this.database.findPeer(input.nodeId);
    if (peer === undefined) throw new Error("peer was not persisted");
    return Promise.resolve(peer);
  }

  private createEnvelope(
    kind: Envelope["kind"],
    recipientNodeId: string,
    correlationId: string,
    payload: unknown,
  ): Envelope {
    const createdAt = new Date();
    const unsigned = {
      protocolVersion: 1,
      envelopeId: randomUUID(),
      kind,
      senderNodeId: this.identity.nodeId,
      recipientNodeId,
      correlationId,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + this.config.envelopeTtlMinutes * 60_000,
      ).toISOString(),
      payload,
    } as UnsignedEnvelope;
    return envelopeSchema.parse(this.identity.signEnvelope(unsigned));
  }

  async delegate(
    candidate: CreateDelegationInput,
    initiatingSessionId?: string,
  ): Promise<DelegationView> {
    const input = createDelegationInputSchema.parse(candidate);
    const peer = this.database.findPeer(input.to);
    if (peer === undefined || !peer.enabled) {
      throw new Error(`peer ${input.to} is not paired or is disabled`);
    }
    if (!peer.policy.canDelegate) {
      throw new Error(`peer ${peer.displayName} does not allow delegation`);
    }
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
    const depth = (parent?.delegationDepth ?? -1) + 1;
    if (depth > peer.policy.maxDelegationDepth) {
      throw new Error(
        `delegation depth ${depth} exceeds peer policy limit ${peer.policy.maxDelegationDepth}`,
      );
    }
    const delegationId = randomUUID();
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
    );
    this.database.createOutgoing(request, envelope, envelopeDigest(envelope));
    await this.flushOutbox();
    const record = this.database.getDelegation(delegationId);
    if (record === undefined) throw new Error("delegation was not persisted");
    return record;
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
      delegation.deliveryStatus === "QUEUED_LOCAL"
    ) {
      this.database.discardPendingEnvelope(delegation.requestEnvelopeId);
      this.database.transition(id, "CANCELED", {
        summary: "Canceled before Relay delivery.",
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
    const running = this.database.countRunningFromPeer(delegation.peerNodeId);
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
  ): Promise<void> {
    if (this.#starting.has(candidate.id)) return;
    this.#starting.add(candidate.id);
    let running: DelegationRecord | undefined;
    try {
      const policy = this.ensureExecutionAllowed(candidate, alreadyRunning);
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
      if (!alreadyRunning) {
        this.enqueueUpdate(running);
        await this.flushOutbox();
      }
      const outcome =
        humanResponse === undefined
          ? await this.executor.execute(running, policy, verifiedAttachments)
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
    );
    this.database.enqueue(envelope, envelopeDigest(envelope));
  }

  private validateIncoming(envelope: Envelope): PeerRecord {
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
    const peer = this.database.findPeer(envelope.senderNodeId);
    if (peer === undefined || !peer.enabled) {
      throw new PermanentEnvelopeError(
        "incoming envelope sender is not an enabled local peer",
      );
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
      const safe = this.config.execution.safeObjectivePrefixes.some((prefix) =>
        parsed.payload.objective.toLowerCase().startsWith(prefix),
      );
      if (
        peer.policy.autoExecute === "NEVER" ||
        (peer.policy.autoExecute === "SAFE" && !safe)
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
        void this.startExecution(delegation).catch((error: unknown) => {
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
      if (local?.peerNodeId === peer.nodeId) {
        this.database.applyRemoteUpdate(parsed.payload);
      }
      return;
    }
    if (parsed.kind === "DELEGATION_RESULT") {
      const local = this.database.getDelegation(parsed.payload.delegationId);
      if (local?.peerNodeId === peer.nodeId) {
        this.database.applyRemoteResult(parsed.payload);
      }
      return;
    }
    if (parsed.kind === "DELEGATION_CANCEL_REQUEST") {
      const local = this.database.getDelegation(parsed.payload.delegationId);
      if (local?.peerNodeId === peer.nodeId && local.direction === "INCOMING") {
        await this.cancelIncoming(local.id, parsed.payload.reason);
      }
      return;
    }
  }

  async flushOutbox(): Promise<void> {
    if (this.relayClient === undefined) return;
    for (const pending of this.database.pendingEnvelopes()) {
      try {
        await this.relayClient.submit(pending.envelope);
        this.database.markEnvelopeDelivered(pending.envelope.envelopeId);
      } catch (error) {
        this.database.markEnvelopeAttemptFailed(
          pending.envelope.envelopeId,
          error,
        );
        break;
      }
    }
  }

  private async pollMailbox(): Promise<void> {
    if (this.relayClient === undefined || this.config.relay.url === undefined)
      return;
    const after = this.database.mailboxCursor(this.config.relay.url);
    const mailbox = await this.relayClient.mailbox(after);
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
      await this.relayClient.acknowledge(item.envelope.envelopeId);
      this.database.advanceMailboxCursor(this.config.relay.url, item.cursor);
    }
  }

  async pump(): Promise<void> {
    if (this.#pumping || this.#closed) return;
    this.#pumping = true;
    try {
      await this.flushOutbox();
      await this.pollMailbox();
      await this.flushOutbox();
    } catch (error) {
      this.database.diagnostic(
        "RELAY_PUMP_FAILED",
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.#pumping = false;
    }
  }

  localState(): {
    identity: { nodeId: string; displayName: string; publicKey: string };
    relay: { configured: boolean; serving: boolean };
    peers: PeerRecord[];
    delegations: DelegationRecord[];
  } {
    return {
      identity: {
        nodeId: this.identity.nodeId,
        displayName: this.config.displayName,
        publicKey: this.identity.publicKey,
      },
      relay: {
        configured: this.relayClient !== undefined,
        serving: this.relayServer !== undefined,
      },
      peers: this.database.listPeers(),
      delegations: this.database.listDelegations(),
    };
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
            this.ctx.tools.get("get_delegation_status") !== undefined,
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
