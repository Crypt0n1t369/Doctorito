# Foundation 2.1 — logic, controls and remaining gates

## Purpose

Produce fresh, replayable and field-evidenced training-centre data across heterogeneous
official sources. Success is measured by route coverage, expected-volume coverage, verified
field yield, freshness, replay stability and declining human intervention.

## Current data flow

```
versioned universe + source policy
  → queued job → policy/robots gate → fetch attempt → immutable artifacts
  → route run → parse run → source records → field observations
  → validation/review → deterministic resolution → governed materialization
  → lineage-backed exports and SQL-defined coverage
```

The legacy recovery track and parsing-capability track may run in parallel. Production
materialization opens only after both have independently passed.

## Executable guarantees

- A job cannot reference a nonexistent mission.
- SQLite queue claims serialize with `BEGIN IMMEDIATE` and are idempotent.
- Worker leases heartbeat, expire and requeue; exhausted jobs fail deterministically.
- A route cannot activate an adapter version without a passing fixture.
- Artifact metadata, source records, field observations and job events are append-only.
- One fetch attempt can bind multiple role-labelled artifacts.
- A 304 references the exact prior body it revalidated rather than minting a duplicate.
- A target fetch pins immutable legal/route policy reviews and a robots artifact.
- A successful route run cannot finalize before its exact fetch artifacts and parse are sealed.
- Every materialized field can link to one or more exact field observations.
- Manual corrections overlay immutable observations and require a separate decision.
- Broader correction patterns require fixture replay, before/after projection hashes and
  explicit review before they can affect future exact matches.
- Terminal state is computed from one route run; direct route-state mutation is impossible.
- Freshness is derived from linked fetch time — in the writer and in both operational views
  — and expired completions are excluded from coverage. A run with no linked fetch has no
  freshness evidence and is demoted rather than trusted.
- Completion requires a passing stored audit, real fixture, no blocking field-health result,
  fresh content and reconciled/corroborated counts. A sampled audit's stored
  `accuracy_lower_cp` must not exceed the accuracy observed in its own sample.
- The terminal calculator rejects enumerated inputs it does not recognise rather than
  falling through to a completion verdict.
- Empty completion requires a prior empty run at least 24 hours earlier plus deterministic
  evidence; an oracle can veto but cannot establish emptiness. The prior run must itself be
  a real observation — reachable, fresh, parser-healthy, with no published count claiming
  rows — because absence of access is not evidence of absence of rows.
- Official provider identifiers are scoped to their issuing source.
- Default contact export excludes personal data.

## Remaining implementation gates

### G1 — Legacy integrity

Execute the existing snapshot/recovery runbook against a copy, adjudicate 2,035 IDs, resolve
834 counter disagreements, and record an independent verification. The 2.1 audit reproduces
the expected 6,990 findings but does not itself repair data.

### G2 — Freeze the source universe

The five-archetype seed is intentionally `draft`/`candidate`. Before freezing it:

1. Review terms, permitted purpose, retention and data categories for every source.
2. Fetch and store current robots artifacts.
3. Confirm official routes and prefer downloads/APIs over presentation-layer parsing.
4. Re-measure expected records and record the basis/as-of time.
5. Mark explicit exclusions with evidence.

Record each decision as a new immutable `source_policy_review` / `route_policy_review`; do
not overwrite an earlier approval. Eligible universe rows pin the review IDs they were
frozen under.

### G3 — Transport and proxy — BUILT (deployment outstanding)

`transport.py` implements the transport over `fetch_policy.py`, conditional headers, the
artifact store and the fetch tables, including replay-safe 304 handling. In production, prevent proxy bypass with an OS network namespace or
firewall; importing a rate-limiter library alone does not enforce egress.

### G4 — Adapter interpreter and five fixtures — INTERPRETER BUILT, REAL FIXTURES OUTSTANDING

`adapter.py` implements adapter rules 2.1: it emits field observations only, and any
fallback-selector hit quarantines the parse. Five archetype adapters ship in `adapters/`.
Their golden artifacts are synthetic and their `fixtures` entries are placeholders —
real pairs require an approved fetch under G2. See `FIXTURES.md`.

### G5 — Resolution and materialization — BUILT (benchmark outstanding)

`resolver.py` implements deterministic key normalization and merge blockers;
`materializer.py` refuses to commit without `materialization_lineage` for every governed
field. A labelled resolver benchmark against real cross-source data is still outstanding.
LLM output remains review-only.

### G6 — Replay and scale

Add canonical projection hashing, adapter version-diff replay, bounded worker concurrency,
invariant scheduling, backup/restore rehearsal and operational telemetry. Define measured
thresholds for moving from SQLite to Postgres; likely triggers are sustained writer queue
latency, multi-host writer requirements, or high-availability needs—not row count alone.

## Required pilot acceptance

- Five archetypes complete from stored artifacts in an isolated database.
- Re-running unchanged artifacts creates no duplicate artifacts or field observations.
- Every output field has artifact, locator and evidence.
- Route and volume coverage are both reported; null expected counts are visible as
  `eligible_routes_missing_expected_records`.
- A deliberate schema change quarantines the affected route.
- A version that drops rows is rejected without recorded justification.
- Full replay produces the same canonical projection and invariant results.
- Human minutes, fetch bytes, latency, 4xx/429 rate and verified-field yield are measured.
