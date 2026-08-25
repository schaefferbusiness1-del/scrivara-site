'use strict';
/* sbp-1.0 control: THE STRIP CHECKBOX PAINTS WHAT THE RESOLVER SAYS - AND
 * KEEPS SAYING IT AFTER THE RESOLVER SETTLES.
 *
 * Live b1016 AND b1017 (final-live-proofs-VERDICT.md, Proof 3): the Day-strip
 * "Full visit notes" toggle #mlsDsVisitTgl painted its #mlsDsVisitBodies
 * checkbox checked===true while __mlsVisitNotesPref.read() said off. CAUSE:
 * the checkbox painted ONCE at strip render, which on a cold boot happens
 * before the session namespace exists - uns() builds the placeholder
 * 'sf_u::_::' key, the qol-2.0 resolver reads that WRONG slot, answers
 * 'unset' (now a safe first-use OFF), and nothing ever repainted (same-tab writes fire no
 * storage event). The surface lied to the doctor about which mode the next
 * pull would use. ONE-RESOLVER law: the checkbox renders FROM the resolver,
 * never from its own key read, and re-paints on the resolver's settle.
 *
 * This suite executes the REAL shipped strip-checkbox block (extracted from
 * mls-connect.js) against the REAL shipped resolver (via
 * lib-visit-notes-resolver) with a session that arrives AFTER the strip
 * renders - the live boot shape. OLD BYTES FAIL CASE 1 BY NAME: the box
 * stays checked forever while the settled resolver says off. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeResolver } = require('./lib-visit-notes-resolver');

const root = path.resolve(__dirname, '..');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');

/* ---- locate and extract the strip-checkbox IIFE (balanced braces,
 * string/comment aware) ---- */
const innerTok = "var tgl = $('mlsDsVisitBodies'); if (!tgl) return;";
const tokAt = mc.indexOf(innerTok);
assert.ok(tokAt >= 0, 'strip-checkbox block present in mls-connect.js');
assert.strictEqual(mc.indexOf(innerTok, tokAt + 1), -1, 'strip-checkbox block unique');
const iifeAt = mc.lastIndexOf('(function () {', tokAt);
assert.ok(iifeAt >= 0, 'strip-checkbox IIFE opener located');

function extractBracedAt(src, openBraceFrom) {
  const open = src.indexOf('{', openBraceFrom);
  let depth = 0, mode = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (mode === null) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(openBraceFrom, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && src[i + 1] === '/') { mode = '//'; i++; }
      else if (c === '/' && src[i + 1] === '*') { mode = '/*'; i++; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else { if (c === '\\') i++; else if (c === mode) mode = null; }
  }
  throw new Error('unbalanced strip-checkbox IIFE');
}
const iifeBody = extractBracedAt(mc, iifeAt);
assert.ok(mc.slice(iifeAt + iifeBody.length, iifeAt + iifeBody.length + 4) === ')();',
  'extracted block is the full IIFE');
const blockSrc = iifeBody + ')();';

/* The existing byte pin (visit-pull-toggle-contract) guarantees paint() reads
 * the resolver; this suite proves the BEHAVIOR across the settle. */
assert.ok(blockSrc.indexOf("r.read().on === true") >= 0, 'paint routes through the ONE resolver');

/* ---- deterministic environment ---- */
function makeStorage() {
  const store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    _store: store
  };
}

function makeHarness(opts) {
  /* session mirrors ScribeFlow's uns():
   *   'sf_u::' + (session ? session.email : '_') + '::' + suffix */
  const state = { email: opts.sessionEmail === undefined ? null : opts.sessionEmail };
  const unsFn = suffix => 'sf_u::' + (state.email === null ? '_' : state.email) + '::' + suffix;
  const storage = opts.storage || makeStorage();
  const resolver = makeResolver(unsFn, storage);

  const tgl = { checked: undefined, onchange: null, id: 'mlsDsVisitBodies' };
  const timers = { seq: 0, live: new Map(), cleared: [] };
  const win = {
    __mlsVisitNotesPref: resolver,
    uns: unsFn,
    addEventListener: function (type, fn) { (win._listeners = win._listeners || []).push({ type, fn }); }
  };
  const doc = {
    attached: tgl,
    getElementById: function (id) { return (id === 'mlsDsVisitBodies') ? doc.attached : null; }
  };
  const env = {
    $: id => (id === 'mlsDsVisitBodies' ? tgl : null),
    window: win,
    document: doc,
    setInterval: (fn, ms) => { const id = ++timers.seq; timers.live.set(id, { fn, ms }); return id; },
    clearInterval: id => { if (timers.live.delete(id)) timers.cleared.push(id); }
  };

  const run = new Function('$', 'window', 'document', 'setInterval', 'clearInterval',
    blockSrc);
  run(env.$, env.window, env.document, env.setInterval, env.clearInterval);

  return {
    tgl, timers, storage, resolver, win, doc,
    setSession: email => { state.email = email; },
    tick: () => { for (const { fn } of Array.from(timers.live.values())) fn(); },
    liveTimerCount: () => timers.live.size
  };
}

const REAL_KEY_OFF = 'sf_u::doc@clinic.example::visitNotesModeV2';

(function () {
  let n = 0;
  const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

  /* ---- 1. THE LIVE DEFECT: session arrives AFTER the strip renders; the
   * stored preference is OFF. Old bytes: one paint against the placeholder
   * namespace -> checked forever. New bytes: the settle watcher re-paints
   * from the resolver and the box turns OFF. ---- */
  {
    const storage = makeStorage();
    storage.setItem(REAL_KEY_OFF, 'off');
    const h = makeHarness({ sessionEmail: null, storage });
    assert.strictEqual(h.tgl.checked, false,
      'pre-settle boot paint must fail closed OFF while the resolver cannot see the real slot yet');
    /* the session arrives (sign-in completes) */
    h.setSession('doc@clinic.example');
    assert.strictEqual(h.resolver.read().on, false, 'the settled resolver says off (fixture sanity)');
    h.tick(); h.tick();
    assert.strictEqual(h.tgl.checked, false,
      'after the resolver settles the checkbox must paint OFF (old shape: painted CHECKED once at boot against the sf_u::_:: placeholder key and NOTHING ever repainted it - live b1016/b1017 Proof 3)');
    /* and the watcher stands down once the answer is definitive */
    h.tick();
    assert.strictEqual(h.liveTimerCount(), 0,
      'the settle watcher clears itself once the resolver answer is definitive');
    ok('boot race healed: late session, stored OFF -> box repaints OFF from the resolver, watcher stands down');
  }

  /* ---- 2. same boot race, stored ON: the box stays safely OFF until the
   * real namespace settles, then paints ON and the watcher clears ---- */
  {
    const storage = makeStorage();
    storage.setItem('sf_u::doc@clinic.example::visitNotesModeV2', 'on');
    const h = makeHarness({ sessionEmail: null, storage });
    assert.strictEqual(h.tgl.checked, false, 'pre-settle paint fails closed OFF');
    h.setSession('doc@clinic.example');
    h.tick(); h.tick();
    assert.strictEqual(h.tgl.checked, true, 'settled ON paints ON');
    assert.strictEqual(h.liveTimerCount(), 0, 'watcher cleared after ON settle');
    ok('boot race, stored ON: paints from the resolver in the ON direction too');
  }

  /* ---- 3. settled at render: both states paint immediately from the
   * resolver and NO watcher is armed (no forever-poll regression) ---- */
  {
    const sOff = makeStorage(); sOff.setItem(REAL_KEY_OFF, 'off');
    const hOff = makeHarness({ sessionEmail: 'doc@clinic.example', storage: sOff });
    assert.strictEqual(hOff.tgl.checked, false, 'settled OFF at render paints unchecked immediately');
    assert.strictEqual(hOff.liveTimerCount(), 0, 'no watcher armed when the answer is already definitive (off)');

    const sOn = makeStorage(); sOn.setItem('sf_u::doc@clinic.example::visitNotesModeV2', 'on');
    const hOn = makeHarness({ sessionEmail: 'doc@clinic.example', storage: sOn });
    assert.strictEqual(hOn.tgl.checked, true, 'settled ON at render paints checked immediately');
    assert.strictEqual(hOn.liveTimerCount(), 0, 'no watcher armed when the answer is already definitive (on)');
    ok('settled at render: paints from the resolver both states, zero watchers armed');
  }

  /* ---- 4. a REAL-namespace unset is definitive (safe first-use OFF)
   * owner bar) - the watcher must NOT poll forever on a legitimately unset
   * preference ---- */
  {
    const h = makeHarness({ sessionEmail: 'doc@clinic.example', storage: makeStorage() });
    assert.strictEqual(h.tgl.checked, false, 'real-namespace unset paints safe first-use OFF');
    assert.strictEqual(h.liveTimerCount(), 0, 'real-namespace unset is DEFINITIVE - no watcher armed');
    ok('unset through a real session namespace is definitive: safe OFF, no polling');
  }

  /* ---- 5. teardown/rebuild: a strip instance replaced in the DOM stops its
   * own watcher instead of painting a detached node forever ---- */
  {
    const storage = makeStorage();
    storage.setItem(REAL_KEY_OFF, 'off');
    const h = makeHarness({ sessionEmail: null, storage });
    assert.ok(h.liveTimerCount() > 0, 'boot race arms the watcher (fixture sanity)');
    h.doc.attached = { id: 'mlsDsVisitBodies' }; /* the strip was rebuilt: a DIFFERENT element now owns the id */
    h.tick();
    assert.strictEqual(h.liveTimerCount(), 0, 'a rebuilt strip stops the stale watcher');
    ok('teardown safety: a replaced strip instance stops its own settle watcher');
  }

  /* ---- 6. write-through unchanged: a human click still writes THROUGH the
   * resolver with read-back (existing qol-2.0 contract rides along) ---- */
  {
    const storage = makeStorage();
    storage.setItem(REAL_KEY_OFF, 'off');
    const h = makeHarness({ sessionEmail: 'doc@clinic.example', storage });
    assert.strictEqual(h.tgl.checked, false, 'starts OFF');
    h.tgl.checked = true;
    h.tgl.onchange();
    assert.strictEqual(h.resolver.read().on, true, 'the click wrote through the resolver (read-back confirmed)');
    ok('human click still writes through the ONE resolver');
  }

  /* ---- 7. the resolver's OWN settle contract (2.1.0): the settle verdict
   * lives INSIDE the ONE resolver - views never touch keys (the qol-2.0
   * fifth-reader guard forbids it). Placeholder and bug-era namespaces are
   * provisional; explicit states and real-namespace unset are definitive ---- */
  {
    const storage = makeStorage();
    storage.setItem(REAL_KEY_OFF, 'off');

    const placeholder = makeResolver(s => 'sf_u::_::' + s, storage);
    assert.strictEqual(placeholder.read().settled, false,
      'a placeholder-namespace read (sf_u::_::, session not loaded yet) reports settled:false - the answer is provisional');

    const bugEra = makeResolver(s => 'sf_u::undefined::' + s, storage);
    assert.strictEqual(bugEra.read().settled, false,
      'the bug-era ::undefined:: namespace also reports settled:false');

    const real = makeResolver(s => 'sf_u::doc@clinic.example::' + s, storage);
    assert.strictEqual(real.read().settled, true, 'an explicit stored off is definitive');
    assert.strictEqual(real.read().on, false, '...and reads off');

    const realUnset = makeResolver(s => 'sf_u::doc@clinic.example::' + s, makeStorage());
    const ru = realUnset.read();
    assert.strictEqual(ru.settled, true, 'a real-namespace unset is a DEFINITIVE safe first-use answer');
    assert.strictEqual(ru.on, false, '...and stays OFF until the clinician makes the required choice');
    ok('resolver settle contract: placeholder/bug-era namespaces provisional, explicit states and real-namespace unset definitive');
  }

  console.log('PASS strip-checkbox paints the resolver: boot-race repaint both states, settle watcher self-clears, definitive unset stays safe-OFF, teardown safe, write-through intact, resolver settle contract pinned (' + n + ' cases)');
})();
