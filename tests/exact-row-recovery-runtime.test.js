'use strict';

// Synthetic only. Execute the shipped opener, including its last-moment
// identity check, against rows that are replaced/recycled during selection.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MessageChannel } = require('worker_threads');
const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
function between(src, a, b) {
  const start = src.indexOf(a), end = src.indexOf(b, start + a.length);
  assert(start >= 0 && end > start, a);
  return src.slice(start, end);
}
const driver = between(background, 'async function mlsSearchOpenDriverFn(name, phase', 'function bestFrameResult(results, key)');
const marker = background.indexOf('/* === MLS Assist v1.36');
const iifeStart = background.indexOf('(function ()', marker);
const iifeEnd = background.indexOf('\n})();', iifeStart);
assert(marker >= 0 && iifeStart > marker && iifeEnd > iifeStart);
const searchIife = background.slice(iifeStart, iifeEnd + '\n})();'.length);

function fixture(opts = {}) {
  let lookups = 0, mutations = 0;
  const clicked = [];
  function row(id, text, label) {
    return {
      idValue: id, textContent: text, label, tagName: 'DIV', isConnected: true, parentElement: null,
      getAttribute(key) { return key === 'data-appointment-id' ? this.idValue : ''; },
      getBoundingClientRect() { return { width: 500, height: 30, left: 0, top: 0 }; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      scrollIntoView() {
        if (opts.changeOnScroll && this.label === 'old' && !mutations++) {
          this.idValue = '49999'; this.textContent = 'Foreign, Other';
          rows.push(row('40001', opts.text || 'Sample, Jane', 'replacement'));
        }
      },
      dispatchEvent() {}, click() { clicked.push(this.label); }
    };
  }
  const first = row(opts.id || '40001', opts.text || 'Sample, Jane', 'old');
  let rows = [first];
  if (opts.ambiguous) rows.push(row('40001', opts.text || 'Sample, Jane', 'duplicate'));
  if (opts.nonclinical) first.getAttribute = key => key === 'href' ? '/schedule/apptworkflow.esp?appointmentid=40001' : key === 'data-appointment-id' ? '40001' : '';
  const context = {
    Date, Math, Number, String, Object, Array, RegExp, Promise, URL, MessageChannel,
    setTimeout, clearTimeout,
    document: {
      hidden: opts.hidden === true, scrollingElement: null,
      querySelectorAll(selector) {
        if (selector.startsWith('[data-appointment-id=')) {
          lookups++;
          if (opts.replaceAfterSelection && lookups === 2) {
            first.isConnected = false;
            rows = [row('40001', opts.replacementText || opts.text || 'Sample, Jane', 'replacement')];
          }
          if (opts.persistentChurn && lookups > 1) { rows.forEach(r => { r.isConnected = false; }); return []; }
          return rows.filter(r => r.isConnected && r.idValue === '40001');
        }
        if (opts.nameOnly && selector.startsWith('a,[role=option]')) return rows.filter(r => r.isConnected);
        return [];
      }
    },
    window: { innerHeight: 800 },
    location: { href: 'https://athenanet.athenahealth.com/schedule', pathname: '/schedule', hostname: 'athenanet.athenahealth.com' },
    getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
    Event: class {}, MouseEvent: class {}, PointerEvent: class {}
  };
  vm.runInNewContext(driver, context, { timeout: 1000 });
  return {
    async run() {
      const result = await context.mlsSearchOpenDriverFn(opts.name || 'Jane Sample', 'open', { token: 'synthetic-row-proof', deadline: Date.now() + (opts.budget || 5000) }, opts.nameOnly ? '' : '40001', !opts.nameOnly);
      return { result, clicked, lookups };
    }
  };
}

async function rowTests() {
  for (const [name, text] of [
    ['Jane Sample', 'Sample, Jane'],
    ["Jane O'Example", 'OExample, Jane'],
    ['Jane O\u2019Example', "O'Example, Jane"],
    ['Anne-Marie Sample', 'Sample, Anne Marie'],
    ['Sample, Anne Marie', 'Anne-Marie Sample']
  ]) {
    const r = await fixture({ name, text }).run();
    assert.strictEqual(r.result.opened, true, 'unchanged exact-ID spelling variant refused: ' + JSON.stringify(r));
    assert.strictEqual(r.clicked.length, 1);
    assert.strictEqual(r.result.diag.apptIdBound, true);
  }
  for (const opts of [{ replaceAfterSelection: true }, { changeOnScroll: true }, { replaceAfterSelection: true, hidden: true }]) {
    const r = await fixture(opts).run();
    assert.strictEqual(r.result.opened, true, 'fresh exact row was not rebound: ' + JSON.stringify(r));
    assert.deepStrictEqual(r.clicked, ['replacement'], 'stale/recycled node was clicked');
    assert(r.result.diag.rowRebinds >= 1, 'recovery was invisible');
  }
  for (const opts of [
    { text: 'Foreign, Other' }, { id: '40002' }, { ambiguous: true },
    { replaceAfterSelection: true, replacementText: 'Foreign, Other' },
    { persistentChurn: true }, { nonclinical: true }
  ]) {
    const r = await fixture(opts).run();
    assert.strictEqual(r.result.opened, false, 'unsafe row accepted: ' + JSON.stringify(r));
    assert.deepStrictEqual(r.clicked, []);
    assert(r.lookups <= 10, 'row retry became unbounded');
  }
  const expired = await fixture({ persistentChurn: true, budget: 50 }).run();
  assert.strictEqual(expired.result.reason, 'open-deadline-exceeded');
  assert.deepStrictEqual(expired.clicked, []);
  const unbound = await fixture({ nameOnly: true, changeOnScroll: true }).run();
  assert.strictEqual(unbound.result.opened, false, 'row replacement gained a name-only recovery');
  assert.deepStrictEqual(unbound.clicked, []);
}

function timer(fn, ms) { const t = setTimeout(fn, ms); if (ms > 1000) t.unref(); return t; }
function worker(opts = {}) {
  const listeners = [], calls = [];
  let opened = false, scans = 0;
  const context = {
    console, Promise, Date, Math, Number, String, Object, Array, RegExp, JSON, URL,
    setTimeout: timer, clearTimeout, setInterval, clearInterval,
    __mlsReadsSinceReload: 0,
    mlsSleepW: ms => new Promise(resolve => timer(resolve, ms)),
    mlsRecoverAthenaTab: async () => { calls.push('session-reprobe'); return { ok: true }; },
    mlsPickAthenaTab: async tabs => tabs[0],
    mlsAthenaGotoDate: function mlsAthenaGotoDate() {},
    mlsEnsureEncounterOpen: async () => ({ ran: false }),
    self: null,
    chrome: {
      runtime: { id: 'synthetic-extension', onMessage: { addListener(fn) { listeners.push(fn); } } },
      tabs: { query: async () => [{ id: 71, url: 'https://athenanet.athenahealth.com/globalframeset.esp' }], sendMessage() {} },
      webNavigation: { getAllFrames: async () => [{ frameId: 4, url: opened ? 'https://athenanet.athenahealth.com/appointment/40001/briefing' : 'https://athenanet.athenahealth.com/schedule' }] }
    },
    async mlsExecTO(call) {
      const kind = call.func.name;
      calls.push({ kind, args: call.args });
      if (kind === 'mlsFindPatientOpenDriverFn') {
        // A blank-DOB retry would open the same-name but conflicting patient.
        // The request must remain refused before this operation is attempted.
        if (opts.exactDobConflict && call.args[1] === '') return { r: [{ frameId: 0, result: { opened: true, rowDob: '01/02/1980' } }] };
        return { r: [{ frameId: 0, result: { opened: false, reason: opts.findReason || 'no-results', count: opts.exactDobConflict ? 1 : 0, tier: opts.exactDobConflict ? 'exact' : '' } }] };
      }
      if (kind === 'mlsAthenaGotoDate') {
        const r = [{ frameId: 4, result: { done: true, schedDate: opts.wrongDate ? '2026-09-13' : '2026-09-14', dateUnverified: opts.unverifiedDate === true } }];
        if (opts.conflictingDates) r.push({ frameId: 5, result: { done: true, schedDate: '2026-09-13' } });
        return { r };
      }
      if (kind === 'mlsSearchOpenDriverFn') {
        scans++;
        if (opts.missFirst && scans === 1) return { r: [{ frameId: 4, result: { opened: false, reason: 'appointment-id-not-found', diag: { scanned: 0, scrollers: 0 } } }] };
        opened = true;
        return { r: [{ frameId: 4, result: { opened: true, diag: { apptIdBound: true, apptIdMatches: 1 } } }] };
      }
      throw new Error('Unexpected injected operation ' + kind);
    }
  };
  context.self = context;
  vm.runInNewContext(searchIife, context, { timeout: 1000 });
  return {
    calls,
    run() {
      return new Promise(resolve => listeners[0]({
        type: 'mlsAppSearchOpenRequest', requestId: 'synthetic-worker-proof', deadlineAt: Date.now() + 5000,
        name: 'Jane Sample', dob: '01/02/1970', mrn: opts.bootstrap ? '' : '70001', appointmentId: opts.noId ? '' : '40001',
        scheduleDate: opts.noDate ? '' : '2026-09-14', bootstrapIdentity: opts.bootstrap === true
      }, { tab: { id: 1 } }, resolve));
    }
  };
}

async function workerTests() {
  for (const opts of [{}, { findReason: 'no-name-match' }, { findReason: 'search-target-unverified' }, { bootstrap: true, missFirst: true }]) {
    const w = worker(opts), r = await w.run();
    assert.strictEqual(r.ok, true, 'exact schedule recovery failed: ' + JSON.stringify(r));
    assert.strictEqual(r.appointmentIdBound, true);
    assert.strictEqual(r.appointmentId, '40001');
    const dates = w.calls.filter(c => c.kind === 'mlsAthenaGotoDate');
    assert.strictEqual(dates.length, 1, 'exact schedule recovery must re-ground once');
    assert.strictEqual(dates[0].args[0], '2026-09-14');
    const scans = w.calls.filter(c => c.kind === 'mlsSearchOpenDriverFn');
    assert(scans.every(c => c.args[3] === '40001' && c.args[4] === true), 'fallback became a name-only scan');
    assert.strictEqual(r.diag.scheduleRegrounds, 1);
  }
  for (const opts of [{ wrongDate: true }, { unverifiedDate: true }, { conflictingDates: true }, { noDate: true }, { noId: true }, { findReason: 'ambiguous' }, { findReason: 'dob-mismatch' }, { findReason: 'dob-mismatch', exactDobConflict: true }]) {
    const w = worker(opts), r = await w.run();
    assert.strictEqual(r.ok, false, 'unsafe recovery accepted: ' + JSON.stringify(r));
    assert.strictEqual(w.calls.filter(c => c.kind === 'mlsSearchOpenDriverFn').length, 0, 'unsafe recovery clicked a row');
    if (opts.exactDobConflict) {
      const finds = w.calls.filter(c => c.kind === 'mlsFindPatientOpenDriverFn');
      assert.strictEqual(finds.length, 1, 'a DOB contradiction must not retry with weakened identity');
      assert.strictEqual(finds[0].args[1], '01/02/1970', 'the frozen DOB must remain intact');
      assert.strictEqual(r.reason, 'dob-mismatch');
    }
    assert(/^[a-z][a-z0-9-]{1,39}$/.test(r.reason), 'no precise closed refusal code');
  }
}

function bridgeTests() {
  const chartBridge = between(content, "if (d.type === 'mlsAppReadChart')", '/* v1.89: READ-ONLY');
  function run(opened) {
    const sent = [], results = [];
    const context = {
      Date, Math, Number, String, Object, Array, RegExp, JSON,
      setTimeout() { return 1; }, clearTimeout() {},
      mlsStr: (v, n) => String(v || '').slice(0, n),
      mlsRelayRetry(req, cb) { cb(opened); },
      reply(r) { results.push(r.resp); },
      chrome: { runtime: { lastError: null, sendMessage(msg, cb) { sent.push(msg); cb({ ok: true, text: 'Synthetic chart facts', chartName: 'Jane Sample', chartDob: '01/02/1970', chartMrn: '70001' }); } } }
    };
    const go = vm.runInNewContext('(function(d){' + chartBridge + '})', context);
    go({ type: 'mlsAppReadChart', patient: 'Jane Sample', patientDob: '01/02/1970', patientMrn: '70001', patientId: 'local-synthetic', appointmentId: '40001', scheduleDate: '2026-09-14', requestId: 'synthetic-bridge', deadlineAt: Date.now() + 5000 });
    return { sent, results };
  }
  const bound = { ok: true, opened: true, exactScheduleFallback: true, appointmentIdBound: true, appointmentId: '40001', appointmentNavigationFrameIds: [4], athenaTabId: 71 };
  const r = run(bound);
  assert.strictEqual(r.sent.length, 1);
  assert.strictEqual(r.sent[0].bootstrapIdentity, false, 'ordinary read became identity-only');
  assert.strictEqual(r.sent[0].appointmentRecovery, true);
  assert.strictEqual(r.sent[0].patientDob, '01/02/1970');
  assert.strictEqual(r.sent[0].patientMrn, '70001');
  assert.deepStrictEqual(Array.from(r.sent[0].appointmentNavigationFrameIds), [4]);
  assert.strictEqual(r.results[0].text, 'Synthetic chart facts');
  for (const override of [{ appointmentId: '40002' }, { appointmentIdBound: false }, { appointmentNavigationFrameIds: [] }]) {
    const bad = run(Object.assign({}, bound, override));
    assert.strictEqual(bad.sent.length, 0, 'unbound recovered appointment was read');
    assert.strictEqual(bad.results[0].reason, 'appointment-navigation-unverified');
  }
  const leaseSource = between(background, '          const lease = self.__mlsExpectOpen || null;', '          const leaseTab = await chartSettle');
  function leaseCheck(override) {
    const lease = Object.assign({ name: 'Jane Sample', tabId: 71, at: Date.now(), requestId: 'synthetic-bridge', appointmentId: '40001', scheduleDate: '2026-09-14', appointmentIdBound: true, appointmentNavigationFrameIds: [4] }, override);
    const ctx = { Date, Number, String, JSON, Object, self: { __mlsExpectOpen: lease }, want: 'Jane Sample', bootstrapIdentity: false, appointmentRecovery: true, expectedAppointmentId: '40001', expectedScheduleDate: '2026-09-14', expectedAthenaTabId: 71, expectedNavigationFrameIds: [4], chartRequestId: 'synthetic-bridge', chartRespond: v => v, exactOpenLease: null };
    return vm.runInNewContext('(function(){' + leaseSource + ';return {ok:true};})()', ctx);
  }
  assert.strictEqual(leaseCheck().ok, true);
  for (const bad of [{ appointmentId: '40002' }, { scheduleDate: '2026-09-13' }, { appointmentNavigationFrameIds: [9] }, { requestId: 'stale-request' }]) {
    assert.strictEqual(leaseCheck(bad).reason, 'appointment-open-lease-mismatch');
  }
}

(async () => {
  if (!process.argv.includes('--worker-only')) await rowTests();
  await workerTests();
  bridgeTests();
  console.log('PASS exact-row recovery: punctuation, replacement/recycling, bounded retries, exact-day fallback, ambiguity/deadline refusal, and closed diagnostics');
})().catch(e => { console.error(e); process.exitCode = 1; });
