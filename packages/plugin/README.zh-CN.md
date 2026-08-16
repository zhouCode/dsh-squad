# @dsh-squad/plugin

[简体中文](README.zh-CN.md) | [English](README.md)

> 让个人 Agent 组成团队，而不交出工作区、凭据与控制权。

DSH Squad 把运行在不同电脑、网络和地点上的个人 Agent，组成一个支持成员离线的任务委派团队，同时让每个人继续拥有和控制自己的 Agent。个人节点不需要公网 IP 或开放入站端口，成员之间也无需共享账号、API Key、工作区访问权或工具权限。Agent 通过 Relay 交换经过签名的任务和明确发布的结果；执行始终发生在接收方自己的 DSH、原生 Session、Skill、凭据与审批边界内。

## 为什么使用 Squad

- 通过一个持续在线的 Relay 实现跨地域协作，无需节点直连。
- 团队成员的电脑暂时离线时，由持久邮箱保存待投递任务。
- 使用 Ed25519 节点身份、Peer 公钥固定和策略化委派。
- 每个 Peer 可分别配置 `NEVER`、`SAFE` 和 `TRUSTED` 自动执行模式。
- 本地 Team Coordinator 草案、负责人明确审阅和幂等批量分派。
- 原生复用接收方的 DSH Agent、Session、Skill、工具、Permission/Approval 和 WebUI。
- 私有 Session ID、HumanTodo 详情、人工回复、凭据和工作区路径始终保留在本地。

这个包包含一个 Cordis Host 插件、四个原生 Agent 工具、一个 DSH Web Client Module、Relay Client 和可选的 Relay Server。它不会创建第二套 Runtime 或独立 SPA，也不强制使用 Docker。

## 安装

```bash
dsh plugin --profile web add ./dsh-squad-plugin-0.2.0.tgz --offline
dsh web
```

包内的 `cordis.patch.yml` 会插入 `dsh-squad` 条目。可以在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中覆盖配置：

```yaml
- id: dsh-squad
  config:
    displayName: Alice Personal Agent
    relay:
      url: https://relay.example.com
      invitation: replace-with-one-time-invitation
```

原生 WebUI 提供`智能体收件箱` / `Agent Inbox`，用于审阅分派计划、管理 Peer 策略、收发箱状态、HumanTodo 输入和原生 DSH Session 链接。Agent 会获得 `delegate_to_agent`、`get_delegation_status`、`list_squad_peers` 和 `propose_team_plan` 四个工具。计划草案会一直保留在本地，直到负责人在`分派计划` / `Plans`中确认；接收方自己的策略和审批仍然独立生效。

## 语言

简体中文和英文都是由插件维护并经过类型检查的完整词典。全新的 WebUI 根据浏览器报告的系统语言自动选择（`zh-*` → 简体中文，`en-*` → 英文，不支持的语言 → 简体中文）。在`设置 → 通用 → 语言`中手动选择后，偏好会由 Host 持久化并立即更新界面。

## 安全边界

生产 Relay URL 必须使用 HTTPS。每个 Node 在本地保存独立的 Ed25519 身份，Peer 将 `nodeId` 固定到对应公钥。个人 DSH WebUI 应只监听 `127.0.0.1`；对外只通过经过加固的 HTTPS 反向代理开放 Relay API。当前 Relay 是受信任内容中转方，不提供端到端加密。

只有明确的任务数据、公开状态、摘要和结果会跨 Node 传输。接收方的 Session ID、HumanTodo 详情、人工回复、凭据和工作区路径始终留在本地。

## 许可证

[MIT](LICENSE)
