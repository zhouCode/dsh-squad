import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import type {
  ClientContext,
  SessionId,
} from "@deepseek-ai/dsh-client-runtime/client";
import type { LocaleId } from "@deepseek-ai/dsh-client-locale/client";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import type { SidebarFooterActionOwnerProps } from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type { TeamPlan, TeamPlanStatus } from "../shared/contracts.ts";
import type { OrganizationView } from "../shared/organizations.ts";
import type { DelegationStatus } from "../shared/state.ts";
import type { UpdateMode, UpdateSnapshot } from "../shared/updates.ts";
import {
  SQUAD_LOCALE_NS,
  en,
  formatDelivery,
  formatErrorCode,
  formatOrganizationRole,
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
  identity: { nodeId: string; displayName: string; publicKey: string };
  relay: { configured: boolean; serving: boolean };
  direct: { serving: boolean; publicUrl?: string };
  peers: PeerView[];
  organizations: OrganizationView[];
  sessionOrganizations: Record<string, string>;
  revision: number;
  plans: TeamPlan[];
  delegations: DelegationView[];
  updates: UpdateSnapshot;
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

function describeError(
  cause: unknown,
  t: SquadTranslate,
  fallback: SquadLocaleKey,
): string {
  if (cause instanceof SquadApiError) {
    const detail = cause.message || cause.code;
    return t("error.withDetail", { message: t(fallback), detail });
  }
  return cause instanceof Error ? cause.message : t(fallback);
}

function SquadTrigger({
  wide,
  t,
}: SidebarFooterActionOwnerProps & PropsLocale<typeof SQUAD_LOCALE_NS>) {
  const open = usePanelOpen();
  return (
    <button
      className={`squad-trigger ${wide ? "squad-trigger-wide" : ""}`}
      type="button"
      aria-label={t("inbox.title")}
      aria-expanded={open}
      title={t("inbox.title")}
      lang={t("html.lang")}
      onClick={() => setPanelOpen(!open)}
    >
      <span className="squad-trigger-icon" aria-hidden="true">
        ⇄
      </span>
      {wide ? <span>{t("inbox.title")}</span> : null}
    </button>
  );
}

type Tab =
  | "plans"
  | "waiting"
  | "running"
  | "sent"
  | "completed"
  | "organizations"
  | "updates"
  | "settings";

const tabKeys = {
  plans: "tab.plans",
  waiting: "tab.waiting",
  running: "tab.running",
  sent: "tab.sent",
  completed: "tab.completed",
  organizations: "tab.organizations",
  updates: "tab.updates",
  settings: "tab.settings",
} as const satisfies Record<Tab, SquadLocaleKey>;

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
  const [response, setResponse] = useState("");
  const [attachmentJson, setAttachmentJson] = useState("");
  const [selectedTodoIds, setSelectedTodoIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const act = async (action: string, body: unknown = {}) => {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/delegations/${item.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResponse("");
      setAttachmentJson("");
      await refresh();
    } catch (cause) {
      setError(describeError(cause, t, "error.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const openTodos = item.todos.filter((todo) => todo.status === "OPEN");
  const openTodoKey = openTodos.map((todo) => todo.id).join(":");
  useEffect(() => {
    setSelectedTodoIds((current) => {
      const retained = current.filter((id) =>
        openTodos.some((todo) => todo.id === id),
      );
      return retained.length > 0 ? retained : openTodos.map((todo) => todo.id);
    });
  }, [item.id, openTodoKey]);
  const submitHumanInput = async () => {
    try {
      const attachmentRefs = attachmentJson.trim()
        ? (JSON.parse(attachmentJson) as unknown)
        : [];
      if (!Array.isArray(attachmentRefs)) {
        throw new Error(t("error.attachmentArray"));
      }
      await act("human-input", {
        todoIds: selectedTodoIds,
        ...(response.trim() ? { response } : {}),
        attachmentRefs,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("error.attachmentInvalid"),
      );
    }
  };
  const awaitingAcceptance =
    item.status === "WAITING_HUMAN" && openTodos.length === 0;
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
          {openTodos.map((todo) => (
            <div className="squad-todo" key={todo.id}>
              <label className="squad-todo-select">
                <input
                  type="checkbox"
                  checked={selectedTodoIds.includes(todo.id)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelectedTodoIds((current) =>
                      checked
                        ? [...new Set([...current, todo.id])]
                        : current.filter((id) => id !== todo.id),
                    );
                  }}
                />
                <strong>{todo.title}</strong>
              </label>
              <p>{todo.blockingReason}</p>
              {todo.instructions ? <p>{todo.instructions}</p> : null}
            </div>
          ))}
          <label>
            {t("field.response")}
            <textarea
              value={response}
              rows={5}
              onChange={(event) => setResponse(event.currentTarget.value)}
            />
          </label>
          <label>
            {t("field.attachmentRefs")}
            <textarea
              value={attachmentJson}
              rows={4}
              placeholder='[{"url":"https://…","sha256":"…","size":123,"name":"evidence.txt"}]'
              onChange={(event) => setAttachmentJson(event.currentTarget.value)}
            />
          </label>
          <div className="squad-actions">
            <button
              disabled={
                busy ||
                selectedTodoIds.length === 0 ||
                (!response.trim() && !attachmentJson.trim())
              }
              onClick={() => void submitHumanInput()}
            >
              {t("action.completeSelected")}
            </button>
            <button
              className="squad-danger"
              disabled={busy}
              onClick={() => act("reject")}
            >
              {t("action.reject")}
            </button>
          </div>
        </section>
      ) : null}
      {awaitingAcceptance ? (
        <div className="squad-actions">
          <button disabled={busy} onClick={() => act("accept")}>
            {t("action.acceptAndRun")}
          </button>
          <button
            className="squad-danger"
            disabled={busy}
            onClick={() => act("reject")}
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
          onClick={() => act("cancel")}
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
    </article>
  );
}

function TeamPlanDetail({
  plan,
  refresh,
  t,
}: {
  plan: TeamPlan;
  refresh: () => Promise<void>;
  t: SquadTranslate;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
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
      {plan.sourceSummary ? (
        <section>
          <h3>{t("field.sourceSummary")}</h3>
          <p className="squad-prewrap">{plan.sourceSummary}</p>
        </section>
      ) : null}
      {canDispatch ? <p>{t("plan.approvalHint")}</p> : null}
      {canDispatch || canCancel ? (
        <div className="squad-actions">
          {canDispatch ? (
            <button
              disabled={busy}
              onClick={() =>
                void act(plan.status === "DRAFT" ? "approve" : "retry")
              }
            >
              {plan.status === "DRAFT"
                ? t("action.approvePlan")
                : t("action.retryPlan")}
            </button>
          ) : null}
          {canCancel ? (
            <button
              className="squad-danger"
              disabled={busy}
              onClick={() => void act("cancel")}
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
                <span
                  className={`squad-plan-item-status squad-plan-item-status-${item.status.toLowerCase()}`}
                >
                  {formatPlanItemStatus(t, item.status)}
                </span>
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
              </dl>
              {item.error ? <p className="squad-error">{item.error}</p> : null}
            </article>
          ))}
        </div>
      </section>
      {error ? <p className="squad-error">{error}</p> : null}
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
  const [invitation, setInvitation] = useState<{
    token: string;
    expiresAt: string;
  }>();

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
    await run("join", async () => {
      await api("/organizations/join", {
        method: "POST",
        body: JSON.stringify({ invitation: form.get("invitation") }),
      });
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
      const result = await api<{ invitation: string; expiresAt: string }>(
        `/organizations/${organizationId}/invitations`,
        {
          method: "POST",
          body: JSON.stringify({ expiresInMinutes }),
        },
      );
      setInvitation({ token: result.invitation, expiresAt: result.expiresAt });
    } catch (cause) {
      setError(describeError(cause, t, "error.organizationActionFailed"));
    } finally {
      setBusy(undefined);
    }
  };

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
            <button disabled={busy !== undefined} type="submit">
              {t("action.joinOrganization")}
            </button>
          </form>
        </div>
      </div>
      {notice ? <p className="squad-notice">{notice}</p> : null}
      {invitation ? (
        <section className="squad-invitation-result">
          <strong>{t("organizations.invitationResult")}</strong>
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
                      void createInvitation(
                        organization.organizationId,
                        Number(input?.value ?? 1_440),
                      );
                    }}
                  >
                    {t("action.createInvitation")}
                  </button>
                </div>
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
                      <button
                        disabled={busy !== undefined}
                        onClick={() =>
                          void run(`approve:${request.requestId}`, () =>
                            api(
                              `/organizations/${organization.organizationId}/join-requests/${request.requestId}/approve`,
                              { method: "POST", body: "{}" },
                            ),
                          )
                        }
                      >
                        {t("action.approveJoin")}
                      </button>
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
                                void run(`role:${member.membershipId}`, () =>
                                  api(
                                    `/organizations/${organization.organizationId}/members/${member.membershipId}/role`,
                                    {
                                      method: "POST",
                                      body: JSON.stringify({
                                        role: event.currentTarget.value,
                                      }),
                                    },
                                  ),
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
                                void run(`policy:${member.membershipId}`, () =>
                                  api(
                                    `/organizations/${organization.organizationId}/members/${member.membershipId}/policy`,
                                    {
                                      method: "POST",
                                      body: JSON.stringify({ autoExecute }),
                                    },
                                  ),
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
                              void run(`status:${member.membershipId}`, () =>
                                api(
                                  `/organizations/${organization.organizationId}/members/${member.membershipId}/status`,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({
                                      enabled: member.status !== "ACTIVE",
                                    }),
                                  },
                                ),
                              )
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
    </div>
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
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
      event.currentTarget.reset();
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
  const updatePeerPolicy = async (nodeId: string, autoExecute: AutoExecute) => {
    setBusyPeer(nodeId);
    setError(undefined);
    try {
      await api(`/peers/${nodeId}/policy`, {
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
  return (
    <div className="squad-settings">
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
      <h2>{t("settings.peers")}</h2>
      {state.peers.map((peer) => (
        <div className="squad-peer" key={peer.nodeId}>
          <div>
            <strong>{peer.displayName}</strong>
            <code>{peer.nodeId}</code>
            <span>
              {peer.transport === "DIRECT"
                ? t("transport.DIRECT")
                : t("transport.RELAY")}
            </span>
            {peer.directUrl ? <code>{peer.directUrl}</code> : null}
          </div>
          {peer.enabled ? (
            <PolicySelect
              value={peer.policy.autoExecute}
              disabled={busyPeer !== undefined}
              t={t}
              onChange={(autoExecute) =>
                void updatePeerPolicy(peer.nodeId, autoExecute)
              }
            />
          ) : (
            <span>{t("settings.peerDisabled")}</span>
          )}
        </div>
      ))}
      {state.peers.some(
        (peer) => peer.enabled && peer.policy.autoExecute === "TRUSTED",
      ) ? (
        <p className="squad-warning">{t("settings.trustedWarning")}</p>
      ) : null}
      <h3>{t("settings.pairPeer")}</h3>
      <form onSubmit={submit}>
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
          <select name="transport" defaultValue="RELAY">
            <option value="RELAY">{t("transport.RELAY")}</option>
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
      {error ? <p className="squad-error">{error}</p> : null}
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
  const setMode = (mode: UpdateMode) => {
    if (
      mode === "AUTOMATIC" &&
      !window.confirm(t("updates.automaticConfirmation"))
    ) {
      return;
    }
    void run("policy", () =>
      api("/updates/policy", {
        method: "POST",
        body: JSON.stringify({ mode }),
      }),
    );
  };
  const requestInstall = () => {
    if (!window.confirm(t("updates.installConfirmation"))) return;
    void run("install", () =>
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
            onChange={(event) => setMode(event.target.value as UpdateMode)}
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
          onClick={requestInstall}
        >
          {t("updates.installNow")}
        </button>
      </div>
      {error ? <p className="squad-error">{error}</p> : null}
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
          disabled={busy || currentSessionId === undefined}
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
        <small>{selectedOrganization?.name ?? t("context.selectHint")}</small>
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
  const [tab, setTab] = useState<Tab>("waiting");
  const [state, setState] = useState<LocalState>();
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();

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
    void refresh();
    const events = new EventSource("/squad/v1/local/events");
    const stateChanged = () => void refresh();
    events.addEventListener("state", stateChanged);
    return () => {
      events.removeEventListener("state", stateChanged);
      events.close();
    };
  }, [open, refresh]);

  useEffect(() => {
    if (open) void refresh();
  }, [currentSessionId, open, refresh]);

  const items = useMemo(
    () => (state?.delegations ?? []).filter((item) => belongs(tab, item)),
    [state, tab],
  );
  const selected =
    state?.delegations.find((item) => item.id === selectedId) ?? items[0];
  const plans = state?.plans ?? [];
  const selectedPlan = plans.find((plan) => plan.id === selectedId) ?? plans[0];
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
        {state ? (
          <SessionContextBar
            state={state}
            currentSessionId={currentSessionId}
            refresh={refresh}
            t={t}
          />
        ) : null}
        <nav className="squad-tabs">
          {(
            [
              "plans",
              "waiting",
              "running",
              "sent",
              "completed",
              "organizations",
              "updates",
              "settings",
            ] as const
          ).map((value) => (
            <button
              key={value}
              className={tab === value ? "active" : ""}
              onClick={() => {
                setTab(value);
                setSelectedId(undefined);
              }}
            >
              {t(tabKeys[value])}
            </button>
          ))}
        </nav>
        {error ? <p className="squad-error squad-load-error">{error}</p> : null}
        {tab === "organizations" && state ? (
          <OrganizationCenter state={state} refresh={refresh} t={t} />
        ) : tab === "updates" && state ? (
          <UpdateCenter state={state} refresh={refresh} t={t} />
        ) : tab === "settings" && state ? (
          <Settings state={state} refresh={refresh} t={t} />
        ) : tab === "plans" ? (
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
                <TeamPlanDetail plan={selectedPlan} refresh={refresh} t={t} />
              ) : (
                <p className="squad-empty">{t("empty.planSelection")}</p>
              )}
            </main>
          </div>
        ) : (
          <div className="squad-content">
            <aside className="squad-list">
              {items.length === 0 ? (
                <p className="squad-empty">{t("empty.list")}</p>
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
.squad-context-bar{display:grid;grid-template-columns:minmax(150px,1fr) minmax(150px,1fr) minmax(220px,1.4fr);gap:14px;margin:0 22px 12px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;background:var(--dsw-alias-interactive-bg-hover,#f6f7f9)}.squad-context-bar>div,.squad-context-bar>label{display:grid;align-content:start;gap:4px;min-width:0;margin:0;font-size:12px}.squad-context-bar span,.squad-context-bar small{color:var(--dsw-alias-label-secondary,#666)}.squad-context-bar code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.squad-context-bar select,.squad-organizations input,.squad-organizations textarea,.squad-organizations select,.squad-peer select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:9px;background:var(--dsw-specific-dialog-fill,#fff);color:inherit;padding:8px;font:inherit}.squad-organizations{overflow:auto;padding:20px 24px;flex:1}.squad-organizations button{border:0;border-radius:9px;padding:8px 12px;background:#315ee8;color:#fff;cursor:pointer}.squad-organizations button:disabled{opacity:.5}.squad-organizations .squad-danger{background:#b13c35}.squad-organization-intro{display:grid;grid-template-columns:1fr 1.35fr;gap:22px}.squad-organization-intro h2,.squad-organization-card h2{margin:0}.squad-organization-forms{display:grid;grid-template-columns:1fr 1fr;gap:12px}.squad-organization-forms form{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;padding:12px}.squad-organization-forms h3{margin:0 0 8px;font-size:13px}.squad-organizations label{display:grid;gap:5px;margin:8px 0;font-size:12px}.squad-organization-list{display:grid;gap:16px;margin-top:18px}.squad-organization-card{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:14px;padding:16px}.squad-organization-card>header{display:flex;justify-content:space-between;gap:16px}.squad-organization-card code,.squad-invitation-result code,.squad-member code,.squad-join-request code{display:block;font-size:11px;overflow-wrap:anywhere}.squad-organization-badges{display:flex;align-items:flex-start;gap:6px}.squad-organization-badges span,.squad-member-role>span{font-size:11px;border-radius:999px;padding:4px 8px;background:var(--dsw-alias-interactive-bg-hover,#eee);white-space:nowrap}.squad-organization-admin{display:flex;align-items:end;gap:8px;margin:12px 0}.squad-organization-admin label{margin:0;max-width:210px}.squad-join-request{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-member-list{display:grid;gap:8px}.squad-member{display:grid;grid-template-columns:minmax(170px,1.4fr) minmax(130px,.8fr) minmax(150px,1fr) auto;align-items:center;gap:10px;padding:10px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover,#f4f5f7)}.squad-member-role{display:flex;align-items:center;gap:6px}.squad-policy-control{margin:0!important}.squad-invitation-result{display:grid;gap:7px;margin-top:14px;padding:13px;border:1px solid #d59b1b;border-radius:12px;background:#fff8e5;color:#5d470a}.squad-notice{padding:10px 12px;border-radius:9px;background:#dff5e6;color:#176c35}.squad-warning{padding:10px 12px;border-radius:9px;background:#fff0c7;color:#755400;font-size:12px}
@media(max-width:700px){.squad-context-bar,.squad-organization-intro,.squad-organization-forms{grid-template-columns:1fr}.squad-context-bar{margin:0 12px 10px}.squad-organizations{padding:16px}.squad-member{grid-template-columns:1fr}.squad-organization-card>header{display:grid}}
.squad-updates{overflow:auto;padding:22px 26px;max-width:760px}.squad-updates>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.squad-updates h2{margin:0}.squad-updates h3{font-size:14px;margin:24px 0 8px}.squad-updates label{display:grid;gap:6px;margin:12px 0;font-size:13px}.squad-updates select{box-sizing:border-box;width:100%;max-width:360px;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:9px;background:var(--dsw-specific-dialog-fill,#fff);color:inherit;padding:9px;font:inherit}.squad-updates button{border:0;border-radius:9px;padding:8px 12px;background:#315ee8;color:#fff;cursor:pointer}.squad-updates button:disabled{opacity:.5;cursor:not-allowed}.squad-updates a{color:#315ee8}.squad-update-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}.squad-update-summary>div{display:grid;gap:5px;padding:13px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:11px}.squad-update-summary span{font-size:11px;color:var(--dsw-alias-label-secondary,#666)}.squad-update-summary strong{overflow-wrap:anywhere}.squad-update-status-failed,.squad-update-status-rolled_back{background:#fde4e1;color:#a52a24}.squad-update-status-available,.squad-update-status-requested,.squad-update-status-blocked{background:#fff0c7;color:#755400}.squad-update-status-installed,.squad-update-status-up_to_date{background:#dff5e6;color:#176c35}@media(max-width:700px){.squad-updates{padding:16px}.squad-update-summary{grid-template-columns:1fr}}
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
    },
    "dsh-squad client state",
  );
}
