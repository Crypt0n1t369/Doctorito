#!/usr/bin/env node
import { open } from '../src/db.js';
import { listScenarios, loadScenario, seedScenario } from '../src/seed.js';
import { one } from '../src/db.js';
import { rmSync } from 'node:fs';

const args = process.argv.slice(2);
const dbPath = arg('--db') ?? 'data/coordination.db';
if (args.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(dbPath + suffix); } catch { /* not there */ }
  }
}

const wanted = args.filter((a) => !a.startsWith('--'));
const slugs = wanted.length ? wanted : listScenarios();

const db = open(dbPath);
for (const slug of slugs) {
  const existing = one(db, 'select * from initiatives where slug=?', slug);
  if (existing) { console.log(`· ${slug} already seeded (${existing.initiative_id})`); continue; }
  const scenario = loadScenario(slug);
  const { initiative, needRefs, refused } = seedScenario(db, scenario);
  console.log(`✓ ${slug}: ${Object.keys(needRefs).length} needs, ${(scenario.actors ?? []).length} actors  → /i/${initiative.slug}`);
  for (const r of refused) console.log(`  ✗ need "${r.ref}" refused: ${r.errors.join(' ')}`);
}

function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
