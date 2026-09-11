'use strict';

/* reviewnote-1.1.0  --  "The note" tab lands ON the note
 * ==========================================================================
 * MEASURED on live b1230, walking the app as a first-day doctor would:
 *
 *   The Review dock paints a segmented row - Orders | The note | Billing.
 *   Pressing "The note" did not show a note anywhere on the Review screen. It
 *   pressed the rail's Visit tab and dropped the doctor back into the visit
 *   room at the Review & Sign stage, with the note itself below the fold.
 *
 * The label promised a note and the press delivered a room. A doctor with no
 * training reads that as a broken tab, and the fix that a doctor can verify is
 * that the press ENDS ON THE NOTE.
 *
 * WHY THIS SUITE WAS REWRITTEN (reviewnote-1.0.0 -> 1.1.0). Its first version
 * gave #ez3flNoteWrap a 200px rect and called that the note - a PROXY. On the
 * real shell #ez3flNoteWrap paints NO note: the bundle's own stylesheet hides
 * its label, its textarea and its formatted panel ("never render a second
 * note/editor"), leaving a 90px "Next: Review & send to Athena" row. 1.0.0
 * landed on it and counted a success while the note's words sat at y890 of a
 * 900px viewport. So the stub DOM below is now the SHIPPING SHAPE, measured in
 * headless Chrome at 1366x900, and the assertion is the property rather than
 * the id: the press must end on an element that is really PAINTING the note's
 * own words, and it is only a landing once those words are in the viewport.
 * The companion suite review-note-tab-lands-on-the-note-runtime.test.js makes
 * the same measurement on the real page, with positive controls.
 *
 * WHOSE CONTROL IS IT. The segment, its label and its navigation belong to
 * feat_mls_calm_shell.js (DEST.review carries extra:['nav_visit','nav_history']
 * with as:{nav_visit:'The note'}), and review-is-a-review-not-just-orders pins
 * exactly that. So the cure may NOT relabel the tab, re-route it, swallow its
 * click or duplicate its navigation - it may only finish the journey the label
 * already promised. Every one of those is asserted below, because "additive"
 * is a claim about code and this is the code.
 *
 * Run: node tests/review-note-tab-lands-on-the-note.test.js
 * ========================================================================*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const CONNECT = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const SHELL_MODULE = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ')'); }

/* ==========================================================================
 * 0. THE BLOCK EXISTS, ONCE, AND PARSES ON ITS OWN
 * ======================================================================== */
const BEGIN = '/* ===== reviewnote-1.1.0 — "The note" tab lands ON the note (2026-09-11) ====';
const END = '/* ===== reviewnote-1.1.0 module end ====================================== */';
ok(CONNECT.indexOf(BEGIN) > 0, 'the reviewnote block is missing from 1p-mls-connect.js');
eq(CONNECT.split(BEGIN).length - 1, 1, 'the reviewnote block is duplicated');
const BLOCK = CONNECT.slice(CONNECT.indexOf(BEGIN), CONNECT.indexOf(END) + END.length);
ok(CONNECT.indexOf(END) > CONNECT.indexOf(BEGIN), 'the reviewnote block has no end marker');
new vm.Script(BLOCK, { filename: 'reviewnote-1.1.0' });

/* code only, so prose about what the block does NOT do cannot satisfy a scan
   that is looking for what it does not DO */
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, ' ');
ok(CODE.length > 1200 && CODE.indexOf('MEASURED') < 0, 'the comment strip did not produce a clean code view');

/* ==========================================================================
 * 1. IT TAKES NOTHING THAT BELONGS TO THE SHELL
 * ======================================================================== */
/* The shell still owns the label... */
ok(/as:\s*\{[^}]*nav_visit:\s*'The note'/.test(SHELL_MODULE),
  "feat_mls_calm_shell.js no longer labels the Review segment 'The note' - this block " +
  'answers to that exact label, so the two files must agree on it');
/* ...and this block must not rename, re-route, or swallow it. */
for (const banned of ['preventDefault', 'stopPropagation', 'stopImmediatePropagation']) {
  ok(CODE.indexOf(banned) < 0,
    'the landing block calls ' + banned + '. The shell\'s own handler IS the navigation; ' +
    'suppressing the event would break the tab instead of finishing it.');
}
ok(CODE.indexOf('textContent =') < 0 && CODE.indexOf('textContent=') < 0,
  'the landing block writes a label. The segment text is the shell\'s, and two writers on ' +
  'one label is how a tab starts flickering between two names.');
ok(CODE.indexOf('nav_visit') < 0 && !/\.click\(/.test(CODE),
  'the landing block navigates by itself. One navigation, one owner - a second click here ' +
  'would double every press.');
ok(CODE.indexOf('setInterval') < 0,
  'the landing block installs a perpetual timer for a one-press job');
ok(!/chrome\.|browser\./i.test(CODE), 'the landing block reaches the browser extension');
for (const banned of ['signBtn', 'pushAllEmrBtn', 'genBtn', 'captureBtn']) {
  ok(CODE.indexOf(banned) < 0,
    'the landing block touches ' + banned + '. Showing a note is not signing, sending, ' +
    'generating or recording one.');
}
/* The whole 1.1.0 correction, pinned as code and not as a comment: the surface
   is chosen by what the browser is really DRAWING, not by whether a box has a
   rect, and a hidden child draws nothing. */
ok(/nodeType\s*===\s*3/.test(CODE) && /textarea/.test(CODE),
  'the landing block no longer reads the PAINTED text of a candidate (text nodes plus a ' +
  'textarea\'s value). Size is not the note - that is exactly what 1.0.0 got wrong.');
ok(/shown\(/.test(CODE) && CODE.indexOf('paintsNote') > 0,
  'the landing block no longer gates its candidates on actually painting the note');

/* ==========================================================================
 * 2. EXECUTED, AGAINST THE SHAPE THAT SHIPS
 * --------------------------------------------------------------------------
 * Geometry and visibility below are the real ones, measured in headless Chrome
 * at 1366x900 with a synthetic note and the guided room open at Review & Sign:
 *
 *   #ez3flNoteWrap   y720  h90   shown - but its <label> and its <textarea
 *                                id=ez3flNote> are display:none, so the only
 *                                thing drawn inside it is the Next row
 *   #ez3Note         y1205 h320  shown, holds the note  <- the note on screen
 *   #noteBox         y0    h0    display:none (the model of record)
 *   #mlsRevSlot      y2063 h484  shown, renders the note far below
 *   #noteCard        y1810 h1640 shown, wraps a zero-size .mlsf-note
 * ======================================================================== */
const NOTE = [
  'SUBJECTIVE: Synthetic patient reports a mild sore throat for three days.',
  'OBJECTIVE: Temperature ninety eight point six degrees and lungs clear.',
  'ASSESSMENT: Synthetic viral pharyngitis without complication.',
  'PLAN: Synthetic supportive care and follow up as needed.'
].join('\n');
const VH = 900;

function harness(opts) {
  opts = opts || {};
  const scrolled = [];
  const toasts = [];
  const formatted = { rerenders: 0 };
  const queue = [];
  const scroll = { y: 0 };
  let seq = 1;

  /* A document with a scroll position, so "already on screen" and "bring it on
     screen" are the same measurement a browser makes. __top is the position in
     the PAGE; a rect is that minus the scroll. */
  function node(o) {
    const n = {
      id: o.id || '',
      tagName: (o.tag || 'div').toUpperCase(),
      className: o.cls || '',
      __top: o.top || 0,
      __w: o.w === undefined ? 600 : o.w,
      __h: o.h === undefined ? 40 : o.h,
      __css: { display: o.display || 'block', visibility: o.visibility || 'visible' },
      __own: o.text || '',
      __kids: [],
      getBoundingClientRect() {
        const top = this.__top - scroll.y;
        return { width: this.__w, height: this.__h, top: top, bottom: top + this.__h, left: 0, right: this.__w };
      },
      scrollIntoView(how) {
        scrolled.push({ what: this.id || this.className || this.tagName, block: how && how.block, behavior: how && how.behavior });
        const want = (how && how.block === 'start') ? 20 : Math.max(0, (VH - this.__h) / 2);
        scroll.y = this.__top - want;
      },
      get children() { return this.__kids; },
      get childNodes() {
        const out = this.__own ? [{ nodeType: 3, nodeValue: this.__own }] : [];
        return out.concat(this.__kids);
      },
      get textContent() {
        return this.__own + this.__kids.map((k) => k.textContent).join('');
      },
      add(child) { this.__kids.push(child); return this; }
    };
    if (o.value !== undefined) n.value = o.value;
    Object.defineProperty(n, 'nodeType', { value: 1 });
    return n;
  }

  const nodes = Object.create(null);
  const all = [];
  function put(o) { const n = node(o); if (n.id) nodes[n.id] = n; all.push(n); return n; }

  nodes.visitView = put({ id: 'visitView', top: 0, h: 3000, display: opts.room === false ? 'none' : 'block' });

  /* the note as the app holds it - display:none, exactly as it ships */
  put({ id: 'noteBox', tag: 'textarea', top: 0, w: 0, h: 0, display: 'none', value: opts.noteText === undefined ? NOTE : opts.noteText });

  if (opts.wrap !== false) {
    const wrap = put({ id: 'ez3flNoteWrap', top: 720, h: 90 });
    /* hidden label + hidden note editor: they paint nothing */
    wrap.add(node({ tag: 'label', top: 720, w: 0, h: 0, display: 'none', text: 'Generated note - review and edit' }));
    const inner = put({
      id: 'ez3flNote', tag: 'textarea', top: 720, w: opts.wrapNoteShown ? 600 : 0, h: opts.wrapNoteShown ? 220 : 0,
      display: opts.wrapNoteShown ? 'block' : 'none', value: opts.noteText === undefined ? NOTE : opts.noteText
    });
    wrap.add(inner);
    /* the ONLY thing the browser really draws in there */
    wrap.add(node({ cls: 'ez3fl-nextrow', top: 720, h: 90, text: 'Next: Review & send to Athena Nothing sends automatically.' }));
  }

  if (opts.engineNote !== false) {
    put({
      id: 'ez3Note', tag: 'textarea', cls: 'ez3-note',
      top: opts.engineNoteTop === undefined ? 1205 : opts.engineNoteTop, h: 320,
      value: opts.noteText === undefined ? NOTE : opts.noteText
    });
  }

  const card = put({ id: 'noteCard', top: 1810, h: 1640 });
  card.add(node({ cls: 'mlsf-note', top: 1810, w: 0, h: 0, display: 'none', text: opts.noteText === undefined ? NOTE : opts.noteText }));
  put({ id: 'mlsRevSlot', top: 2063, h: 484, text: opts.noteText === undefined ? NOTE : opts.noteText });

  const seg = {
    id: 'seg-note',
    textContent: opts.segmentText === undefined ? 'The note' : opts.segmentText,
    closest(sel) { return sel === '#mlsRightNow .segbtn' ? seg : null; }
  };
  const outside = { id: 'elsewhere', textContent: 'Orders', closest() { return null; } };

  const doc = {
    readyState: 'complete',
    listeners: Object.create(null),
    addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const list = doc.listeners[type] || [];
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    getElementById(id) { return nodes[id] || null; },
    querySelectorAll(sel) {
      if (sel === '.mlsf-note') return all.concat(all.reduce((acc, n) => acc.concat(n.__kids), []))
        .filter((n) => String(n.className || '').split(/\s+/).indexOf('mlsf-note') >= 0);
      return [];
    },
    querySelector() { return null; },
    documentElement: { clientHeight: VH }
  };
  const win = {
    innerHeight: VH,
    toast(msg) { toasts.push(String(msg)); },
    __mlsFormat: { enabled: true, rerender() { formatted.rerenders++; } }
  };

  const ctx = {
    window: win,
    document: doc,
    Math: Math,
    getComputedStyle(n) { return (n && n.__css) || { display: 'block', visibility: 'visible' }; },
    setTimeout(fn, ms) { const id = seq++; queue.push({ id, fn, ms }); return id; },
    clearTimeout(id) { for (let i = 0; i < queue.length; i++) { if (queue[i].id === id) { queue.splice(i, 1); return; } } }
  };
  vm.createContext(ctx);
  vm.runInContext(BLOCK, ctx);

  function fire(target) {
    (doc.listeners.click || []).forEach((fn) => fn({ target: target }));
  }
  function drain(max) {
    let n = 0;
    while (queue.length && n++ < (max || 40)) { const t = queue.shift(); t.fn(); }
  }
  /* THE PROPERTY, measured the way the runtime suite measures it on the real
     page: is an element that really paints the note inside the viewport? */
  function keyWords(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      .split(' ').filter((w) => w.length > 2);
  }
  function noteOnScreen() {
    const want = keyWords(opts.noteText === undefined ? NOTE : opts.noteText).slice(0, 5).join(' ');
    if (!want) return { onScreen: false, who: '' };
    const painters = all.concat(all.reduce((acc, n) => acc.concat(n.__kids), [])).filter((n) => {
      if (n.__css.display === 'none' || n.__css.visibility === 'hidden') return false;
      if (!(n.__w > 0 && n.__h > 0)) return false;
      const tag = String(n.tagName || '').toLowerCase();
      const text = keyWords(tag === 'textarea' ? String(n.value || '') : String(n.__own || '')).join(' ');
      return text.indexOf(want) >= 0;
    });
    for (const p of painters) {
      const r = p.getBoundingClientRect();
      const band = Math.min(r.bottom, VH) - Math.max(r.top, 0);
      if (band >= Math.min(r.height, 80)) return { onScreen: true, who: p.id || p.className };
    }
    return { onScreen: false, who: painters.map((p) => p.id || p.className).join(',') };
  }
  return { ctx, win, seg, outside, fire, drain, scrolled, toasts, formatted, nodes, queue, scroll, noteOnScreen };
}

/* the module installs itself and publishes a revert */
{
  const h = harness({});
  ok(h.win.__mlsReviewNoteLanding && h.win.__mlsReviewNoteLanding.installed === true,
    'the landing block did not install');
  eq(typeof h.win.__mlsReviewNoteLanding.revert, 'function', 'the landing block is not reversible');
  ok((h.ctx.document.listeners.click || []).length === 1, 'the landing block wired more than one click listener');
  eq(h.win.__mlsReviewNoteLanding.version, 'reviewnote-1.1.0', 'the landing block reports the wrong version');
}

/* THE DEFECT, REPRODUCED: before the press, the note is not on the screen and
   the wrapper that 1.0.0 landed on IS - so "it had a rect" was never enough */
{
  const h = harness({});
  eq(h.noteOnScreen().onScreen, false,
    'the stub does not reproduce the defect - the note is already on screen before the press, so ' +
    'nothing below measures anything');
  const wrapRect = h.nodes.ez3flNoteWrap.getBoundingClientRect();
  ok(wrapRect.top >= 0 && wrapRect.bottom <= VH,
    'the stub does not reproduce the defect - #ez3flNoteWrap must start fully on screen, which is ' +
    'why 1.0.0 scrolled nowhere and still called it a landing');
}

/* the press ends ON THE NOTE, and the Formatted view is asked to be current */
{
  const h = harness({});
  h.fire(h.seg);
  h.drain();
  const seen = h.noteOnScreen();
  eq(seen.onScreen, true,
    'pressing "The note" did not put the note on screen. Scrolled: ' + JSON.stringify(h.scrolled) +
    ' at scrollY ' + h.scroll.y);
  eq(seen.who, 'ez3Note', 'the note that ended up on screen is not the one the doctor reads');
  ok(h.scrolled.length >= 1 && h.scrolled[0].what === 'ez3Note',
    'the page was moved to something that is not the note: ' + JSON.stringify(h.scrolled));
  ok(h.formatted.rerenders >= 1, 'the Formatted view was not brought up to date before the page moved to it');
  eq(h.win.__mlsReviewNoteLanding.counts().lands, 1, 'the landing was not recorded');
  eq(h.toasts.length, 0, 'a note that IS there still produced a sentence saying it is not');
  eq(h.win.__mlsReviewNoteLanding.showsNote().surface, '#ez3Note',
    'the block names a surface that is not the one it landed on');
  eq(h.win.__mlsReviewNoteLanding.showsNote().onScreen, true,
    'the block reports its own surface off screen after landing on it');
}

/* THE 1.0.0 LANDING, STAGED IN-FAMILY: centring #ez3flNoteWrap - which is what
   the pre-fix candidate order did - must leave the note off the screen. If it
   did not, every pass above would be luck. */
{
  const h = harness({});
  h.nodes.ez3flNoteWrap.scrollIntoView({ block: 'center', behavior: 'auto' });
  eq(h.noteOnScreen().onScreen, false,
    'THE INSTRUMENT IS BLIND: landing on #ez3flNoteWrap the way reviewnote-1.0.0 did put the note ' +
    'on screen by itself, so the pass above proves nothing');
}

/* THE GATE IS "PAINTS THE NOTE", NOT "IS NOT THE WRAPPER". Un-hide the note
   inside #ez3flNoteWrap and that IS where the press should end. */
{
  const h = harness({ wrapNoteShown: true });
  h.fire(h.seg);
  h.drain();
  eq(h.win.__mlsReviewNoteLanding.showsNote().surface, '#ez3flNote',
    'with the lane really rendering a note, the press did not end on it - the block is matching ' +
    'ids rather than measuring what the browser draws');
  eq(h.noteOnScreen().onScreen, true, 'the lane\'s own visible note did not end up on screen');
}

/* a note already fully on screen does not move the page */
{
  const h = harness({ engineNoteTop: 200 });
  h.fire(h.seg);
  h.drain();
  eq(h.scrolled.length, 0, 'the page jumped for a note that was already fully on screen');
  eq(h.win.__mlsReviewNoteLanding.counts().lands, 1, 'an on-screen note was not counted as a landing');
  eq(h.scroll.y, 0, 'the page scrolled anyway');
}

/* a landing is a MEASUREMENT: a surface that never comes into view is never
   counted as one, however many times the block asks for it */
{
  const h = harness({});
  h.nodes.ez3Note.scrollIntoView = function () { /* a page that refuses to move */ };
  h.fire(h.seg);
  h.drain(200);
  eq(h.win.__mlsReviewNoteLanding.counts().lands, 0,
    'the block counted a landing while the note stayed off the screen - that is exactly the ' +
    '1.0.0 defect, in its general form');
  eq(h.queue.length, 0, 'the walk is still scheduling work after its budget ran out');
}

/* any OTHER segment is none of this block's business */
{
  const h = harness({});
  h.fire(h.outside);
  h.drain();
  eq(h.scrolled.length, 0, 'the landing block acted on a press that was not "The note"');
  eq(h.win.__mlsReviewNoteLanding.counts().presses, 0, 'a press on another control armed the landing');
}
{
  const h = harness({ segmentText: 'History' });
  h.fire(h.seg);
  h.drain();
  eq(h.scrolled.length, 0, 'the landing block matched a segment by position rather than by its label');
}

/* an empty visit says the next step instead of landing nowhere */
{
  const h = harness({ noteText: '', wrap: false, engineNote: false });
  h.fire(h.seg);
  h.drain();
  eq(h.scrolled.length, 0, 'there was no note, yet the page was moved to something');
  eq(h.toasts.length, 1, 'an empty visit ended the press in silence');
  ok(/no note for this visit yet/i.test(h.toasts[0]) && /Generate note/i.test(h.toasts[0]),
    'the empty-visit sentence does not say what to do next: ' + JSON.stringify(h.toasts[0]));
  for (const word of ['DOM', 'selector', 'null', 'undefined', 'render']) {
    ok(h.toasts[0].indexOf(word) < 0, 'the empty-visit sentence uses a developer word: ' + word);
  }
}

/* the walk is bounded - it never becomes a permanent poll */
{
  const h = harness({ room: false });
  h.fire(h.seg);
  h.drain(200);
  eq(h.queue.length, 0, 'the landing walk is still scheduling work after it gave up');
  eq(h.scrolled.length, 0, 'a closed visit room was scrolled anyway');
}

/* revert really unhooks it */
{
  const h = harness({});
  eq(h.win.__mlsReviewNoteLanding.revert(), true, 'revert did not report success');
  h.fire(h.seg);
  h.drain();
  eq(h.scrolled.length, 0, 'the landing block still acted after revert');
  eq(h.win.__mlsReviewNoteLanding.installed, false, 'revert left the block marked installed');
}

console.log('PASS review note tab lands on the note: ' + checks + ' checks - the Review dock\'s ' +
  '"The note" press still navigates through the shell\'s own handler (no preventDefault, no ' +
  'second click, no relabel), and then ends with the note\'s OWN WORDS really inside the viewport, ' +
  'chosen by what the browser paints rather than by which box has a rect; landing on the wrapper ' +
  'the pre-fix version used leaves the note off screen, a note already in view does not move the ' +
  'page, a surface that never comes into view is never counted as a landing, any other segment is ' +
  'untouched, an empty visit gets one plain sentence naming the next step, the walk is bounded, ' +
  'and revert unhooks everything');
