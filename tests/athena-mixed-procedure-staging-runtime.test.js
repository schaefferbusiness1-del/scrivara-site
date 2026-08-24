'use strict';

/* A completed procedure section must survive the live mixed-note handoff as
 * its own immutable Procedure Documentation destination. This is PHI-free and
 * exercises the shipped page function, not a mirror of the routing logic. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const pages = ['ScribeFlow.html', '1pScribeFlow.html', '1p/index.html', 'cloned/index.html'];

function shippedFunction(page) {
  const start = page.indexOf('function _athenaShowReceipt(');
  const end = page.indexOf('/* Review the frozen superbill payload;', start);
  assert(start >= 0 && end > start, 'could not isolate _athenaShowReceipt');
  return page.slice(start, end);
}

for (const rel of pages) {
  const page = fs.readFileSync(path.join(root, rel), 'utf8');
  let captured = null;
  const window = {
    __mlsWriteFlow: {
      destinations: {
        hpi: 'Athena encounter > HPI',
        procedure: 'Athena encounter > Physical Exam > Procedure Documentation'
      },
      openUnifiedConfirmation(options) { captured = options; return options; }
    }
  };
  const context = { window, String, Object, Date, Math };
  vm.runInNewContext(shippedFunction(page), context, { filename: rel });
  context._athenaShowReceipt('Synthetic QA', [], false,
    { name: 'Synthetic QA', patientId: 'synthetic-1' },
    [
      { kind: 'hpi', body: 'Synthetic supported history.' },
      { kind: 'procedure', body: 'Synthetic completed procedure narrative.' },
      { kind: 'billing', body: 'Manual billing preview.' }
    ],
    { visitDate: '2026-08-24', provider: 'Synthetic Provider' });

  assert(captured, `${rel}: unified review did not open`);
  assert.deepStrictEqual(Array.from(captured.sections, row => row.key), ['hpi', 'procedure'],
    `${rel}: mixed procedure was not kept as its own named destination`);
  assert.strictEqual(captured.sections[1].destination,
    'Athena encounter > Physical Exam > Procedure Documentation',
    `${rel}: procedure advertised the wrong destination`);
  assert.strictEqual(captured.sections[1].text, 'Synthetic completed procedure narrative.',
    `${rel}: procedure payload changed during staging`);
  assert.deepStrictEqual(Array.from(captured.plan, row => row.kind), ['billing'],
    `${rel}: manual rows were not kept separate from named note destinations`);
  assert(Object.isFrozen(captured.sections), `${rel}: named destination array is mutable`);
  assert(Object.isFrozen(captured.sections[1]), `${rel}: procedure row is mutable`);
}

console.log('PASS mixed Athena procedure staging: HPI + completed procedure remain separate immutable exact destinations across all production pages');
