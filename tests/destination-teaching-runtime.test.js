'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'feat_mls_show_assistant.js'), 'utf8');
const flow = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
const guard = fs.readFileSync(path.join(root, 'destination_teach_navigation_guard.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const stagingConnect = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function between(source, begin, end) {
  const a = source.indexOf(begin); assert(a >= 0, `missing ${begin}`);
  const b = source.indexOf(end, a + begin.length); assert(b > a, `missing ${end}`);
  return source.slice(a + begin.length, b);
}
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`); assert(start >= 0, `missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

// The old service's arbitrary MLS-page click fallback and orphan modal must be
// gone. The unified review is the only visible owner.
assert(!/inAppListener|document\.addEventListener\(['"]click['"],\s*inApp/i.test(service), 'destination teaching can still capture an arbitrary MLS-page click');
assert(!/mlsShowAsstPanel|injectButtons\s*[:=]|Show me where/i.test(service), 'orphan destination-teaching modal/button injection still exists');
assert(/teachingHtml\(manifest, row\)/.test(flow) && /wireUnifiedTeaching\(state, card\)/.test(flow), 'teaching is not integrated beside immutable unified-review rows');
assert(/taughtDestination:\s*currentTaughtDestination/.test(flow) && /taughtDestination:\s*taughtDestination/.test(flow), 'probe and confirmed execute do not both consume the exact taught destination');
assert(/taught-destination-binding-mismatch/.test(background) && /validateTaughtDestination/.test(background), 'background does not fail closed on a changed taught destination');
assert(/mlsAppTeachStart/.test(content) && /destinationTeachingV2:\s*true/.test(content), 'trusted app bridge does not expose destination teaching');
assert(/target\s*!==\s*actionControl/.test(background), 'teaching still accepts an unrelated element elsewhere in the broad action scope');
assert(/appointmentId:\s*mlsStr\(v\.appointmentId/.test(content), 'appointment ID is dropped by the app/extension bridge');
assert(/!digits\(patient\.mrn\)/.test(background) && /!patient\.mrn/.test(flow), 'patient binding still permits a name+DOB-only Athena action');
assert(/teacher\.cancelForRow\(state\.manifest, row\)[\s\S]{0,140}teacher\.clearForRow/.test(flow), 'Clear/re-teach does not cancel the active watcher first');
assert(/addEventListener\(['"]pagehide['"],\s*onPageExit/.test(service) && /cancelAllActive\(['"]revert/.test(service), 'service teardown does not exact-cancel active watchers');
assert(!/addEventListener\(['"]unload['"]/.test(service), 'Chrome-blocked unload lifecycle listener returned');
assert(connect.includes('A+"?v=20260718sa3"') && stagingConnect.includes('A+"?v=20260718sa3"'), 'fixed destination-teaching lifecycle script is not cache-busted in both loaders');
assert(manifest.permissions.includes('webNavigation'), 'frame-generation retirement lacks webNavigation permission');
assert(/runAt:\s*['"]document_start['"]/.test(background) && /destination_teach_navigation_guard\.js/.test(background), 'new Athena documents are not shielded from document_start');
assert(/stopImmediatePropagation/.test(guard) && /mlsAthenaTeachNavigationGuardReady/.test(guard), 'navigation guard does not block activation until background retirement');

// App lifecycle: pagehide/revert must emit one exact Cancel before local
// teardown, remain idempotent, and allow a BFCache-restored page to start anew.
// Chrome blocks unload listeners in this document, so pagehide is the sole
// browser-exit owner and must not be paired with the obsolete unload event.
const serviceEvents = Object.create(null);
const servicePosts = [];
const sessionData = new Map();
const serviceWindow = {
  location: { origin: 'https://mlsscribe.com' },
  sessionStorage: {
    getItem(key) { return sessionData.get(key) || null; },
    setItem(key, value) { sessionData.set(key, String(value)); },
    removeItem(key) { sessionData.delete(key); }
  },
  addEventListener(type, fn) { (serviceEvents[type] || (serviceEvents[type] = [])).push(fn); },
  removeEventListener(type, fn) { serviceEvents[type] = (serviceEvents[type] || []).filter(item => item !== fn); },
  postMessage(message) { servicePosts.push(JSON.parse(JSON.stringify(message))); }
};
serviceWindow.window = serviceWindow;
const serviceCtx = vm.createContext({ window: serviceWindow, console, Date, Math, String, Number, Object, Array, JSON, RegExp, setTimeout, clearTimeout });
vm.runInContext(service, serviceCtx, { filename: 'feat_mls_show_assistant.js' });
const serviceManifest = {
  manifestHash: 'manifest-service', previewHash: 'preview-service',
  patient: { patientId: 'pt-service', name: 'Service Patient', dob: '01/02/1980', mrn: '9911' },
  visit: { visitDate: '07/14/2026', provider: 'Service Doctor, MD', appointmentId: '77114' }
};
const serviceRow = { id: 'write-note', rowHash: 'row-service', action: 'write_note', kind: 'note', capability: 'ready' };
const firstServiceId = serviceWindow.__mlsShowAsst.startForRow(serviceManifest, serviceRow, function () {});
assert(firstServiceId && servicePosts.some(message => message.type === 'mlsAppTeachStart' && message.requestId === firstServiceId), 'service did not start exact teaching');
serviceEvents.pagehide[0]({ persisted: true });
assert.strictEqual(servicePosts.filter(message => message.type === 'mlsAppTeachCancel' && message.requestId === firstServiceId).length, 1, 'pagehide did not emit one exact cancel');
assert.strictEqual((serviceEvents.unload || []).length, 0, 'obsolete unload listener was registered');
const restoredServiceId = serviceWindow.__mlsShowAsst.startForRow(serviceManifest, serviceRow, function () {});
assert(restoredServiceId && restoredServiceId !== firstServiceId, 'BFCache-style pagehide prevented a fresh teaching session');
serviceWindow.__mlsShowAsst.revert();
assert.strictEqual(servicePosts.filter(message => message.type === 'mlsAppTeachCancel' && message.requestId === restoredServiceId).length, 1, 'revert did not exact-cancel restored teaching');
assert.strictEqual((serviceEvents.pagehide || []).length, 0, 'revert left pagehide cancellation listener installed');

// Exercise the injected watcher itself. The teaching click must be consumed in
// capture phase, so neither an Athena target handler nor a browser default
// action can fire.
const watcherSource = between(background, '/* DESTINATION_TEACH_WATCHER_START */', '/* DESTINATION_TEACH_WATCHER_END */');
const docListeners = Object.create(null);
const sentCaptures = [];
let targetHandlerRan = false;
let defaultActionRan = false;
const fakeDoc = {
  nodeType: 9,
  body: null,
  querySelectorAll(selector) { return selector === '#teach-target' ? [target] : []; },
  addEventListener(type, fn) { docListeners[type] = fn; },
  removeEventListener(type, fn) { if (docListeners[type] === fn) delete docListeners[type]; }
};
const target = {
  nodeType: 1, tagName: 'BUTTON', id: 'teach-target', parentElement: null, textContent: 'Sign & Save', value: '', labels: [], ownerDocument: fakeDoc,
  getRootNode: () => fakeDoc,
  matches(selector) { return selector.indexOf('button') >= 0; },
  getAttribute(name) { if (name === 'aria-label') return 'Sign & Save'; return ''; }
};
const icon = {
  nodeType: 1, tagName: 'svg', id: '', parentElement: target, textContent: '', value: '', labels: [], ownerDocument: fakeDoc,
  getRootNode: () => fakeDoc, matches() { return false; }, getAttribute() { return ''; }
};
fakeDoc.body = target;
const fakeWindow = {
  document: fakeDoc, frames: [], location: { href: 'https://athenanet.athenahealth.com/encounter/12345' },
  addEventListener(type, fn) { docListeners[type] = fn; },
  removeEventListener(type, fn) { if (docListeners[type] === fn) delete docListeners[type]; }
};
fakeWindow.top = fakeWindow;
const watcherTimers = [];
const watcherCtx = {
  window: fakeWindow, document: fakeDoc, console,
  chrome: { runtime: { lastError: null, sendMessage(message, cb) { sentCaptures.push(message); if (cb) cb({ ok: true }); } } },
  setTimeout(fn, ms) { watcherTimers.push({ fn, ms }); return watcherTimers.length; }, clearTimeout() {},
  String, Number, Array, Math, Object, globalThis: null
};
watcherCtx.globalThis = watcherCtx;
vm.createContext(watcherCtx);
const watcher = vm.runInContext(`${watcherSource}; mlsAthenaTeachWatcherFn`, watcherCtx);
const watcherStart = watcher({ mode: 'start', sessionId: 'watcher-safe-click', timeoutMs: 60000 });
assert.strictEqual(watcherStart.ok, true, 'read-only watcher did not attach');
assert.strictEqual(typeof docListeners.pointerdown, 'function', 'watcher did not register an early pointer capture listener');
assert.strictEqual(typeof docListeners.click, 'function', 'watcher did not register a click capture listener');
for (const type of ['pointerup','pointercancel','mouseup','touchend','touchcancel','auxclick','dblclick','contextmenu']) {
  assert.strictEqual(typeof docListeners[type], 'function', `watcher omitted activation event ${type}`);
}
const teachingEvent = {
  isTrusted: true, target: icon, composedPath: () => [icon, target], prevented: false, immediateStopped: false, propagationStopped: false,
  preventDefault() { this.prevented = true; },
  stopImmediatePropagation() { this.immediateStopped = true; },
  stopPropagation() { this.propagationStopped = true; }
};
docListeners.pointerdown(teachingEvent);
const syntheticClick = {
  isTrusted: true, target: icon, composedPath: () => [icon, target], prevented: false, immediateStopped: false, propagationStopped: false,
  preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediateStopped = true; }, stopPropagation() { this.propagationStopped = true; }
};
docListeners.click(syntheticClick);
if (!teachingEvent.immediateStopped) targetHandlerRan = true;
if (!teachingEvent.prevented) defaultActionRan = true;
assert.strictEqual(teachingEvent.prevented, true, 'teaching click did not prevent the Athena control default action');
assert.strictEqual(teachingEvent.immediateStopped, true, 'teaching click did not stop Athena target handlers');
assert.strictEqual(teachingEvent.propagationStopped, true, 'teaching click continued propagating through Athena');
assert.strictEqual(targetHandlerRan, false, 'Athena target handler fired during destination teaching');
assert.strictEqual(defaultActionRan, false, 'Athena default action fired during destination teaching');
assert.strictEqual(syntheticClick.prevented, true, 'synthetic click after pointerdown was not consumed');
assert.strictEqual(syntheticClick.immediateStopped, true, 'synthetic click reached Athena handlers');
assert.strictEqual(sentCaptures.length, 1, 'watcher did not report exactly one captured target');
assert.strictEqual(sentCaptures[0].target.selector, '#teach-target', 'watcher did not produce the unique robust selector');
assert.strictEqual(sentCaptures[0].target.sectionLabel, 'Sign & Save', 'watcher did not preserve the exact section/control label');
assert.strictEqual(sentCaptures[0].target.tag, 'button', 'SVG/icon click was not canonicalized to the owning Athena control');

// Cancellation/validation must not drop the shield while a long press is down.
const longPressStart = watcher({ mode: 'start', sessionId: 'watcher-long-press', timeoutMs: 60000 });
assert.strictEqual(longPressStart.ok, true);
const longDown = {
  type: 'pointerdown', pointerId: 77, isTrusted: true, target: icon, composedPath: () => [icon, target], prevented: false, immediateStopped: false,
  preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediateStopped = true; }, stopPropagation() {}
};
docListeners.pointerdown(longDown);
assert.strictEqual(watcher({ mode: 'cancel', sessionId: 'watcher-long-press' }).reason, 'cancelled');
const longUp = {
  type: 'pointerup', pointerId: 77, isTrusted: true, target: icon, composedPath: () => [icon, target], prevented: false, immediateStopped: false,
  preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediateStopped = true; }, stopPropagation() {}
};
docListeners.pointerup(longUp);
const longClick = {
  type: 'click', isTrusted: true, target: icon, composedPath: () => [icon, target], prevented: false, immediateStopped: false,
  preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediateStopped = true; }, stopPropagation() {}
};
docListeners.click(longClick);
assert(longUp.prevented && longUp.immediateStopped && longClick.prevented && longClick.immediateStopped, 'cancel dropped the shield before long-press release/trailing click');

// A stale cancel for the prior session must not remove the newer frame watcher.
const watcherSecond = watcher({ mode: 'start', sessionId: 'watcher-new-session', timeoutMs: 60000 });
assert.strictEqual(watcherSecond.ok, true);
const staleCancel = watcher({ mode: 'cancel', sessionId: 'watcher-safe-click', timeoutMs: 60000 });
assert.strictEqual(staleCancel.reason, 'not-watching', 'stale cancel was allowed to target the active newer session');
const capturesBeforeSecond = sentCaptures.length;
const secondEvent = {
  isTrusted: true, target: icon, composedPath: () => [icon, target], prevented: false, immediateStopped: false, propagationStopped: false,
  preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediateStopped = true; }, stopPropagation() { this.propagationStopped = true; }
};
docListeners.pointerdown(secondEvent);
assert.strictEqual(sentCaptures.length, capturesBeforeSecond + 1, 'stale cancel killed the newer watcher');
assert.strictEqual(sentCaptures[sentCaptures.length - 1].sessionId, 'watcher-new-session');

// Exercise background lifecycle states with a fully mocked Chrome boundary.
// This covers watcher unavailable, expiry, wrong tab, wrong patient, and a
// successful validated selector capture.
const handlerSource = '/* ATHENA_ACTION_V2_HANDLER_START */' + between(background, '/* ATHENA_ACTION_V2_HANDLER_START */', '/* ATHENA_ACTION_V2_HANDLER_END */');
const runtimeListeners = [];
const tabRemovedListeners = [];
const tabUpdatedListeners = [];
const navigationListeners = [];
const progress = [];
const injections = [];
const timers = [];
let signedInTabs = [{ id: 7, url: 'https://athenanet.athenahealth.com/22724/6/encounter/12345' }];
let pendingTabQuery = null;
let watcherUnavailable = false;
let driverResult = null;
let driverResultPromise = null;
let frameSnapshot = [{ frameId: 0, parentFrameId: -1, documentId: 'doc-1', url: signedInTabs[0].url }];
let watcherStartResults = null;
const chrome = {
  runtime: { lastError: null, onMessage: { addListener(fn) { runtimeListeners.push(fn); } } },
  tabs: {
    async query() { if (pendingTabQuery) return pendingTabQuery.promise; return signedInTabs.slice(); },
    sendMessage(tabId, message, cb) { progress.push({ tabId, message }); if (cb) cb({ ok: true }); },
    onRemoved: { addListener(fn) { tabRemovedListeners.push(fn); } },
    onUpdated: { addListener(fn) { tabUpdatedListeners.push(fn); } }
  },
  scripting: {
    async unregisterContentScripts() {},
    async registerContentScripts() {},
    async executeScript(options) {
      injections.push(options);
      const name = options.func && options.func.name;
      if (name === 'mlsAthenaTeachWatcherFn') {
        if (watcherUnavailable && options.args[0].mode === 'start') throw new Error('watcher unavailable');
        if (options.args[0].mode === 'start' && watcherStartResults) return watcherStartResults;
        return [{ frameId: 0, result: { ok: true, state: options.args[0].mode === 'start' ? 'waiting' : 'failed', frameCount: options.args[0].mode === 'start' ? 1 : 0 } }];
      }
      if (name === 'mlsAthenaActionV2DriverFn') return [{ result: driverResultPromise ? await driverResultPromise : driverResult }];
      throw new Error(`unexpected injected function ${name}`);
    }
  },
  webNavigation: {
    async getAllFrames() { return frameSnapshot.map(frame => Object.assign({}, frame)); },
    onBeforeNavigate: { addListener(fn) { navigationListeners.push(fn); } }
  }
};
const handlerCtx = {
  self: {}, chrome, console, URL, crypto: webcrypto,
  mlsAthenaTeachWatcherFn() {}, mlsAthenaActionV2DriverFn() {},
  mlsAthTabHost(tab) { try { return new URL(tab.url).hostname; } catch { return ''; } },
  mlsAthIsLoginish() { return false; },
  setTimeout(fn, ms) { const rec = { fn, ms, cleared: false }; timers.push(rec); return rec; },
  clearTimeout(rec) { if (rec) rec.cleared = true; },
  Date, Math, String, Number, Object, Array, JSON, RegExp, Uint32Array, Promise, Set, Map
};
vm.createContext(handlerCtx);
vm.runInContext(handlerSource, handlerCtx);

const appSender = { tab: { id: 42, url: 'https://mlsscribe.com/ScribeFlow.html' } };
const athenaSender = tabId => ({ tab: { id: tabId, url: 'https://athenanet.athenahealth.com/22724/6/encounter/12345' } });
const baseBinding = id => ({ schema: 'mls-taught-destination-context-v2', contextHash: `ctx-${id}`, action: 'write_note', kind: 'note', rowId: 'write-note', rowHash: `row-${id}`, manifestHash: `manifest-${id}`, previewHash: `preview-${id}`, patientHash: 'patient-hash', visitHash: 'visit-hash' });
const startMessage = id => ({ type: 'mlsAppTeachStartRequest', requestId: id, action: 'write_note', binding: baseBinding(id), expectedPatient: { patientId: 'pt-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123' }, expectedContext: { visitDate: '07/14/2026', provider: 'Example Doctor, MD', appointmentId: '54321' }, timeoutMs: 5000 });
const capturedTarget = { selector: '#exact-note-editor', sectionLabel: 'Encounter note editor', label: 'Encounter note editor', framePath: 'top.0', frameUrl: 'https://athenanet.athenahealth.com/22724/6/encounter/12345', tag: 'textarea', targetFingerprint: 'a1b2c3d4' };
const exactDriverResult = {
  ok: true, mode: 'teach', action: 'write_note', readOnly: true, targetValidated: true, contextVerified: true,
  target: capturedTarget,
  context: {
    patientName: 'Example Patient', dob: '1/2/1980', mrn: '123', appointmentId: '54321', encounterId: '12345',
    encounterUrl: 'https://athenanet.athenahealth.com/22724/6/encounter/12345', visitDate: '7/14/2026', provider: 'Example Doctor, MD',
    framePath: 'top.0', encounterRootFingerprint: 'enc', controlFingerprint: 'ctl', noteScopeFingerprint: 'scope',
    actionContainerFingerprint: 'scope', editorFingerprint: 'editor', contextHash: 'context'
  }
};

function dispatch(message, sender) {
  return new Promise((resolve, reject) => {
    let handled = false, settled = false;
    const respond = value => { if (!settled) { settled = true; resolve(value); } };
    for (const listener of runtimeListeners) {
      try { if (listener(message, sender, respond) === true) handled = true; } catch (error) { reject(error); return; }
    }
    if (!handled && !settled) resolve(undefined);
  });
}
function latestProgress(requestId, state) {
  return progress.map(item => item.message).filter(message => message.requestId === requestId && (!state || message.resp.state === state)).slice(-1)[0];
}

(async () => {
  // Start registers before awaiting tab discovery, so an immediate Cancel
  // cannot be followed by a late orphan watcher installation.
  let releaseQuery;
  pendingTabQuery = { promise: new Promise(resolve => { releaseQuery = resolve; }) };
  const racingStart = dispatch(startMessage('cancel-before-query'), appSender);
  await Promise.resolve();
  const racingCancel = await dispatch({ type: 'mlsAppTeachCancelRequest', requestId: 'cancel-before-query' }, appSender);
  assert.strictEqual(racingCancel.reason, 'cancelled');
  releaseQuery(signedInTabs.slice()); pendingTabQuery = null;
  const cancelledStart = await racingStart;
  assert.strictEqual(cancelledStart.reason, 'cancelled', 'late tab discovery installed an orphan watcher after Cancel');
  assert(!injections.some(call => call.func && call.func.name === 'mlsAthenaTeachWatcherFn' && call.args[0].mode === 'start' && call.args[0].sessionId === 'cancel-before-query'), 'orphan watcher was injected after immediate Cancel');

  watcherUnavailable = true;
  const unavailable = await dispatch(startMessage('unavailable'), appSender);
  assert.strictEqual(unavailable.state, 'failed');
  assert.strictEqual(unavailable.reason, 'watcher-unavailable', 'watcher injection failure did not fail closed');
  watcherUnavailable = false;

  // A missing or failed frame may never leave the successfully armed frames
  // alive. The handler must issue an exact session-scoped all-frame cancel.
  frameSnapshot = [
    { frameId: 0, parentFrameId: -1, documentId: 'doc-1', url: signedInTabs[0].url },
    { frameId: 4, parentFrameId: 0, documentId: 'doc-4', url: 'https://athenanet.athenahealth.com/frame/4' }
  ];
  watcherStartResults = [{ frameId: 0, result: { ok: true, state: 'waiting', frameCount: 1 } }];
  const partialStart = await dispatch(startMessage('partial-frame'), appSender);
  assert.strictEqual(partialStart.reason, 'frame-generation-changed', 'missing frame coverage did not fail closed');
  assert(injections.some(call => call.func && call.func.name === 'mlsAthenaTeachWatcherFn' && call.args[0].mode === 'cancel' && call.args[0].sessionId === 'partial-frame'), 'missing frame coverage did not exact-cancel armed frames');

  watcherStartResults = [
    { frameId: 0, result: { ok: true, state: 'waiting', frameCount: 1 } },
    { frameId: 4, result: { ok: false, state: 'failed', reason: 'watcher-unavailable' } }
  ];
  const mixedStart = await dispatch(startMessage('mixed-frame'), appSender);
  assert.strictEqual(mixedStart.reason, 'watcher-unavailable', 'mixed frame installation did not fail closed');
  assert(injections.some(call => call.func && call.func.name === 'mlsAthenaTeachWatcherFn' && call.args[0].mode === 'cancel' && call.args[0].sessionId === 'mixed-frame'), 'mixed frame installation left a watcher orphaned');
  watcherStartResults = null;
  frameSnapshot = [{ frameId: 0, parentFrameId: -1, documentId: 'doc-1', url: signedInTabs[0].url }];

  const waiting = await dispatch(startMessage('timeout'), appSender);
  assert.strictEqual(waiting.state, 'waiting', 'connected watcher did not enter waiting state');
  const timeoutTimer = timers.filter(timer => !timer.cleared).slice(-1)[0];
  timeoutTimer.fn();
  assert(latestProgress('timeout', 'expired'), 'watcher timeout did not emit explicit expired state');

  await dispatch(startMessage('guard-navigation'), appSender);
  const guardResult = await dispatch({ type: 'mlsAthenaTeachNavigationGuardReady' }, athenaSender(7));
  assert.strictEqual(guardResult.reason, 'athena-page-changed', 'new document_start guard did not retire stale teaching');
  assert.strictEqual((await dispatch({ type: 'mlsAthenaTeachCaptured', sessionId: 'guard-navigation', target: capturedTarget }, athenaSender(7))).reason, 'session-expired', 'capture survived a guarded frame generation change');

  await dispatch(startMessage('frame-navigation'), appSender);
  navigationListeners[0]({ tabId: 7, frameId: 3, url: 'https://athenanet.athenahealth.com/new-frame' });
  assert.strictEqual((await dispatch({ type: 'mlsAthenaTeachCaptured', sessionId: 'frame-navigation', target: capturedTarget }, athenaSender(7))).reason, 'session-expired', 'subframe navigation did not synchronously retire teaching');

  await dispatch(startMessage('ignore-complete'), appSender);
  tabUpdatedListeners[0](42, { status: 'complete', title: 'MLS' });
  assert.strictEqual((await dispatch({ type: 'mlsAppTeachCancelRequest', requestId: 'ignore-complete' }, appSender)).reason, 'cancelled', 'non-navigation tab update incorrectly retired teaching');

  await dispatch(startMessage('app-loading'), appSender);
  tabUpdatedListeners[0](42, { status: 'loading' });
  assert.strictEqual((await dispatch({ type: 'mlsAthenaTeachCaptured', sessionId: 'app-loading', target: capturedTarget }, athenaSender(7))).reason, 'session-expired', 'app reload left a teaching watcher active');

  await dispatch(startMessage('app-close'), appSender);
  tabRemovedListeners[0](42);
  assert.strictEqual((await dispatch({ type: 'mlsAthenaTeachCaptured', sessionId: 'app-close', target: capturedTarget }, athenaSender(7))).reason, 'session-expired', 'app tab close left a teaching watcher active');

  // A capture already awaiting read-only validation may not win after a newer
  // row replaces its exact session generation.
  let resolveOldValidation;
  driverResultPromise = new Promise(resolve => { resolveOldValidation = resolve; });
  await dispatch(startMessage('validation-a'), appSender);
  const oldCapture = dispatch({ type: 'mlsAthenaTeachCaptured', sessionId: 'validation-a', target: capturedTarget }, athenaSender(7));
  await Promise.resolve(); await Promise.resolve();
  const replacement = await dispatch(startMessage('validation-b'), appSender);
  assert.strictEqual(replacement.state, 'waiting', 'replacement watcher did not arm');
  resolveOldValidation(exactDriverResult);
  assert.strictEqual((await oldCapture).reason, 'session-expired', 'old validation emitted after replacement');
  assert(!latestProgress('validation-a', 'captured'), 'old validation persisted a capture after replacement');
  assert.strictEqual((await dispatch({ type: 'mlsAppTeachCancelRequest', requestId: 'validation-b' }, appSender)).reason, 'cancelled', 'stale A cleanup killed replacement B');
  driverResultPromise = null;

  await dispatch(startMessage('wrong-tab'), appSender);
  const wrongTab = await dispatch({ type: 'mlsAthenaTeachCaptured', sessionId: 'wrong-tab', target: capturedTarget }, athenaSender(99));
  assert.strictEqual(wrongTab.reason, 'wrong-tab');
  assert(latestProgress('wrong-tab', 'failed'), 'wrong-tab capture did not emit failed state');

  await dispatch(startMessage('wrong-patient'), appSender);
  driverResult = { ok: false, blocked: true, reason: 'patient-mismatch' };
  const wrongPatient = await dispatch({ type: 'mlsAthenaTeachCaptured', sessionId: 'wrong-patient', target: capturedTarget }, athenaSender(7));
  assert.strictEqual(wrongPatient.reason, 'patient-mismatch');
  assert(/not the patient/i.test(latestProgress('wrong-patient', 'failed').resp.message), 'wrong-patient capture did not explain the patient mismatch');

  await dispatch(startMessage('success'), appSender);
  driverResult = exactDriverResult;
  const success = await dispatch({ type: 'mlsAthenaTeachCaptured', sessionId: 'success', target: capturedTarget }, athenaSender(7));
  assert.strictEqual(success.state, 'captured');
  const captured = latestProgress('success', 'captured');
  assert(captured && captured.resp.binding.contextHash === 'ctx-success', 'successful capture lost the exact patient/writeflow binding');
  assert.strictEqual(captured.resp.target.selector, '#exact-note-editor', 'successful capture lost the validated selector');
  const teachProbe = injections.filter(call => call.func && call.func.name === 'mlsAthenaActionV2DriverFn').slice(-1)[0];
  assert.strictEqual(teachProbe.args[0].mode, 'teach');
  assert.strictEqual(teachProbe.args[0].taughtDestination.selector, '#exact-note-editor', 'read-only validator did not consume the captured selector');

  console.log('PASS destination teaching runtime: safe click suppression, unavailable/expired/wrong-tab/wrong-patient states, exact selector capture and binding');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
