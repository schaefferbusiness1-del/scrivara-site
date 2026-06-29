/* feat_mls_hero_search.js  ->  window.__mlsHeroSearch   [item54]
 *
 * Today's-schedule QUICK SEARCH in the visit-hero "NEXT UP" picker.
 * The hero picker (#heroToday) shows the clinic day a few cards at a time behind paging
 * arrows; finding one specific patient among 122 means clicking through page after page.
 * This adds a single search box just above the NEXT UP cards that LIVE-FILTERS the WHOLE
 * day's schedule (name / reason / MRN / appointment time) and shows the matches instantly
 * as the doctor types -- no paging, no scrolling. Clearing the box restores the normal
 * picker untouched.
 *
 * CONNECTIVE: it reads the SAME schedule source the picker, calendar and active-patient
 * bar share -- window.__mlsPick.scopeList(<smart scope>) -- and a result click calls the
 * SAME shared action window.__mlsPick.select(id), so searching then clicking drives the
 * active patient everywhere exactly like tapping a NEXT UP card. The search box and its
 * results are mounted as SIBLINGS of #heroToday so the picker's own re-renders never
 * disturb them.
 *
 * SAFETY: read-only / display-only; never writes a chart, never touches athenaOne, never
 * mutates or deletes any record; no PHI logged or sent. ASCII-only. Idempotent. Gated on
 * window.__mlsPick. Reversible: window.__mlsHeroSearch.revert().
 */
(function () {
  "use strict";
  if (window.__mlsHeroSearch && window.__mlsHeroSearch.__live) return;

  var HOST_ID = "heroToday";
  var CTL_SEL = ".mlsNuCtl";
  var BAR_ID = "mlsHeroSearchBar";
  var INPUT_ID = "mlsHeroSearchInput";
  var RESULTS_ID = "mlsHeroSearchResults";
  var STYLE_ID = "mlsHeroSearch-style";
  var timer = null;
  var lastQuery = "";

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
    try { var r = api.scopeList(smartScope()); return (r && r.list) ? r.list : []; }
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
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    var a = parts[0][0] || "", b = parts.length > 1 ? (parts[parts.length - 1][0] || "") : "";
    return (a + b).toUpperCase();
  }

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "#" + BAR_ID + "{display:flex;align-items:center;gap:8px;margin:6px 0 8px;position:relative;max-width:100%;}",
      "#" + BAR_ID + " .mlshs-ic{position:absolute;left:12px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.6;display:flex;color:#cbd5e1;}",
      "#" + INPUT_ID + "{flex:1 1 auto;width:100%;box-sizing:border-box;padding:9px 34px 9px 34px;border-radius:10px;",
      "border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.10);color:#f1f5f9;font:600 13px/1.3 inherit;outline:none;transition:border-color .15s,box-shadow .15s,background .15s;}",
      "#" + INPUT_ID + "::placeholder{color:#cbd5e1;opacity:.8;font-weight:500;}",
      "#" + INPUT_ID + ":focus{border-color:#93c5fd;background:rgba(255,255,255,.16);box-shadow:0 0 0 3px rgba(147,197,253,.22);}",
      "#" + BAR_ID + " .mlshs-x{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:none;background:none;color:#cbd5e1;cursor:pointer;font-size:18px;line-height:1;padding:3px 6px;border-radius:7px;display:none;}",
      "#" + BAR_ID + " .mlshs-x:hover{background:rgba(255,255,255,.18);color:#fff;}",
      "#" + BAR_ID + ".has-q .mlshs-x{display:block;}",
      "#" + RESULTS_ID + "{margin:0 0 10px;}",
      "#" + RESULTS_ID + " .mlshs-count{font-size:11px;letter-spacing:.04em;text-transform:uppercase;opacity:.7;font-weight:700;color:#e2e8f0;margin:2px 2px 8px;}",
      "#" + RESULTS_ID + " .mlshs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;}",
      "#" + RESULTS_ID + " .mlshs-card{display:flex;align-items:center;gap:9px;text-align:left;cursor:pointer;",
      "padding:8px 10px;border-radius:11px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#f1f5f9;transition:background .12s,border-color .12s,transform .05s;}",
      "#" + RESULTS_ID + " .mlshs-card:hover{background:rgba(147,197,253,.18);border-color:rgba(147,197,253,.5);}",
      "#" + RESULTS_ID + " .mlshs-card:active{transform:translateY(1px);}",
      "#" + RESULTS_ID + " .mlshs-av{flex:0 0 auto;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;background:rgba(59,130,246,.30);color:#dbeafe;}",
      "#" + RESULTS_ID + " .mlshs-info{display:flex;flex-direction:column;min-width:0;flex:1 1 auto;}",
      "#" + RESULTS_ID + " .mlshs-nm{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      "#" + RESULTS_ID + " .mlshs-sub{font-size:11px;opacity:.78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      "#" + RESULTS_ID + " .mlshs-empty{opacity:.75;font-weight:600;font-size:13px;color:#e2e8f0;padding:8px 2px;}"
    ].join("");
    document.head.appendChild(s);
  }

  function hostNodes() {
    var ht = document.getElementById(HOST_ID);
    if (!ht || ht.offsetParent === null) return null;
    return { ht: ht, parent: ht.parentNode, ctl: ht.parentNode ? ht.parentNode.querySelector(CTL_SEL) : null };
  }
  function setOrigHidden(h, hidden) {
    if (h.ht) h.ht.style.display = hidden ? "none" : "";
    if (h.ctl) h.ctl.style.display = hidden ? "none" : "";
  }

  function ensureBar(h) {
    var bar = document.getElementById(BAR_ID);
    if (bar && bar.nextElementSibling && bar.parentNode === h.parent) return bar;
    if (!bar) {
      bar = document.createElement("div");
      bar.id = BAR_ID;
      var ic = document.createElement("span");
      ic.className = "mlshs-ic";
      ic.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>';
      var input = document.createElement("input");
      input.id = INPUT_ID; input.type = "text"; input.autocomplete = "off"; input.spellcheck = false;
      input.setAttribute("placeholder", "Search today's patients by name, reason, MRN or time");
      input.setAttribute("aria-label", "Search today's patients");
      var clr = document.createElement("button");
      clr.type = "button"; clr.className = "mlshs-x"; clr.setAttribute("aria-label", "Clear search");
      clr.innerHTML = "&times;";
      bar.appendChild(ic); bar.appendChild(input); bar.appendChild(clr);
      input.addEventListener("input", function () { lastQuery = input.value; apply(input.value); });
      input.addEventListener("keydown", function (e) { if (e.key === "Escape") { input.value = ""; lastQuery = ""; apply(""); } });
      clr.addEventListener("click", function () { input.value = ""; lastQuery = ""; apply(""); input.focus(); });
    }
    var res = ensureResults(h);
    h.parent.insertBefore(bar, res || h.ht);
    return bar;
  }
  function ensureResults(h) {
    var r = document.getElementById(RESULTS_ID);
    if (!r) { r = document.createElement("div"); r.id = RESULTS_ID; }
    if (r.parentNode !== h.parent || r.nextElementSibling !== h.ht) h.parent.insertBefore(r, h.ht);
    return r;
  }

  function matchCard(p) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "mlshs-card"; b.setAttribute("data-id", p.id);
    var time = fmtMins(p.mins);
    var sub = [(time || ""), ((p.reason && String(p.reason).trim()) || "")].filter(Boolean).join("  -  ");
    b.innerHTML =
      '<span class="mlshs-av">' + esc(initials(p.name)) + "</span>" +
      '<span class="mlshs-info"><span class="mlshs-nm">' + esc(p.name || "Patient") + "</span>" +
      '<span class="mlshs-sub">' + esc(sub || "Patient") + "</span></span>";
    b.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var api = pickApi();
      try { if (api && typeof api.select === "function") api.select(p.id); } catch (err) {}
    });
    return b;
  }

  function apply(q) {
    var h = hostNodes(); if (!h) return;
    var bar = document.getElementById(BAR_ID);
    var query = String(q || "").trim().toLowerCase();
    if (bar) bar.classList.toggle("has-q", !!query);
    if (!query) {
      var r0 = document.getElementById(RESULTS_ID); if (r0) r0.innerHTML = "";
      setOrigHidden(h, false);
      return;
    }
    var list = dayList();
    var matches = list.filter(function (p) {
      var hay = [p.name, p.reason, p.mrn, fmtMins(p.mins)].join("  ").toLowerCase();
      return query.split(/\s+/).every(function (tok) { return hay.indexOf(tok) >= 0; });
    });
    setOrigHidden(h, true);
    var res = ensureResults(h); if (!res) return;
    var head = document.createElement("div");
    head.className = "mlshs-count";
    head.textContent = matches.length + " of " + list.length + " patient" +
      (list.length === 1 ? "" : "s") + ' match "' + q.trim() + '"';
    res.innerHTML = "";
    res.appendChild(head);
    if (!matches.length) {
      var em = document.createElement("div"); em.className = "mlshs-empty";
      em.textContent = "No patient in today's schedule matches that.";
      res.appendChild(em);
      return;
    }
    var grid = document.createElement("div"); grid.className = "mlshs-grid";
    matches.slice(0, 60).forEach(function (p) { grid.appendChild(matchCard(p)); });
    res.appendChild(grid);
  }

  function tick() {
    if (window.__mlsHeroSearch && window.__mlsHeroSearch.__reverted) return;
    if (!pickApi()) return;
    var h = hostNodes(); if (!h) return;
    css();
    ensureBar(h);
    if (lastQuery && String(lastQuery).trim()) apply(lastQuery);
  }
  function start() { css(); tick(); if (timer) clearInterval(timer); timer = setInterval(tick, 1200); }

  window.__mlsHeroSearch = {
    __live: true, __reverted: false, apply: apply,
    revert: function () {
      this.__reverted = true; this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      var h = hostNodes(); if (h) setOrigHidden(h, false);
      var b = document.getElementById(BAR_ID); if (b) b.remove();
      var r = document.getElementById(RESULTS_ID); if (r) r.remove();
      var st = document.getElementById(STYLE_ID); if (st) st.remove();
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
