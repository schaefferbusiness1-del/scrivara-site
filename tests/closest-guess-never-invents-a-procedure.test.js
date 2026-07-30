'use strict';
/*
 * THE CLOSEST-MATCH FALLBACK, AND THE FOUR THINGS IT MAY NOT DO
 * -----------------------------------------------------------------------------
 * OWNER, verbatim: "fix up the auto match system where it doesnt give up if it
 * cant find a match and just warns the user but finds the closet option".
 *
 * feat_mls_opnote_integrity.js now does that: when best() cannot reach
 * confidence, bestFor() returns the closest template with source:'closest'
 * instead of an empty tplId, the card shows an amber "check this" line, and the
 * draft ledger warns. That is a deliberate LOOSENING of a matcher whose entire
 * job is to refuse when it is not sure, so the loosening needs a fence.
 *
 * Every rule below was written because the first version of the fallback broke
 * it, and each was caught by an existing suite or by the live harness - not
 * imagined here afterwards:
 *
 *   1. NO PROCEDURE. "No procedure was performed today" must never receive a
 *      procedure template. Guessing one fabricates an operation.
 *
 *   2. TWO PROCEDURES. "TFESI vs MBB - decide at visit" must never resolve to
 *      one of them. Guessing is choosing an operation by coin flip.
 *      (First break: the history branch rescued it. historySignal() on a
 *      patient with no chart returns '', best('') is not a safety refusal, and
 *      it handed back the first template in the library as its candidate. The
 *      guess now comes from the procedure text alone.)
 *
 *   3. NO SIGNAL AT ALL. "Routine follow-up" must match nothing. It has no
 *      procedure type, region, side, level or approach - so rank[0] is not the
 *      closest match, it is whichever template sorts first.
 *      (First break: a score>0 test. "Routine follow-up" scores 2, entirely
 *      because the word "follow" appears in FOLLOW-UP headings inside template
 *      BODIES, while real near misses score 3-6. No threshold between 2 and 3
 *      is defensible, so the discriminator is the module's own clinical parser:
 *      at least one parsed procedure fact.)
 *
 *   4. NARROWING WITHIN A FAMILY. "Lumbar ESI" is the parent class; its
 *      children - transforaminal, interlaminar, caudal - are three different
 *      operations through three different needles. The parent must not resolve
 *      to a child, because the note would assert an approach the doctor never
 *      stated and the fidelity layer would then defend that invention as fact.
 *
 * And the fallback must actually FIRE for the case it exists for: a real
 * procedure, with real facts, that no template quite matches.
 *
 * Source-level, deliberately. The live harness proves the behaviour end to end
 * (live-template-lifecycle 4c/4d/4e); this proves the fence is still written
 * down, on every run, with no browser required.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_opnote_integrity.js'), 'utf8');

const guard = /function closestGuess\(r, text\) \{([\s\S]*?)\n  \}/.exec(src);
assert.ok(guard, 'closestGuess is gone or was renamed - the fallback fence cannot be checked');
const body = guard[1];

/* 1 + 2: the safety refusals are excluded by name, in one condition. */
assert.match(body, /if \(r\.noProcedure \|\| r\.multi \|\| r\.conflicts\) return null;/,
  'closestGuess no longer excludes the noProcedure / multi-procedure / incompatible refusals. ' +
  'A guess there fabricates an operation, picks between two named operations, or applies a ' +
  'template already measured as wrong for the request.');

/* 3: a parsed procedure fact, not a score threshold. */
assert.match(body, /if \(!hasProcedureSignal\(text\)\) return null;/,
  'closestGuess no longer requires a parsed procedure signal. "Routine follow-up" would then ' +
  'receive an operative-note template, because template BODIES contain the word "follow".');
assert.match(body, /if \(!\(r\.score > 0\)\) return null;/,
  'closestGuess no longer requires a positive score, so a procedure fact with no template ' +
  'support anywhere would manufacture a "closest" out of an arbitrary first row.');

const signal = /function hasProcedureSignal\(text\) \{([\s\S]*?)\n  \}/.exec(src);
assert.ok(signal, 'hasProcedureSignal is gone - the noise/near-miss discriminator has no owner');
assert.match(signal[1], /procedureType[\s\S]*region[\s\S]*side[\s\S]*levelCount[\s\S]*approach/,
  'hasProcedureSignal no longer reads all five procedure facts, so a request carrying only one ' +
  'of them (a bare side, a bare level) would be treated as noise and refused.');

/* 4: the family-narrowing exclusion. */
assert.match(body, /narrowsWithinFamily\(text, r\.candidate\)/,
  'closestGuess no longer refuses to narrow within a procedure family. "Lumbar ESI" would ' +
  'resolve to a specific approach the doctor never stated.');
const narrows = /function narrowsWithinFamily\(text, tpl\) \{([\s\S]*?)\n  \}/.exec(src);
assert.ok(narrows, 'narrowsWithinFamily is gone');
assert.match(narrows[1], /pc === 'generic_esi' && !!ESI_FAMILY\[tc\]/,
  'the family-narrowing rule no longer names the generic->specific direction. Note that the ' +
  'REVERSE must stay allowed: a specific request against a generic template is safe, because ' +
  'the approach then comes from the procedure text rather than from the template.');

/* the guess must be sourced from the procedure text, never from history */
assert.match(src, /var guess = closestGuess\(direct, reason\);/,
  'the closest guess is no longer taken from the direct procedure text alone. Sourcing it from ' +
  'the history branch let a blank chart supply a candidate for a row that names two procedures.');
assert.doesNotMatch(src, /closestGuess\(fromHistory/,
  'the history branch is guessing again. History may still MATCH - it just has to be confident ' +
  'to do it, which is the branch above.');

/* the flag every downstream reader keys off, written in exactly one place */
const mark = /function markGuess\(row, m\) \{([\s\S]*?)\n  \}/.exec(src);
assert.ok(mark, 'markGuess is gone - nothing sets the flag the draft ledger and the card read');
assert.match(mark[1], /m\.source === 'closest'/, 'markGuess no longer keys off the closest source');
assert.match(mark[1], /delete row\._tplClosestGuess/,
  'markGuess never clears the flag, so a row stays marked as a guess after the doctor fixes the ' +
  'procedure text and it matches confidently.');

for (const caller of ['procChanged', 'autoTpl', 'newRow']) {
  assert.ok(new RegExp('markGuess\\(').test(src), 'markGuess has no callers');
}
const callSites = (src.match(/markGuess\(/g) || []).length;
assert.ok(callSites >= 5,
  `markGuess is called ${callSites} time(s); every path that writes row.tplMatchSource must also ` +
  'write the flag, or the card and the ledger will disagree about whether a row was guessed ' +
  '(declaration + procChanged + autoTpl + newRow + the single-row generate wrapper).');

/* the toast is a warning, not an error: the doctor got something usable */
assert.match(src, /No exact match — used the closest: /,
  'the closest-match toast lost its text. It has to name the template and say it is a guess.');
assert.match(src, /'warn'\);\s*\}\s*\n\s*else if\(m\.tplId\)/,
  "the closest-match toast is no longer 'warn'. A red toast on a successful-if-uncertain action " +
  'reads as a failure and teaches the doctor to stop pressing the button.');

/* the row says so on screen, after the toast is gone */
assert.match(src, /row\.tplMatchSource === 'closest'\) return \{ text:'\(closest match/,
  'the card no longer shows a standing amber line for a guessed template. The toast disappears ' +
  'in seconds and the row would then read exactly like a confident match.');

console.log('PASS closest-guess never invents a procedure: 4 refusals fenced (no-procedure, ' +
  'two-procedure, no-signal, family-narrowing), guess sourced from the procedure text only, ' +
  `flag written at ${callSites} call sites, warn-not-error toast, standing amber line on the card.`);
