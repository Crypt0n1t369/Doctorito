/* Exercise protocol shared by the page and headless tests. No network calls. */
(function (root) {
"use strict";
const M = root.AtbalstsModem, PAYLOAD = 128, DATA = 112;
const PUB = "4a70181580ffc759ee59b93a28d7afa2b6131bf07b8c8f36699cafdc3638f788";
const TE = new TextEncoder(), TD = new TextDecoder("utf-8", { fatal: true });
const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
const unhex = s => Uint8Array.from(s.match(/../g), x => parseInt(x, 16));
function integer(n, max, label) {
  if (!Number.isInteger(n) || n < 0 || n > max) throw Error(label + " out of range");
  return n;
}
function encodeBody(type, rows, seq = 0) {
  integer(type, 3, "Type"); if (!type) throw Error("Unknown record type");
  integer(seq, 255, "Revision"); integer(rows.length, 255, "Record count");
  const b = [1, type, seq, rows.length];
  const put = (v, bytes, label) => {
    integer(v, 2 ** (8 * bytes) - 1, label);
    for (let i = bytes - 1; i >= 0; i--) b.push((v >>> (i * 8)) & 255);
  };
  const str = (s, label) => {
    const v = TE.encode(s); put(v.length, 1, label + " UTF-8 length (max 255 bytes)"); b.push(...v);
  };
  for (const r of rows) {
    put(r.id, 2, "ID");
    if (type === 2) {
      put(integer(r.state, 4, "State"), 1, "State"); put(r.places, 1, "Places");
      put(r.revision, 1, "Revision");
    } else {
      put(integer(type === 1 ? r.kind : r.severity, type === 1 ? 1 : 3, "Kind/severity"), 1, "Kind/severity");
      if (!Number.isFinite(r.lat) || r.lat < 55.5 || r.lat > 90 ||
          !Number.isFinite(r.lon) || r.lon < 20.5 || r.lon > 180) throw Error("Coordinates outside demo range");
      put(Math.round(r.lat * 1e5) - 5550000, 3, "Latitude");
      put(Math.round(r.lon * 1e5) - 2050000, 3, "Longitude");
      if (type === 1) str(r.name, "Name");
      else { str(r.title, "Title"); str(r.text, "Message"); }
    }
  }
  if (b.length + 64 > 1024) throw Error("Object exceeds demo's 1 KB limit");
  return Uint8Array.from(b);
}
function decodeBody(b) {
  let i = 0;
  function take(n) { if (i + n > b.length) throw Error("Truncated record"); const v = b.subarray(i, i + n); i += n; return v; }
  function num(n) { return take(n).reduce((v, x) => v * 256 + x, 0); }
  function str() { return TD.decode(take(num(1))); }
  if (num(1) !== 1) throw Error("Unsupported protocol version");
  const type = num(1), seq = num(1), count = num(1), recs = [];
  if (![1, 2, 3].includes(type) || !count) throw Error("Unknown or empty object");
  for (let n = 0; n < count; n++) {
    const r = { id: num(2) };
    if (type === 2) {
      r.state = integer(num(1), 4, "State"); r.places = num(1); r.revision = num(1);
    } else {
      const kind = integer(num(1), type === 1 ? 1 : 3, "Kind/severity");
      r.lat = (num(3) + 5550000) / 1e5; r.lon = (num(3) + 2050000) / 1e5;
      if (r.lat > 90 || r.lon > 180) throw Error("Invalid coordinates");
      r.revision = seq;
      if (type === 1) { r.kind = kind; r.name = str(); }
      else { r.severity = kind; r.title = str(); r.text = str(); }
    }
    recs.push(r);
  }
  if (i !== b.length) throw Error("Trailing record bytes");
  return { type, seq, recs };
}
async function keys(provider = root.crypto) {
  if (!provider?.subtle) throw Error("WebCrypto unavailable; open in a secure browser context");
  const subtle = provider.subtle;
  const verify = await subtle.importKey("raw", unhex(PUB), "Ed25519", false, ["verify"]);
  // Intentionally PUBLIC exercise key, matching the existing Python fixtures.
  const seed = new Uint8Array(await subtle.digest("SHA-256", TE.encode("atbalsts-radio-public-exercise-key-v1")));
  const pkcs8 = new Uint8Array(48); pkcs8.set(unhex("302e020100300506032b657004220420")); pkcs8.set(seed, 16);
  const sign = await subtle.importKey("pkcs8", pkcs8, "Ed25519", false, ["sign"]);
  return { subtle, verify, sign };
}
async function signBody(body, k) {
  decodeBody(body);
  const out = new Uint8Array(body.length + 64); out.set(body);
  out.set(new Uint8Array(await k.subtle.sign("Ed25519", k.sign, body)), body.length); return out;
}
function fragment(obj, bulletin, object, issuer = 1) {
  integer(bulletin, 0xffffffff, "Bulletin"); integer(object, 65535, "Object"); integer(issuer, 65535, "Issuer");
  if (obj.length < 68 || obj.length > 1024) throw Error("Invalid object size");
  const out = [];
  for (let offset = 0; offset < obj.length; offset += DATA) {
    const f = new Uint8Array(PAYLOAD), d = new DataView(f.buffer), chunk = obj.subarray(offset, offset + DATA);
    d.setUint16(0, issuer); d.setUint32(2, bulletin); d.setUint16(6, object);
    d.setUint16(8, offset); d.setUint16(10, obj.length); f.set(chunk, 16);
    const check = new Uint8Array(12 + chunk.length); check.set(f.subarray(0, 12)); check.set(chunk, 12);
    d.setUint32(12, M.crc32c(check)); out.push(f);
  }
  return out;
}
function parseFrame(f) {
  if (!f || f.length !== PAYLOAD) return null;
  const d = new DataView(f.buffer, f.byteOffset, f.byteLength);
  const issuer = d.getUint16(0), bulletin = d.getUint32(2), object = d.getUint16(6);
  const offset = d.getUint16(8), total = d.getUint16(10);
  if (total < 68 || total > 1024 || offset >= total || offset % DATA) return null;
  const chunk = f.slice(16, 16 + Math.min(DATA, total - offset));
  const check = new Uint8Array(12 + chunk.length); check.set(f.subarray(0, 12)); check.set(chunk, 12);
  if (M.crc32c(check) !== d.getUint32(12)) return null;
  return { issuer, bulletin, object, offset, total, chunk, key: `${issuer}/${bulletin}/${object}` };
}
class State {
  /* The registry is PREINSTALLED. Radio never carries a name, an address or a
     coordinate for a known facility -- only id, state, free places, revision:
     five bytes. That is the whole bandwidth argument, so it is enforced here
     rather than left as a convention. */
  constructor(registry = []) {
    this.registry = new Map();
    this.sites = new Map();
    this.situations = new Map();
    this.seed(registry);
  }
  seed(rows) {
    for (const r of rows) {
      const [id, lat, lon, cat, name, locality, municipality] = r;
      const base = { id, lat: lat / 1e5, lon: lon / 1e5, cat, name, locality,
                     municipality, kind: 0, state: 0, places: 0, revision: 0,
                     preinstalled: true };
      this.registry.set(id, base);
      this.sites.set(id, { ...base });
    }
  }
  apply(d) {
    const changed = [];
    for (const r of d.recs) {
      if (d.type === 3) {
        const old = this.situations.get(r.id);
        if (!old || r.revision > old.revision) { this.situations.set(r.id, { ...r }); changed.push(r.id); }
        continue;
      }
      const old = this.sites.get(r.id) ||
        { id: r.id, state: 0, places: 0, revision: 0, preinstalled: false, kind: 0 };
      if (d.type === 1 && (!old.name || r.revision > (old.registryRevision ?? -1))) {
        const { revision, ...fields } = r;
        this.sites.set(r.id, { ...old, ...fields, registryRevision: revision }); changed.push(r.id);
      } else if (d.type === 2 && r.revision > old.revision) {
        this.sites.set(r.id, { ...old, ...r }); changed.push(r.id);
      }
    }
    return changed;
  }
  /* Only what the radio actually delivered is persisted; the registry is
     rebuilt from the bundled file on load. */
  snapshot() {
    const status = [];
    for (const s of this.sites.values()) {
      if (s.revision > 0) status.push([s.id, s.state, s.places, s.revision]);
      else if (!s.preinstalled && s.name)
        status.push([s.id, s.state, s.places, s.revision, s.name, s.lat, s.lon,
                     s.kind, s.registryRevision || 0]);
    }
    return { status, situations: [...this.situations.values()] };
  }
  restore(data) {
    for (const row of data.status || []) {
      const [id, state, places, revision, name, lat, lon, kind, rrev] = row;
      if (name !== undefined)
        this.apply(decodeBody(encodeBody(1, [{ id, lat, lon, name, kind }], rrev || 0)));
      if (revision > 0)
        this.apply(decodeBody(encodeBody(2, [{ id, state, places, revision }])));
    }
    for (const r of data.situations || [])
      this.apply(decodeBody(encodeBody(3, [r], r.revision || 0)));
  }
  clear() {
    this.sites.clear(); this.situations.clear();
    for (const [id, base] of this.registry) this.sites.set(id, { ...base });
  }
}
class Receiver {
  constructor(k, state = new State(), event = () => {}) {
    this.keys = k; this.state = state; this.event = event; this.generation = 0;
    this.assembly = new Map(); this.seen = new Set(); this.resetStats();
  }
  resetStats() { this.stats = { frames: 0, bad: 0, objects: 0, bytes: 0, changes: 0 }; }
  clear() { this.generation++; this.assembly.clear(); this.seen.clear(); this.state.clear(); this.resetStats(); }
  async accept(payload) {
    const p = parseFrame(payload), stats = this.stats, generation = this.generation;
    if (!p) { stats.bad++; this.event({ kind: "bad-frame" }); return; }
    stats.frames++; this.event({ kind: "frame", frame: p });
    let a = this.assembly.get(p.key);
    if (a && a.total !== p.total) { this.event({ kind: "error", message: "Conflicting object length" }); return; }
    if (!a) {
      if (this.assembly.size >= 64) this.assembly.delete(this.assembly.keys().next().value);
      a = { total: p.total, bytes: new Uint8Array(p.total), seen: new Set(), done: false, pending: false };
      this.assembly.set(p.key, a);
    }
    if (a.done || a.pending) return;
    a.bytes.set(p.chunk, p.offset); a.seen.add(p.offset);
    if (a.seen.size !== Math.ceil(p.total / DATA)) return;
    a.pending = true;
    try {
      if (!this.keys) throw Error("Signature verification unavailable; object rejected");
      const body = a.bytes.slice(0, -64), signature = a.bytes.slice(-64);
      if (!await this.keys.subtle.verify("Ed25519", this.keys.verify, signature, body)) throw Error("Invalid signature; object rejected");
      const decoded = decodeBody(body);
      if (generation !== this.generation) return;
      const fingerprint = hex(signature);
      a.done = true;
      if (this.seen.has(fingerprint)) return;
      if (this.seen.size >= 512) this.seen.delete(this.seen.values().next().value);
      this.seen.add(fingerprint);
      const changed = this.state.apply(decoded);
      stats.objects++; stats.bytes += body.length; stats.changes += changed.length;
      this.event({ kind: "object", frame: p, body, decoded, changed });
    } catch (e) {
      // A later repetition may supply correct bytes; do not mark a failed object done.
      a.seen.clear(); this.event({ kind: "error", message: e.message });
    } finally { a.pending = false; }
  }
}
// The actual page and tests use this same streaming detector, with quarter-second work units.
class Stream {
  constructor(onPayload) {
    this.onPayload = onPayload; this.buf = new Float64Array(8000 * 30);
    this.len = 0; this.start = 0; this.since = 0; this.tried = []; this.pending = new Set();
    this.detected = 0;   // preambles found, whether or not they decoded
  }
  push(input) {
    for (let at = 0; at < input.length; at += 2000) {
      const part = input.slice(at, at + 2000);
      if (this.len + part.length > this.buf.length) {
        const keep = 120000; this.buf.copyWithin(0, this.len - keep, this.len);
        this.start += this.len - keep; this.len = keep; this.tried = this.tried.filter(p => p > this.start);
      }
      this.buf.set(part, this.len); this.len += part.length; this.since += part.length;
      if (this.since >= 2000) { this.since %= 2000; this.analyse(); }
    }
  }
  analyse() {
    const burst = M.burstSamples(PAYLOAD);
    if (this.len < burst) return;
    const peaks = M.findPeaks(this.buf, Math.max(0, this.len - 24000), this.len, Math.floor(burst * .6));
    for (const p of peaks) {
      const abs = this.start + p;
      if (p + burst > this.len || this.tried.some(t => Math.abs(t - abs) < 300)) continue;
      this.tried.push(abs); this.detected++;
      const result = Promise.resolve(this.onPayload(M.demodulateAt(this.buf, p, PAYLOAD)));
      this.pending.add(result); result.finally(() => this.pending.delete(result));
    }
  }
  async finish() { this.analyse(); await Promise.all([...this.pending]); }
}
root.AtbalstsProtocol = { PAYLOAD, DATA, PUB, hex, keys, encodeBody, decodeBody, signBody, fragment, parseFrame, State, Receiver, Stream };
})(globalThis);
