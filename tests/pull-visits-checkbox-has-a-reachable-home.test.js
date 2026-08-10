'use strict';
/*
 * THE PULL-VISITS CHECK MARK MUST HAVE A ROUTE THAT ACTUALLY RENDERS.
 *
 * Owner, 2026-07-28: "And the check mark that lets you pull visits is gone and
 * needs to be added back but not next to the pool today in the settings option."
 *
 * The Settings home already existed (b743, live since before b756). What did
 * not exist was any route that showed it to him:
 *
 *   - feat_mls_calm_shell.js hides the inline toggle beside Pull today with
 *     body.mls-calm #mlsDsStrip > #mlsDsVisitTgl{display:none!important}
 *   - the compensating Tools > Data row NEVER rendered, because toolsResolve()
 *     rejects a control for having no derivable name one line BEFORE `spec.as`
 *     is consulted. A bare <input type=checkbox> has empty textContent and
 *     keeps its title/aria-label on the wrapping <label>, so textOf() === ''.
 *   - shell-hidden-controls-keep-reach.test.js exempted the hidden wrapper
 *     *because* that row was "offered", and proved "offered" by regex-matching
 *     the spec literal in the source.
 *
 * That last point is why this suite is written the way it is. Matching the
 * spec literal is what let the hole survive: the spec was always present and
 * the row was always absent. So this suite EXECUTES the shipped resolver
 * against a stub shaped exactly like the real control and asserts a row comes
 * back - and it proves it can tell the difference, by resolving a control that
 * does carry its own text and refusing one that is not in the DOM at all.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = process.env.MLS_ROOT || path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');

/* ------------------------------------------------ lift the shipped resolver */

function grab(name) {
  const start = shell.indexOf('function ' + name + '(');
  assert(start > 0, 'feat_mls_calm_shell.js no longer defines ' + name +
    ' - this suite executes the real resolver and must be re-pointed, not deleted');
  let i = shell.indexOf('{', start), depth = 0, end = -1;
  for (; i < shell.length; i++) {
    if (shell[i] === '{') depth++;
    else if (shell[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  assert(end > start, 'could not bound ' + name);
  return shell.slice(start, end);
}

const D = { getElementById: (id) => stubFor(id) };
const resolver = new Function('D', 'qs', 'qsa', 'safe',
  ['normLabel', 'textOf', 'available', 'controlLabel', 'toolsResolve'].map(grab).join('\n') +
  '\nreturn { textOf: textOf, available: available, toolsResolve: toolsResolve };'
)(D, () => null, () => [], (fn) => { try { return fn(); } catch (e) { return undefined; } });

/* The exact shape mls-connect.js:44077 and ScribeFlow.html:4835 both build:
   a bare checkbox. No textContent, and no title/aria-label of its own - those
   sit on the wrapping <label>. */
const bareCheckbox = (id) => ({
  id, tagName: 'INPUT', type: 'checkbox', hidden: false, disabled: false,
  textContent: '', childNodes: [], style: {}, getAttribute: () => null,
});
const namedButton = (id, text) => ({
  id, tagName: 'BUTTON', hidden: false, disabled: false,
  textContent: text, childNodes: [], style: {}, getAttribute: () => null,
});

let stubFor = () => null;

/* ---------------------------------- the row the shell declares for this pref */

const dataGroup = shell.slice(shell.indexOf("{ id: 'data', label: 'Data'"), shell.indexOf("{ id: 'app', label: 'App'"));
assert(dataGroup.length > 40, 'the Tools > Data group is gone');

const specLine = dataGroup.split('\n').find((l) => /as:\s*'Full visit notes'/.test(l));
assert(specLine, 'the Tools menu no longer declares a "Full visit notes" row at all');

const specId = (/\bid:\s*'([A-Za-z][\w-]*)'/.exec(specLine) || [])[1];
assert(specId, 'the "Full visit notes" row declares no id');

/* (b) his placement request: NOT the checkbox beside Pull today. */
assert.notStrictEqual(specId, 'mlsDsVisitBodies',
  'the Tools row still targets #mlsDsVisitBodies - the checkbox beside Pull today. ' +
  'The owner asked for this control in Settings, explicitly not there.');
assert.strictEqual(specId, 'setPullVisitBodies',
  'the row must target the Settings copy of the preference (#setPullVisitBodies)');

/* (a) the row must actually RENDER. This is the assertion the old suite could
   not make, and the one that was false for every build since the shell landed. */
stubFor = (id) => (id === specId ? bareCheckbox(id) : null);
const spec = { id: specId, as: 'Full visit notes', reveal: 'integrations' };
const row = resolver.toolsResolve(spec);

assert(row, 'toolsResolve() DROPS the "Full visit notes" row: textOf(' +
  JSON.stringify(resolver.textOf(bareCheckbox(specId))) + ') is empty for a bare checkbox, ' +
  'and the guard rejects the element before spec.as is read. The control is hidden ' +
  'in the day strip AND absent from Tools - it has no route at all.');
assert.strictEqual(row.label, 'Full visit notes', 'the declared label must be what the row shows');

/* --------- NON-VACUITY: the harness must be able to say no, and to say yes --- */

stubFor = () => namedButton('mls-ask-btn', 'Ask your data');
assert(resolver.toolsResolve({ id: 'mls-ask-btn', as: 'Ask your data' }),
  'harness is broken: a control that carries its own text must still resolve');

stubFor = () => null;
assert.strictEqual(resolver.toolsResolve({ id: 'nope', as: 'Nope' }), null,
  'harness is broken: a control absent from the DOM must NOT resolve');

stubFor = () => Object.assign(bareCheckbox('gated'), { disabled: true });
assert.strictEqual(resolver.toolsResolve({ id: 'gated', as: 'Gated' }), null,
  'harness is broken: a control the APP gated must still be refused - the fix ' +
  'may only relax the NAME guard, never the availability guard');

/* --------------------------- the row is shown in Settings, not fired blind --- */

stubFor = (id) => (id === specId ? bareCheckbox(id) : null);
assert.strictEqual(resolver.toolsResolve(spec).reveal, 'integrations',
  'toolsResolve must carry `reveal` onto the row, or the click handler cannot route it');

assert(/function revealSetting\(/.test(shell),
  'a Settings-resident control must be REVEALED, not clicked: with the modal closed, ' +
  'el.click() flips a checkbox he cannot see - the same complaint in a new place');
assert(/if \(it\.reveal\) \{ revealSetting\(it\); return; \}\s*\n\s*runControl\(it\.el\);/.test(shell),
  'the Tools row click must route reveal rows to revealSetting BEFORE runControl');
assert(/scrollIntoView\(\{ block: 'center' \}\)/.test(shell),
  "reveal must scroll with block:'center' - 'nearest' parks the control under the fixed dock");

/* ------------------------------- one stored truth, both consumers still served */

assert(/id="setPullVisitBodies"/.test(app), 'the Settings checkbox must still exist');
assert(app.includes('r.write(cb.checked===true)'),
  'Settings must keep writing THROUGH the ONE resolver the importer consults (qol-2.0)');
assert(app.includes("getElementById('mlsDsVisitBodies')") && app.includes('inline.checked=cb.checked'),
  'Settings must keep mirroring the inline node');
assert(connect.includes('id="mlsDsVisitBodies"'),
  'the inline node must keep existing: the relay job payload and the pull dedupe ' +
  'identity both read it (mls-connect.js:45272, :45289)');
assert(/body\.mls-calm[^'{]*#mlsDsVisitTgl\{display:none/.test(shell),
  'the inline toggle stays hidden beside Pull today - that half is what he asked for');

console.log('PASS pull-visits check mark has a reachable home: Tools row RESOLVES (executed, ' +
  'not grepped), targets #' + specId + ' in Settings, revealed not fired, one stored truth intact');
