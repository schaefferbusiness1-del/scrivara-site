'use strict';

/* OP-NOTE AUTO-NAMING b717 (Workroom Stage 2a) - the owner-approved record
 * name: patient + procedure DATE + procedure. cc becomes
 * "<patient> — <Mon D, YYYY> — <procedure> (op-note draft|op note)".
 *
 * The date segment comes from the row's day KEY (YYYY-MM-DD), carried on the
 * row as dateKey by both builders (day sweep passes dayKey; single-patient
 * passes _acctTodayKey()). When the day is unknown the segment is '' - a
 * dangling " —  — " can never render.
 *
 * Readers stay safe by construction and this test pins the load-bearing ones:
 *  - draft-resume (feat_mls_opnote_prep adoptExistingDraft) matches by
 *    procedure CONTAINMENT, so pre-b717 drafts without a date still adopt;
 *  - the history de-dup strips only the leading "name — " (date then shows);
 *  - the PDF label takes the first "—" segment (still the name).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const prep = fs.readFileSync(path.join(root, 'feat_mls_opnote_prep.js'), 'utf8');

/* 1 - all three stored-cc sites carry the date segment (two autosave shapes +
 * the explicit save path). The name prefix stays FIRST - sweep-fixes-b711
 * separately pins that the format leads with p.name. */
const ccSites = app.split("p.name+' — '+_opCcDate(row)+").length - 1;
assert.strictEqual(ccSites, 3,
  'expected exactly 3 cc sites shaped name+date+procedure, found ' + ccSites);

/* 2 - the helper itself behaves: real key formats with a trailing separator,
 * missing or garbage keys yield '' (never a dangling separator). */
const m = app.match(/function _opCcDate\(row\)\{[^\n]*\}/);
assert(m, '_opCcDate helper not found as a one-line declaration');
const ctx = { Date: Date, isNaN: isNaN };
vm.createContext(ctx);
vm.runInContext(m[0] + '; __out=[_opCcDate({dateKey:"2026-07-27"}), _opCcDate({}), _opCcDate({dateKey:"garbage"}), _opCcDate(null)];', ctx);
const [good, missing, garbage, nul] = ctx.__out;
assert(/2026/.test(good) && / — $/.test(good),
  'a real dateKey must format to a dated segment with trailing separator, got: ' + JSON.stringify(good));
assert.strictEqual(missing, '', 'a row without dateKey must contribute an empty segment');
assert.strictEqual(garbage, '', 'an unparseable dateKey must contribute an empty segment');
assert.strictEqual(nul, '', 'a null row must contribute an empty segment');

/* 3 - both row builders actually deliver the key. */
assert(app.includes('_opDayStr(dayKey), a.patientId, a, dayKey); });'),
  'the day-sweep builder must pass dayKey into _opNewRow');
assert(app.includes('p.id, null, _acctTodayKey()) ];'),
  'the single-patient builder must pass the account today-key into _opNewRow');
assert(app.includes("dateKey:String(dateKey||'')"),
  '_opNewRow must store the key on the row');

/* 3b - THE RUNNING OWNER carries it. Proven live at b717: the base builder
 * stored dateKey, the gate was green, and every live row still lost its day -
 * feat_mls_opnote_integrity REPLACES window._opNewRow with its own newRow
 * (oni line ~1183), so a param added only to the base dies at the override.
 * The base function is not the running function; pin the override too. */
const oni = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
assert(oni.includes('function newRow(name, reason, dob, dateStr, patientId, scope, dateKey)'),
  "oni's replacement builder must accept the 7th dateKey param");
assert(oni.includes("dateKey:S(dateKey||'')"),
  "oni's replacement builder must store dateKey on the row it returns");

/* 4 - backward compat is load-bearing: draft-resume adopts by procedure
 * CONTAINMENT, so pre-b717 drafts (no date in cc) still resume. */
assert(prep.includes('if (proc && S(n.cc).indexOf(proc) < 0) continue;'),
  'adoptExistingDraft must keep matching by procedure containment, not whole-cc equality');

console.log('PASS op-note auto-name: cc = patient — date — procedure at all 3 stored sites, empty-day fail-safe proven in vm, both builders deliver the key, old drafts still adopt');
