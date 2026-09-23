import { answer as rulesAnswer, VERSION as RULES_VERSION } from './rules.js';

/**
 * One interface to the judgment model, with the hosted API behind it.
 *
 * Nothing above this file knows whether a hosted model or the local rules
 * engine produced an answer. That is deliberate: the model is a single-region
 * hosted API from a very new company, and a system that cannot fall back is a
 * system with one vendor's uptime written into its SLA.
 *
 * HTTP shape, from docs.typesafe.ai/api.md:
 *   POST https://api.typesafe.ai/v1/systemone
 *   Authorization: Bearer <key>
 *   { state, model, questions: { <id>: {type, instructions, criteria} } }
 *   -> { model, answers: { <id>: {...} }, usage: { input_tokens, output_tokens } }
 */
const ENDPOINT = process.env.TYPESAFE_ENDPOINT || 'https://api.typesafe.ai/v1/systemone';
const USD_PER_INPUT_TOKEN = 42 / 1e9;          // $42 per billion input tokens; output is free
const RETRY_STATUS = new Set([429, 529, 500, 502, 503, 504]);

export class CostCapExceeded extends Error {}

/** Our bookkeeping fields must not be sent. */
function wireQuestions(questions) {
  const out = {};
  for (const [k, q] of Object.entries(questions)) {
    const { about, ...rest } = q;
    out[k] = rest;
  }
  return out;
}

function estimateTokens(payload) {
  return Math.ceil(JSON.stringify(payload).length / 4);
}

/**
 * Answer a request, on the configured engine or not at all with its authority.
 *
 * An engine that was explicitly configured — the rules engine for a
 * deployment that sends nothing out, or the hosted model where the initiative
 * permits hosted processing — answers with the authority its thresholds were
 * validated for. Anything else is a fallback: the rules engine still answers,
 * so the offer can be triaged and shown to a person with a best guess, but the
 * result carries `degraded_cause` and nothing downstream may act on it alone
 * (docs/OUTCOMES.md, C4). A missing key, a refused request, an invalid answer
 * and a disallowed destination are all the same case: the configured engine
 * did not answer.
 */
export async function systemOne({ state, questions, cfg, timeoutMs = 5000 }) {
  if (cfg?.engine !== 'typesafe') return callRules({ state, questions });

  const degrade = (cause, spent = null) => ({
    ...callRules({ state, questions }),
    engine: 'rules-fallback',
    degraded_cause: cause,
    fallback_reason: cause,
    ...(spent ? { usage: spent.usage, cost_usd: spent.cost_usd } : {}),
  });

  // Processing with a hosted provider is its own permission (C1). Removing
  // names first reduces what is sent; it does not grant the right to send.
  if (cfg.hosted_processing !== true) return degrade('hosted_processing_not_permitted');
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) return degrade('missing_key');

  let out;
  try {
    out = await callHosted({ state, questions, model: cfg.model ?? 'jev-latest', apiKey, timeoutMs });
  } catch (err) {
    return degrade(`provider_error: ${String(err.message ?? err).slice(0, 160)}`);
  }
  const problem = validateAnswers(questions, out.answers);
  if (problem) return degrade(`invalid_response: ${problem}`, out);
  return out;
}

async function callHosted({ state, questions, model, apiKey, timeoutMs }) {
  const body = { state, model, questions: wireQuestions(questions) };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = process.hrtime.bigint();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`typesafe ${res.status}: ${text.slice(0, 160)}`);
        // A refused key or a malformed request will be refused again. Only an
        // overloaded or failing server is worth another attempt.
        err.retry = RETRY_STATUS.has(res.status);
        throw err;
      }
      const json = await res.json();
      const latency = Number(process.hrtime.bigint() - started) / 1e6;
      const inputTokens = json.usage?.input_tokens ?? estimateTokens(body);
      return {
        engine: 'typesafe',
        model_version: json.model ?? model,
        answers: json.answers,
        usage: json.usage ?? { input_tokens: inputTokens, output_tokens: 0 },
        latency_ms: Math.round(latency),
        cost_usd: inputTokens * USD_PER_INPUT_TOKEN,
      };
    } catch (err) {
      lastErr = err;
      if (err.retry === false || attempt >= 2) break;       // network errors and timeouts do retry
      await sleep(180 * 2 ** attempt + Math.random() * 120);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error('typesafe: unknown failure');
}

/**
 * Every answer is checked against the question that asked for it before
 * anything can act on it: present, of the asked type, naming only offered
 * options, with finite probabilities in range that add up. Returns a short
 * description of the first problem, or null.
 */
export function validateAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object') return 'no answers';
  const unit = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
  const distribution = (probs, allowed) => {
    if (!probs || typeof probs !== 'object') return 'no probabilities';
    let sum = 0;
    for (const [k, v] of Object.entries(probs)) {
      if (!allowed.has(String(k))) return `probability for an option that was not offered: ${k}`;
      if (!unit(v)) return `probability out of range for ${k}`;
      sum += v;
    }
    return Math.abs(sum - 1) <= 0.05 ? null : `probabilities sum to ${sum.toFixed(3)}`;
  };
  for (const [qid, q] of Object.entries(questions)) {
    const a = answers[qid];
    if (!a || typeof a !== 'object') return `${qid}: missing`;
    if (q.type === 'noul') {
      if (!unit(a.noul)) return `${qid}: noul out of range`;
    } else if (q.type === 'choice') {
      const options = new Set(Object.keys(q.criteria ?? {}));
      if (!options.has(String(a.choice))) return `${qid}: chose an option that was not offered`;
      if (a.confidence !== undefined && !unit(a.confidence)) return `${qid}: confidence out of range`;
      const bad = distribution(a.probabilities, options);
      if (bad) return `${qid}: ${bad}`;
    } else if (q.type === 'score') {
      const levels = Array.isArray(q.criteria) ? q.criteria.length : Object.keys(q.criteria ?? {}).length;
      if (!(typeof a.score === 'number' && Number.isFinite(a.score) && a.score >= 0 && a.score <= levels - 1)) return `${qid}: score out of range`;
      if (a.confidence !== undefined && !unit(a.confidence)) return `${qid}: confidence out of range`;
      const bad = distribution(a.probabilities, new Set(Array.from({ length: levels }, (_, i) => String(i))));
      if (bad) return `${qid}: ${bad}`;
    } else {
      return `${qid}: unknown question type ${q.type}`;
    }
  }
  return null;
}

function callRules({ state, questions }) {
  const started = process.hrtime.bigint();
  const answers = rulesAnswer({ state, questions });
  const latency = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    engine: 'rules',
    model_version: RULES_VERSION,
    answers,
    usage: { input_tokens: estimateTokens({ state, questions }), output_tokens: 0 },
    latency_ms: Math.round(latency * 100) / 100,
    cost_usd: 0,
  };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
