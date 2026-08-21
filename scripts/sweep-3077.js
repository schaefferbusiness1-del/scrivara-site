/* sweep-3077 - PLAIN by law: explicit constants, exact occurrence counts,
 * all-or-nothing text staging. 3.0.76 -> 3.0.77 publishes the Mac sleeping-tab
 * recovery and routes legacy Athena note sends into the existing supervised
 * review boundary. The checker URL moves because SERVER_EXT_VERSION changes.
 *
 * The 3.0.77 ZIP must already exist and match NEW_SHA. This script creates the
 * byte-identical .bin mirror but deliberately retains the 3.0.76 artifacts;
 * they are removed only after the focused release gates pass.
 *
 * Usage: node scripts/sweep-3077.js [--dry]
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');

const DRY = process.argv.includes('--dry');
const OLD = '3.0.76';
const NEW = '3.0.77';
const OLD_SHA = '445d57e0ee0962a75ab79033e48268e379c6d8dbe2afc90894727a128479489c';
const NEW_SHA = '3de8327eeb2c4b0d84c464d3b47252811c2e167895a195dc64418bf4db7bf4cd';
const OLD_CHK = '20260820chk3076';
const NEW_CHK = '20260820chk3077';
const OLD_NOTES = 'v3.0.76 - The version the practice validated live. On top of the repeat-pull fixes: closing your athenaOne tab can no longer silently block every pull until the browser restarts (the extension now notices the tab is gone and finds your new one), a briefly-offline extension worker retries your read instead of failing it, and the session keep-alive now keeps a minute-by-minute ledger so sign-out causes can be diagnosed instead of guessed. Everything from earlier releases remains: one-click pull of whoever is open, honest identity checks, full-speed background reads, and phone-confirmed note writes that stay notes-and-drafts only, confirmed by you. Requires Chrome 116+.';
const NEW_NOTES = 'v3.0.77 - Open-patient pulls are more reliable on Macs: an explicit pull can safely wake and verify the exact sleeping athenaOne tab without reloading it, while quiet and background work never wakes a tab. A sleeping or temporarily unreachable tab is no longer mistaken for a sign-out. Legacy Send to Athena requests now enter the existing supervised review flow, with exact patient and encounter checks plus clinician confirmation; nothing writes automatically. Everything from earlier releases remains. Requires Chrome 116+.';

const releaseRows = [
  [OLD_NOTES, NEW_NOTES, 1],
  ['id="extDlVersion">' + OLD + '<', 'id="extDlVersion">' + NEW + '<', 1],
  ['id="extDlVersionBtn">' + OLD + '<', 'id="extDlVersionBtn">' + NEW + '<', 1],
  ['id="extDlVersionNotes">' + OLD + '<', 'id="extDlVersionNotes">' + NEW + '<', 1],
  ['MLS_Assist_v' + OLD + '.bin', 'MLS_Assist_v' + NEW + '.bin', 1],
  ['MLS_Assist_v' + OLD + '.zip', 'MLS_Assist_v' + NEW + '.zip', 3],
  ['Direct package (v' + OLD + ' ZIP)', 'Direct package (v' + NEW + ' ZIP)', 1]
];

const stagingRows = [
  [OLD_NOTES, NEW_NOTES, 1],
  ['id="extDlVersion">' + OLD + '<', 'id="extDlVersion">' + NEW + '<', 1],
  ['id="extDlVersionBtn">' + OLD + '<', 'id="extDlVersionBtn">' + NEW + '<', 1],
  ['id="extDlVersionNotes">' + OLD + '<', 'id="extDlVersionNotes">' + NEW + '<', 1],
  ['MLS_Assist_v' + OLD + '.bin', 'MLS_Assist_v' + NEW + '.bin', 1],
  ['MLS_Assist_v' + OLD + '.zip', 'MLS_Assist_v' + NEW + '.zip', 1]
];

const plan = [
  ['extension-version.json', [[OLD_NOTES, NEW_NOTES, 1], ['"version": "' + OLD + '"', '"version": "' + NEW + '"', 1]]],
  ['get-extension.html', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['ScribeFlow.html', releaseRows],
  ['ScribeFlow-staging.html', stagingRows],
  ['1p/index.html', releaseRows],
  ['1pScribeFlow.html', releaseRows],
  ['cloned/index.html', releaseRows],
  ['_config.yml', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['pages-publication-inventory.json', [[OLD, NEW, 2]]],
  ['feat_mls_checker.js', [[OLD, NEW, 1]]],
  ['mls-connect.js', [[OLD_CHK, NEW_CHK, 1]]],
  ['mls-connect.staging.js', [[OLD_CHK, NEW_CHK, 1]]],
  ['1p-mls-connect.js', [[OLD_CHK, NEW_CHK, 1]]],
  ['cloned-mls-connect.js', [[OLD_CHK, NEW_CHK, 1]]],
  ['tests/extension-package.test.js', [[OLD, NEW, 1], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/public-publication-boundary.test.js', [[OLD, NEW, 8], [OLD_SHA, NEW_SHA, 2]]],
  ['tests/public-release-truth-boundary.test.js', [[OLD, NEW, 2], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/extension-reload-helper-contract.test.js', [
    ['token moved 20260819chk3074 -> ' + OLD_CHK + ' deliberately with the ' + OLD,
      'token moved ' + OLD_CHK + ' -> ' + NEW_CHK + ' deliberately with the ' + NEW, 1],
    ['feat_mls_checker.js?v=' + OLD_CHK, 'feat_mls_checker.js?v=' + NEW_CHK, 2]
  ]],
  ['tests/immutable-satellite-loader-cache-contract.test.js', [
    ["['feat_mls_checker.js', '" + OLD_CHK + "', '20260819chk3074']",
      "['feat_mls_checker.js', '" + NEW_CHK + "', '" + OLD_CHK + "']", 1],
    ['feat_mls_checker.js?v=' + OLD_CHK, 'feat_mls_checker.js?v=' + NEW_CHK, 1]
  ]],
  ['tests/athena-follow-bidirectional-contract.test.js', [[OLD, NEW, 6]]],
  ['tests/1p-preview-contract.test.js', [
    ["['MLS_Assist_v3.0.61', 'MLS_Assist_v" + OLD + "']", "['MLS_Assist_v3.0.61', 'MLS_Assist_v" + NEW + "']", 1],
    ["['4d77f337a6810dac82a36b8f4320a1802411a116b773cd82a18ee37a3e092775', '" + OLD_SHA + "']",
      "['4d77f337a6810dac82a36b8f4320a1802411a116b773cd82a18ee37a3e092775', '" + NEW_SHA + "']", 1]
  ]]
];

const newZip = 'MLS_Assist_v' + NEW + '.zip';
const newBin = 'MLS_Assist_v' + NEW + '.bin';
if (!fs.existsSync(newZip)) {
  console.error('FATAL: ' + newZip + ' not found');
  process.exit(1);
}
const zipBytes = fs.readFileSync(newZip);
const zipSha = crypto.createHash('sha256').update(zipBytes).digest('hex');
if (zipSha !== NEW_SHA) {
  console.error('FATAL: ' + newZip + ' sha mismatch expected=' + NEW_SHA + ' actual=' + zipSha);
  process.exit(1);
}

/* Probe every count and stage all replacements in memory before any write. */
const staged = [];
let bad = 0;
for (const [file, rows] of plan) {
  let content = fs.readFileSync(file, 'latin1');
  for (const [from, to, expectedCount] of rows) {
    const count = content.split(from).length - 1;
    if (count !== expectedCount) {
      console.error('MISS ' + file + ' expected=' + expectedCount + ' got=' + count + ' needle=' + from.slice(0, 100));
      bad++;
    }
    content = content.split(from).join(to);
  }
  staged.push([file, content]);
}
if (bad) {
  console.error('SWEEP ABORTED - nothing written (' + bad + ' misses)');
  process.exit(1);
}

if (DRY) {
  console.log('DRY RUN OK - ' + staged.length + ' files staged; ZIP sha exact; nothing written');
  process.exit(0);
}

for (const [file, content] of staged) fs.writeFileSync(file, content, 'latin1');
fs.copyFileSync(newZip, newBin);
const binSha = crypto.createHash('sha256').update(fs.readFileSync(newBin)).digest('hex');
if (binSha !== NEW_SHA) {
  console.error('FATAL: ' + newBin + ' is not byte-identical to the ZIP');
  process.exit(1);
}

console.log('SWEEP 3077 OK - ' + staged.length + ' files; ZIP/bin sha ' + NEW_SHA + '; 3.0.76 artifacts retained pending gates');
