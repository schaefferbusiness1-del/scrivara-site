'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const flowSource = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connectSource = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(root, 'mls-popup.js'), 'utf8');
const wbConsoleSource = fs.readFileSync(path.join(root, 'feat_mls_wb_console.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const document = {
  readyState: 'loading',
  body: {},
  addEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return []; },
  createElement() { return {}; }
};
const window = {
  document,
  location: { origin: 'https://mlsscribe.com' },
  // Final rows are exposed only when the installed extension advertises both
  // typed final-action and supervised-order capabilities.
  __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true },
  addEventListener() {},
  removeEventListener() {},
  postMessage() {},
  toast() {}
};
window.window = window;
function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; }
const context = {
  window, document, MutationObserver, console,
  setTimeout, clearTimeout, Date, Math, Promise, Object, Array, String, Number,
  RegExp, JSON, Uint32Array
};
vm.createContext(context);
vm.runInContext(flowSource, context);

const manifest = window.__mlsWriteFlow.buildUnifiedManifest({
  patient: { patientId: 'patient-truth-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123' },
  expectedContext: { visitDate: '07/18/2026', provider: 'Example Doctor, MD', appointmentId: 'appt-truth-1' },
  receiptSessionId: 'truth-review-fixed',
  previewHash: 'truth-preview-fixed',
  plan: [
    { kind: 'note', body: 'NOTE TEXT:\nReviewed current-visit note.' },
    { kind: 'billing', body: 'BILLING:\nE/M level: 99214\nCPT: 20610', billing: { emCode: '99214', cptCodes: ['20610'] } },
    {
      kind: 'orders', body: 'Reviewed order payload',
      orderDrafts: [{
        clientOrderId: 'order-truth-1', displayLabel: 'MRI Lumbar spine', query: 'MRI Lumbar spine',
        catalogId: 'athena-catalog-imaging-truth-1', catalogCode: '', type: 'imaging',
        reviewStatus: 'accepted', source: 'provider-entered',
        fields: { study: 'MRI', region: 'Lumbar spine', indication: 'Persistent radicular pain' }
      }],
      orderSuggestions: []
    }
  ]
});

const stageBilling = manifest.rows.find(row => row.id === 'stage-billing');
const signEncounter = manifest.rows.find(row => row.id === 'sign-encounter');
const reviewedOrder = manifest.rows.find(row => row.payload && row.payload.category === 'order' && row.payload.order && row.payload.order.clientOrderId === 'order-truth-1');
const finalRows = [
  [stageBilling, 'stage_billing'],
  [signEncounter, 'sign_encounter'],
  [reviewedOrder, 'place_order']
];
for (const [row, action] of finalRows) {
  assert(row, 'a final-action review payload disappeared from the immutable Athena manifest');
  assert.strictEqual(row.capability, 'ready', `${row.id} must be ready only under the advertised typed capability`);
  assert.strictEqual(row.action, action, `${row.id} lost its exact typed action`);
  const truthCopy = [row.label, row.reason, row.consequence, row.reviewStatus].join(' ');
  assert(/one-click confirm|explicit confirmation/i.test(truthCopy), `${row.id} does not disclose its separate explicit confirmation`);
}
assert.deepStrictEqual(Array.from(stageBilling.payload.billing.cptCodes), ['20610'], 'billing action lost its exact frozen payload');
assert.strictEqual(reviewedOrder.payload.order.fields.indication, 'Persistent radicular pain', 'order action lost its exact frozen payload');
assert(signEncounter.payload.noteText.includes('Reviewed current-visit note.'), 'signing action lost the exact note payload');

const readyActions = Array.from(manifest.rows)
  .filter(row => row.capability === 'ready' && row.action)
  .map(row => row.action)
  .sort();
assert.deepStrictEqual(readyActions, ['place_order', 'save_draft', 'sign_encounter', 'stage_billing', 'write_note'], 'the capable manifest lost or added a supervised typed action');

const startAction = functionBlock(flowSource, 'startAthenaAction');
const probeAt = startAction.indexOf("mode: 'probe'");
assert(startAction.indexOf('final-action-capability-required') >= 0 && startAction.indexOf('final-action-capability-required') < probeAt, 'final actions can probe without the extension capability gate');
assert(startAction.indexOf('verified-note-write-required') >= 0 && startAction.indexOf('verified-note-write-required') < probeAt, 'Sign can probe without a matching verified note-write proof');

// The visible advanced panel must not recreate a bypass around the manual rows.
const enhancePanel = functionBlock(flowSource, 'enhancePanel');
assert(enhancePanel, 'advanced Athena review panel is missing');
assert(!/actionButton\([^)]*['"](?:stage_billing|sign_encounter|place_order)['"]/.test(enhancePanel), 'advanced panel recreated an independent final-action bypass');

// These are the direct/legacy clinical surfaces outside the unified manifest.
// They may show and copy the payload, or focus Athena, but cannot recreate an
// independent write path around the unified proof/identity/token-gated review.
const appClinicalUi = [
  functionBlock(appSource, '_athenaReceiptAction'),
  functionBlock(appSource, '_athenaShowReceipt'),
  functionBlock(appSource, 'pushSuperbillToAthena'),
  functionBlock(appSource, '_athenaOrderPlacementControl'),
  functionBlock(appSource, 'reviewAndPlaceOrderInAthena')
].join('\n');
const consoleSignFlow = functionBlock(wbConsoleSource, 'signSaveFlow');
const consoleLaunchers = functionBlock(wbConsoleSource, 'injectLaunchers');
assert(!/preferredAction\s*:\s*['"](?:stage_billing|sign_encounter|place_order)['"]/.test(appClinicalUi), 'legacy UI independently selects a final action instead of opening the canonical review');
assert(!/startAthenaAction\(\s*['"](?:stage_billing|sign_encounter|place_order)['"]/.test(appClinicalUi), 'legacy UI independently starts a final action around the canonical review');
assert(!/mlsAppSignSave|mlsAppPasteNote|signRunning\s*=\s*true/.test(consoleSignFlow), 'legacy console still contains an independent write/sign fallback');
assert(!/makeSignBtn\(\)|data-mlswbc-sign/.test(consoleLaunchers), 'legacy console still injects a Sign & Save launcher');

// wsg-2.0.0 (MLS Assist 3.0.62, owner directive 2026-08-12): the transport no
// longer refuses billing / sign / order EXECUTE by policy. The production site
// offers those exact typed actions only through its capability, immutable-row,
// identity, proof, probe, and one-use-token gates; the extension pins the LIFT
// explicitly so a stale hop cannot silently re-introduce the old refusal.
for (const source of [contentSource, backgroundSource]) {
  assert(!/write-safety-final-action-blocked/.test(source), 'wsg-2.0.0: an extension hop still carries the lifted final-action policy refusal');
  assert(/wsg-2\.0\.0/.test(source), 'an extension hop lost its wsg-2.0.0 lift note');
  for (const action of ['stage_billing', 'sign_encounter', 'place_order']) {
    assert(source.includes(action), `${action} is missing from the supervised action set`);
  }
}
const wsgSource = fs.readFileSync(path.join(root, 'write_safety_guard.js'), 'utf8');
assert(/var BLOCKED_EXECUTE_ACTIONS = \{\};/.test(wsgSource) && /var VERSION = 'wsg-2\.0\.0';/.test(wsgSource), 'write_safety_guard must be wsg-2.0.0 with an EMPTY blocked-execute map');

console.log('PASS Athena final-action truth: capable production exposes five exact typed actions while final actions remain capability/proof/identity/token gated; wsg-2.0.0 no longer refuses them by policy');
