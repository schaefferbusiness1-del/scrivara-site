'use strict';
/*
 * "THE TEMPLATE AUTO MATCHING JUST IS NOT THAT GOOD" — AND IT WAS THE GATE
 * -----------------------------------------------------------------------------
 * Owner, 2026-08-06. QA measured it against the text his SCHEDULE actually
 * carries rather than against well-formed strings: his athenaOne day grid says
 * "Lumbar Spine", "Facet", "Genicular" — not "Left L4-5 TFESI".
 *
 *     27 real-world reasons tested -> 3 matched, 24 REFUSED
 *     and in ~20 of the refusals the CLOSEST CANDIDATE WAS ALREADY CORRECT
 *     "Genicular" refused against a template named "Genicular Nerve Block"
 *
 * So the ranker was never the problem. `top.score >= 10 && margin >= 4` is
 * calibrated for long formal strings and a two-word reason cannot reach it no
 * matter how plainly it names one template.
 *
 * THIS IS THE MIRROR OF THE LATERALITY DEFECT, NOT ITS UNDOING. That one
 * committed confidently and wrongly — a bare "R" silently took the LEFT
 * template. The cure tightened confidence and over-tightened it into never
 * committing, so the doctor picks manually every time and concludes the feature
 * does not work. He is right; it didn't.
 *
 * THE FIX IS A NARROWING, NOT A LOWERING: if the reason's own words are all
 * present in EXACTLY ONE template's name, that is a name, not a guess. Two
 * matches means ambiguous and still refuses — which is exactly the
 * cervical-vs-lumbar and left-vs-right case that must keep failing closed.
 *
 * WHY QA'S EARLIER 48/48 DID NOT SEE THIS, recorded because it is the night's
 * theme in a new costume: that matrix fed ideal inputs, which clear the
 * threshold easily. A SUITE BUILT FROM WELL-FORMED INPUTS CANNOT SEE A GATE
 * THAT ONLY REAL INPUTS FAIL. The 48/48 was true and was never the whole
 * picture. This file therefore tests BOTH populations, and the ideal one is
 * here as the anti-regression: a threshold fix that re-opens the wrong-side bug
 * must fail loudly.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');

/* Lift the real helpers out of the shipped module — never a re-implementation. */
function lift(name) {
  const at = src.indexOf('function ' + name + '(');
  assert(at >= 0, name + '() is not in feat_mls_opnote_integrity.js — the matcher was renamed or removed');
  let depth = 0, started = false, end = at;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  return src.slice(at, end);
}

const api = new Function('S', 'normText', 'tokens',
  lift('stemWord') + '\n' + lift('namedExactlyOne') +
  '\nreturn {namedExactlyOne:namedExactlyOne, stemWord:stemWord};'
)(
  (x) => (x == null ? '' : String(x)),
  (x) => String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(),
  function tokens(text) {
    const stop = { the: 1, and: 1, for: 1, with: 1, under: 1, using: 1, procedure: 1, note: 1, operative: 1, injection: 1 };
    return String(text == null ? '' : text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      .split(/\s+/).filter((w) => w.length > 1 && !stop[w]);
  }
);

/* A stand-in for the shape of his real library: distinct procedure types, and
   deliberately INCLUDING same-type siblings that differ only by side or region,
   because those are what must keep refusing. */
const LIBRARY = [
  { id: 't1', name: 'Genicular Nerve Block' },
  { id: 't2', name: 'Lumbar Facet Joint Injection' },
  { id: 't3', name: 'Left hip intra-articular injection' },
  { id: 't4', name: 'Caudal Epidural Steroid Injection' },
  { id: 't5', name: 'Left sacroiliac joint injection' },
  { id: 't6', name: 'Trigger point injections, trapezius' },
  { id: 't7', name: 'Left lumbar medial branch radiofrequency ablation' },
  { id: 't8', name: 'Left cervical medial branch block' },
  { id: 't9', name: 'Transforaminal Epidural Steroid Injection' },
  /* A template whose name carries a TWO-LETTER token. Without it the
     minimum-length filter is untestable: tokens() already drops 1-char words,
     so no reason could ever match through a short fragment and the mutation
     that removes the filter stayed invisible. */
  { id: 't10', name: 'SI joint RFA, right' }
];

/* ---- 1. THE HEADLINE: a reason that NAMES a template resolves ----------- */
[
  ['Genicular', 't1'],
  ['Facet', 't2'],
  ['Hip injection', 't3'],
  ['Trigger points', 't6'],
  ['Caudal', 't4'],
  ['Sacroiliac', 't5']
].forEach(([reason, id]) => {
  const hit = api.namedExactlyOne(reason, LIBRARY);
  assert(hit, '"' + reason + '" resolved to nothing — this is the live defect: the closest candidate was already correct and the gate would not commit');
  assert.strictEqual(hit.id, id, '"' + reason + '" resolved to ' + hit.name + ' — a wrong template is worse than a refusal');
});

/* ---- 2. AMBIGUITY STILL REFUSES. This is the laterality safety ---------- */
[
  ['Medial branch', 'two medial-branch templates (cervical block, lumbar RFA) — side/region undecided'],
  ['Epidural', 'both a caudal and a transforaminal epidural steroid injection exist'],
  ['Steroid injection', 'several steroid injections across different regions'],
  ['Injection', 'names no procedure type at all'],
  ['Procedure', 'names nothing'],
  ['Follow up', 'not a procedure']
].forEach(([reason, why]) => {
  assert.strictEqual(api.namedExactlyOne(reason, LIBRARY), null,
    '"' + reason + '" was resolved by name, but ' + why + ' — committing here is the wrong-side bug returning');
});

/* ---- 3. A fragment can never name anything ----------------------------- */
/* 'SI' is the load-bearing case: it IS a token of t10's name, so only the
   minimum-length filter refuses it. Without t10 in the library this whole
   section was vacuous — no reason could reach a short token at all, and the
   mutation removing the filter passed unnoticed. */
['L', 'R', 'SI', 'B/L', '', '   ', '5'].forEach((reason) => {
  assert.strictEqual(api.namedExactlyOne(reason, LIBRARY), null,
    '"' + reason + '" named a template — a one-or-two character fragment is exactly the bare-"R" input that used to take the LEFT template');
});

/* ---- 4. singular/plural folding, and only that -------------------------- */
assert.strictEqual(api.stemWord('points'), 'point', 'plural folding is gone — "Trigger points" stops matching "Trigger point injections"');
assert.strictEqual(api.stemWord('bursa'), 'bursa', 'a word ending in "a" was mangled');
assert.strictEqual(api.stemWord('ss'), 'ss', 'a short word was stemmed away');
assert.strictEqual(api.stemWord('facet'), 'facet', 'a singular word was altered');

/* ---- 5. a one-template library never names anything ---------------------
   A single-template library is not clinical evidence — the module already
   refuses there, and this path must not become a way around that. */
assert.strictEqual(api.namedExactlyOne('Genicular', [LIBRARY[0]]), null,
  'a ONE-template library resolved by name — a blank or follow-up row would take that template merely because it is the only one');

/* ---- 6. NEGATIVE CONTROL: the fixture can produce ambiguity -------------
   If every reason above resolved because the library happens to have no
   near-neighbours, section 2 proves nothing. Assert the collision exists. */
const branchMatches = LIBRARY.filter((t) => /medial branch/i.test(t.name));
assert(branchMatches.length >= 2,
  'the fixture library no longer contains two medial-branch templates, so the ambiguity assertions above are vacuous');

/* ---- 7. the gate still requires this to be an EXTRA path, not a bypass --
   The confidence expression must keep every original condition. If a future
   edit replaces them with the name rule, vague scoring resolves again and the
   dead-heat protection is gone. */
/* Anchor on the expression itself, not on a byte window from an earlier line —
   the first version sliced 900 chars from `var deadHeat =` and failed on
   correct code because the explanatory comment between them is longer than
   that. A structural anchor cannot drift when someone writes a paragraph. */
const gAt = src.indexOf('var confident = ');
assert(gAt >= 0, 'the confidence expression was renamed — re-aim this check before trusting it');
/* To the END OF THE STATEMENT, not "a couple of lines". A mutation test caught
   the first version reading two lines and picking up `classExact`, `margin >= 4`
   and `siblingSafe` out of the *following* if-block — so replacing the whole
   confidence expression with `!!named` still passed. The check was reading the
   neighbours of the thing it was meant to police. */
const gate = src.slice(gAt, src.indexOf(';', gAt) + 1);
assert(/var deadHeat =/.test(src.slice(0, gAt)), 'the dead-heat computation disappeared from the gate');
/* AND THAT best() ACTUALLY CALLS THE RULE. Everything above exercises
   namedExactlyOne() in isolation, which is the same shipped-vs-shadowed hole
   that cost two builds tonight: the helper can be perfect and unreferenced.
   Mutation-proven — setting `var named = null` in the gate left this suite
   green until this assertion existed. */
assert(/var named = namedExactlyOne\(procedure, list\);/.test(src),
  'best() no longer calls namedExactlyOne — the rule is dead code and every real schedule reason refuses again');
assert(/classExact/.test(gate) && /margin >= 4/.test(gate) && /top\.score >= 10/.test(gate) && /siblingSafe/.test(gate),
  'the original confidence conditions were removed rather than added to — the name rule is a NARROWING and must not replace the margin test');
assert(/!deadHeat/.test(gate),
  'the dead-heat guard is gone from the confidence expression — two same-class templates tying on score would resolve by array order again');

console.log('PASS template match on real schedule text: 6 two-word reasons that NAME one template now resolve (was 24/27 refused ' +
  'with the right answer already ranked first), ambiguity across side/region/type still refuses, a bare fragment never names ' +
  'anything, a one-template library still refuses, and the margin + dead-heat conditions are pinned so the fix cannot become a bypass');
