#!/usr/bin/env node
import { open, all, one } from './src/db.js';
import { createApp, COORDINATOR_KEY } from './src/web/server.js';
import { expireDueLeases } from './src/pipeline/leases.js';
import { runOutbound } from './src/pipeline/outbound.js';

/**
 * One application process, a handful of timers, one database. No Kubernetes,
 * no queue broker: the work queue is the same database as everything else.
 */
const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB ?? 'data/coordination.db';
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const LEASE_SWEEP_MS = Number(process.env.LEASE_SWEEP_MS ?? 60_000);
const OUTBOUND_MS = Number(process.env.OUTBOUND_MS ?? 300_000);

const db = open(DB_PATH);
const app = createApp(db, { baseUrl: BASE_URL });

app.listen(PORT, () => {
  const initiatives = all(db, 'select slug, title from initiatives order by created_at');
  console.log(`\n  ${BASE_URL}`);
  for (const i of initiatives) console.log(`    /i/${i.slug.padEnd(20)} ${i.title}`);
  if (!initiatives.length) console.log('    nothing seeded yet — run: npm run seed');
  console.log(`\n  coordinator console (queue, needs editor, operator switch):`);
  console.log(`    ${BASE_URL}/login?key=${COORDINATOR_KEY}`);
  console.log(`\n  prototype auth: one shared key, a signed cookie, a session row.`);
  console.log(`  set COORDINATOR_KEY and SESSION_SECRET to keep them across restarts.\n`);
});

// Unconfirmed leases expire and the quantity returns to the pool.
setInterval(() => {
  try {
    const n = expireDueLeases(db);
    if (n) console.log(`  ${n} lease${n === 1 ? '' : 's'} expired, quantity returned`);
  } catch (err) { console.error('lease sweep:', err.message); }
}, LEASE_SWEEP_MS).unref();

// A need that ages without commitments finds its own people.
setInterval(async () => {
  for (const init of all(db, `select * from initiatives where status='open'`)) {
    try {
      const report = await runOutbound(db, { initiative: init, baseUrl: BASE_URL });
      for (const r of report) {
        if (r.asked) console.log(`  asked ${r.asked} about "${r.need ?? r.need_id}" (${r.candidates} ranked)`);
      }
    } catch (err) { console.error(`outbound ${init.slug}:`, err.message); }
  }
}, OUTBOUND_MS).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { app.close(() => process.exit(0)); });
}
