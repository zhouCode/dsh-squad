# @dsh-squad/plugin

[简体中文](README.zh-CN.md) | [English](README.md)

> 让个人 Agent 组成团队，而不交出工作区、凭据与控制权。

DSH Squad 把运行在不同电脑、网络和地点上的个人 Agent 组成任务委派团队，同时让每个人继续拥有和控制自己的 Agent。它既支持带持久邮箱和签名组织的持续在线 Relay，也支持无需 Relay、固定公钥的 Direct 点对点投递。成员无需共享账号、API Key、工作区访问权或工具权限；执行始终发生在接收方自己的 DSH、原生 Session、Skill、凭据与审批边界内。

## 为什么使用 Squad

- Relay 模式适合无需节点直连的跨地域协作；Direct 模式适合局域网、VPN 或已有可达地址的小团队。
- Relay 持久保存离线任务；Direct 由发送方本地 Outbox 保存并自动重试，明确显示`等待对方可达`。
- 通过认证 Relay 唤醒事件或接收节点签名的 Direct Node Receipt 实时观察投递状态。
- 可选的外部更新器为持久在线 Relay 验证签名 Release、备份、重启、健康检查并在失败时回滚；默认只通知。
- 带签名的多组织成员目录、Owner/Admin/Member 角色、一次性邀请、审批和禁用，不再要求成员两两配置 Peer。
- 一个节点可以加入多个组织；每个 DSH Session 独立选择一个组织成员目录或兼容的直接 Peer。
- 每个成员可分别选择“每次确认”“仅匹配本机规则”和“始终自动执行”；本机规则会强制限制目标、工具、附件、preset、时长与 Token，并可直接在 WebUI 管理。
- 可编辑的本地 Team Planner 草案、负责人明确审阅、版本冲突保护和幂等批量分派。
- 原生复用接收方的 DSH Agent、Session、Skill、工具、Permission/Approval 和 WebUI。
- 私有 Session ID、HumanTodo 详情、人工回复、凭据和工作区路径始终保留在本地。

这个包包含一个 Cordis Host 插件、六个原生 Agent 工具、一个 DSH Web Client Module、Relay Client 和可选的 Relay Server。它不会创建第二套 Runtime 或独立 SPA，也不强制使用 Docker。

## 安装

```bash
dsh plugin --profile web add ./dsh-squad-plugin-0.7.2.tgz --offline
dsh web
```

包内的 `cordis.patch.yml` 会插入 `dsh-squad` 条目。全新安装首次打开`智能体收件箱`时会显示简短向导：设置节点名称，然后选择加入 Relay 或使用 Direct 点对点。Relay 会在验证一次性邀请和签名身份后保存连接；邀请不会写入节点数据库。完成后可在`设置 → 团队连接`重新修改，无需手工编辑 YAML。

无人值守部署、Relay Server 和高级运行策略仍可在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中覆盖配置：

```yaml
- id: dsh-squad
  config:
    displayName: Alice Personal Agent
    relay:
      url: https://relay.example.com
      invitation: replace-with-one-time-invitation
```

Direct 模式需要双方固定对方的 Node ID、公钥和 Direct URL，并在接收节点启用 Direct 入口：

```yaml
- id: dsh-squad
  config:
    direct:
      enabled: true
      publicUrl: https://alice-agent.example.com
      retryIntervalMs: 5000
    peers:
      - nodeId: node_REPLACE_ME
        displayName: Bob
        publicKey: REPLACE_WITH_BOB_ED25519_PUBLIC_KEY
        transport: DIRECT
        directUrl: https://bob-agent.example.com
```

Direct 不提供 NAT 穿透或第三方离线邮箱：任务保存在发送方，直到双方同时在线且可达。生产入口必须使用 HTTPS；v0.6 的签名组织目录仍由 Relay 承载。

原生 WebUI 提供`智能体收件箱` / `Agent Inbox`，实时显示节点和当前 Session 组织，并管理签名成员目录、邀请批准或拒绝、逐成员策略、Team Planner 草案、收发箱、HumanTodo 和原生 Session 链接。Agent 还获得组织列表与切换工具。计划草案会一直保留在本地，直到负责人确认；接收方自己的策略和审批仍然独立生效。

Relay 主机默认是仅中继的基础设施角色，不需要再加入 Relay。只有用户在设置中明确启用并确认混合角色后，本机 Agent 才会额外成为普通成员节点；加入自身 Relay 也不会产生超级 Agent 或额外组织权限。

Owner/Admin 可查看邀请的有效、已使用、已过期或已撤销状态，并撤销未使用邀请。一次性 token 只在创建时显示，邀请记录不会泄露 token 或其哈希。

活动中的 Admin 和 Member 可以从 WebUI 主动退出；插件会追加本人签名的目录事件、自动清除本机相关 Session 上下文，并保留审计历史。Owner 必须先转让所有权才能退出。

所有权转让需要双方签名：当前 Owner 发起，目标成员在自己的节点明确接受后，Relay 才会原子地把原 Owner 变为 Admin，并建立唯一的新 Owner。接受前任一方都可以取消或拒绝。

Owner 可以通过追加式签名元数据事件修改组织名称；已固定的组织根和历史名称仍可验证。

Owner 可以通过不可逆的签名终止事件解散组织。Relay 会立即关闭邀请、待审批加入请求和新任务路由，各节点同步后会清除相关 Session 上下文；成员目录与历史任务只读保留用于审计，解散后的目录不能继续变更。

计划分派后会实时汇总各项执行进度，并只回收接收方明确发布的结果摘要和输出；每个计划项都可以直接打开对应的完整委派记录。

聊天触发保持轻量：可以直接使用自然语言或 `@成员`，也可以使用统一命名空间下的 `/squad-*` 英文命令管理任务、计划、状态、组织、成员、邀请和角色。命令通过 DSH 原生的 `/` 菜单按需发现；插件不会增加命令按钮。

## 更新

v0.5.0 增加`智能体收件箱 → 更新`和独立的 `dsh-squad-update`。默认策略是`仅通知`；用户也可以选择关闭或在节点空闲时自动安装。插件进程不会替换自己，只有单独配置的 systemd updater 能停服、备份 profile 与显式数据路径、安装经过 Ed25519 签名清单和 SHA-256 双重校验的 GitHub Release、重启并执行版本健康检查。失败时恢复旧 profile 与数据。

v0.5.0 需要手动安装，之后的版本才能使用这套自更新。服务器 Relay 的完整 systemd 配置、安全约束与命令见仓库的[简体中文 README](https://github.com/zhouCode/dsh-squad#持久在线-relay-的安全更新)。此功能只更新 Squad，不更新 DSH 或其他插件。

## 语言

简体中文和英文都是由插件维护并经过类型检查的完整词典。全新的 WebUI 根据浏览器报告的系统语言自动选择（`zh-*` → 简体中文，`en-*` → 英文，不支持的语言 → 简体中文）。在`设置 → 通用 → 语言`中手动选择后，偏好会由 Host 持久化并立即更新界面。

## 安全边界

生产 Relay 和 Direct URL 必须使用 HTTPS。每个 Node 在本地保存独立的 Ed25519 身份；组织根和追加式成员事件经过签名并在本机固定，协议 v2 同时绑定双方 membership。Direct 只接受已启用且固定公钥的 Peer 所签名的协议 v1 Envelope，并返回接收节点签名的回执；IP 和端口本身不会产生信任。个人 DSH WebUI 应只监听 `127.0.0.1`；对外只通过经过加固的 HTTPS 反向代理放行必需的精确路由。当前 Relay 是受信任内容中转方，不提供端到端加密。

更新 API 同样只允许 loopback；Release 必须来自配置的 GitHub 仓库，并同时匹配包内固定发布公钥、签名清单、文件名、大小、SHA-256 和最低 DSH 版本。默认不会无人确认就安装。

只有明确的任务数据、公开状态、摘要和结果会跨 Node 传输。接收方的 Session ID、HumanTodo 详情、人工回复、凭据和工作区路径始终留在本地。

## 许可证

[MIT](LICENSE)
