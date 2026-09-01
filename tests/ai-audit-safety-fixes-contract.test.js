'use strict';

/* AI-AUDIT SAFETY FIXES (b732) + opr-1.5.1 hardenings.
 * 1. Study S3/S4: the "DE-IDENTIFIED" header sat over RAW note excerpts.
 *    Both lanes now scrub through one guarded window-level scrubber.
 * 2. Studio save-truth: a tool that FAILS its runtime check was auto-saved
 *    into My creations; the save now commits ONLY in the __mlsWidgetReady
 *    branch, and an error clears the pending save.
 * 3. compilePatientRecord: op notes save to .text - prior operative notes
 *    contributed BLANK bodies to the record that feeds the op-note fallback
 *    and the IME/legal report; drafts were falsely "[Transcript only]".
 * 4. opr-1.5.1: opener wraps re-attempt at call time; a declining
 *    openOpPrepSmart gets one openOpPrep retry before floating fallback. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const room = fs.readFileSync(path.join(root, 'feat_mls_opnote_room.js'), 'utf8');

/* 1 - study scrub: defined (guarded) and USED at both lanes */
assert.strictEqual(connect.split('if(!window.__mlsStudyScrub)').length - 1, 2,
  'the guarded scrubber must be defined at BOTH study lanes');
assert.strictEqual(connect.split('window.__mlsStudyScrub(S(v.detail)').length - 1, 2,
  'BOTH study lanes must scrub the detail they label DE-IDENTIFIED');
/* vm-prove the scrubber itself */
const def = connect.slice(connect.indexOf('if(!window.__mlsStudyScrub)'), connect.indexOf('return t;};}') + 'return t;};}'.length);
const ctx = { window: {}, console: console };
vm.createContext(ctx);
vm.runInContext(def, ctx, { filename: 'study-scrub.js' });
const scrub = ctx.window.__mlsStudyScrub;
const out = scrub('Bernard Brooks seen 2026-07-27, MRN 7833832, call 215-555-1234, id 99887766', 'Bernard P Brooks');
assert(out.indexOf('Bernard') < 0 && out.indexOf('Brooks') < 0, 'the patient name must not survive');
assert(out.indexOf('7833832') < 0 && out.indexOf('99887766') < 0, 'MRN/long ids must not survive');
assert(out.indexOf('215-555-1234') < 0, 'phones must not survive');
assert(out.indexOf('2026-07-27') < 0 && out.indexOf('2026-07') >= 0, 'dates generalize to month precision');

/* 2 - studio save-truth handshake */
assert(connect.includes('window.__mlsStudioPendingSave = { html: S(html), title:'),
  'the render wrap must stash a PENDING save, never save eagerly');
assert(!connect.includes('arr.unshift({ title: t, html: S(html), ts: Date.now(), auto: true });'),
  'the eager auto-save is back - failed tools will reach My creations again');
assert(app.includes('var ps=window.__mlsStudioPendingSave; window.__mlsStudioPendingSave=null;'),
  'the ready branch must consume the pending save');
assert(app.includes("psArr.unshift({title:ps.title,html:ps.html,ts:Date.now(),auto:true});"),
  'the ready branch must commit the save');
assert(app.includes("try{ window.__mlsStudioPendingSave=null; }catch(ePS2){}"),
  'the error branch must clear the pending save');

/* 3 - the record sees op-note bodies */
assert(app.includes('L.push((n.soap||n.text||\'\').trim());'),
  'prior op notes (body in .text) must reach the compiled record');
assert(app.includes("n.kind==='opnote'&&(n.text||'').trim()"),
  'op-note drafts must not be mislabeled Transcript-only');

/* 4 - opr-1.5.1 hardenings (carried into the opr-2.0.0 remake, 2026-07-28) */
assert(room.includes("var VERSION = 'opr-2.0.0';"), 'room module is not opr-2.0.0');
assert(room.includes('safe(wrapProcOpeners);'), 'opener wraps must re-attempt at call time');

/* b734 - the quality half of the audit + diarization option A */
const tn = fs.readFileSync(path.join(root, 'feat_mls_turn_labels.js'), 'utf8');
const vf = fs.readFileSync(path.join(root, 'feat_mls_visit_focus.js'), 'utf8');
assert(tn.includes('labelledForPrompt: function () {'), 'the turn engine must offer the sidecar block');
assert(app.includes('SPEAKER-TURN HYPOTHESES (UNVERIFIED'),
  'the sidecar must carry its caveat INSIDE the user block - the one field the hosted transport keeps');
/* sidecar-1.0.0 (2026-08-28): this pinned the generation call character for
   character, including the NAME of the draft-tuning source. It was ALREADY
   stale on 8e81c003 - the call there passes
   _mlsGenerationDraftTuning(options.evidence), not getGenSectionProfileOverrides()
   - and it has since gained a specialty option as well. Two renames and an
   addition against one literal; the ORDER it exists to protect never moved.
   Pinned as the order directly: the transcript is wrapped UNCHANGED between its
   two markers, the speaker-turn sidecar rides AFTER it inside the same user
   block (the one field the hosted transport keeps), and the options object
   comes last and still carries draft tuning. Extra options are allowed - that
   is how specialty reached the request. */
{
  /* b1145 (94eac3c0, "the template reaches the FIRST draft") made the first
     argument sys+tplSysLine instead of the bare identifier sys - the third
     time this literal has drifted while the property it protects (transcript
     wrapped UNCHANGED between its two markers) stayed true. Loosen only that
     first argument; the rest of the pattern is what carries the guarantee
     and must not move. */
  const call = /return await postChat\(sys[A-Za-z0-9_+]*,'TODAY_TRANSCRIPT_BEGIN\\n'\+transcript\+'\\nTODAY_TRANSCRIPT_END'\+([A-Za-z0-9_+]*),key,\{(.*?)\}\);/.exec(app);
  assert(call, 'the generation call no longer wraps the UNCHANGED transcript between its two markers - anything ' +
    'that edits the transcript on the way out is a clinical-content change the doctor never made');
  assert(/ctxLine\+turnsBlock/.test(call[1]),
    'the speaker-turn sidecar no longer rides AFTER the transcript inside the same user block (' + call[1] + ') - ' +
    'the hosted transport keeps only that field, so a sidecar sent anywhere else is silently dropped');
  assert(/draftTuning:/.test(call[2]),
    'the generation call lost its draft-tuning options, so Settings would stop reaching the request');
  /* The sidecar's UNVERIFIED caveat is already pinned above (the assertion just
     before this block). sidecar-1.0.0 repeated it here; a duplicate predicate
     22 lines from its twin is noise that makes a real gap harder to see, so it
     is removed rather than kept "for locality". */
}
assert(app.includes("noteTail: String(soap||'').trim()?String(soap).slice(-4000):'',"),
  'Copilot must receive the NOTE, not a word count');
assert(app.includes('codes: coding?{ icd10:(coding.icd10||[]).slice(0,20)'),
  'Copilot must receive the real code arrays');
assert(vf.includes(".wd-starter:not(:first-of-type){display:none!important}"),
  'the zero-widget state must keep ONE compact starter card as the first-run entry');
assert(!vf.includes("#mlsWdDeck:has(.wd-starter){display:none!important}"),
  'the whole-deck starter hide is back - the feature is invisible until you already have it');

console.log('PASS ai-audit safety fixes: both study lanes really de-identify (vm-proven), studio saves only what passed, the record sees op-note bodies, the room retries before floating, the turn sidecar rides the user payload with its caveat, Copilot sees its own note and codes, and first-run widgets have a door');
