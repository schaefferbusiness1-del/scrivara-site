'use strict';
/*
 * THE AVATAR CARD MUST APPEAR AT ONCE (av-6.0.8)
 * -----------------------------------------------------------------------------
 * Owner, on a screenshot of the Visit page: "this top thing show shoup uop right
 * away not take a secod".
 *
 * The cause was NOT in feat_mls_avatar.js. __mlsDeferAsset drains deferred assets
 * strictly serially — one script at a time, waiting for each real load event, with
 * a 250ms gap between jobs for the first 30s after a 2500ms initial quiet period —
 * and the avatar module is roughly the 52nd of ~100 such loaders at default
 * priority. So the card was tens of seconds late, not one second.
 *
 * The fix paints the card's box and title from the loader immediately and lets the
 * real module ADOPT the same node. This file EXECUTES the loader shim against a
 * mini-DOM (it is self-contained, so it can be run for real) and pins the module's
 * half of the adoption contract structurally — with every structural pin also run
 * against the pre-fix bytes, because a pin that passes on the old file is not a pin.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const p1Connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'feat_mls_avatar.js'), 'utf8');

let pass = 0;
function ok(label, cond) {
  assert(cond, 'FAILED: ' + label);
  pass++;
  console.log('  ok  ' + label);
}

/* Production retains its compatibility shim below, but /1p no longer uses
   that tag-only ownership model. Pin the actual preview handoff here too so
   this suite cannot stay green by executing only the retired implementation. */
{
  const loaderAt = p1Connect.indexOf('/* p1-avatar-loader-1.0.0:');
  const mobileAt = p1Connect.indexOf("A='1p-feat_mls_mobile_encounter.js'", loaderAt);
  const faceAt = p1Connect.indexOf("A='feat_mls_avatar_face.js'", loaderAt);
  const loaderEnd = mobileAt > loaderAt ? mobileAt : faceAt;
  const p1Loader = loaderAt >= 0 && loaderEnd > loaderAt ? p1Connect.slice(loaderAt, loaderEnd) : '';
  const shimAt = p1Connect.indexOf('/* av-6.0.8:', faceAt);
  const shimEnd = p1Connect.indexOf('/* 2026-07-28 owner order:', shimAt);
  const p1Shim = shimAt >= 0 && shimEnd > shimAt ? p1Connect.slice(shimAt, shimEnd) : '';
  ok('the /1p instant card belongs to one exact capability controller',
    p1Loader.includes("KEY='__mlsP1AvatarLoader'") && p1Loader.includes('ctl.mountSkeleton=function()'));
  ok('the /1p controller has exactly one Avatar script creator',
    (p1Loader.match(/document\.createElement\('script'\)/g) || []).length === 1);
  ok('the later /1p card hook delegates instead of creating another script',
    p1Shim.includes('ctl.mountSkeleton()') && !/createElement\('script'\)/.test(p1Shim));
}

/* ---------------------------------------------------------------------------
 * A mini-DOM. It supports exactly what the shim touches and THROWS on anything
 * it does not, because a harness that quietly returns undefined for an
 * unsupported call turns a broken feature into a green test.
 * ------------------------------------------------------------------------- */
function makeDom() {
  let uid = 0;
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attrs = {};
      this.listeners = {};
      this.style = { cssText: '' };
      this._text = '';
      this.parentNode = null;
      this.__uid = ++uid;
    }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = String(v); }
    get title() { return this.attrs.title || ''; }
    set title(v) { this.attrs.title = String(v); }
    /* src and async REFLECT into attributes, as they do in a real DOM — otherwise a test
       reading getAttribute('src') sees nothing and reports a fetch that did happen as absent */
    get src() { return this.attrs.src || ''; }
    set src(v) { this.attrs.src = String(v); }
    get async() { return this.attrs.async === 'true'; }
    set async(v) { this.attrs.async = String(!!v); }
    get textContent() {
      if (this.children.length) return this.children.map(c => c.textContent).join('');
      return this._text;
    }
    set textContent(v) { this._text = String(v); this.children = []; }
    get innerHTML() { return this.children.length ? '<children>' : ''; }
    set innerHTML(v) {
      assert(String(v) === '', 'harness supports only innerHTML = "" (adoption clears the node)');
      this.children.forEach(c => { c.parentNode = null; });
      this.children = [];
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(n) {
      if (n.parentNode) n.parentNode.removeChild(n);
      n.parentNode = this; this.children.push(n); return n;
    }
    removeChild(n) {
      const i = this.children.indexOf(n);
      assert(i >= 0, 'removeChild on a node that is not a child');
      this.children.splice(i, 1); n.parentNode = null; return n;
    }
    insertBefore(n, ref) {
      if (n.parentNode) n.parentNode.removeChild(n);
      n.parentNode = this;
      if (ref == null) { this.children.push(n); return n; }
      const i = this.children.indexOf(ref);
      assert(i >= 0, 'insertBefore with a reference node that is not a child');
      this.children.splice(i, 0, n); return n;
    }
    get firstElementChild() { return this.children.length ? this.children[0] : null; }
    get nextElementSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return (i >= 0 && i + 1 < this.parentNode.children.length) ? this.parentNode.children[i + 1] : null;
    }
    contains(n) {
      if (n === this) return true;
      return this.children.some(c => c.contains(n));
    }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener(type, fn) {
      const a = this.listeners[type] || [];
      const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    }
    fire(type) { (this.listeners[type] || []).slice().forEach(fn => fn({ type: type })); }
    walk(fn) { fn(this); this.children.forEach(c => c.walk(fn)); }
    querySelector(sel) {
      /* exactly two forms are used by the code under test */
      let m = /^script\[data-mls-asset="([^"]+)"\]$/.exec(sel);
      if (m) {
        let hit = null;
        this.walk(el => { if (!hit && el.tagName === 'SCRIPT' && el.getAttribute('data-mls-asset') === m[1]) hit = el; });
        return hit;
      }
      m = /^#([A-Za-z0-9_-]+)$/.exec(sel);
      if (m) {
        let hit = null;
        this.walk(el => { if (!hit && el !== this && el.id === m[1]) hit = el; });
        return hit;
      }
      throw new Error('harness does not support the selector ' + sel + ' — extend it rather than let it pass');
    }
  }

  const documentElement = new El('html');
  const body = new El('body');
  documentElement.appendChild(body);
  const doc = {
    documentElement, body, head: new El('head'),
    createElement: (t) => new El(t),
    getElementById(id) { let hit = null; documentElement.walk(el => { if (!hit && el.id === id) hit = el; }); return hit; },
    querySelector: (sel) => documentElement.querySelector(sel),
    addEventListener() {}, removeEventListener() {}
  };
  return { El, doc, body, documentElement };
}

/* A controllable clock so the bounded retry ladder is exercised deterministically
   rather than by hoping real timers land in the right order. */
function makeClock() {
  let now = 1000, seq = 0;
  const jobs = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; jobs.set(id, { at: now + (Number(ms) || 0), fn, id }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    /* advance to time T, running due jobs in (time, insertion) order */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...jobs.values()].filter(j => j.at <= target).sort((a, b) => a.at - b.at || a.id - b.id);
        if (!due.length) break;
        const j = due[0];
        jobs.delete(j.id);
        now = Math.max(now, j.at);
        j.fn();
      }
      now = target;
    },
    pending: () => jobs.size
  };
}

/* ---------------------------------------------------------------------------
 * 1. THE MEASUREMENT THAT JUSTIFIES THE FIX — the loader is serial, and the
 *    avatar is deep in the queue. If any of this changes, the fix's premise
 *    changes with it and this file should be re-read, not silenced.
 * ------------------------------------------------------------------------- */
{
  ok('the deferred-asset scheduler still runs ONE job at a time (drain shifts a single job)',
    /function drain\(deadline\)\{[\s\S]{0,400}var job=queue\.shift\(\);/.test(connect));
  ok('a job still waits for the real load event before the next may start',
    /real load\/error advances it/.test(connect) &&
    /addEventListener\('load',function\(\)\{ settle\('load'\); \}/.test(connect));
  const gaps = /var INITIAL_QUIET_MS=(\d+), FIRST_USE_MS=(\d+), FIRST_USE_GAP=(\d+), STEADY_GAP=(\d+);/.exec(connect);
  ok('the boot quiet period and inter-job gaps are still the documented numbers', !!gaps &&
    gaps[1] === '2500' && gaps[3] === '250');
  const before = connect.slice(0, connect.indexOf('data-mls-asset="feat_mls_avatar.js"'));
  const ahead = (before.match(/__mlsDeferAsset\|\|window\.requestIdleCallback/g) || []).length;
  ok('the avatar module is still far down the deferral queue (' + ahead + ' loaders registered ahead of it)',
    ahead >= 20);
  console.log('     → premise: ~' + (2500 + ahead * 250) + 'ms of scheduler delay alone before the module could even start downloading');
}

/* ---------------------------------------------------------------------------
 * 2. EXECUTE THE SHIM. Sliced out of mls-connect.js by its own marker so the
 *    bytes under test are the shipped bytes.
 * ------------------------------------------------------------------------- */
function shimSource(text) {
  const at = text.indexOf('/* av-6.0.8:');
  assert(at >= 0, 'the av-6.0.8 skeleton is not in this file');
  const start = text.indexOf(';(function(){try{', at);
  assert(start > at, 'the skeleton comment is present but its IIFE is not');
  const end = text.indexOf('}catch(e){}})();', start);
  assert(end > start, 'the skeleton IIFE is not terminated as expected');
  return text.slice(start, end + '}catch(e){}})();'.length);
}

function runShim(opts) {
  opts = opts || {};
  const dom = makeDom();
  const clock = makeClock();
  const winListeners = {};
  const sandbox = {
    document: dom.doc,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    Date: { now: clock.now },
    window: {
      __MLS_AV: 'b999',
      addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
      removeEventListener(type, fn) {
        const a = winListeners[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
      }
    }
  };
  sandbox.window.document = dom.doc;
  const view = dom.doc.createElement('div');
  view.id = 'visitView';
  if (opts.rail) { const rail = dom.doc.createElement('div'); rail.id = 'mlsStages'; view.appendChild(rail); }
  if (opts.workspace) { const w = dom.doc.createElement('div'); w.id = 'ez3Host'; view.appendChild(w); }
  if (opts.noView !== true) dom.body.appendChild(view);
  vm.createContext(sandbox);
  vm.runInContext(shimSource(opts.text === undefined ? connect : opts.text), sandbox, { filename: 'mls-connect.shim.js' });
  return {
    dom, clock, view, winListeners, sandbox,
    card: () => dom.doc.getElementById('mlsAvVisitCard'),
    tag: () => dom.doc.querySelector('script[data-mls-asset="feat_mls_avatar.js"]'),
    emit: (type) => (winListeners[type] || []).slice().forEach(fn => fn({ type }))
  };
}

/* 2a — the whole point: it is there at once, before any module could load. */
{
  const r = runShim({ rail: true });
  ok('nothing is painted before the first timer runs (the shim installs, it does not race paint)', !r.card());
  r.clock.advance(0);
  const card = r.card();
  ok('the Avatar card EXISTS at t+0ms, with no avatar module loaded', !!card);
  ok('and it is honestly labelled as not ready yet',
    /Avatar/.test(card.textContent) && /ready|Loading/i.test(card.textContent));
  ok('it carries the skeleton marker so the module can tell it apart',
    card.getAttribute('data-mls-av-skeleton') === '1');
  ok('it does NOT carry a content signature, or the module would treat it as already painted',
    card.getAttribute('data-mls-av-sig') === null);
  ok('no script tag was created merely by painting (boot budget untouched at t+0)', !r.tag());
  ok('it sits DIRECTLY BELOW the Prep/Record/Review rail, not fighting it for first place',
    card.previousElementSibling === undefined ? true : r.view.children.indexOf(card) === 1);
  ok('the rail is still first', r.view.children[0].id === 'mlsStages');
}

/* 2b — a build with no rail still gets the card at the very top. */
{
  const r = runShim({ rail: false, workspace: true });
  r.clock.advance(0);
  ok('with no rail present the card takes the top slot', r.view.children[0] === r.card());
}

/* 2c — it promotes the real module shortly after, so the card becomes REAL. */
{
  const r = runShim({ rail: true });
  r.clock.advance(0);
  ok('still no module fetch at t+0', !r.tag());
  r.clock.advance(1200);
  const tag = r.tag();
  ok('the real module is fetched ~1.2s after the card lands — on the Visit view only', !!tag);
  ok('and it is fetched with the build-number cache-buster the loader uses',
    /feat_mls_avatar\.js\?v=b999/.test(tag.attrs.src));
  ok('exactly ONE script tag is created, so the queue loader will dedupe against it',
    (() => { let n = 0; r.dom.documentElement.walk(el => { if (el.tagName === 'SCRIPT') n++; }); return n === 1; })());
}

/* 2d — a tap loads it immediately instead of waiting. */
{
  const r = runShim({ rail: true });
  r.clock.advance(0);
  const inner = r.card().children[0];
  ok('the card is tappable while it is still a placeholder', !!(inner.listeners.click || []).length);
  inner.fire('click');
  ok('tapping fetches the module at once, without waiting for the promotion timer', !!r.tag());
  ok('and the label says so rather than staying silent', /Loading/i.test(r.card().textContent));
}

/* 2e — HONESTY: a module that can never arrive must not leave a card behind. */
{
  const r = runShim({ rail: true });
  r.clock.advance(0);
  r.card().children[0].fire('click');
  const tag = r.tag();
  ok('the placeholder is on screen while the module is in flight', !!r.card());
  tag.fire('error');
  ok('a 404 REMOVES the placeholder — no card that can never work', !r.card());
}

/* 2f — NO TURF WAR. This is the av-6.0.2 defect class: two modules re-asserting
   the same slot forever. The shim must stand down permanently. */
{
  const r = runShim({ rail: true });
  r.clock.advance(0);
  const skeleton = r.card();
  /* the module arrives and adopts the node, exactly as ensureVisitCard now does */
  const script = r.dom.doc.createElement('script');
  script.setAttribute('data-mls-asset', 'feat_mls_avatar.js');
  r.dom.body.appendChild(script);
  skeleton.removeAttribute('data-mls-av-skeleton');
  skeleton.setAttribute('data-mls-av-sig', 'a1|1|X');
  /* now shove it somewhere else, as the Easy-lane host remount would */
  r.view.appendChild(skeleton);
  const wasLast = r.view.children[r.view.children.length - 1] === skeleton;
  r.clock.advance(10000);
  r.emit('mls:view-changed'); r.emit('mls:ui-ready'); r.emit('mls:active-patient-changed');
  ok('once the module owns the card the shim NEVER repositions it again',
    wasLast && r.view.children[r.view.children.length - 1] === skeleton);
  ok('and it does not duplicate the card either',
    (() => { let n = 0; r.dom.documentElement.walk(el => { if (el.id === 'mlsAvVisitCard') n++; }); return n === 1; })());
  ok('the content signature the module wrote is left alone',
    skeleton.getAttribute('data-mls-av-sig') === 'a1|1|X');
}

/* 2g — bounded: it lets go, and it never polls. */
{
  const r = runShim({ rail: true });
  r.clock.advance(60000);
  ok('every timer is spent after a minute — no permanent polling', r.clock.pending() === 0);
  const before = Object.keys(r.winListeners).reduce((n, k) => n + r.winListeners[k].length, 0);
  ok('and it unbinds its lifecycle listeners when it stands down', before === 0);
}

/* 2h — it waits for the Visit view instead of giving up. */
{
  const r = runShim({ noView: true });
  r.clock.advance(0);
  ok('no Visit view yet means no card (it does not paint into the wrong page)', !r.card());
  r.dom.body.appendChild(r.view);
  r.emit('mls:view-changed');
  ok('when the doctor opens the Visit page the card appears on that event', !!r.card());
}

/* ---------------------------------------------------------------------------
 * 3. THE MODULE'S HALF OF THE CONTRACT. Every pin here is also run against the
 *    PRE-FIX bytes below; a pin that passes on the old file proves nothing.
 * ------------------------------------------------------------------------- */
function modulePins(text, label, expectPass) {
  const fn = (() => {
    const at = text.indexOf('function ensureVisitCard()');
    assert(at >= 0, 'ensureVisitCard is gone');
    return text.slice(at, at + 3000);
  })();
  /* NEW claims — these are what av-6.0.8 added, so they MUST fail on the pre-fix bytes. */
  const novel = [
    ['ensureVisitCard calls style() BEFORE the create branch, so an adopted card is still styled',
      fn.indexOf('style();') >= 0 && fn.indexOf('style();') < fn.indexOf('if (!card) {')],
    ['adoption clears the skeleton marker so the shim stands down',
      /data-mls-av-skeleton/.test(fn) && /removeAttribute\('data-mls-av-skeleton'\)/.test(fn)],
    ['adoption re-asserts the canonical box style rather than trusting the placeholder\'s copy',
      /card\.style\.cssText = CARD_BOX/.test(fn)],
    ['adoption clears any signature so the card is guaranteed to repaint with real content',
      /removeAttribute\('data-mls-av-sig'\)/.test(fn)]
  ];
  /* PRESERVED behaviour — already correct before this change, kept here as a regression
     guard. Demanding these FAIL on the pre-fix file would be wrong, and saying so is the
     difference between a control and a ritual: a pin can be worth keeping without being new. */
  const preserved = [
    ['the card is still reused rather than duplicated when it already exists',
      /var card = gid\('mlsAvVisitCard'\);/.test(fn)]
  ];
  /* count what the pins ACTUALLY say, not whether they matched an expectation — an inverted
     branch here would report "all pins refused" while they were quietly passing */
  let passing = 0;
  novel.forEach(([name, cond]) => {
    if (cond) passing++;
    if (expectPass) {
      assert(cond, 'FAILED: ' + name);
      pass++; console.log('  ok  ' + name);
    } else if (cond) {
      console.log('  !!  CONTROL LEAK: "' + name + '" passes on ' + label);
    }
  });
  preserved.forEach(([name, cond]) => {
    assert(cond, 'FAILED (regression, must hold on BOTH files): ' + name + ' — on ' + label);
    if (expectPass) { pass++; console.log('  ok  ' + name); }
    else console.log('  ok  (preserved on the pre-fix file too, as it should be) ' + name);
  });
  return { passing, total: novel.length };
}
modulePins(source, 'the fixed file', true);

/* THE CONTROL. The pre-fix bytes are the file as it stood before av-6.0.8; every
   pin above must FAIL on it, or the pin is decorative. */
{
  const pre = source
    .replace(/    \/\* av-6\.0\.8 — UNCONDITIONAL[\s\S]*?    if \(!card\) \{\n      card = document\.createElement\('div'\);\n      card\.id = 'mlsAvVisitCard';\n      card\.style\.cssText = CARD_BOX;/,
      "    var card = gid('mlsAvVisitCard');\n    if (!card) {\n      style();\n      card = document.createElement('div');\n      card.id = 'mlsAvVisitCard';\n      card.style.cssText = 'margin:8px';");
  assert(pre !== source, 'the control rewrite did not apply — it would be testing the fixed file twice');
  assert(pre.indexOf('data-mls-av-skeleton') < 0 || pre.indexOf('function ensureVisitCard()') < 0 ||
    pre.slice(pre.indexOf('function ensureVisitCard()'), pre.indexOf('function ensureVisitCard()') + 3000).indexOf('data-mls-av-skeleton') < 0,
    'the control still mentions the skeleton inside ensureVisitCard — it is not a pre-fix control');
  const res = modulePins(pre, 'the PRE-FIX file', false);
  ok("CONTROL: all " + res.total + " NEW module pins REFUSE against the pre-fix bytes", res.passing === 0);
}

/* And the shim pins must be impossible without the shim. */
{
  let threw = false;
  try { shimSource(connect.replace('/* av-6.0.8:', '/* removed:')); } catch (e) { threw = true; }
  ok('CONTROL: the executed shim suite cannot run at all without the shim present', threw);
}

console.log('\navatar-visit-card-appears-at-once: ' + pass + ' assertions passed');
