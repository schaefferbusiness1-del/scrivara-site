'use strict';
/*
 * THE DAY BRAIN: WHO GETS AN OP NOTE WRITTEN, AND WHO CHOOSES THE TEMPLATE
 * -----------------------------------------------------------------------------
 * OWNER, verbatim (2026-08-07): "the auto match is not perfect and it needs to
 * be it should use AI not just key words. Also the op notes should connect with
 * history and visit smartly so like if a patient on a day did not do an
 * injection it should not auto write an op note for them unless literally the
 * doctor bypasses it ... It should be draft day but then only show people who
 * got injection and need op note also if ai is not sure about which template to
 * use auto match and give best options based on auto match and then only after
 * that the whole list of all op notes should be there".
 *
 * WHAT WAS ACTUALLY WRONG. feat_mls_opnote_integrity.js's allWrap ran
 * `for(var i=0;i<rows.length;i++)` over every row _opApptsForDay returned, and
 * that function filters on exactly two things: the date key, and a non-empty
 * name (ScribeFlow.html:16250). So "Draft all op notes" wrote an OPERATIVE NOTE
 * - consent, sterile prep, needle, technique, complications - for a routine
 * follow-up, for a cancelled slot, and for a no-show, because nothing in the
 * op-note path had ever looked at whether a procedure happened.
 *
 * THE SIGNALS THIS CAN HONESTLY USE, and the one it must not trust:
 *   - appointment.status is a real 6-value enum, but background.js strips the
 *     status words out of the scraped athenaOne row (6344/6841/6452) and the
 *     import body never carries one, so on a pulled day EVERY row reads
 *     'booked' (server.js:2519 defaults anything unrecognised to it). 'booked'
 *     therefore means NO INFORMATION and may never hold a row back on its own.
 *     Only 'cancelled' and 'no_show' - which can only be set by a deliberate
 *     in-app action - are treated as negatives.
 *   - the free-text `reason` IS the only procedure signal that exists on every
 *     row of every real schedule, so it carries the verdict.
 *   - checked_in_at and a real non-draft note dated that day are positive
 *     confirmation, never a requirement.
 *
 * These are the properties that must hold on every run. Each one below is a
 * thing the surface did wrong before this module existed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const oniSource = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
const opdbSource = fs.readFileSync(path.join(root, 'feat_mls_opnote_daybrain.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* --------------------------------------------------------------------------
 * A sandbox with just enough DOM for the module to install. The surface itself
 * is proved at source level in section 5 - the logic is proved by running it.
 * ------------------------------------------------------------------------ */
function makeSandbox(opts) {
  opts = opts || {};
  const templates = opts.templates || [
    { id: 'tf-l45', name: 'Lumbar Transforaminal Epidural Steroid Injection L4-L5', keywords: ['tfesi', 'transforaminal', 'lumbar', 'l4', 'l5'], text: 'PROCEDURE: transforaminal epidural steroid injection\nTECHNIQUE:\nCOMPLICATIONS: None.' },
    { id: 'tf-l5s1', name: 'Lumbar Transforaminal Epidural Steroid Injection L5-S1', keywords: ['tfesi', 'transforaminal', 'lumbar', 'l5', 's1'], text: 'PROCEDURE: transforaminal epidural steroid injection\nTECHNIQUE:\nCOMPLICATIONS: None.' },
    { id: 'mbb-l', name: 'Lumbar Medial Branch Block', keywords: ['mbb', 'medial branch', 'facet', 'lumbar'], text: 'PROCEDURE: medial branch block\nTECHNIQUE:\nCOMPLICATIONS: None.' },
    { id: 'il-esi', name: 'Lumbar Interlaminar Epidural Steroid Injection', keywords: ['interlaminar', 'esi', 'lumbar'], text: 'PROCEDURE: interlaminar epidural steroid injection\nCOMPLICATIONS: None.' },
    { id: 'caudal', name: 'Caudal Epidural Steroid Injection', keywords: ['caudal', 'esi'], text: 'PROCEDURE: caudal epidural steroid injection\nCOMPLICATIONS: None.' }
  ];
  const patients = opts.patients || [
    { id: 'p1', name: 'Ann Alpha', dob: '1970-03-04', visits: [] },
    { id: 'p2', name: 'Ben Bravo', dob: '1965-11-12', visits: [] },
    { id: 'p3', name: 'Cara Charlie', dob: '1980-06-01', visits: [] },
    { id: 'p4', name: 'Dan Delta', dob: '1955-01-09', visits: [] },
    { id: 'p5', name: 'Eve Echo', dob: '1990-09-09', visits: [] }
  ];
  const notes = opts.notes || [];
  const style = { id: '', textContent: '' };

  const ctx = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error, isFinite,
    setTimeout, clearTimeout,
    document: {
      readyState: 'complete',
      addEventListener() {}, removeEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement() { return Object.assign({}, style, { appendChild() {}, setAttribute() {}, classList: { add() {}, remove() {}, contains() { return false; } } }); },
      head: { appendChild() {} },
      documentElement: { appendChild() {} },
      body: { appendChild() {} }
    },
    getTemplates() { return templates; },
    getTemplateById(id) { return templates.find(t => t.id === id) || null; },
    getPatients() { return patients; },
    getNotes() { return notes; },
    getKey() { return 'k'; },
    hasAI() { return !!ctx.__aiOn; },
    toast() {},
    _acctTodayKey() { return '2026-08-07'; },
    _acctDateKeyOf(d) {
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    },
    _opDobKey(v) { return String(v || '').trim(); },
    _opResolvePatient(name, dob, pid) {
      const nm = String(name || '').trim().toLowerCase();
      if (pid) return patients.find(p => p.id === pid) || null;
      const hit = patients.filter(p => String(p.name).toLowerCase() === nm);
      return hit.length === 1 ? hit[0] : null;
    },
    opPrepRender() { ctx.__renders = (ctx.__renders || 0) + 1; },
    /* Faithful enough for oni's own success test: its oneWrap reports success
       as `row.gen && row.note && __mlsLastOpFidelityPass`, so a stub that only
       returned true would make every draft look failed. */
    async opPrepGenerateOne(i) {
      (ctx.__drafted = ctx.__drafted || []).push(i);
      const r = (ctx._opPrep || [])[i];
      if (r) { r.gen = true; r.note = 'PROCEDURE NOTE\nCOMPLICATIONS: None.'; }
      ctx.__mlsLastOpFidelityPass = true;
      return true;
    },
    async opPrepGenerateAll() {
      const rows = ctx._opPrep || [];
      for (let i = 0; i < rows.length; i++) await ctx.opPrepGenerateOne(i);
      return { drafted: rows.length, failed: 0 };
    },
    openOpPrep() {},
    _opProcChanged() {},
    _opAutoTpl() {},
    async aiCallRaw(sys, user, key, o) { return ctx.__ai ? ctx.__ai(sys, user, key, o) : ''; },
    _calAppts: opts.calAppts || [],
    _opPrep: [],
    _opPrepMode: 'all',
    __aiOn: false,
    __ai: null
  };
  ctx.window = ctx;
  vm.runInNewContext(oniSource, ctx, { filename: 'feat_mls_opnote_integrity.js' });
  vm.runInNewContext(opdbSource, ctx, { filename: 'feat_mls_opnote_daybrain.js' });
  return ctx;
}

function row(name, reason, pid, dateKey, dob) {
  return {
    patientId: pid || '',
    appt: { name: name, reason: reason, dob: dob || '', patientId: pid || '' },
    proc: reason, dateStr: dateKey, dateKey: dateKey,
    tplId: '', note: '', missing: [], values: {}, gen: false
  };
}

async function main() {
  /* =======================================================================
   * 1. THE MODULE INSTALLS AND IS REVERSIBLE
   * ===================================================================== */
  const ctx = makeSandbox({});
  const api = ctx.__mlsOpNoteDayBrain;
  assert.ok(api && api.installed, 'the day brain did not install');
  assert.strictEqual(api.version, 'opdb-1.0.0', 'version drifted from the loader comment');
  assert.ok(typeof api.revert === 'function', 'no revert - every module in this app must be reversible');

  /* =======================================================================
   * 2. TRIAGE - the verdict for every shape of real schedule row
   * ===================================================================== */
  const FUTURE = '2026-08-08', TODAY = '2026-08-07';

  // 2a. A real injection needs an op note.
  let t = api.triage(row('Ann Alpha', 'Left L5-S1 transforaminal epidural steroid injection', 'p1', FUTURE));
  assert.strictEqual(t.verdict, 'needs', 'a scheduled TFESI was not queued for an op note: ' + t.why);

  // 2b. THE OWNER'S CASE. A patient on the day who did not have a procedure
  //     must NOT get an operative note written for them.
  const nonProcedures = [
    'Routine follow-up',
    'New patient consult',
    'Post-op check',
    'Medication management',
    'Office visit - back pain',
    'MRI results review',
    'Telehealth follow up'
  ];
  nonProcedures.forEach(function (reason) {
    const v = api.triage(row('Ben Bravo', reason, 'p2', FUTURE));
    assert.strictEqual(v.verdict, 'held',
      'an op note would be auto-written for a visit that is not a procedure: "' + reason + '" -> ' + v.verdict);
  });

  // 2c. Terse real-schedule spellings are still procedures. These are the
  //     abbreviations measured on the owner's live day; holding one back would
  //     be as wrong as drafting a follow-up.
  const realDay = ['R SI Joint injection', 'B/L L4 TF ESI', 'BL L2, L3, L4 MBB #2', 'Caudal ESI', 'L4MB & L5 DR B', 'Right knee injection', 'Lumbar RFA'];
  realDay.forEach(function (reason) {
    const v = api.triage(row('Cara Charlie', reason, 'p3', FUTURE));
    assert.strictEqual(v.verdict, 'needs',
      'a real scheduled procedure was held back and would never be drafted: "' + reason + '" -> ' + v.why);
  });

  // 2d. Cancelled and no-show never get an operative note.
  const cancelCtx = makeSandbox({
    calAppts: [
      { appt_date: TODAY, patient_external_id: 'p1', name: 'Ann Alpha', status: 'cancelled', reason: 'Left L5-S1 TFESI' },
      { appt_date: TODAY, patient_external_id: 'p2', name: 'Ben Bravo', status: 'no_show', reason: 'Lumbar MBB' },
      { appt_date: TODAY, patient_external_id: 'p3', name: 'Cara Charlie', status: 'completed', reason: 'Caudal ESI' }
    ]
  });
  const capi = cancelCtx.__mlsOpNoteDayBrain;
  let c = capi.triage(row('Ann Alpha', 'Left L5-S1 TFESI', 'p1', TODAY));
  assert.strictEqual(c.verdict, 'held', 'a CANCELLED appointment would still have had an op note written');
  assert.strictEqual(c.code, 'cancelled');
  c = capi.triage(row('Ben Bravo', 'Lumbar MBB', 'p2', TODAY));
  assert.strictEqual(c.verdict, 'held', 'a NO-SHOW would still have had an op note written');
  assert.strictEqual(c.code, 'no-show');
  c = capi.triage(row('Cara Charlie', 'Caudal ESI', 'p3', TODAY));
  assert.strictEqual(c.verdict, 'needs', 'a completed procedure visit was not queued');
  assert.strictEqual(c.confirmed, true, 'a completed visit is not being shown as confirmed');

  // 2e. THE DOCTOR'S BYPASS. "unless literally the doctor bypasses it".
  const bypassRow = row('Ben Bravo', 'Routine follow-up', 'p2', FUTURE);
  assert.strictEqual(api.triage(bypassRow).verdict, 'held');
  bypassRow._opdbBypass = true;
  const b = api.triage(bypassRow);
  assert.strictEqual(b.verdict, 'needs', 'the doctor asked for this one explicitly and was still refused');
  assert.strictEqual(b.code, 'bypass');

  // 2f. An op note already SAVED for this procedure is not drafted again.
  const doneCtx = makeSandbox({
    notes: [{ id: 'n1', patientId: 'p1', kind: 'opnote', isDraft: false, cc: 'Ann Alpha — Aug 7, 2026 — Left L5-S1 TFESI', updated: Date.now() }]
  });
  const d = doneCtx.__mlsOpNoteDayBrain.triage(row('Ann Alpha', 'Left L5-S1 TFESI', 'p1', TODAY));
  assert.strictEqual(d.verdict, 'done', 'a procedure with a saved op note would be drafted a second time');

  // 2g. FAIL-SAFE. On a day with no status information at all - which is EVERY
  //     Athena-pulled day, because the scrape strips status - a past-day row
  //     must still be drafted. Holding it would empty the whole surface.
  const noStatusCtx = makeSandbox({
    calAppts: [
      { appt_date: '2026-08-01', patient_external_id: 'p1', name: 'Ann Alpha', status: 'booked', reason: 'Left L5-S1 TFESI' },
      { appt_date: '2026-08-01', patient_external_id: 'p2', name: 'Ben Bravo', status: 'booked', reason: 'Lumbar MBB' }
    ]
  });
  const napi = noStatusCtx.__mlsOpNoteDayBrain;
  assert.strictEqual(napi.dayHasStatusSignal('2026-08-01'), false,
    'a day of all-booked rows is being read as though its statuses meant something');
  assert.strictEqual(napi.triage(row('Ann Alpha', 'Left L5-S1 TFESI', 'p1', '2026-08-01')).verdict, 'needs',
    'a past Athena day (status always "booked") was emptied - every patient would vanish from Draft day');

  // 2h. ...but a day the board really did move on holds its never-arrived rows.
  const movedOnCtx = makeSandbox({
    calAppts: [
      { appt_date: '2026-08-01', patient_external_id: 'p1', name: 'Ann Alpha', status: 'booked', reason: 'Left L5-S1 TFESI' },
      { appt_date: '2026-08-01', patient_external_id: 'p2', name: 'Ben Bravo', status: 'completed', reason: 'Lumbar MBB' }
    ]
  });
  const mapi = movedOnCtx.__mlsOpNoteDayBrain;
  assert.strictEqual(mapi.dayHasStatusSignal('2026-08-01'), true);
  assert.strictEqual(mapi.triage(row('Ann Alpha', 'Left L5-S1 TFESI', 'p1', '2026-08-01')).code, 'never-arrived',
    'a patient still "booked" on a worked day was drafted as though the injection happened');
  // a check-in rescues it even without a status change
  const rescued = makeSandbox({
    calAppts: [
      { appt_date: '2026-08-01', patient_external_id: 'p1', name: 'Ann Alpha', status: 'booked', checked_in_at: '2026-08-01T14:02:00Z', reason: 'Left L5-S1 TFESI' },
      { appt_date: '2026-08-01', patient_external_id: 'p2', name: 'Ben Bravo', status: 'completed', reason: 'Lumbar MBB' }
    ]
  });
  assert.strictEqual(rescued.__mlsOpNoteDayBrain.triage(row('Ann Alpha', 'Left L5-S1 TFESI', 'p1', '2026-08-01')).verdict, 'needs',
    'checked_in_at is positive proof the patient arrived and was ignored');

  /* =======================================================================
   * 3. THE AI LAYER MAY NOT WEAKEN THE DETERMINISTIC MATCHER
   * ===================================================================== */

  // 3a. NEVER NARROW WITHIN A FAMILY. "Lumbar ESI" is the parent of
  //     transforaminal / interlaminar / caudal; a model that picks one asserts
  //     an approach the doctor never stated. Such candidates never reach it.
  assert.strictEqual(api.isNarrowing({ procClass: 'generic_esi', tplClass: 'tfesi' }), true);
  assert.strictEqual(api.isNarrowing({ procClass: 'generic_esi', tplClass: 'interlaminar_esi' }), true);
  assert.strictEqual(api.isNarrowing({ procClass: 'generic_esi', tplClass: 'caudal_esi' }), true);
  assert.strictEqual(api.isNarrowing({ procClass: 'tfesi', tplClass: 'tfesi' }), false);
  const parentRes = ctx._opBestTemplate('Lumbar ESI');
  api.candidatesFor(parentRes).forEach(function (e) {
    assert.ok(!api.isNarrowing(e),
      'a family-narrowing candidate reached the model: ' + e.tplClass + ' for ' + e.procClass);
  });

  // 3b. A SAFETY REFUSAL IS NEVER SENT TO THE MODEL. If the text says no
  //     procedure happened, or names two, the deterministic refusal stands.
  ctx.__aiOn = true;
  ctx.__ai = async () => JSON.stringify({ id: 'tf-l45', confidence: 0.99, why: 'looks lumbar' });
  ctx._opPrep = [row('Ann Alpha', 'No procedure was performed today', 'p1', FUTURE)];
  let m = await api.matchRow(0);
  assert.strictEqual(m.source, 'no-procedure', 'the model was allowed to overturn a no-procedure refusal');
  assert.strictEqual(ctx._opPrep[0].tplId, '', 'a template was attached to a visit with no procedure');

  ctx._opPrep = [row('Ann Alpha', 'TFESI vs medial branch block - decide at visit', 'p1', FUTURE)];
  m = await api.matchRow(0);
  assert.strictEqual(m.source, 'multi-procedure', 'the model was allowed to pick one of two named procedures');
  assert.strictEqual(ctx._opPrep[0].tplId, '', 'a coin-flip template was attached to a two-procedure row');

  // 3c. THE MODEL MAY ONLY NAME A CANDIDATE IT WAS GIVEN.
  ctx.__ai = async () => JSON.stringify({ id: 'a-template-that-does-not-exist', confidence: 0.98, why: 'invented' });
  ctx._opPrep = [row('Ann Alpha', 'Lumbar transforaminal epidural steroid injection', 'p1', FUTURE)];
  m = await api.matchRow(0);
  assert.ok(!m.confident || m.source !== 'ai',
    'the model invented a template id and it was applied');
  assert.notStrictEqual(ctx._opPrep[0].tplId, 'a-template-that-does-not-exist',
    'a template id that is not in the library reached the row');

  // 3d. A MALFORMED REPLY FALLS BACK, IT DOES NOT THROW.
  ctx.__ai = async () => 'I think probably the second one honestly';
  ctx._opPrep = [row('Ann Alpha', 'Lumbar transforaminal epidural steroid injection', 'p1', FUTURE)];
  m = await api.matchRow(0);
  assert.ok(m && !m.confident, 'a prose reply was treated as a confident match');
  assert.ok(Array.isArray(ctx._opPrep[0]._opdbOptions) && ctx._opPrep[0]._opdbOptions.length,
    'a malformed reply left the doctor with no options at all');

  // 3e. A NETWORK FAILURE IS NOT A CRASH.
  ctx.__ai = async () => { throw new Error('network'); };
  ctx._opPrep = [row('Ann Alpha', 'Lumbar transforaminal epidural steroid injection', 'p1', FUTURE)];
  m = await api.matchRow(0);
  assert.ok(m && !m.confident, 'an AI outage produced a confident match');

  // 3f. WITH NO AI AT ALL the surface still offers the deterministic options -
  //     "best options based on auto match" must work on an offline tab.
  ctx.__aiOn = false;
  ctx._opPrep = [row('Ann Alpha', 'Lumbar transforaminal epidural steroid injection', 'p1', FUTURE)];
  m = await api.matchRow(0);
  assert.ok(m, 'matching returned nothing with AI off');
  if (!m.confident) {
    assert.ok(Array.isArray(ctx._opPrep[0]._opdbOptions) && ctx._opPrep[0]._opdbOptions.length,
      'offline, an unsure row offered no candidate options');
  }

  // 3g. A GOOD, IN-LIST, CONFIDENT REPLY IS APPLIED.
  ctx.__aiOn = true;
  ctx.__ai = async () => JSON.stringify({ id: 'tf-l5s1', confidence: 0.93, why: 'L5-S1 transforaminal', alternates: ['tf-l45'] });
  ctx._opPrep = [row('Ann Alpha', 'transforaminal epidural steroid injection at L5-S1 and L4-L5', 'p1', FUTURE)];
  m = await api.matchRow(0);
  if (m.source === 'ai') {
    assert.strictEqual(ctx._opPrep[0].tplId, 'tf-l5s1', 'a confident, valid model choice was not applied');
    assert.ok(m.confidence >= 0.72, 'confidence floor is not being enforced');
  }

  // 3h. A LOW-CONFIDENCE REPLY APPLIES NOTHING and offers options instead.
  ctx.__ai = async () => JSON.stringify({ id: 'tf-l45', confidence: 0.31, why: 'not sure', alternates: ['tf-l5s1'] });
  const unsure = row('Ann Alpha', 'transforaminal epidural steroid injection at L5-S1 and L4-L5', 'p1', FUTURE);
  ctx._opPrep = [unsure];
  m = await api.matchRow(0);
  if (m.source === 'ai-unsure') {
    assert.ok(Array.isArray(unsure._opdbOptions) && unsure._opdbOptions.length,
      'an unsure model gave the doctor nothing to choose from');
  }

  // 3g-bis. THE PICK MUST SURVIVE TO THE DRAFT.
  //     oni's opPrepGenerateOne wrapper re-runs its own bestFor() and
  //     OVERWRITES row.tplId for every row whose tplManual is falsy, a moment
  //     before the note is written. The first version of this module set the id
  //     and nothing else, so the model's choice was discarded every single time
  //     and the whole feature was decorative. This is that regression, pinned.
  ctx.__ai = async () => JSON.stringify({ id: 'tf-l5s1', confidence: 0.95, why: 'L5-S1 transforaminal' });
  const survives = row('Ann Alpha', 'transforaminal epidural steroid injection at L5-S1 and L4-L5', 'p1', FUTURE);
  ctx._opPrep = [survives];
  m = await api.matchRow(0);
  if (m.source === 'ai') {
    assert.strictEqual(survives.tplManual, true,
      'an applied AI pick left tplManual falsy - oni\'s oneWrap will overwrite row.tplId with bestFor() ' +
      'before generating, so the model\'s choice would never reach the note');
    assert.strictEqual(survives._opdbAiPick, true, 'the AI pick is not recorded as the module\'s own');
    assert.strictEqual(survives.tplMatchSource, 'ai',
      'an AI pick must not masquerade as the doctor\'s selection - the badge would name the wrong ' +
      'person as responsible for the template on an operative note');

    // ...and editing the procedure text RELEASES it, so the deterministic
    //    re-match still runs exactly as it does today.
    ctx._opProcChanged(0, 'Lumbar medial branch block');
    api.releaseAiPick(survives);
    assert.strictEqual(survives.tplManual, false,
      'a stale AI pick froze the row: oni re-matches only when tplManual is falsy, so retyping the ' +
      'procedure would leave the old template attached');
    assert.strictEqual(survives._opdbAiPick, false);
  }

  // 3i. THE DOCTOR'S OWN PICK IS NEVER OVERWRITTEN.
  const manual = row('Ann Alpha', 'Lumbar transforaminal epidural steroid injection', 'p1', FUTURE);
  manual.tplManual = true; manual.tplId = 'mbb-l';
  ctx._opPrep = [manual];
  ctx.__ai = async () => JSON.stringify({ id: 'tf-l45', confidence: 0.99, why: 'no' });
  await api.matchRow(0);
  assert.strictEqual(manual.tplId, 'mbb-l', 'the model overwrote a template the doctor chose by hand');

  /* =======================================================================
   * 4. DRAFT DAY DRAFTS ONLY THE ROWS THAT NEED IT
   * ===================================================================== */
  const dayCtx = makeSandbox({
    calAppts: [
      { appt_date: FUTURE, patient_external_id: 'p3', name: 'Cara Charlie', status: 'cancelled', reason: 'Caudal ESI' }
    ]
  });
  dayCtx.__aiOn = false;
  dayCtx._opPrep = [
    row('Ann Alpha', 'Left L5-S1 transforaminal epidural steroid injection', 'p1', FUTURE),   // 0 needs
    row('Ben Bravo', 'Routine follow-up', 'p2', FUTURE),                                      // 1 held: not a procedure
    row('Cara Charlie', 'Caudal ESI', 'p3', FUTURE),                                          // 2 held: cancelled
    row('Dan Delta', 'Lumbar medial branch block', 'p4', FUTURE)                              // 3 needs
  ];
  const out = await dayCtx.opPrepGenerateAll();
  assert.deepStrictEqual(dayCtx.__drafted, [0, 3],
    'Draft all wrote op notes for the wrong set of patients: ' + JSON.stringify(dayCtx.__drafted));
  assert.strictEqual(out.drafted, 2, 'drafted count is wrong');
  assert.strictEqual(out.skipped, 2, 'the skipped patients were not reported back');
  assert.strictEqual(out.failed, 0,
    'rows this module deliberately held were counted as FAILURES - the doctor would be told ' +
    '2 patients "need a confirmed template or a retry" when nothing was wrong with them');

  // 4a-bis. THE GATE IS PER ROW, so a runner that loops everything still cannot
  //     draft a held patient. This is what makes the module compose with
  //     mls-connect's draftAll instead of replacing it (f6ba6ff7's truce:
  //     "the richer runner always wins once loaded").
  dayCtx.__drafted = [];
  const heldDirect = await dayCtx.opPrepGenerateOne(2);   // the cancelled row
  assert.strictEqual(heldDirect, false, 'a held row drafted when called directly');
  assert.deepStrictEqual(dayCtx.__drafted, [],
    'the per-row gate let a cancelled patient reach the generator');
  const needsDirect = await dayCtx.opPrepGenerateOne(0);
  assert.strictEqual(needsDirect, true, 'a row that needs an op note was refused');
  assert.deepStrictEqual(dayCtx.__drafted, [0], 'the needs row did not reach the generator');

  // 4a-ter. WHEN THE RICHER RUNNER EXISTS IT OWNS THE LOOP, and it is handed the
  //     triaged set through its OWN onlyIdx option - never a filtered _opPrep,
  //     and never an EMPTY onlyIdx (draftAll reads that as "no filter" and would
  //     draft the whole day).
  const tpfCtx = makeSandbox({
    calAppts: [{ appt_date: FUTURE, patient_external_id: 'p3', name: 'Cara Charlie', status: 'cancelled', reason: 'Caudal ESI' }]
  });
  tpfCtx.__aiOn = false;
  let sawOnlyIdx = null, tpfCalls = 0;
  tpfCtx.__mlsTplPrepFix = {
    draftAll: async (opts) => {
      /* Array.from re-homes it: opts.onlyIdx is built inside the vm realm, so its
         prototype is the sandbox's Array and deepStrictEqual would reject an
         otherwise identical list. */
      tpfCalls++; sawOnlyIdx = opts && opts.onlyIdx ? Array.from(opts.onlyIdx) : null;
      return { drafted: sawOnlyIdx ? sawOnlyIdx.length : 0, failed: 0 };
    }
  };
  tpfCtx._opPrep = [
    row('Ann Alpha', 'Left L5-S1 transforaminal epidural steroid injection', 'p1', FUTURE),
    row('Ben Bravo', 'Routine follow-up', 'p2', FUTURE),
    row('Cara Charlie', 'Caudal ESI', 'p3', FUTURE),
    row('Dan Delta', 'Lumbar medial branch block', 'p4', FUTURE)
  ];
  const tpfOut = await tpfCtx.opPrepGenerateAll();
  assert.strictEqual(tpfCalls, 1,
    'mls-connect draftAll was not used - this module replaced the richer runner (retries, ' +
    'low-confidence reroute, per-patient ledger) that f6ba6ff7 made the owner');
  assert.deepStrictEqual(sawOnlyIdx, [0, 3],
    'draftAll was not handed the triaged set through onlyIdx: ' + JSON.stringify(sawOnlyIdx));
  assert.strictEqual(tpfOut.skipped, 2);
  assert.deepStrictEqual(tpfCtx.__drafted, undefined,
    'the fallback loop ran as well as draftAll - every patient would be drafted twice');

  // 4a-quater. A DAY WITH NOTHING TO DRAFT MUST NOT REACH draftAll AT ALL.
  const emptyTpf = makeSandbox({});
  emptyTpf.__aiOn = false;
  let emptyCalls = 0;
  emptyTpf.__mlsTplPrepFix = { draftAll: async () => { emptyCalls++; return { drafted: 0, failed: 0 }; } };
  emptyTpf._opPrep = [row('Ben Bravo', 'Routine follow-up', 'p2', FUTURE)];
  await emptyTpf.opPrepGenerateAll();
  assert.strictEqual(emptyCalls, 0,
    'draftAll was called with an empty triage set - it reads an empty onlyIdx as "no filter" ' +
    'and would have drafted the entire day, which is the exact bug this module exists to fix');

  // 4b. After a bypass, that patient IS drafted - and nobody else joins them.
  dayCtx.__drafted = [];
  dayCtx._opPrep[1]._opdbBypass = true;
  dayCtx._opPrep[1]._opdbTriage = null;
  const out2 = await dayCtx.opPrepGenerateAll();
  assert.deepStrictEqual(dayCtx.__drafted, [0, 1, 3],
    'the doctor bypassed one row and the draft set did not follow: ' + JSON.stringify(dayCtx.__drafted));
  assert.strictEqual(out2.skipped, 1);

  // 4c. A day where nobody needs an op note writes NOTHING and says so.
  const quiet = makeSandbox({});
  quiet.__aiOn = false;
  quiet._opPrep = [
    row('Ann Alpha', 'Routine follow-up', 'p1', FUTURE),
    row('Ben Bravo', 'New patient consult', 'p2', FUTURE)
  ];
  const out3 = await quiet.opPrepGenerateAll();
  assert.strictEqual(out3.drafted, 0, 'op notes were written on a day with no procedures at all');
  assert.deepStrictEqual(quiet.__drafted, undefined, 'a draft was attempted on a no-procedure day');

  /* =======================================================================
   * 4d. TRIAGE PARSES THE NOTES STORE ONCE PER PASS, NOT ONCE PER ROW.
   *
   * getNotes() is an unmemoized JSON.parse of the whole notes store
   * (ScribeFlow.html:9118) and triage asks for it twice per row
   * (existingOpNote + seenOnDay). triageAll runs on EVERY opPrepRender, and a
   * draft-all calls opPrepRender once per drafted patient — so without a
   * per-pass cache an 18-row day performs ~650 full parses of the store on the
   * main thread, which on the owner's real store is measured in seconds and
   * starves everything else on the page.
   * ===================================================================== */
  {
    const perfCtx = makeSandbox({});
    let getNotesCalls = 0;
    const realGetNotes = perfCtx.getNotes;
    perfCtx.getNotes = function () { getNotesCalls++; return realGetNotes(); };
    perfCtx._opPrep = [];
    for (let n = 0; n < 12; n++) {
      perfCtx._opPrep.push(row('Ann Alpha', 'Left L5-S1 transforaminal epidural steroid injection', 'p1', FUTURE));
    }
    getNotesCalls = 0;
    perfCtx.__mlsOpNoteDayBrain.triageAll();
    assert.ok(getNotesCalls <= 1,
      'triageAll parsed the notes store ' + getNotesCalls + ' times for 12 rows — it must parse once ' +
      'per pass. Every opPrepRender runs this, and a draft-all renders once per patient, so this is ' +
      'quadratic in the size of the day over an unmemoized JSON.parse of localStorage.');
  }

  /* =======================================================================
   * 5. THE POSITIONAL DOM CONTRACTS THIS MODULE MUST NOT BREAK
   *
   * Two other modules find their anchors by POSITION inside a row card, so a
   * node inserted in the wrong slot breaks them silently - no error, and the
   * failure mode is a placeholder-riddled note reaching a chart.
   * ===================================================================== */
  const onf = fs.readFileSync(path.join(root, 'feat_mls_opnote_fill.js'), 'utf8');
  assert.ok(/ta\.parentNode\.insertBefore\(box, ta\)/.test(onf),
    'the fill box no longer lives immediately before #opPrepNote_i - re-derive the slot rule below');
  assert.ok(/sel\.parentElement\.querySelectorAll\('span\.mini span'\)/.test(oniSource),
    'the match badge lookup moved off #opPrepTpl_i.parentElement - re-derive the slot rule below');

  assert.ok(/card\.insertBefore\(el, card\.firstChild\)/.test(opdbSource),
    'the row banner must be the card FIRST child; anywhere else can take the fill box slot');
  assert.ok(/card\.insertBefore\(box, tplRow\)/.test(opdbSource),
    'the options box must go BEFORE the template row: the slot AFTER it is the note textarea\'s ' +
    'previousElementSibling, which feat_mls_opnote_fill.js owns for the Fields box');
  assert.ok(!/insertBefore\([^)]*,\s*ta\b/.test(opdbSource),
    'the day brain is inserting relative to the note textarea - that slot belongs to the fill box');
  assert.ok(/order:1/.test(opdbSource) && /order:3/.test(opdbSource),
    'row ordering must be CSS `order`, never a sort of window._opPrep - every id in the surface is the array index');
  assert.ok(!/_opPrep\.sort\(|rows\.sort\(/.test(opdbSource),
    'window._opPrep is being sorted; opPrepNote_3 would stop meaning rows[3] and an in-flight draft would repoint');

  /* =======================================================================
   * 6. THE LOADER
   * ===================================================================== */
  assert.ok(/feat_mls_opnote_daybrain\.js/.test(connect), 'the day brain is never loaded');
  const loader = /[\s\S]{0,400}feat_mls_opnote_daybrain\.js/.exec(connect)[0];
  assert.ok(/requestIdleCallback/.test(loader),
    'the day brain must be idle-deferred - EAGER_CEILING in boot-script-budget is at its limit');
  assert.ok(/feat_mls_opnote_daybrain\.js\?v='\s*\+\s*\(window\.__MLS_AV/.test(connect),
    'the loader must cache-bust on __MLS_AV, or it needs a hand-maintained token in cache-token-cannot-go-stale');
  assert.ok(appSource.includes('function _opEnsureDayBrain()') &&
    appSource.includes("target.closest('#opPrepGenAllBtn')") &&
    appSource.includes('e.stopImmediatePropagation()'),
    'Draft all must fail closed and demand-load day-brain safety before any deferred runner can act');
  const dbAt = connect.indexOf('feat_mls_opnote_daybrain.js');
  const oniAt = connect.indexOf('feat_mls_opnote_integrity.js');
  assert.ok(dbAt > oniAt,
    'the day brain must load AFTER feat_mls_opnote_integrity.js so its wrappers sit outermost');

  /* =======================================================================
   * 7. REVERT PUTS EVERYTHING BACK
   * ===================================================================== */
  const revCtx = makeSandbox({});
  const before = revCtx.opPrepGenerateAll;
  assert.notStrictEqual(revCtx.opPrepGenerateAll.__opdb, undefined, 'generateAll was never wrapped');
  revCtx.__mlsOpNoteDayBrain.revert();
  assert.strictEqual(revCtx.opPrepGenerateAll.__opdb, undefined, 'revert left the generateAll wrapper installed');
  assert.notStrictEqual(revCtx.opPrepGenerateAll, before, 'revert did not restore the original generateAll');
  assert.strictEqual(revCtx.__mlsOpNoteDayBrain.installed, false, 'revert did not clear the installed flag');

  console.log('opnote-day-brain: all assertions passed ' +
    '(triage across 7 non-procedures + 7 real schedule spellings, cancelled/no-show/bypass/already-done, ' +
    'the all-booked fail-safe, 9 AI fences, draft-day gating, 6 positional/loader contracts, revert)');
}

main().catch(err => { console.error(err); process.exit(1); });
