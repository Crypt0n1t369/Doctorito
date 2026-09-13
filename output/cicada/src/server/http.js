/* A small router and request helpers. No framework; the surface is narrow
   enough that one file is easier to audit than a dependency tree. */

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.extra = extra;
  }
}
export const badRequest = (m, extra) => new HttpError(400, m, extra);
export const unauthorized = (m = "Supply a key as `Authorization: Bearer ck_live_...`") => new HttpError(401, m);
export const forbidden = (m) => new HttpError(403, m);
export const notFound = (m = "No such resource") => new HttpError(404, m);
export const payloadTooLarge = (m) => new HttpError(413, m);
export const quotaExceeded = (m, extra) => new HttpError(429, m, extra);

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const names = [];
    const rx = new RegExp("^" + pattern.replace(/:([A-Za-z_]+)/g, (_, n) => {
      names.push(n);
      return "([^/]+)";
    }).replace(/\*$/, "(.*)") + "$");
    this.routes.push({ method, rx, names, handler, opts });
    return this;
  }
  get(p, h, o) { return this.add("GET", p, h, o); }
  post(p, h, o) { return this.add("POST", p, h, o); }
  put(p, h, o) { return this.add("PUT", p, h, o); }
  delete(p, h, o) { return this.add("DELETE", p, h, o); }

  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.rx.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export const MAX_BODY = 32 * 1024 * 1024;          // 32 MB: ~35 minutes of 8 kHz WAV

export function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", c => {
      total += c.length;
      if (total > limit) {
        reject(payloadTooLarge(`Request body exceeds ${(limit / 1048576).toFixed(0)} MB`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function parseJson(buf) {
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString("utf8")); }
  catch (e) { throw badRequest(`Body is not valid JSON: ${e.message}`); }
}

/** Minimal multipart/form-data reader, enough for `curl -F file=@x.wav`. */
export function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!m) throw badRequest("multipart/form-data without a boundary");
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const parts = {};
  let at = buf.indexOf(boundary);
  if (at < 0) throw badRequest("multipart body contains no parts");
  at += boundary.length;
  for (;;) {
    if (buf.slice(at, at + 2).toString() === "--") break;
    if (buf[at] === 0x0d) at += 2; else if (buf[at] === 0x0a) at += 1;
    const headEnd = buf.indexOf("\r\n\r\n", at);
    if (headEnd < 0) break;
    const head = buf.slice(at, headEnd).toString("utf8");
    const next = buf.indexOf(boundary, headEnd);
    if (next < 0) break;
    let end = next;
    if (buf[end - 1] === 0x0a) end--;
    if (buf[end - 1] === 0x0d) end--;
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
    if (name) parts[name] = { data: buf.slice(headEnd + 4, end), filename, contentType: type };
    at = next + boundary.length;
    if (at >= buf.length) break;
  }
  return parts;
}

export function send(res, status, payload, headers = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload, null, 2));
  res.writeHead(status, {
    "content-type": Buffer.isBuffer(payload) ? (headers["content-type"] || "application/octet-stream") : "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}

export function sendError(res, err, requestId) {
  // Domain errors declare `status` on themselves (see BadInputError), so a new
  // error class cannot silently become a 500 because a list was not updated.
  const declared = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600;
  const status = declared ? err.status : 500;
  if (status >= 500) console.error(`[${requestId}]`, err);
  send(res, status, {
    error: {
      type: status >= 500 ? "server_error" : "request_error",
      message: status >= 500 ? "Something went wrong on our side." : err.message,
      ...(err instanceof HttpError ? err.extra : {}),
      request_id: requestId,
    },
  });
}

/** Fixed-window rate limiter, per key. Keeps the process from being trivially flooded. */
export class RateLimiter {
  constructor({ windowMs = 60_000, max = 240 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }
  take(key, cost = 1) {
    const nowMs = Date.now();
    const slot = Math.floor(nowMs / this.windowMs);
    const k = `${key}:${slot}`;
    const used = (this.hits.get(k) ?? 0) + cost;
    this.hits.set(k, used);
    if (this.hits.size > 5000) {
      for (const kk of this.hits.keys()) {
        if (!kk.endsWith(`:${slot}`)) this.hits.delete(kk);
      }
    }
    return {
      allowed: used <= this.max,
      remaining: Math.max(0, this.max - used),
      resetSeconds: Math.ceil(((slot + 1) * this.windowMs - nowMs) / 1000),
    };
  }
}
