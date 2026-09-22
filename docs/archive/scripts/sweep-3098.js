/* sweep-3098.js — move every 3.0.97 release pin to 3.0.98 (status-1.0.0).
 * Notes paragraphs are swapped by index-scan FIRST (they contain unicode
 * punctuation and stale 3.0.97 prose), then plain version/sha substitutions.
 * Fail-closed exact counts everywhere. Run from repo root.
 */
'use strict';
var fs = require('fs');

var OLD_ZIP_SHA = 'e718c0c3e5bc52b04e74baa184a20413f18ac1fd6d487accb49cb59740758e4d';
var NEW_ZIP_SHA = '2a1e14efddbae9d80d13e400f7635ab4d3a2e28d7c71f8d826b6ad02a2728de7';
var NEW_NOTES = 'v3.0.98 - Schedule intelligence: every pulled appointment row now carries its athena status (checked in, checked out, arrived, and more), so MLS reads notes for patients already seen first and month reports can tell a seen visit from a booked one. Everything from v3.0.97 remains. Requires Chrome 116+.';

function swapNotesParagraph(file) {
  var s = fs.readFileSync(file, 'latin1');
  var anchor = '<p class="note" id="extDlNotes" style="margin:6px 0 0">';
  var i = s.indexOf(anchor);
  if (i < 0 || s.indexOf(anchor, i + 1) >= 0) { console.error('ABORT ' + file + ': notes anchor not unique'); process.exit(1); }
  var j = s.indexOf('</p>', i);
  if (j < 0) { console.error('ABORT ' + file + ': notes close missing'); process.exit(1); }
  s = s.slice(0, i + anchor.length) + NEW_NOTES + s.slice(j);
  fs.writeFileSync(file, s, 'latin1');
}

function subs(file, pairs) {
  var s = fs.readFileSync(file, 'latin1');
  pairs.forEach(function (p) {
    var n = s.split(p[0]).length - 1;
    if (n !== p[2]) { console.error('ABORT ' + file + ': expected ' + p[2] + ' hit(s), found ' + n + ' for: ' + p[0].slice(0, 60)); process.exit(1); }
    s = s.split(p[0]).join(p[1]);
  });
  fs.writeFileSync(file, s, 'latin1');
  console.log('OK ' + file);
}

/* Twins + staging: notes paragraph first, then PIN-SPECIFIC version subs.
 * Never a global 3.0.97 sub here: the new notes prose itself says
 * "Everything from v3.0.97 remains" and must keep saying it. */
['1pScribeFlow.html', '1p/index.html'].forEach(function (f) {
  swapNotesParagraph(f);
  subs(f, [
    ['>3.0.97</b>', '>3.0.98</b>', 1],
    ['MLS_Assist_v3.0.97.bin', 'MLS_Assist_v3.0.98.bin', 1],
    ['download="MLS_Assist_v3.0.97.zip"', 'download="MLS_Assist_v3.0.98.zip"', 2],
    ['>3.0.97</span>', '>3.0.98</span>', 2],
    ['https://mlsscribe.com/MLS_Assist_v3.0.97.zip', 'https://mlsscribe.com/MLS_Assist_v3.0.98.zip', 1],
    ['(v3.0.97 ZIP)', '(v3.0.98 ZIP)', 1]
  ]);
});
swapNotesParagraph('ScribeFlow-staging.html');
subs('ScribeFlow-staging.html', [
  ['>3.0.97</b>', '>3.0.98</b>', 1],
  ['MLS_Assist_v3.0.97.bin', 'MLS_Assist_v3.0.98.bin', 1],
  ['download="MLS_Assist_v3.0.97.zip"', 'download="MLS_Assist_v3.0.98.zip"', 1],
  ['>3.0.97</span>', '>3.0.98</span>', 2]
]);

subs('feat_mls_checker.js', [["SERVER_EXT_VERSION = '3.0.97'", "SERVER_EXT_VERSION = '3.0.98'", 1]]);
subs('_config.yml', [['3.0.97', '3.0.98', 4], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('get-extension.html', [['3.0.97', '3.0.98', 5], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('pages-publication-inventory.json', [['MLS_Assist_v3.0.97.bin', 'MLS_Assist_v3.0.98.bin', 1], ['MLS_Assist_v3.0.97.zip', 'MLS_Assist_v3.0.98.zip', 1]]);
subs('tests/extension-package.test.js', [['3.0.97', '3.0.98', 2], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('tests/public-publication-boundary.test.js', [['3.0.97', '3.0.98', 13], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('tests/1p-preview-contract.test.js', [["'MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.97'", "'MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.98'", 1], ['MLS Assist 3.0.97 package', 'MLS Assist 3.0.98 package', 1], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
console.log('SWEEP DONE');
