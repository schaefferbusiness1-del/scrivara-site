'use strict';

/* The generated-note handoff may stage named Athena rows only when the note's
 * own headings prove the destination. This test is local/PHI-free: it runs the
 * shipped parser and checks that malformed or ambiguous SOAP stays refused. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');
const document = {
  readyState: 'loading', body: {}, activeElement: null,
  addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  getElementById() { return null; },
  createElement() { return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } }; }
};
const window = { window: null, document, location: { origin: 'https://mlsscribe.com', hostname: 'mlsscribe.com' },
  addEventListener() {}, removeEventListener() {}, postMessage() {}, toast() {} };
window.window = window;
function MutationObserver() {}
MutationObserver.prototype.observe = function () {};
MutationObserver.prototype.disconnect = function () {};
vm.runInNewContext(source, { window, document, location: window.location, MutationObserver, console,
  setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, Promise, Object, Array, String, Number, RegExp, JSON, Uint32Array });

const parse = window.__mlsWriteFlow.parseGeneratedSoapSections;
assert.strictEqual(typeof parse, 'function', 'strict SOAP parser is not exposed');
const join = lines => lines.join('\n');
const valid = join(['HPI: symptoms began two weeks ago.', 'ROS: denies dyspnea.', 'EXAM: lungs clear.', 'ASSESSMENT: acute bronchitis.', 'PLAN: supportive care.']);
const wrapped = join(['SUBJECTIVE:', 'HPI: symptoms began two weeks ago.', 'ROS: denies dyspnea.', 'OBJECTIVE:', 'Exam: lungs clear.', 'ASSESSMENT:', 'acute bronchitis.', 'PLAN:', 'supportive care.']);
const parsed = parse(valid);
assert.strictEqual(parsed.ok, true, 'exact five-heading SOAP should stage');
assert.strictEqual(Array.from(parsed.sections, s => s.key).join('|'), 'hpi|ros|exam|assessment|plan');
assert.strictEqual(Array.from(parsed.sections, s => s.destination).join('|'), [
  'Athena encounter > HPI', 'Athena encounter > Review of Systems', 'Athena encounter > Physical Exam',
  'Athena encounter > Assessment & Plan > Assessment', 'Athena encounter > Assessment & Plan > Plan / Follow-up'
].join('|'));
assert.strictEqual(parse(wrapped).ok, true, 'shipped SUBJECTIVE/OBJECTIVE nested shape should stage');

for (const wrapper of ['SUBJECTIVE:', 'OBJECTIVE:', 'ASSESSMENT & PLAN:', 'ASSESSMENT AND PLAN:']) {
  for (const target of ['HPI', 'ROS', 'EXAM', 'ASSESSMENT', 'PLAN']) {
    const embedded = [];
    for (const section of ['HPI', 'ROS', 'EXAM', 'ASSESSMENT', 'PLAN']) {
      embedded.push(`${section}: ${section === target ? 'body before wrapper' : 'body'}`);
      if (section === target) embedded.push(wrapper);
    }
    const rejected = parse(embedded.join('\n'));
    assert.strictEqual(rejected.ok, false, `bare ${wrapper} embedded in flat ${target} must fail closed`);
    assert.strictEqual(rejected.reason, 'malformed-heading');
    assert.strictEqual(rejected.sections.length, 0);
  }
}

const validNumberedAndBulletedBodies = join([
  'HPI: symptoms began two weeks ago.', '1. Onset: gradual.', '- History: prior episode documented.',
  'ROS: denies dyspnea.', 'EXAM: lungs clear.', 'ASSESSMENT: acute bronchitis.',
  'PLAN:', '1. Imaging: MRI if symptoms persist.', '- Follow-up: return as needed.'
]);
assert.strictEqual(parse(validNumberedAndBulletedBodies).ok, true, 'numbered HPI and bulleted Plan sublabels must remain body content');

for (const [label, text, reason] of [
  ['reordered headings', join(['ROS: r', 'HPI: h', 'EXAM: e', 'ASSESSMENT: a', 'PLAN: p']), 'preamble'],
  ['duplicate heading', join(['HPI: h', 'ROS: r', 'ROS: duplicate', 'EXAM: e', 'ASSESSMENT: a', 'PLAN: p']), 'duplicate-ros'],
  ['blank body', join(['HPI: h', 'ROS:', 'EXAM: e', 'ASSESSMENT: a', 'PLAN: p']), 'empty-ros'],
  ['preamble', join(['Generated SOAP note', 'HPI: h', 'ROS: r', 'EXAM: e', 'ASSESSMENT: a', 'PLAN: p']), 'preamble'],
  ['markdown heading cannot be absorbed into the prior field', join(['HPI: h', '**ROS:** misplaced', 'ROS: r', 'EXAM: e', 'ASSESSMENT: a', 'PLAN: p']), 'malformed-heading'],
  ['numbered heading cannot be absorbed into the prior field', join(['HPI: h', '1. ROS: misplaced', 'ROS: r', 'EXAM: e', 'ASSESSMENT: a', 'PLAN: p']), 'malformed-heading'],
  ['bulleted heading cannot be absorbed into the prior field', join(['HPI: h', '- ROS: misplaced', 'ROS: r', 'EXAM: e', 'ASSESSMENT: a', 'PLAN: p']), 'malformed-heading'],
  ['unmapped nested field', join(['SUBJECTIVE:', 'HPI: h', 'ROS: r', 'PMH: chronic condition', 'OBJECTIVE:', 'Exam: e', 'ASSESSMENT:', 'a', 'PLAN:', 'p']), 'unsupported-nested-heading'],
  ['numbered unmapped nested field', join(['SUBJECTIVE:', 'HPI: h', 'ROS: r', '1. PMH: chronic condition', 'OBJECTIVE:', 'Exam: e', 'ASSESSMENT:', 'a', 'PLAN:', 'p']), 'malformed-heading'],
  ['combined assessment and plan', join(['SUBJECTIVE:', 'HPI: h', 'ROS: r', 'OBJECTIVE:', 'Exam: e', 'ASSESSMENT & PLAN:', 'a and p']), 'wrapper-order']
]) {
  const result = parse(text);
  assert.strictEqual(result.ok, false, label + ' must fail closed');
  assert(result.reason.includes(reason), label + ' returned unexpected reason: ' + result.reason);
  assert.strictEqual(result.sections.length, 0, label + ' returned executable rows after refusal');
}

const prodPage = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const p1Page = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
for (const page of [prodPage, p1Page]) {
  assert(page.includes('parseGeneratedSoapSections'), 'page does not use the strict parser at action time');
  assert(page.includes("plan.push({kind:s.key,body:s.text,generatedSoap:true})"), 'named SOAP rows are not staged from parser output');
  assert(page.includes('unifiedSections.push(Object.freeze({key:key,text:String(s.body||\'\').trim()'), 'named SOAP rows are not sent through visible unified review as immutable payloads');
}
console.log('PASS generated SOAP staging: exact flat and shipped nested headings become five named review rows; order, duplicate, blank, preamble, and combined A&P inputs remain fail-closed');
