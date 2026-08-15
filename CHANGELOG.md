# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- SQLite-backed local state, idempotent at-least-once delivery, cancellation, retry, and interruption handling.
- A real three-Node Chromium smoke test covering pairing, offline delivery, restarts, HumanTodo resume, privacy boundaries, and reversible disablement.

### Security

- Remote objectives and context remain untrusted task data and cannot grant remote Shell, Skill, MCP, credential, or permission access.
- Receiver Session IDs, HumanTodo details, human responses, credentials, and workspace paths remain local to the recipient Node.
- Production Relay URLs require HTTPS; loopback HTTP is accepted only for local development.
- The Relay is explicitly documented as a trusted content intermediary without end-to-end payload encryption.

[Unreleased]: https://github.com/zhouCode/dsh-squad/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/zhouCode/dsh-squad/releases/tag/v0.2.0
