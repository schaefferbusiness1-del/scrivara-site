'use strict';

/* ptedit-1.0.0 (2026-08-28) — a wrong date of birth could not be corrected.
 *
 * savePatient() has ALWAYS carried a correct edit branch:
 *
 *     let p = editingPtId ? findPatient(editingPtId) : null;
 *
 * but `editingPtId` had exactly two assignments in the entire codebase - the
 * declaration and a reset - and BOTH were null. Nothing ever put a patient id in
 * it, so the branch was unreachable and every save minted a brand new record.
 * "Editing" a patient silently created a duplicate, which then fed the very
 * duplicate problem the owner also asked to have fixed.
 *
 * The fix is the missing assignment, not a new save path. These are executed
 * properties, not greps:
 *   1. editPatient() must actually SET editingPtId to the patient's id
 *   2. it must prefill all four editable fields from the existing record
 *   3. a missing patient must not open an edit modal at all
 *   4. changing identity fields on a chart with a landed Athena pull must WARN,
 *      because the coverage receipt binds to p.id only and nothing invalidates it
 *      when demographics change
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];

function lift(src, name, kw) {
  const decl = (kw || 'function ') + name + '(';
  const i = src.indexOf(decl);
  assert.ok(i >= 0, 'missing ' + name);
  const j = src.indexOf('{', i);
  let d = 0, e = -1;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  assert.ok(e > 0, 'unbalanced ' + name);
  return src.slice(i, e);
}

let lanes = 0;
for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  lanes++;
  const src = fs.readFileSync(file, 'latin1');

  /* ---- the ORIGINAL defect: editingPtId must receive a real id somewhere ---- */
  const assigns = [...src.matchAll(/editingPtId\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  ok(assigns.length >= 2, shell + ': editingPtId assignments vanished');
  ok(assigns.some(v => v !== 'null'),
    shell + ': EVERY assignment to editingPtId is still null - the edit branch of savePatient is ' +
    'unreachable and editing a patient still mints a duplicate instead of correcting it');

  /* ---- 1 + 2 + 3. execute editPatient ---- */
  function runEdit(found) {
    const fields = { ptName: { value: 'X' }, ptMrn: { value: 'X' }, ptSex: { value: 'X' }, ptDob: { value: 'X' }, patientModalTitle: { textContent: '' } };
    const toasts = [];
    let opened = 0;
    const api = new Function('findPatient', 'toast', 'newPatient', 'document',
      'let editingPtId=null;\n' + lift(src, 'editPatient') +
      '\nreturn { editPatient: editPatient, id: function(){ return editingPtId; } };'
    )(
      () => found,
      (m, k) => toasts.push(String(k || '') + ':' + String(m)),
      () => { opened++; },
      { getElementById: id => fields[id] || null }
    );
    api.editPatient('pt-1');
    return { fields, toasts, opened, id: api.id() };
  }

  {
    const r = runEdit({ id: 'pt-1', name: 'Jane Q Roe', mrn: '556677', sex: 'F', dob: '1972-03-04' });
    eq(r.id, 'pt-1',
      shell + ': editPatient did NOT set editingPtId - savePatient will mint a new record instead ' +
      'of editing this one');
    eq(r.opened, 1, shell + ': editPatient did not open the modal exactly once');
    eq(r.fields.ptName.value, 'Jane Q Roe', shell + ': name not prefilled');
    eq(r.fields.ptDob.value, '1972-03-04', shell + ': DATE OF BIRTH not prefilled - the field the owner asked to be editable');
    eq(r.fields.ptMrn.value, '556677', shell + ': MRN not prefilled');
    eq(r.fields.ptSex.value, 'F', shell + ': sex not prefilled');
    ok(/Edit/.test(r.fields.patientModalTitle.textContent),
      shell + ': the modal still says "New patient" while editing - the doctor cannot tell it will ' +
      'not create a duplicate');
  }

  /* an empty record must NOT open an edit modal */
  {
    const r = runEdit(null);
    eq(r.opened, 0, shell + ': editPatient opened a modal for a patient that does not exist');
    eq(r.id, null, shell + ': editPatient bound editingPtId to a missing patient');
    ok(r.toasts.some(t => /err/.test(t)), shell + ': a missing patient failed silently');
  }

  /* ---- 4. identity change on a landed chart must warn ---- */
  const save = lift(src, 'savePatient', 'async function ');
  ok(/_athenaChartLanded\(p\)/.test(save),
    shell + ': savePatient does not check whether the chart has a landed Athena pull before an ' +
    'identity change');
  ok(/await\s+mlsConfirm\(/.test(save),
    shell + ': an identity change on a pulled chart is not confirmed - the coverage receipt binds ' +
    'to p.id only and would keep attesting data read for the OLD details');
  ok(/date of birth/.test(save), shell + ': the DOB is not named in the identity-change warning');
  ok(/return;/.test(save.slice(save.indexOf('mlsConfirm'))),
    shell + ': declining the identity-change warning does not abort the save');

  /* ---- the control must be reachable from the chart ---- */
  ok(/onclick="editActivePatient\(\)"/.test(src),
    shell + ': there is no Edit control on the profile card - the edit path is unreachable again');
  ok(/function editActivePatient\(/.test(src), shell + ': editActivePatient is not defined');
}

ok(lanes > 0, 'no shells found - this suite tested nothing');
console.log('PASS patient-demographics-are-editable: ' + checks + ' checks across ' + lanes +
  ' shell(s) - editPatient binds editingPtId to a real record and prefills name/DOB/MRN/sex, a ' +
  'missing patient opens nothing, and changing identity on a pulled chart is confirmed first');
