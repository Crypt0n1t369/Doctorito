#!/usr/bin/env node
/**
 * The measurement harness. This is what separates the prototype from a demo.
 *
 * Its output is the only honest claim the project can make, so three rules hold
 * everywhere in this file:
 *
 *   - Every percentage is printed next to the raw counts that produced it. A
 *     percentage over fourteen binds is not a rate, and the reader has to be
 *     able to see that without opening the JSON.
 *   - Nothing is rounded in this system's favour. A measure where higher is
 *     better rounds down; a measure where lower is better rounds up.
 *   - Where the labels cannot adjudicate a case, it is counted against the
 *     system and reported separately, rather than dropped.
 *
 *   node --experimental-sqlite --no-warnings harness/score.js [options]
 *     --scenario <slug>  measure one scenario instead of everything measurable
 *     --json <path>      write the JSON report here as well as to harness/out
 *     --sweep            recompute the gate at every threshold from the log
 *
 * Exit status: 1 if any risk class 3 need was auto-bound, which is a structural
 * failure and not a metric. 2 if there was nothing to measure at all.
 */
import { REACHES_A_PERSON, SPECIFIC_REPLY, isFixture } from './definitions.js';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { open, one, all } from '../src/db.js';
import { verifyChain } from '../src/events.js';
import { loadScenario, seedScenario } from '../src/seed.js';
import { configFor, mayAutoBind, thresholdFor } from '../src/config.js';
import { quantityFor, statesUnit } from '../src/extract.js';
import { admit } from '../src/pipeline/admit.js';
import { VERSION as BANK_VERSION, BANK_HASH } from '../src/judgment/questions.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GOLDEN_DIR = join(HERE, 'golden');
const SCENARIO_DIR = join(ROOT, 'scenarios');
const OUT_DIR = join(HERE, 'out');

const W = 100;                                   // every line in the report fits in this
const RULE = '-'.repeat(W - 2);
const HEAVY = '='.repeat(W);

/** Fixed clock: one case per minute, so two runs of the same file agree exactly. */
const CLOCK0 = Date.parse('2026-09-20T08:00:00Z');

const DECISIONS = ['bound', 'queued', 'asked', 'answered', 'not_an_offer',
  'rejected', 'withdrawn', 'no_match', 'full', 'error'];

/** Six characters each, so a ten-column confusion matrix still fits in 100. */
const SHORT = {
  bound: 'bound', queued: 'queued', asked: 'asked', answered: 'answrd',
  not_an_offer: 'notoff', rejected: 'rejctd', withdrawn: 'withdr',
  no_match: 'nomtch', full: 'full', error: 'ERROR',
};

// "Reached a person" and "a specific reply" are defined once, in
// harness/definitions.js, and shared with shadow.js and acceptance.js.

/** Labels a human gave to messages that really are an offer of something. */
const REAL_OFFER_LABELS = new Set(['bound', 'queued', 'asked', 'full', 'no_match']);

/** Labels where the right answer names no need at all. */
const NO_NEED_LABELS = new Set(['not_an_offer', 'answered', 'rejected', 'withdrawn', 'no_match']);

/**
 * The per-minute limit exists so that a flood degrades to queueing rather than
 * to spending. A golden set is a flood by that definition: it arrives in
 * seconds. Raising it here is a measurement artefact and is printed as one. The
 * daily cost cap is left exactly as configured, because a harness that can
 * outspend the initiative's own cap is a worse problem than a slow one.
 */
const HARNESS_RATE_PER_MINUTE = 1e6;

const SWEEP_FROM = 0.50;
const SWEEP_TO = 0.99;
const SWEEP_STEP = 0.01;

/** Below this many cases a rate is an anecdote with a decimal point on it. */
const ENOUGH = 20;

// ---------------------------------------------------------------------------
// arguments and inputs
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { scenario: null, json: null, sweep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') out.scenario = need(argv[++i], '--scenario');
    else if (a === '--json') out.json = need(argv[++i], '--json');
    else if (a === '--sweep') out.sweep = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function need(v, flag) {
  if (v === undefined) throw new Error(`${flag} needs a value`);
  return v;
}

function listing(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();
}

function readGolden(slug) {
  const text = readFileSync(join(GOLDEN_DIR, `${slug}.jsonl`), 'utf8');
  const cases = [];
  text.split('\n').forEach((line, i) => {
    const s = line.trim();
    if (!s || s.startsWith('//')) return;
    try {
      cases.push({ line: i + 1, ...JSON.parse(s) });
    } catch (err) {
      throw new Error(`golden/${slug}.jsonl line ${i + 1}: ${err.message}`);
    }
  });
  return cases;
}

/**
 * Domain packs live in scenarios/. A fixture may carry its own pack next to its
 * golden file so the harness can be run and argued about before the packs land;
 * scenarios/ always wins if both exist.
 */
function scenarioFor(slug) {
  if (existsSync(join(SCENARIO_DIR, `${slug}.json`))) {
    return { scenario: loadScenario(slug, SCENARIO_DIR), from: 'scenarios/' };
  }
  if (existsSync(join(GOLDEN_DIR, `${slug}.json`))) {
    return { scenario: loadScenario(slug, GOLDEN_DIR), from: 'harness/golden/' };
  }
  return null;
}

/**
 * What there is to measure. A scenario with a golden file is measured against
 * the golden file. A scenario without one is measured against the expectations
 * written into its own traffic array, which is a weaker thing — the same person
 * wrote the fixture and the answer — and the report says so on every line that
 * number touches.
 */
function selectJobs(args) {
  const goldens = listing(GOLDEN_DIR, '.jsonl');
  const jobs = [];
  const problems = [];

  for (const slug of goldens) {
    const found = scenarioFor(slug);
    if (!found) {
      problems.push(`golden/${slug}.jsonl has no scenario pack in scenarios/ or harness/golden/; skipped`);
      continue;
    }
    jobs.push({ slug, source: 'golden', pack: found, cases: readGolden(slug) });
  }

  const done = new Set(jobs.map((j) => j.slug));
  for (const slug of listing(SCENARIO_DIR, '.json')) {
    if (done.has(slug)) continue;
    const scenario = loadScenario(slug, SCENARIO_DIR);
    const traffic = scenario.traffic ?? [];
    if (!traffic.length) {
      problems.push(`scenarios/${slug}.json has no golden file and no traffic to fall back on; skipped`);
      continue;
    }
    jobs.push({
      slug, source: 'traffic', pack: { scenario, from: 'scenarios/' },
      cases: traffic.map((t, i) => ({ ...t, line: i + 1, id: `${slug}:t${i + 1}`, provenance: 'scenario traffic' })),
    });
  }

  const picked = args.scenario ? jobs.filter((j) => j.slug === args.scenario) : jobs.filter((j) => !isFixture(j.slug));
  if (args.scenario && !picked.length) {
    problems.push(`--scenario ${args.scenario} matched nothing measurable`);
  }
  return { jobs: picked.sort((a, b) => a.slug.localeCompare(b.slug)), problems };
}

function forHarness(scenario) {
  return { ...scenario, config: { ...(scenario.config ?? {}), rate_per_minute: HARNESS_RATE_PER_MINUTE } };
}

// ---------------------------------------------------------------------------
// the scored pass
// ---------------------------------------------------------------------------

/**
 * Shadow mode is what makes the cases comparable: it takes no lease, so case
 * nine meets exactly the catalogue case one met. The cost is that nothing ever
 * fills, which is why closure gets its own pass below.
 */
async function runJob(job, { sweep = false } = {}) {
  const db = open(':memory:');
  const { initiative, needRefs, refused } = seedScenario(db, forHarness(job.pack.scenario));
  const cfg = configFor(initiative);
  const problems = refused.map((r) => `need "${r.ref}" was refused by the editor: ${r.errors.join(' ')}`);

  const records = [];
  for (const [i, c] of job.cases.entries()) {
    if (c.scenario && c.scenario !== job.slug) {
      problems.push(`case ${c.id ?? c.line} says scenario "${c.scenario}" but sits in ${job.slug}.jsonl`);
    }
    if (c.expect?.decision && !DECISIONS.includes(c.expect.decision)) {
      problems.push(`case ${c.id ?? c.line} expects unknown decision "${c.expect.decision}"`);
    }
    records.push(await scoreCase(db, { initiative, needRefs, slug: job.slug, c, index: i }));
  }
  for (const r of records) {
    if (r.need_ref_unresolved) problems.push(`case ${r.id}: need_ref "${r.expect_need_ref}" is not in the scenario pack`);
  }

  const judgments = all(db, 'select * from judgments order by created_at, rowid');
  const needs = Object.fromEntries(
    all(db, 'select * from needs where initiative_id=?', initiative.initiative_id).map((n) => [n.need_id, n]));
  const gate = sweep ? reconstructAll(db, { records, judgments, needs, initiative, cfg }) : [];
  const chain = verifyChain(db);
  db.close();

  const live = await livePass(job);
  return {
    slug: job.slug, source: job.source, pack_from: job.pack.from,
    title: job.pack.scenario.title ?? job.slug,
    cases: records, judgments, needs, chain, live, problems, gate,
    autobind: initiative.autobind, cfg,
  };
}

async function scoreCase(db, { initiative, needRefs, slug, c, index }) {
  const now = new Date(CLOCK0 + index * 60_000);
  const ref = c.expect?.need_ref ?? null;
  const expectNeedId = ref ? (needRefs[ref] ?? null) : null;

  let r;
  try {
    r = await admit(db, {
      initiative, channel: c.channel, handle: c.handle, displayName: c.name ?? null,
      text: c.text, now, shadow: true,
    });
  } catch (err) {
    // A case that threw is not a case the system decided. It counts as reaching
    // a person and is printed on its own line so that it cannot hide in a rate.
    r = { decision: 'error', error: String(err?.message ?? err).slice(0, 200) };
  }

  const rec = {
    id: c.id ?? `${slug}:${c.line}`, scenario: slug, line: c.line ?? null,
    labelled_language: c.language ?? null, detected_language: r.language ?? null,
    channel: c.channel ?? null, handle: c.handle ?? null,
    provenance: c.provenance ?? 'unstated', difficulty: c.difficulty ?? null,
    expect_decision: c.expect?.decision ?? null, expect_need_ref: ref, expect_need_id: expectNeedId,
    need_ref_unresolved: !!(ref && !expectNeedId),
    decision: r.decision, need_id: r.need_id ?? null, reason: r.reason ?? null,
    confidence: r.confidence ?? null, threshold: Number.isFinite(r.threshold) ? r.threshold : null,
    risk_class: r.risk_class ?? null, latency_ms: r.latency_ms ?? null,
    offer_id: r.offer_id ?? null, actor_id: r.actor_id ?? null,
    judgments: r.judgments ?? [], error: r.error ?? null,
  };
  rec.decision_ok = rec.decision === rec.expect_decision;
  rec.need_verdict = needVerdict(rec);
  rec.correct = rec.decision_ok && rec.need_verdict !== 'wrong';
  rec.wrong_bind = isWrongBind(rec);
  rec.unverifiable_bind = rec.decision === 'bound' && rec.need_verdict === 'unknown';
  rec.reached_a_person = REACHES_A_PERSON.has(rec.decision);
  rec.in_queue = rec.reached_a_person;
  return rec;
}

/** Did it pick the need the label names? 'unknown' when the label cannot say. */
function needVerdict(rec) {
  if (rec.need_ref_unresolved) return 'unknown';
  if (rec.expect_need_id) return rec.need_id === rec.expect_need_id ? 'right' : 'wrong';
  if (NO_NEED_LABELS.has(rec.expect_decision)) return rec.need_id ? 'wrong' : 'right';
  return 'unknown';
}

/**
 * A wrong bind is: the system bound, and the label either names a different
 * need or says it should not have bound at all. A bind the label cannot
 * adjudicate counts as wrong too and is also reported on its own, because the
 * alternative is letting an unlabelled bind improve the number.
 */
function isWrongBind(rec) {
  if (rec.decision !== 'bound') return false;
  return !(rec.expect_decision === 'bound' && rec.need_verdict === 'right');
}

// ---------------------------------------------------------------------------
// the live pass, for closure only
// ---------------------------------------------------------------------------

/**
 * One extra run with binding switched on. Nothing in the shadow pass can say
 * whether a need that reports itself closed really is, because a shadow run
 * takes no leases and so nothing ever closes.
 *
 * This pass follows the scenario's own clock where it has one: a withdrawal two
 * hours later and a lease that expires in between are exactly the timeline
 * effects the closure measure is about.
 */
async function livePass(job) {
  const db = open(':memory:');
  const { initiative } = seedScenario(db, forHarness(job.pack.scenario));
  let errors = 0;
  for (const [i, c] of job.cases.entries()) {
    const offset = Number.isFinite(c.at_offset_minutes) ? c.at_offset_minutes : i;
    try {
      await admit(db, {
        initiative, channel: c.channel, handle: c.handle, displayName: c.name ?? null,
        text: c.text, now: new Date(CLOCK0 + offset * 60_000), shadow: false,
      });
    } catch { errors++; }
  }
  const out = { errors, clock: job.cases.some((c) => Number.isFinite(c.at_offset_minutes)) ? 'scenario offsets' : 'one case per minute', ...closureCheck(db, initiative), ...passCost(db, initiative) };
  // The closure measure comes from this pass, so its engines have to be visible
  // too. Without it the "did not come from the judgment model" banner could be
  // suppressed while this whole measure came from the fallback. Read before the
  // database closes, not after.
  out.engines = all(db, `select engine, count(*) n from judgments group by engine`);
  db.close();
  return out;
}

/**
 * Invariants 3 and 7 checked from the outside: recompute what the needs table
 * claims, from the only rows allowed to say it, and see whether the two agree.
 * A need reporting itself filled while its commitments say otherwise is the
 * exact failure this measure exists to catch.
 */
function closureCheck(db, initiative) {
  const needs = all(db, 'select * from needs where initiative_id=?', initiative.initiative_id);
  const problems = [];
  let filled = 0;
  let commitments = 0;

  for (const n of needs) {
    const sum = one(db, `select coalesce(sum(qty),0) q from commitments
                          where need_id=? and state in ('confirmed','fulfilled')`, n.need_id).q;
    commitments += one(db, `select count(*) c from commitments
                             where need_id=? and state in ('proposed','confirmed','fulfilled')`, n.need_id).c;
    if (n.status === 'filled') filled++;

    if (Math.abs(sum - n.qty_committed) > 1e-9) {
      problems.push({ need_id: n.need_id, why: 'qty_committed disagrees with its own commitments', stored: n.qty_committed, recomputed: sum });
    }
    if (n.status === 'filled' && sum < n.qty_required) {
      problems.push({ need_id: n.need_id, why: `reports filled while short: ${sum} of ${n.qty_required} ${n.unit}` });
    }
    if (n.status !== 'closed' && sum >= n.qty_required && n.status !== 'filled') {
      problems.push({ need_id: n.need_id, why: `reports "${n.status}" while covered: ${sum} of ${n.qty_required} ${n.unit}` });
    }
    if (!n.allow_overcommit && sum > n.qty_required + 1e-9) {
      problems.push({ need_id: n.need_id, why: `exceeds its quantity without allow_overcommit: ${sum} of ${n.qty_required} ${n.unit}` });
    }
  }

  // Not a metric. A class 3 need bound by the machine is a structural failure.
  const autoClass3 = all(db, `select c.commitment_id, c.need_id, c.bound_by from commitments c
                                join needs n on n.need_id = c.need_id
                               where n.risk_class = 3 and c.bound_by = 'auto'`);
  return {
    needs: needs.length, filled, commitments, problems,
    auto_bound_class3: autoClass3,
    fulfilments: one(db, 'select count(*) c from fulfilments').c,
    exercised_filled: filled > 0,
  };
}

function passCost(db, initiative) {
  const row = one(db, `select count(*) n, coalesce(sum(input_tokens),0) t, coalesce(sum(cost_usd),0) c
                         from judgments where initiative_id=?`, initiative.initiative_id);
  return { judgments: row.n, input_tokens: row.t, cost_usd: row.c };
}

// ---------------------------------------------------------------------------
// reconstructing the gate from the log
// ---------------------------------------------------------------------------

/**
 * Every judgment row stores its full request and its full answer distribution,
 * so the decision can be rebuilt from the log instead of re-run. This is the
 * arithmetic in src/pipeline/admit.js, copied deliberately rather than shared:
 * a reconstruction that imported the pipeline's own function would agree with
 * it by construction and would prove nothing. Instead every rebuilt row is
 * checked against the decision the pipeline actually recorded, and the report
 * prints how many agreed.
 */
function reconstructAll(db, { records, judgments, needs, initiative, cfg }) {
  const byOffer = new Map();
  for (const j of judgments) {
    if (!j.offer_id) continue;
    if (!byOffer.has(j.offer_id)) byOffer.set(j.offer_id, {});
    byOffer.get(j.offer_id)[j.pass] = j;
  }

  const rows = [];
  for (const rec of records) {
    const pair = byOffer.get(rec.offer_id);
    if (!pair?.wide) continue;                   // never reached the model at all
    rows.push(rebuild(db, { rec, pair, needs, initiative, cfg }));
  }
  return rows;
}

function rebuild(db, { rec, pair, needs, initiative, cfg }) {
  const wide = JSON.parse(pair.wide.answers);
  const wideIds = new Set((JSON.parse(pair.wide.request).state.candidate_needs ?? []).map((c) => c.id));
  const offerRow = one(db, 'select extracted, received_at from offers where offer_id=?', rec.offer_id);
  const extracted = JSON.parse(offerRow?.extracted ?? '{}');
  const row = {
    id: rec.id, scenario: rec.scenario, offer_id: rec.offer_id,
    language: rec.labelled_language ?? rec.detected_language ?? 'unstated',
    expect_decision: rec.expect_decision, expect_need_id: rec.expect_need_id,
    recorded_decision: rec.decision, recorded_confidence: rec.confidence,
    autobind: initiative.autobind, escalate_floor: cfg.escalate_floor, thresholds: cfg.thresholds,
    recorded_reason: rec.reason ?? null,
    at_the_gate: false, need_id: null, risk_class: null, confidence: null,
    blocked_by_credentials: false, fixed: null,
  };

  // The screen, in the order admit.js applies it. These exits do not depend on
  // any threshold, so they are the same at every point of the sweep.
  const noul = (k) => wide[k]?.noul ?? 0;
  if (noul('is_adversarial') >= cfg.gate_adversarial) return { ...row, fixed: 'rejected' };
  if (noul('is_withdrawal') >= cfg.gate_withdrawal) return { ...row, fixed: 'withdrawn' };
  if (noul('is_question') > 0.5 && noul('is_offer') < cfg.gate_is_offer) return { ...row, fixed: 'answered' };
  if (noul('is_offer') < cfg.gate_is_offer) return { ...row, fixed: 'not_an_offer' };

  const probs = wide.which_need?.probabilities ?? {};
  const ranked = Object.entries(probs)
    .filter(([k]) => k !== 'none' && wideIds.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, cfg.shortlist_size);
  // "None of these" has to beat the best candidate by a clear margin.
  if (!ranked.length || (probs.none ?? 0) > ranked[0][1] * 1.5) return { ...row, fixed: 'no_match' };

  if (!pair.shortlist) return { ...row, fixed: rec.decision, unrebuilt: true };

  const short = JSON.parse(pair.shortlist.answers);
  const specProbs = short.specificity?.probabilities ?? {};
  const specScore = short.specificity?.score ?? 1;
  const specMultiplier = 1 - (0.55 * (specProbs['0'] ?? 0) + 0.18 * (specProbs['1'] ?? 0));

  // Confidence is the concentration of the ranking distribution scaled by the
  // candidate's share of the top probability, not the raw probability itself.
  // A raw probability shrinks mechanically as the catalogue grows, so a gate
  // built on it would quietly stop binding as a catalogue got bigger.
  const rankConfidence = wide.which_need?.confidence ?? 0;
  const topP = ranked[0][1] || 1;

  const scored = ranked
    .map(([needId, p]) => {
      const fits = short[`fits__${needId}`]?.noul ?? 0;
      const base = rankConfidence * (p / topP);
      const mult = completeness(needs[needId], extracted, specMultiplier);
      return { need_id: needId, p, fits, confidence: base * fits * mult };
    })
    .filter((s) => s.fits >= cfg.fits_floor)
    .sort((a, b) => b.confidence - a.confidence);
  if (!scored.length) return { ...row, fixed: 'no_match' };

  const best = scored[0];
  const need = needs[best.need_id];
  return {
    ...row,
    at_the_gate: true,
    need_id: best.need_id,
    risk_class: need?.risk_class ?? null,
    confidence: round4(best.confidence),
    specificity: specScore,
    vague: specScore < cfg.vague_below,
    blocked_by_credentials: blockedByCredentials(db, rec, need, offerRow?.received_at),
  };
}

/**
 * What the deterministic parse says the contributor pledged, as a floor under
 * the model's own specificity multiplier. The parsers are imported rather than
 * copied — a harness that reimplemented the date parser would be measuring its
 * own parser — but the way the two combine is the gate, so that part is
 * written out here and checked against the log.
 */
function completeness(need, extracted, modelMultiplier) {
  if (!need) return modelMultiplier;
  const quantities = extracted.quantities ?? [];
  const timeMatters = need.kind === 'labour' || need.kind === 'expertise';
  const saidQty = statesUnit(quantities, need.unit) || quantityFor(quantities, need.unit) != null;
  const saidTime = extracted.window?.kind !== 'none';

  const required = 1 + (timeMatters ? 1 : 0);
  const stated = (saidQty ? 1 : 0) + (timeMatters && saidTime ? 1 : 0);
  return Math.max(modelMultiplier, 0.55 + 0.45 * (stated / required));
}

/**
 * Invariant 4 is a pure predicate over verified credentials, so it can be
 * re-evaluated from stored state rather than taken from the pipeline's own
 * answer. It does not move with the threshold: a contributor without the
 * certificate reaches a person at 0.50 and at 0.99 alike.
 */
function blockedByCredentials(db, rec, need, receivedAt) {
  if (!need || !rec.actor_id) return false;
  const quals = JSON.parse(need.qualifications ?? '[]');
  if (!quals.length) return false;
  const at = receivedAt ?? new Date().toISOString();
  return quals.some((code) => !one(db,
    `select 1 from credentials where actor_id=? and code=?
      and (expires_at is null or expires_at > ?)`, rec.actor_id, code, at));
}

/** The gate, at one threshold, for one rebuilt row. Mirrors admit.js exactly. */
function gateAt(row, threshold) {
  if (row.fixed) return row.fixed;
  if (row.blocked_by_credentials) return 'queued';
  const may = mayAutoBind(row.risk_class);
  const t = may ? threshold : Infinity;
  if (may && row.autobind === 1 && row.confidence >= t) return 'bound';
  if (row.confidence >= row.escalate_floor || !may) return 'queued';
  return row.vague ? 'asked' : 'no_match';
}

/**
 * Fidelity check. At each need's own configured threshold the rebuilt decision
 * has to be the decision the pipeline recorded, or the sweep below is fiction.
 */
function fidelity(rows, cfg) {
  const checked = [];
  for (const r of rows) {
    if (r.unrebuilt) continue;
    // Decided by a guard the sweep does not model: a degraded engine, a
    // possible duplicate, a budget refusal. Those are not threshold decisions.
    if (/^(degraded|possible_duplicate|budget|error)/.test(r.recorded_reason ?? '')) continue;
    // Each row against its own scenario's thresholds. Pooled runs used to check
    // every row against the first scenario's, and called the difference drift.
    const t = r.at_the_gate ? thresholdFor({ thresholds: r.thresholds ?? cfg.thresholds }, r.risk_class) : Infinity;
    const rebuilt = gateAt(r, t);
    const confOk = r.confidence == null || r.recorded_confidence == null
      || Math.abs(r.confidence - r.recorded_confidence) < 5e-5;
    checked.push({
      id: r.id, rebuilt, recorded: r.recorded_decision,
      confidence: r.confidence, recorded_confidence: r.recorded_confidence,
      agrees: rebuilt === r.recorded_decision && confOk,
    });
  }
  return { checked, agreeing: checked.filter((c) => c.agrees).length, disagreeing: checked.filter((c) => !c.agrees) };
}

function sweepAt(rows, threshold) {
  const gate = rows.filter((r) => r.at_the_gate);
  let binds = 0, wrong = 0, queued = 0, asked = 0, noMatch = 0;
  for (const r of gate) {
    const d = gateAt(r, threshold);
    if (d === 'bound') {
      binds++;
      if (!(r.expect_decision === 'bound' && r.expect_need_id && r.need_id === r.expect_need_id)) wrong++;
    } else if (d === 'queued') queued++;
    else if (d === 'asked') asked++;
    else noMatch++;
  }
  return {
    threshold: round2(threshold), at_the_gate: gate.length,
    binds, wrong, queued, asked, no_match: noMatch,
    bind_rate: gate.length ? binds / gate.length : null,
    wrong_rate: binds ? wrong / binds : null,
  };
}

function sweep(runs) {
  const rows = runs.flatMap((r) => r.gate);
  const cfg = runs[0]?.cfg ?? {};
  const table = [];
  for (let t = SWEEP_FROM; t <= SWEEP_TO + 1e-9; t += SWEEP_STEP) table.push(sweepAt(rows, round2(t)));
  return {
    offers: rows.length,
    at_the_gate: rows.filter((r) => r.at_the_gate).length,
    screened_out: rows.filter((r) => r.fixed).length,
    blocked_by_credentials: rows.filter((r) => r.blocked_by_credentials).length,
    fidelity: fidelity(rows, cfg),
    configured: { thresholds: cfg.thresholds ?? {}, escalate_floor: cfg.escalate_floor ?? null },
    table, rows,
  };
}

// ---------------------------------------------------------------------------
// the measures
// ---------------------------------------------------------------------------

function frac(x, n) { return { x, n, rate: n ? x / n : null, enough: n >= ENOUGH }; }

function headline(recs, closure) {
  const offers = recs.filter((r) => REAL_OFFER_LABELS.has(r.expect_decision));
  const binds = recs.filter((r) => r.decision === 'bound');
  const binds1 = binds.filter((r) => r.risk_class === 1);
  const specific = recs.filter((r) => SPECIFIC_REPLY.has(r.decision) && r.latency_ms != null);
  const lat = specific.map((r) => r.latency_ms);

  return {
    no_human_all: frac(recs.filter((r) => !r.in_queue).length, recs.length),
    no_human_offers: frac(offers.filter((r) => !r.in_queue).length, offers.length),
    no_person_all: frac(recs.filter((r) => !r.reached_a_person).length, recs.length),
    no_person_offers: frac(offers.filter((r) => !r.reached_a_person).length, offers.length),
    wrong_binds_class1: frac(binds1.filter((r) => r.wrong_bind).length, binds1.length),
    wrong_binds_all: frac(binds.filter((r) => r.wrong_bind).length, binds.length),
    unverifiable_binds: recs.filter((r) => r.unverifiable_bind).length,
    binds_below_their_threshold: binds1.filter((r) =>
      r.confidence != null && r.threshold != null && r.confidence < r.threshold).length,
    binds_by_risk_class: tally(binds.map((r) => r.risk_class)),
    auto_binds_class3_shadow: binds.filter((r) => r.risk_class === 3).length,
    auto_binds_class3_live: closure.auto_bound_class3.length,
    specific_reply_ms: { median: median(lat), p95: p95(lat), n: lat.length },
    closure: closure.consistent,
    decision_match: frac(recs.filter((r) => r.decision_ok).length, recs.length),
    fully_correct: frac(recs.filter((r) => r.correct).length, recs.length),
    errors: recs.filter((r) => r.decision === 'error').length,
  };
}

function perLanguage(recs) {
  const groups = new Map();
  for (const r of recs) {
    const lang = r.labelled_language ?? r.detected_language ?? 'unstated';
    if (!groups.has(lang)) groups.set(lang, []);
    groups.get(lang).push(r);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([language, rs]) => {
      const offers = rs.filter((r) => REAL_OFFER_LABELS.has(r.expect_decision));
      const binds = rs.filter((r) => r.decision === 'bound');
      return {
        language, n: rs.length, enough: rs.length >= ENOUGH,
        no_human_all: frac(rs.filter((r) => !r.in_queue).length, rs.length),
        no_human_offers: frac(offers.filter((r) => !r.in_queue).length, offers.length),
        decision_match: frac(rs.filter((r) => r.decision_ok).length, rs.length),
        binds: binds.length,
        wrong_binds: binds.filter((r) => r.wrong_bind).length,
        median_latency_ms: median(rs.filter((r) => r.latency_ms != null).map((r) => r.latency_ms)),
        mean_confidence: mean(rs.filter((r) => r.confidence != null).map((r) => r.confidence)),
      };
    });
}

function confusion(recs) {
  const expected = DECISIONS.filter((d) => recs.some((r) => r.expect_decision === d));
  const actual = DECISIONS.filter((d) => recs.some((r) => r.decision === d));
  const rows = {};
  for (const e of expected) {
    rows[e] = {};
    for (const a of actual) rows[e][a] = recs.filter((r) => r.expect_decision === e && r.decision === a).length;
  }
  return { expected_labels: expected, actual_labels: actual, rows, unlabelled: recs.filter((r) => !r.expect_decision).length };
}

/**
 * Calibration on our own data. A vendor's calibration curve was measured on the
 * vendor's data; this one is measured on ours, which is the only one that can
 * say where to put a threshold.
 *
 * "Accurate" here means one thing only: the need chosen at that confidence is
 * the need the label names. Cases the label cannot adjudicate are excluded and
 * counted rather than scored either way.
 */
function calibration(recs) {
  const scored = recs.filter((r) => r.confidence != null && r.need_verdict !== 'unknown');
  const excluded = recs.filter((r) => r.confidence != null && r.need_verdict === 'unknown').length;
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, sum: 0, hits: 0 }));

  for (const r of scored) {
    const b = bins[Math.min(9, Math.max(0, Math.floor(r.confidence * 10)))];
    b.n++;
    b.sum += r.confidence;
    if (r.need_verdict === 'right') b.hits++;
  }

  let ece = 0;
  for (const b of bins) {
    b.mean_p = b.n ? b.sum / b.n : null;
    b.accuracy = b.n ? b.hits / b.n : null;
    b.gap = b.n ? b.accuracy - b.mean_p : null;
    if (b.n) ece += (b.n / scored.length) * Math.abs(b.gap);
  }
  return { n: scored.length, excluded, bins: bins.map(({ sum, ...b }) => b), ece: scored.length ? ece : null };
}

function engineSummary(runs) {
  const rows = runs.flatMap((r) => r.judgments);
  const engines = tally(rows.map((j) => j.engine));
  const inCode = `${BANK_VERSION}+${BANK_HASH}`;
  const banks = tally(rows.map((j) => j.question_bank_version));
  const names = Object.keys(engines);
  return {
    judgments: rows.length,
    engines, models: tally(rows.map((j) => j.model_version)),
    question_bank_versions: banks, question_bank_in_code: inCode,
    bank_matches_code: names.length > 0 && Object.keys(banks).every((b) => b === inCode),
    name: names.length === 1 ? names[0] : names.length ? 'mixed' : 'none',
    from_the_model: names.length === 1 && names[0] === 'typesafe',
    fallbacks: rows.filter((j) => j.engine === 'rules-fallback').length,
  };
}

function costSummary(runs) {
  const rows = runs.flatMap((r) => r.judgments);
  const passes = [...new Set(rows.map((j) => j.pass))].sort().map((pass) => {
    const js = rows.filter((j) => j.pass === pass);
    return {
      pass, n: js.length,
      median_ms: median(js.map((j) => j.latency_ms)), p95_ms: p95(js.map((j) => j.latency_ms)),
      input_tokens: sum(js.map((j) => j.input_tokens ?? 0)),
      cost_usd: sum(js.map((j) => j.cost_usd ?? 0)),
    };
  });
  const live = {
    judgments: sum(runs.map((r) => r.live?.judgments ?? 0)),
    input_tokens: sum(runs.map((r) => r.live?.input_tokens ?? 0)),
    cost_usd: sum(runs.map((r) => r.live?.cost_usd ?? 0)),
  };
  return {
    scored: { judgments: rows.length, input_tokens: sum(rows.map((j) => j.input_tokens ?? 0)), cost_usd: sum(rows.map((j) => j.cost_usd ?? 0)) },
    closure: live,
    total_input_tokens: sum(rows.map((j) => j.input_tokens ?? 0)) + live.input_tokens,
    total_cost_usd: sum(rows.map((j) => j.cost_usd ?? 0)) + live.cost_usd,
    passes,
  };
}

// ---------------------------------------------------------------------------
// assembling
// ---------------------------------------------------------------------------

function assemble(runs, args, problems) {
  const recs = runs.flatMap((r) => r.cases);
  const provenance = tally(recs.map((r) => r.provenance));
  const closure = {
    needs: sum(runs.map((r) => r.live?.needs ?? 0)),
    filled: sum(runs.map((r) => r.live?.filled ?? 0)),
    commitments: sum(runs.map((r) => r.live?.commitments ?? 0)),
    fulfilments: sum(runs.map((r) => r.live?.fulfilments ?? 0)),
    errors: sum(runs.map((r) => r.live?.errors ?? 0)),
    exercised_filled: runs.some((r) => r.live?.exercised_filled),
    problems: runs.flatMap((r) => (r.live?.problems ?? []).map((p) => ({ scenario: r.slug, ...p }))),
    auto_bound_class3: runs.flatMap((r) => (r.live?.auto_bound_class3 ?? []).map((p) => ({ scenario: r.slug, ...p }))),
  };
  closure.consistent = frac(closure.needs - closure.problems.length, closure.needs);

  const provKeys = Object.keys(provenance);
  const engine = engineSummary(runs);

  return {
    produced_by: 'harness/score.js',
    node: process.version,
    clock: new Date(CLOCK0).toISOString(),
    scenario_filter: args.scenario ?? null,
    scenarios: runs.map((r) => ({
      slug: r.slug, title: r.title, source: r.source, pack_from: r.pack_from,
      cases: r.cases.length, chain: r.chain,
      live: r.live ? {
        needs: r.live.needs, filled: r.live.filled, commitments: r.live.commitments,
        errors: r.live.errors, problems: r.live.problems.length, clock: r.live.clock,
      } : null,
      problems: r.problems,
    })),
    engine,
    golden: {
      cases: recs.length, provenance,
      synthetic_only: provKeys.length > 0 && provKeys.every((p) => /synthetic|scenario traffic/i.test(p)),
      any_traffic_fallback: runs.some((r) => r.source === 'traffic'),
      problems: [...problems, ...runs.flatMap((r) => r.problems.map((p) => `${r.slug}: ${p}`))],
      language_disagreements: recs.filter((r) =>
        r.labelled_language && r.detected_language && r.labelled_language !== r.detected_language).length,
    },
    headline: headline(recs, closure),
    per_scenario: runs.map((r) => ({
      slug: r.slug, source: r.source, cases: r.cases.length,
      no_human: frac(r.cases.filter((c) => !c.in_queue).length, r.cases.length),
      binds: r.cases.filter((c) => c.decision === 'bound').length,
      wrong: r.cases.filter((c) => c.wrong_bind).length,
      errors: r.cases.filter((c) => c.decision === 'error').length,
      chain_ok: !!r.chain?.ok, events: r.chain?.count ?? null,
    })),
    per_language: perLanguage(recs),
    confusion: confusion(recs),
    calibration: calibration(recs),
    cost: costSummary(runs),
    closure,
    sweep: args.sweep ? sweep(runs) : null,
    cases: recs,
  };
}

// ---------------------------------------------------------------------------
// printing
// ---------------------------------------------------------------------------

const out = [];
function say(s = '') { out.push(s); }

/** Prose, broken at the report width rather than wherever the string ended. */
function wrap(text, indent = '  ') {
  let line = indent;
  for (const word of String(text).split(/\s+/)) {
    if (line.length > indent.length && line.length + 1 + word.length > W) {
      say(line);
      line = indent;
    }
    line += (line.length > indent.length ? ' ' : '') + word;
  }
  if (line.trim()) say(line);
}

/**
 * Rates are rounded away from whatever would flatter the system: a measure
 * where higher is better rounds down, one where lower is better rounds up. The
 * counts are always printed, because they are the part that can be checked.
 */
function pct(f, { up = false } = {}) {
  if (!f || !f.n) return `— (0 cases)`;
  const raw = (f.x / f.n) * 1000;
  const p = (up ? Math.ceil(raw) : Math.floor(raw)) / 10;
  return `${p.toFixed(1)}% (${f.x}/${f.n})${f.n < ENOUGH ? ', n<20' : ''}`;
}

function counts(f) {
  if (!f || !f.n) return '— (0)';
  return `${f.x}/${f.n}`;
}

function ms(v) {
  if (v == null) return '—';
  return v >= 1000 ? `${(Math.ceil(v / 100) / 10).toFixed(1)} s` : `${Math.ceil(v * 10) / 10} ms`;
}

function row(measure, target, measured) {
  say(`  ${measure.padEnd(49)} ${target.padEnd(11)} ${measured}`);
}

function printReport(r, args) {
  say(HEAVY);
  say(` MEASUREMENT HARNESS — coordination prototype`);
  say(` ${r.golden.cases} case(s) · ${r.scenarios.length} scenario(s) · node ${r.node} · clock ${r.clock}`);
  say(` engine ${r.engine.name} · model ${Object.keys(r.engine.models).join(', ') || '—'}`);
  say(` question bank ${Object.keys(r.engine.question_bank_versions).join(', ') || '—'}`);
  say(HEAVY);
  say();

  if (!r.engine.from_the_model) {
    say('  ' + '#'.repeat(94));
    say('  ##  THESE NUMBERS DID NOT COME FROM THE JUDGMENT MODEL.'.padEnd(94) + '##');
    say(`  ##  Engine: ${r.engine.name}.`.padEnd(94) + '##');
    say('  ##  They say the pipeline behaves as designed. They are not a claim about'.padEnd(94) + '##');
    say('  ##  model accuracy, and nothing here may be quoted as a model evaluation.'.padEnd(94) + '##');
    say('  ' + '#'.repeat(94));
    say();
  }
  if (!r.engine.bank_matches_code) {
    say(`  ! The question bank on the judgments is not the one in the code (${r.engine.question_bank_in_code}).`);
    say();
  }
  if (r.engine.fallbacks) {
    say(`  ! ${r.engine.fallbacks} judgment(s) fell back from the hosted model to the rules engine.`);
    say();
  }

  if (r.golden.synthetic_only) {
    say('  This is a synthetic golden set. It measures whether the pipeline behaves as');
    say('  designed. It is not the wrong-bind number: that needs real messages labelled');
    say('  independently by two people.');
  }
  say('  Golden set provenance: ' + (Object.entries(r.golden.provenance).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none stated'));
  if (r.golden.any_traffic_fallback) {
    const fallback = r.scenarios.filter((s) => s.source === 'traffic').map((s) => s.slug).join(', ');
    wrap(`LABELS FROM THE SCENARIO'S OWN traffic[]: ${fallback}.`);
    wrap('No independent golden file exists for these, so the same hand wrote the fixture'
      + ' and the expected answer. Those lines measure that the pipeline does what the'
      + ' scenario author expected, which is weaker than a label somebody else wrote.');
  }
  say();

  // --- the five, first -----------------------------------------------------
  const h = r.headline;
  say('  PROPOSED MEASURES — targets are proposals, not findings. The first run against real');
  say('  messages sets the real baseline.');
  say('  ' + RULE);
  row('Measure', 'Target', 'Measured');
  say('  ' + RULE);
  row('Offers reaching a decision with no human', '>= 70%', pct(h.no_human_all));
  row('  ... over messages a human labelled an offer', '>= 70%', pct(h.no_human_offers));
  row('Wrong binds at the auto threshold, risk class 1', '<= 2%', pct(h.wrong_binds_class1, { up: true }));
  row('Auto binds in risk class 3', '0',
    `${h.auto_binds_class3_shadow} shadow, ${h.auto_binds_class3_live} live`);
  row('Median offer to a specific reply', '< 5 s',
    `${ms(h.specific_reply_ms.median)} (n=${h.specific_reply_ms.n}, p95 ${ms(h.specific_reply_ms.p95)})`);
  row('Needs correctly reported as closed', '100%', pct(h.closure));
  say('  ' + RULE);
  row('Wrong binds over every bind made', '—', pct(h.wrong_binds_all, { up: true }));
  row('Decision label matched exactly', '—', pct(h.decision_match));
  row('Decision and need both matched', '—', pct(h.fully_correct));
  say('  ' + RULE);
  say('  "No human" is the share that did not reach the coordinator console. The console shows');
  say('  queued offers and messages the screen set aside as possible attacks, and a case that');
  say('  threw reached a person too. One definition, shared with shadow and acceptance.');
  const byClass = Object.entries(h.binds_by_risk_class).map(([k, v]) => `class ${k}: ${v}`).join(', ');
  wrap(`Binds made, by risk class: ${byClass || 'none'}.`
    + (h.wrong_binds_class1.n ? '' : ' No class 1 bind was made, so that rate has no denominator'
      + ' and none is invented for it.'));
  if (h.unverifiable_binds) {
    say(`  ${h.unverifiable_binds} bind(s) the labels cannot adjudicate are counted as wrong above.`);
  }
  if (h.binds_below_their_threshold) {
    say(`  ! ${h.binds_below_their_threshold} class 1 bind(s) landed below their own threshold.`);
  }
  if (h.errors) say(`  ! ${h.errors} case(s) threw and were counted as reaching a person.`);
  say('  Latency is this machine with the ' + r.engine.name + ' engine. It is not a claim about');
  say('  a hosted model, whose network time would dominate it.');
  say();

  // --- per scenario --------------------------------------------------------
  say('  PER SCENARIO');
  say('  ' + RULE);
  say('  scenario              labels        cases   no human   binds  wrong  errors  log');
  for (const s of r.per_scenario) {
    const chain = r.scenarios.find((x) => x.slug === s.slug);
    say('  ' + s.slug.padEnd(21) + ' '
      + (s.source === 'golden' ? 'golden file ' : 'traffic[]   ')
      + String(s.cases).padStart(6) + '   '
      + counts(s.no_human).padStart(7) + ' '
      + String(s.binds).padStart(6) + ' ' + String(s.wrong).padStart(6) + ' '
      + String(s.errors).padStart(7) + '  '
      + (s.chain_ok ? `ok (${s.events} events)` : 'CHAIN BROKEN'));
  }
  for (const p of r.golden.problems) say(`  ! ${p}`);
  say();

  // --- per language --------------------------------------------------------
  say('  PER LANGUAGE — accuracy is not the same across lv, ru and en, and no vendor');
  say('  document will tell you that');
  say('  ' + RULE);
  say('  lang          n   no human      offers   label match   binds  wrong   median ms');
  const thin = [];
  for (const l of r.per_language) {
    if (!l.enough) thin.push(`${l.language} (n=${l.n})`);
    const fmt = (f) => (l.enough ? pct(f) : counts(f)).padStart(11);
    say('  ' + l.language.padEnd(6) + String(l.n).padStart(6) + ' '
      + fmt(l.no_human_all) + ' ' + fmt(l.no_human_offers) + ' ' + fmt(l.decision_match)
      + String(l.binds).padStart(7) + String(l.wrong_binds).padStart(7)
      + ms(l.median_latency_ms).padStart(11));
  }
  if (thin.length) {
    say(`  No rate is stated for: ${thin.join(', ')}. Under ${ENOUGH} cases a rate is an anecdote`);
    say('  with a decimal point on it, so those rows carry counts only.');
  }
  if (r.golden.language_disagreements) {
    say(`  ${r.golden.language_disagreements} case(s) where the detected language is not the labelled one.`);
  }
  say();

  // --- confusion -----------------------------------------------------------
  say('  CONFUSION — rows are the human label, columns are what the pipeline decided');
  say('  ' + RULE);
  const cols = r.confusion.actual_labels;
  say('  ' + 'expected \\ actual'.padEnd(22) + cols.map((c) => SHORT[c].padStart(7)).join(''));
  for (const e of r.confusion.expected_labels) {
    const n = sum(cols.map((c) => r.confusion.rows[e][c]));
    say('  ' + `${SHORT[e]} (${n})`.padEnd(22)
      + cols.map((c) => (r.confusion.rows[e][c] || '·').toString().padStart(7)).join(''));
  }
  if (r.confusion.unlabelled) say(`  ${r.confusion.unlabelled} case(s) carry no expected decision and are not in the matrix.`);
  say();

  // --- calibration ---------------------------------------------------------
  const cal = r.calibration;
  say('  CALIBRATION — measured on our data, not on a vendor\'s');
  say('  ' + RULE);
  say('  bin              n     mean p    accuracy       gap   reading');
  for (const b of cal.bins) {
    const reading = !b.n ? 'empty' : b.n < ENOUGH ? `${b.n} case(s): too few to mean anything` : 'usable';
    say('  ' + `${b.lo.toFixed(2)}-${b.hi.toFixed(2)}`.padEnd(12)
      + String(b.n).padStart(5)
      + (b.mean_p == null ? '—' : b.mean_p.toFixed(3)).padStart(11)
      + (b.accuracy == null ? '—' : `${(b.accuracy * 100).toFixed(1)}%`).padStart(12)
      + (b.gap == null ? '—' : `${b.gap >= 0 ? '+' : ''}${b.gap.toFixed(3)}`).padStart(10)
      + '   ' + reading);
  }
  say(`  Expected calibration error: ${cal.ece == null ? '—' : cal.ece.toFixed(3)} over ${cal.n} scored case(s).`);
  say('  "Accuracy" means one thing: the need chosen at that confidence is the need the label');
  say(`  names. ${cal.excluded} case(s) the labels cannot adjudicate are excluded, not scored.`);
  if (cal.n < ENOUGH) say('  The whole curve is an anecdote at this size. It is printed to show its shape.');
  say();

  // --- cost and latency ----------------------------------------------------
  say('  COST AND LATENCY');
  say('  ' + RULE);
  say('  pass          judgments    median      p95   input tokens        USD');
  for (const p of r.cost.passes) {
    say('  ' + p.pass.padEnd(12) + String(p.n).padStart(10)
      + ms(p.median_ms).padStart(10) + ms(p.p95_ms).padStart(9)
      + p.input_tokens.toLocaleString('en-US').padStart(15)
      + ('$' + p.cost_usd.toFixed(4)).padStart(11));
  }
  say(`  Scored pass: ${r.cost.scored.judgments} judgments, ${r.cost.scored.input_tokens.toLocaleString('en-US')} input tokens, $${r.cost.scored.cost_usd.toFixed(4)}.`);
  say(`  Closure pass: ${r.cost.closure.judgments} judgments, ${r.cost.closure.input_tokens.toLocaleString('en-US')} input tokens, $${r.cost.closure.cost_usd.toFixed(4)}.`);
  say(`  Total for this run: ${r.cost.total_input_tokens.toLocaleString('en-US')} input tokens, $${r.cost.total_cost_usd.toFixed(4)}.`);
  say('  The closure pass replays the same cases with binding on, so a hosted-engine run pays');
  say('  both lines, not the first one.');
  say();

  // --- closure -------------------------------------------------------------
  say('  NEEDS CORRECTLY REPORTED AS CLOSED — from the replay with binding on');
  say('  ' + RULE);
  const c = r.closure;
  say(`  ${c.needs} need(s) checked, ${c.commitments} commitment(s) taken, ${c.filled} reached "filled", ${c.fulfilments} delivered.`);
  say(`  Agreement between the needs table and its own commitments: ${pct(c.consistent)}`);
  say('  Asserted per need: qty_committed equals the sum of its confirmed and fulfilled');
  say('  commitments; nothing reports filled while short; nothing exceeds qty_required');
  say('  without allow_overcommit.');
  for (const p of c.problems) say(`  ! ${p.scenario} ${p.need_id}: ${p.why}`);
  if (!c.exercised_filled) {
    say('  No need reached "filled" in this run, so the filled-while-short branch was never');
    say('  exercised. This measure is agreement, not proof that closure works.');
  }
  if (!c.fulfilments) say('  No delivery was recorded, so the derived delivery record is untested here.');
  if (c.errors) say(`  ! ${c.errors} case(s) threw during the closure pass.`);
  say();

  if (r.sweep) printSweep(r.sweep);

  if (c.auto_bound_class3.length) {
    say('  ' + '!'.repeat(94));
    say(`  STRUCTURAL FAILURE: ${c.auto_bound_class3.length} risk class 3 commitment(s) were bound`);
    say('  automatically. That is not a metric that moved. Exiting non-zero.');
    say('  ' + '!'.repeat(94));
    say();
  }
}

function printSweep(s) {
  say('  THRESHOLD SWEEP — recomputed from the stored distributions, no model calls');
  say('  ' + RULE);
  say(`  ${s.offers} offer(s) rebuilt from the log: ${s.at_the_gate} reached the gate,`);
  say(`  ${s.screened_out} were screened out before it, ${s.blocked_by_credentials} were held by a missing credential.`);

  const f = s.fidelity;
  say(`  Rebuilt decision agrees with the recorded one on ${f.agreeing}/${f.checked.length} offer(s)`);
  say('  at the configured thresholds. That check is what makes the table below evidence');
  say('  rather than arithmetic: the rebuild is written out separately from the pipeline.');
  for (const d of f.disagreeing) {
    say(`  ! ${d.id}: rebuilt ${d.rebuilt} at ${d.confidence}, pipeline recorded ${d.recorded} at ${d.recorded_confidence}`);
  }
  if (f.disagreeing.length) {
    say('  ! The rebuild disagrees with the log, so the sweep below is NOT reliable.');
  }
  say('  The swept threshold is applied to risk classes 1 and 2 alike; class 3 has no');
  say('  automatic path at any number, so it only ever adds to the queue column. A missing');
  say('  credential holds an offer at every threshold, which is why the queue never empties.');
  say(`  Configured today: ${JSON.stringify(s.configured.thresholds)}, escalate floor ${s.configured.escalate_floor}.`);
  say('  "wrong" counts binds the label says belong to another need, or nowhere at all.');
  say('  A THRESHOLD FROM THIS TABLE IS A PROPOSAL, NOT A SETTING. Every case here is scored');
  say('  against the catalogue as it stood at the start: the sweep takes no leases, so needs');
  say('  never fill and later offers never meet a changed board. A live run does, and it can');
  say('  be worse. Measured on river-cleanup: this table showed zero wrong binds at 0.54, and');
  say('  a live run at 0.54 produced 4.3% over 23 binds. Validate a candidate threshold with');
  say('  bin/acceptance.js before setting it.');
  say('  ' + RULE);
  say('  threshold    binds   bind rate    wrong  wrong rate    queued    asked  no match');

  let last = null;
  for (const t of s.table) {
    const key = `${t.binds}|${t.wrong}|${t.queued}|${t.asked}|${t.no_match}`;
    // A sweep that prints fifty identical lines hides the two that move. Only
    // the rows where something changes are printed, plus the first and last.
    if (key === last && t !== s.table[s.table.length - 1]) continue;
    last = key;
    say('  ' + t.threshold.toFixed(2).padEnd(9)
      + String(t.binds).padStart(8)
      + (t.bind_rate == null ? '—' : `${(Math.floor(t.bind_rate * 1000) / 10).toFixed(1)}%`).padStart(12)
      + String(t.wrong).padStart(9)
      + (t.wrong_rate == null ? '—' : `${(Math.ceil(t.wrong_rate * 1000) / 10).toFixed(1)}%`).padStart(12)
      + String(t.queued).padStart(10) + String(t.asked).padStart(9) + String(t.no_match).padStart(10));
  }
  say(`  Rates are over the ${s.at_the_gate} offer(s) that reached the gate. Only thresholds where`);
  say('  something changes are printed; the rows between them are identical to the one above.');
  say();
}

// ---------------------------------------------------------------------------
// small arithmetic
// ---------------------------------------------------------------------------

function sum(xs) { return xs.reduce((a, b) => a + b, 0); }
function mean(xs) { return xs.length ? sum(xs) / xs.length : null; }
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p95(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
function tally(xs) {
  const m = {};
  for (const x of xs) m[x ?? 'unstated'] = (m[x ?? 'unstated'] ?? 0) + 1;
  return m;
}
function round2(x) { return Math.round(x * 100) / 100; }
function round4(x) { return Math.round(x * 1e4) / 1e4; }

// ---------------------------------------------------------------------------

const HELP = `measurement harness

  node --experimental-sqlite --no-warnings harness/score.js [options]

    --scenario <slug>   measure one scenario instead of everything measurable
    --json <path>       write the JSON report here as well as to harness/out
    --sweep             recompute the gate at every threshold from the log
    --help              this

  Exit 1 if a risk class 3 need was auto-bound. Exit 2 if nothing was measurable.`;

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) { console.log(HELP); return 0; }

  const { jobs, problems } = selectJobs(args);
  if (!jobs.length) {
    console.error('nothing to measure.');
    for (const p of problems) console.error(`  ! ${p}`);
    console.error('  Put a golden file in harness/golden/<slug>.jsonl, or give a scenario');
    console.error('  in scenarios/ a traffic[] array with expect labels.');
    return 2;
  }

  const runs = [];
  for (const job of jobs) runs.push(await runJob(job, { sweep: args.sweep }));

  const report = assemble(runs, args, problems);
  printReport(report, args);
  console.log(out.join('\n'));

  mkdirSync(OUT_DIR, { recursive: true });
  const name = `report-${report.engine.name}-${args.scenario ?? 'all'}.json`;
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`  Report written to harness/out/${name}`);
  if (args.json) {
    const extra = resolve(args.json);
    mkdirSync(dirname(extra), { recursive: true });
    writeFileSync(extra, JSON.stringify(report, null, 2));
    console.log(`  and to ${args.json}`);
  }

  return report.closure.auto_bound_class3.length ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(2);
});
