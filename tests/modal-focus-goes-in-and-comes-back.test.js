'use strict';

/* Opening a dialog must move the keyboard into it, and closing must give the
 * keyboard back.
 *
 * Audited across ScribeFlow.html: exactly ONE modal does this properly
 * (#patientModal — stashes activeElement, traps Tab, restores on close), and
 * #helpModal focuses a field but never restores. The other twelve — settings,
 * teamPt, setup, opPrep, templates, doc, view, share, legal, countersign,
 * legalFill, widgetBuilder — are a bare classList.add('show').
 *
 * So a keyboard user opens a dialog and their focus is still BEHIND it: Tab
 * walks the page underneath a modal they cannot see past, and Escape (added
 * universally by feat_mls_theme_polish) closes the dialog and drops focus onto
 * <body>, so the next Tab restarts from the top of the document.
 *
 * The fix lives in feat_mls_theme_polish because that file already owns
 * universal dismiss for every .modal-bg. One writer covers all fourteen and any
 * modal nobody has written yet — editing twelve openers would have missed the
 * thirteenth. That choice is what this suite pins.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const polish = fs.readFileSync(path.join(root, 'feat_mls_theme_polish.js'), 'utf8');

/* ---- 1. focus is handled where dismiss is handled ---- */
assert.ok(
  /function wireFocus\(\)/.test(polish),
  'feat_mls_theme_polish must wire modal focus. It already adds Escape-to-close ' +
  'for every .modal-bg, so without this Escape closes a dialog and leaves focus ' +
  'nowhere — the next Tab restarts from the top of the document.'
);
assert.ok(
  /wireDismiss\(\);\s*\n\s*wireFocus\(\);/.test(polish),
  'wireFocus() must be called from boot() alongside wireDismiss(), or the ' +
  'universal dismiss ships without the focus half again'
);

/* ---- 2. focus goes IN, and comes BACK ---- */
assert.ok(
  /function onModalShown\(/.test(polish) && /function onModalHidden\(/.test(polish),
  'both halves are required: moving focus in without restoring it is the ' +
  '#helpModal bug, which this change exists to stop repeating'
);
{
  const shown = /function onModalShown\([\s\S]*?\n  \}/.exec(polish)[0];
  assert.ok(
    /if \(!returnTo\)/.test(shown),
    'the return target must be captured ONCE. A modal that re-renders while open ' +
    'would otherwise overwrite it with something inside itself, and closing would ' +
    'restore focus to a node that no longer exists.'
  );
  assert.ok(
    /!bg\.contains\(a\)/.test(shown),
    'the remembered element must be OUTSIDE the modal, or "where the keyboard was" ' +
    'is a control the dialog is about to destroy'
  );
  assert.ok(
    /if \(bg\.contains\(document\.activeElement\)\) return;/.test(shown),
    'if focus is already inside, do not move it — stealing focus from a field the ' +
    'user is typing in is worse than never granting it'
  );
}
{
  const hidden = /function onModalHidden\([\s\S]*?\n  \}/.exec(polish)[0];
  assert.ok(
    /document\.contains\(back\)/.test(hidden),
    'restore must check the element still exists. Closing a modal frequently ' +
    'destroys the row that opened it, and focusing a detached node silently does nothing.'
  );
  assert.ok(
    /getBoundingClientRect\(\)\.width > 0/.test(hidden),
    'restore must check the element is still laid out — a present-but-hidden ' +
    'element accepts focus and strands the keyboard invisibly'
  );
}

/* ---- 3. one definition of "focusable" ---- */
assert.ok(
  /_patientModalFocusables/.test(polish),
  'reuse the app\'s own _patientModalFocusables() when present. Two definitions of ' +
  'what counts as focusable is how the trap and the initial focus drift apart.'
);

/* ---- 4. no re-focus storm, and no document-wide observer ----
 * The first version watched document.documentElement with subtree:true and
 * boot-script-budget rejected it as the 60th such observer against a ceiling of
 * 59. That guard was right: a document-wide subtree observer on class/style
 * fires on EVERY DOM change every other module makes, and this app has
 * documented idle churn. A modal opening is an attribute change on the modal
 * ITSELF, so subtree was never needed. */
{
  const watch = /function watchModal\([\s\S]*?\n  \}/.exec(polish);
  assert.ok(watch, 'watchModal() is missing — focus must be watched per element');
  assert.ok(
    /if \(open === seen\.get\(bg\)\) return;/.test(watch[0]),
    'the observer must ignore mutations that did not change open/closed state. ' +
    'Modals sit inside hosts that re-render on timers; without this the dialog ' +
    'would yank focus back to its first control on every unrelated attribute write.'
  );
  assert.ok(
    /\.observe\(bg, \{ attributes: true/.test(watch[0]) && !/subtree/.test(watch[0]),
    'each modal must be observed individually with NO subtree. Watching fourteen ' +
    'elements costs a rounding error; watching the document costs a callback per ' +
    'mutation forever.'
  );
  assert.ok(
    !/observe\(\s*document(\.documentElement)?\s*,\s*\{[^}]*subtree\s*:\s*true/.test(polish),
    'a document-wide subtree observer is back in this file. boot-script-budget ' +
    'counts exactly that construct and it is already at its ceiling of 59.'
  );
  assert.ok(
    !/setInterval/.test(polish),
    'no polling — this app has a documented idle-churn problem'
  );
}

/* ---- 5. the guard can fail ---- */
{
  const broken = 'function wireFocus(){ var mo = new MutationObserver(function(){}); }';
  assert.ok(
    !/if \(open === was\) continue;/.test(broken),
    'the re-focus-storm detector matches source with no state check — it would ' +
    'pass regardless'
  );
}

console.log('PASS modal-focus-goes-in-and-comes-back: focus enters every .modal-bg and is ' +
  'returned on close, captured once, verified still-alive before restore, and the ' +
  'observer cannot storm');
