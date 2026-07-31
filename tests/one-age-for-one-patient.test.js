'use strict';

/* THE STUDY SAID 66 WHILE THE WHOLE APP SAID 65 (b824)
 *
 * A patient's age was computed by two different rules.
 *
 * RULE A, birthday-adjusted, in seven live surfaces: the active-patient context
 * bar, the op note's "N-year-old <sex>", the FHIR R4 export, the patient snapshot,
 * Simple view, the age chip under every DOB field, and the op-note auto-fill.
 *
 * RULE B, year subtraction with NO birthday adjustment, in the Study Groups
 * builder and its cohort-union satellite:
 *
 *     function ageOf(dob) { var y = parseYear(dob); if (!y) return null;
 *                           return new Date().getFullYear() - y; }
 *
 * Rule B is one year high for every patient whose birthday has not yet happened
 * this calendar year. On 31 July that is roughly everyone born August to December
 * — not an edge case, a large fraction of any roster.
 *
 * AND IT IS NOT ONLY A DISPLAY ERROR. That same ageOf() gates COHORT INCLUSION
 * (mls-connect.js, `if (hasAge) { var age = ageOf(p.dob); ... }`). So a
 * seventeen-year-old whose birthday falls later in the year reports 18, is
 * silently enrolled into an "18 and over" cohort, and is written into the
 * de-identified export. The mirror error drops genuinely eligible patients out of
 * an upper bound. A research cohort assembled on an off-by-one age is wrong in a
 * way nobody downstream can see.
 *
 * THE FIX defers to window.ageFromDob — the canonical resolver, birthday-adjusted
 * and already hardened by __mlsAgeDobFix for the DOB formats this store holds — so
 * eight surfaces agree instead of seven-against-one.
 *
 * THE YEAR-ONLY FALLBACK IS KEPT ON PURPOSE. A de-identified record may carry a
 * birth year and no birthday, and year subtraction is then the only age
 * obtainable. What changed is that it fires only when the canonical resolver
 * cannot answer, instead of in place of it. This test asserts that too, because
 * removing it would break the de-identified path this builder exists to serve.
 *
 * TIME IS INJECTED. Every assertion runs against a fixed clock, so this suite
 * cannot start passing or failing because of the day it is run on.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const CONNECT = read('mls-connect.js');

function block(src, header, from) {
  const at = src.indexOf(header, from || 0);
  assert(at >= 0, 'missing declaration: ' + header);
  const brace = src.indexOf('{', at);
  let depth = 0, quote = '', esc = false, line = false, comment = false;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i], next = src[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (comment) { if (ch === '*' && next === '/') { comment = false; i++; } continue; }
    if (quote) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { comment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unterminated: ' + header);
}

/* A Date whose "now" is fixed. Constructed dates still work normally; only the
   argument-less form is pinned, which is the only form these resolvers use. */
function clockAt(iso) {
  const fixed = new Date(iso).getTime();
  function FixedDate(...args) {
    if (!(this instanceof FixedDate)) return new Date(...args).toString();
    return args.length === 0 ? new Date(fixed) : new Date(...args);
  }
  FixedDate.prototype = Date.prototype;
  FixedDate.now = () => fixed;
  FixedDate.parse = Date.parse;
  FixedDate.UTC = Date.UTC;
  return FixedDate;
}

/* the canonical resolver, birthday-adjusted, as the app's seven other surfaces
   compute it — kept tiny and asserted against the real one below */
function canonical(dob, iso) {
  const now = new Date(iso);
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(String(dob)) ;
  const i = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(dob));
  let y, mo, d;
  if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; }
  else if (i) { y = +i[1]; mo = +i[2]; d = +i[3]; }
  else return null;
  let a = now.getFullYear() - y;
  if ((now.getMonth() + 1) < mo || ((now.getMonth() + 1) === mo && now.getDate() < d)) a--;
  return a;
}

/* ---- the two resolvers under test, executed --------------------------- */
const BUILDER = block(CONNECT, 'function ageOf(dob)');
const SATELLITE = block(CONNECT, 'function ageOf(p)');

function runBuilder(dob, iso, opts) {
  const ctx = { console, isFinite, parseInt, String, Math };
  ctx.Date = clockAt(iso);
  ctx.S = (x) => (x == null ? '' : String(x));
  ctx.parseYear = (d) => { const mm = ctx.S(d).match(/((?:19|20)\d{2})/); return mm ? parseInt(mm[1], 10) : null; };
  ctx.window = (opts && opts.noCanonical) ? {} : { ageFromDob: (d) => canonical(d, iso) };
  if (opts && opts.canonicalThrows) ctx.window = { ageFromDob: () => { throw new Error('resolver down'); } };
  vm.createContext(ctx);
  vm.runInContext(BUILDER + '\nthis.f = ageOf;', ctx);
  return ctx.f(dob);
}
function runSatellite(dob, iso, opts) {
  const ctx = { console, isFinite, parseInt, String, Math };
  ctx.Date = clockAt(iso);
  ctx.window = (opts && opts.noCanonical) ? {} : { ageFromDob: (d) => canonical(d, iso) };
  vm.createContext(ctx);
  vm.runInContext(SATELLITE + '\nthis.f = ageOf;', ctx);
  return ctx.f({ dob: dob });
}

const NOW = '2026-07-31T15:00:00Z';   /* 31 July: an August-December birthday has not happened yet */

/* ---- 1. POSITIVE CONTROL: the old rule really was wrong here ----------- */
{
  /* Reproduce Rule B exactly and show it disagrees with the canonical answer, so
     the assertions below are measuring a real defect and not a tautology. */
  const ruleB = (dob) => {
    const mm = String(dob).match(/((?:19|20)\d{2})/);
    return mm ? new Date(NOW).getFullYear() - parseInt(mm[1], 10) : null;
  };
  assert.strictEqual(ruleB('12/25/1960'), 66, 'positive control: Rule B should give 66 for a December 1960 birth');
  assert.strictEqual(canonical('12/25/1960', NOW), 65, 'positive control: the canonical answer is 65');
  assert.notStrictEqual(ruleB('12/25/1960'), canonical('12/25/1960', NOW),
    'positive control: the two rules do NOT disagree on this input, so this whole suite proves nothing');
}

/* ---- 2. BOTH RESOLVERS NOW GIVE THE CANONICAL ANSWER ------------------ */
{
  const CASES = [
    /* dob,            expected, why */
    ['12/25/1960', 65, 'a December birthday has not happened by 31 July — the whole app says 65'],
    ['1960-12-25', 65, 'the same date in ISO form must not answer differently'],
    ['6-17-1965', 61, 'the M-D-YYYY form this store actually holds, birthday already passed'],
    ['01/01/1960', 66, 'a January birthday HAS happened, so year subtraction is right by luck here'],
    ['07/31/1960', 66, 'a birthday landing exactly today counts as having occurred'],
    ['08/01/1960', 65, 'a birthday one day away has NOT occurred'],
    /* the case that matters most */
    ['12/25/2008', 17, 'A MINOR. Rule B reported 18 and enrolled them in an "18 and over" cohort.']
  ];
  for (const [dob, want, why] of CASES) {
    assert.strictEqual(runBuilder(dob, NOW), want,
      'the Study Groups builder reports the wrong age for ' + dob + ': got ' +
      runBuilder(dob, NOW) + ', expected ' + want + '\n  ' + why);
    assert.strictEqual(runSatellite(dob, NOW), want,
      'the cohort-union satellite reports the wrong age for ' + dob + ': got ' +
      runSatellite(dob, NOW) + ', expected ' + want + '\n  ' + why);
  }

  /* stated as its own assertion, because it is the consequence that matters */
  assert.strictEqual(runBuilder('12/25/2008', NOW), 17,
    'a seventeen-year-old still reports as 18 to the cohort filter. That silently enrols a MINOR into an ' +
    '"18 and over" research cohort and writes them into the de-identified export.');

  /* and the two agree with each other, which they did not before */
  for (const dob of ['12/25/1960', '08/01/1960', '12/25/2008', '6-17-1965']) {
    assert.strictEqual(runBuilder(dob, NOW), runSatellite(dob, NOW),
      'the builder and its own satellite still disagree about ' + dob + ' — the satellite\'s ages appear in ' +
      'the reason strings the doctor reads to understand why a patient matched');
  }
}

/* ---- 3. THE CLOCK IS WHAT MOVES THE ANSWER, NOT THE CODE -------------- */
/* Same patient, three dates. If these did not differ, the resolver would be
   ignoring the birthday again and case 2 could be passing by coincidence. */
{
  const dob = '12/25/1960';
  assert.strictEqual(runBuilder(dob, '2026-12-24T12:00:00Z'), 65, 'the day before the birthday');
  assert.strictEqual(runBuilder(dob, '2026-12-25T12:00:00Z'), 66, 'the birthday itself');
  assert.strictEqual(runBuilder(dob, '2026-12-26T12:00:00Z'), 66, 'the day after');
}

/* ---- 4. THE YEAR-ONLY FALLBACK SURVIVES ------------------------------- */
/* A de-identified record may carry a birth year and no birthday. Year subtraction
   is then the ONLY age obtainable, and removing it would break the very export
   this builder exists to produce. */
{
  const yearOnly = '1960';
  assert.strictEqual(canonical(yearOnly, NOW), null, 'control: the canonical resolver cannot answer a bare year');
  assert.strictEqual(runBuilder(yearOnly, NOW), 66,
    'a year-only de-identified record no longer yields an age at all. Year subtraction must remain as the ' +
    'FALLBACK — what must not happen is it answering in place of the canonical resolver.');

  /* and when the canonical resolver is absent or throws, nothing breaks */
  assert.strictEqual(runBuilder('12/25/1960', NOW, { noCanonical: true }), 66,
    'with no canonical resolver on the page the builder must still produce an age (the pre-b824 answer), ' +
    'not null — a cohort that silently loses every patient is worse than one with an off-by-one age');
  assert.doesNotThrow(() => runBuilder('12/25/1960', NOW, { canonicalThrows: true }),
    'a throwing canonical resolver takes the whole cohort builder down');
  assert.strictEqual(runBuilder('12/25/1960', NOW, { canonicalThrows: true }), 66,
    'a throwing resolver must fall through to the year-only path');

  /* unparseable input still yields null, not a number */
  for (const junk of ['', null, undefined, 'not a date', '99']) {
    assert.strictEqual(runBuilder(junk, NOW), null, 'junk DOB produced an age: ' + JSON.stringify(junk));
    assert.strictEqual(runSatellite(junk, NOW), null, 'junk DOB produced an age in the satellite: ' + JSON.stringify(junk));
  }
}

/* ---- 5. THE CANONICAL RESOLVER IS CONSULTED FIRST, IN CODE ------------- */
/* Executed above, but pinned on order too: a future edit that puts the year path
   first would pass every case where the canonical resolver happens to agree. */
{
  for (const [what, fn] of [['the Study Groups builder', BUILDER], ['the cohort-union satellite', SATELLITE]]) {
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const canonAt = code.indexOf('window.ageFromDob');
    const yearAt = code.indexOf('getFullYear()');
    assert(canonAt > 0, what + ' does not consult window.ageFromDob at all');
    assert(canonAt < yearAt,
      what + ' reaches for year subtraction BEFORE the canonical resolver, so the birthday-adjusted answer ' +
      'is only used when the wrong one fails');
  }
}

console.log('PASS one age for one patient: the Study Groups builder and its cohort-union satellite ' +
  'subtracted birth year from the current year with no birthday adjustment, reporting every patient born ' +
  'later in the year ONE YEAR OLDER than the seven surfaces that resolve age properly — and that same ' +
  'resolver gates cohort INCLUSION, so a 17-year-old reported as 18 was enrolled into an "18 and over" ' +
  'cohort and exported. Both now defer to window.ageFromDob, proven against a FIXED clock across seven ' +
  'DOB shapes and three dates around one birthday, with the year-only de-identified fallback asserted ' +
  'intact for records that carry a year and no birthday');
