import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { open } from '../src/db.js';
import { emit } from '../src/events.js';
import { id } from '../src/ids.js';
import { seedScenario, loadScenario } from '../src/seed.js';

/**
 * The suite is hermetic, and stays hermetic even when a developer's .env points
 * the judgment layer at a paid hosted endpoint. Tests assert on decisions, and a
 * decision that depends on a network call is not a test of this code. Anything
 * that genuinely needs the hosted path asks for it explicitly.
 */
process.env.JUDGMENT_ENGINE = 'rules';
delete process.env.TYPESAFE_ENDPOINT;
delete process.env.TYPESAFE_API_KEY;

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const NOW = new Date('2026-09-20T09:00:00Z');

export function smoke() {
  return loadScenario('_smoke', join(ROOT, 'scenarios'));
}

/**
 * A catalogue small enough to reason about in a test and varied enough to
 * exercise the gate: one ordinary need, one that costs money, one that needs a
 * certificate, and one nobody will ever offer.
 */
export function tinyScenario(overrides = {}) {
  return {
    slug: 'tiny',
    title: 'Tiny',
    locale: 'en',
    decision: {
      source: 'council-minute', body: 'Council', result: 'Adopted', quorum: '9 of 15',
      decided_at: '2026-09-01T00:00:00Z', provenance: { external_id: 'tiny-1' },
    },
    initiative: {
      title: 'Riverbank', objective: 'Clear four kilometres of riverbank before winter.',
      constraints: [], window_start: '2026-10-01T00:00:00Z', window_end: '2026-10-31T23:00:00Z',
      place: 'Ogre', geo_lat: 56.816, geo_lon: 24.606, owner_org: 'Ogre', visibility: 'public',
    },
    config: { engine: 'rules', human_contact: 'k@ogre.lv' },
    gazetteer: [{ name: 'Ogre', lat: 56.816, lon: 24.606, aliases: [] }],
    needs: [
      need({
        ref: 'vol', kind: 'labour', qty: 20, unit: 'person', risk: 1,
        description: 'Twenty volunteers with gloves to collect waste on the riverbank on Saturday morning',
        short: '20 volunteers with gloves, Sat morning, riverbank',
        start: '2026-10-03T06:00:00Z', end: '2026-10-03T14:00:00Z',
      }),
      need({
        ref: 'truck', kind: 'transport', qty: 2, unit: 'unit', risk: 1,
        description: 'A flatbed lorry of five tonnes or more to haul cut branches to the yard on Saturday',
        short: 'Flatbed lorry 5t+, Sat, haul branches',
        start: '2026-10-03T06:00:00Z', end: '2026-10-03T18:00:00Z',
      }),
      need({
        ref: 'saw', kind: 'labour', qty: 2, unit: 'person', risk: 3, quals: ['RC-CHAINSAW'],
        description: 'Certified chainsaw operator to fell three leaning trees over the path on Saturday',
        short: 'Certified chainsaw operator, Sat, leaning trees',
        start: '2026-10-03T06:00:00Z', end: '2026-10-03T16:00:00Z',
      }),
      need({
        ref: 'cash', kind: 'money', qty: 800, unit: 'EUR', risk: 2,
        description: 'Eight hundred euro towards skip hire for mixed waste removal in October',
        short: '800 EUR towards skip hire, October',
        start: '2026-10-01T00:00:00Z', end: '2026-10-31T00:00:00Z',
      }),
    ],
    actors: [
      {
        ref: 'sawyer', kind: 'person', display_name: 'Ilze Ozola',
        contacts: [{ channel: 'telegram', handle: 'ilzeo' }],
        credentials: [{ code: 'RC-CHAINSAW', issuer: 'Meza dienests', expires_at: null }],
        capabilities: [{
          kind: 'labour', description: 'Certified chainsaw work, felling and limbing',
          quantity: 1, unit: 'person', availability_start: '2026-10-01T00:00:00Z',
          availability_end: '2026-10-31T00:00:00Z', geo_place: 'Ogre', geo_lat: 56.816,
          geo_lon: 24.606, geo_radius_km: 40, evidence: 'certificate seen',
        }],
      },
      {
        ref: 'hauler', kind: 'organisation', display_name: 'Ogre Timber',
        contacts: [{ channel: 'email', handle: 'raivo@ogretimber.lv' }],
        credentials: [],
        capabilities: [{
          kind: 'transport', description: 'Flatbed lorry, 12 tonnes, driver included',
          quantity: 1, unit: 'unit', availability_start: '2026-10-01T00:00:00Z',
          availability_end: '2026-10-31T00:00:00Z', geo_place: 'Ogre', geo_lat: 56.816,
          geo_lon: 24.606, geo_radius_km: 60, evidence: 'hauled for us last year',
        }],
      },
    ],
    traffic: [],
    ...overrides,
  };
}

function need({ ref, kind, qty, unit, risk, description, short, start, end, quals = [] }) {
  return {
    ref, kind, description, description_short: short,
    qty_required: qty, unit, window_start: start, window_end: end,
    geo_place: 'Ogre', geo_lat: 56.816, geo_lon: 24.606, geo_radius_km: 25,
    qualifications: quals, risk_class: risk, language: 'en',
  };
}

/** An in-memory database with the tiny catalogue already published. */
export function world(overrides) {
  const db = open(':memory:');
  const seeded = seedScenario(db, tinyScenario(overrides));
  return { db, ...seeded, needOf: (ref) => seeded.needRefs[ref], refOf: reverse(seeded.needRefs) };
}

function reverse(map) {
  const back = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  return (id) => back[id] ?? id;
}

/**
 * A judgment that really exists, in the initiative it claims to belong to. A
 * lease refuses to name anything else, so tests that bind by hand write one.
 */
export function judgmentIn(db, initiative) {
  const judgmentId = id('jd');
  emit(db, {
    type: 'judgment.written', initiative_id: initiative.initiative_id, author: 'test',
    payload: {
      judgment_id: judgmentId, offer_id: null, initiative_id: initiative.initiative_id,
      pass: 'test', question_bank_version: 'test', model_version: 'test', engine: 'rules',
      state_hash: 'test', request: {}, answers: {}, confidence: null, latency_ms: 0,
      input_tokens: 0, cost_usd: 0,
    },
    at: NOW.toISOString(),
  });
  return judgmentId;
}

/** Offsets keep every message in one run at a distinct, predictable time. */
export function at(minutes) {
  return new Date(NOW.getTime() + minutes * 60_000);
}
