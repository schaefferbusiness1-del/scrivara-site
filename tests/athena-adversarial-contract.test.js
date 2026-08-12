'use strict';

/*
 * Adversarial contract for the TOP Athena receipt.  These checks deliberately
 * sit above selector/unit happy paths: they pin the authorization and evidence
 * boundaries that prevent a correct-looking click from mutating the wrong
 * patient, encounter, or destination.
 *
 * This file is static/fixture-only.  It never opens Athena and never performs
 * a write, Save, Sign, or billing action.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const writeflow = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing start marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

function functionBlock(source, name) {
  const re = new RegExp(`function\\s+${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\(`);
  const m = re.exec(source);
  assert(m, `missing function ${name}`);
  const brace = source.indexOf('{', m.index);
  assert(brace >= 0, `missing body for ${name}`);
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
    else if (ch === '}' && --depth === 0) return source.slice(m.index, i + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

const failures = [];
function finding(name, fn) {
  try {
    fn();
    console.log(`PASS adversarial finding: ${name}`);
  } catch (err) {
    failures.push({ name, message: err && err.message ? err.message : String(err) });
    console.error(`FAIL adversarial finding: ${name}\n  ${failures[failures.length - 1].message}`);
  }
}

const driver = between(background, '/* ATHENA_ACTION_V2_DRIVER_START */', '/* ATHENA_ACTION_V2_DRIVER_END */');
const handler = between(background, '/* ATHENA_ACTION_V2_HANDLER_START */', '/* ATHENA_ACTION_V2_HANDLER_END */');
const clickGate = between(content, '/* ATHENA_ACTION_V2_CLICK_GATE_START */', '/* ATHENA_ACTION_V2_CLICK_GATE_END */');
const actionBridge = between(content, "if (d.type === 'mlsAppAthenaActionV2')", '/* ATHENA_ACTION_V2_BRIDGE_END */');
const explicitActions = between(writeflow, '/* ---------------- explicit Athena actions', '/* ---- identity helpers');
const writeReceiptDrafts = functionBlock(writeflow, 'writeReceiptDrafts');
const startAthenaAction = functionBlock(writeflow, 'startAthenaAction');
const showActionConfirm = functionBlock(writeflow, 'showActionConfirm');
const receiptAction = functionBlock(app, '_athenaReceiptAction');
const receiptUi = functionBlock(app, '_athenaShowReceipt');

finding('top note placement uses the exact-encounter AthenaActionV2 lane', function () {
  /* `write_note` is a first-class action everywhere, not a convenience call
     into the advanced workspace's older mlsAppWriteV2 route. */
  for (const [label, source] of [
    ['page driver', driver],
    ['background handler', handler],
    ['trusted-click gate', clickGate],
    ['content bridge', actionBridge],
    ['app action controller', explicitActions]
  ]) assert(/\bwrite_note\b/.test(source), `${label} must recognize canonical action write_note`);

  assert(/openUnifiedConfirmation\(/.test(writeReceiptDrafts), 'top writeReceiptDrafts must enter the single immutable manifest review');
  assert(!/bridge\(\s*['"]mlsAppWriteV2['"]/.test(writeReceiptDrafts), 'top writeReceiptDrafts must not bypass exact-encounter authorization through mlsAppWriteV2');
  assert(/data-mls-athena-action/.test(showActionConfirm) && /data-mls-preview-hash/.test(showActionConfirm), 'write_note confirmation must use the same trusted-click binding as final actions');
  assert(/noteText\s*:/.test(actionBridge), 'the typed content bridge must carry the reviewed note text');
  assert(/\bnoteHash\b/.test(handler), 'the one-use token must bind a hash of the reviewed note text');
  assert(/note-payload-mismatch|note-hash-mismatch/.test(handler), 'changing the note after probe must fail closed');
  const noteMismatchAt = handler.search(/note-payload-mismatch|note-hash-mismatch/);
  const executeInjectionAt = handler.indexOf('/* ATHENA_ACTION_V2_EXECUTE_INJECTION */');
  assert(noteMismatchAt >= 0 && executeInjectionAt > noteMismatchAt, 'note payload must be rechecked before Athena execution');

  const note = between(driver, '/* ATHENA_ACTION_V2_WRITE_NOTE_START */', '/* ATHENA_ACTION_V2_WRITE_NOTE_END */');
  assert(/noteText/.test(note) && /editorValue|readback|readBack/.test(note), 'write_note must read back the exact encounter editor after mutation');
  assert(/===|!==/.test(note), 'write_note verification must compare exact normalized content, not merely find a substring');
  assert(/written\s*:\s*true/.test(note) && /verified\s*:\s*true/.test(note), 'write_note success must explicitly report written:true and verified:true');
  assert(/outcome-uncertain|note-write-unverified/.test(note), 'an unverified note mutation must have an honest uncertain result');
  assert(!/save_draft|sign_encounter|stage_billing/.test(note), 'write_note must not chain Save, Sign, or billing');

  /* The advanced workspace remains available, but a cached target may not hide
     a second signed-in Athena tab. Ambiguity is checked before the cache. */
  const advancedStart = background.indexOf("if (!msg || msg.type !== 'mlsAppWriteV2Request') return;");
  assert(advancedStart >= 0, 'advanced workspace handler must remain present');
  /* The supervised V2 handler is intentionally defined much earlier in this
     large service worker, so its marker is not a valid end delimiter here.
     The advanced handler is short; a bounded forward slice covers its complete
     tab-selection preamble without accidentally wrapping to source.length-1. */
  const advanced = background.slice(advancedStart, advancedStart + 12000);
  const candidateCount = advanced.indexOf('candidates.length > 1');
  const cachedTarget = advanced.indexOf('__mlsWriteTarget');
  assert(candidateCount >= 0 && cachedTarget >= 0 && candidateCount < cachedTarget, 'advanced mlsAppWriteV2 must reject multiple Athena tabs before consulting __mlsWriteTarget');
});

finding('patient identity comes from one explicit chart header and returns observed values', function () {
  const identity = between(driver, '/* ATHENA_ACTION_V2_PATIENT_HEADER_START */', '/* ATHENA_ACTION_V2_PATIENT_HEADER_END */');
  assert(/querySelectorAll|deepQueryAll/.test(identity), 'patient identity must enumerate explicit chart-header containers, including open shadow roots');
  assert(/patient[-_ ]?(?:header|banner)|chart[-_ ]?header|demographics[-_ ]?header/i.test(identity), 'patient identity selectors must name an explicit patient/chart header contract');
  assert(/\.length\s*!==\s*1|\.length\s*===\s*1/.test(identity), 'zero or multiple matching patient headers must fail closed');
  for (const field of ['name', 'dob', 'mrn']) assert(new RegExp(`\\b${field}\\b`, 'i').test(identity), `explicit header reader must observe ${field}`);
  assert(!/doc\.body|document\.body/.test(identity), 'the entire document body is not a patient identity container');

  assert(!/nameSeen\(body\s*,\s*expectedPatient\.name\)/.test(driver), 'expected patient text anywhere in the page must not prove the chart header');
  assert(!/dateSeen\(body\s*,\s*expectedPatient\.dob\)/.test(driver), 'expected DOB text anywhere in the page must not prove the chart header');
  assert(!/mrns\(body\)/.test(driver), 'a page-wide MRN occurrence must not become chart identity');
  assert(!/patientName\s*:\s*text\(expectedPatient\.name\)/.test(driver), 'the driver must return the actually observed patient name, not echo the request');
  assert(!/dob\s*:\s*dateKey\(expectedPatient\.dob\)/.test(driver), 'the driver must return the actually observed DOB, not echo the request');
  assert(/observedPatient|observedIdentity|chartHeaderIdentity|anchoredIdentity/.test(driver), 'the locked context must retain an observed chart-header identity');
  const observed = '(?:(?:hit\\.)?(?:observedPatient|observedIdentity|chartHeaderIdentity)|hit\\.identity)';
  assert(new RegExp(`patientName\\s*:\\s*(?:text\\s*\\()?\\s*${observed}\\.name`).test(driver), 'probe context must return the observed chart-header name');
  assert(new RegExp(`dob\\s*:\\s*(?:dateKey\\s*\\()?\\s*${observed}\\.dob`).test(driver), 'probe context must return the observed chart-header DOB');
  assert(new RegExp(`mrn\\s*:\\s*(?:digits\\s*\\()?\\s*${observed}\\.mrn`).test(driver), 'probe context must return the observed chart-header MRN');
});

finding('Save and dormant Sign defenses are scoped to one exact encounter-note container', function () {
  const scope = between(driver, '/* ATHENA_ACTION_V2_NOTE_SCOPE_START */', '/* ATHENA_ACTION_V2_NOTE_SCOPE_END */');
  assert(/querySelectorAll|deepQueryAll/.test(scope), 'the driver must enumerate encounter-note containers, including open shadow roots');
  assert(/encounter[-_ ]?(?:note|documentation)|note[-_ ]?(?:container|editor|workspace)|documentation[-_ ]?(?:container|workspace)/i.test(scope), 'note scope must use an explicit encounter documentation selector contract');
  assert(/\.length\s*!==\s*1|\.length\s*===\s*1/.test(scope), 'zero or multiple encounter-note containers must fail closed');

  const save = between(driver, '/* SAVE_DRAFT_START */', '/* SAVE_DRAFT_END */');
  const sign = between(driver, '/* SIGN_ENCOUNTER_START */', '/* SIGN_ENCOUNTER_END */');
  for (const [label, block] of [['Save', save], ['Sign', sign]]) {
    assert(/noteScope|noteContainer|encounterNote|actionTarget|noteTarget/.test(block), `${label} must operate through the verified note container`);
    assert(!/interactive\(hit\.frame\.doc/.test(block), `${label} must not search every control in the Athena frame`);
    assert(!/hit\.frame\.doc\.querySelectorAll/.test(block), `${label} dialogs/status must not be read from the whole frame`);
  }
  assert(/interactive\((?:hit\.)?(?:noteScope|noteContainer|encounterNote)/.test(driver), 'Save/Sign candidate controls must be enumerated inside the note scope');
  assert(/(?:note(?:Scope|Container)|actionContainer)Fingerprint\s*:/.test(driver), 'the token-locked context must fingerprint the encounter-note container');
  assert(/(?:note(?:Scope|Container)|actionContainer)Fingerprint\s*:/.test(actionBridge), 'the content bridge must forward the note-container fingerprint for execute re-check');

  const lockedShape = between(handler, 'function lockedContextShape', 'function expectedContextMatches');
  const contextMatch = between(handler, 'function probeContextMatches', 'function billingKey');
  assert(/(?:note(?:Scope|Container)|actionContainer)Fingerprint/.test(lockedShape), 'a probe token must require the note-container fingerprint');
  assert(/(?:note(?:Scope|Container)|actionContainer)Fingerprint/.test(contextMatch), 'execute must re-check the same note-container fingerprint');
});

finding('Save success and dormant Sign verification require new scoped evidence', function () {
  const status = between(driver, '/* ATHENA_ACTION_V2_SCOPED_STATUS_START */', '/* ATHENA_ACTION_V2_SCOPED_STATUS_END */');
  assert(/(?:Weak)?Set\s*\(|MutationObserver|baseline/.test(status), 'status verification must snapshot pre-click evidence by node/identity');
  assert(/new|added|after|mutation/i.test(status), 'status verification must distinguish evidence created after the click');
  assert(/roots|scope|noteContainer|noteScope/.test(status), 'status verification must accept the exact note container as its scope');
  assert(!/document\.querySelectorAll|doc\.querySelectorAll/.test(status), 'scoped success evidence must not query global document toasts');
  const statusFns = Function('visible', 'norm', 'label', `${status}\nreturn { statusEvidenceSnapshot, newScopedStatus };`)(
    () => true,
    v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    el => String((el && el.textContent) || '')
  );
  const oldStatus = { textContent: 'Ready', ownerDocument: { defaultView: {} } };
  const nodes = [oldStatus];
  const noteRoot = { querySelectorAll: () => nodes.slice() };
  const baseline = statusFns.statusEvidenceSnapshot([noteRoot]);
  oldStatus.textContent = 'Draft saved successfully';
  assert.strictEqual(statusFns.newScopedStatus(baseline, [noteRoot], /draft saved/), false, 'changing a pre-existing status element must not prove this click succeeded');
  nodes.push({ textContent: 'Draft saved successfully', ownerDocument: { defaultView: {} } });
  assert.strictEqual(statusFns.newScopedStatus(baseline, [noteRoot], /draft saved/), true, 'a newly created matching status inside the note root should be accepted');
  assert(!/scopedStatus\(hit\.frame\.doc\)/.test(driver), 'Save/Sign must not verify from global frame status');
  assert(!/after(?:Save|Sign)\s*!==\s*before(?:Save|Sign)/.test(driver), 'a changed global status string is not durable scoped evidence');

  const save = between(driver, '/* SAVE_DRAFT_START */', '/* SAVE_DRAFT_END */');
  const sign = between(driver, '/* SIGN_ENCOUNTER_START */', '/* SIGN_ENCOUNTER_END */');
  for (const [label, block] of [['Save', save], ['Sign', sign]]) {
    assert(/status(?:Evidence|Snapshot)|newScopedStatus|scopedSuccess/.test(block), `${label} must use the scoped new-evidence verifier`);
    assert(/noteScope|noteContainer|encounterNote|actionTarget|noteTarget/.test(block), `${label} success evidence must remain inside the note container`);
    assert(/verified\s*:/.test(block), `${label} must return explicit verified evidence`);
  }
});

finding('dormant billing defense still has explicit preflight and partial-mutation accounting', function () {
  const billing = between(driver, '/* STAGE_BILLING_START */', '/* STAGE_BILLING_END */');
  const preflight = between(billing, '/* ATHENA_ACTION_V2_BILLING_PREFLIGHT_START */', '/* ATHENA_ACTION_V2_BILLING_PREFLIGHT_END */');
  const commit = between(billing, '/* ATHENA_ACTION_V2_BILLING_COMMIT_START */', '/* ATHENA_ACTION_V2_BILLING_COMMIT_END */');
  assert(/preflight/i.test(preflight), 'all requested codes need a named preflight result before committing rows');
  assert(/billing-near-match-rejected|billing-duplicate-rejected|billing-context-unverified/.test(preflight), 'preflight must fail closed on missing, near, or duplicate exact options');
  assert(!/\.click\(\)/.test(preflight), 'preflight must not commit a billing option');
  assert(/\.click\(\)/.test(commit), 'the commit phase must be isolated after preflight');
  for (const field of ['results', 'stagedCodes', 'failedCodes', 'partialMutation']) {
    assert(new RegExp(`\\b${field}\\b`).test(commit), `billing commit results must explicitly report ${field}`);
  }
  assert(/partialMutation\s*:\s*(?:stagedCodes\.length\s*>\s*0|!!stagedCodes\.length|true)/.test(commit), 'a failure after one committed code must report partialMutation:true');
  assert(/partialMutation\s*:\s*false/.test(billing), 'clean preflight/success results must explicitly report no partial mutation');

  const partialAt = showActionConfirm.search(/partialMutation/);
  const genericFailureAt = showActionConfirm.search(/if\s*\(\s*!resp\.ok/);
  assert(partialAt >= 0 && genericFailureAt >= 0 && partialAt < genericFailureAt, 'UI must report a partial billing mutation before its generic failure path');
  for (const field of ['stagedCodes', 'failedCodes']) assert(showActionConfirm.includes(field), `partial billing warning must list ${field}`);
  assert(/partially|partial/i.test(showActionConfirm) && /review|inspect/i.test(showActionConfirm), 'partial billing UI must tell the doctor to review Athena before retrying');
  assert(!/partialMutation[^]{0,500}Nothing was changed/i.test(showActionConfirm), 'partial mutation must never be described as Nothing was changed');
});

finding('Sign remains manual even after a verified write_note proof', function () {
  /* The note proof remains useful as a durable write receipt, but it must
     never unlock electronic finalization in the MLS UI. */
  assert(/noteWriteProofs\s*=\s*Object\.create\(null\)|new\s+Map\s*\(/.test(handler), 'background must own a note-write proof registry');
  assert(/action\s*===\s*['"]write_note['"](?=[^]{0,1800}(?:written|writeVerified))(?=[^]{0,1800}verified)(?=[^]{0,1800}noteWriteProof)/.test(handler), 'proof may be minted only after write_note reports written and verified');
  assert(/probeContextMatches\(\s*(?:executed|result|writeResult)\.context\s*,\s*rec\.locked\s*\)|(?:executed|result|writeResult)\.context\.contextHash\s*===\s*rec\.locked\.contextHash/.test(handler), 'proof minting must re-check the driver result against the token-locked encounter');
  for (const binding of ['senderTabId', 'athenaTabId', 'previewHash', 'patientHash', 'lockedContextHash']) {
    assert(new RegExp(`\\b${binding}\\b`).test(handler), `note-write proof must bind ${binding}`);
  }
  assert(/expiresAt/.test(handler), 'the background-minted note-write proof must expire');
  assert(/writeReceiptDrafts/.test(receiptAction) && /openUnifiedConfirmation\(/.test(writeReceiptDrafts), 'the top receipt write button must reach canonical write_note through the unified manifest review');
  assert(!/athenaReceiptSign/.test(receiptUi), 'top receipt must not render a Sign action, disabled or otherwise');
  assert(/Complete in Athena:[^]{0,260}Sign &amp; Save/.test(receiptUi), 'top receipt must visibly route Sign & Save to Athena');
  /* Owner directive 2026-08-12: Sign is in the app allowlist, but it may
     never run without a verified note-write proof — pinned below and at the
     probe gate. place_order stays excluded. */
  assert(/ATHENA_EXECUTABLE_ACTIONS\s*=\s*\{\s*write_note\s*:\s*true\s*,\s*save_draft\s*:\s*true\s*,\s*stage_billing\s*:\s*true\s*,\s*sign_encounter\s*:\s*true\s*\}/.test(explicitActions), 'app allowlist must be exactly note write/save/billing/sign');
  assert(/verified-note-write-required/.test(startAthenaAction), 'Sign must fail closed without a verified note-write receipt');
  const manualRefusal = startAthenaAction.indexOf('manual-only-final-action');
  const probeBridge = startAthenaAction.indexOf("mode: 'probe'");
  assert(manualRefusal >= 0 && probeBridge > manualRefusal, 'Sign must be refused before any bridge probe');
  for (const source of [actionBridge, driver]) {
    assert(/write-safety-final-action-blocked/.test(source), 'a content/driver hop lost the final-action refusal');
    assert(/sign_encounter/.test(source), 'Sign is missing from a content/driver refusal policy');
  }
  assert(/MLS_WRITE_SAFETY_GATE_START/.test(handler) && /gateActionRequest/.test(handler), 'background no longer invokes the write-safety policy before execution');
  assert(/write-safety-guard-missing/.test(handler) && /sign_encounter/.test(handler), 'background no longer fails closed when its safety policy is unavailable');
});

finding('legacy mutation routes and generic final-action blockers stay fail closed', function () {
  const legacyPush = between(content, "if (d.type === 'mlsAppPushVisit')", "if (d.type === 'mlsAppSearchProcedure')");
  assert(/legacy-untyped-write-disabled/.test(legacyPush), 'legacy mixed visit writer must remain disabled');
  const legacySign = between(content, "if (d.type === 'mlsAppSignAndSave')", '/* Supervised typed Athena actions');
  assert(/sign-route-disabled/.test(legacySign), 'legacy Sign & Save mutation must remain disabled');
  const genericExec = between(background, "if (msg.type === 'mlsAssistExec')", "if (msg.type === 'mlsPasteHere')");
  for (const guard of ['final-action-blocked', 'structured-route-blocked', 'Save, Sign, Submit']) {
    assert(genericExec.includes(guard), `generic executor lost blocker: ${guard}`);
  }
});

finding('second-pass authorization and honest-outcome gaps stay closed', function () {
  const fingerprint = functionBlock(driver, 'controlFingerprint');
  assert(!/label\s*\(\s*el\s*\)|\.value|textContent/.test(fingerprint), 'editor/scope fingerprints must not include mutable note contents');
  assert(/aria-label/.test(fingerprint) && /domPath/.test(fingerprint), 'fingerprints must retain structural labels and DOM ownership');

  assert(/function\s+encounterMetadataFor/.test(driver), 'encounter metadata must be associated with the verified action root');
  assert(/deepContains\(root,\s*identityRoot\)/.test(driver), 'patient header and action target must share one encounter container');
  assert(/encounterRootFingerprint/.test(driver) && /encounterRootFingerprint/.test(handler) && /encounterRootFingerprint/.test(actionBridge), 'the common encounter container must be locked through execute');
  assert(/deepQueryAll/.test(driver), 'open shadow roots must be traversed for live Athena components');

  const setField = functionBlock(driver, 'setField');
  assert(!/new\s+hit\.frame\.w\.Event\(\s*['"]change['"]/.test(setField), 'billing preflight must not dispatch a change event that can auto-commit');
  const billing = between(driver, '/* STAGE_BILLING_START */', '/* STAGE_BILLING_END */');
  for (const word of ['remove', 'delete', 'discard', 'void', 'unselect']) assert(billing.includes(word), `billing option denylist must reject ${word}`);
  assert(/partialMutation\s*:\s*true/.test(billing), 'a failed readback after a billing click must report a possible partial mutation');

  assert(/mutationAttempted/.test(driver) && /action-threw-after-mutation-boundary/.test(driver), 'exceptions after any mutation boundary must be reported as outcome-uncertain');
  assert(/actionEl\s*===\s*t/.test(clickGate) && /_mlsActionLabelMatches/.test(clickGate), 'trusted click must come from the exact visible, correctly labelled action button');

  assert(/notePayload\s*:\s*canonicalNotePayload/.test(handler), 'the token/proof registry must retain the exact canonical note payload');
  assert(/rec\.notePayload\s*!==\s*canonicalNotePayload/.test(handler), 'execute must compare the complete canonical note payload, not only its short hash');

  const advancedRelay = content.slice(content.indexOf("d.type !== 'mlsAppWriteV2'"), content.length);
  assert(/unified-confirmation-required/.test(advancedRelay), 'stale advanced direct-write messages must fail closed');
  assert(!/chrome\.runtime\.sendMessage\s*\(/.test(advancedRelay), 'deprecated advanced direct writes must never reach the background');
  const advancedHandlerAt = background.indexOf("msg.type !== 'mlsAppWriteV2Request'");
  const advancedHandler = background.slice(advancedHandlerAt, advancedHandlerAt + 5000);
  const disabledAt = advancedHandler.indexOf('unified-confirmation-required');
  const legacyTabPickAt = advancedHandler.indexOf('chrome.tabs.query');
  assert(disabledAt >= 0 && legacyTabPickAt > disabledAt, 'background must reject the deprecated direct writer before any Athena tab selection');

  const pasteAt = background.indexOf("msg.type === 'mlsAppPasteRequest'");
  const pasteHandler = background.slice(pasteAt, pasteAt + 1800);
  assert(/legacy-untyped-write-disabled/.test(pasteHandler), 'generic paste must refuse the old untyped Athena path');

  assert(/Review the full note text/.test(writeflow) && /white-space:pre-wrap/.test(writeflow), 'the final confirmation must show the exact frozen note text');
  assert(/resp\.__timeout===true[^]{0,500}outcome is uncertain/i.test(app), 'the top receipt must replace “nothing changed” after a timeout');
});

finding('final payload, billing-option, editable-field, and shadow-root edges stay closed', function () {
  const notePayload = functionBlock(handler, 'notePayloadKey');
  assert(/JSON\.stringify/.test(notePayload), 'the complete note/section authorization payload must use unambiguous serialization');
  assert(!/join\(['"]\\u001[ef]['"]\)/.test(notePayload), 'raw control-character delimiters must not authorize note payloads');
  assert(!/noteNorm\s*\(/.test(notePayload) && /String\(noteText/.test(notePayload), 'authorization must retain raw note text so whitespace drift cannot pass as the same payload');

  const billingKey = functionBlock(handler, 'billingKey');
  assert(/JSON\.stringify/.test(billingKey), 'billing payload serialization must distinguish E/M from ordered CPT codes');
  assert(/billingPayload\s*:\s*canonicalBillingPayload/.test(handler), 'the token registry must retain the complete canonical billing payload');
  assert(/rec\.billingPayload\s*!==\s*canonicalBillingPayload/.test(handler), 'execute must compare the complete billing payload, not only a 32-bit hash');

  const billing = between(driver, '/* STAGE_BILLING_START */', '/* STAGE_BILLING_END */');
  assert(/aria-selected/.test(billing) && /aria-checked/.test(billing) && /aria-pressed/.test(billing), 'already-selected or pressed billing options must be rejected before a click');
  assert(/signalNodes[^]{0,700}aria-label/.test(billing), 'destructive labels on icon-only descendants must be included in the option denylist');
  assert(/ownerSeen[^]{0,900}optionSafetySignal\(owner\)/.test(billing) && /reachedScope/.test(billing), 'every candidate ancestor through the owning scope must be inspected without a silent depth cap');
  assert(/signalNodes[^]{0,900}optionStateUnsafe\(signalNodes\[si\]\)/.test(billing), 'selected, checked, or pressed state on descendants must reject the option');
  assert(/replace/.test(billing) && /bundle/.test(billing), 'replace and bundle billing semantics must be rejected before a click');
  assert(/optionCodes\.length\s*===\s*1[^]{0,100}optionCodes\[0\]\s*===\s*code/.test(billing), 'a billing option must name exactly the one requested code');
  assert(/!metadataSemantics\(rawOption\s*\+\s*['"] ['"]\s*\+\s*safetySignals,\s*code\)/.test(billing), 'a code option carrying modifier, unit, quantity, diagnosis, or safety-signal semantics must be rejected');
  const metadataGuard = functionBlock(driver, 'metadataSemantics');
  const metadataFieldGuard = functionBlock(driver, 'metadataFieldSemantics');
  assert(metadataGuard.includes('[,|/:-]') && /\\\(/.test(metadataGuard) && /u00d7/.test(metadataGuard), 'modifier comma/pipe/slash, parenthesis, and quantity multiplication shorthand must fail closed');
  const metadataSemantics = vm.runInNewContext(metadataFieldGuard + '; (' + metadataGuard + ')', Object.create(null), { timeout: 100 });
  for (const unsafe of ['99213 x2', '99213 2x', '99213 ×2', '99213 (25)', '99213 /25', '99213-25', '99213 25', '99213,25', '99213 2', '99213 100', '99213 A', '99213 | A', '99213 | 2', '99213 Office visit 25', '99213 performance measure 1P', '(25) 99213', '100 99213', '99213 2 units', 'ICD10 M54.5', '99213 M54.5', '99213 U07.1', '99213 M545', 'modifier1 25', 'dx1 A']) {
    assert.strictEqual(metadataSemantics(unsafe, '99213'), true, 'billing shorthand must be rejected: ' + unsafe);
  }
  assert.strictEqual(metadataSemantics('Add 99213 established patient office visit', '99213'), false, 'a clean exact-code option must remain eligible');
  const occurrenceGuard = functionBlock(driver, 'codeOccurrenceCount');
  const codeOccurrenceCount = vm.runInNewContext('(' + occurrenceGuard + ')', Object.create(null), { timeout: 100 });
  assert.strictEqual(codeOccurrenceCount('Add 99213 + 99213', '99213'), 2, 'duplicate occurrences of the requested code must not be deduplicated');
  assert(/optionOccurrenceSafe/.test(billing) && /codeOccurrenceCount\(part,\s*code\)\s*<=\s*1/.test(billing), 'every option representation must reject a repeated requested code');
  assert(/positiveOwner/.test(billing) && /explicitlyUnselectedOption/.test(billing), 'a billing option must have explicit positive add/select semantics');
  assert(/collapseToOutermostMatches\(rows\)/.test(driver) && /collapseContainedMatches\(exact\)/.test(billing), 'persisted rows must retain their outer metadata envelope while option candidates collapse inward');
  const persistedRows = functionBlock(driver, 'persistedChargeRows');
  assert(/exclude\s*&&\s*deepContains\(exclude,\s*el\)/.test(persistedRows) && /closestAcrossRoots\(el,/.test(persistedRows), 'dropdown options must not become persisted-charge evidence across shadow boundaries');
  assert(/beforeChargeRows\s*=\s*chargeRowsSnapshot/.test(billing) && /afterChargeRows\s*=\s*await\s+stableChargeRows/.test(billing), 'billing commit must snapshot all persisted charge rows before input and after a stable click readback');
  assert(/verifiedIsolatedCodeAdd\(beforeChargeRows,\s*afterChargeRows,\s*code\)/.test(billing), 'billing success must prove exactly one isolated code-row addition');
  assert(/billing-unrelated-charge-change/.test(billing), 'unrelated charge additions, removals, or row changes must return an uncertain partial result');
  const rowSnapshot = functionBlock(driver, 'chargeRowStateKey');
  assert(/deepQueryAll\(el,\s*['"]\*['"]\)/.test(rowSnapshot) && /elementAttributes\(c\)/.test(rowSnapshot) && /['"]value['"]\s+in\s+c/.test(rowSnapshot) && /selectedIndex/.test(rowSnapshot), 'persisted charge snapshots must include every descendant attribute plus visible and hidden form state');
  assert(!/input:not\(\[type=['"]hidden['"]\]\)/.test(rowSnapshot), 'hidden billing state must not be excluded from persisted-row comparison');
  const rowMetadata = functionBlock(driver, 'chargeRowHasMetadata');
  assert(/deepQueryAll\(el,\s*['"]\*['"]\)/.test(rowMetadata) && /activeMetadataDescriptor\(descriptor\)/.test(rowMetadata) && /metadataFieldSemantics\(descriptor\)/.test(rowMetadata) && /input,select,textarea/.test(rowMetadata), 'new charge rows must inspect active wrapper metadata, indexed identifiers, attributes, and hidden controls');
  const activeDescriptorGuard = functionBlock(driver, 'activeMetadataDescriptor');
  const activeMetadataDescriptor = vm.runInNewContext('(' + activeDescriptorGuard + ')', Object.create(null), { timeout: 100 });
  for (const descriptor of ['class charge-row modifier-25', 'class charge-row mod25', 'class charge-row modifier1P', 'data-config {\"modifier\":\"25\"}', 'data-state units-2', 'data-state units02', 'class dx-M54.5', 'class dxU071', 'class dx2', 'data-state active modifier']) assert.strictEqual(activeMetadataDescriptor(descriptor), true, 'active wrapper metadata must be rejected: ' + descriptor);
  assert.strictEqual(activeMetadataDescriptor('class charge-row modifier-cell'), false, 'an empty metadata column label alone is not an applied modifier');
  const isolatedAdd = functionBlock(driver, 'verifiedIsolatedCodeAdd');
  assert(/hasMetadata\s*===\s*true/.test(isolatedAdd) && /requestedOccurrences\s*!==\s*1/.test(isolatedAdd) && /row\.state/.test(isolatedAdd), 'billing success must reject metadata or a repeated code on the new row and retain exact state for every existing row');
  const preflightCommit = between(billing, '/* ATHENA_ACTION_V2_BILLING_PREFLIGHT_START */', '/* ATHENA_ACTION_V2_BILLING_PREFLIGHT_END */');
  assert(preflightCommit.indexOf('preInputRows = chargeRowsSnapshot') < preflightCommit.indexOf('setField(bill.el, preCode)'), 'billing must snapshot rows before picker input handlers can run');
  assert(/sameChargeRowState\(preInputRows,\s*prePickerRows\)/.test(preflightCommit) && /billing-input-side-effect/.test(preflightCommit), 'picker input side effects must fail closed before a billing click');
  assert(/billing-existing-row-ambiguous/.test(preflightCommit) && /chargeRowHasMetadata\(existing\[0\],\s*preCode\)/.test(preflightCommit), 'an already-present code must not be treated as exact when its row is bundled, repeated, or carries metadata');
  const billingCommit = between(billing, '/* ATHENA_ACTION_V2_BILLING_COMMIT_START */', '/* ATHENA_ACTION_V2_BILLING_COMMIT_END */');
  assert(billingCommit.indexOf('beforeChargeRows = chargeRowsSnapshot') < billingCommit.indexOf('setField(bill.el, code)'), 'the commit baseline must precede all picker input events');
  assert(/await stableChargeRows/.test(billingCommit) && /billing-readback-not-stable/.test(billingCommit), 'post-click billing verification must require a bounded stable readback window');
  const setField = functionBlock(driver, 'setField');
  assert(/isContentEditable|contenteditable/.test(setField) && /textContent\s*=/.test(setField), 'supported contenteditable billing search fields must actually receive text');

  const deepQuery = functionBlock(driver, 'deepQueryAll');
  assert(/scope\s*&&\s*scope\.shadowRoot/.test(deepQuery), 'a custom-element host passed as the root must queue its own open shadow root');
  assert(/while\s*\(\s*queue\.length\s*\)/.test(deepQuery), 'every discovered open shadow root must be drained');
  assert(!/scopesVisited|scanned\s*>=|24000/.test(deepQuery), 'hard scan/root ceilings must not hide a later nested action target');
});

if (failures.length) {
  console.error(`\n${failures.length} adversarial contract finding(s) still unsafe:`);
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f.name}: ${f.message}`));
  process.exitCode = 1;
} else {
  console.log('PASS Athena adversarial contract: exact note lane, observed identity, scoped evidence, explicit partials, and permanently manual Sign');
}
