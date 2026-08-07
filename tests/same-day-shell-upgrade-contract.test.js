'use strict';
/* px-1.1 contract - multiple same-day encounters must never cross-hydrate.
   The old shell-upgrade took the FIRST empty shell on the service date, so
   with two same-day encounters, encounter B's body could land in encounter
   A's row. Now: a shared stable alias wins outright; otherwise the upgrade
   happens only when the day has exactly ONE compatible shell and no stable-key
   conflict - ambiguity appends a new row (recoverable) instead of guessing.
   Also pins the px-e1 date-key fix in the extension candidate: dash/dot
   separated dates must produce the same day key as slash dates, or the
   day-scoped read (visit-notes-OFF lane) skips every row. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const visitsSource = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing start marker ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing end marker ${end}`);
  return source.slice(a, b);
}
const modelSource = between(visitsSource, '/* ----------------------------------------------------------------------------\n * 1) VISIT-AWARE DATA MODEL', '/* ----------------------------------------------------------------------------\n * 2) PER-VISIT PROFILE UI');

function makeContext() {
  const patients = [{ id: 'pt-1', name: 'Example Patient', dob: '01/02/1970', visits: [] }];
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, createElement() { return {}; }, head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} } },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    getPatients() { return patients; },
    findPatient(id) { return patients.find(p => p.id === id) || null; },
    upsertPatient(p) { const i = patients.findIndex(x => x.id === p.id); if (i >= 0) patients[i] = p; else patients.push(p); },
    activePatient() { return patients[0]; },
    aiCallRaw() { return Promise.resolve('unused'); }
  };
  context.window = context;
  vm.runInNewContext(modelSource, context, { filename: 'visit-model.js' });
  return { context, patients };
}

const VERIFIED = { source: 'athena-copy', identityVerified: true, identityBinding: 'pt-1' };
function shell(context, extra) {
  /* an index-only dated shell, as the organized chart reader creates */
  return context.__mlsVisitModel.addVisit('pt-1', Object.assign({ date: '2026-08-07', type: 'Office visit' }, extra || {}), Object.assign({}, VERIFIED, { indexOnly: true }));
}
const FULL_BODY = 'Diagnoses: lumbar radiculopathy\nPlan: continue conservative care and follow up in four weeks. Full encounter body text.';

/* ---- 1. TWO keyless same-day shells + a keyed full row => APPEND, no guess ---- */
{
  const { context, patients } = makeContext();
  const M = context.__mlsVisitModel;
  const s1 = shell(context, { type: 'Office visit AM' });
  const s2 = shell(context, { type: 'Office visit PM' });
  assert(s1 && s2, 'shells did not store');
  const full = M.addVisit('pt-1', { date: '2026-08-07', type: 'Injection', encounterId: 'enc-2', fullDetail: true, raw: FULL_BODY }, Object.assign({}, VERIFIED, { bodyComplete: true }));
  assert(full, 'full row did not store');
  const rows = patients[0].visits;
  assert.strictEqual(rows.length, 3, 'ambiguous same-day shells were not preserved (a shell was hydrated by guess)');
  assert(!rows.some(v => v.indexOnly === true && /Full encounter body/.test(String(v.raw || ''))), 'a shell absorbed the body');
}

/* ---- 2. shell carrying the SAME encounterId => upgraded in place ---- */
{
  const { context, patients } = makeContext();
  const M = context.__mlsVisitModel;
  shell(context, { type: 'Office visit AM' });
  const keyed = shell(context, { type: 'Injection', encounterId: 'enc-9' });
  assert(keyed, 'keyed shell did not store');
  M.addVisit('pt-1', { date: '2026-08-07', type: 'Injection', encounterId: 'enc-9', fullDetail: true, raw: FULL_BODY }, Object.assign({}, VERIFIED, { bodyComplete: true }));
  const rows = patients[0].visits;
  assert.strictEqual(rows.length, 2, 'the matching-key shell was not upgraded in place');
  const upgraded = rows.find(v => String(v.encounterId) === 'enc-9');
  assert(/Full encounter body/.test(String(upgraded.raw || '')), 'the body did not land on the matching-key row');
}

/* ---- 3. ONE keyless shell + keyed incoming => safe upgrade (unambiguous) ---- */
{
  const { context, patients } = makeContext();
  const M = context.__mlsVisitModel;
  shell(context, { type: 'Office visit' });
  M.addVisit('pt-1', { date: '2026-08-07', type: 'Injection', encounterId: 'enc-1', fullDetail: true, raw: FULL_BODY }, Object.assign({}, VERIFIED, { bodyComplete: true }));
  assert.strictEqual(patients[0].visits.length, 1, 'the lone same-day shell was not upgraded');
}

/* ---- 4. lone shell with a CONFLICTING stable key => append, never weld ---- */
{
  const { context, patients } = makeContext();
  const M = context.__mlsVisitModel;
  shell(context, { type: 'Office visit', encounterId: 'enc-A' });
  M.addVisit('pt-1', { date: '2026-08-07', type: 'Injection', encounterId: 'enc-B', fullDetail: true, raw: FULL_BODY }, Object.assign({}, VERIFIED, { bodyComplete: true }));
  const rows = patients[0].visits;
  assert.strictEqual(rows.length, 2, 'a conflicting-key shell was welded to a different encounter');
  const shellRow = rows.find(v => String(v.encounterId) === 'enc-A');
  assert(!/Full encounter body/.test(String(shellRow.raw || '')), 'the conflicting-key shell absorbed the body');
}

/* ---- 5. px-e1: candidate date-key treats dash/dot dates as the same day ---- */
{
  const candPath = path.join(root, 'extension-candidates', '3.0.45', 'background.js');
  const rootPath = path.join(root, 'background.js');
  const bgSource = fs.readFileSync(fs.existsSync(candPath) ? candPath : rootPath, 'latin1');
  const i = bgSource.indexOf('function mlsVisitDateKeyForHint');
  assert(i >= 0, 'mlsVisitDateKeyForHint not found');
  const j = bgSource.indexOf('function freezeVisitHint', i);
  assert(j > i, 'freezeVisitHint anchor not found');
  let seg = bgSource.slice(i, j);
  const cut = seg.indexOf('/* px-e1');
  if (cut >= 0) seg = seg.slice(0, cut);
  seg = seg.trim();
  const fn = new Function('return ' + seg.replace(/^function mlsVisitDateKeyForHint/, 'function'))();
  assert.strictEqual(fn('7/21/2026'), '2026-07-21');
  assert.strictEqual(fn('07-21-2026'), '2026-07-21', 'dash-separated athena dates still key to "" - the visit-notes-OFF day lane skips every row');
  assert.strictEqual(fn('07.21.2026'), '2026-07-21', 'dot-separated dates still key to ""');
  assert.strictEqual(fn('2026-7-3'), '2026-07-03', 'loose ISO mis-keys');
  assert.strictEqual(fn('no date'), '', 'garbage produced a key');
}

console.log('same-day-shell-upgrade-contract: PASS (14 checks)');
