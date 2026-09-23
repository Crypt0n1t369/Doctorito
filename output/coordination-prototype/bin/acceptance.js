#!/usr/bin/env node
import { REACHES_A_PERSON } from '../harness/definitions.js';
import { open, one, all } from '../src/db.js';
import { loadScenario, listScenarios, seedScenario } from '../src/seed.js';
import { admit } from '../src/pipeline/admit.js';
import { expireDueLeases, confirmByToken } from '../src/pipeline/leases.js';
import { recomputeNeed, verifyChain, rebuild, stateFingerprint } from '../src/events.js';
import { configFor, mayAutoBind } from '../src/config.js';

/**
 * The acceptance test.
 *
 * One initiative, three live channels, and a measured run — not a scripted
 * demo. This runs the scenario's traffic for real: leases are taken, needs
 * close, replies are sent. The five numbers below are the ones section one of
 * the spec says have to be true, and they are printed as measurements rather
 * than as claims.
 *
 * The targets are proposals, not findings. The first run against real messages
 * from a real body sets the real baseline, and the point of the exercise is to
 * learn what the honest number is before anyone sells against it.
 */
const args = process.argv.slice(2);
const ENOUGH = 20;   // below this a rate is an anecdote with a decimal point on it
const slugs = pick('--scenario') ? [pick('--scenario')] : listScenarios();
const BASE = new Date('2026-09-20T08:00:00Z');

let failures = 0;
for (const slug of slugs) await runOne(slug);
process.exit(failures ? 1 : 0);

async function runOne(slug) {
  const db = open(':memory:');
  const scenario = loadScenario(slug);
  const { initiative, needRefs } = seedScenario(db, scenario);
  const cfg = configFor(initiative);
  const traffic = [...(scenario.traffic ?? [])].sort((a, b) => a.at_offset_minutes - b.at_offset_minutes);
  if (!traffic.length) { console.log(`\n${slug}: no traffic in the scenario pack, skipping`); return; }

  const rows = [];
  for (const m of traffic) {
    const now = new Date(BASE.getTime() + m.at_offset_minutes * 60_000);
    const live = one(db, 'select * from initiatives where initiative_id=?', initiative.initiative_id);
    const r = await admit(db, {
      initiative: live, channel: m.channel, handle: m.handle, displayName: m.name,
      text: m.text, now, baseUrl: 'http://localhost:8787',
    });
    rows.push({ m, r, expectedNeedId: m.expect?.need_ref ? needRefs[m.expect.need_ref] : null });
  }

  const later = new Date(BASE.getTime() + 36 * 3600e3);
  expireDueLeases(db, later);
  for (const c of all(db, `select * from commitments where state='proposed' and initiative_id=?`, initiative.initiative_id)) {
    confirmByToken(db, c.token, later);
  }

  // --- the five measures ----------------------------------------------------
  const total = rows.length;
  const reachedAPerson = rows.filter((x) => REACHES_A_PERSON.has(x.r.decision)).length;
  const autoShare = total ? (total - reachedAPerson) / total : 0;

  const realOffers = rows.filter((x) => ['bound', 'asked', 'full', 'no_match'].includes(x.m.expect?.decision));
  const realAuto = realOffers.length
    ? realOffers.filter((x) => !REACHES_A_PERSON.has(x.r.decision)).length / realOffers.length : null;

  const class1Binds = rows.filter((x) => x.r.decision === 'bound' && x.r.risk_class === 1);
  const class1Wrong = class1Binds.filter((x) => {
    if (x.m.expect?.decision !== 'bound') return true;
    return x.r.need_id !== x.expectedNeedId;
  });
  const wrongRate = class1Binds.length ? class1Wrong.length / class1Binds.length : null;

  // Every path counts, not only the pipeline's own: a class 3 commitment that no
  // coordinator bound is a violation whether it came from an offer, an
  // outbound invitation or anything added later (docs/CONSTRAINTS.md, C2).
  const class3Auto = all(db, `
    select c.commitment_id from commitments c join needs n on n.need_id=c.need_id
     where c.initiative_id=? and n.risk_class=3 and c.bound_by not like 'coordinator:%'`, initiative.initiative_id);

  // Without this, every measure below is maximised by a pipeline that decides
  // nothing: answering "not an offer" to all 45 messages scores a clean sweep.
  const labelled = rows.filter((x) => x.m.expect?.decision);
  const decisionMatch = labelled.filter((x) => x.r.decision === x.m.expect.decision).length;
  const fullyCorrect = labelled.filter((x) =>
    x.r.decision === x.m.expect.decision &&
    (!x.expectedNeedId || x.r.need_id === x.expectedNeedId)).length;

  const lat = rows.map((x) => x.r.latency_ms).sort((a, b) => a - b);
  const median = lat[Math.floor(lat.length / 2)];

  // A false "filled" is worse than an unfilled need, so this is checked against
  // the commitment rows themselves rather than against the derived column.
  const closureErrors = [];
  for (const n of all(db, 'select * from needs where initiative_id=?', initiative.initiative_id)) {
    const truth = one(db, `select coalesce(sum(qty),0) q from commitments
                            where need_id=? and state in ('confirmed','fulfilled')`, n.need_id).q;
    if (Math.abs(truth - n.qty_committed) > 1e-9) closureErrors.push(`${n.need_id}: qty_committed ${n.qty_committed} but confirmed sum ${truth}`);
    if (n.status === 'filled' && truth < n.qty_required) closureErrors.push(`${n.need_id}: reported filled while short`);
    if (n.status === 'open' && truth >= n.qty_required && n.qty_required > 0) closureErrors.push(`${n.need_id}: reported open while covered`);
    if (!n.allow_overcommit && truth > n.qty_required + 1e-9) closureErrors.push(`${n.need_id}: overcommitted ${truth} > ${n.qty_required}`);
  }

  const chain = verifyChain(db);
  const before = stateFingerprint(db);
  rebuild(db);
  const after = stateFingerprint(db);

  const j = one(db, 'select count(*) c, sum(cost_usd) cost, sum(input_tokens) tok from judgments where initiative_id=?', initiative.initiative_id);
  // Every engine that ran, with its count. Reading one arbitrary row meant a
  // vendor outage after the first call was reported as a full model run with
  // the fallback warning suppressed.
  const engines = all(db, `select engine, model_version, count(*) n from judgments
                            where initiative_id=? group by engine, model_version order by n desc`,
    initiative.initiative_id);
  const engine = engines[0] ?? null;
  const impure = engines.filter((e) => e.engine !== 'typesafe');

  // --- report ---------------------------------------------------------------
  console.log(`\n${'─'.repeat(92)}`);
  console.log(`  ACCEPTANCE RUN · ${scenario.title}`);
  console.log(`  ${total} messages on ${new Set(rows.map((x) => x.m.channel)).size} channels · engine ${engine?.engine ?? 'n/a'} (${engine?.model_version ?? '-'})`);
  if (engines.length > 1) {
    console.log(`  engines that answered: ${engines.map((e) => `${e.engine} x${e.n}`).join(', ')}`);
  }
  if (impure.length) {
    console.log(`  ⚠ ${impure.reduce((a, e) => a + e.n, 0)} of ${engines.reduce((a, e) => a + e.n, 0)} judgments did NOT come from the judgment model` +
      ` (${impure.map((e) => `${e.engine} x${e.n}`).join(', ')}).`);
    console.log(`    They say the pipeline behaves as designed. They are not a claim about model accuracy.`);
  }
  console.log(`${'─'.repeat(92)}`);
  console.log(pad('  Measure', 50) + pad('Target', 24) + pad('Measured', 18));
  row('Decision matched the human label', 'the anchor', pct(decisionMatch / (labelled.length || 1)), null, labelled.length);
  row('  …and it was the same need', '', pct(fullyCorrect / (labelled.length || 1)), null, labelled.length);
  row('Offers reaching a decision with no human', '70% or better', pct(autoShare), autoShare >= 0.70);
  if (realAuto != null) {
    row('  …of messages a human called a real offer', '', pct(realAuto), realAuto >= 0.70, realOffers.length);
  }
  row('Wrong binds at auto threshold, risk class 1', '2% or less',
    wrongRate == null ? 'no binds' : pct(wrongRate), wrongRate == null ? null : wrongRate <= 0.02, class1Binds.length);
  row('Auto binds in risk class 3', 'zero, by construction', String(class3Auto.length), class3Auto.length === 0);
  row('Median time from offer to a specific reply', 'under 5 s', `${median} ms`, median < 5000);
  row('Needs correctly reported as closed', '100%',
    closureErrors.length ? `${closureErrors.length} wrong` : 'all', closureErrors.length === 0);
  console.log(`${'─'.repeat(92)}`);
  console.log(`  · marks a number measured over fewer than ${ENOUGH} cases: printed, not judged.`);
  console.log(`  log: ${chain.count} events, chain ${chain.ok ? 'verifies' : 'BROKEN at seq ' + chain.seq}; ` +
    `replay is ${before === after ? 'identical' : 'DIVERGENT'}`);
  console.log(`  cost: ${j.c} judgments, ${(j.tok ?? 0).toLocaleString()} input tokens, $${(j.cost ?? 0).toFixed(4)} ` +
    `(${total ? '$' + ((j.cost ?? 0) / total).toFixed(6) : '-'} per message)`);

  if (class1Wrong.length) {
    console.log(`\n  the wrong binds, verbatim — this is the list that matters:`);
    for (const x of class1Wrong.slice(0, 10)) {
      const got = one(db, 'select description_short from needs where need_id=?', x.r.need_id);
      const want = x.expectedNeedId ? one(db, 'select description_short from needs where need_id=?', x.expectedNeedId) : null;
      console.log(`   · "${x.m.text.replace(/\s+/g, ' ').slice(0, 62)}"`);
      console.log(`     bound to  ${got?.description_short} (${x.r.confidence.toFixed(2)})`);
      console.log(`     should be ${want ? want.description_short : x.m.expect?.decision}`);
    }
  }
  if (closureErrors.length) {
    console.log(`\n  closure errors:`);
    for (const e of closureErrors.slice(0, 10)) console.log(`   · ${e}`);
  }

  if (class3Auto.length || closureErrors.length || !chain.ok || before !== after) failures++;

  console.log(`  the exit code reflects invariants only — a class 3 auto-bind, a closure error, a`);
  console.log(`  broken chain or a divergent replay. It says nothing about the measures above,`);
  console.log(`  which are proposals and are allowed to miss.`);
}

/**
 * A rate over a handful of cases is an anecdote with a decimal point on it, so
 * below twenty it is printed and not judged. That is the same rule the harness
 * applies, and applying it here too is what stops a run of two binds being
 * quoted either way.
 */
function row(label, target, measured, pass, n = null) {
  const thin = n != null && n < ENOUGH;
  const mark = thin ? '·' : pass === null ? ' ' : pass ? '✓' : '✗';
  const count = n != null ? `  (n=${n})` : '';
  console.log(pad('  ' + label, 50) + pad(target, 24) + pad(measured + count, 18) + mark);
}
function pad(s, n) { return String(s).padEnd(n).slice(0, n); }
function pct(x) { return `${(x * 100).toFixed(1)}%`; }
function pick(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
