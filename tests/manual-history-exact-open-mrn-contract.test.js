'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const visits = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing start marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

const manualRun = between(visits, 'function run(onStatus, patientOverride, runOpts)', 'function ensureAndDone');
const chartBridge = between(content, "if (d.type === 'mlsAppReadChart')", '/* v1.89: READ-ONLY');
const visitsBridge = between(content, "if (d.type === 'mlsAppReadVisits')", '// READ-ONLY: read the open Athena REPORT');
const genericOpenBridge = between(content, '/* (2) Search-and-navigate relay', '/* =========================================================================\n * MLS Assist v1.50');
const findDriver = between(background, 'async function mlsFindPatientOpenDriverFn', "chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse)");
const searchHandler = between(background, "if (msg.type === 'mlsAppSearchOpenRequest')", '// not ours — let other listeners handle it');
const allVisits = between(background, 'function runAllVisits(appTabId, hint, cfg, requestId, callerDeadlineAt)', '// --- v1.40: publish the PROVEN read-all-visits engine');

// The profile button must establish a fresh exact-chart receipt before asking
// the encounter reader to touch the Visits UI.
assert(manualRun.includes('_athenaHistoryTargetSnapshot'), 'manual copy does not freeze an exact local patient target');
assert(manualRun.includes('window._assistReadChart(targetRef'), 'manual copy bypasses the proven exact-chart opener/reader');
assert(manualRun.indexOf('window._assistReadChart(targetRef') < manualRun.indexOf("'mlsAppReadAllVisits'"), 'AllVisits starts before exact-chart proof completes');
assert(manualRun.includes('chartReceipt.targetPatientId') && manualRun.includes('targetRef.patientId'), 'manual copy does not bind the chart receipt back to the frozen patient id');
assert(manualRun.includes("name: targetRef.name, dob: targetRef.dob, mrn: targetRef.mrn"), 'manual AllVisits hint is not derived from the frozen exact target');
assert(manualRun.includes('patientMrn: targetRef.mrn') && manualRun.includes('patientId: targetRef.patientId'), 'legacy/basic chart fallback became an unbound chart read');

// MRN must survive both exact-open bridges and the background handoff.
assert(chartBridge.includes("type: 'mlsAppSearchOpenRequest', name: chartPatient, dob: chartDob, mrn: chartMrn"), 'chart SearchOpen drops the frozen MRN');
assert(visitsBridge.includes("type: 'mlsAppSearchOpenRequest', name: visitPatient, dob: visitDob, mrn: visitAthenaId"), 'Visits recovery SearchOpen drops the frozen MRN');
assert(genericOpenBridge.includes('mrn: mrnHint'), 'generic SearchOpen bridge drops its MRN hint');
assert(findDriver.startsWith('async function mlsFindPatientOpenDriverFn(name, dob, requestGuard, mrn)'), 'findpatient driver does not accept a separate immutable guard and MRN');
assert(findDriver.includes('deadline: Number(__guardArg.deadline || 0)') && findDriver.includes('token: String(__guardArg.token || \'\')'), 'findpatient driver does not freeze the action guard');
assert(findDriver.includes('var wantMrn = nrmMrn(mrn)'), 'findpatient driver does not freeze/normalize MRN');
assert(findDriver.includes('exactResultRow(tr)'), 'Find must prove the row first/last+DOB pair');

// MRN may narrow only candidates that already survived name tier + DOB veto.
assert(findDriver.includes('dates.length===1&&mlsExactIdentityPair'), 'Find must require exact valid DOB on the row');
assert(findDriver.includes('if(pool.length!==1)'), 'duplicate exact first/last+DOB pairs must refuse');
assert(!findDriver.includes('var mrnPool = pool.filter'), 'a stale caller MRN must not choose among ambiguous pairs');
assert(findDriver.includes('exactResultRow(_rvTr).ok'), 'the same exact pair must be reverified immediately before the Chart click');

assert(searchHandler.includes("var frozenMrn = String(msg.mrn || msg.patientMrn || msg.athenaId || '')"), 'SearchOpen does not freeze the incoming MRN');
assert(searchHandler.includes("frozenMrn ? ['find', 'sched']"), 'MRN-backed opens can still prefer the name-only schedule clicker');
const driverCalls = searchHandler.match(/args: \[[^\]]*\], func: mlsFindPatientOpenDriverFn/g) || [];
assert.strictEqual(driverCalls.length, 2, 'only the ordinary and compound-name Find routes may remain');
assert(driverCalls.every(call => call.includes('findGuard, frozenMrn')), 'findpatient routes do not keep the action guard and MRN in separate argument slots');
assert(driverCalls.every(call => call.includes("msg.dob || ''")), 'a Find retry must never remove the requested DOB');
assert(!searchHandler.includes('dobOverride: true'), 'a contradictory DOB must never be overridden');
assert(searchHandler.includes('mrn: frozenMrn, tabId: tab.id'), 'the verified-open/write target leases drop MRN');
assert(searchHandler.includes('matching DOB or MRN to disambiguate'), 'ambiguous picker wording still claims DOB is the only discriminator');

assert(allVisits.includes('No exact-patient athenaOne chart or fresh verified chart lease was proved.'), 'AllVisits no-target error still misdiagnoses a missing exact chart as logout');
assert(!allVisits.includes('No signed-in athenaOne tab found. Open athenaOne with the patient chart'), 'misleading signed-out history error remains');

console.log('PASS manual history exact-open + MRN discriminator contract');
