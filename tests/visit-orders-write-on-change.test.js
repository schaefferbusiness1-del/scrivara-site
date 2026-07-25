'use strict';

/*
 * renderVisitOrders() must not rebuild the on-screen orders list when the markup
 * has not changed.
 *
 * THIS IS THE OWNER'S "EVERY 5 SECONDS". Measured on the owner's live signed-in
 * session at b645, with the Advanced visit workspace open (body.ez3adv), valid
 * run witnessed by the page's own clock:
 *
 *     #visitOrdersBody          VISIBLE 524x50, inside a 608x1059 note card
 *     rebuilds in 105s          15
 *     median gap                5008 ms
 *     distinct content hashes   1   across all 15 rebuilds
 *
 * The owner's words were "the whole visit page glitches out every 5 seconds".
 *
 * Why it stayed hidden through three earlier rounds: #noteCard is hidden by CSS
 * unconditionally and revealed only by `body.ez3adv`, which the "Advanced visit
 * workspace" button sets. Every earlier measurement ran in the default view,
 * where this element is behind display:none - so it was twice written off as
 * invisible waste. That judgement was right for the default view and wrong for
 * the view the clinician actually works in. Seeding content did not reveal it;
 * content was never the gate.
 *
 * `el.innerHTML = s` tears down and recreates every child even when s is
 * byte-identical to what is already there. Confirmed by mutation type on the
 * live page: childList records only, nodes removed and re-added, zero content
 * change. So build the markup first, compare, and commit only on a difference.
 *
 * The same applies to card.style.display, which was re-set to 'block' on every
 * pass.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- extract the real function, so this tests shipped code, not a copy ---- */

const start = src.indexOf('function renderVisitOrders(){');
assert(start > -1, 'renderVisitOrders() is gone from ScribeFlow.html');
const end = src.indexOf('\nfunction removeVisitOrder(', start);
assert(end > start, 'could not find the end of renderVisitOrders()');
const fn = src.slice(start, end);

assert.doesNotThrow(() => new Function(fn), 'renderVisitOrders() no longer parses');

/* ---- the shape of the fix, so it cannot be quietly undone ---------------- */

assert(/if\(box\.innerHTML!==_voHtml\) box\.innerHTML=_voHtml;/.test(fn),
  'renderVisitOrders() must commit its markup only when it differs. Without this it rebuilds a\n' +
  'VISIBLE 524x50 region every ~5s with byte-identical markup - the owner\'s reported glitch.');

assert.strictEqual((fn.match(/\.innerHTML=/g) || []).length, 1,
  'renderVisitOrders() should have exactly one innerHTML write, the guarded one. Found ' +
  (fn.match(/\.innerHTML=/g) || []).length + ' - an unguarded branch has been reintroduced.');

assert(/if\(card\.style\.display!=='block'\) card\.style\.display='block';/.test(fn),
  "renderVisitOrders() must not re-set card.style.display on every pass");

/* ---- and the behaviour, driven through the actual extracted source ------- */

function run(orders) {
  const box = {};
  Object.defineProperty(box, 'innerHTML', {
    get() { return this._v || ''; },
    set(v) { this._v = v; this._w = (this._w || 0) + 1; }
  });
  const card = { style: { display: '' } };
  const sandbox = {
    document: { getElementById: (id) => id === 'visitOrdersCard' ? card : id === 'visitOrdersBody' ? box : null },
    ORDER_DEFS: { lab: { label: 'Lab', icon: 'L', fields: [] } },
    esc: (s) => String(s),
    _athenaOrderPlacementControl: () => '<b>place</b>',
    currentOrders: orders
  };
  const factory = new Function(...Object.keys(sandbox), fn + '; return renderVisitOrders;');
  const render = factory(...Object.values(sandbox));
  return { box, card, render, setOrders: (o) => { sandbox.currentOrders.length = 0; o.forEach(x => sandbox.currentOrders.push(x)); } };
}

/* idle: repeated calls with nothing changed must write once and then stop */
{
  const t = run([]);
  t.render(); t.render(); t.render(); t.render(); t.render();
  assert.strictEqual(t.box._w, 1,
    '5 idle calls produced ' + t.box._w + ' innerHTML writes, expected 1. At the measured 5008ms ' +
    'cadence that is ' + (t.box._w * 12) + ' teardown-and-rebuilds of a visible region per minute.');
  assert(/No reviewed order drafts yet/.test(t.box._v), 'the empty-state copy was lost');
}

/* a real change must still render — the guard must not freeze the list */
{
  const t = run([]);
  t.render();
  const empty = t.box._v;
  t.setOrders([{ id: 'o1', type: 'lab', fields: { a: 'CBC' }, _src: 'CBC panel' }]);
  t.render();
  assert.strictEqual(t.box._w, 2, 'adding an order must re-render');
  assert(t.box._v !== empty && /CBC/.test(t.box._v), 'the added order is not in the markup');

  t.render(); t.render();
  assert.strictEqual(t.box._w, 2, 'idle calls after a change must not rewrite');

  t.setOrders([]);
  t.render();
  assert.strictEqual(t.box._w, 3, 'removing the last order must re-render');
  assert.strictEqual(t.box._v, empty, 'the empty state must be restored exactly');
}

/* display is set once, not per pass */
{
  const t = run([]);
  t.card.style.display = 'block';
  t.render(); t.render();
  assert.strictEqual(t.card.style.display, 'block', 'the card must still end up visible');
}

/* ---- and the driver: the capability handshake must not re-render per heartbeat --
 *
 * onPong (ScribeFlow.html) is the extension capability handshake. The extension
 * pongs about every 4 seconds forever, but the version and the
 * supervisedOrderPlacementV2 flag change at most once per session. Captured live
 * on the owner's tab: 6 calls to renderVisitOrders in 75s, median gap 4008ms,
 * every one from onPong. Guarding the renderer alone would stop the DOM churn but
 * still rebuild the markup string 15 times a minute for nothing.
 */
const pong = src.slice(src.indexOf('function onPong(e){'), src.indexOf("window.addEventListener('message',onPong,false);"));
assert(pong.length > 100, 'could not extract onPong');
assert(pong.includes('if(window.__mlsExtensionHandshakeSig===_hsSig)return;'),
  'onPong must bail out when the handshake signature is unchanged. Without it every extension ' +
  'heartbeat re-renders both order lists - 15 rebuilds a minute of a visible region.');
/* Presence first: indexOf returns -1 when the line is gone, and -1 is less than
   any real index, so an ordering check alone silently passes on deletion. */
const sigAt = pong.indexOf('window.__mlsExtensionHandshakeSig=_hsSig;');
const renderAt = pong.indexOf('renderVisitOrders');
assert(sigAt > -1,
  'onPong must RECORD the handshake signature. Without it the early-return guard never latches ' +
  'and every heartbeat re-renders, exactly as before the fix.');
assert(renderAt > -1, 'onPong no longer renders at all - the capability would never surface');
assert(sigAt < renderAt,
  'the signature must be recorded before the render, or the guard never latches');
assert(/renderVisitOrders/.test(pong) && /renderOrderList/.test(pong),
  'onPong must still re-render when the capability genuinely arrives - that is what makes the ' +
  'place-in-Athena control appear');

console.log('PASS visit orders write-on-change: 5 idle calls produce 1 innerHTML write (was 1 per call, ' +
  'measured live at 15 rebuilds / 105s, median 5008ms, 1 distinct content hash), and real order ' +
  'changes still re-render both ways');
