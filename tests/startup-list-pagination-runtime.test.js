'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');
const start = app.indexOf('const SF_SERVER_LIST_PAGE_SIZE=200,');
const end = app.indexOf('function ptServerLabel(', start);
assert(start >= 0 && end > start, 'bounded server-list hydration helper is missing');
const source = app.slice(start, end);

function response(status, payload) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload };
}

async function loadWith(queue, config, opts, endpoint, collection) {
  const urls = [];
  let yields = 0;
  const sandbox = {
    fetch: async (url, init) => {
      urls.push({ url, init });
      const next = queue.shift();
      if (typeof next === 'function') return next(url, init);
      if (next instanceof Error) throw next;
      return next;
    },
    bkBase: () => 'https://backend.test',
    bkToken: () => 'token',
    sfStartupValid: opts => !(opts && (opts.cancelled || (opts.signal && opts.signal.aborted))),
    setTimeout(fn, ms) { if (Number(ms) === 0) yields++; return global.setTimeout(fn, ms); },
    clearTimeout(id) { global.clearTimeout(id); },
    AbortController,
    Promise,
    Number,
    Array,
    Math
  };
  vm.createContext(sandbox);
  vm.runInContext(source + '\nthis.sfFetchPagedList=sfFetchPagedList;', sandbox);
  const result = await sandbox.sfFetchPagedList(endpoint || '/api/patients', collection || 'patients', opts || {}, config || { scopeOwn: true });
  return { result, urls, yields };
}

(async () => {
  const first = Array.from({ length: 200 }, (_, i) => ({ id: i }));
  const paged = await loadWith([
    response(200, { patients: first, returned: 200, has_more: true }),
    response(200, { patients: [{ id: 200 }, { id: 201 }], returned: 2, has_more: false })
  ], { scopeOwn: true });
  assert.strictEqual(paged.result.ok, true);
  assert.strictEqual(paged.result.rows.length, 202);
  assert.strictEqual(paged.urls.length, 2);
  assert(paged.urls[0].url.includes('/api/patients?scope=own&limit=200&offset=0'));
  assert(paged.urls[1].url.includes('/api/patients?scope=own&limit=200&offset=200'));
  assert.strictEqual(paged.urls[0].init.headers.Authorization, 'Bearer token');
  assert(paged.yields >= 3, 'multi-page hydration did not yield around page parsing/accumulation');

  const legacy = await loadWith([
    response(200, { patients: [{ id: 'legacy' }] })
  ], { scopeOwn: true });
  assert.strictEqual(legacy.result.ok, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(legacy.result.rows)), [{ id: 'legacy' }]);
  assert.strictEqual(legacy.urls.length, 1, 'legacy backend must not be queried twice');

  const ambiguousLegacy = await loadWith([
    response(200, { records: Array.from({ length: 200 }, (_, i) => ({ id: i })) })
  ], { scopeOwn: true }, {}, '/api/records', 'records');
  assert.strictEqual(ambiguousLegacy.result.ok, false);
  assert.strictEqual(ambiguousLegacy.result.incompatible, true,
    'a legacy endpoint that honors limit without has_more can silently truncate history');
  assert.strictEqual(ambiguousLegacy.result.rows.length, 0, 'ambiguous legacy partial data must not replace a complete local store');

  const failed = await loadWith([
    response(200, { patients: first, returned: 200, has_more: true }),
    response(503, {})
  ], { scopeOwn: true });
  assert.strictEqual(failed.result.ok, false);
  assert.strictEqual(failed.result.rows.length, 0, 'partial hydration must never replace the complete local store');

  const unauthorized = await loadWith([response(401, {})], { scopeOwn: true });
  assert.strictEqual(unauthorized.result.status, 401);
  assert.strictEqual(unauthorized.result.ok, false);

  const capped = await loadWith([
    response(200, { patients: first, returned: 200, has_more: true }),
    response(200, { patients: first, returned: 200, has_more: true })
  ], { scopeOwn: true, maxPages: 2, requestTimeoutMs: 100 });
  assert.strictEqual(capped.urls.length, 2, 'configured page cap was not enforced');
  assert.strictEqual(capped.result.ok, false);
  assert.strictEqual(capped.result.capped, true);
  assert.strictEqual(capped.result.rows.length, 0, 'capped partial hydration must not replace the local store');

  const timeoutAt = Date.now();
  const timedOut = await loadWith([() => new Promise(() => {})], {
    scopeOwn: true, requestTimeoutMs: 8
  });
  assert.strictEqual(timedOut.result.ok, false);
  assert.strictEqual(timedOut.result.timeout, true, 'a never-settling list request did not report its request deadline');
  assert(Date.now() - timeoutAt < 500, 'a never-settling list request escaped its bounded deadline');

  const parent = new AbortController();
  const abortedRun = loadWith([
    (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('parent-abort-relayed')), { once: true });
    })
  ], { scopeOwn: true, requestTimeoutMs: 1000 }, { signal: parent.signal });
  global.setTimeout(() => parent.abort(), 8);
  const parentAborted = await abortedRun;
  assert.strictEqual(parentAborted.result.ok, false);
  assert.strictEqual(parentAborted.result.aborted, true, 'parent startup abort did not stop the active page request');
  assert.strictEqual(parentAborted.urls[0].init.signal.aborted, true, 'parent abort was not relayed to the per-request controller');

  assert(app.includes("sfFetchPagedList('/api/patients','patients',opts,{scopeOwn:true,attempts:3,retryDelays:[600,1500]})"),
    'startup patient hydration is not owner-scoped and bounded');
  assert(app.includes("sfFetchPagedList('/api/records','records',opts,{scopeOwn:true})"),
    'startup record hydration is not owner-scoped and bounded');
  assert(app.includes("sfFetchPagedList('/api/patients','patients',{},{})"),
    'team hydration no longer pages the full authorized roster');
  assert(app.includes('SF_SERVER_LIST_MAX_PAGES=500') && app.includes('SF_SERVER_LIST_REQUEST_TIMEOUT_MS=12000'),
    'server-list hydration lost its finite page or per-request deadline');
  assert(app.includes('await sfHydrationYield();') && app.includes('rowIndex%SF_SERVER_LIST_PAGE_SIZE===0'),
    'page/merge work no longer yields cooperatively to browser input');

  console.log('PASS startup list pagination: bounded requests/pages, safe legacy handling, cooperative yields, complete-set merge, and team paging');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
