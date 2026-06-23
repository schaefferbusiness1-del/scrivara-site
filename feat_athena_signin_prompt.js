/* feat_athena_signin_prompt.js  ->  window.__mlsAthenaSignInPrompt  (v1.1.0)
 *
 * APP-SIDE disconnected-state honesty + "open athenaOne, please sign in" flow.
 *
 * PART 1 - OPEN + PROMPT ON THE USER'S CLICK
 *   When the user triggers an athenaOne-requiring action (a day/week pull, the
 *   "pull the open patient" pull, or "find a patient by name & pull") while
 *   athenaOne is genuinely DISCONNECTED, MLS no longer fails silently. Instead,
 *   ON THE USER'S OWN CLICK it:
 *     (1) opens an athenaOne tab (window.open to the athenaOne login URL), and
 *     (2) shows a clear, honest prompt: "Opening athenaOne - please sign in,
 *         then come back and try again."
 *   Because window.open runs synchronously inside the real user click, the tab
 *   is NOT popup-blocked. Once the user signs in (a real signed-in athenaOne tab
 *   exists), __mlsConnTruth flips to connected on its next probe and the normal
 *   pull flow resumes untouched - this asset then does nothing.
 *
 * PART 2 - KILL THE FABRICATED "FIXED IT / READ THE SCHEDULE" RECOVERY LIE
 *   When NO real signed-in athenaOne tab exists, the self-troubleshoot/recovery
 *   narration (feat_athena_selfheal.js + feat_athena_narration.js) has been
 *   claiming it "Read the schedule page", "found no appointments", and even
 *   "Fixed it - athenaOne is responding again" - implying a real read/connection
 *   that does not exist (a phantom-positive from a weaker internal health check).
 *   This module gates those user-facing lines on __mlsConnTruth at RENDER TIME:
 *   both recovery modules surface text through two shared sinks -
 *   window.__mlsAthenaActions._step and window.__mlsUxUnify.mirror - so we wrap
 *   BOTH. When __mlsConnTruth reports a genuine disconnect AND a line asserts a
 *   real read/connection ("read the schedule", "found no appointments",
 *   "fixed it", "responding again"), the line is replaced with the honest
 *   "No signed-in athenaOne tab detected - opening athenaOne. Please sign in..."
 *   and the Part-1 open/prompt is (re)triggered. When __mlsConnTruth ACTUALLY
 *   confirms a connected, readable tab, every line passes through untouched - so
 *   a genuine "Fixed it" still shows on a real recovery. (Same shared-chokepoint
 *   pattern as the deployed fabricated-counter guard.)
 *
 * PART 2b - SCRUB ALREADY-RENDERED FAB LINES
 *   This asset is the LAST loader, so a recovery/health-check line emitted
 *   during page load can render through the unified status mirror BEFORE the
 *   sink wrap installs. When __mlsConnTruth resolves to a genuine disconnect we
 *   therefore also SCRUB any already-rendered fabricated status text (inside the
 *   mlsux-/mlsaa- status surfaces only) to the honest line - so even the
 *   first-paint state is honest. Gated on __mlsConnTruth; connected = no scrub.
 *
 * SINGLE SOURCE OF TRUTH (strict gate)
 *   The ONLY thing that decides "disconnected" is window.__mlsConnTruth, the
 *   deployed Connection-Truth utility. This asset reads __mlsConnTruth.state /
 *   isConnected() SYNCHRONOUSLY at click time (window.open must be inside the
 *   gesture). It fires ONLY for an explicit disconnected status
 *   ('no-extension' | 'no-tab' | 'error'). It NEVER fires when connected, and
 *   NEVER fires while the probe is still 'checking' (unknown != disconnected),
 *   and NEVER fires if __mlsConnTruth is absent - so it cannot open a spurious
 *   tab when athenaOne is actually connected.
 *
 * DEBOUNCE
 *   Repeat clicks do NOT open a second tab: a recently-opened athenaOne tab
 *   reference is reused (focused) within a debounce window; otherwise a new tab
 *   is opened. The prompt is re-shown but not duplicated.
 *
 * SAFETY
 *   Purely additive. Sends NOTHING to the extension. Never clicks Save/Sign/
 *   attest/submit; never writes a chart; reads no PHI. Does not preventDefault
 *   or stop the existing handlers - it only ADDS the open-tab + prompt on top of
 *   a genuine disconnect (where the existing pull handlers already bail safely).
 *   ASCII-only. Every external call wrapped in try/catch. Worst case it no-ops.
 *   window.__mlsAthenaSignInPrompt.revert() removes the listener, the prompt,
 *   timers and styles; installed=false.
 */
(function () {
  'use strict';
  try {
    if (window.__mlsAthenaSignInPrompt && window.__mlsAthenaSignInPrompt.installed) return;
  } catch (e) {}

  var VERSION = '1.2.0';
  var ASSET = 'feat_athena_signin_prompt.js';

  // The standard athenaOne login URL. The extension/app identifies athenaOne by
  // host (athenahealth.com / athenanet.athenahealth.com / one.athenahealth.com);
  // we deliberately do NOT read the live tab URL (it could carry PHI/dept ids),
  // so we open the standard login entry point. An optional override is honored
  // ONLY if it is an https athenahealth.com host.
  var DEFAULT_ATHENA_URL = 'https://athenanet.athenahealth.com/';
  function athenaUrl() {
    try {
      var o = window.__mlsAthenaLoginUrl;
      if (typeof o === 'string' && /^https:\/\/([a-z0-9-]+\.)*athenahealth\.com\//i.test(o)) return o;
    } catch (e) {}
    return DEFAULT_ATHENA_URL;
  }

  // Athena-requiring triggers. The four centerpiece pull buttons live in
  // .mlscp-pulls; #ezPull is the stock pull button; the data-attribute lets
  // future pull entry points opt in explicitly.
  var TRIGGER_SEL = '.mlscp-pulls button, #ezPull, [data-mls-athena-trigger]';

  var DEBOUNCE_MS = 20000;   // reuse a freshly-opened athena tab within this window
  var PROMPT_MS = 15000;     // auto-dismiss the prompt after this (it is non-modal)

  var S = {
    winRef: null,            // last opened athenaOne window handle
    lastOpenAt: 0,
    reverted: false,
    unsub: null,
    promptTimer: null
  };
  var _timers = [];
  function later(fn, ms) { var t = setTimeout(function () { try { fn(); } catch (e) {} }, ms || 0); _timers.push(t); return t; }

  // ---- the strict gate: read the single source of truth, synchronously ----
  function connTruth() {
    try { return window.__mlsConnTruth || null; } catch (e) { return null; }
  }
  // Returns the disconnected status string ('no-extension'|'no-tab'|'error') if
  // and only if __mlsConnTruth exists and reports a GENUINE disconnect.
  // Returns null otherwise (connected, checking, or truth-source absent).
  function disconnectStatus() {
    var ct = connTruth();
    if (!ct) return null;                       // no source of truth -> do nothing
    try { if (typeof ct.isConnected === 'function' && ct.isConnected()) return null; } catch (e) {}
    var st = '';
    try { st = (ct.state && ct.state.status) || ''; } catch (e) {}
    if (st === 'no-extension' || st === 'no-tab' || st === 'error') return st;
    return null;                                // 'checking'/'connected'/unknown -> do nothing
  }
  function honestDetail() {
    var ct = connTruth();
    try {
      if (ct && typeof ct.describe === 'function') {
        var d = ct.describe();
        return (d && (d.detail || d.label)) || '';
      }
    } catch (e) {}
    return '';
  }

  // ---- the prompt (non-modal, honest, dismissible) ----
  var STYLE_ID = 'mlsSignInPromptStyle';
  function injectStyle() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      var st = document.createElement('style'); st.id = STYLE_ID;
      st.textContent = [
        '#mlsSignInPrompt{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);',
        'z-index:2147483646;max-width:440px;width:calc(100% - 32px);box-sizing:border-box;',
        'background:#0f2440;color:#fff;border:1px solid rgba(255,255,255,.30);border-radius:12px;',
        'box-shadow:0 10px 30px rgba(0,0,0,.35);padding:14px 16px;font-size:14px;line-height:1.4;',
        'font-family:inherit;}',
        '#mlsSignInPrompt .mlssip-h{font-weight:700;display:flex;align-items:center;gap:8px;margin:0 0 4px;}',
        '#mlsSignInPrompt .mlssip-sub{font-size:12.5px;opacity:.9;margin:0;}',
        '#mlsSignInPrompt .mlssip-detail{font-size:11.5px;opacity:.75;margin:6px 0 0;}',
        '#mlsSignInPrompt .mlssip-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}',
        '#mlsSignInPrompt button{cursor:pointer;border-radius:8px;font-size:12.5px;font-weight:600;',
        'padding:7px 12px;border:1px solid rgba(255,255,255,.30);background:rgba(255,255,255,.16);color:#fff;}',
        '#mlsSignInPrompt button.mlssip-primary{background:#2f6df0;border-color:#2f6df0;}',
        '#mlsSignInPrompt .mlssip-x{position:absolute;top:8px;right:10px;background:none;border:none;',
        'color:#fff;opacity:.7;font-size:16px;padding:2px 6px;}'
      ].join('');
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }

  function dismissPrompt() {
    try { var el = document.getElementById('mlsSignInPrompt'); if (el) el.remove(); } catch (e) {}
    if (S.promptTimer) { try { clearTimeout(S.promptTimer); } catch (e) {} S.promptTimer = null; }
  }

  function showPrompt(connected) {
    try {
      injectStyle();
      dismissPrompt();
      var wrap = document.createElement('div');
      wrap.id = 'mlsSignInPrompt';
      wrap.setAttribute('role', 'status');
      wrap.setAttribute('aria-live', 'polite');
      if (connected) {
        wrap.innerHTML =
          '<button type="button" class="mlssip-x" aria-label="Dismiss">&times;</button>' +
          '<div class="mlssip-h">athenaOne connected</div>' +
          '<p class="mlssip-sub">You are signed in. Go ahead and start your pull.</p>';
      } else {
        var detail = honestDetail();
        wrap.innerHTML =
          '<button type="button" class="mlssip-x" aria-label="Dismiss">&times;</button>' +
          '<div class="mlssip-h">Opening athenaOne</div>' +
          '<p class="mlssip-sub">Please sign in to athenaOne in the new tab, then come back here and try again.</p>' +
          (detail ? '<p class="mlssip-detail">' + escHtml(detail) + '</p>' : '') +
          '<div class="mlssip-row">' +
            '<button type="button" class="mlssip-primary" id="mlssipReopen">Reopen athenaOne</button>' +
          '</div>';
      }
      document.body.appendChild(wrap);
      var x = wrap.querySelector('.mlssip-x');
      if (x) x.addEventListener('click', function () { dismissPrompt(); });
      var re = wrap.querySelector('#mlssipReopen');
      if (re) re.addEventListener('click', function () { openAthena(true); });
      if (S.promptTimer) { try { clearTimeout(S.promptTimer); } catch (e) {} }
      S.promptTimer = later(dismissPrompt, PROMPT_MS);
    } catch (e) {}
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- open the athenaOne tab (debounced; reuse a fresh handle) ----
  // Must be called SYNCHRONOUSLY from within the user-gesture click handler so
  // the popup is not blocked. force (Reopen button) bypasses debounce.
  function openAthena(force) {
    var now = Date.now();
    var fresh = !force && S.winRef && (now - S.lastOpenAt) < DEBOUNCE_MS;
    if (fresh) {
      var alive = false;
      try { alive = !S.winRef.closed; } catch (e) { alive = true; } // cross-origin: assume alive
      if (alive) {
        try { S.winRef.focus(); } catch (e) {}
        return S.winRef;
      }
    }
    var w = null;
    try { w = window.open(athenaUrl(), 'mlsAthenaSignIn'); } catch (e) { w = null; }
    if (w) { S.winRef = w; S.lastOpenAt = now; try { w.focus(); } catch (e) {} }
    return w;
  }

  // ---- the click interceptor (capture phase, additive, no preventDefault) ----
  function isTrigger(target) {
    try {
      if (!target || !target.closest) return false;
      return target.closest(TRIGGER_SEL);
    } catch (e) { return false; }
  }

  function onClick(ev) {
    try {
      if (S.reverted) return;
      if (!ev || ev.button != null && ev.button !== 0) return; // primary clicks only
      var trig = isTrigger(ev.target);
      if (!trig) return;
      // STRICT GATE: only act on a genuine disconnect per the single source of truth.
      var st = disconnectStatus();
      if (!st) return; // connected, checking, or no truth-source -> do nothing (normal flow)
      // Open athenaOne on THIS user click (sync -> not popup-blocked) + prompt.
      openAthena(false);
      showPrompt(false);
    } catch (e) {}
  }

  // ============================================================
  //  PART 2 -- truth-gated recovery-narration filter
  //  Rewrites fabricated "read/fixed/responding" lines to an honest line when
  //  __mlsConnTruth reports a genuine disconnect. Wraps the two shared sinks
  //  used by feat_athena_selfheal.js and feat_athena_narration.js.
  // ============================================================
  // Only these claims imply a real READ or a real CONNECTION. Honest process
  // lines ("Checking that MLS Assist is awake", "Trying to fix this myself")
  // are intentionally NOT matched - they remain visible.
  var FAB_RE = /(read the schedule|found no appointments|fixed it|responding again|athena ?one is responding)/i;
  var HONEST_LINE = 'No signed-in athenaOne tab detected - opening athenaOne. Please sign in, then come back and try again.';

  function isFabClaim(text) { try { return FAB_RE.test(String(text == null ? '' : text)); } catch (e) { return false; } }
  // Decide AT RENDER TIME by reading the single source of truth.
  function shouldRewrite(text) { return !!disconnectStatus() && isFabClaim(text); }

  var _lastRecoverOpen = 0;
  function recoverOpenOnce() {
    var now = Date.now();
    if (now - _lastRecoverOpen < DEBOUNCE_MS) return;
    _lastRecoverOpen = now;
    // Best-effort: Part 1 has usually ALREADY opened the tab on the user's
    // click that started this action; this async recovery path may be
    // popup-blocked, which is fine - the honest line still renders.
    try { openAthena(false); } catch (e) {}
    try { showPrompt(false); } catch (e) {}
  }

  var _wraps = []; // {obj, method, orig}
  function wrapSink(obj, method, argIndex) {
    try {
      if (!obj || typeof obj[method] !== 'function') return false;
      if (obj[method].__mlsSipWrapped) return true;
      var orig = obj[method];
      var wrapped = function () {
        try {
          if (!S.reverted) {
            var text = arguments[argIndex];
            if (shouldRewrite(text)) {
              var newArgs = Array.prototype.slice.call(arguments);
              newArgs[argIndex] = HONEST_LINE;
              if (method === '_step' && newArgs.length > argIndex + 1) newArgs[argIndex + 1] = 'warn';
              recoverOpenOnce();
              return orig.apply(this, newArgs);
            }
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      wrapped.__mlsSipWrapped = true;
      wrapped.__mlsSipOrig = orig;
      obj[method] = wrapped;
      _wraps.push({ obj: obj, method: method, orig: orig });
      return true;
    } catch (e) { return false; }
  }

  function wrapSinks() {
    var aDone = false, uDone = false;
    try { var aa = window.__mlsAthenaActions; if (aa) aDone = wrapSink(aa, '_step', 0); } catch (e) {}
    try { var ux = window.__mlsUxUnify; if (ux) uDone = wrapSink(ux, 'mirror', 0); } catch (e) {}
    return aDone && uDone;
  }

  var _sinkPoll = null, _sinkTries = 0;
  function startSinkPoll() {
    if (wrapSinks()) { scrubExisting(); return; }   // both present already
    _sinkPoll = setInterval(function () {
      _sinkTries++;
      if (wrapSinks() || _sinkTries > 20) {   // ~30s ceiling
        scrubExisting();
        if (_sinkPoll) { clearInterval(_sinkPoll); _sinkPoll = null; }
      }
    }, 1500);
  }

  function unwrapSinks() {
    try { if (_sinkPoll) { clearInterval(_sinkPoll); _sinkPoll = null; } } catch (e) {}
    for (var i = 0; i < _wraps.length; i++) {
      var w = _wraps[i];
      try { if (w.obj && w.obj[w.method] && w.obj[w.method].__mlsSipWrapped) w.obj[w.method] = w.orig; } catch (e) {}
    }
    _wraps = [];
  }

  // Scrub any ALREADY-RENDERED fabricated status text (mlsux-/mlsaa- surfaces
  // only) to the honest line. Only runs on a genuine disconnect. This catches a
  // line that rendered during load before our sink wrap installed.
  function scrubExisting() {
    try {
      if (!disconnectStatus()) return false;
      var roots = document.querySelectorAll('[class*="mlsux"], [class*="mlsaa"]');
      var touched = false;
      for (var i = 0; i < roots.length; i++) {
        var nodes = roots[i].querySelectorAll('*');
        var list = [roots[i]];
        for (var j = 0; j < nodes.length; j++) list.push(nodes[j]);
        for (var k = 0; k < list.length; k++) {
          var el = list[k];
          if (el.children.length === 0 && FAB_RE.test(el.textContent || '')) {
            el.textContent = HONEST_LINE;
            touched = true;
          }
        }
      }
      if (touched) recoverOpenOnce();
      return touched;
    } catch (e) { return false; }
  }

  // When the source of truth flips to connected, replace the prompt with an
  // honest "you're signed in" note (only fired by the real probe).
  function onTruthChange(state) {
    try {
      if (S.reverted) return;
      if (state && state.status === 'connected') {
        if (document.getElementById('mlsSignInPrompt')) showPrompt(true);
      } else if (disconnectStatus()) {
        // a recovery/health-check line may have rendered pre-wrap during load;
        // scrub it now, and again shortly after in case narration emits late.
        scrubExisting();
        later(scrubExisting, 500);
        later(scrubExisting, 1500);
      }
    } catch (e) {}
  }

  function boot() {
    // The click interceptor only needs document (always present) - NOT the
    // body - so we attach immediately regardless of readyState. Subscribing to
    // the truth source likewise needs no DOM.
    try { document.addEventListener('click', onClick, true); } catch (e) {}
    try {
      var ct = connTruth();
      if (ct && typeof ct.subscribe === 'function') S.unsub = ct.subscribe(onTruthChange);
    } catch (e) {}
    // PART 2: wrap the shared narration sinks (retry until both exist).
    try { startSinkPoll(); } catch (e) {}
  }

  function revert() {
    S.reverted = true;
    try { document.removeEventListener('click', onClick, true); } catch (e) {}
    try { if (typeof S.unsub === 'function') S.unsub(); } catch (e) {}
    try { unwrapSinks(); } catch (e) {}
    try { _timers.forEach(function (t) { clearTimeout(t); }); } catch (e) {}
    dismissPrompt();
    try { var s = document.getElementById(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { window.__mlsAthenaSignInPrompt.installed = false; } catch (e) {}
  }

  window.__mlsAthenaSignInPrompt = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    // exposed for tests / advanced callers (no PHI):
    _disconnectStatus: disconnectStatus,
    _onClick: onClick,
    _openAthena: openAthena,
    _showPrompt: showPrompt,
    _athenaUrl: athenaUrl,
    // Part 2 (recovery-narration filter) hooks:
    _isFabClaim: isFabClaim,
    _shouldRewrite: shouldRewrite,
    _wrapSinks: wrapSinks,
    _scrubExisting: scrubExisting,
    _honestLine: HONEST_LINE,
    triggerSelector: TRIGGER_SEL,
    revert: revert
  };

  try { boot(); } catch (e) {}
})();
