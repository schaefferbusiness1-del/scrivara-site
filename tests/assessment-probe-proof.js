'use strict';

/* secsurf-1.0.0 - THE ASSESSMENT / PLAN / A&P READ-ONLY CHECK THAT NEVER
 * SETTLED, and the two-file cure, pinned.
 *
 * MEASURED LIVE 2026-09-02 00:5x-01:1x (owner's tab, app b1196, MLS Assist
 * 3.0.107, test patient Adam #7833832, encounter 08-31 bound). The Send to
 * Athena sheet wrote and read back Reviewed HPI, Review of Systems and Physical
 * Exam inside ~30s each. The fourth row, "Write reviewed Assessment narrative"
 * (Athena encounter > Assessment & Plan > Assessment), sat in "Checking Athena
 * for 1 of 1 ... nothing sent yet" for the whole 150s read-only bound TWICE,
 * printing "athenaOne is still painting the encounter it just opened", then
 * settled "not sent" and re-armed. Plan / Follow-up and the combined Assessment
 * & Plan row were never reached.
 *
 * THE CAUSE, both sides:
 *   background.js  - the candidate loop's zero-candidate return answers
 *     `context-unverified` / "Could not identify one exact patient encounter
 *     frame" whether NO encounter is open or the encounter IS open and only the
 *     requested named section's editor could not be resolved.
 *   1p-feat_mls_writeflow.js - probeUnifiedRow reads exactly that code as
 *     "athenaOne is still painting the encounter it just opened", paces up to
 *     four re-probes, then re-opens the encounter read-only; the re-open re-arms
 *     the pacing, so the ladder recycles against a surface that is already
 *     painted and will never change, and only the caller's bound can end it
 *     (which is what wfnext-1.0.0 had to bound around).
 *   On a practice whose A/P stage renders ONE combined "Assessment & Plan"
 *   editor there is no separate Assessment or Plan field to find at all - which
 *   is why the combined destination exists (ap-1.0.0, live 2026-08-26).
 *
 * THE CURE, and what this suite proves:
 *   0. scripts/splice-30109-secsurface.js resolves its single exact-count
 *      anchor against background.js AS IT IS NOW, writes only background.js,
 *      inserts ASCII only, and produces the new `note-section-not-on-surface`
 *      verdict whose sentence CANNOT match the app's still-painting predicate.
 *      The splice is executed in a vm against a stubbed fs - nothing on disk is
 *      touched by running this suite.
 *   1. The app knows that code by name (not "unlisted"), says it as ONE named
 *      step through the SHIPPED wfclar table, and it is on NO auto-open list and
 *      NO automatic-re-check list - so it can never enter the pacing ladder.
 *   2. The seven SHA-pinned write-path regions are byte-identical: this cure
 *      did not touch the write.
 *   3. At runtime the sheet SETTLES that refusal on the first answer: one probe,
 *      zero navigation verbs, the honest sentence on screen, and the queue is
 *      free to reach the rows behind it.
 *
 * Run:  node tests/assessment-probe-proof.js
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const FLOW_FILE = path.join(ROOT, '1p-feat_mls_writeflow.js');
const FLOW = fs.readFileSync(FLOW_FILE, 'utf8');
const SPLICE_REL = 'scripts/splice-30109-secsurface.js';
const CODE = 'note-section-not-on-surface';

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

/* ===================================================== 0. THE SPLICE ITSELF
 * The extension is Fable's to release, so this suite may never run the splice
 * for real. It runs the REAL script in a vm whose `fs` reads the shipped files
 * and captures the write instead of performing it: the script's own exact-count
 * anchor check and its own ASCII guard are therefore the things being proven,
 * not a paraphrase of them. */
const spliced = (function () {
  const src = read(SPLICE_REL);
  const written = Object.create(null);
  const fakeFs = {
    readFileSync(file, enc) { return fs.readFileSync(path.join(ROOT, file), enc); },
    writeFileSync(file, data) { written[file] = data; }
  };
  const logged = [];
  const sandbox = {
    require(name) { if (name !== 'fs') throw new Error('the splice reached for an unexpected module: ' + name); return fakeFs; },
    console: { log(m) { logged.push(String(m)); }, error(m) { logged.push('ERR ' + String(m)); } },
    process: { exit(codeValue) { throw new Error('the splice ABORTED (exit ' + codeValue + '): ' + logged.join(' | ')); } },
    module: { exports: {} }, Buffer, RegExp, String, Number, Object, Array, JSON, Date, Math
  };
  vm.runInNewContext(src, sandbox, { filename: SPLICE_REL });
  return { written, logged };
})();
{
  const files = Object.keys(spliced.written);
  eq(files.length, 1, 'the 3.0.109 splice writes more than one extension file');
  eq(files[0], 'background.js', 'the 3.0.109 splice writes something other than background.js');
  ok(spliced.logged.join(' ').indexOf('SPLICE 3.0.109 secsurf-1.0.0 DONE') >= 0,
    'the 3.0.109 splice did not run to completion against the shipped background.js');

  const BG_NOW = fs.readFileSync(path.join(ROOT, 'background.js'), 'latin1');
  const BG_NEW = spliced.written['background.js'];
  ok(BG_NEW.length > BG_NOW.length, 'the splice produced no net insert');
  eq(/[^\x00-\x7f]/.test(BG_NEW.slice(0)) && !/[^\x00-\x7f]/.test(BG_NOW), false,
    'the splice introduced non-ASCII bytes that were not already in background.js');

  /* the anchor it edits is the zero-candidate return, and that return SURVIVES:
     every other zero-candidate outcome keeps the answer it has today */
  const OLD_RETURN = "if (candidates.length !== 1) return { ok: false, blocked: true, reason: candidates.length ? 'context-mismatch'";
  eq(BG_NOW.split(OLD_RETURN).length - 1, 1, 'the zero-candidate return is no longer a single exact anchor in background.js');
  eq(BG_NEW.split(OLD_RETURN).length - 1, 1, 'THE SPLICE REMOVED OR DUPLICATED THE EXISTING ZERO-CANDIDATE REFUSAL');

  /* ...and the new verdict is gated on the census, not on wording */
  /* secsurf-1.0.0 shipped as MLS Assist 3.0.109 (2026-09-02): once background.js
     carries the verdict, the splice is a no-op by design (its anchor is the
     zero-candidate return, which survives) and the proof measures the SHIPPED
     text instead; before the release it measures the splice's output. */
  const SHIPPED = BG_NOW.indexOf("reason: '" + CODE + "'") > 0;
  ok(SHIPPED || BG_NEW.indexOf("reason: '" + CODE + "'") > 0, 'the splice did not add the section-not-on-surface verdict');
  if (SHIPPED) ok(BG_NOW.split("reason: '" + CODE + "'").length - 1 === 1, 'the shipped verdict must appear exactly once in background.js');
  const GUARD = "if (candidates.length === 0 && mode !== 'teach' && action === 'write_note' && requestedNoteSection && requestedNoteSection !== 'note' && hetDiag.qualified === true && hetDiag.noteTargetFound === false && !hetDiag.postGate) {";
  ok(BG_NEW.indexOf(GUARD) > 0,
    'the new verdict is not gated on the exact census signature (qualified frame + no note target + no postGate) - it could fire on a refusal it did not measure');

  /* THE LOAD-BEARING CROSS-FILE FACT. The app decides "still painting" with one
     regex over the extension's own reason AND error text. The new sentence must
     fall outside it, or the cure changes nothing on screen. */
  const errMatch = /reason: 'note-section-not-on-surface'[^\n]*?error: '([^']+)'/.exec(BG_NEW);
  ok(errMatch, 'the new verdict carries no error sentence');
  const NEW_ERROR = errMatch[1];
  const ladder = /\/(encounter frame\|context\.unverified\|context\.mismatch)\/i/.exec(FLOW);
  ok(ladder, 'the still-painting predicate is not where this suite expects it in the probe ladder');
  const LADDER_RE = new RegExp(ladder[1], 'i');
  eq(LADDER_RE.test(NEW_ERROR + ' ' + CODE), false,
    'THE NEW REFUSAL STILL MATCHES THE STILL-PAINTING PREDICATE - the sheet would pace and re-open at it exactly as it did live');
  eq(LADDER_RE.test('Could not identify one exact patient encounter frame. context-unverified'), true,
    'the still-painting predicate no longer matches the refusal it was written for - this suite is measuring the wrong regex');
  ok(NEW_ERROR.indexOf('Nothing was changed') > 0, 'the new refusal does not say that nothing was changed');
}

/* ============================================ 1. THE APP SIDE, AS IT SHIPS
 * Read through the file's own read-only diagnostics seam, so this pins the
 * SHIPPED table and the SHIPPED classifier rather than a copy of them. */
const seam = (function () {
  const context = vm.createContext({
    window: {}, document: { readyState: 'complete', addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, appendChild(c) { return c; } }; }, body: { appendChild(c) { return c; } } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
    navigator: { userAgent: 'synthetic-test-agent' },
    console, Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.location = context.location;
  context.window.addEventListener = function () {};
  context.window.removeEventListener = function () {};
  context.window.postMessage = function () {};
  vm.runInContext(FLOW, context, { filename: FLOW_FILE });
  return context.window.__mlsWriteFlow.diagnostics;
})();
{
  eq(seam.reason(CODE), CODE,
    'the app does not know the 3.0.109 refusal by name - wfdxReason folds it to "unlisted" and every receipt and clarity lookup loses it');
  const clar = seam.clarity.classify(CODE);
  ok(clar && typeof clar === 'object', 'the clarity table has no entry for the 3.0.109 refusal, so it keeps the raw extension sentence and its red');
  eq(clar.fix, true, 'the section-not-on-surface refusal is not said as ONE named step');
  eq(clar.copy, true, 'the doctor is not offered the reviewed text to paste for a section MLS cannot reach');
  eq(!!clar.open, false,
    'THE REFUSAL CARRIES THE READ-ONLY OPEN LADDER - the encounter is already open, and re-driving navigation at a painted surface is what openpace-1.0.0 measured as destroying it');

  const say = seam.clarity.say(clar, { destination: 'Athena encounter > Assessment & Plan > Assessment', label: 'Write reviewed Assessment narrative' });
  ok(say.indexOf('Athena encounter > Assessment & Plan > Assessment') > 0,
    'the sentence does not name the exact destination it could not resolve');
  ok(/Nothing was changed and nothing was sent\.$/.test(say), 'the sentence does not end in the no-change guarantee');
  ok(say.indexOf('Check Athena again') > 0, 'the sentence does not name the control that re-runs the read-only check');
  ok(say.indexOf('Assessment & Plan (combined)') > 0,
    'the sentence never points at the combined destination that IS on a one-field A/P surface - the doctor is left with no way forward');
  eq(/still painting/i.test(say), false, 'the settled refusal still claims the surface is painting');

  /* the three closed sets that decide whether a code enters a ladder */
  eq(seam.autoChain.retryable[CODE], undefined,
    'the structural refusal is on the automatic re-check allowlist - nothing about the surface will change, so that is a loop');
  eq(seam.autoChain.painting[CODE], undefined,
    'the structural refusal is on the "still painting" set - that is the exact conflation this cure removes');
  eq(seam.autoChain.positive[CODE], undefined,
    'the structural refusal latches the whole sheet out of automatic re-checking, punishing every other row on it');
  ok(FLOW.indexOf("var AUTO_OPEN_REASONS = { 'context-unverified': 1, 'context-mismatch': 1 };") > 0,
    'the auto-open allowlist was rewritten - a section refusal must never drive athenaOne navigation');
}

/* ============= 1b. THE STEP THE EXTENSION HAS ALREADY TAKEN (apdead-5)
 * Measured 2026-09-02 against the shipped bytes. MLS Assist resolves the
 * requested section's OWN stage tab before it looks for candidates and reports
 * what it did there on hetDiag.stageNav. On the one-field A/P surface that
 * produces this refusal the value is 'already-open' - so the sentence opened
 * with "Open that section's own stage tab", a step the extension had just
 * proved done, and the doctor's only cycle (Check Athena again) returns the
 * identical sentence: a dead end. The cure is a sibling sentence used ONLY when
 * the tab is provably open, and it must say nothing that was not measured - no
 * claim that this practice renders a combined field, and no claim that MLS
 * unticked or changed any row (nothing implements that, and rowsel-1.0.0
 * reserves an unchecked row for the doctor's own choice). Every other stageNav
 * value, and every older extension that reports none, keeps today's sentence
 * byte-for-byte. */
{
  const clar = seam.clarity.classify(CODE);
  const ROW = { destination: 'Athena encounter > Assessment & Plan > Assessment', label: 'Write reviewed Assessment narrative' };
  eq(typeof clar.sayOpen, 'string',
    'the clarity entry carries no sentence for the surface whose stage tab MLS itself already opened - the refusal still leads with that navigation');
  ok(clar.sayOpen.length > 0, 'the stage-tab-open sentence is empty');

  const shipped = seam.clarity.say(clar, ROW);
  const openSay = seam.clarity.say(clar, ROW, 'already-open');
  const openedSay = seam.clarity.say(clar, ROW, 'opened-A/P');
  [['already-open', openSay], ['opened-A/P', openedSay]].forEach(function (pair) {
    const w = pair[0], s = pair[1];
    eq(s.indexOf("Open that section's own stage tab"), -1,
      'stageNav=' + w + ': the refusal still leads with a navigation the extension already performed and reported');
    ok(s.indexOf('Check Athena again') > 0,
      'stageNav=' + w + ': the sentence lost the control that re-runs the read-only check');
    ok(s.indexOf('Assessment & Plan (combined)') > 0,
      'stageNav=' + w + ': the sentence lost the combined destination that IS on a one-field A/P surface');
    ok(s.indexOf(ROW.destination) > 0,
      'stageNav=' + w + ': the sentence does not name the exact destination it could not resolve');
    ok(/Nothing was changed and nothing was sent\.$/.test(s),
      'stageNav=' + w + ': the sentence lost the no-change guarantee');
    eq(/still painting/i.test(s), false,
      'stageNav=' + w + ': the settled refusal still claims the surface is painting');
    eq(/unticked|un-ticked|MLS has unchecked/i.test(s), false,
      'stageNav=' + w + ': the sentence claims a row change that nothing implements');
  });

  eq(seam.clarity.say(clar, ROW, 'no-bead'), shipped,
    'a stage tab the extension could not find changed the sentence - that doctor still has a tab to open');
  eq(seam.clarity.say(clar, ROW, 'forbidden-control'), shipped,
    'a stage tab the extension refused to click changed the sentence');
  eq(seam.clarity.say(clar, ROW, 'click-failed'), shipped,
    'a stage tab click that failed changed the sentence');
  eq(seam.clarity.say(clar, ROW, ''), shipped,
    'an extension that reports no stage-tab outcome changed the sentence');
  eq(seam.clarity.say(clar, ROW), shipped,
    'the two-argument call (the execute path and the diagnostics seam) no longer returns the shipped sentence');

  /* the sensor. The extension already returns this outcome on every probe;
     recording it is the only way a sentence can know the step was taken. */
  const REC = FLOW.slice(FLOW.indexOf('function wfautoRecordProbe(state, row, probe, stage) {'),
    FLOW.indexOf('function wfautoEligible(state) {'));
  ok(REC.length > 0, 'the read-only probe sensor is no longer where this suite expects it');
  ok(REC.indexOf('hetDiag') > 0 && REC.indexOf('stageNav') > 0,
    'the stage-tab outcome the extension already returns is still discarded');
}

/* ================================== 2. THE WRITE PATH IS BYTE-IDENTICAL
 * The same seven regions tests/write-next-press-proof.js pins, checked here
 * because this cure lives one line away from the probe ladder and must not have
 * touched it. */
{
  const SHEET_CLARITY = read('tests/sheet-clarity.test.js');
  const AUTO_CHAIN = read('tests/write-auto-chain.test.js');
  const HEAD_REGIONS = [
    ['identity-lock', '  function validatedUnifiedProbe(patient, probe) {', '  function renderUnifiedContext(state, lock) {'],
    ['probe ladder', '  function probeUnifiedRow(state, rowId) {', '  /* wfsum-1.0.0 (owner 2026-08-26, watching his own writes land while the sheet'],
    ['receipt mint', '  function resultToUnifiedReceipt(state, row, resp, probe) {', '  /* ===== wfprog-1.0.0 (owner 2026-08-27:'],
    ['execute', '  function executeUnifiedSelection(state) {', '  /* bx-1.0.0 - batch send (owner 2026-08-26:'],
    ['batch queue', '  function runUnifiedBatchSend(state, btn) {', '  function reopenOptions(opts, manifest) {'],
    ['closed allowlist ATHENA_EXECUTABLE_ACTIONS', '  var ATHENA_EXECUTABLE_ACTIONS = ', '\n'],
    ['closed allowlist OPBATCH_ACTIONS', '  var OPBATCH_ACTIONS = ', '\n']
  ];
  HEAD_REGIONS.forEach(function (r) {
    const i = FLOW.indexOf(r[1]);
    ok(i >= 0, 'the write-path region vanished entirely: ' + r[0]);
    const j = FLOW.indexOf(r[2], i + r[1].length);
    ok(j > i, 'the write-path region lost its end marker: ' + r[0]);
    const got = crypto.createHash('sha256').update(FLOW.slice(i, j), 'utf8').digest('hex');
    ok(SHEET_CLARITY.indexOf(got) > 0 && AUTO_CHAIN.indexOf(got) > 0,
      'THE SECSURF CURE MOVED A PINNED WRITE-PATH REGION: ' + r[0]);
  });
  /* and the ladder still holds the pacing it holds today - the cure works by
     never reaching it, not by weakening it */
  const LADDER = FLOW.slice(FLOW.indexOf('  function probeUnifiedRow(state, rowId) {'),
    FLOW.indexOf('  /* wfsum-1.0.0 (owner 2026-08-26, watching his own writes land while the sheet'));
  ok(LADDER.indexOf('athenaOne is still painting the encounter it just opened') > 0,
    'the pacing branch this cure routes around is gone from the probe ladder');
  eq(LADDER.indexOf(CODE), -1,
    'the cure was written INTO the pinned probe ladder instead of into the clarity table beside it');
  /* apdead-5 is routed around the same ladder: the stage-tab outcome is read by
     the sensor and the clarity renderer, never by the pinned probe path. */
  eq(LADDER.indexOf('stageNav'), -1,
    'the apdead-5 cure was written INTO the pinned probe ladder');
}

/* =============================================== 3. THE SHEET, AT RUNTIME
 * One answer, one settle: the refusal lands, the sheet says it, and NOTHING
 * drives athenaOne. That is the whole difference between the measured 150s
 * recycle and a row the queue can move past. */
const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const APPOINTMENT = '70000017';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-secsurf', patientId: 'syn-secsurf', name: 'Synthetic Patient Secsurf', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-secsurf', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const SECTIONS = [
  { key: 'assessment', text: 'Synthetic assessment narrative for the secsurf proof.' },
  { key: 'plan', text: 'Synthetic plan and follow-up for the secsurf proof.' }
];
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* the ids that must resolve to NOTHING until the sheet appends them - the
   transient refusal controls are the evidence that a refusal settled */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt', 'mlsAthenaUnifiedCopySection'];

function makeDom() {
  const byId = new Map();
  const live = new Map();
  function forget(children) {
    children.forEach(child => {
      if (child && child.id && live.get(child.id) === child) live.delete(child.id);
      if (child && child.children && child.children.length) forget(child.children);
    });
  }
  function node(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), style: {}, dataset: {}, attrs: {}, children: [],
      handlers: {}, value: '', disabled: false, type: '', id: '', title: '', open: false,
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
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter(c => c !== el);
      },
      select() {}, focus() {}, click() { (el.handlers.click || []).forEach(fn => fn({ target: el })); },
      /* the sheet reaches its own controls out of the markup it just wrote, the
         same way the browser's querySelector would */
      querySelector(sel) {
        const s = String(sel || '').trim();
        if (s.charAt(0) === '#') return resolve(s);
        const m = /^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(s);
        if (!m) return null;
        return el.children.filter(c => (m[2] === undefined ? c.getAttribute(m[1]) !== null : c.getAttribute(m[1]) === m[2]))[0] || null;
      },
      querySelectorAll() { return []; }, closest() { return null; }
    };
    let html = '', text = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return html; },
      set(v) { html = String(v); forget(el.children); el.children.length = 0; }
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

function makeHarness(answerFor) {
  const dom = makeDom();
  const listeners = [];
  const posted = [];
  const store = new Map();
  store.set('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: {
    ['appointment-id:' + APPOINTMENT]: { state: 'done', patientId: PATIENT.patientId, backendAppointmentId: CAL_ROW.id, appt_date: DAY }
  } }));
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  let offset = 0;
  const RealDate = Date;
  function FakeDate(...args) { return args.length ? new RealDate(...args) : new RealDate(RealDate.now() + offset); }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => RealDate.now() + offset;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;

  const window = {
    document: dom.document, localStorage,
    _calAppts: [clone(CAL_ROW)],
    uns: k => 'acct:' + k,
    activePatient: () => PATIENT,
    location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
    __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage(message) { posted.push(message); route(message); }
  };
  window.window = window;

  function deliver(type, requestId, resp) {
    Promise.resolve().then(() => listeners.slice().forEach(fn => fn({ data: { source: 'mls-ext', type, requestId, resp } })));
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppAthenaActionV2') {
      /* an answerFor that returns nothing leaves the check unanswered - the
         bridge's own 25s/90s deadline is longer than any timer this shim runs,
         so the ladder simply stops there. That is how the CONTRAST block below
         stays bounded while still measuring the recycle. */
      const answer = answerFor(m);
      if (!answer) return;
      return deliver('mlsAppAthenaActionV2Result', m.requestId, answer);
    }
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.109', versionName: 'x', athena: { tabs: 1, discarded: 0 } });
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date: FakeDate, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => {
      const m = Number(ms || 0);
      if (m <= 2000 || m === 12000 || m === 15000) { offset += m; Promise.resolve().then(fn); }
      return 1;
    },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: FLOW_FILE });
  return {
    window, el: dom.resolve, posted,
    wf: window.__mlsWriteFlow,
    probes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe'),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    navigations: () => posted.filter(m => m.type === 'mlsAppSearchOpenPatient' || m.type === 'mlsAppGotoDate'),
    sectionsOf: list => list.map(m => (Array.isArray(m.sections) && m.sections[0] ? m.sections[0].key : ''))
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }

const SECSURF_REFUSAL = {
  ok: false, blocked: true, reason: CODE,
  noteSection: 'assessment', destination: 'Athena encounter > Assessment & Plan > Assessment',
  hetDiag: { rank: 6, qualified: true, noteTargetFound: false, ancestorIdentity: 'found', stageNav: 'already-open' },
  error: 'This encounter is open in athenaOne, but MLS could not resolve one exact editor for the reviewed section on the surface it is showing. Nothing was changed.'
};

(async function run() {
  {
    const h = makeHarness(() => clone(SECSURF_REFUSAL));
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'secsurf-settle' });
    await settle(400);

    const ready = manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    ok(ready.length >= 3, 'the fixture did not build the separate Assessment and Plan rows plus the combined one');
    ok(ready.some(r => r.id === 'write-note-assessment_and_plan'),
      'the combined Assessment & Plan row is missing - on a one-field A/P surface that row IS the destination');

    /* ONE answer settled it. The measured defect was the opposite: the same row
       re-probed on a 15s pace, re-opened the encounter, and re-armed the pace. */
    eq(h.probes().length, 1,
      'THE LADDER STILL RECYCLES - more than one read-only probe was sent for a refusal that can never change');
    eq(h.sectionsOf(h.probes())[0], 'assessment', 'the sheet did not check the row it selected');
    eq(h.executes().length, 0, 'a refused read-only check reached an execute');
    eq(h.navigations().length, 0,
      'MLS DROVE ATHENAONE AT AN ALREADY-PAINTED ENCOUNTER - that is the re-drive openpace-1.0.0 measured as destroying the surface');

    const probeText = h.el('mlsAthenaUnifiedProbe').textContent;
    eq(/still painting/i.test(probeText), false, 'the sheet still tells the doctor athenaOne is painting a surface that is already painted');
    ok(probeText.indexOf('Athena encounter > Assessment & Plan > Assessment') > 0,
      'the settled sentence does not name the destination that could not be resolved');
    ok(probeText.indexOf('Assessment & Plan (combined)') > 0,
      'the settled sentence does not point at the combined destination this surface has');
    ok(/Nothing was changed and nothing was sent\.$/.test(probeText), 'the settled sentence lost the no-change guarantee');
    /* apdead-5, end to end: this fixture's answer carries hetDiag.stageNav
       'already-open' - the extension opened or confirmed the A/P stage tab
       BEFORE it looked for candidates and said so on this very probe. The
       sentence the doctor reads must therefore not begin by telling him to
       open it. This is the whole wiring: the sensor records the outcome, the
       renderer reads it, the clarity table has a sentence for it. */
    eq(probeText.indexOf("Open that section's own stage tab"), -1,
      'THE SETTLED REFUSAL STILL LEADS WITH A STAGE-TAB NAVIGATION THE EXTENSION ALREADY PERFORMED AND REPORTED ON THIS PROBE');
    ok(probeText.indexOf('the stage tab for Athena encounter > Assessment & Plan > Assessment is already open') > 0,
      'the settled refusal does not say what the extension actually measured about that section\'s stage tab');

    /* the two controls a settled refusal must leave behind */
    ok(h.el('mlsAthenaUnifiedRecheck'), 'the settled refusal left no "Check Athena again" control - which is also the queue settle latch');
    ok(h.el('mlsAthenaUnifiedCopySection'), 'the doctor cannot copy the reviewed text of a section MLS could not reach');
    eq(h.el('mlsAthenaUnifiedDoIt'), null,
      'the settled refusal offered the read-only OPEN ladder for an encounter that is already open');

    /* the latch the batch queue waits on actually fired, so the rows behind
       this one are reachable */
    const st = h.wf.diagnostics.state();
    eq(st.probeSettled, st.probeGeneration, 'THE SETTLE LATCH NEVER FIRED - the queue can only end this row by burning its whole bound');
    eq(!!st.probe, false, 'a refused row is holding a probe lock');
    const auto = h.wf.diagnostics.autoChain.snapshot();
    eq(!!(auto && auto.armed === true), false,
      'the automatic re-check armed on a refusal that no amount of waiting can change');
    eq(h.wf.diagnostics.autoChain.eligible(), null,
      'the structural refusal is still eligible for an automatic read-only re-check');
  }

  /* CONTRAST. The same sheet, the same row, answered the way MLS Assist 3.0.107
     answered it live: the code the app must read as "still painting". This is
     the behaviour the splice removes at the source - proven here so the two
     answers are never confused for one another again. */
  {
    let answered = 0;
    const h = makeHarness(function () {
      /* bounded on purpose: the live ladder recycles without end, and this
         suite only needs to see it start */
      if (++answered > 3) return null;
      return { ok: false, blocked: true, reason: 'context-unverified',
        error: 'Could not identify one exact patient encounter frame.' };
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'secsurf-contrast' });
    await settle(400);
    ok(h.navigations().length > 0,
      'the 3.0.107 answer no longer drives the read-only open ladder - this suite is no longer measuring the defect it was written for');
    ok(h.probes().length > 1,
      'the 3.0.107 answer no longer re-probes - this suite is no longer measuring the defect it was written for');
  }

  console.log('assessment-probe-proof: ' + checks + ' checks passed (secsurf-1.0.0)');
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
