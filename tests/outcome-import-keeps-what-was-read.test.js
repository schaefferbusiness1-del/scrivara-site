'use strict';
/* The outcome study's AI import keeps the rows that were read (sweepfix-1.0.0).
   When part of a spreadsheet could not be read even after a retry, the server
   answers 502 { ok:false, code:'import_incomplete', incomplete:true, patients,
   notImportedRows, error }. The app showed "AI import failed" and threw away
   every patient that WAS read. Now it names the missing rows and offers
   "Try again" or "Use the N patients that were read"; the study then says how
   many rows are not in it. Runs the real functions from mls-outcome-study.js. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'mls-outcome-study.js'), 'utf8');
function fnBlock(name) {
  const at = src.indexOf('function ' + name + '(');
  assert(at >= 0, name + ' not found');
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at, i + 1);
}

function el(tag) {
  const e = { tag, style: {}, children: [], textContent: '', innerHTML: '', listeners: {}, parentNode: null,
    appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
    removeChild(c) { e.children = e.children.filter((x) => x !== c); c.parentNode = null; },
    addEventListener(t, f) { e.listeners[t] = f; }, scrollTop: 0, scrollHeight: 0 };
  return e;
}

async function run(reply) {
  const logEl = el('div');
  const box = { querySelector: (q) => (q === '#ocAiLog' ? logEl : null) };
  const calls = { finished: [], tries: 0 };
  const ctx = {
    document: { createElement: el },
    esc: (s) => String(s),
    redMsg: (t) => '⚠ ' + t,
    renderAiProgress() {},
    aiLog(b, t) { const d = el('div'); d.innerHTML = t; logEl.appendChild(d); },
    readWorkbookSheets(file, cb) { cb(null, [{ name: 'S1', rows: [['a'], ['b'], ['c']] }]); },
    aiAuthToken: () => 'tok',
    aiEndpoint: () => 'https://api.example.test/api/outcome/import',
    finishAiImport(j, name) { calls.finished.push({ n: j.patients.length, name, unread: (j.notImportedRows || []).length }); },
    fetch: async () => { calls.tries++; return { status: reply.status, json: async () => JSON.parse(JSON.stringify(reply.body)) }; },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fnBlock('aiImportFile') + '\n' + fnBlock('offerPartialImport') + '\nthis.aiImportFile = aiImportFile;', ctx);
  ctx.aiImportFile({ name: 'outcomes.xlsx' }, box);
  await new Promise((r) => setTimeout(r, 30));
  return { logEl, calls, text: () => logEl.children.map((c) => c.innerHTML || c.children.map((b) => b.textContent).join(' | ')).join('\n') };
}

(async () => {
  const partial = { status: 502, body: { ok: false, incomplete: true, code: 'import_incomplete', retryable: true,
    error: 'The AI could not read 20 of 120 spreadsheet rows (S1 rows 41-60), so their patients would be missing from the study',
    patients: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], rowsNotImported: 20,
    notImportedRows: Array.from({ length: 20 }, (_, i) => ({ sheet: 'S1', index: 40 + i })) } };
  const r = await run(partial);
  const t = r.text();
  assert.ok(!/AI import failed/.test(t), 'a partly read sheet is not reported as a failed import: ' + t);
  assert.match(t, /S1 rows 41-60/, 'the missing rows are named');
  const row = r.logEl.children[r.logEl.children.length - 1];
  const labels = row.children.map((b) => b.textContent);
  assert.deepStrictEqual(labels, ['Try again', 'Use the 3 patients that were read'], 'the doctor chooses: ' + JSON.stringify(labels));
  assert.strictEqual(r.calls.finished.length, 0, 'nothing is imported until the doctor chooses');
  row.children[1].listeners.click();
  assert.deepStrictEqual(r.calls.finished, [{ n: 3, name: 'outcomes.xlsx', unread: 20 }], 'the patients that were read are imported, with the unread rows passed on');
  assert.ok(!row.parentNode, 'the choice goes away once made');

  const again = await run(partial);
  const row2 = again.logEl.children[again.logEl.children.length - 1];
  row2.children[0].listeners.click();
  await new Promise((res) => setTimeout(res, 30));
  assert.strictEqual(again.calls.tries, 2, 'Try again sends the sheet again');

  /* a plain failure is still a failure */
  const fail = await run({ status: 500, body: { ok: false, error: 'Extraction failed.' } });
  assert.match(fail.text(), /AI import failed: Extraction failed\./);
  assert.strictEqual(fail.calls.finished.length, 0);

  /* the study banner says how many rows are not in it */
  const banner = vm.runInNewContext(fnBlock('aiBannerHTML') + ';aiBannerHTML', { esc: String });
  const html = banner({ filename: 'outcomes.xlsx', studies: [1, 2, 3], scoreCells: 9, saved: { patients: 3 }, skipped: new Array(20).fill({}) });
  assert.match(html, /20 spreadsheet row\(s\) could not be read and are not in this study/);
  assert.match(fnBlock('finishAiImport'), /resp\.notImportedRows/, 'the unread rows reach the study as skipped rows');

  console.log('PASS outcome import keeps what was read: a partly read sheet names the missing rows and offers Try again or the patients that were read; the study says how many rows are not in it');
})().catch((e) => { console.error(e); process.exit(1); });
