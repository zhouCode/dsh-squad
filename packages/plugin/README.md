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
- A reviewable Team Skill catalog: publish a Node-signed native Skill, obtain Owner/Admin approval, then explicitly install it beside native Skills in DSH's `/` menu.
- One Node may join multiple organizations; each DSH Session selects one organization-scoped recipient directory or compatible direct Peers.
- Per-member always-ask, local-rule, and always-auto-run modes; local rules enforce objective, tool, attachment, preset, runtime, and token limits and are managed in the WebUI.
- Editable local Team Planner drafts with explicit owner review, optimistic conflict protection, and idempotent batch dispatch.
- Native reuse of the recipient's DSH Agent, Session, Skills, tools, Permission/Approval, and WebUI.
- Local retention of private Session IDs, HumanTodo details, human responses, credentials, and workspace paths.

The package contains one Cordis Host plugin, six native Agent tools, a DSH Web Client Module, a Relay client, and an optional Relay server. It does not create a second runtime or standalone SPA, and Docker is optional.

## Install

```bash
dsh plugin --profile web add ./dsh-squad-plugin-0.7.3.tgz --offline
dsh web
```

Version 0.7.3 is fully tested with DeepSeek Harness `0.1.1-rc.2` and retains a dedicated compatibility regression for `0.1.0-rc.6`.

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

The native WebUI exposes `Agent Inbox` / `智能体收件箱` for real-time Node and Session organization identity, signed membership, invitation approval or rejection, per-member policy, Team Planner review, inbox/outbox state, HumanTodo input, and native Session links. Agents also receive organization listing/selection tools. A Team Planner proposal stays local until its owner approves it; recipient policy and approval remain independent.

Owners and Admins can inspect invitation status and revoke unused invitations. One-time tokens appear only when created; invitation history exposes neither tokens nor token hashes.

Active Admins and Members can leave from the WebUI through a self-signed directory event. Local Session contexts for that organization are cleared automatically and audit history remains intact. Owners must transfer ownership before leaving.

Ownership transfer is a two-party signed operation: the current Owner proposes it, the target explicitly accepts on their own Node, and Relay atomically demotes the previous Owner to Admin while establishing exactly one new Owner. Either side can cancel or decline before acceptance.

Owners can rename an organization through an append-only signed metadata event; the pinned root and prior names remain verifiable.

Owners can irreversibly dissolve an organization with a signed terminal event. Relay immediately closes invitations, pending join requests, and new organization routing; Nodes clear related Session context after synchronization. Membership and task history remain read-only for audit, and no directory event may follow dissolution.

After dispatch, the plan rolls up live execution progress and collects only the result summaries and outputs explicitly published by recipients; each item links to its full delegation record.

Delegation details expose a four-stage created/delivery/execution/result timeline and state exactly whether the local user, local Agent, Relay, peer Node, or automatic retry acts next.

The workbench reports local live-event health and the latest successful read. `Sync now` actively pumps organization, outbox, mailbox, and update state.

When the current Node hosts Relay, Connection diagnostics includes a loopback-only operations overview of aggregate enrollment, live mailbox connections, durable backlog age, organization activity, invitations, startup, capacity, and rate limits. It exposes no task payloads or private metrics from remote Nodes.

A Relay host defaults to an infrastructure-only role and does not need to join a Relay. Its local Agent becomes a regular member only after the owner explicitly enables and confirms the optional hybrid role; joining its own Relay creates neither a super Agent nor extra organization authority.

Delegation and Team Planner lists paginate independently in batches of 25 and navigate directly to records opened across views.

Finished delegations and fully dispatched or canceled plans share a reversible local archive. Archival removes failures from attention counts without deleting records, results, plan items, or audit history.

Chat triggering stays unobtrusive: use natural language or `@member`, or use namespaced `/squad-*` commands for tasks, plans, status, organizations, members, invitations, and roles. They are discovered through DSH's native `/` menu; this package adds no command buttons.

The workbench is a keyboard-contained modal with focus restoration, Escape handling, Tab loops, Arrow/Home/End tab navigation, explicit focus indicators, text-backed status cues, and reduced-motion support.

On compact screens, Delegations, plans, and archives switch from the desktop two-pane layout to a full-height list followed by one focused detail view with an explicit back action and touch-sized controls.

## Team Skills

`Agent Inbox → Team Skills` publishes a native Skill already discovered by DSH as a signed, immutable release in the Relay organization catalog. Member submissions require Owner/Admin review, and every recipient must explicitly install an approved release locally; joining an organization never installs a Skill automatically.

Installations use DSH's native Skill Registry, so native and team Skills share the chat `/` menu and invocation mechanism. The WebUI provides `Disabled`, `Manual only`, `Local`, and `Delegation` policies. `Manual only` is the default, and only `Delegation` permits automatic model selection during a Squad delegated run. Revocation automatically disables a local copy.

Bundles contain only `SKILL.md` and directory resources and grant no tools, MCP connections, accounts, or credentials. Publisher signatures, content hashes, path safety, and size limits are checked across publication and installation. Relay can read Skill content, so Owner/Admin review remains an explicit code-trust boundary.

## Updates

v0.5.0 adds `Agent Inbox → Updates` and a separate `dsh-squad-update` executable. The default is notify-only; users may instead disable checks or opt into installation while the Node is idle. The plugin process never replaces itself. Only a separately configured systemd updater may stop the service, back up the profile and explicit data paths, install a GitHub Release verified by both an Ed25519-signed manifest and SHA-256, restart, and check the reported version. Failure restores the old profile and data.

The Update Center exposes a preflight checklist before installation: updater configuration, verified-release availability, duplicate requests, active Delegations, and dispatching plans. The request button remains disabled until all items pass, and the external updater independently enforces the same idle-work rule before shutdown.

v0.5.0 must be installed manually before later releases can use self-update. See the repository's [English README](https://github.com/zhouCode/dsh-squad/blob/main/README.en.md#safe-updates-for-an-always-on-relay) for full systemd setup, commands, and safety constraints. This updates Squad only, not DSH or other plugins.

## Languages

Simplified Chinese and English are complete, type-checked dictionaries owned by the plugin. A fresh WebUI follows the system language reported by the browser (`zh-*` → Simplified Chinese, `en-*` → English, unsupported languages → Simplified Chinese). An explicit choice under `Settings → General → Language` is persisted by the Host and updates the UI immediately.

## Security boundary

Production Relay and Direct URLs require HTTPS. Each Node keeps a local Ed25519 identity; organization roots and append-only member events are signed and pinned locally, and protocol-v2 Delegations bind both membership IDs. Direct accepts signed protocol-v1 Envelopes only from enabled pinned Peers and returns a receipt signed by the receiving Node—an IP address and port never grant trust. Personal DSH WebUIs should listen only on `127.0.0.1`; expose only exact required routes through a hardened HTTPS reverse proxy. The current Relay is a trusted content intermediary, not an end-to-end-encrypted service.

Update APIs are also loopback-only. Releases must come from the configured GitHub repository and match the package-pinned release public key, signed manifest, filename, size, SHA-256, and minimum DSH version. Unattended installation is never the default.

Only explicit task data, public status, summaries, outcomes, and Team Skill content deliberately published by a user cross Nodes. Receiver Session IDs, HumanTodo details, human responses, credentials, and workspace paths remain local.

## License

[MIT](LICENSE)
