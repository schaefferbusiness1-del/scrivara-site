'use strict';

/* Execute the real readers and writers with synthetic identities. No browser,
   network, persistent patient store, or clinical write is involved. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let checks = 0;
function eq(actual, expected, label) { checks++; assert.equal(actual, expected, label); }
function fn(source, name) {
  const at = source.indexOf('function ' + name + '(');
  assert(at >= 0, 'missing function ' + name);
  const open = source.indexOf('{', at);
  let depth = 0, quote = '', escaped = false, line = false, comment = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (comment) { if (c === '*' && n === '/') { comment = false; i++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { comment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw Error('unterminated function ' + name);
}
function element(value = '') {
  const events = new Map();
  return { value, innerHTML: '', textContent: '', style: {}, children: [1],
    addEventListener(t, f) { events.set(t, f); },
    removeEventListener(t, f) { if (events.get(t) === f) events.delete(t); },
    fire(t) { const f = events.get(t); if (f) f(); },
    listeners: events,
    getAttribute(k) { return this[k]; }, setAttribute(k, v) { this[k] = v; }
  };
}
const A = { id: 'fixture-a', name: 'Fixture Alpha', dob: '01/01/1970' };
const B = { id: 'fixture-b', name: 'Fixture Beta', dob: '02/02/1980' };
function ui(source, allowSwitch) {
  const el = Object.fromEntries(['heroPtName', 'heroPtDob', 'heroPtList', 'patientLabel', 'heroPullStatus'].map(k => [k, element()]));
  let active = A, renders = 0, notices = 0;
  const ctx = { String, Array, Object, Date, Math, document: { getElementById: id => el[id] || null },
    activePatient: () => active, getActivePtId: () => active.id,
    setActivePtId: id => { if (allowSwitch) active = id === B.id ? B : A; },
    getPatients: () => [A, B], _heroPopulateList() {}, esc: x => String(x),
    _fmtApptTime: x => x, _calPickNowIdx: () => 0,
    _renderTodayPatients() { renders++; }, toast() { notices++; },
    renderProfile() {}, renderPatients() {}, renderPatientBar() {},
    _heroTodayList: [{ name: B.name, dob: B.dob, patient_external_id: B.id }],
    _athenaHistoryNameCompatible: (a, b) => a === b,
    _athenaHistoryDobSame: (a, b) => !!a && a === b
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const n of ['_heroSyncName', '_calLoadNextUp', '_heroPickPatient']) vm.runInContext(fn(source, n), ctx);
  return { ctx, el, active: () => active, renders: () => renders, notices: () => notices };
}

(async () => {
  const shells = ['1pScribeFlow.html', '1p/index.html'];
  let first = null;
  for (const file of shells) {
    const source = read(file);
    const h = ui(source, false);
    h.el.heroPtName.value = B.name; h.el.heroPtDob.value = B.dob;
    h.ctx._heroSyncName();
    eq(h.el.heroPtName.value, A.name, file + ': hero follows the selected header');
    eq(h.el.heroPtDob.value, A.dob, file + ': hero DOB follows the selected header');
    eq(h.el.patientLabel.value, A.name, file + ': note label follows the selected header');
    h.ctx._calLoadNextUp();
    eq(h.el.heroPtName.value, A.name, file + ': clock tick preserves selection');
    eq(h.el.heroPullStatus.innerHTML.includes('loaded &amp; ready'), false, file + ': another scheduled patient is not claimed loaded');
    eq(h.ctx._heroPickPatient(0), false, file + ': refused switch is reported as refused');
    eq(h.el.patientLabel.value, A.name, file + ': refused switch cannot repaint the requested identity');
    eq(h.notices(), 0, file + ': automatic/refused selection does not claim success');
    const accepted = ui(source, true);
    eq(accepted.ctx._heroPickPatient(0), true, file + ': allowed switch succeeds');
    eq(accepted.active().id, B.id, file + ': canonical selection changed');
    eq(accepted.el.heroPtName.value, B.name, file + ': hero reflects the selected target');
    eq(accepted.el.patientLabel.value, B.name, file + ': label reflects the selected target');
    const set = fn(source, 'setActivePtId');
    eq(set.indexOf('localStorage.setItem') < set.indexOf('_heroSyncName()'), true, file + ': sync reads the committed active identity');

    const transcript = element('Synthetic visit text');
    const lifecycle = [];
    const gen = { String, AbortController, Promise, _mlsGenerationSequence: 0, _mlsActiveGeneration: null,
      _mlsActiveGenerationTemplate: null, _mlsEmitGeneration: (kind, detail) => lifecycle.push({ kind, detail }),
      maybeApplyTemplate: () => new Promise(() => {}),
      _mlsAwaitGeneration: () => new Promise(() => {}), _mlsGenerationTimeoutMs: () => 1000
    };
    gen.window = gen; vm.createContext(gen);
    for (const n of ['_mlsAbortGenerationRun', '_mlsAbortActiveGeneration', '_mlsStartGeneration', '_mlsSettleGeneration', '_mlsStartOptionalTemplate']) vm.runInContext(fn(source, n), gen);
    const run = gen._mlsStartGeneration(transcript, { basis: 'today' });
    transcript.fire('input'); transcript.fire('input');
    eq(run.controller.signal.aborted, false, file + ': duplicate paste/mirror events preserve a healthy run');
    transcript.value += ' edited'; transcript.fire('input');
    eq(run.controller.signal.aborted, true, file + ': real transcript edit still aborts');
    eq(run.abortWasTranscriptEdit, true, file + ': real edit retains its neutral attribution');
    gen._mlsSettleGeneration(run, 'aborted', 'source-changed', 'Generate again.');
    eq(gen._mlsActiveGeneration, null, file + ': abort settlement releases the active run');
    eq(lifecycle.at(-1).kind, 'settled', file + ': abort reaches the facade lifecycle');
    eq(transcript.listeners.size, 0, file + ': settlement removes the input listener');
    gen._mlsStartOptionalTemplate(transcript.value, {}, 1, transcript);
    const optional = gen._mlsActiveGenerationTemplate;
    transcript.fire('input');
    eq(optional.controller.signal.aborted, false, file + ': unchanged input preserves optional formatting');
    transcript.value += ' changed'; transcript.fire('input');
    eq(optional.controller.signal.aborted, true, file + ': changed input cancels optional formatting');

    const changed = ['setActivePtId', '_heroSyncName', '_heroPickPatient', '_calLoadNextUp', '_mlsStartGeneration', '_mlsStartOptionalTemplate'].map(n => fn(source, n));
    if (first) changed.forEach((s, i) => eq(s, first[i], file + ': source twins preserve identical changed functions'));
    else first = changed;
  }

  const lock = read('feat_mls_patientlock_b53.js');
  const guard = vm.createContext({ safe: (f, d) => { try { return f(); } catch (_) { return d; } },
    switchState: () => 'allow', doctorGesture: () => false, wouldOverrideChosenChart: () => true });
  vm.runInContext(fn(lock, 'switchWillBeRefused'), guard);
  eq(guard.switchWillBeRefused('fixture-b'), true, 'automatic selection refusal is visible before any outer save/reset');
  guard.doctorGesture = () => true;
  eq(guard.switchWillBeRefused('fixture-b'), false, 'doctor may switch when no work is held');
  guard.switchState = () => 'ask';
  eq(guard.switchWillBeRefused('fixture-b'), true, 'pending consent still prevents outer mutations');

  const sync = vm.createContext({ window: { getActivePtId: () => A.id, _heroSyncName() {} },
    chipIdx() { throw Error('an active chart must prevent schedule adoption'); } });
  vm.runInContext(fn(read('feat_mls_upnow_sync.js'), 'adoptTopFromChip'), sync);
  sync.adoptTopFromChip({}); checks++;

  const connect = read('1p-mls-connect.js');
  const begin = connect.indexOf('  /* ===== upnowstate-1.0.0 begin');
  const end = connect.indexOf('  /* ===== upnowstate-1.0.0 end', begin);
  assert(begin > 0 && end > begin);
  const banner = vm.createContext({ String, Object, Array });
  vm.runInContext(connect.slice(begin, end), banner);
  const state = { upName: A.name, activeName: A.name, generating: true, transcript: 'fixture', note: 'prior draft' };
  eq(banner.upNowVisitState(state), 'generating', 'generation outranks a previous note');
  const node = element(); node.innerHTML = banner.UPNOW_HEAD + A.name + '</b>' + banner.UPNOW_SEP + banner.UPNOW_TAIL.ready;
  banner.upNowPaintBanner(node, state);
  eq(node['data-mls-upnow-state'], 'generating', 'banner paints active generation');
  state.generating = false; state.note = '';
  banner.upNowPaintBanner(node, state);
  eq(node['data-mls-upnow-state'], 'transcript', 'abort returns banner to the next available action');
  state.recording = true; state.generating = true;
  eq(banner.upNowVisitState(state), 'recording', 'live microphone retains precedence');

  console.log('PASS visit-header-source-consistency: ' + checks + ' executed-source checks; synthetic fixtures only');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
