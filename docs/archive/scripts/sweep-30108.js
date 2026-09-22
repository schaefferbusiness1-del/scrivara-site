/* sweep-30107.js - move every 3.0.107 release pin to 3.0.107 (stackprov-1.0.0).
 * Notes paragraphs swapped by index-scan FIRST, then PIN-SPECIFIC subs (never
 * global: the new notes prose legitimately names v3.0.107). Fail-closed exact
 * counts. Run from repo root with NEW_ZIP_SHA in the environment.
 */
'use strict';
var fs = require('fs');

var OLD_ZIP_SHA = 'e12127e967b8e46fa0c15a5097543dacb31a547619f8b40881c2ccdbf42739fc';
var NEW_ZIP_SHA = String(process.env.NEW_ZIP_SHA || '').trim();
if (!/^[0-9a-f]{64}$/.test(NEW_ZIP_SHA)) { console.error('ABORT: NEW_ZIP_SHA env missing/invalid'); process.exit(1); }
var NEW_NOTES = 'v3.0.108 - Writes: one confirmed press now writes every checked note section, one at a time, each read back before the next. The exact confirm button carries the ordered list of section fingerprints, the extension authorizes that list from the same real click, and every write must match the next fingerprint on it; anything off the list, out of order, or after ten minutes is refused as before. Save and Sign remain your own clicks in athenaOne. Everything from v3.0.107 remains. Requires Chrome 116+.';

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
    ['>3.0.107</b>', '>3.0.108</b>', 1],
    ['MLS_Assist_v3.0.107.bin', 'MLS_Assist_v3.0.108.bin', 1],
    ['download="MLS_Assist_v3.0.107.zip"', 'download="MLS_Assist_v3.0.108.zip"', 2],
    ['>3.0.107</span>', '>3.0.108</span>', 2],
    ['https://mlsscribe.com/MLS_Assist_v3.0.107.zip', 'https://mlsscribe.com/MLS_Assist_v3.0.108.zip', 1],
    ['(v3.0.107 ZIP)', '(v3.0.108 ZIP)', 1]
  ]);
});
swapNotesParagraph('ScribeFlow-staging.html');
subs('ScribeFlow-staging.html', [
  ['>3.0.107</b>', '>3.0.108</b>', 1],
  ['MLS_Assist_v3.0.107.bin', 'MLS_Assist_v3.0.108.bin', 1],
  ['download="MLS_Assist_v3.0.107.zip"', 'download="MLS_Assist_v3.0.108.zip"', 1],
  ['>3.0.107</span>', '>3.0.108</span>', 2]
]);

subs('feat_mls_checker.js', [["SERVER_EXT_VERSION = '3.0.107'", "SERVER_EXT_VERSION = '3.0.108'", 1]]);
subs('_config.yml', [['3.0.107', '3.0.108', 4], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('get-extension.html', [['3.0.107', '3.0.108', 5], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('pages-publication-inventory.json', [['MLS_Assist_v3.0.107.bin', 'MLS_Assist_v3.0.108.bin', 1], ['MLS_Assist_v3.0.107.zip', 'MLS_Assist_v3.0.108.zip', 1]]);
subs('tests/extension-package.test.js', [['3.0.107', '3.0.108', 2], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('tests/public-publication-boundary.test.js', [['3.0.107', '3.0.108', 13], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('tests/1p-preview-contract.test.js', [["'MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.107'", "'MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.108'", 1], ['MLS Assist 3.0.107 package', 'MLS Assist 3.0.108 package', 1], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
fs.writeFileSync('extension-version.json', JSON.stringify({ version: '3.0.108', minChrome: 116, notes: NEW_NOTES }, null, 2) + '\n');
console.log('SWEEP DONE');
