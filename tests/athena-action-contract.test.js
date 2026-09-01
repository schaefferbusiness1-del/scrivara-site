'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const writeflow = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing start marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

function beforeMutation(source, needle, mutationNeedle) {
  const gate = source.indexOf(needle);
  assert(gate >= 0, `missing pre-mutation gate: ${needle}`);
  const mutation = source.indexOf(mutationNeedle);
  assert(mutation >= 0, `missing mutation boundary: ${mutationNeedle}`);
  assert(gate < mutation, `${needle} must be checked before ${mutationNeedle}`);
}

/*
 * This is deliberately a separate, narrow capability from mlsAppWriteV2.
 * Generic AI/autopilot routes remain unable to Save, Sign, bill, or place an
 * order. wsg-2.0.0 (MLS Assist 3.0.62, owner directive 2026-08-12): every
 * supervised V2 action (write_note, save_draft, stage_billing, sign_encounter,
 * place_order) can receive a trusted-click arm from ITS OWN confirm button; the
 * production site (feat_mls_writeflow.js) exposes all five only through the
 * extension-capability, exact-context, proof, and one-use-token gates below.
 */
assert(/mlsAppAthenaActionV2\s*:\s*1/.test(content), 'the typed Athena action must be origin-gated by the content bridge');

const appActions = between(writeflow, '/* ---------------- explicit Athena actions', '/* ---- identity helpers');
for (const action of ['write_note', 'save_draft', 'stage_billing', 'sign_encounter', 'place_order']) assert(appActions.includes(action), `app policy metadata must name ${action}`);
assert(/ATHENA_EXECUTABLE_ACTIONS\s*=\s*\{\s*write_note\s*:\s*true\s*,\s*save_draft\s*:\s*true\s*,\s*stage_billing\s*:\s*true\s*,\s*sign_encounter\s*:\s*true\s*,\s*place_order\s*:\s*true\s*\}/.test(appActions), 'app executable allowlist must contain the five supervised typed actions');
const appProbeStart = appActions.indexOf('function startAthenaAction(action, opts)');
assert(appProbeStart >= 0);
const appProbe = appActions.slice(appProbeStart);
const capabilityRefusalAt = appProbe.indexOf('final-action-capability-required');
const signProofRefusalAt = appProbe.indexOf('verified-note-write-required');
const bridgeProbeAt = appProbe.indexOf("mode: 'probe'");
assert(capabilityRefusalAt >= 0 && bridgeProbeAt > capabilityRefusalAt, 'final actions must be refused before probe unless the extension advertises the typed capability');
assert(signProofRefusalAt >= 0 && bridgeProbeAt > signProofRefusalAt, 'Sign must be refused before probe without an exact verified note-write proof');
assert(appProbe.indexOf("mode: 'probe'") < appProbe.indexOf('showActionConfirm('), 'opening the action must probe read-only before showing confirmation');
assert(appProbe.includes('previewHash'));
const appConfirm = between(appActions, 'function showActionConfirm(action, opts, patient, previewHash, payload, probe)', 'function startAthenaAction(action, opts)');
assert(appConfirm.includes("mode: 'execute'"), 'only the confirmation button may request execution');
assert(appConfirm.includes('actionToken'));
for (const label of ['Patient', 'DOB', 'MRN', 'Encounter date', 'Provider', 'Athena control', 'Consequence:']) {
  assert(appConfirm.includes(label), `confirmation must show ${label}`);
}
assert(/setAttribute\(['"]data-mls-athena-action['"],\s*action\)/.test(appConfirm));
assert(/setAttribute\(['"]data-mls-preview-hash['"],\s*previewHash\)/.test(appConfirm), 'the trusted confirmation click must be bound to the visible preview');
assert(/(?:expectedContext|probeContext|context)\s*:\s*[a-zA-Z_$][\w$]*/.test(appConfirm), 'execute must carry the probed encounter context fingerprint');
assert(/var lockedContext\s*=\s*\{[\s\S]*?appointmentId\s*:\s*contextValue\(ctx,\s*\[['"]appointmentId['"],\s*['"]athenaAppointmentId['"]\]/.test(appConfirm), 'execute must retain the appointment ID discovered by the read-only probe');
assert(/(?:expectedContext|context)\s*:\s*[a-zA-Z_$][\w$]*/.test(appProbe), 'probe must carry visit date and provider context');
assert(/No claim is submitted/.test(appActions));

const clickGate = between(content, '/* ATHENA_ACTION_V2_CLICK_GATE_START */', '/* ATHENA_ACTION_V2_CLICK_GATE_END */');
assert(/isTrusted\s*!==\s*true/.test(clickGate), 'programmatic .click() must not mint authorization');
assert(/Date\.now\(\)/.test(clickGate), 'authorization must be short lived');
assert(/gestureProof|serial|gestureToken/.test(clickGate), 'a trusted click must mint an unforgeable gesture proof');
for (const field of ['action', 'previewHash']) {
  assert(clickGate.includes(field), `the click authorization must bind ${field}`);
}
assert(/expiresAt|expires|until/.test(clickGate), 'authorization must record an expiry');

// Exercise the isolated click gate: a synthetic/programmatic event must leave
// the arm empty, while a browser-trusted click on the exact labelled action
// captures only that action and its visible preview hash.
let capturedClick = null;
const gateContext = {
  location: { origin: 'https://mlsscribe.com' },
  mlsTrustedOrigin: () => true,
  _mlsSignGestureUntil: 0,
  document: { addEventListener: (type, fn) => { if (type === 'click') capturedClick = fn; } },
  crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i += 1) a[i] = i + 41; return a; } },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  Uint32Array,
  Date,
  Math,
  String,
  Array
};
vm.runInNewContext(clickGate, gateContext);
assert.strictEqual(typeof capturedClick, 'function');
const actionEl = {
  textContent: 'Confirm Stage billing codes',
  value: '',
  disabled: false,
  getBoundingClientRect: () => ({ width: 180, height: 40 }),
  getAttribute: name => ({
    'data-mls-athena-action': 'stage_billing',
    'data-mls-preview-hash': 'preview-123',
    'aria-label': '',
    title: ''
  })[name] || '',
  closest: selector => selector.includes('data-mls-athena-action') || selector.startsWith('button') ? actionEl : null
};
capturedClick({ isTrusted: false, target: actionEl });
assert.strictEqual(gateContext._mlsAthenaActionGesture.action, '', 'programmatic click armed an Athena mutation');
/* wsg-2.0.0 CONTRACT CHANGE (owner directive 2026-08-12, MLS Assist 3.0.62):
   the wsg-1.0.0 preview-only rule for billing/orders/sign is LIFTED. A
   browser-trusted click on the exact confirm button of ANY supervised action
   arms that one action (single-use, short-lived); a programmatic click still
   never arms, and a trusted click whose label names a DIFFERENT action still
   never arms (no cross-arming). Pinned both ways below. */
capturedClick({ isTrusted: true, target: actionEl });
assert.strictEqual(gateContext._mlsAthenaActionGesture.action, 'stage_billing', 'wsg-2.0.0: a trusted click on the exact stage_billing confirm must arm stage_billing');
assert.strictEqual(gateContext._mlsAthenaActionGesture.previewHash, 'preview-123');
gateContext._mlsAthenaActionGesture = { action: '', until: 0, serial: '', previewHash: '', rowHash: '', clientOrderId: '' };
/* the app's own aria phrase for the billing confirm ("Confirm stage billing in
   Athena") must arm too - the 8/12 site lane wrote that phrase and 3.0.61's
   regex demanded "codes", a mismatch that would have refused every billing
   send with fresh-trusted-click-required. */
const billingAriaEl = Object.assign({}, actionEl, { textContent: 'Confirm & Send to Athena', getAttribute: name => ({ 'data-mls-athena-action': 'stage_billing', 'data-mls-preview-hash': 'preview-b2', 'aria-label': 'Confirm stage billing in Athena', title: '' })[name] || '' });
billingAriaEl.closest = selector => selector.includes('data-mls-athena-action') || selector.startsWith('button') ? billingAriaEl : null;
capturedClick({ isTrusted: true, target: billingAriaEl });
assert.strictEqual(gateContext._mlsAthenaActionGesture.action, 'stage_billing', 'the app aria phrase "Confirm stage billing in Athena" must arm stage_billing');
gateContext._mlsAthenaActionGesture = { action: '', until: 0, serial: '', previewHash: '', rowHash: '', clientOrderId: '' };
for (const [action, phrase] of [['sign_encounter', 'Confirm Sign and Save in Athena'], ['place_order', 'Confirm and place one reviewed order in Athena']]) {
  const el = { textContent: 'Confirm & Send to Athena', value: '', disabled: false, getBoundingClientRect: () => ({ width: 180, height: 40 }),
    getAttribute: name => ({ 'data-mls-athena-action': action, 'data-mls-preview-hash': 'preview-' + action, 'data-mls-row-hash': action === 'place_order' ? 'row-1' : '', 'data-mls-client-order-id': action === 'place_order' ? 'ord-1' : '', 'aria-label': phrase, title: '' })[name] || '' };
  el.closest = selector => selector.includes('data-mls-athena-action') || selector.startsWith('button') ? el : null;
  capturedClick({ isTrusted: false, target: el });
  assert.strictEqual(gateContext._mlsAthenaActionGesture.action, '', 'programmatic click must never arm ' + action);
  capturedClick({ isTrusted: true, target: el });
  assert.strictEqual(gateContext._mlsAthenaActionGesture.action, action, 'wsg-2.0.0: a trusted click on the exact ' + action + ' confirm must arm it');
  if (action === 'place_order') { assert.strictEqual(gateContext._mlsAthenaActionGesture.rowHash, 'row-1'); assert.strictEqual(gateContext._mlsAthenaActionGesture.clientOrderId, 'ord-1'); }
  gateContext._mlsAthenaActionGesture = { action: '', until: 0, serial: '', previewHash: '', rowHash: '', clientOrderId: '' };
}
/* no cross-arming: a trusted click whose label says "write reviewed note" but
   whose data-action says sign_encounter arms NOTHING. */
const crossEl = { textContent: 'Confirm write reviewed note', value: '', disabled: false, getBoundingClientRect: () => ({ width: 180, height: 40 }),
  getAttribute: name => ({ 'data-mls-athena-action': 'sign_encounter', 'data-mls-preview-hash': 'preview-x', 'aria-label': '', title: '' })[name] || '' };
crossEl.closest = selector => selector.includes('data-mls-athena-action') || selector.startsWith('button') ? crossEl : null;
capturedClick({ isTrusted: true, target: crossEl });
assert.strictEqual(gateContext._mlsAthenaActionGesture.action, '', 'a label/action mismatch must never arm (cross-arming)');
const noteEl = {
  textContent: 'Confirm Write reviewed note',
  value: '',
  disabled: false,
  getBoundingClientRect: () => ({ width: 180, height: 40 }),
  getAttribute: name => ({
    'data-mls-athena-action': 'write_note',
    'data-mls-preview-hash': 'preview-123',
    'aria-label': '',
    title: ''
  })[name] || '',
  closest: selector => selector.includes('data-mls-athena-action') || selector.startsWith('button') ? noteEl : null
};
capturedClick({ isTrusted: false, target: noteEl });
assert.strictEqual(gateContext._mlsAthenaActionGesture.action, '', 'programmatic click armed a note write');
capturedClick({ isTrusted: true, target: noteEl });
assert.strictEqual(gateContext._mlsAthenaActionGesture.action, 'write_note');
assert.strictEqual(gateContext._mlsAthenaActionGesture.previewHash, 'preview-123');
assert(gateContext._mlsAthenaActionGesture.serial, 'trusted click did not mint a one-use gesture proof');
assert(gateContext._mlsAthenaActionGesture.until > Date.now(), 'trusted click authorization was not fresh');

const bridge = between(content, "if (d.type === 'mlsAppAthenaActionV2')", '/* ATHENA_ACTION_V2_BRIDGE_END */');
assert(/d\.mode/.test(bridge), 'the app must send an explicit mode');
assert(/['"]probe['"]/.test(bridge), 'preview/probe mode must be explicit');
assert(/['"]execute['"]/.test(bridge), 'execute mode must be explicit');
for (const action of ['stage_billing', 'save_draft', 'sign_encounter']) {
  assert(bridge.includes(action), `content bridge must recognize ${action} for probe/refusal policy`);
}
assert(bridge.includes('mlsAppAthenaActionV2Request'));
assert(bridge.includes('mlsAppAthenaActionV2Result'));
assert(/probeContext\s*:/.test(bridge), 'the content bridge must forward the probed context fingerprint');
assert(/billing\s*:/.test(bridge), 'the content bridge must forward the typed billing payload');
/* RELEASED 3.0.0: the bridge does not forward an exact-open tab binding —
   that field belonged to the REJECTED 2.9.44 verifier. The background's own
   exact-context probe is the enforced destination gate. */
assert(!/expectedAthenaTabId\s*:/.test(bridge), 'the released content bridge must not claim a tab-binding forward it does not verify');
assert(/_mlsAthenaActionGesture\s*=\s*\{|delete\s+[^;]*gesture|\.delete\([^)]*gesture/.test(bridge), 'the trusted-click arm must be consumed before the action result');

const handler = between(background, '/* ATHENA_ACTION_V2_HANDLER_START */', '/* ATHENA_ACTION_V2_HANDLER_END */');
for (const action of ['stage_billing', 'save_draft', 'sign_encounter']) {
  assert(handler.includes(action), `background must recognize ${action}`);
}
assert(/unknown-action/.test(handler), 'unknown actions must fail closed');
const safetyGateAt = handler.indexOf('MLS_WRITE_SAFETY_GATE_START');
const tokenGateAt = handler.indexOf("if (mode === 'execute')");
assert(safetyGateAt >= 0 && tokenGateAt > safetyGateAt, 'background final-action refusal must precede token and mutation processing');
assert(/write-safety-guard-missing/.test(handler), 'background must fail closed if the final-action safety guard is unavailable');
/* wsg-2.0.0: the bridge no longer refuses any execute action by policy. Pin
   the LIFT: no policy refusal between the bridge-gate marker and the trusted-
   click arm check, and the arm check itself still stands for every action. */
const bridgeSafety = between(content, '/* MLS_WRITE_SAFETY_BRIDGE_GATE', 'var previewHash');
assert(/wsg-2\.0\.0/.test(bridgeSafety), 'content bridge gate must carry the wsg-2.0.0 lift note');
assert(!/write-safety-final-action-blocked/.test(bridgeSafety), 'wsg-2.0.0: the content bridge must not refuse execute by policy any more');
assert(!/reply\(/.test(bridgeSafety), 'wsg-2.0.0: nothing may be replied (refused) inside the lifted bridge gate');
assert(/fresh-trusted-click-required/.test(bridge), 'the trusted-click arm check must still stand for every execute');
assert(/arm\.action !== athAction/.test(bridge), 'the arm must still be action-exact');
assert(/mode[^\n]*(probe|execute)/.test(handler), 'handler must have explicit probe and execute modes');
assert(/ambiguous-athena-tabs/.test(handler), 'ambiguous Athena targets must fail closed');
/* v2.9.31 multi-tab contract: the write lane no longer demands a single
 * signed-in Athena tab. Instead the probe must scan EVERY signed-in tab
 * read-only and proceed only when exactly one tab verifies the expected
 * patient+encounter context. Zero tabs and duplicate verified encounters
 * both fail closed, and a remembered target may never pick the tab. */
const tabPicker = between(handler, 'async function pickAthenaWriteCandidates', 'async function injectOnce');
assert(/!candidates\.length/.test(tabPicker), 'zero signed-in Athena tabs must fail closed');
assert(tabPicker.indexOf('__mlsWriteTarget') < 0, 'a remembered target must never pick the write tab');
const probeScan = between(handler, 'var tab = null, probe = null, probeFailure = null, verifiedTabCount = 0;', "if (action === 'sign_encounter')");
assert(/athCandidates\.length/.test(probeScan), 'the probe must iterate every signed-in Athena tab');
assert(/contextVerified/.test(probeScan) && /lockedContextShape\(athProbe\.context\)/.test(probeScan), 'a tab only counts as verified after full context verification');
assert(/verifiedTabCount\s*>\s*1/.test(handler) && /ambiguous-athena-tabs/.test(between(handler, 'verifiedTabCount > 1', 'noteWriteProofFailure')), 'duplicate verified encounters across Athena tabs must fail closed as ambiguous');
assert(/if \(!tab \|\| !probe\) return probeFailure/.test(handler), 'zero verified tabs must return the honest probe failure, never proceed');
/* RELEASED 3.0.0: no exact-open tab-pin filter in this handler (rejected
   2.9.44 feature). Ambiguity handling above and full context verification are
   the enforced gates; a pin field must not exist half-implemented. */
assert(!/hasExpectedAthenaTabId/.test(handler), 'the released handler must not carry the rejected exact-open tab-pin filter');
assert(/athenaTabId\s*:\s*tab\.id/.test(handler), 'the read-only probe receipt does not return the exact verified Athena tab id');

/* The execute capability is bound end to end. Every mismatch must be rejected
 * before the driver is injected and therefore before any DOM mutation. */
const executeMutation = '/* ATHENA_ACTION_V2_EXECUTE_INJECTION */';
for (const gate of [
  'token-sender-mismatch',
  'token-tab-mismatch',
  'token-action-mismatch',
  'preview-hash-mismatch',
  'patient-mismatch',
  'context-mismatch',
  'token-expired',
  'token-used',
  'ambiguous-athena-tabs',
  'unknown-action'
]) {
  beforeMutation(handler, gate, executeMutation);
}
beforeMutation(handler, 'rec.used = true', executeMutation);
assert(/token-expired|authorization-expired/.test(handler));
assert(/token-used|authorization-used/.test(handler));
assert(/delete\s+[^;]*token|\.delete\([^)]*token|(?:rec|token)[^;]*\.used\s*=\s*true/.test(handler), 'background authorization must be one use');

/* Execute must re-query the entire signed-in Athena tab set. Looking up only
 * the token's old tab id would miss a newly opened second Athena tab. */
const executeSection = handler.slice(handler.indexOf("if (!appSender(sender))"), handler.indexOf(executeMutation));
assert(/liveCandidates\s*=\s*exactAthenaTabs\(await\s+chrome\.tabs\.query\(\{\}\)\)/.test(executeSection), 'execute must re-query all tabs and then filter the signed-in Athena set');
assert(/lockedLive\s*=\s*liveCandidates\.filter/.test(executeSection), 'execute must locate the token-locked tab inside the live signed-in set');
assert(/Number\(lt\.id\)\s*===\s*Number\(rec\.athenaTabId\)/.test(executeSection), 'the execute gate must match the token-locked tab id against the live signed-in set');
assert(/lockedLive\.length\s*!==\s*1/.test(executeSection), 'execute must reject when the token-locked tab is not present exactly once in the signed-in Athena set');
assert(!/chrome\.tabs\.get\(rec\.athenaTabId\)/.test(executeSection), 'execute must not validate only the remembered Athena tab');

/* Omitting any member of the probed encounter fingerprint is a mismatch, as
 * is changing the full expected encounter displayed at confirmation time. */
const probeContextMatcher = between(handler, 'function probeContextMatches', 'function billingKey');
for (const field of ['mrn', 'encounterId', 'encounterUrl', 'visitDate', 'provider', 'framePath', 'controlFingerprint', 'contextHash']) {
  assert(probeContextMatcher.includes(field), `execute probe-context matcher must bind ${field}`);
}
assert(/!lockedContextShape\(got\)/.test(probeContextMatcher), 'an incomplete execute probeContext must fail closed');
assert(/!expectedContextShape\(c, mode === ['"]execute['"]\)/.test(handler), 'execute expectedContext must require the complete encounter identity');
assert(/expectedContextMatches\(c, rec\.expectedContext, rec\.locked\)/.test(executeSection), 'execute must validate expectedContext against both the probe request and locked encounter');
assert(/rec\.expectedContextHash\s*!==\s*simpleHash\(expectedContextKey\(c\)\)/.test(executeSection), 'execute must preserve the immutable caller context hash');
assert(/rec\.lockedContextHash\s*!==\s*simpleHash\(expectedContextKey\(rec\.locked\)\)/.test(executeSection), 'execute must bind the immutable probe-discovered encounter hash independently of the caller context');
const consumeAt = handler.indexOf('rec.used = true');
const liveTabRequeryAt = handler.indexOf('liveCandidates = exactAthenaTabs');
const contextRecheckAt = handler.indexOf('probeContextMatches(msg.probeContext, rec.locked)');
assert(consumeAt >= 0 && liveTabRequeryAt > consumeAt && contextRecheckAt > consumeAt, 'a failed tab/context recheck must still consume the one-use token');

/* Probe may discover one unique labeled encounter when the app has no
 * schedule context. A partially supplied expectation is more dangerous than
 * an omitted one and must fail closed. Execute still uses the full lock. */
const contextHelpersSource = between(handler, 'function clean(v)', 'function billingKey');
/* background.js is an MV3 service worker: `self` is its global object. The
 * slice above (clean..billingKey) has grown to include tokdiag-3.0.97's
 * top-level `self.tokDiag = self.tokDiag || function(){...}` beacon, which
 * Node has no `self` for - the extraction window widens as background.js
 * grows, and it threw before a single helper below was even defined. Shim
 * the one global this slice touches at eval time rather than narrowing the
 * window again, which will just widen and break the same way next time. */
const contextHelpers = Function(`var self = {};\n${contextHelpersSource}\nreturn { expectedContextShape: expectedContextShape, expectedContextMatches: expectedContextMatches };`)();
const fullExpected = { encounterId: '12345', encounterUrl: 'https://athenanet.athenahealth.com/encounter/12345', visitDate: '07/14/2026', provider: 'Example Provider, MD' };
assert.strictEqual(contextHelpers.expectedContextShape({}, false), true, 'an omitted probe expectedContext must preserve unique read-only discovery');
assert.strictEqual(contextHelpers.expectedContextShape({ visitDate: '', provider: '', encounterId: '', encounterUrl: '' }, false), true, 'sanitized empty probe context must preserve discovery');
assert.strictEqual(contextHelpers.expectedContextShape({ visitDate: '07/14/2026', provider: 'Example Provider, MD' }, false), true, 'a complete date/provider probe expectation is valid');
assert.strictEqual(contextHelpers.expectedContextShape(fullExpected, false), true, 'a fully supplied probe expectation is valid');
for (const incomplete of [
  { visitDate: '07/14/2026' },
  { provider: 'Example Provider, MD' },
  { visitDate: '07/14/2026', provider: 'Example Provider, MD', encounterId: '12345' },
  { visitDate: '07/14/2026', provider: 'Example Provider, MD', encounterUrl: fullExpected.encounterUrl },
  { encounterId: '12345', encounterUrl: fullExpected.encounterUrl }
]) {
  assert.strictEqual(contextHelpers.expectedContextShape(incomplete, false), false, `incomplete supplied probe context must be rejected: ${JSON.stringify(incomplete)}`);
}
assert.strictEqual(contextHelpers.expectedContextShape({ visitDate: '07/14/2026', provider: 'Example Provider, MD' }, true), false, 'execute must still require encounter ID and URL');
assert.strictEqual(contextHelpers.expectedContextShape(fullExpected, true), true, 'execute accepts the complete locked encounter only');
const richerLocked = Object.assign({ appointmentId: '54321' }, fullExpected);
assert.strictEqual(contextHelpers.expectedContextMatches(fullExpected, fullExpected, richerLocked), true, 'encounter-only authorization must allow the probe to discover a stronger appointment ID');
const appointmentExpected = { appointmentId: '54321', visitDate: '07/14/2026', provider: 'Example Provider, MD' };
assert.strictEqual(contextHelpers.expectedContextMatches(appointmentExpected, appointmentExpected, richerLocked), true, 'appointment-only authorization must allow the probe to discover encounter identity');
assert.strictEqual(contextHelpers.expectedContextMatches(Object.assign({}, fullExpected, { visitDate: '07/15/2026' }), fullExpected, richerLocked), false, 'a changed execute-time expectation must be rejected');
assert.strictEqual(contextHelpers.expectedContextMatches(fullExpected, Object.assign({}, fullExpected, { visitDate: '07/15/2026' }), richerLocked), false, 'a changed originally supplied expectation must be rejected');

/* A final action belongs to the one selected top-level Athena document. It
 * must never spray clicks into every frame. */
assert(/target\s*:\s*\{\s*tabId\s*:\s*(?:tab\.id|tabId)\s*\}/.test(handler), 'driver must target one Athena tab');
assert(!/target\s*:\s*\{[^}]*allFrames\s*:\s*true[^}]*\}[\s\S]{0,300}func\s*:\s*mlsAthenaActionV2DriverFn/.test(handler), 'final actions must not mutate all frames');
assert(/allFrames\s*:\s*true[\s\S]{0,300}func\s*:\s*mlsAthenaTeachWatcherFn/.test(handler), 'read-only teaching safety watcher must cover every frame so a cross-origin click cannot slip through');

/* An uncertain result is never retried, reloaded, or reported as verified. */
for (const forbidden of ['mlsRecoverAthenaTab', 'chrome.tabs.reload', 'location.reload']) {
  assert(!handler.includes(forbidden), `${forbidden} must not appear in the action handler`);
}
assert(/outcome-uncertain|uncertain-outcome|action-timeout-uncertain/.test(handler));
assert(/verified\s*:\s*false/.test(handler), 'uncertain results must remain unverified');

const driver = between(background, '/* ATHENA_ACTION_V2_DRIVER_START */', '/* ATHENA_ACTION_V2_DRIVER_END */');
assert(/unknown-action/.test(driver));
assert(/probe/.test(driver));
const probeReturn = driver.indexOf("if (mode === 'probe') return");
const firstMutation = driver.indexOf('/* STAGE_BILLING_START */');
assert(probeReturn >= 0 && firstMutation > probeReturn, 'probe must return a read-only preview before the mutation boundary');
assert(/readOnly\s*:\s*true/.test(driver.slice(probeReturn, firstMutation)), 'probe must label its result read-only');

/* Dormant driver code remains fail-closed as defense in depth if a future
 * policy intentionally re-enables it. The active handler/bridge guards above
 * make this branch unreachable for billing execute today. */
const billing = between(driver, '/* STAGE_BILLING_START */', '/* STAGE_BILLING_END */');
for (const marker of [
  'billing-near-match-rejected',
  'billing-duplicate-rejected',
  'billing-context-unverified',
  'billing-context-verified'
]) {
  assert(billing.includes(marker), `billing driver missing ${marker}`);
}
assert(/tokenRe\(code\)|billing-exact-match/.test(billing), 'billing selection must use an exact code-token match');
assert(/staged\s*:\s*true/.test(billing), 'verified billing must explicitly report staged:true');

const codeMatchersSource = between(driver, 'function exactCode(code)', 'function rowsIn(root, code, exclude)');
const codeMatchers = Function(`${codeMatchersSource}\nreturn { exactCode: exactCode, tokenRe: tokenRe };`)();
for (const code of ['99214', 'J3301', '0123T', '1036F']) {
  assert.strictEqual(codeMatchers.exactCode(code), true, `${code} should be accepted as one exact CPT/HCPCS code`);
}
for (const near of ['9921', '992140', 'code 99214', 'J3301 units 2', 'ABCDE']) {
  assert.strictEqual(codeMatchers.exactCode(near), false, `${near} is not one exact CPT/HCPCS code`);
}
assert(codeMatchers.tokenRe('99214').test('99214 Office visit'));
assert(!codeMatchers.tokenRe('99214').test('1992140 near match'));
assert(!codeMatchers.tokenRe('99214').test('A99214X near match'));
assert(codeMatchers.tokenRe('J3301').test('J3301 Injection'));
assert(!codeMatchers.tokenRe('J3301').test('XJ33010 near match'));

/* Every dormant candidate click also flows through a final-action denylist. */
for (const label of ['submit', 'post', 'file', 'claim', 'sign', 'place order']) {
  assert(billing.toLowerCase().includes(label), `billing denylist must name ${label}`);
}

const exactControls = between(driver, 'function exactSave(el)', 'function interactive(doc, win)');
assert(/n\s*===\s*['"]save['"]/.test(exactControls));
assert(/n\s*===\s*['"]sign and save['"]/.test(exactControls));
assert(!/n\s*===\s*['"](?:ok|yes)['"]/.test(exactControls), 'generic OK/Yes controls must never be accepted');
const controlMatchers = Function(`
  var label = function (el) { return String(el && el.label || ''); };
  var labelSources = function (el) { return [String(el && el.label || '')]; };
  var norm = function (v) { return String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim(); };
  ${exactControls}
  return { exactSave: exactSave, exactSign: exactSign };
`)();
for (const label of ['Save', 'Save Draft', 'Save Note']) assert.strictEqual(controlMatchers.exactSave({ label }), true);
for (const label of ['Sign & Save', 'Save and Sign', 'Submit', 'Post', 'OK', 'Yes']) assert.strictEqual(controlMatchers.exactSave({ label }), false);
assert.strictEqual(controlMatchers.exactSign({ label: 'Sign & Save' }), true);
for (const label of ['Sign', 'Save', 'OK', 'Yes', 'Submit']) assert.strictEqual(controlMatchers.exactSign({ label }), false);

const save = between(driver, '/* SAVE_DRAFT_START */', '/* SAVE_DRAFT_END */');
assert(/exact-save-control-context-verified/.test(save));
assert(/saved\s*:\s*saveVerified|saved\s*:\s*true/.test(save), 'verified save must explicitly report saved:true');
assert(!/Sign\s*(?:&|and)\s*Save/i.test(save), 'Save draft must never fall through to Sign & Save');

const sign = between(driver, '/* SIGN_ENCOUNTER_START */', '/* SIGN_ENCOUNTER_END */');
assert(/exact-sign-control-context-verified/.test(sign));
assert(/signed\s*:\s*signVerified|signed\s*:\s*true/.test(sign), 'verified sign must explicitly report signed:true');
assert(/exactSign/.test(sign), 'sign confirmations must reuse the exact Sign & Save matcher');
assert(!/\b(?:OK|Yes)\b/.test(sign), 'sign must not authorize generic confirmation buttons');

/* One request performs exactly one action. Save and billing never chain into
 * signing, and signing never invokes note/order/billing writers. */
assert(/no-automatic-chaining/.test(handler));
assert.strictEqual((handler.match(/ATHENA_ACTION_V2_EXECUTE_INJECTION/g) || []).length, 1, 'one request must have one execute boundary');
assert(!/mlsAppAthenaActionV2Request/.test(driver), 'the injected driver must never recursively invoke another Athena action');
assert(!/orders?_preview|lab_order|imaging_order|referral_order|pt_order/.test(driver), 'the action driver must remain separate from order chains');

/* Existing low-level AI/autopilot guards remain independent and active. */
const genericExec = between(background, "if (msg.type === 'mlsAssistExec')", "if (msg.type === 'mlsPasteHere')");
for (const required of ['final-action-blocked', 'structured-route-blocked', 'Save, Sign, Submit']) {
  assert(genericExec.includes(required), `generic executor missing low-level guard: ${required}`);
}

const genericWriteDriver = between(background, 'async function mlsUnifiedWriteDriverFn', '/* v2.05 handler:');
assert(/forcedHeld/.test(genericWriteDriver), 'generic write route must keep structured routes held');
assert(!/sign_encounter|save_draft|stage_billing/.test(genericWriteDriver), 'generic note writer must not gain final-action capabilities');

console.log('PASS Athena action contract (wsg-2.0.0): every supervised action arms only from its own trusted confirm click, no cross-arming, policy refusals lifted, dormant generic-writer defenses preserved');
