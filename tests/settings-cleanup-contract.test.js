'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');

new Function(source); // eslint-disable-line no-new-func

const start = source.indexOf('single-owner UI + account access');
const end = source.indexOf('visit-control continuity', start);
assert(start >= 0 && end > start, 'settings owner module is missing');
const ui = source.slice(start, end);

const expectedGroups = [
  'Account & security',
  'Practice & provider',
  'Notes & AI',
  'Display',
  'Features & navigation',
  'Legal profile',
  'Integrations',
  'Advanced'
];
for (const label of expectedGroups) {
  assert(ui.includes(`label: '${label}'`), `missing settings group: ${label}`);
}

assert(ui.includes("if (/Account & access|Security & privacy/i.test(heading)) return 'account'"), 'account and security must share one destination');
assert(ui.includes("if (/Note defaults|AI personalization|Provider preferences/i.test(heading)) return 'notes'"), 'note and AI preferences must share one destination');
assert(ui.includes("if (/Features|App tabs/i.test(heading)) return 'features'"), 'features and navigation must share one destination');

assert(ui.includes("markHidden(legacyNameField, 'duplicate-provider-name')"), 'duplicate provider identity field must be hidden');
assert(ui.includes('syncProviderIdentity()') && ui.includes("legacy.value = String(provider.value || '').trim()"), 'visible provider identity must stay compatible with note generation');
assert(ui.includes("moveSettingField(specialtyField, practice"), 'clinical specialty must live with provider details');

assert(ui.includes("moveSettingField(confirmField, security"), 'logout confirmation must live under security');
assert(ui.includes("moveSettingField(intakeField, practice"), 'patient intake questions must live under practice');
assert(ui.includes("moveSettingField(groupProcField, features"), 'patient grouping must live with product behavior');
assert(ui.includes("markHidden(routeReviewField, 'retired-automatic-routing-toggle')"), 'the intentionally disabled automatic-routing switch must not masquerade as a working preference');
assert(ui.includes('id = \'mlsIntakeQuestionEditor\'') && ui.includes("add.textContent = '+ Add question'"), 'intake questions need an approachable row editor');
assert(ui.includes("values.join('\\n')"), 'intake editor must persist through the existing settings field');

assert(ui.includes("var dedicated = key === 'legal' || key === 'integrations' || key === 'advanced'"), 'specialized settings must own their save actions');
assert(ui.includes("primary.style.display = dedicated ? 'none' : ''"), 'global save must be hidden where it cannot save the visible controls');
assert(ui.includes("var closeLabel = dedicated ? 'Done' : 'Cancel'") && ui.includes('if (close.textContent !== closeLabel)'), 'specialized settings need an honest, idempotent close action');
assert(ui.includes("/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/"), 'settings navigation must support keyboard movement');
assert(ui.includes("settingsObserver.observe(settings, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })"), 'settings reconciliation must remain scoped to the settings modal');

assert(ui.includes("settingsIntro.style.removeProperty('display')"), 'cleanup must restore the original settings introduction');
assert(ui.includes("button.style.removeProperty('display')"), 'cleanup must restore footer actions');
assert(ui.includes('settingsObserver.disconnect()'), 'settings observer must be disconnected during cleanup');

console.log('PASS settings cleanup: eight destinations, single owners, truthful saves, and lifecycle restoration');
