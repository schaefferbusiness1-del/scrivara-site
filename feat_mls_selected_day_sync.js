/* feat_mls_selected_day_sync.js
 * UNIFICATION: one source of truth for the "selected day".
 *
 * The NEXT UP picker (.mlsnu-date on the Visit / MLS Easy view) and the
 * Calendar view (window._calRefDate) each kept their own independent
 * "selected day". Changing the day in the picker did NOT move the Calendar,
 * so a provider who flipped the picker ahead to tomorrow and then opened the
 * Calendar still landed on today. This wires the picker's day INTO the
 * Calendar so the two surfaces agree.
 *
 * Direction: picker -> calendar, EDGE-triggered (propagates only when the
 * picker's value actually changes). Independent Calendar navigation is never
 * clobbered. Purely additive and reversible: window.__mlsDaySync.revert().
 */
(function () {
  if (window.__mlsDaySync && window.__mlsDaySync.__installed) return;

  var POLL_MS = 400;
  var lastSeen = null;   // last picker value we observed
  var timer = null;
  var started = false;

  function pickerEl() { return document.querySelector('.mlsnu-date'); }

  function calendarActive() {
    try {
      var on = document.querySelector('.navtab.on');
      return !!(on && /calendar/i.test(on.textContent || ''));
    } catch (e) { return false; }
  }

  function propagate(day) {
    if (!day) return;
    try {
      if (typeof window._calRefDate !== 'undefined') {
        window._calRefDate = day;
        // If the Calendar happens to be the active view, refresh it in place.
        if (calendarActive() && typeof window._calRenderDay === 'function') {
          try { window._calRenderDay(); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  function tick() {
    var p = pickerEl();
    if (!p) return;                 // picker not mounted yet
    var v = p.value;
    if (!v) return;
    if (lastSeen === null) {        // first observation: adopt, don't propagate
      lastSeen = v;
      return;
    }
    if (v !== lastSeen) {           // edge: the picker's day changed
      lastSeen = v;
      propagate(v);
    }
  }

  function start() {
    if (started) return;
    started = true;
    timer = setInterval(tick, POLL_MS);
    tick();
  }

  window.__mlsDaySync = {
    __installed: true,
    revert: function () {
      try { if (timer) clearInterval(timer); } catch (e) {}
      timer = null; started = false; lastSeen = null;
      this.__installed = false;
    },
    state: function () {
      return {
        installed: this.__installed,
        picker: (pickerEl() || {}).value || null,
        cal: window._calRefDate,
        calendarActive: calendarActive(),
        lastSeen: lastSeen
      };
    },
    // force a one-shot reconcile (e.g. for verification)
    sync: function () {
      var p = pickerEl();
      if (p && p.value) { lastSeen = p.value; propagate(p.value); }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
