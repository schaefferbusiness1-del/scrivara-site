'use strict';
/* ps-1.0.0 named-stage progress wiring: loads the REAL lb-2.0.0 owner plus the
 * real observer module in one sandbox, feeds synthetic app<->extension bridge
 * messages, and asserts every flow produces honest named stages, counts, and
 * context — no fake percentages, no undead spinners (deadlines + quiet-window
 * completion), stale results rejected. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const lbSource = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_loading_calm.js'), 'utf8');
const psSource = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_progress_stages.js'), 'utf8');
new Function(psSource); // syntax gate

/* ---------------- sandbox (same style as shared-progress-runtime) -------- */
function element(tag) {
  const classes = new Set();
  const children = {};
  const kids = [];
  return {
    tagName: tag, id: '', type: '', style: {}, textContent: '', innerHTML: '', attributes: {},
    classList: { add(v) { classes.add(v); }, remove(v) { classes.delete(v); }, contains(v) { return classes.has(v); } },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    addEventListener() {},
    appendChild(child) { kids.push(child); if (child.id) nodes[child.id] = child; return child; },
    appendedChildren() { return kids; },
    remove() { if (this.id) delete nodes[this.id]; },
    querySelector(sel) { if (!children[sel]) children[sel] = element('span'); return children[sel]; }
  };
}
const nodes = {};
const stored = {};
const timeouts = [];
let nextTimer = 0;
const document = {
  readyState: 'complete',
  head: element('head'), body: element('body'), documentElement: element('html'),
  getElementById(id) { return nodes[id] || null; },
  createElement(tag) { return element(tag); },
  createTextNode(t) { return { text: t }; },
  createEvent() { return { initCustomEvent() {} }; }
};
document.head.appendChild = document.body.appendChild = document.documentElement.appendChild = function (el) { if (el.id) nodes[el.id] = el; return el; };

const messageListeners = [];
const context = {
  console, Promise, Math, Date, Array, Object, JSON, Number, String,
  crypto: { randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })() },
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
  document,
  sessionStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; },
    setItem(k, v) { stored[k] = String(v); }
  },
  setTimeout(fn, ms) { const id = ++nextTimer; timeouts.push({ id, fn, ms }); return id; },
  clearTimeout(id) { const t = timeouts.find(x => x.id === id); if (t) t.cleared = true; },
  setInterval() { return ++nextTimer; },
  clearInterval() {},
  fetch() { return Promise.resolve({ ok: true }); }
};
context.window = context;
context.addEventListener = function (type, fn) { if (type === 'message') messageListeners.push(fn); };
context.removeEventListener = function () {};
context.dispatchEvent = function () {};
vm.createContext(context);
vm.runInContext(lbSource, context, { filename: 'feat_mls_loading_calm.js' });
vm.runInContext(psSource, context, { filename: 'feat_mls_progress_stages.js' });

const lb = context.__mlsLoadingCalm;
const ps = context.__mlsProgressStages;
assert(lb && lb.installed && lb.version === 'lb-2.0.0', 'shared lb owner missing');
assert(ps && ps.installed && ps.version === 'ps-1.0.1', 'progress-stages module missing');
/* ps-1.0.1: extension-less devices must not loop doomed auto "Connecting to
   Athena" jobs (Codex-flagged passive loop). Relay/phone devices never
   auto-spawn one; elsewhere the streak caps at 2 until a real pong re-arms. */
const psSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'feat_mls_progress_stages.js'), 'utf8');
assert(psSrc.includes('rl.shouldRelay === \'function\' && rl.shouldRelay()) return;'), 'relay devices can loop doomed connect jobs again');
assert(psSrc.includes("dr.effectiveRole() === 'phone') return;"), 'phone devices can loop doomed connect jobs again');
assert(psSrc.includes('if (conn.autoConnects >= 2) return;'), 'doomed connect-job streak cap was lost');
assert(psSrc.includes('conn.everConnected = true; conn.autoConnects = 0;'), 'pong no longer re-arms the connect-job cap');
assert(messageListeners.length >= 1, 'observer did not attach a message listener');

function post(data) { messageListeners.forEach(fn => fn({ data })); }
function jobByKey(key) {
  /* prefer the active job; otherwise the NEWEST same-key job — snapshot sorts
     by updatedAt, which ties within one test millisecond, so break ties with
     the harness's sequential job ids */
  const all = lb.snapshot().filter(j => j.key === key);
  return all.find(j => ({ queued: 1, running: 1, retrying: 1 })[j.status]) ||
    all.sort((a, b) => (b.updatedAt - a.updatedAt) || String(b.id).localeCompare(String(a.id)))[0] || null;
}
function firePending(predicate) {
  const t = timeouts.filter(x => !x.cleared && !x.fired && (!predicate || predicate(x))).pop();
  assert(t, 'expected a pending timer');
  t.fired = true; t.fn();
  return t;
}

/* ---------------- 1. connect / reconnect --------------------------------- */
post({ source: 'mls-app', type: 'mlsPing' });
let j = jobByKey('athena:connect');
assert(j && j.status === 'running', 'ping did not open a connect job');
assert.strictEqual(j.stages[0], 'Contacting the MLS Assist extension', 'connect stages missing');
post({ source: 'mls-ext', type: 'mlsPong', version: '2.9.26' });
j = jobByKey('athena:connect');
assert.strictEqual(j.status, 'completed', 'pong did not complete the connect job');
assert(/2\.9\.26/.test(j.message), 'connect completion does not name the version');

/* ---------------- 2. schedule pull: counts + partial honesty ------------- */
post({ source: 'mls-app', type: 'mlsAppPullSchedule', requestId: 'req-sched-0001', day: '07/17/2026', provider: 'Matthew Schaeffer MD' });
j = jobByKey('schedule:pull');
assert(j && j.status === 'running', 'schedule job did not start');
assert.strictEqual(j.stage, 'Reading the schedule day in Athena', 'schedule stage 1 wrong');
assert.strictEqual(j.selectedDate, '07/17/2026', 'schedule date context missing');
assert.strictEqual(j.provider, 'Matthew Schaeffer MD', 'schedule provider context missing');
assert.strictEqual(j.percent, null, 'schedule job invented a percent before any total existed');
/* stale (foreign requestId) result must NOT advance the job */
post({ source: 'mls-ext', type: 'mlsAppScheduleResult', requestId: 'req-sched-9999', resp: { ok: true, schedDate: '07/01/2026', appts: [{}], receipt: { complete: true, expectedCount: 1, parsedCount: 1 } } });
j = jobByKey('schedule:pull');
assert.strictEqual(j.stage, 'Reading the schedule day in Athena', 'stale schedule result advanced the job');
/* the real result: 18 of 20 expected -> counted, then PARTIAL (never fake 100%) */
const appts = Array.from({ length: 18 }, () => ({}));
post({ source: 'mls-ext', type: 'mlsAppScheduleResult', requestId: 'req-sched-0001', resp: { ok: true, schedDate: '07/17/2026', appts, receipt: { complete: false, expectedCount: 20, parsedCount: 18 } } });
j = jobByKey('schedule:pull');
assert.strictEqual(j.stage, 'Matching patients to your records', 'schedule did not advance to matching stage');
assert.strictEqual(j.total, 20, 'expected count not adopted as total');
assert.strictEqual(j.current, 18, 'parsed count not adopted');
assert.strictEqual(j.percent, 90, 'percent should reflect real 18/20');
firePending(t => t.ms === 1800); // grace window
j = jobByKey('schedule:pull');
assert.strictEqual(j.status, 'partial', 'incomplete receipt must end PARTIAL, not completed');
assert(/18 of 20/.test(j.message), 'partial message must carry the real counts');
assert(j.percent !== 100, 'partial result showed a fake 100%');

/* a complete pull ends completed with counts + date */
post({ source: 'mls-app', type: 'mlsAppPullSchedule', requestId: 'req-sched-0002', day: '07/18/2026' });
post({ source: 'mls-ext', type: 'mlsAppScheduleResult', requestId: 'req-sched-0002', resp: { ok: true, schedDate: '07/18/2026', appts: Array.from({ length: 20 }, () => ({})), receipt: { complete: true, expectedCount: 20, parsedCount: 20 } } });
firePending(t => t.ms === 1800);
j = jobByKey('schedule:pull');
assert.strictEqual(j.status, 'completed', 'complete pull did not complete');
assert(/20 appointments/.test(j.message) && /07\/18\/2026/.test(j.message), 'completion message lacks count/date');

/* an error result fails with the honest reason */
post({ source: 'mls-app', type: 'mlsAppPullSchedule', requestId: 'req-sched-0003' });
post({ source: 'mls-ext', type: 'mlsAppScheduleResult', requestId: 'req-sched-0003', resp: { ok: false, reason: 'no-athena-tab' } });
j = jobByKey('schedule:pull');
assert.strictEqual(j.status, 'failed', 'error result did not fail the job');
assert(/signed-in Athena tab/.test(j.message), 'failure message not humanized');

/* ---------------- 3. history pull: counts without fake percent ----------- */
post({ source: 'mls-app', type: 'mlsAppReadChart', name: 'Adam J Schaeffer' });
j = jobByKey('history:pull');
assert(j && j.status === 'running', 'history job did not start');
assert.strictEqual(j.current, 1, 'first chart not counted');
assert.strictEqual(j.percent, null, 'history invented a percent with no known total');
assert(/Adam J Schaeffer/.test(j.operation), 'per-patient operation text missing');
/* flow owner supplies the real total -> N of M */
assert.strictEqual(ps.expect('history', { total: 3 }), true, 'expect() rejected');
post({ source: 'mls-ext', type: 'mlsAppChartResult', resp: { ok: true } });
post({ source: 'mls-app', type: 'mlsAppGoHome' });
post({ source: 'mls-app', type: 'mlsAppReadChart', name: 'Laura Z' });
j = jobByKey('history:pull');
assert.strictEqual(j.total, 3, 'expected total not adopted');
assert.strictEqual(j.current, 2, 'second chart not counted');
assert(/2 of 3/.test(j.operation), 'operation should read "2 of 3"');
/* one failed chart -> partial with honest counts */
post({ source: 'mls-ext', type: 'mlsAppChartResult', resp: { error: 'chart-identity-unverified' } });
post({ source: 'mls-app', type: 'mlsAppReadChart', name: 'Third Patient' });
post({ source: 'mls-ext', type: 'mlsAppChartResult', resp: { ok: true } });
firePending(t => t.ms === 12000); // quiet window -> analyzing
j = jobByKey('history:pull');
assert.strictEqual(j.stage, 'Analyzing pulled history', 'quiet window did not enter analysis stage');
firePending(t => t.ms === 3000); // analysis grace -> finish
j = jobByKey('history:pull');
assert.strictEqual(j.status, 'partial', 'failed chart must end the pull PARTIAL');
assert(/2 of 3 charts/.test(j.message) && /1 failed/.test(j.message), 'partial history message lacks honest counts');

/* ---------------- 4. staging: probe -> confirm-wait -> execute ----------- */
post({ source: 'mls-app', type: 'mlsAppAthenaActionV2', mode: 'probe', action: 'write_note', requestId: 'req-act-1', expectedPatient: { name: 'Adam J Schaeffer' }, expectedContext: { provider: 'Matthew Schaeffer MD', visitDate: '07/17/2026' } });
j = jobByKey('athena:staging');
assert(j && j.stage === 'Verifying patient identity', 'probe did not open staging at identity stage');
assert.strictEqual(j.patient, 'Adam J Schaeffer', 'staging patient context missing');
post({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', resp: { ok: true, readOnly: true, actionToken: 't1', context: {} } });
j = jobByKey('athena:staging');
assert.strictEqual(j.stage, 'Waiting for your confirmation', 'probe ok did not reach confirm-wait stage');
post({ source: 'mls-app', type: 'mlsAppAthenaActionV2', mode: 'execute', action: 'write_note', requestId: 'req-act-1', expectedPatient: { name: 'Adam J Schaeffer' } });
j = jobByKey('athena:staging');
assert.strictEqual(j.stage, 'Writing to Athena', 'execute did not advance to writing stage');
post({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', resp: { ok: true, written: true, verified: true } });
j = jobByKey('athena:staging');
assert.strictEqual(j.status, 'completed', 'verified write did not complete');
assert(/verified/i.test(j.message), 'completion message must say verified');

/* blocked execute (write-safety) fails with the policy explanation */
post({ source: 'mls-app', type: 'mlsAppAthenaActionV2', mode: 'probe', action: 'place_order', requestId: 'req-act-2', expectedPatient: { name: 'Adam J Schaeffer' } });
post({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', resp: { ok: true, readOnly: true, actionToken: 't2' } });
post({ source: 'mls-app', type: 'mlsAppAthenaActionV2', mode: 'execute', action: 'place_order', requestId: 'req-act-2' });
post({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', resp: { ok: false, blocked: true, reason: 'write-safety-final-action-blocked' } });
j = jobByKey('athena:staging');
assert.strictEqual(j.status, 'failed', 'blocked execute did not fail the staging job');
assert(/write-safety policy/i.test(j.message), 'blocked message not humanized');

/* uncertain outcome ends PARTIAL, never completed */
post({ source: 'mls-app', type: 'mlsAppAthenaActionV2', mode: 'probe', action: 'save_draft', requestId: 'req-act-3', expectedPatient: { name: 'Adam J Schaeffer' } });
post({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', resp: { ok: true, readOnly: true } });
post({ source: 'mls-app', type: 'mlsAppAthenaActionV2', mode: 'execute', action: 'save_draft', requestId: 'req-act-3' });
post({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', resp: { ok: false, attempted: true, verified: false, reason: 'outcome-uncertain' } });
j = jobByKey('athena:staging');
assert.strictEqual(j.status, 'partial', 'uncertain outcome must be partial');
assert(/check Athena/i.test(j.message), 'uncertain message must direct the doctor to check Athena');

/* ---------------- 5. review screen --------------------------------------- */
post({ source: 'mls-app', type: 'mlsAppReviewScreen', requestId: 'rv1', manifest: { patient: { name: 'Adam J Schaeffer' }, items: [{ kind: 'note' }, { kind: 'order' }, { kind: 'dx' }] } });
j = jobByKey('review:screen');
assert(j && j.stage === 'Waiting for your review', 'review job did not open at waiting stage');
assert(/3 proposed items/.test(j.operation), 'review operation lacks item count');
post({ source: 'mls-ext', type: 'mlsAppReviewScreenResult', resp: { ok: true, confirmed: true, selected: ['n1'], blocked: ['o1', 'd1'] } });
j = jobByKey('review:screen');
assert.strictEqual(j.status, 'completed', 'review confirm did not complete');
assert(/1 note section/.test(j.message) && /2 preview-only/.test(j.message), 'review message lacks selected/blocked counts');

/* ---------------- 6. teach destination ----------------------------------- */
post({ source: 'mls-app', type: 'mlsAppTeachStart', requestId: 'teach-1', patient: { name: 'Adam J Schaeffer' } });
post({ source: 'mls-ext', type: 'mlsAppTeachProgress', resp: { state: 'waiting' } });
j = jobByKey('teach:destination');
assert.strictEqual(j.stage, 'Waiting for your teaching click in Athena', 'teach waiting stage missing');
post({ source: 'mls-ext', type: 'mlsAppTeachProgress', resp: { state: 'captured' } });
j = jobByKey('teach:destination');
assert.strictEqual(j.status, 'completed', 'teach capture did not complete');

/* ---------------- 7. no undead spinners: every flow carries a deadline --- */
for (const name of Object.keys(ps.flows)) {
  assert(ps.flows[name].timeoutMs >= 1000, 'flow ' + name + ' lacks a deadline');
  assert(Array.isArray(ps.flows[name].stages) && ps.flows[name].stages.length >= 1, 'flow ' + name + ' lacks named stages');
}
/* lb enforces the deadline: an abandoned job times out */
post({ source: 'mls-app', type: 'mlsAppPullSchedule', requestId: 'req-sched-0004' });
const deadline = timeouts.filter(t => !t.cleared && !t.fired && t.ms === 90000).pop();
assert(deadline, 'schedule deadline not armed');
deadline.fired = true; deadline.fn();
j = jobByKey('schedule:pull');
assert.strictEqual(j.status, 'timed_out', 'abandoned schedule pull did not time out honestly');

/* ---------------- 8. loader line + registration wiring ------------------- */
const connect = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
assert(connect.includes("data-mls-asset','feat_mls_progress_stages.js'"), 'ps loader line missing from mls-connect.js');
const lbAt = connect.indexOf("data-mls-asset','feat_mls_loading_calm.js'");
const psAt = connect.indexOf("data-mls-asset','feat_mls_progress_stages.js'");
assert(lbAt >= 0 && psAt > lbAt, 'ps loader must come after the lb loader');

console.log('PASS progress stages: connect/reconnect, schedule counts + stale rejection + partial honesty, history N-of-M without fake percents, staging probe->confirm->write->verify, review counts, teach, deadlines everywhere, loader wiring');
