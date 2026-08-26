'use strict';
/* fvn-1.0.0 (Codex reply 24, authoritative Full-Visit-Notes semantics):
 *   OFF = schedule/booking identity + chart facts/coverage + exactly the
 *         pulled day's OWN visit note (day-facts mode - charts ARE opened);
 *   ON  = all of that + every dated PRIOR visit note.
 * The engine has implemented this since dayfacts-1.0.x; the HUMAN surfaces
 * (first-choice dialog, Settings row) still described OFF as "schedule-only
 * ... does not open patient charts" - a doctor reading them would refuse the
 * mode that actually does mandatory chart work, or trust "faster" while
 * believing no PHI is read. This suite pins copy and engine to ONE canon. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const liveShell = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const si = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');

/* ---- no user-visible surface may claim OFF skips charts - the source
   shell AND the hand-maintained live /1p page (not derived) ---- */
for (const [name, text] of [['1pScribeFlow.html', shell], ['1p/index.html', liveShell]]) {
  for (const lie of ['does not open patient charts', 'without opening patient charts', 'schedule-only pulls']) {
    assert.ok(!text.includes(lie), name + ' still tells the doctor OFF is chart-less: "' + lie + '"');
  }
  assert.ok(text.includes('additionally saves every dated PRIOR visit note'), name + ' lost the canonical ON scope');
  assert.ok(text.includes('older visit notes skipped'), name + ' lost the canonical fast-button copy');
}

/* ---- the first-choice dialog teaches the canon ---- */
const dlgStart = shell.indexOf('function _mlsVisitNotesChoice(){');
assert.ok(dlgStart > 0, 'the visit-notes choice dialog moved');
const dlg = shell.slice(dlgStart, dlgStart + 2600);
assert.ok(dlg.includes('Every pull opens each scheduled chart and saves its identity, chart facts (problems, medications, allergies) and the pulled day’s own visit note.'),
  'the dialog no longer states the mandatory OFF work');
assert.ok(dlg.includes('additionally saves every dated PRIOR visit note'), 'the dialog no longer scopes ON to PRIOR notes');
assert.ok(dlg.includes('Chart facts + the pulled day’s own note · older visit notes skipped'),
  'the fast button no longer names what OFF keeps and skips');
/* the buttons still map to the canonical booleans */
assert.ok(dlg.includes("full.onclick=function(){ finish(true); };") && dlg.includes("fast.onclick=function(){ finish(false); };"),
  'the dialog buttons no longer map full->true / day-only->false');

/* ---- the Settings row teaches the canon ---- */
assert.ok(shell.includes("Off: pulls still open each scheduled chart and save its identity, chart facts (problems, medications, allergies) and the pulled day's own visit note — only OLDER visit notes are skipped."),
  'the Settings row no longer states the canonical OFF semantics');
/* the toggle-off toast was already canonical - keep it pinned */
assert.ok(shell.includes('Pulls will read each chart’s facts and its own-day note — historical visit notes are skipped.'),
  'the canonical toggle-off toast changed');

/* ---- engine: OFF is day-facts DEPTH, never a chart opt-out ---- */
assert.ok(si.includes('fvn-1.0.0 CANONICAL SEMANTICS'), 'the engine boundary comment lost the canon');
assert.ok(si.includes('an OFF day pull now runs the batch in day-facts mode'),
  'the dayfacts law (OFF still runs the per-patient batch) is gone');
assert.ok(si.split('fullNotesOff ? "day-facts" : (visitNotesRequested === true ? "full" : "unspecified")').length - 1 >= 2,
  'the day-facts/full mode stamp left the receipts');
/* the retry lane freezes the ORIGINAL mode - an OFF receipt never grows a
   full-history retry because the preference changed later */
assert.ok(si.includes('if (typeof history.visitNotesRequested === "boolean") _pullBodiesOverride = history.visitNotesRequested;'),
  'the retry lane no longer freezes the original visit-notes mode');
/* OFF retry entries stay actionable (chart facts + day note are mandatory) */
assert.ok(si.includes('an OFF row\'s chart-facts read and pulled-day') || si.includes("an OFF row's chart-facts read and pulled-day"),
  'the dayfacts-1.0.1 revocation of the wholesale OFF refusal is gone');

/* ---- machine receipts carry the mode for every matrix run ---- */
assert.ok(si.includes('out.visitNotesMode = String(value.visitNotesMode).slice(0, 24);'),
  'honestPullOutcome no longer carries visitNotesMode');

console.log('PASS FVN canonical semantics (fvn-1.0.0): every human surface now teaches OFF = chart facts + the pulled day\'s own note (older notes skipped) and ON = + all prior notes; the chart-less "schedule-only" claims are gone from the shell; the engine\'s day-facts law, mode stamps, retry-mode freeze, and receipt carry are pinned to the same canon');
