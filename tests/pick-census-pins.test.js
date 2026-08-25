'use strict';
/* pcs-1.0.0 pins: THE PICK CENSUS AND CODE-FIRST CLASSIFICATION CANNOT
 * REGRESS SILENTLY (systemic 0/8 audit, item 1 + the phase-receipt seed of
 * item 2).
 *
 * OLD BYTES FAIL BY NAME: the AllVisits picker resolved null with no census,
 * every cause flattened into one English no-athena-tab string, and
 * fdxRowReason dropped all closed codes except open-deadline-exceeded. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const si = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');

/* ---- background: the census exists and is published immediately ---- */
assert.ok(bg.includes("var pickDiag = { at: Date.now(), candidateCount: 0, leaseHeld: false, leaseTabId: 0, leaseReachable: null, leaseSleeping: false, exactMatches: 0, selectionSource: '', code: '' };"),
  'the pick census object is gone');
assert.ok(bg.includes('self.__mlsLastVisitPickDiag = pickDiag;'),
  'the census is no longer published for the refusal to carry');
assert.ok(bg.includes("if (!cand.length) pickDiag.code = 'no-candidates';"),
  'zero candidates no longer records its closed code');
assert.ok(bg.includes("if (!exact) pickDiag.code = 'lease-tab-gone';"),
  'a vanished lease tab no longer records its closed code');
assert.ok(bg.includes("pickDiag.leaseSleeping = true; pickDiag.code = 'lease-sleeping';"),
  'a sleeping lease tab no longer records its closed code');
assert.ok(bg.includes("pickDiag.code = 'identity-not-proven';"),
  'an identity-scan miss no longer records its closed code');
assert.ok(bg.includes("if (exactMatches.length) { pickDiag.selectionSource = 'identity-proven'; resolve(exactMatches[0]); return; }"),
  'an identity-proven pick no longer declares its selection source');
assert.ok(bg.includes("reason: 'no-athena-tab', code: pcsCode, pickDiag: pcsD,"),
  'the no-athena-tab refusal flattened its cause again - code + census are gone');
/* closed vocabulary: every code the census can stamp */
['no-candidates', 'lease-tab-gone', 'lease-sleeping', 'identity-not-proven'].forEach(code => {
  assert.ok(bg.includes("'" + code + "'"), 'census code ' + code + ' vanished');
});
/* PHI boundary: the census carries counts/codes/ids only - pin the object
   literal so a name/dob/url field cannot creep in unseen */
const diagLit = bg.slice(bg.indexOf('var pickDiag = {'), bg.indexOf('var pickDiag = {') + 220);
assert.ok(!/name|dob|mrn|url|title/i.test(diagLit), 'the pick census literal grew an identity-shaped field');

/* ---- engine: code-first classification ---- */
assert.ok(si.includes('var fdCode = String(fd.code || fd.reason || "");'),
  'fdxRowReason no longer promotes the closed machine code');
assert.ok(si.includes('if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(fdCode)) return fdCode.slice(0, 60);'),
  'the kebab-code promotion gate is gone - English strings route retries again');
assert.ok(/AUTOMATIC_HISTORY_RETRY_REASON = \/\^\((?=[^\n]*no-candidates)(?=[^\n]*lease-tab-gone)(?=[^\n]*identity-not-proven)[^\n]*\)\//.test(si),
  'the three pick-census subclasses fell out of the automatic retry vocabulary');
assert.ok(!/AUTOMATIC_HISTORY_RETRY_REASON = \/[^\n]*lease-sleeping/.test(si),
  'lease-sleeping crept into the blind retry lane - the sleeping tab owns its own wake flow');

console.log('PASS pick-census pins: the picker publishes a PHI-free census, refusals carry closed codes, and the engine classifies by code - never English');
