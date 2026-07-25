'use strict';

/*
 * acn-1.0.0 — a control's accessible name must read the way the control reads.
 *
 * The owner's complaint was "Start Recording — Atoussa Salimi7:30 AM": a
 * surname welded to a time, in a patient's name, on a clinical screen. Three
 * fixes were attempted before this one and each was wrong in an instructive
 * way, so all three are pinned here:
 *
 *   1. CSS. `#mlsRightNow button small{display:block}` (f044967) was parsed,
 *      shipped, and DEAD — the bar assigns textContent, so it contains no
 *      <small> to style. Removed. A CSS rule can never fix this.
 *   2. The shared label string. Adding a separator to the markup repairs the
 *      right-now bar and breaks the ez3 shell, where `.ez3-big small` is
 *      display:block and already renders on its own line.
 *   3. Per-shape. idc-1.0.0 fixed the one shape that splits on an em dash;
 *      "Pull from Athena" and every other composite kept shipping welded.
 *
 * The fix is central: derive the label once, from the element's own children,
 * dropping what the element itself hides and separating what it breaks.
 *
 * WHY THIS SUITE EXISTS AT ALL. Two of these shapes were measured wrong on the
 * running page before they were measured right, and one shipped in b582 with no
 * test at all. Every case below is a shape observed live, with the exact
 * computed styles that decided it, so the next person changing controlLabel
 * finds out here rather than from a doctor.
 *
 * Both arms: each case asserts the welded string is ABSENT as well as the
 * correct string present, so an implementation that merely returns textContent
 * fails, and so does one that separates too eagerly.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

/* ---------------------------------------------------------------- wiring --
 * Static first: a perfect controlLabel is worth nothing if nothing calls it.
 */

assert(/b\.textContent = p\.as \|\| controlLabel\(p\.el\)/.test(shell),
  'the right-now bar must label its buttons with controlLabel, not textOf');
assert(/b\.title = 'Runs "' \+ controlLabel\(p\.el\)/.test(shell),
  'the right-now bar tooltip must use controlLabel — it is the only place the doctor is told which real control runs');
assert(/label: controlLabel/.test(shell),
  'controlLabel must stay exported as __mlsCalmShell.label; live verification on the running page is the only check that counts here');
assert(/var label = controlLabel\(el\);/.test(shell),
  'the Ask index must resolve controls by derived label');
assert(/label: spec\.as \|\| controlLabel\(el\)/.test(shell),
  'the Tools menu must use derived labels');

const renderNow = shell.slice(shell.indexOf('function renderNow()'), shell.indexOf('W.__mlsCalmShell = {'));
assert(renderNow.indexOf('safe(identityCards)') < renderNow.indexOf('safe(nameControls)'),
  'nameControls must run after identityCards so it never overwrites that pass\'s own aria-label');
assert(/acnEpoch\+\+/.test(renderNow),
  'the naming epoch must advance on a destination change, or a verdict cached during a styleless moment is cached for the life of the page');

const teardown = shell.slice(shell.indexOf('function teardown()'), shell.indexOf('function typingTarget()'));
assert(/safe\(dropControlNames\)/.test(teardown),
  'Classic must leave no shell-authored aria-label behind');

const nameControls = shell.slice(shell.indexOf('function nameControls()'), shell.indexOf('function dropControlNames()'));
assert(/if \(el\.getAttribute\('aria-label'\) && !stamped\) return;/.test(nameControls),
  'an aria-label the app set is a decision by that control\'s owner and must never be overwritten');
assert(/if \(!onScreen\(el\)\) return;/.test(nameControls) && !/visible\(el\)/.test(nameControls),
  'naming must gate on being on screen, not on being operable: visible() rejects disabled controls, which left the disabled Pay Reports card announcing a welded name at b582');
assert(/data-mls-acn/.test(nameControls) && /data-mls-acn/.test(shell.slice(shell.indexOf('function dropControlNames()'))),
  'every name this shell adds must be stamped so teardown removes exactly what it added');

/* ------------------------------------------------------- the real code --
 * normLabel / textOf / labelHidden / labelBlocky / controlLabel, lifted out of
 * the shipped file and run against a hand-rolled DOM (repo convention: no
 * jsdom). Style is the thing that decides every case here, so getComputedStyle
 * is the stub's whole job — a copy of the logic would prove nothing.
 */

const START = shell.indexOf('  function normLabel(t) {');
const END = shell.indexOf('  /* ---------------------------------------------------------------- enable */');
assert(START > 0 && END > START, 'label derivation block could not be bounded');
const block = shell.slice(START, END);
assert(/function controlLabel\(el, depth\)/.test(block), 'controlLabel must take a depth — it recurses');

const sandbox = {
  W: { getComputedStyle: (n) => n.__cs || { display: 'inline', visibility: 'visible', opacity: '1' } }
};
vm.createContext(sandbox);
vm.runInContext('(function(){' + block + '\nthis.controlLabel = controlLabel;\nthis.normLabel = normLabel;\n}).call(this)', sandbox);
const controlLabel = sandbox.controlLabel;

let seq = 0;
function text(value) { return { nodeType: 3, nodeValue: value }; }
function el(tag, style, kids, attrs) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    _seq: ++seq,
    childNodes: kids || [],
    __cs: style || { display: 'inline', visibility: 'visible', opacity: '1' },
    _attrs: attrs || {},
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; }
  };
  Object.defineProperty(node, 'textContent', {
    get() {
      return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
    }
  });
  return node;
}
const BLOCK = { display: 'block', visibility: 'visible', opacity: '1' };
const FLEX = { display: 'flex', visibility: 'visible', opacity: '1' };
const INLINE = { display: 'inline', visibility: 'visible', opacity: '1' };
const INLINE_BLOCK = { display: 'inline-block', visibility: 'visible', opacity: '1' };
const NONE = { display: 'none', visibility: 'visible', opacity: '1' };
const TOOLTIP = { display: 'block', visibility: 'hidden', opacity: '0' };

/* 1. #ptPullAthenaBtn, the shape the handoff proved still broken at b569.
 *    Live textContent:
 *      "📥 Pull from AthenaOpens this patient's chart in your signed-in Athena
 *       tab (read-only)…READ-ONLYOpens this patient's chart…"
 *    A hidden sub-label and a hover tooltip were being published as part of a
 *    button's name — worse than a missing separator, because it is text the
 *    doctor never chose to read and the Ask index searches it. */
{
  const btn = el('button', INLINE, [
    text('\u{1F4E5} Pull from Athena'),
    el('span', NONE, [text('Opens this patient’s chart in your signed-in Athena tab (read-only).')]),
    el('br', INLINE, []),
    el('span', INLINE_BLOCK, [text('READ-ONLY')]),
    el('span', TOOLTIP, [text('Opens this patient’s chart…')], { role: 'tooltip' })
  ]);
  const got = controlLabel(btn);
  assert.strictEqual(got, 'Pull from Athena · READ-ONLY', 'ptPullAthenaBtn label: got ' + JSON.stringify(got));
  assert(!/AthenaOpens/.test(got), 'the hidden sub-label is welded back onto the name');
  assert(!/tooltip|chart…/.test(got), 'a hover tooltip is being published as part of the button name');
}

/* 2. .mlsctx-id — the patient header, TWO levels deep. This is the case a
 *    non-recursive implementation gets wrong, and it was live at b581:
 *      "SOSample Patient OneAge 51 yrs51y F · DOB 01/15/1975 · MRN SAMPLE-001"
 *    Separating one level pushes the child's whole flattened subtree, so the
 *    patient's surname stays welded to a hidden age chip and then to their sex.
 *    In the patient header, announced to every screen-reader user. */
{
  const header = el('div', FLEX, [
    el('span', FLEX, [text('SO')]),
    el('span', FLEX, [
      el('span', BLOCK, [text('Sample Patient One')]),
      el('span', NONE, [el('span', INLINE_BLOCK, []), el('span', INLINE, [text('Age 51 yrs')])]),
      el('span', BLOCK, [text('51y F · DOB 01/15/1975 · MRN SAMPLE-001')])
    ])
  ], { role: 'button' });
  const got = controlLabel(header);
  assert.strictEqual(got, 'SO · Sample Patient One · 51y F · DOB 01/15/1975 · MRN SAMPLE-001',
    'patient header label: got ' + JSON.stringify(got));
  assert(!/OneAge/.test(got), 'the patient\'s surname is welded to the age chip — the exact defect the owner reported');
  assert(!/Age 51 yrs/.test(got), 'a display:none chip nested two levels down is still in the name; the hidden test must apply at every depth');
  assert(!/SOSample/.test(got), 'the avatar initials are welded onto the patient\'s name');
}

/* 3. .ez3-qchip — "8:10 AM" + "Sample O." as two INLINE spans with no
 *    whitespace in the markup. The block branch never sees this shape, so it
 *    reproduces the owner's original complaint exactly: a time welded to a
 *    patient's surname. One space, not ' · ': these render on one line, and a
 *    middot would claim a break the eye does not see. */
{
  const chip = el('button', INLINE, [
    el('span', INLINE, [text('8:10 AM')]),
    el('span', INLINE, [text('Sample O.')])
  ]);
  const got = controlLabel(chip);
  assert.strictEqual(got, '8:10 AM Sample O.', 'quick chip label: got ' + JSON.stringify(got));
  assert(!/AMSample/.test(got), 'the appointment time is welded to the patient\'s surname');
  assert(!/·/.test(got), 'an inline boundary must not claim a line break that does not exist');
}

/* 4. The ez3 <small> shape, which is CORRECT on screen and wrong only when
 *    flattened. display:block, so it earns a real separator. */
{
  const btn = el('button', INLINE, [
    text('\u{1F465} Choose patient'),
    el('small', BLOCK, [text('2 on today’s schedule')])
  ]);
  const got = controlLabel(btn);
  assert.strictEqual(got, 'Choose patient · 2 on today’s schedule', 'ez3Choose label: got ' + JSON.stringify(got));
  assert(!/patient2/.test(got), 'a block child must not weld onto the text before it');
}

/* 5. Whitespace already in the markup is not doubled — the common case must
 *    come through untouched, or every label in the app grows separators. */
{
  const tab = el('button', INLINE, [text('Patients '), el('span', INLINE, [text('8')])]);
  assert.strictEqual(controlLabel(tab), 'Patients 8', 'a markup space must be left alone');
}

/* 6. Depth is capped rather than trusted. A pathological or cyclic-looking
 *    tree must degrade to flattened text, never recurse without bound. */
{
  let node = el('span', BLOCK, [text('leaf')]);
  for (let i = 0; i < 12; i++) node = el('span', BLOCK, [node]);
  const btn = el('button', INLINE, [node]);
  assert.strictEqual(controlLabel(btn), 'leaf', 'a deep tree must still resolve to its text');
}

/* 7. An element whose every child is hidden still needs a name, or Ask drops
 *    the control entirely (`if (!label) return`) and a real feature loses its
 *    only keyboard route. Falling back to flattened text is the pre-existing
 *    behaviour and is deliberately preserved. */
{
  const btn = el('button', INLINE, [el('span', NONE, [text('only hidden text')])]);
  assert.strictEqual(controlLabel(btn), 'only hidden text', 'a control whose children are all hidden must still resolve to a name');
}

console.log('PASS control accessible names: composite labels separate at every depth, drop hidden text and tooltips, and are published as the accessible name without overwriting the app\'s own');
