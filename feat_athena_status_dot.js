/* feat_athena_status_dot.js — always-on Athena connection indicator (v1.0.0)
 *
 * Adds a small fixed dot in the TOP-RIGHT corner of MLS that honestly reflects, in
 * real time, whether MLS is connected to athenaOne:
 *   GREEN = the MLS Assist extension is responding (mlsPing/mlsPong) AND a signed-in
 *           athenaOne tab is readable (the athena-open probe: the same
 *           mlsAppPullSchedule -> mlsAppScheduleResult message used by
 *           _assistReadAthenaTab; we read ONLY resp.ok).
 *   RED   = MLS Assist extension not detected, OR no signed-in athenaOne tab readable.
 *   GREY  = first check still in flight (only momentarily, right after load, or while
 *           the MLS tab has never been brought to the foreground).
 *
 * It REUSES the app's real detection at the protocol level (the extension's
 * mlsPing/mlsPong handshake and its mlsAppPullSchedule probe). It NEVER fabricates a
 * "connected" state, and it never reads, stores, logs, or transmits any chart/schedule
 * text -- it inspects only the boolean resp.ok, so no PHI is touched. The schedule probe
 * is a passive read-only DOM read inside the extension; it does NOT focus, click, or
 * navigate the athenaOne tab.
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

  var VERSION = '1.0.0';
  var POLL_MS = 7000;
  var PING_MS = 1500;
  var ATHENA_MS = 6000;

  var COLORS = { connected: '#16a34a', red: '#dc2626', checking: '#9aa0a6' };

  function ensureStyle() {
    if (document.getElementById('mlsAthenaStatusDotStyle')) return;
    var st = document.createElement('style');
    st.id = 'mlsAthenaStatusDotStyle';
    st.textContent =
      '#mlsAthenaStatusDot{position:fixed;top:8px;right:10px;z-index:2147483601;width:12px;height:12px;' +
      'border-radius:50%;background:' + COLORS.checking + ';box-shadow:0 0 0 2px rgba(255,255,255,.92),0 1px 5px rgba(0,0,0,.5);' +
      'cursor:default;pointer-events:auto;transition:background .2s ease;}' +
      '#mlsAthenaStatusDot .mlsDotTip{position:absolute;top:19px;right:0;white-space:nowrap;background:#0f2740;color:#fff;' +
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
    if (state === 'connected') { color = COLORS.connected; label = 'Athena connected'; }
    else if (state === 'noext') { color = COLORS.red; label = 'Athena not connected -- MLS Assist not detected'; }
    else if (state === 'noathena') { color = COLORS.red; label = 'Athena not connected -- open a signed-in athenaOne tab'; }
    else { color = COLORS.checking; label = 'Checking Athena connection...'; }
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
      var done = false;
      function on(ev) {
        if (ev.data && ev.data.type === 'mlsPong') { if (done) return; done = true; window.removeEventListener('message', on); resolve(true); }
      }
      window.addEventListener('message', on);
      try { window.postMessage({ type: 'mlsPing', source: 'mls-app', from: 'mls-app' }, '*'); } catch (e) {}
      setTimeout(function () { if (done) return; done = true; window.removeEventListener('message', on); resolve(false); }, PING_MS);
    });
  }

  function probeAthenaOpen() {
    return new Promise(function (resolve) {
      var done = false;
      function on(ev) {
        if (done) return;
        var d = ev.data;
        if (d && d.source === 'mls-ext' && d.type === 'mlsAppScheduleResult') {
          done = true; window.removeEventListener('message', on);
          resolve(!!(d.resp && d.resp.ok));
        }
      }
      window.addEventListener('message', on);
      try { window.postMessage({ source: 'mls-app', type: 'mlsAppPullSchedule' }, '*'); } catch (e) {}
      setTimeout(function () { if (done) return; done = true; window.removeEventListener('message', on); resolve(false); }, ATHENA_MS);
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
