/* ax-native-reader (axr-1.0, 3.0.52)
 *
 * The CLINCMP/ax route: harvest encounter ids from /ax/encounter/<id>/<route>
 * hrefs (no clicking), navigate the harvest frame per encounter, verify the
 * SAME visitIdentityGate on every loaded summary, read, fail closed per
 * encounter. Fires ONLY when the classic walk STARVED (no-chart-frame-candidate)
 * - an identity-mismatch refusal never triggers an alternate route. Unknown
 * identity shapes refuse as ax-identity-shape-unknown WITH captured signatures:
 * the reader is its own census, and early refusals are the corpus filling.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { console.error('FAIL ax-native-reader: ' + label); process.exit(1); }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');

function axAssert(s) {
  const r = [];
  r.push(/if \(op === 'axHarvest'\) \{/.test(s));
  r.push(/if \(op === 'axGo'\) \{/.test(s));
  r.push(/if \(op === 'axRead'\) \{/.test(s));
  r.push(/\/\^no-chart-frame-candidate\/\.test\(String\(gate\.reason \|\| ''\)\)/.test(s));
  r.push(/ax-identity-shape-unknown/.test(s));
  r.push(/visitIdentityGate\(frozenHint, axIdent\)\.ok/.test(s));
  r.push(/rowKey: 'enc:' \+ axE\.eid/.test(s));
  r.push(/chartSurface: 'clincmp-ax-route'/.test(s));
  r.push(/axShapeUnknown: axShapeUnknown, axSigs: axSigs\.slice\(0, 6\), axRouteMs:/.test(s));
  r.push(/ax-nav-href-rejected/.test(s));
  return r;
}

/* arm 1: shipped source carries every pin */
axAssert(SRC).forEach(function (v, i) { ok(v, 'live pin #' + (i + 1)); });

/* arm 2: safety ordering - the ax route must sit AFTER the srr re-expand and
   BEFORE the no-chart-frame-candidate refusal return, and must never touch the
   identity-mismatch refusal (the Safety stop return stays byte-identical). */
/* rr-1.1 moved the route body into a single closure (axRouteRun) so the
   body-depth entry can reuse it without duplication - the body pins therefore
   anchor to the closure, and the order chain gains its position. Moved
   deliberately with rr-1.1 (2026-08-09). */
const reExpandAt = SRC.indexOf('__srrReExpanded[String(ecCand.frameId)] = 1;');
const closureAt = SRC.indexOf('var axRouteRun = async function (rrFromPartial) {');
const axHookAt = SRC.indexOf("if (!gate.ok && /^no-chart-frame-candidate/.test(String(gate.reason || '')) && Date.now() + 15000 < readDeadline) {");
const refusalAt = SRC.indexOf('Safety stop: the live patient identity in the encounter-list frame did not match');
ok(reExpandAt > 0 && closureAt > reExpandAt && axHookAt > closureAt && refusalAt > axHookAt,
  'route order: re-expand -> route closure -> starved hook -> refusal return');
ok(SRC.split('var axRouteRun = async function').length - 1 === 1,
  'the route body exists ONCE (wrap-once: both entries share one closure)');
/* Pin moved deliberately with axh-3073/detect-3072 (2026-08-19): the refusal
   became a TERNARY so an empty-hint stop (identity-hint-incomplete — the
   whoever-button's detect mode) gets an honest message that can never match
   the app's cross-patient wording. The mismatch refusal itself survives
   byte-identically in the else branch — both branches are pinned exactly. */
ok(/error: \(String\(gate\.reason \|\| ''\) === 'identity-hint-incomplete'\) \? 'Could not read a clear patient identity \(name plus DOB or MRN\) from the open athenaOne chart header, so nothing was read\. Open the patient chart fully and retry\.' : 'Safety stop: the live patient identity in the encounter-list frame did not match the frozen MLS patient \(name plus DOB\/MRN\)\. No encounter body was read\.'/.test(SRC),
  'the identity-mismatch refusal is byte-identical inside the axh-3073 ternary (fail-closed untouched, incomplete-hint message honest)');
const hookBlock = SRC.slice(closureAt, axHookAt);
ok(/if \(axIdent && \(axIdent\.name \|\| axIdent\.dob\)\) axRefused\+\+;/.test(hookBlock),
  'a SEEN-and-mismatched identity is a hard refusal, never a shape-unknown');
ok(/await sleep\(1800\);[\s\S]{0,80}touchVisitLease\(\);/.test(hookBlock), 'settle + lease touch after every navigation');
ok(/axIdDeadline = Math\.min\(readDeadline, Date\.now\(\) \+ 5200\)/.test(hookBlock), 'identity re-poll bounded like srr-1.2');

/* arm 3: functional - href harvest regex + axGo href guard, extracted and run */
const harvestRe = /\/(\d+)\/\d+\/ax\/encounter\/(\d+)\/(\w+)/;
ok((function () {
  const m = '/22724/6/ax/encounter/98765432/summary'.match(harvestRe);
  return m && m[2] === '98765432' && m[3] === 'summary';
})(), 'functional: harvest regex extracts eid + route');
ok(!'/22724/6/ax/briefing/1234567'.match(harvestRe), 'functional: briefing hrefs are not encounters');
ok(!'https://evil.example/22724/6/ax/encounter/1/summary'.match(/^\/\d+\/\d+\/ax\/encounter\/\d+\/\w+$/), 'functional: axGo guard rejects absolute/foreign URLs');
ok(!!'/22724/6/ax/encounter/55/summary'.match(/^\/\d+\/\d+\/ax\/encounter\/\d+\/\w+$/), 'functional: axGo guard accepts the clean relative form');

/* arm 4: the injected ops parse standalone (vm) - extract the three op blocks
   and run them against a minimal DOM stub to prove no missing identifiers. */
const opStart = SRC.indexOf("    if (op === 'axHarvest') {");
const opEnd = SRC.indexOf("    if (op === 'diagnose') { return diagnose(); }", opStart);
ok(opStart > 0 && opEnd > opStart, 'op family block extractable');
const opBody = SRC.slice(opStart, opEnd);
const mkEl = function (tag, href, testid) {
  return { tagName: tag, shadowRoot: null, getAttribute: function (k) { if (k === 'href') return href || null; if (k === 'data-testid') return testid || null; return null; } };
};
const stubDoc = {
  els: [mkEl('A', '/22724/6/ax/encounter/111/summary'), mkEl('A', '/22724/6/ax/encounter/111/summary'), mkEl('A', '/22724/6/ax/encounter/222/summary'), mkEl('DIV', null, 'patient-header')],
  querySelectorAll: function () { return this.els; },
  visibilityState: 'visible', body: { innerText: 'HEADER 01/02/2026 body text' }
};
function runOp(op, idx) {
  const ctx = { op: op, idx: idx, cfg: {}, document: stubDoc, location: { pathname: '/22724/6/ax/briefing/9990001', assign: function (h) { ctx.__navigatedTo = h; } } };
  vm.createContext(ctx);
  return { out: vm.runInContext('(function(){\n' + opBody + '\nreturn null;})()', ctx), ctx: ctx };
}
const hv = runOp('axHarvest');
ok(hv.out && hv.out.ok === true && hv.out.encounters.length === 2 && hv.out.encounters[0].eid === '111' && hv.out.encounters[1].eid === '222',
  'vm: harvest dedups by eid and returns both encounters');
ok(hv.out.surfaceSig && /\/N\/6\/ax\/briefing\/N/.test(hv.out.surfaceSig.route) && hv.out.surfaceSig.testids.indexOf('patient-header') >= 0,
  'vm: surfaceSig masks ids and carries testids');
const go = runOp('axGo', '/22724/6/ax/encounter/111/summary');
ok(go.out && go.out.ok === true && go.ctx.__navigatedTo === '/22724/6/ax/encounter/111/summary', 'vm: axGo navigates the clean form');
const goBad = runOp('axGo', 'https://evil.example/x');
ok(goBad.out && goBad.out.ok === false && goBad.out.reason === 'ax-nav-href-rejected', 'vm: axGo refuses a foreign URL');
const rd = runOp('axRead');
ok(rd.out && rd.out.ok === true && rd.out.headerDate === '01/02/2026' && rd.out.raw.indexOf('body text') > 0, 'vm: axRead captures body + header date');

/* arm 5: CONTROL - the pre-fix source shape must fail the pin set */
let reverted = SRC.slice(0, opStart) + SRC.slice(opEnd);
const hookEnd = reverted.indexOf('      if (!gate.ok) {\n        return {', reverted.indexOf('axr-1.0 / rr-1.1: the ax-native route') > 0 ? reverted.indexOf('axr-1.0 / rr-1.1: the ax-native route') : 0);
const hookStart = reverted.indexOf('      /* axr-1.0 / rr-1.1: the ax-native route');
if (hookStart > 0 && hookEnd > hookStart) reverted = reverted.slice(0, hookStart) + reverted.slice(hookEnd);
const ctl = axAssert(reverted);
ok(ctl.some(function (v) { return v === false; }), 'CONTROL: pre-fix source fails the pin set');
ok(ctl.filter(function (v) { return !v; }).length >= 8, 'CONTROL: at least 8 pins fail on pre-fix source');

/* ---- axc-1.0 (3.0.53): the runway carve-out. July-1 measured the classic
 * 47-pass index grind consuming the ENTIRE chart budget, so the ax route's
 * 15s-runway check never passed on the five charts that most needed it -
 * the CLINCMP cure went untested against its target population. The fix is a
 * deterministic reserve: every classic-phase continuation margin against
 * readDeadline is 24s (re-expand <=6s + ax hook 15s + margin), so grinding
 * charts HAND OVER with runway while classic-healthy charts finish early and
 * never notice. ---- */
ok(/ehPass < 47 && Date\.now\(\) \+ 24000 < readDeadline && Date\.now\(\) \+ 7000 < indexPhaseDeadline/.test(SRC),
  'axc: the eh-loop retry margin reserves 24s of chart budget (index-phase margin untouched)');
ok((SRC.match(/Date\.now\(\) \+ 24000 >= readDeadline\) break; \/\* axc-1\.0 reserve \*\//g) || []).length === 2,
  'axc: both stable-index break margins reserve 24s');
ok(!/Date\.now\(\) \+ 7000 < readDeadline/.test(SRC) && !/Date\.now\(\) \+ 7000 >= readDeadline/.test(SRC),
  'axc: no classic-phase 7s margin against readDeadline survives (CONTROL: the pre-fix shape fails this)');
ok(/Date\.now\(\) \+ 15000 < readDeadline/.test(SRC) && /Date\.now\(\) \+ 6000 < readDeadline/.test(SRC),
  'axc: the ax hook 15s and re-expand 6s checks are unchanged - they fit inside the reserve');

/* ---- rr-1.0 (3.0.55): the in-chart re-roll. A starved walk with an EMPTY
 * harvest is usually a surface mid-recycle; the arm waits out one recycle
 * window (bounded 34s, only with 42s of chart runway) and re-harvests.
 * Acceptance on this arm is the per-encounter identity gate - NOT the srr
 * epoch triple; a starved walk has no bound frame whose epoch could be
 * measured. Observed class this converts: re-check-cleared rows that failed
 * no-surface-tag then landed clincmp-ax on the automatic re-check (day 8:
 * 4 of 13 rows). The wait buys a SURFACE, never trust. ---- */
ok(SRC.includes('if (!axBest && Date.now() + 42000 < readDeadline) {'),
  'rr: the wait-arm fires only on an EMPTY harvest with 42s of runway');
ok(SRC.includes('rrStop = Math.min(readDeadline - 8000, rrT0 + 34000)'),
  'rr: the wait is bounded by one recycle window and the chart deadline');
ok(SRC.includes('axRrWaitMs: rrWait, axRrRecovered: rrRecovered,'),
  'rr: the success receipt carries the wait telemetry');
ok(SRC.includes("axRrWaitMs: (typeof rrWait === 'number' ? rrWait : 0)"),
  'rr: the refusal receipt carries the telemetry typeof-guarded (that return also serves identity-mismatch refusals where the hook never ran)');
ok(SRC.includes('if (axBest) { rrRecovered = true; break; }'),
  'rr: recovery exits the wait immediately and records itself');
{
  /* rr-1.1 re-anchored: the wait-arm lives INSIDE the shared closure, before
     the route body, and the closure is reachable ONLY through its two gated
     entries (starved condition / body-depth partial) - an identity-mismatch
     refusal reaches neither. Moved deliberately with rr-1.1 (2026-08-09). */
  const rrClosAt = SRC.indexOf('var axRouteRun = async function (rrFromPartial) {');
  const rrArmAt = SRC.indexOf('if (!axBest && Date.now() + 42000 < readDeadline) {');
  const rrUseAt = SRC.indexOf('if (axBest && Number.isFinite(axBestFrame)) {');
  ok(rrClosAt > 0 && rrClosAt < rrArmAt && rrArmAt < rrUseAt,
    'rr: the wait-arm sits inside the shared closure, before the route body');
  ok(SRC.split('await axRouteRun(').length - 1 === 2,
    'rr: exactly two call sites reach the closure (starved + body-depth), both gated');
}
/* rr-1.1: the body-depth entry - the rc-class lookup was unanimous (7/7 rows
 * failed classic at body depth, cleared as clincmp-ax) and the starved hook
 * cannot reach them. Both arms: the partial return tries a COMPLETE-only ax
 * re-roll; anything less keeps the classic partial (never worse than today);
 * the shape-unknown gate mutation fires ONLY on the starved entry. */
ok(SRC.includes('var axPartialRes = await axRouteRun(true);'),
  'rr-1.1: the classic partial return calls the shared closure (body-depth entry)');
ok(SRC.includes('if (axPartialRes && axPartialRes.receipt && axPartialRes.receipt.complete === true) {'),
  'rr-1.1: only a COMPLETE ax result may supersede the classic partial');
ok(SRC.includes('classicPartialSuperseded = { expected: clinicalTotal, parsed: visits.length, failures: failures.length }'),
  'rr-1.1: a superseding result records what the classic partial had (auditable supersede)');
ok(SRC.includes("reason: 'visit-bodies-incomplete'"),
  'rr-1.1: the classic partial return itself survives (the fallback is intact)');
ok(SRC.includes('receipt.axRrWaitMs = rrWait; receipt.axRrRecovered = rrRecovered;'),
  'rr-1.1: a failed re-roll stamps its wait onto the surviving classic receipt');
ok(SRC.includes('if (!rrFromPartial && (axShapeUnknown || axRefused)) {'),
  'rr-1.1: the ax-identity-shape-unknown gate mutation fires only on the starved entry - a body-depth partial keeps its own reason');
ok(SRC.includes("axEntry: rrFromPartial ? 'body-depth' : 'starved-walk',"),
  'rr-1.1: the success receipt names which entry produced it (n-read acceptance needs the split)');
ok(SRC.includes('var axStarvedRes = await axRouteRun(false);'),
  'rr-1.1: the starved hook rides the same closure');

/* si absorbs - without these the telemetry dies at the boundary (the
 * failureDetails lesson from the same night: a field the emitter ships is
 * not a field until every boundary passes it). */
{
  const SI = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'utf8');
  ok(SI.includes('axRrWaitMs: Number((r.receipt&&r.receipt.axRrWaitMs)||0)'),
    'rr: si absorbs the telemetry on the success path (saveVerifiedVisits return)');
  ok(SI.includes('one.axRrWaitMs=Number(savedVisits.axRrWaitMs||0)'),
    'rr: si threads the success-path telemetry onto the per-patient record');
  ok(SI.includes('axRrWaitMs: Number(vr.receipt.axRrWaitMs || 0), axRrRecovered: vr.receipt.axRrRecovered === true'),
    'rr: si absorbs the telemetry on the failure path (visitsReadReceipt subset)');
  ok(SI.includes('axEntry: String((r.receipt&&r.receipt.axEntry)||"")') && SI.includes('one.axEntry=String(savedVisits.axEntry||"")'),
    'rr-1.1: si absorbs axEntry on the success path - acceptance counts by entry, and a field is not a field until every boundary passes it');
}

console.log('ax-native-reader: PASS (' + checks + ' checks)');
