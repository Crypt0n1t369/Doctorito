import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { one, all } from '../src/db.js';
import { extract, extractQuantities, extractWindow, reconcileWindow, quantityFor } from '../src/extract.js';
import { detectLanguage, conceptsOf } from '../src/lang.js';
import { redact, buildState } from '../src/judgment/redact.js';
import { admit } from '../src/pipeline/admit.js';
import { world, at, NOW } from './helpers.js';

const day = (iso) => String(iso).slice(0, 10);

describe('dates, in three languages and without arithmetic from the model', () => {
  test('a decimal quantity is not a date', () => {
    // "7.5 t" read as the seventh of May is the bug that made a Thursday offer
    // land in next spring.
    const w = extractWindow('I can bring a 7.5 t flatbed on Thursday and Friday', NOW);
    assert.equal(w.kind, 'relative');
    assert.deepEqual(w.dows.sort(), [4, 5]);
    assert.equal(day(w.start), '2026-09-24');
    assert.equal(day(w.end), '2026-09-25');
  });

  test('a trailing dot makes it a date, a decimal point does not', () => {
    assert.equal(day(extractWindow('Sanaksme 17.10. plkst 9:00', NOW).start), '2026-10-17');
    assert.equal(extractWindow('the load is 17.10 tonnes', NOW).kind, 'none');
  });

  test('ranges parse in all three languages', () => {
    for (const text of ['We can host 20 people from October 3-5', 'varam 3.-5. oktobri', 'можем 3.-5. октября']) {
      const w = extractWindow(text, NOW);
      assert.equal(w.kind, 'explicit', text);
      assert.equal(day(w.start), '2026-10-03', text);
      assert.equal(day(w.end), '2026-10-05', text);
    }
  });

  test('the same weekday in three languages resolves to the same day', () => {
    const days = ['I can come on Saturday', 'varu sestdien', 'могу в субботу']
      .map((t) => day(extractWindow(t, NOW).start));
    assert.deepEqual(days, [days[0], days[0], days[0]]);
    assert.equal(new Date(days[0] + 'T00:00:00Z').getUTCDay(), 6);
  });
});

describe('a weekday is a recurring answer, not a date', () => {
  const initiative = { window_start: '2026-10-01T00:00:00Z', window_end: '2026-10-31T23:00:00Z' };

  test('a weekday outside the initiative is spread across the initiative', () => {
    const parsed = extractWindow('I can come on Saturday', NOW);           // 2026-09-26
    const fixed = reconcileWindow(parsed, initiative, NOW);
    assert.equal(fixed.kind, 'relative-recurring');
    assert.equal(day(fixed.start), '2026-10-03');
    assert.equal(day(fixed.end), '2026-10-31');
  });

  test('an explicit date is never moved', () => {
    const parsed = extractWindow('12 October', NOW);
    const fixed = reconcileWindow(parsed, initiative, NOW);
    assert.equal(fixed.kind, 'explicit');
    assert.equal(day(fixed.start), day(parsed.start));
  });

  test('a relative window that cannot be reconciled is demoted rather than used to reject everything', () => {
    const parsed = extractWindow('tomorrow', NOW);                          // 2026-09-21, no weekday
    const fixed = reconcileWindow(parsed, initiative, NOW);
    assert.equal(fixed.kind, 'none');
    assert.equal(fixed.demoted_from, 'relative');
  });
});

describe('quantities', () => {
  test('the unit is the word next to the number, not the next unit in the sentence', () => {
    const q = extractQuantities('varam ziedot 6 m3 kokmaterialu, 12 m2 telpas, 3 tonnas');
    assert.deepEqual(q.map((x) => [x.value, x.unit]), [[6, 'm3'], [12, 'm2'], [3, 'tonne']]);
  });

  test('inflected units parse in Latvian and Russian', () => {
    // \w and \b are ASCII-only in JavaScript, which is why "человека" used to
    // lose its unit and two unrelated needs then scored identically.
    for (const [text, expected] of [
      ['нас будет 3 человека', [3, 'person']],
      ['5 человек', [5, 'person']],
      ['2 cilvekiem', [2, 'person']],
      ['4 dienas', [4, 'day']],
      ['десять мест', [10, 'place']],
      ['7.5 t', [7.5, 'tonne']],
    ]) {
      const q = extractQuantities(text);
      assert.deepEqual([q[0].value, q[0].unit], expected, text);
    }
  });

  test('quantityFor picks the one the need is counted in', () => {
    const q = extractQuantities('I can bring a 7.5 t flatbed and two people, within 40 km');
    assert.equal(quantityFor(q, 'person'), 2);
    assert.equal(quantityFor(q, 'tonne'), 7.5);
  });
});

describe('language and concepts', () => {
  test('detectLanguage over realistic messages', () => {
    const cases = [
      ['I can bring a flatbed truck on Saturday', 'en'],
      ['Varu atbraukt ar kravas auto sestdien', 'lv'],
      ['Могу привезти генератор в субботу', 'ru'],
      ['mums ir kravas auto', 'lv'],
      ['count me in for the weekend', 'en'],
      ['нас трое, придём утром', 'ru'],
    ];
    for (const [text, lang] of cases) assert.equal(detectLanguage(text), lang, text);
  });

  test('a short lexicon entry has to be the whole word', () => {
    // "bus" inside "būsim" and "tow" inside "towards" gave two unrelated needs
    // a phantom shared concept, and phantom shared concepts tie the ranking.
    assert.equal(conceptsOf('Mes busim cetri cilveki').has('transport'), false);
    assert.equal(conceptsOf('800 EUR towards skip hire').has('transport'), false);
    assert.equal(conceptsOf('we need a bus').has('transport'), true);
  });

  test('a longer entry is a stem and matches an inflection', () => {
    assert.equal(conceptsOf('cimdi mums ir').has('equipment'), true);
    assert.equal(conceptsOf('mes busim 12 cilveki').has('labour'), true);
    assert.equal(conceptsOf('перчатки свои').has('equipment'), true);
  });
});

describe('strip identity before the call, and match on capability', () => {
  test('redact removes what identifies a person', () => {
    const { text } = redact(
      'Hi, I am Janis Berzins, call me +371 29123456 or janis@example.lv, Brivibas iela 12, IBAN LV80BANK0000435195001',
      ['Janis Berzins'],
    );
    for (const gone of ['Janis', 'Berzins', '29123456', 'janis@example.lv', 'Brivibas iela']) {
      assert.equal(text.includes(gone), false, `${gone} survived redaction`);
    }
    assert.match(text, /\[name\]|\[phone\]|\[email\]/);
  });

  test('a phone number cannot leave disguised as a quantity', () => {
    const extracted = extract('call me on +371 29123456, I have a 7.5 t flatbed', { now: NOW });
    const { state } = buildState({
      initiative: { objective: 'x', place: 'Ogre' },
      offerText: 'call me on +371 29123456, I have a 7.5 t flatbed',
      names: [], extracted, candidates: [{ id: 'n1', short: 'a lorry' }],
    });
    const sent = JSON.stringify(state);
    assert.equal(sent.includes('29123456'), false, 'the number came back as a quantity');
    assert.equal(sent.includes('371'), false);
    assert.ok(state.extracted_by_code.offers_quantities.includes('7.5 tonne'));
  });

  test('the verbatim text stays here while only the redacted form leaves', async () => {
    const w = world();
    const text = 'Hello, Janis Berzins here, janis@example.lv, +371 29123456. We can send one flatbed lorry on Saturday to haul branches.';
    const r = await admit(w.db, {
      initiative: w.initiative, channel: 'web', handle: 'janis@example.lv', displayName: 'Janis Berzins',
      text, now: at(1),
    });

    const stored = one(w.db, 'select raw_text from offers where offer_id=?', r.offer_id).raw_text;
    assert.equal(stored, text, 'the message is kept exactly as it was written');

    for (const j of all(w.db, 'select * from judgments where offer_id=?', r.offer_id)) {
      const sent = JSON.stringify(JSON.parse(j.request));
      for (const identifier of ['Berzins', 'janis@example.lv', '29123456']) {
        assert.equal(sent.includes(identifier), false, `${identifier} left this machine`);
      }
    }
  });
});
