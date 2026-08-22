'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_firstrun.js'), 'utf8');

function load(si, calendarRows) {
  const storage = new Map();
  const document = {
    getElementById() { return null; },
    querySelector() { return null; },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
    addEventListener() {},
    removeEventListener() {},
    contains() { return false; },
    body: { appendChild() {} },
    head: { appendChild() {} },
    documentElement: { appendChild() {} }
  };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const sessionStorage = {
    getItem(key) { return storage.has('session:' + key) ? storage.get('session:' + key) : null; },
    setItem(key, value) { storage.set('session:' + key, String(value)); }
  };
  const window = {
    __mlsSI: si,
    _calAppts: calendarRows || [],
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {}
  };
  const context = {
    window, document, localStorage, sessionStorage,
    Date, Object, console,
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  window.window = window;
  window.document = document;
  vm.runInNewContext(source, context, { filename: 'feat_mls_firstrun.js' });
  return window.__mlsFirstRun._truth.day();
}

assert.strictEqual(load({
  authoritativeStatusForDay() { return { available: true }; },
  _loadAuthoritativeStore() { return { ok: true, store: { days: {} } }; }
}), 'ok', 'a verified current day stopped satisfying the checklist');

assert.strictEqual(load({
  authoritativeStatusForDay() { return { available: false }; },
  _loadAuthoritativeStore() {
    return { ok: true, store: { v: 1, days: { '2026-08-14': { active: { mode: 'all' } } } } };
  }
}), 'ok', 'a durable historical pulled day did not satisfy “Pull your first day”');

assert.strictEqual(load({
  authoritativeStatusForDay() { return { available: false }; },
  _loadAuthoritativeStore() { return { ok: true, store: { v: 1, days: {} } }; }
}), 'wait', 'an empty authoritative store invented a completed first pull');

assert.strictEqual(load({
  authoritativeStatusForDay() { return { available: false }; },
  _loadAuthoritativeStore() { return { ok: false, store: { days: { '2026-08-14': {} } } }; }
}), 'wait', 'an invalid authoritative store was accepted as pull proof');

assert.strictEqual(load({
  authoritativeStatusForDay() { throw new Error('not ready'); },
  _loadAuthoritativeStore() { throw new Error('not ready'); }
}, [{ id: 'synthetic-existing-calendar-row' }]), 'ok', 'the established calendar fallback stopped working');

console.log('PASS first-run historical pull: any sanitized account-owned pulled day completes “Pull your first day”; empty/invalid stores stay incomplete');
