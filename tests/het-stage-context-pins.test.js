'use strict';
/* het-1.0.0 pins: THE WRITE DRIVER QUALIFIES ATHENACLINICALS STAGE SURFACES
 * WITHOUT LOOSENING ONE IDENTITY GATE.
 *
 * OLD BYTES FAIL BY NAME: the candidate loop required the patient banner and
 * the note editor in the SAME frame, so every write on the stage UI (banner
 * and editor split across frames) refused no-encounter-frame with the editor
 * open (live 2026-08-25, encounter meta present, editor present).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bg = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'background.js'), 'latin1');

/* the stage-context reader exists with its uniqueness refusals */
assert.ok(bg.includes('function hetStageEncounterContext(frame, expectedPatient) {'),
  'the stage-context reader is gone - stage surfaces cannot qualify again');
assert.ok(bg.includes('if (metas.length !== 1) return null;'),
  'the one-context-META uniqueness refusal is gone');
assert.ok(bg.includes('if (!encId || encId.length < 3 || !metaPatient || !wantMrn || metaPatient !== wantMrn) return null;'),
  'the meta patient_id === expected MRN gate is gone - a foreign chart could qualify');
assert.ok(bg.includes('if (appts.length !== 1) return null;'),
  'the unique-appointment refusal is gone');
assert.ok(bg.includes('if (provs.length !== 1) return null;'),
  'the unique-credentialed-provider refusal is gone');
assert.ok(bg.includes('if (dates.length !== 1) return null;'),
  'the unique-service-date refusal is gone');

/* ancestor-only banner inheritance, judged by the SAME gates */
assert.ok(bg.includes('hetStage = hetStageEncounterContext(fr, expectedPatient);'),
  'the candidate loop no longer consults the stage context');
assert.ok(bg.includes('hetAncWin = fr.w && fr.w.parent && fr.w.parent !== fr.w ? fr.w.parent : null;'),
  'the ancestor-frame walk is gone - identity inheritance lost its frame-chain restriction');
assert.ok(bg.includes('if (!observedIdentity) hetStage = null;'),
  'a stage frame with no ancestor banner no longer fails closed');
/* the classic identity gates still run verbatim on whatever identity was found */
assert.ok(bg.includes('if (nameKey(observedIdentity.name) !== nameKey(expectedPatient.name) || dateKey(observedIdentity.dob) !== dateKey(expectedPatient.dob)) { sawOtherPatient = true; continue; }'),
  'the name/DOB identity gate changed - the wrong-chart guarantee moved');
assert.ok(bg.includes('if (wantMrn && digits(observedIdentity.mrn) !== wantMrn) { sawOtherPatient = true; continue; }'),
  'the MRN identity gate changed - the wrong-chart guarantee moved');

/* the three observed-context sources prefer the machine-typed stage values,
   classic sources untouched otherwise */
assert.ok(bg.includes('var eid = hetStage ? hetStage.encounterId : encounterIdFor(fr, targetRoot, observedIdentity.root);'),
  'the encounter-id source seam is gone');
assert.ok(bg.includes('var observedAppointmentId = hetStage ? hetStage.appointmentId : appointmentIdFor(fr, targetRoot, observedIdentity.root);'),
  'the appointment-id source seam is gone');
assert.ok(bg.includes('var encounterMeta = hetStage ? { root: targetRoot, visitDate: hetStage.visitDate, provider: hetStage.provider } : encounterMetadataFor(fr, targetRoot, observedIdentity.root);'),
  'the visit-metadata source seam is gone');

/* the downstream equality gates still stand for both paths */
assert.ok(bg.includes('if (dateKey(expectedContext.visitDate) && encounterMeta.visitDate !== dateKey(expectedContext.visitDate)) continue;'),
  'the expected-visit-date equality gate changed');
assert.ok(bg.includes('if (norm(expectedContext.provider) && norm(encounterMeta.provider) !== norm(expectedContext.provider)) continue;'),
  'the expected-provider equality gate changed');
assert.ok(bg.includes("if (digits(expectedContext.appointmentId) && observedAppointmentId !== digits(expectedContext.appointmentId)) continue;"),
  'the expected-appointment equality gate changed');

/* behavioral: the three uniqueness regexes, extracted from the SHIPPED bytes
   and executed against live-shaped fixtures (escaped + plain serializations,
   a non-credentialed DisplayName decoy, a dated ScheduledDate object) */
const helperStart = bg.indexOf('function hetStageEncounterContext');
const helper = bg.slice(helperStart, helperStart + 3200);
const rex = (helper.match(/hetUniq\(\/(.+?)\/g/g) || []).map(s => new RegExp(s.slice(9, -2), 'g'));
assert.strictEqual(rex.length, 3, 'expected exactly three hetUniq regexes in the helper');
const fix = 'x\\"AppointmentID\\":\\"55816420\\"y' + '"AppointmentID":"55816420"'
  + ',"DisplayName":"Matthew Schaeffer, MD","DisplayName":"POSM CL West Chester",'
  + '"ScheduledDate":{"__CLASS__":"DateTime","Date":"2026-08-25T16:25:43-04:00"}';
const appts = [...new Set([...fix.matchAll(rex[0])].map(m => m[1]))];
assert.deepStrictEqual(appts, ['55816420'], 'the appointment regex no longer resolves one id across both serializations');
const provs = [...new Set([...fix.matchAll(rex[1])].map(m => m[1]).filter(v => /,\s*(?:MD|DO|PA-C|CRNP|NP|DPM)\s*$/.test(v)))];
assert.deepStrictEqual(provs, ['Matthew Schaeffer, MD'], 'the provider regex + credential filter no longer isolate the one clinician');
const dates = [...new Set([...fix.matchAll(rex[2])].map(m => m[1]))];
assert.deepStrictEqual(dates, ['2026-08-25'], 'the labeled-date regex no longer resolves the one service date');

console.log('PASS het stage-context pins: stage frames qualify only through the machine-typed context META + ancestor banner, every uniqueness refusal and identity/equality gate stands, and the shipped regexes resolve live-shaped serializations');
