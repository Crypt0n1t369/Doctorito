import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { one } from './db.js';
import { emit } from './events.js';
import { id, slugify } from './ids.js';
import { publishNeed } from './needs.js';
import { DEFAULT_CONFIG } from './config.js';

/**
 * Load a scenario pack. A scenario is data, not code: applying this platform to
 * a new domain is writing a catalogue, not writing a matcher. That is the whole
 * claim, so the three packs in scenarios/ are deliberately unalike — a municipal
 * participatory budget, a multi-agency storm response, and a research
 * consortium forming a bid.
 *
 * Needs go in through the same editor the humans use, validation included. A
 * scenario that would be refused at the keyboard is refused here too.
 */
export function listScenarios(dir = 'scenarios') {
  // A leading underscore marks a fixture: loadable by name, never listed.
  return readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => f.replace(/\.json$/, ''));
}

export function loadScenario(slug, dir = 'scenarios') {
  return JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8'));
}

export function seedScenario(db, scenario, { author = 'seed' } = {}) {
  const decisionId = id('dc');
  const initiativeId = id('in');
  const slug = scenario.slug ?? slugify(scenario.title);

  emit(db, {
    type: 'decision.imported', author,
    payload: {
      decision_id: decisionId,
      source: scenario.decision.source,
      body: scenario.decision.body,
      result: scenario.decision.result,
      quorum: scenario.decision.quorum,
      decided_at: scenario.decision.decided_at,
      provenance: scenario.decision.provenance,
    },
  });

  const config = {
    ...DEFAULT_CONFIG,
    ...(scenario.config ?? {}),
    gazetteer: scenario.gazetteer ?? [],
  };

  emit(db, {
    type: 'initiative.opened', initiative_id: initiativeId, author,
    payload: {
      initiative_id: initiativeId, slug, decision_id: decisionId,
      title: scenario.initiative.title ?? scenario.title,
      objective: scenario.initiative.objective,
      constraints: scenario.initiative.constraints ?? [],
      window_start: scenario.initiative.window_start,
      window_end: scenario.initiative.window_end,
      place: scenario.initiative.place,
      geo_lat: scenario.initiative.geo_lat,
      geo_lon: scenario.initiative.geo_lon,
      owner_org: scenario.initiative.owner_org,
      visibility: scenario.initiative.visibility ?? 'public',
      autobind: 1,
      config,
    },
  });

  const initiative = one(db, 'select * from initiatives where initiative_id=?', initiativeId);

  const needRefs = {};
  const refused = [];
  for (const n of scenario.needs ?? []) {
    const res = publishNeed(db, {
      initiative,
      author: `${author}:catalogue`,
      draft: {
        kind: n.kind, description: n.description, description_short: n.description_short,
        qty_required: n.qty_required, unit: n.unit,
        window_start: n.window_start, window_end: n.window_end,
        geo_place: n.geo_place, geo_lat: n.geo_lat, geo_lon: n.geo_lon,
        geo_radius_km: n.geo_radius_km, qualifications: n.qualifications ?? [],
        risk_class: n.risk_class, allow_overcommit: n.allow_overcommit ?? 0,
        language: n.language ?? scenario.locale ?? 'en',
      },
    });
    if (!res.ok) { refused.push({ ref: n.ref, errors: res.errors }); continue; }
    needRefs[n.ref] = res.need_id;
  }

  const actorRefs = {};
  for (const a of scenario.actors ?? []) {
    const actorId = id('ac');
    actorRefs[a.ref] = actorId;
    emit(db, {
      type: 'actor.registered', author,
      payload: { actor_id: actorId, kind: a.kind ?? 'person', display_name: a.display_name },
    });
    for (const c of a.contacts ?? []) {
      emit(db, {
        type: 'actor.contact_added', author,
        payload: { contact_id: id('ct'), actor_id: actorId, channel: c.channel, handle: String(c.handle).toLowerCase(), verified: 1 },
      });
    }
    for (const cr of a.credentials ?? []) {
      emit(db, {
        type: 'credential.verified', author: `${author}:verifier`,
        payload: { credential_id: id('cr'), actor_id: actorId, code: cr.code, issuer: cr.issuer, expires_at: cr.expires_at ?? null },
      });
    }
    for (const cp of a.capabilities ?? []) {
      emit(db, {
        type: 'capability.declared', initiative_id: initiativeId, author,
        payload: { capability_id: id('cp'), actor_id: actorId, ...cp, initiative_id: initiativeId },
      });
    }
  }

  return { initiative: one(db, 'select * from initiatives where initiative_id=?', initiativeId), needRefs, actorRefs, refused };
}
