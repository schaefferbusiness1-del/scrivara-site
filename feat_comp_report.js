/* feat_comp_report.js  ->  window.__mlsComp   (Monthly Pay / Compensation Report)
 * v1.1.0 (2026-07-08) -- collections now priced by the grounded backend
 * estimator (POST /api/payreport/estimate: real CPT/E&M codes -> CMS fee
 * schedule waterfall) instead of an unconstrained raw-LLM dollar guess.
 * Everything else (patient counts, days worked, reconciliation math, Excel
 * export, manual override boxes) is UNCHANGED from v1.0.0.
 *
 * WHAT: One-click monthly compensation reconciliation, modeled on the practice's
 * manual Excel report (per-provider patient counts AM/PM, half-day credits,
 * days x daily rate, collections less MRI / daily rate / overhead = bonus,
 * total pay), plus an .xlsx export in the same shape.
 *
 * DATA SOURCES (honest, clearly labeled):
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

  var CFG_KEY = "mlsCompCfg_v1";
  function loadCfg() { return safe(function () { return JSON.parse(localStorage.getItem(CFG_KEY) || "{}") || {}; }, {}) || {}; }
  function saveCfg(c) { safe(function () { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }); }

  /* ---------------- data pull + aggregation -------------------------------- */
  function monthRange(ym) { // "2026-06" -> {from,to,label}
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var last = new Date(y, m, 0).getDate();
    return { from: ym + "-01", to: ym + "-" + (last < 10 ? "0" + last : last), y: y, m: m, label: ym };
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
  // v1.1.0: replaces the old raw-/api/complete dollar guess with the real
  // CPT/E&M-code fee-schedule waterfall at POST /api/payreport/estimate.
  // provs is only used here to build the byProv map for the callers below;
  // the server does its own independent pricing pass over the same month.
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
      var byProv = {};
      Object.keys(provs).forEach(function (p) {
        var pr = j.byProvider && j.byProvider[p];
        byProv[p] = pr ? pr.total : 0;
      });
      return { byProv: byProv, assumptions: j.assumptions || {}, total: j.totalEstimatedCollections };
    });
  }

  /* ---------------- UI ------------------------------------------------------ */
  var S = { provs: null, ym: "", est: null, sel: {} };
  function defaultMonth() { var d = new Date(); d.setMonth(d.getMonth() - 1); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }

  function css() {
    if (document.getElementById("mlsCompCss")) return;
    var s = document.createElement("style"); s.id = "mlsCompCss";
    s.textContent =
      "#mlsCompBtn{position:fixed;left:12px;bottom:140px;z-index:99990;display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border:0;border-radius:999px;background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 6px 18px rgba(30,58,138,.35);cursor:pointer}" +
      "#mlsCompBtn:hover{filter:brightness(1.08)}" +
      "#mlsCompOvl{position:fixed;inset:0;z-index:99991;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px}" +
      "#mlsCompPanel{background:#fff;color:#0f172a;border-radius:14px;max-width:1060px;width:100%;padding:22px 26px;font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.35)}" +
      "#mlsCompPanel h2{margin:0 0 4px;font-size:20px}#mlsCompPanel h3{margin:18px 0 6px;font-size:15px}" +
      ".mlsCompBar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0}" +
      ".mlsCompBar input[type=month],.mlsCompBar input[type=text]{padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}" +
      ".mlsCompBar button{padding:8px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;font:600 13px/1 inherit;cursor:pointer}" +
      ".mlsCompBar button.sec{background:#e2e8f0;color:#0f172a}.mlsCompBar button:disabled{opacity:.5;cursor:default}" +
      ".mlsCompGrid{display:flex;flex-wrap:wrap;gap:18px}" +
      "table.mlsCompT{border-collapse:collapse;font-size:12.5px;min-width:250px}table.mlsCompT th,table.mlsCompT td{border:1px solid #dbe3ee;padding:3px 9px;text-align:right}" +
      "table.mlsCompT th{background:#dbeafe;text-align:center}table.mlsCompT td:first-child{text-align:left}" +
      "table.mlsCompT tr.tot td{font-weight:700;background:#eff6ff}" +
      "table.mlsCompR{border-collapse:collapse;font-size:13.5px;margin-top:6px}table.mlsCompR td{border:1px solid #dbe3ee;padding:5px 12px}" +
      "table.mlsCompR td+td{text-align:right;min-width:130px}" +
      "table.mlsCompR tr.neg td+td{color:#dc2626}table.mlsCompR tr.grand td{font-weight:800;background:#bbf7d0}" +
      ".mlsCompNote{font-size:12px;color:#64748b;margin:6px 0}" +
      ".mlsCompCfg input{width:110px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;text-align:right}" +
      ".mlsCompCfg label{display:inline-flex;align-items:center;gap:6px;margin:3px 12px 3px 0}" +
      "#mlsCompStatus{font-size:12.5px;color:#334155;margin-top:8px;white-space:pre-wrap}";
    document.head.appendChild(s);
  }

  function close() { var o = document.getElementById("mlsCompOvl"); if (o) o.remove(); }

  function open() {
    css(); close();
    var o = document.createElement("div"); o.id = "mlsCompOvl";
    o.addEventListener("click", function (e) { if (e.target === o) close(); });
    o.innerHTML =
      '<div id="mlsCompPanel">' +
      '<h2>Monthly Pay Report</h2>' +
      '<div class="mlsCompNote">Patient counts and days come from the appointments MLS has pulled from athenaOne. Collections are an <b>estimate</b> (real billing codes + CMS fee schedule when available, unless you type the real posted number in the override boxes). Nothing here writes to athena.</div>' +
      '<div class="mlsCompBar">' +
      '<label>Month <input type="month" id="mlsCompMonth" value="' + defaultMonth() + '"></label>' +
      '<button id="mlsCompBuild">Build report</button>' +
      '<button id="mlsCompEst" class="sec" disabled>Estimate collections</button>' +
      '<button id="mlsCompXlsx" class="sec" disabled>Download Excel</button>' +
      '<button id="mlsCompClose" class="sec">Close</button>' +
      '</div>' +
      '<div id="mlsCompStatus"></div>' +
      '<div id="mlsCompBody"></div>' +
      '</div>';
    document.body.appendChild(o);
    document.getElementById("mlsCompClose").onclick = close;
    document.getElementById("mlsCompBuild").onclick = build;
    document.getElementById("mlsCompEst").onclick = runEstimate;
    document.getElementById("mlsCompXlsx").onclick = exportXlsx;
  }

  function setStatus(t) { var e = document.getElementById("mlsCompStatus"); if (e) e.textContent = t || ""; }

  function build() {
    var ym = (document.getElementById("mlsCompMonth") || {}).value || defaultMonth();
    S.ym = ym; S.est = null;
    setStatus("Loading appointments for " + ym + " ...");
    fetchAppts(monthRange(ym)).then(function (resp) {
      S.provs = aggregate(resp);
      var names = Object.keys(S.provs);
      S.sel = {}; names.forEach(function (p) { S.sel[p] = true; });
      if (!names.length) { setStatus("No appointments found for " + ym + ". Pull that month from athena first (backfill), then rebuild."); document.getElementById("mlsCompBody").innerHTML = ""; return; }
      setStatus("");
      render();
      document.getElementById("mlsCompEst").disabled = false;
      document.getElementById("mlsCompXlsx").disabled = false;
    }).catch(function (e) { setStatus("Could not load: " + e.message); });
  }

  function calc() { // recon math from current cfg + estimates/overrides
    var cfg = loadCfg(); cfg.rates = cfg.rates || {}; cfg.coll = cfg.coll || {};
    var names = Object.keys(S.provs).sort().filter(function (p) { return S.sel[p] !== false; });
    var out = { names: names, perProv: {}, rateTotal: 0, collTotal: 0, anyEstimate: false };
    names.forEach(function (p) {
      var agg = providerRows(S.provs[p]);
      var rate = num(cfg.rates[p], /pa|np/i.test(p) ? 500 : 1000);
      var override = cfg.coll[p];
      var coll = (override !== undefined && override !== "" && override !== null) ? num(override, 0)
        : (S.est && S.est.byProv[p] != null ? S.est.byProv[p] : null);
      if (coll !== null && (override === undefined || override === "" || override === null) && S.est) out.anyEstimate = true;
      var pay = agg.days * rate;
      out.perProv[p] = { agg: agg, rate: rate, dayPay: pay, coll: coll };
      out.rateTotal += pay; if (coll !== null) out.collTotal += coll;
    });
    out.mri = num(cfg.mri, 0); out.overhead = num(cfg.overhead, 0);
    out.afterMri = out.collTotal - out.mri;
    out.bonus = out.afterMri - out.rateTotal - out.overhead;
    out.totalPay = out.bonus + out.rateTotal;
    return out;
  }

  function render() {
    var cfg = loadCfg(); cfg.rates = cfg.rates || {}; cfg.coll = cfg.coll || {};
    var r = calc(), b = document.getElementById("mlsCompBody"); if (!b) return;
    var h = '<h3>Providers in this report (check who to include; totals combine only the checked ones)</h3><div class="mlsCompCfg">';
    Object.keys(S.provs).sort().forEach(function (p) {
      h += '<label><input type="checkbox" style="width:auto" data-prov="' + esc(p) + '"' + (S.sel[p] !== false ? ' checked' : '') + '> ' + esc(p) + '</label>';
    });
    h += '</div>';
    h += '<h3>Settings (saved on this device)</h3><div class="mlsCompCfg">';
    r.names.forEach(function (p) {
      h += '<label>' + esc(p) + ' $/day <input data-rate="' + esc(p) + '" value="' + r.perProv[p].rate + '"></label>';
      h += '<label>' + esc(p) + ' actual collections <input data-coll="' + esc(p) + '" placeholder="(blank = estimate)" value="' + esc(cfg.coll[p] == null ? "" : cfg.coll[p]) + '"></label>';
    });
    h += '<label>less MRI <input data-k="mri" value="' + num(cfg.mri, 0) + '"></label>';
    h += '<label>less overhead <input data-k="overhead" value="' + num(cfg.overhead, 0) + '"></label></div>';

    h += '<h3>Reconciliation — ' + esc(S.ym) + '</h3><table class="mlsCompR">';
    r.names.forEach(function (p) {
      var pp = r.perProv[p];
      h += '<tr><td>' + esc(p) + (pp.coll === null ? ' <span class="mlsCompNote">(no collections yet — run Estimate or type actual)</span>' : (S.est && (cfg.coll[p] == null || cfg.coll[p] === "") ? ' <span class="mlsCompNote">(estimate)</span>' : '')) + '</td><td>' + (pp.coll === null ? "—" : money(pp.coll)) + '</td></tr>';
    });
    h += '<tr class="tot"><td><b>Total collections' + (r.anyEstimate ? " (incl. estimates)" : "") + '</b></td><td><b>' + money(r.collTotal) + '</b></td></tr>';
    h += '<tr class="neg"><td>less MRI</td><td>(' + money(r.mri) + ')</td></tr>';
    h += '<tr><td></td><td>' + money(r.afterMri) + '</td></tr>';
    h += '<tr class="neg"><td>less daily rate (' + r.names.map(function (p) { return esc(p.split(",")[0]) + " " + r.perProv[p].agg.days + "d@" + money(r.perProv[p].rate); }).join(" + ") + ')</td><td>(' + money(r.rateTotal) + ')</td></tr>';
    h += '<tr class="neg"><td>less overhead</td><td>(' + money(r.overhead) + ')</td></tr>';
    h += '<tr><td><b>Total Bonus</b></td><td><b>' + money(r.bonus) + '</b></td></tr>';
    h += '<tr class="grand"><td>Total Pay (bonus + daily rate)</td><td>' + money(r.totalPay) + '</td></tr></table>';

    h += '<h3>Patients seen per day</h3><div class="mlsCompGrid">';
    r.names.forEach(function (p) {
      var a = r.perProv[p].agg;
      h += '<table class="mlsCompT"><tr><th colspan="4">' + esc(p) + '</th></tr><tr><th>Date</th><th>Morning</th><th>Afternoon</th><th>Total</th></tr>';
      a.rows.forEach(function (row) { h += '<tr><td>' + esc(row[0]) + '</td><td>' + row[1] + '</td><td>' + row[2] + '</td><td>' + row[3] + '</td></tr>'; });
      h += '<tr class="tot"><td>Grand Total</td><td>' + a.totals[0] + '</td><td>' + a.totals[1] + '</td><td>' + a.totals[2] + '</td></tr></table>';
    });
    h += '</div><h3>Half-day credits</h3><div class="mlsCompGrid">';
    r.names.forEach(function (p) {
      var a = r.perProv[p].agg;
      h += '<table class="mlsCompT"><tr><th colspan="4">' + esc(p) + '</th></tr><tr><th>Date</th><th>Morning</th><th>Afternoon</th><th>Total</th></tr>';
      a.halves.forEach(function (row) { h += '<tr><td>' + esc(row[0]) + '</td><td>' + row[1] + '</td><td>' + row[2] + '</td><td>' + row[3] + '</td></tr>'; });
      h += '<tr class="tot"><td>Total days</td><td></td><td></td><td>' + a.days + '</td></tr></table>';
    });
    h += '</div>';
    b.innerHTML = h;

    // wire config inputs
    Array.prototype.forEach.call(b.querySelectorAll('input[data-prov]'), function (cb) {
      cb.addEventListener("change", function () { S.sel[cb.getAttribute("data-prov")] = cb.checked; render(); });
    });
    Array.prototype.forEach.call(b.querySelectorAll('.mlsCompCfg input:not([data-prov])'), function (inp) {
      inp.addEventListener("change", function () {
        var c = loadCfg(); c.rates = c.rates || {}; c.coll = c.coll || {};
        if (inp.getAttribute("data-rate")) c.rates[inp.getAttribute("data-rate")] = num(inp.value, 0);
        else if (inp.getAttribute("data-coll")) c.coll[inp.getAttribute("data-coll")] = inp.value.trim();
        else c[inp.getAttribute("data-k")] = num(inp.value, 0);
        saveCfg(c); render();
      });
    });
  }

  function runEstimate() {
    if (!S.provs) return;
    setStatus("Pricing " + S.ym + " from real billing codes + the CMS fee schedule ...");
    estimateCollections(S.provs, S.ym).then(function (est) {
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
    }).catch(function (e) { setStatus("Estimate failed: " + e.message); });
  }

  /* ---------------- Excel export ------------------------------------------- */
  function withXLSX(cb) {
    if (window.XLSX) return cb(window.XLSX);
    var sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    sc.onload = function () { cb(window.XLSX); };
    sc.onerror = function () { setStatus("Could not load the Excel library."); };
    document.head.appendChild(sc);
  }
  function exportXlsx() {
    if (!S.provs) return;
    var r = calc();
    withXLSX(function (X) {
      var wb = X.utils.book_new();
      var rec = [["Monthly Pay Report", S.ym], []];
      r.names.forEach(function (p) { rec.push([p + ((S.est && (loadCfg().coll || {})[p] == null) ? " (estimate)" : ""), r.perProv[p].coll == null ? "" : r.perProv[p].coll]); });
      rec.push(["Total collections" + (r.anyEstimate ? " (incl. estimates)" : ""), r.collTotal]);
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

  window.__mlsComp = { open: open, close: close, version: "1.1.0" };
})();
