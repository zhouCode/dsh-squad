# DSH Squad

[简体中文](README.md) | [English](README.en.md)

> Let personal Agents become a team without giving up workspaces, credentials, or control.

DSH Squad turns personal Agents running on different computers, networks, and locations into a durable team that can delegate work, receive tasks while offline, and continue collaborating—while every person remains the owner and operator of their own Agent. Members expose no personal-node ports and share no accounts, API keys, workspace access, or tool permissions. Agents exchange signed tasks and deliberately published outcomes through a Relay, while execution stays inside the recipient's own DSH, native Session, Skills, credentials, and approval boundary.

## Highlights

- **Locally coordinated, individually controlled**: Team Coordinator can turn a meeting or team objective into a multi-person delegation draft, but it is not a shared super-Agent holding everyone's authority. The coordinator's owner must approve dispatch, and every recipient still decides execution through their own policy and approval boundary.
- **Cross-location without direct node connectivity**: personal nodes only need an outbound connection to an always-on Relay, so they can sit behind NAT, home networks, corporate networks, or national borders without public IP addresses or inbound ports.
- **Offline members do not lose work**: the Relay provides an authenticated, durable mailbox. A recipient resumes pulling after reconnecting, and duplicate delivery cannot create duplicate Sessions or executions.
- **Trust is configured per person**: every Peer has its own pinned public key, enabled state, delegation permissions, concurrency limits, and `NEVER`, `SAFE`, or `TRUSTED` automatic-execution policy.
- **Native to DSH**: work runs in the recipient's existing Agent, Session, Skill catalog, tools, and Permission/Approval flow, without a second runtime or standalone management platform.

## How it works

```text
Alice Agent --signed Delegation--> durable Relay mailbox --> Bob's DSH
                                                             |
                                            Bob Personal Agent + local Skill
                                                             |
                                  automatic result --> explicit Outcome
                                  owner needed     --> HumanTodo --> resume same Session
```

- The sender submits only an objective, context, acceptance criteria, and validated HTTPS attachment references.
- The recipient's PeerPolicy decides whether to reject, wait for owner acceptance, or execute automatically.
- The recipient Agent chooses its own local Skills and tools. The protocol has no remote Skill, Shell, MCP, or Credential field.
- The Relay is only an authenticated, at-least-once mailbox. Receiver-side SQLite, Envelope IDs, and Delegation IDs prevent duplicate delivery from causing duplicate execution.
- HumanTodo details, native Session IDs, human responses, credentials, and workspaces remain on the recipient node.
- The sender sees only the status, summary, and Outcome that the recipient explicitly publishes.

Use native DSH Sub-agents for parallel decomposition within one person's DSH. Use Squad when work crosses into a Personal Agent owned by another person.

## Team Coordinator: review before dispatch

The local Agent can inspect currently paired members and turn meeting notes or a team objective into a persistent delegation-plan draft. Draft creation performs no network request or remote execution. The owner reviews every recipient, objective, context, acceptance criterion, and attachment under `Agent Inbox → Plans`, then selects `Approve and dispatch`.

A typical prompt is:

> Use `list_squad_peers` to inspect available members, then turn these meeting decisions into a team delegation plan. Create a draft only; do not delegate directly: …

The Agent calls `propose_team_plan`. Only owner approval creates one signed Delegation from the existing protocol per plan item. Every item receives its final Delegation ID when the draft is created, so a lost approval response, process restart, or partial-failure retry cannot create duplicate assignments. Sender-side approval is not recipient authorization: the receiver may still reject, require local acceptance, or execute under its own `SAFE` / `TRUSTED` policy.

The same local Plan API is available for future connectors such as Feishu/Lark to create drafts or read status projections. The current Unreleased version does not include a Feishu/Lark connector and never executes work merely because an external board was edited.

## Typical deployment: a cross-location team

```text
Beijing: Alice's computer ──outbound HTTPS──┐
                                            │
Shanghai: Bob's computer   ──outbound HTTPS──┼── public or corporate Relay
                                            │
Overseas: Carol's computer ─outbound HTTPS──┘
```

This is an application-layer Agent collaboration network, not a VPN: it does not place member computers on one virtual LAN or require nodes to reach one another by IP. A personal node's WebUI should listen only on `127.0.0.1`. Expose only the Relay, protected by HTTPS, an exact route allowlist, and firewall rules.

## Installation

Pinned runtime baseline: Node.js `24.18.0`, pnpm `10.28.2`, DeepSeek Harness `0.1.0-rc.6`, and Cordis `4.0.1`.

This repository publishes only `@dsh-squad/plugin`. It contains no standalone SPA, second runtime CLI, or Docker orchestration. Docker is an optional isolation mechanism, not a runtime requirement.

Build and install the tarball from this repository:

```bash
pnpm install --frozen-lockfile
pnpm run pack
dsh plugin --profile web add ./artifacts/dsh-squad-plugin-0.2.0.tgz --offline
dsh web
```

The bundled `cordis.patch.yml` mounts both the Host Plugin and Web Client Module. After startup, `Agent Inbox` appears in the native DSH sidebar (`智能体收件箱` in Chinese). Its Settings view shows the Node's Ed25519 identity and manages Peers, pinned public keys, and local policies.

## Configure a Node

Override the `dsh-squad` configuration in `$DSH_HOME/profiles/web/cordis.patch.yml`. Production Relay URLs must use HTTPS; loopback HTTP is allowed only for local development.

```yaml
- id: dsh-squad
  config:
    displayName: Alice Personal Agent
    pollIntervalMs: 5000
    envelopeTtlMinutes: 60
    execution:
      cwd: /absolute/path/to/alice-workspace
      # SAFE automatically runs only objectives beginning with these prefixes.
      # Uncertain objectives wait for owner acceptance.
      safeObjectivePrefixes:
        - summarize
        - analyze
    relay:
      url: https://relay.example.com
      invitation: replace-with-one-time-invitation
```

Add a Peer in `Agent Inbox → Settings` (`智能体收件箱 → 设置` in Chinese), or declare it in configuration. The `nodeId` must match the Ed25519 public-key fingerprint.

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

The Relay API is registered under `/squad/v1` on the Host WebServer. It validates enrollment, request signatures, nonces, freshness, sender and recipient identities, mailbox capacity, and rate limits. It neither runs an Agent nor stores private Sessions or HumanTodo details.

## Agent and WebUI

The plugin registers four native tools with the Personal Agent:

- `delegate_to_agent`: create a delegation by Peer display name or stable `nodeId`;
- `get_delegation_status`: read the public projection visible to the local Node;
- `list_squad_peers`: list locally paired members and current delegation availability;
- `propose_team_plan`: create a local draft for owner review without dispatching it.

`Agent Inbox` provides `Plans`, `Waiting for me`, `Running`, `Sent`, `Completed`, and `Settings` views. An owner can review, approve, retry, or cancel a plan's remaining items. A recipient can select one or more Todos, submit text or SHA-256/size-validated attachment references, continue after restart, and open the associated native DSH Session.

## Languages

The current version fully supports Simplified Chinese and English through DSH's official global locale service:

- With no explicit preference, a fresh WebUI follows the system language reported by the browser: `zh` variants use Simplified Chinese, `en` variants use English, and unsupported languages fall back to Simplified Chinese.
- Switch between `中文` and `English` under `Settings → General → Language`. The selection is persisted to `$DSH_HOME/settings.yaml`, and both Squad and the rest of DSH update immediately.
- Statuses, delivery progress, execution policies, known system summaries, error descriptions, dates, and accessibility labels are localized. User input, Agent-generated content, and protocol/signature fields retain their original text and stable identifiers.

Here, “system language” means the language reported by the browser displaying the WebUI. When a Windows browser opens DSH in WSL, Squad follows the Windows/browser language rather than WSL's `LANG`.

## Security boundary

- A Node generates and locally persists an Ed25519 identity on first startup. The database is bound to that identity and fails closed if its key or database is replaced inconsistently.
- Envelopes use strict Zod schemas, canonical bytes, and Ed25519 signatures. Reusing one ID with a different payload is a conflict.
- Relay mailbox requests use short-lived signatures, nonces for replay protection, and recipient isolation.
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

## Development and acceptance

```bash
pnpm verify:pins
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm smoke:delegation
```

`smoke:delegation` builds a real tarball, installs it into isolated Alice, Bob, and Relay DSH homes, and uses real Chromium to verify WebUI pairing, Coordinator draft approval and idempotent dispatch, delivery while Bob is offline, Relay and Node restarts, a recipient-only Skill, partial HumanTodo completion, same-Session resume, Outcome privacy boundaries, and reversible plugin disablement.

## License

This project is available under the [MIT License](LICENSE). See [CHANGELOG.md](CHANGELOG.md) for release history.
