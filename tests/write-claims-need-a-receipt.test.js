'use strict';

/*
 * NO SUCCESS CLAIM WITHOUT A PER-DESTINATION RECEIPT (wrt-1.0.0)
 *
 * The canonical defect class in this repository is a save path that reports the
 * SHAPE of success while every destination refused: `handOff()` toasting "note
 * sent to Athena" over SEVEN silent refusals. Worker B's 2026-07-26 sweep found
 * six live instances of it on the clinical write path and fixed none of them,
 * because the write lane was outside its brief. This suite pins the fix.
 *
 * THE SUPPLY-SIDE ROOT, and why every surface downstream was doomed:
 *
 *   background.js `overlayPasteNote` only ever set `.error` for ENVIRONMENTAL
 *   failures (no tab, no scanner, empty note). When the paste ITSELF failed --
 *   no matching field in the encounter, or typed text that athenaOne never
 *   echoed back -- it returned `{sections:[...]}` with every entry
 *   `written:false, confirmed:false` and NO `.error` at all. `doWriteBack`
 *   never inspected the sections. So the reply a caller received over a write
 *   that provably did not happen was byte-for-byte the success shape.
 *
 *   Every consumer then did the only thing it could with that: believe it.
 *     - mls-popup.js reached `narrate('Draft written (unsigned)')` +
 *       `setState('written')` UNCONDITIONALLY after the per-section loop, and
 *       summarised by listing EVERY section - `w.sections.map(x => x.section)` -
 *       with no filter on `confirmed`. A run that found no field at all ended on
 *       a green "OK Draft written" screen naming destinations it never wrote to.
 *     - the same file rendered a TWO-state UI over a THREE-state receipt, so a
 *       destination that was never written read as "Wrote to X but couldn't
 *       confirm": a POSITIVE claim about a write that did not occur.
 *     - feat_mls_status_center.js derived its verdict from `!resp.error` alone,
 *       which paints the wrong-patient sign refusal
 *       `{blocked:true, signed:false, message:'Patient gate failed (name+DOB)'}`
 *       -- a hard clinical refusal that carries no `.error` -- bright green.
 *
 * THE RULE THIS SUITE ENFORCES: a green verdict must trace to a receipt field
 * that names a CONFIRMED destination. Absence of an error is not evidence.
 *
 * Arms 1 and 4 drive the REAL shipped mls-popup.js core through its own
 * injectable transport rather than modelling it; arms 2 and 3 lift the real
 * helpers out of the shipped files with `vm`. Per the b669 rule each arm was
 * proven to FAIL on the real regression (the pre-fix expression restored) and
 * to PASS on the real tree.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'latin1');
const sc = fs.readFileSync(path.join(ROOT, 'feat_mls_status_center.js'), 'utf8');
const sv = fs.readFileSync(path.join(ROOT, 'feat_save_verify.js'), 'utf8');
const mc = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'utf8');

function lift(source, startNeedle, endNeedle, label) {
  const a = source.indexOf(startNeedle);
  assert(a > 0, label + ': could not find ' + startNeedle);
  const b = source.indexOf(endNeedle, a);
  assert(b > a, label + ': could not find the end of the function');
  return source.slice(a, b + endNeedle.length);
}

/* ================================================================== *
 * 1. THE ROOT — background.js counts the receipt, once.
 * ================================================================== */

const tallySrc = lift(bg, 'function mlsWriteTally(sections) {', '\n  }', 'mlsWriteTally');
const verdictSrc = lift(bg, 'function mlsPasteVerdict(sections) {', '\n  }', 'mlsPasteVerdict');
const tallyCtx = { module: { exports: {} } };
vm.createContext(tallyCtx);
vm.runInContext(tallySrc + '\n' + verdictSrc + '\nmodule.exports = { mlsWriteTally: mlsWriteTally, mlsPasteVerdict: mlsPasteVerdict };', tallyCtx);
const { mlsWriteTally, mlsPasteVerdict } = tallyCtx.module.exports;

/* the exact shape overlayPasteNote produces when NOTHING was found */
const allRefused = [
  { section: 'progress', confirmed: false, written: false, notfound: true },
  { section: 'assessment', confirmed: false, written: false, notfound: true }
];
let t = mlsWriteTally(allRefused);
assert.strictEqual(t.confirmedCount, 0,
  'a run where athenaOne matched no field must count ZERO confirmed destinations');
assert.strictEqual(t.writtenCount, 0, 'and zero written');
assert.deepStrictEqual(Array.from(t.failedSections), ['progress', 'assessment'],
  'the tally must NAME the destinations that refused -- an unnamed failure sends the doctor nowhere, which is this repo\'s "the instruction points nowhere" defect class');
assert.strictEqual(mlsPasteVerdict(allRefused).ok, false,
  'mlsPasteVerdict must report ok:false over an all-refused paste: this is the exact value that used to be an absent field, i.e. the success shape');

/* typed-but-unconfirmed is its OWN state and must never be counted as success */
t = mlsWriteTally([{ section: 'progress', confirmed: false, written: true, notfound: false }]);
assert.strictEqual(t.confirmedCount, 0,
  'text typed into a field that athenaOne never echoed back is NOT a confirmed write');
assert.strictEqual(t.writtenCount, 1, 'but it IS distinct from never having written at all');
assert.deepStrictEqual(Array.from(t.unconfirmedSections), ['progress']);

t = mlsWriteTally([
  { section: 'progress', confirmed: true, written: true },
  { section: 'assessment', confirmed: false, written: false, notfound: true }
]);
assert.strictEqual(t.confirmedCount, 1, 'a partial run confirms what it confirmed');
assert.deepStrictEqual(Array.from(t.failedSections), ['assessment'], 'and still names what it did not');

/* --- and doWriteBack must REFUSE to return the success shape over it. ------ */
const wbStart = bg.indexOf('  function doWriteBack(tabId, msg) {');
assert(wbStart > 0, 'doWriteBack could not be found');
const wb = bg.slice(wbStart, bg.indexOf('\n  }', wbStart));

assert(/if \(tally\.confirmedCount === 0\) \{/.test(wb),
  'doWriteBack must gate on the tally. Without this line a paste in which every section refused returns {note:{sections:[...]}} with no error -- the success shape -- which is the supply-side root of all six defects');
assert(/error: 'nothing-confirmed'/.test(wb) && /ok: false/.test(wb),
  'the zero-confirmed reply must carry BOTH ok:false and an explicit error code: consumers in this codebase branch on each of them separately, and a reply that satisfies only one of them still reads as success somewhere');
assert(/notfound: !!resp\.notfound/.test(wb),
  'the single-section FALLBACK object must carry the same keys as a real section. It used to omit `written` entirely, so `!!s.written` was undefined-false on a write that may have happened');
assert(/blocked: true/.test(wb) && /error: 'patient-gate-failed'/.test(wb),
  'the wrong-patient refusal must carry an error code. A bare {blocked:true} carries no `.error`, and every `!resp.error` consumer downstream therefore rendered a hard clinical refusal as success');
assert(/message: 'Patient gate failed \(name \+ DOB\)[^']*Nothing was written/.test(wb),
  'and it must carry a MESSAGE that names the gate and states that nothing was written. Surfaces render `resp.message`; a refusal with an error code but no sentence reaches the doctor as a blank failure, which this repo files under "the instruction points nowhere"');

/* the one thing that must NOT have changed: the write mechanics themselves. */
assert(/ext\.pasteNote\(\{ note: msg\.note \}\)/.test(wb),
  'the verified paste itself must be untouched -- this lane changes what is REPORTED, never how the write is performed');
assert(!/signSave|Sign & Save/.test(wb),
  'doWriteBack must still never sign');

/* ================================================================== *
 * 2. THE STATUS CENTRE — a verdict from an allowlist, never from
 *    the absence of an error key.
 * ================================================================== */

const wvSrc = lift(sc, '  function writeVerdict(resp, isSign) {', '\n  }', 'writeVerdict');
const wvCtx = { module: { exports: {} } };
vm.createContext(wvCtx);
vm.runInContext(wvSrc + '\nmodule.exports = writeVerdict;', wvCtx);
const writeVerdict = wvCtx.module.exports;

/* THE headline case. This exact object is what background.js returns when the
   name+DOB gate fails on a sign request. It has no `.error`, so `!resp.error`
   rendered it green: "Write-back reported success (verify in athenaOne)" over a
   refusal to touch the chart because it might be the WRONG PATIENT. */
const wrongPatient = { blocked: true, signed: false, message: 'Patient gate failed (name + DOB) - refusing to sign this chart.' };
assert.strictEqual(writeVerdict(wrongPatient, true).level, 'fail',
  'a wrong-patient refusal must NEVER render as success -- it carries no `.error`, which is precisely why the old `!resp.error` test inverted it');
assert(/refused/i.test(writeVerdict(wrongPatient, true).text),
  'and it must say it was refused, not merely that something is unclear');

assert.strictEqual(writeVerdict({ ok: false, blocked: true, reason: 'legacy-untyped-write-disabled', error: 'disabled' }).level, 'fail',
  'the retired mixed-writer refusal stays a failure');
assert.strictEqual(writeVerdict({ ok: true, signed: false, reason: 'unconfirmed', msg: 'Clicked Sign & Save but could not confirm' }, true).level, 'warn',
  'ok:true with signed:false is NOT a signed chart: athenaOne clicking is not athenaOne confirming, and the old test read the missing error key as success');
assert.strictEqual(writeVerdict({ ok: true, signed: true, reason: 'confirmed' }, true).level, 'ok',
  'a confirmed signature is the one green sign verdict');

assert.strictEqual(writeVerdict({ ok: false, error: 'nothing-confirmed', note: { confirmedCount: 0, sections: [{ section: 'progress' }] } }).level, 'fail',
  'the new root refusal must reach this surface as a failure');
assert.strictEqual(writeVerdict({ ok: true, note: { confirmedCount: 2, sectionCount: 2 } }).level, 'ok',
  'a receipt naming confirmed destinations is the ONLY green write verdict');
assert(/2 destinations/.test(writeVerdict({ ok: true, note: { confirmedCount: 2, sectionCount: 2 } }).text),
  'and it must state the count it is claiming, so the claim is checkable against athenaOne');
assert.strictEqual(writeVerdict({ ok: true, note: { confirmedCount: 0, sections: [] } }).level, 'fail',
  'ok:true with a receipt that confirms nothing is a failure -- the receipt outranks the flag');

/* the DEFAULT. Everything above is an allowlist; what matters most is what an
   unrecognised reply does. */
assert.notStrictEqual(writeVerdict({}).level, 'ok',
  'an empty reply must never be success');
assert.notStrictEqual(writeVerdict(null).level, 'ok',
  'and neither must a missing one');
assert.notStrictEqual(writeVerdict({ ok: true }).level, 'ok',
  'a bare ok:true with NO destination receipt is exactly the shape the old code trusted; the default must not be success');
/* Bound to the CODE, not to the file. TWO earlier versions of this arm failed
   on the FIXED tree: one searched feat_mls_status_center.js for "reported
   success", the next for `var okW = resp && !resp.error` -- and the comment
   explaining each removal quotes the thing it removed. That is the b669
   circularity in mirror image: a haystack containing the record of a change
   cannot decide whether the change happened. Comments are stripped first. */
const scCode = sc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert(!/var okW = resp && !resp\.error/.test(scCode),
  'the `!resp.error` derivation must be gone from the write row: it is the expression that painted a wrong-patient refusal green');
assert(!/srcSet\('emr'[^;]*reported success/.test(sc),
  'and no write row may still SET a "reported success" verdict');

/* ================================================================== *
 * 3. THE FAIL-OPEN DEFAULT on a receipt field.
 * ================================================================== */

const okLine = sv.slice(sv.indexOf('      var ok = (d.ok != null)'), sv.indexOf('\n', sv.indexOf('      var ok = (d.ok != null)')));
assert(okLine.length > 0, 'the pull-result ok derivation could not be found');
assert(!/: true\)/.test(okLine),
  'a message carrying neither `ok` nor `result.ok` must not default to SUCCESS. That is a fail-open default on a receipt field, and it is how a silent pull failure reaches the doctor as a completed pull');
assert(/arr\(visits\)\.length > 0/.test(okLine),
  'with no receipt field present, the only evidence the message carries is whether it actually delivered visits -- that is what must decide it');

/* ================================================================== *
 * 4. THE POPUP — the real shipped core, driven through its own
 *    injectable transport.
 * ================================================================== */

const popup = require(path.join(ROOT, 'mls-popup.js'));
assert(typeof popup.createCore === 'function', 'mls-popup.js must still export its testable core');

function drive(reply) {
  const core = popup.createCore({
    transport: { send: function () { return Promise.resolve(reply); }, onMessage: function () { return function () {}; } },
    onRender: function () {}
  });
  core.st.note = { soap: 'a note' };
  return core.writeBack(false).then(function () { return core; });
}
function lines(core) { return core.st.narration.map(function (x) { return x.text; }).join(' | '); }

const cases = [];

/* 4a. THE DEFECT ITSELF: every destination refused. */
cases.push(drive({
  ok: false, error: 'nothing-confirmed',
  message: 'Nothing was written. MLS could not confirm a single destination in athenaOne (progress).',
  note: { sections: [{ section: 'progress', confirmed: false, written: false, notfound: true }], confirmedCount: 0, sectionCount: 1 }
}).then(function (core) {
  assert.notStrictEqual(core.st.state, 'written',
    'a run that confirmed NOTHING must not reach the "written" state -- that state renders the headline "OK Draft written" and used to be entered unconditionally after the section loop');
  assert.strictEqual(core.st.written, null,
    'and it must leave no `written` summary behind for the terminal screen to render');
  assert(/Nothing written to progress/.test(lines(core)),
    'the doctor must be told which destination got nothing');
  assert(/no matching field was found/.test(lines(core)),
    'and WHY -- "couldn\'t confirm" was a positive claim about a write that never happened');
  assert(!/Draft written/.test(lines(core)),
    'the words "Draft written" must not appear anywhere in a run that wrote nothing');
}));

/* 4b. the three-state render: never-written and typed-but-unconfirmed are
   different sentences. Before the fix they were the same one. */
cases.push(drive({
  ok: true, partial: true,
  note: {
    sections: [
      { section: 'progress', confirmed: true, written: true },
      { section: 'assessment', confirmed: false, written: true },
      { section: 'plan', confirmed: false, written: false, notfound: true }
    ],
    confirmedCount: 1, sectionCount: 3
  }
}).then(function (core) {
  const l = lines(core);
  assert(/athenaOne confirmed it/.test(l), 'a confirmed destination says so');
  assert(/Typed into assessment but athenaOne did not confirm/.test(l),
    'typed-but-unconfirmed is its own sentence');
  assert(/Nothing written to plan/.test(l),
    'and never-written is a THIRD sentence, not the second one -- rendering two states over three receipts is how a non-write became a claimed write');
  assert.strictEqual(core.st.state, 'written', 'one confirmed destination is a real, partial write');
  assert.strictEqual(core.st.written.partial, true,
    'and the state must record that it was partial, so the headline can stop saying "Draft written"');
}));

/* 4c. the summary line must not launder unwritten destinations. */
cases.push(drive({
  ok: true, partial: true,
  note: {
    sections: [
      { section: 'progress', confirmed: true, written: true },
      { section: 'plan', confirmed: false, written: false, notfound: true }
    ],
    confirmedCount: 1, sectionCount: 2
  }
}).then(function (core) {
  /* Run the REAL summaryLine, lifted out of the shipped file. A source-shaped
     arm was not enough here: a mutation that restored the unfiltered
     `w.sections.map(x => x.section)` clause still left the words "NOT written"
     and `x.confirmed` elsewhere in the function, so the arm passed on the
     regression it exists to catch. Behaviour, not vocabulary. */
  const src = fs.readFileSync(path.join(ROOT, 'mls-popup.js'), 'utf8');
  const sumSrc = lift(src, '  function summaryLine(s) {', '\n  }', 'summaryLine');
  const sumCtx = { module: { exports: {} } };
  vm.createContext(sumCtx);
  vm.runInContext(sumSrc + '\nmodule.exports = summaryLine;', sumCtx);
  const summaryLine = sumCtx.module.exports;

  const partial = summaryLine({ written: { sections: [{ section: 'progress', confirmed: true }, { section: 'plan', confirmed: false }] } });
  assert(/NOT written: plan/.test(partial),
    'the terminal summary must NAME the destination that got nothing');
  assert(!/plan/.test(partial.split(' · ')[0]),
    'and must not also list it in the positive clause. The old line mapped EVERY section to its name with no filter on `confirmed`, so a destination that was never written appeared under a green "Draft written" headline as somewhere the note had gone');

  const nothing = summaryLine({ written: { sections: [{ section: 'plan', confirmed: false }] } });
  assert(/^NOT written: plan/.test(nothing),
    'and when nothing was confirmed the summary must LEAD with that');
  assert.strictEqual(summaryLine({ written: {} }), 'Nothing was confirmed in athenaOne.',
    'the empty fallback must not be a success sentence -- it used to be "Draft written (unsigned)."');
}));

/* 4d. the patient gate still wins, first, before anything is enumerated. */
cases.push(drive({
  ok: false, blocked: true, error: 'patient-gate-failed', signed: false,
  message: 'Patient gate failed (name + DOB) - refusing to write to this chart. Nothing was written.',
  mlsIdentity: { name: 'A' }, chartIdentity: { name: 'B' }
}).then(function (core) {
  assert.strictEqual(core.st.state, 'review', 'a blocked write returns to review, never to written');
  assert(core.st.mismatch, 'and it must surface the mismatch panel');
  assert(/different patient/.test(lines(core)), 'and say so plainly');
}));

/* 4e. a clean, fully confirmed write still works. This is the arm that proves
   the suite is not simply asserting failure everywhere. */
cases.push(drive({
  ok: true, partial: false,
  note: { sections: [{ section: 'progress', confirmed: true, written: true }], confirmedCount: 1, sectionCount: 1 }
}).then(function (core) {
  assert.strictEqual(core.st.state, 'written', 'a confirmed write reaches the written state');
  assert.strictEqual(core.st.written.partial, false, 'and is not marked partial');
  assert(/Draft written \(unsigned\)/.test(lines(core)),
    'and still ends on the honest "MLS did NOT click Save or Sign" line');
}));

/* ================================================================== *
 * 5. handOff() — the helper the whole defect class is named after.
 * ================================================================== */

assert.strictEqual((mc.match(/function handOff\(fn, msg\) \{ try \{ fn\(\); \} catch \(e\) \{\} if \(msg\) toast\(msg\); \}/g) || []).length, 0,
  'no copy of handOff may still swallow a thrown handler and toast the success message anyway -- that is the literal shape of the "note sent to Athena over seven silent refusals" defect');
assert.strictEqual((mc.match(/__ok \? msg :/g) || []).length, 5,
  'all five copies must report the throw');

assert.strictEqual((mc.match(/'Chart context pulled \(read-only\) for '/g) || []).length, 0,
  'calPullChartFor() is fired and never awaited, so a PAST-TENSE toast is false at the moment it is shown');
assert.strictEqual((mc.match(/'Pulling chart context \(read-only\) for '/g) || []).length, 5,
  'all five copies must claim only what is true when the toast appears');
assert.strictEqual((mc.match(/'Chart opened \(read-only\) for '/g) || []).length, 0,
  'same for the chart-open claim');
assert.strictEqual((mc.match(/'Opening the chart \(read-only\) for '/g) || []).length, 5);

/* ================================================================== *
 * 6. THE TWO STRINGS THAT NAME ACTIONS THAT DO NOT HAPPEN (B §5).
 * ================================================================== */

/* There is no chrome.tabs.reload and no location.reload anywhere in
   background.js -- deliberately: mlsRecoverAthenaTab's own header explains that
   automatic reloads invalidated Athena's CSRF state and could discard unsaved
   chart work. The RATIONALE is sound; the strings describing it were not. */
assert(!/chrome\.tabs\.reload|location\.reload/.test(bg),
  'automatic reloads must stay disabled -- if this ever becomes false the strings below need re-deciding, not silently re-enabling');
assert(!/freeze-guard reload/.test(bg),
  'the clinician must not be shown "(freeze-guard reload)" for a recovery that performs no reload: this repo has a documented defect class of instructions pointing at things that do not exist');
assert(!/reloading it and retrying/.test(bg),
  'and must not be told athenaOne is being reloaded when the tab is left untouched');
assert(/your tab is left untouched/.test(bg),
  'the replacement must say what actually happens to the doctor\'s tab');

/* The keep-alive marker is deliberately inert; the wrapper claimed otherwise. */
assert(/window\.__mlsKeepAlive = \{ armed: false, disabled: 'athena-session-policy'/.test(bg),
  'the page-side keep-alive must remain the documented NO-OP -- MLS does not defeat athenaOne\'s inactivity policy');
const armFn = bg.slice(bg.indexOf('async function mlsArmKeepAlive'), bg.indexOf('/* ===================== end v1.59 helpers'));
assert(!/return \{ armed: true \}/.test(armFn) && !/armed: true, deduped/.test(armFn),
  'mlsArmKeepAlive must not report armed:true after installing an inert marker. Four callers read that value, and the comment built on it claimed a "55s Worker keep-alive" holds the session open -- NOTHING in this extension prevents an inactivity logout, which is exactly why the sfp-1.0.0 staleness receipt had to be built');
assert(/AUTOMATIC KEEP-ALIVE IS DISABLED BY POLICY/.test(bg),
  'and the pin comment must say so where the next reader will look');

Promise.all(cases).then(function () {
  console.log('write-claims-need-a-receipt: OK');
}, function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
