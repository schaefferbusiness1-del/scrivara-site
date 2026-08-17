/* sweep-3062 - PLAIN by law: explicit constants, counts probed 2026-08-17
 * against the live tree, all-or-nothing. 3.0.61 -> 3.0.62 (wsg-2.0.0: the
 * owner-directed lift of the four write-safety execute layers; every
 * supervised Athena action executes after the clinician's own confirm) ·
 * chk3061 -> chk3062 (feat_mls_checker.js bytes move with SERVER_EXT_VERSION,
 * so its immutable loader token moves in every loader that names it) ·
 * zip sha 4d77f337... -> 56710c44... · release notes replaced in the feed and
 * every page that bakes them (the What's-new pin asserts baked == feed).
 * Historical feature-origin comments and the sw.js measured-live note are
 * deliberately NOT moved. Usage: node scripts/sweep-3062.js [--dry] */
'use strict';
const fs = require('fs');
const DRY = process.argv.includes('--dry');
const OLD = '3.0.61', NEW = '3.0.62';
const OLD_SHA = '4d77f337a6810dac82a36b8f4320a1802411a116b773cd82a18ee37a3e092775';
const NEW_SHA = '56710c442e7feb67398ffa533fb199bbf89feed10e7fe9baf9671b5877eb24b1';
const OLD_CHK = '20260810chk3061', NEW_CHK = '20260817chk3062';
const OLD_NOTES = 'v3.0.61 - When a chart cannot be fully read, MLS now records exactly what it saw at the moment each part failed - how many encounter rows were on screen and whether the expected one was still present - so recurring problems can be diagnosed from the receipts instead of guessed at. Purely additive; nothing about reading or saving changes. Everything from v3.0.53 remains. Requires Chrome 116+.';
const NEW_NOTES = 'v3.0.62 - Every supervised Athena action now executes after your explicit confirm: write reviewed note, save draft, stage billing codes, Sign & Save, and one exact reviewed order. The previous preview-only policy block on billing, signing and orders is lifted by the owner; the same safety checks still run before every send - exact patient identity and encounter lock, a one-use authorization from your own click, a verified note write before Sign & Save, one action per confirm, and no automatic chaining. Everything from earlier releases remains. Requires Chrome 116+.';
/* HTML pages bake the notes with &#39; for the apostrophe-free text above there
   is no entity difference, but the feed is JSON: the notes contain '&' which is
   plain in both. */

const plan = [
  ['extension-version.json', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 1]]],
  ['get-extension.html', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['ScribeFlow.html', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 8]]],
  ['ScribeFlow-staging.html', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 5]]],
  ['1p/index.html', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 8]]],
  ['1pScribeFlow.html', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 8]]],
  ['cloned/index.html', [[OLD_NOTES, NEW_NOTES, 1], [OLD, NEW, 8]]],
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
  ['tests/extension-reload-helper-contract.test.js', [['token moved 20260808chk3056 -> 20260810chk3061 deliberately with the 3.0.61', 'token moved 20260810chk3061 -> 20260817chk3062 deliberately with the 3.0.62', 1], ['feat_mls_checker.js?v=' + OLD_CHK, 'feat_mls_checker.js?v=' + NEW_CHK, 2]]],
  ['tests/immutable-satellite-loader-cache-contract.test.js', [["['feat_mls_checker.js', '20260810chk3061', '20260808chk3056']", "['feat_mls_checker.js', '20260817chk3062', '20260810chk3061']", 1], ['feat_mls_checker.js?v=' + OLD_CHK, 'feat_mls_checker.js?v=' + NEW_CHK, 1]]],
  ['tests/athena-follow-bidirectional-contract.test.js', [[OLD, NEW, 6]]],
  ['tests/1p-preview-contract.test.js', [['MLS_Assist_v3.0.61', 'MLS_Assist_v3.0.62', 2]]],
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
if (!fs.existsSync('MLS_Assist_v3.0.62.zip')) { console.error('3.0.62 zip missing'); process.exit(1); }
fs.copyFileSync('MLS_Assist_v3.0.62.zip', 'MLS_Assist_v3.0.62.bin');
try { fs.unlinkSync('MLS_Assist_v3.0.61.zip'); } catch (e) {}
try { fs.unlinkSync('MLS_Assist_v3.0.61.bin'); } catch (e) {}
console.log('SWEEP 3062 OK - ' + staged.length + ' files + bin copied + 3.0.61 artifacts removed');
