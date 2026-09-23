# What this is for

23 September 2026. This is the steering document: every feature and every repair should
say which outcome it serves or which constraint it protects. It was drafted from the
concept paper, the investor one-pager, the prototype spec, the 22 September review, the
builder brief, the maker companion and the guiding prompt, then checked against them.
Four decisions at the end are still open; nothing in the current slice of work depends
on them.

## In one paragraph

People and groups build shared understanding, explore possibilities, make things and
learn from results together — and, when they choose, carry a decided goal through to
finished work — without one coordinator holding every relationship in their head, and
without anyone losing control of what they shared. People contribute in the scope they
choose. The system connects the evidence they are allowed to use, offers a few worthwhile
next steps to someone willing to take them, and records what happened so the shared
understanding improves. Optional models learn only from examples people deliberately
released.

The recurring question: **given what this person or group is allowed to know, what do we
understand, what remains uncertain, and what worthwhile next step could they willingly
take?**

## Who it serves

- a **contributor** offering time, a thing, a skill, an observation or an answer — often
  once, casually, with no wish to join anything
- a **maker** or individual working on something, possibly alone at first
- a **group or project** with a shared goal
- a **community** whose living knowledge or practice is being recorded, with its own
  protocols for who may disclose what, and to whom
- a **convener**: an organisation that decided something collectively and now has to
  deliver it — a municipality, cooperative, energy community or consortium
- a **newcomer or returning member**
- **the public**, and especially the people who voted for or proposed something

## Outcomes

Each says what becomes true, and how we would observe it with data the system holds.

**O1. Contributing is easy, and the answer is truthful.** Anyone can contribute in their
own words and their own language, on a channel they already use, with no account beyond
the channel identity they already have, no classification form, and no promise of future
work. The reply comes quickly, in their language, and says something specific. If it says
a person will look, a person does. Original words are kept; any translation stays linked
to them.
*Observed by:* median and p95 time from message to a specific reply (the spec proposes a
median under 5 s); contributions left without a reply or in a non-terminal state after
10 minutes (target 0); promises of human attention not kept (target 0); clarifying
questions asked back per contribution. All per language.

**O2. A goal becomes work people can pick up.** A decision, objective or intention is
turned by its author into needs, work items and open questions a newcomer can act on. The
system proposes a decomposition for the author to correct, and refuses to publish a need
for scarce capacity without a quantity, a unit and a window. Qualitative work carries
acceptance criteria and dependencies. An open question names the decision it blocks.
Nothing changes silently: every edit is an event with an author and a reason. When work
closes, what it consumed is recorded against what was planned. The decision itself is
imported from wherever it was legitimately made, not authored here.
*Observed by:* needs refused at save, by missing part; work items with acceptance
criteria; proposed decomposition items kept, edited or discarded; edits after publication,
with reasons; planned-versus-actual variance on every closed item; contributor questions
asking what a need means.

**O3. A project knows what it knows.** Each statement is recorded with who made it, its
source span, and its kind — observation, factual claim, hypothesis, interpretation,
imagined extension or decision. Recorded separately: its evidential status (reported,
inferred, confirmed, disputed, superseded, retracted), applicability, time and
uncertainty, and what supports or contradicts it. Conflicting accounts stay side by side
with their sources, including disagreement within a community and permitted outside
interpretations. A decision records who decided, under what authority, why, and what would
reopen it; it authorizes local action and does not make a claim true.
Assistant-generated interpretations are marked as such and can be corrected.
*Observed by:* claims without a source span (0, enforced at write); on frozen labelled
episodes, claim precision and recall against the sources, unsupported statements, and
contradictions present in the sources but missing from the record; decisions recorded as
confirmed facts (0).

**O4. Exploration stays open.** Anyone can add a question, alternative, category,
relationship or unexpected connection, and it is kept and can be developed even when
nothing current fits it. Fixed option lists and model enums never cap what can be proposed:
a generative or human path can always add a candidate. Suggestions include unfamiliar and
underexposed material, not only close matches — someone offering a van is often needed
most for something they never considered. Exposure, interest, endorsement, evidence and
adoption are recorded as different things, and silence is not rejection. Curation rules
can be inspected and appealed, and resist spam and manufactured popularity. An exploration
may change the question rather than finish a task.
*Observed by:* accepted next steps whose candidate came from outside the existing need and
question lists; exposure given to contributions with no prior engagement, and how many
later drew a relation, reproduction or adoption; participant-added categories and
relation types in use; appeals and their outcomes.

**O5. A person finds a worthwhile next step they are willing to take.** The loop starts
from the person's present intention: what they want to explore or accomplish, how much
time they have, how they want to take part. It offers one or a few options, each with a
reason, the expected effort and what will count as done. Options come from the project's
needs and blockers — a scarce resource, an open question, missing evidence, an unmade
decision — and from exploration (O4). Permission, authority, eligibility, workload, budget
and contact-policy filters run before ranking. Options include paired builds, small
experiments, parallel variants and steps chosen to learn rather than deliver. Matching an
offer to a need is one kind of step; a project may also invite someone who declared the
interest and allows contact. People can decline, redirect, learn or just watch, and
declining costs nothing.
*Observed by:* options offered, accepted, declined and unanswered; blockers and open
questions resolved with evidence, and time spent blocked; asks inside the cooldown (0);
opt-outs within 7 days of an ask; contacts that fail a permission, consent, cooldown or
workload check on audit (0); share of contributions decided with no human (the spec
proposes 70%), p95 review-queue age, and coordinator minutes per resolved item.

**O6. Commitments are two-sided, and completion is verified.** A commitment needs the
contributor's side — their own offer or acceptance, or a standing authorization they gave
— and the project's side: authorization at the level the risk class requires, checked
together with verified eligibility in the same transaction. Neither stands in for the
other: a contributor's tap is never the project's review, and a reviewer's match never
waives a credential. Scarce capacity is leased and cannot be double-booked. Withdrawing is
exactly as easy as confirming. "Someone says it is done" is recorded, and is not accepted
completion until the evidence and the party with authority accept it. No-shows and
failures are recorded as what they are.
*Observed by:* wrong commitments per risk class, language and engine, as errors over total
with a one-sided 95% upper bound (the spec proposes at most 2% for automatic class-1 binds;
claiming that needs at least 149 independent, representative, error-free binds); class-3
commitments without an authorized review, on any path (0); needs shown as closed without an
accepted completion (0); completions accepted with evidence versus only reported;
withdrawals made in time versus no-shows.

**O7. Attempts can be reproduced, and work can be shared in parts.** An attempt is linked
to its design or code revision, materials and equipment, environment, settings, method and
observed result, so a conflicting result can be traced to a different setup instead of
argued over. Ordinary messages, photos, recordings, measurements and repository changes
supply the evidence, and the system asks only for the missing details that matter. People
can build side by side, try parallel variants, or hand one problem off asynchronously with
a note of what was tried, under which conditions, what happened and what remains open. The
system can propose the one experiment that would tell two results apart, and connect a
bottleneck to tools, examples, equipment, compute or people who offered help.
Maker-specific fields never become mandatory for other kinds of work.
*Observed by:* reproductions attempted and succeeded; conflicting results explained by
recorded conditions; missing-detail questions per attempt; handoffs resumed without
restating.

**O8. Anyone can see what happened.** Every decided initiative has a public view: the
decision it came from, its objective, what is still open with live counts, what is
blocking, what has been committed and what has been delivered. It answers from that state
alone, and names a person only under their grant. Anyone who proposed or contributed can
follow their item from the vote or idea, to the need or question it produced, to who took
it on (as far as they may see), to the result — and can see what their contribution
changed. Correction, testing, replication, documentation, maintenance and careful
disagreement are credited as visibly as invention.
*Observed by:* public items whose trace from decision to result or current status has
every link present; open counts matching the commitment and delivery records, where a
false "filled" counts as a failure; blocking needs shown; days since the last status change
a contributor could see, per open item.

**O9. Knowledge stays alive, and travels only deliberately.** Lessons, failed attempts,
surprises, alternative interpretations and unfinished ideas stay findable, correctable and
branchable; something need not become a task to deserve a place. A returning person
resumes and a newcomer gets oriented, through recaps drawn only from what they may see,
with citations and an as-of version. A group can release a package — records, artifacts,
provenance, open questions, licence — that another group adapts and answers with evidence.
An import is neither an endorsement nor permission to run what it contains. Recaps belong
to this outcome; the record they are built from belongs to O3.
*Observed by:* correct carryover and stale-fact use when someone resumes; corrections and
retractions reaching every recap and derived view; newcomer recap accuracy against the
permitted record; reproductions made from a released package.

**O10. People and communities keep control of what they share.** People choose the scope
of each contribution; grant, narrow and revoke; see, edit and expire what is remembered
about them; see why something was suggested to them, explained only from what they may
know; and leave. Where a community has a protocol for what may be disclosed, to whom and
how, it governs alongside each person's consent — neither overrides the other — and no
curator, majority or model decides cultural meaning for everyone. A person's verified
record of what they delivered belongs to them and reaches another project only by their
grant. The system says plainly that downloaded copies and trained weights cannot be
recalled.
*Observed by:* remembered preferences and availability carrying an expiry; time from an
edit or revocation until the last affected view, index and queued item reflects it;
suggestions sent with a reason the recipient can open; disclosures outside a community's
protocol (0); the same core running a cultural contribution and a software project, with
no field from one mandatory for the other.

**O11 (after O1–O10 work with templates). Assistants improve only from deliberately
released experience.** A local assistant helps with a project's own material and stays
useful with no hosted judge. A model is trained only to fix a limitation the retrieval
baseline has shown, only on examples released for training, with lineage, and is released
only when independent evaluation shows improvement without unacceptable regressions. Judge
scores and teacher-generated answers are never ground truth by themselves. A trained model
is a derived artifact with its own audience.
*Observed by:* the assistant works with hosted inference disallowed; every training example
traces to a training grant; each released model carries a manifest and an independent
evaluation.

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

**C2. Nothing consequential happens without the authority it requires.** Commitments are
two-sided (O6). Risk class 3 is never automatic. Credentials are verified, never inferred,
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
   guiding prompt's story: O2, O3, O5, O7, O9's recaps and O10. O6 is limited to explicit
   acceptance and evidence-backed completion. A feature that opens a sharing, outbound,
   export or execution path ships with its constraint checks in the same change.
3. **Stage 2 — models in shadow mode.** General-model extraction and Jev compared with
   templates on frozen episodes, every measure reported per language and engine from the
   first run.
4. **Stage 3 — limited automation and a convener pilot.** Automatic actions only where a
   threshold has been validated (C2). The pilot measures O6's wrong-commitment rate on
   real traffic.
5. **Later.** O11, and federation across organisations when ownership or scale requires it.

**Tie-break.** (1) Closing a reproduced unsafe path beats everything. (2) Next comes
whatever unblocks the current stage's next unmet exit criterion. (3) Work that only serves
a later stage waits, however cheap. Applied now: the command boundary comes first and the
knowledge model second. Fulfilment's legal transitions belong to Gate 0; evidence-backed
acceptance belongs to Stage 1. Per-language thresholds wait until an automatic action is
proposed in that language, but per-language reporting starts now.

## Decisions still open

These change what the product is, so they are the user's. Each has a proposal.

**D1. What compounds.** The concept paper's compounding asset is a platform-accumulated
verified capability registry that eventually becomes a directory other agents query (its
"Directory and API" revenue line). The guiding prompt rules out a universal contributor
dossier and keeps private profiles out of shared training; the builder brief requires a
grant for cross-project reuse. *Proposal:* a person's delivery record belongs to them and
travels by their grant (O10). What compounds for the operator is question banks,
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
- **First proof.** Gate 0, then Stage 1's two-maker, two-project story, which can be built
  and tested now. The convener pilot measures the wrong-bind rate in Stage 3.

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

The guiding prompt's five principles map onto the outcomes as: Exploration → O4;
Convergence → O3; Synergy → O5 and O7; Continuity → O9; Agency → O10 and O8. O1, O2, O6
and O8 come from the concept paper and the spec; O7 and O11 from the maker companion.

Two figures are carried with caution. "One coordinator holds 30 to 50 active relationships"
is the concept paper's, with no cited source; it is a hypothesis that O5's coordinator
measures can test. The OECD finding of "a black box between input and outcome" is the
concept paper's paraphrase of the 2025 review of citizen participation, not checked here.
