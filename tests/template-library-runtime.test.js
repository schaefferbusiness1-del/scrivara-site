'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_template_library.js'), 'utf8');
const liveLoader = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const stagingLoader = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function response(status, data, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return lower[String(name).toLowerCase()] || null; } },
    async json() { return JSON.parse(JSON.stringify(data)); },
  };
}

function makeHarness(responder, overrides = {}) {
  let local = [{ id: 'local-old', name: 'Old device template', text: 'old' }];
  let hosted = false;
  let token = 'token-a';
  let uuid = 0;
  const fetches = [];
  const progress = [];
  const storage = new Map();
  const document = {
    readyState: 'complete',
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    getElementById() { return null; },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
    addEventListener() {},
  };
  const context = {
    console,
    document,
    setTimeout,
    clearTimeout,
    URL,
    Math,
    Date,
    Promise,
    JSON,
    encodeURIComponent,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    crypto: { randomUUID() { uuid += 1; return `uuid-${uuid}`; } },
    backendMode() { return hosted; },
    bkToken() { return token; },
    bkBase() { return 'https://api.example.test'; },
    getTemplates() { return local; },
    setTemplates(next) { local = JSON.parse(JSON.stringify(next || [])); },
    renderTemplateList() {},
    renderTemplateActiveSelect() {},
    openTemplates() {},
    tplAddSplit() { return true; },
    saveTemplateFromForm() { return true; },
    editTemplate() { return true; },
    async _tplReadAnyFile() { return 'template'; },
    async tplMultiFile() { return true; },
    fetch: async (url, options = {}) => {
      fetches.push({ url, options });
      return responder(url, options, { token, local });
    },
    __mlsLoadingCalm: {
      installed: true,
      start(options) {
        const entry = { options, stages: [], completed: [], failed: [] };
        const handle = {
          id: `progress-${progress.length + 1}`,
          requestId: `request-${progress.length + 1}`,
          stage(name, detail) { entry.stages.push({ name, detail }); },
          complete(message) { entry.completed.push(message); },
          fail(error) { entry.failed.push(error && error.message); },
        };
        entry.handle = handle;
        progress.push(entry);
        return handle;
      },
      linkServer() {},
    },
  };
  Object.assign(context, overrides);
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'feat_mls_template_library.js' });
  return {
    context,
    api: context.__mlsTemplateLibrary,
    fetches,
    progress,
    getLocal: () => JSON.parse(JSON.stringify(local)),
    setLocal: value => { local = JSON.parse(JSON.stringify(value)); },
    setHosted: value => { hosted = value; },
    setToken: value => { token = value; },
  };
}

function setSummary(id, version, active, name = id) {
  return { id, name, scope: 'account', status: 'current', active, version, templateCount: 1 };
}

async function hydrationAndAccountIsolation() {
  const h = makeHarness((url, options, env) => {
    const account = env.token === 'token-b' ? 'b' : 'a';
    const id = `set-${account}`;
    if (url.includes('/api/template-sets?')) return response(200, { activeSetId: id, sets: [setSummary(id, 2, true)] });
    if (url.endsWith(`/api/template-sets/${id}`)) return response(200, { set: { ...setSummary(id, 2, true), templates: [{ id: `tpl-${account}`, name: `Cloud ${account}`, text: account }] } });
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  });
  h.setHosted(true);
  assert.strictEqual(await h.api.refresh(), true);
  assert.deepStrictEqual(h.getLocal().map(x => x.id), ['tpl-a'], 'explicit account A selection must replace stale local hydration');
  h.setToken('token-b');
  assert.strictEqual(await h.api.refresh(), true);
  assert.deepStrictEqual(h.getLocal().map(x => x.id), ['tpl-b'], 'account B must hydrate only account B selection');
  h.setHosted(false);
  assert.strictEqual(await h.api.refresh(), false);
  assert.deepStrictEqual(h.getLocal().map(x => x.id), ['tpl-b'], 'logout/offline refresh must not clear or cross-load templates');

  const noActive = makeHarness(url => {
    if (url.includes('/api/template-sets?')) return response(200, { activeSetId: null, sets: [] });
    throw new Error(`Unexpected request ${url}`);
  });
  noActive.setHosted(true);
  await noActive.api.refresh();
  assert.deepStrictEqual(noActive.getLocal().map(x => x.id), ['local-old'], 'no explicit cloud selection must preserve legacy local templates');
}

async function previewThenCommit() {
  const submitted = [];
  const h = makeHarness((url, options) => {
    if (url.includes('/api/template-sets?')) return response(200, { activeSetId: 'set-a', sets: [setSummary('set-a', 1, true)] });
    if (url.endsWith('/api/template-sets/set-a')) return response(200, { set: { ...setSummary('set-a', 1, true), templates: [{ id: 'base', name: 'Base', text: 'base' }] } });
    if (url.endsWith('/api/template-imports/preview')) {
      submitted.push({ kind: 'preview', body: JSON.parse(options.body), headers: options.headers });
      return response(200, { preview: { targetSetId: 'set-a', targetVersion: 1, counts: { added: 1 }, detail: { rejected: [] }, proposedTemplateCount: 2, canCommit: true } }, { 'X-Job-ID': 'job-preview' });
    }
    if (url.endsWith('/api/template-imports/commit')) {
      const body = JSON.parse(options.body);
      submitted.push({ kind: 'commit', body, headers: options.headers });
      return response(200, { result: { status: 'completed', version: 2, counts: { added: 1 }, set: { ...setSummary('set-a', 2, true), templates: [{ id: 'base', name: 'Base', text: 'base' }, { id: 'new', name: 'New', text: 'new' }] } } }, { 'X-Job-ID': 'job-commit' });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  h.setHosted(true);
  await h.api.refresh();
  const before = h.getLocal();
  await h.api.previewImport({ templates: [{ id: 'new', name: 'New', text: 'new' }] });
  assert.deepStrictEqual(h.getLocal(), before, 'preview must not mutate local templates');
  assert(h.api.state.pending, 'preview must remain pending until explicit commit');
  await h.api.commitPending();
  assert.deepStrictEqual(h.getLocal().map(x => x.id), ['base', 'new']);
  const commit = submitted.find(x => x.kind === 'commit');
  assert.strictEqual(commit.body.expectedVersion, 1);
  assert(commit.headers['Idempotency-Key'], 'commit must carry a stable idempotency key');
  assert.strictEqual(h.api.state.pending, null);
}

async function conflictPreservesDeviceChanges() {
  let version = 1;
  let attempts = 0;
  const bodies = [];
  const h = makeHarness((url, options) => {
    if (url.includes('/api/template-sets?')) return response(200, { activeSetId: 'set-a', sets: [setSummary('set-a', version, true)] });
    if (url.endsWith('/api/template-sets/set-a')) return response(200, { set: { ...setSummary('set-a', version, true), templates: [{ id: 'server', name: 'Server newest', text: `v${version}` }] } });
    if (url.endsWith('/api/template-imports/commit')) {
      const body = JSON.parse(options.body);
      bodies.push(body);
      attempts += 1;
      if (attempts === 1) {
        version = 2;
        return response(409, { error: { code: 'TEMPLATE_VERSION_CONFLICT', message: 'changed elsewhere' } });
      }
      version = 3;
      return response(200, { result: { status: 'completed', version, counts: { updated: 1 }, set: { ...setSummary('set-a', version, true), templates: body.templates } } });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  h.setHosted(true);
  await h.api.refresh();
  const deviceChange = [{ id: 'device', name: 'Device edit', text: 'keep me' }];
  h.setLocal(deviceChange);
  assert.strictEqual(await h.api.persistSnapshot(deviceChange), false);
  assert.deepStrictEqual(h.getLocal(), deviceChange, 'conflict refresh must not overwrite the unsaved device version');
  assert(h.api.state.conflict && h.api.state.conflict.serverSet, 'newest server version must be available for review');
  assert.strictEqual(h.api.state.activeVersion, 2);
  h.api.state.conflict = null;
  assert.strictEqual(await h.api.persistSnapshot(deviceChange), true);
  assert.deepStrictEqual(bodies.map(x => x.expectedVersion), [1, 2], 'retry must rebase onto the newest known version');
}

async function failedCommitKeepsPreviewAndIdempotency() {
  let commits = 0;
  const keys = [];
  const h = makeHarness((url, options) => {
    if (url.includes('/api/template-sets?')) return response(200, { activeSetId: 'set-a', sets: [setSummary('set-a', 1, true)] });
    if (url.endsWith('/api/template-sets/set-a')) return response(200, { set: { ...setSummary('set-a', 1, true), templates: [{ id: 'base', name: 'Base', text: 'base' }] } });
    if (url.endsWith('/api/template-imports/preview')) return response(200, { preview: { targetSetId: 'set-a', targetVersion: 1, counts: { added: 1 }, detail: { rejected: [] }, proposedTemplateCount: 2, canCommit: true } });
    if (url.endsWith('/api/template-imports/commit')) {
      commits += 1;
      keys.push(options.headers['Idempotency-Key']);
      if (commits === 1) return response(503, { error: { code: 'TEMPORARY', message: 'try again' } });
      const body = JSON.parse(options.body);
      return response(200, { result: { status: 'completed', version: 2, counts: { added: 1 }, set: { ...setSummary('set-a', 2, true), templates: body.templates } } });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  h.setHosted(true);
  await h.api.refresh();
  await h.api.previewImport({ templates: [{ id: 'new', name: 'New', text: 'new' }] });
  await assert.rejects(() => h.api.commitPending(), /try again/);
  assert(h.api.state.pending, 'failed commit must keep preview data for retry');
  await h.api.commitPending();
  assert.strictEqual(keys[0], keys[1], 'commit retry must reuse the same idempotency key');
}

async function uploadDedupeAndRetryHandle() {
  let uploadCalls = 0;
  let unblock;
  const pending = new Promise(resolve => { unblock = resolve; });
  const h2 = makeHarness(() => { throw new Error('No HTTP expected'); }, {
    async tplMultiFile() { uploadCalls += 1; await pending; this._tplPendingSplit = [{ id: 'parsed', name: 'Parsed', text: 'text' }]; },
  });
  const files = [{ name: 'template.docx', size: 1234, lastModified: 99 }];
  const first = h2.context.tplMultiFile({ target: { files } });
  const second = h2.context.tplMultiFile({ target: { files } });
  unblock();
  assert.deepStrictEqual(await Promise.all([first, second]), [1, 1]);
  assert.strictEqual(uploadCalls, 1, 'duplicate picker/drop events must parse one time');
  assert.strictEqual(h2.progress.length, 1, 'duplicate picker/drop events must own one progress surface');

  // File limits fail before parsing or opening a second loader.
  const tooLarge = [{ name: 'huge.pdf', size: 20 * 1024 * 1024 + 1, lastModified: 1 }];
  await assert.rejects(() => h2.context.tplMultiFile({ target: { files: tooLarge } }), /20 MB/);
}

/* Loading-states contract (b511 lane, owner-reproduced 2026-07-23): a hosted
   form save must show its preview WHERE THE USER ACTED — result box under the
   save row, centered scroll, busy button while the preview round-trips. */
async function formSaveVisibility() {
  function el(id) {
    return {
      id, style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
      disabled: false, isConnected: true, onclick: null, scrollCalls: [],
      scrollIntoView(opts) { this.scrollCalls.push(opts || null); },
      parentElement: null, nextElementSibling: null, setAttribute() {}, appendChild() {},
    };
  }
  const ids = {};
  ['tplName', 'tplKeywords', 'tplText', 'tplMultiResult'].forEach(id => { ids[id] = el(id); });
  ids.tplName.value = 'Form template';
  ids.tplText.value = 'Body text';
  const formRow = el('formRow');
  const formParent = {
    children: [],
    insertBefore(node) { this.children.push(node); if (node.id) ids[node.id] = node; },
    appendChild(node) { this.children.push(node); if (node.id) ids[node.id] = node; },
  };
  ids.tplText.parentElement = formParent;
  ids.tplText.nextElementSibling = formRow;
  formRow.parentElement = formParent;
  const saveBtn = el('saveBtn');
  saveBtn.textContent = '💾 Save template';
  const doc = {
    readyState: 'complete',
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    getElementById(id) { return ids[id] || null; },
    createElement() { return el(''); },
    addEventListener() {},
    querySelector(sel) { return /saveTemplateFromForm/.test(String(sel)) ? saveBtn : null; },
  };
  /* tl-1.3.0 — THIS TEST USED TO PIN THE DEFECT.
     It asserted that pressing Save goes busy "while the preview round-trips",
     renders an "Import preview — nothing saved yet" card and waits for a
     Commit. Measured live on b833 in the owner's Chrome, that contract cost
     him his library: the preview card landed at y=3004 in a 936px viewport so
     he never saw the step, Commit reported "added: 1" while the device list
     stayed at 8, and the "Activate imported set" that finally landed it ran
     applySet() — which REPLACED the device library with the one-template set,
     taking it 8 -> 1 and overwriting the server copy through
     syncPrefsToServer(). Pressing Save must never be able to do that.

     The contract now: Save saves, on the device, synchronously, through the
     proven local path. The preview/commit round-trip still exists and is still
     tested — for tplMultiFile, a BULK import the doctor is deliberately
     reviewing (previewThenCommit above). It is no longer in the way of one
     typed template. */
  let saveCalls = 0;
  const h = makeHarness(async (url) => {
    if (url.includes('/api/template-sets?')) return response(200, { activeSetId: '', sets: [] });
    throw new Error(`form save must not reach the network, got ${url}`);
  }, {
    document: doc,
    toast() {},
    clearTplForm() {},
    saveTemplateFromForm() { saveCalls += 1; return true; },
  });
  h.setHosted(true);
  await h.context.saveTemplateFromForm();

  assert.strictEqual(saveCalls, 1, 'Save must call the device save exactly once, even when hosted');
  const previewCalls = h.fetches.filter(f => String(f.url).endsWith('/api/template-imports/preview'));
  assert.strictEqual(previewCalls.length, 0, 'Save must not round-trip through the import preview');
  assert(!ids.tplFormResult, 'Save must not spawn an off-screen preview card the doctor has to find');
  assert.strictEqual(saveBtn.disabled, false, 'Save must never be left disabled');
  assert.strictEqual(saveBtn.textContent, '💾 Save template', 'Save must keep its label');
  assert.strictEqual(ids.tplMultiResult.innerHTML, '', 'Save must not render into the bulk-upload box');
}

function staticContracts() {
  assert(source.includes("box.onclick=importClick"), 'preview controls need a durable delegated click handler');
  assert(source.includes("VERSION='tl-1.5.0'"), 'the import-progress + never-dead-end lane must carry tl-1.5.0 (pin moved deliberately with the b882 two-bar/timer/unreadable-rows work)');

  /* tl-1.3.0 — the two mechanisms that cost the owner his library on b833.
     Both are asserted on the SOURCE as well as at runtime, because both
     failures were silent and a runtime-only pin can be satisfied by a stub. */
  assert(!/previewImport\(\{fromForm:true\}\)/.test(source),
    'the form save must not route through the import preview — that panel rendered at y=3004 and the doctor never saw it');
  assert(source.includes('function wouldRemove'),
    'activating a set must be able to name what it would delete');
  assert(source.includes('async function confirmReplace'),
    'a set that drops device templates must be confirmed, not applied silently');
  assert(/if\(!\(await confirmReplace\(data\.set\)\)\)/.test(source),
    'activateSet must gate applySet behind the destructive-change confirmation');
  assert(/if\(await confirmReplace\(result\.set\)\)applySet\(result\.set\)/.test(source),
    'a commit that activates must gate applySet behind the same confirmation');
  assert(source.includes('function importResultBox'), 'import previews must target the box where the user acted');
  assert(source.includes("block:'center'"), 'import review must scroll into the middle of the viewport');
  assert(source.includes("resultBoxId=pending.fromForm?'tplFormResult':'tplMultiResult'"), 'commit results must land in the same box as their preview');
  assert(!source.includes("addEventListener('click',importClick,{once:true})"), 'checking activate-after must not consume the commit listener');
  assert(source.includes('providedIdempotencyKey'), 'snapshot retries must retain their idempotency key');
  assert(source.includes("TEMPLATE_VERSION_CONFLICT"));
  assert(source.includes("refresh({applyActive:false,silent:true})"), 'conflict refresh must not overwrite device edits');
  assert(source.includes('@media(max-width:520px)'), 'template set controls must reflow at narrow MacBook/phone widths');
  for (const loader of [liveLoader, stagingLoader]) {
    assert(loader.includes('feat_mls_template_library.js?v=20260805tl150'));
  }
  const loadingAt = liveLoader.indexOf("var A='feat_mls_loading_calm.js',V='lb-2.1.0'");
  const templateAt = liveLoader.indexOf('feat_mls_template_library.js?v=20260805tl150');
  assert(loadingAt >= 0 && templateAt > loadingAt && liveLoader.slice(loadingAt, templateAt).includes("s.src=A+'?v=20260719lb204'"),
    'shared progress must install with the exact fresh version before template lifecycle wiring');
  assert(/onchange="tplMultiFile\(event\)"/.test(html), 'picker must use the wrapped batch importer');
  assert(/function _tplMultiDrop[\s\S]{0,350}tplMultiFile\(\{target:\{files:fs/.test(html), 'drag/drop must use the same wrapped batch importer');
}

(async () => {
  staticContracts();
  await hydrationAndAccountIsolation();
  await previewThenCommit();
  await conflictPreservesDeviceChanges();
  await failedCommitKeepsPreviewAndIdempotency();
  await uploadDedupeAndRetryHandle();
  await formSaveVisibility();
  console.log('PASS template library runtime, isolation, preview/commit, conflict, retry, loader, upload, and form-save visibility contracts');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
