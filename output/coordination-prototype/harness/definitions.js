/**
 * What the measures mean, defined once and imported by every report
 * (harness/score.js, harness/shadow.js, bin/acceptance.js). Three files used
 * to define "decided with no human" three ways, and the same 168 records came
 * out at 69.6%, 67.8% and 64.3% depending on which one was asked
 * (docs/OUTCOMES.md, C9).
 *
 * The definitions follow what the product actually does, not what a label
 * would like it to do:
 *
 *   - A decision reaches a person when it lands in the coordinator console.
 *     The console shows queued offers and offers the screen set aside as
 *     possible attacks (src/queue.js, IN_REVIEW). A case that threw reached a
 *     person too, because somebody has to find out why.
 *   - A reply is specific when it names something: the need taken, the
 *     question asked, the facts answered, the list still open, the commitment
 *     released. "We could not find an offer" and "a person will look" name
 *     nothing, so neither counts towards the reply-time promise.
 */
export const REACHES_A_PERSON = new Set(['queued', 'rejected', 'error']);

export const SPECIFIC_REPLY = new Set(['bound', 'asked', 'answered', 'no_match', 'full', 'withdrawn']);

export function decidedWithoutAPerson(decision) {
  return !REACHES_A_PERSON.has(decision);
}

/**
 * Scenario packs whose name starts with an underscore are test fixtures. They
 * are measured when asked for by name and never pooled into a headline.
 */
export function isFixture(slug) {
  return String(slug).startsWith('_');
}
