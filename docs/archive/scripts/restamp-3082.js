/* restamp-3082 - the release-package pins catch up with the release the owner
 * already made: he packaged and uploaded these exact 3.0.82 bytes to the
 * Chrome Web Store on 2026-08-26 and froze the extension. The repo core was
 * proven byte-identical to the enabled/store folder (core digest 477144ad on
 * both) before this ran. Adapted from restamp-3081:
 *   1. version_name digest stamp already applied + verified (477144ad);
 *   2. MLS_Assist_v3.0.82.zip built deterministically + .bin mirrored
 *      (package sha 2901c60b);
 *   3. this script sweeps the version and package-sha pins across every
 *      published/pinned file, exact counts, all-or-nothing. Derived shells
 *      (ScribeFlow.html, cloned/index.html) are NOT swept here - re-derive. */
const fs = require('fs');
const crypto = require('crypto');

const OLD_SHA = 'f38834f7e28f50bd86b506bdfe2f5aa3a0730f4bade75e7f9dbd8c3b02454442';
const NEW_SHA = crypto.createHash('sha256').update(fs.readFileSync('MLS_Assist_v3.0.82.zip')).digest('hex');
const OLD_V = '3.0.81', NEW_V = '3.0.82';
const OLD_DIR = 'owner directive 2026-08-25', NEW_DIR = 'owner directive 2026-08-26';

/* [file, [[from, to, exactCount], ...]] */
const plan = [
  ['_config.yml', [[OLD_V, NEW_V, 4], [OLD_SHA, NEW_SHA, 1], [OLD_DIR, NEW_DIR, 1]]],
  ['get-extension.html', [[OLD_V, NEW_V, 5], [OLD_SHA, NEW_SHA, 1]]],
  ['1pScribeFlow.html', [[OLD_V, NEW_V, 9]]],
  ['1p/index.html', [[OLD_V, NEW_V, 9]]],
  ['feat_mls_checker.js', [[OLD_V, NEW_V, 1]]],
  ['pages-publication-inventory.json', [[OLD_V, NEW_V, 2]]],
  ['tests/extension-package.test.js', [[OLD_V, NEW_V, 2], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/public-publication-boundary.test.js', [[OLD_V, NEW_V, 13], [OLD_SHA, NEW_SHA, 1], ['Owner directive 2026-08-25', 'Owner directive 2026-08-26', 2]]],
  ['tests/public-release-truth-boundary.test.js', [[OLD_V, NEW_V, 3], [OLD_SHA, NEW_SHA, 1]]],
  ['tests/1p-preview-contract.test.js', [[OLD_V, NEW_V, 2], [OLD_SHA, NEW_SHA, 1], [OLD_DIR, NEW_DIR, 1]]],
  ['tests/athena-follow-bidirectional-contract.test.js', [[OLD_V, NEW_V, 5]]],
  ['tests/provider-day-pull-contract.test.js', [[OLD_V, NEW_V, 1]]],
  ['tests/fast-release-gate-contract.test.js', [[OLD_V, NEW_V, 1]]]
];

const staged = [];
for (const [rel, subs] of plan) {
  let t = fs.readFileSync(rel, 'latin1');
  for (const [from, to, want] of subs) {
    const n = t.split(from).length - 1;
    if (n !== want) { console.error('MISS ' + rel + ' "' + from.slice(0, 24) + '" expected ' + want + ' got ' + n); process.exit(1); }
    t = t.split(from).join(to);
  }
  staged.push([rel, t]);
}
for (const [rel, t] of staged) fs.writeFileSync(rel, t, 'latin1');

/* the published-channel feed is REWRITTEN, not swept - the notes must
   describe this release, not carry a stale sentence with a new number. */
fs.writeFileSync('extension-version.json', JSON.stringify({
  version: '3.0.82',
  minChrome: 116,
  notes: 'v3.0.82 - One-use Athena action tokens are session-backed and survive MV3 service-worker restarts: each token binds the exact patient, encounter, and field set it was minted for, is consumed exactly once, and settles to a PHI-free terminal receipt. Everything from v3.0.81 remains. Requires Chrome 116+.'
}, null, 2) + '\n', 'latin1');

const twinsEqual = fs.readFileSync('1pScribeFlow.html', 'latin1').split(NEW_V).length ===
  fs.readFileSync('1p/index.html', 'latin1').split(NEW_V).length;
console.log('RESTAMP-3082 OK: ' + staged.length + ' files swept + feed rewritten; package ' +
  OLD_SHA.slice(0, 12) + ' -> ' + NEW_SHA.slice(0, 12) + '; shell twin sweep counts equal: ' + twinsEqual);
