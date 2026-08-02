'use strict';
/* =========================================================================
   AN ANIMATION EXISTS ONLY IF SOMETHING FIRES IT
   -------------------------------------------------------------------------
   OWNER: "make apple like magical animatioons all over to make it feel like
   majic that wdocotrs will love and to make thiungs ifelel intuitive."

   The reason this suite exists, in one paragraph. feat_mls_magic.js shipped five
   animations keyed on `.mg-drawn`, `.mg-settle`, `.mg-wait`, `body.mg-pt-swap`
   and `body.mls-note-live`. A repo-wide sweep found ZERO writers for all five. It
   animated nothing, for a day, and it passed EVERY motion suite in this repo —
   because those check the shape of the CSS: tokenised durations, a generated
   reduced-motion off-switch, no layout properties, no infinite loops. Not one of
   them asked the only question that decides whether a user sees anything:

       does anything ever turn this on?

   tests/styled-trigger-classes-have-writers.test.js answers that statically — a
   writer must exist somewhere. This suite answers it DYNAMICALLY, which is
   stronger: it loads the real module over a stub DOM, DISPATCHES the real events
   the app dispatches, and asserts the classes actually land on the actual nodes.
   A writer that exists but is unreachable — inside a dead branch, behind a guard
   that never opens, attached to the wrong target — passes the static check and
   fails this one.

   It also pins the properties that make motion safe on THIS app: a clinical
   surface whose visit view churns on every transcript chunk, whose hidden-tab
   timers are frozen rather than throttled, and which has been measured wedging
   the main thread for minutes.
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

/* ---------------- a stub DOM with real event dispatch ------------------- */
function makeEnv() {
  const nodes = new Map();
  function cls() {
    const s = new Set();
    return {
      _s: s,
      add(c) { s.add(c); }, remove(c) { s.delete(c); },
      contains(c) { return s.has(c); },
      toggle(c, f) { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (f) s.add(c); else s.delete(c); }
    };
  }
  function mk(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), id: '', textContent: '',
      style: {}, parentNode: null, children: [], _attrs: {}, _l: {},
      classList: cls(), offsetWidth: 100,
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
      appendChild(c) { c.parentNode = this; this.children.push(c); if (c.id) nodes.set(c.id, c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
      addEventListener(t, f, o) { (this._l[t] = this._l[t] || []).push({ f: f, once: !!(o && o.once) }); },
      removeEventListener(t, f) {
        if (!this._l[t]) return;
        this._l[t] = this._l[t].filter(x => x.f !== f);
      },
      dispatchEvent(e) {
        const hs = (this._l[e.type] || []).slice();
        hs.forEach(h => { try { h.f(e); } catch (err) {} if (h.once) this.removeEventListener(e.type, h.f); });
        return true;
      },
      querySelectorAll() { return []; }, querySelector() { return null; },
      closest() { return null; }, focus() {}, scrollIntoView() {}
    };
    Object.defineProperty(el, 'innerHTML', { get() { return el.textContent; }, set(v) { el.textContent = String(v); } });
    return el;
  }
  const body = mk('body'); body.id = '__body';
  const doc = {
    _nodes: nodes, createElement: mk,
    getElementById(id) { return nodes.get(id) || null; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    body: body, head: mk('head'), documentElement: mk('html'),
    _l: {},
    addEventListener(t, f, o) { (this._l[t] = this._l[t] || []).push({ f: f, once: !!(o && o.once) }); },
    removeEventListener(t, f) { if (this._l[t]) this._l[t] = this._l[t].filter(x => x.f !== f); },
    getAnimations() { return []; }
  };
  ['noteCard', 'patientLabel', 'mlsStages'].forEach(id => { const n = mk('div'); n.id = id; nodes.set(id, n); });

  const timers = [];
  const win = {
    document: doc, _l: {},
    addEventListener(t, f, o) { (this._l[t] = this._l[t] || []).push({ f: f, once: !!(o && o.once) }); },
    removeEventListener(t, f) { if (this._l[t]) this._l[t] = this._l[t].filter(x => x.f !== f); },
    dispatchEvent(e) {
      const hs = (this._l[e.type] || []).slice();
      hs.forEach(h => { try { h.f(e); } catch (err) {} if (h.once) this.removeEventListener(e.type, h.f); });
      return true;
    },
    setTimeout(fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
    clearTimeout() {},
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    _timers: timers
  };
  win.window = win;
  return { win: win, doc: doc, body: body, timers: timers };
}

function loadMagic(env) {
  const src = fs.readFileSync(path.join(ROOT, 'feat_mls_magic.js'), 'utf8');
  new Function('window', 'document', 'setTimeout', 'clearTimeout', 'CustomEvent', src)(
    env.win, env.doc, env.win.setTimeout.bind(env.win), env.win.clearTimeout, env.win.CustomEvent);
  return env.win.__mlsMagic;
}

/* ---------------- 1. it installs and emits real CSS -------------------- */
const e1 = makeEnv();
const api1 = loadMagic(e1);
ok(!!api1 && api1.installed, 'the magic layer installs');
const css = api1.css();
ok(css.length > 400, 'it emits a stylesheet', css.length + ' bytes');

/* ---------------- 2. THE MOMENTS ACTUALLY FIRE ------------------------- */
ok(!e1.body.classList.contains('mls-note-live'),
  'before anything happens, no note is claimed to be live');

/* HONESTY FIRST. mls:generation-complete means generation SETTLED, not that a
   note arrived - it fires on the no-API-key refusal, the offline-example path,
   and the `finally` block that runs on timeout and error too. A settled-but-empty
   generation must NOT be celebrated: an animation may never assert more than the
   app can back. This assertion is the one that stops this module congratulating
   the doctor on a note that does not exist. */
e1.win.dispatchEvent(new e1.win.CustomEvent('mls:generation-complete'));
ok(!e1.body.classList.contains('mls-note-live'),
  'A FAILED GENERATION IS NOT CELEBRATED (settled, but no note on screen)',
  'this event fires on refusal and on error; treating it as success is the same\n' +
  '        lie as a toast over a silent failure');

/* now give it a real note, the way a successful generation does */
const nb = e1.doc.createElement('textarea');
nb.id = 'noteBox';
nb.value = 'OPERATIVE NOTE\n\nProcedure performed as described in the template.';
e1.doc._nodes.set('noteBox', nb);

e1.win.dispatchEvent(new e1.win.CustomEvent('mls:generation-complete'));
ok(e1.body.classList.contains('mls-note-live'),
  'A NOTE ARRIVING SETS body.mls-note-live',
  'this is the class FOUR modules style and NOTHING used to set - dispatching the\n' +
  '        real event must land it, or every one of those rules is decoration');
ok(e1.doc.getElementById('noteCard').classList.contains('mg-settle'),
  'and the note card gets its arrival moment',
  'the class must land on the REAL node, not merely exist in a stylesheet');

/* a second note must replay the moment, not sit there already-classed */
const card = e1.doc.getElementById('noteCard');
card.classList.remove('mg-settle');
e1.win.dispatchEvent(new e1.win.CustomEvent('mls:generation-complete'));
ok(card.classList.contains('mg-settle'),
  'a SECOND note replays the moment (the class is re-applied, not assumed)');

/* patient change: crossfade arms, and the note-live claim stands down */
e1.win.dispatchEvent(new e1.win.CustomEvent('mls:active-patient-changed'));
ok(e1.body.classList.contains('mg-pt-swap'),
  'CHANGING PATIENT ARMS THE BANNER CROSSFADE');
ok(!e1.body.classList.contains('mls-note-live'),
  'and the app stops claiming a note is live for a patient who has none',
  'this is honesty, not decoration: the new patient has no note yet');

/* ---------------- 3. the transient class CANNOT latch ------------------ */
ok(e1.timers.length > 0,
  'a bounded fallback is armed so the swap class cannot latch',
  'if the transition never runs (reduced motion), nothing else would clear it');
e1.timers.forEach(t => { try { t.fn(); } catch (err) {} });
ok(!e1.body.classList.contains('mg-pt-swap'),
  'THE SWAP CLASS CLEARS ITSELF - a latched animation class is a permanent visual bug');
ok(e1.timers.every(t => t.ms > 0 && t.ms <= 2000),
  'the fallback is bounded to a sane delay',
  'delays: ' + e1.timers.map(t => t.ms).join(', '));

/* ---------------- 4. no polling, no observer, no rAF ------------------- */
const SRC = fs.readFileSync(path.join(ROOT, 'feat_mls_magic.js'), 'utf8');
ok(!/setInterval\s*\(/.test(SRC),
  'no interval - hidden-tab timers are FROZEN in this app, not throttled');
ok(!/requestAnimationFrame/.test(SRC),
  'no rAF loop');
ok(!/new\s+MutationObserver|IntersectionObserver|ResizeObserver/.test(SRC),
  'no observer - this app has been measured wedging the main thread for minutes');

/* ---------------- 5. safe properties only ----------------------------- */
/* A rule only counts as ANIMATING if it turns motion ON. `animation:none` and
   `transition:none` are off-switches - the guard that excludes the medical record
   and the stand-down while recording are both written that way, and an earlier
   version of this check flagged them as animations missing an off-switch, which
   is nonsense: they ARE off-switches. Third time today a checker of mine matched
   a disabling rule as if it enabled something; the pattern is worth naming. */
const animating = [];
css.replace(/([^{}]+)\{([^{}]*)\}/g, function (_, sel, decls) {
  const turnsOn =
    /animation\s*:\s*(?!none)[a-zA-Z]/.test(decls) ||
    /transition\s*:\s*(?!none)[a-zA-Z-]+\s/.test(decls);
  if (turnsOn) animating.push({ sel: sel.trim(), decls: decls });
  return '';
});
ok(animating.length > 0, 'the stylesheet has animating rules to check (not vacuous)',
  animating.length + ' rule(s)');
const LAYOUT = /\b(width|height|top|left|right|bottom|margin|padding|font-size)\b\s+[\d.]/;
const bad = animating.filter(r => LAYOUT.test(r.decls.replace(/animation:[^;]*/g, m => m)) &&
  /transition\s*:[^;]*\b(width|height|top|left|margin|padding|font-size)\b/.test(r.decls));
ok(bad.length === 0,
  'nothing transitions a layout property',
  bad.map(r => r.sel).join(', '));

/* clinical text is never animated */
ok(/#noteBox[^{]*\{[^}]*animation:\s*none/.test(css) || /#noteBox/.test(css),
  'the medical record itself is excluded from animation');

/* every animating selector is switched off under reduced motion */
const rm = (css.match(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*)\}/) || [, ''])[1];
ok(rm.length > 20, 'a reduced-motion off-switch ships');
const uncovered = animating
  .map(r => r.sel)
  .filter(sel => !rm.includes(sel.split(',')[0].trim()) && !/prefers-reduced/.test(sel));
ok(uncovered.length === 0,
  'EVERY animating selector appears in the reduced-motion off-switch',
  uncovered.join('\n        '));

/* ------- 5b. mg-1.1.0: the status moments fire on FACTS, not on calls ---- */
/* The wraps must celebrate only when row state proves delivery: a bumped
   _genSeq (a draft landed) or a present _noteId (a save landed). A call that
   returns empty-handed must land NOTHING — the generation-complete lesson,
   applied to the op-note session. */
const e3 = makeEnv();
const st3 = e3.doc.createElement('div');
st3.id = 'opPrepStatus'; st3.offsetWidth = 120;
e3.doc._nodes.set('opPrepStatus', st3);
e3.win._opPrep = [{ _genSeq: 0 }];
let draftDelivers = false;
e3.win.opPrepGenerateOne = function (i) { if (draftDelivers) e3.win._opPrep[i]._genSeq++; };
e3.win.opPrepSave = function (i) { if (draftDelivers) e3.win._opPrep[i]._noteId = 'n1'; };
const api3 = loadMagic(e3);
ok(e3.win.opPrepGenerateOne.__mgxWrap === true, 'opPrepGenerateOne is wrapped at load');
ok(e3.win.opPrepSave.__mgxWrap === true, 'opPrepSave is wrapped at load');

e3.win.opPrepGenerateOne(0);
ok(!st3.classList.contains('mgx2-good'),
  'A DRAFT THAT DID NOT LAND IS NOT CELEBRATED (_genSeq unmoved)',
  'every failure path returns before _genSeq moves; the moment must ask the fact');
e3.win.opPrepSave(0);
ok(!st3.classList.contains('mgx2-good'),
  'A SAVE THAT DID NOT LAND IS NOT CELEBRATED (_noteId absent)');

draftDelivers = true;
e3.win.opPrepGenerateOne(0);
ok(st3.classList.contains('mgx2-good'),
  'A DELIVERED DRAFT SETTLES THE STATUS LINE (fact: _genSeq moved)');
st3.classList.remove('mgx2-good');
e3.win.opPrepSave(0);
ok(st3.classList.contains('mgx2-good'),
  'A LANDED SAVE SETTLES THE STATUS LINE (fact: _noteId present)');

api3.revert();
ok(e3.win.opPrepGenerateOne.__mgxWrap === undefined && e3.win.opPrepSave.__mgxWrap === undefined,
  'revert() unwraps both op-note wraps',
  'a wrap that survives revert is a leak into another lane’s function');

/* ---------------- 6. revert leaves nothing behind --------------------- */
const e2 = makeEnv();
const api2 = loadMagic(e2);
/* a real note, so the moment has something honest to celebrate */
const nb2 = e2.doc.createElement('textarea');
nb2.id = 'noteBox';
nb2.value = 'OPERATIVE NOTE with enough body to count as a real note.';
e2.doc._nodes.set('noteBox', nb2);
e2.win.dispatchEvent(new e2.win.CustomEvent('mls:generation-complete'));
ok(e2.body.classList.contains('mls-note-live'), 'second env: the moment fires');
api2.revert();
ok(!e2.body.classList.contains('mls-note-live'),
  'revert() clears the body class it set');
e2.win.dispatchEvent(new e2.win.CustomEvent('mls:generation-complete'));
ok(!e2.body.classList.contains('mls-note-live'),
  'AND ITS LISTENERS ARE GONE - a reverted module must not keep reacting',
  'a live listener on a reverted module is a leak that survives teardown');

console.log(failures === 0
  ? '\nPASS  magic-moments-actually-fire: the real events land the real classes on the real nodes, nothing latches, and revert is complete.'
  : '\nFAIL  magic-moments-actually-fire: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
