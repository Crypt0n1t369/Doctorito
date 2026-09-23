import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz'; // no 0/1/l/o

/** Short, URL-safe, unambiguous id. Prefixed so a stray id in a log says what it is. */
export function id(prefix) {
  const b = randomBytes(10);
  let out = '';
  for (const byte of b) out += ALPHABET[byte % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** Contributor magic-link token. Longer, because it is the only credential on that page. */
export function token() {
  const b = randomBytes(18);
  let out = '';
  for (const byte of b) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

/** Stable hash of an object, key order independent. Used for judgment state hashes. */
export function stateHash(obj) {
  return sha256(canonical(obj));
}

export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

export function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
