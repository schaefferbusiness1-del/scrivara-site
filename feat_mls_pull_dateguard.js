/* ============================================================================
 * feat_mls_pull_dateguard.js  ->  window.__mlsDateGuard   (v1.0.0)   [item81]
 *
 * ROOT-CAUSE FIX for the misdated-pull bug (patients filed on Sat July 4):
 * the Athena schedule page contains a stray holiday string "July 4, 2026",
 * and _detectSchedDate() grabs the FIRST date-like string anywhere in the
 * page text as the fallback day for every appointment the AI parse didn't
 * date. Three pulls (Jun 29, Jun 30, Jul 1) were misdated that way; the data
 * was repaired on Jul 1 (rows re-dated to their pull days; backup kept in
 * localStorage 'mlsRepairBackup_20260701').
 *
 * THE GUARD (additive wrap around window._detectSchedDate):
 *   1. Run the original detector.
 *   2. Accept its date ONLY if it sits next to a weekday word in the page
 *      text (a real day-view header like "Wednesday, July 1, 2026" or
 *      "Wed 7/1") OR is within 3 days of today.
 *   3. Otherwise re-scan for a weekday-adjacent date and use that.
 *   4. Otherwise return '' so the import falls back to _nextClinicDay()
 *      (today on a weekday) — and say so honestly in the pull status.
 * Result: a bare "July 4, 2026" holiday notice can never date a pull again,
 * while a genuine "open tomorrow's day in Athena and pull" still works
 * (tomorrow is within 3 days, and day headers carry weekday words).
 *
 * Additive, reversible: window.__mlsDateGuard.revert(). No data mutations.
 * ==========================================================================*/
;(function () {
  'use strict';
  try { if (window.__mlsDateGuard && window.__mlsDateGuard.installed) return; } catch (e) { return; }
  var G = { installed: true, v: '1.0.0' };
  window.__mlsDateGuard = G;

  var WD = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)';
  var MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

  function toISO(y, mo, d) {
    var dd = new Date(Date.UTC(+y, +mo, +d));
    return isNaN(dd) ? '' : dd.toISOString().slice(0, 10);
  }
  function daysFromToday(iso) {
    try {
      var t = new Date(); var today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
      var p = iso.split('-'); var that = Date.UTC(+p[0], +p[1] - 1, +p[2]);
      return Math.round((that - today) / 86400000);
    } catch (e) { return 999; }
  }
  /* find a date that sits within 28 chars AFTER a weekday word (a day-view header) */
  function weekdayAdjacentDate(text) {
    var t = String(text || '');
    var re = new RegExp(WD + '[a-z]*[,.]?\\s{0,3}(' +
      '([A-Za-z]{3,9})\\s+(\\d{1,2}),?\\s+(\\d{4})' + '|' +   /* July 1, 2026 */
      '(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})' + ')', 'gi');
    var m;
    while ((m = re.exec(t))) {
      var iso = '';
      if (m[3] && m[4] && m[5]) { var mo = MONTHS[String(m[3]).toLowerCase()]; if (mo != null) iso = toISO(m[5], mo, m[4]); }
      else if (m[6] && m[7] && m[8]) { var y = m[8].length === 2 ? ('20' + m[8]) : m[8]; iso = toISO(y, +m[6] - 1, m[7]); }
      if (iso && Math.abs(daysFromToday(iso)) <= 60) return iso; /* headers are near-term */
    }
    return '';
  }
  function say(msg) {
    try {
      var st = document.getElementById('heroPullStatus');
      if (st) { st.textContent = msg; st.style.display = 'block'; }
    } catch (e) {}
  }

  if (typeof window._detectSchedDate === 'function' && !window._detectSchedDate.__dgWrap) {
    G._orig = window._detectSchedDate;
    var guarded = function (text) {
      var raw = '';
      try { raw = G._orig.apply(this, arguments) || ''; } catch (e) { raw = ''; }
      try {
        var hdr = weekdayAdjacentDate(text);
        /* 1) a real day-header date always wins */
        if (hdr) {
          if (raw && raw !== hdr) say('Date check: using the day header ' + hdr + ' (ignored a stray "' + raw + '" elsewhere on the page).');
          return hdr;
        }
        /* 2) no header: accept the raw detect only if it is near today */
        if (raw && Math.abs(daysFromToday(raw)) <= 3) return raw;
        /* 3) far-away bare date (holiday notices like "July 4, 2026") = poison; drop it */
        if (raw) say('Date check: ignored a stray "' + raw + '" on the Athena page — filing under the current clinic day instead. Drag any appointment in Calendar if one lands wrong.');
        return '';
      } catch (e) { return raw; }
    };
    guarded.__dgWrap = true;
    window._detectSchedDate = guarded;
    G.active = true;
  } else {
    G.active = false;
  }

  G.revert = function () {
    try { if (G._orig) window._detectSchedDate = G._orig; } catch (e) {}
    G.installed = false;
    try { delete window.__mlsDateGuard; } catch (e) { window.__mlsDateGuard = undefined; }
  };

  try { console.log('[MLS dateguard item81] installed, active=', G.active); } catch (e) {}
})();
