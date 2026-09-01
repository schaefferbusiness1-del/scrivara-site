'use strict';

/* dayall-1.0.0 + dayvs-1.0.0 - "write all to Athena", proved.
 *
 * Owner, 2026-09-01, verbatim:
 *   "visitors [visits] need to be stored correctly in mls and at end of day
 *    you can click write all to Athens and every single visit for the day
 *    needs to be able to be written to Athena"
 *
 * WHAT THIS SUITE DRIVES. Nothing here is re-implemented. It runs:
 *   - the REAL 1p-feat_mls_writeflow.js in a VM (the unified review sheet, its
 *     read-only probe ladder, its execute, its receipts, the opbatch-1.0.0
 *     cross-note queue, and the new dayall-1.0.0 day audit + press) against a
 *     fake MLS Assist - no browser, no athenaOne, no PHI;
 *   - the REAL pushHistoryNoteToAthena / _athenaPushPlan / _athenaShowReceipt
 *     sliced out of the shipped 1p twins, so a queued visit goes through the
 *     SAME entry point a human press goes through;
 *   - the REAL _athenaCurrentApptStamp (dayvs-1.0.0) sliced out of the shipped
 *     twins, so the storage claim is tested on the shipped resolver.
 *
 * WHAT IT PINS, and why each is a safety property rather than a nicety:
 *
 *   1. THE AUDIT'S VERDICTS ARE A CLOSED SET. Every visit on a day lands on
 *      exactly one enumerated code. A verdict nobody enumerated is a verdict
 *      nobody can test, so a code invented at a call site must fail here.
 *   2. THE DENOMINATOR IS HONEST. A chart-import receipt and a foreign record
 *      kind are not visits that failed - they are not visits, and they must
 *      never appear in a day's total.
 *   3. IDENTITY IS THE OWNER'S RULING, NOT A WEAKER ONE. An MRN, or a name AND
 *      a date of birth together. Name alone never qualifies.
 *   4. ONE DRIVER. The day press owns no manifest, no probe, no token, no
 *      execute and no postMessage. It hands ready ids to opbatch-1.0.0 and a
 *      stop-only guard, and nothing else.
 *   5. THE CLOSED ACTION ALLOWLIST IS UNTOUCHED. write_note and save_draft,
 *      byte-pinned. Sign and Save are never queued and never emitted, and the
 *      completion line says so in words.
 *   6. PER-VISIT ISOLATION. A visit the sheet refuses is skipped with its own
 *      reason recorded; the visits after it still run.
 *   7. THE DAY'S BOOKS CLOSE. written + rehearsed + skipped + not-run +
 *      refused-at-queue + not-ready == the day's total.
 *   8. THE DAY-FLIP REFUSAL. A run started for what was then today stops
 *      honestly when the calendar turns over mid-run; a deliberate catch-up run
 *      for a past day is not stopped by the clock.
 *   9. GENERALITY. A generated visit note reaches Athena as FIVE named
 *      destinations, so the queue's sheet-match proof must admit it - and must
 *      still refuse a sheet carrying text the queued record does not contain.
 *  10. dayvs-1.0.0 STORAGE. A live visit's binding now carries the day's
 *      appointment id when - and only when - the answer is forced.
 *
 * Not registered in tests/run-all.js by this lane - the parent registers it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLOW_FILE = '1p-feat_mls_writeflow.js';
const FLOW = fs.readFileSync(path.join(ROOT, FLOW_FILE), 'utf8');
const FLOW_TWINS = ['1p-feat_mls_writeflow.js', 'feat_mls_writeflow.js', 'cloned-feat_mls_writeflow.js'];
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const SHELL_TWINS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
const SHELL_SRC = {};
SHELLS.forEach((s) => { SHELL_SRC[s] = fs.readFileSync(path.join(ROOT, s), 'utf8'); });

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* The repo's own balanced-brace slicer (athena-crosslayer-bridge-payload):
   comment- and string-aware, so a brace inside a comment cannot end a body. */
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
    else if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced function body: ' + marker);
}

const DAYALL_OPEN = '/* ===== dayall-1.0.0 ';
const DAYALL_CLOSE = '/* ===== end dayall-1.0.0';
const OPBATCH_OPEN = '/* ===== opbatch-1.0.0';
const OPBATCH_CLOSE = '/* ===== end opbatch-1.0.0';
function blockOf(src, open, close) {
  const a = src.indexOf(open), b = src.indexOf(close);
  assert(a >= 0 && b > a, 'missing block ' + open);
  return src.slice(a, b);
}
const DAY_BLOCK = blockOf(FLOW, DAYALL_OPEN, DAYALL_CLOSE);
const OP_BLOCK = blockOf(FLOW, OPBATCH_OPEN, OPBATCH_CLOSE);

/* A "this block must never do X" pin has to read CODE, not prose. These blocks
   explain themselves at length and name, in comments, the very things they are
   forbidden to touch ("the closed OPBATCH_ACTIONS allowlist", "never probes and
   never executes"). Asserting against the raw bytes would therefore fail on the
   documentation rather than on a defect - and worse, it would push a future
   author to delete the explanation to make the suite pass. So the comments come
   out first and the pin is asked of what actually runs. */
function stripComments(src) {
  let out = '', quote = '', escaped = false, line = false, block = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i], next = src[i + 1];
    if (line) { if (ch === '\n') { line = false; out += ch; } continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i += 1; } continue; }
    if (quote) {
      out += ch;
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i += 1; continue; }
    if (ch === '/' && next === '*') { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; continue; }
    out += ch;
  }
  return out;
}
const DAY_CODE = stripComments(DAY_BLOCK);
const OP_CODE = stripComments(OP_BLOCK);
/* The stripper must really be working, or every pin below passes vacuously. */
assert(DAY_CODE.length > 2000, 'stripComments must leave the day block\'s code behind');
assert(DAY_CODE.length < DAY_BLOCK.length, 'stripComments must actually remove the day block\'s prose');
assert(DAY_CODE.indexOf('THE CLOSED VERDICT SET') < 0, 'stripComments must remove comment prose');
assert(DAY_CODE.indexOf('dayAllVerdict') > 0, 'stripComments must keep real identifiers');
checks += 4;

/* ================================================================== PART 1
 * Static pins. These read the shipped bytes, so they hold whether or not any
 * runtime below ever executes. */
(function part1() {
  /* 1.1 THE CLOSED ACTION ALLOWLIST, BYTE-PINNED. This is the four-layer
     block's outermost layer as the queue sees it. It is pinned as an exact
     byte region and asserted to occur exactly once, so a widening edit - a new
     key, a renamed key, a second definition shadowing it - fails here. */
  const ALLOWLIST = 'var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };';
  eq(FLOW.split(ALLOWLIST).length - 1, 1,
    FLOW_FILE + ': the closed action allowlist must appear exactly once, byte for byte');
  eq(FLOW.split('OPBATCH_ACTIONS =').length - 1, 1,
    FLOW_FILE + ': OPBATCH_ACTIONS must be assigned exactly once - a second assignment could widen it');
  /* The day block must not mention the allowlist at all: it may not read it,
     copy it, extend it or shadow it. */
  eq(DAY_CODE.indexOf('OPBATCH_ACTIONS'), -1,
    'dayall: the day block\'s CODE must never read, copy, extend or shadow the closed action allowlist');
  /* And no signing verb may appear in either block, in code OR in prose - a
     signing verb has no legitimate reason to be written down anywhere here. */
  ['sign_and_save', 'signAndSave', 'sign_note', 'saveAndSign', "'sign'", '"sign"'].forEach((v) => {
    eq(DAY_BLOCK.indexOf(v), -1, 'dayall: signing verb must never appear in the day block: ' + v);
    eq(OP_BLOCK.indexOf(v), -1, 'opbatch: signing verb must never appear in the queue block: ' + v);
  });

  /* 1.2 THE CLOSED KIND SET. The generalisation from op notes to all visit
     notes is itself a closed pin, not an open ban-list. */
  const KINDS = "var OPBATCH_KINDS = { '': 1, opnote: 1 };";
  eq(FLOW.split(KINDS).length - 1, 1,
    FLOW_FILE + ': the closed chart-record kind set must appear exactly once, byte for byte');
  eq(FLOW.split('OPBATCH_KINDS =').length - 1, 1,
    FLOW_FILE + ': OPBATCH_KINDS must be assigned exactly once');

  /* 1.3 ONE DRIVER. The day block may reach the write lane only by handing ids
     to the queue. Every verb below is one it must NOT own. */
  ['postMessage', 'mlsAppAthenaActionV2', 'actionToken', 'noteWriteProof', 'manifest',
    'runUnifiedPrimarySend', 'execute', 'pushHistoryNoteToAthena', '_athenaPushPlan'].forEach((v) => {
    eq(DAY_CODE.indexOf(v), -1, 'dayall: the day block must not own a write verb of its own: ' + v);
  });
  ok(/opBatchStart\(\{/.test(DAY_CODE), 'dayall: the day press must go through opBatchStart');
  eq(DAY_CODE.split('opBatchStart(').length - 1, 1,
    'dayall: exactly one call into the queue start - a second call path is a second driver');

  /* 1.4 THE PUBLIC SEAM, PUBLISHED ONCE. */
  eq(FLOW.split('window.__mlsDayWriteAll = DAYALL_API;').length - 1, 1,
    FLOW_FILE + ': the public seam window.__mlsDayWriteAll must be published exactly once');

  /* 1.5 THE SIGN-IS-YOURS SENTENCE. The completion line and the panel must
     both say, in words, that signing stays the doctor's own click. A batch
     that writes N notes and leaves the doctor believing they are signed is the
     one dishonesty this feature could commit. */
  ok(/Nothing was saved and nothing was signed - sign each in athenaOne\./.test(DAY_BLOCK),
    'dayall: the completion line must say nothing was saved or signed, and to sign each in athenaOne');
  ok(/Save and Sign &amp; Save stay yours in athenaOne/.test(DAY_BLOCK),
    'dayall: the panel must say Save and Sign & Save stay the doctor\'s own in athenaOne');

  /* 1.6 TWIN PARITY. 1p is the source; the derived lanes must carry the same
     bytes for both blocks, or the thing proved here is not the thing shipped. */
  FLOW_TWINS.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    eq(blockOf(src, DAYALL_OPEN, DAYALL_CLOSE), DAY_BLOCK, f + ': dayall-1.0.0 block must be byte-identical to the 1p source');
    eq(blockOf(src, OPBATCH_OPEN, OPBATCH_CLOSE), OP_BLOCK, f + ': opbatch-1.0.0 block must be byte-identical to the 1p source');
  });
  const STAMP = 'function _athenaCurrentApptStamp(patientId,day){';
  const stamp0 = extractFunction(SHELL_SRC[SHELLS[0]], STAMP);
  SHELL_TWINS.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    eq(src.split(STAMP).length - 1, 1, f + ': dayvs-1.0.0 resolver must be defined exactly once');
    eq(extractFunction(src, STAMP), stamp0, f + ': dayvs-1.0.0 resolver must be byte-identical across the twins');
  });

  /* 1.7 dayvs-1.0.0 IS RESOLUTION, NOT SELECTION. The resolver must fail
     closed on anything but a forced answer. Both "exactly one" tests are
     pinned as bytes because a >= or a [0] here would let MLS pick. */
  ok(/if\(rows\.length!==1\)return out;/.test(stamp0),
    'dayvs: two or zero appointments on the day must return no appointment id');
  ok(/if\(hits\.length===1\)out\.appointmentId=hits\[0\];/.test(stamp0),
    'dayvs: exactly one ledger hit, or no appointment id');
})();

/* ---------------------------------------------------------------- fixtures */
const DAY = '2026-08-17';
const OTHER_DAY = '2026-08-16';
const ATHENA_DAY = '8/17/2026';
const PROVIDER = 'Synthetic Clinician One, MD';
const BASE_APPT = 70000000;

/* The five canonical destinations a GENERATED visit note is cut into. This is
   the shape the real _mlsSavedAthenaCanonicalForWrite hands the entry point. */
const SECTION_KEYS = ['hpi', 'ros', 'exam', 'assessment', 'plan'];
function athenaNoteOf(n) {
  return SECTION_KEYS.map((k) => k.toUpperCase() + ':\nSynthetic ' + k +
    ' content for visit ' + n + ', long enough to stand as its own clinical section.').join('\n\n');
}
function sectionsOf(n) {
  return athenaNoteOf(n).split('\n\n').map((text, i) => ({ key: SECTION_KEYS[i], text: text }));
}

/* The day's records. Each carries the exact defect its verdict names, so the
   audit is judged against records that really are in that state. */
function fixtures() {
  function base(n, over) {
    return Object.assign({
      id: 'v-' + n, kind: '', isDraft: false, visitDate: DAY,
      patient: 'Synthetic Visit Patient ' + n, patientId: 'syn-v-' + n,
      dob: '0' + (n % 9 + 1) + '/02/1980', mrn: '30000' + n,
      text: 'VISIT NOTE ' + n + '\n' + athenaNoteOf(n),
      athenaNote: athenaNoteOf(n), canonical: true, coding: null, orders: []
    }, over || {});
  }
  return [
    /* READY - a generated visit note, addressed by MRN, bound to its appointment */
    base(1),
    /* READY - no MRN, but a name AND a date of birth (owner ruling 2026-08-28) */
    base(2, { mrn: '' }),
    /* READY - an op note; the lane this queue was originally built for */
    base(3, { kind: 'opnote', text: 'OPERATIVE NOTE 3\nSynthetic operative body, long enough to match a sheet row.', athenaNote: '', canonical: false }),
    /* NOT READY - still a draft */
    base(4, { isDraft: true }),
    /* NOT READY - no note text at all */
    base(5, { text: '   ', athenaNote: '', canonical: false }),
    /* NOT READY - unresolved placeholder fields */
    base(6, { text: 'VISIT NOTE 6\nPatient reports [[chief_complaint]] since [[onset]].' }),
    /* NOT READY - a name with no DOB and no MRN cannot be addressed */
    base(7, { mrn: '', dob: '' }),
    /* NOT READY - the canonical five-section payload no longer validates */
    base(8, { canonical: false, canonicalStale: true }),
    /* NOT READY - quarantined binding */
    base(9, { routeBlocked: true }),
    /* NOT READY - stored identity conflicts with the linked chart */
    base(10, { identityConflict: true }),
    /* NOT A VISIT - an Athena chart-import receipt is a pull artifact */
    base(11, { cc: 'Athena chart import', text: 'Imported chart facts for the day.' }),
    /* NOT A VISIT - a foreign record kind */
    base(12, { kind: 'template' }),
    /* A DIFFERENT DAY - must not appear in this day's audit at all */
    base(13, { visitDate: OTHER_DAY })
  ];
}

const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt', 'mlsOpBatchProgress',
  'mlsOpBatchStop', 'mlsDayWriteAll'];

function makeDom() {
  const byId = new Map();
  const live = new Map();
  let card = null;
  function forget(children) {
    children.forEach((child) => {
      if (child && child.id && live.get(child.id) === child) live.delete(child.id);
      if (child && child.children && child.children.length) forget(child.children);
    });
  }
  function node(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), style: {}, dataset: {}, attrs: {}, children: [],
      handlers: {}, value: '', disabled: false, type: '', id: '', title: '',
      isConnected: true, className: '', parentNode: null,
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'id') el.id = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
      removeEventListener(t, fn) { const l = el.handlers[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
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
      select() {}, focus() {},
      querySelector(sel) {
        const s = String(sel || '');
        if (s.charAt(0) === '#') return resolve(s);
        return null;
      },
      querySelectorAll() { return []; },
      closest() { return null; },
      click() { (el.handlers.click || []).slice().forEach((fn) => fn({ target: el })); },
      fire(t) { (el.handlers[t] || []).slice().forEach((fn) => fn({ target: el })); }
    };
    let html = '', text = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return html; },
      set(v) {
        html = String(v);
        forget(el.children); el.children.length = 0;
        if (html.indexOf('mlsAthenaUnifiedGo') >= 0) card = el;
      }
    });
    Object.defineProperty(el, 'textContent', {
      get() { return text; },
      set(v) { text = String(v); forget(el.children); el.children.length = 0; }
    });
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

/* A clock that only moves when a timer is scheduled, plus a settable "today"
   so the day-flip guard can be driven without waiting for midnight. */
function makeClock(startIso) {
  let t = Date.parse(startIso + 'T09:00:00.000Z');
  function D(a, b, c, d, e, f, g) {
    if (arguments.length === 0) return new Date(t);
    if (arguments.length === 1) return new Date(a);
    return new Date(a, b, c || 1, d || 0, e || 0, f || 0, g || 0);
  }
  D.now = () => t;
  D.parse = Date.parse;
  D.UTC = Date.UTC;
  D.prototype = Date.prototype;
  return { D, advance(ms) { t += Math.max(0, Number(ms || 0)); } };
}

function makeHarness(options) {
  options = options || {};
  const dom = makeDom();
  const clock = makeClock(options.startDay || DAY);
  const listeners = [];
  const posted = [];
  const store = new Map();
  const records = options.records || fixtures();
  /* THE ACCOUNT'S OWN DAY KEY, settable by the test. The real page reads
     _acctTodayKey; a UTC key would file every evening note onto tomorrow. */
  let today = options.today || DAY;

  const calRows = records.map((r, i) => ({
    id: 'cal-row-' + (i + 1), patient_external_id: r.patientId, name: r.patient, dob: r.dob,
    provider: PROVIDER, providerName: PROVIDER,
    appt_date: r.visitDate, day_local: r.visitDate,
    start_at: r.visitDate + 'T1' + (i % 9) + ':00:00.000Z'
  }));
  const idxRows = {};
  records.forEach((r, i) => {
    idxRows['appointment-id:' + String(BASE_APPT + i + 1)] =
      { state: 'done', patientId: r.patientId, backendAppointmentId: 'cal-row-' + (i + 1), appt_date: r.visitDate };
  });
  store.set('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: idxRows }));
  store.set('acct:schedImportIndexV1::' + OTHER_DAY, JSON.stringify({ v: 1, rows: idxRows }));

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  const toasts = [];
  /* THE CHART'S OWN MRN, WHICH MLS DOES NOT HAVE YET. mrnopen-1.0.0 measured
     that 76% of charts carry no MRN in MLS, so a day of real visits is mostly
     no-MRN visits: the sheet opens blocked on identity, mrnadopt-1.0.0 asks
     athenaOne for the open chart's identity, persists the MRN it names, and
     the review rebuilds. A harness that cannot answer mlsAppChartIdentity
     would leave every no-MRN visit stalled and would prove the opposite of
     what a real day does - so athenaOne answers here exactly as it does live. */
  const chartMrn = {};
  records.forEach((r, i) => { chartMrn[r.patientId] = r.mrn || String(390000 + i + 1); });
  /* getPatients() is an ARRAY (never a map) and upsertPatient writes into it;
     mrnAdoptPersist reads the store BACK and refuses unless the store itself
     names the MRN - presence is not provenance. */
  const patients = records.map((r) => ({ id: r.patientId, patientId: r.patientId, name: r.patient, dob: r.dob, mrn: r.mrn || '' }));
  let sheetPatientId = '';
  const window = {
    document: dom.document, localStorage,
    getPatients: () => patients,
    upsertPatient: (row) => {
      const i = patients.findIndex((p) => String(p.id) === String(row && row.id));
      if (i >= 0) patients[i] = Object.assign({}, patients[i], row); else patients.push(row);
      return row;
    },
    _calAppts: clone(calRows),
    _opPrep: [],
    uns: (k) => 'acct:' + k,
    _acctTodayKey: () => today,
    _acctDateKeyOf: (d) => {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return '';
      const m = dt.getUTCMonth() + 1, dy = dt.getUTCDate();
      return dt.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dy < 10 ? '0' : '') + dy;
    },
    activePatient: () => ({ id: records[0].patientId, name: records[0].patient, dob: records[0].dob }),
    getNotes: () => records.map(clone),
    toast: (m, k) => { toasts.push({ m: String(m), k: String(k || '') }); },
    location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
    __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage(message) { posted.push(message); route(message); }
  };
  window.window = window;

  function deliver(type, requestId, resp) {
    Promise.resolve().then(() => listeners.slice().forEach((fn) => fn({ data: { source: 'mls-ext', type, requestId, resp } })));
  }
  function recOf(pid) { return records.filter((r) => r.patientId === String(pid))[0] || records[0]; }
  function contextFor(pid) {
    const r = recOf(pid);
    const i = Number(String(r.id).replace(/\D/g, '')) || 1;
    /* athenaOne ALWAYS knows the chart's MRN - MLS is the side that may not.
       So the probe reports the chart's MRN, never the record's blank. */
    return { patientName: r.patient, dob: r.dob, mrn: chartMrn[r.patientId], appointmentId: String(BASE_APPT + i),
      encounterId: '5550' + i, encounterUrl: 'https://athena.example/encounter/5550' + i,
      visitDate: ATHENA_DAY, provider: PROVIDER,
      control: r.kind === 'opnote' ? 'Procedure Documentation editor' : 'Clinical note editor',
      framePath: '0', encounterRootFingerprint: 'er', controlFingerprint: 'c',
      noteScopeFingerprint: 'nn', editorFingerprint: 'e', contextHash: 'h' };
  }
  function defaultAction(m) {
    const ctx = contextFor((m.patient && m.patient.patientId) || records[0].patientId);
    if (m.mode === 'execute') {
      return { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, written: true,
        noteWriteProof: 'proof-' + ctx.encounterId, noteWriteProofExpiresAt: clock.D.now() + 600000, context: clone(ctx) };
    }
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token',
      rowHash: m.rowHash, clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: clone(ctx) };
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppAthenaActionV2') return deliver('mlsAppAthenaActionV2Result', m.requestId, options.onAction ? options.onAction(m, defaultAction) : defaultAction(m));
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppChartIdentity') {
      const r = records.filter((x) => x.patientId === sheetPatientId)[0];
      if (!r) return deliver('mlsAppChartIdentityResult', m.requestId, { ok: false });
      return deliver('mlsAppChartIdentityResult', m.requestId,
        { ok: true, identity: { name: r.patient, dob: r.dob, mrn: chartMrn[r.patientId] } });
    }
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.100', versionName: '3.0.100+core', athena: { tabs: 3, discarded: 0 } });
    return undefined;
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date: clock.D, Math, JSON, Promise, Object, Array, String, Number, RegExp,
    isFinite, isNaN, parseInt, parseFloat, Error,
    setTimeout: (fn, ms) => {
      const m = Number(ms || 0);
      if (m <= 2000 || m === 12000 || m === 15000) { clock.advance(m); Promise.resolve().then(fn); }
      return 1;
    },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: FLOW_FILE });

  /* ---- the app's OWN saved-note hand-off, sliced out of the shipped twin --- */
  const shell = SHELL_SRC[options.shell || SHELLS[0]];
  const push = extractFunction(shell, 'function pushHistoryNoteToAthena(id)');
  const pushPlan = extractFunction(shell, 'function _athenaPushPlan(sections, who, immutablePatient)');
  const showReceipt = extractFunction(shell, 'function _athenaShowReceipt(who, results, partial, immutablePatient, sections, visitContext)');
  const flow = window.__mlsWriteFlow;
  context.ATHENA_SECTIONS = {
    procedure: { icon: 'P', label: 'PROCEDURE / OPERATIVE NOTE', dest: flow.destinations.procedure },
    note: { icon: 'N', label: 'NOTE', dest: flow.destinations.note },
    dx: { icon: 'D', label: 'DIAGNOSES', dest: 'dx' },
    billing: { icon: 'B', label: 'BILLING', dest: 'billing' },
    orders: { icon: 'O', label: 'ORDERS', dest: 'orders' }
  };
  context.getNotes = window.getNotes;
  context.toast = window.toast;
  context.opNoteBlankTokens = (text) => {
    const m = String(text || '').match(/\[\[[a-z0-9_]+\]\]/gi);
    return (m || []).map((x) => ({ key: x, label: x }));
  };
  context._athenaItemsOf = () => [];
  context._athenaCanonicalBilling = () => ({ emCode: '', cptCodes: [], invalid: [] });
  context._athenaOrderReviewBundle = () => ({ drafts: [], suggestions: [] });
  /* The REAL contract of the shipped canonical check, modelled on the record's
     own stored state: a generated visit note REQUIRES a current five-section
     payload; an op note is not judged by it at all. */
  context._mlsSavedAthenaCanonicalForWrite = (rec) => {
    if (!rec || rec.kind === 'opnote') return null;
    if (!rec.athenaNote) return null;
    if (rec.canonicalStale) return { required: true, ok: false, reason: 'fingerprint no longer matches the saved visit' };
    if (!rec.canonical) return null;
    return { required: true, ok: true, sections: sectionsOf(Number(String(rec.id).replace(/\D/g, '')) || 1) };
  };
  context._athenaBindingForSavedRecord = (rec) => {
    const i = Number(String(rec && rec.id).replace(/\D/g, '')) || 1;
    return {
      routeBlocked: !!(rec && rec.routeBlocked),
      identityConflict: !!(rec && rec.identityConflict),
      patient: { name: (rec && rec.patient) || '', dob: (rec && rec.dob) || '', mrn: (rec && rec.mrn) || '', patientId: (rec && rec.patientId) || '' },
      noteTimestamp: null,
      visitContext: { historical: true, visitDate: ATHENA_DAY, provider: PROVIDER,
        appointmentId: String(BASE_APPT + i), encounterId: '5550' + i,
        encounterUrl: 'https://athena.example/encounter/5550' + i }
    };
  };
  /* On a real page these ARE window properties (top-level declarations in the
     shell's one big classic script block); in a VM a bare global is not, so
     publish by name the ones the day audit and the queue's pre-screen read. */
  window.opNoteBlankTokens = context.opNoteBlankTokens;
  window._athenaBindingForSavedRecord = context._athenaBindingForSavedRecord;
  window._mlsSavedAthenaCanonicalForWrite = context._mlsSavedAthenaCanonicalForWrite;
  window._mlsIsChartImportNote = (n) => String((n && n.cc) || '') === 'Athena chart import';
  vm.runInContext(showReceipt + '\n' + pushPlan + '\n' + push +
    '\nwindow.pushHistoryNoteToAthena = pushHistoryNoteToAthena;', context, { filename: 'shell-saved-note-handoff.js' });

  /* Which chart athenaOne has open is decided by which note MLS just opened a
     review for - the same coupling the live surface has. */
  const openUnified = flow.openUnifiedConfirmation;
  flow.openUnifiedConfirmation = function (o) {
    try { sheetPatientId = String((o && o.patient && o.patient.patientId) || ''); } catch (e) { sheetPatientId = ''; }
    return openUnified.apply(this, arguments);
  };
  return {
    window, document: dom.document, el: dom.resolve, posted, toasts, records, clock, context,
    wf: flow, batch: window.__mlsOpBatchSend, day: window.__mlsDayWriteAll,
    setToday(k) { today = k; },
    actions: () => posted.filter((m) => m.type === 'mlsAppAthenaActionV2'),
    executes: () => posted.filter((m) => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    probes: () => posted.filter((m) => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe'),
    panel: () => dom.resolve('mlsDayWriteAll')
  };
}
async function settle(n) { for (let i = 0; i < (n || 600); i++) await new Promise((r) => setImmediate(r)); }
async function runToEnd(h, cap) {
  for (let i = 0; i < (cap || 60); i++) {
    await settle(200);
    if (h.batch.status().done) return true;
  }
  return h.batch.status().done;
}

/* ====================================================================== run */
(async function run() {

  /* ================================================================ PART 2
   * THE PRE-FLIGHT AUDIT. Real code, real records, real verdicts. */
  {
    const h = makeHarness({});
    const api = h.day;
    ok(api && api.v === 'dayall-1.0.0', 'dayall: the public seam must be installed');

    const audit = api.audit(DAY);

    /* 2.1 THE DENOMINATOR. Thirteen records exist; one is on another day, one
       is an import receipt and one is a foreign kind. Ten are the day's
       visits, and only those ten may be counted. */
    eq(audit.total, 10, 'audit: the day total must count only the day\'s visits');
    eq(audit.counts.ready, 3, 'audit: three visits are ready to write');
    eq(audit.counts.notReady, 7, 'audit: seven visits need attention');
    eq(audit.day, DAY, 'audit: the audit reports the day it was asked for');

    /* 2.2 THE CLOSURE IDENTITY, COMPUTED. */
    eq(audit.closure, true, 'audit: ready + not-ready must equal the total');
    eq(audit.counts.ready + audit.counts.notReady, audit.total, 'audit: the printed identity must hold');

    /* 2.3 EVERY VERDICT IS IN THE CLOSED SET, and each record lands on the
       code its own defect names. A code derived at a call site fails here. */
    const CODES = Object.keys(api.reasons);
    const all = audit.ready.concat(audit.notReady);
    all.forEach((v) => {
      ok(CODES.indexOf(v.code) >= 0, 'audit: verdict code must be enumerated: ' + v.code + ' on ' + v.id);
      ok(String(v.why || '').length > 0, 'audit: every verdict must carry a reason: ' + v.id);
    });
    const byId = {};
    all.forEach((v) => { byId[v.id] = v; });
    eq(byId['v-1'].code, 'ready', 'audit: a complete generated visit note addressed by MRN is ready');
    eq(byId['v-2'].code, 'ready', 'audit: a visit with no MRN but a name AND a DOB is ready');
    eq(byId['v-3'].code, 'ready', 'audit: an op note is still ready - the original lane is not regressed');
    eq(byId['v-4'].code, 'draft', 'audit: a draft is named as a draft');
    eq(byId['v-5'].code, 'no-text', 'audit: a note with no text is named as such');
    eq(byId['v-6'].code, 'blanks', 'audit: unresolved fields are named as such');
    eq(byId['v-7'].code, 'identity', 'audit: a name with no DOB and no MRN cannot be addressed');
    eq(byId['v-8'].code, 'canonical', 'audit: a stale five-section payload is named as such');
    eq(byId['v-9'].code, 'quarantined', 'audit: a quarantined binding is named as such');
    eq(byId['v-10'].code, 'conflict', 'audit: an identity conflict is named as such');
    eq(byId['v-11'], undefined, 'audit: a chart-import receipt is not a visit and is not in the day');
    eq(byId['v-12'], undefined, 'audit: a foreign record kind is not a visit and is not in the day');
    eq(byId['v-13'], undefined, 'audit: another day\'s visit is not in this day');

    /* 2.4 IDENTITY IS THE OWNER'S RULING. */
    eq(byId['v-1'].identity, 'mrn', 'audit: an MRN addresses the patient');
    eq(byId['v-2'].identity, 'name-dob', 'audit: a name AND a DOB address the patient');
    eq(api.identity({ patient: 'Someone Real', dob: '', mrn: '' }).ok, false,
      'audit: a name ALONE must never qualify as an address');
    eq(api.identity({ patient: '', dob: '02/02/1980', mrn: '' }).ok, false,
      'audit: a DOB alone must never qualify as an address');
    eq(api.identity({ patient: 'Someone Real', dob: '02/02/1980', mrn: '' }).how, 'name-dob',
      'audit: name AND DOB together qualify');
    eq(api.identity({ patient: '', dob: '', mrn: '7833832' }).how, 'mrn',
      'audit: an MRN alone qualifies');

    /* 2.5 THE BINDING FLAG IS HONEST, AND NEVER A BLOCK. An unbound visit is
       still writable - the review asks athenaOne for the day. */
    all.forEach((v) => { ok(typeof v.unbound === 'boolean', 'audit: every visit reports a binding flag: ' + v.id); });
    const unbound = api.verdict({ id: 'u-1', kind: '', isDraft: false, visitDate: DAY,
      patient: 'Unbound Patient', patientId: 'syn-u-1', dob: '03/03/1981', mrn: '444444',
      text: 'VISIT NOTE U\n' + athenaNoteOf(1), athenaNote: '', canonical: false });
    eq(unbound.code, 'ready', 'audit: a visit with no stored appointment is still READY, never blocked');

    /* 2.6 THE ISO-FIRST DAY KEY (the isodob-1.0.0 lesson applied to a day).
       Run left to right an M/D/Y pattern matches inside an ISO date and reads
       2026-03-04 as the 3rd of February 2004. */
    eq(api.dayKey('2026-03-04'), '2026-03-04', 'audit: an ISO day key is read as itself');
    eq(api.dayKey('3/4/2026'), '2026-03-04', 'audit: an M/D/Y day key is read correctly');
    eq(api.dayKey('not a day'), '', 'audit: an unparseable day is refused, never guessed');
    eq(api.dayKey('2026-13-40'), '', 'audit: an out-of-range day is refused');

    /* 2.7 THE DAY LADDER REPORTS WHICH RUNG ANSWERED. A note finished the next
       morning must not silently claim the encounter day. */
    eq(api.dayOf({ visitDate: DAY }).source, 'bound', 'audit: a stored visit date is a BOUND day');
    eq(api.dayOf({ visitTimestamp: Date.parse(DAY + 'T15:00:00.000Z') }).source, 'stamp', 'audit: an encounter timestamp is a STAMP day');
    eq(api.dayOf({ updated: Date.parse(DAY + 'T15:00:00.000Z') }).source, 'recorded', 'audit: a save time is only a RECORDED day');
    eq(api.dayOf({}).day, '', 'audit: a record with no day at all is not placed on one');

    /* 2.8 THE PANEL PAINTS THE CHECKLIST THE OWNER ASKED FOR. */
    api.paint();
    const panel = h.panel();
    ok(panel, 'panel: the day surface is really appended to the History card');
    ok(/Ready to write: 3 - Need attention: 7/.test(panel.innerHTML),
      'panel: the head line must read "Ready to write: N - Need attention: M"');
    ok(/Write all to Athena \(3\)/.test(panel.innerHTML), 'panel: the button carries the ready count');
    ok(/sign each note there|sign each in athenaOne|Sign &amp; Save stay yours/.test(panel.innerHTML),
      'panel: the surface must say signing stays the doctor\'s own click');
    eq((panel.innerHTML.match(/data-mls-dayall-row=/g) || []).length, 10,
      'panel: one checklist row per visit in the day');
    ok(/NEEDS ATTENTION/.test(panel.innerHTML), 'panel: a not-ready visit is named as needing attention');
  }

  /* ================================================================ PART 3
   * THE PRESS. Every ready visit, through the queue that already exists. */
  {
    const h = makeHarness({});
    const res = h.day.start(DAY);
    eq(res.started, true, 'press: the day run starts');
    eq(res.total, 3, 'press: exactly the three ready visits are queued');
    ok(await runToEnd(h), 'press: the run finishes');

    const st = h.batch.status();
    eq(st.written, 3, 'press: all three ready visits are written');

    /* 3.1 ONE DRIVER, ONE ALLOWLIST. Every action that reached the bridge is
       in the closed allowlist. Sign and Save never appear. */
    const actions = h.actions();
    ok(actions.length > 0, 'press: the run really drove the bridge');
    const ALLOWED = { write_note: 1, save_draft: 1 };
    actions.forEach((m) => {
      ok(ALLOWED[m.action] === 1, 'press: every emitted action must be in the closed allowlist (saw ' + m.action + ')');
    });
    eq(h.executes().filter((m) => !ALLOWED[m.action]).length, 0, 'press: no execute outside the allowlist');

    /* 3.2 SEQUENTIAL: never two writes in flight. Each queued note produces
       its own probe(s) before its own execute(s). */
    const order = actions.map((m) => m.mode);
    eq(order.indexOf('execute') > 0, true, 'press: a probe always precedes the first execute');

    /* 3.3 GENERALITY. A generated visit note reaches Athena as FIVE named
       destinations. Both shapes are in this run, so a queue that could only
       drive op notes would have skipped two of the three. */
    const notes = st.notes;
    eq(notes.length, 3, 'press: three notes accounted for');
    notes.forEach((n) => { eq(n.phase, 'written', 'press: every ready visit was written: ' + n.id); });
    ok(notes.filter((n) => n.id === 'v-1').length === 1, 'press: the generated visit note is in the run');
    ok(notes.filter((n) => n.id === 'v-3').length === 1, 'press: the op note is in the same run');

    /* 3.4 THE DAY'S BOOKS CLOSE. */
    const last = h.day.last();
    ok(last, 'press: the run settles into a day summary');
    eq(last.closed, true, 'press: the day accounting must close');
    const a = last.accounting;
    eq(a.written + a.rehearsed + a.skipped + a.notRun + a.refusedAtQueue + a.notReady, a.total,
      'press: written + rehearsed + skipped + not-run + refused + not-ready == the day total');
    eq(a.total, 10, 'press: the day total is the audited total, not the queued count');
    eq(a.notReady, 7, 'press: the seven not-ready visits are still in the books');

    /* 3.5 THE COMPLETION LINE SAYS SIGNING IS STILL THE DOCTOR'S. */
    ok(/Nothing was saved and nothing was signed - sign each in athenaOne\./.test(last.line),
      'press: the completion line must say nothing was signed and to sign each in athenaOne');
    ok(/3 notes written to athena/.test(last.line), 'press: the completion line counts what was written');
    ok(/7 not ready/.test(last.line), 'press: the completion line names the not-ready remainder');
    ok(/10 of 10 visits on 2026-08-17 accounted for/.test(last.line),
      'press: the completion line prints the accounting identity rather than asserting it');
  }

  /* ================================================================ PART 4
   * PER-VISIT ISOLATION. One refusal must never end the day. */
  {
    let seen = 0;
    const h = makeHarness({
      onAction: (m, dflt) => {
        /* The SECOND note's probe is refused by the sheet's own read-only
           check. Everything before and after it must be untouched. */
        if (m.mode === 'probe') {
          seen += 1;
          const pid = String((m.patient && m.patient.patientId) || '');
          if (pid === 'syn-v-2') {
            return { ok: false, mode: 'probe', readOnly: true, action: m.action,
              reason: 'context-not-verified',
              message: 'The open encounter is not the one this note belongs to. Nothing was written.' };
          }
        }
        return dflt(m);
      }
    });
    const res = h.day.start(DAY);
    eq(res.started, true, 'isolation: the run starts');
    eq(res.total, 3, 'isolation: three visits queued');
    ok(await runToEnd(h), 'isolation: the run finishes despite a refusal');

    const st = h.batch.status();
    eq(st.written, 2, 'isolation: the two good visits are still written');
    eq(st.skipped, 1, 'isolation: the refused visit is skipped, not retried and not fatal');
    const bad = st.notes.filter((n) => n.id === 'v-2')[0];
    ok(bad, 'isolation: the refused visit is still reported');
    eq(bad.phase, 'skipped', 'isolation: the refused visit is marked skipped');
    ok(/not the one this note belongs to/.test(bad.why),
      'isolation: the sheet\'s OWN words are recorded, never paraphrased');
    /* The visit AFTER the refusal still ran - a refusal is not a queue-wide stop. */
    const after = st.notes[st.notes.length - 1];
    eq(after.phase, 'written', 'isolation: the visit after the refusal still ran');

    const last = h.day.last();
    eq(last.closed, true, 'isolation: the books still close after a skip');
    ok(/1 skipped, each with its reason/.test(last.line), 'isolation: the summary names the skip');
  }

  /* ================================================================ PART 5
   * THE DAY-FLIP REFUSAL. The one failure a per-note guard cannot see. */
  {
    /* 5.1 A run started for what was then TODAY stops when the day turns. */
    const h = makeHarness({ today: DAY });
    const res = h.day.start(DAY);
    eq(res.started, true, 'dayflip: the run starts on its own day');
    eq(h.day.guard().stop, false, 'dayflip: while it is still that day, nothing stops');
    h.setToday('2026-08-18');
    const verdict = h.day.guard();
    eq(verdict.stop, true, 'dayflip: once the calendar turns, the guard stops the run');
    ok(/it was started for 2026-08-17 and it is now 2026-08-18/.test(verdict.reason),
      'dayflip: the refusal names both days');
    ok(/Nothing after the note that had already started was opened/.test(verdict.reason),
      'dayflip: the refusal says exactly what was and was not done');
    ok(await runToEnd(h), 'dayflip: the run settles rather than hanging');
    const st = h.batch.status();
    ok(st.written < 3, 'dayflip: the run did not keep writing into the next day');
    const last = h.day.last();
    eq(last.closed, true, 'dayflip: the books close even on a halted run');
    ok(/not run/.test(last.line), 'dayflip: the notes that never ran are reported as not run');
  }
  {
    /* 5.2 A DELIBERATE CATCH-UP for a PAST day is not stopped by the clock:
       midnight means nothing to a run that was never about today. */
    const h = makeHarness({ today: '2026-08-20' });
    const res = h.day.start(DAY);
    eq(res.started, true, 'dayflip: a catch-up run for a past day starts');
    eq(h.day.guard().stop, false, 'dayflip: a past-day run is not stopped by the clock');
    h.setToday('2026-08-21');
    eq(h.day.guard().stop, false, 'dayflip: nor by the clock advancing again');
    ok(await runToEnd(h), 'dayflip: the catch-up run finishes');
    eq(h.batch.status().written, 3, 'dayflip: a catch-up run writes all its ready visits');
  }
  {
    /* 5.3 THE GUARD IS STOP-ONLY. It cannot start a note, admit an id or
       change a verdict - the only shape it may return is a stop. */
    const h = makeHarness({});
    const before = h.day.audit(DAY);
    eq(before.counts.ready, 3, 'dayflip: three visits are ready before the run');
    h.day.start(DAY);
    const g = h.day.guard();
    eq(typeof g.stop, 'boolean', 'dayflip: the guard returns only a stop verdict');
    eq(Object.keys(g).sort().join(','), 'reason,stop',
      'dayflip: the guard verdict carries nothing but stop and reason - it cannot queue, admit or re-judge');
    ok(await runToEnd(h));
    /* The only verdicts that moved are the ones the WRITE moved: a note written
       in this session is now already-written. The not-ready seven are untouched,
       so the guard re-judged nothing. */
    const after = h.day.audit(DAY);
    eq(after.counts.ready, 0, 'dayflip: after the run the written visits are no longer offered again');
    eq(after.counts.notReady, 10, 'dayflip: all ten are accounted for after the run');
    eq(after.total, before.total, 'dayflip: the denominator never moved');
    const written = after.notReady.filter((v) => v.code === 'already-written');
    eq(written.length, 3, 'dayflip: exactly the three written visits carry the already-written verdict');
    const untouched = after.notReady.filter((v) => v.code !== 'already-written').map((v) => v.code).sort();
    eq(untouched.join(','), before.notReady.map((v) => v.code).sort().join(','),
      'dayflip: every not-ready verdict is exactly what it was before the run');
  }

  /* ================================================================ PART 6
   * REFUSALS AT THE DOOR. A day with nothing to write says so honestly. */
  {
    const h = makeHarness({ records: fixtures().filter((r) => ['v-4', 'v-5', 'v-6'].indexOf(r.id) >= 0) });
    const res = h.day.start(DAY);
    eq(res.started, false, 'door: a day with no ready visit does not start');
    ok(/None of the 3 visits on 2026-08-17 is ready/.test(res.reason),
      'door: the refusal names the day and the count');
    ok(/Nothing was sent\./.test(res.reason), 'door: the refusal says nothing was sent');
    eq(h.actions().length, 0, 'door: nothing reached the bridge');
  }
  {
    const h = makeHarness({ records: [] });
    const res = h.day.start(DAY);
    eq(res.started, false, 'door: an empty day does not start');
    ok(/There are no visits recorded for 2026-08-17/.test(res.reason), 'door: an empty day is named as empty');
    eq(h.actions().length, 0, 'door: nothing reached the bridge on an empty day');
  }

  /* ================================================================ PART 7
   * THE SHEET-MATCH PROOF, GENERALISED. Rule two must admit a five-section
   * visit note and must still refuse a sheet carrying foreign text. */
  {
    const h = makeHarness({});
    const m = h.batch.matches;
    const bodies = [athenaNoteOf(1)];
    const item = { id: 'v-1', name: 'Synthetic Visit Patient 1', patientId: 'syn-v-1', body: '', bodies: bodies };
    const rowsOf = (texts, who) => ({ closed: false, manifest: { patient: { name: (who || item).name, patientId: (who || item).patientId },
      rows: texts.map((t) => ({ payload: { noteText: t } })) } });

    const secs = sectionsOf(1).map((s) => s.text);
    eq(m(rowsOf(secs), item), true, 'match: a five-section sheet cut from THIS record matches it');
    eq(m(rowsOf(secs.concat(['A section from a completely different encounter, long enough to look real.'])), item), false,
      'match: ONE foreign row refuses the whole sheet');
    eq(m(rowsOf([]), item), false, 'match: an empty sheet never matches');
    eq(m(rowsOf(['short']), item), false, 'match: a run shorter than the section minimum is not proof');
    const wrongPatient = Object.assign({}, item, { patientId: 'syn-v-9' });
    eq(m(rowsOf(secs), wrongPatient), false, 'match: another patient\'s sheet is refused before any text is read');
    ok(h.batch.sectionMin >= 40, 'match: the section minimum is well past accidental overlap');
    /* The op-note shape - ONE row holding the whole body - still matches by rule one. */
    const opBody = 'OPERATIVE NOTE 3 Synthetic operative body, long enough to match a sheet row.';
    const opItem = { id: 'v-3', name: 'Synthetic Visit Patient 3', patientId: 'syn-v-3', body: opBody.slice(0, 400), bodies: [opBody] };
    eq(m(rowsOf([opBody], opItem), opItem), true, 'match: the original op-note single-row proof is unchanged');
  }

  /* ================================================================ PART 8
   * dayvs-1.0.0 - "stored correctly". The shipped resolver, run for real. */
  {
    const stamp = extractFunction(SHELL_SRC[SHELLS[0]], 'function _athenaCurrentApptStamp(patientId,day){');
    function runStamp(appts, ledgerRows, pid, day) {
      const store = new Map();
      if (ledgerRows !== null) store.set('acct:schedImportIndexV1::' + day, JSON.stringify({ v: 1, rows: ledgerRows }));
      const win = { _calAppts: appts, uns: (k) => 'acct:' + k };
      const ctx = vm.createContext({
        window: win, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) },
        JSON, String, Number, Object, Array, RegExp, console
      });
      vm.runInContext(stamp + '\nthis.__out = _athenaCurrentApptStamp(' + JSON.stringify(pid) + ',' + JSON.stringify(day) + ');', ctx, { filename: 'dayvs.js' });
      return ctx.__out;
    }
    const appt = { id: 'cal-row-1', patient_external_id: 'syn-v-1', appt_date: DAY, providerName: PROVIDER };
    const ledger = { 'appointment-id:70000001': { patientId: 'syn-v-1', backendAppointmentId: 'cal-row-1', appt_date: DAY } };

    /* 8.1 THE FORCED ANSWER. One appointment, one ledger hit. */
    const good = runStamp([appt], ledger, 'syn-v-1', DAY);
    eq(good.appointmentId, '70000001', 'dayvs: a FORCED single appointment is resolved and stored');
    eq(good.provider, PROVIDER, 'dayvs: the provider comes from the same forced row');

    /* 8.2 AMBIGUITY FAILS CLOSED. MLS must never PICK an appointment. */
    const two = runStamp([appt, Object.assign({}, appt, { id: 'cal-row-2' })], ledger, 'syn-v-1', DAY);
    eq(two.appointmentId, '', 'dayvs: two appointments on the day resolve to NOTHING');
    eq(runStamp([], ledger, 'syn-v-1', DAY).appointmentId, '', 'dayvs: no appointment resolves to nothing');

    /* 8.3 A MISSING OR MISMATCHED LEDGER RESOLVES TO NOTHING. */
    eq(runStamp([appt], null, 'syn-v-1', DAY).appointmentId, '', 'dayvs: no schedule-import ledger resolves to nothing');
    eq(runStamp([appt], { 'appointment-id:70000001': { patientId: 'someone-else', backendAppointmentId: 'cal-row-1', appt_date: DAY } }, 'syn-v-1', DAY).appointmentId, '',
      'dayvs: a ledger entry for a DIFFERENT patient resolves to nothing');
    eq(runStamp([appt], { 'appointment-id:70000001': { patientId: 'syn-v-1', backendAppointmentId: 'cal-row-9', appt_date: DAY } }, 'syn-v-1', DAY).appointmentId, '',
      'dayvs: a ledger entry for a DIFFERENT appointment row resolves to nothing');
    eq(runStamp([appt], { 'appointment-id:70000001': { patientId: 'syn-v-1', backendAppointmentId: 'cal-row-1', appt_date: OTHER_DAY } }, 'syn-v-1', DAY).appointmentId, '',
      'dayvs: a ledger entry for a DIFFERENT day resolves to nothing');
    const twoHits = { 'appointment-id:70000001': { patientId: 'syn-v-1', backendAppointmentId: 'cal-row-1', appt_date: DAY },
      'appointment-id:70000002': { patientId: 'syn-v-1', backendAppointmentId: 'cal-row-1', appt_date: DAY } };
    eq(runStamp([appt], twoHits, 'syn-v-1', DAY).appointmentId, '', 'dayvs: two ledger hits resolve to nothing');

    /* 8.4 A BAD DAY OR A MISSING PATIENT IS REFUSED, NEVER GUESSED. */
    eq(runStamp([appt], ledger, '', DAY).appointmentId, '', 'dayvs: no patient id resolves to nothing');
    eq(runStamp([appt], ledger, 'syn-v-1', 'not-a-day').appointmentId, '', 'dayvs: a malformed day resolves to nothing');

    /* 8.5 THE CALL SITE ACTUALLY STORES IT. This is the defect the block was
       written for: the live visitContext literal carried visitDate and
       provider and NOTHING else, so appointmentId was coerced to '' on every
       visit note the app ever filed. */
    SHELL_TWINS.forEach((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const bind = extractFunction(src, 'function _athenaBindingForCurrentVisit(source)');
      ok(/_athenaCurrentApptStamp\(/.test(bind), f + ': the live visit binding must consult the dayvs resolver');
      ok(/appointmentId:_vstamp\.appointmentId/.test(bind),
        f + ': the live visit binding must actually STORE the resolved appointment id');
    });
  }

  console.log('day-writeall: ' + checks + ' checks passed');
})().catch((err) => {
  console.error('day-writeall FAILED: ' + (err && err.message ? err.message : err));
  console.error(err && err.stack ? err.stack : '');
  process.exit(1);
});
