'use strict';
/* 2026-07-22: an op note with ANY unresolved placeholder is a DRAFT.
 * Drafts (and placeholder-bearing notes generally) must be quarantined from
 * every completion/export/routing surface:
 *   - PDF export (mls-opnote-pro.js) refuses and the History viewer hides its
 *     button for "(draft)" notes
 *   - pushHistoryNoteToAthena refuses drafts/placeholders internally (not just
 *     via the hidden UI button)
 *   - signNote refuses placeholders (signing is completion)
 *   - the at-a-glance visit chip and _seenToday exclude drafts, and _seenToday
 *     reconciles by canonical patientId when the name resolves uniquely
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const pdf = fs.readFileSync(path.join(root, 'mls-opnote-pro.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function between(src, a, b) {
  const i = src.indexOf(a);
  assert(i >= 0, 'missing anchor: ' + a);
  const j = src.indexOf(b, i);
  assert(j > i, 'missing end anchor: ' + b);
  return src.slice(i, j);
}

/* ---- 1. PDF export choke point refuses unresolved placeholders ---- */
const pdfGate = between(pdf, 'window.__mlsOpNotePdf = function', 'function injectCss()');
assert(pdfGate.indexOf('opNoteBlankTokens') >= 0, 'PDF export has no canonical placeholder gate');
assert(pdfGate.indexOf('opNoteBlankTokens') < pdfGate.indexOf('exportPdf(String(t)'), 'PDF placeholder gate does not run before the export');
assert(/draft/i.test(pdfGate), 'PDF refusal does not explain the draft state');

/* the History viewer must hide the PDF button for "(draft)" notes */
const viewerWire = between(pdf, 'function wireHistoryViewer()', 'function wirePrepRows()');
assert(/\\\(draft\\\)/.test(viewerWire), 'History viewer still offers PDF export for op-note drafts');

/* ---- 2. Athena routing refuses drafts/placeholders internally ---- */
const pushSrc = between(app, 'function pushHistoryNoteToAthena(id){', 'function getAutoSendEMR()');
assert(pushSrc.indexOf('n.isDraft') >= 0 && pushSrc.indexOf('n.isDraft') < pushSrc.indexOf('_athenaBindingForSavedRecord'), 'draft guard missing or after binding work');
assert(pushSrc.indexOf('opNoteBlankTokens') >= 0 && pushSrc.indexOf('opNoteBlankTokens') < pushSrc.indexOf('_athenaBindingForSavedRecord'), 'placeholder guard missing or after binding work');

/* runtime: a draft and a placeholder-bearing note must return before any
   binding resolution (the stub throws if reached) */
{
  const toasts = [];
  const ctx = {
    console, Object, Array, String, JSON, Date, Math,
    toast(m, t) { toasts.push({ m: String(m), t }); },
    getNotes() {
      return [
        { id: 'draft1', isDraft: true, text: 'A draft note' },
        { id: 'holes1', isDraft: false, text: 'Needle: [[needle_gauge]]\nEBL: ___' },
        { id: 'fill1', isDraft: false, text: 'Consent: [FILL: consent details]' }
      ];
    },
    opNoteBlankTokens(t) {
      const out = []; let m;
      const r1 = /\[\[\s*([a-z0-9_]+)\s*\]\]/gi; while ((m = r1.exec(t))) out.push({ key: m[1], label: m[1] });
      const r2 = /\[FILL:\s*([^\]]+?)\s*\]/gi; while ((m = r2.exec(t))) out.push({ key: m[1], label: m[1] });
      const r3 = /(^|[^_])_{3,}(?!_)/g; while ((m = r3.exec(t))) out.push({ key: 'blank', label: 'Blank' });
      return out;
    },
    _athenaBindingForSavedRecord() { throw new Error('binding must not be resolved for quarantined notes'); }
  };
  vm.createContext(ctx);
  vm.runInContext(pushSrc + '\nthis.push = pushHistoryNoteToAthena;', ctx, { filename: 'push-history-quarantine.js' });
  ctx.push('draft1');
  assert(toasts.length === 1 && /draft/i.test(toasts[0].m) && toasts[0].t === 'err', 'draft was not refused visibly');
  ctx.push('holes1');
  assert(toasts.length === 2 && /unresolved field/i.test(toasts[1].m), '[[key]]/___ note was not refused');
  ctx.push('fill1');
  assert(toasts.length === 3 && /unresolved field/i.test(toasts[2].m), '[FILL:] note was not refused');
}

/* ---- 3. signNote refuses placeholders before badging ---- */
const signSrc = between(app, 'function signNote(){', 'function fullText(){');
assert(signSrc.indexOf('opNoteBlankTokens') >= 0 && signSrc.indexOf('opNoteBlankTokens') < signSrc.indexOf('setBadge(true)'), 'signing does not run the placeholder gate before completing');

/* ---- 4. draft-free counts: at-a-glance chip + _seenToday ---- */
const glance = between(app, 'function _renderProfAtGlance(p){', 'const PROF_FIELD_BODY');
assert(/filter\(function\(n\)\{ return n&&!n\.isDraft; \}\)/.test(glance), 'at-a-glance visit chip still counts drafts');

const seenSrc = between(app, 'function _seenToday(name){', 'function _tomorrowAppts(){');
assert(seenSrc.indexOf('getPatients') >= 0 && seenSrc.indexOf('n.patientId') >= 0, '_seenToday is not id-reconciled');
{
  const ctx = {
    console, Object, Array, String, JSON, Date, Math, Number,
    _acctTodayKey() { return '2026-07-22'; },
    _acctDateKeyOf() { return '2026-07-22'; },
    getPatients() {
      return [
        { id: 'p1', name: 'Jane Same' },
        { id: 'p2', name: 'Only One' }
      ];
    },
    getNotes() {
      return [
        /* note carries a DIFFERENT patient's id but the same display name —
           must NOT mark "Only One" seen, and only marks the exact p-other */
        { patient: 'Only One', patientId: 'p-other', isDraft: false, updated: 1 },
        /* drafts never count */
        { patient: 'Jane Same', patientId: 'p1', isDraft: true, updated: 1 }
      ];
    }
  };
  vm.createContext(ctx);
  vm.runInContext(seenSrc + '\nthis.seen = _seenToday;', ctx, { filename: 'seen-today-reconciled.js' });
  assert.strictEqual(ctx.seen('Only One'), false, 'a same-named different patient marked this one seen');
  assert.strictEqual(ctx.seen('Jane Same'), false, 'a draft counted as a completed visit');
}

/* the mls-connect F2 local-date override must carry the same reconciliation */
const f2 = between(connect, "/* _seenToday: same logic as the base app but with LOCAL dates both sides */", '_nextClinicDay');
assert(f2.indexOf('getPatients') >= 0 && f2.indexOf('n.patientId') >= 0, 'F2 _seenToday override lost the id reconciliation');

console.log('PASS op-note draft quarantine: PDF/routing/sign gates fail closed on unresolved placeholders, and visit counters exclude drafts with id-reconciled seen-today');
