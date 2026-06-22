/* =====================================================================
 * mls-fabrication-sentinel.js  (v1.0.0)
 * ---------------------------------------------------------------------
 * Runtime net that flags / neutralizes the fabricated-status signatures
 * the MLS audit catalogued:
 *   (1) an optimistic "N of M" / "reading visit N" progress counter that
 *       is present (or incrementing) while the REAL connection probe says
 *       disconnected  -> the §40/§50 "Reading visit N of 38 while logged
 *       out" bug;
 *   (2) a "connected / readable / running the search" claim while the real
 *       probe says not connected -> the §39/§2.1 "looks connected" bug;
 *   (3) a "running…/searching…" status that sits static past a threshold
 *       while disconnected -> the §39 240-second spinner that lied.
 *
 * It CROSS-CHECKS against window.__mlsConnTruth (the single source of
 * truth, Part 2B). It never invents a verdict: if __mlsConnTruth is
 * absent it records 'conn-truth-missing' and only observes.
 *
 * FLAG-GATED, OFF BY DEFAULT. Enable via:
 *   window.__MLS_SENTINEL = 'observe' | 'neutralize' | true
 *   localStorage['mlsFabricationSentinel'] = 'observe'|'neutralize'|'on'
 *   ?mlsSentinel=observe|neutralize  in the URL
 *
 * Additive, own-scope IIFE; idempotent; visibility-gated debounced
 * observer (0 idle churn); fully reversible via .revert(). PHI-safe:
 * stores only element signatures + counter numbers + matched keyword,
 * never surrounding patient text; never logs originals.
 * ===================================================================== */
(function () {
  'use strict';

  var NS = '__mlsFabricationSentinel';
  var VERSION = '1.0.0';

  if (typeof window !== 'undefined' && window[NS] && window[NS].installed) {
    return;
  }

  var win = window;
  var doc = (typeof document !== 'undefined') ? document : null;

  // ---------- config (tunable) ----------
  var config = {
    // Where status/progress text tends to live. Bounded so we never scan
    // the whole document text on every mutation.
    statusSelectors: [
      '[role="status"]', '[aria-live]',
      '[class*="status"]', '[class*="progress"]', '[class*="spinner"]',
      '.mls-cv-status', '[class*="mls"][class*="status"]',
      '[data-mls-status]'
    ],
    // Optimistic-counter patterns.
    counterPatterns: [
      { name: 'N of M', re: /\b(\d+)\s+of\s+(\d+)\b/i },
      { name: 'reading visit N', re: /\breading\s+visit\s+(\d+)/i },
      { name: 'visit N of M', re: /\bvisit\s+(\d+)\s+of\s+(\d+)/i },
      { name: 'reading N', re: /\breading\s+(\d+)\b/i }
    ],
    // Keyword that ties a counter to a real Athena read (so a generic
    // "3 of 5" in unrelated UI isn't misread). At least one must appear
    // near the counter for a 'fabricated-progress' verdict.
    progressContextRe: /\b(visit|athena|athenaone|encounter|reading|patient|chart)\b/i,
    // Connected/readable claims.
    connectedClaimRe: /(athena[a-z]*\s*connected|found\s+and\s+is\s+readable|signed[- ]?in\s+athenaone\s+tab\s+was\s+found|a\s+signed[- ]?in\s+athenaone\s+tab\s+is\s+readable|\bis\s+readable\b|running\s+the\s+search)/i,
    // Running/searching spinner text.
    runningRe: /\b(running|searching|working|loading|please\s+wait)\b[\s.…]*$/i,
    // Honest replacements used in neutralize mode.
    honestProgress: '🔍 Status unverified — not reading (athenaOne not confirmed connected)',
    honestConnected: '● athenaOne not confirmed connected',
    honestRunning: '⚠ No live progress — open a signed-in athenaOne tab and retry',
    staleRunningMs: 12000,   // a "running" with no change this long (disconnected) is stale
    pollMs: 5000,            // slow safety re-scan while visible
    debounceMs: 400,
    maxFindings: 200
  };

  // ---------- state ----------
  var mode = null;           // null = disabled; 'observe' | 'neutralize'
  var findings = [];         // ring buffer, newest first
  var subscribers = [];
  var observer = null;
  var pollTimer = null;
  var debTimer = null;
  var visHandler = null;
  var neutralized = [];      // {node, original} for revert
  var counterHistory = {};   // signature -> last max counter value
  var runningSince = {};     // signature -> {text, since}

  // ---------- helpers ----------
  function connVerdict() {
    try {
      var ct = win.__mlsConnTruth;
      if (!ct || typeof ct.isConnected !== 'function') return { known: false, status: 'unknown', connected: false };
      var st = ct.state && ct.state.status ? ct.state.status : 'unknown';
      return { known: true, status: st, connected: ct.isConnected() === true };
    } catch (e) { return { known: false, status: 'unknown', connected: false }; }
  }

  function signatureOf(el) {
    try {
      if (!el || !el.tagName) return 'unknown';
      var tag = el.tagName.toLowerCase();
      var cls = '';
      if (el.className && typeof el.className === 'string') {
        cls = el.className.trim().split(/\s+/).slice(0, 4).join('.');
      }
      return cls ? (tag + '.' + cls) : tag;
    } catch (e) { return 'unknown'; }
  }

  function record(f) {
    f.at = Date.now();
    findings.unshift(f);
    if (findings.length > config.maxFindings) findings.length = config.maxFindings;
    // PHI-free console signal.
    try {
      console.warn('[MLS Fabrication Sentinel] ' + f.kind + ' (' + f.pattern + ') @ ' +
        f.signature + ' — conn:' + f.connStatus + (f.neutralized ? ' [neutralized]' : ''));
    } catch (e) {}
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](f); } catch (e) {}
    }
  }

  // Find the text node within an element that carries the matched text,
  // so we rewrite the smallest thing and don't clobber siblings.
  function findTextNode(el, re) {
    try {
      if (!doc || !doc.createTreeWalker) {
        return null;
      }
      var walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */, null, false);
      var n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue && re.test(n.nodeValue)) return n;
      }
    } catch (e) {}
    return null;
  }

  function neutralize(el, re, honest, finding) {
    if (mode !== 'neutralize') return false;
    try {
      var tn = findTextNode(el, re);
      if (tn) {
        neutralized.push({ node: tn, original: tn.nodeValue, kind: 'text' });
        tn.nodeValue = honest;
      } else {
        // fallback: rewrite element's direct text content
        neutralized.push({ node: el, original: el.textContent, kind: 'el' });
        el.textContent = honest;
      }
      try { el.setAttribute('data-mls-sentinel', 'neutralized'); } catch (e) {}
      finding.neutralized = true;
      return true;
    } catch (e) { return false; }
  }

  function isVisibleEl(el) {
    try {
      if (!el || !el.getBoundingClientRect) return true; // jsdom: assume visible
      // Skip our own neutralized nodes to avoid re-flagging.
      if (el.getAttribute && el.getAttribute('data-mls-sentinel') === 'neutralized') return false;
      return true;
    } catch (e) { return true; }
  }

  // ---------- the scan ----------
  function scan() {
    var out = [];
    if (!doc || !mode) return out;
    var conn = connVerdict();
    var els = [];
    try {
      els = Array.prototype.slice.call(doc.querySelectorAll(config.statusSelectors.join(',')));
    } catch (e) { els = []; }

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!isVisibleEl(el)) continue;
      var text = '';
      try { text = (el.textContent || '').replace(/\s+/g, ' ').trim(); } catch (e) { continue; }
      if (!text) continue;
      var sig = signatureOf(el);

      // (A) counter detection
      var matched = null, nums = null;
      for (var c = 0; c < config.counterPatterns.length; c++) {
        var m = config.counterPatterns[c].re.exec(text);
        if (m) {
          matched = config.counterPatterns[c].name;
          nums = m.slice(1).map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); });
          break;
        }
      }
      if (matched && config.progressContextRe.test(text)) {
        // Did it increment since last scan? (incrementing while disconnected = strong)
        var curMax = nums && nums.length ? Math.max.apply(null, nums) : 0;
        var prev = counterHistory[sig];
        var incremented = (typeof prev === 'number' && curMax > prev);
        counterHistory[sig] = curMax;

        if (conn.known && !conn.connected) {
          var f = {
            kind: 'fabricated-progress', pattern: matched, signature: sig,
            numbers: nums, connStatus: conn.status, incremented: incremented, neutralized: false
          };
          neutralize(el, config.counterPatterns.reduce(function (acc, p) { return acc || (p.name === matched ? p.re : null); }, null) || /\d+\s+of\s+\d+/i, config.honestProgress, f);
          record(f); out.push(f);
          continue;
        } else if (!conn.known) {
          var f2 = { kind: 'unverified-progress', pattern: matched, signature: sig, numbers: nums, connStatus: 'conn-truth-missing', neutralized: false };
          record(f2); out.push(f2);
          continue;
        } else {
          // connected: low-confidence, observe only (might be real)
          var f3 = { kind: 'unverified-progress', pattern: matched, signature: sig, numbers: nums, connStatus: conn.status, neutralized: false };
          // do not neutralize a possibly-real counter
          record(f3); out.push(f3);
          continue;
        }
      }

      // (B) false-connected claim
      if (config.connectedClaimRe.test(text)) {
        if (conn.known && !conn.connected) {
          var fc = { kind: 'false-connected', pattern: 'connected-claim', signature: sig, numbers: null, connStatus: conn.status, neutralized: false };
          neutralize(el, config.connectedClaimRe, config.honestConnected, fc);
          record(fc); out.push(fc);
          continue;
        }
      }

      // (C) stale running spinner
      if (config.runningRe.test(text)) {
        var rs = runningSince[sig];
        var now = Date.now();
        if (!rs || rs.text !== text) {
          runningSince[sig] = { text: text, since: now };
        } else if (conn.known && !conn.connected && (now - rs.since) >= config.staleRunningMs) {
          var fr = { kind: 'stale-running', pattern: 'running', signature: sig, numbers: null, connStatus: conn.status, neutralized: false };
          neutralize(el, config.runningRe, config.honestRunning, fr);
          record(fr); out.push(fr);
          runningSince[sig] = { text: config.honestRunning, since: now };
          continue;
        }
      } else {
        if (runningSince[sig]) delete runningSince[sig];
      }
    }
    return out;
  }

  // ---------- observer / lifecycle ----------
  function visible() {
    try { return !doc || doc.visibilityState !== 'hidden'; } catch (e) { return true; }
  }
  function scheduleScan() {
    if (debTimer) return;
    debTimer = setTimeout(function () { debTimer = null; if (visible()) scan(); }, config.debounceMs);
  }
  function startObserving() {
    if (observer || !doc || !doc.body) return;
    try {
      observer = new (win.MutationObserver || function () { this.observe = function () {}; this.disconnect = function () {}; })(function () { scheduleScan(); });
      observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
    } catch (e) { observer = null; }
    if (!pollTimer) pollTimer = setInterval(function () { if (visible()) scan(); }, config.pollMs);
    if (!visHandler && doc.addEventListener) {
      visHandler = function () { if (visible()) scan(); };
      doc.addEventListener('visibilitychange', visHandler, false);
    }
  }
  function stopObserving() {
    if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (debTimer) { clearTimeout(debTimer); debTimer = null; }
    if (visHandler && doc && doc.removeEventListener) { try { doc.removeEventListener('visibilitychange', visHandler, false); } catch (e) {} visHandler = null; }
  }

  function enable(m) {
    mode = (m === 'neutralize') ? 'neutralize' : 'observe';
    win[NS].mode = mode;
    startObserving();
    scan();
    return win[NS];
  }
  function disable() {
    mode = null;
    win[NS].mode = null;
    stopObserving();
    return win[NS];
  }
  function onFinding(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    return function () { var i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); };
  }
  function revert() {
    disable();
    for (var i = 0; i < neutralized.length; i++) {
      try {
        var rec = neutralized[i];
        if (rec.kind === 'text') rec.node.nodeValue = rec.original;
        else rec.node.textContent = rec.original;
        if (rec.node.removeAttribute) { /* node is text; skip */ }
      } catch (e) {}
    }
    neutralized = [];
    findings = [];
    subscribers = [];
    counterHistory = {};
    runningSince = {};
    if (win[NS]) win[NS].installed = false;
  }

  // Read the gating flag.
  function resolveFlag() {
    try {
      if (win.__MLS_SENTINEL === 'neutralize' || win.__MLS_SENTINEL === 'observe') return win.__MLS_SENTINEL;
      if (win.__MLS_SENTINEL === true) return 'observe';
    } catch (e) {}
    try {
      var ls = win.localStorage && win.localStorage.getItem('mlsFabricationSentinel');
      if (ls === 'neutralize' || ls === 'observe') return ls;
      if (ls === 'on') return 'observe';
    } catch (e) {}
    try {
      if (win.location && /[?&]mlsSentinel=(neutralize|observe)/.test(win.location.search)) {
        return RegExp.$1;
      }
    } catch (e) {}
    return null;
  }

  // ---------- publish ----------
  win[NS] = {
    installed: true,
    version: VERSION,
    mode: null,
    config: config,
    findings: findings,
    scan: scan,
    enable: enable,
    disable: disable,
    onFinding: onFinding,
    revert: revert,
    _connVerdict: connVerdict,
    _signatureOf: signatureOf
  };
  // keep .findings pointing at the live buffer
  Object.defineProperty(win[NS], 'findings', { get: function () { return findings; }, enumerable: true });

  // Auto-enable only if a flag is set (default OFF).
  try {
    var flag = resolveFlag();
    if (flag) enable(flag);
  } catch (e) { /* never throw out of boot */ }

})();
