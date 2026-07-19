'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function draftSource(file) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const start = html.indexOf('var _visitDirty=false, _visitDraftTimer=null;');
  const end = html.indexOf('function _maybeRestoreVisitDraft()', start);
  assert(start >= 0 && end > start, file + ': could not isolate visit-draft lifecycle');
  return html.slice(start, end);
}

function exercise(file) {
  const storage = new Map();
  const timers = new Map();
  let nextTimer = 1;
  const nodes = {
    transcript: { value: 'Exact transcript' },
    patientLabel: { value: 'Synthetic Reliability Patient' }
  };
  const context = {
    currentSoap: 'Exact saved note',
    currentInsurance: '',
    currentFormat: 'soap',
    currentVisitAthenaBinding: null,
    currentVisitAthenaCompromised: false,
    uns(key) { return 'user:' + key; },
    document: {
      getElementById(id) { return nodes[id] || null; }
    },
    sessionStorage: {
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
      getItem(key) { return storage.has(key) ? storage.get(key) : null; }
    },
    setTimeout(fn) {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    Date
  };
  vm.runInNewContext(draftSource(file), context, { filename: file });

  context._markVisitDirty();
  assert.strictEqual(context._visitDirty, true, file + ': edit did not become dirty');
  assert.strictEqual(timers.size, 1, file + ': edit did not queue one draft save');

  context._wipeVisitDraft();
  assert.strictEqual(context._visitDirty, false, file + ': successful save did not clear dirty state');
  assert.strictEqual(context._visitDraftTimer, null, file + ': successful save retained a stale timer id');
  assert.strictEqual(timers.size, 0, file + ': successful save left a queued ghost-draft callback');
  assert.strictEqual(storage.has('user:visitDraft'), false, file + ': successful save retained a draft');

  context._markVisitDirty();
  const callback = Array.from(timers.values())[0];
  timers.clear();
  callback();
  assert.strictEqual(context._visitDraftTimer, null, file + ': fired draft timer did not retire itself');
  assert.strictEqual(storage.has('user:visitDraft'), true, file + ': a genuinely dirty visit was not recoverable');

  context._wipeVisitDraft();
  assert.strictEqual(storage.has('user:visitDraft'), false, file + ': final wipe did not remove the stored draft');
}

exercise('ScribeFlow.html');
exercise('ScribeFlow-staging.html');

console.log('PASS visit-draft lifecycle: a successful save cancels the pending timer and cannot repopulate a ghost unsaved draft');
