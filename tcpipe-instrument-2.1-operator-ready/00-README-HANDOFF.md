# Training-centre parsing instrument — handoff 2.2.1

Bundle 2.1 turns the accepted 2.0 restructure into an executable foundation. It is an
internal parsing and governed-data instrument, not a user-facing product.

2.1.1 corrected six defects found by auditing the claims against behaviour
(`CORRECTIONS-2.1.1.md`). 2.2.0 built the tier-1 acquisition, parsing and materialization
gates that were previously specified but unbuilt. 2.2.1 hardens the queue lifecycle and
adds a bounded OpenClaw operating surface — start at `LAUNCH-TIER-1.md`.

For day-to-day instructions, oversight and manual corrections, start with
`OPERATOR-GUIDE.md` and run `./tcpipe --help`. To take the pilot live, follow
`LAUNCH-TIER-1.md`. To install it somewhere, follow `DEPLOYMENT.md`.
To hand operation to an OpenClaw agent, follow `openclaw/INSTALL.md`.

The schema, JSON contracts, seeds and adapter rules live in `src/tcpipe/data/` and ship
inside the wheel, so an installed `tcpipe` behaves identically to one run from a checkout.

## Authority order

1. `FOUNDATION-2.1.md` and executable tests describe the current foundation.
2. `LAUNCH-TIER-1.md` states what is built, what still gates launch, and what only you can do.
3. `CORRECTIONS-2.1.1.md` records what 2.1.1 changed and why.
4. `ADDENDUM-2.0-restructure.md` explains the restructuring decision.
5. Amendments A1–A3 still govern recovery evidence and SQLite foreign keys.
6. V3 Parts 4, 7, 12 and 13 remain historical where they conflict with 2.1.
7. `AGENT.md` is a historical design artifact. `AGENTS.md`, `bin/tcpipe-agent` and the
   database constraints form the current OpenClaw operating boundary.

## Verify

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 scripts/verify_bundle.py
```

To create a fresh isolated pilot database:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src \
  python3 scripts/bootstrap.py --db /absolute/path/to/pilot.db
```

To reproduce the legacy audit against the supplied V2 evidence pack:

```bash
python3 audit_referential_integrity.py /absolute/path/to/v2-pack
```

Expected finding-set hash:
`bd8d706fa67b7b38f3c5e249dbe0a3496e220466ded85f08fd8cc91f4cefeba9`.

## Implemented in 2.1

- Versioned source and route universe with both route and expected-volume coverage, which
  reports how many eligible routes have no expected-record figure.
- Legal/purpose/retention policy state required before route fetches.
- Immutable source/route policy reviews pinned to frozen universes and fetch attempts.
- Atomic job queue with mission foreign keys, idempotency keys and expiring worker leases.
- Immutable, atomic, content-addressed artifact store.
- Multiple artifact roles per fetch attempt, including DOM and screenshot.
- Replay-safe 304 handling through an explicit reused-body artifact.
- Route-run and parse-run boundaries with exact fetch/input links and artifact-set hashes.
- Source records and append-only field observations with per-field evidence.
- Pure versioned terminal-state calculator; no mutable `route.route_state`.
- Fetch-derived freshness: the writer and both operational views age a run from the latest
  linked fetch, never from finalization, and demote after two refetch windows.
- Evidence-derived audit, fixture, field-health, empty-result and corroboration gates; an
  empty result must be corroborated by a prior run that actually reached the route.
- Append-only manual corrections with separate approval and supersession history.
- Replay-gated exact-match feedback rules, scoped route → template → global.
- Source-scoped provider identifiers and materialization lineage.
- Enforced adapter fixtures and honest fallback declarations.
- Deterministic fetch rate-limit/circuit-breaker policy.
- Strict legacy audit whose exit status includes dangling references and counter errors.
- Automated unit/integration tests and a self-verifying manifest.

## Added in 2.2 (tier 1 executable)

- HTTP transport driving the existing politeness and conditional-request policy, storing
  content-addressed artifacts and recording governed fetch attempts (G3).
- Adapter-rules interpreter covering all eight selector strategies, pagination, explicit
  count semantics and encoding detection; fallback selectors extract but quarantine the
  run rather than silently absorbing template drift (G4).
- Five archetype adapters — download, JSON API, paginated HTML, PDF and client-rendered —
  each parsing a golden artifact and reconciling its independent counts. Fixtures are
  synthetic until G2 permits a real fetch; see `FIXTURES.md`.
- Deterministic resolver ranking official provider id over domain over name, with merge
  blockers that route ambiguity to human review instead of guessing (G5a).
- Materializer that writes no governed field without `materialization_lineage` back to the
  exact observation, reading through accepted corrections (G5b).
- Clopper–Pearson audit bound and deterministic stratified sampling, so the 0.95
  completion gate reflects a real sample rather than an asserted number.
- `./tcpipe fetch` and `./tcpipe run` — the operator path from URL to governed entities.
- Package/bundle data model, so tier-2 pricing has somewhere to land without a migration.

## Added in 2.2.1 (operator-ready)

- Exact named job claims for interactive fetches, preventing an existing queue backlog from
  stealing the acquisition lease.
- `readiness` reports per-route policy, robots, fixture and due-state blockers; `recover`
  safely requeues expired work or terminalizes exhausted leases.
- OpenClaw workspace context, operations skill, guarded command wrapper, idempotent agent
  setup and optional oversight automations.
- Independent gates for network access, database writes, human approval decisions and audit
  attestations; arbitrary paths, URLs, rule files and execution identities are blocked.
- Reproducible, checksummed export build and verification of the agent-facing controls.

## Deliberately not claimed complete

No **real** golden fixtures, egress-proxy deployment, legacy recovery ledger, installed live
fetch schedule, backup rehearsal, telemetry, or production merge has been completed. The five pilot routes
remain candidates with policy/legal review pending, and the shipped adapters are selector
hypotheses verified only against synthetic artifacts — the live pages will differ. No
tier-2 (centre-website) acquisition exists, so prices and bundle packages are modelled but
not collected. See `LAUNCH-TIER-1.md` and `FOUNDATION-2.1.md` for the exact gates.
