/* feat_mls_hero_glance.js  ->  window.__mlsHeroGlance   [item55]
 *
 * "Day at a glance" schedule strip above the visit-hero NEXT UP picker.
 * The hero picker highlights who is UP NOW and a raw "N to be seen" total, but never
 * tells the doctor how much of the clinic day is left. This adds one compact, read-only
 * strip just above the NEXT UP cards that summarizes the day from the SAME schedule
 * source: who is up next (time + name), how many appointments are still ahead by the
 * clock, and what time the last appointment of the day is -- so the doctor can see the
 * shape of the remaining day at a glance without paging the list.
 *
 * CONNECTIVE: reads window.__mlsPick.scopeList(<smart scope>) -- the one schedule the
 * picker, calendar, search and active-patient bar all share -- so the summary always
 * agrees with the cards. Mounted as a SIBLING of #heroToday so the picker's own
 * re-renders never disturb it.
 *
 * SAFETY: read-only / display-only; never writes a chart, never touches athenaOne, never
 * mutates or deletes any record; no PHI logged or sent. ASCII-only. Idempotent. Gated on
 * window.__mlsPick. Reversible: window.__mlsHeroGlance.revert().
 */
(function () {
  "use strict";
  if (window.__mlsHeroGlance && window.__mlsHeroGlance.__live) return;

  var HOST_ID = "heroToday";
  var STRIP_ID = "mlsHeroGlanceStrip";
  var STYLE_ID = "mlsHeroGlance-style";
  var timer = null;

  function pickApi() {
    try { return (window.__mlsPick && window.__mlsPick.installed === true) ? window.__mlsPick : null; }
    catch (e) { return null; }
  }
  function smartScope() {
    var api = pickApi(); if (!api) return "recent";
    try { var t = api.scopeList("today"); return (t && t.list && t.list.length) ? "today" : "recent"; }
    catch (e) { return "recent"; }
  }
  function dayList() {
    var api = pickApi(); if (!api) return [];
    try { var r = api.scopeList(smartScope()); return (r && r.list) ? r.list.slice() : []; }
    catch (e) { return []; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtMins(m) {
    if (m == null || isNaN(m)) return "";
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? "AM" : "PM", hh = h % 12; if (hh === 0) hh = 12;
    return hh + ":" + (mm < 10 ? "0" : "") + mm + " " + ap;
  }
  function nowMins() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function withMins(list) {
    return list.filter(function (p) { return p && p.mins != null && !isNaN(p.mins); })
      .sort(function (a, b) { return a.mins - b.mins; });
  }

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "#" + STRIP_ID + "{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin:8px 0 8px;",
      "padding:7px 12px;border-radius:11px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);",
      "font:600 12px/1.3 inherit;color:#e2e8f0;}",
      "#" + STRIP_ID + " .mlshg-seg{display:inline-flex;align-items:center;gap:6px;}",
      "#" + STRIP_ID + " .mlshg-k{text-transform:uppercase;letter-spacing:.05em;font-size:10px;opacity:.7;font-weight:700;}",
      "#" + STRIP_ID + " .mlshg-v{font-weight:800;color:#f1f5f9;}",
      "#" + STRIP_ID + " .mlshg-nm{font-weight:700;opacity:.95;}",
      "#" + STRIP_ID + " .mlshg-dot{width:4px;height:4px;border-radius:999px;background:rgba(255,255,255,.45);display:inline-block;}",
      "#" + STRIP_ID + " .mlshg-up{color:#bfdbfe;}"
    ].join("");
    document.head.appendChild(s);
  }

  function hostNodes() {
    var ht = document.getElementById(HOST_ID);
    if (!ht || ht.offsetParent === null) return null;
    return { ht: ht, parent: ht.parentNode };
  }

  function render() {
    if (window.__mlsHeroGlance && window.__mlsHeroGlance.__reverted) return;
    if (!pickApi()) return;
    var h = hostNodes(); if (!h) { var ex = document.getElementById(STRIP_ID); if (ex) ex.remove(); return; }
    css();
    var sorted = withMins(dayList());
    var strip = document.getElementById(STRIP_ID);
    if (!sorted.length) { if (strip) strip.remove(); return; }
    if (!strip) { strip = document.createElement("div"); strip.id = STRIP_ID; strip.setAttribute("aria-label", "Today's schedule at a glance"); }
    // keep it just before the hero picker (above a search bar if present)
    var anchor = document.getElementById("mlsHeroSearchBar") || h.ht;
    if (strip.nextElementSibling !== anchor || strip.parentNode !== h.parent) h.parent.insertBefore(strip, anchor);

    var nm = nowMins();
    var upcoming = sorted.filter(function (p) { return p.mins >= nm; });
    var next = upcoming.length ? upcoming[0] : null;
    var last = sorted[sorted.length - 1];

    var html = "";
    if (next) {
      html += '<span class="mlshg-seg mlshg-up"><span class="mlshg-k">Up next</span>' +
        '<span class="mlshg-v">' + esc(fmtMins(next.mins)) + "</span>" +
        '<span class="mlshg-nm">' + esc(next.name || "Patient") + "</span></span>";
      html += '<span class="mlshg-dot"></span>';
      html += '<span class="mlshg-seg"><span class="mlshg-v">' + upcoming.length + "</span><span>still ahead today</span></span>";
    } else {
      html += '<span class="mlshg-seg"><span class="mlshg-v">All</span><span>of today\'s appointments are in the past</span></span>';
    }
    if (last) {
      html += '<span class="mlshg-dot"></span>';
      html += '<span class="mlshg-seg"><span class="mlshg-k">Last appt</span><span class="mlshg-v">' + esc(fmtMins(last.mins)) + "</span></span>";
    }
    strip.innerHTML = html;
  }

  function start() { render(); if (timer) clearInterval(timer); timer = setInterval(render, 1500); }

  window.__mlsHeroGlance = {
    __live: true, __reverted: false, refresh: render,
    revert: function () {
      this.__reverted = true; this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      var st = document.getElementById(STRIP_ID); if (st) st.remove();
      var sy = document.getElementById(STYLE_ID); if (sy) sy.remove();
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
