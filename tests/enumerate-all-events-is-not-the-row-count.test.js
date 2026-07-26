'use strict';

/*
 * "All Events (N)" counts a population the encounter list never renders.
 *
 * THE MEASUREMENT THAT SETTLED DEFECT 1b. Live pull on the owner's signed-in
 * chart, 2026-07-25, ext 3.0.17, five consecutive patients (Fri Jul 24 schedule):
 *
 *     rendered=9   declared=13   rows=7    stable 53s / 16 passes
 *     rendered=9   declared=11   rows=7    stable 53s / 16 passes
 *     rendered=16  declared=53   rows=14   stable 53s / 16 passes
 *     rendered=22  declared=41   rows=20   stable 53s / 16 passes
 *
 * `rows === listKids - 2` on every one — a fixed two-item chrome in the <ul>.
 * The declared total ranges 11 to 53 with no relation to either figure. No
 * progressive render leaves 37 of 53 items unrendered for 53 seconds across 16
 * passes with an `openVisits` re-drive between each.
 *
 * So `listKids >= evTotal` was never a race condition. It is a category error,
 * and background.js already says so a few lines further down:
 *
 *     "Athena's nearby declared count includes non-visit artifacts sharing the
 *      list (future appointments, vitals and patient cases). The exact
 *      previous-visit encounter rows are the authoritative body count."
 *
 * One branch treated the declared count as authoritative while the next
 * declared it untrustworthy. The comparison is unsatisfiable on every chart
 * measured, which is why ON mode refused 5 of 5 patients on 2026-07-24 and 5 of
 * 5 again on 2026-07-25.
 *
 * WHY RELAXING IT IS SAFE HERE, AND ONLY HERE. Gate 2 — the requirement that
 * "All Events (N)" be READABLE AT ALL — is untouched. Its presence is what
 * proves this is the real Visits panel rather than the 1-2 row landing pane
 * that clones the same row markup, because gate 1's ancestor text scan
 * demonstrably cannot tell them apart (recorded PASSING on the landing pane in
 * tests/live-e2e-artifacts/2026-07-21-reliability-acceptance.md). Only the
 * arithmetic changed, and only after the list has stopped moving.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'latin1');

const gates = bg.slice(
  bg.indexOf("if (g && g.selector === 'li.encounter-list-item') {"),
  bg.indexOf('      if (!g) {')
);
assert(gates.length > 0, 'the qualification gates could not be bounded');

/* ---- the panel-identity check is UNTOUCHED -------------------------------- */

assert(/if \(evTotal <= 0\) \{/.test(gates),
  'the mandatory "All Events" requirement must remain: its PRESENCE is the only working landing-pane discriminator, since gate 1 is recorded passing on that pane');
assert(/reason: 'visits-total-not-readable/.test(gates),
  'an unreadable total must still refuse');
assert(/visits-panel-not-open/.test(gates), 'gate 1 must remain');

/* ---- the arithmetic no longer refuses a settled list ---------------------- */

/* 3.0.19: same bound, measured where it survives. The frame-local counter is
   destroyed by the openVisits re-drive the caller performs between every pass,
   so stabN alone could never reach 6 and this acceptance could never fire —
   5/5 patients refused after 16 identical passes on the owner's live chart.
   The orchestrator's own count is carried in and the stronger of the two wins. */
assert(/if \(!\(effStabN >= 6 && effStabMs >= 20000\)\) \{/.test(gates),
  'a list whose counts are below the declared total must be accepted only once BOTH counts have been stable across >=6 passes and >=20s');
assert(/var effStabN = Math\.max\(Number\(stabN\) \|\| 0, Number\(cfg && cfg\.outerStableN\) \|\| 0\);/.test(gates),
  'the stability evidence must include the orchestrator count, which survives the frame re-render');
assert(/acceptedOnStability = true;/.test(gates),
  'acceptance by stability must be recorded, not silent');
assert(/var shape = listKids \+ ':' \+ g\.rows\.length;/.test(gates),
  'stability must key on the row count as well as the child count — a list whose children hold steady while rows convert is still changing shape');

/* Still refuses while moving. */
assert(/reason: 'visits-list-still-rendering\[' \+ listKids \+ '\/' \+ evTotal/.test(gates),
  'a list that is genuinely still rendering must still refuse, with its numbers');

/* ---- the receipt cannot present this as count-verified -------------------- */

const okReturn = bg.slice(bg.indexOf('        ok: true, selector: g.selector, count: expectedCount'), bg.indexOf("    if (op === 'readExpanded')"));
assert(/acceptedOnStability: acceptedOnStability/.test(okReturn),
  'the receipt must distinguish an index accepted on stability from one verified by count');
assert(/declaredEvents: \(typeof evTotal/.test(okReturn) && /renderedListItems: \(typeof listKids/.test(okReturn),
  'the receipt must carry the discrepancy so nothing downstream can call this count-verified');

/* ---- the stability rule, executed against the measured shapes ------------- */

/* Bound to the stability block ALONE. Ending at `acceptedOnStability` swept in
   the `if (evTotal <= 0)` refusal that sits between them, and the lifted code
   threw ReferenceError against perfectly correct source. */
const stabStart = gates.indexOf("        var stab = '', stabN = 0, stabMs = 0;");
const stabEnd = gates.indexOf('        if (evTotal <= 0) {', stabStart);
assert(stabStart > -1 && stabEnd > stabStart, 'stability block could not be bounded');
const stabSrc = gates.slice(stabStart, stabEnd);
assert(!/evTotal/.test(stabSrc), 'the lifted stability block must not depend on the gate around it');

function run(samples) {
  const sandbox = { window: {}, Date: { now: () => sandbox.__now }, Math: Math, out: [] };
  vm.createContext(sandbox);
  for (const smp of samples) {
    sandbox.__now = smp.at;
    sandbox.listKids = smp.kids;
    sandbox.g = { rows: { length: smp.rows } };
    vm.runInContext(
      '(function(){ var listKids = this.listKids, g = this.g;\n' + stabSrc +
      '\nthis.out.push({ n: stabN, ms: stabMs, settled: (stabN >= 6 && stabMs >= 20000) }); }).call(this)',
      sandbox
    );
  }
  return sandbox.out;
}

/* 1. The measured shape: 9 children / 7 rows, unchanging. Must settle — and NOT
 *    before six passes and twenty seconds. */
{
  const s = [];
  for (let i = 0; i < 16; i++) s.push({ at: i * 3500, kids: 9, rows: 7 });
  const out = run(s);
  assert.strictEqual(out[0].settled, false, 'must not accept on the first sighting');
  assert.strictEqual(out[4].settled, false, 'five passes / 14s is not enough');
  /* Both conditions, not either. The 6th pass satisfies the pass count (n=6) at
     only 17.5s, and must still refuse; the 7th clears 20s. Asserted separately
     because writing this test as "six passes is enough" is exactly the
     off-by-one that would quietly halve the dwell. */
  assert.strictEqual(out[5].n, 6, 'the sixth pass is reached');
  assert.strictEqual(out[5].settled, false, 'six passes at 17.5s must NOT settle — the 20s floor is independent');
  assert.strictEqual(out[6].settled, true, 'the seventh pass clears 20s: ' + JSON.stringify(out[6]));
  assert.strictEqual(out[15].n, 16, 'the observed run reached 16 identical passes');
  assert(out[15].ms >= 52000 && out[15].ms <= 54000, 'the observed run held ~53s, got ' + out[15].ms);
}

/* 2. A genuinely progressive panel must never settle while it grows. This is
 *    the case the original gate existed to catch and it still must be caught. */
{
  const out = run([
    { at: 0, kids: 2, rows: 0 }, { at: 3500, kids: 5, rows: 3 }, { at: 7000, kids: 9, rows: 7 },
    { at: 10500, kids: 14, rows: 12 }, { at: 14000, kids: 18, rows: 16 }, { at: 17500, kids: 22, rows: 20 }
  ]);
  for (const o of out) assert.strictEqual(o.settled, false, 'a growing list must never settle');
}

/* 3. THE SUBTLE ONE. Child count frozen while rows convert to previous-visit —
 *    the shape a child-count-only key would call stable. */
{
  const out = run([
    { at: 0, kids: 22, rows: 14 }, { at: 3500, kids: 22, rows: 17 }, { at: 7000, kids: 22, rows: 20 },
    { at: 10500, kids: 22, rows: 20 }, { at: 14000, kids: 22, rows: 20 }, { at: 17500, kids: 22, rows: 20 },
    { at: 21000, kids: 22, rows: 20 }, { at: 24500, kids: 22, rows: 20 }, { at: 28000, kids: 22, rows: 20 }
  ]);
  assert.strictEqual(out[2].n, 1, 'the row change at 7s must reset the counter');
  /* The dwell restarts from the LAST change, not from page load: the run only
     clears 20s at 28s wall-clock because the rows were still converting at 7s. */
  assert.strictEqual(out[7].settled, false, 'six holds but only 17.5s since the last change');
  assert.strictEqual(out[8].settled, true, 'settles once the rows have also held 20s+: ' + JSON.stringify(out[8]));
  assert(out.slice(0, 8).every((o) => !o.settled), 'nothing may settle before the dwell completes AFTER the last change');
}

/* 4. A late arrival after an apparent settle resets. A panel that pauses, then
 *    streams more, must not have been accepted during the pause. */
{
  const s = [];
  for (let i = 0; i < 8; i++) s.push({ at: i * 3500, kids: 9, rows: 7 });
  s.push({ at: 8 * 3500, kids: 22, rows: 20 });
  const out = run(s);
  assert.strictEqual(out[7].settled, true, 'the pause looks settled while it lasts');
  assert.strictEqual(out[8].settled, false, 'and the late arrival immediately resets it');
  assert.strictEqual(out[8].n, 1, 'the counter restarts at the new shape');
}

console.log('PASS All Events is not the row count: a settled panel below its declared total is accepted (measured 9/13, 9/11, 16/53, 22/41 across five live patients), a growing or converting one still refuses, and the receipt records that acceptance came from stability');
