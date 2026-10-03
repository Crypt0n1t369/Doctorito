# Decision log

Newest first. Each entry records what was decided, why, the alternative considered, and
what evidence would reopen it. Open decisions stay here until the user settles them.

## Open

- **Who is the first real user.** The AI-heavy selection rule is reopened. [EXPERIMENT.md](EXPERIMENT.md) proposes one public-material inquiry with a lead, contributors and a fresh reader; [the Latvia case](experiments/LATVIA.md) is a concrete candidate. No participants or final issue have been selected. Internal use is a workflow check, not external demand evidence.
- **First positioning.** Test continuity, checking and follow-through together. The earlier memory-versus-trust reframe assumed too much; current [VALUE-AND-SCOPE.md](VALUE-AND-SCOPE.md) retains both as testable needs. Which benefit drives adoption remains open.
- **Whose is the record of what someone has done; may the system learn from
  contributions.** Proposals in [OUTCOMES.md](OUTCOMES.md#open-questions).
- **D3 The contributor's side for class 1 · D4 Whose permission covers hosted
  processing.** Technical, with proposals, in
  [CONSTRAINTS.md](CONSTRAINTS.md#decisions-still-open). D1 and D2 there are the
  technical side of the second and third product questions. None blocks Gate 0.

## 2026-09-29 — Close the documentation and pilot-preparation loose ends

At the user's request to finish obvious omissions, replace the older mission blueprint's readiness claims and first-step sequence with the current conditional architecture; preserve the old document as history. Correct the README's full-architecture and fully-enforced-boundary claims. Add a manual pilot workbook and point the assessment register at canonical project documents while retaining dated integration snapshots.

This prepares the work; it does not recruit a lead, select the pilot, resolve runtime gaps or count as an observed episode. The source research remains dated 28 September.

## 2026-09-29 — Integrate the critique and prepare a falsifiable experiment

**Integrated at the user's request.** Replace universal memory-solved, solo-use-dismissal and AI-heavy selection claims with testable hypotheses. Retain the earlier value research as a dated archive. Clarify intended outcomes versus implemented capability, retain the hard boundaries, and make domain-specific acceptance explicit.

**Proposed, not yet selected or run.** A roughly ten-day public-material inquiry with an ordinary-document baseline, visible saved/reviewed/published distinctions, contribution receipts, contrary-evidence review and a fresh-reader handover. The Latvia example is source research, not field validation. Its runtime implementation and any external release remain future work.

**Reopen if.** Ordinary tools achieve the same result with less effort, the participants will not maintain it, or an actual group reveals a more useful starting problem.

## 2026-09-23 — Separate the why and what from the how

**Decided.** OUTCOMES.md states only why the system exists and what it enables, for one
person, a team and open collaboration, in plain language. The engineering rules (C1–C9),
the order of work and the technical decisions moved unchanged to CONSTRAINTS.md, where
the code and tests cite them.

**Why.** The first version listed eleven outcomes as measures and constraints, and never
said what anyone actually gets. The user asked for the why and what first, with the how
to follow. The same excess of distinctions (six kinds of statement, five scopes, four
permission types, about nine states) runs through the design notes and is the likeliest
reason both interface studies felt confusing: a screen cannot be clearer than the objects
behind it.

**Alternative considered.** Keep one document with a plainer summary on top. Rejected:
the two audiences are different, and the technical half would keep crowding out the point.

**Reopen if.** The why and what cannot be kept short without losing something a user
would notice.

## 2026-09-23 — Steer by outcomes and constraints, not by features

**Decided.** [OUTCOMES.md](OUTCOMES.md) is the steering document. Every change names the
outcome it serves or the constraint ([CONSTRAINTS.md](CONSTRAINTS.md)) it protects. Work follows its order: Gate 0 boundary
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
[CONSTRAINTS.md](CONSTRAINTS.md#settled-by-the-guiding-prompt).
