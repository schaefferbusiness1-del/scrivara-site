'use strict';
/* MLS Assist 3.0.63 — athena tab resilience contract (measured live 2026-08-17 on the
   owner's /cloned with 3.0.62): three signed-in athena tabs, TWO with a .calendar-nav that
   had NO day tabs (never-painted background dashboards); the picker leased one of those and
   every date navigation ended "athena week strip shows no selected day"; separately a MISSED
   1.2-1.5s ping during a heavy render ended a pull with terminal no-athena-tab while every
   tab was signed in (the lease-free presence verb answered presence-verified 5/5 right
   after). This suite pins the four source-level fixes and the version/digest form. It is a
   read-path change only: nothing about writing moves. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

/* version + digest form. Pin moved 3.0.63 -> 3.0.64 deliberately (2026-08-18):
   the 3.0.64 release (mls-hs-1.0.0 hidden-safe sleeps) changes no resilience
   semantics; the four source-level fixes below are still asserted against the
   live background.js bytes. */
/* Pin moved 3.0.64 -> 3.0.74 with the 2026-08-19 release train (3.0.65-3.0.74
   chain); later releases keep this historical behavior contract version-agnostic.
   The package/release suites own the exact current version; this suite only
   requires the digest stamp to be bound to whatever manifest version ships. */
assert(/^\d+\.\d+\.\d+$/.test(String(manifest.version || '')), 'manifest version must be a release version');
assert(new RegExp('^' + manifest.version.replace(/\./g, '\\.') + '\\+core-sha256:[0-9a-f]{64}$').test(String(manifest.version_name || '')),
  'version_name must carry the stamped core digest for the manifest version');

/* 1. session probe counts RENDERED day tabs; ping aggregates it */
assert(bg.includes('var calTabs = 0;'), 'probe must count rendered day tabs');
assert(bg.includes("calTabs: calTabs,"), 'probe must return calTabs');
assert(bg.includes('calTabs: signedOut ? 0 : fr.reduce(function (m, f) { return Math.max(m, Number((f && f.calTabs) || 0)); }, 0)'), 'ping must aggregate calTabs across frames');

/* 2. lease path: a missed ping is re-pinged once with a longer budget; both misses / closed / discarded / loginish still fail CLOSED (never hop) */
assert(bg.includes("if (qpHealth.signedOut) { mlsAthRejectSignedOut(qt.id); return null; }"), 'signed-out leased tab still fails closed');
assert(bg.includes('if (!qt.discarded) { var qpHealth2 = await mlsAthPing(qt.id, 3000); if (qpHealth2.alive && !qpHealth2.signedOut) return qt; if (qpHealth2.signedOut) mlsAthRejectSignedOut(qt.id); }'), 'missed ping on the leased tab must be re-pinged once (3000ms) before failing closed');
const leaseRegion = bg.slice(bg.indexOf('if (qpLease && qpLease.active'), bg.indexOf('/* v1.99 TAB PIN'));
assert(
  /if \(!qt\) \{[\s\S]*?qpLease\.active = false;[\s\S]*?qpLease\.athenaTabId = null;[\s\S]*?mlsQpState: null[\s\S]*?return null;[\s\S]*?\} else \{/.test(leaseRegion) &&
  /if \(!qt\.discarded\) \{[^\n]*qpHealth2[^\n]*if \(qpHealth2\.alive && !qpHealth2\.signedOut\) return qt;[^\n]*if \(qpHealth2\.signedOut\) mlsAthRejectSignedOut\(qt\.id\); \}\s*\}\s*return null;/.test(leaseRegion),
  'a leased tab that misses both pings, is closed, discarded or loginish still fails CLOSED (lease-over-pin contract)'
);
assert(!bg.includes("        if (qpHealth.signedOut) mlsAthRejectSignedOut(qt.id);\n      }\n      return null;\n    }"), 'the old fail-closed-on-any-miss lease block must be gone');

/* 3. general path: unreachable-not-signed-out candidates are re-pinged before "no athena tab" (then fail closed as before); rendered strip preferred */
assert(bg.includes("var retryable = checked.filter(function (x) { return x.probe && !x.probe.signedOut && x.probe.reachable === false && !(x.tab && x.tab.discarded); });"), 'general path must re-ping unreachable candidates');
assert(bg.includes("var rechecked = await Promise.all(retryable.map(async function (x) { return { tab: x.tab, probe: await mlsAthPing(x.tab.id, 3000) }; }));"), 're-ping budget is 3000ms');
assert(bg.includes("var selectedShell = usable.find(function (x) { return Number((x.probe && x.probe.calTabs) || 0) > 0; }) || usable.find(function (x) { return x.probe.cal || x.probe.fs; });"), 'picker must prefer a tab with rendered day tabs');

/* 4. goto: an EMPTY week strip is not a found control (caller runs its Home-reset ladder); the capability probe is unchanged */
assert(bg.includes("if (!probe && !rawTabs().length) { out.found = false; out.reason = 'weekstrip-empty';"), 'empty strip must report weekstrip-empty instead of clicking nothing');
assert(bg.includes("out.found = true; out.via = 'weekstrip';\n      if (probe) return out;"), 'probe path still advertises the strip');

/* 5. athenaTabs count rides goto, schedule and presence replies (PHI-free integer) */
assert(bg.includes('__gotoAthenaTabs = all.filter(function (t) { return mlsIsAthenaTab(t); }).length;'), 'goto must count athena tabs');
assert(bg.includes("payload = Object.assign({}, payload, { athenaTabs: __gotoAthenaTabs });"), 'goto replies must carry athenaTabs');
assert(bg.includes('__schedAthenaTabs = all.filter(function (t) { return mlsIsAthenaTab(t); }).length;'), 'schedule must count athena tabs');
assert(bg.includes("payload = Object.assign({}, payload, { athenaTabs: __schedAthenaTabs });"), 'schedule replies must carry athenaTabs');
assert(bg.includes('out.athenaTabs = __rawAthenaAll;'), 'presence reply must carry athenaTabs');

/* 6. writeready hand-offs: the appointment-row refusal keeps the driver's PHI-free diag; a probe refusal carries tab counts */
assert(bg.includes("error: 'The exact Athena appointment row could not be opened. No name fallback was attempted.', diag: (sched && sched.diag) || null });"), 'appointment-row refusal must keep diag');
assert(bg.includes("{ diag: { athenaTabs: athCandidates.length, verifiedTabs: verifiedTabCount, firstReason: String((probeFailure && probeFailure.reason) || 'context-unverified') } }"), 'probe refusal must carry tab counts');

/* write path untouched: the four-layer safety guard and the supervised handler boundary are still there */
assert(bg.includes('ATHENA_ACTION_V2_HANDLER_START'), 'supervised handler boundary must remain');

console.log('PASS ext 3.0.63 athena tab resilience: rendered-strip preference, missed-ping re-check (lease + general), empty-strip -> ladder, athenaTabs on goto/schedule/presence');
