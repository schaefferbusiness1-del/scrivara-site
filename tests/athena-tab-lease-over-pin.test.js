'use strict';

/* Blocker 4.2 (2026-07-15): the ACTIVE quiet-work Athena-tab lease must outrank
 * any mutable explicit tab pin. Two-tab runtime regression: while a cohort holds
 * an active QP lease, every selection stays on the exact leased tab — a pin
 * change mid-cohort can never hop the next patient read to the other Athena
 * tab, and an unhealthy leased tab fails CLOSED (null) instead of hopping.
 * With no active lease, the explicit pin keeps its v1.99 meaning. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

/* Source-order invariant: the lease check must precede the pin check inside the
   picker, so no future edit can quietly restore pin-first ordering. */
const pickerSrc = (() => {
  const start = background.indexOf('async function mlsPickAthenaTab(');
  assert(start >= 0, 'missing mlsPickAthenaTab');
  const end = background.indexOf('self.__mlsPickAthenaTab', start);
  assert(end > start, 'missing picker terminator');
  return background.slice(start, end);
})();
const leaseIdx = pickerSrc.indexOf('self.__mlsQp');
const pinIdx = pickerSrc.indexOf('self.__mlsAthPin');
assert(leaseIdx >= 0 && pinIdx >= 0, 'picker must consult both the lease and the pin');
assert(leaseIdx < pinIdx, 'the active quiet-work lease must be consulted BEFORE the explicit pin');

function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function makeHarness() {
  const TAB_A = { id: 101, windowId: 1, url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp', title: 'athenaOne A', lastAccessed: 1000 };
  const TAB_B = { id: 202, windowId: 1, url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp', title: 'athenaOne B', lastAccessed: 2000 };
  const state = {
    tabs: { 101: TAB_A, 202: TAB_B },
    health: { 101: { alive: true, signedOut: false }, 202: { alive: true, signedOut: false } },
    pings: [],
    rejected: [],
    pinCleared: 0,
    genericFallbacks: 0
  };
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, RegExp, Boolean,
    setTimeout, clearTimeout,
    chrome: {
      tabs: {
        get: async id => {
          if (!state.tabs[id]) throw new Error('No tab with id ' + id);
          return state.tabs[id];
        },
        query: async () => Object.values(state.tabs)
      }
    },
    self: {
      __mlsAthPin: { tabId: null, at: 0 },
      __mlsQp: { active: false, athenaTabId: null },
      __mlsAthPickCache: { tabId: null, at: 0 }
    },
    mlsAthTabHost: tab => {
      try { return new URL(tab.url).hostname; } catch (_) { return ''; }
    },
    URL,
    mlsAthIsLoginish: () => false,
    mlsAthPing: async (tabId, budget) => {
      state.pings.push({ tabId, budget });
      return Object.assign({ cal: true, fs: true }, state.health[tabId] || { alive: false, signedOut: false });
    },
    mlsAthRejectSignedOut: tabId => { state.rejected.push(tabId); },
    mlsPinSet: value => { if (value == null) { state.pinCleared++; ctx.self.__mlsAthPin = { tabId: null, at: 0 }; } },
    mlsAthScore: () => 10,
    mlsTabTitleAthena: () => true,
    mlsPickGenericEmrTab: () => { state.genericFallbacks++; return null; }
  };
  vm.createContext(ctx);
  vm.runInContext(`${extractFunction(background, 'mlsPickAthenaTab')}; this.pick = mlsPickAthenaTab;`, ctx);
  return { ctx, state, TAB_A, TAB_B, pick: opts => ctx.pick(null, opts || { athenaOnly: true }) };
}

(async () => {
  /* 1. Active lease on A + pin on B -> the leased tab wins. */
  {
    const h = makeHarness();
    h.ctx.self.__mlsQp = { active: true, athenaTabId: 101 };
    h.ctx.self.__mlsAthPin = { tabId: 202, at: Date.now() };
    const picked = await h.pick();
    assert(picked && picked.id === 101, 'active QP lease must outrank the explicit pin');
    assert(!h.state.pings.some(p => p.tabId === 202), 'the pinned tab must not even be probed while the lease is active');
  }

  /* 2. Mid-cohort pin change cannot hop the next read: pin flips A->B between
        selections while the lease stays on A. Every pick stays on A. */
  {
    const h = makeHarness();
    h.ctx.self.__mlsQp = { active: true, athenaTabId: 101 };
    h.ctx.self.__mlsAthPin = { tabId: 101, at: Date.now() };
    const first = await h.pick();
    assert(first && first.id === 101);
    h.ctx.self.__mlsAthPin = { tabId: 202, at: Date.now() }; /* hostile mid-run pin mutation */
    const second = await h.pick();
    assert(second && second.id === 101, 'a pin change mid-cohort hopped the read to the other Athena tab');
    const third = await h.pick();
    assert(third && third.id === 101, 'repeat selections must stay on the exact leased tab');
  }

  /* 3. Leased tab signed out -> fail CLOSED (null), never hop to the pinned tab. */
  {
    const h = makeHarness();
    h.ctx.self.__mlsQp = { active: true, athenaTabId: 101 };
    h.ctx.self.__mlsAthPin = { tabId: 202, at: Date.now() };
    h.state.health[101] = { alive: true, signedOut: true };
    const picked = await h.pick();
    assert.strictEqual(picked, null, 'a signed-out leased tab must fail closed, not fall through to the pin');
    assert(h.state.rejected.includes(101), 'the signed-out leased tab must be rejected/quarantined');
    assert(!h.state.pings.some(p => p.tabId === 202), 'fail-closed must not probe or adopt the pinned tab');
  }

  /* 4. Leased tab closed (tabs.get throws) -> fail CLOSED (null). */
  {
    const h = makeHarness();
    h.ctx.self.__mlsQp = { active: true, athenaTabId: 999 };
    h.ctx.self.__mlsAthPin = { tabId: 202, at: Date.now() };
    const picked = await h.pick();
    assert.strictEqual(picked, null, 'a dead leased tab must fail closed, not hop to the pinned tab');
  }

  /* 5. Leased tab unresponsive (not alive) -> fail CLOSED (null). */
  {
    const h = makeHarness();
    h.ctx.self.__mlsQp = { active: true, athenaTabId: 101 };
    h.ctx.self.__mlsAthPin = { tabId: 202, at: Date.now() };
    h.state.health[101] = { alive: false, signedOut: false };
    const picked = await h.pick();
    assert.strictEqual(picked, null, 'an unresponsive leased tab must fail closed');
  }

  /* 6. INACTIVE lease releases the invariant: the explicit pin regains its
        v1.99 meaning and wins. */
  {
    const h = makeHarness();
    h.ctx.self.__mlsQp = { active: false, athenaTabId: 101 };
    h.ctx.self.__mlsAthPin = { tabId: 202, at: Date.now() };
    const picked = await h.pick();
    assert(picked && picked.id === 202, 'with no active lease the explicit pin must win');
  }

  /* 7. No lease + signed-out pinned tab -> honest null (v1.99 behavior kept). */
  {
    const h = makeHarness();
    h.ctx.self.__mlsAthPin = { tabId: 202, at: Date.now() };
    h.state.health[202] = { alive: true, signedOut: true };
    const picked = await h.pick();
    assert.strictEqual(picked, null, 'a signed-out pinned tab must fail honestly');
    assert(h.state.rejected.includes(202));
  }

  /* 8. No lease + closed pinned tab -> auto-unpin, then heuristic pick proceeds. */
  {
    const h = makeHarness();
    h.ctx.self.__mlsAthPin = { tabId: 999, at: Date.now() };
    const picked = await h.pick();
    assert(h.state.pinCleared >= 1, 'a closed pinned tab must auto-unpin');
    assert(picked && (picked.id === 101 || picked.id === 202), 'after auto-unpin the heuristic picker proceeds');
  }

  /* 9. No-yank sanity: selecting via the lease mutates no window/tab state
        (the picker only reads; it never activates or moves anything). */
  {
    const h = makeHarness();
    h.ctx.self.__mlsQp = { active: true, athenaTabId: 101 };
    h.ctx.chrome.tabs.update = async () => { throw new Error('picker must never activate a tab'); };
    h.ctx.chrome.windows = { update: async () => { throw new Error('picker must never focus a window'); } };
    const picked = await h.pick();
    assert(picked && picked.id === 101);
  }

  console.log('PASS athena tab lease-over-pin: active quiet-work lease outranks mutable pin, mid-cohort pin change cannot hop reads, unhealthy leases fail closed, pin semantics preserved when no lease');
})().catch(err => { console.error(err); process.exit(1); });
