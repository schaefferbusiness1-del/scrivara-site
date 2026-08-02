/* MLS Assist — taught-destination memory (tdm-1.0.0).
 *
 * Makes Teach Destination durable and honest:
 *  - REMEMBERS where a field goes per (practice, provider, action, section):
 *    after every successful teach capture, a PHI-free layout record (selector,
 *    frame path, tag, fingerprint, layout hash) is stored in
 *    chrome.storage.local under mlsTaughtDestMemoryV1.
 *  - DETECTS LAYOUT CHANGES instead of writing to a stale guess: the stored
 *    layoutHash/targetFingerprint is recomputed live by a read-only dry-run
 *    locator (same FNV-1a fingerprint recipe as the teach watcher:
 *    hash(framePath|selector|sectionLabel|tag)). Any drift marks the entry
 *    STALE with a reason — a stale entry is never returned by recall.
 *  - DRY-RUN BEFORE WRITE: mlsTeachMemoryDryRunRequest injects the locator
 *    (read-only, no clicks, no focus, no mutation) and reports exactly where
 *    the write WOULD land — valid | layout-changed | not-found.
 *
 * Authorization is unchanged: recall hands the app a layout HINT; every write
 * still flows through the supervised V2 probe/execute contract, which
 * re-validates the taught destination against the live DOM. This store never
 * contains patient data — keys and records are layout facts only.
 */
(function (root) {
  'use strict';
  if (root.MLSTeachMemory && root.MLSTeachMemory.version) return;
  var VERSION = 'tdm-1.0.0';
  var STORE_KEY = 'mlsTaughtDestMemoryV1';
  var MAX_ENTRIES = 200;

  function text(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function norm(v) { return text(v).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function simpleHash(v) {
    var s = String(v || ''), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function urlPathKey(u) {
    try { var p = new URL(String(u || '')); return p.origin + p.pathname; } catch (e) { return String(u || '').split(/[?#]/)[0]; }
  }
  function practiceIdFromUrl(url) {
    try {
      var u = new URL(String(url || ''));
      if (!/(^|\.)athenahealth\.com$/i.test(u.hostname)) return '';
      var m = /^\/(\d{1,9})(?:\/|$)/.exec(u.pathname);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /* ------------------------- keying + records ------------------------ */
  function entryKey(opts) {
    opts = opts || {};
    return simpleHash([digits(opts.practiceId), norm(opts.provider), norm(opts.action), norm(opts.sectionLabel)].join('|'));
  }
  /* Layout hash: the structural facts that must all still hold for a stored
     destination to be trusted. Changing any of them (frame path, frame URL
     path, tag, selector shape, section label) means Athena's layout moved. */
  function layoutHashFor(target) {
    target = target || {};
    return simpleHash([text(target.framePath), urlPathKey(target.frameUrl), norm(target.tag), text(target.selector), norm(target.sectionLabel)].join('|'));
  }
  function buildEntry(opts) {
    opts = opts || {};
    var target = opts.target || {};
    if (!text(target.selector) || !text(target.sectionLabel) || !text(target.framePath) || !text(target.tag) || !text(target.targetFingerprint)) return null;
    if (!norm(opts.provider) || !norm(opts.action)) return null;
    return {
      v: 1,
      key: entryKey({ practiceId: opts.practiceId, provider: opts.provider, action: opts.action, sectionLabel: target.sectionLabel }),
      practiceId: digits(opts.practiceId),
      provider: norm(opts.provider),
      action: norm(opts.action),
      sectionLabel: text(target.sectionLabel).slice(0, 240),
      selector: text(target.selector).slice(0, 2000),
      framePath: text(target.framePath).slice(0, 100),
      frameUrlPath: urlPathKey(target.frameUrl).slice(0, 600),
      tag: norm(target.tag).slice(0, 40),
      targetFingerprint: text(target.targetFingerprint).slice(0, 120),
      layoutHash: layoutHashFor(target),
      capturedAt: Number(opts.now || Date.now()),
      lastVerifiedAt: Number(opts.now || Date.now()),
      stale: false,
      staleReason: ''
    };
  }

  /* ------------------------- storage plumbing ------------------------ */
  function storage() {
    try { return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null; } catch (e) { return null; }
  }
  function loadStore() {
    var st = storage();
    if (!st) return Promise.resolve({});
    return new Promise(function (resolve) {
      try { st.get([STORE_KEY], function (c) { resolve((c && c[STORE_KEY] && typeof c[STORE_KEY] === 'object') ? c[STORE_KEY] : {}); }); }
      catch (e) { resolve({}); }
    });
  }
  function saveStore(map) {
    var st = storage();
    if (!st) return Promise.resolve(false);
    var keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys.sort(function (a, b) { return (map[a].lastVerifiedAt || 0) - (map[b].lastVerifiedAt || 0); });
      for (var i = 0; i < keys.length - MAX_ENTRIES; i++) delete map[keys[i]];
    }
    return new Promise(function (resolve) {
      try { var payload = {}; payload[STORE_KEY] = map; st.set(payload, function () { resolve(!chrome.runtime.lastError); }); }
      catch (e) { resolve(false); }
    });
  }

  /* --------------------------- operations ---------------------------- */
  function saveCaptured(opts) {
    var entry = buildEntry(opts);
    if (!entry) return Promise.resolve({ ok: false, reason: 'invalid-capture' });
    return loadStore().then(function (map) {
      map[entry.key] = entry;
      return saveStore(map).then(function (ok) { return { ok: ok, key: entry.key, layoutHash: entry.layoutHash }; });
    });
  }
  function recall(opts) {
    opts = opts || {};
    var key = entryKey(opts);
    return loadStore().then(function (map) {
      var entry = map[key];
      if (!entry) return { ok: false, reason: 'not-remembered' };
      if (entry.stale) return { ok: false, reason: 'stale', staleReason: entry.staleReason || 'layout-changed' };
      return { ok: true, entry: entry };
    });
  }
  function markStale(key, reason) {
    return loadStore().then(function (map) {
      if (!map[key]) return { ok: false, reason: 'not-remembered' };
      map[key].stale = true;
      map[key].staleReason = text(reason).slice(0, 120) || 'layout-changed';
      return saveStore(map).then(function (ok) { return { ok: ok }; });
    });
  }
  function markVerified(key, now) {
    return loadStore().then(function (map) {
      if (!map[key]) return { ok: false, reason: 'not-remembered' };
      map[key].lastVerifiedAt = Number(now || Date.now());
      map[key].stale = false;
      map[key].staleReason = '';
      return saveStore(map).then(function (ok) { return { ok: ok }; });
    });
  }
  function forget(key) {
    return loadStore().then(function (map) {
      if (!map[key]) return { ok: true, removed: false };
      delete map[key];
      return saveStore(map).then(function (ok) { return { ok: ok, removed: true }; });
    });
  }
  function listEntries() {
    return loadStore().then(function (map) {
      return Object.keys(map).map(function (k) {
        var e = map[k];
        return { key: k, practiceId: e.practiceId, provider: e.provider, action: e.action, sectionLabel: e.sectionLabel, stale: !!e.stale, staleReason: e.staleReason || '', capturedAt: e.capturedAt, lastVerifiedAt: e.lastVerifiedAt };
      });
    });
  }

  /* ------------------- read-only dry-run locator ---------------------- *
   * Injected into the TOP frame of the one Athena tab. Walks same-origin
   * frames to the stored framePath, resolves the stored selector (including
   * `>>>` shadow steps), recomputes sectionLabel + the teach-watcher
   * fingerprint, and reports. NO clicks, NO focus, NO typing, NO mutation. */
  function mlsTeachDryRunLocatorFn(req) {
    try {
      req = req && typeof req === 'object' ? req : {};
      function t(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
      function hash(v) { var s = String(v || ''), h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ('00000000' + (h >>> 0).toString(16)).slice(-8); }
      var selector = t(req.selector), framePath = t(req.framePath), wantTag = t(req.tag).toLowerCase(), wantFingerprint = t(req.targetFingerprint), wantSection = t(req.sectionLabel);
      if (!selector || !framePath || !wantFingerprint) return { ok: false, state: 'not-found', reason: 'invalid-request' };
      var frames = [];
      (function walk(w, depth, path) {
        if (depth > 6) return;
        try { void w.document; frames.push({ w: w, doc: w.document, path: path, url: String(w.location.href || '').split('#')[0] }); } catch (e) { return; }
        for (var i = 0; i < w.frames.length; i++) try { void w.frames[i].document; walk(w.frames[i], depth + 1, path + '.' + i); } catch (e2) {}
      })(window, 0, 'top');
      var frame = null;
      for (var fi = 0; fi < frames.length; fi++) if (frames[fi].path === framePath) { frame = frames[fi]; break; }
      if (!frame) return { ok: false, state: 'layout-changed', reason: 'frame-path-missing', framesSeen: frames.length };
      /* Resolve `a >>> b >>> c` by stepping through open shadow roots. */
      var steps = selector.split('>>>').map(t).filter(Boolean);
      var scope = frame.doc, el = null;
      for (var si = 0; si < steps.length; si++) {
        var all;
        try { all = scope.querySelectorAll(steps[si]); } catch (eSel) { return { ok: false, state: 'layout-changed', reason: 'selector-invalid' }; }
        if (!all || all.length !== 1) return { ok: false, state: all && all.length ? 'layout-changed' : 'not-found', reason: all && all.length ? 'selector-ambiguous' : 'selector-no-match', matches: all ? all.length : 0 };
        el = all[0];
        if (si < steps.length - 1) {
          var sr = null; try { sr = el.shadowRoot; } catch (eShadow) {}
          if (!sr) return { ok: false, state: 'layout-changed', reason: 'shadow-root-missing' };
          scope = sr;
        }
      }
      if (!el) return { ok: false, state: 'not-found', reason: 'selector-no-match' };
      var tag = String(el.tagName || '').toLowerCase();
      if (wantTag && tag !== wantTag) return { ok: false, state: 'layout-changed', reason: 'tag-changed', found: { tag: tag } };
      /* Recompute the section label with the teach watcher's recipe. */
      function parentAcrossRoots(node) {
        if (!node) return null; if (node.parentElement) return node.parentElement;
        try { var r = node.getRootNode(); return r && r.host ? r.host : null; } catch (e) { return null; }
      }
      function sectionLabelOf(node) {
        var own = '';
        try { own = t((node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('title') || '') + ' ' + (node.getAttribute('placeholder') || '')); if (!own && node.labels && node.labels.length === 1) own = t(node.labels[0].textContent); } catch (e) {}
        if (own && own.length <= 240) return own;
        var cur = node, guard = 0;
        while (cur && guard++ < 8) {
          var heads = []; try { heads = Array.prototype.slice.call(cur.querySelectorAll(':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > header,:scope > [role="heading"]')); } catch (e2) {}
          if (heads.length === 1) { var h = t(heads[0].textContent); if (h && h.length <= 240) return h; }
          if (cur === frame.doc.body) break; cur = parentAcrossRoots(cur);
        }
        var fb = ''; try { fb = t((node.textContent || node.value || '') + ' ' + (node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('title') || '')); } catch (e3) {}
        return fb.slice(0, 240);
      }
      var liveSection = sectionLabelOf(el);
      var liveFingerprint = hash([frame.path, selector, liveSection, tag].join('|'));
      var visible = false;
      try { var s = frame.w.getComputedStyle(el), r = el.getBoundingClientRect(); visible = s.display !== 'none' && s.visibility !== 'hidden' && r.width > 2 && r.height > 2; } catch (eVis) {}
      var found = { tag: tag, sectionLabel: liveSection.slice(0, 240), frameUrl: frame.url.slice(0, 300), framePath: frame.path, visible: visible };
      if (liveFingerprint !== wantFingerprint) return { ok: false, state: 'layout-changed', reason: liveSection !== wantSection ? 'section-label-changed' : 'fingerprint-changed', found: found };
      if (!visible) return { ok: false, state: 'layout-changed', reason: 'target-not-visible', found: found };
      return { ok: true, state: 'valid', found: found };
    } catch (e) { return { ok: false, state: 'not-found', reason: 'locator-error', error: String((e && e.message) || e).slice(0, 200) }; }
  }

  /* -------------------- service-worker wiring ------------------------ */
  function isAppSender(sender) {
    try { var u = new URL(sender && sender.tab && sender.tab.url || ''); return u.protocol === 'https:' && /(^|\.)mlsscribe\.com$/i.test(u.hostname); } catch (e) { return false; }
  }
  function pickOneAthenaTab() {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) return Promise.resolve(null);
    return chrome.tabs.query({ url: ['https://athenanet.athenahealth.com/*'] }).then(function (tabs) {
      tabs = (tabs || []).filter(function (tb) { return !/\b(login|signin|logout|identity|sso)\b/i.test(String(tb.url || '')); });
      return tabs.length === 1 ? tabs[0] : null;
    }).catch(function () { return null; });
  }
  function dryRun(opts) {
    opts = opts || {};
    var key = entryKey(opts);
    return loadStore().then(function (map) {
      var entry = map[key];
      if (!entry) return { ok: false, state: 'not-remembered' };
      return pickOneAthenaTab().then(function (tab) {
        if (!tab) return { ok: false, state: 'no-athena-tab', message: 'Open exactly one signed-in Athena tab, then retry.' };
        var livePractice = practiceIdFromUrl(tab.url);
        if (entry.practiceId && livePractice && entry.practiceId !== livePractice) {
          return { ok: false, state: 'practice-mismatch', message: 'The open Athena tab is a different practice than this taught destination.' };
        }
        if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') return { ok: false, state: 'not-found', reason: 'scripting-unavailable' };
        return chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN',
          args: [{ selector: entry.selector, framePath: entry.framePath, tag: entry.tag, targetFingerprint: entry.targetFingerprint, sectionLabel: entry.sectionLabel }],
          func: mlsTeachDryRunLocatorFn
        }).then(function (r) {
          var out = r && r[0] && r[0].result ? r[0].result : { ok: false, state: 'not-found', reason: 'no-result' };
          var after = out.state === 'valid' ? markVerified(key) : markStale(key, out.reason || out.state);
          return after.then(function () {
            out.key = key;
            out.entry = { sectionLabel: entry.sectionLabel, provider: entry.provider, action: entry.action, practiceId: entry.practiceId };
            return out;
          });
        }).catch(function (e) { return { ok: false, state: 'not-found', reason: 'injection-failed', error: String((e && e.message) || e).slice(0, 200) }; });
      });
    });
  }

  function wireMessages() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return false;
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || typeof msg.type !== 'string') return;
      var handled = { mlsTeachMemoryRecallRequest: 1, mlsTeachMemoryDryRunRequest: 1, mlsTeachMemoryListRequest: 1, mlsTeachMemoryForgetRequest: 1 };
      if (!handled[msg.type]) return;
      if (!isAppSender(sender)) { sendResponse({ ok: false, reason: 'untrusted-sender' }); return true; }
      var q = { practiceId: msg.practiceId, provider: msg.provider, action: msg.action, sectionLabel: msg.sectionLabel };
      var p;
      if (msg.type === 'mlsTeachMemoryRecallRequest') p = recall(q);
      else if (msg.type === 'mlsTeachMemoryDryRunRequest') p = dryRun(q);
      else if (msg.type === 'mlsTeachMemoryListRequest') p = listEntries().then(function (entries) { return { ok: true, entries: entries }; });
      else p = forget(entryKey(q));
      p.then(function (resp) { try { sendResponse(resp); } catch (e) {} })
        .catch(function (e) { try { sendResponse({ ok: false, reason: 'memory-error', error: String((e && e.message) || e).slice(0, 200) }); } catch (e2) {} });
      return true;
    });
    return true;
  }

  root.MLSTeachMemory = {
    version: VERSION,
    STORE_KEY: STORE_KEY,
    entryKey: entryKey,
    layoutHashFor: layoutHashFor,
    buildEntry: buildEntry,
    saveCaptured: saveCaptured,
    recall: recall,
    dryRun: dryRun,
    markStale: markStale,
    markVerified: markVerified,
    forget: forget,
    listEntries: listEntries,
    practiceIdFromUrl: practiceIdFromUrl,
    mlsTeachDryRunLocatorFn: mlsTeachDryRunLocatorFn,
    _wireMessages: wireMessages
  };

  /* Arm SW message handlers only where chrome.runtime exists (service worker /
     extension pages). Content-script loads keep the pure API without wiring. */
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage &&
        typeof window === 'undefined') { // service worker only
      wireMessages();
    }
  } catch (eWire) {}
})(typeof globalThis !== 'undefined' ? globalThis : this);
