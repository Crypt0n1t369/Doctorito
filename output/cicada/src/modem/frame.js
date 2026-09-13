/* Cicada transport framing.
 *
 * The modem already appends and checks CRC32C over every burst, so a frame that
 * reaches this layer is intact — framing only has to say which message a frame
 * belongs to and where in it the bytes go.
 *
 * Two header forms. A message that fits in a single frame uses the 5-byte solo
 * header; anything longer uses the 12-byte multi-frame header. Frame sizes are
 * fixed per profile because the receiver must know a burst's length before it
 * can demodulate it.
 */

export const VERSION = 1;

/** Frame sizes, chosen so a receiver only has to try four burst lengths. */
export const PROFILES = {
  micro:    { id: 0, frameBytes: 16,  label: "Micro",    note: "card references and short tokens", soloOnly: true },
  robust:   { id: 1, frameBytes: 64,  label: "Robust",   note: "noisiest rooms, most resync points" },
  standard: { id: 2, frameBytes: 128, label: "Standard", note: "the default balance" },
  fast:     { id: 3, frameBytes: 512, label: "Fast",     note: "quiet paths, highest throughput" },
};
export const PROFILE_NAMES = Object.keys(PROFILES);
export const FRAME_SIZES = PROFILE_NAMES.map(n => PROFILES[n].frameBytes);
export const DEFAULT_PROFILE = "standard";

export const SOLO_HEADER = 5;
export const MULTI_HEADER = 12;

export const FLAG_SIGNED = 0x01;
export const FLAG_SOLO   = 0x02;
export const FLAG_CARD   = 0x04;
export const FLAG_ANNOUNCE = 0x08;

export const SIG_BYTES = 64;
export const KEYID_BYTES = 4;
export const CHANNEL_BYTES = 2;
/** Overhead a signature adds to the message body. */
export const SIGNED_OVERHEAD = SIG_BYTES + KEYID_BYTES;

/** Largest message this transport addresses; offsets and lengths are u16. */
export const MAX_MESSAGE = 65535;

export function profileOf(name) {
  const p = PROFILES[name];
  if (!p) throw new CicadaFrameError(`Unknown profile "${name}". Use one of: ${PROFILE_NAMES.join(", ")}`);
  return p;
}

/**
 * Base for every "the caller sent something we cannot use" error across the
 * modem and the announcement layer. Carrying the status here means the HTTP
 * layer never has to know the subclasses by name.
 */
export class BadInputError extends Error {
  constructor(message, name = "BadInputError") {
    super(message);
    this.name = name;
    this.status = 400;
  }
}

export class CicadaFrameError extends BadInputError {
  constructor(message) { super(message, "CicadaFrameError"); }
}

/** Payload bytes a single frame of this profile carries. */
export function capacityPerFrame(profileName, solo) {
  const p = profileOf(profileName);
  if (!solo && p.soloOnly) return 0;
  return p.frameBytes - (solo ? SOLO_HEADER : MULTI_HEADER);
}

/** How many frames a message of `length` bytes needs on this profile. */
export function frameCount(profileName, length) {
  const solo = capacityPerFrame(profileName, true);
  if (length <= solo) return 1;
  const per = capacityPerFrame(profileName, false);
  if (per <= 0) throw new CicadaFrameError(`Profile "${profileName}" cannot carry multi-frame messages`);
  return Math.ceil(length / per);
}

/**
 * Split a message body into frames.
 * `body` is the already-assembled message (signature included, if any).
 */
export function fragment(body, { profile = DEFAULT_PROFILE, channel = 0, messageId, signed = false, card = false, announce = false } = {}) {
  if (!(body instanceof Uint8Array)) throw new CicadaFrameError("body must be a Uint8Array");
  if (body.length === 0) throw new CicadaFrameError("body is empty");
  if (body.length > MAX_MESSAGE) throw new CicadaFrameError(`body is ${body.length} bytes; the limit is ${MAX_MESSAGE}`);
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xffff) throw new CicadaFrameError("channel must be a uint16");

  const { frameBytes } = profileOf(profile);
  const soloCap = capacityPerFrame(profile, true);
  let flags = (signed ? FLAG_SIGNED : 0) | (card ? FLAG_CARD : 0) | (announce ? FLAG_ANNOUNCE : 0);

  if (body.length <= soloCap) {
    const f = new Uint8Array(frameBytes);
    const d = new DataView(f.buffer);
    f[0] = VERSION;
    f[1] = flags | FLAG_SOLO;
    d.setUint16(2, channel);
    f[4] = body.length;
    f.set(body, SOLO_HEADER);
    return [f];
  }

  const per = capacityPerFrame(profile, false);
  if (per <= 0) {
    throw new CicadaFrameError(
      `Profile "${profile}" holds at most ${soloCap} bytes; this message is ${body.length}. Use a larger profile or a card reference.`);
  }
  const id = Number.isInteger(messageId) ? messageId >>> 0 : (Math.random() * 0x100000000) >>> 0;
  const out = [];
  for (let offset = 0; offset < body.length; offset += per) {
    const f = new Uint8Array(frameBytes);
    const d = new DataView(f.buffer);
    const chunk = body.subarray(offset, offset + per);
    f[0] = VERSION;
    f[1] = flags;
    d.setUint16(2, channel);
    d.setUint32(4, id);
    d.setUint16(8, offset);
    d.setUint16(10, body.length);
    f.set(chunk, MULTI_HEADER);
    out.push(f);
  }
  return out;
}

/** Parse one demodulated frame. Returns null if the header is not valid Cicada. */
export function parseFrame(f) {
  if (!f || f.length < SOLO_HEADER) return null;
  if (f[0] !== VERSION) return null;
  const flags = f[1];
  if (flags & 0xf0) return null;                 // reserved bits must be clear
  const d = new DataView(f.buffer, f.byteOffset, f.byteLength);
  const channel = d.getUint16(2);
  const signed = !!(flags & FLAG_SIGNED);
  const card = !!(flags & FLAG_CARD);
  const announce = !!(flags & FLAG_ANNOUNCE);

  if (flags & FLAG_SOLO) {
    const len = f[4];
    if (len === 0 || SOLO_HEADER + len > f.length) return null;
    return {
      solo: true, channel, signed, card, announce,
      messageId: null, offset: 0, total: len,
      chunk: f.slice(SOLO_HEADER, SOLO_HEADER + len),
      frameBytes: f.length,
    };
  }

  if (f.length < MULTI_HEADER + 1) return null;
  const messageId = d.getUint32(4);
  const offset = d.getUint16(8);
  const total = d.getUint16(10);
  const per = f.length - MULTI_HEADER;
  if (total === 0 || offset >= total || offset % per !== 0) return null;
  const take = Math.min(per, total - offset);
  return {
    solo: false, channel, signed, card, announce,
    messageId, offset, total,
    chunk: f.slice(MULTI_HEADER, MULTI_HEADER + take),
    frameBytes: f.length,
  };
}

/**
 * Reassembles frames into messages. Holds partial messages until every
 * fragment has arrived, then emits once. Repeats of an already-emitted message
 * are reported as duplicates rather than re-emitted.
 */
export class Reassembler {
  constructor({ maxPending = 32, maxSeen = 256 } = {}) {
    this.maxPending = maxPending;
    this.maxSeen = maxSeen;
    this.pending = new Map();
    this.seen = new Set();
    this.stats = { frames: 0, messages: 0, duplicates: 0, conflicts: 0 };
  }

  reset() {
    this.pending.clear();
    this.seen.clear();
    this.stats = { frames: 0, messages: 0, duplicates: 0, conflicts: 0 };
  }

  /**
   * Feed one parsed frame. Returns a message object when one completes,
   * `{duplicate:true}` for a repeat, or null while still waiting.
   */
  accept(p) {
    if (!p) return null;
    this.stats.frames++;

    if (p.solo) return this.#emit(p.chunk, p);

    const key = `${p.channel}/${p.messageId}/${p.total}`;
    let a = this.pending.get(key);
    if (a && a.total !== p.total) { this.stats.conflicts++; return null; }
    if (!a) {
      if (this.pending.size >= this.maxPending) this.pending.delete(this.pending.keys().next().value);
      a = { total: p.total, bytes: new Uint8Array(p.total), have: new Set() };
      this.pending.set(key, a);
    }
    a.bytes.set(p.chunk, p.offset);
    a.have.add(p.offset);

    const per = p.frameBytes - MULTI_HEADER;
    if (a.have.size < Math.ceil(p.total / per)) return null;
    this.pending.delete(key);
    return this.#emit(a.bytes, p);
  }

  /** Fragments received for a message that has not completed yet. */
  progress() {
    const out = [];
    for (const [key, a] of this.pending) out.push({ key, total: a.total, have: a.have.size });
    return out;
  }

  #emit(body, p) {
    const fp = `${p.channel}:${fingerprint(body)}`;
    if (this.seen.has(fp)) { this.stats.duplicates++; return { duplicate: true, channel: p.channel }; }
    if (this.seen.size >= this.maxSeen) this.seen.delete(this.seen.values().next().value);
    this.seen.add(fp);
    this.stats.messages++;
    return {
      duplicate: false,
      channel: p.channel,
      signed: p.signed,
      card: p.card,
      announce: p.announce,
      solo: p.solo,
      messageId: p.messageId,
      body,
    };
  }
}

/** FNV-1a over the body — a cheap duplicate key, not a security hash. */
function fingerprint(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length}:${h.toString(16)}`;
}

// ------------------------------------------------------------ signed message
/**
 * The bytes a signature covers: channel(2) || keyId(4) || payload.
 *
 * The channel number is prefixed here but is NOT carried in the message body —
 * it already travels in every frame header, so signing it costs nothing on the
 * air. Binding it matters because without it a signature is valid for its bytes
 * on any channel, and the only thing stopping a relay onto a different channel
 * would be the trust table happening to hold a different key there. That is a
 * policy holding the line where a construction should.
 */
function signingInput(channel, keyId, payload) {
  const head = new Uint8Array(CHANNEL_BYTES + KEYID_BYTES);
  const d = new DataView(head.buffer);
  d.setUint16(0, channel);
  d.setUint32(CHANNEL_BYTES, keyId);
  return concat(head, payload);
}

/** Build a signed message body: keyId(4) || payload || signature(64). */
export async function buildSigned(payload, keyId, sign, channel = 0) {
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > 0xffffffff) {
    throw new CicadaFrameError("keyId must be a uint32");
  }
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xffff) {
    throw new CicadaFrameError("channel must be a uint16");
  }
  const sig = await sign(signingInput(channel, keyId, payload));
  if (sig.length !== SIG_BYTES) throw new CicadaFrameError(`signature must be ${SIG_BYTES} bytes`);
  const head = new Uint8Array(KEYID_BYTES);
  new DataView(head.buffer).setUint32(0, keyId);
  return concat(head, payload, sig);
}

/**
 * Split a signed message body back into its parts.
 *
 * `channel` comes from the frame header, not the body, and must be supplied:
 * `covered` is only meaningful for the channel the frame actually arrived on.
 */
export function openSigned(body, channel = 0) {
  if (body.length < KEYID_BYTES + SIG_BYTES + 1) {
    throw new CicadaFrameError("signed message is too short to contain a key id, payload and signature");
  }
  const keyId = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
  const payload = body.subarray(KEYID_BYTES, body.length - SIG_BYTES);
  return {
    keyId,
    channel,
    covered: signingInput(channel, keyId, payload),
    payload,
    signature: body.subarray(body.length - SIG_BYTES),
  };
}

export function concat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Encode a card reference body: a 4-byte code the receiver resolves locally. */
export function cardBody(code) {
  if (!Number.isInteger(code) || code < 0 || code > 0xffffffff) {
    throw new CicadaFrameError("card code must be a uint32");
  }
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, code);
  return b;
}

export function readCardBody(body) {
  if (body.length !== 4) throw new CicadaFrameError("a card reference body must be exactly 4 bytes");
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0);
}
