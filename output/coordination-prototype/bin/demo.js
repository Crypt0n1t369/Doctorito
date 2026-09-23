#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { open, one, all } from '../src/db.js';
import { loadScenario, listScenarios, seedScenario } from '../src/seed.js';
import { admit } from '../src/pipeline/admit.js';
import { runOutbound } from '../src/pipeline/outbound.js';
import { confirmByToken, expireDueLeases } from '../src/pipeline/leases.js';
import { recordFulfilment } from '../src/fulfilment.js';
import { configFor } from '../src/config.js';

/**
 * A run you can watch. Seeds one scenario, replays its traffic across all three
 * channels against a compressed clock, then ages the catalogue so the outbound
 * engine has something to do, then records some deliveries.
 *
 * It leaves the database behind so `npm start` serves the same run.
 */
const args = process.argv.slice(2);
const slug = pick('--scenario') ?? listScenarios()[0];
const dbPath = pick('--db') ?? 'data/demo.db';
const baseUrl = pick('--url') ?? 'http://localhost:8787';
const quiet = args.includes('--quiet');

if (!args.includes('--keep')) {
  for (const s of ['', '-wal', '-shm']) { try { rmSync(dbPath + s); } catch { /* not there */ } }
}

const db = open(dbPath);
const scenario = loadScenario(slug);
const { initiative, needRefs, refused } = seedScenario(db, scenario);
const cfg = configFor(initiative);
const needName = Object.fromEntries(Object.entries(needRefs).map(([ref, nid]) => [nid, ref]));

say(`\n  ${scenario.title}`);
say(`  ${initiative.place ?? ''} · decided by ${scenario.decision.body} · ${scenario.decision.decided_at?.slice(0, 10)}`);
say(`  ${Object.keys(needRefs).length} needs published, ${(scenario.actors ?? []).length} actors with capability records`);
for (const r of refused) say(`  ! need "${r.ref}" refused by the editor: ${r.errors.join(' ')}`);

const BASE = new Date('2026-09-20T08:00:00Z');
const traffic = [...(scenario.traffic ?? [])].sort((a, b) => a.at_offset_minutes - b.at_offset_minutes);

say(`\n  ── inbound ────────────────────────────────────────────────────────────────`);
const results = [];
for (const m of traffic) {
  const now = new Date(BASE.getTime() + m.at_offset_minutes * 60_000);
  const live = one(db, 'select * from initiatives where initiative_id=?', initiative.initiative_id);
  const r = await admit(db, {
    initiative: live, channel: m.channel, handle: m.handle, displayName: m.name,
    text: m.text, now, baseUrl,
  });
  results.push({ ...r, expected: m.expect, at: now });
  say(line(now, m, r));
}

say(`\n  ── the catalogue ages, and the engine runs in reverse ─────────────────────`);
const later = new Date(BASE.getTime() + (cfg.ask_after_hours + 6) * 3600e3);
expireDueLeases(db, later);
const liveInit = one(db, 'select * from initiatives where initiative_id=?', initiative.initiative_id);
const outbound = await runOutbound(db, { initiative: liveInit, now: later, baseUrl, maxNeeds: 6 });
for (const o of outbound) {
  if (o.skipped) { say(`  · ${o.skipped}`); continue; }
  say(`  → "${(o.need ?? o.need_id).slice(0, 44)}" ranked ${o.candidates} capability records, asked ${o.asked}`);
}

// Class 2 needs a tap. The people who got one, give one.
let confirmed = 0;
for (const c of all(db, `select * from commitments where initiative_id=? and state='proposed'`, initiative.initiative_id)) {
  if (Math.abs(hash(c.commitment_id)) % 10 < 8) { confirmByToken(db, c.token, later); confirmed++; }
}
say(`  → ${confirmed} of the proposed commitments confirmed by tap`);

say(`\n  ── the day itself ─────────────────────────────────────────────────────────`);
let delivered = 0;
for (const c of all(db, `select * from commitments where initiative_id=? and state='confirmed'`, initiative.initiative_id)) {
  const roll = Math.abs(hash(c.commitment_id + 'd')) % 10;
  if (roll < 7) {
    const res = recordFulfilment(db, {
      commitment: c, qtyDelivered: roll < 6 ? c.qty : Math.max(1, Math.round(c.qty * 0.6)),
      evidence: 'signed off at the collection point', verifiedBy: 'coordinator:site-lead',
    });
    if (res.ok) delivered++;
  }
}
say(`  → ${delivered} commitments verified as delivered by somebody other than the contributor`);

say(`\n  ── where it got to ───────────────────────────────────────────────────────`);
const needs = all(db, 'select * from needs where initiative_id=? order by published_at', initiative.initiative_id);
const width = Math.max(...needs.map((n) => (n.description_short ?? '').length), 20);
for (const n of needs) {
  const del = one(db, `select coalesce(sum(f.qty_delivered),0) q from fulfilments f
                        join commitments c on c.commitment_id=f.commitment_id where c.need_id=?`, n.need_id).q;
  say(`  ${(n.description_short ?? '').padEnd(width)}  ${bar(n.qty_committed, del, n.qty_required)} ` +
      `${String(n.qty_committed).padStart(4)}/${String(n.qty_required).padEnd(4)} ${n.unit.padEnd(7)} ` +
      `class ${n.risk_class}  ${n.status}`);
}

const j = one(db, `select count(*) c, sum(cost_usd) cost, sum(input_tokens) tok from judgments where initiative_id=?`, initiative.initiative_id);
const lat = results.map((r) => r.latency_ms).sort((a, b) => a - b);
const byDecision = tally(results.map((r) => r.decision));
say(`\n  ${results.length} messages · ${j.c} judgments · ${j.tok?.toLocaleString() ?? 0} input tokens · $${(j.cost ?? 0).toFixed(4)}`);
say(`  median ${lat[Math.floor(lat.length / 2)]} ms · p95 ${lat[Math.floor(lat.length * 0.95)]} ms · engine ${cfg.engine}`);
say(`  ${Object.entries(byDecision).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
say(`\n  serve it:  PORT=8787 npm start        then open ${baseUrl}/i/${initiative.slug}`);
say(`  measure it: npm run accept -- --scenario ${slug}\n`);

function line(now, m, r) {
  const t = now.toISOString().slice(5, 16).replace('T', ' ');
  const who = `${m.channel}:${m.handle}`.slice(0, 22).padEnd(22);
  const txt = m.text.replace(/\s+/g, ' ').slice(0, 44).padEnd(44);
  const need = r.need_id ? needName[r.need_id] ?? r.need_id : '';
  const conf = r.confidence != null ? ` ${r.confidence.toFixed(2)}` : '';
  const agree = m.expect ? (matches(r, m.expect) ? ' ' : '✗') : ' ';
  return `  ${t} ${who} ${txt} ${agree} ${r.decision.padEnd(12)} ${need}${conf}`;
}

function matches(r, expect) {
  if (r.decision !== expect.decision) return false;
  if (!expect.need_ref) return true;
  return r.need_id === needRefs[expect.need_ref];
}

function bar(committed, delivered, required) {
  const w = 14;
  const c = Math.min(w, Math.round((committed / required) * w));
  const d = Math.min(c, Math.round((delivered / required) * w));
  return '▓'.repeat(d) + '▒'.repeat(Math.max(0, c - d)) + '·'.repeat(Math.max(0, w - c));
}

function tally(xs) {
  const out = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function pick(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function say(s) { if (!quiet) console.log(s); }
