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
const stagingApp = read('ScribeFlow-staging.html');
const dictate = read('feat_mls_dictate_anywhere.js');
const theme = read('feat_mls_theme_polish.js');
const agentActions = read('feat_agent_actions3.js');
const stagingPack = read('feat_mls_staging_pack1.js');
const viewToggle = read('feat_mls_viewtoggle.js');
const redesign = read('feat_mls_redesign.js');
const historyExact = read('feat_mls_history_exact.js');
const topbar = read('feat_mls_topbar_unify.js');
const clarity = read('feat_athena_clarity.js');
const cardTips = read('feat_athena_cardtips_noinfo.js');
const findDoctors = read('feat_mls_find_doctors.js');
const smartScope = read('feat_mls_pick_smartscope.js');
const noteMetrics = read('feat_mls_note_metrics.js');
const noteAutofit = read('feat_mls_note_autofit.js');
const b18 = read('feat_b18_qa.js');
const fixpack = read('feat_mls_fixpack_0701.js');
const calendarExact = read('feat_mls_calendar_exact.js');
const headerExact = read('feat_mls_header_exact.js');
const athenaActions = read('feat_athena_actions.js');
const sw = read('sw.js');

const exactBuiltMarkers = [
  ['feat_mls_analysis_exact.js', 'data-ax-built'],
  ['feat_mls_calendar_exact.js', 'data-cx-built'],
  ['feat_mls_help_exact.js', 'data-hpx-built'],
  ['feat_mls_legal_exact.js', 'data-lx-built'],
  ['feat_mls_login_exact.js', 'data-lgx-built'],
  ['feat_mls_orders_exact.js', 'data-ox-built'],
  ['feat_mls_patients_exact.js', 'data-px-built'],
  ['feat_mls_recs_exact.js', 'data-rx-built'],
  ['feat_mls_settings_exact.js', 'data-stx-built'],
  ['feat_mls_studio_exact.js', 'data-sx-built'],
  ['feat_mls_team_exact.js', 'data-tx-built']
];
exactBuiltMarkers.forEach(([file, attr]) => {
  const source = read(file);
  assert(source.includes(`getAttribute("${attr}") !== VERSION`), `${file} can still rewrite an identical built marker`);
});
assert(read('feat_mls_visit_exact.js').includes('getAttribute(BUILT_ATTR) !== VERSION'), 'Visit can still rewrite an identical built marker');

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
assert(connect.includes("if (visit && visit.style.display === 'none') return;") &&
  connect.includes("window.addEventListener('mls:view-changed', laneViewChanged)"),
  'the Visit-only primary lane can still perform layout work after another route becomes active');
const messageFix = connect.slice(connect.indexOf('if(window.__mlsAthenaMsgFix)'), connect.indexOf('/* feat_canon_provider'));
assert(!messageFix.includes("document.querySelectorAll('div,span,p,li,small,em')"), 'one status-text mutation still triggers a whole-document text scan');
assert(messageFix.includes('function queue(node,deep)') && messageFix.includes('fix(batch[i].node,batch[i].deep)'), 'status text repair is not scoped to changed subtrees');
assert(connect.includes("if (!c.birthdays) [].forEach.call(document.querySelectorAll('span,em,i,b,div')"), 'visible birthdays still trigger a full-document classification scan every two seconds');

const gradientMarker = connect.indexOf("if (window.__mlsEz3Gradient) { return; }");
const gradientStart = connect.lastIndexOf('(function () {', gradientMarker);
const gradientEnd = connect.indexOf('/* =============================================================================\n * __mlsEz3Flow', gradientMarker);
assert(gradientMarker >= 0 && gradientStart >= 0 && gradientEnd > gradientMarker, 'gradient style owner slice is missing');
const gradientSource = connect.slice(gradientStart, gradientEnd);
assert(!gradientSource.includes('setInterval(ensureCss, 3000)'), 'gradient style guard still wakes every three seconds');
assert(gradientSource.includes('headObserver.observe(document.documentElement, { childList: true })') && gradientSource.includes('headObserver.observe(observedHead, { childList: true })'), 'gradient style recovery is not scoped to direct head/root changes');
assert(!gradientSource.includes('subtree: true'), 'gradient style recovery observes high-churn body descendants');

let gradientIntervalCalls = 0;
let gradientObserver = null;
function GradientObserver(callback) { this.callback = callback; this.targets = []; gradientObserver = this; }
GradientObserver.prototype.observe = function (target, options) { this.targets.push({ target, options }); };
GradientObserver.prototype.disconnect = function () { this.targets = []; };
GradientObserver.prototype.emit = function (records) { this.callback(records); };
function gradientHead(label) {
  return {
    label, children: [],
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; },
    removeChild(node) { const at = this.children.indexOf(node); if (at >= 0) this.children.splice(at, 1); node.parentNode = null; return node; }
  };
}
const firstGradientHead = gradientHead('first');
const gradientDocument = {
  head: firstGradientHead,
  documentElement: {},
  createElement(tag) { return { tagName: String(tag).toUpperCase(), id: '', textContent: '', parentNode: null }; },
  getElementById(id) { return (this.head && this.head.children || []).find(node => node.id === id) || null; }
};
const gradientWindow = { document: gradientDocument };
gradientWindow.window = gradientWindow;
vm.runInNewContext(gradientSource, {
  window: gradientWindow, document: gradientDocument, MutationObserver: GradientObserver,
  setInterval() { gradientIntervalCalls++; return gradientIntervalCalls; },
  clearInterval() {}
}, { filename: 'gradient-style-owner.js' });
assert.strictEqual(gradientIntervalCalls, 0, 'gradient owner registered a permanent interval');
let gradientStyle = gradientDocument.getElementById('mlsEz3GradientCss');
assert(gradientStyle && gradientObserver, 'gradient style or scoped observer was not installed');
firstGradientHead.removeChild(gradientStyle);
gradientObserver.emit([{ target: firstGradientHead, removedNodes: [gradientStyle] }]);
assert(gradientDocument.getElementById('mlsEz3GradientCss'), 'exact style removal was not repaired');
const secondGradientHead = gradientHead('second');
gradientDocument.head = secondGradientHead;
gradientObserver.emit([{ target: gradientDocument.documentElement, removedNodes: [firstGradientHead], addedNodes: [secondGradientHead] }]);
assert(gradientDocument.getElementById('mlsEz3GradientCss'), 'wholesale head replacement was not repaired');
assert(gradientObserver.targets.some(entry => entry.target === secondGradientHead && entry.options.childList === true),
  'style observer did not rebind to the replacement head');
gradientWindow.__mlsEz3Gradient_revert();
assert.strictEqual(gradientDocument.getElementById('mlsEz3GradientCss'), null, 'gradient revert left its style behind');
assert.strictEqual(gradientObserver.targets.length, 0, 'gradient revert left its observer connected');

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

assert(!/setInterval\s*\(/.test(theme), 'theme polish added a permanent reconciliation poll');
assert(!/mlsThmViewIn|mls-thm-viewin|__thmWrapped|opacity:\s*\.35/.test(theme), 'theme polish can still dim or animate an entire route during navigation');
const showViewStart = app.indexOf('function showView(v)');
const showViewSource = app.slice(showViewStart, app.indexOf('function showPatients()', showViewStart));
assert(!/mlsViewIn|opacity:\s*\.35|style\.animation/.test(showViewSource), 'base navigation can still dim or animate an entire route');

assert(!/new\s+MutationObserver\s*\(/.test(dictate), 'dictate placement must not observe the whole DOM');
assert(!/setInterval\s*\(/.test(dictate), 'dictate placement must not poll layout');
const dictateMoveStart = dictate.indexOf('function onMove()');
const dictateMove = dictate.slice(dictateMoveStart, dictate.indexOf('api.revert = function', dictateMoveStart));
assert(dictateMove.includes('if (moveRaf != null) return') && dictateMove.includes('window.requestAnimationFrame ? window.requestAnimationFrame(run)'), 'dictate scroll/resize placement is not coalesced to one animation frame');
assert(dictate.includes("window.addEventListener('scroll', onMove, { capture: true, passive: true })"), 'dictate scroll placement can block compositor scrolling');
assert(dictate.includes("window.addEventListener('resize', onMove, { passive: true })"), 'dictate resize placement is not passive');
assert(dictate.includes('if (moveRaf != null) { if (window.cancelAnimationFrame) window.cancelAnimationFrame(moveRaf); else clearTimeout(moveRaf); }'), 'dictate cleanup leaks a scheduled placement frame');
const dictateLoader = connect.split(/\r?\n/).find(line => line.includes("var A='feat_mls_dictate_anywhere.js',V='da-1.1.1'")) || '';
assert(dictate.includes("var VERSION = 'da-1.1.1'") && dictate.includes('version: VERSION') && dictateLoader.includes("s.src=A+'?v=20260719da111h1'") && dictateLoader.includes("s.setAttribute('data-mls-version',V)"), 'dictate-anywhere runtime/loader contract is not exact da-1.1.1');

assert(!/setInterval\s*\(|getBoundingClientRect\s*\(/.test(agentActions), 'agent actions still uses a permanent poll or forced layout read');
assert(agentActions.includes('panelObserver.observe(panel,{childList:true,subtree:true})'), 'agent actions is not scoped to its own panel for re-render recovery');
const agentRetry = /if\(attempts\+\+<(\d+)\) retryTimer=setTimeout\(boot,250\)/.exec(agentActions);
assert(agentRetry && Number(agentRetry[1]) > 0 && Number(agentRetry[1]) <= 80, 'agent actions late-mount retry is not explicitly bounded');
assert(agentActions.includes("window.addEventListener('mls:ui-ready',boot)") && agentActions.includes("window.addEventListener('mls:agent-mounted',boot)"), 'agent actions cannot recover after its UI or panel remounts');
assert(!stagingPack.includes('setInterval(mountAgent') && stagingPack.includes("dispatchEvent(new CustomEvent('mls:agent-mounted'"), 'agent panel still polls forever or fails to announce its exact mount');
assert(!stagingPack.includes('setInterval(mountTplBar') && !stagingPack.includes('setInterval(mountOpPrepUpload'), 'template/op-prep controls still run permanent mount polls');
assert(stagingPack.includes('new window.MutationObserver(scheduleTemplateMounts)') && stagingPack.includes('templateMountRetryIndex >= templateMountRetryDelays.length'), 'template/op-prep remount recovery is not scoped and bounded');

assert(!/setInterval\s*\(/.test(viewToggle), 'Simple/Complex toggle still wakes an idle tab on a permanent timer');
assert(viewToggle.includes('bs.classList.contains("mlsVtOn") !== simpleOn') && viewToggle.includes('bf.getAttribute("aria-pressed") !== String(fullOn)'), 'view toggle can still write identical class/ARIA state');
assert(viewToggle.includes('_obs.observe(header, { childList: true, subtree: true })') && !viewToggle.includes('_obs.observe(document.documentElement'), 'view toggle observer is not scoped to the header');
assert(viewToggle.includes('_sentinelObs.observe(sentinel, { childList: true })') && viewToggle.includes('liveHeader !== _headerRoot') && viewToggle.includes('bindHeaderObserver(); }'), 'view toggle cannot reconnect its scoped observer after wholesale header replacement');

assert(redesign.includes('new MutationObserver(onMutations)') && redesign.includes('if(relevantNode(added[j])) needsApply=true'), 'redesign still schedules a full reconciliation for every document mutation');
const premiumStart = redesign.indexOf('function normalizePremiumBadges(root)');
const premiumSource = redesign.slice(premiumStart, redesign.indexOf('function refreshUserChip', premiumStart));
const premiumNodeStart = redesign.indexOf('function normalizePremiumBadgeNode(s)');
const premiumNodeSource = redesign.slice(premiumNodeStart, premiumStart);
assert(premiumStart >= 0 && !premiumSource.includes('getBoundingClientRect'), 'premium-badge reconciliation still forces layout while scanning');
assert(redesign.includes('[250,700,1600,3200].forEach') && !redesign.includes("_t=setInterval(function(){ applyAll()"), 'redesign late-mount recovery is still a permanent reconcile loop');
assert(redesign.includes("_lifeObs.observe(root,{childList:true})") && redesign.includes("var appChanged=current!==_observedRoot") && redesign.includes("if(!appChanged&&root===_lifeRoot) return;") && redesign.includes("var root=$('appScreen');"), 'redesign cannot reconnect its scoped observer after wholesale app replacement');
assert(!redesign.includes('_lifeObs.observe(root,{childList:true,subtree:true})') && !redesign.includes('_obs.observe(document.documentElement'), 'redesign app-remount recovery observes a document-wide high-churn subtree');
assert(redesign.includes('characterData:true') && redesign.includes("if(record.type==='characterData')") && redesign.includes('if(textOnly&&target&&target.nodeType===1)'), 'redesign misses premium badges created by text-only mutations');
assert(premiumNodeStart >= 0 && premiumNodeSource.includes("if(s.getAttribute('class')!=='mlsRdPrem')") && premiumNodeSource.includes("if(s.hasAttribute('style'))") && premiumNodeSource.includes("t!=='PREMIUM'"), 'premium-badge text mutation normalization is not idempotent');

assert(historyExact.includes('getAttribute("data-on") !== next') && historyExact.includes('getAttribute("data-hy-built") !== VERSION'), 'history chips can still write identical attributes every pass');
assert(!historyExact.includes('observe(document.documentElement') && historyExact.includes('_obs.observe(v, { childList: true, subtree: true })'), 'history reconciliation is not scoped to its view');
assert(!/setInterval\s*\(/.test(topbar) && topbar.includes('function mutationNeedsApply(records)'), 'topbar still polls or processes every page mutation');
assert(topbar.includes('function menuHost() { return gid("mlsRdMenuSlot") || tools(); }') && topbar.includes('t.contains(existing) || host.contains(existing)'), 'topbar and redesign do not share one canonical live-menu host');
assert(topbar.includes("if (el&&!el.classList.contains(HIDE)) el.classList.add(HIDE)"), 'topbar can still rewrite identical hidden classes');
assert(topbar.includes('_sentinelObs.observe(sentinel, { childList: true })') && topbar.includes('liveRoot !== _obsRoot') && topbar.includes('safe(bindObserver)'), 'topbar cannot reconnect its scoped observer after wholesale header replacement');

const decorateStart = clarity.indexOf('function decorateOne(btn)');
const decorateSource = clarity.slice(decorateStart, clarity.indexOf('function restoreOne', decorateStart));
assert(decorateSource.indexOf('btn.getAttribute(ATTR)') < decorateSource.indexOf('matchEntry(btn)'), 'Athena clarity still performs catalog matching before its idempotency guard');
assert(!cardTips.includes('_pollT = setInterval') && cardTips.includes('addedNodes'), 'Athena card tips still polls or rescans on unrelated mutations');
assert(!/setInterval\s*\(tick/.test(findDoctors) && findDoctors.includes('requestAnimationFrame'), 'Find Doctors still has a permanent reconciliation tick');
assert(!smartScope.includes('_poll = setInterval') && smartScope.includes('__mlsSmartRenderKey'), 'patient smart scope still polls or rebuilds identical content');
assert(noteMetrics.includes('if (rec.lastValue === value) return') && noteAutofit.includes('rec.lastValue === value && rec.lastCap === cap'), 'note metrics/autofit lost their idle value guards');
assert(b18.includes("['mlsP1AgFab',16],['mlsAddPtLauncher',70],['mlsVoiceFab',124]") && !b18.includes("el.style.setProperty('right','18px'"), 'FAB owners disagree on coordinates and can rewrite one another');
const cleanupStart = connect.indexOf('if(window.__mlsUiCleanupB26) return;');
const cleanupSource = connect.slice(cleanupStart, connect.indexOf('(function(){\n  if(window.__mlsBootLoader)', cleanupStart));
assert(cleanupSource.includes("target.closest('#emrPanel,#mlsWbcModal')") && cleanupSource.includes('records[i].removedNodes||[]'), 'UI cleanup cannot recover an internal EMR/modal control removal after boot');
assert(!cleanupSource.includes('setInterval(tick,800)'), 'UI cleanup still runs its old permanent layout heartbeat');
assert(!/setInterval\s*\(/.test(fixpack), 'July fix-pack still installs a permanent idle poll');
assert(fixpack.includes('t === entry.lastValue && show === entry.lastShow') && fixpack.includes('html !== entry.lastHtml'), 'formatted preview can still rewrite unchanged HTML');
assert(fixpack.includes('new MutationObserver(function (records)') && fixpack.includes('Finite retry bursts cover programmatic textarea fills'), 'fix-pack lost event-driven remount/programmatic-fill recovery');
assert(calendarExact.includes('if (!card.classList.contains("cx-agenda"))') && calendarExact.includes('_obs.observe(root, { childList: true, subtree: true })') && !calendarExact.includes('_obs.observe(document.documentElement'), 'calendar design reconciliation still writes/observes outside its owned view');
assert(headerExact.includes('getAttribute("data-hx-relocated") !== "1"'), 'header can still rewrite an identical relocation marker');
assert(athenaActions.includes("if (btn.getAttribute('data-mlsaa-intent') !== it.brings) btn.setAttribute"), 'Athena action clarity can still rewrite an identical intent attribute');

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
assert.deepStrictEqual(JSON.parse(versionRaw.toString('utf8')), { build: '2026-07-25-b1151' }, 'tiny version probe does not match b1151');
const versionMarker = connect.indexOf('if(window.__mlsVersionCheck) return;');
const versionStart = connect.lastIndexOf('(function(){', versionMarker);
const versionEnd = connect.indexOf('\n(function(){', versionMarker);
assert(versionStart >= 0 && versionEnd > versionStart, 'app-version check module boundary is missing');
const versionCode = connect.slice(versionStart, versionEnd);
assert(versionCode.includes("var URL='app-version.json'") && versionCode.includes("fetch(URL+'?nc='+now,{cache:'no-store'})"), 'version check downloads more than the tiny no-store metadata file');
assert(versionCode.includes('if(checking) return checking') && versionCode.includes('if(now-lastCheck<60000)'), 'version check lost its in-flight or one-minute debounce');
assert(versionCode.includes('setInterval(check, 180000)') &&
  versionCode.includes("window.addEventListener('focus', function(){ setTimeout(check, 1200); })") &&
  versionCode.includes("document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&!document.hidden)setTimeout(check,1200);})"),
  'version check cadence is no longer bounded across boot, focus, and visible-tab return');

// Runtime proof: the scheduled boot check and a focus check while it is pending
// must share one request. This catches a syntactically present but ineffective
// `checking` guard.
let fakeNow = 100000;
const versionTimeouts = [];
const versionIntervals = [];
const versionFetches = [];
let focusHandler = null;
let visibilityHandler = null;
const neverSettles = new Promise(function () {});
const versionWindow = {
  backendMode() { return true; },
  addEventListener(name, fn) { if (name === 'focus') focusHandler = fn; }
};
vm.runInNewContext(versionCode, {
  window: versionWindow,
  document: {
    hidden: false,
    visibilityState: 'visible',
    addEventListener(name, fn) { if (name === 'visibilitychange') visibilityHandler = fn; },
    createElement() { return {}; }, body: { appendChild() {} }, documentElement: { appendChild() {} }
  },
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
assert(visibilityHandler, 'version visible-tab listener was not installed');
visibilityHandler();
versionTimeouts.filter(task => task.delay === 1200).pop().fn();
assert.strictEqual(versionFetches.length, 1, 'visible-tab return created a duplicate in-flight version request');

const exactVersionHelperStart = sw.indexOf('function isExactVersionedAsset');
const exactVersionHelperEnd = sw.indexOf('function isSafeCacheUrl', exactVersionHelperStart);
const exactVersionHelper = sw.slice(exactVersionHelperStart, exactVersionHelperEnd);
assert(exactVersionHelperStart > -1 && exactVersionHelperEnd > exactVersionHelperStart, 'service worker lost its exact-version asset classifier');
assert(exactVersionHelper.includes('/\\.(?:m?js|css|woff2?)$/i.test(url.pathname)'), 'service worker exact-version classifier does not cover the reviewed JS/MJS/CSS/font set');
assert(exactVersionHelper.includes("keys.length !== 1 || keys[0] !== 'v'"), 'versioned cache entry can carry extra query keys');
assert(exactVersionHelper.includes("/^[A-Za-z0-9._-]{1,96}$/.test(url.searchParams.get('v') || '')"), 'versioned cache key lacks a bounded safe value rule');

const versionedBranchStart = sw.indexOf('const isVersionedAsset');
const versionedBranchEnd = sw.indexOf('/* Token-capable documents', versionedBranchStart);
const versionedBranch = sw.slice(versionedBranchStart, versionedBranchEnd);
assert(versionedBranch.includes('isExactVersionedAsset(url)'), 'immutable cache branch bypasses the exact-version classifier');
assert(versionedBranch.includes('caches.match(req).then((cached) => {'), 'versioned assets are not cache-first');
assert(/\bput\(req, copy\)/.test(versionedBranch), 'service worker does not cache the exact query-versioned request');
assert(versionedBranch.includes('caches.open(CACHE)'), 'safe hits are not promoted into the current immutable cache');
/* The promotion must not fire on entries that are ALREADY in CACHE. The branch
 * used to caches.match() across every cache and then put() the hit back on every
 * single request - a disk-backed CacheStorage write per asset per boot, measured
 * at 1.7ms each across the 205 assets this app requests after login, all on the
 * one service-worker thread everything else is queued behind. Asking the current
 * cache first keeps the promotion (an entry found only in an older named cache is
 * still copied forward) and drops the redundant write. */
assert(versionedBranch.includes('current.match(req)'), 'versioned hits must be checked against the CURRENT cache first, or every hit is re-written to disk');
assert(versionedBranch.includes('return;'), 'versioned cache-first branch can fall through into network-first');
assert(sw.includes("new Request(req, { cache: (isNetworkOnlyNavigation(url) || !!url.search) ? 'no-store' : 'reload' })"), 'HTML navigation lost its network-first reload/no-store policy');
const swFetchStart = sw.indexOf("self.addEventListener('fetch'");
const swFetch = sw.slice(swFetchStart);
assert.strictEqual((swFetch.match(/e\.waitUntil\(/g) || []).length, 2, 'service-worker cache writes can be terminated after respondWith resolves');
assert(swFetch.includes('e.waitUntil(response.then(() => cacheWrite).catch(() => {}))'), 'service-worker fetch lifetime is not tied to its deferred cache write');

/* 2026-07-29: the active 700ms Easy Home poll must not rescan the roster for
 * unused status values or replace an unchanged status subtree. */
const easyV373Start = connect.indexOf("var VER = '3.7.3';");
const easyV373End = connect.indexOf('window.__mlsEasyV32 = api;', easyV373Start);
assert(easyV373Start >= 0 && easyV373End > easyV373Start, 'active Easy 3.7.3 owner slice is missing');
const easyV373 = connect.slice(easyV373Start, easyV373End);
const easyHomeStatusStart = easyV373.indexOf('function homeStatus() {');
const easyHomeStatusEnd = easyV373.indexOf('\n  function homeSig() {', easyHomeStatusStart);
const easyHomeStatus = easyV373.slice(easyHomeStatusStart, easyHomeStatusEnd);
assert(easyHomeStatusStart >= 0 && easyHomeStatusEnd > easyHomeStatusStart,
  'active Easy homeStatus slice is missing');
assert(!easyHomeStatus.includes('dayRows(') && !easyHomeStatus.includes('isSeen'),
  'homeStatus returned to unused per-appointment roster/seen work');
assert(easyV373.includes("if (st) setHomeStatusHtml(st, homeStatus());"),
  'stable Easy status HTML does not use the canonical write guard');
assert(!easyV373.includes("if (st) st.innerHTML = homeStatus();"),
  'unguarded Easy status subtree replacement returned');

const statusWriterStart = easyV373.indexOf('function setHomeStatusHtml(st, hs) {');
const statusWriterEnd = easyV373.indexOf('\n\n  function homeStatus() {', statusWriterStart);
assert(statusWriterStart >= 0 && statusWriterEnd > statusWriterStart,
  'active Easy canonical status writer is missing');
const statusWriterSource = easyV373.slice(statusWriterStart, statusWriterEnd);
const statusWriterCtx = {};
vm.runInNewContext(statusWriterSource + '\nthis.setHomeStatusHtml=setHomeStatusHtml;', statusWriterCtx,
  { filename: 'easy-home-status-writer.js' });
let statusWrites = 0, canonicalStatusHtml = '';
const statusNode = {};
Object.defineProperty(statusNode, 'innerHTML', {
  configurable: true,
  get() { return canonicalStatusHtml; },
  set(value) {
    statusWrites++;
    canonicalStatusHtml = String(value)
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  }
});
const punctuatedStatus = '<span><b>Dr. Synthetic O&#39;Name &amp; &quot;West&quot;</b></span>';
statusWriterCtx.setHomeStatusHtml(statusNode, punctuatedStatus);
assert.strictEqual(statusWrites, 1, 'initial punctuated Home status was not written exactly once');
statusWriterCtx.setHomeStatusHtml(statusNode, punctuatedStatus);
assert.strictEqual(statusWrites, 1,
  'browser-canonical punctuation caused a stable Home status rewrite');
const changedStatus = '<span><b>Dr. Synthetic O&#39;Name &amp; &quot;East&quot;</b></span>';
statusWriterCtx.setHomeStatusHtml(statusNode, changedStatus);
assert.strictEqual(statusWrites, 2, 'changed Home status did not repaint exactly once');
canonicalStatusHtml = '<span>external replacement</span>';
statusWriterCtx.setHomeStatusHtml(statusNode, changedStatus);
assert.strictEqual(statusWrites, 3, 'external Home status mutation did not self-heal');

/* 2026-07-29: Copilot autogrow performs one required layout read per call. */
function checkCopilotAutogrow(source, label, measuredHeight, expectedHeight) {
  const start = source.indexOf('function _copilotAutogrow(el){');
  const end = source.indexOf('\n', start);
  assert(start >= 0 && end > start, label + ' Copilot autogrow source is missing');
  const fnSource = source.slice(start, end);
  assert.strictEqual((fnSource.match(/scrollHeight/g) || []).length, 1,
    label + ' Copilot autogrow performs more than one forced layout read');
  assert(!fnSource.includes('el.height||0||el.scrollHeight'),
    label + ' Copilot autogrow restored the overwritten middle assignment');
  const ctx = {};
  vm.runInNewContext(fnSource + ';this.autogrow=_copilotAutogrow;', ctx,
    { filename: label + '-copilot-autogrow.js' });
  let reads = 0;
  const writes = [];
  const style = {};
  Object.defineProperty(style, 'height', {
    configurable: true,
    get() { return writes.length ? writes[writes.length - 1] : ''; },
    set(value) { writes.push(value); }
  });
  const el = { style };
  Object.defineProperty(el, 'scrollHeight', { get() { reads++; return measuredHeight; } });
  ctx.autogrow(el);
  assert.strictEqual(reads, 1, label + ' Copilot autogrow must read scrollHeight once');
  assert.deepStrictEqual(writes, ['auto', expectedHeight + 'px'],
    label + ' Copilot autogrow changed its reset/final height writes');
}
checkCopilotAutogrow(app, 'production', 210, 150);
checkCopilotAutogrow(stagingApp, 'staging', 90, 90);

console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');
