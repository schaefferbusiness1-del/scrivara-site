'use strict';

/*
 * The encounter-index gate must be able to open on a chart whose frame is
 * re-rendered between passes.
 *
 * MEASURED on the owner's live signed-in Athena, 2026-07-25, day pull of
 * Fri Jul 24, ext 3.0.18, five patients, every one identical:
 *
 *     encounter-index-incomplete[noise-frames-excluded:1]
 *                               [unchanged-for-16-passes;gave up early]
 *
 * "Unchanged for 16 passes" AND "still refusing" cannot both be true unless the
 * thing counting the sameness is being reset by the thing proving it.
 *
 * b622 correctly made `listKids < evTotal` survivable - that comparison is a
 * category error, because Athena's "All Events (N)" counts future appointments,
 * vitals and patient cases the <ul> never renders, so listKids < evTotal is the
 * permanent steady state rather than a race. It left stability as the only way
 * through:
 *
 *     if (!(stabN >= 6 && stabMs >= 20000)) return 'visits-list-still-rendering'
 *
 * and counted stabN in the FRAME (window.__mlsEnumStab). But the orchestrator
 * re-drives the panel between every pass - `openVisits` then sleep(3500) - which
 * re-renders that frame and takes the counter with it. n resets to 1 forever,
 * stabN never reaches 6, the gate never opens, and after 16 identical passes the
 * read gives up. A frame-local counter cannot measure stability across a loop
 * whose every iteration re-renders the frame.
 *
 * The orchestrator already tracks the same thing durably (ehStuckPasses, keyed
 * on a string with the volatile ';n=' and ';sameFor=' stripped) and lives above
 * the frame. The fix passes that down and lets the gate honour whichever
 * evidence is stronger.
 *
 * Downstream consequence, same root cause: because the index loop is allowed to
 * retry until 7s before readDeadline, a chart that never satisfies the gate
 * burns the whole 165s read budget, and the body phase is then admitted with
 * nothing left - which is how patients with 14 and 20 encounters came back
 * `visits-time-budget-exceeded` ("Nothing was opened or reported as complete")
 * on the retry pass. The index phase now has its own deadline.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

/* ---- 1. the orchestrator measures stability durably ---------------------- */

assert(/var ehStuckKey = '', ehStuckPasses = 0, ehStuckFirstAt = 0;/.test(src),
  'the orchestrator must track when the current shape-key was first seen');

assert(/ehStuckKey = ehKey; ehStuckPasses = 1; ehStuckFirstAt = Date\.now\(\);/.test(src),
  'a new shape-key must reset the first-seen timestamp with the pass count');

/* ---- 2. and hands it to the enumerate op --------------------------------- */

assert(/outerStableN: ehStuckPasses/.test(src) && /outerStableMs: ehStuckFirstAt/.test(src),
  'the orchestrator must pass its own stability evidence into the enumerate op');

assert(/var enR = await exec\(emrId, null, \['enumerate', enumCfg\]\);/.test(src),
  'the enumerate call must use the extended cfg, or the evidence never crosses the hop');

/* The extended cfg MUST retain the guard fields: exec() returns [] immediately
   without __readDeadline and __requestToken, so a copy that dropped them would
   silently disable enumeration entirely rather than fail loudly. */
assert(/enumCfg = Object\.assign\(\{\}, cfg, \{/.test(src),
  'the extended cfg must be built by copying cfg, so __readDeadline/__requestToken survive');
const guardAssignAt = src.indexOf('cfg = Object.assign({}, cfg, guardCfg(readGuard));');
const enumCopyAt = src.indexOf('enumCfg = Object.assign({}, cfg, {');
assert(guardAssignAt > -1 && enumCopyAt > guardAssignAt,
  'cfg must already carry the guard fields before the enumerate copy is taken');

/* ---- 3. the gate honours the stronger evidence --------------------------- */

assert(/var effStabN = Math\.max\(Number\(stabN\) \|\| 0, Number\(cfg && cfg\.outerStableN\) \|\| 0\);/.test(src),
  'gate 3 must combine frame-local and orchestrator stability counts');
assert(/if \(!\(effStabN >= 6 && effStabMs >= 20000\)\) \{/.test(src),
  'gate 3 must decide on the combined evidence, not the frame-local count alone');
assert(!/if \(!\(stabN >= 6 && stabMs >= 20000\)\) \{/.test(src),
  'the frame-only stability test must be gone - it is the deadlock');

/* ---- 4. the index wait cannot eat the body budget ------------------------ */

/* 3.0.20: derived from the EFFECTIVE deadline, not the nominal budget.
 *
 * 3.0.19 shipped this as 40% of readBudgetMs, computed BEFORE readDeadline is
 * clamped to the caller's window. The day pull hands down far less than the
 * nominal 165s, so the cap (~66s) sat PAST the real deadline and the added
 * condition was always weaker than the readDeadline check standing beside it.
 * The guard existed, read correctly, and protected nothing — in precisely the
 * path it was written for. */
assert(/indexPhaseDeadline = readStartedAt \+ Math\.min\(70000, Math\.max\(20000, Math\.round\(\(readDeadline - readStartedAt\) \* 0\.4\)\)\);/.test(src),
  'the index-phase deadline must derive from the effective readDeadline, not the nominal budget');

/* Ordering IS the defect: derived before the clamp, the value is stale. */
{
  const clampAt = src.indexOf('readDeadline = Math.min(readDeadline, frozenCallerDeadline);');
  const deriveAt = src.indexOf('indexPhaseDeadline = readStartedAt + Math.min(70000');
  assert(clampAt > -1, 'the caller-deadline clamp is gone');
  assert(deriveAt > clampAt,
    'the index-phase deadline is computed BEFORE the caller clamp, so it is derived from a budget the read will never actually get');
}

/* And behaviourally: for every plausible window the cap must fall inside it. */
{
  const derive = (started, effectiveDeadline) =>
    started + Math.min(70000, Math.max(20000, Math.round((effectiveDeadline - started) * 0.4)));
  for (const window of [165000, 100000, 60000, 45000]) {
    const cap = derive(0, window);
    assert(cap < window,
      'with a ' + window + 'ms window the index cap must fall INSIDE it, got ' + cap);
  }
  const stale = Math.min(70000, Math.max(20000, Math.round(165000 * 0.4)));
  assert(stale > 60000,
    'sanity: the old nominal-budget derivation really did land outside a 60s window — that was the bug');
}
assert(/Date\.now\(\) \+ 24000 < readDeadline && Date\.now\(\) \+ 7000 < indexPhaseDeadline/.test(src),
  'the index retry loop must respect the index-phase deadline as well as the read deadline (readDeadline margin moved 7s->24s with axc-1.0: the ax route runway reserve; the DUAL-deadline intent this pin guards is unchanged)');

/* ---- 5. the deadlock itself, simulated ----------------------------------- *
 *
 * Model both counters exactly as the source does and run the real loop shape:
 * every pass re-renders the frame, so the frame-local counter resets. Prove the
 * old rule can never open and the new rule opens on the sixth pass.
 */

function runPasses(passes, frameReloadsEachPass) {
  let frameStab = null;           /* window.__mlsEnumStab */
  let outerN = 0, outerFirstAt = 0;
  const shape = '9:7';            /* identical every pass, as measured */
  let openedOld = -1, openedNew = -1;
  for (let p = 0; p < passes; p++) {
    const now = p * 3500;         /* openVisits + sleep(3500) between passes */
    if (frameReloadsEachPass) frameStab = null;
    if (!frameStab || frameStab.shape !== shape) frameStab = { shape, first: now, n: 1 };
    else frameStab.n++;
    const stabN = frameStab.n, stabMs = now - frameStab.first;

    if (outerN === 0) { outerN = 1; outerFirstAt = now; } else outerN++;
    const outerMs = now - outerFirstAt;

    if (openedOld < 0 && stabN >= 6 && stabMs >= 20000) openedOld = p;
    const effN = Math.max(stabN, outerN), effMs = Math.max(stabMs, outerMs);
    if (openedNew < 0 && effN >= 6 && effMs >= 20000) openedNew = p;
  }
  return { openedOld, openedNew };
}

const reloading = runPasses(16, true);
assert.strictEqual(reloading.openedOld, -1,
  'the frame-only rule should NEVER open when the frame reloads each pass - that is the bug being fixed');
assert(reloading.openedNew > -1 && reloading.openedNew <= 7,
  'the combined rule must open within a few passes even though the frame counter keeps resetting, got pass ' +
  reloading.openedNew);

/* And it must not become laxer when the frame is NOT reloading: same answer. */
const stable = runPasses(16, false);
assert(stable.openedOld > -1, 'sanity: the frame-only rule does open when the frame survives');
assert.strictEqual(stable.openedNew, stable.openedOld,
  'with a surviving frame the combined rule must open at exactly the same pass, not earlier - ' +
  'this fix removes a deadlock, it does not lower the bar');

/* A shape that keeps CHANGING must still be refused: stability is the evidence,
   and neither counter may accumulate across a change. */
(function () {
  let outerN = 0, outerFirstAt = 0, opened = -1;
  let lastShape = '';
  for (let p = 0; p < 16; p++) {
    const now = p * 3500, shape = '9:' + p;      /* different every pass */
    if (shape !== lastShape) { lastShape = shape; outerN = 1; outerFirstAt = now; } else outerN++;
    const effN = outerN, effMs = now - outerFirstAt;
    if (opened < 0 && effN >= 6 && effMs >= 20000) opened = p;
  }
  assert.strictEqual(opened, -1,
    'a list whose shape changes every pass must never be accepted as settled');
})();

console.log('PASS encounter-index stability: the frame-local counter is destroyed by the openVisits re-drive ' +
  '(0 of 16 passes could ever open the gate - the measured 5/5 failure), the orchestrator count opens it by pass ' +
  reloading.openedNew + ', a surviving frame is unchanged, a changing shape is still refused, and the index ' +
  'phase can no longer consume the body-read budget');
