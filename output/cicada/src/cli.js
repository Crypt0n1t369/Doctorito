#!/usr/bin/env node
/* Cicada CLI — account and key management for a self-hosted instance, plus
   offline encode/decode that needs no server at all. */

import { readFileSync, writeFileSync } from "node:fs";
import { openDatabase } from "./server/db.js";
import { PLAN_IDS } from "./server/plans.js";
import { renderBody, encodeWav, decodeWav, decodeAudio, estimate, compareProfiles } from "./modem/audio.js";
import { PROFILE_NAMES, DEFAULT_PROFILE, capacityPerFrame } from "./modem/frame.js";
import { FS } from "./modem/core.js";

const [, , command, sub, ...rest] = process.argv;
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith("--") ? true : rest[++i];
}
const db = () => openDatabase({
  file: process.env.CICADA_DB || "data/cicada.db",
  audioDir: process.env.CICADA_AUDIO || "data/audio",
});

const USAGE = `
cicada — data over sound

  cicada account create --email you@example.com [--plan free|pro|scale|selfhosted]
  cicada account list
  cicada key create [--email you@example.com] [--label "ci"]
  cicada key list --email you@example.com
  cicada encode "text"  [--profile standard] [--repeats 2] [--out out.wav]
  cicada decode file.wav
  cicada capacity <bytes> [--repeats 2]
  cicada sweep

Environment: CICADA_DB, CICADA_AUDIO, PORT.
Start the server with: npm start
`;

function firstAccount(store, email) {
  if (email) {
    const a = store.getAccountByEmail(email);
    if (!a) fail(`No account for ${email}`);
    return a;
  }
  const row = store.db.prepare("SELECT * FROM accounts ORDER BY created_at LIMIT 1").get();
  if (!row) fail("No accounts yet. Run: cicada account create --email you@example.com");
  return row;
}
const fail = (m) => { console.error(m); process.exit(1); };

// `account` and `key` take a sub-command; the rest take an argument.
const GROUPED = new Set(["account", "key"]);
const action = GROUPED.has(command) ? `${command} ${sub ?? ""}`.trim() : (command ?? "");

switch (action) {
  case "account create": {
    if (!flags.email) fail("--email is required");
    const plan = flags.plan ?? "free";
    if (!PLAN_IDS.includes(plan)) fail(`--plan must be one of: ${PLAN_IDS.join(", ")}`);
    const store = db();
    if (store.getAccountByEmail(flags.email)) fail(`${flags.email} already has an account`);
    const a = store.createAccount({ email: flags.email, name: flags.name ?? "", plan });
    const k = store.createApiKey(a.id, "created with the CLI");
    console.log(`account  ${a.id}`);
    console.log(`plan     ${plan}`);
    console.log(`key      ${k.secret}`);
    console.log(`\nThat key is shown once. Store it now.`);
    store.close();
    break;
  }
  case "account list": {
    const store = db();
    for (const a of store.db.prepare("SELECT * FROM accounts ORDER BY created_at").all()) {
      console.log(`${a.id}  ${String(a.plan).padEnd(11)} ${a.email}`);
    }
    store.close();
    break;
  }
  case "key create": {
    const store = db();
    const a = firstAccount(store, flags.email);
    const k = store.createApiKey(a.id, flags.label ?? "");
    console.log(k.secret);
    console.error(`\nFor ${a.email}. Shown once.`);
    store.close();
    break;
  }
  case "key list": {
    const store = db();
    const a = firstAccount(store, flags.email);
    for (const k of store.listApiKeys(a.id)) {
      console.log(`${k.prefix}…  ${k.revoked_at ? "revoked" : "active "}  ${k.label}`);
    }
    store.close();
    break;
  }
  case "encode": {
    const text = sub;
    if (!text) fail('Give the text to encode: cicada encode "hello"');
    const profile = flags.profile ?? DEFAULT_PROFILE;
    const repeats = Number(flags.repeats ?? 2);
    const body = new TextEncoder().encode(text);
    const samples = renderBody(body, { profile, repeats });
    const out = flags.out ?? "cicada.wav";
    writeFileSync(out, encodeWav(samples));
    const est = estimate(body.length, { profile, repeats });
    console.log(`${out}  ${body.length} B  ${est.frames} frame(s)  ${(samples.length / FS).toFixed(2)}s  ${profile}`);
    break;
  }
  case "decode": {
    if (!sub) fail("Give a WAV file: cicada decode recording.wav");
    const { samples, sampleRate, channels } = decodeWav(new Uint8Array(readFileSync(sub)));
    const { messages, stats } = await decodeAudio(samples, sampleRate);
    console.log(`${(samples.length / sampleRate).toFixed(2)}s, ${sampleRate} Hz, ${channels}ch`);
    console.log(`${stats.detected} burst(s), ${stats.decoded} decoded, ${stats.undecodable} unreadable, ${stats.duplicates} repeat(s)\n`);
    if (!messages.length) console.log("(no messages)");
    for (const m of messages) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(m.body);
      console.log(`ch ${m.channel} @ ${m.at.toFixed(2)}s  ${m.signed ? `signed(key ${m.keyId}) ` : ""}${m.body.length} B`);
      console.log(`  ${JSON.stringify(text)}`);
    }
    break;
  }
  case "capacity": {
    const bytes = Number(sub);
    if (!Number.isInteger(bytes) || bytes < 1) fail("Give a byte count: cicada capacity 120");
    const repeats = Number(flags.repeats ?? 2);
    console.log(`${bytes} bytes at ${repeats} pass(es):\n`);
    for (const r of compareProfiles(bytes, { repeats })) {
      console.log(r.usable
        ? `  ${r.profile.padEnd(9)} ${String(r.frames).padStart(3)} frame(s)  ${String(r.seconds).padStart(7)}s  ${String(r.bytesPerSecond).padStart(6)} B/s`
        : `  ${r.profile.padEnd(9)} ${r.reason}`);
    }
    break;
  }
  case "sweep": {
    const store = db();
    const r = store.sweep();
    console.log(`removed ${r.audio} audio file(s) and ${r.receipts} receipt(s)`);
    store.close();
    break;
  }
  default:
    console.log(USAGE.trim());
    process.exit(command ? 1 : 0);
}
