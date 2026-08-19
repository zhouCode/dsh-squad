import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import type {
  ClientContext,
  SessionId,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { LocaleId } from "@deepseek-ai/dsh-client-locale/client";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import type { SidebarFooterActionOwnerProps } from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type { TeamPlan, TeamPlanStatus } from "../shared/contracts.ts";
import type {
  AutomationRuleInput,
  AutomationRuleView,
} from "../shared/automation.ts";
import type {
  OrganizationInvitationView,
  OrganizationView,
} from "../shared/organizations.ts";
import {
  summarizeAttention,
  type SquadConnectionDiagnostics,
  type DelegationStatus,
  type SquadAttentionSummary,
} from "../shared/state.ts";
import type { UpdateMode, UpdateSnapshot } from "../shared/updates.ts";
import {
  parseAttachmentDrafts,
  type AttachmentDraft,
  type AttachmentDraftError,
} from "./human-input.ts";
import {
  buildTeamPlanUpdate,
  draftFromTeamPlan,
  type TeamPlanDraft,
  type TeamPlanDraftItem,
} from "./team-plan.ts";
import {
  SQUAD_LOCALE_NS,
  en,
  formatConnectionStatus,
  formatDelivery,
  formatErrorCode,
  formatOrganizationRole,
  formatOrganizationInvitationStatus,
  formatOrganizationStatus,
  formatPlanItemStatus,
  formatPlanStatus,
  formatPolicy,
  formatStatus,
  formatSummary,
  formatUpdateMode,
  formatUpdatePhase,
  zh,
  type SquadLocaleKey,
  type SquadTranslate,
} from "./locales.ts";
import "@deepseek-ai/dsh-client-ui-layout/client";
import "@deepseek-ai/dsh-client-ui-sidebar/client";

type Status = DelegationStatus;

interface TodoView {
  id: string;
  title: string;
  instructions?: string;
  blockingReason: string;
  status: "OPEN" | "DONE" | "DISMISSED";
  attachmentRefs: AttachmentRefView[];
}

interface AttachmentRefView {
  url: string;
  sha256: string;
  size: number;
  name: string;
}

interface DelegationView {
  id: string;
  direction: "INCOMING" | "OUTGOING";
  peerNodeId: string;
  objective: string;
  context?: string;
  acceptanceCriteria: string[];
  status: Status;
  revision: number;
  deliveryStatus: string;
  deliveryAttempts: number;
  lastDeliveryError?: string;
  nextDeliveryAttemptAt?: string;
  sessionId?: string;
  summary?: string;
  outputs: Array<
    | { type: "text"; content: string }
    | { type: "link"; name: string; url: string; sha256?: string }
  >;
  errorCode?: string;
  updatedAt: string;
  todos: TodoView[];
}

interface PeerView {
  nodeId: string;
  displayName: string;
  publicKey: string;
  enabled: boolean;
  transport: "RELAY" | "DIRECT";
  directUrl?: string;
  policy: {
    canMessage: boolean;
    canDelegate: boolean;
    autoExecute: "NEVER" | "SAFE" | "TRUSTED";
    maxConcurrent: number;
    maxDelegationDepth: number;
    maxRuntimeMinutes: number;
    maxTokens?: number;
  };
}

interface LocalState {
  setup: {
    required: boolean;
    mode?: "RELAY" | "DIRECT";
    source: "UNCONFIGURED" | "FILE" | "INTERFACE" | "EXISTING_DATA";
  };
  identity: { nodeId: string; displayName: string; publicKey: string };
  relay: { configured: boolean; serving: boolean; url?: string };
  direct: { serving: boolean; publicUrl?: string };
  automation: {
    rules: AutomationRuleView[];
    legacyPrefixCount: number;
  };
  peers: PeerView[];
  organizations: OrganizationView[];
  sessionOrganizations: Record<string, string>;
  revision: number;
  plans: TeamPlan[];
  delegations: DelegationView[];
  updates: UpdateSnapshot;
  connection: SquadConnectionDiagnostics;
}

let panelOpen = false;
const panelListeners = new Set<() => void>();

function setPanelOpen(value: boolean): void {
  if (panelOpen === value) return;
  panelOpen = value;
  for (const listener of panelListeners) listener();
}

function subscribePanel(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => panelListeners.delete(listener);
}

function usePanelOpen(): boolean {
  return useSyncExternalStore(
    subscribePanel,
    () => panelOpen,
    () => false,
  );
}

class SquadApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/squad/v1/local${path}`, {
    ...init,
    headers: {
      ...(init?.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new SquadApiError(
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.message ?? body.error?.code ?? "",
    );
  }
  return body;
}

let attentionSnapshot: SquadAttentionSummary | undefined;
let attentionEvents: EventSource | undefined;
let attentionRefresh: Promise<void> | undefined;
let attentionRefreshQueued = false;
const attentionListeners = new Set<() => void>();

function emitAttention(): void {
  for (const listener of attentionListeners) listener();
}

async function refreshAttention(): Promise<void> {
  if (attentionRefresh !== undefined) {
    attentionRefreshQueued = true;
    return attentionRefresh;
  }
  attentionRefresh = (async () => {
    do {
      attentionRefreshQueued = false;
      try {
        const next = await api<SquadAttentionSummary>("/attention");
        if (
          attentionSnapshot === undefined ||
          next.revision >= attentionSnapshot.revision
        ) {
          attentionSnapshot = next;
          emitAttention();
        }
      } catch {
        // The open panel surfaces connection errors; keep the last badge here.
      }
    } while (attentionRefreshQueued);
  })().finally(() => {
    attentionRefresh = undefined;
  });
  return attentionRefresh;
}

function startAttentionEvents(): void {
  if (attentionEvents !== undefined) return;
  void refreshAttention();
  attentionEvents = new EventSource("/squad/v1/local/events");
  attentionEvents.addEventListener("state", () => void refreshAttention());
}

function subscribeAttention(listener: () => void): () => void {
  attentionListeners.add(listener);
  startAttentionEvents();
  return () => attentionListeners.delete(listener);
}

function useAttentionSummary(): SquadAttentionSummary | undefined {
  return useSyncExternalStore(
    subscribeAttention,
    () => attentionSnapshot,
    () => undefined,
  );
}

function describeError(
  cause: unknown,
  t: SquadTranslate,
  fallback: SquadLocaleKey,
): string {
  if (cause instanceof SquadApiError) {
    const localized = formatErrorCode(t, cause.code);
    const detail =
      localized === cause.code ? cause.message || cause.code : localized;
    return t("error.withDetail", { message: t(fallback), detail });
  }
  return cause instanceof Error ? cause.message : t(fallback);
}

interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

interface PendingConfirmation extends ConfirmationOptions {
  resolve: (confirmed: boolean) => void;
}

function ConfirmationDialog({
  request,
  settle,
  t,
}: {
  request: PendingConfirmation;
  settle: (confirmed: boolean) => void;
  t: SquadTranslate;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      settle(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]",
      ) ?? []),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return (
    <div
      className="squad-confirm-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) settle(false);
      }}
    >
      <div
        ref={dialog}
        className="squad-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title}
        onKeyDown={onKeyDown}
      >
        <h2>{request.title}</h2>
        <p>{request.message}</p>
        <div className="squad-actions">
          <button
            ref={cancel}
            type="button"
            className="squad-secondary"
            onClick={() => settle(false)}
          >
            {t("action.cancel")}
          </button>
          <button
            type="button"
            className={request.danger ? "squad-danger" : ""}
            onClick={() => settle(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function useConfirmation(t: SquadTranslate): {
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
  confirmation: ReactElement | null;
} {
  const [request, setRequest] = useState<PendingConfirmation>();
  const active = useRef<PendingConfirmation>();
  const confirm = useCallback(
    (options: ConfirmationOptions) =>
      new Promise<boolean>((resolve) => {
        active.current?.resolve(false);
        const next = { ...options, resolve };
        active.current = next;
        setRequest(next);
      }),
    [],
  );
  const settle = useCallback((confirmed: boolean) => {
    const current = active.current;
    active.current = undefined;
    setRequest(undefined);
    current?.resolve(confirmed);
  }, []);
  useEffect(
    () => () => {
      active.current?.resolve(false);
      active.current = undefined;
    },
    [],
  );
  return {
    confirm,
    confirmation:
      request === undefined ? null : (
        <ConfirmationDialog request={request} settle={settle} t={t} />
      ),
  };
}

let attachmentDraftSequence = 0;

function createAttachmentDraft(): AttachmentDraft {
  attachmentDraftSequence += 1;
  return {
    id: `attachment-${attachmentDraftSequence}`,
    url: "",
    sha256: "",
    size: "",
    name: "",
  };
}

function describeAttachmentDraftError(
  t: SquadTranslate,
  error: AttachmentDraftError,
  row?: number,
): string {
  const keys: Record<AttachmentDraftError, SquadLocaleKey> = {
    TOO_MANY: "error.attachmentTooMany",
    INCOMPLETE: "error.attachmentIncomplete",
    INVALID_URL: "error.attachmentUrl",
    HTTPS_REQUIRED: "error.attachmentHttps",
    INVALID_SHA256: "error.attachmentSha256",
    INVALID_SIZE: "error.attachmentSize",
    INVALID_NAME: "error.attachmentName",
  };
  return t(keys[error], { row: row ?? "—" });
}

function AttachmentDraftEditor({
  drafts,
  disabled,
  onChange,
  t,
}: {
  drafts: AttachmentDraft[];
  disabled?: boolean;
  onChange: (drafts: AttachmentDraft[]) => void;
  t: SquadTranslate;
}) {
  const update = (
    draftId: string,
    field: Exclude<keyof AttachmentDraft, "id">,
    value: string,
  ) => {
    onChange(
      drafts.map((draft) =>
        draft.id === draftId ? { ...draft, [field]: value } : draft,
      ),
    );
  };
  return (
    <div className="squad-attachment-editor">
      <header>
        <div>
          <strong>{t("humanTodo.attachments")}</strong>
          <small>{t("humanTodo.attachmentHint")}</small>
        </div>
        <button
          type="button"
          className="squad-secondary"
          disabled={disabled || drafts.length >= 10}
          onClick={() => onChange([...drafts, createAttachmentDraft()])}
        >
          {t("action.addAttachment")}
        </button>
      </header>
      {drafts.length === 0 ? (
        <p className="squad-muted">{t("humanTodo.noAttachments")}</p>
      ) : null}
      {drafts.map((draft, index) => (
        <fieldset key={draft.id}>
          <legend>
            {t("humanTodo.attachmentNumber", { number: index + 1 })}
          </legend>
          <div className="squad-attachment-fields">
            <label>
              {t("field.attachmentUrl")}
              <input
                type="url"
                required
                value={draft.url}
                placeholder="https://…"
                onChange={(event) =>
                  update(draft.id, "url", event.currentTarget.value)
                }
              />
            </label>
            <label>
              {t("field.attachmentName")}
              <input
                required
                maxLength={240}
                value={draft.name}
                onChange={(event) =>
                  update(draft.id, "name", event.currentTarget.value)
                }
              />
            </label>
            <label>
              {t("field.attachmentSha256")}
              <input
                required
                pattern="[a-fA-F0-9]{64}"
                maxLength={64}
                value={draft.sha256}
                onChange={(event) =>
                  update(draft.id, "sha256", event.currentTarget.value)
                }
              />
            </label>
            <label>
              {t("field.attachmentSize")}
              <input
                type="number"
                required
                min={0}
                max={25 * 1024 * 1024}
                step={1}
                value={draft.size}
                onChange={(event) =>
                  update(draft.id, "size", event.currentTarget.value)
                }
              />
            </label>
          </div>
          <button
            type="button"
            className="squad-link-button squad-danger-text"
            disabled={disabled}
            onClick={() =>
              onChange(drafts.filter((candidate) => candidate.id !== draft.id))
            }
          >
            {t("action.removeAttachment")}
          </button>
        </fieldset>
      ))}
    </div>
  );
}

function SquadTrigger({
  wide,
  t,
}: SidebarFooterActionOwnerProps & PropsLocale<typeof SQUAD_LOCALE_NS>) {
  const open = usePanelOpen();
  const attention = useAttentionSummary();
  const badge = attention?.setupRequired ? "!" : attention?.total;
  const label =
    typeof badge === "number" && badge > 0
      ? t("inbox.attentionLabel", { count: badge })
      : t("inbox.title");
  return (
    <button
      className={`squad-trigger ${wide ? "squad-trigger-wide" : ""}`}
      type="button"
      aria-label={label}
      aria-expanded={open}
      title={t("inbox.title")}
      lang={t("html.lang")}
      onClick={() => setPanelOpen(!open)}
    >
      <span className="squad-trigger-icon" aria-hidden="true">
        ⇄
      </span>
      {wide ? <span>{t("inbox.title")}</span> : null}
      {badge === "!" || (typeof badge === "number" && badge > 0) ? (
        <span className="squad-trigger-badge" aria-hidden="true">
          {typeof badge === "number" && badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

type Tab =
  | "overview"
  | "plans"
  | "waiting"
  | "running"
  | "sent"
  | "completed"
  | "organizations"
  | "diagnostics"
  | "updates"
  | "settings";

const tabKeys = {
  overview: "tab.overview",
  plans: "tab.plans",
  waiting: "tab.waiting",
  running: "tab.running",
  sent: "tab.sent",
  completed: "tab.completed",
  organizations: "tab.organizations",
  diagnostics: "tab.diagnostics",
  updates: "tab.updates",
  settings: "tab.settings",
} as const satisfies Record<Tab, SquadLocaleKey>;

const tabGroups: readonly {
  label: SquadLocaleKey;
  tabs: readonly Tab[];
}[] = [
  {
    label: "nav.work",
    tabs: ["overview", "waiting", "running", "sent", "completed", "plans"],
  },
  { label: "nav.team", tabs: ["organizations"] },
  { label: "nav.system", tabs: ["diagnostics", "updates", "settings"] },
];

function localAttention(state: LocalState): SquadAttentionSummary {
  return summarizeAttention({
    revision: state.revision,
    setupRequired: state.setup.required,
    delegations: state.delegations,
    plans: state.plans,
    organizations: state.organizations,
    updateAvailable: state.updates.status.available === true,
  });
}

function Overview({
  state,
  navigate,
  t,
}: {
  state: LocalState;
  navigate: (tab: Tab) => void;
  t: SquadTranslate;
}) {
  const summary = localAttention(state);
  const hasActiveOrganization = state.organizations.some(
    (organization) => organization.membershipStatus === "ACTIVE",
  );
  const hasRecipient =
    state.peers.some((peer) => peer.enabled) ||
    state.organizations.some((organization) =>
      organization.members.some(
        (member) => !member.isSelf && member.status === "ACTIVE",
      ),
    );
  const prompt = t("overview.examplePrompt");
  const nextStep = !hasRecipient
    ? state.relay.configured && !hasActiveOrganization
      ? {
          title: t("overview.nextOrganization"),
          detail: t("overview.nextOrganizationHint"),
          action: t("overview.openOrganizations"),
          tab: "organizations" as const,
        }
      : {
          title: t("overview.nextPeer"),
          detail: t("overview.nextPeerHint"),
          action: t("overview.openPeers"),
          tab: "settings" as const,
        }
    : undefined;
  const cards: Array<{
    key: string;
    value: number;
    label: SquadLocaleKey;
    tab: Tab;
  }> = [
    {
      key: "waiting",
      value: summary.waitingHuman,
      label: "overview.waitingHuman",
      tab: "waiting",
    },
    {
      key: "failed",
      value: summary.failedOutgoing,
      label: "overview.failedOutgoing",
      tab: "completed",
    },
    {
      key: "joins",
      value: summary.pendingJoinRequests,
      label: "overview.pendingJoins",
      tab: "organizations",
    },
    {
      key: "plans",
      value: summary.draftPlans,
      label: "overview.draftPlans",
      tab: "plans",
    },
  ];
  return (
    <main className="squad-overview">
      <header>
        <span className="squad-eyebrow">DSH Squad</span>
        <h2>{t("overview.title")}</h2>
        <p className="squad-muted">{t("overview.intro")}</p>
      </header>
      <section
        className="squad-attention-grid"
        aria-label={t("overview.attention")}
      >
        {cards.map((card) => (
          <button
            key={card.key}
            className={card.value > 0 ? "needs-attention" : ""}
            onClick={() => navigate(card.tab)}
          >
            <strong>{card.value}</strong>
            <span>{t(card.label)}</span>
          </button>
        ))}
      </section>
      {summary.total === 0 ? (
        <p className="squad-notice">{t("overview.allClear")}</p>
      ) : null}
      {summary.updateAvailable ? (
        <button
          className="squad-update-callout"
          onClick={() => navigate("updates")}
        >
          {t("overview.updateAvailable")}
        </button>
      ) : null}
      {nextStep ? (
        <section className="squad-next-step">
          <h3>{nextStep.title}</h3>
          <p>{nextStep.detail}</p>
          <button onClick={() => navigate(nextStep.tab)}>
            {nextStep.action}
          </button>
        </section>
      ) : (
        <section className="squad-next-step">
          <h3>{t("overview.tryDelegation")}</h3>
          <p>{t("overview.tryDelegationHint")}</p>
          <code>{prompt}</code>
          <button onClick={() => void navigator.clipboard?.writeText(prompt)}>
            {t("action.copyPrompt")}
          </button>
        </section>
      )}
    </main>
  );
}

function belongs(tab: Tab, item: DelegationView): boolean {
  if (tab === "waiting") {
    return item.direction === "INCOMING" && item.status === "WAITING_HUMAN";
  }
  if (tab === "running") {
    return (
      item.direction === "INCOMING" &&
      ["RECEIVED", "TRIAGING", "RUNNING"].includes(item.status)
    );
  }
  if (tab === "sent") {
    return (
      item.direction === "OUTGOING" &&
      !["COMPLETED", "REJECTED", "FAILED", "CANCELED"].includes(item.status)
    );
  }
  if (tab === "completed") {
    return ["COMPLETED", "REJECTED", "FAILED", "CANCELED"].includes(
      item.status,
    );
  }
  return false;
}

function StatusPill({ status, t }: { status: Status; t: SquadTranslate }) {
  return (
    <span className={`squad-status squad-status-${status.toLowerCase()}`}>
      {formatStatus(t, status)}
    </span>
  );
}

function PlanStatusPill({
  status,
  t,
}: {
  status: TeamPlanStatus;
  t: SquadTranslate;
}) {
  return (
    <span className={`squad-status squad-plan-status-${status.toLowerCase()}`}>
      {formatPlanStatus(t, status)}
    </span>
  );
}

function DelegationDetail({
  item,
  refresh,
  openSession,
  t,
}: {
  item: DelegationView;
  refresh: () => Promise<void>;
  openSession: (id: string) => void;
  t: SquadTranslate;
}) {
  const [todoResponses, setTodoResponses] = useState<Record<string, string>>(
    {},
  );
  const [todoAttachments, setTodoAttachments] = useState<
    Record<string, AttachmentDraft[]>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { confirm, confirmation } = useConfirmation(t);

  const act = async (action: string, body: unknown = {}): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/delegations/${item.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refresh();
      return true;
    } catch (cause) {
      setError(describeError(cause, t, "error.actionFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openTodos = item.todos.filter((todo) => todo.status === "OPEN");
  useEffect(() => {
    setTodoResponses({});
    setTodoAttachments({});
  }, [item.id]);
  const submitHumanInput = async (todoId: string, todoTitle: string) => {
    const response = todoResponses[todoId]?.trim() ?? "";
    const parsedAttachments = parseAttachmentDrafts(
      todoAttachments[todoId] ?? [],
    );
    if (!parsedAttachments.ok) {
      setError(
        describeAttachmentDraftError(
          t,
          parsedAttachments.error,
          parsedAttachments.row,
        ),
      );
      return;
    }
    if (response.length === 0 && parsedAttachments.refs.length === 0) {
      setError(t("error.humanInputRequired"));
      return;
    }
    if (
      !(await confirm({
        title: t("confirm.resumeTaskTitle"),
        message: t("confirm.resumeTodo", {
          todo: todoTitle,
          objective: item.objective,
        }),
        confirmLabel: t("action.submitTodo"),
      }))
    ) {
      return;
    }
    if (
      await act("human-input", {
        todoIds: [todoId],
        ...(response ? { response } : {}),
        attachmentRefs: parsedAttachments.refs,
      })
    ) {
      setTodoResponses((current) => {
        const next = { ...current };
        delete next[todoId];
        return next;
      });
      setTodoAttachments((current) => {
        const next = { ...current };
        delete next[todoId];
        return next;
      });
    }
  };
  const awaitingAcceptance =
    item.status === "WAITING_HUMAN" && openTodos.length === 0;
  const accept = async () => {
    if (
      await confirm({
        title: t("confirm.acceptTaskTitle"),
        message: t("confirm.acceptTask", { objective: item.objective }),
        confirmLabel: t("action.acceptAndRun"),
      })
    ) {
      await act("accept");
    }
  };
  const reject = async () => {
    if (
      await confirm({
        title: t("confirm.rejectTitle"),
        message: t("confirm.rejectDelegation", { objective: item.objective }),
        confirmLabel: t("action.reject"),
        danger: true,
      })
    ) {
      await act("reject");
    }
  };
  const requestCancel = async () => {
    if (
      await confirm({
        title: t("confirm.cancelDelegationTitle"),
        message: t("confirm.cancelDelegation", { objective: item.objective }),
        confirmLabel: t("action.requestCancel"),
        danger: true,
      })
    ) {
      await act("cancel");
    }
  };
  return (
    <article className="squad-detail">
      <header>
        <StatusPill status={item.status} t={t} />
        <span className="squad-direction">
          {item.direction === "INCOMING"
            ? t("direction.received")
            : t("direction.sent")}
        </span>
      </header>
      <h2>{item.objective}</h2>
      <dl>
        <div>
          <dt>{t("field.peer")}</dt>
          <dd>{item.peerNodeId}</dd>
        </div>
        <div>
          <dt>{t("field.delivery")}</dt>
          <dd>{formatDelivery(t, item.deliveryStatus)}</dd>
        </div>
        {item.deliveryAttempts > 0 ? (
          <div>
            <dt>{t("field.deliveryAttempts")}</dt>
            <dd>{item.deliveryAttempts}</dd>
          </div>
        ) : null}
        {item.nextDeliveryAttemptAt &&
        ["QUEUED_LOCAL", "WAITING_FOR_PEER"].includes(item.deliveryStatus) ? (
          <div>
            <dt>{t("field.nextDeliveryAttempt")}</dt>
            <dd>{new Date(item.nextDeliveryAttemptAt).toLocaleString()}</dd>
          </div>
        ) : null}
      </dl>
      {item.lastDeliveryError &&
      ["QUEUED_LOCAL", "WAITING_FOR_PEER"].includes(item.deliveryStatus) ? (
        <p className="squad-muted">
          {t("field.lastDeliveryError")}: {item.lastDeliveryError}
        </p>
      ) : null}
      {item.context ? (
        <section>
          <h3>{t("field.context")}</h3>
          <p className="squad-prewrap">{item.context}</p>
        </section>
      ) : null}
      {item.acceptanceCriteria.length > 0 ? (
        <section>
          <h3>{t("field.acceptanceCriteria")}</h3>
          <ul>
            {item.acceptanceCriteria.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {item.summary ? (
        <section>
          <h3>{t("field.shareableSummary")}</h3>
          <p className="squad-prewrap">{formatSummary(t, item.summary)}</p>
        </section>
      ) : null}
      {item.errorCode ? (
        <p className="squad-error">{formatErrorCode(t, item.errorCode)}</p>
      ) : null}
      {openTodos.length > 0 ? (
        <section>
          <h3>{t("field.waitingForMe")}</h3>
          <p className="squad-muted">{t("humanTodo.oneAtATime")}</p>
          {openTodos.map((todo) => {
            const response = todoResponses[todo.id] ?? "";
            const attachments = todoAttachments[todo.id] ?? [];
            return (
              <form
                className="squad-todo"
                key={todo.id}
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitHumanInput(todo.id, todo.title);
                }}
              >
                <header>
                  <strong>{todo.title}</strong>
                </header>
                <p>{todo.blockingReason}</p>
                {todo.instructions ? <p>{todo.instructions}</p> : null}
                <label>
                  {t("field.response")}
                  <textarea
                    value={response}
                    rows={4}
                    maxLength={50_000}
                    placeholder={t("humanTodo.responsePlaceholder")}
                    onChange={(event) =>
                      setTodoResponses((current) => ({
                        ...current,
                        [todo.id]: event.currentTarget.value,
                      }))
                    }
                  />
                </label>
                <AttachmentDraftEditor
                  drafts={attachments}
                  disabled={busy}
                  onChange={(next) =>
                    setTodoAttachments((current) => ({
                      ...current,
                      [todo.id]: next,
                    }))
                  }
                  t={t}
                />
                <button
                  type="submit"
                  disabled={
                    busy || (!response.trim() && attachments.length === 0)
                  }
                >
                  {t("action.submitTodo")}
                </button>
              </form>
            );
          })}
          <div className="squad-actions">
            <button
              className="squad-danger"
              disabled={busy}
              onClick={() => void reject()}
            >
              {t("action.reject")}
            </button>
          </div>
        </section>
      ) : null}
      {awaitingAcceptance ? (
        <div className="squad-actions">
          <button disabled={busy} onClick={() => void accept()}>
            {t("action.acceptAndRun")}
          </button>
          <button
            className="squad-danger"
            disabled={busy}
            onClick={() => void reject()}
          >
            {t("action.reject")}
          </button>
        </div>
      ) : null}
      {item.direction === "OUTGOING" &&
      ["QUEUED_LOCAL", "WAITING_FOR_PEER"].includes(item.deliveryStatus) ? (
        <button disabled={busy} onClick={() => act("retry")}>
          {t("action.retryDelivery")}
        </button>
      ) : null}
      {!["COMPLETED", "REJECTED", "FAILED", "CANCELED"].includes(
        item.status,
      ) ? (
        <button
          className="squad-link-button"
          disabled={busy}
          onClick={() => void requestCancel()}
        >
          {t("action.requestCancel")}
        </button>
      ) : null}
      {item.sessionId ? (
        <button
          className="squad-link-button"
          onClick={() => openSession(item.sessionId!)}
        >
          {t("action.openSession")}
        </button>
      ) : null}
      {item.outputs.length > 0 ? (
        <section>
          <h3>{t("field.outputs")}</h3>
          {item.outputs.map((output, index) =>
            output.type === "text" ? (
              <p className="squad-prewrap" key={index}>
                {output.content}
              </p>
            ) : (
              <p key={index}>
                <a href={output.url} rel="noreferrer" target="_blank">
                  {output.name}
                </a>
              </p>
            ),
          )}
        </section>
      ) : null}
      {error ? <p className="squad-error">{error}</p> : null}
      {confirmation}
    </article>
  );
}

interface PlanRecipientOption {
  value: string;
  label: string;
}

let planDraftItemSequence = 0;

function createTeamPlanDraftItem(to: string): TeamPlanDraftItem {
  planDraftItemSequence += 1;
  return {
    key: `new-plan-item-${planDraftItemSequence}`,
    to,
    objective: "",
    context: "",
    acceptanceCriteria: "",
    attachments: [],
  };
}

function teamPlanRecipientOptions(
  plan: TeamPlan,
  state: LocalState,
): PlanRecipientOption[] {
  if (plan.organizationId !== undefined) {
    const organization = state.organizations.find(
      (candidate) => candidate.organizationId === plan.organizationId,
    );
    return (organization?.members ?? [])
      .filter(
        (member) =>
          !member.isSelf &&
          member.status === "ACTIVE" &&
          member.policy.canDelegate,
      )
      .map((member) => ({
        value: member.membershipId,
        label: member.displayName,
      }));
  }
  return state.peers
    .filter((peer) => peer.enabled && peer.policy.canDelegate)
    .map((peer) => ({ value: peer.nodeId, label: peer.displayName }));
}

function TeamPlanDraftEditor({
  plan,
  state,
  refresh,
  cancel,
  t,
}: {
  plan: TeamPlan;
  state: LocalState;
  refresh: () => Promise<void>;
  cancel: () => void;
  t: SquadTranslate;
}) {
  const [draft, setDraft] = useState<TeamPlanDraft>(() =>
    draftFromTeamPlan(plan),
  );
  const [baseRevision] = useState(plan.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const recipients = teamPlanRecipientOptions(plan, state);
  const updateItem = (
    key: string,
    update: (item: TeamPlanDraftItem) => TeamPlanDraftItem,
  ) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.key === key ? update(item) : item,
      ),
    }));
  };
  const moveItem = (index: number, offset: -1 | 1) => {
    setDraft((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.items.length) return current;
      const items = [...current.items];
      const [moved] = items.splice(index, 1);
      if (moved === undefined) return current;
      items.splice(target, 0, moved);
      return { ...current, items };
    });
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = buildTeamPlanUpdate(draft, baseRevision);
    if (!result.ok) {
      setError(
        t("error.planAttachment", {
          item: result.item,
          detail: describeAttachmentDraftError(
            t,
            result.error,
            result.attachmentRow,
          ),
        }),
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api<TeamPlan>(`/plans/${plan.id}`, {
        method: "POST",
        body: JSON.stringify(result.input),
      });
      await refresh();
      cancel();
    } catch (cause) {
      setError(describeError(cause, t, "error.planSaveFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="squad-plan-editor" onSubmit={(event) => void save(event)}>
      {plan.revision !== baseRevision ? (
        <p className="squad-warning">{t("plan.changedWhileEditing")}</p>
      ) : null}
      <label>
        {t("plan.title")}
        <input
          required
          maxLength={240}
          value={draft.title}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              title: event.currentTarget.value,
            }))
          }
        />
      </label>
      <label>
        {t("field.sourceSummary")}
        <textarea
          rows={4}
          maxLength={50_000}
          value={draft.sourceSummary}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              sourceSummary: event.currentTarget.value,
            }))
          }
        />
      </label>
      <div className="squad-plan-editor-items">
        {draft.items.map((item, index) => {
          const currentRecipient = recipients.some(
            (recipient) => recipient.value === item.to,
          )
            ? undefined
            : plan.items.find((candidate) => candidate.id === item.id);
          return (
            <fieldset className="squad-plan-editor-item" key={item.key}>
              <legend>{t("plan.itemNumber", { number: index + 1 })}</legend>
              <div className="squad-plan-editor-order">
                <button
                  type="button"
                  className="squad-secondary"
                  disabled={busy || index === 0}
                  aria-label={t("action.movePlanItemUp")}
                  onClick={() => moveItem(index, -1)}
                >
                  ↑ {t("action.moveUp")}
                </button>
                <button
                  type="button"
                  className="squad-secondary"
                  disabled={busy || index === draft.items.length - 1}
                  aria-label={t("action.movePlanItemDown")}
                  onClick={() => moveItem(index, 1)}
                >
                  ↓ {t("action.moveDown")}
                </button>
                <button
                  type="button"
                  className="squad-link-button squad-danger-text"
                  disabled={busy || draft.items.length === 1}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      items: current.items.filter(
                        (candidate) => candidate.key !== item.key,
                      ),
                    }))
                  }
                >
                  {t("action.removePlanItem")}
                </button>
              </div>
              <label>
                {t("field.peer")}
                <select
                  required
                  value={item.to}
                  onChange={(event) =>
                    updateItem(item.key, (current) => ({
                      ...current,
                      to: event.currentTarget.value,
                    }))
                  }
                >
                  {currentRecipient ? (
                    <option value={item.to}>
                      {t("plan.unavailableRecipient", {
                        name: currentRecipient.peerDisplayName,
                      })}
                    </option>
                  ) : null}
                  {recipients.map((recipient) => (
                    <option value={recipient.value} key={recipient.value}>
                      {recipient.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("plan.objective")}
                <textarea
                  required
                  rows={3}
                  maxLength={20_000}
                  value={item.objective}
                  onChange={(event) =>
                    updateItem(item.key, (current) => ({
                      ...current,
                      objective: event.currentTarget.value,
                    }))
                  }
                />
              </label>
              <label>
                {t("field.context")}
                <textarea
                  rows={4}
                  maxLength={100_000}
                  value={item.context}
                  onChange={(event) =>
                    updateItem(item.key, (current) => ({
                      ...current,
                      context: event.currentTarget.value,
                    }))
                  }
                />
              </label>
              <label>
                {t("field.acceptanceCriteria")}
                <textarea
                  rows={4}
                  value={item.acceptanceCriteria}
                  placeholder={t("plan.criteriaHint")}
                  onChange={(event) =>
                    updateItem(item.key, (current) => ({
                      ...current,
                      acceptanceCriteria: event.currentTarget.value,
                    }))
                  }
                />
              </label>
              <AttachmentDraftEditor
                drafts={item.attachments}
                disabled={busy}
                onChange={(attachments) =>
                  updateItem(item.key, (current) => ({
                    ...current,
                    attachments,
                  }))
                }
                t={t}
              />
            </fieldset>
          );
        })}
      </div>
      <button
        type="button"
        className="squad-secondary"
        disabled={busy || draft.items.length >= 32 || recipients.length === 0}
        onClick={() =>
          setDraft((current) => ({
            ...current,
            items: [
              ...current.items,
              createTeamPlanDraftItem(recipients[0]?.value ?? ""),
            ],
          }))
        }
      >
        {t("action.addPlanItem")}
      </button>
      {recipients.length === 0 ? (
        <p className="squad-warning">{t("plan.noRecipients")}</p>
      ) : null}
      <div className="squad-actions">
        <button disabled={busy || plan.revision !== baseRevision} type="submit">
          {busy ? t("action.saving") : t("action.savePlan")}
        </button>
        <button
          type="button"
          className="squad-secondary"
          disabled={busy}
          onClick={cancel}
        >
          {t("action.cancel")}
        </button>
      </div>
      {error ? <p className="squad-error">{error}</p> : null}
    </form>
  );
}

function TeamPlanDetail({
  plan,
  state,
  refresh,
  openDelegation,
  t,
}: {
  plan: TeamPlan;
  state: LocalState;
  refresh: () => Promise<void>;
  openDelegation: (id: string, status: DelegationStatus) => void;
  t: SquadTranslate;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const { confirm, confirmation } = useConfirmation(t);
  useEffect(() => setEditing(false), [plan.id]);
  const act = async (action: "approve" | "retry" | "cancel") => {
    setBusy(true);
    setError(undefined);
    try {
      await api<TeamPlan>(`/plans/${plan.id}/${action}`, { method: "POST" });
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.planActionFailed"));
    } finally {
      setBusy(false);
    }
  };
  const dispatched = plan.items.filter(
    (item) => item.status === "DISPATCHED",
  ).length;
  const canDispatch = ["DRAFT", "DISPATCHING", "PARTIAL"].includes(plan.status);
  const canCancel = !["DISPATCHED", "CANCELED"].includes(plan.status);
  const settled =
    plan.rollup.completed + plan.rollup.failed + plan.rollup.canceled;
  const active = plan.rollup.queued + plan.rollup.running;
  const problems = plan.rollup.dispatchFailed + plan.rollup.failed;
  const dispatch = async () => {
    const action = plan.status === "DRAFT" ? "approve" : "retry";
    if (
      action === "approve" &&
      !(await confirm({
        title: t("confirm.dispatchPlanTitle"),
        message: t("confirm.dispatchPlan", {
          title: plan.title,
          count: plan.items.length,
        }),
        confirmLabel: t("action.approvePlan"),
      }))
    ) {
      return;
    }
    await act(action);
  };
  const cancelPlan = async () => {
    if (
      await confirm({
        title: t("confirm.cancelPlanTitle"),
        message: t("confirm.cancelPlan", { title: plan.title }),
        confirmLabel: t("action.cancelPlan"),
        danger: true,
      })
    ) {
      await act("cancel");
    }
  };
  if (editing && plan.status === "DRAFT") {
    return (
      <article className="squad-detail squad-plan-detail">
        <header>
          <PlanStatusPill status={plan.status} t={t} />
          <h2>{t("plan.editTitle")}</h2>
        </header>
        <p className="squad-muted">{t("plan.editHint")}</p>
        <TeamPlanDraftEditor
          key={plan.id}
          plan={plan}
          state={state}
          refresh={refresh}
          cancel={() => setEditing(false)}
          t={t}
        />
      </article>
    );
  }
  return (
    <article className="squad-detail squad-plan-detail">
      <header>
        <PlanStatusPill status={plan.status} t={t} />
        <h2>{plan.title}</h2>
      </header>
      <p className="squad-muted">
        {t("plan.dispatchedCount", {
          sent: dispatched,
          total: plan.items.length,
        })}
      </p>
      <section
        className="squad-plan-rollup"
        aria-label={t("plan.progressLabel")}
      >
        <div
          className="squad-plan-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={plan.rollup.total}
          aria-valuenow={settled}
          aria-valuetext={t("plan.settledCount", {
            settled,
            total: plan.rollup.total,
          })}
        >
          <span
            style={{
              width: `${plan.rollup.total === 0 ? 0 : (settled / plan.rollup.total) * 100}%`,
            }}
          />
        </div>
        <div className="squad-plan-metrics">
          <div>
            <strong>{plan.rollup.completed}</strong>
            <span>{t("plan.completed")}</span>
          </div>
          <div>
            <strong>{active}</strong>
            <span>{t("plan.active")}</span>
          </div>
          <div>
            <strong>{plan.rollup.waitingHuman}</strong>
            <span>{t("plan.waitingHuman")}</span>
          </div>
          <div className={problems > 0 ? "problem" : ""}>
            <strong>{problems}</strong>
            <span>{t("plan.failed")}</span>
          </div>
          <div>
            <strong>{plan.rollup.pendingDispatch}</strong>
            <span>{t("plan.pendingDispatch")}</span>
          </div>
        </div>
      </section>
      {plan.sourceSummary ? (
        <section>
          <h3>{t("field.sourceSummary")}</h3>
          <p className="squad-prewrap">{plan.sourceSummary}</p>
        </section>
      ) : null}
      {canDispatch ? <p>{t("plan.approvalHint")}</p> : null}
      {canDispatch || canCancel ? (
        <div className="squad-actions">
          {plan.status === "DRAFT" ? (
            <button
              className="squad-secondary"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              {t("action.editPlan")}
            </button>
          ) : null}
          {canDispatch ? (
            <button disabled={busy} onClick={() => void dispatch()}>
              {plan.status === "DRAFT"
                ? t("action.approvePlan")
                : t("action.retryPlan")}
            </button>
          ) : null}
          {canCancel ? (
            <button
              className="squad-danger"
              disabled={busy}
              onClick={() => void cancelPlan()}
            >
              {t("action.cancelPlan")}
            </button>
          ) : null}
        </div>
      ) : null}
      <section>
        <h3>{t("field.planItems")}</h3>
        <div className="squad-plan-items">
          {plan.items.map((item) => (
            <article className="squad-plan-item" key={item.id}>
              <header>
                <strong>{item.objective}</strong>
                {item.delegation ? (
                  <StatusPill status={item.delegation.status} t={t} />
                ) : (
                  <span
                    className={`squad-plan-item-status squad-plan-item-status-${item.status.toLowerCase()}`}
                  >
                    {formatPlanItemStatus(t, item.status)}
                  </span>
                )}
              </header>
              <dl>
                <div>
                  <dt>{t("field.peer")}</dt>
                  <dd>
                    {item.peerDisplayName}
                    <code>{item.peerNodeId}</code>
                  </dd>
                </div>
                {item.context ? (
                  <div>
                    <dt>{t("field.context")}</dt>
                    <dd className="squad-prewrap">{item.context}</dd>
                  </div>
                ) : null}
                {item.acceptanceCriteria.length > 0 ? (
                  <div>
                    <dt>{t("field.acceptanceCriteria")}</dt>
                    <dd>
                      <ul>
                        {item.acceptanceCriteria.map((criterion, index) => (
                          <li key={index}>{criterion}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
                {item.attachmentRefs.length > 0 ? (
                  <div>
                    <dt>{t("field.attachmentRefs")}</dt>
                    <dd>
                      <ul>
                        {item.attachmentRefs.map((attachment) => (
                          <li key={`${attachment.sha256}:${attachment.name}`}>
                            <a
                              href={attachment.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {attachment.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
                {item.delegationId ? (
                  <div>
                    <dt>{t("field.delegationId")}</dt>
                    <dd>
                      <code>{item.delegationId}</code>
                    </dd>
                  </div>
                ) : null}
                {item.delegation ? (
                  <>
                    <div>
                      <dt>{t("field.delivery")}</dt>
                      <dd>
                        {formatDelivery(t, item.delegation.deliveryStatus)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("field.updatedAt")}</dt>
                      <dd>
                        {new Date(item.delegation.updatedAt).toLocaleString()}
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>
              {item.delegation?.summary ? (
                <section className="squad-plan-result">
                  <h4>{t("field.shareableSummary")}</h4>
                  <p className="squad-prewrap">
                    {formatSummary(t, item.delegation.summary)}
                  </p>
                </section>
              ) : null}
              {item.delegation && item.delegation.outputs.length > 0 ? (
                <section className="squad-plan-result">
                  <h4>{t("field.outputs")}</h4>
                  {item.delegation.outputs.map((output, index) =>
                    output.type === "text" ? (
                      <p className="squad-prewrap" key={index}>
                        {output.content}
                      </p>
                    ) : (
                      <p key={index}>
                        <a href={output.url} target="_blank" rel="noreferrer">
                          {output.name}
                        </a>
                      </p>
                    ),
                  )}
                </section>
              ) : null}
              {item.delegation?.errorCode ? (
                <p className="squad-error">
                  {formatErrorCode(t, item.delegation.errorCode)}
                </p>
              ) : null}
              {item.delegationId && item.delegation ? (
                <button
                  className="squad-link-button"
                  onClick={() =>
                    openDelegation(item.delegationId!, item.delegation!.status)
                  }
                >
                  {t("action.viewDelegation")}
                </button>
              ) : null}
              {item.error ? <p className="squad-error">{item.error}</p> : null}
            </article>
          ))}
        </div>
      </section>
      {error ? <p className="squad-error">{error}</p> : null}
      {confirmation}
    </article>
  );
}

type AutoExecute = PeerView["policy"]["autoExecute"];

function PolicySelect({
  value,
  disabled,
  onChange,
  t,
}: {
  value: AutoExecute;
  disabled?: boolean;
  onChange: (value: AutoExecute) => void;
  t: SquadTranslate;
}) {
  return (
    <select
      aria-label={t("settings.autoExecute")}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value as AutoExecute)}
    >
      <option value="NEVER">{formatPolicy(t, "NEVER")}</option>
      <option value="SAFE">{formatPolicy(t, "SAFE")}</option>
      <option value="TRUSTED">{formatPolicy(t, "TRUSTED")}</option>
    </select>
  );
}

function OrganizationCenter({
  state,
  refresh,
  t,
}: {
  state: LocalState;
  refresh: () => Promise<void>;
  t: SquadTranslate;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const { confirm, confirmation } = useConfirmation(t);
  const [invitation, setInvitation] = useState<{
    token: string;
    expiresAt: string;
    kind: "ORGANIZATION" | "JOIN_PACKAGE";
  }>();
  const [invitationHistory, setInvitationHistory] = useState<
    Record<string, OrganizationInvitationView[]>
  >({});
  const [loadingInvitations, setLoadingInvitations] = useState<string>();

  const loadInvitations = async (
    organizationId: string,
    force = false,
  ): Promise<void> => {
    if (!force && invitationHistory[organizationId] !== undefined) return;
    setLoadingInvitations(organizationId);
    try {
      const result = await api<OrganizationInvitationView[]>(
        `/organizations/${organizationId}/invitations`,
      );
      setInvitationHistory((current) => ({
        ...current,
        [organizationId]: result,
      }));
    } catch (cause) {
      setError(describeError(cause, t, "error.organizationActionFailed"));
    } finally {
      setLoadingInvitations((current) =>
        current === organizationId ? undefined : current,
      );
    }
  };

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.organizationActionFailed"));
    } finally {
      setBusy(undefined);
    }
  };

  const createOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run("create", async () => {
      await api("/organizations", {
        method: "POST",
        body: JSON.stringify({ name: form.get("name") }),
      });
      formElement.reset();
    });
  };

  const joinOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const invitation = String(form.get("invitation") ?? "").trim();
    await run("join", async () => {
      await api(
        invitation.startsWith("squad-join-v1.")
          ? "/join-packages/import"
          : "/organizations/join",
        {
          method: "POST",
          body: JSON.stringify(
            invitation.startsWith("squad-join-v1.")
              ? { bundle: invitation }
              : { invitation },
          ),
        },
      );
      formElement.reset();
      setNotice(t("organizations.pendingHint"));
    });
  };

  const createInvitation = async (
    organizationId: string,
    expiresInMinutes: number,
  ) => {
    setBusy(`invite:${organizationId}`);
    setError(undefined);
    setInvitation(undefined);
    try {
      const result = await api<{
        invitation: string;
        invitationId: string;
        expiresAt: string;
      }>(`/organizations/${organizationId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ expiresInMinutes }),
      });
      setInvitation({
        token: result.invitation,
        expiresAt: result.expiresAt,
        kind: "ORGANIZATION",
      });
      await loadInvitations(organizationId, true);
    } catch (cause) {
      setError(describeError(cause, t, "error.organizationActionFailed"));
    } finally {
      setBusy(undefined);
    }
  };

  const createJoinPackage = async (
    organizationId: string,
    expiresInMinutes: number,
  ) => {
    setBusy(`join-package:${organizationId}`);
    setError(undefined);
    setInvitation(undefined);
    try {
      const result = await api<{ bundle: string; expiresAt: string }>(
        `/organizations/${organizationId}/join-packages`,
        {
          method: "POST",
          body: JSON.stringify({ expiresInMinutes }),
        },
      );
      setInvitation({
        token: result.bundle,
        expiresAt: result.expiresAt,
        kind: "JOIN_PACKAGE",
      });
      await loadInvitations(organizationId, true);
    } catch (cause) {
      setError(describeError(cause, t, "error.organizationActionFailed"));
    } finally {
      setBusy(undefined);
    }
  };

  const approveJoin = async (
    organization: OrganizationView,
    request: OrganizationView["pendingJoinRequests"][number],
  ) => {
    if (
      !(await confirm({
        title: t("confirm.approveJoinTitle"),
        message: t("confirm.approveJoin", {
          name: request.displayName,
          organization: organization.name,
        }),
        confirmLabel: t("action.approveJoin"),
      }))
    ) {
      return;
    }
    await run(`approve:${request.requestId}`, () =>
      api(
        `/organizations/${organization.organizationId}/join-requests/${request.requestId}/approve`,
        { method: "POST", body: "{}" },
      ),
    );
  };

  const rejectJoin = async (
    organization: OrganizationView,
    request: OrganizationView["pendingJoinRequests"][number],
  ) => {
    if (
      !(await confirm({
        title: t("confirm.rejectJoinTitle"),
        message: t("confirm.rejectJoin", {
          name: request.displayName,
          organization: organization.name,
        }),
        confirmLabel: t("action.rejectJoin"),
        danger: true,
      }))
    ) {
      return;
    }
    await run(`reject:${request.requestId}`, () =>
      api(
        `/organizations/${organization.organizationId}/join-requests/${request.requestId}/reject`,
        { method: "POST", body: "{}" },
      ),
    );
  };

  const revokeInvitation = async (
    organizationId: string,
    invitationId: string,
  ) => {
    if (
      !(await confirm({
        title: t("confirm.revokeInvitationTitle"),
        message: t("confirm.revokeInvitation"),
        confirmLabel: t("action.revokeInvitation"),
        danger: true,
      }))
    ) {
      return;
    }
    await run(`revoke-invitation:${invitationId}`, async () => {
      await api(
        `/organizations/${organizationId}/invitations/${invitationId}`,
        {
          method: "DELETE",
        },
      );
      await loadInvitations(organizationId, true);
    });
  };

  const changeMemberRole = async (
    organization: OrganizationView,
    member: OrganizationView["members"][number],
    role: "ADMIN" | "MEMBER",
  ) => {
    if (
      !(await confirm({
        title: t("confirm.changeRoleTitle"),
        message: t("confirm.changeRole", {
          name: member.displayName,
          role: formatOrganizationRole(t, role),
          organization: organization.name,
        }),
        confirmLabel: t("confirm.changeRoleAction"),
        danger: member.role === "ADMIN",
      }))
    ) {
      return;
    }
    await run(`role:${member.membershipId}`, () =>
      api(
        `/organizations/${organization.organizationId}/members/${member.membershipId}/role`,
        { method: "POST", body: JSON.stringify({ role }) },
      ),
    );
  };

  const changeMemberStatus = async (
    organization: OrganizationView,
    member: OrganizationView["members"][number],
  ) => {
    const enabling = member.status !== "ACTIVE";
    if (
      !(await confirm({
        title: enabling
          ? t("confirm.enableMemberTitle")
          : t("confirm.disableMemberTitle"),
        message: t(
          enabling ? "confirm.enableMember" : "confirm.disableMember",
          { name: member.displayName, organization: organization.name },
        ),
        confirmLabel: enabling
          ? t("action.enableMember")
          : t("action.disableMember"),
        danger: !enabling,
      }))
    ) {
      return;
    }
    await run(`status:${member.membershipId}`, () =>
      api(
        `/organizations/${organization.organizationId}/members/${member.membershipId}/status`,
        {
          method: "POST",
          body: JSON.stringify({ enabled: enabling }),
        },
      ),
    );
  };

  const changeMemberPolicy = async (
    organization: OrganizationView,
    member: OrganizationView["members"][number],
    autoExecute: AutoExecute,
  ) => {
    if (
      autoExecute === "TRUSTED" &&
      member.policy.autoExecute !== "TRUSTED" &&
      !(await confirm({
        title: t("confirm.trustedPolicyTitle"),
        message: t("confirm.trustedPolicy", { name: member.displayName }),
        confirmLabel: t("confirm.enableTrustedAction"),
        danger: true,
      }))
    ) {
      return;
    }
    await run(`policy:${member.membershipId}`, () =>
      api(
        `/organizations/${organization.organizationId}/members/${member.membershipId}/policy`,
        {
          method: "POST",
          body: JSON.stringify({ autoExecute }),
        },
      ),
    );
  };

  if (!state.relay.configured) {
    return (
      <div className="squad-organizations squad-connection-required">
        <h2>{t("organizations.relayRequired")}</h2>
        <p>{t("organizations.relayRequiredHint")}</p>
        <form onSubmit={(event) => void joinOrganization(event)}>
          <label>
            {t("organizations.joinPackage")}
            <textarea
              name="invitation"
              required
              rows={5}
              placeholder={t("organizations.joinPackagePlaceholder")}
            />
          </label>
          <button disabled={busy !== undefined} type="submit">
            {t("action.joinOrganization")}
          </button>
        </form>
        <p className="squad-muted">{t("organizations.retainedHint")}</p>
        {error ? <p className="squad-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="squad-organizations">
      <div className="squad-organization-intro">
        <div>
          <h2>{t("organizations.title")}</h2>
          <p className="squad-muted">{t("organizations.securityHint")}</p>
        </div>
        <div className="squad-organization-forms">
          <form onSubmit={(event) => void createOrganization(event)}>
            <h3>{t("organizations.create")}</h3>
            <label>
              {t("organizations.name")}
              <input name="name" required maxLength={120} />
            </label>
            <button disabled={busy !== undefined} type="submit">
              {t("action.createOrganization")}
            </button>
          </form>
          <form onSubmit={(event) => void joinOrganization(event)}>
            <h3>{t("organizations.join")}</h3>
            <label>
              {t("organizations.invitation")}
              <textarea name="invitation" required rows={3} />
            </label>
            <small className="squad-muted">{t("organizations.joinHint")}</small>
            <button disabled={busy !== undefined} type="submit">
              {t("action.joinOrganization")}
            </button>
          </form>
        </div>
      </div>
      {notice ? <p className="squad-notice">{notice}</p> : null}
      {invitation ? (
        <section className="squad-invitation-result">
          <strong>
            {invitation.kind === "JOIN_PACKAGE"
              ? t("organizations.joinPackageResult")
              : t("organizations.invitationResult")}
          </strong>
          <code>{invitation.token}</code>
          <span>
            {t("organizations.invitationExpires", {
              time: new Date(invitation.expiresAt).toLocaleString(),
            })}
          </span>
        </section>
      ) : null}
      {state.organizations.length === 0 ? (
        <p className="squad-empty">{t("organizations.noOrganizations")}</p>
      ) : null}
      <div className="squad-organization-list">
        {state.organizations.map((organization) => {
          const canAdminister =
            organization.membershipStatus === "ACTIVE" &&
            (organization.role === "OWNER" || organization.role === "ADMIN");
          return (
            <article
              className="squad-organization-card"
              key={organization.organizationId}
            >
              <header>
                <div>
                  <h2>{organization.name}</h2>
                  <code>{organization.organizationId}</code>
                </div>
                <div className="squad-organization-badges">
                  {organization.role ? (
                    <span>{formatOrganizationRole(t, organization.role)}</span>
                  ) : null}
                  <span>
                    {formatOrganizationStatus(t, organization.membershipStatus)}
                  </span>
                </div>
              </header>
              <p className="squad-muted">
                {t("organizations.directoryRevision", {
                  revision: organization.revision,
                })}
              </p>
              {canAdminister ? (
                <>
                  <div className="squad-organization-admin">
                    <label>
                      {t("organizations.invitationExpiry")}
                      <input
                        id={`expiry-${organization.organizationId}`}
                        type="number"
                        min={5}
                        max={10_080}
                        defaultValue={1_440}
                      />
                    </label>
                    <button
                      disabled={busy !== undefined}
                      onClick={() => {
                        const input = document.getElementById(
                          `expiry-${organization.organizationId}`,
                        ) as HTMLInputElement | null;
                        void createJoinPackage(
                          organization.organizationId,
                          Number(input?.value ?? 1_440),
                        );
                      }}
                    >
                      {t("action.createJoinPackage")}
                    </button>
                    <button
                      className="squad-secondary"
                      disabled={busy !== undefined}
                      onClick={() => {
                        const input = document.getElementById(
                          `expiry-${organization.organizationId}`,
                        ) as HTMLInputElement | null;
                        void createInvitation(
                          organization.organizationId,
                          Number(input?.value ?? 1_440),
                        );
                      }}
                    >
                      {t("action.createInvitation")}
                    </button>
                  </div>
                  <details
                    className="squad-invitation-history"
                    onToggle={(event) => {
                      if (event.currentTarget.open) {
                        void loadInvitations(organization.organizationId);
                      }
                    }}
                  >
                    <summary>{t("organizations.invitationHistory")}</summary>
                    <p className="squad-muted">
                      {t("organizations.invitationHistoryHint")}
                    </p>
                    {loadingInvitations === organization.organizationId ? (
                      <p role="status">
                        {t("organizations.loadingInvitations")}
                      </p>
                    ) : null}
                    {invitationHistory[organization.organizationId]?.length ===
                    0 ? (
                      <p className="squad-muted">
                        {t("organizations.noInvitations")}
                      </p>
                    ) : null}
                    <div className="squad-invitation-list">
                      {(
                        invitationHistory[organization.organizationId] ?? []
                      ).map((entry) => {
                        const creator = organization.members.find(
                          (member) =>
                            member.membershipId === entry.createdByMembershipId,
                        );
                        return (
                          <article key={entry.invitationId}>
                            <div>
                              <strong>
                                {formatOrganizationInvitationStatus(
                                  t,
                                  entry.status,
                                )}
                              </strong>
                              <span>
                                {t("organizations.invitationCreated", {
                                  time: new Date(
                                    entry.createdAt,
                                  ).toLocaleString(),
                                })}
                              </span>
                              <span>
                                {t("organizations.invitationExpires", {
                                  time: new Date(
                                    entry.expiresAt,
                                  ).toLocaleString(),
                                })}
                              </span>
                              <span>
                                {t("organizations.invitationCreator", {
                                  name:
                                    creator?.displayName ??
                                    entry.createdByMembershipId,
                                })}
                              </span>
                            </div>
                            {entry.status === "ACTIVE" ? (
                              <button
                                className="squad-danger"
                                disabled={busy !== undefined}
                                onClick={() =>
                                  void revokeInvitation(
                                    organization.organizationId,
                                    entry.invitationId,
                                  )
                                }
                              >
                                {t("action.revokeInvitation")}
                              </button>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </details>
                </>
              ) : null}
              {canAdminister ? (
                <section>
                  <h3>{t("organizations.pendingRequests")}</h3>
                  {organization.pendingJoinRequests.length === 0 ? (
                    <p className="squad-muted">
                      {t("organizations.noPendingRequests")}
                    </p>
                  ) : null}
                  {organization.pendingJoinRequests.map((request) => (
                    <div className="squad-join-request" key={request.requestId}>
                      <div>
                        <strong>{request.displayName}</strong>
                        <code>{request.nodeId}</code>
                      </div>
                      <div className="squad-join-actions">
                        <button
                          disabled={busy !== undefined}
                          onClick={() =>
                            void approveJoin(organization, request)
                          }
                        >
                          {t("action.approveJoin")}
                        </button>
                        <button
                          className="squad-danger"
                          disabled={busy !== undefined}
                          onClick={() => void rejectJoin(organization, request)}
                        >
                          {t("action.rejectJoin")}
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              ) : null}
              <section>
                <h3>{t("organizations.members")}</h3>
                <div className="squad-member-list">
                  {organization.members.map((member) => {
                    const canSetRole =
                      organization.role === "OWNER" &&
                      !member.isSelf &&
                      member.role !== "OWNER";
                    const canSetStatus =
                      !member.isSelf &&
                      member.role !== "OWNER" &&
                      (organization.role === "OWNER" ||
                        (organization.role === "ADMIN" &&
                          member.role === "MEMBER"));
                    return (
                      <div className="squad-member" key={member.membershipId}>
                        <div className="squad-member-identity">
                          <strong>
                            {member.displayName}
                            {member.isSelf
                              ? ` · ${t("organizations.self")}`
                              : ""}
                          </strong>
                          <code>{member.nodeId}</code>
                        </div>
                        <div className="squad-member-role">
                          {canSetRole ? (
                            <select
                              aria-label={formatOrganizationRole(
                                t,
                                member.role,
                              )}
                              value={member.role}
                              disabled={busy !== undefined}
                              onChange={(event) =>
                                void changeMemberRole(
                                  organization,
                                  member,
                                  event.currentTarget.value as
                                    | "ADMIN"
                                    | "MEMBER",
                                )
                              }
                            >
                              <option value="ADMIN">
                                {formatOrganizationRole(t, "ADMIN")}
                              </option>
                              <option value="MEMBER">
                                {formatOrganizationRole(t, "MEMBER")}
                              </option>
                            </select>
                          ) : (
                            <span>
                              {formatOrganizationRole(t, member.role)}
                            </span>
                          )}
                          <span>
                            {formatOrganizationStatus(t, member.status)}
                          </span>
                        </div>
                        {!member.isSelf ? (
                          <label className="squad-policy-control">
                            {t("organizations.localPolicy")}
                            <PolicySelect
                              value={member.policy.autoExecute}
                              disabled={busy !== undefined}
                              t={t}
                              onChange={(autoExecute) =>
                                void changeMemberPolicy(
                                  organization,
                                  member,
                                  autoExecute,
                                )
                              }
                            />
                          </label>
                        ) : null}
                        {canSetStatus ? (
                          <button
                            className={
                              member.status === "ACTIVE" ? "squad-danger" : ""
                            }
                            disabled={busy !== undefined}
                            onClick={() =>
                              void changeMemberStatus(organization, member)
                            }
                          >
                            {member.status === "ACTIVE"
                              ? t("action.disableMember")
                              : t("action.enableMember")}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
              {organization.members.some(
                (member) =>
                  !member.isSelf && member.policy.autoExecute === "TRUSTED",
              ) ? (
                <p className="squad-warning">{t("settings.trustedWarning")}</p>
              ) : null}
            </article>
          );
        })}
      </div>
      {error ? <p className="squad-error">{error}</p> : null}
      {confirmation}
    </div>
  );
}

type SetupMode = "RELAY" | "DIRECT";

function NodeSetupForm({
  state,
  onboarding = false,
  onConfigured,
  onLater,
  t,
}: {
  state: LocalState;
  onboarding?: boolean;
  onConfigured: () => Promise<void>;
  onLater?: () => void;
  t: SquadTranslate;
}) {
  const initialMode =
    state.setup.mode ??
    (state.relay.configured
      ? "RELAY"
      : state.direct.serving
        ? "DIRECT"
        : "RELAY");
  const [mode, setMode] = useState<SetupMode>(initialMode);
  const [displayName, setDisplayName] = useState(state.identity.displayName);
  const [relayUrl, setRelayUrl] = useState(state.relay.url ?? "");
  const [invitation, setInvitation] = useState("");
  const [directEnabled, setDirectEnabled] = useState(state.direct.serving);
  const [directPublicUrl, setDirectPublicUrl] = useState(
    state.direct.publicUrl ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const { confirm, confirmation } = useConfirmation(t);

  useEffect(() => {
    const nextMode =
      state.setup.mode ??
      (state.relay.configured
        ? "RELAY"
        : state.direct.serving
          ? "DIRECT"
          : "RELAY");
    setMode(nextMode);
    setDisplayName(state.identity.displayName);
    setRelayUrl(state.relay.url ?? "");
    setDirectEnabled(state.direct.serving);
    setDirectPublicUrl(state.direct.publicUrl ?? "");
  }, [
    state.direct.publicUrl,
    state.direct.serving,
    state.identity.displayName,
    state.relay.configured,
    state.relay.url,
    state.setup.mode,
  ]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !onboarding &&
      mode !== initialMode &&
      !(await confirm({
        title: t("confirm.switchModeTitle"),
        message: t("confirm.switchMode", {
          mode: t(mode === "RELAY" ? "setup.relayTitle" : "setup.directTitle"),
        }),
        confirmLabel: t("confirm.switchModeAction"),
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api("/setup", {
        method: "POST",
        body: JSON.stringify(
          mode === "RELAY"
            ? {
                mode,
                displayName,
                relayUrl,
                ...(invitation.trim() === "" ? {} : { invitation }),
                directEnabled,
                ...(directPublicUrl.trim() === "" ? {} : { directPublicUrl }),
              }
            : {
                mode,
                displayName,
                directEnabled,
                ...(directPublicUrl.trim() === "" ? {} : { directPublicUrl }),
              },
        ),
      });
      setInvitation("");
      setSaved(true);
      await onConfigured();
    } catch (cause) {
      setError(describeError(cause, t, "error.setupFailed"));
    } finally {
      setBusy(false);
    }
  };

  const joinWithPackage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setJoinBusy(true);
    setError(undefined);
    try {
      await api("/join-packages/import", {
        method: "POST",
        body: JSON.stringify({
          bundle: form.get("joinPackage"),
          displayName,
        }),
      });
      formElement.reset();
      await onConfigured();
    } catch (cause) {
      setError(describeError(cause, t, "error.joinPackageFailed"));
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <section
      className={`squad-node-setup ${onboarding ? "squad-onboarding" : ""}`}
    >
      {onboarding ? (
        <header>
          <span className="squad-step">{t("setup.firstRun")}</span>
          <h2>{t("setup.title")}</h2>
          <p>{t("setup.intro")}</p>
        </header>
      ) : (
        <h2>{t("settings.connection")}</h2>
      )}
      {onboarding ? (
        <form className="squad-onboarding-join" onSubmit={joinWithPackage}>
          <h3>{t("joinPackage.haveOne")}</h3>
          <p>{t("joinPackage.onboardingHint")}</p>
          <label>
            {t("settings.displayName")}
            <input
              name="joinDisplayName"
              value={displayName}
              required
              maxLength={120}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
          </label>
          <label>
            {t("organizations.joinPackage")}
            <textarea
              name="joinPackage"
              required
              rows={4}
              maxLength={32 * 1024}
              placeholder={t("organizations.joinPackagePlaceholder")}
            />
          </label>
          <button type="submit" disabled={joinBusy || busy}>
            {joinBusy ? t("joinPackage.joining") : t("joinPackage.join")}
          </button>
        </form>
      ) : null}
      {onboarding ? (
        <p className="squad-form-divider">{t("joinPackage.or")}</p>
      ) : null}
      <form onSubmit={submit}>
        <label>
          {t("settings.displayName")}
          <input
            name="nodeDisplayName"
            value={displayName}
            required
            maxLength={120}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
          />
        </label>
        <fieldset className="squad-mode-picker">
          <legend>{t("setup.chooseMode")}</legend>
          <button
            type="button"
            className={mode === "RELAY" ? "active" : ""}
            aria-pressed={mode === "RELAY"}
            onClick={() => setMode("RELAY")}
          >
            <strong>{t("setup.relayTitle")}</strong>
            <span>{t("setup.relayDescription")}</span>
          </button>
          <button
            type="button"
            className={mode === "DIRECT" ? "active" : ""}
            aria-pressed={mode === "DIRECT"}
            onClick={() => setMode("DIRECT")}
          >
            <strong>{t("setup.directTitle")}</strong>
            <span>{t("setup.directDescription")}</span>
          </button>
        </fieldset>
        {mode === "RELAY" ? (
          <div className="squad-setup-fields">
            <label>
              {t("setup.relayUrl")}
              <input
                name="relayUrl"
                type="url"
                value={relayUrl}
                required
                maxLength={2_048}
                placeholder="https://relay.example.com"
                onChange={(event) => setRelayUrl(event.currentTarget.value)}
              />
              <small>{t("setup.relayUrlHint")}</small>
            </label>
            <label>
              {t("setup.invitation")}
              <input
                name="invitation"
                type="password"
                value={invitation}
                minLength={16}
                maxLength={512}
                autoComplete="off"
                onChange={(event) => setInvitation(event.currentTarget.value)}
              />
              <small>{t("setup.invitationHint")}</small>
            </label>
            <hr />
            <label className="squad-check">
              <input
                name="relayDirectEnabled"
                type="checkbox"
                checked={directEnabled}
                onChange={(event) =>
                  setDirectEnabled(event.currentTarget.checked)
                }
              />
              <span>{t("setup.optionalDirectReceive")}</span>
            </label>
            <label>
              {t("setup.directPublicUrl")}
              <input
                name="relayDirectPublicUrl"
                type="url"
                value={directPublicUrl}
                required={directEnabled}
                disabled={!directEnabled}
                maxLength={2_048}
                placeholder="https://alice-agent.example.com"
                onChange={(event) =>
                  setDirectPublicUrl(event.currentTarget.value)
                }
              />
              <small>{t("setup.optionalDirectHint")}</small>
            </label>
          </div>
        ) : (
          <div className="squad-setup-fields">
            <label className="squad-check">
              <input
                name="directEnabled"
                type="checkbox"
                checked={directEnabled}
                onChange={(event) =>
                  setDirectEnabled(event.currentTarget.checked)
                }
              />
              <span>{t("setup.directReceive")}</span>
            </label>
            <label>
              {t("setup.directPublicUrl")}
              <input
                name="directPublicUrl"
                type="url"
                value={directPublicUrl}
                required={directEnabled}
                disabled={!directEnabled}
                maxLength={2_048}
                placeholder="https://alice-agent.example.com"
                onChange={(event) =>
                  setDirectPublicUrl(event.currentTarget.value)
                }
              />
              <small>{t("setup.directPublicUrlHint")}</small>
            </label>
          </div>
        )}
        {!onboarding && mode !== initialMode ? (
          <p className="squad-warning">{t("setup.switchWarning")}</p>
        ) : null}
        <p className="squad-muted">{t("setup.securityHint")}</p>
        {saved ? <p className="squad-notice">{t("setup.saved")}</p> : null}
        {error ? <p className="squad-error">{error}</p> : null}
        <div className="squad-actions">
          <button type="submit" disabled={busy}>
            {busy
              ? t("setup.saving")
              : onboarding
                ? t("setup.complete")
                : t("setup.save")}
          </button>
          {onLater ? (
            <button
              type="button"
              className="squad-secondary"
              disabled={busy}
              onClick={onLater}
            >
              {t("setup.later")}
            </button>
          ) : null}
        </div>
      </form>
      {confirmation}
    </section>
  );
}

function ConnectionDiagnostics({
  state,
  refresh,
  t,
}: {
  state: LocalState;
  refresh: () => Promise<void>;
  t: SquadTranslate;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const diagnostics = state.connection;
  const check = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api("/connections/check", { method: "POST", body: "{}" });
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.connectionCheckFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="squad-diagnostics">
      <header>
        <div>
          <h2>{t("diagnostics.title")}</h2>
          <p className="squad-muted">{t("diagnostics.intro")}</p>
        </div>
        <button disabled={busy} onClick={() => void check()}>
          {busy ? t("diagnostics.checking") : t("diagnostics.checkNow")}
        </button>
      </header>
      <p className="squad-muted">
        {diagnostics.checkedAt
          ? t("diagnostics.lastChecked", {
              time: new Date(diagnostics.checkedAt).toLocaleString(),
            })
          : t("diagnostics.notChecked")}
      </p>
      <div className="squad-diagnostic-grid">
        <article>
          <header>
            <h3>{t("diagnostics.relay")}</h3>
            <span
              className={`squad-status squad-connection-${diagnostics.relay.status.toLowerCase()}`}
            >
              {formatConnectionStatus(t, diagnostics.relay.status)}
            </span>
          </header>
          {diagnostics.relay.url ? <code>{diagnostics.relay.url}</code> : null}
          <dl>
            <div>
              <dt>{t("diagnostics.eventStream")}</dt>
              <dd>{t(`diagnostics.event.${diagnostics.relay.eventStream}`)}</dd>
            </div>
          </dl>
          {diagnostics.relay.lastSuccessfulAt ? (
            <p>
              {t("diagnostics.lastSuccess", {
                time: new Date(
                  diagnostics.relay.lastSuccessfulAt,
                ).toLocaleString(),
              })}
            </p>
          ) : null}
          {diagnostics.relay.remoteVersion ? (
            <p>
              {t("diagnostics.remoteVersion", {
                version: diagnostics.relay.remoteVersion,
              })}
            </p>
          ) : null}
          {diagnostics.relay.protocolVersions ? (
            <p>
              {t("diagnostics.protocols", {
                versions: diagnostics.relay.protocolVersions.join(", "),
              })}
            </p>
          ) : null}
          {diagnostics.relay.lastError ? (
            <p className="squad-error">
              {t("diagnostics.lastError", {
                error: diagnostics.relay.lastError,
              })}
            </p>
          ) : null}
        </article>
        <article>
          <header>
            <h3>{t("diagnostics.direct")}</h3>
            <span
              className={`squad-status squad-connection-${diagnostics.direct.status.toLowerCase()}`}
            >
              {formatConnectionStatus(t, diagnostics.direct.status)}
            </span>
          </header>
          {diagnostics.direct.publicUrl ? (
            <code>{diagnostics.direct.publicUrl}</code>
          ) : null}
          {diagnostics.direct.lastReceivedAt ? (
            <p>
              {t("diagnostics.lastReceived", {
                time: new Date(
                  diagnostics.direct.lastReceivedAt,
                ).toLocaleString(),
              })}
            </p>
          ) : null}
          {diagnostics.direct.lastError ? (
            <p className="squad-error">
              {t("diagnostics.lastError", {
                error: diagnostics.direct.lastError,
              })}
            </p>
          ) : null}
          <p className="squad-muted">{t("diagnostics.selfCheckHint")}</p>
        </article>
        <article>
          <header>
            <h3>{t("diagnostics.queue")}</h3>
            <strong>{diagnostics.queue.pending}</strong>
          </header>
          <p>
            {t("diagnostics.pending", { count: diagnostics.queue.pending })}
          </p>
          <p>
            {t("diagnostics.retrying", { count: diagnostics.queue.retrying })}
          </p>
          {diagnostics.queue.nextAttemptAt ? (
            <p>
              {t("diagnostics.nextAttempt", {
                time: new Date(
                  diagnostics.queue.nextAttemptAt,
                ).toLocaleString(),
              })}
            </p>
          ) : null}
          {diagnostics.queue.lastError ? (
            <p className="squad-error">
              {t("diagnostics.lastError", {
                error: diagnostics.queue.lastError,
              })}
            </p>
          ) : null}
        </article>
      </div>
      {error ? <p className="squad-error">{error}</p> : null}
    </div>
  );
}

function automationRuleBody(
  rule: AutomationRuleView,
  overrides: Partial<AutomationRuleInput> = {},
): AutomationRuleInput {
  return {
    name: rule.name,
    objectivePattern: rule.objectivePattern,
    allowedTools: rule.allowedTools,
    ...(rule.preset === undefined ? {} : { preset: rule.preset }),
    allowAttachments: rule.allowAttachments,
    maxRuntimeMinutes: rule.maxRuntimeMinutes,
    ...(rule.maxTokens === undefined ? {} : { maxTokens: rule.maxTokens }),
    priority: rule.priority,
    enabled: rule.enabled,
    ...overrides,
  };
}

function automationRuleFromForm(form: FormData): AutomationRuleInput {
  const preset = String(form.get("preset") ?? "").trim();
  const maxTokensText = String(form.get("maxTokens") ?? "").trim();
  return {
    name: String(form.get("name") ?? ""),
    objectivePattern: String(form.get("objectivePattern") ?? ""),
    allowedTools: [
      ...new Set(
        String(form.get("allowedTools") ?? "")
          .split(/[\s,]+/u)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
    ...(preset ? { preset } : {}),
    allowAttachments: form.get("allowAttachments") === "on",
    maxRuntimeMinutes: Number(form.get("maxRuntimeMinutes")),
    ...(maxTokensText ? { maxTokens: Number(maxTokensText) } : {}),
    priority: Number(form.get("priority")),
    enabled: form.get("enabled") === "on",
  };
}

function AutomationRuleFields({
  rule,
  t,
}: {
  rule?: AutomationRuleView;
  t: SquadTranslate;
}) {
  return (
    <>
      <label>
        {t("automation.name")}
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={rule?.name ?? ""}
        />
      </label>
      <label>
        {t("automation.objectivePattern")}
        <input
          name="objectivePattern"
          required
          maxLength={500}
          defaultValue={rule?.objectivePattern ?? ""}
          placeholder={t("automation.patternPlaceholder")}
        />
        <small>{t("automation.patternHint")}</small>
      </label>
      <label>
        {t("automation.allowedTools")}
        <textarea
          name="allowedTools"
          rows={4}
          defaultValue={rule?.allowedTools.join("\n") ?? ""}
          placeholder={t("automation.toolsPlaceholder")}
        />
        <small>{t("automation.toolsHint")}</small>
      </label>
      <div className="squad-automation-limits">
        <label>
          {t("automation.preset")}
          <input
            name="preset"
            maxLength={160}
            defaultValue={rule?.preset ?? ""}
            placeholder={t("automation.defaultPreset")}
          />
        </label>
        <label>
          {t("automation.runtime")}
          <input
            name="maxRuntimeMinutes"
            type="number"
            required
            min={1}
            max={1_440}
            defaultValue={rule?.maxRuntimeMinutes ?? 10}
          />
        </label>
        <label>
          {t("automation.maxTokens")}
          <input
            name="maxTokens"
            type="number"
            min={256}
            max={1_000_000}
            defaultValue={rule?.maxTokens ?? ""}
          />
        </label>
        <label>
          {t("automation.priority")}
          <input
            name="priority"
            type="number"
            required
            min={0}
            max={10_000}
            defaultValue={rule?.priority ?? 100}
          />
        </label>
      </div>
      <label className="squad-check">
        <input
          name="allowAttachments"
          type="checkbox"
          defaultChecked={rule?.allowAttachments ?? false}
        />
        <span>{t("automation.allowAttachments")}</span>
      </label>
      <label className="squad-check">
        <input
          name="enabled"
          type="checkbox"
          defaultChecked={rule?.enabled ?? true}
        />
        <span>{t("automation.enabled")}</span>
      </label>
    </>
  );
}

function AutomationRules({
  state,
  refresh,
  t,
}: {
  state: LocalState;
  refresh: () => Promise<void>;
  t: SquadTranslate;
}) {
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const { confirm, confirmation } = useConfirmation(t);
  const save = async (
    event: FormEvent<HTMLFormElement>,
    rule?: AutomationRuleView,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = automationRuleFromForm(new FormData(form));
    if (
      input.enabled &&
      !(await confirm({
        title: t("confirm.automationRuleTitle"),
        message: t("confirm.automationRule", {
          name: input.name,
          pattern: input.objectivePattern,
          count: input.allowedTools.length,
        }),
        confirmLabel: t("confirm.enableAutomationRuleAction"),
      }))
    ) {
      return;
    }
    const id = rule?.id ?? "create";
    setBusy(id);
    setError(undefined);
    try {
      await api(
        rule === undefined
          ? "/automation-rules"
          : `/automation-rules/${rule.id}`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      if (rule === undefined) form.reset();
      setEditing(undefined);
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.automationRuleFailed"));
    } finally {
      setBusy(undefined);
    }
  };
  const toggle = async (rule: AutomationRuleView) => {
    if (rule.source !== "INTERFACE") return;
    if (
      !rule.enabled &&
      !(await confirm({
        title: t("confirm.automationRuleTitle"),
        message: t("confirm.automationRule", {
          name: rule.name,
          pattern: rule.objectivePattern,
          count: rule.allowedTools.length,
        }),
        confirmLabel: t("confirm.enableAutomationRuleAction"),
      }))
    ) {
      return;
    }
    setBusy(rule.id);
    setError(undefined);
    try {
      await api(`/automation-rules/${rule.id}`, {
        method: "POST",
        body: JSON.stringify(
          automationRuleBody(rule, { enabled: !rule.enabled }),
        ),
      });
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.automationRuleFailed"));
    } finally {
      setBusy(undefined);
    }
  };
  const remove = async (rule: AutomationRuleView) => {
    if (rule.source !== "INTERFACE") return;
    if (
      !(await confirm({
        title: t("confirm.deleteAutomationRuleTitle"),
        message: t("confirm.deleteAutomationRule", { name: rule.name }),
        confirmLabel: t("action.deleteRule"),
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(rule.id);
    setError(undefined);
    try {
      await api(`/automation-rules/${rule.id}`, { method: "DELETE" });
      if (editing === rule.id) setEditing(undefined);
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.automationRuleFailed"));
    } finally {
      setBusy(undefined);
    }
  };
  const enabledCount = state.automation.rules.filter(
    (rule) => rule.enabled,
  ).length;
  const usesRules = [
    ...state.peers.map((peer) => peer.policy.autoExecute),
    ...state.organizations.flatMap((organization) =>
      organization.members.map((member) => member.policy.autoExecute),
    ),
  ].includes("SAFE");
  return (
    <section className="squad-automation">
      <h2>{t("automation.title")}</h2>
      <p className="squad-muted">{t("automation.intro")}</p>
      {state.automation.legacyPrefixCount > 0 ? (
        <p className="squad-warning">
          {t("automation.legacyIgnored", {
            count: state.automation.legacyPrefixCount,
          })}
        </p>
      ) : null}
      {usesRules && enabledCount === 0 ? (
        <p className="squad-warning">{t("automation.noEnabledRules")}</p>
      ) : null}
      <div className="squad-automation-list">
        {state.automation.rules.map((rule) => (
          <article key={rule.id} className={rule.enabled ? "" : "disabled"}>
            <header>
              <div>
                <strong>{rule.name}</strong>
                <span>
                  {rule.source === "FILE"
                    ? t("automation.sourceFile")
                    : t("automation.sourceInterface")}
                  {rule.enabled ? "" : ` · ${t("automation.disabled")}`}
                </span>
              </div>
              {rule.source === "INTERFACE" ? (
                <div className="squad-actions">
                  <button
                    type="button"
                    className="squad-secondary"
                    disabled={busy !== undefined}
                    onClick={() => void toggle(rule)}
                  >
                    {rule.enabled
                      ? t("action.disableRule")
                      : t("action.enableRule")}
                  </button>
                  <button
                    type="button"
                    className="squad-secondary"
                    disabled={busy !== undefined}
                    onClick={() => setEditing(rule.id)}
                  >
                    {t("action.editRule")}
                  </button>
                </div>
              ) : null}
            </header>
            <code>{rule.objectivePattern}</code>
            <p className="squad-muted">
              {t("automation.ruleSummary", {
                tools:
                  rule.allowedTools.length === 0
                    ? t("automation.noTools")
                    : rule.allowedTools.join(", "),
                runtime: rule.maxRuntimeMinutes,
                attachments: rule.allowAttachments
                  ? t("automation.attachmentsAllowed")
                  : t("automation.attachmentsDenied"),
              })}
            </p>
            {editing === rule.id && rule.source === "INTERFACE" ? (
              <form onSubmit={(event) => void save(event, rule)}>
                <AutomationRuleFields rule={rule} t={t} />
                <div className="squad-actions">
                  <button type="submit" disabled={busy !== undefined}>
                    {busy === rule.id
                      ? t("action.saving")
                      : t("action.saveChanges")}
                  </button>
                  <button
                    type="button"
                    className="squad-secondary"
                    disabled={busy !== undefined}
                    onClick={() => setEditing(undefined)}
                  >
                    {t("action.cancel")}
                  </button>
                  <button
                    type="button"
                    className="squad-danger"
                    disabled={busy !== undefined}
                    onClick={() => void remove(rule)}
                  >
                    {t("action.deleteRule")}
                  </button>
                </div>
              </form>
            ) : null}
          </article>
        ))}
      </div>
      <details className="squad-automation-create">
        <summary>{t("automation.create")}</summary>
        <form onSubmit={(event) => void save(event)}>
          <AutomationRuleFields t={t} />
          <button type="submit" disabled={busy !== undefined}>
            {busy === "create" ? t("action.saving") : t("action.createRule")}
          </button>
        </form>
      </details>
      {error ? <p className="squad-error">{error}</p> : null}
      {confirmation}
    </section>
  );
}

function Settings({
  state,
  refresh,
  t,
}: {
  state: LocalState;
  refresh: () => Promise<void>;
  t: SquadTranslate;
}) {
  const [error, setError] = useState<string>();
  const [busyPeer, setBusyPeer] = useState<string>();
  const [pairingBusy, setPairingBusy] = useState<"create" | "import">();
  const [pairingBundle, setPairingBundle] = useState<{
    bundle: string;
    expiresAt: string;
  }>();
  const [copied, setCopied] = useState(false);
  const { confirm, confirmation } = useConfirmation(t);
  const submitManualPeer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (
      form.get("autoExecute") === "TRUSTED" &&
      !(await confirm({
        title: t("confirm.trustedPolicyTitle"),
        message: t("confirm.trustedNewPeer"),
        confirmLabel: t("confirm.enableTrustedAction"),
        danger: true,
      }))
    ) {
      return;
    }
    setError(undefined);
    try {
      await api("/peers", {
        method: "POST",
        body: JSON.stringify({
          nodeId: form.get("nodeId"),
          displayName: form.get("displayName"),
          publicKey: form.get("publicKey"),
          transport: form.get("transport"),
          directUrl: form.get("directUrl"),
          policy: {
            canMessage: true,
            canDelegate: true,
            autoExecute: form.get("autoExecute"),
            maxConcurrent: 1,
            maxDelegationDepth: 1,
            maxRuntimeMinutes: 30,
          },
        }),
      });
      formElement.reset();
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.pairingFailed"));
    }
  };
  const relayState = state.relay.serving
    ? t("settings.relayServing")
    : state.relay.configured
      ? t("settings.relayConfigured")
      : t("settings.relayNotConfigured");
  const updatePeerPolicy = async (peer: PeerView, autoExecute: AutoExecute) => {
    if (
      autoExecute === "TRUSTED" &&
      peer.policy.autoExecute !== "TRUSTED" &&
      !(await confirm({
        title: t("confirm.trustedPolicyTitle"),
        message: t("confirm.trustedPolicy", { name: peer.displayName }),
        confirmLabel: t("confirm.enableTrustedAction"),
        danger: true,
      }))
    ) {
      return;
    }
    setBusyPeer(peer.nodeId);
    setError(undefined);
    try {
      await api(`/peers/${peer.nodeId}/policy`, {
        method: "POST",
        body: JSON.stringify({ autoExecute }),
      });
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.policyUpdateFailed"));
    } finally {
      setBusyPeer(undefined);
    }
  };
  const createPairingBundle = async () => {
    setPairingBusy("create");
    setError(undefined);
    setCopied(false);
    try {
      setPairingBundle(
        await api<{ bundle: string; expiresAt: string }>(
          "/peers/pairing-bundle",
          {
            method: "POST",
            body: JSON.stringify({ expiresInMinutes: 10_080 }),
          },
        ),
      );
    } catch (cause) {
      setError(describeError(cause, t, "error.pairingExportFailed"));
    } finally {
      setPairingBusy(undefined);
    }
  };
  const copyPairingBundle = async () => {
    if (pairingBundle === undefined) return;
    setError(undefined);
    try {
      await navigator.clipboard.writeText(pairingBundle.bundle);
      setCopied(true);
    } catch (cause) {
      setError(describeError(cause, t, "error.copyFailed"));
    }
  };
  const importPairingBundle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const transport = form.get("pairingTransport");
    if (
      form.get("pairingAutoExecute") === "TRUSTED" &&
      !(await confirm({
        title: t("confirm.trustedPolicyTitle"),
        message: t("confirm.trustedNewPeer"),
        confirmLabel: t("confirm.enableTrustedAction"),
        danger: true,
      }))
    ) {
      return;
    }
    setPairingBusy("import");
    setError(undefined);
    try {
      await api("/peers/import", {
        method: "POST",
        body: JSON.stringify({
          bundle: form.get("pairingBundle"),
          ...(transport === "RELAY" || transport === "DIRECT"
            ? { transport }
            : {}),
          policy: {
            autoExecute: form.get("pairingAutoExecute"),
          },
        }),
      });
      formElement.reset();
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.pairingFailed"));
    } finally {
      setPairingBusy(undefined);
    }
  };
  const updatePeerConnection = async (
    nodeId: string,
    input: Record<string, unknown>,
  ) => {
    setBusyPeer(nodeId);
    setError(undefined);
    try {
      await api(`/peers/${nodeId}/connection`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.peerUpdateFailed"));
    } finally {
      setBusyPeer(undefined);
    }
  };
  const submitPeerConnection = async (
    nodeId: string,
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await updatePeerConnection(nodeId, {
      displayName: form.get("displayName"),
      transport: form.get("transport"),
      directUrl: String(form.get("directUrl") ?? "").trim() || null,
    });
  };
  const removePeer = async (peer: PeerView) => {
    if (
      !(await confirm({
        title: t("confirm.removePeerTitle"),
        message: t("settings.removeConfirmation", { name: peer.displayName }),
        confirmLabel: t("action.removePeer"),
        danger: true,
      }))
    ) {
      return;
    }
    setBusyPeer(peer.nodeId);
    setError(undefined);
    try {
      await api(`/peers/${peer.nodeId}`, { method: "DELETE" });
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.peerRemoveFailed"));
    } finally {
      setBusyPeer(undefined);
    }
  };
  const togglePeer = async (peer: PeerView) => {
    if (
      peer.enabled &&
      !(await confirm({
        title: t("confirm.disablePeerTitle"),
        message: t("confirm.disablePeer", { name: peer.displayName }),
        confirmLabel: t("action.disablePeer"),
        danger: true,
      }))
    ) {
      return;
    }
    await updatePeerConnection(peer.nodeId, { enabled: !peer.enabled });
  };
  return (
    <div className="squad-settings">
      <NodeSetupForm state={state} onConfigured={refresh} t={t} />
      <h2>{t("settings.nodeIdentity")}</h2>
      <p>{state.identity.displayName}</p>
      <code>{state.identity.nodeId}</code>
      <p>
        {t("settings.relay")}: {relayState}
      </p>
      <p>
        {t("settings.direct")}:{" "}
        {state.direct.serving
          ? t("settings.directServing")
          : t("settings.directNotServing")}
      </p>
      {state.direct.publicUrl ? <code>{state.direct.publicUrl}</code> : null}
      <p className="squad-muted">{t("settings.languageHint")}</p>
      <AutomationRules state={state} refresh={refresh} t={t} />
      <h2>{t("settings.peers")}</h2>
      {state.peers.length === 0 ? (
        <p className="squad-muted">{t("settings.noPeers")}</p>
      ) : null}
      {state.peers.map((peer) => {
        const busy = busyPeer === peer.nodeId;
        return (
          <article
            className={`squad-peer${peer.enabled ? "" : " squad-peer-disabled"}`}
            key={peer.nodeId}
          >
            <header>
              <div>
                <strong>{peer.displayName}</strong>
                <span>
                  {peer.transport === "DIRECT"
                    ? t("transport.DIRECT")
                    : t("transport.RELAY")}
                  {peer.enabled ? "" : ` · ${t("settings.peerDisabled")}`}
                </span>
              </div>
              <button
                type="button"
                className="squad-secondary"
                disabled={busyPeer !== undefined}
                onClick={() => void togglePeer(peer)}
              >
                {peer.enabled
                  ? t("action.disablePeer")
                  : t("action.enablePeer")}
              </button>
            </header>
            <code>{peer.nodeId}</code>
            {peer.directUrl ? <code>{peer.directUrl}</code> : null}
            <label>
              {t("settings.autoExecute")}
              <PolicySelect
                value={peer.policy.autoExecute}
                disabled={busyPeer !== undefined || !peer.enabled}
                t={t}
                onChange={(autoExecute) =>
                  void updatePeerPolicy(peer, autoExecute)
                }
              />
            </label>
            <details>
              <summary>{t("settings.editPeer")}</summary>
              <form
                onSubmit={(event) =>
                  void submitPeerConnection(peer.nodeId, event)
                }
              >
                <label>
                  {t("settings.displayName")}
                  <input
                    name="displayName"
                    defaultValue={peer.displayName}
                    required
                    maxLength={120}
                  />
                </label>
                <label>
                  {t("settings.transport")}
                  <select name="transport" defaultValue={peer.transport}>
                    <option value="RELAY" disabled={!state.relay.configured}>
                      {t("transport.RELAY")}
                    </option>
                    <option value="DIRECT">{t("transport.DIRECT")}</option>
                  </select>
                </label>
                <label>
                  {t("settings.directUrl")}
                  <input
                    name="directUrl"
                    type="url"
                    defaultValue={peer.directUrl ?? ""}
                    placeholder="https://bob.example.com"
                  />
                </label>
                <div className="squad-actions">
                  <button type="submit" disabled={busy}>
                    {busy ? t("action.saving") : t("action.saveChanges")}
                  </button>
                  <button
                    type="button"
                    className="squad-danger"
                    disabled={busyPeer !== undefined}
                    onClick={() => void removePeer(peer)}
                  >
                    {t("action.removePeer")}
                  </button>
                </div>
              </form>
            </details>
          </article>
        );
      })}
      {state.peers.some(
        (peer) => peer.enabled && peer.policy.autoExecute === "TRUSTED",
      ) ? (
        <p className="squad-warning">{t("settings.trustedWarning")}</p>
      ) : null}
      <section className="squad-pairing">
        <h3>{t("pairing.title")}</h3>
        <p className="squad-muted">{t("pairing.intro")}</p>
        <div className="squad-pairing-grid">
          <div>
            <h4>{t("pairing.shareTitle")}</h4>
            <p className="squad-muted">{t("pairing.shareHint")}</p>
            <button
              type="button"
              disabled={
                pairingBusy !== undefined ||
                (!state.relay.configured &&
                  state.direct.publicUrl === undefined)
              }
              onClick={() => void createPairingBundle()}
            >
              {pairingBusy === "create"
                ? t("pairing.creating")
                : t("pairing.create")}
            </button>
            {!state.relay.configured && state.direct.publicUrl === undefined ? (
              <p className="squad-warning">{t("pairing.unreachable")}</p>
            ) : null}
            {pairingBundle ? (
              <div className="squad-pairing-result">
                <label>
                  {t("pairing.bundle")}
                  <textarea readOnly rows={5} value={pairingBundle.bundle} />
                </label>
                <small>
                  {t("pairing.expires", {
                    time: new Date(pairingBundle.expiresAt).toLocaleString(),
                  })}
                </small>
                <button type="button" onClick={() => void copyPairingBundle()}>
                  {copied ? t("action.copied") : t("action.copy")}
                </button>
              </div>
            ) : null}
          </div>
          <form onSubmit={importPairingBundle}>
            <h4>{t("pairing.importTitle")}</h4>
            <label>
              {t("pairing.bundle")}
              <textarea
                name="pairingBundle"
                required
                rows={5}
                maxLength={32 * 1024}
                placeholder={t("pairing.bundlePlaceholder")}
              />
            </label>
            <label>
              {t("pairing.transport")}
              <select name="pairingTransport" defaultValue="AUTO">
                <option value="AUTO">{t("pairing.transportAuto")}</option>
                <option value="DIRECT">{t("transport.DIRECT")}</option>
                <option value="RELAY" disabled={!state.relay.configured}>
                  {t("transport.RELAY")}
                </option>
              </select>
            </label>
            <label>
              {t("settings.autoExecute")}
              <select name="pairingAutoExecute" defaultValue="NEVER">
                <option value="NEVER">{formatPolicy(t, "NEVER")}</option>
                <option value="SAFE">{formatPolicy(t, "SAFE")}</option>
                <option value="TRUSTED">{formatPolicy(t, "TRUSTED")}</option>
              </select>
            </label>
            <button type="submit" disabled={pairingBusy !== undefined}>
              {pairingBusy === "import"
                ? t("pairing.importing")
                : t("pairing.import")}
            </button>
          </form>
        </div>
      </section>
      <details className="squad-advanced-pairing">
        <summary>{t("settings.manualPairing")}</summary>
        <p className="squad-muted">{t("settings.manualPairingHint")}</p>
        <form onSubmit={submitManualPeer}>
          <label>
            {t("settings.displayName")}
            <input name="displayName" required maxLength={120} />
          </label>
          <label>
            {t("settings.nodeId")}
            <input name="nodeId" required />
          </label>
          <label>
            {t("settings.publicKey")}
            <textarea name="publicKey" required rows={5} />
          </label>
          <label>
            {t("settings.transport")}
            <select
              name="transport"
              defaultValue={state.relay.configured ? "RELAY" : "DIRECT"}
            >
              <option value="RELAY" disabled={!state.relay.configured}>
                {t("transport.RELAY")}
              </option>
              <option value="DIRECT">{t("transport.DIRECT")}</option>
            </select>
          </label>
          <label>
            {t("settings.directUrl")}
            <input
              name="directUrl"
              type="url"
              placeholder="https://bob.example.com"
            />
            <small>{t("settings.directUrlHint")}</small>
          </label>
          <label>
            {t("settings.autoExecute")}
            <select name="autoExecute" defaultValue="NEVER">
              <option value="NEVER">{formatPolicy(t, "NEVER")}</option>
              <option value="SAFE">{formatPolicy(t, "SAFE")}</option>
              <option value="TRUSTED">{formatPolicy(t, "TRUSTED")}</option>
            </select>
          </label>
          <button type="submit">{t("action.savePeer")}</button>
        </form>
      </details>
      {error ? <p className="squad-error">{error}</p> : null}
      {confirmation}
    </div>
  );
}

function UpdateCenter({
  state,
  refresh,
  t,
}: {
  state: LocalState;
  refresh: () => Promise<void>;
  t: SquadTranslate;
}) {
  const [busy, setBusy] = useState<"check" | "policy" | "install">();
  const [error, setError] = useState<string>();
  const { confirm, confirmation } = useConfirmation(t);
  const updates = state.updates;
  const run = async (
    action: "check" | "policy" | "install",
    operation: () => Promise<unknown>,
  ) => {
    setBusy(action);
    setError(undefined);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.updateActionFailed"));
    } finally {
      setBusy(undefined);
    }
  };
  const setMode = async (mode: UpdateMode) => {
    if (
      mode === "AUTOMATIC" &&
      !(await confirm({
        title: t("confirm.automaticUpdatesTitle"),
        message: t("updates.automaticConfirmation"),
        confirmLabel: t("confirm.enableAutomaticUpdatesAction"),
        danger: true,
      }))
    ) {
      return;
    }
    await run("policy", () =>
      api("/updates/policy", {
        method: "POST",
        body: JSON.stringify({ mode }),
      }),
    );
  };
  const requestInstall = async () => {
    if (
      !(await confirm({
        title: t("confirm.installUpdateTitle"),
        message: t("updates.installConfirmation"),
        confirmLabel: t("updates.installNow"),
      }))
    ) {
      return;
    }
    await run("install", () =>
      api("/updates/install", { method: "POST", body: "{}" }),
    );
  };
  return (
    <div className="squad-updates">
      <header>
        <div>
          <h2>{t("updates.title")}</h2>
          <p className="squad-muted">{t("updates.securityHint")}</p>
        </div>
        <span
          className={`squad-status squad-update-status-${updates.status.phase.toLowerCase()}`}
        >
          {formatUpdatePhase(t, updates.status.phase)}
        </span>
      </header>
      <div className="squad-update-summary">
        <div>
          <span>{t("updates.currentVersion")}</span>
          <strong>v{updates.currentVersion}</strong>
        </div>
        <div>
          <span>{t("updates.latestVersion")}</span>
          <strong>
            {updates.status.latestVersion === undefined
              ? t("updates.notChecked")
              : `v${updates.status.latestVersion}`}
          </strong>
        </div>
        <div>
          <span>{t("updates.lastChecked")}</span>
          <strong>
            {updates.status.checkedAt === undefined
              ? t("updates.notChecked")
              : new Date(updates.status.checkedAt).toLocaleString()}
          </strong>
        </div>
      </div>
      {updates.status.releaseUrl === undefined ? null : (
        <p>
          <a href={updates.status.releaseUrl} target="_blank" rel="noreferrer">
            {t("updates.openRelease")}
          </a>
        </p>
      )}
      <section className="squad-update-policy">
        <h3>{t("updates.policy")}</h3>
        <label>
          {t("updates.policyLabel")}
          <select
            value={updates.policy.mode}
            disabled={busy !== undefined}
            onChange={(event) => void setMode(event.target.value as UpdateMode)}
          >
            {(["DISABLED", "NOTIFY", "AUTOMATIC"] as const).map((mode) => (
              <option key={mode} value={mode}>
                {formatUpdateMode(t, mode)}
              </option>
            ))}
          </select>
        </label>
        <p className="squad-muted">
          {t(`updates.modeHint.${updates.policy.mode}`)}
        </p>
        {updates.policy.mode === "AUTOMATIC" ? (
          <p className="squad-warning">{t("updates.automaticWarning")}</p>
        ) : null}
      </section>
      <section>
        <h3>{t("updates.updater")}</h3>
        <p>
          {updates.automation === undefined
            ? t("updates.updaterNotConfigured")
            : t("updates.updaterConfigured", {
                unit: updates.automation.updaterUnit,
              })}
        </p>
        {updates.automation === undefined ? (
          <p className="squad-muted">{t("updates.updaterSetupHint")}</p>
        ) : null}
      </section>
      {updates.status.detail === undefined ? null : (
        <p className="squad-warning">
          {updates.status.errorCode === undefined
            ? updates.status.detail
            : t("error.withDetail", {
                message: formatErrorCode(t, updates.status.errorCode),
                detail: updates.status.detail,
              })}
        </p>
      )}
      {updates.installRequested ? (
        <p className="squad-notice">{t("updates.requestPending")}</p>
      ) : null}
      <div className="squad-actions">
        <button
          type="button"
          disabled={busy !== undefined}
          onClick={() =>
            void run("check", () =>
              api("/updates/check", { method: "POST", body: "{}" }),
            )
          }
        >
          {busy === "check" ? t("updates.checking") : t("updates.checkNow")}
        </button>
        <button
          type="button"
          disabled={
            busy !== undefined ||
            updates.automation === undefined ||
            updates.status.available !== true ||
            updates.installRequested
          }
          onClick={() => void requestInstall()}
        >
          {t("updates.installNow")}
        </button>
      </div>
      {error ? <p className="squad-error">{error}</p> : null}
      {confirmation}
    </div>
  );
}

interface SessionSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): string | undefined;
}

function SessionContextBar({
  state,
  currentSessionId,
  refresh,
  t,
}: {
  state: LocalState;
  currentSessionId: string | undefined;
  refresh: () => Promise<void>;
  t: SquadTranslate;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const selectedOrganizationId =
    currentSessionId === undefined
      ? ""
      : (state.sessionOrganizations[currentSessionId] ?? "");
  const selectedOrganization = state.organizations.find(
    (organization) => organization.organizationId === selectedOrganizationId,
  );
  const selectOrganization = async (organizationId: string) => {
    if (currentSessionId === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await api("/session-organization", {
        method: "POST",
        body: JSON.stringify({
          sessionId: currentSessionId,
          organizationId: organizationId || undefined,
        }),
      });
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.sessionOrganizationFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="squad-context-bar">
      <div>
        <span>{t("context.node")}</span>
        <strong>{state.identity.displayName}</strong>
        <code>{state.identity.nodeId}</code>
      </div>
      <div>
        <span>{t("context.session")}</span>
        {currentSessionId === undefined ? (
          <strong>{t("context.noSession")}</strong>
        ) : (
          <code>{currentSessionId}</code>
        )}
      </div>
      <label>
        {t("context.organization")}
        <select
          value={selectedOrganizationId}
          disabled={
            busy || currentSessionId === undefined || !state.relay.configured
          }
          onChange={(event) =>
            void selectOrganization(event.currentTarget.value)
          }
        >
          <option value="">{t("context.directPeers")}</option>
          {state.organizations
            .filter(
              (organization) => organization.membershipStatus === "ACTIVE",
            )
            .map((organization) => (
              <option
                key={organization.organizationId}
                value={organization.organizationId}
              >
                {organization.name} ·{" "}
                {organization.role
                  ? formatOrganizationRole(t, organization.role)
                  : ""}
              </option>
            ))}
        </select>
        <small>
          {!state.relay.configured
            ? t("context.relayRequired")
            : (selectedOrganization?.name ?? t("context.selectHint"))}
        </small>
      </label>
      {error ? <p className="squad-error">{error}</p> : null}
    </div>
  );
}

function SquadPanel({
  openSession,
  sessionSource,
  getLocale,
  t,
}: {
  openSession: (id: string) => void;
  sessionSource: SessionSource;
  getLocale: () => LocaleId;
  t: SquadTranslate;
}) {
  const open = usePanelOpen();
  const currentSessionId = useSyncExternalStore(
    sessionSource.subscribe,
    sessionSource.getSnapshot,
    () => undefined,
  );
  const [tab, setTab] = useState<Tab>("overview");
  const [state, setState] = useState<LocalState>();
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();
  const lastFocused = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api<LocalState>("/state"));
      setError(undefined);
    } catch (cause) {
      setError(describeError(cause, t, "error.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement | null;
    void refresh();
    const events = new EventSource("/squad/v1/local/events");
    const stateChanged = () => void refresh();
    events.addEventListener("state", stateChanged);
    return () => {
      events.removeEventListener("state", stateChanged);
      events.close();
      lastFocused.current?.focus();
    };
  }, [open, refresh]);

  useEffect(() => {
    if (open) void refresh();
  }, [currentSessionId, open, refresh]);

  const items = useMemo(
    () => (state?.delegations ?? []).filter((item) => belongs(tab, item)),
    [state, tab],
  );
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const plans = state?.plans ?? [];
  const selectedPlan = plans.find((plan) => plan.id === selectedId) ?? plans[0];
  const attention = state === undefined ? undefined : localAttention(state);
  const locale = getLocale() === "zh" ? "zh-CN" : "en";
  if (!open) return null;
  return (
    <div
      className="squad-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("inbox.title")}
    >
      <button
        className="squad-backdrop"
        aria-label={t("inbox.close")}
        onClick={() => setPanelOpen(false)}
      />
      <div className="squad-panel" lang={t("html.lang")}>
        <header className="squad-panel-head">
          <div>
            <span className="squad-eyebrow">DSH Squad</span>
            <h1>{t("inbox.title")}</h1>
          </div>
          <button
            className="squad-close"
            onClick={() => setPanelOpen(false)}
            aria-label={t("close")}
          >
            ×
          </button>
        </header>
        {state?.setup.required ? (
          <NodeSetupForm
            state={state}
            onboarding
            onConfigured={refresh}
            onLater={() => setPanelOpen(false)}
            t={t}
          />
        ) : null}
        {state && !state.setup.required ? (
          <SessionContextBar
            state={state}
            currentSessionId={currentSessionId}
            refresh={refresh}
            t={t}
          />
        ) : null}
        {state && !state.setup.required ? (
          <nav className="squad-tabs" aria-label={t("nav.label")}>
            {tabGroups.map((group) => (
              <div
                className="squad-tab-group"
                role="tablist"
                aria-label={t(group.label)}
                key={group.label}
              >
                <span className="squad-tab-group-label">{t(group.label)}</span>
                {group.tabs.map((value) => (
                  <button
                    key={value}
                    className={tab === value ? "active" : ""}
                    onClick={() => {
                      setTab(value);
                      setSelectedId(undefined);
                    }}
                    role="tab"
                    aria-selected={tab === value}
                    tabIndex={tab === value ? 0 : -1}
                  >
                    {t(tabKeys[value])}
                    {value === "waiting" &&
                    attention !== undefined &&
                    attention.waitingHuman > 0 ? (
                      <span className="squad-tab-count">
                        {attention.waitingHuman}
                      </span>
                    ) : null}
                    {value === "organizations" &&
                    attention !== undefined &&
                    attention.pendingJoinRequests > 0 ? (
                      <span className="squad-tab-count">
                        {attention.pendingJoinRequests}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        ) : null}
        {state === undefined ? (
          <div className="squad-loading" role="status">
            <span className="squad-spinner" aria-hidden="true" />
            <strong>{t("loading.title")}</strong>
            {error ? (
              <>
                <p className="squad-error">{error}</p>
                <button onClick={() => void refresh()}>
                  {t("action.retry")}
                </button>
              </>
            ) : null}
          </div>
        ) : error ? (
          <p className="squad-error squad-load-error">{error}</p>
        ) : null}
        {state?.setup.required ? null : tab === "overview" && state ? (
          <Overview
            state={state}
            navigate={(next) => {
              setTab(next);
              setSelectedId(undefined);
            }}
            t={t}
          />
        ) : tab === "organizations" && state ? (
          <OrganizationCenter state={state} refresh={refresh} t={t} />
        ) : tab === "diagnostics" && state ? (
          <ConnectionDiagnostics state={state} refresh={refresh} t={t} />
        ) : tab === "updates" && state ? (
          <UpdateCenter state={state} refresh={refresh} t={t} />
        ) : tab === "settings" && state ? (
          <Settings state={state} refresh={refresh} t={t} />
        ) : tab === "plans" && state ? (
          <div className="squad-content">
            <aside className="squad-list">
              {plans.length === 0 ? (
                <p className="squad-empty">{t("empty.plans")}</p>
              ) : null}
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  className={selectedPlan?.id === plan.id ? "active" : ""}
                  onClick={() => setSelectedId(plan.id)}
                >
                  <strong>{plan.title}</strong>
                  <span>
                    {formatPlanStatus(t, plan.status)} ·{" "}
                    {new Date(plan.updatedAt).toLocaleString(locale)}
                  </span>
                  <span>
                    {t("plan.itemCount", { count: plan.items.length })}
                  </span>
                </button>
              ))}
            </aside>
            <main>
              {selectedPlan ? (
                <TeamPlanDetail
                  plan={selectedPlan}
                  state={state}
                  refresh={refresh}
                  openDelegation={(id, status) => {
                    setTab(
                      ["COMPLETED", "REJECTED", "FAILED", "CANCELED"].includes(
                        status,
                      )
                        ? "completed"
                        : "sent",
                    );
                    setSelectedId(id);
                  }}
                  t={t}
                />
              ) : (
                <p className="squad-empty">{t("empty.planSelection")}</p>
              )}
            </main>
          </div>
        ) : (
          <div className="squad-content">
            <aside className="squad-list">
              {items.length === 0 ? (
                <p className="squad-empty">
                  {tab === "sent"
                    ? t("empty.sent")
                    : tab === "completed"
                      ? t("empty.completed")
                      : t("empty.list")}
                </p>
              ) : null}
              {items.map((item) => (
                <button
                  key={item.id}
                  className={selected?.id === item.id ? "active" : ""}
                  onClick={() => setSelectedId(item.id)}
                >
                  <strong>{item.objective}</strong>
                  <span>
                    {formatStatus(t, item.status)} ·{" "}
                    {new Date(item.updatedAt).toLocaleString(locale)}
                  </span>
                </button>
              ))}
            </aside>
            <main>
              {selected ? (
                <DelegationDetail
                  item={selected}
                  refresh={refresh}
                  openSession={openSession}
                  t={t}
                />
              ) : (
                <p className="squad-empty">{t("empty.selection")}</p>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

const css = `
.squad-trigger{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:10px;display:flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 9px;font:inherit;white-space:nowrap}.squad-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}.squad-trigger-wide{width:100%;justify-content:flex-start}.squad-trigger-icon{font-size:20px;line-height:1}.squad-overlay{position:fixed;inset:0;z-index:1000;pointer-events:none}.squad-backdrop{position:absolute;inset:0;border:0;background:rgba(10,14,22,.34);pointer-events:auto}.squad-panel{position:absolute;pointer-events:auto;top:12px;bottom:12px;right:12px;width:min(920px,calc(100vw - 24px));border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:18px;background:var(--dsw-specific-dialog-fill,#fff);color:var(--dsw-alias-label-primary,#151515);box-shadow:0 18px 60px rgba(0,0,0,.24);display:flex;flex-direction:column;overflow:hidden}.squad-panel-head{display:flex;justify-content:space-between;align-items:center;padding:22px 24px 12px}.squad-panel-head h1{font-size:24px;margin:2px 0}.squad-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#666)}.squad-close{border:0;background:transparent;color:inherit;font-size:30px;cursor:pointer}.squad-tabs{display:flex;gap:4px;padding:0 18px 14px;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-tabs button{border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#666);padding:7px 12px;cursor:pointer;white-space:nowrap}.squad-tabs button.active{background:var(--dsw-alias-interactive-bg-hover,#eee);color:var(--dsw-alias-label-primary,#111)}.squad-content{display:grid;grid-template-columns:290px minmax(0,1fr);min-height:0;flex:1}.squad-list{border-right:1px solid var(--dsw-alias-border-l2,#ddd);padding:10px;overflow:auto}.squad-list button{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;border-radius:12px;padding:12px;cursor:pointer}.squad-list button:hover,.squad-list button.active{background:var(--dsw-alias-interactive-bg-hover,#eee)}.squad-list strong,.squad-list span{display:block}.squad-list strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.squad-list span{font-size:12px;margin-top:5px;color:var(--dsw-alias-label-secondary,#666)}.squad-content main,.squad-settings{overflow:auto;padding:22px 26px}.squad-detail>header{display:flex;align-items:center;gap:10px}.squad-detail h2{font-size:22px;line-height:1.35}.squad-detail h3,.squad-settings h3{font-size:14px;margin:24px 0 8px}.squad-detail dl{display:grid;gap:5px}.squad-detail dl div{display:grid;grid-template-columns:78px 1fr;gap:10px}.squad-detail dt{color:var(--dsw-alias-label-secondary,#666)}.squad-detail dd{margin:0;overflow-wrap:anywhere}.squad-status{font-size:11px;font-weight:700;border-radius:999px;padding:4px 8px;background:#e8edf6}.squad-status-completed,.squad-plan-status-dispatched{background:#dff5e6;color:#176c35}.squad-status-failed,.squad-status-rejected,.squad-plan-status-partial{background:#fde4e1;color:#a52a24}.squad-status-waiting_human,.squad-plan-status-draft,.squad-plan-status-dispatching{background:#fff0c7;color:#755400}.squad-direction,.squad-muted{color:var(--dsw-alias-label-secondary,#666);font-size:12px}.squad-prewrap{white-space:pre-wrap;overflow-wrap:anywhere}.squad-todo{border-left:3px solid #d59b1b;padding:2px 12px;margin:10px 0}.squad-todo p{margin:5px 0}.squad-todo-select{display:flex!important;align-items:center;grid-template-columns:auto 1fr!important}.squad-todo-select input{width:auto!important}.squad-detail label,.squad-settings label{display:grid;gap:6px;margin:12px 0;font-size:13px}.squad-detail textarea,.squad-settings textarea,.squad-settings input,.squad-settings select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:9px;background:transparent;color:inherit;padding:9px;font:inherit}.squad-actions{display:flex;gap:8px;margin:12px 0;flex-wrap:wrap}.squad-detail button,.squad-settings button{border:0;border-radius:9px;padding:8px 12px;background:#315ee8;color:#fff;cursor:pointer}.squad-detail button:disabled{opacity:.5}.squad-detail .squad-danger{background:#b13c35}.squad-detail .squad-link-button{display:block;margin:9px 0;background:transparent;color:#315ee8;padding-left:0}.squad-error{color:#b13c35}.squad-load-error{padding:0 24px}.squad-empty{color:var(--dsw-alias-label-secondary,#666);padding:12px}.squad-settings{max-width:680px}.squad-settings code,.squad-peer code,.squad-plan-item code{display:block;overflow-wrap:anywhere;font-size:11px}.squad-peer{display:grid;grid-template-columns:150px 1fr auto;gap:10px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-plan-items{display:grid;gap:12px}.squad-plan-item{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;padding:14px}.squad-plan-item>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.squad-plan-item>header strong{line-height:1.4}.squad-plan-item-status{font-size:11px;white-space:nowrap;color:var(--dsw-alias-label-secondary,#666)}.squad-plan-item-status-failed{color:#b13c35}.squad-plan-item-status-dispatched{color:#176c35}.squad-plan-item dl{margin-bottom:0}.squad-plan-item ul{margin:4px 0;padding-left:20px}.squad-plan-item a{color:#315ee8}
@media(max-width:700px){.squad-panel{inset:0;width:auto;border-radius:0}.squad-content{grid-template-columns:1fr}.squad-list{max-height:180px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-peer{grid-template-columns:1fr}.squad-panel-head{padding:16px}.squad-content main,.squad-settings{padding:16px}}
.squad-context-bar{display:grid;grid-template-columns:minmax(150px,1fr) minmax(150px,1fr) minmax(220px,1.4fr);gap:14px;margin:0 22px 12px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;background:var(--dsw-alias-interactive-bg-hover,#f6f7f9)}.squad-context-bar>div,.squad-context-bar>label{display:grid;align-content:start;gap:4px;min-width:0;margin:0;font-size:12px}.squad-context-bar span,.squad-context-bar small{color:var(--dsw-alias-label-secondary,#666)}.squad-context-bar code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.squad-context-bar select,.squad-organizations input,.squad-organizations textarea,.squad-organizations select,.squad-peer select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:9px;background:var(--dsw-specific-dialog-fill,#fff);color:inherit;padding:8px;font:inherit}.squad-organizations{overflow:auto;padding:20px 24px;flex:1}.squad-organizations button{border:0;border-radius:9px;padding:8px 12px;background:#315ee8;color:#fff;cursor:pointer}.squad-organizations button:disabled{opacity:.5}.squad-organizations .squad-danger{background:#b13c35}.squad-organizations .squad-secondary{border:1px solid var(--dsw-alias-border-l2,#ccc);background:transparent;color:inherit}.squad-organization-intro{display:grid;grid-template-columns:1fr 1.35fr;gap:22px}.squad-organization-intro h2,.squad-organization-card h2{margin:0}.squad-organization-forms{display:grid;grid-template-columns:1fr 1fr;gap:12px}.squad-organization-forms form{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;padding:12px}.squad-organization-forms h3{margin:0 0 8px;font-size:13px}.squad-organizations label{display:grid;gap:5px;margin:8px 0;font-size:12px}.squad-organization-list{display:grid;gap:16px;margin-top:18px}.squad-organization-card{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:14px;padding:16px}.squad-organization-card>header{display:flex;justify-content:space-between;gap:16px}.squad-organization-card code,.squad-invitation-result code,.squad-member code,.squad-join-request code{display:block;font-size:11px;overflow-wrap:anywhere}.squad-organization-badges{display:flex;align-items:flex-start;gap:6px}.squad-organization-badges span,.squad-member-role>span{font-size:11px;border-radius:999px;padding:4px 8px;background:var(--dsw-alias-interactive-bg-hover,#eee);white-space:nowrap}.squad-organization-admin{display:flex;align-items:end;gap:8px;margin:12px 0;flex-wrap:wrap}.squad-organization-admin label{margin:0;max-width:210px}.squad-join-request{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-join-actions{display:flex;gap:7px;flex-wrap:wrap}.squad-member-list{display:grid;gap:8px}.squad-member{display:grid;grid-template-columns:minmax(170px,1.4fr) minmax(130px,.8fr) minmax(150px,1fr) auto;align-items:center;gap:10px;padding:10px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover,#f4f5f7)}.squad-member-role{display:flex;align-items:center;gap:6px}.squad-policy-control{margin:0!important}.squad-invitation-result{display:grid;gap:7px;margin-top:14px;padding:13px;border:1px solid #d59b1b;border-radius:12px;background:#fff8e5;color:#5d470a}.squad-notice{padding:10px 12px;border-radius:9px;background:#dff5e6;color:#176c35}.squad-warning{padding:10px 12px;border-radius:9px;background:#fff0c7;color:#755400;font-size:12px}
.squad-invitation-history{margin:12px 0;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px;padding:10px 12px}.squad-invitation-history>summary{cursor:pointer;font-size:13px;font-weight:600}.squad-invitation-list{display:grid;gap:8px}.squad-invitation-list>article{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover,#f4f5f7)}.squad-invitation-list>article>div{display:grid;gap:3px;min-width:0}.squad-invitation-list span{font-size:11px;color:var(--dsw-alias-label-secondary,#666);overflow-wrap:anywhere}@media(max-width:700px){.squad-invitation-list>article{display:grid}}
@media(max-width:700px){.squad-context-bar,.squad-organization-intro,.squad-organization-forms{grid-template-columns:1fr}.squad-context-bar{margin:0 12px 10px}.squad-organizations{padding:16px}.squad-member{grid-template-columns:1fr}.squad-organization-card>header{display:grid}}
.squad-node-setup{box-sizing:border-box;overflow:auto;width:100%;max-width:720px;padding:4px 0 20px}.squad-onboarding{align-self:center;flex:1;padding:18px 30px 34px}.squad-node-setup>header{margin-bottom:18px}.squad-node-setup>header h2{font-size:26px;margin:7px 0}.squad-node-setup>header p{color:var(--dsw-alias-label-secondary,#666);line-height:1.55;max-width:620px}.squad-step{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#315ee8}.squad-node-setup label{display:grid;gap:6px;margin:13px 0;font-size:13px}.squad-node-setup input,.squad-node-setup textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:9px;background:transparent;color:inherit;padding:9px;font:inherit}.squad-node-setup input:disabled{opacity:.55}.squad-node-setup small{color:var(--dsw-alias-label-secondary,#666);line-height:1.45}.squad-mode-picker{display:grid;grid-template-columns:1fr 1fr;gap:10px;border:0;margin:18px 0;padding:0}.squad-mode-picker legend{grid-column:1/-1;padding:0 0 8px;font-size:13px;font-weight:600}.squad-node-setup .squad-mode-picker button{display:grid;gap:6px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:12px;background:transparent;color:inherit;padding:14px;text-align:left;cursor:pointer}.squad-node-setup .squad-mode-picker button.active{border-color:#315ee8;background:rgba(49,94,232,.08);box-shadow:inset 0 0 0 1px #315ee8}.squad-mode-picker button span{color:var(--dsw-alias-label-secondary,#666);font-size:12px;line-height:1.4}.squad-setup-fields{padding:2px 14px;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover,#f6f7f9)}.squad-node-setup .squad-check{display:flex;align-items:center;gap:9px}.squad-node-setup .squad-check input{width:auto}.squad-node-setup button[type=submit]{border:0;border-radius:9px;padding:9px 14px;background:#315ee8;color:#fff;cursor:pointer}.squad-node-setup button:disabled{opacity:.55;cursor:not-allowed}.squad-node-setup .squad-secondary{border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:9px;padding:8px 13px;background:transparent;color:inherit;cursor:pointer}.squad-settings .squad-node-setup{border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);margin-bottom:22px}.squad-settings .squad-node-setup>h2{margin-top:0}.squad-onboarding-join{padding:14px;border:1px solid #315ee8;border-radius:12px;background:rgba(49,94,232,.06)}.squad-onboarding-join h3{margin:0}.squad-onboarding-join p{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}.squad-form-divider{display:flex;align-items:center;gap:10px;margin:18px 0;color:var(--dsw-alias-label-secondary,#666);font-size:12px}.squad-form-divider:before,.squad-form-divider:after{content:"";height:1px;flex:1;background:var(--dsw-alias-border-l2,#ddd)}
.squad-setup-fields hr{border:0;border-top:1px solid var(--dsw-alias-border-l2,#ddd);margin:16px 0}.squad-connection-required{display:grid;align-content:center;justify-items:start;max-width:620px}.squad-connection-required h2{margin-bottom:0}
@media(max-width:700px){.squad-onboarding{padding:10px 16px 24px}.squad-mode-picker{grid-template-columns:1fr}.squad-node-setup>header h2{font-size:22px}}
.squad-updates{overflow:auto;padding:22px 26px;max-width:760px}.squad-updates>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.squad-updates h2{margin:0}.squad-updates h3{font-size:14px;margin:24px 0 8px}.squad-updates label{display:grid;gap:6px;margin:12px 0;font-size:13px}.squad-updates select{box-sizing:border-box;width:100%;max-width:360px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:9px;background:var(--dsw-specific-dialog-fill,#fff);color:inherit;padding:9px;font:inherit}.squad-updates button{border:0;border-radius:9px;padding:8px 12px;background:#315ee8;color:#fff;cursor:pointer}.squad-updates button:disabled{opacity:.5;cursor:not-allowed}.squad-updates a{color:#315ee8}.squad-update-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}.squad-update-summary>div{display:grid;gap:5px;padding:13px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:11px}.squad-update-summary span{font-size:11px;color:var(--dsw-alias-label-secondary,#666)}.squad-update-summary strong{overflow-wrap:anywhere}.squad-update-status-failed,.squad-update-status-rolled_back{background:#fde4e1;color:#a52a24}.squad-update-status-available,.squad-update-status-requested,.squad-update-status-blocked{background:#fff0c7;color:#755400}.squad-update-status-installed,.squad-update-status-up_to_date{background:#dff5e6;color:#176c35}@media(max-width:700px){.squad-updates{padding:16px}.squad-update-summary{grid-template-columns:1fr}}
.squad-trigger{position:relative}.squad-trigger-badge,.squad-tab-count{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#b13c35;color:#fff;font-size:10px;font-weight:700;line-height:1}.squad-trigger:not(.squad-trigger-wide) .squad-trigger-badge{position:absolute;right:0;top:-2px}.squad-tabs button{display:inline-flex;align-items:center;gap:6px}.squad-tabs button.active .squad-tab-count{background:#315ee8}.squad-overview{overflow:auto;padding:24px 28px;flex:1}.squad-overview>header h2{margin:4px 0}.squad-attention-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:20px 0}.squad-attention-grid button{display:grid;gap:5px;text-align:left;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;background:transparent;color:inherit;padding:14px;cursor:pointer}.squad-attention-grid button.needs-attention{border-color:#d59b1b;background:#fff8e5;color:#5d470a}.squad-attention-grid strong{font-size:24px}.squad-attention-grid span{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}.squad-next-step{margin-top:18px;padding:18px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:14px}.squad-next-step h3{margin:0 0 7px}.squad-next-step code{display:block;padding:10px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover,#f4f5f7);overflow-wrap:anywhere}.squad-next-step button,.squad-update-callout{border:0;border-radius:9px;padding:8px 12px;margin-top:12px;background:#315ee8;color:#fff;cursor:pointer}.squad-update-callout{display:block;width:100%;text-align:left;background:#fff0c7;color:#755400}@media(max-width:700px){.squad-attention-grid{grid-template-columns:1fr 1fr}.squad-overview{padding:18px 16px}}
.squad-tabs{align-items:stretch}.squad-tab-group{display:flex;align-items:center;gap:4px;padding-right:10px;border-right:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-tab-group:last-child{border-right:0}.squad-tab-group-label{align-self:center;color:var(--dsw-alias-label-secondary,#666);font-size:10px;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}.squad-loading{display:grid;place-items:center;align-content:center;gap:12px;min-height:260px;flex:1;padding:24px;text-align:center}.squad-loading button{border:0;border-radius:9px;padding:8px 12px;background:#315ee8;color:#fff;cursor:pointer}.squad-spinner{width:24px;height:24px;border:3px solid var(--dsw-alias-border-l2,#ddd);border-top-color:#315ee8;border-radius:50%;animation:squad-spin .8s linear infinite}@keyframes squad-spin{to{transform:rotate(360deg)}}@media(max-width:700px){.squad-tab-group-label{display:none}.squad-tab-group{padding-right:4px}}
.squad-diagnostics{overflow:auto;padding:22px 26px;flex:1}.squad-diagnostics>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.squad-diagnostics>header h2{margin:0}.squad-diagnostics button{border:0;border-radius:9px;padding:8px 12px;background:#315ee8;color:#fff;cursor:pointer}.squad-diagnostics button:disabled{opacity:.5}.squad-diagnostic-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px}.squad-diagnostic-grid article{min-width:0;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:13px;padding:14px}.squad-diagnostic-grid article>header{display:flex;align-items:center;justify-content:space-between;gap:10px}.squad-diagnostic-grid h3{margin:0;font-size:14px}.squad-diagnostic-grid code{display:block;margin:10px 0;overflow-wrap:anywhere;font-size:11px}.squad-diagnostic-grid p,.squad-diagnostic-grid dl{font-size:12px}.squad-diagnostic-grid dl div{display:grid;gap:3px}.squad-diagnostic-grid dt{color:var(--dsw-alias-label-secondary,#666)}.squad-diagnostic-grid dd{margin:0}.squad-connection-unreachable{background:#fde4e1;color:#a52a24}.squad-connection-unverified{background:#fff0c7;color:#755400}.squad-connection-connected,.squad-connection-ready,.squad-connection-serving{background:#dff5e6;color:#176c35}@media(max-width:800px){.squad-diagnostic-grid{grid-template-columns:1fr}.squad-diagnostics{padding:16px}}
.squad-settings>.squad-peer{display:grid;grid-template-columns:1fr;gap:8px;margin:10px 0;padding:14px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px}.squad-peer>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.squad-peer>header span{display:block;margin-top:4px;color:var(--dsw-alias-label-secondary,#666);font-size:12px}.squad-peer-disabled{opacity:.72}.squad-peer details,.squad-advanced-pairing{margin-top:8px}.squad-peer summary,.squad-advanced-pairing summary{cursor:pointer;color:#315ee8;font-size:13px}.squad-settings .squad-secondary{border:1px solid var(--dsw-alias-border-l2,#ccc);background:transparent;color:inherit}.squad-settings button:disabled{opacity:.5;cursor:not-allowed}.squad-pairing{margin-top:24px;padding-top:2px}.squad-pairing-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.squad-pairing-grid>div,.squad-pairing-grid>form{min-width:0;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;padding:14px}.squad-pairing-grid h4{margin:0 0 7px}.squad-pairing-result{display:grid;gap:8px;margin-top:12px}.squad-pairing-result textarea{font-family:monospace;font-size:11px}.squad-advanced-pairing{margin:20px 0;padding:14px;border:1px dashed var(--dsw-alias-border-l2,#ccc);border-radius:12px}@media(max-width:700px){.squad-pairing-grid{grid-template-columns:1fr}}
.squad-confirm-layer{position:fixed;z-index:1100;inset:0;display:grid;place-items:center;padding:20px;background:rgba(10,14,22,.52);pointer-events:auto}.squad-confirm-dialog{box-sizing:border-box;width:min(460px,100%);padding:22px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:15px;background:var(--dsw-specific-dialog-fill,#fff);color:var(--dsw-alias-label-primary,#151515);box-shadow:0 18px 60px rgba(0,0,0,.3)}.squad-confirm-dialog h2{margin:0 0 10px;font-size:20px}.squad-confirm-dialog p{line-height:1.55;white-space:pre-wrap}.squad-confirm-dialog button{border:0;border-radius:9px;padding:9px 13px;background:#315ee8;color:#fff;cursor:pointer}.squad-confirm-dialog .squad-secondary{border:1px solid var(--dsw-alias-border-l2,#ccc);background:transparent;color:inherit}.squad-confirm-dialog .squad-danger{background:#b13c35;color:#fff}
.squad-detail input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:9px;background:transparent;color:inherit;padding:9px;font:inherit}.squad-todo{border:1px solid var(--dsw-alias-border-l2,#ddd);border-left:3px solid #d59b1b;border-radius:10px;padding:14px;margin:12px 0}.squad-todo>header{display:flex;align-items:center;justify-content:space-between;gap:10px}.squad-attachment-editor{margin:14px 0;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-attachment-editor>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.squad-attachment-editor>header div{display:grid;gap:4px}.squad-attachment-editor small{display:block;color:var(--dsw-alias-label-secondary,#666);line-height:1.4}.squad-attachment-editor fieldset{margin:12px 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px}.squad-attachment-editor legend{padding:0 5px;font-size:12px;font-weight:600}.squad-attachment-fields{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(130px,.7fr);gap:0 10px}.squad-detail .squad-secondary{border:1px solid var(--dsw-alias-border-l2,#ccc);background:transparent;color:inherit}.squad-detail .squad-danger-text{color:#b13c35}.squad-todo button[type=submit]{margin-top:4px}@media(max-width:700px){.squad-attachment-editor>header,.squad-attachment-fields{display:grid;grid-template-columns:1fr}.squad-attachment-editor>header button{justify-self:start}}
.squad-automation{margin:24px 0;padding:18px 0;border-top:1px solid var(--dsw-alias-border-l2,#ddd);border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-automation>h2{margin:0}.squad-automation-list{display:grid;gap:10px;margin:14px 0}.squad-automation-list>article{padding:13px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px}.squad-automation-list>article.disabled{opacity:.68}.squad-automation-list>article>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.squad-automation-list>article>header>div:first-child{display:grid;gap:4px}.squad-automation-list>article>header span{font-size:11px;color:var(--dsw-alias-label-secondary,#666)}.squad-automation-list code{display:block;margin-top:9px;overflow-wrap:anywhere}.squad-automation-list form{margin-top:14px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-automation-limits{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 10px}.squad-settings .squad-check{display:flex;align-items:center;gap:9px}.squad-settings .squad-check input{width:auto}.squad-automation-create{margin-top:12px;padding:12px;border:1px dashed var(--dsw-alias-border-l2,#ccc);border-radius:12px}.squad-automation-create>summary{cursor:pointer;color:#315ee8}.squad-automation-create form{margin-top:12px}.squad-automation small{color:var(--dsw-alias-label-secondary,#666);line-height:1.4}@media(max-width:700px){.squad-automation-list>article>header,.squad-automation-limits{display:grid;grid-template-columns:1fr}}
.squad-plan-editor input,.squad-plan-editor textarea,.squad-plan-editor select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:9px;background:var(--dsw-specific-dialog-fill,#fff);color:inherit;padding:9px;font:inherit}.squad-plan-editor-items{display:grid;gap:14px;margin:16px 0}.squad-plan-editor-item{min-width:0;margin:0;padding:14px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px}.squad-plan-editor-item>legend{padding:0 6px;font-size:13px;font-weight:700}.squad-plan-editor-order{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.squad-plan-editor-order .squad-link-button{margin:0 0 0 auto}.squad-plan-editor .squad-attachment-editor{margin-top:18px}.squad-plan-editor>button.squad-secondary{margin-top:2px}@media(max-width:700px){.squad-plan-editor-order .squad-link-button{margin-left:0}.squad-plan-editor-item{padding:11px}}
.squad-plan-rollup{margin:16px 0}.squad-plan-progress{height:7px;overflow:hidden;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,#eee)}.squad-plan-progress>span{display:block;height:100%;border-radius:inherit;background:#315ee8;transition:width .2s ease}.squad-plan-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:10px}.squad-plan-metrics>div{display:grid;gap:2px;padding:9px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:9px}.squad-plan-metrics>div.problem{border-color:#b13c35;background:#fde4e1;color:#a52a24}.squad-plan-metrics strong{font-size:18px}.squad-plan-metrics span{font-size:10px;color:var(--dsw-alias-label-secondary,#666)}.squad-plan-result{margin-top:12px;padding-top:1px;border-top:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-plan-result h4{margin:10px 0 5px;font-size:12px}@media(max-width:700px){.squad-plan-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

function installStyles(): () => void {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@dsh-squad/plugin";
  tag.textContent = css;
  document.head.appendChild(tag);
  return () => tag.remove();
}

export const inject = ["slots", "sessions", "locale"];

export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(SQUAD_LOCALE_NS, { zh, en }),
    "dsh-squad locale dictionaries",
  );
  ctx.effect(installStyles, "dsh-squad styles");
  const t = ctx.locale.bind(SQUAD_LOCALE_NS);
  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "dsh-squad-inbox",
        order: 30,
        label: () => t("inbox.title"),
        locale: SQUAD_LOCALE_NS,
      },
      SquadTrigger,
    ),
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-squad-panel",
        order: 30,
        locale: SQUAD_LOCALE_NS,
        inject: () => ({
          getLocale: () => ctx.locale.getLocale().active,
          sessionSource: {
            subscribe: (listener: () => void) =>
              ctx.sessions.list.subscribe(listener),
            getSnapshot: () => ctx.sessions.list.getSnapshot().current,
          },
          openSession: (id: string) => {
            ctx.sessions.open(id as SessionId);
            setPanelOpen(false);
          },
        }),
      },
      SquadPanel,
    ),
  );
  ctx.effect(
    () => () => {
      panelOpen = false;
      panelListeners.clear();
      attentionEvents?.close();
      attentionEvents = undefined;
      attentionSnapshot = undefined;
      attentionListeners.clear();
    },
    "dsh-squad client state",
  );
}
