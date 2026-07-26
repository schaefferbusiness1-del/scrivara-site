/* feat_mls_analysis_exact.js  ->  window.__mlsAx  (Analysis page, design-exact rebuild)
 *  STAGING ONLY (loaded by mls-connect.staging.js; on prod activated via prod-enable
 *  marker). Runtime-gated. Production app logic untouched.
 *
 *  ax-3.0.0 (2026-07-06): visual redesign + data-extraction fixes.
 *   - FIX Baseline stat: card renders "wRVU (approx.) <n>" (label BEFORE number);
 *     old regex /<n> wRVU/ never matched -> tile was stuck on "Open". New regex +
 *     office-visits fallback regex (re2).
 *   - FIX "Untitled" tile: mlsDWCard (Days worked / patient volume) has no h2/h3;
 *     added a KNOWN entry so it gets a real title, icon and sub-label.
 *   - Procedure Report: honest "View" action label (its card holds a button, not a stat).
 *   - UI: colored accent bar per tile, soft hover lift, bigger stat, cleaner premium
 *     pill, expanded tiles get a proper header strip (icon + title + Collapse) instead
 *     of a floating button, subtler resize grip, refreshed page header.
 *  Everything else (drag-reorder, corner resize, localStorage 'mlsAxLayout', DOM-driven
 *  wrapping, MutationObserver refresh, revert()) is unchanged from ax-2.1.4.
 *
 *  DOM-DRIVEN: every .card in #analysisView is wrapped; real cards are MOVED into tile
 *  bodies (never cloned/deleted). Collapsed stats come from already-rendered body text;
 *  action tools show a neutral verb label, not a statistic. No fabrication.
 *
 *  Reversible: window.__mlsAx.revert(). ASCII-only (emoji = HTML entities).
 *  Idempotent. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "ax-3.0.0";
  try { if (window.__mlsAx && window.__mlsAx.installed) return; } catch (e) { return; }
  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsAx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var STYLE_ID = "axStyle", GRID_CLASS = "ax-grid", LS = "mlsAxLayout";
  var GAP = 18, ROWH = 216, MAXROWS = 5;
  var _obs = null, _t = null, _sched = null, _dragKey = null, _overKey = null;

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  var KNOWN = {
    mlsProcReport:   { icon: "&#128202;", iconBg: "#EAF1EE", accent: "#2E6A4B", title: "Procedure Report",            sub: "procedures by type",         color: "#1A211C", src: "mlsProcReport",    re: /([\d,]+)\s*procedure/i, fallback: "View" },
    /* Label-anchored: the old loose /N patient/ regex latched the FIRST "N
       patients" in the body text, which is the Top-diagnosis cohort count (the
       Active-patients value is followed by "visits recorded", not "patients")
       — so 72 rendered under the Active-patients label. */
    anaKeyTrends:    { icon: "&#128204;", iconBg: "#fdecec", accent: "#e05252", title: "Key trends at a glance",      sub: "active patients, top dx",    color: "#1A211C", src: "anaKeyTrendsBody", re: /Active\s*patients\s*([\d,]+)/i, fallback: "View" },
    anaOutcomes:     { icon: "&#128227;", iconBg: "#fbf3e3", accent: "#e0a028", title: "Outcomes &amp; marketing",    sub: "patient satisfaction",       color: "#c2680f", src: "anaOutcomesBody",  re: /(\d{1,3}%)/, fallback: "View" },
    anaAsk:          { icon: "&#128270;", iconBg: "#f3eefb", accent: "#7A5CC0", title: "Ask your data",               sub: "volumes, trends, coding",    color: "#7A5CC0", label: "Query", premium: true },
    anaBaseline:     { icon: "&#128200;", iconBg: "#e7f5ee", accent: "#12915e", title: "Baseline metrics",            sub: "wRVU and visit counts",      color: "#1A211C", src: "anaBaselineBody",  re: /wRVU\s*\(approx\.\)\s*([\d,]+(?:\.\d+)?)/i, re2: /Office visits\s*([\d,]+)/i, fallback: "View" },
    anaDoctorReview: { icon: "&#128202;", iconBg: "#EAF1EE", accent: "#2E6A4B", title: "Doctor analysis &amp; review", sub: "per-provider AI feedback",  color: "#2E6A4B", label: "Review" },
    anaTeamGrades:   { icon: "&#127775;", iconBg: "#fef6e0", accent: "#1f7d5c", title: "Patient-experience ratings",  sub: "graded visits",              color: "#1f7d5c", src: "anaTeamGradesBody", re: /([\d.]+\s*\/\s*5)/, fallback: "View" },
    anaReferral:     { icon: "&#129309;", iconBg: "#fef6e0", accent: "#7A5CC0", title: "Referral outcomes",           sub: "close the loop",             color: "#7A5CC0", label: "Report", premium: true },
    anaRegistry:     { icon: "&#128203;", iconBg: "#EAF1EE", accent: "#7A5CC0", title: "Outcomes registry",           sub: "pain &amp; ODI trajectory",  color: "#7A5CC0", label: "Build", premium: true },
    anaRwe:          { icon: "&#128300;", iconBg: "#e7f5ee", accent: "#12915e", title: "Research registry",           sub: "de-identified outcomes",     color: "#7A5CC0", label: "Export" },
    mlsRvuProd:      { icon: "&#128202;", iconBg: "#e7f5ee", accent: "#12915e", title: "RVU Productivity",            sub: "from signed visits",         color: "#7A5CC0", label: "wRVU", premium: true },
    mlsDWCard:       { icon: "&#128197;", iconBg: "#EAF1EE", accent: "#2E6A4B", title: "Days worked &amp; volume",    sub: "per provider, by month",     color: "#1A211C", label: "Open" }
  };
  var PREF = ["anaKeyTrends", "anaBaseline", "anaOutcomes", "anaTeamGrades", "mlsProcReport", "mlsRvuProd", "mlsDWCard", "anaDoctorReview", "anaAsk", "anaReferral", "anaRegistry", "anaRwe"];

  function cleanTitle(card) {
    var h = card.querySelector("h2,h3,h1");
    if (!h) return "Untitled";
    var t = (h.textContent || "").replace(/\s+/g, " ").trim();
    t = t.replace(/\s*Refresh.*$/i, "").replace(/PREMIUM/g, "").trim();
    return t || "Untitled";
  }
  function metaFor(card) {
    var id = card.id || "";
    if (KNOWN[id]) return KNOWN[id];
    return { icon: "&#128202;", iconBg: "#EAF1EE", accent: "#2E6A4B", title: cleanTitle(card), sub: "", color: "#1A211C", label: "View" };
  }

  function cards() {
    var v = $("analysisView"); if (!v) return [];
    var found = [];
    v.querySelectorAll(".ax-tile").forEach(function (tile) { var c = tile.querySelector(".ax-body > .card"); if (c) found.push(c); });
    Array.prototype.forEach.call(v.children, function (ch) { if (ch.classList && ch.classList.contains("card")) found.push(ch); });
    return found;
  }
  function cardIds() { return cards().map(function (c) { return c.id; }).filter(Boolean); }

  var STATE = { order: null, sizes: {} };
  function load() { try { var o = JSON.parse(localStorage.getItem(LS) || "{}"); if (o && typeof o === "object") { STATE.order = Array.isArray(o.order) ? o.order : null; STATE.sizes = o.sizes && typeof o.sizes === "object" ? o.sizes : {}; } } catch (e) {} }
  function save() { try { localStorage.setItem(LS, JSON.stringify({ order: STATE.order, sizes: STATE.sizes })); } catch (e) {} }
  function order(ids) {
    var present = {}; ids.forEach(function (i) { present[i] = 1; });
    var base = [];
    (STATE.order && STATE.order.length ? STATE.order : []).forEach(function (k) { if (present[k] && base.indexOf(k) < 0) base.push(k); });
    PREF.forEach(function (k) { if (present[k] && base.indexOf(k) < 0) base.push(k); });
    ids.forEach(function (k) { if (base.indexOf(k) < 0) base.push(k); });
    return base;
  }
  function sizeOf(k) { var s = STATE.sizes[k]; return (s && s.cols) ? { cols: s.cols, rows: s.rows || 1 } : { cols: 1, rows: 1 }; }
  function isExpanded(k) { var s = sizeOf(k); return s.cols >= 2 || s.rows >= 3; }
  function colCount() { var w = window.innerWidth || 1200; return w >= 1100 ? 4 : w >= 820 ? 3 : w >= 560 ? 2 : 1; }

  function injectCSS() {
    var css = [
      "#analysisView." + GRID_CLASS + "{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;grid-auto-rows:" + ROWH + "px!important;gap:" + GAP + "px!important;grid-auto-flow:row dense!important;align-items:stretch!important;max-width:1320px;margin:0 auto}",
      "#analysisView." + GRID_CLASS + " .ax-title{grid-column:1 / -1;display:block;margin:2px 0 10px}",
      "#analysisView." + GRID_CLASS + " .ax-tile{position:relative;border-radius:16px;overflow:hidden;background:#fff;border:1px solid #e6ecf4;box-shadow:0 1px 3px rgba(20,33,28,.05);transition:box-shadow .18s ease,transform .18s ease,border-color .18s ease;min-width:0}",
      "#analysisView." + GRID_CLASS + " .ax-tile::before{content:'';position:absolute;left:0;top:0;right:0;height:3px;background:var(--ax-accent,#2E6A4B);opacity:0;transition:opacity .18s ease}",
      "#analysisView." + GRID_CLASS + " .ax-tile:hover{transform:translateY(-2px);border-color:#d5e2f2;box-shadow:0 10px 24px -12px rgba(20,33,28,.22)}",
      "#analysisView." + GRID_CLASS + " .ax-tile:hover::before{opacity:1}",
      "#analysisView." + GRID_CLASS + " .ax-tile.ax-exp{border-color:#EAF1EE;box-shadow:0 18px 40px -20px rgba(20,33,28,.4);transform:none}",
      "#analysisView." + GRID_CLASS + " .ax-tile.ax-exp::before{opacity:1}",
      "#analysisView." + GRID_CLASS + " .ax-tile.ax-drag{opacity:.5;background:#EAF1EE;box-shadow:inset 0 0 0 2px #C9DCD2}",
      "#analysisView." + GRID_CLASS + " .ax-tile.ax-over{box-shadow:inset 0 0 0 2px #2E6A4B,0 12px 28px -16px rgba(32,64,52,.5);transform:translateY(-2px)}",
      "#analysisView." + GRID_CLASS + " .ax-prev{width:100%;height:100%;text-align:left;background:transparent;border:none;padding:18px 20px;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;color:#1A211C}",
      "#analysisView." + GRID_CLASS + " .ax-prev .ax-cta{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:12.5px;font-weight:600;margin-top:12px;transition:color .15s ease}",
      "#analysisView." + GRID_CLASS + " .ax-tile:hover .ax-prev .ax-cta{color:#2E6A4B}",
      "#analysisView." + GRID_CLASS + " .ax-head{display:none;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #edf2f8;background:#fbfcfe}",
      "#analysisView." + GRID_CLASS + " .ax-tile.ax-exp .ax-head{display:flex}",
      "#analysisView." + GRID_CLASS + " .ax-head .ax-hicon{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;flex:none}",
      "#analysisView." + GRID_CLASS + " .ax-head .ax-htitle{font-weight:700;font-size:14px;color:#1A211C;letter-spacing:-.01em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "#analysisView." + GRID_CLASS + " .ax-collapse{flex:none;height:30px;padding:0 12px;border-radius:8px;border:1px solid #e0e8f1;background:#fff;color:#79837C;font-weight:600;font-size:12.5px;font-family:inherit;cursor:pointer}",
      "#analysisView." + GRID_CLASS + " .ax-collapse:hover{background:#f3f6fb;color:#2E6A4B;border-color:#c9dbf3}",
      "#analysisView." + GRID_CLASS + " .ax-body{display:flex;flex-direction:column;height:100%;min-height:0}",
      "#analysisView." + GRID_CLASS + " .ax-tile.ax-exp .ax-body{height:calc(100% - 55px)}",
      "#analysisView." + GRID_CLASS + " .ax-body > .card{border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;height:100%;overflow:auto;background:#fff!important}",
      "#analysisView." + GRID_CLASS + " .ax-grip{position:absolute;right:3px;bottom:3px;width:20px;height:20px;cursor:nwse-resize;display:flex;align-items:flex-end;justify-content:flex-end;padding:3px;z-index:5;color:#d3dce7;opacity:0;transition:opacity .15s ease}",
      "#analysisView." + GRID_CLASS + " .ax-tile:hover .ax-grip{opacity:1}",
      "#analysisView." + GRID_CLASS + " .ax-grip:hover{color:#2E6A4B}",
      "@media (max-width:1099px){#analysisView." + GRID_CLASS + "{grid-template-columns:repeat(3,minmax(0,1fr))!important}}",
      "@media (max-width:819px){#analysisView." + GRID_CLASS + "{grid-template-columns:repeat(2,minmax(0,1fr))!important}}",
      "@media (max-width:559px){#analysisView." + GRID_CLASS + "{grid-template-columns:1fr!important}}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  function readStat(m) {
    if (m.label) return { text: m.label, isLabel: true };
    var body = m.src && $(m.src);
    if (body) {
      var txt = (body.textContent || "").replace(/\s+/g, " ");
      var mm = m.re ? m.re.exec(txt) : null;
      if (!mm && m.re2) mm = m.re2.exec(txt);
      if (mm && mm[1]) return { text: mm[1].replace(/\s*\/\s*/, "/"), isLabel: false };
    }
    return { text: m.fallback || "View", isLabel: true };
  }
  function buildPreview(prev, m) {
    var st = readStat(m);
    var prem = m.premium ? '<span style="font-size:9px;font-weight:700;letter-spacing:.05em;color:#7A5CC0;background:#f3eefb;border:1px solid #e4d9f7;padding:3px 8px;border-radius:20px">PREMIUM</span>' : "";
    prev.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span style="width:40px;height:40px;border-radius:11px;background:' + m.iconBg + ';display:flex;align-items:center;justify-content:center;font-size:18px">' + m.icon + '</span>' + prem + '</div>' +
      '<div style="font-weight:700;font-size:14.5px;letter-spacing:-.01em;line-height:1.25;margin-bottom:auto">' + m.title + '</div>' +
      '<div style="margin-top:10px"><div style="font-weight:800;font-size:' + (st.isLabel ? "16px" : "24px") + ';letter-spacing:-.015em;color:' + (st.isLabel ? "#5b6b7c" : m.color) + '">' + st.text + '</div>' + (m.sub ? '<div style="color:var(--muted);font-size:12px;margin-top:2px">' + m.sub + '</div>' : "") + '</div>' +
      '<div class="ax-cta">Tap to expand &#10530;</div>';
  }

  function toggle(k) { if (isExpanded(k)) { STATE.sizes[k] = { cols: 1, rows: 1 }; } else { STATE.sizes[k] = { cols: Math.min(4, colCount()), rows: 3 }; } save(); render(); }
  function startResize(k, e) {
    e.preventDefault(); e.stopPropagation();
    var grid = $("analysisView"); if (!grid) return;
    var rect = grid.getBoundingClientRect(), nc = colCount();
    var cellW = (rect.width - GAP * (nc - 1)) / nc, sx = e.clientX, sy = e.clientY, start = sizeOf(k);
    function move(ev) { var dc = Math.round((ev.clientX - sx) / (cellW + GAP)), dr = Math.round((ev.clientY - sy) / (ROWH + GAP)); STATE.sizes[k] = { cols: clamp(start.cols + dc, 1, nc), rows: clamp(start.rows + dr, 1, MAXROWS) }; render(); }
    function up() { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); save(); }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  function reorderTo(targetKey) {
    if (!_dragKey || _dragKey === targetKey) return;
    var o = order(cardIds()), from = o.indexOf(_dragKey), to = o.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    o.splice(from, 1); o.splice(to, 0, _dragKey); STATE.order = o; render();
  }

  function ensureTile(card) {
    var v = $("analysisView"), key = card.id;
    var tile = v.querySelector('.ax-tile[data-ax-id="' + key + '"]');
    if (tile) return tile;
    tile = mk("div"); tile.className = "ax-tile"; tile.setAttribute("data-ax-id", key);
    var prev = mk("button"); prev.className = "ax-prev"; prev.type = "button";
    prev.addEventListener("click", function () { toggle(key); });
    tile.appendChild(prev);
    var head = mk("div"); head.className = "ax-head";
    head.innerHTML = '<span class="ax-hicon"></span><span class="ax-htitle"></span>';
    var col = mk("button", null, "&#10529; Collapse");
    col.className = "ax-collapse"; col.type = "button";
    col.addEventListener("click", function (e) { e.stopPropagation(); toggle(key); });
    head.appendChild(col);
    tile.appendChild(head);
    var body = mk("div"); body.className = "ax-body"; tile.appendChild(body);
    var grip = mk("div", null, '<svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M9 3 3 9M9 7l-2 2"/></svg>');
    grip.className = "ax-grip"; grip.title = "Drag to resize";
    grip.addEventListener("pointerdown", function (e) { startResize(key, e); });
    tile.appendChild(grip);
    tile.addEventListener("dragstart", function (e) { if (isExpanded(key)) { e.preventDefault(); return; } _dragKey = key; try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); } catch (x) {} tile.classList.add("ax-drag"); });
    tile.addEventListener("dragover", function (e) { e.preventDefault(); _overKey = key; reorderTo(key); });
    tile.addEventListener("drop", function (e) { e.preventDefault(); _dragKey = null; _overKey = null; save(); render(); });
    tile.addEventListener("dragend", function () { _dragKey = null; _overKey = null; tile.classList.remove("ax-drag"); render(); });
    v.appendChild(tile);
    return tile;
  }
  function ensureTitle() {
    var v = $("analysisView");
    if (v.querySelector(":scope > .ax-title")) return;
    var t = mk("div"); t.className = "ax-title";
    t.innerHTML =
      '<h1 style="font-family:\'Newsreader\',Georgia,serif;font-weight:500;font-size:28px;letter-spacing:-.015em;margin:0">Analysis</h1>' +
      '<p style="color:var(--muted);font-size:12.5px;margin:4px 0 0">Live practice metrics. Tap any tile to expand it; drag to reorder.</p>';
    v.insertBefore(t, v.firstChild);
  }

  function render() {
    var v = $("analysisView"); if (!v) return;
    if (v.style.display === "none") { v.classList.remove(GRID_CLASS); return; }
    v.classList.add(GRID_CLASS);
    ensureTitle();
    var list = cards(), byId = {}; list.forEach(function (c) { if (c.id) byId[c.id] = c; });
    var ids = Object.keys(byId), nc = colCount();
    order(ids).forEach(function (k) {
      var card = byId[k]; if (!card) return;
      var m = metaFor(card), tile = ensureTile(card);
      var body = tile.querySelector(".ax-body"), prev = tile.querySelector(".ax-prev");
      tile.style.setProperty("--ax-accent", m.accent || "#2E6A4B");
      if (card.parentElement !== body) body.appendChild(card);
      var sz = sizeOf(k), exp = isExpanded(k);
      tile.style.gridColumn = "span " + clamp(sz.cols, 1, nc);
      tile.style.gridRow = "span " + clamp(sz.rows, 1, MAXROWS);
      tile.classList.toggle("ax-exp", exp);
      tile.classList.toggle("ax-over", _overKey === k && _dragKey && _dragKey !== k);
      tile.setAttribute("draggable", exp ? "false" : "true");
      if (exp) {
        var hi = tile.querySelector(".ax-head .ax-hicon"), ht = tile.querySelector(".ax-head .ax-htitle");
        if (hi && hi.innerHTML !== m.icon) { hi.innerHTML = m.icon; hi.style.background = m.iconBg; }
        if (ht && ht.innerHTML !== m.title) ht.innerHTML = m.title;
        prev.style.display = "none"; body.style.display = "flex"; card.style.display = "";
      } else {
        buildPreview(prev, m); prev.style.display = "flex"; body.style.display = "none";
      }
    });
    /* idempotent ordering: only re-append tiles when their order actually changed.
       Re-appending every tile on every render() detached/re-attached subtrees and
       broke scroll anchoring (page jumped on Expand/Collapse). Reconcile once, and
       preserve the window scroll position if the reflow nudges it. */
    var titleEl = v.querySelector(":scope > .ax-title");
    var seq = []; if (titleEl) seq.push(titleEl);
    order(ids).forEach(function (k) {
      var t = v.querySelector('.ax-tile[data-ax-id="' + k + '"]'); if (t) seq.push(t);
    });
    var cur = Array.prototype.filter.call(v.children, function (c) { return seq.indexOf(c) >= 0; });
    var same = cur.length === seq.length && cur.every(function (c, i) { return c === seq[i]; });
    if (!same) {
      var _sy = window.scrollY;
      seq.forEach(function (el) { v.appendChild(el); });
      if (Math.abs(window.scrollY - _sy) > 1) window.scrollTo(0, _sy);
    }
    if (v.getAttribute("data-ax-built") !== VERSION) v.setAttribute("data-ax-built", VERSION);
  }

  function hookShowView() {
    try { if (typeof window.showView === "function" && !window.__axHook) { window.__axHook = 1; var _o = window.showView; window.showView = function () { var r = _o.apply(this, arguments); schedule(); return r; }; } } catch (e) {}
  }
  function applyAll() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { hookShowView(); injectCSS(); if ($("analysisView")) render(); } catch (e) {}
    try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  function schedule() { if (_sched) return; _sched = setTimeout(function () { _sched = null; applyAll(); }, 160); }
  function boot() {
    load();
    try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {}
    applyAll();
    var n = 0; _t = setInterval(function () { applyAll(); if (++n > 12) clearInterval(_t); }, 800);
    try { window.addEventListener("resize", function () { schedule(); }); } catch (e) {}
  }
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_t) clearInterval(_t); } catch (e) {}
    var v = $("analysisView");
    if (v) {
      v.querySelectorAll(".ax-tile .ax-body > .card").forEach(function (c) { c.style.display = ""; v.appendChild(c); });
      v.querySelectorAll(".ax-tile, .ax-title").forEach(function (n) { n.remove(); });
      v.classList.remove(GRID_CLASS);
    }
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { window.__mlsAx.installed = false; } catch (e) {}
  }
  window.__mlsAx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: applyAll };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
