'use strict';
/* =========================================================================
   THE VISIT PROGRESS RAIL FILLS, AND FILLING COSTS NOTHING WHEN NOTHING MOVED
   -------------------------------------------------------------------------
   OWNER, on a screenshot of the rail reading "○ Prep · Record · Review ·
   Sign · Send":  "this progress bar should fill very beautifully each circle
   as a visit goes on."

   What he was looking at was not a missing feature, it was an invisible one.
   The rail already drew a circle per stage — a 1.6px #D6DED9 ring on white at
   15px, next to a --muted 12.5px label. Only the CURRENT dot carried a green
   halo, so only the current dot read as a circle at all, and "done" differed
   from "still to come" by a 3% scale change. The rail could not answer the one
   question a progress rail exists to answer: how far along am I.

   So this suite pins the ANSWER, in three parts:

     1. THE PICTURE. Five stages, three states — complete (filled, with a drawn
        check), current (filled, ringed, scaled), upcoming (hollow, muted) —
        with the current index driving all three, completed stages STAYING
        filled, and the connector fill a pure function of the stage index.

     2. THE STATE IS NOT COLOUR. aria-current="step" on exactly one stage, and
        a visually-hidden word per stage, because the check is the only visual
        signal that is not colour and it belongs to one state of three.

     3. THE COST. This module reacts to #visitView mutations, and #visitView
        churns on every transcript chunk — the shell was measured at ~3 full
        passes per second on the owner's screen, 605 of which were no-op
        aria-current writes in 40 seconds. So the rail is WRITE-ONLY-ON-CHANGE
        and that is proved by EXECUTION, not by grep: the shipped stage region
        is run in a counting stub DOM and an unchanged re-render must not touch
        a single node.

   Why counting "ops" and not just "mutations": classList.toggle(name, force)
   does not re-commit when the state already matches, so a rail with NO guard
   at all would still report zero effective mutations on an unchanged pass and
   a mutation-only counter would call that a pass. The harness therefore counts
   every CALL into a mutating API as well, so a guard that stopped guarding is
   visible as 10 no-op toggles rather than as silence. Both counters are
   negative-tested below in both directions — the memory rule for this repo is
   that a probe reporting ABSENCE must first be shown able to see PRESENCE.
   ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(ROOT, 'feat_mls_calm_shell.js'), 'utf8');

/* ======================================================== PART 1: THE CSS ===
   Read as flattened string literals, because this stylesheet is CONCATENATED
   from an array and a naive grep across the source sees selectors that are
   split over three array entries as three different things. */

/* Comments are stripped FIRST. This file explains its CSS at length and one
   ASCII apostrophe inside a comment opens a phantom string literal that
   swallows every rule after it — measured while writing this suite: the rail
   block flattened to the first three rules plus 1.3KB of prose, and the
   assertions below reported a correctly-filled circle as hollow. A scanner
   that reads a stylesheet as string literals must not read the prose. */
function flatten(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return (code.match(/'(?:[^'\\]|\\.)*'/g) || []).map((s) => s.slice(1, -1)).join('');
}

const cssArrayStart = shell.search(/var CSS\s*=\s*\[/);
const cssArrayEnd = shell.indexOf("].join('');", cssArrayStart);
assert.ok(cssArrayStart > -1 && cssArrayEnd > cssArrayStart, 'could not bound the calm shell CSS array');
const cssFlat = flatten(shell.slice(cssArrayStart, cssArrayEnd));

const railStart = shell.indexOf('/* stages ');
const railEnd = shell.indexOf('/* activity bar', railStart);
assert.ok(railStart > -1 && railEnd > railStart, 'could not bound the stage rail CSS block');
const railCss = flatten(shell.slice(railStart, railEnd));
assert.ok(railCss.length > 400,
  'the stage rail CSS flattened to only ' + railCss.length + ' characters — the literal ' +
  'extraction broke, and every assertion below would then be checking an empty string');

/* --- the three states, each legible without colour ----------------------- */

assert.ok(/#mlsStages \.st \.dot\{[^}]*background:#fff/.test(railCss) &&
          /#mlsStages \.st \.dot\{[^}]*border:1\.6px solid #D6DED9/.test(railCss),
  'UPCOMING is no longer a hollow outline on white — the base .dot must stay unfilled, ' +
  'or "not started" and "done" become the same picture');

assert.ok(/#mlsStages \.st\.done \.dot\{[^}]*background:#2E6A4B/.test(railCss) &&
          /#mlsStages \.st\.done \.dot\{[^}]*border-color:#2E6A4B/.test(railCss),
  'COMPLETE must be a FILLED disc. The owner asked for the circles to fill; a completed ' +
  'stage that stays hollow is the exact thing he screenshotted.');

assert.ok(/#mlsStages \.st\.done \.dot svg\{[^}]*opacity:1/.test(railCss),
  'the check does not appear on a completed stage — the check is the only signal on this ' +
  'rail that is not colour, so without it "complete" and "current" differ by hue alone');
assert.ok(/#mlsStages \.st \.dot svg\{[^}]*opacity:0/.test(railCss),
  'the check is visible on every stage, including the ones not yet reached');

assert.ok(/#mlsStages \.st\.now \.dot\{[^}]*background:#2E6A4B/.test(railCss),
  'CURRENT must be filled as well as ringed — ringed alone left the "you are here" mark ' +
  'lighter than every stage behind it, which is what the owner was looking at');
assert.ok(/#mlsStages \.st\.now \.dot\{[^}]*box-shadow:0 0 0 4px rgba\(46,106,75,\.14\)/.test(railCss),
  'the current stage lost its halo ring — filled alone is indistinguishable from complete ' +
  'for anyone who cannot make out the check');
assert.ok(/#mlsStages \.st\.now \.dot\{[^}]*transform:scale\(1\.15\)/.test(railCss),
  'the current stage is no longer emphasised by scale');

/* --- the connecting track fills, and fills without a reflow -------------- */

assert.ok(/#mlsStages \.bar\{[^}]*background:#E7E5DD/.test(railCss),
  'the connecting track lost its unfilled bed — a fill with nothing behind it reads as ' +
  'four disconnected circles');
assert.ok(/#mlsStages \.bar i\{[^}]*transform:scaleX\(0\)/.test(railCss),
  'the connector fill no longer starts empty');
assert.ok(/#mlsStages \.bar i\{[^}]*transform-origin:left center/.test(railCss),
  'the fill must grow from the LEFT edge, or the track fills backwards out of the stage ' +
  'the visit is heading towards');
assert.ok(!/#mlsStages[^}]*transition:[^}]*\b(width|height|top|left|right|bottom|margin|padding|font-size)\b/.test(railCss),
  'the rail transitions a layout-triggering property. It animated `width` once already; ' +
  'that is a reflow every frame, on the screen a doctor is dictating into.');

/* --- one vocabulary: no fourteenth hand-picked duration ------------------ */

const rawTimings = railCss.match(/\b\d+(?:\.\d+)?m?s\b/g) || [];
assert.deepStrictEqual(rawTimings, [],
  'the rail declares raw timing value(s) ' + rawTimings.join(', ') + '. Every duration and ' +
  'delay here must reference var(--mls-dur-*): this file already paid for a motion system ' +
  'with 14 durations and 9 easings, and a new number is how that comes back.');
['--mls-dur-1', '--mls-dur-2', '--mls-dur-3', '--mls-dur-4'].forEach((tok) => {
  assert.ok(railCss.includes('var(' + tok + ')'),
    'the rail no longer uses the motion token ' + tok);
});
assert.ok(/transition:transform var\(--mls-dur-4\) var\(--mls-ease-out\)/.test(railCss),
  'the connector fill must run on dur-4 (420ms) ease-out — calm and arriving, not bouncy');

/* --- the app's own palette, no new accent -------------------------------- */

const ALLOWED = ['#2E6A4B', '#204034', '#4A5B51', '#D6DED9', '#E7E5DD', '#fff'];
const hexes = [...new Set(railCss.match(/#[0-9a-fA-F]{3,6}\b/g) || [])];
assert.ok(hexes.length > 0, 'no colours found in the rail CSS — the extraction is broken');
hexes.forEach((h) => {
  assert.ok(ALLOWED.indexOf(h) > -1,
    'the rail introduces the colour ' + h + '. The rail must reuse the shell\'s existing ' +
    'greens (' + ALLOWED.join(', ') + '); a new accent here is a second palette.');
});

/* --- reduced motion: every state stays correct, the motion goes ---------- */

const RM_RULE = '#mlsStages .st .dot,#mlsStages .st .dot svg,#mlsStages .bar i{transition:none!important}';
const rmAt = cssFlat.indexOf(RM_RULE);
assert.ok(rmAt > -1,
  'there is no reduced-motion rule for the stage rail. The blanket ' +
  '`*{transition-duration:1ms!important}` shortens DURATIONS only — the 200ms delay on the ' +
  'check and the 120ms delay on the disc colour both survive it, so a doctor who asked the ' +
  'OS for less motion would still watch the rail light up in pieces.');
{
  const open = cssFlat.lastIndexOf('@media (prefers-reduced-motion: reduce){', rmAt);
  assert.ok(open > -1, 'the stage rail reduced-motion rule is not inside a reduced-motion query at all');
  let depth = 0;
  for (const ch of cssFlat.slice(open + '@media (prefers-reduced-motion: reduce){'.length, rmAt)) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  assert.strictEqual(depth, 0,
    'the stage rail reduced-motion rule has drifted out of its @media block (depth ' + depth +
    '). This file has already shipped an entire motion system stranded inside the wrong ' +
    'query for six builds; grep could not see it and neither can a reader.');
}

/* ==================================================== PART 2: THE RUNTIME ===
   The SHIPPED stage region, executed. Repo convention: no jsdom — a hand-rolled
   DOM, because the thing under test here is which calls the module makes, and a
   counting stub is the only DOM that can answer that. */

const START = shell.indexOf("  var STAGES = ['Prep'");
const END = shell.indexOf('  /* ------------------------------------------------------------- heads-down */');
assert.ok(START > -1 && END > START, 'could not bound the stage region of the calm shell');
const region = shell.slice(START, END);
['function stageNow', 'function ensureStages', 'function buildStages',
 'function paintStages', 'function renderStages', 'function stageSig'].forEach((f) => {
  assert.ok(region.includes(f), 'the stage region no longer contains ' + f);
});

/* ---- selector engine (only what the module actually asks for) ----------- */

function descendants(node, out) {
  for (const c of node.childNodes) {
    if (c.nodeType === 1) { out.push(c); descendants(c, out); }
  }
  return out;
}
function matchSimple(node, sel) {
  if (node.nodeType !== 1) return false;
  if (sel[0] === '.') return node.__classes.has(sel.slice(1));
  const attr = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(sel);
  if (attr) {
    const v = node.getAttribute(attr[1]);
    return attr[2] === undefined ? v !== null : v === attr[2];
  }
  return node.tagName === sel.toUpperCase();
}
function queryAll(root, selector) {
  const found = [];
  for (const group of String(selector).split(',')) {
    const parts = group.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    let cur = [root];
    for (const p of parts) {
      const next = [];
      for (const n of cur) {
        for (const d of descendants(n, [])) if (matchSimple(d, p) && next.indexOf(d) === -1) next.push(d);
      }
      cur = next;
    }
    for (const n of cur) if (found.indexOf(n) === -1) found.push(n);
  }
  return found;
}
function byId(root, id) {
  for (const d of descendants(root, [])) if (d.__id === id) return d;
  return null;
}

/* ---- the counting DOM --------------------------------------------------- */

function makeHarness() {
  const stats = {
    ops: 0,          /* every CALL into a mutating API, effective or not */
    mutations: 0,    /* calls that actually changed something */
    log: [],
    reset() { this.ops = 0; this.mutations = 0; this.log = []; },
    snapshot() { return { ops: this.ops, mutations: this.mutations, log: this.log.slice() }; }
  };
  function op(kind, changed) {
    stats.ops++;
    if (changed) stats.mutations++;
    stats.log.push((changed ? 'WRITE ' : 'op    ') + kind);
  }

  function makeText(v) { return { nodeType: 3, nodeValue: String(v), parentNode: null, childNodes: [] }; }
  function textOf(node) {
    if (node.nodeType === 3) return node.nodeValue;
    return node.childNodes.map(textOf).join('');
  }

  function makeEl(tag, ns) {
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      namespaceURI: ns || 'http://www.w3.org/1999/xhtml',
      childNodes: [],
      parentNode: null,
      __classes: new Set(),
      __attrs: Object.create(null),
      __id: '',
      __visible: true
    };
    const rawStyle = {};
    node.style = new Proxy(rawStyle, {
      get(t, k) { return Object.prototype.hasOwnProperty.call(t, k) ? t[k] : ''; },
      set(t, k, v) {
        const changed = t[k] !== v;
        t[k] = v;
        op('style.' + String(k) + '=' + v, changed);
        return true;
      }
    });
    node.classList = {
      contains(n) { return node.__classes.has(n); },
      add(n) { const had = node.__classes.has(n); node.__classes.add(n); op('classList.add ' + n, !had); },
      remove(n) { const had = node.__classes.has(n); node.__classes.delete(n); op('classList.remove ' + n, had); },
      /* Browser-accurate: toggle(name, force) does NOT re-commit when the state
         already matches. The CALL is still an op, which is what lets this
         harness distinguish "the guard returned early" from "the guard is gone
         but every write happened to be a no-op". */
      toggle(n, force) {
        const has = node.__classes.has(n);
        const want = force === undefined ? !has : !!force;
        if (want === has) { op('classList.toggle ' + n + ' (no-op)', false); return has; }
        if (want) node.__classes.add(n); else node.__classes.delete(n);
        op('classList.toggle ' + n + '=' + want, true);
        return want;
      }
    };
    Object.defineProperty(node, 'className', {
      get() { return [...node.__classes].join(' '); },
      set(v) {
        const next = String(v).split(/\s+/).filter(Boolean);
        const changed = next.join(' ') !== [...node.__classes].join(' ');
        node.__classes = new Set(next);
        op('className=' + v, changed);
      }
    });
    Object.defineProperty(node, 'id', {
      get() { return node.__id; },
      set(v) { const changed = node.__id !== String(v); node.__id = String(v); op('id=' + v, changed); }
    });
    Object.defineProperty(node, 'firstChild', { get() { return node.childNodes[0] || null; } });
    Object.defineProperty(node, 'firstElementChild', {
      get() { return node.childNodes.filter((c) => c.nodeType === 1)[0] || null; }
    });
    Object.defineProperty(node, 'textContent', {
      get() { return textOf(node); },
      set(v) {
        const changed = textOf(node) !== String(v);
        node.childNodes.forEach((c) => { c.parentNode = null; });
        const t = makeText(v);
        t.parentNode = node;
        node.childNodes = [t];
        op('textContent=' + v, changed);
      }
    });
    node.getAttribute = (k) => (Object.prototype.hasOwnProperty.call(node.__attrs, k) ? node.__attrs[k] : null);
    node.setAttribute = (k, v) => {
      const changed = node.__attrs[k] !== String(v);
      node.__attrs[k] = String(v);
      op('setAttribute ' + k + '=' + v, changed);
    };
    node.removeAttribute = (k) => {
      const had = Object.prototype.hasOwnProperty.call(node.__attrs, k);
      delete node.__attrs[k];
      op('removeAttribute ' + k, had);
    };
    function detach(c) {
      if (!c.parentNode) return;
      const i = c.parentNode.childNodes.indexOf(c);
      if (i > -1) c.parentNode.childNodes.splice(i, 1);
      c.parentNode = null;
    }
    node.appendChild = (c) => { detach(c); c.parentNode = node; node.childNodes.push(c); op('appendChild', true); return c; };
    node.removeChild = (c) => { detach(c); op('removeChild', true); return c; };
    node.insertBefore = (c, ref) => {
      detach(c);
      c.parentNode = node;
      const i = ref ? node.childNodes.indexOf(ref) : -1;
      if (i > -1) node.childNodes.splice(i, 0, c); else node.childNodes.push(c);
      op('insertBefore', true);
      return c;
    };
    node.querySelectorAll = (s) => queryAll(node, s);
    node.querySelector = (s) => queryAll(node, s)[0] || null;
    return node;
  }

  const root = makeEl('body');
  const visit = makeEl('div');
  visit.id = 'visitView';
  root.appendChild(visit);
  visit.__controls = [];
  visit.__note = '';

  const D = {
    createElement: (t) => makeEl(t),
    createElementNS: (ns, t) => makeEl(t, ns),
    createTextNode: (t) => makeText(t)
  };
  const W = { __mlsCalmShell: { active: true } };

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function qs(sel, r) {
    const scope = r || root;
    if (sel[0] === '#') return byId(scope, sel.slice(1));
    return queryAll(scope, sel)[0] || null;
  }
  function qsa(sel, r) { return queryAll(r || root, sel); }
  function visible(el) { return !!el && el.__visible !== false; }
  /* The real findControl scans the view for a button whose derived label
     matches. Here the view carries its controls directly — stageNow's own
     logic is what is under test, not control discovery. */
  function findControl(spec) {
    return (visit.__controls || []).filter((c) => spec.label.test(c.label))[0] || null;
  }

  const sandbox = { D, W, qs, qsa, visible, findControl, safe, console };
  vm.createContext(sandbox);
  vm.runInContext(
    '(function(){' + region +
    '\nthis.api = { STAGES: STAGES, stageNow: stageNow, stageSig: stageSig, ' +
    'buildStages: buildStages, paintStages: paintStages, renderStages: renderStages, ' +
    'ensureStages: ensureStages };\n}).call(this)',
    sandbox,
    { filename: 'feat_mls_calm_shell.js#stages' }
  );

  return {
    api: sandbox.api,
    stats,
    visit,
    root,
    rail() { return byId(root, 'mlsStages'); },
    /* Drive the view into the shape stageNow READS. Nothing here tells the rail
       what stage to show — every scenario is asserted against stageNow's own
       verdict below, so a change to the detector shows up as a failure here
       rather than as a rail quietly showing a stage the view never claimed. */
    setStage(n) {
      visit.__visible = n >= 0;
      visit.__controls = [];
      visit.childNodes = visit.childNodes.filter((c) => c.tagName !== 'TEXTAREA');
      const long = 'Patient seen today, tolerating the plan well, no new concerns raised.';
      if (n === 1) visit.__controls = [{ label: 'Recording… Stop Visit' }];
      if (n >= 2) {
        const ta = makeEl('textarea');
        ta.value = long;
        visit.appendChild(ta);
      }
      if (n === 3) visit.__controls = [{ label: 'Sign & Close' }];
    }
  };
}

/* ---- readers over the rendered rail ------------------------------------- */

function stageStates(rail) {
  return queryAll(rail, '.st').map((st) => (
    st.__classes.has('done') ? 'complete' : (st.__classes.has('now') ? 'current' : 'upcoming')
  ));
}
function filledConnectors(rail) {
  return queryAll(rail, '.bar i').filter((i) => i.style.transform === 'scaleX(1)').length;
}
function srWords(rail) {
  return queryAll(rail, '.st').map((st) => (st.querySelector('.sr') || { textContent: null }).textContent);
}
function ariaCurrent(rail) {
  return queryAll(rail, '.st').map((st) => st.getAttribute('aria-current'));
}

/* ============================================ 1. ALL FIVE STAGES RENDER === */

{
  const h = makeHarness();
  /* Array.from, because STAGES was constructed inside the vm realm and its
     prototype is not this realm's Array — deepStrictEqual compares prototypes
     and would fail on two identical lists. */
  assert.deepStrictEqual(Array.from(h.api.STAGES), ['Prep', 'Record', 'Review', 'Sign', 'Send'],
    'the stage list changed — this rail is presentation for a workflow the app owns');
  h.setStage(0);
  h.api.renderStages();
  const rail = h.rail();
  assert.ok(rail, 'the rail did not mount inside #visitView');
  assert.strictEqual(queryAll(rail, '.st').length, 5,
    'the rail rendered ' + queryAll(rail, '.st').length + ' stages, not 5');
  assert.strictEqual(queryAll(rail, '.st .dot').length, 5,
    'every stage must own a real circle — the owner\'s screenshot showed four stages as ' +
    'plain grey text because only one dot was visible');
  assert.strictEqual(queryAll(rail, '.st .dot svg').length, 5,
    'every circle must carry the drawn check, hidden until the stage completes');
  assert.strictEqual(queryAll(rail, '.bar').length, 4,
    'there must be one connecting track between each pair of stages');
  assert.strictEqual(rail.getAttribute('role'), 'group', 'the rail lost role="group"');
  assert.strictEqual(rail.getAttribute('aria-live'), 'polite', 'the rail lost aria-live="polite"');
  assert.strictEqual(rail.getAttribute('aria-label'), 'Visit progress: Prep',
    'the rail must name the stage it is showing');
  queryAll(rail, '.bar').forEach((b) => {
    assert.strictEqual(b.getAttribute('aria-hidden'), 'true',
      'the connectors are decoration and must be hidden from the accessibility tree — the ' +
      'discs and the per-stage state text already carry the whole picture');
  });
}

/* ====== 2. STATES ARE EXACTLY complete/current/upcoming, INDEX-DRIVEN ==== */

const EXPECTED = {
  0: ['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
  1: ['complete', 'current', 'upcoming', 'upcoming', 'upcoming'],
  2: ['complete', 'complete', 'current', 'upcoming', 'upcoming'],
  3: ['complete', 'complete', 'complete', 'current', 'upcoming']
};

[0, 1, 2, 3].forEach((n) => {
  const h = makeHarness();
  h.setStage(n);
  /* The rail follows the stage the view was READ as. If stageNow's detection
     ever changes, this fails here rather than the rail quietly claiming a
     stage nobody produced evidence for. */
  assert.strictEqual(h.api.stageNow(), n,
    'the harness could not drive the real stageNow() to index ' + n +
    ' — it reported ' + h.api.stageNow() + ', so nothing below would be testing the rail');
  h.api.renderStages();
  const rail = h.rail();
  assert.deepStrictEqual(stageStates(rail), EXPECTED[n],
    'stage ' + n + ' painted ' + JSON.stringify(stageStates(rail)));
  /* Completed stages STAY filled. This is the whole of the owner's ask: the
     rail has to read as "how far along am I", not only "where am I". */
  assert.strictEqual(stageStates(rail).filter((s) => s === 'complete').length, n,
    'stage ' + n + ' should leave ' + n + ' completed circles filled behind it');
  assert.strictEqual(stageStates(rail).filter((s) => s === 'current').length, 1,
    'exactly one stage may be current');
});

/* Send (index 4) is presentation the detector does not yet produce — pinned so
   the last circle cannot be the one that never fills. */
{
  const h = makeHarness();
  h.setStage(3);
  h.api.renderStages();
  const rail = h.rail();
  h.api.paintStages(rail, 4, h.api.stageSig(4));
  assert.deepStrictEqual(stageStates(rail),
    ['complete', 'complete', 'complete', 'complete', 'current'],
    'the final stage cannot be reached by the painter');
}

/* ============ 3. THE FILL TRACK IS A FUNCTION OF THE STAGE INDEX ========= */

{
  const h = makeHarness();
  h.setStage(0);
  h.api.renderStages();
  const rail = h.rail();
  const connectors = queryAll(rail, '.bar i').length;
  const seen = [];
  for (let n = 0; n <= 4; n++) {
    h.api.paintStages(rail, n, h.api.stageSig(n));
    const filled = filledConnectors(rail);
    assert.strictEqual(filled, n,
      'at stage ' + n + ' the track fills ' + filled + ' of ' + connectors + ' connectors; ' +
      'the filled length must equal the stage index — connector i sits between stage i and ' +
      'stage i+1, so the fill is a pure function of how far the visit has come');
    seen.push(filled / connectors);
  }
  assert.deepStrictEqual(seen, [0, 0.25, 0.5, 0.75, 1],
    'the fill fraction is not index/connectors: ' + JSON.stringify(seen));
  /* And it un-fills, because a stage rail that can only go forward is a rail
     that lies the moment the view says otherwise. */
  h.api.paintStages(rail, 1, h.api.stageSig(1));
  assert.strictEqual(filledConnectors(rail), 1, 'the track cannot un-fill');
}

/* ================= 4. STATE IS NOT CONVEYED BY COLOUR ALONE ============== */

{
  const h = makeHarness();
  h.setStage(2);
  h.api.renderStages();
  const rail = h.rail();

  const marks = ariaCurrent(rail);
  assert.deepStrictEqual(marks, [null, null, 'step', null, null],
    'aria-current must mark EXACTLY ONE stage, and it must be the current one: ' +
    JSON.stringify(marks));
  assert.strictEqual(marks.filter((m) => m === 'step').length, 1,
    'aria-current="step" appears ' + marks.filter((m) => m === 'step').length + ' times');

  assert.deepStrictEqual(srWords(rail),
    ['completed', 'completed', 'current step', 'not started', 'not started'],
    'every stage must publish its state in words: ' + JSON.stringify(srWords(rail)));

  /* Moving on must MOVE the mark, not add a second one. */
  h.setStage(3);
  h.api.renderStages();
  assert.deepStrictEqual(ariaCurrent(rail), [null, null, null, 'step', null],
    'aria-current did not move cleanly to the new current stage');
  assert.deepStrictEqual(srWords(rail),
    ['completed', 'completed', 'completed', 'current step', 'not started'],
    'the visually-hidden state text did not follow the stage change');
  assert.strictEqual(rail.getAttribute('aria-label'), 'Visit progress: Sign',
    'the rail\'s own label did not follow the stage change');
}

/* ============ 5. WRITE-ONLY-ON-CHANGE, PROVED BY COUNTING WRITES ========= */

/* 5a. the guard exists in the shipped source (necessary, nowhere near enough) */
assert.ok(/function stageSig\(now\) \{ return now \+ ':' \+ STAGES\.length; \}/.test(shell),
  'the rail\'s write signature is gone. It must combine the stage index AND the stage ' +
  'count: the stage list is data, and a signature of the index alone leaves the old rail ' +
  'on screen forever the day STAGES grows.');
assert.ok(/if \(el\.__mlsStageSig === sig\) return;/.test(shell) &&
          /el\.__mlsStageSig = sig;/.test(shell),
  'paintStages lost either the signature COMPARE or the signature STORE. A signature that ' +
  'is read but never written never matches, so the short-circuit is dead and every pass ' +
  'repaints — and the compare left behind looks exactly like a working guard.');
assert.ok(/el\.__mlsStageSig = '';/.test(shell),
  'buildStages must clear the stamp it invalidated, or a rail whose children were emptied ' +
  'is rebuilt and then skipped by the paint guard — five hollow circles, forever');

/* The FIRST tier, pinned statically because it cannot be caught at runtime any
   more: with the signature guard in paintStages doing its job, deleting this
   line still produces zero DOM writes on an unchanged pass. That is defence in
   depth working as intended, and it is exactly why the line needs an assertion
   of its own — a guard whose removal is invisible is a guard that gets removed.
   It earns its place by skipping the signature compare and the label compare on
   every one of the ~3 passes a second this shell was measured at. */
assert.ok(/var built = el\.childNodes\.length > 0;\s*\n\s*if \(now === lastStage && built\) return;/.test(shell),
  'renderStages lost the lastStage short-circuit that sits in front of the paint. Both ' +
  'halves are required: `built` is read from the DOM because ensureStages hands back an ' +
  'EMPTY div when the rail was removed, so lastStage alone cannot know whether the nodes ' +
  'are there.');

/* Measured, and reported in the PASS line — a guard is worth what it saves, and
   that number belongs in the output rather than in a comment nobody re-measures. */
let firstRender = { ops: 0, mutations: 0 };
let unguardedOps = 0;

/* 5b. the harness can SEE writes. A counter that reports zero because it is
       broken is indistinguishable from a guard that works, and this repo has
       shipped that mistake: a probe reported ABSENCE and nobody proved it could
       have seen PRESENCE. */
{
  const h = makeHarness();
  h.setStage(0);
  h.stats.reset();
  h.api.renderStages();
  const first = h.stats.snapshot();
  assert.ok(first.mutations > 0 && first.ops > 0,
    'the counting DOM recorded ' + first.mutations + ' writes for a FIRST render that ' +
    'mounts a rail and paints five stages — the instrument is broken, not the code');
  assert.ok(first.log.some((l) => /appendChild/.test(l)), 'the harness cannot see node creation');
  assert.ok(first.log.some((l) => /setAttribute/.test(l)), 'the harness cannot see attribute writes');
  assert.ok(first.log.some((l) => /style\.transform/.test(l)), 'the harness cannot see style writes');
  firstRender = { ops: first.ops, mutations: first.mutations };

  /* 5c. THE ASSERTION THIS SUITE EXISTS FOR. #visitView churns on every
         transcript chunk and the shell renders in response, so an unchanged
         pass must touch nothing at all. */
  h.stats.reset();
  for (let i = 0; i < 50; i++) h.api.renderStages();
  const idle = h.stats.snapshot();
  assert.strictEqual(idle.mutations, 0,
    '50 unchanged renders performed ' + idle.mutations + ' DOM writes:\n  ' +
    idle.log.slice(0, 12).join('\n  '));
  assert.strictEqual(idle.ops, 0,
    '50 unchanged renders TOUCHED the rail ' + idle.ops + ' times without changing anything. ' +
    'Effective writes were zero only because classList.toggle(name, force) does not ' +
    're-commit; the calls themselves are still work on every external mutation, and this ' +
    'shell was measured at ~3 passes a second on the owner\'s visit screen.\n  ' +
    idle.log.slice(0, 12).join('\n  '));

  /* 5d. and the counter still fires the moment something really moves */
  h.stats.reset();
  h.setStage(1);
  h.api.renderStages();
  const moved = h.stats.snapshot();
  assert.ok(moved.mutations > 0,
    'a real stage change produced no DOM writes — the rail is now frozen, which is worse ' +
    'than the churn it was guarding against');
  assert.strictEqual(stageStates(h.rail())[1], 'current', 'the rail did not follow the change');
}

/* 5e. the guard is the SIGNATURE, not luck. Repainting the same index under a
       different signature must do the work — and that is also the measurement
       of what the guard saves: every one of those ops runs per pass without it. */
{
  const h = makeHarness();
  h.setStage(2);
  h.api.renderStages();
  const rail = h.rail();

  h.stats.reset();
  for (let i = 0; i < 10; i++) h.api.paintStages(rail, 2, h.api.stageSig(2));
  assert.strictEqual(h.stats.ops, 0,
    '10 direct paints at the same signature performed ' + h.stats.ops + ' operations — ' +
    'paintStages must be write-only-on-change in its own right, not only via renderStages');

  h.stats.reset();
  h.api.paintStages(rail, 2, 'forced-different-signature');
  const forced = h.stats.snapshot();
  assert.ok(forced.ops > 0,
    'a changed signature did not repaint — the guard is stuck shut and the rail can never ' +
    'update again');
  assert.strictEqual(forced.mutations, 0,
    'repainting the SAME stage index changed something, so the paint is not idempotent');
  assert.ok(forced.ops >= 10,
    'only ' + forced.ops + ' operations in an unguarded paint. That number is the per-pass ' +
    'cost the signature avoids, and it should be at least one toggle pair per stage.');
  unguardedOps = forced.ops;

  /* the rail is UPDATED, never rebuilt: a transition needs the same element to
     still be there when the value changes */
  const before = queryAll(rail, '.st');
  h.setStage(3);
  h.api.renderStages();
  const after = queryAll(rail, '.st');
  assert.strictEqual(before.length, after.length, 'the rail changed shape on a stage change');
  before.forEach((n, i) => {
    assert.strictEqual(n, after[i],
      'stage node ' + i + ' was REPLACED on a stage change. A CSS transition needs the same ' +
      'element to still be in the document when the value changes; replacing the nodes is ' +
      'how every transition on this rail became dead CSS once already.');
  });
}

console.log('PASS visit-stage-rail-fills: 5 stages render as complete/current/upcoming with ' +
  'completed circles staying filled, the connector fill equals the stage index (0/4 -> 4/4), ' +
  'aria-current="step" marks exactly one stage beside a visually-hidden state word, the rail ' +
  'reuses only the shell greens on canonical motion tokens and clears its transitions under ' +
  'prefers-reduced-motion, and 50 unchanged renders performed 0 DOM writes and 0 node ' +
  'operations in a counting stub DOM (first render: ' + firstRender.mutations + ' writes / ' +
  firstRender.ops + ' ops; one unguarded repaint: ' + unguardedOps + ' ops)');
