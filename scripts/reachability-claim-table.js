'use strict';
/* REACHABILITY CLAIMS: what each suite claims, and how it proves it.
 *
 * Narrowed from the earlier sweep. The earlier one asked "does this suite make any
 * behavioural claim", which caught 343 suites and was too broad to act on. This asks the
 * exact question that failed:
 *
 *   Does this suite assert that a CONTROL IS REACHABLE - offered, available, in the menu,
 *   not stranded, keeps its route - and if so, does it EXERCISE the shipped resolver or
 *   merely match text in the source?
 *
 * The confirmed case: tests/shell-hidden-controls-keep-reach.test.js exempts a hidden
 * wrapper because "#mlsDsVisitBodies is offered as 'Full visit notes'", and proves
 * "offered" by regex-extracting id literals from the shell SOURCE into a set. The literal
 * was always present; the row never rendered. The suite certified the defect.
 *
 * POSITIVE CONTROL: that suite MUST appear as source-text below. If it does not, this
 * script is blind and its output must be discarded - the previous version of this sweep
 * failed exactly that way and reported 86 suites from a dead instrument.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] ||
  'C:\\Users\\Micha\\Desktop\\MLS_EVERYTHING\\dispatch-work\\claude-qa-txm-20260725';
const TESTS = path.join(ROOT, 'tests');

/* the specific claim class that failed - reachability of a control, not behaviour generally */
const REACH_CLAIM = /(keeps?[- ]reach|keep[- ]every[- ]route|is[- ]offered|offered as|reachable|not stranded|stranded|in the (?:tools|dock|menu)|discoverab|single owner|every control|control coverage)/i;

/* the suite RUNS shipped code */
const EXECUTES = [
  /require\(['"]vm['"]\)/, /vm\.run/, /new Function\s*\(/, /jsdom|JSDOM/,
];
/* the suite reads a shipped artefact */
const READS_SHIPPED = /readFileSync\([^)]*(?:ScribeFlow|mls-connect|feat_[a-z0-9_]+|background|content|sw)\.(?:js|html)/;

const files = fs.readdirSync(TESTS).filter(f => f.endsWith('.test.js')).sort();
const rows = [];

files.forEach(function (f) {
  const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
  const head = src.slice(0, 2500);
  if (!(REACH_CLAIM.test(f) || REACH_CLAIM.test(head))) return;

  const reads = READS_SHIPPED.test(src);
  const exec = EXECUTES.some(re => re.test(src));

  /* what does it claim? first sentence of the header comment, or the console.log */
  let claim = '';
  const c = src.match(/console\.log\(\s*['"`]([^'"`]{20,150})/);
  if (c) claim = c[1];
  else {
    const h = head.match(/\/\*+\s*([A-Z][^\n]{20,120})/);
    claim = h ? h[1] : '(no stated claim)';
  }
  claim = claim.replace(/\s+/g, ' ').trim().slice(0, 78);

  const verdict = !reads ? 'fixture-only'
    : exec ? 'BEHAVIOURAL (executes shipped code)'
    : 'SOURCE-TEXT (matches shipped source)';

  rows.push({ f, claim, verdict, reads, exec });
});

const srcText = rows.filter(r => r.verdict.indexOf('SOURCE-TEXT') === 0);
const behav = rows.filter(r => r.verdict.indexOf('BEHAVIOURAL') === 0);
const fixt = rows.filter(r => r.verdict === 'fixture-only');

console.log('REACHABILITY-CLAIM SUITES: ' + rows.length + ' of ' + files.length + '\n');
console.log('  BEHAVIOURAL - executes the shipped resolver : ' + behav.length);
console.log('  SOURCE-TEXT - matches the shipped source    : ' + srcText.length + '   <-- can certify a defect');
console.log('  fixture-only - reads no shipped artefact    : ' + fixt.length + '\n');

console.log('CONTROL: shell-hidden-controls-keep-reach must be SOURCE-TEXT -> ' +
  (srcText.some(r => /shell-hidden-controls-keep-reach/.test(r.f))
    ? 'YES, sweep is sighted'
    : 'NO - BLIND, DISCARD EVERYTHING BELOW') + '\n');

console.log('=== SOURCE-TEXT (proof cannot fail if the literal is present) ===\n');
srcText.forEach(function (r) {
  console.log('  ' + r.f);
  console.log('      claims: ' + r.claim);
});

console.log('\n=== BEHAVIOURAL (exercises the shipped resolver) ===\n');
behav.forEach(function (r) { console.log('  ' + r.f); });

if (fixt.length) {
  console.log('\n=== FIXTURE-ONLY ===\n');
  fixt.forEach(function (r) { console.log('  ' + r.f); });
}
