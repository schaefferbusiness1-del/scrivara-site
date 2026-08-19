/* sweep-3072 - PLAIN by law: explicit constants, counts probed 2026-08-19
 * against the live tree, all-or-nothing. 3.0.65 -> 3.0.72:
 * keep-alive alarm + athena's own heartbeat, athena-tab-or-nothing capture,
 * foreground reads for the bodies walk, read watchdog releasing the
 * single-flight slot, nickname/legal identity bridge inside verified walks,
 * VERB A self-detect of the open patient, remote-arm verb for phone-confirmed
 * note writes with pong capability phoneConfirmedWriteV1. */
'use strict';
const fs = require('fs');
const DRY = process.argv.includes('--dry');
const OLD = '3.0.64';
const NEW = '3.0.72';
const OLD_SHA = '1fd1c977430aa0550edd3a99f864bfb901e5c3c4dbcf63bf8ed2a27636b42c23';
const NEW_SHA = 'a1dca473780e1dd2b20075c3d3869a3c3ffcf96c1d22cd53e5a91eb0535efe74';
const OLD_CHK = '20260818chk3064';
const NEW_CHK = '20260819chk3072';
const OLD_NOTES = "v3.0.64 - Chart reads keep their pace while the athenaOne tab is in the background: every step that waits inside Athena now runs at normal speed even when that tab is hidden, so the day's visit notes finish alongside the histories instead of timing out. Nothing about writing changes. Everything from earlier releases remains. Requires Chrome 116+.";
const NEW_NOTES = "v3.0.72 - The one-patient pull works from its button: MLS detects whoever is open in your athenaOne tab on its own (no more false different-patient stops), recognizes a chart whose legal name differs from the nickname on file without weakening any identity check, keeps reading at full speed while the athenaOne tab is in the background, and releases a stuck read instead of refusing forever. The extension also keeps your athenaOne session alive using athena's own heartbeat, never reads any tab that is not athenaOne, and can accept a phone-confirmed instruction to prepare a note write - still only notes and drafts, and still confirmed by you. Everything from earlier releases remains. Requires Chrome 116+.";

const sevenRows = [
  [OLD_NOTES, NEW_NOTES, 1],
  ['id="extDlVersion">' + OLD + '<', 'id="extDlVersion">' + NEW + '<', 1],
  ['id="extDlVersionBtn">' + OLD + '<', 'id="extDlVersionBtn">' + NEW + '<', 1],
  ['id="extDlVersionNotes">' + OLD + '<', 'id="extDlVersionNotes">' + NEW + '<', 1],
  ['MLS_Assist_v' + OLD + '.bin', 'MLS_Assist_v' + NEW + '.bin', 1],
  ['MLS_Assist_v' + OLD + '.zip', 'MLS_Assist_v' + NEW + '.zip', 3],
  ['Direct package (v' + OLD + ' ZIP)', 'Direct package (v' + NEW + ' ZIP)', 1],
];

const plan = [
  ['extension-version.json', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 1]]],
  ['get-extension.html', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['ScribeFlow.html', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 8]]],
  ['ScribeFlow-staging.html', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 5]]],
  ['1p/index.html', sevenRows],
  ['1pScribeFlow.html', sevenRows],
  ['cloned/index.html', sevenRows],
  ['_config.yml', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['pages-publication-inventory.json', [[OLD, NEW, 2]]],
  ['feat_mls_checker.js', [[OLD, NEW, 1]]],
  ['mls-connect.js', [[OLD_CHK, NEW_CHK, 1]]],
  ['mls-connect.staging.js', [[OLD_CHK, NEW_CHK, 1]]],
  ['1p-mls-connect.js', [[OLD_CHK, NEW_CHK, 1]]],
  ['cloned-mls-connect.js', [[OLD_CHK, NEW_CHK, 1]]],
  ['tests/extension-package.test.js', [[OLD, NEW, 1], [OLD_SHA, NEW_SHA, 1]]],
  /* the 3.0.0-era ESCAPED regex zip forms (3\.0\.64) are gone from this test -
     probed 0 hits on 2026-08-19; its version pins are plain literals now. */
  ['tests/public-publication-boundary.test.js', [[OLD, NEW, 8], [OLD_SHA, NEW_SHA, 2]]],
  ['tests/public-release-truth-boundary.test.js', [[OLD, NEW, 2], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/extension-reload-helper-contract.test.js', [
    ['token moved 20260817chk3063 -> 20260818chk3064 deliberately with the 3.0.64', 'token moved 20260818chk3064 -> 20260819chk3072 deliberately with the 3.0.72', 1],
    ['feat_mls_checker.js?v=' + OLD_CHK, 'feat_mls_checker.js?v=' + NEW_CHK, 2],
  ]],
  ['tests/immutable-satellite-loader-cache-contract.test.js', [
    ["['feat_mls_checker.js', '20260818chk3064', '20260817chk3063']", "['feat_mls_checker.js', '20260819chk3072', '20260818chk3064']", 1],
    ['feat_mls_checker.js?v=' + OLD_CHK, 'feat_mls_checker.js?v=' + NEW_CHK, 1],
  ]],
  ['tests/athena-follow-bidirectional-contract.test.js', [[OLD, NEW, 6]]],
  ['tests/1p-preview-contract.test.js', [
    ["['MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.64']", "['MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.72']", 1],
    ["['4d77f337a6810dac82a36b8f4320a1802411a116b773cd82a18ee37a3e092775', '" + OLD_SHA + "']", "['4d77f337a6810dac82a36b8f4320a1802411a116b773cd82a18ee37a3e092775', '" + NEW_SHA + "']", 1],
    ["'MLS_Assist_v3.0.64.zip'", "'MLS_Assist_v3.0.72.zip'", 1],
    ["'MLS_Assist_v3.0.64.bin'", "'MLS_Assist_v3.0.72.bin'", 1],
  ]],
];

// Phase 1: probe every count, stage replacements in memory; report EVERY miss
// before aborting so one --dry run reveals all wrong counts at once.
const staged = [];
let bad = 0;
for (const [file, rows] of plan) {
  const buf = fs.readFileSync(file, 'latin1');
  let content = buf;
  for (const [from, to, expectedCount] of rows) {
    const count = content.split(from).length - 1;
    if (count !== expectedCount) {
      console.error('MISS ' + file + ' expected=' + expectedCount + ' got=' + count + ' needle=' + from.slice(0, 80));
      bad++;
    }
    content = content.split(from).join(to);
  }
  staged.push([file, content]);
}
if (bad) { console.error('SWEEP ABORTED - nothing written (' + bad + ' misses)'); process.exit(1); }

if (DRY) {
  console.log('DRY: ' + staged.length + ' files staged, no writes performed');
  process.exit(0);
}

// Phase 2: write all staged files (latin1)
for (const [file, content] of staged) {
  fs.writeFileSync(file, content, 'latin1');
}

// Artifact step: copy new zip to bin, remove old artifacts
const newZip = 'MLS_Assist_v' + NEW + '.zip';
const newBin = 'MLS_Assist_v' + NEW + '.bin';
const oldZip = 'MLS_Assist_v' + OLD + '.zip';
const oldBin = 'MLS_Assist_v' + OLD + '.bin';
if (!fs.existsSync(newZip)) {
  console.error('FATAL: ' + newZip + ' not found');
  process.exit(1);
}
fs.copyFileSync(newZip, newBin);
try { fs.unlinkSync(oldZip); } catch (e) {}
try { fs.unlinkSync(oldBin); } catch (e) {}
console.log('SWEEP 3072 OK - ' + staged.length + ' files + bin copied + 3.0.64 artifacts removed');
