'use strict';
/* MLS Assist 3.0.139 — metabind-1.0.0: a clinical frame whose machine-typed athena meta names the requested
 * patient (patient_id digits === requested MRN digits) is bound by athena itself (Door 4). Executes the real
 * reader's meta parse against synthetic documents, executes the real binding gate with the other doors
 * stubbed shut, and pins the receipt field. MRN supports, never vetoes. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* 1. the meta parse, lifted verbatim from the primary reader and run against fake documents */
const mpStart = bg.indexOf("              var mp = ''; try { var ms = document.querySelectorAll('meta');");
ok(mpStart > 0, 'primary reader carries the meta parse');
const mpLine = bg.slice(mpStart, bg.indexOf('\n', mpStart)).trim();
eq(bg.split("var mp = ''; try { var ms = document.querySelectorAll('meta');").length - 1, 2, 'both injected readers (primary and retry) carry the same parse');
function parseWith(metas) {
  const document = { querySelectorAll: () => metas.map((c) => ({ getAttribute: (k) => (k === 'content' ? c : null) })) };
  return new Function('document', mpLine + '\nreturn mp;')(document);
}
eq(parseWith(['[{"encounter_id":"750001","patient_id":"7833832"}]']), '7833832', 'patient_id digits are read');
eq(parseWith(['[{"encounter_id":"750001","patient_id":7833832}]']), '7833832', 'a numeric patient_id is read');
eq(parseWith(['description text', '[{"encounter_id":"1","patient_id":"P-99"}]']), '99', 'only digits survive');
eq(parseWith(['[{"encounter_id":"750001"}]']), '', 'a meta without patient_id yields nothing');
eq(parseWith(['{not json']), '', 'a malformed meta yields nothing and does not throw');
eq(parseWith([]), '', 'no meta yields nothing');

/* 2. Door 4 in the real binding gate: the exact-MRN branch, lifted and executed with the other doors shut */
const gateStart = bg.indexOf('          const frameBoundToTarget = (f) => {');
const gateEnd = bg.indexOf('          };', gateStart);
ok(gateStart > 0 && gateEnd > gateStart, 'binding gate present');
const gate = bg.slice(gateStart, gateEnd + '          };'.length);
ok(gate.includes("if (wantMrn && f.mp && f.mp.length >= 4 && f.mp === String(wantMrn).replace(/\\D/g, '')) { metaBoundClinicalFrames++; return true; }"), 'Door 4 requires exact digit equality with the requested MRN');
ok(gate.indexOf('identityMatchesTarget(frameIdentity[f.frameId])') < gate.indexOf('f.mp === String(wantMrn)'), 'the banner identity door still runs first');
function runGate(f, wantMrn) {
  const src = 'let metaBoundClinicalFrames = 0;\n' + gate + '\nreturn { bound: frameBoundToTarget(f), meta: metaBoundClinicalFrames };';
  return new Function('f', 'want', 'wantDob', 'wantMrn', 'identityMatchesTarget', 'frameIdentity', 'frameUrlBindsAppointment', 'textHasPairStrict', 'textHasDobStrict', 'textHasMrnStrict', '__apptRowDoor', 'ident',
    src)(f, 'A B', '1/2/1990', wantMrn, () => false, {}, () => false, () => false, () => false, () => false, () => false /* apptrowdob-1.1.0 door closed here */, null);
}
let r = runGate({ frameId: 3, u: 'https://x/ax/encounter/1/exam', t: 'Assessment Plan', mp: '7833832' }, '7833832');
eq(r.bound, true, 'a frame whose meta names the requested MRN is bound'); eq(r.meta, 1, 'and counted');
r = runGate({ frameId: 3, u: '', t: 'Assessment Plan', mp: '7833833' }, '7833832');
eq(r.bound, false, 'a different meta patient never binds'); eq(r.meta, 0, 'and is not counted');
r = runGate({ frameId: 3, u: '', t: 'Assessment Plan', mp: '' }, '7833832');
eq(r.bound, false, 'no meta, no binding (the other doors decide)');
r = runGate({ frameId: 3, u: '', t: 'Assessment Plan', mp: '7833832' }, '');
eq(r.bound, false, 'no requested MRN, Door 4 is inert');
r = runGate({ frameId: 3, u: '', t: 'Assessment Plan', mp: '123' }, '123');
eq(r.bound, false, 'a short id is never an MRN');

/* 3. the receipt carries the count and the mapper carries the field */
ok(bg.includes("boundClinicalFrames: chosenStrict.length, unboundClinicalFrames: unboundClinicalFrames, metaBoundClinicalFrames: metaBoundClinicalFrames,"), 'receipt names the meta-bound frames');
ok(bg.includes("reason: x.reason || '', mp: String(x.mp || '').replace(/\\D/g, '') };"), 'the raw-frame mapper carries mp as digits only');
console.log('PASS metabind-30139-runtime: ' + checks + ' checks');
