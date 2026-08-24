'use strict';

/* Adversarial panel collector proof. Repeated canonical checkboxes must never
 * be concatenated into one executable HPI/ROS/Exam/Assessment/Plan payload.
 * This is a synthetic app-side test only: no browser, extension, Athena tab,
 * order route, Save, Sign, or write action is exercised. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceNames = ['1p-feat_mls_writeflow.js', 'feat_mls_writeflow.js', 'cloned-feat_mls_writeflow.js'];

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(start >= 0 && end > start, `missing source block ${startNeedle}`);
  return source.slice(start, end);
}

class Panel {
  constructor(entries) {
    this.boxes = entries.map(entry => ({ checked: true, attrs: { 'data-k': entry.key }, getAttribute(name) { return this.attrs[name] || ''; } }));
    this.textareas = entries.map(entry => ({ value: entry.text, attrs: { 'data-t': entry.key }, getAttribute(name) { return this.attrs[name] || ''; } }));
  }
  querySelectorAll(selector) {
    if (selector === 'input[data-k]') return this.boxes;
    const match = /^textarea\[data-t="([^"]*)"\]$/.exec(selector);
    return match ? this.textareas.filter(item => item.attrs['data-t'] === match[1]) : [];
  }
}

function collectorFor(source) {
  const routes = between(source, 'var EXEC_ALIAS = {', 'function gatherSections(panel)');
  const routeEnv = Function(`var S = x => x == null ? '' : String(x);\n${routes}\nreturn { canonicalSectionKey, DESTINATION };`)();
  const gatherSource = between(source, 'function gatherSections(panel)', '/* --------------------------- result rendering');
  return Function('S', 'canonicalSectionKey', 'DESTINATION', `${gatherSource}\nreturn gatherSections;`)(
    x => x == null ? '' : String(x), routeEnv.canonicalSectionKey, routeEnv.DESTINATION
  );
}

function assertDuplicate(sourceName, key) {
  const source = fs.readFileSync(path.join(root, sourceName), 'utf8');
  const gather = collectorFor(source);
  const result = gather(new Panel([{ key, text: `first ${key}` }, { key, text: `second ${key}` }]));
  assert.strictEqual(result.sections.length, 0, `${sourceName}: duplicate ${key} remained executable`);
  assert.strictEqual(result.blocked.length, 1, `${sourceName}: duplicate ${key} did not produce one blocked receipt`);
  assert.strictEqual(result.blocked[0].key, key, `${sourceName}: blocked duplicate lost canonical key`);
  assert.strictEqual(result.blocked[0].duplicate, true, `${sourceName}: blocked duplicate was not marked duplicate`);
  assert.strictEqual(result.blocked[0].duplicateSections.length, 2, `${sourceName}: duplicate receipt collapsed the separate payloads`);
  assert(/first/.test(result.blocked[0].text) && /second/.test(result.blocked[0].text), `${sourceName}: duplicate receipt did not retain both payloads`);
}

for (const sourceName of sourceNames) {
  for (const key of ['hpi', 'ros', 'exam', 'assessment', 'plan']) assertDuplicate(sourceName, key);
  const source = fs.readFileSync(path.join(root, sourceName), 'utf8');
  const gather = collectorFor(source);
  const unique = gather(new Panel([{ key: 'hpi', text: 'one HPI' }]));
  assert.strictEqual(unique.sections.length, 1, `${sourceName}: unique HPI was unexpectedly blocked`);
  assert.strictEqual(unique.sections[0].text, 'one HPI', `${sourceName}: unique HPI text changed`);
  assert(source.includes('duplicateByKey') && source.includes('More than one reviewed payload targets the same Athena destination'), `${sourceName}: duplicate guard derivation drifted`);
}

console.log('PASS Athena panel duplicate-section runtime/parity: repeated HPI/ROS/Exam/Assessment/Plan routes fail closed in 1p, production, and cloned lanes; unique routes remain executable');
