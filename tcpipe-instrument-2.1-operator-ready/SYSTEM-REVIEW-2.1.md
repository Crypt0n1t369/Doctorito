# System review 2.1 — comprehensive parsing instrument

## Judgment

The incoming 2.0 bundle contained the right restructuring decision but was still primarily
a specification. It could not operate a parser fleet or make defensible completeness
claims. The correct target is not a user-facing product: it is an internal instrument that
acquires heterogeneous official data, preserves exact evidence, measures what it did and
did not cover, and only then materializes governed records.

The 2.1 changes establish that executable foundation. They do not pretend that source-
specific parsing has happened. Real source approvals, artifacts, fixtures, adapters and
legacy repairs remain evidence-producing operations and cannot safely be fabricated in a
generic handoff.

Six defects in the 2.1.0 implementation of the dispositions below were found by testing
each claim against a live database, and corrected in 2.1.1; `CORRECTIONS-2.1.1.md` records
them. Notably the "fetch-derived freshness" row was true of the writer but not of the views
that operators and coverage actually read.

## Gap disposition

| Incoming gap | Operational consequence | 2.1 disposition |
|---|---|---|
| No executable denominator | “Comprehensive” had no measurable meaning | Versioned source/route universe, freeze gate, route and expected-volume coverage |
| Mutable policy flags | A later edit could rewrite why an earlier fetch was allowed | Immutable source/route reviews pinned to universes and fetch attempts |
| Queue without crash recovery | One dead worker could strand work forever | Atomic claims, idempotency, heartbeats, expiring leases and bounded retries |
| One artifact per fetch | Tier 2 and replay evidence were lossy | Role-labelled artifact sets; DOM+screenshot; explicit 304 reused body |
| No enforceable run boundary | Counts and outcomes could mix across attempts | Fetch → route-run → parse-run links and canonical artifact-set hash |
| Flat observations | Provenance was lost below the row level | Source records plus immutable per-field raw/normalized values, locators and quotes |
| Defective terminal logic | False completion and unreachable states | Pure versioned calculator plus DB-derived fixture, audit, health and corroboration inputs |
| Freshness stored as a permanent claim | Old success continued inflating coverage | Fetch-derived freshness and dynamic stale demotion after two refetch windows |
| Editable audit evidence | Historical decisions could be changed in place | Append-only audit, health, corroboration, empty-result and oracle evidence |
| Weak adapter contract | Drift and silent fallback could look successful | Required fixtures, explicit fallback policy and immutable adapter versions |
| Unsafe legacy gate | Missing inputs and counter defects could pass | Fatal input validation and complete finding-set hashing; counter defects affect exit status |
| Materialization could bypass provenance | Governed outputs could become untraceable | Lineage entity checks and exports that exclude unlineaged contacts |
| Manual fixes could become hidden mutations | Operators could not safely correct or teach the parser | Append-only proposals/decisions plus replay-gated, scoped exact-match feedback rules |

## System boundaries

The durable design has five boundaries:

1. **Control plane:** missions, idempotent jobs, leases and immutable job events.
2. **Acquisition:** pinned policy reviews, politeness rules, fetch attempts and immutable
   content-addressed artifacts.
3. **Interpretation:** versioned adapters, golden fixtures, parse runs, source records and
   field observations.
4. **Decision:** invariants, audit evidence, field health, corroboration and the pure
   terminal-state calculation.
5. **Publication:** deterministic resolution and lineage-backed materialization. Publication
   remains closed until legacy integrity and the five-archetype parsing pilot both pass.

This separation keeps source truth immutable and lets normalization, resolution and export
logic evolve by replay rather than by destructive edits.

## What remains real work

The remaining gates are deliberately concrete, not architectural placeholders:

- Repair and independently verify the legacy evidence pack: 2,035 affected IDs, 6,990
  dangling references and 834 counter disagreements.
- Complete legal/purpose/retention and robots reviews, confirm routes, remeasure expected
  volumes and freeze the source universe.
- Implement the network transport around the supplied policy functions and enforce proxy
  use at the OS/network layer.
- Capture one real golden input/output pair and implement an adapter for each of the five
  archetypes: download, structured/API, paginated HTML, PDF and client-rendered.
- Implement deterministic resolution/materialization with a labelled benchmark and require
  lineage for every published field.
- Add replay projection hashes, scheduled invariants, backups, restore rehearsal and
  telemetry before unattended operation.

These steps require source-specific evidence or deployment authority. Their acceptance
criteria are in `FOUNDATION-2.1.md`; none is represented as complete in this bundle.

## Scale strategy

SQLite with WAL and one short-lived writer is appropriate for the isolated pilot and a
moderate worker fleet because artifacts are outside the database and claims are bounded.
Scale reads and parsing workers horizontally, but keep database mutations behind the writer
boundary. Move to Postgres only when measurement shows sustained writer-lock latency,
multiple hosts require concurrent writes, or availability/replication requirements demand
it. Row count by itself is not a migration trigger.

Operational metrics should include queue age, lease expiries, retries by host, fetch bytes,
4xx/429 rate, parse latency, schema-drift quarantines, verified-field yield, audit error
rate, human minutes, route coverage, volume coverage and stale-volume debt.

## Recommended execution order

1. Run Track A legacy recovery and Track B source-policy review in parallel.
2. Freeze the pilot denominator and store the first legal/robots review IDs.
3. Implement transport and capture immutable artifacts without parsing live pages twice.
4. Build and fixture the five adapters against stored artifacts.
5. Replay, reconcile, audit and deliberately break one fixture to prove quarantine.
6. Implement and benchmark resolution/materialization.
7. Rehearse restore and production merge; only then open recurring automation.
