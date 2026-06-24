/* feat_mls_simple_exact.js  ->  window.__mlsSimX  (Simple / "MLS Easy" view, design-exact rebuild)
 *
 *  STAGING-FIRST. Loaded by mls-connect.staging.js (and, after verification, by the
 *  prod loader mls-connect.js via the data: staging marker). Runtime-gated to the
 *  staging page AND to Simple/Easy mode only (window.__mlsEasy.state.mode === 'easy').
 *  Complex view is never touched.
 *
 *  WHAT IT DOES
 *    The app's native guided Easy wizard (feat_mls_easy.js -> #mlsEasyPanel inside the
 *    DARK full-width #visitHero) is the real 5-step state machine (Patient -> Record ->
 *    Generate -> Review -> Sign) that drives the real handlers (pullPatientFromAthenaPrompt,
 *    startCapture/stopCapture, generateNote, saveCurrentNote, copyForEMR) and is the
 *    source of truth for the current step (window.__mlsEasy.state).
 *
 *    This module converts that dark, full-width presentation into the EXPORTED DESIGN
 *    (design_renders/ScribeFlow Simple.dc.html): a LIGHT ~760px centered card with a
 *    numbered 5-step stepper, a context banner, a hero "Pull today's patients" gradient
 *    button, a 2x2 option grid and a footer CTA. The dark hero + native panel are simply
 *    HIDDEN in Simple mode (kept in the DOM, fully functional); this module renders the
 *    design card as a sibling inside #visitView and PROXIES every control to the app's
 *    REAL wired handlers -- the centerpiece pull buttons BY ID (#mlscpToday / #mlscpWeek /
 *    #mlscpSelected / #mlscpFind), the real global capture/generate/save functions, and
 *    the native wizard's own step transitions (window.__mlsEasy.goto / .render). The
 *    native logic is never reimplemented and never broken.
 *
 *  Reversible: window.__mlsSimX.revert().  ASCII-only (emoji via HTML numeric entities).
 *  NUL-free. Idempotent. View-isolated (#visitView only). No PHI logged or sent anywhere.
 */
;(function () {
  "use strict";
  var VERSION = "simx-1.1.1";
  try { if (window.__mlsSimX && window.__mlsSimX.installed) return; } catch (e) { return; }

  /* ---- staging gate (defense in depth; loader already staging-only) ---- */
  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsSimX = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var STYLE_ID = "simxStyle";
  var WRAP_ID = "mlsSimWrap";
  var _t = null, _obs = null, _schedT = null, _manual = false, _lastSig = "";

  /* emoji as HTML numeric entities (keeps this source pure ASCII) */
  var E = {
    person: "&#128100;", cal: "&#128197;", calWk: "&#128198;", down: "&#11015;&#65039;",
    find: "&#128269;", pen: "&#9997;&#65039;", mic: "&#127897;&#65039;", lock: "&#128274;",
    arrow: "&#8594;", larrow: "&#8592;", tri: "&#9662;", check: "&#10003;", spiral: "&#128467;&#65039;",
    spark: "&#10024;", save: "&#128190;", clip: "&#128203;", receipt: "&#129534;"
  };
  var STEP_NAMES = ["Patient", "Record", "Generate", "Review", "Sign"];

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function callFn(name, arg) { try { if (typeof window[name] === "function") return window[name](arg); } catch (e) {} return undefined; }
  function clickById(id) { var el = $(id); if (el) { try { el.click(); return true; } catch (e) {} } return false; }
  function val(id) { var e = $(id); return e ? (e.value || "") : ""; }
  function txt(id) { var e = $(id); return e ? (e.textContent || "") : ""; }

  /* ---- live state probes (read the same DOM the native wizard reads) ---- */
  function easy() { try { return window.__mlsEasy; } catch (e) { return null; } }
  function isSimple() { var e = easy(); return !!(e && e.state && e.state.mode === "easy"); }
  function curStep() { var e = easy(); return (e && e.state) ? e.state.step : 1; }
  function isRecording() { return /stop/i.test(txt("captureBtn")); }
  function hasTranscript() { return val("transcript").trim().length > 0; }
  function hasNote() { return val("noteBox").trim().length > 0; }
  function patientName() { return val("heroPtName").trim(); }
  function patientDob() { return val("heroPtDob").trim(); }

  function easyGoto(n) { var e = easy(); if (e && typeof e.goto === "function") { try { e.goto(n); } catch (x) {} } renderCard(); }

  /* ---- real active patient (fixes the "No active patient yet" bug: read the app's
     ACTIVE patient, not the empty hero name field) + the shared pull-and-select picker ---- */
  function realActive() {
    try { if (window.__mlsPick && typeof window.__mlsPick.activePatient === "function") { var a = window.__mlsPick.activePatient(); if (a) return a; } } catch (e) {}
    try { return window.activePatient ? window.activePatient() : null; } catch (e) {}
    return null;
  }
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/);
    if (!parts.length || !parts[0]) return "?";
    return ((parts[0][0] || "") + (parts.length > 1 ? (parts[parts.length - 1][0] || "") : "")).toUpperCase();
  }
  function ageOf(dob) {
    var s = String(dob || "").trim(); if (!s) return null;
    var d = null, m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) d = new Date(+m[1], +m[2] - 1, +m[3]);
    else { m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); if (m) d = new Date(+m[3], +m[1] - 1, +m[2]); }
    if (!d || isNaN(d.getTime())) return null;
    var n = new Date(), a = n.getFullYear() - d.getFullYear(), mo = n.getMonth() - d.getMonth();
    if (mo < 0 || (mo === 0 && n.getDate() < d.getDate())) a--;
    return (a >= 0 && a < 130) ? a : null;
  }
  function athenaConnected() { try { if (window.__mlsUxUnify && typeof window.__mlsUxUnify.connected === "function") return !!window.__mlsUxUnify.connected(); } catch (e) {} return false; }
  var _pickScope = "today", _manualPending = null;
  function openPicker() {
    /* prefer the app's native searchable switcher (all patients); then our schedule modal */
    if (window.__mlsPatientSwitcher && typeof window.__mlsPatientSwitcher.open === "function") { window.__mlsPatientSwitcher.open(); return; }
    if (window.__mlsPick && typeof window.__mlsPick.openModal === "function") { window.__mlsPick.openModal({ scope: _pickScope || "today" }); return; }
    if (!clickById("mlscpFind")) callFn("mlsQuickFind");
  }
  function renderPick(scope) {
    if (scope) _pickScope = scope;
    var host = $("simPickGrid"); if (!host) return;
    if (window.__mlsPick && typeof window.__mlsPick.renderGrid === "function") {
      window.__mlsPick.renderGrid(host, { scope: _pickScope, onPick: function () { _manualPending = null; renderBanner(); renderPick(_pickScope); } });
    } else { host.innerHTML = ""; }
  }

  /* ===================== styles ===================== */
  function injectCSS() {
    var css = [
      /* Simple mode: hide the dark hero (with the native #mlsEasyPanel inside) and any
         leaked complex grid/tools/outcomes; the design card replaces them. */
      "html.mls-sv-active #visitView #visitHero{display:none!important}",
      "html.mls-sv-active #visitView .vx-grid,html.mls-sv-active #visitView .vx-tools,html.mls-sv-active #visitView #outcomesCard,html.mls-sv-active #visitView #waitingRoomBar{display:none!important}",
      /* light design backdrop behind the card */
      "html.mls-sv-active #visitView{background-image:radial-gradient(circle at 50% -8%,#e2ecf8 0,rgba(238,242,247,0) 50%)!important}",
      "#" + WRAP_ID + "{max-width:760px;margin:6px auto 0;padding:0 2px 24px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#0f2540;box-sizing:border-box}",
      "#" + WRAP_ID + " *{box-sizing:border-box}",
      "#" + WRAP_ID + " ::placeholder{color:#9aa8bb}",
      "#" + WRAP_ID + " .sim-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}",
      "#" + WRAP_ID + " button{font-family:inherit}",
      "#" + WRAP_ID + " .sim-opt:hover{background:#f2f6fc}",
      "#" + WRAP_ID + " .sim-hero:active{transform:translateY(1px)}",
      "@media(max-width:600px){#" + WRAP_ID + " .sim-grid{grid-template-columns:1fr}#" + WRAP_ID + " .sim-foot{flex-direction:column;align-items:stretch!important}#" + WRAP_ID + " .sim-foot .sim-gorec{width:100%;justify-content:center}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  /* ===================== scaffold ===================== */
  function ensureWrap() {
    var v = $("visitView"); if (!v) return null;
    var w = $(WRAP_ID);
    if (w && w.parentElement === v) return w;
    if (w && w.parentElement !== v) { try { w.parentElement.removeChild(w); } catch (e) {} w = null; }
    w = mk("div"); w.id = WRAP_ID; w.setAttribute("data-mls-asset", "feat_mls_simple_exact.js");
    w.innerHTML =
      '<div id="simStepper" style="display:flex;align-items:center;gap:0;margin-bottom:30px"></div>' +
      '<div id="simBanner"></div>' +
      '<section style="background:#fff;border:1px solid #e4ebf3;border-radius:20px;box-shadow:0 12px 40px -18px rgba(13,33,56,.3);overflow:hidden">' +
        '<div id="simHead" style="padding:30px 32px 0"></div>' +
        '<div id="simBody" style="padding:24px 32px 30px"></div>' +
        '<div id="simFoot" class="sim-foot" style="border-top:1px solid #eef2f7;background:#f8fafc;padding:22px 32px;display:flex;align-items:center;gap:18px;flex-wrap:wrap"></div>' +
      '</section>' +
      '<p style="text-align:center;color:#9aa8bb;font-size:12px;margin-top:20px">' + E.lock + ' Synthetic data only &middot; HIPAA-ready architecture &middot; You sign every note</p>';
    v.insertBefore(w, v.firstChild);
    return w;
  }

  /* ---- stepper ---- */
  function renderStepper(active) {
    var host = $("simStepper"); if (!host) return;
    var done = function (i) { return (active === "done") ? true : (i < active); };
    var isActive = function (i) { return (active !== "done") && (i === active); };
    var html = "";
    for (var i = 1; i <= 5; i++) {
      var d = done(i), a = isActive(i);
      var dot = "width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;" +
        (a ? "background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;box-shadow:0 8px 18px -6px rgba(47,107,237,.6);"
           : d ? "background:#1f9d6b;color:#fff;"
               : "background:#fff;color:#9aa8bb;border:1.5px solid #e0e8f1;");
      var lbl = "font-size:11.5px;font-weight:" + (a ? "700" : "600") + ";color:" + (a ? "#0f2540" : "#9aa8bb") + ";white-space:nowrap;";
      var bar = (i < 5)
        ? '<div style="flex:1;height:2px;margin:0 6px;margin-bottom:24px;border-radius:2px;background:' + (d ? "#1f9d6b" : "#e0e8f1") + '"></div>'
        : "";
      html += '<div style="display:flex;align-items:center;flex:1;min-width:0">' +
        '<div style="display:flex;flex-direction:column;align-items:center;gap:7px;flex-shrink:0">' +
          '<div style="' + dot + '">' + (d ? E.check : String(i)) + '</div>' +
          '<span style="' + lbl + '">' + STEP_NAMES[i - 1] + '</span>' +
        '</div>' + bar + '</div>';
    }
    host.innerHTML = html;
  }

  /* ---- context banner ---- */
  function renderBanner() {
    var host = $("simBanner"); if (!host) return;
    var p = realActive();
    var title, sub, avatarHTML, avatarBg = "#fff4e6", active = false;
    if (p) {
      active = true;
      var bits = [];
      var age = ageOf(p.dob); if (age != null) bits.push(age + "y");
      if (p.sex) bits.push(esc(p.sex));
      if (p.dob) bits.push("DOB " + esc(p.dob));
      title = esc(p.name || "Active patient");
      sub = (bits.join(" &middot; ") || "Active patient") + " &middot; visits attach to this chart";
      avatarHTML = esc(initials(p.name)); avatarBg = "#eef3fb";
    } else if (_manualPending && _manualPending.name) {
      title = esc(_manualPending.name);
      sub = (_manualPending.dob ? ("DOB " + esc(_manualPending.dob) + " &middot; ") : "") + "manual entry &middot; will attach when you record";
      avatarHTML = esc(initials(_manualPending.name)); avatarBg = "#eef3fb";
    } else {
      title = "No active patient yet";
      sub = "Pull the day's patients below, then tap one to select.";
      avatarHTML = E.person;
    }
    var athConn = athenaConnected();
    var statusDot = '<span style="display:flex;align-items:center;gap:6px;background:' + (athConn ? "#eef7f3" : "#f5f7fa") + ';border:1px solid ' + (athConn ? "#cfe9dd" : "#e4ebf3") + ';border-radius:9px;padding:6px 11px;font-size:11.5px;font-weight:600;color:' + (athConn ? "#1f7d5c" : "#8a9cb2") + '"><span style="width:7px;height:7px;border-radius:50%;background:' + (athConn ? "#27b07a" : "#c2cdda") + '"></span>Athena &middot; ' + (athConn ? "connected" : "idle") + '</span>';
    host.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;background:#fff;border:1px solid ' + (active ? "#cfe0fb" : "#e4ebf3") + ';border-radius:13px;padding:13px 16px;margin-bottom:18px;box-shadow:0 1px 2px rgba(15,37,64,.04)">' +
        '<span style="width:36px;height:36px;border-radius:10px;background:' + avatarBg + ';color:#2f6bed;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800">' + avatarHTML + '</span>' +
        '<div style="flex:1;min-width:0;line-height:1.35">' +
          '<div style="font-weight:700;font-size:13.5px;color:#0f2540">' + title + '</div>' +
          '<div style="color:#6b7d93;font-size:12.5px">' + sub + '</div>' +
        '</div>' +
        statusDot +
        '<button id="simSwitch" style="height:34px;padding:0 14px;border-radius:9px;border:1px solid #e0e8f1;background:#fff;color:#2f6bed;font-weight:600;font-size:12.5px;cursor:pointer">Switch patient</button>' +
      '</div>';
    var sw = $("simSwitch"); if (sw) sw.onclick = function () { openPicker(); };
  }

  /* ---- provider <option>s from REAL data only (no fabricated names) ---- */
  function providerOptions() {
    var opts = ['<option>' + E.person + ' All doctors</option>'];
    try {
      var list = window._calProviders || [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i]; if (!p) continue;
        var nm = (p.name || p.displayName || ("Provider " + (p.id || (i + 1)))).toString();
        opts.push('<option>' + esc(nm) + '</option>');
      }
    } catch (e) {}
    return opts.join("");
  }

  /* ===================== per-step head + body + footer ===================== */
  function renderHead(step) {
    var h = $("simHead"); if (!h) return;
    var map = {
      1: ["Step 1 of 5 &middot; Patient", "Who are you seeing?", "Pull the patient you have open in athenaOne &mdash; name, DOB and past visits fill in automatically &mdash; or enter their details by hand."],
      2: ["Step 2 of 5 &middot; Record", isRecording() ? "Listening&hellip;" : "Record the visit", "Press start and just talk naturally. MLS listens and builds the transcript for you &mdash; press stop when you're done."],
      3: ["Step 3 of 5 &middot; Generate", "Generate the note", "Turn the conversation into a clean, structured clinical note."],
      4: ["Step 4 of 5 &middot; Review", "Review the note", "Read it over. Looks right? Move on. Need a tweak? Edit it in the full note editor."],
      5: ["Step 5 of 5 &middot; Sign", "Save the note", "Put the finished note where you need it &mdash; you sign every note."],
      "done": ["Complete", "Visit complete", "Start the next patient when you're ready."]
    };
    var m = map[step] || map[1];
    h.innerHTML =
      '<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#2f6bed;margin-bottom:10px">' + m[0] + '</div>' +
      '<h1 style="font-family:\'Newsreader\',Georgia,serif;font-weight:500;font-size:32px;line-height:1.12;letter-spacing:-.015em;margin-bottom:9px;color:#0f2540">' + m[1] + '</h1>' +
      '<p style="color:#5a6b80;font-size:15px;line-height:1.55;max-width:520px;margin:0">' + m[2] + '</p>';
  }

  function optBtn(id, icon, title, sub) {
    return '<button id="' + id + '" class="sim-opt" style="display:flex;align-items:center;gap:13px;text-align:left;padding:15px 16px;border-radius:14px;border:1px solid #e4ebf3;background:#fbfcfe;cursor:pointer">' +
      '<span style="width:40px;height:40px;border-radius:11px;background:#eef3fb;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">' + icon + '</span>' +
      '<span><span style="display:block;font-weight:700;font-size:14px;color:#0f2540">' + title + '</span>' +
      '<span style="display:block;color:#6b7d93;font-size:12px;margin-top:2px;line-height:1.4">' + sub + '</span></span>' +
    '</button>';
  }

  function renderBody(step) {
    var b = $("simBody"); if (!b) return;

    if (step === 1) {
      b.innerHTML =
        '<label style="display:block;font-size:12.5px;font-weight:700;margin-bottom:8px;color:#3d5168">Whose patients?</label>' +
        '<div style="position:relative;margin-bottom:22px">' +
          '<select id="simWhose" style="width:100%;height:50px;border-radius:13px;border:1px solid #e0e8f1;background:#f8fafc;padding:0 42px 0 16px;font-size:15px;font-weight:600;outline:none;color:#0f2540;-webkit-appearance:none;appearance:none;cursor:pointer">' + providerOptions() + '</select>' +
          '<span style="position:absolute;right:16px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9aa8bb;font-size:12px">' + E.tri + '</span>' +
        '</div>' +
        '<button id="simPullToday" class="sim-hero" style="width:100%;text-align:left;display:flex;align-items:center;gap:18px;padding:22px 24px;border-radius:16px;border:none;cursor:pointer;background:linear-gradient(135deg,#0d2138,#15406f);box-shadow:0 14px 34px -16px rgba(13,33,56,.6);position:relative;overflow:hidden;transition:transform .06s ease">' +
          '<span style="position:absolute;inset:0;background-image:radial-gradient(circle at 92% -30%,rgba(25,184,166,.4),transparent 50%);pointer-events:none"></span>' +
          '<span style="position:relative;width:54px;height:54px;border-radius:14px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-size:24px">' + E.cal + '</span>' +
          '<span style="position:relative;flex:1">' +
            '<span style="display:flex;align-items:center;gap:9px;margin-bottom:3px"><span style="color:#fff;font-weight:700;font-size:17px">Pull today\'s patients</span><span style="font-size:9.5px;font-weight:700;letter-spacing:.05em;color:#0d2138;background:#5fe3cf;padding:2px 8px;border-radius:20px">READ-ONLY</span></span>' +
            '<span style="display:block;color:#bcd2ed;font-size:13px;line-height:1.45">Brings in today\'s schedule from athenaOne. The fastest way to start.</span>' +
          '</span>' +
          '<span style="position:relative;color:#8fe9da;font-size:22px;font-weight:700">' + E.arrow + '</span>' +
        '</button>' +
        '<div class="sim-grid">' +
          optBtn("simPullWeek", E.calWk, "Pull this week's patients", "The whole week's schedule") +
          optBtn("simPullOpen", E.down, "Patient open in athenaOne", "Pull the chart you have open") +
          optBtn("simFind", E.find, "Find a patient by name", "Search and pull one patient") +
          optBtn("simManual", E.pen, "Enter manually", "Type name &amp; DOB yourself") +
        '</div>' +
        '<div id="simPickGrid" style="margin-top:18px"></div>' +
        '<div id="simManualBox" style="display:none;margin-top:14px;background:#fbfcfe;border:1px solid #e4ebf3;border-radius:14px;padding:16px">' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
            '<div style="flex:1;min-width:180px"><label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px;color:#3d5168">Patient name</label>' +
              '<input id="simMName" placeholder="First Last" style="width:100%;height:44px;border-radius:11px;border:1px solid #e0e8f1;background:#fff;padding:0 14px;font-size:14.5px;color:#0f2540"></div>' +
            '<div style="width:160px"><label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px;color:#3d5168">Date of birth</label>' +
              '<input id="simMDob" placeholder="MM/DD/YYYY" style="width:100%;height:44px;border-radius:11px;border:1px solid #e0e8f1;background:#fff;padding:0 14px;font-size:14.5px;color:#0f2540"></div>' +
          '</div>' +
          '<button id="simMUse" style="margin-top:12px;height:42px;padding:0 18px;border-radius:11px;border:none;background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;font-weight:700;font-size:13.5px;cursor:pointer">Use this patient</button>' +
        '</div>' +
        '<p style="text-align:center;color:#8a9cb2;font-size:12.5px;margin-top:16px">Not connected? Use the &ldquo;Whose patients?&rdquo; box above to pick a doctor, then pull.</p>';
      $("simPullToday").onclick = function () { _pickScope = "today"; if (athenaConnected()) clickById("mlscpToday"); renderPick("today"); setTimeout(function () { renderPick("today"); }, 1600); };
      $("simPullWeek").onclick = function () { _pickScope = "week"; if (athenaConnected()) clickById("mlscpWeek"); renderPick("week"); setTimeout(function () { renderPick("week"); }, 1600); };
      $("simPullOpen").onclick = function () { if (!clickById("mlscpSelected")) callFn("pullPatientFromAthenaPrompt", this); setTimeout(renderBanner, 900); };
      $("simFind").onclick = function () { if (!clickById("mlscpFind")) callFn("mlsQuickFind"); };
      $("simManual").onclick = function () { _manual = !_manual; var mb = $("simManualBox"); if (mb) mb.style.display = _manual ? "block" : "none"; if (_manual) { var mn = $("simMName"); if (mn) { mn.value = patientName(); try { mn.focus(); } catch (e) {} } var md = $("simMDob"); if (md) md.value = patientDob(); } };
      $("simMUse").onclick = function () {
        var n = val("simMName").trim(); if (!n) { try { $("simMName").focus(); } catch (e) {} return; }
        var hn = $("heroPtName"), hd = $("heroPtDob");
        if (hn) { hn.value = n; try { hn.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {} }
        if (hd) { hd.value = val("simMDob"); try { hd.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {} }
        _manual = false; var mb = $("simManualBox"); if (mb) mb.style.display = "none";
        _manualPending = { name: n, dob: val("simMDob") };
        renderBanner();
      };
      renderPick(_pickScope);
      return;
    }

    if (step === 2) {
      var rec = isRecording(), canNext = hasTranscript();
      b.innerHTML =
        '<button id="simRec" style="width:100%;display:flex;align-items:center;justify-content:center;gap:12px;padding:22px;border-radius:16px;border:none;cursor:pointer;font-weight:700;font-size:17px;color:#fff;background:' +
          (rec ? "linear-gradient(135deg,#ef4444,#dc2626)" : "linear-gradient(135deg,#0d2138,#15406f)") + ';box-shadow:0 14px 34px -16px rgba(13,33,56,.5)">' +
          (rec ? '<span style="width:12px;height:12px;border-radius:50%;background:#fff;display:inline-block"></span> Stop recording' : (E.mic + ' Start recording')) +
        '</button>' +
        '<div style="margin-top:14px;display:flex;align-items:flex-start;gap:9px;color:#5a6b80;font-size:13.5px;line-height:1.5;background:#f8fafc;border:1px solid #eef2f7;border-radius:12px;padding:13px 15px">' +
          (rec ? "Recording&hellip; the conversation is being captured." : (canNext ? (E.check + " Transcript captured &mdash; you can move on to generate the note.") : "No microphone? You can also type or paste the conversation in the full view.")) +
        '</div>';
      $("simRec").onclick = function () { if (isRecording()) callFn("stopCapture"); else callFn("startCapture"); setTimeout(renderCard, 280); };
      return;
    }

    if (step === 3) {
      var noteReady = hasNote(), working = !!window.__mlsEzGenerating;
      b.innerHTML =
        '<button id="simGen" ' + (working ? "disabled" : "") + ' style="width:100%;display:flex;align-items:center;justify-content:center;gap:12px;padding:22px;border-radius:16px;border:none;cursor:' + (working ? "default" : "pointer") + ';font-weight:700;font-size:17px;color:#fff;background:linear-gradient(135deg,#1f9d6b,#178a5c);box-shadow:0 14px 30px -14px rgba(31,157,107,.6);opacity:' + (working ? ".7" : "1") + '">' +
          (working ? "Generating&hellip;" : (noteReady ? (E.check + " Note ready &mdash; review it") : (E.spark + " Generate note"))) +
        '</button>' +
        '<div style="margin-top:14px;color:#5a6b80;font-size:13.5px;line-height:1.5;background:#f8fafc;border:1px solid #eef2f7;border-radius:12px;padding:13px 15px">' +
          (noteReady ? (E.check + " The note is ready below.") : (hasTranscript() ? "This turns the captured conversation into a structured note." : "No transcript yet &mdash; go back to record first.")) +
        '</div>';
      $("simGen").onclick = function () {
        if (hasNote()) { easyGoto(4); return; }
        if (!hasTranscript()) return;
        window.__mlsEzGenerating = true; callFn("generateNote"); renderCard();
        clearTimeout(window.__mlsSimGenT);
        window.__mlsSimGenT = setTimeout(function () { window.__mlsEzGenerating = false; renderCard(); }, 45000);
      };
      return;
    }

    if (step === 4) {
      var preview = val("noteBox");
      b.innerHTML =
        '<div style="background:#f8fafc;border:1px solid #eef2f7;border-radius:14px;padding:16px 18px;max-height:280px;overflow:auto;white-space:pre-wrap;font-size:13.5px;line-height:1.55;color:#243a55">' +
          (preview.trim() ? esc(preview) : "No note text found &mdash; go back and generate the note.") + '</div>';
      return;
    }

    if (step === 5) {
      var did = (easy() && easy().state && easy().state.did) || {};
      b.innerHTML =
        '<button id="simSave" style="width:100%;display:flex;align-items:center;justify-content:center;gap:12px;padding:22px;border-radius:16px;border:none;cursor:pointer;font-weight:700;font-size:17px;color:#fff;background:linear-gradient(135deg,#1f9d6b,#178a5c);box-shadow:0 14px 30px -14px rgba(31,157,107,.6)">' + E.save + ' Save to chart</button>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:14px">' +
          '<button id="simCopy" class="sim-opt" style="flex:1;min-width:160px;display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;border-radius:13px;border:1px solid #e4ebf3;background:#fbfcfe;cursor:pointer;font-weight:700;font-size:13.5px;color:#0f2540">' + (did.copied ? (E.check + " Copied") : (E.clip + " Copy to Athena")) + '</button>' +
          '<button id="simPdf" class="sim-opt" style="flex:1;min-width:160px;display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;border-radius:13px;border:1px solid #e4ebf3;background:#fbfcfe;cursor:pointer;font-weight:700;font-size:13.5px;color:#0f2540">' + (did.pdf ? (E.check + " PDF saved") : (E.receipt + " Save as PDF")) + '</button>' +
        '</div>' +
        '<div style="margin-top:14px;color:#5a6b80;font-size:13px;line-height:1.5;background:#f8fafc;border:1px solid #eef2f7;border-radius:12px;padding:13px 15px">Saving to chart records this visit in the patient\'s history. You review and sign every note.</div>';
      $("simSave").onclick = function () { callFn("saveCurrentNote", true); if (easy() && easy().state) easy().state.did.saved = true; setTimeout(function () { easyGoto("done"); }, 600); };
      $("simCopy").onclick = function () { callFn("copyForEMR"); if (easy() && easy().state) easy().state.did.copied = true; renderCard(); };
      $("simPdf").onclick = function () { var btn = findPdfBtn(); if (btn) { try { btn.click(); if (easy() && easy().state) easy().state.did.pdf = true; } catch (e) {} } renderCard(); };
      return;
    }

    if (step === "done") {
      b.innerHTML =
        '<div style="text-align:center;padding:10px 0 4px"><div style="width:60px;height:60px;border-radius:50%;background:#e7f5ee;color:#1f9d6b;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 14px">' + E.check + '</div>' +
        '<div style="font-weight:700;font-size:16px;color:#0f2540">This visit is done.</div>' +
        '<div style="color:#6b7d93;font-size:13.5px;margin-top:4px">The note is saved. Start the next patient when you\'re ready.</div></div>';
      return;
    }
  }

  function findPdfBtn() {
    try {
      var v = $("visitView") || document;
      var btns = v.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || "").trim();
        var oc = (btns[i].getAttribute("onclick") || "");
        if (/save as pdf/i.test(t) && !/legal/i.test(oc) && !oc.trim()) return btns[i];
      }
      for (var j = 0; j < btns.length; j++) { if (/save as pdf/i.test(btns[j].textContent || "")) return btns[j]; }
    } catch (e) {}
    return null;
  }

  function renderFoot(step) {
    var f = $("simFoot"); if (!f) return;
    if (step === 1) {
      f.innerHTML =
        '<div style="flex:1;min-width:200px"><div style="font-weight:700;font-size:14px">Ready when you are</div>' +
        '<div style="color:#6b7d93;font-size:12.5px;margin-top:1px">Choose who you\'re seeing, then move on to recording.</div></div>' +
        '<button id="simGoRec" class="sim-gorec" style="height:54px;padding:0 28px;border-radius:14px;border:none;background:linear-gradient(135deg,#1f9d6b,#178a5c);color:#fff;font-weight:700;font-size:15.5px;cursor:pointer;display:flex;align-items:center;gap:10px;box-shadow:0 12px 26px -10px rgba(31,157,107,.6)">' + E.mic + ' Go to recording <span style="font-size:17px">' + E.arrow + '</span></button>';
      $("simGoRec").onclick = function () { easyGoto(2); };
      return;
    }
    if (step === "done") {
      f.innerHTML = '<div style="flex:1;min-width:160px"></div>' +
        '<button id="simNext" class="sim-gorec" style="height:50px;padding:0 24px;border-radius:13px;border:none;background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;font-weight:700;font-size:14.5px;cursor:pointer">Start next patient ' + E.arrow + '</button>';
      $("simNext").onclick = function () { callFn("newVisit"); _manual = false; easyGoto(1); };
      return;
    }
    /* steps 2-5: Back + primary advance */
    var primaryId = "", primaryLabel = "", primaryOn = true;
    if (step === 2) { primaryId = "simNext2"; primaryLabel = "Next: Generate " + E.arrow; primaryOn = hasTranscript(); }
    else if (step === 3) { primaryId = "simNext3"; primaryLabel = "Review the note " + E.arrow; primaryOn = hasNote(); }
    else if (step === 4) { primaryId = "simNext4"; primaryLabel = "Looks good " + E.arrow; primaryOn = true; }
    else if (step === 5) { primaryId = "simNext5"; primaryLabel = "Finish " + E.arrow; primaryOn = true; }
    var extra = (step === 4)
      ? '<button id="simEdit" style="height:46px;padding:0 18px;border-radius:12px;border:1px solid #e0e8f1;background:#fff;color:#2f6bed;font-weight:700;font-size:14px;cursor:pointer">Edit the note</button>'
      : "";
    f.innerHTML =
      '<button id="simBack" style="height:46px;padding:0 16px;border-radius:12px;border:1px solid #e0e8f1;background:#fff;color:#3d5168;font-weight:600;font-size:14px;cursor:pointer">' + E.larrow + ' Back</button>' +
      '<div style="flex:1"></div>' + extra +
      '<button id="' + primaryId + '" ' + (primaryOn ? "" : "disabled") + ' style="height:50px;padding:0 24px;border-radius:13px;border:none;background:linear-gradient(135deg,#1f9d6b,#178a5c);color:#fff;font-weight:700;font-size:14.5px;cursor:' + (primaryOn ? "pointer" : "not-allowed") + ';opacity:' + (primaryOn ? "1" : ".5") + ';display:flex;align-items:center;gap:8px">' + primaryLabel + '</button>';
    var back = $("simBack"); if (back) back.onclick = function () { var s = curStep(); if (typeof s === "number" && s > 1) easyGoto(s - 1); };
    var ed = $("simEdit"); if (ed) ed.onclick = function () { var e = easy(); if (e && e.state) { e.state.mode = "full"; if (typeof e.render === "function") { try { e.render(); } catch (x) {} } } var nb = $("noteBox"); if (nb) { try { nb.scrollIntoView({ behavior: "smooth", block: "center" }); nb.focus(); } catch (x) {} } };
    var pr = $(primaryId);
    if (pr) pr.onclick = function () {
      var s = curStep();
      if (s === 2) { if (hasTranscript()) easyGoto(3); }
      else if (s === 3) { if (hasNote()) easyGoto(4); }
      else if (s === 4) { easyGoto(5); }
      else if (s === 5) { easyGoto("done"); }
    };
  }

  /* ===================== render orchestration ===================== */
  function renderCard() {
    if (!isSimple()) { hideWrap(); return; }
    var w = ensureWrap(); if (!w) return;
    w.style.display = "";
    var step = curStep();
    renderStepper(step);
    renderBanner();
    renderHead(step);
    renderBody(step);
    renderFoot(step);
  }
  function hideWrap() { var w = $(WRAP_ID); if (w) w.style.display = "none"; }

  /* sync on a light interval: rebuild if missing, re-render on state change */
  function sync() {
    if (!isSimple()) { hideWrap(); _lastSig = ""; return; }
    injectCSS();
    var ra = realActive();
    var sig = String(curStep()) + "|" + isRecording() + "|" + hasTranscript() + "|" + hasNote() + "|" + patientName() + "|" + (ra ? ra.id : "") + "|" + (!!window.__mlsEzGenerating);
    var w = $(WRAP_ID);
    if (!w || w.parentElement !== $("visitView") || sig !== _lastSig) {
      _lastSig = sig;
      /* note appeared while generating on step 3 -> let native advance; mirror it */
      renderCard();
    }
  }

  function boot() {
    injectCSS();
    try { _obs = new MutationObserver(function () { if (_schedT) return; _schedT = setTimeout(function () { _schedT = null; sync(); }, 160); }); _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    sync();
    _t = setInterval(sync, 400);
  }

  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_t) clearInterval(_t); } catch (e) {}
    try { var w = $(WRAP_ID); if (w) w.remove(); } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { window.__mlsSimX.installed = false; } catch (e) {}
  }

  window.__mlsSimX = { installed: true, version: VERSION, render: renderCard, reapply: boot, revert: revert };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
