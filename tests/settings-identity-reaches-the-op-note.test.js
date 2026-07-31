'use strict';

/* WHAT THE DOCTOR TYPED IN SETTINGS MUST REACH THE OP NOTE (b808)
 *
 * Owner instruction: "if a provider sets their name in settings then they go to
 * do an op note it should ask for the providers name to fill in — it should be
 * automatic."
 *
 * Three separate breaks meant it was not, and each one was invisible in a way
 * worth naming, because the shape recurs:
 *
 *   1. provProfile() hardcoded `facility: ''`. The facility rule in knownValue
 *      matches facility/clinic/location/site/hospital/center/ASC and is guarded
 *      on `S(prof.facility).trim()`, so with the field pinned empty the guard
 *      could never pass. The rule shipped, read correctly, and was unreachable.
 *
 *   2. getFacilityName() and getFacilityAddress() were CALLED in three files and
 *      DEFINED in none — only as a stub inside feat_mls_opnote_prep.js's own
 *      selfTest. Every call site wrapped them in `typeof x === 'function'`, so
 *      three surfaces asked a question nobody had ever answered and silently
 *      accepted ''. There was no Settings field to answer it with either.
 *
 *   3. apptProvider() read provider_raw|provider_key|provider. The op-note
 *      room's own rows are built by _opNewRow, which writes `providerName`. So
 *      for every row the room itself created, the appointment's provider was
 *      invisible and the answer fell through to Settings and then to
 *      commonApptProvider() — meaning on an all-providers day a colleague's case
 *      could be attributed to whoever happened to be signed in.
 *
 * Proved by EXECUTING the shipped resolution ladder out of
 * feat_mls_opnote_fill.js against real label strings. Every assertion below
 * would have failed before the fix, and #1 and #2 could not have been caught by
 * reading either file alone: the rule was correct, the getter name was correct,
 * and nothing connected them.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const FILL = fs.readFileSync(path.join(root, 'feat_mls_opnote_fill.js'), 'utf8');
const APP = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const PREP = fs.readFileSync(path.join(root, 'feat_mls_opnote_prep.js'), 'utf8');

function functionBlock(input, name) {
  const fnStart = input.indexOf(`function ${name}(`);
  assert(fnStart >= 0, `missing function ${name}`);
  const brace = input.indexOf('{', fnStart);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < input.length; i++) {
    const ch = input[i], next = input[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return input.slice(fnStart, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

/* The real ladder. Nothing here is reimplemented — these are the shipped
   function bodies, so a pass is a statement about production code. */
const LADDER = ['safe', 'isFn', 'S', 'plausibleMrn', 'canonicalSetting', 'provProfile',
  'apptProvider', 'apptFacility', 'commonApptProvider', 'seedProfile',
  'normPatientName', 'normPatientDob', 'rowPatientId', 'chartPatient', 'knownValue'];

/* Exactly what a doctor would have typed into the Practice & provider section. */
const SETTINGS = {
  getProviderName: 'Jane A. Smith',
  getProviderCred: 'MD',
  getNpi: '1548273901',
  getPracticeName: 'Chester County Spine Care',
  getFacilityName: 'Brandywine Surgery Center'
};

function ladder(opts) {
  opts = opts || {};
  const settings = Object.assign({}, SETTINGS, opts.settings || {});
  const ctx = { console, String, Number, JSON, Object, Array, RegExp, Error, Math, isNaN,
    _calAppts: opts.calAppts || [],
    getPatients() { return opts.patients || []; } };
  ctx.window = ctx;
  for (const fn of Object.keys(settings)) {
    if (settings[fn] === null) continue;   /* deliberately unset in Settings */
    ctx[fn] = (v => () => v)(settings[fn]);
    ctx.window[fn] = ctx[fn];
  }
  vm.createContext(ctx);
  vm.runInContext(LADDER.map(n => functionBlock(FILL, n)).join('\n') +
    '\nthis.knownValue = knownValue; this.provProfile = provProfile;' +
    '\nthis.apptProvider = apptProvider; this.apptFacility = apptFacility;', ctx);
  return ctx;
}

/* ---- POSITIVE CONTROL --------------------------------------------------
   The harness must be able to see a value it IS given, and must report empty
   for a label the ladder genuinely has no rule for. Without both halves a
   green run below could mean "resolved" or "the harness returns strings". */
{
  const L = ladder();
  assert.strictEqual(L.knownValue('patient name', { appt: { name: 'Ada Lovelace' } }), 'Ada Lovelace',
    'positive control: the harness cannot resolve a label the ladder demonstrably handles');
  assert.strictEqual(L.knownValue('estimated blood loss', { appt: {} }), '',
    'negative control: the harness invented a value for a label with no identity rule — every ' +
    'assertion below would be meaningless');
}

/* ---- 1. THE OWNER'S SENTENCE, LITERALLY -------------------------------- */
{
  const L = ladder();
  const row = { patientId: '', appt: {} };   /* no appointment context at all */

  for (const label of ['Surgeon', 'Provider', 'Operating physician', 'Attending',
    'Performed by', 'Dictated by', 'Proceduralist', 'Rendering provider']) {
    assert.strictEqual(L.knownValue(label, row), 'Jane A. Smith, MD',
      `"${label}" did not fill from the Settings provider name + credentials`);
  }
  assert.strictEqual(L.knownValue('Provider NPI', row), '1548273901', 'NPI did not fill from Settings');
  assert.strictEqual(L.knownValue('NPI', row), '1548273901', 'the bare NPI label did not fill from Settings');
  assert.strictEqual(L.knownValue('Practice name', row), 'Chester County Spine Care', 'practice did not fill');

  /* A SECOND person's role must stay empty. "Assistant surgeon" contains
     "surgeon", so the generic provider rule claimed it and wrote the PRIMARY
     provider's name and credentials into the assistant line — a fabricated
     attestation, in a signed operative note, that a specific named clinician
     assisted a case. The app has no assistant source at all, so empty is the
     only honest answer. */
  for (const label of ['Assistant', 'Assistant surgeon', 'First assistant', 'Assisting physician',
    'Co-surgeon', 'Resident', 'Fellow', 'Anesthesiologist', 'CRNA']) {
    assert.strictEqual(L.knownValue(label, row), '',
      `"${label}" was filled with the operating provider's identity. The app does not know who ` +
      `assisted; writing the surgeon's name there fabricates an attestation in a signed note.`);
  }

  /* #1 and #2 together: this is the assertion that was impossible before. */
  for (const label of ['Facility', 'Facility name', 'Clinic', 'Location', 'Site of service',
    'Hospital', 'Surgery center', 'ASC']) {
    assert.strictEqual(L.knownValue(label, row), 'Brandywine Surgery Center',
      `"${label}" did not fill from the Settings facility — provProfile's hardcoded '' made this ` +
      `rule unreachable, and there was no getter behind it`);
  }
}

/* ---- 2. AN NPI FIELD STILL ONLY EVER RECEIVES AN NPI ------------------- */
/* Pre-existing guard (a generic provider rule once put "Matthew Schaeffer, MD"
 * into NPI blanks). Re-asserted because the facility branch above now sits
 * between the NPI rule and the provider rule and must not have moved it. */
{
  const L = ladder({ settings: { getNpi: null } });
  assert.strictEqual(L.knownValue('Provider NPI', { appt: {} }), '',
    'with no NPI configured, an NPI blank took the provider NAME instead of staying empty');
  assert.strictEqual(L.knownValue('Surgeon', { appt: {} }), 'Jane A. Smith, MD',
    'the provider rule stopped working when NPI was unset');
}

/* ---- 3. THIS VISIT OUTRANKS THE ACCOUNT DEFAULT ----------------------- */
/* The appointment says where the case happened and who did it; Settings says
 * what is usually true. For a colleague's case on an all-providers day, the
 * account default is the wrong answer. */
{
  const L = ladder();
  const roomRow = {
    patientId: 'pt-1',
    /* the exact shape _opNewRow builds — providerName / facilityName */
    appt: { name: 'Ada Lovelace', dob: '03/12/1970', providerName: 'Kelly Carter, PA-C',
      facilityName: 'Paoli Hospital' }
  };
  assert.strictEqual(L.knownValue('Surgeon', roomRow), 'Kelly Carter, PA-C',
    'the op-note room writes appt.providerName and apptProvider did not read it, so a ' +
    "colleague's case was attributed to whoever is signed in");
  assert.strictEqual(L.knownValue('Facility', roomRow), 'Paoli Hospital',
    "the appointment's own department must outrank the account-wide default facility");

  /* A CREDENTIAL BELONGS TO THE PERSON NAMED. The account credential used to be
     appended to whatever provider string won, guarded only against repeating
     the SAME credential — which says nothing about a different one. With the
     account credential "MD" and an appointment provider of "Kelly Carter, PA-C"
     that produced "Kelly Carter, PA-C, MD": an operative note asserting a
     physician assistant is a physician. */
  assert(!/,\s*MD/.test(L.knownValue('Surgeon', roomRow)),
    'the signed-in account\'s credential was appended to another clinician\'s name, changing what ' +
    'their licence says. Got: ' + JSON.stringify(L.knownValue('Surgeon', roomRow)));

  /* the account's OWN name must still be decorated, exactly as before */
  assert.strictEqual(L.knownValue('Surgeon', { patientId: '', appt: {} }), 'Jane A. Smith, MD',
    'the account credential is no longer appended to the account\'s own provider name');
  /* and still must not double when the stored name already carries it */
  const dbl = ladder({ settings: { getProviderName: 'Jane A. Smith, MD' } });
  assert.strictEqual(dbl.knownValue('Surgeon', { patientId: '', appt: {} }), 'Jane A. Smith, MD',
    'the credential doubled onto a name that already carries it');

  /* the calendar/board shapes must keep working byte-for-byte */
  assert.strictEqual(L.apptProvider({ provider_raw: 'Carter_Kelly_PA-C' }), 'Carter Kelly PA-C',
    'the raw EMR shape regressed');
  assert.strictEqual(L.apptProvider({ provider_raw: 'A_raw', provider_key: 'b_key', provider: 'c', providerName: 'd' }), 'A raw',
    'precedence changed: provider_raw must still win over every other key');
  assert.strictEqual(L.apptProvider({ provider_key: 'b_key', providerName: 'd' }), 'b key',
    'precedence changed: provider_key must still outrank providerName');
  assert.strictEqual(L.apptFacility({ department_name: 'Dept_Two' }), 'Dept Two', 'department_name is not read');
  assert.strictEqual(L.apptFacility({ location: 'Suite 200' }), 'Suite 200', 'location is not read');
}

/* ---- 4. THE MRN COMES FROM THE IDENTITY-PROVED PATIENT ---------------- */
/* knownValue read appt.athenaId||appt.mrn, and _opNewRow set neither, so an
 * inline [[mrn]] token in the op-note room could never resolve — while
 * _opPatientCtx read p.mrn off the same patient a few lines earlier. */
{
  const patient = { id: 'pt-1', name: 'Ada Lovelace', dob: '03/12/1970', mrn: '7833832' };
  const L = ladder({ patients: [patient] });
  const row = { patientId: 'pt-1', appt: { name: 'Ada Lovelace', dob: '03/12/1970', patientId: 'pt-1' } };
  assert.strictEqual(L.knownValue('MRN', row), '7833832', 'MRN did not resolve from the chart patient');
  assert.strictEqual(L.knownValue('Medical record number', row), '7833832', 'the long MRN label did not resolve');

  /* and identity ownership still gates it: a NAME mismatch must yield nothing,
     not a borrowed MRN. This is the half that makes the fallback safe. */
  const wrong = { patientId: 'pt-1', appt: { name: 'Someone Else', dob: '03/12/1970', patientId: 'pt-1' } };
  assert.strictEqual(L.knownValue('MRN', wrong), '',
    'a row whose appointment names a different person got the chart patient\'s MRN');
  const noId = { patientId: '', appt: { name: 'Ada Lovelace', dob: '03/12/1970' } };
  assert.strictEqual(L.knownValue('MRN', noId), '',
    'name-only matching resolved an MRN — chartPatient requires immutable id ownership');
}

/* ---- 5. A LOGIN NAME IS NOT A CLINICAL PROVIDER IDENTITY -------------- */
/* Owner goal 2026-07-21, pinned for three surfaces by
 * provider-identity-separation-contract. _opPatientCtx was a fourth and was not
 * covered: it fell back to getName() — uns('docname'), the account display name
 * — so on any account with no Settings provider name, or with an ambiguous
 * roster (the runtime resolver returns '' on purpose there so the UI asks), the
 * person who filled in the signup form became the operating provider. */
{
  const ctxRaw = APP.slice(APP.indexOf('function _opPatientCtx('), APP.indexOf('function _opNewRow('));
  assert(ctxRaw.length > 100, '_opPatientCtx could not be bounded');
  /* Strip comments before asserting a call is ABSENT. The comment explaining WHY
     getName() was removed names getName() to do so, and a raw match on the
     commented source reports the very call the comment says is gone — a probe
     that cannot distinguish code from prose about code. */
  const ctxFn = ctxRaw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  assert(/getProviderName/.test(ctxFn) && !/reading the account display name/.test(ctxFn),
    'comment stripping either removed the code or left the prose behind');
  assert(!/\bgetName\s*\(\s*\)/.test(ctxFn),
    '_opPatientCtx is reading the account display name (getName / uns(\'docname\')) as the clinical ' +
    'provider identity again. Empty is the honest answer — the Fields box then asks and the ' +
    'readiness strip warns.');
  assert(/getProviderName\s*\(\s*\)/.test(ctxFn), '_opPatientCtx must still read the provider setting');
  assert(/getFacilityName\s*\(\s*\)/.test(ctxFn), '_opPatientCtx must still read the facility setting');
  assert(/mrn:String\(p\.mrn/.test(ctxFn), '_opPatientCtx must still carry the chart MRN');
}

/* ---- 6. THE GETTERS AND THE FIELDS BEHIND THEM EXIST ------------------ */
{
  for (const fn of ['getFacilityName', 'getFacilityAddress']) {
    assert(new RegExp('function\\s+' + fn + '\\s*\\(').test(APP),
      `${fn}() is called in three files and must be DEFINED — it was not, for the whole life of ` +
      `the op-note surface, and every call site's typeof guard hid it`);
  }
  /* a getter with no way to set it is the same gap one layer down */
  assert(/id="facilityName"/.test(APP), 'Settings has no facility field to populate the getter');
  assert(/id="facilityAddress"/.test(APP), 'Settings has no facility-address field');
  assert(/localStorage\.setItem\(uns\('facilityName'\)/.test(APP), 'the facility field is never saved');
  assert(/localStorage\.setItem\(uns\('facilityAddress'\)/.test(APP), 'the facility address is never saved');

  /* Settings must show what is STORED, not the clinic fallback — otherwise
     opening Settings once and saving copies the practice name into the facility
     key and freezes the fallback as a literal value. */
  assert(/_fac\.value=localStorage\.getItem\(uns\('facilityName'\)\)\|\|''/.test(APP),
    'the facility input hydrates from the resolved fallback rather than the stored value, so one ' +
    'Save would silently write the practice name into the facility key');

  /* and it must follow the account, like every other identity field */
  const list = APP.match(/const PREF_SYNC_KEYS=\[([\s\S]*?)\];/);
  assert(list, 'PREF_SYNC_KEYS could not be located');
  const keys = vm.runInNewContext('[' + list[1] + ']');
  for (const k of ['facilityName', 'facilityAddress']) {
    assert(keys.indexOf(k) >= 0, `${k} does not follow the account — it is an identity field like the rest`);
  }
}

/* ---- 7. THE FACILITY GETTERS NEVER GUESS ----------------------------- */
/* These shipped once WITH a fallback to the practice name and clinic address, on
 * the reasoning that a practice operating where it sees patients should not have
 * to say so twice. That was a regression, and a measured one — it is the same
 * fabrication class §1 and the assistant guard exist to remove:
 *
 *   feat_mls_opnote_prep.js's attestBlock prints
 *     'Facility: ' + (pf.facility || '[[facility_name]]')
 *   so a surgeon who operates at a hospital and had not yet filled the new field
 *   got their CLINIC asserted as the site of service on a signed operative note.
 *
 *   Worse, the readiness strip's facility check —
 *     add('facility', 'Facility', !!(apptFac || pf.facility), 'warn')
 *   — stopped firing, removing the one thing that would have told them.
 *
 * An honest blank the doctor fills beats a plausible guess they cannot see, so
 * these return ONLY what was stored. Asserted by execution in all four states. */
{
  const shimStore = new Map();
  const shim = {
    getItem: k => (shimStore.has(k) ? shimStore.get(k) : null),
    setItem: (k, v) => shimStore.set(k, String(v))
  };
  /* The practice getters are present in the context on purpose: if either facility
     getter ever reaches for them again, these fixtures make it visible rather than
     throwing an unrelated ReferenceError. */
  const gctx = { localStorage: shim, uns: s => s,
    getPracticeName: () => 'Chester County Spine Care', getClinicAddress: () => '1 Clinic Way, Malvern PA' };
  vm.createContext(gctx);
  vm.runInContext(functionBlock(APP, 'getFacilityName') + '\n' + functionBlock(APP, 'getFacilityAddress') +
    '\nthis.n = getFacilityName; this.a = getFacilityAddress;', gctx);

  assert.strictEqual(gctx.n(), '',
    'getFacilityName invented a facility from the practice name. The op note then ASSERTS a site of ' +
    'service the doctor never stated, and the readiness warning that would have caught it stops firing.');
  assert.strictEqual(gctx.a(), '',
    'getFacilityAddress invented a facility address from the clinic address');
  shim.setItem('facilityName', 'Brandywine Surgery Center');
  assert.strictEqual(gctx.n(), 'Brandywine Surgery Center', 'a configured facility must be returned');
  assert.strictEqual(gctx.a(), '', 'a named facility with no address configured must stay empty');
  shim.setItem('facilityAddress', '2 Surgery Dr, West Chester PA');
  assert.strictEqual(gctx.a(), '2 Surgery Dr, West Chester PA', 'a configured facility address must be returned');

  /* And the consequence that made this a regression, pinned where it lives: the
     readiness strip must still be ABLE to warn when nothing is configured. */
  const prep = fs.readFileSync(path.join(root, 'feat_mls_opnote_prep.js'), 'utf8');
  assert(/add\('facility', 'Facility', !!\(apptFac \|\| pf\.facility\), 'warn'\)/.test(prep),
    'the readiness strip no longer warns on a missing facility');
  assert(/'Facility: ' \+ \(pf\.facility \|\| '\[\[facility_name\]\]'\)/.test(prep),
    'the attest block no longer emits an honest blank when the facility is unknown');
}

/* ---- 7b. THE PROVIDER FALLBACK DELEGATES, AND FAILS SAFE EITHER WAY ---- */
/* Two revisions were needed here and both are worth recording.
 *
 * The first shipped refusing the account name OUTRIGHT. Too strict:
 * suPersistIdentity writes uns('docname') UNCONDITIONALLY and writes
 * uns('providerName') only when the typed name does not contradict a verified
 * roster, so "docname set, providerName empty" is a state the app deliberately
 * produces — and for those accounts the prior-auth letter went from the doctor's
 * name to "[Provider name]" while the field's own label promises it "appears on
 * signed notes".
 *
 * The second re-implemented the roster comparison HERE, with a different
 * normalizer (suProviderIdentityKey) from the one the runtime resolver uses
 * (providerIdentityKey). Two lists, two comparisons, two possible answers to
 * "who is the provider" — the exact shape of an app disagreeing with itself.
 *
 * So it now DELEGATES: getProviderName() is replaced at runtime by
 * mls-connect.js's roster-aware resolver, which already does stored-then-unique-
 * roster-match-then-empty. All that is left here is the one case that resolver
 * declines to decide — no roster at all — which is a list-length test, not an
 * identity comparison.
 *
 * That means the answer depends on WHICH getProviderName is installed, so both
 * generations are exercised: the plain stored reader that exists before the
 * bundle loads, and the real roster-aware resolver that replaces it. */
{
  function ctxFor(seed, providerNameSrc) {
    const store = new Map(Object.entries(seed || {}));
    const ctx = { String, JSON, Object, Array, console,
      localStorage: { getItem: k => (store.has(k) ? store.get(k) : null) },
      uns: s => s };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(
      functionBlock(APP, 'suProviderIdentityKey') + '\n' +
      functionBlock(APP, 'suRosterEntries') + '\n' +
      providerNameSrc + '\n' +
      functionBlock(APP, 'getName') + '\n' +
      functionBlock(APP, 'clinicalProviderName') +
      '\nthis.r = clinicalProviderName; this.g = getProviderName;', ctx);
    return ctx;
  }

  /* --- generation 1: the plain stored reader (pre-bundle) --- */
  const PLAIN = functionBlock(APP, 'getProviderName');
  const plain = seed => ctxFor(seed, PLAIN).r();

  assert.strictEqual(plain({ providerName: 'Jane A. Smith, MD', docname: 'Front Desk' }), 'Jane A. Smith, MD',
    'the explicit Practice & provider setting must always win');
  assert.strictEqual(plain({ docname: 'Jane A. Smith' }), 'Jane A. Smith',
    'with NO roster to contradict it the account name stands in — refusing it here is what regressed ' +
    'the prior-auth letter to "[Provider name]" for accounts the wizard leaves in exactly this state');
  assert.strictEqual(plain({ docname: 'Jane A. Smith', mlsSchedProviders: JSON.stringify(['Carter_Kelly_PA-C']) }), '',
    'a verified roster naming only OTHER people is the case the separation rule exists for');
  assert.strictEqual(plain({}), '', 'nothing configured must resolve empty, not to a guess');
  /* FAILS SAFE: before the bundle loads, a roster that DOES name this person
     still resolves empty, because the plain reader cannot match a roster and this
     function no longer guesses on its behalf. Empty means the UI asks. That is
     conservative, not wrong — and it is the direction a boot-order difference
     must fail in. */
  assert.strictEqual(plain({ docname: 'Jane A. Smith', mlsSchedProviders: JSON.stringify(['Smith_Jane_A_MD']) }), '',
    'pre-bundle, an unmatchable roster must fail SAFE (empty, so the UI asks) rather than assume');

  /* --- generation 2: the real roster-aware resolver that ships --- */
  const CONNECT = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
  const RUNTIME = ['S', 'unsGet', 'prettyProv', 'roster', 'accountName', 'providerIdentityKey', 'resolveProviderName']
    .map(n => functionBlock(CONNECT, n)).join('\n') +
    '\nfunction getProviderName(){ return resolveProviderName(); }';
  const live = seed => {
    const c = ctxFor(seed, RUNTIME);
    /* control: the extracted resolver really is roster-aware in this harness,
       or "it resolved" below would prove nothing about the shipped code */
    return { got: c.r(), direct: c.g() };
  };

  assert.strictEqual(live({ providerName: 'Jane A. Smith, MD' }).got, 'Jane A. Smith, MD',
    'the runtime resolver must still prefer the explicit setting');
  const matched = live({ docname: 'Jane A. Smith', mlsSchedProviders: JSON.stringify(['Smith_Jane_A_MD']) });
  assert.ok(matched.direct, 'harness control: the extracted runtime resolver did not match its own roster, ' +
    'so the assertion below would not be testing roster awareness');
  assert.strictEqual(matched.got, matched.direct,
    'once the roster-aware resolver is installed, clinicalProviderName must return exactly what IT ' +
    'resolved — delegating, not re-deciding');
  assert.ok(/smith/i.test(matched.got) && /jane/i.test(matched.got),
    'the resolved identity must be this clinician: ' + JSON.stringify(matched.got));
  assert.strictEqual(live({ docname: 'Jane A. Smith', mlsSchedProviders: JSON.stringify(['Carter_Kelly_PA-C']) }).got, '',
    'a roster naming only other people must resolve empty under the runtime resolver too');
  assert.strictEqual(live({ docname: 'Jane A. Smith' }).got, 'Jane A. Smith',
    'no roster, under either generation, means the account name is not a substitution');

  /* ONE comparison in the app, not two: this function must not carry its own
     roster identity matching any more. */
  const fn = functionBlock(APP, 'clinicalProviderName');
  assert.ok(!/suProviderIdentityKey/.test(fn),
    'clinicalProviderName re-implements the roster identity comparison with a SECOND normalizer. ' +
    'Two comparisons is how the app ends up disagreeing with itself about who the provider is — ' +
    'delegate to getProviderName, which is the roster-aware resolver at runtime.');
  assert.ok(/suRosterEntries/.test(fn),
    'it must still test whether a roster EXISTS — that is the one case the resolver declines to decide');
}

/* ---- 8. THE PIN KEY MISMATCH ----------------------------------------- */
/* fieldIdentity() derives the pin key from the token's own LABEL, so a blank
 * reading "Facility" pins under `facility` and one reading "Facility Name" pins
 * under `facility_name`. The prep context consulted only the second, so a
 * doctor who pinned the shorter label had their "use every time" ignored. */
{
  assert(/savedDefault\('facility_name'\)\s*\|\|\s*savedDefault\('facility'\)/.test(PREP),
    'the prep facility context must consult BOTH pin spellings that fieldIdentity() can produce');
  const ictx = { String };
  vm.createContext(ictx);
  vm.runInContext(functionBlock(FILL, 'S') + '\n' + functionBlock(FILL, 'fieldIdentity') +
    '\nthis.id = fieldIdentity;', ictx);
  assert.strictEqual(ictx.id('Facility'), 'facility', 'fieldIdentity no longer produces the short key');
  assert.strictEqual(ictx.id('Facility Name'), 'facility_name', 'fieldIdentity no longer produces the long key');
  assert.notStrictEqual(ictx.id('Facility'), ictx.id('Facility Name'),
    'the two spellings collapsed to one key, which would make the double lookup pointless — ' +
    'if this ever becomes true, simplify the call site rather than leaving a dead branch');
}

console.log('PASS Settings identity reaches the op note: provider name + credentials, NPI, practice ' +
  'and FACILITY all resolve automatically from the Practice & provider section (the facility rule ' +
  "was unreachable behind a hardcoded '' and had no getter or field behind it at all); the " +
  "appointment's own provider and department outrank the account defaults, including the " +
  'providerName shape the op-note room itself writes; the MRN resolves from the identity-proved ' +
  'chart patient and refuses on a name mismatch; the facility getters never invent a site of ' +
  'service from the practice, so the attest block keeps its honest blank and the readiness strip ' +
  'keeps its warning; and the account name may stand in as the provider ONLY when no verified ' +
  'roster contradicts it — the wizard\'s own rule, not a stricter one');
