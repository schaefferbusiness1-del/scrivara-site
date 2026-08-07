'use strict';

/* The rail search must put the caret back WHERE IT WAS, not at the end.
 *
 * buildTplRail rebuilds the whole rail with innerHTML on every `input` event,
 * which destroys and recreates #oprTplSearch. b900 restored focus with
 * setSelectionRange(value.length, value.length) — an unconditional jump to the
 * end — so any correction made mid-string silently landed at the end instead:
 * type "lumbar", click before the "l", type a character, and it appends.
 *
 * WHY THIS TEST EXISTS RATHER THAN A BROWSER CHECK.
 * A QA gate reported this "confirmed on the real element" and then retracted
 * the confirmation, correctly: the probe ran in a HIDDEN tab, where
 * document.hasFocus() is false and el.focus() leaves activeElement as BODY.
 * The restore branch is guarded by hadFocus, so in that environment it is
 * SKIPPED and the caret sits at the default end position — 7 of 7 — whether
 * the fix is present or absent. The number was real; it could not distinguish
 * fixed from broken.
 *
 * So the behaviour is pinned here instead, against the SHIPPED bytes, in a
 * stub DOM where focus is deterministic. This gate does not care whether a
 * browser tab is visible, which is precisely the point.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_room.js'), 'utf8');

let failures = 0;
function ok(cond, msg, detail) {
  if (cond) { console.log('  pass  ' + msg); return; }
  failures++;
  console.error('  FAIL  ' + msg + (detail ? '\n        ' + detail : ''));
}

/* ---- 1. the shipped source must carry the corrected form ---------------- */
ok(/setSelectionRange\(selStart,\s*selEnd\)/.test(src),
  'the restore uses the captured selection, not the end of the value');
ok(!/setSelectionRange\(\s*searchInp\.value\.length/.test(src),
  'the unconditional jump-to-end form is gone');
ok(/selStart\s*=\s*RAIL_FILTER\.length/.test(src),
  'the capture defaults to end-of-value, so a first render still lands sanely');
ok(/_a\.selectionStart\s*!=\s*null/.test(src),
  'the capture is guarded — selectionStart is null on input types that have no caret');

/* ---- 2. run the SHIPPED capture/restore pair over a stub DOM ------------ */
/* Pull the two real fragments out of the file so this exercises the same
   bytes the browser runs, not a paraphrase of them. */
let captureSrc = (src.match(/var selStart = RAIL_FILTER\.length[\s\S]*?\n {4}\}/) || [])[0];
assert(captureSrc, 'could not locate the caret CAPTURE block in feat_mls_opnote_room.js');
/* strict-mode eval scopes its own `var`, so the declaration is turned into an
   assignment against the bindings below. The expressions — which are what this
   test is about — are untouched shipped bytes. */
captureSrc = captureSrc.replace(/^var /, '');
const restoreSrc = (src.match(/if \(hadFocus\) \{ try \{ searchInp\.focus[\s\S]*?\} catch \(eF\) \{\} \}/) || [])[0];
assert(restoreSrc, 'could not locate the caret RESTORE block in feat_mls_opnote_room.js');

function runCaretCycle(opts) {
  /* the input the user is typing in, before the rebuild */
  const before = {
    id: 'oprTplSearch',
    value: opts.value,
    selectionStart: opts.caret,
    selectionEnd: opts.caret,
    focus() { document.activeElement = this; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
  };
  /* the NEW node innerHTML creates — a different object, caret at 0 */
  const after = {
    id: 'oprTplSearch',
    value: opts.value,
    selectionStart: 0,
    selectionEnd: 0,
    focus() { document.activeElement = this; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
  };
  const document = { activeElement: opts.focused ? before : { id: 'BODY' } };
  const RAIL_FILTER = opts.value;

  /* --- the shipped capture, verbatim --- */
  const hadFocus = document.activeElement && document.activeElement.id === 'oprTplSearch';
  var selStart, selEnd;
  eval(captureSrc);

  /* --- the rebuild: the old node is gone, `after` replaces it --- */
  const searchInp = after;
  searchInp.value = RAIL_FILTER;

  /* --- the shipped restore, verbatim --- */
  eval(restoreSrc);

  return { caret: after.selectionStart, end: after.selectionEnd, restored: document.activeElement === after };
}

/* the exact scenario the QA gate described: "lumbar" -> caret before the "l"
   -> type X -> "lumXbar" with the caret at 4 */
const mid = runCaretCycle({ value: 'lumXbar', caret: 4, focused: true });
ok(mid.caret === 4 && mid.end === 4,
  'a mid-string edit keeps the caret at 4 — it does NOT jump to the end (7)',
  'got ' + JSON.stringify(mid));
ok(mid.restored, 'focus is returned to the rebuilt input');

/* caret genuinely at the end stays at the end */
const end = runCaretCycle({ value: 'lumbar', caret: 6, focused: true });
ok(end.caret === 6, 'a caret already at the end is preserved as the end');

/* caret at the very start is preserved (the old code sent it to the end) */
const start = runCaretCycle({ value: 'lumbar', caret: 0, focused: true });
ok(start.caret === 0, 'a caret at position 0 is preserved');

/* a selection RANGE survives, not just a collapsed caret */
const range = (function () {
  const before = { id:'oprTplSearch', value:'lumbar', selectionStart:1, selectionEnd:4,
    focus(){ document.activeElement = this; }, setSelectionRange(a,b){ this.selectionStart=a; this.selectionEnd=b; } };
  const after = { id:'oprTplSearch', value:'lumbar', selectionStart:0, selectionEnd:0,
    focus(){ document.activeElement = this; }, setSelectionRange(a,b){ this.selectionStart=a; this.selectionEnd=b; } };
  const document = { activeElement: before };
  const RAIL_FILTER = 'lumbar';
  const hadFocus = document.activeElement && document.activeElement.id === 'oprTplSearch';
  var selStart, selEnd;
  eval(captureSrc);
  const searchInp = after; searchInp.value = RAIL_FILTER;
  eval(restoreSrc);
  return { s: after.selectionStart, e: after.selectionEnd };
})();
ok(range.s === 1 && range.e === 4,
  'a selected RANGE is restored as a range, not collapsed to a point',
  'got ' + JSON.stringify(range));

/* when the rail rebuilds while focus is elsewhere, nothing is touched —
   this is the branch the hidden-tab probe was actually measuring */
const unfocused = runCaretCycle({ value: 'lumXbar', caret: 4, focused: false });
ok(unfocused.caret === 0 && !unfocused.restored,
  'with focus elsewhere the restore is skipped entirely — no caret is stolen');

console.log(failures === 0
  ? 'PASS op-note rail search caret: a mid-string edit keeps its position, ranges survive the rebuild, and an unfocused rail is left alone'
  : 'FAIL opnote-rail-search-caret: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
