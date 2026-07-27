'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const app = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');

const session = app.slice(app.indexOf('function startSession(email)'), app.indexOf('function logout(force)'));
assert.strictEqual((session.match(/refreshMe\(_startupOpts\)/g) || []).length, 1, 'startup must issue exactly one identity/hydration pass');
assert(session.includes('Promise.all([') && session.includes('!bkToken()?Promise.resolve(true):_identityReady.then(()=>checkAgreementsGate(_startupOpts))'), 'legal readiness must fail closed without auth and otherwise follow canonical identity while data hydrates');
assert(session.includes('_startupOpts.cancelled=true') && session.includes('_startupController.abort()'), 'startup deadline must cancel late network results');
assert(session.includes('_armDeadline(30200)') && session.includes('window.__mlsSessionReady=_sessionReady'), 'startup must expose a bounded readiness promise inside the 32-second loader deadline');
// b419: deadlines re-arm instead of aborting while document.hidden (throttled
// background tab must not kill a healthy startup nobody is watching).
assert(session.includes('if(document.hidden){ _armDeadline(8000); return; }'), 'session deadline must defer while the window is hidden');
assert(session.includes('const _gateTimeout=new Promise(resolve=>') && session.includes('_armGate(10000)') && session.includes('if(document.hidden){ _armGate(5000); return; }') && session.includes('Promise.race([_gateAttempt,_gateTimeout])'), 'identity/compliance no longer has its own 10-second phase budget');
assert(session.includes("window.__mlsAbortUiBundle('session-deadline')"), 'the absolute session deadline does not abort unfinished UI work');

// Hosted startup is auth-first: an unsigned account must reach the compliance
// gate without downloading/parsing the 200+ optional UI assets. Signed users
// load the bundle only after the canonical agreement decision is known.
const uiGate = session.slice(session.indexOf('const _uiReady='), session.indexOf('const _hydrate=', session.indexOf('const _uiReady=')));
assert(uiGate.includes('_gateCheck.then(gated=>') && uiGate.includes('if(gated) return true;'), 'unsigned startup no longer bypasses the optional UI bundle');
assert(uiGate.indexOf('if(gated) return true;') < uiGate.indexOf('window.__mlsEnsureUiBundle()'), 'UI bundle can start before the agreement gate decision');
const hydrateGate = session.slice(session.indexOf('const _hydrate='), session.indexOf('const _deadline=', session.indexOf('const _hydrate=')));
assert(hydrateGate.includes('if(gated) return true;') && hydrateGate.includes('Promise.all([_refreshPromise,_uiReady])'), 'unsigned compliance handoff can still wait for unrelated cloud hydration');
assert(session.includes("typeof window.__mlsEnsureUiBundle==='function'?window.__mlsEnsureUiBundle():Promise.resolve(false)"), 'local/demo sessions lost their on-demand UI bundle handoff');

// Execute the tiny loader definition. Merely parsing the signed-out page must
// not append mls-connect; two callers after auth must share one script/promise.
const loaderMarker = app.indexOf('/* MLS-CONNECT auth-first loader.');
const loaderOpen = app.lastIndexOf('<script>', loaderMarker);
const loaderClose = app.indexOf('</script>', loaderOpen);
assert(loaderMarker >= 0 && loaderOpen >= 0 && loaderClose > loaderOpen, 'auth-first MLS-CONNECT loader script is missing');
const loaderCode = app.slice(app.indexOf('/* MLS-CONNECT', loaderOpen), loaderClose);
const criticalBlock = /var CRITICAL=\[([\s\S]*?)\];/.exec(loaderCode);
const criticalNames = criticalBlock ? Array.from(criticalBlock[1].matchAll(/'([^']+\.js)'/g), match => match[1]) : [];
assert(criticalNames.length >= 25, 'critical startup asset inventory is unexpectedly incomplete');
assert(loaderCode.includes("window.addEventListener('load',onLoad,true)") && loaderCode.includes("window.addEventListener('error',onLoad,true)"), 'critical assets are not captured from both load and error events');
assert(loaderCode.includes("state[name]='pending'") && loaderCode.includes("if(!state[name]) state[name]='missing'") && loaderCode.includes('var pending=assets.pending()'), 'critical asset settlement no longer distinguishes pending and missing assets');
assert(loaderCode.includes("expected.forEach(function(name){ if(state[name]!=='loaded') count++; })") && loaderCode.includes('assets.errors.length===0'), 'critical error/missing states can still satisfy readiness');
assert(loaderCode.includes('var quiet=now-assets.lastActivity>=900'), 'critical asset wave lost its 900ms quiet window');
assert(loaderCode.includes("abort(assets.errors.length?'critical-asset-error':'critical-ui-missing')") && loaderCode.includes("abort('critical-assets-timeout')"), 'critical errors or unfinished critical assets no longer fail closed');
assert(loaderCode.includes("s.src='mls-connect.js?v='+window.__MLS_AV") && loaderCode.includes('s.async=true') && loaderCode.includes('s.onload=function()'), 'main UI no longer uses a streaming exact-version external script');
assert(!loaderCode.includes('response.text()') && !loaderCode.includes("s.text=String(source||'')"), 'main UI is still buffered and copied as a multi-megabyte text blob');
assert(loaderCode.includes("var loadBudget=Math.max(1,Math.min(10000,hardAt-Date.now()-1200))") && loaderCode.includes("abort('main-load-timeout')"), 'main UI script lost its protected timeout budget');
assert(loaderCode.includes("if(!window.__MLS_APP_BUILD){ abort('main-execution-blocked'); return; }"), 'external main UI execution is not verified');
assert(loaderCode.includes('var gateStarted=') && loaderCode.includes('var releaseAt=gateStarted+SF_GATE_MAX_MS-SF_GATE_READY_HOLD_MS-SF_GATE_FADE_MS') && loaderCode.includes('var hardAt=releaseAt-Math.max(1400,SF_GATE_QUIET_MS+500)') && loaderCode.includes('var optionalWaitUntil=Math.min(hardAt,gateStarted+9000)'), 'UI deadlines are not derived from the active loader budget');
assert(loaderCode.includes('var optionalSettled=allPending===0||now>=optionalWaitUntil') && loaderCode.includes('if(pending===0&&optionalSettled&&quiet)'), 'a hung optional script can still hold the full-screen loader to its absolute deadline');
assert(!loaderCode.includes('assets.satelliteErrors.length===0&&critical'), 'optional satellite errors can still fail the critical UI');
assert(loaderCode.includes('window.__mlsAbortUiBundle=abort') && loaderCode.includes('if(window.__mlsAbortUiBundle===abort) window.__mlsAbortUiBundle=null'), 'UI abort hook is not single-owner or cleaned up');
assert(loaderCode.includes('s.onload=s.onerror=null') && loaderCode.includes('assets.abortPending()') && loaderCode.includes('assets.settled=true; assets.stop()'), 'UI abort does not retire the main script, satellites, and tracker listeners');

function makeLoaderHarness(options) {
  options = options || {};
  let now = 1000, seq = 0, context;
  const tasks = [];
  const captured = {};
  const assetNodes = [];
  const mainScripts = [];
  const removedMain = [];

  function setTimer(fn, ms) {
    const task = { id: ++seq, at: now + Math.max(0, Number(ms) || 0), fn, cancelled: false };
    tasks.push(task);
    return task.id;
  }
  function clearTimer(id) {
    const task = tasks.find(item => item.id === id);
    if (task) task.cancelled = true;
  }
  async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }
  async function advance(target) {
    await flush();
    while (true) {
      tasks.sort((a, b) => a.at - b.at || a.id - b.id);
      const index = tasks.findIndex(task => !task.cancelled);
      if (index < 0 || tasks[index].at > target) break;
      const task = tasks.splice(index, 1)[0];
      now = task.at;
      task.fn();
      await flush();
    }
    now = target;
    await flush();
  }

  const assetParent = {
    removeChild(node) { node.parentNode = null; node.removed = true; return node; }
  };
  function installCriticalAssets() {
    const last = criticalNames.length - 1;
    criticalNames.forEach(function (name, index) {
      if (options.assets === 'missing' && index === last) return;
      const listeners = {};
      const node = {
        tagName: 'SCRIPT', src: 'https://mlsscribe.com/' + name + '?v=' + (loaderWindow.__MLS_AV || 'test'), parentNode: assetParent,
        addEventListener(type, fn) { listeners[type] = fn; },
        getAttribute(attr) { return attr === 'data-mls-asset' ? name : null; }
      };
      assetNodes.push(node);
      if (options.assets === 'pending') return;
      const type = options.assets === 'error' && index === last ? 'error' : 'load';
      if (captured[type]) captured[type]({ target: node, type });
    });
    if (options.optionalPending || options.optionalError) {
      const optional = {
        tagName: 'SCRIPT', src: 'https://mlsscribe.com/optional-tool.js?v=' + (loaderWindow.__MLS_AV || 'test'), parentNode: assetParent,
        addEventListener() {}, getAttribute() { return null; }
      };
      assetNodes.push(optional);
      if (options.optionalError && captured.error) captured.error({ target: optional, type: 'error' });
    }
  }

  const loaderWindow = {
    addEventListener(name, fn) { captured[name] = fn; },
    removeEventListener(name, fn) { if (captured[name] === fn) delete captured[name]; },
    requestAnimationFrame(fn) { return setTimer(fn, 16); },
    dispatchEvent() {},
    __installCriticalAssets: installCriticalAssets
  };
  const appendHost = {
    appendChild(node) {
      node.parentNode = this;
      if (node.id === 'mlsUiBundleScript') {
        mainScripts.push({ id: node.id, source: node.attributes['data-mls-source'], src: node.src });
        if (options.mainPending) return node;
        if (options.mainError) { if (node.onerror) node.onerror(); return node; }
        vm.runInContext(fakeMainSource, context, { filename: 'external-mls-connect.js' });
        if (node.onload) node.onload();
      }
      return node;
    },
    removeChild(node) { node.parentNode = null; removedMain.push(node.id); return node; }
  };
  const fakeMainSource = "window.__MLS_APP_BUILD='2026-07-16-test';window.__mlsUiUnification={installed:true};window.__externalMainRuns=(window.__externalMainRuns||0)+1;window.__installCriticalAssets();";
  const document = {
    body: appendHost,
    documentElement: appendHost,
    getElementById(id) {
      if (loaderWindow.__externalMainRuns && /^(?:mlsRdTop|mlsEz3|visitView)$/.test(id)) return { id };
      return null;
    },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === 'script[src]' || selector === 'script[data-mls-asset][src]') return assetNodes.filter(node => !node.removed);
      return [];
    },
    createElement(tag) {
      return {
        tagName: String(tag).toUpperCase(), id: '', src: '', async: false, onload: null, onerror: null, parentNode: null, attributes: {},
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] || null; }
      };
    }
  };
  context = {
    window: loaderWindow,
    document,
    Promise,
    Date: { now() { return now; } },
    Math,
    URL,
    location: { href: 'https://mlsscribe.com/ScribeFlow.html' },
    MutationObserver: function MutationObserver() { this.observe = function () {}; this.disconnect = function () {}; },
    Event: function Event(name) { this.type = name; },
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    sfGateLoadingStarted: 1000,
    SF_GATE_MAX_MS: 32000,
    SF_GATE_QUIET_MS: 700,
    SF_GATE_READY_HOLD_MS: 40,
    SF_GATE_FADE_MS: 120
  };
  vm.createContext(context);
  vm.runInContext(loaderCode, context, { filename: 'on-demand-ui-loader.js' });
  return {
    context, window: loaderWindow, assetNodes, mainScripts, removedMain,
    flush, advance,
    timerDelays() { return tasks.filter(task => !task.cancelled).map(task => task.at - now).sort((a, b) => a - b); }
  };
}

async function verifyLoaderRuntime() {
  const success = makeLoaderHarness({ assets: 'success' });
  assert.strictEqual(success.mainScripts.length, 0, 'signed-out parse eagerly appended mls-connect.js');
  const firstBundle = success.window.__mlsEnsureUiBundle();
  const secondBundle = success.window.__mlsEnsureUiBundle();
  assert.strictEqual(firstBundle, secondBundle, 'concurrent UI-bundle callers did not share one in-flight promise');
  assert.strictEqual(success.mainScripts.length, 1, 'on-demand loader appended duplicate main scripts');
  assert.strictEqual(success.mainScripts[0].src, 'mls-connect.js?v=b735', 'main UI script is not exact-versioned');
  assert(success.timerDelays().includes(30440), 'loader-derived hard deadline was not scheduled');
  await success.flush();
  assert.strictEqual(success.mainScripts[0].id, 'mlsUiBundleScript');
  assert.strictEqual(success.mainScripts[0].source, 'mls-connect.js?v=b735');
  assert.strictEqual(success.window.__externalMainRuns, 1, 'external main source did not execute exactly once');
  await success.advance(2000);
  assert.strictEqual(await firstBundle, true, 'complete critical UI did not publish ready');
  assert.strictEqual(success.window.__mlsUiBundleReady, true);
  assert(!success.removedMain.includes('mlsUiBundleScript'), 'successful external main script was removed from the document');

  const error = makeLoaderHarness({ assets: 'error' });
  const errorResult = error.window.__mlsEnsureUiBundle();
  await error.flush();
  await error.advance(2000);
  assert.strictEqual(await errorResult, false, 'critical asset error incorrectly published readiness');
  assert.strictEqual(error.window.__mlsStartupAssets.reason, 'critical-asset-error');

  const missing = makeLoaderHarness({ assets: 'missing' });
  const missingResult = missing.window.__mlsEnsureUiBundle();
  await missing.flush();
  assert.strictEqual(missing.window.__mlsStartupAssets.state[criticalNames[criticalNames.length - 1]], 'missing', 'missing critical asset was not recorded');
  await missing.advance(31500);
  assert.strictEqual(await missingResult, false, 'missing critical asset incorrectly published readiness');

  const pending = makeLoaderHarness({ assets: 'pending' });
  const pendingResult = pending.window.__mlsEnsureUiBundle();
  await pending.flush();
  assert(Object.values(pending.window.__mlsStartupAssets.state).some(value => value === 'pending'), 'unsettled critical scripts were not marked pending');
  await pending.advance(31500);
  assert.strictEqual(await pendingResult, false, 'pending critical assets incorrectly published readiness');

  const optionalPending = makeLoaderHarness({ assets: 'success', optionalPending: true });
  const optionalPendingResult = optionalPending.window.__mlsEnsureUiBundle();
  await optionalPending.advance(8999);
  assert.strictEqual(optionalPending.window.__mlsUiBundleReady, undefined, 'optional grace period was skipped');
  await optionalPending.advance(10100);
  assert.strictEqual(await optionalPendingResult, true, 'one hung optional script trapped or failed the critical UI');
  assert.strictEqual(optionalPending.window.__mlsStartupAssets.degraded, true, 'optional pending state was not exposed diagnostically');

  const optionalError = makeLoaderHarness({ assets: 'success', optionalError: true });
  const optionalErrorResult = optionalError.window.__mlsEnsureUiBundle();
  await optionalError.advance(2000);
  assert.strictEqual(await optionalErrorResult, true, 'optional satellite error incorrectly failed the critical UI');
  assert(optionalError.window.__mlsStartupAssets.satelliteErrors.length > 0, 'optional error was not retained for diagnostics');

  const timeout = makeLoaderHarness({ mainPending: true });
  const timeoutResult = timeout.window.__mlsEnsureUiBundle();
  await timeout.advance(11100);
  assert.strictEqual(await timeoutResult, false, 'hung main script escaped its timeout');
  assert.strictEqual(timeout.window.__mlsStartupAssets.reason, 'main-load-timeout');
  assert(timeout.removedMain.includes('mlsUiBundleScript'), 'main-load timeout did not remove its unfinished script');

  const manual = makeLoaderHarness({ mainPending: true });
  const manualResult = manual.window.__mlsEnsureUiBundle();
  assert.strictEqual(typeof manual.window.__mlsAbortUiBundle, 'function', 'loader did not publish its abort hook');
  manual.window.__mlsAbortUiBundle('test-abort');
  await manual.advance(1100);
  assert.strictEqual(await manualResult, false, 'manual loader abort did not resolve failed readiness');
  assert(manual.removedMain.includes('mlsUiBundleScript'), 'manual loader abort left its main script attached');
  assert.strictEqual(manual.window.__mlsAbortUiBundle, null, 'loader abort hook was not retired');
  assert.strictEqual(manual.window.__mlsStartupAssets.settled, true, 'manual loader abort did not stop its tracker');
  assert(!manual.timerDelays().includes(10000) && !manual.timerDelays().includes(30440), 'loader abort leaked its load/hard timers');
}

const refresh = app.slice(app.indexOf("var _refreshMeInFlight=null"), app.indexOf('function handle401()'));
assert(refresh.includes('if(_refreshMeInFlight&&_refreshMeToken===token)'), 'identity refresh requests are not coalesced');
assert(refresh.includes('await Promise.allSettled(['), 'patient, record, and preference hydration is still fire-and-forget');
assert(refresh.includes('loadPatientsFromServer(childOpts)') && refresh.includes('loadRecordsFromServer(childOpts)') && refresh.includes('loadPrefsFromServer(childOpts)'), 'a startup store is missing from the hydration barrier');
assert(refresh.includes("deferRender:true") && refresh.includes("window.__mlsUiUnification.reconcile"), 'startup data must reconcile once beneath the loader');
assert.strictEqual((refresh.match(/renderHistory\(\)/g) || []).length, 1, 'hidden startup can render History more than once');
assert.strictEqual((refresh.match(/updateNavCounts\(\)/g) || []).length, 1, 'hidden startup can update navigation counts more than once');

const patientHydration = app.slice(app.indexOf('async function loadPatientsFromServer(opts)'), app.indexOf('/* ---------- HEAD-DOCTOR TEAM VIEW', app.indexOf('async function loadPatientsFromServer(opts)')));
assert(patientHydration.includes('const localIndex=new Map()') && patientHydration.includes('localIndex.has(row.external_id)?localIndex.get(row.external_id):-1'), 'patient hydration regressed to repeated linear identity scans');
assert(patientHydration.includes('const additions=[]') && patientHydration.includes('additions.concat(local)'), 'new cloud patients are not batched into one saved merge');
assert(!patientHydration.includes('.findIndex('), 'patient hydration still performs O(server x local) findIndex scans');
assert(patientHydration.includes('if(!opts.deferRender)') && patientHydration.indexOf('if(!opts.deferRender)') < patientHydration.indexOf('updateNavCounts()'), 'deferred patient hydration can repaint hidden navigation');

const recordHydration = app.slice(app.indexOf('async function loadRecordsFromServer(opts)'), app.indexOf('function renderHistory()', app.indexOf('async function loadRecordsFromServer(opts)')));
assert(recordHydration.includes('const localIndex=new Map()') && recordHydration.includes('localIndex.has(rec.id)?localIndex.get(rec.id):-1'), 'record hydration regressed to repeated linear identity scans');
assert(recordHydration.includes('localIndex.set(rec.id,local.length-1)'), 'new records are not added to the hydration index');
assert(!recordHydration.includes('.findIndex('), 'record hydration still performs O(server x local) findIndex scans');
assert(recordHydration.includes('if(!opts.deferRender)') && recordHydration.indexOf('if(!opts.deferRender)') < recordHydration.indexOf('renderHistory()'), 'deferred record hydration can repaint hidden History');

for (const fn of ['loadPrefsFromServer(opts)', 'loadPatientsFromServer(opts)', 'loadRecordsFromServer(opts)']) {
  assert(app.includes('async function ' + fn), fn + ' does not accept the shared startup signal');
}
assert((app.match(/if\(opts\.signal\) init\.signal=opts\.signal/g) || []).length >= 5, 'not every startup request is abortable');
const gate = app.slice(app.indexOf('async function checkAgreementsGate(opts)'), app.indexOf('async function agBuildReceiptPdf'));
assert(!gate.includes('showAgreementsGate()'), 'agreement lookup must return a decision instead of bypassing loader timing');
assert(gate.includes('if(!sfStartupValid(opts)) return true'), 'late legal-readiness responses can still fail open after startup cancellation');

verifyLoaderRuntime().then(function () {
  console.log('PASS startup hydration: phased session, streaming external UI load, bounded optional grace, fail-closed critical assets, and loader-owned deadline');
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
