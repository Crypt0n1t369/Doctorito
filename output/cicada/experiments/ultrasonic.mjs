/* Is there a case for moving Cicada into the near-ultrasonic band?
 *
 * Rather than argue it, this runs the *unmodified* modem through an
 * upconversion to an arbitrary centre frequency, applies models of the things
 * that actually attenuate ultrasound on consumer hardware, and decodes it back.
 * A decode either happens or it does not.
 *
 *   node --disable-warning=ExperimentalWarning experiments/ultrasonic.mjs
 *
 * Everything here is a model. The transducer curves, air absorption and codec
 * cutoffs are drawn from published behaviour, not from this machine's speaker.
 * They are good enough to separate "marginal" from "impossible"; they are not a
 * substitute for a measurement on real hardware.
 */

import { writeFileSync } from "node:fs";
import { FS, fft, burstSeconds } from "../src/modem/core.js";
import { PROFILES } from "../src/modem/frame.js";
import { renderBody, decodeAudio } from "../src/modem/audio.js";

const RF = 48000;                 // the rate a phone actually captures at
const UP = RF / FS;               // 6

// ---------------------------------------------------------------- DSP helpers
const nextPow2 = n => { let p = 1; while (p < n) p <<= 1; return p; };

/** Apply an arbitrary magnitude response, given as dB at a frequency. */
function applyResponse(x, dbAt) {
  const n = nextPow2(x.length);
  const { re, im } = spectrum(x, n);
  for (let k = 0; k <= n / 2; k++) {
    const hz = k * RF / n;
    const g = Math.pow(10, dbAt(hz) / 20);
    re[k] *= g; im[k] *= g;
    if (k > 0 && k < n / 2) { re[n - k] *= g; im[n - k] *= g; }
  }
  fft(re, im, true);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = re[i];
  return out;
}

/** A brick-wall-ish lowpass, for the places a pipeline simply stops. */
const lowpass = (cutHz, slopeDbPerKhz = 60) =>
  hz => (hz <= cutHz ? 0 : -slopeDbPerKhz * (hz - cutHz) / 1000);

/** Forward FFT of a real signal, returned as {re, im} of length n. */
function spectrum(x, n) {
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(x.subarray(0, Math.min(x.length, n)));
  fft(re, im, false);
  return { re, im };
}

/** Analytic (one-sided) signal: zero the negative frequencies, double the rest. */
function toAnalytic(re, im) {
  const n = re.length, half = n >> 1;
  for (let k = 1; k < half; k++) { re[k] *= 2; im[k] *= 2; }
  for (let k = half + 1; k < n; k++) { re[k] = 0; im[k] = 0; }
}

/**
 * Single-sideband upconversion. Shifting the analytic spectrum by `bins` moves
 * the occupied band without mirroring it, which is what a real transmitter
 * would do and what keeps the occupied bandwidth honest.
 */
function shiftSpectrum(re, im, bins) {
  const n = re.length;
  const nr = new Float64Array(n), ni = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const dst = ((k + bins) % n + n) % n;
    nr[dst] = re[k]; ni[dst] = im[k];
  }
  return { re: nr, im: ni };
}

/**
 * Resample 8 kHz -> 48 kHz: zero-stuff by six, then filter away the images.
 *
 * Not by spectral zero-padding — six times a power of two is not a power of
 * two, and the FFT here needs one.
 */
function upsample(x) {
  const y = new Float64Array(x.length * UP);
  for (let i = 0; i < x.length; i++) y[i * UP] = x[i] * UP;
  return applyResponse(y, lowpass(3900, 400));
}

/** Move the baseband signal up so its band is centred on `centreHz`. */
function upconvert(baseband, centreHz) {
  const x = upsample(baseband);
  const n = nextPow2(x.length);
  const { re, im } = spectrum(x, n);
  toAnalytic(re, im);
  // The modem's own band is centred on 1500 Hz; shift by the difference.
  const bins = Math.round((centreHz - 1500) / RF * n);
  const s = shiftSpectrum(re, im, bins);
  fft(s.re, s.im, true);
  const out = new Float64Array(x.length);
  for (let i = 0; i < out.length; i++) out[i] = s.re[i];
  return normalise(out);
}

/** Bring it back down and decimate to the modem's 8 kHz. */
function downconvert(rf, centreHz) {
  const n = nextPow2(rf.length);
  const { re, im } = spectrum(rf, n);
  toAnalytic(re, im);
  const bins = Math.round((centreHz - 1500) / RF * n);
  const s = shiftSpectrum(re, im, -bins);
  // Anti-alias before decimating by six: anything the shift left above 4 kHz
  // would fold straight onto the modem's band.
  const keep = Math.round(4000 / RF * n);
  for (let k = keep; k < n; k++) { s.re[k] = 0; s.im[k] = 0; }
  fft(s.re, s.im, true);
  const out = new Float32Array(Math.floor(rf.length / UP));
  for (let i = 0; i < out.length; i++) out[i] = s.re[i * UP];
  return out;
}

function normalise(x, peak = 0.85) {
  let mx = 0;
  for (const v of x) mx = Math.max(mx, Math.abs(v));
  const g = peak / Math.max(mx, 1e-12);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

// ------------------------------------------------------- the physical models
/**
 * Smartphone loudspeaker + MEMS microphone, end to end, in dB relative to
 * 2 kHz. Small transducers are flat through the voice band and fall away above
 * roughly 10 kHz; by 19 kHz the pair is tens of dB down. Published smartphone
 * measurements put the speaker alone at −20 to −35 dB there.
 */
const transducerDb = hz => {
  if (hz < 300) return -12 * (300 - hz) / 300;      // no bass from a phone speaker
  if (hz <= 10000) return 0;
  // −3.5 dB per kHz above 10 kHz, for both ends of the link combined.
  return -3.5 * (hz - 10000) / 1000;
};

/** ISO 9613-1 atmospheric absorption at 20 C, 50% RH, interpolated in log f. */
const ABSORPTION = [        // Hz, dB per metre
  [125, 0.0004], [250, 0.0011], [500, 0.0028], [1000, 0.0060],
  [2000, 0.0119], [4000, 0.0343], [8000, 0.1049], [16000, 0.3416], [20000, 0.47],
];
function airDbPerMetre(hz) {
  if (hz <= ABSORPTION[0][0]) return ABSORPTION[0][1];
  for (let i = 1; i < ABSORPTION.length; i++) {
    const [f1, a1] = ABSORPTION[i], [f0, a0] = ABSORPTION[i - 1];
    if (hz <= f1) {
      const t = (Math.log(hz) - Math.log(f0)) / (Math.log(f1) - Math.log(f0));
      return a0 + t * (a1 - a0);
    }
  }
  return ABSORPTION.at(-1)[1] * (hz / 20000) ** 2;
}

/** Reverberation falls with frequency because air absorbs the tail first. */
function rt60At(hz, rt60At1k) {
  const scale = hz <= 1000 ? 1 : Math.max(0.18, 1 - 0.55 * Math.log2(hz / 1000) / 4.3);
  return rt60At1k * scale;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = rnd => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / 1.2247449; };

function reverb(x, rt60, drrDb, rnd) {
  if (!rt60) return x;
  const n = Math.max(2, Math.round(rt60 * RF));
  const h = new Float64Array(n);
  h[0] = 1;
  const gap = Math.round(0.004 * RF);
  const decay = Math.log(1e-3) / n;
  let tail = 0;
  for (let i = gap; i < n; i++) { h[i] = gauss(rnd) * Math.exp(decay * i); tail += h[i] * h[i]; }
  if (tail > 0) {
    const g = Math.sqrt(Math.pow(10, -drrDb / 10) / tail);
    for (let i = gap; i < n; i++) h[i] *= g;
  }
  // FFT convolution.
  const need = x.length + n - 1, N = nextPow2(need);
  const a = spectrum(x, N), b = spectrum(h, N);
  for (let k = 0; k < N; k++) {
    const rr = a.re[k] * b.re[k] - a.im[k] * b.im[k];
    const ii = a.re[k] * b.im[k] + a.im[k] * b.re[k];
    a.re[k] = rr; a.im[k] = ii;
  }
  fft(a.re, a.im, true);
  return a.re.subarray(0, x.length);
}

const rms = x => { let p = 0; for (const v of x) p += v * v; return Math.sqrt(p / Math.max(1, x.length)); };

/**
 * Add noise at an ABSOLUTE level.
 *
 * Scaling the noise to whatever survived the channel would make attenuation
 * free, which is the one thing this experiment exists to measure. The room's
 * noise floor and the microphone's self-noise do not get quieter because the
 * signal reaching them did.
 */
function addNoiseAbsolute(x, level, rnd) {
  const out = Float64Array.from(x);
  for (let i = 0; i < out.length; i++) out[i] += gauss(rnd) * level;
  return out;
}

// --------------------------------------------------------------- the harness
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const PAYLOAD = new TextEncoder().encode("Gate 14 boarding closes 18:40");

/**
 * Put one transmission through a full chain at a chosen centre frequency and
 * report whether it arrived.
 */
async function run({
  centreHz, profile = "robust", repeats = 1, seed = 11,
  metres = 1, rt60 = 0, drrDb = 12, snrDb = null, pipeline = null,
  transducers = true,
}) {
  const rnd = mulberry32(seed);
  const baseband = renderBody(PAYLOAD, { profile, repeats });
  let rf = upconvert(baseband, centreHz);

  // `snrDb` is the reference: the SNR a listener would see at 1 m with a
  // transducer pair that was flat. Everything below then costs against it.
  const noiseLevel = snrDb === null ? 0 : rms(rf) / Math.pow(10, snrDb / 20);

  if (rt60) rf = reverb(rf, rt60, drrDb, rnd);
  if (pipeline) rf = applyResponse(rf, pipeline);
  if (transducers) rf = applyResponse(rf, transducerDb);
  if (metres && metres !== 1) {
    // Spherical spreading from the 1 m reference, plus atmospheric absorption.
    const spreadDb = -20 * Math.log10(Math.max(metres, 0.05));
    rf = applyResponse(rf, hz => spreadDb - airDbPerMetre(hz) * metres);
  } else if (metres === 1) {
    rf = applyResponse(rf, hz => -airDbPerMetre(hz));
  }
  if (noiseLevel) rf = addNoiseAbsolute(rf, noiseLevel, rnd);

  const back = downconvert(rf, centreHz);
  const { messages, stats } = await decodeAudio(back, FS);
  return {
    ok: messages.length === 1 && same(messages[0].body, PAYLOAD),
    detected: stats.detected,
    decoded: stats.decoded,
  };
}

/** Total path loss in dB at the band centre, for reporting alongside a result. */
function pathLossDb(centreHz, metres, transducers = true) {
  const spread = metres === 1 ? 0 : -20 * Math.log10(Math.max(metres, 0.05));
  const air = -airDbPerMetre(centreHz) * metres;
  const td = transducers ? transducerDb(centreHz) : 0;
  return spread + air + td;
}

async function rate(opts, trials = 8) {
  let ok = 0;
  for (let t = 0; t < trials; t++) if ((await run({ ...opts, seed: 100 + t * 13 })).ok) ok++;
  return Math.round(100 * ok / trials);
}

// ------------------------------------------------------------------ measure
const results = { generatedAt: new Date().toISOString(), sections: {} };
const line = (...a) => console.log(...a);

line("\nCicada in the near-ultrasonic band — measured, not argued");
line("Models of real hardware, not a measurement of any. Every decode runs the unmodified modem.\n");

// --- 0. Sanity: the harness must be transparent at the modem's own band -----
line("0 · Harness check");
const control = await run({ centreHz: 1500, transducers: false });
line(`  upconvert -> downconvert at 1500 Hz, no channel: ${control.ok ? "decodes ✓" : "BROKEN ✗"}`);
if (!control.ok) { line("  The harness itself is wrong; stopping."); process.exit(1); }

// --- 1. Link budget: what the transducers alone cost ------------------------
line("\n1 · What the transducer pair costs, before any room is involved");
line("     centre    band occupied        speaker+mic      vs audible");
const budget = [];
for (const centre of [1500, 6000, 12000, 16000, 18000, 19000, 20000, 21000]) {
  const lo = centre - 820, hi = centre + 820;
  const loss = (transducerDb(lo) + transducerDb(centre) + transducerDb(hi)) / 3;
  const rel = loss - transducerDb(1500);
  budget.push({ centreHz: centre, bandLoHz: lo, bandHiHz: hi, transducerDb: Number(loss.toFixed(1)) });
  line(`  ${String(centre).padStart(6)} Hz  ${String(lo).padStart(6)}–${String(hi).padEnd(6)} Hz`
    + `  ${loss.toFixed(1).padStart(7)} dB  ${(rel >= 0 ? " " : "") + rel.toFixed(1).padStart(8)} dB`);
}
results.sections.linkBudget = budget;
line("  The modem cliffs at −4 dB SNR, so every dB here comes straight off the range.");

// --- 2. Does it still decode at each centre, at arm's length? ---------------
line("\n2 · Delivery at 1 m in a quiet room, 8 trials per centre");
const byCentre = [];
for (const centre of [1500, 12000, 16000, 18000, 19000, 20000]) {
  const pct = await rate({ centreHz: centre, metres: 1, rt60: 0.35, drrDb: 12, snrDb: 20 });
  byCentre.push({ centreHz: centre, deliveryPct: pct });
  line(`  ${String(centre).padStart(6)} Hz  ${String(pct).padStart(3)}%`);
}
results.sections.byCentre = byCentre;

// --- 3. Range ---------------------------------------------------------------
line("\n3 · Range, quiet room (reference SNR 25 dB at 1 m)");
line("            ---------- audible ----------   ---------- 19 kHz ----------");
line("   dist      path loss     delivery          path loss     delivery");
const ranges = [];
for (const metres of [0.3, 1, 2, 5, 10, 20]) {
  const la = pathLossDb(1500, metres), lu = pathLossDb(19000, metres);
  const a = await rate({ centreHz: 1500, metres, rt60: 0.4, drrDb: 12, snrDb: 25 }, 6);
  const u = await rate({ centreHz: 19000, metres, rt60: rt60At(19000, 0.4), drrDb: 12, snrDb: 25 }, 6);
  ranges.push({ metres, audibleLossDb: Number(la.toFixed(1)), audiblePct: a,
                ultrasonicLossDb: Number(lu.toFixed(1)), ultrasonicPct: u });
  line(`  ${String(metres).padStart(4)} m   ${la.toFixed(1).padStart(8)} dB   ${String(a).padStart(3)}%`
    + `            ${lu.toFixed(1).padStart(8)} dB   ${String(u).padStart(3)}%`);
}
results.sections.range = ranges;
line("  Ultrasound starts ~31 dB down. At 6 dB per doubling of distance that is");
line("  roughly a 30x range penalty before the room is even considered.");

// --- 4. The reverberation advantage ultrasound really does have ------------
line("\n4 · Reverberant space — ultrasound's one real advantage, with its");
line("    link-budget penalty set aside so the reverb effect is visible alone");
const reverbRows = [];
for (const rt of [0.4, 0.8, 1.5, 2.5, 4.0]) {
  // A hard reverberant case: the tail carries as much energy as the direct path.
  const a = await rate({ centreHz: 1500, metres: 2, rt60: rt, drrDb: 0, snrDb: 30 }, 6);
  const u = await rate({ centreHz: 19000, metres: 2, rt60: rt60At(19000, rt), drrDb: 0, snrDb: 30, transducers: false }, 6);
  reverbRows.push({ rt60At1kHz: rt, rt60At19kHz: Number(rt60At(19000, rt).toFixed(2)), audiblePct: a, ultrasonicPct: u });
  line(`  RT60 ${rt.toFixed(1)}s at 1 kHz -> ${rt60At(19000, rt).toFixed(2)}s at 19 kHz`
    + `   audible ${String(a).padStart(3)}%   19 kHz ${String(u).padStart(3)}%`);
}
results.sections.reverberation = reverbRows;

// --- 5. The pipelines it has to survive ------------------------------------
line("\n5 · Survival through the paths this would actually travel");
const PIPELINES = [
  { name: "FM broadcast", cut: 15000, why: "ITU baseband: programme audio stops at 15 kHz; the stereo pilot sits at 19 kHz" },
  { name: "DAB+ / AAC 96k", cut: 15500, why: "codec lowpass at typical broadcast bitrates" },
  { name: "Opus voice 24k", cut: 12000, why: "wideband voice mode" },
  { name: "Telephone", cut: 3400, why: "narrowband voice path" },
  { name: "Video AAC 128k", cut: 16000, why: "typical encoder cutoff" },
  { name: "PA / venue amp", cut: 18000, why: "class-D amplifier and ceiling speakers" },
  { name: "Direct playback", cut: 24000, why: "a phone or laptop speaker, nothing in between" },
];
const pipelineRows = [];
for (const p of PIPELINES) {
  const a = await rate({ centreHz: 1500, metres: 1, rt60: 0.35, snrDb: 30, pipeline: lowpass(p.cut) }, 6);
  const u = await rate({ centreHz: 19000, metres: 1, rt60: rt60At(19000, 0.35), snrDb: 30, pipeline: lowpass(p.cut) }, 6);
  pipelineRows.push({ pipeline: p.name, cutoffHz: p.cut, audiblePct: a, ultrasonicPct: u, why: p.why });
  line(`  ${p.name.padEnd(17)} cut ${String(p.cut).padStart(5)} Hz   audible ${String(a).padStart(3)}%   19 kHz ${String(u).padStart(3)}%`);
}
results.sections.pipelines = pipelineRows;

// --- 6. Throughput is set by bandwidth, not by centre frequency -------------
line("\n6 · Throughput is bandwidth, not height");
line("  The modem occupies 1.64 kHz wherever it sits. Moving it up buys no speed;");
line("  speed would need more bandwidth, and there is little usable room up there.");
const usable = [
  { band: "672 – 2313 Hz", width: 1.64, note: "today: below every voice-codec cutoff" },
  { band: "18.0 – 19.6 kHz", width: 1.64, note: "the only ultrasonic band both a phone speaker and mic reach" },
  { band: "20 – 24 kHz", width: 4.0, note: "within Nyquist at 48 kHz, but phone speakers are essentially dead" },
];
for (const u of usable) {
  const bytes = (PROFILES.standard.frameBytes - 12) / (burstSeconds(128) + 0.3);
  line(`  ${u.band.padEnd(17)} ${String(u.width).padStart(4)} kHz   ~${bytes.toFixed(0)} B/s   ${u.note}`);
}
results.sections.bandwidth = usable;

// --- 7. Who can hear it ----------------------------------------------------
line("\n7 · 'Inaudible' is age-dependent, and not true for everyone");
const AUDIBILITY = [
  ["Under 18", 19000, "hears a 19 kHz tone plainly"],
  ["18–24", 17500, "many hear it, especially at close range"],
  ["25–39", 16000, "usually not at 19 kHz"],
  ["40+", 14000, "no"],
  ["Dogs", 45000, "yes, and 19 kHz is well inside their range"],
  ["Cats", 64000, "yes"],
];
for (const [who, limit, verdict] of AUDIBILITY) {
  line(`  ${who.padEnd(10)} hearing to ~${String(limit / 1000).padStart(4)} kHz   ${verdict}`);
}
results.sections.audibility = AUDIBILITY.map(([group, limitHz, verdict]) => ({ group, limitHz, verdict }));

writeFileSync(new URL("../docs/ultrasonic-findings.json", import.meta.url), JSON.stringify(results, null, 2));
line("\nWrote docs/ultrasonic-findings.json");
