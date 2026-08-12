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
  // Even the newest extension capability handshake must not turn a final
  // action into an executable row while the worker policy blocks it.
  __mlsExtensionCapabilities: { supervisedOrderPlacementV2: true },
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
const finalRows = [stageBilling, signEncounter, reviewedOrder];
for (const row of finalRows) {
  assert(row, 'a final-action review payload disappeared from the immutable Athena manifest');
  assert.strictEqual(row.capability, 'manual', `${row.id} must be review/manual-only while execute is policy-blocked`);
  assert.strictEqual(row.action, '', `${row.id} still exposes an executable Athena action`);
  const truthCopy = [row.label, row.reason, row.consequence, row.reviewStatus].join(' ');
  assert(/complete in Athena/i.test(truthCopy), `${row.id} is not visibly labeled “Complete in Athena”`);
}
assert.deepStrictEqual(Array.from(stageBilling.payload.billing.cptCodes), ['20610'], 'manual billing review lost its exact frozen payload');
assert.strictEqual(reviewedOrder.payload.order.fields.indication, 'Persistent radicular pain', 'manual order review lost its exact frozen payload');
assert(signEncounter.payload.noteText.includes('Reviewed current-visit note.'), 'manual signing review lost the exact note payload');

const readyActions = Array.from(manifest.rows)
  .filter(row => row.capability === 'ready' && row.action)
  .map(row => row.action)
  .sort();
assert.deepStrictEqual(readyActions, ['save_draft', 'write_note'], 'only write_note and save_draft may remain separately confirmable');
for (const forbiddenAction of ['stage_billing', 'sign_encounter', 'place_order']) {
  assert(!manifest.rows.some(row => row.action === forbiddenAction), `${forbiddenAction} leaked into an executable manifest row`);
}

// The visible advanced panel must not recreate a bypass around the manual rows.
const enhancePanel = functionBlock(flowSource, 'enhancePanel');
assert(enhancePanel, 'advanced Athena review panel is missing');
assert(!/actionButton\([^)]*['"](?:stage_billing|sign_encounter|place_order)['"]/.test(enhancePanel), 'advanced panel still offers an executable final action');

// These are the direct/legacy clinical surfaces outside the unified manifest.
// They may show and copy the payload, or focus Athena, but cannot advertise a
// confirmation that the transport is guaranteed to reject.
const appClinicalUi = [
  functionBlock(appSource, '_athenaReceiptAction'),
  functionBlock(appSource, '_athenaShowReceipt'),
  functionBlock(appSource, 'pushSuperbillToAthena'),
  functionBlock(appSource, '_athenaOrderPlacementControl'),
  functionBlock(appSource, 'reviewAndPlaceOrderInAthena')
].join('\n');
const consoleSignFlow = functionBlock(wbConsoleSource, 'signSaveFlow');
const consoleLaunchers = functionBlock(wbConsoleSource, 'injectLaunchers');
const visibleClinicalCopy = [flowSource, appSource, connectSource, popupSource, consoleSignFlow].join('\n');
const forbiddenClaims = [
  [/Sign\s*(?:&|&amp;|and)\s*Save[^.\n]{0,180}\bunlock/i, 'Sign unlock claim'],
  [/\bSign unlocks\b/i, 'Sign unlock claim'],
  [/locked until (?:this receipt )?(?:verifies|write)/i, 'locked-until-write Sign claim'],
  [/Review Sign\s*(?:&|&amp;|and)\s*Save separately/i, 'executable Sign review offer'],
  [/Confirm\s*(?:&amp;|&)?\s*place one (?:reviewed )?order/i, 'executable order confirmation'],
  [/Review\s*&amp;\s*place in Athena/i, 'executable order CTA'],
  [/Nothing is placed until you press Confirm/i, 'order execution promise'],
  [/Add confirmed billing codes to Athena/i, 'executable billing CTA'],
  [/Check Athena\s*&amp;\s*confirm billing/i, 'executable billing CTA'],
  [/Confirm stage billing codes/i, 'executable billing confirmation'],
  [/Final confirmation stages exact codes/i, 'billing execution promise'],
  [/Sign unlocks there only after/i, 'guide claims Sign unlocks']
];
for (const [pattern, label] of forbiddenClaims) {
  assert(!pattern.test(visibleClinicalCopy), `${label} remains in clinician-facing UI or guidance`);
}
assert(!/preferredAction\s*:\s*['"](?:stage_billing|sign_encounter|place_order)['"]/.test(appClinicalUi), 'legacy UI still selects a blocked final action for confirmation');
assert(!/startAthenaAction\(\s*['"](?:stage_billing|sign_encounter|place_order)['"]/.test(appClinicalUi), 'legacy UI still starts a blocked final action');
assert(!/mlsAppSignSave|mlsAppPasteNote|signRunning\s*=\s*true/.test(consoleSignFlow), 'legacy console still contains an independent write/sign fallback');
assert(!/makeSignBtn\(\)|data-mlswbc-sign/.test(consoleLaunchers), 'legacy console still injects a Sign & Save launcher');

// Keep the UI contract aligned with the existing defense-in-depth transport
// policy. Probe/review may remain; execute must be refused in both hops.
for (const source of [contentSource, backgroundSource]) {
  assert(/write-safety-final-action-blocked/.test(source), 'final-action policy refusal disappeared from an extension hop');
  for (const action of ['stage_billing', 'sign_encounter', 'place_order']) {
    assert(source.includes(action), `${action} is missing from the explicit final-action refusal`);
  }
}

console.log('PASS Athena final-action truth: billing, signing, and orders stay visible as exact manual payloads labeled Complete in Athena; only note write/save can confirm');
