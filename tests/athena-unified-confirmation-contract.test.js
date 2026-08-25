'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const flow = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing start marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

const unified = between(flow, '/* ---------------- unified Athena manifest review', '/* ---- identity helpers');
for (const marker of [
  'mls-athena-write-manifest-v1',
  'mlsAthenaUnifiedConfirm',
  'mlsAthenaUnifiedGo',
  'Confirm & write',
  "capability: manual ? 'manual' : 'blocked'",
  'manifestHash',
  'payloadHash',
  'rowHash',
  'not attempted',
  'uncertain',
  'state.halted = true'
]) assert(unified.includes(marker), `unified confirmation missing ${marker}`);

assert(/Object\.freeze|deepFreeze/.test(unified), 'manifest must be recursively frozen');
assert(/mode:\s*'probe'/.test(unified), 'selected action must be checked read-only before confirmation');
assert(/mode:\s*'execute'/.test(unified), 'the single confirmation entrypoint must execute one typed action');
assert(/setAttribute\('data-mls-athena-action',\s*row\.action\)/.test(unified));
assert(/setAttribute\('data-mls-preview-hash',\s*state\.manifest\.previewHash\)/.test(unified));
assert(/Only reviewed note write and Save Draft can be confirmed here/i.test(unified), 'capability-off UI must disclose the two allowed note lanes');
assert(/Reviewed note writes, Save Draft, billing staging, Sign &amp; Save, and each supported catalog-bound order run only after their own explicit confirmation/i.test(unified), 'capability-on UI must disclose the separately confirmed final-action and supported-order lanes');
/* wf3 (owner 2026-08-04, one-click rebuild): the READY row is PRE-selected and
   probed on open — "Select one" is no longer the doctor's job, so the
   one-action boundary is disclosed as what each click RUNS instead. */
assert(/One READY note row is pre-selected/i.test(unified), 'UI must disclose the pre-selected single note row');
assert(/One READY row is pre-selected and checked read-only/i.test(unified), 'capability-on UI must disclose the pre-selected single typed row');
assert(/runs exactly that one action/i.test(unified), 'UI must disclose the one-action trusted-click boundary');
assert(/never retries or auto-chains|never auto-chain/i.test(unified), 'UI must disclose fail-closed no-chain behavior');
assert(/complete Sign & Save directly in Athena/i.test(unified), 'capability-off Sign must remain visibly manual');
assert(/Sign &amp; Save unlocks only after a verified note write/i.test(unified), 'capability-on Sign must disclose its verified-write prerequisite');
assert(/athenaFinalActionsV1 === true/.test(flow), 'final-action rows are not gated by the extension capability');
assert(!/probeUnifiedRow\([^)]*sign[^)]*\)[^]{0,300}executeUnifiedSelection/.test(unified), 'Sign must not auto-chain after a new note write');

const render = between(unified, 'function renderUnifiedConfirmation(state)', 'function openUnifiedConfirmation(opts)');
assert(render.includes("document.getElementById('athenaReceipt')"), 'opening unified review must remove the legacy receipt');
assert(flow.includes("closeActionConfirm();"), 'opening unified review must remove the old per-action modal');
assert.strictEqual((render.match(/id=\\?"mlsAthenaUnifiedGo\\?"/g) || []).length, 1, 'unified page must render one Confirm & write button');

const showReceipt = between(app, 'function _athenaShowReceipt(who, results, partial, immutablePatient, sections, visitContext)', '/* Review the frozen superbill payload');
assert(showReceipt.indexOf('openUnifiedConfirmation') >= 0, 'top Athena review must delegate to the unified page');
assert(showReceipt.indexOf('openUnifiedConfirmation') < showReceipt.indexOf("document.getElementById('athenaReceipt')"), 'unified page must be preferred before the legacy fallback renders');
const superbill = between(app, 'function pushSuperbillToAthena()', '/* Preview a SAVED visit');
assert(superbill.includes('openUnifiedConfirmation'), 'Superbill must enter the same unified confirmation page');
assert(!/startAthenaAction\(['"]stage_billing['"]/.test(superbill), 'Superbill must not retain an executable billing fallback');

/* wf2-2.3.0 (owner 2026-07-22, seamless write): when the probe refuses only
   because the destination is not open, the unified review opens the exact
   identity-verified chart itself (SearchOpen) and re-probes once — no more
   "go open the chart first". Bounded and fail-closed: whitelisted not-open
   reasons only, one auto-open per review, and the single human Confirm &
   write click is unchanged. */
{
  const probeFn = between(unified, 'function probeUnifiedRow(state, rowId)', 'function receiptStateForRow(state, row)');
  assert(/AUTO_OPEN_REASONS\[probeReason\] === 1 && !state\.autoOpened/.test(probeFn), 'unified probe must auto-open only on whitelisted not-open reasons, once per review');
  assert(probeFn.includes('state.autoOpened = true;'), 'the auto-open once-flag must be consumed before dispatch');
  assert(probeFn.includes('navigateAndSearchOpenTarget(state.manifest.patient, state.manifest.visit)'), 'auto-open must navigate to the frozen encounter day before the identity-frozen SearchOpen helper');
  assert(/probeUnifiedRow\(state, row\.id\);/.test(probeFn), 'a successful auto-open must re-probe the same row');
  assert(probeFn.includes('press Check Athena again. Nothing was changed.'), 'a failed auto-open must fail closed with the manual instruction');
  assert(!/executeUnifiedSelection/.test(between(probeFn, 'AUTO_OPEN_REASONS[probeReason]', 'wf2-1.9.0')), 'auto-open must never chain into an execute');
  assert(unified.includes('autoOpened: false'), 'the unified state must initialize the once-per-review auto-open flag');
}

console.log('PASS unified Athena confirmation: one page/button, capability-off manual fallback, capability-on separately confirmed final actions, trusted hash binding, bounded auto-open, and no auto-chain');
