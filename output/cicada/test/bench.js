/* Measures what each profile actually delivers through each modelled channel.
 *
 * These are software simulations. They are reproducible and they exercise the
 * real modem, but they are not measurements of a physical speaker, room and
 * microphone. Treat them as a way to compare profiles, not as a reliability
 * claim for a deployment.
 */
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
import { FS, burstSeconds } from "../src/modem/core.js";
import { PROFILES, PROFILE_NAMES, capacityPerFrame } from "../src/modem/frame.js";
import { renderBody, decodeAudio, estimate } from "../src/modem/audio.js";
import { applyChannel, CONDITION_NAMES, CONDITIONS } from "../src/modem/simulate.js";

const TRIALS = Number(process.env.TRIALS || 12);
const REPEATS = Number(process.env.REPEATS || 2);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function trial(profile, condition, seed) {
  const cap = capacityPerFrame(profile, true);
  const body = new Uint8Array(crypto.randomBytes(Math.min(cap, 120)));
  const samples = renderBody(body, { profile, repeats: REPEATS });
  const heard = applyChannel(samples, condition, { seed });
  const { messages, stats } = await decodeAudio(heard, FS);
  return {
    ok: messages.length === 1 && same(messages[0].body, body),
    bytes: body.length,
    seconds: samples.length / FS,
    framesDecoded: stats.decoded,
    framesDetected: stats.detected,
  };
}

const results = { generatedAt: new Date().toISOString(), trials: TRIALS, repeats: REPEATS, sampleRate: FS, rows: [] };

console.log(`\nCicada delivery matrix — ${TRIALS} trials per cell, ${REPEATS} passes per transmission`);
console.log("Simulated channels only. Not a measurement of real acoustics.\n");
const header = ["profile".padEnd(9), "B/frame".padStart(8), "airtime".padStart(8), ...CONDITION_NAMES.map(c => c.slice(0, 9).padStart(10))];
console.log(header.join(" "));
console.log("-".repeat(header.join(" ").length));

for (const profile of PROFILE_NAMES) {
  const cap = Math.min(capacityPerFrame(profile, true), 120);
  const est = estimate(cap, { profile, repeats: REPEATS });
  const cells = [];
  const row = { profile, frameBytes: PROFILES[profile].frameBytes, payloadBytes: cap, airtimeSeconds: est.seconds, conditions: {} };
  for (const condition of CONDITION_NAMES) {
    let ok = 0;
    for (let t = 0; t < TRIALS; t++) {
      const r = await trial(profile, condition, 1000 + t * 7);
      if (r.ok) ok++;
    }
    const pct = Math.round(100 * ok / TRIALS);
    row.conditions[condition] = pct;
    cells.push(`${pct}%`.padStart(10));
  }
  results.rows.push(row);
  console.log([profile.padEnd(9), String(PROFILES[profile].frameBytes).padStart(8),
               `${est.seconds}s`.padStart(8), ...cells].join(" "));
}

console.log("\nThroughput at each profile (payload bytes per second of airtime, single pass):");
for (const profile of PROFILE_NAMES) {
  const cap = capacityPerFrame(profile, false) || capacityPerFrame(profile, true);
  const per = burstSeconds(PROFILES[profile].frameBytes) + 0.30;
  console.log(`  ${profile.padEnd(9)} ${(cap / per).toFixed(1).padStart(6)} B/s   ${((cap / per) * 8).toFixed(0).padStart(5)} bit/s`);
}

console.log("\nConditions modelled:");
for (const n of CONDITION_NAMES) {
  const c = CONDITIONS[n];
  console.log(`  ${n.padEnd(13)} SNR ${String(c.snrDb ?? "—").padStart(3)} dB  RT60 ${String(c.rt60).padStart(4)}s  DRR ${String(c.drrDb).padStart(2)} dB  drive ${String(c.driveDb).padStart(2)} dB`);
}

writeFileSync(new URL("../docs/delivery-matrix.json", import.meta.url), JSON.stringify(results, null, 2));
console.log("\nWrote docs/delivery-matrix.json");
