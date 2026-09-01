'use strict';
/* =============================================================================
   write-generality  (wfgen-1.0.0 / apptpick-1.0.0 / mrnopen-1.0.0 /
                            mergeid-1.0.0)

   Owner, 2026-09-01, verbatim: "it's very important that writing is going to
   work for anybody and any appointment and that's it's going to be smooth no
   matter the circumstances so please make sure to make it consistent. You can
   only test on Adam but it should work for everyone."

   Adam J Schaeffer (#7833832) is the ONLY patient anyone can write to live. So
   every assumption the write chain makes that happens to hold for Adam - an
   ASCII name, an MRN on file, one appointment that day, a chart already open,
   a foreground browser tab, a patientId that still resolves - is invisible
   until a different patient meets it. This suite is that different patient.

   It EXECUTES the shipped write chain (vm, real file, real functions) rather
   than reading it, and where a fix changed a rule it runs the PRE-FIX rule
   beside it as the causal control, so a green line here cannot mean "the test
   agrees with a reimplementation of the code".

   WHAT IT MAY NEVER DO. Nothing in this file writes to Athena, and every gate
   it touches it touches to prove the gate is STILL THERE: the four-layer
   final-action block, the closed batch action set, the identity lock's DOB and
   MRN equality, and the "MLS never picks an appointment / never picks a day"
   law all have their own pins below.

   Named *-proof.js on purpose: tests/run-all.js auto-discovers *.test.js and
   throws on unregistered ones.
   ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const WF = path.join(root, '1p-feat_mls_writeflow.js');
const src = fs.readFileSync(WF, 'utf8');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const twin = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');

let checks = 0;
function ok(cond, why) { checks++; assert.ok(cond, why); }
function eq(a, b, why) { checks++; assert.strictEqual(a, b, why); }

/* ---------------------------------------------------------------------------
   THE HARNESS. Same shape as the other 1p writeflow runtime suites: a stub
   window/document, the real file evaluated in it, and the bridge answered by
   hand so no network and no extension are involved.
   ------------------------------------------------------------------------- */
function makeHarness(opts) {
  opts = opts || {};
  const posted = [];
  const listeners = [];
  const toasts = [];
  const store = new Map();
  const hidden = { value: opts.hidden === true };
  /* A DOM faithful enough for the sheet's own controls to exist. The ids the
     rendered confirm card ALWAYS carries resolve to one stable node each (so
     the `go` captured at render and a later getElementById are the same
     object); every id the sheet CREATES on demand - the re-check button, the
     "Open it and re-check" button, the copy control - resolves to null until it
     is appended, exactly as in a browser. Without this the settle latches
     return early on `if (!el) return` and nothing downstream of them can be
     measured at all. */
  const STATIC_IDS = [
    'mlsAthenaUnifiedConfirm', 'mlsAthenaUnifiedProbe', 'mlsAthenaUnifiedFix', 'mlsAthenaUnifiedDiag',
    'mlsAthenaUnifiedGo', 'mlsAthenaUnifiedCancel', 'mlsAthenaUnifiedClose', 'mlsAthenaUnifiedContext',
    'mlsAthenaUnifiedReceipt', 'mlsAthenaUnifiedState', 'mlsAthenaUnifiedDetails',
    'mlsAthenaActionConfirm', 'mlsAthenaActionGo', 'mlsAthenaActionCancel'
  ];
  const nodes = new Map();
  function mkEl(id) {
    const el = {
      id: id || '', style: {}, dataset: {}, children: [], attrs: {},
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener() {}, removeEventListener() {},
      appendChild(c) { this.children.push(c); return c; },
      remove() {}, closest() { return null; },
      querySelector(sel) { const m = /^#([A-Za-z0-9_-]+)$/.exec(String(sel || '')); return m ? byId(m[1]) : null; },
      querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, contains() { return false; } },
      textContent: '', nodeType: 1, focus() {}, click() {}, disabled: false, type: '', title: '', _html: ''
    };
    /* setting innerHTML replaces the subtree, exactly as in a browser - without
       this, a strip that repaints would look like it had appended twice. */
    Object.defineProperty(el, 'innerHTML', {
      get() { return this._html; },
      set(v) { this._html = String(v == null ? '' : v); this.children.length = 0; },
      enumerable: true, configurable: true
    });
    return el;
  }
  function byId(id) {
    if (STATIC_IDS.indexOf(id) < 0) return null;
    if (!nodes.has(id)) nodes.set(id, mkEl(id));
    return nodes.get(id);
  }
  const elementStub = () => mkEl('');
  const document = {
    readyState: 'complete',
    get hidden() { return hidden.value; },
    get visibilityState() { return hidden.value ? 'hidden' : 'visible'; },
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: byId,
    createElement: elementStub,
    body: elementStub(), head: elementStub(), documentElement: elementStub(),
    activeElement: null
  };
  const window = {
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage: (msg) => posted.push(msg),
    location: { origin: 'https://mlsscribe.com', search: '', href: 'https://mlsscribe.com/ScribeFlow.html', hostname: 'mlsscribe.com' },
    document,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    uns: n => 'acct:' + n,
    toast: (m, k) => toasts.push({ m: String(m), k: String(k || '') }),
    _calAppts: opts.calAppts || [],
    getPatients: () => (opts.patients || []),
    __mlsDoctorMidVisit: () => false
  };
  window.window = window;
  const timers = [];
  const channels = { n: 0 };
  const context = vm.createContext({
    window, document,
    localStorage: window.localStorage,
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    MutationObserver: function () { return { observe: () => {}, disconnect: () => {} }; },
    MessageChannel: function () {
      const self = this;
      channels.n++;
      self.port1 = { onmessage: null, close: () => {} };
      self.port2 = { postMessage: () => { setImmediate(() => { if (self.port1.onmessage) self.port1.onmessage({}); }); }, close: () => {} };
    },
    console
  });
  vm.runInContext(src, context, { filename: '1p-feat_mls_writeflow.js' });
  const wf = context.window.__mlsWriteFlow;
  ok(wf && wf.installed === true, 'the write flow failed to install in the harness');
  const tick = () => new Promise(r => setImmediate(r));
  async function settle(n) { for (let i = 0; i < (n || 8); i++) await tick(); }
  function deliver(data) { listeners.slice().forEach(fn => { try { fn({ data }); } catch (e) {} }); }
  /* Fire ONLY the timers parked at a given delay, so advancing the automatic
     re-check does not also expire every in-flight bridge timeout. */
  function fireTimersAt(ms) {
    const hit = [];
    for (let i = timers.length - 1; i >= 0; i--) if (Number(timers[i].ms) === Number(ms)) hit.push(timers.splice(i, 1)[0]);
    hit.forEach(x => { try { x.fn(); } catch (e) {} });
    return hit.length;
  }
  function nodeFor(id) { return byId(id); }
  return { wf, posted, deliver, settle, toasts, hidden, timers, fireTimersAt, nodeFor, store, window, channels };
}

const ADAM = { patientId: 'mr85n5sdkd6o', name: 'Adam J Schaeffer', dob: '03/24/2006', mrn: '7833832' };
const SECTION = [{ key: 'note', text: 'Reviewed body for the write-generality proof.' }];
const VISIT = { visitDate: '2026-06-20', provider: 'Michael Schaeffer', appointmentId: '52585999' };

/* ===========================================================================
   1. IDENTITY IS A PERSON, NOT A SPELLING  (wfgen-1.0.0, class b)

   validatedUnifiedProbe compares the name Athena's own read-only reply reports
   against the name MLS holds, and refuses the write unless they match. Both
   sides are RENDERINGS: an EMR banner, a schedule cell and a typed patient row
   spell one person three ways. The shipped normalizer deleted every non-ASCII
   letter, so an accented name was truncated rather than normalized and the two
   renderings could not overlap - a permanent, unexplainable refusal for that
   patient. The pre-fix rule runs below as the causal control.
   ========================================================================= */
{
  const h = makeHarness();
  const id = h.wf.identity;
  ok(id && typeof id.nameMatch === 'function', 'the identity seam is missing - nothing below is measuring the shipped comparator');

  /* THE PRE-FIX RULE, verbatim from the shipped file before wfgen-1.0.0. This
     is the causal control: it must FAIL exactly the classes the fix added. */
  function preFixNrm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function preFixMatch(a, b) {
    const ta = preFixNrm(a).split(' ').filter(x => x.length > 1);
    const tb = preFixNrm(b).split(' ').filter(x => x.length > 1);
    if (!ta.length || !tb.length) return false;
    const o = ta.filter(x => tb.indexOf(x) >= 0).length;
    return o >= 2 || (o >= 1 && Math.min(ta.length, tb.length) === 1);
  }

  /* Built from code points so this file stays ASCII-only (latin1 pipeline). */
  const eA = String.fromCharCode(233), iA = String.fromCharCode(237);
  const EA = String.fromCharCode(201), IA = String.fromCharCode(205);
  const APOS = String.fromCharCode(39), RAPOS = String.fromCharCode(8217);

  const SAME = [
    ['Adam J Schaeffer', 'SCHAEFFER, ADAM J', 'the live-testable patient, as Athena renders him'],
    ['Adam J Schaeffer', 'Schaeffer, Adam', 'middle initial dropped by the banner'],
    ['Robert Smith Jr', 'Smith, Robert Jr', 'generational suffix'],
    ['Maria De La Cruz', 'DE LA CRUZ, MARIA', 'two-word surname'],
    ['Nguyen Van Minh', 'MINH, NGUYEN VAN', 'two-word given name'],
    ['Mary-Jane OBrien', 'O' + APOS + 'Brien, Mary-Jane', 'hyphen plus apostrophe'],
    ['Mary-Jane O' + RAPOS + 'Brien', 'OBrien, Mary Jane', 'a curly apostrophe against a welded surname'],
    ['McDonald, Ann', 'ANN MCDONALD', 'a Mc name against an all-caps rendering'],
    /* both sides accented already worked, because both were mangled the SAME
       way. That is exactly why the one-sided case below was so hard to see. */
    ['Jos' + eA + ' Garc' + iA + 'a', 'GARC' + IA + 'A, JOS' + EA, 'both accented, Athena all-caps last-first']
  ];
  const NEW_CLASSES = [
    ['Jose Garcia', 'Jos' + eA + ' Garc' + iA + 'a', 'one side accented, the other ASCII'],
    ['Ada Sample', 'AdaSample', 'a welded textContent read of two elements'],
    ['Sample, Ada', 'AdaSample', 'a welded rendering against the last-first spelling']
  ];
  const DIFFERENT = [
    ['Adam J Schaeffer', 'Michael Schaeffer', 'two people who share a surname'],
    ['Adam Schaeffer', 'Barbara Klein', 'two unrelated people'],
    ['', 'Adam J Schaeffer', 'an absent name never matches'],
    ['Adam J Schaeffer', '', 'an absent reply never matches']
  ];

  SAME.forEach(([a, b, why]) => {
    ok(id.nameMatch(a, b) === true, 'wfgen regression: ' + why + ' stopped matching');
    ok(preFixMatch(a, b) === true, 'control drifted: ' + why + ' did not match before the fix either');
  });
  NEW_CLASSES.forEach(([a, b, why]) => {
    ok(id.nameMatch(a, b) === true, 'wfgen: ' + why + ' still refuses - that patient cannot be written to');
    ok(preFixMatch(a, b) === false, 'causal control lost: ' + why + ' already matched before the fix, so this row proves nothing');
  });
  DIFFERENT.forEach(([a, b, why]) => {
    ok(id.nameMatch(a, b) === false, 'GATE WEAKENED: ' + why + ' now matches');
    ok(preFixMatch(a, b) === false, 'control drifted: ' + why);
  });

  /* The rule itself is UNCHANGED - two overlapping tokens, or one when a side
     has only one. Folding a rendering may never become "any two names". */
  ok(id.nameMatch('Adam Schaeffer', 'Adam Klein') === false, 'GATE WEAKENED: one shared token now matches two multi-token names');
  ok(id.nameMatch('Schaeffer', 'Adam Schaeffer') === true, 'the single-token rule changed');

  /* DOB and MRN are untouched by any of this. */
  eq(id.normDob('03/24/2006'), id.normDob('2006-03-24'), 'the DOB comparator stopped reading two renderings of one date');
  ok(id.normDob('03/24/2006') !== id.normDob('03/25/2006'), 'GATE WEAKENED: two different dates of birth now compare equal');
  eq(id.normId('A-7833832'), '7833832', 'the MRN digit comparator changed');
  ok(id.normId('7833832') !== id.normId('7833833'), 'GATE WEAKENED: two different MRNs now compare equal');
}

/* ===========================================================================
   2. AN ISO DATE OF BIRTH IS A DATE, NOT A REFUSAL  (isodob-1.0.0, class a/b)

   The shipped reader is M/D/Y only, and it does not DECLINE an ISO date - it
   MISREADS one: scanning "1962-03-04" left to right, the first M/D/Y match
   starts inside the year, so 4 March 1962 read as 3 February 2004. The chart
   banner's own "03/04/1962" reads correctly, so the two never compare equal and
   the identity lock refuses with a sentence that blames Athena. Adam is stored
   M/D/Y and never met it. The pre-fix reader runs below as the causal control.
   ========================================================================= */
{
  const h = makeHarness();
  const id = h.wf.identity;
  function preFixDob(s) {
    const m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(String(s == null ? '' : s));
    if (!m) return '';
    const pivot = (new Date().getFullYear() % 100) + 1;
    const y = m[3].length === 2 ? ((Number(m[3]) > pivot ? '19' : '20') + m[3]) : m[3];
    const mo = Number(m[1]), dy = Number(m[2]);
    if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return '';
    return mo + '/' + dy + '/' + y;
  }
  const PAIRS = [
    ['1962-03-04', '03/04/1962', 'the exact pair idread-1.0.0 measured on the pull side'],
    ['2006-03-24', '03/24/2006', 'the live-testable patient, stored the other way'],
    ['1981-07-02', '7/2/1981', 'unpadded M/D/Y'],
    ['1962-11-30', '11/30/1962', 'a two-digit month and day']
  ];
  PAIRS.forEach(([iso, mdy, why]) => {
    eq(id.normDob(iso), id.normDob(mdy), 'isodob: ' + why + ' - the same birthday still reads as two different dates');
    ok(preFixDob(iso) !== preFixDob(mdy), 'causal control lost: ' + why + ' already compared equal before the fix');
  });
  /* the M/D/Y branch is untouched */
  PAIRS.forEach(([, mdy]) => eq(id.normDob(mdy), preFixDob(mdy), 'isodob regression: an M/D/Y date now parses differently'));
  /* and it can never make two DIFFERENT dates equal */
  ok(id.normDob('1962-03-04') !== id.normDob('1962-04-03'), 'GATE WEAKENED: month and day swapped now compares equal');
  ok(id.normDob('1962-03-04') !== id.normDob('1963-03-04'), 'GATE WEAKENED: two different years now compare equal');
  ok(id.normDob('1962-03-04') !== id.normDob('03/04/1963'), 'GATE WEAKENED: ISO vs a different M/D/Y year compares equal');
  eq(id.normDob('not a date'), '', 'an unreadable date must yield nothing, never a guess');
  eq(id.normDob('1962-13-04'), '', 'an impossible month must yield nothing');
  eq(id.normDob(''), '', 'an absent date must yield nothing');
}

(async () => {

/* ===========================================================================
   2b. THE IDENTITY LOCK STILL REFUSES, AND NOW READS BOTH SPELLINGS
        (executed through the shipped confirm path)

   Every refusal below is the SAME line of shipped code the write depends on
   (showActionConfirm's identity gate, which is nameMatch + nrmDob equality +
   nrmId equality when MLS holds an MRN). The suite reads its verdict from the
   refusal the doctor would have seen.
   ========================================================================= */
const REFUSED = 'does not match the saved patient identity';
async function lockOnce(patient, ctx) {
  const h = makeHarness({ interactive: true });
  h.wf.startAthenaAction('write_note', { patient: patient, sections: SECTION, expectedContext: VISIT });
  await h.settle();
  const probe = h.posted.find(m => m.type === 'mlsAppAthenaActionV2');
  ok(probe && probe.mode === 'probe', 'the read-only probe was never posted');
  eq(probe.notePolicy, 'empty_only', 'the empty-field-only policy left the probe request');
  h.deliver({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: probe.requestId,
    resp: { ok: true, actionToken: 'tok', context: ctx } });
  await h.settle();
  return { refused: h.toasts.some(t => t.m.indexOf(REFUSED) >= 0), h: h };
}
const CTX = (over) => Object.assign({
  patientName: 'SCHAEFFER, ADAM J', dob: '03/24/2006', mrn: '7833832',
  encounterId: 'enc-1', encounterUrl: 'https://athenanet/enc-1', visitDate: '2026-06-20',
  provider: 'Michael Schaeffer', appointmentId: '52585999', control: 'Save'
}, over || {});

{
  const r = await lockOnce(ADAM, CTX());
  ok(r.refused === false, 'the exact patient, in Athena spelling, is now refused - nobody could write at all');
}
{
  const r = await lockOnce(ADAM, CTX({ dob: '2006-03-24' }));
  ok(r.refused === false, 'isodob: Athena reporting the birthday in ISO still reads as a different person');
}
{
  /* THE 76%-ADJACENT CASE: MLS holds the ISO spelling, Athena reports M/D/Y. */
  const isoStored = { patientId: ADAM.patientId, name: ADAM.name, dob: '2006-03-24', mrn: ADAM.mrn };
  const r = await lockOnce(isoStored, CTX());
  ok(r.refused === false, 'isodob: an ISO-stored patient still cannot be written to');
  /* and the DOB handed to MLS Assist is the one shape its own reader parses */
  const sent = r.h.posted.find(m => m.type === 'mlsAppAthenaActionV2');
  eq(sent.patient.dob, '3/24/2006', 'the bridge no longer hands MLS Assist a DOB its own M/D/Y reader can parse');
  eq(sent.expectedPatient.dob, sent.patient.dob, 'patient and expectedPatient disagree about the date of birth');
  eq(sent.patient.mrn, '7833832', 'the bridge changed the MRN');
  eq(sent.patient.name, ADAM.name, 'the bridge changed the name');
}
{
  const r = await lockOnce(ADAM, CTX({ dob: '03/25/2006' }));
  ok(r.refused === true, 'GATE WEAKENED: a DOB mismatch no longer refuses');
}
{
  const r = await lockOnce(ADAM, CTX({ dob: '2006-03-25' }));
  ok(r.refused === true, 'GATE WEAKENED: an ISO DOB mismatch no longer refuses');
}
{
  const r = await lockOnce(ADAM, CTX({ mrn: '9999999' }));
  ok(r.refused === true, 'GATE WEAKENED: an MRN mismatch no longer refuses');
}
{
  const r = await lockOnce(ADAM, CTX({ patientName: 'KLEIN, BARBARA' }));
  ok(r.refused === true, 'GATE WEAKENED: a different person no longer refuses');
}
{
  const eA = String.fromCharCode(233);
  const accented = { patientId: 'p-2', name: 'Jose Garcia', dob: '1974-05-11', mrn: '4412207' };
  const r = await lockOnce(accented, CTX({ patientName: 'GARC' + String.fromCharCode(205) + 'A, JOS' + String.fromCharCode(201), dob: '05/11/1974', mrn: '4412207' }));
  ok(r.refused === false, 'wfgen + isodob: an accented, ISO-stored patient still cannot be written to');
  ok(eA.length === 1, 'code-point construction sanity');
}
{
  const accented = { patientId: 'p-2', name: 'Jose Garcia', dob: '1974-05-11', mrn: '4412207' };
  const r = await lockOnce(accented, CTX({ patientName: 'KLEIN, BARBARA', dob: '05/11/1974', mrn: '4412207' }));
  ok(r.refused === true, 'GATE WEAKENED: folding a rendering let a different person through');
}

/* ===========================================================================
   3. A QUEUED SEND HEARS THE HONEST REFUSAL  (wfgen-1.0.0, classes f + g)

   bx-1.0.0 (checked sections) and opbatch-1.0.0 (op notes) both wait on the
   same latch: `probeSettled === probeGeneration && !probe`. unifiedRecheckButton
   wrote it; unifiedRecoverableStatus - where wfdxOpenEncounter's whole ladder
   lands - did not. So the "one step needed: the Day view has to be on <day>"
   refusal, which is the COMMON outcome for any patient whose chart is not
   already open, left a queue waiting out its entire 150s read-only bound and
   then reporting a timeout that had not happened. Driven end to end here.
   ========================================================================= */
{
  const h = makeHarness();
  const probes = () => h.posted.filter(m => m.type === 'mlsAppAthenaActionV2');
  const opens = () => h.posted.filter(m => m.type === 'mlsAppSearchOpenPatient');
  const navs = () => h.posted.filter(m => m.type === 'mlsAppGotoDate');

  h.wf.openUnifiedConfirmation({ patient: ADAM, sections: SECTION, expectedContext: VISIT });
  await h.settle();
  ok(probes().length === 1, 'the sheet did not run its opening read-only check');

  /* FIRST refusal -> the one-per-review auto-open (wf2-2.2.0). It fails, and
     THAT terminal already latched (unifiedRecheckButton). Not the one under
     test - it is the setup for the one that is. */
  h.deliver({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: probes()[0].requestId,
    resp: { ok: false, blocked: true, reason: 'context-unverified' } });
  await h.settle();
  h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: opens()[0].requestId,
    resp: { requestId: opens()[0].requestId, ok: false, opened: false, reason: 'appointment-id-not-found' } });
  await h.settle();
  h.deliver({ source: 'mls-ext', type: 'mlsAppGotoDateResult', requestId: navs()[0].requestId,
    resp: { ok: true, supported: true, schedDate: '2026-06-20' } });
  await h.settle();
  h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: opens()[1].requestId,
    resp: { requestId: opens()[1].requestId, ok: false, opened: false, reason: 'appointment-id-not-found' } });
  await h.settle();

  /* wfauto-1.0.0 parked its bounded read-only re-check (WFAUTO_IDLE_MS). Fire
     just that one: this is the SECOND probe, and it is the one whose refusal
     reaches wfdxOpenEncounter's own ladder rather than the one-per-review
     auto-open that already had a latch of its own. */
  const armed = h.wf.diagnostics.autoChain.snapshot();
  ok(armed && armed.armed === true, 'the automatic read-only re-check never armed on the settled refusal');
  eq(h.fireTimersAt(armed.waitMs), 1, 'the armed re-check parked no timer (or more than one)');
  await h.settle();
  ok(probes().length >= 2, 'the automatic read-only re-check never ran - the scenario under test was not reached');
  const probe2 = probes()[probes().length - 1];
  h.deliver({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: probe2.requestId,
    resp: { ok: false, blocked: true, reason: 'context-unverified' } });
  await h.settle();

  /* rowfirst-1.0.0: the exact-id row click runs first, against whatever is painted */
  const rowFirst = opens()[opens().length - 1];
  ok(rowFirst, 'the exact-appointment row click was never attempted');
  h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: rowFirst.requestId,
    resp: { requestId: rowFirst.requestId, ok: false, opened: false, reason: 'appointment-id-not-found' } });
  await h.settle();

  /* ...then the Day-view drive, which reports athenaOne is on a DIFFERENT day.
     THIS refusal lands in unifiedRecoverableStatus and nowhere else. */
  const nav = navs()[navs().length - 1];
  ok(nav && navs().length >= 2, 'the row-not-painted refusal did not fall back to the Day-view drive');
  h.deliver({ source: 'mls-ext', type: 'mlsAppGotoDateResult', requestId: nav.requestId,
    resp: { ok: true, supported: true, schedDate: '2026-06-18' } });
  await h.settle();

  const st = h.wf.diagnostics.state();
  ok(st && !st.probe, 'a wrong-day refusal must never leave a validated probe behind');
  eq(st.probeSettled, st.probeGeneration,
    'THE QUEUE STILL HANGS: a wfdxOpenEncounter ladder refusal does not settle its probe generation, so a batch burns its whole read-only bound and then reports a timeout that never happened');

  /* the exact predicate bx-1.0.0 and opbatch-1.0.0 both wait on */
  const queueSeesAnAnswer = (st.probeSettled === st.probeGeneration && !st.probe);
  ok(queueSeesAnAnswer === true, 'the queue settle predicate is false on a settled refusal');

  /* and the words the queue will record are the sheet's own honest step */
  ok(h.toasts.some(t => /2026-06-20/.test(t.m) && /2026-06-18/.test(t.m) && /Nothing was changed/i.test(t.m)),
    'the refusal stopped naming BOTH the expected day and the day athenaOne is actually on. Said instead: ' +
    JSON.stringify(h.toasts.map(t => t.m).slice(-3)));

  /* wfauto must NOT keep re-checking after a positive wrong-day refusal */
  eq(h.wf.diagnostics.autoChain.positiveLatch(), 'day-view-wrong-day',
    'a positively wrong day no longer latches the automatic re-check off');
}

/* Source pin for the same law, so a revert of the one line reds this suite even
   if the scenario above is ever reshaped. */
{
  const i = src.indexOf('function unifiedRecoverableStatus');
  ok(i > 0, 'unifiedRecoverableStatus is gone');
  ok(src.slice(i, i + 1600).includes('state.probeSettled = state.probeGeneration'),
    'the settle latch left unifiedRecoverableStatus - the second of the two terminals');
  const j = src.indexOf('function unifiedRecheckButton');
  ok(src.slice(j, j + 700).includes('state.probeSettled = state.probeGeneration'),
    'the settle latch left unifiedRecheckButton - the first of the two terminals');
}

/* ===========================================================================
   4. THE PACING BUDGET IS THE SAME WALL CLOCK IN A HIDDEN TAB  (class l)

   probeUnifiedRow asks the extension to bring athenaOne FORWARD for its
   read-only check, so the MLS tab is hidden for exactly the stretch the ladder
   paces (12s settle, then up to 4 x 15s). A hidden tab's setTimeout is clamped
   and then bucketed to one minute, which silently multiplies that budget past
   the queue's own 150s bound - so the LAST note in a batch got different
   pacing from the first. Every one of those waits now goes through bxSleep.
   ========================================================================= */
{
  const ladder = src.slice(src.indexOf('function wfdxOpenEncounter'), src.indexOf('function validatedUnifiedProbe'));
  ok(!/setTimeout\([^)]*probeUnifiedRow/.test(ladder), 'a bare setTimeout re-probe came back to the open ladder');
  const probeFn = src.slice(src.indexOf('function probeUnifiedRow'), src.indexOf('/* wfsum-1.0.0 (owner 2026-08-26'));
  const bareReprobes = (probeFn.match(/setTimeout\(function \(\) \{[\s\S]{0,200}?probeUnifiedRow/g) || []);
  eq(bareReprobes.length, 0, 'a bare setTimeout re-probe came back to probeUnifiedRow: ' + bareReprobes.length + ' left');
  ok(src.includes('function wfPaceThen(ms, fn)'), 'the hidden-safe paced wait is gone');
  const pace = src.slice(src.indexOf('function wfPaceThen'), src.indexOf('function bxWait'));
  ok(pace.includes('bxSleep(ms)'), 'wfPaceThen stopped routing through bxSleep');
  ok(src.slice(src.indexOf('function bxSleep'), src.indexOf('function wfPaceThen')).includes('MessageChannel'),
    'bxSleep lost its hidden-tab MessageChannel yield');

  /* EXECUTED: a hidden tab still resolves, and it does not park a bare timer. */
  const h = makeHarness({ hidden: true });
  h.wf.openUnifiedConfirmation({ patient: ADAM, sections: SECTION, expectedContext: VISIT });
  await h.settle();
  const probe = h.posted.find(m => m.type === 'mlsAppAthenaActionV2');
  h.deliver({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: probe.requestId,
    resp: { ok: false, blocked: true, reason: 'context-unverified' } });
  await h.settle();
  const rowFirst = h.posted.filter(m => m.type === 'mlsAppSearchOpenPatient')[0];
  h.deliver({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', requestId: rowFirst.requestId,
    resp: { requestId: rowFirst.requestId, ok: true, complete: true, via: 'appt-id' } });
  await h.settle(40);
  /* The openpace budget is 12s then up to 4 x 15s, plus the 1.2s procedure
     re-check. Those are the WAITS (a bridge timeout is a deadline, not a wait,
     and stretching one only means waiting longer for an answer). Not one of
     them may be a bare timer any more. */
  const PACING = [12000, 15000, 1200];
  const parked = h.timers.filter(t => PACING.indexOf(Number(t.ms)) >= 0);
  eq(parked.length, 0,
    'a successful read-only open in a HIDDEN tab parked a bare pacing timer (' + parked.map(t => t.ms).join(',') +
    'ms) - that is the wait a hidden tab stretches to a minute and pushes a queued note past its bound');
  /* ...and the wait it DID take is the hidden-safe one: bxSleep opens a
     MessageChannel and yields on it while the tab is hidden, instead of handing
     the delay to a timer the browser is free to bucket. */
  ok(h.channels.n > 0,
    'no MessageChannel was opened for the paced wait in a hidden tab - the wait is not hidden-safe');
}

/* ===========================================================================
   5. TWO APPOINTMENTS ON ONE DAY  (apptpick-1.0.0, class c)

   The resolver binds an appointment only when the day holds EXACTLY ONE row for
   this patient. A patient seen twice that day therefore blocks, and the wfbind
   cure re-pulls the day and asks the SAME resolver again - forever. The cure is
   a CHOICE, on the same law bindday-1.0.0 uses for several candidate days: MLS
   still never picks; the doctor names one; the read-only probe still arbitrates.
   ========================================================================= */
function dayRow(id, athenaId, hhmm, provider) {
  return { id: id, patient_external_id: ADAM.patientId, day_local: '2026-06-20',
    appt_date: '2026-06-20', start_at: '2026-06-20T' + hhmm + ':00',
    athena_appointment_id: athenaId, provider: provider || 'Michael Schaeffer' };
}
{
  /* ONE appointment: the ordinary resolver binds it and no control is offered. */
  const h = makeHarness({ calAppts: [dayRow('3794', '52585999', '09:15')] });
  const m1 = h.wf.buildUnifiedManifest({ patient: ADAM, sections: SECTION,
    expectedContext: { visitDate: '2026-06-20', provider: 'Michael Schaeffer' } });
  eq(m1.visit.appointmentId, '52585999', 'the single-appointment day stopped resolving on its own');
  eq(h.wf.bindCure.apptChoices('2026-06-20', m1).length, 1, 'one appointment must never be offered as a choice');
}
{
  /* TWO appointments: the resolver honestly refuses (unchanged), and the choice
     names both. This is the causal control for the whole block. */
  const h = makeHarness({ calAppts: [dayRow('3794', '52585999', '09:15'), dayRow('3795', '52586777', '15:40')] });
  const m2 = h.wf.buildUnifiedManifest({ patient: ADAM, sections: SECTION,
    expectedContext: { visitDate: '2026-06-20', provider: 'Michael Schaeffer' } });
  eq(m2.visit.appointmentId, '',
    'GATE WEAKENED: with two appointments on one day MLS now picks one by itself');
  const writeRows = m2.rows.filter(r => r.action === 'write_note');
  ok(writeRows.length > 0 && writeRows.every(r => r.capability === 'blocked'),
    'an unbound two-appointment day must stay blocked until the doctor names one');
  ok(/appointment ID/i.test(String(writeRows[0].reason)), 'the block stopped naming the missing appointment id');

  const choices = h.wf.bindCure.apptChoices('2026-06-20', m2);
  eq(choices.length, 2, 'apptpick did not name BOTH of the day appointments (got ' + choices.length + ')');
  const ids = choices.map(c => c.appointmentId).sort();
  eq(ids.join(','), '52585999,52586777', 'apptpick named the wrong appointment ids: ' + ids.join(','));
  ok(choices.every(c => String(c.time).trim().length > 0), 'a choice with no time on it is not a choice a doctor can make');

  /* the chosen id binds the rebuilt review, and ONLY the chosen one */
  const chosen = choices.filter(c => c.appointmentId === '52586777')[0];
  const opts = h.wf.buildUnifiedManifest({ patient: ADAM, sections: SECTION,
    expectedContext: { visitDate: '2026-06-20', provider: 'Michael Schaeffer', appointmentId: chosen.appointmentId } });
  eq(opts.visit.appointmentId, '52586777', 'the chosen appointment did not reach the rebuilt review');
  ok(opts.rows.filter(r => r.action === 'write_note').some(r => r.capability === 'ready'),
    'the rebuilt review still has no sendable row after the doctor named the appointment');

  /* an id that is NOT one of this patient's day rows is never offered */
  ok(!choices.some(c => c.appointmentId === '99999999'), 'apptpick offered an appointment that is not on this day');
}
{
  /* A row that resolves to NO Athena id is never offered - MLS shows no control
     it cannot honestly bind. */
  const bare = dayRow('3796', '', '11:00');
  const h = makeHarness({ calAppts: [dayRow('3794', '52585999', '09:15'), bare, dayRow('3795', '52586777', '15:40')] });
  const m = h.wf.buildUnifiedManifest({ patient: ADAM, sections: SECTION,
    expectedContext: { visitDate: '2026-06-20', provider: 'Michael Schaeffer' } });
  eq(h.wf.bindCure.apptChoices('2026-06-20', m).length, 2, 'an unresolvable MLS-only row was offered as an Athena appointment');
}
{
  /* The provider travels with the chosen appointment. expectedVisitContext honours
     a supplied appointment id only alongside a day AND a provider, so a review
     that names no provider would take the choice and still block. The choice
     carries the provider from the SAME schedule row as the id, and only when the
     review has none of its own. */
  const h = makeHarness({ calAppts: [dayRow('3794', '52585999', '09:15', 'Matthew Schaeffer'), dayRow('3795', '52586777', '15:40', 'Michael Schaeffer')] });
  const m = h.wf.buildUnifiedManifest({ patient: ADAM, sections: SECTION, expectedContext: { visitDate: '2026-06-20', provider: '' } });
  const choices = h.wf.bindCure.apptChoices('2026-06-20', m);
  eq(choices.length, 2, 'the two same-day appointments were not both offered on a provider-less review');
  eq(choices.filter(c => c.appointmentId === '52586777')[0].provider, 'Michael Schaeffer',
    'a choice no longer carries the provider of its own schedule row');
  /* WHY THE FILL MATTERS. With no provider named, the resolver falls through to
     its nearest-appointment branch and takes THAT row's provider - which on a
     two-appointment day can be the other appointment's clinician, i.e. the
     chosen id paired with the wrong doctor. The choice pairs each id with the
     provider off its OWN schedule row. */
  const morning = choices.filter(c => c.appointmentId === '52585999')[0];
  eq(morning.provider, 'Matthew Schaeffer', 'the morning choice lost its own row provider');
  const drifted = h.wf.buildUnifiedManifest({ patient: ADAM, sections: SECTION,
    expectedContext: { visitDate: '2026-06-20', provider: '', appointmentId: '52585999' } });
  eq(drifted.visit.provider, 'Michael Schaeffer',
    'the causal control moved: a provider-less review no longer drifts to the nearest row provider');
  const paired = h.wf.buildUnifiedManifest({ patient: ADAM, sections: SECTION,
    expectedContext: { visitDate: '2026-06-20', provider: morning.provider, appointmentId: morning.appointmentId } });
  eq(paired.visit.provider, 'Matthew Schaeffer', 'the chosen appointment did not keep its own clinician');
  eq(paired.visit.appointmentId, '52585999', 'the chosen appointment id did not survive the rebuild');
  ok(paired.rows.filter(r => r.action === 'write_note').some(r => r.capability === 'ready'),
    'the chosen appointment plus its own row provider still does not produce a sendable review');
  /* and the control is wired into the strip the blocked sheet paints */
  const cure = src.slice(src.indexOf('function wfbindOfferCure'), src.indexOf('function wfbindButton'));
  ok(cure.includes('wfbindOfferApptChoice(state, host, days[0])'),
    'the appointment choice is no longer offered on the blocked sheet');
  const pick = src.slice(src.indexOf('function wfbindOptsForAppointment'), src.indexOf('function wfbindOfferApptChoice'));
  ok(pick.includes("if (!S(o.expectedContext.provider).trim() && S(choice.provider).trim())"),
    'the choice stopped filling an ABSENT provider only - it must never overwrite one the review already names');
}
{
  /* Another patient's appointment on the same day is never this patient's choice. */
  const other = { id: '4001', patient_external_id: 'someone-else', day_local: '2026-06-20',
    appt_date: '2026-06-20', start_at: '2026-06-20T10:00:00', athena_appointment_id: '52588888' };
  const h = makeHarness({ calAppts: [dayRow('3794', '52585999', '09:15'), dayRow('3795', '52586777', '15:40'), other] });
  const m = h.wf.buildUnifiedManifest({ patient: ADAM, sections: SECTION,
    expectedContext: { visitDate: '2026-06-20', provider: 'Michael Schaeffer' } });
  const ids = h.wf.bindCure.apptChoices('2026-06-20', m).map(c => c.appointmentId);
  ok(ids.indexOf('52588888') < 0, 'CROSS-PATIENT: another patient appointment was offered on this review');
}

/* ===========================================================================
   6. THE MRN-LESS PATIENT  (mrnopen-1.0.0, class a)

   76% of charts carry no MRN in MLS, and the installed MLS Assist refuses a
   section write without a digit MRN (background.js: "Expected patient name,
   DOB, and MRN are required"), so mrnadopt-1.0.0 reads it off the verified open
   chart. That cure needs a chart OPEN - and the review it runs on paints no
   ready row, which used to gate the read-only opener out of the fix strip. The
   block, the words and the adoption proof all still stand; the opener no longer
   requires a ready row when the visit itself is bound.
   ========================================================================= */
{
  const h = makeHarness();
  const noMrn = { patientId: ADAM.patientId, name: 'Ana Maria Villanueva', dob: '07/02/1981', mrn: '' };
  const m = h.wf.buildUnifiedManifest({ patient: noMrn, sections: SECTION, expectedContext: VISIT });
  const rows = m.rows.filter(r => r.action === 'write_note');
  ok(rows.length && rows.every(r => r.capability === 'blocked'),
    'GATE WEAKENED: a row with no MRN is painted ready, and MLS Assist would refuse it at check time');
  ok(h.wf.mrnAdopt.curable(noMrn) === true, 'the MRN-only block stopped being recognised as curable');
  ok(/MRN/.test(String(rows[0].reason)) && /Check Athena again/.test(String(rows[0].reason)),
    'the MRN-only block stopped naming the one action that fixes it');

  /* adoption is a POSITIVE proof, never the absence of a contradiction */
  const frozen = { patientId: noMrn.patientId, name: noMrn.name, dob: noMrn.dob };
  const good = h.wf.mrnAdopt.classify({ ok: true, identity: { name: 'VILLANUEVA, ANA MARIA', dob: '1981-07-02', mrn: '4412207' } }, frozen);
  ok(good.ok === true && good.mrn === '4412207', 'a provably matching chart no longer yields its MRN');
  ok(h.wf.mrnAdopt.classify({ ok: true, identity: { name: 'VILLANUEVA, ANA MARIA', dob: '1981-07-03', mrn: '4412207' } }, frozen).code === 'chart-identity-mismatch',
    'GATE WEAKENED: a chart with a different DOB now yields its MRN');
  ok(h.wf.mrnAdopt.classify({ ok: true, identity: { name: 'KLEIN, BARBARA', dob: '1981-07-02', mrn: '4412207' } }, frozen).code === 'chart-identity-mismatch',
    'GATE WEAKENED: a different person now yields their MRN to this patient');
  ok(h.wf.mrnAdopt.classify({ ok: true, identity: { name: 'VILLANUEVA, ANA MARIA', dob: '1981-07-02', mrn: '' } }, frozen).code === 'chart-mrn-absent',
    'a chart with no MRN stopped refusing');
  ok(h.wf.mrnAdopt.classify({ ok: false }, frozen).code === 'no-chart-open', 'no chart open stopped refusing');

  /* wfgen-1.0.0 makes the adoption proof work for the accented spelling too -
     the same chart, rendered with its diacritics. */
  const eA = String.fromCharCode(233);
  const accented = h.wf.mrnAdopt.classify({ ok: true, identity: { name: 'VILLANUEVA, ANA MAR' + String.fromCharCode(205) + 'A', dob: '1981-07-02', mrn: '4412207' } },
    { patientId: noMrn.patientId, name: 'Ana Mar' + String.fromCharCode(237) + 'a Villanueva', dob: noMrn.dob });
  ok(accented.ok === true, 'an accented chart still cannot prove itself to its own patient record');
  ok(eA.length === 1, 'code-point construction sanity');
}
{
  /* EXECUTED: open the real review for an MRN-less patient whose visit IS bound,
     and read the controls the fix strip actually painted. */
  const h = makeHarness();
  const noMrn = { patientId: 'p-nomrn', name: 'Ana Maria Villanueva', dob: '07/02/1981', mrn: '' };
  h.wf.openUnifiedConfirmation({ patient: noMrn, sections: SECTION, expectedContext: VISIT });
  const strip = h.nodeFor('mlsAthenaUnifiedFix');
  ok(strip, 'the fix strip host is gone');
  const labels = strip.children.map(c => String(c.textContent || ''));
  ok(labels.some(l => l.indexOf('Open this patient') === 0),
    'an MRN-less review with a BOUND visit still offers no read-only opener - the doctor is told to go do it by hand. Painted: ' + JSON.stringify(labels));
  ok(labels.some(l => l.indexOf('Check Athena again') === 0),
    'the MRN adoption retry left the strip');
  /* nothing on that strip may write */
  ok(!h.posted.some(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    'opening an MRN-blocked review posted an execute');
  h.wf.closeUnifiedConfirmation();
}
{
  /* An UNBOUND, MRN-less review has no exact appointment to open, so the opener
     must NOT appear: MLS never offers a control it cannot honestly drive. */
  const h = makeHarness();
  const noMrn = { patientId: 'p-nomrn', name: 'Ana Maria Villanueva', dob: '07/02/1981', mrn: '' };
  h.wf.openUnifiedConfirmation({ patient: noMrn, sections: SECTION,
    expectedContext: { visitDate: '2026-06-20', provider: 'Michael Schaeffer' } });
  const labels = h.nodeFor('mlsAthenaUnifiedFix').children.map(c => String(c.textContent || ''));
  ok(!labels.some(l => l.indexOf('Open this patient') === 0),
    'an UNBOUND review offers to open an exact appointment it does not have: ' + JSON.stringify(labels));
  h.wf.closeUnifiedConfirmation();
}
{
  /* THE FIX: the fix strip offers the read-only opener on a review with NO ready
     row, as long as the visit itself is bound. Pinned in source too, because a
     strip that stops being painted at all would take the runtime check with it. */
  const strip = src.slice(src.indexOf('function wfdxShowFixStrip'), src.indexOf('function wfdxOfferNameRoute'));
  ok(strip.includes('p1VisitBound(visit)'), 'the fix strip opener no longer gates on a bound visit');
  ok(strip.includes('canOpenUnrowed'), 'the unrowed read-only opener is gone - the MRN-less review is back to "go do it by hand"');
  ok(strip.includes('mrnAdoptOfferCure(state, host)'), 'the MRN cure control left the fix strip');
  const ladder = src.slice(src.indexOf('function wfdxOpenEncounter'), src.indexOf('function validatedUnifiedProbe'));
  ok(ladder.includes('mrnAdoptPass(state)'), 'an unrowed read-only open no longer ends in the identity read that is its whole point');
  /* it is still READ-ONLY: the ladder may post only these three verbs */
  const verbs = (ladder.match(/bridge\('([a-zA-Z]+)'/g) || []).map(s => s.replace(/bridge\('/, '').replace(/'/, ''));
  const allowed = { mlsAppGotoDate: 1, mlsAppSearchOpenPatient: 1, mlsAppChartIdentity: 1 };
  verbs.forEach(v => ok(allowed[v] === 1, 'the read-only open ladder gained a verb that is not read-only: ' + v));
}

/* ===========================================================================
   7. ONE PATIENT'S FAILURE MAY NOT POISON THE NEXT NOTE  (class g)

   opbatch-1.0.0 presses the sheet's own primary once per note. Its own guard -
   "is the open review THIS note's review" - is what keeps a rebind, a stale
   sheet or a race from writing note A's text into patient B's chart.
   ========================================================================= */
{
  const h = makeHarness();
  const B = h.wf.opBatch;
  const sheetFor = (name, pid, text) => ({
    closed: false,
    manifest: { patient: { name: name, patientId: pid, dob: '01/01/1980', mrn: '111' },
      rows: [{ id: 'r1', action: 'write_note', payload: { noteText: text } }] }
  });
  const item = { id: 'n1', name: 'Adam J Schaeffer', patientId: ADAM.patientId, body: 'Op note body for Adam.' };

  ok(B.matches(sheetFor('Adam J Schaeffer', ADAM.patientId, 'Op note body for Adam.'), item) === true,
    'the queue refuses to press its own note');
  ok(B.matches(sheetFor('SCHAEFFER, ADAM J', ADAM.patientId, 'Op note body for Adam.'), item) === true,
    'the queue refuses a sheet whose only difference is how Athena spells the name');
  ok(B.matches(sheetFor('Barbara Klein', 'other-id', 'Op note body for Adam.'), item) === false,
    'CROSS-PATIENT: the queue would press a sheet about a different patient');
  ok(B.matches(sheetFor('Adam J Schaeffer', 'other-id', 'Op note body for Adam.'), item) === false,
    'CROSS-PATIENT: the queue would press a sheet bound to a different patient id');
  ok(B.matches(sheetFor('Adam J Schaeffer', ADAM.patientId, 'A DIFFERENT op note body.'), item) === false,
    'the queue would press a sheet holding a different body of text');
  ok(B.matches(Object.assign(sheetFor('Adam J Schaeffer', ADAM.patientId, 'Op note body for Adam.'), { closed: true }), item) === false,
    'the queue would press a closed sheet');
  ok(B.matches(null, item) === false, 'the queue would press a sheet that is not there');

  /* the queue can only ever be made SMALLER by its own memory, never larger */
  ok(B.screen({ id: 'x', kind: 'opnote', isDraft: true, text: 'body' }).ok === false, 'a draft entered the queue');
  ok(B.screen({ id: 'x', kind: 'opnote', text: 'body [[knee_side]]' }).ok === false, 'a note with an unresolved field entered the queue');
  ok(B.screen({ id: 'x', kind: 'note', text: 'body' }).ok === false, 'a non-op-note entered the op-note queue');
  ok(B.screen({ id: 'x', kind: 'opnote', text: '   ' }).ok === false, 'an empty note entered the queue');
  ok(B.screen({ id: 'x', kind: 'opnote', text: 'a real body' }).ok === true, 'a finished op note stopped being queueable');
}

/* ===========================================================================
   8. THE FOUR-LAYER FINAL-ACTION BLOCK IS UNTOUCHED

   Nothing above may have widened what a write can do. Only write_note and
   save_draft may ever run from a queue; sign needs a verified write proof for
   that exact encounter; an order needs its own frozen row binding.
   ========================================================================= */
{
  const h = makeHarness();
  const actions = h.wf.opBatch.actions;
  eq(Object.keys(actions).sort().join(','), 'save_draft,write_note',
    'THE CLOSED BATCH SET CHANGED - a queue may now drive an action the doctor never confirmed one at a time');
  ['sign_encounter', 'stage_billing', 'place_order'].forEach(a => {
    ok(!actions[a], 'FINAL-ACTION BLOCK BREACHED: ' + a + ' entered the closed batch set');
  });
  ok(src.includes("var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };"), 'the closed batch set is no longer a closed literal');
  ok(src.includes("if (row.action === 'sign_encounter' && (!priorWrite || !priorWrite.noteWriteProof))"),
    'the Sign-after-verified-write gate left the probe path');
  ok(src.includes("if (row.action === 'sign_encounter' && (!exactWrite || !exactWrite.noteWriteProof))"),
    'the Sign-after-exact-encounter-proof gate left the probe path');
  ok(src.includes("notePolicy: 'empty_only'"), 'the empty-field-only note policy left the request');
  ok(src.includes("var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true, place_order: true };"),
    'the executable-action allowlist changed shape');
  /* the queue still refuses to start under the conditions that make it unsafe */
  const start = src.slice(src.indexOf('function opBatchStart'), src.indexOf('function opBatchCancel'));
  ['opBatchPullRunning()', 'unifiedAthenaState && !unifiedAthenaState.closed', 'athenaActionRunning'].forEach(guard => {
    ok(start.includes(guard), 'the op-note queue lost its refuse-to-start guard: ' + guard);
  });
}

/* ===========================================================================
   9. A NOTE OUTLIVES THE CHART ID IT WAS SAVED UNDER  (mergeid-1.0.0, class k)

   After 85 duplicate charts were merged, every note saved under a loser id
   carries an id that no longer resolves. The survivor is resolved on the
   dupmatch-1.0 law - tolerant name AND a hard second factor, one unambiguous
   hit - and only the ID is adopted, so this can create no new refusal.
   ========================================================================= */
{
  const shellCtx = { checked: 0 };
  function evalShellFns(html) {
    /* pull the three functions this law is made of out of the shipped shell and
       run them against a controlled patient list */
    const grab = (name) => {
      const i = html.indexOf('function ' + name + '(');
      assert.ok(i > 0, name + ' is gone from the shell');
      /* balanced-brace scan from the opening brace */
      let depth = 0, j = html.indexOf('{', i);
      for (let k = j; k < html.length; k++) {
        if (html[k] === '{') depth++;
        else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
      }
      throw new Error('unterminated ' + name);
    };
    const bodySrc = [
      grab('_athenaHistoryDigits'), grab('_athenaHistoryDobKey'), grab('_athenaHistoryDobSame'),
      grab('_athenaHistoryName'), grab('_athenaHistoryNameCamel'),
      grab('_athenaHistoryNameSegment'), grab('_athenaHistoryNameUnrun'), grab('_athenaHistoryNameTokensCover'),
      grab('_athenaHistoryNameCompatible'), grab('_athenaSurvivorPatientId')
    ].join('\n');
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext('var _athenaDigits = null, getPatients = null;\n' + bodySrc +
      '\nthis.survivor = _athenaSurvivorPatientId; this.setPatients = function (rows) { getPatients = function () { return rows; }; };' +
      '\n_athenaDigits = _athenaHistoryDigits;', sandbox, { filename: 'shell-mergeid' });
    return sandbox;
  }
  [['1pScribeFlow.html', shell], ['1p/index.html', twin]].forEach(([label, html]) => {
    const s = evalShellFns(html);
    const survivor = { id: 'survivor-1', name: 'Christine M Wright', dob: '1962-03-04', mrn: '5150111' };
    const decoy = { id: 'decoy-1', name: 'Christine Wright', dob: '1971-08-09', mrn: '5150222' };
    const note = { patientId: 'merged-away-1', patient: 'Christine Wright', patientDob: '03/04/1962', patientMrn: '' };

    s.setPatients([survivor, decoy]);
    eq(s.survivor(note), 'survivor-1', label + ': the merged-away note did not resolve to its surviving chart');

    /* name alone must never bind */
    s.setPatients([survivor, decoy]);
    eq(s.survivor({ patientId: 'merged-away-1', patient: 'Christine Wright' }), '',
      label + ': GATE WEAKENED: a name with no DOB and no MRN bound a chart');

    /* two equally good hits fail closed to today's behaviour */
    s.setPatients([survivor, { id: 'twin-1', name: 'Christine M Wright', dob: '1962-03-04', mrn: '5150999' }]);
    eq(s.survivor(note), '', label + ': GATE WEAKENED: an ambiguous survivor was adopted anyway');

    /* a different person with the same name and a different DOB is never it */
    s.setPatients([decoy]);
    eq(s.survivor(note), '', label + ': GATE WEAKENED: a same-name different-DOB chart was adopted');

    /* the stored id itself is never "the survivor" */
    s.setPatients([{ id: 'merged-away-1', name: 'Christine M Wright', dob: '1962-03-04', mrn: '5150111' }]);
    eq(s.survivor(note), '', label + ': the stored id resolved to itself');

    /* MRN is an acceptable second factor on its own */
    s.setPatients([{ id: 'survivor-2', name: 'Christine M Wright', dob: '', mrn: '5150111' }]);
    eq(s.survivor({ patientId: 'merged-away-1', patient: 'Christine Wright', patientMrn: '5150111' }), 'survivor-2',
      label + ': a matching MRN stopped being a second factor');
    shellCtx.checked++;
  });
  eq(shellCtx.checked, 2, 'the two shells were not both measured');

  /* and the call site only ever runs when the stored id resolves to NOTHING */
  [['1pScribeFlow.html', shell], ['1p/index.html', twin]].forEach(([label, html]) => {
    const i = html.indexOf('function _athenaBindingForSavedRecord(n){');
    const body = html.slice(i, i + 1200);
    ok(body.includes('if(n.patientId&&!p){try{var surv=_athenaSurvivorPatientId(n);if(surv)boundId=surv;}catch(eSurv){}}'),
      label + ': the survivor lookup no longer waits for findPatient to miss (or lost its lifted-slice guard)');
    ok(body.includes('var pt=p?_athenaPatientSnapshot(p,n.patient):stored;'),
      label + ': the identity snapshot path changed - the survivor must contribute its ID and nothing else');
  });
}

/* ===========================================================================
   10. NOTHING BETWEEN REVIEW AND SEND RESHAPES THE REVIEWED TEXT  (class i)

   The extension refuses note-payload-mismatch / note-section-payload-mismatch,
   so any normalisation applied on one side and not the other is a guaranteed
   refusal - and a silent one, because the doctor sees the text he approved.
   ========================================================================= */
{
  const h = makeHarness();
  const body = '  Procedure: right L4-5 MBB.\n\n  Findings:   two lines, trailing space.  \n';
  const m = h.wf.buildUnifiedManifest({ patient: ADAM, sections: [{ key: 'procedure', text: body }], expectedContext: VISIT });
  const row = m.rows.filter(r => r.action === 'write_note')[0];
  ok(row, 'the procedure write row is gone');
  eq(row.payload.noteText, row.payload.reviewText,
    'the sent payload and the reviewed payload are no longer the same string');
  eq(row.payload.noteText, String(body).trim(),
    'the payload is neither the reviewed text nor its plain trim - something in between reshapes it');
  eq(row.payload.sections.length, 1, 'a section write must carry exactly one section');
  eq(row.payload.sections[0].key, 'procedure', 'the section key changed on the way to the payload');
  /* the request that goes out carries the row payload verbatim */
  ok(src.includes('payload: row.payload, noteText: row.payload.noteText || \'\', sections: row.payload.sections || []'),
    'the execute request stopped sending the row payload verbatim');
}

console.log('PASS write-generality: ' + checks + ' checks. Identity is a person not a spelling (accents, welds, caps, suffixes, two-word names) with DOB/MRN equality and the wrong-person, wrong-DOB, wrong-MRN and wrong-day refusals all still closing; a queued send now hears the ladder\'s honest refusal instead of burning its bound; the read-only pacing budget is one wall clock in a hidden tab; a patient seen twice in one day gets a named choice instead of a permanent block, and MLS still never picks; the MRN-less majority gets the read-only opener its cure needs, with adoption still a positive proof; one note\'s failure cannot press another patient\'s sheet; a merged-away chart id resolves to its survivor on name + a hard second factor or not at all; and the four-layer final-action block, the closed batch set and the exact reviewed payload are unchanged.');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
