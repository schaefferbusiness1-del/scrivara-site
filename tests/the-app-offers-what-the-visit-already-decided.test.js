'use strict';

/* THREE MORE PLACES THE APP ASKED FOR WHAT IT HELD (b829)
 *
 * 1. THE REFERRAL LETTER made the doctor retype a consultant they had entered
 *    minutes earlier. generateReferral() opened with:
 *
 *        mlsPrompt('Refer to which specialty / consultant? …', 'Specialist')
 *
 *    — the default being the literal word "Specialist". Meanwhile this visit's
 *    referral ORDER carries it: ORDER_DEFS.referral's first field is
 *    {key:'specialty', label:'Specialty / provider', req:1}, so a referral order in
 *    currentOrders always has one. The prior-auth panel in the same file already
 *    makes exactly this move (populatePaServiceSelect builds its picker from this
 *    visit's orders).
 *
 * 2. THE DICTATED LETTER left the recipient blank for "Primary care doctor" and
 *    "Referring doctor", so the salutation degraded to "Dear Colleague:" and the fax
 *    cover sheet printed "TO:    __________" — while p.history.pcp, the field
 *    literally labelled "PCP / referring provider", holds it, parsed out of the
 *    Athena chart and persisted like every other field.
 *
 * 3. FOUR PREFERENCES the doctor sets once and the app forgot per device.
 *
 * THE CARE EACH NEEDS, and what this suite is really pinning:
 *
 *   - A PREFILL MUST NOT BECOME A DECISION. mlsPrompt's second argument is an
 *     editable value, so a prefilled consultant is a suggestion. The letter
 *     recipient is different: it is a box on a form that gets FAXED, so it must
 *     never overwrite what the doctor typed, and must never fight them afterwards.
 *   - AN ATTORNEY IS NOT THE PCP. Prefilling a non-medical recipient's box with a
 *     doctor's name is a wrong-recipient hazard on a letter that leaves the
 *     practice. Asserted per recipient type, not in aggregate.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const APP = read('ScribeFlow.html');
const DL = read('feat_mls_dictate_letter.js');

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
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* ---- 1. THE REFERRAL DEFAULT, EXECUTED --------------------------------- */
const REF = (() => {
  const at = APP.indexOf('const _refDefault=(function(){');
  assert(at > 0, 'the referral default is no longer resolved from the visit');
  let depth = 0, quote = '', esc = false, line = false, comment = false, start = APP.indexOf('{', at);
  for (let i = start; i < APP.length; i++) {
    const ch = APP[i], next = APP[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (comment) { if (ch === '*' && next === '/') { comment = false; i++; } continue; }
    if (quote) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { comment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return APP.slice(at + 'const _refDefault='.length, i + 1) + ')()';
  }
  throw new Error('unterminated _refDefault');
})();

function refDefault(orders, patient) {
  const ctx = { String, console };
  ctx.currentOrders = orders || [];
  ctx.activePatient = () => patient || null;
  vm.createContext(ctx);
  return vm.runInContext('(' + REF.replace(/\)\(\)$/, ')') + ')()', ctx);
}

{
  /* THE PROMPT MUST ACTUALLY USE IT. Executing _refDefault alone left a mutation
     that reverted the mlsPrompt call to the literal 'Specialist' ALIVE — the
     resolver sat there correct and uncalled, which is the same shape that survived
     in the b820 identity suite. Assert the consumer, not just the helper. */
  const promptLine = APP.split('\n').find((l) => l.includes("'Refer to which specialty / consultant?"));
  assert(promptLine, 'the referral prompt line was not found');
  assert(/,\s*_refDefault\s*\)/.test(promptLine),
    'generateReferral() still passes a hardcoded default to mlsPrompt, so the consultant resolved from ' +
    'this visit\'s order is computed and never used. Line: ' + promptLine.trim());
  assert(!/,\s*'Specialist'\s*\)/.test(promptLine),
    'the literal \'Specialist\' is still the prompt default. Line: ' + promptLine.trim());

  const ord = (spec) => ({ id: 'o1', type: 'referral', fields: { specialty: spec, reason: 'r' } });
  assert.strictEqual(refDefault([ord('Neurosurgery — Dr. Lee')]), 'Neurosurgery — Dr. Lee',
    'the consultant the doctor entered in this visit\'s referral order still does not prefill the letter');
  /* most recent referral wins — a visit can contain two */
  assert.strictEqual(refDefault([ord('Cardiology'), ord('Neurosurgery — Dr. Lee')]), 'Neurosurgery — Dr. Lee',
    'with two referral orders the MOST RECENT must win; the doctor is writing about the one just added');
  /* a non-referral order must not be mistaken for one */
  assert.strictEqual(refDefault([{ type: 'imaging', fields: { specialty: 'MRI lumbar' } }]), 'Specialist',
    'an IMAGING order\'s field was read as a referral consultant — order types are not interchangeable');
  /* the chart PCP is the second rung */
  assert.strictEqual(refDefault([], { history: { pcp: 'Dr. Amara Osei' } }), 'Dr. Amara Osei',
    'with no referral order the chart\'s PCP should stand in — it is the field labelled "PCP / referring provider"');
  assert.strictEqual(refDefault([ord('Cardiology')], { history: { pcp: 'Dr. Amara Osei' } }), 'Cardiology',
    'the visit\'s own referral order must outrank the chart PCP');
  /* and the old literal survives as the last resort */
  for (const [why, orders, pt] of [
    ['nothing at all', [], null],
    ['empty specialty', [ord('')], null],
    ['whitespace specialty', [ord('   ')], null],
    ['no fields object', [{ type: 'referral' }], null],
    ['null order in the list', [null], null],
    ['patient with no history', [], {}],
    ['blank pcp', [], { history: { pcp: '  ' } }]
  ]) {
    assert.strictEqual(refDefault(orders, pt), 'Specialist',
      why + ': the default must fall back to the original literal, never to an empty prompt');
  }
  assert.doesNotThrow(() => refDefault(null, null), 'a null order list throws — that kills the referral button');
}

/* ---- 2. THE LETTER RECIPIENT, EXECUTED PER TYPE ------------------------ */
{
  const wire = block(DL, 'function applyType()');
  const chart = block(DL, 'function chartPcp()');
  assert(/typeSel\.value === 'pcp' \|\| typeSel\.value === 'referring'/.test(strip(wire)),
    'the recipient prefill is not restricted to the two MEDICAL recipient types. An attorney is not the ' +
    'PCP, and prefilling their box with a doctor\'s name is a wrong-recipient hazard on a letter that ' +
    'leaves the practice.');

  function run(type, pcp, existingValue, touched) {
    const box = { value: existingValue || '', _attrs: {},
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      removeAttribute(k) { delete this._attrs[k]; } };
    const ctx = { String, console };
    ctx.S = (x) => (x == null ? '' : String(x));
    ctx.activePt = () => ({ history: { pcp: pcp } });
    ctx.RECIPIENTS = { pcp: { clinicalDefault: true }, referring: { clinicalDefault: true },
      attorney: { clinicalDefault: false }, other: { clinicalDefault: false } };
    ctx.typeSel = { value: type };
    ctx.clin = { checked: false };
    ctx.nameBox = box;
    ctx.nameTouched = !!touched;
    vm.createContext(ctx);
    vm.runInContext(chart + '\n' + wire + '\napplyType();', ctx);
    return { value: box.value, clinical: ctx.clin.checked, auto: box.getAttribute('data-mlsdl-auto') };
  }

  const PCP = 'Dr. Amara Osei';
  assert.strictEqual(run('pcp', PCP).value, PCP,
    'a letter to the Primary care doctor still leaves the recipient blank, so the salutation degrades to ' +
    '"Dear Colleague:" and the fax cover sheet prints "TO:    __________"');
  assert.strictEqual(run('referring', PCP).value, PCP, 'the Referring doctor type must prefill too');

  /* THE HAZARD: a non-medical recipient must NOT get a doctor's name */
  for (const type of ['attorney', 'other']) {
    assert.strictEqual(run(type, PCP).value, '',
      'the ' + type + ' recipient box was prefilled with the PCP\'s name. That is a wrong-recipient hazard ' +
      'on a letter that gets faxed out of the practice.');
  }

  /* IT MUST NEVER OVERWRITE THE DOCTOR, and must stop fighting them once touched */
  assert.strictEqual(run('pcp', PCP, 'Dr. Someone Else', true).value, 'Dr. Someone Else',
    'a name the doctor typed was overwritten by the prefill');
  assert.strictEqual(run('pcp', PCP, 'Dr. Someone Else', false).value, 'Dr. Someone Else',
    'a value already in the box was overwritten even though this function did not put it there');
  /* switching type away and back may replace only what the prefill itself wrote */
  const auto = run('pcp', PCP);
  assert.strictEqual(auto.auto, '1', 'the prefill does not mark its own value, so it cannot tell it apart later');

  /* the existing behaviour of applyType must survive */
  assert.strictEqual(run('pcp', PCP).clinical, true, 'applyType lost its clinical-default toggle for pcp');
  assert.strictEqual(run('attorney', PCP).clinical, false, 'applyType lost its clinical-default toggle for attorney');

  /* nothing throws when the chart has no PCP or no patient */
  for (const pcp of ['', null, undefined, '   ']) {
    assert.doesNotThrow(() => run('pcp', pcp), 'a chart with no PCP threw: ' + JSON.stringify(pcp));
    assert.strictEqual(run('pcp', pcp).value, '', 'an absent PCP must leave the box empty, not print undefined');
  }
}

/* ---- 3. THE FOUR PREFERENCES NOW TRAVEL ------------------------------- */
{
  for (const f of ['ScribeFlow.html', 'ScribeFlow-staging.html']) {
    const src = read(f);
    const at = src.indexOf('const PREF_SYNC_KEYS=');
    assert(at > 0, f + ': PREF_SYNC_KEYS not found');
    const blk = strip(src.slice(at, src.indexOf('];', at)));
    const keys = [...blk.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const k of ['opNoteTemplateMode', 'ez3PortalAskOff', 'qolGroupProc', 'navfeat_orders']) {
      assert(keys.includes(k), f + ': ' + k + ' still does not follow the doctor across devices');
    }
    /* the deliberate exclusions, pinned so they read as decisions */
    assert(!keys.includes('pullVisitBodies'),
      f + ': pullVisitBodies was added. Its label does promise account scope, but it is a schedule-PULL ' +
      'setting and that path is fenced off — it is recorded in coordination/outbox/012 instead.');
    for (const k of ['navLayout', 'qolPtLayout']) {
      assert(!keys.includes(k),
        f + ': ' + k + ' was added. Left-rail vs top-bar and split vs stacked are plausibly ' +
        'screen-size-appropriate per device, so syncing them could make a laptop worse. If that call is ' +
        'being reversed, do it deliberately and say so here.');
    }
    /* nothing that was already synced was dropped. Checked per shell, because the
       two allowlists have PRE-EXISTING DRIFT that this change did not create and
       must not paper over: staging lacks facilityAddress, facilityName,
       googleBusinessUrl, noteModel, opFieldDefaultsUserV1 and studio_widgets, and
       carries legalEnabled which production does not. Asserting parity here would
       have failed for a reason unrelated to this change - it did, on the first run -
       so the drift is named rather than asserted away. */
    const CORE = f === 'ScribeFlow.html'
      ? ['practiceName', 'providerName', 'docspec', 'noteModel', 'opFieldDefaultsUserV1', 'facilityName']
      : ['practiceName', 'providerName', 'docspec'];
    for (const k of CORE) {
      assert(keys.includes(k), f + ': the previously-synced key ' + k + ' was lost while adding four more');
    }
  }
}

/* ---- 4. THE SHELL DRIFT IS NAMED, NOT HIDDEN --------------------------
   Found while adding the four keys: the two allowlists disagree, and have for some
   time. Six keys the doctor's production account syncs do NOT sync on staging. That
   is not this change's doing and is not fixed here - staging's own parity contract
   (tests/opnote-staging-parity-runtime.test.js) is the right owner - but an
   undocumented divergence in which preferences follow a doctor is worth a failing
   test the day somebody widens it. */
{
  const kOf = (f) => {
    const src = read(f);
    const at = src.indexOf('const PREF_SYNC_KEYS=');
    return [...strip(src.slice(at, src.indexOf('];', at))).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  const prod = kOf('ScribeFlow.html'), stg = kOf('ScribeFlow-staging.html');
  const missing = prod.filter((k) => !stg.includes(k)).sort();
  assert.deepStrictEqual(missing,
    ['facilityAddress', 'facilityName', 'googleBusinessUrl', 'noteModel', 'opFieldDefaultsUserV1', 'studio_widgets'],
    'the production/staging PREF_SYNC_KEYS drift CHANGED. It was these six. If a key was added to ' +
    'production without staging, add it to both or update this list deliberately: this assertion exists so ' +
    'the gap is a decision rather than an accident.\n  now missing from staging: ' + missing.join(', '));
}

console.log('PASS the app offers what the visit already decided: the referral letter defaulted to the ' +
  'literal word "Specialist" while this visit\'s referral order carried the consultant (most-recent wins, ' +
  'chart PCP second, seven fallback shapes still yielding the original literal, an imaging order refused); ' +
  'the dictated letter left the recipient blank for the two medical types though p.history.pcp holds it — ' +
  'prefilled per type so an ATTORNEY never receives a doctor\'s name, never overwriting what the doctor ' +
  'typed, and marking its own value so it can tell it apart; and four workflow preferences now follow the ' +
  'doctor across devices, with pullVisitBodies and the two layout keys pinned as deliberate exclusions');
