import { createHash } from 'node:crypto';
/**
 * HTML helpers and the one stylesheet.
 *
 * Everything interpolated into a page goes through `esc` by default, because
 * the most common thing on these pages is contributor text, and contributor
 * text is data. A value only renders as markup if the caller wrapped it in
 * `raw()`, which makes every injection point in pages.js visible at a glance.
 */

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export function raw(s) { return new Raw(String(s)); }

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(String(v));
}

/** Tagged template that escapes interpolations unless they are already Raw. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

// ---------------------------------------------------------------------------
// The stylesheet. A public institution's page that somebody cared about:
// quiet, legible, high contrast, one accent colour, no framework.
// ---------------------------------------------------------------------------
export const STYLESHEET = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf7;
  --panel: #ffffff;
  --ink: #14181d;
  --muted: #59626e;
  --line: #dcdfe4;
  --track: #e7e9ed;
  --accent: #1f5fa9;
  --accent-soft: #dce8f6;
  --good: #1c6b45;
  --warn: #8a5a05;
  --bad: #9a2b20;
  --radius: 6px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171b;
    --panel: #1b1f24;
    --ink: #e8eaed;
    --muted: #9aa4b0;
    --line: #2d333b;
    --track: #2a2f36;
    --accent: #7ab3f0;
    --accent-soft: #1d3247;
    --good: #5cc08d;
    --warn: #e0ae55;
    --bad: #f08076;
  }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
.wrap { max-width: 62rem; margin: 0 auto; padding: 0 16px 5rem; }

header.top { border-bottom: 1px solid var(--line); background: var(--panel); }
header.top .wrap { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; align-items: baseline; padding-top: .85rem; padding-bottom: .85rem; }
header.top a { color: var(--ink); text-decoration: none; }
header.top a:hover { text-decoration: underline; }
header.top .brand { font-weight: 650; letter-spacing: -0.01em; }
header.top .who { margin-left: auto; color: var(--muted); font-size: .85rem; }

a { color: var(--accent); text-underline-offset: 2px; }
h1 { font-size: 1.7rem; line-height: 1.25; letter-spacing: -0.015em; margin: 1.6rem 0 .4rem; }
h2 { font-size: 1.15rem; margin: 2.2rem 0 .6rem; letter-spacing: -0.01em; }
h3 { font-size: 1rem; margin: 1.2rem 0 .3rem; }
p { margin: .5rem 0; }
.lede { font-size: 1.08rem; max-width: 46rem; }
.muted { color: var(--muted); }
.small { font-size: .85rem; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .85em; }

.card {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 1rem 1.1rem; margin: 1rem 0;
}
.card > :first-child { margin-top: 0; }
.card > :last-child { margin-bottom: 0; }
.cardhead { display: flex; flex-wrap: wrap; gap: .5rem .75rem; align-items: baseline; }
.cardhead h3 { margin: 0; flex: 1 1 18rem; }

.grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1rem; margin: .4rem 0; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; }

table { width: 100%; border-collapse: collapse; margin: .6rem 0; font-size: .95rem; }
th, td { text-align: left; padding: .38rem .5rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr:last-child td { border-bottom: 0; }
.scroll { overflow-x: auto; }

.bar { display: flex; height: 9px; border-radius: 5px; overflow: hidden; background: var(--track); margin: .45rem 0 .3rem; }
.bar i { display: block; height: 100%; }
.bar .delivered { background: var(--good); }
.bar .committed { background: var(--accent); }
.barkey { font-size: .78rem; color: var(--muted); display: flex; gap: 1rem; flex-wrap: wrap; }
.barkey b { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }

.tag {
  display: inline-block; padding: .05rem .45rem; border-radius: 999px;
  border: 1px solid var(--line); font-size: .76rem; color: var(--muted); white-space: nowrap;
}
.tag.ok { color: var(--good); border-color: var(--good); }
.tag.warn { color: var(--warn); border-color: var(--warn); }
.tag.bad { color: var(--bad); border-color: var(--bad); }
.tag.accent { color: var(--accent); border-color: var(--accent); }

.note { border-left: 3px solid var(--warn); padding: .35rem .75rem; margin: .5rem 0; background: var(--panel); }
.note.bad { border-color: var(--bad); }
.note.ok { border-color: var(--good); }
.err { color: var(--bad); font-size: .85rem; margin: .2rem 0; }
.warnmsg { color: var(--warn); font-size: .85rem; margin: .2rem 0; }

pre.verbatim, pre.json {
  background: var(--track); border-radius: var(--radius); padding: .7rem .8rem;
  white-space: pre-wrap; word-break: break-word; margin: .5rem 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .85rem; line-height: 1.5;
}
pre.json { max-height: 26rem; overflow: auto; }

form { margin: .5rem 0; }
label { display: block; margin: .7rem 0 .15rem; font-weight: 550; }
label .hint { display: block; font-weight: 400; color: var(--muted); font-size: .82rem; }
input[type=text], input[type=number], input[type=datetime-local], textarea, select {
  width: 100%; padding: .5rem .55rem; font: inherit; color: var(--ink);
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
}
input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
textarea { min-height: 7rem; resize: vertical; }
.field.bad input, .field.bad textarea, .field.bad select { border-color: var(--bad); }
.row { display: flex; gap: .75rem; flex-wrap: wrap; }
.row > .field { flex: 1 1 11rem; }

button, .btn {
  font: inherit; font-weight: 550; padding: .6rem 1.1rem; border-radius: var(--radius);
  border: 1px solid var(--accent); background: var(--accent); color: #fff;
  cursor: pointer; text-decoration: none; display: inline-block; text-align: center;
}
button.plain, .btn.plain { background: var(--panel); color: var(--accent); }
button.quiet { background: var(--panel); color: var(--ink); border-color: var(--line); font-weight: 450; padding: .35rem .7rem; }
.actions { display: flex; gap: .75rem; flex-wrap: wrap; margin: 1.1rem 0 .3rem; }
.actions form { flex: 1 1 12rem; margin: 0; }
.actions button { width: 100%; }

.keys { font-size: .85rem; color: var(--muted); }
kbd {
  font-family: inherit; font-size: .8rem; border: 1px solid var(--line); border-bottom-width: 2px;
  border-radius: 4px; padding: .05rem .35rem; background: var(--panel);
}
.qitem { border-left: 3px solid var(--line); }
.qitem.current { border-left-color: var(--accent); box-shadow: 0 1px 10px rgba(0,0,0,.07); }
.qitem.done { opacity: .35; }
.cands li { margin: .2rem 0; }
.cands .k { display: inline-block; min-width: 1.4rem; }

footer.foot { border-top: 1px solid var(--line); margin-top: 3rem; padding-top: 1rem; color: var(--muted); font-size: .85rem; }

@media (max-width: 34rem) {
  h1 { font-size: 1.4rem; }
  .wrap { padding-left: 14px; padding-right: 14px; }
  .kv { grid-template-columns: 1fr; }
  .kv dt { margin-top: .4rem; }
}

/* ------------------------------------------------------------------ pages */

.crumb { color: var(--muted); font-size: .9rem; margin: 0 0 .25rem; }
.narrow { max-width: 34rem; }
.empty { color: var(--muted); padding: 1.2rem 0; }
.small { font-size: .85rem; }
.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.n.bad { color: var(--bad); }

h1 { font-size: 1.55rem; letter-spacing: -.01em; margin: 1.4rem 0 .4rem; }
h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); }
h3 { font-size: 1rem; margin: 0 0 .25rem; }

.cards { display: grid; gap: .9rem; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); margin: 1rem 0; }
.card {
  display: block; text-decoration: none; color: inherit; background: var(--panel);
  border: 1px solid var(--line); border-radius: var(--radius); padding: .9rem 1rem;
}
.card:hover { border-color: var(--accent); }
.card p { margin: .2rem 0; font-size: .9rem; }

.provenance { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: .4rem 1.1rem 1rem; margin: 1.2rem 0; }
.provenance h2 { margin-top: 1rem; }
.provenance dl, dl.four { display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1.2rem; margin: .6rem 0; }
.provenance dl > div, dl.four > div { display: contents; }
.provenance dt, dl.four dt { color: var(--muted); font-size: .88rem; }
.provenance dd, dl.four dd { margin: 0; }

.facts { display: grid; gap: .7rem 1.6rem; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); margin: 1rem 0; }
.facts > div { display: flex; flex-direction: column; gap: .1rem; }
.facts span { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
.facts b { font-size: 1.05rem; font-weight: 600; font-variant-numeric: tabular-nums; }

table.needs, table.commitments { width: 100%; border-collapse: collapse; margin: .6rem 0 1rem; font-size: .92rem; }
table.compact { font-size: .88rem; }
.barcell { width: 7rem; }
tr.blocked td:first-child { box-shadow: inset 3px 0 0 var(--warn); }
.tag.good { color: var(--good); border-color: var(--good); }
.tag.risk2 { color: var(--warn); border-color: var(--warn); }
.tag.risk3 { color: var(--bad); border-color: var(--bad); }

ul.trail, ul.amendments, ul.bank { list-style: none; padding: 0; margin: .5rem 0; }
ul.trail li, ul.amendments li, ul.bank li { padding: .4rem 0; border-bottom: 1px solid var(--line); font-size: .92rem; }
ul.bank code { font-size: .85rem; }

blockquote.verbatim, blockquote.reply {
  margin: .8rem 0; padding: .7rem .9rem; background: var(--panel);
  border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: var(--radius); white-space: pre-wrap; font-size: .95rem;
}
blockquote.reply { border-left-color: var(--good); }
pre.json { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: .8rem; overflow-x: auto; font-size: .82rem; line-height: 1.45; }

.notice { padding: .5rem .8rem; border-radius: var(--radius); background: var(--accent-soft); margin: .8rem 0; }
.notice.warn { background: transparent; border: 1px solid var(--warn); color: var(--warn); }
.notice.good { background: transparent; border: 1px solid var(--good); color: var(--good); }
ul.warnings { color: var(--warn); font-size: .9rem; }

form.offer, form.grid { display: grid; gap: .9rem; max-width: 46rem; margin: 1rem 0 2rem; }
form.grid { grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); align-items: start; }
form.grid .field:first-child, form.grid .field:nth-child(2) { grid-column: 1 / -1; }
form.grid button { grid-column: 1 / -1; justify-self: start; }
form.inline { display: flex; gap: .3rem; }
form.inline input { width: auto; }
a.button, button.primary {
  display: inline-block; text-decoration: none; font: inherit; font-weight: 550;
  padding: .55rem 1rem; border-radius: var(--radius);
  border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer;
}
a.button:hover, button.primary:hover { filter: brightness(1.08); }
button[disabled] { opacity: .45; cursor: default; }

/* the contributor's only page: four facts and two buttons */
body.contributor main { padding-top: 2.5rem; }
.big { font-size: 1.25rem; font-weight: 600; margin: .2rem 0 1rem; }
.two-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem; margin: 1.4rem 0 .6rem; }
.two-buttons form { display: contents; }
.two-buttons button { width: 100%; padding: .9rem 1rem; font-size: 1rem; }

/* the coordinator console */
.queuehead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 1rem; }
.queuehead h1 { margin-bottom: 0; }
article.item { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.1rem; margin: 1rem 0; }
article.item > header { display: flex; justify-content: space-between; gap: 1rem; font-size: .88rem; flex-wrap: wrap; }
.extracted { display: grid; gap: .3rem; font-size: .85rem; color: var(--muted); margin: .6rem 0 1rem; }
.extracted b { color: var(--ink); font-weight: 600; margin-right: .3rem; }
ol.candidates { list-style: none; padding: 0; margin: 0 0 1rem; }
article.item form > input { max-width: 34rem; }
ol.candidates li { display: flex; align-items: baseline; gap: .6rem; padding: .45rem 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
ol.candidates .cand { flex: 1 1 18rem; }
ol.candidates .nums { color: var(--muted); font-size: .85rem; font-variant-numeric: tabular-nums; }
kbd {
  font: 600 .78rem ui-monospace, SFMono-Regular, Menlo, monospace; padding: .1rem .4rem;
  border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; background: var(--bg);
}
.actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: .6rem; }
.actions button { width: auto; flex: 0 0 auto; font: inherit; padding: .5rem .85rem; border-radius: var(--radius); border: 1px solid var(--line); background: var(--bg); color: var(--ink); cursor: pointer; }
.actions button:hover { border-color: var(--accent); }

/* operator */
.switch { display: flex; justify-content: space-between; align-items: center; gap: 1.5rem; flex-wrap: wrap;
  border: 1px solid var(--line); border-left-width: 4px; border-radius: var(--radius); padding: .4rem 1.1rem 1rem; margin: 1.2rem 0; background: var(--panel); }
.switch.on { border-left-color: var(--good); }
.switch.off { border-left-color: var(--warn); }
.switch h2 { border: 0; margin: 1rem 0 .2rem; }
.switch p { margin: 0; max-width: 42rem; }

ul.outbox { list-style: none; padding: 0; }
ul.outbox li { border: 1px solid var(--line); border-radius: var(--radius); padding: .6rem .8rem; margin: .6rem 0; background: var(--panel); }
ul.outbox header { font-size: .85rem; margin-bottom: .35rem; }
ul.outbox pre { margin: 0; white-space: pre-wrap; font: inherit; font-size: .9rem; }

@media (max-width: 34rem) {
  .two-buttons { grid-template-columns: 1fr; }
  .provenance dl, dl.four { grid-template-columns: 1fr; gap: 0 0; }
  .provenance dd, dl.four dd { margin-bottom: .5rem; }
  table.needs, table.commitments { font-size: .85rem; }
  .barcell { display: none; }
}
`;

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------
/** The stylesheet's own fingerprint, so a changed sheet is never served stale. */
export const STYLE_VERSION = createHash('sha256').update(STYLESHEET).digest('hex').slice(0, 8);

export function layout({ title, session = null, body, nav = [] }) {
  const links = [
    ['/', 'Initiatives'],
    ...nav,
    ['/outbox', 'Outbox'],
    ['/events', 'Log'],
    ...(session ? [['/q', 'Queue']] : []),
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/style.css?v=${STYLE_VERSION}">
</head>
<body>
<header class="top"><div class="wrap">
  <span class="brand"><a href="/">Coordination</a></span>
  ${links.slice(1).map(([href, text]) => `<a href="${esc(href)}">${esc(text)}</a>`).join('\n  ')}
  <span class="who">${session ? esc(`${session.name} · coordinator`) : ''}</span>
</div></header>
<main class="wrap">
${body}
<footer class="foot">
  Prototype. Every automated message says it is automated and names a person to reach.
  The public pages answer only from this initiative's recorded state.
</footer>
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------

/** committed vs required vs delivered, in one bar. Delivered is inside committed. */
export function bar(committed, delivered, required) {
  const req = Number(required) || 0;
  const com = Math.max(0, Number(committed) || 0);
  const del = Math.min(com, Math.max(0, Number(delivered) || 0));
  const pc = req > 0 ? Math.min(100, (com / req) * 100) : 0;
  const pd = req > 0 ? Math.min(100, (del / req) * 100) : 0;
  return html`<div class="bar" role="img" aria-label="${num(del)} delivered, ${num(com)} committed of ${num(req)}">
    <i class="delivered" style="width:${raw(pd.toFixed(1))}%"></i>
    <i class="committed" style="width:${raw(Math.max(0, pc - pd).toFixed(1))}%"></i>
  </div>`;
}

export function num(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function money(x) { return `$${(Number(x) || 0).toFixed(4)}`; }

export function fmtDate(iso) { return iso ? String(iso).slice(0, 10) : '—'; }

export function fmtWhen(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 16).replace('T', ' ');
}

/** Queue age and log age. Short, because it is read at a glance. */
export function ago(iso, now = new Date()) {
  if (!iso) return '—';
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export function tag(text, kind = '') {
  return html`<span class="tag ${raw(kind)}">${text}</span>`;
}

/**
 * One form field, with its errors printed next to it rather than at the top of
 * the page. The need editor is the screen where wrong input is the whole
 * problem, so a message the author has to scroll to find is a message wasted.
 */
export function field({ name, label, value = '', type = 'text', hint = '', options = null, errors = [], warnings = [], attrs = '' }) {
  const bad = errors.length ? ' bad' : '';
  const control = options
    ? html`<select id="${name}" name="${name}" ${raw(attrs)}>${options.map((o) => {
        const [v, text] = Array.isArray(o) ? o : [o, o];
        return html`<option value="${v}"${raw(String(value) === String(v) ? ' selected' : '')}>${text}</option>`;
      })}</select>`
    : type === 'textarea'
      ? html`<textarea id="${name}" name="${name}" ${raw(attrs)}>${value ?? ''}</textarea>`
      : html`<input id="${name}" name="${name}" type="${type}" value="${value ?? ''}" ${raw(attrs)}>`;

  return html`<div class="field${raw(bad)}">
  <label for="${name}">${label}${hint ? html`<span class="hint">${hint}</span>` : ''}</label>
  ${control}
  ${errors.map((e) => html`<p class="err">${e}</p>`)}
  ${warnings.map((w) => html`<p class="warnmsg">${w}</p>`)}
</div>`;
}
