# @dsh-squad/plugin

[English](README.md) | [简体中文](README.zh-CN.md)

> Let personal Agents become a team without giving up workspaces, credentials, or control.

DSH Squad turns personal Agents on different computers, networks, and locations into a delegation team while every person remains the owner and operator of their own Agent. It supports an always-on Relay with durable mailboxes and signed organizations, or pinned-key Direct peer-to-peer delivery without a Relay. Members share no accounts, API keys, workspace access, or tool permissions; execution stays inside the recipient's own DSH, native Session, Skills, credentials, and approval boundary.

## Why Squad

- Relay mode for cross-location collaboration without direct node connectivity; Direct mode for reachable LAN/VPN/small-team Peers.
- Relay-persisted offline delivery, or a sender-local Direct outbox with automatic retry and explicit `Waiting for peer reachability` state.
- Observable delivery through authenticated Relay wakeups or a recipient-signed Direct Node Receipt.
- Optional safe maintenance for an always-on Relay: signed-release verification, backup, restart, health check, and rollback, with notify-only as the default.
- Signed multi-organization membership with Owner/Admin/Member roles, one-time invitations, approval, and revocation—without pairwise Peer setup.
- One Node may join multiple organizations; each DSH Session selects one organization-scoped recipient directory or compatible direct Peers.
- Per-member always-ask, local-rule, and always-auto-run modes; local rules enforce objective, tool, attachment, preset, runtime, and token limits and are managed in the WebUI.
- Local Team Planner drafts with explicit owner review and idempotent batch dispatch.
- Native reuse of the recipient's DSH Agent, Session, Skills, tools, Permission/Approval, and WebUI.
- Local retention of private Session IDs, HumanTodo details, human responses, credentials, and workspace paths.

The package contains one Cordis Host plugin, six native Agent tools, a DSH Web Client Module, a Relay client, and an optional Relay server. It does not create a second runtime or standalone SPA, and Docker is optional.

## Install

```bash
dsh plugin --profile web add ./dsh-squad-plugin-0.7.0.tgz --offline
dsh web
```

The bundled `cordis.patch.yml` inserts the `dsh-squad` entry. A fresh installation shows a short guide the first time `Agent Inbox` opens: name the Node, then join a Relay or choose Direct peer-to-peer. Relay settings are saved only after the one-time invitation and signed identity are validated, and the invitation is never written to the Node database. Change the connection later under `Settings → Team connection`; no manual YAML edit is required.

Unattended deployments, Relay Server hosting, and advanced runtime policy may still override configuration in `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: dsh-squad
  config:
    displayName: Alice Personal Agent
    relay:
      url: https://relay.example.com
      invitation: replace-with-one-time-invitation
```

For Direct mode, both Nodes pin each other's Node ID/public key and Direct URL. The receiving Node enables the Direct endpoint:

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

Direct has no NAT traversal or third-party offline mailbox: the sender keeps the task until both Peers are online and reachable. Production endpoints require HTTPS. Signed organization directories remain Relay-backed in v0.6.

The native WebUI exposes `Agent Inbox` / `智能体收件箱` for real-time Node and Session organization identity, signed membership, invitations and approvals, per-member policy, Team Planner review, inbox/outbox state, HumanTodo input, and native Session links. Agents also receive organization listing/selection tools. A Team Planner proposal stays local until its owner approves it; recipient policy and approval remain independent.

Chat triggering stays unobtrusive: use natural language or `@member`, or use namespaced `/squad-*` commands for tasks, plans, status, organizations, members, invitations, and roles. They are discovered through DSH's native `/` menu; this package adds no command buttons.

## Updates

v0.5.0 adds `Agent Inbox → Updates` and a separate `dsh-squad-update` executable. The default is notify-only; users may instead disable checks or opt into installation while the Node is idle. The plugin process never replaces itself. Only a separately configured systemd updater may stop the service, back up the profile and explicit data paths, install a GitHub Release verified by both an Ed25519-signed manifest and SHA-256, restart, and check the reported version. Failure restores the old profile and data.

v0.5.0 must be installed manually before later releases can use self-update. See the repository's [English README](https://github.com/zhouCode/dsh-squad/blob/main/README.en.md#safe-updates-for-an-always-on-relay) for full systemd setup, commands, and safety constraints. This updates Squad only, not DSH or other plugins.

## Languages

Simplified Chinese and English are complete, type-checked dictionaries owned by the plugin. A fresh WebUI follows the system language reported by the browser (`zh-*` → Simplified Chinese, `en-*` → English, unsupported languages → Simplified Chinese). An explicit choice under `Settings → General → Language` is persisted by the Host and updates the UI immediately.

## Security boundary

Production Relay and Direct URLs require HTTPS. Each Node keeps a local Ed25519 identity; organization roots and append-only member events are signed and pinned locally, and protocol-v2 Delegations bind both membership IDs. Direct accepts signed protocol-v1 Envelopes only from enabled pinned Peers and returns a receipt signed by the receiving Node—an IP address and port never grant trust. Personal DSH WebUIs should listen only on `127.0.0.1`; expose only exact required routes through a hardened HTTPS reverse proxy. The current Relay is a trusted content intermediary, not an end-to-end-encrypted service.

Update APIs are also loopback-only. Releases must come from the configured GitHub repository and match the package-pinned release public key, signed manifest, filename, size, SHA-256, and minimum DSH version. Unattended installation is never the default.

Only explicit task data, public status, summaries, and outcomes cross Nodes. Receiver Session IDs, HumanTodo details, human responses, credentials, and workspace paths remain local.

## License

[MIT](LICENSE)
