'use strict';

/* ext 3.0.2 (owner goal 2026-07-21): Notes ON visit-body retrieval. Live
 * reproduction: athenaCollector v26.3 FL keeps a CACHED encounter iframe from
 * the previous patient alive, and encounter frames can render a stale or
 * reformatted patient label while the stable athena id is correct — every
 * batch body was refused `same-frame-name-mismatch` while schedule/history
 * succeeded and the single-read lane passed.
 *
 * Contract (background.js, extension core):
 *  1. visitIdentityGate: the stable athena patient id is PRIMARY when both
 *     sides carry it — id match accepts despite a stale/reformatted frame
 *     name; id mismatch refuses; a contradictory DOB refuses even with an id
 *     match; no-id charts keep the strict name+DOB gate exactly as before.
 *  2. The encounter-index frame is chosen by selector score AND live
 *     same-frame identity (candidate walk), so a cached previous-patient
 *     iframe can never win selection; if no frame matches, the read refuses
 *     with the best frame's identity (never a silent pass).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');

// ---- structural pins ---------------------------------------------------------
assert(bg.includes('visitIdentityGate(frozenHint, ecIdentity)'), 'candidate-frame identity walk missing');
assert(bg.includes('enumCandidates'), 'identity-aware frame candidate selection missing');
assert(/if \(wantMrn && haveMrn\) \{\s*\n\s*if \(wantMrn !== haveMrn\) return \{ ok: false, reason: 'same-frame-mrn-mismatch' \};/.test(bg),
  'stable-id-primary gate missing or weakened');

// ---- behavioral: run the gate ------------------------------------------------
const gateStart = bg.indexOf('function visitIdentityGate(frozen, live)');
const gateEnd = bg.indexOf('function realVisit', gateStart);
assert(gateStart > 0 && gateEnd > gateStart, 'could not bound visitIdentityGate');
const ctx = { String, Number, Object };
vm.createContext(ctx);
vm.runInContext(bg.slice(gateStart, gateEnd) + '\nthis.gate = visitIdentityGate;', ctx);
const gate = (frozen, live) => ctx.gate(frozen, live);

const FROZEN = { name: 'James B Fortune', dob: '11/04/1939', mrn: '7588619' };

// 1) Stable ID match with a STALE frame name -> accepted (the bug case).
assert.strictEqual(gate(FROZEN, { name: 'Mary Ward', dob: '11/04/1939', mrn: '7588619' }).ok, true,
  'a verified id match must not be rejected on a stale frame name');
// 2) Normalized name differences with id -> accepted, reason carries name evidence.
{
  const r = gate(FROZEN, { name: 'FORTUNE, JAMES', dob: '1939-11-04', mrn: '#7588619' });
  assert.strictEqual(r.ok, true);
  assert(/mrn/.test(r.reason), 'id must be the primary reason');
}
// 3) Genuine patient mismatch (different id) -> refused.
assert.strictEqual(gate(FROZEN, { name: 'James B Fortune', dob: '11/04/1939', mrn: '9999999' }).ok, false);
assert.strictEqual(gate(FROZEN, { name: 'James B Fortune', dob: '11/04/1939', mrn: '9999999' }).reason, 'same-frame-mrn-mismatch');
// 4) Id match but CONTRADICTORY DOB -> refused (gate stays strict).
assert.strictEqual(gate(FROZEN, { name: 'James B Fortune', dob: '01/01/2000', mrn: '7588619' }).reason, 'same-frame-dob-mismatch');
// 5) No id on either side: the original strict name+DOB gate is unchanged.
assert.strictEqual(gate({ name: 'James B Fortune', dob: '11/04/1939' }, { name: 'James Fortune', dob: '11/04/1939' }).ok, true);
assert.strictEqual(gate({ name: 'James B Fortune', dob: '11/04/1939' }, { name: 'Mary Ward', dob: '11/04/1939' }).reason, 'same-frame-name-mismatch');
assert.strictEqual(gate({ name: 'James B Fortune', dob: '11/04/1939' }, { name: 'James Fortune', dob: '02/02/1940' }).reason, 'same-frame-dob-mismatch');
// 6) Stale response from a previous patient (previous patient's FULL identity)
//    -> refused on id when ids differ, on name when id absent.
assert.strictEqual(gate(FROZEN, { name: 'Mary Ward', dob: '08/22/1966', mrn: '7836175' }).ok, false);
assert.strictEqual(gate(FROZEN, { name: 'Mary Ward', dob: '08/22/1966' }).ok, false);
// 7) Incomplete hints still refuse (no un-gated reads).
assert.strictEqual(gate({ name: 'James' }, { name: 'James B Fortune', dob: '11/04/1939', mrn: '7588619' }).ok, false);

// ---- frame-candidate walk shape ---------------------------------------------
const walk = bg.slice(bg.indexOf('var enumCandidates = ['), bg.indexOf('var rows = enumRes.rows'));
assert(walk.includes('ecScore(b) - ecScore(a)'), 'candidates must be walked best-first');
assert(walk.includes('ecI < 4'), 'the candidate walk must stay bounded');
assert(walk.includes('if (ecGate.ok) { enumRes = ecCand.result; listFrame = ecCand.frameId; break; }'),
  'a matching frame must take over enumeration');
const refusal = bg.slice(bg.indexOf('var rows = enumRes.rows'), bg.indexOf('var detailWaitMs'));
assert(refusal.includes("if (!gate.ok)"), 'the no-matching-frame refusal must remain');
assert(refusal.includes('Safety stop: the live patient identity'), 'the honest refusal text must remain');

// ---- consecutive-pull fixes: lease grant + per-frame tab scan ----------------
/* Live 2026-07-21 (10-consecutive-ON acceptance): cached previous-patient
 * iframes fail coverage binding on every consecutive pull, which starved the
 * read lease (it required the FULL coverage receipt) and then poisoned the
 * no-lease scan (one merged best identity). Every batch body collapsed to
 * `no-athena-tab`. The lease now binds on the banner-proved exact identity,
 * and the scan gates every frame identity individually. */
assert(bg.includes('chartReceiptStrict.complete || exactGlobalIdentity'),
  'lease must bind on banner-proved exact identity (consecutive-pull fix)');
assert(bg.includes('var idFrameHit = (idResults || []).some(function (fr) {'),
  'pickEmrTab scan must gate every frame identity individually');
assert(!/var idBest = bestResult\(idResults/.test(bg),
  'the poisonable merged-best identity pick must stay retired');
assert(bg.includes('for (var ehPass = 0; ehPass < 48; ehPass++)'),
  'slow-athena rehydration: enumerate+walk must retry within the read deadline');
assert(bg.includes('if (gate && gate.ok) break;'),
  'rehydration loop must stop on a gate-proved frame');

assert(bg.includes('visits-panel-not-open'),
  'enumeration must refuse an index outside the real Visits and Cases panel');
assert(bg.includes('visitsSurfaceOpen'),
  'openVisits must verify the RENDERED panel, not the rail-tab active class');
console.log('PASS visit-body identity 3.0.2: stable-id-primary gate (strict refusals intact) + identity-aware bounded frame-candidate walk with honest refusal + lease/scan consecutive-pull fixes');
