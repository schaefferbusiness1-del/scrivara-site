'use strict';

/* A VISIT DESCRIPTION MUST NOT BE SOMEONE ELSE'S MAIL.
 *
 * visits[].type is the last term of the summary fallback chain in
 * _summaryText, and then the fallback AGAIN on the following line:
 *
 *     var detail = _stripIdentityLines(_stripPageDebris(
 *                    v.aiSummary || v.findings || v.plan || v.raw || v.type));
 *     if (!detail) detail = trim(v.type) || 'Visit - no readable note text captured';
 *
 * So on a visit with no body, `type` IS the rendered description, printed under
 * "Recent visits:" and carried into op-note context. Measured on the live
 * roster 2026-08-06: 2,070 of 3,329 visits have no body at all, and 58 of those
 * carry text scraped from an inbox or worklist surface instead of an encounter
 * - 50 message threads and 10 strings carrying a THIRD PARTY'S name and date of
 * birth. Neither strip in that chain removes them: _stripIdentityLines anchors
 * "dob:" to the START of a line and these arrive mid-string after a slash, and
 * _stripPageDebris only targets Athena print scaffolding.
 *
 * THE RULE THIS FILE DEFENDS, in both directions:
 *   1. Correspondence and identity headers never render as a visit reason.
 *   2. NEVER SUPPRESS A REAL REASON. 2,012 of the 2,070 body-less visits rely
 *      on `type` for their only description. A guard that blanks those is worse
 *      than the leak it fixes - the doctor loses the visit list. Measured: a
 *      name-shaped test suppressed 32% of legitimate descriptions AND still
 *      passed correspondence quoting the patient's own name, which is why this
 *      guard keys on message/identity SHAPE, not on names.
 *
 * Text that merely mentions another person still renders. That is deliberate:
 * the renderer cannot tell a referring provider from a patient, and the fix for
 * ingesting non-encounter surfaces belongs in the collector.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'feat_visits.js'), 'utf8');

/* run the SHIPPED predicate, not a paraphrase of it */
function extract(name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error(name + ' is missing from feat_visits.js');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}
const reSrc = (src.match(/var _NOT_A_VISIT_REASON = [^\n]*;/) || [])[0];
if (!reSrc) throw new Error('_NOT_A_VISIT_REASON is missing - the guard was removed');

/* the thread separator must stay ESCAPED: a raw non-ASCII byte in a file the
   build stamper rewrites has corrupted shared files in this repo before */
if (/[^\x00-\x7F]/.test(reSrc)) {
  throw new Error('_NOT_A_VISIT_REASON contains a raw non-ASCII byte - use \\u00BB');
}

let _NOT_A_VISIT_REASON, _typeIsRenderableReason;
const S = function (x) { return (x == null ? '' : String(x)); };
const trim = function (x) { return S(x).trim(); };
eval(reSrc.replace(/^var /, ''));
eval(extract('_typeIsRenderableReason').replace('function _typeIsRenderableReason', '_typeIsRenderableReason = function'));

let failures = 0;
function blocked(text, why) {
  if (_typeIsRenderableReason(text) === false) { console.log('  pass  blocked: ' + JSON.stringify(String(text).slice(0, 58))); return; }
  failures++;
  console.error('  FAIL  RENDERED as a visit reason: ' + JSON.stringify(String(text).slice(0, 80)) + (why ? '\n        ' + why : ''));
}
function renders(text, why) {
  if (_typeIsRenderableReason(text) === true) { console.log('  pass  renders: ' + JSON.stringify(String(text).slice(0, 58))); return; }
  failures++;
  console.error('  FAIL  SUPPRESSED a real visit reason: ' + JSON.stringify(String(text).slice(0, 80)) + (why ? '\n        ' + why : ''));
}

const ARROW = String.fromCharCode(0xBB);

/* ---- 1. message threads never render (shapes seen live) ---------------- */
console.log('inbox correspondence is not a visit reason:');
blocked('Kelly Mergenthaler ' + ARROW + ' I scanned in all of the forms', 'a message thread rendered as the visit description');
blocked('Corinna Rowe Thank you Corinna Rowe ' + ARROW + ' HI Dr Schaeffer, We at');
blocked('ROBERT RUGGIERO JR referrals Matthew Schaeffer ' + ARROW + ' Hi Rob, What');
/* the case a name-based guard MISSES: correspondence quoting the patient it is
   filed under. Shape catches it; names never would. */
blocked('Corbin Muetterties Mutual Patient Corbin Muetterties ' + ARROW + ' Hi Dr',
  'correspondence that quotes the OWN patient - the exact case a name test passes');

/* ---- 2. a third party's identity never renders ------------------------- */
console.log('identity headers are not a visit reason:');
blocked('Joan Monterosso, ROSEMARY GUYER Cameron Willis / Dob: 6-23-1942',
  'mid-string DOB - _stripIdentityLines only anchors "dob:" at line start');
blocked('Referral, ROSEMARY GUYER Ann McHale / DOB 6-23-42');
blocked('Pt: Karen G Wilson, DOB: 3/14/1958');
blocked('intake form / date of birth 01/02/1960');
/* the same live document with the D dropped from the DOB label - caught only
   because the label is delimited and followed by a full date */
blocked('Joan Monterosso, ROSEMARY GUYER Cameron Willis / OB 12-7-1952',
  'a third party birth date labelled "OB" still must not render');

/* ---- 3. NEVER SUPPRESS: real reasons still render ---------------------- */
console.log('genuine visit reasons are untouched:');
renders('Transition of Care Encounter, lumbar spine evaluation', 'the single most common real description');
renders('R SI joint injection for sacroiliac dysfunction');
renders('MRI, lumbar spine, w/o contrast (submitted)');
renders('xr lumbar spine complete with flex & ext views (submitted)');
renders('Office Visit - post-operative check, right knee');
renders('L4-L5 transforaminal epidural steroid injection');
renders('New Patient Consult');
renders('Follow-up, 6 weeks post-op');
/* a date alone is not a DOB - visit reasons legitimately carry dates */
renders('Post-op visit 4/20/26', 'a bare date must not trip the DOB rule');
renders('DOS 3/9/26 aspiration', 'date of SERVICE is not date of BIRTH');
/* the delimited-label rule must not fire on ordinary punctuation before a date */
renders('MRI, lumbar spine w/o contrast 1/2/2024', 'the "w/o" slash is not a DOB label');
renders('Injection, right knee 5/6/2025');
renders('Ortho follow-up / 6-23-2026', 'a bare delimited date carries no birth label');

/* ---- 4. empty stays empty (the placeholder path) ----------------------- */
console.log('empty input is not renderable:');
blocked('', 'empty must fall through to the placeholder, not render');
blocked('   ');
blocked(null);
blocked(undefined);

/* ---- 5. structural: the guard cannot rewrite text --------------------- */
console.log('structural:');
(function () {
  /* a predicate, not a transformer: it may only ever decide, never edit. If it
     ever returns a string the call sites would silently render mutated text. */
  const samples = ['Office Visit', 'a ' + ARROW + ' b', 'Pt: X, DOB: 1/1/1970', '', null];
  let ok = true;
  for (const s of samples) {
    const r = _typeIsRenderableReason(s);
    if (typeof r !== 'boolean') { ok = false; console.error('        returned ' + typeof r + ' for ' + JSON.stringify(s)); }
  }
  if (ok) console.log('  pass  always returns a boolean - it decides, it never rewrites');
  else failures++;
})();
(function () {
  /* the two live shapes must both be covered by the SHIPPED regex, so that
     deleting either alternative fails here rather than in a chart */
  const covered = _NOT_A_VISIT_REASON.test('x ' + ARROW + ' y') && _NOT_A_VISIT_REASON.test('x / DOB: 1/2/1960');
  if (covered) console.log('  pass  shipped regex still covers both measured shapes');
  else { failures++; console.error('        FAIL an alternative was removed from _NOT_A_VISIT_REASON'); }
})();

/* ---- 6. SUPPRESSION MUST STAY VISIBLE --------------------------------- */
/* Requested by the ext-goal lane and it is the right requirement: an invisible
   suppression is the same failure family as an invisible refusal. If a visit's
   only text was correspondence, the doctor must still see that a visit HAPPENED
   on that date with no readable note - the row must never silently vanish.
   Verified live on both holder charts: 12 of 12 rows still rendered, every one
   dated, 10 of them the placeholder, and no arrow leaked into any row. */
console.log('a suppressed visit still renders as a dated row:');
(function () {
  const block = (src.match(/if \(visits\.length\) \{[\s\S]*?\n    \}/) || [])[0];
  if (!block) { failures++; console.error('        FAIL the Recent visits block was not found'); return; }

  const checks = [
    [/lines\.push\('• ' \+ \(v\.date \|\| 'Undated'\)/, 'every visit pushes a dated row unconditionally'],
    [/no readable note text captured/, 'the placeholder text survives'],
    [/_typeIsRenderableReason\(v\.type\)/, 'the guard is wired at the call site'],
  ];
  for (const [re, what] of checks) {
    if (re.test(block)) console.log('  pass  ' + what);
    else { failures++; console.error('  FAIL  ' + what + ' - not found in the shipped block'); }
  }

  /* the row push must NOT be inside a conditional on `detail` - that is what
     would make a suppressed visit disappear instead of showing as unreadable */
  const pushLine = (block.match(/[^\n]*lines\.push\('• '[^\n]*/) || [''])[0];
  if (/^\s*lines\.push/.test(pushLine)) console.log('  pass  the row push is unconditional - suppression cannot delete a visit');
  else { failures++; console.error('  FAIL  the row push is guarded by a condition: ' + pushLine.trim().slice(0, 90)); }
})();

console.log(failures === 0
  ? 'PASS visit-reason guard: correspondence and third-party identity stay out of the visit list, and every genuine reason still renders'
  : 'FAIL visit-reason-not-correspondence: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
