'use strict';

/* scoperec-1.0.0 / visitid-1.0.0 / scopeempty-1.0.0 - THREE PULL-DATA DEFECTS,
 * MEASURED LIVE 2026-09-01 on the owner's account and PINNED HERE by EXECUTING
 * the shipped slices. No Athena account, no backend, no browser, no PHI.
 *
 * (A) A PROVIDER-SCOPED PULL TOOK ANOTHER PROVIDER'S ROW WITH IT.
 *     After the month job scoped to one PA re-ran 2026-08-31, the
 *     Send-to-Athena sheet stopped offering "Bind to 2026-08-31" for a patient
 *     whose appointment that day belongs to a DIFFERENT physician: the
 *     calendar row that bind reads through was gone, an hour after the same
 *     bind had been offered and used.
 *     THE RULE (scoperec-1.0.0): a provider-scoped snapshot is authoritative
 *     ONLY for that provider's rows on that day. Rows of other providers - and
 *     rows carrying no provider attribution, which can never be PROVED to be
 *     the scanned provider's - stay untouched: never deleted, never
 *     re-attributed. An all-provider snapshot stays authoritative for the
 *     whole day exactly as it is today.
 *
 * (B) A RE-PULL BLANKED A VISIT'S APPOINTMENT ID.
 *     The same patient's visits held 2026-08-31 with appointmentId 16026279
 *     and 2026-08-30 with 16026238; after the re-pulls both read back EMPTY.
 *     Those ids are the write lane's binding keys, so every row of the sheet
 *     went to CANNOT SEND.
 *     THE RULE (visitid-1.0.0): id fields are MONOTONE. A re-pull may ADD or
 *     CONFIRM an id and may never blank one; two different non-empty ids for
 *     one visit keep the STORED id and count the disagreement, because
 *     silently adopting the newer one re-points a bound note at another
 *     encounter and that is not recoverable by re-pulling.
 *
 * (C) AN HONEST EMPTY DAY WAS FILED AS "NEEDS ATTENTION".
 *     The month job flagged 2026-08-28 and 2026-08-30 as needs-attention with
 *     reason provider-not-on-calendar. The importer emits that code from one
 *     branch only: the calendar RENDERED, other clinicians were on it, the
 *     scoped provider was not. For a provider-scoped job that is an honest
 *     EMPTY day for that provider.
 *     THE RULE (scopeempty-1.0.0): checkpoint it complete/empty (0 rows) with
 *     the reason recorded, never as attention - and keep attention for the
 *     case where the calendar itself did not render or navigation failed.
 */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const IMPORTER = fs.readFileSync('1p-feat_mls_schedimport_exact.js', 'utf8');
const RANGE = fs.readFileSync('1p-feat_mls_rangejobs.js', 'utf8');
const SHELL = fs.readFileSync('1pScribeFlow.html', 'utf8');
const SHELL_TWIN = fs.readFileSync('1p/index.html', 'utf8');

let checks = 0;
function ok(cond, message) { checks++; assert.ok(cond, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }

/* ---- the day-note-proof / pull-resume-proof brace walker -------------------
   Comments are recognised BEFORE quotes: every block in these files is
   documented in prose full of apostrophes, and opening quote-mode inside a
   comment desyncs the walker and truncates the slice. */
function balanced(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'slice not found: ' + (label || signature));
  let depth = 0, quote = '', i = source.indexOf('{', start);
  assert(i > start, 'slice has no body: ' + (label || signature));
  for (; i < source.length; i++) {
    const ch = source[i], prev = source[i - 1];
    if (quote) { if (ch === quote && prev !== '\\') quote = ''; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated slice: ' + (label || signature));
}
function statement(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'statement not found: ' + (label || signature));
  const end = source.indexOf('\n', start);
  return source.slice(start, end < 0 ? source.length : end);
}

/* =======================================================================
 * (A) scoperec-1.0.0 - the membership rule, EXECUTED.
 * ===================================================================== */
function scopeRuleContext() {
  const slices = [
    statement(IMPORTER, 'var EST_TZ =', 'EST_TZ'),
    balanced(IMPORTER, 'var PROVIDER_NOISE = {', 'PROVIDER_NOISE') + ';',
    balanced(IMPORTER, 'var PROVIDER_TITLE = {', 'PROVIDER_TITLE') + ';',
    balanced(IMPORTER, 'function providerKey(raw)', 'providerKey'),
    balanced(IMPORTER, 'function firstField(a, fields)', 'firstField'),
    balanced(IMPORTER, 'function p1RowProviderName(a)', 'p1RowProviderName'),
    balanced(IMPORTER, 'function backendRowId(row)', 'backendRowId'),
    balanced(IMPORTER, 'function accountDayFromInstant(value)', 'accountDayFromInstant'),
    balanced(IMPORTER, 'function normDate(d)', 'normDate'),
    balanced(IMPORTER, 'function localDayOf(row)', 'localDayOf'),
    balanced(IMPORTER, 'function scopedDayReconcile(storedRows, snapshot)', 'scopedDayReconcile'),
    balanced(IMPORTER, 'function otherScopeSignature(entry, mode, providerKey_)', 'otherScopeSignature')
  ].join('\n');
  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp, Intl, isFinite,
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    isFn(f) { return typeof f === 'function'; },
    gfn() { return null; }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slices, ctx, { filename: 'scoperec-slices.js' });
  return { ctx, sandbox };
}

function proveScopeRule() {
  const { ctx, sandbox } = scopeRuleContext();
  const key = name => { sandbox.__n = name; return vm.runInContext('providerKey(__n)', ctx); };
  const UYEN = key('Uyen Phan, PA-C');
  const MATT = key('Matthew Schaeffer, MD');
  ok(UYEN && MATT && UYEN !== MATT, 'the two live provider labels do not key apart, so this suite could not tell the scopes apart');

  /* The live shape of 2026-08-31: the scoped provider's rows, the physician's
     row the bind cure reads through, one row nobody attributed, and a row on
     the neighbouring day. */
  const rows = () => ([
    { id: 'b1', appt_date: '2026-08-31', provider: 'Uyen Phan, PA-C', name: 'Scoped Kept' },
    { id: 'b2', appt_date: '2026-08-31', provider: 'Uyen Phan, PA-C', name: 'Scoped Stale' },
    { id: 'b3', appt_date: '2026-08-31', provider: 'Matthew Schaeffer, MD', name: 'Other Provider' },
    { id: 'b4', appt_date: '2026-08-31', provider: '', name: 'Unattributed' },
    { id: 'b5', appt_date: '2026-08-30', provider: 'Uyen Phan, PA-C', name: 'Other Day' }
  ]);
  const run = (day, snap) => { sandbox.__rows = day; sandbox.__snap = snap; return vm.runInContext('scopedDayReconcile(__rows, __snap)', ctx); };

  /* A1. THE SCOPED SNAPSHOT. Only the scanned provider's rows are in scope. */
  const day = rows();
  const before = JSON.stringify([day[2], day[3]]);
  const scoped = run(day, { v: 1, date: '2026-08-31', mode: 'selected', providerKey: UYEN, backendIds: ['b1'], sourceCount: 1 });
  eq(scoped.authoritative, true, 'a complete provider-scoped snapshot was refused as non-authoritative');
  eq(scoped.reason, 'provider-scoped', 'the scoped verdict is not named');
  eq(scoped.rowsOnDay, 4, 'the rule counted rows from another day, or missed rows on this one');
  eq(scoped.keep.map(r => r.id).join(','), 'b1', 'the scoped snapshot did not keep the row it named');
  eq(scoped.replace.map(r => r.id).join(','), 'b2', 'a provider-scoped snapshot claimed a row outside its own provider - the 2026-08-31 defect');
  eq(scoped.untouched.map(r => r.id).join(','), 'b3,b4',
    'the other physician\'s row and the unattributed row were not left out of scope');
  eq(JSON.stringify(scoped.untouched), before, 'the out-of-scope rows are not byte-identical to what was stored before the scoped snapshot landed');
  eq(scoped.untouched[0], day[2], 'the out-of-scope rows were copied rather than left exactly as they were');
  eq(scoped.outOfScopeCount, 2, 'the count of rows this snapshot is silent about is wrong');

  /* A2. THE ALL-PROVIDER SNAPSHOT still enumerates the WHOLE day. */
  const day2 = rows();
  const all = run(day2, { v: 1, date: '2026-08-31', mode: 'all', providerKey: '', backendIds: ['b1', 'b3'], sourceCount: 2 });
  eq(all.authoritative, true, 'an all-provider snapshot lost its whole-day authority');
  eq(all.reason, 'whole-day', 'the all-provider verdict is not named');
  eq(all.keep.map(r => r.id).join(','), 'b1,b3', 'the all-provider snapshot did not keep both rows it named');
  eq(all.replace.map(r => r.id).join(','), 'b2,b4', 'the all-provider snapshot stopped covering the whole day');
  eq(all.untouched.length, 0, 'an all-provider read left rows out of scope - it enumerated the whole day');

  /* A3. A DERIVED membership scope is a read of nothing. */
  const day3 = rows();
  const derived = run(day3, { v: 1, date: '2026-08-31', mode: 'provider-from-all', providerKey: UYEN, backendIds: ['b1'], sourceCount: 1 });
  eq(derived.authoritative, false, 'borrowed all-provider membership was treated as a scoped READ');
  eq(derived.reason, 'scope-not-authoritative', 'the derived-scope refusal is not named');
  eq(derived.replace.length, 0, 'a derived scope proposed a replacement');
  eq(derived.untouched.length, 5, 'a derived scope did not leave every row alone');

  /* A4. A scoped snapshot with no provider key can speak for nothing. */
  const keyless = run(rows(), { v: 1, date: '2026-08-31', mode: 'selected', providerKey: '', backendIds: [], sourceCount: 0 });
  eq(keyless.authoritative, false, 'a scoped snapshot with no provider key was accepted');
  eq(keyless.reason, 'provider-key-unavailable', 'the keyless refusal is not named');

  /* A5. THE PUBLISH SEAM. A selected publish owns its own slice and nothing
     else; an all publish legitimately replaces entry.all. */
  const sig = (entry, mode, k) => { sandbox.__e = entry; sandbox.__m = mode; sandbox.__k = k; return vm.runInContext('otherScopeSignature(__e, __m, __k)', ctx); };
  const entry = {
    all: { v: 1, date: '2026-08-31', mode: 'all', providerKey: '', backendIds: ['b1', 'b3'], sourceCount: 2, updated: 10 },
    providers: {
      [UYEN]: { v: 1, date: '2026-08-31', mode: 'selected', providerKey: UYEN, backendIds: ['b1'], sourceCount: 1, updated: 11 },
      [MATT]: { v: 1, date: '2026-08-31', mode: 'selected', providerKey: MATT, backendIds: ['b3'], sourceCount: 1, updated: 12 }
    },
    active: { mode: 'provider', key: UYEN }
  };
  const beforeSel = sig(entry, 'selected', UYEN);
  entry.providers[UYEN] = { v: 1, date: '2026-08-31', mode: 'selected', providerKey: UYEN, backendIds: ['b9'], sourceCount: 1, updated: 99 };
  entry.active = { mode: 'provider', key: UYEN };
  eq(sig(entry, 'selected', UYEN), beforeSel, 'rewriting the scoped provider\'s OWN slice was reported as touching another scope');
  entry.providers[MATT].backendIds = [];
  ok(sig(entry, 'selected', UYEN) !== beforeSel, 'a selected publish could rewrite ANOTHER provider\'s slice without the guard noticing');
  const beforeAll = sig(entry, 'all', '');
  entry.all = { v: 1, date: '2026-08-31', mode: 'all', providerKey: '', backendIds: ['b1'], sourceCount: 1, updated: 100 };
  eq(sig(entry, 'all', ''), beforeAll, 'an all-provider publish was refused its own whole-day replacement');

  /* A6. The publisher REFUSES rather than writes when the guard fires. */
  const publish = balanced(IMPORTER, 'function publishAuthoritativeSnapshot(input)', 'publishAuthoritativeSnapshot');
  ok(/var beforeOtherScopes = otherScopeSignature\(entry, req\.mode, req\.key \|\| ""\);/.test(publish),
    'the publish does not record the day\'s other scopes before mutating the entry');
  ok(publish.indexOf('out.reason = "scope-would-replace-other-providers";') > 0,
    'the publish has no refusal for a write that would replace a scope it did not read');
  ok(publish.indexOf('out.reason = "scope-would-replace-other-providers";') < publish.indexOf('if (!writeAuthoritativeStore(store))'),
    'the scope guard runs AFTER the store write, so a bad write would already have landed');
  ok(/status\.outOfScopeCount = scopeRule\.outOfScopeCount;/.test(IMPORTER),
    'the day status does not report how many rows the snapshot is silent about, so a pruning consumer cannot tell debris from another clinician');
  ok(/_scopedDayReconcile: scopedDayReconcile,/.test(IMPORTER),
    'the one membership rule is not exported, so a consumer has to re-derive a second idea of "in scope"');
  console.log('  A. a provider-scoped snapshot replaces only that provider\'s rows; the other provider\'s rows come back byte-identical; an all-provider snapshot still owns the whole day');
}

/* =======================================================================
 * (B) visitid-1.0.0 - the stored appointment/encounter ids, EXECUTED.
 * ===================================================================== */
function visitIdContext(source) {
  const slices = [
    statement(source, 'var __MLS_VISIT_ID_FIELDS=[', '__MLS_VISIT_ID_FIELDS'),
    balanced(source, 'function __mlsVisitIdNote()', '__mlsVisitIdNote'),
    balanced(source, 'function __mlsVisitIdKeys(v)', '__mlsVisitIdKeys'),
    balanced(source, 'function __mlsVisitIdCarry(dst,src)', '__mlsVisitIdCarry')
  ].join('\n');
  const win = {};
  const sandbox = { console, JSON, Math, Object, String, Number, Boolean, Date, Array, window: win };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slices, ctx, { filename: 'visitid-slices.js' });
  return { ctx, sandbox, win };
}

function proveVisitIds() {
  const { ctx, sandbox, win } = visitIdContext(SHELL);
  const carry = (dst, src) => { sandbox.__d = dst; sandbox.__s = src; return vm.runInContext('__mlsVisitIdCarry(__d, __s)', ctx); };

  /* B1. THE LIVE CASE. The stored visits carry the two real appointment ids;
     the incoming copy carries neither. */
  const stored = { id: 'p1', visits: [
    { id: 'v1', date: '2026-08-31', type: 'Office visit', appointmentId: '16026279', encounterId: 'e-8831' },
    { id: 'v2', date: '2026-08-30', type: 'Office visit', appointmentId: '16026238', encounterId: '' }
  ] };
  const incoming = { id: 'p1', visits: [
    { id: 'v1', date: '2026-08-31', type: 'Office visit', appointmentId: '', encounterId: '' },
    { id: 'v2', date: '2026-08-30', type: 'Office visit', appointmentId: '', encounterId: '' }
  ] };
  carry(incoming, stored);
  eq(incoming.visits[0].appointmentId, '16026279', 'a re-pull blanked the 2026-08-31 appointment id - the write lane\'s binding key');
  eq(incoming.visits[1].appointmentId, '16026238', 'a re-pull blanked the 2026-08-30 appointment id');
  eq(incoming.visits[0].encounterId, 'e-8831', 'a re-pull blanked a stored encounter id');
  eq(win.__mlsVisitIdConflicts === undefined, true, 'a plain carry-forward was counted as an id CONFLICT');

  /* B2. A RE-PULL MAY SUPPLY AN ID. That is the point of re-pulling. */
  const empty = { id: 'p1', visits: [{ id: 'v3', date: '2026-08-29', type: 'Office visit', appointmentId: '' }] };
  const supplies = { id: 'p1', visits: [{ id: 'v3', date: '2026-08-29', type: 'Office visit', appointmentId: '16026201' }] };
  carry(supplies, empty);
  eq(supplies.visits[0].appointmentId, '16026201', 'a re-pull that SUPPLIES a missing appointment id was blocked');

  /* B3. TWO DIFFERENT NON-EMPTY IDS. The stored one stands and the
     disagreement is counted, PHI-free. */
  const conflicting = { id: 'p1', visits: [
    { id: 'v1', date: '2026-08-31', type: 'Office visit', appointmentId: '19999999', encounterId: '' }
  ] };
  carry(conflicting, stored);
  eq(conflicting.visits[0].appointmentId, '16026279', 'a differing incoming id re-pointed a bound visit at another encounter');
  ok(win.__mlsVisitIdConflicts && win.__mlsVisitIdConflicts.count === 1, 'the id conflict was not counted');
  ok(Number(win.__mlsVisitIdConflicts.lastAt) > 0, 'the id conflict carries no timestamp');
  eq(Object.keys(win.__mlsVisitIdConflicts).sort().join(','), 'count,lastAt',
    'the conflict counter carries something other than a count and a timestamp - it must stay PHI-free');

  /* B4. PAIRING IS BY IDENTITY, NEVER BY ARRAY POSITION: two pulls do not
     agree on order, and a positional carry would move one visit's id onto
     another visit. */
  const reordered = { id: 'p1', visits: [
    { id: 'v2', date: '2026-08-30', type: 'Office visit', appointmentId: '' },
    { id: 'v1', date: '2026-08-31', type: 'Office visit', appointmentId: '' }
  ] };
  carry(reordered, stored);
  eq(reordered.visits[0].appointmentId, '16026238', 'a re-ordered incoming array took the wrong visit\'s appointment id');
  eq(reordered.visits[1].appointmentId, '16026279', 'a re-ordered incoming array took the wrong visit\'s appointment id');

  /* B5. IT NEVER CREATES, REMOVES OR REORDERS A VISIT. */
  const fresh = { id: 'p1', visits: [{ id: 'v9', date: '2026-09-01', type: 'New', appointmentId: '' }] };
  carry(fresh, stored);
  eq(fresh.visits.length, 1, 'the id carry added or removed a visit');
  eq(fresh.visits[0].appointmentId, '', 'the id carry invented an appointment id for a visit the store has never seen');

  /* B6. THE HUNK IS IN BOTH SHELLS. The 1p HTML twins are not byte-identical,
     so a hand-applied hunk has to be proven present in each. */
  const twin = visitIdContext(SHELL_TWIN);
  twin.sandbox.__d = { id: 'p1', visits: [{ id: 'v1', date: '2026-08-31', type: 'Office visit', appointmentId: '' }] };
  twin.sandbox.__s = stored;
  vm.runInContext('__mlsVisitIdCarry(__d, __s)', twin.ctx);
  eq(twin.sandbox.__d.visits[0].appointmentId, '16026279', 'the second shell does not carry the id guard, so one lane still blanks the binding key');
  for (const [label, src] of [['1pScribeFlow.html', SHELL], ['1p/index.html', SHELL_TWIN]]) {
    ok(/try\{ __mlsVisitIdCarry\(p,__prev\); \}catch\(e\)\{\}/.test(src),
      'upsertPatient in ' + label + ' does not run the id carry, so a wholesale record replace still erases the ids');
    ok(src.indexOf('try{ __mlsVisitIdCarry(p,__prev); }catch(e){}') < src.indexOf('    arr[i]=p;'),
      'the id carry in ' + label + ' runs after the record has already been replaced');
  }
  console.log('  B. a re-pull adds or confirms an appointment/encounter id and can never blank one; a differing id keeps the stored one and counts the conflict');
}

/* =======================================================================
 * (C) scopeempty-1.0.0 - the durable day verdict, EXECUTED.
 * ===================================================================== */
function proveScopedEmptyDay() {
  const slices = [
    statement(RANGE, 'var DAY_ATTEMPT_CAP =', 'DAY_ATTEMPT_CAP'),
    balanced(RANGE, 'var REASONS = {', 'REASONS') + ';',
    balanced(RANGE, 'var EMPTY_REASONS = {', 'EMPTY_REASONS') + ';',
    statement(RANGE, "var SCOPED_EMPTY_REASON =", 'SCOPED_EMPTY_REASON'),
    balanced(RANGE, 'function providerScopedJob(manifest)', 'providerScopedJob'),
    /* attn-1.0.0 (2026-09-02): checkpointDay now classifies the day's PHI-free
       chart census through these bounded helpers before it settles a status,
       so the lifted slice needs them to execute. Pin RE-AIMED at the same
       behaviour - nothing this suite asserts was relaxed. */
    balanced(RANGE, 'var CHART_REFUSAL_CODES = {', 'CHART_REFUSAL_CODES') + ';',
    balanced(RANGE, 'var GENERIC_MONTH_REASONS = {', 'GENERIC_MONTH_REASONS') + ';',
    balanced(RANGE, 'function boundedCount(value, max)', 'boundedCount'),
    balanced(RANGE, 'function sanitizeRefusalCodes(raw)', 'sanitizeRefusalCodes'),
    balanced(RANGE, 'function copy(value)', 'copy'),
    balanced(RANGE, 'var LOGIN_REASONS = {', 'LOGIN_REASONS') + ';',
    balanced(RANGE, 'var SIGNOUT_CANDIDATE_REASONS = {', 'SIGNOUT_CANDIDATE_REASONS') + ';',
    balanced(RANGE, 'var STORAGE_REASONS = {', 'STORAGE_REASONS') + ';',
    balanced(RANGE, 'var NON_ATTEMPT_REASONS = {', 'NON_ATTEMPT_REASONS') + ';',
    balanced(RANGE, 'function reasonCode(value)', 'reasonCode'),
    balanced(RANGE, 'function isLoginReason(value)', 'isLoginReason'),
    balanced(RANGE, 'function isStorageReason(value)', 'isStorageReason'),
    balanced(RANGE, 'function own(obj, key)', 'own'),
    balanced(RANGE, 'function now()', 'now'),
    balanced(RANGE, 'function summarize(manifest)', 'summarize'),
    balanced(RANGE, 'function checkpointDay(ctx, monthKey, payload, seen)', 'checkpointDay')
  ].join('\n');
  const sandbox = {
    console, JSON, Math, Object, String, Number, Boolean, Date, Array, RegExp,
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    accountGuard() { return true; },
    persistContext() { return true; },
    stopImporter() {},
    currentExtVersion() { return '3.0.108'; }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(slices, ctx, { filename: 'scopeempty-slices.js' });

  function freshCtx(providerMode) {
    return { control: '', storageFailure: '', manifest: {
      status: 'running',
      provider: providerMode === 'all' ? { mode: 'all' } : { mode: 'selected', id: 'p-uyen', stableKey: 'uyen|phan' },
      months: { '2026-08': { status: 'running', days: {
        '2026-08-28': { status: 'pending', attempts: 0, reason: '' },
        '2026-08-30': { status: 'pending', attempts: 0, reason: '' } } } } } };
  }
  const dayOf = (c, d) => c.manifest.months['2026-08'].days[d];
  const check = (c, payload) => { sandbox.__c = c; sandbox.__p = payload; vm.runInContext('checkpointDay(__c, "2026-08", __p, {})', ctx); };

  /* C1. THE LIVE CASE. Both days are the scoped provider's honest empties. */
  const scoped = freshCtx('selected');
  check(scoped, { date: '2026-08-28', ok: false, complete: false, reason: 'provider-not-on-calendar' });
  check(scoped, { date: '2026-08-30', ok: false, complete: false, reason: 'provider-not-on-calendar' });
  eq(dayOf(scoped, '2026-08-28').status, 'complete', '2026-08-28 was not checkpointed complete for a provider who is simply not on that day\'s calendar');
  eq(dayOf(scoped, '2026-08-30').status, 'complete', '2026-08-30 was not checkpointed complete for a provider who is simply not on that day\'s calendar');
  eq(dayOf(scoped, '2026-08-28').reason, 'provider-not-on-calendar', 'the completed day lost the reason that records WHY it is empty');
  eq(dayOf(scoped, '2026-08-28').attempts, 0, 'an honest empty day burned a retry attempt');

  sandbox.__m = scoped.manifest;
  const tiles = vm.runInContext('summarize(__m)', ctx);
  eq(tiles.needsAttention, 0, 'a provider-not-on-calendar day is still counted as needing attention');
  eq(tiles.complete, 2, 'the honest tiles do not count the two empty days as done');
  eq(tiles.empty, 2, 'the two empty days were counted as days WITH appointments');
  eq(tiles.withRows, 0, 'a 0-row day was reported as carrying appointments');
  eq(tiles.attention.length, 0, 'the receipt still lists an honest empty day for the doctor to chase');

  /* C2. A DAY THE CALENDAR NEVER RENDERED STAYS ATTENTION. Three genuine
     attempts, exactly as before. */
  const broken = freshCtx('selected');
  for (let i = 0; i < 3; i++) check(broken, { date: '2026-08-28', ok: false, complete: false, reason: 'nav-failed' });
  eq(dayOf(broken, '2026-08-28').status, 'needs-attention', 'a day athenaOne could not be navigated to stopped needing attention');
  eq(dayOf(broken, '2026-08-28').reason, 'nav-failed', 'the navigation failure lost its own cause');
  eq(dayOf(broken, '2026-08-28').attempts, 3, 'a navigation failure stopped spending its attempts');

  const noRead = freshCtx('selected');
  check(noRead, { date: '2026-08-30', ok: false, complete: false, reason: 'no-read' });
  eq(dayOf(noRead, '2026-08-30').status, 'retry', 'an unreadable schedule was promoted to a verified empty day');

  /* C3. AN ALL-PROVIDER JOB NEVER GETS THE PROMOTION: it cannot be honestly
     absent from its own calendar. */
  const allJob = freshCtx('all');
  check(allJob, { date: '2026-08-28', ok: false, complete: false, reason: 'provider-not-on-calendar' });
  eq(dayOf(allJob, '2026-08-28').status, 'retry', 'an all-provider job silently completed a day it could not read');

  /* C4. A DAY THAT STILL OWES ITS OWN VISIT NOTES IS NEVER PROMOTED. */
  const owing = freshCtx('selected');
  check(owing, { date: '2026-08-28', ok: false, complete: false, reason: 'provider-not-on-calendar', dayNotesPending: 2 });
  eq(dayOf(owing, '2026-08-28').status, 'retry', 'a day still owing its own visit notes was completed by the scoped-empty rule');

  /* C5. THE CARD SAYS IT IN PLAIN ENGLISH. */
  ok(/'provider-not-on-calendar': 1/.test(RANGE), 'the verdict is not in the durable reason vocabulary');
  ok(/provider not on the calendar this day/.test(RANGE),
    'the Staff Prep card has no plain-English copy naming provider not on the calendar this day');
  ok(/'provider-not-on-calendar': 'Athena’s calendar for that day showed other clinicians/.test(RANGE),
    'the completed empty day still reads as a failure the doctor has to chase');
  console.log('  C. a provider-not-on-calendar day checkpoints complete and empty with its reason recorded; a nav-failed day still needs attention');
}

console.log('scoped-pull-keeps-others-proof: three pull-data defects, measured 2026-09-01');
proveScopeRule();
proveVisitIds();
proveScopedEmptyDay();
console.log('scoped-pull-keeps-others-proof PASS (' + checks + ' checks)');
