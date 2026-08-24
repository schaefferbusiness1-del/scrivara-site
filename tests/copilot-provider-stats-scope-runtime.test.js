'use strict';

/* Copilot providerStats are practice-wide evidence. They must not be attached
 * to an active-patient request, while practice-scoped requests retain them. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const start = source.indexOf('/* =========================================================================\n * MLS Scribe - COPILOT PROVIDER-DATA GROUNDING');
const iifeStart = source.indexOf('(function () {', start);
const end = source.indexOf('\n\n\n/* =========================================================================', iifeStart);
assert(start >= 0 && iifeStart > start && end > iifeStart, 'Copilot providerStats wrapper boundary moved');

const sent = [];
const window = {
  fetch(input, init) {
    sent.push({ input, init });
    return Promise.resolve({ ok: true, status: 200 });
  },
  _calAppts: [{ name: 'Synthetic Patient', provider: 'Synthetic Clinician', day_local: '2026-08-23', reason: 'follow-up' }],
  getPatients: () => []
};
const sandbox = { window, _calAppts: window._calAppts, Promise, Date, JSON, Math, Object, Array, String, Number, RegExp, console };
vm.createContext(sandbox);
vm.runInContext(source.slice(iifeStart, end), sandbox, { filename: 'copilot-provider-stats-scope.js' });
assert(window.__mlsCopilotData, 'Copilot providerStats wrapper did not install');

async function main() {
  const activeBody = { requestScope: 'active-patient', context: { requestScope: 'active-patient', activePatient: { id: 'synthetic-1' } } };
  await window.fetch('/api/copilot', { method: 'POST', body: JSON.stringify(activeBody) });
  const activeSent = JSON.parse(sent.pop().init.body);
  assert.strictEqual(activeSent.context.providerStats, undefined,
    'active-patient request received practice-wide providerStats');
  assert.deepStrictEqual(activeSent.context.activePatient, { id: 'synthetic-1' },
    'active-patient context was changed while suppressing providerStats');

  const practiceBody = { requestScope: 'practice', context: { requestScope: 'practice' } };
  await window.fetch('/api/copilot', { method: 'POST', body: JSON.stringify(practiceBody) });
  const practiceSent = JSON.parse(sent.pop().init.body);
  assert(practiceSent.context.providerStats && typeof practiceSent.context.providerStats === 'object',
    'practice-scoped request lost providerStats enrichment');

  const nestedActive = { context: { requestScope: 'active-patient', activePatient: { id: 'synthetic-2' } } };
  await window.fetch('/api/copilot', { method: 'POST', body: JSON.stringify(nestedActive) });
  const nestedSent = JSON.parse(sent.pop().init.body);
  assert.strictEqual(nestedSent.context.providerStats, undefined,
    'nested active-patient request received practice-wide providerStats');

  console.log('PASS Copilot providerStats scope runtime: active-patient suppression and unchanged practice enrichment');
}

main().catch(error => { console.error(error); process.exit(1); });
