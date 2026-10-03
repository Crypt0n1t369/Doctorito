import { invariant, MissionError } from './errors.js';
import { identifier, receiptToken, sha256, stableStringify } from './validation.js';

function actorConfig(actor) {
  invariant(actor && typeof actor === 'object', 'unauthorized', 'actor context is required');
  if (actor.kind === 'bearer') {
    return { kind: 'bearer', principal: '', receiptHash: sha256(receiptToken(actor.token)) };
  }
  if (actor.kind === 'public') {
    return { kind: 'public', principal: 'public', receiptHash: '' };
  }
  invariant(actor.kind === 'principal', 'unauthorized', 'actor context is invalid');
  return { kind: 'principal', principal: identifier(actor.id, 'principal id'), receiptHash: '' };
}

export class Spine {
  constructor(pool) {
    invariant(pool && typeof pool.connect === 'function', 'invalid_input', 'a PostgreSQL pool is required');
    this.pool = pool;
  }

  async inScope(meta, work, { command = false } = {}) {
    const mission = identifier(meta.mission, 'mission');
    const actor = actorConfig(meta.actor);
    const idempotencyKey = command ? identifier(meta.idempotencyKey, 'idempotency key') : '';
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        // The deployment login must be a member of this non-owner role. The gateway,
        // not user input, creates meta.actor and meta.mission after authentication.
        await client.query('SET LOCAL ROLE mission_spine_app');
        await client.query('SET LOCAL search_path = mission_spine, public');
        await client.query(
          "SELECT set_config('app.mission_id',$1,true), set_config('app.principal_id',$2,true), set_config('app.receipt_hash',$3,true), set_config('app.idempotency_key',$4,true)",
          [mission, actor.principal, actor.receiptHash, idempotencyKey]
        );
        const value = await work(client, { mission, actor, idempotencyKey });
        await client.query('COMMIT');
        return value;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* original error wins */ }
        lastError = error;
        if (!['40001', '40P01', '23505'].includes(error.code) || attempt === 2) throw error;
      } finally {
        client.release();
      }
    }
    throw lastError;
  }

  async command(meta, action, body, work) {
    identifier(action, 'action');
    invariant(meta.actor?.kind !== 'public', 'unauthorized', 'public context cannot issue commands');
    return this.inScope(meta, async (tx, scope) => {
      const requestHash = sha256(stableStringify({ action, body, actor: scope.actor }));
      const prior = await tx.query(
        'SELECT action, request_hash, response FROM command_dedupe WHERE mission_id=$1 AND idempotency_key=$2',
        [scope.mission, scope.idempotencyKey]
      );
      if (prior.rowCount) {
        invariant(prior.rows[0].action === action && prior.rows[0].request_hash === requestHash,
          'idempotency_conflict', 'idempotency key was used for a different request');
        return prior.rows[0].response;
      }
      const change = await work(tx, scope);
      invariant(change && change.response && change.subjectKind && change.subjectId,
        'internal_error', 'command did not return a transition');
      const auditActorKind = scope.actor.kind === 'bearer' ? 'bearer' : 'human';
      await tx.query(
        `INSERT INTO audit (mission_id,command_id,actor_id,actor_kind,action,authority_ref,
          subject_kind,subject_id,plan_version,source_refs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [scope.mission, scope.idempotencyKey, scope.actor.principal || null, auditActorKind,
          action, change.authorityRef || 'self-submission', change.subjectKind, change.subjectId,
          change.planVersion ?? null, JSON.stringify(change.sourceRefs || [])]
      );
      await tx.query(
        `INSERT INTO outbox (mission_id,id,command_id,kind,subject_kind,subject_id,recipient_principal,source_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [scope.mission, `effect:${scope.idempotencyKey}`, scope.idempotencyKey,
          change.effectKind || 'state_changed', change.subjectKind, change.subjectId,
          change.recipientPrincipal || null, change.sourceId || null]
      );
      await tx.query(
        'INSERT INTO command_dedupe (mission_id,idempotency_key,action,request_hash,response) VALUES ($1,$2,$3,$4,$5)',
        [scope.mission, scope.idempotencyKey, action, requestHash, JSON.stringify(change.response)]
      );
      return change.response;
    }, { command: true });
  }

  async read(meta, work) { return this.inScope(meta, work); }
}

export async function requireHuman(tx, actor) {
  invariant(actor.kind === 'principal', 'unauthorized', 'authenticated principal required');
  const row = await tx.query('SELECT kind,verified FROM principal WHERE id=$1', [actor.principal]);
  invariant(row.rowCount && row.rows[0].kind === 'human' && row.rows[0].verified,
    'unauthorized', 'verified human principal required');
}

export async function requireMandate(tx, mission, actor, action) {
  await requireHuman(tx, actor);
  const row = await tx.query(
    `SELECT id FROM mandate WHERE mission_id=$1 AND principal_id=$2 AND action=$3
      AND revoked_at IS NULL AND (valid_until IS NULL OR valid_until > now())`,
    [mission, actor.principal, action]
  );
  invariant(row.rowCount, 'forbidden', `active ${action} mandate required`);
  return row.rows[0].id;
}

export async function planAt(tx, mission, expectedVersion, { active = false } = {}) {
  const row = await tx.query('SELECT plan_version,status FROM mission WHERE id=$1 FOR UPDATE', [mission]);
  invariant(row.rowCount, 'not_found', 'mission not found');
  invariant(Number.isInteger(expectedVersion), 'invalid_input', 'expected plan version is required');
  invariant(row.rows[0].plan_version === expectedVersion, 'version_conflict',
    'mission plan changed; reload its current revision',
    { expectedVersion, currentVersion: row.rows[0].plan_version });
  if (active) invariant(row.rows[0].status === 'active', 'mission_paused', 'mission is not accepting new obligations');
  return row.rows[0];
}

export async function sourceReadGrant(tx, mission, sourceId, grantee, purpose, action, provider = 'none', right = 'allow_read') {
  invariant(['allow_read', 'allow_process', 'allow_publish', 'allow_train'].includes(right),
    'invalid_input', 'invalid source right');
  const row = await tx.query(
    `SELECT id FROM source_grant WHERE mission_id=$1 AND source_id=$2 AND grantee=$3
      AND purpose=$4 AND action=$5 AND provider=$6 AND ${right}
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`,
    [mission, sourceId, grantee, purpose, action, provider]
  );
  invariant(row.rowCount, 'forbidden', `${right} grant required for ${purpose}/${action}/${provider}`);
  return row.rows[0].id;
}

export function asMissionError(error) {
  if (error instanceof MissionError) return error;
  if (error?.code === '23503') return new MissionError('invalid_reference', 'referenced record is missing or outside this mission');
  if (error?.code === '23505') return new MissionError('conflict', 'record or idempotency key already exists');
  return error;
}
