/* feat_mls_assistant_exact.js  ->  window.__mlsAsst  (asst-2.0.0)
 *
 *  THE full design-language MLS Assistant panel (Slice 3 of the Assistant rework).
 *  STAGING-FIRST, then prod via the data: staging marker (self-gated exactly like the
 *  other *_exact modules), so it activates on BOTH.
 *
 *  WHAT THIS PANEL IS
 *  ------------------
 *  ONE clean, good-looking panel that matches the redesign (white card, Plus Jakarta
 *  Sans / Newsreader, blue gradient accents) with two tabs:
 *
 *    SCHEDULE tab
 *      - The honest connection status (Slice 1) read straight from window.__mlsConnTruth.
 *      - PULL CONTROLS: an ANY-DAY date picker (Today / Tomorrow / pick a date) + a dynamic
 *        PROVIDER dropdown built from window._calProviders (generic; no hardcoded names) +
 *        a "Pull from athenaOne" action that GATES on the real connection truth (no fake
 *        success; honest in-panel status).
 *      - Real, honest day selection: the chosen day is respected. If that day has no
 *        scheduled patients we say so plainly (NO silent fallback to "most recent day").
 *      - Live OP-NOTES COUNT + patient count derived from the REAL set for the chosen
 *        day+provider (never a hardcoded 0).
 *      - SELECTABLE patient cards for the chosen day (time, name, age, reason). One click
 *        selects through the app's own window.openPatient (via __mlsPick.select) -> sets the
 *        active patient and refreshes the patient context bar.
 *      - PER-ITEM Athena WRITEBACK STATUS on every card: "pulled at <time> . saved to
 *        athenaOne: yes / no / not yet". "yes" appears ONLY on a genuine, confirmed write
 *        (feat_athena_writeback's confirmed step), "no" only on a real failed write, and a
 *        real pull stamps the "pulled at <time>". Persisted to localStorage. No fabrication.
 *
 *    CHAT tab
 *      - The real AI chat wired to the SAME backend the in-app Copilot uses
 *        (POST {bkBase}/api/copilot with {question, context, history}, Bearer bkToken).
 *        Replies are the model's real text. If not signed in, it says so honestly.
 *
 *  ALSO (carried from Slice 1, unchanged)
 *  --------------------------------------
 *   - Neutralizes feat_athena_selfheal.js (the scripted "fixing Athena" retry panel + its
 *     downstream auto-open of athenaOne). Nothing auto-opens athenaOne; "Connect athenaOne"
 *     opens it ONLY on the user's click.
 *   - Hides the duplicate floating status surfaces (#mlsuxPanel, .mlssh-toast). Does NOT
 *     touch the .mlsaa-tl write-back timeline (the real confirmation flow uses it).
 *
 *  SAFETY: additive, idempotent (built once; re-renders only on real changes -> no flicker),
 *  reversible (window.__mlsAsst.revert()). Reads the app's OWN data (getPatients, _calAppts,
 *  _calProviders) read-only; selects via the app's blessed openPatient. NEVER writes/saves/
 *  signs a chart and NEVER drives athenaOne. No PHI logged or sent beyond what the app's own
 *  copilotSnapshot() already sends to its own backend. ASCII-only.
 */
;(function () {
  "use strict";
  var VERSION = "asst-2.0.0";
  try { if (window.__mlsAsst && window.__mlsAsst.installed) return; } catch (e) { return; }

  /* ---------- self-gate: staging page OR prod staging-marker (active on both) ---------- */
  function gateOn() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!gateOn()) { try { window.__mlsAsst = { installed: false, skipped: "gate" }; } catch (e) {} return; }

  /* ---------- tiny helpers ---------- */
  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
  function isFn(f) { return typeof f === "function"; }
  function isGFn(n) { try { return typeof window[n] === "function"; } catch (e) { return false; } }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ct() { return safe(function () { return window.__mlsConnTruth || null; }, null); }

  /* ---------- app data (read-only) ---------- */
  function getPatients() { try { return (window.getPatients && window.getPatients()) || []; } catch (e) { return []; } }
  function appts() { try { return Array.isArray(window._calAppts) ? window._calAppts : []; } catch (e) { return []; } }
  function providers() { try { return Array.isArray(window._calProviders) ? window._calProviders : []; } catch (e) { return []; } }
  function activeId() { try { return (window.getActivePtId && window.getActivePtId()) || null; } catch (e) { return null; } }
  function activePatient() {
    try { if (window.__mlsPick && isFn(window.__mlsPick.activePatient)) { var a = window.__mlsPick.activePatient(); if (a) return a; } } catch (e) {}
    try { if (isFn(window.activePatient)) { var b = window.activePatient(); if (b) return b; } } catch (e) {}
    var id = activeId(); if (!id) return null;
    var ps = getPatients(); for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === id) return ps[i];
    return null;
  }
  function apptDate(a) {
    try { if (isFn(window._calDateOf)) return window._calDateOf(a); } catch (e) {}
    return (a && (a.appt_date || String(a.start_at || "").slice(0, 10))) || "";
  }

  /* ---------- dates ---------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function localDateStr(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayStr() { return localDateStr(new Date()); }
  function addDaysStr(ds, n) {
    var m = String(ds || "").match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return ds;
    var d = new Date(+m[1], +m[2] - 1, +m[3]); d.setDate(d.getDate() + n); return localDateStr(d);
  }
  function prettyFull(ds) {
    var m = String(ds || "").match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return ds || "";
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    try { return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); } catch (e) { return ds; }
  }

  /* =====================================================================
   *  EASTERN TIME (America/New_York, EST/EDT) -- FORCED, per Michael's
   *  requirement. Appointment start_at is stored UTC; we always render it
   *  in Eastern, never browser-local and never raw UTC. We also INSTALL the
   *  app's dormant TZ hooks (_fmtApptTime / _apptMinsTz / _apptHHMMTz /
   *  _calDateOf) -- which the picker, the "today" hero and the day-bucketing
   *  CALL but the codebase never DEFINED -- so the SAME Eastern rendering
   *  lights up across the picker + calendar-feed + this panel at once.
   * ===================================================================== */
  var EST_TZ = "America/New_York";
  function estDateObj(iso) {
    var s = String(iso == null ? "" : iso);
    if (!/T/.test(s)) return null;
    var hasZone = /[zZ]$/.test(s) || /[+\-]\d{2}:?\d{2}$/.test(s);
    var d = new Date(hasZone ? s : s + "Z");          /* naive ISO is stored UTC -> force UTC */
    return isNaN(d.getTime()) ? null : d;
  }
  function estParts(d) {
    try {
      var f = new Intl.DateTimeFormat("en-US", { timeZone: EST_TZ, hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      var ps = f.formatToParts(d), o = {};
      for (var i = 0; i < ps.length; i++) o[ps[i].type] = ps[i].value;
      var h = +o.hour; if (h === 24) h = 0;
      return { y: +o.year, mo: +o.month, da: +o.day, h: h, mi: +o.minute };
    } catch (e) { return null; }
  }
  function apptMins(t) {                                /* minutes-since-midnight in Eastern */
    var d = estDateObj(t);
    if (d) { var p = estParts(d); if (p) return p.h * 60 + p.mi; }
    var s = String(t == null ? "" : t);
    var m = s.match(/T(\d{2}):(\d{2})/) || s.match(/(?:^|\s)(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var h = +m[1], mi = +m[2]; if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return h * 60 + mi;
  }
  function fmtTime(t) {                                 /* "h:mm AM" in Eastern */
    var d = estDateObj(t);
    if (d) { try { return new Intl.DateTimeFormat("en-US", { timeZone: EST_TZ, hour: "numeric", minute: "2-digit" }).format(d); } catch (e) {} }
    var mins = apptMins(t); if (mins == null) return "";
    var h = Math.floor(mins / 60), mi = mins % 60;
    var ap = h < 12 ? "AM" : "PM"; var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + (mi < 10 ? "0" : "") + mi + " " + ap;
  }
  function estDateKey(iso) {                            /* the Eastern calendar day for an ISO */
    var d = estDateObj(iso); if (!d) return String(iso == null ? "" : iso).slice(0, 10);
    var p = estParts(d); if (!p) return String(iso).slice(0, 10);
    return p.y + "-" + pad2(p.mo) + "-" + pad2(p.da);
  }
  function nowMins() { var p = estParts(new Date()); var dd = new Date(); return p ? (p.h * 60 + p.mi) : (dd.getHours() * 60 + dd.getMinutes()); }
  function nowClock() { try { return new Intl.DateTimeFormat("en-US", { timeZone: EST_TZ, hour: "numeric", minute: "2-digit" }).format(new Date()); } catch (e) { return "now"; } }

  /* Install the forced-Eastern hooks the app already calls (saving originals for revert). */
  var _origHooks = {}, _hooksInstalled = false;
  function installEstHooks() {
    try {
      var names = ["_fmtApptTime", "_apptMinsTz", "_apptHHMMTz", "_calDateOf"];
      for (var i = 0; i < names.length; i++) { if (!(names[i] in _origHooks)) _origHooks[names[i]] = window[names[i]]; }
      window._fmtApptTime = function (iso) { var v = fmtTime(iso); return v || null; };
      window._apptMinsTz  = function (iso) { var v = apptMins(iso); return v == null ? null : v; };
      window._apptHHMMTz  = function (iso) { var v = fmtTime(iso); return v || ""; };
      window._calDateOf   = function (a) { try { if (a && a.appt_date) return String(a.appt_date).slice(0, 10); if (a && a.start_at) return estDateKey(a.start_at); } catch (e) {} return ""; };
      window.__mlsEstForced = EST_TZ;
      _hooksInstalled = true;
    } catch (e) {}
  }
  installEstHooks();   /* synchronous, ASAP, before any picker render on a fresh load */
  function fmtStamp(iso) {
    if (!iso) return "";
    try { var d = new Date(iso); if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) {}
    return "";
  }

  /* ---------- patient demographics ---------- */
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/);
    if (!parts.length || !parts[0]) return "?";
    var a = parts[0][0] || ""; var b = parts.length > 1 ? (parts[parts.length - 1][0] || "") : "";
    return (a + b).toUpperCase();
  }
  function parseDob(dob) {
    var s = String(dob || "").trim(); if (!s) return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
    var d = new Date(s); return isNaN(d.getTime()) ? null : d;
  }
  function ageFromDob(dob) {
    var d = parseDob(dob); if (!d || isNaN(d.getTime())) return null;
    var now = new Date(); var a = now.getFullYear() - d.getFullYear();
    var mo = now.getMonth() - d.getMonth();
    if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) a--;
    return (a >= 0 && a < 130) ? a : null;
  }

  /* ---------- match an appointment to an existing patient record (read-only) ---------- */
  function buildIndex() {
    var ps = getPatients(), byExt = {}, byNameDob = {}, byName = {};
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i]; if (!p) continue;
      if (p.external_id != null && p.external_id !== "") byExt[String(p.external_id)] = p;
      var nm = (p.name || "").toLowerCase();
      if (nm) { byNameDob[nm + "|" + (p.dob || "")] = p; if (!byName[nm]) byName[nm] = p; }
    }
    return { byExt: byExt, byNameDob: byNameDob, byName: byName };
  }
  function matchAppt(a, idx) {
    if (a.patient_external_id != null && idx.byExt[String(a.patient_external_id)]) return idx.byExt[String(a.patient_external_id)];
    var nm = (a.name || "").toLowerCase();
    if (nm && idx.byNameDob[nm + "|" + (a.dob || "")]) return idx.byNameDob[nm + "|" + (a.dob || "")];
    if (nm && idx.byName[nm]) return idx.byName[nm];
    return null;
  }
  function providerId(name) {
    var list = providers();
    for (var i = 0; i < list.length; i++) {
      var nm = (list[i].name || list[i].displayName || "").toString();
      if (nm && nm.toLowerCase() === String(name || "").toLowerCase()) return list[i].id;
    }
    return null;
  }

  /* ---------- the honest day list for an EXPLICIT date (NO silent fallback) ---------- */
  function dayList(dateStr, provider) {
    var all = appts(), idx = buildIndex();
    var pool = all.filter(function (a) { return apptDate(a) === dateStr; });
    if (provider && !/all/i.test(provider)) {
      var pid = providerId(provider);
      if (pid != null) {
        var narrowed = pool.filter(function (a) { return a.doctor_user_id != null && String(a.doctor_user_id) === String(pid); });
        if (narrowed.length) pool = narrowed;   /* only narrow when it actually leaves someone */
      }
    }
    pool = pool.slice().sort(function (a, b) { return String(a.start_at || a.appt_date || "").localeCompare(String(b.start_at || b.appt_date || "")); });
    var seen = {}, out = [];
    for (var i = 0; i < pool.length; i++) {
      var a = pool[i];
      var key = (a.patient_external_id || "") + "|" + (a.name || "") + "|" + (a.dob || "");
      if (seen[key]) continue; seen[key] = 1;
      var p = matchAppt(a, idx); if (!p) continue;
      out.push({ id: p.id, name: p.name || a.name || "(unnamed)", dob: p.dob || a.dob || "",
        sex: p.sex || "", reason: a.reason || "", time: a.start_at || "", mins: apptMins(a.start_at) });
    }
    return out;
  }
  /* op-note candidates: appointments whose reason reads like a procedure / operative visit.
     Honest, derived from the real set (never a hardcoded 0); labeled as "candidates". */
  var OPNOTE_RE = /\b(op|surg|surgery|surgical|proc|procedure|inject|injection|fracture|repair|excision|removal|scope|arthro|laparo|endoscop|biopsy|suture|incision|drainage|aspiration|debridement)\b/i;
  function opNoteCount(list) {
    var n = 0; for (var i = 0; i < list.length; i++) if (OPNOTE_RE.test(String(list[i].reason || ""))) n++;
    return n;
  }

  /* ---------- provider <option>s (dynamic, from _calProviders) ---------- */
  function providerOptionsHTML(selected) {
    try { if (window.__mlsPick && isFn(window.__mlsPick.providerOptionsHTML)) return window.__mlsPick.providerOptionsHTML(selected); } catch (e) {}
    var sel = selected || "All doctors";
    var opts = ['<option' + (/all/i.test(sel) ? " selected" : "") + ">All doctors</option>"];
    var list = providers();
    for (var i = 0; i < list.length; i++) {
      var nm = (list[i].name || list[i].displayName || ("Provider " + (list[i].id || (i + 1)))).toString();
      opts.push("<option" + (nm === sel ? " selected" : "") + ">" + esc(nm) + "</option>");
    }
    return opts.join("");
  }

  /* =====================================================================
   *  PER-ITEM ATHENA WRITEBACK STATE  (real signals only, persisted)
   * ===================================================================== */
  var WB_KEY = "mlsAsstWB";
  function wbLoad() {
    try { var o = JSON.parse(localStorage.getItem(WB_KEY) || "{}"); return (o && o.items) ? o : { v: 1, items: {} }; }
    catch (e) { return { v: 1, items: {} }; }
  }
  function wbSave(o) { try { localStorage.setItem(WB_KEY, JSON.stringify(o)); } catch (e) {} }
  function wbGet(id) { var o = wbLoad(); return o.items[String(id)] || null; }
  function wbMark(id, field, ts) {
    if (id == null) return;
    var o = wbLoad(); var k = String(id); var rec = o.items[k] || {};
    rec[field] = ts || new Date().toISOString();
    if (field === "savedAt") { rec.failedAt = null; }            /* a confirmed save clears a prior failure */
    o.items[k] = rec; wbSave(o);
  }
  function wbMarkPulled(ids) {
    if (!ids || !ids.length) return;
    var o = wbLoad(), now = new Date().toISOString();
    for (var i = 0; i < ids.length; i++) { var k = String(ids[i]); var rec = o.items[k] || {}; rec.pulledAt = now; o.items[k] = rec; }
    wbSave(o);
  }
  /* the honest per-card writeback line */
  function wbLine(id) {
    var rec = wbGet(id);
    if (rec && rec.savedAt) return { cls: "yes", text: "saved to athenaOne: yes" + (fmtStamp(rec.savedAt) ? " (" + fmtStamp(rec.savedAt) + ")" : "") };
    var pulled = rec && rec.pulledAt ? ("pulled at " + (fmtStamp(rec.pulledAt) || "earlier")) : "on schedule";
    if (rec && rec.failedAt && !(rec.savedAt)) return { cls: "no", text: pulled + " . saved to athenaOne: no (write failed)" };
    return { cls: "notyet", text: pulled + " . saved to athenaOne: not yet" };
  }

  /* ---------- detect a GENUINE confirmed write (no fabrication) ----------
     feat_athena_writeback.writeNoteToChart writes the note into the OPEN chart and, only
     when resp.ok && resp.confirmed, routes a "Wrote the note into the chart's note field
     - confirmed" step through the shared section-61 timeline (__mlsAthenaActions._step). We wrap
     writeNoteToChart (to know WHICH patient is being written) and _step (to read the real
     confirmed / failed signal). Both wraps are idempotent + reverted on revert(). */
  var _wbInFlight = null, _wbWrapped = false, _stepWrapped = false, _origStep = null, _origWrite = null;
  function wrapWriteback() {
    var wb = safe(function () { return window.__mlsAthenaWriteback; }, null);
    if (wb && isFn(wb.writeNoteToChart) && !wb.writeNoteToChart.__mlsAsstWrapped) {
      _origWrite = wb.writeNoteToChart;
      var w = function () {
        _wbInFlight = { id: activeId(), t: Date.now() };
        try { return _origWrite.apply(this, arguments); } catch (e) { return undefined; }
      };
      w.__mlsAsstWrapped = true;
      try { wb.writeNoteToChart = w; _wbWrapped = true; } catch (e) {}
    }
    var aa = safe(function () { return window.__mlsAthenaActions; }, null);
    if (aa && isFn(aa._step) && !aa._step.__mlsAsstWrapped) {
      _origStep = aa._step;
      var s = function (text, state) {
        var r; try { r = _origStep.apply(this, arguments); } catch (e) {}
        safe(function () {
          var txt = String(text || "");
          if (_wbInFlight && _wbInFlight.id != null) {
            if (state === "done" && /wrote the note into the chart/i.test(txt) && /confirm/i.test(txt)) {
              wbMark(_wbInFlight.id, "savedAt"); var fin = _wbInFlight.id; _wbInFlight = null;
              setTimeout(function () { renderSchedule(); }, 0);
              return;
            }
            if (state === "fail" && /(could ?n.?t write the note|nothing was confirmed)/i.test(txt)) {
              wbMark(_wbInFlight.id, "failedAt"); _wbInFlight = null;
              setTimeout(function () { renderSchedule(); }, 0);
            }
          }
        });
        return r;
      };
      s.__mlsAsstWrapped = true;
      try { aa._step = s; _stepWrapped = true; } catch (e) {}
    }
  }
  var _wbPoll = null, _wbTries = 0;
  function startWbWatch() {
    wrapWriteback();
    _wbPoll = setInterval(function () { _wbTries++; wrapWriteback(); if (_wbTries > 25) { clearInterval(_wbPoll); _wbPoll = null; } }, 1000);
  }

  /* =====================================================================
   *  PART A - neutralize the scripted self-heal retry panel + auto-open
   * ===================================================================== */
  var _healPoll = null, _healTries = 0;
  function neutralizeSelfHeal() {
    var sh = safe(function () { return window.__mlsAthenaSelfHeal; }, null);
    if (!sh) return false;
    safe(function () { if (sh.installed && isFn(sh.revert)) sh.revert(); });
    safe(function () {
      sh.attemptRecovery = function () { return Promise.resolve({ fixed: false, neutralized: true }); };
      sh.narrate = function () {};
    });
    return true;
  }
  function startHealWatch() {
    neutralizeSelfHeal();
    _healPoll = setInterval(function () {
      _healTries++;
      var ok = neutralizeSelfHeal();
      if (ok || _healTries > 20) { clearInterval(_healPoll); _healPoll = null; }
    }, 1000);
  }

  /* ---------- hide the duplicate floating status surfaces (NOT the writeback timeline) ---------- */
  var SUPPRESS_ID = "mlsAsstSuppress";
  function injectSuppress() {
    if ($(SUPPRESS_ID)) return;
    var s = el("style"); s.id = SUPPRESS_ID;
    s.textContent = "#mlsuxPanel,.mlssh-toast{display:none !important;}";
    (document.head || document.documentElement).appendChild(s);
  }

  /* =====================================================================
   *  PART B - the panel
   * ===================================================================== */
  var PANEL_ID = "mlsAsstPanel", FAB_ID = "mlsAsstFab", STYLE_ID = "mlsAsstStyle";
  var history = [];           // chat: {role:'user'|'ai'|'pending', text}
  var busy = false;
  var unsub = null;
  var tab = "schedule";       // 'schedule' | 'chat'
  var selDate = todayStr();
  var selProvider = "All doctors";

  function injectStyle() {
    if ($(STYLE_ID)) return;
    var s = el("style"); s.id = STYLE_ID;
    s.textContent = [
      "@import url('https://fonts.googleapis.com/css2?family=Newsreader:wght@400;500&display=swap');",
      "#" + FAB_ID + "{position:fixed;left:18px;bottom:18px;z-index:2147483600;",
      "background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;border:none;border-radius:999px;padding:11px 17px;",
      "font:700 13px/1 'Plus Jakarta Sans',system-ui,Arial,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(34,87,207,.34);}",
      "#" + FAB_ID + " .dot{display:inline-block;width:8px;height:8px;border-radius:50%;",
      "margin-right:8px;vertical-align:middle;background:#9aa0a6;box-shadow:0 0 0 2px rgba(255,255,255,.5);}",
      "#" + PANEL_ID + "{position:fixed;left:18px;bottom:18px;z-index:2147483601;width:412px;",
      "max-width:calc(100vw - 24px);height:640px;max-height:calc(100vh - 36px);display:none;flex-direction:column;",
      "background:#fff;color:#0f2540;border:1px solid #e4ebf3;border-radius:18px;",
      "box-shadow:0 26px 64px -20px rgba(8,18,33,.55);font:13px/1.45 'Plus Jakarta Sans',system-ui,Arial,sans-serif;overflow:hidden;}",
      "#" + PANEL_ID + ".open{display:flex;}",
      /* header */
      "#" + PANEL_ID + " .as-head{display:flex;align-items:center;gap:10px;padding:15px 18px 13px;",
      "background:linear-gradient(135deg,#0f2540,#16335a);color:#fff;}",
      "#" + PANEL_ID + " .as-title{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:19px;flex:1;}",
      "#" + PANEL_ID + " .as-x{background:rgba(255,255,255,.12);border:none;color:#dce7f7;font-size:17px;cursor:pointer;",
      "width:30px;height:30px;border-radius:8px;line-height:1;}",
      "#" + PANEL_ID + " .as-x:hover{background:rgba(255,255,255,.2);}",
      /* status strip */
      "#" + PANEL_ID + " .as-status{display:flex;align-items:flex-start;gap:9px;padding:11px 18px;",
      "border-bottom:1px solid #eef2f7;background:#f7fafe;}",
      "#" + PANEL_ID + " .as-sdot{width:9px;height:9px;border-radius:50%;margin-top:4px;flex:0 0 auto;background:#9aa0a6;}",
      "#" + PANEL_ID + " .as-stext{flex:1 1 auto;min-width:0;}",
      "#" + PANEL_ID + " .as-slabel{font-weight:700;font-size:12.5px;color:#0f2540;}",
      "#" + PANEL_ID + " .as-sdetail{font-size:11.5px;color:#5a6b80;margin-top:2px;}",
      "#" + PANEL_ID + " .as-connect{margin-top:8px;display:inline-block;background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;",
      "border:none;border-radius:8px;padding:7px 13px;font:700 12px/1 'Plus Jakarta Sans';cursor:pointer;}",
      /* tabs */
      "#" + PANEL_ID + " .as-tabs{display:flex;gap:6px;padding:10px 14px 0;}",
      "#" + PANEL_ID + " .as-tab{flex:1;height:36px;border-radius:10px 10px 0 0;border:1px solid #e4ebf3;border-bottom:none;",
      "background:#f1f5fb;color:#5a6b80;font:700 12.5px/1 'Plus Jakarta Sans';cursor:pointer;}",
      "#" + PANEL_ID + " .as-tab.on{background:#fff;color:#1f4fd1;box-shadow:0 -2px 0 #2f6bed inset;}",
      /* body */
      "#" + PANEL_ID + " .as-body{flex:1 1 auto;overflow-y:auto;border-top:1px solid #e4ebf3;}",
      "#" + PANEL_ID + " .as-pane{padding:14px 16px;}",
      "#" + PANEL_ID + " .as-pane[hidden]{display:none;}",
      /* pull controls */
      "#" + PANEL_ID + " .as-pull{border:1px solid #e7edf5;border-radius:13px;padding:12px;background:#fbfcff;margin-bottom:13px;}",
      "#" + PANEL_ID + " .as-pull h4{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:16px;margin:0 0 9px;color:#0f2540;}",
      "#" + PANEL_ID + " .as-dayrow{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:9px;}",
      "#" + PANEL_ID + " .as-daybtn{height:32px;padding:0 12px;border-radius:8px;border:1px solid #dbe6f6;background:#fff;",
      "color:#3d5168;font:700 12px/1 'Plus Jakarta Sans';cursor:pointer;}",
      "#" + PANEL_ID + " .as-daybtn.on{background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;border-color:transparent;}",
      "#" + PANEL_ID + " .as-date{height:32px;border-radius:8px;border:1px solid #dbe6f6;background:#fff;padding:0 8px;",
      "font:600 12px/1 'Plus Jakarta Sans';color:#0f2540;}",
      "#" + PANEL_ID + " .as-provrow{display:flex;gap:8px;align-items:center;margin-bottom:10px;}",
      "#" + PANEL_ID + " select.as-prov{flex:1;height:34px;border-radius:9px;border:1px solid #dbe6f6;background:#fff;",
      "padding:0 28px 0 10px;font:600 12.5px/1 'Plus Jakarta Sans';color:#0f2540;cursor:pointer;-webkit-appearance:none;appearance:none;}",
      "#" + PANEL_ID + " .as-pullbtn{width:100%;height:42px;border-radius:11px;border:none;cursor:pointer;",
      "background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;font:800 13px/1 'Plus Jakarta Sans';}",
      "#" + PANEL_ID + " .as-pullbtn:disabled{opacity:.55;cursor:default;}",
      "#" + PANEL_ID + " .as-pullstatus{font-size:11.5px;color:#5a6b80;margin-top:8px;min-height:14px;}",
      "#" + PANEL_ID + " .as-pullstatus.ok{color:#16a34a;}",
      /* stats */
      "#" + PANEL_ID + " .as-stats{display:flex;gap:9px;margin-bottom:12px;}",
      "#" + PANEL_ID + " .as-stat{flex:1;border:1px solid #e7edf5;border-radius:11px;padding:9px 11px;background:#fff;}",
      "#" + PANEL_ID + " .as-stat b{display:block;font-size:20px;font-weight:800;color:#1f4fd1;line-height:1.1;}",
      "#" + PANEL_ID + " .as-stat span{display:block;font-size:10.5px;color:#6b7d93;margin-top:2px;text-transform:uppercase;letter-spacing:.04em;}",
      /* patient cards */
      "#" + PANEL_ID + " .as-listhd{font-size:11.5px;color:#6b7d93;margin:0 0 9px;}",
      "#" + PANEL_ID + " .as-pcard{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 11px;margin-bottom:9px;",
      "border-radius:12px;border:1px solid #e4ebf3;background:#fff;cursor:pointer;font-family:inherit;transition:border-color .12s,box-shadow .12s;}",
      "#" + PANEL_ID + " .as-pcard:hover{border-color:#b9d0f3;box-shadow:0 8px 20px -14px rgba(13,33,56,.4);}",
      "#" + PANEL_ID + " .as-pcard.is-active{border-color:#2f6bed;box-shadow:0 0 0 2px rgba(47,107,237,.18);}",
      "#" + PANEL_ID + " .as-ptime{flex:0 0 auto;min-width:58px;text-align:center;font-weight:700;font-size:11.5px;color:#15406f;",
      "background:#eef3fb;border:1px solid #dbe6f6;border-radius:8px;padding:5px 6px;line-height:1.15;}",
      "#" + PANEL_ID + " .as-ptime small{display:block;font-size:8.5px;font-weight:800;letter-spacing:.05em;color:#7e93ad;margin-top:1px;}",
      "#" + PANEL_ID + " .as-pcard.is-now .as-ptime{background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;border-color:transparent;}",
      "#" + PANEL_ID + " .as-pcard.is-now .as-ptime small{color:#cfe0fb;}",
      "#" + PANEL_ID + " .as-pcard.is-now{border-color:#2f6bed;}",
      "#" + PANEL_ID + " .as-pav{width:38px;height:38px;border-radius:11px;background:#eef3fb;color:#2f6bed;display:flex;",
      "align-items:center;justify-content:center;font-weight:800;font-size:13px;flex:0 0 auto;}",
      "#" + PANEL_ID + " .as-pcard.is-active .as-pav{background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;}",
      "#" + PANEL_ID + " .as-pinfo{flex:1;min-width:0;line-height:1.3;}",
      "#" + PANEL_ID + " .as-pnm{display:block;font-weight:700;font-size:13.5px;color:#0f2540;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      "#" + PANEL_ID + " .as-pmeta{display:block;color:#6b7d93;font-size:11.5px;margin-top:1px;}",
      "#" + PANEL_ID + " .as-preason{display:block;color:#8a9cb2;font-size:11px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      "#" + PANEL_ID + " .as-pwb{display:block;font-size:10.5px;margin-top:3px;font-weight:700;}",
      "#" + PANEL_ID + " .as-pwb.yes{color:#1f9d6b;}",
      "#" + PANEL_ID + " .as-pwb.no{color:#c2410c;}",
      "#" + PANEL_ID + " .as-pwb.notyet{color:#94a3b8;}",
      "#" + PANEL_ID + " .as-pgo{flex:0 0 auto;font-size:11px;font-weight:800;color:#2f6bed;background:#eef3fb;border-radius:7px;padding:5px 9px;}",
      "#" + PANEL_ID + " .as-pcard.is-active .as-pgo{color:#1f9d6b;background:#e7f5ee;}",
      "#" + PANEL_ID + " .as-empty{padding:20px 14px;text-align:center;color:#8a9cb2;font-size:12.5px;",
      "border:1px dashed #dde6f0;border-radius:12px;background:#fbfcfe;}",
      /* chat */
      "#" + PANEL_ID + " .as-thread{padding:14px 16px;}",
      "#" + PANEL_ID + " .as-msg{margin:0 0 10px;display:flex;}",
      "#" + PANEL_ID + " .as-msg.user{justify-content:flex-end;}",
      "#" + PANEL_ID + " .as-bub{max-width:84%;padding:9px 12px;border-radius:13px;white-space:pre-wrap;word-wrap:break-word;font-size:12.5px;line-height:1.5;}",
      "#" + PANEL_ID + " .as-msg.user .as-bub{background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;border-bottom-right-radius:4px;}",
      "#" + PANEL_ID + " .as-msg.ai .as-bub{background:#f1f5fb;color:#1b2c44;border-bottom-left-radius:4px;}",
      "#" + PANEL_ID + " .as-msg.pending .as-bub{opacity:.7;font-style:italic;}",
      "#" + PANEL_ID + " .as-input{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e4ebf3;background:#fff;}",
      "#" + PANEL_ID + " .as-input textarea{flex:1 1 auto;resize:none;height:40px;max-height:120px;",
      "background:#f7fafe;color:#0f2540;border:1px solid #dbe6f6;border-radius:10px;",
      "padding:10px 11px;font:13px/1.35 'Plus Jakarta Sans';outline:none;}",
      "#" + PANEL_ID + " .as-send{flex:0 0 auto;background:linear-gradient(135deg,#2f6bed,#2257cf);color:#fff;border:none;border-radius:10px;",
      "padding:0 16px;font:800 13px/1 'Plus Jakarta Sans';cursor:pointer;}",
      "#" + PANEL_ID + " .as-send:disabled{opacity:.5;cursor:default;}",
      "#" + PANEL_ID + " .as-foot{padding:8px 16px 12px;font-size:10.5px;color:#9aa8bb;text-align:center;}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- status ---------- */
  var COLOR = { green: "#16a34a", red: "#dc2626", grey: "#9aa0a6" };
  function describeNow() {
    var c = ct();
    if (c && isFn(c.describe)) return safe(function () { return c.describe(c.state); }, null) || safe(function () { return c.describe(); }, null);
    return null;
  }
  function isConnected() {
    var c = ct();
    return !!(c && isFn(c.isConnected) && safe(function () { return c.isConnected(); }, false));
  }
  function renderStatus() {
    var p = $(PANEL_ID); if (!p) return;
    var d = describeNow() || { status: "checking", color: "grey", label: "Checking athenaOne connection...", detail: "" };
    var col = COLOR[d.color] || COLOR.grey;
    var sdot = p.querySelector(".as-sdot"); if (sdot) sdot.style.background = col;
    var fdot = document.querySelector("#" + FAB_ID + " .dot"); if (fdot) fdot.style.background = col;
    var lab = p.querySelector(".as-slabel"); if (lab) lab.textContent = d.label || "";
    var det = p.querySelector(".as-sdetail"); if (det) det.textContent = d.detail || "";
    var disc = (d.status === "no-extension" || d.status === "no-tab" || d.status === "error");
    var slot = p.querySelector(".as-connect-slot");
    if (slot) {
      if (disc && !slot.firstChild) {
        var b = el("button", "as-connect", "Connect athenaOne"); b.type = "button";
        b.addEventListener("click", onConnectClick); slot.appendChild(b);
      } else if (!disc && slot.firstChild) { slot.innerHTML = ""; }
    }
  }
  function onConnectClick() {
    var sp = safe(function () { return window.__mlsAthenaSignInPrompt; }, null);
    if (sp && isFn(sp._openAthena)) { safe(function () { sp._openAthena(true); }); }
    else {
      var url = (sp && isFn(sp._athenaUrl)) ? safe(function () { return sp._athenaUrl(); }, null) : null;
      safe(function () { window.open(url || "https://athenanet.athenahealth.com/", "mlsAthenaSignIn"); });
    }
    setPullStatus("Opening athenaOne in a new tab. Sign in there and open your Day schedule, then come back - the status will update on its own.", false);
    var c = ct(); if (c && isFn(c.check)) safe(function () { c.check(); });
  }

  /* ---------- pull status line (schedule pane) ---------- */
  function pullStatusEl() { var p = $(PANEL_ID); return p ? p.querySelector(".as-pullstatus") : null; }
  function setPullStatus(msg, ok) { var s = pullStatusEl(); if (s) { s.textContent = msg || ""; s.classList.toggle("ok", !!ok); } }

  /* ---------- SCHEDULE pane render ---------- */
  function renderSchedule() {
    var p = $(PANEL_ID); if (!p) return;
    var pane = p.querySelector(".as-pane-schedule"); if (!pane) return;

    /* day buttons reflect the selected date */
    var t = todayStr(), tm = addDaysStr(t, 1);
    var dayBtns = pane.querySelectorAll(".as-daybtn");
    for (var i = 0; i < dayBtns.length; i++) {
      var which = dayBtns[i].getAttribute("data-day");
      var on = (which === "today" && selDate === t) || (which === "tomorrow" && selDate === tm);
      dayBtns[i].classList.toggle("on", !!on);
    }
    var di = pane.querySelector(".as-date"); if (di && di.value !== selDate) di.value = selDate;
    var prov = pane.querySelector(".as-prov"); if (prov && prov.innerHTML.indexOf("option") < 0) prov.innerHTML = providerOptionsHTML(selProvider);

    var list = dayList(selDate, selProvider);
    var op = opNoteCount(list);
    var sN = pane.querySelector(".as-stat-pt b"); if (sN) sN.textContent = String(list.length);
    var sO = pane.querySelector(".as-stat-op b"); if (sO) sO.textContent = String(op);

    var host = pane.querySelector(".as-list"); if (!host) return;
    var curId = activeId();
    var nMins = nowMins(), nIdx = -1, isToday = (selDate === t);
    if (isToday) { for (var k = 0; k < list.length; k++) { if (list[k].mins != null && list[k].mins >= nMins) { nIdx = k; break; } } }

    var hd = pane.querySelector(".as-listhd");
    if (hd) {
      if (!list.length) hd.textContent = "No patients scheduled for " + prettyFull(selDate) + ".";
      else hd.textContent = list.length + " patient" + (list.length === 1 ? "" : "s") + " on " + prettyFull(selDate) + (/all/i.test(selProvider) ? "" : " . " + selProvider) + " . tap one to open their chart.";
    }

    if (!list.length) {
      host.innerHTML = '<div class="as-empty">Nothing on this day&#39;s schedule. Pick another date above, or use &ldquo;Pull from athenaOne&rdquo; with your signed-in Day schedule open.</div>';
      return;
    }
    var html = "";
    for (var j = 0; j < list.length; j++) {
      var pt = list[j], isActive = (pt.id === curId), isNow = (j === nIdx);
      var age = ageFromDob(pt.dob), meta = [];
      if (age != null) meta.push(age + "y");
      if (pt.sex) meta.push(esc(pt.sex));
      if (pt.dob) meta.push("DOB " + esc(pt.dob));
      var tStr = fmtTime(pt.time);
      var upcoming = (pt.mins != null && pt.mins >= nMins);
      var tag = isNow ? ("<small>" + (upcoming ? "NEXT" : "NOW") + "</small>") : (tStr ? "<small>appt</small>" : "");
      var wl = wbLine(pt.id);
      html += '<button type="button" class="as-pcard' + (isActive ? " is-active" : "") + (isNow ? " is-now" : "") + '" data-id="' + esc(pt.id) + '">' +
        '<span class="as-ptime">' + (tStr ? esc(tStr) : "&mdash;") + tag + '</span>' +
        '<span class="as-pav">' + esc(initials(pt.name)) + '</span>' +
        '<span class="as-pinfo">' +
          '<span class="as-pnm">' + esc(pt.name) + '</span>' +
          '<span class="as-pmeta">' + (meta.join(" &middot; ") || "Patient") + '</span>' +
          (pt.reason ? '<span class="as-preason">' + esc(pt.reason) + '</span>' : '') +
          '<span class="as-pwb ' + wl.cls + '">' + esc(wl.text) + '</span>' +
        '</span>' +
        '<span class="as-pgo">' + (isActive ? "&#10003; Active" : "Select") + '</span>' +
      '</button>';
    }
    host.innerHTML = html;
    var cards = host.querySelectorAll(".as-pcard");
    for (var c = 0; c < cards.length; c++) {
      cards[c].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        try {
          if (window.__mlsPick && isFn(window.__mlsPick.select)) window.__mlsPick.select(id);
          else if (isFn(window.openPatient)) window.openPatient(id);
        } catch (e) {}
        renderSchedule();
      });
    }
  }

  /* ---------- the gated, honest "Pull from athenaOne" ---------- */
  function doPull(btn) {
    var c = ct();
    var connected = !!(c && isFn(c.isConnected) && safe(function () { return c.isConnected(); }, false));
    if (c && !connected) {
      var d = describeNow();
      setPullStatus((d && (d.detail || d.label)) || "athenaOne isn't connected yet - sign in and open your Day schedule, then pull.", false);
      var cc = ct(); if (cc && isFn(cc.check)) safe(function () { cc.check(); });
      return;
    }
    if (!isGFn("pullScheduleViaAssist")) { setPullStatus("Schedule pull is unavailable right now.", false); return; }
    if (btn) btn.disabled = true;
    setPullStatus("Reading your athenaOne Day schedule...", false);
    var n0 = appts().length, done = false;
    function onRes(e) {
      if (!(e.data && e.data.source === "mls-ext" && e.data.type === "mlsAppScheduleResult")) return;
      done = true; window.removeEventListener("message", onRes);
      setTimeout(function () {
        if (btn) btn.disabled = false;
        var n1 = appts().length, added = n1 - n0;
        /* stamp a REAL "pulled at" on the patients now present for the selected day */
        try { var L = dayList(selDate, selProvider); wbMarkPulled(L.map(function (x) { return x.id; })); } catch (e) {}
        renderSchedule();
        if (added > 0) setPullStatus("Pulled " + added + " appointment" + (added === 1 ? "" : "s") + " - " + nowClock(), true);
        else setPullStatus("No new appointments added - they may already be on your calendar, or open your athenaOne Day schedule with patients and pull again.", false);
      }, 1800);
    }
    window.addEventListener("message", onRes);
    setTimeout(function () {
      if (!done) {
        window.removeEventListener("message", onRes); if (btn) btn.disabled = false;
        var s = pullStatusEl();
        if (s && /Reading/.test(s.textContent)) setPullStatus("Didn't hear back from athenaOne - make sure MLS Assist is enabled and your signed-in Day schedule is open, then pull again.", false);
      }
    }, 33000);
    try { window.pullScheduleViaAssist(btn); } catch (e) {}
  }

  /* ---------- CHAT pane ---------- */
  function renderThread() {
    var t = $(PANEL_ID) && $(PANEL_ID).querySelector(".as-thread");
    if (!t) return;
    var html = "";
    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      var role = m.role === "user" ? "user" : (m.role === "pending" ? "ai pending" : "ai");
      html += '<div class="as-msg ' + role + '"><div class="as-bub">' + esc(m.text) + "</div></div>";
    }
    t.innerHTML = html;
    var body = $(PANEL_ID) && $(PANEL_ID).querySelector(".as-body");
    if (body && tab === "chat") body.scrollTop = body.scrollHeight;
  }
  function addMsg(role, text) { history.push({ role: role, text: text }); renderThread(); }
  function backendReady() {
    var bm = safe(function () { return isFn(window.backendMode) && window.backendMode(); }, false);
    var tok = safe(function () { return isFn(window.bkToken) && window.bkToken(); }, "");
    return !!(bm && tok);
  }
  function ask(q) {
    q = String(q || "").trim();
    if (!q || busy) return;
    addMsg("user", q);
    if (!backendReady()) {
      addMsg("ai", "Sign in to your MLS account to chat with the assistant - it needs your account to read your practice data.");
      return;
    }
    busy = true; setSendEnabled(false);
    history.push({ role: "pending", text: "Thinking..." }); renderThread();
    var base = safe(function () { return window.bkBase(); }, "");
    var tok = safe(function () { return window.bkToken(); }, "");
    var ctx = safe(function () { return isFn(window.copilotSnapshot) ? window.copilotSnapshot() : null; }, null);
    var hist = history.filter(function (m) { return m.role === "user" || m.role === "ai"; })
                      .map(function (m) { return { role: m.role === "user" ? "user" : "ai", text: m.text }; });
    hist = hist.slice(0, -1);
    var body = { question: q, history: hist };
    if (ctx) body.context = ctx;
    fetch(base + "/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        dropPending();
        var reply = (d && (d.reply || d.text || d.answer)) || "";
        reply = String(reply).trim();
        if (!reply) reply = "The assistant did not return a response. Please try again.";
        addMsg("ai", reply);
      })
      .catch(function () { dropPending(); addMsg("ai", "Couldn't reach the assistant just now (network or backend). Please try again in a moment."); })
      .then(function () { busy = false; setSendEnabled(true); });
  }
  function dropPending() { history = history.filter(function (m) { return m.role !== "pending"; }); renderThread(); }
  function setSendEnabled(on) { var b = $(PANEL_ID) && $(PANEL_ID).querySelector(".as-send"); if (b) b.disabled = !on; }

  /* ---------- tab switching ---------- */
  function setTab(which) {
    tab = which;
    var p = $(PANEL_ID); if (!p) return;
    var tabs = p.querySelectorAll(".as-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("on", tabs[i].getAttribute("data-tab") === which);
    var sp = p.querySelector(".as-pane-schedule"), cp = p.querySelector(".as-pane-chat");
    if (sp) sp.hidden = which !== "schedule";
    if (cp) cp.hidden = which !== "chat";
    if (which === "schedule") renderSchedule();
    if (which === "chat") { renderThread(); var ta = p.querySelector("textarea"); if (ta) safe(function () { ta.focus(); }); }
  }

  /* ---------- build panel + FAB (once) ---------- */
  function buildPanel() {
    if ($(PANEL_ID)) return;
    injectStyle();

    var fab = el("button", null, '<span class="dot"></span>MLS Assistant');
    fab.id = FAB_ID; fab.type = "button";
    fab.addEventListener("click", function () { toggle(true); });
    document.body.appendChild(fab);

    var p = el("div"); p.id = PANEL_ID;
    p.innerHTML =
      '<div class="as-head"><span class="as-title">MLS Assistant</span>' +
      '<button type="button" class="as-x" aria-label="Close">&times;</button></div>' +
      '<div class="as-status"><span class="as-sdot"></span>' +
        '<div class="as-stext"><div class="as-slabel">Checking athenaOne connection...</div>' +
        '<div class="as-sdetail"></div><span class="as-connect-slot"></span></div></div>' +
      '<div class="as-tabs">' +
        '<button type="button" class="as-tab on" data-tab="schedule">Schedule</button>' +
        '<button type="button" class="as-tab" data-tab="chat">Chat</button></div>' +
      '<div class="as-body">' +
        '<div class="as-pane as-pane-schedule">' +
          '<div class="as-pull">' +
            '<h4>Pull patients</h4>' +
            '<div class="as-dayrow">' +
              '<button type="button" class="as-daybtn" data-day="today">Today</button>' +
              '<button type="button" class="as-daybtn" data-day="tomorrow">Tomorrow</button>' +
              '<input type="date" class="as-date" aria-label="Pick a date">' +
            '</div>' +
            '<div class="as-provrow"><select class="as-prov" aria-label="Provider"></select></div>' +
            '<button type="button" class="as-pullbtn">Pull from athenaOne</button>' +
            '<div class="as-pullstatus"></div>' +
          '</div>' +
          '<div class="as-stats">' +
            '<div class="as-stat as-stat-pt"><b>0</b><span>Patients</span></div>' +
            '<div class="as-stat as-stat-op"><b>0</b><span>Op-note candidates</span></div>' +
          '</div>' +
          '<p class="as-listhd"></p>' +
          '<div class="as-list"></div>' +
        '</div>' +
        '<div class="as-pane as-pane-chat" hidden>' +
          '<div class="as-thread"></div>' +
        '</div>' +
      '</div>' +
      '<div class="as-input" hidden><textarea placeholder="Message the assistant..." rows="1"></textarea>' +
        '<button type="button" class="as-send">Send</button></div>' +
      '<div class="as-foot">Reads your own practice data. Never writes or signs a chart on its own.</div>';
    document.body.appendChild(p);

    p.querySelector(".as-x").addEventListener("click", function () { toggle(false); });
    var tabs = p.querySelectorAll(".as-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener("click", function () { setTab(this.getAttribute("data-tab")); syncInputVisibility(); });

    /* day controls */
    var sp = p.querySelector(".as-pane-schedule");
    var dayBtns = sp.querySelectorAll(".as-daybtn");
    for (var d = 0; d < dayBtns.length; d++) dayBtns[d].addEventListener("click", function () {
      var which = this.getAttribute("data-day");
      selDate = which === "tomorrow" ? addDaysStr(todayStr(), 1) : todayStr();
      setPullStatus("", false); renderSchedule();
    });
    var di = sp.querySelector(".as-date");
    di.value = selDate;
    di.addEventListener("change", function () { if (this.value) { selDate = this.value; setPullStatus("", false); renderSchedule(); } });
    var prov = sp.querySelector(".as-prov");
    prov.innerHTML = providerOptionsHTML(selProvider);
    prov.addEventListener("change", function () { selProvider = this.value || "All doctors"; renderSchedule(); });
    sp.querySelector(".as-pullbtn").addEventListener("click", function () { doPull(this); });

    /* chat input */
    var ta = p.querySelector("textarea"), send = p.querySelector(".as-send");
    send.addEventListener("click", function () { var v = ta.value; ta.value = ""; ask(v); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); var v = ta.value; ta.value = ""; ask(v); }
    });
    if (!history.length) addMsg("ai", "Hi - I'm the MLS Assistant. Use the Schedule tab to pull and pick your patients, or ask me anything here. The status above shows your real athenaOne connection.");

    renderStatus();
    renderSchedule();
    bindTruth();
    /* react to selections made elsewhere (picker, patients list) so the cards re-highlight */
    safe(function () { document.addEventListener("mls:patientpicked", function () { renderSchedule(); }); });
  }

  function syncInputVisibility() {
    var p = $(PANEL_ID); if (!p) return;
    var inp = p.querySelector(".as-input"); if (inp) inp.hidden = (tab !== "chat");
  }

  function toggle(open) {
    var p = $(PANEL_ID), f = $(FAB_ID); if (!p) return;
    var willOpen = open == null ? !p.classList.contains("open") : !!open;
    p.classList.toggle("open", willOpen);
    if (f) f.style.display = willOpen ? "none" : "";
    if (willOpen) {
      renderStatus();
      if (tab === "schedule") renderSchedule(); else renderThread();
      syncInputVisibility();
      var c = ct(); if (c && isFn(c.check)) safe(function () { c.check(); });
    }
  }

  function bindTruth() {
    var c = ct();
    if (c && isFn(c.subscribe)) { unsub = safe(function () { return c.subscribe(function () { renderStatus(); }); }, null); }
    else {
      var tries = 0, iv = setInterval(function () {
        tries++; var cc = ct();
        if (cc && isFn(cc.subscribe)) { clearInterval(iv); unsub = safe(function () { return cc.subscribe(function () { renderStatus(); }); }, null); renderStatus(); }
        else if (tries > 20) { clearInterval(iv); }
      }, 1000);
    }
  }

  /* ---------- repaint the picker/calendar so forced-Eastern times apply on load ---------- */
  function repaintAll() {
    try { if (window.__mlsLink && isFn(window.__mlsLink.syncAll)) { window.__mlsLink.syncAll("est", false); return; } } catch (e) {}
    try {
      var P = window.__mlsPick;
      if (P && isFn(P.renderGrid)) {
        var hosts = [document.querySelector("#mlsPickComplexWrap .mlspk-cx-grid"), $("simPickGrid")];
        var modal = $("mlsPickModal");
        if (modal && !modal.hasAttribute("hidden")) { var b = modal.querySelector(".mlspk-body"); if (b) hosts.push(b); }
        for (var i = 0; i < hosts.length; i++) { var h = hosts[i]; if (h) { try { h.__mlspkSig = ""; P.renderGrid(h, { scope: "today", limit: 6 }); } catch (e) {} } }
      }
    } catch (e) {}
  }

  /* ---------- boot / revert ---------- */
  function boot() {
    installEstHooks();          /* re-assert in case the app (re)defined a hook after our sync install */
    startHealWatch();
    startWbWatch();
    injectSuppress();
    buildPanel();
    repaintAll();
    try { [250, 1200, 3000].forEach(function (ms) { setTimeout(repaintAll, ms); }); } catch (e) {}
  }
  function revert() {
    safe(function () { if (_healPoll) clearInterval(_healPoll); });
    safe(function () { if (_wbPoll) clearInterval(_wbPoll); });
    safe(function () { if (isFn(unsub)) unsub(); });
    /* restore the original (undefined) TZ hooks so nothing of ours lingers */
    safe(function () { if (_hooksInstalled) { for (var k in _origHooks) { if (Object.prototype.hasOwnProperty.call(_origHooks, k)) { try { window[k] = _origHooks[k]; } catch (e) {} } } try { delete window.__mlsEstForced; } catch (e) { window.__mlsEstForced = false; } } });
    /* restore wrapped writeback + step */
    safe(function () { var wb = window.__mlsAthenaWriteback; if (wb && _origWrite && wb.writeNoteToChart && wb.writeNoteToChart.__mlsAsstWrapped) wb.writeNoteToChart = _origWrite; });
    safe(function () { var aa = window.__mlsAthenaActions; if (aa && _origStep && aa._step && aa._step.__mlsAsstWrapped) aa._step = _origStep; });
    safe(function () { var p = $(PANEL_ID); if (p) p.remove(); });
    safe(function () { var f = $(FAB_ID); if (f) f.remove(); });
    safe(function () { var s = $(STYLE_ID); if (s) s.remove(); });
    safe(function () { var s = $(SUPPRESS_ID); if (s) s.remove(); });
    try { window.__mlsAsst.installed = false; } catch (e) {}
  }

  window.__mlsAsst = {
    installed: true,
    version: VERSION,
    asset: "feat_mls_assistant_exact.js",
    open: function () { toggle(true); },
    close: function () { toggle(false); },
    setTab: setTab,
    ask: ask,
    _renderStatus: renderStatus,
    _renderSchedule: renderSchedule,
    _dayList: dayList,
    _opNoteCount: opNoteCount,
    _wbLine: wbLine,
    _fmtTimeEST: fmtTime,
    _apptMinsEST: apptMins,
    _estDateKey: estDateKey,
    _installEstHooks: installEstHooks,
    setDate: function (ds) { if (ds) { selDate = ds; renderSchedule(); } },
    setProvider: function (pv) { selProvider = pv || "All doctors"; renderSchedule(); },
    _neutralizeSelfHeal: neutralizeSelfHeal,
    _history: function () { return history.slice(); },
    revert: revert
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { safe(boot); }, { once: true });
  } else {
    safe(boot);
  }
})();
