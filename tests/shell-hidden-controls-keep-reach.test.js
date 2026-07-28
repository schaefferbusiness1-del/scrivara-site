'use strict';
/*
 * Anything the Calm Shell HIDES must keep a route to it.
 *
 * Why this exists. b560 folded three floating pills into the dock's Copilot
 * button and hid #mlsCopVoiceBtn, #mlsAsstFab and #mlsDaDock with CSS. The
 * dock's Copilot opens askCopilotHdrBtn - a DIFFERENT surface - so the only
 * remaining route to Copilot Voice, the MLS Assistant panel and
 * dictate-into-the-transcript was a row of chips on the Visit screen. On Today,
 * Patients or Review those three capabilities had no reach at all, for twenty
 * builds, and nobody noticed.
 *
 * tests/ui-control-coverage.test.js did not catch it because
 * tools/ui-control-inventory.js walks ScribeFlow.html and feat_*.js only -
 * mls-connect.js, where these three controls are created, is not in its source
 * list. Re-scoping that inventory is a much larger change; this suite closes the
 * specific hole: every id the shell hides must either be offered in
 * TOOLS_SOURCES or be listed below with a reason.
 *
 * The owner's standing rule is ease of use WITHOUT losing features. Hiding is
 * how the shell delivers the first half; this is what keeps the second.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

/* Ids hidden by a `body.mls-calm … #id{display:none}` rule.
 *
 * Take the LAST compound in the selector, not the first id in it: a rule like
 *   body.mls-calm #ptSplitWrap.px-has-profile #ptList{display:none}
 * hides #ptList and merely SCOPES on #ptSplitWrap. A first-id regex reported
 * every scope container as stranded — appWrap, profileCard, ez3Wrap — which is
 * the same class of mistake this suite exists to catch, made in the suite.
 * Selectors whose target is a class (…#appWrap .mainnav) are skipped: this
 * guard is about ids, and .mainnav is covered by the dock wholesale. */
const hidden = new Set();
const RULE = /(body\.mls-calm[^'{]*)\{display:none/g;
let m;
while ((m = RULE.exec(shell))) {
  for (const selector of m[1].split(',')) {
    const compounds = selector.trim().split(/\s*>\s*|\s+/).filter(Boolean);
    const target = compounds[compounds.length - 1];
    if (!target || target[0] !== '#') continue;
    const id = /^#([A-Za-z][\w-]*)/.exec(target);
    if (id) hidden.add(id[1]);
  }
}

/* Ids the shell offers in its Tools menu. */
const offered = new Set();
const TOOLS = /\{\s*id:\s*'([^']+)'/g;
while ((m = TOOLS.exec(shell))) offered.add(m[1]);

/* Hidden on purpose, with no Tools entry needed. Each needs a reason. */
const EXEMPT = {
  'mls-ask-btn': '2026-07-28 owner sweep: the dock Ask bar and the dock Copilot are the two owners of ask-your-data; the header button and its Tools row were third and fourth doors to the same room',
  mlsRdNav: 'the redesign rail - the dock replaces it wholesale and reaches every one of its tabs',
  mlsRdRailBtn: 'b730: the mobile burger whose ONLY function is opening mlsRdNav (exempt above) - with the rail gone it opened a scrim over nothing; hiding it removes a dead control, not a feature',
  mlsEz3Head: 'hidden only when :empty; it is a heading, not a control',
  mlsDaDock: 'offered as "Dictate" - kept here too because the id also names a dock wrapper',
  mlsPdpWrap: 'a wrapper; its control #mlsPdpSel is offered as "Where pulls run"',
  mlsDsVisitTgl: 'a wrapper; its control #mlsDsVisitBodies is offered as "Full visit notes"',
  ptList: 'folded only under 700px while a profile is open, and returns on :focus-within of the search row',
};

const stranded = [];
for (const id of hidden) {
  if (offered.has(id)) continue;
  if (Object.prototype.hasOwnProperty.call(EXEMPT, id)) continue;
  stranded.push(id);
}

assert.deepStrictEqual(stranded, [],
  'the Calm Shell hides these controls with no Tools entry and no documented exemption:\n  ' +
  stranded.join('\n  ') +
  '\nHiding a control without a route to it removes a feature. Add it to\n' +
  'TOOLS_SOURCES, or add it to EXEMPT here with the reason it needs no route.');

/* The stranded controls must stay offered - this is the regression the suite
 * was written for. 2026-07-28: mlsCopVoiceBtn left this list with the feature
 * itself - the owner retired Copilot Voice entirely (its creators, the b39
 * inline block and the v2 satellite, are both stood down, so the node never
 * exists to strand). */
for (const id of ['mlsAsstFab', 'mlsDaDock']) {
  assert(offered.has(id),
    id + ' lost its Tools entry. Its floating pill is hidden by the shell, so ' +
    'Tools is the only route to it outside the Visit screen.');
}
assert(!offered.has('mlsCopVoiceBtn'),
  'Copilot Voice is retired (2026-07-28 owner order) - a Tools entry for it would be a dead control');

console.log('PASS shell hidden controls keep reach: ' + hidden.size + ' hidden ids, ' +
  Object.keys(EXEMPT).length + ' documented exemptions, 0 stranded');
