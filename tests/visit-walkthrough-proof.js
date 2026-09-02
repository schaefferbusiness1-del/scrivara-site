'use strict';

/* visit-walkthrough-proof.js  --  walkfix-1.0.0 (b1184)
 * ============================================================================
 * OWNER, 2026-09-01, on the live site:
 *
 *   "the visit walkthrough needs work: it has these buttons that need to be
 *    clicked twice, buttons that scroll you to weird places, UI elements that
 *    come and go, and duplicate buttons where only one works. Fix it all.
 *    Remember it's not just the first screen: it's patient to recording to
 *    note generation to write-back."
 *
 * and, about the same row of controls, "I like those buttons but they do
 * nothing."
 *
 * SEVEN DEFECTS, TURNED INTO PINS. Each one is a real mechanism read out of
 * the source and, where the module can be executed, pressed ONCE here and
 * asserted on its effect.
 *
 *  1. A REGISTRY EMPTIED AND NOT REFILLED. The engine's render() called
 *     clearClicks() BEFORE `if (!wrap()) return;`. Every button in the flow
 *     resolves its handler out of that registry at click time, so a render
 *     that arrived while #ez3Wrap was momentarily absent left the whole
 *     screen pressable and dead. That is "buttons that do nothing", and no
 *     second press could help.
 *
 *  2. A NO-OP REPAINT THAT DESTROYED THE LANE. setWrapHtml() removed every
 *     .ez3fl-record and detached #ez3Transcript BEFORE the ez3calm guard that
 *     refuses to rewrite unchanged html. On an identical repaint the doctor's
 *     record pill, transcript, Generate and shortcut chips were all torn out
 *     and the canonical transcript never came back. "UI elements that come
 *     and go" - and a node removed between mousedown and mouseup produces no
 *     click at all.
 *
 *  3. CHIPS REBUILT ON EVERY WIRE PASS. `chipHost.innerHTML = ch` replaced
 *     all eight style/length chips every render, identical or not. Same
 *     swallowed-press mechanism as (2).
 *
 *  4. A WATCHDOG ARMED AFTER THE THING IT WATCHES ALREADY FIRED. revwork's
 *     Regenerate incremented _genPending AFTER the engine's own handler had
 *     clicked #genBtn and _mlsStartGeneration had already emitted
 *     mls:generation-started (which clears it). The 700ms fallback therefore
 *     ALWAYS ran, and shouted "Generate is not ready yet ... press it again"
 *     in red over a generation that was working.
 *
 *  5. TWO OWNERS FIGHTING OVER ONE TEXTAREA. Edit note cleared the formatted
 *     view's inline display:none exactly once; the panel put it back.
 *
 *  6. COPY WITH NO OWNER. #ez3Edit and #ez3Regen were routed; #ez3Copy was
 *     not, so in the (1) window it was a completely silent press.
 *
 *  7. TWO DOORS TO ONE ROOM, AND A DROPPED ARGUMENT. .ez3fl-openws and
 *     #ez3Adv were both on screen; the lane copy only ever OPENED, and it was
 *     wired as `addEventListener('click', openWorkspace)` so the MouseEvent
 *     arrived as openWorkspace's `scrollToNoteCard` parameter - which is only
 *     honoured when it is exactly `false`. Every press therefore ran the
 *     650ms scroll to #noteCard: "buttons that scroll you to weird places".
 *
 * Run: node tests/visit-walkthrough-proof.js
 * ==========================================================================*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');
const CONNECT = read('1p-mls-connect.js');

/* Every ordering assertion below reads the CODE, never the prose: these
   blocks explain the defect they cure, so the words "clearClicks()" and
   "scrollIntoView" appear in the comments in exactly the wrong order. */
const codeOnly = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) {
  checks++;
  const shown = (a !== null && typeof a === 'object') ? '[object]' : JSON.stringify(a);
  assert.strictEqual(a, b, msg + ' (got ' + shown + ')');
}

/* ==========================================================================
 * 0.  THE THREE SOURCE REGIONS THIS SUITE READS
 * ======================================================================== */
const RW_BEGIN = '/* ===== revwork-1.2.0 begin ============================================== */';
const RW_END = '/* ===== revwork-1.2.0 end ================================================ */';
ok(CONNECT.indexOf(RW_BEGIN) > 0, 'the revwork block is missing from 1p-mls-connect.js');
const RW_BLOCK = CONNECT.slice(CONNECT.indexOf(RW_BEGIN) + RW_BEGIN.length, CONNECT.indexOf(RW_END));
ok(RW_BLOCK.length > 20000, 'the revwork block could not be sliced');

/* the visit lane (fl-1.7.2) */
const LANE_AT = CONNECT.indexOf("var VERSION = 'fl-1.7.2';");
ok(LANE_AT > 0, 'the visit-lane module version marker moved; re-aim this pin');
const LANE = CONNECT.slice(LANE_AT, CONNECT.indexOf('window.__mlsEz3Flow = {', LANE_AT));
ok(LANE.length > 10000, 'the visit-lane module could not be sliced');

/* the live Easy engine is the FIRST copy in the bundle - every later copy
   bails on `if (window.__mlsEasyV32) return;`, so the one that actually runs
   is the one before that guard. */
const ENGINE_AT = CONNECT.indexOf('  var CLICKS = {}, MCLICKS = {};');
ok(ENGINE_AT > 0, 'the live Easy engine click registry could not be located');
ok(CONNECT.indexOf('if (window.__mlsEasyV32) return;') > ENGINE_AT,
  'the engine copy this suite reads is no longer the FIRST (live) one in the bundle');

/* ==========================================================================
 * 1.  DEFECT 1 - THE CLICK REGISTRY IS NEVER EMPTIED WITHOUT BEING REFILLED
 * ======================================================================== */
{
  const at = CONNECT.indexOf('  function render() {\n    if (!host) return;\n    reflectEasyMode();', ENGINE_AT);
  ok(at > 0, 'the live engine render() could not be located');
  const raw = CONNECT.slice(at, CONNECT.indexOf('\n  }\n', at));
  ok(/walkfix-1\.0\.0/.test(raw), 'the render() ordering fix lost its marker');
  const body = codeOnly(raw);
  ok(body.indexOf('clearClicks()') > 0, 'render() no longer rebuilds the click registry at all');
  ok(body.indexOf('if (!wrap()) return;') > 0, 'render() lost its no-wrap guard');
  ok(body.indexOf('if (!wrap()) return;') < body.indexOf('clearClicks()'),
    'render() empties the click registry BEFORE the guard that can return - every painted button goes dead');
}

/* ==========================================================================
 * 2.  DEFECT 2 - A NO-OP REPAINT DESTROYS NOTHING
 * ======================================================================== */
{
  const at = CONNECT.indexOf('  function setWrapHtml(h) {', ENGINE_AT);
  ok(at > 0, 'the live engine setWrapHtml() could not be located');
  const raw = CONNECT.slice(at, CONNECT.indexOf('\n  function render() {', at));
  ok(/walkfix-1\.0\.0/.test(raw), 'the setWrapHtml fix lost its marker');
  const body = codeOnly(raw);
  const guard = body.indexOf('if (w.__ez3H === h) return;');
  const laneKill = body.indexOf("querySelectorAll('.ez3fl-record')");
  const txDetach = body.indexOf("querySelector('#ez3Transcript')");
  ok(guard > 0, 'setWrapHtml no longer refuses an identical repaint outright');
  ok(laneKill > 0, 'the stale-lane scrub is gone entirely - that was not the fix');
  ok(txDetach > 0, 'the transcript carry-over is gone entirely - that was not the fix');
  ok(guard < laneKill, 'the lane is still removed before the identical-html guard - a no-op repaint destroys it');
  ok(guard < txDetach, 'the transcript is still detached before the identical-html guard');
  /* the old conditional write must be gone: the guard now owns the decision */
  ok(!/if \(w\.__ez3H !== h\) \{ w\.innerHTML = h/.test(body),
    'setWrapHtml still carries the old inline calm-guard as well as the early return');
}

/* ==========================================================================
 * 3.  DEFECT 3 - THE STYLE CHIPS ARE PATCHED, NEVER REPLACED
 * ======================================================================== */
{
  const at = CONNECT.indexOf("    var chipHost = $('ez3StyleChips');", ENGINE_AT);
  ok(at > 0, 'the live chip host wiring could not be located');
  const raw = CONNECT.slice(at, CONNECT.indexOf('\n    syncTx();', at));
  ok(/walkfix-1\.0\.0/.test(raw), 'the chip patch lost its marker');
  const body = codeOnly(raw);
  eq((body.match(/chipHost\.innerHTML = ch/g) || []).length, 1,
    'the chip host is written from an html string more than once');
  ok(/if \(!sameSet\) \{/.test(body) && body.indexOf('if (!sameSet) {') < body.indexOf('chipHost.innerHTML = ch'),
    'the chip nodes are rebuilt unconditionally - a repaint mid-press eats the click');
  ok(/classList\.toggle\('on', chipOn\)/.test(body),
    'the selected chip state is no longer patched in place on the existing node');
  ok(/getAttribute\('data-chip'\) !== wantChips\[ci\]\.label/.test(body),
    'nothing compares the existing chip labels, so "same set" can never be true');
  /* the router that resolves a chip press must still be the engine's own */
  ok(/if \(\(el = t\.closest\('\[data-chip\]'\)\)\)/.test(CONNECT.slice(ENGINE_AT)),
    'the engine no longer forwards a [data-chip] press to the style preference');
}

/* ==========================================================================
 * 4.  DEFECT 7 - ONE DOOR TO THE REVIEW WORKSPACE, AND NO DROPPED ARGUMENT
 * ======================================================================== */
{
  ok(!/ob\.addEventListener\('click', openWorkspace\)/.test(LANE),
    "the lane's workspace door still hands openWorkspace straight to addEventListener - the MouseEvent becomes its scroll flag");
  ok(/ob\.addEventListener\('click', function \(\) \{ toggleWorkspaceFromLane\(\); \}\)/.test(LANE),
    "the lane's workspace door is not wired to the toggle");
  ok(/function toggleWorkspaceFromLane\(\)/.test(LANE), 'toggleWorkspaceFromLane is not defined in the lane');
  ok(/setLaneHidden\(ob, advOnScreen \|\| !!noteText\.trim\(\)\)/.test(LANE),
    'the lane copy of the workspace door is not hidden while #ez3Adv is on screen - two controls for one job');
  ok(/'Hide the review workspace below'/.test(LANE) && /'Open the review workspace below'/.test(LANE),
    'the lane door no longer says both halves of what it does');
  /* the parameter that was being dropped is still read, and still by identity */
  ok(/if \(scrollToNoteCard === false\) return;/.test(LANE),
    'openWorkspace no longer honours its own scroll parameter');
}

/* ==========================================================================
 * 5.  THE SCROLL RULE - NEAREST, AND ONLY WHEN THE TARGET IS OFF SCREEN
 * ======================================================================== */
{
  ok(/function bringIntoView\(el\)/.test(LANE), 'the lane has no single scroll helper');
  ok(/block: 'nearest'/.test(LANE.slice(LANE.indexOf('function bringIntoView'))),
    'the lane scroll helper does not use block:nearest');
  /* no control in the lane may hard-scroll to the top of the page any more */
  const laneCode = LANE.replace(/\/\*[\s\S]*?\*\//g, ' ');
  eq((laneCode.match(/scrollIntoView\(\{ block: 'start'/g) || []).length, 0,
    'a lane control still scrolls its target to the TOP of the page');
  eq((laneCode.match(/scrollIntoView\(\{ block: 'center'/g) || []).length, 0,
    'a lane control still centres its target, moving the page when nothing needed to move');

  const rwCode = RW_BLOCK.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(/function bring\(el\)/.test(rwCode), 'the review workspace has no single scroll helper');
  eq((rwCode.match(/scrollIntoView\(\{ block: 'center'/g) || []).length, 0,
    'a review-workspace control still centres its target');
  eq((rwCode.match(/scrollIntoView\(\{ block: 'start'/g) || []).length, 0,
    'a review-workspace control still scrolls its target to the top of the page');
  eq((rwCode.match(/scrollIntoView\(/g) || []).length, 1,
    'the review workspace scrolls from more than one place - there must be exactly one rule');

  /* the engine's own second paste entry uses the same rule through the same
     helper, so the two doors to one transcript cannot drift apart */
  const qPasteAt = CONNECT.indexOf("    on('ez3QPaste', function () {", ENGINE_AT);
  ok(qPasteAt > 0, 'the live #ez3QPaste handler could not be located');
  const qPaste = codeOnly(CONNECT.slice(qPasteAt, CONNECT.indexOf('\n    });', qPasteAt)));
  ok(/rw\.revealTranscript\(\)/.test(qPaste), '#ez3QPaste no longer routes through the one revealer');
  ok(/rw\.bring\(transcript\)/.test(qPaste), '#ez3QPaste fallback no longer honours the shared scroll rule');
  ok(!/block: 'center'/.test(qPaste), '#ez3QPaste still centres a transcript that may already be on screen');
}

/* ==========================================================================
 * 6.  A TINY DOM, AND THE REVIEW MODULE RUN AGAINST IT
 * ======================================================================== */
function makeStyle() {
  const s = { display: '', visibility: '', cssText: '' };
  s.getPropertyValue = (k) => String(s[k] || '');
  s.setProperty = (k, v) => { s[k] = String(v); };
  s.removeProperty = (k) => { s[k] = ''; };
  return s;
}
function makeDom() {
  const docListeners = Object.create(null);
  const winListeners = Object.create(null);
  const dom = {};

  function simpleMatch(el, tok) {
    if (!el || !tok) return false;
    if (tok[0] === '#') return el.id === tok.slice(1);
    if (tok[0] === '.') return String(el.className || '').split(/\s+/).indexOf(tok.slice(1)) >= 0;
    if (tok[0] === '[') return tok.slice(1, -1) in el.attrs;
    return String(el.tagName || '').toLowerCase() === tok.toLowerCase();
  }
  function matchesGroup(el, group) {
    const parts = group.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    if (!simpleMatch(el, parts[parts.length - 1])) return false;
    let node = el.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      let found = false;
      while (node) { if (simpleMatch(node, parts[i])) { found = true; node = node.parentNode; break; } node = node.parentNode; }
      if (!found) return false;
    }
    return true;
  }
  function matchesSel(el, sel) {
    return String(sel).split(',').map((x) => x.trim()).filter(Boolean).some((g) => matchesGroup(el, g));
  }
  function walk(node, fn) { fn(node); node.childNodes.slice().forEach((c) => walk(c, fn)); }

  function El(tag) {
    const el = {
      tagName: String(tag).toUpperCase(), id: '', className: '', type: '', title: '',
      placeholder: '', value: '', disabled: false, readOnly: false, textContent: '',
      childNodes: [], parentNode: null, attrs: Object.create(null),
      _events: Object.create(null), _rect: { width: 220, height: 30, top: 100, bottom: 130 },
      clickCount: 0, scrolls: [], style: makeStyle()
    };
    el.classList = {
      contains: (c) => String(el.className).split(/\s+/).indexOf(c) >= 0,
      add: (c) => { if (!el.classList.contains(c)) el.className = (el.className ? el.className + ' ' : '') + c; },
      remove: (c) => { el.className = String(el.className).split(/\s+/).filter((x) => x && x !== c).join(' '); },
      toggle: (c, on) => { const want = on === undefined ? !el.classList.contains(c) : !!on; if (want) el.classList.add(c); else el.classList.remove(c); return want; }
    };
    el.appendChild = (n) => { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = el; el.childNodes.push(n); return n; };
    el.insertBefore = (n, ref) => {
      if (n.parentNode) n.parentNode.removeChild(n);
      n.parentNode = el;
      const i = ref ? el.childNodes.indexOf(ref) : -1;
      if (i < 0) el.childNodes.push(n); else el.childNodes.splice(i, 0, n);
      return n;
    };
    el.removeChild = (n) => { const i = el.childNodes.indexOf(n); if (i >= 0) el.childNodes.splice(i, 1); n.parentNode = null; return n; };
    Object.defineProperty(el, 'firstChild', { get: () => el.childNodes[0] || null });
    Object.defineProperty(el, 'nextSibling', {
      get: () => { const p = el.parentNode; if (!p) return null; const i = p.childNodes.indexOf(el); return (i >= 0 && p.childNodes[i + 1]) || null; }
    });
    el.setAttribute = (k, v) => { el.attrs[k] = String(v); if (k === 'id') el.id = String(v); };
    el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
    el.hasAttribute = (k) => (k in el.attrs);
    el.removeAttribute = (k) => { delete el.attrs[k]; };
    el.addEventListener = (t, fn) => { (el._events[t] = el._events[t] || []).push(fn); };
    el.removeEventListener = (t, fn) => { const a = el._events[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
    el.dispatchEvent = (ev) => { ev.target = ev.target || el; (el._events[ev.type] || []).slice().forEach((fn) => fn(ev)); return true; };
    el.click = () => { el.clickCount++; fireClick(el); };
    el.focus = () => { dom.document.activeElement = el; };
    el.scrollIntoView = (opts) => { el.scrolls.push(opts || {}); };
    el.getBoundingClientRect = () => el._rect;
    el.closest = (sel) => { let n = el; while (n) { if (matchesSel(n, sel)) return n; n = n.parentNode; } return null; };
    el.querySelector = (sel) => { let hit = null; walk(el, (n) => { if (!hit && n !== el && matchesSel(n, sel)) hit = n; }); return hit; };
    el.querySelectorAll = (sel) => { const out = []; walk(el, (n) => { if (n !== el && matchesSel(n, sel)) out.push(n); }); return out; };
    return el;
  }
  function fireClick(target) {
    const ev = { type: 'click', target, bubbles: true, isTrusted: false, detail: 1 };
    (docListeners.click || []).slice().forEach((fn) => fn(ev));   /* capture phase on document, in registration order */
    let n = target;
    while (n) { (n._events.click || []).slice().forEach((fn) => fn(ev)); n = n.parentNode; }
  }

  const head = El('head'); const body = El('body');
  const document = {
    readyState: 'complete', hidden: false, activeElement: null,
    head: head, body: body,
    documentElement: { clientHeight: 800 },
    createElement: (t) => El(t),
    getElementById: (id) => {
      let hit = null;
      [head, body].forEach((r) => walk(r, (n) => { if (!hit && n.id === id) hit = n; }));
      return hit;
    },
    querySelector: (sel) => {
      let hit = null;
      [head, body].forEach((r) => walk(r, (n) => { if (!hit && n !== r && matchesSel(n, sel)) hit = n; }));
      return hit;
    },
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { const a = docListeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  };
  dom.document = document;
  dom.El = El;
  dom.docListeners = docListeners;
  dom.winListeners = winListeners;
  return dom;
}
function makeClock() {
  const timers = []; let now = 0; let seq = 0;
  return {
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ id, at: now + (Number(ms) || 0), fn, iv: 0 }); return id; },
    setInterval: (fn, ms) => { const id = ++seq; const p = Math.max(1, Number(ms) || 1); timers.push({ id, at: now + p, fn, iv: p }); return id; },
    clear: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    advance: (ms) => {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        if (due.iv) due.at = now + due.iv; else timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
      now = end;
    }
  };
}

/* The engine half, registered on document BEFORE the module - which is the
   real order in the bundle (ez3Click is installed thousands of lines earlier).
   Reproducing that order is the whole point: defect 4 only exists because the
   engine has already run by the time the module's router is reached. */
function installEngineHalf(dom, sandbox, state) {
  dom.document.addEventListener('click', function (ev) {
    const t = ev && ev.target;
    if (!t || !t.closest) return;
    if (!t.closest('#mlsEz3')) return;
    const chip = t.closest('[data-chip]');
    if (chip) { state.stylePref = chip.getAttribute('data-chip'); return; }
    if (t.id === 'ez3Regen') {
      if (!state.engineDeaf) {
        const g = dom.document.getElementById('genBtn');
        if (g && !g.disabled) { g.click(); g.disabled = true; emit(dom, 'mls:generation-started', { runId: 1 }); }
      }
      return;
    }
    if (t.id === 'ez3Edit') {
      const n = dom.document.getElementById('ez3Note');
      state.editing = !state.editing;
      if (n) n.readOnly = !state.editing;
      return;
    }
    if (t.id === 'ez3Copy') {
      if (!state.engineDeaf) t.textContent = '✅ Copied';
      return;
    }
  });
}
function emit(dom, type, detail) {
  (dom.winListeners[type] || []).slice().forEach((fn) => fn({ type, detail }));
}

function bootRevWork(opts) {
  opts = opts || {};
  const dom = makeDom();
  const clock = makeClock();
  const state = { stylePref: '', editing: false, engineDeaf: !!opts.engineDeaf };
  const sandbox = {
    document: dom.document,
    innerHeight: 800,
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    Event: function (type, o) { this.type = type; this.bubbles = !!(o && o.bubbles); },
    setTimeout: clock.setTimeout, setInterval: clock.setInterval,
    clearTimeout: clock.clear, clearInterval: clock.clear,
    Promise: Promise, String: String, Number: Number, Math: Math, Date: Date,
    toasts: []
  };
  sandbox.window = sandbox;
  sandbox.toast = (m, k) => { sandbox.toasts.push({ msg: String(m), kind: String(k || '') }); };
  sandbox.__pt = { id: '7', name: 'Adam Tester', dob: '1980-04-02', mrn: 'MRN-9' };
  sandbox.activePatient = () => sandbox.__pt;
  sandbox.getActivePtId = () => (sandbox.__pt ? sandbox.__pt.id : '');
  sandbox.selectPatient = (id) => { sandbox.selected = String(id); };
  sandbox.addEventListener = (t, fn) => { (dom.winListeners[t] = dom.winListeners[t] || []).push(fn); };
  sandbox.removeEventListener = (t, fn) => { const a = dom.winListeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  installEngineHalf(dom, sandbox, state);
  vm.createContext(sandbox);
  vm.runInContext(RW_BLOCK, sandbox, { filename: 'revwork-walkfix.js' });
  return { dom, clock, sandbox, state, api: sandbox.__mlsRevWork, doc: dom.document, El: dom.El };
}

/* the visit screen, in the shape the module meets it after a generation */
function paintVisitScreen(h) {
  const d = h.doc, mk = (tag, id, parent) => { const e = h.El(tag); e.id = id; (parent || d.body).appendChild(e); return e; };
  const visitView = mk('div', 'visitView');
  const ez3 = mk('div', 'mlsEz3', visitView);
  const ez3Body = mk('div', 'mlsEz3Body', ez3);
  const wrap = mk('div', 'ez3Wrap', ez3Body);
  const adv = mk('button', 'ez3Adv', wrap);
  const ptCard = h.El('div'); ptCard.className = 'ez3-pt'; ptCard.textContent = 'Adam Tester'; wrap.appendChild(ptCard);
  const ez3Note = mk('textarea', 'ez3Note', wrap);
  ez3Note.readOnly = true;
  const chipHost = mk('div', 'ez3StyleChips', wrap);
  const chips = ['SOAP', 'APSO', 'Narrative', 'Problem-based', 'H&P', 'Concise', 'Standard', 'Detailed'].map((label) => {
    const c = h.El('button'); c.setAttribute('data-chip', label); c.className = 'ez3-chip'; c.textContent = label;
    chipHost.appendChild(c); return c;
  });
  const ez3Edit = mk('button', 'ez3Edit', wrap); ez3Edit.textContent = 'Edit note';
  const ez3Regen = mk('button', 'ez3Regen', wrap); ez3Regen.textContent = 'Regenerate';
  const ez3Copy = mk('button', 'ez3Copy', wrap); ez3Copy.textContent = '📋 Copy for Athena';
  const flTx = mk('textarea', 'ez3flTranscript', wrap);
  const flGen = mk('button', 'ez3flGen', wrap);
  const ez3Gen = mk('button', 'ez3Gen', wrap);
  const tx = mk('textarea', 'transcript', visitView);
  const genBtn = mk('button', 'genBtn', visitView);
  const noteCard = mk('div', 'noteCard', visitView);
  const step2 = mk('div', 'mlsAtStep2', noteCard);
  const noteBox = mk('textarea', 'noteBox', noteCard);
  /* reviewfix-1.0.0: the shell keeps these four in ONE `.note-actions` row and
     the review workspace adopts the ROW, so the stub has to have one. */
  const actions = h.El('div'); actions.className = 'note-actions'; noteCard.appendChild(actions);
  const signBtn = mk('button', 'signBtn', actions);
  const saveBtn = mk('button', 'saveNoteBtn', actions);
  const copyBtn = mk('button', 'copyEmrBtn', actions);
  const push = mk('button', 'pushAllEmrBtn', actions);
  const emrCard = mk('div', 'emrCard', visitView);
  return { visitView, ez3, ez3Body, wrap, adv, ptCard, ez3Note, chipHost, chips, ez3Edit, ez3Regen, ez3Copy,
           flTx, flGen, ez3Gen, tx, genBtn, noteCard, step2, noteBox, actions, signBtn, saveBtn, copyBtn, push, emrCard };
}
/* the "Formatted view (live)" panel, in the shape feat_mls_fixpack_0701
   attachPreview leaves it: a wrap with its own Edit toggle, and the source
   textarea collapsed while the panel holds the slot. */
function attachFormattedView(h, ta) {
  const wrap = h.El('div'); wrap.className = 'mls-fp-fmt';
  const btn = h.El('button'); btn.className = 'fmt-edit'; btn.textContent = '✏️ Edit';
  wrap.appendChild(btn);
  if (ta.parentNode) ta.parentNode.insertBefore(wrap, ta);
  const entry = { ta, wrap, hidden: false };
  function apply() { ta.style.setProperty('display', entry.hidden ? '' : 'none'); }
  btn.addEventListener('click', function () { entry.hidden = !entry.hidden; apply(); });
  apply();
  ta.__fpFmt = entry;
  /* the panel's own repaint - what used to undo the doctor's Edit press */
  entry.repaint = function () { apply(); };
  return entry;
}

/* ---- 6a. the module installs and exposes the new contract -------------- */
{
  const h = bootRevWork();
  ok(h.api && h.api.installed === true, 'the review module did not install');
  ['copyPress', 'genInFlight', 'enforceEdit', 'bring', 'editWanted', 'chipPress', 'regenPress', 'editPress']
    .forEach((k) => ok(typeof h.api[k] === 'function', 'the module no longer exposes ' + k));
}

/* ---- 6b. THE SCROLL RULE, EXECUTED ------------------------------------ */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h);
  h.clock.advance(1200);

  s.noteBox._rect = { width: 300, height: 200, top: 120, bottom: 320 };   /* fully on screen */
  eq(h.api.bring(s.noteBox), false, 'a target that is already fully on screen was scrolled anyway');
  eq(s.noteBox.scrolls.length, 0, 'the page was moved for a control whose result was already visible');

  s.noteBox._rect = { width: 300, height: 200, top: 1400, bottom: 1600 };  /* below the fold */
  eq(h.api.bring(s.noteBox), true, 'a target below the fold was not brought into view');
  eq(s.noteBox.scrolls.length, 1, 'the off-screen target was not scrolled exactly once');
  eq(s.noteBox.scrolls[0].block, 'nearest', 'the scroll was not the minimum move that reveals the target');

  /* an element with no box at all must not throw and must not scroll twice */
  s.noteBox._rect = { width: 0, height: 0, top: 0, bottom: 0 };
  eq(h.api.bring(s.noteBox), true, 'a zero-box target is not treated as off screen');
}

/* ---- 6c. PASTE A TRANSCRIPT: reveals, focuses, does not throw the page -- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  s.flTx._rect = { width: 400, height: 120, top: 200, bottom: 320 };
  eq(h.api.revealTranscript(), true, 'the one transcript revealer found nothing on a painted visit screen');
  eq(h.doc.activeElement, s.flTx, 'the paste entry did not put the caret in the transcript');
  eq(s.flTx.scrolls.length, 0, 'the paste entry scrolled to a transcript that was already on screen');

  /* and it still rescues an inline hide before deciding, exactly as before */
  s.wrap.style.setProperty('display', 'none');
  s.flTx._rect = { width: 400, height: 120, top: 1200, bottom: 1320 };
  eq(h.api.revealTranscript(), true, 'the revealer gave up on a flow container something had hidden');
  eq(s.wrap.style.getPropertyValue('display'), '', 'the revealer did not un-hide the flow first');
  eq(s.flTx.scrolls.length, 1, 'an off-screen transcript was not brought into view');
  eq(s.flTx.scrolls[0].block, 'nearest', 'the transcript was not revealed with the minimum scroll');
}

/* ---- 6d. A FORMAT CHIP, PRESSED ONCE ---------------------------------- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h);
  h.clock.advance(1200);

  /* no note yet: the chip is a preference for the NEXT generation and says so,
     and it presses no generator at all */
  h.sandbox.toasts.length = 0;
  s.chips[1].click();                                    /* APSO - ONE press */
  eq(h.state.stylePref, 'APSO', 'the engine half did not record the style preference');
  eq(s.flGen.clickCount + s.ez3Gen.clickCount + s.genBtn.clickCount, 0,
    'a chip pressed with no note started a generation');
  ok(h.sandbox.toasts.some((t) => /Style set to APSO/.test(t.msg)), 'a chip pressed with no note said nothing');

  /* with a note and a transcript, ONE press reformats the note that is on
     screen - the whole point: a preference is not a result */
  h.sandbox.toasts.length = 0;
  s.tx.value = 'doctor and patient talking about a knee';
  s.noteBox.value = 'S: knee pain. O: exam. A: OA. P: PT.';
  s.chips[5].click();                                    /* Concise - ONE press */
  eq(h.state.stylePref, 'Concise', 'the engine half did not record the new style');
  eq(s.flGen.clickCount, 1, 'the chip did not reformat the note on screen on the FIRST press');
  ok(h.sandbox.toasts.some((t) => /Rewriting this note as Concise/.test(t.msg)),
    'the chip did not say what it was doing');
  /* and it walked the flow's own ladder, not a generator of its own */
  eq(s.ez3Gen.clickCount + s.genBtn.clickCount, 0, 'the chip pressed a second generator');
}

/* ---- 6e. DEFECT 4 - REGENERATE DOES NOT SHOUT OVER A WORKING PRESS ----- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  s.tx.value = 'doctor and patient talking';
  s.noteBox.value = 'S: knee pain. A: OA.';

  h.sandbox.toasts.length = 0;
  s.ez3Regen.click();                                    /* ONE press */
  eq(s.genBtn.clickCount, 1, 'the engine half did not start the regeneration');
  eq(s.genBtn.disabled, true, 'the harness did not reproduce a generation in flight');
  ok(h.sandbox.toasts.some((t) => /Regenerating this note/.test(t.msg)), 'Regenerate said nothing at all');

  h.clock.advance(2000);                                 /* through the 700ms watchdog */
  eq(s.genBtn.clickCount, 1, 'THE WATCHDOG FIRED A SECOND GENERATION over a press that was working');
  eq(s.flGen.clickCount + s.ez3Gen.clickCount, 0, 'the watchdog pressed another rung of the ladder');
  ok(!h.sandbox.toasts.some((t) => /not ready yet/.test(t.msg)),
    'MLS still shouts "Generate is not ready yet ... press it again" over a generation that is running');
}

/* ---- 6f. ...and the fallback still exists for a press nothing answered -- */
{
  const h = bootRevWork({ engineDeaf: true });
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  s.tx.value = 'doctor and patient talking';
  s.noteBox.value = 'S: knee pain. A: OA.';

  s.ez3Regen.click();                                    /* ONE press, engine silent */
  eq(s.genBtn.clickCount, 0, 'the harness did not reproduce a dispatch that never arrives');
  h.clock.advance(2000);
  eq(s.flGen.clickCount, 1, 'the fallback no longer rescues a press the engine never answered');
}

/* ---- 6g. ...and a generation that finished inside the window is left alone */
{
  const h = bootRevWork({ engineDeaf: true });
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  s.tx.value = 'doctor and patient talking';
  s.noteBox.value = 'S: knee pain. A: OA.';

  s.ez3Regen.click();
  s.noteBox.value = 'S: knee pain, left. A: OA. P: PT.';  /* the note came back */
  h.clock.advance(2000);
  eq(s.flGen.clickCount + s.ez3Gen.clickCount + s.genBtn.clickCount, 0,
    'the watchdog regenerated a note that had already been regenerated');
}

/* ---- 6h. DEFECT 5 - EDIT NOTE OPENS ON THE FIRST PRESS AND STAYS OPEN --- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  s.noteBox.value = 'S: knee pain. O: exam. A: OA. P: PT.';
  s.ez3Note.value = s.noteBox.value;
  const fmt = attachFormattedView(h, s.ez3Note);
  eq(s.ez3Note.style.getPropertyValue('display'), 'none',
    'the harness did not reproduce the formatted view collapsing the note box');

  s.ez3Edit.click();                                     /* ONE press */
  eq(s.ez3Note.readOnly, false, 'the engine half did not open editing');
  h.clock.advance(200);
  eq(fmt.hidden, true, 'Edit note did not hand the slot to the formatted view own toggle');
  eq(s.ez3Note.style.getPropertyValue('display'), '', 'the note box is still collapsed after the FIRST press');
  eq(h.doc.activeElement, s.ez3Note, 'Edit note did not put the caret in the note');
  eq(h.api.editWanted(), true, 'the module did not remember that the doctor asked to edit');

  /* the panel repaints on its own cadence - the press must survive it */
  fmt.hidden = false; fmt.repaint();
  eq(s.ez3Note.style.getPropertyValue('display'), 'none', 'the harness did not reproduce the panel re-hiding the box');
  h.clock.advance(4000);                                 /* the module's own reconcile pass */
  eq(s.ez3Note.style.getPropertyValue('display'), '',
    'the formatted view took the note box back and the doctor has to press Edit twice');

  /* Done editing gives the formatted view its slot back, and stops enforcing */
  s.ez3Edit.click();
  h.clock.advance(200);
  eq(s.ez3Note.readOnly, true, 'the engine half did not close editing');
  eq(h.api.editWanted(), false, 'the module kept forcing the box open after Done editing');
  eq(fmt.hidden, false, 'Done editing left a read-only raw box where the formatted note should be');
}

/* ---- 6i. Edit with no formatted view attached still just works --------- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  s.ez3Note.style.setProperty('display', 'none');
  s.ez3Edit.click();
  h.clock.advance(200);
  eq(s.ez3Note.style.getPropertyValue('display'), '', 'Edit note did not clear a plain inline hide');
}

/* ---- 6j. DEFECT 6 - COPY FOR ATHENA HAS AN OWNER ----------------------- */
/* The module tells "answered" from "nothing happened" by reading the button's
   own label, so the engine's three strings and the module's idle label are
   one contract. If either side moves alone, this reds. */
{
  const engine = CONNECT.slice(ENGINE_AT);
  ok(/btn\.textContent = copied \? '✅ Copied' : '⚠ Not copied';/.test(engine),
    "the engine's copy receipt labels moved - re-aim COPY_IDLE_LABEL with them");
  ok(/btn\.textContent = '📋 Copy for Athena';/.test(engine),
    'the engine no longer restores the idle Copy label');
  ok(/id="ez3Copy">📋 Copy for Athena</.test(engine),
    'the Copy button no longer ships the idle label the module reads');
  const h = bootRevWork();
  eq(h.api.COPY_IDLE_LABEL, 'Copy for Athena', 'the module idle-label contract moved');
  const probe = h.El('button');
  probe.textContent = '📋 Copy for Athena';
  eq(h.api.copyUnanswered(probe), true, 'a button still offering to copy is read as answered');
  probe.textContent = '✅ Copied';
  eq(h.api.copyUnanswered(probe), false, 'an answered copy is read as unanswered - it would copy twice');
  probe.textContent = '⚠ Not copied';
  eq(h.api.copyUnanswered(probe), false, 'a refused copy is read as unanswered - it would retry silently');
}
{
  /* the engine answers: the module must NOT copy a second time */
  const h = bootRevWork();
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  s.noteBox.value = 'S: knee pain. A: OA.';
  s.ez3Copy.click();                                     /* ONE press */
  eq(s.ez3Copy.textContent, '✅ Copied', 'the engine half did not answer the copy');
  h.clock.advance(2000);
  eq(s.copyBtn.clickCount, 0, 'the module copied a second time on top of the engine');
}
{
  /* the engine is silent (the empty-registry window): the module answers */
  const h = bootRevWork({ engineDeaf: true });
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  s.noteBox.value = 'S: knee pain. A: OA.';
  s.ez3Copy.click();                                     /* ONE press */
  h.clock.advance(2000);
  eq(s.copyBtn.clickCount, 1, 'Copy for Athena was a silent dead press with no owner');
}
{
  /* no note: the engine owns the refusal, and it is said exactly once */
  const h = bootRevWork({ engineDeaf: true });
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  h.sandbox.toasts.length = 0;
  s.ez3Copy.click();
  h.clock.advance(2000);
  eq(s.copyBtn.clickCount, 0, 'Copy pressed the app control with no note to copy');
  eq(h.sandbox.toasts.filter((t) => /no note to copy/i.test(t.msg)).length, 0,
    'the module doubled the engine own no-note refusal');
}

/* ---- 6k. THE WORKSPACE CONTROLS ACT ON THE FIRST PRESS ----------------- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  s.noteBox.value = 'S: knee pain. A: OA. P: PT.';
  s.tx.value = 'doctor and patient talking';
  h.api.sync();

  /* reviewfix-1.0.0 RE-AIMED THIS PIN AND KEPT ITS PROPERTY: "the review
     workspace's controls act on the FIRST press". #mlsRevSave and #mlsRevSend
     were PROXIES that pressed #saveNoteBtn and #pushAllEmrBtn; the owner
     counted them as duplicates of controls already on the same screen, so
     they are retired and the ORIGINALS are adopted into the panel. The press
     tested here is therefore the doctor's press on the app's own button, and
     the property is stronger: there is no second control that could have
     received it. */
  const slot = h.doc.getElementById('mlsRevSlot');
  const codes = h.doc.getElementById('mlsRevCodes');
  ok(slot && codes, 'the review workspace lost its slot or its codes entry');
  eq(h.doc.getElementById('mlsRevSave'), null, 'the retired Save proxy is back');
  eq(h.doc.getElementById('mlsRevSend'), null, 'the retired Send proxy is back');
  eq(codes.disabled, false, 'a review control ships disabled - it eats the click');
  eq(s.actions.parentNode, slot, 'the last-step row is not in the review workspace');

  eq(h.api.save(), 'saveNoteBtn', 'Save to history did not reach the app own control');
  eq(s.saveBtn.clickCount, 1, 'Save to history did not act on the FIRST press');
  eq(h.api.send(), 'pushAllEmrBtn', 'Send to Athena did not reach the app own control');
  eq(s.push.clickCount, 1, 'Send to Athena did not act on the FIRST press');
  eq(s.push.scrolls.length, 0, 'Send scrolled to a control that was already on screen');
  codes.click();
  eq(s.emrCard.scrolls.length, 0, 'Codes & billing scrolled to a card that was already on screen');
}

/* ---- 6l. A REPAINT KEEPS NODE IDENTITY --------------------------------- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  s.noteBox.value = 'S: knee pain.';
  h.api.sync();
  /* reviewfix-1.0.0: the note the doctor types in and the button he may be
     about to press are now the app's OWN nodes, borrowed into the panel. The
     property is unchanged and the stakes are higher: replacing one of these
     would not lose a copy, it would lose the note. */
  const note = h.doc.getElementById('noteBox');
  const status = h.doc.getElementById('mlsRevStatus');
  const ident = h.doc.getElementById('mlsRevIdentity');
  const save = h.doc.getElementById('saveNoteBtn');
  const slot = h.doc.getElementById('mlsRevSlot');
  ok(note && status && ident && save && slot, 'the review workspace did not build');
  eq(note.parentNode, slot, 'the one note is not in the review workspace');

  s.noteBox.value = 'S: knee pain, left. A: OA.';
  h.api.sync();
  h.clock.advance(4000);
  eq(h.doc.getElementById('noteBox'), note, 'a repaint replaced the note box the doctor is typing in');
  eq(note.parentNode, slot, 'a repaint moved the note out of the review workspace');
  eq(h.doc.getElementById('mlsRevStatus'), status, 'a repaint replaced the status line');
  eq(h.doc.getElementById('mlsRevIdentity'), ident, 'a repaint replaced the patient identity line');
  eq(h.doc.getElementById('saveNoteBtn'), save, 'a repaint replaced a button the doctor may be about to press');
  eq(note.value, 'S: knee pain, left. A: OA.', 'the one note lost its text across a repaint');
}

/* ---- 6m. the schedule anchor still only OFFERS, and offers in place ---- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h);
  h.clock.advance(1200);
  eq(h.api.anchorOffer('Bernard Other', '9'), true, 'the schedule anchor stopped offering');
  eq(h.sandbox.selected, undefined, 'the schedule anchor switched the patient by itself');
  const strip = h.doc.getElementById('mlsRevAnchorOffer');
  ok(strip, 'the offer strip was not built');
  eq(h.api.anchorOffer('Bernard Other', '9'), true, 'a repeated offer for the same patient was refused');
  eq(h.doc.getElementById('mlsRevAnchorOffer'), strip, 'a repeated offer rebuilt the strip instead of leaving it alone');
}

/* ==========================================================================
 * 7.  THE WALK ITSELF - every control named in the owner's path is reachable
 * ======================================================================== */
{
  /* Patient -> Visit -> record / paste -> Generate -> Review -> Send. Each of
     these ids is the ONE control for its job; a second control for the same
     job is what the owner called a duplicate. */
  const ONE_OF_EACH = [
    ["ez3flPaste", /pasteChip\.id = 'ez3flPaste';/, LANE],
    ["ez3flGen", /gb\.id = 'ez3flGen';/, LANE],
    ["ez3flReview", /id="ez3flReview"/, LANE],
    ["ez3flAvs", /avsQuick\.id = 'ez3flAvs';/, LANE]
  ];
  ONE_OF_EACH.forEach(([id, re, src]) => {
    eq((src.match(new RegExp(re.source, 'g')) || []).length, 1,
      'the walkthrough control #' + id + ' is no longer created exactly once');
  });
  /* the one Athena door is unmoved: nothing here may add a second one */
  eq((RW_BLOCK.match(/SEND_TARGET = 'pushAllEmrBtn'/g) || []).length, 1,
    'the single Athena entry is no longer declared exactly once');
  /* the CODE, never the prose: both blocks explain at length which Athena
     actions they do NOT touch, so the token scan has to read past that. */
  const rwCode = codeOnly(RW_BLOCK), laneCode = codeOnly(LANE);
  ['write_note', 'save_draft', 'sign_encounter', 'stage_billing', 'place_order'].forEach((tok) => {
    ok(rwCode.indexOf(tok) < 0, 'the review workspace names the write-path token ' + tok);
    ok(laneCode.indexOf(tok) < 0, 'the visit lane names the write-path token ' + tok);
  });
}

console.log('PASS visit-walkthrough: ' + checks + ' checks - the click registry is never emptied without being refilled; ' +
  'a no-op repaint destroys neither the visit lane nor the transcript; the style chips are patched in place instead of ' +
  'rebuilt under the cursor; one door to the review workspace and no dropped scroll argument; every control scrolls to ' +
  'its own result with the minimum move and never when it is already on screen; a format chip reformats the note on the ' +
  'FIRST press; Edit note opens the box and survives the formatted view repaint; Regenerate never shouts over a working ' +
  'generation and still rescues a press nothing answered; Copy for Athena has an owner; and a repaint keeps the identity ' +
  'of every node the doctor may be about to press');
