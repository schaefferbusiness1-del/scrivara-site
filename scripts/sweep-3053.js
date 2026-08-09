/* 3.0.52 pin sweep - all-or-nothing, explicit constants (the generated rotation
 * cascade mangled FROM-values once; plain beats clever). */
const fs = require('fs');
let failed = false;
const mem = {};
function sub(file, from, to, expect, label) {
  const s = mem[file] !== undefined ? mem[file] : fs.readFileSync(file, 'latin1');
  const n = s.split(from).length - 1;
  if (n !== expect) { console.error('MISS ' + file + ' [' + label + '] expected ' + expect + ' got ' + n); failed = true; return; }
  mem[file] = s.split(from).join(to);
}

const OLD_NOTES = "v3.0.52 - Charts on athena's new-style (rollout) UI can now be read natively: encounter links are harvested directly (no clicking), each encounter page is identity-verified against the expected patient before a single word is read, and anything the reader does not recognize is refused with its shape recorded rather than guessed at - those refusals are expected to shrink build over build as shapes are learned. This route runs ONLY when the classic reader finds no usable chart frame. Everything from v3.0.51 remains. Requires Chrome 116+.";
const NEW_NOTES = "v3.0.53 - The new-style (rollout) reader now always gets its turn: on charts where the classic reader grinds against a stubborn visit list, MLS previously spent the chart's whole time budget before the new-style route could run - five charts on one live day failed exactly that way. The classic phases now hand over with guaranteed time remaining, so the fallback is a real fallback. Everything from v3.0.52 remains. Requires Chrome 116+.";
const OLD_NOTES_BUMPED = OLD_NOTES.split('3.0.52').join('3.0.53');
const OLD_SHA = '22c415c4829df79ce3fde8990992bb903431237c3a86a95a249578287738b99e';
const NEW_SHA = 'cd89ee7ed85528061ef7019821d644b6dcec74e433b1fd2249afad435aa09414';

sub('extension-version.json', '3.0.52', '3.0.53', 2, 'version');
sub('get-extension.html', '3.0.52', '3.0.53', 3, 'version');
sub('ScribeFlow.html', '3.0.52', '3.0.53', 9, 'version');
sub('ScribeFlow-staging.html', '3.0.52', '3.0.53', 6, 'version');
sub('sw.js', '3.0.52', '3.0.53', 1, 'comment-example');
sub('sw.js', '[3, 0, 52]', '[3, 0, 53]', 1, 'package-floor');
sub('_config.yml', '3.0.52', '3.0.53', 3, 'version');
sub('pages-publication-inventory.json', '3.0.52', '3.0.53', 2, 'version');
sub('feat_mls_checker.js', '3.0.52', '3.0.53', 1, 'SERVER_EXT_VERSION');
sub('tests/extension-package.test.js', '3.0.52', '3.0.53', 1, 'version');
sub('tests/public-release-truth-boundary.test.js', '3.0.52', '3.0.53', 2, 'version');
sub('tests/public-publication-boundary.test.js', '3.0.52', '3.0.53', 8, 'version');
sub('tests/extension-reload-helper-contract.test.js', '3.0.52', '3.0.53', 1, 'version');
sub('tests/athena-follow-bidirectional-contract.test.js', '3.0.52', '3.0.53', 5, 'version');
sub('tests/athena-follow-bidirectional-contract.test.js', '3\\.0\\.52', '3\\.0\\.53', 1, 'escaped-vn-regex');

sub('extension-version.json', OLD_NOTES_BUMPED, NEW_NOTES, 1, 'feed-notes');
sub('ScribeFlow.html', OLD_NOTES_BUMPED, NEW_NOTES, 1, 'baked-notes');
sub('ScribeFlow-staging.html', OLD_NOTES_BUMPED, NEW_NOTES, 1, 'staging-notes');

sub('get-extension.html', OLD_SHA, NEW_SHA, 1, 'sha');
sub('_config.yml', OLD_SHA, NEW_SHA, 1, 'sha');
sub('tests/extension-package.test.js', OLD_SHA, NEW_SHA, 1, 'sha');
sub('tests/public-release-truth-boundary.test.js', OLD_SHA, NEW_SHA, 1, 'sha');
sub('tests/public-publication-boundary.test.js', OLD_SHA, NEW_SHA, 2, 'sha');

sub('mls-connect.js', 'chk3052', 'chk3053', 1, 'chk-token');
sub('mls-connect.staging.js', 'chk3052', 'chk3053', 1, 'chk-token');
sub('tests/extension-reload-helper-contract.test.js', 'chk3052', 'chk3053', 3, 'chk-new');
sub('tests/extension-reload-helper-contract.test.js', 'chk3051', 'chk3052', 1, 'chk-old');
sub('tests/immutable-satellite-loader-cache-contract.test.js', 'chk3052', 'chk3053', 3, 'chk-new');
sub('tests/immutable-satellite-loader-cache-contract.test.js', 'chk3051', 'chk3052', 1, 'chk-old');

if (failed) { console.error('SWEEP ABORTED - nothing written'); process.exit(1); }
for (const f of Object.keys(mem)) fs.writeFileSync(f, mem[f], 'latin1');
fs.copyFileSync('MLS_Assist_v3.0.53.zip', 'MLS_Assist_v3.0.53.bin');
try { fs.unlinkSync('MLS_Assist_v3.0.52.zip'); } catch (e) {}
try { fs.unlinkSync('MLS_Assist_v3.0.52.bin'); } catch (e) {}
console.log('SWEEP OK - ' + Object.keys(mem).length + ' files, mirror built, 3.0.52 package retired');
