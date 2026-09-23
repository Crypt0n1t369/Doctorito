import { open, all } from '../db.js';
import { loadScenario, seedScenario } from '../seed.js';
import { admit } from '../pipeline/admit.js';
import { runOutbound } from '../pipeline/outbound.js';

/**
 * What would actually leave this machine, checked against two rules that do
 * not bend (docs/OUTCOMES.md, C6):
 *
 *   - contributor text is data, never instruction: it never appears in a
 *     question's wording;
 *   - a question names a candidate need only by its authored short form. The
 *     full description carries the credential and capacity clauses the
 *     question tells the model to ignore, and a model reading "must hold a
 *     valid certificate" judged eligibility from what writers claim about
 *     themselves — measured, on 18 September, as fits falling from 0.84 to 0.21.
 *
 * The earlier guard checked questions built from three candidates hard-coded
 * in the guard itself, so it could not see what the pipeline built from a real
 * catalogue; with the regression put back it still passed. This one scans the
 * questions the pipeline actually sent.
 */
export function scanQuestions(questions, { needs = [], capabilities = [], contributorTexts = [] } = {}) {
  const problems = [];
  // Text a builder is allowed to put in a question. Contributors often echo the
  // catalogue ("a letter of support on municipal letterhead"), so a phrase they
  // share with it is not a leak; a phrase found only in their message is.
  //
  // Capability descriptions count as legitimate because today every one comes
  // from a pack the convener authored. When contributors can declare their own
  // (Stage 1), that text is untrusted and must move into fenced state, with the
  // question naming only a convener-authored label — see docs/DECISIONS.md.
  const legitimate = [
    ...needs.flatMap((n) => [n.description, n.description_short]),
    ...capabilities.map((c) => c.description),
  ].filter(Boolean).join('\n');
  for (const [qid, q] of Object.entries(questions ?? {})) {
    const wording = `${q.instructions ?? ''} ${JSON.stringify(q.criteria ?? '')}`;
    for (const n of needs) {
      const full = String(n.description ?? '').trim();
      if (full.length > 60 && full !== String(n.description_short ?? '').trim() && wording.includes(full)) {
        problems.push(`question "${qid}" names a need by its full description instead of its short form: "${n.description_short}"`);
      }
    }
    for (const text of contributorTexts) {
      const frag = sharedRun(text, wording, legitimate);
      if (frag) problems.push(`question "${qid}" contains contributor text: "${frag}"`);
    }
  }
  return problems;
}

/** Five consecutive words of the message found in the wording and in no legitimate source. */
function sharedRun(text, wording, legitimate = '') {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  for (let i = 0; i + 5 <= words.length; i++) {
    const frag = words.slice(i, i + 5).join(' ');
    if (frag.length >= 20 && wording.includes(frag) && !legitimate.includes(frag)) return frag;
  }
  return null;
}

const BASE = new Date('2026-09-20T08:00:00Z');

/**
 * Run a scenario's traffic and its outbound pass through the real pipeline,
 * locally and without spending anything, and scan every question that was
 * built. The rules engine answers; the questions are the same ones a hosted
 * engine would have received.
 */
export async function scanScenario(slug, dir = 'scenarios') {
  const saved = process.env.JUDGMENT_ENGINE;
  process.env.JUDGMENT_ENGINE = 'rules';
  const db = open(':memory:');
  try {
    const scenario = loadScenario(slug, dir);
    const { initiative } = seedScenario(db, {
      ...scenario, config: { ...(scenario.config ?? {}), engine: 'rules', rate_per_minute: 1e6 },
    });
    const traffic = scenario.traffic ?? [];
    for (const m of traffic) {
      await admit(db, {
        initiative, channel: m.channel ?? 'web', handle: m.handle ?? 'web:guard', displayName: m.name,
        text: m.text, now: new Date(BASE.getTime() + (m.at_offset_minutes ?? 0) * 60_000),
      });
    }
    await runOutbound(db, { initiative, now: new Date(Date.now() + 3 * 86400e3) });

    const needs = all(db, 'select description, description_short from needs where initiative_id=?', initiative.initiative_id);
    const capabilities = all(db, 'select description from capabilities where initiative_id=?', initiative.initiative_id);
    const contributorTexts = traffic.map((m) => m.text);
    const judgments = all(db, 'select pass, request from judgments');
    let questions = 0;
    const problems = [];
    for (const j of judgments) {
      const qs = JSON.parse(j.request ?? '{}').questions ?? {};
      questions += Object.keys(qs).length;
      for (const p of scanQuestions(qs, { needs, capabilities, contributorTexts })) problems.push(`${slug} ${j.pass}: ${p}`);
    }
    return { slug, judgments: judgments.length, questions, problems: [...new Set(problems)] };
  } finally {
    db.close();
    if (saved === undefined) delete process.env.JUDGMENT_ENGINE; else process.env.JUDGMENT_ENGINE = saved;
  }
}
