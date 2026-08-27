'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '1pScribeFlow.html'), 'utf8');
const start = source.indexOf('function _mlsGenerationFieldText(');
const end = source.indexOf('\n/* A chart can contain years', start);
assert(start >= 0 && end > start, 'generation profile-context runtime not found');

const patient = {
  name: 'Synthetic Patient',
  problems: [
    'Synthetic lumbar pain',
    { name: 'Synthetic knee pain', code: 'TEST-1' }
  ],
  meds: [{ name: 'Synthetic medication', dose: 'test dose' }],
  allergies: { status: 'Synthetic allergy status' },
  summary: ['Synthetic prior history only']
};
const context = {
  activePatient: () => patient,
  getContext: () => '',
  document: { getElementById: id => id === 'contextBox' ? { value: '' } : null },
  currentVisitAthenaBinding: null,
  console
};
vm.createContext(context);
vm.runInContext(source.slice(start, end) + '\nthis.result=buildPatientContext();', context);

assert(context.result.includes('Synthetic lumbar pain'), 'string problem was lost');
assert(context.result.includes('Synthetic knee pain'), 'structured problem was lost');
assert(context.result.includes('Synthetic medication'), 'structured medication was lost');
assert(context.result.includes('Synthetic allergy status'), 'structured allergy was lost');
assert(context.result.includes('Synthetic prior history only'), 'structured summary was lost');
assert(!context.result.includes('[object Object]'), 'structured chart data leaked as [object Object]');
assert(!source.slice(start, end).includes('p.problems.trim()'), 'unsafe direct problem trim returned');

console.log('generation structured-profile unlinked runtime: PASS');
