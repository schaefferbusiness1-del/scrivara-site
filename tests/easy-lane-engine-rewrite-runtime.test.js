'use strict';

/* Runtime regression for the visit-transcript flicker root cause.
 *
 * The active first-guard Easy engine (v3.7.1, window.__mlsEasyV32) rebuilds
 * #ez3Wrap with `innerHTML = h` on nearly every click. The canonical easy
 * lane `.ez3fl-record` (including #ez3flTranscript) is mounted INSIDE that
 * subtree, so every rewrite used to destroy it; a satellite observer
 * recreated it ~150ms later — a visible flicker that could also detach an
 * active Dictate target and drop speech results.
 *
 * This test extracts the engine's real setWrapHtml owner from the shipped
 * bundle and forces engine innerHTML rewrites against a DOM simulation,
 * proving:
 *   - the textarea node identity is unchanged across a rewrite;
 *   - its value, focus, and selection survive;
 *   - the lane never disappears after the rewrite completes (the detach and
 *     reinsert happen inside one synchronous call — no observable gap);
 *   - an active Dictate target remains connected;
 *   - only one transcript lane exists;
 *   - the Staff screen and row2-less screens deliberately PARK the node and
 *     the next doctor-screen render remounts the SAME node.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');

/* ---- locate the ACTIVE engine (first-guard __mlsEasyV32 v3.7.1) ---- */
const verAt = source.indexOf("var VER = '3.7.1'");
assert(verAt >= 0, 'active easy engine v3.7.1 marker is missing');
const engineEnd = source.indexOf('MLS Easy v3.2 reverted', verAt);
assert(engineEnd > verAt, 'active engine end boundary not found');
const engine = source.slice(verAt, engineEnd);

/* every active-engine screen render must route through the lane-preserving
   owner; a bare `wrap().innerHTML = h` would reintroduce the flicker */
assert.strictEqual((engine.match(/setWrapHtml\(h, true\);/g) || []).length, 3,
  'home/choose/doctor renders do not all use the lane-preserving rewrite');
assert.strictEqual((engine.match(/setWrapHtml\(h, false\);/g) || []).length, 1,
  'the staff render does not deliberately park the lane');
assert(!engine.includes('wrap().innerHTML = h;'),
  'an active-engine render still bypasses the lane-preserving rewrite');

/* ---- extract the real setWrapHtml + its keep slot from the bundle ---- */
const keepAt = source.indexOf('var _flowLaneKeep = null;');
assert(keepAt >= 0 && keepAt < source.indexOf('function setWrapHtml'), 'lane keep slot missing');
const fnStart = source.indexOf('function setWrapHtml(h, laneAllowed) {', keepAt);
assert(fnStart > keepAt, 'setWrapHtml owner missing from the active engine');
/* slice to the function's closing brace at two-space indentation */
const fnEnd = source.indexOf('\n  }\n', fnStart);
assert(fnEnd > fnStart, 'setWrapHtml end not found');
const ownerSource = source.slice(keepAt, fnEnd + 4);

/* ---- DOM simulation ---- */
function makeDom() {
  const doc = { activeElement: null };
  function node(cls, tag) {
    return {
      className: cls || '', tagName: (tag || 'div').toUpperCase(), parentNode: null,
      children: [],
      get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === wrapRoot; },
      contains(el) {
        if (el === this) return true;
        return this.children.some(c => c === el || (c.contains && c.contains(el)));
      },
      querySelector(sel) {
        const cls2 = sel.startsWith('.') ? sel.slice(1) : null;
        const walk = (n) => {
          for (const c of n.children) {
            if (cls2 && String(c.className).split(/\s+/).includes(cls2)) return c;
            const hit = walk(c);
            if (hit) return hit;
          }
          return null;
        };
        return walk(this);
      },
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
      insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c);
        const i = this.children.indexOf(ref);
        assert(i >= 0, 'insertBefore reference is not a child');
        c.parentNode = this; this.children.splice(i, 0, c); return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        assert(i >= 0, 'removeChild target is not a child');
        this.children.splice(i, 1); c.parentNode = null; return c;
      }
    };
  }
  const wrapRoot = node('', 'root'); /* stands in for the connected document */
  const wrap = node('ez3-wrap');
  wrapRoot.appendChild(wrap);
  let html = '';
  Object.defineProperty(wrap, 'innerHTML', {
    set(h) {
      html = h;
      this.children.splice(0).forEach(c => { c.parentNode = null; });
      /* the engine screen html is opaque to this test; only .ez3-row2
         placement matters for the lane contract */
      if (h.indexOf('ez3-row2') !== -1) {
        this.appendChild(node('ez3-row2'));
        this.appendChild(node('ez3-status'));
      } else {
        this.appendChild(node('ez3-other'));
      }
    },
    get() { return html; }
  });
  return { doc, node, wrap, wrapRoot };
}

function buildOwner(dom) {
  /* instantiate the shipped owner with the engine's free variables bound */
  // eslint-disable-next-line no-new-func
  const factory = new Function('wrap', 'document', ownerSource + '\n  return setWrapHtml;');
  return factory(() => dom.wrap, dom.doc);
}

const dom = makeDom();
const setWrapHtml = buildOwner(dom);

/* mount the lane the way the flow module does: inside wrap before .ez3-row2 */
dom.wrap.innerHTML = '<div class="home"><div class="ez3-row2"></div></div>';
const lane = dom.node('ez3fl-record');
const textarea = dom.node('ez3fl-tx', 'textarea');
textarea.value = 'Patient states the knee pain started two weeks ago.';
textarea.selectionStart = 8;
textarea.selectionEnd = 14;
textarea.selectionDirection = 'forward';
let focusCalls = 0;
textarea.focus = function () { focusCalls++; dom.doc.activeElement = textarea; };
textarea.setSelectionRange = function (s, e, d) { this.selectionStart = s; this.selectionEnd = e; this.selectionDirection = d; };
lane.appendChild(textarea);
dom.wrap.insertBefore(lane, dom.wrap.querySelector('.ez3-row2'));
dom.doc.activeElement = textarea;

/* a live Dictate session bound to the textarea checks connectivity the same
   way the shipped module does: document.contains(target) */
const dictateTargetConnected = () => textarea.isConnected;

/* ---- 1. force repeated engine innerHTML rewrites (home screen) ---- */
for (let pass = 0; pass < 5; pass++) {
  setWrapHtml('<div class="home rerender-' + pass + '"><div class="ez3-row2"></div></div>', true);
  const lanes = dom.wrap.children.filter(c => c.className === 'ez3fl-record');
  assert.strictEqual(lanes.length, 1, 'exactly one transcript lane must exist after a rewrite');
  assert.strictEqual(lanes[0], lane, 'the transcript lane node identity changed across an engine rewrite');
  assert(lane.isConnected, 'the transcript lane disappeared after an engine rewrite');
  assert.strictEqual(dom.wrap.children.indexOf(lane), dom.wrap.children.indexOf(dom.wrap.querySelector('.ez3-row2')) - 1,
    'the lane lost its visual position before .ez3-row2');
  assert.strictEqual(textarea.value, 'Patient states the knee pain started two weeks ago.', 'transcript value was lost');
  assert.strictEqual(dom.doc.activeElement, textarea, 'textarea focus was lost across the rewrite');
  assert.strictEqual(textarea.selectionStart, 8, 'selection start was lost');
  assert.strictEqual(textarea.selectionEnd, 14, 'selection end was lost');
  assert(dictateTargetConnected(), 'an active Dictate target was disconnected by the rewrite');
}
assert(focusCalls >= 5, 'focus was not restored synchronously in the same turn');

/* ---- 2. row2-less screen (Choose patient) parks the node ---- */
setWrapHtml('<div class="choose-list"></div>', true);
assert(!lane.isConnected, 'the lane must not float on a screen with no action row');
assert.strictEqual(dom.wrap.children.filter(c => c.className === 'ez3fl-record').length, 0);

/* returning to a doctor screen remounts the SAME node with its value */
dom.doc.activeElement = null;
setWrapHtml('<div class="home"><div class="ez3-row2"></div></div>', true);
assert(lane.isConnected, 'the parked lane did not remount on the next doctor screen');
assert.strictEqual(dom.wrap.querySelector('.ez3fl-record'), lane, 'a different lane node was mounted after parking');
assert.strictEqual(textarea.value, 'Patient states the knee pain started two weeks ago.', 'parked transcript value was lost');

/* ---- 3. a real Staff transition removes the lane deliberately ---- */
setWrapHtml('<div class="staff"><div class="ez3-row2"></div></div>', false);
assert(!lane.isConnected, 'the staff screen must not show the doctor recording lane');
/* and the doctor return still restores the same node */
setWrapHtml('<div class="home"><div class="ez3-row2"></div></div>', true);
assert.strictEqual(dom.wrap.querySelector('.ez3fl-record'), lane, 'the doctor return lost the exact lane node after Staff');

/* ---- 4. a lane created fresh by the flow module wins over a stale parked node ---- */
setWrapHtml('<div class="choose-list"></div>', true); /* parks `lane` */
const freshLane = dom.node('ez3fl-record');
dom.wrap.innerHTML = '<div class="home"><div class="ez3-row2"></div></div>';
dom.wrap.insertBefore(freshLane, dom.wrap.querySelector('.ez3-row2'));
setWrapHtml('<div class="home"><div class="ez3-row2"></div></div>', true);
const finalLanes = dom.wrap.children.filter(c => c.className === 'ez3fl-record');
assert.strictEqual(finalLanes.length, 1, 'a stale parked lane resurrected next to a live lane');
assert.strictEqual(finalLanes[0], freshLane, 'the live lane must win over the stale parked node');

console.log('PASS easy lane engine rewrite: node identity, value/focus/selection, single-lane, dictate connectivity, and staff/choose parking survive real innerHTML rewrites');
