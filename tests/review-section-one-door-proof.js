'use strict';
/* ============================================================================
 * tests/review-section-one-door-proof.js      reviewfix-1.0.0
 * ---------------------------------------------------------------------------
 * OWNER, 2026-09-02, with a screenshot of the step banner "2  Review the note -
 * Edit anything, then sign, save to history, or send to Athena.":
 *
 *   "fix the review the notes section. It's very bad in terms of many of the
 *    buttons do not work. I need all the buttons to work and all the duplicate
 *    items to be gone and everything."
 *
 * He had already measured what "duplicate" meant, earlier the same day: the
 * SAME generated note was painted TWICE inside that one card - the review
 * workspace (its own textarea, its own "Formatted view (live)", Save to
 * history / Send to Athena / Codes & billing) AND, directly beneath it, the
 * shell's "Clinical note - Draft - AI-generated, review before signing" card
 * with a SECOND formatted view, a second Edit, Undo / Redo / Versions /
 * Original vs edited / Final preview, Dictate / +Assessment / +Plan / Replace
 * text / Delete, Copy section, Clinical tools, Review & Sign, Save to history,
 * Copy note text, Review Athena actions and More tools. And "Next: Review &
 * send to Athena" appeared twice, with the top copy only scrolling.
 *
 * WHAT THIS SUITE PROVES, against the shipped bytes and nothing else:
 *
 *   1. ONE NOTE SURFACE. #noteBox is the only editable note in the review
 *      section, it lives inside the review workspace, and no second textarea
 *      claims to be the note. The mirror (#mlsRevNote) is gone, so there is no
 *      second copy of the note's STATE either.
 *   2. AT MOST ONE CONTROL PER VERB. Sign, Save to history, Copy the note
 *      text, open the Athena review, More tools, Clinical tools, the codes
 *      step and the Next door each resolve to exactly one control in the
 *      section. The retired proxies must not come back.
 *   3. EVERY LISTED CONTROL HAS A HANDLER THAT PERFORMS ITS ACTION. Every
 *      onclick inside #noteCard names a function the shell actually defines
 *      (the static half), and every control the review workspace holds is
 *      PRESSED in a DOM stub and asserted on its observable effect - the
 *      Athena sheet opens, a history record is written, the clipboard shim
 *      receives the note text, the codes card is revealed, a disclosure
 *      opens.
 *   4. ZERO DEAD CONTROLS and ZERO SCROLL-ONLY CONTROLS. A press whose only
 *      consequence was a scrollIntoView is the owner's "button that does
 *      nothing", and it fails here.
 *   5. A NEGATIVE CONTROL. The same checkers are run against the PRE-FIX
 *      shape - a second note textarea plus the Save/Send proxies alongside the
 *      shell's own row - and must go RED. A checker that cannot fail proves
 *      nothing.
 *
 * The painters are LIFTED, never re-implemented: the review workspace comes
 * from the revwork block sliced out of 1p-mls-connect.js and run in a vm, and
 * the #noteCard controls come from the real markup sliced out of the shell.
 * ASCII-only, no network, no timers left running.
 * ==========================================================================*/
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

const CONNECT = read('1p-mls-connect.js');
const SHELLS = [['1pScribeFlow.html', read('1pScribeFlow.html')], ['1p/index.html', read('1p/index.html')]];
const NOTE_EDITOR = read('feat_mls_note_editor.js');

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) {
  checks++;
  const shown = (a !== null && typeof a === 'object') ? '[object]' : JSON.stringify(a);
  assert.strictEqual(a, b, msg + ' (got ' + shown + ')');
}

/* ==========================================================================
 * 0.  SLICE THE SHIPPED PAINTERS
 * ======================================================================== */
const RW_BEGIN = '/* ===== revwork-1.2.0 begin ============================================== */';
const RW_END = '/* ===== revwork-1.2.0 end ================================================ */';
ok(CONNECT.indexOf(RW_BEGIN) > 0, 'the revwork block is missing from 1p-mls-connect.js');
eq(CONNECT.split(RW_BEGIN).length - 1, 1, 'the revwork block is duplicated');
const RW_BLOCK = CONNECT.slice(CONNECT.indexOf(RW_BEGIN) + RW_BEGIN.length, CONNECT.indexOf(RW_END));
ok(RW_BLOCK.length > 20000, 'the revwork block could not be sliced');

/* the "Review the note" section, in the bytes that ship it */
function sliceNoteCard(html, name) {
  const a = html.indexOf('<div class="card" id="noteCard">');
  const b = html.indexOf('<div class="card" id="emrCard"');
  ok(a > 0, name + ': #noteCard is gone');
  ok(b > a, name + ': #noteCard no longer closes before #emrCard');
  return html.slice(a, b);
}

/* Every <button> in that markup, with its id, its visible label and the
   handler its onclick names. This is the INVENTORY - it is read out of the
   shipped bytes so a control added tomorrow is inventoried tomorrow. */
function controlsOf(card) {
  const out = [];
  const re = /<button\b([^>]*)>([\s\S]{0,400}?)<\/button>/gi;
  let m;
  while ((m = re.exec(card))) {
    const attrs = m[1];
    const id = (attrs.match(/\sid="([^"]+)"/) || [])[1] || '';
    const onclick = (attrs.match(/\sonclick="([^"]*)"/) || [])[1] || '';
    const label = m[2].replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    out.push({
      id: id,
      label: label,
      onclick: onclick,
      handler: (onclick.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/) || [])[1] || '',
      disabled: /\sdisabled(\s|=|>)/.test(attrs),
      hidden: /\shidden(\s|=|>)/.test(attrs) || /display\s*:\s*none/.test(attrs)
    });
  }
  return out;
}
function definedInShell(html, name) {
  if (!name) return false;
  return new RegExp('function\\s+' + name + '\\s*\\(').test(html)
    || new RegExp('window\\.' + name + '\\s*=(?!=)').test(html)
    || new RegExp('(^|[^.\\w])' + name + '\\s*=\\s*function').test(html)
    || new RegExp('(^|[^.\\w])' + name + '\\s*=\\s*\\(?[\\w\\s,]*\\)?\\s*=>').test(html);
}

/* ==========================================================================
 * 1.  ZERO DEAD CONTROLS  (static, in every shipped shell)
 * -------------------------------------------------------------------------
 * A dead control is one whose onclick names a function the shell does not
 * define. The five "unavailable" placards in the legal card and the held
 * #imeBtn carry NO onclick at all and say so in their own label - they are
 * declared unavailable, not silently broken - so they are the one allowed
 * shape and are pinned as such rather than ignored.
 * ======================================================================== */
const DECLARED_UNAVAILABLE = ['legalSignUnavailableBtn', 'legalReturnBtn', 'legalInvoiceBtn',
  'legalAskBtn', 'legalMsgBtn', 'imeBtn'];
for (const [name, html] of SHELLS) {
  const card = sliceNoteCard(html, name);
  const controls = controlsOf(card);
  ok(controls.length > 60, name + ': the #noteCard inventory came back empty - the slicer broke, not the card');
  for (const c of controls) {
    if (c.onclick) {
      ok(definedInShell(html, c.handler),
        name + ': the control "' + (c.label || c.id) + '" calls ' + c.handler + '(), which the shell never defines');
      continue;
    }
    /* no onclick at all: it must be one of the declared-unavailable placards,
       and it must SAY so - a silent control with no handler is a dead button */
    ok(DECLARED_UNAVAILABLE.indexOf(c.id) >= 0,
      name + ': the control "' + (c.label || c.id) + '" has no handler and is not a declared-unavailable placard');
    ok(/unavailable/i.test(c.label), name + ': ' + c.id + ' has no handler and does not say it is unavailable');
    ok(c.disabled, name + ': ' + c.id + ' has no handler and is still pressable');
  }
}

/* ==========================================================================
 * 2.  AT MOST ONE CONTROL PER VERB  (static, in every shipped shell)
 * ======================================================================== */
const VERBS = [
  { verb: 'sign the note in MLS', re: /^\W*Review & Sign$/i },
  { verb: 'save the note to history', re: /^\W*Save to history$/i },
  { verb: 'copy the note text', re: /^\W*Copy note text$/i },
  { verb: 'open the Athena review', re: /^Review Athena actions$/i },
  { verb: 'more tools', re: /^\W*More tools/i },
  { verb: 'clinical tools', re: /^\W*Clinical tools/i }
];
for (const [name, html] of SHELLS) {
  const controls = controlsOf(sliceNoteCard(html, name));
  for (const v of VERBS) {
    const hits = controls.filter((c) => v.re.test(c.label));
    eq(hits.length, 1, name + ': the verb "' + v.verb + '" has ' + hits.length + ' controls in the review section');
  }
  /* one note, one comment box - and the note is not duplicated in the markup */
  const notes = (sliceNoteCard(html, name).match(/<textarea[^>]*\sid="noteBox"/g) || []).length;
  eq(notes, 1, name + ': #noteBox is declared ' + notes + ' times in the review section');
}

/* ==========================================================================
 * 3.  ONE NEXT DOOR  (static)
 * ======================================================================== */
eq((CONNECT.match(/id="ez3flReview"/g) || []).length, 1,
  '"Next: Review & send to Athena" is created more than once in the lane');
eq((CONNECT.match(/Next: Review &amp; send to Athena/g) || []).length, 1,
  'the Next label is written more than once');
ok(/dedupeNextDoor/.test(RW_BLOCK), 'nothing removes a stale second copy of the Next door');
ok(/setLaneHidden\(noteWrap, _reviewStepOpen \|\| !noteText\.trim\(\)\)/.test(CONNECT),
  'the lane no longer hides its Next door once the review step it opens is open');

/* ==========================================================================
 * 4.  THE ADOPTION CONTRACT  (static)
 * -------------------------------------------------------------------------
 * Nothing may be deleted. Every capability the owner listed must be NAMED in
 * the adoption list or still reachable from the one surface.
 * ======================================================================== */
for (const id of ['noteBox', 'mlsNeBar', 'secCopyRow', 'noteActionGate', 'visitToolsToggleRow']) {
  ok(new RegExp("id: '" + id + "'").test(RW_BLOCK), 'the review workspace no longer adopts #' + id);
}
ok(/via: 'signBtn'/.test(RW_BLOCK), 'the last-step action row has no fallback resolver');
ok(/releaseAdopted/.test(RW_BLOCK), 'nothing puts the adopted controls back on revert');
/* the editor bar really is built inside #noteCard, so adopting it moves the
   Undo / Redo / Versions / compare / preview / dictate / section tools */
ok(/BAR_ID = "mlsNeBar"/.test(NOTE_EDITOR), 'the note editor bar id moved - re-aim the adoption entry');
ok(/\$\("noteCard"\)/.test(NOTE_EDITOR), 'the note editor bar is no longer built inside #noteCard');
for (const label of ['Undo', 'Redo', 'Versions', 'Original vs edited', 'Final preview',
  'Dictate', 'Replace text', 'Delete last sentence']) {
  ok(NOTE_EDITOR.indexOf(label) > 0, 'the relocated editor lost its "' + label + '" tool');
}
/* the module may not mint a note, a save or a send of its own any more */
for (const dead of ['mlsRevNote', 'mlsRevSave', 'mlsRevSend']) {
  ok(RW_BLOCK.indexOf("'" + dead + "'") < 0, 'the retired proxy ' + dead + ' is back in the review workspace');
}

/* ==========================================================================
 * 5.  THE DOM STUB
 * ======================================================================== */
function makeStyle() {
  const s = { display: '', visibility: '', cssText: '' };
  s.getPropertyValue = (k) => String(s[k] || '');
  s.setProperty = (k, v) => { s[k] = String(v); };
  s.removeProperty = (k) => { s[k] = ''; };
  s.getPropertyPriority = () => '';
  return s;
}
function makeDom() {
  const docListeners = Object.create(null);
  const winListeners = Object.create(null);
  const dom = {};

  function tokenMatch(el, tok) {
    if (!el || !tok) return false;
    /* one level of :not(#id) / :not(.cls) - the shipped adoption selector uses it */
    const neg = tok.match(/^(.*):not\(([^)]+)\)$/);
    if (neg) return tokenMatch(el, neg[1]) && !tokenMatch(el, neg[2]);
    if (tok[0] === '#') return el.id === tok.slice(1);
    if (tok[0] === '.') return String(el.className || '').split(/\s+/).indexOf(tok.slice(1)) >= 0;
    if (tok[0] === '[') {
      const kv = tok.slice(1, -1).split('=');
      if (kv.length === 1) return kv[0] in el.attrs;
      return String(el.attrs[kv[0]]) === kv[1].replace(/^["']|["']$/g, '');
    }
    return String(el.tagName || '').toLowerCase() === tok.toLowerCase();
  }
  function matchesGroup(el, group) {
    const parts = group.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    if (!tokenMatch(el, parts[parts.length - 1])) return false;
    let node = el.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      let found = false;
      while (node) { if (tokenMatch(node, parts[i])) { found = true; node = node.parentNode; break; } node = node.parentNode; }
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
      clickCount: 0, scrolls: [], style: makeStyle(), isConnected: true
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
    el.contains = (n) => { let x = n; while (x) { if (x === el) return true; x = x.parentNode; } return false; };
    el.setAttribute = (k, v) => { el.attrs[k] = String(v); if (k === 'id') el.id = String(v); };
    el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
    el.hasAttribute = (k) => (k in el.attrs);
    el.removeAttribute = (k) => { delete el.attrs[k]; };
    el.addEventListener = (t, fn) => { (el._events[t] = el._events[t] || []).push(fn); };
    el.removeEventListener = (t, fn) => { const a = el._events[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
    el.dispatchEvent = (ev) => { ev.target = ev.target || el; (el._events[ev.type] || []).slice().forEach((fn) => fn(ev)); return true; };
    el.click = () => { el.clickCount++; fireClick(el); };
    el.focus = () => { dom.document.activeElement = el; };
    el.scrollIntoView = (opts) => { el.scrolls.push(opts || {}); dom.scrollCount++; };
    el.getBoundingClientRect = () => el._rect;
    el.closest = (sel) => { let n = el; while (n) { if (matchesSel(n, sel)) return n; n = n.parentNode; } return null; };
    el.querySelector = (sel) => { let hit = null; walk(el, (n) => { if (!hit && n !== el && matchesSel(n, sel)) hit = n; }); return hit; };
    el.querySelectorAll = (sel) => { const out = []; walk(el, (n) => { if (n !== el && matchesSel(n, sel)) out.push(n); }); return out; };
    return el;
  }
  function fireClick(target) {
    const ev = { type: 'click', target, bubbles: true, isTrusted: false, detail: 1 };
    (docListeners.click || []).slice().forEach((fn) => fn(ev));
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
    querySelectorAll: (sel) => {
      const out = [];
      [head, body].forEach((r) => walk(r, (n) => { if (n !== r && matchesSel(n, sel)) out.push(n); }));
      return out;
    },
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { const a = docListeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  };
  dom.scrollCount = 0;
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

/* The app's own handlers, in the SHAPE the shell gives them, reduced to the
   one observable each: a record written, text on a clipboard, a sheet opened,
   a signature line painted, a disclosure flipped. Nothing here re-implements a
   guard - this suite measures whether a press ARRIVES and CHANGES something. */
function boot() {
  const dom = makeDom();
  const clock = makeClock();
  const sandbox = {
    document: dom.document,
    innerHeight: 800,
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    Event: function (type, o) { this.type = type; this.bubbles = !!(o && o.bubbles); },
    setTimeout: clock.setTimeout, setInterval: clock.setInterval,
    clearTimeout: clock.clear, clearInterval: clock.clear,
    Promise: Promise, String: String, Number: Number, Math: Math, Date: Date, Array: Array,
    Object: Object, JSON: JSON,
    toasts: [], clipboard: [], history: [], sheets: 0
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
  vm.runInContext(RW_BLOCK, sandbox, { filename: 'revwork-reviewfix.js' });
  return { dom, clock, sandbox, doc: dom.document, El: dom.El, api: sandbox.__mlsRevWork };
}

/* Build #noteCard from the SHIPPED markup: every button in the real card, with
   its real id, its real label and its real onclick, plus the real #noteBox. */
const CARD_MARKUP = sliceNoteCard(SHELLS[0][1], SHELLS[0][0]);
const CARD_CONTROLS = controlsOf(CARD_MARKUP);
function paintVisit(h, opts) {
  opts = opts || {};
  const d = h.doc;
  const mk = (tag, id, parent) => { const e = h.El(tag); e.id = id; (parent || d.body).appendChild(e); return e; };
  const visitView = mk('div', 'visitView');
  const ez3 = mk('div', 'mlsEz3', visitView);
  const ez3Body = mk('div', 'mlsEz3Body', ez3);
  const wrap = mk('div', 'ez3Wrap', ez3Body);
  const adv = mk('button', 'ez3Adv', wrap);
  adv.addEventListener('click', function () { d.body.classList.toggle('ez3adv'); });
  const lane = h.El('div'); lane.className = 'ez3fl-record'; wrap.appendChild(lane);
  const noteWrap = mk('div', 'ez3flNoteWrap', lane);
  const nextRow = h.El('div'); nextRow.className = 'ez3fl-nextrow'; noteWrap.appendChild(nextRow);
  const nextDoor = h.El('button'); nextDoor.id = 'ez3flReview'; nextDoor.className = 'ez3fl-review';
  nextDoor.textContent = 'Next: Review & send to Athena'; nextRow.appendChild(nextDoor);
  const ez3Note = mk('textarea', 'ez3Note', wrap);
  const tx = mk('textarea', 'transcript', visitView);
  const genBtn = mk('button', 'genBtn', visitView);

  const noteCard = mk('div', 'noteCard', visitView);
  const step2 = mk('div', 'mlsAtStep2', noteCard);
  const disclaim = h.El('div'); disclaim.className = 'disclaim';
  disclaim.textContent = 'AI-generated - review before signing.'; noteCard.appendChild(disclaim);
  const genError = mk('div', 'noteGenError', noteCard);
  const noteEmpty = mk('div', 'noteEmpty', noteCard);
  const noteBox = mk('textarea', 'noteBox', noteCard);
  const neBar = mk('div', 'mlsNeBar', noteCard);
  const secCopy = mk('div', 'secCopyRow', noteCard);
  const actions = h.El('div'); actions.className = 'note-actions'; noteCard.appendChild(actions);
  const gate = mk('div', 'noteActionGate', noteCard);
  const clinToggle = mk('div', 'visitToolsToggleRow', noteCard);
  const clinGroup = mk('div', 'visitToolsGroup', noteCard);
  const moreTools = h.El('div'); moreTools.id = 'moreTools'; moreTools.className = 'note-actions';
  noteCard.appendChild(moreTools);
  const emrCard = mk('div', 'emrCard', visitView);
  const emrTable = mk('table', 'emrTable', emrCard);
  const signLine = mk('div', 'signLine', noteCard);

  /* the shipped controls, in the row the shell puts them in */
  const wanted = { signBtn: actions, saveNoteBtn: actions, copyEmrBtn: actions, pushAllEmrBtn: actions,
    moreToolsBtn: actions, visitToolsBtn: clinToggle };
  const built = {};
  CARD_CONTROLS.forEach((c) => {
    if (!c.id || !wanted[c.id]) return;
    const b = h.El('button');
    b.id = c.id; b.textContent = c.label; b.disabled = !!c.disabled;
    b.setAttribute('data-onclick', c.onclick);
    wanted[c.id].appendChild(b);
    built[c.id] = b;
  });
  /* the four Copy section controls, from the same markup */
  CARD_CONTROLS.filter((c) => /^copySection\(/.test(c.onclick)).forEach((c) => {
    const b = h.El('button'); b.textContent = c.label; b.setAttribute('data-onclick', c.onclick);
    secCopy.appendChild(b); built['copySection:' + c.label] = b;
  });

  /* the shell's real behaviour, reduced to its one observable */
  const S = h.sandbox;
  const noteText = () => String(noteBox.value || '');
  built.signBtn.addEventListener('click', function () {
    if (!noteText().trim()) { S.toast('Generate a note first.', 'err'); return; }
    signLine.textContent = 'Electronically signed by Dr Tester. AI-generated - reviewed before signing.';
    S.history.push({ note: noteText(), signed: true });
  });
  built.saveNoteBtn.addEventListener('click', function () {
    if (!noteText().trim()) { S.toast('Generate a note first.', 'err'); return; }
    S.history.push({ note: noteText(), signed: false });
  });
  built.copyEmrBtn.addEventListener('click', function () {
    if (!noteText().trim()) { S.toast('Generate a note first.', 'err'); return; }
    S.clipboard.push(noteText());
  });
  built.pushAllEmrBtn.addEventListener('click', function () {
    if (!noteText().trim()) { S.toast('Nothing to review yet.', 'err'); return; }
    const sheet = h.El('div'); sheet.id = 'mlsAthenaUnified'; d.body.appendChild(sheet);
    S.sheets++;
  });
  built.moreToolsBtn.addEventListener('click', function () {
    const open = moreTools.style.getPropertyValue('display') !== 'flex';
    moreTools.style.setProperty('display', open ? 'flex' : 'none');
  });
  built.visitToolsBtn.addEventListener('click', function () {
    const open = clinGroup.style.getPropertyValue('display') !== 'block';
    clinGroup.style.setProperty('display', open ? 'block' : 'none');
  });
  Object.keys(built).forEach((k) => {
    if (k.indexOf('copySection:') !== 0) return;
    built[k].addEventListener('click', function () { S.clipboard.push(built[k].textContent + ' section'); });
  });
  /* the codes card ships folded by an inline hide, exactly as the visit-focus
     fold leaves it; revealing it is the codes entry's whole job */
  emrCard.style.setProperty('display', 'none');

  if (opts.note) noteBox.value = opts.note;
  if (opts.transcript) tx.value = opts.transcript;
  return { visitView, ez3Body, wrap, adv, lane, noteWrap, nextRow, nextDoor, ez3Note, tx, genBtn,
    noteCard, step2, disclaim, genError, noteEmpty, noteBox, neBar, secCopy, actions, gate,
    clinToggle, clinGroup, moreTools, emrCard, emrTable, signLine, built };
}

/* ==========================================================================
 * 6.  THE CHECKERS  (used on the shipped shape AND on the pre-fix shape)
 * ======================================================================== */
/* Every textarea in the review section that presents itself as THE note. */
function noteSurfaces(h, s) {
  const out = [];
  s.noteCard.querySelectorAll('textarea').forEach((t) => {
    const label = String(t.getAttribute('aria-label') || '') + ' ' + String(t.placeholder || '') + ' ' + t.id;
    if (/note/i.test(label) && !/comment|handout|fhir|legal|procedure|urInput/i.test(t.id)) out.push(t);
  });
  return out;
}
/* Every control in the review section, keyed by the verb its label states. */
const PANEL_VERBS = [
  { verb: 'sign', re: /review & sign/i },
  { verb: 'save', re: /save to history/i },
  { verb: 'copy-note', re: /copy note text/i },
  { verb: 'athena', re: /review athena actions|send to athena/i },
  { verb: 'more-tools', re: /more tools/i },
  { verb: 'clinical-tools', re: /clinical tools/i },
  { verb: 'codes', re: /codes & billing/i }
];
function verbCensus(h, s) {
  const census = Object.create(null);
  PANEL_VERBS.forEach((v) => { census[v.verb] = []; });
  s.noteCard.querySelectorAll('button').forEach((b) => {
    const text = String(b.textContent || '');
    PANEL_VERBS.forEach((v) => { if (v.re.test(text)) census[v.verb].push(b); });
  });
  return census;
}
/* A press is REAL when it changes something other than the scroll position. */
function effectsOf(h, s, press) {
  const S = h.sandbox;
  const before = {
    clipboard: S.clipboard.length, history: S.history.length, sheets: S.sheets,
    toasts: S.toasts.length, scrolls: h.dom.scrollCount,
    emr: s.emrCard.style.getPropertyValue('display'),
    more: s.moreTools.style.getPropertyValue('display'),
    clin: s.clinGroup.style.getPropertyValue('display'),
    sign: String(s.signLine.textContent || ''),
    cls: String(h.doc.body.className)
  };
  press();
  const after = {
    clipboard: S.clipboard.length, history: S.history.length, sheets: S.sheets,
    toasts: S.toasts.length, scrolls: h.dom.scrollCount,
    emr: s.emrCard.style.getPropertyValue('display'),
    more: s.moreTools.style.getPropertyValue('display'),
    clin: s.clinGroup.style.getPropertyValue('display'),
    sign: String(s.signLine.textContent || ''),
    cls: String(h.doc.body.className)
  };
  const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
  return { changed: changed, real: changed.filter((k) => k !== 'scrolls'), before: before, after: after };
}

/* ==========================================================================
 * 7.  THE SHIPPED SHAPE - one surface, one control per verb, every press acts
 * ======================================================================== */
{
  const h = boot();
  h.sandbox.__dom = h.dom;
  const s = paintVisit(h, { note: 'SUBJECTIVE: knee pain.\nASSESSMENT: OA.\nPLAN: PT.', transcript: 'doctor and patient talking' });
  h.dom.scrollCount = 0;
  h.clock.advance(1200);

  /* --- one surface ---------------------------------------------------- */
  const root = h.doc.getElementById('mlsRevWork');
  ok(root, 'the review workspace was not built');
  eq(root.parentNode && root.parentNode.id, 'noteCard', 'the review workspace is not inside the review section');
  const slot = h.doc.getElementById('mlsRevSlot');
  ok(slot, 'the review workspace has no slot for the one note');
  const surfaces = noteSurfaces(h, s);
  eq(surfaces.length, 1, 'the review section paints ' + surfaces.length + ' note surfaces');
  eq(surfaces[0].id, 'noteBox', 'the surviving note surface is not the app own #noteBox');
  eq(surfaces[0].parentNode, slot, 'the one note is not inside the review workspace');
  eq(h.doc.getElementById('mlsRevNote'), null, 'the retired mirror textarea is back');

  /* --- the tools moved, they were not deleted -------------------------- */
  eq(s.neBar.parentNode, slot, 'the editor bar (undo / redo / versions / dictate) did not move to the one surface');
  eq(s.secCopy.parentNode, slot, 'the Copy section row did not move to the one surface');
  eq(s.actions.parentNode, slot, 'the last-step action row did not move to the one surface');
  eq(s.gate.parentNode, slot, 'the sentence that says why the actions are off did not move with them');
  eq(s.clinToggle.parentNode, slot, 'the Clinical tools disclosure is not reachable from the one surface');
  eq(s.disclaim.parentNode, slot, 'the AI-generated disclaimer no longer sits with the note it is about');
  /* and the disclosure TARGET stays below, collapsed, exactly where it was */
  eq(s.clinGroup.parentNode, s.noteCard, 'the Clinical tools group was moved instead of left behind its one disclosure');
  eq(s.moreTools.parentNode, s.noteCard, 'the More tools drawer was moved instead of left behind its one disclosure');

  /* --- at most one control per verb ------------------------------------ */
  const census = verbCensus(h, s);
  Object.keys(census).forEach((verb) => {
    ok(census[verb].length <= 1, 'the verb "' + verb + '" has ' + census[verb].length + ' controls in the review section');
  });
  for (const verb of ['sign', 'save', 'copy-note', 'athena', 'more-tools', 'clinical-tools', 'codes']) {
    eq(census[verb].length, 1, 'the verb "' + verb + '" lost its one control');
  }

  /* --- every control performs its action ------------------------------- */
  let e = effectsOf(h, s, () => census.save[0].click());
  ok(e.real.indexOf('history') >= 0, 'Save to history wrote no history record');
  eq(h.sandbox.history[h.sandbox.history.length - 1].signed, false, 'Save to history signed the note');

  e = effectsOf(h, s, () => census.athena[0].click());
  ok(e.real.indexOf('sheets') >= 0, 'Review Athena actions did not open the sheet');
  ok(h.doc.getElementById('mlsAthenaUnified'), 'the Athena review sheet is not on screen after the press');

  e = effectsOf(h, s, () => census['copy-note'][0].click());
  ok(e.real.indexOf('clipboard') >= 0, 'Copy note text put nothing on the clipboard');
  eq(h.sandbox.clipboard[h.sandbox.clipboard.length - 1], s.noteBox.value, 'Copy note text copied something other than the note');
  ok(!/Electronically signed by/.test(h.sandbox.clipboard[h.sandbox.clipboard.length - 1]),
    'a DRAFT was copied with a signature line on it');

  const sheetsBeforeSign = h.sandbox.sheets;
  e = effectsOf(h, s, () => census.sign[0].click());
  ok(e.real.indexOf('sign') >= 0, 'Review & Sign painted no signature line');
  eq(h.sandbox.sheets, sheetsBeforeSign, 'Review & Sign opened an Athena sheet - it must never touch Athena');
  eq(h.sandbox.history[h.sandbox.history.length - 1].signed, true, 'Review & Sign did not save the signed note in MLS');

  e = effectsOf(h, s, () => census['more-tools'][0].click());
  ok(e.real.indexOf('more') >= 0, 'More tools opened nothing');
  e = effectsOf(h, s, () => census['clinical-tools'][0].click());
  ok(e.real.indexOf('clin') >= 0, 'Clinical tools opened nothing');

  /* the codes entry: it must REVEAL, not merely scroll */
  e = effectsOf(h, s, () => census.codes[0].click());
  ok(e.real.length > 0, 'Codes & billing is a scroll-only control - its press changed nothing else');
  ok(e.real.indexOf('emr') >= 0 || e.real.indexOf('cls') >= 0,
    'Codes & billing neither revealed the codes card nor opened the workspace');
  eq(s.emrCard.style.getPropertyValue('display'), '', 'Codes & billing left the codes card hidden');

  /* --- zero dead, zero scroll-only, across every control in the panel --- */
  const inPanel = root.querySelectorAll('button');
  ok(inPanel.length >= 6, 'the review workspace holds ' + inPanel.length + ' controls - the panel did not assemble');
  /* A REVEAL IS IDEMPOTENT, SO THE STAGE IS RESET BEFORE EACH PRESS. Without
     this the sweep would measure the second press of a control whose first
     press already did its whole job, and read a correct no-op as a dead
     button - the exact mistake this suite exists to catch in the product. */
  function resetStage() {
    s.emrCard.style.setProperty('display', 'none');
    h.doc.body.classList.remove('ez3adv');
    s.moreTools.style.setProperty('display', '');
    s.clinGroup.style.setProperty('display', '');
    s.signLine.textContent = '';
  }
  inPanel.forEach((b) => {
    const label = String(b.textContent || b.id);
    const wired = (b._events.click && b._events.click.length > 0);
    ok(wired, 'the control "' + label + '" in the review workspace has no click handler at all');
    resetStage();
    const eff = effectsOf(h, s, () => b.click());
    ok(eff.changed.length > 0, 'the control "' + label + '" did nothing at all when pressed');
    ok(eff.real.length > 0, 'the control "' + label + '" only scrolled - that is the owner dead button');
  });
  resetStage();

  h.api.revert();
  eq(s.noteBox.parentNode, s.noteCard, 'revert did not put the one note back in the review section');
  eq(s.actions.parentNode, s.noteCard, 'revert did not put the last-step row back in the review section');
  eq(s.neBar.parentNode, s.noteCard, 'revert did not put the editor bar back in the review section');
}

/* ==========================================================================
 * 8.  ONE NEXT DOOR AT RUNTIME
 * ======================================================================== */
{
  const h = boot();
  const s = paintVisit(h, { note: 'S: knee pain. A: OA. P: PT.' });
  h.clock.advance(1200);
  eq(h.api.nextDoors().length, 1, 'the shipped lane already paints more than one Next door');

  /* a stale lane left attached by an engine repaint: a SECOND copy of the same
     id, whose listener belongs to a tree the doctor is no longer looking at */
  const stale = h.El('div'); stale.className = 'ez3fl-record';
  const staleWrap = h.El('div'); staleWrap.id = 'ez3flNoteWrap'; stale.appendChild(staleWrap);
  const staleRow = h.El('div'); staleRow.className = 'ez3fl-nextrow'; staleWrap.appendChild(staleRow);
  const staleDoor = h.El('button'); staleDoor.id = 'ez3flReview'; staleDoor.className = 'ez3fl-review';
  staleDoor.textContent = 'Next: Review & send to Athena'; staleRow.appendChild(staleDoor);
  s.visitView.appendChild(stale);
  eq(h.api.nextDoors().length, 2, 'the stub did not manage to paint the duplicate the owner measured');

  h.api.reconcile();
  eq(h.api.nextDoors().length, 1, '"Next: Review & send to Athena" is still on screen twice');
  eq(h.api.nextDoors()[0], s.nextDoor, 'the copy that survived is not the one inside the live guided lane');
  eq(staleRow.parentNode, null, 'the stale Next row was left in the document');
  ok(s.nextDoor.closest('#mlsEz3Body'), 'the surviving Next door left the guided lane');
}

/* ==========================================================================
 * 9.  THE REVIEW STEP ARRIVES WITHOUT MOVING THE PAGE
 * -------------------------------------------------------------------------
 * The owner said the top copy of the Next door "only scrolls". The cure is NOT
 * a better scroll: b940 is an explicit owner ruling that pressing this control
 * must not walk him down the page, and 1p-visit-lane-survives-contract pins
 * it. So the arrival is a STATE change, not a viewport move - and the one
 * thing this module must do at that moment is make the destination correct:
 * openReviewStep opens the workspace in the same tick, everything in the card
 * can be repainted around it, and the review-step signal is what re-claims the
 * note and the last-step row into the one panel.
 * ======================================================================== */
{
  const h = boot();
  const s = paintVisit(h, { note: 'S: knee pain.' });
  h.clock.advance(1200);
  const root = h.doc.getElementById('mlsRevWork');
  const slot = h.doc.getElementById('mlsRevSlot');
  ok(root && slot, 'the review workspace was not built');
  eq(s.noteBox.parentNode, slot, 'the one note is not in the review workspace before the step opens');

  /* something repaints the card and the note ends up back outside the panel */
  s.noteCard.appendChild(s.noteBox);
  s.noteCard.appendChild(s.actions);
  eq(s.noteBox.parentNode, s.noteCard, 'the stub did not manage to move the note out');

  h.dom.scrollCount = 0;
  (h.dom.winListeners['mls:review-step'] || []).forEach((fn) => fn({ type: 'mls:review-step', detail: { open: true } }));
  h.clock.advance(1200);
  eq(s.noteBox.parentNode, slot, 'opening the review step did not re-claim the one note into the one panel');
  eq(s.actions.parentNode, slot, 'opening the review step did not re-claim the last-step row');
  eq(h.dom.scrollCount, 0, 'opening the review step moved the page - b940 rules that out');
  eq(root.scrolls.length, 0, 'the review step scrolled to the review workspace');
}

/* ==========================================================================
 * 10. THE NEGATIVE CONTROL - the checkers go RED on the pre-fix shape
 * -------------------------------------------------------------------------
 * revwork-1.1.0's shape, rebuilt by hand: a SECOND note textarea mirroring
 * #noteBox, plus proxy buttons labelled "Save to history" and "Send to Athena"
 * standing beside the shell's own row. Every checker above must catch it, or
 * this suite proves nothing.
 * ======================================================================== */
{
  const h = boot();
  const s = paintVisit(h, { note: 'S: knee pain.' });
  h.clock.advance(1200);
  const slot = h.doc.getElementById('mlsRevSlot');

  /* clean shape first */
  eq(noteSurfaces(h, s).length, 1, 'the negative control started from a screen that was already wrong');

  /* now paint the pre-fix duplicates back in */
  const mirror = h.El('textarea');
  mirror.id = 'mlsRevNote';
  mirror.setAttribute('aria-label', 'Generated note - review and edit');
  slot.appendChild(mirror);
  const dupSave = h.El('button'); dupSave.id = 'mlsRevSave'; dupSave.textContent = 'Save to history'; slot.appendChild(dupSave);
  const dupSend = h.El('button'); dupSend.id = 'mlsRevSend'; dupSend.textContent = 'Send to Athena'; slot.appendChild(dupSend);
  const deadJump = h.El('button'); deadJump.id = 'mlsRevDeadJump'; deadJump.textContent = 'Codes & billing';
  deadJump.addEventListener('click', function () { s.emrCard.scrollIntoView({ block: 'nearest' }); });
  slot.appendChild(deadJump);

  eq(noteSurfaces(h, s).length, 2, 'the note-surface checker cannot see a second note - it would pass the pre-fix bytes');
  const census = verbCensus(h, s);
  eq(census.save.length, 2, 'the verb census cannot see a duplicate Save - it would pass the pre-fix bytes');
  eq(census.athena.length, 2, 'the verb census cannot see a duplicate Athena door - it would pass the pre-fix bytes');
  eq(census.codes.length, 2, 'the verb census cannot see a duplicate codes entry - it would pass the pre-fix bytes');

  /* a scroll-only control must be caught as one */
  const eff = effectsOf(h, s, () => deadJump.click());
  eq(eff.real.length, 0, 'the scroll-only checker saw a real effect where there was only a scroll');
  ok(eff.changed.indexOf('scrolls') >= 0, 'the scroll-only checker did not even see the scroll');

  /* and a control with no handler at all must be caught as dead */
  const deadBtn = h.El('button'); deadBtn.id = 'mlsRevDeadBtn'; deadBtn.textContent = 'Does nothing';
  slot.appendChild(deadBtn);
  eq(!!(deadBtn._events.click && deadBtn._events.click.length), false,
    'the dead-control checker cannot tell a wired control from an unwired one');
  const deadEff = effectsOf(h, s, () => deadBtn.click());
  eq(deadEff.changed.length, 0, 'a control with no handler appeared to do something');

  h.api.revert();
}

console.log('PASS review-section-one-door: ' + checks + ' checks - the review section is ONE place: one note surface '
  + '(#noteBox itself, adopted into the workspace, with the mirror textarea retired), at most one control per verb, '
  + 'and the editor bar, Copy section row, last-step action row, its gate sentence and the Clinical tools disclosure '
  + 'relocated into that one surface rather than deleted; every control in the panel is wired and changes something '
  + 'other than the scroll position when pressed - Save writes a history record, Review Athena actions opens the '
  + 'sheet, Copy note text puts the unsigned draft on the clipboard, Review & Sign signs in MLS and never touches '
  + 'Athena, Codes & billing reveals the codes card; "Next: Review & send to Athena" exists once, a stale second '
  + 'copy is removed in favour of the one inside the live guided lane, and opening the review step re-claims the note '
  + 'and the last-step row into that one panel without moving the page at all (b940); and every checker here is proved '
  + 'to go red on the pre-fix shape');
