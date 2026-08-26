'use strict';
/* prov-1.0.0 regression (matrix 2026-08-26, the stale-Ibuprofen case): a
 * POPULATED facts card now names where its content came from, and when an
 * exact-identity verified chart read PROVED the card empty while local
 * content still shows, the line says so loudly (the merge is append-only by
 * design - labeling is the cure, never deletion). The REAL provenance
 * classifier is sliced from the shipped shell bytes and executed; the twins
 * contract (1p-pull-one-owner) holds the live /1p page to the same bytes. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const liveShell = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');

const s = shell.indexOf('function _athenaProfileProvenance(p,key,hasContent){');
const e = shell.indexOf('function _profProvenanceLine(elId,p,key){', s);
assert.ok(s > 0 && e > s, 'the provenance classifier left the shell');
const prov = new Function('_athenaChartLanded',
  shell.slice(s, e) + '\nreturn _athenaProfileProvenance;')(
  p => !!String((p && p.athenaChartImportedAt) || '').trim());

const exactRec = (cards, extra) => Object.assign({
  complete: true, exactIdentityVerified: true, patientId: 'p1', capturedAt: '2026-08-26T05:00:00Z', cards
}, extra || {});

/* THE IBUPROFEN CASE: verified chart holds NONE, local content shows -> loud warning */
let t = prov({ id: 'p1', athenaProfileCoverage: exactRec({ meds: { status: 'not_documented' } }) }, 'meds', true);
assert.ok(/^⚠/.test(t) && t.includes('holds NONE of these') && t.includes('2026-08-26') && t.includes('MLS-local'),
  'the verified-empty divergence is not loudly labeled: ' + t);

/* verified chart with the card documented -> includes-chart line with the date */
t = prov({ id: 'p1', athenaProfileCoverage: exactRec({ meds: { status: 'captured', populated: true } }) }, 'meds', true);
assert.ok(t.includes('Includes the Athena chart verified 2026-08-26'), 'the verified-chart line lost its date: ' + t);

/* landed chart without an exact receipt -> pull-dated line, never a verification claim */
t = prov({ id: 'p1', athenaChartImportedAt: '2026-08-25T09:00:00Z' }, 'meds', true);
assert.ok(t.includes('From the Athena pull of 2026-08-25') && !t.includes('verified'),
  'a landed-but-unverified chart claimed verification: ' + t);

/* no chart at all -> MLS-entered honesty */
t = prov({ id: 'p1' }, 'problems', true);
assert.strictEqual(t, 'Entered in MLS — no Athena chart pulled for this patient yet.');

/* a WRONG-PATIENT receipt may not speak as verification (identity honesty) */
t = prov({ id: 'p2', athenaProfileCoverage: exactRec({ meds: { status: 'not_documented' } }), athenaChartImportedAt: '2026-08-25' }, 'meds', true);
assert.ok(!/^⚠/.test(t) && !t.includes('verified'), 'a foreign-patient receipt spoke as verification: ' + t);
/* incomplete or identity-unverified receipts fall back the same way */
for (const bad of [{ complete: false }, { exactIdentityVerified: false }]) {
  t = prov({ id: 'p1', athenaProfileCoverage: exactRec({ meds: { status: 'not_documented' } }, bad) }, 'meds', true);
  assert.ok(!/^⚠/.test(t), 'an unproven receipt spoke as verification: ' + JSON.stringify(bad));
}

/* empty cards stay silent - the honest-empty text owns them */
assert.strictEqual(prov({ id: 'p1', athenaProfileCoverage: exactRec({ meds: { status: 'not_documented' } }) }, 'meds', false), '');

/* wiring pins, BOTH shells: classifier + injector + the three card calls */
for (const [name, text] of [['1pScribeFlow.html', shell], ['1p/index.html', liveShell]]) {
  assert.ok(text.includes('function _athenaProfileProvenance(p,key,hasContent){'), name + ': classifier missing');
  assert.ok(text.includes('function _profProvenanceLine(elId,p,key){'), name + ': injector missing');
  assert.ok(text.includes("_profProvenanceLine('profProblems',p,'problems'); _profProvenanceLine('profMeds',p,'meds'); _profProvenanceLine('profAllergies',p,'allergies');"),
    name + ': the three facts cards are no longer labeled');
  const inj = text.indexOf('function _profProvenanceLine(elId,p,key){');
  const injSlice = text.slice(inj, inj + 900);
  assert.ok(injSlice.includes("if(!txt){ if(line) line.remove(); return; }"), name + ': a cleared label is not removed (stale line would persist)');
  assert.ok(injSlice.includes("el.classList.contains('empty-txt')"), name + ': content detection no longer follows the card body truth');
}

console.log('PASS facts provenance (prov-1.0.0): populated problems/meds/allergies cards name their strongest evidence - the verified-empty divergence (the live stale-Ibuprofen case) warns loudly with the verification date, unverified/foreign/incomplete receipts never claim verification, empty cards stay with the honest-empty text, and both shells carry the same wiring (classifier executed from shipped bytes)');
