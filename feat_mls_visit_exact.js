/* feat_mls_visit_exact.js  ->  window.__mlsVx  (Visit page, design-exact rebuild)
 *
 *  STAGING ONLY. Loaded LAST by mls-connect.staging.js (never by the prod
 *  loader mls-connect.js), and additionally runtime-gated to the staging page.
 *  Production is untouched.
 *
 *  WHAT IT DOES (Slice 1):
 *    Rebuilds the Visit view (#visitView) to match the exported design
 *    (design_renders/ScribeFlow.dc.html) VERBATIM in structure + tokens:
 *      - dark-navy hero (2-col: talk panel + Quick actions)
 *      - 3-column work grid: Capture | Clinical note | EMR sticky rail
 *      - full-width Outcomes section
 *    It does NOT recreate the app's logic. Every interactive element is the
 *    app's REAL element, MOVED into the design slot BY ID, so the app's
 *    render/data flow keeps working untouched. Static/decorative wrapper
 *    markup is the only thing built fresh. Nothing is deleted.
 *
 *  Slice 2 (separate) relocates the ~100 hidden tool cards + #visitToolsGroup
 *  out of #noteCard into the design "Clinical tools / More tools" area.
 *
 *  Reversible: window.__mlsVx.revert().  ASCII-only (emoji via HTML entities).
 *  NUL-free. Idempotent.
 */
;(function () {
  "use strict";
  var VERSION = "vx-1.3.0";
  try { if (window.__mlsVx && window.__mlsVx.installed) return; } catch (e) { return; }

  /* ---- staging gate (defense in depth; loader already staging-only) ---- */
  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsVx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var BUILT_ATTR = "data-vx-built";
  var STYLE_ID = "vxStyle";
  var _obs = null, _t = null, _schedT = null;

  /* emoji as HTML numeric entities (keeps this source pure ASCII) */
  var E = {
    mic: "&#127897;&#65039;", note: "&#128221;", folder: "&#128193;", chart: "&#128200;",
    inbox: "&#128229;", plug: "&#128268;", syringe: "&#128137;"
  };

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  function imp(el, prop, val) { try { el.style.setProperty(prop, val, "important"); } catch (e) {} }
  function impAll(el, list) {
    if (!el) return;
    list.forEach(function (p) { var i = p.indexOf(":"); imp(el, p.slice(0, i), p.slice(i + 1)); });
  }

  var ICONSQ = "width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px";

  function injectCSS() {
    var css = [
      "#visitView .vx-grid{display:grid;grid-template-columns:1fr 1fr 460px;gap:20px;margin-top:20px;align-items:start}",
      "#visitView .vx-emr{position:sticky;top:138px;align-self:start}",
      "@media (max-width:1100px){#visitView .vx-grid{grid-template-columns:1fr 1fr}#visitView .vx-emr{position:static;grid-column:1 / -1}}",
      "@media (max-width:820px){#visitView .vx-grid{grid-template-columns:1fr}#visitView .vx-emr{grid-column:auto}}",
      "@media (max-width:560px){#visitView .vx-hero-inner{grid-template-columns:1fr!important;padding:22px 18px!important}#visitView .vx-cap-row{flex-direction:column!important;align-items:stretch!important}#visitView .vx-cap-row>*{width:100%!important}}",
      "#visitView .vx-grid,#visitView .vx-grid *{box-sizing:border-box}",
      "#visitView .vx-grid input,#visitView .vx-grid textarea,#visitView .vx-grid select{max-width:100%}",
      "#visitView .vx-qbtn:hover{background:rgba(255,255,255,.13)!important}",
      "#visitView .mlsaa-intent{display:none!important}",
      /* SIMPLE (MLS Easy) view: the design shows ONLY the guided wizard (#visitHero);
         hide the Complex 3-col grid + tools so they never leak under the wizard */
      "html.mls-sv-active #visitView .vx-grid,html.mls-sv-active #visitView .vx-tools{display:none!important}",
      /* contain the shared overlay top chrome so the page never overflows at tablet widths */
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  /* ===================== HERO ===================== */
  function buildHero() {
    var hero = $("visitHero"); if (!hero) return;
    imp(hero, "background", "linear-gradient(135deg,#0d2138 0%,#143560 55%,#15406f 100%)");
    imp(hero, "color", "#fff"); imp(hero, "border", "0"); imp(hero, "border-radius", "22px");
    imp(hero, "box-shadow", "0 22px 50px -22px rgba(13,33,56,.6)"); imp(hero, "padding", "0");
    imp(hero, "overflow", "hidden"); imp(hero, "position", "relative"); imp(hero, "margin-bottom", "0");

    if (hero.querySelector(":scope > .vx-hero-wrap")) return;

    var nameInp = $("heroPtName"), dob = $("heroPtDob"), rec = $("heroRecBtn"),
        list = $("heroPtList"), pull = $("heroPullStatus"), today = $("heroToday");
    var inpCss = ["width:100%", "height:48px", "border-radius:12px", "border:1px solid rgba(255,255,255,.16)",
      "background:rgba(255,255,255,.96)", "color:#0f2540", "padding:0 15px", "font-size:14.5px"];

    hero.innerHTML = "";
    hero.appendChild(mk("div", "position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle at 88% -20%,rgba(25,184,166,.35),transparent 45%),radial-gradient(circle at 100% 120%,rgba(47,107,237,.3),transparent 40%)"));
    var inner = mk("div", "position:relative;padding:30px 34px;display:grid;grid-template-columns:1.15fr .85fr;gap:34px;align-items:center");
    inner.className = "vx-hero-wrap vx-hero-inner";
    hero.appendChild(inner);

    var left = mk("div");
    left.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
        '<span style="font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0d2138;background:#5fe3cf;padding:4px 11px;border-radius:20px">MLS Easy</span>' +
        '<span style="color:#9fc0ff;font-size:12.5px;font-weight:600">Ready for your next patient</span>' +
      '</div>' +
      '<h1 style="font-family:\'Newsreader\',Georgia,serif;font-weight:500;font-size:38px;line-height:1.08;letter-spacing:-.015em;color:#fff;margin:0 0 12px">Just talk &mdash; <span style="font-style:italic;color:#8fe9da">MLS writes the note.</span></h1>' +
      '<p style="color:#bcd2ed;font-size:15px;line-height:1.55;max-width:440px;margin:0 0 22px">Enter the patient\'s name and DOB, hit record, and have a natural visit. No typing, no clicks &mdash; you review and sign.</p>';
    var row = mk("div", "display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap"); row.className = "vx-cap-row";
    var nameWrap = mk("div", "flex:1;min-width:200px", '<label style="display:block;color:#9fc0ff;font-size:11.5px;font-weight:600;margin-bottom:6px">Patient name</label>');
    var dobWrap = mk("div", "width:150px", '<label style="display:block;color:#9fc0ff;font-size:11.5px;font-weight:600;margin-bottom:6px">Date of birth</label>');
    row.appendChild(nameWrap); row.appendChild(dobWrap); left.appendChild(row); inner.appendChild(left);

    if (nameInp) { impAll(nameInp, inpCss); nameWrap.appendChild(nameInp); }
    if (list) nameWrap.appendChild(list);
    if (dob) { impAll(dob, inpCss); dobWrap.appendChild(dob); }
    if (rec) {
      impAll(rec, ["height:48px", "padding:0 22px", "border-radius:12px", "border:0",
        "background:linear-gradient(135deg,#19b8a6,#13a18f)", "color:#fff", "font-weight:700",
        "font-size:14.5px", "box-shadow:0 10px 22px -8px rgba(25,184,166,.7)", "white-space:nowrap"]);
      row.appendChild(rec);
    }

    var right = mk("div", "display:flex;flex-direction:column;gap:11px",
      '<div style="display:flex;justify-content:space-between;align-items:center"><span style="color:#9fc0ff;font-size:12px;font-weight:600">Quick actions</span></div>');
    var qa = [
      { h: "pullScheduleViaAssist(this)", icon: E.inbox, t: "Pull today's patients", s: "Import schedule &amp; history", tag: "READ-ONLY" },
      { h: "emrConnectFromHero()", icon: E.plug, t: "Connect to EMR", s: "HL7 FHIR R4 &middot; SMART on FHIR", tag: "" },
      { h: "openOpPrepSmart()", icon: E.syringe, t: "Prep op note", s: "Pre-draft a procedure note", tag: "" }
    ];
    qa.forEach(function (q) {
      var b = mk("button", "width:100%;display:flex;align-items:center;gap:13px;padding:14px 16px;border-radius:13px;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.07);color:#fff;font-family:inherit;cursor:pointer;text-align:left");
      b.className = "vx-qbtn"; b.setAttribute("onclick", q.h);
      b.innerHTML =
        '<span style="width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-size:16px">' + q.icon + '</span>' +
        '<span style="flex:1"><span style="display:block;font-weight:600;font-size:13.5px">' + q.t + '</span>' +
        '<span style="display:block;color:#9fb6d6;font-size:11.5px;margin-top:1px">' + q.s + '</span></span>' +
        (q.tag ? '<span style="font-size:9.5px;font-weight:700;letter-spacing:.05em;color:#5fe3cf;border:1px solid rgba(95,227,207,.4);padding:2px 7px;border-radius:20px">' + q.tag + '</span>' : '');
      right.appendChild(b);
    });
    inner.appendChild(right);

    if (pull) { imp(pull, "color", "#bcd2ed"); left.appendChild(pull); }
    if (today) left.appendChild(today);
  }

  /* ===================== GRID (Capture | Note | EMR) ===================== */
  function buildGrid() {
    var v = $("visitView"); if (!v) return;
    var cap = $("captureCard"), note = $("noteCard"), emr = $("emrCard");
    if (!cap || !note) return;

    var grid = v.querySelector(":scope > .vx-grid");
    if (!grid) {
      grid = mk("div"); grid.className = "vx-grid";
      var hero = $("visitHero");
      if (hero && hero.parentElement === v) v.insertBefore(grid, hero.nextSibling);
      else v.insertBefore(grid, v.firstChild);
    }
    var oldGrid = v.querySelector(":scope > .grid");
    if (oldGrid && oldGrid !== grid) { oldGrid.classList.remove("grid"); oldGrid.classList.add("vx-oldgrid"); imp(oldGrid, "display", "contents"); }

    [cap, note].forEach(function (c) {
      imp(c, "background", "#fff"); imp(c, "border", "1px solid #e4ebf3"); imp(c, "border-radius", "18px");
      imp(c, "padding", "24px"); imp(c, "box-shadow", "0 1px 2px rgba(15,37,64,.04)"); imp(c, "margin", "0");
    });
    grid.appendChild(cap); grid.appendChild(note);

    if (emr) {
      imp(emr, "background", "#fff"); imp(emr, "border", "1px solid #e4ebf3"); imp(emr, "border-radius", "18px");
      imp(emr, "padding", "20px"); imp(emr, "box-shadow", "0 1px 2px rgba(15,37,64,.04)"); imp(emr, "margin", "0");
      emr.classList.add("vx-emr"); grid.appendChild(emr);
    }
  }

  /* ===================== header chrome inside cards ===================== */
  function restyleCardChrome() {
    var heads = [
      { card: "captureCard", icon: E.mic, bg: "#eef3fb" },
      { card: "noteCard", icon: E.note, bg: "#f3eefb" },
      { card: "emrCard", icon: E.folder, bg: "#fbf3e3", small: true },
      { card: "outcomesCard", icon: E.chart, bg: "#e7f5ee" }
    ];
    heads.forEach(function (h) {
      var card = $(h.card); if (!card) return;
      var hd = card.querySelector(":scope > h2"); if (!hd || hd.getAttribute("data-vx")) return;
      hd.setAttribute("data-vx", "1");
      imp(hd, "display", "flex"); imp(hd, "align-items", "center"); imp(hd, "gap", "11px");
      imp(hd, "font-size", h.small ? "15.5px" : "18px"); imp(hd, "font-weight", "700"); imp(hd, "letter-spacing", "-.01em");
      var ic = hd.querySelector(".ic");
      var sq = mk("span", ICONSQ + ";background:" + h.bg + (h.small ? ";width:32px;height:32px;border-radius:9px;font-size:15px" : ""), h.icon);
      if (ic) hd.replaceChild(sq, ic); else hd.insertBefore(sq, hd.firstChild);
    });
  }

  /* ===================== TOOLS RELOCATION (Slice 2) =====================
   * Move the big tool RESULT panels (and #visitToolsGroup's ~100 hidden tool
   * cards) out of the cramped note column into a full-width "Clinical tools &
   * reports" area below the grid. Moved BY ID so their show/hide handlers keep
   * working. Trigger buttons (More tools / Clinical tools) stay in the note
   * card and toggle these by ID. Nothing deleted. */
  function buildTools() {
    var v = $("visitView"); if (!v) return;
    var grid = v.querySelector(":scope > .vx-grid"); if (!grid) return;
    var sec = v.querySelector(":scope > .vx-tools");
    if (!sec) {
      sec = mk("div"); sec.className = "vx-tools"; sec.style.cssText = "margin-top:20px";
      sec.innerHTML = '<div class="vx-tools-lbl" style="font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#8a9cb2;margin:0 0 10px;display:none">Clinical tools &amp; reports</div>';
      var host = mk("div"); host.className = "vx-tools-host"; host.style.cssText = "display:flex;flex-direction:column;gap:16px";
      sec.appendChild(host);
      var outc = $("outcomesCard");
      if (outc && outc.parentElement === v) v.insertBefore(sec, outc); else v.appendChild(sec);
    }
    var host = sec.querySelector(".vx-tools-host");
    var ids = ["codeCard", "optCard", "revToolsCard", "dsCard", "teachCard", "avsCard",
      "refCard", "imeCard", "legalCard", "visitToolsGroup"];
    var moved = 0, anyVisible = false;
    ids.forEach(function (id) {
      var el = $(id); if (!el) return;
      if (el.parentElement !== host) host.appendChild(el);
      moved++;
      try { if (el.offsetParent !== null || getComputedStyle(el).display !== "none") anyVisible = true; } catch (e) {}
    });
    /* show the section label only once at least one tool panel is open */
    var lbl = sec.querySelector(".vx-tools-lbl");
    if (lbl) lbl.style.display = anyVisible ? "block" : "none";
  }

  /* ===================== OUTCOMES ===================== */
  function buildOutcomes() {
    var o = $("outcomesCard"); if (!o) return;
    imp(o, "background", "#fff"); imp(o, "border", "1px solid #e4ebf3"); imp(o, "border-radius", "18px");
    imp(o, "padding", "24px"); imp(o, "box-shadow", "0 1px 2px rgba(15,37,64,.04)"); imp(o, "margin-top", "20px");
    var v = $("visitView"), grid = v && v.querySelector(":scope > .vx-grid");
    if (grid && o.parentElement === v) { try { v.appendChild(o); } catch (e) {} }
  }

  /* ===================== orchestration ===================== */
  function build() {
    var v = $("visitView"); if (!v) return;
    injectCSS(); buildHero(); buildGrid(); buildTools(); restyleCardChrome(); buildOutcomes();
    v.setAttribute(BUILT_ATTR, VERSION);
  }
  function applyAll() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { build(); } catch (e) {}
    try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  function schedule() { if (_schedT) return; _schedT = setTimeout(function () { _schedT = null; applyAll(); }, 140); }
  function boot() {
    try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {}
    applyAll();
    var n = 0; _t = setInterval(function () { applyAll(); if (++n > 12) clearInterval(_t); }, 700);
  }
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_t) clearInterval(_t); } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { window.__mlsVx.installed = false; } catch (e) {}
  }

  window.__mlsVx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
