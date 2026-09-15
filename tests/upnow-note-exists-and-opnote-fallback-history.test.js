'use strict';
/* upnow-1.0.0 + ophist-1.0.0 (2026-09-15).
 *
 * 1. The hero line said "loaded & ready. Hit Start recording" while a note for
 *    the visit already existed (owner's list, GOAL section 6). It now says so
 *    and points at the note.
 * 2. The op-note FALLBACK history came from compilePatientRecord, which lists
 *    notes oldest first, and was then cut to 14,000 characters - a long chart
 *    lost its newest notes. The fallback builds newest-first and bounded.
 * Executes _opFallbackHistory sliced from both twins on synthetic data.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
let checks = 0;
function ok(c, m) { checks++; assert.ok(c, m); }
for (const file of ['1pScribeFlow.html', '1p/index.html']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  ok(src.includes("(_hasNote?' — a note already exists for this visit. Review it below, or press 🎙️ Start recording to add to it.':' — loaded &amp; ready. Hit 🎙️ Start recording.')"), file + ': the hero line distinguishes an existing note');
  ok(src.includes("_hasNote=!!(typeof currentSoap!=='undefined'&&String(currentSoap||'').trim());"), file + ': a note on screen counts');
  ok(src.includes("try{ history=_opFallbackHistory(p)||''; }catch(eOpHist){ history=''; }"), file + ': the op-note fallback uses the bounded newest-first builder first');
  const s = src.indexOf('function _opFallbackHistory(p){');
  const e = src.indexOf('\n}\n', s);
  const fn = src.slice(s, e + 3);
  const notes = [];
  for (let i = 0; i < 40; i++) notes.push({ id: 'n' + i, patientId: 'p1', soap: 'NOTE ' + i + ' ' + 'x'.repeat(900), updated: 1000 + i * 1000, isDraft: false });
  notes.push({ id: 'd', patientId: 'p1', soap: 'DRAFT must not ride', updated: 99999, isDraft: true });
  const ctx = { console, Date, String, Number, Array, Object, Math, JSON, patientNotes(id) { return id === 'p1' ? notes : []; } };
  vm.runInNewContext(fn + '\nglobalThis.__h = _opFallbackHistory;', ctx, { filename: file });
  const h = ctx.__h({ id: 'p1', problems: 'lumbar spondylosis', meds: 'none', allergies: 'NKDA', summary: 'chart summary text' });
  ok(h.length <= 14000, file + ': bounded to 14,000 characters (got ' + h.length + ')');
  ok(h.indexOf('PROBLEM LIST') === 0 && h.includes('CHART SUMMARY'), file + ': the chart facts lead');
  ok(h.includes('NOTE 39 ') && h.indexOf('NOTE 39 ') < h.indexOf('NOTE 38 '), file + ': the newest note comes first');
  ok(!h.includes('NOTE 0 '), file + ': the oldest note is what gets dropped, not the newest');
  ok(!h.includes('DRAFT must not ride'), file + ': drafts never ride');
  ok(/PRIOR NOTES \(most recent first, \d+ of 40\)/.test(h), file + ': the block says how many of how many');
  ok(ctx.__h(null) === '', file + ': no patient, no history');
}
console.log('PASS up-now note-exists wording and op-note fallback history: the hero names an existing note instead of asking for a fresh recording, and the op-note fallback history is newest-first and bounded, in both twins (' + checks + ' checks)');
