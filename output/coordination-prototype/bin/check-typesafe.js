#!/usr/bin/env node
import { widePassQuestions, shortlistQuestions, editorQuestions, outboundQuestions, VERSION, BANK_HASH, BANK } from '../src/judgment/questions.js';
import { buildState } from '../src/judgment/redact.js';
import { systemOne } from '../src/judgment/client.js';
import { extract } from '../src/extract.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { scanScenario } from '../src/judgment/guard.js';
import { listScenarios } from '../src/seed.js';

/**
 * Check what we would actually send, against the documented API, before
 * spending anybody's money — and then, if a key is present, send exactly one
 * real request so the switch from the fallback to the model is one env var and
 * not a debugging afternoon.
 *
 *   node --experimental-sqlite --no-warnings bin/check-typesafe.js
 *   TYPESAFE_API_KEY=... node --experimental-sqlite --no-warnings bin/check-typesafe.js --live
 *
 * Request shape, from docs.typesafe.ai/api.md:
 *   POST https://api.typesafe.ai/v1/systemone   Authorization: Bearer <key>
 *   { state, model, questions: { <id>: { type, instructions, criteria } } }
 */
const live = process.argv.includes('--live');

const initiative = { objective: 'Clear and reopen four kilometres of riverbank before winter.', place: 'Ogre', window_start: '2026-10-01T00:00:00Z', window_end: '2026-10-31T00:00:00Z' };
const offerText = 'Hi, this is Janis Berzins (+371 29123456, janis@example.lv). I can bring a 7.5 t flatbed on Saturday.';
const candidates = [
  { id: 'nd_a', short: 'Flatbed lorry 5t+, Sat, haul branches' },
  { id: 'nd_b', short: '20 volunteers with gloves, Sat morning' },
  { id: 'nd_c', short: 'Certified chainsaw operator, Sat' },
];

const extracted = extract(offerText, { now: new Date('2026-09-20T09:00:00Z') });
const { state, redactions } = buildState({ initiative, offerText, names: ['Janis Berzins'], extracted, candidates });

const problems = [];

// 1. Structural conformance to the three documented primitives.
for (const [name, qs] of Object.entries({
  wide: widePassQuestions(candidates),
  shortlist: shortlistQuestions(candidates),
  editor: editorQuestions(),
  outbound: outboundQuestions(candidates.map((c) => ({ id: c.id, capability: c.short }))),
})) {
  for (const [qid, q] of Object.entries(qs)) {
    if (!['noul', 'choice', 'score'].includes(q.type)) problems.push(`${name}.${qid}: type "${q.type}" is not a primitive`);
    if (!q.instructions || typeof q.instructions !== 'string') problems.push(`${name}.${qid}: instructions must be a non-empty string`);
    if (q.type === 'choice') {
      if (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria)) problems.push(`${name}.${qid}: choice criteria must be an option -> description map`);
      else if (Object.keys(q.criteria).length < 2) problems.push(`${name}.${qid}: choice needs at least two options`);
    }
    if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2) problems.push(`${name}.${qid}: score criteria must be an array of at least two levels`);
    }
    if (q.type === 'noul' && q.criteria && (Array.isArray(q.criteria) || !('true' in q.criteria && 'false' in q.criteria))) {
      problems.push(`${name}.${qid}: noul criteria, when present, carry true and false`);
    }
  }
}

// 2. The rule that does not bend: contributor text is data, never instruction.
const wire = JSON.stringify(widePassQuestions(candidates)) + JSON.stringify(shortlistQuestions(candidates));
for (const fragment of ['Janis', '29123456', 'flatbed', 'example.lv']) {
  if (wire.includes(fragment)) problems.push(`contributor text leaked into a question's wording: "${fragment}"`);
}
if (!JSON.stringify(state).includes('UNTRUSTED')) problems.push('state does not fence the contributor text');
for (const fragment of ['Janis', 'Berzins', '29123456', 'janis@example.lv']) {
  if (JSON.stringify(state).includes(fragment)) problems.push(`identity survived redaction and would leave this machine: "${fragment}"`);
}

// 3. Nothing asks the model to count, to order dates, or to do arithmetic.
const forbidden = /\b(how many|count the|count how|earlier than|later than|add up|subtract)\b/i;
const built = {
  ...widePassQuestions(candidates),
  ...shortlistQuestions(candidates.map((c) => ({ ...c, label: c.short }))),
  ...editorQuestions(),
  ...outboundQuestions(candidates.map((c) => ({ id: c.id, capability: c.short, label: c.short }))),
};
for (const [qid, q] of Object.entries(built)) {
  if (forbidden.test(q.instructions)) problems.push(`question "${qid}" as sent asks the model to reason about order or arithmetic`);
}

// 4. The questions the pipeline actually built, from each real catalogue and
// its traffic: no contributor text in any wording, and no need named by the
// full description that carries its credential clauses (src/judgment/guard.js).
const scanned = [];
for (const slug of listScenarios()) {
  const r = await scanScenario(slug);
  scanned.push(r);
  problems.push(...r.problems);
}

console.log(`\n  question bank   ${VERSION}+${BANK_HASH}  (${Object.keys(BANK).length} questions)`);
console.log(`  redactions      ${redactions} identifiers removed before the state was built`);
console.log(`  state size      ${JSON.stringify(state).length} bytes`);
console.log(`  wide request    ${Object.keys(widePassQuestions(candidates)).length} questions in one call`);
for (const r of scanned) console.log(`  scanned         ${r.slug}: ${r.questions} questions in ${r.judgments} requests the pipeline built`);
console.log(`\n  ${'state that would leave this machine'}`);
console.log(indent(JSON.stringify(state, null, 2)));

if (problems.length) {
  console.log(`\n  ✗ ${problems.length} problem${problems.length > 1 ? 's' : ''}:`);
  for (const p of problems) console.log(`    · ${p}`);
} else {
  console.log(`\n  ✓ request conforms to the documented API and to the rules that do not bend`);
}

if (live) {
  if (!process.env.TYPESAFE_API_KEY) {
    console.log('\n  --live needs TYPESAFE_API_KEY in the environment.');
    process.exit(problems.length ? 1 : 0);
  }
  console.log('\n  sending one real request to api.typesafe.ai …');
  // Sending this synthetic request is the explicit purpose of --live, so hosted
  // processing is permitted for it and for nothing else.
  const res = await systemOne({ state, questions: widePassQuestions(candidates), cfg: { ...DEFAULT_CONFIG, engine: 'typesafe', hosted_processing: true } });
  console.log(`  engine ${res.engine} · model ${res.model_version} · ${res.latency_ms} ms · ` +
    `${res.usage.input_tokens} input tokens · $${res.cost_usd.toFixed(6)}`);
  console.log(indent(JSON.stringify(res.answers, null, 2)));
  if (res.engine !== 'typesafe') {
    console.log(`  ✗ the call fell back to the rules engine: ${res.fallback_reason}`);
    process.exit(1);
  }
}

process.exit(problems.length ? 1 : 0);

function indent(s) { return s.split('\n').map((l) => '  ' + l).join('\n'); }
