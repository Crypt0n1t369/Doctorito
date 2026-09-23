#!/usr/bin/env node
import { open } from '../src/db.js';
import { rebuild, verifyChain, stateFingerprint } from '../src/events.js';

/**
 * Drop every derived table and fold the log again.
 *
 * If this does not produce the same state, the claim that state is a fold over
 * events is false, and everything built on it — reproducing a bind a year
 * later, several organisations writing into one initiative — is false with it.
 */
const dbPath = process.argv[2] ?? 'data/coordination.db';
const db = open(dbPath);

const chain = verifyChain(db);
const before = stateFingerprint(db);
const n = rebuild(db);
const after = stateFingerprint(db);

console.log(`  ${dbPath}`);
console.log(`  events        ${chain.count}`);
console.log(`  hash chain    ${chain.ok ? 'verifies' : `BROKEN at seq ${chain.seq}: ${chain.why}`}`);
console.log(`  head          ${chain.head?.slice(0, 32) ?? '-'}`);
console.log(`  refolded      ${n} events`);
console.log(`  state before  ${before.slice(0, 32)}`);
console.log(`  state after   ${after.slice(0, 32)}`);
console.log(`  ${before === after ? '✓ identical' : '✗ DIVERGENT — the fold is not deterministic'}`);
process.exit(chain.ok && before === after ? 0 : 1);
