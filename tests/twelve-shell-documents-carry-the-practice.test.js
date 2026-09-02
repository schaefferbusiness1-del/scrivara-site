'use strict';

/* THE SIGNATURE, THE PAYER LETTER AND TEN MORE SIGNED WITH THE LOGIN NAME (b825)
 *
 * tests/exports-carry-the-practice-identity.test.js pinned THREE shell surfaces to
 * the shared resolver. Eight more were still reading getName() — which is
 * uns('docname'), the device-local signup name that is NOT in PREF_SYNC_KEYS and
 * that the server never receives:
 *
 *   signNote()                  "Electronically signed by <X> on <date>" — and
 *                               saveCurrentNote() writes that string INTO THE CHART
 *   buildPriorAuthPrintHTML()   the letterhead of a letter that goes to A PAYER,
 *                               whose own body already resolved the provider
 *                               correctly via clinicalProviderName()
 *   ordersAsText()              the Provider line on the sheet pasted into a
 *                               pharmacy or imaging portal
 *   buildOrdersPrintHTML()      the printed version of that sheet
 *   buildPrintHTML()            the Provider line on the printed clinical note
 *   printProcNote()             the printed procedure note
 *   printExtra()                the letterhead shared by twelve documents
 *   printCustomWidget()         (server-sourced bkUser stays first)
 *
 * On a solo login the login name and the clinician are the same person and nothing
 * looked wrong. On a shared or front-desk login they are different people — and an
 * electronic signature naming the wrong person is a false attestation in a medical
 * record, not a cosmetic slip.
 *
 * FOUR LETTERHEADS ALSO HARDCODED THE VENDOR: three printed
 * `MLS / Physical Medicine & Rehabilitation` and a PATIENT handout printed the
 * vendor's specialty, all while getPracticeName() and getSpec() were in scope.
 * buildPrintHTML() has resolved its letterhead from Settings since the b805 export
 * fix, so this is the rest of the file catching up to a pattern already there.
 *
 * WHAT THIS TEST DOES NOT CLAIM: the 'Clinician' fallback is untouched and is not
 * endorsed. When the shared resolver declines, the app genuinely cannot identify
 * the clinician, and whether an unidentifiable signer should be able to sign at all
 * is an owner decision. What is asserted is that a DIFFERENT REAL PERSON's name can
 * no longer appear, which is the part that is provably wrong.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function block(src, header) {
  const at = src.indexOf(header);
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
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const CODE = stripComments(APP);
const ACCOUNT = 'Dana Front-Desk';
const CLINICAL = 'Matthew Schaeffer, MD';

/* ---- the REAL shared resolver, lifted and executed --------------------- */
const RESOLVER = block(APP, 'function clinicalProviderName()');
function resolver(state) {
  const ctx = { String, console };
  ctx.getProviderName = () => state.providerName;
  ctx.getName = () => state.docname;
  ctx.suRosterEntries = () => state.roster;
  vm.createContext(ctx);
  vm.runInContext(RESOLVER + '\nthis.r = clinicalProviderName;', ctx);
  return ctx.r;
}
const STATES = [
  { key: 'solo, provider name configured', providerName: CLINICAL, docname: ACCOUNT, roster: [], want: CLINICAL },
  { key: 'solo, nothing configured (the wizard\'s resting state)', providerName: '', docname: ACCOUNT, roster: [], want: ACCOUNT },
  { key: 'group login, provider name configured', providerName: CLINICAL, docname: ACCOUNT, roster: [{}], want: CLINICAL },
  { key: 'group login, nothing configured', providerName: '', docname: ACCOUNT, roster: [{}], want: '' }
];

/* ---- POSITIVE CONTROL: the resolver behaves as the matrix claims ------- */
{
  for (const s of STATES) {
    assert.strictEqual(resolver(s)(), s.want,
      'positive control: the shell resolver disagrees with this suite\'s state matrix for "' + s.key + '"');
  }
}

/* ---- 1. EVERY SITE RESOLVES THROUGH THE SHARED RESOLVER ---------------- */
/* Executed: each site's own expression is lifted from source and evaluated, so a
   site that merely MENTIONS the resolver while reading something else fails. */
/* RE-AIMED 2026-09-02 (draftsig-1.0.0, while auditing every signature path).
   This pin spelled signNote()'s signer line as `const name=clinicalProviderName()
   ||'Clinician';` and had been RED since noteact-1.0.0 landed on 2026-08-27 -
   which STRENGTHENED the very property the pin guards. signNote() no longer
   falls back to the anonymous 'Clinician' attestation at all: an unresolved
   signer now REFUSES to sign and sends the doctor to Settings. The pin was
   holding a spelling, not the property, so it is re-aimed at the shipped shape
   and at the refusal that replaced the fallback. The property is unchanged and
   still executed below: the signer resolves through clinicalProviderName() and
   the block never reads getName(). */
const SITES = [
  { what: 'signNote() — the electronic signature written INTO THE CHART',
    fn: 'function signNote(', needle: 'const resolvedSigner=clinicalProviderName();', varName: 'name' },
  { what: 'ordersAsText() — the sheet pasted into a pharmacy portal',
    fn: 'function ordersAsText(', needle: "clinicalProviderName()||'Clinician'", varName: null }
];
{
  for (const site of SITES) {
    const body = stripComments(block(APP, site.fn));
    assert(body.includes(site.needle.replace(/\s+/g, ' ')) || body.replace(/\s+/g, ' ').includes(site.needle.replace(/\s+/g, ' ')),
      site.what + ' does not resolve through clinicalProviderName(). Body did not contain: ' + site.needle);
    assert(!/\bgetName\s*\(\s*\)/.test(body),
      site.what + ' still reads getName() — the device-local LOGIN name, which is not even synced to the ' +
      'server. On a shared login this names the wrong person.');
  }

  /* noteact-1.0.0's replacement for the 'Clinician' fallback, pinned where the
     old spelling used to be: an unresolved signer REFUSES rather than signing
     the chart in nobody's name, and the name that is signed is that resolved
     signer and nothing else. */
  {
    const sign = stripComments(block(APP, 'function signNote(')).replace(/\s+/g, ' ');
    assert(sign.includes('const resolvedSigner=clinicalProviderName(); if(!resolvedSigner){'),
      'signNote() must REFUSE when the shared resolver cannot name the signer');
    assert(sign.includes('const name=resolvedSigner;'),
      'signNote() must sign with the resolved signer and nothing else');
    assert(!/'Clinician'/.test(sign),
      'signNote() must not have regained an anonymous "Clinician" attestation');
  }

  /* the five shared letterhead sites, counted so none is left behind */
  const good = (CODE.match(/const docName=clinicalProviderName\(\)\|\|'Clinician';/g) || []).length;
  const bad = (CODE.match(/const docName=getName\(\)\|\|'Clinician';/g) || []).length;
  assert.strictEqual(bad, 0,
    bad + ' letterhead site(s) still build docName from getName(). These are the Provider lines on the ' +
    'printed note, the printed orders sheet, the PAYER-facing prior-auth letterhead, the procedure note ' +
    'and printExtra()\'s shared header.');
  assert(good >= 5, 'expected at least 5 letterhead sites on the shared resolver, found ' + good);

  /* the widget print keeps its server-sourced rung FIRST — a server identity
     outranks a local one, and losing that would be a regression of its own */
  assert(/const docName=\(bkUser&&bkUser\.name\)\|\|clinicalProviderName\(\)\|\|'Clinician';/.test(CODE),
    'printCustomWidget() either still reads getName() or lost its server-sourced bkUser rung');
}

/* ---- 2. THE PAYER LETTER NO LONGER CONTRADICTS ITSELF ------------------ */
/* The sharpest instance: the letter BODY resolved correctly while the LETTERHEAD
   of the same page named someone else. */
{
  const body = CODE.indexOf("provider:clinicalProviderName()||'[Provider name]'");
  assert(body > 0, 'the prior-auth letter body no longer resolves the provider through the shared resolver');
  const head = CODE.indexOf('function buildPriorAuthPrintHTML');
  assert(head > 0, 'buildPriorAuthPrintHTML is gone');
  const headBody = stripComments(block(APP, 'function buildPriorAuthPrintHTML'));
  assert(/clinicalProviderName\(\)/.test(headBody),
    'the prior-auth LETTERHEAD still names a different person from the letter BODY on the same page — ' +
    'and this letter goes to a payer');
  assert(!/\bgetName\s*\(\s*\)/.test(headBody), 'the prior-auth letterhead still reads the login name');
}

/* ---- 3. THE LETTERHEAD BRAND IS THE PRACTICE'S, NOT THE VENDOR'S ------- */
{
  assert(!/class="brand">MLS<small>Physical Medicine/.test(CODE),
    'a print letterhead still hardcodes the VENDOR\'s name and specialty on a document the practice hands ' +
    'out, while getPracticeName() and getSpec() are in scope');
  const resolved = (CODE.match(/class="brand">\$\{esc\(getPracticeName\(\)\|\|'MLS'\)\}/g) || []).length;
  assert.strictEqual(resolved, 3,
    'expected 3 letterheads resolving the practice name from Settings, found ' + resolved);
  /* the patient handout keeps its document title and gains the practice */
  assert(/class="brand">Your Home Care Plan<small>\$\{esc\(getPracticeName\(\)\|\|getSpec\(\)\|\|'Physical Medicine/.test(CODE),
    'the patient handout either lost its "Your Home Care Plan" heading or still prints the vendor\'s ' +
    'specialty to a patient');
  /* every one keeps a last-resort literal, so a wholly unconfigured account still
     renders a letterhead rather than an empty box */
  assert(/getPracticeName\(\)\|\|'MLS'/.test(CODE),
    'the vendor literal was removed outright, so an unconfigured account now prints an empty brand');
}

/* ---- 4. THE SIGNATURE IS THE ONE THAT MATTERS MOST -------------------- */
/* Executed end to end: build the attestation string the four identity states
   produce, and require that the account name cannot appear when a roster proves
   the login belongs to somebody else. */
/* RE-AIMED 2026-09-02 (draftsig-1.0.0). This block lifted `const name=<expr>;`
   and evaluated it; noteact-1.0.0 (2026-08-27) renamed that to
   `const resolvedSigner=clinicalProviderName();` AND removed the degrade-to-
   'Clinician' branch this block used to require - an unresolved signer now
   REFUSES to sign at all. The old expectation ("the signature must degrade to
   the generic literal") therefore pinned behaviour the shipped code deliberately
   made STRICTER, and the suite had been dead since. The property that matters is
   unchanged and still executed: the account name can never reach the chart when
   a roster proves the login belongs to somebody else. What was a generic
   attestation is now no attestation. */
{
  const sign = block(APP, 'function signNote(');
  const expr = /const resolvedSigner=([^;]+);/.exec(stripComments(sign));
  assert(expr, 'the signature name expression was not found in signNote()');
  for (const st of STATES) {
    const ctx = { String, console };
    ctx.clinicalProviderName = resolver(st);
    ctx.getName = () => st.docname;
    vm.createContext(ctx);
    const name = vm.runInContext('(' + expr[1] + ')', ctx);
    /* signNote() refuses on a falsy signer, so there is no line at all then */
    const line = name ? ('Electronically signed by ' + name + ' on <date>.') : '';
    if (st.want === CLINICAL) {
      assert(line.includes(CLINICAL), st.key + ': the signature does not name the configured clinician: ' + line);
    }
    if (st.roster.length && !st.providerName) {
      assert(!line.includes(ACCOUNT),
        'THE FALSE ATTESTATION: with a verified roster proving the login belongs to somebody else, the ' +
        'note is still signed "' + line + '". That string is saved into the chart.');
      assert.strictEqual(line, '',
        st.key + ': an unidentifiable signer must produce NO attestation - signNote() refuses and sends ' +
        'the doctor to Settings rather than signing the chart in a generic name.');
    }
    /* the solo account the setup wizard deliberately leaves with docname only must
       keep signing with its own name — blanking it would regress every solo user */
    if (!st.roster.length && !st.providerName) {
      assert(line.includes(ACCOUNT),
        st.key + ': a solo account with no roster to contradict it lost its signer name: ' + line);
    }
  }
}

console.log('PASS twelve shell documents carry the practice: eight surfaces still read getName() — the ' +
  'device-local login name that is not even synced to the server — including the ELECTRONIC SIGNATURE ' +
  'written into the chart and the letterhead of a prior-auth letter sent to a payer, whose own body ' +
  'already resolved the provider correctly. All eight now use the shared resolver, executed across the ' +
  'four identity states, with the solo-account path asserted intact and the false attestation asserted ' +
  'impossible; and four letterheads that hardcoded the vendor\'s name and specialty onto documents the ' +
  'practice hands out now resolve from Settings, keeping a last-resort literal so an unconfigured ' +
  'account still renders');
