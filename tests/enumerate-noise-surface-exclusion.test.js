'use strict';

/*
 * A noise surface can never supply a patient's encounter index.
 *
 * From HANDOFF_THREE_OPEN_DEFECTS_2026-07-24, filed as a safety item that
 * "stands on its own terms" and must not be deleted as redundant once the
 * enumerate fix lands:
 *
 *   "A noise surface can currently satisfy ok && count && indexComplete, which
 *    is how stm.esp gets believed. That means the reader can hold what it
 *    thinks is a complete index of a patient's encounters while looking at the
 *    doctor's inbox."
 *
 * WHAT WAS MEASURED, 2026-07-24, on a live pull. Twelve frames answered
 * `enumerate` and exactly one returned ok:
 *
 *   enum=0-,532-,535-,530-,526-,527-,531-,538-,534-,528+,529-,536-
 *
 * Frame 528 is `coordinator/enterprise/stm.esp` — the enterprise inbox. It
 * reported 38 pseudo-encounters and a DIFFERENT patient's banner, drawn from
 * the doctor's worklist. The real chart frame, frMain, sat fully loaded the
 * whole time with 22 `li.encounter-list-item` rows, stable across 40 of 40
 * samples over 70 seconds.
 *
 * 3.0.8 added a noise test to the candidate WALK, so a noise frame can no
 * longer be SELECTED as the chart. It did not close this hole, because the
 * index is chosen earlier and separately, by `bestResult(enR, …)` over every
 * frame that answered, with no noise test at all. Three things follow from a
 * noise frame winning there, and all three are silent:
 *
 *   1. `enumRes.indexComplete` decides whether the read proceeds.
 *   2. `receipt.expected` is counted against that frame's row count, so the
 *      completeness receipt is measured against the wrong denominator.
 *   3. A satisfied index ENDS the retry loop that would otherwise have
 *      re-opened the real chart. The failure is not merely wrong, it is
 *      terminal.
 *
 * This suite pins the exclusion at the point candidates are BUILT, and pins the
 * one property that makes it safe: it fails OPEN. A result carrying no frame
 * URL is still considered, so the filter can only ever remove a surface that
 * identified ITSELF as noise, never a chart frame that stayed silent.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'latin1');

/* ------------------------------------------------------------- contract -- */

/* BOTH ok-returns must carry it, and the count is asserted rather than the mere
   presence of one: a first version of this check passed with the field deleted
   from the main success return, because the empty-state return still matched.
   Both are load-bearing. The success return is the obvious one; the empty-state
   return sets ok && count:0 && indexComplete && authoritativeEmpty, which is a
   POSITIVE claim that the patient has no encounters — asserting that from the
   doctor's inbox would be a clinical negative drawn from a worklist. */
const frameUrlSites = (bg.match(/frameUrl: \(function \(\) \{ try \{ return String\(location\.href\)/g) || []).length;
assert.strictEqual(frameUrlSites, 2,
  'both enumerate ok-returns must report the URL of the frame they ran in (success and authoritative-empty) — without it the exclusion needs a second injected call per candidate, which is why it only ever lived in the walk');

const okReturn = bg.slice(bg.indexOf('        ok: true, selector: g.selector, count: expectedCount'), bg.indexOf('    if (op === \'readExpanded\')'));
assert(/frameUrl:/.test(okReturn), 'the enumerate SUCCESS return must carry frameUrl');
const emptyReturn = bg.slice(bg.indexOf("if (explicitEmptyVisits()) return { ok: true, selector: 'verified-empty-state'"), bg.indexOf("return { ok: false, count: 0, score: 0 };"));
assert(/frameUrl:/.test(emptyReturn), 'the enumerate AUTHORITATIVE-EMPTY return must carry frameUrl — it claims the patient has no encounters');

assert(/var eb = bestResult\(enChart,/.test(bg),
  'the index frame must be chosen from noise-filtered results; bestResult(enR, …) can select the doctor\'s inbox');
assert(!/bestResult\(enR,/.test(bg),
  'a raw enR still reaches bestResult somewhere — every build site must use the filtered list');
assert(/for \(var ecJ = 0; ecJ < enChart\.length; ecJ\+\+\)/.test(bg),
  'the enumerate candidate list must be built from the filtered results, not from every frame that answered');

/* The walk keeps its own drop. Belt and braces is deliberate here: the two
   guards fail differently — this one removes the candidate, the walk's records
   WHY in the receipt — and the handoff asks specifically that neither be
   deleted as redundant. */
assert(/ecDrop = 'noise-surface'/.test(bg),
  'the candidate walk must keep its own noise drop; it is what names the refusal in the receipt');

assert(/enNoiseDropped \? '\[noise-frames-excluded:'/.test(bg),
  'when every answering frame was noise the refusal must say so — only the reason STRING survives the extension-to-page hop, so an excluded-everything outcome would otherwise be indistinguishable from a chart that never loaded');

/* ------------------------------------------------------- the real filter -- */

/* Bound at the predicate only. The `enChart` line right after it closes over
   `enR`, a local of the read loop, so lifting it would need the whole function
   — and the filtering itself is one .filter() the cases below apply directly. */
const start = bg.indexOf('      var NOISE_SURFACE_RE =');
const end = bg.indexOf('      var enChart = (enR || [])');
assert(start > 0 && end > start, 'noise filter block could not be bounded');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  '(function(){' + bg.slice(start, end) + '\nthis.noiseResult = noiseResult;\nthis.RE = NOISE_SURFACE_RE;\n}).call(this)',
  sandbox
);

/* bestResult is small and standalone; lift the shipped one rather than model
   it, so a change to its tie-breaking cannot silently invalidate this proof. */
const brStart = bg.indexOf('  function bestResult(results, scoreFn) {');
const brEnd = bg.indexOf('\n  }', brStart) + 4;
assert(brStart > 0, 'bestResult could not be bounded');
vm.runInContext('(function(){' + bg.slice(brStart, brEnd) + '\nthis.bestResult = bestResult;\n}).call(this)', sandbox);

const ok = (frameId, url, count, selector) => ({
  frameId,
  result: { ok: true, selector: selector || 'li.encounter-list-item', count, score: count, indexComplete: true, frameUrl: url }
});
const refused = (frameId, url) => ({ frameId, result: { ok: false, count: 0, score: 0, frameUrl: url } });

/* The live frame set. Only 528 answered ok, and 528 is the inbox. */
const CHART = 'https://athenanet.athenahealth.com/ax/briefing/7772864#chart?section=visits/qualityPane?isCollapsed=';
const INBOX = 'https://athenanet.athenahealth.com/1/16/coordinator/enterprise/stm.esp?TABTOKEN=x';

{
  const enR = [
    refused(0, 'https://athenanet.athenahealth.com/globalframeset.esp'),
    refused(532, CHART),
    ok(528, INBOX, 38)
  ];
  const enChart = enR.filter((r) => !sandbox.noiseResult(r));
  assert.strictEqual(enChart.length, 2, 'the inbox must be removed before the index is chosen');
  const eb = sandbox.bestResult(enChart, (r) => (r && r.ok ? (r.selector === 'li.encounter-list-item' ? 100000 : 0) + (r.score || 0) : 0));
  /* bestResult seeds bestScore at -1, so a REFUSED result (score 0) still wins
     over nothing — it returns a refusal, not null, and the caller refuses on
     `!enumRes.ok`. The contract that matters is therefore not "returns null"
     but "cannot return the inbox, and cannot return something ok". Asserting
     null here failed, and the code was right: the first version of this test
     modelled bestResult instead of reading it. */
  assert.notStrictEqual(eb.frameId, 528,
    'the inbox must not be reachable as the index frame');
  assert.strictEqual(eb.result.ok, false,
    'with the real chart frame refusing and only the inbox answering, the read must hold NO usable index — believing 38 inbox rows, and ending the retry loop that would have re-opened the real chart, is the defect this exists to prevent');
  assert.notStrictEqual(eb.result.count, 38, 'the inbox row count must never become receipt.expected');
}

/* The genuine chart wins whenever it answers, and its collapsed qualityPane URL
   must not be mistaken for noise. */
{
  const enR = [ok(532, CHART, 22), ok(528, INBOX, 38)];
  const enChart = enR.filter((r) => !sandbox.noiseResult(r));
  const eb = sandbox.bestResult(enChart, (r) => (r && r.ok ? (r.selector === 'li.encounter-list-item' ? 100000 : 0) + (r.score || 0) : 0));
  assert.strictEqual(eb.frameId, 532, 'the real chart frame must be selected');
  assert.strictEqual(eb.result.count, 22, 'the 22-row index is the one to keep');
}

/* FAILS OPEN. A result with no frameUrl — an older shape, or a frame that could
   not read its own location — is kept. This filter may only remove a surface
   that identified itself as noise. */
{
  const silent = { frameId: 540, result: { ok: true, selector: 'li.encounter-list-item', count: 9, score: 9, indexComplete: true } };
  assert.strictEqual(sandbox.noiseResult(silent), false, 'a result with no frameUrl must never be dropped');
  assert.strictEqual(sandbox.noiseResult({ frameId: 1, result: { ok: true, frameUrl: '' } }), false, 'an empty frameUrl must never be dropped');
  assert.strictEqual(sandbox.noiseResult({}), false, 'a malformed result must never be dropped');
}

/* Every surface the walk already refuses must be refused here too, or the two
   guards disagree about what noise is — which is how they drifted apart the
   first time (the walk's list and the frame-eligibility list were different). */
for (const url of [
  'https://athenanet.athenahealth.com/1/16/coordinator/enterprise/stm.esp',
  'https://athenanet.athenahealth.com/globalnav.esp',
  'https://athenanet.athenahealth.com/statusbar.esp',
  'https://athenanet.athenahealth.com/1/2/inbox/list.esp',
  'https://athenanet.athenahealth.com/1/2/messaging/thread.esp',
  'https://athenanet.athenahealth.com/findpatient.esp?x=1'
]) {
  assert.strictEqual(sandbox.noiseResult({ result: { frameUrl: url } }), true, 'must be treated as noise: ' + url);
}

/* And no chart-shaped URL may be caught by it. */
for (const url of [
  CHART,
  'https://athenanet.athenahealth.com/ax/briefing/123#chart?section=visits',
  'https://athenanet.athenahealth.com/1/2/encounter/summary.esp?FROMSTREAMLINED=1'
]) {
  assert.strictEqual(sandbox.noiseResult({ result: { frameUrl: url } }), false, 'must NOT be treated as noise: ' + url);
}

console.log('PASS enumerate noise-surface exclusion: the doctor\'s inbox cannot supply a patient\'s encounter index, the collapsed chart pane is not mistaken for noise, and a frame that does not identify itself is never dropped');
