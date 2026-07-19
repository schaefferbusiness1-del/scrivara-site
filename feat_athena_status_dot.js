/* feat_athena_status_dot.js — PHI-free Athena readiness indicator (v1.1.0)
 *
 * Adds a small fixed dot in the TOP-RIGHT corner of MLS that honestly reflects, in
 * real time, whether MLS Assist is ready and an Athena tab is present:
 *   GREEN = the extension worker is responding and a non-discarded Athena tab exists.
 *   RED   = MLS Assist is unavailable, or no usable Athena tab is open.
 *   GREY  = first check still in flight (only momentarily, right after load, or while
 *           the MLS tab has never been brought to the foreground).
 *
 * It uses mlsPing plus mlsExtHealth operational metadata. It never requests a schedule,
 * reads a chart, focuses Athena, or receives patient data. A green dot means "ready",
 * not that a patient or encounter has been verified.
 *
 * Lightweight + idempotent: one probe at a time (in-flight guard); it polls only while
 * this tab is visible (so it never touches the athenaOne tab while MLS is in the
 * background), re-checks immediately on focus, and updates the dot ONLY when the status
 * actually changes (no render loop, no jitter -- per the ctxbar idempotent lesson).
 *
 * The native title attribute is stripped by the app, so the tooltip is a self-contained
 * hover label (plus aria-label for assistive tech).
 *
 * Self-contained, additive, reversible: window.__mlsAthenaStatusDot.revert().
 */
(function () {
  'use strict';
  if (window.__mlsAthenaStatusDot && window.__mlsAthenaStatusDot.installed) return;

  var VERSION = '1.1.0';
  var POLL_MS = 30000;
  var PING_MS = 1500;
  var HEALTH_MS = 4000;

  var COLORS = { connected: '#2E6A4B', red: '#dc2626', checking: '#9aa0a6' };

  function ensureStyle() {
    if (document.getElementById('mlsAthenaStatusDotStyle')) return;
    var st = document.createElement('style');
    st.id = 'mlsAthenaStatusDotStyle';
    st.textContent =
      '#mlsAthenaStatusDot{position:fixed;top:8px;right:10px;z-index:2147483601;width:12px;height:12px;' +
      'border-radius:50%;background:' + COLORS.checking + ';box-shadow:0 0 0 2px rgba(255,255,255,.92),0 1px 5px rgba(0,0,0,.5);' +
      'cursor:default;pointer-events:auto;transition:background .2s ease;}' +
      '#mlsAthenaStatusDot .mlsDotTip{position:absolute;top:19px;right:0;white-space:nowrap;background:#1E2B24;color:#fff;' +
      'padding:5px 9px;border-radius:7px;font:12px/1.3 system-ui,-apple-system,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35);' +
      'opacity:0;visibility:hidden;transition:opacity .12s ease;pointer-events:none;}' +
      '#mlsAthenaStatusDot:hover .mlsDotTip{opacity:1;visibility:visible;}';
    (document.head || document.documentElement).appendChild(st);
  }

  var dot = null, tip = null;
  function ensureDot() {
    ensureStyle();
    if (dot && document.body && document.body.contains(dot)) return dot;
    dot = document.createElement('div');
    dot.id = 'mlsAthenaStatusDot';
    dot.setAttribute('role', 'status');
    dot.setAttribute('aria-live', 'polite');
    tip = document.createElement('span');
    tip.className = 'mlsDotTip';
    dot.appendChild(tip);
    (document.body || document.documentElement).appendChild(dot);
    return dot;
  }

  var lastState = null;
  function render(state) {
    if (state === lastState) return;
    lastState = state;
    var d = ensureDot();
    var color, label;
    if (state === 'connected') { color = COLORS.connected; label = 'MLS Assist ready · Athena tab detected · patient not yet verified'; }
    else if (state === 'noext') { color = COLORS.red; label = 'MLS Assist not detected · Athena was not checked'; }
    else if (state === 'noathena') { color = COLORS.red; label = 'MLS Assist ready · open an Athena tab when you need it'; }
    else { color = COLORS.checking; label = 'Checking MLS Assist readiness...'; }
    d.style.background = color;
    if (tip) tip.textContent = label;
    d.setAttribute('aria-label', label);
  }

  function pingExtension() {
    try {
      var cv = window.__mlsCopyVisits;
      if (cv && typeof cv._ping === 'function') {
        return Promise.resolve(cv._ping(PING_MS)).then(function (v) { return !!v; }).catch(function () { return false; });
      }
    } catch (e) {}
    return new Promise(function (resolve) {
      var done = false, timer = null;
      function finish(value) {
        if (done) return;
        done = true;
        if (timer != null) { try { clearTimeout(timer); } catch (e) {} }
        window.removeEventListener('message', on);
        resolve(value);
      }
      function on(ev) {
        if (ev.data && ev.data.type === 'mlsPong') finish(true);
      }
      window.addEventListener('message', on);
      timer = setTimeout(function () { finish(false); }, PING_MS);
      try { window.postMessage({ type: 'mlsPing', source: 'mls-app', from: 'mls-app' }, '*'); } catch (e) {}
    });
  }

  function probeAthenaOpen() {
    return new Promise(function (resolve) {
      var done = false, timer = null;
      var requestId = 'mlsdot_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      function finish(value) {
        if (done) return;
        done = true;
        if (timer != null) { try { clearTimeout(timer); } catch (e) {} }
        window.removeEventListener('message', on);
        resolve(value);
      }
      function on(ev) {
        if (done) return;
        var d = ev.data;
        if (d && d.source === 'mls-ext' && d.type === 'mlsExtHealthResult') {
          if (d.requestId && d.requestId !== requestId) return;
          var health = d.resp || {}, athena = health.athena || {};
          finish(health.ok === true && Number(athena.tabs || 0) > Number(athena.discarded || 0));
        }
      }
      window.addEventListener('message', on);
      timer = setTimeout(function () { finish(false); }, HEALTH_MS);
      try { window.postMessage({ source: 'mls-app', type: 'mlsExtHealth', requestId: requestId }, '*'); } catch (e) {}
    });
  }

  var checking = false;
  async function check() {
    if (checking) return;
    checking = true;
    try {
      var ext = await pingExtension();
      if (!ext) { render('noext'); return; }
      var open = await probeAthenaOpen();
      render(open ? 'connected' : 'noathena');
    } catch (e) {
      render('noext');
    } finally { checking = false; }
  }

  var timer = null;
  function tick() { if (document.visibilityState !== 'hidden') check(); }
  function onVis() { if (document.visibilityState === 'visible') check(); }
  function onFocus() { check(); }
  function start() {
    ensureDot();
    render('checking');
    tick();
    if (!timer) timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', onVis, false);
    window.addEventListener('focus', onFocus, false);
  }

  function revert() {
    try { if (timer) clearInterval(timer); timer = null; } catch (e) {}
    try { document.removeEventListener('visibilitychange', onVis, false); } catch (e) {}
    try { window.removeEventListener('focus', onFocus, false); } catch (e) {}
    try { if (dot && dot.parentNode) dot.parentNode.removeChild(dot); dot = null; tip = null; } catch (e) {}
    try { var st = document.getElementById('mlsAthenaStatusDotStyle'); if (st && st.parentNode) st.parentNode.removeChild(st); } catch (e) {}
    try { window.__mlsAthenaStatusDot.installed = false; } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.__mlsAthenaStatusDot = {
    installed: true,
    version: VERSION,
    check: check,
    pingExtension: pingExtension,
    probeAthenaOpen: probeAthenaOpen,
    revert: revert,
    get state() { return lastState; }
  };
})();
