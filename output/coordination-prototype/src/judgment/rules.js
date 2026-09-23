import { stems, conceptsOf, detectLanguage } from '../lang.js';

/**
 * The rules-based fallback.
 *
 * It implements exactly the interface of the hosted judgment model: the same
 * questions in, the same typed answers with full probability distributions out.
 * Two reasons it exists rather than being a stub:
 *
 *   1. The spec requires a fallback. A single-region hosted API from a company
 *      that exited stealth last week is not something to depend on without one.
 *   2. It makes the prototype runnable, testable and measurable with no API key
 *      and no network, so the harness numbers below are reproducible by anyone.
 *
 * It is genuinely worse than the model, and the harness reports which engine
 * produced each number. That is the point: the engine is a swap, not a rewrite.
 */
export const VERSION = 'rules-1.0.0';

const OFFER_VERBS = [
  'i can', 'we can', 'i could', 'we could', 'i have', 'we have', 'i will', 'we will',
  'happy to', 'able to', 'can bring', 'can provide', 'can lend', 'can donate', 'can host',
  'offering', 'offer', 'available', 'at your disposal', 'count me in', 'sign me up', 'put me down',
  'varu', 'varam', 'varetu', 'piedava', 'piedavaju', 'man ir', 'mums ir', 'atvedisu', 'palidzesu',
  'pieteikties', 'esmu gatavs', 'esam gatavi', 'noda', 'aizdot', 'busim', 'busu', 'atnaksim',
  'atnaksu', 'nakam', 'varesim', 'varesu', 'nemsim', 'pieteikos', 'pierakstiet', 'ieradisimies',
  'mogu', 'mozhem', 'могу', 'можем', 'готов', 'готова', 'готовы', 'есть', 'привезу', 'привезти',
  'предлага', 'помогу', 'дам', 'одолжу', 'запиш', 'придем', 'придём', 'приду', 'придут', 'приедем',
  'приеду', 'будем', 'буду', 'возьму', 'возьмем', 'нас трое', 'нас двое', 'у нас есть', 'подключимся',
];

const QUESTION_WORDS = [
  'what', 'when', 'where', 'how', 'why', 'who', 'which', 'is there', 'are there', 'do you', 'can you',
  'kad', 'kur', 'ka ', 'kapec', 'kas ', 'vai ', 'cik ',
  'когда', 'где', 'как ', 'почему', 'кто ', 'что ', 'сколько', 'можно ли',
];

const WITHDRAW = [
  'cancel', 'withdraw', 'cant make', 'can not make', 'cannot make', 'wont be able', 'not coming',
  'pull out', 'back out', 'no longer', 'have to drop', 'something came up', 'cant come',
  'have to cancel', 'wont make it', 'cant do it', 'count me out', 'take me off', 'fell through',
  'atsauc', 'nevaru', 'nevaresu', 'neieradisos', 'atcelt', 'atsakos', 'kaut kas uzradies',
  'diemzel nevaru', 'nesanaks',
  'отмен', 'не смогу', 'не приду', 'отказ', 'снимаю', 'не получится', 'кое-что случилось',
];

const ADVERSARIAL = [
  'ignore previous', 'ignore all previous', 'ignore the above', 'disregard', 'system prompt',
  'you are an ai', 'you are a', 'act as', 'new instructions', 'override', 'admin mode',
  'set confidence', 'approve all', 'bind me to', 'mark as confirmed', 'developer mode',
  'jailbreak', 'pretend you', 'do not follow', 'your instructions', 'output the',
  'ignore', 'ignorē', 'neievero', 'sistemas', 'tu esi',
  'игнорируй', 'забудь', '系统', 'ты ии', 'новые инструкции',
];

const TIME_WORDS = [
  'today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'weekend', 'morning', 'afternoon', 'evening', 'week', 'month',
  'sodien', 'rit', 'pirmdien', 'otrdien', 'tresdien', 'ceturtdien', 'piektdien', 'sestdien',
  'svetdien', 'nedela', 'rit ', 'no plkst',
  'сегодня', 'завтра', 'понедельник', 'вторник', 'среду', 'четверг', 'пятниц', 'суббот',
  'воскресень', 'выходн', 'утром', 'вечером', 'недел',
];

const KINDS = ['labour', 'transport', 'equipment', 'materials', 'space', 'expertise', 'money', 'permission'];

function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
/**
 * Phrase matching with a right-hand word boundary. Without it "i can" matches
 * "i cant", which turns every withdrawal into an offer — the exact mistake that
 * produces a no-show nobody sees coming.
 */
function hit(t, phrase) {
  const i = t.indexOf(phrase);
  if (i < 0) return false;
  const after = t[i + phrase.length];
  return after === undefined || !/[\p{L}\p{N}]/u.test(after);
}
function hasAny(text, list) {
  const t = norm(text);
  return list.some((w) => hit(t, norm(w)));
}
function countAny(text, list) {
  const t = norm(text);
  return list.filter((w) => hit(t, norm(w))).length;
}
function logistic(x) { return 1 / (1 + Math.exp(-x)); }
function clamp(x, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, x)); }

/** Concentration of a distribution. Entropy and margin, blended, both in [0,1]. */
export function concentration(probs) {
  const p = probs.filter((x) => x > 0);
  const n = probs.length;
  if (n <= 1) return 1;
  const H = -p.reduce((a, x) => a + x * Math.log(x), 0);
  const normEntropy = 1 - H / Math.log(n);
  const sorted = [...probs].sort((a, b) => b - a);
  const margin = sorted[0] - (sorted[1] ?? 0);
  return clamp(0.5 * normEntropy + 0.5 * margin);
}

function softmax(scores, temperature = 0.10) {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/** Inverse document frequency over the candidate texts in this one request. */
function idfOver(texts) {
  const df = new Map();
  for (const t of texts) {
    for (const s of new Set(stems(t))) df.set(s, (df.get(s) ?? 0) + 1);
  }
  const n = Math.max(1, texts.length);
  return (s) => Math.log((n + 1) / ((df.get(s) ?? 0) + 0.5));
}

/**
 * How well does this offer text match this candidate need text?
 * Concept agreement carries most of it, weighted token overlap the rest.
 */
export function matchScore(offerText, cand, idf, extracted = {}, crossLingual = false) {
  const candText = typeof cand === 'string' ? cand : (cand?.text ?? '');
  const kind = typeof cand === 'string' ? null : (cand?.kind ?? null);
  const unit = typeof cand === 'string' ? null : (cand?.unit ?? null);

  const oConcepts = conceptsOf(offerText);
  const cConcepts = conceptsOf(candText);

  let textConcept = 0;
  if (cConcepts.size) {
    const shared = [...cConcepts].filter((c) => oConcepts.has(c)).length;
    // Recall against the smaller set: a need about transport that also mentions
    // a yard should not be penalised for an offer that is only about transport.
    textConcept = shared / Math.max(1, Math.min(cConcepts.size, oConcepts.size || 1));
    if (shared === 0 && oConcepts.size > 0) textConcept = -0.25;
  }

  // The need's declared kind beats anything inferred from its description,
  // because the person writing the catalogue chose it deliberately.
  const conceptScore = kind === null
    ? textConcept
    : oConcepts.has(kind) ? 1 : Math.max(textConcept * 0.8, oConcepts.size ? -0.25 : 0);

  const oStems = [...new Set(stems(offerText))];
  const cStems = [...new Set(stems(candText))];
  let num = 0, den = 0;
  for (const c of cStems) {
    const w = idf(c);
    den += w;
    if (oStems.some((o) => meets(o, c))) num += w;
  }
  const overlap = den > 0 ? num / den : 0;

  // What is being counted is the sharpest signal there is, and it needs no
  // arithmetic: somebody offering three people is not offering four days.
  const offerUnits = (extracted?.offers_quantities ?? [])
    .map((q) => String(q).split(' ').slice(1).join(' '))
    .filter((u) => u && u !== 'unspecified unit');
  // "unit" is the generic counter — one lorry, one terminal, one letter — so
  // any quantity is compatible with it and neither bonus nor penalty applies.
  // Everything else is specific enough that naming a different unit is real
  // evidence against: somebody offering three people is not offering four days.
  let unitScore = 0;
  if (unit && unit !== 'unit' && offerUnits.length) {
    unitScore = offerUnits.includes(unit) ? 0.15 : -0.10;
  }

  // Concept agreement says "the right kind of thing"; the words say "this
  // particular need". Two needs of the same kind are the common case, so the
  // words normally have to carry more of the decision than the kind does.
  //
  // Except across languages. An initiative in Latvia carries Latvian, Russian
  // and English in one inbox, and a Latvian message against an English
  // catalogue shares no tokens at all, so overlap there is not weak evidence —
  // it is no evidence, and weighting it as though it were is how a fallback
  // silently becomes useless in two of its three languages.
  const lexical = oConcepts.size === 0 || cConcepts.size === 0;
  const score = lexical
    ? 0.85 * overlap
    : crossLingual
      ? 0.80 * conceptScore + 0.20 * overlap
      : 0.40 * conceptScore + 0.60 * overlap;

  return clamp(score + unitScore, -0.2, 1);
}

/** Two stems meet if one is a prefix of the other and the shorter is >= 3 long. */
function meets(a, b) {
  if (a === b) return true;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  return short.length >= 3 && long.startsWith(short);
}

// ---------------------------------------------------------------------------

function offerness(text, extracted) {
  let x = -1.2;
  if (hasAny(text, OFFER_VERBS)) x += 2.6;
  const concepts = conceptsOf(text);
  x += Math.min(2, concepts.size) * 0.9;
  if ((extracted?.offers_quantities ?? []).length) x += 0.7;
  if (extracted?.states_a_time) x += 0.5;
  if (hasAny(text, QUESTION_WORDS) && /\?/.test(text)) x -= 2.2;
  if (hasAny(text, WITHDRAW)) x -= 2.0;
  if (norm(text).length < 12) x -= 1.0;
  return logistic(x);
}

function questionness(text) {
  let x = -1.6;
  if (/\?/.test(text)) x += 2.2;
  x += Math.min(2, countAny(text, QUESTION_WORDS)) * 0.9;
  if (hasAny(text, OFFER_VERBS)) x -= 1.6;
  return logistic(x);
}

function adversarialness(text) {
  const hits = countAny(text, ADVERSARIAL);
  let x = -3.2 + hits * 2.4;
  if (/\b(system|assistant|prompt|instruction)\b/i.test(text) && /\b(ignore|override|new|forget)\b/i.test(text)) x += 2.0;
  return logistic(x);
}

function withdrawalness(text) {
  let x = -3.0;
  x += countAny(text, WITHDRAW) * 2.6;
  if (hasAny(text, OFFER_VERBS) && !hasAny(text, WITHDRAW)) x -= 1.0;
  return logistic(x);
}

function specificityLevels(text, extracted) {
  const hasThing = conceptsOf(text).size > 0;
  const hasQty = (extracted?.offers_quantities ?? []).length > 0;
  const hasTime = !!extracted?.states_a_time || hasAny(text, TIME_WORDS);
  const n = (hasThing ? 1 : 0) + (hasQty ? 1 : 0) + (hasTime ? 1 : 0);
  if (n >= 3) return [0.02, 0.18, 0.80];
  if (n === 2) return [0.08, 0.62, 0.30];
  if (n === 1) return [0.35, 0.55, 0.10];
  return [0.86, 0.12, 0.02];
}

function sameResourceLevels(a, b) {
  const idf = idfOver([a, b]);
  const s = (matchScore(a, { text: b }, idf) + matchScore(b, { text: a }, idf)) / 2;
  if (s > 0.72) return [0.05, 0.15, 0.80];
  if (s > 0.45) return [0.20, 0.55, 0.25];
  return [0.82, 0.14, 0.04];
}

function needConcrete(text, extracted) {
  const hasNumber = /\d/.test(text);
  const hasTime = hasAny(text, TIME_WORDS) || /\d{1,2}[./]\d{1,2}/.test(text);
  const hasThing = conceptsOf(text).size > 0;
  let x = -2.0 + (hasNumber ? 1.6 : 0) + (hasTime ? 1.4 : 0) + (hasThing ? 1.2 : 0);
  if (/\b(volunteers?|help|support|brivpratig|palidz|доброволь|помощ)\b/i.test(text) && !hasNumber) x -= 1.5;
  return logistic(x);
}

function kindProbs(text) {
  const concepts = conceptsOf(text);
  const scores = KINDS.map((k) => (concepts.has(k) ? 1 : 0.05));
  return softmax(scores, 0.25);
}

// ---------------------------------------------------------------------------

function unfence(s) {
  return String(s ?? '').replace(/<<<[^\n]*\n?/, '').replace(/\n?>>>\s*$/, '');
}

/**
 * Answer a question set against a state. Same signature and same answer shapes
 * as the hosted model, so nothing above this layer knows which one ran.
 */
export function answer({ state, questions }) {
  const offerText = unfence(state.contributor_text ?? state.text ?? '');
  const extracted = state.extracted_by_code ?? {};
  const candidates = state.candidate_needs ?? state.candidate_capabilities ?? [];
  const candMeta = new Map(candidates.map((c) => [c.id, {
    text: c.need ?? c.capability ?? '', kind: c.kind ?? null, unit: c.unit ?? null,
  }]));
  const offerLang = extracted.language ?? null;
  const crossOf = (id) => {
    const c = candidates.find((x) => x.id === id);
    return !!(offerLang && c?.language && c.language !== offerLang);
  };
  const needText = state.need?.description ?? state.need_text ?? '';
  const probe = state.need ? `${state.need.kind ?? ''} ${needText}` : offerText;
  const idf = idfOver([...[...candMeta.values()].map((c) => c.text), probe]);

  const answers = {};
  for (const [qid, q] of Object.entries(questions)) {
    if (qid === 'is_offer') answers[qid] = { type: 'noul', noul: round(offerness(offerText, extracted)) };
    else if (qid === 'is_question') answers[qid] = { type: 'noul', noul: round(questionness(offerText)) };
    else if (qid === 'is_adversarial') answers[qid] = { type: 'noul', noul: round(adversarialness(offerText)) };
    else if (qid === 'is_withdrawal') answers[qid] = { type: 'noul', noul: round(withdrawalness(offerText)) };
    else if (qid === 'which_need') {
      const opts = Object.keys(q.criteria);
      const scores = opts.map((o) => (o === 'none' ? 0.30 : matchScore(offerText, candMeta.get(o) ?? { text: q.criteria[o] }, idf, extracted, crossOf(o))));
      const probs = softmax(scores);
      const best = opts[probs.indexOf(Math.max(...probs))];
      answers[qid] = {
        type: 'choice', choice: best, confidence: round(concentration(probs)),
        probabilities: Object.fromEntries(opts.map((o, i) => [o, round(probs[i])])),
      };
    } else if (qid.startsWith('fits__')) {
      const cid = qid.slice(6);
      // A known weakness, stated rather than hidden: this engine's shortlist
      // pass is not independent of its ranking pass — both read the same
      // signals — so it cannot catch a confident wrong rank. Withholding the
      // unit evidence here to force independence was tried and measured, and
      // it cost more auto-decisions than it saved wrong binds on all three
      // scenarios, so it is not done. The two passes are genuinely independent
      // when the hosted model runs them, which is most of why it is worth the
      // second request.
      const s = matchScore(offerText, candMeta.get(cid) ?? { text: '' }, idf, extracted, crossOf(cid));
      answers[qid] = { type: 'noul', noul: round(logistic((s - 0.30) * 11)) };
    } else if (qid.startsWith('capfits__')) {
      const cid = qid.slice(9);
      const s = matchScore(probe, candMeta.get(cid) ?? { text: '' }, idf, extracted, crossOf(cid));
      answers[qid] = { type: 'noul', noul: round(logistic((s - 0.30) * 10)) };
    } else if (qid === 'specificity') {
      answers[qid] = scoreAnswer(specificityLevels(offerText, extracted), q.criteria);
    } else if (qid === 'same_resource') {
      answers[qid] = scoreAnswer(sameResourceLevels(state.a ?? '', state.b ?? ''), q.criteria);
    } else if (qid === 'need_is_concrete') {
      answers[qid] = { type: 'noul', noul: round(needConcrete(needText || offerText, extracted)) };
    } else if (qid === 'need_kind') {
      const probs = kindProbs(needText || offerText);
      const best = KINDS[probs.indexOf(Math.max(...probs))];
      answers[qid] = {
        type: 'choice', choice: best, confidence: round(concentration(probs)),
        probabilities: Object.fromEntries(KINDS.map((k, i) => [k, round(probs[i])])),
      };
    } else if (q.type === 'noul') answers[qid] = { type: 'noul', noul: 0.5 };
    else if (q.type === 'choice') {
      const opts = Object.keys(q.criteria);
      const probs = opts.map(() => 1 / opts.length);
      answers[qid] = {
        type: 'choice', choice: opts[0], confidence: 0,
        probabilities: Object.fromEntries(opts.map((o, i) => [o, round(probs[i])])),
      };
    } else answers[qid] = scoreAnswer(q.criteria.map(() => 1 / q.criteria.length), q.criteria);
  }
  return answers;
}

function scoreAnswer(probs, criteria) {
  const score = probs.reduce((a, p, i) => a + p * i, 0);
  return {
    type: 'score',
    score: round(score, 3),
    confidence: round(concentration(probs)),
    legend: Object.fromEntries(criteria.map((c, i) => [String(i), c])),
    probabilities: Object.fromEntries(probs.map((p, i) => [String(i), round(p)])),
  };
}

function round(x, d = 4) { return Math.round(x * 10 ** d) / 10 ** d; }

export { detectLanguage };
