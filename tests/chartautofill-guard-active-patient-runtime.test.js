'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_chartautofill_guard.js'), 'utf8');

class Field {
  constructor(id, value) {
    this.id = id;
    this.value = value;
    this.events = [];
  }
  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }
}

const fields = {
  heroPtName: new Field('heroPtName', 'Synthetic Reliability Patient'),
  patientLabel: new Field('patientLabel', 'Synthetic Reliability Patient')
};
let selected = { id: 'pt-1', name: 'Synthetic Reliability Patient' };
let nextTimer = 1;
const timers = new Map();
const document = {
  activeElement: null,
  getElementById(id) { return fields[id] || null; }
};
class FakeEvent {
  constructor(type, options) {
    this.type = type;
    this.bubbles = !!(options && options.bubbles);
  }
}
const window = {
  activePatient() { return selected; }
};
const context = {
  window,
  document,
  Event: FakeEvent,
  setInterval(fn) {
    const id = nextTimer++;
    timers.set(id, fn);
    return id;
  },
  clearInterval(id) { timers.delete(id); }
};
vm.runInNewContext(source, context, { filename: 'feat_mls_chartautofill_guard.js' });

assert.strictEqual(window.__mlsChartFillGuard.version, 'cfg-1.0.2');
assert.strictEqual(window.__mlsChartFillGuard.nameIsJunk(selected.name), true,
  'fixture must exercise a name containing a generic guard token');
assert.strictEqual(fields.heroPtName.value, selected.name,
  'guard erased the exact selected patient from the hero field');
assert.strictEqual(fields.patientLabel.value, selected.name,
  'guard erased the exact selected patient from the visit label');
assert.deepStrictEqual(fields.patientLabel.events, [],
  'guard emitted a synthetic input for the unchanged selected patient');

fields.patientLabel.value = 'In Athena';
window.__mlsChartFillGuard.scrub();
assert.strictEqual(fields.patientLabel.value, '',
  'guard stopped clearing an unrelated Athena-login identity');
assert.deepStrictEqual(fields.patientLabel.events, ['input', 'change'],
  'junk cleanup did not notify the UI exactly once');

selected = null;
fields.heroPtName.value = 'Sign In';
window.__mlsChartFillGuard.scrub();
assert.strictEqual(fields.heroPtName.value, '',
  'guard stopped clearing login text when no patient is selected');

fields.heroPtName.value = 'Athena Dashboard';
document.activeElement = fields.heroPtName;
window.__mlsChartFillGuard.scrub();
assert.strictEqual(fields.heroPtName.value, 'Athena Dashboard',
  'guard modified a field while the clinician was editing it');

console.log('PASS chart-autofill guard: preserves the exact selected patient without synthetic dirty input while still clearing unrelated login junk');
