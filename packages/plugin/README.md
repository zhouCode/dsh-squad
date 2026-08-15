# @dsh-squad/plugin

[English](README.md) | [简体中文](README.zh-CN.md)

> Let personal Agents become a team without giving up workspaces, credentials, or control.

DSH Squad turns personal Agents on different computers, networks, and locations into an offline-capable delegation team while every person remains the owner and operator of their own Agent. Personal nodes need no public IP address or inbound port, and members share no accounts, API keys, workspace access, or tool permissions. Agents exchange signed tasks and deliberately published outcomes through a Relay; execution stays inside the recipient's own DSH, native Session, Skills, credentials, and approval boundary.

## Why Squad

- Cross-location collaboration through one always-on Relay, without direct node connectivity.
- Durable mailbox delivery when a teammate's computer is temporarily offline.
- Ed25519 node identity, pinned Peer keys, and policy-controlled delegation.
- Per-Peer `NEVER`, `SAFE`, and `TRUSTED` automatic-execution modes.
- Native reuse of the recipient's DSH Agent, Session, Skills, tools, Permission/Approval, and WebUI.
- Local retention of private Session IDs, HumanTodo details, human responses, credentials, and workspace paths.

The package contains one Cordis Host plugin, two native Agent tools, a DSH Web Client Module, a Relay client, and an optional Relay server. It does not create a second runtime or standalone SPA, and Docker is optional.

## Install

```bash
dsh plugin --profile web add ./dsh-squad-plugin-0.2.0.tgz --offline
dsh web
```

The bundled `cordis.patch.yml` inserts the `dsh-squad` entry. Override it in `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: dsh-squad
  config:
    displayName: Alice Personal Agent
    relay:
      url: https://relay.example.com
      invitation: replace-with-one-time-invitation
```

The native WebUI exposes `Agent Inbox` / `智能体收件箱` for Peer policy, inbox and outbox state, HumanTodo input, and links to native DSH Sessions. Agents receive `delegate_to_agent` and `get_delegation_status`.

## Languages

Simplified Chinese and English are complete, type-checked dictionaries owned by the plugin. A fresh WebUI follows the system language reported by the browser (`zh-*` → Simplified Chinese, `en-*` → English, unsupported languages → Simplified Chinese). An explicit choice under `Settings → General → Language` is persisted by the Host and updates the UI immediately.

## Security boundary

Production Relay URLs require HTTPS. Each Node keeps a local Ed25519 identity, and Peers pin `nodeId` to its public key. Personal DSH WebUIs should listen only on `127.0.0.1`; expose only the Relay API through a hardened HTTPS reverse proxy. The current Relay is a trusted content intermediary, not an end-to-end-encrypted service.

Only explicit task data, public status, summaries, and outcomes cross Nodes. Receiver Session IDs, HumanTodo details, human responses, credentials, and workspace paths remain local.

## License

[MIT](LICENSE)
