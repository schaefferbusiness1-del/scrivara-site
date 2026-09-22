/* 3.0.51 pin sweep - same all-or-nothing discipline as sweep-3050. */
const fs = require('fs');
let failed = false;
const mem = {};
function sub(file, from, to, expect, label) {
  const s = mem[file] !== undefined ? mem[file] : fs.readFileSync(file, 'latin1');
  const n = s.split(from).length - 1;
  if (n !== expect) { console.error('MISS ' + file + ' [' + label + '] expected ' + expect + ' got ' + n); failed = true; return; }
  mem[file] = s.split(from).join(to);
}

const OLD_NOTES = "v3.0.50 - Two live failure shapes fixed: when athenaOne's scheduling view replaces the chart surface mid-read (it does this on its own every ~25-30 seconds), the reader now detects the swap, re-proves the patient identity, and re-binds the same encounter row instead of failing it; and the new-style athena chart (athena's gradual rollout) no longer stalls at the exam-prep screen - the reader now finds athena's navigation even where it is hidden in shadow DOM. Everything from v3.0.49 remains. Requires Chrome 116+.";
const NEW_NOTES = "v3.0.51 - Three sharpenings from live July runs: charts whose visit list renders in athena's variant frame but arrives EMPTY are now re-expanded in place and read (five July-1 charts failed exactly there); after athena replaces the chart surface mid-read, the reader now waits for the reborn page to paint its patient banner before judging identity (one false refusal fixed - the safety refusal itself is unchanged); and each day's closing summary now NAMES the charts needing retry, while every chart's receipt records which athena UI answered. Everything from v3.0.50 remains. Requires Chrome 116+.";
const OLD_NOTES_BUMPED = OLD_NOTES.split('3.0.50').join('3.0.51');
const OLD_SHA = '5e107b2c454e7320bb7344a0388ffe0871fa69342f3bfe0bd4a93f0b471732f3';
const NEW_SHA = '6523fa1cf5cb30fcc2f45c214626e137c9516f296c56836219be7a5b453329f8';

sub('extension-version.json', '3.0.50', '3.0.51', 2, 'version');
sub('get-extension.html', '3.0.50', '3.0.51', 3, 'version');
sub('ScribeFlow.html', '3.0.50', '3.0.51', 9, 'version');
sub('ScribeFlow-staging.html', '3.0.50', '3.0.51', 6, 'version');
sub('sw.js', '3.0.50', '3.0.51', 1, 'comment-example');
sub('sw.js', '[3, 0, 50]', '[3, 0, 51]', 1, 'package-floor');
sub('_config.yml', '3.0.50', '3.0.51', 3, 'version');
sub('pages-publication-inventory.json', '3.0.50', '3.0.51', 2, 'version');
sub('feat_mls_checker.js', '3.0.50', '3.0.51', 1, 'SERVER_EXT_VERSION');
sub('tests/extension-package.test.js', '3.0.50', '3.0.51', 1, 'version');
sub('tests/public-release-truth-boundary.test.js', '3.0.50', '3.0.51', 2, 'version');
sub('tests/public-publication-boundary.test.js', '3.0.50', '3.0.51', 8, 'version');
sub('tests/extension-reload-helper-contract.test.js', '3.0.50', '3.0.51', 1, 'version');
sub('tests/athena-follow-bidirectional-contract.test.js', '3.0.50', '3.0.51', 5, 'version');
sub('tests/athena-follow-bidirectional-contract.test.js', '3\\.0\\.50', '3\\.0\\.51', 1, 'escaped-vn-regex');

sub('extension-version.json', OLD_NOTES_BUMPED, NEW_NOTES, 1, 'feed-notes');
sub('ScribeFlow.html', OLD_NOTES_BUMPED, NEW_NOTES, 1, 'baked-notes');
sub('ScribeFlow-staging.html', OLD_NOTES_BUMPED, NEW_NOTES, 1, 'staging-notes');

sub('get-extension.html', OLD_SHA, NEW_SHA, 1, 'sha');
sub('_config.yml', OLD_SHA, NEW_SHA, 1, 'sha');
sub('tests/extension-package.test.js', OLD_SHA, NEW_SHA, 1, 'sha');
sub('tests/public-release-truth-boundary.test.js', OLD_SHA, NEW_SHA, 1, 'sha');
sub('tests/public-publication-boundary.test.js', OLD_SHA, NEW_SHA, 2, 'sha');

sub('mls-connect.js', 'chk3050', 'chk3051', 1, 'chk-token');
sub('mls-connect.staging.js', 'chk3050', 'chk3051', 1, 'chk-token');
sub('tests/extension-reload-helper-contract.test.js', 'chk3050', 'chk3051', 3, 'chk-new');
sub('tests/extension-reload-helper-contract.test.js', 'chk3049', 'chk3050', 1, 'chk-old');
sub('tests/immutable-satellite-loader-cache-contract.test.js', 'chk3050', 'chk3051', 3, 'chk-new');
sub('tests/immutable-satellite-loader-cache-contract.test.js', 'chk3049', 'chk3050', 1, 'chk-old');

if (failed) { console.error('SWEEP ABORTED - nothing written'); process.exit(1); }
for (const f of Object.keys(mem)) fs.writeFileSync(f, mem[f], 'latin1');
fs.copyFileSync('MLS_Assist_v3.0.51.zip', 'MLS_Assist_v3.0.51.bin');
try { fs.unlinkSync('MLS_Assist_v3.0.50.zip'); } catch (e) {}
try { fs.unlinkSync('MLS_Assist_v3.0.50.bin'); } catch (e) {}
console.log('SWEEP OK - ' + Object.keys(mem).length + ' files, mirror built, 3.0.50 package retired');
