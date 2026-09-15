'use strict';
/* stamptruth-1.0.0 (2026-09-15) - AUDIT_STATE_TRUTH_2026-09-15.md F9 + F11.
 *
 *  F11 four writers zeroed the shared busy stamp window.__mlsPullBusyAt
 *      unconditionally: the engine's settle (both arms), the ez3 lease
 *      release and the roster-warm lease release. The day strip outlives the
 *      engine's settle (convergence round, day-note drain) and refreshes the
 *      same stamp every 8 s, so for up to 8 s every consumer read "no pull
 *      owns the roster" while DS.pulling was true. Now each of the four
 *      zeroes only when the day strip is not busy; the strip's own release
 *      (dsLeaseRelease, already conditional on its remembered stamp) ends it.
 *  F9  a selected-provider refusal that performed no Athena read still wrote
 *      a durable resume record, offering a phantom "Unfinished pull" card on
 *      the next load (provider-* is never terminal, attempts never advanced).
 *      The record is no longer written; the outcome is still stamped.
 *
 * Part 1 pins the four guards and the removed call. Part 2 executes the guard
 * expression in every state. Synthetic values only.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const si = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.strictEqual(a, b, m + '\n   got: ' + JSON.stringify(a) + '\n   expected: ' + JSON.stringify(b)); };

const GUARD = "if (!(window.__mlsDaySwitch && typeof window.__mlsDaySwitch.isBusy === 'function' && window.__mlsDaySwitch.isBusy())) window.__mlsPullBusyAt = 0;";

/* ---- F11 pins ---------------------------------------------------------- */
eq(si.split(GUARD).length - 1, 2, 'the engine settle zeroes the stamp conditionally on both arms');
eq(si.split('safe(function () { window.__mlsPullBusyAt = 0; });').length - 1, 0, 'no unconditional zero is left in the engine settle');
eq(connect.split(GUARD).length - 1, 2, 'the ez3 lease release and the roster-warm release zero conditionally');
ok(!/delete window\.__mlsSchedulePullLease; window\.__mlsPullBusyAt = 0;/.test(connect), 'the ez3 release no longer zeroes unconditionally');
ok(!/delete window\.__mlsSchedulePullLease;\n        window\.__mlsPullBusyAt = 0;/.test(connect), 'the roster-warm release no longer zeroes unconditionally');
ok(connect.includes("    try { if (dsLeaseStamp && Number(window.__mlsPullBusyAt || 0) === dsLeaseStamp) window.__mlsPullBusyAt = 0; } catch (eLr2) {}"), 'the day strip\'s own release stays conditional on its remembered stamp');

/* ---- F9 pins ----------------------------------------------------------- */
ok(!si.includes('p1PersistResumeIntent(day, opts, scope0, explicit ? "day-caller" : "day-account", false);\n        lastPullResult = selectedRefusal;'), 'the selected-provider refusal no longer writes a resume record');
ok(si.includes("        /* stamptruth-1.0.0 (audit 2026-09-15, F9): this refusal performed no\n"), 'the reason is written where the call was');
ok(si.includes("        lastPullResult = selectedRefusal;\n        safe(function () { window.__mlsPullLastOutcome = honestPullOutcome(selectedRefusal); });\n        return selectedRefusal;"), 'the refusal is still stamped as the honest outcome and returned');
ok(si.includes('p1PersistResumeIntent('), 'the resume record still exists for pulls that DO read');

/* ---- the guard, executed ---------------------------------------------- */
function runGuard(daySwitch, stamp) {
  const ctx = { window: { __mlsDaySwitch: daySwitch, __mlsPullBusyAt: stamp } };
  vm.runInNewContext(GUARD, ctx);
  return ctx.window.__mlsPullBusyAt;
}
eq(runGuard({ isBusy: () => true }, 1700000000000), 1700000000000, 'a busy day strip keeps its stamp');
eq(runGuard({ isBusy: () => false }, 1700000000000), 0, 'an idle day strip lets the stamp go');
eq(runGuard(undefined, 1700000000000), 0, 'no day strip at all: the old behaviour (zero) stands');
eq(runGuard({}, 1700000000000), 0, 'a day strip without isBusy: the old behaviour stands');

console.log('PASS stamptruth-1.0.0: the shared busy stamp is zeroed only when the day strip does not hold it, and a refusal that read nothing writes no resume record (' + checks + ' checks)');
