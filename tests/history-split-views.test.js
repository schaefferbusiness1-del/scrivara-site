'use strict';
/*
 * histsplit-1.0.0 — Patients > History is TWO pages, and the timeline is one of them.
 *
 * Owner, 2026-08-31, with a screenshot of the History surface: "this werid
 * opage u need to find ahts aweful ui it just need to be seprate pages".
 *
 * WHAT WAS MEASURED BEFORE THE SPLIT, on one card in one scroll:
 *   the green "Pull chart from Athena" primary (feat_mls_calm_views.js mounts it
 *   into "#historyView .card"), a "Show more history tools" disclosure, a
 *   six-button <h2> toolbar, the duplicate-notes warning, the storage
 *   disclaimer, the AI chart-summary card, histview-1.0.0's "Visits &
 *   encounters" room with cvfull-1.0.0's "Copy all N encounters" row, the
 *   search row and the visit list. Nine concerns, one page.
 *
 * WHAT THIS SUITE PROVES, and why each claim needed its own kind of check:
 *
 *   A. STATIC, over the SHIPPED markup of BOTH twins. The two pages exist, the
 *      tools card is the FIRST .card in the view (which is the whole mechanism
 *      by which the green primary lands on the tools page without editing
 *      feat_mls_calm_views.js, a file shared with production), neither page's
 *      heading holds a button (which is why that module's h2-toolbar fold now
 *      marks nothing and mounts no empty disclosure), and every control that
 *      existed before the split still exists EXACTLY ONCE, on the page it
 *      belongs to, wired to the same handler it always had. An id census is
 *      the only check that catches a control quietly lost in a move.
 *
 *   B. EXECUTED, against the SHIPPED script sliced out of the twin and run in a
 *      vm over a DOM stub shaped like the shipped markup. Existence checks pass
 *      on a router that never routes: only running it proves that the two panes
 *      are separately shown and hidden, that they are never both up and never
 *      both down, that an empty timeline opens the tools page and a filled one
 *      opens the timeline, that a press on a pill stops the router until
 *      History is left, and that a programmatic opener naming a SAVED VISIT
 *      pins the timeline and still calls through to the app's own function.
 *
 * NOT registered in run-all.js (stage-only lane, per the dispatch).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const TWINS = ['1pScribeFlow.html', path.join('1p', 'index.html')];

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

function count(hay, needle) {
  let n = 0, i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at < 0) return n;
    n++; i = at + needle.length;
  }
}
function slice(src, open, close, label) {
  const a = src.indexOf(open);
  assert.ok(a >= 0, label + ': opening marker not found -> ' + JSON.stringify(open.slice(0, 60)));
  const b = src.indexOf(close, a);
  assert.ok(b > a, label + ': closing marker not found -> ' + JSON.stringify(close.slice(0, 60)));
  return src.slice(a, b + close.length);
}

/* Every control that existed on the pre-split History page, with the page it
   must live on now and the handler it must still be wired to. A control that
   loses its handler in a move is exactly as broken as one that is deleted. */
const CONTROLS = [
  ['histNewVisitBtn', 'tools', 'onclick="goNewVisitForPatient()"'],
  ['histSchedFollowBtn', 'tools', 'onclick="calScheduleForPatient()"'],
  ['pullChartBtn', 'tools', 'onclick="pullPatientChartViaAssist(this)"'],
  ['histOpNoteBtn', 'tools', 'onclick="openOpPrepForPatient()"'],
  ['chartSumBtn', 'tools', 'onclick="generateChartSummary()"'],
  ['histDedupeBtn', 'tools', 'onclick="cleanupDuplicateNotes(this)"'],
  ['pullChartStatus', 'tools', null],
  ['histStorageNote', 'tools', null],
  ['chartSumCard', 'tools', null],
  ['chartSumBody', 'tools', null],
  ['histDupBanner', 'timeline', null],
  ['histWho', 'timeline', null],
  ['histSearchRow', 'timeline', null],
  ['histSearch', 'timeline', null],
  ['histFilter', 'timeline', null],
  ['histCount', 'timeline', null],
  ['histEmpty', 'timeline', null],
  ['histList', 'timeline', null],
  ['historyCard', 'timeline', null]
];

/* ==================================================================== PART A */

const regions = {};
const blocks = {};

for (const rel of TWINS) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const name = rel.replace(/\\/g, '/');

  /* ---- the view, sliced out of the shipped page --------------------------- */
  const view = slice(src,
    '  <!-- ============ HISTORY VIEW ============ -->',
    '  </div><!-- /historyView -->', name + ' #historyView');
  regions[name] = view;

  ok(view.includes('histsplit-1.0.0'),
    name + ': the History view carries no histsplit marker, so this suite is measuring the pre-split page');

  /* ---- the two pages exist, in the order the mechanism depends on --------- */
  const iSub = view.indexOf('id="historySubnav"');
  const iTools = view.indexOf('id="historyToolsPane"');
  const iToolsCard = view.indexOf('id="historyToolsCard"');
  const iTimeline = view.indexOf('id="historyTimelinePane"');
  ok(iSub >= 0, name + ': the History sub-nav pill row is missing');
  ok(iTools >= 0, name + ': #historyToolsPane is missing');
  ok(iTimeline >= 0, name + ': #historyTimelinePane is missing');
  ok(iSub < iTools && iTools < iTimeline,
    name + ': the pages are out of order. The pill row must come first and the TOOLS page must precede the timeline, ' +
    'because feat_mls_calm_views.js anchors its green primary at the FIRST "#historyView .card" — reverse them and the ' +
    'banner goes straight back on top of the timeline.');

  /* THE ANCHOR CLAIM, resolved the way querySelector resolves it: first match
     in document order. This is the single load-bearing fact of the whole
     restructure, so it is measured rather than asserted in a comment.
     Comments are stripped first: the markup's own note explains the rule and
     quotes the class name, and a scan that cannot tell prose from an element
     would "prove" the anchor from the sentence describing it. */
  const viewNC = view.replace(/<!--[\s\S]*?-->/g, '');
  const firstCard = viewNC.indexOf('class="card"');
  ok(firstCard >= 0, name + ': the History view ships no .card at all');
  const firstCardTag = viewNC.slice(firstCard, viewNC.indexOf('>', firstCard) + 1);
  ok(/id="historyToolsCard"/.test(firstCardTag),
    name + ': the first .card in #historyView is not #historyToolsCard, so "#historyView .card" resolves elsewhere ' +
    'and the green "Pull chart from Athena" primary will mount on the wrong page. First card tag: ' + firstCardTag);
  ok(iToolsCard > iTools && iToolsCard < iTimeline,
    name + ': #historyToolsCard is not inside #historyToolsPane');

  /* The pill row must NOT be a card, or IT becomes that anchor. */
  const subTag = view.slice(iSub - 200 < 0 ? 0 : view.lastIndexOf('<div', iSub), view.indexOf('>', iSub) + 1);
  ok(!/class="[^"]*\bcard\b/.test(subTag),
    name + ': #historySubnav carries class="card", so it steals the calm-views anchor from the tools page: ' + subTag);

  /* ---- the tools page ships hidden; the timeline ships shown -------------- */
  const toolsTag = view.slice(view.lastIndexOf('<div', iTools), view.indexOf('>', iTools) + 1);
  const timelineTag = view.slice(view.lastIndexOf('<div', iTimeline), view.indexOf('>', iTimeline) + 1);
  ok(/style="display:none"/.test(toolsTag),
    name + ': #historyToolsPane does not ship hidden, so both pages paint at once before the router runs: ' + toolsTag);
  ok(!/display:none/.test(timelineTag),
    name + ': #historyTimelinePane ships hidden, so History would open on nothing at all: ' + timelineTag);
  ok(/role="tabpanel"/.test(toolsTag) && /role="tabpanel"/.test(timelineTag),
    name + ': the two pages are not exposed as tab panels for the pill row');

  /* ---- neither heading holds a button ------------------------------------- */
  const headings = viewNC.match(/<h2\b[\s\S]*?<\/h2>/g) || [];
  eq(headings.length, 2, name + ': #historyView no longer ships exactly two <h2> page headings');
  for (const h of headings) {
    ok(!/<button/.test(h),
      name + ': a History page heading still contains a button. feat_mls_calm_views.js marks every button inside ' +
      '"#historyView h2" as a fold and then mounts a "Show more history tools" disclosure for it — the stacked ' +
      'toolbox the owner complained about. Heading: ' + h.slice(0, 120));
  }
  ok(/aria-label="Visit history"/.test(view) && /aria-label="Chart tools"/.test(view),
    name + ': the two pages are not both named');

  /* ---- the control census ------------------------------------------------- */
  const toolsPane = view.slice(iTools, view.indexOf('<!-- /historyToolsPane -->'));
  const timelinePane = view.slice(iTimeline);
  ok(toolsPane.length > 400 && timelinePane.length > 400, name + ': a page slice came back empty');
  for (const [id, page, handler] of CONTROLS) {
    eq(count(view, 'id="' + id + '"'), 1,
      name + ': #' + id + ' does not appear exactly once in #historyView — a move that duplicates or drops a ' +
      'control is the failure this census exists to catch');
    const home = page === 'tools' ? toolsPane : timelinePane;
    ok(home.includes('id="' + id + '"'),
      name + ': #' + id + ' is not on the ' + page + ' page');
    if (handler) {
      ok(view.includes(handler),
        name + ': #' + id + ' lost its handler ' + handler + ' in the move — the control survived and its wiring did not');
      eq(count(view, handler), 1, name + ': ' + handler + ' now appears more than once inside #historyView');
    }
  }
  /* The two controls that had NO id before the split kept their verbs and
     gained one, so the next mover can find them. */
  ok(/id="histSchedFollowBtn"[^>]*onclick="calScheduleForPatient\(\)"/.test(view) ||
     /onclick="calScheduleForPatient\(\)"[^>]*id="histSchedFollowBtn"/.test(view) ||
     (view.includes('id="histSchedFollowBtn"') && view.includes('onclick="calScheduleForPatient()"')),
    name + ': Schedule follow-up lost either its new id or its handler');
  ok(view.includes('id="histOpNoteBtn"') && view.includes('onclick="openOpPrepForPatient()"'),
    name + ': Draft op note lost either its new id or its handler');

  /* ---- co-pin with tests/1p-pullchart-status-line.test.js ------------------ */
  ok(view.includes('<div id="pullChartStatus" style="display:none;font-size:12px;line-height:1.4;margin-top:6px"></div>'),
    name + ': the pull status line was reshaped in the move — 1p-pullchart-status-line pins this exact element');
  const pullBtnAt = view.indexOf('id="pullChartBtn"');
  const statusAt = view.indexOf('id="pullChartStatus"');
  ok(statusAt > pullBtnAt && statusAt - pullBtnAt < 900,
    name + ': the pull status line no longer sits beside the pull button');

  /* ---- the duplicate-notes notice stays on the timeline AND links across --- */
  ok(timelinePane.includes('id="histDupBanner"'),
    name + ': the duplicate-notes warning left the timeline. A data-integrity flag has to be where the data is.');
  const dupLine = slice(src, "var _dups=(typeof _dupNoteList===", 'else { _bn.style.display=', name + ' dup notice');
  ok(dupLine.includes('Remove the extras'),
    name + ': the duplicate-notes notice lost its direct one-click cleanup link');
  ok(dupLine.includes("cleanupDuplicateNotes();return false;"),
    name + ': the direct cleanup link no longer calls cleanupDuplicateNotes');
  ok(/showHistoryPane\(\\'tools\\',true\)/.test(dupLine),
    name + ': the duplicate-notes notice does not link across to the Chart tools page: ' + dupLine.slice(-220));
  ok(dupLine.includes('Chart tools'),
    name + ': the cross-link to the cleanup page is unnamed');

  /* ---- the behaviour block ------------------------------------------------ */
  const block = slice(src,
    '<!-- ===== histsplit-1.0.0 — History is two pages and the timeline is one of them =',
    '<!-- ===== end histsplit-1.0.0 =============================================== -->',
    name + ' histsplit block');
  blocks[name] = block;
  ok(/setInterval\(tick, 500\)/.test(block),
    name + ': the router lost its timer');
  ok(!/requestAnimationFrame/.test(block.replace(/rAF|requestAnimationFrame scheduler/g, '')) ||
     !/requestAnimationFrame\s*\(/.test(block),
    name + ': the router schedules on rAF, which never fires in a non-compositing tab and would freeze it half-painted');
  ok(/window\.showHistoryPane\s*=/.test(block),
    name + ': window.showHistoryPane is gone, and every pill and cross-link names it');
  ok(/revert:\s*function/.test(block), name + ': the histsplit escape hatch is gone');
  ok(/body\.mls-public-preview #histSchedFollowBtn/.test(block),
    name + ': the public-preview parity rule is gone. public-preview-runtime.js hides these two controls by walking ' +
    '"#historyCard h2 button"; they are not in that heading any more, and that file is shared with production and ' +
    'pinned by an asset-token contract, so the rule lives here instead.');
}

/* ---- the twins agree, byte for byte, in every region this lane touched ----
   Reported as the first differing offset with a short window either side. A
   bare strictEqual on two 12,000-character regions prints both of them, which
   buries the one line that actually forked. */
function sameBytes(a, b, what) {
  if (a === b) { checks++; return; }
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  assert.fail(what + ' has forked between the twins at offset ' + i + ' (1p-first law: the edited regions are ' +
    'byte-identical).\n  1pScribeFlow.html: ' + JSON.stringify(a.slice(i, i + 90)) +
    '\n  1p/index.html    : ' + JSON.stringify(b.slice(i, i + 90)));
}
{
  const [a, b] = TWINS.map((r) => regions[r.replace(/\\/g, '/')]);
  sameBytes(a, b, 'the History view');
  const [ba, bb] = TWINS.map((r) => blocks[r.replace(/\\/g, '/')]);
  sameBytes(ba, bb, 'the histsplit block');
}

/* ==================================================================== PART B
 * The SHIPPED router, executed. Sliced out of the twin — never re-authored
 * here, or this suite would prove a copy works and ship something else.
 */

function sliceRouter() {
  const src = fs.readFileSync(path.join(root, TWINS[0]), 'utf8');
  const block = slice(src,
    '<!-- ===== histsplit-1.0.0 — History is two pages and the timeline is one of them =',
    '<!-- ===== end histsplit-1.0.0 =============================================== -->', 'router');
  const open = block.indexOf('<script>');
  const close = block.indexOf('</' + 'script>', open);
  assert.ok(open >= 0 && close > open, 'the histsplit block ships no inline script');
  const code = block.slice(open + '<script>'.length, close);
  assert.ok(/histsplit-1\.0\.0/.test(code) && /function route\(/.test(code),
    'the sliced router is not the router — the extraction drifted');
  return code;
}

function makeDom() {
  const nodes = Object.create(null);
  function el(id, opts) {
    const o = opts || {};
    const node = {
      id: id,
      style: { display: o.display === undefined ? '' : o.display },
      _attrs: Object.create(null),
      hidden: !!o.hidden,
      firstElementChild: o.firstElementChild || null,
      disabled: false,
      _cards: o.cards || 0,
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
      setAttribute(k, v) { this._attrs[k] = String(v); },
      querySelector(sel) { return (sel === '.hx-card' && this._cards > 0) ? { tag: 'hx-card' } : null; }
    };
    nodes[id] = node;
    return node;
  }
  el('historyView', { display: 'none' });
  el('historyToolsPane', { display: 'none' });
  el('historyTimelinePane', { display: '' });
  el('histPaneTabTimeline');
  el('histPaneTabTools');
  el('histList');
  el('mlsHxSection', { hidden: true });
  el('histSplitCss');

  const timers = { intervals: [], timeouts: [], nextId: 1 };
  const listeners = Object.create(null);
  /* A CONTROLLABLE CLOCK, because the rule under test is a time rule. The
     router re-decides freely inside a settle window and then stops; with the
     real clock every tick this suite fires lands in the first millisecond of
     that window, so the post-settle behaviour would never be measured at all
     and the check would pass on a router that had no window. */
  const clock = { t: 1000000 };
  const sandbox = {
    console,
    Date: { now() { return clock.t; } },
    Object,
    Array,
    String,
    setInterval(fn) { timers.intervals.push(fn); return timers.nextId++; },
    clearInterval() { timers.intervals.length = 0; },
    setTimeout(fn) { timers.timeouts.push(fn); return timers.nextId++; },
    clearTimeout() {},
    document: {
      readyState: 'complete',
      getElementById(id) { return nodes[id] || null; },
      addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
    }
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); };
  sandbox.window.getComputedStyle = function (node) {
    return { display: node && node.style && node.style.display ? node.style.display : 'block' };
  };
  return {
    sandbox, nodes, timers, listeners, clock,
    tick() { timers.intervals.forEach((fn) => fn()); },
    advance(ms) { clock.t += ms; }
  };
}

{
  const code = sliceRouter();
  const dom = makeDom();
  vm.createContext(dom.sandbox);
  vm.runInContext(code, dom.sandbox, { filename: 'histsplit-1.0.0 (sliced from 1pScribeFlow.html)' });

  const api = dom.sandbox.window.__mlsHistSplit;
  ok(api && api.installed === true, 'the sliced router did not install');
  eq(api.version, 'histsplit-1.0.0', 'the sliced router reports the wrong version');
  ok(typeof dom.sandbox.window.showHistoryPane === 'function',
    'window.showHistoryPane was not published — every pill and cross-link names it by that exact name');
  ok(dom.timers.intervals.length >= 1, 'the router armed no timer, so nothing would ever route');

  const shown = () => ({
    tools: dom.nodes.historyToolsPane.style.display !== 'none',
    timeline: dom.nodes.historyTimelinePane.style.display !== 'none',
    toolsTab: dom.nodes.histPaneTabTools.getAttribute('aria-selected'),
    timelineTab: dom.nodes.histPaneTabTimeline.getAttribute('aria-selected'),
    pane: api.pane()
  });
  const exclusive = (s, where) => {
    ok(s.tools !== s.timeline,
      where + ': the two pages are ' + (s.tools ? 'BOTH shown — the stacked page is back' : 'both hidden — History shows nothing'));
    eq(s.toolsTab, s.tools ? 'true' : 'false', where + ': the Chart tools pill does not match what is on screen');
    eq(s.timelineTab, s.timeline ? 'true' : 'false', where + ': the Visit history pill does not match what is on screen');
  };

  /* 1. History closed, timeline empty -> the tools page is pre-selected, so
        opening the view never moves the page under the doctor. */
  dom.tick();
  let s = shown();
  exclusive(s, 'closed + empty chart');
  eq(s.pane, 'tools', 'an empty chart does not pre-select the page whose one job is to go and get it');

  /* 2. Open History. Still empty -> tools, and only tools. */
  dom.nodes.historyView.style.display = 'block';
  dom.tick();
  s = shown();
  exclusive(s, 'open + empty chart');
  eq(s.pane, 'tools', 'History opened on the timeline with nothing to show');
  ok(s.tools && !s.timeline, 'the timeline page is still painted underneath the tools page');

  /* 3. A pull lands: the encounter room fills. The router follows it. */
  dom.nodes.mlsHxSection.hidden = false;
  dom.nodes.mlsHxSection._cards = 12;
  dom.tick();
  s = shown();
  exclusive(s, 'open + encounters arrived');
  eq(s.pane, 'timeline', 'twelve encounters landed and the doctor was left looking at the toolbox');

  /* 4. The saved-visit list alone is enough — this is the state every "open
        this note in History" deep link arrives in. */
  dom.nodes.mlsHxSection.hidden = true;
  dom.nodes.mlsHxSection._cards = 0;
  dom.nodes.histList.firstElementChild = { tag: 'row' };
  dom.tick();
  eq(api.pane(), 'timeline', 'a saved-visit list does not open the timeline, so every note deep link lands on the toolbox');

  /* 5. A press on a pill is the doctor's, and it stops the router. */
  dom.sandbox.window.showHistoryPane('tools', true);
  s = shown();
  exclusive(s, 'after pressing the Chart tools pill');
  eq(s.pane, 'tools', 'the pill did not switch the page');
  dom.tick(); dom.tick();
  eq(api.pane(), 'tools', 'the router overrode a page the doctor chose by hand');
  eq(api.manual(), true, 'the router does not know the doctor chose a page');

  /* 6. Leaving History and coming back releases it again. */
  dom.nodes.historyView.style.display = 'none';
  dom.tick();
  dom.nodes.historyView.style.display = 'block';
  dom.tick();
  eq(api.manual(), false, 'a hand-picked page outlives the visit that picked it');
  eq(api.pane(), 'timeline', 're-entering History with a full list does not open the list');

  /* 7. Once the page has settled, an emptying list must NEVER yank it out from
        under a reader. renderHistory() clears and refills #histList on every
        search keystroke and every filter change; the reverse transition is not
        one a doctor should ever feel. */
  dom.advance(4000);                                     /* past the settle window */
  dom.tick();
  const before = api.pane();
  eq(before, 'timeline', 'the post-settle precondition did not hold');
  dom.nodes.histList.firstElementChild = null;
  dom.tick(); dom.tick();
  eq(api.pane(), before, 'an emptying list moved the page under the reader after it had settled');
  /* and the same emptiness, entered afresh, DOES choose the tools page — so the
     check above is a rule about timing, not a router that stopped working. */
  dom.nodes.historyView.style.display = 'none';
  dom.tick();
  dom.nodes.historyView.style.display = 'block';
  dom.tick();
  eq(api.pane(), 'tools', 'CONTROL BROKEN: re-entering an empty History does not choose the tools page, ' +
    'so the settle rule above proves nothing');

  /* 8. A deep link that names a SAVED VISIT pins the timeline and still calls
        the app's own function, with its own arguments, exactly once. */
  dom.nodes.histList.firstElementChild = null;
  dom.nodes.historyView.style.display = 'none';
  dom.tick();
  dom.nodes.historyView.style.display = 'block';
  dom.tick();
  eq(api.pane(), 'tools', 'the empty-chart precondition for the deep-link check did not hold');
  const seen = [];
  dom.sandbox.window.openNoteFromHistory = function (id) { seen.push(id); return 'opened:' + id; };
  dom.tick();                                            /* the router wraps it */
  ok(dom.sandbox.window.openNoteFromHistory.__histSplit === 1,
    'openNoteFromHistory was never wrapped, so opening a saved visit lands on whatever page the router last chose');
  const out = dom.sandbox.window.openNoteFromHistory('n-probe');
  eq(out, 'opened:n-probe', 'the wrapper swallowed the app function\'s return value');
  assert.deepStrictEqual(seen, ['n-probe'], 'the wrapper did not call through with the original argument');
  checks++;
  eq(api.pane(), 'timeline', 'opening a saved visit did not land on the page that shows visits');

  /* 9. Revert puts the pre-split stack back and stops the router. */
  eq(api.revert(), true, 'revert() did not report success');
  s = shown();
  ok(s.tools && s.timeline, 'revert() did not restore both pages');
  eq(dom.timers.intervals.length, 0, 'revert() left the router timer running');
  ok(dom.sandbox.window.openNoteFromHistory.__histSplit !== 1, 'revert() left the opener wrapped');
}

console.log('PASS history split views: ' + checks + ' checks — two pages in both twins (byte-identical), ' +
  'tools card is the calm-views anchor, no button in either heading, ' + CONTROLS.length +
  ' pre-split controls each present exactly once on the right page with their handlers, ' +
  'dup-notes notice keeps its one-click cleanup and links across, ' +
  'and the SHIPPED router was executed: panes are mutually exclusive, an empty chart opens Chart tools, ' +
  'content arriving opens the timeline, a pill press wins, a saved-visit deep link pins the timeline.');
