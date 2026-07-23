'use strict';

/* b500 op-note workflow hardening (oni-2.10.0 / opnp-1.7.0 / onf-2.8.0):
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
  assert(api && api.installed && api.version === 'oni-2.10.0', 'integrity owner did not install at oni-2.10.0');

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
  assert(onfSource.includes("var VERSION = 'onf-2.8.0'"), 'onf version did not move');
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
  assert(scribeFlow.includes("_pendingBackupRemove(rec.id); return 'synced';"), 'saveNoteToBackend no longer reports sync status');
  assert(scribeFlow.includes('label class="mini" for="opPrepProc_'), 'procedure input lost its label association');

  console.log('PASS op-note workflow hardening: appointment provider/facility carried, template staleness remembered, diagnosis relevance gated, attestation restored, real failure reasons surfaced, drafts resume without duplicates, machine fills are not clinician edits, cross-patient history gated, deep-target needle default, dialog a11y + honest sync status');
}

main().catch(e => { console.error('FAIL', e && e.message || e); process.exit(1); });
