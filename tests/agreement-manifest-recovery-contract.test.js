'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const recoveryStart = shell.indexOf("const AG_MANIFEST_RECOVERY_PARAM='mlsAgreementRefresh';");
const recoveryEnd = shell.indexOf('function agValidateServerManifest(', recoveryStart);
assert(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'manifest recovery block is missing');
const recoveryBlock = shell.slice(recoveryStart, recoveryEnd);

function recoveryHarness(options = {}) {
  const store = new Map();
  const boxes = [{ checked: true }, { checked: true }];
  const replaced = [];
  const historyUrls = [];
  let account = options.account || 'first@example.test';
  let signatureClears = 0;
  let syncs = 0;
  const location = {
    href: 'https://mlsscribe.test/ScribeFlow.html',
    replace(url) { replaced.push(String(url)); },
  };
  const history = {
    state: { safe: true },
    replaceState(_state, _title, url) { historyUrls.push(String(url)); },
  };
  const sessionStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) {
      if (options.storageFails) throw new Error('quota');
      store.set(String(key), String(value));
    },
    removeItem(key) { store.delete(String(key)); },
  };
  const context = {
    URL,
    Date,
    JSON,
    String,
    Number,
    Error,
    Object,
    Array,
    Math,
    sessionStorage,
    location,
    history,
    document: {
      getElementById(id) { return id === 'agSignName' ? { value: '  Synthetic Signer  ' } : null; },
      querySelectorAll(selector) { return selector === '.agCheckbox' ? boxes : []; },
    },
    window: { __MLS_AV: options.build || 'qa-build' },
    unsEmail: () => account,
    sfNormalizeSessionAccount: (value) => String(value || '').trim().toLowerCase(),
    sigPadClear: () => { signatureClears += 1; },
    agSyncSignState: () => { syncs += 1; },
    _agManifestEpoch: 0,
    _agManifest: null,
    _agManifestPromise: null,
    _agSetupPolicyVersion: null,
    _agRecoveredSignerName: '',
    _agSubmitPromise: null,
    _agSubmitOwner: null,
    ACTIVE_MLS_AGREEMENTS: [],
    MLS_AGREEMENTS: [],
  };
  vm.createContext(context);
  vm.runInContext(`${recoveryBlock}\nthis.recoveryApi={agManifestRecoveryKey,agReadManifestRecovery,agResetManifestState,agStaleManifestError,agTryManifestRecovery,agTakeManifestRecoveryDraft,agManifestLoadErrorText,agIsAgreementVersionMismatch};`, context);
  return {
    api: context.recoveryApi,
    store,
    boxes,
    replaced,
    historyUrls,
    location,
    setAccount(value) { account = value; },
    signatureClears: () => signatureClears,
    syncs: () => syncs,
  };
}

{
  const h = recoveryHarness();
  const stale = h.api.agStaleManifestError({ version: 'new-v2' });
  assert.strictEqual(h.api.agTryManifestRecovery(stale), true, 'first stale release did not start one recovery reload');
  assert.strictEqual(h.replaced.length, 1, 'first stale release did not navigate exactly once');
  assert(new URL(h.replaced[0]).searchParams.has('mlsAgreementRefresh'), 'recovery navigation is not cache-busted');
  assert.deepStrictEqual(h.boxes.map((box) => box.checked), [false, false], 'old agreement checks survived changed text');
  assert.strictEqual(h.signatureClears(), 1, 'old drawn signature survived changed text');
  assert.strictEqual(h.syncs(), 1, 'sign button state was not recomputed after assent reset');

  const key = h.api.agManifestRecoveryKey();
  const marker = JSON.parse(h.store.get(key));
  assert.deepStrictEqual(Object.keys(marker).sort(), ['account', 'appBuild', 'attempted', 'schemaVersion', 'signerName', 'startedAt'],
    'recovery marker stores legal assent/signature state or an unreviewed field');
  assert.strictEqual(marker.signerName, 'Synthetic Signer', 'non-assent typed name was not preserved');
  assert.strictEqual(h.api.agTryManifestRecovery(stale), false, 'a still-stale cache entered an automatic reload loop');
  assert.strictEqual(h.replaced.length, 1, 'a still-stale cache navigated more than once');
  assert(/refreshed this app once/i.test(h.api.agManifestLoadErrorText(stale)), 'one-shot exhaustion is not explained truthfully');

  h.location.href = h.replaced[0];
  assert.strictEqual(h.api.agTakeManifestRecoveryDraft(), 'Synthetic Signer', 'successful re-entry lost the safe typed-name draft');
  assert.strictEqual(h.store.has(key), false, 'successful re-entry left a stale reload latch');
  assert.strictEqual(h.historyUrls.length, 1, 'successful re-entry did not remove the cache-busting query');
  assert(!h.historyUrls[0].includes('mlsAgreementRefresh'), 'cache-busting query remained in the canonical URL');
}

{
  const h = recoveryHarness({ build: 'new-build' });
  const key = h.api.agManifestRecoveryKey();
  const oldMarker = {
    schemaVersion: 1, attempted: true, account: 'first@example.test', signerName: 'Old-build draft',
    startedAt: Date.now(), appBuild: 'old-build',
  };
  h.store.set(key, JSON.stringify(oldMarker));
  assert.deepStrictEqual(h.api.agReadManifestRecovery(key), oldMarker,
    'an unexpired marker from the prior cached build was rejected instead of safely carried across reload');
  assert.strictEqual(h.api.agTakeManifestRecoveryDraft(), 'Old-build draft',
    'the safe draft was not consumed from an unexpired prior-build marker');
  assert.strictEqual(h.api.agTakeManifestRecoveryDraft(), '', 'a consumed prior-build marker was replayed');

  const expired = { ...oldMarker, startedAt: Date.now() - (10 * 60 * 1000) - 1 };
  h.store.set(key, JSON.stringify(expired));
  assert.strictEqual(h.api.agReadManifestRecovery(key), null, 'an expired marker was accepted');
  assert.strictEqual(h.store.has(key), false, 'an expired marker was not purged');
  h.store.set(key, '{not-json');
  assert.strictEqual(h.api.agReadManifestRecovery(key), null, 'a corrupt marker was accepted');
  assert.strictEqual(h.store.has(key), false, 'a corrupt marker was not purged');
  h.store.set(key, JSON.stringify({ ...oldMarker, appBuild: 'x'.repeat(161) }));
  assert.strictEqual(h.api.agReadManifestRecovery(key), null, 'an oversized build marker was accepted');
  assert.strictEqual(h.store.has(key), false, 'an oversized build marker was not purged');
  const missingBuild = { ...oldMarker };
  delete missingBuild.appBuild;
  h.store.set(key, JSON.stringify(missingBuild));
  assert.strictEqual(h.api.agReadManifestRecovery(key), null, 'a missing-field marker was accepted');
  assert.strictEqual(h.store.has(key), false, 'a missing-field marker was not purged');
  h.store.set(key, JSON.stringify({ ...oldMarker, startedAt: 'not-a-number' }));
  assert.strictEqual(h.api.agReadManifestRecovery(key), null, 'a nonnumeric marker timestamp was accepted');
  assert.strictEqual(h.store.has(key), false, 'a nonnumeric marker timestamp was not purged');
}

{
  const h = recoveryHarness();
  assert.strictEqual(h.api.agTryManifestRecovery(new Error('network unavailable')), false,
    'a network failure was mistaken for a stale app and reloaded');
  assert.strictEqual(h.replaced.length, 0, 'network failure caused navigation');
}

{
  const h = recoveryHarness({ storageFails: true });
  assert.strictEqual(h.api.agTryManifestRecovery(h.api.agStaleManifestError({ version: 'v2' })), false,
    'recovery navigated without a durable one-shot latch');
  assert.strictEqual(h.replaced.length, 0, 'failed marker persistence can loop through reloads');
}

{
  const h = recoveryHarness({ account: 'a@example.test' });
  const stale = h.api.agStaleManifestError({ version: 'v2' });
  assert.strictEqual(h.api.agTryManifestRecovery(stale), true);
  const keyA = h.api.agManifestRecoveryKey('a@example.test');
  h.setAccount('b@example.test');
  assert.strictEqual(h.api.agReadManifestRecovery(keyA), null, 'account B can consume account A recovery state');
  h.api.agResetManifestState('a@example.test');
  assert.strictEqual(h.store.has(keyA), false, 'account boundary did not purge account A recovery state');
}

{
  const evidence = [['doc.one', 'a'.repeat(64)]];
  const shown = [{ title: 'Document One', requiresCountersign: false }];
  const validateSource = extractFunction(shell, 'agValidateServerManifest');
  const staleSource = extractFunction(shell, 'agStaleManifestError');
  const validate = Function('BROWSER_AGREEMENT_EVIDENCE', 'MLS_AGREEMENTS',
    `${staleSource}\n${validateSource}\nreturn agValidateServerManifest;`)(evidence, shown);
  const manifest = {
    schemaVersion: 1,
    manifestId: 'manifest-current',
    version: 'v2',
    manifestSha256: 'b'.repeat(64),
    documents: [{ documentId: 'doc.one', sha256: 'a'.repeat(64), title: 'Document One', required: true, requiresCountersignature: false }],
  };
  assert.strictEqual(validate(manifest).agreements[0], shown[0], 'current exact manifest was refused');
  assert.throws(() => validate({ ...manifest, documents: [{ ...manifest.documents[0], sha256: 'c'.repeat(64) }] }),
    (error) => error && error.code === 'MLS_AGREEMENT_MANIFEST_STALE', 'changed legal text is not a typed stale-release event');
  assert.throws(() => validate({ ...manifest, schemaVersion: 2 }),
    (error) => error && !error.code, 'structurally invalid server data was misclassified as a cache mismatch');
}

{
  const h = recoveryHarness();
  assert.strictEqual(h.api.agIsAgreementVersionMismatch(409, { error: 'version_mismatch' }), true);
  assert.strictEqual(h.api.agIsAgreementVersionMismatch(409, { code: 'manifest_version_mismatch' }), true);
  assert.strictEqual(h.api.agIsAgreementVersionMismatch(500, { error: 'version_mismatch' }), false,
    'a transient server failure can trigger a stale-app reload');
  assert.strictEqual(h.api.agIsAgreementVersionMismatch(409, { error: 'identity_mismatch' }), false,
    'an identity conflict can be mislabeled as an app-version problem');
}

{
  const validateSource = extractFunction(shell, 'agValidateServerManifest');
  const staleSource = extractFunction(shell, 'agStaleManifestError');
  const validate = Function('BROWSER_AGREEMENT_EVIDENCE', 'MLS_AGREEMENTS',
    `${staleSource}\n${validateSource}\nreturn agValidateServerManifest;`)(
      [['doc.one', 'a'.repeat(64)]], [{ title: 'Document One', requiresCountersign: false }]
    );
  const manifest = {
    schemaVersion: 1,
    manifestId: 'manifest-current',
    version: 'v2',
    manifestSha256: 'b'.repeat(64),
    documents: [{ documentId: 'doc.one', sha256: 'a'.repeat(64), title: 'Document One', required: true, requiresCountersignature: false }],
  };
  for (const [field, value] of [['manifestId', {}], ['version', []]]) {
    assert.throws(() => validate({ ...manifest, [field]: value }),
      (error) => error && !error.code, `malformed ${field} was misclassified as stale evidence`);
  }
  for (const [field, value] of [['documentId', {}], ['title', []], ['sha256', {}], ['required', 'true'], ['requiresCountersignature', 0]]) {
    assert.throws(() => validate({ ...manifest, documents: [{ ...manifest.documents[0], [field]: value }] }),
      (error) => error && !error.code, `malformed document ${field} was misclassified as stale evidence`);
  }
}

function submitHarness(options = {}) {
  const submitSource = `async ${extractFunction(shell, 'agSubmitSign')}`;
  const manifest = {
    schemaVersion: 1,
    manifestId: 'manifest-current',
    version: 'v2',
    manifestSha256: 'b'.repeat(64),
    documents: [{ documentId: 'doc.one', sha256: 'a'.repeat(64), title: 'Document One', required: true, requiresCountersignature: false }],
  };
  const boxes = [{ checked: true }];
  const button = { disabled: false, textContent: 'Sign & continue' };
  const signer = { value: 'Synthetic Signer' };
  const errors = [];
  const requests = [];
  const manifestResolvers = [];
  const postEntries = [];
  let account = 'first@example.test';
  const context = {
    _agSubmitPromise: null,
    _agSubmitOwner: null,
    _agManifestEpoch: 0,
    _agSetupPolicyVersion: options.bodyNull ? 0 : 2,
    _agManifest: manifest,
    _agManifestPromise: null,
    _agRecoveredSignerName: '',
    ACTIVE_MLS_AGREEMENTS: [],
    MLS_AGREEMENTS: [],
    bkUser: { setupPolicyVersion: options.bodyNull ? 0 : 2, agreements: {} },
    session: { email: account },
    sfGateLoadingStarted: false,
    sfGateLoadingVisible: false,
    document: {
      getElementById(id) { return id === 'agSignName' ? signer : id === 'agSignBtn' ? button : null; },
      querySelectorAll() { return boxes; },
    },
    agLoadManifest: () => new Promise((resolve) => { manifestResolvers.push(() => resolve(manifest)); }),
    agClearManifestRecovery: () => {},
    agGateErr: (message) => errors.push(String(message || '')),
    sigPadIsEmpty: () => false,
    sigPadDataUrl: () => 'data:image/png;base64,AA==',
    agTryManifestRecovery: () => false,
    agManifestLoadErrorText: (error) => String(error && error.message || 'error'),
    agStaleManifestError: () => new Error('stale'),
    agLegacySignRequest: options.bodyNull ? () => null : () => ({ version: 'v2' }),
    agCeremonyKey: () => 'ceremony-key',
    bkBase: () => '',
    bkToken: () => 'token',
    fetch: (...args) => {
      requests.push(args);
      if (options.networkError) return Promise.reject(new Error('offline'));
      const response = { ok: options.status === 409 ? false : true, status: options.status || 200,
        json: async () => options.status === 409 ? { error: 'version_mismatch' } : { artifact: { status: 'stored', stored: true }, agreement: { manifestVersion: 'v2' } } };
      if (options.postPending || options.queuePosts) return new Promise((resolve, reject) => { postEntries.push({ resolve, reject, response }); });
      return Promise.resolve(response);
    },
    agIsAgreementVersionMismatch: (status, data) => Number(status) === 409 && ['version_mismatch', 'agreement_version_mismatch', 'manifest_version_mismatch'].includes(String(data && (data.code || data.error) || '').trim().toLowerCase()),
    agRefreshAccountReadiness: async () => false,
    agLegacySigningVerified: () => false,
    showAgreementsPending: () => {},
    showAgreementsGate: () => {},
    hideAgreementsGate: () => {},
    handle401: () => {},
    agAccountSetupSurface: () => 'ceremony',
    agDeliveryMessage: () => '',
    agLegacyDeliveryMessage: () => '',
    toast: () => {},
    startSession: () => {},
    maybePromptSetup: () => {},
    setTimeout: () => {},
    sessionStorage: { setItem: () => {} },
    uns: (key) => key,
    unsEmail: () => account,
  };
  vm.createContext(context);
  vm.runInContext(`${submitSource}\n${extractFunction(shell, 'agResetManifestState')}\nthis.submitApi={agSubmitSign, agResetManifestState, setEpoch:(v)=>{_agManifestEpoch=v;}, setAccount:(v)=>{session.email=v;account=v;}, setPolicy:(v)=>{_agSetupPolicyVersion=v;bkUser.setupPolicyVersion=v;}, reset:(previousAccount)=>agResetManifestState(previousAccount)};`, context);
  return {
    api: context.submitApi,
    manifestResolve(index = 0) { const resolve = manifestResolvers.splice(index, 1)[0]; assert(resolve, `manifest resolver ${index} was not pending`); resolve(); },
    settlePost(index = 0, outcome = 'success') {
      const entry = postEntries.splice(index, 1)[0];
      assert(entry, `sign POST ${index} was not pending`);
      if (outcome === 'network') { entry.reject(new Error('offline')); return; }
      if (outcome === '409') {
        entry.resolve({ ok: false, status: 409, json: async () => ({ error: 'version_mismatch' }) });
        return;
      }
      entry.resolve(entry.response);
    },
    postResolve() { this.settlePost(0); },
    requests,
    errors,
    button,
  };
}

function manifestLoadHarness() {
  const loadSource = `async ${extractFunction(shell, 'agLoadManifest')}`;
  const responses = [];
  let calls = 0;
  const context = {
    _agManifest: null,
    _agManifestPromise: null,
    _agManifestEpoch: 0,
    _agSetupPolicyVersion: null,
    _agRecoveredSignerName: '',
    ACTIVE_MLS_AGREEMENTS: [],
    MLS_AGREEMENTS: [],
    bkUser: { setupPolicyVersion: 2 },
    bkBase: () => '',
    bkToken: () => 'token',
    fetch: () => { calls += 1; return new Promise((resolve) => responses.push(resolve)); },
    agValidateServerManifest: (manifest) => ({ manifest, agreements: [] }),
    agTakeManifestRecoveryDraft: () => '',
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    unsEmail: () => 'first@example.test',
    sfNormalizeSessionAccount: (value) => String(value || '').trim().toLowerCase(),
    URL,
    Date,
  };
  vm.createContext(context);
  vm.runInContext(`let _agManifest=null,_agManifestPromise=null,_agManifestEpoch=0,_agSetupPolicyVersion=null,_agRecoveredSignerName='';\n${loadSource}\nthis.loadApi={agLoadManifest,bump:()=>{_agManifestEpoch++;_agManifest=null;_agManifestPromise=null;},state:()=>({_agManifestPromise,_agManifestEpoch})};`, context);
  return {
    api: context.loadApi,
    get calls() { return calls; },
    resolve(version) { responses.shift()({ ok: true, json: async () => ({ manifest: { version }, setupPolicyVersion: 2 }) }); },
  };
}

(async function runSubmitRuntimeTests(){
  const h = submitHarness();
  const first = h.api.agSubmitSign();
  const second = h.api.agSubmitSign();
  await new Promise((resolve) => setImmediate(resolve));
  h.manifestResolve();
  await Promise.all([first, second]);
  assert.strictEqual(h.requests.length, 1, 'concurrent submitters emitted more than one sign POST');
  assert.strictEqual(h.requests[0][1].method, 'POST', 'the shared submit path did not issue a POST');

  for (const options of [{ networkError: true }, { status: 409 }, { bodyNull: true }]) {
    const one = submitHarness(options);
    const first = one.api.agSubmitSign();
    const second = one.api.agSubmitSign();
    await new Promise((resolve) => setImmediate(resolve));
    one.manifestResolve();
    await Promise.all([first, second]);
    assert.strictEqual(one.requests.length, options.bodyNull ? 0 : 1,
      `concurrent ${options.bodyNull ? 'body-null' : options.networkError ? 'network' : '409'} submits were not single-flight`);
  }

  const switched = submitHarness({ postPending: true });
  const beforeSwitch = switched.api.agSubmitSign();
  const duringSwitch = switched.api.agSubmitSign();
  await new Promise((resolve) => setImmediate(resolve));
  switched.manifestResolve();
  await new Promise((resolve) => setImmediate(resolve));
  switched.api.setEpoch(1);
  assert.strictEqual(switched.requests.length, 1, 'account switch did not leave one in-flight sign POST');
  switched.postResolve();
  await Promise.all([beforeSwitch, duringSwitch]);
  assert.strictEqual(switched.requests.length, 1, 'account switch caused a duplicate sign POST');

  async function assertOldSubmitCannotAffectResetAccount(outcome, sameAccount = false) {
    const crossed = submitHarness({ postPending: true, queuePosts: true });
    const oldSubmit = crossed.api.agSubmitSign();
    let oldSettled = false;
    oldSubmit.then(() => { oldSettled = true; }, () => { oldSettled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    crossed.manifestResolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(crossed.requests.length, 1, `${outcome}: account A did not reach its single pending sign POST`);
    if (!sameAccount) crossed.api.setAccount('second@example.test');
    crossed.api.reset('first@example.test');

    const newSubmit = crossed.api.agSubmitSign();
    const duplicateNewSubmit = crossed.api.agSubmitSign();
    await new Promise((resolve) => setImmediate(resolve));
    crossed.manifestResolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(crossed.requests.length, 2, `${outcome}: account B/reset did not start exactly one new sign POST`);
    crossed.settlePost(1, 'success');
    await Promise.all([newSubmit, duplicateNewSubmit]);
    assert.strictEqual(oldSettled, false, `${outcome}: account A settled before account B completed`);
    const errorsBeforeOldSettles = crossed.errors.slice();
    const buttonBeforeOldSettles = { disabled: crossed.button.disabled, textContent: crossed.button.textContent };

    crossed.settlePost(0, outcome);
    await oldSubmit;
    assert.strictEqual(oldSettled, true, `${outcome}: old account submit never settled`);
    assert.strictEqual(crossed.requests.length, 2, `${outcome}: old account completion emitted another sign POST`);
    assert.deepStrictEqual(crossed.errors, errorsBeforeOldSettles, `${outcome}: old account completion changed the current account error UI`);
    assert.deepStrictEqual({ disabled: crossed.button.disabled, textContent: crossed.button.textContent }, buttonBeforeOldSettles,
      `${outcome}: old account completion changed the current account button UI`);
  }

  for (const outcome of ['success', 'network', '409']) await assertOldSubmitCannotAffectResetAccount(outcome);
  await assertOldSubmitCannotAffectResetAccount('success', true);

  {
    const crossed = submitHarness({ postPending: true, queuePosts: true });
    const oldSubmit = crossed.api.agSubmitSign();
    await new Promise((resolve) => setImmediate(resolve));
    crossed.api.setAccount('second@example.test');
    crossed.api.reset('first@example.test');
    const newSubmit = crossed.api.agSubmitSign();
    const duplicateNewSubmit = crossed.api.agSubmitSign();
    await new Promise((resolve) => setImmediate(resolve));
    crossed.manifestResolve(1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(crossed.requests.length, 1, 'the reset account did not reach one sign POST while old policy-0 manifest work was pending');
    crossed.settlePost(0, 'success');
    await Promise.all([newSubmit, duplicateNewSubmit]);
    const errorsBeforeOldBody = crossed.errors.slice();
    const buttonBeforeOldBody = { disabled: crossed.button.disabled, textContent: crossed.button.textContent };
    crossed.api.setPolicy(0);
    crossed.manifestResolve(0);
    await oldSubmit;
    assert.strictEqual(crossed.requests.length, 1, 'a late stale policy-0 body-null path emitted a sign POST');
    assert.deepStrictEqual(crossed.errors, errorsBeforeOldBody, 'a late stale policy-0 body-null path changed the current account error UI');
    assert.deepStrictEqual({ disabled: crossed.button.disabled, textContent: crossed.button.textContent }, buttonBeforeOldBody,
      'a late stale policy-0 body-null path changed the current account button UI');
  }

  const loads = manifestLoadHarness();
  const accountA = loads.api.agLoadManifest().catch((error) => error);
  loads.api.bump();
  const accountB = loads.api.agLoadManifest().catch((error) => error);
  loads.resolve('account-a');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(loads.calls, 2, 'old account completion cleared the newer manifest promise');
  const third = loads.api.agLoadManifest().catch((error) => error);
  assert.strictEqual(loads.calls, 2, 'third caller started a duplicate B manifest GET');
  loads.resolve('account-b');
  await Promise.all([accountA, accountB, third]);
})().catch((error) => { console.error(error); process.exitCode = 1; });

const loadManifest = extractFunction(shell, 'agLoadManifest');
assert(loadManifest.indexOf("requestEpoch!==_agManifestEpoch") < loadManifest.indexOf('agValidateServerManifest'),
  'an old account response can initiate recovery after the account switched');
assert(loadManifest.includes('_agRecoveredSignerName=agTakeManifestRecoveryDraft()'),
  'a successful current-manifest re-entry does not consume the safe draft and reload latch');

const ceremony = extractFunction(shell, 'showAgreementsCeremony');
assert(ceremony.includes("if(_agRecoveredSignerName&&nm){ nm.value=_agRecoveredSignerName; _agRecoveredSignerName=''; }"),
  'the one allowed non-assent field is not restored after current text renders');
assert(ceremony.includes('if(!agTryManifestRecovery(e)) agGateErr(agManifestLoadErrorText(e))'),
  'initial stale-manifest loading has no bounded recovery path');

const submit = extractFunction(shell, 'agSubmitSign');
const reset = extractFunction(shell, 'agResetManifestState');
assert(reset.includes('_agSubmitOwner=null; _agSubmitPromise=null'),
  'manifest reset does not detach the old submit owner and in-flight latch');
assert(submit.includes('const submitOwner={epoch:submitEpoch,active:true};') && submit.includes('_agSubmitOwner=submitOwner;'),
  'submit ownership is not established before manifest work starts');
assert.strictEqual((submit.match(/\/api\/agreements\/sign/g) || []).length, 1,
  'manifest recovery introduced a second agreement POST path');
assert(submit.includes('agIsAgreementVersionMismatch(res.status,data)') && submit.includes('agTryManifestRecovery(mismatch)'),
  'server-side version rotation after review does not restart with current text');
assert(submit.indexOf('agIsAgreementVersionMismatch(res.status,data)') < submit.indexOf('legacyResponseUncertain='),
  'deterministic version mismatch is swallowed by ambiguous-response recovery');
assert(submit.includes('if(!body){') && submit.indexOf('if(!body){') < submit.indexOf('const mismatch=agStaleManifestError'),
  'policy-0 stale browser constant still dead-ends before POST');

console.log('PASS agreement manifest recovery: one cache-busted re-entry, account isolation, assent reset, safe name restore, and no duplicate POST');
