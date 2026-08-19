# DSH Squad

[简体中文](README.md) | [English](README.en.md)

> 让个人 Agent 组成团队，而不交出工作区、凭据与控制权。

DSH Squad 把运行在不同电脑、网络和地点上的个人 Agent，组成一个可以互相委派任务并持续协作的团队，同时让每个人继续拥有和控制自己的 Agent。它既支持带持久邮箱和组织目录的中心化 **Relay 模式**，也支持无需 Relay 的 **Direct 点对点模式**。两种模式都只交换经过签名的任务和明确发布的结果；账号、API Key、工作区访问权、工具权限以及实际执行始终留在接收方自己的 DSH、原生 Session、Skill、凭据与审批边界内。

## 核心亮点

- **两种组队方式，按网络条件选择**：Relay 模式适合跨地域、成员经常离线或不方便开放入站端口的团队；Direct 模式适合局域网、VPN 或已有可达 HTTPS 地址的小团队，无需部署中心中继。
- **组织一次加入，不再两两配对**：在 Relay 模式中，节点通过一次性邀请和人工审批加入带签名的组织成员目录，无论团队规模如何，都不需要每两个人分别交换 Peer 配置；一个节点可以同时属于多个组织。
- **本地规划，权力仍属于个人**：Team Planner 可以把会议或团队目标整理成多人分派草案，但它不是持有全员权限的共享超级 Agent；负责人确认后才会发送，每位接收方仍由自己的策略和审批边界决定是否执行。
- **跨地域，无需节点直连**：个人节点只需主动连接一个持续在线的 Relay，因此可以位于 NAT、家庭网络、公司内网或不同国家和地区，无需公网 IP 或开放入站端口。
- **离线状态有明确语义**：Relay 模式由中继持久保存任务；Direct 模式由发送方本地 SQLite 保存并自动重试，界面会显示等待、重试时间、失败次数和最近错误。重复投递不会重复创建 Session 或执行任务。
- **投递状态可实时观察**：Relay 用认证事件流即时唤醒收件节点并保留轮询兜底；Direct 返回接收节点签名的持久化回执。发送方可以区分“本地排队”“等待对方可达”“中继已保存”和“对方节点已接收”。
- **Relay 可安全自维护**：独立更新器验证签名 Release，在节点空闲时备份、安装、重启并做版本健康检查；默认只通知，失败自动回滚。
- **信任可以逐人配置并真正限权**：每个直接 Peer 或组织成员都可选择“每次确认”“仅匹配本机规则”或“始终自动执行”。本机规则不仅匹配完整任务目标，还会强制限制工具、附件、preset、运行时长和 Token；没有匹配规则就等待本人确认。
- **首次配置无需编辑 YAML**：首次打开`智能体收件箱`即可通过简体中文或英文向导选择 Relay / Direct、验证连接并本地保存；以后在设置页直接修改。
- **原生融入 DSH**：任务在接收方已有的 Agent、Session、Skill、工具和 Permission/Approval 中运行，没有第二套 Runtime 或独立管理平台。

## 两种组队模式

| 能力     | Relay 模式                            | Direct 点对点模式                                  |
| -------- | ------------------------------------- | -------------------------------------------------- |
| 拓扑     | 所有节点主动连接一个持续在线的 Relay  | 每个 Peer 配置对方可达的 HTTPS 地址                |
| 成员管理 | 签名组织目录，支持 Owner/Admin/Member | 显式交换并固定 Node ID、公钥和地址                 |
| 对方离线 | Relay 独立持久保存，发送方可以下线    | 任务保存在发送方本地；双方再次同时在线且可达时重投 |
| 网络要求 | 个人节点无需公网 IP 或开放入站端口    | 至少任务方向必须可达；双向状态协作需要双方可达     |
| 典型场景 | 跨地域、较大团队、异步协作            | 局域网、VPN、已有组网、小型团队                    |

Relay 模式：

```text
Alice Agent --签名 Delegation--> Relay 持久邮箱 --> Bob 的 DSH
                                                       |
                                      Bob Personal Agent + 本地 Skill
                                                       |
                         自动完成 --> 显式 Outcome -----+
                         需要本人 --> HumanTodo --> 恢复同一 Session
```

Direct 模式：

```text
Alice Agent --签名 Delegation--> Bob 的 Direct HTTPS 入口
      |                                  |
      +-- 本地持久 Outbox <--离线重试 --+
      <--------- Bob 签名 Node Receipt --+
```

Direct 模式不提供 NAT 穿透、分布式代存或去中心化组织共识。Bob 离线时，Alice 会显示`等待对方可达`并按配置重试；如果 Alice 与 Bob 此后从未同时在线且网络可达，就无法完成投递。重试受 `envelopeTtlMinutes` 限制（默认 60 分钟）；到期后状态变为`投递已过期`，需要创建一项新委派。v0.6 的签名组织目录仍使用 Relay；Direct 团队使用显式配对的 Peer，Team Planner 可以照常为这些 Peer 创建分派草案。

- 发送方只提交目标、上下文、完成条件和经过校验的 HTTPS 附件引用。
- 接收方的 PeerPolicy 决定拒绝、等待本人接受或自动执行。
- 接收方 Agent 自己选择本地 Skill 和工具；协议没有远程 Skill、Shell、MCP 或 Credential 字段。
- Relay 只提供受认证的 at-least-once 邮箱；Direct 只提供经过固定公钥验证的点对点投递。Receiver 使用本地 SQLite、Envelope ID 和 Delegation ID 保证重复投递不重复执行。
- HumanTodo、原生 Session ID、人工回复、凭据和工作区始终只保存在接收方。
- 发送方只能看到接收方明确发布的状态、摘要和 Outcome。

同一真人、同一 DSH 内的并行拆解继续使用 DSH 原生 Sub-agent；跨到另一个真人拥有的 Personal Agent 时才使用 Squad。

## Team Planner：先审阅，再分派

本地 Agent 可以读取当前 Session 所选组织的活动成员；未选择组织时则使用兼容的直接 Peer。它依据会议纪要或团队目标生成一份持久化分派草案。生成草案不会产生任何网络请求或远程执行；负责人可以在`智能体收件箱 → 分派计划`中修改接收人、目标、上下文、验收条件和附件，增删或重排计划项，再点击`确认并分派`。保存草案仍然不会发送任务；派发开始后计划项即锁定。

一个典型提示词是：

> 先使用 `list_squad_peers` 查看可用成员，再把下面的会议结论拆成一份团队分派计划。只创建草案，不要直接委派：……

Agent 会调用 `propose_team_plan`。负责人确认后，Squad 才为每个计划项创建现有协议中的签名 Delegation。每个计划项预先固定唯一 Delegation ID，因此审批响应丢失、进程重启或部分失败后的重试都不会重复派单。发送方的本地确认不是接收方授权：接收方仍可拒绝、要求本人接受，或按自己的 `SAFE` / `TRUSTED` 策略执行。

分派后，原计划会实时汇总每一项的排队、运行、等待人工、完成、失败或取消状态，并回收接收方明确发布的结果摘要和输出；负责人可以从计划项直接打开完整委派记录。私有 Session、HumanTodo 详情和本机工作内容仍不会进入计划投影。

每条委派的详情会把状态展开为“已创建 → 投递 → 接收与执行 → 结果”四个阶段，并明确显示下一步由本机用户、本机 Agent、Relay、对方节点还是自动重试负责。这样，即使对方离线，也可以直接区分“只在本机排队”“Relay 已代存”“对方已接收”和“正在执行”，无需根据底层状态码猜测。

工作台顶部会显示本机实时事件通道是已连接、正在重连还是状态可能过期，并记录最近一次成功读取时间。选择“立即同步”会主动执行一轮组织目录、发件箱、收件箱和更新状态同步，而不只是重新绘制旧数据。

委派和分派计划列表分别按每页 25 项展示，并记住每个标签页的位置；从计划打开某条委派时会直接定位到包含它的页面。历史记录增多后，界面不会再一次渲染整份长列表。

已经结束的委派以及已完全分派或取消的计划可以移入统一的“归档”标签页。归档只改变本机工作台的整理状态：失败项不再占用关注计数，但任务、结果、计划项和审计记录都不会删除，也不会停止已派出的任务，并且可以随时恢复。

同一套本地 Plan API 可供后续飞书等 Connector 写入草案或读取状态投影；当前版本不包含飞书 Connector，也不会因外部看板编辑而自动执行任务。

## 组织、角色与 Session 隔离

创建组织的节点是唯一 `Owner`。Owner 可以指定零个或多个 `Admin`；其他参与者加入后都是 `Member`。Owner 和 Admin 可以创建一次性邀请并批准或拒绝加入申请，Admin 只能管理普通 Member，只有 Owner 能任命或撤销 Admin。被拒绝的申请会立即从双方待处理列表消失，申请者需要新邀请才能再次申请。Owner 可以向任一活动成员发起所有权转让；目标成员必须在自己的节点明确接受，Relay 才会把“旧 Owner 变为 Admin”和“目标成员变为唯一 Owner”作为一条原子目录事件提交。任一方都能在接受前取消或拒绝，目录发生其他变化时旧提案自动失效。

Owner 和 Admin 还能在 WebUI 查看最近 200 条邀请的有效、已使用、已过期或已撤销状态，并撤销尚未使用的邀请。邀请 token 只在创建时显示一次；状态列表只使用独立随机 ID 和审计时间，不返回 token 或 token 哈希。

Owner 可以直接在 WebUI 修改组织名称。改名不是覆盖已固定的组织根，而是追加一条绑定旧名称与新名称的 Owner 签名事件；每个节点通过验证和重放同一目录得到当前名称。若同时存在尚未接受的所有权转让提案，改名造成的新目录修订会让旧提案自动失效。

Owner 也可以从 WebUI 不可逆地解散组织。解散会追加一条 Owner 签名的终止事件，立即关闭未使用邀请、待审批加入请求和新的组织任务路由，并清除各节点同步后的 Session 组织上下文；组织根、完整成员目录和历史任务不会物理删除，仍可用于审计。解散后的目录不能再追加任何事件。

活动中的 Admin 或 Member 可以从 WebUI 主动退出组织。退出会追加一条由本人签名的禁用事件并清除本机所有指向该组织的 Session 上下文，既不会删除历史记录，也不会伪装成管理员操作。Owner 必须先安全转让所有权才能退出，防止产生无主组织。

组织根由独立 Authority 密钥签名，后续成员事件由当时有权限的 Owner/Admin 节点签名。Relay 和每个节点都会验证完整的追加式事件链、公钥身份、连续修订、签发者角色以及唯一活动 Owner；被禁用的成员不能继续发送组织委派。

一个节点可以加入多个组织，但每个 DSH Session 同一时刻只选择一个组织上下文。`智能体收件箱`顶部实时显示当前节点、Session 和组织，切换只影响该 Session。成员查找、Team Planner 和委派都限定在该签名目录内；选择`直接对等方`即可继续使用旧版的一对一 Peer 模式。

当前已经提供的是 **Team Planner**，它只是本地草案能力。未来若加入 **Organization Coordinator Agent**，它会是组织中的一个可选服务成员，而不是凌驾于成员之上的超级 Agent：只接收明确发布的会议材料和状态投影，只生成摘要、建议或待审草案，不继承成员工作区、凭据、私有 Session 或工具权限，也不默认代替任何人批准或执行任务。

## 典型 Relay 部署：异地组成团队

```text
北京：Alice 的电脑 ──出站 HTTPS──┐
                                 │
上海：Bob 的电脑   ──出站 HTTPS──┼── 公网或企业内网 Relay
                                 │
海外：Carol 的电脑 ─出站 HTTPS──┘
```

这是一种应用层 Agent 协作网络，而不是 VPN：它不会把成员电脑接入同一个虚拟局域网。Relay 模式不要求节点之间能够通过 IP 互访；个人节点的 WebUI 应只监听 `127.0.0.1`，对外只部署 Relay，并通过 HTTPS、精确路由放行和防火墙保护公共入口。Direct 模式则依赖局域网、VPN、端口映射或已有反向代理提供节点间可达性，Squad 本身不会建立底层网络隧道。

## 安装

固定运行基线：Node.js `24.18.0`、pnpm `10.28.2`、DeepSeek Harness `0.1.0-rc.6`、Cordis `4.0.1`。

当前仓库只发布 `@dsh-squad/plugin`，不包含独立 SPA、第二套 Runtime CLI 或 Docker 编排；Docker 是可选的部署隔离手段，不是运行要求。

从本仓库构建并安装 tarball：

```bash
pnpm install --frozen-lockfile
pnpm run pack
dsh plugin --profile web add ./artifacts/dsh-squad-plugin-0.7.0.tgz --offline
dsh web
```

安装通过插件内的 `cordis.patch.yml` 同时挂载 Host Plugin 和 Web Client Module。启动后，原生 DSH 侧边栏出现 `智能体收件箱`（英文界面为 `Agent Inbox`）；面板顶部实时显示本 Node 身份和当前 Session 组织，`组织`页管理成员目录，`设置`页保留直接 Peer 兼容配置。

## 首次引导与配置 Node

全新安装无需编辑配置文件。首次打开`智能体收件箱`时，向导会要求设置节点名称，并选择`加入 Relay`或`Direct 点对点`：

- Relay 模式填写 Relay URL；新节点再填写管理员发放的一次性节点邀请。插件会先完成登记和签名身份验证，成功后才保存 URL；邀请只存在于本次请求中，不写入节点 SQLite，也不出现在状态接口。
- Direct 模式可启用本节点的接收入口并填写公共 URL。向导只验证地址格式，不会代替用户创建 DNS、TLS、端口映射或反向代理。
- 选择`稍后配置`不会写入占位配置；下次打开仍会显示向导。完成后可在`智能体收件箱 → 设置 → 团队连接`重新验证和修改。

已经通过 YAML 配置、已有直接 Peer/组织数据或从旧版本升级的节点不会被强制重新引导。界面保存的节点名称、组队模式、Relay URL 和 Direct 接收设置会持久化在本机，并优先于这些字段的 YAML 值；其他运行策略仍从 YAML 读取。

无人值守部署和高级参数仍可在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中覆盖 `dsh-squad`。生产 Relay URL 必须使用 HTTPS；仅本机开发允许 loopback HTTP。

```yaml
- id: dsh-squad
  config:
    displayName: Alice Personal Agent
    pollIntervalMs: 5000
    envelopeTtlMinutes: 60
    execution:
      cwd: /absolute/path/to/alice-workspace
      # SAFE 的界面名称是“仅匹配本机规则”。规则完整匹配目标，
      # 并在 Agent 运行时强制工具白名单；allowedTools 留空即不允许工具。
      automationRules:
        - name: 纯文本会议摘要
          objectivePattern: "总结会议纪要：*"
          allowedTools: []
          allowAttachments: false
          maxRuntimeMinutes: 5
          maxTokens: 8000
          priority: 100
          enabled: true
    relay:
      url: https://relay.example.com
      invitation: replace-with-one-time-invitation
```

也可以在`智能体收件箱 → 设置 → 本机自动执行规则`中创建、修改、停用或删除规则。`safeObjectivePrefixes` 只比较字符串前缀却会放开整个 preset，无法形成真实权限边界，因此升级后只会显示迁移警告，不再授予自动执行；使用该旧字段的节点应改为 `automationRules` 或界面规则。协议和数据库仍保留 `SAFE` 这个枚举值以兼容现有 Peer 配置，但它现在严格表示“匹配本机规则”。

推荐在`智能体收件箱 → 组织`中通过一次性邀请加入 Relay 组织；这样无需为每一对成员分别配置。Direct Peer 可在`智能体收件箱 → 设置`中选择`Direct 点对点`后添加，也可以在配置中声明。双方都必须固定对方的 `nodeId`、Ed25519 公钥和可达地址；`nodeId` 必须与公钥指纹匹配。

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
        # 省略时默认为 RELAY；Direct 模式需要双方都配置对方。
        transport: DIRECT
        directUrl: https://bob-agent.example.com
        policy:
          canMessage: true
          canDelegate: true
          autoExecute: NEVER
          maxConcurrent: 1
          maxDelegationDepth: 1
          maxRuntimeMinutes: 30
```

接收 Direct 任务的节点还需要启用入口。`publicUrl` 是展示和配对用的规范地址，不会自动创建 DNS、TLS、端口映射或反向代理；实际请求仍由 DSH Host WebServer 承载。

```yaml
- id: dsh-squad
  config:
    direct:
      enabled: true
      publicUrl: https://alice-agent.example.com
      retryIntervalMs: 5000
```

生产 Direct URL 必须使用 HTTPS；只有 `localhost` / loopback 开发环境可以使用 HTTP。反向代理只需精确放行 `POST /squad/v1/direct/envelopes`，并应配置请求大小、连接数和速率限制，不要暴露 `/squad/v1/local/*` 或整个个人 WebUI。

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

Relay API 注册在宿主 WebServer 的 `/squad/v1` 下；它验证 enrollment、请求签名、nonce、时效、组织成员路由、收发双方、邮箱容量和速率限制，并保存签名组织目录与持久邮箱，但不运行 Agent，也不持有私人 Session、HumanTodo、工作区或成员凭据。认证事件流只发送“邮箱有变化”的唤醒通知，不发送任务正文；断流时节点继续使用轮询，因此事件流不是可靠性单点。若反向代理使用精确路由白名单，v0.6 需要额外放行 `GET /squad/v1/mailbox/events` 才能即时唤醒；未放行时功能仍可通过轮询工作。

## 持久在线 Relay 的安全更新

从 v0.5.0 起，Squad 包含更新中心和独立的 `dsh-squad-update` 更新器。它只更新 Squad 自身，不更新 DSH 核心或其他插件。插件进程不会覆盖自己：WebUI 负责检查、显示策略和提交明确的安装请求；systemd 启动的外部更新器负责停服、备份、安装、重启、健康检查和回滚。

每个节点有三种策略，可在`智能体收件箱 → 更新`中修改：

- `NOTIFY`：周期检查并提醒，安装需要本人确认；这是默认值；
- `AUTOMATIC`：节点空闲时自动备份并安装，随后重启；
- `DISABLED`：关闭周期检查和自动安装，仍允许本人手动检查。

首次必须手动安装 v0.5.0；它只能为后续版本提供自更新。先让 Relay 由一个已有的 systemd service 管理，并让插件和更新器共享同一个状态目录：

```yaml
- id: dsh-squad
  config:
    updates:
      repository: zhouCode/dsh-squad
      stateDir: /srv/dsh-squad/relay-home/squad-updates
      defaultMode: NOTIFY
```

然后用该 Relay profile 中随插件安装的命令创建 updater service、timer 和安装请求 path unit。`--data-path` 必须逐项列出需要事务性备份的 Node 数据和 Relay 数据；不要把 `/`、用户主目录或整个 `DSH_HOME` 当作备份目标。

```bash
DSH_HOME=/srv/dsh-squad/relay-home
"$DSH_HOME/profiles/web/node_modules/.bin/dsh-squad-update" install-systemd \
  --dsh-home "$DSH_HOME" \
  --profile web \
  --state-dir "$DSH_HOME/squad-updates" \
  --service-unit dsh-squad-relay.service \
  --base-url http://127.0.0.1:37100 \
  --data-path "$DSH_HOME/squad-node" \
  --data-path "$DSH_HOME/relay" \
  --scope user
```

v0.5 的安全更新器只接受 `--scope user`，Relay service 也必须位于同一专用账号的 user scope。管理员需执行 `loginctl enable-linger <relay-user>`，这样账号无需交互登录也会随服务器启动并持续运行。暂不支持 system scope，因为从用户可写的 DSH profile 以 root 身份执行更新代码会造成提权边界；容器化 Relay 应通过镜像和编排器更新。安装器默认每 6 小时检查一次，并用随机延迟避免多个节点同时请求 GitHub；WebUI 的“安装已验证更新”会创建一个由 path unit 立即处理的请求。

更新器只接受配置仓库的 GitHub `latest` Release，并要求以下四个资产同时存在：插件 `.tgz`、`.tgz.sha256`、签名更新清单和清单的 Ed25519 签名。内置公钥会验证清单；清单又固定 tag、版本、包名、文件名、大小、SHA-256 和最低 DSH 版本。安装前还会确认没有 `TRIAGING` / `RUNNING` 委派或正在分派的计划，停服后完整备份 profile 和显式数据路径，再用 `pnpm --offline` 安装本地已验证包。新服务必须通过 `/squad/v1/health` 并报告目标版本，否则恢复旧 profile 和数据；失败过的版本不会在无人确认时无限重试。默认保留最近三份备份。

## Agent 与 WebUI

插件向 Personal Agent 注册六个原生工具：

- `delegate_to_agent`：按当前组织成员或直接 Peer 的名称、`nodeId` / `membershipId` 创建委派；
- `get_delegation_status`：读取本 Node 可见的公开状态投影；
- `list_squad_peers`：列出当前 Session 组织成员；未选择组织时列出直接 Peer；
- `propose_team_plan`：使用 Team Planner 创建等待负责人审阅的本地分派草案，绝不直接发送；
- `list_squad_organizations`：列出本节点加入的组织、角色和状态；
- `select_squad_organization`：在用户明确要求时切换当前 Session 的组织或直接 Peer 上下文。

不需要在聊天中输入这些工具的完整名称。Squad 支持两种按需触发方式，且不会为这些快捷触发另增按钮或常驻入口：

- **自然语言或成员提及**：例如“把发布说明交给 Bob”“`@Bob` 整理本周变更”“根据这段会议纪要给团队分工”“查一下刚才那项委派的进度”。成员或目标有歧义时，Agent 会先要求澄清。
- **统一前缀的英文 Slash 命令**：任务入口为 `/squad-task`、`/squad-plan`、`/squad-peers`、`/squad-status`；组织入口为 `/squad-orgs`、`/squad-org <name|id|direct>`、`/squad-members`、`/squad-invite [minutes]`、`/squad-role <member> <admin|member>`。输入 `/` 时由 DSH 原生命令菜单按需发现，所有名称都使用 `squad-` 前缀以避免冲突。

`智能体收件箱` 提供`分派计划`、`待我处理`、`运行中`、`已发送`、`已完成`、`组织`、`更新`和`设置`。组织与更新状态通过 SSE 实时刷新；Owner/Admin 可审批、邀请和管理成员，每位用户可用下拉菜单调整本机对每个成员的 `autoExecute`。负责人也可以审阅、确认、重试或取消计划；接收方可以处理 Todo、重启后恢复并打开对应原生 Session。

## 语言

当前版本完整支持简体中文和英文，并接入 DSH 官方全局语言服务：

- 全新配置没有显式语言偏好时，WebUI 根据浏览器报告的系统语言自动选择；`zh` 区域变体使用简体中文，`en` 区域变体使用英文，其他语言回退到简体中文。
- 可在 DSH `设置 → 通用 → 语言`（`Settings → General → Language`）中切换`中文`或 `English`；选择会写入 `$DSH_HOME/settings.yaml`，Squad 与 DSH 其他界面会立即同步更新。
- 状态、投递进度、执行策略、已知系统摘要、错误码说明、日期和无障碍标签都会本地化；用户输入、Agent 生成内容以及协议/签名字段保持原文和稳定标识。

这里的“系统语言”来自打开 WebUI 的浏览器，因此从 Windows 浏览器访问 WSL 中的 DSH 时，会跟随 Windows/浏览器语言，而不是 WSL 的 `LANG`。

## 安全边界

- Node 首次启动生成并本地保存 Ed25519 身份；数据库会绑定身份，密钥或 DB 被替换时失败关闭。
- Envelope 使用严格 Zod schema、canonical bytes 和 Ed25519 签名；相同 ID 不同 payload 视为冲突。
- 组织根和追加式成员目录经过签名并在每个节点本地固定验证；协议 v2 将 Organization、发送者 membership 和接收者 membership 同时绑定进 Envelope。
- Relay 邮箱请求使用短时签名、nonce 防重放和 recipient 隔离。
- Direct 入口只接受已启用 Peer 的签名协议 v1 Envelope；发送方只有在校验接收节点使用固定公钥签发的 Node Receipt 后，才会标记`对方节点已接收`。它不使用共享密码，也不会仅凭 IP/端口授予信任。
- `/squad/v1/local/*` 管理接口只接受 loopback 客户端并拒绝转发请求；公网反向代理只应放行 Relay 所需的非 `local` 精确路由。
- 更新清单使用仓库内固定的 Ed25519 发布公钥验证；下载包必须与签名清单中的文件名、大小和 SHA-256 全部一致，插件本身没有替换正在运行代码的权限。
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

如果已经为 Relay 配置外部更新器，永久禁用插件时也应停止其 user timer 和 path unit：

```bash
systemctl --user disable --now \
  dsh-squad-relay-updater.timer \
  dsh-squad-relay-updater.path
```

## 开发与验收

```bash
pnpm verify:pins
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm smoke:delegation
```

发布维护者需要离线备份发布私钥，且绝不能把它放进仓库。`release-signing-key*.pem` 已被 `.gitignore` 拒绝；打包和签名命令会检查私钥是普通文件、仅所有者可访问，并与包内公钥匹配：

```bash
DSH_SQUAD_RELEASE_SIGNING_KEY=/secure/path/release-signing-key.pem \
  pnpm release:prepare
```

发布 `v0.7.0` 时需要把 `artifacts/` 中的 `dsh-squad-plugin-0.7.0.tgz`、同名 `.sha256`、`dsh-squad-update-manifest-0.7.0.json` 和 `.sig` 四个文件全部作为 GitHub Release assets 上传。缺少任意一个、签名不符或 Release tag 不一致时，客户端都会拒绝更新。

`smoke:delegation` 会构建真实 tarball，安装到 Alice、Bob、Relay 三套隔离 DSH Home，并用真实 Chromium 验证：WebUI 配对、Team Planner 草案审批与幂等分派、Bob 离线投递、Relay/Node 重启、接收端专属 Skill、HumanTodo 部分完成、相同 Session 恢复、Outcome 隐私边界和插件可逆禁用；组织协议另由签名目录、Relay 权限与本地持久化集成测试覆盖。Direct 的签名回执、伪造回执拒绝、离线排队、恢复在线自动重投和幂等接收由独立端到端测试覆盖。

## 许可证

本项目使用 [MIT License](LICENSE)。版本变更见 [CHANGELOG.md](CHANGELOG.md)。
