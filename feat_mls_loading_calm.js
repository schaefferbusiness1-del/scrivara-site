/* =============================================================================
 * __mlsLoadingCalm  lb-1.0.0   (2026-07-13, owner requirement: polished,
 * easy-to-follow loading states everywhere - calm and premium, not flashy)
 * -----------------------------------------------------------------------------
 * ONE loading vocabulary for the whole app:
 *  1. A slim deep-green working bar pinned under the top bar. It appears
 *     whenever a backend call (/api/...) is in flight - window.fetch is
 *     wrapped additively to count in-flight requests - or when any module
 *     calls window.__mlsLoadingCalm.begin()/end(). Indeterminate sweep,
 *     280ms appear-delay so quick calls never flash it.
 *  2. `.mls-skel` - a reusable calm skeleton shimmer any module can put on
 *     placeholder blocks while content hydrates.
 * Fail-safe: a begin() without end() self-clears after 90s; the fetch wrap
 * preserves the original promise semantics exactly (count is decremented in
 * finally). Zero observers. Reversible: window.__mlsLoadingCalm.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__mlsLoadingCalm) return;
  var api = { version: 'lb-1.1.0', installed: true, inflight: 0 };
  window.__mlsLoadingCalm = api;

  var BAR_ID = 'mlsLbBar', CSS_ID = 'mlsLbCss';
  var showT = null, hideT = null, manual = 0, manualTimers = [];

  function css() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      '#' + BAR_ID + '{position:fixed;top:0;left:0;right:0;height:2.5px;z-index:2147483200;pointer-events:none;',
      '  opacity:0;transition:opacity .25s ease;background:transparent;overflow:hidden;}',
      '#' + BAR_ID + '.on{opacity:1;}',
      '#' + BAR_ID + ' .lb-sweep{position:absolute;top:0;bottom:0;left:-38%;width:38%;border-radius:3px;',
      '  background:linear-gradient(90deg,rgba(46,106,75,0),#2E6A4B 42%,#8FD8BE 88%,rgba(143,216,190,0));',
      '  animation:mlsLbSweep 1.35s cubic-bezier(.4,.1,.4,.9) infinite;}',
      '@keyframes mlsLbSweep{0%{left:-38%;}100%{left:100%;}}',
      /* reusable calm skeleton */
      '.mls-skel{position:relative;overflow:hidden;background:#F2F0E9 !important;border-radius:10px;color:transparent !important;min-height:14px;}',
      '.mls-skel::after{content:"";position:absolute;inset:0;transform:translateX(-100%);',
      '  background:linear-gradient(90deg,transparent,rgba(255,255,255,.65),transparent);',
      '  animation:mlsSkel 1.4s ease infinite;}',
      '@keyframes mlsSkel{100%{transform:translateX(100%);}}',
      '@media (prefers-reduced-motion:reduce){#' + BAR_ID + ' .lb-sweep,.mls-skel::after{animation-duration:2.8s;}}',
      /* lb-1.1.0: labeled busy pill - a VISIBLE indicator for every long op,
         including extension-driven Athena pulls that never touch fetch()
         (owner: pulls only showed quiet gray text, easy to miss entirely). */
      '#mlsBusyPill{position:fixed;right:16px;bottom:16px;z-index:99970;display:flex;align-items:center;gap:9px;',
      'background:#fff;border:1px solid #E7E5DD;border-radius:999px;padding:9px 16px;max-width:420px;',
      'box-shadow:0 1px 2px rgba(20,33,28,.06),0 12px 32px rgba(20,33,28,.14);',
      'font:600 12.5px "Public Sans",system-ui,sans-serif;color:#1A211C;',
      'opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .18s ease,transform .18s ease;}',
      '#mlsBusyPill.on{opacity:1;transform:none;}',
      '#mlsBusyPill .bp-spin{width:14px;height:14px;border:2px solid #D8E5DE;border-top-color:#2E6A4B;border-radius:50%;flex:none;animation:mlsBpSpin .8s linear infinite;}',
      '@keyframes mlsBpSpin{to{transform:rotate(360deg)}}',
      '#mlsBusyPill .bp-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '@media (prefers-reduced-motion:reduce){#mlsBusyPill .bp-spin{animation-duration:2s;}#mlsBusyPill{transition:none;}}',
      '@media (max-width:760px){#mlsBusyPill{right:10px;bottom:74px;max-width:78vw;}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }
  function bar() {
    var b = document.getElementById(BAR_ID);
    if (b) return b;
    css();
    b = document.createElement('div');
    b.id = BAR_ID;
    b.innerHTML = '<span class="lb-sweep"></span>';
    (document.body || document.documentElement).appendChild(b);
    return b;
  }
  /* ---- lb-1.1.0 busy pill ---- */
  var pillLabel = '', extHideT = null, extBusy = false;
  function pill() {
    var p = document.getElementById('mlsBusyPill');
    if (p) return p;
    css();
    p = document.createElement('div');
    p.id = 'mlsBusyPill';
    p.innerHTML = '<span class="bp-spin"></span><span class="bp-txt">Working…</span>';
    (document.body || document.documentElement).appendChild(p);
    return p;
  }
  function pillSync(busy) {
    var p = pill();
    var on = busy || extBusy;
    if (on) {
      var t = p.querySelector('.bp-txt');
      if (t) t.textContent = pillLabel || 'Working…';
      p.classList.add('on');
    } else {
      p.classList.remove('on');
      pillLabel = '';
    }
  }
  /* extension-driven pulls/writes never touch fetch() - their progress arrives as
     window messages from mls-ext. Any message with progress text lights the pill
     and it fades 3.5s after the stream goes quiet. Listener only - nothing sent. */
  try {
    window.addEventListener('message', function (e) {
      try {
        var d = e && e.data;
        if (!d || d.source !== 'mls-ext') return;
        var m = d.msg || d.status || '';
        if (!m && !/progress|status/i.test(String(d.type || ''))) return;
        extBusy = true;
        if (m) pillLabel = String(m).slice(0, 90);
        pillSync((api.inflight + manual) > 0);
        if (extHideT) clearTimeout(extHideT);
        extHideT = setTimeout(function () { extBusy = false; pillSync((api.inflight + manual) > 0); }, 3500);
      } catch (e2) {}
    });
  } catch (e) {}
  function sync() {
    var busy = (api.inflight + manual) > 0;
    if (busy) {
      if (hideT) { clearTimeout(hideT); hideT = null; }
      if (!showT && !bar().classList.contains('on')) {
        showT = setTimeout(function () { showT = null; if ((api.inflight + manual) > 0) { bar().classList.add('on'); pillSync(true); } }, 280);
      }
    } else {
      if (showT) { clearTimeout(showT); showT = null; }
      if (!hideT) hideT = setTimeout(function () { hideT = null; var b = document.getElementById(BAR_ID); if (b) b.classList.remove('on'); pillSync(false); }, 200);
    }
  }

  /* additive fetch wrap: only backend calls drive the bar. Other modules also
     wrap fetch and can bury this layer - re-assert by chain-wrapping whatever
     currently occupies window.fetch (their behavior is preserved untouched). */
  function isTracked(input) {
    try {
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      return /\/api\//.test(u) || /onrender\.com/.test(u);
    } catch (e) { return false; }
  }
  function ensureWrap() {
    var f = window.fetch;
    if (typeof f !== 'function' || f.__mlsLb) return;
    var wrapped = function (input, init) {
      var track = isTracked(input);
      if (track) { api.inflight++; sync(); }
      var p = f.apply(this, arguments);
      if (track && p && typeof p.finally === 'function') {
        p = p.finally(function () { api.inflight = Math.max(0, api.inflight - 1); sync(); });
      } else if (track) {
        api.inflight = Math.max(0, api.inflight - 1); sync();
      }
      return p;
    };
    wrapped.__mlsLb = true;
    wrapped.__mlsLbOrig = f;
    window.fetch = wrapped;
  }
  ensureWrap();
  var wrapIv = setInterval(ensureWrap, 2000);

  api.begin = function (label) {
    manual++;
    if (label) pillLabel = String(label).slice(0, 90);
    var t = setTimeout(function () { manual = Math.max(0, manual - 1); sync(); }, 90000);
    manualTimers.push(t);
    sync();
  };
  api.end = function () { manual = Math.max(0, manual - 1); sync(); };

  css();

  api.revert = function () {
    try { clearInterval(wrapIv); if (window.fetch && window.fetch.__mlsLb) window.fetch = window.fetch.__mlsLbOrig; } catch (e) {}
    try { manualTimers.forEach(clearTimeout); } catch (e) {}
    try { var b = document.getElementById(BAR_ID); if (b) b.remove(); } catch (e) {}
    try { if (extHideT) clearTimeout(extHideT); var pp = document.getElementById('mlsBusyPill'); if (pp) pp.remove(); } catch (e) {}
    try { var s = document.getElementById(CSS_ID); if (s) s.remove(); } catch (e) {}
    api.installed = false; delete window.__mlsLoadingCalm;
  };
})();
