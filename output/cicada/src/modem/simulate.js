/* Acoustic channel simulator.
 *
 * These are MODELS, not measurements. They are useful for regression testing a
 * payload and for choosing a profile before you go to site; they are not
 * evidence that a real room behaves this way. Anything you intend to deploy
 * should still be measured through the actual speaker, room and microphone.
 */

import { FS, fft } from "./core.js";

export const CONDITIONS = {
  clean: {
    label: "Clean",
    note: "file to file, no channel at all",
    snrDb: null, rt60: 0, drrDb: 99, noise: "white", band: null, driveDb: 0, drift: 0,
  },
  office: {
    label: "Quiet office",
    note: "small room, ventilation hum, phone within arm's reach of the speaker",
    snrDb: 20, rt60: 0.35, drrDb: 12, noise: "pink", band: [150, 3800], driveDb: 0, drift: 0.00002,
  },
  cafe: {
    label: "Busy cafe",
    note: "conversation babble, phone across a table from the source",
    snrDb: 6, rt60: 0.6, drrDb: 6, noise: "pink", band: [150, 3800], driveDb: 2, drift: 0.00005,
  },
  street: {
    label: "Street",
    note: "open air, traffic, phone in the hand",
    snrDb: 3, rt60: 0.15, drrDb: 20, noise: "pink", band: [200, 3600], driveDb: 2, drift: 0.00005,
  },
  car: {
    label: "Car cabin",
    note: "engine and road rumble, small hard-surfaced space",
    snrDb: 10, rt60: 0.2, drrDb: 10, noise: "brown", band: [180, 3500], driveDb: 3, drift: 0.00008,
  },
  phoneSpeaker: {
    label: "Phone loudspeaker",
    note: "small transducer, no bass, driven near its limit",
    snrDb: 15, rt60: 0.3, drrDb: 12, noise: "pink", band: [400, 3600], driveDb: 8, drift: 0.00005,
  },
  broadcastFm: {
    label: "FM broadcast chain",
    note: "station processing, heavy limiting, receiver loudspeaker, room",
    snrDb: 12, rt60: 0.45, drrDb: 8, noise: "pink", band: [120, 3400], driveDb: 12, drift: 0.0001,
  },
  telephone: {
    label: "Telephone band",
    note: "narrowband voice path, band-limited hard at both ends",
    snrDb: 18, rt60: 0.05, drrDb: 20, noise: "white", band: [300, 3400], driveDb: 3, drift: 0.00002,
  },
};
export const CONDITION_NAMES = Object.keys(CONDITIONS);

/** Deterministic PRNG so a simulation can be reproduced from a seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = rnd => {
  let u = 0;
  for (let i = 0; i < 6; i++) u += rnd();
  return (u - 3) / 1.2247449;
};

function colouredNoise(n, kind, rnd) {
  const out = new Float64Array(n);
  if (kind === "white") {
    for (let i = 0; i < n; i++) out[i] = gauss(rnd);
  } else if (kind === "pink") {
    // Voss-McCartney style three-pole approximation of 1/f.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = gauss(rnd);
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      out[i] = b0 + b1 + b2 + w * 0.1848;
    }
  } else {                                        // brown: integrated white
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * gauss(rnd)) / 1.02;
      out[i] = last * 12;
    }
  }
  return normalise(out);
}

function rmsOf(x) {
  let p = 0;
  for (const v of x) p += v * v;
  return Math.sqrt(p / Math.max(1, x.length));
}

function normalise(x) {
  let p = 0;
  for (const v of x) p += v * v;
  const rms = Math.sqrt(p / Math.max(1, x.length)) || 1e-12;
  for (let i = 0; i < x.length; i++) x[i] /= rms;
  return x;
}

/**
 * A direct path plus an exponentially decaying reverberant tail.
 *
 * The tail's total energy is set from the direct-to-reverberant ratio rather
 * than left to chance, because DRR — not RT60 alone — is what decides whether
 * an OFDM symbol survives. A tail that swamps the direct path defeats any
 * modem whose cyclic prefix is shorter than the echo, which is the real and
 * well-known limit of this technique indoors.
 */
function impulseResponse(rt60, drrDb, rnd) {
  if (!rt60 || drrDb >= 60) return null;
  const n = Math.max(2, Math.round(rt60 * FS));
  const h = new Float64Array(n);
  h[0] = 1;                                    // direct arrival
  const gap = Math.round(0.004 * FS);          // ~4 ms before the first reflection
  const decay = Math.log(1e-3) / n;
  let tailEnergy = 0;
  for (let i = gap; i < n; i++) {
    h[i] = gauss(rnd) * Math.exp(decay * i);
    tailEnergy += h[i] * h[i];
  }
  if (tailEnergy > 0) {
    const want = Math.pow(10, -drrDb / 10);    // tail energy relative to direct
    const g = Math.sqrt(want / tailEnergy);
    for (let i = gap; i < n; i++) h[i] *= g;
  }
  return h;
}

function convolve(x, h) {
  const need = x.length + h.length - 1;
  let n = 1;
  while (n < need) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n);
  const br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(x); br.set(h);
  fft(ar, ai, false);
  fft(br, bi, false);
  for (let k = 0; k < n; k++) {
    const rr = ar[k] * br[k] - ai[k] * bi[k];
    const ii = ar[k] * bi[k] + ai[k] * br[k];
    ar[k] = rr; ai[k] = ii;
  }
  fft(ar, ai, true);
  return ar.subarray(0, x.length);
}

/** One-pole high-pass then low-pass; enough to mimic a limited transducer. */
function bandLimit(x, lowHz, highHz) {
  const out = Float64Array.from(x);
  if (lowHz > 0) {
    const a = Math.exp(-2 * Math.PI * lowHz / FS);
    let prevIn = 0, prevOut = 0;
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      prevOut = a * (prevOut + v - prevIn);
      prevIn = v;
      out[i] = prevOut;
    }
  }
  if (highHz > 0 && highHz < FS / 2) {
    const a = 1 - Math.exp(-2 * Math.PI * highHz / FS);
    let prev = 0;
    for (let i = 0; i < out.length; i++) {
      prev += a * (out[i] - prev);
      out[i] = prev;
    }
  }
  return out;
}

/**
 * Soft saturation. `driveDb` is how far the signal is pushed past the limiter's
 * threshold — 0 dB leaves it alone, 12 dB is broadcast-style loudness
 * processing. OFDM has a high peak-to-average ratio, so this hurts it.
 */
function saturate(x, driveDb) {
  if (driveDb <= 0) return x;
  const rms = rmsOf(x) || 1e-12;
  const gain = Math.pow(10, driveDb / 20) / (rms * 4);
  const out = Float64Array.from(x);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * gain);
  return out;
}

/** Linear resample by (1+drift): playback and capture clocks never match exactly. */
function clockDrift(x, drift) {
  if (!drift) return x;
  const ratio = 1 + drift;
  const n = Math.floor(x.length / ratio);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * ratio, k = Math.floor(s), f = s - k;
    out[i] = (1 - f) * x[k] + f * (x[Math.min(k + 1, x.length - 1)] || 0);
  }
  return out;
}

/**
 * Put a rendered transmission through a modelled acoustic path.
 * Returns Float32Array samples at the modem's 8 kHz.
 */
export function applyChannel(samples, conditionName = "clean", { seed = 1, snrDb, gapSeconds = 0.5 } = {}) {
  const cond = CONDITIONS[conditionName];
  if (!cond) throw new Error(`Unknown condition "${conditionName}". Use one of: ${CONDITION_NAMES.join(", ")}`);
  const rnd = mulberry32(seed);

  // Pad so reverb tails and drift do not truncate the last burst.
  const pad = Math.round(gapSeconds * FS);
  let x = new Float64Array(samples.length + pad * 2);
  x.set(samples, pad);

  const h = impulseResponse(cond.rt60, cond.drrDb, rnd);
  if (h) x = Float64Array.from(convolve(x, h));
  if (cond.band) x = bandLimit(x, cond.band[0], cond.band[1]);

  const targetSnr = snrDb ?? cond.snrDb;
  if (targetSnr !== null && targetSnr !== undefined && Number.isFinite(targetSnr)) {
    // Measure signal power over the part that actually carries signal.
    const sig = rmsOf(x.subarray(pad, x.length - pad)) || 1e-12;
    const noiseRms = sig / Math.pow(10, targetSnr / 20);
    const noise = colouredNoise(x.length, cond.noise, rnd);
    for (let i = 0; i < x.length; i++) x[i] += noise[i] * noiseRms;
  }

  x = saturate(x, cond.driveDb);
  x = clockDrift(x, cond.drift);

  let mx = 0;
  for (const v of x) mx = Math.max(mx, Math.abs(v));
  const g = 0.85 / Math.max(mx, 1e-9);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

export function describeConditions() {
  return CONDITION_NAMES.map(name => ({ name, ...CONDITIONS[name] }));
}
