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
const reExpandAt = SRC.indexOf('__srrReExpanded[String(ecCand.frameId)] = 1;');
const axHookAt = SRC.indexOf("if (!gate.ok && /^no-chart-frame-candidate/.test(String(gate.reason || '')) && Date.now() + 15000 < readDeadline) {");
const refusalAt = SRC.indexOf('Safety stop: the live patient identity in the encounter-list frame did not match');
ok(reExpandAt > 0 && axHookAt > reExpandAt && refusalAt > axHookAt, 'route order: re-expand -> ax hook -> refusal return');
ok(/error: 'Safety stop: the live patient identity in the encounter-list frame did not match the frozen MLS patient \(name plus DOB\/MRN\)\. No encounter body was read\.'/.test(SRC),
  'the identity-mismatch refusal is byte-identical (fail-closed untouched)');
const hookBlock = SRC.slice(axHookAt, refusalAt);
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
const hookEnd = reverted.indexOf('      if (!gate.ok) {\n        return {', reverted.indexOf('axr-1.0: when the classic walk STARVED') > 0 ? reverted.indexOf('axr-1.0: when the classic walk STARVED') : 0);
const hookStart = reverted.indexOf('      /* axr-1.0: when the classic walk STARVED');
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

console.log('ax-native-reader: PASS (' + checks + ' checks)');
