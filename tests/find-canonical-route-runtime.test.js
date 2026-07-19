'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_fixpack_0701.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
assert(connect.includes('feat_mls_fixpack_0701.js') && connect.includes('?v=20260719fp111'),
  'canonical Find fix is not loaded through a fresh immutable asset URL');
assert(!connect.includes('?v=20260716fp110'), 'retired unsafe Find asset URL is still loadable');
new Function(source);

const start = source.indexOf('/* __MLS_QF_CANONICAL_START__ */');
const end = source.indexOf('/* __MLS_QF_CANONICAL_END__ */', start);
assert(start >= 0 && end > start, 'canonical Find patient router is missing');
const routerSource = source.slice(start, end);

assert(source.includes("go: function () { return qfPatientRoute(p, patientSession); }"),
  'Find patient results do not delegate to the canonical ID router');
assert(source.includes("listen(window, 'mls:session-boundary'"),
  'Find does not invalidate account-owned results at a session boundary');
assert(/if \(it\.go\(\) === false\) return false;[\s\S]*qfClose\(\)/.test(source),
  'Find closes before a failed result can explain the block');
assert(!/var inp = \$\('heroPtName'\);[\s\S]{0,180}inp\.dispatchEvent/.test(
  source.slice(source.indexOf('/* patients -> select'), source.indexOf('return out;', source.indexOf('/* patients -> select')))
), 'the retired hero-name-only patient selection survived');

function harness(options) {
  options = options || {};
  const patients = options.patients || [
    { id: 'A', name: 'Prior Patient', dob: '1970-01-01' },
    { id: 'B', name: 'Target Patient', dob: '1980-02-02' }
  ];
  let activeId = options.activeId == null ? 'A' : options.activeId;
  const failures = [], toasts = [], order = [];
  const elements = {
    heroPtName: { value: '' },
    heroPtDob: { value: '' }
  };
  const window = {
    __mlsSessionAccount: options.account || 'doctor@example.test',
    __mlsSessionEpoch: options.epoch == null ? 7 : options.epoch,
    __mlsCurrentView: options.view || 'calendar',
    getSessionEmail() { return this.__mlsSessionAccount; },
    getPatients() { return patients; },
    getActivePtId() { return activeId; },
    activePatient() { return patients.find(p => String(p.id) === String(activeId)) || null; },
    showView(view) {
      order.push('view:' + view);
      if (options.throwView) throw new Error('route failed');
      this.__mlsCurrentView = view;
    },
    renderPatientBar() { order.push('render-bar'); },
    _heroSyncName() { order.push('hero-sync'); }
  };
  if (!options.noOpenApi) {
    window.openPatient = function (id) {
      order.push('open:' + id);
      if (options.throwOpen) throw new Error('open failed');
      if (!options.openNoop) activeId = String(id);
    };
  }
  if (options.selectFallback) {
    delete window.openPatient;
    window.selectPatient = function (id) { order.push('select:' + id); activeId = String(id); };
  }
  const context = {
    window,
    String,
    Number,
    isFinite,
    qfFail(message) { failures.push(String(message)); return false; },
    $(id) { return elements[id] || null; },
    safeToast(message, kind) { toasts.push({ message, kind }); }
  };
  vm.createContext(context);
  vm.runInContext(`${routerSource}\nthis.qfPatientRoute = qfPatientRoute; this.qfSessionContext = qfSessionContext;`, context,
    { filename: 'feat_mls_fixpack_0701.js#canonical-find' });
  return { context, window, patients, failures, toasts, order, elements, activeId: () => activeId };
}

{
  const h = harness();
  const expected = h.context.qfSessionContext();
  assert.strictEqual(h.context.qfPatientRoute(h.patients[1], expected), true,
    'exact current patient did not route');
  assert.deepStrictEqual(h.order.slice(0, 2), ['open:B', 'view:visit'],
    'Find did not select through the canonical patient API before routing');
  assert.strictEqual(h.activeId(), 'B', 'the previous active patient survived selection');
  assert.strictEqual(h.window.activePatient(), h.patients[1], 'activePatient disagrees with the selected result');
  assert.strictEqual(h.window.__mlsCurrentView, 'visit', 'Find did not route to the canonical Visit screen');
  assert.strictEqual(h.elements.heroPtName.value, 'Target Patient', 'Visit name did not mirror the canonical selected chart');
  assert.strictEqual(h.elements.heroPtDob.value, '1980-02-02', 'Visit DOB did not mirror the canonical selected chart');
  assert.deepStrictEqual(h.failures, [], 'successful exact selection reported a failure');
  assert(h.toasts.some(t => /Target Patient/.test(t.message)), 'successful selection did not confirm the canonical patient');
}

{
  const h = harness({ selectFallback: true });
  assert.strictEqual(h.context.qfPatientRoute(h.patients[1], h.context.qfSessionContext()), true,
    'selectPatient fallback did not route');
  assert.deepStrictEqual(h.order.slice(0, 2), ['select:B', 'view:visit']);
  assert.strictEqual(h.activeId(), 'B');
}

{
  const h = harness();
  assert.strictEqual(h.context.qfPatientRoute({ name: 'No Stable Id' }, h.context.qfSessionContext()), false);
  assert.strictEqual(h.activeId(), 'A', 'missing-ID result changed the prior active chart');
  assert.deepStrictEqual(h.order, [], 'missing-ID result invoked a selection or route action');
  assert(/stable chart ID/i.test(h.failures[0]), 'missing-ID block was not explained');
}

{
  const duplicate = [
    { id: 'A', name: 'Prior Patient' },
    { id: 'B', name: 'Target Patient' },
    { id: 'B', name: 'Conflicting Duplicate' }
  ];
  const h = harness({ patients: duplicate });
  assert.strictEqual(h.context.qfPatientRoute(duplicate[1], h.context.qfSessionContext()), false);
  assert.strictEqual(h.activeId(), 'A', 'ambiguous ID changed the active chart');
  assert.deepStrictEqual(h.order, [], 'ambiguous ID invoked a selection or route action');
  assert(/uniquely available/i.test(h.failures[0]), 'ambiguous-ID block was not explained');
}

{
  const h = harness();
  const stale = h.context.qfSessionContext();
  h.window.__mlsSessionAccount = 'other@example.test';
  h.window.__mlsSessionEpoch = 8;
  assert.strictEqual(h.context.qfPatientRoute(h.patients[1], stale), false,
    'an account-owned stale result crossed the session boundary');
  assert.strictEqual(h.activeId(), 'A', 'stale account result changed the active chart');
  assert.deepStrictEqual(h.order, [], 'stale account result invoked a selection or route action');
  assert(/account changed/i.test(h.failures[0]), 'account-switch block was not explained');
}

{
  const h = harness({ openNoop: true });
  assert.strictEqual(h.context.qfPatientRoute(h.patients[1], h.context.qfSessionContext()), false,
    'a canonical API no-op was treated as a successful selection');
  assert.strictEqual(h.activeId(), 'A');
  assert.deepStrictEqual(h.order, ['open:B'], 'Visit routed despite failed identity verification');
  assert(/could not verify the selected chart/i.test(h.failures[0]));
}

console.log('PASS Find canonical route: exact stable ID selects before Visit; stale, missing, duplicate, and unverified identities fail closed');
