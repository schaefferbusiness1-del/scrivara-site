'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const settings = read('feat_athena_tooltip_dedupe.js');
const centerpiece = read('feat_mls_centerpiece.js');
const fab = read('feat_fab_layout.js');
const connect = read('mls-connect.js');
const app = read('ScribeFlow.html');
const dictate = read('feat_mls_dictate_anywhere.js');
const theme = read('feat_mls_theme_polish.js');
const agentActions = read('feat_agent_actions3.js');
const sw = read('sw.js');

const settingsStart = settings.indexOf('single-owner UI + account access');
const settingsUi = settings.slice(settingsStart, settings.indexOf('visit-control continuity', settingsStart));
assert(!/ensureSettingsScrollGuard|preserveSettingsScroll|addEventListener\(['"](?:scroll|wheel|touchmove)/.test(settingsUi), 'Settings still installs a background scroll owner');
assert.strictEqual((settingsUi.match(/\.scrollTop\s*=/g) || []).length, 1, 'Settings reconciliation still writes native scroll position in the background');
assert(settingsUi.includes('if (body && resetScroll === true)') && settingsUi.includes('body.scrollTop = 0'), 'explicit Settings tab selection lost its sole intentional reset');

assert(centerpiece.includes("b.className === next.className && b.innerHTML === next.innerHTML"), 'acting-patient banner can still replace identical DOM every frame');
assert(centerpiece.includes("existing.className === node.className && existing.innerHTML === node.innerHTML"), 'patient walk strip can still rebuild identical buttons every frame');
assert(centerpiece.includes("document.getElementById('visitView') || document.body"), 'MLS Easy observer is not scoped to the Visit root');
assert(!centerpiece.includes("_obs.observe(document.body, { childList: true, subtree: true })"), 'MLS Easy still observes every body mutation');

assert(!fab.includes('_pollT = setInterval'), 'floating controls still force layout on a permanent timer');
assert(fab.includes('function scheduleLayout()') && fab.includes('function touchesLauncher('), 'floating controls lack filtered frame-coalesced layout');

assert(!connect.includes('reg[i].f()'), 'navigation still synchronously replays every registered UI timer');
assert(!connect.includes("document.addEventListener('click',onMaybeFlip,true)"), 'navigation still installs the global timer-replay click detector');
const messageFix = connect.slice(connect.indexOf('if(window.__mlsAthenaMsgFix)'), connect.indexOf('/* feat_canon_provider'));
assert(!messageFix.includes("document.querySelectorAll('div,span,p,li,small,em')"), 'one status-text mutation still triggers a whole-document text scan');
assert(messageFix.includes('function queue(node,deep)') && messageFix.includes('fix(batch[i].node,batch[i].deep)'), 'status text repair is not scoped to changed subtrees');
assert(app.includes("window.scrollTo({top:0,behavior:'auto'})"), 'view switches still fight an animated document scroll');

assert(!app.includes('<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>'), 'optional PDF tooling still blocks first paint');
assert(app.includes('function loadPdfJsOnDemand()'), 'PDF upload lost its lazy loader');

const tooltipBootStart = app.indexOf('/* Tooltip normalization is useful but not startup-critical.');
const tooltipBoot = app.slice(tooltipBootStart, app.indexOf('// backdrop closes modals', tooltipBootStart));
assert(tooltipBootStart >= 0, 'deferred tooltip startup block is missing');
assert(tooltipBoot.includes("requestIdleCallback(_tipBoot,{timeout:1400})") && tooltipBoot.includes('setTimeout(_tipBoot,900)'), 'tooltip normalization can block session restore again');
assert.strictEqual((tooltipBoot.match(/initTooltips\(\)/g) || []).length, 1, 'tooltip initialization has a duplicate eager path');

const tooltipOwner = settings.slice(0, settings.indexOf('single-owner UI + account access'));
assert(tooltipOwner.includes('[500,1500,3000].forEach') && tooltipOwner.includes('_bootTimers.push(setTimeout(schedulePass, delay))'), 'tooltip late-mount reconciliation is not bounded');
assert(tooltipOwner.includes('function relevantAddedNode(node)') && tooltipOwner.includes('if (relevantAddedNode(m.addedNodes[j]))'), 'tooltip observer no longer filters unrelated mutations');
assert(tooltipOwner.includes('function schedulePass()') && tooltipOwner.includes('W.requestAnimationFrame ? W.requestAnimationFrame(run)'), 'tooltip reconciliation is not frame-coalesced');
assert(!/setInterval\s*\(/.test(tooltipOwner), 'tooltip reconciliation added a permanent poll');
assert(tooltipOwner.includes('_bootTimers.forEach(function (timer) { clearTimeout(timer); })'), 'tooltip cleanup leaks bounded boot timers');

assert(theme.includes('if (!wrapped && retryCount++ < 8) retryT = setTimeout(retryBoot, 500)'), 'theme showView reconciliation is no longer bounded');
assert(!/setInterval\s*\(/.test(theme), 'theme polish added a permanent reconciliation poll');
assert(theme.includes('if (retryT) { clearTimeout(retryT); retryT = null; }'), 'theme retry timer is not cleaned up');
assert(theme.includes('viewRaf = window.requestAnimationFrame(function ()') && theme.includes('if (viewRaf != null && window.cancelAnimationFrame)'), 'theme transitions are not frame-owned and cancellable');

assert(!/new\s+MutationObserver\s*\(/.test(dictate), 'dictate placement must not observe the whole DOM');
assert(!/setInterval\s*\(/.test(dictate), 'dictate placement must not poll layout');
const dictateMoveStart = dictate.indexOf('function onMove()');
const dictateMove = dictate.slice(dictateMoveStart, dictate.indexOf('api.revert = function', dictateMoveStart));
assert(dictateMove.includes('if (moveRaf != null) return') && dictateMove.includes('window.requestAnimationFrame ? window.requestAnimationFrame(run)'), 'dictate scroll/resize placement is not coalesced to one animation frame');
assert(dictate.includes("window.addEventListener('scroll', onMove, { capture: true, passive: true })"), 'dictate scroll placement can block compositor scrolling');
assert(dictate.includes("window.addEventListener('resize', onMove, { passive: true })"), 'dictate resize placement is not passive');
assert(dictate.includes('if (moveRaf != null) { if (window.cancelAnimationFrame) window.cancelAnimationFrame(moveRaf); else clearTimeout(moveRaf); }'), 'dictate cleanup leaks a scheduled placement frame');
assert(dictate.includes("version: 'da-1.0.3'") && connect.includes('__mlsDictateAnywhere da-1.0.3'), 'dictate-anywhere runtime/loader contract is not da-1.0.3');

assert(!/new\s+MutationObserver|setInterval\s*\(|getBoundingClientRect\s*\(/.test(agentActions), 'agent actions still uses a whole-document observer, permanent poll, or forced layout read');
const agentRetry = /if\(attempts\+\+<(\d+)\) retryTimer=setTimeout\(boot,250\)/.exec(agentActions);
assert(agentRetry && Number(agentRetry[1]) > 0 && Number(agentRetry[1]) <= 80, 'agent actions late-mount retry is not explicitly bounded');
assert(agentActions.includes("window.addEventListener('mls:ui-ready',boot,{once:true})"), 'agent actions cannot retry once when the UI wave announces readiness');

const liveCallStart = app.indexOf('function _liveCallsCanPoll()');
const liveCall = app.slice(liveCallStart, app.indexOf('/* ===== Movable floating', liveCallStart));
assert(liveCallStart >= 0, 'live-call polling owner is missing');
assert(liveCall.includes("loader.getAttribute('aria-busy')==='true'") && liveCall.includes("loader.style.display!=='none'"), 'live calls can poll beneath the visible secure loader');
assert(liveCall.includes("window.addEventListener('mls:loader-ready',_startLiveCallPolling,{once:true})") && liveCall.includes('Promise.resolve(ready).then(_startLiveCallPolling'), 'live-call polling is not armed from real loader/session readiness');
assert(liveCall.includes('if(_liveCallsInFlight || !_liveCallsCanPoll()) return'), 'live-call polling can overlap or ignore page visibility');

const timerStart = connect.indexOf('/* ================= RC3: INTERVAL DEDUPE');
const timerOwner = connect.slice(timerStart, connect.indexOf('/* ================= RC4:', timerStart));
assert(timerStart >= 0, 'bounded interval wrapper is missing');
assert(timerOwner.includes("return !!(app&&app.style.display==='none')") && !/sfGateLoading|mls-secure-loading/.test(timerOwner), 'timer wrapper treats the visible secure loader as unavailable and blocks feature initialization');
const unavailableStart = timerOwner.indexOf('var uiUnavailable=function()');
const unavailableEnd = timerOwner.indexOf('uiBusyEvents.forEach', unavailableStart);
const unavailableCode = timerOwner.slice(unavailableStart, unavailableEnd);
const unavailableContext = {
  document: {
    hidden: false,
    getElementById(id) {
      if (id === 'appScreen') return { style: { display: 'block' } };
      if (id === 'sfGateLoading') return { style: { display: 'flex' }, getAttribute() { return 'true'; } };
      return null;
    }
  }
};
vm.runInNewContext(unavailableCode + '\nthis.uiUnavailable=uiUnavailable;', unavailableContext, { filename: 'loader-timer-availability.js' });
assert.strictEqual(unavailableContext.uiUnavailable(), false, 'visible-loader startup is incorrectly paused by the timer wrapper');

const versionRaw = fs.readFileSync(path.join(root, 'app-version.json'));
assert(versionRaw.length <= 64, 'app-version.json is no longer a tiny version probe');
assert.deepStrictEqual(JSON.parse(versionRaw.toString('utf8')), { build: '2026-07-15-b296' }, 'tiny version probe does not match b296');
const versionMarker = connect.indexOf('if(window.__mlsVersionCheck) return;');
const versionStart = connect.lastIndexOf('(function(){', versionMarker);
const versionEnd = connect.indexOf('\n(function(){', versionMarker);
assert(versionStart >= 0 && versionEnd > versionStart, 'app-version check module boundary is missing');
const versionCode = connect.slice(versionStart, versionEnd);
assert(versionCode.includes("var URL='app-version.json'") && versionCode.includes("fetch(URL+'?nc='+now,{cache:'no-store'})"), 'version check downloads more than the tiny no-store metadata file');
assert(versionCode.includes('if(checking) return checking') && versionCode.includes('if(now-lastCheck<60000)'), 'version check lost its in-flight or one-minute debounce');
assert(versionCode.includes('setInterval(check, 180000)') && versionCode.includes("window.addEventListener('focus', function(){ setTimeout(check, 1200); })"), 'version check cadence is no longer bounded');

// Runtime proof: the scheduled boot check and a focus check while it is pending
// must share one request. This catches a syntactically present but ineffective
// `checking` guard.
let fakeNow = 100000;
const versionTimeouts = [];
const versionIntervals = [];
const versionFetches = [];
let focusHandler = null;
const neverSettles = new Promise(function () {});
const versionWindow = {
  backendMode() { return true; },
  addEventListener(name, fn) { if (name === 'focus') focusHandler = fn; }
};
vm.runInNewContext(versionCode, {
  window: versionWindow,
  document: { createElement() { return {}; }, body: { appendChild() {} }, documentElement: { appendChild() {} } },
  fetch(url, opts) { versionFetches.push({ url, opts }); return neverSettles; },
  setTimeout(fn, delay) { versionTimeouts.push({ fn, delay }); return versionTimeouts.length; },
  setInterval(fn, delay) { versionIntervals.push({ fn, delay }); return versionIntervals.length; },
  Date: { now() { return fakeNow; } },
  Promise,
  JSON,
  Math,
  location: { pathname: '/ScribeFlow.html', reload() {} }
}, { filename: 'app-version-check.js' });
assert(versionTimeouts.some(task => task.delay === 8000) && versionIntervals.some(task => task.delay === 180000), 'version check did not register its bounded startup/steady cadence');
versionTimeouts.find(task => task.delay === 8000).fn();
assert.strictEqual(versionFetches.length, 1, 'initial version check did not issue exactly one request');
assert(/^app-version\.json\?nc=/.test(versionFetches[0].url) && versionFetches[0].opts.cache === 'no-store', 'runtime version probe did not use tiny no-store metadata');
assert(focusHandler, 'version focus listener was not installed');
focusHandler();
versionTimeouts.filter(task => task.delay === 1200).pop().fn();
assert.strictEqual(versionFetches.length, 1, 'focus created a duplicate in-flight version request');

const versionedBranchStart = sw.indexOf('const isVersionedAsset');
const versionedBranchEnd = sw.indexOf('const fetchReq', versionedBranchStart);
const versionedBranch = sw.slice(versionedBranchStart, versionedBranchEnd);
assert(versionedBranch.includes("url.searchParams.has('v')") && versionedBranch.includes('/\\.(?:js|css|woff2?)$/i.test(url.pathname)'), 'service worker does not limit immutable caching to exact-version assets');
assert(versionedBranch.includes('caches.match(req).then((cached) => cached || fetch(req)'), 'versioned assets are not cache-first');
assert(versionedBranch.includes('c.put(req, copy)'), 'service worker does not cache the exact query-versioned request');
assert(versionedBranch.includes('return;'), 'versioned cache-first branch can fall through into network-first');
assert(sw.includes("const fetchReq = isNav ? new Request(req.url, { cache: 'reload', credentials: 'same-origin' }) : req"), 'HTML navigation no longer remains network-first/reload');
const swFetchStart = sw.indexOf("self.addEventListener('fetch'");
const swFetch = sw.slice(swFetchStart);
assert.strictEqual((swFetch.match(/e\.waitUntil\(/g) || []).length, 2, 'service-worker cache writes can be terminated after respondWith resolves');
assert(swFetch.includes('e.waitUntil(response.then(() => cacheWrite).catch(() => {}))'), 'service-worker fetch lifetime is not tied to its deferred cache write');

console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.0.3');
