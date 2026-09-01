'use strict';

/* rwfix-1.0.0 (b1169) - THE REVIEW/WRITE SHEET SAYS WHAT IT ACTUALLY DID.
 *
 * Six measured dishonesty defects, each proved here against the SHIPPED text -
 * every runtime check below executes code sliced out of the real files, never a
 * re-implementation of it. Nothing in this suite writes, presses, or reaches
 * Athena; the write path itself is byte-pinned by tests/sheet-clarity.test.js
 * and tests/write-auto-chain.test.js and is untouched by this lane.
 *
 *  24. THE OP-NOTE BATCH SILENTLY DROPPED EVERY NOTE ITS OWN SCREEN REFUSED.
 *      opBatchEligible has always answered with `refused`; the progress card
 *      painted only run.items and the summary counted only run.items, so an
 *      8-note day with 2 quarantined bindings finished "6 of 6 written into
 *      Athena" with nothing anywhere naming the other two. Now: a fourth NOT
 *      QUEUED group naming each one with its reason, a summary that counts
 *      them, and a toast at the press that says how many were refused.
 *
 *  25. "SAVE ALL DRAFTED" COUNTED REFUSED SAVES AS SAVED, and its safe()
 *      wrapper was mis-parenthesized - `safe(f(i)())` invoked the closure
 *      OUTSIDE the try/catch, so one throwing note ended the loop in silence.
 *      Now: the closure is inside safe(), and a note counts as saved only when
 *      it reads back out of the same store opPrepSave verified against.
 *
 *  26. AN ALL-UNCHECKED SHEET READ "READY" OVER A DEAD CONFIRM. The only
 *      handler on the include checkboxes wrote the refusal into an attribute
 *      and a tooltip. Now the state word is derived from the SAME plan that
 *      enables the button, so the two cannot disagree.
 *
 *  27. THE EXHAUSTED wfauto MESSAGE CLAIMED "three minutes" AFTER 60s OR 5s.
 *      The cycle now measures its own stretch and its own re-check count and
 *      states them.
 *
 *  28. AN IMAGE OR SCANNED-PDF TEMPLATE WAS REFUSED WITH ADVICE THAT CANNOT
 *      WORK ("old .doc? re-save as .docx or PDF") when the real cause was a
 *      signed-out backend (its picture reader lives there) or a scan with no
 *      text layer. The reader now records WHICH refusal it made and the row
 *      and the batch line say that.
 *
 *  65. THE DEMO GUARD READ window._SF_DEMO, WHICH A TOP-LEVEL `const` CAN
 *      NEVER DEFINE. A top-level const is a lexical global, never a property
 *      of the global object, so syntheticLocalRuntime()'s _SF_DEMO arm was
 *      dead and ?demo=1 on the real host kept a live Athena bridge. The shell
 *      now publishes the value the const already computed - and this suite
 *      proves the guard fires in demo mode AND stays silent for a real
 *      account, by running both the shipped demo block and the shipped guard.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* This suite finishes inside an async tail, and run-all.js judges a suite on
   its EXIT CODE alone: an exit-0 that never reached the end would read as a
   pass having proved nothing. It cannot. */
let finished = false;
process.on('exit', function (code) {
  if (!finished && !code) {
    console.error('FAIL review-write-fixes: the suite exited before it finished - nothing is proved');
    process.exitCode = 1;
  }
});

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

/* Brace-matched slice of one shipped function, quote- and comment-aware. */
function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function marker: ' + marker);
  const open = source.indexOf('{', start);
  assert(open > start, 'missing function body: ' + marker);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated function body: ' + marker);
}
function between(source, from, to, what) {
  const a = source.indexOf(from);
  assert(a >= 0, 'missing start marker (' + what + '): ' + from);
  const b = source.indexOf(to, a + from.length);
  assert(b > a, 'missing end marker (' + what + '): ' + to);
  return source.slice(a, b);
}

const FLOW_FILE = '1p-feat_mls_writeflow.js';
const FLOW = read(FLOW_FILE);
const FILL = read('feat_mls_opnote_fill.js');
/* Every lane the derive scripts publish. A fix that lands only on the 1p
   source is a fix the doctor never gets. */
const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
const FLOWS = [FLOW_FILE, 'feat_mls_writeflow.js', 'cloned-feat_mls_writeflow.js'];

/* =====================================================================
 * 0. THE LANE LANDED EVERYWHERE, AND THE GATES ARE UNTOUCHED
 * ===================================================================*/
{
  SHELLS.forEach((f) => {
    const src = read(f);
    ok(src.indexOf('rwfix-1.0.0 (b1169)') > 0, f + ': the rwfix-1.0.0 pass is not in this lane at all');
  });
  FLOWS.forEach((f) => {
    const src = read(f);
    ok(src.indexOf('rwfix-1.0.0 (b1169)') > 0, f + ': the rwfix-1.0.0 pass is not in this lane at all');
    /* THE TWO CLOSED ALLOWLISTS. This lane is words and counts; if either of
       these moved, something reached into the write path. */
    ok(src.indexOf('var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true, place_order: true };') > 0,
      f + ': the executable-action allowlist changed under a wording lane');
    ok(src.indexOf('var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };') > 0,
      f + ': the queue allowlist changed under a wording lane');
  });
}

/* =====================================================================
 * 1. ITEM 65 - THE DEMO GUARD CAN NOW SEE THE DEMO FLAG
 * ===================================================================*/
{
  const EXPOSE = 'try{ window._SF_DEMO = _SF_DEMO; }catch(e){}';
  SHELLS.forEach((f) => {
    const src = read(f);
    ok(src.indexOf(EXPOSE) > 0, f + ': the demo flag is still invisible to its own guard');
    ok(src.indexOf('const _SF_DEMO = (function(){') > 0, f + ': the demo detector itself vanished');
    /* the value published must be the const, never a second detector */
    eq((src.match(/window\._SF_DEMO = /g) || []).length, 1, f + ': more than one writer of window._SF_DEMO');
  });
  FLOWS.forEach((f) => {
    const src = read(f);
    ok(src.indexOf("if (window._SF_DEMO === true || window.__MLS_SYNTHETIC_ONLY === true) return true;") > 0,
      f + ': the synthetic-runtime guard no longer reads the demo flag');
    ok(src.indexOf("if (syntheticLocalRuntime() && /^mlsAppAthenaAction/.test(S(type))) {") > 0,
      f + ': the bridge no longer asks the guard before an Athena action');
  });

  /* ---- the shipped demo block and the shipped guard, executed together ---- */
  const shell = read('1pScribeFlow.html');
  const demoBlock = between(shell, 'const _SF_DEMO = (function(){', 'const BACKEND_URL', 'demo detector');
  const guard = between(FLOW, '  function syntheticLocalRuntime() {', '  /* ===== athena-probe-only-1.0.0', 'demo guard');
  ok(demoBlock.indexOf(EXPOSE) > 0, 'the sliced demo block does not publish the flag');

  function runGuard(loc, preview, withExposure) {
    const window = {};
    window.window = window;
    if (preview) window.__MLS_PUBLIC_PREVIEW = preview;
    const context = vm.createContext({
      window, location: loc, URLSearchParams, console,
      S: (x) => (x == null ? '' : String(x)), String, Object, Boolean
    });
    const block = withExposure ? demoBlock : demoBlock.replace(EXPOSE, '');
    vm.runInContext(block + '\n' + guard + '\nwindow.__demo = _SF_DEMO; window.__guard = syntheticLocalRuntime();',
      context, { filename: 'demo-guard-proof.js' });
    return { demo: window.__demo, guard: window.__guard, exposed: window._SF_DEMO };
  }

  const REAL = { protocol: 'https:', hostname: 'mlsscribe.com', search: '' };
  const DEMO_ON_REAL = { protocol: 'https:', hostname: 'mlsscribe.com', search: '?demo=1' };
  const DOWNLOADED = { protocol: 'file:', hostname: '', search: '' };
  const LOOPBACK = { protocol: 'https:', hostname: 'localhost', search: '' };

  /* THE REGRESSION, REPRODUCED. Without the exposure line the const is true
     and the guard is still blind - this is exactly what shipped. */
  const before = runGuard(DEMO_ON_REAL, null, false);
  eq(before.demo, true, 'the demo detector did not fire on ?demo=1');
  eq(before.exposed, undefined, 'a top-level const somehow became a window property');
  eq(before.guard, false, 'the ORIGINAL defect is not reproduced: the blind guard fired anyway');

  /* THE CURE. Same block, same guard, one published value. */
  const onDemo = runGuard(DEMO_ON_REAL, null, true);
  eq(onDemo.exposed, true, '?demo=1 does not publish the flag');
  eq(onDemo.guard, true, 'THE DEMO BUILD STILL REACHES THE LIVE ATHENA BRIDGE on ?demo=1');

  const onFile = runGuard(DOWNLOADED, null, true);
  eq(onFile.demo, true, 'the downloaded file:// build is not detected as demo');
  eq(onFile.guard, true, 'the downloaded file:// build still reaches the live Athena bridge');

  const onPreview = runGuard(REAL, { enabled: true }, true);
  eq(onPreview.exposed, true, 'the public preview does not publish the demo flag');
  eq(onPreview.guard, true, 'the public preview still reaches the live Athena bridge');

  /* AND THE HALF THAT MATTERS MOST: a real doctor on the real host is
     UNCHANGED. The guard must stay silent, or this lane just broke every
     live write. */
  const real = runGuard(REAL, null, true);
  eq(real.demo, false, 'a real hosted account was misread as a demo build');
  eq(real.exposed, false, 'a real hosted account publishes a truthy demo flag');
  eq(real.guard, false, 'THE GUARD NOW FIRES FOR A REAL ACCOUNT - every Athena write is blocked');

  /* the pre-existing loopback arm is untouched and still decides on its own */
  const local = runGuard(LOOPBACK, null, true);
  eq(local.demo, false, 'a loopback host was misread as a demo build');
  eq(local.guard, true, 'the loopback arm of the guard stopped firing');
}

/* =====================================================================
 * 2. ITEM 24 - REFUSED NOTES ARE NAMED ON SCREEN AND COUNTED
 * ===================================================================*/
{
  FLOWS.forEach((f) => {
    const src = read(f);
    const summary = extractFunction(src, '  function opBatchSummaryText(run) {');
    ok(/run\.refused \|\| \[\]/.test(summary) && summary.indexOf('not queued at all') > 0,
      f + ': the run summary still counts only the notes that were queued');
    const paint = extractFunction(src, '  function opBatchPaint() {');
    ok(paint.indexOf('data-mls-opbatch-refused-group') > 0 && paint.indexOf('NOT QUEUED') > 0,
      f + ': the progress card still paints no group for the notes it refused');
    ok(paint.indexOf('esc(S(x && x.why)') > 0, f + ': a refused row is painted without its reason');
    const eligible = extractFunction(src, '  function opBatchEligible(ids, useGivenOrder) {');
    eq((eligible.match(/name: S\(byId\[id\] && byId\[id\]\.patient\)/g) || []).length, 2,
      f + ': a refusal is reported without the patient it belongs to');
    /* the refusals reach a caller unchanged - this lane added no filter */
    const status = extractFunction(src, '  function opBatchStatus() {');
    ok(status.indexOf('refused: (run.refused || []).slice()') > 0, f + ': the status object stopped reporting refusals');
  });
  SHELLS.forEach((f) => {
    const src = read(f);
    const run = extractFunction(src, '  function runAthenaAll() {');
    ok(run.indexOf('var refused = (res && res.refused) || [];') > 0, f + ': the send-all press still ignores res.refused');
    ok(run.indexOf('could NOT be queued') > 0, f + ': the press says nothing when notes were refused');
    ok(run.indexOf('batch.start({ noteIds: ids })') > 0, f + ': the press no longer goes through the one queue driver');
    ['pushHistoryNoteToAthena', 'postMessage', 'mlsAppAthena'].forEach((verb) => {
      eq(run.indexOf(verb), -1, f + ': runAthenaAll() now reaches Athena itself through ' + verb);
    });
  });

  /* ------------ the real queue, refusing real notes, painting them --------- */
  const dom = makeDom();
  const notes = [
    { id: 'n-ok', kind: 'opnote', isDraft: false, patient: 'Synthetic Ready Patient', patientId: 'p-ok',
      text: 'OPERATIVE NOTE\nA complete synthetic operative body with no unresolved fields at all.' },
    { id: 'n-draft', kind: 'opnote', isDraft: true, patient: 'Synthetic Draft Patient', patientId: 'p-draft',
      text: 'OPERATIVE NOTE\nStill a draft body.' },
    { id: 'n-blank', kind: 'opnote', isDraft: false, patient: 'Synthetic Blank Patient', patientId: 'p-blank',
      text: 'OPERATIVE NOTE\nLaterality [[laterality]] still unresolved in this body.' }
  ];
  const window = {
    document: dom.document,
    location: { hostname: 'mlsscribe.com', protocol: 'https:', search: '', origin: 'https://mlsscribe.com' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    getNotes: () => notes.map((n) => JSON.parse(JSON.stringify(n))),
    pushHistoryNoteToAthena() { /* the queue's one entry point; a no-op here */ },
    toast() {},
    addEventListener() {}, removeEventListener() {}, postMessage() {}
  };
  window.window = window;
  const context = vm.createContext({
    window, document: dom.document, location: window.location, localStorage: window.localStorage, console,
    navigator: { userAgent: 'rwfix-proof', clipboard: null },
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat, Error,
    /* Timers that never fire: the queue must PAINT synchronously inside
       start(), before a single bounded wait could have advanced. */
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: FLOW_FILE });
  const batch = window.__mlsOpBatchSend;
  ok(batch && typeof batch.start === 'function', 'the op-note queue did not install in the proof harness');

  const el = batch.eligible(['n-ok', 'n-draft', 'n-blank'], true);
  eq(el.count, 1, 'the screen queued something it should have refused');
  eq(el.refused.length, 2, 'the screen dropped a refusal instead of reporting it');
  ok(el.refused.every((r) => String(r.name || '').length > 0), 'a refusal reached the caller with no patient name: ' + JSON.stringify(el.refused));
  ok(el.refused.some((r) => /draft/i.test(String(r.why))), 'the draft refusal lost its reason: ' + JSON.stringify(el.refused));
  ok(el.refused.some((r) => /unresolved field/i.test(String(r.why))), 'the unresolved-field refusal lost its reason: ' + JSON.stringify(el.refused));

  const started = batch.start({ noteIds: ['n-ok', 'n-draft', 'n-blank'], order: 'given' });
  eq(started.started, true, 'the queue refused to start on a day with one good note: ' + JSON.stringify(started));
  eq(started.total, 1, 'the queue queued a note its own screen refused');
  eq((started.refused || []).length, 2, 'start() stopped reporting what it refused');

  const host = dom.resolve('mlsOpBatchProgress');
  ok(host, 'the queue painted no progress surface at all');
  const html = String(host.innerHTML || '');
  ok(html.indexOf('NOT QUEUED') > 0, 'THE REFUSED NOTES ARE STILL INVISIBLE: no NOT QUEUED group on the card');
  ok(html.indexOf('Synthetic Draft Patient') > 0, 'the refused draft note is not NAMED on the card');
  ok(html.indexOf('Synthetic Blank Patient') > 0, 'the refused unresolved-field note is not NAMED on the card');
  ok(/unresolved field/i.test(html), 'a refused note is on the card without the reason it was refused for');
  ok(html.indexOf('Synthetic Ready Patient') > 0, 'the queued note fell off the card');

  const summary = batch.summaryText();
  ok(summary.indexOf('2 not queued at all') > 0, 'the summary still hides the notes that were never attempted: ' + summary);
  ok(summary.indexOf('0 of 1 written into Athena') === 0, 'the summary stopped leading with what actually landed: ' + summary);

  const st = batch.status();
  eq(st.refused.length, 2, 'status() lost the refusals mid-run');
  eq(st.total, 1, 'status() counted a refused note as queued');
  batch.revert();
}

/* =====================================================================
 * 3. ITEM 25 - "SAVE ALL DRAFTED" COUNTS ONLY REAL SAVES
 * ===================================================================*/
{
  ok(FILL.indexOf('safe(function (j) { return function () { if (isFn(window.opPrepSave)) window.opPrepSave(j); }; }(i)())') < 0,
    'the mis-parenthesized safe() wrapper is still shipped - opPrepSave still runs outside its own try/catch');

  const handler = between(FILL,
    "    var sa = $('mlsOnfSaveAll'); if (sa) sa.addEventListener('click', function () {",
    '    updateBarCount();', 'save-all handler');
  ok(handler.indexOf('window.getNotes()') > 0, 'the save-all loop no longer re-reads the store it claims to have written');

  const noteOf = (n, over) => Object.assign({ note: 'OPERATIVE NOTE ' + n + '\nA synthetic body for row ' + n + '.' }, over || {});

  /* Three rows, and one stand-in for the app's own opPrepSave: it either
     saves (stamping row._noteId and pushing into the store, exactly as the
     shipped one does), REFUSES quietly (what it does when the exact patient
     identity cannot be verified, and what its own opsv-1.0.0 readback does on
     a full-quota device), or THROWS. */
  function saveAllWith(behaviour, opts) {
    const rows = [noteOf(1), noteOf(2), noteOf(3)];
    const calls = [];
    const store = [];
    const out = runSaveAllBound(rows, calls, store, behaviour, opts);
    return { rows, calls, store, toasts: out.toasts };
  }
  function runSaveAllBound(rows, calls, store, behaviour, opts) {
    opts = opts || {};
    const toasts = [];
    let listener = null;
    const button = { addEventListener(t, fn) { if (t === 'click') listener = fn; } };
    const opPrepSave = function (i) {
      calls.push(i);
      const verdict = behaviour(i);
      if (verdict === 'throw') throw new Error('synthetic storage failure on row ' + i);
      if (verdict === 'refuse') return;                 /* exactly what opPrepSave does on an unverifiable identity */
      rows[i]._noteId = 'note-' + i;
      store.push({ id: 'note-' + i });
    };
    const window = {
      _opPrep: rows, opPrepSave,
      getNotes: opts.noGetNotes ? undefined : () => store.slice(),
      opNoteBlankCount: (t) => (String(t).match(/\[\[[a-z0-9_]+\]\]/gi) || []).length
    };
    window.window = window;
    const context = vm.createContext({
      window, console, String, Object, Array, Number, JSON, RegExp, Math,
      $: (id) => (id === 'mlsOnfSaveAll' ? button : null),
      safe: (fn, d) => { try { return fn(); } catch (e) { return d; } },
      isFn: (f) => typeof f === 'function',
      S: (x) => (x == null ? '' : String(x)),
      toast: (m, k) => toasts.push({ m: String(m), k: String(k || '') }),
      updateBarCount() {}
    });
    vm.runInContext(handler, context, { filename: 'save-all-handler.js' });
    listener();
    return { toasts };
  }

  {
    const a = saveAllWith(() => 'ok');
    eq(a.calls.length, 3, 'the loop did not attempt every drafted note');
    eq(a.toasts.length, 1, 'the save-all press said more or less than one thing');
    ok(/Saved 3 notes to History/.test(a.toasts[0].m), 'a clean day no longer reports its three saves: ' + a.toasts[0].m);
    eq(a.toasts[0].k, 'ok', 'a clean day was reported as a problem');
    ok(!/NOT saved/.test(a.toasts[0].m), 'a clean day invented a refusal: ' + a.toasts[0].m);
  }

  /* B. THE MEASURED DEFECT: one note throws. The loop must survive it, and the
     doctor must be told - the shipped code ended the loop in silence. */
  {
    const b = saveAllWith((i) => (i === 1 ? 'throw' : 'ok'));
    eq(b.calls.length, 3, 'ONE THROWING NOTE STILL ENDS THE WHOLE LOOP - notes after it were never attempted');
    eq(b.store.length, 2, 'the two good notes did not reach the store');
    ok(/Saved 2 notes to History/.test(b.toasts[0].m), 'the survivors were miscounted: ' + b.toasts[0].m);
    ok(/1 NOT saved/.test(b.toasts[0].m), 'THE THROWN NOTE WAS SWALLOWED: ' + b.toasts[0].m);
    eq(b.toasts[0].k, 'err', 'a day with an unsaved note was reported as a success');
  }

  /* C. THE OTHER HALF: opPrepSave refuses quietly (unverifiable identity, or
     its own opsv-1.0.0 readback failing). It used to count as saved. */
  {
    const c = saveAllWith((i) => (i === 0 ? 'refuse' : 'ok'));
    eq(c.calls.length, 3, 'a quiet refusal stopped the loop');
    ok(/Saved 2 notes to History/.test(c.toasts[0].m), 'A REFUSED SAVE IS STILL COUNTED AS SAVED: ' + c.toasts[0].m);
    ok(/1 NOT saved/.test(c.toasts[0].m), 'the refused note is not named as unsaved: ' + c.toasts[0].m);
    eq(c.toasts[0].k, 'err', 'a refused save was reported as a success');
  }

  /* D. every note refused - the message may not read "Nothing drafted yet" */
  {
    const d = saveAllWith(() => 'refuse');
    ok(!/Nothing drafted yet/.test(d.toasts[0].m), 'three refused saves were reported as nothing drafted: ' + d.toasts[0].m);
    ok(/No note reached a chart/.test(d.toasts[0].m), 'a day where nothing landed does not say so: ' + d.toasts[0].m);
    ok(/3 NOT saved/.test(d.toasts[0].m), 'the refusals were not counted: ' + d.toasts[0].m);
  }

  /* E. nothing drafted at all still says exactly that */
  {
    const rows = [{ note: '' }, { note: '   ' }];
    const calls = [], store = [];
    const e = runSaveAllBound(rows, calls, store, () => 'ok', {});
    eq(calls.length, 0, 'an undrafted row was pushed at opPrepSave');
    ok(/Nothing drafted yet/.test(e.toasts[0].m), 'an empty day lost its own message: ' + e.toasts[0].m);
  }

  /* F. a device with no readable store cannot be reported as saved */
  {
    const rows = [noteOf(1)];
    const calls = [], store = [];
    const f = runSaveAllBound(rows, calls, store, () => 'ok', { noGetNotes: true });
    ok(/could not be verified on this device/.test(f.toasts[0].m), 'an unverifiable save was claimed anyway: ' + f.toasts[0].m);
    ok(!/Saved 1 note to History/.test(f.toasts[0].m), 'an unverifiable save was counted as saved: ' + f.toasts[0].m);
  }
}

/* =====================================================================
 * 4. ITEM 26 - AN ALL-UNCHECKED SHEET NEVER READS READY
 * ===================================================================*/
{
  FLOWS.forEach((f) => {
    const src = read(f);
    ok(/addEventListener\('change', function \(\) \{ unifiedSyncFromIncludeCheckbox\(state\); \}\)/.test(src),
      f + ': the include checkboxes are not routed through the honest sync');
    const sync = extractFunction(src, '  function unifiedSyncFromIncludeCheckbox(state) {');
    ok(sync.indexOf('unifiedSyncPrimaryButton(state)') > 0, f + ': the checkbox sync stopped syncing the button');
    ok(sync.indexOf('paintSheetclarState(state') > 0, f + ': the checkbox sync still paints nothing the doctor can read');
    const base = extractFunction(src, '  function sheetclarStateBase(state, kind) {');
    ok(base.indexOf("label: 'NOTHING CHECKED'") > 0, f + ': the state word cannot leave READY when nothing is checked');
    ok(base.indexOf('unifiedPrimaryPlan(state)') > 0, f + ': the state word is not derived from the plan that enables the button');
  });

  /* ---- the shipped state machine, run against stubbed collaborators ------- */
  const base = extractFunction(FLOW, '  function sheetclarStateBase(state, kind) {');
  function stateFor(opts) {
    const context = vm.createContext({
      console, String, Object, Array, Number, JSON, Math,
      S: (x) => (x == null ? '' : String(x)),
      SHEETUX_ZERO_REASON: 'ZERO REASON SENTINEL',
      sheetclarInAthena: () => ({ total: opts.total || 0, landed: opts.landed || 0 }),
      sheetclarReadyRow: () => (opts.readyRow === false ? null : { id: 'r1', label: 'the note' }),
      probeOnlyActive: () => false,
      bxCheckBoxes: () => (opts.boxes || []),
      unifiedPrimaryPlan: () => opts.plan || { mode: 'batch', rows: [{}], reason: '' }
    });
    vm.runInContext(base + '\nthis.__out = sheetclarStateBase(' + JSON.stringify(opts.state || {}) + ', ' +
      JSON.stringify(opts.kind || '') + ');', context, { filename: 'sheetclar-state.js' });
    return context.__out;
  }

  /* THE MEASURED DEFECT: boxes exist, none checked, the plan refuses. */
  const none = stateFor({ boxes: [{}, {}, {}], plan: { mode: 'none', rows: [], reason: 'THE ZERO REASON' } });
  eq(none.label, 'NOTHING CHECKED', 'AN ALL-UNCHECKED SHEET STILL READS: ' + none.label);
  eq(none.short, 'THE ZERO REASON', 'the state line does not carry the plan\'s own reason: ' + none.short);

  /* re-checking one section returns the sheet to READY - the same word the
     same probe binding always produced */
  const some = stateFor({ boxes: [{}, {}, {}], plan: { mode: 'batch', rows: [{}], reason: '' } });
  eq(some.label, 'READY', 'a re-checked section no longer reads READY: ' + some.label);
  const single = stateFor({ boxes: [{}], plan: { mode: 'single', rows: [{}], reason: '' } });
  eq(single.label, 'READY', 'a single-row press no longer reads READY: ' + single.label);

  /* a sheet still checking has NO boxes yet, and must not be accused of
     having nothing checked */
  const checking = stateFor({ boxes: [], plan: { mode: 'none', rows: [], reason: 'no ready section' }, readyRow: false });
  eq(checking.label, 'CHECKING', 'a sheet with no checkboxes was mislabelled: ' + checking.label);

  /* a real refusal still wins - this lane may not soften one */
  const refused = stateFor({ boxes: [{}], plan: { mode: 'none', rows: [], reason: 'THE ZERO REASON' }, kind: 'err' });
  eq(refused.label, 'CAN’T SEND', 'an Athena refusal was softened into an unchecked box: ' + refused.label);
  const oneStep = stateFor({ boxes: [{}], plan: { mode: 'none', rows: [], reason: 'THE ZERO REASON' }, kind: 'fix' });
  eq(oneStep.label, 'NEEDS ONE STEP', 'a recoverable refusal was softened into an unchecked box: ' + oneStep.label);

  /* and what already landed still outranks everything */
  const done = stateFor({ boxes: [{}], plan: { mode: 'none', rows: [], reason: 'THE ZERO REASON' }, total: 3, landed: 3 });
  eq(done.label, 'DONE', 'a fully written sheet was relabelled: ' + done.label);
  const partly = stateFor({ boxes: [{}], plan: { mode: 'none', rows: [], reason: 'THE ZERO REASON' }, total: 3, landed: 1 });
  eq(partly.label, 'PARTLY DONE', 'a partly written sheet was relabelled: ' + partly.label);
  const sending = stateFor({ boxes: [{}], plan: { mode: 'none', rows: [], reason: 'x' }, state: { running: true } });
  eq(sending.label, 'SENDING', 'a running write was relabelled: ' + sending.label);
}

/* =====================================================================
 * 5. ITEM 27 - THE EXHAUSTED MESSAGE STATES THE REAL WINDOW
 * ===================================================================*/
{
  FLOWS.forEach((f) => {
    const src = read(f);
    eq(src.indexOf('by itself for three minutes'), -1, f + ': the exhausted line still claims a fixed three-minute stretch');
    const stop = extractFunction(src, '  function wfautoStop(state, exhausted) {');
    ok(stop.indexOf('a.exhaustedMs = Math.max(0, a.exhaustedAt - (Number(a.firstArmedAt) || Number(a.startedAt) || a.exhaustedAt));') > 0,
      f + ': the cycle no longer measures the stretch it actually ran');
    ok(stop.indexOf('a.autoChecks = (Number(a.tries) || 0) + (Number(a.settledTries) || 0);') > 0,
      f + ': the cycle no longer counts the re-checks it actually ran');
    const arm = extractFunction(src, '  function wfautoArm(state, wait, mode) {');
    ok(arm.indexOf('if (!a.firstArmedAt) a.firstArmedAt = Date.now();') > 0,
      f + ': the cycle never stamps the moment it started re-checking by itself');
  });

  const span = extractFunction(FLOW, '  function wfautoSpanText(ms) {');
  const note = extractFunction(FLOW, '  function wfautoNote(state) {');
  function narrate(a) {
    const context = vm.createContext({
      console, String, Object, Number, Math, Date, JSON,
      S: (x) => (x == null ? '' : String(x)),
      wfautoOff: false, WFAUTO_MAX_PAINT: 5
    });
    vm.runInContext(span + '\n' + note + '\nthis.__out = wfautoNote(' + JSON.stringify({ wfauto: a }) + ');',
      context, { filename: 'wfauto-note.js' });
    return context.__out;
  }

  /* the settled lane: three 20s re-probes = 60 seconds, and it used to say
     three minutes */
  const settled = narrate({ exhausted: true, autoChecks: 3, exhaustedMs: 60000 });
  ok(settled.indexOf('re-checked Athena by itself 3 times over about 60 seconds') > 0,
    'a 60-second settled cycle does not say 60 seconds: ' + settled);
  eq(/three minutes/.test(settled), false, 'a 60-second cycle still claims three minutes: ' + settled);

  /* the paint lane clipped against an already-old open: five seconds */
  const clipped = narrate({ exhausted: true, autoChecks: 1, exhaustedMs: 5000 });
  ok(clipped.indexOf('by itself 1 time over about 5 seconds') > 0, 'a five-second cycle does not say five seconds: ' + clipped);

  /* the full paint ladder really does run about three minutes - and now says
     so because it measured it, not because the sentence is a constant */
  const full = narrate({ exhausted: true, autoChecks: 5, exhaustedMs: 162000 });
  ok(full.indexOf('by itself 5 times over about 3 minutes') > 0, 'the full ladder misreports its own stretch: ' + full);

  /* a cycle that never got a single re-check in may not claim any */
  const never = narrate({ exhausted: true, autoChecks: 0, exhaustedMs: 0 });
  ok(never.indexOf('could not get a single automatic re-check') > 0, 'a cycle that ran nothing claims it re-checked: ' + never);
  eq(/re-checked Athena by itself 0 times/.test(never), false, 'the empty case reads as zero re-checks: ' + never);

  /* every arm still ends with the same instruction - the fix is the number,
     not the advice */
  [settled, clipped, full, never].forEach((s) => {
    ok(s.indexOf('press Check Athena again') > 0, 'an exhausted message lost its next step: ' + s);
    ok(s.indexOf('this one needs you') > 0, 'an exhausted message lost its honesty: ' + s);
  });

  /* an ARMED cycle is untouched - it always narrated its real countdown */
  const armed = narrate({ exhausted: false, armed: true, mode: 'settled', nextAt: Date.now() + 20000 });
  ok(armed.indexOf('check Athena again by itself in about') > 0, 'the armed narration changed: ' + armed);
}

/* =====================================================================
 * 6. ITEM 28 - AN UNREADABLE TEMPLATE IS REFUSED WITH ITS REAL CAUSE
 * ===================================================================*/
{
  SHELLS.forEach((f) => {
    const src = read(f);
    ok(src.indexOf('_tplReadAdvice(u.reason)') > 0, f + ': the unreadable review row still gives one fixed piece of advice');
    ok(src.indexOf('var whyAll=_tplUnreadableWhy(_tplUnreadableRows);') > 0,
      f + ': the all-unreadable batch line still guesses "old .doc files?"');
    eq(src.indexOf("couldn’t be read as text (old .doc files? re-save them as .docx or PDF and upload again)"), -1,
      f + ': the wrong batch advice is still shipped');
    ok(src.indexOf('reason:rsn') > 0, f + ': the reader\'s reason is not carried onto the unreadable row');
  });

  const shell = read('1pScribeFlow.html');
  /* Sliced by explicit boundaries, not by brace matching: this reader is a
     wall of regex literals and `/^image\//` would read as a line comment. */
  const advice = between(shell, 'var _TPL_READ_ADVICE={', 'async function _tplReadAnyFile(file){', 'read advice');
  const reader = between(shell, 'async function _tplReadAnyFile(file){', '/* Count how many SEPARATE notes a blob holds', 'file reader');
  ok(advice.indexOf('function _tplUnreadableWhy(rows){') > 0, 'the shared-cause summary is not in the advice block');
  ok(reader.indexOf('_tplReadDone(') > 0, 'the reader records no reason at all');

  function makeReaderContext(opts) {
    opts = opts || {};
    const context = vm.createContext({
      console, String, Object, Array, Number, JSON, RegExp, Math, Promise,
      backendMode: () => opts.backend !== false,
      bkToken: () => (opts.token === false ? '' : 'tok'),
      bkBase: () => 'https://backend.example',
      readFileAsDataUrl: async () => 'data:image/png;base64,AAAA',
      fetch: async () => ({ ok: opts.visionOk !== false, json: async () => ({ text: opts.visionText || '' }) }),
      extractPdfText: async () => (opts.pdfText === undefined ? '' : opts.pdfText),
      _extractDocxText: async () => (opts.docxText === undefined ? '' : opts.docxText),
      _extractLegacyDocText: async () => (opts.legacyText === undefined ? '' : opts.legacyText),
      _tplStripWordJunk: (s) => String(s || ''),
      _cleanExtractedText: (s) => String(s || '')
    });
    vm.runInContext('var _tplReadReason="";\n' + advice + '\n' + reader, context, { filename: 'tpl-reader.js' });
    return context;
  }
  async function readAs(file, opts) {
    const context = makeReaderContext(opts);
    context.__file = file;
    const out = await vm.runInContext('_tplReadAnyFile(__file)', context, { filename: 'tpl-reader-call.js' });
    return { text: out, reason: vm.runInContext('_tplReadReason', context) };
  }
  const BODY = 'A synthetic operative template body with plenty of real letters in it for the reader.';

  (async () => {
    /* THE MEASURED CASE 1: a signed-out doctor photographing his binder. */
    const signedOut = await readAs({ name: 'page1.jpg', type: 'image/jpeg' }, { backend: false });
    eq(signedOut.text, '', 'a signed-out image read returned text');
    eq(signedOut.reason, 'needs-sign-in', 'A SIGNED-OUT IMAGE IS STILL REFUSED WITH NO CAUSE');

    /* signed in, but the reader itself refused */
    const visionNo = await readAs({ name: 'page1.jpg', type: 'image/jpeg' }, { visionOk: false });
    eq(visionNo.reason, 'vision-refused', 'a refused /api/vision read is reported as something else');

    /* signed in and it worked: the reason clears, so no row can be painted */
    const visionYes = await readAs({ name: 'page1.jpg', type: 'image/jpeg' }, { visionText: BODY });
    eq(visionYes.text, BODY, 'a successful vision read lost its text');
    eq(visionYes.reason, '', 'a SUCCESSFUL read still carries a refusal reason');

    /* THE MEASURED CASE 2: a scanned PDF with no text layer */
    const scan = await readAs({ name: 'binder.pdf', type: 'application/pdf' }, { pdfText: '' });
    eq(scan.reason, 'no-text-layer', 'a scanned PDF is still refused as if it were an old .doc');
    const goodPdf = await readAs({ name: 'binder.pdf', type: 'application/pdf' }, { pdfText: BODY });
    eq(goodPdf.reason, '', 'a readable PDF was marked unreadable');

    /* the case the old sentence was actually written for, still named */
    const legacy = await readAs({ name: 'old.doc', type: 'application/msword' }, { legacyText: '' });
    eq(legacy.reason, 'legacy-doc', 'an old .doc lost the advice that was always right for it');

    const docx = await readAs({ name: 'form.docx', type: '' }, { docxText: '' });
    eq(docx.reason, 'docx-empty', 'an empty .docx is reported as something else');

    /* the advice itself must not send a signed-out doctor round the loop the
       measured defect sent him round */
    const context = makeReaderContext({});
    const adviceFor = (r) => vm.runInContext('_tplReadAdvice(' + JSON.stringify(r) + ')', context);
    ok(/sign in/i.test(adviceFor('needs-sign-in')), 'the signed-out advice does not say to sign in');
    eq(/re-save/i.test(adviceFor('needs-sign-in')), false, 'the signed-out advice still sends him back to re-save the file');
    ok(/scan/i.test(adviceFor('no-text-layer')), 'the scanned-PDF advice does not name the scan');
    ok(/re-save it as \.docx/i.test(adviceFor('legacy-doc')), 'the old .doc advice lost the step that works');
    ok(adviceFor('unreadable').length > 20, 'the fallback advice is empty');
    ok(adviceFor('something-new').length > 20, 'an unknown reason has no advice at all');

    const whyFor = (rows) => vm.runInContext('_tplUnreadableWhy(' + JSON.stringify(rows) + ')', context);
    eq(whyFor([{ reason: 'needs-sign-in' }, { reason: 'needs-sign-in' }]), adviceFor('needs-sign-in'),
      'a batch that all failed for one reason does not state that reason');
    ok(/Each row below says why/.test(whyFor([{ reason: 'needs-sign-in' }, { reason: 'no-text-layer' }])),
      'a mixed batch picks one cause and is wrong for the rest');

    finished = true;
    console.log('PASS review-write-fixes: ' + checks + ' checks - the op-note queue NAMES every note it refused and counts them in its summary and at the press; "Save all drafted" runs each save inside its own try/catch and counts only the notes that read back out of the chart store; an all-unchecked sheet drops out of READY and shows the same refusal that greys Confirm, while every real Athena refusal still outranks it; the exhausted automatic re-check states the stretch and the count it actually ran instead of a fixed "three minutes"; an unreadable template names its real cause (signed out, no text layer, old .doc) instead of one piece of advice that cannot work; and the demo guard can finally see the demo flag - firing on ?demo=1, file:// and the public preview, and staying silent for a real hosted account.');
  })().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
}

/* ------------------------------------------------------------------ DOM shim
 * Only what the op-note queue's progress card touches. getElementById returns
 * null for the progress host until it is genuinely appended, so "the refused
 * notes are on screen" cannot pass against a phantom element. */
function makeDom() {
  const byId = new Map();
  const live = new Map();
  const LIVE_IDS = ['mlsOpBatchProgress', 'mlsOpBatchStop'];
  function node(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), style: {}, attrs: {}, children: [], handlers: {},
      id: '', title: '', disabled: false, value: '', className: '', parentNode: null,
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'id') el.id = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
      removeEventListener() {},
      appendChild(child) {
        el.children.push(child); child.parentNode = el;
        if (child.id && LIVE_IDS.indexOf(child.id) >= 0) live.set(child.id, child);
        return child;
      },
      insertBefore(child) { return el.appendChild(child); },
      remove() {
        if (el.id && live.get(el.id) === el) live.delete(el.id);
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
      },
      focus() {}, select() {}, click() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
    };
    let html = '', text = '';
    Object.defineProperty(el, 'innerHTML', { get() { return html; }, set(v) { html = String(v); el.children.length = 0; } });
    Object.defineProperty(el, 'textContent', { get() { return text; }, set(v) { text = String(v); } });
    return el;
  }
  function resolve(sel) {
    const key = String(sel || '').replace(/^#/, '');
    if (LIVE_IDS.indexOf(key) >= 0) return live.get(key) || null;
    if (!byId.has(key)) { const el = node('div'); el.id = key; el.attrs.id = key; byId.set(key, el); }
    return byId.get(key);
  }
  const document = {
    readyState: 'complete', activeElement: null,
    body: node('body'), head: node('head'), documentElement: node('html'),
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return resolve(sel); },
    querySelectorAll() { return []; },
    getElementById(id) { return resolve(id); },
    createElement(tag) { return node(tag); },
    execCommand() { return false; }
  };
  return { document, resolve };
}
