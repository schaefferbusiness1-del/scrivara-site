'use strict';

/* b505 op-note workflow hardening (oni-2.12.0 / opnp-1.7.0 / onf-2.8.0):
 *  1. oni newRow carries the appointment's provider/facility scope (the base
 *     _opNewRow's 6th param) instead of silently dropping it.
 *  2. A drafted row remembers the template that produced it (_genTplId) and
 *     the status badge + save path warn when the selection has moved on.
 *  3. fillChartSlots only stamps a chart problem as the DIAGNOSIS when it
 *     overlaps the requested procedure (an unrelated comorbidity never
 *     becomes the pre-op diagnosis).
 *  4. The generation pipeline appends the opnp provider/facility attestation
 *     footer AFTER validation when the prep module is installed, and every
 *     real generation failure surfaces its actual reason on the shared
 *     __mlsLastOpFidelityError channel.
 *  5. opnp resumes an existing autosaved op-note draft on reopen (same note
 *     id — no duplicate drafts) and only for the same patient + procedure.
 *  6. onf: machine renders never count as clinician edits; the account-wide
 *     dropdown history is allowlist-gated on BOTH write and read; untouched
 *     amber suggestions are tracked for the save-review gate; deep spinal
 *     targets suggest a 3.5-inch needle, not 1.5-inch.
 *  7. ScribeFlow: op-prep modal has dialog semantics + ESC support, guard
 *     paths own the status line, and saveNoteToBackend reports sync status.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const oniSource = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
const opnpSource = fs.readFileSync(path.join(root, 'feat_mls_opnote_prep.js'), 'utf8');
const onfSource = fs.readFileSync(path.join(root, 'feat_mls_opnote_fill.js'), 'utf8');
const scribeFlow = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

async function main() {
  /* ---------------- oni runtime: newRow scope, diagnosis gate, attest, errors ---------------- */
  const tplText = [
    'PROCEDURE NOTE',
    'PATIENT:',
    'PROCEDURE: Lumbar ESI',
    'COMPLICATIONS: None.'
  ].join('\n');
  const tpl = { id: 'esi-1', name: 'Lumbar ESI', text: tplText };
  const diagTpl = { id: 'esi-2', name: 'Lumbar ESI', text: 'PROCEDURE NOTE\nPREOPERATIVE DIAGNOSIS:\nPROCEDURE: Lumbar ESI\nCOMPLICATIONS: None.' };
  const templatesArr = [tpl, diagTpl];
  const patient = { id: 'p-safe', name: 'Current Patient', dob: '1980-01-02', mrn: 'M1', problems: 'Hypertension', visits: [] };
  let responder = async () => JSON.stringify({
    note: ['PROCEDURE NOTE', 'PATIENT: Current Patient', 'PROCEDURE: Lumbar ESI', 'COMPLICATIONS: None.'].join('\n'),
    missing: []
  });
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    setTimeout, clearTimeout,
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    getTemplates() { return templatesArr; },
    getTemplateById(id) { return templatesArr.find(t => t.id === id) || null; },
    getPatients() { return [patient]; },
    getKey() { return 'k'; },
    _opDobKey(v) { return String(v || '').trim(); },
    async opPrepGenerateOne() {},
    opPrepRender() {}, toast() {},
    async aiCallRaw(sys, user, key, opts) { return responder(sys, user, key, opts); }
  };
  context.window = context;
  vm.runInNewContext(oniSource, context, { filename: 'feat_mls_opnote_integrity.js' });
  const api = context.__mlsOpNoteIntegrity;
  assert(api && api.installed && api.version === 'oni-2.15.0', 'integrity owner did not install at oni-2.15.0');

  // 1. newRow must carry appointment provider/facility scope like the base _opNewRow.
  const row = context._opNewRow('Current Patient', 'Lumbar ESI', '1980-01-02', 'July 24', 'p-safe',
    { providerId: 'prov-9', providerName: 'Scoped Provider, MD', facilityId: 'dep-9', facilityName: 'Scoped ASC' });
  assert.strictEqual(row.appt.providerName, 'Scoped Provider, MD', 'newRow dropped the appointment provider');
  assert.strictEqual(row.appt.providerId, 'prov-9', 'newRow dropped the appointment providerId');
  assert.strictEqual(row.appt.facilityName, 'Scoped ASC', 'newRow dropped the appointment facility');
  assert.strictEqual(row.appt.facilityId, 'dep-9', 'newRow dropped the appointment facilityId');
  // alternate raw shapes (department_name / provider) map too
  const row2 = context._opNewRow('N', 'r', 'd', 'ds', 'pid', { provider: 'Alt Prov', department_name: 'Alt Dept' });
  assert.strictEqual(row2.appt.providerName, 'Alt Prov');
  assert.strictEqual(row2.appt.facilityName, 'Alt Dept');

  // 2. template staleness marker: statusText/oneWrap contract is pinned at source level
  //    (the badge + stamp live inside DOM-coupled wrappers).
  assert(oniSource.includes("row._genTplId=S(row.tplId);syncTplStatus(i);"), 'oneWrap does not stamp _genTplId after a successful draft');
  assert(oniSource.includes('Re-draft to apply this template'), 'statusText has no staleness warning for a changed template');

  // 3. diagnosis relevance gate via the full pipeline: an unrelated problem must
  //    NOT fill [[preoperative_diagnosis]]; a related one must.
  responder = async () => JSON.stringify({
    note: 'PROCEDURE NOTE\nPREOPERATIVE DIAGNOSIS: [[preoperative_diagnosis]]\nPROCEDURE: Lumbar ESI\nCOMPLICATIONS: None.',
    missing: [{ key: 'preoperative_diagnosis', label: 'Preoperative diagnosis' }]
  });
  const genCtx = { patientId: 'p-safe', dob: '1980-01-02', templateId: 'esi-2' };
  const outUnrelated = await context._genOpNote('Current Patient', 'July 24, 2026', 'Lumbar ESI', diagTpl.text, genCtx);
  assert(outUnrelated.note.includes('[[preoperative_diagnosis]]'),
    'an unrelated chart problem (Hypertension) was stamped as the pre-op diagnosis: ' + outUnrelated.note);
  patient.problems = 'Lumbar radiculopathy; Hypertension';
  const outRelated = await context._genOpNote('Current Patient', 'July 24, 2026', 'Lumbar ESI', diagTpl.text, { patientId: 'p-safe', dob: '1980-01-02', templateId: 'esi-2' });
  assert(outRelated.note.includes('Lumbar radiculopathy'), 'a procedure-relevant chart problem no longer fills the diagnosis slot');
  assert(!outRelated.note.includes('[[preoperative_diagnosis]]'), 'relevant diagnosis fill left the placeholder behind');

  // 3b. oni-2.15.0 (owner: "never ask for things like patient history"): every
  //     chart-derivable slot resolves at generation — history aliases (PMH/HPI),
  //     meds, allergies, BMI — with newline chart lists joined as "; ".
  //     Empty chart data still leaves the slot (honest blank, never invented).
  patient.problems = 'Lumbar radiculopathy';
  patient.meds = 'Gabapentin 300mg TID\nMeloxicam 15mg daily';
  patient.allergies = 'Penicillin - rash';
  const richTpl = { id: 'esi-3', name: 'Lumbar ESI', text: 'PROCEDURE NOTE\nHISTORY:\nMEDICATIONS:\nALLERGIES:\nBMI:\nPROCEDURE: Lumbar ESI\nCOMPLICATIONS: None.' };
  templatesArr.push(richTpl);
  responder = async () => JSON.stringify({
    note: 'PROCEDURE NOTE\nHISTORY: [[past_medical_history]]\nMEDICATIONS: [[current_medications]]\nALLERGIES: [[allergies]]\nBMI: [[bmi]]\nPROCEDURE: Lumbar ESI\nCOMPLICATIONS: None.',
    missing: [{ key: 'past_medical_history', label: 'History' }, { key: 'current_medications', label: 'Medications' }, { key: 'allergies', label: 'Allergies' }, { key: 'bmi', label: 'BMI' }]
  });
  const rich = await context._genOpNote('Current Patient', 'July 24, 2026', 'Lumbar ESI', richTpl.text, { patientId: 'p-safe', dob: '1980-01-02', bmi: 31.2, templateId: 'esi-3' });
  assert(!/\[\[(past_medical_history|current_medications|allergies|bmi)\]\]/.test(rich.note),
    'a chart-derivable slot survived generation and would ask the doctor: ' + rich.note);
  assert(rich.note.includes('Gabapentin 300mg TID; Meloxicam 15mg daily'), 'newline med list lost its "; " separators');
  assert(rich.note.includes('Penicillin - rash'), 'allergies did not fill from the chart');
  assert(rich.note.includes('BMI: 31.2'), 'BMI did not fill from ctx');
  patient.problems = 'Hypertension'; patient.meds = ''; patient.allergies = '';

  // 3c. onf presentation: confidently-filled fields collapse; a value that is
  //     itself a placeholder can NEVER count as auto-filled (templateDefault
  //     must skip [[snake]] template values).
  assert(/details class="onf-auto"/.test(onfSource), 'auto-filled fields no longer collapse into the review expander');
  assert(onfSource.includes("kind !== 'suggested' && kind !== 'blank' && !/\\[\\[[a-z0-9_]+\\]\\]|\\[FILL:/i.test(cur)"),
    'the collapse gate no longer excludes placeholder-valued fields');
  assert(onfSource.includes("/\\[\\[[a-z0-9_]+\\]\\]/i.test(val)"), 'templateDefault accepts [[snake]] placeholders as template values again');

  // 4a. attestation: with the prep module installed, generate() appends its footer AFTER validation.
  context.__mlsOpNotePrep = { installed: true, attest: function (note, ctx) { return note + '\n\nATTEST-FOOTER ' + String(ctx && ctx.patientId || ''); } };
  responder = async () => JSON.stringify({
    note: ['PROCEDURE NOTE', 'PATIENT: Current Patient', 'PROCEDURE: Lumbar ESI', 'COMPLICATIONS: None.'].join('\n'),
    missing: []
  });
  const attested = await context._genOpNote('Current Patient', 'July 24, 2026', 'Lumbar ESI', tplText, { patientId: 'p-safe', dob: '1980-01-02', templateId: 'esi-1' });
  assert(attested.note.includes('ATTEST-FOOTER p-safe'), 'the opnp attestation footer no longer runs on the integrity path');
  assert(attested.templateFidelity && attested.templateFidelity.pass, 'attestation must append after fidelity passed, not break it');
  delete context.__mlsOpNotePrep;

  // 4b. failure surfacing: a network error must land on __mlsLastOpFidelityError.
  responder = async () => { throw new Error('Failed to fetch'); };
  context.__mlsLastOpFidelityError = '';
  let threw = null;
  try { await context._genOpNote('Current Patient', 'July 24, 2026', 'Lumbar ESI', tplText, { patientId: 'p-safe', dob: '1980-01-02', templateId: 'esi-1' }); }
  catch (e) { threw = e; }
  assert(threw, 'network failure did not reject');
  assert(String(context.__mlsLastOpFidelityError).includes('Failed to fetch'),
    'the real failure reason is not surfaced on the shared error channel: ' + context.__mlsLastOpFidelityError);

  /* ---------------- oni-2.12.0 matcher truth: word-over-code, historical strip,
     multi-procedure refusal, ESI hierarchy, junction regions, sibling guard ---------------- */
  const MLIB = [
    { id: 'tfesi', name: 'Lumbar/Sacral Transforaminal ESI', text: 'PROCEDURE: Transforaminal epidural steroid injection under fluoroscopic guidance, lumbar/sacral. 64483.' },
    { id: 'ilesi', name: 'Lumbar Interlaminar ESI', text: 'PROCEDURE: Interlaminar epidural steroid injection, loss of resistance. 62323.' },
    { id: 'cesi', name: 'Cervical Interlaminar ESI', text: 'PROCEDURE: Cervical interlaminar epidural steroid injection. C7-T1 approach. 62321.' },
    { id: 'caudal', name: 'Caudal ESI', text: 'PROCEDURE: Caudal epidural steroid injection via the sacral hiatus. 62323.' },
    { id: 'lmbb', name: 'Lumbar Medial Branch Block', text: 'PROCEDURE: Lumbar medial branch blocks under fluoroscopy. 64493.' },
    { id: 'lrfa', name: 'Lumbar Medial Branch RFA', text: 'PROCEDURE: Radiofrequency ablation of the lumbar medial branch nerves. 64635.' },
    { id: 'crfa', name: 'Cervical Medial Branch RFA', text: 'PROCEDURE: Cervical medial branch radiofrequency ablation. 64633.' },
    { id: 'si', name: 'SI Joint Injection', text: 'PROCEDURE: Sacroiliac joint injection under fluoroscopic guidance. 27096.' },
    { id: 'scstrial', name: 'SCS Trial', text: 'PROCEDURE: Spinal cord stimulator trial lead placement. 63650.' }
  ];
  const mctx = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error, setTimeout, clearTimeout,
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    getTemplates() { return MLIB; },
    getTemplateById(id) { return MLIB.find(t => t.id === id) || null; },
    getPatients() { return []; }, getKey() { return ''; },
    async opPrepGenerateOne() {}, opPrepRender() {}, toast() {}, async aiCallRaw() { return '{}'; }
  };
  mctx.window = mctx;
  vm.runInNewContext(oniSource, mctx, { filename: 'feat_mls_opnote_integrity.js' });
  const matcher = mctx.__mlsOpNoteIntegrity;
  function matched(reason) { const m = matcher.bestFor('P', reason, '1970-01-01', ''); return m.tplId || 'NOMATCH'; }
  // word evidence outranks a shared CPT inside the template body:
  assert.strictEqual(matched('Caudal epidural steroid injection'), 'caudal', 'caudal template lost to its own shared 62323 code');
  assert.strictEqual(matched('SCS trial'), 'scstrial', 'SCS trial template classified as an implant via 63650');
  // code-only reasons classify (with lumbar CPT region evidence):
  assert.strictEqual(matched('64493, 64494 bilateral'), 'lmbb', 'MBB CPT-only reason did not classify');
  assert.strictEqual(matched('27096 left'), 'si', 'SI CPT-only reason did not classify');
  assert.strictEqual(matched('64635 64636'), 'lrfa', 'lumbar RFA codes drifted (or refused) against the cervical RFA template');
  // historical mentions never steal the class from the primary procedure:
  assert.strictEqual(matched('Left L5-S1 TFESI (prior right L4-L5 MBB with relief)'), 'tfesi', 'a PRIOR MBB mention outranked the scheduled TFESI');
  // undecided rows refuse instead of guessing:
  assert.strictEqual(matched('TFESI vs MBB — decide at visit'), 'NOMATCH', 'an undecided two-procedure row auto-matched');
  assert.strictEqual(matched('Bilateral MBB L4-L5 with possible RFA to follow'), 'lmbb', 'a conditional future RFA stole the class from today\'s MBB');
  // RFA-of-the-medial-branches shorthand is ONE procedure:
  assert.strictEqual(matched('RFA B/L L4MB L5 DRB'), 'lrfa', 'RFA-of-MBB shorthand tripped the multi-procedure rule');
  // ESI hierarchy: a lone cervical ESI request may use the practice's cervical template…
  assert.strictEqual(matched('Cervical ESI'), 'cesi', 'generic cervical ESI could not use the only cervical ESI template');
  // …but a generic lumbar ESI with several lumbar candidates must refuse:
  assert.strictEqual(matched('Lumbar ESI'), 'NOMATCH', 'ambiguous generic lumbar ESI picked a specific approach');
  // junction levels span regions without a false conflict:
  assert.strictEqual(matched('Cervical interlaminar ESI C7-T1'), 'cesi', 'C7-T1 junction levels false-conflicted the cervical template');
  // typos/shorthand normalize; a typo can never flip block into RFA:
  assert.strictEqual(matched('Lumbar medial branch blcok bilateral L4-L5'), 'lmbb', 'a block typo crossed to the RFA template');
  assert.strictEqual(matched('B/L SI inj'), 'si', 'SI shorthand did not classify');
  assert.strictEqual(matched('ESI-TF R L4/5'), 'tfesi', 'ESI-TF shorthand did not classify');
  assert.strictEqual(matched('Right L5-S1 transforminal epidural steroid injection'), 'tfesi', 'transforaminal typo did not classify');
  // sided S1 ESIs are transforaminal, never caudal (caudal is midline); explicit caudal still wins:\n  assert.strictEqual(matched('B/L S1 ESI P'), 'tfesi', 'bilateral S1 ESI routed to the midline caudal template');\n  assert.strictEqual(matched('R S1 ESI/MET P'), 'tfesi', 'sided S1 ESI routed to the midline caudal template');\n  assert.strictEqual(matched('Caudal epidural steroid injection'), 'caudal', 'explicit caudal request lost its template');\n  // negation + honesty stay intact:
  assert.strictEqual(matched('No procedure performed today.'), 'NOMATCH');
  assert.strictEqual(matched('Follow-up appointment'), 'NOMATCH');

  /* ---------------- opnp runtime: attest export + draft resume ---------------- */
  const notes = [
    { id: 'n-old', patientId: 'pid-1', isDraft: true, kind: 'opnote', cc: 'Pat One — Left SI joint injection (op-note draft)', text: 'RESUMED DRAFT TEXT', updated: 500 },
    { id: 'n-other-proc', patientId: 'pid-1', isDraft: true, kind: 'opnote', cc: 'Pat One — Cervical MBB (op-note draft)', text: 'OTHER', updated: 900 },
    { id: 'n-final', patientId: 'pid-1', isDraft: false, kind: 'opnote', cc: 'Pat One — Left SI joint injection (op note)', text: 'FINAL', updated: 950 }
  ];
  const pctx = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; }, head: null, documentElement: { appendChild() {} } },
    getNotes() { return notes; },
    _opResolvePatient(name, dob, pid) { return pid === 'pid-1' ? { id: 'pid-1', name: 'Pat One' } : null; },
    getProviderName() { return 'Test Provider'; }, getProviderCred() { return 'MD'; }, getNpi() { return '1234567893'; },
    getPracticeName() { return 'Test Practice'; }, getFacilityName() { return 'Test ASC'; },
    toast() {}
  };
  pctx.window = pctx;
  vm.runInNewContext(opnpSource, pctx, { filename: 'feat_mls_opnote_prep.js' });
  const prep = pctx.__mlsOpNotePrep;
  assert(prep && prep.installed && prep.version === 'opnp-1.7.0', 'prep module did not install at opnp-1.7.0');
  assert(typeof prep.attest === 'function', 'opnp does not export the ctx-aware attest entry');

  const att = prep.attest('NOTE BODY', { provider: 'Appt Provider', providerNpi: '111', facility: 'Appt ASC' });
  assert(att.includes('Appt Provider') && att.includes('Appt ASC') && att.includes('NOTE BODY'), 'attest did not honor the enriched ctx: ' + att);
  assert(att.indexOf('PROVIDER & FACILITY') > 0, 'attest footer missing its sentinel heading');
  assert.strictEqual(prep.attest(att, {}), att, 'attest footer must be idempotent');

  // resume: same patient + same procedure adopts the EXISTING draft (id + text)…
  const rrow = { patientId: 'pid-1', appt: { name: 'Pat One', dob: '1990-01-01', reason: 'Left SI joint injection' }, proc: 'Left SI joint injection', note: '', missing: [], values: {} };
  assert.strictEqual(prep.adoptExistingDraft(rrow), true, 'existing same-procedure draft was not adopted');
  assert.strictEqual(rrow._noteId, 'n-old', 'resume picked the wrong note (must be the same-procedure DRAFT, never the finalized note)');
  assert.strictEqual(rrow.note, 'RESUMED DRAFT TEXT');
  assert.strictEqual(rrow.edited, false, 'a resumed draft must start unedited');
  // …a different procedure must NOT adopt anything.
  const rrow2 = { patientId: 'pid-1', appt: { name: 'Pat One', dob: '1990-01-01', reason: 'Right knee genicular block' }, proc: 'Right knee genicular block', note: '', missing: [], values: {} };
  assert.strictEqual(prep.adoptExistingDraft(rrow2), false, 'a different-procedure draft was wrongly adopted');
  assert(!rrow2._noteId, 'different-procedure resume must leave the row blank');

  // save-review gates are source-pinned (DOM-coupled): template-mismatch + untouched amber suggestions.
  assert(opnpSource.includes('row._genTplId && S(row.tplId) !== S(row._genTplId)'), 'opPrepSave has no template-mismatch check');
  assert(opnpSource.includes('_onfSuggestedPending'), 'opPrepSave does not consult untouched machine suggestions');
  assert(opnpSource.includes('blockUnsavedSwitch'), 'day/mode switch has no unsaved-content guard');

  /* ---------------- onf source pins: edit flag, history gates, needle depth ---------------- */
  assert(onfSource.includes("var VERSION = 'onf-2.10.0'"), 'onf version did not move');
  assert(/wasEdited = row \? !!row\.edited : false;[\s\S]{0,400}row\.edited = wasEdited;/.test(onfSource),
    'writeRendered no longer restores the clinician edit flag around machine renders');
  assert(onfSource.includes('if (val && defaultEligible(label) && scopedKey'), 'account dropdown-history write is not allowlist-gated');
  assert(/function priorValues\(label\) \{[\s\S]{0,400}if \(!defaultEligible\(label\)\) return \[\];/.test(onfSource),
    'account dropdown-history read is not allowlist-gated');
  assert(onfSource.includes('_onfSuggestedPending'), 'untouched amber suggestions are not tracked');
  assert(onfSource.includes("_onfReviewed = true"), 'explicit accept buttons do not mark the row reviewed');
  // deep spinal target → 3.5-inch leads; superficial keeps 1.5-inch.
  assert(/deep\) return \['25-gauge, 3\.5-inch'/.test(onfSource), 'deep spinal targets no longer lead with the 3.5-inch needle');

  /* ---------------- ScribeFlow pins: a11y, honest status, sync status ---------------- */
  assert(scribeFlow.includes('id="opPrepModal" role="dialog" aria-modal="true" aria-labelledby="opPrepHdr"'),
    'op-prep modal lost its dialog semantics');
  assert(scribeFlow.includes("if(!m||!m.classList.contains('show')) return;\n    if(e.key==='Escape'||e.key==='Esc'){ e.preventDefault(); e.stopImmediatePropagation(); closeOpPrep(); return; }"),
    'op-prep ESC-to-close handler is missing');
  assert(scribeFlow.includes('Couldn’t draft '+"'+row.appt.name+'"+'’s op note'), 'draft failure no longer names the row/reason');
  assert(scribeFlow.includes("window.__mlsLastOpFidelityError||''"), 'draft failure does not read the shared error channel');
  /* synctruth-1.0.0 (owner 2026-07-24): saveNoteToBackend still reports its
     status, but 'synced' is now reserved for a real 2xx — a 402/403 refusal
     reports 'declined' instead of masquerading as a backup. */
  assert(scribeFlow.includes("if(r.ok){ _pendingBackupRemove(rec.id); _svrDeclinedRemove(rec.id); return 'synced'; }"),
    'saveNoteToBackend no longer reports sync status on a real success');
  assert(scribeFlow.includes("return 'declined';"),
    'saveNoteToBackend must report a server refusal honestly instead of calling it synced');
  assert(scribeFlow.includes('label class="mini" for="opPrepProc_'), 'procedure input lost its label association');

  console.log('PASS op-note workflow hardening: appointment provider/facility carried, template staleness remembered, diagnosis relevance gated, attestation restored, real failure reasons surfaced, drafts resume without duplicates, machine fills are not clinician edits, cross-patient history gated, deep-target needle default, dialog a11y + honest sync status');
}

main().catch(e => { console.error('FAIL', e && e.message || e); process.exit(1); });
