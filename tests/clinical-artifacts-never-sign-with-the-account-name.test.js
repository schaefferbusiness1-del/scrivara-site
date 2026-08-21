'use strict';

/* FIVE CLINICAL ARTIFACTS SIGNED THEMSELVES WITH THE LOGIN NAME (b820)
 *
 * The owner's identity-separation rule: a LOGIN/account name must never silently
 * become the clinical provider identity. tests/exports-carry-the-practice-identity
 * established the shared resolver (clinicalProviderName) and fixed four surfaces
 * inside the shell. Five feature modules were still doing it on their own:
 *
 *   feat_mls_dictate_letter.js   readLetterhead().providerName = getName()
 *       -> letterhead, the signature block (which APPENDS the practice's
 *          credentials and NPI to whatever name it is handed), and the fax cover
 *          sheet's FROM line
 *   feat_mls_legalpack.js        getProviderName() || getName()  (ungated)
 *       -> "Prepared by:" on a MEDICAL-LEGAL NARRATIVE REPORT, with credentials,
 *          practice and NPI appended
 *   feat_fullhistory_pdf.js      getName() and nothing else
 *       -> the full-history PDF header. The provider identity the doctor
 *          configures in Settings never reached this export AT ALL.
 *   feat_mls_opnote_prep.js      pick('getProviderName', 'getName')
 *       -> the op note's provider blank, credential appended
 *   feat_mls_writeflow.js        getProviderName() || getName()
 *       -> the RENDERING PROVIDER on an EHR write context. The one place a wrong
 *          name does not merely misprint: it targets another clinician's encounter.
 *
 * On a solo login the account name and the clinician are the same person and
 * nothing looked wrong. On a staff or shared login they are different people, and
 * every one of these documents went out attributing one person's work to another
 * — over the practice's real credentials and NPI.
 *
 * WHAT THIS TEST DOES: it EXECUTES each module's own ladder, composed with the
 * REAL clinicalProviderName() lifted out of ScribeFlow.html, across the four
 * identity states the app actually reaches. Grep cannot do this job — every one
 * of these ladders still legitimately mentions a provider getter, and the defect
 * is which rung answers, not which names appear.
 *
 * State 4 is the whole point: provider name unset AND a verified roster present.
 * The account name must NOT come out. State 3 is its guard rail — the setup
 * wizard deliberately leaves solo accounts with docname and no providerName, so
 * a blanket refusal would blank the letterhead for every one of them (that was
 * the first shipped version of the shell fix, and it regressed exactly that).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const APP = read('ScribeFlow.html');

/* Brace-matched extraction. An indexOf('}') or indexOf('};') bound truncates
   these on the first nested object literal — `practiceProfile(pid) || {};` is the
   exact line that produced a FALSE FAILURE on correct code earlier in this
   effort, so the matcher skips strings, regex-free comments and nesting. */
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
/* one-liner `var f = function (x) { ... };` and `function f(x){ ... }` alike */
function lineDecl(src, needle) {
  const at = src.indexOf(needle);
  assert(at >= 0, 'missing declaration: ' + needle);
  const end = src.indexOf('\n', at);
  return src.slice(at, end < 0 ? src.length : end);
}

/* ---- THE FOUR IDENTITY STATES THE APP REACHES ------------------------- */
const ACCOUNT = 'Dana Front-Desk';        /* the LOGIN display name */
const CLINICAL = 'Matthew Schaeffer, MD'; /* the configured clinical identity */
const ROSTER = [{ name: CLINICAL, verified: true }];

const STATES = [
  { key: 'configured, roster present', providerName: CLINICAL, docname: ACCOUNT, roster: ROSTER, want: CLINICAL },
  { key: 'configured, no roster', providerName: CLINICAL, docname: ACCOUNT, roster: [], want: CLINICAL },
  /* the setup wizard's own resting state for a solo account */
  { key: 'unset, no roster (solo)', providerName: '', docname: ACCOUNT, roster: [], want: ACCOUNT },
  /* THE DEFECT: a roster exists, so the login name is somebody else */
  { key: 'unset, roster present (staff login)', providerName: '', docname: ACCOUNT, roster: ROSTER, want: '' }
];

/* The REAL shared resolver, lifted from the shell and executed. Not re-typed:
   a second copy here would pass while the shipped one drifted. */
const RESOLVER_SRC = block(APP, 'function clinicalProviderName()');

function shellWindow(state) {
  const ctx = { String, console };
  ctx.getProviderName = () => state.providerName;
  ctx.getName = () => state.docname;
  ctx.suRosterEntries = () => state.roster;
  vm.createContext(ctx);
  vm.runInContext(RESOLVER_SRC + '\nthis.r = clinicalProviderName;', ctx);
  return ctx;
}

/* ---- POSITIVE CONTROL: the resolver itself behaves as the states claim --- */
{
  for (const s of STATES) {
    assert.strictEqual(shellWindow(s).r(), s.want,
      'positive control: the SHELL resolver disagrees with this test\'s own state matrix for "' +
      s.key + '" — every module assertion below would be measuring the harness');
  }
  /* and it is genuinely the shell's code, not a stub: strip it of the roster
     gate and state 4 must start leaking the account name */
  const broken = RESOLVER_SRC.replace('roster.length ?', 'false ?');
  assert.notStrictEqual(broken, RESOLVER_SRC, 'control: the roster gate was not found to mutate');
  const ctx = { String, console };
  ctx.getProviderName = () => ''; ctx.getName = () => ACCOUNT; ctx.suRosterEntries = () => ROSTER;
  vm.createContext(ctx);
  vm.runInContext(broken + '\nthis.r = clinicalProviderName;', ctx);
  assert.strictEqual(ctx.r(), ACCOUNT,
    'control: removing the roster gate did NOT change the answer, so the gate is not what decides ' +
    'state 4 and this test is pinned to the wrong line');
}

/* ---- run one module's ladder under one state -------------------------- */
function ladder(prelude, call, state, opts) {
  const shell = shellWindow(state);
  const ctx = { String, console, RegExp, Array, Object };
  ctx.window = {
    clinicalProviderName: shell.r,
    getProviderName: () => state.providerName,
    getName: () => state.docname,
    /* everything else the ladders may consult, deliberately empty so the
       identity rungs are what answer */
    getPracticeName: () => '', getProviderCred: () => '', getSpec: () => '',
    getNpi: () => '', getClinicAddress: () => '', getClinicPhone: () => '',
    getQolSignature: () => '', effectivePremium: () => false
  };
  if (opts && opts.window) Object.keys(opts.window).forEach((k) => { ctx.window[k] = opts.window[k]; });
  vm.createContext(ctx);
  vm.runInContext(prelude + '\nthis.out = (' + call + ');', ctx);
  return ctx.out == null ? '' : String(ctx.out);
}

/* Each entry composes ONLY code lifted from the module under test. */
const DL = read('feat_mls_dictate_letter.js');
const LP = read('feat_mls_legalpack.js');
const FH = read('feat_fullhistory_pdf.js');
const OP = read('feat_mls_opnote_prep.js');
const WF = read('feat_mls_writeflow.js');

/* Lift isFn by its function identity, not by a disposable parameter spelling.
   Execute the helper so this fixture still proves the semantic dependency the
   Legal provider ladder relies on. */
const LP_IS_FN = block(LP, 'function isFn(');
{
  const ctx = { result: null };
  vm.createContext(ctx);
  vm.runInContext(LP_IS_FN + '\nthis.result = [isFn(function () {}), isFn({}), isFn(null)];', ctx);
  assert.deepStrictEqual(Array.from(ctx.result), [true, false, false],
    'feat_mls_legalpack.js isFn no longer distinguishes callable provider getters from non-functions');
}

/* feat_mls_opnote_prep's rung list is data, so lift the ARGUMENT LIST from the
   file rather than re-typing it — otherwise this test pins its own opinion. */
const opArgs = /provider:\s*pick\(([^)]*)\)/.exec(OP);
assert(opArgs, 'feat_mls_opnote_prep.js: the provider rung list was not found');

/* Each `call` is the ARTIFACT PRODUCER, not the helper that feeds it. Executing
   the helper alone was the first version of this test, and it SURVIVED a mutation
   that reverted readLetterhead()'s field to the account name — the new helper sat
   there correct and uncalled while the letterhead was broken. A test must run the
   function whose output the doctor actually sees. */
const MODULES = [
  {
    file: 'feat_mls_dictate_letter.js',
    what: 'the letterhead, signature block and fax FROM line',
    prelude: lineDecl(DL, 'var S = function (x)') + '\n' + lineDecl(DL, 'function g(fn)') + '\n' +
      block(DL, 'function clinicalProvider()') + '\n' + block(DL, 'function readLetterhead()'),
    call: 'readLetterhead().providerName'
  },
  {
    file: 'feat_mls_legalpack.js',
    what: 'the provider line in the medical-legal letterhead and signature identity',
    prelude: LP_IS_FN + '\n' + block(LP, 'function clean(') + '\n' + block(LP, 'function lhSafe(') + '\n' +
      lineDecl(LP, 'var UNSET = function') + '\n' + block(LP, 'function settingText(') + '\n' +
      block(LP, 'function letterhead(') + '\n' + block(LP, 'function signatureName(') + '\n' +
      block(LP, 'function letterheadBlock('),
    /* Execute the current artifact producer and read its provider line. The
       explicit email override keeps this identity test out of storage. */
    call: 'letterheadBlock("").split("\\n")[1]',
    unsetIs: '[The evaluating provider name is not configured - set it in Settings before this report is signed]',
    configuredOnly: true
  },
  {
    file: 'feat_fullhistory_pdf.js',
    what: 'the full-history PDF header',
    prelude: lineDecl(FH, 'var isFn = function (f)') + '\n' + lineDecl(FH, 'var S = function (x)') + '\n' +
      lineDecl(FH, 'var trim = function (x)') + '\n' + lineDecl(FH, 'function safe(fn)') + '\n' +
      block(FH, 'function providerName()'),
    call: 'providerName()'
  },
  {
    file: 'feat_mls_opnote_prep.js',
    what: "the op note's provider blank",
    prelude: lineDecl(OP, 'function S(x)') + '\n' + lineDecl(OP, 'function isFn(f)') + '\n' +
      lineDecl(OP, 'function trim(x)') + '\n' + lineDecl(OP, 'function pick()'),
    call: 'pick(' + opArgs[1] + ')'
  },
  {
    file: 'feat_mls_writeflow.js',
    what: 'the RENDERING PROVIDER on an EHR write context',
    prelude: lineDecl(WF, 'var S = function (x)') + '\n' + block(WF, 'function apptProvider(a)'),
    call: 'apptProvider({})'
  }
];

/* With nothing configured a producer may print its own honest blank — a
   bracketed placeholder for the physician to complete. What it may never print
   is the account name. */
function expected(m, s) {
  if (m.configuredOnly && !s.providerName) return m.unsetIs || '';
  return s.want === '' ? (m.unsetIs || '') : s.want;
}

/* ---- 1. EVERY MODULE, EVERY STATE ------------------------------------- */
for (const m of MODULES) {
  for (const s of STATES) {
    const got = ladder(m.prelude, m.call, s);
    assert.strictEqual(got, expected(m, s),
      m.file + ' resolves the wrong identity for ' + m.what + '.\n' +
      '  state:    ' + s.key + '\n' +
      '  expected: ' + JSON.stringify(expected(m, s)) + '\n' +
      '  got:      ' + JSON.stringify(got));
  }
  /* stated as its own assertion because it is THE rule, and a future edit that
     re-adds a getName rung would show up here first */
  const staff = STATES[3];
  assert.notStrictEqual(ladder(m.prelude, m.call, staff), ACCOUNT,
    m.file + ' signs ' + m.what + ' with the LOGIN/account name while a verified roster says the ' +
    'clinician is somebody else. That is the substitution the separation rule forbids.');
}

/* ---- 2. IDENTITY AUTHORITY IS EXPLICIT, NEVER THE ACCOUNT NAME -------- */
/* If a module quietly grew its own roster logic, swapping the shared resolver for
   a sentinel would not change its answer. Shared-resolver modules must return
   the sentinel. Legal is deliberately stricter: it reads only the configured
   provider field and prints a bracketed refusal when that field is empty. */
for (const m of MODULES) {
  const configuredOnly = m.configuredOnly === true;
  const got = ladder(m.prelude, m.call, STATES[0], {
    window: { clinicalProviderName: () => 'SENTINEL-RESOLVER', getProviderName: () => configuredOnly ? CLINICAL : 'not-this', getName: () => ACCOUNT }
  });
  assert.strictEqual(got, configuredOnly ? CLINICAL : 'SENTINEL-RESOLVER',
    m.file + (configuredOnly
      ? ' no longer uses only the configured clinical provider for its legal letterhead'
      : ' does not defer to the shared clinicalProviderName resolver — it is deciding provider identity locally'));
}

/* ---- 3. AN ABSENT RESOLVER DEGRADES TO A BLANK, NEVER THE LOGIN NAME --- */
/* Navigation is network-first, so an old shell beside new modules is an offline
   edge; when it happens the honest output is a blank the physician completes. */
for (const m of MODULES) {
  const noResolver = { window: { clinicalProviderName: undefined } };
  const configured = ladder(m.prelude, m.call, STATES[1], noResolver);
  assert.strictEqual(configured, CLINICAL,
    m.file + ' loses the configured provider identity when the shared resolver is absent — it must ' +
    'still read the provider setting directly');
  const staffNoResolver = ladder(m.prelude, m.call, STATES[3], noResolver);
  assert.strictEqual(staffNoResolver, m.unsetIs || '',
    m.file + ' falls back to the LOGIN/account name when the shared resolver is absent. A blank the ' +
    'physician completes is the honest failure; another clinician\'s name over these credentials is not. ' +
    'Got: ' + JSON.stringify(staffNoResolver));
}

/* ---- 4. A THROWING GETTER MUST NOT TAKE THE DOCUMENT DOWN ------------- */
for (const m of MODULES) {
  assert.doesNotThrow(() => {
    ladder(m.prelude, m.call, STATES[0], {
      window: {
        clinicalProviderName: () => { throw new Error('resolver unavailable'); },
        getProviderName: () => { throw new Error('setting unavailable'); }
      }
    });
  }, m.file + ' throws when an identity getter fails, which takes the whole export with it');
}

/* ---- 5. THE EMAIL SUBJECT NAMES THE SENDER WHEN IT CAN ---------------- */
/* "Letter from your provider" was unconditional whenever practiceName was unset,
   including for the doctor who configured a provider name and nothing else. */
{
  const prelude = lineDecl(DL, 'var S = function (x)') + '\n' + block(DL, 'function reLine(state)') + '\n' +
    block(DL, 'function buildEmail(state)');
  function subject(letterhead) {
    const ctx = { String, console, RegExp };
    ctx.buildLetterText = () => '';
    vm.createContext(ctx);
    vm.runInContext(prelude + '\nthis.s = function (lh) { return buildEmail({ letterhead: lh }).subject; };', ctx);
    return ctx.s(letterhead);
  }
  assert.strictEqual(subject({ practiceName: 'Ridgeline Orthopaedics', providerName: CLINICAL }),
    'Letter from Ridgeline Orthopaedics', 'the practice name should head the subject when set');
  assert.strictEqual(subject({ practiceName: '', providerName: CLINICAL }),
    'Letter from ' + CLINICAL,
    'a doctor who configured a provider name and no practice name still gets "your provider" — the ' +
    'recipient\'s inbox should say who wrote to them');
  assert.strictEqual(subject({ practiceName: '', providerName: '' }), 'Letter from your provider',
    'with neither fact configured the generic wording is right and must remain');
  assert.strictEqual(subject({}), 'Letter from your provider', 'an absent letterhead must not throw or print undefined');
}

/* ---- 6. EACH MODULE STILL REACHES A BROWSER ---------------------------
   Two loading mechanisms are in use and they need different proof:

     - a FIXED per-module token, which must be edited by hand or a returning
       browser keeps the cached copy and the fix ships invisibly;
     - window.__MLS_AV, the app build number, which the build bump moves for
       free — so the assertion there is that the loader really is version-tied
       and not a bare filename.

   feat_mls_legalpack.js uses a token-owned multi-line loader. It is live now,
   and its source URL must remain tied to the app build just like the simpler
   one-line loaders. */
{
  const connect = read('mls-connect.js');
  const FIXED_TOKEN = {
    'feat_mls_dictate_letter.js': '20260711dl1c1-B177',
    'feat_mls_opnote_prep.js': '20260730opnp180'
  };
  const BUILD_TIED = ['feat_fullhistory_pdf.js', 'feat_mls_writeflow.js'];

  for (const f of Object.keys(FIXED_TOKEN)) {
    const tok = new RegExp(f.replace(/\./g, '\\.') + '\\?v=([A-Za-z0-9_.-]+)').exec(connect);
    assert(tok, f + ' is no longer loaded with a cache-busting token');
    assert.notStrictEqual(tok[1], FIXED_TOKEN[f],
      f + ' still carries the loader token it had before this fix (' + FIXED_TOKEN[f] + '), so a ' +
      'returning browser keeps the cached module and the identity fix ships invisibly — the trap ' +
      'this repo names first');
  }
  /* Anchor on the LOADER, not on the first mention of the filename. A window of
     N characters around connect.indexOf(f) was the first form and it SURVIVED a
     mutation that stripped the version off the real loader, because it measured a
     different occurrence entirely. Each of these loaders is a single line, so the
     line containing both the filename and the script creation IS the loader. */
  const lines = connect.split('\n');
  for (const f of BUILD_TIED) {
    const loaders = lines.filter((l) => l.includes(f) && l.includes("createElement('script')"));
    assert(loaders.length > 0,
      f + ' has no script-creating loader line in mls-connect.js — it can no longer reach a browser');
    for (const l of loaders) {
      assert(/window\.__MLS_AV/.test(l),
        f + ' is loaded by a line that does not tie its URL to the app build number, so bumping the ' +
        'build no longer busts its cache and this identity fix can ship invisibly to every returning ' +
        'browser. Loader line: ' + l.trim().slice(0, 200));
    }
  }

  const legalAt = connect.indexOf("var A='feat_mls_legalpack.js',SRC='feat_mls_legalpack.js'");
  assert(legalAt >= 0, 'feat_mls_legalpack.js has no token-owned loader in mls-connect.js');
  const legalLoader = connect.slice(legalAt, legalAt + 7000);
  assert(/document\.createElement\('script'\)/.test(legalLoader),
    'feat_mls_legalpack.js is named by a loader that never creates its script');
  assert(/node\.src=SRC\+'\?v='\+\(window\.__MLS_AV\|\|/.test(legalLoader),
    'feat_mls_legalpack.js is live but its token-owned loader URL is not tied to the app build');
}

console.log('PASS clinical artifacts never sign with the account name: five modules that stamped the ' +
  'LOGIN/account name onto clinical artifacts now use an explicit clinical identity authority. All ' +
  'four identity states execute per module, including the staff login where a verified roster proves ' +
  'the login name is somebody else; Legal additionally requires the configured provider and prints an ' +
  'honest bracketed refusal when it is absent. Resolver-absent degradation, throwing getters, isFn ' +
  'callability semantics, and cache-busting for fixed, build-tied, and token-owned live loaders are proven.');
