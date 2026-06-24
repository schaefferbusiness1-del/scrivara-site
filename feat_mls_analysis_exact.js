/* feat_mls_analysis_exact.js  ->  window.__mlsAx  (Analysis page, design-exact rebuild)
 *  STAGING ONLY (loaded by mls-connect.staging.js; on prod, activated only via the
 *  prod-enable marker). Runtime-gated. Production app logic untouched.
 *
 *  WHAT IT DOES
 *    Rebuilds #analysisView into the design's RESIZABLE / DRAGGABLE WIDGET DASHBOARD
 *    (design_renders/ScribeFlow Analysis.dc.html): a 4-col grid of tiles. Each tile is
 *    COLLAPSED by default -> a compact preview (icon, title, a real headline stat read
 *    live from the app's own rendered data, a sub-label, and an "Expand" affordance).
 *    Click / resize a tile to EXPAND it in place -> it reveals the app's REAL card
 *    (real bodies, real data, real wired buttons), moved in BY ID. Drag a collapsed
 *    tile to reorder; drag the corner grip to resize (cols 1-4, rows 1-5). Order + sizes
 *    persist to localStorage 'mlsAxLayout'.
 *
 *    The design's logic (sizes{cols,rows}, expanded = cols>=2||rows>=3, toggle => 1x1 /
 *    4x3, pointer-resize math, drag-reorder of an order[] array) is ported verbatim to
 *    vanilla DOM. The real cards are MOVED into tile bodies (never cloned/deleted), which
 *    also cleanly hands layout ownership to this module: feat_mls_redesign.js's analysis
 *    grid keys off "#analysisView > .card" (now nested in tiles) so it self-disables.
 *
 *    No fabrication: collapsed stats are extracted from the app's already-rendered body
 *    text (real numbers the app computed); when a card is an action tool with no metric,
 *    a neutral verb label (Query / Report / Build / Review / Export) is shown -- not a
 *    statistic. The 3 design tiles with no app data source (Procedure, Scheduling, RVU)
 *    are intentionally omitted rather than fabricated.
 *
 *  Reversible: window.__mlsAx.revert() (returns every real card to #analysisView, no
 *  data loss). ASCII-only (emoji as HTML numeric entities). Idempotent. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "ax-2.0.0";
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

  /* --- design tiles, mapped onto the app's REAL #analysisView cards (by id) --- */
  var META = [
    { id: "anaKeyTrends",   key: "trends",    icon: "&#128204;", iconBg: "#fdecec", title: "Key trends at a glance",       sub: "active patients, top diagnosis", color: "#0f2540", src: "anaKeyTrendsBody", re: /([\d,]+)\s*(?:active\s*)?patient/i, fallback: "Open" },
    { id: "anaOutcomes",    key: "marketing", icon: "&#128227;", iconBg: "#fbf3e3", title: "Outcomes &amp; marketing",      sub: "patient satisfaction",           color: "#c2680f", src: "anaOutcomesBody",  re: /(\d{1,3}%)/,                       fallback: "Open" },
    { id: "anaRwe",         key: "research",  icon: "&#128300;", iconBg: "#e7f5ee", title: "Research registry",             sub: "de-identified outcomes",         color: "#7c3aed", label: "Export" },
    { id: "anaAsk",         key: "ask",       icon: "&#128270;", iconBg: "#f3eefb", title: "Ask your data",                 sub: "volumes, trends, coding",        color: "#7c3aed", label: "Query", premium: true },
    { id: "anaBaseline",    key: "baseline",  icon: "&#128200;", iconBg: "#e7f5ee", title: "Baseline metrics",              sub: "wRVU and visit counts",          color: "#0f2540", src: "anaBaselineBody",  re: /([\d.]+)\s*wRVU/i, fallback: "Open" },
    { id: "anaDoctorReview",key: "doctor",    icon: "&#128202;", iconBg: "#eef3fb", title: "Doctor analysis &amp; review",  sub: "per-provider AI feedback",       color: "#2f6bed", label: "Review" },
    { id: "anaTeamGrades",  key: "ratings",   icon: "&#127775;", iconBg: "#fef6e0", title: "Patient-experience ratings",    sub: "graded visits",                  color: "#1f7d5c", src: "anaTeamGradesBody", re: /([\d.]+\s*\/\s*5)/, fallback: "Open" },
    { id: "anaReferral",    key: "referral",  icon: "&#129309;", iconBg: "#fef6e0", title: "Referral outcomes",             sub: "close the loop",                 color: "#7c3aed", label: "Report", premium: true },
    { id: "anaRegistry",    key: "registry",  icon: "&#128203;", iconBg: "#eef3fb", title: "Outcomes registry",             sub: "pain &amp; ODI trajectory",      color: "#7c3aed", label: "Build", premium: true }
  ];
  var METABYKEY = {}; META.forEach(function (m) { METABYKEY[m.key] = m; });
  var DEFORDER = META.map(function (m) { return m.key; });

  /* ---------- persisted layout ---------- */
  var STATE = { order: null, sizes: {} };
  function load() { try { var o = JSON.parse(localStorage.getItem(LS) || "{}"); if (o && typeof o === "object") { STATE.order = Array.isArray(o.order) ? o.order : null; STATE.sizes = o.sizes && typeof o.sizes === "object" ? o.sizes : {}; } } catch (e) {} }
  function save() { try { localStorage.setItem(LS, JSON.stringify({ order: order(), sizes: STATE.sizes })); } catch (e) {} }
  function order() {
    var base = (STATE.order && STATE.order.length) ? STATE.order.slice() : DEFORDER.slice();
    /* keep only known keys, then append any missing (robust to add/remove) */
    var seen = {}, out = [];
    base.forEach(function (k) { if (METABYKEY[k] && !seen[k]) { seen[k] = 1; out.push(k); } });
    DEFORDER.forEach(function (k) { if (!seen[k]) { seen[k] = 1; out.push(k); } });
    return out;
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
      "#analysisView." + GRID_CLASS + " .ax-body .card{border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;height:100%;overflow:auto;background:#fff!important}",
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
    if (body && m.re) {
      var txt = (body.textContent || "").replace(/\s+/g, " ");
      var mm = m.re.exec(txt);
      if (mm && mm[1]) return { text: mm[1].replace(/\s*\/\s*/, "/"), isLabel: false };
    }
    return { text: m.fallback || "Open", isLabel: true };
  }

  function buildPreview(prev, m) {
    var st = readStat(m);
    var prem = m.premium
      ? '<span style="font-size:9px;font-weight:700;letter-spacing:.04em;color:#fff;background:linear-gradient(135deg,#7c3aed,#a855f7);padding:3px 8px;border-radius:20px">PREMIUM</span>'
      : "";
    prev.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
        '<span style="width:42px;height:42px;border-radius:11px;background:' + m.iconBg + ';display:flex;align-items:center;justify-content:center;font-size:19px">' + m.icon + '</span>' + prem +
      '</div>' +
      '<div style="font-weight:700;font-size:15px;letter-spacing:-.01em;margin-bottom:auto">' + m.title + '</div>' +
      '<div style="margin-top:12px">' +
        '<div style="font-weight:800;font-size:' + (st.isLabel ? "18px" : "22px") + ';letter-spacing:-.01em;color:' + m.color + '">' + st.text + '</div>' +
        '<div style="color:#9aa8bb;font-size:12px;margin-top:2px">' + m.sub + '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:5px;color:#2f6bed;font-size:12.5px;font-weight:600;margin-top:13px">Expand &#10530;</div>';
  }

  function toggle(k) {
    if (isExpanded(k)) { STATE.sizes[k] = { cols: 1, rows: 1 }; }
    else { var nc = colCount(); STATE.sizes[k] = { cols: Math.min(4, nc), rows: 3 }; }
    save(); render();
  }

  function startResize(k, e) {
    e.preventDefault(); e.stopPropagation();
    var grid = $("analysisView"); if (!grid) return;
    var rect = grid.getBoundingClientRect();
    var nc = colCount();
    var cellW = (rect.width - GAP * (nc - 1)) / nc;
    var sx = e.clientX, sy = e.clientY, start = sizeOf(k);
    function move(ev) {
      var dc = Math.round((ev.clientX - sx) / (cellW + GAP));
      var dr = Math.round((ev.clientY - sy) / (ROWH + GAP));
      STATE.sizes[k] = { cols: clamp(start.cols + dc, 1, nc), rows: clamp(start.rows + dr, 1, MAXROWS) };
      render();
    }
    function up() { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); save(); }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  function reorderTo(targetKey) {
    if (!_dragKey || _dragKey === targetKey) return;
    var o = order(), from = o.indexOf(_dragKey), to = o.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    o.splice(from, 1); o.splice(to, 0, _dragKey);
    STATE.order = o; render();
  }

  function ensureTile(m) {
    var v = $("analysisView");
    var tile = v.querySelector('.ax-tile[data-ax-key="' + m.key + '"]');
    if (tile) return tile;
    tile = mk("div"); tile.className = "ax-tile"; tile.setAttribute("data-ax-key", m.key);

    var prev = mk("button"); prev.className = "ax-prev"; prev.type = "button";
    prev.addEventListener("click", function () { toggle(m.key); });
    tile.appendChild(prev);

    var body = mk("div"); body.className = "ax-body"; tile.appendChild(body);

    var grip = mk("div", null, '<svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M9 3 3 9M9 7l-2 2"/></svg>');
    grip.className = "ax-grip"; grip.title = "Drag to resize";
    grip.addEventListener("pointerdown", function (e) { startResize(m.key, e); });
    tile.appendChild(grip);

    /* drag-to-reorder (collapsed only) */
    tile.addEventListener("dragstart", function (e) {
      if (isExpanded(m.key)) { e.preventDefault(); return; }
      _dragKey = m.key; try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", m.key); } catch (x) {}
      tile.classList.add("ax-drag");
    });
    tile.addEventListener("dragover", function (e) { e.preventDefault(); if (_overKey !== m.key) { _overKey = m.key; } reorderTo(m.key); });
    tile.addEventListener("drop", function (e) { e.preventDefault(); _dragKey = null; _overKey = null; save(); render(); });
    tile.addEventListener("dragend", function () { _dragKey = null; _overKey = null; tile.classList.remove("ax-drag"); render(); });

    v.appendChild(tile);
    return tile;
  }

  function ensureTitle() {
    var v = $("analysisView");
    var t = v.querySelector(":scope > .ax-title");
    if (t) return;
    t = mk("div"); t.className = "ax-title";
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
    var nc = colCount();
    order().forEach(function (k) {
      var m = METABYKEY[k]; if (!m) return;
      var card = $(m.id); if (!card) return;
      var tile = ensureTile(m);
      var body = tile.querySelector(".ax-body");
      var prev = tile.querySelector(".ax-prev");
      /* move the real card into the tile body (by reference; never cloned/deleted) */
      if (card.parentElement !== body) body.appendChild(card);
      var sz = sizeOf(k), exp = isExpanded(k);
      var cols = clamp(sz.cols, 1, nc), rows = clamp(sz.rows, 1, MAXROWS);
      tile.style.gridColumn = "span " + cols;
      tile.style.gridRow = "span " + rows;
      tile.classList.toggle("ax-exp", exp);
      tile.classList.toggle("ax-over", _overKey === k && _dragKey && _dragKey !== k);
      tile.setAttribute("draggable", exp ? "false" : "true");
      if (exp) {
        prev.style.display = "none";
        body.style.display = "flex";
        card.style.display = "";
      } else {
        buildPreview(prev, m);
        prev.style.display = "flex";
        body.style.display = "none";
      }
      /* keep DOM order matching layout order */
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
      META.forEach(function (m) { var card = $(m.id); if (card) v.appendChild(card); /* back to direct child */ });
      Array.prototype.slice.call(v.querySelectorAll(".ax-tile, .ax-title")).forEach(function (n) { n.remove(); });
      v.classList.remove(GRID_CLASS);
      META.forEach(function (m) { var c = $(m.id); if (c) { c.style.display = ""; } });
    }
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { window.__mlsAx.installed = false; } catch (e) {}
  }

  window.__mlsAx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: applyAll };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
