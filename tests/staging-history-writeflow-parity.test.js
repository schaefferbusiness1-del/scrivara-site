'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const prod = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const stagingConnector = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function ' + name);
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
      if (!prev || /[({\[=,:;!?&|+*%^~<>-]/.test(prev) || /\b(?:return|case|throw|typeof|instanceof|delete|void|yield|await)$/.test(before)) {
        regex = true; regexClass = false; escaped = false; continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated function ' + name);
}

function normalized(fn) {
  return fn.replace(/\r\n/g, '\n').trim();
}

const exactHistoryFunctions = [
  '_athenaHistoryTargetSnapshot',
  '_athenaHistoryTargetStillExact',
  '_athenaHistoryProofMatches',
  '_athenaHistoryVerifiedRef',
  '_assistReadChart',
  'pullPatientChartViaAssist',
  '_athenaChartHistoryObject',
  '_athenaChartVitalsObject',
  '_athenaChartProfileCoverage',
  '_athenaChartSnapshotList',
  '_athenaChartSnapshotFromChart',
  '_athenaChartSnapshotProof',
  '_savePatientChart',
  '_hasImportedHistory',
  '_pullAllHistories',
  '_parsePatientChart'
];
for (const name of exactHistoryFunctions) {
  assert.strictEqual(
    normalized(extractFunction(staging, name)),
    normalized(extractFunction(prod, name)),
    'staging history path drifted from production: ' + name
  );
}

const readChart = extractFunction(staging, '_assistReadChart');
assert(/requestId/.test(readChart) && /patientDob/.test(readChart) && /patientMrn/.test(readChart), 'chart request is not bound to exact identity and request id');
assert(/!e\.data\.requestId\|\|String\(e\.data\.requestId\)!==requestId/.test(readChart), 'ID-less chart responses can still settle a stateful exact-patient read');
assert(/String\(r\.requestId\|\|'\'\)===requestId/.test(readChart), 'successful chart payload can omit its exact request id');
assert(/cancelDeadline\.isTerminal\(\)/.test(readChart), 'chart bridge can dispatch after its absolute deadline arm is already terminal');
assert(/athena-chart-coverage/.test(readChart) && /2\.9\.19-chart-r3/.test(readChart), 'chart read does not require the complete 2.9.19 receipt');
assert(/expectedClinicalFrames/.test(readChart) && /readClinicalFrames/.test(readChart) && /truncated===true/.test(readChart), 'chart read does not verify complete frame coverage');

const pullAll = extractFunction(staging, '_pullAllHistories');
assert(/todo\.push\(\{appt:a,target:target\}\)/.test(pullAll), 'repeat day pull does not refresh every exact patient');
assert(!/_hasImportedHistory\(target\)/.test(pullAll), 'repeat day pull still skips previously imported patients');

const saveChart = extractFunction(staging, '_savePatientChart');
for (const marker of ['_athenaHistoryProofMatches', 'athenaChartSnapshot', 'athenaProfileCoverage', 'exactIdentityVerified', 'structuredHistory', 'structuredVitals']) {
  assert(saveChart.includes(marker), 'exact chart save is missing ' + marker);
}
assert(staging.includes("_athenaProfileEmptyText(p,'problems'") && staging.includes("_athenaProfileEmptyText(p,'summary'"), 'verified-empty six-card UI is not wired in staging');

const exactOrderFunctions = [
  '_autoSaveAiOrders',
  '_athenaOrderPlacementCapabilityReady',
  '_athenaOrderPlacementCandidate',
  '_athenaOrderPlacementVisitSnapshot',
  '_athenaOrderPlacementControl',
  'renderVisitOrders',
  'renderOrderList',
  'reviewAndPlaceOrderInAthena',
  'sendOrdersToEMR'
];
for (const name of exactOrderFunctions) {
  assert.strictEqual(
    normalized(extractFunction(staging, name)),
    normalized(extractFunction(prod, name)),
    'staging supervised-order path drifted from production: ' + name
  );
}

const autoSave = extractFunction(staging, '_autoSaveAiOrders');
assert(/return false/.test(autoSave) && !/currentOrders\.(?:push|splice)/.test(autoSave), 'AI suggestions still auto-save as reviewed orders');
const candidate = extractFunction(staging, '_athenaOrderPlacementCandidate');
assert(/catalogCode/.test(candidate) && /catalogId/.test(candidate), 'typed order does not require durable Athena catalog identity');
assert(/MAX_ORDER_FIELD=2000/.test(candidate) && /exceeds/.test(candidate), 'typed order does not reject overlength fields');
const capability = extractFunction(staging, '_athenaOrderPlacementCapabilityReady');
assert(/supervisedOrderPlacementV2===true/.test(capability), 'legacy capability reader fixture disappeared unexpectedly');
const control = extractFunction(staging, '_athenaOrderPlacementControl');
assert(/Send to Athena/.test(control) && /Review for Athena/.test(control), 'staging order row lost its capable action or legacy manual fallback');
assert(/athenaFinalActionsV1===true/.test(control) && /supervisedOrderPlacementV2===true/.test(control), 'staging order row can advertise placement without both typed capabilities');
assert(/Update MLS Assist/.test(control), 'older-extension manual fallback no longer names the cure');
const place = extractFunction(staging, 'reviewAndPlaceOrderInAthena');
assert(/openUnifiedConfirmation/.test(place), 'one-order review does not open the immutable unified review');
assert(/matches\.length!==1/.test(place) && /_athenaOrderPlacementCandidate/.test(place), 'one-order review can proceed without exactly one eligible frozen order');
assert(/_athenaBoundVisitForAction/.test(place) && /reviewPatient/.test(place) && /reviewExpected/.test(place), 'one-order review lost its exact patient/encounter binding');
assert(/candidate\.order\.clientOrderId/.test(place), 'one-order review receipt lost the immutable client-order binding');
assert(/athenaFinalActionsV1===true/.test(place) && /supervisedOrderPlacementV2===true/.test(place), 'one-order review can promise placement without both extension capabilities');
assert(/Nothing is placed until you press Confirm & Send/.test(place), 'capable order review does not preserve the separate explicit confirmation');
assert(/Update MLS Assist to place it from here; nothing was placed/.test(place), 'older-extension order review lost its manual fallback');
assert(!/startAthenaAction|sendToEMRviaAssist|mlsAppPasteNote|mlsAppPushVisit/.test(place), 'one-order button contains a direct/generic Athena write path');

const pushPlan = extractFunction(staging, '_athenaPushPlan');
assert(/openUnifiedConfirmation/.test(pushPlan), 'full visit route does not use the unified confirmation');
assert(!/_athenaPushRun\(/.test(pushPlan), 'full visit route still executes the legacy section autopilot');
assert(/requireExpectedVisit:true/.test(pushPlan), 'full visit review is not bound to an exact expected encounter');
assert.strictEqual(extractFunction(staging, 'getAutoSendEMR').replace(/\s+/g, ''), "functiongetAutoSendEMR(){returnfalse;}", 'staging still permits signed-note auto-send');

assert(staging.includes('Review Athena destinations'), 'staging top action still promises a direct full-visit send');
assert(staging.includes('Review Athena order routes'), 'staging Orders action still promises a direct EMR send');
assert(staging.includes('var currentVisitAthenaBinding=null'), 'staging has no immutable visit owner');
assert(staging.includes("currentVisitAthenaBinding=_athenaBindingForCurrentVisit('generated')"), 'note generation does not freeze its patient/visit owner');

assert(/feat_mls_writeflow\.js/.test(stagingConnector), 'staging does not load the unified write workflow');
assert(/feat_mls_copilot_voice_v2\.js/.test(stagingConnector), 'staging does not load Copilot Voice v2');

/* Exercise staging's unique binding/unified-review adapter, not only source parity. */
let active = { id: 'pt-exact-1', name: 'Exact Patient', dob: '01/02/1970', mrn: 'MRN-77' };
let openedReview = null;
const runtime = {
  console, Object, Array, String, Number, Date, Math, RegExp, JSON, Intl,
  currentVisitAthenaBinding: null,
  currentVisitAthenaCompromised: false,
  activePatient() { return active; },
  getName() { return 'Matthew Schaeffer, MD'; },
  toast() {},
  window: {
    _heroSelIdx: 0,
    _heroTodayList: [{
      patient_external_id: 'pt-exact-1', name: 'Exact Patient', dob: '01/02/1970',
      appt_date: '2026-07-14', providerName: 'Matthew Schaeffer, MD', appointmentId: 'appt-77'
    }],
    _calAppts: [],
    __mlsWriteFlow: {
      openUnifiedConfirmation(opts) { openedReview = opts; return { manifestId: 'staging-review-1' }; }
    }
  }
};
runtime.window.window = runtime.window;
vm.createContext(runtime);
vm.runInContext([
  '_athenaNormIdentity', '_athenaDigits', '_athenaSameBoundPatient', '_athenaLocalDay',
  '_athenaVisitContextForPatient', '_athenaFreezeVisitBinding', '_athenaBindingForCurrentVisit',
  '_athenaCurrentMatchesBound', '_athenaBoundVisitForAction', '_athenaPushPlan'
].map(name => extractFunction(staging, name)).join('\n') + `
this.bindCurrent=_athenaBindingForCurrentVisit;
this.boundForAction=_athenaBoundVisitForAction;
this.openPlan=_athenaPushPlan;`, runtime, { filename: 'staging-binding-review-runtime.js' });

const frozenBinding = runtime.bindCurrent('generated');
assert(frozenBinding && Object.isFrozen(frozenBinding) && Object.isFrozen(frozenBinding.patient), 'staging did not freeze the visit owner');
assert.strictEqual(frozenBinding.patient.patientId, 'pt-exact-1');
assert.strictEqual(frozenBinding.visitContext.visitDate, '2026-07-14');
assert.strictEqual(frozenBinding.visitContext.provider, 'Matthew Schaeffer, MD');
assert.strictEqual(frozenBinding.visitContext.appointmentId, 'appt-77');
runtime.currentVisitAthenaBinding = frozenBinding;
assert.strictEqual(runtime.boundForAction('reviewing', true), frozenBinding, 'exact active patient failed the staging binding guard');

const reviewResult = runtime.openPlan(
  [{ kind: 'note', body: 'NOTE TEXT:\nExact reviewed note' }],
  'Exact Patient', frozenBinding.patient, frozenBinding.visitContext
);
assert(reviewResult && reviewResult.manifestId === 'staging-review-1', 'staging did not open one unified review');
assert(openedReview && openedReview.requireExpectedVisit === true, 'staging unified review did not require the exact encounter');
assert.strictEqual(openedReview.patient.patientId, 'pt-exact-1');
assert.strictEqual(openedReview.expectedContext.appointmentId, 'appt-77');
assert(Object.isFrozen(openedReview.patient) && Object.isFrozen(openedReview.plan), 'staging unified review snapshots are mutable');

active = { id: 'pt-wrong-2', name: 'Wrong Patient', dob: '03/04/1980', mrn: 'MRN-88' };
assert.strictEqual(runtime.boundForAction('reviewing', true), null, 'staging allowed a patient switch to reuse the prior visit binding');

console.log('PASS staging parity: exact six-card history refresh, capability-gated immutable one-order review with manual fallback, and no suggestion auto-save');
