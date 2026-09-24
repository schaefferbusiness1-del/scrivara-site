/* sweep-30114.js - move every 3.0.113 release pin to 3.0.114 (capsaved-1.0.0: honest capture messages).
 * Notes paragraphs swapped by index-scan FIRST, then PIN-SPECIFIC subs (never
 * global: the new notes prose legitimately names v3.0.113). Fail-closed exact
 * counts. Run from repo root with NEW_ZIP_SHA in the environment.
 */
'use strict';
var fs = require('fs');

var OLD_ZIP_SHA = 'e99b4c43db68179abbf781af40088b1fc4cc9b979c51a2ecea020ffa7af36f05';
var NEW_ZIP_SHA = String(process.env.NEW_ZIP_SHA || '').trim();
if (!/^[0-9a-f]{64}$/.test(NEW_ZIP_SHA)) { console.error('ABORT: NEW_ZIP_SHA env missing/invalid'); process.exit(1); }
var NEW_NOTES = "v3.0.114 - Honesty release. When MLS reads a chart but cannot safely tell that patient apart from another chart, the extension now says nothing was saved instead of reporting a capture, and a scheduled backup counts it as an error. A capture kept as its own chart says so. Includes everything in v3.0.113. Requires Chrome 116+.";

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
    ['>3.0.113</b>', '>3.0.114</b>', 1],
    ['MLS_Assist_v3.0.113.bin', 'MLS_Assist_v3.0.114.bin', 1],
    ['download="MLS_Assist_v3.0.113.zip"', 'download="MLS_Assist_v3.0.114.zip"', 1],
    ['>3.0.113</span>', '>3.0.114</span>', 2]
  ]);
});
swapNotesParagraph('ScribeFlow-staging.html');
subs('ScribeFlow-staging.html', [
  ['>3.0.113</b>', '>3.0.114</b>', 1],
  ['MLS_Assist_v3.0.113.bin', 'MLS_Assist_v3.0.114.bin', 1],
  ['download="MLS_Assist_v3.0.113.zip"', 'download="MLS_Assist_v3.0.114.zip"', 1],
  ['>3.0.113</span>', '>3.0.114</span>', 2]
]);

subs('feat_mls_checker.js', [["SERVER_EXT_VERSION = '3.0.113'", "SERVER_EXT_VERSION = '3.0.114'", 1]]);
subs('_config.yml', [['3.0.113', '3.0.114', 4], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('get-extension.html', [['3.0.113', '3.0.114', 5], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('pages-publication-inventory.json', [['MLS_Assist_v3.0.113.bin', 'MLS_Assist_v3.0.114.bin', 1], ['MLS_Assist_v3.0.113.zip', 'MLS_Assist_v3.0.114.zip', 1]]);
subs('tests/extension-package.test.js', [['3.0.113', '3.0.114', 2], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('tests/public-publication-boundary.test.js', [['3.0.113', '3.0.114', 13], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
subs('tests/1p-preview-contract.test.js', [["'MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.113'", "'MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.114'", 1], ['MLS Assist 3.0.113 package', 'MLS Assist 3.0.114 package', 1], [OLD_ZIP_SHA, NEW_ZIP_SHA, 1]]);
fs.writeFileSync('extension-version.json', JSON.stringify({ version: '3.0.114', minChrome: 116, notes: NEW_NOTES }, null, 2) + '\n');
console.log('SWEEP DONE');
