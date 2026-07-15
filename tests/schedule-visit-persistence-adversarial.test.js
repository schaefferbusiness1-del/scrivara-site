'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const start = source.indexOf('  function saveVerifiedVisits(target, r) {');
const end = source.indexOf('\n  async function runHistoryBatch', start);
assert(start >= 0 && end > start, 'saveVerifiedVisits source was not found');
const saveVerifiedVisitsSource = source.slice(start, end).trim();

function aliases(visit) {
  const out = [];
  const encounter = String(visit && (visit.encounterId || visit.encounterID) || '').trim().toLowerCase();
  const sourceKey = String(visit && (visit.sourceVisitKey || visit.rowKey) || '').trim().toLowerCase();
  if (encounter) out.push(`encounter|${encounter}`);
  if (sourceKey) out.push(`source|${sourceKey}`);
  return out;
}

function sharesAlias(left, right) {
  return left.some(alias => right.includes(alias));
}

function verifiedStored(patient, raw, overrides) {
  return Object.assign({}, raw, {
    source: 'athena-schedule-history',
    identityVerified: true,
    identityBinding: patient.id,
    bodyComplete: true,
    fullDetail: true
  }, overrides || {});
}

function createHarness(patientOverrides) {
  const patient = Object.assign({
    id: 'patient-exact-1',
    name: 'Exact Patient',
    dob: '01/02/1960',
    mrn: 'MRN-1001',
    visits: []
  }, patientOverrides || {});
  patient.visits = Array.isArray(patient.visits) ? patient.visits.slice() : [];

  const context = {
    console,
    Array,
    Date,
    JSON,
    Math,
    Number,
    Object,
    RegExp,
    String,
    isFn: value => typeof value === 'function',
    safe(fn, fallback) {
      try { return fn(); } catch (_) { return fallback; }
    },
    normMrn(value) {
      return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    },
    patientById(id) {
      return String(id || '') === patient.id ? patient : null;
    }
  };
  context.window = context;
  context._athenaHistoryProofMatches = (target, observed) => {
    if (!target || target.patientId !== patient.id) return false;
    const dobMatches = target.dob && observed.chartDob && target.dob === observed.chartDob;
    const mrnMatches = target.mrn && observed.chartMrn && context.normMrn(target.mrn) === context.normMrn(observed.chartMrn);
    return observed.chartName === patient.name && !!(dobMatches || mrnMatches);
  };
  context._patientHistoryCardCoverage = () => ({
    complete: true,
    exactIdentityVerified: true,
    patientId: patient.id,
    cards: {
      problems: { populated: true }, meds: { populated: true }, allergies: { populated: true },
      summary: { populated: true }, vitals: { populated: true }, history: { populated: true }
    }
  });

  function addVisit(id, raw, options) {
    assert.strictEqual(id, patient.id);
    const stored = verifiedStored(patient, raw, {
      source: options && options.source || 'athena-schedule-history',
      identityVerified: !!(options && options.identityVerified),
      identityBinding: String(options && options.identityBinding || ''),
      bodyComplete: !!(options && options.bodyComplete && raw && raw.fullDetail)
    });
    const incomingAliases = aliases(stored);
    const prior = patient.visits.findIndex(visit => sharesAlias(aliases(visit), incomingAliases));
    if (prior >= 0) patient.visits[prior] = stored;
    else patient.visits.push(stored);
    return stored;
  }

  const model = {
    addVisit,
    getVisits: () => patient.visits,
    reconcileVerifiedAthenaVisits(_id, accepted) {
      const acceptedAliases = (accepted || []).map(aliases);
      patient.visits = patient.visits.filter(visit => {
        const exactVerifiedRemote = /athena|legacy|grab|pullrec/i.test(String(visit.source || '')) &&
          visit.identityVerified === true && String(visit.identityBinding || '') === patient.id;
        if (!exactVerifiedRemote) return true;
        return acceptedAliases.some(candidate => sharesAlias(candidate, aliases(visit)));
      });
      return { complete: true, removed: 0, kept: patient.visits.length };
    },
    organizePatientHistory: () => ({ ok: true, verifiedVisits: patient.visits.length })
  };
  context.__mlsVisitModel = model;
  context.__mlsCopyVisits = {
    _saveVisits(_patient, _identity, visits) {
      visits.forEach(raw => addVisit(patient.id, raw, {
        source: 'athena-copy', identityVerified: true, identityBinding: patient.id, bodyComplete: true
      }));
      return visits.length;
    },
    _visitIdentityAgrees: () => true
  };

  const saveVerifiedVisits = vm.runInNewContext(`(${saveVerifiedVisitsSource})`, context, {
    filename: 'saveVerifiedVisits.extracted.js', timeout: 1000
  });
  return { context, patient, model, saveVerifiedVisits };
}

function visit(id, raw, sourceKey) {
  return {
    encounterId: id,
    sourceVisitKey: sourceKey || `row:${id}`,
    date: '2026-07-14',
    type: 'Office visit',
    raw,
    fullDetail: true
  };
}

function responseFor(patient, visits, overrides) {
  const identity = patient.dob
    ? { name: patient.name, dob: patient.dob, mrn: patient.mrn }
    : { name: patient.name, dob: '', mrn: patient.mrn };
  return Object.assign({
    identity,
    readerVersion: '2.9.22-visits-r4-two-stage',
    visits,
    receipt: {
      complete: true,
      indexComplete: true,
      bodyComplete: true,
      fullDetail: true,
      stableKeysComplete: true,
      expected: visits.length,
      parsed: visits.length,
      authoritativeEmpty: visits.length === 0,
      readerVersion: '2.9.22-visits-r4-two-stage'
    }
  }, overrides || {});
}

function targetFor(patient) {
  return { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn };
}

(() => {
  {
    const h = createHarness();
    h.context.__mlsCopyVisits._saveVisits = () => 1;
    assert.throws(
      () => h.saveVerifiedVisits(targetFor(h.patient), responseFor(h.patient, [visit('enc-dropped', 'Fresh body that was never persisted.')])),
      /visits-persistence-count-unproven/,
      'an optimistic save count with no stored visit became green'
    );
  }

  {
    const h = createHarness();
    h.patient.visits.push(verifiedStored(h.patient, visit('enc-stale', 'Yesterday stale body.')));
    h.context.__mlsCopyVisits._saveVisits = () => 1;
    h.model.reconcileVerifiedAthenaVisits = () => ({ complete: true, removed: 0, kept: 1 });
    assert.throws(
      () => h.saveVerifiedVisits(targetFor(h.patient), responseFor(h.patient, [visit('enc-stale', 'Fresh r4 body that must replace yesterday.')])),
      /visits-persistence-body-unproven/,
      'a stale prior body with the same stable aliases hid a dropped current save'
    );
  }

  {
    const h = createHarness();
    const left = visit('enc-left', 'Left encounter body.', 'row:shared-alias');
    const right = visit('enc-right', 'Right encounter body.', 'row:shared-alias');
    h.context.__mlsCopyVisits._saveVisits = (_patient, _identity, visits) => {
      visits.forEach(raw => h.patient.visits.push(verifiedStored(h.patient, raw, { source: 'athena-copy' })));
      return visits.length;
    };
    h.model.reconcileVerifiedAthenaVisits = () => ({ complete: true, removed: 0, kept: 2 });
    assert.throws(
      () => h.saveVerifiedVisits(targetFor(h.patient), responseFor(h.patient, [left, right])),
      /visits-persistence-alias-(?:unproven|collision)/,
      'colliding secondary aliases became green'
    );
  }

  {
    const h = createHarness();
    h.patient.visits.push(verifiedStored(h.patient, visit('enc-extra', 'Unrelated stale exact visit.')));
    h.model.reconcileVerifiedAthenaVisits = () => ({ complete: true, removed: 0, kept: 2 });
    assert.throws(
      () => h.saveVerifiedVisits(targetFor(h.patient), responseFor(h.patient, [visit('enc-current', 'Current exact visit.')])),
      /visits-persistence-count-unproven/,
      'an extra stale verified row survived a supposedly complete reconciliation'
    );
  }

  {
    const h = createHarness();
    h.patient.visits.push({ source: 'manual', raw: 'Clinician-entered visit.', fullDetail: true });
    h.patient.visits.push(verifiedStored(h.patient, visit('enc-unverified', 'Unverified Athena-shaped row.'), { identityVerified: false }));
    const result = h.saveVerifiedVisits(targetFor(h.patient), responseFor(h.patient, [visit('enc-valid', 'Current verified visit.')]));
    assert.strictEqual(result.persistedVisits, 1, 'manual or unverified rows entered the verified persistence proof');
    assert.strictEqual(h.patient.visits.length, 3, 'manual or unverified rows were deleted');
  }

  {
    const h = createHarness();
    h.patient.visits.push(verifiedStored(h.patient, visit('enc-remove', 'Old verified Athena visit.')));
    h.patient.visits.push({ source: 'manual', raw: 'Manual visit must remain.', fullDetail: true });
    h.patient.visits.push(verifiedStored(h.patient, visit('enc-unverified-empty', 'Unverified row must remain.'), { identityVerified: false }));
    const result = h.saveVerifiedVisits(targetFor(h.patient), responseFor(h.patient, []));
    assert.strictEqual(result.authoritativeEmpty, true);
    assert.strictEqual(result.persistedVisits, 0);
    assert.strictEqual(h.patient.visits.length, 2, 'authoritative empty deleted manual or unverified history');
  }

  {
    const h = createHarness({ dob: '', mrn: 'MRN-ONLY-42' });
    const result = h.saveVerifiedVisits(targetFor(h.patient), responseFor(h.patient, [visit('enc-mrn-only', 'MRN-only exact visit body.')]));
    assert.strictEqual(result.persistedVisits, 1, 'MRN-only exact identity did not persist');
    assert.strictEqual(h.patient.visits[0].identityBinding, h.patient.id);
  }

  {
    const h = createHarness();
    const first = h.saveVerifiedVisits(targetFor(h.patient), responseFor(h.patient, [visit('enc-repeat', 'First exact body.')]));
    const second = h.saveVerifiedVisits(targetFor(h.patient), responseFor(h.patient, [visit('enc-repeat', 'Refreshed exact body.')]));
    assert.strictEqual(first.persistedVisits, 1);
    assert.strictEqual(second.persistedVisits, 1);
    assert.strictEqual(h.patient.visits.length, 1, 'repeat pull duplicated a stable encounter');
    assert.strictEqual(h.patient.visits[0].raw, 'Refreshed exact body.', 'repeat pull did not refresh the exact body');
  }

  console.log('PASS adversarial exact-visit persistence and reconciliation contracts');
})();
