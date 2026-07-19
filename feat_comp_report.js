/* feat_comp_report.js  ->  window.__mlsComp   (Monthly Pay / Compensation Report)
 * v2.1.0 (2026-07-16) -- Editorial Calm UI rebuild + correctness pass +
 * billing-code transparency: the server's per-provider pricing breakdown and
 * the fee schedule (GET /api/payreport/fees) are rendered in the panel and
 * exported to Excel ("Estimate detail" + "Fee schedule" sheets), so every
 * estimated dollar shows the billing codes behind it. A provider the server
 * cannot price stays PENDING instead of becoming a silent $0 estimate.
 * Data model and reconciliation math are UNCHANGED in meaning from v1.1.0:
 *   - Patient counts / days worked: the practice's own backend appointments
 *     (GET /api/appointments?from&to)  -  whatever athena pulls have imported.
 *   - Collections: an ESTIMATE via POST /api/payreport/estimate  -  priced from
 *     (in order) the practice's own fee overrides, real billing codes on the
 *     matching MLS visit record, the note's own est_charge, a deterministic
 *     keyword-to-CPT-bundle match, or (only for leftovers) one AI call that
 *     may pick a bundle from a fixed table but never invents a dollar figure.
 *     ALWAYS labeled an estimate, with a manual override field per provider
 *     for the real posted numbers. Never presented as actual.
 *   - Rates/overhead/MRI: user-editable config, persisted in localStorage.
 *
 * v2.0.0 changes:
 *   - UI matches the app's Editorial Calm design (serif headings, calm greens,
 *     summary stat cards, provider chips, collapsible per-provider tables,
 *     month stepper, print stylesheet, keyboard Esc, responsive).
 *   - Auto-builds on open and on month change (no dead panel).
 *   - PA/NP daily-rate default now matches credential tokens on word
 *     boundaries only ("Napoli" no longer reads as an NP).
 *   - Server estimate dollars for provider names that do not match any
 *     appointment provider are surfaced on an "Unmatched providers" line
 *     instead of being silently dropped.
 *   - Reconciliation clearly flags providers still missing collections and
 *     labels the total incomplete until every included provider has a number.
 *
 * SAFETY: read-only everywhere. Never touches athenaOne, never writes
 * appointments/notes/orders, no PHI in logs. Additive + reversible + idempotent.
 */
(function () {
  "use strict";
  if (window.__mlsComp) return;

  /* ---------------- tiny helpers (same conventions as sibling feats) ------- */
  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
  function isFn(f) { return typeof f === "function"; }
  function callG(n) { return safe(function () { return isFn(window[n]) ? window[n]() : null; }, null); }
  function bkBase() { return callG("bkBase") || "https://scrivara-backend.onrender.com"; }
  function bkToken() { return callG("bkToken") || ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(n) { return "$" + (Math.round(Number(n || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num(v, fb) { var n = parseFloat(String(v == null ? "" : v).replace(/[$,\s]/g, "")); return isFinite(n) ? n : (fb || 0); }
  function midlevel(name) { return /\b(?:pa-?c?|np|crnp|aprn|dnp)\b/i.test(String(name || "")); }

  var CFG_KEY = "mlsCompCfg_v1";
  function loadCfg() { return safe(function () { return JSON.parse(localStorage.getItem(CFG_KEY) || "{}") || {}; }, {}) || {}; }
  function saveCfg(c) { safe(function () { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }); }

  /* ---------------- data pull + aggregation -------------------------------- */
  function monthRange(ym) { // "2026-06" -> {from,to,label}
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var last = new Date(y, m, 0).getDate();
    return { from: ym + "-01", to: ym + "-" + (last < 10 ? "0" + last : last), y: y, m: m, label: ym };
  }
  function monthLabel(ym) {
    return safe(function () {
      var names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      return names[+ym.slice(5, 7) - 1] + " " + ym.slice(0, 4);
    }, ym);
  }
  function stepMonth(ym, delta) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + delta;
    var d = new Date(y, m, 1);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
  }
  function nyHour(iso) { // hour-of-day in the practice TZ; null if no/invalid time
    return safe(function () {
      if (!iso) return null;
      var h = new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit" });
      var n = parseInt(h, 10); return isFinite(n) ? (n === 24 ? 0 : n) : null;
    }, null);
  }
  function fetchAppts(range) {
    var t = bkToken(); if (!t) return Promise.reject(new Error("Not signed in to MLS."));
    return fetch(bkBase() + "/api/appointments?from=" + range.from + "&to=" + range.to, { headers: { Authorization: "Bearer " + t } })
      .then(function (r) { if (!r.ok) throw new Error("Backend " + r.status); return r.json(); });
  }
  function aggregate(resp) {
    var doctorName = {};
    (resp.doctors || []).forEach(function (d) { if (d && d.id != null) doctorName[String(d.id)] = d.name || ""; });
    var provs = {}; // provider -> { days: {date:{am,pm,unk}}, visits:[{date,reason}] }
    (resp.appointments || []).forEach(function (x) {
      if (!x || x.status === "cancelled" || x.status === "no_show") return;
      var p = String(x.provider_name || doctorName[String(x.doctor_user_id)] || "Unassigned").trim() || "Unassigned";
      var d = String(x.appt_date || (x.start_at || "").slice(0, 10) || "").slice(0, 10);
      if (!d) return;
      var pr = provs[p] || (provs[p] = { days: {}, visits: [] });
      var day = pr.days[d] || (pr.days[d] = { am: 0, pm: 0, unk: 0 });
      var h = nyHour(x.start_at);
      if (h == null) day.unk++; else if (h < 12) day.am++; else day.pm++;
      pr.visits.push({ date: d, reason: String(x.reason || "").slice(0, 200) });
    });
    return provs;
  }
  function providerRows(pr) { // sorted [date, am, pm, total] + credits
    var dates = Object.keys(pr.days).sort();
    var rows = [], tAm = 0, tPm = 0, tAll = 0, halves = [], creditTotal = 0;
    dates.forEach(function (d) {
      var v = pr.days[d];
      var am = v.am + v.unk; // untimed visits count once, in the AM column
      var total = am + v.pm;
      rows.push([d, am, v.pm, total]); tAm += am; tPm += v.pm; tAll += total;
      var cAm = am > 0 ? 0.5 : 0, cPm = v.pm > 0 ? 0.5 : 0;
      halves.push([d, cAm, cPm, cAm + cPm]); creditTotal += cAm + cPm;
    });
    return { rows: rows, totals: [tAm, tPm, tAll], halves: halves, days: creditTotal };
  }

  /* ---------------- collections estimate (grounded backend) ---------------- */
  function estimateCollections(provs, ym) {
    var t = bkToken(); if (!t) return Promise.reject(new Error("Not signed in to MLS."));
    return fetch(bkBase() + "/api/payreport/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
      body: JSON.stringify({ month: ym })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j || j.ok === false) throw new Error((j && (j.message || j.error)) || ("Estimate failed (" + r.status + ")"));
        return j;
      }, function () { throw new Error("Estimate failed (" + r.status + ")"); });
    }).then(function (j) {
      var byProv = {}, detail = {}, unmatched = 0, unmatchedNames = [];
      Object.keys(provs).forEach(function (p) {
        var pr = j.byProvider && j.byProvider[p];
        /* v2.1.0: a provider the server did not price stays PENDING (null),
           never a silent $0 "estimate". */
        byProv[p] = pr ? pr.total : null;
        detail[p] = pr && pr.breakdown ? pr.breakdown : [];
      });
      /* server dollars under names that match no appointment provider must be
         disclosed, never silently dropped from the month's picture. */
      Object.keys(j.byProvider || {}).forEach(function (name) {
        if (!(name in provs)) { unmatched += (j.byProvider[name] && j.byProvider[name].total) || 0; unmatchedNames.push(name); }
      });
      return { byProv: byProv, detail: detail, assumptions: j.assumptions || {}, total: j.totalEstimatedCollections,
        unmatched: unmatched, unmatchedNames: unmatchedNames };
    });
  }
  /* Fee schedule + bundle->codes mapping (GET /api/payreport/fees) so the UI
     and the Excel can show the actual billing codes behind every estimate. */
  function fetchFees() {
    if (S.fees) return Promise.resolve(S.fees);
    var t = bkToken(); if (!t) return Promise.resolve(null);
    return fetch(bkBase() + "/api/payreport/fees", { headers: { Authorization: "Bearer " + t } })
      .then(function (r) { if (!r.ok) return null; return r.json(); })
      .then(function (j) {
        if (!j || j.ok === false) return null;
        var byCode = {};
        (j.fees || []).forEach(function (f) { if (f && f.code) byCode[f.code] = f; });
        S.fees = { byCode: byCode, bundles: j.bundles || {}, config: j.config || {}, list: j.fees || [] };
        return S.fees;
      }).catch(function () { return null; });
  }
  /* basis string ("keyword:ESI_LUMBAR", "visit_record_codes", ...) ->
     { label, codes:[{code,desc,expected}] } using the fetched fee schedule. */
  function basisInfo(basis, fees) {
    basis = String(basis || "");
    function codesFor(bundle) {
      var codes = (fees && fees.bundles && fees.bundles[bundle]) || [];
      return codes.map(function (c) {
        var f = fees && fees.byCode && fees.byCode[c];
        return { code: c, desc: f ? f.description : "", expected: f ? f.expected : null };
      });
    }
    if (basis === "visit_record_codes") return { label: "Real billing codes on the chart (E/M + CPT, CMS-priced)", codes: [] , realCodes: true };
    if (basis === "visit_record_est_charge") return { label: "The note's own estimated charge", codes: [] };
    var m = basis.match(/^(keyword|saved_map|ai_map):(.+)$/);
    if (m) {
      var how = { keyword: "Keyword match", saved_map: "Saved mapping", ai_map: "AI-classified (code choice only)" }[m[1]];
      return { label: how + " → " + m[2].replace(/_/g, " "), bundle: m[2], codes: codesFor(m[2]) };
    }
    if (basis === "default:FOLLOWUP") return { label: "Unmapped → follow-up default", bundle: "FOLLOWUP", codes: codesFor("FOLLOWUP") };
    if (basis === "pending_ai") return { label: "Pending classification", codes: [] };
    return { label: basis || "Unpriced", codes: [] };
  }
  function codesText(info) {
    if (info.realCodes) return "actual chart codes (see chart)";
    if (!info.codes.length) return "";
    return info.codes.map(function (c) { return c.code + (c.desc ? " " + c.desc : ""); }).join("; ");
  }

  /* ---------------- state --------------------------------------------------- */
  var S = { provs: null, ym: "", est: null, sel: {}, loading: false, fees: null };
  function defaultMonth() { var d = new Date(); d.setMonth(d.getMonth() - 1); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }

  /* ---------------- styles (Editorial Calm) -------------------------------- */
  function css() {
    if (document.getElementById("mlsCompCss")) return;
    var s = document.createElement("style"); s.id = "mlsCompCss";
    s.textContent = [
      /* legacy floater (hidden by ui-cleanup on the app page; kept for compat) */
      "#mlsCompBtn{position:fixed;left:12px;bottom:140px;z-index:99990;display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border:0;border-radius:999px;background:linear-gradient(135deg,#204034,#2E6A4B);color:#fff;font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 6px 18px rgba(31,64,52,.35);cursor:pointer}",
      "#mlsCompBtn:hover{filter:brightness(1.08)}",
      /* overlay + panel */
      "#mlsCompOvl{position:fixed;inset:0;z-index:99991;background:rgba(23,35,29,.45);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:26px 14px}",
      "#mlsCompPanel{--pr-ink:#17231d;--pr-green:#204034;--pr-soft:#f3f7f4;--pr-line:#dce6df;background:linear-gradient(150deg,#fff 0%,#f7faf8 100%);color:var(--pr-ink);border:1px solid var(--pr-line);border-radius:20px;max-width:1120px;width:100%;padding:26px 30px;font:14px/1.5 system-ui,Segoe UI,sans-serif;box-shadow:0 24px 70px rgba(20,40,32,.35)}",
      ".pr-eyebrow{font-size:11px;font-weight:850;letter-spacing:.12em;text-transform:uppercase;color:#47705f;margin-bottom:4px}",
      "#mlsCompPanel h2{font:650 26px/1.1 'Newsreader',Georgia,serif;letter-spacing:-.02em;margin:0}",
      "#mlsCompPanel h3{font:700 15px/1.3 'Newsreader',Georgia,serif;margin:22px 0 8px;color:var(--pr-ink)}",
      ".pr-note{font-size:12px;color:#64756c;margin:8px 0 0;max-width:860px}",
      /* toolbar */
      ".pr-bar{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:16px 0 4px}",
      ".pr-month{display:inline-flex;align-items:center;gap:2px;background:#fff;border:1px solid #cfdcd4;border-radius:11px;padding:2px}",
      ".pr-month button{border:0;background:transparent;font-size:15px;color:#204034;cursor:pointer;padding:6px 10px;border-radius:9px}",
      ".pr-month button:hover{background:#edf3ef}",
      ".pr-month input[type=month]{border:0;outline:0;background:transparent;font:650 13.5px system-ui;color:#17231d;padding:6px 2px}",
      ".pr-bar .pr-btn{padding:9px 15px;border:0;border-radius:11px;background:var(--pr-green);color:#fff;font:700 12.5px/1 system-ui;cursor:pointer}",
      ".pr-bar .pr-btn.sec{background:#fff;color:#204034;border:1px solid #bfd1c6}",
      ".pr-bar .pr-btn:disabled{opacity:.45;cursor:default}",
      ".pr-bar .pr-btn:hover:not(:disabled){filter:brightness(1.06)}",
      /* status */
      "#mlsCompStatus{display:flex;align-items:center;gap:8px;font:650 12.5px system-ui;color:#24513d;background:#edf5f0;border-radius:11px;padding:9px 12px;margin-top:10px}",
      "#mlsCompStatus:empty{display:none}",
      "#mlsCompStatus.pr-err{background:#fff4ef;color:#9a3e25;border:1px solid #f0d0c4}",
      ".pr-spin{width:13px;height:13px;border:2px solid #9dbcab;border-top-color:#204034;border-radius:50%;animation:prspin .8s linear infinite;flex:0 0 13px}",
      "@keyframes prspin{to{transform:rotate(360deg)}}",
      "#mlsCompStatus button{margin-left:auto;border:1px solid currentColor;background:transparent;border-radius:8px;padding:4px 9px;color:inherit;font-weight:750;cursor:pointer}",
      /* summary cards */
      ".pr-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:16px}",
      ".pr-card{background:#fff;border:1px solid #e1e8e3;border-radius:14px;padding:12px 14px}",
      ".pr-card b{display:block;font:700 20px/1.2 'Newsreader',Georgia,serif;color:#204034}",
      ".pr-card span{font-size:11px;color:#71827a;font-weight:650;letter-spacing:.03em}",
      ".pr-card small{display:block;font-size:10.5px;color:#8a988f;margin-top:2px}",
      /* provider chips */
      ".pr-chips{display:flex;flex-wrap:wrap;gap:7px;margin:6px 0 0}",
      ".pr-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #cfdcd4;background:#fff;border-radius:999px;padding:6px 12px;font:650 12px system-ui;color:#33463c;cursor:pointer;user-select:none}",
      ".pr-chip.on{background:#204034;border-color:#204034;color:#fff}",
      ".pr-chip .dot{width:7px;height:7px;border-radius:50%;background:#b9c9bf}.pr-chip.on .dot{background:#7fd6a8}",
      /* settings */
      "details.pr-set{border:1px solid #e3e9e4;border-radius:14px;background:#fff;margin-top:14px;overflow:hidden}",
      "details.pr-set>summary{list-style:none;cursor:pointer;padding:12px 15px;font:750 12.5px system-ui;color:#526058;display:flex;align-items:center;gap:8px}",
      "details.pr-set>summary::-webkit-details-marker{display:none}",
      "details.pr-set>summary:before{content:'+';display:grid;place-items:center;width:20px;height:20px;border-radius:7px;background:#edf2ee;color:#204034;font-size:15px}",
      "details.pr-set[open]>summary:before{content:'-'}",
      ".pr-setbody{border-top:1px solid #eceee9;padding:13px 15px;display:flex;flex-wrap:wrap;gap:8px 18px}",
      ".pr-setbody label{display:inline-flex;align-items:center;gap:7px;font:600 12.5px system-ui;color:#42534a}",
      ".pr-setbody input{width:120px;padding:6px 9px;border:1px solid #cbd8cf;border-radius:9px;font:inherit;text-align:right;background:#fcfdfc}",
      ".pr-setbody input:focus{outline:0;border-color:#5a9278;box-shadow:0 0 0 3px rgba(54,120,88,.12)}",
      /* reconciliation statement */
      ".pr-recon{background:#fff;border:1px solid #e1e8e3;border-radius:16px;padding:6px 0;margin-top:6px;max-width:640px}",
      ".pr-recon .row{display:flex;justify-content:space-between;gap:14px;padding:8px 18px;font-size:13.5px}",
      ".pr-recon .row+.row{border-top:1px dashed #e8eee9}",
      ".pr-recon .row .lbl{color:#33463c}.pr-recon .row .val{font-variant-numeric:tabular-nums;font-weight:650}",
      ".pr-recon .row.neg .val{color:#b4442a}",
      ".pr-recon .row.sub .val{font-weight:800}",
      ".pr-recon .row.grand{background:#eaf5ee;border-top:1px solid #cfe5d7;font-weight:800}",
      ".pr-recon .row.grand .val{font-size:15.5px;color:#17402e}",
      ".pr-flag{font-size:10.5px;color:#8a6d3b;background:#fdf6e3;border:1px solid #f0e3bd;border-radius:7px;padding:1px 7px;margin-left:7px;font-weight:700}",
      ".pr-flag.est{color:#3d6653;background:#eef6f1;border-color:#cfe3d7}",
      /* per-provider tables */
      "details.pr-prov{border:1px solid #e3e9e4;border-radius:14px;background:#fff;margin-top:10px;overflow:hidden}",
      "details.pr-prov>summary{list-style:none;cursor:pointer;padding:11px 15px;font:750 13px system-ui;color:#26382f;display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      "details.pr-prov>summary::-webkit-details-marker{display:none}",
      "details.pr-prov>summary .mini{font:600 11.5px system-ui;color:#71827a;margin-left:auto}",
      "table.pr-t{border-collapse:collapse;font-size:12.5px;width:100%;font-variant-numeric:tabular-nums}",
      "table.pr-t th,table.pr-t td{border-top:1px solid #edf1ee;padding:5px 12px;text-align:right}",
      "table.pr-t th{background:#f3f7f4;color:#41544a;font:700 11px system-ui;letter-spacing:.04em;text-transform:uppercase;text-align:right}",
      "table.pr-t th:first-child,table.pr-t td:first-child{text-align:left}",
      "table.pr-t tr.tot td{font-weight:800;background:#f7faf8;border-top:2px solid #dbe6de}",
      /* responsive + print */
      "@media(max-width:700px){#mlsCompPanel{padding:16px;border-radius:14px}#mlsCompPanel h2{font-size:21px}.pr-recon{max-width:none}}",
      "@media print{body>*{display:none!important}#mlsCompOvl{display:block!important;position:static;background:#fff;padding:0}#mlsCompOvl,#mlsCompOvl *{visibility:visible}#mlsCompPanel{box-shadow:none;border:0;max-width:none}.pr-bar,.pr-chips,#mlsCompStatus,details.pr-set{display:none!important}details.pr-prov{page-break-inside:avoid}details.pr-prov:not([open])>*:not(summary){display:block}}",
      "@media(prefers-reduced-motion:reduce){#mlsCompPanel *{animation:none!important;transition:none!important}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function close() { var o = document.getElementById("mlsCompOvl"); if (o) o.remove(); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }

  function open() {
    css(); close();
    var o = document.createElement("div"); o.id = "mlsCompOvl";
    o.addEventListener("click", function (e) { if (e.target === o) close(); });
    o.innerHTML =
      '<div id="mlsCompPanel" role="dialog" aria-label="Monthly Pay Report">' +
      '<div class="pr-eyebrow">Premium &middot; read-only</div>' +
      '<h2>Monthly Pay Report</h2>' +
      '<div class="pr-note">Patient counts and days come from the appointments MLS has pulled from athenaOne. Collections are an <b>estimate</b> (real billing codes + CMS fee schedule when available, unless you type the real posted number in the override boxes). Nothing here writes to athena.</div>' +
      '<div class="pr-bar">' +
      '<span class="pr-month"><button type="button" id="mlsCompPrev" aria-label="Previous month">&#8249;</button>' +
      '<input type="month" id="mlsCompMonth" value="' + (S.ym || defaultMonth()) + '">' +
      '<button type="button" id="mlsCompNext" aria-label="Next month">&#8250;</button></span>' +
      '<button class="pr-btn" id="mlsCompEst" disabled>Estimate collections</button>' +
      '<button class="pr-btn sec" id="mlsCompXlsx" disabled>Download Excel</button>' +
      '<button class="pr-btn sec" id="mlsCompPrint" disabled>Print</button>' +
      '<button class="pr-btn sec" id="mlsCompClose">Close</button>' +
      '</div>' +
      '<div id="mlsCompStatus"></div>' +
      '<div id="mlsCompBody"></div>' +
      '</div>';
    document.body.appendChild(o);
    document.addEventListener("keydown", onKey);
    document.getElementById("mlsCompClose").onclick = close;
    document.getElementById("mlsCompEst").onclick = runEstimate;
    document.getElementById("mlsCompXlsx").onclick = exportXlsx;
    document.getElementById("mlsCompPrint").onclick = function () { safe(function () { window.print(); }); };
    document.getElementById("mlsCompMonth").addEventListener("change", build);
    document.getElementById("mlsCompPrev").onclick = function () { shiftMonth(-1); };
    document.getElementById("mlsCompNext").onclick = function () { shiftMonth(1); };
    build(); // v2: the panel is never dead — it loads the default month immediately
  }
  function shiftMonth(delta) {
    var inp = document.getElementById("mlsCompMonth"); if (!inp) return;
    inp.value = stepMonth(inp.value || defaultMonth(), delta);
    build();
  }

  function setStatus(t, kind, retry) {
    var e = document.getElementById("mlsCompStatus"); if (!e) return;
    e.className = kind === "err" ? "pr-err" : "";
    e.innerHTML = "";
    if (!t) return;
    if (kind === "busy") { var sp = document.createElement("span"); sp.className = "pr-spin"; e.appendChild(sp); }
    e.appendChild(document.createTextNode(t));
    if (retry) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = "Retry";
      b.onclick = retry; e.appendChild(b);
    }
  }

  function build() {
    var ym = (document.getElementById("mlsCompMonth") || {}).value || defaultMonth();
    S.ym = ym; S.est = null; S.loading = true;
    setStatus("Loading appointments for " + monthLabel(ym) + " ...", "busy");
    var body = document.getElementById("mlsCompBody"); if (body) body.innerHTML = "";
    var estBtn = document.getElementById("mlsCompEst"), xBtn = document.getElementById("mlsCompXlsx"), pBtn = document.getElementById("mlsCompPrint");
    if (estBtn) estBtn.disabled = true; if (xBtn) xBtn.disabled = true; if (pBtn) pBtn.disabled = true;
    fetchAppts(monthRange(ym)).then(function (resp) {
      if (S.ym !== ym) return; // a newer month replaced this request
      S.loading = false;
      S.provs = aggregate(resp);
      var names = Object.keys(S.provs);
      S.sel = {}; names.forEach(function (p) { S.sel[p] = true; });
      if (!names.length) { setStatus("No appointments found for " + monthLabel(ym) + ". Pull that month from athena first (backfill), then pick it again.", "err", build); return; }
      setStatus("");
      render();
      if (estBtn) estBtn.disabled = false; if (xBtn) xBtn.disabled = false; if (pBtn) pBtn.disabled = false;
    }).catch(function (e) { if (S.ym !== ym) return; S.loading = false; setStatus("Could not load: " + e.message, "err", build); });
  }

  function calc() { // recon math from current cfg + estimates/overrides
    var cfg = loadCfg(); cfg.rates = cfg.rates || {}; cfg.coll = cfg.coll || {};
    var names = Object.keys(S.provs).sort().filter(function (p) { return S.sel[p] !== false; });
    var out = { names: names, perProv: {}, rateTotal: 0, collTotal: 0, anyEstimate: false, missingColl: [] };
    names.forEach(function (p) {
      var agg = providerRows(S.provs[p]);
      var rate = num(cfg.rates[p], midlevel(p) ? 500 : 1000);
      var override = cfg.coll[p];
      var hasOverride = !(override === undefined || override === "" || override === null);
      var coll = hasOverride ? num(override, 0)
        : (S.est && S.est.byProv[p] != null ? S.est.byProv[p] : null);
      if (coll !== null && !hasOverride && S.est) out.anyEstimate = true;
      if (coll === null) out.missingColl.push(p);
      var pay = agg.days * rate;
      out.perProv[p] = { agg: agg, rate: rate, dayPay: pay, coll: coll, isEstimate: coll !== null && !hasOverride && !!S.est };
      out.rateTotal += pay; if (coll !== null) out.collTotal += coll;
    });
    out.unmatched = (S.est && S.est.unmatched) || 0;
    out.collTotal += out.unmatched;
    out.mri = num(cfg.mri, 0); out.overhead = num(cfg.overhead, 0);
    out.afterMri = out.collTotal - out.mri;
    out.bonus = out.afterMri - out.rateTotal - out.overhead;
    out.totalPay = out.bonus + out.rateTotal;
    return out;
  }

  function render() {
    var cfg = loadCfg(); cfg.rates = cfg.rates || {}; cfg.coll = cfg.coll || {};
    var r = calc(), b = document.getElementById("mlsCompBody"); if (!b) return;
    var patientTotal = 0, dayTotal = 0;
    r.names.forEach(function (p) { patientTotal += r.perProv[p].agg.totals[2]; dayTotal += r.perProv[p].agg.days; });

    var h = '<div class="pr-cards">' +
      '<div class="pr-card"><span>PATIENTS SEEN</span><b>' + patientTotal.toLocaleString("en-US") + '</b><small>' + esc(monthLabel(S.ym)) + ', checked providers</small></div>' +
      '<div class="pr-card"><span>PROVIDER-DAYS</span><b>' + dayTotal + '</b><small>half-day credits summed</small></div>' +
      '<div class="pr-card"><span>COLLECTIONS</span><b>' + (r.missingColl.length === r.names.length ? "—" : money(r.collTotal)) + '</b><small>' + (r.missingColl.length ? "incomplete — " + r.missingColl.length + " provider(s) pending" : (r.anyEstimate ? "includes labeled estimates" : "actual (overrides)")) + '</small></div>' +
      '<div class="pr-card"><span>TOTAL PAY</span><b>' + (r.missingColl.length ? "—" : money(r.totalPay)) + '</b><small>' + (r.missingColl.length ? "needs every provider's collections" : "bonus + daily rate") + '</small></div>' +
      '</div>';

    h += '<h3>Providers in this report</h3><div class="pr-chips">';
    Object.keys(S.provs).sort().forEach(function (p) {
      h += '<span class="pr-chip' + (S.sel[p] !== false ? ' on' : '') + '" data-prov="' + esc(p) + '" role="checkbox" tabindex="0" aria-checked="' + (S.sel[p] !== false) + '"><span class="dot"></span>' + esc(p) + '</span>';
    });
    h += '</div>';

    h += '<details class="pr-set"><summary>Rates, actual collections, MRI and overhead (saved on this device)</summary><div class="pr-setbody">';
    r.names.forEach(function (p) {
      h += '<label>' + esc(p) + ' $/day <input data-rate="' + esc(p) + '" value="' + r.perProv[p].rate + '"></label>';
      h += '<label>' + esc(p) + ' actual collections <input data-coll="' + esc(p) + '" placeholder="(blank = estimate)" value="' + esc(cfg.coll[p] == null ? "" : cfg.coll[p]) + '"></label>';
    });
    h += '<label>less MRI <input data-k="mri" value="' + num(cfg.mri, 0) + '"></label>';
    h += '<label>less overhead <input data-k="overhead" value="' + num(cfg.overhead, 0) + '"></label></div></details>';

    h += '<h3>Reconciliation — ' + esc(monthLabel(S.ym)) + '</h3><div class="pr-recon">';
    r.names.forEach(function (p) {
      var pp = r.perProv[p];
      var flag = pp.coll === null ? '<span class="pr-flag">pending — estimate or type actual</span>'
        : (pp.isEstimate ? '<span class="pr-flag est">estimate</span>' : '');
      h += '<div class="row"><span class="lbl">' + esc(p) + flag + '</span><span class="val">' + (pp.coll === null ? "—" : money(pp.coll)) + '</span></div>';
    });
    if (r.unmatched > 0) {
      h += '<div class="row"><span class="lbl">Unmatched providers on server estimate' +
        ((S.est && S.est.unmatchedNames.length) ? ' (' + esc(S.est.unmatchedNames.join(', ')) + ')' : '') +
        '<span class="pr-flag est">estimate</span></span><span class="val">' + money(r.unmatched) + '</span></div>';
    }
    h += '<div class="row sub"><span class="lbl">Total collections' + (r.anyEstimate ? ' (incl. estimates)' : '') + (r.missingColl.length ? ' <span class="pr-flag">incomplete</span>' : '') + '</span><span class="val">' + money(r.collTotal) + '</span></div>';
    h += '<div class="row neg"><span class="lbl">less MRI</span><span class="val">(' + money(r.mri) + ')</span></div>';
    h += '<div class="row"><span class="lbl">After MRI</span><span class="val">' + money(r.afterMri) + '</span></div>';
    h += '<div class="row neg"><span class="lbl">less daily rate (' + r.names.map(function (p) { return esc(p.split(",")[0]) + " " + r.perProv[p].agg.days + "d @ " + money(r.perProv[p].rate); }).join(" + ") + ')</span><span class="val">(' + money(r.rateTotal) + ')</span></div>';
    h += '<div class="row neg"><span class="lbl">less overhead</span><span class="val">(' + money(r.overhead) + ')</span></div>';
    h += '<div class="row sub"><span class="lbl">Total Bonus</span><span class="val">' + money(r.bonus) + '</span></div>';
    h += '<div class="row grand"><span class="lbl">Total Pay (bonus + daily rate)</span><span class="val">' + (r.missingColl.length ? "— pending collections" : money(r.totalPay)) + '</span></div></div>';

    h += '<h3>Per-provider detail</h3>';
    r.names.forEach(function (p) {
      var a = r.perProv[p].agg;
      h += '<details class="pr-prov"><summary>' + esc(p) +
        '<span class="mini">' + a.totals[2] + ' patients &middot; ' + a.days + ' days &middot; ' + money(a.days * r.perProv[p].rate) + ' daily-rate pay</span></summary>' +
        '<table class="pr-t"><tr><th>Date</th><th>Morning</th><th>Afternoon</th><th>Total</th><th>AM credit</th><th>PM credit</th><th>Day credit</th></tr>';
      a.rows.forEach(function (row, i) {
        var hv = a.halves[i];
        h += '<tr><td>' + esc(row[0]) + '</td><td>' + row[1] + '</td><td>' + row[2] + '</td><td>' + row[3] + '</td><td>' + hv[1] + '</td><td>' + hv[2] + '</td><td>' + hv[3] + '</td></tr>';
      });
      h += '<tr class="tot"><td>Totals</td><td>' + a.totals[0] + '</td><td>' + a.totals[1] + '</td><td>' + a.totals[2] + '</td><td></td><td></td><td>' + a.days + '</td></tr></table>';
      var detail = S.est && S.est.detail && S.est.detail[p];
      if (detail && detail.length) {
        h += '<h3 style="padding:0 15px">How the estimate was priced <span class="pr-flag est">estimate</span></h3>' +
          '<table class="pr-t"><tr><th>Pricing basis</th><th>Billing codes</th><th>Visits</th><th>Unit est.</th><th>Subtotal</th></tr>';
        detail.forEach(function (d) {
          var info = basisInfo(d.basis, S.fees);
          h += '<tr><td>' + esc(info.label) + '</td><td style="text-align:left">' + esc(codesText(info) || "—") + '</td><td>' + d.count + '</td><td>' + money(d.unit) + '</td><td>' + money(d.subtotal) + '</td></tr>';
        });
        h += '</table>';
      }
      h += '</details>';
    });
    b.innerHTML = h;

    // wire provider chips
    Array.prototype.forEach.call(b.querySelectorAll('.pr-chip'), function (chip) {
      function toggle() { var p = chip.getAttribute("data-prov"); S.sel[p] = !(S.sel[p] !== false); render(); }
      chip.addEventListener("click", toggle);
      chip.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
    });
    // wire config inputs
    Array.prototype.forEach.call(b.querySelectorAll('.pr-setbody input'), function (inp) {
      inp.addEventListener("change", function () {
        var c = loadCfg(); c.rates = c.rates || {}; c.coll = c.coll || {};
        if (inp.getAttribute("data-rate")) c.rates[inp.getAttribute("data-rate")] = num(inp.value, 0);
        else if (inp.getAttribute("data-coll")) c.coll[inp.getAttribute("data-coll")] = inp.value.trim();
        else c[inp.getAttribute("data-k")] = num(inp.value, 0);
        saveCfg(c);
        var wasOpen = true; // settings stays open across re-render
        render();
        if (wasOpen) { var d = b.querySelector('details.pr-set'); if (d) d.open = true; }
      });
    });
  }

  function runEstimate() {
    if (!S.provs) return;
    var ym = S.ym;
    setStatus("Pricing " + monthLabel(ym) + " from real billing codes + the CMS fee schedule ...", "busy");
    Promise.all([estimateCollections(S.provs, ym), fetchFees()]).then(function (both) {
      var est = both[0];
      if (S.ym !== ym) return;
      S.est = est;
      var a = est.assumptions || {};
      var parts = [];
      if (a.pricedFromRealCodes) parts.push(a.pricedFromRealCodes + " from real billing codes");
      if (a.pricedFromEstCharge) parts.push(a.pricedFromEstCharge + " from note estimates");
      if (a.pricedByKeyword) parts.push(a.pricedByKeyword + " by keyword match");
      if (a.pricedBySavedMap) parts.push(a.pricedBySavedMap + " by saved mapping");
      if (a.pricedByAi) parts.push(a.pricedByAi + " AI-classified");
      if (a.defaultedToFollowup) parts.push(a.defaultedToFollowup + " defaulted to follow-up");
      var breakdown = parts.length ? (": " + parts.join(", ")) : "";
      setStatus("Estimate done (" + (a.appointmentsPriced || 0) + " visits priced" + breakdown + "). Type real posted collections in the override boxes to replace any provider's estimate.");
      render();
    }).catch(function (e) { if (S.ym === ym) setStatus("Estimate failed: " + e.message, "err", runEstimate); });
  }

  /* ---------------- Excel export ------------------------------------------- */
  function withXLSX(cb) {
    if (window.XLSX) return cb(window.XLSX);
    var sc = document.createElement("script");
    sc.src = "vendor/xlsx.full-0.20.3.min.js?v=cc015130aa8521e7";
    sc.onload = function () { cb(window.XLSX); };
    sc.onerror = function () { setStatus("Could not load the Excel library.", "err", exportXlsx); };
    document.head.appendChild(sc);
  }
  function exportXlsx() {
    if (!S.provs) return;
    /* make sure the fee schedule is loaded so the billing-code sheets are full */
    fetchFees().then(function () { exportXlsxNow(); });
  }
  function exportXlsxNow() {
    var r = calc();
    withXLSX(function (X) {
      var wb = X.utils.book_new();
      var rec = [["Monthly Pay Report", S.ym], []];
      r.names.forEach(function (p) { rec.push([p + (r.perProv[p].isEstimate ? " (estimate)" : ""), r.perProv[p].coll == null ? "" : r.perProv[p].coll]); });
      if (r.unmatched > 0) rec.push(["Unmatched providers (server estimate)", r.unmatched]);
      rec.push(["Total collections" + (r.anyEstimate ? " (incl. estimates)" : "") + (r.missingColl.length ? " (INCOMPLETE)" : ""), r.collTotal]);
      rec.push(["less MRI", -r.mri]); rec.push(["", r.afterMri]);
      rec.push(["less daily rate", -r.rateTotal]); rec.push(["less overhead", -r.overhead]);
      rec.push(["Total Bonus", r.bonus]); rec.push(["Total Pay", r.totalPay]);
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rec), "Reconciliation");
      r.names.forEach(function (p) {
        var a = r.perProv[p].agg;
        var aoa = [[p], ["Date", "Morning", "Afternoon", "Total"]].concat(a.rows);
        aoa.push(["Grand Total", a.totals[0], a.totals[1], a.totals[2]]);
        aoa.push([]); aoa.push(["Half-day credits"]); aoa.push(["Date", "Morning", "Afternoon", "Total"]);
        a.halves.forEach(function (hrow) { aoa.push(hrow); });
        aoa.push(["Total days", "", "", a.days]); aoa.push(["Daily rate", r.perProv[p].rate]); aoa.push(["Days x rate", a.days * r.perProv[p].rate]);
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), String(p).replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 28) || "Provider");
      });
      /* Estimate detail: every pricing bucket per provider WITH its billing
         codes, so the Excel shows exactly which codes back each dollar. */
      if (S.est && S.est.detail) {
        var det = [["Estimate pricing detail — " + S.ym + " (ALWAYS an estimate; overrides win)"], [],
          ["Provider", "Pricing basis", "Billing codes", "Visits", "Unit estimate", "Subtotal"]];
        r.names.forEach(function (p) {
          (S.est.detail[p] || []).forEach(function (d) {
            var info = basisInfo(d.basis, S.fees);
            det.push([p, info.label, codesText(info), d.count, d.unit, d.subtotal]);
          });
        });
        if (S.est.unmatched > 0) det.push(["(unmatched server providers: " + S.est.unmatchedNames.join(", ") + ")", "", "", "", "", S.est.unmatched]);
        var a2 = S.est.assumptions || {};
        det.push([]); det.push(["Model", a2.model || ""]); det.push(["Fee schedule", a2.feeSchedule || ""]);
        det.push(["Site", a2.site || ""], ["Blend multiplier", a2.blendMult != null ? a2.blendMult : ""], ["Realization", a2.realization != null ? a2.realization : ""]);
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(det), "Estimate detail");
      }
      /* Fee schedule: the complete code table behind the estimates, incl. the
         practice's own overrides. */
      if (S.fees && S.fees.list && S.fees.list.length) {
        var fs = [["Fee schedule used for estimates (approx CY2025 national Medicare PFS; practice overrides win)"], [],
          ["Code", "Description", "Medicare non-facility", "Medicare facility", "Expected collection", "Practice override"]];
        S.fees.list.forEach(function (f) {
          fs.push([f.code, f.description, f.medicareNonFacility, f.medicareFacility, f.expected, f.override == null ? "" : f.override]);
        });
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(fs), "Fee schedule");
      }
      X.writeFile(wb, "MLS_Pay_Report_" + S.ym + ".xlsx");
      setStatus("Excel downloaded: MLS_Pay_Report_" + S.ym + ".xlsx");
    });
  }

  /* ---------------- launch button (legacy floater; hidden by ui-cleanup-v1
     on the app page today -- kept intact so window.__mlsComp.open() and any
     direct #mlsCompBtn.click() fallback still resolve) ---------------------- */
  function addButton() {
    if (document.getElementById("mlsCompBtn")) return;
    css();
    var b = document.createElement("button");
    b.id = "mlsCompBtn"; b.type = "button"; b.title = "Monthly pay / compensation report";
    b.innerHTML = "&#128181; Pay Report";
    b.onclick = open;
    document.body.appendChild(b);
  }
  safe(addButton); // immediate: loaders run at end of body, so body exists; do NOT rely on
  // an interval for the first add (the site freezes intervals on hidden tabs).
  var tries = 0, iv = setInterval(function () {
    tries++;
    if (document.body) { addButton(); }
    if (tries > 20 || document.getElementById("mlsCompBtn")) clearInterval(iv);
  }, 1000);
  document.addEventListener("visibilitychange", function () { safe(addButton); });

  window.__mlsComp = {
    open: open, close: close, version: "2.1.0",
    /* pure pieces exposed for regression tests (no side effects) */
    _test: { aggregate: aggregate, providerRows: providerRows, midlevel: midlevel, monthRange: monthRange, stepMonth: stepMonth, num: num, basisInfo: basisInfo, codesText: codesText }
  };
})();
