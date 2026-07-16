/* =============================================================================
 * feat_mls_copilot_dock_fix.js -> window.__mlsCopilotDockFix  (cdf-2.0.0)
 * -----------------------------------------------------------------------------
 * Gives MLS Copilot one stable DOM home.  Older integration code moved the live
 * thread/chips/composer into the Assistant section and the previous fix moved
 * those same nodes back and forth again on every dock open/close.  That physical
 * shuttle could race a render and leave an open, blank dock.
 *
 * This controller claims #copilotCard as the canonical home exactly once (and
 * only reclaims it if another late boot owner displaced the nodes).  Closing the
 * dock never moves the conversation.  The Assistant section gets a small proxy
 * button to the same canonical Copilot rather than becoming a second DOM owner.
 * Startup recovery is bounded and event-driven; a visible retry control remains
 * if the base Copilot mounts late.  Website only; no external-system access.
 * ===========================================================================*/
(function () {
  'use strict';
  var NS = '__mlsCopilotDockFix', VERSION = 'cdf-2.0.0';
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  var CHAT_IDS = ['copilotThread', 'copilotChips', 'copilotInputRow'];
  var STATE_ID = 'mlsCopilotDockState', PROXY_ID = 'mlsCopilotStableProxy';
  var STYLE_ID = 'mlsCopilotDockStableStyle';
  var MAX_TRIES = 40, RETRY_MS = 250;
  var timer = null, tries = 0, state = 'waiting', events = [];
  var originalOpen = null, originalClose = null;

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function byId(id) { return safe(function () { return document.getElementById(id); }, null); }
  function isFn(fn) { return typeof fn === 'function'; }
  function append(parent, child) { try { if (parent && child) parent.appendChild(child); } catch (e) {} }

  function ensureStyle() {
    if (byId(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '#' + STATE_ID + '{box-sizing:border-box;margin:14px;padding:16px;border:1px solid #d8e5de;border-radius:14px;background:#f7fbf8;color:#204034;font:600 13px/1.45 system-ui;text-align:center}' +
      '#' + STATE_ID + '[hidden]{display:none!important}' +
      '#' + STATE_ID + ' button,#' + PROXY_ID + ' button{margin-top:10px;border:0;border-radius:10px;padding:9px 14px;background:#204034;color:#fff;font:700 12px system-ui;cursor:pointer}' +
      '#' + PROXY_ID + '{box-sizing:border-box;margin:10px 0;padding:13px;border:1px solid #d8e5de;border-radius:12px;background:#f7fbf8;color:#395649;font:600 12px/1.45 system-ui;text-align:center}';
    append(document.head || document.documentElement, style);
  }

  function setState(next, message, retryable) {
    state = next;
    var card = byId('copilotCard');
    if (!card) return;
    var box = byId(STATE_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = STATE_ID;
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      try { card.insertBefore(box, card.firstChild || null); } catch (e) { append(card, box); }
    }
    box.hidden = next === 'ready';
    box.textContent = message || '';
    if (retryable) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Retry Copilot';
      button.onclick = function () { retry(); };
      append(box, button);
    }
  }

  function installProxy() {
    var sec = byId('mls-asst-copilot-sec');
    if (!sec || byId(PROXY_ID)) return;
    var proxy = document.createElement('div');
    proxy.id = PROXY_ID;
    proxy.textContent = 'MLS Copilot uses one shared conversation and is ready in its full workspace.';
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Open MLS Copilot';
    button.onclick = function () {
      ensureCanonicalHome();
      safe(function () { if (isFn(window.openCopilotDock)) window.openCopilotDock(); });
    };
    append(proxy, button);
    append(sec, proxy);
  }

  function nodesReady() {
    var card = byId('copilotCard');
    if (!card) return false;
    for (var i = 0; i < CHAT_IDS.length; i++) {
      var node = byId(CHAT_IDS[i]);
      if (!node || !card.contains(node)) return false;
    }
    return true;
  }

  /* The only ownership move in this module: claim the canonical card.  It is
     never reversed on close, so open/close cannot race a thread repaint. */
  function ensureCanonicalHome() {
    var card = byId('copilotCard');
    if (!card) { state = 'waiting'; return false; }
    var note = safe(function () { return card.querySelector('.note'); }, null);
    var complete = true;
    for (var i = 0; i < CHAT_IDS.length; i++) {
      var node = byId(CHAT_IDS[i]);
      if (!node) { complete = false; continue; }
      if (!card.contains(node)) {
        try { if (note) card.insertBefore(node, note); else card.appendChild(node); } catch (e) { complete = false; }
      }
    }
    installProxy();
    if (complete && nodesReady()) {
      setState('ready', '', false);
      return true;
    }
    setState('waiting', 'Preparing your MLS Copilot conversation...', false);
    return false;
  }

  function installWraps() {
    var open = safe(function () { return window.openCopilotDock; }, null);
    if (isFn(open) && !open.__mlsStableDock) {
      originalOpen = open;
      var wrappedOpen = function () {
        ensureCanonicalHome();
        var result = originalOpen.apply(this, arguments);
        safe(function () { requestAnimationFrame(function () { ensureCanonicalHome(); }); });
        return result;
      };
      wrappedOpen.__mlsStableDock = true;
      wrappedOpen.__orig = originalOpen;
      window.openCopilotDock = wrappedOpen;
    }
    var close = safe(function () { return window.closeCopilotDock; }, null);
    if (isFn(close) && !close.__mlsStableDock) {
      originalClose = close;
      var wrappedClose = function () {
        /* Intentionally no return-to-section move. */
        return originalClose.apply(this, arguments);
      };
      wrappedClose.__mlsStableDock = true;
      wrappedClose.__orig = originalClose;
      window.closeCopilotDock = wrappedClose;
    }
    return isFn(window.openCopilotDock) && isFn(window.closeCopilotDock);
  }

  function stopTimer() {
    if (timer) { try { clearInterval(timer); } catch (e) {} timer = null; }
  }
  function tick() {
    tries++;
    installWraps();
    if (ensureCanonicalHome() && installWraps()) { stopTimer(); return true; }
    if (tries >= MAX_TRIES) {
      stopTimer();
      setState('error', 'Copilot is taking longer than expected to load.', true);
    }
    return false;
  }
  function retry() {
    stopTimer();
    tries = 0;
    setState('waiting', 'Preparing your MLS Copilot conversation...', false);
    if (tick()) return true;
    timer = setInterval(tick, RETRY_MS);
    return false;
  }

  function bindEvent(name) {
    var fn = function () { if (!nodesReady()) retry(); else { installWraps(); installProxy(); } };
    safe(function () { window.addEventListener(name, fn, false); });
    events.push([name, fn]);
  }
  function boot() {
    ensureStyle();
    bindEvent('mls:ui-ready');
    bindEvent('mls:copilot-ready');
    bindEvent('mls:panel-open');
    retry();
  }

  function revert() {
    stopTimer();
    for (var i = 0; i < events.length; i++) safe(function (row) { window.removeEventListener(row[0], row[1], false); }.bind(null, events[i]));
    events = [];
    safe(function () { if (window.openCopilotDock && window.openCopilotDock.__mlsStableDock) window.openCopilotDock = window.openCopilotDock.__orig; });
    safe(function () { if (window.closeCopilotDock && window.closeCopilotDock.__mlsStableDock) window.closeCopilotDock = window.closeCopilotDock.__orig; });
    [STATE_ID, PROXY_ID, STYLE_ID].forEach(function (id) { var n = byId(id); if (n && n.parentNode) safe(function () { n.parentNode.removeChild(n); }); });
    try { window[NS].installed = false; } catch (e) {}
    return true;
  }

  window[NS] = {
    installed: true,
    version: VERSION,
    asset: 'feat_mls_copilot_dock_fix.js',
    ensureCanonicalHome: ensureCanonicalHome,
    retry: retry,
    state: function () { return state; },
    nodesReady: nodesReady,
    /* Kept as a compatibility alias; it deliberately never returns nodes to
       the competing section owner. */
    borrowIntoCard: ensureCanonicalHome,
    returnToSec: ensureCanonicalHome,
    chatMergedAway: function () { return !nodesReady(); },
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
