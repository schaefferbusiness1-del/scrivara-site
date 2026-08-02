/* MLS destination-teaching navigation guard.
 * Registered only while one explicit teaching session is active. A document
 * created after the watcher snapshot is blocked at document_start until the
 * background retires that stale session. This file never reads or mutates PHI. */
(function () {
  'use strict';
  var KEY = '__mlsDestinationTeachNavigationGuardV1';
  try { if (globalThis[KEY] && typeof globalThis[KEY].cleanup === 'function') globalThis[KEY].cleanup(); } catch (ePrior) {}
  var active = true, timer = null, listeners = [];
  var types = ['pointerdown','pointerup','pointercancel','mousedown','mouseup','touchstart','touchend','touchcancel','click','auxclick','dblclick','contextmenu','keydown','keyup','keypress','submit'];
  function consume(ev) {
    if (!active) return;
    try { ev.preventDefault(); } catch (ePrevent) {}
    try { ev.stopImmediatePropagation(); } catch (eImmediate) {}
    try { ev.stopPropagation(); } catch (eStop) {}
  }
  function cleanup() {
    if (!active) return; active = false;
    if (timer) clearTimeout(timer); timer = null;
    for (var i = 0; i < listeners.length; i++) try { window.removeEventListener(listeners[i].type, listeners[i].fn, true); } catch (eRemove) {}
    listeners = [];
    try { if (globalThis[KEY] && globalThis[KEY].cleanup === cleanup) delete globalThis[KEY]; } catch (eDelete) { globalThis[KEY] = null; }
  }
  for (var i = 0; i < types.length; i++) {
    var fn = consume, type = types[i];
    window.addEventListener(type, fn, { capture: true, passive: false });
    listeners.push({ type: type, fn: fn });
  }
  globalThis[KEY] = { cleanup: cleanup };
  /* Keep the new document inert until the service worker acknowledges that its
     predecessor teaching session has been retired. The cap prevents a broken
     extension worker from stranding Athena indefinitely. */
  timer = setTimeout(cleanup, 65000);
  try {
    chrome.runtime.sendMessage({ type: 'mlsAthenaTeachNavigationGuardReady' }, function () {
      var ignored = chrome.runtime.lastError;
      cleanup();
    });
  } catch (eSend) { cleanup(); }
})();
