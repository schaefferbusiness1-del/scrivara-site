'use strict';

/* THE THREE PATIENT-FACING PAGES NAME THE PRACTICE THEY BELONG TO (b806)
 *
 * patient-portal.html resolved the practice entirely from two sources that do
 * not exist on a patient's device:
 *
 *   localStorage "mlsEasyBook"  — written only on the DOCTOR's machine
 *   window.MLS_OFFICE           — assigned NOWHERE in the repo
 *
 * so `office().practice` was ALWAYS the literal "your care team" and
 * `office().phone` was ALWAYS empty, for every real patient, forever. Fifteen
 * patient-visible strings degrade off those two values, and seven of them tell
 * the patient to go ask that unnamed practice for something. /api/patient/me was
 * already being called on load and the session already identified the practice.
 * It was simply never asked.
 *
 * intake.html — a form the doctor sends to their OWN patients — showed the
 * vendor's mark, said "your care team", and told the patient to "contact the
 * clinic" with no number, because /api/intake/public/:token returned `{ok:true}`
 * and nothing else while resolving the clinician server-side the whole time.
 *
 * appointment.html says "call the office" in four places and could not say which
 * office or on what number, while clinicPhone sat in Settings.
 *
 * These are TOLERANCE assertions as much as wiring ones: each page must still
 * render exactly as before when the server sends no practice object, because a
 * page that hard-requires a field the deployed backend may not send yet is a
 * worse defect than the one being fixed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const portal = fs.readFileSync(path.join(root, 'patient-portal.html'), 'utf8');
const intake = fs.readFileSync(path.join(root, 'intake.html'), 'utf8');
const appt = fs.readFileSync(path.join(root, 'appointment.html'), 'utf8');

/* Every ORDER assertion in this file goes through this first. Three times today
   a comment that names the code it explains has inverted an indexOf verdict —
   the probe cannot tell code from prose about code. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function fnBlock(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert(at >= 0, 'missing function ' + name);
  const brace = src.indexOf('{', at);
  let depth = 0, quote = '', esc = false, line = false, block = false;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i], next = src[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unterminated ' + name);
}

/* ---- 1. THE PORTAL, BY EXECUTION -------------------------------------- */
/* office() and noteServerOffice() are run for real against an empty
 * localStorage and no window.MLS_OFFICE — i.e. a patient's actual device. */
{
  function portalCtx() {
    const store = new Map();
    const ctx = {
      String, Object, JSON, console,
      localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext('var SERVER_OFFICE = null;\n' + fnBlock(portal, 'office') + '\n' + fnBlock(portal, 'noteServerOffice') +
      '\nthis.office = office; this.noteServerOffice = noteServerOffice;', ctx);
    return ctx;
  }

  /* POSITIVE CONTROL — reproduce the defect exactly. On a patient device, with
     nothing told to the page, the old sources must still yield the generic
     literal. If this did not hold, the assertion below could not distinguish
     "the server value arrived" from "the harness always returns a name". */
  const bare = portalCtx();
  assert.strictEqual(bare.office().practice, 'your care team',
    'positive control: with no localStorage and no window.MLS_OFFICE the page must fall back to the ' +
    'generic literal — this IS the pre-fix state on every real patient device');
  assert.strictEqual(bare.office().phone, '', 'positive control: and no phone number');

  /* the server tells it, and every string that reads office() now has a name */
  const told = portalCtx();
  told.noteServerOffice({ name: 'Chester County Spine Care', phone: '(555) 123-4567', address: '1 Clinic Way' });
  assert.strictEqual(told.office().practice, 'Chester County Spine Care',
    'the portal ignored the practice the server sent it');
  assert.strictEqual(told.office().phone, '(555) 123-4567', 'the portal ignored the office phone');
  assert.strictEqual(told.office().address, '1 Clinic Way', 'the portal ignored the office address');

  /* TOLERANCE: an older backend sends no practice object at all */
  for (const shape of [undefined, null, {}, { name: '', phone: '' }, 'not-an-object', 0]) {
    const t = portalCtx();
    /* doesNotThrow, not a bare call: without it a payload that CRASHES the
       handler fails this suite as a raw TypeError, which reports a stack instead
       of the property that broke. A crash here would take sign-in down for every
       patient on a backend that has not shipped the field yet. */
    assert.doesNotThrow(() => t.noteServerOffice(shape),
      'a missing/malformed practice payload (' + JSON.stringify(shape) + ') threw. Sign-in calls this ' +
      'on the load path, so a throw here is a blank portal for every patient whose backend does not ' +
      'send the field yet.');
    assert.strictEqual(t.office().practice, 'your care team',
      'a missing/empty practice payload (' + JSON.stringify(shape) + ') must leave the wording exactly ' +
      'as it was, not blank it');
  }

  /* the doctor previewing on their own machine still overrides */
  const doctor = portalCtx();
  doctor.localStorage.setItem('mlsEasyBook', JSON.stringify({ practice: 'Local Override', phone: '(555) 000-0000' }));
  doctor.noteServerOffice({ name: 'Chester County Spine Care', phone: '(555) 123-4567' });
  assert.strictEqual(doctor.office().practice, 'Local Override',
    'the local preview override must still win — it is how a doctor checks their own portal');

  /* and the value is actually FED from the two responses that carry it */
  assert(/noteServerOffice\(j && j\.practice\)/.test(portal),
    '/api/patient/me is fetched on load and its practice is not read — the portal is asking and ' +
    'discarding the answer');
  assert(/noteServerOffice\(j\.practice\);/.test(portal),
    'the history response carries the practice too and must be read BEFORE renderPatient, or the ' +
    'name arrives after the strings that need it');
  /* Comments stripped before any ORDER check. The comment explaining why the
     call sits before renderPatient names renderPatient to do so, so a raw
     indexOf finds the prose first and inverts the verdict. */
  const load = stripComments(fnBlock(portal, 'loadRecords'));
  assert(/noteServerOffice/.test(load) && /renderPatient/.test(load),
    'comment stripping removed the code it was meant to expose');
  assert(load.indexOf('noteServerOffice') < load.indexOf('renderPatient'),
    'the practice must be recorded before renderPatient draws the strings that use it');

  /* no dead second copy of checkSession left behind */
  assert.strictEqual((portal.match(/function checkSession\(\)/g) || []).length, 1,
    'more than one checkSession — a dead duplicate is exactly the defect class this repo tracks');
  assert(!/_checkSessionLegacy/.test(portal), 'a dead legacy copy of checkSession survived');
}

/* ---- 2. INTAKE ------------------------------------------------------- */
{
  assert(/applyPracticeIdentity\(d\.practice\)/.test(intake),
    'intake.html does not read the practice the token endpoint now returns, so the doctor\'s own ' +
    'patients still see the vendor\'s name on the doctor\'s own form');
  const apply = fnBlock(intake, 'applyPracticeIdentity');
  assert(/if\(!p \|\| typeof p!=='object'\) return;/.test(apply),
    'intake must tolerate an older backend that returns only {ok:true}');
  assert(/if\(name\)\{/.test(apply) && /if\(phone\)\{/.test(apply),
    'name and phone must be applied independently — a practice with no phone configured must still ' +
    'get its name');
  /* textContent, not innerHTML, for the practice name: it is doctor-entered free
     text landing on a page a patient loads. */
  assert(/brand\.textContent=name/.test(apply),
    'the practice name must be written as text, never parsed as markup');
  assert(/esc\(name\)/.test(apply),
    'the one innerHTML path must escape the practice name');
  assert(/function esc\(s\)/.test(intake), 'intake has no escaper for the innerHTML path');
  /* the two dead-end "contact the clinic" lines can now say how */
  assert(/call the office at '\+phone/.test(apply),
    'the link-invalid and offline states still tell the patient to contact the clinic with no number');
  assert(/function contactLine\(\)/.test(intake) && /'\+contactLine\(\)/.test(intake),
    'the submit-failure line must use the office number when one is known');
}

/* ---- 3. THE APPOINTMENT PAGE ----------------------------------------- */
{
  assert(/OFFICE_PHONE = String\(\(a && a\.practice_phone\) \|\| ''\)\.trim\(\)/.test(appt),
    'appointment.html does not read practice_phone, so "call the office" still cannot say which ' +
    'number');
  const call = fnBlock(appt, 'callOffice');
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext("var OFFICE_PHONE = '';\n" + call + '\nthis.callOffice = callOffice; this.set = function(v){ OFFICE_PHONE = v; };', ctx);
  assert.strictEqual(ctx.callOffice(), 'call the office',
    'with no number configured the wording must be exactly what it was');
  ctx.set('(555) 123-4567');
  assert.strictEqual(ctx.callOffice(), 'call the office at (555) 123-4567',
    'with a number configured the page must give it');

  /* Four visible lines, covered by two static templates plus two dynamic calls
     (the rewriter handles both templates in one loop). */
  assert.strictEqual((appt.match(/data-office-call=/g) || []).length, 2,
    'the two STATIC copy lines must both carry a template for the rewriter');
  assert.strictEqual((appt.match(/callOffice\(\)/g) || []).length, 3,
    'expected the rewriter plus the two cancel-failure lines to resolve the number');
  assert(/el\.textContent = t\.replace\('\{\{call\}\}', callOffice\(\)\)/.test(appt),
    'the static lines must be rewritten as text, not markup');

  /* The #notfound copy is deliberately NOT wired. It renders when the
     appointment lookup FAILED, so the page has no practice payload and cannot
     know the number — inventing one there, or blanking the sentence, would both
     be worse than the generic wording. Asserted so a later sweep does not
     "finish the job" by guessing. */
  const notfound = appt.slice(appt.indexOf('id="notfound"'), appt.indexOf('id="offline"'));
  assert(/contact the office/.test(notfound) && !/data-office-call/.test(notfound),
    'the not-found state must keep its generic wording: no appointment was loaded, so no practice ' +
    'phone is known there');
}

console.log('PASS the patient-facing pages name their practice: the portal resolves it from the ' +
  'session instead of two sources that only exist on the doctor\'s device (proved by executing ' +
  'office() against an empty device, with the pre-fix state as the positive control), intake finally ' +
  'says whose form it is, the appointment page can say which office to call and on what number, and ' +
  'all three still render exactly as before when the backend sends no practice at all');
