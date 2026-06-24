/* feat_mls_analysis_exact.js  ->  window.__mlsAx  (Analysis page, design-exact rebuild)
 *  STAGING ONLY (loaded by mls-connect.staging.js; on prod activated via prod-enable
 *  marker). Runtime-gated. Production app logic untouched.
 *
 *  Rebuilds #analysisView into the design's RESIZABLE / DRAGGABLE WIDGET DASHBOARD
 *  (design_renders/ScribeFlow Analysis.dc.html): a 4-col grid of tiles. Each tile is
 *  COLLAPSED by default -> a compact preview (icon, title, a headline stat read live from
 *  the app's own rendered data, a sub-label, "Expand"). Click / resize expands it in place
 *  to reveal the app's REAL card (real bodies/data/wired buttons), moved in BY ID. Drag a
 *  collapsed tile to reorder; drag the corner grip to resize (cols 1-4, rows 1-5). Order +
 *  sizes persist to localStorage 'mlsAxLayout'. The design's logic (sizes{cols,rows},
 *  expanded=cols>=2||rows>=3, toggle=>1x1/4x3, pointer-resize math, drag-reorder of order[])
 *  is ported to vanilla DOM.
 *
 *  DOM-DRIVEN: every .card in #analysisView is wrapped (known cards use a design-mapped
 *  icon/title/sub; any other card gets a generic tile) so no card is ever left loose. The
 *  real cards are MOVED into tile bodies (never cloned/deleted), which also hands layout
 *  ownership here: feat_mls_redesign.js's analysis grid keys off "#analysisView > .card"
 *  (now nested) so it self-disables. No fabrication: collapsed stats come from already-
 *  rendered body text; action tools show a neutral verb label, not a statistic.
 *
 *  Reversible: window.__mlsAx.revert() (cards back to #analysisView, no data loss).
 *  ASCII-only (emoji = HTML entities). Idempotent. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "ax-2.1.0";
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
  var GAP = 18, ROWH = 212, MAXROWS = 5;
  var _obs = null, _t = null, _sched = null, _dragKey = null, _overKey = null;

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  var KNOWN = {
    mlsProcReport:   { icon: "&#128202;", iconBg: "#eef3fb", title: "Procedure Report",          sub: "procedures by type",          color: "#0f2540", src: "mlsProcReport",   re: /([\d,]+)\s*procedure/i, fallback: "Open" },
    anaKeyTrends:    { icon: "&#128204;", iconBg: "#fdecec", title: "Key trends at a glance",     sub: "active patients, top dx",     color: "#0f2540", src: "anaKeyTrendsBody", re: /([\d,]+)\s*(?:active\s*)?patient/i, fallback: "Open" },
    anaOutcomes:     { icon: "&#128227;", iconBg: "#fbf3e3", title: "Outcomes &amp; marketing",   sub: "patient satisfaction",        color: "#c2680f", src: "anaOutcomesBody",  re: /(\d{1,3}%)/, fallback: "Open" },
    anaAsk:          { icon: "&#128270;", iconBg: "#f3eefb", title: "Ask your data",              sub: "volumes, trends, coding",     color: "#7c3aed", label: "Query", premium: true },
    anaBaseline:     { icon: "&#128200;", iconBg: "#e7f5ee", title: "Baseline metrics",           sub: "wRVU and visit counts",       color: "#0f2540", src: "anaBaselineBody",  re: /([\d.]+)\s*wRVU/i, fallback: "Open" },
    anaDoctorReview: { icon: "&#128202;", iconBg: "#eef3fb", title: "Doctor analysis &amp; review", sub: "per-provider AI feedback",  color: "#2f6bed", label: "Review" },
    anaTeamGrades:   { icon: "&#127775;", iconBg: "#fef6e0", title: "Patient-experience ratings", sub: "graded visits",               color: "#1f7d5c", src: "anaTeamGradesBody", re: /([\d.]+\s*\/\s*5)/, fallback: "Open" },
    anaReferral:     { icon: "&#129309;", iconBg: "#fef6e0", title: "Referral outcomes",          sub: "close the loop",              color: "#7c3aed", label: "Report", premium: true },
    anaRegistry:     { icon: "&#128203;", iconBg: "#eef3fb", title: "Outcomes registry",          sub: "pain &amp; ODI trajectory",   color: "#7c3aed", label: "Build", premium: true },
    anaRwe:          { icon: "&#128300;", iconBg: "#e7f5ee", title: "Research registry",          sub: "de-identified outcomes",      color: "#7c3aed", label: "Export" },
    mlsRvuProd:      { icon: "&#128202;", iconBg: "#e7f5ee", title: "RVU Productivity",           sub: "from signed visits",          color: "#7c3aed", label: "wRVU", premium: true }
  };
  var PREF = ["mlsProcReport", "anaKeyTrends", "anaOutcomes", "anaAsk", "anaBaseline", "anaDoctorReview", "anaTeamGrades", "anaReferral", "anaRegistry", "anaRwe", "mlsRvuProd"];

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
    return { icon: "&#128202;", iconBg: "#eef3fb", title: cleanTitle(card), sub: "", color: "#0f2540", label: "Open" };
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
      "#analysisView." + GRID_CLASS + " .ax-title{grid-column:1 / -1;display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:2px 0 6px}",
      "#analysisView." + GRID_CLASS + " .ax-tile{position:relative;border-radius:18px;overflow:hidden;background:#fff;border:1px solid #e8edf3;box-shadow:0 1px 2px rgba(15,37,64,.04);transition:box-shadow .18s ease,transform .18s ease;min-width:0}",
      "#analysisView." + GRID_CLASS + " .ax-tile.ax-exp{border-color:#bcd6fb;box-shadow:0 18px 40px -20px rgba(13,33,56,.4)}",
      "#analysisView." + GRID_CLASS + " .ax-tile.ax-drag{opacity:.5;background:#eef5ff;box-shadow:inset 0 0 0 2px #9cc0f5}",
      "#analysisView." + GRID_CLASS + " .ax-tile.ax-over{box-shadow:inset 0 0 0 2px #2f6bed,0 12px 28px -16px rgba(47,107,237,.5);transform:translateY(-2px)}",
      "#analysisView." + GRID_CLASS + " .ax-prev{width:100%;height:100%;text-align:left;background:transparent;border:none;padding:20px;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;color:#0f2540}",
      "#analysisView." + GRID_CLASS + " .ax-body{display:flex;flex-direction:column;height:100%;min-height:0}",
      "#analysisView." + GRID_CLASS + " .ax-body > .card{border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;height:100%;overflow:auto;background:#fff!important}",
      "#analysisView." + GRID_CLASS + " .ax-grip{position:absolute;right:3px;bottom:3px;width:20px;height:20px;cursor:nwse-resize;display:flex;align-items:flex-end;justify-content:flex-end;padding:3px;z-index:5;color:#b9c6d6}",
      "#analysisView." + GRID_CLASS + " .ax-grip:hover{color:#2f6bed}",
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
    if (body && m.re) { var txt = (body.textContent || "").replace(/\s+/g, " "); var mm = m.re.exec(txt); if (mm && mm[1]) return { text: mm[1].replace(/\s*\/\s*/, "/"), isLabel: false }; }
    return { text: m.fallback || "Open", isLabel: true };
  }
  function buildPreview(prev, m) {
    var st = readStat(m);
    var prem = m.premium ? '<span style="font-size:9px;font-weight:700;letter-spacing:.04em;color:#fff;background:linear-gradient(135deg,#7c3aed,#a855f7);padding:3px 8px;border-radius:20px">PREMIUM</span>' : "";
    prev.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><span style="width:42px;height:42px;border-radius:11px;background:' + m.iconBg + ';display:flex;align-items:center;justify-content:center;font-size:19px">' + m.icon + '</span>' + prem + '</div>' +
      '<div style="font-weight:700;font-size:15px;letter-spacing:-.01em;margin-bottom:auto">' + m.title + '</div>' +
      '<div style="margin-top:12px"><div style="font-weight:800;font-size:' + (st.isLabel ? "18px" : "22px") + ';letter-spacing:-.01em;color:' + m.color + '">' + st.text + '</div>' + (m.sub ? '<div style="color:#9aa8bb;font-size:12px;margin-top:2px">' + m.sub + '</div>' : "") + '</div>' +
      '<div style="display:flex;align-items:center;gap:5px;color:#2f6bed;font-size:12.5px;font-weight:600;margin-top:13px">Expand &#10530;</div>';
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
      '<span style="width:38px;height:38px;border-radius:10px;background:#eef3fb;display:flex;align-items:center;justify-content:center;font-size:18px">&#128202;</span>' +
      '<h1 style="font-family:\'Newsreader\',Georgia,serif;font-weight:500;font-size:28px;letter-spacing:-.015em;margin:0">Analysis</h1>' +
      '<span style="color:#6b7d93;font-size:13.5px">&mdash; click a tile to expand &middot; drag to reorder &middot; drag the corner to resize</span>';
    v.insertBefore(t, v.firstChild);
  }

  function render() {
    var v = $("analysisView"); if (!v) return;
    v.classList.add(GRID_CLASS);
    ensureTitle();
    var list = cards(), byId = {}; list.forEach(function (c) { if (c.id) byId[c.id] = c; });
    var ids = Object.keys(byId), nc = colCount();
    order(ids).forEach(function (k) {
      var card = byId[k]; if (!card) return;
      var m = metaFor(card), tile = ensureTile(card);
      var body = tile.querySelector(".ax-body"), prev = tile.querySelector(".ax-prev");
      if (card.parentElement !== body) body.appendChild(card);
      var sz = sizeOf(k), exp = isExpanded(k);
      tile.style.gridColumn = "span " + clamp(sz.cols, 1, nc);
      tile.style.gridRow = "span " + clamp(sz.rows, 1, MAXROWS);
      tile.classList.toggle("ax-exp", exp);
      tile.classList.toggle("ax-over", _overKey === k && _dragKey && _dragKey !== k);
      tile.setAttribute("draggable", exp ? "false" : "true");
      if (exp) { prev.style.display = "none"; body.style.display = "flex"; card.style.display = ""; }
      else { buildPreview(prev, m); prev.style.display = "flex"; body.style.display = "none"; }
      v.appendChild(tile);
    });
    v.setAttribute("data-ax-built", VERSION);
  }

  function applyAll() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { injectCSS(); if ($("analysisView")) render(); } catch (e) {}
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
