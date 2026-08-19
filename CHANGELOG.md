# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Delegation details now show a four-stage created/delivery/execution/result timeline and an explicit next actor, distinguishing local retry, Relay persistence, peer receipt, local human input, execution, and terminal outcomes.
- The Squad workbench now reports whether its local server-sent event stream is live, reconnecting, or stale, records the latest successful state read, and offers a `Sync now` action that runs a complete organization/outbox/mailbox/update pump before returning state.
- Delegation and Team Planner lists now paginate independently in batches of 25, preserve each tab's position, clamp safely when data shrinks, and jump to the page containing a delegation opened from a plan.
- Terminal delegations and fully dispatched or canceled plans can be moved into one reversible local archive. Archived failures leave attention counts, while records, results, plan items, and audit history remain intact and restorable.
- Team Planner now rolls up live execution state, result summaries, and published outputs for every dispatched item, with direct navigation to its full delegation record.
- Organization Owners and Admins can explicitly reject pending join requests; rejected applicants require a new one-time invitation before reapplying.
- Organization invitation history exposes active, used, expired, and revoked states without returning secret tokens or hashes, and managers can revoke unused invitations.
- Active Admins and Members can leave an organization with a self-signed directory event. Local Session contexts are cleared while membership history remains auditable; Owners must transfer ownership first.
- Two-party signed ownership transfer lets the current Owner propose and the target explicitly accept before Relay atomically establishes one new Owner and demotes the previous Owner to Admin. Proposals support cancellation, rejection, expiry, and stale-revision invalidation.
- Owners can rename organizations through an append-only signed metadata event that preserves the pinned root and auditable name history.
- Owners can irreversibly dissolve organizations through a signed terminal event. Relay closes invitations, pending joins, ownership proposals, and new protocol-v2 routing; Nodes clear Session context while retaining signed directories and task history for audit.

## [0.7.0] - 2026-08-19

### Added

- A bilingual first-run guide that configures the Node display name and selects either Relay or Direct mode without requiring users to edit `cordis.patch.yml`.
- A reusable `Team connection` settings form for validating and changing the persisted Node connection after onboarding.

### Changed

- Existing YAML deployments and upgraded Nodes with team data bypass onboarding. Interface-managed Node connection fields persist in the local SQLite database and are restored across restarts.

### Security

- Relay setup enrolls the Node and verifies signed mailbox access before saving. One-time enrollment invitations are bounded, used only for that request, and never stored in Node settings or returned through local state.
- Guided Relay and Direct origins accept HTTPS only, with loopback HTTP retained solely for local development. The setup API remains protected by the existing loopback and same-origin checks.

## [0.6.0] - 2026-08-19

### Added

- Two selectable task transports: the existing centralized Relay mailbox and a new Direct peer-to-peer transport configured independently for each pinned Peer.
- A Direct inbound Envelope endpoint and a signed Node Receipt. Senders mark a task as received only after the recipient has persisted it and the receipt verifies against that recipient's pinned Ed25519 public key.
- Durable sender-side Direct retry. An unreachable recipient leaves the original Envelope in the local SQLite outbox, restores retry after process restart, and delivers it without duplication once both Nodes are online and reachable.
- Transport-specific delivery states: `WAITING_FOR_PEER`, `STORED_BY_RELAY`, `RECEIVED_BY_NODE`, and `DELIVERY_EXPIRED`, with failed-attempt count, next-attempt time, and latest sanitized delivery error in the bilingual WebUI.
- Direct enablement, public endpoint metadata, retry interval, per-Peer transport, and per-Peer Direct URL configuration in the Host and WebUI.
- An authenticated Relay server-sent event stream that sends payload-free mailbox wakeups. Existing polling remains the reliability fallback.
- End-to-end tests for immediate Direct delivery, offline-to-online automatic retry, idempotent receipt, forged-receipt rejection, and Relay mailbox wakeups.

### Changed

- Relay success is now named `STORED_BY_RELAY` instead of the ambiguous `DELIVERED_TO_RELAY`; the version-6 SQLite migration updates existing records automatically.
- One unavailable Peer no longer prevents other ready outbox items from being attempted during the same transport pump.
- Concurrent wakeups are coalesced into another transport pump instead of being silently dropped.
- Signed organization directories and protocol-v2 organization routing remain Relay-backed in v0.6. Direct mode deliberately targets explicitly paired protocol-v1 Peers only.

### Security

- Direct receiving is disabled by default. Production Direct origins require HTTPS; loopback HTTP is accepted only for local development, and configured origins cannot contain credentials, paths, queries, or fragments.
- Direct requests do not trust an IP address, port, or shared password. The receiver accepts only signed Envelopes from enabled pinned Peers, and the sender validates the recipient identity, Envelope ID, recipient binding, and receipt signature.
- Direct mode adds no NAT traversal, public exposure automation, distributed store-and-forward, or decentralized organization consensus. Operators must provide a reachable HTTPS route and apply reverse-proxy connection and rate limits.
- Relay event notifications contain no Envelope payload and remain protected by the existing short-lived signed-request, nonce, enrollment, and rate-limit checks.

## [0.5.0] - 2026-08-19

### Added

- A bilingual `Updates` / `更新` center showing the running version, latest verified release, check time, update phase, external-updater readiness, and actionable diagnostics.
- Explicit per-Node `DISABLED`, `NOTIFY`, and `AUTOMATIC` update policies. `NOTIFY` is the default, and selecting unattended installation requires an explicit WebUI confirmation.
- A standalone `dsh-squad-update` executable shipped in the plugin package. The plugin process only checks and records requests; it cannot replace its own running files.
- A systemd installer that creates a separate one-shot updater service, persistent six-hour timer with randomized delay, and path trigger for user-approved install requests. v0.5 intentionally supports only unprivileged user services; linger keeps a dedicated Relay account running without an interactive login.
- Transactional Relay updates: fail-closed active-work and Node-identity checks before and after verified package staging, service shutdown, full profile and explicit data-path backup, offline pnpm installation, restart, target-version/identity health check, and rollback.
- Automatic suppression of a release that already failed and rolled back; retrying that exact release requires a new explicit install request.
- `/squad/v1/health`, returning only readiness and the running Squad version for local service supervision.
- Release tooling that creates a canonical signed manifest, detached Ed25519 signature, and SHA-256 asset for each plugin tarball.
- Unit and integration coverage for semantic version ordering, signature tamper rejection, GitHub asset binding, private state files, systemd units, successful update, and health-check rollback.

### Security

- A dedicated Ed25519 release public key is pinned in the plugin. The corresponding private key stays outside the repository with owner-only permissions.
- Update manifests bind the repository tag, package name, version, asset filename, byte size, SHA-256, signing-key ID, and minimum supported DSH version. GitHub metadata and download URLs are constrained to the configured repository and trusted GitHub release hosts.
- Update state uses an owner-only directory and atomic owner-only files. Local policy and install APIs retain the existing loopback and same-origin boundary.
- The updater rejects broad or overlapping backup targets, serializes execution with a private lock, defers while delegations or plans are active, keeps a recoverable copy of failed installation state, and retains a bounded number of backups.
- System-scope updater installation is rejected so root never executes updater code from a user-writable DSH profile.

## [0.4.0] - 2026-08-19

### Added

- Signed multi-organization directories with `Owner`, `Admin`, and `Member` roles. The creator is the sole Owner; Owners may appoint zero or more Admins, while every new participant starts as a Member.
- One-time organization invitations, signed join requests, Owner/Admin approval, member role changes, revocation, and Relay-side authorization of every directory mutation.
- Per-Session organization selection. One Node can belong to multiple organizations, while recipient resolution and protocol-v2 Delegations stay scoped to the organization selected for that DSH Session.
- Organization member discovery without pairwise Peer configuration; direct Peer mode remains available and protocol-v1 compatible.
- A real-time bilingual organization WebUI for Node identity, current Session scope, signed directory state, pending approvals, invitations, roles, member enablement, and local policy controls.
- Editable per-member and per-Peer `NEVER`, `SAFE`, and `TRUSTED` automatic-execution dropdowns, with an explicit local-execution warning for `TRUSTED`.
- Server-sent local state events, replacing the Agent Inbox's three-second polling loop.
- `list_squad_organizations` and `select_squad_organization` Agent tools, plus `/squad-orgs`, `/squad-org`, `/squad-members`, `/squad-invite`, and `/squad-role` commands.
- A version-5 local SQLite migration for signed organization roots/events, member projections, hidden organization-only Node identities, local member policies, pending requests, and Session organization bindings.
- A local Team Planner workflow that turns meeting notes or a team objective into a persistent delegation-plan draft for owner review.
- `propose_team_plan` and `list_squad_peers` Agent tools. Proposals never dispatch work by themselves.
- A bilingual `Plans` / `分派计划` WebUI for reviewing every recipient, objective, context, acceptance criterion, and attachment before approval.
- Idempotent batch dispatch with stable per-item Delegation IDs, partial-failure reporting, retry, cancellation of remaining items, and restart recovery.
- Local plan creation, approval, retry, and cancellation endpoints for future connector integrations.
- Namespaced `/squad-plan`, `/squad-task`, `/squad-peers`, and `/squad-status` commands through DSH's native on-demand Slash Command surface, with no additional buttons or persistent launcher.
- Bilingual natural-language and `@member` trigger guidance for planning, delegation, Peer discovery, and status checks, including explicit clarification instead of guessing ambiguous recipients.

### Changed

- The existing local planning feature is now consistently named **Team Planner**. It creates reviewable drafts and is distinct from a future optional Organization Coordinator Agent.
- `list_squad_peers`, `delegate_to_agent`, and Team Planner now resolve recipients from the current Session organization, falling back to direct Peers when no organization is selected.

### Fixed

- `/squad-peers` now publishes its bilingual result as a durable Squad notice, so member names are visible even when the command is invoked from a blank new Session, without waking the model.

### Security

- Protocol-v2 envelopes bind organization, sender membership, and recipient membership. Relay and recipient both reject missing, mismatched, disabled, or cross-organization membership routes.
- Relay Node discovery now returns only the authenticated Node and active co-members from a shared organization, rather than exposing every enrolled Node across unrelated organizations.
- `/squad/v1/local/*` management and state endpoints now reject non-loopback clients and forwarded requests; only the signed Relay routes are intended for network exposure.
- Organization roots are signed by a dedicated local authority key; the append-only member event chain is verified and pinned locally, including revision continuity, issuer role, public-key identity, and exactly one active Owner.
- Admin authority is deliberately narrower than Owner authority: Admins may approve/invite and manage ordinary Members, but only the Owner may appoint or demote Admins. Owner transfer is not implemented in directory v1.
- The future Organization Coordinator boundary is explicitly non-sovereign: no inherited member credentials, workspaces, Sessions, or blanket execution authority.
- Team-plan approval re-checks the current pinned Peer and delegation policy before creating each signed Delegation.
- Remote execution remains subject to the recipient's independent PeerPolicy and DSH Permission/Approval boundary after local plan approval.

## [0.2.0] - 2026-08-16

### Added

- A native DeepSeek Harness plugin for durable delegation between independently owned Personal Agents.
- Signed Agent-to-Agent envelopes transported through an optional persistent Relay mailbox.
- One-time Relay enrollment invitations, Ed25519 Node identities, pinned Peer public keys, and replay-resistant authenticated mailbox requests.
- Per-Peer messaging, delegation, concurrency, depth, runtime, token, and `NEVER`/`SAFE`/`TRUSTED` automatic-execution policies.
- Native `delegate_to_agent` and `get_delegation_status` Agent tools.
- Native DSH Session execution, recipient-local Skills and tools, HumanTodo handling, and same-Session resume after human input or restart.
- `Agent Inbox` / `智能体收件箱` WebUI for incoming, running, sent, completed, and settings views.
- First-class Simplified Chinese and English localization following DSH's global browser-language preference.
- Validated HTTPS attachment references with declared size and SHA-256 checks.
- A self-contained plugin tarball bundling its `zod` runtime dependency for installation with `dsh plugin add --offline` on a clean machine.
- SQLite-backed local state, idempotent at-least-once delivery, cancellation, retry, and interruption handling.
- A real three-Node Chromium smoke test covering pairing, offline delivery, restarts, HumanTodo resume, privacy boundaries, and reversible disablement.

### Security

- Remote objectives and context remain untrusted task data and cannot grant remote Shell, Skill, MCP, credential, or permission access.
- Receiver Session IDs, HumanTodo details, human responses, credentials, and workspace paths remain local to the recipient Node.
- Production Relay URLs require HTTPS; loopback HTTP is accepted only for local development.
- The Relay is explicitly documented as a trusted content intermediary without end-to-end payload encryption.

[Unreleased]: https://github.com/zhouCode/dsh-squad/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/zhouCode/dsh-squad/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/zhouCode/dsh-squad/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/zhouCode/dsh-squad/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/zhouCode/dsh-squad/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/zhouCode/dsh-squad/releases/tag/v0.2.0
