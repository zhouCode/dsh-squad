import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  attachmentRefSchema,
  createTeamPlanInputSchema,
  delegationRequestSchema,
  envelopeSchema,
  humanTodoSchema,
  idSchema,
  peerPolicySchema,
  peerTransportSchema,
  resultOutputSchema,
  type AttachmentRef,
  type CreateTeamPlanInput,
  type DelegationRequest,
  type DelegationResult,
  type DelegationUpdate,
  type Envelope,
  type HumanTodo,
  type HumanInput,
  type PeerPolicy,
  type PeerTransport,
  type ResultOutput,
  type TeamPlan,
  type TeamPlanItem,
  type TeamPlanItemStatus,
  type TeamPlanStatus,
} from "../shared/contracts.ts";
import {
  automationRuleInputSchema,
  automationRuleSchema,
  type AutomationRule,
  type AutomationRuleInput,
} from "../shared/automation.ts";
import {
  defaultOrganizationPeerPolicy,
  organizationDirectoryBundleSchema,
  organizationDocumentSchema,
  organizationJoinRequestSchema,
  organizationMembershipCertificateSchema,
  type OrganizationDirectoryBundle,
  type OrganizationDocument,
  type OrganizationJoinRequest,
  type OrganizationMemberView,
  type OrganizationMembershipCertificate,
  type OrganizationRole,
  type OrganizationView,
} from "../shared/organizations.ts";
import {
  assertTransition,
  isTerminalStatus,
  type DelegationStatus,
} from "../shared/state.ts";
import type { NodeSetupMode } from "./config.ts";
import { verifyOrganizationDirectory } from "./organization.ts";

export type DelegationDirection = "INCOMING" | "OUTGOING";
export type DeliveryStatus =
  | "QUEUED_LOCAL"
  | "WAITING_FOR_PEER"
  | "STORED_BY_RELAY"
  | "RECEIVED_BY_NODE"
  | "DELIVERY_EXPIRED"
  | "RECEIVED_LOCAL";

export interface PeerRecord {
  nodeId: string;
  displayName: string;
  publicKey: string;
  enabled: boolean;
  transport: PeerTransport;
  directUrl?: string;
  policy: PeerPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface NodeSetupRecord {
  mode: NodeSetupMode;
  displayName: string;
  relayUrl?: string;
  directEnabled: boolean;
  directPublicUrl?: string;
  completedAt: string;
  updatedAt: string;
}

export interface DelegationRecord {
  id: string;
  direction: DelegationDirection;
  peerNodeId: string;
  organizationId?: string;
  senderMembershipId?: string;
  recipientMembershipId?: string;
  parentDelegationId?: string;
  objective: string;
  context?: string;
  acceptanceCriteria: string[];
  attachmentRefs: AttachmentRef[];
  delegationDepth: number;
  status: DelegationStatus;
  revision: number;
  deliveryStatus: DeliveryStatus;
  deliveryAttempts: number;
  lastDeliveryError?: string;
  nextDeliveryAttemptAt?: string;
  requestEnvelopeId: string;
  sessionId?: string;
  summary?: string;
  outputs: ResultOutput[];
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  todos: HumanTodo[];
}

export interface PendingEnvelope {
  envelope: Envelope;
  attempts: number;
  lastError?: string;
}

export interface OutboxDiagnostics {
  pending: number;
  retrying: number;
  nextAttemptAt?: string;
  lastError?: string;
}

export interface OrganizationDirectoryRecord {
  document: OrganizationDocument;
  revision: number;
  events: OrganizationMembershipCertificate[];
  members: Map<string, OrganizationMembershipCertificate>;
  selfStatus: "ACTIVE" | "PENDING" | "DISABLED";
  pendingJoinRequests: OrganizationJoinRequest[];
}

export interface ResolvedDelegationRecipient {
  nodeId: string;
  displayName: string;
  publicKey: string;
  enabled: boolean;
  transport: PeerTransport;
  directUrl?: string;
  policy: PeerPolicy;
  organizationId?: string;
  membershipId?: string;
  senderMembershipId?: string;
}

type SqlRow = Record<string, unknown>;

function asBoolean(value: unknown): boolean {
  return value === 1 || value === true;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseJson<T>(value: unknown, parse: (input: unknown) => T): T {
  if (typeof value !== "string") throw new Error("invalid SQLite JSON column");
  return parse(JSON.parse(value) as unknown);
}

function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(
      /(token|secret|credential|private[-_ ]?key)=[^\s,;]+/giu,
      "$1=[REDACTED]",
    )
    .slice(0, 2_000);
}

export class SquadDatabase {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#db.exec(
      "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;",
    );
    this.migrate();
  }

  private migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO schema_meta(singleton, version) VALUES (1, 1);

      CREATE TABLE IF NOT EXISTS node_identity (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        node_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS node_settings (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        mode TEXT NOT NULL CHECK (mode IN ('RELAY', 'DIRECT')),
        display_name TEXT NOT NULL,
        relay_url TEXT,
        direct_enabled INTEGER NOT NULL CHECK (direct_enabled IN (0, 1)),
        direct_public_url TEXT,
        completed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        objective_pattern TEXT NOT NULL,
        allowed_tools_json TEXT NOT NULL,
        preset TEXT,
        allow_attachments INTEGER NOT NULL CHECK (allow_attachments IN (0, 1)),
        max_runtime_minutes INTEGER NOT NULL,
        max_tokens INTEGER,
        priority INTEGER NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS automation_rules_priority_idx
        ON automation_rules(enabled, priority, created_at, id);

      CREATE TABLE IF NOT EXISTS peer_policies (
        node_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        directory_only INTEGER NOT NULL DEFAULT 0 CHECK (directory_only IN (0, 1)),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        transport TEXT NOT NULL DEFAULT 'RELAY' CHECK (transport IN ('RELAY', 'DIRECT')),
        direct_url TEXT,
        can_message INTEGER NOT NULL CHECK (can_message IN (0, 1)),
        can_delegate INTEGER NOT NULL CHECK (can_delegate IN (0, 1)),
        auto_execute TEXT NOT NULL CHECK (auto_execute IN ('NEVER', 'SAFE', 'TRUSTED')),
        max_concurrent INTEGER NOT NULL,
        max_delegation_depth INTEGER NOT NULL,
        max_runtime_minutes INTEGER NOT NULL,
        max_tokens INTEGER,
        removed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS local_delegations (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL CHECK (direction IN ('INCOMING', 'OUTGOING')),
        peer_node_id TEXT NOT NULL,
        parent_delegation_id TEXT,
        objective TEXT NOT NULL,
        context TEXT,
        acceptance_criteria_json TEXT NOT NULL,
        attachment_refs_json TEXT NOT NULL,
        delegation_depth INTEGER NOT NULL,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        delivery_status TEXT NOT NULL,
        request_envelope_id TEXT NOT NULL UNIQUE,
        session_id TEXT UNIQUE,
        summary TEXT,
        outputs_json TEXT NOT NULL DEFAULT '[]',
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY(peer_node_id) REFERENCES peer_policies(node_id)
      );
      CREATE INDEX IF NOT EXISTS local_delegations_status_idx
        ON local_delegations(direction, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS envelope_receipts (
        envelope_id TEXT PRIMARY KEY,
        digest TEXT NOT NULL,
        delegation_id TEXT,
        kind TEXT NOT NULL,
        received_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS human_todos (
        id TEXT PRIMARY KEY,
        delegation_id TEXT NOT NULL,
        title TEXT NOT NULL,
        instructions TEXT,
        blocking_reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('OPEN', 'DONE', 'DISMISSED')),
        human_response TEXT,
        attachment_refs_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        FOREIGN KEY(delegation_id) REFERENCES local_delegations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS mailbox_cursors (
        relay_url TEXT PRIMARY KEY,
        cursor INTEGER NOT NULL CHECK (cursor >= 0),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS local_outbox (
        envelope_id TEXT PRIMARY KEY,
        envelope_json TEXT NOT NULL,
        digest TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );

      CREATE TABLE IF NOT EXISTS local_messages (
        message_id TEXT PRIMARY KEY,
        envelope_id TEXT NOT NULL UNIQUE,
        sender_node_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS diagnostics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        delegation_id TEXT,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS team_plans (
        id TEXT PRIMARY KEY,
        organization_id TEXT,
        title TEXT NOT NULL,
        source_summary TEXT,
        status TEXT NOT NULL CHECK (status IN ('DRAFT', 'DISPATCHING', 'DISPATCHED', 'PARTIAL', 'CANCELED')),
        revision INTEGER NOT NULL,
        approved_at TEXT,
        canceled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS team_plans_status_idx
        ON team_plans(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS team_plan_items (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        peer_node_id TEXT NOT NULL,
        peer_display_name TEXT NOT NULL,
        membership_id TEXT,
        objective TEXT NOT NULL,
        context TEXT,
        acceptance_criteria_json TEXT NOT NULL,
        attachment_refs_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('DRAFT', 'DISPATCHED', 'FAILED', 'CANCELED')),
        delegation_id TEXT UNIQUE,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(plan_id, position),
        FOREIGN KEY(plan_id) REFERENCES team_plans(id) ON DELETE CASCADE,
        FOREIGN KEY(peer_node_id) REFERENCES peer_policies(node_id)
      );
      CREATE INDEX IF NOT EXISTS team_plan_items_plan_idx
        ON team_plan_items(plan_id, position);

      CREATE TABLE IF NOT EXISTS organizations (
        organization_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        document_json TEXT NOT NULL,
        self_status TEXT NOT NULL CHECK (self_status IN ('ACTIVE', 'PENDING', 'DISABLED')),
        highest_revision INTEGER NOT NULL CHECK (highest_revision >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS organization_events (
        organization_id TEXT NOT NULL,
        organization_revision INTEGER NOT NULL,
        membership_id TEXT NOT NULL,
        member_revision INTEGER NOT NULL,
        certificate_json TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        PRIMARY KEY(organization_id, organization_revision),
        UNIQUE(organization_id, membership_id, member_revision),
        FOREIGN KEY(organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS organization_members (
        organization_id TEXT NOT NULL,
        membership_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
        organization_revision INTEGER NOT NULL,
        member_revision INTEGER NOT NULL,
        issued_at TEXT NOT NULL,
        PRIMARY KEY(organization_id, membership_id),
        FOREIGN KEY(organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS organization_members_node_idx
        ON organization_members(organization_id, node_id);

      CREATE TABLE IF NOT EXISTS organization_member_policies (
        organization_id TEXT NOT NULL,
        membership_id TEXT NOT NULL,
        can_message INTEGER NOT NULL CHECK (can_message IN (0, 1)),
        can_delegate INTEGER NOT NULL CHECK (can_delegate IN (0, 1)),
        auto_execute TEXT NOT NULL CHECK (auto_execute IN ('NEVER', 'SAFE', 'TRUSTED')),
        max_concurrent INTEGER NOT NULL,
        max_delegation_depth INTEGER NOT NULL,
        max_runtime_minutes INTEGER NOT NULL,
        max_tokens INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(organization_id, membership_id),
        FOREIGN KEY(organization_id, membership_id)
          REFERENCES organization_members(organization_id, membership_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS organization_join_requests (
        organization_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        membership_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        PRIMARY KEY(organization_id, request_id),
        FOREIGN KEY(organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS session_organizations (
        session_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
      );
    `);
    const version = this.#db
      .prepare("SELECT version FROM schema_meta WHERE singleton = 1")
      .get() as SqlRow | undefined;
    let currentVersion = Number(version?.version);
    if (currentVersion === 1) {
      const todoColumns = this.#db
        .prepare("PRAGMA table_info(human_todos)")
        .all() as SqlRow[];
      if (
        !todoColumns.some((column) => column.name === "attachment_refs_json")
      ) {
        this.#db.exec(
          "ALTER TABLE human_todos ADD COLUMN attachment_refs_json TEXT NOT NULL DEFAULT '[]'",
        );
      }
      const outboxColumns = this.#db
        .prepare("PRAGMA table_info(local_outbox)")
        .all() as SqlRow[];
      if (!outboxColumns.some((column) => column.name === "next_attempt_at")) {
        this.#db.exec(
          "ALTER TABLE local_outbox ADD COLUMN next_attempt_at TEXT",
        );
        this.#db.exec(
          "UPDATE local_outbox SET next_attempt_at = created_at WHERE next_attempt_at IS NULL",
        );
      }
      this.#db.exec("UPDATE schema_meta SET version = 2 WHERE singleton = 1");
      currentVersion = 2;
    }
    if (currentVersion === 2) {
      this.#db.exec("UPDATE schema_meta SET version = 3 WHERE singleton = 1");
      currentVersion = 3;
    }
    if (currentVersion === 3) {
      const delegationColumns = this.#db
        .prepare("PRAGMA table_info(local_delegations)")
        .all() as SqlRow[];
      for (const [name, sql] of [
        ["organization_id", "TEXT"],
        ["sender_membership_id", "TEXT"],
        ["recipient_membership_id", "TEXT"],
      ] as const) {
        if (!delegationColumns.some((column) => column.name === name)) {
          this.#db.exec(
            `ALTER TABLE local_delegations ADD COLUMN ${name} ${sql}`,
          );
        }
      }
      const planColumns = this.#db
        .prepare("PRAGMA table_info(team_plans)")
        .all() as SqlRow[];
      if (!planColumns.some((column) => column.name === "organization_id")) {
        this.#db.exec("ALTER TABLE team_plans ADD COLUMN organization_id TEXT");
      }
      const itemColumns = this.#db
        .prepare("PRAGMA table_info(team_plan_items)")
        .all() as SqlRow[];
      if (!itemColumns.some((column) => column.name === "membership_id")) {
        this.#db.exec(
          "ALTER TABLE team_plan_items ADD COLUMN membership_id TEXT",
        );
      }
      this.#db.exec("UPDATE schema_meta SET version = 4 WHERE singleton = 1");
      currentVersion = 4;
    }
    if (currentVersion === 4) {
      const peerColumns = this.#db
        .prepare("PRAGMA table_info(peer_policies)")
        .all() as SqlRow[];
      if (!peerColumns.some((column) => column.name === "directory_only")) {
        this.#db.exec(
          "ALTER TABLE peer_policies ADD COLUMN directory_only INTEGER NOT NULL DEFAULT 0 CHECK (directory_only IN (0, 1))",
        );
      }
      this.#db.exec("UPDATE schema_meta SET version = 5 WHERE singleton = 1");
      currentVersion = 5;
    }
    if (currentVersion === 5) {
      const peerColumns = this.#db
        .prepare("PRAGMA table_info(peer_policies)")
        .all() as SqlRow[];
      if (!peerColumns.some((column) => column.name === "transport")) {
        this.#db.exec(
          "ALTER TABLE peer_policies ADD COLUMN transport TEXT NOT NULL DEFAULT 'RELAY' CHECK (transport IN ('RELAY', 'DIRECT'))",
        );
      }
      if (!peerColumns.some((column) => column.name === "direct_url")) {
        this.#db.exec("ALTER TABLE peer_policies ADD COLUMN direct_url TEXT");
      }
      this.#db.exec(
        "UPDATE local_delegations SET delivery_status = 'STORED_BY_RELAY' WHERE delivery_status = 'DELIVERED_TO_RELAY'",
      );
      this.#db.exec("UPDATE schema_meta SET version = 6 WHERE singleton = 1");
      currentVersion = 6;
    }
    if (currentVersion === 6) {
      this.#db.exec("UPDATE schema_meta SET version = 7 WHERE singleton = 1");
      currentVersion = 7;
    }
    if (currentVersion === 7) {
      const peerColumns = this.#db
        .prepare("PRAGMA table_info(peer_policies)")
        .all() as SqlRow[];
      if (!peerColumns.some((column) => column.name === "removed_at")) {
        this.#db.exec("ALTER TABLE peer_policies ADD COLUMN removed_at TEXT");
      }
      this.#db.exec("UPDATE schema_meta SET version = 8 WHERE singleton = 1");
      currentVersion = 8;
    }
    if (currentVersion === 8) {
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS automation_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          objective_pattern TEXT NOT NULL,
          allowed_tools_json TEXT NOT NULL,
          preset TEXT,
          allow_attachments INTEGER NOT NULL CHECK (allow_attachments IN (0, 1)),
          max_runtime_minutes INTEGER NOT NULL,
          max_tokens INTEGER,
          priority INTEGER NOT NULL,
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS automation_rules_priority_idx
          ON automation_rules(enabled, priority, created_at, id);
        UPDATE schema_meta SET version = 9 WHERE singleton = 1;
      `);
      currentVersion = 9;
    }
    if (currentVersion !== 9) {
      throw new Error(
        `unsupported Squad database version ${String(currentVersion)}`,
      );
    }
  }

  private transaction<T>(operation: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.#db.close();
  }

  identityNodeId(): string | undefined {
    const row = this.#db
      .prepare("SELECT node_id FROM node_identity WHERE singleton = 1")
      .get() as SqlRow | undefined;
    return optionalString(row?.node_id);
  }

  bindIdentity(nodeId: string, publicKey: string, createdAt: string): void {
    const existing = this.#db
      .prepare(
        "SELECT node_id, public_key FROM node_identity WHERE singleton = 1",
      )
      .get() as SqlRow | undefined;
    if (existing !== undefined) {
      if (existing.node_id !== nodeId || existing.public_key !== publicKey) {
        throw new Error("Squad database is bound to a different node identity");
      }
      return;
    }
    this.#db
      .prepare(
        "INSERT INTO node_identity(singleton, node_id, public_key, created_at) VALUES (1, ?, ?, ?)",
      )
      .run(nodeId, publicKey, createdAt);
  }

  nodeSetup(): NodeSetupRecord | undefined {
    const row = this.#db
      .prepare("SELECT * FROM node_settings WHERE singleton = 1")
      .get() as SqlRow | undefined;
    if (row === undefined) return undefined;
    const mode = String(row.mode);
    if (mode !== "RELAY" && mode !== "DIRECT") {
      throw new Error("invalid persisted Squad setup mode");
    }
    return {
      mode,
      displayName: String(row.display_name),
      ...(optionalString(row.relay_url) === undefined
        ? {}
        : { relayUrl: String(row.relay_url) }),
      directEnabled: asBoolean(row.direct_enabled),
      ...(optionalString(row.direct_public_url) === undefined
        ? {}
        : { directPublicUrl: String(row.direct_public_url) }),
      completedAt: String(row.completed_at),
      updatedAt: String(row.updated_at),
    };
  }

  saveNodeSetup(input: {
    mode: NodeSetupMode;
    displayName: string;
    relayUrl?: string;
    directEnabled: boolean;
    directPublicUrl?: string;
  }): NodeSetupRecord {
    const now = new Date().toISOString();
    const completedAt = this.nodeSetup()?.completedAt ?? now;
    this.#db
      .prepare(
        `
        INSERT INTO node_settings(
          singleton, mode, display_name, relay_url, direct_enabled,
          direct_public_url, completed_at, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          mode = excluded.mode,
          display_name = excluded.display_name,
          relay_url = excluded.relay_url,
          direct_enabled = excluded.direct_enabled,
          direct_public_url = excluded.direct_public_url,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        input.mode,
        input.displayName,
        input.relayUrl ?? null,
        input.directEnabled ? 1 : 0,
        input.directPublicUrl ?? null,
        completedAt,
        now,
      );
    const saved = this.nodeSetup();
    if (saved === undefined) throw new Error("Squad setup was not persisted");
    return saved;
  }

  private automationRuleFromRow(row: SqlRow): AutomationRule {
    return automationRuleSchema.parse({
      id: row.id,
      name: row.name,
      objectivePattern: row.objective_pattern,
      allowedTools: parseJson(row.allowed_tools_json, (input) =>
        automationRuleInputSchema.shape.allowedTools.parse(input),
      ),
      ...(optionalString(row.preset) === undefined
        ? {}
        : { preset: row.preset }),
      allowAttachments: asBoolean(row.allow_attachments),
      maxRuntimeMinutes: row.max_runtime_minutes,
      ...(typeof row.max_tokens === "number"
        ? { maxTokens: row.max_tokens }
        : {}),
      priority: row.priority,
      enabled: asBoolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  listAutomationRules(): AutomationRule[] {
    return (
      this.#db
        .prepare(
          "SELECT * FROM automation_rules ORDER BY priority, created_at, id",
        )
        .all() as SqlRow[]
    ).map((row) => this.automationRuleFromRow(row));
  }

  createAutomationRule(input: AutomationRuleInput): AutomationRule {
    const parsed = automationRuleInputSchema.parse(input);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.#db
      .prepare(
        `
        INSERT INTO automation_rules(
          id, name, objective_pattern, allowed_tools_json, preset,
          allow_attachments, max_runtime_minutes, max_tokens, priority,
          enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        parsed.name,
        parsed.objectivePattern,
        JSON.stringify(parsed.allowedTools),
        parsed.preset ?? null,
        parsed.allowAttachments ? 1 : 0,
        parsed.maxRuntimeMinutes,
        parsed.maxTokens ?? null,
        parsed.priority,
        parsed.enabled ? 1 : 0,
        now,
        now,
      );
    const created = this.listAutomationRules().find((rule) => rule.id === id);
    if (created === undefined) throw new Error("automation rule disappeared");
    return created;
  }

  updateAutomationRule(id: string, input: AutomationRuleInput): AutomationRule {
    const parsedId = idSchema.parse(id);
    const parsed = automationRuleInputSchema.parse(input);
    const changed = this.#db
      .prepare(
        `
        UPDATE automation_rules
        SET name = ?, objective_pattern = ?, allowed_tools_json = ?,
            preset = ?, allow_attachments = ?, max_runtime_minutes = ?,
            max_tokens = ?, priority = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(
        parsed.name,
        parsed.objectivePattern,
        JSON.stringify(parsed.allowedTools),
        parsed.preset ?? null,
        parsed.allowAttachments ? 1 : 0,
        parsed.maxRuntimeMinutes,
        parsed.maxTokens ?? null,
        parsed.priority,
        parsed.enabled ? 1 : 0,
        new Date().toISOString(),
        parsedId,
      ).changes;
    if (changed !== 1) throw new Error("unknown automation rule");
    const updated = this.listAutomationRules().find(
      (rule) => rule.id === parsedId,
    );
    if (updated === undefined) throw new Error("automation rule disappeared");
    return updated;
  }

  deleteAutomationRule(id: string): void {
    const changed = this.#db
      .prepare("DELETE FROM automation_rules WHERE id = ?")
      .run(idSchema.parse(id)).changes;
    if (changed !== 1) throw new Error("unknown automation rule");
  }

  upsertPeer(input: {
    nodeId: string;
    displayName: string;
    publicKey: string;
    enabled: boolean;
    transport?: PeerTransport;
    directUrl?: string;
    policy: PeerPolicy;
  }): void {
    const policy = peerPolicySchema.parse(input.policy);
    const transport = peerTransportSchema.parse(input.transport ?? "RELAY");
    if (transport === "DIRECT" && input.directUrl === undefined) {
      throw new Error("DIRECT peer requires a direct URL");
    }
    const now = new Date().toISOString();
    const existing = this.#db
      .prepare(
        "SELECT public_key, created_at FROM peer_policies WHERE node_id = ?",
      )
      .get(input.nodeId) as SqlRow | undefined;
    if (existing !== undefined && existing.public_key !== input.publicKey) {
      throw new Error(
        `peer ${input.nodeId} public key conflicts with its pinned key`,
      );
    }
    this.#db
      .prepare(
        `
        INSERT INTO peer_policies(
          node_id, display_name, public_key, directory_only, enabled, transport,
          direct_url,
          can_message, can_delegate, auto_execute, max_concurrent, max_delegation_depth,
          max_runtime_minutes, max_tokens, created_at, updated_at
        ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          display_name = excluded.display_name,
          directory_only = 0,
          enabled = excluded.enabled,
          transport = excluded.transport,
          direct_url = excluded.direct_url,
          can_message = excluded.can_message,
          can_delegate = excluded.can_delegate,
          auto_execute = excluded.auto_execute,
          max_concurrent = excluded.max_concurrent,
          max_delegation_depth = excluded.max_delegation_depth,
          max_runtime_minutes = excluded.max_runtime_minutes,
          max_tokens = excluded.max_tokens,
          removed_at = NULL,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        input.nodeId,
        input.displayName,
        input.publicKey,
        input.enabled ? 1 : 0,
        transport,
        input.directUrl ?? null,
        policy.canMessage ? 1 : 0,
        policy.canDelegate ? 1 : 0,
        policy.autoExecute,
        policy.maxConcurrent,
        policy.maxDelegationDepth,
        policy.maxRuntimeMinutes,
        policy.maxTokens ?? null,
        optionalString(existing?.created_at) ?? now,
        now,
      );
  }

  private peerFromRow(row: SqlRow): PeerRecord {
    return {
      nodeId: String(row.node_id),
      displayName: String(row.display_name),
      publicKey: String(row.public_key),
      enabled: asBoolean(row.enabled),
      transport: peerTransportSchema.parse(row.transport ?? "RELAY"),
      ...(optionalString(row.direct_url) === undefined
        ? {}
        : { directUrl: String(row.direct_url) }),
      policy: this.policyFromRow(row),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private policyFromRow(row: SqlRow): PeerPolicy {
    return peerPolicySchema.parse({
      canMessage: asBoolean(row.can_message),
      canDelegate: asBoolean(row.can_delegate),
      autoExecute: row.auto_execute,
      maxConcurrent: row.max_concurrent,
      maxDelegationDepth: row.max_delegation_depth,
      maxRuntimeMinutes: row.max_runtime_minutes,
      ...(typeof row.max_tokens === "number"
        ? { maxTokens: row.max_tokens }
        : {}),
    });
  }

  listPeers(): PeerRecord[] {
    return (
      this.#db
        .prepare(
          "SELECT * FROM peer_policies WHERE directory_only = 0 AND removed_at IS NULL ORDER BY lower(display_name), node_id",
        )
        .all() as SqlRow[]
    ).map((row) => this.peerFromRow(row));
  }

  findPeer(selector: string): PeerRecord | undefined {
    const rows = this.#db
      .prepare(
        "SELECT * FROM peer_policies WHERE directory_only = 0 AND removed_at IS NULL AND (node_id = ? OR lower(display_name) = lower(?)) ORDER BY node_id",
      )
      .all(selector, selector) as SqlRow[];
    if (rows.length > 1) {
      throw new Error(`peer name ${selector} is ambiguous; use a nodeId`);
    }
    return rows[0] === undefined ? undefined : this.peerFromRow(rows[0]);
  }

  updatePeerPolicy(nodeId: string, candidate: Partial<PeerPolicy>): PeerRecord {
    const peer = this.findPeer(nodeId);
    if (peer === undefined) throw new Error("unknown direct peer");
    this.upsertPeer({
      nodeId: peer.nodeId,
      displayName: peer.displayName,
      publicKey: peer.publicKey,
      enabled: peer.enabled,
      transport: peer.transport,
      ...(peer.directUrl === undefined ? {} : { directUrl: peer.directUrl }),
      policy: peerPolicySchema.parse({ ...peer.policy, ...candidate }),
    });
    const updated = this.findPeer(nodeId);
    if (updated === undefined) throw new Error("direct peer disappeared");
    return updated;
  }

  updatePeerConnection(
    nodeId: string,
    candidate: {
      displayName?: string;
      enabled?: boolean;
      transport?: PeerTransport;
      directUrl?: string | null;
    },
  ): PeerRecord {
    const peer = this.findPeer(nodeId);
    if (peer === undefined) throw new Error("unknown direct peer");
    const transport = candidate.transport ?? peer.transport;
    const directUrl =
      candidate.directUrl === undefined
        ? peer.directUrl
        : (candidate.directUrl ?? undefined);
    this.upsertPeer({
      nodeId: peer.nodeId,
      displayName: candidate.displayName ?? peer.displayName,
      publicKey: peer.publicKey,
      enabled: candidate.enabled ?? peer.enabled,
      transport,
      ...(directUrl === undefined ? {} : { directUrl }),
      policy: peer.policy,
    });
    const updated = this.findPeer(nodeId);
    if (updated === undefined) throw new Error("direct peer disappeared");
    return updated;
  }

  removePeer(nodeId: string): void {
    const result = this.#db
      .prepare(
        "UPDATE peer_policies SET enabled = 0, removed_at = ?, updated_at = ? WHERE node_id = ? AND directory_only = 0 AND removed_at IS NULL",
      )
      .run(new Date().toISOString(), new Date().toISOString(), nodeId);
    if (result.changes !== 1) throw new Error("unknown direct peer");
  }

  private ensureOrganizationNodeIdentity(
    member: OrganizationMembershipCertificate,
    now: string,
  ): void {
    const existing = this.#db
      .prepare("SELECT public_key FROM peer_policies WHERE node_id = ?")
      .get(member.nodeId) as SqlRow | undefined;
    if (existing !== undefined && existing.public_key !== member.publicKey) {
      throw new Error(
        `organization member ${member.nodeId} conflicts with a pinned node identity`,
      );
    }
    this.#db
      .prepare(
        `
        INSERT OR IGNORE INTO peer_policies(
          node_id, display_name, public_key, directory_only, enabled, transport,
          direct_url,
          can_message, can_delegate, auto_execute, max_concurrent,
          max_delegation_depth, max_runtime_minutes, max_tokens,
          created_at, updated_at
        ) VALUES (?, ?, ?, 1, 0, 'RELAY', NULL, 0, 0, 'NEVER', 1, 1, 30, NULL, ?, ?)
      `,
      )
      .run(member.nodeId, member.displayName, member.publicKey, now, now);
  }

  applyOrganizationBundle(
    candidate: OrganizationDirectoryBundle,
    selfNodeId: string,
  ): boolean {
    const bundle = organizationDirectoryBundleSchema.parse(candidate);
    const verified = verifyOrganizationDirectory(
      bundle.document,
      bundle.events,
    );
    if (verified.revision !== bundle.revision) {
      throw new Error("organization bundle revision does not match its events");
    }
    const selfMember = [...verified.members.values()].find(
      (member) => member.nodeId === selfNodeId,
    );
    const selfRequest = bundle.pendingJoinRequests.find(
      (request) => request.nodeId === selfNodeId,
    );
    if (
      (bundle.selfStatus === "ACTIVE" && selfMember?.status !== "ACTIVE") ||
      (bundle.selfStatus === "DISABLED" && selfMember?.status !== "DISABLED") ||
      (bundle.selfStatus === "PENDING" && selfRequest === undefined)
    ) {
      throw new Error(
        "organization bundle does not establish local membership",
      );
    }
    const existing = this.#db
      .prepare(
        "SELECT document_json, self_status, highest_revision FROM organizations WHERE organization_id = ?",
      )
      .get(bundle.document.organizationId) as SqlRow | undefined;
    if (
      existing !== undefined &&
      String(existing.document_json) !== JSON.stringify(bundle.document)
    ) {
      throw new Error("organization document conflicts with its pinned root");
    }
    const previousRevision = Number(existing?.highest_revision ?? 0);
    if (bundle.revision < previousRevision) {
      throw new Error("organization directory rollback was rejected");
    }
    if (bundle.revision === previousRevision && previousRevision > 0) {
      for (const event of bundle.events) {
        const stored = this.#db
          .prepare(
            "SELECT certificate_json FROM organization_events WHERE organization_id = ? AND organization_revision = ?",
          )
          .get(bundle.document.organizationId, event.organizationRevision) as
          | SqlRow
          | undefined;
        if (
          stored === undefined ||
          String(stored.certificate_json) !== JSON.stringify(event)
        ) {
          throw new Error("organization directory history conflicts locally");
        }
      }
    }
    const previousRequests =
      existing === undefined
        ? ""
        : JSON.stringify(
            (
              this.#db
                .prepare(
                  "SELECT request_json FROM organization_join_requests WHERE organization_id = ? ORDER BY requested_at, request_id",
                )
                .all(bundle.document.organizationId) as SqlRow[]
            ).map((row) => JSON.parse(String(row.request_json)) as unknown),
          );
    const nextRequests = JSON.stringify(
      [...bundle.pendingJoinRequests].sort(
        (left, right) =>
          left.requestedAt.localeCompare(right.requestedAt) ||
          left.requestId.localeCompare(right.requestId),
      ),
    );
    const changed =
      existing === undefined ||
      previousRevision !== bundle.revision ||
      existing.self_status !== bundle.selfStatus ||
      previousRequests !== nextRequests;
    const now = new Date().toISOString();
    this.transaction(() => {
      this.#db
        .prepare(
          `
          INSERT INTO organizations(
            organization_id, name, document_json, self_status,
            highest_revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(organization_id) DO UPDATE SET
            name = excluded.name,
            self_status = excluded.self_status,
            highest_revision = excluded.highest_revision,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          bundle.document.organizationId,
          bundle.document.name,
          JSON.stringify(bundle.document),
          bundle.selfStatus,
          bundle.revision,
          bundle.document.createdAt,
          now,
        );
      const insertEvent = this.#db.prepare(`
        INSERT OR IGNORE INTO organization_events(
          organization_id, organization_revision, membership_id,
          member_revision, certificate_json, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const event of bundle.events) {
        insertEvent.run(
          bundle.document.organizationId,
          event.organizationRevision,
          event.membershipId,
          event.memberRevision,
          JSON.stringify(event),
          event.issuedAt,
        );
      }
      const upsertMember = this.#db.prepare(`
        INSERT INTO organization_members(
          organization_id, membership_id, node_id, display_name, public_key,
          role, status, organization_revision, member_revision, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, membership_id) DO UPDATE SET
          display_name = excluded.display_name,
          role = excluded.role,
          status = excluded.status,
          organization_revision = excluded.organization_revision,
          member_revision = excluded.member_revision,
          issued_at = excluded.issued_at
      `);
      const insertPolicy = this.#db.prepare(`
        INSERT OR IGNORE INTO organization_member_policies(
          organization_id, membership_id, can_message, can_delegate,
          auto_execute, max_concurrent, max_delegation_depth,
          max_runtime_minutes, max_tokens, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const member of verified.members.values()) {
        this.ensureOrganizationNodeIdentity(member, now);
        upsertMember.run(
          bundle.document.organizationId,
          member.membershipId,
          member.nodeId,
          member.displayName,
          member.publicKey,
          member.role,
          member.status,
          member.organizationRevision,
          member.memberRevision,
          member.issuedAt,
        );
        insertPolicy.run(
          bundle.document.organizationId,
          member.membershipId,
          defaultOrganizationPeerPolicy.canMessage ? 1 : 0,
          defaultOrganizationPeerPolicy.canDelegate ? 1 : 0,
          defaultOrganizationPeerPolicy.autoExecute,
          defaultOrganizationPeerPolicy.maxConcurrent,
          defaultOrganizationPeerPolicy.maxDelegationDepth,
          defaultOrganizationPeerPolicy.maxRuntimeMinutes,
          defaultOrganizationPeerPolicy.maxTokens ?? null,
          now,
        );
      }
      this.#db
        .prepare(
          "DELETE FROM organization_join_requests WHERE organization_id = ?",
        )
        .run(bundle.document.organizationId);
      const insertRequest = this.#db.prepare(`
        INSERT INTO organization_join_requests(
          organization_id, request_id, membership_id, node_id,
          request_json, requested_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const request of bundle.pendingJoinRequests) {
        insertRequest.run(
          bundle.document.organizationId,
          request.requestId,
          request.membershipId,
          request.nodeId,
          JSON.stringify(request),
          request.requestedAt,
        );
      }
    });
    return changed;
  }

  organizationDirectory(
    organizationId: string,
  ): OrganizationDirectoryRecord | undefined {
    const row = this.#db
      .prepare("SELECT * FROM organizations WHERE organization_id = ?")
      .get(organizationId) as SqlRow | undefined;
    if (row === undefined) return undefined;
    const document = organizationDocumentSchema.parse(
      JSON.parse(String(row.document_json)) as unknown,
    );
    const events = (
      this.#db
        .prepare(
          "SELECT certificate_json FROM organization_events WHERE organization_id = ? ORDER BY organization_revision",
        )
        .all(organizationId) as SqlRow[]
    ).map((event) =>
      organizationMembershipCertificateSchema.parse(
        JSON.parse(String(event.certificate_json)) as unknown,
      ),
    );
    const verified = verifyOrganizationDirectory(document, events);
    if (verified.revision !== Number(row.highest_revision)) {
      throw new Error("local organization revision is inconsistent");
    }
    const pendingJoinRequests = (
      this.#db
        .prepare(
          "SELECT request_json FROM organization_join_requests WHERE organization_id = ? ORDER BY requested_at, request_id",
        )
        .all(organizationId) as SqlRow[]
    ).map((request) =>
      organizationJoinRequestSchema.parse(
        JSON.parse(String(request.request_json)) as unknown,
      ),
    );
    return {
      document,
      revision: verified.revision,
      events,
      members: verified.members,
      selfStatus: row.self_status as "ACTIVE" | "PENDING" | "DISABLED",
      pendingJoinRequests,
    };
  }

  private organizationMemberFromRow(
    row: SqlRow,
    selfNodeId: string,
  ): OrganizationMemberView {
    return {
      organizationId: String(row.organization_id),
      membershipId: String(row.membership_id),
      nodeId: String(row.node_id),
      displayName: String(row.display_name),
      publicKey: String(row.public_key),
      role: row.role as OrganizationRole,
      status: row.status as "ACTIVE" | "DISABLED",
      organizationRevision: Number(row.organization_revision),
      memberRevision: Number(row.member_revision),
      issuedAt: String(row.issued_at),
      isSelf: row.node_id === selfNodeId,
      policy: this.policyFromRow(row),
    };
  }

  listOrganizations(selfNodeId: string): OrganizationView[] {
    const rows = this.#db
      .prepare(
        "SELECT * FROM organizations ORDER BY lower(name), organization_id",
      )
      .all() as SqlRow[];
    return rows.map((row) => {
      const organizationId = String(row.organization_id);
      const members = (
        this.#db
          .prepare(
            `
            SELECT m.*, p.can_message, p.can_delegate, p.auto_execute,
                   p.max_concurrent, p.max_delegation_depth,
                   p.max_runtime_minutes, p.max_tokens
            FROM organization_members m
            JOIN organization_member_policies p
              ON p.organization_id = m.organization_id
             AND p.membership_id = m.membership_id
            WHERE m.organization_id = ?
            ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END,
                     lower(m.display_name), m.membership_id
          `,
          )
          .all(organizationId) as SqlRow[]
      ).map((member) => this.organizationMemberFromRow(member, selfNodeId));
      const self = members.find(
        (member) => member.isSelf && member.status === "ACTIVE",
      );
      const directory = this.organizationDirectory(organizationId);
      if (directory === undefined) {
        throw new Error(`organization ${organizationId} disappeared`);
      }
      return {
        organizationId,
        name: String(row.name),
        ...(self === undefined ? {} : { role: self.role }),
        ...(self === undefined ? {} : { selfMembershipId: self.membershipId }),
        membershipStatus: row.self_status as "ACTIVE" | "PENDING" | "DISABLED",
        revision: Number(row.highest_revision),
        createdAt: String(row.created_at),
        members,
        pendingJoinRequests: directory.pendingJoinRequests,
      };
    });
  }

  findOrganization(
    selector: string,
    selfNodeId: string,
  ): OrganizationView | undefined {
    const matches = this.listOrganizations(selfNodeId).filter(
      (organization) =>
        organization.organizationId === selector ||
        organization.name.toLowerCase() === selector.toLowerCase(),
    );
    if (matches.length > 1) {
      throw new Error(
        `organization name ${selector} is ambiguous; use an organization ID`,
      );
    }
    return matches[0];
  }

  findOrganizationMember(
    organizationId: string,
    selector: string,
    selfNodeId: string,
  ): OrganizationMemberView | undefined {
    const organization = this.listOrganizations(selfNodeId).find(
      (candidate) => candidate.organizationId === organizationId,
    );
    const matches = (organization?.members ?? []).filter(
      (member) =>
        member.membershipId === selector ||
        member.nodeId === selector ||
        member.displayName.toLowerCase() === selector.toLowerCase(),
    );
    if (matches.length > 1) {
      throw new Error(
        `member name ${selector} is ambiguous; use a membership ID`,
      );
    }
    return matches[0];
  }

  updateOrganizationMemberPolicy(
    organizationId: string,
    membershipId: string,
    candidate: Partial<PeerPolicy>,
  ): OrganizationMemberView {
    const row = this.#db
      .prepare(
        `
        SELECT m.*, p.can_message, p.can_delegate, p.auto_execute,
               p.max_concurrent, p.max_delegation_depth,
               p.max_runtime_minutes, p.max_tokens
        FROM organization_members m
        JOIN organization_member_policies p
          ON p.organization_id = m.organization_id
         AND p.membership_id = m.membership_id
        WHERE m.organization_id = ? AND m.membership_id = ?
      `,
      )
      .get(organizationId, membershipId) as SqlRow | undefined;
    if (row === undefined) throw new Error("unknown organization member");
    const policy = peerPolicySchema.parse({
      ...this.policyFromRow(row),
      ...candidate,
    });
    this.#db
      .prepare(
        `
        UPDATE organization_member_policies
        SET can_message = ?, can_delegate = ?, auto_execute = ?,
            max_concurrent = ?, max_delegation_depth = ?,
            max_runtime_minutes = ?, max_tokens = ?, updated_at = ?
        WHERE organization_id = ? AND membership_id = ?
      `,
      )
      .run(
        policy.canMessage ? 1 : 0,
        policy.canDelegate ? 1 : 0,
        policy.autoExecute,
        policy.maxConcurrent,
        policy.maxDelegationDepth,
        policy.maxRuntimeMinutes,
        policy.maxTokens ?? null,
        new Date().toISOString(),
        organizationId,
        membershipId,
      );
    const updated = this.#db
      .prepare(
        `
        SELECT m.*, p.can_message, p.can_delegate, p.auto_execute,
               p.max_concurrent, p.max_delegation_depth,
               p.max_runtime_minutes, p.max_tokens
        FROM organization_members m
        JOIN organization_member_policies p
          ON p.organization_id = m.organization_id
         AND p.membership_id = m.membership_id
        WHERE m.organization_id = ? AND m.membership_id = ?
      `,
      )
      .get(organizationId, membershipId) as SqlRow;
    return this.organizationMemberFromRow(updated, "");
  }

  setSessionOrganization(
    sessionId: string,
    organizationId: string | undefined,
    selfNodeId: string,
  ): void {
    if (organizationId === undefined) {
      this.#db
        .prepare("DELETE FROM session_organizations WHERE session_id = ?")
        .run(sessionId);
      return;
    }
    const organization = this.findOrganization(organizationId, selfNodeId);
    if (
      organization === undefined ||
      organization.membershipStatus !== "ACTIVE"
    ) {
      throw new Error("organization is not active for this Node");
    }
    this.#db
      .prepare(
        `
        INSERT INTO session_organizations(session_id, organization_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          updated_at = excluded.updated_at
      `,
      )
      .run(sessionId, organization.organizationId, new Date().toISOString());
  }

  sessionOrganization(sessionId: string): string | undefined {
    const row = this.#db
      .prepare(
        "SELECT organization_id FROM session_organizations WHERE session_id = ?",
      )
      .get(sessionId) as SqlRow | undefined;
    return optionalString(row?.organization_id);
  }

  sessionOrganizations(): Record<string, string> {
    const rows = this.#db
      .prepare(
        "SELECT session_id, organization_id FROM session_organizations ORDER BY session_id",
      )
      .all() as SqlRow[];
    return Object.fromEntries(
      rows.map((row) => [String(row.session_id), String(row.organization_id)]),
    );
  }

  private teamPlanFromRow(row: SqlRow): TeamPlan {
    const items = (
      this.#db
        .prepare(
          "SELECT * FROM team_plan_items WHERE plan_id = ? ORDER BY position, id",
        )
        .all(String(row.id)) as SqlRow[]
    ).map((item): TeamPlanItem => {
      const context = optionalString(item.context);
      const delegationId = optionalString(item.delegation_id);
      const membershipId = optionalString(item.membership_id);
      const error = optionalString(item.error);
      return {
        id: String(item.id),
        planId: String(item.plan_id),
        position: Number(item.position),
        peerNodeId: String(item.peer_node_id),
        peerDisplayName: String(item.peer_display_name),
        ...(membershipId === undefined ? {} : { membershipId }),
        objective: String(item.objective),
        ...(context === undefined ? {} : { context }),
        acceptanceCriteria: parseJson(item.acceptance_criteria_json, (input) =>
          delegationRequestSchema.shape.acceptanceCriteria.parse(input),
        ),
        attachmentRefs: parseJson(item.attachment_refs_json, (input) =>
          attachmentRefSchema.array().parse(input),
        ),
        status: item.status as TeamPlanItemStatus,
        ...(delegationId === undefined ? {} : { delegationId }),
        ...(error === undefined ? {} : { error }),
        createdAt: String(item.created_at),
        updatedAt: String(item.updated_at),
      };
    });
    const sourceSummary = optionalString(row.source_summary);
    const approvedAt = optionalString(row.approved_at);
    const canceledAt = optionalString(row.canceled_at);
    const organizationId = optionalString(row.organization_id);
    return {
      id: String(row.id),
      ...(organizationId === undefined ? {} : { organizationId }),
      title: String(row.title),
      ...(sourceSummary === undefined ? {} : { sourceSummary }),
      status: row.status as TeamPlanStatus,
      revision: Number(row.revision),
      ...(approvedAt === undefined ? {} : { approvedAt }),
      ...(canceledAt === undefined ? {} : { canceledAt }),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      items,
    };
  }

  createTeamPlan(
    candidate: CreateTeamPlanInput,
    resolvedPeers: ResolvedDelegationRecipient[],
    organizationId?: string,
  ): TeamPlan {
    const input = createTeamPlanInputSchema.parse(candidate);
    if (resolvedPeers.length !== input.items.length) {
      throw new Error("every team plan item must have one resolved peer");
    }
    const planId = randomUUID();
    const itemIds = input.items.map(() => randomUUID());
    const now = new Date().toISOString();
    return this.transaction(() => {
      this.#db
        .prepare(
          `
          INSERT INTO team_plans(
            id, organization_id, title, source_summary, status, revision,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'DRAFT', 1, ?, ?)
        `,
        )
        .run(
          planId,
          organizationId ?? null,
          input.title,
          input.sourceSummary ?? null,
          now,
          now,
        );
      const insertItem = this.#db.prepare(`
        INSERT INTO team_plan_items(
          id, plan_id, position, peer_node_id, peer_display_name, membership_id,
          objective, context, acceptance_criteria_json, attachment_refs_json,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)
      `);
      for (const [position, item] of input.items.entries()) {
        const peer = resolvedPeers[position];
        const itemId = itemIds[position];
        if (peer === undefined) {
          throw new Error(`team plan item ${position} has no resolved peer`);
        }
        if (itemId === undefined) {
          throw new Error(`team plan item ${position} has no stable ID`);
        }
        if (
          peer.organizationId !== organizationId ||
          (organizationId !== undefined && peer.membershipId === undefined)
        ) {
          throw new Error("team plan recipient organization is inconsistent");
        }
        insertItem.run(
          itemId,
          planId,
          position,
          peer.nodeId,
          peer.displayName,
          peer.membershipId ?? null,
          item.objective,
          item.context ?? null,
          JSON.stringify(item.acceptanceCriteria ?? []),
          JSON.stringify(item.attachmentRefs ?? []),
          now,
          now,
        );
      }
      const plan = this.getTeamPlan(planId);
      if (plan === undefined) throw new Error("team plan was not persisted");
      return plan;
    });
  }

  getTeamPlan(id: string): TeamPlan | undefined {
    const row = this.#db
      .prepare("SELECT * FROM team_plans WHERE id = ?")
      .get(id) as SqlRow | undefined;
    return row === undefined ? undefined : this.teamPlanFromRow(row);
  }

  listTeamPlans(): TeamPlan[] {
    return (
      this.#db
        .prepare("SELECT * FROM team_plans ORDER BY updated_at DESC, id")
        .all() as SqlRow[]
    ).map((row) => this.teamPlanFromRow(row));
  }

  beginTeamPlanDispatch(id: string): TeamPlan {
    return this.transaction(() => {
      const current = this.getTeamPlan(id);
      if (current === undefined) throw new Error(`unknown team plan ${id}`);
      if (current.status === "DISPATCHING") return current;
      if (
        !(["DRAFT", "PARTIAL"] as TeamPlanStatus[]).includes(current.status)
      ) {
        throw new Error(
          `team plan ${id} cannot be dispatched from ${current.status}`,
        );
      }
      const now = new Date().toISOString();
      this.#db
        .prepare(
          `
          UPDATE team_plans
          SET status = 'DISPATCHING', revision = revision + 1,
              approved_at = coalesce(approved_at, ?), updated_at = ?
          WHERE id = ?
        `,
        )
        .run(now, now, id);
      const updated = this.getTeamPlan(id);
      if (updated === undefined) throw new Error(`team plan ${id} disappeared`);
      return updated;
    });
  }

  markTeamPlanItemDispatched(
    planId: string,
    itemId: string,
    delegationId: string,
  ): TeamPlan {
    if (itemId !== delegationId) {
      throw new Error("team plan item and delegation IDs must match");
    }
    return this.transaction(() => {
      const plan = this.getTeamPlan(planId);
      if (plan === undefined) throw new Error(`unknown team plan ${planId}`);
      if (plan.status !== "DISPATCHING") {
        throw new Error(`team plan ${planId} is not dispatching`);
      }
      const item = plan.items.find((candidate) => candidate.id === itemId);
      if (item === undefined)
        throw new Error(`unknown team plan item ${itemId}`);
      if (item.status === "DISPATCHED") {
        if (item.delegationId !== delegationId) {
          throw new Error(
            `team plan item ${itemId} has a conflicting delegation`,
          );
        }
        return plan;
      }
      if (item.status === "CANCELED") {
        throw new Error(`team plan item ${itemId} is canceled`);
      }
      const now = new Date().toISOString();
      this.#db
        .prepare(
          "UPDATE team_plan_items SET status = 'DISPATCHED', delegation_id = ?, error = NULL, updated_at = ? WHERE id = ? AND plan_id = ?",
        )
        .run(delegationId, now, itemId, planId);
      this.#db
        .prepare(
          "UPDATE team_plans SET revision = revision + 1, updated_at = ? WHERE id = ?",
        )
        .run(now, planId);
      const updated = this.getTeamPlan(planId);
      if (updated === undefined)
        throw new Error(`team plan ${planId} disappeared`);
      return updated;
    });
  }

  markTeamPlanItemFailed(
    planId: string,
    itemId: string,
    error: unknown,
  ): TeamPlan {
    return this.transaction(() => {
      const plan = this.getTeamPlan(planId);
      if (plan === undefined) throw new Error(`unknown team plan ${planId}`);
      if (plan.status !== "DISPATCHING") {
        throw new Error(`team plan ${planId} is not dispatching`);
      }
      const item = plan.items.find((candidate) => candidate.id === itemId);
      if (item === undefined)
        throw new Error(`unknown team plan item ${itemId}`);
      if (item.status === "DISPATCHED") return plan;
      if (item.status === "CANCELED") {
        throw new Error(`team plan item ${itemId} is canceled`);
      }
      const now = new Date().toISOString();
      this.#db
        .prepare(
          "UPDATE team_plan_items SET status = 'FAILED', delegation_id = NULL, error = ?, updated_at = ? WHERE id = ? AND plan_id = ?",
        )
        .run(redactError(error), now, itemId, planId);
      this.#db
        .prepare(
          "UPDATE team_plans SET revision = revision + 1, updated_at = ? WHERE id = ?",
        )
        .run(now, planId);
      const updated = this.getTeamPlan(planId);
      if (updated === undefined)
        throw new Error(`team plan ${planId} disappeared`);
      return updated;
    });
  }

  finishTeamPlanDispatch(id: string): TeamPlan {
    return this.transaction(() => {
      const plan = this.getTeamPlan(id);
      if (plan === undefined) throw new Error(`unknown team plan ${id}`);
      if (plan.status !== "DISPATCHING") {
        throw new Error(`team plan ${id} is not dispatching`);
      }
      const status: TeamPlanStatus = plan.items.every(
        (item) => item.status === "DISPATCHED",
      )
        ? "DISPATCHED"
        : "PARTIAL";
      const now = new Date().toISOString();
      this.#db
        .prepare(
          "UPDATE team_plans SET status = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
        )
        .run(status, now, id);
      const updated = this.getTeamPlan(id);
      if (updated === undefined) throw new Error(`team plan ${id} disappeared`);
      return updated;
    });
  }

  cancelTeamPlan(id: string): TeamPlan {
    return this.transaction(() => {
      const plan = this.getTeamPlan(id);
      if (plan === undefined) throw new Error(`unknown team plan ${id}`);
      if (plan.status === "CANCELED") return plan;
      if (plan.status === "DISPATCHED") {
        throw new Error(`team plan ${id} is already fully dispatched`);
      }
      const now = new Date().toISOString();
      this.#db
        .prepare(
          "UPDATE team_plan_items SET status = 'CANCELED', error = NULL, updated_at = ? WHERE plan_id = ? AND status IN ('DRAFT', 'FAILED')",
        )
        .run(now, id);
      this.#db
        .prepare(
          "UPDATE team_plans SET status = 'CANCELED', revision = revision + 1, canceled_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(now, now, id);
      const updated = this.getTeamPlan(id);
      if (updated === undefined) throw new Error(`team plan ${id} disappeared`);
      return updated;
    });
  }

  createOutgoing(
    request: DelegationRequest,
    envelope: Envelope,
    digest: string,
  ): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.#db
        .prepare(
          `
          INSERT INTO local_delegations(
            id, direction, peer_node_id, organization_id,
            sender_membership_id, recipient_membership_id,
            parent_delegation_id, objective, context,
            acceptance_criteria_json, attachment_refs_json, delegation_depth,
            status, revision, delivery_status, request_envelope_id,
            outputs_json, created_at, updated_at
          ) VALUES (?, 'OUTGOING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', 1,
            'QUEUED_LOCAL', ?, '[]', ?, ?)
        `,
        )
        .run(
          request.delegationId,
          envelope.recipientNodeId,
          envelope.organizationId ?? null,
          envelope.senderMembershipId ?? null,
          envelope.recipientMembershipId ?? null,
          request.parentDelegationId ?? null,
          request.objective,
          request.context ?? null,
          JSON.stringify(request.acceptanceCriteria),
          JSON.stringify(request.attachmentRefs),
          request.delegationDepth,
          envelope.envelopeId,
          now,
          now,
        );
      this.insertOutboxUnsafe(envelope, digest, now);
    });
  }

  receiveRequest(
    envelope: Extract<Envelope, { kind: "DELEGATION_REQUEST" }>,
    digest: string,
  ): "INSERTED" | "DUPLICATE" {
    return this.transaction(() => {
      const receipt = this.#db
        .prepare("SELECT digest FROM envelope_receipts WHERE envelope_id = ?")
        .get(envelope.envelopeId) as SqlRow | undefined;
      if (receipt !== undefined) {
        if (receipt.digest !== digest) {
          throw new Error(
            `envelope ${envelope.envelopeId} conflicts with its receipt`,
          );
        }
        return "DUPLICATE";
      }
      const request = delegationRequestSchema.parse(envelope.payload);
      const existing = this.#db
        .prepare(
          "SELECT request_envelope_id FROM local_delegations WHERE id = ?",
        )
        .get(request.delegationId) as SqlRow | undefined;
      if (existing !== undefined) {
        throw new Error(
          `delegation ${request.delegationId} conflicts with an existing record`,
        );
      }
      const now = new Date().toISOString();
      this.#db
        .prepare(
          `
          INSERT INTO local_delegations(
            id, direction, peer_node_id, organization_id,
            sender_membership_id, recipient_membership_id,
            parent_delegation_id, objective, context,
            acceptance_criteria_json, attachment_refs_json, delegation_depth,
            status, revision, delivery_status, request_envelope_id,
            outputs_json, created_at, updated_at
          ) VALUES (?, 'INCOMING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', 1,
            'RECEIVED_LOCAL', ?, '[]', ?, ?)
        `,
        )
        .run(
          request.delegationId,
          envelope.senderNodeId,
          envelope.organizationId ?? null,
          envelope.senderMembershipId ?? null,
          envelope.recipientMembershipId ?? null,
          request.parentDelegationId ?? null,
          request.objective,
          request.context ?? null,
          JSON.stringify(request.acceptanceCriteria),
          JSON.stringify(request.attachmentRefs),
          request.delegationDepth,
          envelope.envelopeId,
          now,
          now,
        );
      this.insertReceiptUnsafe(envelope, digest, request.delegationId, now);
      return "INSERTED";
    });
  }

  recordReceipt(envelope: Envelope, digest: string): "INSERTED" | "DUPLICATE" {
    const existing = this.#db
      .prepare("SELECT digest FROM envelope_receipts WHERE envelope_id = ?")
      .get(envelope.envelopeId) as SqlRow | undefined;
    if (existing !== undefined) {
      if (existing.digest !== digest) {
        throw new Error(
          `envelope ${envelope.envelopeId} conflicts with its receipt`,
        );
      }
      return "DUPLICATE";
    }
    const delegationId =
      "delegationId" in envelope.payload
        ? envelope.payload.delegationId
        : undefined;
    this.insertReceiptUnsafe(
      envelope,
      digest,
      delegationId,
      new Date().toISOString(),
    );
    return "INSERTED";
  }

  private insertReceiptUnsafe(
    envelope: Envelope,
    digest: string,
    delegationId: string | undefined,
    now: string,
  ): void {
    this.#db
      .prepare(
        "INSERT INTO envelope_receipts(envelope_id, digest, delegation_id, kind, received_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        envelope.envelopeId,
        digest,
        delegationId ?? null,
        envelope.kind,
        now,
      );
  }

  recordMessage(
    envelope: Extract<Envelope, { kind: "MESSAGE" }>,
    digest: string,
  ): void {
    this.transaction(() => {
      const inserted = this.recordReceipt(envelope, digest);
      if (inserted === "DUPLICATE") return;
      this.#db
        .prepare(
          "INSERT INTO local_messages(message_id, envelope_id, sender_node_id, text, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          envelope.payload.messageId,
          envelope.envelopeId,
          envelope.senderNodeId,
          envelope.payload.text,
          envelope.createdAt,
        );
    });
  }

  private delegationFromRow(row: SqlRow): DelegationRecord {
    const todos = (
      this.#db
        .prepare(
          "SELECT * FROM human_todos WHERE delegation_id = ? ORDER BY created_at, id",
        )
        .all(String(row.id)) as SqlRow[]
    ).map((todo) => {
      const instructions = optionalString(todo.instructions);
      const humanResponse = optionalString(todo.human_response);
      const resolvedAt = optionalString(todo.resolved_at);
      return humanTodoSchema.parse({
        id: todo.id,
        delegationId: todo.delegation_id,
        title: todo.title,
        ...(instructions === undefined ? {} : { instructions }),
        blockingReason: todo.blocking_reason,
        status: todo.status,
        ...(humanResponse === undefined ? {} : { humanResponse }),
        attachmentRefs: parseJson(todo.attachment_refs_json, (input) =>
          attachmentRefSchema.array().parse(input),
        ),
        createdAt: todo.created_at,
        ...(resolvedAt === undefined ? {} : { resolvedAt }),
      });
    });
    const parentDelegationId = optionalString(row.parent_delegation_id);
    const organizationId = optionalString(row.organization_id);
    const senderMembershipId = optionalString(row.sender_membership_id);
    const recipientMembershipId = optionalString(row.recipient_membership_id);
    const context = optionalString(row.context);
    const sessionId = optionalString(row.session_id);
    const summary = optionalString(row.summary);
    const errorCode = optionalString(row.error_code);
    const completedAt = optionalString(row.completed_at);
    const outbox = this.#db
      .prepare(
        "SELECT attempts, last_error, next_attempt_at FROM local_outbox WHERE envelope_id = ?",
      )
      .get(String(row.request_envelope_id)) as SqlRow | undefined;
    const lastDeliveryError = optionalString(outbox?.last_error);
    const nextDeliveryAttemptAt = optionalString(outbox?.next_attempt_at);
    return {
      id: String(row.id),
      direction: row.direction as DelegationDirection,
      peerNodeId: String(row.peer_node_id),
      ...(organizationId === undefined ? {} : { organizationId }),
      ...(senderMembershipId === undefined ? {} : { senderMembershipId }),
      ...(recipientMembershipId === undefined ? {} : { recipientMembershipId }),
      ...(parentDelegationId === undefined ? {} : { parentDelegationId }),
      objective: String(row.objective),
      ...(context === undefined ? {} : { context }),
      acceptanceCriteria: parseJson(row.acceptance_criteria_json, (input) =>
        delegationRequestSchema.shape.acceptanceCriteria.parse(input),
      ),
      attachmentRefs: parseJson(row.attachment_refs_json, (input) =>
        attachmentRefSchema.array().parse(input),
      ),
      delegationDepth: Number(row.delegation_depth),
      status: row.status as DelegationStatus,
      revision: Number(row.revision),
      deliveryStatus: row.delivery_status as DeliveryStatus,
      deliveryAttempts: Number(outbox?.attempts ?? 0),
      ...(lastDeliveryError === undefined ? {} : { lastDeliveryError }),
      ...(nextDeliveryAttemptAt === undefined ? {} : { nextDeliveryAttemptAt }),
      requestEnvelopeId: String(row.request_envelope_id),
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(summary === undefined ? {} : { summary }),
      outputs: parseJson(row.outputs_json, (input) =>
        resultOutputSchema.array().parse(input),
      ),
      ...(errorCode === undefined ? {} : { errorCode }),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      ...(completedAt === undefined ? {} : { completedAt }),
      todos,
    };
  }

  getDelegation(id: string): DelegationRecord | undefined {
    const row = this.#db
      .prepare("SELECT * FROM local_delegations WHERE id = ?")
      .get(id) as SqlRow | undefined;
    return row === undefined ? undefined : this.delegationFromRow(row);
  }

  getDelegationBySession(sessionId: string): DelegationRecord | undefined {
    const row = this.#db
      .prepare("SELECT * FROM local_delegations WHERE session_id = ?")
      .get(sessionId) as SqlRow | undefined;
    return row === undefined ? undefined : this.delegationFromRow(row);
  }

  listDelegations(): DelegationRecord[] {
    return (
      this.#db
        .prepare("SELECT * FROM local_delegations ORDER BY updated_at DESC, id")
        .all() as SqlRow[]
    ).map((row) => this.delegationFromRow(row));
  }

  countRunningFromPeer(nodeId: string, organizationId?: string): number {
    const row = this.#db
      .prepare(
        `
        SELECT count(*) AS count FROM local_delegations
        WHERE direction = 'INCOMING' AND peer_node_id = ?
          AND coalesce(organization_id, '') = coalesce(?, '')
          AND status = 'RUNNING'
      `,
      )
      .get(nodeId, organizationId ?? null) as SqlRow;
    return Number(row.count);
  }

  transition(
    id: string,
    next: DelegationStatus,
    fields: {
      sessionId?: string;
      summary?: string;
      outputs?: ResultOutput[];
      errorCode?: string;
      completedAt?: string;
    } = {},
  ): DelegationRecord {
    return this.transaction(() => {
      const current = this.getDelegation(id);
      if (current === undefined) throw new Error(`unknown delegation ${id}`);
      assertTransition(current.status, next);
      if (current.status === next) return current;
      const now = new Date().toISOString();
      this.#db
        .prepare(
          `
          UPDATE local_delegations SET
            status = ?, revision = revision + 1, updated_at = ?,
            session_id = coalesce(?, session_id),
            summary = coalesce(?, summary),
            outputs_json = coalesce(?, outputs_json),
            error_code = coalesce(?, error_code),
            completed_at = coalesce(?, completed_at)
          WHERE id = ?
        `,
        )
        .run(
          next,
          now,
          fields.sessionId ?? null,
          fields.summary ?? null,
          fields.outputs === undefined ? null : JSON.stringify(fields.outputs),
          fields.errorCode ?? null,
          fields.completedAt ?? null,
          id,
        );
      const updated = this.getDelegation(id);
      if (updated === undefined)
        throw new Error(`delegation ${id} disappeared`);
      return updated;
    });
  }

  applyRemoteUpdate(update: DelegationUpdate): void {
    const current = this.getDelegation(update.delegationId);
    if (current === undefined || current.direction !== "OUTGOING") return;
    if (isTerminalStatus(current.status) || update.revision <= current.revision)
      return;
    const allowed =
      current.status === "QUEUED"
        ? ["QUEUED", "RUNNING", "WAITING_HUMAN"]
        : current.status === "RUNNING"
          ? ["RUNNING", "WAITING_HUMAN"]
          : current.status === "WAITING_HUMAN"
            ? ["WAITING_HUMAN", "RUNNING"]
            : [];
    if (!allowed.includes(update.status)) {
      this.diagnostic(
        "REMOTE_STATE_REGRESSION",
        update.delegationId,
        `ignored ${current.status} -> ${update.status} at revision ${update.revision}`,
      );
      return;
    }
    this.#db
      .prepare(
        "UPDATE local_delegations SET status = ?, revision = ?, summary = coalesce(?, summary), updated_at = ? WHERE id = ?",
      )
      .run(
        update.status,
        update.revision,
        update.shareableSummary ?? null,
        update.updatedAt,
        update.delegationId,
      );
  }

  applyRemoteResult(result: DelegationResult): void {
    const current = this.getDelegation(result.delegationId);
    if (current === undefined || current.direction !== "OUTGOING") return;
    if (isTerminalStatus(current.status)) {
      if (
        current.status !== result.status ||
        current.summary !== result.summary ||
        JSON.stringify(current.outputs) !== JSON.stringify(result.outputs)
      ) {
        this.diagnostic(
          "LATE_TERMINAL_CONFLICT",
          result.delegationId,
          `ignored conflicting ${result.status} result`,
        );
      }
      return;
    }
    if (result.revision <= current.revision) {
      this.diagnostic(
        "STALE_REMOTE_RESULT",
        result.delegationId,
        `ignored revision ${result.revision} after ${current.revision}`,
      );
      return;
    }
    this.#db
      .prepare(
        `
        UPDATE local_delegations SET status = ?, revision = ?, summary = ?,
          outputs_json = ?, error_code = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(
        result.status,
        result.revision,
        result.summary,
        JSON.stringify(result.outputs),
        result.errorCode ?? null,
        result.completedAt,
        result.completedAt,
        result.delegationId,
      );
  }

  createTodos(delegationId: string, todos: HumanTodo[]): void {
    this.transaction(() => {
      for (const todo of todos) {
        const parsed = humanTodoSchema.parse(todo);
        this.#db
          .prepare(
            `
            INSERT INTO human_todos(
              id, delegation_id, title, instructions, blocking_reason,
              status, human_response, attachment_refs_json, created_at, resolved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          )
          .run(
            parsed.id,
            parsed.delegationId,
            parsed.title,
            parsed.instructions ?? null,
            parsed.blockingReason,
            parsed.status,
            parsed.humanResponse ?? null,
            JSON.stringify(parsed.attachmentRefs),
            parsed.createdAt,
            parsed.resolvedAt ?? null,
          );
      }
    });
  }

  handoff(
    delegationId: string,
    todos: HumanTodo[],
    summary: string,
  ): DelegationRecord {
    return this.transaction(() => {
      const current = this.getDelegation(delegationId);
      if (current === undefined)
        throw new Error(`unknown delegation ${delegationId}`);
      assertTransition(current.status, "WAITING_HUMAN");
      for (const todo of todos) {
        const parsed = humanTodoSchema.parse(todo);
        this.#db
          .prepare(
            `
          INSERT INTO human_todos(
            id, delegation_id, title, instructions, blocking_reason,
            status, human_response, attachment_refs_json, created_at, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            parsed.id,
            parsed.delegationId,
            parsed.title,
            parsed.instructions ?? null,
            parsed.blockingReason,
            parsed.status,
            parsed.humanResponse ?? null,
            JSON.stringify(parsed.attachmentRefs),
            parsed.createdAt,
            parsed.resolvedAt ?? null,
          );
      }
      const now = new Date().toISOString();
      this.#db
        .prepare(
          `
        UPDATE local_delegations
        SET status = 'WAITING_HUMAN', revision = revision + 1,
            summary = ?, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(summary, now, delegationId);
      const updated = this.getDelegation(delegationId);
      if (updated === undefined)
        throw new Error(`delegation ${delegationId} disappeared`);
      return updated;
    });
  }

  resolveTodosAndMaybeResume(
    delegationId: string,
    input: HumanInput,
  ): { delegation: DelegationRecord; resumed: boolean } {
    return this.transaction(() => {
      const current = this.getDelegation(delegationId);
      if (
        current === undefined ||
        current.direction !== "INCOMING" ||
        current.status !== "WAITING_HUMAN"
      ) {
        throw new Error(
          `delegation ${delegationId} is not waiting for human input`,
        );
      }
      const open = new Set(
        current.todos
          .filter((todo) => todo.status === "OPEN")
          .map((todo) => todo.id),
      );
      if (input.todoIds.some((id) => !open.has(id))) {
        throw new Error(
          "todoIds must identify open HumanTodo items in this delegation",
        );
      }
      const now = new Date().toISOString();
      const update = this.#db.prepare(`
        UPDATE human_todos
        SET status = 'DONE', human_response = ?, attachment_refs_json = ?, resolved_at = ?
        WHERE id = ? AND delegation_id = ? AND status = 'OPEN'
      `);
      let changed = 0;
      for (const todoId of input.todoIds) {
        changed += Number(
          update.run(
            input.response?.trim() || null,
            JSON.stringify(input.attachmentRefs),
            now,
            todoId,
            delegationId,
          ).changes,
        );
      }
      if (changed !== input.todoIds.length) {
        throw new Error(
          "HumanTodo state changed concurrently; reload before submitting",
        );
      }
      const row = this.#db
        .prepare(
          "SELECT count(*) AS count FROM human_todos WHERE delegation_id = ? AND status = 'OPEN'",
        )
        .get(delegationId) as SqlRow;
      const resumed = Number(row.count) === 0;
      if (resumed) {
        if (current.sessionId === undefined) {
          throw new Error("original DSH session is unavailable");
        }
        assertTransition(current.status, "RUNNING");
        this.#db
          .prepare(
            `
          UPDATE local_delegations
          SET status = 'RUNNING', revision = revision + 1,
              summary = 'Resumed after local human input.', updated_at = ?
          WHERE id = ?
        `,
          )
          .run(now, delegationId);
      } else {
        this.#db
          .prepare("UPDATE local_delegations SET updated_at = ? WHERE id = ?")
          .run(now, delegationId);
      }
      const delegation = this.getDelegation(delegationId);
      if (delegation === undefined)
        throw new Error(`delegation ${delegationId} disappeared`);
      return { delegation, resumed };
    });
  }

  dismissTodos(delegationId: string): void {
    this.#db
      .prepare(
        `
        UPDATE human_todos SET status = 'DISMISSED', resolved_at = ?
        WHERE delegation_id = ? AND status = 'OPEN'
      `,
      )
      .run(new Date().toISOString(), delegationId);
  }

  enqueue(envelope: Envelope, digest: string): void {
    const parsed = envelopeSchema.parse(envelope);
    this.insertOutboxUnsafe(parsed, digest, new Date().toISOString());
  }

  private insertOutboxUnsafe(
    envelope: Envelope,
    digest: string,
    now: string,
  ): void {
    const existing = this.#db
      .prepare("SELECT digest FROM local_outbox WHERE envelope_id = ?")
      .get(envelope.envelopeId) as SqlRow | undefined;
    if (existing !== undefined) {
      if (existing.digest !== digest) {
        throw new Error(`outbox envelope ${envelope.envelopeId} conflicts`);
      }
      return;
    }
    this.#db
      .prepare(
        "INSERT INTO local_outbox(envelope_id, envelope_json, digest, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(envelope.envelopeId, JSON.stringify(envelope), digest, now, now);
  }

  pendingEnvelopes(limit = 100): PendingEnvelope[] {
    return (
      this.#db
        .prepare(
          "SELECT envelope_json, attempts, last_error FROM local_outbox WHERE delivered_at IS NULL AND next_attempt_at <= ? ORDER BY next_attempt_at, created_at LIMIT ?",
        )
        .all(new Date().toISOString(), limit) as SqlRow[]
    ).map((row) => {
      const lastError = optionalString(row.last_error);
      return {
        envelope: parseJson(row.envelope_json, (input) =>
          envelopeSchema.parse(input),
        ),
        attempts: Number(row.attempts),
        ...(lastError === undefined ? {} : { lastError }),
      };
    });
  }

  outboxDiagnostics(): OutboxDiagnostics {
    const row = this.#db
      .prepare(
        `
        SELECT count(*) AS pending,
               sum(CASE WHEN attempts > 0 THEN 1 ELSE 0 END) AS retrying,
               min(next_attempt_at) AS next_attempt_at
        FROM local_outbox WHERE delivered_at IS NULL
      `,
      )
      .get() as SqlRow;
    const lastErrorRow = this.#db
      .prepare(
        `
        SELECT last_error FROM local_outbox
        WHERE delivered_at IS NULL AND last_error IS NOT NULL
        ORDER BY next_attempt_at DESC, created_at DESC LIMIT 1
      `,
      )
      .get() as SqlRow | undefined;
    const nextAttemptAt = optionalString(row.next_attempt_at);
    const lastError = optionalString(lastErrorRow?.last_error);
    return {
      pending: Number(row.pending ?? 0),
      retrying: Number(row.retrying ?? 0),
      ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
      ...(lastError === undefined ? {} : { lastError }),
    };
  }

  markEnvelopeDelivered(
    envelopeId: string,
    deliveryStatus: Extract<
      DeliveryStatus,
      "STORED_BY_RELAY" | "RECEIVED_BY_NODE"
    >,
  ): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.#db
        .prepare(
          "UPDATE local_outbox SET delivered_at = ?, last_error = NULL WHERE envelope_id = ?",
        )
        .run(now, envelopeId);
      this.#db
        .prepare(
          "UPDATE local_delegations SET delivery_status = ?, updated_at = ? WHERE request_envelope_id = ?",
        )
        .run(deliveryStatus, now, envelopeId);
    });
  }

  markEnvelopeAttemptFailed(
    envelopeId: string,
    error: unknown,
    options: {
      retryAfterMs?: number;
      deliveryStatus?: Extract<
        DeliveryStatus,
        "QUEUED_LOCAL" | "WAITING_FOR_PEER"
      >;
    } = {},
  ): void {
    const row = this.#db
      .prepare(
        "SELECT attempts FROM local_outbox WHERE envelope_id = ? AND delivered_at IS NULL",
      )
      .get(envelopeId) as SqlRow | undefined;
    if (row === undefined) return;
    const delayMs =
      options.retryAfterMs ??
      Math.min(5 * 60_000, 1_000 * 2 ** Math.min(8, Number(row.attempts)));
    const now = new Date();
    this.transaction(() => {
      this.#db
        .prepare(
          "UPDATE local_outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE envelope_id = ?",
        )
        .run(
          redactError(error),
          new Date(now.getTime() + delayMs).toISOString(),
          envelopeId,
        );
      if (options.deliveryStatus !== undefined) {
        this.#db
          .prepare(
            "UPDATE local_delegations SET delivery_status = ?, updated_at = ? WHERE request_envelope_id = ? AND direction = 'OUTGOING' AND status = 'QUEUED'",
          )
          .run(options.deliveryStatus, now.toISOString(), envelopeId);
      }
    });
  }

  expireEnvelope(envelopeId: string): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.#db
        .prepare(
          "UPDATE local_outbox SET delivered_at = ?, last_error = 'delivery envelope expired' WHERE envelope_id = ? AND delivered_at IS NULL",
        )
        .run(now, envelopeId);
      this.#db
        .prepare(
          `
          UPDATE local_delegations SET
            status = 'FAILED', delivery_status = 'DELIVERY_EXPIRED',
            revision = revision + 1, summary = 'Delivery expired before the receiving Node acknowledged the task.',
            error_code = 'DELIVERY_EXPIRED', updated_at = ?, completed_at = ?
          WHERE request_envelope_id = ? AND direction = 'OUTGOING' AND status = 'QUEUED'
        `,
        )
        .run(now, now, envelopeId);
    });
  }

  retryEnvelopeNow(envelopeId: string): void {
    this.#db
      .prepare(
        "UPDATE local_outbox SET next_attempt_at = ?, last_error = NULL WHERE envelope_id = ? AND delivered_at IS NULL",
      )
      .run(new Date().toISOString(), envelopeId);
  }

  discardPendingEnvelope(envelopeId: string): void {
    this.#db
      .prepare(
        "DELETE FROM local_outbox WHERE envelope_id = ? AND delivered_at IS NULL",
      )
      .run(envelopeId);
  }

  mailboxCursor(relayUrl: string): number {
    const row = this.#db
      .prepare("SELECT cursor FROM mailbox_cursors WHERE relay_url = ?")
      .get(relayUrl) as SqlRow | undefined;
    return row === undefined ? 0 : Number(row.cursor);
  }

  advanceMailboxCursor(relayUrl: string, cursor: number): void {
    const current = this.mailboxCursor(relayUrl);
    if (cursor < current)
      throw new Error("mailbox cursor cannot move backwards");
    this.#db
      .prepare(
        `
        INSERT INTO mailbox_cursors(relay_url, cursor, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(relay_url) DO UPDATE SET
          cursor = max(mailbox_cursors.cursor, excluded.cursor),
          updated_at = excluded.updated_at
      `,
      )
      .run(relayUrl, cursor, new Date().toISOString());
  }

  interruptedExecutions(): DelegationRecord[] {
    return (
      this.#db
        .prepare(
          "SELECT * FROM local_delegations WHERE direction = 'INCOMING' AND status = 'RUNNING'",
        )
        .all() as SqlRow[]
    ).map((row) => this.delegationFromRow(row));
  }

  diagnostic(
    code: string,
    delegationId: string | undefined,
    detail: string,
  ): void {
    this.#db
      .prepare(
        "INSERT INTO diagnostics(code, delegation_id, detail, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        code,
        delegationId ?? null,
        redactError(detail),
        new Date().toISOString(),
      );
  }
}
