# Missions 2.1

The machine-readable authority is `missions.json`, validated by `missions.schema.json`
and loaded into the `mission` table by `scripts/bootstrap.py`. This file is the human view.

## Parallel tracks

Track A (`legacy_integrity`) repairs and independently verifies the retained corpus.
Track B (`parsing_capability`) builds and proves the isolated parsing instrument. Track A
does not block safe parser learning; both tracks block production materialization.

| Mission | Track | Priority | Outcome |
|---|---|---:|---|
| M-000 | Legacy integrity | 1 | Recovery ledger independently verified against the frozen evidence snapshot |
| M-100 | Parsing capability | 1 | Run-centered schema, queue, artifact store, evidence model and state calculator pass |
| M-110 | Parsing capability | 2 | Versioned route universe frozen after legal/policy review and expected-record measurement |
| M-120 | Parsing capability | 3 | Download, structured, paginated, PDF and client-rendered archetypes pass replay and QA |
| M-900 | Cross-track | 1 | Production merge rehearsal passes after both tracks complete |

Jobs cannot cite arbitrary text from this document: `job_queue.mission_id` is a foreign key
to the loaded `mission` registry. Track priority is local to a track; the production gate is
the cross-track dependency, not forced sequential execution.
