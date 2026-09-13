/* Transmission assembly, WAV containers, and the streaming receiver. */

import {
  FS, modulate, burstSamples, burstSeconds, samplesAfterChirp, findPeaks, demodulateAt, Resampler,
} from "./core.js";
import {
  PROFILES, PROFILE_NAMES, FRAME_SIZES, DEFAULT_PROFILE, profileOf,
  fragment, parseFrame, Reassembler, frameCount, capacityPerFrame,
  CicadaFrameError, BadInputError,
} from "./frame.js";

export const DEFAULT_GAP_SECONDS = 0.30;
/* Enough runway for a capture device's gain to settle, and no more. The burst
   itself already carries 20 ms of internal lead before the chirp. */
export const DEFAULT_LEAD_SECONDS = 0.15;
export const MAX_REPEATS = 10;

/**
 * Airtime for a message, without rendering it. Cheap enough to call per keystroke.
 */
export function estimate(bodyLength, {
  profile = DEFAULT_PROFILE, repeats = 2,
  gap = DEFAULT_GAP_SECONDS, lead = DEFAULT_LEAD_SECONDS,
} = {}) {
  const p = profileOf(profile);
  const frames = frameCount(profile, bodyLength);
  const burst = burstSeconds(p.frameBytes);
  const onePass = frames * (burst + gap);
  // No gap is emitted after the final burst, so subtract the one this counted.
  const seconds = lead + onePass * repeats - gap;
  return {
    profile,
    frameBytes: p.frameBytes,
    frames,
    repeats,
    burstSeconds: round(burst, 4),
    passSeconds: round(onePass, 3),
    seconds: round(seconds, 3),
    bytesPerSecond: round(bodyLength / seconds, 1),
    payloadBitsPerSecond: round(bodyLength * 8 / seconds, 0),
    sampleRate: FS,
  };
}

const round = (v, n) => Number(v.toFixed(n));

/** Compare every profile for one message length. */
export function compareProfiles(bodyLength, opts = {}) {
  return PROFILE_NAMES.map(name => {
    const soloCap = capacityPerFrame(name, true);
    const multiCap = capacityPerFrame(name, false);
    if (bodyLength > soloCap && multiCap <= 0) {
      return { profile: name, usable: false, reason: `holds at most ${soloCap} bytes` };
    }
    return { profile: name, usable: true, ...estimate(bodyLength, { ...opts, profile: name }) };
  });
}

/**
 * Render frames into one Float32Array at 8 kHz: lead-in silence, then each
 * pass of every burst separated by a gap. Repeats give a late or briefly
 * interrupted listener another chance without any return channel.
 */
export function render(frames, {
  repeats = 2, gap = DEFAULT_GAP_SECONDS, lead = DEFAULT_LEAD_SECONDS, amplitude = 0.32, peak = 0.72,
} = {}) {
  if (!frames.length) throw new CicadaFrameError("no frames to render");
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > MAX_REPEATS) {
    throw new CicadaFrameError(`repeats must be an integer 1..${MAX_REPEATS}`);
  }
  const gapSamples = Math.round(gap * FS);
  const leadSamples = Math.round(lead * FS);
  const bursts = frames.map(f => modulate(f, amplitude));
  const passLength = bursts.reduce((n, b) => n + b.length + gapSamples, 0);
  const out = new Float32Array(leadSamples + passLength * repeats - gapSamples);
  let at = leadSamples;
  for (let r = 0; r < repeats; r++) {
    for (const b of bursts) {
      out.set(b, at);
      at += b.length;
      // Gaps separate bursts; nothing needs separating after the last one.
      if (at + gapSamples < out.length) at += gapSamples;
    }
  }
  let mx = 0;
  for (const v of out) mx = Math.max(mx, Math.abs(v));
  const scale = peak / Math.max(mx, 1e-9);
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

/** Convenience: body bytes straight to samples. */
export function renderBody(body, opts = {}) {
  const frames = fragment(body, opts);
  return render(frames, opts);
}

// -------------------------------------------------------------------- WAV IO
export function encodeWav(samples, sampleRate = FS) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const d = new DataView(buffer);
  const str = (at, text) => { for (let i = 0; i < text.length; i++) d.setUint8(at + i, text.charCodeAt(i)); };
  str(0, "RIFF"); d.setUint32(4, buffer.byteLength - 8, true); str(8, "WAVE");
  str(12, "fmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, sampleRate, true); d.setUint32(28, sampleRate * 2, true);
  d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  str(36, "data"); d.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    d.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  }
  return new Uint8Array(buffer);
}

export class WavError extends BadInputError {
  constructor(message) { super(message, "WavError"); }
}

/** Decode a PCM WAV into mono float samples. 8, 16, 24 and 32-bit int, plus float32. */
export function decodeWav(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  if (b.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new WavError("not a RIFF/WAVE file");

  let format = 0, channels = 0, rate = 0, bits = 0, data = null;
  for (let p = 12; p + 8 <= b.length;) {
    const id = tag(p), size = d.getUint32(p + 4, true);
    if (id === "fmt ") {
      format = d.getUint16(p + 8, true);
      channels = d.getUint16(p + 10, true);
      rate = d.getUint32(p + 12, true);
      bits = d.getUint16(p + 22, true);
    } else if (id === "data") {
      data = b.subarray(p + 8, Math.min(b.length, p + 8 + size));
    }
    p += 8 + size + (size & 1);
  }
  if (!data || !rate || !channels) throw new WavError("missing fmt or data chunk");
  if (format !== 1 && format !== 3 && format !== 0xFFFE) {
    throw new WavError(`unsupported WAV format ${format}; supply PCM or IEEE float`);
  }
  const bytesPer = bits >> 3;
  if (![1, 2, 3, 4].includes(bytesPer)) throw new WavError(`unsupported bit depth ${bits}`);

  const dd = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = Math.floor(data.length / (bytesPer * channels));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const at = (i * channels + c) * bytesPer;
      if (format === 3) acc += bytesPer === 4 ? dd.getFloat32(at, true) : dd.getFloat64(at, true);
      else if (bytesPer === 1) acc += (data[at] - 128) / 128;
      else if (bytesPer === 2) acc += dd.getInt16(at, true) / 32768;
      else if (bytesPer === 3) acc += (((data[at] | (data[at + 1] << 8) | (data[at + 2] << 16)) << 8) >> 8) / 8388608;
      else acc += dd.getInt32(at, true) / 2147483648;
    }
    out[i] = acc / channels;
  }
  return { samples: out, sampleRate: rate, channels, bits, format };
}

// ------------------------------------------------------------------ receiver
/**
 * Streaming burst detector. Push audio at 8 kHz; it correlates against the
 * chirp, and at each candidate start tries the configured frame sizes. The
 * modem's own CRC32C decides whether a size was right.
 */
export class Detector {
  constructor(onFrame, { profiles = PROFILE_NAMES, bufferSeconds = 40 } = {}) {
    this.onFrame = onFrame;
    this.sizes = profiles.map(n => profileOf(n).frameBytes).sort((a, b) => a - b);
    // Measured from the chirp, which is what findPeaks reports.
    this.maxBurst = samplesAfterChirp(Math.max(...this.sizes));
    this.minBurst = samplesAfterChirp(Math.min(...this.sizes));
    this.lookback = Math.max(24000, this.maxBurst + 8000);
    this.buf = new Float64Array(Math.max(FS * bufferSeconds, this.lookback * 2 + FS));
    this.keep = this.lookback + FS;
    this.len = 0;
    this.start = 0;
    this.since = 0;
    this.tried = [];
    this.detected = 0;
    this.decoded = 0;
    this.failed = 0;
    this.preferred = null;     // frame size that worked last; try it first
  }

  push(input) {
    for (let at = 0; at < input.length; at += 2000) {
      const part = input.slice(at, at + 2000);
      if (this.len + part.length > this.buf.length) {
        this.buf.copyWithin(0, this.len - this.keep, this.len);
        this.start += this.len - this.keep;
        this.len = this.keep;
        this.tried = this.tried.filter(p => p > this.start);
      }
      this.buf.set(part, this.len);
      this.len += part.length;
      this.since += part.length;
      if (this.since >= 2000) { this.since %= 2000; this.analyse(); }
    }
  }

  analyse() {
    if (this.len < this.minBurst) return;
    const minSep = Math.floor(this.minBurst * 0.6);
    const from = Math.max(0, this.len - this.lookback);
    const peaks = findPeaks(this.buf, from, this.len, minSep);
    for (const p of peaks) {
      const abs = this.start + p;
      if (this.tried.some(t => Math.abs(t - abs) < 300)) continue;
      // Only give up on a peak once the longest burst it could start has arrived.
      if (p + this.maxBurst > this.len && p + this.minBurst > this.len) continue;
      const order = this.preferred
        ? [this.preferred, ...this.sizes.filter(s => s !== this.preferred)]
        : this.sizes;
      let hit = null;
      for (const size of order) {
        if (p + samplesAfterChirp(size) > this.len) continue;
        const payload = demodulateAt(this.buf, p, size);
        if (payload) { hit = payload; this.preferred = size; break; }
      }
      // A peak whose longest candidate has not fully arrived may still decode later.
      if (!hit && p + this.maxBurst > this.len) continue;
      this.tried.push(abs);
      this.detected++;
      if (hit) { this.decoded++; this.onFrame(hit, { at: abs / FS }); }
      else this.failed++;
    }
  }

  /** Flush anything still in the buffer. Call when the audio ends. */
  finish() { this.analyse(); }
}

/**
 * Full receive path: arbitrary-rate audio in, complete messages out.
 * `verify` is optional; when a signed message arrives it is called with
 * `{keyId, covered, payload, signature, channel}` and must resolve truthy.
 */
export class Receiver {
  constructor({ profiles = PROFILE_NAMES, sampleRate = FS, verify = null, onEvent = () => {} } = {}) {
    this.resampler = sampleRate === FS ? null : new Resampler(sampleRate);
    this.reassembler = new Reassembler();
    this.verify = verify;
    this.onEvent = onEvent;
    this.messages = [];
    this.detector = new Detector((payload, meta) => this.#onFrame(payload, meta), { profiles });
    this.pendingVerifications = new Set();
  }

  get stats() {
    return {
      ...this.reassembler.stats,
      detected: this.detector.detected,
      decoded: this.detector.decoded,
      undecodable: this.detector.failed,
    };
  }

  push(samples) {
    const at8k = this.resampler ? this.resampler.push(samples) : samples;
    if (at8k.length) this.detector.push(at8k);
  }

  async finish() {
    this.detector.finish();
    while (this.pendingVerifications.size) await Promise.all([...this.pendingVerifications]);
    return this.messages;
  }

  #onFrame(payload, meta) {
    const p = parseFrame(payload);
    if (!p) { this.onEvent({ type: "foreign-frame", at: meta.at }); return; }
    this.onEvent({ type: "frame", at: meta.at, channel: p.channel, offset: p.offset, total: p.total, solo: p.solo });
    const msg = this.reassembler.accept(p);
    if (!msg) return;
    if (msg.duplicate) { this.onEvent({ type: "duplicate", at: meta.at, channel: msg.channel }); return; }
    const task = this.#deliver(msg, meta).catch(e => {
      this.onEvent({ type: "error", at: meta.at, message: e.message });
    });
    this.pendingVerifications.add(task);
    task.finally(() => this.pendingVerifications.delete(task));
  }

  async #deliver(msg, meta) {
    const record = { ...msg, at: meta.at, verified: null };
    if (msg.signed) {
      if (!this.verify) {
        this.onEvent({ type: "rejected", at: meta.at, reason: "signed message but no verifier configured" });
        return;
      }
      const { openSigned } = await import("./frame.js");
      const parts = openSigned(msg.body, msg.channel);
      const ok = await this.verify({ ...parts, channel: msg.channel });
      if (!ok) {
        this.onEvent({ type: "rejected", at: meta.at, reason: "signature did not verify" });
        return;
      }
      record.verified = true;
      record.keyId = parts.keyId;
      record.body = parts.payload;
    }
    this.messages.push(record);
    this.onEvent({ type: "message", at: meta.at, message: record });
  }
}

/** One-shot decode of a complete recording. */
export async function decodeAudio(samples, sampleRate, opts = {}) {
  const rx = new Receiver({ ...opts, sampleRate });
  const step = Math.round(sampleRate / 4);
  for (let p = 0; p < samples.length; p += step) {
    rx.push(samples.subarray(p, Math.min(p + step, samples.length)));
  }
  await rx.finish();
  return { messages: rx.messages, stats: rx.stats };
}

export { FS, PROFILES, PROFILE_NAMES, FRAME_SIZES, DEFAULT_PROFILE };
