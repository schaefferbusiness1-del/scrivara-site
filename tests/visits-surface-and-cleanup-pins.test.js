'use strict';
/* vst-1.0.0 + ocl-1.0.0 pins: SURFACE TARGETING AND TERMINAL CLEANUP CANNOT
 * REGRESS SILENTLY.
 *
 * Codex's red contracts visits-surface-targeting and
 * same-day-reader-owner-cleanup are the behavioral acceptance and run in
 * their lane; this thin registered suite keeps THIS branch's own gate
 * protective: the spliced shapes must stay in the injected driver and the
 * reader's cleanup chain.
 *
 * OLD BYTES FAIL BY NAME: an ambiguous Visits rail was guessed, a bare
 * li.encounter-list-item anywhere proved the Visits surface, a deep
 * encounter frame wandered through history.back(), and a refused read left
 * its encounter drawer open for the next patient. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'background.js'), 'latin1');

/* ---- vst-1.0.0: unique, visibly-scoped Visits rail ---- */
assert.ok(src.includes("return { ok: false, reason: 'visits-tab-ambiguous', candidates: vstRendered.length };"),
  'two visible Visits rails must refuse by name, never guess');
assert.ok(src.includes('if (vstRendered.indexOf(cand) < 0) vstRendered.push(cand);'),
  'the rail pick no longer collects DISTINCT rendered candidates');
assert.ok(src.includes('visitsSurfaceOpen = !!(vsRow && vsRow.closest && vsRow.closest('),
  'the open-surface proof no longer requires a visits-scoped ancestor - generic encounter DOM would prove it again');
assert.ok(!/history\.back\(\); return \{ ok: true, recovered: 'history-back' \}/.test(src),
  'the deep-encounter recovery wanders through browser history again');
assert.ok(src.includes("return { ok: false, reason: 'visits-rail-unreachable-deep-encounter' };"),
  'a briefing-link-less deep encounter frame must refuse by name');
/* the validated briefing-link recovery is the one navigation that remains */
assert.ok(src.includes("rstH.match(/^\\/\\d+\\/\\d+\\/ax\\/briefing\\/\\d+/)"),
  'the exact validated briefing-link recovery disappeared with the history fix');

/* ---- ocl-1.0.0: terminal cleanup owns the surface AND the lease ---- */
assert.ok(src.includes('function fireVisitCleanup(reason, immediate, surfaceCloser) {'),
  'fireVisitCleanup lost its surface-closer seam');
assert.ok(src.includes('surfDone.then(function () { startRelease(); }, function () { startRelease(); });'),
  'the surface close is no longer sequenced BEFORE the lease release');
const afterResponse = src.indexOf("fireVisitCleanup('all-visits-after-response', false, function () {");
assert.ok(afterResponse >= 0,
  'the after-response cleanup no longer closes the encounter surface');
assert.ok(src.slice(afterResponse, afterResponse + 400).includes("exec(readTabId, null, ['closeDetailFrame', cfg])"),
  'the after-response closer no longer issues closeDetailFrame across the read tab frames');
/* the closer is best-effort: a closer failure must never block the release */
assert.ok(src.includes('surfDone = Promise.resolve(surfaceCloser()).catch(function () {});'),
  'a surface-closer failure would block the lease release - the catch is gone');

console.log('PASS visits-surface + cleanup pins: ambiguous rails refuse, surface proof is scoped, history wandering is dead, and terminal cleanup closes the drawer before releasing the lease');
