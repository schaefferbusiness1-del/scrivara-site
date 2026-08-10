/* sweep-3056 - PLAIN by law: explicit constants, counts probed 2026-08-09
 * against the live tree, all-or-nothing. 3.0.55 -> 3.0.56 · chk3055 ->
 * chk3056 (new slot first) · chk3054 -> chk3055 · zip sha e8f963d4... ->
 * a89dcfd7... (zip/bin files already renamed by the build step). */
const fs = require('fs');
const OLD = '3.0.55', NEW = '3.0.56';
const OLD_ESC = '3\\.0\\.55', NEW_ESC = '3\\.0\\.56';
const OLD_SHA = 'e8f963d422cb172ac17cbe66aa7685b0dfb7da78c054d6751446f039b7b6ee24';
const NEW_SHA = 'a89dcfd772ef80c159be0e14d34a66a2905abcf9827a28a4f94a4da201e82f00';

const plan = [
  ['extension-version.json', [[OLD, NEW, 2]]],
  ['get-extension.html', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['ScribeFlow.html', [[OLD, NEW, 9]]],
  ['ScribeFlow-staging.html', [[OLD, NEW, 6]]],
  ['sw.js', [[OLD, NEW, 1]]],
  ['_config.yml', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['pages-publication-inventory.json', [[OLD, NEW, 2]]],
  ['feat_mls_checker.js', [[OLD, NEW, 1]]],
  ['mls-connect.js', [['chk3055', 'chk3056', 1]]],
  ['mls-connect.staging.js', [['chk3055', 'chk3056', 1]]],
  ['tests/extension-package.test.js', [[OLD, NEW, 1], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/public-publication-boundary.test.js', [[OLD, NEW, 8], [OLD_SHA, NEW_SHA, 2]]],
  ['tests/public-release-truth-boundary.test.js', [[OLD, NEW, 2], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/extension-reload-helper-contract.test.js', [['chk3055', 'chk3056', 3], ['chk3054', 'chk3055', 1], [OLD, NEW, 1]]],
  ['tests/immutable-satellite-loader-cache-contract.test.js', [['chk3055', 'chk3056', 3], ['chk3054', 'chk3055', 1]]],
  ['tests/athena-follow-bidirectional-contract.test.js', [[OLD_ESC, NEW_ESC, 1], [OLD, NEW, 5]]],
];

const staged = [];
for (const [rel, subs] of plan) {
  let t = fs.readFileSync(rel, 'latin1');
  for (const [from, to, want] of subs) {
    const n = t.split(from).length - 1;
    if (n !== want) { console.error('MISS ' + rel + ' [' + from.slice(0, 24) + '] expected ' + want + ' got ' + n); console.error('SWEEP ABORTED - nothing written'); process.exit(1); }
    t = t.split(from).join(to);
  }
  staged.push([rel, t]);
}
for (const [rel, t] of staged) fs.writeFileSync(rel, t, 'latin1');
if (!fs.existsSync('MLS_Assist_v3.0.56.zip') || !fs.existsSync('MLS_Assist_v3.0.56.bin')) { console.error('3.0.56 zip/bin missing'); process.exit(1); }
console.log('SWEEP 3056 OK - ' + staged.length + ' files');
