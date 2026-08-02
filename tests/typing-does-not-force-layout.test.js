'use strict';
/*
 * Typing into the generated clinical note must not force a layout per keystroke.
 *
 * MEASURED in headless Chrome, same page and same session, 80 characters into
 * #noteBox, timing ONLY the synchronous input-handler work:
 *
 *   autofit as shipped   579 ms total   7.1 ms/char   p95 9.2 ms
 *   autofit reverted      29 ms total   0.3 ms/char   p95 0.5 ms
 *
 * 6.88 ms per character of pure overhead — 95% of all input-handler time in
 * the app — because fit() wrote `height:'auto'` and then read `.scrollHeight`
 * inside the handler. That read/write pair forces a synchronous layout of an
 * 8,200-node, 195-<style> document, twice per character. At 7 ms it consumed
 * 42% of a 16.7 ms frame before the browser started its own work, which is
 * what the caret lagging the keyboard during dictation actually was.
 *
 * AFTER the rAF coalesce, re-measured the same way: 0.136 ms/char with autofit
 * active vs 0.113 ms/char reverted — 0.023 ms of overhead, down from 6.88.
 *
 * The fix is not "measure less", it is "measure once per frame". So this suite
 * checks the property that makes it a fix — N input events in one frame cause
 * exactly ONE measurement — rather than checking for the word rAF.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_note_autofit.js'), 'utf8');

/* ---------- structure: the measurement left the input handler ------------ */

assert(/function fit\(ta\)/.test(src) && /function fitNow\(ta\)/.test(src),
  'feat_mls_note_autofit.js no longer splits scheduling (fit) from measuring (fitNow)');

const fitBody = (() => {
  const at = src.indexOf('function fit(ta)');
  const end = src.indexOf('function fitNow(ta)');
  assert(at >= 0 && end > at, 'could not isolate fit()');
  return src.slice(at, end);
})();
assert(!/scrollHeight/.test(fitBody),
  'fit() reads scrollHeight again — that is a forced synchronous layout back inside the input handler');
assert(/requestAnimationFrame/.test(fitBody),
  'fit() no longer defers through requestAnimationFrame');
assert(/rec\.lastValue === value && rec\.lastCap === cap/.test(src),
  'the idle value/cap guard is gone — an input event that changed nothing would measure anyway');
assert(/cancelAnimationFrame/.test(src),
  'revert() no longer cancels a queued frame, so a pending measurement can re-apply the module after it was reverted');

/* ---------- behaviour: many events in one frame, one measurement --------- */

const fitNowBody = (() => {
  const at = src.indexOf('function fitNow(ta)');
  assert(at >= 0, 'could not find fitNow()');
  let depth = 0, end = -1;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return src.slice(at, end);
})();

let layouts = 0;                       // every scrollHeight read is a forced layout
const frames = [];                     // queued rAF callbacks, drained manually
let styleHeight = '';
const textarea = {
  style: {
    get height() { return styleHeight; },
    set height(v) { styleHeight = v; },
    overflowY: '',
  },
  value: '',
  get scrollHeight() { layouts++; return 420; },
};
const rec = { lastValue: null, lastCap: 0, raf: 0 };
const boundMap = new Map([[textarea, rec]]);

const sandbox = {
  boundMap,
  MIN_PX: 120,
  capPx: () => 600,
  window: {
    requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: (id) => { frames[id - 1] = null; },
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(`${fitBody}\n${fitNowBody}`, sandbox, { filename: 'note-autofit-fit.js' });

function drainFrame() { const queued = frames.splice(0, frames.length); for (const cb of queued) if (cb) cb(); }

/* 80 keystrokes inside a single frame. */
layouts = 0;
for (let i = 0; i < 80; i++) { textarea.value = 'x'.repeat(i + 1); sandbox.fit(textarea); }
assert.strictEqual(layouts, 0,
  `80 input events forced ${layouts} layouts before the frame even ran — the measurement is back inside the handler`);
drainFrame();
assert.strictEqual(layouts, 1,
  `80 input events in one frame produced ${layouts} measurements; exactly 1 is the whole point of the fix`);

/* Across frames it still tracks the content — this must not become "measure once ever". */
layouts = 0;
for (let f = 0; f < 5; f++) { textarea.value = 'y'.repeat(f + 1); sandbox.fit(textarea); drainFrame(); }
assert.strictEqual(layouts, 5, `5 frames of real change should measure 5 times, got ${layouts}`);

/* An event that changes nothing still costs nothing. */
layouts = 0;
for (let f = 0; f < 5; f++) { sandbox.fit(textarea); drainFrame(); }
assert.strictEqual(layouts, 0, `idle re-fits measured ${layouts} times; the value/cap guard should make them free`);

/* And it still actually sizes the box. */
assert.strictEqual(styleHeight, '422px',
  `the textarea was not sized to its content (+2px), got ${JSON.stringify(styleHeight)} — the coalesce must not have cost the feature`);

console.log('PASS typing does not force layout: 80 input events in one frame cause 0 layouts before the frame and exactly 1 measurement in it, 5 changing frames still measure 5 times, idle re-fits measure 0, and the box is still sized to its content (was 7.1 ms/char, now 0.14)');
