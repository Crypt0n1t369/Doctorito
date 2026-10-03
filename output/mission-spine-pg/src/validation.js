import { createHash, randomBytes } from 'node:crypto';
import { invariant } from './errors.js';

export function nonempty(value, name, max = 2000) {
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    'invalid_input', `${name} must be nonempty and at most ${max} characters`);
  return value.trim();
}

export function identifier(value, name) {
  invariant(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(value),
    'invalid_input', `${name} is invalid`);
  return value;
}

export function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  invariant(Number.isSafeInteger(value) && value >= min && value <= max,
    'invalid_input', `${name} must be an integer between ${min} and ${max}`);
  return value;
}

export function enumValue(value, name, choices) {
  invariant(choices.includes(value), 'invalid_input', `${name} must be one of ${choices.join(', ')}`);
  return value;
}

export function stringArray(value, name, limit = 20) {
  invariant(Array.isArray(value) && value.length <= limit, 'invalid_input', `${name} must be an array of at most ${limit}`);
  return value.map((item, index) => identifier(item, `${name}[${index}]`));
}

export function receiptToken(value) {
  invariant(typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value),
    'invalid_input', 'receipt token must be 32 random bytes encoded as base64url');
  return value;
}

// Call at the trusted gateway for each accountless source and return once over TLS.
export function newBearerToken() { return randomBytes(32).toString('base64url'); }

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
