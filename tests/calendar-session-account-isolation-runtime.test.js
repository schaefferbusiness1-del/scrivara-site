'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function read(name) {
  return fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
}

function sliceCalendar(source, name) {
  const start = source.indexOf('var _calYear=null, _calMonth=null, _calAppts=[]');
  const end = source.indexOf('function _calFilterVal()', start);
  assert(start >= 0 && end > start, `${name}: calendar runtime could not be bounded`);
  return source.slice(start, end);
}

function response(data) {
  return { status: 200, ok: true, json: async () => data };
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function fakeNode() {
  return { innerHTML: '', value: '', style: { display: '' } };
}

async function runPage(name) {
  const html = read(name);
  const boundaryStart = html.indexOf('function sfResetSessionBoundary(');
  const boundaryEnd = html.indexOf('function startSession(', boundaryStart);
  const boundary = html.slice(boundaryStart, boundaryEnd);
  assert(boundary.indexOf('_calResetForSession(next,sfSessionUiEpoch)') >= 0, `${name}: session boundary does not reset calendar ownership`);
  assert(boundary.indexOf('_athenaSetVisitBinding(null,true)') >= 0, `${name}: session boundary does not clear the visit binding`);
  assert(boundary.indexOf('_calResetForSession(next,sfSessionUiEpoch)') < boundary.indexOf("window.dispatchEvent(new CustomEvent('mls:session-boundary'"), `${name}: clinical state is reset after the public boundary event`);
  const startSession = html.slice(boundaryEnd, html.indexOf('\nfunction logout(', boundaryEnd));
  assert(startSession.indexOf('sfResetSessionBoundary(email') < startSession.indexOf("document.getElementById('appScreen').style.display='block'"), `${name}: Account B can be revealed before Account A is cleared`);

  const nodes = {
    calGrid: fakeNode(), calDayPanel: fakeNode(), calCheckinWrap: fakeNode(), calProvFilter: fakeNode()
  };
  const pending = [];
  let token = 'token-a';
  let renders = 0;
  const events = [];
  const storage = new Map();
  const context = {
    console, Date, Intl,
    __mlsSessionAccount: 'doctor-a@example.test', __mlsSessionEpoch: 1,
    __mlsCalLoadSeq: 0, __mlsCalendarMutationEpoch: 0,
    session: { email: 'doctor-a@example.test' },
    document: { getElementById(id) { return nodes[id] || null; } },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    dispatchEvent(event) { events.push(event); },
    backendMode() { return true; }, bkToken() { return token; }, bkBase() { return 'https://api.example.test'; },
    getSessionEmail() { return this.__mlsSessionAccount; },
    _acctTodayKey() { return '2026-07-19'; },
    uns(key) { return `${this.__mlsSessionAccount}::${key}`; },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    fetch(url, options) {
      const wait = deferred();
      pending.push({ url: String(url), auth: options && options.headers && options.headers.Authorization, wait });
      return wait.promise;
    },
    renderCalendar() { renders += 1; }, renderCalCheckin() { renders += 1; },
    handle401() { throw new Error('stale request called handle401'); },
    _SF_DEMO: false
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(sliceCalendar(html, name), context, { filename: `${name}-calendar.js` });

  vm.runInContext(`
    _calResetForSession('doctor-a@example.test',1);
    _calAppts=[{id:'A-ROW',name:'Account A Patient',appt_date:'2026-07-22',provider:'Account A Provider'}];
    _calProviders=[{id:'A-PROV',name:'Account A Provider'}];
    window._calAppts=_calAppts; window._calProviders=_calProviders;
  `, context);
  const oldLoad = context.loadCalendar();
  assert.strictEqual(pending.length, 2, `${name}: Account A calendar read did not start both requests`);
  assert(pending.every(item => item.auth === 'Bearer token-a'), `${name}: Account A request did not retain its captured token`);

  // Match real startSession ordering: the explicit next identity is published,
  // clinical state is reset, and only then can the rest of B initialize.
  context.__mlsSessionAccount = 'doctor-b@example.test';
  context.__mlsSessionEpoch = 2;
  context.session = { email: 'doctor-b@example.test' };
  token = 'token-b';
  context._calResetForSession('doctor-b@example.test', 2);
  assert.deepStrictEqual(Array.from(context._calAppts), [], `${name}: Account A appointments survived the synchronous boundary`);
  assert.deepStrictEqual(Array.from(context._calProviders), [], `${name}: Account A providers survived the synchronous boundary`);
  assert.strictEqual(context._calRefDate, null, `${name}: Account A selected date survived the synchronous boundary`);
  assert.strictEqual(nodes.calDayPanel.innerHTML, '', `${name}: Account A day panel survived the synchronous boundary`);
  assert.strictEqual(nodes.calProvFilter.value, '', `${name}: Account A provider selection survived the synchronous boundary`);

  pending[0].wait.resolve(response({ appointments: [{ id: 'A-LATE', name: 'Late Account A Patient', appt_date: '2026-07-23', provider: 'Account A Provider' }], me: { id: 'A' } }));
  pending[1].wait.resolve(response({ providers: [{ id: 'A-PROV-LATE', name: 'Late Account A Provider' }] }));
  const oldResult = await oldLoad;
  assert.strictEqual(oldResult.applied, false, `${name}: late Account A response was applied`);
  assert.strictEqual(oldResult.discarded, 'session_changed', `${name}: late Account A response lacked an account-bound discard receipt`);
  assert.strictEqual(context._calAppts.length, 0, `${name}: late Account A patient repainted Account B`);
  assert.strictEqual(context._calProviders.length, 0, `${name}: late Account A provider repainted Account B`);

  const bLoad = context.loadCalendar();
  assert.strictEqual(pending.length, 4, `${name}: Account B calendar read did not start`);
  assert(pending.slice(2).every(item => item.auth === 'Bearer token-b'), `${name}: Account B request used Account A credentials`);
  pending[2].wait.resolve(response({ appointments: [{ id: 'B-ROW', name: 'Account B Patient', appt_date: '2026-07-24', provider: 'Account B Provider' }], me: { id: 'B' } }));
  pending[3].wait.resolve(response({ providers: [{ id: 'B-PROV', name: 'Account B Provider' }] }));
  const bResult = await bLoad;
  assert.strictEqual(bResult.applied, true, `${name}: current Account B response was not applied`);
  assert.deepStrictEqual(Array.from(context._calAppts, row => row.name), ['Account B Patient']);
  assert.deepStrictEqual(Array.from(context._calProviders, row => row.name), ['Account B Provider']);
  assert(!JSON.stringify(context._calAppts).includes('Account A'), `${name}: Account A patient remains after B hydration`);
  assert(!JSON.stringify(context._calProviders).includes('Account A'), `${name}: Account A provider remains after B hydration`);
  assert(renders >= 2, `${name}: current Account B calendar did not render`);
  assert(events.some(event => event.type === 'mls:calendar-session-reset' && event.detail.account === 'doctor-b@example.test'), `${name}: calendar reset signal was not account-bound`);
}

(async () => {
  await runPage('ScribeFlow.html');
  await runPage('ScribeFlow-staging.html');
  console.log('PASS calendar session ownership: A -> logout -> B clears rows/providers/date synchronously and late A responses cannot repaint B');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
