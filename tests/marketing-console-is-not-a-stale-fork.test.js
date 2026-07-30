'use strict';

/* THE MARKETING CONSOLE IS A FORK, AND ITS IDENTITY RESOLVER HAD DRIFTED (b810)
 *
 * mls-marketing-console.html is byte-identical to mls-marketing.html except for
 * one function. b385 taught mls-marketing.html's who() to fall back to the
 * account-namespaced Settings keys the doctor had already saved, so the console
 * works without filling the review-finder form first. The fork kept the
 * PRE-b385 one-liner:
 *
 *     function who(){ var rf=jget('mlsRF'); var d=(rf&&rf.doc)||{};
 *       return {doctor:d.name||'', practice:d.practice||'', ...}; }
 *
 * so on any device where that form had not been filled, doctor / practice / city
 * came back EMPTY - and that empty value flowed straight into the GBP listing
 * summary the console generates. The setting existed; this copy of the resolver
 * had never been told about it.
 *
 * A fork that silently diverges on one function is worse than two separate
 * implementations, because a reader who checks the other file concludes the
 * behaviour is correct. So this suite pins the property that actually matters -
 * the two resolvers behave IDENTICALLY - by executing both, rather than pinning
 * either one's text.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const marketing = fs.readFileSync(path.join(root, 'mls-marketing.html'), 'utf8');
const consoleHtml = fs.readFileSync(path.join(root, 'mls-marketing-console.html'), 'utf8');

/* Each runWho() builds its own vm realm, so two structurally identical results
   are NOT deepStrictEqual - their prototypes differ. That mismatch reads as a
   content difference, which is a probe blaming the wrong thing. Re-home both
   through JSON before any comparison. */
function plain(v) { return JSON.parse(JSON.stringify(v)); }

function whoBlock(src, label) {
  const at = src.indexOf('  function who(){');
  assert(at >= 0, `${label}: who() not found`);
  const end = src.indexOf('  function api(path, opts, cb){', at);
  assert(end > at, `${label}: who() could not be bounded`);
  return src.slice(at, end);
}

function runWho(block, label, seed) {
  const store = new Map(Object.entries(seed || {}));
  const ctx = {
    String, Object, JSON, console,
    localStorage: {
      get length() { return store.size; },
      key: i => Array.from(store.keys())[i],
      getItem: k => (store.has(k) ? store.get(k) : null)
    },
    jget: k => { try { return JSON.parse(store.get(k) || 'null'); } catch (e) { return null; } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.who = who;', ctx);
  try { return plain(ctx.who()); } catch (e) { throw new Error(`${label}: who() threw — ${e.message}`); }
}

const A = whoBlock(marketing, 'mls-marketing.html');
const B = whoBlock(consoleHtml, 'mls-marketing-console.html');

/* The four states that matter: nothing saved, Settings only, the review-finder
   form only, and both (the form must win — it is the more specific statement). */
const SETTINGS = {
  'sf_u::doc@example.test::providerName': 'Jane A. Smith',
  'sf_u::doc@example.test::practiceName': 'Chester County Spine Care',
  'sf_u::doc@example.test::clinicAddress': '1 Clinic Way, Malvern, PA 19355'
};
const FORM = { mlsRF: JSON.stringify({ doc: { name: 'Form Doctor', practice: 'Form Practice', city: 'Form City', site: 'https://form.example' } }) };

const CASES = [
  ['nothing saved', {}],
  ['Settings only', SETTINGS],
  ['review-finder form only', FORM],
  ['both', Object.assign({}, SETTINGS, FORM)],
  /* two signed-in accounts on one device: both resolvers must refuse to guess */
  ['two accounts', Object.assign({}, SETTINGS, {
    'sf_u::other@example.test::practiceName': 'Someone Else Practice'
  })]
];

/* ---- POSITIVE CONTROL --------------------------------------------------
   The harness must be able to SEE the divergence it exists to detect. Run the
   known-bad pre-b385 resolver against the Settings-only case and require that it
   differs from the good one — otherwise "the two agree" below could mean "the
   harness cannot tell them apart". */
{
  const PRE_B385 = "  function who(){ var rf=jget('mlsRF'); var d=(rf&&rf.doc)||{}; " +
    "return {doctor:d.name||'',practice:d.practice||'',city:d.city||'',site:d.site||''}; }\n" +
    '  function api(path, opts, cb){';
  const bad = runWho(whoBlock(PRE_B385, 'control'), 'control', SETTINGS);
  const good = runWho(A, 'mls-marketing.html', SETTINGS);
  assert.strictEqual(bad.practice, '',
    'positive control: the pre-b385 resolver must come back empty on Settings-only — that IS the defect');
  assert.strictEqual(good.practice, 'Chester County Spine Care',
    'positive control: the b385 resolver must read Settings, or there is nothing to compare against');
  assert.notDeepStrictEqual(bad, good,
    'positive control: the harness cannot distinguish the stale resolver from the current one, so ' +
    'every agreement assertion below would be vacuous');
}

/* ---- THE TWO FORKS MUST AGREE, IN EVERY STATE ------------------------- */
for (const [label, seed] of CASES) {
  const a = runWho(A, 'mls-marketing.html', seed);
  const b = runWho(B, 'mls-marketing-console.html', seed);
  assert.deepStrictEqual(b, a,
    `mls-marketing-console.html resolves the practice identity differently from mls-marketing.html ` +
    `in the "${label}" case. The console is a fork of that page; a one-function divergence is worse ` +
    `than two implementations, because checking the other file wrongly confirms the behaviour. ` +
    `console=${JSON.stringify(b)} marketing=${JSON.stringify(a)}`);
}

/* and the behaviour those cases are pinning, stated outright */
{
  const settingsOnly = runWho(B, 'console', SETTINGS);
  assert.strictEqual(settingsOnly.practice, 'Chester County Spine Care',
    'the console still cannot read the practice name the doctor saved in Settings, so its GBP ' +
    'listing summary is generated against an empty practice');
  assert.strictEqual(settingsOnly.doctor, 'Jane A. Smith', 'the console cannot read the provider name');
  assert.strictEqual(settingsOnly.city, 'Malvern, PA 19355',
    'the city must come from the last two comma segments of the saved clinic address');

  const both = runWho(B, 'console', Object.assign({}, SETTINGS, FORM));
  assert.strictEqual(both.practice, 'Form Practice',
    'an explicit review-finder entry must still win over the Settings fallback');

  const twoAccounts = runWho(B, 'console', CASES[4][1]);
  assert.strictEqual(twoAccounts.practice, '',
    'with two signed-in accounts on one device the resolver must refuse to guess which one is ' +
    'meant, rather than picking whichever key it enumerated first');
}

console.log('PASS the marketing console is not a stale fork: its who() now behaves identically to ' +
  "mls-marketing.html's across five storage states (proved by executing both, with the pre-b385 " +
  'resolver as the positive control), so the console reads the practice identity the doctor already ' +
  'saved instead of generating a GBP listing summary against an empty practice — and it still ' +
  'refuses to guess when two accounts share a device');
