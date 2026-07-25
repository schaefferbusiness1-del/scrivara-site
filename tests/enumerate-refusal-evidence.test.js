'use strict';

/*
 * A refusal must carry its own numbers, because only the string survives.
 *
 * Method note 3 of HANDOFF_THREE_OPEN_DEFECTS_2026-07-24, learned the hard way:
 *
 *   "A diagnostic that doesn't reach the receipt isn't a diagnostic. Only the
 *    `reason` STRING survives the extension->page hop. An object attached to
 *    the gate is silently dropped. Encode evidence into the string."
 *
 * The rule was written down and then not applied to the gates that need it
 * most. `visits-list-still-rendering` returned `declaredEvents` and
 * `renderedListItems` as OBJECT FIELDS. Both are dropped at the boundary, so
 * the owner's one live pull reported the bare gate name and NOT the 22-vs-38
 * that decides which fix is correct — costing a second live pull to learn one
 * number the extension already had in hand.
 *
 * Three gates inside the enumerate op can refuse the real chart frame and they
 * need OPPOSITE fixes:
 *
 *   visits-panel-not-open        the walk never found "Visits and Cases"
 *   visits-total-not-readable    no "All Events (N)" label — refuses FOREVER
 *   visits-list-still-rendering  rendered < declared
 *
 * Telling them apart is the entire remaining question for ON mode, and the
 * numbers are what tell them apart:
 *
 *   - `rows` vs `kids` says whether the encounter list is even populated
 *   - `n` and `sameFor` say whether the list is REALLY still rendering or has
 *     been sitting at the same count for a minute, which is the difference
 *     between "wait longer" and "this rule can never be satisfied here"
 *
 * This suite pins that every refusal carries its evidence in the string. It is
 * cheap to delete by accident — a future edit that "tidies" a template literal
 * back into an object field would silently restore the original defect and no
 * behavioural test would notice, because the refusal is still a refusal.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'latin1');

/* Bound the three gates so the assertions cannot accidentally match some other
   part of a one-million-character file. */
const start = bg.indexOf("if (g && g.selector === 'li.encounter-list-item') {");
const end = bg.indexOf('      if (!g) {', start);
assert(start > 0 && end > start, 'the enumerate qualification gates could not be bounded');
const gates = bg.slice(start, end);

/* Each gate names itself AND reports what it measured. */
assert(/reason: 'visits-panel-not-open\[rows=' \+ g\.rows\.length \+ ';up=' \+ va \+ '\]'/.test(gates),
  'visits-panel-not-open must report how many rows it saw and how far it walked — otherwise "wrong frame" and "panel collapsed" read identically');

assert(/reason: 'visits-total-not-readable\[rows=' \+ g\.rows\.length \+ ';kids=' \+ listKids/.test(gates.replace(/\r/g, '')) ||
  /visits-total-not-readable\[rows='/.test(gates),
  'visits-total-not-readable must report the row and child counts — this gate refuses FOREVER and the numbers are what prove that is what is happening');

assert(/visits-list-still-rendering\[' \+ listKids \+ '\/' \+ evTotal/.test(gates),
  'visits-list-still-rendering must carry rendered/declared IN THE STRING; as object fields they are dropped at the extension-to-page hop');

/* The dropped-object defect specifically: the fields may stay for local
   debugging, but they must never be the ONLY place the numbers live. */
const stillRendering = gates.slice(gates.indexOf('visits-list-still-rendering'));
assert(/declaredEvents: evTotal/.test(stillRendering) && /renderedListItems: listKids/.test(stillRendering),
  'the object fields are still useful in-process and should stay alongside the string');

/* Stability is observed and reported, and — deliberately — gates nothing. The
   mandatory-total rule is unchanged; whether an unreadable total should fall
   back to a stability window is a question for measurement, not for argument,
   and shipping a guess into a clinical read path is what this project has paid
   for repeatedly. */
assert(/window\.__mlsEnumStab/.test(gates), 'row-count stability across passes must be recorded');
assert(/sameFor=/.test(gates), 'the refusal must say how long the count has been unchanged');
assert(/if \(evTotal <= 0\) \{/.test(gates), 'the mandatory-total rule must still be present');
assert(!/stab\s*&&|prev\.n\s*>=|sameFor\s*>/.test(gates.replace(/'[^']*'/g, '')),
  'stability must not yet be used as an acceptance condition — it is observation only until one live pull says what the numbers are');

/* ---- the stability counter is real code; run it. --------------------------- */

const stabStart = gates.indexOf('        var stab = \'\';');
const stabEnd = gates.indexOf('        if (evTotal <= 0) {');
assert(stabStart > 0 && stabEnd > stabStart, 'stability block could not be bounded');

function runStability(samples) {
  const sandbox = { window: {}, Date: { now: () => sandbox.__now }, Math: Math, out: [] };
  sandbox.__now = 0;
  vm.createContext(sandbox);
  for (const s of samples) {
    sandbox.__now = s.at;
    sandbox.listKids = s.kids;
    vm.runInContext('(function(){ var listKids = this.listKids;\n' + gates.slice(stabStart, stabEnd) + '\nthis.out.push(stab); }).call(this)', sandbox);
  }
  return sandbox.out;
}

/* A list that really is still rendering resets the counter every pass. */
{
  const out = runStability([{ at: 0, kids: 4 }, { at: 3500, kids: 9 }, { at: 7000, kids: 17 }]);
  assert.deepStrictEqual(out, [';n=1;sameFor=0s', ';n=1;sameFor=0s', ';n=1;sameFor=0s'],
    'a growing list must never look stable: ' + JSON.stringify(out));
}

/* A list that has stalled reports for how long — the reading that separates
   "wait longer" from "this rule can never be satisfied on this chart". */
{
  const out = runStability([{ at: 0, kids: 22 }, { at: 3500, kids: 22 }, { at: 7000, kids: 22 }, { at: 70000, kids: 22 }]);
  assert.strictEqual(out[0], ';n=1;sameFor=0s');
  assert.strictEqual(out[2], ';n=3;sameFor=7s');
  assert.strictEqual(out[3], ';n=4;sameFor=70s',
    'a count unchanged for 70 seconds must say so — that is exactly the 40/40-samples-over-70-seconds observation the handoff recorded by hand');
}

/* Growth AFTER a stall resets, so a late-hydrating panel cannot be reported as
   having been stable all along. */
{
  const out = runStability([{ at: 0, kids: 2 }, { at: 3500, kids: 2 }, { at: 7000, kids: 22 }]);
  assert.strictEqual(out[1], ';n=2;sameFor=4s');   /* 3500ms rounds to 4, not 3 */
  assert.strictEqual(out[2], ';n=1;sameFor=0s', 'a landing pane that later grows must reset the counter');
}

console.log('PASS enumerate refusal evidence: all three qualification gates carry their numbers in the reason string, and row-count stability is measured across passes without yet gating acceptance');
