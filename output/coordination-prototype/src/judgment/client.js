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

export async function systemOne({ state, questions, cfg, timeoutMs = 5000 }) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const wantHosted = cfg?.engine === 'typesafe';

  if (wantHosted && apiKey) {
    try {
      return await callHosted({ state, questions, model: cfg.model ?? 'jev-latest', apiKey, timeoutMs });
    } catch (err) {
      // The fallback is not decoration. It runs, it is recorded as having run,
      // and the harness reports its numbers separately.
      const out = callRules({ state, questions });
      out.engine = 'rules-fallback';
      out.fallback_reason = String(err.message ?? err).slice(0, 200);
      return out;
    }
  }
  return callRules({ state, questions });
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
        if (RETRY_STATUS.has(res.status) && attempt < 2) {
          lastErr = err;
          await sleep(180 * 2 ** attempt + Math.random() * 120);
          continue;
        }
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
      if (attempt >= 2) break;
      await sleep(180 * 2 ** attempt + Math.random() * 120);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error('typesafe: unknown failure');
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
