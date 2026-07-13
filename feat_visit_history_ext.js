/* feat_visit_history_ext.js — MLS ScribeFlow
 * EXTENDED visit-history UI for each patient (builds ON TOP of §40 model +
 * §45/§47 detail card — does NOT replace or fork them).
 *
 * What this asset adds, above the existing per-visit model (window.__mlsVisitModel,
 * patient.visits[]) and the existing flat "🗂 Visit history" list (__mlsVisitUI):
 *   1) TIMELINE   — visits grouped by year -> month, newest first, each a clean
 *                   scannable card (date · type/procedure · key dx + CPT · 1-line
 *                   summary). Clicking a card opens the EXISTING polished detail
 *                   view (window.__mlsVisitNoteDetail.openModelVisit) — reused,
 *                   never re-implemented.
 *   2) OVERVIEW   — header above the timeline: total visits, date range
 *                   (first -> last), most common procedures + diagnoses, and a
 *                   small sparkline of pain (VAS/NRS 0-10) and function (ODI
 *                   0-100%) across visits over time. Scores pulled from the visit
 *                   model only; a visit missing a score is skipped gracefully.
 *   3) CONTROLS   — instant client-side filter (date range, procedure/type,
 *                   diagnosis), free-text search across visit content, and sort
 *                   (newest / oldest).
 *   4) SCANNABLE  — colour + icon per visit type (injection / procedure / office /
 *                   imaging), app design tokens, dark --ink text on light (no
 *                   white-on-white), responsive at narrow widths.
 *
 * Approach (non-destructive, fully reversible):
 *   - The original __mlsVisitUI section (#mlsVisitHistory) is kept in the DOM but
 *     hidden; this module renders a parallel #mlsVisitHistoryExt in its place. The
 *     base module keeps running harmlessly behind it. Nothing in feat_visits.js /
 *     feat_visit_detail.js / feat_visit_note_detail.js is modified.
 *   - Clicks delegate to the EXISTING detail modal, so inline edit, regenerate,
 *     "edit raw note", and non-destructive persistence are all inherited.
 *   - REAL data only: everything is read from patient.visits[]; no visit, score,
 *     or trend point is ever fabricated. Empty patients get a clean empty state.
 *   - Progressive enhancement: own scope, try/catch, idempotent, reversible via
 *     window.__mlsVisitHistoryExt.revert(). No backend / ScribeFlow.html / loader
 *     bundle edits beyond the one guarded loader line.
 */
(function () {
  "use strict";
  if (window.__mlsVisitHistoryExt && window.__mlsVisitHistoryExt.installed) return;

  var VERSION = "1.0.0";
  var isFn = function (f) { return typeof f === "function"; };
  var S = function (x) { return x == null ? "" : String(x); };
  var trim = function (x) { return S(x).trim(); };

  /* ---- live dependency accessors (read each call; load order irrelevant) ---- */
  function MODEL() { return window.__mlsVisitModel; }
  function DETAIL() { return window.__mlsVisitDetail; }
  function NOTE() { return window.__mlsVisitNoteDetail; }
  function activeP() { try { return isFn(window.activePatient) ? window.activePatient() : null; } catch (e) { return null; } }

  function esc(s) {
    return S(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(d) {
    try { var D = DETAIL(); if (D && isFn(D._fmtDate)) return D._fmtDate(d); } catch (e) {}
    return S(d) || "(undated)";
  }
  function ymd(d) {
    try { var M = MODEL(); if (M && isFn(M._svcToYMD)) return M._svcToYMD(d) || ""; } catch (e) {}
    var m = S(d).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : "";
  }
  var MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

  /* ---- visit-type classification (colour + icon, for scannability) ---- */
  function classify(v) {
    var t = (S(v.type) + " " + S(v.raw)).toLowerCase();
    if (/inject|tfesi|\besi\b|epidural|\bblock\b|facet|\brfa\b|ablation|rhizotom|trigger ?point|denervation|medial branch/.test(t))
      return { key: "injection", label: "Injection", icon: "💉", color: "#7A5CC0", tint: "rgba(124,58,237,.10)" };
    if (/mri|x-?ray|ct scan|ultrasound|imaging|radiograph|emg|ncs/.test(t))
      return { key: "imaging", label: "Imaging / study", icon: "🖼️", color: "#2E6A4B", tint: "rgba(8,145,178,.10)" };
    if (/operat|surg|implant|\bstim\b|kyphoplast|discectomy|fusion|procedure performed|pump/.test(t))
      return { key: "procedure", label: "Procedure", icon: "🛠️", color: "#a87d0a", tint: "rgba(168,125,10,.12)" };
    if (/office|follow|consult|new patient|established|e\/m|telehealth|evaluation|visit|exam/.test(t))
      return { key: "office", label: "Office visit", icon: "🩺", color: "#2E6A4B", tint: "rgba(37,99,201,.09)" };
    return { key: "other", label: "Visit", icon: "📄", color: "#79837C", tint: "rgba(91,107,126,.10)" };
  }

  /* ---- score extraction (REAL data only; never invents a point) ---- */
  function firstNum(val) {
    if (val == null) return null;
    if (typeof val === "number") return isFinite(val) ? val : null;
    var m = S(val).match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function scoreByKeys(scores, prefer, re, lo, hi) {
    if (!scores || typeof scores !== "object") return null;
    var k, n;
    for (var i = 0; i < prefer.length; i++) {
      if (Object.prototype.hasOwnProperty.call(scores, prefer[i])) {
        n = firstNum(scores[prefer[i]]); if (n != null) return clamp(n, lo, hi);
      }
    }
    var keys = Object.keys(scores);
    for (k = 0; k < keys.length; k++) {
      if (re.test(keys[k])) { n = firstNum(scores[keys[k]]); if (n != null) return clamp(n, lo, hi); }
    }
    return null;
  }
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
  function painOf(v) { return scoreByKeys(v.scores, ["VAS", "NRS"], /vas|nrs|pain/i, 0, 10); }
  function funcOf(v) { return scoreByKeys(v.scores, ["ODI"], /odi|oswestry|function|disab/i, 0, 100); }

  /* ---- overview computations (all from real visits) ---- */
  function tallyTop(items, n) {
    var map = {}, order = [];
    items.forEach(function (raw) {
      var key = trim(raw); if (!key) return;
      var k = key.toLowerCase();
      if (!map[k]) { map[k] = { label: key, count: 0 }; order.push(k); }
      map[k].count++;
    });
    return order.map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, n || 3);
  }
  function computeOverview(visits) {
    var dated = visits.filter(function (v) { return !!ymd(v.date); });
    var sortedAsc = dated.slice().sort(function (a, b) { return ymd(a.date).localeCompare(ymd(b.date)); });
    var types = [], dx = [];
    visits.forEach(function (v) {
      if (trim(v.type)) types.push(trim(v.type));
      (v.icd10 || []).forEach(function (c) { if (trim(c)) dx.push(trim(c)); });
    });
    // trend series, oldest -> newest, only points that exist
    var pain = [], fun = [];
    sortedAsc.forEach(function (v) {
      var p = painOf(v), f = funcOf(v);
      if (p != null) pain.push({ date: ymd(v.date), val: p });
      if (f != null) fun.push({ date: ymd(v.date), val: f });
    });
    return {
      total: visits.length,
      first: sortedAsc.length ? sortedAsc[0].date : "",
      last: sortedAsc.length ? sortedAsc[sortedAsc.length - 1].date : "",
      topTypes: tallyTop(types, 3),
      topDx: tallyTop(dx, 3),
      pain: pain,
      fun: fun
    };
  }

  /* ---- sparkline (inline SVG; strong-contrast lines) ---- */
  function sparkline(series, lo, hi, color, w, h) {
    w = w || 150; h = h || 34; var pad = 3;
    if (!series || series.length < 2) return null;
    var n = series.length;
    var xs = function (i) { return pad + (i * (w - 2 * pad)) / (n - 1); };
    var ys = function (val) { return pad + (1 - (clamp(val, lo, hi) - lo) / (hi - lo)) * (h - 2 * pad); };
    var d = series.map(function (pt, i) { return (i ? "L" : "M") + xs(i).toFixed(1) + " " + ys(pt.val).toFixed(1); }).join(" ");
    var svg = '<svg class="mlsxh-spark" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    var last = series[n - 1];
    svg += '<circle cx="' + xs(n - 1).toFixed(1) + '" cy="' + ys(last.val).toFixed(1) + '" r="2.6" fill="' + color + '"/>';
    svg += "</svg>";
    return svg;
  }

  /* ---- styles ---- */
  function injectStyle() {
    if (document.getElementById("mls-xh-style")) return;
    var css = [
      "#mlsVisitHistory{display:none !important}", // hide the base flat list; we render the rich version
      "#mlsVisitHistoryExt{margin-top:14px;color:var(--ink,#1A211C)}",
      "#mlsVisitHistoryExt .mlsxh-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:0 0 10px}",
      "#mlsVisitHistoryExt .mlsxh-title{font-weight:800;font-size:14px;display:flex;align-items:center;gap:7px;color:var(--ink,#1A211C)}",
      "#mlsVisitHistoryExt .mlsxh-count{font-weight:600;color:var(--muted,#79837C);font-size:12px}",
      "#mlsVisitHistoryExt .mlsxh-btn{cursor:pointer;border:1px solid var(--line,#E7E5DD);background:var(--card,#fff);border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700;color:var(--ink,#1A211C)}",
      "#mlsVisitHistoryExt .mlsxh-btn:hover{background:var(--soft,#EAF1EE)}",
      "#mlsVisitHistoryExt .mlsxh-btn[disabled]{opacity:.55;cursor:default}",
      /* overview */
      "#mlsVisitHistoryExt .mlsxh-ov{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 12px}",
      "#mlsVisitHistoryExt .mlsxh-stat{flex:1 1 150px;min-width:150px;background:var(--soft,#EAF1EE);border:1px solid var(--line,#E7E5DD);border-radius:12px;padding:10px 12px}",
      "#mlsVisitHistoryExt .mlsxh-stat .k{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#79837C);margin:0 0 4px}",
      "#mlsVisitHistoryExt .mlsxh-stat .val{font-size:14px;font-weight:700;color:var(--ink,#1A211C);line-height:1.35}",
      "#mlsVisitHistoryExt .mlsxh-stat .sub{font-size:11.5px;font-weight:600;color:var(--muted,#79837C);margin-top:2px}",
      "#mlsVisitHistoryExt .mlsxh-trend{flex:2 1 280px;min-width:240px;background:var(--card,#fff);border:1px solid var(--line,#E7E5DD);border-radius:12px;padding:10px 12px}",
      "#mlsVisitHistoryExt .mlsxh-trend .k{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#79837C);margin:0 0 6px}",
      "#mlsVisitHistoryExt .mlsxh-trow{display:flex;align-items:center;gap:10px;margin:4px 0}",
      "#mlsVisitHistoryExt .mlsxh-tlab{font-size:11.5px;font-weight:700;min-width:118px;display:flex;align-items:center;gap:6px;color:var(--ink,#1A211C)}",
      "#mlsVisitHistoryExt .mlsxh-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}",
      "#mlsVisitHistoryExt .mlsxh-spark{flex:1 1 auto;height:34px}",
      "#mlsVisitHistoryExt .mlsxh-tval{font-size:12px;font-weight:800;min-width:66px;text-align:right;color:var(--ink,#1A211C)}",
      "#mlsVisitHistoryExt .mlsxh-tval .d{font-size:10.5px;font-weight:700;margin-left:3px}",
      "#mlsVisitHistoryExt .mlsxh-tnone{font-size:11.5px;color:var(--muted,#79837C);font-weight:600}",
      /* controls */
      "#mlsVisitHistoryExt .mlsxh-ctrls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}",
      "#mlsVisitHistoryExt .mlsxh-ctrls input,#mlsVisitHistoryExt .mlsxh-ctrls select{font:inherit;font-size:12.5px;color:var(--ink,#1A211C);background:var(--card,#fff);border:1px solid var(--line,#E7E5DD);border-radius:8px;padding:6px 9px;min-height:32px}",
      "#mlsVisitHistoryExt .mlsxh-search{flex:2 1 200px;min-width:150px}",
      "#mlsVisitHistoryExt .mlsxh-ctrls select{flex:1 1 130px}",
      "#mlsVisitHistoryExt .mlsxh-date{flex:1 1 130px}",
      "#mlsVisitHistoryExt .mlsxh-clear{cursor:pointer;border:1px solid var(--line,#E7E5DD);background:var(--card,#fff);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;color:var(--muted,#79837C)}",
      "#mlsVisitHistoryExt .mlsxh-clear:hover{color:var(--ink,#1A211C);background:var(--soft,#EAF1EE)}",
      /* timeline */
      "#mlsVisitHistoryExt .mlsxh-year{font-weight:800;font-size:13px;color:var(--ink,#1A211C);margin:14px 0 2px;padding-bottom:4px;border-bottom:2px solid var(--line,#E7E5DD)}",
      "#mlsVisitHistoryExt .mlsxh-month{font-weight:700;font-size:11.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--muted,#79837C);margin:10px 0 6px}",
      "#mlsVisitHistoryExt .mlsxh-card{display:flex;gap:11px;align-items:flex-start;border:1px solid var(--line,#E7E5DD);border-left:4px solid var(--muted,#79837C);border-radius:11px;background:var(--card,#fff);padding:10px 12px;margin:0 0 8px;cursor:pointer;transition:box-shadow .12s,transform .12s}",
      "#mlsVisitHistoryExt .mlsxh-card:hover{box-shadow:0 4px 14px rgba(15,28,46,.10);transform:translateY(-1px)}",
      "#mlsVisitHistoryExt .mlsxh-ico{flex:0 0 auto;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;margin-top:1px}",
      "#mlsVisitHistoryExt .mlsxh-main{flex:1 1 auto;min-width:0}",
      "#mlsVisitHistoryExt .mlsxh-r1{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}",
      "#mlsVisitHistoryExt .mlsxh-cdate{font-weight:800;font-size:13px;color:var(--ink,#1A211C)}",
      "#mlsVisitHistoryExt .mlsxh-ctype{font-size:12.5px;font-weight:600;color:var(--ink,#1A211C);opacity:.92}",
      "#mlsVisitHistoryExt .mlsxh-tag{font-size:10px;font-weight:800;border-radius:999px;padding:1px 7px}",
      "#mlsVisitHistoryExt .mlsxh-pills{display:flex;flex-wrap:wrap;gap:5px;margin:5px 0 0}",
      "#mlsVisitHistoryExt .mlsxh-pill{font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 7px;white-space:nowrap}",
      "#mlsVisitHistoryExt .mlsxh-pill.dx{background:rgba(168,125,10,.13);color:#7a5a06}",
      "#mlsVisitHistoryExt .mlsxh-pill.cpt{background:rgba(15,138,99,.13);color:#0b6b4d}",
      "#mlsVisitHistoryExt .mlsxh-pill.score{background:rgba(37,99,201,.11);color:#204034}",
      "#mlsVisitHistoryExt .mlsxh-sum{font-size:12px;line-height:1.45;color:var(--muted,#79837C);margin:6px 0 0;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}",
      "#mlsVisitHistoryExt .mlsxh-sum.pending{font-style:italic;opacity:.8}",
      "#mlsVisitHistoryExt .mlsxh-chev{flex:0 0 auto;color:var(--muted,#79837C);font-size:13px;align-self:center}",
      /* empty */
      "#mlsVisitHistoryExt .mlsxh-empty{border:1px dashed var(--line,#E7E5DD);border-radius:12px;padding:20px 16px;text-align:center;color:var(--muted,#79837C)}",
      "#mlsVisitHistoryExt .mlsxh-empty .t{font-size:13px;font-weight:700;color:var(--ink,#1A211C);margin:0 0 4px}",
      "#mlsVisitHistoryExt .mlsxh-empty .acts{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px}",
      "#mlsVisitHistoryExt .mlsxh-status{font-size:12px;color:var(--muted,#79837C);margin:0 0 8px}",
      "@media (max-width:560px){#mlsVisitHistoryExt .mlsxh-tlab{min-width:96px}#mlsVisitHistoryExt .mlsxh-stat{flex-basis:120px;min-width:120px}}"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "mls-xh-style";
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---- per-patient filter/sort state (preserved across re-renders) ---- */
  var state = {};
  function stateFor(pid) {
    if (!state[pid]) state[pid] = { q: "", type: "", dx: "", from: "", to: "", sort: "newest" };
    return state[pid];
  }

  /* ---- filtering ---- */
  function applyFilters(visits, f) {
    var q = trim(f.q).toLowerCase();
    var typ = trim(f.type).toLowerCase();
    var dx = trim(f.dx).toLowerCase();
    var from = trim(f.from), to = trim(f.to);
    return visits.filter(function (v) {
      var d = ymd(v.date);
      if (from && (!d || d < from)) return false;
      if (to && (!d || d > to)) return false;
      if (typ && S(v.type).toLowerCase().indexOf(typ) < 0) return false;
      if (dx) {
        var hit = (v.icd10 || []).some(function (c) { return S(c).toLowerCase().indexOf(dx) >= 0; });
        if (!hit) return false;
      }
      if (q) {
        var hay = [v.date, v.type, (v.cpt || []).join(" "), (v.icd10 || []).join(" "),
          (v.meds || []).join(" "), v.findings, v.plan, v.raw, v.aiSummary].join("  ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sortVisits(visits, sort) {
    var arr = visits.slice();
    arr.sort(function (a, b) {
      var da = ymd(a.date), db = ymd(b.date);
      if (da && db) return sort === "oldest" ? da.localeCompare(db) : db.localeCompare(da);
      if (da) return -1; if (db) return 1; return 0;
    });
    return arr;
  }

  /* ---- card ---- */
  function summaryLine(v) {
    var s = trim(v.aiSummary);
    if (s) return { text: s.replace(/\s*\n+\s*/g, " · ").slice(0, 200), pending: false };
    var f = trim(v.findings) || trim(v.plan) || trim(v.raw);
    if (f) return { text: f.replace(/\s*\n+\s*/g, " · ").slice(0, 200), pending: false };
    return { text: "AI summary pending — click to view & generate", pending: true };
  }
  function makeCard(p, v) {
    var c = classify(v);
    var card = document.createElement("div");
    card.className = "mlsxh-card";
    card.setAttribute("data-vid", S(v.id));
    card.style.borderLeftColor = c.color;

    var ico = document.createElement("div");
    ico.className = "mlsxh-ico";
    ico.style.background = c.tint;
    ico.textContent = c.icon;
    card.appendChild(ico);

    var main = document.createElement("div");
    main.className = "mlsxh-main";

    var r1 = document.createElement("div");
    r1.className = "mlsxh-r1";
    var dt = document.createElement("span"); dt.className = "mlsxh-cdate"; dt.textContent = fmtDate(v.date);
    var ty = document.createElement("span"); ty.className = "mlsxh-ctype"; ty.textContent = trim(v.type) || c.label;
    var tag = document.createElement("span"); tag.className = "mlsxh-tag";
    tag.textContent = c.icon + " " + c.label; tag.style.background = c.tint; tag.style.color = c.color;
    r1.appendChild(dt); r1.appendChild(ty); r1.appendChild(tag);
    main.appendChild(r1);

    var pills = document.createElement("div"); pills.className = "mlsxh-pills";
    (v.icd10 || []).slice(0, 3).forEach(function (code) {
      var s = document.createElement("span"); s.className = "mlsxh-pill dx"; s.textContent = code; pills.appendChild(s);
    });
    (v.cpt || []).slice(0, 3).forEach(function (code) {
      var s = document.createElement("span"); s.className = "mlsxh-pill cpt"; s.textContent = code; pills.appendChild(s);
    });
    var pn = painOf(v), fn = funcOf(v);
    if (pn != null) { var sp = document.createElement("span"); sp.className = "mlsxh-pill score"; sp.textContent = "Pain " + pn + "/10"; pills.appendChild(sp); }
    if (fn != null) { var sf = document.createElement("span"); sf.className = "mlsxh-pill score"; sf.textContent = "ODI " + fn + "%"; pills.appendChild(sf); }
    if (pills.childNodes.length) main.appendChild(pills);

    var sl = summaryLine(v);
    var sum = document.createElement("div"); sum.className = "mlsxh-sum" + (sl.pending ? " pending" : "");
    sum.textContent = sl.text;
    main.appendChild(sum);

    card.appendChild(main);
    var chev = document.createElement("div"); chev.className = "mlsxh-chev"; chev.textContent = "›";
    card.appendChild(chev);

    card.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); openDetail(p, v); });
    return card;
  }

  /* ---- open the EXISTING polished detail card (reuse, never fork) ---- */
  function openDetail(p, v) {
    var N = NOTE();
    if (N && isFn(N.openModelVisit)) { try { N.openModelVisit(p, v); return; } catch (e) {} }
    // graceful fallback: reveal the base hidden card and toggle it open
    try {
      var base = document.getElementById("mlsVisitHistory");
      if (base) {
        var bc = base.querySelector('[data-vid="' + (window.CSS && CSS.escape ? CSS.escape(S(v.id)) : S(v.id)) + '"]');
        if (bc) { var h = bc.querySelector(".mlsvh-vh, .mlsvd-head"); if (h) h.click(); }
      }
    } catch (e) {}
  }

  /* ---- render the timeline list into a container (cheap; controls preserved) ---- */
  function renderList(listEl, p, visits, f, statusEl) {
    listEl.innerHTML = "";
    var filtered = sortVisits(applyFilters(visits, f), f.sort);
    if (statusEl) {
      statusEl.textContent = filtered.length === visits.length
        ? ""
        : "Showing " + filtered.length + " of " + visits.length + " visit" + (visits.length === 1 ? "" : "s");
    }
    if (!filtered.length) {
      var none = document.createElement("div"); none.className = "mlsxh-empty";
      var t = document.createElement("div"); t.className = "t"; t.textContent = "No visits match these filters";
      none.appendChild(t);
      var acts = document.createElement("div"); acts.className = "acts";
      var clr = document.createElement("button"); clr.className = "mlsxh-btn"; clr.textContent = "Clear filters";
      clr.addEventListener("click", function () { resetFilters(p.id); rebuild(true); });
      acts.appendChild(clr); none.appendChild(acts);
      listEl.appendChild(none);
      return;
    }
    // group by year -> month, in the chosen sort order
    var curYear = null, curMonth = null, monthBox = null;
    filtered.forEach(function (v) {
      var d = ymd(v.date);
      var year = d ? d.slice(0, 4) : "Undated";
      var monthKey = d ? d.slice(0, 7) : "Undated";
      if (year !== curYear) {
        curYear = year; curMonth = null;
        var yh = document.createElement("div"); yh.className = "mlsxh-year"; yh.textContent = year;
        listEl.appendChild(yh);
      }
      if (monthKey !== curMonth) {
        curMonth = monthKey;
        var mh = document.createElement("div"); mh.className = "mlsxh-month";
        mh.textContent = d ? MONTHS[parseInt(d.slice(5, 7), 10) - 1] + " " + d.slice(0, 4) : "Undated";
        listEl.appendChild(mh);
        monthBox = listEl;
      }
      listEl.appendChild(makeCard(p, v));
    });
  }

  function resetFilters(pid) { state[pid] = { q: "", type: "", dx: "", from: "", to: "", sort: "newest" }; }

  /* ---- build overview block ---- */
  function buildOverview(visits) {
    var ov = computeOverview(visits);
    var wrap = document.createElement("div"); wrap.className = "mlsxh-ov";

    function stat(k, valHtml, sub) {
      var d = document.createElement("div"); d.className = "mlsxh-stat";
      d.innerHTML = '<div class="k">' + esc(k) + '</div><div class="val">' + valHtml + "</div>" +
        (sub ? '<div class="sub">' + esc(sub) + "</div>" : "");
      return d;
    }
    wrap.appendChild(stat("Total visits", String(ov.total),
      ov.first ? "since " + fmtDate(ov.first) : ""));
    wrap.appendChild(stat("Date range",
      ov.first ? esc(fmtDate(ov.first)) + ' <span style="color:var(--muted,#79837C)">→</span> ' + esc(fmtDate(ov.last)) : "—",
      ov.first ? "" : "no dated visits"));
    wrap.appendChild(stat("Top procedures",
      ov.topTypes.length ? ov.topTypes.map(function (t) { return esc(t.label) + ' <span style="color:var(--muted,#79837C)">×' + t.count + "</span>"; }).join("<br>") : "—"));
    wrap.appendChild(stat("Common diagnoses",
      ov.topDx.length ? ov.topDx.map(function (t) { return esc(t.label) + ' <span style="color:var(--muted,#79837C)">×' + t.count + "</span>"; }).join("<br>") : "—"));

    // trend panel
    var tr = document.createElement("div"); tr.className = "mlsxh-trend";
    tr.appendChild(elHTML('<div class="k">Pain &amp; function over time</div>'));
    tr.appendChild(trendRow("Pain (VAS/NRS)", "#dc2626", ov.pain, 0, 10, "/10"));
    tr.appendChild(trendRow("Function (ODI)", "#2E6A4B", ov.fun, 0, 100, "%"));
    wrap.appendChild(tr);
    return wrap;
  }
  function elHTML(h) { var d = document.createElement("div"); d.innerHTML = h; return d.firstChild; }
  function trendRow(label, color, series, lo, hi, unit) {
    var row = document.createElement("div"); row.className = "mlsxh-trow";
    var lab = document.createElement("div"); lab.className = "mlsxh-tlab";
    lab.innerHTML = '<span class="mlsxh-dot" style="background:' + color + '"></span>' + esc(label);
    row.appendChild(lab);
    var spk = sparkline(series, lo, hi, color);
    if (spk) {
      var holder = document.createElement("div"); holder.style.flex = "1 1 auto"; holder.innerHTML = spk;
      row.appendChild(holder);
      var last = series[series.length - 1], first = series[0];
      var delta = last.val - first.val;
      var arrow = delta === 0 ? "→" : (delta < 0 ? "↓" : "↑");
      // for pain & ODI, lower is better -> green when down
      var good = delta < 0, dColor = delta === 0 ? "var(--muted,#79837C)" : (good ? "#2E6A4B" : "#dc2626");
      var val = document.createElement("div"); val.className = "mlsxh-tval";
      val.innerHTML = esc(String(last.val)) + esc(unit) +
        ' <span class="d" style="color:' + dColor + '">' + arrow + Math.abs(delta).toFixed(delta % 1 ? 1 : 0) + "</span>";
      row.appendChild(val);
    } else if (series && series.length === 1) {
      var one = document.createElement("div"); one.className = "mlsxh-tval";
      one.textContent = series[0].val + unit;
      var note = document.createElement("div"); note.className = "mlsxh-tnone"; note.style.flex = "1 1 auto";
      note.textContent = "1 data point";
      row.appendChild(note); row.appendChild(one);
    } else {
      var nz = document.createElement("div"); nz.className = "mlsxh-tnone"; nz.style.flex = "1 1 auto";
      nz.textContent = "No scores recorded";
      row.appendChild(nz);
    }
    return row;
  }

  /* ---- build the whole extended section ---- */
  function distinct(items) {
    var seen = {}, out = [];
    items.forEach(function (x) { var k = trim(x); if (k && !seen[k.toLowerCase()]) { seen[k.toLowerCase()] = 1; out.push(k); } });
    out.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    return out;
  }
  function controlsBlock(p, visits, f, onChange) {
    var box = document.createElement("div"); box.className = "mlsxh-ctrls";
    var search = document.createElement("input");
    search.className = "mlsxh-search"; search.type = "search";
    search.placeholder = "🔍 Search visits (dx, CPT, meds, findings, plan…)";
    search.value = f.q;
    search.addEventListener("input", function () { f.q = search.value; onChange(); });
    box.appendChild(search);

    var typeSel = document.createElement("select");
    typeSel.appendChild(opt("", "All types/procedures"));
    distinct(visits.map(function (v) { return v.type; })).forEach(function (t) { typeSel.appendChild(opt(t, t)); });
    typeSel.value = f.type;
    typeSel.addEventListener("change", function () { f.type = typeSel.value; onChange(); });
    box.appendChild(typeSel);

    var dxSel = document.createElement("select");
    dxSel.appendChild(opt("", "All diagnoses"));
    var allDx = [];
    visits.forEach(function (v) { (v.icd10 || []).forEach(function (c) { allDx.push(c); }); });
    distinct(allDx).forEach(function (c) { dxSel.appendChild(opt(c, c)); });
    dxSel.value = f.dx;
    dxSel.addEventListener("change", function () { f.dx = dxSel.value; onChange(); });
    box.appendChild(dxSel);

    var from = document.createElement("input"); from.className = "mlsxh-date"; from.type = "date";
    from.title = "From date"; from.value = f.from;
    from.addEventListener("change", function () { f.from = from.value; onChange(); });
    box.appendChild(from);
    var to = document.createElement("input"); to.className = "mlsxh-date"; to.type = "date";
    to.title = "To date"; to.value = f.to;
    to.addEventListener("change", function () { f.to = to.value; onChange(); });
    box.appendChild(to);

    var sortSel = document.createElement("select");
    sortSel.appendChild(opt("newest", "↓ Newest first"));
    sortSel.appendChild(opt("oldest", "↑ Oldest first"));
    sortSel.value = f.sort;
    sortSel.addEventListener("change", function () { f.sort = sortSel.value; onChange(); });
    box.appendChild(sortSel);

    var clr = document.createElement("button"); clr.className = "mlsxh-clear"; clr.textContent = "Clear";
    clr.addEventListener("click", function () { resetFilters(p.id); rebuild(true); });
    box.appendChild(clr);
    return box;
  }
  function opt(val, label) { var o = document.createElement("option"); o.value = val; o.textContent = label; return o; }

  function emptyState(p) {
    var box = document.createElement("div"); box.className = "mlsxh-empty";
    var t = document.createElement("div"); t.className = "t"; t.textContent = "No visits yet";
    var sub = document.createElement("div"); sub.textContent = "Add one or copy this patient's visits from Athena to build the timeline.";
    box.appendChild(t); box.appendChild(sub);
    var acts = document.createElement("div"); acts.className = "acts";
    // "Add one" — reuse the existing ease/add-visit affordance if present
    var addFn = null;
    try { if (window.__mlsEase && isFn(window.__mlsEase.addVisitForActive)) addFn = function () { window.__mlsEase.addVisitForActive(); }; } catch (e) {}
    if (!addFn) { try { if (window.__mlsAddPatient && isFn(window.__mlsAddPatient.open)) addFn = function () { window.__mlsAddPatient.open(); }; } catch (e) {} }
    if (addFn) {
      var add = document.createElement("button"); add.className = "mlsxh-btn"; add.textContent = "➕ Add a visit";
      add.addEventListener("click", addFn); acts.appendChild(add);
    }
    // "Copy from Athena" — click the existing copy-every-visit button if present
    var copyBtn = document.querySelector("#mlsCopyVisitsBar .mls-cv-btn");
    if (copyBtn) {
      var cp = document.createElement("button"); cp.className = "mlsxh-btn"; cp.textContent = "📋 Copy from Athena";
      cp.addEventListener("click", function () { copyBtn.click(); }); acts.appendChild(cp);
    }
    if (acts.childNodes.length) box.appendChild(acts);
    return box;
  }

  /* ---- host + lifecycle ---- */
  function host() {
    var card = document.getElementById("profileCard");
    if (!card || card.offsetParent === null) return null;
    return card;
  }
  function getVisits(p) {
    try { var M = MODEL(); if (M) { try { M.deriveFromLegacy(p); } catch (e) {} return M.getVisits(p) || []; } } catch (e) {}
    return Array.isArray(p && p.visits) ? p.visits.slice() : [];
  }
  function dataSig(p, visits) {
    return p.id + "|" + visits.length + "|" + visits.map(function (v) {
      return S(v.id) + ":" + S(v.date) + ":" + ((v.aiSummary ? 1 : 0)) + ":" + (v.cpt || []).length + ":" + (v.icd10 || []).length;
    }).join(",");
  }

  var _lastSig = "", _lastPid = "";
  function rebuild(force) {
    var card = host(); if (!card) { removeExt(); _lastSig = ""; return; }
    var p = activeP(); if (!p) { removeExt(); _lastSig = ""; _lastPid = ""; return; }
    var visits = getVisits(p);
    var sig = dataSig(p, visits);
    if (!force && sig === _lastSig && document.getElementById("mlsVisitHistoryExt")) return;
    _lastSig = sig;
    if (p.id !== _lastPid) { _lastPid = p.id; } // keep filter state per patient (do not reset on data change)
    injectStyle();

    var sec = document.getElementById("mlsVisitHistoryExt");
    if (!sec) { sec = document.createElement("div"); sec.id = "mlsVisitHistoryExt"; }
    sec.innerHTML = "";

    // header
    var head = document.createElement("div"); head.className = "mlsxh-head";
    var title = document.createElement("div"); title.className = "mlsxh-title";
    title.innerHTML = '🗂 Visit history <span class="mlsxh-count">' + visits.length + " visit" + (visits.length === 1 ? "" : "s") + "</span>";
    head.appendChild(title);
    var missing = visits.filter(function (v) { return !trim(v.aiSummary); }).length;
    if (missing) {
      var sumBtn = document.createElement("button"); sumBtn.className = "mlsxh-btn";
      sumBtn.textContent = "✨ Summarize all (" + missing + ")";
      sumBtn.addEventListener("click", function () {
        sumBtn.disabled = true;
        var stEl = sec.querySelector(".mlsxh-status");
        try {
          MODEL().ensureSummaries(p.id, function (m) { if (stEl) stEl.textContent = m; }).then(function () {
            if (stEl) stEl.textContent = "Summaries complete.";
            _lastSig = ""; rebuild(true);
          }, function () { sumBtn.disabled = false; });
        } catch (e) { sumBtn.disabled = false; }
      });
      head.appendChild(sumBtn);
    }
    sec.appendChild(head);

    var statusEl = document.createElement("div"); statusEl.className = "mlsxh-status"; sec.appendChild(statusEl);

    if (!visits.length) {
      sec.appendChild(emptyState(p));
    } else {
      sec.appendChild(buildOverview(visits));
      var f = stateFor(p.id);
      var listEl = document.createElement("div"); listEl.className = "mlsxh-list";
      sec.appendChild(controlsBlock(p, visits, f, function () { renderList(listEl, p, visits, f, statusEl); }));
      sec.appendChild(listEl);
      renderList(listEl, p, visits, f, statusEl);
    }

    // place right before the (hidden) base section, else after profAtGlance
    if (!sec.parentNode) {
      var base = document.getElementById("mlsVisitHistory");
      if (base && base.parentNode) base.parentNode.insertBefore(sec, base);
      else {
        var anchor = document.getElementById("profAtGlance");
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor.nextSibling);
        else card.appendChild(sec);
      }
    }
  }
  function removeExt() { var s = document.getElementById("mlsVisitHistoryExt"); if (s) s.remove(); }

  var _iv = null;
  function start() {
    injectStyle();
    try { rebuild(false); } catch (e) {}
    _iv = setInterval(function () { try { rebuild(false); } catch (e) {} }, 900);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  function revert() {
    try { if (_iv) clearInterval(_iv); _iv = null; } catch (e) {}
    removeExt();
    try { var st = document.getElementById("mls-xh-style"); if (st) st.remove(); } catch (e) {}
    // un-hide the base list
    try { var base = document.getElementById("mlsVisitHistory"); if (base) base.style.display = ""; } catch (e) {}
  }

  window.__mlsVisitHistoryExt = {
    installed: true,
    version: VERSION,
    rebuild: rebuild,
    revert: revert,
    // exposed for tests / introspection
    _classify: classify,
    _painOf: painOf,
    _funcOf: funcOf,
    _computeOverview: computeOverview,
    _applyFilters: applyFilters,
    _sortVisits: sortVisits,
    _sparkline: sparkline,
    _summaryLine: summaryLine,
    _state: state
  };
})();
