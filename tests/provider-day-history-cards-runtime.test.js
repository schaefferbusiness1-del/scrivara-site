'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing source marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing source end marker: ${end}`);
  return source.slice(a, b);
}

const identity = between(app, 'function _athenaHistoryDigits(v)', '/* Like _assistReadAthenaTab');
const save = between(app, 'function _athenaChartHistoryObject(chart)', '/* Bulk: after pulling the schedule');
const profile = between(app, 'function _athenaProfileEmptyText(p,key,fallback)', '/* "At a glance" chips');
const structurer = between(connect,
  '/* =============================================================================\n * MLS Scribe - PULLED-CHART STRUCTURING',
  '/* The old Visit-tab Pay Report floater is intentionally retired.');
const easyPrep = between(connect,
  '/* =============================================================================\n * MLS Scribe - EASY PATIENT PREP',
  '/* =============================================================================\n * MLS Scribe - OUTSIDE RECORDS');

assert(app.includes('"vitals":{"bp":""'), 'chart parser schema still omits structured vitals');
assert(app.includes('"history":{"pmh":""'), 'chart parser schema still omits structured history/background');
assert(app.includes('"coverage":{"problems":"found|not_documented"'), 'chart parser does not require six-card coverage');
assert(!app.includes("String(text||'').slice(0,16000)"), 'chart parser still silently truncates at 16,000 characters');

class Element {
  constructor(tag, id, doc) {
    this.tagName = String(tag || 'div').toUpperCase(); this._id = id || ''; this.ownerDocument = doc;
    this.children = []; this.parentNode = null; this.style = { display: '', cssText: '', removeProperty() {} };
    this.className = ''; this.textContent = ''; this.innerHTML = ''; this.attributes = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  get id() { return this._id; }
  set id(value) { this._id = String(value || ''); if (this._id) this.ownerDocument.nodes[this._id] = this; }
  get nextSibling() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return this.parentNode.children[i + 1] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); if (child.id) this.ownerDocument.nodes[child.id] = child; return child; }
  insertBefore(child, before) { child.parentNode = this; const i = before ? this.children.indexOf(before) : -1; if (i < 0) this.children.push(child); else this.children.splice(i, 0, child); if (child.id) this.ownerDocument.nodes[child.id] = child; return child; }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || ''; }
  removeAttribute(k) { delete this.attributes[k]; }
  querySelector() { return null; }
}

function makeDocument() {
  const doc = { nodes: {}, readyState: 'complete', createElement(tag) { return new Element(tag, '', doc); },
    getElementById(id) { return doc.nodes[id] || null; },
    querySelector(selector) { return selector === '#profileCard .prof-grid' ? doc.nodes.profGrid : null; },
    addEventListener() {}, execCommand() { return true; } };
  doc.body = new Element('body', 'body', doc); doc.head = new Element('head', 'head', doc); doc.documentElement = new Element('html', 'html', doc);
  const card = new Element('section', 'profileCard', doc); card.style.display = 'none'; doc.body.appendChild(card);
  ['profileNonePanel', 'ptDeselectChip', 'profName', 'profDemo', 'profProblems', 'profMeds', 'profAllergies', 'profSummary'].forEach(id => card.appendChild(new Element('div', id, doc)));
  const grid = new Element('div', 'profGrid', doc); grid.className = 'prof-grid'; card.appendChild(grid);
  return doc;
}

const clone = value => JSON.parse(JSON.stringify(value));
let patients = [
  { id: 'same-alpha', name: 'Taylor Same', dob: '01/02/1970', mrn: '111', problems: 'Manual Alpha fact', meds: '', allergies: '', summary: '', visits: [] },
  { id: 'same-bravo', name: 'Taylor Same', dob: '03/04/1980', mrn: '222', problems: '', meds: '', allergies: '', summary: '', visits: [] }
];
let notes = [];
let activeId = 'same-alpha';
const document = makeDocument();
const context = {
  console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
  document, navigator: {}, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
  getPatients: () => clone(patients), findPatient: id => clone(patients.find(p => p.id === id) || null),
  upsertPatient(p) { const i = patients.findIndex(x => x.id === p.id); if (i >= 0) patients[i] = clone(p); else patients.push(clone(p)); },
  getNotes: () => clone(notes), saveNotes: value => { notes = clone(value); },
  activePatient: () => clone(patients.find(p => p.id === activeId) || null), patientNotes: () => [],
  renderInsurance() {}, renderDocs() {}, renderPtTimeline() {}, toast() {},
  _calAppts: []
};
context.window = context;
vm.runInNewContext(identity + '\n' + save + '\n' + profile, context, { filename: 'history-card-base.js' });
vm.runInNewContext(structurer, context, { filename: 'history-card-live-wrapper.js' });
vm.runInNewContext(easyPrep, context, { filename: 'history-card-easy-prep.js' });

assert.strictEqual(context._savePatientChart.__mlsStructWrapped, true, 'the real live chart wrapper was not in the save call chain');

function chart(marker, extra) {
  const base = {
    name: 'Taylor Same', problems: `${marker} lumbar radiculopathy`, meds: `${marker} gabapentin 300 mg nightly`,
    allergies: `${marker} penicillin rash`, summary: `${marker} exact longitudinal summary.`,
    vitals: { bp: marker === 'ALPHA' ? '128/82' : '136/88', hr: marker === 'ALPHA' ? '72' : '80', heightIn: '68', weightLb: marker === 'ALPHA' ? '180' : '190', takenAt: '2026-07-14' },
    history: { pmh: `${marker} hypertension`, psh: `${marker} prior surgery`, social: `${marker} lives with family`, family: `${marker} family stroke history`, smoking: 'Never smoker' },
    visits: [`06/24/2026 — ${marker} office visit`],
    coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
  };
  return Object.assign(base, extra || {});
}
function ref(id, dob, mrn) { return { patientId: id, name: 'Taylor Same', dob, mrn, verifiedName: 'Taylor Same', verifiedDob: dob, verifiedMrn: mrn }; }

assert.strictEqual(context._savePatientChart(ref('same-alpha', '01/02/1970', '111'), { source: 'athena-schedule-history' }, chart('ALPHA')), true);
assert.strictEqual(context._savePatientChart(ref('same-bravo', '03/04/1980', '222'), { source: 'athena-schedule-history' }, chart('BRAVO')), true);

function assertRendered(id, own, other) {
  activeId = id; context.renderProfile();
  assert(document.getElementById('profProblems').textContent.includes(own), `${own} problems were not visible`);
  assert(document.getElementById('profMeds').textContent.includes(own), `${own} medications were not visible`);
  assert(document.getElementById('profAllergies').textContent.includes(own), `${own} allergies were not visible`);
  assert(document.getElementById('profSummary').textContent.includes(own), `${own} summary was not visible`);
  assert(document.getElementById('mlsEpVitalsBox').innerHTML.includes(own === 'ALPHA' ? '128/82' : '136/88'), `${own} vitals were not visible`);
  assert(document.getElementById('mlsEpHistoryBox').innerHTML.includes(own), `${own} background history was not visible`);
  const visible = [document.getElementById('profProblems').textContent, document.getElementById('profMeds').textContent,
    document.getElementById('profAllergies').textContent, document.getElementById('profSummary').textContent,
    document.getElementById('mlsEpVitalsBox').innerHTML, document.getElementById('mlsEpHistoryBox').innerHTML].join('\n');
  assert(!visible.includes(other), `${other} data leaked into ${own}'s six visible cards`);
}
assertRendered('same-alpha', 'ALPHA', 'BRAVO');
assertRendered('same-bravo', 'BRAVO', 'ALPHA');

const bravoBefore = clone(patients.find(p => p.id === 'same-bravo'));
assert.strictEqual(context._savePatientChart(ref('same-alpha', '01/02/1970', '111'), { source: 'athena-schedule-history' }, chart('ALPHA', {
  problems: 'ALPHA lumbar radiculopathy; ALPHA new spinal stenosis', meds: 'ALPHA gabapentin 300 mg nightly; ALPHA new duloxetine 30 mg',
  allergies: 'ALPHA penicillin rash; ALPHA new latex allergy', vitals: { bp: '130/84', hr: '74', heightIn: '68', weightLb: '180', takenAt: '2026-07-15' },
  history: { pmh: 'ALPHA hypertension; ALPHA new diabetes', psh: 'ALPHA prior surgery', social: 'ALPHA lives with family', family: 'ALPHA family stroke history' }
})), true);
const alpha = patients.find(p => p.id === 'same-alpha');
assert.strictEqual((alpha.problems.match(/ALPHA new spinal stenosis/g) || []).length, 1, 'repeat pull duplicated a new problem');
assert.strictEqual((alpha.meds.match(/ALPHA new duloxetine 30 mg/g) || []).length, 1, 'repeat pull duplicated a new medication');
assert(alpha.problems.includes('Manual Alpha fact'), 'repeat pull overwrote a clinician-authored problem');
assert.strictEqual(alpha.vitals.bp, '130/84', 'repeat pull did not refresh Athena-owned vitals');
assert(alpha.history.pmh.includes('ALPHA new diabetes'), 'repeat pull did not enrich structured history');
assert.deepStrictEqual(patients.find(p => p.id === 'same-bravo'), bravoBefore, 'repeat ALPHA pull mutated BRAVO');
assert.strictEqual(notes.filter(n => n.patientId === 'same-alpha' && n.cc === 'Athena chart import').length, 1, 'repeat pull duplicated the Athena import note');

const beforeIncomplete = clone(patients);
assert.strictEqual(context._savePatientChart(ref('same-alpha', '01/02/1970', '111'), null, { summary: 'noise-only summary' }), false, 'summary-only unverified chart falsely completed');
assert.deepStrictEqual(patients, beforeIncomplete, 'failed six-card coverage mutated patient storage');
assert.strictEqual(context._savePatientChart(ref('same-alpha', '03/04/1980', '222'), null, chart('WRONG')), false, 'wrong-patient proof was accepted');

for (const p of patients) {
  assert.strictEqual(p.athenaProfileCoverage.complete, true, `${p.id} lacks a complete six-card receipt`);
  assert.strictEqual(p.athenaProfileCoverage.patientId, p.id, `${p.id} receipt is not immutable-id bound`);
}

console.log('PASS provider-day six-card history: live wrapper preserves exact problems, meds, allergies, summary, vitals, and background for two isolated patients');
