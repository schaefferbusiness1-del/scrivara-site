const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const dedupe = read('feat_athena_tooltip_dedupe.js');

assert(dedupe.includes("var TIP_STASH = 'data-mlsdd-tip'"), 'custom explainers must stash the universal data-tip source');
assert(dedupe.includes("el.removeAttribute('data-tip')"), 'custom explainers must remove the competing universal tooltip source');
assert(dedupe.includes("document.addEventListener('mouseover', guardCustomHover, true)"), 'hover capture must close the late-render race before the universal tooltip runs');
assert(dedupe.includes("document.addEventListener('mouseover', hideUniversalOnCustomHover, false)"), 'the custom explainer must win even when another owner restores its legacy tooltip during the hover event');
assert(dedupe.includes("el.closest('[role=\"tablist\"]')"), 'tablist descendants must be excluded from added hover help');
assert(dedupe.includes("getAttribute('role') || '').toLowerCase() === 'tab'"), 'role=tab controls must be excluded from added hover help');
assert(dedupe.includes("/(^|[-_\\s])(?:nav)?tab(?:[-_\\s]|$)/"), 'tab-like controls must be excluded by class as well as role');
assert(dedupe.includes('.mlsTbItem,[role="menuitem"]'), 'menu items should receive the approved clarity help');

const authPilot = read('AuthPilot.html');
assert(!/var tips=\{[^}]*tabPA|var tips=\{[^}]*tabAppeal/.test(authPilot), 'AuthPilot tabs must not receive new tooltips');

for (const file of ['AuthPilot.html', 'phone.html', 'patient-review.html', 'review-finder.html']) {
  assert(/title\s*=|\.title\s*=/.test(read(file)), `${file} should contain the focused hover explanations`);
}

console.log('PASS tooltip single-source contract: duplicates suppressed, confusing controls explained, tabs excluded');
