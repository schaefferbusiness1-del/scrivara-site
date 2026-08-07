'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const visitsSource = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const productionLoader = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const stagingLoader = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');

/* PIN MOVED DELIBERATELY 2026-08-06: from the hand-maintained '20260729vis11'
   to the shared build-number cache-buster. feat_visits.js gained the history
   identity binding, which made it stale against its own token — the third
   hand-maintained token to go stale in one evening (after the template library
   and the pull flow), each one a fix a returning browser never received. The
   build-number form follows the build and cannot go stale again, so the pin now
   asserts the FORM rather than a value someone must remember to move. */
const visitCacheKey = "feat_visits.js?v='+(window.__MLS_AV||Date.now())";
assert(productionLoader.includes(visitCacheKey), 'production must load feat_visits with the build-number cache-buster');
assert(stagingLoader.includes(visitCacheKey), 'staging must load feat_visits with the same build-number cache-buster');
assert(!/feat_visits\.js\?v=20\d{6}/.test(productionLoader) && !/feat_visits\.js\?v=20\d{6}/.test(stagingLoader),
  'a hand-maintained date token came back on the feat_visits loader — it will go stale at the next change');

const start = background.indexOf('/* === MLS Assist visit-reader lineage (active: v2.9.22 r4)');
const end = background.indexOf('\n})();', start);
assert(start >= 0 && end > start, 'all-visits reader IIFE not found');
const readerSource = background.slice(start, end + '\n})();'.length);

for (const invariant of [
  'freezeVisitHint(hint)',
  /* 3.0.2: the same-frame identity gate now runs PER CANDIDATE FRAME (v26.3
     FL cached-iframe fix) — the gate and the same-frame identity read remain
     mandatory, bound to each candidate. */
  'visitIdentityGate(frozenHint, ecIdentity)',
  "exec(emrId, [ecCand.frameId], ['identity', cfg])",
  "['click', cfg, i, expected]",
  "['openDetailFrame', cfg, i, expected]",
  "['detailFrame', detailCfg, i, expected]",
  'allowMinimalBody: true',
  'var minimalWindow = (Date.now() + 600) >= detailDeadline',
  'minimalBodies: minimalBodies',
  "['closeDetailFrame', cfg]",
  'encounterDetailFrames(emrId, listFrame)',
  'waitForDetailSurface(emrId, listFrame, true',
  'coldRetryWaitMs',
  'runBoundAttempt(coldRetryWaitMs)',
  'retryCount: retryCount',
  "strategy: 'bound-click'",
  "reason: 'visits-time-budget-exceeded'",
  'maxEncountersByBudget: maxByBudget',
  'indexComplete: true, bodyComplete: bodyComplete',
  'authoritativeEmpty',
  "res.readerVersion = '2.9.22-visits-r4-two-stage'"
]) assert(readerSource.includes(invariant), `missing full-detail reader invariant: ${invariant}`);

assert(readerSource.includes('rich: false, indexOnly: true'), 'rich list rows must remain index-only');
assert(readerSource.includes("reason: 'no-bound-clinical-detail'"), 'thin/shell rows must fail without encounter-scoped clinical detail');
assert(readerSource.includes('preDetailHashes') && readerSource.includes('marker.preDetailHashes'), 'pre-existing visible row summaries must not masquerade as newly opened detail');
assert(!readerSource.includes('hint.athenaId || hint.patientId'), 'local MLS patientId must never masquerade as Athena MRN');
assert(readerSource.includes("sourceVisitKey: expected.rowKey"), 'bound stable source row key must reach the visit model');
assert(readerSource.includes("patientName: identity.name") && readerSource.includes("patientDob: identity.dob"), 'every full encounter must carry its same-frame patient proof into app validation');
assert(readerSource.includes('stableKeysComplete'), 'complete receipt must prove unique stable visit keys');

const driverStart = readerSource.indexOf('function mlsVisitsDriverFn(op, cfg, idx, expectedBinding)');
assert(driverStart >= 0, 'visit DOM driver start not found');
const driverEnd = readerSource.indexOf('// ---- orchestrator (background scope', driverStart);
assert(driverEnd > driverStart, 'visit DOM driver end not found');
const driverDecl = readerSource.slice(driverStart, driverEnd);
function enumerateEmptyState(text) {
  const node = { hidden: false, innerText: text, textContent: text };
  const context = {
    Map, Math, Number, String, Array, Object, RegExp, Date,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    document: {
      querySelectorAll(selector) { return selector.includes('[data-testid*="visit"') ? [node] : []; },
      querySelector() { return null; }, body: { innerText: '', textContent: '' }
    }
  };
  vm.runInNewContext(driverDecl + '\nthis.__result = mlsVisitsDriverFn("enumerate", {});', context, { filename: 'visit-dom-driver.js', timeout: 1000 });
  return context.__result;
}
const explicitEmpty = enumerateEmptyState('There are no prior visits on file.');
assert.strictEqual(explicitEmpty.ok, true);
assert.strictEqual(explicitEmpty.authoritativeEmpty, true);
assert.strictEqual(explicitEmpty.count, 0);
const ambiguousEmpty = enumerateEmptyState('No visits filter applied');
assert.strictEqual(ambiguousEmpty.ok, false, 'unscoped/noise empty copy was treated as authoritative');

function makeReader(options = {}) {
  const calls = [];
  let detailOpen = false;
  const cachedFrame = options.cachedFrame === true;
  let detailDocVersion = 0;
  const openAttempts = {};
  const defaultRows = [
    {
      index: 0, date: '01/02/2026', type: 'Office visit',
      rowText: '01/02/2026 Office visit ' + 'summary '.repeat(40), textLen: 340,
      rich: false, indexOnly: true,
      binding: { index: 0, rowKey: 'enc:a', encounterId: 'a', date: '01/02/2026', indexTextHash: 'h1', indexTextLen: 340 }
    },
    {
      index: 1, date: '02/03/2026', type: 'Follow-up',
      rowText: '02/03/2026 Follow-up', textLen: 20,
      rich: false, indexOnly: true,
      binding: { index: 1, rowKey: 'enc:b', encounterId: 'b', date: '02/03/2026', indexTextHash: 'h2', indexTextLen: 20 }
    }
  ];
  const rows = options.rows || defaultRows;
  const exactIdentity = options.identity || { name: 'Exact Patient', dob: '01/02/1960', mrn: '1234', score: 50, via: 'banner' };
  const listeners = [];
  const context = {
    console, Promise, Date, Math, Object, Array, String, Number, RegExp, JSON,
    /* Hydration/poll sleeps stay immediate, while absolute-deadline timers stay
       pending. Making every timeout immediate lets the new hard-deadline race
       beat even an already-resolved browser operation, which is not a browser
       timing model and masks the reader behavior this fixture is testing. */
    setTimeout: (fn, ms) => { if (Number(ms || 0) < 10000) queueMicrotask(fn); return 1; }, clearTimeout: () => {},
    setInterval: () => 1, clearInterval: () => {},
    mlsReadChartIdentity: function identityReader() {},
    mlsReadChartIdentityShadow: function identityShadowReader() {},
    self: null,
    chrome: {
      runtime: { id: 'mls-test-extension', /* csr-1.x orphan guards treat an id-less runtime as a dead context */ onMessage: { addListener: fn => listeners.push(fn) } },
      tabs: {
        query: (_q, cb) => cb([{ id: 77, active: false, url: 'https://athenanet.athenahealth.com/chart' }]),
        sendMessage: () => {}
      },
      storage: {
        local: {
          get: (_keys, cb) => cb({ mlsAthenaVisitsCfg: { waitMs: options.waitMs == null ? 0 : options.waitMs, initialWaitMs: 0, visitTabWaitMs: 0, maxVisits: 50, minRealLen: 60, maxReadMs: options.maxReadMs || 165000 } }),
          set: () => {}
        }
      },
      webNavigation: {
        getAllFrames: async () => (detailOpen || cachedFrame) ? [{
          frameId: 9, parentFrameId: 5,
          documentId: 'doc-' + detailDocVersion,
          url: 'https://athenanet.athenahealth.com/encounter/summary?FROMSTREAMLINED=1&CROSSFRAMEID=test'
        }] : []
      },
      scripting: {
        executeScript: async details => {
          const op = details.args && details.args[0];
          calls.push({ op: op || (details.func && details.func.name) || 'identity', target: details.target, args: details.args });
          if (!op) return [{ frameId: (details.target.frameIds || [5])[0], result: exactIdentity }];
          if (op === 'openVisits') return [{ frameId: 5, result: { ok: true } }];
          if (op === 'diagnose') return [{ frameId: 5, result: { groupCount: 1 } }];
          if (op === 'enumerate') return [{ frameId: 5, result: { ok: true, selector: options.authoritativeEmpty ? 'verified-empty-state' : 'li.encounter-list-item', count: rows.length, indexComplete: true, authoritativeEmpty: options.authoritativeEmpty === true, rows, score: 99, strongRows: rows.length, uniqueDates: rows.length } }];
          if (op === 'click') {
            const binding = details.args[3];
            return [{ frameId: 5, result: { clicked: true, binding } }];
          }
          if (op === 'closeDetailFrame') {
            detailOpen = false;
            return [{ frameId: 5, result: { ok: true, closed: true } }];
          }
          if (op === 'detailSurfaceState') {
            return [{ frameId: 5, result: { open: detailOpen, iframePresent: detailOpen || cachedFrame, iframeContract: detailOpen || cachedFrame } }];
          }
          if (op === 'openDetailFrame') {
            const binding = details.args[3];
            const index = Number(details.args[2]);
            openAttempts[index] = (openAttempts[index] || 0) + 1;
            if (options.coldSurfaceOnce === true && index === Number(options.coldSurfaceIndex || 0) && openAttempts[index] === 1) {
              return [{ frameId: 5, result: { clicked: true, binding, stage: 'slideout-requested' } }];
            }
            detailOpen = true;
            detailDocVersion++;
            return [{ frameId: 5, result: { clicked: true, binding, stage: 'slideout-requested' } }];
          }
          if (op === 'detailFrameProbe') {
            return [{ frameId: 9, result: { frameContract: true, sectionPresent: true, contentHash: 'body-' + detailDocVersion, len: 500 + detailDocVersion, ready: 'complete' } }];
          }
          if (op === 'detailFrame') {
            const i = details.args[2], binding = details.args[3];
            if (options.missingDetailIndex === i) return [{ frameId: 5, result: { fullDetail: false, indexOnly: true, raw: '02/03/2026 shell', reason: 'no-bound-clinical-detail', binding } }];
            const returned = options.badBindingIndex === i ? Object.assign({}, binding, { rowKey: 'enc:wrong' }) : binding;
            return [{ frameId: 5, result: {
              fullDetail: true, indexOnly: false, binding: returned, frameContract: true,
              raw: `HPI: encounter ${i}. Assessment: lumbar radiculopathy. Physical exam documented. Plan: continue treatment and follow-up.`,
              cpt: [], icd10: ['M54.16']
            } }];
          }
          return [];
        }
      }
    }
  };
  context.self = context;
  vm.runInNewContext(readerSource, context, { filename: 'all-visits-reader.js', timeout: 1000 });
  return { context, calls };
}

(async () => {
  const success = makeReader();
  const good = await success.context.__mlsOverlayReadVisits(11, { name: 'Exact Patient', dob: '01/02/1960', mrn: '1234' });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.visits.length, 2);
  assert(good.visits.every(v => v.fullDetail === true && v.indexOnly === false));
  assert(good.visits.every(v => v.patientName === 'Exact Patient' && v.patientDob === '01/02/1960' && v.patientMrn === '1234'), 'full encounter rows lost exact patient proof');
  assert.deepStrictEqual(
    success.calls.filter(c => c.op === 'click').map(c => c.args[2]),
    [0, 1],
    'every rich or thin index row must be opened'
  );
  assert(success.calls.filter(c => c.op === 'detailFrame').every(c => Array.isArray(c.target.frameIds) && c.target.frameIds[0] === 9), 'details must be read only in the uniquely created encounter-summary child frame');
  assert.strictEqual(success.calls.filter(c => c.op === 'openDetailFrame').length, 2, 'every encounter must use the second-stage slideout trigger');
  assert(success.calls.filter(c => c.op === 'closeDetailFrame').length >= 4, 'the encounter slideout must be cleaned before and after every read');
  assert.strictEqual(good.receipt.indexComplete, true);
  assert.strictEqual(good.receipt.bodyComplete, true);
  assert.strictEqual(good.receipt.fullDetail, true);
  assert.strictEqual(good.receipt.stableKeysComplete, true);
  assert.strictEqual(good.receipt.expected, 2);
  assert.strictEqual(good.receipt.parsed, 2);

  const cached = makeReader({ cachedFrame: true });
  const cachedGood = await cached.context.__mlsOverlayReadVisits(11, { name: 'Exact Patient', dob: '01/02/1960', mrn: '1234' });
  assert.strictEqual(cachedGood.ok, true, 'a safely reused hidden Athena encounter iframe must be accepted after its document changes');
  assert.strictEqual(cachedGood.receipt.parsed, 2);

  const cold = makeReader({ coldSurfaceOnce: true, coldSurfaceIndex: 0, waitMs: 300 });
  const coldGood = await cold.context.__mlsOverlayReadVisits(11, { name: 'Exact Patient', dob: '01/02/1960', mrn: '1234' });
  assert.strictEqual(coldGood.ok, true, 'one cold briefing hydration delay must recover on the bounded same-row retry');
  assert.strictEqual(coldGood.receipt.parsed, 2);
  assert.strictEqual(coldGood.receipt.retryCount, 1, 'cold recovery receipt must report exactly one retry');
  assert.deepStrictEqual(
    cold.calls.filter(c => c.op === 'click').map(c => c.args[2]),
    [0, 0, 1],
    'cold recovery must re-click only the same frozen row before continuing'
  );
  assert.strictEqual(cold.calls.filter(c => c.op === 'openDetailFrame' && c.args[2] === 0).length, 2, 'cold row did not use exactly one second-stage retry');

  const unknownZero = makeReader({ rows: [] });
  const unknownEmpty = await unknownZero.context.__mlsOverlayReadVisits(11, { name: 'Exact Patient', dob: '01/02/1960' });
  assert.strictEqual(unknownEmpty.ok, false, 'an unexplained zero-row visit surface was reported complete');
  /* Pin updated in 3.0.17, deliberately, because the BEHAVIOUR this fixture
     exercises changed for the better. A surface that never becomes a complete
     index used to be retried 47 times at 3.5s — ~165s — before reporting. It
     now stops once the answer is provably fixed: same gate, same row and child
     counts, 16 passes running. The verdict is identical; it just arrives about
     110 seconds sooner, which is most of the "burns 93-160s per patient" in the
     2026-07-24 handoff.
     The refusal is asserted by PREFIX plus the early-exit marker, so this pin
     still fails if the verdict ever changes, and separately records that the
     fixture is taking the early path rather than timing out. */
  assert(unknownEmpty.reason.indexOf('encounter-index-incomplete') === 0,
    'the verdict must still be encounter-index-incomplete, got: ' + unknownEmpty.reason);
  assert(/\[unchanged-for-\d+-passes;gave-up-early\]/.test(unknownEmpty.reason),
    'a surface that never changes must stop early and say so, not exhaust 47 passes: ' + unknownEmpty.reason);

  const provenZero = makeReader({ rows: [], authoritativeEmpty: true });
  const empty = await provenZero.context.__mlsOverlayReadVisits(11, { name: 'Exact Patient', dob: '01/02/1960' });
  assert.strictEqual(empty.ok, true, 'an explicit patient-scoped no-visits state did not complete');
  assert.strictEqual(empty.visits.length, 0);
  assert.strictEqual(empty.receipt.expected, 0);
  assert.strictEqual(empty.receipt.parsed, 0);
  assert.strictEqual(empty.receipt.authoritativeEmpty, true);
  assert.strictEqual(empty.receipt.complete, true);

  /* 3.0.2: a GENUINE wrong patient differs on the stable athena id. (The old
     fixture kept mrn+dob identical and differed only on the name — that is
     now the accepted stale-frame-name case below, per the owner directive.) */
  const wrong = makeReader({ identity: { name: 'Different Patient', dob: '01/02/1960', mrn: '9999', score: 50 } });
  const blocked = await wrong.context.__mlsOverlayReadVisits(11, { name: 'Exact Patient', dob: '01/02/1960', mrn: '1234' });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, 'no-athena-tab', 'wrong-patient Athena tabs must be rejected during exact-tab selection');
  assert.strictEqual(wrong.calls.filter(c => c.op === 'click').length, 0, 'identity mismatch must block before encounter reads');
  assert.notStrictEqual(blocked.receipt.indexComplete, true);
  assert.notStrictEqual(blocked.receipt.bodyComplete, true);
  assert.strictEqual(blocked.receipt.fullDetail, false);

  /* 3.0.2: stale/reformatted frame NAME with a MATCHING stable id + DOB is
     the SAME patient — the read must proceed and complete (the live v26.3 FL
     failure mode: every body refused on the name while the id was right). */
  const staleName = makeReader({ identity: { name: 'Different Patient', dob: '01/02/1960', mrn: '1234', score: 50 } });
  const staleOk = await staleName.context.__mlsOverlayReadVisits(11, { name: 'Exact Patient', dob: '01/02/1960', mrn: '1234' });
  assert.strictEqual(staleOk.ok, true, 'a verified stable-id match must not be refused on a stale frame name');
  assert.strictEqual(staleOk.receipt.complete, true);

  const thin = makeReader({ missingDetailIndex: 1 });
  const incomplete = await thin.context.__mlsOverlayReadVisits(11, { name: 'Exact Patient', dob: '01/02/1960' });
  assert.strictEqual(incomplete.ok, false);
  assert.strictEqual(incomplete.reason, 'visit-bodies-incomplete');
  assert.strictEqual(incomplete.visits.length, 0, 'partial clinical bodies must not escape as a complete batch');
  assert.strictEqual(incomplete.receipt.indexComplete, true);
  assert.strictEqual(incomplete.receipt.bodyComplete, false);
  assert.strictEqual(incomplete.receipt.complete, false);
  assert.strictEqual(incomplete.receipt.fullDetail, false);
  assert.strictEqual(incomplete.receipt.attempted, 2);

  const manyRows = Array.from({ length: 30 }, (_, i) => ({
    index: i, date: `03/${String((i % 28) + 1).padStart(2, '0')}/2026`, type: 'Office visit',
    rowText: `row ${i}`, textLen: 20, rich: false, indexOnly: true,
    binding: { index: i, rowKey: `enc:budget-${i}`, encounterId: `budget-${i}`, date: `03/${String((i % 28) + 1).padStart(2, '0')}/2026`, indexTextHash: `bh${i}`, indexTextLen: 20 }
  }));
  const budgeted = makeReader({ rows: manyRows, waitMs: 300, maxReadMs: 30000 });
  const early = await budgeted.context.__mlsOverlayReadVisits(11, { name: 'Exact Patient', dob: '01/02/1960' });
  assert.strictEqual(early.ok, false);
  assert.strictEqual(early.reason, 'visits-time-budget-exceeded');
  assert.strictEqual(early.receipt.indexComplete, true);
  assert.strictEqual(early.receipt.bodyComplete, false);
  assert.strictEqual(early.receipt.attempted, 0);
  assert.strictEqual(budgeted.calls.filter(c => c.op === 'click').length, 0, 'an impossible history must fail before partially opening encounters');

  const patients = [{ id: 'p1', name: 'Exact Patient', dob: '01/02/1960', visits: [] }];
  const visitContext = {
    console, Promise, Date, Math, Object, Array, String, Number, RegExp, JSON,
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    document: { readyState: 'loading', addEventListener: () => {}, getElementById: () => null },
    location: { pathname: '/ScribeFlow.html' },
    getPatients: () => patients, findPatient: id => patients.find(p => p.id === id) || null,
    upsertPatient: p => { const i = patients.findIndex(x => x.id === p.id); if (i >= 0) patients[i] = p; },
    addEventListener: () => {}, removeEventListener: () => {}, postMessage: () => {}
  };
  visitContext.window = visitContext;
  vm.runInNewContext(visitsSource, visitContext, { filename: 'feat_visits.js', timeout: 1000 });
  const model = visitContext.__mlsVisitModel;
  const trust = { source: 'athena-copy', identityVerified: true, identityBinding: 'p1' };

  model.addVisit('p1', { encounterId: 'e-index', date: '2026-01-02', type: 'Office visit', textHead: '01/02/2026 Office visit summary' }, trust);
  let stored = model.getVisits(patients[0]);
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].indexOnly, true);
  assert.strictEqual(stored[0].raw, '', 'index metadata must never be copied into the clinical body');
  assert.strictEqual(stored[0].textHead, '01/02/2026 Office visit summary', 'textHead must be preserved for audit/display');
  assert.strictEqual(model.organizePatientHistory('p1').reason, 'full-detail-unavailable', 'index text must not feed clinical organization');

  model.addVisit('p1', {
    encounterId: 'e-index', date: '2026-01-02', type: 'Office visit', fullDetail: true,
    raw: 'HPI: initial verified body. Assessment: condition A. Plan: treatment A.', icd10: ['M54.16'], findings: 'Old finding', plan: 'Old plan', aiSummary: 'Old AI summary'
  }, Object.assign({}, trust, { bodyComplete: true }));
  model.addVisit('p1', {
    encounterId: 'e-index', date: '2026-01-02', type: 'Office visit', fullDetail: true,
    raw: 'Assessment: corrected shorter body. Plan: revised.', icd10: ['M54.17']
  }, Object.assign({}, trust, { bodyComplete: true }));
  stored = model.getVisits(patients[0]);
  assert.strictEqual(stored.length, 1, 'repeat pull must enrich one encounter, not duplicate it');
  assert.strictEqual(stored[0].raw, 'Assessment: corrected shorter body. Plan: revised.', 'latest verified body-complete detail must replace stale longer text');
  assert.deepStrictEqual(Array.from(stored[0].icd10).sort(), ['M54.17'], 'corrected verified encounter must replace stale structured codes');
  assert.strictEqual(stored[0].findings, '', 'corrected verified encounter retained stale findings');
  assert.strictEqual(stored[0].plan, '', 'corrected verified encounter retained stale plan');
  assert.strictEqual(stored[0].aiSummary, '', 'corrected verified encounter retained an AI summary generated from the old body');
  assert.strictEqual(stored[0].indexOnly, false);
  assert.strictEqual(stored[0].bodyComplete, true);

  model.addVisit('p1', { encounterId: 'manual-1', date: '2026-02-01', type: 'Manual', raw: 'Clinician-authored manual content that is deliberately longer.' }, { source: 'manual' });
  model.addVisit('p1', { encounterId: 'manual-1', date: '2026-02-01', type: 'Manual', raw: 'short manual' }, { source: 'manual', bodyComplete: true });
  const manual = model.getVisits(patients[0]).find(v => v.encounterId === 'manual-1');
  assert.strictEqual(manual.raw, 'Clinician-authored manual content that is deliberately longer.', 'manual content must never be replaced by Athena enrichment semantics');

  const twinTrust = Object.assign({}, trust, { bodyComplete: true });
  model.addVisit('p1', { sourceVisitKey: 'row:twin-a', date: '2026-03-01', type: 'Office visit', cpt: ['99214'], fullDetail: true, raw: 'Assessment: first A body that is initially longer. Plan: A1.' }, twinTrust);
  model.addVisit('p1', { sourceVisitKey: 'row:twin-b', date: '2026-03-01', type: 'Office visit', cpt: ['99214'], fullDetail: true, raw: 'Assessment: first B body that is initially longer. Plan: B1.' }, twinTrust);
  // Simulate the same source rows arriving in the opposite rendered order.
  model.addVisit('p1', { sourceVisitKey: 'row:twin-b', encounterIndex: 0, date: '2026-03-01', type: 'Office visit', cpt: ['99214', '77003'], fullDetail: true, raw: 'Assessment: corrected B. Plan: B2.' }, twinTrust);
  model.addVisit('p1', { sourceVisitKey: 'row:twin-a', encounterIndex: 1, date: '2026-03-01', type: 'Office visit', cpt: ['99214', '64483'], fullDetail: true, raw: 'Assessment: corrected A. Plan: A2.' }, twinTrust);
  const twins = model.getVisits(patients[0]).filter(v => /^row:twin-/.test(v.sourceVisitKey || ''));
  assert.strictEqual(twins.length, 2, 'distinct stable row keys on identical date/type/CPT must persist as two encounters');
  assert.strictEqual(twins.find(v => v.sourceVisitKey === 'row:twin-a').raw, 'Assessment: corrected A. Plan: A2.');
  assert.strictEqual(twins.find(v => v.sourceVisitKey === 'row:twin-b').raw, 'Assessment: corrected B. Plan: B2.');
  assert(twins.find(v => v.sourceVisitKey === 'row:twin-a').cpt.includes('64483'));
  assert(twins.find(v => v.sourceVisitKey === 'row:twin-b').cpt.includes('77003'));

  model.addVisit('p1', { sourceVisitKey: 'row:unverified', date: '2026-04-01', type: 'Office visit', fullDetail: true, raw: 'Unverified Athena body that is deliberately longer and must be preserved.' }, { source: 'athena-copy' });
  model.addVisit('p1', { sourceVisitKey: 'row:unverified', date: '2026-04-01', type: 'Office visit', fullDetail: true, raw: 'short unsafe body' }, { source: 'athena-copy', bodyComplete: true });
  const unverified = model.getVisits(patients[0]).find(v => v.sourceVisitKey === 'row:unverified');
  assert.strictEqual(unverified.raw, 'Unverified Athena body that is deliberately longer and must be preserved.', 'unverified Athena content must not use authoritative refresh semantics');

  const p2 = { id: 'p2', name: 'Shell Patient', dob: '05/06/1970', visits: [] };
  patients.push(p2);
  model.ingestChart(p2, { visits: ['04/05/2026 — Office visit row metadata only'] }, 'athena-copy', { identityVerified: true, identityBinding: 'p2', chartIndexOnly: true });
  let shellRows = model.getVisits(p2);
  assert.strictEqual(shellRows.length, 1);
  assert.strictEqual(shellRows[0].indexOnly, true);
  assert.strictEqual(shellRows[0].raw, '', 'chart parser string shell leaked into clinical raw text');
  assert.strictEqual(model.usableVisits(p2).length, 0, 'chart parser string shell entered longitudinal/op-note context');
  model.addVisit('p2', { sourceVisitKey: 'row:shell-hydrated', date: '2026-04-05', type: 'Office visit', fullDetail: true, raw: 'HPI: verified encounter body. Assessment: condition. Plan: follow-up.' }, { source: 'athena-copy', identityVerified: true, identityBinding: 'p2', bodyComplete: true });
  shellRows = model.getVisits(p2);
  assert.strictEqual(shellRows.length, 1, 'hydrated exact encounter did not compact its dated chart shell');
  assert.strictEqual(shellRows[0].indexOnly, false);
  assert.strictEqual(model.usableVisits(p2).length, 1, 'hydrated exact encounter did not become usable');

  const p3 = { id: 'p3', name: 'Refresh Patient', dob: '07/08/1975', visits: [] };
  patients.push(p3);
  const p3Trust = { source: 'athena-copy', identityVerified: true, identityBinding: 'p3' };
  model.addVisit('p3', { sourceVisitKey: 'row:stale', date: '2026-01-01', raw: 'Old Athena encounter' }, p3Trust);
  model.addVisit('p3', { sourceVisitKey: 'row:current', date: '2026-02-01', raw: 'Current Athena encounter' }, p3Trust);
  model.addVisit('p3', { sourceVisitKey: 'row:manual', date: '2026-03-01', raw: 'Clinician manual encounter' }, { source: 'manual' });
  model.addVisit('p3', { sourceVisitKey: 'row:unverified-audit', date: '2026-04-01', raw: 'Unverified audit row' }, { source: 'athena-copy' });
  let reconciled = model.reconcileVerifiedAthenaVisits('p3', [{ sourceVisitKey: 'row:current' }]);
  assert.strictEqual(reconciled.removed, 1, 'full refresh did not remove an Athena-owned encounter absent from the authoritative batch');
  let p3Keys = model.getVisits(p3).map(v => v.sourceVisitKey).sort();
  assert.deepStrictEqual(Array.from(p3Keys), ['row:current', 'row:manual', 'row:unverified-audit'], 'full refresh removed manual/audit rows or retained stale Athena history');
  reconciled = model.reconcileVerifiedAthenaVisits('p3', []);
  assert.strictEqual(reconciled.removed, 1, 'authoritative zero-visit refresh did not clear the remaining Athena-owned encounter');
  p3Keys = model.getVisits(p3).map(v => v.sourceVisitKey).sort();
  assert.deepStrictEqual(Array.from(p3Keys), ['row:manual', 'row:unverified-audit'], 'authoritative zero refresh did not preserve manual/audit rows exactly');

  console.log('PASS exact-frame full visit reader, honest receipts/index shells, and idempotent verified enrichment');
})().catch(err => { console.error(err); process.exit(1); });
