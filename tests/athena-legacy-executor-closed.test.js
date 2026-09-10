'use strict';
/* Executed-source coverage for the legacy generic executor and procedure
   search driver. All DOM controls and accounts below are synthetic stubs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8').replace(/\r\n/g, '\n');
let checks = 0;
const failures = [];
function check(value, label) { checks++; if (!value) failures.push(label); }
function bounded(a, b) { const i = source.indexOf(a), j = source.indexOf(b, i + a.length); assert(i >= 0 && j > i, 'missing source boundary'); return source.slice(i, j); }
const generic = bounded("  if (msg.type === 'mlsAssistExec') {", "  if (msg.type === 'mlsVerifiedWrite') {");
const search = bounded('async function mlsAthenaDrive(op, params, cfg) {', '/*MLS_ATHENA_DRIVE_END*/');

async function genericProbe(type, target, text) {
  let injected = 0, response = null;
  const chrome = {
    tabs: { query: async () => [{ id: 1, url: 'https://athenanet.athenahealth.com/fixture', active: true }] },
    scripting: { executeScript: async () => { injected++; return [{ result: { ok: true } }]; } }
  };
  const context = vm.createContext({ chrome, self: {}, _mlsFrameMap: {},
    msg: { type: 'mlsAssistExec', action: { type, target, text } },
    sendResponse: r => { response = r; }, setTimeout, clearTimeout, console: { log() {} }
  });
  vm.runInContext('(function(){' + generic + '\n})();', context);
  for (let i = 0; i < 8 && !response; i++) await new Promise(resolve => setImmediate(resolve));
  return { injected, response };
}
async function searchProbe(op, label, attrs, config) {
  let clicks = 0, events = 0;
  const button = {
    tagName: 'BUTTON', textContent: label, value: '', id: attrs.id || 'fixture-control', className: '',
    getAttribute: k => attrs[k] || null,
    closest: () => null,
    click() { clicks++; }, dispatchEvent() { events++; }, scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 30 })
  };
  const document = {
    body: { textContent: 'Synthetic report' },
    querySelector: sel => sel === '#fixture-control' ? button : null,
    querySelectorAll: sel => /button|role=.button/.test(sel) ? [button] : []
  };
  const context = vm.createContext({ document, setTimeout: cb => { cb(); return 1; },
    Event: class { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
  });
  context.window = context;
  button.ownerDocument = { defaultView: context };
  vm.runInContext(search, context);
  const result = await context.mlsAthenaDrive(op, {}, config);
  return { clicks, events, result };
}
async function clinicalFieldProbe(config) {
  let events = 0;
  const field = { tagName: 'INPUT', value: 'original', id: 'clinical-field',
    getAttribute: k => ({ type: 'text', name: 'cpt', 'aria-label': 'CPT' }[k] || null),
    closest: () => null, focus() {}, dispatchEvent() { events++; }
  };
  const document = { body: { textContent: 'Clinical encounter' },
    querySelector: () => null,
    querySelectorAll: sel => sel === 'input,textarea,[contenteditable=""],[contenteditable="true"]' ? [field] : []
  };
  const context = vm.createContext({ document, location: { href: 'https://athenanet.athenahealth.com/fixture/encounter' },
    Event: class { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
  });
  context.window = context; field.ownerDocument = { defaultView: context };
  vm.runInContext(search, context);
  await context.mlsAthenaDrive('fill', { cpt: ['12345'] }, config);
  return { unchanged: field.value === 'original', events };
}

(async () => {
  for (const [type, target, text] of [
    ['click', 'Check In', ''], ['confirm', '#0', ''], ['select', 'appointment status', 'Checked In'],
    ['type', 'note', 'Synthetic text'], ['pastenote', '', 'Synthetic text'],
    ['click', '#0', ''], ['select', 'billing status', 'Ready'], ['navigate', '/fixture', '']
  ]) {
    const r = await genericProbe(type, target, text);
    check(!!r.response && r.response.blocked === true && r.injected === 0,
      'generic Athena ' + type + ' must refuse before executeScript');
  }
  const scroll = await genericProbe('scroll', '', '');
  check(scroll.injected === 1 && scroll.response && scroll.response.ok === true, 'generic read-only scroll remains available');

  for (const op of ['fill', 'next']) {
    for (const [label, attrs] of [
      ['Sign and Save', {}], ['Check In', {}], ['Add Order', {}], ['Post Charges', {}],
      ['Next', { id: 'signsave' }], ['Next', { name: 'place_order' }],
      ['Update', { 'data-action': 'finalize_note' }]
    ]) {
      const r = await searchProbe(op, label, attrs, {
        runLabels: [label], nextLabels: [label], nextSelectors: ['#fixture-control'],
        excludeClickLabels: ['no-match-fixture']
      });
      check(r.clicks === 0 && r.events === 0, 'procedure search ' + op + ' must refuse forbidden ' + label + ' despite cfg override');
    }
  }
  const safeNext = await searchProbe('next', 'Next page', {}, { nextSelectors: ['#fixture-control'] });
  check(safeNext.clicks === 1 && safeNext.result.clicked === true, 'ordinary next-page navigation remains available');
  const safeRun = await searchProbe('fill', 'Run report', {}, {});
  check(safeRun.clicks === 0 && safeRun.events === 0 && safeRun.result.blocked === true && safeRun.result.reason === 'report-filter-scope-unverified',
    'report fill refuses honestly until a report-only scope can be proven');
  const readOnly = await searchProbe('read', 'Next page', {}, { nextSelectors: ['#fixture-control'] });
  check(readOnly.clicks === 0 && readOnly.events === 0 && readOnly.result.ok === true && readOnly.result.op === 'read',
    'read-only report inspection remains available');
  for (const config of [{}, { cptFieldLabels: ['cpt'] }]) {
    const r = await clinicalFieldProbe(config);
    check(r.unchanged && r.events === 0, 'report fill cannot type a clinical field without a proven report scope');
  }

  if (failures.length) {
    console.error(JSON.stringify({ suite: 'athena-legacy-executor-closed', checks, passed: false, failures }));
    process.exitCode = 1;
  } else console.log(JSON.stringify({ suite: 'athena-legacy-executor-closed', checks, passed: true }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
