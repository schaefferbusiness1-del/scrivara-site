'use strict';

/*
 * 3.0.47 (Matthew, live 2026-08-08): the enumerate op's no-group return was a
 * bare `{ ok:false, count:0, score:0 }` - no reason, no surface proof. Ten
 * identical passes of it rendered as the cryptic `[idx:other;0/0;p10]` on the
 * owner's screen and nobody could say WHICH surface had answered. The refusal
 * itself was correct (never guess-empty); what was missing was the name.
 *
 * BOTH ARMS, per the supervision rule that an assertion passing on both arms
 * is not an assertion:
 *   - no rows + NO explicit empty marker  -> refuse, named 'no-encounter-group',
 *     carrying frameUrl + whether the "Visits and Cases" pane text was seen.
 *     (Fails on pre-3.0.47 code: no reason property existed.)
 *   - no rows + the explicit empty marker -> verified-empty ACCEPT
 *     (authoritativeEmpty), so the honest empty stays recognized and the
 *     refusal arm cannot degenerate into refusing everything.
 * The has-rows arm (the reader actually reads) is pinned by the existing
 * enumerate suites; this file owns the two empty-surface arms.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'latin1');

const start = bg.indexOf('      if (!g) {');
assert(start >= 0, 'missing the no-group block');
const end = bg.indexOf('      var rows = g.rows.map', start);
assert(end > start, 'missing the rows mapper after the no-group block');
const block = bg.slice(start, end);

function runBlock(gValue, emptyMarker, bodyText) {
  const sandbox = {
    g: gValue,
    explicitEmptyVisits: () => emptyMarker,
    location: { href: 'https://athenanet.athenahealth.com/fr/chart/visits.esp' },
    document: { body: { innerText: bodyText } },
    String, Number, RegExp, Boolean,
    result: null
  };
  vm.runInNewContext('result = (function () {\n' + block + '\n return "fell-through"; })();', sandbox, { filename: 'no-group-block.js' });
  return sandbox.result;
}

// Arm 1 - no rows, no marker: a NAMED refusal with surface proof.
const refused = runBlock(null, false, 'Chart Visits and Cases something rendered but rowless');
assert.strictEqual(refused.ok, false, 'no-group without a marker must refuse');
assert.strictEqual(refused.reason, 'no-encounter-group', 'the refusal must name itself (pre-3.0.47 carried NO reason), got: ' + JSON.stringify(refused));
assert(/athenanet/.test(String(refused.frameUrl || '')), 'the refusal must prove WHICH frame answered');
assert.strictEqual(refused.visitsPaneSeen, true, 'the refusal must report whether the Visits and Cases pane text was visible');
const refusedNoPane = runBlock(null, false, 'Inbox messaging surface with no visits pane at all');
assert.strictEqual(refusedNoPane.visitsPaneSeen, false, 'a non-visits surface must report visitsPaneSeen:false');

// Arm 2 - no rows WITH the explicit marker: the honest empty stays an ACCEPT.
const empty = runBlock(null, true, 'No visits recorded for this patient');
assert.strictEqual(empty.ok, true, 'the explicit empty state must remain an accept');
assert.strictEqual(empty.authoritativeEmpty, true, 'the accept must carry authoritativeEmpty');
assert.strictEqual(empty.selector, 'verified-empty-state', 'the accept must name the verified empty state');

// The orchestrator tag must map the new reason instead of dumping it in 'other'.
assert(
  bg.indexOf("erR.indexOf('no-encounter-group') >= 0 ? 'nogroup'") >= 0,
  "the idx tag mapper must classify 'no-encounter-group' as 'nogroup', not 'other'"
);

// The presence verb (same 3.0.47 train): whitelisted, relayed, and answered.
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'latin1');
assert(/mlsAthenaPresence: 1/.test(content), 'content.js must whitelist mlsAthenaPresence');
assert(/mlsAthenaPresenceResult/.test(content), 'content.js must relay the presence result');
assert(/mlsAthenaPresenceRequest/.test(bg), 'background.js must answer the presence request');
assert(/athena-tab-unverified/.test(bg), 'presence must distinguish unverified athena tabs from none');

// 3.0.48 (Edward/Herbert/Carol/Nancy, live 2026-08-08): all four failing charts
// showed ONE frame answering ok while the receipt still said nogroup — the URL
// denylist dropped the ok frame before best-pick. An ok:true enumerate result
// has already passed the in-frame positive gates (Visits-and-Cases ancestor,
// declared total or explicit empty-state, stability) — a URL token must not
// outvote them. BOTH arms: the gated ok result survives the filter (fails
// pre-3.0.48), and non-ok noise stays excluded (the denylist keeps its job).
{
  const filterLine = "var enChart = (enR || []).filter(function (r) { return !(noiseResult(r) && !(r && r.result && r.result.ok === true)); });";
  assert(bg.indexOf(filterLine) >= 0, 'the noise filter must rescue ok:true results (pre-3.0.48 dropped them by URL alone)');
  const noiseResult = (r) => /inbox|messag/i.test(String((r && r.result && r.result.frameUrl) || ''));
  const runFilter = new Function('enR', 'noiseResult', filterLine + ' return enChart;');
  const okNoise = { frameId: 7307, result: { ok: true, count: 9, frameUrl: 'https://x/inbox/visits.esp' } };
  const badNoise = { frameId: 7401, result: { ok: false, reason: 'no-encounter-group', frameUrl: 'https://x/inbox/list.esp' } };
  const plain = { frameId: 7302, result: { ok: false, reason: 'no-encounter-group', frameUrl: 'https://x/chart/main.esp' } };
  const kept = runFilter([okNoise, badNoise, plain], noiseResult);
  assert(kept.some(r => r.frameId === 7307), 'a fully-gated ok result in a noise-URL frame must SURVIVE the filter');
  assert(!kept.some(r => r.frameId === 7401), 'a non-ok noise-URL frame must STAY excluded — the denylist keeps its original job');
  assert(kept.some(r => r.frameId === 7302), 'a non-noise frame is untouched by the rescue');
  assert(/okShape: enOkShape/.test(bg) && /noiseTails: enNoiseTails/.test(bg), 'the failure enumDiag must persist the ok-frame shape and the dropped-frame tails');
}

// 3.0.49 (six live charts, 2026-08-08): after 3.0.48 rescued the INDEX, the
// body-reading walk still dropped the same frame by URL alone
// (no-chart-frame-candidate[stm.esp~noise-surface] on all six). The cure is
// identity-decided, never URL-decided — and the 2026-07-24 worklist weld
// (a noise frame naming a DIFFERENT patient) must STAY dead. Source-pinned
// both ways because the walk's drop logic is the safety contract itself.
{
  assert(
    bg.indexOf("if (ecNoise && !(ecGate && ecGate.ok)) ecDrop = 'noise-surface';") >= 0,
    'a noise-URL walk candidate must be dropped ONLY when its own frame identity fails the gate (pre-3.0.49 dropped by URL alone)'
  );
  assert(
    bg.indexOf("if (/stm\\.esp|globalnav|statusbar|inbox|messag|findpatient\\.esp/i.test(ecUrl)) ecDrop = 'noise-surface';") < 0,
    'the unconditional URL-only drop must be gone from the walk'
  );
  const walkBlock = bg.slice(bg.indexOf('var ecNoise = /stm'), bg.indexOf('if (ecDrop) continue;', bg.indexOf('var ecNoise = /stm')));
  assert(/visitIdentityGate\(frozenHint, ecIdentity\)/.test(walkBlock), 'the noise decision must run through the SAME visitIdentityGate every chart frame passes');
  assert(/noise-identity-verified/.test(walkBlock), 'an identity-verified noise frame must be visibly marked in the walk receipt, never silently kept');
  assert(/ecScoreN < 0 && !ecNoise/.test(walkBlock), 'noise frames reach the identity gate despite their URL penalty score — the gate decides, not the penalty');
}

console.log('encounter-index-names-its-surface: PASS (21 checks)');
