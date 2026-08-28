'use strict';

/* ptshape-1.0.0 (2026-08-28) — "p.problems.trim is not a function", and why a
 * browser-only search could never find its cause.
 *
 * NOTHING IN THIS APP creates an array-shaped chart field. That is true, it was
 * measured, and it is exactly why this crash sat filed as unproven while the
 * owner kept hitting it. The writer is on the SERVER:
 *
 *   POST /api/assist/extract  asks the model for
 *     {"allergies":[],"medications":[],"problems":[]}
 *   and stores
 *     problems: (pt.problems || []).slice(0, 60)
 *   - an ARRAY - into the encrypted patients row.
 *
 *   GET /api/patients then returns JSON.parse(decrypt(...)) VERBATIM. There is
 *   no shape normalisation anywhere on the way out.
 *
 * So a patient captured that way arrives in the browser with problems, meds and
 * allergies as arrays, and every `(p.problems||'').trim()` reader in the shell
 * throws - including the note-SAVE path, where it costs a doctor a finished note.
 *
 * The cure normalises at the DOOR, where server rows enter the local store,
 * rather than at the fourteen readers - fourteen chances to miss one. This suite
 * pins both halves: arrays are flattened, and a record that was ALREADY strings
 * comes out byte-identical, so the door cannot quietly rewrite good data.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];

function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing function ' + name);
  let d = 0, e = -1;
  const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  assert.ok(e > 0, 'unbalanced function ' + name);
  return src.slice(i, e);
}

for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'latin1');

  /* The door must actually be wired into the hydration loop, not merely defined. */
  ok(/if\(!row\.data \|\| !row\.external_id\) continue;\s*\n\s*_mlsNormalizePatientChartFields\(row\.data\);/.test(src),
    shell + ': server rows are adopted WITHOUT passing through the chart-field door');

  /* ptshape-1.0.1: there are TWO doors, and only one was locked. The team list
     loader takes the SAME /api/patients rows - "keep ALL rows (own + team)" -
     and kept row.data verbatim, so an array-shaped chart field reached
     teamRoField and rendered as "a,b,c" on one line. It never threw, because
     that reader wraps in String(); a silent wrong-shape render is exactly the
     kind of thing that outlives the crash it shares a cause with.
     Pinned as WIRING, not as a call count, so moving the loop is fine and
     dropping the door is not. */
  ok(/_teamRows=rows\.map\(\(row,i\)=>\{ if\(row&&row\.data\) _mlsNormalizePatientChartFields\(row\.data\); return Object\.assign\(\{_idx:i\},row\); \}\);/.test(src),
    shell + ': the team list adopts server rows WITHOUT the chart-field door - an array-shaped ' +
    'problems/meds/allergies would render as "a,b,c" instead of one per line');

  const api = new Function(
    lift(src, '_mlsGenerationFieldText') + '\n' + lift(src, '_mlsNormalizePatientChartFields') +
    '\nreturn { text: _mlsGenerationFieldText, norm: _mlsNormalizePatientChartFields };')();

  /* 1. the exact row shape POST /api/assist/extract stores */
  const serverRow = {
    name: 'Synthetic Test', dob: '1980-01-01', mrn: '55501',
    problems: ['Lumbar spinal stenosis (M48.062)', 'Right knee pain (M25.561)'],
    meds: ['Ibuprofen 600 mg TID', 'Gabapentin 300 mg qHS'],
    allergies: [],
    summary: 'prior visit summary',
    source: 'mls-assist-capture',
  };

  /* the crash must be REACHABLE on that shape, or this suite proves nothing */
  let raised = '';
  try { const raw = JSON.parse(JSON.stringify(serverRow)); void ((raw.problems || '').trim()); }
  catch (e) { raised = String(e.message || ''); }
  ok(/is not a function/.test(raised),
    shell + ': the reader idiom no longer throws on an array - this suite is measuring nothing');

  /* 2. the door flattens it, preserving every line */
  const p = JSON.parse(JSON.stringify(serverRow));
  api.norm(p);
  eq(typeof p.problems, 'string', shell + ': problems was not normalised to text');
  eq(typeof p.meds, 'string', shell + ': meds was not normalised to text');
  eq(typeof p.allergies, 'string', shell + ': allergies was not normalised to text');
  ok(p.problems.indexOf('Lumbar spinal stenosis (M48.062)') >= 0 &&
     p.problems.indexOf('Right knee pain (M25.561)') >= 0,
    shell + ': normalising the problem list LOST a problem');
  eq(p.problems.split('\n').length, 2, shell + ': the problem list did not survive as one line per problem');
  eq(p.allergies, '', shell + ': an empty array must become an empty string, not "[]" or "undefined"');

  /* and every reader idiom is now safe */
  let raisedAfter = '';
  try { void ((p.problems || '').trim()); void ((p.meds || '').trim()); void ((p.allergies || '').trim()); void ((p.summary || '').trim()); }
  catch (e) { raisedAfter = String(e.message || ''); }
  eq(raisedAfter, '', shell + ': a reader still throws after normalisation');

  /* 3. a record that was ALREADY strings must come out byte-identical - the door
     may not re-trim, re-encode or otherwise rewrite good chart text. */
  const already = { problems: 'Lumbar stenosis', meds: '  deliberately spaced  ', allergies: null, summary: 's', name: 'x' };
  const before = JSON.stringify(already);
  api.norm(already);
  eq(JSON.stringify(already), before, shell + ': the door MUTATED a record that was already correct');

  /* 4. hostile shapes must degrade, never throw */
  for (const hostile of [{ problems: { a: 'x' } }, { problems: 42 }, { problems: true }, { problems: [[['deep']]] }]) {
    let boom = '';
    try { api.norm(hostile); void ((hostile.problems || '').trim()); } catch (e) { boom = String(e.message || ''); }
    eq(boom, '', shell + ': a hostile chart-field shape threw instead of degrading: ' + JSON.stringify(hostile));
  }
  ok(api.norm(null) === null, shell + ': the door must tolerate a null record');
}

console.log('PASS patient-chart-fields-normalize-at-the-door: ' + checks +
  ' checks — server-stored array chart fields cannot reach a string-only reader, and correct records are untouched');
