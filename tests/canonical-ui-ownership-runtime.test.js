'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const connect = read('mls-connect.js');
const app = read('ScribeFlow.html');
const topbar = read('feat_mls_topbar_unify.js');

function between(source, startToken, endToken, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert(start >= 0 && end > start, `could not isolate ${label}`);
  return source.slice(start, end);
}

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const policy = between(
  connect,
  '/* The production candidate has one canonical Easy UI.',
  '/* =========================================================================\n * MLS - EARLY STORE CACHE',
  'canonical Easy policy'
);
const active = between(
  connect,
  "var VER = '3.7.2'",
  '/* =========================================================================\n * MLS Scribe — PULL PIPELINE TRUTH PACK',
  'active Easy 3.7.2 engine'
);
const daySwitch = between(
  connect,
  '/* ===== __mlsDaySwitch ds-2.0.2',
  '/* ===== __mlsVisitSavePref',
  'DaySwitch 2.0.1'
);

// Production source has one callable owner. Historical guarded copies may
// remain in the concatenated archive, but the active API and topbar publish no
// direct Staff or rollback entry point.
assert(active.includes("var VER = '3.7.2'"), 'canonical Easy release marker is missing');
assert(!/\bopenStaff\s*:/.test(active), 'active Easy API still publishes a direct Staff opener');
assert(!/id=["']ez3Mode(?:Doc|Staff)["']/.test(active), 'active Easy still creates a hidden doctor/staff mode control');
assert(!/window\.__mlsEasyV(?:32|31|3)_revert\s*=(?!=)/.test(active), 'active Easy still publishes an in-bundle rollback');
assert(active.includes("window.addEventListener('mls:menu-staff-prep-request', onMenuStaffPrepRequest)"),
  'active Easy does not receive the single Menu-owned Staff intent');
assert(active.includes("setEasyMode('staff', 'staff', 'menu-staff-prep', true)"),
  'Menu Staff intent bypasses the synchronous mode transition');
assert(active.indexOf('clearExistingGlobalToast();') < active.indexOf("setEasyMode('staff', 'staff', 'menu-staff-prep', true)"),
  'Menu Staff intent does not synchronously clear stale global toast state before rendering');

const topbarApi = between(topbar, 'window.__mlsTopbar = {', '  };', 'topbar public API');
const topbarStaff = functionBlock(topbar, 'activateStaffPrepFromMenu');
assert(!/openStaffPrep\s*:|activateStaffPrepFromMenu\s*:/.test(topbarApi), 'topbar exposes a direct Staff opener');
assert(topbarStaff.includes('mls:menu-staff-prep-request') && !topbarStaff.includes('__mlsEasyV3'),
  'Menu row still calls the Easy Staff API directly');
assert(!app.includes('su_openStaffPrep') && !app.includes('openStaffPulls'),
  'ScribeFlow retains a Setup/rail direct Staff activation function');
assert(app.includes('onclick="su_showStaffPrepMenu()"') && app.includes("window.__mlsTopbar.openMenu()"),
  'Setup no longer guides the user to the canonical Menu');
assert(!/onclick=["'][^"']*(?:openStaff|ez3ModeStaff)/i.test(app),
  'ScribeFlow markup retains a direct Staff activation control');

// Query/storage tampering is cleared before historical modules run, and the
// retired globals cannot be republished by a later strict-mode lineage.
{
  const store = new Map([
    ['mls.easyV2.enabled', '0'],
    ['mls.easyOne.enabled', '0'],
    ['unrelated', 'keep']
  ]);
  let replaced = '';
  const context = {
    console, Object, Array, URL,
    location: { href: 'https://mlsscribe.com/ScribeFlow.html?classic=1&mlseasy=classic&easyone=0&demo=1#keep' },
    history: {
      state: { keep: true },
      replaceState(_state, _title, value) { replaced = value; }
    },
    document: { title: 'MLS' },
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); }
    }
  };
  context.window = context;
  vm.runInNewContext(policy, context, { filename: 'canonical-easy-policy.js' });
  assert.strictEqual(replaced, '/ScribeFlow.html?demo=1#keep', 'retired UI flags were not scrubbed without disturbing unrelated URL state');
  assert.strictEqual(store.has('mls.easyV2.enabled'), false, 'persisted Easy rollback flag survived boot');
  assert.strictEqual(store.has('mls.easyOne.enabled'), false, 'persisted legacy-layer flag survived boot');
  assert.strictEqual(store.get('unrelated'), 'keep', 'canonical policy changed unrelated storage');
  for (const name of [
    'classic', 'mlsEasyClassic', 'easyV2on', 'mlsEasyV2On',
    'easyOneOff', 'easyOneOn', '__mlsEasyV32_revert', '__mlsEasyV31_revert',
    '__mlsEasyV3_revert', '__mlsEasyOne_revert'
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(context, name);
    assert(descriptor && descriptor.configurable === false && typeof descriptor.set === 'function', `${name} is not immutably retired`);
    vm.runInNewContext(`window[${JSON.stringify(name)}] = function(){ return 'legacy'; };`, context);
    assert.strictEqual(context[name], undefined, `${name} was republished by a later lineage`);
  }
  assert.strictEqual(context.__mlsCanonicalEasyPolicy.owner, '__mlsEasyV32');
}

// Exercise the real mode helper source. The before event must precede every
// route/render operation and the after event must follow the completed DOM.
{
  const timeline = [];
  const attrs = {};
  const body = { setAttribute(name, value) { attrs[`body:${name}`] = value; } };
  const host = { setAttribute(name, value) { attrs[`host:${name}`] = value; } };
  const context = {
    S: { mode: 'doctor', screen: 'home' }, host, VER: '3.7.2', easyModeSequence: 0,
    $(id) { return id === 'mlsEz3Body' ? body : null; },
    safe(fn) { try { return fn(); } catch (_) { return undefined; } },
    isFn(value) { return typeof value === 'function'; },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },
    render() { timeline.push('render'); },
    mount() { timeline.push('mount'); },
    window: {
      showView(view) { timeline.push(`show:${view}`); },
      dispatchEvent(event) { timeline.push(`event:${event.detail.phase}:${event.detail.mode}:${event.detail.reason}`); }
    }
  };
  vm.createContext(context);
  vm.runInContext([
    functionBlock(active, 'reflectEasyMode'),
    functionBlock(active, 'signalEasyMode'),
    functionBlock(active, 'setEasyMode'),
    'this.setEasyMode = setEasyMode;'
  ].join('\n'), context);
  assert.strictEqual(context.setEasyMode('staff', 'staff', 'menu-staff-prep', true), true);
  assert.deepStrictEqual(timeline, [
    'event:before:staff:menu-staff-prep', 'show:visit', 'mount', 'render',
    'event:after:staff:menu-staff-prep'
  ], 'Menu → Staff transition is not synchronous and ordered');
  assert.strictEqual(attrs['host:data-mls-easy-mode'], 'staff');
  assert.strictEqual(attrs['body:data-mls-easy-mode'], 'staff');
}

// The private Menu request rejects every other source and acknowledges only
// after the synchronous Staff transition returns.
{
  const calls = [];
  const context = {
    S: { mode: 'doctor', screen: 'home' }, easyModeSequence: 9,
    clearExistingGlobalToast() { calls.push('clear-toast'); },
    setEasyMode(mode, screen, reason, navigate) {
      calls.push(`set:${mode}:${screen}:${reason}:${navigate}`);
      context.S.mode = mode; context.S.screen = screen;
    },
    safe(fn) { return fn(); },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },
    window: { dispatchEvent(event) { calls.push(`ack:${event.detail.requestId}:${event.detail.mode}`); } }
  };
  vm.createContext(context);
  vm.runInContext(`${functionBlock(active, 'onMenuStaffPrepRequest')}\nthis.openFromMenu = onMenuStaffPrepRequest;`, context);
  context.openFromMenu({ detail: { source: 'setup-direct', requestId: 'bad' } });
  assert.deepStrictEqual(calls, [], 'non-Menu source opened Staff');
  context.openFromMenu({ detail: { source: 'mls-topbar-menu', requestId: 'good' } });
  assert.deepStrictEqual(calls, [
    'clear-toast', 'set:staff:staff:menu-staff-prep:true', 'ack:good:staff'
  ], 'Menu request was not acknowledged after the Staff transition');
}

// DaySwitch correctness is event-driven: Staff removes doctor-day controls in
// the same listener turn; doctor controls return only on the completed event.
{
  const calls = [];
  const context = {
    removeDoctorDayControls() { calls.push('remove'); },
    ensure() { calls.push('ensure'); }
  };
  vm.createContext(context);
  vm.runInContext(`${functionBlock(daySwitch, 'onEasyModeChanged')}\nthis.modeChanged = onEasyModeChanged;`, context);
  context.modeChanged({ detail: { mode: 'staff', phase: 'before' } });
  context.modeChanged({ detail: { mode: 'doctor', phase: 'before' } });
  context.modeChanged({ detail: { mode: 'doctor', phase: 'after' } });
  assert.deepStrictEqual(calls, ['remove', 'ensure'], 'DaySwitch still relies on delayed polling for mode correctness');
}

console.log('PASS canonical UI ownership: rollback routes retired, Staff is Menu-only, and doctor/staff transitions are synchronous');
