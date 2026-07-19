/* MLS public synthetic-preview safety boundary.
 *
 * This file is intended to run before every other application script.  The
 * preview is deliberately an exact, opt-in route.  When it is active, browser
 * persistence and every supported path out to the network, MLS Assist, media,
 * or another tab are replaced with immutable fail-closed facades.
 */
(function (root) {
  'use strict';

  var VERSION = '2026-07-19.1';
  var EXIT_URL = '/ScribeFlow.html';

  function frozen(value) {
    try { return Object.freeze(value); } catch (_) { return value; }
  }

  function immutable(target, key, value) {
    try {
      Object.defineProperty(target, key, {
        value: value,
        enumerable: false,
        configurable: false,
        writable: false
      });
      var descriptor = Object.getOwnPropertyDescriptor(target, key);
      return target[key] === value && !!descriptor && descriptor.configurable === false && descriptor.writable === false;
    } catch (_) {
      return false;
    }
  }

  function isLoopback(hostname) {
    hostname = String(hostname || '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  }

  function exactPreviewRoute(location) {
    if (!location) return false;
    var protocol = String(location.protocol || '').toLowerCase();
    var hostname = String(location.hostname || '').toLowerCase();
    var allowedHost = hostname === 'mlsscribe.com' || hostname === 'www.mlsscribe.com' || isLoopback(hostname);
    return (protocol === 'http:' || protocol === 'https:') &&
      allowedHost &&
      String(location.pathname || '') === '/ScribeFlow.html' &&
      String(location.search || '') === '?preview=1';
  }

  var requested = exactPreviewRoute(root.location);
  if (!requested) {
    /* The inactive marker is the only normal-route observable.  No browser
       primitive, event listener, storage object, or document node is touched. */
    immutable(root, '__MLS_PUBLIC_PREVIEW', frozen({
      enabled: false,
      mode: 'inactive',
      storageMode: 'native',
      memoryStorageReady: false,
      version: VERSION
    }));
    immutable(root, '__MLS_SYNTHETIC_ONLY', false);
    return;
  }

  var failures = [];
  var guards = Object.create(null);
  var PromiseImpl = root.Promise || (typeof Promise === 'function' ? Promise : null);

  function securityError(surface) {
    var message = 'Public synthetic preview blocked ' + surface + '.';
    try { return new root.DOMException(message, 'SecurityError'); } catch (_) {}
    var error = new Error(message);
    error.name = 'SecurityError';
    return error;
  }

  function rejected(surface) {
    if (!PromiseImpl || typeof PromiseImpl.reject !== 'function') throw securityError(surface);
    return PromiseImpl.reject(securityError(surface));
  }

  function fail(name) {
    if (failures.indexOf(name) < 0) failures.push(name);
    guards[name] = false;
    return false;
  }

  function pass(name) {
    guards[name] = true;
    return true;
  }

  function lockValue(target, key, value, name) {
    if (!target) return fail(name);
    try {
      var current = Object.getOwnPropertyDescriptor(target, key);
      if (!current || current.configurable) {
        Object.defineProperty(target, key, {
          value: value,
          enumerable: current ? !!current.enumerable : false,
          configurable: false,
          writable: false
        });
      } else if (Object.prototype.hasOwnProperty.call(current, 'writable') && current.writable) {
        Object.defineProperty(target, key, { value: value, writable: false });
      }
      var installed = Object.getOwnPropertyDescriptor(target, key);
      if (target[key] !== value || !installed || installed.configurable !== false || installed.writable !== false) return fail(name);
      return pass(name);
    } catch (_) {
      return fail(name);
    }
  }

  function sortedSeed(seed) {
    var output = [];
    if (!seed || typeof seed !== 'object' || Array.isArray(seed)) return output;
    Object.keys(seed).sort().forEach(function (key) {
      output.push([String(key), String(seed[key])]);
    });
    return output;
  }

  function createMemoryStorage(label) {
    var records = Object.create(null);

    function keys() { return Object.keys(records).sort(); }
    function getItem(key) {
      key = String(key);
      return Object.prototype.hasOwnProperty.call(records, key) ? records[key] : null;
    }
    function setItem(key, value) { records[String(key)] = String(value); }
    function removeItem(key) { delete records[String(key)]; }
    function clear() { records = Object.create(null); }
    function key(index) {
      index = Number(index);
      if (!isFinite(index) || index < 0 || Math.floor(index) !== index) return null;
      var list = keys();
      return index < list.length ? list[index] : null;
    }
    function reset(seed) {
      clear();
      sortedSeed(seed).forEach(function (entry) { records[entry[0]] = entry[1]; });
    }
    function snapshot() {
      var output = {};
      keys().forEach(function (entry) { output[entry] = records[entry]; });
      return frozen(output);
    }

    var target = {};
    Object.defineProperties(target, {
      length: { enumerable: false, configurable: false, get: function () { return keys().length; } },
      key: { enumerable: false, configurable: false, writable: false, value: key },
      getItem: { enumerable: false, configurable: false, writable: false, value: getItem },
      setItem: { enumerable: false, configurable: false, writable: false, value: setItem },
      removeItem: { enumerable: false, configurable: false, writable: false, value: removeItem },
      clear: { enumerable: false, configurable: false, writable: false, value: clear }
    });

    if (typeof root.Proxy !== 'function' || !root.Reflect) throw securityError(label + ' memory facade');
    var facade = new root.Proxy(target, {
      get: function (object, property, receiver) {
        if (typeof property === 'string' && !(property in object)) {
          return Object.prototype.hasOwnProperty.call(records, property) ? records[property] : undefined;
        }
        return root.Reflect.get(object, property, receiver);
      },
      set: function (object, property, value) {
        if (typeof property === 'string' && !(property in object)) {
          setItem(property, value);
          return true;
        }
        return false;
      },
      deleteProperty: function (object, property) {
        if (typeof property === 'string' && !(property in object)) {
          removeItem(property);
          return true;
        }
        return false;
      },
      has: function (object, property) {
        return property in object || (typeof property === 'string' && Object.prototype.hasOwnProperty.call(records, property));
      },
      ownKeys: function (object) {
        return root.Reflect.ownKeys(object).concat(keys().filter(function (entry) { return !(entry in object); }));
      },
      getOwnPropertyDescriptor: function (object, property) {
        var descriptor = Object.getOwnPropertyDescriptor(object, property);
        if (descriptor) return descriptor;
        if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(records, property)) {
          return { value: records[property], enumerable: true, configurable: true, writable: true };
        }
      },
      defineProperty: function (object, property, descriptor) {
        if (typeof property !== 'string' || property in object || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false;
        setItem(property, descriptor.value);
        return true;
      }
    });
    return { facade: facade, reset: reset, snapshot: snapshot };
  }

  function selfTestStorage(storage, label) {
    var probe = '__mls_preview_probe__' + label;
    try {
      storage.facade.clear();
      storage.facade.setItem(probe, 'one');
      if (storage.facade.getItem(probe) !== 'one' || storage.facade.length !== 1 || storage.facade.key(0) !== probe) return false;
      storage.facade[probe] = 'two';
      if (storage.facade[probe] !== 'two') return false;
      delete storage.facade[probe];
      if (storage.facade.getItem(probe) !== null || storage.facade.length !== 0) return false;
      storage.reset({ b: 2, a: 1 });
      if (storage.facade.key(0) !== 'a' || storage.facade.key(1) !== 'b') return false;
      storage.reset();
      return storage.facade.length === 0;
    } catch (_) {
      try { storage.reset(); } catch (_) {}
      return false;
    }
  }

  var localMemory = null;
  var sessionMemory = null;
  try {
    localMemory = createMemoryStorage('localStorage');
    sessionMemory = createMemoryStorage('sessionStorage');
  } catch (_) {
    fail('memory-storage-create');
  }

  if (localMemory && sessionMemory) {
    lockValue(root, 'localStorage', localMemory.facade, 'localStorage');
    lockValue(root, 'sessionStorage', sessionMemory.facade, 'sessionStorage');
    if (root.localStorage !== localMemory.facade || root.sessionStorage !== sessionMemory.facade ||
        !selfTestStorage(localMemory, 'local') || !selfTestStorage(sessionMemory, 'session')) {
      fail('memory-storage-self-test');
    } else {
      pass('memory-storage-self-test');
    }
  }

  function resetStorage(seed) {
    seed = seed && typeof seed === 'object' ? seed : {};
    localMemory.reset(seed.localStorage || {});
    sessionMemory.reset(seed.sessionStorage || {});
    return snapshotStorage();
  }

  function snapshotStorage() {
    return frozen({
      localStorage: localMemory.snapshot(),
      sessionStorage: sessionMemory.snapshot()
    });
  }

  function blockedConstructor(surface) {
    return function () { throw securityError(surface); };
  }

  function blockedPromise(surface) {
    return function () { return rejected(surface); };
  }

  lockValue(root, 'fetch', blockedPromise('fetch'), 'fetch');
  lockValue(root, 'XMLHttpRequest', blockedConstructor('XMLHttpRequest'), 'XMLHttpRequest');
  lockValue(root, 'WebSocket', blockedConstructor('WebSocket'), 'WebSocket');
  lockValue(root, 'EventSource', blockedConstructor('EventSource'), 'EventSource');
  lockValue(root, 'WebTransport', blockedConstructor('WebTransport'), 'WebTransport');
  lockValue(root, 'RTCPeerConnection', blockedConstructor('RTCPeerConnection'), 'RTCPeerConnection');
  lockValue(root, 'webkitRTCPeerConnection', blockedConstructor('webkitRTCPeerConnection'), 'webkitRTCPeerConnection');
  lockValue(root, 'Worker', blockedConstructor('Worker'), 'Worker');
  lockValue(root, 'SharedWorker', blockedConstructor('SharedWorker'), 'SharedWorker');
  lockValue(root, 'BroadcastChannel', blockedConstructor('BroadcastChannel'), 'BroadcastChannel');
  if (root.URL) lockValue(root.URL, 'createObjectURL', blockedConstructor('URL.createObjectURL'), 'URL.createObjectURL');
  else fail('URL.createObjectURL');
  lockValue(root, 'showSaveFilePicker', blockedPromise('showSaveFilePicker'), 'showSaveFilePicker');
  lockValue(root, 'showOpenFilePicker', blockedPromise('showOpenFilePicker'), 'showOpenFilePicker');
  lockValue(root, 'showDirectoryPicker', blockedPromise('showDirectoryPicker'), 'showDirectoryPicker');

  try {
    root.opener = null;
    if (root.opener === null || typeof root.opener === 'undefined') pass('opener-isolation');
    else fail('opener-isolation');
  } catch (_) {
    fail('opener-isolation');
  }
  try {
    if (root.top && root.top !== root) fail('top-level-isolation');
    else pass('top-level-isolation');
  } catch (_) {
    fail('top-level-isolation');
  }

  var indexedDbFacade = frozen({
    open: blockedConstructor('IndexedDB'),
    deleteDatabase: blockedConstructor('IndexedDB'),
    cmp: blockedConstructor('IndexedDB'),
    databases: blockedPromise('IndexedDB')
  });
  var cacheFacade = frozen({
    open: blockedPromise('CacheStorage'),
    has: blockedPromise('CacheStorage'),
    match: blockedPromise('CacheStorage'),
    delete: blockedPromise('CacheStorage'),
    keys: blockedPromise('CacheStorage')
  });
  lockValue(root, 'indexedDB', indexedDbFacade, 'indexedDB');
  lockValue(root, 'caches', cacheFacade, 'caches');

  lockValue(root, 'MediaRecorder', blockedConstructor('MediaRecorder'), 'MediaRecorder');
  lockValue(root, 'SpeechRecognition', blockedConstructor('SpeechRecognition'), 'SpeechRecognition');
  lockValue(root, 'webkitSpeechRecognition', blockedConstructor('webkitSpeechRecognition'), 'webkitSpeechRecognition');
  lockValue(root, 'open', blockedConstructor('window.open'), 'window.open');

  var navigatorObject = root.navigator;
  if (!navigatorObject) {
    fail('navigator');
  } else {
    var mediaFacade = frozen({ getUserMedia: blockedPromise('getUserMedia'), enumerateDevices: blockedPromise('enumerateDevices') });
    var clipboardFacade = frozen({
      read: blockedPromise('clipboard.read'),
      write: blockedPromise('clipboard.write'),
      readText: blockedPromise('clipboard.readText'),
      writeText: blockedPromise('clipboard.writeText')
    });
    var geolocationFacade = frozen({
      getCurrentPosition: blockedConstructor('geolocation'),
      watchPosition: blockedConstructor('geolocation'),
      clearWatch: function () {}
    });
    var locksFacade = frozen({ request: blockedPromise('Web Locks'), query: blockedPromise('Web Locks') });
    var serviceWorkerFacade = frozen({
      controller: null,
      register: blockedPromise('ServiceWorker'),
      getRegistration: blockedPromise('ServiceWorker'),
      getRegistrations: blockedPromise('ServiceWorker')
    });
    lockValue(navigatorObject, 'mediaDevices', mediaFacade, 'mediaDevices');
    lockValue(navigatorObject, 'getUserMedia', blockedConstructor('getUserMedia'), 'navigator.getUserMedia');
    lockValue(navigatorObject, 'webkitGetUserMedia', blockedConstructor('getUserMedia'), 'navigator.webkitGetUserMedia');
    lockValue(navigatorObject, 'mozGetUserMedia', blockedConstructor('getUserMedia'), 'navigator.mozGetUserMedia');
    lockValue(navigatorObject, 'sendBeacon', function () { return false; }, 'sendBeacon');
    lockValue(navigatorObject, 'share', blockedPromise('navigator.share'), 'navigator.share');
    lockValue(navigatorObject, 'canShare', function () { return false; }, 'navigator.canShare');
    lockValue(navigatorObject, 'clipboard', clipboardFacade, 'clipboard');
    lockValue(navigatorObject, 'geolocation', geolocationFacade, 'geolocation');
    lockValue(navigatorObject, 'locks', locksFacade, 'web-locks');
    lockValue(navigatorObject, 'serviceWorker', serviceWorkerFacade, 'service-worker');
    lockValue(navigatorObject, 'msSaveBlob', function () { return false; }, 'navigator.msSaveBlob');
  }

  var originalPostMessage = typeof root.postMessage === 'function' ? root.postMessage : null;
  var safePostMessage = function (message) {
    var type = message && typeof message === 'object' ? String(message.type || '') : '';
    if (message && typeof message === 'object' &&
        (message.source === 'mls-app' || message.from === 'mls-app' ||
         type === 'mlsPing' || type === 'mlsExtHealth' || type === 'mlsDevReload' || /^mlsApp/.test(type))) return undefined;
    if (!originalPostMessage) return undefined;
    return originalPostMessage.apply(root, arguments);
  };
  lockValue(root, 'postMessage', safePostMessage, 'mls-app-outbound');

  function stopEvent(event) {
    try { if (event && typeof event.preventDefault === 'function') event.preventDefault(); } catch (_) {}
    try { if (event && typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation(); } catch (_) {}
    try { if (event && typeof event.stopPropagation === 'function') event.stopPropagation(); } catch (_) {}
  }

  function blockInboundExtension(event) {
    var data = event && event.data;
    var type = data && typeof data === 'object' ? String(data.type || '') : '';
    var extensionMessage = data && typeof data === 'object' &&
      (data.source === 'mls-ext' || data.from === 'mls-ext' || type === 'mlsPong' || /^mlsApp.*(?:Result|Progress)$/.test(type));
    var otherWindow = event && event.source && event.source !== root;
    if (extensionMessage || otherWindow) stopEvent(event);
  }

  function addCapture(target, type, listener, name) {
    if (!target || typeof target.addEventListener !== 'function') return fail(name);
    try {
      target.addEventListener(type, listener, true);
      return pass(name);
    } catch (_) {
      return fail(name);
    }
  }

  addCapture(root, 'message', blockInboundExtension, 'mls-ext-inbound');
  addCapture(root, 'storage', stopEvent, 'storage-event-isolation');

  function anchorAttribute(anchor, name) {
    try {
      if (anchor && typeof anchor.getAttribute === 'function') return anchor.getAttribute(name);
    } catch (_) {}
    try { return anchor ? anchor[name] : null; } catch (_) { return null; }
  }

  function unsafeAnchor(anchor) {
    if (!anchor) return false;
    try {
      if ((typeof anchor.hasAttribute === 'function' && anchor.hasAttribute('download')) || anchor.download) return true;
    } catch (_) { return true; }
    var target = String(anchorAttribute(anchor, 'target') || '').toLowerCase();
    if (target && target !== '_self') return true;
    var raw = String(anchorAttribute(anchor, 'href') || '').trim();
    if (!raw || raw.charAt(0) === '#') return false;
    if (/^(?:mailto|tel|sms|javascript|data|blob):/i.test(raw)) return true;
    try {
      var destination = new root.URL(raw, String(root.location && root.location.href || ''));
      var current = new root.URL(String(root.location && root.location.href || ''));
      return destination.origin !== current.origin || (destination.protocol !== 'http:' && destination.protocol !== 'https:');
    } catch (_) {
      return true;
    }
  }

  function findAnchor(node) {
    var current = node;
    for (var depth = 0; current && depth < 12; depth++, current = current.parentNode) {
      var tag = String(current.tagName || '').toLowerCase();
      if (tag === 'a') return current;
    }
    return null;
  }

  function blockUnsafeAnchorEvent(event) {
    if (unsafeAnchor(findAnchor(event && event.target))) stopEvent(event);
  }

  var documentObject = root.document;
  if (!documentObject) {
    fail('document');
  } else {
    try {
      Object.defineProperty(documentObject, 'cookie', {
        enumerable: false,
        configurable: false,
        get: function () { return ''; },
        set: function () { throw securityError('document.cookie'); }
      });
      var cookieDescriptor = Object.getOwnPropertyDescriptor(documentObject, 'cookie');
      if (!cookieDescriptor || cookieDescriptor.configurable !== false || documentObject.cookie !== '') fail('cookie');
      else pass('cookie');
    } catch (_) {
      fail('cookie');
    }
    addCapture(documentObject, 'submit', stopEvent, 'form-submit-event');
    addCapture(documentObject, 'click', blockUnsafeAnchorEvent, 'unsafe-anchor-event');
  }

  var formPrototype = root.HTMLFormElement && root.HTMLFormElement.prototype;
  if (formPrototype) {
    lockValue(formPrototype, 'submit', blockedConstructor('form.submit'), 'form.submit');
    lockValue(formPrototype, 'requestSubmit', blockedConstructor('form.requestSubmit'), 'form.requestSubmit');
  } else {
    pass('form.submit');
    pass('form.requestSubmit');
  }

  var anchorPrototype = root.HTMLAnchorElement && root.HTMLAnchorElement.prototype;
  if (anchorPrototype && typeof anchorPrototype.click === 'function') {
    var nativeAnchorClick = anchorPrototype.click;
    lockValue(anchorPrototype, 'click', function () {
      if (unsafeAnchor(this)) throw securityError('anchor navigation or download');
      return nativeAnchorClick.apply(this, arguments);
    }, 'anchor.click');
  } else {
    pass('anchor.click');
  }

  var cspInstalled = false;
  try {
    if (documentObject && typeof documentObject.createElement === 'function') {
      var csp = documentObject.createElement('meta');
      csp.httpEquiv = 'Content-Security-Policy';
      csp.content = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; media-src 'none'; object-src 'none'; base-uri 'self'";
      var cspParent = documentObject.head || (typeof documentObject.getElementsByTagName === 'function' && documentObject.getElementsByTagName('head')[0]);
      if (cspParent && typeof cspParent.appendChild === 'function') {
        cspParent.appendChild(csp);
        cspInstalled = true;
      }
    }
  } catch (_) {}
  if (cspInstalled) pass('dynamic-csp');
  else fail('dynamic-csp');

  if (!immutable(root, '__MLS_SYNTHETIC_ONLY', true)) fail('synthetic-only-marker');

  var memoryReady = !!localMemory && !!sessionMemory &&
    guards.localStorage === true && guards.sessionStorage === true && guards['memory-storage-self-test'] === true;
  var ready = memoryReady && failures.length === 0;
  failures.sort();

  var capabilities = frozen({
    syntheticDataOnly: true,
    readOnly: true,
    persistentStorage: false,
    backendNetwork: false,
    extensionBridge: false,
    crossTabCommunication: false,
    microphone: false,
    speechRecognition: false,
    geolocation: false,
    clipboard: false,
    webShare: false,
    formSubmission: false,
    cookies: false,
    serviceWorker: false,
    workers: false,
    dynamicCspInstalled: cspInstalled
  });
  var state = frozen({
    requested: true,
    ready: ready,
    failClosed: !ready,
    failures: frozen(failures.slice()),
    guards: frozen(Object.assign({}, guards)),
    version: VERSION
  });

  var config = ready ? frozen({
    enabled: true,
    mode: 'synthetic-read-only',
    storageMode: 'memory',
    memoryStorageReady: true,
    resetStorage: resetStorage,
    snapshotStorage: snapshotStorage,
    exitUrl: EXIT_URL,
    capabilities: capabilities,
    state: state,
    version: VERSION
  }) : frozen({
    enabled: false,
    mode: 'policy-install-failed',
    storageMode: 'blocked',
    memoryStorageReady: false,
    exitUrl: EXIT_URL,
    capabilities: capabilities,
    state: state,
    version: VERSION
  });

  /* These aliases are observability conveniences.  The authoritative frozen
     copies also live on __MLS_PUBLIC_PREVIEW, so an exotic host that refuses
     an alias cannot accidentally turn a safe membrane into an enabled one. */
  immutable(root, '__MLS_PUBLIC_PREVIEW_CAPABILITIES', capabilities);
  immutable(root, '__MLS_PUBLIC_PREVIEW_STATE', state);
  if (!immutable(root, '__MLS_PUBLIC_PREVIEW', config)) {
    fail('preview-marker');
    ready = false;
  }

  function hardLockDocument() {
    try { if (typeof root.stop === 'function') root.stop(); } catch (_) {}
    var doc = root.document;
    if (!doc) return;
    ['click', 'dblclick', 'pointerdown', 'touchstart', 'keydown', 'beforeinput', 'input', 'change', 'submit'].forEach(function (type) {
      try { doc.addEventListener(type, stopEvent, true); } catch (_) {}
    });
    try {
      if (doc.documentElement && typeof doc.documentElement.setAttribute === 'function') {
        doc.documentElement.setAttribute('data-mls-preview-fail-closed', 'true');
      }
      var body = doc.body;
      if (!body && typeof doc.createElement === 'function' && doc.documentElement && typeof doc.documentElement.appendChild === 'function') {
        body = doc.createElement('body');
        doc.documentElement.appendChild(body);
      }
      if (!body) return;
      body.textContent = '';
      body.style.cssText = 'margin:0;min-height:100vh;display:grid;place-items:center;background:#f8f7f2;color:#143f35;font:16px/1.5 system-ui,sans-serif';
      var panel = doc.createElement('main');
      panel.style.cssText = 'max-width:38rem;margin:2rem;padding:2rem;border:1px solid #d7ddd8;border-radius:16px;background:white;box-shadow:0 10px 30px rgba(20,63,53,.08)';
      var heading = doc.createElement('h1');
      heading.textContent = 'Synthetic preview unavailable';
      var copy = doc.createElement('p');
      copy.textContent = 'A required privacy control could not be installed, so the preview stopped before loading. No clinical workspace or external connection was opened.';
      panel.appendChild(heading);
      panel.appendChild(copy);
      body.appendChild(panel);
    } catch (_) {}
  }

  /* Recompute from the exported object: marker-install failures also stop boot. */
  if (!root.__MLS_PUBLIC_PREVIEW || root.__MLS_PUBLIC_PREVIEW.enabled !== true || failures.length) hardLockDocument();
})(window);
