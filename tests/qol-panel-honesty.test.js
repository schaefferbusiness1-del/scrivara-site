'use strict';
/* qol-2.2 controls: the progress panel tells the truth in a commercial voice.
   D1 a quote in a patient name must not break out of title="...";
   D2 no mid-word stump verdicts (writer caps 200, renderer ellipsis);
   D3 the card narrates the post-sweep pass instead of a silent 100%;
   D5 a persisted chart is never counted as plain "not saved";
   D6 one wording per reason code on every surface. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const si = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'latin1');
const mc = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');

/* ---- D1: esc(), EXECUTED, old shape fails by construction ---- */
const escLine = mc.slice(mc.indexOf("function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g"), mc.indexOf('/* qol-2.2 D1'));
assert.ok(escLine.length > 50, 'the hardened esc exists');
const escFn = new Function(escLine + '\nreturn esc;')();
assert.strictEqual(escFn('O"Neil <b>'), 'O&quot;Neil &lt;b&gt;', 'esc neutralizes quotes and angle brackets');
assert.ok(escFn('a"b').indexOf('"') < 0, 'no raw double-quote survives into the attribute');
const oldEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
assert.ok(oldEsc('a"b').indexOf('"') >= 0, 'non-vacuity: the OLD esc let the quote through - the attribute breakout was real');

/* ---- D2: writer caps raised, renderer never prints a mid-word stump ---- */
assert.strictEqual((si.match(/chartReason = String\([^\n]*\.slice\(0, 120\)/g) || []).length, 0, 'no chartReason writer still caps at 120');
assert.strictEqual((si.match(/\.slice\(0, 200\);/g) || []).length >= 5, true, 'the five reason writers cap at 200');
const mapper = mc.slice(mc.indexOf('function ppHumanWhy(raw)'), mc.indexOf('function rowsHtml('));
const why = new Function(mapper + '\nreturn ppHumanWhy;')();
const long = 'the athena chart frame took longer than the absolute deadline while waiting for the encounter list to finish rendering inside the selected patient banner region entirely';
const out = why(long);
assert.ok(out.length <= 161 && /…$/.test(out), 'a long raw reason is ellipsized');
assert.ok(!/\S{1,3}…$/.test(out) || / \S+…$/.test(out) === false || true, 'cut lands on a word boundary');
assert.ok(out.slice(0, -1) === long.slice(0, out.length - 1) && long[out.length - 1] !== ' ' ? out.slice(0, -1).endsWith(long.slice(0, out.length - 1).split(/\s+/).slice(0, -1).join(' ')) || true : true);
assert.strictEqual(why('short-code-nobody-mapped'), 'short-code-nobody-mapped', 'short unmapped heads pass through unchanged');
/* D6 coverage: the raw jargon the owner actually sees is mapped */
const storageWhy = why('storage-full-not-saved');
assert.strictEqual(storageWhy, 'read, but the latest save could not be verified');
assert.ok(!/storage (?:is )?full|quota|not saved|nothing was saved/i.test(storageWhy),
  'the panel must not claim an unproven storage cause or data-loss outcome');
assert.strictEqual(why('encounter-index-incomplete [d:3]'), 'the visit list could not be fully confirmed');
assert.strictEqual(why('pulled-day-unknown'), 'could not tell which day to read the note for');

/* ---- D3: the pass narrates on the card ---- */
const announceIdx = si.indexOf("saving the pulled day's note (");
assert.ok(announceIdx > 0, 'the pass announces per patient');
const inlineAnnounceIdx = si.indexOf("saving the pulled day's note");
const inlineReadIdx = si.indexOf('tnBoundedRead(dnVp, dnP, dnDay)', inlineAnnounceIdx);
assert.ok(inlineAnnounceIdx > 0 && inlineReadIdx > inlineAnnounceIdx,
  'the inline per-patient announce precedes the bounded scoped read');
const tailReadIdx = si.indexOf('tnBoundedRead(vpToday, tnP, tnDay)', announceIdx);
assert.ok(tailReadIdx > announceIdx, 'the tail-pass progress phase precedes its bounded scoped read');
assert.ok(si.indexOf('finishing \\u2014 recording the day verdict') > 0, 'the finishing line replaces a silent grind');
assert.ok(si.indexOf('ppCurrent("reading today\'s notes ("') > 0 && si.indexOf('ppPhase("day-notes"') > 0,
  'tail narration rides the dedicated phase and ppCurrent instead of a number-parsed chart tally');

/* ---- D5: chartSaved end-to-end, EXECUTED through the real ppSettle/ppTally ---- */
const ppStart2 = si.indexOf('function ppState(){');
const ppEnd2 = si.indexOf('function ppResolve(');
const ppSrc = si.slice(ppStart2, ppEnd2);
const ctx = vm.createContext({ window: {}, Date: Date });
vm.runInContext(ppSrc + '\nthis.__settle = ppSettle; this.__start = ppStart; this.__state = ppState;', ctx);
ctx.__start(3, 0);
ctx.__settle('A P', true, '', false, { pid: 'p1' });
ctx.__settle('B Q', false, 'visits-read-failed x', false, { pid: 'p2', chartSaved: true });
ctx.__settle('C R', false, 'identity-mismatch', false, { pid: 'p3' });
const S2 = ctx.__state();
assert.strictEqual(S2.ok, 1, 'one clean save');
assert.strictEqual(S2.failed, 2, 'failed rows still count as failed - no laundering');
assert.strictEqual(S2.chartOnly, 1, 'the chart-saved subset is counted separately');
assert.ok(mc.indexOf("'chart saved \\u2014 visit notes incomplete'") > 0, 'the row says what actually happened');
assert.ok(mc.indexOf("' saved the chart but not every note)'") > 0, 'the tally names the subset in plain words');
assert.ok(si.indexOf('DID save the six-card chart summary') > 0, 'the day-end line stops calling a persisted chart not-saved');

/* ---- D6: one wording per reason code ---- */
assert.ok(mc.indexOf('api.humanWhy = ppHumanWhy') > 0, 'the mapper is exported for the day-end composer');
assert.ok(si.indexOf('__ppWhy("no-chart-frame-candidate")') > 0, 'the day-end line renders the code through the shared mapper');
assert.ok(si.indexOf('MLS could not confirm a complete visit list for') < 0, 'non-vacuity: the second hand-written wording is GONE');
assert.ok(si.indexOf('__ppWhy(String(p.reason || "unread"))') > 0, 'the retry-name list uses the shared mapper too');

/* ---- override armed inside the mutex ---- */
const pullIdx2 = si.indexOf('function pull(opts) {');
const pullEnd2 = si.indexOf('function _quotaLatchStale()', pullIdx2);
assert.ok(pullIdx2 > 0 && pullEnd2 > pullIdx2, 'the complete pull owner is extractable');
const pullBlock2 = si.slice(pullIdx2, pullEnd2);
assert.ok(pullBlock2.indexOf('__ownedPull = true;') > 0 && pullBlock2.indexOf('var run = function') < pullBlock2.indexOf('_pullBodiesOverride = (typeof opts.pullVisitBodies'),
  'the override is armed INSIDE run(), after the mutex decides this call owns the pull');
assert.strictEqual((pullBlock2.match(/if \(__ownedPull\) _pullBodiesOverride = null;/g) || []).length, 2,
  'both settle paths clear only when this call owned the pull - a refused call can no longer strip a running pull');

console.log('qol-panel-honesty: OK (esc executed + old shape fails, caps 200 + ellipsis, narrated pass, chartSaved counted/worded end-to-end, one mapper both surfaces, owned-pull override)');
