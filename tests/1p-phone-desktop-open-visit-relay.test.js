/* phopen-1.0.0: phone appointment selection -> exact office MLS visit.
 * Run: node tests/1p-phone-desktop-open-visit-relay.test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const connect = read('1p-mls-connect.js');
const phone = read('feat_mls_phone_ui.js');
let checks = 0;
function ok(value, message) { checks++; assert(value, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }

/* Sender contract: no patient demographics cross this navigation request, the
   already-deployed relay kind is explicitly narrowed by intent on both ends,
   and success requires an exact echoed receipt rather than a fulfilled fetch. */
ok(/api\.openVisitOnOffice\s*=\s*function/.test(connect), 'phone relay API is missing');
ok(/kind:\s*'pullChart'/.test(connect), 'handoff must use the deployed relay kind');
ok(/intent:\s*'openVisit'/.test(connect), 'handoff payload lacks its explicit intent allowlist');
ok(/targetDeviceId:\s*String\(p\.officeId\)/.test(connect), 'handoff is not targeted at the exact office device');
ok(/data\.appointmentId[\s\S]*expected\.appointmentId[\s\S]*data\.visitDay[\s\S]*expected\.visitDay[\s\S]*data\.requestId[\s\S]*expected\.requestId/.test(connect),
  'phone success does not verify appointment + day + request receipt');
const payload = /payload:\s*\{\s*intent:\s*'openVisit'([\s\S]*?)\},\s*requestId:/.exec(connect);
ok(payload, 'openVisit payload is not statically bounded');
for (const forbidden of ['name:', 'dob:', 'mrn:', 'noteText:']) {
  ok(!payload[1].includes(forbidden), `navigation payload must not include ${forbidden}`);
}
const runners = /var RELAY_RUNNERS = \{([^}]*)\}/.exec(connect);
ok(runners && /pullChart:\s*runPullChart/.test(runners[1]), 'relay dispatch must remain an explicit allowlist');
ok(!/openVisit:\s*runOpenVisit/.test(runners[1]), 'openVisit must not silently widen the server/client top-level kind allowlist');

/* Phone UI contract: local activation is authoritative and immediate. Only a
   successful local open may publish, and stale terminal callbacks are fenced. */
const openBranchAt = phone.indexOf("if (act === 'open')");
const openBranchEnd = phone.indexOf("/* ---- check-ins", openBranchAt);
const openBranch = phone.slice(openBranchAt, openBranchEnd);
ok(openBranchAt > 0 && openBranchEnd > openBranchAt, 'phone open branch is missing');
ok(openBranch.indexOf('if (!ok)') < openBranch.indexOf('openVisitOnOffice'), 'a refused local open must never publish to the office');
ok(openBranch.indexOf('goVisit();') < openBranch.indexOf('openVisitOnOffice'), 'phone navigation must not wait on the office network');
ok(/openSerial !== officeOpenSerial/.test(openBranch), 'an old selection can still repaint the phone after a newer tap');

/* Execute the real office runner, not a rewritten facsimile. */
const runnerStart = connect.indexOf('var openVisitLastRevisionByOrigin = {}');
const runnerEnd = connect.indexOf('  function runPullChart(job)', runnerStart);
ok(runnerStart > 0 && runnerEnd > runnerStart, 'office open runner is not extractable');
const runnerSource = connect.slice(runnerStart, runnerEnd);

function harness(options) {
  options = options || {};
  let token = options.token || 'account-token';
  let state = Object.assign({
    day: options.beforeDay || '2026-08-26',
    active: options.beforeActive || null,
    phase: options.phase || 'idle',
    signed: options.signed === true,
    noteLen: options.noteLen || 0,
    transcriptLen: options.transcriptLen || 0,
    today: options.beforeRows || []
  }, options.before || {});
  let starts = 0, daySets = 0;
  const appointmentId = options.appointmentId || 'appt-27';
  const requestedDay = options.requestedDay || '2026-08-27';
  const rows = options.rows || [{ id: appointmentId, name: 'Not relayed' }];
  const remote = {
    snapshot() { return Object.assign({}, state, { today: (state.today || []).slice() }); },
    setVisitDay(day) {
      daySets++;
      if (options.refuseDay) return false;
      state.day = day;
      state.active = null;
      state.phase = 'idle';
      state.noteLen = 0;
      state.today = rows.slice();
      return true;
    },
    startVisitFor(id, opts) {
      starts++;
      eq(opts.record, false, 'office handoff must never start recording');
      eq(opts.quiet, true, 'office handoff must use the quiet exact path');
      if (options.refuseStart) return false;
      if (!options.falseAck) state.active = { id };
      return true;
    }
  };
  const ctx = {
    Promise, String, Number, Object, Array, RegExp,
    window: { __mlsEasyV32: { remote } },
    tok: () => token,
    agentDeviceId: () => options.deviceId || 'office-1'
  };
  vm.createContext(ctx);
  vm.runInContext(runnerSource + '\nthis.__runOpenVisit = runOpenVisit;', ctx, { filename: '1p-mls-connect.js#phopen' });
  return {
    run(input) {
      const p = Object.assign({
        intent: 'openVisit', appointmentId, visitDay: requestedDay,
        requestId: 'req-1', originDeviceId: 'phone-1', originSessionId: 'phone-page-1', selectionRevision: 1
      }, input && input.payload || {});
      return ctx.__runOpenVisit(Object.assign({ id: 'job-1', requestId: p.requestId, targetDeviceId: 'office-1', payload: p }, input && input.job || {}));
    },
    counts: () => ({ starts, daySets }),
    setToken: (value) => { token = value; },
    state: () => state
  };
}

const senderStart = connect.indexOf('  var openVisitFlight = null;');
const senderEnd = connect.indexOf('  /* ===== phsend-1.0.0', senderStart);
ok(senderStart > 0 && senderEnd > senderStart, 'phone sender is not extractable');
const senderSource = connect.slice(senderStart, senderEnd);
function senderHarness(resultFactory, presence) {
  const posts = [];
  const api = {};
  const ctx = {
    api, Promise, String, Number, Object, Array, RegExp, Date, Math, JSON, encodeURIComponent,
    authed: () => true,
    base: () => 'https://api.test',
    H: () => ({ Authorization: 'Bearer account-token' }),
    agentDeviceId: () => 'phone-1',
    setTimeout: (fn) => { Promise.resolve().then(fn); return 1; },
    fetch(url, init) {
      posts.push({ url: String(url), init: init || {} });
      if (/\/presence$/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve(presence || { ok: true, online: true, ext: true, officeId: 'office-1' }) });
      if (/\/jobs$/.test(url)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 'job-open-1' }) });
      if (/\/jobs\/job-open-1$/.test(url)) {
        const body = JSON.parse(posts.find((p) => /\/jobs$/.test(p.url)).init.body);
        const exact = { opened: true, appointmentId: body.payload.appointmentId, visitDay: body.payload.visitDay, requestId: body.payload.requestId };
        const data = resultFactory ? resultFactory(exact) : exact;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, job: { status: 'done', result: { ok: true, data } } }) });
      }
      return Promise.reject(new Error('unexpected URL ' + url));
    }
  };
  vm.createContext(ctx);
  vm.runInContext(senderSource, ctx, { filename: '1p-mls-connect.js#phopen-sender' });
  return { api, posts };
}

(async function () {
  {
    const h = harness({});
    const out = await h.run();
    eq(out.ok, true, 'exact appointment should open');
    eq(out.data.appointmentId, 'appt-27', 'receipt appointment drifted');
    eq(out.data.visitDay, '2026-08-27', 'receipt day drifted');
    eq(h.counts().starts, 1, 'exact visit must start once');
    eq(h.state().active.id, 'appt-27', 'office state did not become exact appointment');
  }
  {
    const h = harness({ beforeDay: '2026-08-27', beforeActive: { id: 'other' }, phase: 'rec', rows: [{ id: 'appt-27' }] });
    const out = await h.run();
    eq(out.ok, false, 'cross-patient recording must refuse');
    ok(/recording a different appointment/i.test(out.error), 'recording refusal is not explicit');
    eq(h.counts().starts, 0, 'recording refusal changed the appointment');
  }
  {
    const h = harness({ beforeDay: '2026-08-27', beforeActive: { id: 'other' }, phase: 'note', noteLen: 42, rows: [{ id: 'appt-27' }] });
    const out = await h.run();
    eq(out.ok, false, 'unfinished note must refuse a remote switch');
    ok(/unfinished visit/i.test(out.error), 'unfinished-note refusal is not explicit');
    eq(h.counts().starts, 0, 'unfinished note was displaced');
  }
  {
    const h = harness({ beforeDay: '2026-08-27', beforeActive: { id: 'other' }, phase: 'idle', transcriptLen: 12, rows: [{ id: 'appt-27' }] });
    const out = await h.run();
    eq(out.ok, false, 'typed transcript must refuse a remote switch even when phase is idle');
    ok(/unfinished visit/i.test(out.error), 'typed-transcript refusal is not explicit');
    eq(h.counts().starts, 0, 'typed transcript was displaced');
  }
  {
    const h = harness({ rows: [{ id: 'appt-27' }, { id: 'appt-27' }] });
    const out = await h.run();
    eq(out.ok, false, 'duplicate appointment identity must refuse');
    ok(/duplicated/i.test(out.error), 'duplicate refusal is not explicit');
    eq(h.counts().starts, 0, 'duplicate identity reached activation');
  }
  {
    const h = harness({ falseAck: true });
    const out = await h.run();
    eq(out.ok, false, 'truthy activation without an exact after-snapshot must not ACK');
    ok(/verify the appointment after opening/i.test(out.error), 'false-ACK refusal is not explicit');
  }
  {
    const h = harness({ beforeDay: '2026-08-27', beforeActive: { id: 'appt-27' } });
    const newest = await h.run({ payload: { requestId: 'req-2', selectionRevision: 2 } });
    eq(newest.ok, true, 'newest selection should be accepted');
    const stale = await h.run({ payload: { requestId: 'req-1', selectionRevision: 1 } });
    eq(stale.ok, false, 'network-delayed older selection must refuse');
    ok(/newer phone selection/i.test(stale.error), 'stale-selection refusal is not explicit');
    const reloaded = await h.run({ payload: { requestId: 'req-3', originSessionId: 'phone-page-2', selectionRevision: 1 } });
    eq(reloaded.ok, true, 'a real phone reload must be allowed to restart its revision sequence');
    h.setToken('another-account-token');
    const nextAccount = await h.run({ payload: { requestId: 'req-4', originSessionId: 'phone-page-2', selectionRevision: 1 } });
    eq(nextAccount.ok, true, 'a new MLS account must not inherit the prior account revision map');
  }
  {
    const h = harness({ deviceId: 'office-2' });
    const out = await h.run();
    eq(out.ok, false, 'wrong targeted office device must refuse');
    ok(/different office computer/i.test(out.error), 'wrong-target refusal is not explicit');
  }
  {
    const h = senderHarness();
    const opened = await h.api.openVisitOnOffice({ appointmentId: 'appt-27', visitDay: '2026-08-27' });
    eq(opened, true, 'phone sender should resolve only after an exact office receipt');
    const request = JSON.parse(h.posts.find((p) => /\/jobs$/.test(p.url)).init.body);
    eq(request.targetDeviceId, 'office-1', 'sender did not target presence officeId');
    eq(request.kind, 'pullChart', 'sender widened the server kind allowlist');
    eq(request.payload.intent, 'openVisit', 'sender lost the explicit navigation intent');
    eq(request.payload.originDeviceId, 'phone-1', 'sender lost its stale-selection origin fence');
    ok(/^phopen-session-/.test(request.payload.originSessionId), 'sender lost its per-page selection session fence');
    ok(request.payload.selectionRevision > 0, 'sender lost its monotonic selection revision');
    ok(!/"(?:name|dob|mrn|noteText)"\s*:/.test(JSON.stringify(request.payload)), 'sender put patient demographics in the navigation job');
  }
  {
    const h = senderHarness((exact) => Object.assign({}, exact, { appointmentId: 'wrong-appointment' }));
    const opened = await h.api.openVisitOnOffice({ appointmentId: 'appt-27', visitDay: '2026-08-27' });
    eq(opened, false, 'phone sender falsely ACKed a mismatched office receipt');
    eq(h.api.openVisitState().status, 'failed', 'mismatched receipt did not become a terminal failure');
  }
  console.log(`PASS phone->desktop exact appointment handoff (${checks} checks)`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
