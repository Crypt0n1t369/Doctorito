/* Cicada server: the v1 API plus the console, studio and receiver pages. */

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { openDatabase } from "./db.js";
import { buildApi } from "./api.js";
import { RateLimiter, sendError, send, HttpError, notFound } from "./http.js";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PUBLIC = join(ROOT, "public");
const MODEM = join(ROOT, "src", "modem");
const ANNOUNCE = join(ROOT, "src", "announce");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

export function createServer({
  dbFile = process.env.CICADA_DB || "data/cicada.db",
  audioDir = process.env.CICADA_AUDIO || "data/audio",
  rateLimit = { windowMs: 60_000, max: 600 },
} = {}) {
  const store = openDatabase({ file: dbFile, audioDir });
  const limiter = new RateLimiter(rateLimit);
  const api = buildApi({ store, limiter });

  const server = http.createServer(async (req, res) => {
    const requestId = crypto.randomBytes(8).toString("hex");
    res.setHeader("x-request-id", requestId);
    const started = Date.now();

    try {
      const host = req.headers.host || `localhost`;
      const url = new URL(req.url, `http://${host}`);
      const base = `${req.headers["x-forwarded-proto"] || "http"}://${host}`;

      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
      }
      if (url.pathname.startsWith("/v1/")) {
        for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v);
        const hit = api.match(req.method, url.pathname);
        if (!hit) throw notFound(`No route for ${req.method} ${url.pathname}`);
        if (hit.methodNotAllowed) throw new HttpError(405, `${req.method} is not allowed on ${url.pathname}`);
        await hit.route.handler({ req, res, url, params: hit.params, base, store, requestId });
        return;
      }
      // The SDK imports the modem modules directly; no build step, no second copy.
      if (url.pathname.startsWith("/sdk/")) {
        await serveFrom(MODEM, url.pathname.slice("/sdk/".length), req, res);
        return;
      }
      if (url.pathname.startsWith("/announce/")) {
        await serveFrom(ANNOUNCE, url.pathname.slice("/announce/".length), req, res);
        return;
      }
      await serveStatic(req, res, url);
    } catch (err) {
      if (!res.headersSent) sendError(res, err, requestId);
      else res.end();
    } finally {
      if (process.env.CICADA_LOG !== "off") {
        console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms ${requestId}`);
      }
    }
  });

  server.on("close", () => store.close());
  server.store = store;

  // Sweep expired audio and receipts hourly.
  const sweeper = setInterval(() => {
    try {
      const r = store.sweep();
      if (r.audio || r.receipts) console.log(`sweep: removed ${r.audio} audio files, ${r.receipts} receipts`);
    } catch (e) { console.error("sweep failed", e); }
  }, 3600_000);
  sweeper.unref();

  return server;
}

const corsHeaders = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, if-none-match",
  "access-control-expose-headers": "x-request-id, x-ratelimit-remaining, x-ratelimit-reset, etag",
  "access-control-max-age": "86400",
});

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "index.html";
  if (!extname(rel)) rel += ".html";
  await serveFrom(PUBLIC, rel, req, res);
}

async function serveFrom(root, rel, req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Only GET is served here");
  // Refuse anything that escapes the served directory.
  const path = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!path.startsWith(root)) throw notFound();
  let body;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a file");
    body = await readFile(path);
  } catch {
    throw notFound(`Nothing served at /${rel.replace(/^\/+/, "")}`);
  }
  const etag = `"${crypto.createHash("sha1").update(body).digest("base64url")}"`;
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, { etag }); res.end(); return; }
  res.writeHead(200, {
    "content-type": MIME[extname(path)] || "application/octet-stream",
    "content-length": body.length,
    "cache-control": "no-cache",
    etag,
    "x-content-type-options": "nosniff",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

// -------------------------------------------------------------------- main
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 4137);
  const server = createServer();
  server.listen(port, () => {
    const store = server.store;
    let account = store.db.prepare("SELECT * FROM accounts ORDER BY created_at LIMIT 1").get();
    if (!account) {
      account = store.createAccount({ email: "you@example.com", name: "Local", plan: "selfhosted" });
      const key = store.createApiKey(account.id, "bootstrap");
      console.log(`\n  Created a local account and key.`);
      console.log(`  CICADA_KEY=${key.secret}\n`);
    }
    console.log(`  Cicada listening on http://localhost:${port}`);
    console.log(`  Studio    http://localhost:${port}/`);
    console.log(`  Console   http://localhost:${port}/console`);
    console.log(`  Receiver  http://localhost:${port}/receive`);
    console.log(`  API       http://localhost:${port}/v1/health\n`);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => { console.log(`\n${sig}, closing.`); server.close(() => process.exit(0)); });
  }
}
