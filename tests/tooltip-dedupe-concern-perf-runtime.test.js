'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');
new Function(source); // eslint-disable-line no-new-func

const helpersStart = source.indexOf('  var CONCERN_SELECTORS = {');
const helpersEnd = source.indexOf('\n  function scheduleConcern(name) {', helpersStart);
assert(helpersStart >= 0 && helpersEnd > helpersStart, 'dirty-concern helper slice is missing');

const repairedTopRows = [];
const helperContext = {
  safe(fn, fallback) { try { return fn(); } catch (error) { return fallback; } },
  text(node) { return String((node && node.textContent) || '').replace(/\s+/g, ' ').trim(); },
  markHidden(node, reason) { repairedTopRows.push({ node, reason }); },
  document: {},
  console
};
vm.runInNewContext(
  source.slice(helpersStart, helpersEnd) +
    '\nthis.mutationConcerns=mutationConcerns;this.mutationAddsHowTo=mutationAddsHowTo;this.repairTopMutationRows=repairTopMutationRows;this.classToken=classToken;',
  helperContext,
  { filename: 'tooltip-dedupe-concern-helpers.js' }
);

function element(options = {}) {
  return {
    nodeType: 1,
    classList: {
      contains(token) { return (options.classes || []).includes(token); }
    },
    matches(selector) { return !!options.matches && options.matches(selector); },
    closest(selector) { return options.closest && options.closest(selector) ? this : null; },
    querySelector(selector) { return options.contains && options.contains(selector) ? {} : null; }
  };
}

const irrelevantTarget = element();
const presentationNode = element();
const irrelevantBatch = [{ type: 'childList', target: irrelevantTarget, addedNodes: [presentationNode], removedNodes: [] }];
for (const concern of ['top', 'visit', 'portal']) {
  assert.strictEqual(helperContext.mutationConcerns(concern, irrelevantBatch), false,
    concern + ' observer must ignore unrelated route/presentation insertions');
}

const visitNode = element({ matches: selector => selector.includes('.ez3fl-openws') });
assert.strictEqual(helperContext.mutationConcerns('visit', [{
  type: 'childList', target: irrelevantTarget, addedNodes: [visitNode], removedNodes: []
}]), true, 'visit owner insertion must remain repairable');

const portalSubtree = element({ contains: selector => selector === '#mlsPortalInviteBtn' });
assert.strictEqual(helperContext.mutationConcerns('portal', [{
  type: 'childList', target: irrelevantTarget, addedNodes: [portalSubtree], removedNodes: []
}]), true, 'nested exact portal action insertion must remain repairable');

const accountChild = element({ closest: selector => selector.includes('#mlsAccountAccess') });
assert.strictEqual(helperContext.mutationConcerns('top', [{
  type: 'childList', target: accountChild, addedNodes: [], removedNodes: [{}]
}]), true, 'account-owner subtree replacement must remain repairable');

const retiredGuide = element({
  matches: selector => selector === 'button',
  contains: () => false
});
retiredGuide.textContent = 'How-To Guide';
assert.strictEqual(helperContext.mutationAddsHowTo([{
  type: 'childList', target: irrelevantTarget, addedNodes: [retiredGuide], removedNodes: []
}]), true, 'an actual guide insertion must still request visibility-safe dedupe');
assert.strictEqual(helperContext.mutationAddsHowTo(irrelevantBatch), false,
  'ordinary top-menu rows must not request the layout-sensitive guide pass');

function topRow(label, id) {
  return {
    nodeType: 1,
    id: id || '',
    textContent: label,
    matches(selector) { return selector === '.mlsRdFootBtn,.mlsTbItem,#mlsRdUserChip'; },
    closest() { return null; },
    querySelectorAll() { return []; }
  };
}
const settingsRow = topRow('Settings');
const logoutRow = topRow('Log out');
const askRow = topRow('Ask');
const identityChip = topRow('Synthetic Clinician', 'mlsRdUserChip');
const rebuiltMenu = {
  nodeType: 1,
  matches() { return false; },
  closest() { return null; },
  querySelectorAll() { return [settingsRow, logoutRow, askRow, identityChip]; }
};
helperContext.repairTopMutationRows([{
  type: 'childList', target: irrelevantTarget, addedNodes: [rebuiltMenu], removedNodes: []
}]);
assert.deepStrictEqual(repairedTopRows.map(item => item.node.textContent),
  ['Settings', 'Log out', 'Synthetic Clinician'],
  'a rebuilt top menu must repair only duplicate account rows directly from its mutation batch');
assert(repairedTopRows.every(item => item.reason === 'account-menu'),
  'incremental top-row repair must retain the canonical ownership reason');

const cleanOpenSettings = element({ classes: ['show', 'mls-settings-clean'] });
assert.strictEqual(helperContext.mutationConcerns('settings', [{
  type: 'attributes', attributeName: 'class', oldValue: 'show', target: cleanOpenSettings
}]), false, 'the organizer clean-class write must not feed a second reconciliation');
assert.strictEqual(helperContext.mutationConcerns('settings', [{
  type: 'attributes', attributeName: 'class', oldValue: 'show mls-settings-clean theme-a', target: cleanOpenSettings
}]), false, 'unrelated Settings classes must not reconcile the workspace');

const newlyOpenSettings = element({ classes: ['show', 'mls-settings-clean'] });
assert.strictEqual(helperContext.mutationConcerns('settings', [{
  type: 'attributes', attributeName: 'class', oldValue: 'mls-settings-clean', target: newlyOpenSettings
}]), true, 'opening Settings must still reconcile immediately');
const ownerRemovedSettings = element({ classes: ['show'] });
assert.strictEqual(helperContext.mutationConcerns('settings', [{
  type: 'attributes', attributeName: 'class', oldValue: 'show mls-settings-clean', target: ownerRemovedSettings
}]), true, 'removing the Settings owner class must self-heal');

const scheduleStart = source.indexOf('  function scheduleConcern(name) {');
const scheduleEnd = source.indexOf('\n  function scheduleReconcile(reset) {', scheduleStart);
assert(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'shared concern scheduler slice is missing');
const callbacks = [];
const calls = { top: 0, topSkipGuide: null, visit: 0, portal: 0, guide: 0, settings: 0, auth: 0 };
const scheduleContext = {
  concernRaf: {},
  concernQueue: {},
  W: {
    requestAnimationFrame(fn) { callbacks.push({ type: 'raf', fn }); return callbacks.length; }
  },
  setTimeout(fn) { callbacks.push({ type: 'timer', fn }); return callbacks.length; },
  safe(fn) { return fn(); },
  concernNeedsWork() { return true; },
  ensureAccountAccess(skipGuide) { calls.top++; calls.topSkipGuide = skipGuide; },
  reconcileAdvanced() { calls.visit++; },
  reconcilePortalOwner() { calls.portal++; },
  dedupeHowTo() { calls.guide++; },
  reconcileSettings() { calls.settings++; },
  reconcileAuth() { calls.auth++; }
};
vm.runInNewContext(source.slice(scheduleStart, scheduleEnd) + '\nthis.scheduleConcern=scheduleConcern;', scheduleContext,
  { filename: 'tooltip-dedupe-concern-scheduler.js' });

scheduleContext.scheduleConcern('top');
scheduleContext.scheduleConcern('top');
scheduleContext.scheduleConcern('portal');
scheduleContext.scheduleConcern('visit');
assert.strictEqual(callbacks.length, 3, 'each independent concern needs its own callback while repeats still coalesce');
assert.deepStrictEqual(callbacks.map(item => item.type), ['timer', 'raf', 'raf'],
  'top repair must leave the presentation frame while visual owner repairs retain RAF timing');
callbacks.splice(0).forEach(item => item.fn());
assert.deepStrictEqual(calls, { top: 1, topSkipGuide: true, visit: 1, portal: 1, guide: 0, settings: 0, auth: 0 },
  'an independent callback must run only its own dirty concern once');

scheduleContext.scheduleConcern('guide');
scheduleContext.scheduleConcern('guide');
assert.strictEqual(callbacks.length, 1, 'repeated guide mutations must coalesce');
assert.strictEqual(callbacks[0].type, 'timer', 'layout-sensitive guide cleanup must run outside presentation RAF');
callbacks.shift().fn();
assert.strictEqual(calls.guide, 1, 'one guide insertion batch must perform one exact visibility pass');

assert(source.includes("if (queue.top && concernNeedsWork('top'))") &&
  source.includes("if (queue.visit && concernNeedsWork('visit'))") &&
  source.includes("if (queue.portal && concernNeedsWork('portal'))"),
'queued owner repairs must no-op when another writer already restored the state');
assert(source.includes("portalMountObserver = new MutationObserver(function (muts)") && source.includes("subtreeHasConcern(added[j], '#mlsCtxBar')"),
  'late portal-root recovery must ignore unrelated app-root insertions');
const topNeedsStart = source.indexOf('  function topConcernNeedsWork() {');
const topNeedsEnd = source.indexOf('\n  function visitConcernNeedsWork()', topNeedsStart);
const topNeeds = source.slice(topNeedsStart, topNeedsEnd);
assert(!topNeeds.includes("querySelectorAll('#mlsTbMenu button')"),
  'CSS-hidden retired guides must not keep the ordinary top concern permanently dirty');
assert(source.includes('if (skipGuideDedupe !== true) dedupeHowTo();') &&
  source.includes('ensureAccountAccess(true)') && source.includes("if (queue.guide) safe(dedupeHowTo)"),
  'route account repair and exact guide visibility repair must remain independently owned');

console.log('PASS tooltip/UI owner performance: scoped dirty records, settled no-ops, per-concern tasks, and isolated guide layout');
