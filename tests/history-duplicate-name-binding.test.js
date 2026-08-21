'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const visits = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing source marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing source end marker: ${end}`);
  return source.slice(a, b);
}

const helpers = between(app, 'function _athenaHistoryDigits(v)', '/* Like _assistReadAthenaTab');
const assist = between(app, 'function _assistReadChart(patientRef, onStatus)', '/* ===== Pull a PATIENT');
const singlePull = between(app, 'async function pullPatientChartViaAssist(btn, opts)', '/* Save a parsed Athena chart');
const save = between(app, 'function _athenaChartHistoryObject(chart)', '/* Bulk: after pulling the schedule');
const hasImported = between(app, 'function _hasImportedHistory(ref)', 'async function _pullAllHistories(appts)');
const bulk = between(app, 'async function _pullAllHistories(appts)', 'async function _parsePatientChart(text)');
const visitSaveWrapper = between(visits, 'var wrapped = function (name, appt, chart)', 'wrapped.__mlsWrapped = true');
const chartReader = between(background, "if (msg.type === 'mlsAppChartRequest')", '/* ---- v1.51: read the OPEN athena chart');

assert(save.includes("if(!targetId||!nm) return _chartSaveRefused('no-target-id-or-name')"), 'the canonical save still permits a name-only destination');
assert(save.includes('function _chartSaveRefused(gate,extra)'), 'refused chart saves no longer record which gate failed');
assert(save.includes('_athenaHistoryProofMatches(target,observed)'), 'the canonical save omits returned DOB/MRN proof');
assert(singlePull.indexOf('saveRef=_athenaHistoryVerifiedRef(pullTarget,rd)') < singlePull.indexOf('_savePatientChart(saveRef,null,chart)!==true'), 'single pull does not bind the verified read to its exact save');
assert(bulk.indexOf('_assistReadChart(target') < bulk.indexOf('_savePatientChart(saveRef,a,chart)===true'), 'bulk pull is not ID-bound from read through save');
assert(bulk.indexOf('_savePatientChart(saveRef,a,chart)===true') < bulk.indexOf('saved++'), 'bulk success can be counted before the exact save returns true');
assert(!/window\._savePatientChart\((?:name|row\.name|p\.name)\b/.test(connect), 'a production wrapper still saves chart history by display name');
assert(!/window\._assistReadChart\((?:name|row\.name)\b/.test(connect), 'a production wrapper still starts a delayed chart read with only a name');
assert(!/window\._hasImportedHistory\((?:name|nm|p\.name)\b/.test(connect), 'a production wrapper still checks imported state by ambiguous name');
assert(!connect.includes('window._assistReadChart()'), 'a production chart check still starts an unbound read');
assert(connect.includes('if (ret !== true) return ret') && connect.includes('if (r !== true) return r'), 'save wrappers can still run follow-on mutations after a refused exact save');
assert(visitSaveWrapper.includes('String((name && typeof name === \'object\' && (name.patientId || name.id))'), 'the late visit wrapper does not retain the exact MLS patient id');
assert(visitSaveWrapper.includes('if (r !== true) return r'), 'the late visit wrapper can ingest after a refused exact save');
assert(visitSaveWrapper.includes("String(x && x.id || '') === targetId"), 'the late visit wrapper still re-resolves a saved chart by display name');
assert(!bulk.includes('_hasImportedHistory(target)'), 'an explicit day pull still skips a previously imported patient instead of refreshing');
for (const marker of ['fullLen:', 'truncated:', 'readOk:', 'identityFrameResults', 'frameBoundToTarget', 'unboundClinicalFrames', 'oversizeClinicalFrames', 'unreadFrames', 'omittedForCap', "readerVersion: '2.9.19-chart-r3'"]) {
  assert(chartReader.includes(marker), `chart reader is missing fail-closed frame proof: ${marker}`);
}
assert(!chartReader.includes('.slice(0, 18000)'), 'chart reader still silently truncates each frame at 18k');
assert(chartReader.includes('rows.length > 1 ? \'ambiguous\''), 'duplicate display-name opener can still click an arbitrary unproved row');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function chartReceipt(requestId, text, overrides) {
  return Object.assign({
    kind: 'athena-chart-coverage',
    requestId,
    complete: true,
    readerVersion: '2.9.19-chart-r3',
    capturedAt: Date.now(),
    expectedClinicalFrames: 1,
    readClinicalFrames: 1,
    boundClinicalFrames: 1,
    unboundClinicalFrames: 0,
    oversizeClinicalFrames: 0,
    unreadFrames: 0,
    omittedForCap: 0,
    consideredFrames: 1,
    textChars: String(text || '').length,
    truncated: false,
    identityObserved: true,
    identityVia: 'banner'
  }, overrides || {});
}

function coveredChart(fields) {
  const chart = Object.assign({
    problems: '', meds: '', allergies: '', summary: '', vitals: {}, history: {}, visits: []
  }, fields || {});
  const present = value => value && (typeof value !== 'object' || Object.values(value).some(Boolean));
  chart.coverage = {
    problems: present(chart.problems) ? 'found' : 'not_documented',
    meds: present(chart.meds) ? 'found' : 'not_documented',
    allergies: present(chart.allergies) ? 'found' : 'not_documented',
    summary: present(chart.summary) ? 'found' : 'not_documented',
    vitals: present(chart.vitals) ? 'found' : 'not_documented',
    history: present(chart.history) ? 'found' : 'not_documented'
  };
  return chart;
}

async function main() {
  let patients = [
    { id: 'same-a', name: 'Alex Same', dob: '01/02/1970', mrn: '111', problems: '', meds: '', allergies: '', summary: '' },
    { id: 'same-b', name: 'Alex Same', dob: '03/04/1980', mrn: '222', problems: '', meds: '', allergies: '', summary: '' }
  ];
  let notes = [];
  let activeId = 'same-a';
  const toasts = [];
  const listeners = new Map();
  const posted = [];
  const heroPullStatus = { textContent: '', style: {} };
  const syntheticLeaseToken = 'synthetic-history-lease';
  const syntheticLeaseTokens = new Set([syntheticLeaseToken]);
  let syntheticLeaseSeq = 0;

  function addEventListener(type, fn) {
    const list = listeners.get(type) || [];
    list.push(fn);
    listeners.set(type, list);
  }
  function removeEventListener(type, fn) {
    const list = listeners.get(type) || [];
    listeners.set(type, list.filter(item => item !== fn));
  }
  function dispatch(type, event) {
    for (const fn of (listeners.get(type) || []).slice()) fn(event);
  }

  const context = {
    console,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    String,
    Number,
    Array,
    RegExp,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    __mlsP1AthenaLeaseLoan: syntheticLeaseToken,
    __mlsP1AthenaReadLease: {
      owns(token) { return syntheticLeaseTokens.has(token); },
      claim() { const token = `synthetic-direct-lease-${++syntheticLeaseSeq}`; syntheticLeaseTokens.add(token); return token; },
      ready() { return true; },
      touch() { return true; },
      release(token) { syntheticLeaseTokens.delete(token); return true; }
    },
    getPatients() { return clone(patients); },
    upsertPatient(p) {
      const i = patients.findIndex(x => x.id === p.id);
      if (i >= 0) patients[i] = clone(p); else patients.push(clone(p));
    },
    getNotes() { return clone(notes); },
    saveNotes(value) { notes = clone(value); },
    activePatient() { return clone(patients.find(p => p.id === activeId) || null); },
    getActivePtId() { return activeId; },
    setActivePtId(id) { activeId = id; },
    renderProfile() {},
    renderPatientBar() {},
    renderPatients() {},
    renderHistory() {},
    loadPatients() {},
    toast(message, kind) { toasts.push({ message, kind }); },
    document: { getElementById(id) { return id === 'heroPullStatus' ? heroPullStatus : null; } },
    addEventListener,
    removeEventListener,
    postMessage(message) { posted.push(message); }
  };
  context.window = context;
  vm.runInNewContext([helpers, assist, singlePull, save, hasImported, bulk].join('\n'), context, { filename: 'history-binding-functions.js' });

  const targetA = context._athenaHistoryTargetSnapshot({ patientId: 'same-a', name: 'Alex Same', dob: '01/02/1970', mrn: '111' }, false);
  const targetB = context._athenaHistoryTargetSnapshot({ patientId: 'same-b', name: 'Alex Same', dob: '03/04/1980', mrn: '222' }, false);
  assert(targetA && targetB && targetA.patientId !== targetB.patientId, 'same-name patients did not resolve to distinct immutable targets');
  assert.strictEqual(context._athenaHistoryTargetSnapshot({ name: 'Alex Same' }, false), null, 'ambiguous name-only target did not fail closed');

  const chartA = coveredChart({ problems: 'Problem A', summary: 'History A' });
  assert.strictEqual(context._savePatientChart('Alex Same', null, chartA), false, 'legacy name-only save was accepted');
  assert.strictEqual(context._savePatientChart({ ...targetA, verifiedName: 'Alex Same', verifiedDob: '03/04/1980' }, null, chartA), false, 'patient B DOB proof was accepted for patient A');
  assert(!patients[0].summary && !patients[1].summary, 'a refused save mutated one of the duplicate-name charts');

  // The bridge itself must reject a same-name response carrying the other DOB.
  let read = context._assistReadChart(targetA, () => {});
  dispatch('message', { data: { source: 'mls-ext', type: 'mlsPong' } });
  let request = posted.filter(x => x.type === 'mlsAppReadChart').pop();
  assert(request && request.patientId === 'same-a' && request.patientDob === '01/02/1970', 'chart request omitted its immutable target identity');
  let idlessSettled = false;
  read.then(() => { idlessSettled = true; }, () => { idlessSettled = true; });
  dispatch('message', { data: { source: 'mls-ext', type: 'mlsAppChartResult', deadlineAt: request.deadlineAt, resp: { ok: true, requestId: request.requestId, text: 'idless stale chart', chartName: 'Alex Same', chartDob: '01/02/1970', chartMrn: '111', receipt: chartReceipt(request.requestId, 'idless stale chart') } } });
  await Promise.resolve();
  assert.strictEqual(idlessSettled, false, 'an ID-less chart response settled a stateful exact-patient read');
  dispatch('message', { data: { source: 'mls-ext', type: 'mlsAppChartResult', requestId: request.requestId, deadlineAt: request.deadlineAt, resp: { ok: true, requestId: request.requestId, text: 'wrong duplicate chart', chartName: 'Alex Same', chartDob: '03/04/1980', chartMrn: '222', receipt: chartReceipt(request.requestId, 'wrong duplicate chart') } } });
  await assert.rejects(read, /did not prove it is this patient|name, date of birth or MRN did not match/, 'same-name patient B response was accepted for patient A');

  read = context._assistReadChart(targetA, () => {});
  dispatch('message', { data: { source: 'mls-ext', type: 'mlsPong' } });
  request = posted.filter(x => x.type === 'mlsAppReadChart').pop();
  dispatch('message', { data: { source: 'mls-ext', type: 'mlsAppChartResult', requestId: request.requestId, deadlineAt: request.deadlineAt, resp: { ok: true, requestId: request.requestId, text: 'verified chart A', chartName: 'Alex Same', chartDob: '01/02/1970', chartMrn: '111', receipt: chartReceipt(request.requestId, 'verified chart A') } } });
  const verifiedRead = await read;
  assert.strictEqual(verifiedRead.targetPatientId, 'same-a');

  const nestedIdlessRead = context._assistReadChart(targetA, () => {});
  dispatch('message', { data: { source: 'mls-ext', type: 'mlsPong' } });
  const nestedIdlessRequest = posted.filter(x => x.type === 'mlsAppReadChart').pop();
  const nestedIdlessText = 'outer-only correlated chart';
  dispatch('message', { data: { source: 'mls-ext', type: 'mlsAppChartResult', requestId: nestedIdlessRequest.requestId, deadlineAt: nestedIdlessRequest.deadlineAt, resp: { ok: true, text: nestedIdlessText, chartName: 'Alex Same', chartDob: '01/02/1970', chartMrn: '111', receipt: chartReceipt(nestedIdlessRequest.requestId, nestedIdlessText) } } });
  await assert.rejects(nestedIdlessRead, /every patient chart frame/, 'a success response without its own exact requestId passed the chart receipt gate');

  // If the shared absolute scheduler cannot arm a deadline at all, the chart
  // read is already terminal and must not emit a ping or a stateful chart read.
  const postedBeforeTerminalArm = posted.length;
  context.__mlsAbsoluteDeadline = {
    arm(deadlineAt, callback) {
      callback();
      const cancel = () => {};
      cancel.isTerminal = () => true;
      return cancel;
    }
  };
  const terminalArmRead = context._assistReadChart(targetA, () => {}, { requestId: 'chart-terminal-arm', deadlineAt: Date.now() + 60000 });
  await assert.rejects(terminalArmRead, /chart-read-deadline-exceeded/);
  assert.strictEqual(posted.length, postedBeforeTerminalArm, 'chart bridge dispatched after its deadline arm was terminal');
  delete context.__mlsAbsoluteDeadline;

  async function expectFrameRefusal(overrides, label) {
    const pending = context._assistReadChart(targetA, () => {});
    dispatch('message', { data: { source: 'mls-ext', type: 'mlsPong' } });
    const req = posted.filter(x => x.type === 'mlsAppReadChart').pop();
    const text = `unsafe ${label} chart`;
    dispatch('message', { data: { source: 'mls-ext', type: 'mlsAppChartResult', requestId: req.requestId, deadlineAt: req.deadlineAt, resp: {
      ok: true, requestId: req.requestId, text, chartName: 'Alex Same', chartDob: '01/02/1970', chartMrn: '111', receipt: chartReceipt(req.requestId, text, overrides)
    } } });
    await assert.rejects(pending, /every patient chart frame/, `${label} frame receipt was accepted`);
  }
  await expectFrameRefusal({ complete: false, readClinicalFrames: 0, boundClinicalFrames: 0, unboundClinicalFrames: 1 }, 'unbound stale');
  await expectFrameRefusal({ complete: false, readClinicalFrames: 0, boundClinicalFrames: 0, oversizeClinicalFrames: 1, truncated: true }, 'oversized');
  await expectFrameRefusal({ complete: false, unreadFrames: 1 }, 'unread');
  await expectFrameRefusal({ readerVersion: '2.9.19-chart-r2' }, 'legacy globally-bound');

  // A patient selection change during the AI parse cannot retarget the save.
  let finishParse;
  context._assistReadChart = () => Promise.resolve({ text: 'chart A raw', chartName: 'Alex Same', chartDob: '01/02/1970', chartMrn: '111', targetPatientId: 'same-a' });
  context._parsePatientChart = () => new Promise(resolve => { finishParse = resolve; });
  const single = context.pullPatientChartViaAssist(null, { patientId: 'same-a', name: 'Alex Same', dob: '01/02/1970', mrn: '111' });
  while (!finishParse) await Promise.resolve();
  activeId = 'same-b';
  finishParse(coveredChart({ problems: 'Only A problem', summary: 'Only A history' }));
  assert.strictEqual(await single, true, 'valid exact patient-A pull did not report a durable local save');
  assert(/Only A history/.test(patients.find(p => p.id === 'same-a').summary), 'patient A did not receive its verified history');
  assert(!/Only A history/.test(patients.find(p => p.id === 'same-b').summary), 'patient A history crossed into same-name patient B');
  assert.strictEqual(context._hasImportedHistory('Alex Same'), false, 'ambiguous name-only imported-history check was accepted');
  assert.strictEqual(context._hasImportedHistory(targetA), true, 'exact patient-A imported-history check missed the saved history');

  // Base bulk tally must increment only for the exact save that returned true.
  patients = patients.map(p => ({ ...p, problems: '', meds: '', allergies: '', summary: '', athenaChartSnapshot: '', athenaChartImportedAt: 0 }));
  notes = [];
  const baseSave = context._savePatientChart;
  context._assistReadChart = target => Promise.resolve({ text: target.patientId, chartName: target.name, chartDob: target.dob, chartMrn: target.mrn, targetPatientId: target.patientId });
  context._parsePatientChart = text => Promise.resolve(coveredChart({ problems: `problem-${text}`, summary: `history-${text}` }));
  context._savePatientChart = (ref, appt, chart) => ref.patientId === 'same-b' ? false : baseSave(ref, appt, chart);
  context.setTimeout = fn => { fn(); return 1; };
  context.clearTimeout = () => {};
  await context._pullAllHistories([
    { name: 'Alex Same', dob: '01/02/1970' },
    { name: 'Alex Same', dob: '03/04/1980' }
  ]);
  assert(/history-same-a/.test(patients.find(p => p.id === 'same-a').summary), 'bulk did not save the accepted exact target');
  assert(!/history-same-b/.test(patients.find(p => p.id === 'same-b').summary), 'bulk mutated the target whose exact save returned false');
  assert(/Refreshed 1 chart history/.test(heroPullStatus.textContent), 'bulk success tally was not limited to exact saves returning true');
  assert(/1 could not be identity-verified/.test(heroPullStatus.textContent), 'bulk did not report the refused duplicate-name save honestly');

  console.log('PASS duplicate-name history binding: reads and saves require immutable MLS id plus matching DOB/MRN proof');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
