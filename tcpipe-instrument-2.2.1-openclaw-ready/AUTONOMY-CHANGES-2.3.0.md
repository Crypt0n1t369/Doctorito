# Autonomous-operation boundary — 2.3.0

This release changes only restrictions that prevented an operating agent from maintaining
tcpipe and operating ordinary public sources. The parser architecture, governed entities,
adapter format, correction workflow, artifact store and operator command style are intact.

## Restrictions removed

| Previous restriction | 2.3.0 replacement |
|---|---|
| Agent could not edit workspace files | Source, tests, adapters, project docs and configuration may be edited inside the workspace; OpenClaw patching is workspace-only. |
| No dependency/bootstrap command | `tcpipe-agent deps` creates `.venv` and installs this project plus declared extras from the public PyPI index; `bootstrap` installs, initializes/migrates and preflights. |
| No migration capability | `tcpipe-agent migrate` applies the trusted 2.2→2.3 upgrade and checksummed project migrations. Agent-authored migrations accept only additive SQL. |
| Tests/fixtures unavailable to agent | `test`, `fixtures`, and deterministic `adapter-fixture` replay are exposed. |
| Adapter activation required out-of-band database edits | `adapter-activate` updates a route only when an immutable passing fixture exists for the exact adapter version; the existing database trigger remains authoritative. |
| Every source/robots decision required a human | `public-preflight` may create append-only approvals only for `access_class=public`, non-human-capture routes with stored robots evidence and no sensitive classification. |
| Network disabled by default and proxy mandatory | Guarded public fetching is enabled. A proxy is optional locally and can be required for network-confined deployments. URL/proxy/user-agent overrides remain blocked at the agent boundary. |
| Fixed 24-hour retry suspension | Ordinary transient failures use persisted exponential backoff and honor the greater `Retry-After`; they do not demand repetitive approval. |
| First fetch required an already active adapter | Acquisition may collect an immutable fixture artifact before adapter activation; parsing still requires an exact active, fixture-passing adapter. |

## Restrictions retained

Human approval or intervention remains mandatory for authenticated, private, sensitive or
`human_required` sources; existing human rejections or sensitive classifications; robots
401/403 ambiguity and explicit prohibitions; CAPTCHA/login/paywall/access-control barriers;
sensitive-data handling; destructive migrations/files/database/infrastructure work;
credentials, private indexes and external-account/permission changes; audit error-count
attestations; correction decisions; and learned-rule promotion.

Human approval never authorizes robots, CAPTCHA, access-control, or rate-limit bypass.
Arbitrary shell, direct SQLite mutation, agent-selected paths/URLs/rules/proxies/crawler
identity, external state and audit-count flags remain unavailable through `tcpipe-agent`.

## Protections retained and strengthened

- Robots decisions are stored as immutable artifacts and pinned to append-only reviews and
  fetch attempts. Explicit Disallow is recorded as rejected and cannot enter the automated
  approval path.
- Every request uses a transparent configured crawler identity. Public mode rejects URL
  credentials, non-HTTP schemes, private/reserved/loopback/link-local destinations and
  redirects to them.
- The transport enforces a per-domain minimum delay and the greater robots crawl delay.
  `Retry-After`, exponential backoff, repeated-403 stop states and detected access barriers
  persist in `host_state`.
- Stealth, identity impersonation, proxy rotation, CAPTCHA solving, access bypass and
  rate-limit evasion remain forbidden.
- Operator output redacts URL userinfo and named secret fields. Wrapper arguments cannot
  override credentials, proxy, crawler identity, governed paths or network targets.
- Source and error/challenge response bodies remain content-addressed, immutable evidence.
  Successful extraction still requires artifact locators/quotes and materialization lineage.
- Jobs retain leases, idempotency, recovery and persisted state; processing remains
  resumable and 304 responses reuse the exact prior body.

## Enforcement locations

- Authority and operating behavior: `AGENTS.md`, `skills/tcpipe-operations/SKILL.md`.
- Agent capabilities: `openclaw/agent-policy.conf`, `bin/tcpipe-agent`,
  `openclaw/setup-openclaw.sh`.
- Public decision boundary: `src/tcpipe/public_policy.py` plus
  `automated_*_policy_review_guard` and `fetch_attempt_policy_guard` in `schema.sql`.
- Egress, throttling and recovery: `src/tcpipe/transport.py`,
  `src/tcpipe/fetch_policy.py`, and `host_state`.
- Migration/adapter gates: `src/tcpipe/migrations.py`, `schema_migration`, immutable adapter
  fixtures and the existing `route_adapter_fixture_*` triggers.
- Regression proof: `tests/test_public_policy.py`, `tests/test_migrations.py`,
  `tests/test_transport.py`, `tests/test_agent_wrapper.py`, and end-to-end pipeline tests.
