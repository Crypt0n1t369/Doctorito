/* Cicada modem core — OFDM data-over-sound.
 *
 * 8 kHz sample rate, 512-point FFT, 64-sample cyclic prefix (72 ms symbol).
 * 106 carriers on bins 43..148 => 671.875 .. 2312.5 Hz occupied bandwidth.
 * Differential QPSK (Gray), rate-1/2 K=7 convolutional code (0o133/0o171),
 * soft-decision Viterbi, deterministic stride interleaver, CRC32C, and a
 * 128 ms linear chirp preamble recovered by matched filter.
 *
 * Derived from the Atbalsts radio-validation modem, which is bit-exact with an
 * independent Python reference implementation. Constants are unchanged so that
 * existing fixtures still decode.
 */

export const FS = 8000;
export const N_FFT = 512;
export const GUARD = 64;
export const SYM = N_FFT + GUARD;
const CENTRE_HZ = 1500;
const N_CARRIERS = 106;
const N_PILOT = 2;
const BITS_PER_SYMBOL = (N_CARRIERS - N_PILOT) * 2;   // 208
const K = 7;
const POLY = [0o133, 0o171];
const N_STATES = 1 << (K - 1);
const CHIRP_LEN = 1024;
const CHIRP_F0 = 700;
const CHIRP_F1 = 2300;
const LEAD = 160;
const TAIL = 160;
const BIN0 = Math.round((CENTRE_HZ / FS) * N_FFT) - (N_CARRIERS >> 1);

export const BAND = { lowHz: BIN0 * FS / N_FFT, highHz: (BIN0 + N_CARRIERS - 1) * FS / N_FFT };

// ------------------------------------------------------------------- CRC32C
const CRC_T = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? ((c >>> 1) ^ 0x82F63B78) : (c >>> 1);
  CRC_T[i] = c;
}
export function crc32c(bytes, from = 0, to = bytes.length) {
  let crc = 0xFFFFFFFF;
  for (let i = from; i < to; i++) crc = (crc >>> 8) ^ CRC_T[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------------- FFT
export function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {              // bit reversal
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let half = 1; half < n; half <<= 1) {
    const step = half << 1, ang = (inverse ? Math.PI : -Math.PI) / half;
    for (let m = 0; m < n; m += step) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[m + k], ui = im[m + k];
        const tr = re[m + k + half] * wr - im[m + k + half] * wi;
        const ti = re[m + k + half] * wi + im[m + k + half] * wr;
        re[m + k] = ur + tr; im[m + k] = ui + ti;
        re[m + k + half] = ur - tr; im[m + k + half] = ui - ti;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// ------------------------------------------------------------------ preamble
export const CHIRP = (() => {
  const c = new Float64Array(CHIRP_LEN), dur = CHIRP_LEN / FS;
  for (let n = 0; n < CHIRP_LEN; n++) {
    const t = n / FS;
    const ph = 2 * Math.PI * (CHIRP_F0 * t + ((CHIRP_F1 - CHIRP_F0) / (2 * dur)) * t * t);
    c[n] = Math.cos(ph) * (0.5 - 0.5 * Math.cos(2 * Math.PI * n / (CHIRP_LEN - 1)));
  }
  return c;
})();

// ------------------------------------------------- deterministic code tables
const gcd = (a, b) => { while (b) { const t = a % b; a = b; b = t; } return a; };
const strideFor = n => { let s = (Math.floor(Math.sqrt(n)) | 1); while (gcd(s, n) !== 1) s += 2; return s; };
const PERM_CACHE = new Map();
export function permFor(n) {
  let p = PERM_CACHE.get(n);
  if (p) return p;
  const s = strideFor(n);
  p = new Int32Array(n);
  for (let i = 0; i < n; i++) p[i] = (i * s) % n;
  PERM_CACHE.set(n, p);
  return p;
}
export const refPhase = k => (Math.PI / 2) * (((k * (k + 1) / 2) % 4));
export const parity = x => { x ^= x >> 8; x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return x & 1; };

const NEXT = [], OUT = [], PREV = [], PREV_BIT = [], PREV_OUT = [];
{
  const fill = new Int32Array(N_STATES);
  for (let s = 0; s < N_STATES; s++) { NEXT.push([0, 0]); OUT.push([[0, 0], [0, 0]]); }
  for (let s = 0; s < N_STATES; s++) for (let b = 0; b < 2; b++) {
    const reg = (b << (K - 1)) | s;
    NEXT[s][b] = reg >> 1;
    for (let j = 0; j < 2; j++) OUT[s][b][j] = parity(reg & POLY[j]);
  }
  for (let s = 0; s < N_STATES; s++) { PREV.push([0, 0]); PREV_BIT.push([0, 0]); PREV_OUT.push([[0, 0], [0, 0]]); }
  for (let s = 0; s < N_STATES; s++) for (let b = 0; b < 2; b++) {
    const ns = NEXT[s][b], idx = fill[ns];
    PREV[ns][idx] = s; PREV_BIT[ns][idx] = b;
    PREV_OUT[ns][idx] = [OUT[s][b][0], OUT[s][b][1]];
    fill[ns]++;
  }
}

export function viterbi(soft, nInfo) {
  const steps = soft.length >> 1;
  const metric = new Float64Array(N_STATES), cand = new Float64Array(2);
  const next = new Float64Array(N_STATES), back = new Uint8Array(steps * N_STATES);
  for (let s = 1; s < N_STATES; s++) metric[s] = -1e9;
  for (let t = 0; t < steps; t++) {
    const s0 = soft[2 * t], s1 = soft[2 * t + 1];
    let best = -Infinity;
    for (let s = 0; s < N_STATES; s++) {
      for (let i = 0; i < 2; i++) {
        const o = PREV_OUT[s][i];
        cand[i] = metric[PREV[s][i]] + (1 - 2 * o[0]) * s0 + (1 - 2 * o[1]) * s1;
      }
      const pick = cand[1] > cand[0] ? 1 : 0;
      back[t * N_STATES + s] = pick;
      next[s] = cand[pick];
      if (next[s] > best) best = next[s];
    }
    for (let s = 0; s < N_STATES; s++) metric[s] = next[s] - best;
  }
  const bits = new Uint8Array(steps);
  let st = 0;
  for (let t = steps - 1; t >= 0; t--) {
    const pi = back[t * N_STATES + st];
    bits[t] = PREV_BIT[st][pi];
    st = PREV[st][pi];
  }
  return bits.subarray(0, nInfo);
}

// ------------------------------------------------------------------ geometry
export const nDataSymbols = payloadLen =>
  Math.ceil((payloadLen * 8 + 32 + (K - 1)) * 2 / BITS_PER_SYMBOL);

export const burstSamples = payloadLen =>
  LEAD + CHIRP_LEN + GUARD + GUARD + (nDataSymbols(payloadLen) + 1) * SYM + TAIL;

export const burstSeconds = payloadLen => burstSamples(payloadLen) / FS;

/**
 * Samples a demodulator actually reads from the chirp onwards.
 *
 * `burstSamples` counts the LEAD silence before the chirp and the TAIL silence
 * after the last symbol; a detector locates the chirp itself and never reads
 * either. Requiring the full `burstSamples` after a detected peak overshoots by
 * LEAD + TAIL and refuses bursts sitting at the very end of a recording — which
 * is exactly where a trimmed recording, or one shortened by a resampler's group
 * delay, puts them.
 */
export const samplesAfterChirp = payloadLen => burstSamples(payloadLen) - LEAD - TAIL;

// ---------------------------------------------------------------- modulation
/** Turn one framed payload into a Float64Array burst at 8 kHz. */
export function modulate(payload, amplitude = 0.32) {
  const raw = new Uint8Array(payload.length + 4);
  raw.set(payload);
  new DataView(raw.buffer).setUint32(payload.length, crc32c(payload));

  const ns = nDataSymbols(payload.length), need = ns * BITS_PER_SYMBOL;
  const code = new Uint8Array(need);
  let state = 0;
  for (let i = 0; i < raw.length * 8 + (K - 1); i++) {
    const bit = i < raw.length * 8 ? (raw[i >> 3] >> (7 - (i & 7))) & 1 : 0;
    const reg = (bit << (K - 1)) | state;
    code[2 * i] = parity(reg & POLY[0]);
    code[2 * i + 1] = parity(reg & POLY[1]);
    state = reg >> 1;
  }
  const perm = permFor(need);
  const bits = Uint8Array.from(perm, p => code[p]);
  const phase = Float64Array.from({ length: N_CARRIERS }, (_, k) => refPhase(k));
  const body = new Float64Array(GUARD + (ns + 1) * SYM);
  const gray = [0, 1, 3, 2];

  for (let s = 0; s <= ns; s++) {
    const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
    for (let k = 0; k < N_CARRIERS; k++) {
      if (s && k > 0 && k < N_CARRIERS - 1) {
        const i = (s - 1) * BITS_PER_SYMBOL + (k - 1) * 2;
        phase[k] += gray[2 * bits[i] + bits[i + 1]] * Math.PI / 2;
      }
      const bin = BIN0 + k;
      re[bin] = Math.cos(phase[k]); im[bin] = Math.sin(phase[k]);
      re[N_FFT - bin] = re[bin]; im[N_FFT - bin] = -im[bin];
    }
    fft(re, im, true);
    const rms = Math.sqrt(re.reduce((a, x) => a + x * x, 0) / N_FFT);
    for (let k = 0; k < N_FFT; k++) re[k] /= rms;
    const at = GUARD + s * SYM;
    body.set(re.subarray(N_FFT - GUARD), at);
    body.set(re, at + GUARD);
  }
  const scale = amplitude * 0.38 / Math.sqrt(body.reduce((a, x) => a + x * x, 0) / body.length);
  for (let i = 0; i < body.length; i++) body[i] *= scale;

  const out = new Float64Array(burstSamples(payload.length));
  const cp = CHIRP.reduce((a, x) => Math.max(a, Math.abs(x)), 0);
  for (let i = 0; i < CHIRP.length; i++) out[LEAD + i] = CHIRP[i] * amplitude / cp;
  out.set(body, LEAD + CHIRP.length + GUARD);
  return out;
}

// -------------------------------------------------------------- demodulation
/** Demodulate a burst whose chirp begins at `chirpStart`. Returns payload or null. */
export function demodulateAt(x, chirpStart, payloadLen) {
  const nSym = nDataSymbols(payloadLen) + 1;
  const base = chirpStart + CHIRP_LEN + GUARD + GUARD;
  const offs = [-16, -8, 0, 8, 16];
  const nDiff = nSym - 1;
  let bestMag = -1, bestRe = null, bestIm = null;
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);

  for (const off0 of offs) {
    const s0 = base + off0;
    if (s0 < 0 || s0 + nSym * SYM > x.length) continue;
    const sr = new Float64Array(nSym * N_CARRIERS), si = new Float64Array(nSym * N_CARRIERS);
    for (let sIdx = 0; sIdx < nSym; sIdx++) {
      const off = s0 + sIdx * SYM + GUARD;
      for (let n = 0; n < N_FFT; n++) { re[n] = x[off + n]; im[n] = 0; }
      fft(re, im, false);
      for (let c = 0; c < N_CARRIERS; c++) {
        sr[sIdx * N_CARRIERS + c] = re[BIN0 + c];
        si[sIdx * N_CARRIERS + c] = im[BIN0 + c];
      }
    }
    const dr = new Float64Array(nDiff * N_CARRIERS), di = new Float64Array(nDiff * N_CARRIERS);
    let mag = 0;
    for (let t = 0; t < nDiff; t++) for (let c = 0; c < N_CARRIERS; c++) {
      const a = (t + 1) * N_CARRIERS + c, b = t * N_CARRIERS + c;
      const rr = sr[a] * sr[b] + si[a] * si[b];          // z1 * conj(z0)
      const ii = si[a] * sr[b] - sr[a] * si[b];
      dr[t * N_CARRIERS + c] = rr; di[t * N_CARRIERS + c] = ii;
      mag += Math.hypot(rr, ii);
    }
    if (mag > bestMag) { bestMag = mag; bestRe = dr; bestIm = di; }
  }
  if (bestRe === null) return null;

  // Common rotation: 4th-power pooled over the burst; quadrant from the pilots.
  let ur = 0, ui = 0;
  const total = nDiff * N_CARRIERS;
  for (let q = 0; q < total; q++) {
    const m2 = Math.hypot(bestRe[q], bestIm[q]) || 1e-12;
    const nr = bestRe[q] / m2, ni = bestIm[q] / m2;
    const r2 = nr * nr - ni * ni, i2 = 2 * nr * ni;
    ur += r2 * r2 - i2 * i2; ui += 2 * r2 * i2;
  }
  const rot = Math.atan2(ui, ur) / 4;
  let bestScore = Infinity, rotPick = rot;
  for (let kk = 0; kk < 4; kk++) {
    const cand = rot + kk * Math.PI / 2, cr = Math.cos(-cand), ci = Math.sin(-cand);
    let sc = 0;
    for (let t = 0; t < nDiff; t++) {
      for (const p of [t * N_CARRIERS, t * N_CARRIERS + N_CARRIERS - 1]) {
        sc += Math.abs(Math.atan2(bestIm[p] * cr + bestRe[p] * ci,
                                  bestRe[p] * cr - bestIm[p] * ci));
      }
    }
    if (sc < bestScore) { bestScore = sc; rotPick = cand; }
  }

  const nData = N_CARRIERS - N_PILOT, cnt = nDiff * nData;
  const angs = new Float64Array(cnt), amps = new Float64Array(cnt);
  const crr = Math.cos(-rotPick), cii = Math.sin(-rotPick);
  let amean = 0, w = 0;
  for (let t = 0; t < nDiff; t++) for (let c = 1; c < N_CARRIERS - 1; c++) {
    const p = t * N_CARRIERS + c;
    const xr = bestRe[p] * crr - bestIm[p] * cii;
    const xi = bestRe[p] * cii + bestIm[p] * crr;
    angs[w] = Math.atan2(xi, xr); amps[w] = Math.hypot(xr, xi); amean += amps[w]; w++;
  }
  amean = amean / cnt + 1e-12;

  const soft = new Float64Array(cnt * 2), R2 = Math.SQRT2;
  for (let q = 0; q < cnt; q++) {
    const a = amps[q] / amean, cs = Math.cos(angs[q]), sn = Math.sin(angs[q]);
    soft[q * 2] = (cs + sn) / R2 * a;
    soft[q * 2 + 1] = (cs - sn) / R2 * a;
  }

  const need = nDataSymbols(payloadLen) * BITS_PER_SYMBOL;
  const perm = permFor(need), de = new Float64Array(need);
  for (let q = 0; q < need; q++) de[perm[q]] = soft[q];

  const nInfo = payloadLen * 8 + 32 + (K - 1);
  const bits = viterbi(de, nInfo);
  const nb = payloadLen + 4, out = new Uint8Array(nb);
  for (let by = 0; by < nb; by++) {
    let v = 0;
    for (let bi = 0; bi < 8; bi++) v = (v << 1) | bits[by * 8 + bi];
    out[by] = v;
  }
  const payload = out.subarray(0, payloadLen);
  const got = ((out[payloadLen] << 24) | (out[payloadLen + 1] << 16) |
               (out[payloadLen + 2] << 8) | out[payloadLen + 3]) >>> 0;
  return crc32c(payload) === got ? payload : null;
}

// ----------------------------------------------------------- burst detection
const CHIRP_FFT = new Map();
function chirpSpectrum(n) {
  let s = CHIRP_FFT.get(n);
  if (s) return s;
  const br = new Float64Array(n), bi = new Float64Array(n);
  for (let j = 0; j < CHIRP_LEN; j++) br[j] = CHIRP[j];
  fft(br, bi, false);
  s = { re: br, im: bi };
  CHIRP_FFT.set(n, s);
  return s;
}
/** Matched-filter correlation against the chirp; returns candidate start offsets. */
export function findPeaks(x, from, to, minSep) {
  const len = to - from;
  if (len <= 0) return [];
  let n = 1;
  while (n < len + CHIRP_LEN) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n);
  const { re: br, im: bi } = chirpSpectrum(n);
  for (let i = 0; i < len; i++) ar[i] = x[from + i];
  fft(ar, ai, false);
  for (let k = 0; k < n; k++) {                        // A * conj(B)
    const rr = ar[k] * br[k] + ai[k] * bi[k];
    const ii = ai[k] * br[k] - ar[k] * bi[k];
    ar[k] = rr; ai[k] = ii;
  }
  fft(ar, ai, true);
  const mag = new Float64Array(len);
  let mx = 0, sum = 0;
  for (let m = 0; m < len; m++) { mag[m] = Math.abs(ar[m]); if (mag[m] > mx) mx = mag[m]; sum += mag[m]; }
  const thresh = Math.max(0.40 * mx, 6 * (sum / Math.max(1, len)));
  const peaks = [];
  for (;;) {
    let idx = -1, bv = thresh;
    for (let p = 0; p < len; p++) if (mag[p] > bv) { bv = mag[p]; idx = p; }
    if (idx < 0) break;
    peaks.push(from + idx);
    for (let z = Math.max(0, idx - minSep); z < Math.min(len, idx + minSep); z++) mag[z] = 0;
  }
  peaks.sort((a, b) => a - b);
  return peaks;
}

// ------------------------------------------------------------------ resample
/** Streaming anti-aliased resampler: any input rate down to the modem's 8 kHz. */
export class Resampler {
  constructor(inRate) {
    this.ratio = inRate / FS;
    const fc = 3400 / inRate, taps = 63, h = new Float64Array(taps);
    // Start reading past the filter's group delay so the output is time-aligned
    // with the input. Without this every resampled stream is shifted late by
    // half the filter length, which moves reported arrival times and can push a
    // trailing burst off the end of the buffer.
    this.pos = (taps - 1) / 2;
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const m = i - (taps - 1) / 2;
      let s = (m === 0) ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
      s *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1));
      h[i] = s; sum += s;
    }
    for (let q = 0; q < taps; q++) h[q] /= sum;
    this.h = h;
    this.buf = new Float64Array(taps);
    this.filt = [];
  }
  push(input) {
    const h = this.h, taps = h.length, out = [];
    for (let i = 0; i < input.length; i++) {
      for (let s = taps - 1; s > 0; s--) this.buf[s] = this.buf[s - 1];
      this.buf[0] = input[i];
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += this.buf[k] * h[k];
      this.filt.push(acc);
    }
    while (this.pos + 2 < this.filt.length) {
      const idx = Math.floor(this.pos), fr = this.pos - idx;
      const y0 = this.filt[Math.max(0, idx - 1)], y1 = this.filt[idx];
      const y2 = this.filt[idx + 1], y3 = this.filt[idx + 2];
      const a0 = y3 - y2 - y0 + y1, a1 = y0 - y1 - a0, a2 = y2 - y0;
      out.push(((a0 * fr + a1) * fr + a2) * fr + y1);
      this.pos += this.ratio;
    }
    const drop = Math.max(0, Math.floor(this.pos) - 2);
    if (drop > 0) { this.filt = this.filt.slice(drop); this.pos -= drop; }
    return out;
  }
}
