# DSH Squad

[简体中文](README.md) | [English](README.en.md)

> 让个人 Agent 组成团队，而不交出工作区、凭据与控制权。

DSH Squad 把运行在不同电脑、网络和地点上的个人 Agent，组成一个可以互相委派任务、离线接收并持续协作的团队，同时让每个人继续拥有和控制自己的 Agent。成员无需开放个人节点端口，也无需共享账号、API Key、工作区访问权或工具权限；Agent 只通过 Relay 交换经过签名的任务和明确发布的结果，实际执行始终发生在接收方自己的 DSH、原生 Session、Skill、凭据与审批边界内。

## 核心亮点

- **本地协调，权力仍属于个人**：Team Coordinator 可以把会议或团队目标整理成多人分派草案，但它不是持有全员权限的共享超级 Agent；负责人确认后才会发送，每位接收方仍由自己的策略和审批边界决定是否执行。
- **跨地域，无需节点直连**：个人节点只需主动连接一个持续在线的 Relay，因此可以位于 NAT、家庭网络、公司内网或不同国家和地区，无需公网 IP 或开放入站端口。
- **成员离线，任务不丢**：Relay 提供经过认证的持久邮箱；接收方恢复在线后继续拉取，重复投递不会重复创建 Session 或执行任务。
- **信任可以逐人配置**：每个 Peer 都有独立的公钥固定、启停状态、委派权限、并发限制和 `NEVER`、`SAFE`、`TRUSTED` 自动执行策略。
- **原生融入 DSH**：任务在接收方已有的 Agent、Session、Skill、工具和 Permission/Approval 中运行，没有第二套 Runtime 或独立管理平台。

## 工作方式

```text
Alice Agent --签名 Delegation--> Relay 持久邮箱 --> Bob 的 DSH
                                                       |
                                      Bob Personal Agent + 本地 Skill
                                                       |
                         自动完成 --> 显式 Outcome -----+
                         需要本人 --> HumanTodo --> 恢复同一 Session
```

- 发送方只提交目标、上下文、完成条件和经过校验的 HTTPS 附件引用。
- 接收方的 PeerPolicy 决定拒绝、等待本人接受或自动执行。
- 接收方 Agent 自己选择本地 Skill 和工具；协议没有远程 Skill、Shell、MCP 或 Credential 字段。
- Relay 只提供受认证的 at-least-once 邮箱。Receiver 使用本地 SQLite、Envelope ID 和 Delegation ID 保证重复投递不重复执行。
- HumanTodo、原生 Session ID、人工回复、凭据和工作区始终只保存在接收方。
- 发送方只能看到接收方明确发布的状态、摘要和 Outcome。

同一真人、同一 DSH 内的并行拆解继续使用 DSH 原生 Sub-agent；跨到另一个真人拥有的 Personal Agent 时才使用 Squad。

## Team Coordinator：先审阅，再分派

本地 Agent 可以读取当前已配对成员，依据会议纪要或团队目标生成一份持久化分派草案。生成草案不会产生任何网络请求或远程执行；负责人需要在`智能体收件箱 → 分派计划`中逐项检查接收人、目标、上下文、验收条件和附件，再点击`确认并分派`。

一个典型提示词是：

> 先使用 `list_squad_peers` 查看可用成员，再把下面的会议结论拆成一份团队分派计划。只创建草案，不要直接委派：……

Agent 会调用 `propose_team_plan`。负责人确认后，Squad 才为每个计划项创建现有协议中的签名 Delegation。每个计划项预先固定唯一 Delegation ID，因此审批响应丢失、进程重启或部分失败后的重试都不会重复派单。发送方的本地确认不是接收方授权：接收方仍可拒绝、要求本人接受，或按自己的 `SAFE` / `TRUSTED` 策略执行。

同一套本地 Plan API 可供后续飞书等 Connector 写入草案或读取状态投影；当前 Unreleased 版本尚不包含飞书 Connector，也不会因外部看板编辑而自动执行任务。

## 典型部署：异地组成团队

```text
北京：Alice 的电脑 ──出站 HTTPS──┐
                                 │
上海：Bob 的电脑   ──出站 HTTPS──┼── 公网或企业内网 Relay
                                 │
海外：Carol 的电脑 ─出站 HTTPS──┘
```

这是一种应用层 Agent 协作网络，而不是 VPN：它不会把成员电脑接入同一个虚拟局域网，也不要求节点之间能够通过 IP 互访。个人节点的 WebUI 应只监听 `127.0.0.1`；对外只部署 Relay，并通过 HTTPS、精确路由放行和防火墙保护公共入口。

## 安装

固定运行基线：Node.js `24.18.0`、pnpm `10.28.2`、DeepSeek Harness `0.1.0-rc.6`、Cordis `4.0.1`。

当前仓库只发布 `@dsh-squad/plugin`，不包含独立 SPA、第二套 Runtime CLI 或 Docker 编排；Docker 是可选的部署隔离手段，不是运行要求。

从本仓库构建并安装 tarball：

```bash
pnpm install --frozen-lockfile
pnpm run pack
dsh plugin --profile web add ./artifacts/dsh-squad-plugin-0.2.0.tgz --offline
dsh web
```

安装通过插件内的 `cordis.patch.yml` 同时挂载 Host Plugin 和 Web Client Module。启动后，原生 DSH 侧边栏出现 `智能体收件箱`（英文界面为 `Agent Inbox`）；其中的设置页可查看本 Node 的 Ed25519 身份并配置 Peer、公钥固定和本地策略。

## 配置 Node

在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中覆盖 `dsh-squad` 配置。生产 Relay URL 必须使用 HTTPS；仅本机开发允许 loopback HTTP。

```yaml
- id: dsh-squad
  config:
    displayName: Alice Personal Agent
    pollIntervalMs: 5000
    envelopeTtlMinutes: 60
    execution:
      cwd: /absolute/path/to/alice-workspace
      # SAFE 只自动运行以前缀开头的目标；不确定时等待本人接受。
      safeObjectivePrefixes:
        - summarize
        - analyze
    relay:
      url: https://relay.example.com
      invitation: replace-with-one-time-invitation
```

Peer 可以在 `智能体收件箱 → 设置`（`Agent Inbox → Settings`）中添加，也可以在配置中声明。`nodeId` 必须与 Ed25519 公钥指纹匹配。

```yaml
- id: dsh-squad
  config:
    peers:
      - nodeId: node_REPLACE_WITH_43_CHARACTER_FINGERPRINT
        displayName: Bob Personal Agent
        publicKey: |-
          -----BEGIN PUBLIC KEY-----
          REPLACE_ME
          -----END PUBLIC KEY-----
        policy:
          canMessage: true
          canDelegate: true
          autoExecute: NEVER
          maxConcurrent: 1
          maxDelegationDepth: 1
          maxRuntimeMinutes: 30
```

## 承载 Relay

同一个包可以在任意持续在线的 DSH Node 中启用 Relay Server。邀请在配置加载时写入 Relay SQLite，并在新 Node enrollment 时一次性消费。

```yaml
- id: dsh-squad
  config:
    displayName: Team Relay
    relay:
      enabled: true
      databasePath: /absolute/path/to/relay.sqlite
      maxMailboxItems: 10000
      maxRequestsPerMinute: 300
      invites:
        - token: replace-with-at-least-16-random-characters
          expiresAt: 2030-01-01T00:00:00.000Z
```

Relay API 注册在宿主 WebServer 的 `/squad/v1` 下；它验证 enrollment、请求签名、nonce、时效、收发双方、邮箱容量和速率限制，但不运行 Agent，也不持有私人 Session 或 HumanTodo。

## Agent 与 WebUI

插件向 Personal Agent 注册四个原生工具：

- `delegate_to_agent`：按 Peer 名称或稳定 `nodeId` 创建委派；
- `get_delegation_status`：读取本 Node 可见的公开状态投影；
- `list_squad_peers`：列出本地已配对成员及其当前委派可用状态；
- `propose_team_plan`：创建等待负责人审阅的本地分派草案，绝不直接发送。

不需要在聊天中输入这些工具的完整名称。Squad 支持两种按需触发方式，且不会为这些快捷触发另增按钮或常驻入口：

- **自然语言或成员提及**：例如“把发布说明交给 Bob”“`@Bob` 整理本周变更”“根据这段会议纪要给团队分工”“查一下刚才那项委派的进度”。成员或目标有歧义时，Agent 会先要求澄清。
- **统一前缀的英文 Slash 命令**：`/squad-task <@member and objective>`、`/squad-plan <team goal or meeting notes>`、`/squad-peers`、`/squad-status [delegation ID or question]`。输入 `/` 时由 DSH 原生命令菜单按需发现，所有名称都使用 `squad-` 前缀以避免和其他插件冲突。

`智能体收件箱` 提供`分派计划`、`待我处理`、`运行中`、`已发送`、`已完成`和`设置`；英文界面对应 `Plans`、`Waiting for me`、`Running`、`Sent`、`Completed` 和 `Settings`。负责人可以审阅、确认、重试或取消计划的剩余项；接收方可以选择一个或多个 Todo，提交文本或经 SHA-256/大小验证的附件引用，重启后继续处理，并打开对应的原生 DSH Session。

## 语言

当前版本完整支持简体中文和英文，并接入 DSH 官方全局语言服务：

- 全新配置没有显式语言偏好时，WebUI 根据浏览器报告的系统语言自动选择；`zh` 区域变体使用简体中文，`en` 区域变体使用英文，其他语言回退到简体中文。
- 可在 DSH `设置 → 通用 → 语言`（`Settings → General → Language`）中切换`中文`或 `English`；选择会写入 `$DSH_HOME/settings.yaml`，Squad 与 DSH 其他界面会立即同步更新。
- 状态、投递进度、执行策略、已知系统摘要、错误码说明、日期和无障碍标签都会本地化；用户输入、Agent 生成内容以及协议/签名字段保持原文和稳定标识。

这里的“系统语言”来自打开 WebUI 的浏览器，因此从 Windows 浏览器访问 WSL 中的 DSH 时，会跟随 Windows/浏览器语言，而不是 WSL 的 `LANG`。

## 安全边界

- Node 首次启动生成并本地保存 Ed25519 身份；数据库会绑定身份，密钥或 DB 被替换时失败关闭。
- Envelope 使用严格 Zod schema、canonical bytes 和 Ed25519 签名；相同 ID 不同 payload 视为冲突。
- Relay 邮箱请求使用短时签名、nonce 防重放和 recipient 隔离。
- 附件仅接受 HTTPS，拒绝私网/loopback/重绑定地址，并校验声明大小与 SHA-256。
- 远程 objective/context 始终作为不受信任任务数据进入接收方原生 Agent，不绕过 DSH Permission/Approval。
- 进程在执行期间中断时标记 `EXECUTION_INTERRUPTED`，不会猜测并自动重放未知外部副作用。

MVP 的 Relay 是受信任内容中转方，不提供端到端加密；生产部署仍必须使用 TLS。

## 禁用

在 profile patch 中禁用条目并重启 DSH：

```yaml
- id: dsh-squad
  disabled: true
```

Squad Host route、Agent tools 和 Client Slot 会一起移除，原生 Harness Shell、Session、Settings 和工作区仍可使用。

## 开发与验收

```bash
pnpm verify:pins
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm smoke:delegation
```

`smoke:delegation` 会构建真实 tarball，安装到 Alice、Bob、Relay 三套隔离 DSH Home，并用真实 Chromium 验证：WebUI 配对、Coordinator 草案审批与幂等分派、Bob 离线投递、Relay/Node 重启、接收端专属 Skill、HumanTodo 部分完成、相同 Session 恢复、Outcome 隐私边界和插件可逆禁用。

## 许可证

本项目使用 [MIT License](LICENSE)。版本变更见 [CHANGELOG.md](CHANGELOG.md)。
