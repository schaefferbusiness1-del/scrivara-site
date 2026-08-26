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
    window: { __MLS_AV: 'qa-build' },
    unsEmail: () => account,
    sfNormalizeSessionAccount: (value) => String(value || '').trim().toLowerCase(),
    sigPadClear: () => { signatureClears += 1; },
    agSyncSignState: () => { syncs += 1; },
    _agManifestEpoch: 0,
    _agManifest: null,
    _agManifestPromise: null,
    _agSetupPolicyVersion: null,
    _agRecoveredSignerName: '',
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
assert.strictEqual((submit.match(/\/api\/agreements\/sign/g) || []).length, 1,
  'manifest recovery introduced a second agreement POST path');
assert(submit.includes('agIsAgreementVersionMismatch(res.status,data)') && submit.includes('agTryManifestRecovery(mismatch)'),
  'server-side version rotation after review does not restart with current text');
assert(submit.indexOf('agIsAgreementVersionMismatch(res.status,data)') < submit.indexOf('legacyResponseUncertain='),
  'deterministic version mismatch is swallowed by ambiguous-response recovery');
assert(submit.includes("if(!body){\n      const mismatch=agStaleManifestError"),
  'policy-0 stale browser constant still dead-ends before POST');

console.log('PASS agreement manifest recovery: one cache-busted re-entry, account isolation, assent reset, safe name restore, and no duplicate POST');
