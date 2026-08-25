'use strict';

/* Browser-level contract for the promoted Generate-one-note lane. This mounts
 * the real facade function and clicks the actual #ez3flGen node; the small
 * engine stub below only supplies the lifecycle receipts that the shipped
 * generation engine emits synchronously before backend work. The assertions
 * deliberately exercise the DOM, event loop, CSS fallback, and the live
 * computePhase/onGeneration handlers together. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

function extractFunction(text, marker) {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, `missing ${marker}`);
  const open = text.indexOf('{', at);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${marker}`);
}

const topFn = extractFunction(source, 'function generateTopNote()');
const rawErrFn = extractFunction(source, 'function ez3RawEngineErr()');
const stampFn = extractFunction(source, 'function ez3StampGenClick()');
const reasonFn = extractFunction(source, 'function ez3EngineReason()');
const phaseFn = extractFunction(source, 'function computePhase()');
const startedFn = extractFunction(source, 'function onGenerationStarted(ev)');
const refusedFn = extractFunction(source, 'function onGenerationRefused(ev)');
const settledFn = extractFunction(source, 'function onGenerationSettled(ev)');
const topVisibleFn = extractFunction(source, 'function topLaneIsVisible(rec)');
const ownershipFn = extractFunction(source, 'function syncTopGenerationOwnership(rec, gb)');

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => { console.error('pageerror:', error.message); });
    await page.setContent(`<!doctype html><html><head>
      <style>
        body.ez3fl-top-gen-owns #ez3Gen,
        body.ez3fl-top-gen-owns #ez3GenBusy { display:none!important }
        .ez3fl-record { display:block; width:320px; height:180px }
      </style>
    </head><body><main id="mlsEz3Body"><section class="ez3fl-record">
      <button id="ez3flGen" type="button">Generate one note</button>
      <textarea id="ez3flTranscript"></textarea>
      <button id="ez3Gen" type="button">Canonical Generate</button>
      <button id="ez3GenBusy" type="button">Generating</button>
    </section></main>
    <textarea id="transcript"></textarea><textarea id="noteBox"></textarea><button id="genBtn" type="button">Engine Generate</button>
    <div id="genError"></div><div id="noteGenError"></div></body></html>`);

    await page.addScriptTag({ content: `
      var S = window.__ez3TestState = { phase:'idle', recStart:0, genClickedAt:0,
        generationRunId:0, signedAt:0, lastWarn:'', genErrBefore:'' };
      var scenario = 'success', calls = { facade:0, canonical:0, engine:0, toasts:[] };
      window.__ez3Calls = calls;
      function $(id) { return document.getElementById(id); }
      function recordingNow() { return false; }
      function isRecording() { return false; }
      function noteText() { return String(($('noteBox') || {}).value || ''); }
      function bindingNotice() {}
      function render() {}
      function flowToast(message) { calls.toasts.push(String(message)); }
      function syncTopLane() {}
      ${rawErrFn}
      ${stampFn}
      ${reasonFn}
      ${phaseFn}
      ${startedFn}
      ${refusedFn}
      ${settledFn}
      ${topVisibleFn}
      ${ownershipFn}
      window.addEventListener('mls:generation-started', onGenerationStarted);
      window.addEventListener('mls:generation-refused', onGenerationRefused);
      window.addEventListener('mls:generation-settled', onGenerationSettled);
      function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail:detail })); }
      $('genBtn').onclick = function () {
        calls.engine += 1;
        if (scenario === 'no-dispatch') return;
        if (scenario === 'sparse-refusal') {
          $('genError').textContent = 'Add one specific detail from today: symptom, finding, assessment, or plan.';
          emit('mls:generation-refused', {runId:11, code:'sparse-today-evidence', message:$('genError').textContent});
          emit('mls:generation-settled', {runId:11, status:'refused', code:'sparse-today-evidence', message:$('genError').textContent});
          return;
        }
        if (scenario === 'stale-refusal') {
          emit('mls:generation-refused', {runId:13, code:'sparse-today-evidence', message:''});
          emit('mls:generation-settled', {runId:13, status:'refused', code:'sparse-today-evidence', message:''});
          return;
        }
        emit('mls:generation-started', {runId:12});
        if (scenario === 'backend-failure') {
          $('genError').textContent = 'OpenAI API key is missing. Open Settings → Integrations.';
          emit('mls:generation-settled', {runId:12, status:'failed', code:'ai-unavailable', message:$('genError').textContent});
        } else if (scenario === 'success') {
          $('noteBox').value = 'HPI: current symptoms documented.\\n\\nROS: not documented.\\n\\nEXAM: not documented.\\n\\nASSESSMENT: stable.\\n\\nPLAN: follow up.';
          emit('mls:generation-settled', {runId:12, status:'success', code:'', message:''});
        }
      };
      ${topFn}
      $('ez3flGen').addEventListener('click', function () { calls.facade += 1; generateTopNote(); });
      $('ez3Gen').addEventListener('click', function () { calls.canonical += 1; ez3StampGenClick(); $('genBtn').click(); });
      $('ez3flGen').hidden = false;
      syncTopGenerationOwnership(document.querySelector('.ez3fl-record'), $('ez3flGen'));
      window.__ez3Run = function (kind, text) {
        scenario = kind;
        calls.facade = calls.canonical = calls.engine = 0; calls.toasts = [];
        S.phase = 'idle'; S.genClickedAt = 0; S.generationRunId = 0; S.lastWarn = '';
        $('transcript').value = text || '';
        $('noteBox').value = '';
        $('genError').textContent = '';
        $('noteGenError').textContent = '';
        $('genBtn').disabled = false;
        $('ez3flGen').click();
      };
      window.__ez3Timeout = function () {
        scenario = 'timeout';
        calls.facade = calls.canonical = calls.engine = 0; calls.toasts = [];
        S.phase = 'idle'; S.genClickedAt = 0; S.generationRunId = 0; S.lastWarn = '';
        $('transcript').value = 'the patient is fine';
        $('noteBox').value = '';
        $('genError').textContent = '';
        $('noteGenError').textContent = '';
        $('ez3flGen').click();
        $('genBtn').disabled = true;
        $('genError').textContent = 'The generation backend timed out after the bounded deadline.';
        S.genClickedAt = Date.now() - 181000;
        computePhase();
      };
      window.__ez3Stale = function () {
        scenario = 'stale-refusal';
        calls.facade = calls.canonical = calls.engine = 0; calls.toasts = [];
        S.phase = 'idle'; S.genClickedAt = 0; S.generationRunId = 0; S.lastWarn = '';
        $('transcript').value = 'the patient is fine';
        $('noteBox').value = '';
        $('genError').textContent = 'A previous attempt failed with a private old reason.';
        $('noteGenError').textContent = '';
        $('genBtn').disabled = false;
        $('ez3flGen').click();
      };
    ` });

    const rich = 'Right knee pain for two weeks, worse on stairs. Exam shows medial joint line tenderness. Plan NSAIDs and physical therapy.';
    const success = await page.evaluate(async text => {
      window.__ez3Run('success', text);
      await new Promise(resolve => setTimeout(resolve, 10));
      return { ...window.__ez3TestState, calls: window.__ez3Calls };
    }, rich);
    const successReceipt = await page.evaluate(() => ({ state: window.__ez3TestState,
      facade: window.__ez3Calls.facade, canonical: window.__ez3Calls.canonical,
      engine: window.__ez3Calls.engine, toasts: window.__ez3Calls.toasts }));
    assert.strictEqual(successReceipt.facade, 1, 'clicking #ez3flGen did not enter the visible facade exactly once');
    assert.strictEqual(successReceipt.canonical, 1, 'visible facade dispatched the canonical action more than once or not at all');
    assert.strictEqual(successReceipt.engine, 1, 'canonical action did not dispatch #genBtn exactly once');
    assert.strictEqual(successReceipt.state.phase, 'note', 'success receipt did not leave the Easy phase at note');
    assert.deepStrictEqual(successReceipt.toasts, [], 'success path showed a failure toast');

    const sparse = await page.evaluate(async () => {
      window.__ez3Run('sparse-refusal', 'the patient is fine');
      await new Promise(resolve => setTimeout(resolve, 10));
      return { state: window.__ez3TestState, facade: window.__ez3Calls.facade,
        canonical: window.__ez3Calls.canonical, engine: window.__ez3Calls.engine,
        toasts: window.__ez3Calls.toasts };
    });
    assert.deepStrictEqual({ facade:sparse.facade, canonical:sparse.canonical, engine:sparse.engine }, { facade:1, canonical:1, engine:1 },
      'sparse transcript was pre-judged or dispatched twice; trusted history must remain an engine decision');
    assert.strictEqual(sparse.state.lastWarn, 'Add one specific detail from today: symptom, finding, assessment, or plan.',
      'sparse refusal did not preserve the specific engine reason');

    const failure = await page.evaluate(async () => {
      window.__ez3Run('backend-failure', 'the patient reports improved pain and the exam is stable');
      await new Promise(resolve => setTimeout(resolve, 10));
      return { state: window.__ez3TestState, calls: window.__ez3Calls };
    });
    assert.strictEqual(failure.state.phase, 'stopped', 'backend failure did not stop the phase');
    assert.match(failure.state.lastWarn, /OpenAI API key is missing/, 'backend failure lost the actionable engine reason');

    const timeout = await page.evaluate(async () => {
      window.__ez3Timeout();
      await new Promise(resolve => setTimeout(resolve, 10));
      return { state: window.__ez3TestState, calls: window.__ez3Calls };
    });
    assert.strictEqual(timeout.state.phase, 'stopped', 'timeout did not stop the phase');
    assert.match(timeout.state.lastWarn, /bounded deadline/, 'timeout lost its specific engine reason');

    const stale = await page.evaluate(async () => {
      window.__ez3Stale();
      await new Promise(resolve => setTimeout(resolve, 10));
      return { state: window.__ez3TestState, calls: window.__ez3Calls };
    });
    assert.strictEqual(stale.calls.engine, 1, 'stale-error attempt did not reach the engine exactly once');
    assert.match(stale.state.lastWarn, /Note generation was refused/, 'unchanged stale error was not replaced by the actionable generic refusal: ' + JSON.stringify(stale));
    assert.ok(!/private old reason/.test(stale.state.lastWarn), 'a previous attempt error leaked into the current refusal');

    const noDispatch = await page.evaluate(async () => {
      window.__ez3Run('no-dispatch', 'the patient reports improvement today');
      await new Promise(resolve => setTimeout(resolve, 160));
      return { state: window.__ez3TestState, calls: window.__ez3Calls };
    });
    assert.strictEqual(noDispatch.calls.engine, 1, 'no-dispatch scenario did not reach the canonical engine once: ' + JSON.stringify(noDispatch));
    assert.ok(noDispatch.calls.toasts.some(text => /did not start|unavailable/.test(text)),
      'hidden delegation failure remained silent');

    const controls = await page.evaluate(() => {
      document.body.classList.add('ez3fl-top-gen-owns');
      const yielded = getComputedStyle(document.getElementById('ez3Gen')).display === 'none' &&
        getComputedStyle(document.getElementById('ez3GenBusy')).display === 'none';
      document.body.classList.remove('ez3fl-top-gen-owns');
      const restored = getComputedStyle(document.getElementById('ez3Gen')).display !== 'none';
      return { yielded, restored };
    });
    assert.deepStrictEqual(controls, { yielded:true, restored:true },
      'the JS duplicate-control fallback did not yield the lower controls only while the top lane owns Generate');

    console.log('PASS ez3-generate-top-browser-runtime: actual #ez3flGen click dispatches once through canonical Generate/#genBtn; sparse/history, backend failure, timeout, success, no-op failure, and duplicate-control fallback are covered');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
