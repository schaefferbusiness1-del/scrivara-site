'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');

const session = app.slice(app.indexOf('function startSession(email)'), app.indexOf('function logout(force)'));
assert.strictEqual((session.match(/refreshMe\(_startupOpts\)/g) || []).length, 1, 'startup must issue exactly one identity/hydration pass');
assert(session.includes('Promise.all([') && session.includes('_identityReady.then(()=>checkAgreementsGate(_startupOpts))'), 'agreement readiness must follow canonical identity while data hydrates in the same startup batch');
assert(session.includes('_startupOpts.cancelled=true') && session.includes('_startupController.abort()'), 'startup deadline must cancel late network results');
assert(session.includes('},7200)') && session.includes('window.__mlsSessionReady=_sessionReady'), 'startup must expose a bounded readiness promise');

const refresh = app.slice(app.indexOf("var _refreshMeInFlight=null"), app.indexOf('function handle401()'));
assert(refresh.includes('if(_refreshMeInFlight&&_refreshMeToken===token)'), 'identity refresh requests are not coalesced');
assert(refresh.includes('await Promise.allSettled(['), 'patient, record, and preference hydration is still fire-and-forget');
assert(refresh.includes('loadPatientsFromServer(childOpts)') && refresh.includes('loadRecordsFromServer(childOpts)') && refresh.includes('loadPrefsFromServer(childOpts)'), 'a startup store is missing from the hydration barrier');
assert(refresh.includes("deferRender:true") && refresh.includes("window.__mlsUiUnification.reconcile"), 'startup data must reconcile once beneath the loader');

for (const fn of ['loadPrefsFromServer(opts)', 'loadPatientsFromServer(opts)', 'loadRecordsFromServer(opts)']) {
  assert(app.includes('async function ' + fn), fn + ' does not accept the shared startup signal');
}
assert((app.match(/if\(opts\.signal\) init\.signal=opts\.signal/g) || []).length >= 5, 'not every startup request is abortable');
const gate = app.slice(app.indexOf('async function checkAgreementsGate(opts)'), app.indexOf('async function agBuildReceiptPdf'));
assert(!gate.includes('showAgreementsGate()'), 'agreement lookup must return a decision instead of bypassing loader timing');
assert(gate.includes('if(!sfStartupValid(opts)) return false'), 'late agreement responses can still change the handoff');

console.log('PASS startup hydration: one abortable batch, all stores settled, one reconciliation, and loader-owned legal handoff');
