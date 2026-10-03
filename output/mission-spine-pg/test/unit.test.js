import test from 'node:test';
import assert from 'node:assert/strict';
import { newBearerToken, receiptToken, sha256, stableStringify } from '../src/validation.js';
import { MissionError } from '../src/errors.js';
import { missionCommands } from '../src/mission.js';

test('gateway bearer token is 32 random bytes, separately validated and hashable', () => {
  const a = newBearerToken();
  const b = newBearerToken();
  assert.equal(receiptToken(a), a);
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.notEqual(a, b);
  assert.match(sha256(a), /^[a-f0-9]{64}$/);
  assert.throws(() => receiptToken('alice@example.com'), MissionError);
});

test('request hashing is independent of object key order', () => {
  assert.equal(stableStringify({ b: 2, a: { z: 1, y: 2 } }),
    stableStringify({ a: { y: 2, z: 1 }, b: 2 }));
});

test('class 3 and hosted processing fail before touching the database', async () => {
  const never = { command() { throw new Error('database touched'); } };
  const api = missionCommands(never);
  await assert.rejects(api.createWork({}, {
    workId: 'w', outcome: 'o', acceptanceTest: 'a', riskClass: 3,
    mentorId: 'mentor', reviewerId: 'reviewer', capacityHours: 1,
    dueAt: new Date(Date.now() + 86400000).toISOString(), compensation: 'none',
    rights: 'open', stopCondition: 'stop'
  }), error => error instanceof MissionError && error.code === 'invalid_input');
  await assert.rejects(api.compileContext({}, {
    manifestId: 'm', issueId: 'i', purpose: 'review', audience: 'model',
    action: 'compile', provider: 'hosted', policyVersion: 1, modelVersion: 'x',
    costBound: 1, expiresAt: new Date(Date.now() + 86400000).toISOString()
  }), error => error instanceof MissionError && error.code === 'model_disabled');
});
