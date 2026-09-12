'use strict';

/* The AI Studio builder's "Search Athena for this procedure" hand-off must
 * open the actual By procedure tab and carry every visible filter across even
 * when the on-demand Study modal paints late. Synthetic DOM only; no Athena or
 * network access. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '1p-mls-connect.js'), 'utf8');
const start = source.indexOf('  function openAthenaSearch() {');
const end = source.indexOf('\n\n  /* ------------------------------ preview / build', start);
assert(start >= 0 && end > start, 'Study builder hand-off function moved; update this focused extraction deliberately');
const functionSource = source.slice(start, end);

function makeField() {
  return {
    value: '', events: [],
    dispatchEvent(event) { this.events.push(event.type); }
  };
}

function harness(filters, neverPaint) {
  const note = { textContent: '' };
  const queue = [];
  let nextTimer = 1;
  const fields = {
    mlsStudyBProc: makeField(),
    mlsStudyBFrom: makeField(),
    mlsStudyBTo: makeField()
  };
  let painted = false;
  const openedWith = [];
  const document = {
    getElementById(id) {
      if (id === 'sbv2Note') return note;
      return painted ? (fields[id] || null) : null;
    }
  };
  const window = {
    __mlsStudy: {
      open(tab) { openedWith.push(tab); return true; }
    }
  };
  const sandbox = {
    window, document,
    readFilters: () => Object.assign({}, filters),
    $: id => document.getElementById(id),
    Event: function Event(type) { this.type = type; },
    setTimeout(fn, delay) { queue.push({ id: nextTimer, fn, delay }); return nextTimer++; }
  };
  vm.createContext(sandbox);
  vm.runInContext(functionSource + '\nthis.__openAthenaSearch = openAthenaSearch;', sandbox, { filename: 'study-builder-procedure-handoff', timeout: 2000 });
  sandbox.__openAthenaSearch();
  function drain(limit) {
    let ran = 0;
    while (queue.length && ran < limit) {
      const task = queue.shift();
      assert.strictEqual(task.delay, 100, 'late-paint retry cadence drifted');
      if (!neverPaint && ran === 1) painted = true;
      task.fn();
      ran++;
    }
    return ran;
  }
  return { note, queue, fields, openedWith, setPainted: value => { painted = value; }, drain };
}

{
  const h = harness({ proc: 'lumbar transforaminal ESI', icd: 'M54.16', from: '2026-01-01', to: '2026-09-12' }, false);
  assert.deepStrictEqual(h.openedWith, ['B'], 'the hand-off opened the default name+DOB tab instead of By procedure');
  assert.strictEqual(h.fields.mlsStudyBProc.value, '', 'a missing modal field was guessed into existence');
  const retries = h.drain(10);
  assert(retries >= 2 && retries < 10, 'the bounded late-paint hand-off did not settle');
  assert.strictEqual(h.queue.length, 0, 'the settled hand-off left a retry loop running');
  assert.strictEqual(h.fields.mlsStudyBProc.value, 'lumbar transforaminal ESI');
  assert.strictEqual(h.fields.mlsStudyBFrom.value, '2026-01-01');
  assert.strictEqual(h.fields.mlsStudyBTo.value, '2026-09-12');
  for (const field of Object.values(h.fields)) assert.deepStrictEqual(field.events, ['input', 'change'], 'a copied filter did not notify the destination UI');
}

{
  const h = harness({ proc: '', icd: 'M17.11', from: '', to: '' }, false);
  h.setPainted(true);
  h.drain(3);
  assert.strictEqual(h.fields.mlsStudyBProc.value, 'M17.11', 'ICD fallback did not reach the procedure field');
  assert.deepStrictEqual(h.fields.mlsStudyBProc.events, ['input', 'change']);
  assert.deepStrictEqual(h.fields.mlsStudyBFrom.events, [], 'a blank date fired a fake destination change');
  assert.deepStrictEqual(h.fields.mlsStudyBTo.events, [], 'a blank date fired a fake destination change');
}

{
  const h = harness({ proc: '20610', icd: '', from: '', to: '' }, true);
  const retries = h.drain(100);
  assert.strictEqual(retries, 29, 'missing destination fields did not stop at the bounded retry ceiling');
  assert.strictEqual(h.queue.length, 0, 'missing fields created an unbounded timer loop');
  assert(/filters are still loading/i.test(h.note.textContent), 'the permanent late-paint failure stayed silent');
}

console.log('PASS Study procedure hand-off: opens tab B, survives delayed fields, copies procedure/date filters with events, and fails visibly after a bounded retry');
