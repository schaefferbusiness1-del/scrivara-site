

/* === MLS Assist v1.36 — panel pull-to-app + read-only search-and-navigate driver (APPEND-ONLY to background.js) ===
 * One additional chrome.runtime.onMessage listener (Chrome supports multiple).
 * It returns true ONLY for its own message types and otherwise returns nothing,
 * so existing listeners are unaffected. NEVER clicks Save/Sign/finalize on a
 * chart (read-only navigation: typing in the search bar + opening a chart only).
 *
 *  - mlsAssistPullToApp: the panel "Pull from chart" button asks us to run the
 *    proven in-app Athena pull. We focus the MLS (mlsscribe.com) tab and trigger
 *    its real "Pull from Athena" flow (frame-aware v1.34 reader) so the open
 *    chart's patient + all visits land in MLS with the app's status/verify.
 *
 *  - mlsAppSearchOpenRequest: drive athenaOne's PATIENT SEARCH bar — type the
 *    "Last, First" name, run the search, find the matching result, open the
 *    chart. Content-scored selectors with fallbacks (robust without a live tune),
 *    plus a PHI-safe redacted structural diag for one-time tuning. */
(function () {
  'use strict';
  try { if (self.__mlsV136Wired) return; self.__mlsV136Wired = 1; } catch (e) {}

  // local EMR-tab picker (does not rely on the existing mlsPickEmrTab being in scope)
  function pickEmrTab(all) {
    try {
      var http = all.filter(function (t) { return /^https?:\/\//.test(t.url || ''); });
      var known = http.filter(function (t) { return /athenahealth\.com|athenanet/i.test(t.url || ''); });
      if (known.length) { var act = known.find(function (t) { return t.active; }); return act || known[0]; }
      var emrish = http.filter(function (t) { return /emr|ehr|chart|clinical|epic|cerner|practice/i.test((t.url || '') + ' ' + (t.title || '')); });
      if (emrish.length) return emrish[0];
      var nonMls = http.filter(function (t) { return !/mlsscribe\.com|github\.com|google\.com\/search/i.test(t.url || ''); });
      return nonMls.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); })[0] || null;
    } catch (e) { return null; }
  }

  function findAppTab(all) {
    return all.find(function (t) { return /^https?:\/\/(www\.)?mlsscribe\.com\//.test(t.url || ''); }) || null;
  }

  // --- the page-side driver (self-contained; serialized to the tab) ---
  function mlsSearchOpenDriverFn(name, phase) {
    try {
      function vis(el) { try { var r = el.getBoundingClientRect(); var s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; } catch (e) { return false; } }
      var parts = String(name || '').split(',');
      var lname = (parts[0] || '').trim().toLowerCase();
      var fname = (parts[1] || '').trim().toLowerCase();
      if (phase === 'fill') {
        var inputs = [].slice.call(document.querySelectorAll('input,textarea')).filter(vis);
        function scoreInput(i) {
          var s = 0;
          var hay = ((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.title || '')).toLowerCase();
          if (/search/.test(hay)) s += 3;
          if (/patient|name|find|lookup|client|mrn|chart|quicksearch|global/.test(hay)) s += 3;
          var ty = (i.type || '').toLowerCase();
          if (ty === 'search') s += 3; if (ty === '' || ty === 'text') s += 1;
          if (ty === 'hidden' || ty === 'password' || ty === 'checkbox' || ty === 'radio') s -= 10;
          var r = i.getBoundingClientRect(); if (r.top < 170) s += 1; // global search usually top
          return s;
        }
        inputs.sort(function (a, b) { return scoreInput(b) - scoreInput(a); });
        var best = inputs[0];
        var diag = { frame: location.hostname, inputCount: inputs.length, topScore: best ? scoreInput(best) : -1 };
        if (!best || scoreInput(best) < 3) return { phase: 'fill', filled: false, diag: diag };
        try {
          var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
          var setter = proto && Object.getOwnPropertyDescriptor(proto, 'value');
          best.focus();
          if (setter && setter.set) setter.set.call(best, name); else best.value = name;
          best.dispatchEvent(new Event('input', { bubbles: true }));
          best.dispatchEvent(new Event('change', { bubbles: true }));
          ['keydown', 'keypress', 'keyup'].forEach(function (t) {
            try { best.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); } catch (e) {}
          });
          var form = best.closest && best.closest('form');
          if (form) {
            var sb = [].slice.call(form.querySelectorAll('button,[role=button],input[type=submit]')).filter(vis).find(function (b) {
              return /search|find|go|lookup/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.value || ''));
            });
            if (sb) try { sb.click(); } catch (e) {}
          }
        } catch (e) { return { phase: 'fill', filled: false, diag: diag, error: String((e && e.message) || e) }; }
        diag.inputSig = { tag: best.tagName, type: (best.type || ''), hasPlaceholder: !!best.placeholder };
        return { phase: 'fill', filled: true, diag: diag };
      }
      if (phase === 'open') {
        var BAD = /save|sign|finalize|post|bill|submit|delete|lock|addend|amend|close encounter|check ?out|log ?out|sign ?off|cancel/i;
        var nodes = [].slice.call(document.querySelectorAll('a,[role=option],[role=row],tr,li,[role=link],div[role=button]')).filter(vis);
        function rowText(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
        function scoreRow(el) {
          var tx = rowText(el).toLowerCase();
          if (!tx || tx.length > 220) return -1;
          if (BAD.test(tx)) return -1;
          var s = 0;
          if (lname && tx.indexOf(lname) !== -1) s += 4;
          if (fname && tx.indexOf(fname) !== -1) s += 3;
          if (lname && fname) { try { if (new RegExp(lname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*,\\s*' + fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(tx)) s += 3; } catch (e) {} }
          if (el.tagName === 'A' || el.getAttribute('role') === 'option' || el.getAttribute('role') === 'link') s += 1;
          return s;
        }
        var scored = nodes.map(function (el) { return { el: el, sc: scoreRow(el) }; }).filter(function (o) { return o.sc >= 4; }).sort(function (a, b) { return b.sc - a.sc; });
        var diag = { frame: location.hostname, scanned: nodes.length, matches: scored.length, topScore: scored[0] ? scored[0].sc : -1 };
        if (!scored.length) return { phase: 'open', opened: false, candidates: 0, diag: diag };
        var top = scored[0];
        try {
          var clickT = (top.el.querySelector && top.el.querySelector('a')) || top.el;
          clickT.click();
        } catch (e) { try { top.el.click(); } catch (e2) {} }
        diag.pickedSig = { tag: top.el.tagName, score: top.sc };
        return { phase: 'open', opened: true, candidates: scored.length, diag: diag };
      }
      return { phase: phase, error: 'unknown phase' };
    } catch (e) { return { phase: phase, error: String((e && e.message) || e) }; }
  }

  function bestFrameResult(results, key) {
    // results: array of {result} from executeScript allFrames. Pick the frame
    // whose driver reports success / highest score.
    var rs = (results || []).map(function (r) { return r && r.result; }).filter(Boolean);
    var hit = rs.filter(function (r) { return r && (r.filled || r.opened); });
    if (hit.length) {
      hit.sort(function (a, b) { return ((b.diag && b.diag.topScore) || 0) - ((a.diag && a.diag.topScore) || 0); });
      return hit[0];
    }
    // none succeeded — return the richest diag for tuning
    rs.sort(function (a, b) { return ((b.diag && b.diag.topScore) || -2) - ((a.diag && a.diag.topScore) || -2); });
    return rs[0] || null;
  }

  function progress(tabId, message) { try { chrome.tabs.sendMessage(tabId, { type: 'mlsAppSearchOpenProgress', message: message }); } catch (e) {} }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    // (A) Panel "Pull from chart" -> focus MLS tab + trigger the proven in-app pull
    if (msg.type === 'mlsAssistPullToApp') {
      (async function () {
        try {
          var all = await chrome.tabs.query({});
          var appTab = findAppTab(all);
          if (!appTab) { sendResponse({ ok: false, error: 'Open MLS (mlsscribe.com) in a tab first, then try again.' }); return; }
          try { await chrome.tabs.update(appTab.id, { active: true }); if (appTab.windowId != null) await chrome.windows.update(appTab.windowId, { focused: true }); } catch (e) {}
          var r = await chrome.scripting.executeScript({
            target: { tabId: appTab.id },
            world: 'MAIN',
            func: function () {
              try {
                var btn = document.getElementById('ptPullAthenaBtn');
                if (btn) {
                  var state = String(btn.getAttribute('data-mls-open-patient-state') || '');
                  var owner = String(btn.getAttribute('data-mls-open-patient-owner') || '');
                  var liveReason = '';
                  try {
                    var visitsOwner = window.__mlsCopyVisits;
                    if (visitsOwner && typeof visitsOwner._openPatientPullHiddenReason === 'function') {
                      liveReason = String(visitsOwner._openPatientPullHiddenReason() || '');
                    }
                  } catch (eLiveGate) { return 'blocked:gate-check-failed'; }
                  var ownerGate = btn.getAttribute('data-mls-open-patient-hidden') === '1';
                  var stateGate = owner === 'feat-visits-v2' && state !== 'visible' && state !== 'visible-with-selected-patient';
                  var displayGate = !!btn.hidden || btn.getAttribute('aria-hidden') === 'true';
                  try {
                    var style = getComputedStyle(btn);
                    displayGate = displayGate || style.display === 'none' || style.visibility === 'hidden' || btn.getClientRects().length < 1;
                  } catch (eStyle) {}
                  var blockedReason = liveReason;
                  if (!blockedReason && (btn.disabled || btn.getAttribute('aria-busy') === 'true')) blockedReason = 'pull-in-flight';
                  if (!blockedReason && (ownerGate || stateGate)) blockedReason = state || 'unavailable';
                  if (!blockedReason && displayGate) blockedReason = 'unavailable';
                  if (blockedReason) return 'blocked:' + blockedReason;
                  btn.click(); return 'clicked';
                }
                if (window.__mlsAthenaActions && window.__mlsAthenaActions.pullOpenChart) { window.__mlsAthenaActions.pullOpenChart({ title: 'Pull from chart', patientName: null, intent: { brings: 'Pull from chart → brings in name, DOB and all visits.', mode: 'read' } }); return 'shared'; }
                if (window.__mlsAthenaAutoPull && window.__mlsAthenaAutoPull.run) { window.__mlsAthenaAutoPull.run(); return 'autopull'; }
                return 'no-target';
              } catch (e) { return 'err:' + (e && e.message); }
            }
          });
          var v = r && r[0] && r[0].result;
          if (v === 'no-target') { sendResponse({ ok: false, error: 'Open the MLS Visit or Patients page first, then try again.' }); return; }
          if (typeof v === 'string' && v.indexOf('blocked:') === 0) {
            var blockedReason = v.slice('blocked:'.length) || 'unavailable';
            var blockedMessage = blockedReason === 'pull-in-flight'
              ? 'Another Athena pull is already running in MLS. Wait for it to finish, then try again.'
              : blockedReason === 'recording'
                ? 'Finish or pause the current recording before switching the open Athena patient.'
                : blockedReason === 'identity-unsafe'
                  ? 'MLS cannot safely match the open Athena patient yet. Re-open the intended chart, then try again.'
                  : 'The MLS open-patient pull is not available right now. Open the Patients page and try again.';
            sendResponse({ ok: false, reason: blockedReason, error: blockedMessage }); return;
          }
          if (typeof v === 'string' && v.indexOf('err:') === 0) { sendResponse({ ok: false, error: v.slice(4) }); return; }
          sendResponse({ ok: true, via: v });
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    }

    // (B) Search-and-navigate by name (read-only: type in search bar + open chart)
    if (msg.type === 'mlsAppSearchOpenRequest') {
      (async function () {
        var senderTab = sender && sender.tab && sender.tab.id;
        try {
          var all = await chrome.tabs.query({});
          var tab = pickEmrTab(all);
          if (!tab) { sendResponse({ ok: false, error: 'Open your signed-in athenaOne in another tab, then try again.' }); return; }
          if (senderTab) progress(senderTab, 'Going to the Athena patient search…');
          var fillRes = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsSearchOpenDriverFn, args: [msg.name || '', 'fill'] });
          var fill = bestFrameResult(fillRes, 'fill');
          if (!fill || !fill.filled) {
            sendResponse({ ok: false, opened: false, error: 'Could not find the Athena patient search box on this screen.', diag: fill && fill.diag });
            return;
          }
          if (senderTab) progress(senderTab, 'Searching “' + (msg.name || '') + '”…');
          await new Promise(function (r) { setTimeout(r, 1900); }); // let results render
          if (senderTab) progress(senderTab, 'Reading the results…');
          var openRes = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsSearchOpenDriverFn, args: [msg.name || '', 'open'] });
          var opened = bestFrameResult(openRes, 'open');
          if (opened && opened.opened) {
            sendResponse({ ok: true, opened: true, candidates: opened.candidates, diag: opened.diag });
          } else {
            var cands = (openRes || []).map(function (r) { return r && r.result; }).filter(Boolean).reduce(function (a, r) { return a + ((r && r.candidates) || 0); }, 0);
            sendResponse({ ok: false, opened: false, candidates: cands, error: cands > 1 ? ('Found ' + cands + ' possible matches.') : 'No matching patient was found in the results.', diag: opened && opened.diag });
          }
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    }
    // not ours — let other listeners handle it
  });
})();
