/* =========================================================================
 * MLS -- Calendar render cycle-breaker
 *   feat_mls_cal_cyclefix.js -> window.__mlsCalCycleFix (calfix-1.0.0)
 * 2026-07-12, final sweep (live-diagnosed on michael@ account).
 * ----------------------------------------------------------------------------
 * BUG: two independent modules each WRAP the base calendar renderers
 * (renderCalendar / calOpenDay / renderCalCheckin) AND each re-installs on a
 * 250 ms timer:
 *   - feat_mls_calpro.js (Task 11, cp-1.0.2): a provider-filter "swapCall"
 *     wrapper, re-applied by its tick.
 *   - feat_mls_caldedupe_render.js (pre-existing): a duplicate-appointment
 *     dedupe wrapper, re-applied by its own interval.
 * Because both keep re-wrapping over each other, one module's captured
 * "original" eventually points at the OTHER module's wrapper, and the two
 * wrappers call each other forever -> renderCalendar() throws
 * "Maximum call stack size exceeded" and the calendar's prev/next/day/month
 * navigation silently does nothing. (Verified live: calNext() overflowed.)
 *
 * FIX: install ONE flattened renderer per key that (a) runs the same
 * duplicate collapse, (b) applies calpro's provider selection when one is
 * active (defensively -- never blanks the calendar), then (c) calls the TRUE
 * base function DIRECTLY (found by unwrapping the marker chain), with no
 * wrapper-to-wrapper indirection. The flat function carries BOTH modules'
 * skip-markers (__cpWrapped + __mlsDeduped) so neither timer ever re-wraps it
 * -> the cycle cannot re-form. A light re-assert tick repairs it if anything
 * ever replaces it.
 *
 * Additive, reversible (window.__mlsCalCycleFix.revert()), freeze-safe (one
 * cheap flag check per second; only re-flattens on change). No store parsing,
 * no writeback, no extension, no Athena.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCalCycleFix && window.__mlsCalCycleFix.installed) return; } catch (e) { return; }

  var VERSION = 'calfix-1.0.0';
  var KEYS = ['renderCalendar', 'calOpenDay', 'renderCalCheckin'];

  function S(x) { return x == null ? '' : String(x); }

  /* deepest callable base: unwrap past our own flat + calpro + dedupe markers.
     A `seen` set guards against a marker-chain cycle (returns null if so). */
  function findBase(fn) {
    var seen = [];
    while (fn && typeof fn === 'function') {
      for (var i = 0; i < seen.length; i++) if (seen[i] === fn) return null;
      seen.push(fn);
      if (!fn.__cpWrapped && !fn.__mlsDeduped && !fn.__calFlat) return fn;
      fn = fn.__flatBase || fn.__cpOrig || fn.__mlsOrig || null;
    }
    return null;
  }

  function dedupeAppts() {
    try {
      var arr = window._calAppts;
      if (!Array.isArray(arr) || arr.length < 2) return;
      var seen = {}, out = [], dup = false;
      function keyOf(a) {
        var lbl = (typeof window._calLabelOf === 'function' ? window._calLabelOf(a) : (a && a.name)) || '';
        var d = (typeof window._calDateOf === 'function' ? window._calDateOf(a) : (a && (a.appt_date || S(a.start_at).slice(0, 10)))) || '';
        var t = S(a && a.start_at).slice(0, 16);
        var p = (a && a.doctor_user_id != null && a.doctor_user_id !== '') ? ('d' + a.doctor_user_id) : S(a && a.provider).toLowerCase();
        return S(lbl).trim().toLowerCase() + '|' + d + '|' + t + '|' + p;
      }
      for (var i = 0; i < arr.length; i++) {
        var a = arr[i];
        if (a == null) { dup = true; continue; }
        var k = keyOf(a);
        if (!(k in seen)) { seen[k] = out.length; out.push(a); } else { dup = true; }
      }
      if (dup) window._calAppts = out;
    } catch (e) {}
  }

  /* apply calpro's active provider selection; never blanks the calendar */
  function provFilter() {
    try {
      var cp = window.__mlsCalPro;
      if (!cp || typeof cp.selProviders !== 'function') return null;
      var sel = cp.selProviders();
      if (!sel || !sel.length) return null;
      var set = {};
      for (var i = 0; i < sel.length; i++) set[S(sel[i]).toLowerCase()] = 1;
      var real = window._calAppts || [];
      var filtered = [];
      for (var j = 0; j < real.length; j++) {
        var a = real[j]; if (!a) continue;
        var cands = [a.doctor_user_id, a.provider_key, a.provider, a.provider_raw];
        var hit = false;
        for (var c = 0; c < cands.length; c++) { var v = S(cands[c]).toLowerCase(); if (v && set[v]) { hit = true; break; } }
        if (hit) filtered.push(a);
      }
      if (!filtered.length && real.length) return null;   /* selection matched nothing -> show all, never blank */
      window._calAppts = filtered;
      return real;
    } catch (e) { return null; }
  }

  function flattenKey(key) {
    var cur = window[key];
    if (typeof cur !== 'function') return false;
    if (cur.__calFlat) return true;                        /* already ours */
    var base = findBase(cur);
    if (typeof base !== 'function') return false;          /* cannot reach a clean base -> leave alone */
    var flat = function () {
      dedupeAppts();
      var real = provFilter();
      try { return base.apply(this, arguments); }
      finally { if (real !== null) { try { window._calAppts = real; } catch (e) {} } }
    };
    flat.__cpWrapped = true;    /* calpro's wrapFn skips (guards on __cpWrapped) */
    flat.__mlsDeduped = true;   /* caldedupe's wrap skips (guards on __mlsDeduped) */
    flat.__calFlat = true;
    flat.__flatBase = base;
    window[key] = flat;
    return true;
  }

  function flattenAll() { var n = 0; for (var i = 0; i < KEYS.length; i++) if (flattenKey(KEYS[i])) n++; return n; }

  var iv = null, orig = {};
  function boot() {
    for (var i = 0; i < KEYS.length; i++) orig[KEYS[i]] = window[KEYS[i]];
    flattenAll();
    iv = setInterval(function () {
      try {
        for (var i = 0; i < KEYS.length; i++) {
          var f = window[KEYS[i]];
          if (typeof f === 'function' && !f.__calFlat) flattenKey(KEYS[i]);
        }
      } catch (e) {}
    }, 1000);
  }
  function revert() {
    if (iv) { clearInterval(iv); iv = null; }
    try { for (var i = 0; i < KEYS.length; i++) { var k = KEYS[i]; var b = window[k] && window[k].__flatBase; if (b) window[k] = b; } } catch (e) {}
    try { window.__mlsCalCycleFix.installed = false; } catch (e) {}
    return 'calendar cycle-fix reverted (base renderers restored)';
  }

  window.__mlsCalCycleFix = {
    installed: true, version: VERSION, asset: 'feat_mls_cal_cyclefix.js',
    flattenAll: flattenAll, _findBase: findBase, revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
