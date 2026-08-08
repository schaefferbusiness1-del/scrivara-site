/* 3.0.50 pin sweep: every published reference moves together or nothing moves.
 * Order: blanket version bump first, then notes correction, then sha, then
 * chk-token rotation NEW-SLOT-FIRST (3049->3050 before 3048->3049). */
const fs = require('fs');
let failed = false;
const mem = {};
function sub(file, from, to, expect, label) {
  const s = mem[file] !== undefined ? mem[file] : fs.readFileSync(file, 'latin1');
  const n = s.split(from).length - 1;
  if (n !== expect) { console.error('MISS ' + file + ' [' + label + '] expected ' + expect + ' got ' + n); failed = true; return; }
  mem[file] = s.split(from).join(to);
}

const OLD_NOTES = "v3.0.49 - Charts whose Visits panel athena renders in an unusual frame now read correctly: the reader accepts that frame only after the frame itself proves it is showing this exact patient, so the six charts that failed on one live day now load while the old wrong-patient worklist trap stays blocked. Everything from v3.0.48 remains. Requires Chrome 116+.";
const NEW_NOTES = "v3.0.50 - Two live failure shapes fixed: when athenaOne's scheduling view replaces the chart surface mid-read (it does this on its own every ~25-30 seconds), the reader now detects the swap, re-proves the patient identity, and re-binds the same encounter row instead of failing it; and the new-style athena chart (athena's gradual rollout) no longer stalls at the exam-prep screen - the reader now finds athena's navigation even where it is hidden in shadow DOM. Everything from v3.0.49 remains. Requires Chrome 116+.";
const OLD_NOTES_BUMPED = OLD_NOTES.split('3.0.49').join('3.0.50');
const OLD_SHA = '05027f4a17e15cbcfb34f8f08c96f2cd4e6c52cd4325a6e633421b2cba8fa217';
const NEW_SHA = '5e107b2c454e7320bb7344a0388ffe0871fa69342f3bfe0bd4a93f0b471732f3';

/* blanket version bumps (exact plain-occurrence counts measured 2026-08-08) */
sub('extension-version.json', '3.0.49', '3.0.50', 2, 'version');
sub('get-extension.html', '3.0.49', '3.0.50', 3, 'version');
sub('ScribeFlow.html', '3.0.49', '3.0.50', 9, 'version');
sub('ScribeFlow-staging.html', '3.0.49', '3.0.50', 6, 'version');
sub('sw.js', '3.0.49', '3.0.50', 1, 'comment-example');
sub('sw.js', '[3, 0, 49]', '[3, 0, 50]', 1, 'package-floor');
sub('_config.yml', '3.0.49', '3.0.50', 3, 'version');
sub('pages-publication-inventory.json', '3.0.49', '3.0.50', 2, 'version');
sub('feat_mls_checker.js', '3.0.49', '3.0.50', 1, 'SERVER_EXT_VERSION');
sub('tests/extension-package.test.js', '3.0.49', '3.0.50', 1, 'version');
sub('tests/public-release-truth-boundary.test.js', '3.0.49', '3.0.50', 2, 'version');
sub('tests/public-publication-boundary.test.js', '3.0.49', '3.0.50', 8, 'version');
sub('tests/extension-reload-helper-contract.test.js', '3.0.49', '3.0.50', 1, 'version');

/* notes: the bumped-old-notes string is now deterministic - swap for the real new notes */
sub('extension-version.json', OLD_NOTES_BUMPED, NEW_NOTES, 1, 'feed-notes');
sub('ScribeFlow.html', OLD_NOTES_BUMPED, NEW_NOTES, 1, 'baked-notes');
sub('ScribeFlow-staging.html', OLD_NOTES_BUMPED, NEW_NOTES, 1, 'staging-notes');

/* displayed/verified package sha */
sub('get-extension.html', OLD_SHA, NEW_SHA, 1, 'sha');
sub('_config.yml', OLD_SHA, NEW_SHA, 1, 'sha');
sub('tests/extension-package.test.js', OLD_SHA, NEW_SHA, 1, 'sha');
sub('tests/public-release-truth-boundary.test.js', OLD_SHA, NEW_SHA, 1, 'sha');
sub('tests/public-publication-boundary.test.js', OLD_SHA, NEW_SHA, 2, 'sha');

/* chk token rotation - NEW SLOT FIRST so 3048 never leapfrogs to 3050 */
sub('mls-connect.js', 'chk3049', 'chk3050', 1, 'chk-token');
sub('mls-connect.staging.js', 'chk3049', 'chk3050', 1, 'chk-token');
sub('tests/extension-reload-helper-contract.test.js', 'chk3049', 'chk3050', 3, 'chk-new');
sub('tests/extension-reload-helper-contract.test.js', 'chk3048', 'chk3049', 1, 'chk-old');
sub('tests/immutable-satellite-loader-cache-contract.test.js', 'chk3049', 'chk3050', 3, 'chk-new');
sub('tests/immutable-satellite-loader-cache-contract.test.js', 'chk3048', 'chk3049', 1, 'chk-old');

if (failed) { console.error('SWEEP ABORTED - nothing written'); process.exit(1); }
for (const f of Object.keys(mem)) fs.writeFileSync(f, mem[f], 'latin1');

/* package mirror + retire the old package (inventory declares the exact tree) */
fs.copyFileSync('MLS_Assist_v3.0.50.zip', 'MLS_Assist_v3.0.50.bin');
try { fs.unlinkSync('MLS_Assist_v3.0.49.zip'); } catch (e) {}
try { fs.unlinkSync('MLS_Assist_v3.0.49.bin'); } catch (e) {}
console.log('SWEEP OK - ' + Object.keys(mem).length + ' files moved, mirror built, 3.0.49 package retired');
