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

/* 4 - opr-1.5.1 */
assert(room.includes("var VERSION = 'opr-1.5.1';"), 'room module is not opr-1.5.1');
assert(room.includes('safe(wrapProcOpeners);'), 'opener wraps must re-attempt at call time');

console.log('PASS ai-audit safety fixes: both study lanes really de-identify (vm-proven), studio saves only what passed, the record sees op-note bodies, and the room retries before floating');
