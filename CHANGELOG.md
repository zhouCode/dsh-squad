# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-08-17

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

### Changed

- The existing local planning feature is now consistently named **Team Planner**. It creates reviewable drafts and is distinct from a future optional Organization Coordinator Agent.
- `list_squad_peers`, `delegate_to_agent`, and Team Planner now resolve recipients from the current Session organization, falling back to direct Peers when no organization is selected.

### Security

- Protocol-v2 envelopes bind organization, sender membership, and recipient membership. Relay and recipient both reject missing, mismatched, disabled, or cross-organization membership routes.
- Relay Node discovery now returns only the authenticated Node and active co-members from a shared organization, rather than exposing every enrolled Node across unrelated organizations.
- `/squad/v1/local/*` management and state endpoints now reject non-loopback clients and forwarded requests; only the signed Relay routes are intended for network exposure.
- Organization roots are signed by a dedicated local authority key; the append-only member event chain is verified and pinned locally, including revision continuity, issuer role, public-key identity, and exactly one active Owner.
- Admin authority is deliberately narrower than Owner authority: Admins may approve/invite and manage ordinary Members, but only the Owner may appoint or demote Admins. Owner transfer is not implemented in directory v1.
- The future Organization Coordinator boundary is explicitly non-sovereign: no inherited member credentials, workspaces, Sessions, or blanket execution authority.

## [0.3.0] - 2026-08-17

### Added

- A local Team Planner workflow that turns meeting notes or a team objective into a persistent delegation-plan draft for owner review.
- `propose_team_plan` and `list_squad_peers` Agent tools. Proposals never dispatch work by themselves.
- A bilingual `Plans` / `分派计划` WebUI for reviewing every recipient, objective, context, acceptance criterion, and attachment before approval.
- Idempotent batch dispatch with stable per-item Delegation IDs, partial-failure reporting, retry, cancellation of remaining items, and restart recovery.
- Local plan creation, approval, retry, and cancellation endpoints for future connector integrations.
- Namespaced `/squad-plan`, `/squad-task`, `/squad-peers`, and `/squad-status` commands through DSH's native on-demand Slash Command surface, with no additional buttons or persistent launcher.
- Bilingual natural-language and `@member` trigger guidance for planning, delegation, Peer discovery, and status checks, including explicit clarification instead of guessing ambiguous recipients.

### Fixed

- `/squad-peers` now publishes its bilingual result as a durable Squad notice, so member names are visible even when the command is invoked from a blank new Session, without waking the model.

### Security

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

[Unreleased]: https://github.com/zhouCode/dsh-squad/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/zhouCode/dsh-squad/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/zhouCode/dsh-squad/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/zhouCode/dsh-squad/releases/tag/v0.2.0
