const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const asset = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');
const marker = '/*! visit-control continuity';
const at = asset.indexOf(marker);
assert(at >= 0, 'visit-control continuity module is missing');
const code = asset.slice(at);

// The additive asset must remain valid JavaScript and must not edit or depend
// on any browser-extension surface.
new vm.Script(code, { filename: 'visit-control-continuity.js' });
assert(!/chrome\.|browser\.|extension/i.test(code), 'website continuity fix must not touch the extension');

// The viewport handoff may still update inline state, but it can no longer
// hide the three fixed desktop controls. Athena tab is intentionally not in
// this override selector.
const fixedRule = code.match(/html body\.mls-top-voice-tools #mlsCopVoiceBtn,[\s\S]*?pointer-events:auto!important;\}/);
assert(fixedRule, 'fixed voice-control visibility override is missing');
['#mlsCopVoiceBtn', '#mlsAsstFab', '#mlsDaDock'].forEach(id => {
  assert(fixedRule[0].includes(id), `${id} is not stabilized`);
});
assert(!fixedRule[0].includes('#mlsTabPickerChip'), 'Athena tab must keep its existing behavior');

// The four buried actions are intercepted before the legacy handler can open
// Advanced Workspace. They open the real modal/action instead.
['paste a transcript', 'record on phone', 'after-visit summary'].forEach(label => {
  assert(code.includes(`text.indexOf('${label}')`), `missing Quick Tool action: ${label}`);
});
assert(code.includes("/\\borders\\b/.test(text)"), 'missing Orders Quick Tool action');
assert(code.includes('ev.stopImmediatePropagation()'), 'legacy Advanced Workspace handler is not suppressed');
assert(!code.includes('openWorkspace('), 'continuity module must not route Quick Tools through Advanced Workspace');
assert(code.includes("W.__mlsAfterVisitSummary") && code.includes("avs.open()"), 'After-visit summary must open its real review modal');
assert(code.includes("W.startPhoneMic") && code.includes("phoneMicQR"), 'phone recording must use the real pairing flow in its popup');
assert(code.includes("W.showView('orders')"), 'Orders popup must lead to the dedicated Orders page');
assert(code.includes("MODAL_ID = 'mlsQuickToolPopup'"), 'in-place Quick Tool dialog is missing');

// The day-progress label has two writers. The short 15-second legacy write is
// normalized before paint and its final width is reserved, preventing the
// intermittent compressed blue-pill/header reflow shown by the owner.
assert(code.includes("flex:0 0 361px;min-width:361px"), 'day-progress final width is not reserved');
assert(asset.includes("continuityStyle.__mlsStabilizePatientBar();"), 'patient-bar same-frame shared mutation pass is missing');
assert(code.includes("st.__mlsStabilizePatientBar = stabilizePatientBar"), 'patient-bar stabilizer must survive global cleanup');
assert(code.includes("document.body.classList.contains('mls-has-active-pt')"), 'active-patient ownership guard is missing');
assert(code.includes("Math.max(0, currentCounts.total - currentCounts.seen) + ' remaining'"), 'temporary day-progress label is not normalized');

console.log('PASS visit-control continuity: fixed voice row, in-place Quick Tool dialogs, stable day-progress header');
