'use strict';
/* pf2 chart-section folds - the disclosure the owner calls "the arrows".
 *
 * `grep -rl pf2 tests/` returns ZERO files: the five collapsible rows on the
 * patient card have never had a single assertion, which is why b748 could
 * repair them and nothing would notice if a later build undid it.
 *
 * Assertion A is a live defect at b756 and FAILS against HEAD.
 * Assertions B-E lock the b748 repair; each of them FAILS against a1c1956^
 * (the tree the owner photographed), which is what makes this file
 * non-vacuous rather than a set of tautologies over current source.
 *
 * Root override so the same file can be run against an exported older tree:
 *   PF2_ROOT=/path/to/tree node pf2-fold-contract.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = process.env.PF2_ROOT || path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

/* The live module, so no assertion can be satisfied by one of the five
   hard-dead duplicate modules in this file. */
const open = connect.indexOf('__mlsProfCalm pf2-1.0.0');
const close = connect.indexOf('__mlsRelayLink rl-1.0.0');
assert(open > 0 && close > open, 'cannot locate the live __mlsProfCalm module');
const pf2 = connect.slice(open, close);

const failures = [];
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL ' + name + ' -- ' + e.message); }
}

/* ---- A. FAILS AT HEAD -------------------------------------------------- */
/* The "is this section worth showing" verdict must not change depending on
   whether the fold is open. .pf2-b is display:none while closed, so innerText
   returns textContent then and RENDERED text once opened - a section whose
   content is itself CSS-hidden survives closed and deletes itself 1400ms
   after the owner opens it. */
check('A: section-visibility gate is open/closed symmetric (no innerText)', function () {
  const line = /var hasContent = bb[^\n]*/.exec(pf2);
  assert(line, 'the hasContent gate is gone - re-derive this test');
  assert(
    line[0].indexOf('innerText') === -1,
    'reads innerText, so a closed section is judged on textContent and an open one on rendered text: ' + line[0].trim()
  );
  assert(line[0].indexOf('textContent') !== -1, 'gate no longer reads textContent');
});

/* ---- B-E. FAIL AT a1c1956^ (pre-b748) ---------------------------------- */

check('B: the fold handler matches the header by closest, not identity', function () {
  assert(/closest\('\.pf2-h'\)/.test(pf2),
    "foldDelegate must use closest('.pf2-h') so a click on the arrow SPAN inside the header still folds");
});

check('C: one delegated document listener, not a listener per header node', function () {
  assert(/document\.addEventListener\('click', foldDelegate/.test(pf2),
    'the fold must be delegated on document so a re-rendered header is still live');
  assert(/wireFoldDelegate\(\);/.test(pf2), 'mkSec must arm the delegate');
});

check('D: the section body can be revealed even under the Calm Shell fold CSS', function () {
  assert(
    pf2.indexOf('html body #profileCard .pf2-sec.pf2-sec.open > .pf2-b.pf2-b{display:block !important;}') !== -1,
    'missing the !important reveal that outspecifies body.mls-calm ... .mls-fold:not(.mls-open) > *:not(:first-child)'
  );
  assert(
    pf2.indexOf('html body #profileCard .pf2-sec > .pf2-h::after{content:none !important;}') !== -1,
    'missing the rule that removes the SECOND chevron any layer draws on a pf2 header'
  );
});

check('E: the Calm Shell stands down on rows that are already disclosures', function () {
  assert(/qsa\('\.pf2-sec\.mls-fold', card\)/.test(shell),
    'the shell must un-stamp any pf2 row an earlier pass claimed as a fold');
  assert(/classList\.contains\('pf2-sec'\)\) return;/.test(shell),
    'the shell adopt loop must skip .pf2-sec');
});

console.log('');
if (failures.length) {
  console.error('pf2-fold-contract: ' + failures.length + ' FAILED');
  failures.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
console.log('pf2-fold-contract: all assertions passed');
