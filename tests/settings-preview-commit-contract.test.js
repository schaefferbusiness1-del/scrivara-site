'use strict';

/* The Settings Display section must not leave a preview applied that it will
 * not keep.
 *
 * Theme, text size and compact are preview-only: their applyXPreview functions
 * toggle body classes and nothing else, and only Save writes them to storage.
 * closeSettings() used to be a single line that removed the modal's .show
 * class and restored nothing, so the preview stayed applied for the rest of the
 * session and then vanished on the next reload. A doctor switched to dark mode,
 * worked in it all day, and came back to a light app with nothing on screen to
 * explain it.
 *
 * The modal has a Save button, which sets the expectation that nothing commits
 * until it is pressed. Closing now restores the STORED values through
 * applyAppearance() — the same function Save calls — so what is on screen is
 * always what will still be there tomorrow.
 *
 * Reported by the QA lane, mechanism verified here in source before fixing:
 * three preview-only appliers, two that self-commit, and a closeSettings that
 * restored neither.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function fnBody(name) {
  const start = app.indexOf('function ' + name + '(');
  assert(start > -1, name + '() is gone from ScribeFlow.html');
  /* Brace-match so a nested block cannot truncate the body. */
  let depth = 0, i = app.indexOf('{', start);
  assert(i > -1, name + '() has no body');
  const from = i;
  for (; i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}') { depth--; if (!depth) return app.slice(from, i + 1); }
  }
  throw new Error(name + '() body never closes');
}

/* 1. Closing restores the stored appearance rather than leaving the preview. */
const close = fnBody('closeSettings');
assert(/applyAppearance\(\)/.test(close),
  'closeSettings() no longer restores the stored appearance. The three preview-only Display\n' +
  'settings would stay applied for the session and silently revert on the next reload —\n' +
  'the "dark mode worked all day then vanished" defect.');
assert(/classList\.remove\('show'\)/.test(close),
  'closeSettings() no longer closes the modal');

/* 2. It also puts the controls back, so the modal never shows a value that is
 *    not in effect. */
for (const id of ['qolTheme', 'qolTextSize', 'qolCompact']) {
  assert(new RegExp("getElementById\\('" + id + "'\\)").test(close),
    'closeSettings() no longer resets #' + id + ' to its stored value, so reopening Settings ' +
    'would show a selection that is not applied.');
}

/* 3. The preview appliers stay PREVIEW-only. If one of them starts writing
 *    storage it becomes a self-committing control behind a Save button, which
 *    is the other half of the same inconsistency. */
for (const name of ['applyThemePreview', 'applyTextSizePreview', 'applyCompactPreview']) {
  const body = fnBody(name);
  assert(!/setItem\(/.test(body),
    name + '() now writes to storage. It sits behind a Save button, so committing on change ' +
    'means the control ignores Save — pick one model for the whole Display section rather ' +
    'than adding a third behaviour.');
}

/* 4. Save is still the thing that commits them. */
for (const key of ['qolTheme', 'qolTextSize', 'qolCompact']) {
  assert(new RegExp("setItem\\(uns\\('" + key + "'\\)").test(app),
    'Save no longer persists ' + key + ', so the setting could never survive a reload at all.');
}

/* 5. The two self-committing controls now honour Save too.
 *
 * Patient layout and group-by-procedure write storage the moment they change,
 * because applyPtLayout() and renderPatients() read the value back OUT of
 * storage rather than taking it as an argument — so previewing them means
 * writing. Save is kept meaningful by snapshotting them on open and restoring
 * on close, which makes all five Display controls behave the same way from the
 * doctor's side: change freely, Save keeps it, Close discards it. */
assert(/function\s+snapshotQolCommits\s*\(/.test(app) && /function\s+restoreQolCommits\s*\(/.test(app),
  'the snapshot/restore pair for the self-committing Display controls is gone. Patient layout ' +
  'and group-by-procedure would again save permanently without Save ever being pressed.');

const open = fnBody('openSettings');
assert(/snapshotQolCommits\(\)/.test(open),
  'openSettings() no longer snapshots the self-committing controls, so closing has nothing to ' +
  'put back and those two commit silently again.');

assert(/restoreQolCommits\(\)/.test(close),
  'closeSettings() no longer restores the self-committing controls.');

/* Ordering matters: applyAppearance() calls applyPtLayout(), which reads the
 * value back out of storage, so the snapshot must land BEFORE it re-applies.
 *
 * Compare CODE only. A first attempt at this assertion matched the call name
 * inside the comment that explains the ordering, and failed against a correctly
 * ordered function — the same trap that made a sibling suite report a phantom
 * call site. Strip comments before reasoning about position. */
const closeCode = close.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
assert(closeCode.indexOf('restoreQolCommits()') < closeCode.indexOf('applyAppearance()'),
  'closeSettings() restores the snapshot AFTER applyAppearance(). applyPtLayout() reads storage, ' +
  'so it would re-apply the unsaved value and the restore would not be visible.');

for (const id of ['qolPtLayout', 'qolGroupProc']) {
  assert(new RegExp("getElementById\\('" + id + "'\\)").test(close),
    'closeSettings() no longer resets #' + id + ', so reopening Settings shows a discarded value.');
}

const save = fnBody('saveSettings');
assert(/snapshotQolCommits\(\)/.test(save),
  'saveSettings() no longer re-snapshots. A Save followed by Close would revert the values ' +
  'that were just saved — the opposite defect.');

console.log('PASS settings preview/commit contract: all five Display controls preview and commit on Save, closing restores, ordering is storage-before-apply');
