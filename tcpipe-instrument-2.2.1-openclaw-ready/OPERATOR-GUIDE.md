# Operator guide — instruct, oversee and correct tcpipe

## The short version

`tcpipe` is an internal parsing instrument. You instruct it by choosing a governed mission
and enqueueing a bounded job. You oversee it through status, route, review and integrity
commands. You correct output by proposing an append-only correction to an exact field
observation; a second action accepts or rejects it.

The instrument never edits captured source evidence. A manual correction changes the
effective read model, preserves the original value and records who proposed and approved
the change. Corrections intended for more than one record become rule candidates and must
pass fixture replay before being promoted into a new adapter version.

Run commands from this folder.

When OpenClaw operates the instrument, it uses `./bin/tcpipe-agent` instead. That wrapper
selects the governed state paths and prevents arbitrary URL, rules, proxy and database-path
overrides. See `openclaw/INSTALL.md`.

## 1. Create an isolated working database

```bash
./tcpipe init \
  --db ./work/pilot.db \
  --artifacts ./work/artifacts
```

The shipped five-route source universe is a candidate seed. Initialization does not approve
legal usage, freeze the denominator, fetch pages or claim that an adapter exists.

## 2. See what requires attention

```bash
./tcpipe status --db ./work/pilot.db
./tcpipe readiness --db ./work/pilot.db
./tcpipe routes --db ./work/pilot.db
./tcpipe reviews --db ./work/pilot.db --status pending
./tcpipe doctor --db ./work/pilot.db
```

`status` is the main oversight command. Watch its `attention` object, route states, route
coverage and volume coverage. `doctor` verifies SQLite integrity and every registered
artifact by default.

`readiness` is the executable launch/scheduling view: every route lists its policy, robots,
adapter-fixture and due-state blockers. After a crash or quota interruption, run:

```bash
./tcpipe recover --db ./work/pilot.db --by YOUR_NAME
```

This requeues only expired leases still within their attempt budget and marks exhausted work
failed; it does not mutate successful evidence.

## 3. Give it an instruction

List the allowed strategic missions:

```bash
./tcpipe missions --db ./work/pilot.db
```

Then enqueue a plain-language, bounded instruction:

```bash
./tcpipe enqueue \
  --db ./work/pilot.db \
  --mission M-120 \
  --kind capture-and-parse \
  --instruction "Capture and parse the approved official RT-0001 download from stored evidence" \
  --route RT-0001 \
  --acceptance "one finalized fetch with a download artifact" \
  --acceptance "field observations retain artifact, locator and quote" \
  --acceptance "fixture replay and count reconciliation pass" \
  --mode isolated_pilot \
  --idempotency-key RT-0001-first-fixture \
  --git-commit YOUR_COMMIT \
  --by YOUR_NAME
```

For automation, replace `--instruction` with `--params '{...}'` or `--params @job.json`.
The idempotency key prevents an accidental double enqueue.

This command records an instruction. A transport/parser worker must be deployed to claim
and execute it; this bundle intentionally does not pretend a production worker is running.

## 4. Inspect work and evidence

```bash
./tcpipe jobs --db ./work/pilot.db
./tcpipe jobs --db ./work/pilot.db --status failed
./tcpipe observations --db ./work/pilot.db --route RT-0001 --field published_name
./tcpipe observations --db ./work/pilot.db --contains "Centre name"
```

Use the returned `field_observation_id` for an exact manual correction. The locator, quote
and artifact hash remain visible for source comparison.

## 5. Make a manual correction

First propose; do not approve your own change when independent review is practical:

```bash
./tcpipe correction-propose \
  --db ./work/pilot.db \
  --observation OBSERVATION_ID \
  --action replace_normalized \
  --value "Correct official centre name" \
  --scope one_record \
  --reason "Official source heading confirms this spelling" \
  --by PROPOSER
```

Then a reviewer accepts or rejects the returned correction ID:

```bash
./tcpipe correction-decide \
  --db ./work/pilot.db \
  --correction CORRECTION_ID \
  --decision accepted \
  --rationale "Compared with the linked official artifact and locator" \
  --by REVIEWER
```

Other actions are `reject_value` and `reject_record`. To replace an earlier correction,
create another proposal with `--supersedes CORRECTION_ID`; history is never deleted.

Use `--scope route_template` only when the same defect likely affects the route template,
or `--scope global_candidate` when it may affect all sources. Accepting either scope opens a
pending `correction_rule_candidate` review automatically. The single record is corrected
immediately, while wider reuse remains gated.

```bash
./tcpipe corrections --db ./work/pilot.db
./tcpipe reviews --db ./work/pilot.db --status pending
```

After an adapter worker has replayed the proposed exact-match rule against golden fixtures,
record the replay evidence and approve it:

```bash
./tcpipe review-decide \
  --db ./work/pilot.db \
  --review REVIEW_ID \
  --decision accepted \
  --before-hash 64_HEX_CANONICAL_HASH_BEFORE \
  --after-hash 64_HEX_CANONICAL_HASH_AFTER \
  --fixture-count 2 \
  --affected 3 \
  --row-delta 0 \
  --rationale "Two golden fixtures replayed; expected fields changed and row count stayed stable" \
  --by ADAPTER_REVIEWER
```

Reject the review without replay fields when the pattern is unsafe or not reusable. An
approved rule applies only to the same field and exact raw value within its reviewed route
or template (or globally when explicitly proposed as global). Route rules take precedence
over template rules, which take precedence over global rules. A direct manual correction
always takes precedence over learned rules.

## 6. How controlled self-correction works

```text
invariant / audit / operator detects defect
  → exact observation and evidence inspected
  → append-only correction proposed
  → independent accept/reject decision
  → effective value changes without altering source evidence
  → recurring pattern opens reusable-rule review
  → exact-match rule or adapter change + golden fixture
  → replay, projection hashes and row-count/version diff
  → learned rule becomes effective only if all gates pass
```

This is intentionally not autonomous mutation. “Self-correcting” means the system captures
feedback, recognizes reusable patterns, demands replay evidence and learns through versioned
rules. It does not let an LLM or worker silently rewrite records or globally apply one manual
judgment.

OpenClaw may perform the detection and proposal steps. Correction decisions, reusable-rule
promotion and audit-error counts remain human attestations by default; the agent wrapper
enforces that separation.

## 7. Oversight rhythm

- Per run: check terminal reason, counts, field health, audit result and blocking escalation.
- Daily during a pilot: `status`, failed/expired jobs, pending corrections and rule reviews.
- Before any adapter promotion: fixture replay, canonical projection comparison and row-drop
  justification.
- Before publication: both legacy-integrity and parsing-capability gates must pass; materialized
  fields require observation/correction lineage.
- Weekly once recurring: exhaustive `doctor`, backup test and restore rehearsal.

See `SYSTEM-REVIEW-2.1.md` for architectural reasoning and `FOUNDATION-2.1.md` for the
remaining evidence-dependent production gates.
