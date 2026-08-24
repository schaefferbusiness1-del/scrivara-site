/* note-defaults-transport-split
 *
 * Hosted main-note generation deliberately keeps the backend-owned clinical
 * and safety prompt. The browser must never be able to replace it with an
 * arbitrary system prompt. It now carries the Settings values through a small,
 * structured notePreferences object instead:
 *
 *   opts.freeform -> POST /api/complete  {system,user,legal,maxTokens}
 *   main note     -> POST /api/generate  {transcript,model,notePreferences,draftFamily,draftTuning}
 *
 * The backend independently allowlists and caps the structured object before
 * appending it beneath its own safety instructions. This test proves the
 * browser half, including executable client caps, and pins that raw `sys` is
 * still absent from /api/generate.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sf = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8').replace(/\r/g, '');

let failures = 0;
const fail = m => { console.error('FAIL: ' + m); failures++; };

/* ---- 1. the two hosted transports stay intentionally different ---- */
const i = sf.indexOf('async function aiCallRaw(sys,user,key,opts){');
if (i < 0) { console.error('FAIL: aiCallRaw not found'); process.exit(1); }
/* Keep enough of aiCallRaw to include the structured lane even as bounded
 * draft-tuning/error-receipt guards grow ahead of it. The prior 5k window
 * stopped mid-payload and produced a false transport failure. */
const body = sf.slice(i, i + 9000);

const complete = body.indexOf("'/api/complete'");
const generate = body.indexOf("'/api/generate'");
if (complete < 0) fail('the /api/complete transport is gone');
if (generate < 0) fail('the /api/generate transport is gone');

const completeBody = body.slice(complete, complete + 500);
const generateBody = body.slice(generate, generate + 600);
if (!/body:JSON\.stringify\(\{system:sys,user:user/.test(completeBody)) {
  fail('/api/complete no longer sends the client system prompt');
}
if (!generateBody.includes("body:JSON.stringify({transcript:user, model:(typeof getNoteModel==='function'?getNoteModel():''), notePreferences:hostedNotePreferences(), draftFamily:_draftFamily||'soap', draftTuning:_draftTuning||undefined})")) {
  fail('/api/generate does not send the structured notePreferences object');
}
if (!/out\.patientSummary=\(typeof getGenPatientSummary==='function'&&getGenPatientSummary\(\)===true\)/.test(sf)) {
  fail('patient-summary choice is absent from the backend-sanitized notePreferences object');
}
if (/notePreferences:hostedNotePreferences\(\),\s*patientSummary:/.test(generateBody)) {
  fail('patient-summary choice escaped notePreferences into an unsanitized top-level field');
}
if (/\bsystem\s*:|\bsys\b/.test(generateBody.split('signal')[0].replace('hostedNotePreferences', ''))) {
  fail('/api/generate sends an arbitrary browser system prompt instead of only structured preferences');
}

/* ---- 2. main note generation really uses this structured lane ---- */
const gen = sf.indexOf("return await postChat(sys,'TODAY_TRANSCRIPT_BEGIN");
if (gen < 0) fail('main note generation no longer uses the non-freeform /api/generate lane');
const sysStart = sf.lastIndexOf('const sys=', gen);
const mainPrompt = sf.slice(sysStart, gen);
if (mainPrompt.indexOf('__mlsCodeTable') < 0) fail('the main-note prompt no longer builds in the practice code table for direct-key mode');
if (mainPrompt.indexOf('docPrefsBlock') < 0) fail('the main-note prompt no longer builds in provider preferences for direct-key mode');
if (!sf.includes('aiCallRaw(sys,user,key,Object.assign({noteFormat:style},extraOpts||{}))')) {
  fail('postChat no longer preserves the structured non-freeform lane while adding bounded section tuning');
}

/* ---- 3. execute the shipped structured collector and prove its caps ---- */
const prefStart = sf.indexOf('function hostedNotePreferences(){');
const prefEnd = sf.indexOf('\n\n/* =========================================================', prefStart);
if (prefStart < 0 || prefEnd < 0) {
  fail('could not isolate hostedNotePreferences');
} else {
  const providerInputs = Array.from({length: 40}, (_, n) => n === 0 ? '  Keep plans focused.  ' : 'p'.repeat(300));
  const codeInputs = Array.from({length: 140}, (_, n) => ({
    desc: 'Description ' + n + ' ' + 'd'.repeat(210),
    code: 'CODE-' + n + 'x'.repeat(50),
    kind: n % 3 === 0 ? 'ICD10' : (n % 3 === 1 ? 'cpt' : 'not-allowed'),
    ignored: 'must not travel',
  }));
  const sandbox = {
    window: { __mlsCodeTable: { load: () => ({ entries: codeInputs }) } },
    getMlsNoteStyle: () => 'detailed',
    getGenPatientSummary: () => true,
    getQolFollowup: () => '  four weeks  ' + 'f'.repeat(300),
    getDocPrefs: () => providerInputs,
    result: null,
  };
  try {
    vm.runInNewContext(sf.slice(prefStart, prefEnd) + '\nresult=hostedNotePreferences();', sandbox);
    const p = sandbox.result;
    if (!p || p.noteStyle !== 'detailed') fail('note style did not reach the structured object');
    if (!p || p.patientSummary !== true) fail('patient-summary choice did not reach the structured object as a boolean');
    if (!p || p.followUp.length > 160 || !/^four weeks/.test(p.followUp)) fail('follow-up was not trimmed/capped');
    if (!p || p.providerPreferences.length > 20 || p.providerPreferences.reduce((n, v) => n + v.length, 0) > 3000) fail('provider preference caps failed');
    if (!p || p.billingCodes.length > 100 || p.billingCodes.reduce((n, v) => n + v.desc.length + v.code.length + v.kind.length, 0) > 6000) fail('billing-code caps failed');
    if (p && p.billingCodes.some(v => !['', 'icd10', 'cpt'].includes(v.kind) || 'ignored' in v)) fail('billing-code allowlisted shape failed');
    if (p && Object.prototype.hasOwnProperty.call(p, 'system')) fail('arbitrary system field leaked into the structured object');
  } catch (e) { fail('hostedNotePreferences did not execute: ' + e.message); }
}

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('PASS note-defaults hosted transport: main visit notes carry bounded style, follow-up, provider preferences, and practice codes while /api/generate still receives no arbitrary browser system prompt');
