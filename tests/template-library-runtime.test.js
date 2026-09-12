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
const canonicalHtml = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');

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
          complete(message) { entry.completed.push(message); entry.status = 'completed'; },
          fail(error) { entry.failed.push(error && error.message); entry.status = 'failed'; },
          cancel(message) { entry.status = 'canceled'; if (typeof options.cancel === 'function') options.cancel(message); },
          snapshot() { return { status: entry.status || 'running' }; },
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

function executableDedupeRegression() {
  const start = canonicalHtml.indexOf('function _tplDedupeTemplatesInfo');
  const end = canonicalHtml.indexOf('\nfunction _tplDedupeTemplates(arr)', start);
  assert(start >= 0 && end > start, 'canonical dedupe helper could not be isolated for execution');
  const dedupe = vm.runInNewContext(canonicalHtml.slice(start, end) + ';_tplDedupeTemplatesInfo', {});
  const prefix = 'Name: Same\n\n' + 'A'.repeat(160);
  const rows = [
    { name: 'Same name', text: prefix + ' suffix one' },
    { name: 'Same name', text: prefix + ' suffix two' },
    { name: 'Same name', text: prefix + '   suffix one' }
  ];
  const result = dedupe(rows);
  assert.strictEqual(result.list.length, 2,
    'same-name templates sharing the first 80 characters were incorrectly collapsed');
  assert.strictEqual(result.dropped.length, 1,
    'only an exact normalized duplicate should be reported as dropped');
  assert.strictEqual(result.list[0], rows[0]);
  assert.strictEqual(result.list[1], rows[1]);
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

/* tl-1.7.0 (owner 2026-09-11: "the doctor should never have to press Activate
 * imported set"). A commit that lands a set which is not yet the account's
 * active set - the ordinary bulk-upload case, no "Activate this set after
 * commit" checkbox involved - used to stop at a manual button. It must now
 * call the REAL activateSet() itself, the exact function the removed button
 * called, so the same confirmReplace() guard and the same network call still
 * run - only the doctor's extra click is gone. */
async function commitAutoActivatesNewInactiveSet() {
  const activateCalls = [];
  const h = makeHarness((url, options) => {
    if (url.includes('/api/template-sets?')) return response(200, { activeSetId: '', sets: [] });
    if (url.endsWith('/api/template-imports/preview')) {
      return response(200, { preview: { targetSetId: null, targetVersion: 0, counts: { added: 1 }, detail: { rejected: [] }, proposedTemplateCount: 1, canCommit: true } });
    }
    if (url.endsWith('/api/template-imports/commit')) {
      const body = JSON.parse(options.body);
      return response(200, { result: { status: 'completed', version: 1, counts: { added: 1 }, set: { ...setSummary('set-new', 1, false), templates: body.templates } } });
    }
    if (url.endsWith('/api/template-sets/set-new/activate')) {
      activateCalls.push(true);
      return response(200, { set: { ...setSummary('set-new', 1, true), templates: [{ id: 'new', name: 'New', text: 'new' }] } });
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  });
  h.setLocal([]); // nothing on this device yet, so activating cannot "lose" anything and needs no confirm dialog
  h.setHosted(true);
  await h.api.refresh();
  await h.api.previewImport({ templates: [{ id: 'new', name: 'New', text: 'new' }] });
  assert(h.api.state.pending, 'preview must remain pending until explicit commit');
  await h.api.commitPending();
  assert.strictEqual(activateCalls.length, 1,
    'a freshly imported, not-yet-active set must activate itself automatically through the real activateSet() call');
  assert.deepStrictEqual(h.getLocal().map(x => x.id), ['new'],
    'the auto-activated set was not actually applied to the device library');
}

/* vlibgate-1.0.0 (owner 2026-09-11): measured against the backend's own wall
 * (src/routes/templateLibrary.js's requireClinician, src/auth.js) - every
 * /api/template-sets* and /api/template-imports/* route 403s exactly three
 * roles (owner/admin, lawyer, receptionist) and nothing else, permanently.
 * accountLocked() mirrors that wall so hosted() (and therefore refresh(),
 * and therefore the whole versioned-library panel) never even attempts the
 * network call for those three account shapes, instead of building a panel
 * that can only ever show a dead red line. */
async function lockedAccountsNeverReachTheCloudLibrary() {
  const locked = [
    ['owner/admin', { bkUser: { isAdmin: true } }],
    ['lawyer', { bkUser: { role: 'user' }, isLawyerUser: () => true }],
    ['receptionist', { bkUser: { role: 'receptionist' }, isReceptionistUser: () => true }]
  ];
  for (const [label, overrides] of locked) {
    const h = makeHarness(() => { throw new Error(label + ': no network call is ever expected for a permanently-locked account'); }, overrides);
    h.setHosted(true);
    const refreshed = await h.api.refresh();
    assert.strictEqual(refreshed, false, label + ": refresh() must not proceed for an account requireClinician permanently 403s");
  }
  /* a real clinician account (no isAdmin, no lawyer/receptionist flag) must
   * be completely unaffected - this is the account type the feature exists
   * for, and every other test in this file already proves it works with no
   * bkUser set at all. */
  const clinician = makeHarness(url => {
    if (url.includes('/api/template-sets?')) return response(200, { activeSetId: '', sets: [] });
    throw new Error(`Unexpected request ${url}`);
  }, { bkUser: { role: 'doctor' } });
  clinician.setHosted(true);
  assert.strictEqual(await clinician.api.refresh(), true, 'a real clinician account must still reach the cloud library');
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

  /* A large selection is a valid local read. It may later be stopped at the
     server's honest 500-template persistence ceiling, but the reader itself
     must not reject the files or block the page on an arbitrary count. */
  const many = Array.from({ length: 501 }, (_, i) => ({ name: `template-${i}.txt`, size: 1234, lastModified: i }));
  assert.strictEqual(await h2.context.tplMultiFile({ target: { files: many } }), 1,
    '501 readable files were rejected by the old arbitrary client ceiling');
}

async function uploadsSerializeDistinctSelections() {
  let active = 0, maxActive = 0, calls = 0, releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const h = makeHarness(() => { throw new Error('No HTTP expected'); }, {
    async tplMultiFile(ev) {
      calls++; active++; maxActive = Math.max(maxActive, active);
      if (calls === 1) await firstGate;
      this._tplPendingSplit = [{ id: `parsed-${calls}`, name: `Parsed ${calls}`, text: `text ${calls}` }];
      active--;
    }
  });
  const a = h.context.tplMultiFile({ target: { files: [{ name: 'a.txt', size: 1, lastModified: 1 }] } });
  const b = h.context.tplMultiFile({ target: { files: [{ name: 'b.txt', size: 1, lastModified: 2 }] } });
  await Promise.resolve();
  assert.strictEqual(calls, 1, 'a distinct second upload started before the first released shared parser state');
  assert.strictEqual(maxActive, 1, 'distinct uploads overlapped despite shared _tplPending* globals');
  releaseFirst();
  assert.deepStrictEqual(await Promise.all([a, b]), [1, 1], 'serialized upload results did not preserve staged rows');
  assert.strictEqual(calls, 2);
  assert.strictEqual(maxActive, 1);
}

async function canceledPreviewCannotCommitPendingState() {
  let fetchStarted;
  const h = makeHarness((url, options) => {
    if (url.endsWith('/api/template-imports/preview')) {
      fetchStarted = true;
      return new Promise((resolve, reject) => {
        if (options.signal) options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    throw new Error(`Unexpected request ${url}`);
  }, { AbortController });
  h.setHosted(true);
  const pending = h.api.previewImport({ templates: [{ id: 'cancel-me', name: 'Cancel me', text: 'body' }] });
  while (!fetchStarted) await new Promise(resolve => setImmediate(resolve));
  const job = h.progress[h.progress.length - 1];
  job.handle.cancel('Canceled by test.');
  await assert.rejects(() => pending, error => error && (error.name === 'AbortError' || error.code === 'TEMPLATE_OPERATION_CANCELED'));
  assert.strictEqual(h.api.state.pending, null, 'a canceled preview wrote pending import state after its await');
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

/* Provider-scoped sets must carry a roster identity, not a display name. Two
 * clinicians may legitimately share the same name, so every lifecycle write
 * below uses an id selected from the canonical account-scoped roster. */
async function providerScopedSetLifecycle() {
  const entries = [
    { id: 'provider-a', stableKey: 'athena:provider-a', name: 'Alex Kim, MD' },
    { id: 'provider-b', stableKey: 'athena:provider-b', name: 'Alex Kim, MD' }
  ];
  const roster = {
    installed: true,
    list() { return entries.map(entry => ({ ...entry })); },
    resolve(ref) {
      const raw = typeof ref === 'object' ? (ref.stableKey || ref.id || ref.name || '') : String(ref || '');
      const exact = entries.filter(entry => entry.id === raw || entry.stableKey === raw);
      if (exact.length === 1) return { ...exact[0] };
      const names = entries.filter(entry => entry.name.toLowerCase() === raw.toLowerCase());
      return names.length === 1 ? { ...names[0] } : null;
    }
  };
  const sent = [];
  const providerSet = (version = 1) => ({ id: 'set-provider', name: 'Provider set', scope: 'provider', providerId: 'provider-a', providerName: 'Alex Kim, MD', providerStableKey: 'athena:provider-a', status: 'current', active: true, version, templateCount: 1 });
  const h = makeHarness((url, options) => {
    if (url.includes('/api/template-sets?')) return response(200, { activeSetId: 'set-provider', sets: [providerSet(1)] });
    if (url.endsWith('/api/template-sets/set-provider')) return response(200, { set: { ...providerSet(1), templates: [{ id: 'base', name: 'Base', text: 'base' }] } });
    if (url.endsWith('/api/template-imports/preview')) {
      sent.push({ kind: 'preview', body: JSON.parse(options.body) });
      return response(200, { preview: { targetSetId: 'set-provider', targetVersion: 1, counts: { added: 1 }, detail: { rejected: [] }, proposedTemplateCount: 2, canCommit: true } });
    }
    if (url.endsWith('/api/template-imports/commit')) {
      const body = JSON.parse(options.body); sent.push({ kind: 'commit', body });
      return response(200, { result: { status: 'completed', version: 2, counts: { updated: 1 }, set: { ...providerSet(2), templates: body.templates } } });
    }
    if (url.endsWith('/api/template-sets')) {
      const body = JSON.parse(options.body); sent.push({ kind: 'create', body });
      return response(200, { set: { ...providerSet(1), id: 'created-provider', name: body.name, active: false } });
    }
    throw new Error(`Unexpected provider-scope request ${options.method || 'GET'} ${url}`);
  }, { __mlsProviderRoster: roster });
  h.setHosted(true);
  await h.api.refresh();
  assert.deepStrictEqual(h.getLocal().map(template => [template.providerId, template.providerName]), [['provider-a', 'Alex Kim, MD']],
    'applying a provider-scoped set did not project its exact identity onto each draftable template');
  assert.deepStrictEqual(h.api._importBody({ scope: 'provider', providerId: 'provider-a', templates: [] }).providerName, 'Alex Kim, MD', 'rehydrated provider set lost its provider name');
  const boundImport = h.api._importBody({ scope: 'provider', providerId: 'provider-a', templates: [{ id: 'plain', name: 'Plain upload', text: 'text' }] });
  assert.deepStrictEqual([boundImport.templates[0].providerId, boundImport.templates[0].providerName], ['provider-a', 'Alex Kim, MD'],
    'a plain imported template was not bound to its provider-scoped set before persistence');
  assert.throws(() => h.api._templatesBoundToSet({ scope: 'provider', providerId: '', providerName: '', templates: [{ id: 'unsafe' }] }),
    error => error && error.code === 'TEMPLATE_PROVIDER_IDENTITY_UNAVAILABLE',
    'an unbound provider-scoped set was allowed into the device template library');
  await h.api.previewImport({ scope: 'provider', providerId: 'provider-a', templates: [{ id: 'new', name: 'New', text: 'new' }] });
  await h.api.commitPending();
  await h.api.persistSnapshot([{ id: 'edit', name: 'Edited', text: 'edited' }]);
  await h.api._createEmpty({ scope: 'provider', providerId: 'provider-a', setName: 'Created provider set' });
  for (const entry of sent) {
    assert.strictEqual(entry.body.providerId, 'provider-a', `${entry.kind} lost the selected provider id`);
    assert.strictEqual(entry.body.providerName, 'Alex Kim, MD', `${entry.kind} lost the selected provider name`);
  }
  const beforeRefusal = h.fetches.length;
  await assert.rejects(() => h.api.previewImport({ scope: 'provider', providerName: 'Alex Kim, MD', templates: [{ id: 'x', name: 'X', text: 'x' }] }), /unique roster identity/);
  await assert.rejects(() => h.api.previewImport({ scope: 'provider', providerId: 'missing-provider', templates: [{ id: 'x', name: 'X', text: 'x' }] }), /unique roster identity/);
  assert.strictEqual(h.fetches.length, beforeRefusal, 'unknown or ambiguous provider scope reached the network');
  await h.api.previewImport({ scope: 'provider', providerId: 'provider-a', templates: [{ id: 'again', name: 'Again', text: 'again' }] });
  assert(h.api.state.pending, 'provider preview should be pending before an account boundary');
  h.setToken('token-b');
  await h.api.refresh();
  assert.strictEqual(h.api.state.pending, null, 'account switch retained a pending provider-scoped selection');
}

function staticContracts() {
  assert(source.includes('var SERVER_IMPORT_LIMIT=500'), 'the client must document the real server import ceiling');
  assert(!/files\.length>500/.test(source), 'the upload reader must not reject a large local selection at an arbitrary 500-file ceiling');
  assert(source.includes('uploadQueue') && source.includes('pumpUploads'), 'distinct concurrent uploads must serialize around shared pending globals');
  assert(source.includes('AbortController') && source.includes('operationAssert(op)') && source.includes('bindProvidedHandle'), 'preview/commit must carry abort and post-await ownership fences');
  assert(/normalize\(t\.text\)/.test(html) && !/\(t\.text\|\|'\'\)\.slice\(0,80\)/.test(html), 'template dedupe must key the complete normalized body, not its first 80 characters');
  const room = fs.readFileSync(path.join(root, 'feat_mls_opnote_room.js'), 'utf8');
  assert(room.includes('TPL_RAIL_WINDOW') && room.includes('opr-tpl-window') && room.includes('TPL_RAIL_SORT_CACHE'),
    'the template rail must use a bounded window and cached ordering for large libraries');
  assert(source.includes("box.onclick=importClick"), 'preview controls need a durable delegated click handler');
  assert(source.includes("id=\"tlProviderWrap\" hidden") && source.includes("providerWrap.hidden=scopeEl.value!=='provider'"),
    'the roster provider picker must exist only while provider scope is selected');
  assert(source.includes('function scopeFor(custom)') && source.includes('r.list()') && source.includes('r.resolve(ref)'),
    'provider-scoped sets must resolve against the canonical structured roster, not a display-name cache');
  assert(source.includes("VERSION='tl-1.6.0'"), 'the add-means-add lane must carry tl-1.6.0 (pin moved deliberately: clean previews auto-commit from the Add click path)');

  /* tl-1.7.0 (owner 2026-09-11): the doctor must never have to press "Activate
   * imported set" - the manual button is gone, and a successful commit that
   * lands a not-yet-active set activates it through the real activateSet(). */
  assert(!source.includes('<button data-tl-activate="'),
    'the manual "Activate imported set" button markup should be gone now that a successful import activates itself');
  assert(/if\(result&&result\.set&&!result\.set\.active&&result\.set\.id!==state\.activeSetId&&!body\.activate\)\s*await\s*activateSet\(result\.set\.id\)/.test(source),
    'commitPending no longer auto-activates a freshly imported, not-yet-active set through the real activateSet() guard');

  /* tl-1.7.0 / vlibgate-1.0.0 (owner 2026-09-11): the versioned cloud library
   * can never work for an account requireClinician (src/auth.js) permanently
   * 403s - owner/admin, lawyer, receptionist - so the whole panel is hidden
   * for those accounts instead of showing a dead control surface. */
  assert(source.includes('function accountLocked()'), 'the versioned-library account gate is missing');
  assert(/function hosted\(\)\{if\(state\.unsupported\|\|accountLocked\(\)\)return false;/.test(source),
    'hosted() no longer treats a permanently-locked account as not-hosted');
  assert(/function ensurePanel\(\)\{[\s\S]{0,200}if\(accountLocked\(\)\)/.test(source),
    'ensurePanel() no longer refuses to build the versioned-library panel for a locked account');

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
  assert(/var replaceOk=await confirmReplace\(result\.set\);operationAssert\(op\);if\(replaceOk\)applySet\(result\.set\)/.test(source),
    'a commit that activates must gate applySet behind the same confirmation and operation fence');
  assert(source.includes('function importResultBox'), 'import previews must target the box where the user acted');
  assert(source.includes("block:'center'"), 'import review must scroll into the middle of the viewport');
  assert(source.includes("resultBoxId=pending.fromForm?'tplFormResult':'tplMultiResult'"), 'commit results must land in the same box as their preview');
  assert(!source.includes("addEventListener('click',importClick,{once:true})"), 'checking activate-after must not consume the commit listener');
  assert(source.includes('providedIdempotencyKey'), 'snapshot retries must retain their idempotency key');
  assert(source.includes("TEMPLATE_VERSION_CONFLICT"));
  assert(source.includes("refresh({applyActive:false,silent:true})"), 'conflict refresh must not overwrite device edits');
  assert(source.includes('@media(max-width:520px)'), 'template set controls must reflow at narrow MacBook/phone widths');
  /* 2026-08-06: this pinned a hand-maintained token (…tl160, then …tl161). That
     is what let the loader go stale while the module changed: fea4afb8 edited
     feat_mls_template_library.js on 08-06 with the token still reading 08-05, so
     b904's import fix could not reach a returning browser and main went red on
     tests/cache-token-cannot-go-stale.test.js. A date bump fixes it once; the
     build-number buster cannot go stale by construction, so the assertion now
     pins the FORM rather than a value anyone has to remember to move. */
  for (const loader of [liveLoader, stagingLoader]) {
    assert(loader.includes("feat_mls_template_library.js?v='+(window.__MLS_AV||Date.now())"),
      'the template library loader must follow the build number, not a hand-maintained token');
    assert(!/feat_mls_template_library\.js\?v=20\d{6}/.test(loader),
      'a hand-maintained date token came back on the template library loader — it will go stale at the next change');
  }
  const loadingAt = liveLoader.indexOf("var A='feat_mls_loading_calm.js',V='lb-2.1.0'");
  const templateAt = liveLoader.indexOf('feat_mls_template_library.js?v=');
  assert(loadingAt >= 0 && templateAt > loadingAt && liveLoader.slice(loadingAt, templateAt).includes("s.src=A+'?v=20260719lb204'"),
    'shared progress must install with the exact fresh version before template lifecycle wiring');
  assert(/onchange="tplMultiFile\(event\)"/.test(html), 'picker must use the wrapped batch importer');
  assert(/function _tplMultiDrop[\s\S]{0,350}tplMultiFile\(\{target:\{files:fs/.test(html), 'drag/drop must use the same wrapped batch importer');
}

(async () => {
  executableDedupeRegression();
  staticContracts();
  await hydrationAndAccountIsolation();
  await previewThenCommit();
  await commitAutoActivatesNewInactiveSet();
  await lockedAccountsNeverReachTheCloudLibrary();
  await conflictPreservesDeviceChanges();
  await failedCommitKeepsPreviewAndIdempotency();
  await uploadDedupeAndRetryHandle();
  await uploadsSerializeDistinctSelections();
  await canceledPreviewCannotCommitPendingState();
  await formSaveVisibility();
  await providerScopedSetLifecycle();
  console.log('PASS template library runtime, isolation, preview/commit, auto-activate, conflict, retry, loader, upload, and form-save visibility contracts');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
