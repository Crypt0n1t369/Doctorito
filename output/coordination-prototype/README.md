# A coordination layer

Turns a collective decision into a catalogue of needs, binds arbitrary free-text
offers to those needs without a person reading them, and shows the needs closing.

**Next action — 29 September 2026:** use the [pilot workbook](docs/experiments/WORKBOOK.md) with a willing lead. The [experiment protocol](docs/EXPERIMENT.md) explains the comparison and the [Latvia inquiry candidate](docs/experiments/LATVIA.md) holds the source research. [docs/VALUE-AND-SCOPE.md](docs/VALUE-AND-SCOPE.md) integrates the latest critique. These are plans and sourced example records, not new runtime capabilities or a completed pilot. Known boundary gaps remain; the matcher is only one component.

**Start with [docs/OUTCOMES.md](docs/OUTCOMES.md)**: why this exists and what it
enables, for one person, for a team and for open collaboration. The short version: a
shared memory for a piece of work, which keeps what matters from conversation, shares
it only as far as you choose, and makes the next step visible. The matcher described
below is one part of that. [docs/CONSTRAINTS.md](docs/CONSTRAINTS.md) holds the
engineering rules that must never break and the order of work, and
[docs/DECISIONS.md](docs/DECISIONS.md) is the decision log. The new
[local inquiry walkthrough](docs/INQUIRY-PILOT.md) describes a source-linked
topic, review, release and contributor-receipt slice. What follows describes the
matcher as it stands.

It is domain-neutral on purpose. The three scenarios in `scenarios/` are a
municipal participatory budget, a multi-agency storm response and a Horizon
Europe consortium forming a bid. They use the same matcher and the nine objects below with different catalogues. This reuse concerns known-needs matching; inquiry, domain review and governance can require additional records and implementation.

```bash
npm run seed          # load the scenario packs
npm run demo          # watch one initiative run: inbound, outbound, delivery
npm start             # serve it:  http://localhost:8787
npm run accept        # the five measures from the spec, on a live run
npm run harness       # wrong-bind rate, calibration, per language
npm run harness -- --sweep    # every threshold, recomputed, no model calls
npm run shadow -- --scenario river-cleanup   # run beside a coordinator, act on nothing
npm test              # run the suite; passing tests alone do not establish Gate 0 completion
```

Node 22 or newer. No dependencies, no build step, no Docker. SQLite comes from
`node:sqlite`, which is why every script passes `--experimental-sqlite`.

## What it has to prove

Three claims, in order of how hard they are to believe.

1. A collective decision can be turned into a catalogue of needs that ordinary
   people understand — quantities, units, windows, places, qualifications. If
   the decomposition is vague, nothing downstream works, and this is the part
   that is least solved. `src/needs.js` is where that is enforced.
2. An arbitrary offer, in free text, on any channel, binds to the right need
   without a person reading it, at a wrong-bind rate we would be willing to
   write into a contract. `src/pipeline/admit.js`, measured by `harness/`.
3. The needs visibly close, and the people who contributed can see that they
   did. `GET /i/:slug` is that page, and it answers from state and nothing else.

## The shape of it

```
a decision        imported, never authored here
  └── initiative  one objective, a window, a place, an owner
        └── needs quantity · unit · window · place · qualifications · risk class
              ↑
          offers  free text, any channel, no account required
              ↓
      commitments leased, confirmed, withdrawn, fulfilled — each naming its judgment
```

The matcher has nine core objects: `decisions`,
`initiatives`, `needs`, `actors`, `capabilities`, `offers`, `commitments`,
`fulfilments`, `judgments`. The inquiry slice adds its own topic, source,
revision, contribution, receipt and publication records. The schema is `src/db.js`.

### The admission pipeline

Two model requests per offer. Everything else is ordinary code.

| stage | owner | typical |
|---|---|---|
| ingest and normalise | channel adapter | < 1 ms |
| extract dates, quantities, places | deterministic parsers | < 1 ms |
| filter on hard constraints | one SQL query | < 1 ms |
| screen and wide ranking pass | one model request | one call |
| shortlist of three | one model request | one call |
| gate, lease and bind | code and one write | < 1 ms |
| reply on the original channel | channel adapter | — |

Filtering before the model is what keeps this honest. Window overlap, travel
radius, missing certifications and already-full needs are eliminated in SQL, so
the model never sees a candidate it would have to reason about dates or
arithmetic to reject — which is exactly what the model is documented to be bad
at. The screen rides along with the ranking: the gate questions run in parallel
against the same state, so they cost nothing extra and arrive with it.

The outbound path is not optional. A purely inbound system is a passive inbox,
and a new initiative has no traffic. When a need ages without commitments,
`src/pipeline/outbound.js` runs the same engine in reverse: rank the capability
records against that one need, take the best dozen actors, ask them directly on
whatever channel they use.

### The three surfaces

**The contributor gets no software at all.** The reply arrives on the channel
they wrote to, and the only page they ever see is a link with four facts on it:
what they committed to, when and where, what to bring, and two buttons. Withdraw
is exactly as prominent as confirm, because a withdrawal people cannot make is a
no-show found out about on the day, and a no-show is a poisoned training label.

**The initiative page is the accountability artifact.** A public URL showing the
objective, the decision it came from, every open need with a live count, what has
been committed and what has been delivered. A resident who proposed something can
follow it from the vote, to the need, to the person who took it on, to the day it
was done.

**The coordinator console is one queue, not a dashboard.** Four keys, keyboard
only, under ten seconds an item. Its real output is not a cleared queue: it is
the only supervised data anybody has about which binds were wrong and why. Every
action writes a labelled override against the judgment that produced it.

## Rules that do not bend

These are the matcher's intended contracts, with partial implementation and bounded test coverage. The 28 September assessment still reproduced identity, cancellation and concurrent-budget gaps and found incomplete multi-project permissions. Read these rules as requirements, not evidence that every path satisfies them. The documentation changes do not close Gate 0.

1. **Append-only.** State is a fold over events. `npm run replay` drops every
   derived table and folds the log again; if the fingerprint changes, the claim
   is false.
2. **Quantity cannot be double-bound.** A proposed commitment takes a lease
   inside one immediate transaction. Two offers arriving 200 ms apart cannot both
   be told yes. Unconfirmed leases expire and the quantity returns.
3. **`qty_committed` is derived, never written.** So is the delivery record, and
   a contributor cannot verify their own delivery.
4. **Eligibility is a pure predicate over verified credentials.** Never inferred
   from what somebody writes about themselves, and checked on every path: a
   coordinator who decides an offer matches a need has not granted the
   certificate the need requires.
5. **Nothing acts before its judgment is written.** The judgment row lands, then
   the lease, then the commitment. `takeLease()` throws without a judgment id and
   refuses one that does not exist in the same initiative.
6. **Risk class 3 has no automatic path, at any confidence.** `thresholdFor()`
   returns `Infinity` for class 3, and the commitment boundary in
   `src/pipeline/leases.js` refuses a class 3 commitment on every path a
   coordinator did not take — including an accepted outbound invitation.
7. **A need's quantity never changes silently.** An amendment is an event with an
   author and a public reason.
8. **Offer text is data, never instruction.** It is fenced and labelled untrusted
   inside the state, and it never appears in a question's wording.
9. **Send nothing hosted without permission, and strip identity from what is
   sent.** Processing with a hosted provider is its own permission per initiative
   (`hosted_processing`, off by default); without it the hosted engine is never
   called. Where it is allowed, names, phone numbers, addresses and identifiers
   are removed from every free-text field before anything leaves — the offer, the
   objective, the catalogue, capability records — including numbers the quantity
   parser found inside them. Removing identifiers reduces what leaves; it does not
   by itself make sending lawful, and patterns cannot recognise a name nobody told
   us about. That is why redaction supplements the permission rather than
   replacing it.
10. **Every automated message says it is automated** and gives one way to reach
    a person.
11. **One switch per initiative** turns every automatic bind into a queue item —
    including binds from accepted outbound invitations — and pauses automatic
    outbound asks, effective immediately, usable without calling us.
12. **A flood degrades to queueing, not to spending.** Per-initiative rate limit
    and a hard daily cost cap, applied at every model call; an offer refused a
    budget is queued, never left outside every list.
13. **Identity is what a channel authenticated.** A signed email webhook, a
    Telegram secret token, or — on the web form, which vouches for nothing — a
    random id in the contributor's own browser. Names, handles and email
    local-parts never merge two people, and a webhook with no secret configured
    refuses everything.
14. **A failure degrades to review, never to a weaker engine with the same
    authority.** A missing key, a refused request, an invalid answer or a
    disallowed destination still gets a rules-engine reading for the coordinator,
    marked `degraded_cause`, and nothing binds on it.
15. **The record is a coordinator's view.** Judgments, actor pages, the outbox and
    the log need a coordinator session; a private initiative does not exist for
    the public; a contributor's confirm/withdraw link is never shown to anyone
    else.

`test/boundaries.test.js` pins 13, 14 and 15 and every other path the 22 September
review reproduced; 26 of its 29 tests failed on the reviewed code.

Check nine and eight for yourself:

```bash
node --experimental-sqlite --no-warnings bin/check-typesafe.js
```

It prints the exact state that would leave the machine, and fails if any
identifier survived redaction or any contributor text reached a question.

## The judgment layer, and the honest part

The model behind `src/judgment/` is [TypeSafe](https://docs.typesafe.ai/) — not a
chat model but a judgment API. You send a state and a map of named questions and
get back typed answers with full probability distributions: `noul` (0–1 truth
probability), `choice` (one option plus the distribution and a confidence), and
`score` (a level on an ordered rubric). Questions in one request run in parallel
against shared state. Confidence is the concentration of the distribution, and
the intended use is a three-way gate: act, confirm, or ask a person.

That gate structures the matcher component. The broader inquiry and mission workflow is outlined in [docs/MISSION-PORTAL.md](docs/MISSION-PORTAL.md). In the matcher, deterministic code owns quantities, capacity, time windows, geography, eligibility and state transitions; the model proposes judgments about "is a flatbed suitable for hauling wet
debris", "does this offer address this need at all", "are these two reported
resources the same thing".

**Jev is reachable two ways.** Directly at `api.typesafe.ai/v1/systemone` with a
TypeSafe key, or through OpenRouter's `/api/alpha/decisions`, which serves the
same System One contract natively — same request, same typed answers, same
distributions — with an OpenRouter key as the bearer token. `.env.example`
documents both. Nothing in the code changes between them; only `TYPESAFE_ENDPOINT`.

**The prototype also ships with a rules-based fallback, and it runs with no key.**
`src/judgment/rules.js` implements exactly the same interface — same questions
in, same typed answers with full distributions out — using a concept lexicon and
weighted token overlap. It exists because the spec requires a fallback for a
single-region hosted API, and because it makes this repository runnable,
testable and measurable with no API key and no network.

It is materially worse than the model, and every number the harness prints is
labelled with the engine that produced it. **A number from the rules fallback is
not a number about the model.** Switching is one environment variable:

```bash
cp .env.example .env            # or: npm run env   (refuses to clobber a filled-in key)
# fill in TYPESAFE_API_KEY, set JUDGMENT_ENGINE=typesafe, and if you are going
# through OpenRouter, TYPESAFE_ENDPOINT=https://openrouter.ai/api/alpha/decisions
node --env-file-if-exists=.env --experimental-sqlite --no-warnings bin/check-typesafe.js --live
```

`JUDGMENT_ENGINE` is an operator override that beats a scenario's stored config,
so the same catalogue can be run through both engines and compared. Every
judgment row records which engine answered, and a hosted call that fails is
recorded as `rules-fallback` — a degraded run can never be quoted as a model run.

## The harness is what separates this from a demo

`harness/score.js` runs a labelled golden set through the pipeline in shadow
mode — no leases taken, so every case sees the identical catalogue — and reports:

- offers reaching a decision with no human involved
- wrong binds at the auto threshold in risk class 1, with the raw counts beside
  the percentage, because a percentage over fourteen binds is not a rate
- auto binds in risk class 3, which must be zero by construction
- median time from offer to a specific reply
- calibration measured on our own data: predicted confidence binned against
  observed accuracy, and the gap
- **every headline number per language**, because an initiative in Latvia carries
  Latvian, Russian and English in one inbox and accuracy is not the same across
  them, and nothing in the vendor documentation will tell you that. Under twenty
  cases in a language it prints the count and refuses to state a rate, and
  `npm run accept` marks those numbers `·` rather than passing or failing them

`--sweep` is the point. The full probability distribution is logged on every
judgment, so a threshold change is evaluated against every historical offer
without calling the model again. That turns a week of argument into a query.

`harness/shadow.js` is the commercial answer to the objection that actually stops
a sale — "we cannot let a machine promise anything on our behalf". It replays a
scenario as a human-coordinated initiative with the pipeline running alongside,
acting on nothing, against a catalogue that changes under it, and reports what
the pipeline would have done differently. It costs a customer nothing to agree to,
and it produces their first honest wrong-bind number.

## What the run on real Jev measured

Three scenarios, 138 messages, three channels, three languages, on
`typesafe/jev-1.13-20260917` reached through OpenRouter's decisions endpoint.
Reproduce with `npm run accept`.

These were measured on 18 September, before Gate 0 and before "decided with no
human" had one shared definition (`harness/definitions.js`: a message set aside as
a possible attack now counts as reaching a person, because the console shows it).
They have not been rerun since. On the rules engine, Gate 0 changed none of the
159 decisions; only the definition moved the headline.

| | river-cleanup | storm-response | consortium-bid |
|---|---:|---:|---:|
| decision matched the human label | 68.9% | 68.1% | 67.4% |
| …and it was the same need | 68.9% | 63.8% | 67.4% |
| decided with no human | 75.6% | 74.5% | 73.9% |
| binds made | 17 | 17 | 15 |
| wrong binds | 0 | 0 | 0 |
| auto binds in risk class 3 | 0 | 0 | 0 |
| median offer to specific reply | 714 ms | 714 ms | 710 ms |
| cost per message | $0.00011 | $0.00014 | $0.00011 |

**Read the first row before any of the others.** An automation rate on its own
is maximised by a pipeline that decides nothing: answer "not an offer" to every
message and it scores a clean sweep. The label-match row is the anchor that
makes the rest mean something, and at 68% it says plainly that a third of
decisions are not what a human would have made.

**No wrong-bind rate here is a rate.** Zero over fifteen to seventeen binds is
a count, and the report marks it `·` rather than passing it. The number the
spec wants written into a contract needs an order of magnitude more binds than
this, against real messages.

**A threshold from the sweep is a proposal, not a setting.** The sweep scores
every case against the catalogue as it stood at the start, because it takes no
leases. A live run does: needs fill underneath the traffic and later offers meet
a changed board. On river-cleanup the sweep showed zero wrong binds at 0.54 and
a live run at 0.54 produced 4.3% over 23 binds. Every threshold in
`scenarios/*.json` is now recorded with the engine, the model, the question-bank
version and whether it was validated live.

**Thresholds do not transfer between engines.** The values swept on the rules
fallback were 0.88, 0.90 and 0.97; on Jev the same rule gives 0.85, 0.90 and
0.81. Left at the rules-engine values, Jev discarded almost every bind on the
consortium scenario — its label match was 32.6%.

### Two bugs a real model found that the fallback had hidden

Both were invisible for as long as the local rules engine was the only thing
answering, and both are the same shape: a question the model cannot answer as
written.

**The verification pass verified nothing.** `shortlistQuestions` sent three
identical `fits` questions whose only distinguishing information was the
question id — which the client strips before sending. Jev answered ~0.45 to all
three, so nothing ever bound. The rules engine had appeared to work because it
parsed the need id out of the question key, which a hosted model cannot do.

**The question contradicted itself.** It asked whether an offer would "satisfy"
a need while its criteria said "count towards filling it". Twelve volunteers do
not satisfy a need for forty, so Jev answered the literal question: 0.42 on an
obvious match. jev-1.13's own jaggedness page names this exactly — align the
language between instructions and criteria. Quantity belongs to the lease.

A third, found by review rather than by symptom: the fix for the first bug
pasted the need's **full description** into the question, and that description
names the required credential. Measured by ablation on the live model, `fits`
fell from 0.84 to 0.21 once the certificate sentence was present, and rose to
0.89 when the writer merely *claimed* to hold one — an eligibility judgment made
from what somebody says about themselves, which invariant 4 forbids. Questions
now name only the authored sixty-character short form. `bin/check-typesafe.js`
runs every scenario's traffic and outbound pass through the real pipeline and scans
each question it built, and `test/guard.test.js` puts the bug back on purpose to
check that the guard fails. An earlier version of this paragraph said the guard
already did this; it did not — it scanned questions built from its own hard-coded
fixture and passed with the bug put back.

**The golden sets in this repository are synthetic.** They measure whether the
pipeline behaves as designed. They are not the wrong-bind number: that requires
real messages from a real initiative, labelled independently by two people with
the disagreements argued out. Labelling two hundred cases properly is days of
work by somebody from the partner organisation, and it is the most valuable
output of the whole exercise.

## Applying it to something else

Write a scenario pack. There is no code to change.

```
scenarios/<slug>.json
  decision      where the initiative legitimately came from — imported, not authored
  initiative    objective, constraints, window, place, owner
  needs[]       the catalogue: kind, quantity, unit, window, place, qualifications, risk class
  actors[]      contacts per channel, verified credentials, capability records
  traffic[]     optional: messages to replay, each with the label a human would give it
```

`npm run seed` publishes every need through the same editor a person uses, so a
need that would be refused at the keyboard is refused here too. If a scenario
prints `need "x" refused`, that is the system working.

## Deliberately not here

Payments and escrow. The voting and deliberation engine — Decidim has an API, and
importing a decided proposal is a day of work, which is also the commercial
wedge: arrive as the missing half of a platform the customer already runs.
Mobile apps. Any distributed ledger. Multi-tenancy, billing and single sign-on.

Reputation scoring: the prototype records what was delivered and computes no
score from it, because a scoring model built on a hundred data points is worse
than none.

Authentication is a magic link and a cookie, and it says so in the code. A real
deployment needs a real identity provider; nothing in the architecture depends on
which one.

Multi-writer convergence: this prototype has a single writer and a hash chain
over the log, which gives deterministic replay. Genuinely concurrent writes from
several organisations with no central authority is a different mechanism — a
CRDT merge — and it is out of scope here.

## Layout

```
src/db.js                schema. nine objects and the log
src/events.js            the fold. the only thing that writes derived tables
src/extract.js           dates, quantities, places — deterministic, three languages
src/needs.js             the need editor, and what it refuses to publish
src/config.js            thresholds per risk class, rate limits, cost cap
src/judgment/questions.js  the question bank: eleven questions, one versioned file
src/judgment/redact.js   what leaves this machine, and what does not
src/judgment/client.js   the hosted API, with retry and fallback
src/judgment/rules.js    the fallback engine
src/pipeline/prefilter.js  the SQL that keeps the model honest
src/pipeline/leases.js   the lease. invariant two lives here
src/pipeline/admit.js    the admission pipeline
src/pipeline/outbound.js the same engine, in reverse
src/queue.js             the console's read model, and the labels it writes
src/web/                 the surfaces, server-rendered, no framework
harness/score.js         the measurements, the calibration, the threshold sweep
harness/shadow.js        run beside a human coordinator, acting on nothing
scenarios/               three unalike domains, as data
harness/definitions.js   what "reached a person" and "a specific reply" mean, once
src/judgment/guard.js    scans the questions the pipeline actually builds
docs/                    the outcomes, the constraints, the decision log
test/                    117 tests (see test/README.md); boundaries.test.js is Gate 0
bin/check-typesafe.js    what would leave this machine, checked before it does
```
