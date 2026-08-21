'use strict';
/* px-1.0 contract - patient records may merge/bind ONLY on a strong key:
   a corroborated stable athenaId, or name+DOB (both present, equal, unique).
   A display name alone NEVER merges (the 2026-08-07 patient-isolation train;
   the removed b121 "leg 3" and the autopull DOB-less name bind both welded a
   new patient onto another patient's chart, concatenating their
   allergies/problems/meds - measured live as the cross-patient complaint). */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packSource = fs.readFileSync(path.join(root, 'feat_mls_b121_pack.js'), 'utf8');
const autopullSource = fs.readFileSync(path.join(root, 'feat_athena_autopull.js'), 'utf8');
const siteSource = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing start marker ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing end marker ${end}`);
  return source.slice(a, b);
}

/* ---- extract matchRow with its real utils (never retyped) ---- */
const utilsSrc = between(packSource, '  /* ------------------------------ utils ---------------------------------- */', '  /* mirrors __mlsVisitModel._svcToYMD');
const matchSrc = between(packSource, '  function matchRow(arr, name, dob, athenaId) {', '  /* merge = union fields');
const matchRow = new Function('window', 'FLAGS', `
  ${utilsSrc}
  ${matchSrc}
  return matchRow;
`)({ __mlsVisitModel: null }, { athenaIdMerges: true });

/* leg 3 (name-only) must refuse: one same-name candidate, no DOB anywhere */
assert.strictEqual(
  matchRow([{ id: 1, name: 'John Smith', dob: '' }], 'John Smith', '', ''),
  null, 'name-only create-merge was accepted (leg 3 resurrected)');

/* name-only with a DOB on the CANDIDATE side only - still a name-only bind */
assert.strictEqual(
  matchRow([{ id: 1, name: 'John Smith', dob: '01/02/1970' }], 'John Smith', '', ''),
  null, 'name bind with DOB missing on the incoming side was accepted');

/* name + DOB, both present and equal, unique - the legitimate merge holds */
assert.strictEqual(
  matchRow([{ id: 1, name: 'John Smith', dob: '01/02/1970' }], 'John Smith', '01/02/1970', '').id,
  1, 'the legitimate name+DOB merge broke');

/* name + DOB ambiguous (two exact candidates) - refuse */
assert.strictEqual(
  matchRow([
    { id: 1, name: 'John Smith', dob: '01/02/1970' },
    { id: 2, name: 'John Smith', dob: '01/02/1970' }
  ], 'John Smith', '01/02/1970', ''),
  null, 'ambiguous name+DOB merged instead of refusing');

/* athenaId hit with only ONE shared name token and no DOB - refuse (the
   mis-stamped-id weld) */
assert.strictEqual(
  matchRow([{ id: 1, name: 'John Adams', dob: '', athenaId: '7001' }], 'John Smith', '', '7001'),
  null, 'a stable-id hit with one-token name overlap and no DOB corroboration merged');

/* athenaId + FULL name equality - merges */
assert.strictEqual(
  matchRow([{ id: 1, name: 'Smith, John', dob: '', athenaId: '7001' }], 'John Smith', '', '7001').id,
  1, 'stable-id + full-name-equality merge broke');

/* athenaId + DOB equality + BOTH name tokens shared - merges (name variant) */
assert.strictEqual(
  matchRow([{ id: 1, name: 'John A Adams-Smith', dob: '03/04/1980', athenaId: '7001' }], 'John Smith', '03/04/1980', '7001').id,
  1, 'stable-id + DOB-equality merge broke');

/* px-1.5 TWINS: same DOB, same surname, same (mis-stamped) athenaId - REFUSE.
   One shared token was the stamper's own predicate, so every possible
   mis-stamp was guaranteed to "corroborate". */
assert.strictEqual(
  matchRow([{ id: 1, name: 'John Smith', dob: '03/04/1980', athenaId: '7001' }], 'James Smith', '03/04/1980', '7001'),
  null, 'twins (same DOB + surname) merged on a stable-id hit');

/* px-1.5 stampIfExpected leg A now requires BOTH name tokens too */
{
  const stampSrc = between(packSource, '  var EXPECT = null;', '  /* public: stamp a row');
  const mk = new Function('window', 'Date', `
    var DISABLED = false; var JR = []; var api = { state: { stamped: 0 } };
    ${utilsSrc}
    ${stampSrc}
    return { stamp: stampIfExpected, set: function (e) { EXPECT = e; } };
  `)({ addEventListener() {} }, Date);
  const expectFor = (name, ndob) => ({ mrn: '8811', name, tokset: name.toLowerCase().split(' ').sort().join(' '), tokn: 2, ndob, at: Date.now(), used: false });
  const twin = { id: 't1', name: 'Mary Smith', dob: '05/12/1962' };
  mk.set(expectFor('Robert Smith', '05/12/1962'));
  assert.strictEqual(mk.stamp(twin), false, 'the stamper still stamps a twin (1 shared token + shared DOB)');
  assert(!twin.athenaId, 'the twin was stamped with the other chart MRN');
  const variant = { id: 't2', name: 'John A Smith', dob: '05/12/1962' };
  mk.set(expectFor('John Smith', '05/12/1962'));
  assert.strictEqual(mk.stamp(variant), true, 'a legitimate name-variant stamp broke');
  assert.strictEqual(variant.athenaId, '8811');
}

/* px-1.5 the migration scan() applies the SAME corroboration */
{
  const scanSrc = between(packSource, '  function scan(arr) {', '  function calRefCounts()');
  const scanFn = new Function('window', 'FLAGS', `
    ${utilsSrc}
    ${scanSrc}
    return scan;
  `)({ __mlsVisitModel: null }, { athenaIdMerges: true });
  const dobless = scanFn([
    { id: 'a', name: 'John Adams', dob: '', athenaId: '7001' },
    { id: 'b', name: 'John Smith', dob: '', athenaId: '7001' }
  ]);
  assert.strictEqual(dobless.groups.length, 0, 'scan() still unions DOB-less same-id different-name rows');
  assert(dobless.vetoed.some(v => v.reason === 'athenaId-equal-but-name-dob-uncorroborated'), 'scan() veto reason missing');
  const twins = scanFn([
    { id: 'a', name: 'John Smith', dob: '03/04/1980', athenaId: '7001' },
    { id: 'b', name: 'James Smith', dob: '03/04/1980', athenaId: '7001' }
  ]);
  assert.strictEqual(twins.groups.length, 0, 'scan() still unions twins');
  const samePerson = scanFn([
    { id: 'a', name: 'Smith, John', dob: '03/04/1980', athenaId: '7001' },
    { id: 'b', name: 'John Smith', dob: '', athenaId: '7001' }
  ]);
  assert.strictEqual(samePerson.groups.length, 1, 'scan() no longer unions a full-name-equal pair');
}

/* ---- autopull resolvePatient: exact-identifier-first, never name-only ---- */
const baseUtilsSrc = between(autopullSource, '  function S(x)', '  /* ---------- robust NAME normalization');
const nameUtilsSrc = between(autopullSource, '  /* ---------- robust NAME normalization', '  /* ---------- harden the model');
const resolveSrc = between(autopullSource, '  function resolvePatient(identity) {', '  /* ---------- on-screen status chip');
const compatibleNameSrc = between(siteSource, 'function _athenaHistoryName(v)', 'function _athenaHistoryTargetSnapshot');
const compatibleName = new Function(compatibleNameSrc + '\nreturn _athenaHistoryNameCompatible;')();
assert.strictEqual(compatibleName('Smith, John Q', 'John Smith'), true,
  'the canonical tolerant name helper could not be executed by the resolver fixture');

function makeResolver(store) {
  const upserts = [];
  const fn = new Function('getPatients', 'upsertPatient', 'Date', 'window', `
    ${baseUtilsSrc}
    ${nameUtilsSrc}
    ${resolveSrc}
    return resolvePatient;
  `)(() => store, p => upserts.push(JSON.parse(JSON.stringify(p))), Date,
    { _athenaHistoryNameCompatible: compatibleName });
  return { resolve: fn, upserts };
}

/* DOB-less same-name record in the store: must CREATE, never bind, never
   stamp the chart DOB onto the old record (the live wrong-chart weld) */
{
  const store = [{ id: 'x1', name: 'John Smith', dob: '' }];
  const { resolve } = makeResolver(store);
  const r = resolve({ name: 'John Smith', dob: '03/04/1980', mrn: '' });
  assert.strictEqual(r.created, true, 'DOB-less same-name record was bound by name alone');
  assert.strictEqual(store[0].dob, '', "the chart DOB was stamped onto the name-matched record");
}

/* stable MRN binds, unique, even when the display name differs in form */
{
  const store = [{ id: 'x2', name: 'Smith, John Q', dob: '', mrn: '7833832' }];
  const { resolve } = makeResolver(store);
  const r = resolve({ name: 'John Smith', dob: '03/24/2006', mrn: '7833832' });
  assert.strictEqual(r.created, false, 'unique MRN did not bind');
  assert.strictEqual(r.patient.id, 'x2');
  assert.strictEqual(r.via, 'athena-id');
}

/* px-1.5: an MRN hit with NEITHER a name match NOR a DOB corroboration is a
   suspected mis-stamp - create, never bind the differently-named chart */
{
  const store = [{ id: 'x9', name: 'Margaret Holloway', dob: '', mrn: '4411' }];
  const { resolve } = makeResolver(store);
  const r = resolve({ name: 'John Smith', dob: '', mrn: '4411' });
  assert.strictEqual(r.created, true, 'an uncorroborated MRN hit bound a differently-named chart');
}

/* px-1.5: an MRN hit corroborated by DOB alone (name differs in form beyond
   namesMatch) still binds */
{
  const store = [{ id: 'x10', name: 'M. H. Holloway-Grant', dob: '02/02/1970', mrn: '4412' }];
  const { resolve } = makeResolver(store);
  const r = resolve({ name: 'Margaret Grant', dob: '02/02/1970', mrn: '4412' });
  assert.strictEqual(r.created, false, 'a DOB-corroborated MRN hit failed to bind');
  assert.strictEqual(r.patient.id, 'x10');
}

/* MRN claimed by TWO records - refuse the bind, create */
{
  const store = [
    { id: 'a', name: 'John Smith', dob: '', mrn: '9001' },
    { id: 'b', name: 'John Smith', dob: '', mrn: '9001' }
  ];
  const { resolve } = makeResolver(store);
  const r = resolve({ name: 'John Smith', dob: '', mrn: '9001' });
  assert.strictEqual(r.created, true, 'an ambiguous MRN bound to the first claimant');
}

/* MRN hit with a CONFLICTING DOB - vetoed, falls through (name+dob leg also
   fails: dob differs) - creates */
{
  const store = [{ id: 'c', name: 'John Smith', dob: '01/01/1950', mrn: '9002' }];
  const { resolve } = makeResolver(store);
  const r = resolve({ name: 'John Smith', dob: '03/04/1980', mrn: '9002' });
  assert.strictEqual(r.created, true, 'a DOB-conflicting MRN hit was bound anyway');
}

/* name + DOB (both present, equal, unique) binds */
{
  const store = [{ id: 'd', name: 'Smith, John', dob: '3/4/1980' }];
  const { resolve } = makeResolver(store);
  const r = resolve({ name: 'John Smith', dob: '03/04/1980', mrn: '' });
  assert.strictEqual(r.created, false, 'name+DOB unique bind broke');
  assert.strictEqual(r.patient.id, 'd');
}

/* The production tolerant-name fallback may relax only the name echo. The
   same exact DOB remains mandatory and the result must stay unambiguous. */
{
  const store = [{ id: 'd2', name: 'Smith, J Q', dob: '3/4/1980' }];
  const { resolve } = makeResolver(store);
  const r = resolve({ name: 'John Smith', dob: '03/04/1980', mrn: '' });
  assert.strictEqual(r.created, false, 'canonical tolerant name + exact DOB failed to bind');
  assert.strictEqual(r.patient.id, 'd2');
  assert.strictEqual(r.via, 'name-dob-compat');
}

{
  const store = [{ id: 'd3', name: 'Smith, J Q', dob: '3/5/1980' }];
  const { resolve } = makeResolver(store);
  const r = resolve({ name: 'John Smith', dob: '03/04/1980', mrn: '' });
  assert.strictEqual(r.created, true, 'tolerant name matching bypassed the exact-DOB requirement');
}

/* the created record carries the chart identity forward for future exact binds */
{
  const store = [];
  const { resolve } = makeResolver(store);
  const r = resolve({ name: 'Jane Doe', dob: '05/06/1990', mrn: '5555' });
  assert.strictEqual(r.created, true);
  assert.strictEqual(r.patient.mrn, '5555', 'created record dropped the chart MRN');
  assert.strictEqual(r.patient.athenaId, '5555', 'created record dropped the athenaId');
}

console.log('patient-isolation-strong-key-binding: PASS (24 checks)');
