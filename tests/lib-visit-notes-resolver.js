'use strict';
/* Shared harness piece (NOT a test): evaluate the REAL shipped
   __mlsVisitNotesPref resolver - extracted from mls-connect.js between its
   BEGIN/END markers - against a test's own uns + localStorage. Tests
   exercise the true shipped code, never a reimplementation that could
   drift from what actually runs. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function resolverSource() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');
  const b = src.indexOf('__mlsVisitNotesPref RESOLVER BEGIN');
  const e = src.indexOf('__mlsVisitNotesPref RESOLVER END');
  assert.ok(b > 0 && e > b, 'resolver markers present in mls-connect.js');
  const s = src.indexOf('(function () {', b);
  const fin = src.lastIndexOf('})();', e);
  assert.ok(s > b && fin > s, 'resolver IIFE bounds located');
  return src.slice(s, fin + '})();'.length);
}

function makeResolver(unsFn, storageObj) {
  const w = { uns: unsFn };
  const ctx = vm.createContext({ window: w, localStorage: storageObj });
  vm.runInContext(resolverSource(), ctx, { filename: 'mls-connect:__mlsVisitNotesPref' });
  assert.ok(w.__mlsVisitNotesPref && typeof w.__mlsVisitNotesPref.read === 'function' && typeof w.__mlsVisitNotesPref.write === 'function',
    'the shipped resolver installed read() and write()');
  return w.__mlsVisitNotesPref;
}

module.exports = { resolverSource, makeResolver };
