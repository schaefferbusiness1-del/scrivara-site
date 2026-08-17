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

for (const src of [flow, content, background]) assert(src.includes('place_order'), 'place_order review/refusal policy is missing from one hop');
const clickGate = between(content, '/* ATHENA_ACTION_V2_CLICK_GATE_START */', '/* ATHENA_ACTION_V2_CLICK_GATE_END */');
assert(/isTrusted\s*!==\s*true/.test(clickGate), 'note-lane mutation gate lost its trusted-click requirement');
/* wsg-2.0.0 (MLS Assist 3.0.62): the trusted-click gate arms every supervised
   action from ITS OWN confirm button - place_order included - and advertises
   athenaFinalActionsV1 so the 1p site turns its order rows into typed rows. */
assert(/\^\(write_note\|save_draft\|stage_billing\|sign_encounter\|place_order\)\$/.test(clickGate), 'trusted-click gate must arm every supervised action (wsg-2.0.0), place_order included');
assert(!/\^\(write_note\|save_draft\)\$/.test(clickGate), 'the wsg-1.0.0 note-only arm list must be gone');
const capabilityObject = /capabilities:\s*\{([^}]*)\}/.exec(content);
assert(capabilityObject && /supervisedOrderPlacementV2:\s*true/.test(capabilityObject[1]), 'current extension does not explicitly advertise the supervised-order capability');
assert(capabilityObject && /destinationTeachingV2:\s*true/.test(capabilityObject[1]), 'current extension does not explicitly advertise exact destination teaching');
assert(capabilityObject && /athenaFinalActionsV1:\s*true/.test(capabilityObject[1]), 'wsg-2.0.0 extension must advertise athenaFinalActionsV1 in the pong');
assert(/arm\.rowHash\s*===\s*orderRowHash/.test(content) && /arm\.clientOrderId\s*===\s*orderClientOrderId/.test(content), 'trusted-click arm is not bound to the exact order row and local order ID');
assert(/gestureRowHash/.test(content) && /gestureClientOrderId/.test(content), 'worker request loses the trusted-click row binding');
assert(/rawFields\[key\]\.length\s*>\s*2000/.test(content) && !/fields\[key\]\s*=\s*mlsStr\([^\n]*2000/.test(content), 'content bridge still silently truncates reviewed order details');
const actionLabelSource = extractFunction(clickGate, '_mlsActionLabelMatches');
const actionLabelMatches = Function(`${actionLabelSource}; return _mlsActionLabelMatches;`)();
assert.strictEqual(actionLabelMatches('place_order', 'Confirm & place one order'), true, 'dormant label parser fixture drifted');
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
assert(!/Confirm place one reviewed order/.test(flow), 'order placement confirmation copy is still visible');
assert(!/Confirm\s*&amp;\s*place one order|Confirm & place one order/.test(flow), 'single-order execute button is still visible');
assert(/Complete in Athena/.test(flow) && /MLS (?:keeps[^.]+visible, but never selects or places|does not place)/.test(flow), 'manual order review copy is missing');

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
let liveAthenaTabs = [{ id: 91, url: 'https://athenanet.athenahealth.com/encounter/77777' }];
let probeInjectionTabIds = [];
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
    runtime: { id: 'mls-test-extension', /* csr-1.x orphan guards treat an id-less runtime as a dead context */ onMessage: { addListener(fn) { listener = fn; } } },
    tabs: { async query() { return liveAthenaTabs.map(tab => ({ ...tab })); } },
    scripting: { async executeScript(details) {
      const req = details.args[0];
      if (req.mode === 'probe') probeInjectionTabIds.push(details.target.tabId);
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

  // RELEASED 3.0.0 (accepted 2.9.43 core): the order lane has no pinned-tab
  // continuation — that was part of the REJECTED 2.9.44 exact-encounter
  // verifier. Two same-URL Athena tabs are an ambiguity the generic all-tab
  // gate must refuse, and an advisory expectedAthenaTabId field must NEVER
  // manufacture confidence the released bytes cannot verify.
  liveAthenaTabs = [
    { id: 91, url: lockedContext.encounterUrl },
    { id: 92, url: lockedContext.encounterUrl }
  ];
  probeInjectionTabIds = [];
  const pinnedTabProbe = await send({ ...probeMessage, expectedAthenaTabId: 91 });
  assert.notStrictEqual(pinnedTabProbe.ok, true, 'an advisory tab pin must not bypass the released ambiguity gate');
  probeInjectionTabIds = [];
  const unpinnedGenericProbe = await send({ ...probeMessage });
  assert.strictEqual(unpinnedGenericProbe.reason, 'ambiguous-athena-tabs', 'generic probe no longer scans every signed-in Athena tab');
  assert.deepStrictEqual(probeInjectionTabIds, [91, 92], 'generic probe did not preserve all-tab unique discovery');
  liveAthenaTabs = [{ id: 91, url: lockedContext.encounterUrl }];
  probeInjectionTabIds = [];

  /* wsg-2.0.0 (MLS Assist 3.0.62, owner directive 2026-08-12): the wsg-1.0.0
     preview-only refusal for order placement is LIFTED. This block is the
     ORIGINAL (pre-wsg-1.0.0) supervised single-order contract restored verbatim
     from 98441b16^: stale-token invalidation, execute-time payload/row/client-id
     tamper refusals, wrong-patient refusal, action-exact trusted click, ONE
     verified isolated placement with immutable audit ids, replay refusal, and
     encounter-only authorization. Every refusal here is a CORRECTNESS gate that
     survives the policy lift. */
  const rowA = { ...exactOrder, clientOrderId: 'local-order-a' };
  const rowB = { ...exactOrder, clientOrderId: 'local-order-b' };
  const pA = await send({ ...probeMessage, order: rowA, rowHash: 'row-hash-a', clientOrderId: rowA.clientOrderId });
  const pB = await send({ ...probeMessage, order: rowB, rowHash: 'row-hash-b', clientOrderId: rowB.clientOrderId });
  assert(pA.ok && pB.ok, 'independent row probes were not minted');
  const staleA = await send({
    ...probeMessage, mode: 'execute', actionToken: pA.actionToken, order: rowA, rowHash: 'row-hash-a', clientOrderId: rowA.clientOrderId,
    expectedContext: { ...probeMessage.expectedContext },
    probeContext: { ...lockedContext }, userGesture: true, gestureProof: 'trusted-row-a', gestureRowHash: 'row-hash-a', gestureClientOrderId: rowA.clientOrderId
  });
  assert.strictEqual(staleA.reason, 'token-used', 'a newer row probe did not invalidate the older same-manifest order token');

  const p1 = await send(probeMessage);
  assert(p1.ok && p1.actionToken && p1.readOnly, 'order probe did not return a read-only one-use token');
  assert.strictEqual(p1.rowHash, probeMessage.rowHash, 'probe did not echo its exact immutable row binding');
  assert.strictEqual(p1.clientOrderId, exactOrder.clientOrderId, 'probe did not echo its exact local order ID');
  const executeBase = {
    ...probeMessage, mode: 'execute', actionToken: p1.actionToken, expectedContext: { ...probeMessage.expectedContext },
    probeContext: { ...lockedContext }, userGesture: true, gestureProof: 'trusted-click-1',
    gestureRowHash: probeMessage.rowHash, gestureClientOrderId: exactOrder.clientOrderId
  };
  const tampered = await send({ ...executeBase, order: { ...exactOrder, query: 'CT Lumbar spine' } });
  assert.strictEqual(tampered.reason, 'order-payload-mismatch', 'execute-time order tamper was not rejected');
  const tamperReplay = await send(executeBase);
  assert.strictEqual(tamperReplay.reason, 'token-used', 'tampered execute did not consume its token');

  const p2 = await send(probeMessage);
  const wrongPatient = await send({ ...executeBase, actionToken: p2.actionToken, expectedPatient: { ...patient, patientId: 'different-local-patient' }, gestureProof: 'trusted-click-2' });
  assert.strictEqual(wrongPatient.reason, 'patient-mismatch', 'wrong local patient binding was accepted');

  const p3 = await send(probeMessage);
  const rowTamper = await send({ ...executeBase, actionToken: p3.actionToken, rowHash: 'different-row-hash', gestureProof: 'trusted-click-row-tamper', gestureRowHash: 'different-row-hash' });
  assert.strictEqual(rowTamper.reason, 'order-row-mismatch', 'execute-time row swap was accepted');

  const p4 = await send(probeMessage);
  const clientTamper = await send({ ...executeBase, actionToken: p4.actionToken, clientOrderId: 'different-client-order', gestureProof: 'trusted-click-client-tamper', gestureClientOrderId: 'different-client-order' });
  assert.strictEqual(clientTamper.reason, 'order-client-id-mismatch', 'execute-time local order ID swap was accepted');

  const p5 = await send(probeMessage);
  const gestureTamper = await send({ ...executeBase, actionToken: p5.actionToken, gestureProof: 'trusted-click-wrong-row', gestureRowHash: 'wrong-gesture-row' });
  assert.strictEqual(gestureTamper.reason, 'fresh-trusted-click-required', 'a trusted click armed for another row was accepted');

  const p6 = await send(probeMessage);
  const success = await send({ ...executeBase, actionToken: p6.actionToken, gestureProof: 'trusted-click-3' });
  assert.strictEqual(success.ok, true);
  assert.strictEqual(success.orderPlaced, true);
  assert.strictEqual(success.patientId, patient.patientId, 'result lost immutable local patient audit ID');
  assert.strictEqual(success.clientOrderId, exactOrder.clientOrderId, 'result lost immutable local order audit ID');
  assert.strictEqual(success.rowHash, probeMessage.rowHash, 'result lost immutable order-row audit hash');
  assert.strictEqual(success.noAutomaticChaining, 'no-automatic-chaining');
  const replay = await send({ ...executeBase, actionToken: p6.actionToken, gestureProof: 'trusted-click-4' });
  assert.strictEqual(replay.reason, 'token-used', 'successful order token was replayable');

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
  const encounterSuccess = await send({
    ...encounterProbeMessage, mode: 'execute', actionToken: encounterProbe.actionToken,
    probeContext: { ...lockedContext }, userGesture: true, gestureProof: 'trusted-encounter-only',
    gestureRowHash: encounterProbeMessage.rowHash, gestureClientOrderId: encounterOrder.clientOrderId
  });
  assert.strictEqual(encounterSuccess.ok, true, 'probe-discovered appointment ID incorrectly invalidated encounter-only authorization');

  console.log('PASS Athena single-order runtime (wsg-2.0.0): exact catalog/control, isolated readback, wrong-patient/tamper/replay gates, immutable audit IDs, and no chaining - the policy refusal is lifted, every correctness gate stands');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
