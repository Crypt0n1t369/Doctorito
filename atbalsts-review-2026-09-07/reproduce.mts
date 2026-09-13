/**
 * Atbalsts architecture review: isolated diagnostic reproducers (ES module).
 * Run from a disposable checkout of 7e0468fe:
 *   ./node_modules/.bin/tsx /absolute/path/to/this/reproduce.ts
 * Every fetch is mocked. No credentials, live records or live model calls are used.
 * A passing assertion demonstrates the CURRENT DEFECT, not release readiness.
 * After fixing it, invert the affected assertions and move them into normal tests.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = process.cwd();
const mod = (file: string) => import(pathToFileURL(path.join(root, file)).href);
const { createSupabaseDocumentStore } = await mod('src/lib/storage/supabase.ts');
const { bindSupabaseStorage } = await mod('src/lib/storage/index.ts');
const { publishCenterEvent } = await mod('src/lib/center-store.ts');
const { answerCrisisQuestionSmart } = await mod('src/lib/llm-agent.ts');
const { answerPreparednessQuestion, createPreparednessProgress, withoutHealthFlags } =
  await mod('src/lib/preparedness-72h.ts');
const { chatKnowledgeNoteFor } = await mod('src/lib/knowledge-chat.ts');
const originalFetch = globalThis.fetch;
const documents = new Map<string, { value: unknown; revision: number }>();
let failAudit = false;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, 'https://audit.invalid', 'No network is allowed');
  if (url.pathname.endsWith('/atbalsts_documents')) {
    const key = url.searchParams.get('key')?.replace(/^eq\./, '') ?? '';
    const row = documents.get(key);
    return Response.json(row ? [row] : []);
  }
  assert.ok(url.pathname.endsWith('/rpc/atbalsts_write_document'));
  const body = JSON.parse(String(init?.body));
  if (body.p_key === 'center-audit' && failAudit) return new Response('', { status: 503 });
  const prior = documents.get(body.p_key);
  if ((prior?.revision ?? 0) !== body.p_expected_revision) {
    return Response.json({ message: 'storage_conflict' }, { status: 409 });
  }
  const revision = (prior?.revision ?? 0) + 1;
  documents.set(body.p_key, { value: structuredClone(body.p_value), revision });
  return Response.json(revision);
};

try {
  const config = { url: 'https://audit.invalid', serviceRoleKey: 'synthetic-only' };
  documents.set('evidence', { value: ['original'], revision: 1 });
  const a = createSupabaseDocumentStore(config);
  const b = createSupabaseDocumentStore(config);
  let sawOld!: () => void;
  let resume!: () => void;
  const oldRead = new Promise<void>(resolve => { sawOld = resolve; });
  const resumeWrite = new Promise<void>(resolve => { resume = resolve; });
  const updateA = a.serial(async () => {
    const old = await a.read('evidence', []);
    sawOld();
    await resumeWrite;
    await a.write('evidence', [...old, 'writer-A']);
  });
  await oldRead;
  await b.serial(async () => {
    const current = await b.read('evidence', []);
    await b.write('evidence', [...current, 'writer-B']);
  });
  await a.read('evidence', []);
  resume();
  await updateA;
  assert.deepEqual(documents.get('evidence')?.value, ['original', 'writer-A']);
  assert.equal(documents.get('evidence')?.revision, 3);
  console.log('R1 reproduced: a concurrent GET lets a stale writer erase another committed update.');

  bindSupabaseStorage(config);
  failAudit = true;
  await assert.rejects(() => publishCenterEvent({
    type: 'fire', titleLv: 'Synthetic audit fixture',
    descriptionLv: 'Synthetic description long enough for validation.',
    locationLabel: 'Synthetic location', lat: 56.95, lng: 24.11, radius: 500,
    severity: 2, sourceName: 'Synthetic source', sourceUrl: 'https://example.test/source',
    startsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
  }, 'synthetic operator'), /supabase_write_failed:503/);
  const events = documents.get('center-events')?.value as Array<{ status: string }>;
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'published');
  assert.equal(documents.has('center-audit'), false);
  console.log('R2 reproduced: publish returns an error after making an event public without its audit.');
} finally {
  bindSupabaseStorage(undefined);
  globalThis.fetch = originalFetch;
}

const env = {
  OPENAI_API_KEY: '', OPENROUTER_API_KEY: 'synthetic-only',
  OPENROUTER_BASE_URL: 'https://audit.invalid',
  SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '',
};
let mode = 'empty';
let calls = 0;
globalThis.fetch = async (input, init) => {
  assert.equal(new URL(input instanceof Request ? input.url : String(input)).origin, 'https://audit.invalid');
  calls++;
  const sent = JSON.parse(String(init?.body));
  const prompt = JSON.parse(sent.messages.at(-1).content);
  const evidence = mode === 'mixed' ? [prompt.allowed_evidence_ids[0], 'invented-evidence-id'] : [];
  return Response.json({ choices: [{ message: { content: JSON.stringify({
    answer: 'SYNTHETIC_UNSUPPORTED_CLAIM', actions: [], avoid: [],
    call112: null, followUp: null, evidence,
  }) } }] });
};
try {
  const request = {
    message: 'Pastāsti vairāk, kā rīkoties plūdos', lang: 'lv',
    state: { intent: 'flood', topicTitle: 'Plūdi', topicBody: 'Applūšanas risks', topicSource: 'info_board' },
  };
  for (mode of ['empty', 'mixed']) {
    const result = await answerCrisisQuestionSmart(request, env);
    assert.equal(result.assistantMeta?.engine, 'model');
    assert.ok(result.text.includes('SYNTHETIC_UNSUPPORTED_CLAIM'));
    assert.ok(result.text.includes('Avots:'));
    console.log(`R3 reproduced: ${mode} evidence permits unsupported model prose with official source labels.`);
  }
  assert.equal(answerPreparednessQuestion({ message: 'Mans bērns neelpo', lang: 'lv' }).has112, true);
  const server = (await mod('src/server.ts')).default;
  const before = calls;
  mode = 'empty';
  const response = await server.fetch(new Request('https://audit.invalid/api/preparedness/answer', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Mans bērns neelpo', lang: 'lv' }),
  }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(calls > before);
  assert.equal(body.engine, 'model');
  assert.ok(!body.text.includes('112'));
  console.log('R3 reproduced: real 72h handler lets model replacement remove its emergency instruction.');
} finally { globalThis.fetch = originalFetch; }

const handlers = new Map<string, (event: any) => void>();
const cached: string[] = [];
const pending: Promise<unknown>[] = [];
vm.runInContext(await readFile(path.join(root, 'public/sw.js'), 'utf8'), vm.createContext({
  URL, Response,
  self: { location: { origin: 'https://audit.invalid' }, addEventListener: (name: string, fn: any) => handlers.set(name, fn) },
  caches: { open: async () => ({ add: async (resource: string) => { cached.push(resource); } }) },
}));
handlers.get('message')!({
  data: { type: 'CACHE_72H_RESOURCES', resources: ['https://audit.invalid/api/profile'] },
  waitUntil: (promise: Promise<unknown>) => pending.push(promise),
});
await Promise.all(pending);
assert.deepEqual(cached, ['https://audit.invalid/api/profile']);
console.log('R4 reproduced: service-worker message path accepts an authenticated API resource for caching.');

const note = chatKnowledgeNoteFor({
  items: [{ id: 'kb-test', kind: 'status', text: 'Ceļš P20 ir bloķēts', version: 1, sourceType: 'operator' }],
  message: 'Ceļš P20 vairs nav bloķēts', lang: 'lv', claimDetected: true,
});
assert.ok(note.startsWith('Centrs to jau zina:'));
console.log('R5 reproduced: opposite report is described as already known by lexical overlap.');
const bag = createPreparednessProgress();
bag.notes = { medicines: 'SYNTHETIC_PRIVATE_NOTE' };
assert.equal(withoutHealthFlags(bag).notes.medicines, 'SYNTHETIC_PRIVATE_NOTE');
console.log('R6 reproduced: clearing three health flags does not remove free-text bag notes.');
console.log('Done. These are defect demonstrations; invert assertions when implementing the fixes.');
