'use strict';

/* The appointment BRIEFING is the only Athena surface that renders "Active Problems";
   the clinical chart carries the patient banner that proves identity and does NOT render
   them (background.js v1.59 gate). The reader therefore has to click AWAY from the
   briefing, which is why a signed-IN pull walked 19 appointments and stored problems for
   6 (meds 0/19, vitals 0/19) while reporting "history 19/19, failures 0".

   This suite pins the fix END TO END and, just as importantly, pins that the fix bought
   nothing at the expense of patient identity:

     1. the briefing text is captured BEFORE the nudge click - proved by RUNNING the
        injected function against a DOM whose click wipes the problem list
     2. the captured text reaches the real consumers - _parsePatientChart's prompt payload
        and, through it, the chart object _savePatientChart stores - proved by running the
        production bridge, the production combiner, the production day-pull lane, and the
        production parser
     3. no identity or coverage gate is loosened: the pseudo-frame route (DESIGN A) stays
        closed, rd.text stays byte-exact for all three character-count gates, and a wrong
        DOB still refuses even when a rich briefing is attached
     4. ScribeFlow-staging.html carries the identical app-side change

   Root cause note for DESIGN A (rejected, not implemented): a synthetic entry in
   `results` gets frameId -1, is NOT filtered by NOISE_FRAME_RE, scores > 0 and so joins
   rankedStrict and increments expectedClinicalFramesStrict - but frameBoundToTarget
   fails both its doors (no numeric frameId identity, and the briefing has no
   name/DOB/MRN in its own text), so it returns BEFORE the merge. The payload would never
   arrive AND unboundClinicalFrames would break `complete`, taking 6-of-19 to 0-of-19. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.env.MLS_TEST_ROOT ? path.resolve(process.env.MLS_TEST_ROOT) : path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const prod = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const sched = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

const COMBINER = '_athenaChartTextForParse';

function countOf(hay, needle) {
  let n = 0, i = 0;
  for (;;) { const j = hay.indexOf(needle, i); if (j < 0) break; n++; i = j + needle.length; }
  return n;
}

/* Comment-, string- and regex-aware brace matcher (same shape as the staging parity
   suite's, plus `async` retention so extracted async functions still parse). */
function extractFunction(source, name, from) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker, from || 0);
  assert(start >= 0, 'missing function ' + name);
  if (source.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  let lineComment = false, blockComment = false, regex = false, regexClass = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (regex) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '[') regexClass = true;
      else if (ch === ']' && regexClass) regexClass = false;
      else if (ch === '/' && !regexClass) regex = false;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '/') {
      const before = source.slice(Math.max(brace, i - 32), i).trimEnd();
      const prev = before.slice(-1);
      if (!prev || /[({[=,:;!?&|+*%^~<>-]/.test(prev) || /\b(?:return|case|throw|typeof|instanceof|delete|void|yield|await)$/.test(before)) {
        regex = true; regexClass = false; escaped = false; continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated function ' + name);
}
const normalized = fn => fn.replace(/\r\n/g, '\n').trim();

const BRIEFING_TEXT = [
  'Example Clinician, MD',
  'Appointment briefing',
  'Active Problems',
  'Uncategorized - 7 problems',
  'Essential hypertension I10',
  'Type 2 diabetes mellitus E11.9',
  'Hyperlipidemia E78.5',
  'Medications',
  'lisinopril 10 mg PO daily',
  'metformin 500 mg PO BID'
].join('\n');
const POST_CLICK_TEXT = 'Ada Lovelace-Byron 04/05/1955 MRN 90210\nClinical chart loaded. No active problems section on this surface.';

/* =====================================================================
   1. CAPTURE ORDER - run the injected reader against a live-ish DOM
   ===================================================================== */
function runEnsureChart(opts) {
  const o = opts || {};
  const src = extractFunction(bg, 'mlsEnsureClinicalChartFn');
  assert(/out\.briefingText/.test(src), 'mlsEnsureClinicalChartFn never captures out.briefingText');

  const state = { body: o.bodyText, clicks: [], dispatched: [] };
  function ctrl(label) {
    const el = {
      textContent: label, value: '',
      getBoundingClientRect() { return { left: 10, top: 20, width: 120, height: 30 }; },
      scrollIntoView() {},
      dispatchEvent(ev) { state.dispatched.push(ev && ev.type); return true; },
      click() {
        state.clicks.push(label);
        /* the nudge navigates: the briefing surface is replaced by the clinical chart,
           which is exactly what makes the problem list unreachable after the click */
        state.body = POST_CLICK_TEXT;
      }
    };
    return el;
  }
  const controls = (o.controls || []).map(ctrl);
  const sandbox = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Boolean, Error,
    location: { href: o.href, hostname: 'athenanet.athenahealth.com' },
    document: {
      get body() { return { get innerText() { return state.body; } }; },
      querySelectorAll() { return controls; }
    },
    getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
    PointerEvent: function (type) { this.type = type; },
    MouseEvent: function (type) { this.type = type; }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(src + '\nthis.__run=mlsEnsureClinicalChartFn;', sandbox, { filename: 'mls-ensure-clinical-chart.js', timeout: 4000 });
  const out = sandbox.__run({ token: 'req-1', deadline: Date.now() + 30000 });
  return { out, state };
}

const briefingRun = runEnsureChart({
  href: 'https://athenanet.athenahealth.com/ax/appointment/33445566/briefing',
  bodyText: BRIEFING_TEXT,
  controls: ['REFRESH CHART']
});
assert.strictEqual(briefingRun.out.briefing, true, 'the appointment briefing surface was not detected');
assert.strictEqual(briefingRun.out.clicked, 'refresh-chart', 'the nudge did not actually click away from the briefing');
assert.strictEqual(briefingRun.state.clicks.length, 1, 'the nudge must click exactly once');
assert.strictEqual(briefingRun.state.body, POST_CLICK_TEXT, 'the fixture never simulated navigating off the briefing - the order claim would be untestable');
assert.strictEqual(typeof briefingRun.out.briefingText, 'string', 'no briefing text was captured at all');
assert(
  !briefingRun.out.briefingText.includes('Clinical chart loaded'),
  'the briefing text was captured AFTER the nudge click - it holds post-navigation text, so the problem list is already gone'
);
assert(briefingRun.out.briefingText.includes('Active Problems'), 'the captured text is missing the Active Problems section');
assert(briefingRun.out.briefingText.includes('Uncategorized - 7 problems'), 'the captured text is missing the measured problem count');
assert(briefingRun.out.briefingText.includes('metformin 500 mg PO BID'), 'the captured text is missing the briefing medication list');
assert(briefingRun.out.briefingText.length <= 90000, 'the capture is not bounded');

/* the capture must stay scoped to briefing frames: an ordinary chart frame must not pay
   an all-frames innerText walk (the v1.59-era 78s freeze) */
const plainRun = runEnsureChart({
  href: 'https://athenanet.athenahealth.com/ax/clinicals/chart',
  bodyText: POST_CLICK_TEXT,
  controls: ['Print']
});
assert.strictEqual(plainRun.out.briefing, false, 'an ordinary chart frame was misread as a briefing');
assert.strictEqual(plainRun.out.briefingText, undefined, 'a non-briefing frame ran the innerText capture anyway');
assert.strictEqual(plainRun.state.clicks.length, 0, 'an ordinary chart frame was clicked');

/* The worker RETAINS every briefing frame it saw before the click, keyed by frame url,
   beside sawBriefing - before the branch that reacts to the click. It must NOT pick one
   by LENGTH. background.js records (read-lease note, ~7605) that athenaOne keeps a
   PREVIOUS patient's frames alive across consecutive pulls; on the poll where the nudge
   fires, that stale frame is the fully painted one and the new one is still painting, so
   longest-wins actively prefers the WRONG patient's problem list. */
const evsAt = bg.indexOf('const evs = ((ex && ex.r) || []).map');
const sawAt = bg.indexOf('sawBriefing = sawBriefing || briefingNow;', evsAt);
const accumAt = bg.indexOf('          try { evs.forEach(function (v) { var bt =', sawAt);
const accumEnd = bg.indexOf('\n', accumAt);
const clickedAt = bg.indexOf('const clickedNow = evs.find', sawAt);
assert(evsAt > 0 && sawAt > evsAt, 'the injection-result accumulation region moved');
assert(accumAt > sawAt, 'the worker never retains briefing frames beside sawBriefing');
assert(accumAt < clickedAt, 'briefing frames are retained after the click branch instead of with sawBriefing');
assert.strictEqual(countOf(bg, 'briefingCapture'), 0, 'the longest-wins briefing selection survived - it prefers the stale, fully painted previous-patient frame');
assert.strictEqual(countOf(bg, 'briefingText: briefingShip'), 1, 'the chart response does not emit the BOUND briefing text exactly once');
assert.strictEqual(countOf(bg, 'briefingDiag: briefingDiag'), 1, 'the chart response does not emit briefingDiag exactly once');
assert(
  /return chartRespond\(\{ ok: true, text: chartTextStrict, receipt: chartReceiptStrict,/.test(bg),
  'the ok:true chart response no longer returns the coverage-bound text and receipt unchanged'
);

/* RUN the retention one-liner: the same frame re-read on every poll must collapse to one
   entry (longest wins PER URL), distinct frames must all survive, a frame with nothing
   captured must not be retained, and the list must be bounded. */
const accumSrc = bg.slice(accumAt, accumEnd);
function runRetain(rounds) {
  const sandbox = { console, String, Number, Array, Object, RegExp };
  sandbox.briefingFrames = [];
  const ctx = vm.createContext(sandbox);
  rounds.forEach((evs) => { sandbox.evs = evs; vm.runInContext(accumSrc, ctx, { filename: 'briefing-retain.js', timeout: 4000 }); });
  return sandbox.briefingFrames;
}
const WANTED_URL = 'https://athenanet.athenahealth.com/ax/appointment/33445566/briefing';
const PRIOR_URL = 'https://athenanet.athenahealth.com/ax/appointment/11112222/briefing';
const retainedSameFrame = runRetain([
  [{ url: WANTED_URL, briefingText: 'still painting' }],
  [{ url: WANTED_URL, briefingText: 'fully painted, much longer text' }]
]);
assert.strictEqual(retainedSameFrame.length, 1, 're-reading the same frame on every poll multiplies the retained list');
assert.strictEqual(retainedSameFrame[0].t, 'fully painted, much longer text', 'the fullest text for one url was not kept');
const retainedDistinct = runRetain([[
  { url: WANTED_URL, briefingText: 'outer shell' },
  { url: WANTED_URL + '/qualitypane', briefingText: 'nested pane holding Active Problems' },
  { url: 'https://athenanet.athenahealth.com/ax/clinicals/chart' }
]]);
assert.strictEqual(retainedDistinct.length, 2, 'distinct briefing frames were collapsed, or a frame that captured nothing was retained');
assert.strictEqual(runRetain([Array.from({ length: 40 }, (v, i) => ({ url: 'https://a/f' + i, briefingText: 'x' }))]).length, 12, 'the retained briefing list is unbounded - a wedged tab could grow the worker heap');

/* =====================================================================
   1b. THE BINDING - run it with the PRODUCTION identity predicates.
   A briefing has no patient banner, so it can never prove its own identity by the
   route the chart frames use. It is bound by PROVENANCE (the frame url must carry the
   appointment id THIS read asked for) or, failing that, by proving the patient inside
   its own text - the same two doors frameBoundToTarget uses. Anything else is dropped.
   ===================================================================== */
const helpersFrom = bg.indexOf('const nrmStrict = (s) =>');
const helpersTo = bg.indexOf('\n', bg.indexOf('const textHasMrnStrict = (txt, expectedMrn) =>'));
const bindFrom = bg.indexOf('const briefingApptRe = expectedAppointmentId ?');
const bindTo = bg.indexOf('\n', bg.indexOf('const briefingDiag = { offered:'));
assert(helpersFrom > 0 && helpersTo > helpersFrom, 'the strict identity predicate slice could not be isolated');
assert(bindFrom > helpersTo && bindTo > bindFrom, 'the briefing binding block is not below the strict identity predicates');
assert(bindFrom > bg.indexOf('const chartReceiptStrict = {'), 'the briefing binding runs before the coverage receipt is sealed - it must sit strictly below every gate');
assert(bindFrom > bg.indexOf('const exactGlobalIdentity = identityMatchesTarget(ident);'), 'the briefing binding cannot see the exact chart identity');
function runBind(o) {
  const sandbox = {
    console, String, Number, Array, Object, RegExp, Boolean, Date, Math, JSON,
    expectedAppointmentId: String(o.expectedAppointmentId || ''),
    briefingFrames: o.briefingFrames || [],
    want: String(o.want || ''), wantDob: String(o.wantDob || ''), wantMrn: String(o.wantMrn || ''),
    exactGlobalIdentity: o.exactGlobalIdentity !== false
  };
  vm.runInNewContext(
    bg.slice(helpersFrom, helpersTo) + '\n' + bg.slice(bindFrom, bindTo) +
    '\nthis.__out = { ship: briefingShip, diag: briefingDiag };',
    sandbox, { filename: 'briefing-bind.js', timeout: 4000 }
  );
  return sandbox.__out;
}
const WANT = { want: 'Ada Lovelace-Byron', wantDob: '04/05/1955', wantMrn: '90210' };
const PRIOR_PATIENT_BRIEFING = [
  'Example Clinician, MD', 'Appointment briefing', 'Active Problems',
  'Uncategorized - 4 problems', 'PRIOR PATIENT chronic kidney disease N18.3'
].join('\n') + '\n' + 'filler that makes the STALE frame the longer one '.repeat(40);
assert(
  PRIOR_PATIENT_BRIEFING.length > BRIEFING_TEXT.length,
  'the stale-frame fixture is not longer than the wanted one, so the longest-wins inversion would not be exercised'
);

/* the race the capture was moved into: a fully painted PREVIOUS patient briefing frame
   alongside a still-painting one for THIS appointment */
const bindRace = runBind(Object.assign({}, WANT, {
  expectedAppointmentId: '33445566',
  briefingFrames: [{ u: PRIOR_URL, t: PRIOR_PATIENT_BRIEFING }, { u: WANTED_URL, t: BRIEFING_TEXT }]
}));
assert(bindRace.ship.includes('Uncategorized - 7 problems'), 'the briefing for THIS appointment was not shipped');
assert(!bindRace.ship.includes('PRIOR PATIENT'), 'a PREVIOUS patient briefing frame was shipped into this verified patient record');
assert.strictEqual(bindRace.diag.offered, 2, 'briefingDiag does not report every offered frame');
assert.strictEqual(bindRace.diag.bound, 1, 'briefingDiag does not report how many frames bound');
assert.strictEqual(bindRace.diag.used, 1);
assert.strictEqual(bindRace.diag.chars, bindRace.ship.length, 'briefingDiag.chars does not measure what actually shipped');

/* no provenance and no self-proof -> silence, never a guess */
const bindNoAppt = runBind(Object.assign({}, WANT, {
  expectedAppointmentId: '', briefingFrames: [{ u: WANTED_URL, t: BRIEFING_TEXT }]
}));
assert.strictEqual(bindNoAppt.ship, '', 'a briefing with no provenance and no self-proof was shipped anyway');
assert.strictEqual(bindNoAppt.diag.bound, 0, 'an unbindable briefing frame was counted as bound');
assert.strictEqual(bindNoAppt.diag.apptScoped, 0, 'briefingDiag claims appointment scoping with no appointment id');

/* the url is the ONLY thing that can bind a banner-less briefing, so it must not be
   truncated away, and both url shapes appointmentIdFor (~line 296) already recognises
   must bind - otherwise the capture reports an honest zero forever on the query form */
assert(
  /out\.url = String\(location\.href \|\| ''\)\.slice\(0, 600\)/.test(bg),
  'the injected frame url was re-truncated - a long query string can cut the appointment id off the only thing that binds the briefing'
);
const bindQueryUrl = runBind(Object.assign({}, WANT, {
  expectedAppointmentId: '33445566',
  briefingFrames: [{ u: 'https://athenanet.athenahealth.com/1/16/appointment/appointmentbrief.esp?PATIENTID=9001&APPOINTMENTID=33445566&TABID=2', t: BRIEFING_TEXT }]
}));
assert(bindQueryUrl.ship.includes('Uncategorized - 7 problems'), 'the athenaOne appointmentbrief.esp?APPOINTMENTID= briefing url does not bind');
/* a BARE digit collision is not provenance: an 8-digit patient id or an epoch can equal
   an appointment id, and accepting it would re-open the cross-patient door by the back */
const bindDigitCollision = runBind(Object.assign({}, WANT, {
  expectedAppointmentId: '33445566',
  briefingFrames: [{ u: 'https://athenanet.athenahealth.com/1/16/clinicals/briefing.esp?PATIENTID=33445566', t: PRIOR_PATIENT_BRIEFING }]
}));
assert.strictEqual(bindDigitCollision.ship, '', 'a bare digit collision in the url was accepted as appointment provenance');
assert.strictEqual(bindDigitCollision.diag.bound, 0);

/* the second door: a frame that proves the patient in its OWN text is a real binding */
const bindByText = runBind(Object.assign({}, WANT, {
  expectedAppointmentId: '',
  briefingFrames: [{ u: 'https://athenanet.athenahealth.com/ax/qualitypane', t: 'Ada Lovelace-Byron 04/05/1955\n' + BRIEFING_TEXT }]
}));
assert(bindByText.ship.includes('Uncategorized - 7 problems'), 'a briefing frame that proves the patient in its own text was refused');
assert.strictEqual(bindByText.diag.bound, 1);

/* CONCATENATION, not selection: document.body.innerText does not cross iframe
   boundaries, so a nested problems pane and its own outer shell arrive as two frames.
   Selecting the longer one ships the nav chrome and delivers nothing. */
const bindTwoPanes = runBind(Object.assign({}, WANT, {
  expectedAppointmentId: '33445566',
  briefingFrames: [
    { u: WANTED_URL, t: 'Example Clinician, MD\nAppointment briefing\nouter shell nav chrome, longer than the pane ' + 'x'.repeat(400) },
    { u: WANTED_URL + '/qualitypane', t: BRIEFING_TEXT }
  ]
}));
assert(bindTwoPanes.ship.includes('Uncategorized - 7 problems'), 'a nested briefing pane lost to its own longer shell - only concatenation can carry both');
assert(bindTwoPanes.ship.includes('outer shell nav chrome'), 'the outer briefing shell was discarded');
assert.strictEqual(bindTwoPanes.diag.used, 2, 'the binding still selects ONE briefing frame instead of concatenating every bound one');

/* the briefing adds no proof of its own, so an unproved chart identity means silence */
const bindNoIdentity = runBind(Object.assign({}, WANT, {
  expectedAppointmentId: '33445566', exactGlobalIdentity: false,
  briefingFrames: [{ u: WANTED_URL, t: BRIEFING_TEXT }]
}));
assert.strictEqual(bindNoIdentity.ship, '', 'a briefing shipped on a read whose chart identity was never exactly proved');
assert.strictEqual(bindNoIdentity.diag.bound, 1, 'the identity-held drop is invisible in the instrument');
assert.strictEqual(bindNoIdentity.diag.identityHeld, 0);
assert.strictEqual(bindNoIdentity.diag.chars, 0);

/* the concatenation is capped, and a frame dropped for cap is COUNTED */
const bindCap = runBind(Object.assign({}, WANT, {
  expectedAppointmentId: '33445566',
  briefingFrames: [{ u: WANTED_URL + '/a', t: 'A'.repeat(60000) }, { u: WANTED_URL + '/b', t: 'B'.repeat(60000) }]
}));
assert(bindCap.ship.length <= 90000, 'the concatenated briefing broke its 90000 cap: ' + bindCap.ship.length);
assert.strictEqual(bindCap.diag.used, 1);
assert.strictEqual(bindCap.diag.omitted, 1, 'a briefing frame dropped for cap is not counted');

/* =====================================================================
   2. IDENTITY AND COVERAGE ARE UNCHANGED (background.js)
   ===================================================================== */
assert(bg.includes("if (identityMatchesTarget(frameIdentity[f.frameId])) return true;"), 'frameBoundToTarget lost its per-frame identity door');
assert(bg.includes("if (!strictNameMatch(f.t, want)) return false;\n            return !!((wantDob && textHasDobStrict(f.t, wantDob)) || (wantMrn && textHasMrnStrict(f.t, wantMrn)));"), 'frameBoundToTarget lost its in-frame name+DOB/MRN door');
assert(bg.includes("if (!frameBoundToTarget(f)) { unboundClinicalFrames++; return; }"), 'unbound clinical frames are no longer counted and skipped');
assert(bg.includes('textChars: chartTextStrict.length'), 'the coverage receipt no longer measures the bound chart text');
assert(bg.includes('const chartTextStrict = mergedStrict;'), 'the returned chart text is no longer the merged BOUND frame text');

/* DESIGN A stays closed: nothing briefing-shaped may exist anywhere between the frame
   set being built and the coverage receipt being sealed. */
const frameRegionStart = bg.indexOf('const rawFrames = (results || []).map');
const frameRegionEnd = bg.indexOf('const chartReceiptStrict = {', frameRegionStart);
assert(frameRegionStart > 0 && frameRegionEnd > frameRegionStart, 'the frame-binding region could not be isolated');
const frameRegion = bg.slice(frameRegionStart, frameRegionEnd);
assert.strictEqual(countOf(frameRegion, 'briefing'), 0, 'briefing data leaked into frame binding / merge / coverage counting');
/* briefingDiag must be a SIBLING of the response, never inside the receipt: three
   separate gates re-check receipt.textChars against rd.text alone. */
const receiptRegion = bg.slice(bg.indexOf('const chartReceiptStrict = {'), bg.indexOf('/* 3.0.2: the read lease binds'));
assert(receiptRegion.length > 400, 'the coverage receipt region could not be isolated');
assert.strictEqual(countOf(receiptRegion, 'briefing'), 0, 'briefing data entered the coverage receipt');
assert.strictEqual(countOf(bg, 'mls://'), 0, 'a synthetic pseudo-frame url appeared in the reader');
assert.strictEqual(countOf(bg, COMBINER), 0, 'the app-side combiner leaked into the extension reader');

/* =====================================================================
   3. THE BRIDGE CARRIES IT OUT - and still refuses on identity
   ===================================================================== */
const identitySlice = prod.slice(prod.indexOf('function _athenaHistoryDigits(v)'), prod.indexOf('/* Like _assistReadAthenaTab'));
assert(identitySlice.length > 1000, 'the exact-identity helper slice could not be isolated');

function readChartOnce(respOverrides, target) {
  const patients = [{ id: 'pt-1', name: 'Ada Lovelace-Byron', dob: '04/05/1955', mrn: '90210' }];
  const listeners = [];
  const fakeWindow = {
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage(data) {
      setTimeout(() => {
        if (data && data.type === 'mlsPing') return deliver({ source: 'mls-ext', type: 'mlsPong' });
        if (data && data.type === 'mlsAppReadChart') {
          const receipt = Object.assign({
            kind: 'athena-chart-coverage', requestId: data.requestId, complete: true,
            readerVersion: '2.9.19-chart-r3', capturedAt: Date.now(),
            expectedClinicalFrames: 2, readClinicalFrames: 2, boundClinicalFrames: 2,
            unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0, omittedForCap: 0,
            consideredFrames: 3, textChars: CHART_TEXT.length, truncated: false,
            identityObserved: true, identityVia: 'banner'
          }, (respOverrides && respOverrides.receipt) || {});
          const resp = Object.assign({
            ok: true, text: CHART_TEXT, briefingText: BRIEFING_TEXT, receipt,
            briefingDiag: { offered: 2, bound: 1, used: 1, omitted: 0, chars: BRIEFING_TEXT.length, apptScoped: 1, identityHeld: 1 },
            requestId: data.requestId, url: 'https://athenanet.athenahealth.com/ax/clinicals/chart',
            opened: true, chartName: 'Ada Lovelace-Byron', chartDob: '04/05/1955', chartMrn: '90210'
          }, (respOverrides && respOverrides.resp) || {});
          return deliver({ source: 'mls-ext', type: 'mlsAppChartResult', requestId: data.requestId, resp });
        }
      }, 0);
    }
  };
  function deliver(payload) { listeners.slice().forEach(fn => { try { fn({ data: payload }); } catch (e) { /* surfaced by the assertion */ } }); }
  const sandbox = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Boolean, Error, Promise, isFinite,
    setTimeout, clearTimeout, setInterval, clearInterval,
    getPatients() { return patients.map(p => Object.assign({}, p)); },
    upsertPatient() {},
    window: fakeWindow
  };
  Object.assign(fakeWindow, {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Boolean, Error, Promise, isFinite,
    setTimeout, clearTimeout, setInterval, clearInterval
  });
  vm.runInNewContext(
    identitySlice + '\n' + extractFunction(prod, '_assistReadChart') + '\nthis.__read=_assistReadChart;',
    sandbox, { filename: 'assist-read-chart.js' }
  );
  return sandbox.__read(target || { patientId: 'pt-1', id: 'pt-1', name: 'Ada Lovelace-Byron', dob: '04/05/1955', mrn: '90210' }, function () {});
}
const CHART_TEXT = 'Ada Lovelace-Byron 04/05/1955 MRN 90210\nallergies: NKDA\nvitals BP 128/82\nhistory of present illness\ndiagnosis notes';

(async function main() {
  const rd = await readChartOnce();
  assert.strictEqual(rd.text, CHART_TEXT, 'the bridge mutated the coverage-bound chart text');
  assert.strictEqual(rd.briefingText, BRIEFING_TEXT, 'the bridge dropped briefingText - the captured problem list never reaches the app');
  assert.strictEqual(rd.receipt.textChars, CHART_TEXT.length, 'the accepted receipt no longer measures the bound text alone');
  assert(rd.briefingDiag && rd.briefingDiag.offered === 2 && rd.briefingDiag.bound === 1 && rd.briefingDiag.chars === BRIEFING_TEXT.length,
    'the bridge dropped briefingDiag - a briefing that never arrived stays indistinguishable from a patient with no problems');
  assert.strictEqual(rd.briefingDiag.identityHeld, 1, 'the bridge dropped the identity-held flag');
  assert.strictEqual((await readChartOnce({ resp: { briefingDiag: 'not-an-object' } })).briefingDiag, null, 'a malformed briefingDiag was passed through instead of normalised away');

  /* identity still fails closed WITH a rich briefing attached */
  await assert.rejects(
    readChartOnce({ resp: { chartDob: '01/01/1900' } }),
    /matching DOB\/MRN proof/,
    'a wrong-DOB chart was accepted because a briefing was attached'
  );
  await assert.rejects(
    readChartOnce({ receipt: { unboundClinicalFrames: 1 } }),
    /belonged to the selected patient/,
    'an unbound clinical frame was accepted because a briefing was attached'
  );
  await assert.rejects(
    readChartOnce({ receipt: { textChars: CHART_TEXT.length + BRIEFING_TEXT.length } }),
    /belonged to the selected patient/,
    'the receipt character-count gate no longer measures rd.text alone'
  );
  await assert.rejects(
    readChartOnce({ resp: { text: '' } }),
    /read the chart/i,
    'an empty bound chart text was accepted because a briefing was attached'
  );

  /* =====================================================================
     4. THE COMBINER - the only place the two are joined, and it is capped
     ===================================================================== */
  const combinerSandbox = { console, String, Number, Math, Date, Array, window: {} };
  vm.runInNewContext(extractFunction(prod, COMBINER) + '\nthis.__combine=' + COMBINER + ';', combinerSandbox, { filename: 'combiner.js' });
  const combine = combinerSandbox.__combine;

  const combined = combine(rd);
  assert(combined.startsWith(CHART_TEXT), 'the combiner does not lead with the coverage-bound chart text');
  assert(combined.includes('Uncategorized - 7 problems'), 'the combiner drops the captured problem list');
  assert(combined.includes('metformin 500 mg PO BID'), 'the combiner drops the captured medication list');
  assert.strictEqual(combine({ text: CHART_TEXT }), CHART_TEXT, 'a read with no briefing must be byte-identical to today');
  assert.strictEqual(combine({ text: CHART_TEXT, briefingText: '   \n  ' }), CHART_TEXT, 'a blank briefing must not append a separator');
  /* the hard 90000 ceiling _parsePatientChart enforces must hold for the worst case
     the extension can produce: MERGE_CAP 85000 of bound text plus a 90000 capture */
  const worst = combine({ text: 'x'.repeat(85000), briefingText: 'p'.repeat(90000) });
  assert(worst.length <= 90000, 'the combined text can exceed the 90000 parse ceiling: ' + worst.length);
  assert(worst.length > 85000, 'the combiner refused to append anything in the worst case');
  const nearCap = combine({ text: 'x'.repeat(89990), briefingText: BRIEFING_TEXT });
  assert.strictEqual(nearCap.length, 89990, 'a chart already at the ceiling must be returned untouched');

  /* WHICH HALF the budget keeps decides whether the fix delivers anything. A large chart
     leaves only ~5k of room, and the TOP of a briefing page is navigation chrome plus the
     provider header - the clinical sections render below it. A head slice would keep the
     worthless half and drop the Active Problems block being captured, which is
     indistinguishable from the shipped defect. */
  const CHROME = 'athenaOne navigation Patients Calendar Tasks Inbox Reports Example Clinician, MD Appointment briefing tabs '.repeat(80);
  const TAIL_CLINICAL = 'Active Problems\nUncategorized - 7 problems\nEssential hypertension I10\nmetformin 500 mg PO BID';
  const tailKept = combine({ text: 'x'.repeat(85000), briefingText: CHROME + TAIL_CLINICAL });
  assert(tailKept.length <= 90000, 'the budgeted combine broke the 90000 ceiling: ' + tailKept.length);
  assert(tailKept.includes('Uncategorized - 7 problems'), 'the briefing budget kept the navigation chrome and dropped the Active Problems block it was capturing');
  assert(tailKept.includes('metformin 500 mg PO BID'), 'the briefing budget dropped the medication list');
  assert(!tailKept.includes('athenaOne navigation Patients Calendar'), 'the briefing budget spent its room on navigation chrome');
  assert.strictEqual(combinerSandbox.window.__mlsLastBriefingCombine.dropped, 'truncated', 'a truncated briefing left no trace');
  /* with no clinical marker at all there is nothing to aim at, so keep the TAIL - the
     head is chrome either way - and still say that it was truncated */
  const noMarker = combine({ text: 'x'.repeat(85000), briefingText: 'q'.repeat(20000) + 'ENDMARK' });
  assert(noMarker.endsWith('ENDMARK'), 'with no clinical marker the budget kept the head, which is page chrome');
  assert.strictEqual(combinerSandbox.window.__mlsLastBriefingCombine.dropped, 'truncated');
  /* a briefing dropped because the chart already fills the ceiling must SAY so - this is
     the whole path six earlier fixes could not be distinguished on */
  combine({ text: 'x'.repeat(89990), briefingText: BRIEFING_TEXT });
  assert.strictEqual(combinerSandbox.window.__mlsLastBriefingCombine.dropped, 'no-room', 'a briefing dropped for cap vanished silently - indistinguishable from a patient with no problems');
  assert.strictEqual(combine({ text: CHART_TEXT }) && combinerSandbox.window.__mlsLastBriefingCombine.dropped, 'absent', 'a read that carried no briefing at all is not recorded as such');
  /* the extension-side counts must reach the same per-patient record, and the log must
     be bounded so a 19-appointment day pull keeps every row instead of the last one */
  combine({
    text: CHART_TEXT, briefingText: BRIEFING_TEXT, targetPatientId: 'pt-1',
    briefingDiag: { offered: 3, bound: 1, used: 1, omitted: 0, chars: BRIEFING_TEXT.length, apptScoped: 1, identityHeld: 1 }
  });
  const lastNote = combinerSandbox.window.__mlsLastBriefingCombine;
  assert.strictEqual(lastNote.patientId, 'pt-1', 'the briefing record is not attributable to a patient');
  assert.strictEqual(lastNote.extOffered, 3, 'the extension-side briefing counts do not reach the app');
  assert.strictEqual(lastNote.extBound, 1);
  assert.strictEqual(lastNote.extApptScoped, 1);
  assert.strictEqual(lastNote.usedChars, BRIEFING_TEXT.length, 'the record does not say how many briefing characters survived');
  assert.strictEqual(lastNote.dropped, '', 'an untruncated briefing was reported as dropped');
  for (let bi = 0; bi < 60; bi++) combine({ text: CHART_TEXT, briefingText: BRIEFING_TEXT, targetPatientId: 'pt-' + bi });
  assert.strictEqual(combinerSandbox.window.__mlsBriefingCombineLog.length, 40, 'the per-patient briefing log is unbounded');
  assert.strictEqual(combinerSandbox.window.__mlsBriefingCombineLog[39].patientId, 'pt-59', 'the briefing log dropped the newest rows instead of the oldest');

  /* =====================================================================
     5. IT REACHES THE REAL CONSUMER: _parsePatientChart, then the chart object
     ===================================================================== */
  let promptSeen = '';
  const parseSandbox = {
    console, String, Number, Math, JSON, Object, Array, RegExp, Error, Promise,
    getKey() { return 'k'; },
    aiCallRaw(sys, user) {
      promptSeen = String(user || '');
      return Promise.resolve(JSON.stringify({
        name: 'Ada Lovelace-Byron', dob: '04/05/1955', mrn: '90210',
        problems: /Uncategorized - 7 problems/.test(promptSeen) ? 'Essential hypertension I10; Type 2 diabetes mellitus E11.9; Hyperlipidemia E78.5' : '',
        meds: /metformin 500 mg PO BID/.test(promptSeen) ? 'lisinopril 10 mg PO daily; metformin 500 mg PO BID' : '',
        allergies: 'NKDA', summary: 'Hypertension and type 2 diabetes on oral therapy.',
        vitals: { bp: '128/82', hr: '', temp: '', rr: '', spo2: '', heightIn: '', weightLb: '', bmi: '', takenAt: '07/29/2026' },
        history: { pmh: 'Hypertension', psh: '', social: '', family: '', smoking: '', immunizations: '', lmp: '', codeStatus: '', pcp: '', pharmacy: '' },
        visits: ['07/29/2026 - office visit'],
        coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
      }));
    }
  };
  vm.runInNewContext(extractFunction(prod, '_parsePatientChart') + '\nthis.__parse=_parsePatientChart;', parseSandbox, { filename: 'parse-patient-chart.js' });
  const chart = await parseSandbox.__parse(combined);
  assert(/Uncategorized - 7 problems/.test(promptSeen), '_parsePatientChart never received the captured briefing text');
  assert(/COMPLETE EMR CHART FRAME TEXT/.test(promptSeen), 'the parse payload shape changed');
  assert(chart && /Essential hypertension I10/.test(chart.problems), 'the chart object has no problems even though the briefing was supplied');
  assert(/metformin 500 mg PO BID/.test(chart.meds), 'the chart object has no medications even though the briefing was supplied');
  /* the same parser must still throw above its ceiling, and must not throw on our worst case */
  await assert.rejects(parseSandbox.__parse('y'.repeat(90001)), /too large/, '_parsePatientChart lost its 90000 ceiling');
  await parseSandbox.__parse(worst);

  /* the stored patient record is the end of the line: run the production sink */
  const sinkPatients = [{ id: 'pt-1', name: 'Ada Lovelace-Byron', dob: '04/05/1955', mrn: '90210', problems: '', meds: '', allergies: '', summary: '' }];
  let sinkNotes = [];
  const sink = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp,
    getPatients() { return JSON.parse(JSON.stringify(sinkPatients)); },
    upsertPatient(p) { const i = sinkPatients.findIndex(x => x.id === p.id); if (i >= 0) sinkPatients[i] = JSON.parse(JSON.stringify(p)); else sinkPatients.push(JSON.parse(JSON.stringify(p))); },
    getNotes() { return JSON.parse(JSON.stringify(sinkNotes)); },
    saveNotes(n) { sinkNotes = JSON.parse(JSON.stringify(n)); }
  };
  sink.window = sink;
  vm.runInNewContext(
    identitySlice + '\n' + prod.slice(prod.indexOf('function _athenaChartHistoryObject(chart)'), prod.indexOf('/* Bulk: after pulling the schedule')),
    sink, { filename: 'save-patient-chart.js' }
  );
  const verifiedRef = sink._athenaHistoryVerifiedRef(
    { patientId: 'pt-1', name: 'Ada Lovelace-Byron', dob: '04/05/1955', mrn: '90210' },
    { chartName: rd.chartName, chartDob: rd.chartDob, chartMrn: rd.chartMrn }
  );
  assert(verifiedRef, 'the production identity proof refused its own matching fixture');
  assert.strictEqual(countOf(JSON.stringify(verifiedRef), 'briefing'), 0, 'the identity proof object now carries briefing data');
  assert.strictEqual(sink._savePatientChart(verifiedRef, null, chart), true, 'the production sink refused the chart parsed from the combined text');
  const stored = sinkPatients.find(p => p.id === 'pt-1');
  assert(/Essential hypertension I10/.test(stored.problems), 'the briefing problem list never reached the stored patient record');
  assert(/metformin 500 mg PO BID/.test(stored.meds), 'the briefing medication list never reached the stored patient record');
  assert.strictEqual(stored.athenaProfileCoverage.complete, true, 'the six-card receipt did not turn complete on a briefing-backed pull');

  /* =====================================================================
     6. THE DAY-PULL LANE - the lane that produced the 19-appointment zero
     ===================================================================== */
  let laneText = null;
  const lane = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Boolean, Error, Promise, isFinite,
    setTimeout, clearTimeout, AbortController: typeof AbortController === 'function' ? AbortController : undefined,
    absoluteDeadlines: { arm(at, fn) { const t = setTimeout(fn, Math.max(0, Number(at) - Date.now())); return function () { clearTimeout(t); }; } },
    safe(fn, d) { try { return fn(); } catch (e) { return d; } },
    isFn(f) { return typeof f === 'function'; },
    patientById() { return null; },
    validDobProof(v) { return String(v || '').replace(/\D/g, ''); }
  };
  lane.window = {
    _athenaChartTextForParse: combine,
    _parsePatientChart(text) { laneText = String(text || ''); return null; }
  };
  vm.runInNewContext([
    extractFunction(sched, 'boundedUntil'),
    extractFunction(sched, 'verifiedChartCoverage'),
    extractFunction(sched, 'saveOrganizedHistory'),
    'this.__save=saveOrganizedHistory; this.__cov=verifiedChartCoverage;'
  ].join('\n'), lane, { filename: 'save-organized-history.js' });

  const laneStartedAt = Date.now() - 1000;
  assert(lane.__cov(rd, laneStartedAt), 'the day-pull lane rejected a read the app bridge already accepted');
  await assert.rejects(
    lane.__save({ patientId: 'pt-1', dob: '04/05/1955' }, {}, rd, laneStartedAt, Date.now() + 20000, 'op-1'),
    /clinical-field-coverage-unproven/,
    'the day-pull fixture did not reach its parse step'
  );
  assert(laneText !== null, 'the day-pull lane never called _parsePatientChart');
  assert(laneText.includes('Uncategorized - 7 problems'), 'the DAY-PULL lane still parses only rd.text - the measured 19-appointment defect is unfixed');
  assert(laneText.startsWith(CHART_TEXT), 'the day-pull lane reordered the coverage-bound chart text');
  /* and the lane's own character-count gate still measures rd.text, never the combination */
  assert.strictEqual(
    lane.__cov(Object.assign({}, rd, { text: CHART_TEXT + BRIEFING_TEXT }), laneStartedAt), null,
    'the day-pull coverage gate stopped comparing textChars against rd.text'
  );
  assert(countOf(extractFunction(sched, 'verifiedChartCoverage'), COMBINER) === 0, 'the combiner is referenced inside the day-pull coverage gate');
  assert(countOf(extractFunction(prod, '_assistReadChart'), COMBINER) === 0, 'the combiner is referenced inside the receipt gate');

  /* =====================================================================
     7. EVERY parse call site uses the combiner - "present but never reached"
     ===================================================================== */
  for (const [label, source, names] of [
    ['ScribeFlow.html', prod, ['pullPatientChartViaAssist', '_pullAllHistories']],
    ['ScribeFlow-staging.html', staging, ['pullPatientChartViaAssist', '_pullAllHistories']]
  ]) {
    for (const name of names) {
      const fn = extractFunction(source, name);
      assert(fn.includes('_parsePatientChart(' + COMBINER + '(rd))'), label + ': ' + name + ' does not pass the combined text to _parsePatientChart');
      assert(!/_parsePatientChart\(rd\.text/.test(fn), label + ': ' + name + ' still parses rd.text alone');
    }
    assert.strictEqual(countOf(source, "briefingText:String(r.briefingText||'')"), 1, label + ': the bridge does not carry briefingText out exactly once');
    assert.strictEqual(countOf(source, "briefingDiag:(r.briefingDiag&&typeof r.briefingDiag==='object')"), 1, label + ': the bridge does not carry briefingDiag out exactly once');
    assert.strictEqual(countOf(source, 'window.__mlsBriefingCombineLog'), 2, label + ': the bounded per-patient briefing log is not written exactly where the combiner records it');
    assert.strictEqual(countOf(source, 'function ' + COMBINER + '(rd){'), 1, label + ': the combiner is not declared exactly once');
    assert(source.includes('try{ window.' + COMBINER + '=' + COMBINER + '; }'), label + ': the combiner is not published on window for the day-pull lane');
  }
  const laneFn = extractFunction(sched, 'saveOrganizedHistory');
  assert(laneFn.includes('window._parsePatientChart(parseText,'), 'the day-pull lane no longer parses the combined text variable');
  assert(!/window\._parsePatientChart\(rd\.text/.test(sched), 'a day-pull parse call still uses rd.text alone');
  /* provider-month-exact-routing.test.js walks this file with a COMMENT-BLIND quote
     scanner, so a lone apostrophe anywhere in the text added here desynchronises it. */
  const laneAdded = sched.slice(
    sched.indexOf('if (!coverage) return Promise.reject(new Error("chart-coverage-unproven"));'),
    sched.indexOf('var parsePromise = Promise.resolve(')
  );
  assert(laneAdded.length > 200 && laneAdded.includes(COMBINER), 'the inserted day-pull region could not be isolated');
  assert.strictEqual(countOf(laneAdded, "'"), 0, 'an ASCII apostrophe entered the new feat_mls_schedimport_exact.js text - the comment-blind quote scanner will mis-parse the file');

  /* =====================================================================
     8. STAGING PARITY - _savePatientChart parity killed an earlier build
     ===================================================================== */
  assert.strictEqual(
    normalized(extractFunction(staging, COMBINER)),
    normalized(extractFunction(prod, COMBINER)),
    'the staging combiner drifted from production'
  );
  for (const name of ['_assistReadChart', 'pullPatientChartViaAssist', '_pullAllHistories', '_parsePatientChart', '_savePatientChart', '_athenaHistoryVerifiedRef']) {
    assert.strictEqual(
      normalized(extractFunction(staging, name)),
      normalized(extractFunction(prod, name)),
      'staging drifted from production: ' + name
    );
  }
  /* the source-slice markers the sibling runtime suite needs must survive verbatim */
  for (const marker of ['function _athenaHistoryDigits(v)', '/* Like _assistReadAthenaTab', 'function _athenaChartHistoryObject(chart)', '/* Bulk: after pulling the schedule']) {
    assert(countOf(prod, marker) >= 1, 'chart-refresh-merge-runtime source marker was destroyed: ' + marker);
  }
  const combinerAt = prod.indexOf('function ' + COMBINER + '(rd){');
  assert(combinerAt > prod.indexOf('/* Like _assistReadAthenaTab'), 'the combiner landed inside the identity source slice');
  assert(combinerAt < prod.indexOf('function _athenaChartHistoryObject(chart)'), 'the combiner landed inside the save source slice');

  console.log('PASS briefing problem capture: captured before the nudge click, carried out of the bridge, combined under the 90000 ceiling, reaching _parsePatientChart in all three lanes (day pull included) and the stored patient record - with every identity, binding and character-count gate refusing exactly as before');
})().catch((e) => { console.error(e && e.stack || String(e)); process.exit(1); });
