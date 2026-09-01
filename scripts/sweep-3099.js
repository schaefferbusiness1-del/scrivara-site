/* sweep-3099.js — move every 3.0.98 release pin to 3.0.99 (isodob + rowfold +
 * ckmeta). Notes paragraphs swapped by index-scan FIRST, then PIN-SPECIFIC
 * subs (never global: the new notes prose legitimately names v3.0.98).
 * Fail-closed exact counts. Run from repo root.
 */
'use strict';
var fs = require('fs');

var OLD_ZIP_SHA = '2a1e14efddbae9d80d13e400f7635ab4d3a2e28d7c71f8d826b6ad02a2728de7';
var NEW_ZIP_SHA = 'd5e04d2748ae4590d16ed0072dfd6386f32b11e76da65f9c204e74763884f32d';
var NEW_NOTES = 'v3.0.99 - Write reliability for every patient: a date of birth stored the international way (2006-03-24) is no longer misread as a different person; a patient whose name renders with an apostrophe, hyphen or squeezed spelling is still found on their exact appointment row; and a patient who is already CHECKED IN no longer blocks the write chain. Everything from v3.0.98 remains. Requires Chrome 116+.';

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

['1pScribeFlow.html', '1p/index.html'].forEach(function (f) {
  swapNotesParagraph(f);
  subs(f, [
    ['>3.0.98</b>', '>3.0.99</b>', 1],
    ['MLS_Assist_v3.0.98.bin', 'MLS_Assist_v3.0.99.bin', 1],
    ['download="MLS_Assist_v3.0.98.zip"', 'download="MLS_Assist_v3.0.99.zip"', 2],
    ['>3.0.98</span>', '>3.0.99</span>', 2],
    ['https://mlsscribe.com/MLS_Assist_v3.0.98.zip', 'https://mlsscribe.com/MLS_Assist_v3.0.99.zip', 1],
    ['(v3.0.98 ZIP)', '(v3.0.99 ZIP)', 1]
  ]);
});
swapNotesParagraph('ScribeFlow-staging.html');
subs('ScribeFlow-staging.html', [
  ['>3.0.98</b>', '>3.0.99</b>', 1],
  ['MLS_Assist_v3.0.98.bin', 'MLS_Assist_v3.0.99.bin', 1],
  ['download="MLS_Assist_v3.0.98.zip"', 'download="MLS_Assist_v3.0.99.zip"', 1],
  ['>3.0.98</span>', '>3.0.99</span>', 2]
]);

subs('feat_mls_checker.js', [["SERVER_EXT_VERSION = '3.0.98'", "SERVER_EXT_VERSION = '3.0.99'", 1]]);
subs('_config.yml', [['3.0.98', '3.0.99', 4], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('get-extension.html', [['3.0.98', '3.0.99', 5], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('pages-publication-inventory.json', [['MLS_Assist_v3.0.98.bin', 'MLS_Assist_v3.0.99.bin', 1], ['MLS_Assist_v3.0.98.zip', 'MLS_Assist_v3.0.99.zip', 1]]);
subs('tests/extension-package.test.js', [['3.0.98', '3.0.99', 2], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('tests/public-publication-boundary.test.js', [['3.0.98', '3.0.99', 13], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('tests/1p-preview-contract.test.js', [["'MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.98'", "'MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.99'", 1], ['MLS Assist 3.0.98 package', 'MLS Assist 3.0.99 package', 1], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
console.log('SWEEP DONE');
