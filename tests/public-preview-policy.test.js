'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'public-preview-policy.js'), 'utf8');

function nativeStorage(initial) {
  const values = new Map(Object.entries(initial || {}).map(([key, value]) => [String(key), String(value)]));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
    snapshot() { return Object.fromEntries(values); }
  };
}

function element(tag) {
  return {
    tagName: String(tag || '').toUpperCase(),
    children: [],
    style: {},
    attributes: {},
    textContent: '',
    appendChild(node) { this.children.push(node); return node; },
    setAttribute(name, value) { this.attributes[name] = String(value); }
  };
}

function browser(url, options = {}) {
  const parsed = new URL(url);
  const listeners = [];
  const documentListeners = [];
  const posted = [];
  const nativeLocal = nativeStorage({ realLocal: 'untouched' });
  const nativeSession = nativeStorage({ realSession: 'untouched' });
  const head = element('head');
  const body = element('body');
  const documentElement = element('html');
  documentElement.appendChild(head);
  documentElement.appendChild(body);
  const document = {
    head,
    body,
    documentElement,
    cookie: 'native=1',
    createElement: element,
    addEventListener(type, listener, capture) { documentListeners.push({ type, listener, capture }); },
    getElementsByTagName(name) { return String(name).toLowerCase() === 'head' ? [head] : []; }
  };
  function HTMLFormElement() {}
  HTMLFormElement.prototype.submit = function nativeSubmit() {};
  HTMLFormElement.prototype.requestSubmit = function nativeRequestSubmit() {};
  function HTMLAnchorElement() { this._attrs = {}; this.tagName = 'A'; this.nativeClicks = 0; }
  HTMLAnchorElement.prototype.getAttribute = function getAttribute(name) { return this._attrs[String(name)] ?? null; };
  HTMLAnchorElement.prototype.hasAttribute = function hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, String(name)); };
  HTMLAnchorElement.prototype.setAttribute = function setAttribute(name, value) { this._attrs[String(name)] = String(value); };
  HTMLAnchorElement.prototype.click = function nativeAnchorClick() { this.nativeClicks += 1; return 'native-click'; };
  class BrowserURL extends URL {}
  BrowserURL.createObjectURL = function nativeCreateObjectURL() { return 'blob:native'; };
  const navigator = {
    mediaDevices: { getUserMedia() { return 'native-media'; }, enumerateDevices() { return []; } },
    clipboard: { readText() { return 'native-clipboard'; }, writeText() {} },
    geolocation: { getCurrentPosition() {}, watchPosition() { return 1; }, clearWatch() {} },
    locks: { request() {}, query() {} },
    serviceWorker: { register() {} },
    getUserMedia() {}, webkitGetUserMedia() {}, mozGetUserMedia() {},
    sendBeacon() { return true; }, share() {}, canShare() { return true; }
  };
  const context = {
    location: {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      search: parsed.search,
      href: parsed.href,
      origin: parsed.origin
    },
    top: null,
    opener: { postMessage() { throw new Error('opener must be severed'); } },
    navigator,
    document,
    localStorage: nativeLocal,
    sessionStorage: nativeSession,
    HTMLFormElement,
    HTMLAnchorElement,
    fetch() { return Promise.resolve('native-fetch'); },
    XMLHttpRequest: function XMLHttpRequest() {},
    WebSocket: function WebSocket() {},
    EventSource: function EventSource() {},
    WebTransport: function WebTransport() {},
    RTCPeerConnection: function RTCPeerConnection() {},
    webkitRTCPeerConnection: function webkitRTCPeerConnection() {},
    Worker: function Worker() {},
    SharedWorker: function SharedWorker() {},
    BroadcastChannel: function BroadcastChannel() {},
    MediaRecorder: function MediaRecorder() {},
    SpeechRecognition: function SpeechRecognition() {},
    webkitSpeechRecognition: function webkitSpeechRecognition() {},
    indexedDB: { open() {}, deleteDatabase() {}, cmp() {} },
    caches: { open() {}, match() {} },
    open() { return 'native-window'; },
    postMessage(message, target) { posted.push({ message, target }); return 'posted'; },
    addEventListener(type, listener, capture) { listeners.push({ type, listener, capture }); },
    stop() { context.stopCalls += 1; },
    stopCalls: 0,
    Promise,
    Proxy,
    Reflect,
    DOMException,
    URL: BrowserURL,
    Error,
    console
  };
  context.window = context;
  context.top = context;
  if (options.unpatchableFetch) {
    Object.defineProperty(context, 'fetch', { value: context.fetch, configurable: false, writable: false });
  }
  if (options.cspAppendFailure) {
    head.appendChild = function () { throw new Error('CSP append refused'); };
  }
  const identities = {
    fetch: context.fetch,
    postMessage: context.postMessage,
    localStorage: context.localStorage,
    sessionStorage: context.sessionStorage,
    cookie: document.cookie,
    formSubmit: HTMLFormElement.prototype.submit
  };
  vm.runInNewContext(source, context, { filename: 'public-preview-policy.js' });
  return { context, identities, nativeLocal, nativeSession, listeners, documentListeners, posted, document };
}

function descriptor(object, key) {
  const value = Object.getOwnPropertyDescriptor(object, key);
  assert(value, `${key} descriptor is missing`);
  assert.strictEqual(value.configurable, false, `${key} is configurable`);
  assert.strictEqual(value.writable, false, `${key} is writable`);
  return value;
}

for (const url of [
  'https://mlsscribe.com/ScribeFlow.html',
  'https://mlsscribe.com/ScribeFlow.html?preview=0',
  'https://mlsscribe.com/ScribeFlow.html?preview=1&other=1',
  'https://mlsscribe.com/ScribeFlow.html?preview=1&preview=1',
  'https://mlsscribe.com/scribeflow.html?preview=1',
  'https://mlsscribe.com/ScribeFlow.html/?preview=1',
  'https://example.test/ScribeFlow.html?preview=1',
  'file:///C:/ScribeFlow.html?preview=1',
  'chrome-extension://abcdefghijklmnopabcdefghijklmnop/ScribeFlow.html?preview=1'
]) {
  const out = browser(url);
  assert.strictEqual(out.context.__MLS_PUBLIC_PREVIEW.enabled, false, `${url}: non-exact route activated`);
  assert.strictEqual(out.context.__MLS_PUBLIC_PREVIEW.mode, 'inactive', `${url}: inactive mode drifted`);
  assert.strictEqual(out.context.__MLS_SYNTHETIC_ONLY, false, `${url}: synthetic marker activated`);
  assert(Object.isFrozen(out.context.__MLS_PUBLIC_PREVIEW), `${url}: inactive contract is mutable`);
  descriptor(out.context, '__MLS_PUBLIC_PREVIEW');
  descriptor(out.context, '__MLS_SYNTHETIC_ONLY');
  assert.strictEqual(out.context.fetch, out.identities.fetch, `${url}: normal fetch changed`);
  assert.strictEqual(out.context.postMessage, out.identities.postMessage, `${url}: normal postMessage changed`);
  assert.strictEqual(out.context.localStorage, out.identities.localStorage, `${url}: normal localStorage changed`);
  assert.strictEqual(out.context.sessionStorage, out.identities.sessionStorage, `${url}: normal sessionStorage changed`);
  assert.strictEqual(out.document.cookie, out.identities.cookie, `${url}: normal cookie changed`);
  assert.strictEqual(out.context.HTMLFormElement.prototype.submit, out.identities.formSubmit, `${url}: normal form changed`);
  assert.strictEqual(out.listeners.length, 0, `${url}: normal window listeners were added`);
  assert.strictEqual(out.documentListeners.length, 0, `${url}: normal document listeners were added`);
}

for (const url of [
  'https://mlsscribe.com/ScribeFlow.html?preview=1',
  'https://www.mlsscribe.com/ScribeFlow.html?preview=1#today',
  'http://localhost:8080/ScribeFlow.html?preview=1',
  'https://127.0.0.1/ScribeFlow.html?preview=1',
  'http://[::1]:9000/ScribeFlow.html?preview=1'
]) {
  const out = browser(url);
  const { context } = out;
  assert.strictEqual(context.__MLS_PUBLIC_PREVIEW.enabled, true, `${url}: exact route did not activate`);
  assert.strictEqual(context.__MLS_PUBLIC_PREVIEW.mode, 'synthetic-read-only');
  assert.strictEqual(context.__MLS_PUBLIC_PREVIEW.storageMode, 'memory');
  assert.strictEqual(context.__MLS_PUBLIC_PREVIEW.memoryStorageReady, true);
  assert.strictEqual(context.__MLS_SYNTHETIC_ONLY, true);
  assert(Object.isFrozen(context.__MLS_PUBLIC_PREVIEW), 'active contract is mutable');
  assert(Object.isFrozen(context.__MLS_PUBLIC_PREVIEW.capabilities), 'capabilities are mutable');
  assert(Object.isFrozen(context.__MLS_PUBLIC_PREVIEW.state), 'state is mutable');
  descriptor(context, '__MLS_PUBLIC_PREVIEW');
  descriptor(context, '__MLS_SYNTHETIC_ONLY');
  descriptor(context, '__MLS_PUBLIC_PREVIEW_CAPABILITIES');
  descriptor(context, '__MLS_PUBLIC_PREVIEW_STATE');
  assert.strictEqual(context.__MLS_PUBLIC_PREVIEW.state.ready, true);
  assert.deepStrictEqual(Array.from(context.__MLS_PUBLIC_PREVIEW.state.failures), []);
  assert.strictEqual(context.stopCalls, 0, 'successful preview was hard-locked');

  assert.notStrictEqual(context.localStorage, out.identities.localStorage, 'native localStorage survived preview');
  assert.notStrictEqual(context.sessionStorage, out.identities.sessionStorage, 'native sessionStorage survived preview');
  assert.deepStrictEqual(out.nativeLocal.snapshot(), { realLocal: 'untouched' }, 'preview touched native localStorage');
  assert.deepStrictEqual(out.nativeSession.snapshot(), { realSession: 'untouched' }, 'preview touched native sessionStorage');
  context.localStorage.setItem('patient', 'Synthetic Patient');
  context.sessionStorage.job = 42;
  assert.strictEqual(context.localStorage.patient, 'Synthetic Patient');
  assert.strictEqual(context.sessionStorage.getItem('job'), '42');
  assert.deepStrictEqual(out.nativeLocal.snapshot(), { realLocal: 'untouched' }, 'memory write escaped to native localStorage');
  const reset = context.__MLS_PUBLIC_PREVIEW.resetStorage({
    localStorage: { z: 2, a: 1 },
    sessionStorage: { visit: 'synthetic' }
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(reset)), {
    localStorage: { a: '1', z: '2' },
    sessionStorage: { visit: 'synthetic' }
  });
  assert.strictEqual(context.localStorage.key(0), 'a', 'deterministic key order drifted');
  context.__MLS_PUBLIC_PREVIEW.resetStorage();
  assert.strictEqual(context.localStorage.length, 0);
  assert.strictEqual(context.sessionStorage.length, 0);
}

(async () => {
  const out = browser('https://mlsscribe.com/ScribeFlow.html?preview=1');
  const { context } = out;

  await assert.rejects(context.fetch('/api/patients'), error => error && error.name === 'SecurityError');
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'Worker', 'SharedWorker', 'BroadcastChannel', 'MediaRecorder', 'SpeechRecognition', 'webkitSpeechRecognition']) {
    assert.throws(() => new context[name](), error => error && error.name === 'SecurityError', `${name} was not blocked`);
    descriptor(context, name);
  }
  assert.throws(() => context.indexedDB.open('real-data'), error => error && error.name === 'SecurityError');
  await assert.rejects(context.caches.open('real-cache'), error => error && error.name === 'SecurityError');
  await assert.rejects(context.navigator.mediaDevices.getUserMedia({ audio: true }), error => error && error.name === 'SecurityError');
  assert.throws(() => context.navigator.geolocation.getCurrentPosition(() => {}), error => error && error.name === 'SecurityError');
  assert.throws(() => context.navigator.geolocation.watchPosition(() => {}), error => error && error.name === 'SecurityError');
  await assert.rejects(context.navigator.clipboard.readText(), error => error && error.name === 'SecurityError');
  await assert.rejects(context.navigator.share({ title: 'real' }), error => error && error.name === 'SecurityError');
  await assert.rejects(context.navigator.locks.request('real-tab', () => {}), error => error && error.name === 'SecurityError');
  await assert.rejects(context.navigator.serviceWorker.register('/sw.js'), error => error && error.name === 'SecurityError');
  assert.strictEqual(context.navigator.sendBeacon('/collect', 'data'), false);
  assert.strictEqual(context.navigator.canShare({}), false);
  assert.throws(() => context.open('https://athenahealth.com'), error => error && error.name === 'SecurityError');
  assert.throws(() => context.HTMLFormElement.prototype.submit.call({}), error => error && error.name === 'SecurityError');
  assert.throws(() => { out.document.cookie = 'real=1'; }, error => error && error.name === 'SecurityError');
  assert.strictEqual(out.document.cookie, '');

  context.postMessage({ source: 'mls-app', type: 'mlsAppReadChart' }, '*');
  assert.strictEqual(out.posted.length, 0, 'outbound extension request escaped');
  context.postMessage({ from: 'mls-app', type: 'custom' }, '*');
  context.postMessage({ type: 'mlsPing' }, '*');
  context.postMessage({ type: 'mlsExtHealth' }, '*');
  context.postMessage({ type: 'mlsDevReload' }, '*');
  context.postMessage({ type: 'mlsAppSchedule' }, '*');
  assert.strictEqual(out.posted.length, 0, 'alternate extension request envelope escaped');
  assert.strictEqual(context.postMessage({ source: 'preview-ui', type: 'local' }, '*'), 'posted');
  assert.strictEqual(out.posted.length, 1, 'non-extension local message was swallowed');

  const messageCapture = out.listeners.find(entry => entry.type === 'message');
  assert(messageCapture && messageCapture.capture === true, 'extension capture listener missing');
  const blockedEvent = {
    data: { source: 'mls-ext', type: 'mlsAppChartResult' },
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.immediate = true; },
    stopPropagation() { this.stopped = true; }
  };
  messageCapture.listener(blockedEvent);
  assert(blockedEvent.prevented && blockedEvent.immediate && blockedEvent.stopped, 'inbound extension result was not swallowed');
  for (const data of [
    { from: 'mls-ext', type: 'custom' },
    { type: 'mlsPong' },
    { type: 'mlsAppScheduleResult' },
    { type: 'mlsAppTeachProgress' }
  ]) {
    const event = { data, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediate = true; }, stopPropagation() {} };
    messageCapture.listener(event);
    assert(event.prevented && event.immediate, `inbound ${data.type} envelope was not swallowed`);
  }
  const ordinaryEvent = { data: { source: 'preview-ui' }, stopImmediatePropagation() { this.immediate = true; } };
  messageCapture.listener(ordinaryEvent);
  assert.strictEqual(ordinaryEvent.immediate, undefined, 'ordinary local event was swallowed');
  const crossWindowEvent = {
    source: {}, data: { source: 'preview-ui' },
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.immediate = true; },
    stopPropagation() {}
  };
  messageCapture.listener(crossWindowEvent);
  assert(crossWindowEvent.prevented && crossWindowEvent.immediate, 'cross-window message was not swallowed');
  assert.strictEqual(context.opener, null, 'preview retained a cross-window opener');
  const storageCapture = out.listeners.find(entry => entry.type === 'storage');
  const storageEvent = { preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediate = true; }, stopPropagation() {} };
  storageCapture.listener(storageEvent);
  assert(storageEvent.prevented && storageEvent.immediate, 'cross-tab storage event was not swallowed');

  const formCapture = out.documentListeners.find(entry => entry.type === 'submit');
  const submitEvent = { preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediate = true; }, stopPropagation() {} };
  formCapture.listener(submitEvent);
  assert(submitEvent.prevented && submitEvent.immediate, 'form event was not blocked');

  const safeAnchor = new context.HTMLAnchorElement();
  safeAnchor.setAttribute('href', '#today');
  assert.strictEqual(safeAnchor.click(), 'native-click', 'internal hash navigation was blocked');
  safeAnchor.setAttribute('href', '/ScribeFlow.html');
  assert.strictEqual(safeAnchor.click(), 'native-click', 'same-origin navigation was blocked');
  for (const href of ['https://athenahealth.com/', 'mailto:doctor@example.test', 'tel:5550100', 'sms:5550100', 'data:text/plain,secret', 'blob:https://mlsscribe.com/id']) {
    const anchor = new context.HTMLAnchorElement();
    anchor.setAttribute('href', href);
    assert.throws(() => anchor.click(), error => error && error.name === 'SecurityError', `${href} programmatic click was not blocked`);
  }
  const downloadAnchor = new context.HTMLAnchorElement();
  downloadAnchor.setAttribute('href', '/export.txt');
  downloadAnchor.setAttribute('download', 'export.txt');
  assert.throws(() => downloadAnchor.click(), error => error && error.name === 'SecurityError', 'download click was not blocked');
  const newTabAnchor = new context.HTMLAnchorElement();
  newTabAnchor.setAttribute('href', '/ScribeFlow.html');
  newTabAnchor.setAttribute('target', '_blank');
  assert.throws(() => newTabAnchor.click(), error => error && error.name === 'SecurityError', 'cross-tab click was not blocked');
  const anchorCapture = out.documentListeners.find(entry => entry.type === 'click');
  const anchorEvent = { target: downloadAnchor, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.immediate = true; }, stopPropagation() {} };
  anchorCapture.listener(anchorEvent);
  assert(anchorEvent.prevented && anchorEvent.immediate, 'unsafe anchor event was not blocked');
  assert.throws(() => context.URL.createObjectURL(new Blob()), error => error && error.name === 'SecurityError', 'blob export URL was not blocked');

  const csp = out.document.head.children.find(node => node.httpEquiv === 'Content-Security-Policy');
  assert(csp && /connect-src 'none'/.test(csp.content) && /form-action 'none'/.test(csp.content), 'preview CSP defense is missing');

  const failed = browser('https://mlsscribe.com/ScribeFlow.html?preview=1', { unpatchableFetch: true });
  assert.strictEqual(failed.context.__MLS_SYNTHETIC_ONLY, true, 'failed preview lost synthetic-only marker');
  assert.strictEqual(failed.context.__MLS_PUBLIC_PREVIEW.enabled, false, 'failed guard still enabled runtime');
  assert.strictEqual(failed.context.__MLS_PUBLIC_PREVIEW.mode, 'policy-install-failed');
  assert.strictEqual(failed.context.__MLS_PUBLIC_PREVIEW.memoryStorageReady, false);
  assert.strictEqual(failed.context.__MLS_PUBLIC_PREVIEW.state.failClosed, true);
  assert(Array.from(failed.context.__MLS_PUBLIC_PREVIEW.state.failures).includes('fetch'), 'failed guard was not reported');
  assert.strictEqual(failed.context.stopCalls, 1, 'failed policy did not stop page boot');
  assert.strictEqual(failed.document.documentElement.attributes['data-mls-preview-fail-closed'], 'true');
  assert(/Synthetic preview unavailable/.test(failed.document.body.children[0].children[0].textContent), 'failed policy did not replace the workspace');

  const failedCsp = browser('https://mlsscribe.com/ScribeFlow.html?preview=1', { cspAppendFailure: true });
  assert.strictEqual(failedCsp.context.__MLS_PUBLIC_PREVIEW.enabled, false, 'preview enabled without its restrictive CSP');
  assert.strictEqual(failedCsp.context.__MLS_PUBLIC_PREVIEW.state.failClosed, true);
  assert(Array.from(failedCsp.context.__MLS_PUBLIC_PREVIEW.state.failures).includes('dynamic-csp'), 'failed CSP was not reported');
  assert.strictEqual(failedCsp.context.stopCalls, 1, 'failed CSP did not stop page boot');

  console.log('public-preview-policy.test.js: all assertions passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
