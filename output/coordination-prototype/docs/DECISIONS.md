# Decision log

Newest first. Each entry records what was decided, why, the alternative considered, and
what evidence would reopen it. Open decisions stay here until the user settles them.

## Open

- **D1 What compounds · D2 The training right · D3 The contributor's side for class 1 ·
  D4 Whose permission covers hosted processing.** Proposals are in
  [OUTCOMES.md](OUTCOMES.md#decisions-still-open). None blocks Gate 0.

## 2026-09-23 — Steer by outcomes and constraints, not by features

**Decided.** [OUTCOMES.md](OUTCOMES.md) is the steering document. Every change names the
outcome it serves or the constraint it protects. Work follows its order: Gate 0 boundary
repair, then Stage 1 with templates, then models in shadow mode, then limited automation.

**Why.** The prototype had grown around one mechanism — an offer binding to a need — while
the purpose widened on 22 September. Without an agreed purpose, every gap looked equally
urgent.

**Alternative considered.** Continue from the original spec's three claims. Rejected: the
guiding prompt, which the user endorsed, supersedes that scope.

**Reopen if.** The user changes the purpose, or Stage 1 shows that an outcome cannot be
observed with data the system holds.

## 2026-09-23 — Commit the reviewed baseline before repairing

**Decided.** The source reviewed on 22 September was committed unchanged (`708350e`, branch
`coordination-prototype/boundary-repair`) before any repair.

**Why.** All 50 files matched the review's snapshot hashes, and all 17 reproduced defects
still reproduced. Committing first makes every repair a reviewable diff against exactly
what was reviewed.

## Settled by the guiding prompt (22 September)

Where the next-step loop starts; conversation; writers; the first proof. See
[OUTCOMES.md](OUTCOMES.md#settled-by-the-guiding-prompt).
