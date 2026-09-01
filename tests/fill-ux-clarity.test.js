'use strict';

/* =========================================================================
   THE TEMPLATE-FILL PANE: LESS CONFUSING, WITHOUT LOSING ANYTHING
   -------------------------------------------------------------------------
   OWNER (2026-08-31): "just make the tremplates filling better and more easy
   and less confusing ui".

   A clarity pass is the easiest kind of change to fake. Renaming a button and
   deleting a paragraph LOOKS like simplification and can quietly cost the
   doctor a capability, and a pane that claims "changing a field updates this
   draft instantly" can go on claiming it after the claim stops being true. So
   nothing here is asserted from source text where execution can decide it:

     PART 1  THE CONTROL LEDGER. The PRISTINE module (git HEAD) and the working
             copy each build a Fields box over the SAME draft in the SAME DOM
             double. Every control the old pane rendered must still be there -
             by id, by data hook and by name - with exactly one declared
             exception, the dictation MERGE, whose target must be proved to
             carry both merged behaviours and to answer both selectors the
             shipped twins use to find it.
     PART 2  "UPDATES THIS DRAFT INSTANTLY" - executed, both ways. A pick and a
             TYPED character each go through the product's own handlers and the
             note textarea is read back. The typed case is run against the
             pristine module too, where it must FAIL: that is what makes the
             new one a real fix rather than a restatement.
     PART 3  THE FOOTER VERDICT IS TRUE. Its number is compared against the
             REAL canonical parser, opNoteBlankTokens(), lifted out of
             1pScribeFlow.html - the same counter the save/sign/PDF/Athena gate
             uses. And saving is still NOT blocked by blanks.
     PART 4  ONE DICTATION ENTRY POINT, DRIVING THE OLD PATH. The single button
             is clicked and must reach routeDictation() -> aiCallRaw() -> the
             field -> the note.
     PART 5  THE CLARITY ITSELF: one headline sentence, the blank's own words
             under every field, one calm chip style, "Use every time" explained
             where it is pressed, the fine print gone, 390px, and the vertical
             list declared where it ships.
     PART 6  NOTHING ELSE MOVED: the pin round-trip, the recall buttons, the
             auto-filled expander, revert().
     PART 7  THE TWINS. No HTML was edited, and the fill-pane lines of
             1pScribeFlow.html and 1p/index.html are identical.
     PART 8  A REBUILD MAY NOT YANK A FIELD OUT FROM UNDER A TYPING HAND.

   NOT registered in run-all.js: this is a lane probe, run by hand.
   ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILL_PATH = path.join(ROOT, 'feat_mls_opnote_fill.js');
const NEW_SRC = fs.readFileSync(FILL_PATH, 'utf8');
const TWIN_A = path.join(ROOT, '1pScribeFlow.html');
const TWIN_B = path.join(ROOT, '1p', 'index.html');

let failures = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}
function head(t) { console.log('\n' + t); }

/* The pristine bytes this pass started from - FROZEN, not chased. Reading
   `git show HEAD:...` only worked while this suite's own commit (b1146,
   02158d65) was still uncommitted or freshly landed; once it merged, HEAD
   *is* the working copy and every "the old pane DID X (not vacuous)" check
   became unsatisfiable by construction (PRISTINE_SRC === NEW_SRC). The
   before-state is a fact about history, not about the branch tip, so it is
   captured once from the parent of the clarity-pass commit
   (`git show 02158d65^:feat_mls_opnote_fill.js`, the b944 shape: two
   dictation buttons, no instant-keystroke update) into a fixture that never
   moves again. If a FUTURE pass wants a new non-vacuity baseline, freeze a
   new fixture deliberately - never point this back at HEAD. */
const PRISTINE_FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'fill-pane-pristine-b944.js');
let PRISTINE_SRC = '';
try {
  PRISTINE_SRC = fs.readFileSync(PRISTINE_FIXTURE, 'utf8');
} catch (e) {
  PRISTINE_SRC = '';
}

/* =====================================================================
   A DOM DOUBLE GOOD ENOUGH TO RUN THE PRODUCTION RENDERER AND ITS
   HANDLERS. Shape follows tests/use-every-time-round-trip.test.js (which
   already drives buildFillBox and clicks its real buttons), extended with
   what this pass actually needs and therefore must be able to observe:
   activeElement + contains() (the rebuild defer), textarea selection and
   scroll (the field -> note reveal), and focus/blur/input dispatch.
   ===================================================================== */
const VOID_TAGS = { input: 1, br: 1, img: 1, hr: 1, meta: 1, link: 1 };

function unesc(s) {
  return String(s == null ? '' : s)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function makeDom() {
  const byId = new Map();
  const allNodes = [];

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this._attrs = Object.create(null);
      this.childNodes = [];
      this.parentNode = null;
      this._listeners = Object.create(null);
      this._text = '';
      this._html = '';
      this._id = '';
      this.style = {};
      this.value = '';
      this.className = '';
      this.disabled = false;
      this.selectionStart = 0;
      this.selectionEnd = 0;
      this.scrollTop = 0;
      this.scrollHeight = 400;
      this.clientHeight = 100;
      this._scrolledIntoView = 0;
      const self = this;
      this.classList = {
        contains(c) { return (' ' + (self.className || '') + ' ').indexOf(' ' + c + ' ') >= 0; },
        add(c) { if (c && !this.contains(c)) self.className = ((self.className || '') + ' ' + c).trim(); },
        remove(c) { self.className = (' ' + (self.className || '') + ' ').split(' ' + c + ' ').join(' ').trim(); },
        toggle(c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); }
      };
      allNodes.push(this);
    }
    get id() { return this._id; }
    set id(v) { this._id = String(v); this._attrs.id = this._id; if (this._id) byId.set(this._id, this); }
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; }
    setAttribute(n, v) {
      this._attrs[n] = String(v);
      if (n === 'id') this.id = String(v);
      if (n === 'class') this.className = String(v);
      if (n === 'value' && /^(INPUT|OPTION|TEXTAREA)$/.test(this.tagName)) this.value = String(v);
    }
    removeAttribute(n) { delete this._attrs[n]; }
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n); }
    get children() { return this.childNodes.filter(n => n instanceof El); }
    appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
    insertBefore(n, ref) {
      if (n.parentNode) n.parentNode.removeChild(n);
      const i = this.childNodes.indexOf(ref);
      n.parentNode = this;
      if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
      return n;
    }
    removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
    replaceChild(nu, old) {
      const i = this.childNodes.indexOf(old);
      if (i >= 0) { this.childNodes[i] = nu; nu.parentNode = this; old.parentNode = null; }
      return old;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(n) { let p = n; while (p) { if (p === this) return true; p = p.parentNode; } return false; }
    get previousElementSibling() {
      if (!this.parentNode) return null;
      const sib = this.parentNode.children, i = sib.indexOf(this);
      return i > 0 ? sib[i - 1] : null;
    }
    closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parentNode; } return null; }
    matches(sel) { return matches(this, sel); }
    set innerHTML(html) { this.childNodes.length = 0; this._html = String(html); parseInto(this, this._html); }
    get innerHTML() { return this._html; }
    set textContent(t) { this._text = String(t); this.childNodes.length = 0; this._html = ''; }
    get textContent() {
      if (!this.childNodes.length) return this._text;
      return this.childNodes.map(n => (n instanceof El ? n.textContent : String(n))).join('');
    }
    get options() { return this.children.filter(n => n.tagName === 'OPTION'); }
    focus() { doc.activeElement = this; this.dispatchEvent({ type: 'focus' }); }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; this.dispatchEvent({ type: 'blur' }); }
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    scrollIntoView() { this._scrolledIntoView++; }
    querySelectorAll(sel) { return descendants(this).filter(n => matches(n, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    removeEventListener(type, fn) { const a = this._listeners[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    dispatchEvent(ev) {
      const type = ev && ev.type ? ev.type : String(ev);
      (this._listeners[type] || []).slice().forEach(fn => fn.call(this, ev || { type }));
      return true;
    }
    click() { return this.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} }); }
  }

  function descendants(node) {
    const out = [];
    (function walk(n) { n.children.forEach(c => { out.push(c); walk(c); }); })(node);
    return out;
  }
  function matchOne(node, sel) {
    sel = String(sel).trim();
    if (!sel) return false;
    if (/\s/.test(sel)) {
      const parts = sel.split(/\s+/);
      if (!matchOne(node, parts[parts.length - 1])) return false;
      let n = node.parentNode;
      while (n) { if (matchOne(n, parts[0])) return true; n = n.parentNode; }
      return false;
    }
    const m = sel.match(/^([a-zA-Z][a-zA-Z0-9]*)?((?:[#.\[][^#.\[]*\]?)*)$/);
    if (!m) return false;
    if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
    const re = /#([A-Za-z0-9_:-]+)|\.([A-Za-z0-9_-]+)|\[([a-zA-Z-][a-zA-Z0-9_:.-]*)(?:([\^$*]?=)"([^"]*)")?\]/g;
    let t;
    while ((t = re.exec(m[2] || '')) !== null) {
      if (t[1]) { if (node.id !== t[1]) return false; continue; }
      if (t[2]) { if (!node.classList.contains(t[2])) return false; continue; }
      const name = t[3];
      if (!node.hasAttribute(name)) return false;
      if (t[4]) {
        const v = String(node.getAttribute(name));
        if (t[4] === '=' && v !== t[5]) return false;
        if (t[4] === '^=' && v.indexOf(t[5]) !== 0) return false;
        if (t[4] === '*=' && v.indexOf(t[5]) < 0) return false;
      }
    }
    return true;
  }
  function matches(node, sel) { return String(sel).split(',').some(s => matchOne(node, s)); }

  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const ATTR_RE = /([a-zA-Z-][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
  function parseInto(host, html) {
    const stack = [host];
    let last = 0, m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(html)) !== null) {
      const text = html.slice(last, m.index);
      if (text) {
        const top = stack[stack.length - 1];
        top.childNodes.push(unesc(text));
        if (top.tagName === 'TEXTAREA') top.value = unesc(text);
      }
      last = m.index + m[0].length;
      const closing = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3] || '', selfClose = m[4] === '/';
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const el = new El(tag);
      let a;
      ATTR_RE.lastIndex = 0;
      while ((a = ATTR_RE.exec(attrs)) !== null) {
        const name = a[1];
        if (!name) continue;
        const raw = a[2] != null ? a[2] : (a[3] != null ? a[3] : (a[4] != null ? a[4] : ''));
        el.setAttribute(name, unesc(raw));
      }
      stack[stack.length - 1].appendChild(el);
      if (!selfClose && !VOID_TAGS[tag]) stack.push(el);
    }
    const tail = html.slice(last);
    if (tail) stack[stack.length - 1].childNodes.push(unesc(tail));
    descendants(host).forEach(n => {
      if (n.tagName !== 'SELECT') return;
      const opts = n.options;
      const sel = opts.filter(o => o.hasAttribute('selected'))[0] || opts[0];
      n.value = sel ? String(sel.getAttribute('value') == null ? sel.textContent : sel.getAttribute('value')) : '';
    });
  }

  const documentElement = new El('html');
  const headEl = new El('head');
  const body = new El('body');
  documentElement.appendChild(headEl);
  documentElement.appendChild(body);
  function attached(n) { let p = n; while (p) { if (p === body || p === headEl || p === documentElement) return true; p = p.parentNode; } return false; }

  const doc = {
    readyState: 'complete',
    documentElement, head: headEl, body,
    activeElement: body,
    createElement(tag) { return new El(tag); },
    createTextNode(t) { const n = new El('#text'); n._text = String(t); return n; },
    getElementById(id) { const n = byId.get(String(id)); return n && attached(n) ? n : null; },
    querySelectorAll(sel) { return allNodes.filter(n => attached(n) && matches(n, sel)); },
    querySelector(sel) { return doc.querySelectorAll(sel)[0] || null; },
    addEventListener() {}, removeEventListener() {}
  };
  return { document: doc, El, body };
}

/* ---------------------------- the environment ------------------------- */
function makeEnv(src, opts) {
  opts = opts || {};
  const dom = makeDom();
  const store = new Map();
  const toasts = [];
  const aiCalls = [];
  const ctx = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    document: dom.document,
    localStorage: {
      getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
      setItem(k, v) { store.set(String(k), String(v)); },
      removeItem(k) { store.delete(String(k)); }
    },
    Event: function Event(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); },
    setTimeout(f) { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    getComputedStyle() { return { display: 'none' }; },
    uns(sfx) { return 'sf_u::doctor@example.test::' + sfx; },
    toast(m, k) { toasts.push({ m: String(m), k: String(k || '') }); },
    getPatients() { return []; },
    getTemplates() { return []; },
    getTemplateById() { return null; },
    getOpFieldVals() { return []; }, addOpFieldVal() {},
    activePatient() { return null; },
    getNotes() { return []; },
    opPrepSave(i) { ctx.__saved.push(i); },
    opPrepAutosaveDraft(i) { ctx.__autosaved.push(i); },
    aiCallRaw(sys, user) { aiCalls.push({ sys: String(sys), user: String(user) }); return Promise.resolve(opts.aiReply || '{"fills":[]}'); },
    getKey() { return 'k'; },
    _opPrep: []
  };
  ctx.__saved = []; ctx.__autosaved = [];
  ctx.window = ctx;
  vm.runInNewContext(src, ctx, { filename: 'feat_mls_opnote_fill.js' });
  return { ctx, dom, api: ctx.__mlsOpNoteFill, toasts, aiCalls, store };
}

function makeDraft(env, idx, note) {
  const wrap = env.dom.document.createElement('div');
  env.dom.body.appendChild(wrap);
  const ta = env.dom.document.createElement('textarea');
  ta.setAttribute('id', 'opPrepNote_' + idx);
  ta.value = note;
  wrap.appendChild(ta);
  return ta;
}
function boxOf(env, ta) {
  return env.dom.document.querySelectorAll('.onf-fillbox').filter(b => b.getAttribute('data-onf-for') === ta.id)[0] || null;
}
function row(note) {
  return { patientId: 'p1', tplId: '', proc: 'Left L4-L5 transforaminal ESI', appt: { name: 'Test Patient', dob: '1970-02-02', mrn: '90210' }, note: note };
}

/* The draft every part below works on. Four blanks the box can field, of the
   two shapes a real draft carries, each in a sentence of its own. */
const NOTE =
  'OPERATIVE NOTE\n' +
  'PROCEDURE: Transforaminal epidural steroid injection.\n' +
  'The [FILL: levels] level was identified under fluoroscopy on the [FILL: laterality] side.\n' +
  'IMPRESSION: [FILL: diagnosis], treated as above.\n' +
  'A total volume of [[volume]] mL was injected at each level.\n';


/* one turn of the event loop, so an awaited AI round trip really has landed */
const flush = () => new Promise(r => setImmediate(r));

/* the REAL blank counter the save/sign/PDF/Athena gate uses, lifted out of the
   twin so the footer is checked against the product's own arithmetic */
const HTML_A = fs.readFileSync(TWIN_A, 'utf8');
const parserSrc = (HTML_A.match(/function opNoteBlankTokens\(text\)\{[\s\S]*?window\.opNoteBlankCount=opNoteBlankCount;/) || [''])[0];
const pctx = { console, String, Array, RegExp, Object, JSON };
pctx.window = pctx;
if (parserSrc) vm.runInNewContext(parserSrc, pctx, { filename: 'opNoteBlankTokens' });

function ledgerOf(src) {
  const env = makeEnv(src);
  env.ctx._opPrep = [row(NOTE)];
  const ta = makeDraft(env, 0, NOTE);
  env.api._buildFillBox(ta);
  const box = boxOf(env, ta);
  if (!box) return null;
  const nodes = box.querySelectorAll('button,input,select,textarea,details,summary');
  const ids = [], hooks = new Set(), names = [];
  nodes.forEach(n => {
    if (n.id) ids.push(n.id);
    Object.keys(n._attrs).forEach(a => { if (a.indexOf('data-onf') === 0) hooks.add(a); });
    if (n.tagName === 'BUTTON') {
      const t = String(n.textContent).replace(/\s+/g, ' ').trim();
      if (t) names.push(t);
    }
  });
  return { env, ta, box, ids: ids.sort(), hooks: Array.from(hooks).sort(), names: names.sort() };
}
function footerOf(box) {
  const b = box.querySelectorAll('[data-onf-accept]')[0];
  return b ? String(b.textContent).replace(/\s+/g, ' ').trim() : '';
}
function footerNumber(txt) {
  const m = txt.match(/—\s*(\d+)\s+blanks?\b/);
  return m ? +m[1] : (/—\s*complete/.test(txt) ? 0 : null);
}

async function main() {

/* ===================================================================== */
head('PART 1 - THE CONTROL LEDGER: what the old pane rendered, the new one still does');

ok(PRISTINE_SRC.length > 1000, 'the PRISTINE module was read from the frozen b944 fixture (the ledger is not vacuous)',
  PRISTINE_FIXTURE + ' produced ' + PRISTINE_SRC.length + ' bytes');
const before = PRISTINE_SRC ? ledgerOf(PRISTINE_SRC) : null;
const after = ledgerOf(NEW_SRC);
ok(!!before && !!after, 'both modules built a Fields box over the same draft');

/* the ONE declared change: two dictation buttons become one */
const MERGED_AWAY = ['mlsOnfDictGo_0'];
const MERGE_TARGET = 'mlsOnfDictBtn_0';

if (before && after) {
  console.log('        old controls: ' + JSON.stringify(before.ids));
  console.log('        new controls: ' + JSON.stringify(after.ids));
  const missingIds = before.ids.filter(id => after.ids.indexOf(id) < 0);
  ok(missingIds.every(id => MERGED_AWAY.indexOf(id) >= 0),
    'every control id the old pane rendered survives, except the declared merge',
    'unexpectedly gone: ' + JSON.stringify(missingIds.filter(i => MERGED_AWAY.indexOf(i) < 0)));
  ok(before.ids.indexOf('mlsOnfDictGo_0') >= 0,
    'the merge is real: the old pane DID render a second dictation button (not vacuous)');
  ok(after.ids.indexOf(MERGE_TARGET) >= 0, 'the merge target still exists');

  const missingHooks = before.hooks.filter(h => after.hooks.indexOf(h) < 0);
  ok(missingHooks.length === 0, 'every data-onf-* wiring hook survives',
    'gone: ' + JSON.stringify(missingHooks));

  /* names are allowed to change - that is the point of the pass - but every
     old CAPABILITY must land on a control that is still there. */
  const CAP = [
    ['per-field dictation mic', b => b.querySelectorAll('[data-onf-mic]').length],
    ['pin an answer for future notes', b => b.querySelectorAll('[data-onf-default-act="save"]').length],
    ['an editable control per blank', b => b.querySelectorAll('[data-onf-label]').length],
    ['recall a previous / default answer in one tap', b => b.querySelectorAll('[data-onf-recent-control]').length],
    ['save this note to History', b => b.querySelectorAll('[data-onf-accept]').length],
    ['a free-text pad for the transcript', b => b.querySelectorAll('textarea').length],
    ['a status line for the dictation', b => b.querySelectorAll('.onf-dict-status').length],
    ['the auto-filled review expander', b => b.querySelectorAll('details').length]
  ];
  CAP.forEach(c => {
    const b0 = c[1](before.box), b1 = c[1](after.box);
    ok(b1 >= b0, 'capability kept: ' + c[0], 'before=' + b0 + ' after=' + b1);
  });

  const dictWrap = after.box.querySelector('.onf-dict');
  const dictButtons = dictWrap ? dictWrap.querySelectorAll('button') : [];
  ok(dictButtons.length === 1, 'there is exactly ONE dictation button now',
    'found ' + dictButtons.length + ': ' + dictButtons.map(b => b.textContent).join(' | '));
  ok(before.box.querySelector('.onf-dict').querySelectorAll('button').length === 2,
    'the old pane really did offer two of them (not vacuous)');

  /* The shipped twins find this control by TWO selectors, id first and the
     class as fallback (1pScribeFlow.html:49014 and :52492). Both must resolve,
     and to the SAME real button, or the room's next-step glow ends up pointing
     at a control that no longer exists. */
  const byId = after.box.querySelectorAll('[id^="mlsOnfDictBtn_"]')[0] || null;
  const byClass = after.box.querySelectorAll('.onf-dict-go')[0] || null;
  ok(byId && byClass && byId === byClass,
    'both twin selectors ([id^=mlsOnfDictBtn_] and .onf-dict-go) resolve to the one merged button');
}

/* ===================================================================== */
head('PART 2 - "updates this draft instantly", executed both ways');

{
  const env = makeEnv(NEW_SRC);
  env.ctx._opPrep = [row(NOTE)];
  const ta = makeDraft(env, 0, NOTE);
  env.api._buildFillBox(ta);
  const lat = env.ctx.document.getElementById('onfF_0_laterality');
  ok(!!lat && lat.tagName === 'SELECT', 'laterality renders as a pick list');
  lat.value = 'Left';
  lat.dispatchEvent({ type: 'change' });
  ok(ta.value.indexOf('on the Left side') >= 0,
    'A PICK lands in the visible note at once (real change handler, real writer)',
    ta.value.split('\n')[2]);
  ok(env.ctx._opPrep[0].note.indexOf('on the Left side') >= 0,
    'and the row the rest of the app reads is updated with it');

  const dx = env.ctx.document.getElementById('onfF_0_diagnosis');
  ok(!!dx, 'the diagnosis field exists');
  dx.value = 'Lumbar radiculopathy';
  dx.dispatchEvent({ type: 'input' });          /* typing only: no blur, no Enter */
  ok(ta.value.indexOf('IMPRESSION: Lumbar radiculopathy') >= 0,
    'A TYPED character lands in the visible note at once, without blurring the field',
    ta.value.split('\n')[3]);

  if (PRISTINE_SRC) {
    const old = makeEnv(PRISTINE_SRC);
    old.ctx._opPrep = [row(NOTE)];
    const ta2 = makeDraft(old, 0, NOTE);
    old.api._buildFillBox(ta2);
    const dx2 = old.ctx.document.getElementById('onfF_0_diagnosis');
    dx2.value = 'Lumbar radiculopathy';
    dx2.dispatchEvent({ type: 'input' });
    ok(ta2.value.indexOf('IMPRESSION: Lumbar radiculopathy') < 0,
      'NON-VACUITY: the pristine pane did NOT update on a keystroke, so this is a real fix',
      'pristine line: ' + ta2.value.split('\n')[3]);
    dx2.dispatchEvent({ type: 'blur' });
    ok(ta2.value.indexOf('IMPRESSION: Lumbar radiculopathy') >= 0,
      'and its commit-on-blur path did work, so the comparison is fair');
  }

  dx.dispatchEvent({ type: 'blur' });
  ok(!!(env.ctx._opPrep[0]._onfTouched && env.ctx._opPrep[0]._onfTouched.diagnosis),
    'committing a typed field still marks it touched (the amber-review gate keeps its input)');
  ok(env.ctx.__autosaved.length > 0, 'committing a typed field still autosaves the draft');
}

/* ===================================================================== */
head('PART 3 - the footer verdict is TRUE, measured against the canonical parser');

ok(parserSrc.length > 400, 'the canonical opNoteBlankTokens() was lifted out of 1pScribeFlow.html');
const canonicalCount = pctx.opNoteBlankCount;
ok(typeof canonicalCount === 'function', 'and it runs');

{
  const env = makeEnv(NEW_SRC);
  env.ctx.opNoteBlankTokens = pctx.opNoteBlankTokens;
  env.ctx.opNoteBlankCount = canonicalCount;
  env.ctx._opPrep = [row(NOTE)];
  const ta = makeDraft(env, 0, NOTE);
  env.api._buildFillBox(ta);
  let box = boxOf(env, ta);

  let txt = footerOf(box);
  console.log('        footer: "' + txt + '"');
  ok(!/looks right/i.test(txt), 'the footer no longer puts a verdict in the doctor’s mouth', txt);
  ok(/^Save to History/.test(txt), 'it names the action first', txt);
  ok(/stays? as (a )?placeholders?/.test(txt),
    'and says what happens to what is still empty, instead of "(4 blanks left)"', txt);
  ok(footerNumber(txt) === canonicalCount(ta.value),
    'THE FOOTER NUMBER EQUALS THE CANONICAL BLANK COUNT of the note on screen',
    'footer=' + footerNumber(txt) + ' canonical=' + canonicalCount(ta.value));

  [['onfF_0_levels', 'L4-L5'], ['onfF_0_laterality', 'Left'],
   ['onfF_0_diagnosis', 'Lumbar radiculopathy'], ['onfF_0_volume', '1']].forEach(p => {
    const el = env.ctx.document.getElementById(p[0]);
    if (!el) return;
    if (el.tagName === 'SELECT' && !el.options.some(o => o.getAttribute('value') === p[1])) {
      const o = env.ctx.document.createElement('option');
      o.setAttribute('value', p[1]); o.textContent = p[1]; el.appendChild(o);
    }
    el.value = p[1];
    el.dispatchEvent({ type: 'change' });
  });
  env.api._buildFillBox(ta);
  box = boxOf(env, ta);
  txt = footerOf(box);
  ok(canonicalCount(ta.value) === 0, 'every blank really is gone from the note (not vacuous)',
    JSON.stringify(pctx.opNoteBlankTokens(ta.value)));
  ok(/complete/.test(txt) && footerNumber(txt) === 0,
    'the footer now reads complete - and it is', txt);
  ok(/Nothing left to fill/.test(String(box.querySelector('.onf-h').textContent)),
    'and the headline agrees with it', String(box.querySelector('.onf-h').textContent));

  /* saving is NOT blocked by blanks: it never was, and it still is not */
  const env2 = makeEnv(NEW_SRC);
  env2.ctx.opNoteBlankCount = canonicalCount;
  env2.ctx._opPrep = [row(NOTE)];
  const ta2 = makeDraft(env2, 0, NOTE);
  env2.api._buildFillBox(ta2);
  const acc = boxOf(env2, ta2).querySelectorAll('[data-onf-accept]')[0];
  ok(!acc.disabled, 'the save button is NOT disabled while blanks remain');
  acc.click();
  ok(env2.ctx.__saved.length === 1 && env2.ctx.__saved[0] === 0,
    'and clicking it still calls the app’s own opPrepSave for this row');
  ok(env2.ctx._opPrep[0]._onfReviewed === true,
    'pressing Save still marks the amber suggestions reviewed (the gate keeps its input)');
}

/* ===================================================================== */
head('PART 4 - ONE dictation entry point, driving the path that already worked');

{
  const env = makeEnv(NEW_SRC, {
    aiReply: '{"fills":[{"field":"levels","value":"L4-L5","correction":false},' +
             '{"field":"volume","value":"1.5","correction":false}]}'
  });
  let listening = false; const toggled = [];
  env.ctx.__mlsDictateAnywhere = {
    installed: true,
    toggleFor(el) { toggled.push(el && el.id); listening = true; },
    isListening() { return listening; },
    stop() { listening = false; }
  };
  env.ctx._opPrep = [row(NOTE)];
  const ta = makeDraft(env, 0, NOTE);
  env.api._buildFillBox(ta);
  const btn = env.ctx.document.getElementById('mlsOnfDictBtn_0');
  const pad = env.ctx.document.getElementById('mlsOnfDictPad_0');
  ok(!!btn && !!pad, 'the merged button and the pad both exist');
  ok(String((pad.style && pad.style.display) || '') !== 'none',
    'THE PAD IS VISIBLE - typing the details is now a reachable path, which is the one ' +
    'thing only the retired second button could do');

  ok(/Dictate/.test(btn.textContent), 'idle, the button offers to dictate', btn.textContent);
  btn.click();
  ok(toggled.length === 1 && toggled[0] === 'mlsOnfDictPad_0',
    'pressing it starts the pinned Dictate-Anywhere engine into the pad');
  ok(/stop/i.test(btn.textContent), 'while listening the SAME button offers to stop and fill', btn.textContent);

  pad.value = 'L4-L5, one and a half mils each level';
  pad.dispatchEvent({ type: 'input' });
  btn.click();                                   /* stop + route, in one press */
  await flush(); await flush();

  ok(env.aiCalls.length === 1, 'the one press reached routeDictation -> aiCallRaw',
    'aiCalls=' + env.aiCalls.length);
  ok(env.aiCalls.length > 0 && /FIELDS:/.test(env.aiCalls[0].user) && /DICTATION:/.test(env.aiCalls[0].user),
    'with the same field-state prompt the two-button version built');
  ok(ta.value.indexOf('The L4-L5 level') >= 0,
    'and the routed value is in the visible note', ta.value.split('\n')[2]);
  ok(ta.value.indexOf('volume of 1.5 mL') >= 0,
    'both routed values landed, so the AI router itself is untouched', ta.value.split('\n')[4]);
}

{
  /* typed-only path, with no dictation engine on the page at all */
  const env3 = makeEnv(NEW_SRC, { aiReply: '{"fills":[{"field":"levels","value":"L5-S1"}]}' });
  env3.ctx._opPrep = [row(NOTE)];
  const ta3 = makeDraft(env3, 0, NOTE);
  env3.api._buildFillBox(ta3);
  const pad3 = env3.ctx.document.getElementById('mlsOnfDictPad_0');
  const btn3 = env3.ctx.document.getElementById('mlsOnfDictBtn_0');
  pad3.value = 'L5-S1';
  pad3.dispatchEvent({ type: 'input' });
  ok(/fill/i.test(btn3.textContent),
    'with text in the pad the button offers to FILL from it', btn3.textContent);
  btn3.click();
  await flush(); await flush();
  ok(env3.aiCalls.length === 1, 'a typed transcript routes even with no dictation engine present');
  ok(ta3.value.indexOf('The L5-S1 level') >= 0, 'and lands in the note');
}

{
  /* the pad survives the 1s rebuild that used to wipe it */
  const env4 = makeEnv(NEW_SRC);
  env4.ctx._opPrep = [row(NOTE)];
  const ta4 = makeDraft(env4, 0, NOTE);
  env4.api._buildFillBox(ta4);
  const pad4 = env4.ctx.document.getElementById('mlsOnfDictPad_0');
  pad4.value = 'fluoro time forty seconds';
  pad4.dispatchEvent({ type: 'input' });
  const lat4 = env4.ctx.document.getElementById('onfF_0_laterality');
  lat4.value = 'Right'; lat4.dispatchEvent({ type: 'change' });
  env4.api._buildFillBox(ta4);                       /* the tick's rebuild */
  const padAfter = env4.ctx.document.getElementById('mlsOnfDictPad_0');
  ok(String(padAfter.value) === 'fluoro time forty seconds',
    'a transcript in the pad SURVIVES a rebuild (any value change used to wipe it)',
    JSON.stringify(String(padAfter.value)));
}

/* ===================================================================== */
head('PART 5 - the clarity itself');

{
  const env = makeEnv(NEW_SRC);
  env.ctx._opPrep = [row(NOTE)];
  const ta = makeDraft(env, 0, NOTE);
  env.api._buildFillBox(ta);
  const box = boxOf(env, ta);
  const h = String(box.querySelector('.onf-h').textContent).replace(/\s+/g, ' ').trim();
  console.log('        headline: "' + h + '"');

  ok(/to finish this note$/.test(h), 'ONE headline, in doctor language, naming the next action', h);
  ok(/^Fill in \d+ blanks?/.test(h), 'it opens with the verb and the number', h);
  ok(h.indexOf('·') < 0, 'it is no longer three counts separated by dots', h);
  ok(!/fields? needs? you/.test(h), 'and no longer says "N fields need you"', h);

  const askFields = box.querySelector('.onf-grid').querySelectorAll('.onf-field');
  ok(askFields.length >= 3, 'the fields awaiting the doctor are listed', 'n=' + askFields.length);
  const withCtx = askFields.filter(f => !!f.querySelector('.onf-ctx'));
  ok(withCtx.length === askFields.length,
    'EVERY field carries the sentence out of the note that its value lands in',
    withCtx.length + ' of ' + askFields.length);

  const latField = askFields.filter(f => /Laterality/.test(f.textContent))[0];
  ok(!!latField, 'the laterality field is on the ask list');
  const ctxTxt = String(latField.querySelector('.onf-ctx').textContent).replace(/\s+/g, ' ').trim();
  console.log('        context:  "' + ctxTxt + '"');
  ok(/under fluoroscopy on the/.test(ctxTxt),
    'and those are the note’s OWN words around this blank', ctxTxt);
  ok(!/\[FILL:|\[\[/.test(ctxTxt),
    'with no raw placeholder syntax leaking into it', ctxTxt);
  ok(latField.getAttribute('data-onf-at') !== null && latField.getAttribute('data-onf-len') !== null,
    'the field knows the exact span it owns in the draft');

  const latCtrl = env.ctx.document.getElementById('onfF_0_laterality');
  ta.selectionStart = 0; ta.selectionEnd = 0;
  latCtrl.focus();
  ok(ta.selectionStart === +latField.getAttribute('data-onf-at') && ta.selectionEnd > ta.selectionStart,
    'focusing the field selects that exact span in the draft',
    'sel=' + ta.selectionStart + '..' + ta.selectionEnd + ' expected start ' + latField.getAttribute('data-onf-at'));
  ok(env.ctx.document.activeElement === latCtrl,
    'and the caret STAYS in the field being answered (no focus steal)');

  latCtrl.value = 'Left'; latCtrl.dispatchEvent({ type: 'change' });
  latCtrl.blur();
  env.api._buildFillBox(ta);
  const box2 = boxOf(env, ta);
  ta.selectionStart = ta.value.indexOf('Left') + 1;
  ta.dispatchEvent({ type: 'click' });
  const rung = box2.querySelectorAll('.onf-field').filter(f => f.classList.contains('onf-here'));
  ok(rung.length === 1 && /Laterality/.test(rung[0].textContent),
    'clicking that value in the draft rings the field that owns it', 'rung=' + rung.length);
  ok(env.ctx.document.activeElement !== latCtrl,
    'and the click does not drag the caret back out of the note');

  const useBtn = box2.querySelectorAll('[data-onf-default-act="save"]')[0];
  ok(!!useBtn, 'the pin control is still offered');
  ok(String(useBtn.getAttribute('title') || '').length > 30,
    'it carries a full explanation on the control itself');
  const hint = useBtn.parentNode.querySelector('.onf-hint');
  ok(!!hint, 'and a visible plain-language hint sits beside it');
  const words = String(hint.textContent).trim().split(/\s+/).length;
  ok(words <= 6, 'the hint is five-ish words, not a paragraph',
    '"' + String(hint.textContent) + '" (' + words + ' words)');

  ok(!/Anything uncertain stays editable/.test(box2.innerHTML),
    'the bottom paragraph of fine print is gone');
  ok(!/applies only after you choose it/.test(box2.innerHTML),
    'including the part that explained the pin from the far end of the pane');
}

/* the stylesheet the module really emits */
const styleText = (function () {
  const env = makeEnv(NEW_SRC);
  env.ctx._opPrep = [row(NOTE)];
  const ta = makeDraft(env, 0, NOTE);
  env.api._buildFillBox(ta);
  const s = env.dom.document.head.children.filter(n => n.tagName === 'STYLE')[0];
  return s ? String(s.textContent) : '';
})();
ok(styleText.length > 800, 'the module’s stylesheet was obtained by execution',
  'len=' + styleText.length);

const cssRules = [];
styleText.replace(/([^{}]+)\{([^{}]*)\}/g, function (_, sel, decls) {
  cssRules.push({ sel: sel.trim().replace(/\s+/g, ' '), decls: decls });
  return '';
});
const needRules = cssRules.filter(r => r.sel.split(',').some(s => s.trim().endsWith('.onf-need')));
ok(needRules.length > 0, 'the "needs value" chip is styled (not vacuous)');
ok(!needRules.some(r => /#8a2a2a|#fbe0e0/i.test(r.decls)),
  'the RED alarm colours are gone from the per-field "needs value" chip',
  needRules.map(r => r.sel + ' {' + r.decls + '}').join(' '));
ok(/#8a2a2a|#fbe0e0/i.test(PRISTINE_SRC.slice(PRISTINE_SRC.indexOf('.onf-need'), PRISTINE_SRC.indexOf('.onf-need') + 160)),
  'and they really were there before (not vacuous)');
ok(needRules.some(r => /#4a5568|#eef1f5/i.test(r.decls)), 'it is now a calm neutral chip');
ok(cssRules.some(r => /onf-sug/.test(r.sel) && /onf-need/.test(r.sel) && /onf-hist/.test(r.sel)),
  'and ONE shared declaration gives all five chips the same shape');

ok(cssRules.some(r => /\.onf-fillbox \.onf-grid$/.test(r.sel) && /flex-direction:\s*column/.test(r.decls)),
  'the tight VERTICAL list is declared here, where it ships - not left to two room skins to force with !important');

const mobileAt = styleText.indexOf('@media (max-width:430px)');
ok(mobileAt > 0, 'there is a 390px-class breakpoint at all');
const mobileBlock = styleText.slice(mobileAt, mobileAt + 800);
ok(/onf-accept/.test(mobileBlock) && /width:100%/.test(mobileBlock),
  'the save button full-widths at phone width', mobileBlock.slice(0, 200));
ok(/onf-dict button/.test(mobileBlock), 'and so does the dictation row');
ok(/\.onf-save\{/.test(styleText.replace(/\s/g, '')) || /onf-save/.test(styleText),
  'the save row is a class now, not an inline flex style a breakpoint cannot reach');
ok(!/margin-top:9px;display:flex;align-items:center;gap:9px;/.test(NEW_SRC),
  'and the old inline style on that row is gone');

/* ===================================================================== */
head('PART 6 - nothing else moved');

{
  const env = makeEnv(NEW_SRC);
  env.ctx._opPrep = [row(NOTE)];
  const ta = makeDraft(env, 0, NOTE);
  env.api._buildFillBox(ta);
  const box = boxOf(env, ta);

  const useBtn = box.querySelectorAll('[data-onf-default-act="save"]')[0];
  const label = useBtn.getAttribute('data-onf-default-label');
  const ctrl = env.ctx.document.getElementById(useBtn.getAttribute('data-onf-default-control'));
  if (ctrl.tagName === 'SELECT') {
    const o = env.ctx.document.createElement('option');
    o.setAttribute('value', 'PINNED VALUE'); o.textContent = 'PINNED VALUE'; ctrl.appendChild(o);
  }
  ctrl.value = 'PINNED VALUE';
  ctrl.dispatchEvent({ type: 'change' });
  useBtn.click();
  ok(env.api.getDefault(label) === 'PINNED VALUE',
    '"Use every time" still writes the pin and it reads back',
    label + ' -> ' + JSON.stringify(env.api.getDefault(label)));
  ok(env.toasts.some(t => /will fill the same field in future op notes/.test(t.m)),
    'and still says so');

  ok(env.api.revert() === 'op-note fill reverted' &&
     env.dom.document.querySelectorAll('.onf-fillbox').length === 0,
    'revert() still removes every box');
}

/* ===================================================================== */
head('PART 7 - the twins');

{
  /* re-aimed at PERMANENT properties (the original two checks read git status
     and pinned the STAGING TREE - true only in the lane's isolated worktree,
     red the moment the pass lands together with other lanes or is committed):
     (a) the onfux markers live ONLY in the shared module, never in any shell;
     (b) the module genuinely carries the pass. Same intent, stated on bytes. */
  const onfuxRx = /onfux-1\.0\.0/;
  ok(!onfuxRx.test(HTML_A) && !onfuxRx.test(fs.readFileSync(TWIN_B, 'utf8')),
    'the fill-pane pass lives only in the shared module - no shell carries onfux bytes');
  ok(onfuxRx.test(fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_fill.js'), 'utf8')),
    'the shared fill module IS the change (not vacuous)');

  const A = HTML_A.split('\n');
  const B = fs.readFileSync(TWIN_B, 'utf8').split('\n');
  const rx = /onf-fillbox|onf-dict-go|onf-accept|mlsOnfDictBtn_|onf-field|onf-grid|onf-h\b/;
  const la = A.filter(l => rx.test(l)), lb = B.filter(l => rx.test(l));
  ok(la.length > 5, 'the twins really do carry fill-pane lines (not vacuous)', 'n=' + la.length);
  ok(la.join('\n') === lb.join('\n'),
    'TWINS IDENTICAL in every line that names the fill pane',
    'A=' + la.length + ' lines, B=' + lb.length + ' lines');
}

/* ===================================================================== */
head('PART 8 - a rebuild may not yank a field out from under a typing hand');

{
  const env = makeEnv(NEW_SRC);
  env.ctx._opPrep = [row(NOTE)];
  const ta = makeDraft(env, 0, NOTE);
  env.api._buildFillBox(ta);
  const dx = env.ctx.document.getElementById('onfF_0_diagnosis');
  dx.focus();
  dx.value = 'Lumbar rad';
  dx.dispatchEvent({ type: 'input' });
  ok(ta.value.indexOf('IMPRESSION: Lumbar rad') >= 0, 'the half-typed value is already in the note');
  env.api._buildFillBox(ta);                       /* what the 1s tick would do */
  ok(env.ctx.document.getElementById('onfF_0_diagnosis') === dx,
    'the field the doctor is inside is the SAME NODE after the tick (not replaced mid-word)');
  ok(ta.__onfDeferRebuild === true,
    'and the rebuild is recorded as deferred, so it is not stamped settled and comes straight back');
  dx.blur();
  env.api._buildFillBox(ta);
  ok(env.ctx.document.getElementById('onfF_0_diagnosis') !== dx,
    'once focus leaves, the pane rebuilds normally (the defer is not a permanent freeze)');
}

console.log('\n' + (failures === 0
  ? 'PASS  fill-ux-clarity: ' + checks + ' checks. Every control the old pane rendered is still ' +
    'reachable (one declared merge, both twin selectors resolving to it), a pick AND a keystroke ' +
    'reach the visible note through the real writer, the footer number equals the canonical blank ' +
    'count, the single dictation button drives routeDictation end to end, and no HTML moved.'
  : 'FAIL  fill-ux-clarity: ' + failures + ' of ' + checks + ' checks failed.'));
process.exit(failures === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.log('\nFAIL  fill-ux-clarity: the suite itself threw - ' + (e && e.stack || e));
  process.exit(1);
});
