// Reproducible size check for the proposed ATR2 report and COSE receipt.
// Dummy zero bytes stand in for an Ed25519 signature and HPKE ciphertext;
// this checks framing sizes, not cryptographic correctness.
import assert from 'node:assert/strict';
import { encode } from 'cborg';

const maxCompactReport = [
  2,                         // version
  0xffffffff,                // areaId
  0xffffffff,                // observedAtUnixSeconds
  3,                         // highest valid category
  3,                         // highest valid severity
  -9_000_000,                // latitudeE5 at -90 degrees
  18_000_000,                // longitudeE5 at +180 degrees
  'a'.repeat(40),             // largest permitted UTF-8 note (bytes)
];
const reportCborBytes = encode(maxCompactReport).length;
const reportPlaintextBytes = 2 + reportCborBytes;
const reportWireBytes = 10 + 32 + 70 + 16;
assert.equal(reportCborBytes, 66);
assert.ok(reportPlaintextBytes <= 70);
assert.equal(reportWireBytes, 128);

const receiptPayload = encode([1, new Uint8Array(16), 0xffffffff]);
const protectedHeader = encode(new Map([[1, -8], [4, new Uint8Array(4)]]));
const taggedCoseSign1 = new Uint8Array([
  0xd2, // CBOR tag 18: COSE_Sign1
  ...encode([protectedHeader, new Map(), receiptPayload, new Uint8Array(64)]),
]);
assert.equal(taggedCoseSign1.length, 105);

// Proposed ATP1 centre-to-user private note: a 40-byte UTF-8 note plus
// message ID, expiry, area and key epoch fits the same 70-byte plaintext pad.
const maxPrivateNote = [
  1, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff,
  'a'.repeat(40),
];
const privateNoteCborBytes = encode(maxPrivateNote).length;
const privateNotePlaintextBytes = 2 + privateNoteCborBytes;
assert.equal(privateNoteCborBytes, 64);
assert.ok(privateNotePlaintextBytes <= 70);
const privateEnvelopeWireBytes = 10 + 32 + 70 + 16;
const signedPrivateWireBytes = new Uint8Array([
  0xd2,
  ...encode([protectedHeader, new Map(),
    new Uint8Array(privateEnvelopeWireBytes), new Uint8Array(64)]),
]).length;
assert.equal(privateEnvelopeWireBytes, 128);
assert.equal(signedPrivateWireBytes, 209);

console.log(JSON.stringify({
  reportCborBytes,
  reportPlaintextBytes,
  reportWireBytes,
  receiptPayloadBytes: receiptPayload.length,
  receiptWireBytes: taggedCoseSign1.length,
  privateNoteCborBytes,
  privateNotePlaintextBytes,
  privateEnvelopeWireBytes,
  signedPrivateWireBytes,
}, null, 2));
