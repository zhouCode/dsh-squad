import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  TeamPlanItemStatus,
  TeamPlanStatus,
} from "../shared/contracts.ts";
import type { DelegationStatus } from "../shared/state.ts";

export const SQUAD_LOCALE_NS = "dsh-squad";

export const zh = {
  "html.lang": "zh-CN",
  "inbox.title": "智能体收件箱",
  "inbox.close": "关闭智能体收件箱",
  "tab.plans": "分派计划",
  "tab.waiting": "待我处理",
  "tab.running": "运行中",
  "tab.sent": "已发送",
  "tab.completed": "已完成",
  "tab.settings": "设置",
  "direction.received": "收到",
  "direction.sent": "已发送",
  "field.peer": "对等方",
  "field.delivery": "投递",
  "field.context": "上下文",
  "field.acceptanceCriteria": "验收条件",
  "field.shareableSummary": "可共享摘要",
  "field.waitingForMe": "待我处理",
  "field.response": "给接收方智能体的回复",
  "field.attachmentRefs": "附件引用（可选 JSON 数组）",
  "field.outputs": "输出",
  "field.sourceSummary": "来源摘要",
  "field.planItems": "计划项",
  "field.delegationId": "委派 ID",
  "action.completeSelected": "完成所选项",
  "action.reject": "拒绝",
  "action.acceptAndRun": "接受并运行",
  "action.retryDelivery": "重试投递",
  "action.requestCancel": "请求取消",
  "action.openSession": "打开原生 DSH 会话",
  "action.savePeer": "保存对等方",
  "action.approvePlan": "确认并分派",
  "action.retryPlan": "重试未发送项",
  "action.cancelPlan": "取消剩余计划项",
  "plan.approvalHint":
    "确认后，每个计划项会通过现有签名委派发送；接收方仍按自己的 Peer 策略决定是否执行。",
  "plan.itemCount": "共 {count} 个计划项",
  "plan.dispatchedCount": "已创建 {sent}/{total} 个委派",
  "settings.nodeIdentity": "节点身份",
  "settings.relay": "中继",
  "settings.relayServing": "中继服务运行中",
  "settings.relayConfigured": "已配置中继连接",
  "settings.relayNotConfigured": "未配置",
  "settings.peers": "对等方",
  "settings.peerDisabled": "已禁用",
  "settings.pairPeer": "添加固定公钥的对等方",
  "settings.displayName": "显示名称",
  "settings.nodeId": "节点 ID",
  "settings.publicKey": "Ed25519 公钥",
  "settings.autoExecute": "自动执行",
  "settings.languageHint":
    "界面语言由 DSH 全局设置统一控制；首次使用时跟随系统语言。",
  "empty.list": "这里暂时没有内容。",
  "empty.selection": "请选择一个委派。",
  "empty.plans":
    "还没有分派计划。可以让 Agent 使用 propose_team_plan 创建草案。",
  "empty.planSelection": "请选择一个分派计划。",
  "status.QUEUED": "已排队",
  "status.RECEIVED": "已接收",
  "status.TRIAGING": "评估中",
  "status.RUNNING": "运行中",
  "status.WAITING_HUMAN": "等待人工处理",
  "status.COMPLETED": "已完成",
  "status.REJECTED": "已拒绝",
  "status.FAILED": "失败",
  "status.CANCELED": "已取消",
  "planStatus.DRAFT": "待确认",
  "planStatus.DISPATCHING": "正在分派",
  "planStatus.DISPATCHED": "已全部分派",
  "planStatus.PARTIAL": "部分失败",
  "planStatus.CANCELED": "已取消",
  "planItemStatus.DRAFT": "待发送",
  "planItemStatus.DISPATCHED": "已创建委派",
  "planItemStatus.FAILED": "发送失败",
  "planItemStatus.CANCELED": "已取消",
  "delivery.QUEUED_LOCAL": "本地待投递",
  "delivery.DELIVERED_TO_RELAY": "已投递至中继",
  "delivery.RECEIVED_LOCAL": "已接收到本地",
  "policy.NEVER": "从不",
  "policy.SAFE": "仅安全目标",
  "policy.TRUSTED": "受信任目标",
  "error.requestFailed": "Squad 请求失败",
  "error.actionFailed": "操作失败",
  "error.attachmentArray": "附件引用必须是 JSON 数组。",
  "error.attachmentInvalid": "附件 JSON 无效。",
  "error.pairingFailed": "配对失败",
  "error.loadFailed": "无法加载 Squad 状态",
  "error.planActionFailed": "分派计划操作失败",
  "error.withCode": "{message}（{code}）",
  "error.withDetail": "{message}：{detail}",
  "errorCode.EXECUTION_INTERRUPTED": "执行被中断",
  "errorCode.REJECTED_BY_OWNER": "接收方已拒绝",
  "errorCode.CANCELED_BY_SENDER": "发送方已取消",
  "errorCode.EXECUTION_FAILED": "执行失败",
  "errorCode.EXECUTION_TIMEOUT": "执行超时",
  "errorCode.MALFORMED_OUTCOME": "结果格式无效",
  "errorCode.SESSION_UNAVAILABLE": "原会话不可用",
  "errorCode.PEER_DISABLED": "对等方已禁用",
  "errorCode.CONCURRENCY_LIMIT": "并发数已达上限",
  "errorCode.UNSUPPORTED": "接收方不支持此任务",
  "errorCode.POLICY_REJECTED": "本地策略已拒绝",
  "summary.executionInterrupted":
    "接收方 DSH 在执行期间停止。可能已经发生的外部副作用不会自动重放。",
  "summary.rejectedByOwner": "接收方已拒绝。",
  "summary.canceledBeforeDelivery": "已在投递到中继前取消。",
  "summary.cancellationConfirmed":
    "已在本地确认取消；可能已经发生的外部副作用不会回滚。",
  "summary.running": "正在接收方的个人智能体上运行。",
  "summary.resumed": "收到本地人工输入后已恢复运行。",
  "summary.policyRejected": "接收方节点的策略拒绝了此委派。",
  "summary.awaitingAcceptance": "等待接收方本人接受。",
  "summary.automaticPaused": "自动执行已暂停：{reason}",
} as const;

export type SquadLocaleKey = keyof typeof zh;

export const en = {
  "html.lang": "en",
  "inbox.title": "Agent Inbox",
  "inbox.close": "Close Agent Inbox",
  "tab.plans": "Plans",
  "tab.waiting": "Waiting for me",
  "tab.running": "Running",
  "tab.sent": "Sent",
  "tab.completed": "Completed",
  "tab.settings": "Settings",
  "direction.received": "Received",
  "direction.sent": "Sent",
  "field.peer": "Peer",
  "field.delivery": "Delivery",
  "field.context": "Context",
  "field.acceptanceCriteria": "Acceptance criteria",
  "field.shareableSummary": "Shareable summary",
  "field.waitingForMe": "Waiting for me",
  "field.response": "Response for the receiving Agent",
  "field.attachmentRefs": "Attachment references (optional JSON array)",
  "field.outputs": "Outputs",
  "field.sourceSummary": "Source summary",
  "field.planItems": "Plan items",
  "field.delegationId": "Delegation ID",
  "action.completeSelected": "Complete selected",
  "action.reject": "Reject",
  "action.acceptAndRun": "Accept and run",
  "action.retryDelivery": "Retry delivery",
  "action.requestCancel": "Request cancel",
  "action.openSession": "Open native DSH session",
  "action.savePeer": "Save peer",
  "action.approvePlan": "Approve and dispatch",
  "action.retryPlan": "Retry unsent items",
  "action.cancelPlan": "Cancel remaining items",
  "plan.approvalHint":
    "Approval creates one existing signed delegation per item; each recipient still decides execution through their own Peer policy.",
  "plan.itemCount": "{count} plan items",
  "plan.dispatchedCount": "Created {sent}/{total} delegations",
  "settings.nodeIdentity": "Node identity",
  "settings.relay": "Relay",
  "settings.relayServing": "relay service is running",
  "settings.relayConfigured": "relay connection configured",
  "settings.relayNotConfigured": "not configured",
  "settings.peers": "Peers",
  "settings.peerDisabled": "Disabled",
  "settings.pairPeer": "Pair a pinned peer",
  "settings.displayName": "Display name",
  "settings.nodeId": "Node ID",
  "settings.publicKey": "Ed25519 public key",
  "settings.autoExecute": "Automatic execution",
  "settings.languageHint":
    "The DSH global language setting controls this interface; first use follows the system language.",
  "empty.list": "Nothing here.",
  "empty.selection": "Select a delegation.",
  "empty.plans":
    "No delegation plans yet. Ask the Agent to create a draft with propose_team_plan.",
  "empty.planSelection": "Select a delegation plan.",
  "status.QUEUED": "Queued",
  "status.RECEIVED": "Received",
  "status.TRIAGING": "Triaging",
  "status.RUNNING": "Running",
  "status.WAITING_HUMAN": "Waiting for human input",
  "status.COMPLETED": "Completed",
  "status.REJECTED": "Rejected",
  "status.FAILED": "Failed",
  "status.CANCELED": "Canceled",
  "planStatus.DRAFT": "Awaiting approval",
  "planStatus.DISPATCHING": "Dispatching",
  "planStatus.DISPATCHED": "Fully dispatched",
  "planStatus.PARTIAL": "Partially failed",
  "planStatus.CANCELED": "Canceled",
  "planItemStatus.DRAFT": "Not sent",
  "planItemStatus.DISPATCHED": "Delegation created",
  "planItemStatus.FAILED": "Dispatch failed",
  "planItemStatus.CANCELED": "Canceled",
  "delivery.QUEUED_LOCAL": "Queued locally",
  "delivery.DELIVERED_TO_RELAY": "Delivered to Relay",
  "delivery.RECEIVED_LOCAL": "Received locally",
  "policy.NEVER": "Never",
  "policy.SAFE": "Safe objectives only",
  "policy.TRUSTED": "Trusted objectives",
  "error.requestFailed": "Squad request failed",
  "error.actionFailed": "Action failed",
  "error.attachmentArray": "Attachment references must be a JSON array.",
  "error.attachmentInvalid": "Attachment JSON is invalid.",
  "error.pairingFailed": "Pairing failed",
  "error.loadFailed": "Could not load Squad state",
  "error.planActionFailed": "Delegation plan action failed",
  "error.withCode": "{message} ({code})",
  "error.withDetail": "{message}: {detail}",
  "errorCode.EXECUTION_INTERRUPTED": "Execution interrupted",
  "errorCode.REJECTED_BY_OWNER": "Rejected by receiving owner",
  "errorCode.CANCELED_BY_SENDER": "Canceled by sender",
  "errorCode.EXECUTION_FAILED": "Execution failed",
  "errorCode.EXECUTION_TIMEOUT": "Execution timed out",
  "errorCode.MALFORMED_OUTCOME": "Malformed outcome",
  "errorCode.SESSION_UNAVAILABLE": "Original session unavailable",
  "errorCode.PEER_DISABLED": "Peer disabled",
  "errorCode.CONCURRENCY_LIMIT": "Concurrency limit reached",
  "errorCode.UNSUPPORTED": "Task unsupported by receiver",
  "errorCode.POLICY_REJECTED": "Rejected by local policy",
  "summary.executionInterrupted":
    "The receiving DSH process stopped while execution was active. Potential external side effects were not replayed.",
  "summary.rejectedByOwner": "Rejected by the receiving owner.",
  "summary.canceledBeforeDelivery": "Canceled before Relay delivery.",
  "summary.cancellationConfirmed":
    "Cancellation was confirmed locally. External side effects, if any, were not rolled back.",
  "summary.running": "Running on the receiving Personal Agent.",
  "summary.resumed": "Resumed after local human input.",
  "summary.policyRejected":
    "The receiving Node policy rejected this delegation.",
  "summary.awaitingAcceptance": "Awaiting local acceptance.",
  "summary.automaticPaused": "Automatic execution paused: {reason}",
} as const satisfies Record<SquadLocaleKey, string>;

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** DSH Squad Agent Inbox copy. */
    "dsh-squad": SquadLocaleKey;
  }
}

export type SquadTranslate = TranslateNS<typeof SQUAD_LOCALE_NS>;

const statusKeys = {
  QUEUED: "status.QUEUED",
  RECEIVED: "status.RECEIVED",
  TRIAGING: "status.TRIAGING",
  RUNNING: "status.RUNNING",
  WAITING_HUMAN: "status.WAITING_HUMAN",
  COMPLETED: "status.COMPLETED",
  REJECTED: "status.REJECTED",
  FAILED: "status.FAILED",
  CANCELED: "status.CANCELED",
} as const satisfies Record<DelegationStatus, SquadLocaleKey>;

const deliveryKeys = {
  QUEUED_LOCAL: "delivery.QUEUED_LOCAL",
  DELIVERED_TO_RELAY: "delivery.DELIVERED_TO_RELAY",
  RECEIVED_LOCAL: "delivery.RECEIVED_LOCAL",
} as const satisfies Record<string, SquadLocaleKey>;

const policyKeys = {
  NEVER: "policy.NEVER",
  SAFE: "policy.SAFE",
  TRUSTED: "policy.TRUSTED",
} as const satisfies Record<string, SquadLocaleKey>;

const planStatusKeys = {
  DRAFT: "planStatus.DRAFT",
  DISPATCHING: "planStatus.DISPATCHING",
  DISPATCHED: "planStatus.DISPATCHED",
  PARTIAL: "planStatus.PARTIAL",
  CANCELED: "planStatus.CANCELED",
} as const satisfies Record<TeamPlanStatus, SquadLocaleKey>;

const planItemStatusKeys = {
  DRAFT: "planItemStatus.DRAFT",
  DISPATCHED: "planItemStatus.DISPATCHED",
  FAILED: "planItemStatus.FAILED",
  CANCELED: "planItemStatus.CANCELED",
} as const satisfies Record<TeamPlanItemStatus, SquadLocaleKey>;

const errorCodeKeys = {
  EXECUTION_INTERRUPTED: "errorCode.EXECUTION_INTERRUPTED",
  REJECTED_BY_OWNER: "errorCode.REJECTED_BY_OWNER",
  CANCELED_BY_SENDER: "errorCode.CANCELED_BY_SENDER",
  EXECUTION_FAILED: "errorCode.EXECUTION_FAILED",
  EXECUTION_TIMEOUT: "errorCode.EXECUTION_TIMEOUT",
  MALFORMED_OUTCOME: "errorCode.MALFORMED_OUTCOME",
  SESSION_UNAVAILABLE: "errorCode.SESSION_UNAVAILABLE",
  PEER_DISABLED: "errorCode.PEER_DISABLED",
  CONCURRENCY_LIMIT: "errorCode.CONCURRENCY_LIMIT",
  UNSUPPORTED: "errorCode.UNSUPPORTED",
  POLICY_REJECTED: "errorCode.POLICY_REJECTED",
} as const satisfies Record<string, SquadLocaleKey>;

const summaryKeys = {
  "The receiving DSH process stopped while execution was active. Potential external side effects were not replayed.":
    "summary.executionInterrupted",
  "Rejected by owner.": "summary.rejectedByOwner",
  "Rejected by the receiving owner.": "summary.rejectedByOwner",
  "Canceled before Relay delivery.": "summary.canceledBeforeDelivery",
  "Cancellation was confirmed locally. External side effects, if any, were not rolled back.":
    "summary.cancellationConfirmed",
  "Running on the receiving Personal Agent.": "summary.running",
  "Resumed after local human input.": "summary.resumed",
  "The receiving Node policy rejected this delegation.":
    "summary.policyRejected",
  "Awaiting local acceptance.": "summary.awaitingAcceptance",
} as const satisfies Record<string, SquadLocaleKey>;

export function formatStatus(
  t: SquadTranslate,
  status: DelegationStatus,
): string {
  return t(statusKeys[status]);
}

export function formatDelivery(t: SquadTranslate, status: string): string {
  const key = deliveryKeys[status as keyof typeof deliveryKeys];
  return key === undefined ? status : t(key);
}

export function formatPolicy(t: SquadTranslate, policy: string): string {
  const key = policyKeys[policy as keyof typeof policyKeys];
  return key === undefined ? policy : t(key);
}

export function formatPlanStatus(
  t: SquadTranslate,
  status: TeamPlanStatus,
): string {
  return t(planStatusKeys[status]);
}

export function formatPlanItemStatus(
  t: SquadTranslate,
  status: TeamPlanItemStatus,
): string {
  return t(planItemStatusKeys[status]);
}

export function formatErrorCode(t: SquadTranslate, code: string): string {
  const key = errorCodeKeys[code as keyof typeof errorCodeKeys];
  return key === undefined
    ? code
    : t("error.withCode", { message: t(key), code });
}

export function formatSummary(t: SquadTranslate, summary: string): string {
  const key = summaryKeys[summary as keyof typeof summaryKeys];
  if (key !== undefined) return t(key);
  const prefix = "Automatic execution paused: ";
  return summary.startsWith(prefix)
    ? t("summary.automaticPaused", { reason: summary.slice(prefix.length) })
    : summary;
}
