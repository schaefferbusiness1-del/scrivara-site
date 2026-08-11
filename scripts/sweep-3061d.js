/* sweep-3061d - PLAIN by law: qol-2.3d touched background.js (qp sweeper
 * busy-stamp parity), so the 3.0.61 package re-digested (d4f69dda... ->
 * 2784a32e...) and the zip re-built (93ffbec1... -> 4d77f337...). Version
 * unchanged. Counts probed 2026-08-10, all-or-nothing. */
const fs = require('fs');
const OLD_SHA = '93ffbec18492643bee44c2585102ef45c986dfdafb0710145acff2629587b3ca';
const NEW_SHA = '4d77f337a6810dac82a36b8f4320a1802411a116b773cd82a18ee37a3e092775';

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
fs.copyFileSync('MLS_Assist_v3.0.61.zip', 'MLS_Assist_v3.0.61.bin');
console.log('SWEEP 3061d OK - ' + staged.length + ' files + bin refreshed');
