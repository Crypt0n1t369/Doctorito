# What each file protects

Run them all with `npm test`. They build state by emitting real events into an
in-memory database, the way the product does — there are no mocks of our own
modules, because a mock of the ledger would not catch the bugs that matter.

**`invariants.test.js`** — the seven properties everything else assumes. That
state is a fold over the log and replays identically; that the hash chain names
the event if somebody rewrites one; that two offers arriving together cannot
both take the last place; that `qty_committed` is derived rather than written;
that eligibility is decided by verified credentials and never by what somebody
claims about themselves; that no commitment exists without a judgment written
first; that a quantity cannot change without an author and a public reason; and
that a contributor cannot sign off their own delivery. A failure here means the
board is lying about something, which is the one failure the whole design exists
to prevent.

**`gates.test.js`** — the decisions that are refusals. Risk class 3 has no
automatic path at any confidence, and the test asserts that this is structural
(`mayAutoBind(3)` is false, `thresholdFor(cfg, 3)` is infinity) rather than a
number somebody could edit under pressure. The per-initiative switch takes
effect on the next message. Class 2 proposes and waits for a tap while class 1
stands. A flood queues instead of spending. And contributor text reaches the
model only inside the fenced state, never inside a question's wording — asserted
over every question in the request, so it keeps holding when the bank changes. A
failure here is the one that ends a sale.

**`extract.test.js`** — the deterministic parsers, and the privacy claim. The
date cases are the ones that actually broke during development: "7.5 t" read as
the seventh of May, a decimal mistaken for a date, Russian weekdays invisible
because JavaScript's `\b` is ASCII-only. The concept tests pin the word-boundary
rule, because phantom shared concepts tie the ranking and a tied ranking is a
coin-flip bind. The last test is the privacy claim itself, tested as a pair: the
verbatim message stays in our database while only the redacted form appears in
the judgment request — including that a phone number cannot leave disguised as a
quantity.

**`needs.test.js`** — what the editor refuses to publish. No quantity, no unit,
no window, a window that ends before it starts, a short form too long for the
ranking pass. Each refusal has to name its field, because a message the author
has to hunt for is a message wasted. A failure here means vague needs reach the
catalogue, and everything downstream degrades quietly rather than loudly.

**`pipeline.test.js`** — end to end on a small catalogue. A clear offer binds and
the reply names the need, the quantity and the link. A vague one is asked exactly
one question, and the answer is read together with the message that prompted it.
Questions are answered from state, chatter is not an offer, a withdrawal releases
the quantity it was holding, and an oversubscribed need caps itself. Every reply
says it is automated and names a person to reach.

**`queue.test.js`** — the coordinator console. That the shortlist can be
reconstructed from the stored judgments a day later, that every action leaves a
labelled override including the ones where the coordinator agreed, and that a
console bind obeys the same ledger as an automatic one. A failure here does not
break the product; it breaks the only supervised data anybody has about which
binds were wrong and why, which is worse.
