/* surface-recycle-rebind (srr-1.0, 3.0.50)
 *
 * Live 2026-08-08: athenaOne's exam-prep/scheduling context REPLACES the visits
 * document on its own ~25-30s cycle (frame-age probes 3s/11s across 95s of wall
 * time with every engine quiet). A row that fails after such a replacement was
 * failing in a world whose enumerate-time stamps are gone - both cold retries
 * re-clicked into that world and were doomed (Monday 2026-08-10 roster: James
 * x4 no-bound-clinical-detail, Christopher x1 accordion-not-open). And the ax
 * briefing variant (CLINCMP rollout) hides its navigation in shadow roots, so
 * the light-DOM escape clicker found nothing for five rounds -> exam-prep-stuck.
 *
 * srr-1.0 pins:
 *   1. documentId epoch helper with the visit-guard discipline ('' on doubt).
 *   2. Epoch frozen at index acceptance, before the row loop.
 *   3. Recycle branch in the cold-retry loop: epoch probe -> openVisits ->
 *      SAME identity gate -> re-enumerate -> whole-row-set rowKey re-bind;
 *      bounded to 3; fail-closed reasons on identity/row-set mismatch.
 *   4. Receipt carries surfaceResets (+ bounded op list).
 *   5. Briefing escape collects controls through open shadow roots while the
 *      BAD-verb filter and the visibility test stay byte-identical.
 *   6. CONTROL: a source with the srr blocks stripped (the pre-fix shape) must
 *      FAIL these checks - a gate that passes old code checks nothing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { console.error('FAIL surface-recycle-rebind: ' + label); process.exit(1); }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');

/* ---- the assertion set, reusable so the control arm can run it ---- */
function srrAssert(s) {
  const r = [];
  r.push(/async function visitsListFrameDocId\(tabId, frameId\)/.test(s));
  r.push(/visitsListFrameDocId[\s\S]{0,900}__visitGuardByTab\.get\(Number\(tabId\)\)/.test(s));
  r.push(/visitsListFrameDocId[\s\S]{0,1400}settleVisitOp\(chrome\.webNavigation\.getAllFrames/.test(s));
  const epochAt = s.indexOf('var listDocId = await visitsListFrameDocId(emrId, listFrame);');
  const rowLoopAt = s.indexOf('for (var i = 0; i < total; i++) {');
  const refusalAt = s.indexOf('No encounter body was read.');
  r.push(epochAt > 0 && rowLoopAt > 0 && refusalAt > 0 && refusalAt < epochAt && epochAt < rowLoopAt);
  r.push(s.indexOf('var surfaceResets = 0, surfaceResetOps = [];') > 0);
  const coldAt = s.indexOf('retryCount++; coldTries++;');
  const probeAt = s.indexOf('var srrDocNow = await visitsListFrameDocId(emrId, listFrame);');
  r.push(coldAt > 0 && probeAt > coldAt && probeAt - coldAt < 2400);
  r.push(/surfaceResets < 3 && Date\.now\(\) \+ 5000 < readDeadline/.test(s));
  r.push(/srrDocNow && listDocId && srrDocNow !== listDocId/.test(s));
  r.push(/srrGate = visitIdentityGate\(frozenHint, srrIdentity\)/.test(s));
  r.push(/identity-changed-after-surface-recycle/.test(s));
  r.push(/row-set-changed-after-surface-recycle/.test(s));
  r.push(/\['enumerate', enumCfg\]\);[\s\S]{0,600}srrRows\.length === total/.test(s));
  r.push(/srrNb\.rowKey === srrOldKey/.test(s));
  r.push(/listDocId = srrDocNow;/.test(s));
  r.push(/retryCount: retryCount, surfaceResets: surfaceResets, surfaceResetOps: surfaceResetOps\.slice\(0, 6\),/.test(s));
  const fnAt = s.indexOf('function mlsEnsureClinicalChartFn(');
  const shadowAt = s.indexOf('only the COLLECTION now descends open shadow roots');
  r.push(fnAt > 0 && shadowAt > fnAt && shadowAt - fnAt < 4000);
  r.push(/var sr = hosts\[hi\]\.shadowRoot;[\s\S]{0,700}sr2\.querySelectorAll\(sel\)/.test(s));
  r.push(/walked < 60/.test(s));
  return r;
}

/* ---- arm 1: shipped source passes every pin ---- */
const live = srrAssert(SRC);
live.forEach(function (v, i) { ok(v, 'live pin #' + (i + 1)); });

/* ---- arm 2: the safety envelope of the escape clicker is untouched ---- */
ok(/var BAD = \/save\|sign\|order\|delete\|discard\|remove\|void\|submit\|bill\|charge\|check\\s\*-\?\\s\*\(in\|out\)\|prescri\|refill\|dispense\|cancel\|log\\s\*out\|apptmnt\|reschedul\/i;/.test(SRC),
  'BAD-verb filter byte-identical');
ok(/function vis\(el\) \{ try \{ var r = el\.getBoundingClientRect\(\);/.test(SRC), 'visibility test intact');
const fnStart = SRC.indexOf('function mlsEnsureClinicalChartFn(');
const fnSlice = SRC.slice(fnStart, fnStart + 5200);
ok(fnSlice.indexOf('acc.slice(0, 900)') > 0, 'shadow collection keeps the 900 cap');

/* ---- arm 3: CONTROL - the pre-fix shape must FAIL these pins ---- */
let reverted = SRC;
const stripA = reverted.indexOf('async function visitsListFrameDocId');
const stripAEnd = reverted.indexOf('async function waitForEncounterDetailFrames');
ok(stripA > 0 && stripAEnd > stripA, 'control can locate helper block');
reverted = reverted.slice(0, reverted.lastIndexOf('  ', stripA)) + reverted.slice(stripAEnd);
reverted = reverted.split('var listDocId = await visitsListFrameDocId(emrId, listFrame);').join('');
reverted = reverted.split('var surfaceResets = 0, surfaceResetOps = [];').join('');
const stripC = reverted.indexOf('var srrDocNow = await visitsListFrameDocId(emrId, listFrame);');
ok(stripC > 0, 'control can locate recycle branch');
const stripCFrom = reverted.lastIndexOf('if (surfaceResets < 3', stripC);
const stripCTo = reverted.indexOf('listDocId = srrDocNow;', stripC);
ok(stripCFrom > 0 && stripCTo > stripCFrom, 'control recycle bounds found');
reverted = reverted.slice(0, stripCFrom) + reverted.slice(reverted.indexOf('\n', stripCTo) + 1);
reverted = reverted.split(' surfaceResets: surfaceResets, surfaceResetOps: surfaceResetOps.slice(0, 6),').join('');
const ctl = srrAssert(reverted);
ok(ctl.some(function (v) { return v === false; }), 'CONTROL: pre-fix source fails the pin set (the gate bites)');
ok(ctl.filter(function (v) { return !v; }).length >= 8, 'CONTROL: at least 8 pins fail on pre-fix source');

/* ---- arm 4: functional - the rowKey re-bind acceptance logic, extracted and run ---- */
const vm = require('vm');
const m = SRC.match(/var srrKeyOk = false;[\s\S]*?if \(!srrKeyOk\)/);
ok(!!m, 'functional: srrKeyOk block extractable');
const body = 'var srrKeyOk = ' + m[0].replace(/^var srrKeyOk = false;/, 'false;').replace(/if \(!srrKeyOk\)$/, '') + ';srrKeyOk;';
function runKeyMatch(rows, srrRows, total) {
  const ctx = { rows: rows, srrRows: srrRows, total: total };
  vm.createContext(ctx);
  return vm.runInContext(body, ctx);
}
const mk = function (k) { return { binding: { rowKey: k } }; };
ok(runKeyMatch([mk('enc:1'), mk('row:abc')], [mk('row:abc'), mk('enc:1')], 2) === true,
  'functional: same keys reordered -> re-bind accepted');
ok(runKeyMatch([mk('enc:1'), mk('row:abc')], [mk('enc:1'), mk('row:zzz')], 2) === false,
  'functional: one key changed -> re-bind refused');
ok(runKeyMatch([mk('enc:1')], [mk('enc:1'), mk('enc:2')], 1) === false,
  'functional: row count grew -> re-bind refused (srrRows.length !== total)');
ok(runKeyMatch([{ binding: null }], [mk('enc:1')], 1) === false,
  'functional: missing old binding -> refused, never guessed');

/* ---- srr-1.2 (3.0.51) pins: chartSurface, identity re-poll, empty-frame re-expand,
 *      and the si-side persistence (sr/surface/runId on state rows + day-end naming) ---- */
ok(/var chartSurface = '';/.test(SRC) && /clincmp-ax/.test(SRC), '1.2: chartSurface derived');
ok(/surfaceResetOps\.slice\(0, 6\), chartSurface: chartSurface,/.test(SRC), '1.2: receipt carries chartSurface');
ok(/srrIdDeadline = Math\.min\(readDeadline, Date\.now\(\) \+ 5200\)/.test(SRC), '1.2: identity re-poll bounded 5.2s');
ok(/srrGate\.ok\) break;[\s\S]{0,120}sleepWithinReadDeadline\(800\)/.test(SRC), '1.2: re-poll loops on 800ms, exits on gate.ok');
ok(/identity-changed-after-surface-recycle/.test(SRC), '1.2: fail-closed verdict retained after patience');
ok(/__srrReExpanded = \{\};/.test(SRC), '1.2: re-expand seen-set declared');
const rxAt = SRC.indexOf('__srrReExpanded[String(ecCand.frameId)] = 1;');
const dropAt = SRC.indexOf("if (ecNoise && !(ecGate && ecGate.ok)) ecDrop = 'noise-surface';");
ok(rxAt > 0 && dropAt > rxAt, '1.2: re-expand runs BEFORE the noise drop');
ok(/ecCand\.result\.ok === true && Number\(ecCand\.result\.count \|\| 0\) === 0/.test(SRC), '1.2: re-expand gated to OK-but-EMPTY frames only');
ok(/rxIdentity\) \{ ecIdCache\[ecCand\.frameId\] = rxIds; ecIdentity = rxIdentity; ecGate = visitIdentityGate\(frozenHint, rxIdentity\); \}/.test(SRC), '1.2: re-expand re-gates through the SAME identity gate');
const SI = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'latin1');
ok(/surfaceResets: Number\(\(r\.receipt&&r\.receipt\.surfaceResets\)\|\|0\), chartSurface: String\(\(r\.receipt&&r\.receipt\.chartSurface\)\|\|""\)/.test(SI), '1.2 si: saveVerifiedVisits carries both');
ok(/one\.surfaceResets=Number\(savedVisits\.surfaceResets\|\|0\); one\.chartSurface=String\(savedVisits\.chartSurface\|\|""\);/.test(SI), '1.2 si: one absorbs both');
ok(/s\.runId='r'\+Date\.now\(\)\.toString\(36\);/.test(SI), '1.2 si: ppStart stamps runId');
ok(/runId:String\(s\.runId\|\|''\)/.test(SI), '1.2 si: settled rows carry runId');
ok(/r\.sr=Number\(extra\.surfaceResets\|\|0\); r\.surface=String\(extra\.chartSurface\|\|''\);/.test(SI), '1.2 si: rows carry sr+surface');
ok(/Charts needing retry: /.test(SI), '1.2 si: day-end names the failing set');
ok(/\{ surfaceResets: one\.surfaceResets, chartSurface: one\.chartSurface \}/.test(SI), '1.2 si: settle call passes extras');

console.log('surface-recycle-rebind: PASS (' + checks + ' checks)');
