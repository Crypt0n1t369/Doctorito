import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const SCHEMA = `
-- ---------------------------------------------------------------------------
-- The log. Append-only. Everything below it is a fold over this table and can
-- be dropped and rebuilt at any time (bin/replay.js does exactly that).
-- ---------------------------------------------------------------------------
create table if not exists events (
  seq           integer primary key autoincrement,
  event_id      text not null unique,
  initiative_id text,
  type          text not null,
  payload       text not null,
  author        text not null,
  reason        text,
  at            text not null,
  prev_hash     text not null,
  hash          text not null
);
create index if not exists events_initiative on events(initiative_id, seq);

-- ---------------------------------------------------------------------------
-- Derived. Never written except by the fold in src/events.js.
-- ---------------------------------------------------------------------------
create table if not exists decisions (
  decision_id text primary key,
  source      text,           -- decidim | council-minute | board-resolution | manual
  body        text,           -- the body that decided
  result      text,
  quorum      text,
  decided_at  text,
  provenance  text            -- json: external id, url, imported_at, importer
);

create table if not exists initiatives (
  initiative_id text primary key,
  slug          text unique,
  decision_id   text,
  title         text,
  objective     text,
  constraints   text,         -- json array
  window_start  text,
  window_end    text,
  place         text,
  geo_lat       real,
  geo_lon       real,
  owner_org     text,
  visibility    text,
  status        text,
  autobind      integer default 1,   -- the one switch, per initiative
  config        text,                -- json, see src/config.js
  created_at    text
);

create table if not exists needs (
  need_id           text primary key,
  initiative_id     text not null,
  kind              text,
  description       text,
  description_short text,      -- exists only for the wide ranking pass, <= 60 chars
  qty_required      real,
  qty_committed     real default 0,   -- DERIVED. sum of confirmed commitments.
  unit              text,
  window_start      text,
  window_end        text,
  geo_place         text,
  geo_lat           real,
  geo_lon           real,
  geo_radius_km     real,
  qualifications    text,      -- json array of credential codes
  risk_class        integer,
  allow_overcommit  integer default 0,
  status            text,      -- open | filled | closed
  language          text,
  published_at      text,
  last_ask_at       text
);
create index if not exists needs_initiative on needs(initiative_id, status);

create table if not exists actors (
  actor_id     text primary key,
  kind         text,           -- person | organisation
  display_name text,           -- stays here. never leaves for a judgment call.
  created_at   text
);

create table if not exists contacts (
  contact_id text primary key,
  actor_id   text not null,
  channel    text not null,
  handle     text not null,
  verified   integer default 0,
  unique(channel, handle)
);

create table if not exists credentials (
  credential_id text primary key,
  actor_id      text not null,
  code          text not null,
  issuer        text,
  verified_at   text,
  expires_at    text
);
create index if not exists credentials_actor on credentials(actor_id, code);

create table if not exists capabilities (
  capability_id    text primary key,
  actor_id         text not null,
  kind             text,
  description      text,
  quantity         real,
  unit             text,
  availability_start text,
  availability_end   text,
  geo_place        text,
  geo_lat          real,
  geo_lon          real,
  geo_radius_km    real,
  evidence         text,
  created_at       text
);

create table if not exists offers (
  offer_id      text primary key,
  initiative_id text,
  actor_id      text,
  raw_text      text not null,    -- verbatim. never rewritten, never re-used as instruction.
  channel       text,
  handle        text,
  attachments   text,
  language      text,
  extracted     text,             -- json, deterministic parsers only
  received_at   text,
  decided_at    text,
  state         text,             -- received | bound | queued | asked | answered | rejected | screened_out
  latency_ms    integer,
  shadow        integer default 0
);
create index if not exists offers_state on offers(initiative_id, state);

create table if not exists judgments (
  judgment_id           text primary key,
  offer_id              text,
  initiative_id         text,
  pass                  text,      -- wide | shortlist | outbound | editor | dedup
  question_bank_version text,
  model_version         text,
  engine                text,
  state_hash            text,
  request               text,      -- json: exactly what left this machine
  answers               text,      -- json: full distributions, not just the pick
  confidence            real,
  latency_ms            integer,
  input_tokens          integer,
  cost_usd              real,
  created_at            text
);
create index if not exists judgments_offer on judgments(offer_id);

create table if not exists commitments (
  commitment_id    text primary key,
  need_id          text not null,
  initiative_id    text not null,
  offer_id         text,
  actor_id         text,
  qty              real not null,
  confidence       real,
  bound_by         text,          -- auto | coordinator:<name> | actor | outbound
  judgment_id      text,          -- every commitment names its judgment
  state            text,          -- proposed | confirmed | withdrawn | expired | fulfilled | failed
  token            text unique,   -- the contributor's only credential
  lease_expires_at text,
  created_at       text,
  confirmed_at     text,
  ended_at         text
);
create index if not exists commitments_need on commitments(need_id, state);

create table if not exists fulfilments (
  fulfilment_id text primary key,
  commitment_id text not null,
  need_id       text not null,
  qty_delivered real,
  variance      real,
  evidence      text,
  verified_by   text,             -- never the actor themselves
  verified_at   text
);

create table if not exists overrides (
  override_id   text primary key,
  judgment_id   text,
  offer_id      text,
  coordinator   text,
  action        text,             -- bind | not_an_offer | ask | reject
  chosen_need_id text,
  model_need_id  text,
  agreed        integer,
  note          text,
  seconds_taken real,
  decided_at    text
);

create table if not exists asks (
  ask_id      text primary key,
  need_id     text,
  actor_id    text,
  channel     text,
  handle      text,
  body        text,
  judgment_id text,        -- the outbound ask names its judgment too
  confidence  real,
  sent_at     text,
  responded   integer default 0
);
create index if not exists asks_actor on asks(actor_id, sent_at);

create table if not exists outbox (
  message_id    text primary key,
  initiative_id text,
  actor_id      text,
  channel       text,
  handle        text,
  kind          text,
  body          text,
  sent_at       text
);

create table if not exists spend (
  initiative_id text not null,
  day           text not null,
  calls         integer default 0,
  cost_usd      real default 0,
  primary key (initiative_id, day)
);

create table if not exists sessions (
  sid        text primary key,
  role       text,
  name       text,
  created_at text
);

create table if not exists meta (k text primary key, v text);
`;

/** Derived tables, in the order the fold rebuilds them. events/meta/sessions are not derived. */
export const DERIVED = [
  'decisions', 'initiatives', 'needs', 'actors', 'contacts', 'credentials',
  'capabilities', 'offers', 'judgments', 'commitments', 'fulfilments',
  'overrides', 'asks', 'outbox', 'spend',
];

export function open(path = 'data/coordination.db') {
  const full = resolve(path);
  if (path !== ':memory:') mkdirSync(dirname(full), { recursive: true });
  const db = new DatabaseSync(path === ':memory:' ? ':memory:' : full);
  db.exec('pragma journal_mode = wal');
  db.exec('pragma foreign_keys = on');
  db.exec('pragma busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

/**
 * Serialise a unit of work. SQLite's BEGIN IMMEDIATE takes the write lock up
 * front, which is what stops two offers arriving 200 ms apart from both being
 * told yes for the last remaining place on a need.
 */
export function tx(db, fn) {
  db.exec('begin immediate');
  try {
    const out = fn();
    db.exec('commit');
    return out;
  } catch (e) {
    try { db.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
}

export function one(db, sql, ...params) {
  return db.prepare(sql).get(...params) ?? null;
}
export function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}
export function run(db, sql, ...params) {
  return db.prepare(sql).run(...params);
}
