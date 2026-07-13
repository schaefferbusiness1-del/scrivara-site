/* feat_mls_uxpack1.js — v ux1-1.0.0 (2026-07-01)
 *
 * UX PACK 1 (additive, reversible — window.__mlsUxPack1.revert()). Six small fixes:
 *   1. PULL PROGRESS — the "Pull today\u2019s patients" quick-action card shows a live
       spinner + status while a pull runs, then the real result. No more "did it do
       anything?".
 *   2. Removes the "Fill-in-the-blank op note" quick action from MLS Easy (per Michael).
 *   3. Removes the patient Snapshot bar icon (per Michael).
 *   4. DAY VIEW FIX — the day grid said "No appointments yet" even when the day had
       booked patients (and never listed them). The misleading line is hidden whenever
       the day really has appointments, and a compact "Booked" chip strip shows every
       booked patient for the visible day.
 *   5. TEMPLATE TOOLS — a toolbar in the templates area: upload template FILES, upload a
       whole FOLDER, add a starter pack of properly-structured op-note templates (with
       fill-in blanks like volumes/concentrations), and Delete ALL templates
       (double-confirm). Uses the app\u2019s own getTemplates/setTemplates store.
 *   6. AGENDA CHIP — promoted to a primary-styled control and guaranteed to show its label.
 *
 * No athenaOne writes. No PHI leaves the page. Every failure path try/catch no-ops.
 */
(function () {
  "use strict";
  if (window.__mlsUxPack1 && window.__mlsUxPack1.installed) return;
  var VERSION = "ux1-1.0.0";
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  var NL = String.fromCharCode(10);
  var STYLE_ID = "mlsUx1Style";

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style"); s.id = STYLE_ID;
    s.textContent = [
      "#mlsOpFillBtn{display:none !important;}",
      "#mlsSnapshotBtn{display:none !important;}",
      "#mlsAgendaChip{font-weight:700 !important;font-size:13px !important;padding:6px 12px !important;background:#2E6A4B !important;color:#fff !important;border-radius:10px !important;border:1px solid #2E6A4B !important;cursor:pointer;}",
      ".mlsux1-busy{opacity:.85;pointer-events:none;}",
      ".mlsux1-spin{display:inline-block;width:12px;height:12px;border:2px solid rgba(120,150,255,.35);border-top-color:#2E6A4B;border-radius:50%;vertical-align:-2px;margin-right:6px;animation:mlsux1rot .8s linear infinite;}",
      "@keyframes mlsux1rot{to{transform:rotate(360deg)}}",
      "#mlsUx1TmplBar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 2px;padding-top:10px;border-top:1px dashed #d5dde6;width:100%;}",
      "#mlsUx1TmplBar button{cursor:pointer;border:1px solid #d5dde6;background:#f6f9fc;border-radius:8px;padding:6px 10px;font-size:12.5px;}",
      "#mlsUx1TmplBar button.mlsux1-danger{border-color:#e3b3b3;background:#fdf3f3;color:#8a1f1f;}",
      ".mlsux1-daychips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;}",
      ".mlsux1-daychips span{background:#eef4ff;border:1px solid #EAF1EE;color:#204034;border-radius:8px;padding:3px 8px;font-size:12px;}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  /* ============ 1. pull progress ============ */
  function pullCard() {
    return safe(function () {
      var btns = document.querySelectorAll("button.vx-qbtn");
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].textContent || "").indexOf("Pull today") >= 0) return btns[i];
      }
      return null;
    }, null);
  }
  function setCardStatus(msg, done) {
    var c = pullCard(); if (!c) return;
    var sub = c.querySelector(".mlsux1-status");
    if (!sub) {
      sub = document.createElement("div");
      sub.className = "mlsux1-status";
      sub.style.cssText = "font-size:11.5px;margin-top:3px;color:#204034;";
      c.appendChild(sub);
    }
    while (sub.firstChild) sub.removeChild(sub.firstChild);
    if (!done) { var sp = document.createElement("span"); sp.className = "mlsux1-spin"; sub.appendChild(sp); }
    sub.appendChild(document.createTextNode(String(msg || "")));
  }
  var pullWrapped = false;
  function wrapPull() {
    if (pullWrapped) return true;
    var SI = window.__mlsSI;
    if (!SI || !isFn(SI.pull) || SI.pull.__ux1) { pullWrapped = !!(SI && SI.pull && SI.pull.__ux1); return pullWrapped; }
    var orig = SI.pull;
    SI.pull = function (opts) {
      opts = opts || {};
      var userStatus = opts.onStatus;
      safe(function () { var c = pullCard(); if (c) c.classList.add("mlsux1-busy"); });
      setCardStatus("Connecting to athenaOne...", false);
      opts.onStatus = function (m, k) {
        safe(function () { setCardStatus(String(m || ""), k === "ok" || k === "err"); });
        if (isFn(userStatus)) safe(function () { userStatus(m, k); });
      };
      var p = orig.call(this, opts);
      function settle(res) {
        safe(function () {
          var c2 = pullCard();
          if (c2) c2.classList.remove("mlsux1-busy");
          if (res && typeof res.created === "number") {
            var msg = res.created > 0 ? ("Imported " + res.created + " for " + (res.target || "the day")) : (res.skipped > 0 ? ("Already on your calendar (" + res.skipped + " found)") : "Nothing found for that day in your open athenaOne tab");
            setCardStatus(msg, true);
          }
          setTimeout(function () { safe(function () { var c3 = pullCard(); var s2 = c3 && c3.querySelector(".mlsux1-status"); if (s2) s2.remove(); }); }, 9000);
        });
        return res;
      }
      return (p && p.then) ? p.then(settle, function (e) { settle(null); throw e; }) : p;
    };
    SI.pull.__ux1 = true; SI.pull.__orig = orig;
    pullWrapped = true;
    return true;
  }

  /* ============ 2. day view: honest empty state + booked chips ============ */
  var MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  function headerDateKey() {
    return safe(function () {
      var v = document.getElementById("calendarView"); if (!v || !v.offsetParent) return null;
      var txt = (v.innerText || "").slice(0, 400).toLowerCase();
      var yr = null; var ym = txt.match(/20[0-9][0-9]/); if (ym) yr = ym[0];
      if (!yr) return null;
      for (var m = 0; m < 12; m++) {
        var idx = txt.indexOf(MONTHS[m]);
        if (idx >= 0) {
          var rest = txt.slice(idx + MONTHS[m].length, idx + MONTHS[m].length + 8);
          var num = parseInt(rest.replace(/[^0-9]/g, " "), 10);
          if (num >= 1 && num <= 31) return yr + "-" + ("0" + (m + 1)).slice(-2) + "-" + ("0" + num).slice(-2);
        }
      }
      return null;
    }, null);
  }
  function dayApptsFor(key) {
    return safe(function () {
      var out = [];
      var cal = window._calAppts || [];
      for (var i = 0; i < cal.length; i++) {
        var a = cal[i];
        var d = a.appt_date || (a.start_at ? new Date(a.start_at).toISOString().slice(0, 10) : "");
        if (d === key && a.name) out.push(a);
      }
      out.sort(function (x, y) { return String(x.start_at || "").localeCompare(String(y.start_at || "")); });
      return out;
    }, []);
  }
  function fixDayView() {
    safe(function () {
      var grid = document.getElementById("calGrid");
      if (!grid || !grid.offsetParent) { var st = document.getElementById("mlsUx1DayChips"); if (st) st.remove(); return; }
      var key = headerDateKey(); if (!key) return;
      var appts = dayApptsFor(key);
      var minis = grid.querySelectorAll(".mini");
      for (var i = 0; i < minis.length; i++) {
        if ((minis[i].textContent || "").indexOf("No appointments yet") >= 0) {
          minis[i].style.display = appts.length ? "none" : "";
        }
      }
      var strip = document.getElementById("mlsUx1DayChips");
      if (!appts.length) { if (strip) strip.remove(); return; }
      if (!strip) {
        strip = document.createElement("div");
        strip.id = "mlsUx1DayChips";
        strip.className = "mlsux1-daychips";
        grid.insertBefore(strip, grid.firstChild);
      }
      var sig = key + ":" + appts.map(function (a) { return a.name; }).join("|");
      if (strip.getAttribute("data-sig") === sig) return;
      strip.setAttribute("data-sig", sig);
      while (strip.firstChild) strip.removeChild(strip.firstChild);
      var head = document.createElement("span");
      head.style.cssText = "background:#2E6A4B;color:#fff;border-color:#2E6A4B;font-weight:600;";
      head.textContent = "Booked: " + appts.length;
      strip.appendChild(head);
      for (var j = 0; j < appts.length && j < 24; j++) {
        (function (a2) {
          var t = safe(function () { return a2.start_at ? (new Date(a2.start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " ") : ""; }, "");
          var sp = document.createElement("span");
          sp.textContent = t + a2.name;
          strip.appendChild(sp);
        })(appts[j]);
      }
    });
  }

  /* ============ 3. template tools ============ */
  function tGet() { return safe(function () { return (isFn(window.getTemplates) ? window.getTemplates() : []) || []; }, []); }
  function tSet(list) { return safe(function () { if (isFn(window.setTemplates)) { window.setTemplates(list); return true; } return false; }, false); }
  function toast(m, k) { safe(function () { if (isFn(window.toast)) window.toast(m, k || ""); }); }
  function mkTemplate(name, keywords, text) {
    return { id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, keywords: keywords, text: text, created: Date.now() };
  }
  var STARTERS = [
    ["Starter — Injection op note (generic)", "injection joint intraarticular steroid",
      ["PROCEDURE: ___ injection", "INDICATION: ___", "CONSENT: The risks, benefits and alternatives were discussed; informed consent was obtained and time-out performed.", "ANESTHESIA: Local — ___ mL of ___% lidocaine.", "PREP: The site was prepped in the usual sterile fashion.", "TECHNIQUE: Using ___ guidance, a ___-gauge needle was advanced to the ___. Needle position was confirmed.", "MEDICATIONS INJECTED: ___ mL of ___ (___ mg) mixed with ___ mL of ___.", "TOTAL VOLUME: ___ mL.", "COMPLICATIONS: None. The patient tolerated the procedure well.", "DISPOSITION: Post-procedure instructions given; follow-up in ___ weeks."]],
    ["Starter — Lumbar epidural steroid injection", "lumbar epidural steroid esi interlaminar transforaminal",
      ["PROCEDURE: Lumbar epidural steroid injection, ___ approach at ___.", "INDICATION: ___", "CONSENT: Informed consent obtained; time-out performed.", "POSITION: Prone on the fluoroscopy table.", "ANESTHESIA: Local — ___ mL of ___% lidocaine to skin and subcutaneous tissue.", "TECHNIQUE: Under fluoroscopic guidance a ___-gauge ___ needle was advanced to the epidural space at ___; loss of resistance confirmed. Contrast (___ mL of ___) demonstrated appropriate epidural spread without vascular uptake.", "MEDICATIONS INJECTED: ___ mg of ___ in ___ mL of preservative-free saline.", "TOTAL VOLUME: ___ mL.", "COMPLICATIONS: None. Neuro checks intact post-procedure.", "DISPOSITION: Discharged to recovery; follow-up in ___ weeks."]],
    ["Starter — Medial branch block", "medial branch block mbb facet rf",
      ["PROCEDURE: ___ medial branch blocks at ___ (levels: ___).", "INDICATION: ___", "CONSENT: Informed consent obtained; time-out performed.", "ANESTHESIA: Local — ___ mL of ___% lidocaine per level.", "TECHNIQUE: Under fluoroscopic guidance a ___-gauge needle was placed at each target; position confirmed in AP and oblique views. Negative aspiration at each level.", "MEDICATIONS INJECTED: ___ mL of ___% bupivacaine per level (total ___ mL).", "COMPLICATIONS: None. The patient tolerated the procedure well.", "DISPOSITION: Pain diary provided; follow-up in ___ weeks."]]
  ];
  function addStarters() {
    var cur = tGet();
    var added = 0;
    for (var i = 0; i < STARTERS.length; i++) {
      var s = STARTERS[i];
      var exists = cur.some(function (t) { return t && t.name === s[0]; });
      if (!exists) { cur.push(mkTemplate(s[0], s[1], s[2].join(NL))); added++; }
    }
    if (added && tSet(cur)) toast("Added " + added + " starter op-note template" + (added === 1 ? "" : "s") + " (with fill-in blanks).", "ok");
    else if (!added) toast("Starter templates are already in your list.", "");
    return added;
  }
  function readFiles(files, done) {
    var list = [], pending = 0, names = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f || !(f.name || "").match(/[.](txt|md|text)$/i)) continue;
      pending++;
      (function (file) {
        var rd = new FileReader();
        rd.onload = function () {
          var nm = String(file.name || "template").replace(/[.](txt|md|text)$/i, "");
          list.push(mkTemplate(nm, nm.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(" "), String(rd.result || "")));
          names.push(nm);
          pending--; if (pending === 0) done(list, names);
        };
        rd.onerror = function () { pending--; if (pending === 0) done(list, names); };
        rd.readAsText(file);
      })(f);
    }
    if (pending === 0) done(list, names);
  }
  function uploadTemplates(folder) {
    var inp = document.createElement("input");
    inp.type = "file"; inp.multiple = true;
    inp.accept = ".txt,.md,text/plain";
    if (folder) { inp.setAttribute("webkitdirectory", ""); inp.setAttribute("directory", ""); }
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", function () {
      readFiles(inp.files || [], function (list) {
        safe(function () { inp.remove(); });
        if (!list.length) { toast("No .txt / .md template files found in that selection.", "err"); return; }
        var cur = tGet().concat(list);
        if (tSet(cur)) toast("Uploaded " + list.length + " template" + (list.length === 1 ? "" : "s") + ".", "ok");
        else toast("Could not save templates (template store unavailable).", "err");
      });
    });
    inp.click();
  }
  function deleteAll() {
    var n = tGet().length;
    if (!n) { toast("No templates to delete.", ""); return; }
    var ok1 = safe(function () { return window.confirm("Delete ALL " + n + " templates? This cannot be undone."); }, false);
    if (!ok1) return;
    var ok2 = safe(function () { return window.confirm("Are you sure? Every template (" + n + ") will be permanently removed."); }, false);
    if (!ok2) return;
    if (tSet([])) toast("Deleted all " + n + " templates.", "ok");
  }
  function mountTmplBar() {
    safe(function () {
      if (!isFn(window.getTemplates) || !isFn(window.setTemplates)) return;
      var existing = document.getElementById("mlsUx1TmplBar");
      if (existing && existing.offsetParent) return;
      var host = null;
      var cands = document.querySelectorAll("[id*=template i], [id*=Template]");
      for (var i = 0; i < cands.length; i++) {
        var el = cands[i];
        if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
        if (el.offsetParent && el.getBoundingClientRect().height > 120) { host = el; break; }
      }
      if (!host) {
        var btns = document.querySelectorAll("button");
        for (var j = 0; j < btns.length; j++) {
          if ((btns[j].textContent || "").indexOf("standard line") >= 0 && btns[j].offsetParent) { host = btns[j].parentElement; break; }
        }
      }
      if (!host) return;
      if (existing) existing.remove();
      var bar = document.createElement("div");
      bar.id = "mlsUx1TmplBar";
      function mkBtn(label, cls, fn) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = label; if (cls) b.className = cls;
        b.addEventListener("click", function (ev) { safe(function () { ev.preventDefault(); ev.stopPropagation(); }); fn(); });
        bar.appendChild(b);
      }
      mkBtn("⬆ Upload templates (.txt/.md)", "", function () { uploadTemplates(false); });
      mkBtn("📁 Upload a folder", "", function () { uploadTemplates(true); });
      mkBtn("📦 Add starter op-note templates", "", addStarters);
      mkBtn("🗑 Delete ALL templates", "mlsux1-danger", deleteAll);
      host.appendChild(bar);
    });
  }

  /* ============ 4. agenda chip label guard ============ */
  function fixAgenda() {
    safe(function () {
      var chip = document.getElementById("mlsAgendaChip");
      if (chip && (chip.textContent || "").replace(/[^A-Za-z]/g, "").length < 3) {
        chip.textContent = "📋 Today\u2019s agenda";
      }
    });
  }

  /* ============ boot / revert ============ */
  var _iv = null;
  function tick() { injectStyle(); wrapPull(); fixDayView(); mountTmplBar(); fixAgenda(); }
  _iv = setInterval(function () { safe(tick); }, 1500);
  safe(tick);

  function revert() {
    safe(function () { if (_iv) { clearInterval(_iv); _iv = null; } });
    safe(function () { var SI = window.__mlsSI; if (SI && SI.pull && SI.pull.__ux1 && SI.pull.__orig) SI.pull = SI.pull.__orig; });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s) s.remove(); });
    safe(function () { var b = document.getElementById("mlsUx1TmplBar"); if (b) b.remove(); });
    safe(function () { var c = document.getElementById("mlsUx1DayChips"); if (c) c.remove(); });
    safe(function () { window.__mlsUxPack1.installed = false; });
    return true;
  }

  window.__mlsUxPack1 = {
    installed: true,
    version: VERSION,
    asset: "feat_mls_uxpack1.js",
    addStarters: addStarters,
    uploadTemplates: uploadTemplates,
    deleteAllTemplates: deleteAll,
    revert: revert
  };
})();
