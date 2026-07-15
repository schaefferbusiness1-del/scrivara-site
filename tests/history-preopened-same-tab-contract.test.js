'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

const chartBridge = between(content, "if (d.type === 'mlsAppReadChart')", '/* v1.89: READ-ONLY');
const visitsBridge = between(content, "if (d.type === 'mlsAppReadVisits')", '// READ-ONLY: read the open Athena REPORT');
const chartHandler = between(background, "if (msg.type === 'mlsAppChartRequest')", '/* ---- v1.51: read the OPEN athena chart');
const allVisits = between(background, 'function pickEmrTab(hint)', '// --- v1.40: publish the PROVEN read-all-visits engine');

assert(chartBridge.includes("type: 'mlsAppSearchOpenRequest'"), 'named chart reads bypass the exact DOB-gated opener');
assert(chartBridge.indexOf("type: 'mlsAppSearchOpenRequest'") < chartBridge.indexOf('readPreopenedChart();'), 'chart read starts before exact SearchOpen succeeds');
assert(chartBridge.includes('if (openErr || !opened || !opened.opened)'), 'failed or ambiguous SearchOpen can still proceed to a chart read');
assert(chartBridge.includes('chartMessage.preopened = true'), 'successful SearchOpen does not mark the exact chart as preopened');
assert(chartBridge.includes('patientDob: chartDob') && chartBridge.includes('patientMrn: chartMrn') && chartBridge.includes('patientId: mlsStr(d.patientId'), 'the immutable chart identity is not carried through the preopened read');

assert(visitsBridge.includes('patient: visitPatient, patientDob: visitDob, patientMrn: visitAthenaId, preopened: true'), 'Visits recovery settles an unbound/bare chart instead of the exact opened patient');

assert(chartHandler.includes("const preopened = msg.preopened === true"), 'background does not recognize the exact preopened contract');
assert(chartHandler.includes('chrome.tabs.get(Number(lease.tabId))'), 'preopened chart read generically re-picks an Athena tab');
assert(chartHandler.includes("reason: 'preopened-tab-unverified'"), 'missing/stale exact-tab receipt does not fail closed');
assert(chartHandler.includes('if (want && !preopened)'), 'preopened chart is still sent through the generic schedule/name clicker');
assert(chartHandler.includes('self.__mlsVerifiedReadTarget = { tabId: tab.id'), 'a complete chart receipt does not lease its exact tab to AllVisits');
assert(!chartHandler.includes('chrome.tabs.update(tab.id, { active: true })'), 'history chart reads reintroduced tab focus yanking');
assert(background.includes("r = Object.assign({}, r, { frameId: m.frameId })"), 'shadow/light-DOM identity lost its exact frame provenance');
assert(chartHandler.includes("identityFrameResults.push({ frameId: sIdent.frameId, result: sIdent })"), 'shadow banner identity is not bound to its supplying clinical frame');
assert(chartHandler.includes('globalframeset\\.esp|globaliframe\\.esp|framecontent\\.esp'), 'Athena wrapper frames can still be misclassified as unbound clinical frames');

assert(allVisits.includes('pickEmrTab(frozenHint)'), 'AllVisits does not use its frozen identity to select the exact tab lease');
assert(allVisits.includes('self.__mlsVerifiedReadTarget'), 'AllVisits ignores the verified chart tab lease');
assert(allVisits.includes('Number(t.id) === Number(lease.tabId)'), 'AllVisits can silently switch to another Athena tab');
assert(allVisits.includes('var gate = visitIdentityGate(frozenHint, identity)'), 'same-frame name+DOB/MRN gate was removed');

console.log('PASS history exact-open -> same-tab chart -> same-tab visits contract');
