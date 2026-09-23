import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateNeed, publishNeed, needsOf, KINDS } from '../src/needs.js';
import { world } from './helpers.js';

const draft = (over = {}) => ({
  kind: 'labour',
  description: 'Six people to rake and bag leaves along the lower path',
  description_short: '6 people raking, lower path, Sat',
  qty_required: 6, unit: 'person',
  window_start: '2026-10-10T07:00:00Z', window_end: '2026-10-10T15:00:00Z',
  geo_place: 'Ogre', geo_radius_km: 25, qualifications: [], risk_class: 1, language: 'en',
  ...over,
});

describe('the editor refuses what cannot be matched against anybody', () => {
  const cases = [
    ['no quantity', { qty_required: null }, /quantity/i],
    ['a quantity of zero', { qty_required: 0 }, /quantity/i],
    ['no unit', { unit: null }, /unit/i],
    ['no window', { window_start: null }, /window/i],
    ['a window that ends before it starts', { window_start: '2026-10-10T15:00:00Z', window_end: '2026-10-10T07:00:00Z' }, /ends before/i],
    ['a short form over sixty characters', { description_short: 'x'.repeat(61) }, /description_short/i],
    ['no short form at all', { description_short: '' }, /description_short/i],
    ['an unknown kind', { kind: 'vibes' }, /kind/i],
    ['a risk class outside 1 to 3', { risk_class: 4 }, /risk_class/i],
  ];

  for (const [name, over, pattern] of cases) {
    test(`it refuses ${name}, and says which field`, () => {
      const result = validateNeed(draft(over));
      assert.equal(result.ok, false);
      assert.match(result.errors.join(' | '), pattern);
    });
  }

  test('"we need volunteers" is not a need', () => {
    const result = validateNeed(draft({ description: 'We need volunteers', qty_required: null, unit: null, window_start: null }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.length >= 3, 'it names every missing part, not just the first');
  });
});

describe('the editor warns where it should not refuse', () => {
  test('class 3 with no credential named is a warning, not a refusal', () => {
    const result = validateNeed(draft({ risk_class: 3, qualifications: [] }));
    assert.equal(result.ok, true);
    assert.match(result.warnings.join(' '), /credential/i);
  });

  test('a credential on a need below class 3 is worth a second look', () => {
    const result = validateNeed(draft({ risk_class: 1, qualifications: ['RC-CHAINSAW'] }));
    assert.equal(result.ok, true);
    assert.match(result.warnings.join(' '), /risk class 3/i);
  });
});

describe('a valid draft publishes', () => {
  test('it appears in the catalogue with a derived, empty commitment', () => {
    const w = world();
    const before = needsOf(w.db, w.initiative.initiative_id).length;
    const result = publishNeed(w.db, { initiative: w.initiative, draft: draft(), author: 'coordinator:test' });
    assert.equal(result.ok, true);

    const needs = needsOf(w.db, w.initiative.initiative_id);
    assert.equal(needs.length, before + 1);
    const published = needs.find((n) => n.need_id === result.need_id);
    assert.equal(published.qty_committed, 0);
    assert.equal(published.status, 'open');
    assert.equal(published.qty_required, 6);
    assert.ok(KINDS.includes(published.kind));
  });

  test('a refused draft publishes nothing', () => {
    const w = world();
    const before = needsOf(w.db, w.initiative.initiative_id).length;
    const result = publishNeed(w.db, { initiative: w.initiative, draft: draft({ unit: null }), author: 'coordinator:test' });
    assert.equal(result.ok, false);
    assert.equal(needsOf(w.db, w.initiative.initiative_id).length, before);
  });
});
