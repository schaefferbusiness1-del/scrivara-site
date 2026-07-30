'use strict';

/* EVERY EXPORT CARRIES THE PRACTICE'S IDENTITY, NOT THE VENDOR'S (b808)
 *
 * `window.MLS_OPNOTE_LETTERHEAD` was initialised to
 * `{clinicName:'', addressLines:[]}` above a comment saying "set this once",
 * and in the entire repo the only assignment outside that line was a synthetic
 * test fixture. Five PDF letterheads read it, and every one is written as:
 *
 *     if (lh.clinicName) { ...the practice... } else { ...hardcoded vendor... }
 *
 * so the else branch was the ONLY branch that ever ran. A doctor who typed
 * "Chester County Spine Care" into Settings got "MLS" and
 * "Physical Medicine, Rehabilitation & Pain" printed on every exported op note,
 * procedure report, full-history PDF and after-visit summary, forever, with
 * nothing on screen to explain why. Both files are individually correct — the
 * renderer reads the right property and the getters return the right values.
 * Nothing connected them. That is the same shape as the b795 runtime-skin
 * defect and as provProfile's hardcoded facility.
 *
 * Alongside it, four surfaces used the LOGIN/ACCOUNT display name as the
 * clinical provider identity — the class
 * tests/provider-identity-separation-contract exists to forbid, on surfaces it
 * does not reach. Two of them read `docname` BEFORE `providerName`, so a
 * configured clinical identity was actively outranked by the signup form.
 *
 * The letterhead is proved by EXECUTION: the real accessor block runs against
 * stub Settings getters and the resolved values are read back.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const PRO = fs.readFileSync(path.join(root, 'mls-opnote-pro.js'), 'utf8');
const APP = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const REPORT = fs.readFileSync(path.join(root, 'mls-procedure-report.js'), 'utf8');
const RVU = fs.readFileSync(path.join(root, 'mls-rvu.js'), 'utf8');

/* An array literal built inside the vm realm is NOT deepStrictEqual to one built
   out here - the prototypes differ - and that mismatch reads as a content
   difference, which is a probe reporting the wrong reason. Re-home it first. */
function lines(v) { return Array.from(v || []); }

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/* ---- 1. THE LETTERHEAD RESOLVES FROM SETTINGS, BY EXECUTION ------------ */
{
  /* the real block, bounded by its own landmarks */
  const from = PRO.indexOf('function lhSetting(');
  /* through the CLOSING brace of the `if (!window.MLS_OPNOTE_LETTERHEAD)` guard,
     not merely through the assignment — stopping at the assignment yields an
     unterminated block, which vm reports as a syntax error rather than as a
     wrong verdict, but only by luck. */
  const assign = PRO.indexOf('window.MLS_OPNOTE_LETTERHEAD = letterhead;', from);
  const to = PRO.indexOf('\n  }', assign);
  assert(from > 0 && assign > from && to > assign, 'the letterhead accessor block could not be bounded');
  const block = PRO.slice(from, to + '\n  }'.length);
  assert(/if \(!window\.MLS_OPNOTE_LETTERHEAD\)/.test(block) && /defineProperty/.test(block),
    'the extracted block is not the letterhead installer');

  function resolve(settings) {
    const ctx = { String, Object, Array, console };
    ctx.window = ctx;
    for (const k of Object.keys(settings)) ctx[k] = (v => () => v)(settings[k]);
    vm.createContext(ctx);
    vm.runInContext('function safe(fn, d){ try { return fn(); } catch (e) { return d; } }\n' + block, ctx);
    return ctx.window.MLS_OPNOTE_LETTERHEAD;
  }

  /* POSITIVE CONTROL — the harness must be able to observe the pre-fix state.
     If a letterhead built with NO getters present still reported a clinic name,
     the assertions below could not distinguish "resolved from Settings" from
     "the harness returns strings". */
  const bare = resolve({});
  assert.strictEqual(bare.clinicName, '',
    'positive control: with no Settings getters at all the letterhead must be empty — this is the ' +
    'exact pre-fix state, and it is what makes the next assertion meaningful');
  assert.deepStrictEqual(lines(bare.addressLines), [], 'positive control: no getters must mean no address lines');

  const lh = resolve({
    getPracticeName: 'Chester County Spine Care',
    getClinicAddress: '1 Clinic Way, Malvern PA 19355',
    getClinicPhone: '(555) 123-4567'
  });
  assert.strictEqual(lh.clinicName, 'Chester County Spine Care',
    'the letterhead did not resolve the practice name from Settings — the hardcoded vendor branch ' +
    'would still be the only one that ever runs');
  assert.deepStrictEqual(lines(lh.addressLines), ['1 Clinic Way, Malvern PA 19355', 'Tel (555) 123-4567'],
    'the letterhead did not build its address lines from the clinic address and phone');

  /* LIVE, not a snapshot: Settings can change between page load and export. */
  let practice = 'First Name';
  const liveCtx = { String, Object, Array, console };
  liveCtx.window = liveCtx;
  liveCtx.getPracticeName = () => practice;
  vm.createContext(liveCtx);
  vm.runInContext('function safe(fn, d){ try { return fn(); } catch (e) { return d; } }\n' + block, liveCtx);
  assert.strictEqual(liveCtx.window.MLS_OPNOTE_LETTERHEAD.clinicName, 'First Name', 'first read failed');
  practice = 'Renamed Practice';
  assert.strictEqual(liveCtx.window.MLS_OPNOTE_LETTERHEAD.clinicName, 'Renamed Practice',
    'the letterhead snapshotted the practice name at load, so a Settings edit does not reach an ' +
    'export made in the same session');

  /* the documented "set it yourself" contract still works, per field */
  const host = resolve({ getPracticeName: 'Chester County Spine Care', getClinicPhone: '(555) 123-4567' });
  host.clinicName = 'White Label Health';
  assert.strictEqual(host.clinicName, 'White Label Health',
    'an explicit assignment no longer overrides Settings — the documented host/fixture contract broke');
  assert.deepStrictEqual(lines(host.addressLines), ['Tel (555) 123-4567'],
    'overriding clinicName must not disturb addressLines — the override is per field');
  host.addressLines = [];
  assert.deepStrictEqual(lines(host.addressLines), [], 'an explicit empty address override must be honoured');

  /* an assignment of the WHOLE object must still win, because the module only
     installs its own when the global is absent (the synthetic fixture at
     tests/live-local-adjunct-library-boundary.js:378 relies on this) */
  assert(/if \(!window\.MLS_OPNOTE_LETTERHEAD\) \{/.test(PRO),
    'the module must still yield to a letterhead a host assigned before it loaded');
}

/* ---- 2. THE VENDOR FALLBACK IS NOW REACHABLE-BUT-UNUSED, NOT THE ONLY PATH */
/* The hardcoded branches stay: they are correct for a doctor who has not filled
 * in a practice name yet. What must not survive is a state where the practice
 * branch cannot be reached. Asserted by the presence of the `if (lh.clinicName)`
 * shape in each consumer plus §1 proving lh.clinicName can be non-empty. */
{
  const consumers = [
    ['mls-opnote-pro.js', PRO],
    ['mls-procedure-report.js', REPORT],
    ['feat_fullhistory_pdf.js', fs.readFileSync(path.join(root, 'feat_fullhistory_pdf.js'), 'utf8')],
    ['feat_after_visit_summary.js', fs.readFileSync(path.join(root, 'feat_after_visit_summary.js'), 'utf8')]
  ];
  for (const [name, src] of consumers) {
    assert(/MLS_OPNOTE_LETTERHEAD/.test(src), `${name} no longer reads the shared letterhead`);
    assert(/lh\.clinicName/.test(src), `${name} no longer branches on the practice name`);
  }
}

/* ---- 3. A LOGIN NAME IS NOT A CLINICAL PROVIDER IDENTITY -------------- */
{
  /* one decision, in one place */
  assert(/function clinicalProviderName\(\)/.test(APP),
    'the shared clinical-provider resolver is missing — three surfaces were each making this ' +
    'substitution independently, which is how they drifted apart');
  const resolver = APP.slice(APP.indexOf('function clinicalProviderName()'), APP.indexOf('function getFacilityName()'));
  const resolverCode = stripComments(resolver);
  assert(/getProviderName/.test(resolverCode), 'the resolver must read the provider setting');
  assert(!/\bgetName\s*\(\s*\)/.test(resolverCode),
    'the shared resolver itself falls back to the account display name, which defeats its purpose');

  /* and the three surfaces use it */
  const code = stripComments(APP);
  for (const site of [
    "provider:clinicalProviderName()||'[Provider name]'",       /* prior-auth letter */
    "const provider=clinicalProviderName()||'[Provider]'",      /* procedure-note builder */
    "const docName=clinicalProviderName()||getPracticeName()||'Your care team'" /* patient handout */
  ]) {
    assert(code.includes(site), 'a provider surface still resolves its own identity: expected ' + site);
  }
  /* A clinical document gets a bracketed blank the doctor completes; only the
     PATIENT-facing handout may degrade to a practice name, which is a real
     thing to tell a patient and is not an attestation about who performed work. */
  assert(!/provider:clinicalProviderName\(\)\|\|getPracticeName/.test(code),
    'the prior-auth letter degrades a missing provider to the PRACTICE name. A payer letter names ' +
    'who rendered the service; a bracketed blank the doctor fills is the honest fallback.');

  /* mls-opnote-pro's own meta */
  const meta = stripComments(PRO.slice(PRO.indexOf('function appMeta()'), PRO.indexOf('function appMeta()') + 900));
  assert(/getProviderName/.test(meta) && !/\bgetName\s*\(\s*\)/.test(meta),
    'appMeta still prints the account display name as the operating provider on an operative note');
}

/* ---- 4. providerName BEFORE docname, IN BOTH REPORT MODULES ----------- */
/* These two read them the other way round, so a configured clinical identity
 * was actively OUTRANKED by the signup form. Asserted on ORDER, by execution,
 * because that is the whole defect — both keys are read either way. */
{
  for (const [name, src] of [['mls-procedure-report.js', REPORT], ['mls-rvu.js', RVU]]) {
    const from = src.indexOf('function providerName()');
    assert(from > 0, `${name}: providerName() not found`);
    const body = src.slice(from, src.indexOf('\n  }', from) + 4);

    const ctx = { String, console };
    const store = new Map([
      ['sf_u::doc@example.test::docname', 'Michael Schaeffer'],
      ['sf_u::doc@example.test::providerName', 'Matthew Schaeffer, MD']
    ]);
    ctx.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null) };
    ctx.curEmail = () => 'doc@example.test';
    vm.createContext(ctx);
    vm.runInContext(body + '\nthis.p = providerName;', ctx);

    assert.strictEqual(ctx.p(), 'Matthew Schaeffer, MD',
      `${name}: the login/account display name still outranks the configured clinical provider`);

    /* docname stays as a LAST resort — this is a productivity report attributed
       to an account, not a clinical attestation, so losing the label entirely
       would be a regression of its own. */
    store.delete('sf_u::doc@example.test::providerName');
    assert.strictEqual(ctx.p(), 'Michael Schaeffer',
      `${name}: with no provider identity configured the account name must still label the report`);
  }
}

console.log('PASS exports carry the practice identity: the shared PDF letterhead now resolves ' +
  'live from Settings (it was initialised empty and assigned nowhere but a test fixture, so the ' +
  'hardcoded vendor branch was the only one that ever ran in five exports), per-field host ' +
  'overrides still work, and four surfaces stopped treating the login/account display name as the ' +
  'clinical provider — including the two report modules that read docname BEFORE providerName');
