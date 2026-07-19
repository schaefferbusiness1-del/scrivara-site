'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const setStart = source.indexOf('  function setWrapHtml(h) {');
const setEnd = source.indexOf('\n  function render() {', setStart);
assert(setStart >= 0 && setEnd > setStart, 'canonical setWrapHtml owner missing');
const setWrap = source.slice(setStart, setEnd);

assert(setWrap.includes("w.querySelectorAll('.ez3fl-record').forEach(function (n) { n.remove(); })"),
  'a stale hot-loaded satellite lane is not scrubbed before render');
assert(setWrap.includes('w.innerHTML = h;'), 'canonical Easy render is not one atomic replacement');
assert(!/_flowLaneKeep|insertBefore\(lane/.test(setWrap),
  'retired satellite lane parking/reinsertion remains active');

function makeRenderHarness() {
  const state = { activeElement: null, stopCalls: 0, listening: true, target: null };
  const wrapNode = {
    _transcript: null,
    querySelector(selector) { return selector === '#ez3Transcript' ? this._transcript : null; },
    querySelectorAll() { return []; },
    set innerHTML(html) {
      this._html = html;
      if (String(html).includes('id="ez3Transcript"')) {
        const fresh = makeTranscript('fresh');
        fresh.parentNode = makeParent();
        this._transcript = fresh;
      } else this._transcript = null;
    },
    get innerHTML() { return this._html || ''; }
  };
  function makeParent() {
    return {
      removeChild(node) { if (wrapNode._transcript === node) wrapNode._transcript = null; node.parentNode = null; },
      replaceChild(next, prior) {
        assert.strictEqual(wrapNode._transcript, prior, 'renderer tried to replace a non-current transcript');
        wrapNode._transcript = next; next.parentNode = this; prior.parentNode = null;
      }
    };
  }
  function makeTranscript(label) {
    return {
      id: 'ez3Transcript', label, className: 'ez3-transcript', placeholder: 'Visit transcript',
      disabled: false, readOnly: false, value: 'kept words', selectionStart: 4, selectionEnd: 9,
      parentNode: null, focusCalls: 0, selected: null,
      closest() { return null; },
      focus() { this.focusCalls += 1; state.activeElement = this; },
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; this.selected = [start, end]; }
    };
  }
  const original = makeTranscript('original');
  original.parentNode = makeParent();
  wrapNode._transcript = original;
  state.activeElement = original;
  state.target = original;
  const context = {
    console,
    document: {
      get activeElement() { return state.activeElement; },
      contains(node) { return wrapNode._transcript === node; }
    },
    window: {
      __mlsDictateAnywhere: {
        isTarget(node) { return state.listening && state.target === node; },
        stop() { state.stopCalls += 1; state.listening = false; }
      }
    },
    wrap() { return wrapNode; }
  };
  vm.runInNewContext(setWrap + '\nwindow.__setWrapHtmlForTest=setWrapHtml;', context, { filename: 'easy-set-wrap.js' });
  return { context, state, wrapNode, original };
}

/* Advanced/Phone/AVS/Orders repaint the same doctor phase. The exact textarea
 * object, focus/caret, and Dictate ownership must survive that repaint. */
const samePhase = makeRenderHarness();
samePhase.context.window.__setWrapHtmlForTest('<div><textarea id="ez3Transcript" class="ez3-transcript"></textarea></div>');
assert.strictEqual(samePhase.wrapNode._transcript, samePhase.original, 'same-phase Easy repaint replaced the active Dictate target node');
assert.strictEqual(samePhase.context.document.contains(samePhase.original), true, 'preserved transcript is no longer connected after repaint');
assert.strictEqual(samePhase.original.focusCalls, 1, 'focused transcript did not regain focus after repaint');
assert.deepStrictEqual(samePhase.original.selected, [4, 9], 'transcript caret/selection was not preserved across repaint');
assert.strictEqual(samePhase.context.window.__mlsDictateAnywhere.isTarget(samePhase.original), true, 'Dictate lost exact-node ownership across same-phase repaint');
assert.strictEqual(samePhase.state.stopCalls, 0, 'same-phase repaint unnecessarily stopped Dictate');

/* A real phase change intentionally removes the editor. It must stop only the
 * dictation session that owns this exact node rather than leave a detached mic. */
const phaseChange = makeRenderHarness();
phaseChange.context.window.__setWrapHtmlForTest('<div id="generatedNote">Generated note</div>');
assert.strictEqual(phaseChange.wrapNode._transcript, null, 'phase change unexpectedly kept a removed transcript');
assert.strictEqual(phaseChange.state.stopCalls, 1, 'phase change left Dictate attached to a detached transcript');

assert(source.includes('txTop.oninput = function ()'), 'preserved transcript input owner is not replaced deterministically after repaint');

const flowStart = source.indexOf(' * __mlsEz3Flow');
const flowIife = source.indexOf('(function () {', flowStart);
const retiredReturn = source.indexOf('  return;', flowIife);
const oldVersion = source.indexOf("var VERSION = 'fl-1.7.0'", flowIife);
assert(flowStart >= 0 && flowIife > flowStart && retiredReturn > flowIife && oldVersion > retiredReturn,
  'the late Easy flow owner is not retired before its observer/timer implementation');
assert(source.slice(flowIife, retiredReturn).includes("version: 'retired-b432'"),
  'retired Easy flow diagnostic receipt missing');

console.log('PASS Easy render ownership: one atomic canonical room with transcript node/focus/Dictate continuity');
