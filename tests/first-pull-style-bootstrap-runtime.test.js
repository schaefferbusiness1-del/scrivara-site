/* First full Athena pull -> PHI-free starter formats.
 * Runs the real isolated module with a synthetic visit model and proves the
 * completion event carries no note text, only verified rows are considered,
 * existing custom formats are preserved, and the account marker contains no
 * patient content. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_first_pull_style.js'), 'utf8');

function makeHarness({ custom = false, pending = false } = {}) {
  const store = new Map();
  const listeners = {};
  const updates = [];
  let fetchCalls = 0;
  const patient = { id: 'p-qa', name: 'Jane Example', provider: 'Dr. Test' };
  const visit = {
    id: 'v-1', date: '2026-08-20', identityVerified: true, identityBinding: 'p-qa',
    fullDetail: true, bodyComplete: true, indexOnly: false,
    raw: 'Patient: Jane Example\nHPI:\nPatient reports low back pain for 3 days.\nROS:\nMusculoskeletal: denies weakness.\nEXAM:\nGait: normal.\nASSESSMENT:\nLumbar pain.\nPLAN:\nContinue therapy.'
  };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    uns: k => 'acct::' + k,
    findPatient: id => id === patient.id ? patient : null,
    __mlsVisitModel: { getVisits: p => p.id === patient.id ? [visit, { ...visit, id: 'bad', identityVerified: false, raw: 'HPI: BAD UNVERIFIED FACT' }] : [] },
    __mlsDraftTuning: {
      defaults: () => ({ families: Object.fromEntries(['hpi', 'ros', 'exam', 'assessment', 'plan'].map(f => [f, { profiles: [{ id: 'standard', label: 'Standard ' + f.toUpperCase(), when: 'Most visits', instructions: 'Built-in guidance', templateText: '' }] }])) }),
      profileEditor: family => ({
        list: () => [{ id: 'standard', templateText: custom ? 'KEEP CUSTOM' : '', instructions: custom ? 'KEEP CUSTOM' : '' }],
        update: (id, changes) => { updates.push({ family, id, changes }); return true; }
      }),
      read: () => ({ families: Object.fromEntries(['hpi', 'ros', 'exam', 'assessment', 'plan'].map(f => [f, { profiles: [{ id: 'standard', label: 'Standard ' + f.toUpperCase(), when: 'Most visits', templateText: custom ? 'KEEP CUSTOM' : '', instructions: custom ? 'KEEP CUSTOM' : 'Built-in guidance' }] }])) })
    },
    bkBase: () => 'https://api.test',
    bkToken: () => 'token',
    fetch: async () => { fetchCalls += 1; throw new Error('first-pull examples must never use the network'); },
    toast: (msg, kind) => { context.toastSeen = { msg, kind }; },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    dispatchEvent: ev => { (listeners[ev.type] || []).forEach(fn => fn(ev)); },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; }
  };
  context.window = context;
  if (pending) store.set('acct::firstPullStylePendingV1', JSON.stringify({ patientId: patient.id, saved: 1, at: Date.now() }));
  vm.createContext(context);
  vm.runInContext(source, context, { filename: '1p-feat_mls_first_pull_style.js' });
  return { context, store, updates, patient, fetchCalls: () => fetchCalls, dispatch: () => context.dispatchEvent(new context.CustomEvent('mls:athena-full-history-pull-complete', { detail: { patientId: patient.id, saved: 1 } })) };
}

(async () => {
  const h = makeHarness();
  h.dispatch();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(h.updates.length, 5, 'all five clinical starter formats were not created');
  assert.ok(h.updates.every(x => x.changes.templateText.includes('[')), 'starter template lacks a neutral placeholder');
  assert.ok(h.updates.every(x => /^Learned [A-Z]+ format$/.test(x.changes.label)), 'model-authored format name reached durable settings');
  assert.ok(h.updates.every(x => !x.changes.instructions.includes('Model prose')), 'model-authored instructions reached durable settings');
  assert.ok(!Array.from(h.store.values()).join('\n').includes('low back pain'), 'patient clinical facts leaked into account marker');
  assert.ok(!Array.from(h.store.values()).join('\n').includes('Jane Example'), 'patient name leaked into account marker');
  assert.equal(h.fetchCalls(), 0, 'a prior clinical note crossed the network boundary');
  assert.ok(!JSON.stringify(h.context.__mlsFirstPullStyle._examples('p-qa')).includes('low back pain'), 'safe skeleton API exposed clinical prose');
  assert.ok(!JSON.stringify(h.context.__mlsFirstPullStyle._examples('p-qa')).includes('Jane Example'), 'safe skeleton API exposed patient identity');
  assert.equal(h.context.toastSeen.kind, 'ok', 'successful bootstrap did not provide a visible completion receipt');
  const again = h.context.__mlsFirstPullStyle.bootstrap({ patientId: 'p-qa' });
  assert.equal((await again).reason, 'already-bootstrapped', 'first-pull marker did not prevent duplicate re-bootstrap');

  const concurrent = makeHarness();
  concurrent.dispatch();
  concurrent.dispatch();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(concurrent.updates.length, 5, 'near-simultaneous completion events wrote starter formats more than once');

  const custom = makeHarness({ custom: true });
  custom.dispatch();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(custom.updates.length, 0, 'existing clinician format was overwritten');

  const local = makeHarness();
  local.dispatch();
  await new Promise(r => setTimeout(r, 10));
  assert.equal(local.updates.length, 5, 'local safe fallback did not create all five formats');
  assert.ok(local.updates.every(x => /DOCUMENTED|not documented/i.test(x.changes.templateText)), 'fallback contains patient-specific prose');
  assert.equal(local.context.__mlsFirstPullStyle._safeDerived('hpi', { name: 'Unsafe', templateText: 'HPI:\n[PRESENTING CONCERN]\nLumbar pain', instructions: 'Preserve documented source facts.' }, 'HPI:\nLumbar pain for 3 days.'), null, 'AI-derived template accepted source-specific clinical prose');
  assert.equal(local.context.__mlsFirstPullStyle._safeDerived('hpi', { name: 'Unsafe', templateText: 'HPI:\n[PRESENTING CONCERN]\nCervical radiculopathy', instructions: 'Preserve documented source facts.' }, 'HPI:\nLumbar pain for 3 days.'), null, 'AI-derived template accepted hallucinated clinical prose absent from the source');

  const replay = makeHarness({ pending: true });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(replay.updates.length, 5, 'late-loaded module did not replay the durable full-pull receipt');
  assert.equal(replay.store.has('acct::firstPullStylePendingV1'), false, 'handled full-pull receipt was not cleared');
  assert.equal(replay.fetchCalls(), 0, 'late replay sent prior clinical text over the network');
  console.log('PASS first-pull-style bootstrap: verified prior notes seed five local-only PHI-free starter formats, custom settings win, network use is zero, duplicate runs are locked, late receipts replay, and completion is visible');
})().catch(err => { console.error(err); process.exitCode = 1; });
