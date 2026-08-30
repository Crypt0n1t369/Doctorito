# Golden fixtures — what is real and what is not

## The fixtures in `tests/fixtures/` are SYNTHETIC

They were written to exercise each archetype's *shape*: an HTML table, a JSON API, a
paginated card list, a PDF line table, and an XHR-backed client-rendered feed. They prove
the interpreter, the count reconciliation, the drift quarantine and the materializer work.

They are **not** evidence about GWO, OSHA, IRATA, IALA or OPITO. No real page was fetched
to make them in the shipped handoff. Version 2.3 can obtain those pages after automated
public preflight; the schema still refuses a fetch without an approved, in-date source and
route review plus a matching stored robots snapshot.

Publishing numbers derived from these fixtures as facts about real training centres would
be fabrication. They are test data.

## What a real golden fixture requires

For each of the five routes, after public preflight or required human approval:

1. Fetch the live page through `./tcpipe fetch`. The bytes land in the artifact store,
   content-addressed, and the attempt is recorded with the reviews that permitted it.
2. Register that artifact as the adapter's fixture input:
   `adapter_fixture.artifact_sha256` = the stored sha256.
3. Produce the expected output by hand-checking every extracted row (or a stratified
   sample, recorded honestly), and store its canonical hash as `expected_sha256`.
4. Set `passing = 1` only once the adapter reproduces that output from that artifact.
   `route_adapter_fixture_insert` will not let the route activate an adapter version
   without a passing fixture.
5. Re-measure `universe_route.expected_records` from the same artifact and record
   `expected_basis` and `expected_as_of_utc`.

The agent-facing sequence is `adapter-fixture` without `--expected-sha256` to compute the
deterministic projection, inspect/correct the rules, repeat with the expected hash to record
the immutable pass, then `adapter-activate`. This technical fixture does not replace the
separate accuracy audit required for a completed route run.

The adapter rules in `adapters/*.json` carry a placeholder `fixtures: ["000…0"]`. Replace
it with the real artifact sha256 at that point. Until then those adapters are **selector
hypotheses written against the published page structure, not verified extractors** — the
real sites will differ, and the first live fetch is how you find out where.

## Why the GWO fixture has 120 rows

`min_expected_rows: 100` in `gwo__download` is a floor guarding against a page that
silently returns almost nothing. A four-row fixture cannot exercise it. The synthetic
fixture is sized so the guard is genuinely tested; the real route expects ~652 rows, so
raise the floor once G2 re-measures it.
