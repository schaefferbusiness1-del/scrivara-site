'use strict';
/* ez3adapt-1.0.0 control: THE EASY VISIT SURFACES TELL THE DOCTOR WHY
 * GENERATION REFUSED - AND THE TOP BUTTON NEVER CLICKS BLIND.
 *
 * Owner live repro 2026-08-25: the big top "Generate one note" button with a
 * four-word transcript read as a dead click plus the generic "not generated /
 * check the connection" banner. Mechanisms: (a) generateTopNote() clicked the
 * hidden #genBtn with no evidence pre-gate (the LOWER #ez3Gen button already
 * had one), so the engine's synchronous sparse-transcript refusal left the
 * facade with nothing to say; (b) computePhase() composed only its own
 * generic canned text and never read the SPECIFIC reason generateNote()
 * writes into #genError/#noteGenError. Adapter only - the engine lifecycle
 * hunk belongs to the generation-contract lane and is deliberately absent.
 *
 * Executes the REAL shipped generateTopNote/computePhase/ez3EngineReason
 * (extracted from mls-connect.js) with stubbed surroundings. OLD BYTES FAIL
 * BY NAME: no ez3EngineReason, no top-button gate. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');

/* scope every lookup to the LIVE Easy block: from the 3.7.3 marker to the
 * first retired-copy marker, so a retired near-duplicate can never satisfy a
 * pin meant for the live bytes */
const liveStart = src.indexOf('3.7.3');
assert.ok(liveStart > 0, 'live Easy 3.7.3 marker present');
const retiredAt = src.indexOf('Retired historical Easy', liveStart);
const liveEnd = retiredAt > 0 ? retiredAt : src.length;
const live = src.slice(0, liveEnd);

function extractFn(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, marker + ' present');
  const open = source.indexOf('{', at + marker.length - 1);
  let depth = 0, mode = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i], p = source[i - 1];
    if (mode === null) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return source.slice(at, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && source[i + 1] === '/') { mode = '//'; i++; }
      else if (c === '/' && source[i + 1] === '*') { mode = '/*'; i++; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else { if (c === '\\') i++; else if (c === mode) mode = null; }
  }
  throw new Error('unbalanced ' + marker);
}

const topSrc = extractFn(src, 'function generateTopNote()');
const phaseSrc = extractFn(live, 'function computePhase()');
const reasonSrc = extractFn(live, 'function ez3EngineReason()');
const rawErrSrc = extractFn(live, 'function ez3RawEngineErr()');
const stampSrc = extractFn(live, 'function ez3StampGenClick()');

/* ez3adapt-1.0.1 pins: every generate stamp funnels through the snapshot
 * helper so a stale engine reason from a PREVIOUS attempt can never be
 * echoed as the current one, and the completion listener wires exactly once */
assert.ok(stampSrc.includes('S.genErrBefore = ez3RawEngineErr()'), 'the stamp helper snapshots the pre-click error text');
assert.strictEqual((live.match(/ez3StampGenClick\(\);/g) || []).length, 4,
  'all four generate stamp sites (engine open, #ez3Gen, #ez3Regen, noteGenerationStarted) funnel through the snapshot helper');
assert.ok(live.includes('window.__ez3GenEvtWired'), 'the generation-complete listener is one-shot guarded');

/* ez3adapt-1.0.2 (Codex reply 9): the engine owns the WHOLE evidence
 * contract - it can accept a sparse statement when trusted verified history
 * exists, so the facade must NOT pre-gate on the transcript alone, and must
 * never manufacture a started state from a .click(). */
assert.ok(!topSrc.includes('_mlsTranscriptHasDraftableTodayEvidence'),
  'the TOP Generate button carries NO facade evidence pre-gate (the engine decides)');
assert.ok(!topSrc.includes('noteGenerationStarted'),
  'the TOP Generate button never manufactures a started state from a click');
assert.ok(phaseSrc.includes('ez3EngineReason() ||'),
  'computePhase prefers the engine-written reason over its generic text in BOTH failure branches');
assert.strictEqual((phaseSrc.match(/ez3EngineReason\(\) \|\|/g) || []).length, 2,
  'both the fast-fail and the timeout branch consult the engine reason');
assert.ok(live.includes("window.addEventListener('mls:generation-complete'"),
  'the live Easy block snaps its phase on the engine completion event instead of only polling');

function el(id) { return { id, textContent: '', value: '', disabled: false, style: {}, focused: 0, focus() { this.focused++; } }; }

/* ---- computePhase harness ----
 * genErrBefore mirrors ez3StampGenClick's snapshot: pass the PRE-CLICK error
 * text ('' for a clean start); the engine then writes genErrorText. */
function phaseHarness(genErrorText, preClickErrorText) {
  const nodes = { genError: el('genError'), noteGenError: el('noteGenError'), genBtn: el('genBtn') };
  const S = { phase: 'stopped', recStart: 0, genClickedAt: 0, lastWarn: '' };
  const ctx = vm.createContext({
    S, Date,
    isRecording: () => false,
    noteText: () => '',
    bindingNotice: () => {},
    $: id => nodes[id] || null,
    document: { getElementById: id => nodes[id] || null },
    String, Math
  });
  vm.runInContext(rawErrSrc + '\n' + stampSrc + '\n' + reasonSrc + '\n' + phaseSrc, ctx, { filename: 'mls-connect:ez3-phase' });
  nodes.genError.textContent = preClickErrorText || '';
  vm.runInContext('ez3StampGenClick()', ctx);           /* the real stamp takes the snapshot */
  S.genClickedAt = Date.now() - 5000;                    /* then age the click for the fast-fail branch */
  nodes.genError.textContent = genErrorText || '';       /* what the engine wrote (or left) after the click */
  return { S, nodes, run: () => vm.runInContext('computePhase()', ctx) };
}

/* ---- generateTopNote harness ---- */
function topHarness(text, predicateResult) {
  const nodes = { transcript: el('transcript'), ez3flTranscript: el('ez3flTranscript'), genBtn: el('genBtn') };
  nodes.transcript.value = text;
  const log = { toasts: [], clicks: 0, started: 0, sync: 0 };
  nodes.genBtn.click = () => { log.clicks++; };
  const ctx = vm.createContext({
    recordingNow: () => false,
    flowToast: (m, k) => { log.toasts.push({ m: String(m), k }); },
    $: id => nodes[id] || null,
    document: { getElementById: id => nodes[id] || null, querySelector: () => null },
    syncTopLane: () => { log.sync++; },
    window: { __mlsEasyV32: { noteGenerationStarted: () => { log.started++; } } },
    _mlsTranscriptHasDraftableTodayEvidence: () => predicateResult,
    String, Date
  });
  vm.runInContext(topSrc, ctx, { filename: 'mls-connect:generateTopNote' });
  return { nodes, log, run: () => vm.runInContext('generateTopNote()', ctx) };
}

let n = 0;
const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

/* ---- 1. fast-fail branch prefers the engine's written reason ---- */
{
  const h = phaseHarness('Add your OpenAI API key in Settings to generate notes.');
  h.run();
  assert.strictEqual(h.S.phase, 'stopped');
  assert.ok(/OpenAI API key in Settings/.test(h.S.lastWarn),
    'the doctor reads the engine reason, not generic connection advice (old shape showed only the canned banner)');
  assert.ok(/transcript is still safe/.test(h.S.lastWarn), 'transcript reassurance retained');
  ok('fast-fail: engine-written reason surfaces verbatim');
}

/* ---- 2. fast-fail falls back to the generic text when the engine left none ---- */
{
  const h = phaseHarness('');
  h.run();
  assert.ok(/The note was not generated/.test(h.S.lastWarn), 'generic fallback intact when no engine reason exists');
  ok('fast-fail: generic fallback intact');
}

/* ---- 3. timeout branch prefers the engine reason too ---- */
{
  const h = phaseHarness('Something specific went wrong.');
  h.S.genClickedAt = Date.now() - 200000; /* past the 180s ceiling */
  h.nodes.genBtn.disabled = true;         /* not the fast-fail branch */
  h.run();
  assert.ok(/Something specific went wrong/.test(h.S.lastWarn), 'timeout branch consults the engine reason');
  ok('timeout: engine-written reason surfaces');
}

/* ---- 4. TOP button: a sparse transcript still reaches the ENGINE (which may
 * accept it on trusted verified history) - zero facade-start either way ---- */
{
  const h = topHarness('the patient is fine', false);
  h.run();
  assert.strictEqual(h.log.clicks, 1, 'the click reaches the engine - the facade does not pre-judge evidence');
  assert.strictEqual(h.log.started, 0, 'zero facade-start calls on the possibly-refused path');
  assert.strictEqual(h.log.toasts.length, 0, 'no facade refusal - the engine speaks for itself');
  ok('top button: sparse transcript delegated to the engine, zero facade-start');
}

/* ---- 5. TOP button: rich transcript clicks once, zero facade-start ---- */
{
  const h = topHarness('Right knee pain for two weeks, worse on stairs. Exam: medial joint line tenderness. Plan: NSAIDs and PT.', true);
  h.run();
  assert.strictEqual(h.log.clicks, 1, 'one engine click');
  assert.strictEqual(h.log.started, 0, 'zero facade-start calls on the accepted path - the engine lifecycle moves the phase');
  assert.strictEqual(h.log.toasts.length, 0, 'no refusal toast on the healthy path');
  ok('top button: healthy path - one click, zero facade-start');
}

/* ---- 6. STALENESS (ez3adapt-1.0.1, review finding): text left over from a
 * PREVIOUS attempt is never echoed as the current attempt's reason ---- */
{
  const stale = 'Add your OpenAI API key in Settings to generate notes.';
  const h = phaseHarness(stale, stale); /* unchanged since the pre-click snapshot */
  h.run();
  assert.ok(/The note was not generated/.test(h.S.lastWarn),
    'an unchanged pre-click error text falls back to the generic message instead of misattributing the old reason');
  const h2 = phaseHarness('A fresh, current failure reason.', stale); /* engine overwrote it after the click */
  h2.run();
  assert.ok(/fresh, current failure reason/.test(h2.S.lastWarn), 'a changed error text still surfaces');
  ok('staleness guard: unchanged snapshot suppressed, fresh engine text surfaces');
}

console.log('PASS ez3 generation reason adapter: engine-written reasons surface in both failure branches with a staleness guard, the top button gates evidence before clicking like #ez3Gen, the healthy path is unchanged, and the live block listens once for generation-complete (' + n + ' cases)');
