# Launching tier 1

Tier 1 is the five association directories: which centres each association lists as a
partner, plus location, contact and accreditation scope. It is the whole of what an
association publishes, and it is what 2.2 makes executable.

**It does not include prices or bundle packages.** Associations do not publish them. Those
live on each centre's own website and are tier 2 — see the last section.

## What runs today

```
./tcpipe init   --db pilot.db --artifacts ./artifacts
./tcpipe fetch  --db pilot.db --artifacts ./artifacts --route RT-0001 --require-proxy --proxy http://egress:3128
./tcpipe run    --db pilot.db --artifacts ./artifacts --route RT-0001 --attempt FA-… --audit-errors 0
./tcpipe status --db pilot.db
```

`fetch` is the only command that opens a socket. `run` parses stored artifacts, computes
the terminal state, and materializes governed entities with lineage. Both refuse to act
before their gate is satisfied, and say which gate.

## Gate status

| Gate | What it needs | State |
|---|---|---|
| G2 — freeze the universe | Terms/purpose/retention review, robots snapshots, route confirmation, re-measured volumes | **Open — yours to do.** Blocks the first legal fetch. |
| G3 — transport | HTTP client honouring politeness, conditional requests, artifact store, fetch tables | **Built.** `transport.py` |
| G4 — adapter interpreter + 5 adapters | Rules interpreter with 8 selector strategies, drift quarantine, five archetype adapters | **Built.** `adapter.py`, `adapters/*.json` — fixtures are synthetic, see `FIXTURES.md` |
| G5 — resolution + materialization | Deterministic identity, merge blockers, lineage for every field | **Built.** `resolver.py`, `materializer.py` |
| G6 — replay and scale | Replay stability, bounded concurrency, backup rehearsal, telemetry | Partly. Replay idempotency, lease recovery and OpenClaw oversight scheduling are built; live fetch schedules, backup rehearsal and telemetry are not completed. |
| G1 — legacy integrity | 6,990 dangling rows, 834 counter disagreements | Open, and **does not block this pilot.** It gates production materialization (M-900) only. |

## The two things only you can do

**G2 is not paperwork.** The schema physically cannot record a fetch without an approved
`source_policy_review` and `route_policy_review` pinned to a stored robots artifact. Five
sources, five routes. Until those rows exist, `./tcpipe fetch` stops with a message naming
the gate.

**Real fixtures.** The five shipped adapters are selector hypotheses written against the
published page structure. The real sites will differ. The first live fetch of each route is
how you find out where — then the adapter is corrected against a real stored artifact and
its fixture recorded. Budget for this: it is the single most likely source of rework.

## Two decisions to make before you fetch

**Phone numbers.** `centre_contact.is_personal_data` drives whether a contact appears in
the default export. The materializer's rule is conservative: an organisation switchboard is
not personal data, a named individual's mailbox is. A training centre listing a person's
direct line is personal data under GDPR regardless of it being publicly visible. Decide
whether you collect those at all, and set the retention period in the source policy review.

**Egress.** `--require-proxy` makes the transport refuse to run without a proxy configured,
but a proxy a process can decline to use is not an enforcement boundary. In production, put
the worker in a network namespace or firewall it so the proxy is the only route off-host.

## Realistic sequence

1. Legal/terms review for the five sources; record each as an immutable
   `source_policy_review`. Parallel with everything below.
2. Fetch and store robots for each route; record `route_policy_review` pinned to it.
3. First live fetch per route → correct the adapter against the real artifact → record a
   passing fixture and re-measure `expected_records`.
4. Freeze the universe (`freeze_universe`), which turns coverage percentages into
   statements about a fixed denominator.
5. Run all five routes; work the review queue for blocked resolutions.
6. Schedule recurring runs at each route's `refetch_days`.

Steps 3–5 are where the real time goes. Expect the first pass through step 3 to take
longer than the engineering did.

## Tier 2, when you get to it

The data model is ready: `package` and `package_item` exist so a bundle price covering
several certificates is representable, and `price_observation` attaches to either one
offering or one package. `accreditation.direction='reverse'` with
`evidence_strength='centre_self_claim'` is how a centre's own claim is recorded distinctly
from an association's directory entry.

What is not solved, and is not an engineering problem:

- **~1,200 policy reviews.** Every centre website is a separate source under the same
  guard that protects tier 1. This is the dominant cost.
- **~1,200 templates.** Adapters are per-template with a required passing fixture. A
  generic extractor collides with that guarantee by design.
- **Price volatility.** Short `refetch_days` multiplies recurring fetch volume.

The two viable shapes are a bounded subset (top N centres, bespoke adapters, full
governance), or review-only extraction that lands in `field_observation` and `review_queue`
and never becomes a governed entity without a human decision — which the schema already
supports and which G5 explicitly permits for LLM output.
