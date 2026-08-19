# DSH Squad

[简体中文](README.md) | [English](README.en.md)

> Let personal Agents become a team without giving up workspaces, credentials, or control.

DSH Squad turns personal Agents running on different computers, networks, and locations into a durable delegation team while every person remains the owner and operator of their own Agent. It supports both a centralized **Relay mode** with durable mailboxes and organization directories, and a **Direct peer-to-peer mode** that needs no Relay. Both modes exchange only signed tasks and deliberately published outcomes. Accounts, API keys, workspace access, tool permissions, and execution remain inside the recipient's own DSH, native Session, Skills, credentials, and approval boundary.

## Highlights

- **Two team modes for different networks**: Relay mode fits cross-location teams, intermittently offline members, and nodes that cannot expose inbound ports. Direct mode fits a LAN, VPN, or small team whose nodes already have reachable HTTPS endpoints, without operating a central intermediary.
- **Join an organization once, not every pair**: in Relay mode, Nodes enter a signed organization directory through one-time invitations and human approval. Team growth no longer requires every pair of people to exchange Peer configuration, and one Node may belong to multiple organizations.
- **Locally planned, individually controlled**: Team Planner can turn a meeting or team objective into a multi-person delegation draft, but it is not a shared super-Agent holding everyone's authority. The planner's owner must approve dispatch, and every recipient still decides execution through their own policy and approval boundary.
- **Cross-location without direct node connectivity**: personal nodes only need an outbound connection to an always-on Relay, so they can sit behind NAT, home networks, corporate networks, or national borders without public IP addresses or inbound ports.
- **Offline behavior has explicit semantics**: Relay mode persists work independently at the intermediary. Direct mode persists it in the sender's local SQLite outbox and retries automatically, while the WebUI shows waiting state, next retry, failed attempts, and the latest error. Duplicate delivery cannot create duplicate Sessions or executions.
- **Delivery is observable in real time**: an authenticated Relay event stream wakes recipients immediately with polling as fallback, while Direct returns a signed durable-receipt from the receiving Node. Senders can distinguish local queueing, waiting for peer reachability, Relay persistence, and receipt by the peer Node.
- **A Relay can maintain itself safely**: a separate updater verifies signed releases and, while the Node is idle, backs up, installs, restarts, and checks the reported version. Notify-only is the default and failures roll back.
- **Per-person trust with enforced limits**: every direct Peer or organization member can be set to always ask, match local rules only, or always auto-run. A local rule matches the full objective and enforces tools, attachments, preset, runtime, and token limits; no match means human confirmation.
- **No YAML edit for first-time setup**: open `Agent Inbox` to choose Relay or Direct, validate the connection, and save it locally through the Simplified Chinese or English guide; change it later in Settings.
- **Native to DSH**: work runs in the recipient's existing Agent, Session, Skill catalog, tools, and Permission/Approval flow, without a second runtime or standalone management platform.

## Two team modes

| Capability        | Relay mode                                            | Direct peer-to-peer mode                                                                  |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Topology          | Every Node connects outward to one always-on Relay    | Every Peer stores the other's reachable HTTPS endpoint                                    |
| Membership        | Signed organization directory with Owner/Admin/Member | Explicitly exchange and pin Node ID, public key, and endpoint                             |
| Recipient offline | Relay persists independently; sender may go offline   | Sender retains the task; both must later be online and reachable together                 |
| Network           | No public IP or personal-node inbound port required   | At least the task direction must be reachable; bidirectional status needs both directions |
| Best fit          | Cross-location, larger, asynchronous teams            | LAN, VPN, existing mesh, or a small team                                                  |

Relay mode:

```text
Alice Agent --signed Delegation--> durable Relay mailbox --> Bob's DSH
                                                             |
                                            Bob Personal Agent + local Skill
                                                             |
                                  automatic result --> explicit Outcome
                                  owner needed     --> HumanTodo --> resume same Session
```

Direct mode:

```text
Alice Agent --signed Delegation--> Bob's Direct HTTPS endpoint
      |                                      |
      +-- durable local outbox <-- retry ----+
      <---------- Bob-signed Node Receipt ---+
```

Direct mode does not provide NAT traversal, distributed store-and-forward, or decentralized organization consensus. While Bob is offline, Alice shows `Waiting for peer reachability` and retries on the configured interval. Delivery cannot complete if Alice and Bob are never online and mutually reachable at the same time. Retries are bounded by `envelopeTtlMinutes` (60 minutes by default); expiry changes the task to `Delivery expired`, after which a new delegation is required. In v0.6, signed organization directories still use Relay; a Direct team uses explicitly paired Peers, which Team Planner can target normally.

- The sender submits only an objective, context, acceptance criteria, and validated HTTPS attachment references.
- The recipient's PeerPolicy decides whether to reject, wait for owner acceptance, or execute automatically.
- The recipient Agent chooses its own local Skills and tools. The protocol has no remote Skill, Shell, MCP, or Credential field.
- Relay is only an authenticated, at-least-once mailbox; Direct is only pinned-key peer delivery. Receiver-side SQLite, Envelope IDs, and Delegation IDs prevent duplicate delivery from causing duplicate execution.
- HumanTodo details, native Session IDs, human responses, credentials, and workspaces remain on the recipient node.
- The sender sees only the status, summary, and Outcome that the recipient explicitly publishes.

Use native DSH Sub-agents for parallel decomposition within one person's DSH. Use Squad when work crosses into a Personal Agent owned by another person.

## Team Planner: review before dispatch

The local Agent can inspect active members in the organization selected for the current Session, or compatible direct Peers when no organization is selected, then turn meeting notes or a team objective into a persistent delegation-plan draft. Draft creation performs no network request or remote execution. Under `Agent Inbox → Plans`, the owner can edit recipients, objectives, context, acceptance criteria, and attachments, add or remove items, and reorder them before selecting `Approve and dispatch`. Saving a draft still sends nothing; items lock once dispatch begins.

A typical prompt is:

> Use `list_squad_peers` to inspect available members, then turn these meeting decisions into a team delegation plan. Create a draft only; do not delegate directly: …

The Agent calls `propose_team_plan`. Only owner approval creates one signed Delegation from the existing protocol per plan item. Every item receives its final Delegation ID when the draft is created, so a lost approval response, process restart, or partial-failure retry cannot create duplicate assignments. Sender-side approval is not recipient authorization: the receiver may still reject, require local acceptance, or execute under its own `SAFE` / `TRUSTED` policy.

After dispatch, the original plan rolls up each item's live queued, running, waiting-for-human, completed, failed, or canceled state and collects only the result summary and outputs that the recipient explicitly publishes. The owner can open the full delegation record from any plan item. Private Sessions, HumanTodo details, and local work remain outside the plan projection.

Each delegation detail expands status into a four-stage `Created → Delivery → Acceptance and execution → Result` timeline and names whether the local user, local Agent, Relay, peer Node, or automatic retry acts next. An offline peer therefore reads as locally queued, persisted by Relay, received by the peer, or executing without requiring users to interpret protocol states.

The workbench header reports whether its local live-event channel is connected, reconnecting, or potentially stale and shows the latest successful state read. `Sync now` actively runs organization, outbox, mailbox, and update synchronization instead of merely repainting a cached snapshot.

Delegation and Team Planner lists paginate independently in batches of 25 and remember each tab's position. Opening a delegation from a plan jumps directly to its containing page, so a long history is never rendered as one unbounded list.

Finished delegations and fully dispatched or canceled plans can move into one `Archive` tab. Archival changes only local workbench organization: archived failures leave attention counts, while tasks, results, plan items, and audit records remain intact, already dispatched work is not stopped, and every record can be restored.

The same local Plan API is available for future connectors such as Feishu/Lark to create drafts or read status projections. This version does not include a Feishu/Lark connector and never executes work merely because an external board was edited.

## Organizations, roles, and Session isolation

The Node that creates an organization is its sole `Owner`. The Owner may appoint zero or more `Admin` members; every other participant joins as a `Member`. Owner and Admin can create one-time invitations and approve or reject join requests. A rejected request disappears from both pending views immediately, and its applicant needs a new invitation before trying again. Admins can manage ordinary Members, while only the Owner can appoint or demote Admins. The Owner may propose a transfer to any active member, but the target must explicitly accept on their own Node. Relay then commits “previous Owner becomes Admin” and “target becomes the sole Owner” as one atomic directory event. Either party may cancel or decline before acceptance, and any intervening directory change makes the old proposal stale.

Owners and Admins can also inspect the latest 200 invitations as active, used, expired, or revoked and revoke an unused invitation from the WebUI. A token is shown only once at creation; the history returns an independent random ID and audit timestamps, never the token or its hash.

The Owner can rename the organization directly in the WebUI. A rename does not overwrite the pinned organization root; it appends an Owner-signed event that binds the previous and new names, and every Node verifies and replays the same directory to derive the current name. The resulting directory revision automatically makes any unaccepted ownership-transfer proposal stale.

An active Admin or Member can leave an organization from the WebUI. Leaving appends a self-signed disable event and clears every local Session context that points to the organization; it neither deletes history nor impersonates a manager action. The Owner must safely transfer ownership before leaving, preventing an ownerless organization.

A dedicated Authority key signs the organization root, and authorized Owner/Admin Nodes sign later member events. Relay and every Node verify the complete append-only chain, pinned public-key identity, continuous revisions, issuer role, and exactly one active Owner. A disabled member can no longer send organization-scoped Delegations.

One Node may join multiple organizations, but each DSH Session selects at most one organization context at a time. The top of `Agent Inbox` shows the current Node, Session, and organization in real time; changing it affects only that Session. Member discovery, Team Planner, and delegation remain inside that signed directory. Select `Direct Peers` to retain the original one-to-one mode.

The implemented capability is **Team Planner**, a local draft mechanism. A future **Organization Coordinator Agent**, if added, will be an optional service member rather than a sovereign super-Agent: it may receive deliberately published meeting material and status projections and create summaries, recommendations, or reviewable drafts, but it will inherit no member workspace, credentials, private Sessions, or tool authority and will not approve or execute work for people by default.

## Typical Relay deployment: a cross-location team

```text
Beijing: Alice's computer ──outbound HTTPS──┐
                                            │
Shanghai: Bob's computer   ──outbound HTTPS──┼── public or corporate Relay
                                            │
Overseas: Carol's computer ─outbound HTTPS──┘
```

This is an application-layer Agent collaboration network, not a VPN: it does not place member computers on one virtual LAN. Relay mode does not require nodes to reach one another by IP. A personal node's WebUI should listen only on `127.0.0.1`; expose only the Relay behind HTTPS, an exact route allowlist, and firewall rules. Direct mode instead depends on a LAN, VPN, port mapping, or existing reverse proxy for peer reachability; Squad does not establish an underlying network tunnel.

## Installation

Pinned runtime baseline: Node.js `24.18.0`, pnpm `10.28.2`, DeepSeek Harness `0.1.0-rc.6`, and Cordis `4.0.1`.

This repository publishes only `@dsh-squad/plugin`. It contains no standalone SPA, second runtime CLI, or Docker orchestration. Docker is an optional isolation mechanism, not a runtime requirement.

Build and install the tarball from this repository:

```bash
pnpm install --frozen-lockfile
pnpm run pack
dsh plugin --profile web add ./artifacts/dsh-squad-plugin-0.7.0.tgz --offline
dsh web
```

The bundled `cordis.patch.yml` mounts both the Host Plugin and Web Client Module. After startup, `Agent Inbox` appears in the native DSH sidebar (`智能体收件箱` in Chinese). Its header shows the Node identity and current Session organization in real time; Organizations manages signed membership, while Settings retains direct-Peer compatibility.

## First-run guide and Node configuration

A fresh installation no longer requires editing a configuration file. On the first opening of `Agent Inbox`, a guide asks for a Node name and either `Join a Relay` or `Direct peer-to-peer`:

- Relay mode asks for the Relay URL and, for a new Node, the one-time Node invitation issued by an administrator. Squad enrolls and verifies signed mailbox access before saving the URL. The invitation exists only for that request; it is not written to the Node SQLite database or returned by the state API.
- Direct mode can enable this Node's inbound endpoint and record its public URL. The guide validates the origin but does not create DNS, TLS, port mapping, or a reverse proxy.
- `Set up later` writes no placeholder configuration, so the guide returns the next time the panel opens. After completion, use `Agent Inbox → Settings → Team connection` to validate and change it again.

Nodes already configured through YAML, Nodes with existing direct Peers or organization data, and upgraded installations are not forced through onboarding. Node name, team mode, Relay URL, and Direct receiving settings saved in the interface persist locally and take precedence over those YAML fields; other runtime policies continue to come from YAML.

Unattended deployments and advanced options can still override `dsh-squad` in `$DSH_HOME/profiles/web/cordis.patch.yml`. Production Relay URLs must use HTTPS; loopback HTTP is allowed only for local development.

```yaml
- id: dsh-squad
  config:
    displayName: Alice Personal Agent
    pollIntervalMs: 5000
    envelopeTtlMinutes: 60
    execution:
      cwd: /absolute/path/to/alice-workspace
      # SAFE is shown as “Match local rules only”. Rules match the full
      # objective and enforce a tool allowlist. An empty list allows no tools.
      automationRules:
        - name: Text-only meeting summaries
          objectivePattern: "Summarize meeting notes: *"
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

Rules can also be created, edited, disabled, or deleted under `Agent Inbox → Settings → Local automation rules`. The legacy `safeObjectivePrefixes` compared only a string prefix while exposing an entire preset, so it could not form a real permission boundary. After upgrade it produces a migration warning and no longer grants automatic execution; migrate it to `automationRules` or interface-managed rules. The wire and database enum remains `SAFE` for compatibility with existing Peer configuration, but it now strictly means “match local rules”.

Prefer joining a Relay organization through a one-time invitation under `Agent Inbox → Organizations`; this avoids pairwise setup. Add a Direct Peer by selecting `Direct peer-to-peer` under `Agent Inbox → Settings`, or declare it in configuration. Both sides must pin the other's `nodeId`, Ed25519 public key, and reachable endpoint; each `nodeId` must match its public-key fingerprint.

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
        # RELAY is the default. Direct mode requires both sides to add the other.
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

A Node that receives Direct tasks must also enable its endpoint. `publicUrl` is canonical display and pairing metadata; it does not create DNS, TLS, port mapping, or a reverse proxy. The DSH Host WebServer still handles the actual request.

```yaml
- id: dsh-squad
  config:
    direct:
      enabled: true
      publicUrl: https://alice-agent.example.com
      retryIntervalMs: 5000
```

Production Direct URLs require HTTPS; HTTP is accepted only for `localhost` / loopback development. A reverse proxy needs to allowlist only `POST /squad/v1/direct/envelopes` and should enforce request-size, connection, and rate limits. Do not expose `/squad/v1/local/*` or the entire personal WebUI.

## Host a Relay

The same package can enable a Relay Server in any always-on DSH Node. Invitations are written to Relay SQLite when configuration loads and consumed once when a new Node enrolls.

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

The Relay API is registered under `/squad/v1` on the Host WebServer. It validates enrollment, request signatures, nonces, freshness, organization membership routes, sender and recipient identities, mailbox capacity, and rate limits. It stores the signed organization directory and durable mailbox, but neither runs an Agent nor holds private Sessions, HumanTodo details, workspaces, or member credentials. Its authenticated event stream carries only “mailbox changed” wakeups, never task bodies. Nodes retain polling fallback, so stream availability is not a reliability dependency. If the reverse proxy uses an exact route allowlist, v0.6 must additionally allow `GET /squad/v1/mailbox/events` for immediate wakeups; polling still works when that route is omitted.

A Node hosting Relay shows a loopback-only operations overview under `Agent Inbox → Settings → Connection diagnostics`: startup time, enrolled Nodes, live mailbox connections, durable backlog and its oldest item, organization and invitation counts, plus capacity and rate limits. These are Relay-local aggregates; the dashboard neither reads task bodies nor collects private runtime metrics from other Nodes.

## Safe updates for an always-on Relay

Starting with v0.5.0, Squad includes an Update Center and a separate `dsh-squad-update` executable. It updates Squad only—not DSH core or other plugins. The plugin process never overwrites itself: the WebUI checks releases, shows policy, and records explicit install requests, while a systemd-launched external updater stops the service, backs up, installs, restarts, checks health, and rolls back.

Each Node has three policies, editable under `Agent Inbox → Updates`:

- `NOTIFY`: check periodically and notify; installation requires explicit approval. This is the default.
- `AUTOMATIC`: back up and install while the Node is idle, then restart it.
- `DISABLED`: disable periodic checks and unattended installation; explicit manual checks remain available.

v0.5.0 itself must be installed manually; it provides self-update for later releases. First manage the Relay with an existing systemd service and configure one update-state directory shared by the plugin and updater:

```yaml
- id: dsh-squad
  config:
    updates:
      repository: zhouCode/dsh-squad
      stateDir: /srv/dsh-squad/relay-home/squad-updates
      defaultMode: NOTIFY
```

Then run the executable installed in that Relay profile to create an updater service, timer, and install-request path unit. Repeat `--data-path` for every Node and Relay data location that must be transactionally backed up. Never pass `/`, a home directory, or the whole `DSH_HOME` as a backup target.

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

The v0.5 safe updater accepts only `--scope user`, and the Relay service must run in the same dedicated account's user scope. An administrator should run `loginctl enable-linger <relay-user>` so the account starts with the server and stays active without an interactive login. System scope is intentionally unsupported because executing updater code from a user-writable DSH profile as root would cross a privilege boundary; containerized Relays should be updated through their image and orchestrator. The installer checks every six hours by default, with randomized delay to avoid synchronized GitHub requests. `Install verified update` in the WebUI creates a request handled immediately by the path unit.

The updater accepts only the configured repository's GitHub `latest` Release and requires four assets: the plugin `.tgz`, its `.tgz.sha256`, a signed update manifest, and the manifest's Ed25519 signature. A built-in public key verifies the manifest, which binds tag, version, package, filename, size, SHA-256, and minimum DSH version. Before installation, the updater confirms that there are no `TRIAGING` / `RUNNING` delegations or dispatching plans. After shutdown, it fully backs up the profile and every explicit data path, then installs the already verified local package with `pnpm --offline`. The restarted service must pass `/squad/v1/health` and report the target version or the old profile and data are restored. A failed version is not retried indefinitely without approval. The latest three backups are retained by default.

## Agent and WebUI

The plugin registers six native tools with the Personal Agent:

- `delegate_to_agent`: create a delegation by current organization member or direct Peer name, `nodeId`, or `membershipId`;
- `get_delegation_status`: read the public projection visible to the local Node;
- `list_squad_peers`: list current Session organization members, or direct Peers when no organization is selected;
- `propose_team_plan`: use Team Planner to create a local draft for owner review without dispatching it;
- `list_squad_organizations`: list this Node's organizations, roles, and membership states;
- `select_squad_organization`: switch the current Session to an explicitly requested organization or direct-Peer scope.

Users do not need to type those full tool names in chat. Squad provides two on-demand trigger styles without adding new buttons or a persistent launcher for these shortcuts:

- **Natural language or member mentions**: for example, “Give the release notes to Bob,” “`@Bob` summarize this week's changes,” “Turn these meeting notes into a team plan,” or “Check that delegation's progress.” The Agent asks for clarification when the recipient or objective is ambiguous.
- **English Slash commands under one prefix**: task commands are `/squad-task`, `/squad-plan`, `/squad-peers`, and `/squad-status`; organization commands are `/squad-orgs`, `/squad-org <name|id|direct>`, `/squad-members`, `/squad-invite [minutes]`, and `/squad-role <member> <admin|member>`. DSH discovers them in its native `/` menu, and the shared `squad-` prefix avoids collisions.

`Agent Inbox` provides `Plans`, `Waiting for me`, `Running`, `Sent`, `Completed`, `Organizations`, `Updates`, and `Settings`. Organization and update state refresh through server-sent events. Owner/Admin can approve, invite, and manage members, while each user can change the local `autoExecute` policy for every sender. Owners can also review, approve, retry, or cancel plans; recipients can process Todos, resume after restart, and open the associated native Session.

## Languages

The current version fully supports Simplified Chinese and English through DSH's official global locale service:

- With no explicit preference, a fresh WebUI follows the system language reported by the browser: `zh` variants use Simplified Chinese, `en` variants use English, and unsupported languages fall back to Simplified Chinese.
- Switch between `中文` and `English` under `Settings → General → Language`. The selection is persisted to `$DSH_HOME/settings.yaml`, and both Squad and the rest of DSH update immediately.
- Statuses, delivery progress, execution policies, known system summaries, error descriptions, dates, and accessibility labels are localized. User input, Agent-generated content, and protocol/signature fields retain their original text and stable identifiers.

Here, “system language” means the language reported by the browser displaying the WebUI. When a Windows browser opens DSH in WSL, Squad follows the Windows/browser language rather than WSL's `LANG`.

## Security boundary

- A Node generates and locally persists an Ed25519 identity on first startup. The database is bound to that identity and fails closed if its key or database is replaced inconsistently.
- Envelopes use strict Zod schemas, canonical bytes, and Ed25519 signatures. Reusing one ID with a different payload is a conflict.
- A signed organization root and append-only member directory are pinned and verified locally by every Node. Protocol-v2 Envelopes bind organization, sender membership, and recipient membership together.
- Relay mailbox requests use short-lived signatures, nonces for replay protection, and recipient isolation.
- The Direct endpoint accepts only signed protocol-v1 Envelopes from enabled pinned Peers. A sender marks `Received by peer Node` only after verifying a Node Receipt signed by the recipient's pinned public key. Trust is never granted merely from an IP address and port, and no shared password is used.
- `/squad/v1/local/*` management routes accept loopback clients only and reject forwarded requests. A public reverse proxy should allowlist only the exact non-`local` Relay routes.
- Update manifests are verified with the release public key pinned in the package. A downloaded package must match the signed filename, size, and SHA-256, and the plugin process has no authority to replace its own running code.
- Attachments require HTTPS, reject private, loopback, and rebinding addresses, and verify their declared size and SHA-256 digest.
- Remote objectives, context, and attachments always enter the recipient's native Agent as untrusted task data and cannot bypass DSH Permission/Approval.
- If a process stops during execution, Squad records `EXECUTION_INTERRUPTED` instead of guessing and replaying unknown external side effects.

The MVP Relay is a trusted content intermediary and does not provide end-to-end encryption. Production deployments still require TLS.

## Disable

Disable the entry in the profile patch and restart DSH:

```yaml
- id: dsh-squad
  disabled: true
```

The Squad Host route, Agent tools, and Client Slot are removed together. The native Harness Shell, Sessions, Settings, and workspace remain available.

If the external Relay updater was configured, permanently disabling the plugin should also stop its user timer and path units:

```bash
systemctl --user disable --now \
  dsh-squad-relay-updater.timer \
  dsh-squad-relay-updater.path
```

## Development and acceptance

```bash
pnpm verify:pins
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm smoke:delegation
```

Release maintainers must keep an offline backup of the release private key and never place it in the repository. `.gitignore` rejects `release-signing-key*.pem`; packaging and signing verify that the key is a regular owner-only file and matches the public key shipped in the package:

```bash
DSH_SQUAD_RELEASE_SIGNING_KEY=/secure/path/release-signing-key.pem \
  pnpm release:prepare
```

A `v0.7.0` GitHub Release must upload all four files from `artifacts/`: `dsh-squad-plugin-0.7.0.tgz`, its `.sha256`, `dsh-squad-update-manifest-0.7.0.json`, and its `.sig`. Clients reject an update when any asset is missing, the signature fails, or the Release tag does not match.

`smoke:delegation` builds a real tarball, installs it into isolated Alice, Bob, and Relay DSH homes, and uses real Chromium to verify WebUI pairing, Team Planner approval and idempotent dispatch, delivery while Bob is offline, Relay and Node restarts, a recipient-only Skill, partial HumanTodo completion, same-Session resume, Outcome privacy boundaries, and reversible plugin disablement. Signed-directory, Relay-authorization, and local-persistence integration tests separately cover organizations. Dedicated end-to-end tests cover Direct signed receipts, forged-receipt rejection, offline queueing, automatic retry after reconnect, and idempotent receipt.

## License

This project is available under the [MIT License](LICENSE). See [CHANGELOG.md](CHANGELOG.md) for release history.
