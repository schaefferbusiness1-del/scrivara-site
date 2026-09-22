/* sweep-3061c - PLAIN by law: qol-2.3 touched background.js, so the 3.0.61
 * package re-digested (5d239dc1... -> d4f69dda...) and the zip re-built
 * (13344c5c... -> 93ffbec1...). Version number unchanged. Counts probed
 * 2026-08-10 against the live tree, all-or-nothing. */
const fs = require('fs');
const OLD_SHA = '13344c5cb6b806694e807b7b93dd03a7818031eaba0268824f458367c5d4fa9d';
const NEW_SHA = '93ffbec18492643bee44c2585102ef45c986dfdafb0710145acff2629587b3ca';

const plan = [
  ['_config.yml', [[OLD_SHA, NEW_SHA, 1]]],
  ['get-extension.html', [[OLD_SHA, NEW_SHA, 1]]],
  ['tests/extension-package.test.js', [[OLD_SHA, NEW_SHA, 1]]],
  ['tests/public-publication-boundary.test.js', [[OLD_SHA, NEW_SHA, 2]]],
  ['tests/public-release-truth-boundary.test.js', [[OLD_SHA, NEW_SHA, 1]]],
];

const staged = [];
for (const [rel, subs] of plan) {
  let t = fs.readFileSync(rel, 'latin1');
  for (const [from, to, want] of subs) {
    const n = t.split(from).length - 1;
    if (n !== want) { console.error('MISS ' + rel + ' expected ' + want + ' got ' + n); console.error('SWEEP ABORTED - nothing written'); process.exit(1); }
    t = t.split(from).join(to);
  }
  staged.push([rel, t]);
}
for (const [rel, t] of staged) fs.writeFileSync(rel, t, 'latin1');
if (!fs.existsSync('MLS_Assist_v3.0.61.zip')) { console.error('zip missing'); process.exit(1); }
fs.copyFileSync('MLS_Assist_v3.0.61.zip', 'MLS_Assist_v3.0.61.bin');
console.log('SWEEP 3061c OK - ' + staged.length + ' files + bin refreshed');
