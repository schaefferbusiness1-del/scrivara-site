'use strict';
/* ptfix-1.0.0 (b1169) — THE PATIENTS / DUPLICATE-MERGE / ADD-PATIENT SURFACE.
 *
 * Ten measured defects on the one surface where a mistake creates or destroys a
 * chart. Each is pinned here by the PROPERTY that was wrong, executed against
 * stubs wherever the code can be run, so a refactor that keeps the behaviour
 * keeps the suite green and a regression that restores the behaviour reds it.
 *
 *   5.  The auto-merge deleted the absorbed chart LOCALLY only. /api/patients
 *       still held the row and hydration re-adds any server row the local index
 *       lacks, so the duplicate came back every boot, vanished 12s later, and
 *       the "nothing was lost" toast fired again after every pull - forever.
 *   6.  A REFUSED save was swallowed by safe() (which cannot tell a throw from
 *       savePatients' undefined success), and the alias map was written and the
 *       success toast fired anyway.
 *   7.  Add-patient attached to an existing chart on NAME ALONE whenever either
 *       side had no DOB - cross-patient contamination on the CREATE path, and
 *       weaker than the law: MRN, or name+DOB, or a confirmed suggestion.
 *   8.  With a provider filter armed, a real patient was reported as "No patient
 *       matching X" under a one-click button that MINTS a duplicate.
 *   9.  The merged winner was mutated in place with no dirtyIds and no
 *       `updated` bump, so the store's reference-comparison delta never saw it:
 *       the absorbed visits and team notes reached neither the account nor a
 *       second tab.
 *   10. The winner test was /^mr/ on the id - which no minter in the tree
 *       produces - so it selected hand-typed rows created in a 25-day window
 *       and nothing at all after 2026-07-25.
 *   11. History's cap footer used the WHOLE history as its denominator while
 *       the header ten pixels above used the narrowed one.
 *   12. Server hydration replaced a patient record wholesale with no team-notes
 *       carry, dropping a note the account had never seen.
 *   13. The only post-merge repaint called window.loadPatients, which has no
 *       definition anywhere in the tree - a guaranteed no-op behind a
 *       feature-detect guard.
 *   14. The delete dialog enumerated what survives and never said the shared
 *       Team notes thread (and the uploaded documents) go with the record.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');

const MERGE = 'feat_mls_patient_merge.js';
const ADD = 'feat_addpatient.js';
const mergeSrc = read(MERGE);
const addSrc = read(ADD);
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];

/* a module that cannot parse proves nothing */
new Function(mergeSrc);
new Function(addSrc);

/* slice a top-level function by its own braces */
function liftFn(text, name) {
  const i = text.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing function ' + name);
  let d = 0, e = -1;
  const j = text.indexOf('{', i);
  for (let k = j; k < text.length; k++) {
    const c = text[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  assert.ok(e > 0, 'unbalanced function ' + name);
  return text.slice(i, e);
}
/* anchor slicing, for bodies whose template literals defeat brace counting */
function between(text, startMark, endMark, label) {
  const a = text.indexOf(startMark);
  assert.ok(a >= 0, label + ': start anchor missing (' + startMark + ')');
  const b = text.indexOf(endMark, a + startMark.length);
  assert.ok(b > a, label + ': end anchor missing (' + endMark + ')');
  return text.slice(a, b);
}

/* =====================================================================
   THE MERGE SANDBOX - the real module, executed
   ===================================================================== */
function mergeSandbox(pts, opts) {
  opts = opts || {};
  const timers = [];
  const store = {};
  const saves = [];
  const toasts = [];
  const upserts = [];
  const rendered = [];
  const deleted = [];
  const listEl = { _mlsRoster: 'STALE', _mlsNotesVer: 'STALE', _mlsSig: 'STALE' };
  let patients = pts;
  let activeId = opts.activeId || '';
  const ctx = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    document: { getElementById(id) { return id === 'ptList' ? listEl : null; } }
  };
  ctx.window = ctx;
  ctx.window.addEventListener = function () {};
  ctx.window.removeEventListener = function () {};
  ctx.getPatients = function () { return patients; };
  ctx.savePatients = function (arr, key, o) {
    saves.push({ arr: arr, opts: o });
    if (opts.saveThrows) { const e = new Error('Local storage is full'); e.code = 'MLS_PTS_STORE_QUOTA'; throw e; }
    patients = arr;
    return undefined;
  };
  ctx.toast = function (msg, tone) { toasts.push({ msg: String(msg), tone: String(tone || '') }); };
  ctx.renderPatients = function () { rendered.push('patients'); };
  ctx.renderProfile = function () { rendered.push('profile'); };
  ctx.renderPatientBar = function () { rendered.push('bar'); };
  ctx.upsertPatient = function (p) { upserts.push(p); };
  ctx.getActivePtId = function () { return activeId; };
  ctx.setActivePtId = function (id) { activeId = String(id); };
  if (opts.serverDelete) {
    ctx.deletePatientOnServer = function (id) { deleted.push(String(id)); return opts.serverDelete(String(id)); };
  }
  vm.createContext(ctx);
  vm.runInContext(mergeSrc, ctx);
  return {
    ctx: ctx, timers: timers, saves: saves, toasts: toasts, upserts: upserts,
    rendered: rendered, deleted: deleted, listEl: listEl, store: store,
    patients: function () { return patients; },
    active: function () { return activeId; },
    aliases: function () { return JSON.parse(store['mls_patient_alias_v1'] || '{}'); }
  };
}

/* the pair every merge case below uses: same human by MRN, one chart pulled
   from Athena's schedule and one hand-typed with MORE visits (so the visit
   tiebreak alone would pick the wrong one) and an 'mr' id (so the old rule
   would too). */
const DUP = () => ([
  { id: 'p_sched_aa', name: 'Adam Schaeffer', dob: '1980-02-11', mrn: '7833832', source: 'athena-schedule', visits: [{ date: '2026-08-17', raw: 'a' }] },
  { id: 'mr9zzz', name: 'Adam Schaeffer', dob: '1980-02-11', mrn: '7833832', source: 'manual-add', visits: [{ date: '2026-07-02', raw: 'b' }, { date: '2026-07-03', raw: 'c' }] }
]);

/* =====================================================================
   ADD-PATIENT SANDBOX - the real module, executed
   ===================================================================== */
function addSandbox(patients) {
  const timers = [];
  const upserts = [];
  const ctx = {
    console, Promise, Date, Math, JSON, Object, String, Array, RegExp, Number, Boolean,
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {},
    document: {
      readyState: 'complete',
      getElementById() { return null; },
      querySelector() { return null; },
      addEventListener() {}, removeEventListener() {},
      createElement() { return { style: {}, addEventListener() {}, setAttribute() {} }; },
      head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
    },
    __mlsVisitModel: { _normDob(v) { return String(v || '').replace(/\D/g, ''); }, addVisit() {}, ensureSummaries() { return Promise.resolve(); }, getVisits(p) { return p.visits || []; } },
    getPatients() { return patients; },
    upsertPatient(p) {
      upserts.push(p);
      const i = patients.findIndex((x) => x && x.id === p.id);
      if (i >= 0) patients[i] = p; else patients.push(p);
    },
    setActivePtId() {}, selectPatient() {}, renderPatients() {}, renderProfile() {}
  };
  ctx.window = ctx;
  vm.runInNewContext(addSrc, ctx, { filename: ADD });
  return { ctx: ctx, api: ctx.__mlsAddPatient, upserts: upserts, patients: function () { return patients; } };
}

async function main() {

/* ---------------------------------------------------------------------
   10. THE WINNER IS RANKED ON PROVENANCE, NOT ON AN ID SPELLING
   --------------------------------------------------------------------- */
{
  ok(!/\/\^mr\/\.test/.test(mergeSrc),
    'item 10: the /^mr/ id test is back - it selects hand-typed rows minted 2026-06-30..2026-07-25 and NOTHING after, which is the inverse of the documented rule');

  const api = mergeSandbox(DUP()).ctx.window.__mlsPatientMerge;
  eq(typeof api.provRank, 'function', 'item 10: provRank must be exported so the ranking is testable');
  ok(api.provRank({ athenaChartImportedAt: '2026-08-30T10:00:00Z' }) > api.provRank({ id: 'p_sched_x', source: 'athena-schedule' }),
    'item 10: a landed Athena chart must outrank a scheduled row');
  ok(api.provRank({ id: 'p_sched_x', source: 'athena-schedule' }) > api.provRank({ id: 'mr000000', source: 'manual-add' }),
    'item 10: an Athena-scheduled row must outrank a hand-typed manual-add row');
  /* THE DEFECT, executed: the hand-typed 'mr...' row also has MORE visits, so
     nothing downstream would have rescued it. */
  const wl = api.winnerOf(
    { id: 'mr9zzz', source: 'manual-add', dob: '1980-02-11', visits: [1, 2] },
    { id: 'p_sched_aa', source: 'athena-schedule', dob: '1980-02-11', visits: [1] }
  );
  eq(wl[0].id, 'p_sched_aa', 'item 10: the hand-typed chart beat the Athena-sourced one - a typed DOB would overwrite the pulled one');

  /* a discarded identity value is RECORDED, not dropped */
  const sb2 = mergeSandbox([
    { id: 'p_sched_aa', name: 'Adam Schaeffer', dob: '1980-02-11', mrn: '7833832', sex: 'M', source: 'athena-schedule', visits: [{ date: '1', raw: 'x' }] },
    { id: 'zz2', name: 'Adam Schaeffer', dob: '1980-02-11', mrn: '7833832', sex: 'F', source: 'manual-add', visits: [] }
  ]);
  sb2.ctx.window.__mlsPatientMerge.run({ silent: true });
  const survivor = sb2.patients()[0];
  ok(Array.isArray(survivor.mergedConflicts) && survivor.mergedConflicts.length === 1,
    'item 10: a conflicting non-empty identity value was dropped with no record');
  eq(survivor.mergedConflicts[0].field, 'sex', 'item 10: the conflict must name its field');
  eq(survivor.mergedConflicts[0].kept, 'M', 'item 10: the conflict must record what was kept');
  eq(survivor.mergedConflicts[0].discarded, 'F', 'item 10: the conflict must record what was discarded');
  const sb3 = mergeSandbox(DUP());
  sb3.ctx.window.__mlsPatientMerge.run({ silent: true });
  eq(sb3.patients()[0].mergedConflicts, undefined, 'item 10: a merge with no disagreement must not mint mergedConflicts');
}

/* ---------------------------------------------------------------------
   9. THE SURVIVOR IS A COPY, MARKED DIRTY, STAMPED, AND PUSHED
   --------------------------------------------------------------------- */
{
  const rows = DUP();
  const winnerRef = rows[0];
  const sb = mergeSandbox(rows);
  const out = sb.ctx.window.__mlsPatientMerge.run({ silent: true });
  eq(out.merged, 1, 'item 9: the exact-MRN duplicate pair must merge');
  eq(sb.saves.length, 1, 'item 9: exactly one removing save');

  const savedOpts = sb.saves[0].opts || {};
  eq(savedOpts.allowRemovals, true, 'item 9: the removing save must still carry {allowRemovals:true}');
  ok(Array.isArray(savedOpts.dirtyIds), 'item 9: the save carries NO dirtyIds - the store cannot see an in-place edit and journals nothing');
  ok(savedOpts.dirtyIds.indexOf('p_sched_aa') >= 0, 'item 9: the survivor id is missing from dirtyIds');
  ok(savedOpts.dirtyIds.indexOf('mr9zzz') < 0, 'item 9: a REMOVED row must not be listed as dirty');

  const savedWinner = sb.saves[0].arr.filter(function (r) { return r && r.id === 'p_sched_aa'; })[0];
  ok(savedWinner, 'item 9: the survivor must be in the saved list');
  ok(savedWinner !== winnerRef,
    'item 9: the survivor handed to savePatients is the SAME OBJECT the store already holds - computeDelta compares by reference, so it lands in neither delta.put nor the journal');
  ok(Number(savedWinner.updated) > 0, 'item 9: the survivor must be stamped `updated`');
  eq(winnerRef.visits.length, 1, 'item 9: the ORIGINAL stored row must not have been mutated in place');

  eq(sb.upserts.length, 1, 'item 9: the survivor never reached the account - savePatients does not feed the server queue');
  eq(sb.upserts[0].id, 'p_sched_aa', 'item 9: the wrong record was pushed to the account');
  eq(sb.upserts[0], savedWinner, 'item 9: the account must receive the merged survivor, not a stale copy');
  eq(savedWinner.visits.length, 3, 'item 9: the absorbed visits must be on the survivor');
  ok(savedWinner.visits.some(function (v) { return v && v.mergedFrom === 'mr9zzz'; }), 'item 9: a moved visit must be stamped for audit');
  ok(!rows[1].visits.some(function (v) { return v && v.mergedFrom; }),
    'item 9: the loser\'s stored visit objects were stamped in place before the save committed');
}

/* the team notes of BOTH charts reach the account on the survivor */
{
  const rows = DUP();
  rows[0].teamNotes = [{ v: 1, id: 'tn_w', at: 500, author: 'Dr A', text: 'winner', ai: false }];
  rows[1].teamNotes = [{ v: 1, id: 'tn_l', at: 400, author: 'Dr B', text: 'loser', ai: false }];
  const sb = mergeSandbox(rows);
  sb.ctx.window.__mlsPatientMerge.run({ silent: true });
  const savedWinner = sb.saves[0].arr.filter(function (r) { return r && r.id === 'p_sched_aa'; })[0];
  eq(savedWinner.teamNotes.length, 2, 'item 9: both team threads must survive on the survivor');
  eq(sb.upserts[0].teamNotes.length, 2, 'item 9: the absorbed team notes must be the copy pushed to the account');
  eq(rows[0].teamNotes.length, 1, 'item 9: the stored row\'s own thread must not be rewritten before the save commits');
}

/* ---------------------------------------------------------------------
   13. THE POST-MERGE REPAINT IS ONE THAT EXISTS
   --------------------------------------------------------------------- */
{
  ok(!/window\.loadPatients\s*\(/.test(mergeSrc),
    'item 13: window.loadPatients is back - it has NO definition anywhere in the shipped tree, so the repaint is a guaranteed no-op behind a typeof guard');
  for (const shell of SHELLS) {
    const html = read(shell);
    ok(!/function\s+loadPatients\s*\(/.test(html) && !/window\.loadPatients\s*=(?!=)/.test(html),
      shell + ': loadPatients gained a definition - re-aim item 13, the merge may call it again');
  }
  /* the server verdict is deliberately left IN FLIGHT: the repaint and the
     selection follow must both be complete before it lands, or the doctor
     stares at a dead row for a network round trip. */
  const sb = mergeSandbox(DUP(), { activeId: 'mr9zzz', serverDelete: function () { return new Promise(function () {}); } });
  sb.ctx.window.__mlsPatientMerge.run({ silent: true });
  ok(sb.rendered.indexOf('patients') >= 0, 'item 13: the Patients list was never repainted - the absorbed row keeps painting');
  ok(sb.rendered.indexOf('profile') >= 0, 'item 13: the profile was never repainted');
  ok(sb.rendered.indexOf('bar') >= 0, 'item 13: the patient bar was never repainted');
  eq(sb.listEl._mlsRoster, null, 'item 13: the roster memo must be cleared or renderPatients returns early and the repaint does nothing');
  eq(sb.listEl._mlsSig, '', 'item 13: the roster signature memo must be cleared too');
  eq(Object.keys(sb.aliases()).length, 0, 'item 13: no verdict has arrived, so no alias can exist yet');
  eq(sb.active(), 'p_sched_aa',
    'item 13: the doctor was left selected on a chart that no longer exists - the follow must not wait on the server verdict that gates the alias map');
}

/* ---------------------------------------------------------------------
   6. A FAILED SAVE FAILS CLOSED - no alias, no success toast
   --------------------------------------------------------------------- */
{
  const sb = mergeSandbox(DUP(), { saveThrows: true });
  const out = sb.ctx.window.__mlsPatientMerge.run({ silent: false });
  eq(out.merged, 0, 'item 6: a refused save must not report a merge');
  eq(out.reason, 'save-failed', 'item 6: the refusal must be stated honestly');
  eq(Object.keys(sb.aliases()).length, 0,
    'item 6: THE ALIAS MAP WAS WRITTEN AFTER A REFUSED SAVE - every later lookup of the absorbed id resolves to a chart that was never merged');
  eq(sb.patients().length, 2, 'item 6: both charts must still be in the store after a refused save');
  eq(sb.upserts.length, 0, 'item 6: nothing may be pushed to the account after a refused save');
  eq(sb.toasts.length, 1, 'item 6: exactly one message must be shown');
  ok(!/nothing was lost/i.test(sb.toasts[0].msg),
    'item 6: THE FAILURE TOASTED SUCCESS - "nothing was lost" is the one message that is supposed to prove data safety');
  eq(sb.toasts[0].tone, 'err', 'item 6: a refused merge must not be reported in the success tone');
  ok(/could not/i.test(sb.toasts[0].msg) && /still here/i.test(sb.toasts[0].msg),
    'item 6: the failure message must say what actually happened');
  const sb2 = mergeSandbox(DUP(), { saveThrows: true });
  sb2.ctx.window.__mlsPatientMerge.run({ silent: true });
  eq(sb2.toasts.length, 0, 'item 6: the boot sweep must stay silent on failure too');
}

/* ---------------------------------------------------------------------
   5. THE ABSORBED CHART DIES ON THE SERVER; THE ALIAS FOLLOWS THE VERDICT
   --------------------------------------------------------------------- */
{
  const sb = mergeSandbox(DUP(), { serverDelete: function () { return Promise.resolve({ ok: true, reason: 'deleted' }); } });
  const out = sb.ctx.window.__mlsPatientMerge.run({ silent: false });
  eq(out.merged, 1, 'item 5: the pair must merge');
  eq(out.serverDeletes, 'pending', 'item 5: the run must report that server deletes are in flight');
  eq(sb.deleted.length, 1, 'item 5: THE ABSORBED ROW WAS NEVER DELETED ON THE SERVER - hydration re-adds it on the next boot');
  eq(sb.deleted[0], 'mr9zzz', 'item 5: the wrong id was deleted on the server');
  await sb.ctx.window.__mlsPatientMergeLastServerDeletes;
  eq(sb.aliases()['mr9zzz'], 'p_sched_aa', 'item 5: a confirmed server delete must write the alias');
  eq(sb.toasts.length, 1, 'item 5: exactly one message');
  ok(/nothing was lost/.test(sb.toasts[0].msg), 'item 5: a fully durable merge still says so');
  eq(sb.toasts[0].tone, 'ok', 'item 5: a fully durable merge is a success');
}
{
  /* a FAILED server delete: no alias, and the toast tells the truth */
  const sb = mergeSandbox(DUP(), { serverDelete: function () { return Promise.resolve({ ok: false, reason: 'http-500' }); } });
  sb.ctx.window.__mlsPatientMerge.run({ silent: false });
  await sb.ctx.window.__mlsPatientMergeLastServerDeletes;
  eq(Object.keys(sb.aliases()).length, 0,
    'item 5: an alias was written for a row that is still on the server - the resurrected chart would redirect to the survivor');
  eq(sb.toasts.length, 1, 'item 5: exactly one message');
  ok(!/nothing was lost/.test(sb.toasts[0].msg),
    'item 5: a half-durable merge claimed "nothing was lost" - the duplicate is coming back');
  ok(/account/i.test(sb.toasts[0].msg) && /come back/i.test(sb.toasts[0].msg) && /http-500/.test(sb.toasts[0].msg),
    'item 5: the partial failure must name the account, the consequence and the reason');
  eq(sb.toasts[0].tone, 'err', 'item 5: a half-durable merge is not a success');
}
{
  /* a THROWING helper must not take the merge down */
  const sb = mergeSandbox(DUP(), { serverDelete: function () { return Promise.reject(new Error('boom')); } });
  const out = sb.ctx.window.__mlsPatientMerge.run({ silent: true });
  eq(out.merged, 1, 'item 5: a throwing server delete must not undo the local merge');
  await sb.ctx.window.__mlsPatientMergeLastServerDeletes;
  eq(Object.keys(sb.aliases()).length, 0, 'item 5: a throwing server delete must not write the alias');
}
{
  /* no helper at all = no account copy this merge could have left behind */
  const sb = mergeSandbox(DUP());
  const out = sb.ctx.window.__mlsPatientMerge.run({ silent: true });
  eq(out.serverDeletes, 'helper-missing', 'item 5: a missing helper must be REPORTED, not silently skipped');
  eq(sb.aliases()['mr9zzz'], 'p_sched_aa', 'item 5: with no server layer at all the local removal is the whole truth and the alias is safe');
}

/* ---------------------------------------------------------------------
   7. ADD-PATIENT: MRN, OR NAME+DOB, OR A CONFIRMED SUGGESTION
   --------------------------------------------------------------------- */
{
  /* THE DEFECT: same common name, the stored chart has no DOB. */
  const rows = [{ id: 'A', name: 'Adam Schaeffer', dob: '', mrn: '', visits: [], source: 'athena-schedule' }];
  const sb = addSandbox(rows);
  eq(sb.api._findExisting('Adam Schaeffer', '02/11/1980', ''), null,
    'item 7: a NAME-ONLY hit still auto-attaches - the new patient\'s visits are filed into somebody else\'s chart');
  const res = sb.api._createOrFindPatient({ name: 'Adam Schaeffer', dob: '02/11/1980', mrn: '', sex: '', phone: '' });
  eq(res.needsConfirm, true, 'item 7: a weak identity match must become a confirm step');
  eq(res.patient, null, 'item 7: a weak match must not resolve to a patient');
  eq(sb.upserts.length, 0, 'item 7: NOTHING may be written while the doctor has not decided');
  eq(rows.length, 1, 'item 7: no chart may be minted while the doctor has not decided');
  ok(res.candidates.length === 1 && res.candidates[0].id === 'A', 'item 7: the near-match must be offered as a candidate');
  ok(/date of birth/i.test(res.candidates[0].why), 'item 7: the candidate must say WHY it is only a suggestion');

  /* the doctor says "same person" -> attach, and the new DOB fills the gap */
  const yes = sb.api._createOrFindPatient({ name: 'Adam Schaeffer', dob: '02/11/1980', mrn: '', sex: '', phone: '' }, { attachToId: 'A' });
  eq(yes.patient.id, 'A', 'item 7: a confirmed attach must reach the confirmed chart');
  eq(yes.created, false, 'item 7: a confirmed attach must not report a creation');
  eq(yes.confirmed, true, 'item 7: a confirmed attach must be marked as confirmed');
  eq(rows[0].dob, '02/11/1980', 'item 7: a confirmed attach may fill an empty demographic');

  /* the doctor says "someone else" -> a new chart, never the existing one */
  const rows2 = [{ id: 'A', name: 'Adam Schaeffer', dob: '', mrn: '', visits: [] }];
  const sb2 = addSandbox(rows2);
  const no = sb2.api._createOrFindPatient({ name: 'Adam Schaeffer', dob: '', mrn: '', sex: '', phone: '' }, { confirmedNew: true });
  eq(no.created, true, 'item 7: a confirmed NEW must mint a chart');
  ok(no.patient.id !== 'A', 'item 7: a confirmed NEW must not land in the existing chart');
  eq(rows2.length, 2, 'item 7: the new chart must be stored');
}
{
  /* the law's two automatic paths still work, silently and immediately */
  const rows = [
    { id: 'A', name: 'Adam Schaeffer', dob: '1980-02-11', mrn: '7833832', visits: [] },
    { id: 'B', name: 'Someone Else', dob: '1971-03-04', mrn: '1112223', visits: [] }
  ];
  const sb = addSandbox(rows);
  /* name + DOB, written in the two formats the app actually stores */
  const nd = sb.api._createOrFindPatient({ name: 'adam  schaeffer', dob: '02/11/1980', mrn: '', sex: '', phone: '' });
  eq(nd.patient.id, 'A', 'item 7: a name+DOB match must still auto-attach - MM/DD/YYYY and YYYY-MM-DD are the same day');
  eq(nd.needsConfirm, undefined, 'item 7: a name+DOB match must not ask');
  /* MRN alone is enough by the same law */
  const byMrn = sb.api._createOrFindPatient({ name: 'A Schaeffer-Smith', dob: '', mrn: '7833832', sex: '', phone: '' });
  eq(byMrn.patient.id, 'A', 'item 7: an MRN match must auto-attach');
  /* an MRN whose DOB contradicts is NOT the same human */
  const veto = sb.api._createOrFindPatient({ name: 'Adam Schaeffer', dob: '1999-01-01', mrn: '7833832', sex: '', phone: '' });
  ok(!veto.patient || veto.patient.id !== 'A', 'item 7: an MRN hit with a CONTRADICTING date of birth must never auto-attach');
  /* a free-text DOB is not an identity */
  eq(sb.api._dobKey('sometime in 1980'), '', 'item 7: only a canonical date may act as an identity key');
  eq(sb.api._dobKey('02/11/1980'), '1980-02-11', 'item 7: MM/DD/YYYY must canonicalize');
}
{
  /* ambiguity is fail-closed: two charts claiming the same name+DOB attach to
     neither, and the middle-initial case is OFFERED rather than minted blind */
  const rows = [
    { id: 'A', name: 'Adam Schaeffer', dob: '1980-02-11', visits: [] },
    { id: 'B', name: 'Adam Schaeffer', dob: '1980-02-11', visits: [] }
  ];
  const sb = addSandbox(rows);
  eq(sb.api._findExisting('Adam Schaeffer', '1980-02-11', ''), null,
    'item 7: two charts claim this identity - attaching to either is a coin flip');

  const rows2 = [{ id: 'A', name: 'Adam J Schaeffer', dob: '1980-02-11', visits: [] }];
  const sb2 = addSandbox(rows2);
  ok(sb2.api._nameCompatible('Adam Schaeffer', 'Adam J Schaeffer'), 'item 7: a middle initial must not make two humans');
  const sugg = sb2.api._findSuggestions('Adam Schaeffer', '1980-02-11', '');
  ok(sugg.length === 1 && sugg[0].id === 'A',
    'item 7: the exact-string compare mints a duplicate for "Adam Schaeffer" vs "Adam J Schaeffer" - it must be offered instead');
}
{
  /* BOTH save paths of the shipped modal take the same gate */
  const doSave = liftFn(addSrc, 'doSave');
  const doAthena = liftFn(addSrc, 'doAthena');
  for (const [name, body] of [['doSave', doSave], ['doAthena', doAthena]]) {
    const call = body.indexOf('createOrFindPatient(details');
    ok(call > 0, 'item 7: ' + name + ' no longer resolves identity through createOrFindPatient');
    const guard = body.indexOf('needsConfirm');
    ok(guard > call, 'item 7: ' + name + ' does not check needsConfirm after resolving identity');
    /* the write must come AFTER the guard, never before it */
    const write = body.indexOf('addVisit(');
    if (write >= 0) ok(guard < write, 'item 7: ' + name + ' writes a visit before the identity is settled');
  }
}

/* ---------------------------------------------------------------------
   8. AN ARMED PROVIDER FILTER NEVER OFFERS TO MINT A DUPLICATE
   --------------------------------------------------------------------- */
for (const shell of SHELLS) {
  const html = read(shell);
  const body = between(html, 'var _plvNarrowed=matched.length!==_plvBefore;', 'if(noMatch) noMatch.style.display=\'none\';', shell + ' renderPatients empty-state');
  const CLEAR = 'onclick="_mlsPtShowAllProviders()"';
  const MINT = 'onclick="newPatientFromSearch()"';
  const iFiltered = body.indexOf(CLEAR);
  const iMint = body.indexOf(MINT);
  ok(iFiltered > 0, shell + ' item 8: the filtered empty state offers no way to clear the filter');
  ok(iMint > 0, shell + ' item 8: the ordinary "add as a new patient" path disappeared');
  ok(iFiltered < iMint,
    shell + ' item 8: the provider-filter branch must be reached BEFORE the mint button - otherwise a real patient of another provider is offered as a new chart');
  /* the filtered branch must not carry a mint button of its own */
  const filteredBranch = body.slice(body.indexOf('if(!matchCount && _plvNarrowed'), iMint);
  ok(filteredBranch.indexOf(MINT) < 0,
    shell + ' item 8: the filtered empty state still offers to create a duplicate');
  ok(/_plvBefore/.test(filteredBranch) && /all providers/i.test(filteredBranch),
    shell + ' item 8: the filtered empty state must report how many match across all providers');
  /* the no-query case is covered by the same branch */
  ok(/if\(!matchCount && _plvNarrowed && _plvBefore>0\)/.test(body),
    shell + ' item 8: the filtered empty state must also cover the no-query case, which used to go blank with no explanation');
}
{
  /* the disarm actually drives the filter's own control and forces a repaint */
  const fn = liftFn(read('1pScribeFlow.html'), '_mlsPtShowAllProviders');
  const sel = { id: 'mlsPlvSel', value: 'dr-jones', changed: 0, onchange: function () { sel.changed++; } };
  const list = { _mlsRoster: 'STALE', _mlsNotesVer: 'STALE', _mlsSig: 'STALE' };
  const removed = [];
  const painted = [];
  const ctx = {
    console, String, Number, Object, Array, Event: function () {},
    document: { getElementById(id) { return id === 'mlsPlvSel' ? sel : id === 'ptList' ? list : null; } },
    localStorage: { removeItem(k) { removed.push(k); } },
    renderPatients() { painted.push(1); }
  };
  ctx.window = ctx;
  vm.runInNewContext(fn + '\n_mlsPtShowAllProviders();', ctx);
  eq(sel.value, '', 'item 8: the provider select must be disarmed');
  eq(sel.changed, 1, 'item 8: the filter\'s OWN writer must persist and repaint - this must not become a second writer');
  eq(removed.length, 0, 'item 8: the localStorage line is a fallback only, for a roster painted before the select mounts');

  /* fallback path: no select mounted yet */
  const list2 = { _mlsRoster: 'STALE', _mlsNotesVer: 'STALE', _mlsSig: 'STALE' };
  const removed2 = [];
  const painted2 = [];
  const ctx2 = {
    console, String, Number, Object, Array, Event: function () {},
    document: { getElementById(id) { return id === 'ptList' ? list2 : null; } },
    localStorage: { removeItem(k) { removed2.push(k); } },
    renderPatients() { painted2.push(1); }
  };
  ctx2.window = ctx2;
  vm.runInNewContext(fn + '\n_mlsPtShowAllProviders();', ctx2);
  eq(removed2[0], 'mls_provider_link_filter_v1', 'item 8: the fallback must clear the sticky filter key the module owns');
  eq(list2._mlsRoster, null, 'item 8: the fallback must clear the roster memo or renderPatients returns early');
  eq(list2._mlsSig, '', 'item 8: the fallback must clear the roster signature');
  eq(painted2.length, 1, 'item 8: the fallback must repaint');
}

/* ---------------------------------------------------------------------
   11. ONE DENOMINATOR FOR ONE LIST
   --------------------------------------------------------------------- */
for (const shell of SHELLS) {
  const html = read(shell);
  const body = between(html, 'function renderHistory(', 'function attachNoteToActive(', shell + ' renderHistory');
  const iTotal = body.indexOf('const total=ordered.length;');
  const iCollapse = body.indexOf('_importNotes=ordered.filter(_isImportNote)');
  const iSearch = body.indexOf('if(q){ ordered=ordered.filter');
  const iMatched = body.indexOf('const matchedTotal=ordered.length;');
  const iCap = body.indexOf('const HIST_CAP=200;');
  ok(iTotal > 0 && iCollapse > iTotal && iSearch > iTotal, shell + ' item 11: renderHistory no longer has the shape this pin describes');
  ok(iMatched > 0, shell + ' item 11: there is still only ONE counter, taken before every narrowing');
  ok(iMatched > iCollapse && iMatched > iSearch,
    shell + ' item 11: the rendered-list counter must be taken AFTER the type filter, the chart-import collapse and the search');
  ok(iMatched < iCap, shell + ' item 11: the counter must be taken BEFORE the 200-row cap, or it measures the cap');
  eq(body.split('const matchedTotal=ordered.length;').length - 1, 1, shell + ' item 11: exactly one narrowed counter');

  const footer = between(body, "if(_histCapped) _histHtml+=", '</div>', shell + ' history cap footer');
  ok(/matchedTotal/.test(footer),
    shell + ' item 11: the cap footer still counts the WHOLE history - "412 of 3000 match" above the list and "the 200 most recent of 3000" under it');
  ok(!/\+total\+/.test(footer), shell + ' item 11: the cap footer must not use the un-narrowed total');

  const count = between(body, "const cntEl=document.getElementById('histCount');", '\n', shell + ' history count line');
  ok(/matchedTotal\+' visit'/.test(count),
    shell + ' item 11: the default-view count still includes the chart-import receipts the list just collapsed out');
}

/* ---------------------------------------------------------------------
   12. HYDRATION CARRIES TEAM NOTES BEFORE IT REPLACES THE RECORD
   --------------------------------------------------------------------- */
for (const shell of SHELLS) {
  const html = read(shell);
  const body = between(html, '// adopt server copy if it is strictly newer', 'if(changed){', shell + ' hydration adopt branch');
  const iCarry = body.indexOf('__mlsTeamNotesCarry(adopted,local[i]);');
  const iReplace = body.indexOf('local[i]=adopted;');
  ok(iCarry > 0,
    shell + ' item 12: server hydration replaces a patient record WHOLESALE with no team-notes carry - a note the account never saw is dropped with nothing to say so');
  ok(iReplace > 0, shell + ' item 12: the adopt branch no longer has the shape this pin describes');
  ok(iCarry < iReplace,
    shell + ' item 12: THE CARRY MUST RUN BEFORE local[i]=adopted - after the replacement there is no previous record left to carry from');
  ok(/_pendingSyncAdd\(row\.external_id\)/.test(body.slice(iCarry, iReplace)),
    shell + ' item 12: a recovered note must be queued to the account, or the next hydration drops it again');
}
{
  /* the carry itself, executed: an unsynced note survives, a tombstone wins */
  const html = read('1pScribeFlow.html');
  const src = liftFn(html, '__mlsTeamNoteRev') + '\n' + liftFn(html, '__mlsTeamNotesUnion') + '\n' +
              liftFn(html, '__mlsTeamNotesCarry') + '\n' + liftFn(html, '__mlsTeamNotesSig');
  const ctx = { console, Number, String, Array, Math, Object, JSON };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const run = (adopted, local) => {
    const before = ctx.__mlsTeamNotesSig(adopted.teamNotes);
    ctx.__mlsTeamNotesCarry(adopted, local);
    return { notes: adopted.teamNotes, changed: ctx.__mlsTeamNotesSig(adopted.teamNotes) !== before };
  };
  /* a note written while the server copy was refused ("Device only") */
  let r = run(
    { teamNotes: [{ id: 'srv', at: 900 }] },
    { teamNotes: [{ id: 'srv', at: 900 }, { id: 'local_unsynced', at: 800 }] }
  );
  eq(r.notes.length, 2, 'item 12: the unsynced local note was replaced away by the server copy');
  eq(r.changed, true, 'item 12: a carry that recovered a note must be detectable, so it can be queued');
  /* a note the server legitimately holds as DELETED stays deleted */
  r = run(
    { teamNotes: [{ id: 'n1', at: 100, del: true, delAt: 900 }] },
    { teamNotes: [{ id: 'n1', at: 100 }] }
  );
  eq(r.notes.length, 1, 'item 12: the union must not double a note present on both sides');
  eq(r.notes[0].del, true, 'item 12: THE CARRY RESURRECTED A DELETED NOTE - the server tombstone must win');
  eq(r.changed, false, 'item 12: a carry that recovered nothing must not queue a pointless push');
  /* an EDIT the server has not seen is a recovery too, at the same length */
  r = run(
    { teamNotes: [{ id: 'n1', at: 100 }] },
    { teamNotes: [{ id: 'n1', at: 100, ed: 950, text: 'edited here' }] }
  );
  eq(r.notes.length, 1, 'item 12: an edit must not duplicate the note');
  eq(r.changed, true, 'item 12: an unsynced EDIT is invisible to a length compare - the signature must catch it');
}

/* ---------------------------------------------------------------------
   14. THE DELETE DIALOG NAMES WHAT IT DESTROYS
   --------------------------------------------------------------------- */
for (const shell of SHELLS) {
  const html = read(shell);
  ok(html.indexOf('_delMsg+=_mlsPtDeleteLossSentence(_dp);') > 0,
    shell + ' item 14: the delete dialog no longer enumerates what goes WITH the record');
  const fn = liftFn(html, '_mlsPtDeleteLossSentence');
  const ctx = { console, Number, String, Array, Object };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  const say = (p, count) => {
    ctx.__mlsTeamNotes = count == null ? undefined : { countOf: function () { return count; } };
    return ctx._mlsPtDeleteLossSentence(p);
  };
  let s = say({ docs: [1, 2, 3], teamNotes: [{}, {}] }, 2);
  ok(/3 uploaded documents/.test(s), shell + ' item 14: the uploaded documents must be counted, not merely categorised');
  ok(/2 Team notes/.test(s), shell + ' item 14: the shared Team notes thread must be named and counted');
  ok(/covering doctors/.test(s), shell + ' item 14: the doctor must be told what a Team note IS before destroying one');
  s = say({ docs: [], teamNotes: [] }, 0);
  ok(/deleted with it/.test(s), shell + ' item 14: with nothing on the chart the dialog must still name the categories');
  ok(!/\b0 Team note/.test(s), shell + ' item 14: an empty chart must not be described with zeroes');
  s = say({ docs: [1] }, null);
  ok(/1 uploaded document\b/.test(s) && !/documents/.test(s), shell + ' item 14: one document is singular');
  ok(!/Team note\b.*—/.test(s), shell + ' item 14: with the team-notes module absent no thread may be claimed');
  s = say(null, 0);
  ok(/deleted with it/.test(s), shell + ' item 14: a missing record must still produce an honest sentence');
}

console.log('PASS patients-merge-fixes: ' + checks + ' checks');
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
