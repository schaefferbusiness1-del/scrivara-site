/* sweep-30101.js — move every 3.0.100 release pin to 3.0.101 (isodob + rowfold +
 * ckmeta). Notes paragraphs swapped by index-scan FIRST, then PIN-SPECIFIC
 * subs (never global: the new notes prose legitimately names v3.0.100).
 * Fail-closed exact counts. Run from repo root.
 */
'use strict';
var fs = require('fs');

var OLD_ZIP_SHA = '1a6b31c4bba33797bc1e633169ce71512ca62aa560f0bc583fea62c7f756d184';
var NEW_ZIP_SHA = '1ac951996f487f9227ac58411c907ca1416d452eaecb078dd13afb4a39865fa2';
var NEW_NOTES = 'v3.0.101 - Reliability: after finishing a day, the schedule pull now returns athenaOne to Calendar - View Calendar by itself (the dashboard cannot switch a provider-scoped day, so pulls used to stall there until someone clicked the menu by hand). Everything from v3.0.100 remains. Requires Chrome 116+.';

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
    ['>3.0.100</b>', '>3.0.101</b>', 1],
    ['MLS_Assist_v3.0.100.bin', 'MLS_Assist_v3.0.101.bin', 1],
    ['download="MLS_Assist_v3.0.100.zip"', 'download="MLS_Assist_v3.0.101.zip"', 2],
    ['>3.0.100</span>', '>3.0.101</span>', 2],
    ['https://mlsscribe.com/MLS_Assist_v3.0.100.zip', 'https://mlsscribe.com/MLS_Assist_v3.0.101.zip', 1],
    ['(v3.0.100 ZIP)', '(v3.0.101 ZIP)', 1]
  ]);
});
swapNotesParagraph('ScribeFlow-staging.html');
subs('ScribeFlow-staging.html', [
  ['>3.0.100</b>', '>3.0.101</b>', 1],
  ['MLS_Assist_v3.0.100.bin', 'MLS_Assist_v3.0.101.bin', 1],
  ['download="MLS_Assist_v3.0.100.zip"', 'download="MLS_Assist_v3.0.101.zip"', 1],
  ['>3.0.100</span>', '>3.0.101</span>', 2]
]);

subs('feat_mls_checker.js', [["SERVER_EXT_VERSION = '3.0.100'", "SERVER_EXT_VERSION = '3.0.101'", 1]]);
subs('_config.yml', [['3.0.100', '3.0.101', 4], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('get-extension.html', [['3.0.100', '3.0.101', 5], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('pages-publication-inventory.json', [['MLS_Assist_v3.0.100.bin', 'MLS_Assist_v3.0.101.bin', 1], ['MLS_Assist_v3.0.100.zip', 'MLS_Assist_v3.0.101.zip', 1]]);
subs('tests/extension-package.test.js', [['3.0.100', '3.0.101', 2], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('tests/public-publication-boundary.test.js', [['3.0.100', '3.0.101', 13], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('tests/1p-preview-contract.test.js', [["'MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.100'", "'MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.101'", 1], ['MLS Assist 3.0.100 package', 'MLS Assist 3.0.101 package', 1], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
console.log('SWEEP DONE');
