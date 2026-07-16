'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_copilot_slim.js'), 'utf8');
const fetchCalls = [];
const context = {
  console,
  fetch(input, init) { fetchCalls.push({ input, init }); return Promise.resolve({ ok: true }); }
};
context.window = context;
vm.runInNewContext(source, context, { filename: 'feat_copilot_slim.js' });

const patients = [];
for (let i = 0; i < 35; i++) {
  patients.push({
    id: 'patient-' + i, patientId: 'stable-' + i, mrn: 'MRN-' + i,
    name: 'Synthetic Patient ' + i, dob: '1970-01-01',
    notes: [{ text: 'n'.repeat(3500) }],
    visits: [{ id: 'visit-' + i, painScore: i % 10, odiScore: 20 + i, text: 'v'.repeat(1200) }],
    outcomes: { baseline: { vas: i % 10 }, followup: { vas: (i + 2) % 10 } },
    procedureCount: i, visitsCount: i + 1
  });
}
const payload = {
  question: 'Compare outcomes',
  context: {
    activePatient: patients[0], patients,
    appointments: [
      { id: 'a-1', patientId: 'patient-1', date: '2026-07-16', time: '09:00', provider: null, status: 'booked', raw: 'x'.repeat(3000) },
      { id: 'a-2', patientId: 'patient-2', date: '2026-07-16', time: '10:00', provider: 'Dr Test', status: 'booked', raw: 'x'.repeat(3000) }
    ],
    practiceMetrics: { visitCount: 200, outcomeRate: 0.72 }
  },
  history: []
};
const original = JSON.stringify(payload);
assert(original.length > 20000);

context.fetch('https://example.test/api/copilot', { method: 'POST', body: original });
assert.strictEqual(fetchCalls.length, 1);
const packedText = fetchCalls[0].init.body;
const packed = JSON.parse(packedText);
assert(packedText.length < original.length, 'oversized Copilot context did not shrink');
assert.strictEqual(packed.context.patients.length, patients.length, 'context packing dropped patients');
assert.deepStrictEqual(Array.from(packed.context.patients, p => p.id), patients.map(p => p.id), 'stable patient IDs changed or disappeared');
assert.strictEqual(packed.context.patients[0].notes[0].text.length, 3500, 'active patient was not preserved in full');
assert.strictEqual(packed.context.patients[1].recordCounts.visits, 1, 'non-active patient visit count was lost');
assert.strictEqual(packed.context.patients[1].outcomes.baseline.vas, 1, 'structured outcome metric was lost');
assert(Object.values(packed.context.patients[1].metricScalars).includes(1), 'numeric patient metrics were not retained');
assert.strictEqual(packed.context.appointments.length, 2, 'appointment without a provider was destructively dropped');
assert.strictEqual(packed.context.appointments[0].id, 'a-1');
assert.strictEqual(packed.context.contextPacking.patientCountPreserved, 35);
assert.strictEqual(packed.context.contextPacking.structuredMetricsPreserved, true);
assert.strictEqual(packed.context.practiceMetrics.outcomeRate, 0.72, 'practice-wide metrics were changed');

const api = context.__mlsCopilotSlim;
assert.strictEqual(api.version, 'csp-2.1.0');
assert.strictEqual(api.samePatient({ patientId: 'p-7' }, { patientId: 'p-7' }, []), true, 'same-namespace stable ID did not match');
assert.strictEqual(api.samePatient({ mrn: '123' }, { id: '123' }, []), false, 'cross-namespace equal values were treated as identity');
assert.strictEqual(api.samePatient({ name: 'Alex Smith' }, { name: 'Alex Smith' }, [{ name: 'Alex Smith' }]), false, 'name-only fallback still binds active context');
const uniqueByDemographics = [{ name: 'Alex Smith', dob: '1980-02-03' }];
assert.strictEqual(api.samePatient(uniqueByDemographics[0], { name: ' alex  smith ', dob: '1980/02/03' }, uniqueByDemographics), true, 'exact unique name+DOB fallback did not match');
const ambiguous = [{ name: 'Alex Smith', dob: '1980-02-03' }, { name: 'Alex Smith', dob: '1980-02-03' }];
assert.strictEqual(api.samePatient(ambiguous[0], { name: 'Alex Smith', dob: '1980-02-03' }, ambiguous), false, 'ambiguous name+DOB fallback bound the wrong chart');
assert.strictEqual(api.samePatient({ id: 'A', mrn: '2' }, { id: 'A', mrn: '1' }, []), false, 'conflicting stable identifiers did not fail closed');

const nameOnlyPayload = JSON.parse(original);
nameOnlyPayload.context.activePatient = { name: 'Synthetic Patient 3' };
const nameOnlyPacked = JSON.parse(api.pack(JSON.stringify(nameOnlyPayload)));
assert.strictEqual(nameOnlyPacked.context.patients[3].notes, undefined, 'name-only active patient retained another chart in full');

console.log('PASS Copilot context pack: IDs/counts/metrics survive and active binding requires same-namespace ID or unique exact name+DOB');
