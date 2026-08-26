'use strict';
/* =========================================================================
   THE OP-NOTE ROOM NEVER DRAFTS BY ITSELF - PROVED BY EXECUTION
   -------------------------------------------------------------------------
   OWNER 2026-08-26: "the draft op note section is so clunky ... make it not
   auto draft and have to click draft op note".

   WHAT HE SAW. Opening the room started a run. msl-autodraft-1.0.0 watches
   #opPrepModal with two MutationObservers, and when the modal gained .show it
   scheduled a tick that pressed the shell's own #opPrepGenAllBtn - an AI call
   per patient, three lanes in parallel, each one persisting a draft note into
   that patient's History, before he had read a single row. The pref that
   governed it, 'mslAutoDraft', was ON when absent, and no control anywhere in
   the product could write the '0' that turned it off.

   WHAT CHANGED. One rule: an absent key now means OFF and only an explicit
   '1' turns automatic drafting on. Nothing in the shipped UI writes that
   value, so on this app the trigger is a human press and only a human press.
   The GENERATION path is untouched - the same button, the same capture-phase
   runner, the same day-brain and integrity wrappers behind it.

   WHY THE MODULE IS KEPT, OFF, RATHER THAN DELETED. notReadyReason() is the
   only place that knows what "this day is ready to draft" means, and it is
   the causal control this suite drives: scenario 4 turns the pref back on and
   watches the same instrument catch an automatic run. Without that control an
   assertion of "no run happened" proves nothing - a stub that never wires the
   trigger reports exactly the same zero.

   WHAT THIS PINS
     1. SHIPPED DEFAULT: the room opens, the day is ready to draft in every
        respect the module tests for, and NO run starts. No timer is even
        armed - the feature costs the open room nothing.
     2. THE EXPLICIT CLICK STILL DRAFTS: pressing #opPrepGenAllBtn enters the
        capture-phase runner exactly once, and pressing it again runs again.
     3. NOTHING ELSE PRESSES IT: mutating the open room (the childList/subtree
        observer's own trigger) starts nothing.
     4. CAUSAL CONTROL: with the pref explicitly '1' - the pre-2026-08-26
        behaviour - the SAME harness sees an automatic press with no human
        click. So scenario 1's zero is a measurement, not a dead wire.
     5. THE PREF IS THE ONLY DOOR: turned back off, the room is quiet again.
     6. SOURCE PINS across BOTH shell twins: the '=== 1' rule is present, the
        old '!== 0' rule is gone, the human button keeps its onclick, and no
        shipped (non-test) file turns automatic drafting on.
   ========================================================================= */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];

let checks = 0;
let failures = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}
function eq(a, b, label) { return ok(a === b, label, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); }
function head(t) { console.log('\n' + t); }

/* ---------------------------------------------------------------------
   THE BLOCK UNDER TEST, taken from the shipped shell rather than a copy.
   ------------------------------------------------------------------ */
function autodraftSource(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const open = src.indexOf('<!-- ===== msl-autodraft-1.0.0');
  const end = src.indexOf('<!-- ===== end msl-autodraft-1.0.0');
  assert.ok(open > 0 && end > open, rel + ': the msl-autodraft block is missing');
  const chunk = src.slice(open, end);
  const s = chunk.indexOf('<script>');
  const e = chunk.indexOf('</script>', s);
  assert.ok(s > 0 && e > s, rel + ': the msl-autodraft block carries no script');
  return chunk.slice(s + 8, e);
}

/* ---------------------------------------------------------------------
   A STUB DOM WITH A REAL TRIGGER PATH.
   The instrument has to be able to fail. The three things the module
   actually drives are wired for real here: MutationObserver callbacks fire
   on the mutations it asks for, setTimeout is a controllable clock so a
   scheduled tick genuinely runs, and #opPrepGenAllBtn.click() dispatches
   into a document-level CAPTURE listener - which is where 1p-mls-connect.js
   intercepts and where the drafting run actually begins.
   ------------------------------------------------------------------ */
function makeEnv() {
  let now = 1000000;
  let seq = 0;
  const timers = new Map();
  const env = { armed: 0, runs: 0, notices: [], toasts: [] };

  function setTimeoutStub(fn, ms) {
    const id = ++seq;
    timers.set(id, { at: now + (Number(ms) || 0), fn: fn });
    env.armed++;
    return id;
  }
  function clearTimeoutStub(id) { timers.delete(id); }
  env.flush = function (ms) {
    const until = now + (Number(ms) || 0);
    for (let guard = 0; guard < 500; guard++) {
      let next = null;
      timers.forEach((t, id) => { if (t.at <= until && (!next || t.at < next.t.at)) next = { id: id, t: t }; });
      if (!next) break;
      timers.delete(next.id);
      now = Math.max(now, next.t.at);
      try { next.t.fn(); } catch (e) { console.log('  (timer threw) ' + e.message); }
    }
    now = until;
  };

  const docListeners = { capture: [], bubble: [] };

  function mkEl(id) {
    const el = {
      id: id,
      disabled: false,
      offsetParent: { nodeName: 'DIV' },
      textContent: '',
      _cls: new Set(),
      _obs: [],
      _on: [],
      classList: {
        add(c) { if (!el._cls.has(c)) { el._cls.add(c); el._mutate('attributes'); } },
        remove(c) { if (el._cls.delete(c)) el._mutate('attributes'); },
        contains(c) { return el._cls.has(c); }
      },
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
      addEventListener(t, fn) { el._on.push({ t: t, fn: fn }); },
      closest(sel) { return String(sel || '') === '#' + el.id ? el : null; },
      _mutate(kind) {
        el._obs.forEach((o) => {
          if (kind === 'attributes' && !o.opts.attributes) return;
          if (kind === 'childList' && !o.opts.childList) return;
          try { o.cb([], o.self); } catch (e) {}
        });
      },
      click() {
        const ev = { target: el, type: 'click' };
        docListeners.capture.forEach((fn) => { try { fn(ev); } catch (e) {} });
        el._on.forEach((h) => { if (h.t === 'click') { try { h.fn(ev); } catch (e) {} } });
        docListeners.bubble.forEach((fn) => { try { fn(ev); } catch (e) {} });
      }
    };
    return el;
  }

  const nodes = new Map();
  ['opPrepModal', 'opPrepGenAllBtn'].forEach((id) => nodes.set(id, mkEl(id)));

  function MutationObserverStub(cb) { this.cb = cb; }
  MutationObserverStub.prototype.observe = function (node, opts) {
    if (node && node._obs) node._obs.push({ cb: this.cb, opts: opts || {}, self: this });
  };
  MutationObserverStub.prototype.disconnect = function () {};

  const store = new Map();

  const ctx = {
    console: console,
    setTimeout: setTimeoutStub,
    clearTimeout: clearTimeoutStub,
    MutationObserver: MutationObserverStub,
    Date: { now: function () { return now; } },
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); }
    },
    document: {
      readyState: 'complete',
      getElementById(id) { return nodes.has(id) ? nodes.get(id) : null; },
      addEventListener(t, fn, capture) {
        if (t !== 'click') return;
        (capture ? docListeners.capture : docListeners.bubble).push(fn);
      }
    },
    getTemplates() { return [{ id: 't1', name: 'Lumbar ESI' }]; },
    uns(k) { return 'u::' + k; },
    toast(msg) { env.toasts.push(String(msg)); }
  };
  ctx.window = ctx;
  ctx._opPrep = [];
  ctx._opPrepMode = 'all';
  ctx._opPrepDay = '2026-08-27';
  ctx._opPrepPatientId = '';
  ctx.__mlsOpNoteDayBrain = { installed: true };
  ctx.__mlsOpDay = { runNotice(msg) { env.notices.push(String(msg)); return true; } };

  vm.createContext(ctx);

  /* THE STAND-IN FOR THE REAL RUNNER. 1p-mls-connect.js:18316 listens on
     document in CAPTURE for a #opPrepGenAllBtn click, stops the event and
     runs draftAll(). Anything that reaches this counter has entered the
     drafting path - whoever pressed the button. */
  ctx.document.addEventListener('click', function (ev) {
    try { if (ev.target && ev.target.closest && ev.target.closest('#opPrepGenAllBtn')) env.runs++; } catch (e) {}
  }, true);

  env.ctx = ctx;
  env.modal = nodes.get('opPrepModal');
  env.btn = nodes.get('opPrepGenAllBtn');
  env.store = store;
  env.seedDay = function (n) {
    ctx._opPrep = [];
    for (let i = 0; i < n; i++) {
      ctx._opPrep.push({
        gen: false,
        appt: { name: 'Patient ' + (i + 1) },
        proc: 'Lumbar ESI L4-L5',
        _opdbTriage: { verdict: 'needs' }
      });
    }
  };
  env.openRoom = function () {
    env.modal.classList.add('show');
    env.modal._mutate('childList');   /* opPrepRender() writing #opPrepList */
  };
  env.closeRoom = function () { env.modal.classList.remove('show'); };
  env.run = function (src) { vm.runInContext(src, ctx, { filename: 'msl-autodraft-1.0.0' }); };
  return env;
}

/* =====================================================================
   RUNTIME - the shipped shell
   ================================================================== */
head('msl-autodraft, as shipped (1pScribeFlow.html)');
const SRC = autodraftSource('1pScribeFlow.html');
{
  const env = makeEnv();
  env.seedDay(24);
  env.run(SRC);

  /* --- 1. opening the room starts nothing --- */
  const armedAtBoot = env.armed;
  env.openRoom();
  env.flush(30000);
  const st1 = env.ctx.__mlsAutoDraft.status();
  eq(env.runs, 0, 'opening the room did not start a run');
  eq(st1.on, false, 'automatic drafting reports itself off by default');
  eq(st1.ranThisSession, false, 'no automatic run is recorded for this room session');
  eq(st1.reason, 'ready', 'the day IS ready to draft - the room was quiet by choice, not because the harness gave it nothing to do');
  eq(env.armed - armedAtBoot, 0, 'opening the room armed no timer while the feature is off');
  eq(env.notices.length, 0, 'nothing announced an automatic run');

  /* --- 2. the explicit click still drafts --- */
  env.btn.click();
  eq(env.runs, 1, 'pressing Draft all entered the drafting run exactly once');
  env.btn.click();
  eq(env.runs, 2, 'pressing Draft all again runs again');

  /* --- 3. mutating the open room presses nothing --- */
  const before3 = env.runs;
  env.modal._mutate('childList');
  env.modal._mutate('attributes');
  env.flush(30000);
  eq(env.runs - before3, 0, 'repainting the open room started no run');

  /* --- 4. THE CAUSAL CONTROL: the pre-2026-08-26 behaviour, same instrument --- */
  env.ctx.__mlsAutoDraft.setEnabled(true);
  env.ctx.__mlsAutoDraft.revert();
  env.closeRoom();
  const before4 = env.runs;
  env.openRoom();
  env.flush(30000);
  ok(env.runs - before4 >= 1,
    'CONTROL: with the pref explicitly on, the harness DOES see an automatic press - so scenario 1 measures something',
    'runs went ' + before4 + ' -> ' + env.runs);
  ok(env.ctx.__mlsAutoDraft.status().ranThisSession === true,
    'CONTROL: the module records the automatic run it just made');
  ok(env.notices.some((n) => /Drafting the op notes/.test(n)),
    'CONTROL: the automatic run still speaks on the room it is about');

  /* --- 5. the pref is the only door --- */
  env.ctx.__mlsAutoDraft.setEnabled(false);
  env.ctx.__mlsAutoDraft.revert();
  env.closeRoom();
  const before5 = env.runs;
  env.openRoom();
  env.flush(30000);
  eq(env.runs - before5, 0, 'turned back off, the room is quiet again');
  eq(env.ctx.__mlsAutoDraft.status().on, false, 'the off state reports itself honestly');
}

/* --- 6. an absent key is OFF, and every other value is OFF --- */
head('the pref rule itself');
['', '0', 'true', 'yes', 'on', '2'].forEach((v) => {
  const env = makeEnv();
  env.seedDay(3);
  if (v !== '') { env.store.set('u::mslAutoDraft', v); env.store.set('mslAutoDraft', v); }
  env.run(SRC);
  env.openRoom();
  env.flush(30000);
  eq(env.runs, 0, 'mslAutoDraft=' + JSON.stringify(v) + ' does not start a run');
});
{
  const env = makeEnv();
  env.seedDay(3);
  env.store.set('u::mslAutoDraft', '1');
  env.run(SRC);
  env.openRoom();
  env.flush(30000);
  ok(env.runs >= 1, 'mslAutoDraft="1" is the one value that starts a run');
}

/* =====================================================================
   BOTH TWINS RUN THE SAME BLOCK
   ================================================================== */
head('the twin shell');
{
  const twin = autodraftSource(path.join('1p', 'index.html'));
  eq(twin, SRC, 'the two shells carry a byte-identical msl-autodraft block');
  const env = makeEnv();
  env.seedDay(12);
  env.run(twin);
  env.openRoom();
  env.flush(30000);
  eq(env.runs, 0, '1p/index.html does not draft on open either');
}

/* =====================================================================
   SOURCE PINS
   ================================================================== */
head('source pins');
SHELLS.forEach((rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  ok(src.indexOf("return String(v) === '1';") > 0, rel + ": prefOn's default is OFF");
  eq(src.indexOf("return String(v) !== '0';"), -1, rel + ': the ON-when-absent rule is gone');
  ok(src.indexOf('<button class="btn-primary" id="opPrepGenAllBtn" onclick="opPrepGenerateAll()"') > 0,
    rel + ': the human Draft-all button and its onclick are untouched');
  ok(src.indexOf("target=e&&e.target&&e.target.closest?e.target.closest('#opPrepGenAllBtn'):null") > 0,
    rel + ': the safety-module-still-loading guard on the human click is untouched');
  ok(src.indexOf('OWNER 2026-08-26') > 0, rel + ': the block names the ruling it implements');
});

/* Nothing that ships may turn it on. The handle exists for the console and
   for the suites that drive it as a control. */
{
  const skip = new Set(['node_modules', 'tests', '.git', 'tmp', 'coordination', 'docs', 'extension-candidates', 'wyzant', 'vendor']);
  const hits = [];
  (function walk(dir, rel) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (skip.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) { walk(full, r); continue; }
      if (!/\.(js|html)$/.test(ent.name)) continue;
      let body = '';
      try { body = fs.readFileSync(full, 'utf8'); } catch (e) { continue; }
      if (/__mlsAutoDraft\s*\.\s*setEnabled\s*\(\s*true\s*\)/.test(body) ||
          /setItem\s*\(\s*[^)]*mslAutoDraft[^)]*,\s*['"]1['"]/.test(body)) hits.push(r);
    }
  })(ROOT, '');
  eq(hits.join(', '), '', 'no shipped file turns automatic drafting on');
}

console.log('\n' + (failures ? 'FAILURES: ' + failures + ' of ' + checks : 'OK: ' + checks + ' checks'));
process.exit(failures ? 1 : 0);
