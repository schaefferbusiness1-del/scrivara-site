const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const store = new Map();
let appliedTemplate = null;
const window = {
  uns: key => `acct:${key}`,
  getTemplates: () => [{ id: 'tpl-1', name: 'Lumbar procedure', text: 'PROCEDURE NOTE\nTechnique:\nOriginal technique.\nComplications:\nNone.' }],
  applyTemplateToNote(template) { appliedTemplate = template; return template.text; },
  openTemplates() {},
};
const document = {
  readyState: 'loading',
  getElementById() { return null; },
  addEventListener() {},
};
const context = vm.createContext({
  window,
  document,
  localStorage: {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
  },
  setTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
  Date,
  Math,
  console,
});

vm.runInContext(fs.readFileSync(path.join(root, 'mls-template-stdline.js'), 'utf8'), context);
const api = window.__mlsStdLine;
assert(api && api.installed, 'standard-line engine did not install');

const line = 'Two vials were used; the documented remainder was discarded.';
const base = 'PROCEDURE NOTE\nTechnique:\nOriginal technique.\nComplications:\nNone.';
const inserted = api.insertLineIntoText(base, line);
assert(inserted.indexOf(line) > inserted.indexOf('Original technique.'));
assert(inserted.indexOf(line) < inserted.indexOf('Complications:'));
assert.strictEqual(api.insertLineIntoText(inserted, line), inserted, 'standard line duplicated');

api.saveLines([{ id: 'line-1', text: line, templateIds: ['tpl-1'], created: 1 }]);
const rendered = window.applyTemplateToNote(window.getTemplates()[0], 'visit');
assert(rendered.includes(line), 'assigned standard line did not flow through template application');
assert(appliedTemplate && appliedTemplate !== window.getTemplates()[0], 'stored template should be cloned, not mutated');
assert.strictEqual(window.getTemplates()[0].text, base, 'stored template was mutated');

const insertWindow = { __mlsStdLine: api };
const insertContext = vm.createContext({
  window: insertWindow,
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
  localStorage: context.localStorage,
  Event: function Event(type) { this.type = type; },
  setTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
  MutationObserver: function MutationObserver() {},
  console,
});
vm.runInContext(fs.readFileSync(path.join(root, 'feat_stdline_insert.js'), 'utf8'), insertContext);
assert(insertWindow.__mlsStdLineInsert && insertWindow.__mlsStdLineInsert.installed);
assert.strictEqual(insertWindow.__mlsStdLineInsert.insertLine(inserted, line), inserted, 'manual insert duplicated the line');

console.log('PASS template application, always-add standard lines, and manual insert runtime');
