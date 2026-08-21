'use strict';

/* Adversarial regression for two owner-reported extension failures:
 *  - a discarded/unloaded exact athenaOne tab is sleeping, not signed out;
 *    only an explicit open-patient pull may activate it, and selection still
 *    requires the normal all-frame session proof after Chrome restores it;
 *  - the legacy note-only control delegates Athena to the existing supervised
 *    review surface without reopening the retired untyped write path. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const autopull = fs.readFileSync(path.join(root, 'feat_athena_autopull.js'), 'utf8');
const app1p = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const appProd = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function functionBlock(source, name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function makePickerHarness(mode, lease) {
  const athena = {
    id: 101, windowId: 2, active: false, discarded: true, status: 'unloaded',
    url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp',
    title: 'athenaOne - synthetic patient', lastAccessed: 2000
  };
  const app = { id: 9, windowId: 1, active: true, url: 'https://mlsscribe.com/ScribeFlow.html', title: 'MLS', lastAccessed: 3000 };
  const state = { mode: mode || 'success', updates: [], windowUpdates: [], pings: [], rejected: [], pinClears: 0 };
  const tabs = { 9: app, 101: athena };
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, RegExp, Boolean, URL,
    setTimeout, clearTimeout,
    self: {
      __mlsQp: lease ? { active: true, athenaTabId: 101 } : { active: false, athenaTabId: null },
      __mlsAthPin: { tabId: null, at: 0 },
      __mlsAthPickCache: { tabId: 101, at: Date.now() }
    },
    chrome: {
      tabs: {
        query: async q => Object.values(tabs).filter(t => !q || q.windowId == null || t.windowId === q.windowId),
        get: async id => {
          if (!tabs[id]) throw new Error('missing tab');
          return tabs[id];
        },
        update: async (id, patch) => {
          assert.strictEqual(id, 101, 'only the exact Athena candidate may be activated');
          assert.strictEqual(patch && patch.active, true, 'wake must activate the exact tab');
          assert.strictEqual(Object.keys(patch || {}).length, 1, 'wake must be activation-only');
          state.updates.push({ id, patch });
          Object.values(tabs).forEach(t => { if (t.windowId === tabs[id].windowId) t.active = false; });
          tabs[id].active = true;
          tabs[id].discarded = false;
          tabs[id].status = 'complete';
          return tabs[id];
        }
      },
      windows: {
        getLastFocused: async () => ({ id: 1, focused: true }),
        update: async (id, patch) => { state.windowUpdates.push({ id, patch }); return { id, focused: true }; }
      }
    },
    mlsSleepW: async () => {},
    mlsAthTabHost: t => { try { return new URL(t.url).hostname; } catch (_) { return ''; } },
    mlsAthIsLoginish: () => false,
    mlsAthScore: t => t.discarded ? -140 : 200,
    mlsTabTitleAthena: () => true,
    mlsAthPing: async (tabId, budget) => {
      state.pings.push({ tabId, budget });
      if (state.mode === 'success') return { alive: true, reachable: true, signedOut: false, cal: true, fs: true, calTabs: 7 };
      if (state.mode === 'signedout') { state.rejected.push(tabId); return { alive: false, reachable: true, signedOut: true, timedOut: true }; }
      return { alive: false, reachable: false, signedOut: false };
    },
    mlsAthRejectSignedOut: id => { state.rejected.push(id); },
    mlsPinSet: value => { if (value == null) state.pinClears++; },
    mlsPickGenericEmrTab: () => { throw new Error('athenaOnly path must never use a generic fallback'); }
  };
  vm.createContext(ctx);
  vm.runInContext([
    functionBlock(background, 'mlsAthTabSleeping'),
    functionBlock(background, 'mlsAthWakeExplicitReadTab'),
    functionBlock(background, 'mlsPickAthenaTab'),
    'this.pick = mlsPickAthenaTab;'
  ].join('\n'), ctx);
  return { ctx, state, athena, app, pick: opts => ctx.pick([athena, app], opts) };
}

function nextTurn() { return new Promise(resolve => setImmediate(resolve)); }

function makeLegacyHarness(source, response) {
  const listeners = new Set(), messages = [], toasts = [];
  let reviews = 0;
  const win = {
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'message') listeners.delete(fn); },
    postMessage(data) {
      messages.push(data);
      if (data.type === 'mlsPing') queueMicrotask(() => emit({ source: 'mls-ext', type: 'mlsPong' }));
      if (data.type === 'mlsAppPasteNote') queueMicrotask(() => emit({ source: 'mls-ext', type: 'mlsAppPasteResult', resp: response }));
    }
  };
  function emit(data) { Array.from(listeners).forEach(fn => fn({ data })); }
  const ctx = {
    console, Promise, window: win,
    currentSoap: 'Synthetic clinical note', currentInsurance: '', currentFormat: 'soap',
    emrReadyText: () => 'Synthetic clinical note',
    toast: (msg, kind) => { toasts.push({ msg, kind }); },
    pushEntireVisitToAthena: () => { reviews++; return true; },
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: () => 1, clearTimeout: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(`${functionBlock(source, 'sendToEMRviaAssist')}; this.send = sendToEMRviaAssist;`, ctx);
  return { ctx, messages, toasts, reviews: () => reviews };
}

(async () => {
  /* Explicit, signed-in sleeping tab: activate once, verify after wake, select. */
  {
    const h = makePickerHarness('success', false);
    const opts = { athenaOnly: true, explicitUserPull: true, foregroundOk: true, appTabId: 9 };
    const picked = await h.pick(opts);
    assert(picked && picked.id === 101, 'explicit pull did not recover the sleeping exact Athena tab');
    assert.strictEqual(h.state.updates.length, 1, 'sleeping Athena was not activated exactly once');
    assert(h.state.pings.length >= 1, 'restored tab was trusted without a session probe');
    assert(opts.frontState && opts.frontState.appTabId === 9, 'focus-restore state was not retained');
    assert.strictEqual(h.state.rejected.length, 0, 'sleeping tab was evicted as signed out');
  }

  /* Bounded wake failure remains a sleeping verdict and preserves preference. */
  {
    const h = makePickerHarness('unreachable', false);
    const opts = { athenaOnly: true, explicitUserPull: true, foregroundOk: true, appTabId: 9 };
    assert.strictEqual(await h.pick(opts), null);
    assert.strictEqual(opts.failure.reason, 'athena-tab-sleeping');
    assert.strictEqual(opts.failure.signedOut, false);
    assert.strictEqual(h.state.rejected.length, 0, 'unreachable wake evicted the cache/pin as if signed out');
    assert.strictEqual(h.ctx.self.__mlsAthPickCache.tabId, 101, 'sleep alone cleared the picker cache');
    assert.strictEqual(h.state.pinClears, 0, 'sleep alone cleared an Athena pin');
    assert.strictEqual(h.state.pings.length, 3, 'wake failure did not stop at the bounded three-probe ceiling');
  }

  /* The same failure on an explicitly pinned sleeping tab preserves the pin. */
  {
    const h = makePickerHarness('unreachable', false);
    h.ctx.self.__mlsAthPin = { tabId: 101, at: Date.now() };
    const opts = { athenaOnly: true, explicitUserPull: true, foregroundOk: true, appTabId: 9 };
    assert.strictEqual(await h.pick(opts), null);
    assert.strictEqual(opts.failure.reason, 'athena-tab-sleeping');
    assert.strictEqual(h.ctx.self.__mlsAthPin.tabId, 101, 'sleeping pinned tab was unpinned without signed-out proof');
    assert.strictEqual(h.state.pinClears, 0, 'sleeping pinned tab called mlsPinSet(null)');
  }

  /* A restored tab that paints a timeout/login remains a distinct signed-out verdict. */
  {
    const h = makePickerHarness('signedout', false);
    const opts = { athenaOnly: true, explicitUserPull: true, foregroundOk: true, appTabId: 9 };
    assert.strictEqual(await h.pick(opts), null);
    assert.strictEqual(opts.failure.reason, 'athena-signed-out');
    assert.strictEqual(opts.failure.signedOut, true);
    assert(h.state.rejected.includes(101), 'real signed-out proof was not quarantined');
  }

  /* An awake but temporarily unreachable tab is also not relabelled signed out. */
  {
    const h = makePickerHarness('unreachable', false);
    h.athena.discarded = false; h.athena.status = 'complete';
    const opts = { athenaOnly: true };
    assert.strictEqual(await h.pick(opts), null);
    assert.strictEqual(opts.failure.reason, 'athena-tab-unreachable');
    assert.strictEqual(opts.failure.signedOut, false);
    assert.strictEqual(h.state.updates.length, 0);
    assert.strictEqual(h.state.rejected.length, 0, 'unreachable awake tab was evicted as signed out');
  }

  /* Quiet/background selection never wakes, even if the candidate is exact. */
  {
    const h = makePickerHarness('success', false);
    const opts = { athenaOnly: true };
    assert.strictEqual(await h.pick(opts), null);
    assert.strictEqual(h.state.updates.length, 0, 'quiet picker activated a sleeping Athena tab');
    assert.strictEqual(h.state.windowUpdates.length, 0, 'quiet picker focused an Athena window');
    assert.strictEqual(h.state.rejected.length, 0, 'quiet picker called sleep signed-out');
  }

  /* An active batch lease is never woken by this path. */
  {
    const h = makePickerHarness('success', true);
    const opts = { athenaOnly: true, explicitUserPull: true, foregroundOk: true, appTabId: 9 };
    assert.strictEqual(await h.pick(opts), null);
    assert.strictEqual(h.state.updates.length, 0, 'active quiet-work lease was auto-woken');
    assert.strictEqual(opts.failure.reason, 'athena-tab-sleeping');
  }

  const wakeSource = functionBlock(background, 'mlsAthWakeExplicitReadTab');
  const pingSource = functionBlock(background, 'mlsAthPing');
  assert(!/tabs\.reload|reload\s*\(/.test(wakeSource), 'wake helper contains an explicit reload');
  assert(/allFrames:\s*true/.test(pingSource), 'post-wake session proof is not all-frame');
  const captureAt = background.indexOf("msg.type === 'mlsAppCaptureRequest'");
  const captureEnd = background.indexOf("msg.type === 'mlsAppPasteRequest'", captureAt);
  const captureHandler = background.slice(captureAt, captureEnd);
  assert(/allFrames:\s*true/.test(captureHandler), 'open-patient capture does not read all restored frames');
  assert(/reason:\s*'athena-tab-sleeping'/.test(captureHandler), 'wake failure is not returned honestly');
  assert(/reason:\s*'athena-tab-unreachable'/.test(captureHandler), 'unreachable awake tab is still called signed out');
  assert(/explicitUserPull:\s*msg\.explicitUserPull === true/.test(captureHandler), 'capture handler widened wake authority');
  assert(/explicitUserPull:\s*d\.explicitUserPull === true/.test(content), 'content bridge did not preserve explicit-pull authority');
  assert(/explicitUserPull:\s*true,\s*foregroundOk:\s*true/.test(autopull), 'open-patient button did not mark its bounded explicit wake');
  const searchBridgeAt = content.indexOf('/* (2) Search-and-navigate relay');
  const searchBridge = content.slice(searchBridgeAt);
  assert(searchBridgeAt >= 0, 'exact-patient search bridge is missing');
  assert(/function mlsSearchRelayRetry\(req, cb\)/.test(searchBridge), 'exact-patient search bridge has no bridge-local bounded retry helper');
  assert(/mlsSearchRelayRetry\(\{ type: 'mlsAppSearchOpenRequest'/.test(searchBridge), 'exact-patient search request bypasses its bridge-local retry helper');
  assert(!/\bmlsRelayRetry\(\{ type: 'mlsAppSearchOpenRequest'/.test(searchBridge), 'exact-patient search bridge calls an out-of-scope retry helper');

  /* Athena legacy paste response delegates to review; no write is performed. */
  for (const source of [app1p, appProd]) {
    const h = makeLegacyHarness(source, {
      ok: false, blocked: true, reason: 'legacy-untyped-write-disabled',
      delegate: 'athena-supervised-review-v2'
    });
    const btn = { disabled: false, innerHTML: 'Paste note text only' };
    h.ctx.send(btn, {});
    await nextTurn(); await nextTurn();
    assert.strictEqual(h.reviews(), 1, 'legacy Athena control did not open the supervised review exactly once');
    assert.strictEqual(h.messages.filter(m => m.type === 'mlsAppPasteNote').length, 1, 'legacy control dispatched an unexpected second write message');
    assert.strictEqual(btn.disabled, false, 'delegated legacy control stayed disabled');
    assert.strictEqual(h.toasts.length, 0, 'successful review delegation falsely reported a write outcome');
  }

  /* The same control keeps the generic non-Athena response path unchanged. */
  {
    const h = makeLegacyHarness(app1p, { ok: true, persisted: true, serverVerified: true });
    h.ctx.send({ disabled: false, innerHTML: 'Paste note text only' }, {});
    await nextTurn(); await nextTurn();
    assert.strictEqual(h.reviews(), 0, 'generic EMR success was incorrectly routed to Athena review');
    assert(h.toasts.some(t => /durably verified/.test(t.msg) && t.kind === 'ok'), 'generic EMR success receipt changed');
  }

  const pasteAt = background.indexOf("msg.type === 'mlsAppPasteRequest'");
  const pasteHandler = background.slice(pasteAt, background.indexOf('// Screenshot', pasteAt));
  const delegateAt = pasteHandler.indexOf("delegate: 'athena-supervised-review-v2'");
  const identityAt = pasteHandler.indexOf("let chartId =");
  assert(delegateAt >= 0 && identityAt > delegateAt, 'Athena delegation does not return before the legacy writer path');
  assert(/hasExactAthena/.test(pasteHandler), 'sleeping/unreachable Athena can still fall through to an unrelated generic EMR paste');
  assert(/legacy-untyped-write-disabled/.test(pasteHandler), 'Athena untyped-write kill switch was loosened');
  assert(/mlsNotePaster/.test(pasteHandler), 'generic non-Athena paste implementation was removed');

  console.log('PASS extension Mac sleeping-tab + legacy review: explicit exact-tab wake is bounded/all-frame/no-reload, sleep is never signed-out or auto-woken by quiet/batch work, and Athena note-only delegates to supervised review while generic EMR behavior stays intact');
})().catch(err => { console.error(err); process.exit(1); });
