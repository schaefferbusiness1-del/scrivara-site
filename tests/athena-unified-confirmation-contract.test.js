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
assert(/Only reviewed note write and Save Draft can be confirmed here/i.test(unified), 'UI must disclose the two allowed note lanes');
assert(/Select one READY note row/i.test(unified), 'UI must disclose the one-action trusted-click boundary');
assert(/never retries or auto-chains|never auto-chain/i.test(unified), 'UI must disclose fail-closed no-chain behavior');
assert(/Complete Sign & Save directly in Athena/.test(unified), 'Sign must be visibly manual');
assert(!/Review Sign & Save separately/.test(unified), 'verified note write must not recreate an executable Sign offer');
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

console.log('PASS unified Athena confirmation: one page/button for note lanes, exact manual final-action rows, trusted hash binding, and no Sign/billing execution offer');
