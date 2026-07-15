'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const historySource = fs.readFileSync(path.join(root, 'feat_opnote_history.js'), 'utf8');
const integritySource = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');

const tpl = 'PATIENT:\nPREOPERATIVE DIAGNOSIS:\nPROCEDURE:\nDESCRIPTION OF PROCEDURE:\nCOMPLICATIONS:\nDISPOSITION:';
const wrong = 'PATIENT: Exact One\nPROCEDURE: Left L5-S1 TFESI\nPREOPERATIVE DIAGNOSIS: Radiculopathy\nDESCRIPTION OF PROCEDURE: Completed.\nCOMPLICATIONS: None.\nDISPOSITION: Stable.';
const correct = 'PATIENT: Exact One\nPREOPERATIVE DIAGNOSIS: Radiculopathy\nPROCEDURE: Left L5-S1 TFESI\nDESCRIPTION OF PROCEDURE: Completed.\nCOMPLICATIONS: None.\nDISPOSITION: Stable.';

function makeVisits() {
  const visits = [];
  for (let i = 0; i < 8; i++) {
    visits.push({
      date: `2026-07-${String(14 - i).padStart(2, '0')}`,
      type: i === 7 ? 'Prior lumbar procedure follow-up' : `Routine visit ${i + 1}`,
      source: 'athena-copy', identityVerified: true, identityBinding: 'exact-a',
      icd10: ['M54.16'], cpt: i === 7 ? ['64483'] : [],
      findings: `STRUCTURED FINDING ${i + 1}`,
      plan: i === 7 ? 'Prior left L5-S1 TFESI response documented.' : `Routine plan ${i + 1}`,
      raw: i === 7
        ? 'OLDER RELEVANT RAW BODY: the prior left L5-S1 transforaminal epidural produced eighty percent relief for three months; no complication was documented.'
        : `RAW CLINICAL BODY ${i + 1}: substantive Athena prose that must remain available with structured fields.`
    });
  }
  return visits;
}

function harness() {
  const exact = {
    id: 'exact-a', name: 'Exact One', dob: '01/02/1970', sex: 'F', mrn: 'A-1',
    problems: 'Lumbar radiculopathy', visits: makeVisits()
  };
  exact.visits.push({
    date: '2025-01-01', type: 'Forged cross-patient visit', source: 'athena-copy', identityVerified: true,
    identityBinding: 'wrong-b', raw: 'FORGED WRONG-BOUND VISIT BODY'
  });
  const wrongPatient = {
    id: 'wrong-b', name: 'Exact One', dob: '01/02/1970', sex: 'M', mrn: 'B-2',
    problems: 'WRONG PATIENT PROBLEM', visits: [{
      date: '2026-07-14', type: 'Wrong patient visit', source: 'athena-copy', identityVerified: true,
      identityBinding: 'wrong-b', raw: 'WRONG PATIENT RAW BODY'
    }]
  };
  const patients = [exact, wrongPatient];
  const calls = [];
  const document = {
    readyState: 'complete', addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; }, createElement() { return {}; },
    head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document, MutationObserver: function () {},
    setTimeout, clearTimeout, setInterval() { return 1; }, clearInterval() {},
    addEventListener() {}, removeEventListener() {},
    getPatients() { return patients; }, getTemplates() { return []; }, getKey() { return 'test-key'; },
    _opDobKey(v) { return String(v || '').trim(); }, toast() {},
    __mlsVisitModel: {
      _normDob(v) { return String(v || '').trim(); },
      usableVisits(patient) { return (patient.visits || []).filter(v => v.identityVerified === true); },
      getVisits(patient) { return patient.visits || []; }
    },
    async aiCallRaw(sys, user, key, opts) {
      calls.push({ sys, user, key, opts: { ...opts } });
      return JSON.stringify({ note: calls.length % 2 ? wrong : correct, missing: [] });
    }
  };
  context.window = context;
  vm.runInNewContext(historySource, context, { filename: 'feat_opnote_history.js' });
  context.__mlsOpNoteHistory.rewire();
  vm.runInNewContext(integritySource, context, { filename: 'feat_mls_opnote_integrity.js' });
  return { context, exact, wrongPatient, calls };
}

async function main() {
  const h = harness();
  const legacyAnchored = h.context.__mlsOpNoteHistory.injectIntoUser(
    'PATIENT: Exact One\n\nTEMPLATE (legacy):\nPROCEDURE:',
    '=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===\nlegacy-safe\n=== MLS VERIFIED EXACT-PATIENT CONTEXT END ==='
  );
  assert(legacyAnchored.indexOf('=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===') < legacyAnchored.indexOf('TEMPLATE (legacy)'),
    'verified history was not inserted before the legacy template anchor');
  const result = await h.context._genOpNote('Exact One', '2026-07-14', 'Left L5-S1 TFESI', tpl, {
    patientId: 'exact-a', dob: '01/02/1970', history: 'UNVERIFIED CALLER-SUPPLIED HISTORY MUST NOT SURVIVE'
  });
  assert.strictEqual(result.note, correct, 'template repair did not complete');
  assert.strictEqual(h.calls.length, 2, 'generation and repair did not make exactly two requests');

  const first = h.calls[0].user;
  const repair = h.calls[1].user;
  const historyMarker = '=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===';
  assert(first.indexOf(historyMarker) >= 0 && first.indexOf(historyMarker) < first.indexOf('SELECTED TEMPLATE'),
    'initial exact-patient history was not inserted before the current selected-template anchor');
  assert(repair.indexOf(historyMarker) >= 0 && repair.indexOf(historyMarker) < repair.indexOf('SELECTED TEMPLATE:'),
    'repair exact-patient history was not inserted before its selected-template anchor');
  assert(repair.includes('=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===\n\nSELECTED TEMPLATE:'),
    'repair history and selected template were not separated cleanly');
  assert.strictEqual(h.calls[0].opts.mlsVerifiedHistoryBinding.patientId, 'exact-a',
    'initial request lost its immutable exact-patient history binding');
  assert.strictEqual(h.calls[1].opts.mlsVerifiedHistoryBinding.patientId, 'exact-a',
    'repair request lost its immutable exact-patient history binding');
  assert.strictEqual(h.calls[1].opts.mlsVerifiedHistoryBinding.token, h.calls[0].opts.mlsVerifiedHistoryBinding.token,
    'repair request did not retain the frozen initial history token');
  assert.strictEqual(h.context.__mlsOpNoteHistory.validateBinding(h.calls[1].opts).ok, true,
    'repair request binding no longer validates against the exact patient history');
  assert(first.includes('ALL 8 known verified visit(s)'), 'the first pass did not account for every visit beyond six');
  for (let day = 7; day <= 14; day++) assert(first.includes(`2026-07-${String(day).padStart(2, '0')}`), `verified visit dated July ${day} disappeared from the complete index`);
  assert(first.includes('OLDER RELEVANT RAW BODY'), 'an older procedure-relevant raw body was displaced by six newer visits');
  assert(first.includes('RAW CLINICAL BODY 1') && first.includes('STRUCTURED FINDING 1'), 'rich raw prose was dropped when structured fields existed');
  assert(repair.includes('=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ==='), 'repair pass did not retain the verified-history block');
  assert(repair.includes('OLDER RELEVANT RAW BODY'), 'repair pass reverted to pre-injection history');
  assert(!first.includes('WRONG PATIENT RAW BODY') && !repair.includes('WRONG PATIENT RAW BODY'), 'same-name patient history leaked into either pass');
  assert(!first.includes('FORGED WRONG-BOUND VISIT BODY') && !repair.includes('FORGED WRONG-BOUND VISIT BODY'), 'wrong-bound visit leaked from the exact patient record');
  assert(!first.includes('UNVERIFIED CALLER-SUPPLIED HISTORY') && !repair.includes('UNVERIFIED CALLER-SUPPLIED HISTORY'), 'caller-supplied history bypassed the verified exact-patient owner');
  assert.strictEqual(h.calls[0].opts.mlsOpNotePhase, 'initial');
  assert.strictEqual(h.calls[1].opts.mlsOpNotePhase, 'repair');

  const blocked = harness();
  blocked.context.aiCallRaw = async function (sys, user, key, opts) {
    blocked.calls.push({ sys, user, key, opts: { ...opts } });
    if (blocked.calls.length === 1) {
      blocked.exact.visits.push({
        date: '2026-07-15', type: 'Changed visit', source: 'athena-copy', identityVerified: true,
        identityBinding: 'exact-a', raw: 'HISTORY CHANGED WHILE GENERATING'
      });
    }
    return JSON.stringify({ note: wrong, missing: [] });
  };
  blocked.context.__mlsOpNoteHistory.revert();
  blocked.context.__mlsOpNoteHistory.installed = false;
  delete blocked.context.__mlsOpNoteHistory;
  vm.runInNewContext(historySource, blocked.context, { filename: 'feat_opnote_history-reinstalled.js' });
  blocked.context.__mlsOpNoteHistory.rewire();
  await assert.rejects(
    blocked.context._genOpNote('Exact One', '2026-07-14', 'Left L5-S1 TFESI', tpl, { patientId: 'exact-a', dob: '01/02/1970' }),
    err => err && err.code === 'MLS_OPNOTE_IDENTITY' && err.reason === 'patient-or-visit-context-changed',
    'a visit change between first pass and repair did not fail closed'
  );
  assert.strictEqual(blocked.calls.length, 1, 'changed history reached the repair transport');

  const collision = harness();
  const bodyA = 'COLLISION BODY 000000000ha6';
  const bodyB = 'COLLISION BODY 000000000l78';
  collision.exact.visits = [{
    date: '2026-07-14', type: 'Collision regression', source: 'athena-copy',
    identityVerified: true, identityBinding: 'exact-a', raw: bodyA
  }];
  const collisionIdentity = { patientId: 'exact-a', name: 'Exact One', dob: '01/02/1970', procedure: 'Left L5-S1 TFESI' };
  const builtA = collision.context.__mlsOpNoteHistory._internal.buildHistoryContext('Exact One', {
    patientId: 'exact-a', dob: '01/02/1970', procedure: 'Left L5-S1 TFESI'
  });
  const tokenA = collision.context.__mlsOpNoteHistory._internal.bindingToken(collisionIdentity, builtA);
  collision.exact.visits[0].raw = bodyB;
  const builtB = collision.context.__mlsOpNoteHistory._internal.buildHistoryContext('Exact One', {
    patientId: 'exact-a', dob: '01/02/1970', procedure: 'Left L5-S1 TFESI'
  });
  const tokenB = collision.context.__mlsOpNoteHistory._internal.bindingToken(collisionIdentity, builtB);
  assert.notStrictEqual(builtA.text, builtB.text, 'collision fixture did not change the full verified history context');
  assert.strictEqual(tokenA, tokenB, 'known equal-length FNV collision no longer exercises the binding-token collision path');
  const forgedCollision = {
    mlsOpNotePatientId: 'exact-a',
    mlsVerifiedHistoryBinding: {
      patientId: 'exact-a', patientName: 'Exact One', patientDob: '01/02/1970', procedure: 'Left L5-S1 TFESI',
      context: builtA.text, token: tokenA
    }
  };
  const collisionVerdict = collision.context.__mlsOpNoteHistory.validateBinding(forgedCollision);
  assert.strictEqual(collisionVerdict.ok, false, 'different verified history with the same compact token passed binding validation');
  assert.strictEqual(collisionVerdict.reason, 'patient-or-visit-context-changed', 'collision rejection used the wrong reason');

  const switched = harness();
  switched.context.aiCallRaw = async function (sys, user, key, opts) {
    switched.calls.push({ sys, user, key, opts: { ...opts } });
    switched.exact.name = 'Different Patient';
    return JSON.stringify({ note: correct, missing: [] });
  };
  switched.context.__mlsOpNoteHistory.revert();
  switched.context.__mlsOpNoteHistory.installed = false;
  delete switched.context.__mlsOpNoteHistory;
  vm.runInNewContext(historySource, switched.context, { filename: 'feat_opnote_history-patient-switch.js' });
  switched.context.__mlsOpNoteHistory.rewire();
  await assert.rejects(
    switched.context._genOpNote('Exact One', '2026-07-14', 'Left L5-S1 TFESI', tpl, { patientId: 'exact-a', dob: '01/02/1970' }),
    err => err && err.code === 'MLS_OPNOTE_IDENTITY',
    'a patient change during the first AI request did not fail closed'
  );
  assert.strictEqual(switched.calls.length, 1, 'patient-switched draft made another AI request');

  const identity = harness();
  await assert.rejects(
    identity.context._genOpNote('Exact One', '2026-07-14', 'Left L5-S1 TFESI', tpl, { patientId: 'missing-id', dob: '01/02/1970' }),
    err => err && err.code === 'MLS_OPNOTE_IDENTITY',
    'a missing immutable patient id reached generation'
  );
  assert.strictEqual(identity.calls.length, 0, 'identity-blocked generation reached AI transport');

  const variants = harness();
  variants.exact.visits = [{
    date: '2026-07-14', type: 'Safe display-name variant', source: 'athena-copy',
    identityVerified: true, identityBinding: 'exact-a', patientName: 'One, Exact.', patientDob: '01/02/1970',
    raw: 'SAFE PUNCTUATION AND ORDER VARIANT BODY'
  }, {
    date: '2026-07-13', type: 'Unverified exact-id claim', source: 'athena-copy',
    identityVerified: false, identityBinding: 'exact-a', patientName: 'One, Exact.', patientDob: '01/02/1970',
    raw: 'UNVERIFIED VARIANT BODY MUST NOT ENTER CONTEXT'
  }, {
    date: '2026-07-12', type: 'Wrong immutable owner', source: 'athena-copy',
    identityVerified: true, identityBinding: 'wrong-b', patientName: 'One, Exact.', patientDob: '01/02/1970',
    raw: 'WRONG OWNER VARIANT BODY MUST NOT ENTER CONTEXT'
  }, {
    date: '2026-07-11', type: 'Conflicting DOB', source: 'athena-copy',
    identityVerified: true, identityBinding: 'exact-a', patientName: 'One, Exact.', patientDob: '12/31/1999',
    raw: 'DOB CONFLICT BODY MUST NOT ENTER CONTEXT'
  }, {
    date: '2026-07-10', type: 'Unbound name mismatch', source: 'manual',
    patientName: 'One, Exact.', patientDob: '01/02/1970',
    raw: 'UNBOUND ORDER VARIANT MUST NOT ENTER CONTEXT'
  }];
  const variantMatch = variants.context.__mlsOpNoteHistory._internal.visitMatchesPatient;
  assert.strictEqual(variantMatch(variants.exact, variants.exact.visits[0]), true, 'verified immutable binding did not authorize a safe punctuation/order name variant');
  assert.strictEqual(variantMatch(variants.exact, variants.exact.visits[1]), false, 'unverified exact-id claim entered clinical context');
  assert.strictEqual(variantMatch(variants.exact, variants.exact.visits[2]), false, 'wrong immutable owner entered clinical context');
  assert.strictEqual(variantMatch(variants.exact, variants.exact.visits[3]), false, 'DOB conflict entered clinical context');
  assert.strictEqual(variantMatch(variants.exact, variants.exact.visits[4]), false, 'unbound display-name mismatch entered clinical context');
  const variantContext = variants.context.__mlsOpNoteHistory._internal.buildHistoryContext('Exact One', {
    patientId: 'exact-a', dob: '01/02/1970', procedure: 'Left L5-S1 TFESI'
  });
  assert(variantContext.ok && variantContext.visitCount === 1, 'clinical context did not retain exactly the one safely bound name variant');
  assert(variantContext.text.includes('SAFE PUNCTUATION AND ORDER VARIANT BODY'), 'safe verified name variant was missing from clinical context');
  assert(!variantContext.text.includes('MUST NOT ENTER CONTEXT'), 'unsafe identity row leaked into clinical context');

  const bounded = harness();
  bounded.exact.visits = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 6, 14 - i)).toISOString().slice(0, 10),
    type: `Longitudinal visit ${i + 1}`, source: 'athena-copy', identityVerified: true,
    identityBinding: 'exact-a', findings: `Verified finding ${i + 1}`,
    raw: i === 59 ? 'VERY OLD BUT PROCEDURE-RELEVANT LEFT L5-S1 TFESI RESPONSE' : `Verified body ${i + 1}`
  }));
  const built = bounded.context.__mlsOpNoteHistory._internal.buildHistoryContext('Exact One', {
    patientId: 'exact-a', dob: '01/02/1970', procedure: 'Left L5-S1 TFESI'
  });
  assert(built.ok && built.visitCount === 60, 'bounded context did not account for all sixty verified visits');
  assert(built.text.length <= 12000, `bounded context exceeded its prompt budget (${built.text.length})`);
  for (const visit of bounded.exact.visits) assert(built.text.includes(visit.date), `bounded context omitted verified visit ${visit.date}`);
  assert(built.text.includes('VERY OLD BUT PROCEDURE-RELEVANT'), 'bounded selection dropped a clinically relevant old visit');

  const matcher = harness();
  matcher.context.getTemplates = () => [
    { id: 'tpl-tfesi', name: 'Lumbar TFESI', keywords: ['tfesi'], text: 'PROCEDURE: Lumbar TFESI' },
    { id: 'tpl-si', name: 'SI joint injection', keywords: ['si joint injection'], text: 'PROCEDURE: SI joint injection' }
  ];
  matcher.exact.visits = [{
    date: '2026-07-14', type: 'Left L5-S1 TFESI', source: 'athena-copy',
    identityVerified: true, identityBinding: 'wrong-b'
  }, {
    date: '2026-07-13', type: 'Left SI joint injection', source: 'athena-copy',
    identityVerified: false, identityBinding: 'exact-a'
  }, {
    date: '2026-07-12', type: 'Left L5-S1 TFESI', source: 'pullrec',
    patientId: 'exact-a', identityVerified: false, identityBinding: ''
  }];
  const blockedHistoryMatch = matcher.context.__mlsOpNoteIntegrity.bestFor(
    'Exact One', 'Routine follow-up', '01/02/1970', 'exact-a'
  );
  assert.strictEqual(blockedHistoryMatch.source, 'unmatched',
    'wrong-bound or unverified Athena history influenced template selection');
  matcher.exact.visits.push({
    date: '2026-07-11', type: 'Left L5-S1 TFESI', source: 'manual', patientId: 'exact-a'
  });
  const safeLocalMatch = matcher.context.__mlsOpNoteIntegrity.bestFor(
    'Exact One', 'Routine follow-up', '01/02/1970', 'exact-a'
  );
  assert.strictEqual(safeLocalMatch.source, 'history', 'safe exact-patient manual history was discarded');
  assert.strictEqual(safeLocalMatch.tplId, 'tpl-tfesi');

  console.log('PASS op-note verified history: rich raw detail, >6 visits, exact identity, repair retention, and mid-flight fail-closed binding');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
