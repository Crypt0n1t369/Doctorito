import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { one, run } from '../db.js';
import { STYLESHEET } from './views.js';
import * as pages from './pages.js';

/**
 * One application process, server-rendered pages, magic links instead of
 * passwords, no framework. Boring on purpose: the interesting parts of this
 * system are the ledger and the gate, and neither is helped by a router.
 */

// Prototype authentication. A shared key printed at startup, a signed cookie,
// a session row. A real deployment puts an identity provider in front of this
// and keeps the rest; nothing in the architecture depends on which one.
const SECRET = process.env.SESSION_SECRET || randomBytes(24).toString('hex');
export const COORDINATOR_KEY = process.env.COORDINATOR_KEY || randomBytes(9).toString('hex');

const ROUTES = [
  ['GET', /^\/$/, pages.index],
  ['GET', /^\/style\.css$/, styleSheet],
  ['GET', /^\/login$/, login],
  ['GET', /^\/logout$/, logout],

  ['GET', /^\/i\/([\w-]+)$/, pages.initiative],
  ['GET', /^\/i\/([\w-]+)\/offer$/, pages.offerForm],
  ['POST', /^\/i\/([\w-]+)\/offer$/, pages.offerSubmit],
  ['GET', /^\/i\/([\w-]+)\/needs$/, pages.needEditor, 'coordinator'],
  ['POST', /^\/i\/([\w-]+)\/needs$/, pages.needCreate, 'coordinator'],
  ['POST', /^\/i\/([\w-]+)\/needs\/([\w-]+)\/amend$/, pages.needAmend, 'coordinator'],
  ['POST', /^\/i\/([\w-]+)\/needs\/([\w-]+)\/close$/, pages.needClose, 'coordinator'],
  ['GET', /^\/i\/([\w-]+)\/need\/([\w-]+)$/, pages.needPage],

  ['POST', /^\/webhook\/(email|telegram)$/, pages.webhook],

  ['GET', /^\/c\/([\w]+)$/, pages.contributor],
  ['POST', /^\/c\/([\w]+)\/(confirm|withdraw)$/, pages.contributorAction],
  ['GET', /^\/take\/([\w]+)$/, pages.take],

  ['GET', /^\/q$/, pages.queue, 'coordinator'],
  ['GET', /^\/q\/([\w-]+)$/, pages.queue, 'coordinator'],
  ['POST', /^\/q\/([\w]+)\/action$/, pages.queueAction, 'coordinator'],

  ['GET', /^\/admin\/([\w-]+)$/, pages.admin, 'coordinator'],
  ['POST', /^\/admin\/([\w-]+)\/autobind$/, pages.adminAutobind, 'coordinator'],

  ['GET', /^\/j\/([\w]+)$/, pages.judgment],
  ['GET', /^\/a\/([\w]+)$/, pages.actor],
  ['GET', /^\/outbox$/, pages.outbox],
  ['GET', /^\/events$/, pages.events],
];

export function createApp(db, { baseUrl = 'http://localhost:8787' } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, baseUrl);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    let match = null;
    for (const [method, pattern, handler, role] of ROUTES) {
      const m = pattern.exec(path);
      if (m) { match = { method, handler, role, params: m.slice(1) }; if (method === req.method) break; }
    }
    if (!match) return send(res, 404, 'text/plain; charset=utf-8', 'Not found.');
    if (match.method !== req.method) return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed.');

    const session = sessionOf(db, req);
    if (match.role && session?.role !== match.role) {
      return redirect(res, `/login?next=${encodeURIComponent(req.url)}`);
    }

    let body = {};
    try {
      if (req.method === 'POST') body = await readBody(req);
    } catch (err) {
      return send(res, 400, 'text/plain; charset=utf-8', `Bad request: ${err.message}`);
    }

    const ctx = { db, req, res, url, query: url.searchParams, params: match.params, body, session, baseUrl, send, redirect };
    try {
      const out = await match.handler(ctx);
      if (res.writableEnded) return;
      if (typeof out === 'string') return send(res, 200, 'text/html; charset=utf-8', out);
      if (out && typeof out === 'object') return send(res, out.status ?? 200, out.type ?? 'text/html; charset=utf-8', out.body ?? '');
    } catch (err) {
      console.error(`${req.method} ${path}:`, err);
      if (!res.writableEnded) send(res, 500, 'text/plain; charset=utf-8', `Something broke: ${err.message}`);
    }
  });
}

// --- plumbing --------------------------------------------------------------

function styleSheet(ctx) {
  ctx.res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=60' });
  ctx.res.end(STYLESHEET);
}

function login(ctx) {
  const key = ctx.query.get('key') ?? '';
  const next = ctx.query.get('next') || '/q';
  if (!constantEquals(key, COORDINATOR_KEY)) {
    return send(ctx.res, 401, 'text/html; charset=utf-8',
      `<!doctype html><meta charset="utf-8"><title>Sign in</title>
       <p style="font:16px/1.6 system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem">
       This page needs the coordinator link. It is printed in the server's output when it starts.</p>`);
  }
  const sid = randomBytes(18).toString('hex');
  run(ctx.db, 'insert into sessions (sid, role, name, created_at) values (?,?,?,?)',
    sid, 'coordinator', process.env.COORDINATOR_NAME || 'coordinator', new Date().toISOString());
  ctx.res.setHeader('set-cookie', `sid=${sign(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
  return redirect(ctx.res, next);
}

function logout(ctx) {
  const sid = unsign(cookies(ctx.req).sid);
  if (sid) run(ctx.db, 'delete from sessions where sid=?', sid);
  ctx.res.setHeader('set-cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return redirect(ctx.res, '/');
}

function sessionOf(db, req) {
  const sid = unsign(cookies(req).sid);
  if (!sid) return null;
  return one(db, 'select * from sessions where sid=?', sid);
}

function sign(v) { return `${v}.${createHmac('sha256', SECRET).update(v).digest('hex').slice(0, 32)}`; }
function unsign(v) {
  if (!v) return null;
  const i = String(v).lastIndexOf('.');
  if (i < 0) return null;
  const body = String(v).slice(0, i);
  return constantEquals(sign(body), String(v)) ? body : null;
}
function constantEquals(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 512 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = String(req.headers['content-type'] ?? '');
      try {
        if (type.includes('application/json')) return resolve(raw ? JSON.parse(raw) : {});
        const params = new URLSearchParams(raw);
        resolve(Object.fromEntries(params));
      } catch (err) {
        reject(new Error(`could not read the body: ${err.message}`));
      }
    });
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function redirect(res, to) {
  res.writeHead(303, { location: to });
  res.end();
}
