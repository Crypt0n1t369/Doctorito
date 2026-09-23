import { systemOne, CostCapExceeded } from './client.js';
import { VERSION as BANK_VERSION, BANK_HASH } from './questions.js';
import { emit } from '../events.js';
import { id, stateHash } from '../ids.js';
import { one } from '../db.js';

export { CostCapExceeded };

/**
 * Nothing acts before its judgment is written.
 *
 * This function is the only way to reach the model, and it writes the judgment
 * row before it returns. A caller therefore cannot act on an answer that is not
 * already on the record: the judgment id it needs in order to bind is produced
 * by the write.
 */
export async function ask(db, { initiative, offer = null, pass, state, questions, cfg }) {
  guardBudget(db, initiative, cfg);

  const res = await systemOne({ state, questions, cfg });

  const judgmentId = id('jd');
  emit(db, {
    type: 'judgment.written',
    initiative_id: initiative.initiative_id,
    author: 'system',
    payload: {
      judgment_id: judgmentId,
      offer_id: offer?.offer_id ?? null,
      initiative_id: initiative.initiative_id,
      pass,
      question_bank_version: `${BANK_VERSION}+${BANK_HASH}`,
      model_version: res.model_version,
      engine: res.engine,
      state_hash: stateHash(state),
      // The full request, so a bind can be reproduced and argued about a year
      // later, and so a threshold change can be evaluated against every
      // historical offer without calling the model again.
      request: { state, questions },
      answers: res.answers,
      confidence: null,
      latency_ms: res.latency_ms,
      input_tokens: res.usage.input_tokens,
      cost_usd: res.cost_usd,
    },
  });

  return { judgment_id: judgmentId, ...res };
}

/**
 * A flood degrades to queueing, not to spending. Per-initiative rate limit and
 * a hard daily cost cap, because the day this matters most is the day ten
 * thousand messages arrive at once.
 */
function guardBudget(db, initiative, cfg) {
  const day = new Date().toISOString().slice(0, 10);
  const row = one(db, 'select * from spend where initiative_id=? and day=?', initiative.initiative_id, day);
  if (row && row.cost_usd >= cfg.daily_cost_cap_usd) {
    throw new CostCapExceeded(`daily cost cap reached for ${initiative.slug}: $${row.cost_usd.toFixed(4)}`);
  }
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const recent = one(db,
    'select count(*) c from judgments where initiative_id=? and created_at > ?',
    initiative.initiative_id, minuteAgo).c;
  if (recent >= cfg.rate_per_minute) {
    throw new CostCapExceeded(`rate limit reached for ${initiative.slug}: ${recent}/min`);
  }
}
