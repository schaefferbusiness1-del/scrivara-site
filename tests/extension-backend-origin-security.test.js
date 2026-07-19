'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const DEFAULT_BACKEND = 'https://scrivara-backend.onrender.com';

function marked(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing marked source ${start} ... ${end}`);
  return source.slice(a, b);
}

const policySource = marked(background, '/* MLS_BACKEND_AUTH_POLICY_START', '/* MLS_BACKEND_AUTH_POLICY_END */');

function harness(config, token = 'session-jwt-secret') {
  const fetches = [];
  let tokenReads = 0;
  const context = {
    URL,
    String,
    Object,
    JSON,
    Promise,
    DEFAULT_BACKEND,
    getCfg: async () => Object.assign({}, config),
    getSessionToken: async () => { tokenReads += 1; return token; },
    fetch: async (url, options) => {
      fetches.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    _sessTok: '',
    _sessAt: 0
  };
  vm.createContext(context);
  vm.runInContext(policySource, context, { filename: 'background-backend-policy.js' });
  return { context, fetches, tokenReads: () => tokenReads };
}

async function assertBlocked(config, reason) {
  const h = harness(config);
  const result = await h.context.callBackend('/api/assist/extract', { pageText: 'synthetic non-PHI fixture' });
  assert.strictEqual(result.blocked, true, `${reason}: request was not blocked`);
  assert.strictEqual(result.reason, reason, `${reason}: wrong block reason`);
  assert.strictEqual(h.tokenReads(), 0, `${reason}: session token was read before rejection`);
  assert.strictEqual(h.fetches.length, 0, `${reason}: rejected destination reached fetch`);

  const status = await h.context.mlsConnectionStatus();
  assert.strictEqual(status.mode, 'invalid', `${reason}: rejected config appeared connected`);
  assert.strictEqual(status.reason, reason, `${reason}: status lost rejection reason`);
  assert.strictEqual(h.tokenReads(), 0, `${reason}: status read session token for rejected config`);
  assert.strictEqual(h.fetches.length, 0, `${reason}: status caused a fetch`);
}

(async () => {
  await assertBlocked({ mlsBackend: 'not a URL', mlsKey: '' }, 'backend-url-invalid');
  await assertBlocked({ mlsBackend: 'http://scrivara-backend.onrender.com', mlsKey: 'explicit-key' }, 'backend-https-required');
  await assertBlocked({ mlsBackend: 'https://user:pass@example.test', mlsKey: 'explicit-key' }, 'backend-credentials-rejected');
  await assertBlocked({ mlsBackend: DEFAULT_BACKEND + '?redirect=https://evil.test', mlsKey: 'explicit-key' }, 'backend-query-rejected');
  await assertBlocked({ mlsBackend: DEFAULT_BACKEND + '#evil', mlsKey: 'explicit-key' }, 'backend-query-rejected');
  await assertBlocked({ mlsBackend: 'https://evil.example', mlsKey: '' }, 'custom-backend-requires-api-key');
  await assertBlocked({ mlsBackend: DEFAULT_BACKEND + '/alternate', mlsKey: '' }, 'custom-backend-requires-api-key');
  await assertBlocked({ mlsBackend: 'https://SCRIVARA-backend.onrender.com', mlsKey: '' }, 'custom-backend-requires-api-key');

  const canonical = harness({ mlsBackend: DEFAULT_BACKEND + '/', mlsKey: '' });
  const canonicalResult = await canonical.context.callBackend('/api/assist/note', { transcript: 'synthetic fixture' });
  assert.strictEqual(canonicalResult.ok, true);
  assert.strictEqual(canonical.tokenReads(), 1, 'canonical session mode did not read exactly one login token');
  assert.strictEqual(canonical.fetches.length, 1);
  assert.strictEqual(canonical.fetches[0].url, DEFAULT_BACKEND + '/api/assist/note');
  assert.strictEqual(canonical.fetches[0].options.headers.Authorization, 'Bearer session-jwt-secret');
  const canonicalStatus = await canonical.context.mlsConnectionStatus();
  assert.strictEqual(canonicalStatus.mode, 'session');
  assert.strictEqual(canonicalStatus.custom, false);

  const guarded = harness({ mlsBackend: DEFAULT_BACKEND, mlsKey: '' });
  const guardedResult = await guarded.context.callBackend('/api/assist/extract', { pageText: 'synthetic fixture' }, async () => false);
  assert.strictEqual(guardedResult.reason, 'source-preflight-rejected');
  assert.strictEqual(guarded.fetches.length, 0, 'failed source preflight still reached fetch');

  const custom = harness({ mlsBackend: 'https://custom.example.test/root/', mlsKey: 'custom-api-key' });
  const customResult = await custom.context.callBackend('/api/assist/extract', { pageText: 'synthetic fixture' });
  assert.strictEqual(customResult.ok, true);
  assert.strictEqual(custom.tokenReads(), 0, 'custom API-key mode touched the MLS session token');
  assert.strictEqual(custom.fetches.length, 1);
  assert.strictEqual(custom.fetches[0].url, 'https://custom.example.test/root/api/assist/extract');
  assert.strictEqual(custom.fetches[0].options.headers.Authorization, 'Bearer custom-api-key');
  const customStatus = await custom.context.mlsConnectionStatus();
  assert.strictEqual(customStatus.mode, 'key');
  assert.strictEqual(customStatus.custom, true);
  assert.strictEqual(custom.tokenReads(), 0, 'custom status touched the MLS session token');

  assert(popup.includes("s.mode === 'invalid'"), 'popup has no blocked/invalid connection state');
  assert(popup.includes("type: 'mlsValidateBackendConfig'"), 'popup saves backend settings without worker validation');
  assert(popupHtml.includes('A custom HTTPS backend requires its own explicit API key'), 'popup does not explain custom-backend auth isolation');

  console.log('PASS extension backend origin security: session JWT is canonical-only; rejected/custom destinations cannot read it or fetch');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
