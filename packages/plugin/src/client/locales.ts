import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  TeamPlanItemStatus,
  TeamPlanStatus,
} from "../shared/contracts.ts";
import type {
  OrganizationInvitationStatus,
  OrganizationMemberStatus,
  OrganizationRole,
} from "../shared/organizations.ts";
import type { ConnectionStatus, DelegationStatus } from "../shared/state.ts";
import type { UpdateMode, UpdatePhase } from "../shared/updates.ts";

export const SQUAD_LOCALE_NS = "dsh-squad";

export const zh = {
  "html.lang": "zh-CN",
  "inbox.title": "Squad 团队协作",
  "inbox.close": "关闭 Squad",
  "inbox.attentionLabel": "Squad 有 {count} 项需要处理",
  "nav.label": "Squad 功能导航",
  "nav.work": "工作",
  "nav.team": "团队",
  "nav.system": "系统",
  "tab.overview": "概览",
  "tab.plans": "分派计划",
  "tab.waiting": "待我处理",
  "tab.running": "运行中",
  "tab.sent": "已发送",
  "tab.completed": "已完成",
  "tab.organizations": "组织",
  "tab.diagnostics": "连接诊断",
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
  "field.response": "对此待办的回复",
  "field.attachmentRefs": "附件引用",
  "field.attachmentUrl": "HTTPS 下载地址",
  "field.attachmentName": "文件名",
  "field.attachmentSha256": "SHA-256",
  "field.attachmentSize": "大小（字节）",
  "field.outputs": "输出",
  "field.sourceSummary": "来源摘要",
  "field.planItems": "计划项",
  "field.delegationId": "委派 ID",
  "field.updatedAt": "最近更新",
  "action.completeSelected": "完成所选项",
  "action.submitTodo": "提交此项并继续",
  "action.addAttachment": "添加附件引用",
  "action.removeAttachment": "移除此附件",
  "action.createRule": "创建规则",
  "action.editRule": "编辑",
  "action.enableRule": "启用",
  "action.disableRule": "停用",
  "action.deleteRule": "删除规则",
  "action.reject": "拒绝",
  "action.acceptAndRun": "接受并运行",
  "action.retryDelivery": "重试投递",
  "action.requestCancel": "请求取消",
  "action.openSession": "打开原生 DSH 会话",
  "action.savePeer": "保存对等方",
  "action.saveChanges": "保存更改",
  "action.saving": "正在保存…",
  "action.enablePeer": "启用",
  "action.disablePeer": "停用",
  "action.removePeer": "移除配对",
  "action.copy": "复制配对包",
  "action.copied": "已复制",
  "action.approvePlan": "确认并分派",
  "action.retryPlan": "重试未发送项",
  "action.cancelPlan": "取消剩余计划项",
  "action.editPlan": "编辑草案",
  "action.savePlan": "保存草案",
  "action.addPlanItem": "添加计划项",
  "action.removePlanItem": "移除此项",
  "action.moveUp": "上移",
  "action.moveDown": "下移",
  "action.movePlanItemUp": "上移计划项",
  "action.movePlanItemDown": "下移计划项",
  "action.viewDelegation": "查看完整任务",
  "action.createOrganization": "创建组织",
  "action.joinOrganization": "申请加入",
  "action.createInvitation": "创建一次性邀请",
  "action.revokeInvitation": "撤销邀请",
  "action.createJoinPackage": "为新节点创建加入包",
  "action.approveJoin": "批准加入",
  "action.rejectJoin": "拒绝加入",
  "action.enableMember": "启用成员",
  "action.disableMember": "禁用成员",
  "action.copyPrompt": "复制示例",
  "action.retry": "重试",
  "action.cancel": "返回",
  "confirm.rejectTitle": "拒绝这个任务？",
  "confirm.rejectDelegation":
    "拒绝后，发送方会收到明确的拒绝状态。任务：“{objective}”",
  "confirm.cancelDelegationTitle": "请求取消这个任务？",
  "confirm.cancelDelegation":
    "若对方已开始运行，只能请求其停止；已经发生的外部副作用不会回滚。任务：“{objective}”",
  "confirm.acceptTaskTitle": "接受并运行这个任务？",
  "confirm.acceptTask":
    "任务将交给本机 Agent，可能调用工具并产生外部副作用。任务：“{objective}”",
  "confirm.resumeTaskTitle": "提交回复并继续运行？",
  "confirm.resumeTodo":
    "将完成待办“{todo}”，并让本机 Agent 继续任务：“{objective}”",
  "confirm.switchModeTitle": "切换团队连接方式？",
  "confirm.switchMode":
    "节点会立即切换到“{mode}”。身份、组织和任务会保留，但新连接无法投递的任务将留在本地队列中。",
  "confirm.switchModeAction": "确认切换",
  "confirm.automationRuleTitle": "启用本机自动执行规则？",
  "confirm.automationRule":
    "规则“{name}”会让匹配“{pattern}”的任务无需人工确认，并最多开放 {count} 个指定工具。仅对已设为“匹配本机规则”的成员生效。",
  "confirm.enableAutomationRuleAction": "启用此规则",
  "confirm.deleteAutomationRuleTitle": "删除自动执行规则？",
  "confirm.deleteAutomationRule":
    "删除“{name}”后，原本只匹配此规则的任务将等待本人确认。",
  "confirm.dispatchPlanTitle": "确认分派计划？",
  "confirm.dispatchPlan":
    "将从“{title}”创建并发送 {count} 个独立任务。发送后只能逐项请求取消。",
  "confirm.cancelPlanTitle": "取消计划中的剩余项？",
  "confirm.cancelPlan":
    "“{title}”中尚未发送的计划项会被取消；已经发出的任务不会自动撤回。",
  "confirm.approveJoinTitle": "批准成员加入？",
  "confirm.approveJoin":
    "“{name}”将加入“{organization}”，并可查看成员目录和接收组织任务。",
  "confirm.rejectJoinTitle": "拒绝此加入申请？",
  "confirm.rejectJoin":
    "“{name}”对“{organization}”的申请会被关闭；对方需要新的邀请才能再次申请。",
  "confirm.revokeInvitationTitle": "撤销此邀请？",
  "confirm.revokeInvitation":
    "撤销后，尚未使用的邀请将立即失效；已经完成的加入申请不会受到影响。",
  "confirm.changeRoleTitle": "更改组织角色？",
  "confirm.changeRole":
    "将“{name}”在“{organization}”中的角色改为“{role}”。管理员可以邀请、批准和管理普通成员。",
  "confirm.changeRoleAction": "确认更改角色",
  "confirm.enableMemberTitle": "重新启用成员？",
  "confirm.enableMember":
    "“{name}”将恢复“{organization}”的成员访问和任务路由。",
  "confirm.disableMemberTitle": "禁用成员？",
  "confirm.disableMember":
    "“{name}”将无法继续通过“{organization}”收发任务；历史记录会保留。",
  "confirm.trustedPolicyTitle": "允许无需确认地自动执行？",
  "confirm.trustedPolicy":
    "来自“{name}”的任务将跳过人工确认并在这台电脑上运行。对方可能触发工具和本机副作用。",
  "confirm.trustedNewPeer":
    "这个新对等方发送的任务将跳过人工确认并在这台电脑上运行。仅在你已核验其身份并完全信任时启用。",
  "confirm.enableTrustedAction": "启用受信自动执行",
  "confirm.removePeerTitle": "移除固定配对？",
  "confirm.disablePeerTitle": "停用这个对等方？",
  "confirm.disablePeer":
    "停用“{name}”后，来自该对等方的新任务会被拒绝，等待投递的任务可能失败。",
  "confirm.automaticUpdatesTitle": "启用自动更新？",
  "confirm.enableAutomaticUpdatesAction": "启用自动更新",
  "confirm.installUpdateTitle": "安装 Squad 更新？",
  "loading.title": "正在载入 Squad 状态…",
  "humanTodo.oneAtATime": "每条待办分别回复；提交一条不会默认完成其他待办。",
  "humanTodo.responsePlaceholder": "填写决定、补充信息或操作结果…",
  "humanTodo.attachments": "附件引用（可选）",
  "humanTodo.attachmentHint":
    "Squad 只传递可验证的 HTTPS 引用，不上传本机文件；最多 10 个，每个不超过 25 MiB。",
  "humanTodo.noAttachments": "没有附件引用。",
  "humanTodo.attachmentNumber": "附件 {number}",
  "plan.approvalHint":
    "确认后，每个计划项会通过现有签名委派发送；接收方仍按自己的 Peer 策略决定是否执行。",
  "plan.title": "计划标题",
  "plan.objective": "任务目标",
  "plan.editTitle": "编辑分派草案",
  "plan.editHint":
    "保存只修改本机草案，不会发送任务。确认分派后，计划项将锁定并分别创建委派。",
  "plan.changedWhileEditing":
    "此草案已在别处发生变化。请返回并重新打开编辑器，避免覆盖新版本。",
  "plan.itemNumber": "计划项 {number}",
  "plan.criteriaHint": "每行一条验收条件，最多 20 条",
  "plan.unavailableRecipient": "{name}（当前不可用）",
  "plan.noRecipients":
    "当前范围内没有允许接收委派的成员；可以保留已有项，但无法添加新项或保存到不可用成员。",
  "plan.itemCount": "共 {count} 个计划项",
  "plan.dispatchedCount": "已创建 {sent}/{total} 个委派",
  "plan.progressLabel": "计划执行进度",
  "plan.settledCount": "已有 {settled}/{total} 项结束",
  "plan.completed": "成功完成",
  "plan.active": "执行中",
  "plan.waitingHuman": "等待人工",
  "plan.failed": "失败",
  "plan.pendingDispatch": "待发送",
  "setup.firstRun": "首次设置",
  "setup.title": "把这个节点加入团队",
  "setup.intro":
    "设置一个便于成员识别的名称，再选择 Relay 或 Direct。验证通过后配置会保存在本机，无需编辑 YAML。",
  "setup.chooseMode": "选择主连接方式",
  "setup.relayTitle": "加入 Relay（推荐）",
  "setup.relayDescription":
    "适合跨地域和离线协作；仍可为指定节点同时启用 Direct 直连。",
  "setup.directTitle": "仅使用 Direct",
  "setup.directDescription":
    "适合局域网、VPN 或已有 HTTPS 可达地址的小团队；不需要 Relay。",
  "setup.relayUrl": "Relay 地址",
  "setup.relayUrlHint":
    "生产环境必须使用 HTTPS；本机开发可使用 loopback HTTP。",
  "setup.invitation": "一次性节点邀请（可选）",
  "setup.invitationHint":
    "首次登记此节点时填写；已登记节点可留空。只用于本次验证，不保存在节点数据库。",
  "setup.directReceive": "允许其他已配对节点向我直连投递",
  "setup.optionalDirectReceive": "同时允许已配对节点向我 Direct 直连投递",
  "setup.optionalDirectHint":
    "这是 Relay 之外的可选投递路径；不会改变组织身份和成员关系。",
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
  "settings.noPeers": "还没有固定配对。交换签名配对包即可建立连接。",
  "settings.peerDisabled": "已禁用",
  "settings.editPeer": "编辑连接",
  "settings.removeConfirmation":
    "确定移除“{name}”吗？现有任务记录会保留，以后重新导入配对包即可恢复。",
  "settings.pairPeer": "添加固定公钥的对等方",
  "settings.displayName": "显示名称",
  "settings.nodeId": "节点 ID",
  "settings.publicKey": "Ed25519 公钥",
  "settings.transport": "任务传输方式",
  "settings.directUrl": "对方直连地址",
  "settings.directUrlHint":
    "Direct 模式必填。生产环境必须使用 HTTPS；只有本机开发可以使用 loopback HTTP。",
  "settings.autoExecute": "自动执行",
  "settings.manualPairing": "高级：手动填写身份",
  "settings.manualPairingHint":
    "仅用于兼容或故障排查。正常使用请交换经过签名校验的配对包。",
  "pairing.title": "交换配对包",
  "pairing.intro":
    "配对包会固定对方的公开身份和可用连接地址；它不包含私钥、密码或组织邀请。",
  "pairing.shareTitle": "让对方添加我",
  "pairing.shareHint":
    "生成一个有效期为 7 天的签名配对包，通过你信任的通道发给对方。",
  "pairing.create": "生成我的配对包",
  "pairing.creating": "正在生成…",
  "pairing.unreachable":
    "当前节点没有 Relay 或可达的 Direct 地址，请先配置一种可接收的连接。",
  "pairing.bundle": "Squad 配对包",
  "pairing.expires": "有效期至 {time}",
  "pairing.importTitle": "添加对方",
  "pairing.bundlePlaceholder": "粘贴 squad-peer-v1.…",
  "pairing.transport": "首选连接",
  "pairing.transportAuto": "自动选择（优先 Direct）",
  "pairing.import": "验证并添加",
  "pairing.importing": "正在验证…",
  "transport.RELAY": "Relay 中继",
  "transport.DIRECT": "Direct 点对点",
  "settings.trustedWarning":
    "“始终自动执行”会跳过目标匹配和人工确认，并使用完整本机 preset；仅对你充分信任的成员启用。",
  "settings.languageHint":
    "界面语言由 DSH 全局设置统一控制；首次使用时跟随系统语言。",
  "automation.title": "本机自动执行规则",
  "automation.intro":
    "规则只决定已选“匹配本机规则”的发送方何时可以跳过确认。目标必须完整匹配，运行时还会强制执行工具白名单和资源上限。",
  "automation.name": "规则名称",
  "automation.objectivePattern": "目标通配模式",
  "automation.patternPlaceholder": "例如：总结 * 的发布说明",
  "automation.patternHint":
    "不区分大小写并匹配完整目标；* 代表任意数量字符，? 代表一个字符。不会执行正则表达式。",
  "automation.allowedTools": "允许的 DSH 工具",
  "automation.toolsPlaceholder": "每行一个准确工具名；留空表示不允许调用工具",
  "automation.toolsHint":
    "这里只填写可执行工具名；run_code 和 Squad 结果工具由运行时管理。不存在的工具会让任务转为等待确认。",
  "automation.preset": "Agent preset（可选）",
  "automation.defaultPreset": "留空使用 Squad 默认 preset",
  "automation.runtime": "最长运行时间（分钟）",
  "automation.maxTokens": "最大 Token（可选）",
  "automation.priority": "优先级（数值越小越先匹配）",
  "automation.allowAttachments": "允许带附件的任务匹配此规则",
  "automation.enabled": "创建后立即启用",
  "automation.create": "新建自动执行规则",
  "automation.sourceFile": "配置文件规则（只读）",
  "automation.sourceInterface": "界面规则",
  "automation.disabled": "已停用",
  "automation.noTools": "不允许工具",
  "automation.attachmentsAllowed": "允许附件",
  "automation.attachmentsDenied": "不允许附件",
  "automation.ruleSummary":
    "工具：{tools} · 最长 {runtime} 分钟 · {attachments}",
  "automation.noEnabledRules":
    "已有成员使用“匹配本机规则”，但目前没有启用的规则；他们发来的任务都会等待本人确认。",
  "automation.legacyIgnored":
    "检测到 {count} 条旧 safeObjectivePrefixes。前缀匹配无法限制工具，现已停止作为自动执行授权；请在此创建显式规则。",
  "diagnostics.title": "连接诊断",
  "diagnostics.intro":
    "检查实际连接、事件通道和本地待投递队列；配置存在不等于端点可达。",
  "diagnostics.checkNow": "立即检查连接",
  "diagnostics.checking": "正在检查…",
  "diagnostics.lastChecked": "检查时间：{time}",
  "diagnostics.notChecked": "尚未主动检查",
  "diagnostics.relay": "Relay",
  "diagnostics.direct": "Direct 接收",
  "diagnostics.queue": "待投递队列",
  "diagnostics.eventStream": "实时事件通道",
  "diagnostics.event.CONNECTED": "已连接",
  "diagnostics.event.POLLING": "轮询回退",
  "diagnostics.event.DISABLED": "未启用",
  "diagnostics.lastSuccess": "最近成功：{time}",
  "diagnostics.lastReceived": "最近直连接收：{time}",
  "diagnostics.remoteVersion": "远端 Squad v{version}",
  "diagnostics.protocols": "协议：{versions}",
  "diagnostics.pending": "{count} 个信封等待投递",
  "diagnostics.retrying": "其中 {count} 个正在重试",
  "diagnostics.nextAttempt": "下次尝试：{time}",
  "diagnostics.selfCheckHint":
    "Direct 检查证明本机能够通过公共地址访问并命中同一节点；它不能替代从外部网络进行的入站可达性测试。",
  "diagnostics.lastError": "最近错误：{error}",
  "connectionStatus.NOT_CONFIGURED": "未配置",
  "connectionStatus.CHECKING": "检查中",
  "connectionStatus.CONNECTED": "已连接",
  "connectionStatus.SERVING": "正在提供服务",
  "connectionStatus.READY": "可达且身份匹配",
  "connectionStatus.UNVERIFIED": "尚未验证",
  "connectionStatus.UNREACHABLE": "不可达",
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
  "context.relayRequired": "当前没有 Relay 连接，已保存的组织暂不可用。",
  "organizations.title": "组织",
  "organizations.create": "创建新组织",
  "organizations.join": "使用邀请申请加入",
  "organizations.name": "组织名称",
  "organizations.invitation": "组织邀请或加入包",
  "organizations.joinHint":
    "新节点粘贴加入包即可自动配置 Relay；已登记到同一 Relay 的节点也可使用普通组织邀请。",
  "organizations.joinPackage": "团队加入包",
  "organizations.joinPackagePlaceholder": "粘贴 squad-join-v1.…",
  "organizations.invitationExpiry": "邀请有效期（分钟）",
  "organizations.invitationResult": "一次性组织邀请（请通过安全渠道发送）",
  "organizations.joinPackageResult":
    "一次性团队加入包（包含 Relay 登记和组织邀请，请通过安全渠道发送）",
  "organizations.invitationExpires": "有效期至 {time}",
  "organizations.invitationHistory": "邀请记录",
  "organizations.invitationHistoryHint":
    "出于安全考虑，创建后不会再次显示邀请 token；这里仅显示状态和审计信息。",
  "organizations.invitationCreated": "创建于 {time}",
  "organizations.invitationCreator": "创建者：{name}",
  "organizations.noInvitations": "尚未创建邀请。",
  "organizations.loadingInvitations": "正在加载邀请记录…",
  "invitationStatus.ACTIVE": "有效",
  "invitationStatus.USED": "已使用",
  "invitationStatus.EXPIRED": "已过期",
  "invitationStatus.REVOKED": "已撤销",
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
  "organizations.relayRequired": "组织目录需要 Relay 连接",
  "organizations.relayRequiredHint":
    "Direct 对等方仍可正常使用；创建、加入和同步组织需要先在设置中配置 Relay。",
  "organizations.retainedHint":
    "切换连接方式不会删除已保存的组织、身份或历史任务。",
  "joinPackage.haveOne": "已有团队加入包？",
  "joinPackage.onboardingHint":
    "粘贴管理员发来的加入包，Squad 会一次完成 Relay 登记和组织加入申请。",
  "joinPackage.join": "验证并加入团队",
  "joinPackage.joining": "正在验证并加入…",
  "joinPackage.or": "或者手动配置",
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
  "policy.NEVER": "每次由本人确认",
  "policy.SAFE": "仅匹配本机规则",
  "policy.TRUSTED": "始终自动执行（高风险）",
  "error.requestFailed": "Squad 请求失败",
  "error.actionFailed": "操作失败",
  "error.humanInputRequired": "请填写回复或至少添加一个附件引用。",
  "error.attachmentTooMany": "一次最多提交 10 个附件引用。",
  "error.attachmentIncomplete": "请补全附件 {row} 的全部字段。",
  "error.attachmentUrl": "附件 {row} 的下载地址无效。",
  "error.attachmentHttps": "附件 {row} 必须使用 HTTPS 下载地址。",
  "error.attachmentSha256": "附件 {row} 的 SHA-256 必须是 64 位十六进制值。",
  "error.attachmentSize":
    "附件 {row} 的大小必须是 0 至 25 MiB 的整数（字节）。",
  "error.attachmentName": "附件 {row} 的文件名不能超过 240 个字符。",
  "error.pairingFailed": "配对失败",
  "error.pairingExportFailed": "无法生成配对包",
  "error.copyFailed": "无法复制配对包",
  "error.peerUpdateFailed": "无法更新对等方连接",
  "error.peerRemoveFailed": "无法移除对等方",
  "error.joinPackageFailed": "无法使用团队加入包",
  "error.loadFailed": "无法加载 Squad 状态",
  "error.planActionFailed": "分派计划操作失败",
  "error.planSaveFailed": "无法保存分派草案",
  "error.planAttachment": "计划项 {item} 的附件无效：{detail}",
  "error.organizationActionFailed": "组织操作失败",
  "error.policyUpdateFailed": "无法更新自动执行策略",
  "error.automationRuleFailed": "无法保存本机自动执行规则",
  "error.sessionOrganizationFailed": "无法切换会话组织",
  "error.updateActionFailed": "更新操作失败",
  "error.connectionCheckFailed": "连接检查失败",
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
  "errorCode.ORGANIZATION_INVITATION_REVOKED": "组织邀请已被撤销",
  "errorCode.ORGANIZATION_INVITATION_ALREADY_USED": "组织邀请已经使用",
  "errorCode.ORGANIZATION_INVITATION_EXPIRED": "组织邀请已过期",
  "errorCode.ORGANIZATION_INVITATION_NOT_FOUND": "找不到组织邀请",
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
  "inbox.title": "Squad",
  "inbox.close": "Close Squad",
  "inbox.attentionLabel": "Squad, {count} items need attention",
  "nav.label": "Squad navigation",
  "nav.work": "Work",
  "nav.team": "Team",
  "nav.system": "System",
  "tab.overview": "Overview",
  "tab.plans": "Plans",
  "tab.waiting": "Waiting for me",
  "tab.running": "Running",
  "tab.sent": "Sent",
  "tab.completed": "Completed",
  "tab.organizations": "Organizations",
  "tab.diagnostics": "Connection",
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
  "field.response": "Response for this todo",
  "field.attachmentRefs": "Attachment references",
  "field.attachmentUrl": "HTTPS download URL",
  "field.attachmentName": "File name",
  "field.attachmentSha256": "SHA-256",
  "field.attachmentSize": "Size in bytes",
  "field.outputs": "Outputs",
  "field.sourceSummary": "Source summary",
  "field.planItems": "Plan items",
  "field.delegationId": "Delegation ID",
  "field.updatedAt": "Last updated",
  "action.completeSelected": "Complete selected",
  "action.submitTodo": "Submit this item and continue",
  "action.addAttachment": "Add attachment reference",
  "action.removeAttachment": "Remove this attachment",
  "action.createRule": "Create rule",
  "action.editRule": "Edit",
  "action.enableRule": "Enable",
  "action.disableRule": "Disable",
  "action.deleteRule": "Delete rule",
  "action.reject": "Reject",
  "action.acceptAndRun": "Accept and run",
  "action.retryDelivery": "Retry delivery",
  "action.requestCancel": "Request cancel",
  "action.openSession": "Open native DSH session",
  "action.savePeer": "Save peer",
  "action.saveChanges": "Save changes",
  "action.saving": "Saving…",
  "action.enablePeer": "Enable",
  "action.disablePeer": "Disable",
  "action.removePeer": "Remove pairing",
  "action.copy": "Copy pairing bundle",
  "action.copied": "Copied",
  "action.approvePlan": "Approve and dispatch",
  "action.retryPlan": "Retry unsent items",
  "action.cancelPlan": "Cancel remaining items",
  "action.editPlan": "Edit draft",
  "action.savePlan": "Save draft",
  "action.addPlanItem": "Add plan item",
  "action.removePlanItem": "Remove item",
  "action.moveUp": "Move up",
  "action.moveDown": "Move down",
  "action.movePlanItemUp": "Move plan item up",
  "action.movePlanItemDown": "Move plan item down",
  "action.viewDelegation": "View full task",
  "action.createOrganization": "Create organization",
  "action.joinOrganization": "Request to join",
  "action.createInvitation": "Create one-time invitation",
  "action.revokeInvitation": "Revoke invitation",
  "action.createJoinPackage": "Create join package for a new Node",
  "action.approveJoin": "Approve join",
  "action.rejectJoin": "Reject join",
  "action.enableMember": "Enable member",
  "action.disableMember": "Disable member",
  "action.copyPrompt": "Copy example",
  "action.retry": "Retry",
  "action.cancel": "Go back",
  "confirm.rejectTitle": "Reject this task?",
  "confirm.rejectDelegation":
    "The sender receives an explicit rejected status. Task: “{objective}”",
  "confirm.cancelDelegationTitle": "Request cancellation?",
  "confirm.cancelDelegation":
    "If the peer has started running, Squad can only ask it to stop. External side effects are not rolled back. Task: “{objective}”",
  "confirm.acceptTaskTitle": "Accept and run this task?",
  "confirm.acceptTask":
    "The local Agent may invoke tools and cause external side effects. Task: “{objective}”",
  "confirm.resumeTaskTitle": "Submit and resume execution?",
  "confirm.resumeTodo":
    "This completes “{todo}” and lets the local Agent resume: “{objective}”",
  "confirm.switchModeTitle": "Switch the team connection mode?",
  "confirm.switchMode":
    "This Node switches to “{mode}” immediately. Its identity, organizations, and tasks are retained, but work the new connection cannot deliver remains queued locally.",
  "confirm.switchModeAction": "Confirm switch",
  "confirm.automationRuleTitle": "Enable this local automation rule?",
  "confirm.automationRule":
    "Rule “{name}” lets tasks matching “{pattern}” skip human confirmation with at most {count} explicitly allowed tools. It only affects senders set to “Match local rules”.",
  "confirm.enableAutomationRuleAction": "Enable this rule",
  "confirm.deleteAutomationRuleTitle": "Delete this automation rule?",
  "confirm.deleteAutomationRule":
    "After deleting “{name}”, tasks that matched only this rule wait for your confirmation.",
  "confirm.dispatchPlanTitle": "Dispatch this plan?",
  "confirm.dispatchPlan":
    "This creates and sends {count} independent tasks from “{title}”. After sending, each task can only be canceled separately.",
  "confirm.cancelPlanTitle": "Cancel remaining plan items?",
  "confirm.cancelPlan":
    "Unsent items in “{title}” will be canceled. Tasks already sent are not recalled automatically.",
  "confirm.approveJoinTitle": "Approve this member?",
  "confirm.approveJoin":
    "“{name}” will join “{organization}” and can see its member directory and receive organization tasks.",
  "confirm.rejectJoinTitle": "Reject this join request?",
  "confirm.rejectJoin":
    "“{name}”'s request for “{organization}” will be closed. They need a new invitation to request access again.",
  "confirm.revokeInvitationTitle": "Revoke this invitation?",
  "confirm.revokeInvitation":
    "Any unused invitation becomes invalid immediately. Join requests already submitted are unaffected.",
  "confirm.changeRoleTitle": "Change organization role?",
  "confirm.changeRole":
    "Change “{name}” in “{organization}” to “{role}”. Admins can invite, approve, and manage regular members.",
  "confirm.changeRoleAction": "Confirm role change",
  "confirm.enableMemberTitle": "Enable this member again?",
  "confirm.enableMember":
    "“{name}” regains member access and task routing in “{organization}”.",
  "confirm.disableMemberTitle": "Disable this member?",
  "confirm.disableMember":
    "“{name}” can no longer send or receive tasks through “{organization}”. History is retained.",
  "confirm.trustedPolicyTitle": "Allow execution without confirmation?",
  "confirm.trustedPolicy":
    "Tasks from “{name}” will skip human approval and run on this computer. The peer may trigger tools and local side effects.",
  "confirm.trustedNewPeer":
    "Tasks from this new peer will skip human approval and run on this computer. Enable this only after verifying and fully trusting its identity.",
  "confirm.enableTrustedAction": "Enable trusted execution",
  "confirm.removePeerTitle": "Remove pinned pairing?",
  "confirm.disablePeerTitle": "Disable this peer?",
  "confirm.disablePeer":
    "After disabling “{name}”, new tasks from that peer are rejected and queued deliveries may fail.",
  "confirm.automaticUpdatesTitle": "Enable automatic updates?",
  "confirm.enableAutomaticUpdatesAction": "Enable automatic updates",
  "confirm.installUpdateTitle": "Install the Squad update?",
  "loading.title": "Loading Squad state…",
  "humanTodo.oneAtATime":
    "Respond to each todo separately. Submitting one never completes the others by default.",
  "humanTodo.responsePlaceholder":
    "Enter a decision, additional context, or the result of an action…",
  "humanTodo.attachments": "Attachment references (optional)",
  "humanTodo.attachmentHint":
    "Squad passes verifiable HTTPS references; it does not upload local files. Up to 10 files, 25 MiB each.",
  "humanTodo.noAttachments": "No attachment references.",
  "humanTodo.attachmentNumber": "Attachment {number}",
  "plan.approvalHint":
    "Approval creates one existing signed delegation per item; each recipient still decides execution through their own Peer policy.",
  "plan.title": "Plan title",
  "plan.objective": "Task objective",
  "plan.editTitle": "Edit delegation draft",
  "plan.editHint":
    "Saving only changes this local draft and sends nothing. After approval, items are locked and become separate delegations.",
  "plan.changedWhileEditing":
    "This draft changed elsewhere. Go back and reopen the editor to avoid overwriting the newer version.",
  "plan.itemNumber": "Plan item {number}",
  "plan.criteriaHint": "One acceptance criterion per line, up to 20",
  "plan.unavailableRecipient": "{name} (currently unavailable)",
  "plan.noRecipients":
    "No member in this scope currently accepts delegations. Existing items can remain, but you cannot add an item or save one to an unavailable member.",
  "plan.itemCount": "{count} plan items",
  "plan.dispatchedCount": "Created {sent}/{total} delegations",
  "plan.progressLabel": "Plan execution progress",
  "plan.settledCount": "{settled}/{total} items have finished",
  "plan.completed": "Completed",
  "plan.active": "Active",
  "plan.waitingHuman": "Waiting for human",
  "plan.failed": "Failed",
  "plan.pendingDispatch": "Not sent",
  "setup.firstRun": "First-time setup",
  "setup.title": "Connect this Node to a team",
  "setup.intro":
    "Choose a recognizable name and either Relay or Direct. After validation, the settings stay on this computer—no YAML editing required.",
  "setup.chooseMode": "Choose the primary connection",
  "setup.relayTitle": "Join a Relay (recommended)",
  "setup.relayDescription":
    "Best for distributed and offline teams; selected peers may still use Direct alongside it.",
  "setup.directTitle": "Direct only",
  "setup.directDescription":
    "Best for a LAN, VPN, or small team with reachable HTTPS endpoints; no Relay is required.",
  "setup.relayUrl": "Relay URL",
  "setup.relayUrlHint":
    "Production requires HTTPS; loopback HTTP is accepted for local development.",
  "setup.invitation": "One-time Node invitation (optional)",
  "setup.invitationHint":
    "Enter it when enrolling this Node for the first time; an already enrolled Node may leave it blank. It is used only for validation and is not stored in the Node database.",
  "setup.directReceive": "Allow paired Nodes to deliver directly to me",
  "setup.optionalDirectReceive":
    "Also allow paired Nodes to deliver to me over Direct",
  "setup.optionalDirectHint":
    "This is an optional delivery path alongside Relay; it does not change organization identity or membership.",
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
  "settings.noPeers":
    "No pinned peers yet. Exchange signed pairing bundles to connect.",
  "settings.peerDisabled": "Disabled",
  "settings.editPeer": "Edit connection",
  "settings.removeConfirmation":
    "Remove “{name}”? Existing task history is retained, and importing a new pairing bundle restores the peer later.",
  "settings.pairPeer": "Pair a pinned peer",
  "settings.displayName": "Display name",
  "settings.nodeId": "Node ID",
  "settings.publicKey": "Ed25519 public key",
  "settings.transport": "Task transport",
  "settings.directUrl": "Peer Direct URL",
  "settings.directUrlHint":
    "Required for Direct mode. Production endpoints require HTTPS; loopback HTTP is only for local development.",
  "settings.autoExecute": "Automatic execution",
  "settings.manualPairing": "Advanced: enter identity manually",
  "settings.manualPairingHint":
    "Use this only for compatibility or troubleshooting. Normal pairing verifies a signed bundle.",
  "pairing.title": "Exchange pairing bundles",
  "pairing.intro":
    "A bundle pins the peer's public identity and reachable addresses. It contains no private key, password, or organization invitation.",
  "pairing.shareTitle": "Let someone add me",
  "pairing.shareHint":
    "Create a signed bundle valid for 7 days, then send it through a channel you trust.",
  "pairing.create": "Create my pairing bundle",
  "pairing.creating": "Creating…",
  "pairing.unreachable":
    "This Node has neither a Relay nor a reachable Direct address. Configure a receiving connection first.",
  "pairing.bundle": "Squad pairing bundle",
  "pairing.expires": "Expires {time}",
  "pairing.importTitle": "Add the other person",
  "pairing.bundlePlaceholder": "Paste squad-peer-v1.…",
  "pairing.transport": "Preferred connection",
  "pairing.transportAuto": "Choose automatically (prefer Direct)",
  "pairing.import": "Verify and add",
  "pairing.importing": "Verifying…",
  "transport.RELAY": "Relay",
  "transport.DIRECT": "Direct peer-to-peer",
  "settings.trustedWarning":
    "Always auto-run skips objective matching and human confirmation with the full local preset. Enable it only for members you fully trust.",
  "settings.languageHint":
    "The DSH global language setting controls this interface; first use follows the system language.",
  "automation.title": "Local automation rules",
  "automation.intro":
    "Rules only decide when senders set to “Match local rules” may skip confirmation. The full objective must match, and the runtime enforces the tool allowlist and resource limits.",
  "automation.name": "Rule name",
  "automation.objectivePattern": "Objective glob pattern",
  "automation.patternPlaceholder": "For example: summarize release notes for *",
  "automation.patternHint":
    "Case-insensitive and matched against the full objective. * matches any number of characters and ? matches one. User regular expressions are never executed.",
  "automation.allowedTools": "Allowed DSH tools",
  "automation.toolsPlaceholder":
    "One exact tool name per line; leave blank to allow no tools",
  "automation.toolsHint":
    "List executable tool names only. run_code and Squad's outcome tool are runtime-managed. An unavailable tool pauses the task for confirmation.",
  "automation.preset": "Agent preset (optional)",
  "automation.defaultPreset": "Leave blank for Squad's default preset",
  "automation.runtime": "Maximum runtime in minutes",
  "automation.maxTokens": "Maximum tokens (optional)",
  "automation.priority": "Priority (lower values match first)",
  "automation.allowAttachments": "Allow tasks with attachments to match",
  "automation.enabled": "Enable immediately after creation",
  "automation.create": "Create an automation rule",
  "automation.sourceFile": "Configuration-file rule (read only)",
  "automation.sourceInterface": "Interface rule",
  "automation.disabled": "disabled",
  "automation.noTools": "no tools allowed",
  "automation.attachmentsAllowed": "attachments allowed",
  "automation.attachmentsDenied": "attachments denied",
  "automation.ruleSummary":
    "Tools: {tools} · up to {runtime} minutes · {attachments}",
  "automation.noEnabledRules":
    "At least one member uses “Match local rules”, but no rules are enabled. Their tasks will all wait for your confirmation.",
  "automation.legacyIgnored":
    "Found {count} legacy safeObjectivePrefixes entries. Prefix matching cannot constrain tools, so it no longer grants automatic execution. Create explicit rules here.",
  "diagnostics.title": "Connection diagnostics",
  "diagnostics.intro":
    "Check actual endpoints, the event channel, and the local delivery queue; configured does not necessarily mean reachable.",
  "diagnostics.checkNow": "Check connections now",
  "diagnostics.checking": "Checking…",
  "diagnostics.lastChecked": "Checked at {time}",
  "diagnostics.notChecked": "No active check yet",
  "diagnostics.relay": "Relay",
  "diagnostics.direct": "Direct receiving",
  "diagnostics.queue": "Delivery queue",
  "diagnostics.eventStream": "Live event channel",
  "diagnostics.event.CONNECTED": "Connected",
  "diagnostics.event.POLLING": "Polling fallback",
  "diagnostics.event.DISABLED": "Disabled",
  "diagnostics.lastSuccess": "Last success: {time}",
  "diagnostics.lastReceived": "Last Direct receipt: {time}",
  "diagnostics.remoteVersion": "Remote Squad v{version}",
  "diagnostics.protocols": "Protocols: {versions}",
  "diagnostics.pending": "{count} envelopes pending delivery",
  "diagnostics.retrying": "{count} of them are retrying",
  "diagnostics.nextAttempt": "Next attempt: {time}",
  "diagnostics.selfCheckHint":
    "The Direct check proves this machine can reach its public URL and that it resolves to this Node. It does not replace an inbound test from an external network.",
  "diagnostics.lastError": "Last error: {error}",
  "connectionStatus.NOT_CONFIGURED": "Not configured",
  "connectionStatus.CHECKING": "Checking",
  "connectionStatus.CONNECTED": "Connected",
  "connectionStatus.SERVING": "Serving",
  "connectionStatus.READY": "Reachable and identity matched",
  "connectionStatus.UNVERIFIED": "Not verified",
  "connectionStatus.UNREACHABLE": "Unreachable",
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
  "context.relayRequired":
    "No Relay is connected, so saved organizations are temporarily unavailable.",
  "organizations.title": "Organizations",
  "organizations.create": "Create an organization",
  "organizations.join": "Request access with an invitation",
  "organizations.name": "Organization name",
  "organizations.invitation": "Organization invitation or join package",
  "organizations.joinHint":
    "A join package configures Relay for a new Node. A Node already enrolled with the same Relay can use a plain organization invitation.",
  "organizations.joinPackage": "Team join package",
  "organizations.joinPackagePlaceholder": "Paste squad-join-v1.…",
  "organizations.invitationExpiry": "Invitation lifetime (minutes)",
  "organizations.invitationResult":
    "One-time organization invitation (send through a secure channel)",
  "organizations.joinPackageResult":
    "One-time team join package (contains Relay enrollment and organization invitations; send through a secure channel)",
  "organizations.invitationExpires": "Expires at {time}",
  "organizations.invitationHistory": "Invitation history",
  "organizations.invitationHistoryHint":
    "For security, invitation tokens are never shown again after creation. This view contains status and audit metadata only.",
  "organizations.invitationCreated": "Created at {time}",
  "organizations.invitationCreator": "Created by {name}",
  "organizations.noInvitations": "No invitations have been created.",
  "organizations.loadingInvitations": "Loading invitation history…",
  "invitationStatus.ACTIVE": "Active",
  "invitationStatus.USED": "Used",
  "invitationStatus.EXPIRED": "Expired",
  "invitationStatus.REVOKED": "Revoked",
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
  "organizations.relayRequired": "Organizations require a Relay connection",
  "organizations.relayRequiredHint":
    "Direct peers remain available. Configure a Relay in Settings before creating, joining, or synchronizing organizations.",
  "organizations.retainedHint":
    "Switching connections does not delete saved organizations, identity, or task history.",
  "joinPackage.haveOne": "Already have a team join package?",
  "joinPackage.onboardingHint":
    "Paste the package from an administrator. Squad enrolls this Node with Relay and submits the organization join request in one step.",
  "joinPackage.join": "Verify and join team",
  "joinPackage.joining": "Verifying and joining…",
  "joinPackage.or": "or configure manually",
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
  "policy.NEVER": "Always ask me",
  "policy.SAFE": "Match local rules only",
  "policy.TRUSTED": "Always auto-run (high risk)",
  "error.requestFailed": "Squad request failed",
  "error.actionFailed": "Action failed",
  "error.humanInputRequired":
    "Enter a response or add at least one attachment reference.",
  "error.attachmentTooMany":
    "You can submit up to 10 attachment references at once.",
  "error.attachmentIncomplete": "Complete every field in attachment {row}.",
  "error.attachmentUrl": "Attachment {row} has an invalid download URL.",
  "error.attachmentHttps": "Attachment {row} must use an HTTPS download URL.",
  "error.attachmentSha256":
    "Attachment {row} needs a 64-character hexadecimal SHA-256 value.",
  "error.attachmentSize":
    "Attachment {row} size must be an integer from 0 through 25 MiB, in bytes.",
  "error.attachmentName":
    "Attachment {row} file name cannot exceed 240 characters.",
  "error.pairingFailed": "Pairing failed",
  "error.pairingExportFailed": "Could not create pairing bundle",
  "error.copyFailed": "Could not copy the pairing bundle",
  "error.peerUpdateFailed": "Could not update the peer connection",
  "error.peerRemoveFailed": "Could not remove the peer",
  "error.joinPackageFailed": "Could not use the team join package",
  "error.loadFailed": "Could not load Squad state",
  "error.planActionFailed": "Delegation plan action failed",
  "error.planSaveFailed": "Could not save the delegation draft",
  "error.planAttachment":
    "Plan item {item} has an invalid attachment: {detail}",
  "error.organizationActionFailed": "Organization action failed",
  "error.policyUpdateFailed": "Could not update automatic execution policy",
  "error.automationRuleFailed": "Could not save the local automation rule",
  "error.sessionOrganizationFailed": "Could not change session organization",
  "error.updateActionFailed": "Update action failed",
  "error.connectionCheckFailed": "Connection check failed",
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
  "errorCode.ORGANIZATION_INVITATION_REVOKED":
    "The organization invitation has been revoked",
  "errorCode.ORGANIZATION_INVITATION_ALREADY_USED":
    "The organization invitation has already been used",
  "errorCode.ORGANIZATION_INVITATION_EXPIRED":
    "The organization invitation has expired",
  "errorCode.ORGANIZATION_INVITATION_NOT_FOUND":
    "The organization invitation was not found",
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

const organizationInvitationStatusKeys = {
  ACTIVE: "invitationStatus.ACTIVE",
  USED: "invitationStatus.USED",
  EXPIRED: "invitationStatus.EXPIRED",
  REVOKED: "invitationStatus.REVOKED",
} as const satisfies Record<OrganizationInvitationStatus, SquadLocaleKey>;

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

const connectionStatusKeys = {
  NOT_CONFIGURED: "connectionStatus.NOT_CONFIGURED",
  CHECKING: "connectionStatus.CHECKING",
  CONNECTED: "connectionStatus.CONNECTED",
  SERVING: "connectionStatus.SERVING",
  READY: "connectionStatus.READY",
  UNVERIFIED: "connectionStatus.UNVERIFIED",
  UNREACHABLE: "connectionStatus.UNREACHABLE",
} as const satisfies Record<ConnectionStatus, SquadLocaleKey>;

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
  ORGANIZATION_INVITATION_REVOKED: "errorCode.ORGANIZATION_INVITATION_REVOKED",
  ORGANIZATION_INVITATION_ALREADY_USED:
    "errorCode.ORGANIZATION_INVITATION_ALREADY_USED",
  ORGANIZATION_INVITATION_EXPIRED: "errorCode.ORGANIZATION_INVITATION_EXPIRED",
  ORGANIZATION_INVITATION_NOT_FOUND:
    "errorCode.ORGANIZATION_INVITATION_NOT_FOUND",
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

export function formatOrganizationInvitationStatus(
  t: SquadTranslate,
  status: OrganizationInvitationStatus,
): string {
  return t(organizationInvitationStatusKeys[status]);
}

export function formatConnectionStatus(
  t: SquadTranslate,
  status: ConnectionStatus,
): string {
  return t(connectionStatusKeys[status]);
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
