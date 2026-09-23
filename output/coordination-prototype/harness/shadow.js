#!/usr/bin/env node
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { open, one, all } from '../src/db.js';
import { listScenarios, loadScenario, seedScenario } from '../src/seed.js';
import { admit } from '../src/pipeline/admit.js';
import { takeLease, autoConfirm } from '../src/pipeline/leases.js';
import { configFor } from '../src/config.js';
import { quantityFor } from '../src/extract.js';
import { emit } from '../src/events.js';
import { id } from '../src/ids.js';

/**
 * Below twenty a rate is an anecdote with a decimal point on it. score.js and
 * acceptance.js both say so; this file used to be the exception, and it is the
 * one the README calls the customer's first honest wrong-bind number.
 */
const ENOUGH = 20;

/**
 * Shadow mode.
 *
 * The objection that stops a sale is not technical. It is "we cannot let a
 * machine promise anything on our behalf", and argument does not move it. A
 * sequence does: run with no actions at all, then automatic binds in risk class
 * 1 only, then widen once a measured wrong-bind rate is on the table. This file
 * is the first step, and it costs the customer nothing to agree to.
 *
 * It replays a scenario's traffic as a human-coordinated initiative. For every
 * message the pipeline runs with shadow:true — judgments are written, nothing
 * is sent and nothing is bound — and then the coordinator's own action is
 * applied for real. The catalogue therefore evolves exactly as it did under
 * human coordination and the pipeline is scored against a catalogue that keeps
 * changing underneath it, which is what a static golden set cannot do.
 */

const args = process.argv.slice(2);
const slug = pick('--scenario') ?? listScenarios()[0];
const dbPath = pick('--db') ?? 'data/shadow.db';
const jsonPath = pick('--json') ?? `data/shadow-${slug}.json`;
const WHO = 'coordinator:replay';
const PRINT_MAX = 25;

/** The clock bin/demo.js replays against, so the two runs are comparable. */
const BASE = new Date('2026-09-20T08:00:00Z');

/**
 * Decisions that end a message without a coordinator reading it. `queued` is
 * the opposite by definition and `not_an_offer` still lands in front of a
 * person, because the reply we send promises one. Being counted here does not
 * make a decision right: a wrong bind saves work too, which is why the
 * wrong-bind numbers are printed above this one.
 */
const NO_HUMAN = new Set(['bound', 'answered', 'withdrawn', 'full', 'no_match', 'rejected', 'asked']);

// A shadow run is a replay from the first message or it is nothing, so the
// database it is handed is rebuilt every time.
for (const s of ['', '-wal', '-shm']) { try { rmSync(dbPath + s); } catch { /* not there */ } }

const db = open(dbPath);
const scenario = loadScenario(slug);
const { initiative, needRefs, refused } = seedScenario(db, scenario);
const cfg = configFor(initiative);
const refOf = Object.fromEntries(Object.entries(needRefs).map(([ref, nid]) => [nid, ref]));
const traffic = [...(scenario.traffic ?? [])].sort((a, b) => a.at_offset_minutes - b.at_offset_minutes);

if (!traffic.length) {
  console.log(`  ${slug} has no traffic[] to replay. Shadow mode needs messages and the decisions a human made about them.`);
  process.exit(1);
}

const rows = [];
for (const m of traffic) {
  const now = new Date(BASE.getTime() + m.at_offset_minutes * 60_000);
  const live = one(db, 'select * from initiatives where initiative_id=?', initiative.initiative_id);

  const seen = await admit(db, {
    initiative: live, channel: m.channel, handle: m.handle, displayName: m.name,
    text: m.text, now, shadow: true,
  });
  const human = applyCoordinator({ initiative: live, entry: m, seen, now });
  rows.push(row(m, now, seen, human));
}

report(rows);

// ---------------------------------------------------------------------------

/**
 * The coordinator's own action, applied for real. In a live shadow run this is
 * whatever the human did in their own tools; in a replay it is the traffic
 * entry's expectation, which is the same thing recorded after the fact.
 */
function applyCoordinator({ initiative, entry, seen, now }) {
  const action = entry.expect?.decision ?? 'queued';
  const needId = entry.expect?.need_ref ? needRefs[entry.expect.need_ref] ?? null : null;
  const out = { action, need_id: needId, applied: false, unapplied: null };

  if (action === 'bound' && needId) {
    // takeLease refuses to bind without a judgment id and is right to: a
    // commitment that cannot name a judgment cannot be defended later. The one
    // named here is the shadow judgment written for this same offer a moment
    // ago — it is on the record and it is about this text — while bound_by says
    // a coordinator decided, not the pipeline, and the override row below says
    // whether the two agreed. Where the pipeline wrote no judgment at all there
    // is nothing to name and nothing worth fabricating, so the bind is left
    // unapplied and counted as such in the report.
    const judgmentId = seen.judgments?.at(-1) ?? null;
    const need = one(db, 'select * from needs where need_id=?', needId);
    if (!judgmentId) out.unapplied = 'no judgment to name';
    else if (!need) out.unapplied = 'need not in this catalogue';
    else {
      const offer = one(db, 'select * from offers where offer_id=?', seen.offer_id);
      const extracted = JSON.parse(offer.extracted ?? '{}');
      const lease = takeLease(db, {
        need, initiative, offer, actorId: seen.actor_id,
        qty: quantityFor(extracted.quantities ?? [], need.unit) ?? 1,
        confidence: null, boundBy: WHO, judgmentId, cfg, now,
      });
      if (!lease.ok) out.unapplied = lease.reason;
      else {
        autoConfirm(db, lease.commitment_id, now);
        out.applied = true;
        out.qty = lease.qty;
        out.commitment_id = lease.commitment_id;
      }
    }
  }

  // The whole comparison is recoverable from the log alone, without this file.
  emit(db, {
    type: 'coordinator.override', initiative_id: initiative.initiative_id, author: WHO,
    payload: {
      override_id: id('ov'), judgment_id: seen.judgments?.at(-1) ?? null, offer_id: seen.offer_id,
      coordinator: WHO, action, chosen_need_id: needId, model_need_id: seen.need_id ?? null,
      agreed: agrees(seen, action, needId) ? 1 : 0, note: out.unapplied, seconds_taken: null,
    },
    at: now.toISOString(),
  });

  return out;
}

function agrees(seen, action, needId) {
  return seen.decision === action && (!needId || seen.need_id === needId);
}

function row(entry, now, seen, human) {
  const humanBound = human.action === 'bound' && !!human.need_id;
  const pipeBound = seen.decision === 'bound';
  let bucket;
  if (humanBound && pipeBound) bucket = seen.need_id === human.need_id ? 'bound_same' : 'bound_other';
  else if (humanBound && ['queued', 'asked'].includes(seen.decision)) bucket = 'bound_queued';
  else if (humanBound) bucket = 'bound_missed';
  else bucket = pipeBound ? 'unbound_bound' : 'unbound_other';

  const need = seen.need_id ? one(db, 'select * from needs where need_id=?', seen.need_id) : null;
  return {
    id: entry.id ?? null,
    at: now.toISOString(),
    channel: entry.channel, handle: entry.handle, language: seen.language,
    text: entry.text,
    pipeline: {
      decision: seen.decision, need_id: seen.need_id ?? null, need_ref: refOf[seen.need_id] ?? null,
      confidence: seen.confidence ?? null, threshold: seen.threshold ?? null,
      risk_class: need?.risk_class ?? null, reason: seen.reason ?? null,
      shortlist: (seen.shortlist ?? []).map((s) => ({
        need_ref: refOf[s.need_id] ?? s.need_id, confidence: s.confidence,
      })),
    },
    coordinator: {
      action: human.action, need_id: human.need_id, need_ref: refOf[human.need_id] ?? null,
      applied: human.applied, unapplied: human.unapplied,
    },
    agreed: agrees(seen, human.action, human.need_id),
    bucket,
    no_human: NO_HUMAN.has(seen.decision),
  };
}

// ---------------------------------------------------------------------------

function report(rows) {
  const n = rows.length;
  const c = (b) => rows.filter((r) => r.bucket === b).length;
  const agreed = rows.filter((r) => r.agreed).length;
  const saved = rows.filter((r) => r.no_human).length;
  const humanBound = c('bound_same') + c('bound_other') + c('bound_queued') + c('bound_missed');
  const humanNot = n - humanBound;
  const unapplied = rows.filter((r) => r.coordinator.action === 'bound' && r.coordinator.need_id && !r.coordinator.applied);

  const class1 = rows.filter((r) => r.pipeline.decision === 'bound' && r.pipeline.risk_class === 1);
  const class1Wrong = class1.filter((r) => r.bucket !== 'bound_same');
  const j = one(db, 'select count(*) c, coalesce(sum(cost_usd),0) cost from judgments where initiative_id=?', initiative.initiative_id);

  say(`\n  Shadow run · ${scenario.title ?? slug}`);
  say(`  ${n} messages replayed against the decisions a human coordinator actually made.`);
  say(`  The pipeline ran beside them and acted on nothing: no message sent, no commitment taken.`);
  // What actually answered, not what was configured. A run where every call
  // fell back to the local rules engine used to print, and record, as a model run.
  const engines = all(db, `select engine, count(*) n from judgments group by engine order by n desc`);
  const impure = engines.filter((e) => e.engine !== 'typesafe');
  say(`  engine ${engines.map((e) => `${e.engine} x${e.n}`).join(', ') || cfg.engine} · ` +
      `${j.c} judgments written · $${j.cost.toFixed(4)} · db ${resolve(dbPath)}`);
  if (impure.length && cfg.engine === 'typesafe') {
    say(`  ⚠ ${impure.reduce((a, e) => a + e.n, 0)} judgment(s) did not come from the judgment model.`);
    say(`    Nothing below is a claim about model accuracy.`);
  }
  for (const r of refused) say(`  ! need "${r.ref}" refused by the editor: ${r.errors.join(' ')}`);

  say(`\n  ── would it have promised anything on our behalf ──────────────────────────`);
  say(stat('Messages the coordinator did not bind', humanNot, n));
  say(stat('  the pipeline would have bound anyway', c('unbound_bound'), humanNot));

  say(`\n  ── the ${humanBound} messages the coordinator did bind ${'─'.repeat(Math.max(3, 47 - String(humanBound).length))}`);
  say(stat('  pipeline bound the same need', c('bound_same'), humanBound));
  say(stat('  pipeline bound a different need', c('bound_other'), humanBound) + '   wrong bind');
  say(stat('  pipeline queued or asked instead', c('bound_queued'), humanBound));
  say(stat('  pipeline did not offer to bind at all', c('bound_missed'), humanBound));

  say(`\n  ── the rest of it ────────────────────────────────────────────────────────`);
  say(stat('Agreed with the coordinator, message by message', agreed, n));
  say(stat('Would have been resolved with no coordinator', saved, n));
  if (unapplied.length) say(stat('Coordinator binds shadow mode could not apply', unapplied.length, humanBound));

  const dis = rows.filter((r) => !r.agreed);
  say(`\n  ── every disagreement ────────────────────────────────────────────────────`);
  if (!dis.length) say(`  None. The pipeline made the coordinator's decision on all ${n} messages.`);
  dis.slice(0, PRINT_MAX).forEach((r, i) => say(disagreement(r, i + 1)));
  if (dis.length > PRINT_MAX) say(`\n  … and ${dis.length - PRINT_MAX} more. All ${dis.length} are in ${jsonPath}.`);

  say(`\n  ── what this run supports ────────────────────────────────────────────────`);
  if (!class1.length) {
    say(`  The pipeline would have made no risk class 1 binds on this run, so it`);
    say(`  measured no class 1 wrong-bind rate. There is nothing here to turn on yet.`);
  } else {
    say(`  On this run the pipeline would have made ${class1.length} automatic bind${s(class1.length)} in risk class 1.`);
    say(`  ${class1Wrong.length} of them went somewhere the coordinator did not: a class 1 wrong-bind rate`);
    say(`  of ${pct(class1Wrong.length, class1.length)} over ${class1.length} bind${s(class1.length)}, on ${n} message${s(n)} of this scenario.`);
    say(`  Class 2 and class 3 are not in that number. Class 3 never binds automatically.`);
  }

  const out = {
    scenario: slug, title: scenario.title ?? null, initiative_id: initiative.initiative_id,
    ran_at: new Date().toISOString(), replay_base: BASE.toISOString(),
    engine: cfg.engine, engines_that_answered: engines, judgments: j.c, cost_usd: j.cost,
    messages: n,
    agreement_rate: rate(agreed, n),
    work_saved_rate: rate(saved, n),
    coordinator_bound: {
      total: humanBound, same_need: c('bound_same'), different_need: c('bound_other'),
      queued_or_asked: c('bound_queued'), not_offered: c('bound_missed'),
      unapplied: unapplied.length,
    },
    coordinator_did_not_bind: { total: humanNot, pipeline_bound_anyway: c('unbound_bound') },
    class_1: { binds: class1.length, wrong: class1Wrong.length, wrong_rate: rate(class1Wrong.length, class1.length) },
    disagreements: dis,
    rows,
  };
  mkdirSync(dirname(resolve(jsonPath)), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  say(`\n  ${rows.length} rows and all ${dis.length} disagreement${s(dis.length)} written to ${jsonPath}\n`);
}

function disagreement(r, i) {
  const p = r.pipeline;
  const head = `  ${String(i).padStart(2)}. ${r.channel}:${r.handle} · ${r.at.slice(5, 16).replace('T', ' ')} · ${r.language}`;
  const said = wrap(r.text.replace(/\s+/g, ' '), 72).map((l) => `      "${l}"`).join('\n');
  const mine = `${p.decision}${p.need_ref ? ' → ' + p.need_ref : ''}` +
    (p.confidence != null ? ` at ${p.confidence.toFixed(2)}` : '') +
    (p.threshold != null && Number.isFinite(p.threshold) ? ` (threshold ${p.threshold})` : '') +
    (p.reason ? ` [${p.reason}]` : '');
  const theirs = `${r.coordinator.action}${r.coordinator.need_ref ? ' → ' + r.coordinator.need_ref : ''}` +
    (r.coordinator.unapplied ? ` [not applied: ${r.coordinator.unapplied}]` : '');
  const between = p.shortlist.length
    ? p.shortlist.map((sl) => `${sl.need_ref} ${sl.confidence.toFixed(2)}`).join(' · ')
    : 'nothing survived the filter';
  return `\n${head}\n${said}\n      coordinator: ${theirs}\n      pipeline:    ${mine}\n      choosing between: ${between}`;
}

// ---------------------------------------------------------------------------

function stat(label, num, den) {
  const thin = den && den < ENOUGH;
  const tail = den
    ? ` of ${String(den).padEnd(4)} ${(thin ? '  n<20' : pct(num, den)).padStart(6)}`
    : '';
  return `  ${label.padEnd(50)} ${String(num).padStart(4)}${tail}`;
}
function pct(num, den) { return den ? `${(100 * num / den).toFixed(1)}%` : '—'; }
function rate(num, den) { return den ? Math.round((num / den) * 1e4) / 1e4 : null; }
function s(n) { return n === 1 ? '' : 's'; }

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function pick(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function say(x) { console.log(x); }
