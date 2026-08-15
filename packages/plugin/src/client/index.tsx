import {
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
import type { DelegationStatus } from "../shared/state.ts";
import {
  SQUAD_LOCALE_NS,
  en,
  formatDelivery,
  formatErrorCode,
  formatPolicy,
  formatStatus,
  formatSummary,
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
  peers: PeerView[];
  delegations: DelegationView[];
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

type Tab = "waiting" | "running" | "sent" | "completed" | "settings";

const tabKeys = {
  waiting: "tab.waiting",
  running: "tab.running",
  sent: "tab.sent",
  completed: "tab.completed",
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
      </dl>
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
      item.deliveryStatus === "QUEUED_LOCAL" ? (
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
  return (
    <div className="squad-settings">
      <h2>{t("settings.nodeIdentity")}</h2>
      <p>{state.identity.displayName}</p>
      <code>{state.identity.nodeId}</code>
      <p>
        {t("settings.relay")}: {relayState}
      </p>
      <p className="squad-muted">{t("settings.languageHint")}</p>
      <h2>{t("settings.peers")}</h2>
      {state.peers.map((peer) => (
        <div className="squad-peer" key={peer.nodeId}>
          <strong>{peer.displayName}</strong>
          <code>{peer.nodeId}</code>
          <span>
            {peer.enabled
              ? formatPolicy(t, peer.policy.autoExecute)
              : t("settings.peerDisabled")}
          </span>
        </div>
      ))}
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

function SquadPanel({
  openSession,
  getLocale,
  t,
}: {
  openSession: (id: string) => void;
  getLocale: () => LocaleId;
  t: SquadTranslate;
}) {
  const open = usePanelOpen();
  const [tab, setTab] = useState<Tab>("waiting");
  const [state, setState] = useState<LocalState>();
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = async () => {
    try {
      setState(await api<LocalState>("/state"));
      setError(undefined);
    } catch (cause) {
      setError(describeError(cause, t, "error.loadFailed"));
    }
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [open]);

  const items = useMemo(
    () => (state?.delegations ?? []).filter((item) => belongs(tab, item)),
    [state, tab],
  );
  const selected =
    state?.delegations.find((item) => item.id === selectedId) ?? items[0];
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
        <nav className="squad-tabs">
          {(
            ["waiting", "running", "sent", "completed", "settings"] as const
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
        {tab === "settings" && state ? (
          <Settings state={state} refresh={refresh} t={t} />
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
.squad-trigger{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:10px;display:flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 9px;font:inherit;white-space:nowrap}.squad-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}.squad-trigger-wide{width:100%;justify-content:flex-start}.squad-trigger-icon{font-size:20px;line-height:1}.squad-overlay{position:fixed;inset:0;z-index:1000;pointer-events:none}.squad-backdrop{position:absolute;inset:0;border:0;background:rgba(10,14,22,.34);pointer-events:auto}.squad-panel{position:absolute;pointer-events:auto;top:12px;bottom:12px;right:12px;width:min(920px,calc(100vw - 24px));border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:18px;background:var(--dsw-specific-dialog-fill,#fff);color:var(--dsw-alias-label-primary,#151515);box-shadow:0 18px 60px rgba(0,0,0,.24);display:flex;flex-direction:column;overflow:hidden}.squad-panel-head{display:flex;justify-content:space-between;align-items:center;padding:22px 24px 12px}.squad-panel-head h1{font-size:24px;margin:2px 0}.squad-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#666)}.squad-close{border:0;background:transparent;color:inherit;font-size:30px;cursor:pointer}.squad-tabs{display:flex;gap:4px;padding:0 18px 14px;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-tabs button{border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#666);padding:7px 12px;cursor:pointer;white-space:nowrap}.squad-tabs button.active{background:var(--dsw-alias-interactive-bg-hover,#eee);color:var(--dsw-alias-label-primary,#111)}.squad-content{display:grid;grid-template-columns:290px minmax(0,1fr);min-height:0;flex:1}.squad-list{border-right:1px solid var(--dsw-alias-border-l2,#ddd);padding:10px;overflow:auto}.squad-list button{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;border-radius:12px;padding:12px;cursor:pointer}.squad-list button:hover,.squad-list button.active{background:var(--dsw-alias-interactive-bg-hover,#eee)}.squad-list strong,.squad-list span{display:block}.squad-list strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.squad-list span{font-size:12px;margin-top:5px;color:var(--dsw-alias-label-secondary,#666)}.squad-content main,.squad-settings{overflow:auto;padding:22px 26px}.squad-detail>header{display:flex;align-items:center;gap:10px}.squad-detail h2{font-size:22px;line-height:1.35}.squad-detail h3,.squad-settings h3{font-size:14px;margin:24px 0 8px}.squad-detail dl{display:grid;gap:5px}.squad-detail dl div{display:grid;grid-template-columns:78px 1fr;gap:10px}.squad-detail dt{color:var(--dsw-alias-label-secondary,#666)}.squad-detail dd{margin:0;overflow-wrap:anywhere}.squad-status{font-size:11px;font-weight:700;border-radius:999px;padding:4px 8px;background:#e8edf6}.squad-status-completed{background:#dff5e6;color:#176c35}.squad-status-failed,.squad-status-rejected{background:#fde4e1;color:#a52a24}.squad-status-waiting_human{background:#fff0c7;color:#755400}.squad-direction,.squad-muted{color:var(--dsw-alias-label-secondary,#666);font-size:12px}.squad-prewrap{white-space:pre-wrap;overflow-wrap:anywhere}.squad-todo{border-left:3px solid #d59b1b;padding:2px 12px;margin:10px 0}.squad-todo p{margin:5px 0}.squad-todo-select{display:flex!important;align-items:center;grid-template-columns:auto 1fr!important}.squad-todo-select input{width:auto!important}.squad-detail label,.squad-settings label{display:grid;gap:6px;margin:12px 0;font-size:13px}.squad-detail textarea,.squad-settings textarea,.squad-settings input,.squad-settings select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:9px;background:transparent;color:inherit;padding:9px;font:inherit}.squad-actions{display:flex;gap:8px;margin:12px 0}.squad-detail button,.squad-settings button{border:0;border-radius:9px;padding:8px 12px;background:#315ee8;color:#fff;cursor:pointer}.squad-detail button:disabled{opacity:.5}.squad-detail .squad-danger{background:#b13c35}.squad-detail .squad-link-button{display:block;margin:9px 0;background:transparent;color:#315ee8;padding-left:0}.squad-error{color:#b13c35}.squad-load-error{padding:0 24px}.squad-empty{color:var(--dsw-alias-label-secondary,#666);padding:12px}.squad-settings{max-width:680px}.squad-settings code,.squad-peer code{display:block;overflow-wrap:anywhere;font-size:11px}.squad-peer{display:grid;grid-template-columns:150px 1fr auto;gap:10px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}
@media(max-width:700px){.squad-panel{inset:0;width:auto;border-radius:0}.squad-content{grid-template-columns:1fr}.squad-list{max-height:180px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}.squad-peer{grid-template-columns:1fr}.squad-panel-head{padding:16px}.squad-content main,.squad-settings{padding:16px}}
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
