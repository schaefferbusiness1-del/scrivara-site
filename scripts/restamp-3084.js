/* restamp-3084 - release pins catch up with the 3.0.84 extension the owner
 * loaded and store-uploaded on 2026-08-27 (self-heal recovery rail, ka84
 * keep-alive, hardened one-use authorizations). Modeled on restamp-3082.
 * Sweeps version/sha pins, moves the checker loader token (the checker feed
 * constant changes so its hand-maintained token must move with it), rewrites
 * the published feed notes, and syncs the baked Whats-new parity. Counts are
 * MEASURED and printed; a zero-count on any mandatory sub aborts before any
 * write (all-or-nothing). */
'use strict';
const fs = require('fs');
const crypto = require('crypto');

const OLD_V = '3.0.82', NEW_V = '3.0.84';
const OLD_SHA = '2901c60b6aa172cca4a43e0dfb80c961c7dd1b5f9194604237539d8fbdea4a4c';
const NEW_SHA = crypto.createHash('sha256').update(fs.readFileSync('MLS_Assist_v3.0.84.zip')).digest('hex');
const OLD_TOK = '20260827chk3082', NEW_TOK = '20260827chk3084';
const NEW_NOTES = 'v3.0.84 - Athena reliability: when a read, search, or day-jump fails because the athenaOne page is stuck, MLS Assist now recovers its own tab to the practice dashboard and retries instead of giving up; a gentle background request keeps the signed-in session fresh (no simulated input, signed-out sessions are never touched); and one-use write authorizations survive browser service-worker restarts with exact patient and encounter binding. Everything from v3.0.82 remains. Requires Chrome 116+.';

const sweeps = [
  ['_config.yml', [[OLD_V, NEW_V], [OLD_SHA, NEW_SHA]]],
  ['get-extension.html', [[OLD_V, NEW_V], [OLD_SHA, NEW_SHA]]],
  ['1pScribeFlow.html', [[OLD_V, NEW_V]]],
  ['1p/index.html', [[OLD_V, NEW_V]]],
  ['ScribeFlow-staging.html', [[OLD_V, NEW_V]]],
  ['feat_mls_checker.js', [[OLD_V, NEW_V]]],
  ['pages-publication-inventory.json', [[OLD_V, NEW_V]]],
  ['1p-mls-connect.js', [[OLD_TOK, NEW_TOK]]],
  ['mls-connect.staging.js', [[OLD_TOK, NEW_TOK]]],
  ['tests/extension-reload-helper-contract.test.js', [[OLD_TOK, NEW_TOK]]],
  ['tests/immutable-satellite-loader-cache-contract.test.js', [[OLD_TOK, NEW_TOK], ["'" + OLD_TOK + "', '20260825chk3081'", "'" + NEW_TOK + "', '" + OLD_TOK + "'"]]],
  ['tests/extension-package.test.js', [[OLD_V, NEW_V], [OLD_SHA, NEW_SHA]]],
  ['tests/public-publication-boundary.test.js', [[OLD_V, NEW_V], [OLD_SHA, NEW_SHA]]],
  ['tests/public-release-truth-boundary.test.js', [[OLD_V, NEW_V], [OLD_SHA, NEW_SHA]]],
  ['tests/1p-preview-contract.test.js', [[OLD_V, NEW_V], [OLD_SHA, NEW_SHA]]],
  ['tests/athena-follow-bidirectional-contract.test.js', [[OLD_V, NEW_V]]],
  ['tests/provider-day-pull-contract.test.js', [[OLD_V, NEW_V]]],
  ['tests/fast-release-gate-contract.test.js', [[OLD_V, NEW_V]]]
];

/* the satellite tuple sub must run BEFORE the generic token sub or the
   generic one eats the tuple's first slot - order them per file above:
   generic first is FINE for every file except the satellite suite, where the
   tuple must be handled with the PREVIOUS token becoming OLD_TOK. Handle by
   running the TUPLE sub first there. */
const staged = [];
for (const [rel, subs] of sweeps) {
  let t = fs.readFileSync(rel, 'latin1');
  const ordered = rel.indexOf('immutable-satellite') >= 0 ? subs.slice().reverse() : subs;
  const counts = [];
  for (const [a, b] of ordered) {
    const n = t.split(a).length - 1;
    counts.push(a.slice(0, 18) + ' x' + n);
    if (n === 0 && !(rel === 'ScribeFlow-staging.html')) { console.error('MISS ' + rel + ' "' + a.slice(0, 30) + '"'); process.exit(1); }
    t = t.split(a).join(b);
  }
  console.log(rel + ' :: ' + counts.join(', '));
  staged.push([rel, t]);
}

/* the Whats-new baked body must EQUAL the feed notes (parity contract) */
const OLD_NOTES = JSON.parse(fs.readFileSync('extension-version.json', 'latin1')).notes;
for (const shell of ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow-staging.html']) {
  const at = staged.findIndex(([r]) => r === shell);
  let t = staged[at][1];
  const swept = OLD_NOTES.split(OLD_V).join(NEW_V);
  const n = t.split(swept).length - 1;
  if (n !== 1) { console.error('NOTES MISS ' + shell + ' x' + n); process.exit(1); }
  staged[at][1] = t.split(swept).join(NEW_NOTES);
}

for (const [rel, t] of staged) fs.writeFileSync(rel, t, 'latin1');
fs.writeFileSync('extension-version.json', JSON.stringify({ version: NEW_V, minChrome: 116, notes: NEW_NOTES }, null, 2) + '\n', 'latin1');
console.log('RESTAMP-3084 OK: package ' + OLD_SHA.slice(0, 12) + ' -> ' + NEW_SHA.slice(0, 12) + '; checker token -> ' + NEW_TOK + '; feed + baked notes rewritten');
