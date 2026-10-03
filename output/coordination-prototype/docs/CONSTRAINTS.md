# Constraints and order of work

23 September 2026. The engineering side of [OUTCOMES.md](OUTCOMES.md): the rules the code
must never break, how each is checked, the order the work is done in, and the technical
decisions still open. OUTCOMES.md says what the system is for; this says what must hold
while building it. Code comments and tests cite these rules by number (C1–C9).

## Hard constraints

Never traded against an outcome or a score. Each names how it is checked.

**C1. Information reaches only whom it may.** Nobody learns what they were not allowed to
know — directly, or through a model call, summary, cache, log, recommendation or count.
Reading, processing with a named provider, training and distribution are four separate
permissions, and models, tools and background workers are recipients too. Redaction
reduces what is sent; it never creates a permission. If a provider's policy is unknown,
restricted material is not sent, on every path including fallbacks, retries and
evaluation. Revocation takes effect before the next retrieval, call, dispatch, export or
job that would use it, and queued work rechecks when it runs. The core loop works with no
hosted processing at all.
*Checked by* counterfactual tests: hold a recipient's permitted inputs fixed and change
someone else's secret — context packets, recommendations, recaps, caches and logs must not
change; a grant revoked between draft and delivery means no delivery.

**C2. Nothing consequential happens without the authority it requires.** A commitment is
two-sided: the contributor's own offer, acceptance or confirmation, and the project's
authority at the level the risk class requires, checked with verified eligibility in the
same transaction; neither stands in for the other. Risk class 3 is never automatic. Credentials are verified, never inferred,
and no reviewer can waive them. An automatic action runs only where its threshold has been
validated for that engine, language and action, and the one switch turns every automatic
path into a review item.
*Checked by* every entry path — web, channel, coordinator, outbound invitation, agent — with
a class-3 need and an uncredentialed actor: zero commitments. With the switch off: zero
automatic commitments on any path.

**C3. Identity is what a channel authenticated.** A contribution is attributed to the
identity its provider authenticated for that address or account, never to a display name,
handle or email local-part. Two channel identities become one person only after that
person proves control of both. No account is ever required to contribute.
*Checked by* matching names, handles and local-parts across channels staying separate
identities; a contact typed into an unauthenticated form never reaching an existing
person's commitments.

**C4. Failure degrades to a visible, recoverable review state** — never to silent action,
to a weaker engine that keeps the same authority, or to a lost contribution.
*Checked by* a missing key, 401, 429, timeout, malformed answers, missing answers and budget
exhaustion at each stage: each leaves a review state, zero automatic commitments, nothing
stranded.

**C5. Automated messages are honest.** Each says it is automated, gives a way to reach a
person, and promises only what will actually happen.
*Checked by* every reply template mapped to the state it asserts; an expired link never
says "confirmed".

**C6. Models assist; they do not decide what is true, allowed or counted.** Everything
contributed, retrieved or imported is data, never instruction: it never enters a
question's wording, and it gains no execution authority by looking relevant. Code computes
quantities, dates, places, arithmetic and eligibility. A model's confidence is never
authority, and a composite score is a decision score, not a calibrated probability, until
it has been measured. Models are not truth, memory, or the arbiter of cultural meaning.
*Checked by* the leak guard run over the real question builders and real catalogue text;
adversarial inputs in the regression set.

**C7. Attention, evidence, agreement and authority stay distinct.** Popularity may steer
where effort goes. Only evidence supports a factual conclusion. Agreement can authorize a
local decision but never makes something generally true. The relevant people govern
commitments and decisions. Reuse, reproduction, challenge and endorsement are different
relationships, and no count of one is shown as another.

**C8. Every consequential action leaves a minimal audit record**: who acted, under what
authority, referencing which evidence and judgment, at which versions. Deletable personal
content is stored apart from it. After deletion an action stays attributable but cannot be
fully replayed from its evidence; we document what replay can still reconstruct and promise
no more.

**C9. Numbers are honest.** Every figure carries its count, provenance, engine, language
and version. Under twenty cases it is a count, not a rate. A synthetic result is not a
claim about production. No threshold is used for a language, engine or action it was not
validated on.

## Not goals

- Engagement time, message volume, streaks, leaderboards, penalties for declining.
- Global reputation or personality scores, a universal contributor dossier, or treating a
  skill as willingness.
- Rebuilding voting, deliberation, chat platforms, CRMs or payments. Integrate instead.

## Order of work, and how to settle a priority argument

1. **Gate 0 — boundary repair.** Before any real private contribution is processed,
   C1–C6 hold on every existing path: one command boundary shared by the web, channel,
   coordinator, outbound and agent paths; verified channel identity with no heuristic
   merging; one scoped egress builder for every model call; validated provider responses;
   provider failure leaving a recoverable review state; legal commitment and fulfilment
   transitions; atomic event, projection and outbox writes; idempotent intake.
   *Exit:* every unsafe path reproduced on 22 September, and those found since, is
   rejected or routed to recoverable review, pinned as regression tests.
2. **Stage 1 — the first loop, with templates and deterministic code.** Steps 1–4 of the
   guiding prompt's story. Commitments are limited to explicit acceptance and
   evidence-backed completion. A feature that opens a sharing, outbound,
   export or execution path ships with its constraint checks in the same change.
3. **Stage 2 — models in shadow mode.** General-model extraction and Jev compared with
   templates on frozen episodes, every measure reported per language and engine from the
   first run.
4. **Stage 3 — limited automation and a convener pilot.** Automatic actions only where a
   threshold has been validated (C2). The pilot measures the wrong-commitment rate on
   real traffic.
5. **Later.** Trained assistants, and federation across organisations when ownership or
   scale requires it.

**Tie-break.** (1) Closing a reproduced unsafe path beats everything. (2) Next comes
whatever unblocks the current stage's next unmet exit criterion. (3) Work that only serves
a later stage waits, however cheap. Applied now: the command boundary comes first and the
knowledge model second. Fulfilment's legal transitions belong to Gate 0; evidence-backed
acceptance belongs to Stage 1. Per-language thresholds wait until an automatic action is
proposed in that language, but per-language reporting starts now.

## 29 September experiment clarification

C1–C9 remain in force. [EXPERIMENT.md](EXPERIMENT.md) proposes a public-material inquiry to test continuity, contribution closure, correction and total review effort. A manual trial in ordinary documents may proceed without claiming the prototype is safe. A software trial must repair and verify every boundary it uses; private data still requires Gate 0. Do not use public source material as an excuse to expose participant identities or private notes.

The earlier two-maker story remains a useful boundary/regression scenario; it is not evidence of adoption or the only possible first value test. The inquiry candidate does not select the first real user. Wrong-bind rate remains a matcher measure; the product also needs evidence that people can resume, revise and obtain useful outcomes.

## Decisions still open

These change what the product is, so they are the user's. Each has a proposal.

**D1. What compounds.** The concept paper's compounding asset is a platform-accumulated
verified capability registry that eventually becomes a directory other agents query (its
"Directory and API" revenue line). The guiding prompt rules out a universal contributor
dossier and keeps private profiles out of shared training; the builder brief requires a
grant for cross-project reuse. *Proposal:* a person's delivery record belongs to them and
travels by their grant. What compounds for the operator is question banks,
thresholds, evaluation sets, and packages people chose to release. The directory revenue
line changes shape.

**D2. The training right.** The concept paper and spec put a right to train on
de-identified coordination traces into the convener's early contracts, "while the deals
are small and nobody is looking at that clause". The guiding prompt says a contribution's
presence in a shared workspace is not training consent, and redaction creates no grant.
*Proposal:* training permission is recorded per source at intake from Stage 1, from
whoever holds authority over that source. A convener's clause covers only what the
convener owns — its catalogues and its coordinators' overrides — not contributors'
messages. The consequence, in the concept paper's own words: without the clause "there is
no flywheel, no model, and we are a workflow vendor with a good margin". The flywheel
shrinks to what people release.

**D3. What counts as the contributor's side for class 1.** Today a class-1 offer that
clears the threshold is leased and confirmed at once: the offer itself is treated as
acceptance. The concept paper's own example still ends "Confirm and I will send the gate
code". *Proposal:* when the commitment matches what the contributor actually said —
the thing, the amount, the day — their offer is their side. When the system proposes
anything they did not say, or it came from an outbound invitation, they confirm, and an
unconfirmed lease expires.

**D4. Whose permission covers hosted processing.** The prototype sends redacted text to a
single-region hosted model. The spec argued that minimisation "is what makes the deal
legal"; the review and the guiding prompt say removing identifiers neither establishes
compliance nor creates a permission. *Proposal:* hosted processing is off unless an
initiative enables it for a named provider whose policy has been verified, and the first
reply tells the contributor; with it off, templates and the rules engine run the loop.
Still open: whether the convener's legal basis plus that notice suffices, or each
contributor must grant it. That needs counsel before a real pilot.

## Settled by the guiding prompt

- **Where the loop starts.** The person's present intention; project blockers are one
  source of options. The review had put blockers first. The concept paper's "the open
  need, not the person, is the primary object" is about the data model, and stays true
  for scarce capacity.
- **Conversation.** Templated conversational intake now; general-model interviewing and
  extraction later, as proposals the record validates; commands stay deterministic. The
  concept paper's "does not make conversation" is about the matcher, which still does not.
- **Writers.** One authoritative writer per record. Groups exchange packages; federation
  waits until ownership or scale requires it.
- **First proof (22 September baseline).** Gate 0, then Stage 1's two-maker, two-project story. The 29 September clarification adds a proposed inquiry value test while retaining this boundary scenario. A convener trial measures matcher errors; product usefulness requires the separate outcome checks in EXPERIMENT.md.

## Where this came from

The concept paper (17 September) named the gap between deciding and doing. The prototype
spec (17 September) set three claims to prove, hardest first: a decision can become needs
ordinary people understand ("the part that is least solved"); a free-text offer binds to
the right need at a wrong-bind rate fit for a contract; contributors can see the needs
close. All three are targets, not findings. The prototype implements the second, on
synthetic data only — no production wrong-bind rate exists yet. The review (22 September)
found the matcher sound as a component and its boundaries unsafe for real private
contributions. The guiding prompt (22 September) widened the purpose: matching an offer to
a need is one kind of next step among several, and what a project accumulates is
understanding as well as capacity.

Two figures are carried with caution. "One coordinator holds 30 to 50 active relationships"
is the concept paper's, with no cited source; it is a hypothesis that measuring coordinator
minutes per resolved item can test. The OECD "black box between input and outcome" is a
misattribution: in the OECD's 2025 reports "black boxes" means opaque technology. What
the OECD does document is low accountability after participatory processes and an
inconsistent feedback loop (see VALUE-AND-SCOPE.md).
