'use strict';
/* b346 pull-request correlation + stale-response contract.
 *
 * Guards four guarantees added for "one authoritative date/provider":
 *  1. The ACTIVE EZ3 engine bridge stamps every outgoing extension request
 *     with a fresh requestId and REJECTS replies that echo a different id
 *     (cross-talk between concurrent pulls: si pulls, relay jobs, probes).
 *  2. The pullrec bridgeOnce (pullScheduleViaAssist probe/auto-nav path)
 *     carries the same correlation contract.
 *  3. loadCalendar is newest-wins: an older in-flight /api/appointments
 *     response can never overwrite _calAppts or the instant-paint cache
 *     after a newer call started (stale-cache-overwrites-fresh-pull bug).
 *  4. si (feat_mls_schedimport_exact) and the EZ3 staff/month engine
 *     mutually exclude via the SHARED window.__mlsSchedulePullLease slot,
 *     so a day pull and a month pull can never interleave goto-date/reads
 *     on the one Athena tab.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

/* ---- 1. active engine bridge correlation ---- */
const activeBridgeAt = connect.indexOf("var reqId = 'ez3-'");
assert(activeBridgeAt > 0, 'active engine bridge does not mint a request id');
const activeBridge = connect.slice(activeBridgeAt, activeBridgeAt + 2600);
assert(activeBridge.includes('if (gotId && gotId !== reqId) return;'),
  'active engine bridge does not reject foreign-id replies');
assert(activeBridge.includes('msg.id = reqId; msg.requestId = reqId;'),
  'active engine bridge does not stamp outgoing requests');
/* the dormant stacked engine copies carry the same contract */
const dormantCopies = connect.split("var reqId = 'ez3d-'").length - 1;
assert(dormantCopies >= 3, 'dormant engine bridge copies lost the correlation patch (found ' + dormantCopies + ')');

/* ---- 2. pullrec bridgeOnce correlation ---- */
const prfAt = connect.indexOf("var reqId = 'prf-'");
assert(prfAt > 0, 'pullrec bridgeOnce does not mint a request id');
const prf = connect.slice(prfAt, prfAt + 1400);
assert(prf.includes('if (gotId && gotId !== reqId) return;'),
  'pullrec bridgeOnce does not reject foreign-id replies');

/* ---- 3. loadCalendar newest-wins ---- */
const lcAt = app.indexOf('async function loadCalendar()');
assert(lcAt > 0, 'loadCalendar not found');
const lc = app.slice(lcAt, app.indexOf('function _calFilterVal', lcAt));
assert(lc.includes('window.__mlsCalLoadSeq=(window.__mlsCalLoadSeq||0)+1'),
  'loadCalendar does not take a sequence number');
const staleChecks = lc.split('_calSeq!==window.__mlsCalLoadSeq').length - 1;
assert(staleChecks >= 2, 'loadCalendar stale-response checks missing (found ' + staleChecks + ')');
const cacheWriteAt = lc.indexOf("localStorage.setItem(uns('calApptsCache')");
assert(cacheWriteAt > 0, 'loadCalendar cache write not found');
assert(lc.lastIndexOf('_calSeq!==window.__mlsCalLoadSeq') < cacheWriteAt,
  'a stale-response check must guard the cache write');
assert(lc.indexOf('_calSeq!==window.__mlsCalLoadSeq') < lc.indexOf('_calAppts=d.appointments'),
  'a stale-response check must precede applying fetched appointments');

/* ---- 4. si <-> engine mutual exclusion on the shared page lease ---- */
assert(si.includes('function foreignPullLease()'), 'si does not check the shared page lease');
assert(si.includes('if (foreignPullLease()) return Promise.resolve(busy("same-tab"));'),
  'si does not refuse to start while the engine holds the pull lease');
assert(si.includes('window.__mlsSchedulePullLease = { id: SI_LEASE_ID'),
  'si does not claim the shared page lease while running');
assert(si.includes('releaseSiLease()'), 'si never releases the shared page lease');
/* engine side: claimPullLease refuses foreign fresh leases (pre-existing contract) */
assert(connect.includes('if (l && l.id !== _ez3PullLeaseId) return false;'),
  'engine claimPullLease no longer refuses foreign leases');

/* ---- 5. the "Finding patients..." stage always terminates ---- */
assert(si.includes('schedule-parse-deadline-exceeded'),
  'schedule text-parse fallback is not deadline-bounded');
assert(si.includes('schedule-parse-timeout'),
  'schedule parse timeout does not produce a terminal fail reason');

console.log('PASS pull-request correlation contract: engine+bridgeOnce correlated, loadCalendar newest-wins, si/engine lease exclusion, bounded parse');
