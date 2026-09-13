/* Storage. One SQLite file plus a directory of rendered audio.
 *
 * Rendered WAVs live on disk rather than in the database so they can be
 * streamed and swept on a TTL without rewriting table pages.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import crypto from "node:crypto";

export const SCHEMA_VERSION = 1;

export function openDatabase({ file = "data/cicada.db", audioDir = "data/audio" } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  mkdirSync(audioDir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return new Store(db, audioDir);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL DEFAULT '',
      plan        TEXT NOT NULL DEFAULT 'free',
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      prefix      TEXT NOT NULL,
      hash        TEXT NOT NULL UNIQUE,
      label       TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS api_keys_account ON api_keys(account_id);

    CREATE TABLE IF NOT EXISTS channels (
      id           TEXT PRIMARY KEY,
      account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      num          INTEGER NOT NULL,
      name         TEXT NOT NULL,
      signed       INTEGER NOT NULL DEFAULT 0,
      receive_token TEXT NOT NULL UNIQUE,
      created_at   INTEGER NOT NULL,
      UNIQUE (account_id, num)
    );

    CREATE TABLE IF NOT EXISTS channel_keys (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      key_id      INTEGER NOT NULL,
      public_pem  TEXT NOT NULL,
      private_pem TEXT NOT NULL,
      public_raw  TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      retired_at  INTEGER,
      UNIQUE (channel_id, key_id)
    );

    CREATE TABLE IF NOT EXISTS cards (
      id           TEXT PRIMARY KEY,
      channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      code         INTEGER NOT NULL,
      label        TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT 'application/json',
      payload      BLOB NOT NULL,
      version      INTEGER NOT NULL DEFAULT 1,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      UNIQUE (channel_id, code)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL,
      severity    TEXT NOT NULL DEFAULT 'info',
      slots       TEXT NOT NULL,
      text        TEXT NOT NULL,
      label       TEXT NOT NULL DEFAULT '',
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      UNIQUE (channel_id, template_id)
    );

    CREATE TABLE IF NOT EXISTS lists (
      id         TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      entries    TEXT NOT NULL,
      version    INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      UNIQUE (channel_id, name)
    );

    CREATE TABLE IF NOT EXISTS transmissions (
      id          TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      channel_id  TEXT REFERENCES channels(id) ON DELETE SET NULL,
      channel_num INTEGER NOT NULL DEFAULT 0,
      profile     TEXT NOT NULL,
      repeats     INTEGER NOT NULL,
      signed      INTEGER NOT NULL DEFAULT 0,
      card_code   INTEGER,
      body_bytes  INTEGER NOT NULL,
      frames      INTEGER NOT NULL,
      seconds     REAL NOT NULL,
      audio_bytes INTEGER NOT NULL,
      audio_path  TEXT NOT NULL,
      label       TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS tx_account ON transmissions(account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS tx_expiry ON transmissions(expires_at);

    CREATE TABLE IF NOT EXISTS usage (
      account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      period      TEXT NOT NULL,
      metric      TEXT NOT NULL,
      count       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, period, metric)
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id              TEXT PRIMARY KEY,
      account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      channel_id      TEXT REFERENCES channels(id) ON DELETE CASCADE,
      transmission_id TEXT,
      device          TEXT NOT NULL DEFAULT '',
      outcome         TEXT NOT NULL DEFAULT 'decoded',
      latency_ms      INTEGER,
      detail          TEXT NOT NULL DEFAULT '{}',
      created_at      INTEGER NOT NULL,
      expires_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS receipts_account ON receipts(account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS receipts_expiry ON receipts(expires_at);
  `);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
}

const now = () => Date.now();
export const newId = (prefix) => `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

export class Store {
  constructor(db, audioDir) {
    this.db = db;
    this.audioDir = audioDir;
  }

  close() { this.db.close(); }

  // ------------------------------------------------------------- accounts
  createAccount({ email, name = "", plan = "free" }) {
    const id = newId("acct");
    this.db.prepare("INSERT INTO accounts (id, email, name, plan, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, email, name, plan, now());
    return this.getAccount(id);
  }
  getAccount(id) { return this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) ?? null; }
  getAccountByEmail(email) { return this.db.prepare("SELECT * FROM accounts WHERE email = ?").get(email) ?? null; }
  setPlan(id, plan) { this.db.prepare("UPDATE accounts SET plan = ? WHERE id = ?").run(plan, id); }

  // -------------------------------------------------------------- api keys
  /** Returns the secret exactly once; only its hash is stored. */
  createApiKey(accountId, label = "", live = true) {
    const secret = `ck_${live ? "live" : "test"}_${crypto.randomBytes(18).toString("base64url")}`;
    const id = newId("key");
    this.db.prepare("INSERT INTO api_keys (id, account_id, prefix, hash, label, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, accountId, secret.slice(0, 16), sha256(secret), label, now());
    return { id, secret, prefix: secret.slice(0, 16), label };
  }
  findApiKey(secret) {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE hash = ? AND revoked_at IS NULL").get(sha256(secret));
    if (row) this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(now(), row.id);
    return row ?? null;
  }
  listApiKeys(accountId) {
    return this.db.prepare(
      "SELECT id, prefix, label, created_at, last_used_at, revoked_at FROM api_keys WHERE account_id = ? ORDER BY created_at DESC"
    ).all(accountId);
  }
  revokeApiKey(accountId, id) {
    const r = this.db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL")
      .run(now(), id, accountId);
    return r.changes > 0;
  }

  // -------------------------------------------------------------- channels
  createChannel(accountId, { name, signed = false, num = null }) {
    const chosen = num ?? this.#nextChannelNum(accountId);
    const id = newId("ch");
    const token = `rk_${crypto.randomBytes(18).toString("base64url")}`;
    this.db.prepare(
      "INSERT INTO channels (id, account_id, num, name, signed, receive_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, accountId, chosen, name, signed ? 1 : 0, token, now());
    return this.getChannel(accountId, id);
  }
  #nextChannelNum(accountId) {
    const row = this.db.prepare("SELECT COALESCE(MAX(num), 0) AS m FROM channels WHERE account_id = ?").get(accountId);
    const next = Number(row.m) + 1;
    if (next > 0xffff) throw new Error("channel numbers exhausted for this account");
    return next;
  }
  getChannel(accountId, id) {
    return this.db.prepare("SELECT * FROM channels WHERE id = ? AND account_id = ?").get(id, accountId) ?? null;
  }
  getChannelByToken(token) {
    return this.db.prepare("SELECT * FROM channels WHERE receive_token = ?").get(token) ?? null;
  }
  listChannels(accountId) {
    return this.db.prepare("SELECT * FROM channels WHERE account_id = ? ORDER BY num").all(accountId);
  }
  countChannels(accountId) {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM channels WHERE account_id = ?").get(accountId).n);
  }
  deleteChannel(accountId, id) {
    return this.db.prepare("DELETE FROM channels WHERE id = ? AND account_id = ?").run(id, accountId).changes > 0;
  }

  // ----------------------------------------------------------- signing keys
  addChannelKey(channelId, { keyId, publicPem, privatePem, publicRaw }) {
    const id = newId("sk");
    this.db.prepare(
      "INSERT INTO channel_keys (id, channel_id, key_id, public_pem, private_pem, public_raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, channelId, keyId, publicPem, privatePem, publicRaw, now());
    return id;
  }
  activeChannelKey(channelId) {
    return this.db.prepare(
      "SELECT * FROM channel_keys WHERE channel_id = ? AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1"
    ).get(channelId) ?? null;
  }
  listChannelKeys(channelId) {
    return this.db.prepare("SELECT * FROM channel_keys WHERE channel_id = ? ORDER BY created_at DESC").all(channelId);
  }
  retireChannelKeys(channelId) {
    this.db.prepare("UPDATE channel_keys SET retired_at = ? WHERE channel_id = ? AND retired_at IS NULL").run(now(), channelId);
  }
  nextKeyId(channelId) {
    const row = this.db.prepare("SELECT COALESCE(MAX(key_id), 0) AS m FROM channel_keys WHERE channel_id = ?").get(channelId);
    return Number(row.m) + 1;
  }

  // ------------------------------------------------------------------ cards
  upsertCard(channelId, { code, label = "", contentType = "application/json", payload }) {
    const t = now();
    const existing = this.db.prepare("SELECT id, version FROM cards WHERE channel_id = ? AND code = ?").get(channelId, code);
    if (existing) {
      this.db.prepare("UPDATE cards SET label = ?, content_type = ?, payload = ?, version = ?, updated_at = ? WHERE id = ?")
        .run(label, contentType, payload, Number(existing.version) + 1, t, existing.id);
      return this.getCard(channelId, code);
    }
    this.db.prepare(
      "INSERT INTO cards (id, channel_id, code, label, content_type, payload, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
    ).run(newId("card"), channelId, code, label, contentType, payload, t, t);
    return this.getCard(channelId, code);
  }
  getCard(channelId, code) {
    return this.db.prepare("SELECT * FROM cards WHERE channel_id = ? AND code = ?").get(channelId, code) ?? null;
  }
  listCards(channelId) {
    return this.db.prepare("SELECT * FROM cards WHERE channel_id = ? ORDER BY code").all(channelId);
  }
  countCards(accountId) {
    return Number(this.db.prepare(
      "SELECT COUNT(*) AS n FROM cards JOIN channels ON channels.id = cards.channel_id WHERE channels.account_id = ?"
    ).get(accountId).n);
  }
  deleteCard(channelId, code) {
    return this.db.prepare("DELETE FROM cards WHERE channel_id = ? AND code = ?").run(channelId, code).changes > 0;
  }
  nextCardCode(channelId) {
    const row = this.db.prepare("SELECT COALESCE(MAX(code), 0) AS m FROM cards WHERE channel_id = ?").get(channelId);
    return Number(row.m) + 1;
  }

  // ----------------------------------------------------------- transmissions
  createTransmission(accountId, rec, audioBytes) {
    const id = newId("tx");
    const path = join(this.audioDir, `${id}.wav`);
    writeFileSync(path, audioBytes);
    this.db.prepare(`
      INSERT INTO transmissions
        (id, account_id, channel_id, channel_num, profile, repeats, signed, card_code,
         body_bytes, frames, seconds, audio_bytes, audio_path, label, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, accountId, rec.channelId ?? null, rec.channelNum ?? 0, rec.profile, rec.repeats,
           rec.signed ? 1 : 0, rec.cardCode ?? null, rec.bodyBytes, rec.frames, rec.seconds,
           audioBytes.length, path, rec.label ?? "", now(), rec.expiresAt ?? null);
    return this.getTransmission(accountId, id);
  }
  getTransmission(accountId, id) {
    return this.db.prepare("SELECT * FROM transmissions WHERE id = ? AND account_id = ?").get(id, accountId) ?? null;
  }
  getTransmissionAnyAccount(id) {
    return this.db.prepare("SELECT * FROM transmissions WHERE id = ?").get(id) ?? null;
  }
  readTransmissionAudio(row) {
    if (!existsSync(row.audio_path)) return null;
    return readFileSync(row.audio_path);
  }
  listTransmissions(accountId, limit = 50) {
    return this.db.prepare("SELECT * FROM transmissions WHERE account_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(accountId, limit);
  }
  deleteTransmission(accountId, id) {
    const row = this.getTransmission(accountId, id);
    if (!row) return false;
    try { if (existsSync(row.audio_path)) unlinkSync(row.audio_path); } catch { /* the sweep will retry */ }
    this.db.prepare("DELETE FROM transmissions WHERE id = ?").run(id);
    return true;
  }

  // -------------------------------------------------------------- templates
  upsertTemplate(channelId, t) {
    const now_ = now();
    const slots = JSON.stringify(t.slots ?? []);
    const text = JSON.stringify(t.text ?? {});
    const existing = this.db.prepare(
      "SELECT id, version FROM templates WHERE channel_id = ? AND template_id = ?").get(channelId, t.id);
    if (existing) {
      this.db.prepare(`UPDATE templates SET severity = ?, slots = ?, text = ?, label = ?,
                       version = ?, updated_at = ? WHERE id = ?`)
        .run(t.severity ?? "info", slots, text, t.label ?? "", Number(existing.version) + 1, now_, existing.id);
    } else {
      this.db.prepare(`INSERT INTO templates
          (id, channel_id, template_id, severity, slots, text, label, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(newId("tpl"), channelId, t.id, t.severity ?? "info", slots, text, t.label ?? "", now_, now_);
    }
    return this.getTemplate(channelId, t.id);
  }
  #hydrateTemplate(row) {
    if (!row) return null;
    return {
      id: Number(row.template_id),
      severity: row.severity,
      slots: JSON.parse(row.slots),
      text: JSON.parse(row.text),
      label: row.label,
      version: Number(row.version),
      updatedAt: Number(row.updated_at),
    };
  }
  getTemplate(channelId, templateId) {
    return this.#hydrateTemplate(this.db.prepare(
      "SELECT * FROM templates WHERE channel_id = ? AND template_id = ?").get(channelId, templateId));
  }
  listTemplates(channelId) {
    return this.db.prepare("SELECT * FROM templates WHERE channel_id = ? ORDER BY template_id")
      .all(channelId).map(r => this.#hydrateTemplate(r));
  }
  countTemplates(accountId) {
    return Number(this.db.prepare(
      "SELECT COUNT(*) AS n FROM templates JOIN channels ON channels.id = templates.channel_id WHERE channels.account_id = ?"
    ).get(accountId).n);
  }
  deleteTemplate(channelId, templateId) {
    return this.db.prepare("DELETE FROM templates WHERE channel_id = ? AND template_id = ?")
      .run(channelId, templateId).changes > 0;
  }
  nextTemplateId(channelId) {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(template_id), 0) AS m FROM templates WHERE channel_id = ?").get(channelId);
    return Number(row.m) + 1;
  }

  // ------------------------------------------------------------------ lists
  upsertList(channelId, name, entries) {
    const now_ = now();
    const json = JSON.stringify(entries);
    const existing = this.db.prepare("SELECT id, version FROM lists WHERE channel_id = ? AND name = ?")
      .get(channelId, name);
    if (existing) {
      this.db.prepare("UPDATE lists SET entries = ?, version = ?, updated_at = ? WHERE id = ?")
        .run(json, Number(existing.version) + 1, now_, existing.id);
    } else {
      this.db.prepare("INSERT INTO lists (id, channel_id, name, entries, version, updated_at) VALUES (?, ?, ?, ?, 1, ?)")
        .run(newId("lst"), channelId, name, json, now_);
    }
    return this.getList(channelId, name);
  }
  getList(channelId, name) {
    const row = this.db.prepare("SELECT * FROM lists WHERE channel_id = ? AND name = ?").get(channelId, name);
    return row ? { name: row.name, entries: JSON.parse(row.entries), version: Number(row.version) } : null;
  }
  listLists(channelId) {
    return this.db.prepare("SELECT * FROM lists WHERE channel_id = ? ORDER BY name").all(channelId)
      .map(r => ({ name: r.name, entries: JSON.parse(r.entries), version: Number(r.version) }));
  }
  deleteList(channelId, name) {
    return this.db.prepare("DELETE FROM lists WHERE channel_id = ? AND name = ?").run(channelId, name).changes > 0;
  }

  // ------------------------------------------------------------------ usage
  bumpUsage(accountId, metric, by = 1, period) {
    this.db.prepare(`
      INSERT INTO usage (account_id, period, metric, count) VALUES (?, ?, ?, ?)
      ON CONFLICT (account_id, period, metric) DO UPDATE SET count = count + excluded.count
    `).run(accountId, period, metric, by);
  }
  getUsage(accountId, period) {
    const rows = this.db.prepare("SELECT metric, count FROM usage WHERE account_id = ? AND period = ?").all(accountId, period);
    return Object.fromEntries(rows.map(r => [r.metric, Number(r.count)]));
  }
  usageFor(accountId, period, metric) {
    const row = this.db.prepare("SELECT count FROM usage WHERE account_id = ? AND period = ? AND metric = ?")
      .get(accountId, period, metric);
    return row ? Number(row.count) : 0;
  }

  // --------------------------------------------------------------- receipts
  addReceipt(rec) {
    const id = newId("rcpt");
    this.db.prepare(`
      INSERT INTO receipts (id, account_id, channel_id, transmission_id, device, outcome, latency_ms, detail, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, rec.accountId, rec.channelId ?? null, rec.transmissionId ?? null, rec.device ?? "",
           rec.outcome ?? "decoded", rec.latencyMs ?? null, JSON.stringify(rec.detail ?? {}), now(), rec.expiresAt ?? null);
    return id;
  }
  listReceipts(accountId, { channelId = null, limit = 100 } = {}) {
    return channelId
      ? this.db.prepare("SELECT * FROM receipts WHERE account_id = ? AND channel_id = ? ORDER BY created_at DESC LIMIT ?")
          .all(accountId, channelId, limit)
      : this.db.prepare("SELECT * FROM receipts WHERE account_id = ? ORDER BY created_at DESC LIMIT ?")
          .all(accountId, limit);
  }

  // ------------------------------------------------------------------ sweep
  /** Delete expired audio and receipts. Safe to call repeatedly. */
  sweep(at = now()) {
    let audio = 0, receipts = 0;
    for (const row of this.db.prepare("SELECT * FROM transmissions WHERE expires_at IS NOT NULL AND expires_at < ?").all(at)) {
      try { if (existsSync(row.audio_path)) { unlinkSync(row.audio_path); audio++; } } catch { /* retried next sweep */ }
      this.db.prepare("DELETE FROM transmissions WHERE id = ?").run(row.id);
    }
    receipts = this.db.prepare("DELETE FROM receipts WHERE expires_at IS NOT NULL AND expires_at < ?").run(at).changes;
    return { audio, receipts };
  }

  /** Bytes of rendered audio currently on disk for an account. */
  audioFootprint(accountId) {
    const rows = this.db.prepare("SELECT audio_path FROM transmissions WHERE account_id = ?").all(accountId);
    let total = 0;
    for (const r of rows) {
      try { total += statSync(r.audio_path).size; } catch { /* already swept */ }
    }
    return total;
  }
}
