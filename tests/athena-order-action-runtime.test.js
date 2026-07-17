'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const flow = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing ${end}`);
  return source.slice(a + begin.length, b);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const driver = between(background, '/* ATHENA_ACTION_V2_DRIVER_START */', '/* ATHENA_ACTION_V2_DRIVER_END */');
const place = between(driver, '/* ATHENA_ACTION_V2_PLACE_ORDER_START */', '/* ATHENA_ACTION_V2_PLACE_ORDER_END */');
const helpersSource = between(driver, '/* ATHENA_ACTION_V2_ORDER_HELPERS_START */', '/* ATHENA_ACTION_V2_ORDER_HELPERS_END */');
const handlerSource = '/* ATHENA_ACTION_V2_HANDLER_START */' + between(background, '/* ATHENA_ACTION_V2_HANDLER_START */', '/* ATHENA_ACTION_V2_HANDLER_END */');

for (const src of [flow, content, background]) assert(src.includes('place_order'), 'place_order is not bound end-to-end');
const clickGate = between(content, '/* ATHENA_ACTION_V2_CLICK_GATE_START */', '/* ATHENA_ACTION_V2_CLICK_GATE_END */');
assert(/isTrusted\s*!==\s*true/.test(clickGate) && /place_order/.test(clickGate), 'single-order execute is not gated by a real trusted click');
const capabilityObject = /capabilities:\s*\{([^}]*)\}/.exec(content);
assert(capabilityObject && /supervisedOrderPlacementV2:\s*true/.test(capabilityObject[1]), 'current extension does not explicitly advertise the supervised-order capability');
assert(capabilityObject && /destinationTeachingV2:\s*true/.test(capabilityObject[1]), 'current extension does not explicitly advertise exact destination teaching');
assert(/arm\.rowHash\s*===\s*orderRowHash/.test(content) && /arm\.clientOrderId\s*===\s*orderClientOrderId/.test(content), 'trusted-click arm is not bound to the exact order row and local order ID');
assert(/gestureRowHash/.test(content) && /gestureClientOrderId/.test(content), 'worker request loses the trusted-click row binding');
assert(/rawFields\[key\]\.length\s*>\s*2000/.test(content) && !/fields\[key\]\s*=\s*mlsStr\([^\n]*2000/.test(content), 'content bridge still silently truncates reviewed order details');
const actionLabelSource = extractFunction(clickGate, '_mlsActionLabelMatches');
const actionLabelMatches = Function(`${actionLabelSource}; return _mlsActionLabelMatches;`)();
assert.strictEqual(actionLabelMatches('place_order', 'Confirm & place one order'), true, 'visible human-permission label does not arm place_order');
assert.strictEqual(actionLabelMatches('place_order', 'Place Order'), false, 'an Athena DOM button could arm the MLS execute bridge without its confirmation label');
for (const reason of [
  'order-catalog-near-match-rejected', 'order-catalog-duplicate-rejected',
  'order-place-control-missing', 'order-place-control-duplicate-rejected',
  'order-unrelated-row-change', 'order-exact-already-present',
  'one-exact-order-isolated-readback-verified'
]) assert(driver.includes(reason), `driver is missing ${reason}`);
assert.strictEqual((place.match(/placeDecision\.item\.click\(\)/g) || []).length, 1, 'one order action may click only one final Place/Add Order control');
assert(!/for\s*\([^)]*order/i.test(place.split('placeDecision.item.click()')[1] || ''), 'order placement appears to chain another order after the final action');
assert(place.indexOf('mutationAttempted = true') >= 0 && place.indexOf('mutationAttempted = true') < place.indexOf('candidate.option.click()'), 'catalog selection is not treated as the first order mutation boundary');
assert(/uncertainOrderMutation\('order-required-field-missing'|uncertainOrderMutation\(fieldHit\.error/.test(place) && /partialMutation:\s*true/.test(place), 'post-selection failures can still claim that nothing was attempted');
for (const word of ['save', 'sign', 'submit', 'prescribe', 'billing', 'claim', 'delete']) assert(driver.toLowerCase().includes(word), `final-action denylist omits ${word}`);
assert(/Confirm place one reviewed order/.test(flow), 'human permission copy is missing');
assert(/Confirm\s*&amp;\s*place one order|Confirm & place one order/.test(flow), 'visible single-order confirmation button is missing');

// Exercise exact catalog identity and isolated readback helpers with adversarial
// candidate/row shapes. Missing, near, and duplicate candidates never become a
// unique exact selection.
const text = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const norm = v => text(v).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const uniqueBy = (values, keyFn) => {
  const out = [], seen = new Set();
  for (const value of values) { const key = keyFn(value); if (key && !seen.has(key)) { seen.add(key); out.push(value); } }
  return out;
};
const deepQueryAll = el => (el && el.descendants) || [];
const elementAttributes = el => Object.entries((el && el.attrs) || {});
const helperFactory = Function('text', 'norm', 'uniqueBy', 'deepQueryAll', 'elementAttributes', 'label', 'hit', 'visible', 'deepContains', 'collapseContainedMatches', 'controlFingerprint', 'closestAcrossRoots', 'collapseToOutermostMatches', 'setField', 'sleep', `
  ${helpersSource}
  return { exactCatalogOrderElement, exactPlacedOrderElement, exactOrderElement, sameOrderRows, verifiedIsolatedOrderAdd, oneExactOrderChoice, existingExactOrderDecision };
`);
const helper = helperFactory(text, norm, uniqueBy, deepQueryAll, elementAttributes, el => text(el && el.textContent), { frame: { doc: {}, w: {} } }, () => true, () => true, v => v, () => 'fp', () => null, v => v, () => {}, async () => {});
function el(label, attrs = {}) {
  return {
    tagName: 'DIV', textContent: label, attrs, descendants: [], value: attrs.value || '', name: attrs.name || '', id: attrs.id || '',
    getAttribute(name) { return this.attrs[name] || ''; }
  };
}
const exactOrder = {
  clientOrderId: 'local-order-1', type: 'imaging', displayLabel: 'MRI Lumbar spine',
  catalogCode: '', catalogId: 'athena-catalog-imaging-17', query: 'MRI Lumbar spine',
  fields: { study: 'MRI', region: 'Lumbar spine', indication: 'Persistent radicular pain' },
  reviewStatus: 'accepted', source: 'provider-entered'
};
const exactCandidate = el('MRI Lumbar spine', { role: 'option', 'data-display-label': 'MRI Lumbar spine', 'data-catalog-id': exactOrder.catalogId });
const nearCandidate = el('MRI Lumbar spine without contrast', { role: 'option', 'data-display-label': 'MRI Lumbar spine without contrast', 'data-catalog-id': exactOrder.catalogId });
assert.strictEqual(helper.exactCatalogOrderElement(exactCandidate, exactOrder), true, 'exact durable catalog label/id was rejected');
assert.strictEqual(helper.exactCatalogOrderElement(nearCandidate, exactOrder), false, 'near catalog label was accepted');
assert.strictEqual(helper.exactCatalogOrderElement(el('MRI Lumbar spine', { role: 'option' }), exactOrder), false, 'label-only catalog candidate was accepted without durable identity');
assert.strictEqual([nearCandidate].filter(x => helper.exactCatalogOrderElement(x, exactOrder)).length, 0, 'missing/near candidate did not fail closed');
const duplicateCandidates = [exactCandidate, el('MRI Lumbar spine', { role: 'option', 'data-display-label': 'MRI Lumbar spine', 'data-catalog-id': exactOrder.catalogId })].filter(x => helper.exactCatalogOrderElement(x, exactOrder));
assert.strictEqual(duplicateCandidates.length, 2, 'duplicate exact candidate fixture is invalid');
assert.strictEqual(helper.oneExactOrderChoice([], 'order-catalog-near-match-rejected', 'order-catalog-duplicate-rejected').reason, 'order-catalog-near-match-rejected');
assert.strictEqual(helper.oneExactOrderChoice(duplicateCandidates, 'order-catalog-near-match-rejected', 'order-catalog-duplicate-rejected').reason, 'order-catalog-duplicate-rejected');
assert.strictEqual(helper.oneExactOrderChoice([exactCandidate], 'missing', 'duplicate').item, exactCandidate);
const coded = { ...exactOrder, catalogCode: 'IMG-MR-LSP' };
assert.strictEqual(helper.exactCatalogOrderElement(el('MRI Lumbar spine IMG-MR-LSP', { 'data-display-label': 'MRI Lumbar spine', 'data-catalog-id': exactOrder.catalogId, 'data-catalog-code': 'IMG-MR-LSP' }), coded), true, 'exact label+code candidate was rejected');
assert.strictEqual(helper.exactCatalogOrderElement(el('MRI Lumbar spine IMG-MR-LSPX', { 'data-display-label': 'MRI Lumbar spine', 'data-catalog-id': exactOrder.catalogId, 'data-catalog-code': 'IMG-MR-LSPX' }), coded), false, 'near catalog code was accepted');

function placedRow(fields) {
  const root = el('MRI Lumbar spine placed order', { 'data-display-label': 'MRI Lumbar spine', 'data-catalog-id': exactOrder.catalogId });
  root.descendants = Object.entries(fields).map(([key, value]) => el('', { 'data-order-field': key, 'data-value': value }));
  return root;
}
assert.strictEqual(helper.exactOrderElement(placedRow(exactOrder.fields), exactOrder), true, 'full exact structured placed-order readback was rejected');
assert.strictEqual(helper.exactOrderElement(placedRow({ ...exactOrder.fields, indication: 'Different indication' }), exactOrder), false, 'same catalog item with different structured details was falsely verified');
assert.strictEqual(helper.exactOrderElement(placedRow({ study: 'MRI', region: 'Lumbar spine' }), exactOrder), false, 'same catalog item with a missing structured field was falsely verified');
const duplicateFieldRow = placedRow(exactOrder.fields);
duplicateFieldRow.descendants.push(el('', { 'data-order-field': 'indication', 'data-value': exactOrder.fields.indication }));
assert.strictEqual(helper.exactOrderElement(duplicateFieldRow, exactOrder), false, 'duplicate structured field controls were collapsed into a false exact readback');

const before = [{ state: 'row-a', exact: false }, { state: 'row-b', exact: false }];
assert.strictEqual(helper.verifiedIsolatedOrderAdd(before, [...before, { state: 'row-new', exact: true }]), true, 'one isolated exact order addition was not verified');
assert.strictEqual(helper.verifiedIsolatedOrderAdd(before, [{ state: 'row-a-changed', exact: false }, before[1], { state: 'row-new', exact: true }]), false, 'an unrelated row change was accepted');
assert.strictEqual(helper.verifiedIsolatedOrderAdd(before, [...before, { state: 'row-new', exact: true }, { state: 'row-other', exact: false }]), false, 'two new rows were accepted');
assert.strictEqual(helper.verifiedIsolatedOrderAdd([{ state: 'existing', exact: true }], [{ state: 'existing', exact: true }, { state: 'duplicate', exact: true }]), false, 'an existing exact order was duplicated');
assert.strictEqual(helper.existingExactOrderDecision([]).alreadyPresent, false);
assert.strictEqual(helper.existingExactOrderDecision([{ state: 'existing', exact: true }]).alreadyPresent, true, 'exact already-present order was not recognized');
assert.strictEqual(helper.existingExactOrderDecision([{ exact: true }, { exact: true }]).reason, 'order-existing-duplicate-rejected', 'duplicate existing exact orders were not rejected');

const exactPlaceSource = extractFunction(driver, 'exactPlaceOrder');
const controlMatchers = Function('norm', 'label', 'labelSources', `${exactPlaceSource}; return exactPlaceOrder;`)(norm, x => text(x.label), x => [text(x.label)]);
assert.strictEqual(controlMatchers({ label: 'Place Order' }), true);
assert.strictEqual(controlMatchers({ label: 'Add Order' }), true);
for (const bad of ['Place Orders', 'Add another order', 'Save', 'Sign & Save', 'Submit Order', 'Prescribe', 'Yes', 'Continue']) assert.strictEqual(controlMatchers({ label: bad }), false, `unsafe/wrong final control accepted: ${bad}`);
assert.strictEqual(helper.oneExactOrderChoice([], 'order-place-control-missing', 'order-place-control-duplicate-rejected').reason, 'order-place-control-missing');
assert.strictEqual(helper.oneExactOrderChoice([{ label: 'Place Order' }, { label: 'Add Order' }], 'order-place-control-missing', 'order-place-control-duplicate-rejected').reason, 'order-place-control-duplicate-rejected');

// Run the worker authorization contract with a fake Athena driver. This tests
// wrong-patient binding, complete-payload tamper detection, one-use replay,
// and the immutable audit IDs independently of DOM fixtures.
let listener = null;
let tokenCounter = 0;
const lockedContext = {
  patientName: 'Example Patient', dob: '1/2/1980', mrn: '12345', appointmentId: '54321', encounterId: '77777',
  encounterUrl: 'https://athenanet.athenahealth.com/encounter/77777', visitDate: '7/14/2026',
  provider: 'Example Doctor MD', framePath: 'top.0', encounterRootFingerprint: 'root-fp',
  controlFingerprint: 'search-fp', noteScopeFingerprint: 'orders-fp',
  actionContainerFingerprint: 'orders-fp', editorFingerprint: 'search-fp', contextHash: 'context-fp',
  controlLabel: 'Athena Orders catalog search'
};
const handlerContext = {
  self: {}, URL, Date, Math, JSON, Object, Array, String, Number, RegExp, Uint32Array,
  crypto: { getRandomValues(a) { tokenCounter++; for (let i = 0; i < a.length; i++) a[i] = tokenCounter * 100 + i; return a; } },
  mlsAthTabHost: () => 'athenanet.athenahealth.com', mlsAthIsLoginish: () => false,
  mlsAthenaActionV2DriverFn() {},
  chrome: {
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    tabs: { async query() { return [{ id: 91, url: lockedContext.encounterUrl }]; } },
    scripting: { async executeScript(details) {
      const req = details.args[0];
      return [{ result: req.mode === 'probe'
        ? { ok: true, contextVerified: true, readOnly: true, reason: 'order-workspace-context-verified', context: { ...lockedContext } }
        : { ok: true, verified: true, orderPlaced: true, alreadyPresent: false, reason: 'one-exact-order-isolated-readback-verified', context: { ...lockedContext } } }];
    } }
  }
};
vm.createContext(handlerContext);
/* wsg-1.0.0: the shipped service worker importScripts write_safety_guard.js
   before this handler — the simulation must match, or every order execute
   reports the (also valid, fail-closed) 'write-safety-guard-missing'. */
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'write_safety_guard.js'), 'utf8'), handlerContext);
handlerContext.self.MLSWriteSafety = handlerContext.MLSWriteSafety;
vm.runInContext(handlerSource, handlerContext);
assert.strictEqual(typeof listener, 'function', 'typed action handler did not wire');
const sender = { tab: { id: 44, url: 'https://mlsscribe.com/ScribeFlow.html' } };
const patient = { name: 'Example Patient', dob: '01/02/1980', mrn: '12345', patientId: 'local-patient-7' };
const probeMessage = {
  type: 'mlsAppAthenaActionV2Request', mode: 'probe', action: 'place_order', previewHash: 'preview-order-7',
  expectedPatient: patient, expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor MD', appointmentId: '54321' },
  order: exactOrder, rowHash: 'row-hash-order-1', clientOrderId: exactOrder.clientOrderId,
  noteText: '', notePolicy: 'empty_only', billing: {}, sections: []
};
function send(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ret = listener(message, sender, value => { settled = true; resolve(value); });
    if (ret !== true && !settled) reject(new Error('handler did not keep the response channel open'));
  });
}

(async () => {
  const missingLocal = await send({ ...probeMessage, expectedPatient: { ...patient, patientId: '' } });
  assert.strictEqual(missingLocal.reason, 'local-patient-id-required');

  const missingCatalog = await send({ ...probeMessage, order: { ...exactOrder, catalogId: '', catalogCode: '' } });
  assert.strictEqual(missingCatalog.reason, 'catalog-identity-required', 'label-only order payload was not rejected');
  const overlongField = await send({ ...probeMessage, order: { ...exactOrder, fields: { ...exactOrder.fields, indication: 'x'.repeat(2001) } } });
  assert.strictEqual(overlongField.reason, 'order-field-too-long', 'overlong order field was truncated or accepted');

  /* wsg-1.0.0 CONTRACT CHANGE (owner directive): order placement is
     PREVIEW-ONLY. Probes still mint read-only tokens with exact row bindings
     so the review screen can show where an order WOULD go — but EVERY execute
     attempt, tampered or pristine, is refused by the write-safety gate before
     token or mutation logic runs. The deep tamper/replay machinery below the
     gate remains in the source (probe-side row invalidation still runs) but
     is unreachable for orders while the policy stands. */
  const rowA = { ...exactOrder, clientOrderId: 'local-order-a' };
  const rowB = { ...exactOrder, clientOrderId: 'local-order-b' };
  const pA = await send({ ...probeMessage, order: rowA, rowHash: 'row-hash-a', clientOrderId: rowA.clientOrderId });
  const pB = await send({ ...probeMessage, order: rowB, rowHash: 'row-hash-b', clientOrderId: rowB.clientOrderId });
  assert(pA.ok && pB.ok, 'independent row probes were not minted');
  assert(pA.readOnly && pB.readOnly, 'order probes must stay read-only');
  const staleA = await send({
    ...probeMessage, mode: 'execute', actionToken: pA.actionToken, order: rowA, rowHash: 'row-hash-a', clientOrderId: rowA.clientOrderId,
    expectedContext: { ...probeMessage.expectedContext },
    probeContext: { ...lockedContext }, userGesture: true, gestureProof: 'trusted-row-a', gestureRowHash: 'row-hash-a', gestureClientOrderId: rowA.clientOrderId
  });
  assert.strictEqual(staleA.blocked, true, 'order execute was not refused');
  assert.strictEqual(staleA.reason, 'write-safety-final-action-blocked', 'order execute must be refused by the write-safety policy gate');
  assert(!staleA.orderPlaced, 'a blocked order execute must never report placement');

  const p1 = await send(probeMessage);
  assert(p1.ok && p1.actionToken && p1.readOnly, 'order probe did not return a read-only one-use token');
  assert.strictEqual(p1.rowHash, probeMessage.rowHash, 'probe did not echo its exact immutable row binding');
  assert.strictEqual(p1.clientOrderId, exactOrder.clientOrderId, 'probe did not echo its exact local order ID');
  const executeBase = {
    ...probeMessage, mode: 'execute', actionToken: p1.actionToken, expectedContext: { ...probeMessage.expectedContext },
    probeContext: { ...lockedContext }, userGesture: true, gestureProof: 'trusted-click-1',
    gestureRowHash: probeMessage.rowHash, gestureClientOrderId: exactOrder.clientOrderId
  };
  /* pristine, tampered, wrong-patient, row-swapped, replayed — ALL refused by
     the same policy gate, and none may report placement */
  for (const [label, attempt] of [
    ['pristine', executeBase],
    ['payload-tampered', { ...executeBase, order: { ...exactOrder, query: 'CT Lumbar spine' } }],
    ['wrong-patient', { ...executeBase, expectedPatient: { ...patient, patientId: 'different-local-patient' } }],
    ['row-swapped', { ...executeBase, rowHash: 'different-row-hash', gestureRowHash: 'different-row-hash' }],
    ['client-id-swapped', { ...executeBase, clientOrderId: 'different-client-order', gestureClientOrderId: 'different-client-order' }],
    ['gesture-tampered', { ...executeBase, gestureProof: 'trusted-click-wrong-row', gestureRowHash: 'wrong-gesture-row' }]
  ]) {
    const refused = await send(attempt);
    assert.strictEqual(refused.blocked, true, label + ' order execute was not refused');
    assert.strictEqual(refused.reason, 'write-safety-final-action-blocked', label + ' order execute bypassed the policy gate');
    assert(!refused.orderPlaced && refused.ok !== true, label + ' order execute reported success');
  }
  /* the refusal must not corrupt probe availability for the same manifest */
  const pAgain = await send(probeMessage);
  assert(pAgain.ok && pAgain.readOnly, 'blocked executes corrupted subsequent probes');

  const encounterOrder = { ...exactOrder, clientOrderId: 'local-order-encounter-only' };
  const encounterContext = {
    visitDate: lockedContext.visitDate, provider: lockedContext.provider,
    encounterId: lockedContext.encounterId, encounterUrl: lockedContext.encounterUrl
  };
  const encounterProbeMessage = {
    ...probeMessage, previewHash: 'preview-order-encounter-only', expectedContext: encounterContext,
    order: encounterOrder, rowHash: 'row-hash-encounter-only', clientOrderId: encounterOrder.clientOrderId
  };
  const encounterProbe = await send(encounterProbeMessage);
  assert(encounterProbe.ok, 'encounter-only exact context could not be probed');
  const encounterExecute = await send({
    ...encounterProbeMessage, mode: 'execute', actionToken: encounterProbe.actionToken,
    probeContext: { ...lockedContext }, userGesture: true, gestureProof: 'trusted-encounter-only',
    gestureRowHash: encounterProbeMessage.rowHash, gestureClientOrderId: encounterOrder.clientOrderId
  });
  assert.strictEqual(encounterExecute.reason, 'write-safety-final-action-blocked', 'encounter-only order execute bypassed the policy gate');

  console.log('PASS Athena single-order runtime: exact catalog/control, read-only probes with immutable row bindings, and EVERY order execute (pristine or tampered) refused by the write-safety policy gate');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
