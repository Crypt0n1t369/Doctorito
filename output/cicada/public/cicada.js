/* Cicada browser SDK.
 *
 *   import { listen, transmit } from "/cicada.js";
 *
 *   const rx = await listen({ onMessage: m => console.log(m.text) });
 *   await transmit({ text: "hello", profile: "robust" });
 *
 * Receiving is entirely local: the microphone audio never leaves the page and
 * no key is needed. That is deliberate — decoding costs us nothing, so it is
 * free, and a free receiver is what makes a transmitter worth paying for.
 */

import { FS, Resampler } from "/sdk/core.js";
import {
  fragment, parseFrame, Reassembler, openSigned, readCardBody,
  PROFILES, PROFILE_NAMES, DEFAULT_PROFILE, capacityPerFrame, profileOf,
  SIGNED_OVERHEAD, MAX_MESSAGE,
} from "/sdk/frame.js";
import { render, encodeWav, decodeWav, Detector, estimate, compareProfiles } from "/sdk/audio.js";

export {
  FS, PROFILES, PROFILE_NAMES, DEFAULT_PROFILE, SIGNED_OVERHEAD, MAX_MESSAGE,
  estimate, compareProfiles, capacityPerFrame, profileOf, encodeWav, decodeWav, render, fragment,
};

const te = new TextEncoder();

/** Why the microphone is unavailable, in terms a developer can act on. */
export function micAvailability() {
  if (typeof navigator === "undefined") return { ok: false, reason: "not-a-browser" };
  if (!window.isSecureContext) {
    return {
      ok: false,
      reason: "insecure-context",
      message: "Browsers only grant microphone access in a secure context. "
        + "Use https, or http://localhost — a LAN IP and a file:// page are both refused.",
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "unsupported", message: "This browser has no getUserMedia." };
  }
  return { ok: true };
}

/**
 * Start listening on the microphone.
 *
 * `verify` is called for each signed message with {keyId, channel, covered,
 * signature}; return true to accept. `trust` is a shorthand: a map of
 * "channel/keyId" to a 32-byte hex Ed25519 public key.
 */
export async function listen({
  onMessage = () => {},
  onEvent = () => {},
  onLevel = null,
  verify = null,
  trust = null,
  profiles = PROFILE_NAMES,
  cards = null,
  resolveAnnouncement = null,
  deviceId = null,
} = {}) {
  const avail = micAvailability();
  if (!avail.ok) throw Object.assign(new Error(avail.message || avail.reason), avail);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      // The modem lives in a band these would chew on.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const session = new ReceiveSession({
    onMessage, onEvent, onLevel, verify, trust, profiles, cards, resolveAnnouncement,
    sampleRate: ctx.sampleRate,
  });

  let node;
  try {
    await ctx.audioWorklet.addModule("/cicada-capture.js");
    node = new AudioWorkletNode(ctx, "cicada-capture", { numberOfOutputs: 0 });
    node.port.onmessage = e => session.push(e.data);
  } catch {
    // Older browsers, and any context where the worklet module cannot load.
    node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = e => session.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    node.connect(ctx.destination);
  }
  source.connect(node);

  session.stop = async () => {
    try { source.disconnect(); node.disconnect?.(); } catch { /* already torn down */ }
    for (const t of stream.getTracks()) t.stop();
    await ctx.close();
    session.running = false;
  };
  session.running = true;
  session.inputSampleRate = ctx.sampleRate;
  session.deviceLabel = stream.getAudioTracks()[0]?.label || "";
  return session;
}

/** Decode an already-captured buffer: a WAV file, or raw samples. */
export async function decode(input, { sampleRate = FS, ...opts } = {}) {
  let samples = input, rate = sampleRate;
  if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
    const wav = decodeWav(input instanceof Uint8Array ? input : new Uint8Array(input));
    samples = wav.samples;
    rate = wav.sampleRate;
  }
  const out = [];
  const session = new ReceiveSession({ ...opts, sampleRate: rate, onMessage: m => out.push(m) });
  const step = Math.round(rate / 4);
  for (let p = 0; p < samples.length; p += step) session.push(samples.subarray(p, p + step));
  await session.flush();
  return { messages: out, stats: session.stats };
}

/** Receives on a stream of samples. Shared by the microphone and file paths. */
export class ReceiveSession {
  constructor({
    onMessage, onEvent = () => {}, onLevel = null, verify = null, trust = null,
    profiles = PROFILE_NAMES, cards = null, sampleRate = FS, resolveAnnouncement = null,
  }) {
    this.resolveAnnouncement = resolveAnnouncement;
    this.onMessage = onMessage;
    this.onEvent = onEvent;
    this.onLevel = onLevel;
    this.verify = verify;
    this.trust = trust ? normaliseTrust(trust) : null;
    this.cards = cards ? new Map(Object.entries(cards).map(([k, v]) => [Number(k), v])) : null;
    this.resampler = sampleRate === FS ? null : new Resampler(sampleRate);
    this.reassembler = new Reassembler();
    this.detector = new Detector((f, meta) => this.#frame(f, meta), { profiles });
    this.pending = new Set();
    this.startedAt = performance.now();
  }

  get stats() {
    return {
      ...this.reassembler.stats,
      detected: this.detector.detected,
      decoded: this.detector.decoded,
      undecodable: this.detector.failed,
      seconds: (performance.now() - this.startedAt) / 1000,
    };
  }

  push(samples) {
    if (this.onLevel) {
      let peak = 0, sum = 0;
      for (const v of samples) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
      this.onLevel({ peak, rms: Math.sqrt(sum / Math.max(1, samples.length)) });
    }
    const at8k = this.resampler ? this.resampler.push(samples) : samples;
    if (at8k.length) this.detector.push(at8k);
  }

  async flush() {
    this.detector.finish();
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  #frame(payload, meta) {
    const p = parseFrame(payload);
    if (!p) { this.onEvent({ type: "foreign-frame", at: meta.at }); return; }
    this.onEvent({ type: "frame", at: meta.at, channel: p.channel, offset: p.offset, total: p.total, solo: p.solo });
    const msg = this.reassembler.accept(p);
    if (!msg) return;
    if (msg.duplicate) { this.onEvent({ type: "duplicate", at: meta.at, channel: msg.channel }); return; }
    const task = this.#deliver(msg, meta).catch(e => this.onEvent({ type: "error", message: e.message }));
    this.pending.add(task);
    task.finally(() => this.pending.delete(task));
  }

  async #deliver(msg, meta) {
    const out = {
      channel: msg.channel, at: meta.at, signed: msg.signed, card: null,
      announce: msg.announce, announcement: null,
      verified: null, keyId: null, bytes: msg.body, text: null,
    };
    let body = msg.body;

    if (msg.signed) {
      const parts = openSigned(body, msg.channel);
      out.keyId = parts.keyId;
      let ok = false;
      if (this.verify) ok = await this.verify({ ...parts, channel: msg.channel });
      else if (this.trust) ok = await verifyAgainstTrust(this.trust, msg.channel, parts);
      else {
        this.onEvent({ type: "rejected", at: meta.at, reason: "signed message, but no trusted key configured" });
        return;
      }
      if (!ok) { this.onEvent({ type: "rejected", at: meta.at, reason: "signature did not verify" }); return; }
      out.verified = true;
      body = parts.payload;
      out.bytes = body;
    }

    if (msg.card) {
      const code = readCardBody(body);
      out.card = { code, resolved: this.cards?.get(code) ?? null };
    } else if (msg.announce) {
      out.announcement = this.resolveAnnouncement?.(body) ?? null;
    } else {
      out.text = utf8OrNull(body);
    }
    this.onMessage(out);
    this.onEvent({ type: "message", at: meta.at, message: out });
  }
}

function normaliseTrust(trust) {
  // Accept {"1/2": "hex"} or [{channel, key_id, public_key}]
  const map = new Map();
  if (Array.isArray(trust)) {
    for (const k of trust) map.set(`${k.channel}/${k.key_id ?? k.keyId}`, k.public_key ?? k.publicKey);
  } else {
    for (const [k, v] of Object.entries(trust)) map.set(k, v);
  }
  return map;
}

const keyCache = new Map();
async function verifyAgainstTrust(trust, channel, parts) {
  const hex = trust.get(`${channel}/${parts.keyId}`);
  if (!hex) return false;
  let key = keyCache.get(hex);
  if (!key) {
    const raw = Uint8Array.from(hex.match(/../g), b => parseInt(b, 16));
    if (raw.length !== 32) return false;
    try {
      key = await crypto.subtle.importKey("raw", raw, "Ed25519", false, ["verify"]);
    } catch {
      return false;   // Ed25519 unsupported in this browser
    }
    keyCache.set(hex, key);
  }
  return crypto.subtle.verify("Ed25519", key, parts.signature, parts.covered);
}

function utf8OrNull(bytes) {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[ --]/.test(s) ? null : s;
  } catch { return null; }
}

// ------------------------------------------------------------------ transmit
/** Encode a payload to 8 kHz samples without playing it. */
export function encode({ text, data, json, bytes, profile = DEFAULT_PROFILE, channel = 0, repeats = 2 } = {}) {
  const body = bytes ?? (
    text !== undefined ? te.encode(text)
      : json !== undefined ? te.encode(JSON.stringify(json))
        : data instanceof Uint8Array ? data
          : null);
  if (!body) throw new Error("Supply one of text, json, data or bytes");
  const frames = fragment(body, { profile, channel });
  return { samples: render(frames, { repeats }), frames: frames.length, bodyBytes: body.length };
}

/** Encode and play through the speakers. Resolves when playback finishes. */
export async function transmit(opts = {}) {
  const { samples, frames, bodyBytes } = encode(opts);
  await play(samples, opts);
  return { frames, bodyBytes, seconds: samples.length / FS };
}

let sharedCtx = null;
/** Play 8 kHz modem samples. The browser resamples to the output device rate. */
export function play(samples, { volume = 0.9, onEnded = null } = {}) {
  sharedCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  const ctx = sharedCtx;
  return ctx.resume().then(() => new Promise(resolve => {
    const buffer = ctx.createBuffer(1, samples.length, FS);
    buffer.copyToChannel(Float32Array.from(samples), 0);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.buffer = buffer;
    src.connect(gain).connect(ctx.destination);
    src.onended = () => { onEnded?.(); resolve(); };
    src.start();
  }));
}

/** Download rendered samples as a WAV file. */
export function downloadWav(samples, filename = "cicada.wav") {
  const blob = new Blob([encodeWav(samples)], { type: "audio/wav" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ------------------------------------------------------------------- client
/** Thin wrapper over the REST API, for pages that talk to a Cicada server. */
export class CicadaClient {
  constructor({ key, origin = "" } = {}) {
    this.key = key;
    this.origin = origin.replace(/\/$/, "");
  }
  async request(path, { method = "GET", body, raw, headers = {}, token } = {}) {
    const res = await fetch(`${this.origin}${path}`, {
      method,
      headers: {
        ...(token || this.key ? { authorization: `Bearer ${token ?? this.key}` } : {}),
        ...(body && !raw ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const type = res.headers.get("content-type") || "";
    const payload = type.includes("json") ? await res.json() : await res.arrayBuffer();
    if (!res.ok) {
      const message = payload?.error?.message || `${res.status} ${res.statusText}`;
      throw Object.assign(new Error(message), { status: res.status, detail: payload?.error });
    }
    return payload;
  }
  health() { return this.request("/v1/health"); }
  profiles() { return this.request("/v1/profiles"); }
  conditions() { return this.request("/v1/conditions"); }
  plans() { return this.request("/v1/plans"); }
  capacity(q) { return this.request(`/v1/capacity?${new URLSearchParams(q)}`); }
  usage() { return this.request("/v1/usage"); }
  listChannels() { return this.request("/v1/channels"); }
  createChannel(body) { return this.request("/v1/channels", { method: "POST", body }); }
  rotateChannel(id) { return this.request(`/v1/channels/${id}/rotate`, { method: "POST" }); }
  deleteChannel(id) { return this.request(`/v1/channels/${id}`, { method: "DELETE" }); }
  trust(id, token) { return this.request(`/v1/channels/${id}/trust`, { token }); }
  listCards(id) { return this.request(`/v1/channels/${id}/cards`); }
  createCard(id, body) { return this.request(`/v1/channels/${id}/cards`, { method: "POST", body }); }
  deleteCard(id, code) { return this.request(`/v1/channels/${id}/cards/${code}`, { method: "DELETE" }); }
  cardBundle(id, token) { return this.request(`/v1/channels/${id}/cards/bundle`, { token }); }
  listTransmissions(limit = 50) { return this.request(`/v1/transmissions?limit=${limit}`); }
  createTransmission(body) { return this.request("/v1/transmissions", { method: "POST", body }); }
  deleteTransmission(id) { return this.request(`/v1/transmissions/${id}`, { method: "DELETE" }); }
  async audio(id) {
    const buf = await this.request(`/v1/transmissions/${id}/audio.wav`);
    return decodeWav(new Uint8Array(buf));
  }
  simulate(body) { return this.request("/v1/simulate", { method: "POST", body }); }
  decodeAudio(wavBytes) {
    return this.request("/v1/decode", {
      method: "POST", raw: wavBytes, headers: { "content-type": "audio/wav" },
    });
  }
  listReceipts(q = {}) { return this.request(`/v1/receipts?${new URLSearchParams(q)}`); }
  postReceipt(token, body) { return this.request("/v1/receipts", { method: "POST", token, body }); }
  listKeys() { return this.request("/v1/keys"); }
  createKey(label) { return this.request("/v1/keys", { method: "POST", body: { label } }); }
  revokeKey(id) { return this.request(`/v1/keys/${id}`, { method: "DELETE" }); }
}
