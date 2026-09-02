'use strict';

/* review-workspace-proof.js  --  revwork-1.0.0 (b1169)
 * ============================================================================
 * The owner's 2026-09-01 report, turned into pins and into a running proof.
 *
 *   "the review the note section in the bottom needs a complete re work and
 *    make everything work there as the top part does"
 *   "what happened here, how did the thing go away"
 *
 * SIX THINGS THIS SUITE REFUSES TO LET REGRESS
 *
 *  1. THE GUIDED FLOW CAN NEVER BE HIDDEN. No stylesheet in the shipped bundle
 *     hides #ez3Wrap / #mlsEz3Body / #mlsEz3, the workspace toggle writes no
 *     display anywhere, and the module that owns the invariant is executed here
 *     against a DOM in the exact broken state the owner measured (body.ez3adv
 *     on, #ez3Wrap inline display:none, the second press not helping) and must
 *     bring the flow back.
 *
 *  2. THE TOGGLE IS HONEST. Both labels say "the review workspace below"; the
 *     word "advanced" is gone from the control, because the thing it opens is
 *     an ADDITION under the flow, not a replacement for it.
 *
 *  3. "REVIEW THE NOTE" HAS REAL CONTROLS. #mlsRevWork is built inside
 *     #noteCard, directly after the #mlsAtStep2 step banner, carrying the
 *     eleven ids below - and none of them ships `disabled`.
 *
 *  4. NO SECOND GENERATOR AND NO SECOND ATHENA DOOR. The review Generate walks
 *     the SAME ladder the guided flow's generateTopNote() walks (#ez3Gen then
 *     #genBtn, behind the flow's own #ez3flGen), and Send presses
 *     #pushAllEmrBtn - the existing writeflow entry - and nothing else. The
 *     module names no Athena action, no destination and no gate.
 *
 *  5. CONSENT PENDING IS NOT A RECORDER FAILURE (owner blocker). startSegment
 *     is executed here on all three outcomes: consent already given, consent
 *     pending, and a real failure. The pending case must arm the span, return
 *     the sentinel, start the recorder when the doctor confirms, and never let
 *     the caller paint "The recorder could not start".
 *
 *  6. TWO QUIET DATA DEFECTS. Consent is not re-asked when a placeholder
 *     encounter label resolves into its own appointment (but IS re-asked for a
 *     different concrete appointment or a different patient); and a correction
 *     typed during a live recording no longer duplicates the in-flight
 *     utterance when the recognizer finalises it.
 *
 * Run: node tests/review-workspace-proof.js
 * ==========================================================================*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

const CONNECT = read('1p-mls-connect.js');
const SHELL = read('1pScribeFlow.html');
const TWIN = read(path.join('1p', 'index.html'));
const SEGMENTS = read('feat_mls_recording_segments.js');
const WRITEFLOW = read('1p-feat_mls_writeflow.js');

const settle = () => new Promise((r) => setTimeout(r, 0));

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) {
  checks++;
  var shown = (a !== null && typeof a === 'object') ? '[object]' : JSON.stringify(a);
  assert.strictEqual(a, b, msg + ' (got ' + shown + ')');
}

/* ==========================================================================
 * 0.  THE MODULE EXISTS, AND IT IS THE ONLY THING THIS SUITE RUNS
 * ======================================================================== */
const BEGIN = '/* ===== revwork-1.2.0 begin ============================================== */';
const END = '/* ===== revwork-1.2.0 end ================================================ */';
ok(CONNECT.indexOf(BEGIN) > 0, 'the revwork block is missing from 1p-mls-connect.js');
ok(CONNECT.indexOf(END) > CONNECT.indexOf(BEGIN), 'the revwork block has no end marker');
eq(CONNECT.split(BEGIN).length - 1, 1, 'the revwork block is duplicated');
const ANCHOR = read('feat_mls_upnow_activeselect.js');
const BLOCK = CONNECT.slice(CONNECT.indexOf(BEGIN) + BEGIN.length, CONNECT.indexOf(END));
/* The block's own prose explains at length which Athena actions it does NOT
   touch, so a token scan has to read the CODE. This module carries no regex
   literals and no // comments inside strings, which is what makes this strip
   safe here. */
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
ok(CODE.length > 4000 && CODE.indexOf('*') < 0, 'the comment strip did not produce a clean code view');

/* ==========================================================================
 * 1.  THE FLOW CAN NEVER BE HIDDEN  (static half)
 * ======================================================================== */
/* Not one rule in the shipped bundle or the shell may hide the flow's three
   containers. This is the shape of the defect the owner measured, so it is
   pinned as a shape and not as one selector. */
for (const [label, text] of [['1p-mls-connect.js', CONNECT], ['1pScribeFlow.html', SHELL]]) {
  for (const id of ['ez3Wrap', 'mlsEz3Body']) {
    /* the container must be the RULE SUBJECT: no descendant, child or sibling
       combinator between the id and the brace, or this would also flag the many
       legitimate rules that hide something INSIDE the flow. */
    const re = new RegExp('#' + id + '[^{},\\s>+~]*\\{[^}]*display\\s*:\\s*none', 'i');
    ok(!re.test(text), label + ' hides #' + id + ' with a CSS rule - the guided flow must never be hideable');
  }
}
/* The module itself may only ever REMOVE a hide. It must contain no assignment
   of display:none at all. */
ok(!/display\s*=\s*['"]none/.test(CODE), 'revwork writes an inline display:none somewhere');
ok(!/setProperty\(\s*['"]display['"]\s*,\s*['"]none/.test(CODE), 'revwork sets display:none through setProperty');
ok(/removeProperty\(\s*['"]display['"]\s*\)/.test(CODE), 'revwork never removes an inline display');
ok(/removeAttribute\(\s*['"]hidden['"]\s*\)/.test(CODE), 'revwork never removes a hidden attribute');
ok(/FLOW_IDS\s*=\s*\['mlsEz3',\s*'mlsEz3Body',\s*'ez3Wrap'\]/.test(CODE),
  'the three guarded flow containers are no longer named exactly');

/* The engine's own toggle still only flips a class and repaints. If it ever
   starts writing a display, the button becomes able to remove the flow again. */
const WIRE_ADV = CONNECT.slice(CONNECT.indexOf('  function wireAdv() {\n    on(\'ez3Adv\''));
const WIRE_ADV_BODY = WIRE_ADV.slice(0, WIRE_ADV.indexOf('\n  }\n'));
ok(WIRE_ADV_BODY.length > 100, 'the live wireAdv handler was not found');
ok(/classList\.toggle\('ez3adv'/.test(WIRE_ADV_BODY), 'the toggle no longer flips body.ez3adv');
ok(!/display/.test(WIRE_ADV_BODY), 'the advanced toggle now writes a display - that is how the flow disappeared');

/* ==========================================================================
 * 2.  THE TOGGLE IS HONEST  (static half)
 * ======================================================================== */
const ADV_ROW = CONNECT.slice(CONNECT.indexOf('  function advRowHtml() {'));
const ADV_ROW_BODY = ADV_ROW.slice(0, ADV_ROW.indexOf('\n  }\n'));
ok(/Hide the review workspace below/.test(ADV_ROW_BODY), 'the open label no longer says what it hides');
ok(/Show the review workspace below/.test(ADV_ROW_BODY), 'the closed label no longer says what it shows');
ok(!/advanced/i.test(ADV_ROW_BODY), 'the toggle still calls itself "advanced" - it names a place, not the act');
ok(/Open the review workspace below/.test(CONNECT),
  'the second door to the same room (.ez3fl-openws) no longer carries the matching wording');

/* ==========================================================================
 * 3.  THE REVIEW WORKSPACE  (static half)
 * ======================================================================== */
/* reviewfix-1.0.0 (owner 2026-09-02) RE-AIMED THIS PIN, AND IT IS THE SAME
   PROPERTY, NOT A WEAKER ONE. The property is "the review workspace declares,
   in one place, every id it owns". What changed is which ids it OWNS: three of
   them (mlsRevNote, mlsRevSave, mlsRevSend) were PROXIES for controls the app
   already ships - a second note textarea mirrored against #noteBox, and two
   buttons whose only body was to press #saveNoteBtn and #pushAllEmrBtn. The
   owner counted them as duplicates on a screen that painted the same note
   twice. They are retired below by the same rule that retired mlsRevGen and
   the other four in revwork-1.1.0, and the originals are ADOPTED into the
   panel instead - so the workspace still has a note, a Save and a Send, and
   each is now the ONE control with the app's own guards and the app's own
   written reason when it is off. */
const CONTROL_IDS = ['mlsRevWork', 'mlsRevStatus', 'mlsRevIdentity', 'mlsRevSlot',
  'mlsRevTools', 'mlsRevCodes'];
for (const id of CONTROL_IDS) {
  ok(CODE.indexOf("'" + id + "'") > 0, 'the review workspace no longer declares the id ' + id);
}
/* OWNER, 2026-09-01: "Make sure you're not adding in features that already work
   without removing anything, creating duplicate stuff." Each of these five had
   a working original in the guided flow, so the workspace copy is gone and the
   original is wired instead. One control per job. */
/* reviewfix-1.0.0 added the last three. mlsRevNote duplicated #noteBox (two
   textareas holding one note, kept in step by a mirror), mlsRevSave
   duplicated #saveNoteBtn and mlsRevSend duplicated #pushAllEmrBtn. */
const RETIRED_DUPLICATES = [
  ['mlsRevGen', 'ez3Regen'], ['mlsRevCopy', 'ez3Copy'], ['mlsRevOpNote', 'ez3Prep2'],
  ['mlsRevAvs', 'ez3flAvs'], ['mlsRevCapture', 'ez3flPaste'],
  ['mlsRevNote', 'noteBox'], ['mlsRevSave', 'saveNoteBtn'], ['mlsRevSend', 'pushAllEmrBtn']
];
for (const [dup, original] of RETIRED_DUPLICATES) {
  ok(CODE.indexOf("'" + dup + "'") < 0,
    'the workspace still ships ' + dup + ', which duplicates the flow control ' + original);
  ok(CONNECT.indexOf(original) > 0, 'the original control ' + original + ' disappeared - nothing may be removed');
}
ok(/\$\('noteCard'\)/.test(CODE), 'the review workspace is no longer built inside #noteCard');
ok(/\$\('mlsAtStep2'\)/.test(CODE), 'the review workspace is no longer anchored on the #mlsAtStep2 step banner');
/* gcx-1.0.0: a disabled control eats the click and explains nothing. */
ok(!/\.disabled\s*=\s*true/.test(CODE), 'a review control now ships disabled - it must refuse out loud instead');

/* THE ORIGINALS. The capture-phase router must reach the style chips, Edit and
   Regenerate - and must NOT press them a second time (ez3Click is registered
   on the same target first, so the engine half has already run). */
ok(/t\.closest\('#ez3StyleChips \[data-chip\]'\)/.test(CODE), 'the style chips are not routed');
/* walkfix-1.0.0 (b1184) re-aimed this pin: Copy for Athena joined the router.
   It was the one control of the three with no owner outside the engine's
   click registry, so in any window where that registry was empty the press
   was completely silent. All three ids are routed now. */
ok(/t\.closest\('#ez3Edit,#ez3Regen,#ez3Copy'\)/.test(CODE), 'Edit note, Regenerate and Copy are not all routed');
ok(!/stopImmediatePropagation|stopPropagation/.test(CODE),
  'the router stops propagation - that would disable the engine half these controls still need');
ok(!/setGenStyle|setGenLength/.test(CODE),
  'the router writes the style preference itself - that is the engine half, and repeating it is a duplicate');
ok(/ORIGINALS\s*=\s*\{/.test(CODE) && /edit: 'ez3Edit'/.test(CODE) && /regen: 'ez3Regen'/.test(CODE),
  'the original control ids are no longer named in one place');

/* ==========================================================================
 * 4.  ONE GENERATOR, ONE ATHENA DOOR  (static half)
 * ======================================================================== */
/* generateTopNote() - the guided flow's own generator - resolves exactly these
   two engine controls. The review Generate must end on the same pair. */
ok(/var canonical = \$\('ez3Gen'\), gen = \$\('genBtn'\);/.test(CONNECT),
  "generateTopNote's own ladder changed; re-aim GEN_TARGETS with it");
ok(/GEN_TARGETS\s*=\s*\['ez3flGen',\s*'ez3Gen',\s*'genBtn'\]/.test(CODE),
  'the review Generate no longer walks the same ladder the guided flow walks');
ok(!/generateNote\s*\(/.test(CODE), 'the review workspace calls a generator of its own');
ok(!/regenerateNote\s*\(/.test(CODE), 'the review workspace calls a regenerator of its own');

eq((CODE.match(/SEND_TARGET\s*=\s*'pushAllEmrBtn'/g) || []).length, 1,
  'the single Athena entry is no longer declared exactly once');
ok(/id="pushAllEmrBtn"/.test(SHELL) && /pushEntireVisitToAthena\(this\)/.test(SHELL),
  '#pushAllEmrBtn is no longer the shell control that opens the reviewed Athena sheet');
/* The module must name no Athena action, no destination and no gate. */
for (const forbidden of ['write_note', 'save_draft', 'sign_encounter', 'stage_billing', 'place_order',
  'athenaExecute', 'noteWriteProof']) {
  ok(CODE.indexOf(forbidden) < 0, 'the review workspace names the write-path token ' + forbidden);
}
/* And the write path's own closed executable set is untouched. */
ok(WRITEFLOW.indexOf('var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true, place_order: true };') > 0,
  'the writeflow executable-action set moved - this change may not touch it');

/* ==========================================================================
 * 5.  THE PASTE CHIPS REACH A TRANSCRIPT THAT IS ACTUALLY ON SCREEN
 * ======================================================================== */
eq((CONNECT.match(/rw\.revealTranscript\(\)/g) || []).length, 2,
  'both paste entries (the flow-lane chip and #ez3QPaste) must route through the one revealer');
ok(/TX_TARGETS\s*=\s*\['ez3flTranscript',\s*'ez3Transcript',\s*'transcript'\]/.test(CODE),
  'the transcript ladder is no longer most-visible-first');
ok(/pasteChip\.id\s*=\s*'ez3flPaste'/.test(CONNECT), 'the flow-lane paste chip has no id to test with');
/* A GUARD THAT ITSELF THROWS IS NOT A GUARD. The visit-lane module (fl-1.7.2)
   never defined isFn, so every isFn( call inside that IIFE resolved to nothing
   and threw a ReferenceError - which a surrounding try/catch then swallowed,
   making the after-visit-summary fallback permanently unreachable. Adding one
   more such call to the paste chip, which has no try/catch, would have made the
   chip do nothing at all. Both now use a bare typeof, and this pin keeps the
   module free of the helper it does not own. */
{
  const at = CONNECT.indexOf("var VERSION = 'fl-1.7.2';");
  ok(at > 0, 'the visit-lane module version marker moved; re-aim this pin');
  const laneSrc = CONNECT.slice(at, CONNECT.indexOf('window.__mlsEz3Flow = {', at));
  ok(laneSrc.length > 10000, 'the visit-lane module could not be sliced');
  const lane = laneSrc.replace(/\/\*[\s\S]*?\*\//g, ' ');   /* the comments explain the trap; read the code */
  ok(!/[^.\w]isFn\s*\(/.test(lane),
    'the visit-lane module calls isFn(), which it does not define - that call throws');
}

/* ==========================================================================
 * 6.  A TINY DOM, AND THE MODULE RUN AGAINST IT
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
  /* one comma group may be a descendant chain ("#ez3StyleChips [data-chip]") */
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
  function El(tag) {
    const el = {
      tagName: String(tag).toUpperCase(), id: '', className: '', type: '', title: '',
      placeholder: '', value: '', disabled: false, textContent: '',
      childNodes: [], parentNode: null, attrs: Object.create(null),
      _events: Object.create(null), _rect: { width: 220, height: 30 },
      clickCount: 0, scrolled: 0, style: makeStyle()
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
    el.scrollIntoView = () => { el.scrolled++; };
    el.getBoundingClientRect = () => el._rect;
    el.closest = (sel) => { let n = el; while (n) { if (matchesSel(n, sel)) return n; n = n.parentNode; } return null; };
    el.querySelector = () => null;
    el.querySelectorAll = () => [];
    return el;
  }
  function fireClick(target) {
    const ev = { type: 'click', target, bubbles: true, isTrusted: false, detail: 1 };
    (docListeners.click || []).slice().forEach((fn) => fn(ev));   /* capture phase on document */
    let n = target;
    while (n) { (n._events.click || []).slice().forEach((fn) => fn(ev)); n = n.parentNode; }
  }
  function walk(node, fn) { fn(node); node.childNodes.forEach((c) => walk(c, fn)); }

  const head = El('head'); const body = El('body');
  const document = {
    readyState: 'complete', hidden: false, activeElement: null,
    head: head, body: body,
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
function bootRevWork() {
  const dom = makeDom();
  const clock = makeClock();
  const sandbox = {
    document: dom.document,
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    Event: function (type, opts) { this.type = type; this.bubbles = !!(opts && opts.bubbles); },
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
  vm.createContext(sandbox);
  vm.runInContext(BLOCK, sandbox, { filename: 'revwork-1.0.0.js' });
  return { dom, clock, sandbox, api: sandbox.__mlsRevWork, doc: dom.document, El: dom.El };
}
/* the visit screen, in the shape the module meets it */
function paintVisitScreen(h, opts) {
  opts = opts || {};
  const d = h.doc, mk = (tag, id, parent) => { const e = h.El(tag); e.id = id; (parent || d.body).appendChild(e); return e; };
  const visitView = mk('div', 'visitView');
  const ez3 = mk('div', 'mlsEz3', visitView);
  const ez3Body = mk('div', 'mlsEz3Body', ez3);
  const wrap = mk('div', 'ez3Wrap', ez3Body);
  const adv = mk('button', 'ez3Adv', wrap);
  /* the visit header card - the name the note is written for */
  const ptCard = h.El('div'); ptCard.className = 'ez3-pt'; ptCard.textContent = opts.headerName || 'Adam Tester'; wrap.appendChild(ptCard);
  /* the flow's OWN note editor, the style chips and the three-button row */
  const ez3Note = mk('textarea', 'ez3Note', wrap);
  const chipHost = mk('div', 'ez3StyleChips', wrap);
  const chips = ['SOAP', 'APSO', 'Narrative', 'Problem-based', 'H&P', 'Concise', 'Standard', 'Detailed'].map((label) => {
    const c = h.El('button'); c.setAttribute('data-chip', label); c.className = 'ez3-chip'; c.textContent = label;
    chipHost.appendChild(c); return c;
  });
  const ez3Edit = mk('button', 'ez3Edit', wrap);
  const ez3Regen = mk('button', 'ez3Regen', wrap);
  const ez3Copy = mk('button', 'ez3Copy', wrap);
  const flTx = mk('textarea', 'ez3flTranscript', wrap);
  const flGen = mk('button', 'ez3flGen', wrap);
  const ez3Gen = mk('button', 'ez3Gen', wrap);
  const tx = mk('textarea', 'transcript', visitView);
  const genBtn = mk('button', 'genBtn', visitView);
  const noteCard = mk('div', 'noteCard', visitView);
  const step2 = mk('div', 'mlsAtStep2', noteCard);
  const noteBox = mk('textarea', 'noteBox', noteCard);
  /* reviewfix-1.0.0: the shell ships these four inside ONE `.note-actions` row
     (1pScribeFlow.html, the primary last-step row), and the row - not the
     buttons - is what the workspace adopts. Painting them as loose children
     would measure a shape the product does not have. */
  const actions = h.El('div'); actions.className = 'note-actions'; noteCard.appendChild(actions);
  const signBtn = mk('button', 'signBtn', actions);
  const saveBtn = mk('button', 'saveNoteBtn', actions);
  const copyBtn = mk('button', 'copyEmrBtn', actions);
  const push = mk('button', 'pushAllEmrBtn', actions);
  const emrCard = mk('div', 'emrCard', visitView);
  const emrTable = mk('table', 'emrTable', emrCard);
  /* the engine handler, verbatim in behaviour: flip the class, repaint. */
  adv.addEventListener('click', function () {
    const open = d.body.classList.toggle('ez3adv');
    adv.textContent = open ? 'engine repaint: hide' : 'engine repaint: show';
    if (opts.hidesFlow) wrap.style.setProperty('display', 'none');
  });
  return { visitView, ez3, ez3Body, wrap, adv, ptCard, ez3Note, chipHost, chips, ez3Edit, ez3Regen, ez3Copy, actions, signBtn,
           flTx, flGen, ez3Gen, tx, genBtn, noteCard, step2, noteBox, saveBtn, copyBtn, push, emrCard, emrTable };
}

/* ---- 6a. the module installs and answers ------------------------------- */
{
  const h = bootRevWork();
  ok(h.api && h.api.installed === true, 'revwork did not install in a bare DOM');
  eq(h.api.version, 'revwork-1.2.0', 'revwork version stamp moved without a suite update');
  eq(h.api.SEND_TARGET, 'pushAllEmrBtn', 'the single Athena entry is not #pushAllEmrBtn at runtime');
  eq(Array.prototype.join.call(h.api.GEN_TARGETS, ','), 'ez3flGen,ez3Gen,genBtn',
    'the runtime Generate ladder is not ez3flGen -> ez3Gen -> genBtn');
  ok(/below/.test(h.api.advLabel(true)) && /below/.test(h.api.advLabel(false)),
    'a toggle label stopped saying the workspace is BELOW the flow');
  ok(!/advanced/i.test(h.api.advLabel(true) + h.api.advLabel(false)),
    'a toggle label still says "advanced"');
  ok(/Hide/.test(h.api.advLabel(true)) && /Show/.test(h.api.advLabel(false)),
    'the two toggle labels are not a true open/closed pair');
  eq(h.api.genLabelFor({ note: '' }), 'Generate note', 'the empty-note Generate label moved');
  eq(h.api.genLabelFor({ note: 'x' }), 'Regenerate note', 'the has-note Generate label moved');
  ok(/Capture or paste/.test(h.api.statusFor({})), 'the empty status stopped naming the next step');
  ok(/Generate/.test(h.api.statusFor({ tx: 'words' })), 'the transcript-ready status stopped naming Generate');
  ok(/Sign & Save/.test(h.api.statusFor({ note: 'n' })),
    'the note-ready status stopped saying Sign & Save is the doctor own click in athenaOne');
}

/* ---- 6b. THE OWNER'S DEFECT, REPRODUCED AND CURED ---------------------- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h, { hidesFlow: true });
  h.clock.advance(1200);                       /* let boot settle */

  s.adv.click();                               /* the press that made the flow go away */
  eq(s.wrap.style.getPropertyValue('display'), 'none',
    'the harness did not reproduce the measured defect - #ez3Wrap should be hidden right after the press');
  h.clock.advance(1200);                       /* the module re-checks across the repaint window */

  eq(s.wrap.style.getPropertyValue('display'), '',
    'THE GUIDED FLOW IS STILL GONE after the workspace toggle - this is the owner report');
  eq(h.doc.body.classList.contains('ez3adv'), true,
    'the workspace did not actually open - the toggle must still open the review cards');
  eq(s.adv.textContent, h.api.advLabel(true),
    'the toggle label was not restored to the honest wording after the engine repaint');

  s.adv.click();                               /* and the second press must close it, not strand it */
  h.clock.advance(1200);
  eq(h.doc.body.classList.contains('ez3adv'), false, 'the toggle does not close again - it is not a toggle');
  eq(s.wrap.style.getPropertyValue('display'), '', 'the flow was hidden again by the closing press');
  eq(s.adv.textContent, h.api.advLabel(false), 'the closed label is not the honest closed wording');
}

/* ---- 6c. the invariant is gated on the visit view being on screen ------ */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h, {});
  h.clock.advance(1000);   /* let the module reconcile onto the freshly painted screen */
  s.wrap.style.setProperty('display', 'none');
  s.ez3Body.setAttribute('hidden', '');
  eq(h.api.unhideFlow(), 2, 'unhideFlow did not report both rescued containers');
  eq(s.wrap.style.getPropertyValue('display'), '', 'the wrap was not un-hidden');
  eq(s.ez3Body.hasAttribute('hidden'), false, 'the hidden attribute was not removed');

  /* off the visit tab the whole room is legitimately hidden by its owner */
  s.visitView.style.setProperty('display', 'none');
  s.wrap.style.setProperty('display', 'none');
  eq(h.api.unhideFlow(), 0, 'the invariant fired while the visit view was closed - it must not fight its owner');
  eq(s.wrap.style.getPropertyValue('display'), 'none', 'a legitimately closed visit view was forced open');
}

/* ---- 6d. the review workspace is real --------------------------------- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h, {});
  h.clock.advance(1000);   /* let the module reconcile onto the freshly painted screen */
  const root = h.doc.getElementById('mlsRevWork');
  ok(root, '#mlsRevWork was not built');
  eq(root.parentNode && root.parentNode.id, 'noteCard', 'the review workspace was not built inside #noteCard');
  eq(s.noteCard.childNodes.indexOf(root), s.noteCard.childNodes.indexOf(s.step2) + 1,
    'the review workspace is not directly under the "Review the note" step banner');
  for (const id of CONTROL_IDS) ok(h.doc.getElementById(id), 'the review workspace is missing #' + id);
  /* gcx: the one control this module still MINTS must never ship disabled.
     The adopted originals are a different case on purpose - #saveNoteBtn and
     the rest ship disabled and enableOutputs() writes the reason onto them,
     which is more honest than a copy that cannot explain itself. */
  eq(h.doc.getElementById('mlsRevCodes').disabled, false, '#mlsRevCodes ships disabled');
  for (const [dup] of RETIRED_DUPLICATES) {
    eq(h.doc.getElementById(dup), null, 'the retired duplicate ' + dup + ' is still built at runtime');
  }

  /* reviewfix-1.0.0: ONE NOTE, IN THE WORKSPACE. The mirror this block used to
     pin is gone because the second box is gone: the app's own #noteBox is
     MOVED into the panel, so "does the generated note reach the review box"
     and "does an edit here reach the one note" are the same question asked of
     one node, and cannot be answered wrong. */
  const slot = h.doc.getElementById('mlsRevSlot');
  ok(slot, 'the review workspace has no slot for the adopted note');
  eq(s.noteBox.parentNode, slot, 'the one note is not inside the review workspace');
  eq(h.doc.getElementById('mlsRevNote'), null, 'a second note textarea is back in the workspace');
  s.noteBox.value = 'SUBJECTIVE: knee pain.';
  h.api.sync();
  eq(s.noteBox.parentNode, slot, 'a reconcile moved the note out of the review workspace');
  eq(s.noteBox.value, 'SUBJECTIVE: knee pain.', 'a reconcile changed the note text');
  /* and the app's own last-step row came with it, whole */
  eq(s.actions.parentNode, slot, 'the last-step action row is not in the review workspace');
  eq(s.saveBtn.parentNode, s.actions, 'Save to history left its own row');
  eq(s.push.parentNode, s.actions, 'Review Athena actions left its own row');
  eq(s.copyBtn.parentNode, s.actions, 'Copy note text left its own row');
  eq(s.signBtn.parentNode, s.actions, 'Review & Sign left its own row');
  ok(h.doc.getElementById('mlsRevIdentity'), 'the workspace lost its patient identity line');
  /* revert must PUT THEM BACK - a hot reload of this module may not take the
     doctor's note and his whole action row out of the document */
  h.api.revert();
  eq(h.doc.getElementById('mlsRevWork'), null, 'revert left the panel behind');
  eq(s.noteBox.parentNode, s.noteCard, 'revert did not return the note to #noteCard');
  eq(s.actions.parentNode, s.noteCard, 'revert did not return the last-step row to #noteCard');
  eq(s.saveBtn.parentNode, s.actions, 'revert scattered the last-step row');
}

/* ---- 6e. one generator, one Athena door (runtime) ---------------------- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h, {});
  h.clock.advance(1000);   /* let the module reconcile onto the freshly painted screen */

  eq(h.api.generate(), '', 'Generate ran with no transcript at all');
  eq(s.flGen.clickCount + s.ez3Gen.clickCount + s.genBtn.clickCount, 0, 'Generate pressed something with no transcript');
  ok(h.sandbox.toasts.some((t) => /Capture, dictate or paste/.test(t.msg)), 'Generate refused silently');

  s.tx.value = 'doctor and patient talking';
  eq(h.api.generate(), 'ez3flGen', 'Generate did not press the guided flow own control first');
  s.flGen.parentNode.removeChild(s.flGen);
  eq(h.api.generate(), 'ez3Gen', 'Generate did not fall back to the engine control generateTopNote uses');
  s.ez3Gen.disabled = true;
  eq(h.api.generate(), 'genBtn', 'Generate did not fall back to the base #genBtn, the last rung of the same ladder');

  /* Send */
  h.sandbox.toasts.length = 0;
  eq(h.api.send(), '', 'Send ran with no note');
  eq(s.push.clickCount, 0, 'Send opened the Athena sheet with no note');
  s.noteBox.value = 'A: knee OA. P: PT.';
  eq(h.api.send(), 'pushAllEmrBtn', 'Send did not press the existing writeflow entry');
  eq(s.push.clickCount, 1, 'Send pressed #pushAllEmrBtn more than once, or not at all');
  eq(s.saveBtn.clickCount + s.copyBtn.clickCount, 0, 'Send pressed something other than the Athena entry');
  /* the plan gate writes an INLINE hide on that button; Send must say so, not fail silently */
  h.sandbox.toasts.length = 0;
  s.push.style.setProperty('display', 'none');
  eq(h.api.send(), '', 'Send pressed a control the plan gate had hidden');
  eq(s.push.clickCount, 1, 'Send pressed the hidden Athena control anyway');
  ok(h.sandbox.toasts.some((t) => /not part of your plan/.test(t.msg)), 'a plan-blocked Send says nothing');

  /* Save presses the app own handler; Copy is the FLOW's control now */
  s.push.style.removeProperty('display');
  eq(h.api.save(), 'saveNoteBtn', 'Save to history is not the app own control');
  eq(h.api.copy(), 'copyEmrBtn', 'Copy no longer routes to the app own control');
}

/* ---- 6f. the paste path reaches a visible transcript ------------------- */
{
  const h = bootRevWork();
  const s = paintVisitScreen(h, {});
  h.clock.advance(1000);   /* let the module reconcile onto the freshly painted screen */
  eq(h.api.revealTranscript(), true, 'the revealer found no transcript at all');
  eq(h.doc.activeElement && h.doc.activeElement.id, 'ez3flTranscript', 'the revealer did not focus the flow transcript');
  /* the flow lane hidden (phone shell, or a repaint): fall through, never dead-end */
  s.flTx.style.setProperty('display', 'none');
  h.doc.activeElement = null;
  eq(h.api.revealTranscript(), true, 'the revealer gave up when the flow transcript was hidden');
  ok(h.doc.activeElement === s.tx || (h.doc.activeElement && h.doc.activeElement.id === 'ez3Transcript'),
    'the revealer did not fall through to a transcript the doctor can actually see');
}

/* ==========================================================================
 * 7.  CONSENT PENDING IS NOT A RECORDER FAILURE   (owner blocker)
 * ======================================================================== */
ok(/CONSENT_PENDING\s*=\s*"consent-pending"/.test(SEGMENTS),
  'the segment module no longer names a distinct consent-pending outcome');
ok(/CONSENT_PENDING: CONSENT_PENDING/.test(SEGMENTS), 'the sentinel is not exported for callers to name');
ok(/_mlsHasEncounterConsent/.test(SEGMENTS), 'startSegment no longer asks the consent gate before starting');
ok(/awaitingConsent/.test(CONNECT) && /seg\.CONSENT_PENDING/.test(CONNECT),
  'the visit lane no longer distinguishes a pending consent from a failure');
{
  /* the exact refusal must survive for the cases that ARE failures */
  const at = CONNECT.indexOf('The recorder could not start. Your existing transcript is safe.');
  ok(at > 0, 'the fail-closed recorder refusal was deleted rather than narrowed');
  /* recvis-1.0.0 (2026-09-02) — SLICE RE-AIMED, PROPERTY UNCHANGED. This read
     the ONE line the refusal sits on, which held both the gate and the toast
     while the refusal was a one-liner. recvis-1.0.0 turned it into a block —
     the refusal now also asks the page WHY (mic, speech-hub owner, a mid-start
     patient switch) and leaves a persistent reason on the lane, because a toast
     that is gone in seconds is how "sometimes it doesn't record" stayed
     invisible. So the gate is one line up, inside the enclosing `if`, and the
     slice reads the ENCLOSING STATEMENT instead of one line. What is asserted
     is exactly what was asserted before: this refusal fires only for a REAL
     failure and never for a pending consent. */
  const stmt = CONNECT.slice(Math.max(0, at - 900), at);
  const guard = stmt.lastIndexOf('if (');
  ok(guard >= 0, 'the recorder refusal is no longer inside a guard at all');
  ok(/!started && !awaitingConsent/.test(stmt.slice(guard)),
    'the recorder refusal is not gated on "a real failure, not a pending consent"');
}
/* run startSegment itself on all three outcomes */
function startSegmentHarness(world) {
  const src = SEGMENTS.slice(SEGMENTS.indexOf('  var CONSENT_PENDING = "consent-pending";'),
    SEGMENTS.indexOf('  function stopSegment() {'));
  ok(src.length > 400, 'the startSegment source could not be extracted');
  const factory = new Function('world', `
    "use strict";
    var window = world.window;
    var armed = null;
    var renders = 0;
    function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
    function isFn(f) { return typeof f === "function"; }
    function activePt() { return world.patient; }
    function uid() { return "seg-" + (++world.seq); }
    function kindOf(k) { return { key: k || "visit", label: "Visit" }; }
    function transcriptVal() { return world.transcript; }
    function nowMs() { return ++world.clock; }
    function isCapturing() { return !!world.capturing; }
    function render() { renders++; }
    ${src}
    return { startSegment: startSegment, CONSENT_PENDING: CONSENT_PENDING,
             armed: function () { return armed; }, renders: function () { return renders; } };
  `);
  return factory(world);
}
{
  /* (a) consent already given -> unchanged: arm and start */
  const world = { seq: 0, clock: 0, transcript: 'so far', capturing: false, patient: { id: '7', name: 'A', dob: '1980-01-01' } };
  world.window = {
    _mlsHasEncounterConsent: () => true,
    _mlsRequestEncounterConsent: () => { throw new Error('must not ask when consent is already given'); },
    startCapture: () => { world.capturing = true; return true; }
  };
  const h = startSegmentHarness(world);
  const id = h.startSegment('visit');
  ok(id && id !== h.CONSENT_PENDING, 'a consented start no longer returns a segment id');
  ok(h.armed(), 'a consented start left no armed segment');
}
(async () => {
{
  /* (b) consent PENDING -> the owner blocker */
  let asked = 0; let resolveConsent = null; let started = 0;
  const world = { seq: 0, clock: 0, transcript: 'so far', capturing: false, patient: { id: '7', name: 'A', dob: '1980-01-01' } };
  let consented = false;
  world.window = {
    _mlsHasEncounterConsent: () => consented,
    _mlsRequestEncounterConsent: () => { asked++; return new Promise((r) => { resolveConsent = r; }); },
    startCapture: () => { started++; if (!consented) return false; world.capturing = true; return true; }
  };
  const h = startSegmentHarness(world);
  const out = h.startSegment('visit');
  eq(out, h.CONSENT_PENDING, 'a pending consent still reads as a recorder failure');
  ok(out, 'the pending outcome is falsy - every `if (!startSegment(...))` caller will call it a failure');
  eq(asked, 1, 'the consent dialog was not opened by the segment path');
  eq(started, 0, 'startCapture ran before consent, which is what produced the false refusal');
  ok(h.armed(), 'the span was disarmed while the consent dialog was open - segment one would be lost');

  consented = true;
  resolveConsent(true);
  await settle();
  eq(started, 1, 'the recorder was never started after the doctor confirmed consent');
  eq(world.capturing, true, 'capture did not begin after consent');
  ok(h.armed(), 'the segment was not armed for the first span of the visit');
}
{
  /* (c) a real decline still disarms */
  {
    let resolveConsent = null;
    const world = { seq: 0, clock: 0, transcript: '', capturing: false, patient: { id: '7' } };
    world.window = {
      _mlsHasEncounterConsent: () => false,
      _mlsRequestEncounterConsent: () => new Promise((r) => { resolveConsent = r; }),
      startCapture: () => { throw new Error('a declined consent must never reach the recorder'); }
    };
    const h = startSegmentHarness(world);
    eq(h.startSegment('visit'), h.CONSENT_PENDING, 'the declined path did not start as pending');
    resolveConsent(false);
    await settle();
    ok(!h.armed(), 'a declined consent left a segment armed');
  }
}
{
  /* (d) a real recorder failure still fails closed */
  {
    const world = { seq: 0, clock: 0, transcript: '', capturing: false, patient: { id: '7' } };
    world.window = { _mlsHasEncounterConsent: () => true, startCapture: () => false };
    const h = startSegmentHarness(world);
    eq(h.startSegment('visit'), null, 'a REAL recorder failure stopped failing closed');
    ok(!h.armed(), 'a real recorder failure left a segment armed');
  }

  /* ========================================================================
   * 8.  CONSENT IS NOT RE-ASKED WHEN A PLACEHOLDER RESOLVES INTO ITS OWN APPT
   * ====================================================================== */
  for (const [label, text] of [['1pScribeFlow.html', SHELL], ['1p/index.html', TWIN]]) {
    ok(/identity:_mlsConsentIdentity\(\), encounterId:_mlsConsentEncounterId\(\)/.test(text),
      label + ' no longer stamps the fence the consent reuse check needs');
    ok(/return _mlsConsentEncounterCompatible\(_mlsConsentCurrent\.encounterId,_mlsConsentEncounterId\(\)\);/.test(text),
      label + ' no longer reuses recfence compatibility for an already-confirmed consent');
  }
  {
    const src = SHELL.slice(SHELL.indexOf('function _mlsConsentEncounterCompatible(a,b){'),
      SHELL.indexOf('/* Optional "someone new joined the room" action'));
    ok(src.indexOf('function _mlsHasEncounterConsent(){') > 0, 'the consent reuse source could not be extracted');
    const make = new Function('w', `
      "use strict";
      var _mlsConsentCurrent = w.current;
      function _mlsConsentKey(){ return w.key; }
      function _mlsConsentIdentity(){ return w.identity; }
      function _mlsConsentEncounterId(){ return w.encounter; }
      ${src}
      return _mlsHasEncounterConsent;
    `);
    const given = { key: 'acct|7|visit:2026-09-01', identity: 'acct|7', encounterId: 'visit:2026-09-01' };
    /* the exact movement the owner hit: the placeholder resolves into the appointment */
    eq(make({ current: given, key: 'acct|7|appt:99', identity: 'acct|7', encounter: 'appt:99' })(), true,
      'consent is STILL re-asked mid-visit when the encounter label resolves - the reported defect');
    /* unchanged truth: the strict key still passes */
    eq(make({ current: given, key: given.key, identity: 'acct|7', encounter: 'visit:2026-09-01' })(), true,
      'a completely unchanged encounter stopped counting as consented');
    /* and everything that is genuinely a different encounter still re-asks */
    const concrete = { key: 'acct|7|appt:99', identity: 'acct|7', encounterId: 'appt:99' };
    eq(make({ current: concrete, key: 'acct|7|appt:100', identity: 'acct|7', encounter: 'appt:100' })(), false,
      'consent LEAKED between two different concrete appointments');
    eq(make({ current: given, key: 'acct|8|appt:99', identity: 'acct|8', encounter: 'appt:99' })(), false,
      'consent LEAKED to a different patient');
    eq(make({ current: null, key: 'acct|7|appt:99', identity: 'acct|7', encounter: 'appt:99' })(), false,
      'a cleared consent is being treated as consent');
  }

  /* ========================================================================
   * 9.  A CORRECTION DURING A RECORDING NO LONGER DUPLICATES THE UTTERANCE
   * ====================================================================== */
  for (const [label, text] of [['1pScribeFlow.html', SHELL], ['1p/index.html', TWIN]]) {
    ok(/let _mlsLiveResultCount=0, _mlsFoldedThroughIndex=-1;/.test(text),
      label + ' no longer tracks what a live correction already folded in');
    ok(/if\(i<=_mlsFoldedThroughIndex\) continue;/.test(text),
      label + ' appends result indices a correction already folded into finalText');
    ok(/try\{ _mlsFoldedThroughIndex=_mlsLiveResultCount-1; \}catch\(_fold\)\{\}/.test(text),
      label + ' does not mark the folded indices when the doctor corrects mid-recording');
  }
  {
    const from = SHELL.indexOf("    if(e.results.length<_mlsLiveResultCount){ _mlsLiveResultCount=0; _mlsFoldedThroughIndex=-1; }");
    const to = SHELL.indexOf("    document.getElementById('transcript').value=(finalText+interim).trim();", from);
    ok(from > 0 && to > from, 'the onresult accumulation loop could not be extracted');
    const LOOP = SHELL.slice(from, to) + "    document.getElementById('transcript').value=(finalText+interim).trim();";
    const step = new Function('ctx', 'e', `
      "use strict";
      let finalText = ctx.finalText;
      let _mlsLiveResultCount = ctx.count;
      let _mlsFoldedThroughIndex = ctx.folded;
      var document = ctx.document;
      ${LOOP}
      return { finalText: finalText, count: _mlsLiveResultCount, folded: _mlsFoldedThroughIndex };
    `);
    const ta = { value: '' };
    const doc = { getElementById: () => ta };
    const R = (t, fin) => ({ isFinal: fin, 0: { transcript: t } });

    let ctx = { finalText: '', count: 0, folded: -1, document: doc };
    /* utterance one arrives as interim */
    ctx = Object.assign(ctx, step(ctx, { resultIndex: 0, results: [R('patient reports knee pain', false)] }));
    eq(ta.value, 'patient reports knee pain', 'the interim did not reach the transcript');
    /* the doctor corrects it while it is still in flight - the input handler folds
       the whole value into finalText and marks what it folded */
    ta.value = 'patient reports LEFT knee pain';
    ctx.finalText = ta.value + ' ';
    ctx.folded = ctx.count - 1;
    /* the recognizer finalises that SAME utterance */
    ctx = Object.assign(ctx, step(ctx, { resultIndex: 0, results: [R('patient reports knee pain', true)] }));
    eq(ta.value, 'patient reports LEFT knee pain',
      'THE CORRECTION WAS DUPLICATED when the recognizer finalised the utterance it was correcting');
    /* and the NEXT utterance still lands normally */
    ctx = Object.assign(ctx, step(ctx, { resultIndex: 1, results: [R('patient reports knee pain', true), R(' worse on stairs', true)] }));
    eq(ta.value, 'patient reports LEFT knee pain  worse on stairs',
      'a later utterance stopped being appended after a correction');
    /* a recognizer restart renumbers from 0 and must clear the boundary */
    ctx = Object.assign(ctx, step(ctx, { resultIndex: 0, results: [R('and the right hip', true)] }));
    ok(/and the right hip/.test(ta.value), 'a restarted recognizer was silenced by a stale folded boundary');
  }

  console.log('PASS review-workspace: ' + checks + ' checks - the guided flow cannot be hidden by the workspace toggle ' +
    '(proved by replaying the owner exact press against a DOM that hides #ez3Wrap, and by the invariant refusing to ' +
    'fight a legitimately closed visit view); the toggle is a true toggle with both labels naming the review workspace ' +
    'BELOW the flow; #mlsRevWork is built inside #noteCard under the "Review the note" banner and ADOPTS the app own ' +
    '#noteBox and its whole last-step row instead of mirroring them, with revert putting every borrowed node back; ' +
    'Generate walks the SAME ez3flGen -> ez3Gen -> genBtn ladder ' +
    'generateTopNote walks and Send presses #pushAllEmrBtn and nothing else, with the write path closed action set ' +
    'byte-unchanged; both paste entries route through one revealer that finds a transcript the doctor can see; a ' +
    'pending consent arms the span, returns a truthy sentinel, starts the recorder when the doctor confirms and never ' +
    'paints "the recorder could not start", while a decline and a real failure still fail closed; consent survives a ' +
    'placeholder resolving into its own appointment but never crosses two concrete appointments or two patients; and a ' +
    'correction typed mid-recording is no longer duplicated when the recognizer finalises that utterance');
}
})().catch((err) => { console.error(err); process.exit(1); });
