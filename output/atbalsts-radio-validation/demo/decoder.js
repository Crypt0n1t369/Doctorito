/* Atbalsts demo receiver — a direct port of demo/modem_demo.py.
   Every constant and every pseudo-random choice is closed-form so the two
   implementations agree bit for bit. Runs in a browser or in Node. */
(function (root) {
"use strict";

// ----------------------------------------------------------------- constants
var FS = 8000, N_FFT = 512, GUARD = 64, SYM = N_FFT + GUARD;
var CENTRE_HZ = 1500, N_CARRIERS = 106, N_PILOT = 2;
var BITS_PER_SYMBOL = (N_CARRIERS - N_PILOT) * 2;
var K = 7, POLY = [0o133, 0o171], N_STATES = 1 << (K - 1);
var CHIRP_LEN = 1024, CHIRP_F0 = 700, CHIRP_F1 = 2300;
var LEAD = 160, TAIL = 160, HDR = 16;
var BIN0 = Math.round(CENTRE_HZ / FS * N_FFT) - (N_CARRIERS >> 1);

// --------------------------------------------------------------------- CRC32C
var CRC_T = new Int32Array(256);
for (var i = 0; i < 256; i++) {
  var c = i;
  for (var j = 0; j < 8; j++) c = (c & 1) ? ((c >>> 1) ^ 0x82F63B78) : (c >>> 1);
  CRC_T[i] = c;
}
function crc32c(bytes, from, to) {
  from = from || 0; to = (to === undefined) ? bytes.length : to;
  var crc = 0xFFFFFFFF;
  for (var i = from; i < to; i++) crc = (crc >>> 8) ^ CRC_T[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ------------------------------------------------------------------------ FFT
function fft(re, im, inverse) {
  var n = re.length, i, j = 0, k, m, half, step, ang, wr, wi, tr, ti, ur, ui;
  for (i = 1; i < n; i++) {                       // bit reversal
    var bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { tr = re[i]; re[i] = re[j]; re[j] = tr;
                 ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (half = 1; half < n; half <<= 1) {
    step = half << 1;
    ang = (inverse ? Math.PI : -Math.PI) / half;
    for (m = 0; m < n; m += step) {
      for (k = 0; k < half; k++) {
        wr = Math.cos(ang * k); wi = Math.sin(ang * k);
        ur = re[m + k]; ui = im[m + k];
        tr = re[m + k + half] * wr - im[m + k + half] * wi;
        ti = re[m + k + half] * wi + im[m + k + half] * wr;
        re[m + k] = ur + tr; im[m + k] = ui + ti;
        re[m + k + half] = ur - tr; im[m + k + half] = ui - ti;
      }
    }
  }
  if (inverse) for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// -------------------------------------------------------------------- preamble
var CHIRP = (function () {
  var c = new Float64Array(CHIRP_LEN), dur = CHIRP_LEN / FS;
  for (var n = 0; n < CHIRP_LEN; n++) {
    var t = n / FS;
    var ph = 2 * Math.PI * (CHIRP_F0 * t + (CHIRP_F1 - CHIRP_F0) / (2 * dur) * t * t);
    // numpy.hanning uses the symmetric (N-1) denominator
    c[n] = Math.cos(ph) * (0.5 - 0.5 * Math.cos(2 * Math.PI * n / (CHIRP_LEN - 1)));
  }
  return c;
})();

// ------------------------------------------------------- deterministic tables
function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
function strideFor(n) { var s = (Math.floor(Math.sqrt(n)) | 1); while (gcd(s, n) !== 1) s += 2; return s; }
var PERM_CACHE = {};
function permFor(n) {
  if (PERM_CACHE[n]) return PERM_CACHE[n];
  var s = strideFor(n), p = new Int32Array(n);
  for (var i = 0; i < n; i++) p[i] = (i * s) % n;
  return (PERM_CACHE[n] = p);
}
function refPhase(k) { return (Math.PI / 2) * (((k * (k + 1) / 2) % 4)); }

function parity(x) { x ^= x >> 8; x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return x & 1; }
var NEXT = [], OUT = [], PREV = [], PREV_BIT = [], PREV_OUT = [];
(function () {
  var s, b, jj, reg, fill = new Int32Array(N_STATES);
  for (s = 0; s < N_STATES; s++) { NEXT.push([0, 0]); OUT.push([[0, 0], [0, 0]]); }
  for (s = 0; s < N_STATES; s++) for (b = 0; b < 2; b++) {
    reg = (b << (K - 1)) | s;
    NEXT[s][b] = reg >> 1;
    for (jj = 0; jj < 2; jj++) OUT[s][b][jj] = parity(reg & POLY[jj]);
  }
  for (s = 0; s < N_STATES; s++) { PREV.push([0, 0]); PREV_BIT.push([0, 0]); PREV_OUT.push([[0, 0], [0, 0]]); }
  for (s = 0; s < N_STATES; s++) for (b = 0; b < 2; b++) {
    var ns = NEXT[s][b], idx = fill[ns];
    PREV[ns][idx] = s; PREV_BIT[ns][idx] = b;
    PREV_OUT[ns][idx] = [OUT[s][b][0], OUT[s][b][1]];
    fill[ns]++;
  }
})();

function viterbi(soft, nInfo) {
  var steps = soft.length >> 1, s, t, i;
  var metric = new Float64Array(N_STATES), cand = new Float64Array(2);
  var next = new Float64Array(N_STATES);
  var back = new Uint8Array(steps * N_STATES);
  for (s = 1; s < N_STATES; s++) metric[s] = -1e9;
  for (t = 0; t < steps; t++) {
    var s0 = soft[2 * t], s1 = soft[2 * t + 1], best = -Infinity;
    for (s = 0; s < N_STATES; s++) {
      for (i = 0; i < 2; i++) {
        var o = PREV_OUT[s][i];
        cand[i] = metric[PREV[s][i]] + (1 - 2 * o[0]) * s0 + (1 - 2 * o[1]) * s1;
      }
      var pick = cand[1] > cand[0] ? 1 : 0;
      back[t * N_STATES + s] = pick;
      next[s] = cand[pick];
      if (next[s] > best) best = next[s];
    }
    for (s = 0; s < N_STATES; s++) metric[s] = next[s] - best;
  }
  var bits = new Uint8Array(steps), st = 0;
  for (t = steps - 1; t >= 0; t--) {
    var pi = back[t * N_STATES + st];
    bits[t] = PREV_BIT[st][pi];
    st = PREV[st][pi];
  }
  return bits.subarray(0, nInfo);
}

// ------------------------------------------------------------------ modem API
function nDataSymbols(payloadLen) {
  return Math.ceil((payloadLen * 8 + 32 + (K - 1)) * 2 / BITS_PER_SYMBOL);
}
function burstSamples(payloadLen) {
  return LEAD + CHIRP_LEN + GUARD + GUARD + (nDataSymbols(payloadLen) + 1) * SYM + TAIL;
}

/* Demodulate a burst whose chirp begins at `chirpStart` in `x` (8 kHz). */
function demodulateAt(x, chirpStart, payloadLen) {
  var nSym = nDataSymbols(payloadLen) + 1;
  var base = chirpStart + CHIRP_LEN + GUARD + GUARD;
  var offs = [-16, -8, 0, 8, 16], bestMag = -1, bestRe = null, bestIm = null;
  var nDiff = nSym - 1;
  var re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);

  for (var oi = 0; oi < offs.length; oi++) {
    var s0 = base + offs[oi];
    if (s0 < 0 || s0 + nSym * SYM > x.length) continue;
    var sr = new Float64Array(nSym * N_CARRIERS), si = new Float64Array(nSym * N_CARRIERS);
    for (var sIdx = 0; sIdx < nSym; sIdx++) {
      var off = s0 + sIdx * SYM + GUARD;
      for (var n = 0; n < N_FFT; n++) { re[n] = x[off + n]; im[n] = 0; }
      fft(re, im, false);
      for (var c2 = 0; c2 < N_CARRIERS; c2++) {
        sr[sIdx * N_CARRIERS + c2] = re[BIN0 + c2];
        si[sIdx * N_CARRIERS + c2] = im[BIN0 + c2];
      }
    }
    var dr = new Float64Array(nDiff * N_CARRIERS), di = new Float64Array(nDiff * N_CARRIERS), mag = 0;
    for (var t = 0; t < nDiff; t++) for (var c3 = 0; c3 < N_CARRIERS; c3++) {
      var a = (t + 1) * N_CARRIERS + c3, b = t * N_CARRIERS + c3;
      var rr = sr[a] * sr[b] + si[a] * si[b];      // z1 * conj(z0)
      var ii = si[a] * sr[b] - sr[a] * si[b];
      dr[t * N_CARRIERS + c3] = rr; di[t * N_CARRIERS + c3] = ii;
      mag += Math.hypot(rr, ii);
    }
    if (mag > bestMag) { bestMag = mag; bestRe = dr; bestIm = di; }
  }
  if (bestRe === null) return null;

  // common rotation: 4th power pooled over the whole burst, ambiguity from pilots
  var ur = 0, ui = 0, total = nDiff * N_CARRIERS;
  for (var q = 0; q < total; q++) {
    var m2 = Math.hypot(bestRe[q], bestIm[q]) || 1e-12;
    var nr = bestRe[q] / m2, ni = bestIm[q] / m2;
    var r2 = nr * nr - ni * ni, i2 = 2 * nr * ni;          // z^2
    ur += r2 * r2 - i2 * i2; ui += 2 * r2 * i2;            // z^4
  }
  var rot = Math.atan2(ui, ur) / 4;
  var bestScore = Infinity, rotPick = rot;
  for (var kk = 0; kk < 4; kk++) {
    var cand2 = rot + kk * Math.PI / 2, cr = Math.cos(-cand2), ci = Math.sin(-cand2), sc = 0;
    for (var t2 = 0; t2 < nDiff; t2++) {
      var idxs = [t2 * N_CARRIERS, t2 * N_CARRIERS + N_CARRIERS - 1];
      for (var z = 0; z < 2; z++) {
        var p = idxs[z];
        sc += Math.abs(Math.atan2(bestIm[p] * cr + bestRe[p] * ci,
                                  bestRe[p] * cr - bestIm[p] * ci));
      }
    }
    if (sc < bestScore) { bestScore = sc; rotPick = cand2; }
  }

  var nData = N_CARRIERS - N_PILOT, cnt = nDiff * nData;
  var angs = new Float64Array(cnt), amps = new Float64Array(cnt), amean = 0;
  var crr = Math.cos(-rotPick), cii = Math.sin(-rotPick), w = 0;
  for (var t3 = 0; t3 < nDiff; t3++) for (var c4 = 1; c4 < N_CARRIERS - 1; c4++) {
    var p2 = t3 * N_CARRIERS + c4;
    var xr = bestRe[p2] * crr - bestIm[p2] * cii;
    var xi = bestRe[p2] * cii + bestIm[p2] * crr;
    angs[w] = Math.atan2(xi, xr); amps[w] = Math.hypot(xr, xi); amean += amps[w]; w++;
  }
  amean = amean / cnt + 1e-12;

  var soft = new Float64Array(cnt * 2), R2 = Math.SQRT2;
  for (var q2 = 0; q2 < cnt; q2++) {
    var a2 = amps[q2] / amean, cs = Math.cos(angs[q2]), sn = Math.sin(angs[q2]);
    soft[q2 * 2] = (cs + sn) / R2 * a2;
    soft[q2 * 2 + 1] = (cs - sn) / R2 * a2;
  }

  var need = nDataSymbols(payloadLen) * BITS_PER_SYMBOL;
  var perm = permFor(need), de = new Float64Array(need);
  for (var q3 = 0; q3 < need; q3++) de[perm[q3]] = soft[q3];

  var nInfo = payloadLen * 8 + 32 + (K - 1);
  var bits = viterbi(de, nInfo);
  var nb = payloadLen + 4, out = new Uint8Array(nb);
  for (var byi = 0; byi < nb; byi++) {
    var v = 0;
    for (var bi = 0; bi < 8; bi++) v = (v << 1) | bits[byi * 8 + bi];
    out[byi] = v;
  }
  var payload = out.subarray(0, payloadLen);
  var got = ((out[payloadLen] << 24) | (out[payloadLen + 1] << 16) |
             (out[payloadLen + 2] << 8) | out[payloadLen + 3]) >>> 0;
  return crc32c(payload) === got ? payload : null;
}

/* Correlate a window against the chirp; return candidate chirp-start offsets. */
var CHIRP_FFT = {};
function chirpSpectrum(n) {                    // cached: the chirp never changes
  if (CHIRP_FFT[n]) return CHIRP_FFT[n];
  var br = new Float64Array(n), bi = new Float64Array(n);
  for (var j = 0; j < CHIRP_LEN; j++) br[j] = CHIRP[j];
  fft(br, bi, false);
  return (CHIRP_FFT[n] = { re: br, im: bi });
}
function findPeaks(x, from, to, minSep) {
  var len = to - from, n = 1;
  while (n < len + CHIRP_LEN) n <<= 1;
  var ar = new Float64Array(n), ai = new Float64Array(n);
  var cs = chirpSpectrum(n), br = cs.re, bi = cs.im;
  for (var i = 0; i < len; i++) ar[i] = x[from + i];
  fft(ar, ai, false);
  for (var k = 0; k < n; k++) {                      // A * conj(B)
    var rr = ar[k] * br[k] + ai[k] * bi[k];
    var ii = ai[k] * br[k] - ar[k] * bi[k];
    ar[k] = rr; ai[k] = ii;
  }
  fft(ar, ai, true);
  var mag = new Float64Array(len), mx = 0, sum = 0;
  for (var m = 0; m < len; m++) { mag[m] = Math.abs(ar[m]); if (mag[m] > mx) mx = mag[m]; sum += mag[m]; }
  var thresh = Math.max(0.40 * mx, 6 * (sum / Math.max(1, len)));
  var peaks = [];
  while (true) {
    var bi2 = -1, bv = thresh;
    for (var p = 0; p < len; p++) if (mag[p] > bv) { bv = mag[p]; bi2 = p; }
    if (bi2 < 0) break;
    peaks.push(from + bi2);
    for (var z = Math.max(0, bi2 - minSep); z < Math.min(len, bi2 + minSep); z++) mag[z] = 0;
  }
  peaks.sort(function (a, b) { return a - b; });
  return peaks;
}

// ------------------------------------------------------------------ resampler
function Resampler(inRate) {
  this.ratio = inRate / FS;
  this.pos = 0;
  this.hist = new Float64Array(4);
  var fc = 3400 / inRate, taps = 63, h = new Float64Array(taps), sum = 0;
  for (var i = 0; i < taps; i++) {
    var m = i - (taps - 1) / 2;
    var s = (m === 0) ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    s *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1));
    h[i] = s; sum += s;
  }
  for (var q = 0; q < taps; q++) h[q] /= sum;
  this.h = h; this.buf = new Float64Array(taps); this.n = 0; this.filt = [];
}
Resampler.prototype.push = function (input) {
  var h = this.h, taps = h.length, out = [];
  for (var i = 0; i < input.length; i++) {
    for (var s = taps - 1; s > 0; s--) this.buf[s] = this.buf[s - 1];
    this.buf[0] = input[i];
    var acc = 0;
    for (var k = 0; k < taps; k++) acc += this.buf[k] * h[k];
    this.filt.push(acc);
  }
  // cubic-interpolate the filtered stream onto the 8 kHz grid
  while (this.pos + 2 < this.filt.length) {
    var idx = Math.floor(this.pos), fr = this.pos - idx;
    var y0 = this.filt[Math.max(0, idx - 1)], y1 = this.filt[idx];
    var y2 = this.filt[idx + 1], y3 = this.filt[idx + 2];
    var a0 = y3 - y2 - y0 + y1, a1 = y0 - y1 - a0, a2 = y2 - y0;
    out.push(((a0 * fr + a1) * fr + a2) * fr + y1);
    this.pos += this.ratio;
  }
  var drop = Math.max(0, Math.floor(this.pos) - 2);
  if (drop > 0) { this.filt = this.filt.slice(drop); this.pos -= drop; }
  return out;
};

root.AtbalstsModem = {
  FS: FS, HDR: HDR, CHIRP: CHIRP,
  crc32c: crc32c, fft: fft, viterbi: viterbi,
  nDataSymbols: nDataSymbols, burstSamples: burstSamples,
  demodulateAt: demodulateAt, findPeaks: findPeaks, Resampler: Resampler,
  permFor: permFor, refPhase: refPhase
};
})(typeof globalThis !== "undefined" ? globalThis : this);
