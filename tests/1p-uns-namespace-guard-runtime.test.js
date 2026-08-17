'use strict';

/* Executed contract for uns-namespace-guard-1.0.0 in the two /1p shells.
   The old uns() tested the session OBJECT, so an unresolved email minted the
   literal namespace 'sf_u::undefined::' and real data stranded there.
   No network, no DOM, no PHI - the fixture uses a synthetic email only. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const START = '/* ===== uns-namespace-guard-1.0.0 =====';
const END = '/* ===== end uns-namespace-guard-1.0.0 ===== */';

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function liftBlock(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const a = src.indexOf(START);
  assert.ok(a >= 0, file + ': the uns-namespace-guard-1.0.0 block is missing');
  assert.ok(src.indexOf(START, a + 1) < 0, file + ': the uns-namespace-guard block appears twice');
  const b = src.indexOf(END, a);
  assert.ok(b > a, file + ': the uns-namespace-guard block is not closed');
  /* The old one-line uns() must be gone - it is the whole defect. */
  assert.ok(src.indexOf("'sf_u::'+(session?session.email:'_')") < 0,
    file + ': the old session-object uns() is still present');
  return src.slice(a, b + END.length);
}

function makeStorage() {
  const map = new Map();
  function Storage() {}
  Storage.prototype.setItem = function (k, v) { map.set(String(k), String(v)); };
  Storage.prototype.getItem = function (k) { return map.has(String(k)) ? map.get(String(k)) : null; };
  Storage.prototype.removeItem = function (k) { map.delete(String(k)); };
  Storage.prototype.key = function (i) { const list = Array.from(map.keys()); return i < list.length ? list[i] : null; };
  Object.defineProperty(Storage.prototype, 'length', { get() { return map.size; } });
  return { Storage, storage: new Storage(), map };
}

function boot(file) {
  const block = liftBlock(file);
  const { Storage, storage, map } = makeStorage();
  const warnings = [];
  const sandbox = {
    Storage, localStorage: storage, JSON, Date, Math, RegExp, String, Number, Array, Object, Boolean, Error,
    console: { warn(msg) { warnings.push(String(msg)); }, log() {}, info() {}, error() {} },
    session: null,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox, { filename: file + '#uns-namespace-guard' });
  return { sandbox, map, warnings, storage };
}

for (const file of SHELLS) {
  const { sandbox, map, warnings, storage } = boot(file);

  /* ---- 1. the namespace the key is minted from ------------------------- */
  sandbox.session = null;
  eq(sandbox.uns('notes'), 'sf_u::_::notes', file + ': session=null must mint the _ namespace');
  eq(sandbox.unsResolved(), false, file + ': session=null must report unresolved');

  sandbox.session = {};
  eq(sandbox.uns('notes'), 'sf_u::_::notes', file + ': session={} must mint _, never undefined');

  sandbox.session = { email: undefined };
  eq(sandbox.uns('notes'), 'sf_u::_::notes', file + ': session={email:undefined} must mint _, never undefined');

  sandbox.session = { email: '' };
  eq(sandbox.uns('notes'), 'sf_u::_::notes', file + ': session={email:""} must mint _, never the empty namespace');

  sandbox.session = { email: '   ' };
  eq(sandbox.uns('notes'), 'sf_u::_::notes', file + ': a whitespace-only email is not a resolved account');

  sandbox.session = { email: { toString() { return 'a@b'; } } };
  eq(sandbox.uns('notes'), 'sf_u::_::notes', file + ': a non-string email must not be coerced into a namespace');

  sandbox.session = { email: 'a@b' };
  eq(sandbox.uns('notes'), 'sf_u::a@b::notes', file + ': a resolved email must own the namespace');
  eq(sandbox.unsResolved(), true, file + ': a resolved email must report resolved');
  eq(sandbox.unsEmail(), 'a@b', file + ': unsEmail must expose the resolved account');

  /* ---- 2. a write while unresolved is refused, and warns exactly once --- */
  sandbox.session = null;
  const before = map.size;
  eq(storage.setItem(sandbox.uns('notes'), 'PATIENT NOTE'), false,
    file + ': a write through the unresolved namespace must return false');
  eq(storage.setItem(sandbox.uns('apikey'), 'k'), false,
    file + ': a second unresolved write must also be refused');
  eq(storage.setItem('sf_u::undefined::notes', 'PATIENT NOTE'), false,
    file + ': a literal sf_u::undefined:: write must be refused');
  eq(storage.setItem('sf_u::::notes', 'PATIENT NOTE'), false,
    file + ': a literal empty-namespace write must be refused');
  eq(map.size, before, file + ': a refused write must not land any key');
  eq(warnings.length, 1, file + ': the refusal must warn exactly once, not once per write');
  ok(/__mlsNamespaceAudit/.test(warnings[0]), file + ': the single warning must point at the audit tracer');

  /* ---- 3. reads still fall back; resolved writes still land ------------- */
  map.set('sf_u::undefined::notes', 'x'.repeat(10));
  map.set('sf_u::_::docprefs', 'y'.repeat(4));
  map.set('sf_u::a@b::notes', 'z'.repeat(100));
  eq(storage.getItem('sf_u::undefined::notes'), 'x'.repeat(10),
    file + ': reads through the stranded namespace must still work');

  sandbox.session = { email: 'a@b' };
  eq(storage.setItem(sandbox.uns('docname'), 'Dr Synthetic'), undefined,
    file + ': a resolved write must pass through to the native setItem');
  eq(map.get('sf_u::a@b::docname'), 'Dr Synthetic', file + ': a resolved write must land under the account namespace');
  eq(warnings.length, 1, file + ': a resolved write must not warn');

  /* ---- 4. the read-only tracer ----------------------------------------- */
  const audit = sandbox.window.__mlsNamespaceAudit();
  eq(audit.currentEmail, 'a@b', file + ': the audit must report the CURRENT account');
  eq(audit.resolved, true, file + ': the audit must report resolution state');
  eq(audit.writeGuard, true, file + ': the audit must confirm the write guard is installed');
  const keys = Array.from(audit.keys).map(k => k.key).sort().join('|');
  eq(keys, 'sf_u::_::docprefs|sf_u::undefined::notes',
    file + ': the audit must list exactly the stranded keys and nothing owned by an account');
  eq(audit.keys[0].key, 'sf_u::undefined::notes', file + ': the audit must sort the biggest stranded key first');
  eq(audit.keys[0].bytes, ('sf_u::undefined::notes'.length + 10) * 2, file + ': the audit must size the key in UTF-16 bytes');
  eq(audit.namespaces['undefined'], ('sf_u::undefined::notes'.length + 10) * 2, file + ': the audit must total per namespace');
  eq(audit.totalBytes, audit.keys.reduce((n, k) => n + k.bytes, 0), file + ': the audit total must equal the sum of its rows');
  ok(audit.keys.every(k => !Object.prototype.hasOwnProperty.call(k, 'value')),
    file + ': the audit must never carry a stored VALUE (no PHI leaves the tracer)');
  /* nothing was janitored */
  eq(map.get('sf_u::undefined::notes'), 'x'.repeat(10), file + ': the audit must not delete stranded data');
  eq(map.get('sf_u::_::docprefs'), 'y'.repeat(4), file + ': the audit must not delete stranded data');
}

console.log('1p-uns-namespace-guard-runtime: ' + checks + ' checks passed across ' + SHELLS.length + ' shells');
