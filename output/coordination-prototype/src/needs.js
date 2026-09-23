import { one, all, tx } from './db.js';
import { emit } from './events.js';
import { id } from './ids.js';
import { ask as askModel } from './judgment/index.js';
import { editorQuestions } from './judgment/questions.js';
import { configFor } from './config.js';

/**
 * The need editor. One more screen, and it is the one that decides everything.
 *
 * Vague needs are the single largest source of downstream failure, and the place
 * to fix them is at the keyboard of the person writing them. So this module
 * refuses to publish a need without a quantity, a unit and a window, and it
 * proposes a decomposition from the objective text for the author to correct.
 */

export const KINDS = ['labour', 'transport', 'equipment', 'materials', 'space', 'expertise', 'money', 'permission'];
export const UNITS = ['person', 'hour', 'day', 'tonne', 'kg', 'km', 'place', 'unit', 'm2', 'm3', 'EUR'];

/** The rule the editor will not let you past. */
export function validateNeed(draft) {
  const errors = [];
  const warnings = [];

  if (!draft.description || draft.description.trim().length < 12) {
    errors.push('A need needs a description a stranger could act on.');
  }
  if (!(Number(draft.qty_required) > 0)) {
    errors.push('A need without a quantity cannot be published. "We need volunteers" is not a need.');
  }
  if (!draft.unit) errors.push('A quantity without a unit is not a quantity. Say what you are counting.');
  if (!draft.window_start) errors.push('A need without a window cannot be matched against anyone’s availability.');
  if (draft.window_start && draft.window_end && draft.window_end < draft.window_start) {
    errors.push('The window ends before it starts.');
  }
  if (!KINDS.includes(draft.kind)) errors.push(`kind must be one of: ${KINDS.join(', ')}`);
  const risk = Number(draft.risk_class);
  if (![1, 2, 3].includes(risk)) errors.push('risk_class must be 1, 2 or 3.');

  const quals = normaliseQuals(draft.qualifications);
  if (risk === 3 && quals.length === 0) {
    warnings.push('Risk class 3 with no required credential. Nothing can ever bind here automatically, which is correct, but if there is a certificate, name it so eligibility is a predicate rather than a conversation.');
  }
  if (risk < 3 && quals.length > 0) {
    warnings.push('This need requires a credential but is not risk class 3. Check that is deliberate.');
  }

  const short = (draft.description_short ?? '').trim();
  if (!short) errors.push('description_short is what the wide ranking pass sees. Write it.');
  else if (short.length > 60) errors.push(`description_short is ${short.length} characters; the ranking pass takes 60.`);
  else if (sameWordsAsOthers(short)) warnings.push('description_short does not distinguish this need from the others.');

  return { ok: errors.length === 0, errors, warnings };
}

let siblingShorts = [];
/** Give the validator the other needs in the catalogue so it can warn about collisions. */
export function withSiblings(shorts) { siblingShorts = shorts ?? []; }
function sameWordsAsOthers(short) {
  const w = new Set(short.toLowerCase().split(/\W+/).filter((x) => x.length > 3));
  if (!w.size) return false;
  return siblingShorts.some((s) => {
    const o = new Set(String(s).toLowerCase().split(/\W+/).filter((x) => x.length > 3));
    const shared = [...w].filter((x) => o.has(x)).length;
    return o.size && shared / Math.max(w.size, o.size) > 0.8;
  });
}

function normaliseQuals(q) {
  if (!q) return [];
  if (Array.isArray(q)) return q.filter(Boolean);
  // A stored need holds its qualifications as JSON text. Splitting that text on
  // commas turned "[]" into a credential called "[]" that nobody holds, so every
  // amended need silently refused every offer.
  const s = String(q).trim();
  if (s.startsWith('[')) {
    try { const parsed = JSON.parse(s); if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean); } catch { /* fall through */ }
  }
  return s.split(/[,\s]+/).filter(Boolean);
}

export function publishNeed(db, { initiative, draft, author }) {
  const siblings = all(db, 'select description_short from needs where initiative_id=? and need_id != ?',
    initiative.initiative_id, draft.need_id ?? '');
  withSiblings(siblings.map((s) => s.description_short));

  const check = validateNeed(draft);
  if (!check.ok) return { ok: false, ...check };

  const needId = draft.need_id ?? id('nd');
  emit(db, {
    type: 'need.published', initiative_id: initiative.initiative_id, author,
    payload: {
      ...draft,
      need_id: needId,
      initiative_id: initiative.initiative_id,
      qty_required: Number(draft.qty_required),
      risk_class: Number(draft.risk_class),
      qualifications: normaliseQuals(draft.qualifications),
      geo_radius_km: draft.geo_radius_km ? Number(draft.geo_radius_km) : 25,
      allow_overcommit: draft.allow_overcommit ? 1 : 0,
    },
  });
  return { ok: true, need_id: needId, warnings: check.warnings };
}

/**
 * Invariant 6: a need's quantity never changes silently. An amendment is an
 * event with an author and a reason, and the reason is not optional, because a
 * need that quietly grows is how people stop trusting the board.
 */
export function amendNeed(db, { need, changes, author, reason }) {
  if (!reason || String(reason).trim().length < 4) {
    return { ok: false, errors: ['An amendment needs a reason. It will be shown on the public page.'] };
  }
  return tx(db, () => {
    const current = one(db, 'select * from needs where need_id=?', need.need_id);
    if (!current) return { ok: false, errors: ['No such need.'] };
    const merged = { ...current, ...changes, qualifications: normaliseQuals(changes.qualifications ?? current.qualifications) };
    const check = validateNeed(merged);
    if (!check.ok) return { ok: false, ...check };

    // Nobody who has been told they are needed can be amended out of the need:
    // confirmed commitments, and leases still waiting for a tap, both count.
    const held = one(db,
      `select coalesce(sum(qty),0) q from commitments where need_id=? and state in ('proposed','confirmed','fulfilled')`,
      current.need_id).q;
    if (Number(merged.qty_required) < held) {
      return { ok: false, errors: [`Cannot reduce the quantity below what is already committed or held for confirmation (${held}).`] };
    }

    emit(db, {
      type: 'need.amended', initiative_id: current.initiative_id, author, reason,
      payload: { need_id: current.need_id, ...changes, qualifications: merged.qualifications },
    });
    return { ok: true, warnings: check.warnings };
  });
}

export function closeNeed(db, { need, author, reason }) {
  emit(db, {
    type: 'need.closed', initiative_id: need.initiative_id, author, reason,
    payload: { need_id: need.need_id },
  });
  return { ok: true };
}

/**
 * Propose a decomposition from the objective, for the author to correct.
 *
 * The judgment model does not generate text, and we would not want it to here:
 * an invented need statement that nobody wrote is exactly the vagueness this
 * screen exists to stop. So code splits the objective into clauses, and the
 * model does the two things it is good at — classify the clause, and say
 * whether it is concrete enough to act on. The author writes the rest.
 */
export async function proposeDecomposition(db, { initiative }) {
  const cfg = configFor(initiative);
  const constraints = JSON.parse(initiative.constraints ?? '[]');
  const clauses = splitClauses([initiative.objective, ...constraints].filter(Boolean).join('. '));

  const out = [];
  for (const text of clauses) {
    const state = { initiative: { objective: initiative.objective }, need_text: text };
    const res = await askModel(db, { initiative, pass: 'editor', state, questions: editorQuestions(), cfg });
    out.push({
      text,
      kind: res.answers.need_kind?.choice ?? 'labour',
      kind_confidence: res.answers.need_kind?.confidence ?? 0,
      concrete: res.answers.need_is_concrete?.noul ?? 0,
      missing: missingParts(text),
      judgment_id: res.judgment_id,
    });
  }
  return out;
}

function splitClauses(text) {
  return String(text ?? '')
    .split(/[.;\n]+|,\s+(?=(?:and|un|и)\s)/gi)
    .map((s) => s.replace(/^\s*(and|un|и)\s+/i, '').trim())
    .filter((s) => s.split(/\s+/).length >= 4)
    .slice(0, 10);
}

function missingParts(text) {
  const missing = [];
  if (!/\d/.test(text)) missing.push('quantity');
  if (!/\b(kg|km|t|tonne|hour|stund|person|cilv|human|day|dien|place|viet|eur|m2|m3)\b/i.test(text)) missing.push('unit');
  if (!/\b(\d{1,2}[./]\d{1,2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|october|november|oktobr|novembr|pirmdien|otrdien|sestdien|svetdien|nedel)\b/i.test(text)) missing.push('window');
  return missing;
}

export function needsOf(db, initiativeId, status = null) {
  return status
    ? all(db, 'select * from needs where initiative_id=? and status=? order by published_at', initiativeId, status)
    : all(db, 'select * from needs where initiative_id=? order by published_at', initiativeId);
}

export function needById(db, needId) {
  return one(db, 'select * from needs where need_id=?', needId);
}
