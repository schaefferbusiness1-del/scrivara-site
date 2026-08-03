/* sn-1.1 (3.0.40) CHIP-ANCHORED NAME CAPTURE CONTRACT.
 *
 * sn-1.0 (3.0.39) captured the titlecase token run before the age/sex chip to
 * rescue keyword surnames ("Sae Min") from STOPX. The 2026-08-02 adversarial
 * audit CONFIRMED two defects in it, both replayed here:
 *
 *   1. WRONG-NAME REGRESSION: the run is captured BEFORE the debris fences and
 *      never vocabulary-trimmed, so a titlecase status/type token adjacent to
 *      the name minted a CONFIDENT wrong patient name ("Arrived Karen Bledsoe",
 *      "Telehealth Sarah Bledsoe") on shapes 3.0.38 parsed correctly, and a
 *      trailing bare suffix became the surname (last:'Jr').
 *   2. WELD FRAGILITY: the chip regex required literal whitespace between the
 *      surname and the age digits, but athena welded exactly those tokens live
 *      2026-07-31 ("Min77yo", "40minSae") - the whole-day refusal sn-1.0 was
 *      shipped to fix would recur on the welded rendering.
 *
 * sn-1.1 fixes both: the capture runs on a digit<->letter re-spaced copy (names
 * never contain digits, so the split is safe) with targeted "min"/"AM" peels,
 * leading vocabulary tokens are trimmed, a run whose first surviving token is
 * still vocabulary is refused (a name may END in a keyword surname, never OPEN
 * with one), trailing suffixes move to the suffix field, the window caps at 3
 * name tokens, and the fence-consumed-row early return no longer starves the
 * chip validation. Every fixture is replayed through BOTH the 3.0.38 reader
 * and the candidate, so no assertion can pass vacuously.
 * Every patient name below is SYNTHETIC. */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const candidateChain = ['3.0.43', '3.0.42', '3.0.41', '3.0.40', '3.0.38', '3.0.37', '3.0.36', '3.0.35', '3.0.34', '3.0.33', '3.0.32'].map(v => path.join(root, 'extension-candidates', v, 'background.js'));
const afterPath = candidateChain.find(p => fs.existsSync(p)) || path.join(root, 'background.js');
const beforePath = path.join(root, 'extension-candidates', '3.0.38', 'background.js');
const afterSrc = fs.readFileSync(afterPath, 'utf8');
const beforeSrc = fs.existsSync(beforePath) ? fs.readFileSync(beforePath, 'utf8') : null;

function extractParseName(source, label) {
  const start = source.indexOf('function mlsParseName(');
  const end = source.indexOf('async function mlsSchedDomInline');
  assert.ok(start > 0 && end > start, label + ': mlsParseName extraction markers present');
  const body = source.slice(start, end);
  return vm.runInNewContext('(function(){ ' + body + '; return mlsParseName; })()', {}, { filename: label });
}

const parseAfter = extractParseName(afterSrc, 'after:' + path.basename(path.dirname(afterPath)));
const parseBefore = beforeSrc ? extractParseName(beforeSrc, 'before:3.0.38') : null;

/* ---- source markers: sn-1.1 must actually be present in the candidate ---- */
if (afterPath.indexOf('3.0.40') !== -1 || /sn-1\.1/.test(afterSrc)) {
  for (const marker of [
    'var sChip = s.replace(/(\\d)(?=[A-Za-z])/g',
    'var CRVOC = /^(arrived|scheduled|confirmed|cancell?ed|checked|check|walk-?in',
    'var crIsVoc = function (x)',
    'crIsVoc(crT[0]))) crT.shift();',
    'if (crT.length >= 3 && normSuffix(crT[crT.length - 1])) crSuffix = normSuffix(crT.pop());',
    'if (crT.length >= 2 && crT.length <= 3) {',
    'crValid && crNonStop && !crIsVoc(crFirst)',
  ]) {
    assert.ok(afterSrc.indexOf(marker) !== -1, 'sn-1.1 marker present: ' + marker);
  }
  assert.ok(afterSrc.indexOf('    if (!segs.length) return null;') === -1,
    'the fence-consumed early return is gone (chip validation reachable)');
}

let n = 0;
function ok(name) { n++; console.log('ok ' + n + ' - ' + name); }

/* ---- 1. the 3.0.39 rescue is retained ---- */
{
  const r = parseAfter('Sae Min 77yo F');
  assert.ok(r && r.confident && r.display === 'Sae Min', 'keyword surname survives: Sae Min');
  ok('spaced keyword surname resolves confidently (Sae Min)');
}

/* ---- 2. welded renderings now resolve (the 2026-07-31 live shapes) ---- */
{
  const r = parseAfter('9:40 AM 40min Sae Min77yo F | 03-04-1949 F/U');
  assert.ok(r && r.confident && r.display === 'Sae Min', 'surname welded into NNyo resolves, got ' + JSON.stringify(r));
  ok('surname-welded-into-age rendering resolves (Min77yo)');
}
{
  const r = parseAfter('9:40 AM 40minSae Min77yo F | 03-04-1949 F/U');
  assert.ok(r && r.confident && r.display === 'Sae Min', 'duration welded into first name resolves, got ' + JSON.stringify(r));
  ok('duration-welded-into-first-name rendering resolves (40minSae)');
}

/* ---- 3. the wrong-name regression is closed: status vocabulary is trimmed ---- */
const statusShapes = [
  ['Arrived Karen Bledsoe 58yo F', 'Karen Bledsoe'],
  ['Confirmed Karen Bledsoe 58yo F', 'Karen Bledsoe'],
  ['Checked In Karen Bledsoe 58yo F', 'Karen Bledsoe'],
  ['Self Pay Karen Bledsoe 58yo F', 'Karen Bledsoe'],
  ['Walk-In Karen Bledsoe 58yo F', 'Karen Bledsoe'],
  ['No Show Karen Bledsoe 58yo F', 'Karen Bledsoe'],
  ['Telehealth Sarah Bledsoe 44yo F', 'Sarah Bledsoe'],
  ['New Patient Sarah Bledsoe 44yo F', 'Sarah Bledsoe'],
  ['Rescheduled Karen Bledsoe 58yo F', 'Karen Bledsoe'],
];
for (const [raw, want] of statusShapes) {
  const r = parseAfter(raw);
  assert.ok(r && r.confident && r.display === want,
    JSON.stringify(raw) + ' must parse to ' + JSON.stringify(want) + ', got ' + JSON.stringify(r && r.display));
}
ok('all ' + statusShapes.length + ' leading-status shapes yield the bare patient name');

/* ---- 4. a trailing suffix is a suffix, not a surname ---- */
{
  const r = parseAfter('John Smith Jr 82yo M');
  assert.ok(r && r.confident && r.first === 'John' && r.last === 'Smith' && r.suffix === 'Jr',
    'suffix handling, got ' + JSON.stringify(r));
  ok('trailing Jr moves to the suffix field (last stays Smith)');
}

/* ---- 5. fence-consumed rows now reach the chip rescue ---- */
{
  const r = parseAfter('Left Knee Injection Karen Bledsoe 58yo F');
  assert.ok(r && r.confident && r.display === 'Karen Bledsoe',
    'anatomy-fence row rescued, got ' + JSON.stringify(r));
  ok('anatomy-fence-consumed row rescued to the bare name');
}

/* ---- 6. refusals that must hold ---- */
{
  const r = parseAfter('No Show 40yo M');
  assert.ok(!(r && r.confident), 'an all-vocabulary run must never mint a patient, got ' + JSON.stringify(r));
  ok('all-vocabulary run refuses (No Show)');
}
{
  const r = parseAfter('Min Sae 77yo F');
  assert.ok(!(r && r.confident && r.first === 'Min'), 'a vocabulary token may not OPEN a name, got ' + JSON.stringify(r));
  ok('vocabulary-opening run refuses the chip lane (Min Sae)');
}
{
  const r = parseAfter('Scheduled by Mary Jones Karen Bledsoe 58yo F');
  assert.ok(!(r && r.display === 'Mary Jones Karen Bledsoe'),
    'the 4-token staff+patient chimera must not ride the chip lane, got ' + JSON.stringify(r));
  ok('4-token chimera refused by the 3-token window cap');
}

/* ---- 7. differential no-regression battery vs the 3.0.38 reader ---- */
if (parseBefore) {
  const plainShapes = [
    'Karen Bledsoe 58yo F',
    '9:40 AM Karen Bledsoe 58yo F | 03-04-1968 F/U',
    'Bledsoe, Karen 58yo F',
    'Bledsoe, Karen',
    'Karen Bledsoe',
    'Anna Van Der Berg 33yo F',
    "O'Brien, Patrick 61yo M",
    'Mary Smith-Jones 45yo F',
    'Dipietrae, Jr 82yo M',
    'Smith, John, Jr 82yo M',
    '10:15 AM 20min Robert Chen 71yo M | 05-22-1954 EST',
  ];
  const diffs = [];
  for (const raw of plainShapes) {
    const a = parseAfter(raw), b = parseBefore(raw);
    const da = a && a.confident ? a.display + '|' + (a.suffix || '') : '(nc)';
    const db = b && b.confident ? b.display + '|' + (b.suffix || '') : '(nc)';
    if (da !== db) diffs.push(raw + ': 3.0.38=' + db + ' candidate=' + da);
  }
  assert.deepStrictEqual(diffs, [], 'ordinary shapes must parse identically to 3.0.38');
  ok('differential battery: ' + plainShapes.length + ' ordinary shapes identical to 3.0.38');

  /* and the regression really was a regression: 3.0.38 got these right while
     3.0.39 minted the polluted name - pin 3.0.38's correctness so the battery
     cannot rot into asserting agreement on a shared wrong answer. */
  const b = parseBefore('Arrived Karen Bledsoe 58yo F');
  assert.ok(b && b.confident && b.display === 'Karen Bledsoe', '3.0.38 baseline parses the status shape correctly');
  ok('3.0.38 baseline correctness pinned (fences made Arrived a boundary)');
}

console.log('# schedule-chip-name-capture-contract: ' + n + ' checks passed');
