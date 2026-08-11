'use strict';
/* =============================================================================
 * day-note-foldin-contract.test.js  (dn-1.0)  — REGISTERED-SUITE DRAFT
 *
 * Contract for the day-note FOLD-IN (owner 2026-08-11: the pull "should save
 * the days visit note when its already on that person, and then when its done
 * it should stop and say done").
 *
 * Proves, against the PATCHED sources (built in memory by
 * patch-daynote-foldin.js — after the patch is applied to the repo this test
 * reads the same truth straight from the files, tolerateApplied):
 *   (a) the day-note capture is ISSUED INSIDE the patient's open-chart window
 *       (source-order proof + the extracted inline block EXECUTED with the
 *       chart-window fiction held open across the await);
 *   (b) ZERO second-pass re-opens when every inline capture succeeded
 *       (the real tail-loop bytes EXECUTED with a runForPatient spy);
 *   (c) an inline failure lands in todayNoteFailures with its reason —
 *       identity-mismatch refusal text byte-identical — and the run still
 *       terminates (aggregate + dayVerdict stamp EXECUTED);
 *   (d) the terminal DONE state fires EXACTLY ONCE with honest counts (the
 *       real __mlsPullProgress IIFE driven through running -> finished ->
 *       dismissed on a DOM stub);
 *   (e) NON-VACUITY: string-reverting the attempt-once filter makes the
 *       second serial pass REAPPEAR under the same spy, and the UNPATCHED
 *       source fails the (a) ordering detection.
 *
 * WHEN REGISTERING (post-apply): move this file to tests/, change PATCH_MODE
 * to 'files', and add it to the tests[] array in tests/run-all.js —
 * EXISTING IS NOT RUNNING.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const patcher = require('./patch-daynote-foldin.js');
const ROOT = patcher.ROOT;

const raw = {
  'feat_mls_schedimport_exact.js': fs.readFileSync(path.join(ROOT, 'feat_mls_schedimport_exact.js'), 'latin1'),
  'mls-connect.js': fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'latin1')
};
const { sources: patched } = patcher.applyToSources(raw, { tolerateApplied: true });
const si = patched['feat_mls_schedimport_exact.js'];
const mc = patched['mls-connect.js'];

function between(src, startTok, endTok, what) {
  const s = src.indexOf(startTok);
  assert(s >= 0, what + ': start token missing');
  const e = src.indexOf(endTok, s);
  assert(e > s, what + ': end token missing');
  return src.slice(s, e + endTok.length);
}

/* ===========================================================================
 * (a) ORDERING — the day-note read is issued inside the open-chart window
 * ======================================================================== */
function inlineCaptureInsideLoop(src) {
  const loopStart = src.indexOf('for (var i = 0; i < rows.length; i++) {');
  const loopEnd = src.indexOf('/* si-1.7.4 finalization:');
  if (loopStart < 0 || loopEnd < loopStart) return false;
  const body = src.slice(loopStart, loopEnd);
  const call = body.indexOf('dnVp.runForPatient(dnP, function () {}, { onlyDate: dnDay })');
  if (call < 0) return false;
  /* the capture must come AFTER this patient's chart read+settle and BEFORE
     the loop moves on (the stop-check is the last thing before the next
     iteration) */
  const settle = body.indexOf('receipt.patients.push(one); receipt.processed++;');
  const stopCheck = body.indexOf('if (stopAfterTimeout) {', call);
  return settle >= 0 && call > settle && stopCheck > call;
}
assert(inlineCaptureInsideLoop(si), '(a) inline day-note capture sits inside the per-patient loop, after the chart settle, before the loop advances');
assert(si.indexOf('&& rd && !inlineDayNoteFuse)') > 0, '(a) inline capture requires THIS batch\'s successful chart read (rd) and an untripped fuse');

/* EXECUTED: the extracted inline block issues the read while the chart window
   is (fictionally) open, and awaits it fully before the block ends. */
const inlineBlock = between(si,
  '        if (!stopAfterTimeout && pullVisitBodies !== true && one.visitsSkipped === true && rd && !inlineDayNoteFuse) {',
  '          if (one.todayNote !== true && typeof ppSettle === "function" && one.name) { try { ppSettle(one.name, false, "pulled-day-note-unread " + String(one.todayNoteReason || "").slice(0, 60), false, { pid: one.patientId }); } catch (eDnPp) {} }\n        }',
  '(a) inline block');

function runInlineBlock(cfg) {
  const events = [];
  const chartWindow = { openFor: cfg.patientId };
  const one = { patientId: cfg.patientId, name: cfg.name, visitsSkipped: true };
  const receipt = {};
  const ctx = vm.createContext({
    console, Promise, Error, String, Number, Date, RegExp, Object, Math, JSON,
    stopAfterTimeout: false, pullVisitBodies: false, rd: { text: 'chart' },
    one, row: { scheduleDate: cfg.day, name: cfg.name }, receipt,
    normDate: d => String(d || ''),
    safe: (fn, fb) => { try { return fn(); } catch (e) { return fb; } },
    findStorePatient: id => ({ id, name: cfg.name }),
    ppCurrent: m => events.push(['current', String(m)]),
    ppSettle: (n, ok, reason, pending, extra) => { events.push(['settle', n, ok, String(reason), extra && extra.pid]); },
    bridge: async () => ({ version: cfg.extVersion || '3.0.61' }),
    safeAsync: async (fn, fb) => { try { return await fn(); } catch (e) { return fb; } },
    window: {
      __mlsPullShieldTick: () => events.push(['shield']),
      __mlsVisitSavePref: {
        runForPatient: (p, cb, opts) => {
          events.push(['daynote-issued', p && p.id, opts && opts.onlyDate, 'windowOpen=' + (chartWindow.openFor === (p && p.id))]);
          return cfg.result();
        }
      }
    }
  });
  const src = '(async function () { var todayNoteExtOk = null; var inlineDayNoteFuse = "";\n'
    + inlineBlock
    + '\nreturn { fuse: inlineDayNoteFuse }; })()';
  return vm.runInContext(src, ctx).then(r => {
    chartWindow.openFor = null; /* the window "closes" only after the await chain */
    return { one, receipt, events, fuse: r.fuse };
  });
}

const IDENTITY_MISMATCH = 'Safety stop — at least one returned visit identifies a different patient. Nothing from this batch was saved. Re-open the correct chart and pull again.';

Promise.resolve()
  /* -- (a) success: issued in-window, fully awaited, no failure row -------- */
  .then(() => runInlineBlock({ patientId: 'p1', name: 'Ada Lovelace', day: '2026-08-11', result: () => Promise.resolve({ ok: true, visits: 1 }) }))
  .then(r => {
    const issued = r.events.find(e => e[0] === 'daynote-issued');
    assert(issued, '(a) the scoped day-note read was issued');
    assert.strictEqual(issued[2], '2026-08-11', '(a) scoped to the pulled day');
    assert.strictEqual(issued[3], 'windowOpen=true', '(a) issued WHILE the patient\'s chart window is open');
    assert.strictEqual(r.one.todayNote, true, '(a) success recorded');
    assert(!r.events.some(e => e[0] === 'settle'), '(a) no failure row on success');
  })

  /* -- (c1) identity-mismatch refusal: reason byte-identical, no fuse ------ */
  .then(() => runInlineBlock({ patientId: 'p2', name: 'Bob Byte', day: '2026-08-11', result: () => Promise.reject(new Error(IDENTITY_MISMATCH)) }))
  .then(r => {
    assert.strictEqual(r.one.todayNote, false, '(c) inline refusal recorded');
    assert.strictEqual(r.one.todayNoteReason, IDENTITY_MISMATCH.slice(0, 80), '(c) refusal reason BYTE-IDENTICAL to the tail-pass semantics (same slice of the same safety-stop text)');
    const settle = r.events.find(e => e[0] === 'settle');
    assert(settle && /^pulled-day-note-unread /.test(settle[3]) && settle[4] === 'p2', '(c) pid-keyed pulled-day-note-unread row emitted');
    assert.strictEqual(r.fuse, '', '(c) an identity refusal never trips the fuse (it is deterministic, not a wedged runner)');
    assert.strictEqual(r.receipt.todayNoteInlineFuse, undefined, '(c) no fuse on receipt either');
  })

  /* -- fuse: a timeout-class inline failure stops later INLINE attempts ---- */
  .then(() => runInlineBlock({ patientId: 'p3', name: 'Cy Stall', day: '2026-08-11', result: () => Promise.reject(new Error('visits-read-deadline-exceeded: immutable deadline')) }))
  .then(r => {
    assert.strictEqual(r.one.todayNote, false, 'fuse case still records the failure');
    assert(r.fuse && /deadline/.test(r.fuse), 'timeout-class failure trips the one-way fuse');
    assert.strictEqual(r.receipt.todayNoteInlineFuse, r.fuse, 'fuse is receipted');
  })

  /* -- old-extension gate + missing reader parity -------------------------- */
  .then(() => runInlineBlock({ patientId: 'p4', name: 'Del Gate', day: '2026-08-11', extVersion: '3.0.29', result: () => { throw new Error('must not be called'); } }))
  .then(r => {
    assert.strictEqual(r.one.todayNote, false);
    assert.strictEqual(r.one.todayNoteReason, 'extension-predates-scoped-read', 'pre-3.0.30 pong refuses the scoped read, verbatim reason');
    assert(!r.events.some(e => e[0] === 'daynote-issued'), 'no read issued to an incapable extension');
  })

  .then(() => { runTailAndRest(); })
  .catch(err => { console.error(err); process.exit(1); });

/* ===========================================================================
 * (b) + (e1) — the tail pass: zero re-opens when inline succeeded; revert
 * the attempt-once filter and the second serial pass REAPPEARS
 * ======================================================================== */
const TAIL_START = '      /* dn-1.0: todayNoteExtOk + safeAsync now live at batch scope';
const TAIL_END = '} catch (eTodayNotePass) { try { if (receipt) receipt.todayNotePassError = String((eTodayNotePass && eTodayNotePass.message) || eTodayNotePass).slice(0, 120); } catch (eR2) {} }';

function runTail(tailSrc, patients) {
  const calls = [];
  const receipt = { patients };
  const ctx = vm.createContext({
    console, Promise, Error, String, Number, Date, RegExp, Object, Math, JSON,
    receipt,
    rows: patients.map(p => ({ _mlsTargetPatientId: p.patientId, scheduleDate: '2026-08-11', name: p.name })),
    normDate: d => String(d || ''),
    safe: (fn, fb) => { try { return fn(); } catch (e) { return fb; } },
    ppCurrent: () => {},
    ppSettle: () => {},
    findStorePatient: id => ({ id }),
    bridge: async () => ({ version: '3.0.61' }),
    window: {
      __mlsPullShieldTick: () => {},
      __mlsVisitSavePref: { runForPatient: (p, cb, opts) => { calls.push([p && p.id, opts && opts.onlyDate]); return Promise.resolve({ ok: true, visits: 1 }); } }
    }
  });
  const src = '(async function () { var todayNoteExtOk = null; var safeAsync = async function (fn, fb) { try { return await fn(); } catch (e) { return fb; } };\n'
    + tailSrc + '\n})()';
  return vm.runInContext(src, ctx).then(() => ({ calls, receipt }));
}

function runTailAndRest() {
  const tailSrc = between(si, TAIL_START, TAIL_END, '(b) tail pass');
  const allInline = [
    { patientId: 'q1', name: 'Q One', visitsSkipped: true, todayNote: true },
    { patientId: 'q2', name: 'Q Two', visitsSkipped: true, todayNote: true },
    { patientId: 'q3', name: 'Q Three', visitsSkipped: true, todayNote: false, todayNoteReason: 'encounter-index-unverified' }
  ];
  Promise.resolve()
    .then(() => runTail(tailSrc, allInline.map(p => Object.assign({}, p))))
    .then(r => {
      assert.strictEqual(r.calls.length, 0, '(b) ZERO second-pass re-opens when every patient carries an inline verdict (success OR refusal)');
    })
    .then(() => runTail(tailSrc, [
      { patientId: 'q1', name: 'Q One', visitsSkipped: true, todayNote: true },
      { patientId: 'q4', name: 'Q Four', visitsSkipped: true } /* never attempted inline (chart-read failure / fuse) */
    ]))
    .then(r => {
      assert.strictEqual(r.calls.length, 1, '(b) the tail still covers exactly the never-attempted patient');
      assert.strictEqual(r.calls[0][0], 'q4', '(b) and only that patient');
    })
    /* -- (e1) NON-VACUITY: string-revert the attempt-once filter ----------- */
    .then(() => {
      const FILTER = ' || oneTn.todayNote != null';
      assert(tailSrc.indexOf(FILTER) > 0, '(e) the filter under revert exists');
      const OLD = tailSrc.replace(FILTER, '');
      return runTail(OLD, allInline.map(p => Object.assign({}, p)));
    })
    .then(r => {
      assert.strictEqual(r.calls.length, 3, '(e) NON-VACUITY: without the attempt-once filter the SECOND SERIAL PASS REAPPEARS - every inline-settled patient is re-opened again');
    })
    .then(() => { partC(); partD(); partE2(); console.log('day-note-foldin-contract: PASS'); })
    .catch(err => { console.error(err); process.exit(1); });
}

/* ===========================================================================
 * (c2) — the aggregate + terminal stamp: inline failures reach
 * todayNoteFailures with their reasons, and the run records its day verdict
 * ======================================================================== */
function partC() {
  const aggStart = si.indexOf('safe(function () { var tnF = 0');
  assert(aggStart > 0, '(c) receipt aggregate exists');
  const aggTerm = 'receipt.todayNoteReasons = tnR; });';
  const aggEnd = si.indexOf(aggTerm, aggStart);
  const aggSrc = si.slice(aggStart, aggEnd + aggTerm.length);
  const receipt = { complete: false, patients: [
    { todayNote: true },
    { todayNote: false, todayNoteReason: IDENTITY_MISMATCH.slice(0, 80) },
    { todayNote: false, todayNoteReason: 'encounter-index-unverified' },
    { visitsSkipped: true } /* never attempted: NOT a failure */
  ] };
  new Function('safe', 'receipt', aggSrc)(fn => fn(), receipt);
  assert.strictEqual(receipt.todayNoteFailures, 2, '(c) inline failures counted');
  assert.strictEqual(receipt.todayNoteReasons[IDENTITY_MISMATCH.slice(0, 80)], 1, '(c) identity-mismatch reason keyed byte-identically in the histogram');
  assert.strictEqual(receipt.todayNoteReasons['encounter-index-unverified'], 1, '(c) scoped-read refusal reason in the histogram');

  /* the terminal stamp runs AFTER the aggregate and records day-note truth */
  const stampStart = si.indexOf('safe(function () { if (sweepDepth) return; var sDv = ppState(); if (!sDv) return; sDv.dayVerdict');
  assert(stampStart > aggEnd, '(c) dayVerdict stamp exists after the aggregate');
  const stampEnd = si.indexOf('; });', stampStart);
  const stampSrc = si.slice(stampStart, stampEnd + '; });'.length);
  const s = { ok: 17, failed: 2, chartOnly: 1, total: 19 };
  new Function('safe', 'sweepDepth', 'ppState', 'receipt', 'Date', 'Number', stampSrc)(
    fn => fn(), 0, () => s, receipt, Date, Number);
  assert(s.dayVerdict && s.dayVerdict.tnFailed === 2 && s.dayVerdict.ok === 17 && s.dayVerdict.complete === false,
    '(c) the run terminates into a recorded day verdict carrying the day-note truth');
  /* sub-batches must never stamp day-level truth (b752 subset trap) */
  const s2 = {};
  new Function('safe', 'sweepDepth', 'ppState', 'receipt', 'Date', 'Number', stampSrc)(
    fn => fn(), 1, () => s2, receipt, Date, Number);
  assert(!s2.dayVerdict, '(c) a sweep sub-batch never stamps the day verdict');

  /* the run's END stamps finishedAt so the DONE card freezes its clock */
  assert(si.indexOf("s.finishedAt=Date.now(); s.running=false;") > 0, '(c) ppEnd stamps finishedAt before running=false');

  /* the ledger persists the aggregate (queue item) */
  assert(si.indexOf('todayNoteFailures: Number(receipt.todayNoteFailures || 0),') > 0, '(c) ledger carries the count');
  assert(si.indexOf('todayNoteRefused:') > 0, '(c) ledger carries per-patient refusals');
  /* and the day line NAMES the refused notes (queue item) */
  assert(si.indexOf("__tnNote = \" The pulled day's note could not be read for \"") > 0, '(c) day-end line NAMES refused day-notes');
  assert(si.indexOf('+ __redoNote + __tnNote, "ok");') > 0 && si.indexOf('+ __redoNote + __tnNote, "err");') > 0,
    '(c) the naming rides BOTH verdict lines');
}

/* ===========================================================================
 * (d) — the terminal DONE state fires EXACTLY ONCE with honest counts
 * (the real __mlsPullProgress IIFE, driven running -> finished -> dismissed)
 * ======================================================================== */
function makeDom() {
  const reg = new Map();
  function el(id) {
    const node = {
      id: id || '', style: {}, textContent: '', _innerHTML: '', __qs: Object.create(null),
      set innerHTML(v) { this._innerHTML = String(v); },
      get innerHTML() { return this._innerHTML; },
      querySelector(sel) { return this.__qs[sel] || (this.__qs[sel] = { textContent: '', style: {}, innerHTML: '' }); },
      appendChild(c) { if (c && c.id) reg.set(c.id, c); return c; },
      remove() { if (this.id) reg.delete(this.id); },
      setAttribute() {}
    };
    return node;
  }
  const body = el('__body'), head = el('__head');
  const document = {
    body, head, documentElement: head,
    createElement: tag => el(''),
    getElementById(id) {
      if (reg.has(id)) return reg.get(id);
      if ((id === 'mlsPullProgStop' || id === 'mlsPullProgHide') && reg.has('mlsPullProgPanel')) {
        const b = el(id); reg.set(id, b); return b;
      }
      return null;
    }
  };
  return { document, reg, el };
}

function partD() {
  const iifeStart = mc.indexOf("(function () {\n  'use strict';\n  try { if (window.__mlsPullProgress) return; } catch (e) { return; }\n  var api = { version: '1.0.0', opens: 0 };");
  assert(iifeStart > 0, '(d) pull-progress IIFE found');
  const revertTok = 'window.__mlsPullProgress_revert = function () {';
  const revertAt = mc.indexOf(revertTok, iifeStart);
  const iifeEnd = mc.indexOf('})();', revertAt);
  assert(revertAt > iifeStart && iifeEnd > revertAt, '(d) IIFE bounds');
  const iife = mc.slice(iifeStart, iifeEnd + '})();'.length);

  const dom = makeDom();
  const timers = [];
  const win = {};
  const ctx = vm.createContext({
    console, Math, Date, String, Number, Object, JSON, RegExp, Promise, Error,
    window: win, document: dom.document,
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    Worker: undefined, URL: undefined, Blob: undefined
  });
  vm.runInContext(iife, ctx, { filename: 'mc:pull-progress' });
  const api = win.__mlsPullProgress;
  assert(api && typeof api._renderDone === 'function', '(d) test seam exposed');
  const tick = () => { const fn = timers.shift(); assert(fn, 'ticker armed'); fn(); };

  /* run in progress: rows accumulate, panel opened by the doctor */
  const S = {
    __si: 1, running: true, total: 3, done: 3, ok: 2, failed: 1, chartOnly: 0,
    current: 'Cy', runId: 'r1',
    rows: [
      { k: 'Ada|p1', name: 'Ada Lovelace', ok: true, reason: '', pid: 'p1' },
      { k: 'Bob|p2', name: 'Bob Byte', ok: true, reason: '', pid: 'p2' },
      { k: 'Cy|p3', name: 'Cy Stall', ok: false, reason: 'pulled-day-note-unread visits-read-deadline-exceeded', pid: 'p3' }
    ]
  };
  win.__mlsDayHistoryPull = { state: S };
  tick(); /* running, hidden -> pill */
  const fab = dom.reg.get('mlsPullProgFab');
  assert(fab, '(d) pill exists mid-run');
  fab.onclick(); /* doctor opens the panel */
  tick();
  const panel = dom.reg.get('mlsPullProgPanel');
  assert(panel && panel.__ppBuilt, '(d) panel built mid-run');

  /* the run finishes: engine stamps verdict + finishedAt, flips running off */
  S.dayVerdict = { ok: 2, failed: 1, chartOnly: 0, total: 3, complete: false, tnFailed: 1, tnReasons: { 'visits-read-deadline-exceeded': 1 }, at: Date.now() };
  S.finishedAt = Date.now();
  S.running = false;
  tick();
  assert.strictEqual(api.doneShown, 1, '(d) terminal DONE state fired');
  tick(); tick();
  assert.strictEqual(api.doneShown, 1, '(d) ...EXACTLY ONCE across further ticks');

  const tally = panel.querySelector('[data-pp="tally"]').textContent;
  assert(tally.indexOf('✓ 2 saved') === 0, '(d) honest saved count leads the line');
  assert(tally.indexOf('⚠ 1 not saved') > 0, '(d) honest failure count');
  assert(tally.indexOf('1 pulled-day note not read') > 0, '(d) day-note refusal on the DONE line');
  assert(panel.querySelector('h3').textContent.indexOf('Done') >= 0, '(d) the card says DONE plainly');
  const hide = dom.reg.get('mlsPullProgHide');
  assert.strictEqual(hide.textContent, 'Done', '(d) no "keep pulling" framing survives - the button is Done');
  assert.strictEqual(dom.reg.get('mlsPullProgStop').style.display, 'none', '(d) Stop is gone at DONE');
  assert(panel.querySelector('[data-pp="rows"]').innerHTML.indexOf('Cy') > 0, '(d) the final rows list is painted');

  /* dismiss: the card leaves and never resurrects for this run */
  hide.onclick();
  tick();
  assert(!dom.reg.get('mlsPullProgPanel'), '(d) Done click removes the card');
  tick();
  assert(!dom.reg.get('mlsPullProgPanel') && !dom.reg.get('mlsPullProgFab'), '(d) nothing lingers after dismissal');
  assert.strictEqual(api.doneShown, 1, '(d) dismissal does not re-fire the terminal state');
}

/* ===========================================================================
 * (e2) — the UNPATCHED source fails the ordering detection (the old shape:
 * capture only in the post-batch serial pass, never in the chart window)
 * ======================================================================== */
function partE2() {
  const old = raw['feat_mls_schedimport_exact.js'];
  if (old !== si) {
    assert.strictEqual(inlineCaptureInsideLoop(old), false,
      '(e) NON-VACUITY: the pre-patch source has NO in-window capture - the ordering assertion fires on the old order');
  } else {
    /* repo already patched: synthesize the revert by removing the inline block */
    const s = si.indexOf('        /* dn-1.0 FOLD-IN (owner 2026-08-11');
    const e = si.indexOf('        if (stopAfterTimeout) {', s);
    assert(s > 0 && e > s, '(e) inline block bounds for revert');
    const reverted = si.slice(0, s) + si.slice(e);
    assert.strictEqual(inlineCaptureInsideLoop(reverted), false,
      '(e) NON-VACUITY: removing the fold-in makes the ordering assertion fire');
  }
}
