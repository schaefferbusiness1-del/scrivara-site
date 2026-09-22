/* sweep-3055 - PLAIN by law (plain-beats-clever): explicit FROM/TO constants,
 * counts probed 2026-08-09 against the live tree, all-or-nothing.
 * 3.0.54 -> 3.0.55 · chk3054 -> chk3055 (new slot first) · chk3053 -> chk3054
 * old zip sha 34041bcf... -> dd5738e2... · retire MLS_Assist_v3.0.54.zip
 */
const fs = require('fs');
const OLD = '3.0.54', NEW = '3.0.55';
const OLD_ESC = '3\\.0\\.54', NEW_ESC = '3\\.0\\.55';
const OLD_SHA = '34041bcfc076ef3da87a8ab6d8300a720ff6fa5dca405d84be328894241bb5c8';
const NEW_SHA = 'dd5738e227cfe27701edf74703d404b097857a667fdb199c4f3b980616dfc5c1';

const plan = [
  ['extension-version.json', [[OLD, NEW, 2]]],
  ['get-extension.html', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['ScribeFlow.html', [[OLD, NEW, 9]]],
  ['ScribeFlow-staging.html', [[OLD, NEW, 6]]],
  ['sw.js', [[OLD, NEW, 1]]],
  ['_config.yml', [[OLD, NEW, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['pages-publication-inventory.json', [[OLD, NEW, 2]]],
  ['feat_mls_checker.js', [[OLD, NEW, 1]]],
  ['mls-connect.js', [['chk3054', 'chk3055', 1]]],
  ['mls-connect.staging.js', [['chk3054', 'chk3055', 1]]],
  ['tests/extension-package.test.js', [[OLD, NEW, 1], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/public-publication-boundary.test.js', [[OLD, NEW, 8], [OLD_SHA, NEW_SHA, 2]]],
  ['tests/public-release-truth-boundary.test.js', [[OLD, NEW, 2], [OLD_SHA, NEW_SHA, 1]]],
  /* rotation NEW SLOT FIRST: existing chk3054 -> chk3055 before the old slot
     refills, or the second sub would double-convert what the first created */
  ['tests/extension-reload-helper-contract.test.js', [['chk3054', 'chk3055', 3], ['chk3053', 'chk3054', 1], [OLD, NEW, 1]]],
  ['tests/immutable-satellite-loader-cache-contract.test.js', [['chk3054', 'chk3055', 3], ['chk3053', 'chk3054', 1]]],
  ['tests/athena-follow-bidirectional-contract.test.js', [[OLD_ESC, NEW_ESC, 1], [OLD, NEW, 5]]],
];

/* NOTE on the follow test: the escaped form runs FIRST so the plain count of 5
   is measured AFTER the escaped sub (the escaped form contains the plain form
   as a substring is FALSE - '3\.0\.54' does not contain '3.0.54' - but probe
   order matched: escaped 1 + plain 5 were counted independently; running
   escaped first keeps the plain sub from eating the escaped byte run). */

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
if (!fs.existsSync('MLS_Assist_v3.0.55.zip')) { console.error('NEW ZIP MISSING'); process.exit(1); }
if (fs.existsSync('MLS_Assist_v3.0.54.zip')) { fs.unlinkSync('MLS_Assist_v3.0.54.zip'); console.log('retired MLS_Assist_v3.0.54.zip'); }
console.log('SWEEP 3055 OK - ' + staged.length + ' files');
