'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');

function marked(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing marked source ${start} ... ${end}`);
  return source.slice(a, b);
}

const backupSource = marked(background, '/* MLS_NIGHTLY_BACKUP_SAFE_START */', '/* MLS_NIGHTLY_BACKUP_SAFE_END */');
const ATHENA_URL = 'https://athenanet.athenahealth.com/1/123/clinical?patient=synthetic#chart';
const STRONG_ID = { name: 'Synthetic Fixture', dob: '01/01/2000', mrn: 'SYNTH-1', score: 8, via: 'banner', frameId: 7 };

function makeHarness(options = {}) {
  const queryTabs = (options.tabs || []).map((tab) => Object.assign({}, tab));
  const getSequence = (options.getSequence || []).map((tab) => tab && Object.assign({}, tab));
  const identities = (options.identities || []).map((identity) => identity && Object.assign({}, identity));
  const backendCalls = [];
  const saved = [];
  let getCalls = 0;
  let identityCalls = 0;
  let textReads = 0;

  const context = {
    URL,
    String,
    Object,
    Number,
    Array,
    Date,
    Math,
    Promise,
    console,
    mlsReadChartIdentity() {},
    mlsBestIdentityFrom(results) {
      const first = results && results[0];
      if (!first || !first.result) return null;
      return Object.assign({}, first.result, { frameId: first.frameId });
    },
    mlsShadowIdentityTry: async () => null,
    getBackup: async () => ({ enabled: true, hour: 2, minute: 0 }),
    setBackup: async (value) => { saved.push(value); return value; },
    callBackend: async (endpoint, body, beforeFetch) => {
      if (typeof beforeFetch === 'function' && !(await beforeFetch())) {
        return { ok: false, blocked: true, reason: 'source-preflight-rejected', error: 'The source page changed before upload. Nothing was sent.' };
      }
      backendCalls.push({ endpoint, body });
      return options.backendResult || { ok: true, patient: { synthetic: true } };
    },
    chrome: {
      tabs: {
        query: async () => queryTabs.map((tab) => Object.assign({}, tab)),
        get: async (tabId) => {
          const next = getSequence.length
            ? getSequence[Math.min(getCalls, getSequence.length - 1)]
            : queryTabs.find((tab) => tab.id === tabId);
          getCalls += 1;
          if (!next) throw new Error('tab missing');
          return Object.assign({}, next);
        }
      },
      scripting: {
        executeScript: async (request) => {
          if (request.target && request.target.allFrames) {
            const identity = identities.length
              ? identities[Math.min(identityCalls, identities.length - 1)]
              : null;
            identityCalls += 1;
            return identity ? [{ frameId: identity.frameId, result: Object.assign({}, identity) }] : [];
          }
          textReads += 1;
          assert.deepStrictEqual(Array.from(request.target.frameIds || []), [STRONG_ID.frameId], 'backup text read was not bound to the verified identity frame');
          return [{ frameId: STRONG_ID.frameId, result: options.pageText || 'SYNTHETIC CHART FIXTURE ONLY — NO PHI' }];
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(backupSource, context, { filename: 'background-nightly-backup.js' });
  return {
    context,
    backendCalls,
    saved,
    getCalls: () => getCalls,
    identityCalls: () => identityCalls,
    textReads: () => textReads
  };
}

async function assertNothingSent(label, options, expected = {}) {
  const h = makeHarness(options);
  const result = await h.context.runNightlyBackup('test');
  assert.strictEqual(result.ok, false, `${label}: unsafe run reported success`);
  assert.strictEqual(h.backendCalls.length, 0, `${label}: backend received chart/page data`);
  assert.strictEqual(h.textReads(), expected.textReads || 0, `${label}: unexpected page-text reads`);
  if (expected.identityCalls != null) assert.strictEqual(h.identityCalls(), expected.identityCalls, `${label}: unexpected identity probes`);
  return { h, result };
}

(async () => {
  const pure = makeHarness();
  assert.strictEqual(pure.context.mlsBackupAthenaProductUrl('https://athenanet.athenahealth.com/chart'), true);
  assert.strictEqual(pure.context.mlsBackupAthenaProductUrl('http://athenanet.athenahealth.com/chart'), false);
  assert.strictEqual(pure.context.mlsBackupAthenaProductUrl('https://identity.athenahealth.com/login'), false);
  assert.strictEqual(pure.context.mlsBackupAthenaProductUrl('https://athenanet.athenahealth.com.evil.test/chart'), false);
  assert.strictEqual(pure.context.mlsBackupAthenaProductUrl('https://child.athenanet.athenahealth.com/chart'), false);
  assert.strictEqual(pure.context.mlsBackupAthenaProductUrl('https://user:pass@athenanet.athenahealth.com/chart'), false);
  assert.strictEqual(pure.context.mlsBackupStrongIdentity(Object.assign({}, STRONG_ID, { frameId: undefined })), false);
  assert.strictEqual(pure.context.mlsBackupStrongIdentity(Object.assign({}, STRONG_ID, { score: -1 })), false);

  await assertNothingSent('unrelated recent tabs', {
    tabs: [
      { id: 1, url: 'https://bank.example.test/accounts', title: 'Bank', lastAccessed: 50 },
      { id: 2, url: 'https://news.example.test/', title: 'athena breaking news', lastAccessed: 100 }
    ]
  }, { identityCalls: 0 });

  await assertNothingSent('Athena login host', {
    tabs: [{ id: 3, url: 'https://identity.athenahealth.com/login', title: 'athenaOne login', lastAccessed: 100 }]
  }, { identityCalls: 0 });

  await assertNothingSent('exact host without chart identity', {
    tabs: [{ id: 4, url: ATHENA_URL, title: 'athenaOne', lastAccessed: 100 }],
    getSequence: [{ id: 4, url: ATHENA_URL }],
    identities: [null]
  }, { identityCalls: 1 });

  await assertNothingSent('navigation race before chart read', {
    tabs: [{ id: 5, url: ATHENA_URL, title: 'athenaOne', lastAccessed: 100 }],
    getSequence: [
      { id: 5, url: ATHENA_URL },
      { id: 5, url: 'https://bank.example.test/accounts' }
    ],
    identities: [STRONG_ID]
  }, { identityCalls: 1, textReads: 0 });

  await assertNothingSent('navigation race before fetch', {
    tabs: [{ id: 6, url: ATHENA_URL, title: 'athenaOne', lastAccessed: 100 }],
    getSequence: [
      { id: 6, url: ATHENA_URL },
      { id: 6, url: ATHENA_URL },
      { id: 6, url: 'https://evil.example.test/collect' }
    ],
    identities: [STRONG_ID, STRONG_ID]
  }, { identityCalls: 2, textReads: 1 });

  await assertNothingSent('patient identity changed during read', {
    tabs: [{ id: 7, url: ATHENA_URL, title: 'athenaOne', lastAccessed: 100 }],
    getSequence: [{ id: 7, url: ATHENA_URL }],
    identities: [STRONG_ID, Object.assign({}, STRONG_ID, { name: 'Different Synthetic Fixture', mrn: 'SYNTH-2' })]
  }, { identityCalls: 2, textReads: 1 });

  const secondChart = makeHarness({
    tabs: [
      { id: 70, url: ATHENA_URL, title: 'athenaOne dashboard', lastAccessed: 200 },
      { id: 71, url: ATHENA_URL, title: 'athenaOne chart', lastAccessed: 100 }
    ],
    getSequence: [
      { id: 70, url: ATHENA_URL },
      { id: 71, url: ATHENA_URL },
      { id: 71, url: ATHENA_URL },
      { id: 71, url: ATHENA_URL }
    ],
    identities: [null, STRONG_ID, STRONG_ID]
  });
  const secondResult = await secondChart.context.runNightlyBackup('test');
  assert.strictEqual(secondResult.ok, true, 'backup did not try another exact Athena tab after an unverified dashboard');
  assert.strictEqual(secondChart.backendCalls.length, 1);

  const valid = makeHarness({
    tabs: [{ id: 8, url: ATHENA_URL, title: 'athenaOne', lastAccessed: 100 }],
    getSequence: [{ id: 8, url: ATHENA_URL }],
    identities: [STRONG_ID, STRONG_ID]
  });
  const result = await valid.context.runNightlyBackup('test');
  assert.strictEqual(result.ok, true, 'verified exact Athena chart did not back up');
  assert.strictEqual(result.captured, 1);
  assert.strictEqual(valid.textReads(), 1, 'verified chart was not read exactly once');
  assert.strictEqual(valid.identityCalls(), 2, 'verified chart did not get pre/post identity proof');
  assert.strictEqual(valid.backendCalls.length, 1, 'verified chart did not produce exactly one backend call');
  assert.strictEqual(valid.backendCalls[0].endpoint, '/api/assist/extract');
  assert.strictEqual(valid.backendCalls[0].body.url, 'https://athenanet.athenahealth.com/1/123/clinical', 'backup leaked query/hash in URL metadata');

  assert(!popupHtml.includes('Max patients per run'), 'popup still promises a multi-patient browser backup');
  assert(popupHtml.includes('the one patient chart already open'), 'popup does not describe the one-chart limit');
  assert(popup.includes('one currently open verified Athena chart'), 'popup status copy still describes a broad EMR backup');

  console.log('PASS nightly backup tab safety: exact Athena host + strong stable identity + pre-read/pre-fetch URL proof are required');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
