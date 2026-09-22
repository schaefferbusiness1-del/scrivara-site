/* sweep-3057 - PLAIN by law: explicit constants, counts probed 2026-08-10
 * against the live tree, all-or-nothing. 3.0.56 -> 3.0.57 · chk3056 ->
 * chk3057 (new slot first) · chk3055 -> chk3056 · zip sha a89dcfd7... ->
 * 0efd00cc... (zip/bin renamed by the build step). Historical feature-origin
 * comments "qv-1.0 (3.0.56)" and "fb-1.3 (3.0.56)" deliberately NOT moved. */
const fs = require('fs');
const OLD = '3.0.56', NEW = '3.0.57';
const OLD_SHA = 'a89dcfd772ef80c159be0e14d34a66a2905abcf9827a28a4f94a4da201e82f00';
const NEW_SHA = '0efd00ccf06a48d8e8a5992681a2e58d52105fcc3ff661c884f2d4d9303575df';

const plan = [
  ['extension-version.json', [[OLD, NEW, 2]]],
  ['get-extension.html', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['ScribeFlow.html', [[OLD, NEW, 9]]],
  ['ScribeFlow-staging.html', [[OLD, NEW, 6]]],
  ['sw.js', [[OLD, NEW, 1]]],
  ['_config.yml', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['pages-publication-inventory.json', [[OLD, NEW, 2]]],
  ['feat_mls_checker.js', [[OLD, NEW, 1]]],
  ['mls-connect.js', [['chk3056', 'chk3057', 1]]],
  ['mls-connect.staging.js', [['chk3056', 'chk3057', 1]]],
  ['tests/extension-package.test.js', [[OLD, NEW, 1], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/public-publication-boundary.test.js', [[OLD, NEW, 8], [OLD_SHA, NEW_SHA, 2]]],
  ['tests/public-release-truth-boundary.test.js', [[OLD, NEW, 2], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/extension-reload-helper-contract.test.js', [['chk3056', 'chk3057', 3], ['chk3055', 'chk3056', 1], [OLD, NEW, 1]]],
  ['tests/immutable-satellite-loader-cache-contract.test.js', [['chk3056', 'chk3057', 3], ['chk3055', 'chk3056', 1]]],
  ['tests/athena-follow-bidirectional-contract.test.js', [[OLD, NEW, 5]]],
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
if (!fs.existsSync('MLS_Assist_v3.0.57.zip')) { console.error('3.0.57 zip missing'); process.exit(1); }
fs.copyFileSync('MLS_Assist_v3.0.57.zip', 'MLS_Assist_v3.0.57.bin');
console.log('SWEEP 3057 OK - ' + staged.length + ' files + bin copied');
