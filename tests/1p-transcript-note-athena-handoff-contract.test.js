'use strict';

/* Pins the complete, review-only chain without touching Athena or using PHI:
 * recovered/live transcript -> canonical editor -> exact note receipt ->
 * bound visit plan -> unified Athena confirmation -> status-only walkthrough. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const avatar = fs.readFileSync(path.join(ROOT, '1p-feat_mls_avatar.js'), 'utf8');
const connect = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');
const writeflow = fs.readFileSync(path.join(ROOT, '1p-feat_mls_writeflow.js'), 'utf8');
const walkthrough = fs.readFileSync(path.join(ROOT, 'feat_mls_writeback_walkthrough.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated function ' + name);
}

/* One verified transcript commit owns live and recovery. */
const commit = extractFunction(avatar, 'ambientCommitTranscript');
const liveFile = extractFunction(avatar, 'kioskAmbientFile');
const recoveredFile = extractFunction(avatar, 'ambientRecoverFile');
assert(liveFile.includes('ambientCommitTranscript('), 'live room capture bypasses the verified canonical transcript sink');
assert(recoveredFile.includes('ambientCommitTranscript('), 'recovered room capture bypasses the verified canonical transcript sink');
for (const proof of ['transcript', 'ez3flTranscript']) assert(commit.includes(proof), 'verified sink does not bind both canonical and mirror transcript surfaces');
assert(/dispatchEvent\s*\(/.test(commit), 'verified sink does not drive the canonical input handoff');
assert(/binding|patient/i.test(commit), 'verified sink lacks exact patient/visit binding proof');

/* The review must consume the generateNote boolean and binding receipt; an old
 * nonempty note is not a success signal. Detailed behavior is driven by the
 * companion runtime test. */
const review = extractFunction(avatar, 'kioskReviewShow');
assert(/\.then\s*\(\s*function\s*\(\s*\w+\s*\)/.test(review), 'draft handoff discards the resolved generateNote receipt');
assert(/===\s*true/.test(review), 'draft handoff does not require generateNote to resolve exact true');
assert(/currentVisitAthenaBinding|_athenaAsyncBindingStillSafe|draftReady/i.test(review), 'draft handoff lacks same-binding/epoch proof');
assert(!/settle\s*\(\s*!!\s*\(\s*b2[\s\S]{0,180}trim\(\)\.length\s*>\s*0/.test(review), 'old note-box text can still become a false ready receipt');

/* The top-lane mirror reaches the real editor and fires its canonical input
 * event; that event is what binds manual transcript content to this visit. */
const syncTranscript = extractFunction(connect, 'syncRealTranscript');
assert(/\btx\.value\s*=\s*merged/.test(syncTranscript), 'top-lane transcript never reaches the canonical editor');
assert(/tx\.dispatchEvent\s*\(\s*new Event\s*\(\s*['"]input['"]/.test(syncTranscript), 'canonical transcript input event is missing');
assert(/id===['"]transcript['"]\|\|id===['"]noteBox['"]/.test(page) && /_athenaMarkBoundEdit\(id\)/.test(page), 'canonical transcript/note input no longer enters the visit-binding guard');

/* The canonical drafter itself remains fail-closed on patient/visit changes and
 * returns true only after setting the binding and writing the note. */
const generate = extractFunction(page, 'generateNote');
for (const proof of ['_mlsExactScheduledClinicalAction', '_athenaGuardBoundEditor', '_athenaAsyncBindingStillSafe', '_athenaSetVisitBinding', 'showNote']) {
  assert(generate.includes(proof), 'generateNote lost ' + proof + ' handoff proof');
}
assert(/return\s+true\s*;/.test(generate) && /return\s+false\s*;/.test(generate), 'generateNote lost its exact success/failure receipt');

/* Review-to-Athena is a user-confirmed plan, never an automatic write. */
const push = extractFunction(page, 'pushEntireVisitToAthena');
for (const step of ['_athenaBoundVisitForAction', '_athenaBuildPlan', '_athenaPushPlan']) assert(push.includes(step), 'Athena handoff bypasses ' + step);
const pushPlan = extractFunction(page, '_athenaPushPlan');
assert(pushPlan.includes('_athenaShowReceipt('), 'Athena plan bypasses the review receipt');
const receipt = extractFunction(page, '_athenaShowReceipt');
assert(receipt.includes('openUnifiedConfirmation('), 'Athena receipt bypasses the isolated unified confirmation');
const openReview = extractFunction(connect, 'openReviewStep');
assert(!/\bsend\s*\.\s*click\s*\(/.test(openReview) && !/pushEntireVisitToAthena\s*\(/.test(openReview), 'note review automatically started an Athena action');
assert(/send\.focus\s*\(\s*\{\s*preventScroll\s*:\s*true/.test(openReview), 'note review no longer stops at the human review control');

/* The p1 writer can execute only the two draft lanes. Final clinical/billing
 * actions stay manual, and the walkthrough adds status—not action controls. */
{
  const element = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, focus() {}, textContent: '', innerHTML: '' });
  const document = { readyState: 'loading', body: element(), head: element(), documentElement: element(), activeElement: null,
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getElementById() { return null; }, createElement: element };
  const window = { window: null, document, location: { origin: 'https://mlsscribe.com', hostname: 'mlsscribe.com' },
    /* Frozen MLS Assist 3.0.61 has no athenaFinalActionsV1 capability. Even a
       newer supervised-order capability cannot turn these final rows into
       actions without the exact, separately advertised transport contract. */
    __mlsExtensionCapabilities: { supervisedOrderPlacementV2: true },
    addEventListener() {}, removeEventListener() {}, postMessage() {}, toast() {} };
  window.window = window;
  function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; }
  const context = vm.createContext({ window, document, location: window.location, MutationObserver, console,
    setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, Promise, Object, Array, String, Number, RegExp, JSON, Uint32Array });
  vm.runInContext(writeflow, context, { filename: '1p-feat_mls_writeflow.js' });
  const manifest = window.__mlsWriteFlow.buildUnifiedManifest({
    patient: { patientId: 'synthetic-patient-a', name: 'Synthetic Patient A', dob: '01/02/1980', mrn: '100001' },
    expectedContext: { visitDate: '08/17/2026', provider: 'Synthetic Provider A', appointmentId: '700001' },
    receiptSessionId: 'synthetic-handoff-review', previewHash: 'synthetic-handoff-hash',
    plan: [
      { kind: 'note', body: 'NOTE TEXT:\nSynthetic reviewed note.' },
      { kind: 'billing', body: 'BILLING:\nE/M level: 99214\nCPT: 20610', billing: { emCode: '99214', cptCodes: ['20610'] } },
      { kind: 'orders', body: 'Synthetic reviewed order', orderDrafts: [{ clientOrderId: 'synthetic-order-1', displayLabel: 'MRI lumbar spine', query: 'MRI lumbar spine', catalogId: 'synthetic-catalog-1', type: 'imaging', reviewStatus: 'accepted', source: 'provider-entered', fields: { study: 'MRI', region: 'lumbar spine', indication: 'synthetic indication' } }], orderSuggestions: [] }
    ]
  });
  const ready = Array.from(manifest.rows).filter(row => row.capability === 'ready' && row.action).map(row => row.action).sort();
  assert.deepStrictEqual(ready, ['save_draft', 'write_note'], 'frozen/default capability exposed a final Athena action');
  const finalRows = [manifest.rows.find(row => row.id === 'stage-billing'), manifest.rows.find(row => row.id === 'sign-encounter'),
    manifest.rows.find(row => row.payload && row.payload.category === 'order' && row.payload.order)];
  for (const row of finalRows) {
    assert(row, 'a manual final-action review row disappeared');
    assert.strictEqual(row.action, '', row.id + ' exposed an executable action to frozen MLS Assist');
    assert.strictEqual(row.capability, 'manual', row.id + ' stopped being a manual review row');
  }
}
assert(walkthrough.includes('ZERO action controls') && walkthrough.includes('openUnifiedConfirmation') && walkthrough.includes('orig.apply(this, arguments)'), 'writeback walkthrough no longer wraps the unified review as status-only UI');
assert(!/setInterval\s*\(|setTimeout\s*\(/.test(walkthrough), 'writeback walkthrough introduced polling/action timing');

/* THE REVIEW STEP REFUSED A NOTE THAT WAS ON SCREEN (p1-review-note-source-1.0.0).
   Owner 2026-08-13: "the review and send to athena byutton isnt working" — with
   a generated note visible in the flow card. The flow card owns its own copy,
   #ez3flNote, which mirrors down into #noteBox only on the user's own `input`
   event, so a note he generated and never typed into left #noteBox empty and
   this guard answered "Generate the note first". Executed here rather than
   pinned as text: the two copies are the same note by construction, so the
   flow copy must satisfy the guard, and an empty screen must still refuse. */
function driveReviewStep(noteBoxValue, flowValue) {
  const toasts = [];
  const nodes = {
    noteBox: { value: noteBoxValue, dispatchEvent() { return true; } },
    ez3flNote: { value: flowValue },
    pushAllEmrBtn: { style: {}, disabled: false, focus() {}, scrollIntoView() {},
      getBoundingClientRect: () => ({ top: 40, bottom: 90, left: 0, right: 100, height: 50 }) },
    ez3Adv: { click() { nodes.__advClicks = (nodes.__advClicks || 0) + 1; } }
  };
  const sandbox = {
    $: (id) => nodes[id] || null,
    flowToast: (message, kind) => { toasts.push({ message, kind }); },
    document: { body: { classList: { contains: () => false } } },
    window: { innerHeight: 900, __mlsAdvQuietOpen: false },
    getComputedStyle: () => ({ display: 'block', position: 'fixed', visibility: 'visible' }),
    /* the deferred half re-reads the DOM; this test owns the synchronous
       guard, so the timer is captured rather than run */
    setTimeout: () => 0,
    Event: function (type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(connect, 'openReviewStep') + '\nopenReviewStep();', sandbox);
  return { toasts, noteBox: nodes.noteBox.value, advClicks: nodes.__advClicks || 0 };
}

const generated = 'SUBJECTIVE:\nChief Complaint: No specific complaint documented.\n';
const fromFlow = driveReviewStep('', generated);
assert.strictEqual(fromFlow.toasts.length, 0,
  'the review step still refuses a generated note that is visible in the flow card: ' +
  JSON.stringify(fromFlow.toasts));
assert.strictEqual(fromFlow.noteBox, generated,
  'the review step proceeded without adopting the flow copy into the canonical editor');

const alreadySynced = driveReviewStep(generated, generated);
assert.strictEqual(alreadySynced.toasts.length, 0, 'a normally synced note was refused');

const genuinelyEmpty = driveReviewStep('', '');
assert.strictEqual(genuinelyEmpty.toasts.length, 1, 'an empty visit no longer refuses review');
assert(/Generate the note first/.test(genuinelyEmpty.toasts[0].message),
  'the empty-note refusal lost its wording');
assert.strictEqual(genuinelyEmpty.noteBox, '', 'the refusal path wrote to the canonical editor');

console.log('PASS 1p transcript-to-Athena handoff: verified sink, exact note receipt, stable binding, human review, unified confirmation, and manual final lanes');
