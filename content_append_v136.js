

/* === MLS Assist v1.36 — panel "Pull from chart" fix + search-and-navigate relay (APPEND-ONLY to content.js) ===
 * Two self-contained IIFEs. Neither touches the existing bridge router or the
 * existing #mls-cap handler code; they ADD behavior and are individually
 * reversible by removing this block. Read-only on Athena (no Save/Sign).
 *
 *  (1) Panel "Pull from chart": the old #mls-cap button read only the TOP frame's
 *      innerText (empty on iframed athenaNet) and sent it to an AI extract, so it
 *      did nothing on real charts. This intercepts the click and instead routes
 *      the pull through the proven in-app Athena pull (which uses the frame-aware
 *      v1.34 reader), so it reads the open chart's patient (name+DOB) and ALL
 *      their visits into MLS — with the shared app module's live status,
 *      destination report, save-verify, and self-recovery. Honest failure if no
 *      MLS tab / no chart / extension.
 *
 *  (2) Search-and-navigate relay: forwards the app's mlsAppSearchOpenPatient
 *      request to background (which drives Athena's patient search bar read-only:
 *      type "Last, First", run search, open the matching chart) and streams the
 *      result/progress back to the page. Mirrors the v1.34 copy-every-visit
 *      bridge exactly. */

/* (1) Panel "Pull from chart" -> route through the in-app proven pull ---------*/
(function () {
  'use strict';
  try { if (window.__mlsPanelPullFix) return; window.__mlsPanelPullFix = 1; } catch (e) { return; }

  function relabel() {
    try {
      var btn = document.getElementById('mls-cap');
      if (!btn) return;
      if (btn.getAttribute('data-mls-pullfix') === '1') return;
      btn.setAttribute('data-mls-pullfix', '1');
      btn.textContent = '📋 Pull from chart → MLS';
      btn.setAttribute('data-tip', 'Reads THIS open chart’s patient (name + DOB) and ALL their visits into MLS — read-only, nothing is written back to the EMR.');
      // a small honest intent line under the button
      if (btn.parentNode && !btn.parentNode.querySelector('.mls-pullfix-intent')) {
        var cap = document.createElement('div');
        cap.className = 'mls-pullfix-intent';
        cap.style.cssText = 'font-size:10.5px;line-height:1.3;color:#41566b;margin-top:3px;';
        cap.innerHTML = '<b style="color:#0f6b3a;">READ-ONLY</b> — brings in name, DOB and every visit from the open chart.';
        btn.parentNode.insertBefore(cap, btn.nextSibling);
      }
    } catch (e) {}
  }
  // panel is injected on demand; find the button when it appears (idempotent)
  try {
    var mo = new MutationObserver(function () { relabel(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  relabel();

  function status(btn, msg) { try { var s = btn.parentNode && btn.parentNode.querySelector('.mls-pullfix-intent'); if (s) s.innerHTML = msg; } catch (e) {} }

  // capture-phase interceptor: suppress the OLD #mls-cap handler and run the new one
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var btn = t && t.closest ? t.closest('#mls-cap') : null;
    if (!btn) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    try {
      btn.disabled = true; var old = btn.textContent; btn.textContent = '… reading the open chart';
      status(btn, 'Reading the open chart and sending it to MLS…');
      chrome.runtime.sendMessage({ type: 'mlsAssistPullToApp', url: location.href }, function (resp) {
        btn.disabled = false; btn.textContent = old;
        var err = chrome.runtime && chrome.runtime.lastError;
        if (err || !resp) { status(btn, '<b style="color:#a01818;">MLS Assist didn’t respond.</b> Reload it at chrome://extensions, then try again.'); return; }
        if (resp.ok) {
          status(btn, '<b style="color:#0f6b3a;">✓ Sent to MLS.</b> Switch to the MLS tab — it shows live progress, the exact destination, and a save-verify.');
        } else {
          status(btn, '<b style="color:#a01818;">' + (resp.error || 'Couldn’t start the pull.') + '</b>');
        }
      });
    } catch (e) {
      btn.disabled = false;
      status(btn, '<b style="color:#a01818;">Couldn’t start the pull.</b> ' + String((e && e.message) || e));
    }
  }, true);
})();

/* (2) Search-and-navigate relay (mirrors the v1.34 copy-every-visit bridge) ----*/
(function () {
  'use strict';
  try { if (window.__mlsSearchOpenBridge) return; window.__mlsSearchOpenBridge = 1; } catch (e) { return; }
  var activeOrigin = '', activeUntil = 0;
  function trusted(origin) {
    if (!origin || typeof origin !== 'string') return false;
    try {
      var u = new URL(origin);
      if (u.protocol === 'https:' && (u.hostname === 'mlsscribe.com' || u.hostname === 'www.mlsscribe.com' || u.hostname.endsWith('.mlsscribe.com'))) return true;
    } catch (e) {}
    return false;
  }
  function post(origin, type, payload) {
    try { var o = {}; for (var k in payload) o[k] = payload[k]; o.source = 'mls-ext'; o.type = type; window.postMessage(o, origin || '*'); } catch (e) {}
  }
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (!d || d.source !== 'mls-app' || d.type !== 'mlsAppSearchOpenPatient') return;
    if (!trusted(ev.origin)) return;
    activeOrigin = ev.origin; activeUntil = Date.now() + 120000;
    try {
      chrome.runtime.sendMessage({ type: 'mlsAppSearchOpenRequest', name: d.name || d.raw || '' }, function (res) {
        var err = chrome.runtime && chrome.runtime.lastError;
        if (err || !res) { post(activeOrigin, 'mlsAppSearchOpenResult', { ok: false, error: (err && err.message) || 'No response from MLS Assist', unhandled: true }); return; }
        var out = {}; for (var k in res) out[k] = res[k];
        post(activeOrigin, 'mlsAppSearchOpenResult', out);
      });
    } catch (e) { post(activeOrigin, 'mlsAppSearchOpenResult', { ok: false, error: String((e && e.message) || e) }); }
  }, false);
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'mlsAppSearchOpenProgress') {
        if (activeOrigin && Date.now() < activeUntil) post(activeOrigin, 'mlsAppSearchOpenProgress', { message: msg.message });
      }
    });
  } catch (e) {}
})();
