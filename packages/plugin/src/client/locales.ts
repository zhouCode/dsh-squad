import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  TeamPlanItemStatus,
  TeamPlanStatus,
} from "../shared/contracts.ts";
import type {
  OrganizationMemberStatus,
  OrganizationRole,
} from "../shared/organizations.ts";
import type { DelegationStatus } from "../shared/state.ts";
import type { UpdateMode, UpdatePhase } from "../shared/updates.ts";

export const SQUAD_LOCALE_NS = "dsh-squad";

export const zh = {
  "html.lang": "zh-CN",
  "inbox.title": "智能体收件箱",
  "inbox.close": "关闭智能体收件箱",
  "inbox.attentionLabel": "智能体收件箱，有 {count} 项需要处理",
  "tab.overview": "概览",
  "tab.plans": "分派计划",
  "tab.waiting": "待我处理",
  "tab.running": "运行中",
  "tab.sent": "已发送",
  "tab.completed": "已完成",
  "tab.organizations": "组织",
  "tab.updates": "更新",
  "tab.settings": "设置",
  "overview.title": "团队行动中心",
  "overview.intro": "集中查看需要你确认、处理或关注的团队协作事项。",
  "overview.attention": "需要关注的事项",
  "overview.waitingHuman": "等待我处理",
  "overview.failedOutgoing": "发送失败",
  "overview.pendingJoins": "加入审批",
  "overview.draftPlans": "待确认计划",
  "overview.allClear": "目前没有需要你处理的事项。",
  "overview.updateAvailable": "Squad 有可用更新，打开更新中心",
  "overview.nextOrganization": "创建或加入一个组织",
  "overview.nextOrganizationHint":
    "Relay 已连接。建立组织后，成员只需加入一次即可出现在团队目录中。",
  "overview.openOrganizations": "打开组织",
  "overview.nextPeer": "添加第一个对等方",
  "overview.nextPeerHint":
    "建立可信配对后，才可以向另一台 Personal Agent 委派任务。",
  "overview.openPeers": "打开对等方设置",
  "overview.tryDelegation": "尝试第一次团队分派",
  "overview.tryDelegationHint":
    "在任意 DSH 会话中直接使用自然语言描述团队任务。",
  "overview.examplePrompt":
    "请根据这段会议纪要，为团队生成一份可审核的任务分派草案。",
  "direction.received": "收到",
  "direction.sent": "已发送",
  "field.peer": "对等方",
  "field.delivery": "投递",
  "field.deliveryAttempts": "失败重试次数",
  "field.nextDeliveryAttempt": "下次尝试",
  "field.lastDeliveryError": "最近投递错误",
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
  "action.createOrganization": "创建组织",
  "action.joinOrganization": "申请加入",
  "action.createInvitation": "创建一次性邀请",
  "action.approveJoin": "批准加入",
  "action.enableMember": "启用成员",
  "action.disableMember": "禁用成员",
  "action.copyPrompt": "复制示例",
  "plan.approvalHint":
    "确认后，每个计划项会通过现有签名委派发送；接收方仍按自己的 Peer 策略决定是否执行。",
  "plan.itemCount": "共 {count} 个计划项",
  "plan.dispatchedCount": "已创建 {sent}/{total} 个委派",
  "setup.firstRun": "首次设置",
  "setup.title": "把这个节点加入团队",
  "setup.intro":
    "设置一个便于成员识别的名称，再选择 Relay 或 Direct。验证通过后配置会保存在本机，无需编辑 YAML。",
  "setup.chooseMode": "选择组队方式",
  "setup.relayTitle": "加入 Relay（推荐）",
  "setup.relayDescription":
    "适合跨地域和离线协作；个人电脑只需主动连接持续在线的中继。",
  "setup.directTitle": "Direct 点对点",
  "setup.directDescription":
    "适合局域网、VPN 或已有 HTTPS 可达地址的小团队；不需要 Relay。",
  "setup.relayUrl": "Relay 地址",
  "setup.relayUrlHint":
    "生产环境必须使用 HTTPS；本机开发可使用 loopback HTTP。",
  "setup.invitation": "一次性节点邀请（可选）",
  "setup.invitationHint":
    "首次登记此节点时填写；已登记节点可留空。只用于本次验证，不保存在节点数据库。",
  "setup.directReceive": "允许其他已配对节点向我直连投递",
  "setup.directPublicUrl": "本节点的 Direct 公共地址",
  "setup.directPublicUrlHint":
    "启用接收时必填。Squad 不会自动配置 DNS、TLS、端口映射或反向代理。",
  "setup.securityHint":
    "本地管理接口只接受 loopback 和同源请求；Relay 邀请不会出现在状态接口或持久配置中。",
  "setup.switchWarning":
    "保存后会立即切换连接方式。现有身份、组织和任务不会被删除，但当前传输无法投递的任务会继续留在本地队列。",
  "setup.complete": "验证并完成设置",
  "setup.save": "验证并保存",
  "setup.saving": "正在验证…",
  "setup.later": "稍后配置",
  "setup.saved": "节点配置已保存。",
  "settings.connection": "团队连接",
  "settings.nodeIdentity": "节点身份",
  "settings.relay": "中继",
  "settings.relayServing": "中继服务运行中",
  "settings.relayConfigured": "已配置中继连接",
  "settings.relayNotConfigured": "未配置",
  "settings.direct": "点对点直连",
  "settings.directServing": "直连接收已启用",
  "settings.directNotServing": "直连接收未启用",
  "settings.peers": "对等方",
  "settings.peerDisabled": "已禁用",
  "settings.pairPeer": "添加固定公钥的对等方",
  "settings.displayName": "显示名称",
  "settings.nodeId": "节点 ID",
  "settings.publicKey": "Ed25519 公钥",
  "settings.transport": "任务传输方式",
  "settings.directUrl": "对方直连地址",
  "settings.directUrlHint":
    "Direct 模式必填。生产环境必须使用 HTTPS；只有本机开发可以使用 loopback HTTP。",
  "settings.autoExecute": "自动执行",
  "transport.RELAY": "Relay 中继",
  "transport.DIRECT": "Direct 点对点",
  "settings.trustedWarning":
    "“受信目标”会跳过人工确认并在本机运行；仅对你充分信任的成员启用。",
  "settings.languageHint":
    "界面语言由 DSH 全局设置统一控制；首次使用时跟随系统语言。",
  "updates.title": "更新中心",
  "updates.securityHint":
    "只接受由 Squad 发布密钥签名且哈希匹配的版本；安装由插件进程之外的更新器完成，并在停服后备份、健康检查失败时回滚。",
  "updates.currentVersion": "当前版本",
  "updates.latestVersion": "最新版本",
  "updates.lastChecked": "上次检查",
  "updates.notChecked": "尚未检查",
  "updates.openRelease": "查看 GitHub Release",
  "updates.policy": "更新策略",
  "updates.policyLabel": "此节点的更新方式",
  "updates.modeHint.DISABLED": "不进行周期检查，也不会自动安装。仍可手动检查。",
  "updates.modeHint.NOTIFY":
    "周期检查并提醒；安装必须由你明确确认。这是默认选项。",
  "updates.modeHint.AUTOMATIC":
    "节点空闲时自动备份、安装并重启；失败会尝试回滚。",
  "updates.automaticWarning":
    "自动更新会短暂重启本节点。正在运行的委派或分派计划会阻止更新。",
  "updates.automaticConfirmation":
    "确定启用自动更新吗？节点空闲时，外部更新器会备份数据并重启服务。",
  "updates.installConfirmation":
    "确定安装已验证的更新吗？外部更新器会等待节点空闲，然后备份并重启服务。",
  "updates.updater": "外部更新器",
  "updates.updaterConfigured": "已配置并由 {unit} 执行",
  "updates.updaterNotConfigured": "尚未配置",
  "updates.updaterSetupHint":
    "服务器上的 Relay 需要先运行 dsh-squad-update install-systemd；配置完成前仍可检查，但不能从界面安装。",
  "updates.requestPending": "安装请求已提交；更新器会在节点空闲后处理。",
  "updates.checkNow": "立即检查",
  "updates.checking": "正在检查…",
  "updates.installNow": "安装已验证更新",
  "updateMode.DISABLED": "关闭",
  "updateMode.NOTIFY": "仅通知（推荐）",
  "updateMode.AUTOMATIC": "自动安装",
  "updatePhase.IDLE": "待检查",
  "updatePhase.CHECKING": "检查中",
  "updatePhase.UP_TO_DATE": "已是最新",
  "updatePhase.AVAILABLE": "有可用更新",
  "updatePhase.REQUESTED": "已请求安装",
  "updatePhase.DOWNLOADING": "正在下载",
  "updatePhase.VERIFYING": "正在验证",
  "updatePhase.BLOCKED": "已暂缓",
  "updatePhase.BACKING_UP": "正在备份",
  "updatePhase.INSTALLING": "正在安装",
  "updatePhase.RESTARTING": "正在重启",
  "updatePhase.INSTALLED": "安装完成",
  "updatePhase.ROLLED_BACK": "已回滚",
  "updatePhase.FAILED": "更新失败",
  "context.node": "当前节点",
  "context.session": "当前会话",
  "context.organization": "组织上下文",
  "context.directPeers": "直接对等方",
  "context.noSession": "尚未选择 DSH 会话",
  "context.selectHint":
    "每个会话可独立选择一个组织；任务只在该组织成员目录内解析。",
  "organizations.title": "组织",
  "organizations.create": "创建新组织",
  "organizations.join": "使用一次性邀请申请加入",
  "organizations.name": "组织名称",
  "organizations.invitation": "组织邀请",
  "organizations.invitationExpiry": "邀请有效期（分钟）",
  "organizations.invitationResult": "一次性邀请（请通过安全渠道发送）",
  "organizations.invitationExpires": "有效期至 {time}",
  "organizations.members": "成员",
  "organizations.pendingRequests": "待审批加入申请",
  "organizations.noPendingRequests": "没有待审批申请。",
  "organizations.noOrganizations": "当前节点尚未加入任何组织。",
  "organizations.self": "本节点",
  "organizations.localPolicy": "本机接收策略",
  "organizations.directoryRevision": "签名目录修订 {revision}",
  "organizations.pendingHint": "加入申请已发送，等待 Owner 或 Admin 批准。",
  "organizations.securityHint":
    "组织目录由成员签名并在本机验证；Relay 只中继目录和加密身份边界，不获得本机 Agent 能力。",
  "organizationRole.OWNER": "所有者",
  "organizationRole.ADMIN": "管理员",
  "organizationRole.MEMBER": "成员",
  "organizationStatus.ACTIVE": "活动",
  "organizationStatus.PENDING": "待批准",
  "organizationStatus.DISABLED": "已禁用",
  "empty.list": "这里暂时没有内容。",
  "empty.selection": "请选择一个委派。",
  "empty.plans":
    "还没有分派计划。你可以直接告诉 Agent：根据会议纪要为团队生成一份可审核的分派草案。",
  "empty.planSelection": "请选择一个分派计划。",
  "empty.sent":
    "还没有发出的委派。可以直接在 DSH 会话中告诉 Agent 要委派给谁、完成什么。",
  "empty.completed": "尚无已结束的委派。",
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
  "delivery.WAITING_FOR_PEER": "等待对方可达",
  "delivery.STORED_BY_RELAY": "中继已持久保存",
  "delivery.RECEIVED_BY_NODE": "对方节点已接收",
  "delivery.DELIVERY_EXPIRED": "投递已过期",
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
  "error.organizationActionFailed": "组织操作失败",
  "error.policyUpdateFailed": "无法更新自动执行策略",
  "error.sessionOrganizationFailed": "无法切换会话组织",
  "error.updateActionFailed": "更新操作失败",
  "error.setupFailed": "无法保存节点配置",
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
  "errorCode.DELIVERY_EXPIRED": "投递在对方接收前已过期",
  "errorCode.UPDATE_CHECK_FAILED": "更新检查失败",
  "errorCode.REQUEST_VERSION_CHANGED": "待安装版本已变化",
  "errorCode.ROLLED_BACK_VERSION_SUPPRESSED": "已阻止自动重试回滚版本",
  "errorCode.NODE_STATE_UNAVAILABLE": "无法验证本地节点状态",
  "errorCode.NODE_VERSION_MISMATCH": "更新器与节点版本不一致",
  "errorCode.NODE_ID_CHANGED": "更新目标节点身份已变化",
  "errorCode.ACTIVE_WORK": "节点仍有进行中的工作",
  "errorCode.UPDATE_ALREADY_RUNNING": "另一更新任务正在运行",
  "errorCode.UPDATE_INSTALL_FAILED": "更新安装失败，已尝试回滚",
  "errorCode.UPDATE_ROLLBACK_FAILED": "更新回滚失败",
  "errorCode.UPDATE_FINALIZATION_WARNING": "更新已安装，但收尾操作有警告",
  "errorCode.UPDATE_RUN_FAILED": "更新任务失败",
  "errorCode.SQUAD_SERVICE_CLOSED": "Squad 服务已停止",
  "errorCode.SQUAD_CONFIGURATION_IN_PROGRESS": "另一项节点配置正在验证",
  "errorCode.INVALID_RELAY_URL": "Relay 地址必须是 HTTPS 原点",
  "errorCode.INVALID_DIRECT_URL": "Direct 地址必须是 HTTPS 原点",
  "errorCode.RELAY_ENROLLMENT_REQUIRED":
    "此节点尚未在该 Relay 登记，请填写一次性邀请",
  "errorCode.RELAY_CONNECTION_FAILED": "无法连接 Relay，请检查地址、网络和 TLS",
  "errorCode.DIRECT_PUBLIC_URL_REQUIRED":
    "启用 Direct 接收时必须填写本节点公共地址",
  "errorCode.INVALID_INVITATION": "一次性邀请无效",
  "errorCode.INVITATION_ALREADY_USED": "一次性邀请已被使用",
  "errorCode.INVITATION_EXPIRED": "一次性邀请已过期",
  "errorCode.INVALID_RESPONSE": "Relay 返回了无效响应",
  "summary.executionInterrupted":
    "接收方 DSH 在执行期间停止。可能已经发生的外部副作用不会自动重放。",
  "summary.rejectedByOwner": "接收方已拒绝。",
  "summary.canceledBeforeDelivery": "已在接收方节点确认投递前取消。",
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
  "inbox.attentionLabel": "Agent Inbox, {count} items need attention",
  "tab.overview": "Overview",
  "tab.plans": "Plans",
  "tab.waiting": "Waiting for me",
  "tab.running": "Running",
  "tab.sent": "Sent",
  "tab.completed": "Completed",
  "tab.organizations": "Organizations",
  "tab.updates": "Updates",
  "tab.settings": "Settings",
  "overview.title": "Team action center",
  "overview.intro":
    "See the collaboration items that need your decision, input, or attention.",
  "overview.attention": "Items needing attention",
  "overview.waitingHuman": "Waiting for me",
  "overview.failedOutgoing": "Delivery failures",
  "overview.pendingJoins": "Join approvals",
  "overview.draftPlans": "Draft plans",
  "overview.allClear": "Nothing needs your attention right now.",
  "overview.updateAvailable":
    "A Squad update is available; open the update center",
  "overview.nextOrganization": "Create or join an organization",
  "overview.nextOrganizationHint":
    "The Relay is connected. An organization gives every member a shared, signed team directory.",
  "overview.openOrganizations": "Open organizations",
  "overview.nextPeer": "Add your first peer",
  "overview.nextPeerHint":
    "Create a trusted pairing before delegating to another Personal Agent.",
  "overview.openPeers": "Open peer settings",
  "overview.tryDelegation": "Try your first team delegation",
  "overview.tryDelegationHint":
    "Describe the team task naturally in any DSH session.",
  "overview.examplePrompt":
    "Use these meeting notes to create a reviewable delegation plan for the team.",
  "direction.received": "Received",
  "direction.sent": "Sent",
  "field.peer": "Peer",
  "field.delivery": "Delivery",
  "field.deliveryAttempts": "Failed delivery attempts",
  "field.nextDeliveryAttempt": "Next attempt",
  "field.lastDeliveryError": "Latest delivery error",
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
  "action.createOrganization": "Create organization",
  "action.joinOrganization": "Request to join",
  "action.createInvitation": "Create one-time invitation",
  "action.approveJoin": "Approve join",
  "action.enableMember": "Enable member",
  "action.disableMember": "Disable member",
  "action.copyPrompt": "Copy example",
  "plan.approvalHint":
    "Approval creates one existing signed delegation per item; each recipient still decides execution through their own Peer policy.",
  "plan.itemCount": "{count} plan items",
  "plan.dispatchedCount": "Created {sent}/{total} delegations",
  "setup.firstRun": "First-time setup",
  "setup.title": "Connect this Node to a team",
  "setup.intro":
    "Choose a recognizable name and either Relay or Direct. After validation, the settings stay on this computer—no YAML editing required.",
  "setup.chooseMode": "Choose a team connection",
  "setup.relayTitle": "Join a Relay (recommended)",
  "setup.relayDescription":
    "Best for distributed and offline teams; personal computers make outbound connections to an always-on Relay.",
  "setup.directTitle": "Direct peer-to-peer",
  "setup.directDescription":
    "Best for a LAN, VPN, or small team with reachable HTTPS endpoints; no Relay is required.",
  "setup.relayUrl": "Relay URL",
  "setup.relayUrlHint":
    "Production requires HTTPS; loopback HTTP is accepted for local development.",
  "setup.invitation": "One-time Node invitation (optional)",
  "setup.invitationHint":
    "Enter it when enrolling this Node for the first time; an already enrolled Node may leave it blank. It is used only for validation and is not stored in the Node database.",
  "setup.directReceive": "Allow paired Nodes to deliver directly to me",
  "setup.directPublicUrl": "This Node's public Direct URL",
  "setup.directPublicUrlHint":
    "Required when receiving is enabled. Squad does not configure DNS, TLS, port mapping, or a reverse proxy.",
  "setup.securityHint":
    "The local management API accepts only loopback and same-origin requests. Relay invitations never appear in state responses or persisted setup.",
  "setup.switchWarning":
    "Saving switches the active connection immediately. Existing identity, organizations, and tasks are retained, but work that the new transport cannot deliver remains queued locally.",
  "setup.complete": "Validate and finish",
  "setup.save": "Validate and save",
  "setup.saving": "Validating…",
  "setup.later": "Set up later",
  "setup.saved": "Node settings saved.",
  "settings.connection": "Team connection",
  "settings.nodeIdentity": "Node identity",
  "settings.relay": "Relay",
  "settings.relayServing": "relay service is running",
  "settings.relayConfigured": "relay connection configured",
  "settings.relayNotConfigured": "not configured",
  "settings.direct": "Peer-to-peer Direct",
  "settings.directServing": "direct receiving enabled",
  "settings.directNotServing": "direct receiving disabled",
  "settings.peers": "Peers",
  "settings.peerDisabled": "Disabled",
  "settings.pairPeer": "Pair a pinned peer",
  "settings.displayName": "Display name",
  "settings.nodeId": "Node ID",
  "settings.publicKey": "Ed25519 public key",
  "settings.transport": "Task transport",
  "settings.directUrl": "Peer Direct URL",
  "settings.directUrlHint":
    "Required for Direct mode. Production endpoints require HTTPS; loopback HTTP is only for local development.",
  "settings.autoExecute": "Automatic execution",
  "transport.RELAY": "Relay",
  "transport.DIRECT": "Direct peer-to-peer",
  "settings.trustedWarning":
    "Trusted objectives skip human approval and run on this computer. Enable this only for members you fully trust.",
  "settings.languageHint":
    "The DSH global language setting controls this interface; first use follows the system language.",
  "updates.title": "Update center",
  "updates.securityHint":
    "Only releases signed by the pinned Squad release key with a matching hash are accepted. A separate updater backs up after shutdown and rolls back when health checks fail.",
  "updates.currentVersion": "Current version",
  "updates.latestVersion": "Latest version",
  "updates.lastChecked": "Last checked",
  "updates.notChecked": "Not checked",
  "updates.openRelease": "Open GitHub Release",
  "updates.policy": "Update policy",
  "updates.policyLabel": "Update behavior for this Node",
  "updates.modeHint.DISABLED":
    "Do not check periodically or install automatically. Manual checks remain available.",
  "updates.modeHint.NOTIFY":
    "Check periodically and notify; installation requires your explicit approval. This is the default.",
  "updates.modeHint.AUTOMATIC":
    "Back up, install, and restart automatically while the Node is idle; failures trigger rollback.",
  "updates.automaticWarning":
    "Automatic updates briefly restart this Node. Active delegations or dispatching plans defer the update.",
  "updates.automaticConfirmation":
    "Enable automatic updates? The external updater will back up data and restart the service while the Node is idle.",
  "updates.installConfirmation":
    "Install the verified update? The external updater will wait for an idle Node, then back up and restart the service.",
  "updates.updater": "External updater",
  "updates.updaterConfigured": "Configured and executed by {unit}",
  "updates.updaterNotConfigured": "Not configured",
  "updates.updaterSetupHint":
    "A server Relay must first run dsh-squad-update install-systemd. Checks work before setup, but installation from this screen does not.",
  "updates.requestPending":
    "The installation request is queued; the updater will process it when this Node is idle.",
  "updates.checkNow": "Check now",
  "updates.checking": "Checking…",
  "updates.installNow": "Install verified update",
  "updateMode.DISABLED": "Disabled",
  "updateMode.NOTIFY": "Notify only (recommended)",
  "updateMode.AUTOMATIC": "Install automatically",
  "updatePhase.IDLE": "Not checked",
  "updatePhase.CHECKING": "Checking",
  "updatePhase.UP_TO_DATE": "Up to date",
  "updatePhase.AVAILABLE": "Update available",
  "updatePhase.REQUESTED": "Install requested",
  "updatePhase.DOWNLOADING": "Downloading",
  "updatePhase.VERIFYING": "Verifying",
  "updatePhase.BLOCKED": "Deferred",
  "updatePhase.BACKING_UP": "Backing up",
  "updatePhase.INSTALLING": "Installing",
  "updatePhase.RESTARTING": "Restarting",
  "updatePhase.INSTALLED": "Installed",
  "updatePhase.ROLLED_BACK": "Rolled back",
  "updatePhase.FAILED": "Update failed",
  "context.node": "Current Node",
  "context.session": "Current session",
  "context.organization": "Organization context",
  "context.directPeers": "Direct Peers",
  "context.noSession": "No DSH session is selected",
  "context.selectHint":
    "Each session can select one organization independently; recipients resolve only inside that signed member directory.",
  "organizations.title": "Organizations",
  "organizations.create": "Create an organization",
  "organizations.join": "Request access with a one-time invitation",
  "organizations.name": "Organization name",
  "organizations.invitation": "Organization invitation",
  "organizations.invitationExpiry": "Invitation lifetime (minutes)",
  "organizations.invitationResult":
    "One-time invitation (send through a secure channel)",
  "organizations.invitationExpires": "Expires at {time}",
  "organizations.members": "Members",
  "organizations.pendingRequests": "Pending join requests",
  "organizations.noPendingRequests": "No pending join requests.",
  "organizations.noOrganizations":
    "This Node has not joined an organization yet.",
  "organizations.self": "This Node",
  "organizations.localPolicy": "Local receiving policy",
  "organizations.directoryRevision": "Signed directory revision {revision}",
  "organizations.pendingHint":
    "The join request was sent and is waiting for an Owner or Admin.",
  "organizations.securityHint":
    "Members sign the organization directory and every Node verifies it locally. Relay only brokers the directory and identity boundary; it gains no local Agent capability.",
  "organizationRole.OWNER": "Owner",
  "organizationRole.ADMIN": "Admin",
  "organizationRole.MEMBER": "Member",
  "organizationStatus.ACTIVE": "Active",
  "organizationStatus.PENDING": "Pending approval",
  "organizationStatus.DISABLED": "Disabled",
  "empty.list": "Nothing here.",
  "empty.selection": "Select a delegation.",
  "empty.plans":
    "No delegation plans yet. Ask the Agent to use meeting notes to create a reviewable team delegation draft.",
  "empty.planSelection": "Select a delegation plan.",
  "empty.sent":
    "No outgoing delegations yet. Tell the Agent who should receive a task and what should be completed.",
  "empty.completed": "No finished delegations yet.",
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
  "delivery.WAITING_FOR_PEER": "Waiting for peer reachability",
  "delivery.STORED_BY_RELAY": "Persisted by Relay",
  "delivery.RECEIVED_BY_NODE": "Received by peer Node",
  "delivery.DELIVERY_EXPIRED": "Delivery expired",
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
  "error.organizationActionFailed": "Organization action failed",
  "error.policyUpdateFailed": "Could not update automatic execution policy",
  "error.sessionOrganizationFailed": "Could not change session organization",
  "error.updateActionFailed": "Update action failed",
  "error.setupFailed": "Could not save Node settings",
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
  "errorCode.DELIVERY_EXPIRED": "Delivery expired before peer receipt",
  "errorCode.UPDATE_CHECK_FAILED": "Update check failed",
  "errorCode.REQUEST_VERSION_CHANGED": "Approved update version changed",
  "errorCode.ROLLED_BACK_VERSION_SUPPRESSED":
    "Automatic retry of rolled-back version suppressed",
  "errorCode.NODE_STATE_UNAVAILABLE": "Could not verify local Node state",
  "errorCode.NODE_VERSION_MISMATCH": "Updater and Node versions differ",
  "errorCode.NODE_ID_CHANGED": "Update target Node identity changed",
  "errorCode.ACTIVE_WORK": "Node still has active work",
  "errorCode.UPDATE_ALREADY_RUNNING": "Another update is running",
  "errorCode.UPDATE_INSTALL_FAILED":
    "Update installation failed; rollback attempted",
  "errorCode.UPDATE_ROLLBACK_FAILED": "Update rollback failed",
  "errorCode.UPDATE_FINALIZATION_WARNING":
    "Update installed with finalization warnings",
  "errorCode.UPDATE_RUN_FAILED": "Update run failed",
  "errorCode.SQUAD_SERVICE_CLOSED": "Squad service has stopped",
  "errorCode.SQUAD_CONFIGURATION_IN_PROGRESS":
    "Another Node configuration is being validated",
  "errorCode.INVALID_RELAY_URL": "Relay URL must be an HTTPS origin",
  "errorCode.INVALID_DIRECT_URL": "Direct URL must be an HTTPS origin",
  "errorCode.RELAY_ENROLLMENT_REQUIRED":
    "This Node is not enrolled at that Relay; enter a one-time invitation",
  "errorCode.RELAY_CONNECTION_FAILED":
    "Could not connect to the Relay; check its URL, network, and TLS",
  "errorCode.DIRECT_PUBLIC_URL_REQUIRED":
    "This Node's public URL is required when Direct receiving is enabled",
  "errorCode.INVALID_INVITATION": "The one-time invitation is invalid",
  "errorCode.INVITATION_ALREADY_USED":
    "The one-time invitation has already been used",
  "errorCode.INVITATION_EXPIRED": "The one-time invitation has expired",
  "errorCode.INVALID_RESPONSE": "The Relay returned an invalid response",
  "summary.executionInterrupted":
    "The receiving DSH process stopped while execution was active. Potential external side effects were not replayed.",
  "summary.rejectedByOwner": "Rejected by the receiving owner.",
  "summary.canceledBeforeDelivery":
    "Canceled before the receiving Node acknowledged delivery.",
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
  WAITING_FOR_PEER: "delivery.WAITING_FOR_PEER",
  STORED_BY_RELAY: "delivery.STORED_BY_RELAY",
  RECEIVED_BY_NODE: "delivery.RECEIVED_BY_NODE",
  DELIVERY_EXPIRED: "delivery.DELIVERY_EXPIRED",
  RECEIVED_LOCAL: "delivery.RECEIVED_LOCAL",
} as const satisfies Record<string, SquadLocaleKey>;

const policyKeys = {
  NEVER: "policy.NEVER",
  SAFE: "policy.SAFE",
  TRUSTED: "policy.TRUSTED",
} as const satisfies Record<string, SquadLocaleKey>;

const organizationRoleKeys = {
  OWNER: "organizationRole.OWNER",
  ADMIN: "organizationRole.ADMIN",
  MEMBER: "organizationRole.MEMBER",
} as const satisfies Record<OrganizationRole, SquadLocaleKey>;

const organizationStatusKeys = {
  ACTIVE: "organizationStatus.ACTIVE",
  PENDING: "organizationStatus.PENDING",
  DISABLED: "organizationStatus.DISABLED",
} as const satisfies Record<
  OrganizationMemberStatus | "PENDING",
  SquadLocaleKey
>;

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

const updateModeKeys = {
  DISABLED: "updateMode.DISABLED",
  NOTIFY: "updateMode.NOTIFY",
  AUTOMATIC: "updateMode.AUTOMATIC",
} as const satisfies Record<UpdateMode, SquadLocaleKey>;

const updatePhaseKeys = {
  IDLE: "updatePhase.IDLE",
  CHECKING: "updatePhase.CHECKING",
  UP_TO_DATE: "updatePhase.UP_TO_DATE",
  AVAILABLE: "updatePhase.AVAILABLE",
  REQUESTED: "updatePhase.REQUESTED",
  DOWNLOADING: "updatePhase.DOWNLOADING",
  VERIFYING: "updatePhase.VERIFYING",
  BLOCKED: "updatePhase.BLOCKED",
  BACKING_UP: "updatePhase.BACKING_UP",
  INSTALLING: "updatePhase.INSTALLING",
  RESTARTING: "updatePhase.RESTARTING",
  INSTALLED: "updatePhase.INSTALLED",
  ROLLED_BACK: "updatePhase.ROLLED_BACK",
  FAILED: "updatePhase.FAILED",
} as const satisfies Record<UpdatePhase, SquadLocaleKey>;

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
  UPDATE_CHECK_FAILED: "errorCode.UPDATE_CHECK_FAILED",
  REQUEST_VERSION_CHANGED: "errorCode.REQUEST_VERSION_CHANGED",
  ROLLED_BACK_VERSION_SUPPRESSED: "errorCode.ROLLED_BACK_VERSION_SUPPRESSED",
  NODE_STATE_UNAVAILABLE: "errorCode.NODE_STATE_UNAVAILABLE",
  NODE_VERSION_MISMATCH: "errorCode.NODE_VERSION_MISMATCH",
  NODE_ID_CHANGED: "errorCode.NODE_ID_CHANGED",
  ACTIVE_WORK: "errorCode.ACTIVE_WORK",
  UPDATE_ALREADY_RUNNING: "errorCode.UPDATE_ALREADY_RUNNING",
  UPDATE_INSTALL_FAILED: "errorCode.UPDATE_INSTALL_FAILED",
  UPDATE_ROLLBACK_FAILED: "errorCode.UPDATE_ROLLBACK_FAILED",
  UPDATE_FINALIZATION_WARNING: "errorCode.UPDATE_FINALIZATION_WARNING",
  UPDATE_RUN_FAILED: "errorCode.UPDATE_RUN_FAILED",
  SQUAD_SERVICE_CLOSED: "errorCode.SQUAD_SERVICE_CLOSED",
  SQUAD_CONFIGURATION_IN_PROGRESS: "errorCode.SQUAD_CONFIGURATION_IN_PROGRESS",
  INVALID_RELAY_URL: "errorCode.INVALID_RELAY_URL",
  INVALID_DIRECT_URL: "errorCode.INVALID_DIRECT_URL",
  RELAY_ENROLLMENT_REQUIRED: "errorCode.RELAY_ENROLLMENT_REQUIRED",
  RELAY_CONNECTION_FAILED: "errorCode.RELAY_CONNECTION_FAILED",
  DIRECT_PUBLIC_URL_REQUIRED: "errorCode.DIRECT_PUBLIC_URL_REQUIRED",
  INVALID_INVITATION: "errorCode.INVALID_INVITATION",
  INVITATION_ALREADY_USED: "errorCode.INVITATION_ALREADY_USED",
  INVITATION_EXPIRED: "errorCode.INVITATION_EXPIRED",
  INVALID_RESPONSE: "errorCode.INVALID_RESPONSE",
} as const satisfies Record<string, SquadLocaleKey>;

const summaryKeys = {
  "The receiving DSH process stopped while execution was active. Potential external side effects were not replayed.":
    "summary.executionInterrupted",
  "Rejected by owner.": "summary.rejectedByOwner",
  "Rejected by the receiving owner.": "summary.rejectedByOwner",
  "Canceled before Relay delivery.": "summary.canceledBeforeDelivery",
  "Canceled before the receiving Node acknowledged delivery.":
    "summary.canceledBeforeDelivery",
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

export function formatOrganizationRole(
  t: SquadTranslate,
  role: OrganizationRole,
): string {
  return t(organizationRoleKeys[role]);
}

export function formatOrganizationStatus(
  t: SquadTranslate,
  status: OrganizationMemberStatus | "PENDING",
): string {
  return t(organizationStatusKeys[status]);
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

export function formatUpdateMode(t: SquadTranslate, mode: UpdateMode): string {
  return t(updateModeKeys[mode]);
}

export function formatUpdatePhase(
  t: SquadTranslate,
  phase: UpdatePhase,
): string {
  return t(updatePhaseKeys[phase]);
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
