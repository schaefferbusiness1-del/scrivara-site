'use strict';
/* =========================================================================
   THE TEMPLATE RAIL IS A CONTROL, AND THE FOLLOW-MODE IS REAL AT BOTH ENDS
   -------------------------------------------------------------------------
   OWNER: "let me click on my templates on the left side taht come up to change
   them if I want and give ioptiopns on how I want the op nopte to follow those
   tempaltes".

   WHAT WAS WRONG. The rail was a DEAD AFFORDANCE. buildTplRail emitted each
   template as a plain `<div class="opr-tpl-item">` — no id, no data attribute,
   no tabindex, no cursor:pointer — and the function ended at `rail.innerHTML`
   without binding anything, while its sibling buildNav bound `nav.onclick` two
   functions below. No document-level delegation in the app could reach a bare
   div either (every one is gated on a selector it cannot satisfy). So the list
   of his own templates read like something to press and did nothing.

   THE TRAP THIS SUITE EXISTS TO CATCH. A "how closely should the note follow
   the template" option is the kind of feature that is very easy to fake: store
   a preference, render a tick, change nothing about the output. Worse, in this
   codebase a prompt-only version would have been actively harmful — the
   deterministic fidelity() gate hard-fails a draft whose heading set/order or
   fixed template wording changed, so a looser instruction WITHOUT a matching
   gate relaxation would have silently killed every draft in that mode. So this
   suite refuses to accept the mode as shipped unless it is present at BOTH
   ends: the prompt clause AND the gate.

   HOW IT CHECKS. Part 1 EXECUTES the shipped rail builder and click handler in
   a counting stub DOM — a rendered-string check would pass on a rail that still
   binds nothing. Part 2 pins the generator seam structurally, because the
   generator cannot be run without a backend.

   NON-VACUITY is proved by breaking each half and watching the matching
   assertion fail (recorded in the commit).
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}

/* ======================= PART 1 — execute the rail ====================== */

/* A stub DOM just rich enough for the room module's rail code: getElementById,
   createElement, closest(), classList, and a real select whose change event we
   can observe. Everything it does is counted. */
function makeDom() {
  const nodes = new Map();
  const events = [];
  function mk(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '', _html: '', children: [], parentNode: null, style: {}, _attrs: {},
      _listeners: {},
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); },
        toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) this._s.add(c); else this._s.delete(c); }
      },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
      appendChild(c) { c.parentNode = this; this.children.push(c); if (c.id) nodes.set(c.id, c); return c; },
      insertBefore(c, ref) { c.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); if (c.id) nodes.set(c.id, c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      closest() { return null; },
      scrollIntoView() {},
      dispatchEvent(e) { events.push({ id: this.id, type: e && e.type }); const h = this._listeners[e && e.type]; if (h) h.forEach(f => f(e)); return true; },
      addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
      removeEventListener() {},
      focus() {}
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._html; },
      set(v) { el._html = String(v); }
    });
    return el;
  }
  const doc = {
    _nodes: nodes, _events: events,
    createElement: mk,
    getElementById(id) { return nodes.get(id) || null; },
    addEventListener() {}, removeEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
    visibilityState: 'visible',
    body: mk('body'), head: mk('head'), documentElement: mk('html'),
    getAnimations() { return []; }
  };
  ['oprDayRail', 'oprTplRail', 'oprRowNav', 'oprEditor', 'opPrepList',
   'opPrepModal', 'oprTabProcs', 'oprTabTpls', 'oprPanelProcs', 'oprPanelTpls',
   'oprReceipt', 'opPrepStatus'].forEach(id => { const n = mk('div'); n.id = id; nodes.set(id, n); });
  nodes.get('oprTplRail').parentNode = nodes.get('oprDayRail');
  nodes.get('oprDayRail').children.push(nodes.get('oprTplRail'));
  return doc;
}

const ROOM_SRC = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_room.js'), 'utf8');

/* run the module with the stub as its document/window */
function runRoom(templates, rows, wantSelect) {
  const doc = makeDom();
  /* The select MUST come from this doc. An earlier version built it from a second
     makeDom(), so its dispatchEvent recorded into that document's event log and the
     'a real change event is dispatched' assertion failed while the code was correct.
     A stub that answers from the wrong object is indistinguishable from a bug. */
  let selNode = null;
  if (wantSelect) { selNode = doc.createElement('select'); selNode.id = 'opPrepTpl_0'; selNode.value = 'tpl-a'; doc._nodes.set('opPrepTpl_0', selNode); }
  const toasts = [];
  const win = {
    document: doc,
    getTemplates: () => templates,
    _opPrep: rows,
    toast: (m, k) => toasts.push({ m: String(m), k: k }),
    uns: (s) => 'sf_u::t@t::' + s,
    localStorage: (function () { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })(),
    confirm: () => true,
    requestIdleCallback: (f) => { try { f(); } catch (e) {} },
    setTimeout: (f) => { return 0; },
    clearTimeout: () => {},
    addEventListener() {}, removeEventListener() {},
    Event: function (t, o) { this.type = t; this.bubbles = !!(o && o.bubbles); }
  };
  win.window = win;
  win.self = win;
  try {
    new Function('window', 'document', 'localStorage', 'setTimeout', 'clearTimeout', 'Event', 'confirm', ROOM_SRC)(
      win, doc, win.localStorage, win.setTimeout, win.clearTimeout, win.Event, win.confirm);
  } catch (e) {
    return { err: String(e && e.message), doc, win, toasts };
  }
  /* The module only builds its rails when the room is OPEN — boot does
     `if (shown($('opPrepModal'))) safe(buildRails)`. Without this the rails are
     empty and every assertion below would fail for a reason that has nothing to
     do with the rail code. Mark the room open and drive the module's own public
     rebuild seam, which is what opPrepRender triggers in the real app. */
  doc.getElementById('opPrepModal').classList.add('show');
  const api = win.__mlsOpNoteRoom;
  if (api && typeof api.rebuild === 'function') { try { api.rebuild(); } catch (e) {} }
  return { doc, win, toasts, api: api, sel: selNode };
}

const TPLS = [
  { id: 'tpl-a', name: 'Left L4-L5 transforaminal epidural steroid injection', text: 'A'.repeat(900) },
  { id: 'tpl-b', name: 'Left L5-S1 transforaminal epidural steroid injection', text: 'B'.repeat(900) },
  { id: 'tpl-c', name: 'Right knee arthroscopy', text: 'C'.repeat(900) }
];
function freshRows() {
  return [{ appt: { name: 'AA BB' }, tplId: 'tpl-a', tplManual: false, gen: false, note: '', edited: false }];
}

const r1 = runRoom(TPLS, freshRows(), null);
ok(!r1.err, 'the room module runs against a stub DOM', r1.err);
ok(!!r1.api, 'the module installed and exposed its api');

const railHtml = r1.doc.getElementById('oprTplRail').innerHTML;

ok(/<button[^>]*class="opr-tpl-item/.test(railHtml),
  'RAIL ITEMS ARE REAL BUTTONS (they were plain divs, which nothing could click)',
  'got: ' + railHtml.slice(0, 200));
ok(/data-tpl-id="tpl-a"/.test(railHtml) && /data-tpl-id="tpl-c"/.test(railHtml),
  'each item carries its template id, so a click knows WHICH template it is',
  'the old items carried no identity at all');
ok(typeof r1.doc.getElementById('oprTplRail').onclick === 'function',
  'THE RAIL HAS A CLICK HANDLER',
  'buildTplRail used to end at rail.innerHTML and bind nothing');

/* every template, not the first six */
const many = Array.from({ length: 11 }, (_, i) => ({ id: 't' + i, name: 'Template ' + i, text: 'x' }));
const rMany = runRoom(many, freshRows(), null);
const manyHtml = rMany.doc.getElementById('oprTplRail').innerHTML;
ok((manyHtml.match(/data-tpl-id=/g) || []).length === 11,
  'ALL templates are listed, not the first six with "+N more"',
  'found ' + (manyHtml.match(/data-tpl-id=/g) || []).length + ' of 11');

/* health as words, and "in use" as a word */
ok(/in use for this procedure/.test(railHtml),
  'the applied template says so IN WORDS, not by highlight alone');
ok(/aria-pressed="true"/.test(railHtml),
  'the applied template is machine-readable for a screen reader');
ok(/data-tpl-edit="tpl-b"/.test(railHtml),
  'each template offers a way to open and edit it ("change them if I want")');

/* ---- the click actually changes the row, through the real select ---- */
function clickRail(res, tplId) {
  const rail = res.doc.getElementById('oprTplRail');
  const btn = { getAttribute: (k) => (k === 'data-tpl-id' ? tplId : null) };
  const target = { closest: (sel) => (sel === '[data-tpl-edit]' ? null : (sel === '.opr-tpl-item' ? btn : null)) };
  rail.onclick({ target: target, preventDefault() {}, stopPropagation() {} });
}

const rows2 = freshRows();
const r2 = runRoom(TPLS, rows2, true);
const sel = r2.sel;
clickRail(r2, 'tpl-b');

ok(rows2[0].tplId === 'tpl-b',
  'CLICKING A TEMPLATE APPLIES IT TO THE PROCEDURE ON SCREEN',
  'row.tplId is ' + rows2[0].tplId + ' — this is the owner\'s actual request');
ok(rows2[0].tplManual === true,
  'the pick is recorded as the doctor\'s, not an auto-match');
ok(sel.value === 'tpl-b',
  'it drives the EXISTING select#opPrepTpl_<i> rather than a second write path',
  'select value is ' + sel.value);
ok(r2.doc._events.some(e => e.id === 'opPrepTpl_0' && e.type === 'change'),
  'a real change event is dispatched, so every satellite watching that select still behaves',
  'events: ' + JSON.stringify(r2.doc._events));
ok(r2.toasts.some(t => /Template set to/.test(t.m)),
  'the doctor is told what happened');

/* ---- an EDITED draft is not silently replaced ---- */
const rows3 = [{ appt: { name: 'AA BB' }, tplId: 'tpl-a', gen: true, edited: true, note: 'his words' }];
const r3 = runRoom(TPLS, rows3, true);
/* FIRST click only ARMS - confirmation is a two-step press, never a blocking
   dialog (the no-native-blocking-dialogs suite forbids confirm/alert/prompt, and
   a frozen modal over the EMR is a defect this product has already had). */
clickRail(r3, 'tpl-c');
ok(rows3[0].tplId === 'tpl-a',
  'AN EDITED DRAFT IS NOT SWITCHED ON THE FIRST CLICK',
  'a switch silently replacing what he typed is a bug this app has already shipped');
ok(/click again to switch/.test(r3.doc.getElementById('oprTplRail').innerHTML),
  'the rail SAYS a second click will switch, in place');
ok(r3.toasts.some(t => /Click that template again/.test(t.m)),
  'and he is told why nothing happened yet');
clickRail(r3, 'tpl-c');
ok(rows3[0].tplId === 'tpl-c',
  'the SECOND click switches it, so the guard is a confirmation and not a wall');
ok(rows3[0].note === 'his words', 'his text is untouched either way');

/* ---- the follow-mode control ---- */
const modeBox = r1.doc.getElementById('oprTplMode');
ok(!!modeBox, 'the follow-mode control is built into the rail');
if (modeBox) {
  const mh = modeBox.innerHTML;
  ok(/data-tplmode="strict"/.test(mh) && /data-tplmode="adapt"/.test(mh) && /data-tplmode="guide"/.test(mh),
    'three named modes are offered');
  ok(/aria-pressed="true"/.test(mh), 'the active mode is machine-readable');
  ok(/Recommended/.test(mh), 'the default is marked so a doctor is not left guessing');
  ok(/opr-nav-st/.test(mh),
    'each mode explains what it will DO, visibly — not only in a title attribute');
  ok(typeof modeBox.onclick === 'function', 'the mode control is wired');
}

/* ======= PART 2 — the mode is real at BOTH ends of the generator ======== */
const GEN = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_integrity.js'), 'utf8');

ok(/opNoteTemplateMode/.test(GEN),
  'the generator READS the stored mode (a preference nothing reads is a fake feature)');
ok(/TPL_MODE_CLAUSE/.test(GEN) && /sys\+=TPL_MODE_CLAUSE\[tplMode\]/.test(GEN),
  'THE MODE APPENDS A REAL CLAUSE TO THE LIVE SYSTEM PROMPT');
ok(/adapt:''/.test(GEN),
  'the DEFAULT mode adds no clause, so it is provably identical to prior behaviour',
  'this is what makes the change safe for someone who never opens the control');

/* the half that a prompt-only implementation would have got wrong */
ok(/tplMode==='guide'[\s\S]{0,220}fixed template wording/.test(GEN),
  'THE GATE IS RELAXED TO MATCH THE LOOSER MODE',
  'fidelity() fails on changed fixed wording, so a prompt-only looser mode would have\n' +
  '        silently killed every draft in that mode instead of loosening anything');
ok(/reworded:true/.test(GEN),
  'the relaxation is recorded on the result rather than hidden');

/* guardrails that must survive every mode */
ok(/Never invent a fact/.test(GEN),
  'GUARDRAIL: "never invent a fact" is still in the live prompt');
ok(!/TPL_MODE_CLAUSE[\s\S]{0,900}invent a fact/i.test(GEN.replace(/never invent a fact/gi, 'X')) ||
   /never invent a fact/i.test(GEN.match(/guide:'[^']*'/) ? GEN.match(/guide:'[^']*'/)[0] : ''),
  'GUARDRAIL: the looser clause restates the anti-fabrication rule rather than weakening it');
const guideClause = (GEN.match(/guide:'([^']*)'/) || [])[1] || '';
ok(/KEEP every heading/.test(guideClause),
  'the looser mode still promises to keep headings — which is what the un-relaxed\n        heading check then enforces',
  'guide clause: ' + guideClause.slice(0, 140));
ok(/never invent a fact/i.test(guideClause) && /never state a value that was not dictated or documented/i.test(guideClause),
  'the looser clause repeats the factual constraints explicitly');

console.log(failures === 0
  ? '\nPASS  opnote-template-rail-is-clickable: the rail is a control, an edited draft is protected, and the follow-mode is real in the prompt AND the gate.'
  : '\nFAIL  opnote-template-rail-is-clickable: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
