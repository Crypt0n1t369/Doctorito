/* Browser transmitter for the EXISTING custom demo modem, not Rattlegram. */
(function (root) {
"use strict";
const M = root.AtbalstsModem, FS = M.FS, N = 512, GUARD = 64, SYM = 576, NC = 106;
const parity = x => { x ^= x >> 8; x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return x & 1; };
function modulate(payload, amplitude = .32) {
  const raw = new Uint8Array(payload.length + 4); raw.set(payload);
  new DataView(raw.buffer).setUint32(payload.length, M.crc32c(payload));
  const ns = M.nDataSymbols(payload.length), need = ns * 208, code = new Uint8Array(need);
  let state = 0;
  for (let i = 0; i < raw.length * 8 + 6; i++) {
    const bit = i < raw.length * 8 ? (raw[i >> 3] >> (7 - (i & 7))) & 1 : 0;
    const reg = (bit << 6) | state; code[2 * i] = parity(reg & 0o133); code[2 * i + 1] = parity(reg & 0o171); state = reg >> 1;
  }
  const perm = M.permFor(need), bits = Uint8Array.from(perm, p => code[p]);
  const phase = Float64Array.from({ length: NC }, (_, k) => M.refPhase(k));
  const body = new Float64Array(GUARD + (ns + 1) * SYM), gray = [0, 1, 3, 2];
  for (let s = 0; s <= ns; s++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let k = 0; k < NC; k++) {
      if (s && k > 0 && k < NC - 1) {
        const i = (s - 1) * 208 + (k - 1) * 2; phase[k] += gray[2 * bits[i] + bits[i + 1]] * Math.PI / 2;
      }
      const bin = 43 + k; re[bin] = Math.cos(phase[k]); im[bin] = Math.sin(phase[k]); re[N - bin] = re[bin]; im[N - bin] = -im[bin];
    }
    M.fft(re, im, true);
    const rms = Math.sqrt(re.reduce((a, x) => a + x * x, 0) / N);
    for (let k = 0; k < N; k++) re[k] /= rms;
    const at = GUARD + s * SYM; body.set(re.subarray(N - GUARD), at); body.set(re, at + GUARD);
  }
  const scale = amplitude * .38 / Math.sqrt(body.reduce((a, x) => a + x * x, 0) / body.length);
  for (let i = 0; i < body.length; i++) body[i] *= scale;
  const out = new Float64Array(M.burstSamples(payload.length));
  const cp = M.CHIRP.reduce((a, x) => Math.max(a, Math.abs(x)), 0);
  for (let i = 0; i < M.CHIRP.length; i++) out[160 + i] = M.CHIRP[i] * amplitude / cp;
  out.set(body, 160 + M.CHIRP.length + GUARD); return out;
}
function transmission(frames, repeats = 3) {
  if (!frames.length || frames.length > 64 || !Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw Error("Invalid transmission size");
  const gap = Math.round(.30 * FS), lead = Math.round(.5 * FS);
  const bursts = frames.map(f => modulate(f));
  const pass = bursts.reduce((n, b) => n + b.length + gap, 0);
  const out = new Float32Array(lead + pass * repeats);
  let at = lead;
  for (let r = 0; r < repeats; r++) for (const burst of bursts) { out.set(burst, at); at += burst.length + gap; }
  let peak = 0; for (const x of out) peak = Math.max(peak, Math.abs(x));
  for (let i = 0; i < out.length; i++) out[i] *= .72 / Math.max(peak, 1e-9);
  return out;
}
// PCM WAV remains 8 kHz; browser/OS audio output resamples for its speaker.
function wav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), d = new DataView(buffer);
  const str = (at, text) => { for (let i = 0; i < text.length; i++) d.setUint8(at + i, text.charCodeAt(i)); };
  str(0, "RIFF"); d.setUint32(4, buffer.byteLength - 8, true); str(8, "WAVE"); str(12, "fmt ");
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, FS, true); d.setUint32(28, FS * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  str(36, "data"); d.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) d.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Uint8Array(buffer);
}
root.AtbalstsEncoder = { modulate, transmission, wav };
})(globalThis);
