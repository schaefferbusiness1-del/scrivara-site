'use strict';
/* =========================================================================
   AN AMBIGUOUS ABBREVIATION MUST NOT ASSERT A BODY REGION
   -------------------------------------------------------------------------
   Found 2026-08-06 by driving the SHIPPED matcher against the owner's real
   96-template library, two days before his father drafts a full day off it.

   expandShorthand expanded TESI unconditionally to "thoracic epidural steroid
   injection". In an interventional pain practice TESI overwhelmingly means
   TRANSFORAMINAL. Measured against that real library: NINE transforaminal
   templates, ZERO thoracic. So:

       rank("R L4-5 TESI")  ===  rank("R L4-5 thoracic epidural steroid injection")
                            ->  "Starter - Lumbar epidural steroid injection"

   i.e. the GENERIC starter, where the doctor meant the right-side L4-L5
   transforaminal template. Spelling it out ("R L4-5 transforaminal ESI")
   matched correctly, which is what isolated the expansion as the cause.

   ILESI was worse: \blesi\b cannot match inside "ILESI", so it expanded to
   NOTHING and "L4-5 ILESI" scored on the level alone, returning a LEFT
   TRANSFORAMINAL template - the wrong approach AND a laterality the doctor
   never wrote.

   THE RULE THIS FILE DEFENDS:
     1. A thoracic level means thoracic. A non-thoracic spinal level rules
        thoracic OUT. With NO level, NO region is asserted - only the part that
        is true under every reading.
     2. Expansion is ADDITIVE and never invents laterality.
     3. The b901/b905 gates that already shipped (LESI, CESI, SIJ, TPI) still
        expand exactly as before.

   Asserting a region from no evidence is the defect. A test that only checked
   "TESI expands to something" would have passed the broken build.
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_integrity.js'), 'utf8');

function extract(name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error(name + ' is missing from feat_mls_opnote_integrity.js');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}

let expandShorthand;
const S = function (x) { return (x == null ? '' : String(x)); };
eval(extract('expandShorthand').replace('function expandShorthand', 'expandShorthand = function'));

let failures = 0;
function has(input, word, why) {
  const out = expandShorthand(input);
  if (new RegExp('\\b' + word + '\\b', 'i').test(out)) { console.log('  pass  ' + JSON.stringify(input) + ' -> carries "' + word + '"'); return; }
  failures++;
  console.error('  FAIL  ' + JSON.stringify(input) + ' should carry "' + word + '"\n        got: ' + JSON.stringify(out) + (why ? '\n        ' + why : ''));
}
function lacks(input, word, why) {
  const out = expandShorthand(input);
  if (!new RegExp('\\b' + word + '\\b', 'i').test(out)) { console.log('  pass  ' + JSON.stringify(input) + ' -> does NOT claim "' + word + '"'); return; }
  failures++;
  console.error('  FAIL  ' + JSON.stringify(input) + ' must NOT claim "' + word + '"\n        got: ' + JSON.stringify(out) + (why ? '\n        ' + why : ''));
}

/* ---- 1. the defect: a lumbar level means TRANSFORAMINAL ---------------- */
console.log('a non-thoracic level rules thoracic out:');
has('R L4-5 TESI', 'transforaminal', 'this returned the GENERIC starter before');
lacks('R L4-5 TESI', 'thoracic', 'the old table asserted thoracic on every TESI');
has('L L5-S1 TESI', 'transforaminal');
lacks('L L5-S1 TESI', 'thoracic');
has('b/l L3-4 TESI', 'transforaminal');
has('C5-6 TESI', 'transforaminal', 'a cervical level also rules thoracic out');
lacks('C5-6 TESI', 'thoracic');

/* ---- 2. a THORACIC level still means thoracic -------------------------- */
console.log('a thoracic level still means thoracic:');
has('T7-8 TESI', 'thoracic', 'the rare reading must still be reachable');
lacks('T7-8 TESI', 'transforaminal');
has('T10-11 TESI', 'thoracic', 'two-digit thoracic levels count too');

/* ---- 3. NO level asserts NO region ------------------------------------- */
console.log('with no level, no region is asserted:');
lacks('TESI', 'thoracic', 'asserting a region from no evidence is the defect');
lacks('TESI', 'transforaminal', 'and the common reading is still a guess without a level');
has('TESI', 'epidural steroid injection', 'but this much is true under every reading');

/* ---- 4. ILESI is unambiguous and must not invent laterality ------------ */
console.log('ILESI expands, and invents nothing:');
has('L4-5 ILESI', 'interlaminar', 'expanded to NOTHING before, and matched a LEFT transforaminal template');
lacks('L4-5 ILESI', 'transforaminal');
lacks('L4-5 ILESI', 'left', 'the doctor never wrote a side');
lacks('L4-5 ILESI', 'right');

/* ---- 5. NEVER REGRESS the gates that already shipped ------------------- */
console.log('the b901/b905 expansions are unchanged:');
has('LESI', 'lumbar epidural steroid injection');
has('CESI', 'cervical epidural steroid injection');
has('SIJ inj left', 'sacroiliac joint injection');
has('TPI trapezius', 'trigger point injection');
/* already-spelled-out text must not be doubled */
lacks('lumbar transforaminal epidural steroid injection TESI', 'thoracic',
  'a spelled-out procedure must never acquire a second, contradictory region');

/* ---- 6. laterality and levels still normalise -------------------------- */
console.log('laterality and level normalisation still work:');
has('R L4-5 TESI', 'right');
has('L L5-S1 TESI', 'left');
has('b/l L3-4 TESI', 'bilateral');
has('R L4-5 TESI', 'L4-L5', 'the adjacent-level short form still canonicalises');

/* ---- 7. structural: expansion is ADDITIVE ------------------------------ */
console.log('structural:');
(function () {
  const samples = ['R L4-5 TESI', 'T7-8 TESI', 'L4-5 ILESI', 'LESI', 'TESI'];
  let ok = true;
  for (const s of samples) {
    const out = expandShorthand(s);
    /* every original word must survive - expansion may add, never remove */
    for (const w of s.split(/\s+/)) {
      const bare = w.replace(/[^A-Za-z0-9\/-]/g, '');
      if (!bare) continue;
      /* level short forms are deliberately rewritten (L4-5 -> L4-L5) */
      if (/^[clts]\d/i.test(bare)) continue;
      if (out.toLowerCase().indexOf(bare.toLowerCase()) < 0) {
        ok = false; console.error('        dropped ' + JSON.stringify(bare) + ' from ' + JSON.stringify(s));
      }
    }
  }
  if (ok) console.log('  pass  expansion only ever ADDS - no original token is lost');
  else failures++;
})();
(function () {
  /* the ambiguous branch must not have been quietly flattened back into the
     table, which is exactly how this regresses */
  const flat = /\[\/\\btesi\\b\/i,\s*'thoracic/.test(src);
  if (!flat) console.log('  pass  TESI is not a flat unconditional expansion in the ABBR table');
  else { failures++; console.error('        FAIL TESI is back in the table as an unconditional thoracic expansion'); }
})();

console.log(failures === 0
  ? 'PASS TESI/ILESI: the level in the text decides the region, no level asserts none, and no laterality is invented'
  : 'FAIL tesi-expands-to-the-region-the-text-supports: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
