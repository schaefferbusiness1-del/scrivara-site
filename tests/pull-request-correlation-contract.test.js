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

/* ---- 6. rl-2.0.0 mobile<->desktop sync contract ---- */
const rlAt = connect.indexOf("version: 'rl-2.0.0'");
assert(rlAt > 0, 'relay module is not rl-2.0.0');
const rl = connect.slice(connect.lastIndexOf('__mlsRelayLink rl-', rlAt) >= 0 ? connect.lastIndexOf('/* ===== __mlsRelayLink', rlAt) : rlAt, connect.indexOf('__mlsPhoneHome ph-', rlAt));
/* right computer: role-gated agent + device-targeted polling. pdp-1.0.0
   widened eligibility to office OR secondary, but a secondary computer may
   ONLY poll targeted jobs (never legacy untargeted office work). */
assert(rl.includes('function agentEligible()'), 'agent is not role gated');
assert(rl.includes("r === 'office' || r === 'secondary'"), 'agentEligible must allow exactly office/secondary');
assert(rl.includes("&targetedOnly=1"), 'secondary agent does not poll targetedOnly');
assert(rl.includes('if (sec && !did) { agentBusy = false; return; }'), 'secondary agent may poll without a device id');
assert(rl.includes('/api/relay/jobs/next' + "' + (did ? ('?deviceId="), 'agent does not poll with its deviceId');
assert(rl.includes('targetDeviceId: targetDeviceId'), 'phone jobs are not targeted at the office device');
assert(rl.includes('(presence && presence.officeId)'), 'phone does not take the target from presence.officeId');
/* frozen date/provider + requestId travel; the phone verifies the echo */
assert(rl.includes("dedupeKey: 'pullDay|' + date + '|'"), 'duplicate commands are not deduped server-side');
assert(rl.includes('payload: { date: date, provider: provider, requestId: requestId }'),
  'job payload does not freeze date/provider/requestId');
assert(rl.includes('pulled !== date'), 'phone does not verify the pulled-day echo before claiming success');
assert(rl.includes('requestedDate: date'), 'agent result does not echo the requested date');
/* honest disconnects + reload recovery + progress mirroring */
assert(rl.includes("job.status === 'lost'"), 'phone does not surface lost executors');
assert(rl.includes("job.status === 'canceled'"), 'phone does not surface canceled jobs');
assert(rl.includes('function makeProgressPoster('), 'agent does not relay live progress');
assert(rl.includes('job.progress && job.progress.note'), 'phone does not mirror per-patient progress');
assert(rl.includes("var ACTIVE_KEY = 'mlsRlActiveJob'"), 'active job is not persisted for reload recovery');
assert(rl.includes('Rejoining the Athena pull'), 'reload does not rejoin the in-flight pull');
assert(rl.includes('api.cancelActive'), 'no cancel affordance for the active job');
assert(rl.includes('is still running on'), 'no single-flight refusal for a different-date pull');
/* timeout ladder fits a real full-history day (old 150s starved 20-patient days) */
assert(rl.includes('510000'), 'agent pull deadline no longer fits a full-history day');
assert(rl.includes('tries > 252'), 'phone polling window no longer fits a full-history day');
/* at-most-once execution per job id on the agent */
assert(rl.includes('if (executedJobs[job.id])'), 'agent can execute the same job twice');

console.log('PASS pull-request correlation contract: engine+bridgeOnce correlated, loadCalendar newest-wins, si/engine lease exclusion, bounded parse, rl-2.0.0 sync');
