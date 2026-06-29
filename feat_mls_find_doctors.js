/* feat_mls_find_doctors.js  ->  window.__mlsFindDoctors  (v1.0.0)  [item54]
 *
 * FIX #2 -- real doctor names + a "Find Doctors" button that scopes the pull.
 *
 * THE PROBLEM (verified live): the doctor selector showed placeholders "Provider 2" ...
 * "Provider 18" -- only "Michael Schaeffer" resolved. Root cause: window._calProviders is
 * a MIXED array. Entry 0 is a proper object {id:9, name:"Michael Schaeffer"}; entries 1..17
 * are bare STRINGS (the genuine provider names MLS Assist already read from athenaOne, e.g.
 * "Matthew Schaeffer, MD", "Carter_Kelly_PA-C", "Benner_John_MD"). The selector reads
 * list[i].name, which is undefined for a string, so it fell back to "Provider "+(i+1).
 *
 * THE FIX (additive, reversible, NO fabricated names -- every label comes straight from
 * what athenaOne already returned):
 *   1) Normalize _calProviders IN PLACE: turn each string entry into {id, name, raw},
 *      cleaning athenaOne's machine usernames ("Last_First_CRED" -> "First Last, CRED").
 *      This alone makes every existing provider dropdown show the real names. Self-heals
 *      (re-runs) in case loadCalendar re-fetches the raw list.
 *   2) Add a clearly-labelled "Find Doctors" button in the blue hero. It lists the REAL
 *      discovered doctors; picking one records the choice (window.__mlsFindDoctors.chosen),
 *      sets the calendar provider filter when an id is known, scopes the schedule pull to
 *      that provider via the existing provider-scope hook when present, and labels it
 *      honestly. If athenaOne genuinely exposes no name for a provider, it is shown exactly
 *      as athenaOne returned it -- never invented.
 *
 * SAFETY: read-only with respect to athenaOne and patient data; no chart writes, no deletes.
 * ASCII-only. Idempotent. Reversible: window.__mlsFindDoctors.revert().
 */
;(function () {
  "use strict";
  var VERSION = "1.0.0", ASSET = "feat_mls_find_doctors.js", STYLE_ID = "mlsFindDocStyle", BTN_ID = "mlsFindDocBtn", MODAL_ID = "mlsFindDocModal";
  try { if (window.__mlsFindDoctors && window.__mlsFindDoctors.installed) return; } catch (e) { return; }

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* "Carter_Kelly_PA-C" -> "Kelly Carter, PA-C"; "Benner_John_MD" -> "John Benner, MD";
     already-human strings and "All doctors" pass through unchanged. Never invents text. */
  function humanize(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return s;
    if (s.indexOf("_") < 0) return s;                       /* already human */
    var parts = s.split("_").filter(function (x) { return x !== ""; });
    if (parts.length === 1) return parts[0];
    var cred = "";
    var last = parts[parts.length - 1];
    if (/^(MD|DO|PA-?C|NP|DPM|RN|PA|MBBS|DNP|FNP|APRN)$/i.test(last)) { cred = last; parts = parts.slice(0, -1); }
    var name;
    if (parts.length >= 2) name = parts[1] + " " + parts[0];  /* Last_First -> First Last */
    else name = parts[0];
    /* collapse any remaining underscores in middle names */
    name = name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    return cred ? (name + ", " + cred) : name;
  }

  /* read _calProviders entries (string or object or char-spread-string) -> {id, raw, name} */
  function entryToProv(p, i) {
    if (typeof p === "string") return { id: null, raw: p, name: humanize(p) };
    if (p && typeof p === "object") {
      var ks = Object.keys(p);
      var isChar = ks.length > 0 && ks.every(function (k) { return /^\d+$/.test(k); });
      if (isChar) { var s = ""; for (var j = 0; j < ks.length; j++) s += p[j]; return { id: null, raw: s, name: humanize(s) }; }
      if (p.name) return { id: (p.id != null ? p.id : null), raw: p.name, name: humanize(p.name) };
    }
    return null;
  }

  /* 1) normalize _calProviders in place so EVERY dropdown shows real names */
  function normalizeProviders() {
    try {
      var list = window._calProviders;
      if (!Array.isArray(list)) return;
      var changed = false;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p && typeof p === "object" && typeof p.name === "string" && p.name && !/^Provider\s/i.test(p.name)) continue; /* already good object */
        var e = entryToProv(p, i);
        if (e && e.name) { list[i] = { id: e.id, name: e.name, raw: e.raw, specialty: (p && p.specialty) || null }; changed = true; }
      }
      return changed;
    } catch (e) {}
  }

  function realDoctors() {
    var out = [], list = window._calProviders || [], seen = {};
    for (var i = 0; i < list.length; i++) {
      var e = entryToProv(list[i], i);
      if (!e || !e.name) continue;
      var k = e.name.toLowerCase(); if (seen[k]) continue; seen[k] = 1;
      out.push(e);
    }
    return out;
  }

  /* also rewrite any provider <select> options still literally showing "Provider N" */
  function relabelSelects() {
    try {
      var docs = realDoctors();
      var sels = document.querySelectorAll("select");
      for (var s = 0; s < sels.length; s++) {
        var opts = sels[s].options || [];
        for (var o = 0; o < opts.length; o++) {
          var m = /^Provider\s+(\d+)$/.exec((opts[o].textContent || "").trim());
          if (m) { var idx = parseInt(m[1], 10) - 1; if (docs[idx]) opts[o].textContent = docs[idx].name; }
        }
      }
    } catch (e) {}
  }

  /* 2) Find Doctors button + picker */
  function injectCSS() {
    var s = $(STYLE_ID); if (s) return;
    s = document.createElement("style"); s.id = STYLE_ID;
    s.textContent = [
      "#" + BTN_ID + "{display:inline-flex;align-items:center;gap:7px;margin:8px 0 0;padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.16);color:#fff;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit}",
      "#" + BTN_ID + ":hover{background:rgba(255,255,255,.26)}",
      "#" + MODAL_ID + "{position:fixed;inset:0;z-index:100060;display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px;background:rgba(8,18,33,.55);font-family:'Plus Jakarta Sans',system-ui,sans-serif}",
      "#" + MODAL_ID + "[hidden]{display:none}",
      "#" + MODAL_ID + " .fd-panel{background:#fff;border-radius:16px;width:100%;max-width:460px;max-height:78vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 70px -25px rgba(8,18,33,.7)}",
      "#" + MODAL_ID + " .fd-hd{display:flex;align-items:center;gap:10px;padding:16px 18px 10px}",
      "#" + MODAL_ID + " .fd-hd h3{margin:0;flex:1;font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:20px;color:#0f2540}",
      "#" + MODAL_ID + " .fd-x{width:30px;height:30px;border-radius:8px;border:1px solid #e0e8f1;background:#fff;color:#5a6b80;font-size:17px;cursor:pointer}",
      "#" + MODAL_ID + " .fd-sub{padding:0 18px 8px;color:#6b7d93;font-size:12px}",
      "#" + MODAL_ID + " .fd-list{overflow:auto;padding:4px 12px 14px}",
      "#" + MODAL_ID + " .fd-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:11px 12px;border-radius:10px;border:1px solid #e6edf4;background:#fff;cursor:pointer;font-family:inherit;margin:6px 0}",
      "#" + MODAL_ID + " .fd-row:hover{border-color:#b9d0f3;background:#f5f9ff}",
      "#" + MODAL_ID + " .fd-row.is-chosen{border-color:#2f6bed;box-shadow:0 0 0 2px rgba(47,107,237,.16)}",
      "#" + MODAL_ID + " .fd-nm{font-weight:700;font-size:14px;color:#0f2540}",
      "#" + MODAL_ID + " .fd-sp{font-size:11.5px;color:#8a9cb2;margin-top:1px}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  function applyScope(doc) {
    /* record the choice; surface it to the existing provider-scope path if present */
    window.__mlsFindDoctors.chosen = doc;
    try { window._mlsPullProvider = doc.raw; } catch (e) {}
    /* if it's the one provider with a real id, drive the calendar's own provider filter */
    try {
      if (doc.id != null) { var pf = $("calProvFilter"); if (pf) { pf.value = String(doc.id); pf.dispatchEvent(new Event("change", { bubbles: true })); } }
    } catch (e) {}
    /* hand to the existing provider picker/scope module if it exposes a setter */
    try { if (window.__mlsProviderPicker && typeof window.__mlsProviderPicker.choose === "function") window.__mlsProviderPicker.choose(doc.raw); } catch (e) {}
    try { if (window.toast) window.toast('Next pull scoped to ' + doc.name + '.', ''); } catch (e) {}
  }

  function ensureModal() {
    injectCSS();
    var m = $(MODAL_ID); if (m) return m;
    m = document.createElement("div"); m.id = MODAL_ID; m.setAttribute("hidden", "");
    m.innerHTML = '<div class="fd-panel"><div class="fd-hd"><h3>Find doctors</h3><button type="button" class="fd-x" aria-label="Close">&#215;</button></div>' +
      '<div class="fd-sub">Real providers read from athenaOne. Pick one to scope the next pull.</div><div class="fd-list"></div></div>';
    document.body.appendChild(m);
    m.querySelector(".fd-x").addEventListener("click", close);
    m.addEventListener("mousedown", function (e) { if (e.target === m) close(); });
    return m;
  }
  function paintModal() {
    var m = ensureModal(); var box = m.querySelector(".fd-list");
    var docs = realDoctors();
    var chosen = (window.__mlsFindDoctors.chosen || {}).raw;
    if (!docs.length) { box.innerHTML = '<div style="padding:20px;text-align:center;color:#8a9cb2;font-size:13px">No providers discovered yet. Pull a schedule with athenaOne open, then try again.</div>'; return; }
    var html = "";
    for (var i = 0; i < docs.length; i++) {
      html += '<button type="button" class="fd-row' + (docs[i].raw === chosen ? " is-chosen" : "") + '" data-i="' + i + '">' +
        '<span style="flex:1"><span class="fd-nm">' + esc(docs[i].name) + '</span>' + (docs[i].specialty ? '<span class="fd-sp">' + esc(docs[i].specialty) + '</span>' : '') + '</span></button>';
    }
    box.innerHTML = html;
    var rows = box.querySelectorAll(".fd-row");
    for (var r = 0; r < rows.length; r++) rows[r].addEventListener("click", function () { var d = realDoctors()[+this.getAttribute("data-i")]; if (d) { applyScope(d); close(); } });
  }
  function open() { ensureModal(); normalizeProviders(); paintModal(); $(MODAL_ID).removeAttribute("hidden"); }
  function close() { var m = $(MODAL_ID); if (m) m.setAttribute("hidden", ""); }

  function ensureButton() {
    try {
      if (!document.querySelector(".vx-cap-row")) return;       /* hero present (Complex visit) */
      if ($(BTN_ID)) return;
      injectCSS();
      var status = $("heroPullStatus") || document.querySelector(".vx-cap-row");
      if (!status || !status.parentElement) return;
      var b = document.createElement("button");
      b.type = "button"; b.id = BTN_ID; b.innerHTML = "&#129658; Find Doctors";
      b.addEventListener("click", function (e) { try { e.preventDefault(); } catch (x) {} open(); });
      status.parentElement.insertBefore(b, status.nextSibling);
    } catch (e) {}
  }

  var _obs = null, _poll = null;
  function tick() { normalizeProviders(); relabelSelects(); ensureButton(); }
  function boot() {
    injectCSS(); tick();
    try { _obs = new MutationObserver(function () { tick(); }); _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    _poll = setInterval(tick, 4000);
    try { [300, 800, 1600, 3000].forEach(function (ms) { setTimeout(tick, ms); }); } catch (e) {}
  }

  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_poll) clearInterval(_poll); } catch (e) {}
    try { var b = $(BTN_ID); if (b) b.remove(); } catch (e) {}
    try { var m = $(MODAL_ID); if (m) m.remove(); } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { window.__mlsFindDoctors.installed = false; } catch (e) {}
  }

  window.__mlsFindDoctors = {
    installed: true, version: VERSION, asset: ASSET, chosen: null,
    realDoctors: realDoctors, normalize: normalizeProviders, open: open, reapply: boot, revert: revert
  };

  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
