/* sweep-3064 - PLAIN by law: explicit constants, counts probed 2026-08-18
 * against the live tree, all-or-nothing. 3.0.63 -> 3.0.64 (mls-hs-1.0.0:
 * hidden-tab-safe sleeps in every injected Athena driver, so chart reads keep
 * their pace while the athenaOne tab is in the background - the day-note leg
 * finished 4 of 5 in 68 s with the tab in front and 0 of 5 with it hidden on
 * 2026-08-18) · chk3063 -> chk3064 (feat_mls_checker.js bytes move with
 * SERVER_EXT_VERSION, so its immutable loader token moves in every loader that
 * names it) · zip sha c71a6375... -> 1fd1c977... · release notes replaced in the
 * feed and every surface that bakes them (the What's-new pin asserts baked ==
 * feed). Historical feature-origin comments are deliberately NOT moved.
 * Usage: node scripts/sweep-3064.js [--dry] */
'use strict';
const fs = require('fs');
const DRY = process.argv.includes('--dry');
const OLD = '3.0.63', NEW = '3.0.64';
const OLD_SHA = 'c71a63758cfd237bdd1041840ae750db6e1f578607e01970aa5cc4bb1e5d7c79';
const NEW_SHA = '1fd1c977430aa0550edd3a99f864bfb901e5c3c4dbcf63bf8ed2a27636b42c23';
const OLD_CHK = '20260817chk3063', NEW_CHK = '20260818chk3064';
const OLD_NOTES = 'v3.0.63 - Athena tab handling made robust: MLS now prefers the Athena tab whose Day view is actually rendered, re-checks a tab that was slow to answer instead of reporting no Athena tab while you are signed in, and treats a not-yet-rendered week strip as something to recover from rather than a failed day change. Every date, schedule and presence reply now also carries how many Athena tabs are open, so the app can advise keeping one. Reads only; nothing about writing changes. Everything from earlier releases remains. Requires Chrome 116+.';
const NEW_NOTES = 'v3.0.64 - Chart reads keep their pace while the athenaOne tab is in the background: every step that waits inside Athena now runs at normal speed even when that tab is hidden, so the day’s visit notes finish alongside the histories instead of timing out. Nothing about writing changes. Everything from earlier releases remains. Requires Chrome 116+.';

const plan = [
  ['extension-version.json', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 1]]],
  ['get-extension.html', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['ScribeFlow.html', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 8]]],
  ['ScribeFlow-staging.html', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 5]]],
  ['1p/index.html', [[OLD_NOTES, NEW_NOTES, 1], ['id="extDlVersion">' + OLD + '<', 'id="extDlVersion">' + NEW + '<', 1], ['id="extDlVersionBtn">' + OLD + '<', 'id="extDlVersionBtn">' + NEW + '<', 1], ['id="extDlVersionNotes">' + OLD + '<', 'id="extDlVersionNotes">' + NEW + '<', 1], ['MLS_Assist_v' + OLD + '.bin', 'MLS_Assist_v' + NEW + '.bin', 1], ['MLS_Assist_v' + OLD + '.zip', 'MLS_Assist_v' + NEW + '.zip', 3], ['Direct package (v' + OLD + ' ZIP)', 'Direct package (v' + NEW + ' ZIP)', 1]]],
  ['1pScribeFlow.html', [[OLD_NOTES, NEW_NOTES, 1], ['id="extDlVersion">' + OLD + '<', 'id="extDlVersion">' + NEW + '<', 1], ['id="extDlVersionBtn">' + OLD + '<', 'id="extDlVersionBtn">' + NEW + '<', 1], ['id="extDlVersionNotes">' + OLD + '<', 'id="extDlVersionNotes">' + NEW + '<', 1], ['MLS_Assist_v' + OLD + '.bin', 'MLS_Assist_v' + NEW + '.bin', 1], ['MLS_Assist_v' + OLD + '.zip', 'MLS_Assist_v' + NEW + '.zip', 3], ['Direct package (v' + OLD + ' ZIP)', 'Direct package (v' + NEW + ' ZIP)', 1]]],
  ['cloned/index.html', [[OLD_NOTES, NEW_NOTES, 1], ['id="extDlVersion">' + OLD + '<', 'id="extDlVersion">' + NEW + '<', 1], ['id="extDlVersionBtn">' + OLD + '<', 'id="extDlVersionBtn">' + NEW + '<', 1], ['id="extDlVersionNotes">' + OLD + '<', 'id="extDlVersionNotes">' + NEW + '<', 1], ['MLS_Assist_v' + OLD + '.bin', 'MLS_Assist_v' + NEW + '.bin', 1], ['MLS_Assist_v' + OLD + '.zip', 'MLS_Assist_v' + NEW + '.zip', 3], ['Direct package (v' + OLD + ' ZIP)', 'Direct package (v' + NEW + ' ZIP)', 1]]],
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
  ['tests/extension-reload-helper-contract.test.js', [['token moved 20260817chk3062 -> 20260817chk3063 deliberately with the 3.0.63', 'token moved 20260817chk3063 -> 20260818chk3064 deliberately with the 3.0.64', 1], ['feat_mls_checker.js?v=' + OLD_CHK, 'feat_mls_checker.js?v=' + NEW_CHK, 2]]],
  ['tests/immutable-satellite-loader-cache-contract.test.js', [["['feat_mls_checker.js', '20260817chk3063', '20260817chk3062']", "['feat_mls_checker.js', '20260818chk3064', '20260817chk3063']", 1], ['feat_mls_checker.js?v=' + OLD_CHK, 'feat_mls_checker.js?v=' + NEW_CHK, 1]]],
  ['tests/athena-follow-bidirectional-contract.test.js', [[OLD, NEW, 6]]],
  /* the /1p preview contract maps the FROZEN 3.0.61 / 4d77f337 baseline literals to the current release */
  ['tests/1p-preview-contract.test.js', [["['MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.63']", "['MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.64']", 1], ["['4d77f337a6810dac82a36b8f4320a1802411a116b773cd82a18ee37a3e092775', '" + OLD_SHA + "']", "['4d77f337a6810dac82a36b8f4320a1802411a116b773cd82a18ee37a3e092775', '" + NEW_SHA + "']", 1], ["'MLS_Assist_v3.0.63.zip'", "'MLS_Assist_v3.0.64.zip'", 1], ["'MLS_Assist_v3.0.63.bin'", "'MLS_Assist_v3.0.64.bin'", 1]]],
];

const staged = [];
let bad = 0;
for (const [rel, subs] of plan) {
  let t = fs.readFileSync(rel, 'latin1');
  for (const [from, to, want] of subs) {
    const n = t.split(from).length - 1;
    if (n !== want) { console.error('MISS ' + rel + ' [' + from.slice(0, 40) + '] expected ' + want + ' got ' + n); bad++; }
    t = t.split(from).join(to);
  }
  staged.push([rel, t]);
}
if (bad) { console.error('SWEEP ABORTED - nothing written (' + bad + ' misses)'); process.exit(1); }
if (DRY) { console.log('DRY RUN OK - all ' + plan.length + ' files match expected counts; nothing written'); process.exit(0); }
for (const [rel, t] of staged) fs.writeFileSync(rel, t, 'latin1');
if (!fs.existsSync('MLS_Assist_v3.0.64.zip')) { console.error('3.0.64 zip missing'); process.exit(1); }
fs.copyFileSync('MLS_Assist_v3.0.64.zip', 'MLS_Assist_v3.0.64.bin');
try { fs.unlinkSync('MLS_Assist_v3.0.63.zip'); } catch (e) {}
try { fs.unlinkSync('MLS_Assist_v3.0.63.bin'); } catch (e) {}
console.log('SWEEP 3064 OK - ' + staged.length + ' files + bin copied + 3.0.63 artifacts removed');
