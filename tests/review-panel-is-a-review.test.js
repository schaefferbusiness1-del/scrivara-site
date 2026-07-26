'use strict';

/* The Review panel (rvp-1.0.0) must keep being a REVIEW.
 *
 * Owner: "the review tab sucks and needs to be completely reworked from scratch."
 * There is no reviewView — Review is a dock destination whose first available
 * target is ordersView, so pressing it landed the doctor in the ORDER BUILDER: a
 * diagnosis pull, a new-order form, a chip tray. A place to CREATE things, on the
 * last human gate before Athena.
 *
 * #mlsReviewPanel now fronts that view and answers the only question that screen
 * owes the doctor: what is about to leave, and what is missing. This test pins
 * the three properties that make it a review rather than decoration. Each one has
 * a silent failure mode — none of them throws, and all of them still render
 * something that looks fine.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'latin1');

const start = src.indexOf('REVIEW PANEL (rvp-');
assert.ok(start > -1, 'the rvp-1.0.0 Review panel block is gone from mls-connect.js');
const mod = src.slice(start);
assert.ok(mod.indexOf('mlsReviewPanel') > -1, 'the panel block no longer defines #mlsReviewPanel');

/* Scan CODE, not prose. The panel carries a comment that names the exact bad
   globals it used to read, so a raw substring scan fails on a correct tree and
   fails LOUDER the better the code is documented. Strip block comments first.
   (Block comments only: every explanatory comment in this module is one, and a
   naive // strip risks eating the inside of a string literal.) */
const code = mod.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* ---- 1. IT CONTAINS NO CONTROLS ---------------------------------------
 * The claim is that looking is free and sending costs exactly what it always
 * cost — true by construction only while nothing inside the panel can be
 * pressed. A disabled send is not good enough; a later edit re-enables it. */
{
  const htmlStart = code.indexOf('function html(');
  const htmlEnd = code.indexOf('function build(');
  assert.ok(htmlStart > -1 && htmlEnd > htmlStart, 'could not isolate the panel markup builder');
  const markup = code.slice(htmlStart, htmlEnd);
  const controls = markup.match(/<\s*(button|input|select|textarea|form|a\s)/i);
  assert.strictEqual(controls, null,
    'the Review panel emits a control (' + (controls && controls[0]) + '). It must contain NONE. ' +
    'This codebase has documented history of handOff() reporting "note sent to Athena" over seven ' +
    'silent refusals, and a prettier Review that is easier to click THROUGH is a worse Review. ' +
    'Sending belongs on the visit workspace, behind its existing confirmation.');
}

/* ---- 2. IT READS THE SEND PATH'S OWN PLAN, NOT BARE GLOBALS ------------
 * This one already shipped wrong once, in the panel's first cut. */
{
  assert.ok(/_athenaBuildPlan/.test(code),
    'the panel no longer reads _athenaBuildPlan(). It must describe the visit using the SAME ' +
    'function pushEntireVisitToAthena() uses — a review assembled from a second copy of the ' +
    'rules drifts, and a review that disagrees with what actually leaves is worse than none.');

  const badGlobals = ['window.currentSoap', 'window.currentCoding', 'window.currentInsurance', 'window.currentOrders']
    .filter(g => code.indexOf(g) > -1);
  assert.deepStrictEqual(badGlobals, [],
    'the panel reads ' + badGlobals.join(', ') + '. Those are declared as a top-level `let` in ' +
    'ScribeFlow.html (`let currentSoap=\'\', currentInsurance=\'\', currentCoding=null`), and a ' +
    'top-level `let` does NOT become a property of window — every such read is permanently ' +
    'undefined. The panel shipped this way in its first cut and was stuck on "No note has been ' +
    'generated yet" on every visit, while looking completely healthy. Read through the plan.');

  assert.ok(/cptCodes/.test(code),
    'the panel no longer reads bd.cptCodes. _athenaCanonicalBilling returns {emCode, cptCodes, ' +
    'invalid} — NOT {em, cpt}. Reading bd.cpt silently drops every CPT charge while the E/M still ' +
    'renders, so the panel under-reports what is about to leave and looks fine doing it.');
}

/* ---- 3. GAPS RENDER ABOVE THE LIST ------------------------------------
 * A review that shows only what IS there teaches skimming: everything present
 * looks complete. What is absent is the part a doctor cannot see by looking. */
{
  const htmlStart = code.indexOf('function html(');
  const markup = code.slice(htmlStart, code.indexOf('function build('));
  const gapsAt = markup.indexOf('rvp-gaps');
  const listAt = markup.indexOf('rvp-list');
  assert.ok(gapsAt > -1, 'the gaps section is gone from the panel markup');
  assert.ok(listAt > -1, 'the "what will leave" list is gone from the panel markup');
  assert.ok(gapsAt < listAt,
    'the gaps section must be emitted BEFORE the list. A review that leads with what is present ' +
    'teaches skimming — everything shown looks complete, and what is missing is exactly the part ' +
    'a doctor cannot notice by looking.');
}

/* ---- 4. REDUNDANT RENDERS MUST STAY FREE -------------------------------
 * This app has already paid for no-op rewrites: 86 body-class writes in 44s, and
 * an #ordersBody rebuilt every 5008ms with byte-identical markup. A review panel
 * repainting under the doctor would be one more. Measured 0 mutations across 30
 * forced passes; the signature guard is what makes that true. */
{
  assert.ok(/data-rvp-sig/.test(code),
    'the content-signature guard is gone. Without it every scheduled pass rewrites the panel\'s ' +
    'innerHTML whether or not anything changed, which is the exact churn class this repo has ' +
    'spent several builds removing.');
  assert.ok(/getAttribute\('data-rvp-sig'\)\s*===\s*sig/.test(code),
    'the signature is written but no longer COMPARED before rewriting. Storing it without ' +
    'checking it is indistinguishable from having no guard at all.');
  assert.ok(!/setInterval/.test(code),
    'the panel added a setInterval. The timer fleet in this app was measured at 264 registrations ' +
    'and 179 fires/sec for 2.42% of the main thread while idle, 100% of which changed nothing. ' +
    'Render on view change and on edits inside Orders — not on a clock.');
}

console.log('PASS review-panel-is-a-review: no controls, reads the send path\'s own plan, gaps above the list, and redundant renders stay free');
