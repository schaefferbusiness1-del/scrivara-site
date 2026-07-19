'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const detailSource = fs.readFileSync(path.join(root, 'feat_visit_note_detail.js'), 'utf8');
const autosaveSource = fs.readFileSync(path.join(root, 'feat_autosave.js'), 'utf8');

function between(source, startText, endText, label) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert(start >= 0 && end > start, 'could not isolate ' + label);
  return source.slice(start, end);
}

const detailWrapper = between(
  detailSource,
  'var _origONFH = null;',
  '/* Capture-phase delegate',
  'visit-detail wrapper'
);
const autosaveWrapper = between(
  autosaveSource,
  'function wrapOpenNote()',
  '// a Save click inside the raw-note modal',
  'autosave history wrapper'
);

function harness() {
  const baseCalls = [];
  function base(id) {
    baseCalls.push(String(id));
    return 'raw:' + id;
  }
  const window = { openNoteFromHistory: base };
  const context = {
    window,
    isFn(fn) { return typeof fn === 'function'; },
    openNoteDetail(id) { return 'modern:' + id; },
    safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
    _curViewNoteId: '',
    _wrapped: [],
    setTimeout(fn) { fn(); return 1; },
    gid() { return null; },
    maybePrompt() {}
  };
  vm.createContext(context);
  return { context, window, base, baseCalls };
}

/* Production load order: modern detail wraps the native opener, then autosave
   wraps modern detail. The detail retry must recognize that transitive owner
   and must keep its first native/raw opener. */
{
  const h = harness();
  vm.runInContext(detailWrapper, h.context, { filename: 'feat_visit_note_detail.js#wrapper' });
  h.context.wrapONFH();
  const detail = h.window.openNoteFromHistory;
  assert.strictEqual(detail.__mlsNoteDetail, true, 'modern detail did not install');

  vm.runInContext(autosaveWrapper, h.context, { filename: 'feat_autosave.js#wrapper' });
  h.context.wrapOpenNote();
  const autosave = h.window.openNoteFromHistory;
  assert.strictEqual(autosave.__mlsAsOrig, detail, 'autosave did not wrap modern detail');
  assert.strictEqual(autosave.__mlsContainsNoteDetail, true,
    'autosave did not preserve transitive modern-detail ownership');

  h.context.wrapONFH(); // the real 125 ms install retry
  assert.strictEqual(h.window.openNoteFromHistory, autosave,
    'detail retry wrapped an autosave chain that already contained detail');

  assert.strictEqual(h.context.callOriginal('note-A'), 'raw:note-A');
  assert.deepStrictEqual(h.baseCalls, ['note-A'],
    'Edit raw note re-entered the modern detail wrapper instead of the native editor');

  /* Even an older/unmarked third-party wrapper must not replace the first raw
     opener if a later retry needs to reinstall the modern owner. */
  const prior = h.window.openNoteFromHistory;
  h.window.openNoteFromHistory = function legacyWrapper(id) { return prior(id); };
  h.context.wrapONFH();
  assert.strictEqual(h.context.callOriginal('note-B'), 'raw:note-B');
  assert.deepStrictEqual(h.baseCalls, ['note-A', 'note-B'],
    'an unmarked late wrapper overwrote the stable raw opener');
}

/* Reverse load order remains valid: if autosave owns the native opener first,
   modern detail may retain that non-recursive chain as its raw escape hatch. */
{
  const h = harness();
  vm.runInContext(autosaveWrapper, h.context, { filename: 'feat_autosave.js#wrapper-first' });
  h.context.wrapOpenNote();
  const autosave = h.window.openNoteFromHistory;
  vm.runInContext(detailWrapper, h.context, { filename: 'feat_visit_note_detail.js#wrapper-second' });
  h.context.wrapONFH();
  assert.strictEqual(h.context.callOriginal('note-C'), 'raw:note-C');
  assert.strictEqual(h.context._curViewNoteId, 'note-C',
    'reverse load order bypassed autosave raw-note tracking');
  assert.deepStrictEqual(h.baseCalls, ['note-C']);
  assert.strictEqual(autosave.__mlsAsOrig, h.base);
}

console.log('PASS History raw-note wrapper: all load orders keep a stable non-recursive native editor escape hatch');
