/* sweep-3061 - PLAIN by law: explicit constants, counts probed 2026-08-10
 * against the live tree, all-or-nothing. 3.0.57 -> 3.0.61 (owner renumbered
 * the release; 3.0.57 was committed but never published) · chk3057 ->
 * chk3061 (new slot only; the historical chk3056 slots are untouched) ·
 * zip sha 0efd00cc... -> 13344c5c... Historical feature-origin comments
 * ("qv-1.0 (3.0.56)" etc.) deliberately NOT moved. */
const fs = require('fs');
const OLD = '3.0.57', NEW = '3.0.61';
const OLD_SHA = '0efd00ccf06a48d8e8a5992681a2e58d52105fcc3ff661c884f2d4d9303575df';
const NEW_SHA = '13344c5cb6b806694e807b7b93dd03a7818031eaba0268824f458367c5d4fa9d';
const OLD_CHK = '20260810chk3057', NEW_CHK = '20260810chk3061';

const plan = [
  ['extension-version.json', [[OLD, NEW, 2]]],
  ['get-extension.html', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['ScribeFlow.html', [[OLD, NEW, 9]]],
  ['ScribeFlow-staging.html', [[OLD, NEW, 6]]],
  ['sw.js', [[OLD, NEW, 1]]],
  ['_config.yml', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['pages-publication-inventory.json', [[OLD, NEW, 2]]],
  ['feat_mls_checker.js', [[OLD, NEW, 1]]],
  ['mls-connect.js', [[OLD_CHK, NEW_CHK, 1]]],
  ['mls-connect.staging.js', [[OLD_CHK, NEW_CHK, 1]]],
  ['tests/extension-package.test.js', [[OLD, NEW, 1], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/public-publication-boundary.test.js', [[OLD, NEW, 8], [OLD_SHA, NEW_SHA, 2]]],
  ['tests/public-release-truth-boundary.test.js', [[OLD, NEW, 2], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/extension-reload-helper-contract.test.js', [[OLD_CHK, NEW_CHK, 3], [OLD, NEW, 1]]],
  ['tests/immutable-satellite-loader-cache-contract.test.js', [[OLD_CHK, NEW_CHK, 3]]],
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
if (!fs.existsSync('MLS_Assist_v3.0.61.zip')) { console.error('3.0.61 zip missing'); process.exit(1); }
fs.copyFileSync('MLS_Assist_v3.0.61.zip', 'MLS_Assist_v3.0.61.bin');
try { fs.unlinkSync('MLS_Assist_v3.0.57.zip'); } catch (e) {}
try { fs.unlinkSync('MLS_Assist_v3.0.57.bin'); } catch (e) {}
console.log('SWEEP 3061 OK - ' + staged.length + ' files + bin copied + 3.0.57 artifacts removed');
