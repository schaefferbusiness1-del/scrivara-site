/* feat_visit_detail.js — MLS ScribeFlow
 * Polished per-visit DETAIL UI: each visit in the "🗂 Visit history" list
 * expands into a clean, readable, self-contained read view (all §40 fields +
 * RVU info + comprehensive AI summary) AND supports INLINE EDIT in the same
 * panel — no re-opening a raw editor. Writes back to the SAME patient.visits[]
 * model (by reference) via the app's own upsertPatient(); editing one visit
 * never disturbs the others.
 *
 * Progressive enhancement only: own scope, try/catch, idempotent, fully
 * reversible (window.__mlsVisitDetail.revert()). Reuses __mlsVisitModel
 * (getVisits / summarizeVisit / _normVisit), __mlsRVU (lookup / sumVisit),
 * upsertPatient, activePatient. No backend / ScribeFlow.html / extension edits.
 * Loaded by a one-line guarded loader appended to mls-connect.js.
 */
(function () {
  "use strict";
  if (window.__mlsVisitDetail && window.__mlsVisitDetail.installed) return;

  var VERSION = "1.0.0";

  /* ---------- tiny helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function arr(v) {
    if (Array.isArray(v)) return v.filter(function (x) { return x != null && String(x).trim() !== ""; });
    if (v == null || v === "") return [];
    return String(v)
      .split(/[\n,;]+/)
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }
  function fmtDate(d) {
    if (!d) return "(undated)";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
    if (!m) return String(d);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var mi = parseInt(m[2], 10) - 1;
    return months[mi] + " " + parseInt(m[3], 10) + ", " + m[1];
  }
  function sourceLabel(s) {
    return ({
      manual: "Manual entry",
      "manual-ai": "AI-structured",
      "mls-app": "Athena copy",
      "cohort-injection": "Injection cohort",
      legacy: "Legacy"
    })[s] || (s ? String(s) : "Visit");
  }
  function money(n) {
    if (n == null || isNaN(n)) return null;
    return "$" + Math.round(n).toLocaleString();
  }

  /* ---------- styling (matches the MLS design tokens, strong contrast) ---------- */
  function injectStyle() {
    if (document.getElementById("mls-vdetail-style")) return;
    var css = [
      ".mlsvd-card{border:1px solid var(--line,#e2e8f1);border-radius:var(--r-card,14px);background:var(--card,#fff);margin:10px 0;overflow:hidden;box-shadow:var(--shadow-soft,0 1px 2px rgba(20,40,70,.05))}",
      ".mlsvd-card.mlsvd-open{box-shadow:0 4px 16px rgba(20,40,70,.10)}",
      ".mlsvd-head{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;user-select:none}",
      ".mlsvd-head:hover{background:var(--soft2,#f5f8fc)}",
      ".mlsvd-chev{color:var(--muted,#5b6b7e);font-size:11px;transition:transform .15s ease;flex:0 0 auto}",
      ".mlsvd-card.mlsvd-open .mlsvd-chev{transform:rotate(90deg)}",
      ".mlsvd-date{font-weight:700;color:var(--ink,#15293f);font-size:14px;flex:0 0 auto}",
      ".mlsvd-dot{color:var(--line,#cfd8e6);flex:0 0 auto}",
      ".mlsvd-type{color:var(--ink,#15293f);font-size:14px;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".mlsvd-hpills{display:flex;gap:5px;flex:0 0 auto;align-items:center}",
      ".mlsvd-src{font-size:11px;font-weight:600;color:var(--muted,#5b6b7e);background:var(--soft,#eef3fb);border:1px solid var(--line,#e2e8f1);padding:2px 8px;border-radius:999px;flex:0 0 auto}",
      ".mlsvd-body{padding:4px 16px 16px;border-top:1px solid var(--line,#eef1f6)}",
      ".mlsvd-sec{margin:14px 0 0}",
      ".mlsvd-lbl{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#5b6b7e);margin:0 0 6px}",
      ".mlsvd-pill{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:999px;margin:0 6px 6px 0}",
      ".mlsvd-pill-dx{background:var(--gold-bg,#fbf6e8);color:var(--gold,#a87d0a);border:1px solid #efe2bd}",
      ".mlsvd-pill-med{background:var(--soft,#eef3fb);color:var(--brand-dk,#1b4fa6);border:1px solid #d6e2f5}",
      ".mlsvd-cpt{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;padding:7px 11px;border:1px solid var(--line,#e2e8f1);border-radius:10px;background:var(--field-bg,#f7f9fc);margin:0 0 6px}",
      ".mlsvd-cpt-code{font-weight:700;color:var(--brand-dk,#1b4fa6);font-size:13px}",
      ".mlsvd-cpt-desc{color:var(--ink,#15293f);font-size:12.5px;flex:1 1 160px;min-width:120px}",
      ".mlsvd-cpt-rvu{color:var(--muted,#5b6b7e);font-size:12px;font-weight:600;white-space:nowrap}",
      ".mlsvd-rvutot{margin-top:2px;font-size:12.5px;font-weight:700;color:var(--green-dk,#0c6e4f)}",
      ".mlsvd-text{background:var(--field-bg,#f7f9fc);border:1px solid var(--line,#e2e8f1);border-radius:10px;padding:10px 12px;color:var(--ink,#15293f);font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}",
      ".mlsvd-scores{display:flex;flex-wrap:wrap;gap:8px}",
      ".mlsvd-score{display:inline-flex;flex-direction:column;align-items:flex-start;gap:1px;background:var(--field-bg,#f7f9fc);border:1px solid var(--line,#e2e8f1);border-radius:10px;padding:6px 12px;min-width:64px}",
      ".mlsvd-score b{font-size:16px;color:var(--ink,#15293f);line-height:1.1}",
      ".mlsvd-score span{font-size:10.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--muted,#5b6b7e)}",
      ".mlsvd-ai{background:rgba(37,99,201,.06);border:1px solid #d6e2f5;border-left:3px solid var(--brand,#2563c9);border-radius:10px;padding:11px 13px;color:var(--ink,#15293f);font-size:13.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}",
      ".mlsvd-ai-empty{color:var(--muted,#5b6b7e);font-style:italic}",
      ".mlsvd-raw{margin-top:14px}",
      ".mlsvd-raw>summary{cursor:pointer;font-size:12px;font-weight:600;color:var(--muted,#5b6b7e);outline:none}",
      ".mlsvd-raw pre{margin:8px 0 0;background:var(--field-bg,#f7f9fc);border:1px solid var(--line,#e2e8f1);border-radius:10px;padding:10px 12px;color:var(--ink,#15293f);font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow:auto}",
      ".mlsvd-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;align-items:center}",
      ".mlsvd-btn{font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:var(--r-ctl,10px);cursor:pointer;border:1px solid var(--line,#e2e8f1);background:#fff;color:var(--ink,#15293f);transition:background .12s ease,box-shadow .12s ease}",
      ".mlsvd-btn:hover{background:var(--soft2,#f5f8fc)}",
      ".mlsvd-btn-primary{background:var(--brand,#2563c9);border-color:var(--brand,#2563c9);color:#fff}",
      ".mlsvd-btn-primary:hover{background:var(--brand-dk,#1b4fa6)}",
      ".mlsvd-btn-ok{background:var(--green,#0f8a63);border-color:var(--green,#0f8a63);color:#fff}",
      ".mlsvd-btn-ok:hover{background:var(--green-dk,#0c6e4f)}",
      ".mlsvd-btn[disabled]{opacity:.55;cursor:default}",
      ".mlsvd-status{font-size:12.5px;font-weight:600;color:var(--muted,#5b6b7e)}",
      ".mlsvd-status.ok{color:var(--green-dk,#0c6e4f)}",
      ".mlsvd-status.err{color:var(--red,#d24447)}",
      ".mlsvd-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-top:6px}",
      ".mlsvd-f{display:flex;flex-direction:column;gap:4px}",
      ".mlsvd-f.wide{grid-column:1/-1}",
      ".mlsvd-f label{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#5b6b7e)}",
      ".mlsvd-f input,.mlsvd-f textarea{font:inherit;font-size:13.5px;color:var(--ink,#15293f);background:#fff;border:1px solid var(--line,#e2e8f1);border-radius:9px;padding:8px 10px;width:100%;box-sizing:border-box}",
      ".mlsvd-f textarea{resize:vertical;min-height:64px;line-height:1.45}",
      ".mlsvd-f input:focus,.mlsvd-f textarea:focus{outline:none;border-color:var(--brand,#2563c9);box-shadow:var(--ring,0 0 0 3px rgba(37,99,201,.18))}",
      ".mlsvd-hint{font-size:11px;color:var(--muted,#5b6b7e)}",
      ".mlsvd-scrow{display:flex;gap:10px;flex-wrap:wrap}",
      ".mlsvd-scrow .mlsvd-f{flex:1 1 90px;min-width:80px}"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "mls-vdetail-style";
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- RVU helpers (graceful if __mlsRVU absent) ---------- */
  function rvuLookup(code) {
    try { return window.__mlsRVU && window.__mlsRVU.lookup ? window.__mlsRVU.lookup(code) : null; }
    catch (e) { return null; }
  }
  function rvuSum(codes) {
    try { return window.__mlsRVU && window.__mlsRVU.sumVisit ? window.__mlsRVU.sumVisit(codes) : null; }
    catch (e) { return null; }
  }

  /* ---------- READ view ---------- */
  function buildRead(v) {
    var body = el("div", "mlsvd-body mlsvd-read");

    // Diagnoses
    var dx = arr(v.icd10);
    if (dx.length) {
      var s = el("div", "mlsvd-sec");
      s.appendChild(el("div", "mlsvd-lbl", "Diagnoses · ICD-10"));
      var wrap = el("div");
      dx.forEach(function (c) { wrap.appendChild(el("span", "mlsvd-pill mlsvd-pill-dx", esc(c))); });
      s.appendChild(wrap);
      body.appendChild(s);
    }

    // Procedures / CPT with RVU
    var cpt = arr(v.cpt);
    if (cpt.length) {
      var sc = el("div", "mlsvd-sec");
      sc.appendChild(el("div", "mlsvd-lbl", "Procedures · CPT"));
      cpt.forEach(function (c) {
        var info = rvuLookup(c);
        var row = el("div", "mlsvd-cpt");
        row.appendChild(el("span", "mlsvd-cpt-code", esc(c)));
        row.appendChild(el("span", "mlsvd-cpt-desc", esc(info && info.desc ? info.desc : "")));
        if (info && (info.w != null || info.t != null)) {
          var bits = [];
          if (info.w != null) bits.push(info.w + " wRVU");
          if (info.t != null) bits.push(info.t + " RVU");
          row.appendChild(el("span", "mlsvd-cpt-rvu", esc(bits.join(" · "))));
        }
        sc.appendChild(row);
      });
      var sum = rvuSum(cpt);
      if (sum && (sum.w || sum.t)) {
        var tline = "Visit total: " + (sum.w || 0) + " wRVU";
        if (sum.t) tline += " · " + sum.t + " RVU";
        var dol = money(sum.tDollars);
        if (dol) tline += " · " + dol;
        sc.appendChild(el("div", "mlsvd-rvutot", esc(tline)));
      }
      body.appendChild(sc);
    }

    // Medications
    var meds = arr(v.meds);
    if (meds.length) {
      var sm = el("div", "mlsvd-sec");
      sm.appendChild(el("div", "mlsvd-lbl", "Medications"));
      var mw = el("div");
      meds.forEach(function (m) { mw.appendChild(el("span", "mlsvd-pill mlsvd-pill-med", esc(m))); });
      sm.appendChild(mw);
      body.appendChild(sm);
    }

    // Findings
    if (v.findings && String(v.findings).trim()) {
      var sf = el("div", "mlsvd-sec");
      sf.appendChild(el("div", "mlsvd-lbl", "Exam findings"));
      sf.appendChild(el("div", "mlsvd-text", esc(v.findings)));
      body.appendChild(sf);
    }

    // Scores
    var scores = v.scores && typeof v.scores === "object" ? v.scores : {};
    var skeys = Object.keys(scores).filter(function (k) { return scores[k] != null && scores[k] !== ""; });
    if (skeys.length) {
      var ss = el("div", "mlsvd-sec");
      ss.appendChild(el("div", "mlsvd-lbl", "Pain & function scores"));
      var sw = el("div", "mlsvd-scores");
      skeys.forEach(function (k) {
        var unit = /odi|function/i.test(k) ? "%" : (/vas|nrs|pain/i.test(k) ? "/10" : "");
        var sc2 = el("div", "mlsvd-score");
        sc2.appendChild(el("b", null, esc(scores[k]) + (unit ? '<span style="font-size:11px;font-weight:600;color:var(--muted,#5b6b7e)"> ' + unit + "</span>" : "")));
        sc2.appendChild(el("span", null, esc(k)));
        sw.appendChild(sc2);
      });
      ss.appendChild(sw);
      body.appendChild(ss);
    }

    // Plan
    if (v.plan && String(v.plan).trim()) {
      var sp = el("div", "mlsvd-sec");
      sp.appendChild(el("div", "mlsvd-lbl", "Plan / follow-up"));
      sp.appendChild(el("div", "mlsvd-text", esc(v.plan)));
      body.appendChild(sp);
    }

    // AI summary
    var sa = el("div", "mlsvd-sec");
    sa.appendChild(el("div", "mlsvd-lbl", "AI summary"));
    if (v.aiSummary && String(v.aiSummary).trim()) {
      sa.appendChild(el("div", "mlsvd-ai", esc(v.aiSummary)));
    } else {
      sa.appendChild(el("div", "mlsvd-ai mlsvd-ai-empty", "No AI summary yet — use “Regenerate AI summary”."));
    }
    body.appendChild(sa);

    // Raw captured data
    if (v.raw && String(v.raw).trim()) {
      var det = el("details", "mlsvd-raw");
      det.appendChild(el("summary", null, "Full captured visit data"));
      var pre = el("pre");
      pre.textContent = String(v.raw);
      det.appendChild(pre);
      body.appendChild(det);
    }

    // Actions
    var acts = el("div", "mlsvd-acts");
    var editBtn = el("button", "mlsvd-btn mlsvd-btn-primary mlsvd-edit", "✏️ Edit visit");
    var regenBtn = el("button", "mlsvd-btn mlsvd-regen", "✨ Regenerate AI summary");
    var status = el("span", "mlsvd-status");
    acts.appendChild(editBtn);
    acts.appendChild(regenBtn);
    acts.appendChild(status);
    body.appendChild(acts);

    return { body: body, editBtn: editBtn, regenBtn: regenBtn, status: status };
  }

  /* ---------- EDIT view ---------- */
  function field(labelTxt, name, value, opts) {
    opts = opts || {};
    var f = el("div", "mlsvd-f" + (opts.wide ? " wide" : ""));
    f.appendChild(el("label", null, esc(labelTxt)));
    var input;
    if (opts.textarea) {
      input = el("textarea");
    } else {
      input = el("input");
      input.type = opts.type || "text";
    }
    input.setAttribute("data-fld", name);
    input.value = value == null ? "" : value;
    if (opts.ph) input.placeholder = opts.ph;
    if (opts.min != null) input.min = opts.min;
    if (opts.max != null) input.max = opts.max;
    f.appendChild(input);
    if (opts.hint) f.appendChild(el("div", "mlsvd-hint", esc(opts.hint)));
    return f;
  }

  function buildEdit(v) {
    var body = el("div", "mlsvd-body mlsvd-editview");
    var form = el("div", "mlsvd-form");
    var scores = v.scores && typeof v.scores === "object" ? v.scores : {};

    form.appendChild(field("Date", "date", v.date || "", { type: "date" }));
    form.appendChild(field("Visit type / procedure", "type", v.type || "", { ph: "e.g. Transforaminal ESI L4-L5" }));
    form.appendChild(field("Diagnoses · ICD-10", "icd10", arr(v.icd10).join(", "), { wide: true, ph: "comma-separated, e.g. M54.16, M51.36", hint: "Separate codes with commas" }));
    form.appendChild(field("Procedures · CPT", "cpt", arr(v.cpt).join(", "), { wide: true, ph: "comma-separated, e.g. 64483, 99213", hint: "Separate codes with commas" }));
    form.appendChild(field("Medications", "meds", arr(v.meds).join("\n"), { wide: true, textarea: true, hint: "One per line (or comma-separated)" }));
    form.appendChild(field("Exam findings", "findings", v.findings || "", { wide: true, textarea: true }));

    // scores row
    var scWrap = el("div", "mlsvd-f wide");
    scWrap.appendChild(el("label", null, "Pain & function"));
    var scRow = el("div", "mlsvd-scrow");
    [["VAS", "VAS", "/10", 0, 10], ["NRS", "NRS", "/10", 0, 10], ["ODI", "ODI", "%", 0, 100]].forEach(function (s) {
      var f = el("div", "mlsvd-f");
      f.appendChild(el("label", null, s[0] + " " + s[2]));
      var inp = el("input");
      inp.type = "number"; inp.min = s[3]; inp.max = s[4];
      inp.setAttribute("data-score", s[1]);
      inp.value = scores[s[1]] == null ? "" : scores[s[1]];
      f.appendChild(inp);
      scRow.appendChild(f);
    });
    scWrap.appendChild(scRow);
    form.appendChild(scWrap);

    form.appendChild(field("Plan / follow-up", "plan", v.plan || "", { wide: true, textarea: true }));
    form.appendChild(field("AI summary", "aiSummary", v.aiSummary || "", { wide: true, textarea: true, hint: "Editable; or use Regenerate in the read view" }));

    body.appendChild(form);

    var acts = el("div", "mlsvd-acts");
    var saveBtn = el("button", "mlsvd-btn mlsvd-btn-ok mlsvd-save", "💾 Save");
    var cancelBtn = el("button", "mlsvd-btn mlsvd-cancel", "Cancel");
    var status = el("span", "mlsvd-status");
    acts.appendChild(saveBtn);
    acts.appendChild(cancelBtn);
    acts.appendChild(status);
    body.appendChild(acts);

    return { body: body, form: form, saveBtn: saveBtn, cancelBtn: cancelBtn, status: status };
  }

  function readForm(form) {
    var out = {};
    form.querySelectorAll("[data-fld]").forEach(function (i) {
      out[i.getAttribute("data-fld")] = i.value;
    });
    var scores = {};
    form.querySelectorAll("[data-score]").forEach(function (i) {
      var val = i.value.trim();
      if (val !== "") {
        var num = Number(val);
        scores[i.getAttribute("data-score")] = isNaN(num) ? val : num;
      }
    });
    return { fields: out, scores: scores };
  }

  /* ---------- persistence ---------- */
  function persist(patient) {
    try {
      if (typeof window.upsertPatient === "function") { window.upsertPatient(patient); return true; }
    } catch (e) {}
    return false;
  }

  /* Apply edited values onto the SAME visit object (by reference), preserving
     untouched fields (id, raw, source, captured, extra score keys). */
  function applyEdit(visit, parsed) {
    var f = parsed.fields;
    visit.date = (f.date || "").trim();
    visit.type = (f.type || "").trim();
    visit.icd10 = arr(f.icd10);
    visit.cpt = arr(f.cpt);
    visit.meds = arr(f.meds);
    visit.findings = (f.findings || "").trim();
    visit.plan = (f.plan || "").trim();
    visit.aiSummary = (f.aiSummary || "").trim();
    // merge scores: keep any pre-existing non-VAS/NRS/ODI keys, overwrite the three
    var keep = {};
    if (visit.scores && typeof visit.scores === "object") {
      Object.keys(visit.scores).forEach(function (k) {
        if (!/^(VAS|NRS|ODI)$/.test(k)) keep[k] = visit.scores[k];
      });
    }
    Object.keys(parsed.scores).forEach(function (k) { keep[k] = parsed.scores[k]; });
    visit.scores = keep;
    return visit;
  }

  /* ---------- collapsed header ---------- */
  function buildHeader(v) {
    var head = el("div", "mlsvd-head");
    head.appendChild(el("span", "mlsvd-chev", "▶"));
    head.appendChild(el("span", "mlsvd-date", esc(fmtDate(v.date))));
    head.appendChild(el("span", "mlsvd-dot", "·"));
    head.appendChild(el("span", "mlsvd-type", esc(v.type || "Visit")));
    var pills = el("div", "mlsvd-hpills");
    pills.appendChild(el("span", "mlsvd-src", esc(sourceLabel(v.source))));
    head.appendChild(pills);
    return head;
  }

  /* ---------- one card (header + lazy detail), with read<->edit toggle ---------- */
  function buildCard(patient, visit) {
    var card = el("div", "mlsvd-card");
    card.setAttribute("data-vid", visit.id || "");
    var head = buildHeader(visit);
    card.appendChild(head);
    var slot = el("div", "mlsvd-slot");
    slot.style.display = "none";
    card.appendChild(slot);

    var rendered = false;

    function refreshHeader() {
      head.querySelector(".mlsvd-date").textContent = fmtDate(visit.date);
      head.querySelector(".mlsvd-type").textContent = visit.type || "Visit";
      head.querySelector(".mlsvd-src").textContent = sourceLabel(visit.source);
    }

    function showRead() {
      card.classList.remove("mlsvd-editing");
      slot.innerHTML = "";
      var r = buildRead(visit);
      slot.appendChild(r.body);
      r.editBtn.addEventListener("click", function (e) { e.stopPropagation(); showEdit(); });
      r.regenBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        regenerate(r.regenBtn, r.status);
      });
    }

    function showEdit() {
      card.classList.add("mlsvd-editing");
      slot.innerHTML = "";
      var ed = buildEdit(visit);
      slot.appendChild(ed.body);
      ed.cancelBtn.addEventListener("click", function (e) { e.stopPropagation(); showRead(); });
      ed.saveBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var parsed = readForm(ed.form);
        applyEdit(visit, parsed);
        var ok = persist(patient);
        refreshHeader();
        ed.status.className = "mlsvd-status " + (ok ? "ok" : "err");
        ed.status.textContent = ok ? "Saved ✓" : "Saved locally (sync unavailable)";
        setTimeout(showRead, 650);
      });
      // prevent header-collapse clicks while typing
      ed.body.addEventListener("click", function (e) { e.stopPropagation(); });
    }

    function regenerate(btn, status) {
      var M = window.__mlsVisitModel;
      if (!M || typeof M.summarizeVisit !== "function") {
        status.className = "mlsvd-status err"; status.textContent = "AI summary unavailable"; return;
      }
      btn.disabled = true;
      status.className = "mlsvd-status"; status.textContent = "Generating…";
      Promise.resolve()
        .then(function () { return M.summarizeVisit(visit, patient, function (m) { status.textContent = String(m); }); })
        .then(function (res) {
          if (typeof res === "string" && res.trim()) visit.aiSummary = res.trim();
          persist(patient);
          status.className = "mlsvd-status ok"; status.textContent = "Updated ✓";
          // refresh the AI panel in place
          var ai = slot.querySelector(".mlsvd-ai");
          if (ai) { ai.className = "mlsvd-ai"; ai.textContent = visit.aiSummary || ""; }
          btn.disabled = false;
        })
        .catch(function (err) {
          btn.disabled = false;
          status.className = "mlsvd-status err";
          status.textContent = "Could not generate (" + (err && err.message ? err.message : "error") + ")";
        });
    }

    head.addEventListener("click", function () {
      var open = card.classList.toggle("mlsvd-open");
      slot.style.display = open ? "" : "none";
      if (open && !rendered) { rendered = true; showRead(); }
    });

    return card;
  }

  /* ---------- find the live visit-history section & swap in our cards ---------- */
  function sectionSignature(patient, visits) {
    return (patient && (patient.id || patient.name) || "") + "|" + visits.map(function (v) { return v.id || v.date || ""; }).join(",");
  }

  function enhance(patient) {
    try {
      var M = window.__mlsVisitModel;
      if (!M || typeof M.getVisits !== "function") return;
      var root = document.getElementById("profileCard") || document;
      var origCards = root.querySelectorAll(".mlsvh-v");
      if (!origCards.length) return; // empty state — nothing to enhance
      var anchor = origCards[0];
      var container = anchor.parentElement;
      if (!container) return;

      // don't disturb an in-progress edit
      if (container.querySelector(".mlsvd-card.mlsvd-editing")) return;

      var visits = M.getVisits(patient) || [];
      var sig = sectionSignature(patient, visits);
      if (container.getAttribute("data-mlsvd-sig") === sig &&
          container.querySelectorAll(".mlsvd-card").length === visits.length) {
        // already enhanced for this exact set — just remove any leftover originals
        container.querySelectorAll(".mlsvh-v").forEach(function (n) { n.remove(); });
        return;
      }

      injectStyle();
      // build our cards
      var frag = document.createDocumentFragment();
      visits.forEach(function (v) { frag.appendChild(buildCard(patient, v)); });

      // remove our previously-built cards (if any) and the original cards,
      // inserting fresh ones at the anchor position
      container.querySelectorAll(".mlsvd-card").forEach(function (n) { n.remove(); });
      container.insertBefore(frag, anchor);
      container.querySelectorAll(".mlsvh-v").forEach(function (n) { n.remove(); });
      container.setAttribute("data-mlsvd-sig", sig);
    } catch (e) { /* silent: progressive enhancement */ }
  }

  /* debounced enhance bound to the active patient */
  var _t = null;
  function scheduleEnhance(patient) {
    clearTimeout(_t);
    _t = setTimeout(function () {
      var p = patient;
      if (!p && typeof window.activePatient === "function") { try { p = window.activePatient(); } catch (e) {} }
      if (p) enhance(p);
    }, 30);
  }

  /* ---------- install: wrap __mlsVisitUI.render ---------- */
  var _origRender = null;
  function install() {
    injectStyle();
    var UI = window.__mlsVisitUI;
    if (UI && typeof UI.render === "function" && !UI.render.__mlsvdWrapped) {
      _origRender = UI.render.bind(UI);
      var wrapped = function (patient) {
        // Never let an app re-render (heartbeat / data refresh) tear down an
        // in-progress inline edit and lose the doctor's unsaved changes.
        try {
          if (document.querySelector(".mlsvd-card.mlsvd-editing")) return undefined;
        } catch (e) {}
        var r;
        try { r = _origRender.apply(null, arguments); } catch (e) { r = undefined; }
        scheduleEnhance(patient);
        return r;
      };
      wrapped.__mlsvdWrapped = true;
      UI.render = wrapped;
    }
    // enhance whatever is on screen right now
    scheduleEnhance(null);
  }

  function revert() {
    try {
      var UI = window.__mlsVisitUI;
      if (UI && UI.render && UI.render.__mlsvdWrapped && _origRender) UI.render = _origRender;
      var st = document.getElementById("mls-vdetail-style");
      if (st) st.remove();
      document.querySelectorAll(".mlsvd-card").forEach(function (n) { n.remove(); });
      document.querySelectorAll("[data-mlsvd-sig]").forEach(function (n) { n.removeAttribute("data-mlsvd-sig"); });
    } catch (e) {}
  }

  /* retry install until __mlsVisitUI is present (loader order independent) */
  var tries = 0;
  (function waitInstall() {
    if (window.__mlsVisitUI && typeof window.__mlsVisitUI.render === "function") { install(); return; }
    if (tries++ < 80) setTimeout(waitInstall, 125);
    else install(); // give up waiting; style + on-screen enhance still apply
  })();

  window.__mlsVisitDetail = {
    installed: true,
    version: VERSION,
    enhance: enhance,
    buildCard: buildCard,
    buildRead: buildRead,
    buildEdit: buildEdit,
    applyEdit: applyEdit,
    readForm: readForm,
    _fmtDate: fmtDate,
    _arr: arr,
    revert: revert
  };
})();
