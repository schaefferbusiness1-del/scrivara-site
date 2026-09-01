/* splice-3099-part3.js - ext 3.0.99 ckmeta-1.0.0: a checked-in encounter
 * header (second labeled date: arrival/check-in) no longer refuses the surface
 * forever at meta-missing. het-1.2.0 shape: with >1 dates, bind IFF exactly one
 * equals the caller's EXPECTED visit date; the downstream visit-date gate
 * re-checks the same equality, so nothing wrong can survive. Provider count
 * stays strictly single. 3 splices, exact counts.
 */
'use strict';
var fs = require('fs');
var edits = [
  { find: "    function encounterMetadataFor(frame, actionRoot, identityRoot) {",
    repl: "    function encounterMetadataFor(frame, actionRoot, identityRoot, expectedVisitKey) {", n: 1 },
  { find: "            var dates = discoverLabeled(root, 'date'), providers = discoverLabeled(root, 'provider');\n            if (dates.length === 1 && providers.length === 1) return { root: root, visitDate: dateKey(dates[0]), provider: text(providers[0]) };",
    repl: "            var dates = discoverLabeled(root, 'date'), providers = discoverLabeled(root, 'provider');\n            if (dates.length === 1 && providers.length === 1) return { root: root, visitDate: dateKey(dates[0]), provider: text(providers[0]) };\n            /* ckmeta-1.0.0 (3.0.99): a CHECKED-IN header paints a second labeled date (arrival), so the strictly-single count refused the surface forever (meta-missing -> probe-frame-missing -> ladder re-clicks a row that is already open; measured 2026-08-31). het-1.2.0 shape: with more than one date, bind IFF exactly one equals the caller's EXPECTED visit date - the downstream visit-date gate re-checks the same equality, so a wrong date can never survive. Provider stays strictly single. */\n            if (expectedVisitKey && dates.length > 1 && providers.length === 1) { var ckHits = []; for (var ckI = 0; ckI < dates.length; ckI++) { if (dateKey(dates[ckI]) === expectedVisitKey) ckHits.push(dates[ckI]); } if (ckHits.length === 1) return { root: root, visitDate: dateKey(ckHits[0]), provider: text(providers[0]), checkedInDateAccepted: true }; }", n: 1 },
  { find: "encounterMetadataFor(fr, targetRoot, observedIdentity.root);",
    repl: "encounterMetadataFor(fr, targetRoot, observedIdentity.root, dateKey(expectedContext.visitDate));", n: 1 }
];
var s = fs.readFileSync('background.js', 'latin1');
for (var i = 0; i < edits.length; i++) {
  var e = edits[i], n = s.split(e.find).length - 1;
  if (n !== e.n) { console.error('ABORT edit ' + i + ': hits=' + n); process.exit(1); }
  s = s.split(e.find).join(e.repl);
}
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK ckmeta-1.0.0 spliced (3 edits)');
