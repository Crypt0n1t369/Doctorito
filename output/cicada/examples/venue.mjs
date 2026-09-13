/* A worked example: a station concourse announcing platform changes.
 *
 *   node --disable-warning=ExperimentalWarning examples/venue.mjs
 *
 * Runs entirely offline against the modem — no server, no key. It builds the
 * two things a real deployment needs (a signed channel and a card registry),
 * broadcasts a change, puts the audio through a modelled concourse, and decodes
 * it the way a passenger's phone would.
 */
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
import { fragment, buildSigned, cardBody, openSigned } from "../src/modem/frame.js";
import { render, encodeWav, decodeAudio, estimate, compareProfiles } from "../src/modem/audio.js";
import { applyChannel } from "../src/modem/simulate.js";
import { FS } from "../src/modem/core.js";

const CHANNEL = 7;
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const sign = b => new Uint8Array(crypto.sign(null, Buffer.from(b), privateKey));

// --- The card registry: everything the concourse might ever need to say. -----
// Real announcements carry more than an identifier: display text in every
// language the station serves, accessibility text, and a routing hint.
const registry = new Map([
  [1, {
    type: "platform", train: "IC2041", from: "4", now: "11", at: "18:12",
    lv: { title: "Perona maiņa", body: "IC2041 uz Daugavpili atiet no 11. perona, nevis no 4. Iemesls: pārmiju atteice." },
    en: { title: "Platform change", body: "IC2041 to Daugavpils departs from platform 11, not platform 4. Reason: points failure." },
    ru: { title: "Смена платформы", body: "IC2041 до Даугавпилса отправляется с платформы 11, а не с 4. Причина: отказ стрелки." },
    a11y: "Platform change for the eighteen twelve to Daugavpils. Now platform eleven.",
  }],
  [2, { type: "platform", train: "RE1180", from: "2", now: "3", at: "18:40",
        lv: { title: "Perona maiņa", body: "RE1180 uz Jelgavu atiet no 3. perona." },
        en: { title: "Platform change", body: "RE1180 to Jelgava departs from platform 3." } }],
  [3, { type: "delay", train: "IC2041", minutes: 25 }],
  [4, { type: "boarding", train: "RE1180", closes: "18:40" }],
]);

console.log("Cicada · station concourse example\n");
console.log("Registry: %d cards, synced to every receiver over their normal network.\n", registry.size);

// --- What it would cost to broadcast the payload itself ---------------------
const code = 1;
const payload = Buffer.from(JSON.stringify(registry.get(code)));
const direct = compareProfiles(payload.length, { repeats: 2 }).filter(r => r.usable);
const bestDirect = direct.reduce((a, b) => (b.seconds < a.seconds ? b : a));
console.log("Card %d holds %d bytes of JSON — three languages and accessibility text.", code, payload.length);
console.log("  sent directly       %s, %ss", bestDirect.profile.padEnd(8), bestDirect.seconds);

// --- What it costs as a card reference on a signed channel ------------------
const body = await buildSigned(cardBody(code), 1, sign, CHANNEL);
const profile = "standard";
const repeats = 2;
const est = estimate(body.length, { profile, repeats });
console.log("  as a signed card    %s, %ss  (%d bytes on the air)", profile.padEnd(8), est.seconds, body.length);
console.log("  saving              %sx\n", (bestDirect.seconds / est.seconds).toFixed(1));

// Be straight about where the crossover is. A signature costs 68 bytes, so on a
// signed channel a card only starts paying once the payload exceeds about that.
{
  const crossover = [40, 60, 120, 400, 2000].map(n => {
    const d = compareProfiles(n, { repeats }).filter(r => r.usable)
      .reduce((a, b) => (b.seconds < a.seconds ? b : a));
    return `${String(n).padStart(5)} B  direct ${String(d.seconds).padStart(7)}s   card ${est.seconds}s`;
  });
  console.log("Where the card starts paying, on a signed channel:");
  for (const line of crossover) console.log("  " + line);
  console.log("  A signature costs 68 bytes either way, so below roughly that size a card saves nothing.\n");
}

const frames = fragment(body, { profile, channel: CHANNEL, signed: true, card: true });
const samples = render(frames, { repeats });
writeFileSync(new URL("./venue.wav", import.meta.url), encodeWav(samples));
console.log("Wrote examples/venue.wav — %ss, play it through the concourse PA.\n", (samples.length / FS).toFixed(2));

// --- Now hear it the way a passenger's phone would --------------------------
const trusted = k => k === 1;
for (const condition of ["office", "cafe", "street", "car"]) {
  const heard = applyChannel(samples, condition, { seed: 4242 });
  const { messages, stats } = await decodeAudio(heard, FS, {
    verify: ({ channel, keyId, covered, signature }) =>
      channel === CHANNEL && trusted(keyId) &&
      crypto.verify(null, Buffer.from(covered), publicKey, Buffer.from(signature)),
  });
  const got = messages[0];
  const resolved = got && registry.get(new DataView(got.body.buffer, got.body.byteOffset).getUint32(0));
  console.log(
    "%s %s  %d burst(s), %d decoded, %d unreadable  %s",
    condition.padEnd(8),
    got ? "✓" : "✗",
    stats.detected, stats.decoded, stats.undecodable,
    resolved ? `→ ${resolved.en?.body ?? resolved.type}` : "nothing delivered");
}

// --- And confirm a forged broadcast is refused ------------------------------
const forger = crypto.generateKeyPairSync("ed25519");
const forged = await buildSigned(cardBody(2), 1, b => new Uint8Array(crypto.sign(null, Buffer.from(b), forger.privateKey)), CHANNEL);
const forgedAudio = render(fragment(forged, { profile, channel: CHANNEL, signed: true, card: true }), { repeats: 1 });
const { messages: rejected } = await decodeAudio(forgedAudio, FS, {
  verify: ({ covered, signature }) => crypto.verify(null, Buffer.from(covered), publicKey, Buffer.from(signature)),
});
console.log("\nForged broadcast from an untrusted key: %s",
  rejected.length === 0 ? "rejected ✓" : "DELIVERED — that is a bug");
