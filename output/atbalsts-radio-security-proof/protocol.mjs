// Prototype profile. No production keys. Crypto uses HPKE and WebCrypto;
// the small application envelope and acceptance policy are defined here.
import { CipherSuite, HkdfSha256, Aes128Gcm } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import { encode, decode } from 'cborg';

export const utf8 = s => new TextEncoder().encode(s);
export const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
export const fromHex = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
export const concat = (...xs) => {
  const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0));
  let p = 0; for (const x of xs) { out.set(x, p); p += x.length; } return out;
};
const check = (v, m) => { if (!v) throw Error(m); };
const uint = (n, max = 0xffffffff) => Number.isInteger(n) && n >= 0 && n <= max;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const text = (s, max) => typeof s === 'string' && utf8(s).length <= max && !/[\u0000-\u001f\u007f]/u.test(s);
export const suite = () => new CipherSuite({kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm()});
export const INFO = utf8('atbalsts/report/v1');
export const reportInfo = header => concat(INFO, new Uint8Array([0]), header);
export const PUBLIC_AAD = utf8('atbalsts/public/v1');
export const REPORT_BYTES = 314; // header 10 + encapsulation 32 + padded plaintext 256 + tag 16
export const MAX_PUBLIC_BYTES = 1024;
export const kidBytes = n => { check(uint(n), 'key id'); const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n); return a; };

// Strict deterministic CBOR: no indefinite containers, duplicate map keys,
// trailing input, alternate encodings, floats, or tags in application data.
export function unpack(bytes, max = 1024) {
  check(bytes instanceof Uint8Array && bytes.length <= max, 'CBOR size');
  const x = decode(bytes, {useMaps: true, rejectDuplicateMapKeys: true, allowIndefinite: false, allowUndefined: false, allowNaN: false, allowInfinity: false, strict: true});
  check(same(encode(x), bytes), 'noncanonical CBOR'); return x;
}

// [v, observationTime, category, latitudeE5, longitudeE5, shortText]
export function validateReport(r) {
  check(Array.isArray(r) && r.length === 6 && r[0] === 1, 'report schema');
  check(uint(r[1]) && uint(r[2], 3), 'report time/category');
  check(Number.isInteger(r[3]) && Math.abs(r[3]) <= 9000000 && Number.isInteger(r[4]) && Math.abs(r[4]) <= 18000000, 'report location');
  check(text(r[5], 160) && r[5].trim().length > 0, 'report text'); return r;
}
function reportHeader(kid) { return concat(utf8('ATR1'), kidBytes(kid), new Uint8Array([1, 0])); }
export function inspectSealed(bytes) {
  check(bytes instanceof Uint8Array && bytes.length === REPORT_BYTES, 'sealed size');
  check(same(bytes.slice(0, 4), utf8('ATR1')) && bytes[8] === 1 && bytes[9] === 0, 'sealed header');
  return {kid: new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0), header: bytes.slice(0, 10), enc: bytes.slice(10, 42), ct: bytes.slice(42)};
}
export async function sealReport(report, kid, trustedRecipientPublicKey) {
  const body = encode(validateReport(report)); check(body.length <= 254, 'report too large');
  const padded = new Uint8Array(256); new DataView(padded.buffer).setUint16(0, body.length); padded.set(body, 2);
  const header = reportHeader(kid);
  // No deterministic ephemeral override: a new random sender context for EACH report.
  // Single-shot binding via info (RFC 9180 §8.1); AEAD aad is empty.
  const ctx = await suite().createSenderContext({recipientPublicKey: trustedRecipientPublicKey, info: reportInfo(header)});
  const ct = new Uint8Array(await ctx.seal(padded));
  padded.fill(0); // best effort only; JS strings/other copies cannot be guaranteed erased
  return concat(header, new Uint8Array(ctx.enc), ct);
}
export async function openReport(bytes, expectedKid, centrePrivateKey) {
  const p = inspectSealed(bytes); check(p.kid === expectedKid, 'wrong destination');
  const ctx = await suite().createRecipientContext({recipientKey: centrePrivateKey, enc: p.enc, info: reportInfo(p.header)});
  const plain = new Uint8Array(await ctx.open(p.ct));
  check(plain.length === 256, 'padding size');
  const n = new DataView(plain.buffer).getUint16(0); check(n <= 254 && n > 0, 'padding length');
  check(plain.slice(2 + n).every(x => x === 0), 'nonzero padding');
  const r = validateReport(unpack(plain.slice(2, 2 + n), 254)); plain.fill(0); return r;
}
export const objectId = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));

// A bounded gateway queue knows a destination public identifier, not report content.
// Quotas do not prevent a determined sender from consuming the whole allowance.
export class SealedQueue {
  constructor(allowedKids, limit = 20) { this.allowedKids = new Set(allowedKids); this.limit = limit; this.items = new Map(); }
  async accept(bytes) {
    const p = inspectSealed(bytes); check(this.allowedKids.has(p.kid), 'unknown destination');
    const id = await objectId(bytes); if (this.items.has(id)) return {id, status: 'duplicate'};
    check(this.items.size < this.limit, 'queue full'); this.items.set(id, bytes.slice()); return {id, status: 'queued'};
  }
}

// Complete SMALL-area snapshot:
// [v, centre, area, registry, epoch, seq, issued, expires, shelters, situations]
// shelter = [stableID, status (0 unknown..4 closed), availablePlaces|null]
// situation = [stableID, severity 1..3, latitudeE5, longitudeE5, title, instruction]
export function validateSnapshot(x) {
  check(Array.isArray(x) && x.length === 10 && x[0] === 1, 'snapshot schema');
  for (let i = 1; i <= 7; i++) check(uint(x[i]), 'snapshot integer');
  check(x[7] > x[6] && x[7] - x[6] <= 86400, 'validity interval');
  check(Array.isArray(x[8]) && x[8].length <= 32 && Array.isArray(x[9]) && x[9].length <= 4, 'snapshot bounds');
  let last = -1;
  for (const s of x[8]) { check(Array.isArray(s) && s.length === 3 && uint(s[0], 65535) && s[0] > last && uint(s[1], 4) && (s[2] === null || uint(s[2], 65535)), 'shelter row'); last = s[0]; }
  last = -1;
  for (const s of x[9]) {
    check(Array.isArray(s) && s.length === 6 && uint(s[0], 65535) && s[0] > last && uint(s[1], 3) && s[1] > 0, 'situation row');
    check(Number.isInteger(s[2]) && Math.abs(s[2]) <= 9000000 && Number.isInteger(s[3]) && Math.abs(s[3]) <= 18000000 && text(s[4], 64) && text(s[5], 120), 'situation fields'); last = s[0];
  } return x;
}
const signatureInput = (protectedBytes, payload) => encode(['Signature1', protectedBytes, PUBLIC_AAD, payload]);
export async function signSnapshot(snapshot, kid, privateKey) {
  const payload = encode(validateSnapshot(snapshot));
  const protectedBytes = encode(new Map([[1, -8], [4, kidBytes(kid)]])); // COSE EdDSA; this profile requires Ed25519
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, signatureInput(protectedBytes, payload)));
  const bytes = concat(new Uint8Array([0xd2]), encode([protectedBytes, new Map(), payload, sig])); // CBOR tag 18
  check(bytes.length <= MAX_PUBLIC_BYTES, 'snapshot exceeds audio object cap'); return bytes;
}
export async function verifySnapshot(bytes, trust) {
  check(bytes instanceof Uint8Array && bytes.length <= MAX_PUBLIC_BYTES && bytes[0] === 0xd2, 'not a public COSE object');
  const a = unpack(bytes.slice(1));
  check(Array.isArray(a) && a.length === 4 && a[0] instanceof Uint8Array && a[1] instanceof Map && a[1].size === 0 && a[2] instanceof Uint8Array && a[3] instanceof Uint8Array && a[3].length === 64, 'COSE shape');
  const h = unpack(a[0], 32);
  check(h instanceof Map && h.size === 2 && h.get(1) === -8 && h.get(4) instanceof Uint8Array && h.get(4).length === 4, 'COSE protected headers');
  const t = trust.get(hex(h.get(4))); check(t, 'unknown signing key');
  check(await crypto.subtle.verify('Ed25519', t.publicKey, a[3], signatureInput(a[0], a[2])), 'bad signature');
  const x = validateSnapshot(unpack(a[2]));
  check(x[1] === t.centre && x[2] === t.area && x[3] === t.registry && x[4] === t.epoch, 'unauthorized scope/epoch/registry');
  check(same(x[8].map(s => s[0]), t.shelterIds), 'incomplete area shelter coverage');
  return x;
}
export class PublicState {
  constructor(trust) { this.trust = trust; this.snapshots = new Map(); }
  async accept(bytes, now) {
    const x = await verifySnapshot(bytes, this.trust), scope = `${x[1]}/${x[2]}`, old = this.snapshots.get(scope);
    if (old && x[4] === old.data[4] && x[5] < old.data[5]) return {status: 'stale'};
    if (old && x[4] === old.data[4] && x[5] === old.data[5]) {
      check(same(bytes, old.bytes), 'conflicting signed sequence'); return {status: 'duplicate'};
    }
    const freshness = now === undefined || now < x[6] ? 'time-uncertain' : now > x[7] ? 'expired' : 'current-within-validity';
    // Application integration must commit version + original bytes + view atomically.
    this.snapshots.set(scope, {data: x, bytes: bytes.slice(), freshness});
    return {status: 'applied', freshness};
  }
}

// Decryption has NO reference to PublicState or signing keys.
export class CentreInbox {
  constructor(kid, privateKey, limit = 100) { this.kid = kid; this.privateKey = privateKey; this.limit = limit; this.items = new Map(); }
  async receive(bytes) {
    const id = await objectId(bytes); if (this.items.has(id)) return this.items.get(id);
    check(this.items.size < this.limit, 'inbox full');
    const report = await openReport(bytes, this.kid, this.privateKey);
    const item = {id, status: 'unverified', report}; this.items.set(id, item); return item;
  }
}
