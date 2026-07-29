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

/* 2026-07-29: F2 builds one exact seen index per account/day/store version. */
assert(f2.includes('seenTodayIndex(nm, today)') && f2.includes('cachedSeen !== null'),
  'F2 _seenToday no longer uses the versioned index before its scan fallback');
{
  const helperStart = connect.indexOf('var seenTodayCache = null;');
  const helperEnd = connect.indexOf('\n  function installF2() {', helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart, 'F2 seen-today index helper is missing');
  const helper = connect.slice(helperStart, helperEnd);
  let version = 1, account = 'synthetic-a', patientReads = 0, noteReads = 0;
  const patients = [
    { id: 'same-1', name: 'Synthetic Duplicate' },
    { id: 'same-2', name: 'Synthetic Duplicate' },
    { id: 'unique-1', name: 'Synthetic Unique' },
    { id: 'legacy-1', name: 'Synthetic Legacy' },
    { id: 'draft-1', name: 'Synthetic Draft' },
    { id: 'old-1', name: 'Synthetic Old' }
  ];
  const notes = [
    { patient: 'Synthetic Unique', patientId: 'wrong-id', updated: '2026-07-29T12:00:00Z' },
    { patient: 'Synthetic Duplicate', patientId: 'same-1', updated: '2026-07-29T12:00:00Z' },
    { patient: 'Synthetic Legacy', updated: '2026-07-29T12:00:00Z' },
    { patient: 'Synthetic Draft', isDraft: true, updated: '2026-07-29T12:00:00Z' },
    { patient: 'Synthetic Old', updated: '2026-07-28T12:00:00Z' }
  ];
  const indexedCtx = {
    window: {
      __mlsStoreCache: { ver() { return version; } },
      uns(suffix) { return account + '::' + suffix; },
      getPatients() { patientReads++; return patients; },
      getNotes() { noteReads++; return notes; }
    },
    isFn(f) { return typeof f === 'function'; },
    localYmd(d) { return d.toISOString().slice(0, 10); },
    Date, Number, String, Object, isFinite
  };
  vm.createContext(indexedCtx);
  vm.runInContext(helper + '\nthis.seenTodayIndex=seenTodayIndex;', indexedCtx,
    { filename: 'f2-seen-today-index.js' });
  const seen = indexedCtx.seenTodayIndex;
  assert.strictEqual(seen('synthetic unique', '2026-07-29'), false,
    'a same-name note carrying the wrong unique patient id counted as seen');
  assert.strictEqual(seen('synthetic duplicate', '2026-07-29'), true,
    'an ambiguous name lost the historical note.patient fallback');
  assert.strictEqual(seen('synthetic legacy', '2026-07-29'), true,
    'an id-less legacy note stopped counting for a unique patient');
  assert.strictEqual(seen('synthetic draft', '2026-07-29'), false, 'a draft counted as seen');
  assert.strictEqual(seen('synthetic old', '2026-07-29'), false, 'a prior-day note counted as seen');
  seen('synthetic duplicate', '2026-07-29'); seen('synthetic legacy', '2026-07-29');
  assert.strictEqual(patientReads, 1, 'same-version seen checks rebuilt the patient index');
  assert.strictEqual(noteReads, 1, 'same-version seen checks rebuilt the note index');
  notes.push({ patient: 'Different display', patientId: 'unique-1', updated: '2026-07-29T13:00:00Z' });
  assert.strictEqual(seen('synthetic unique', '2026-07-29'), false,
    'cache changed without a store-version invalidation');
  version++;
  assert.strictEqual(seen('synthetic unique', '2026-07-29'), true,
    'store-version invalidation did not expose a new exact-id note');
  account = 'synthetic-b';
  seen('synthetic unique', '2026-07-29');
  assert.strictEqual(patientReads, 3, 'account-key change did not rebuild the seen index');
  assert.strictEqual(seen('synthetic unique', '2026-07-30'), false,
    'day-key change did not exclude the prior-day note');
  assert.strictEqual(patientReads, 4, 'day-key change did not rebuild the seen index');
}

console.log('PASS op-note draft quarantine: PDF/routing/sign gates fail closed on unresolved placeholders, and visit counters exclude drafts with id-reconciled seen-today');
