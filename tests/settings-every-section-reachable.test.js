'use strict';

/* EVERY SETTINGS SECTION MUST BE REACHABLE FROM SOME TAB.
 *
 * The organized Settings workspace (feat_athena_tooltip_dedupe.js) builds its rail from
 * GROUPS and shows a section only when `settingsGroupFor(section) === selectedKey`
 * (selectSettingsGroup). A heading that matches none of the classifier's patterns
 * returns '' — which equals no key — so the section stays in the DOM and can never be
 * displayed by any tab. It is invisible, silently, with no error anywhere.
 *
 * MEASURED 2026-08-08, before this file existed: "🔌 MLS Assist extension" matched
 * nothing, so the extension download, the install steps and the update instructions
 * were unreachable from Settings entirely — 1 of 12 sections. Nobody noticed because
 * the failure mode of an unmapped heading is silence.
 *
 * This is a CLASS check, not a list of known sections: it reads the real headings out
 * of ScribeFlow.html and runs the real classifier out of the module, so a section added
 * tomorrow with an unmapped heading fails here instead of shipping invisible.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const mod = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');

/* the real headings, in document order, with entities decoded and markup stripped */
const heads = [...html.matchAll(/class="set-head">([\s\S]*?)<\/p>/g)]
  .map((m) => m[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim())
  .filter(Boolean);
assert.ok(heads.length >= 10, 'expected the full Settings section set; found ' + heads.length);

/* the real classifier and the real group table, LIFTED not retyped — a paraphrase of the
   code under test proves only that the paraphrase works */
const sliceFrom = mod.indexOf('function settingsGroupFor');
const sliceTo = mod.indexOf('function settingsIsLawyer');
assert.ok(sliceFrom > 0 && sliceTo > sliceFrom, 'could not locate settingsGroupFor / SETTINGS_GROUPS in the organizer');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  'function settingsHeading(section){ return String(section.heading || ""); }\n' +
  mod.slice(sliceFrom, sliceTo) +
  '\nthis.groupFor = settingsGroupFor; this.GROUPS = SETTINGS_GROUPS;',
  sandbox
);
const keys = sandbox.GROUPS.map((g) => g.key);

const orphans = heads.filter((h) => {
  const k = sandbox.groupFor({ heading: h });
  return !k || keys.indexOf(k) < 0;
});
assert.deepStrictEqual(orphans, [],
  'these Settings sections are reachable from NO tab — the organizer only shows a section whose group equals the selected key, so an unmapped heading is invisible with no error: ' +
  JSON.stringify(orphans) + '. Add a pattern to settingsGroupFor (and a group to SETTINGS_GROUPS if it deserves its own tab).');

/* the owner asked for the avatar in Settings, "easily found" — so it must have its own
   tab rather than being buried inside another section's pane */
assert.strictEqual(sandbox.groupFor({ heading: '🧑‍⚕️ Patient check-in avatar' }), 'avatar',
  'the check-in avatar section lost its group — it would become unreachable from Settings');
assert.ok(keys.indexOf('avatar') >= 0, 'the avatar group left the rail');
assert.ok(/id="avatarSettingsSection"/.test(html) && /id="mlsAvSettingsHost"/.test(html),
  'the avatar Settings section or its mount host was removed from ScribeFlow.html');
/* the form is MOUNTED, never copied: a second set of controls here would be a second
   source of truth for the questions a patient is asked */
assert.ok(!/mlsAvLook_skin/.test(html),
  'appearance controls were copied into ScribeFlow.html — setupForm owns that markup, and two sources of truth for a patient interview drift apart');

/* a lawyer account is not a clinician and must not see the clinical avatar */
const lawyerGate = mod.slice(mod.indexOf('function allowedSettingsGroup'), mod.indexOf('function allowedSettingsGroup') + 260);
assert.ok(/key === 'account'/.test(lawyerGate) && /key === 'display'/.test(lawyerGate) && !/avatar/.test(lawyerGate),
  'the lawyer gate changed shape — the avatar group must stay outside the allow-list a lawyer account can see');

console.log('settings-every-section-reachable.test.js: OK — ' + heads.length +
  ' sections, 0 orphaned (measured against the real classifier), the check-in avatar has its own tab, ' +
  'its form is mounted rather than copied, and a lawyer account cannot reach it');
