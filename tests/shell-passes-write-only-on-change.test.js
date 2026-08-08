'use strict';

/*
 * The shell reacts to DOM churn. It must not add to it.
 *
 * OWNER, 2026-07-25, live: "the whole visit page glitches out every 5 seconds."
 *
 * Measured on his signed-in visit screen at b623, tab genuinely visible, with a
 * 1s control timer proving the run was not throttled (40 fires in 40s):
 *
 *     button[aria-current]        605 writes / 40s   ALL 605 no-ops
 *     span.mls-dock-count[class]  242 writes / 40s   ALL 242 no-ops
 *     span.mls-dock-count childList 121 writes       unchanged text
 *
 * 605 aria-current writes across five dock buttons was ~3 FULL SHELL PASSES PER
 * SECOND. The shell is not the source of the cadence — other modules run a 4s
 * rebuild of #visitOrdersBody, a 3s mount, and ~1s tooltip rewrites. The broad
 * #visitView observer remains necessary to repair the stages rail after an
 * external rebuild, but its records are now tagged as the Visit concern: they
 * run only the two Visit-owned repairs instead of every independent shell pass.
 *
 * THE THING THAT MAKES THIS A LOOP RATHER THAN MERE WASTE: `setAttribute` fires
 * a MutationObserver record even when the value it writes is identical, and so
 * does a `textContent` assignment (it replaces the text node). Every other
 * observer on the page — and there are ~94 document-wide ones — gets woken by
 * writes that changed nothing.
 *
 * So the rule this suite pins: a pass that runs on every external mutation may
 * only write when the value actually changes. That is not an optimisation, it
 * is what stops a reaction becoming a feedback loop.
 *
 * It also protects the boot lane's finding from the other direction: the dock
 * pill block reads offsetWidth and offsetLeft, two FORCED LAYOUTS per pass, in
 * the file they measured at 29% of boot's 5,576 forced-layout reads.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

function body(name, endMarker) {
  const i = shell.indexOf('function ' + name + '(');
  assert(i > -1, name + '() is gone');
  const j = shell.indexOf(endMarker || '\n  function ', i + 10);
  return shell.slice(i, j > i ? j : shell.length);
}

/* ---- the dock: the measured offender ------------------------------------- */

const syncDock = body('syncDock');

assert(/if \(b\.getAttribute\('aria-current'\) !== wantCur\) b\.setAttribute\('aria-current', wantCur\);/.test(syncDock),
  'aria-current must be written only when it changes — setAttribute fires a mutation record even when the value is identical, and this was 605 no-op writes in 40 seconds on the owner\'s screen');

assert(/if \(b\.style\.display !== wantDisp\) b\.style\.display = wantDisp;/.test(syncDock),
  'the dock button display must be written only on change');

assert(/if \(c\.textContent !== want\) c\.textContent = want;/.test(syncDock),
  'the dock count must be written only on change — assigning textContent replaces the text node and fires a childList record even for an identical string');

/* The pill: two forced layout reads per pass. Guarded writes are the point, but
   so is not re-writing identical transforms. */
assert(/if \(pill\.style\.width !== w\)/.test(syncDock) &&
       /if \(pill\.style\.transform !== tx\)/.test(syncDock) &&
       /if \(pill\.style\.opacity !== '1'\)/.test(syncDock),
  'the dock pill must not rewrite identical geometry every pass');
assert(/else if \(pill && pill\.style\.opacity !== '0'\)/.test(syncDock),
  'hiding the pill must also be conditional');

/* ---- stages: writes that sat BEFORE the change guard --------------------- */

const renderStages = body('renderStages');
assert(/if \(el && el\.style\.display !== 'none'\) el\.style\.display = 'none';/.test(renderStages),
  'the stages strip hid itself unconditionally on every pass, before the lastStage guard could return');
assert(/if \(el\.style\.display !== 'flex'\) el\.style\.display = 'flex';/.test(renderStages),
  'the stages strip showed itself unconditionally on every pass');
/* The guard's SUBSTANCE is pinned in two halves rather than as one literal
   string. `el.childNodes.length` is now derived into `built`, because the same
   fact also decides whether the rail needs building at all — the rail is built
   once and thereafter only repainted, so that its transitions have a previous
   value to run from. Both halves are required: pinning only the `if` would let
   `built` be re-derived from something that is always true, which reinstates
   the unconditional repaint this suite exists to prevent. */
assert(/var built = el\.childNodes\.length > 0;/.test(renderStages),
  'renderStages must still decide "already built" from the DOM — ensureStages hands ' +
  'back an EMPTY div when the rail was removed, so lastStage alone cannot know');
assert(/if \(now === lastStage && built\) return;/.test(renderStages),
  'the lastStage guard must remain — the conditional writes above it are not a substitute');

/* ---- no unguarded setAttribute survives in a per-pass function ------------ */

/* renderNow's passes run on every external mutation. Any bare setAttribute in
   one of them is a wake-up call to every observer on the page. Passes that
   short-circuit on a signature BEFORE writing are exempt and named here. */
/* Both halves are required. Checking only that the name APPEARS passes while
   the store is deleted and the compare is left behind — a signature that is
   read but never written never matches, so the short-circuit is dead and every
   pass rewrites. Caught by negative-testing this very assertion. */
const GUARDED_BY_SIGNATURE = {
  identityCards: [/if \(btn\.__mlsIdSig === sig/, /btn\.__mlsIdSig = /],
  nameControls: [/if \(el\.__mlsAcnSig === sig\) return;/, /el\.__mlsAcnSig = sig;/],
  prepRows: [/getAttribute\('data-sig'\) === sig\) return;/, /setAttribute\('data-sig', sig\)/]
};

for (const [fn, [readGuard, writeStore]] of Object.entries(GUARDED_BY_SIGNATURE)) {
  const src = body(fn);
  assert(readGuard.test(src),
    fn + '() lost the signature COMPARE; without it every external mutation rewrites the DOM again');
  assert(writeStore.test(src),
    fn + '() lost the signature STORE; a signature that is read but never written never matches, so the short-circuit is dead and the compare is decoration');
}

/* ---- scoped observer + repair routing ------------------------------------ */

assert(/observer = new MutationObserver\(schedule\)/.test(shell),
  'the shell still renders in response to DOM mutations');
const observeRoot = body('observeRoot');
const watch = body('watch');
const markFromTarget = body('markFromTarget');
const buildPasses = body('buildPasses');
assert(/observer\.observe\(node, options\)/.test(observeRoot) &&
  /watchRoots\.push\(\{ node: node, bits: bits \}\)/.test(observeRoot),
  'the scoped observer helper must both observe the real root and retain its concern tag');
assert(/observeRoot\(visit, \{ childList: true, subtree: true \}, \['visit'\]\)/.test(watch),
  'the shell must still observe the complete #visitView subtree so an external rebuild repairs Visit-owned shell furniture');
assert(/dirty\[item\.bits\[j\]\] = true;[\s\S]*?return;/.test(markFromTarget),
  'a known observed root must map to its scoped concern instead of widening to a full shell pass');

const visitJobs = [...buildPasses.matchAll(/if \([^\n]*d\.visit[^\n]*\) jobs\.push\((\w+)\);/g)].map(m => m[1]);
assert.deepStrictEqual(visitJobs, ['renderStages', 'arm'],
  'Visit subtree churn must retain stage/heads-down repair without waking unrelated dock, patient, or context scans');
const routeJobs = [...buildPasses.matchAll(/if \([^\n]*d\.route[^\n]*\) jobs\.push\((\w+)\);/g)].map(m => m[1]);
assert.deepStrictEqual(routeJobs,
  ['syncDock', 'renderRightNow', 'renderStages', 'prepRows', 'patientScreen', 'contextBar', 'arm'],
  'a real route lifecycle must still repair every shell owner after scoped mutation routing');
assert(/function onViewChanged\(\) \{ markDirty\('route'\); queuePass\(\); \}/.test(shell) &&
  /W\[fn\]\('mls:view-changed', onViewChanged\)/.test(shell),
  'canonical view changes must drive the full route repair lane');

console.log('PASS shell passes write only on change: the dock, its pill and the stages strip no longer re-write identical values on every externally-triggered render (measured 605 no-op aria-current writes in 40s before this)');
