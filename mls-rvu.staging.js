/*! mls-rvu.js — RVU (Relative Value Units) for MLS
 *  Self-contained, additive, no-op-on-error progressive enhancement.
 *  - Attaches work RVU (wRVU) + total RVU to CPT/E&M codes wherever they appear:
 *      • the Visit-tab coding panel (#codeCard / #code_cpt / #code_em)
 *      • the Billing Code Sheet picker & manager (.mlscs-ov / .mlscs-row[data-code])
 *    showing per-code wRVU (and total RVU) and a per-visit total.
 *  - Adds an RVU Productivity tracker into the Analysis area (Premium-gated,
 *    consistent with the app's effectivePremium()/.mls-prem-pill pattern):
 *    cumulative wRVUs per day/week/month and per provider, with an optional
 *    dollar estimate using the Medicare conversion factor (clearly an estimate).
 *  - RVU reference table is editable / import / export / reset / refreshable,
 *    stored per-user in localStorage. Unknown values render as "— verify" and
 *    are never fabricated.
 *
 *  Data source for the seed: AANEM "RVU Comparison" (CMS Physician Fee Schedule
 *  derived) work RVUs + non-facility total RVUs. Work RVUs for these codes are
 *  stable into FY2026. Dollar estimates use the CY2026 Medicare conversion
 *  factor ($33.40 non-QP; $33.57 QP). A few codes are flagged "verify" — confirm
 *  against the official CMS RVU26A file. Nothing here is PHI or a secret.
 *
 *  Namespace: window.__mlsRVU         Manager: __mlsRVU.open()
 */
/* Non-blocking dialog helpers: native only when the in-app modals are absent. */
try{
  if(typeof window.mlsConfirm!=='function'){ window.mlsConfirm=function(m){ return Promise.resolve(window.confirm(m)); }; }
  if(typeof window.mlsPrompt!=='function'){ window.mlsPrompt=function(m,d){ return Promise.resolve(window.prompt(m,d==null?'':d)); }; }
}catch(e){}
(function () {
  'use strict';
  if (window.__mlsRVU && window.__mlsRVU.__installed) return;

  // ----------------------------------------------------------------------- meta
  var SEED_VERSION = 1;
  var DATA_SOURCE = 'AANEM RVU Comparison (CMS PFS-derived) — work RVUs stable into FY2026';
  var DATA_YEAR = '2024 work RVUs / CY2026 conversion factor';
  var CF_2026_NONQP = 33.40; // CY2026 Medicare conversion factor (non-QP)
  var CF_2026_QP = 33.57;    // CY2026 Medicare conversion factor (qualifying APM participant)

  // Seed RVU table. w = work RVU; t = total non-facility RVU (national, GPCI 1.0);
  // addon = CPT add-on code; verify = confirm against official CMS RVU26A.
  // null w/t => unknown, rendered "— verify", never fabricated.
  var SEED = {
    // ---- E&M office (2021-revision values; CMS-stable) ----
    '99202': { w: 0.93, t: 2.17, kind: 'em', desc: 'Office/outpatient new, level 2' },
    '99203': { w: 1.60, t: 3.35, kind: 'em', desc: 'Office/outpatient new, level 3' },
    '99204': { w: 2.60, t: 5.02, kind: 'em', desc: 'Office/outpatient new, level 4' },
    '99205': { w: 3.50, t: 6.62, kind: 'em', desc: 'Office/outpatient new, level 5' },
    '99211': { w: 0.18, t: 0.70, kind: 'em', desc: 'Office/outpatient est, level 1' },
    '99212': { w: 0.70, t: 1.70, kind: 'em', desc: 'Office/outpatient est, level 2' },
    '99213': { w: 1.30, t: 2.73, kind: 'em', desc: 'Office/outpatient est, level 3' },
    '99214': { w: 1.92, t: 3.85, kind: 'em', desc: 'Office/outpatient est, level 4' },
    '99215': { w: 2.80, t: 5.42, kind: 'em', desc: 'Office/outpatient est, level 5' },
    // ---- Epidural steroid injections (transforaminal) ----
    '64479': { w: 1.90, t: 7.76, kind: 'cpt', verify: 1, desc: 'TFESI cervical/thoracic, single level' },
    '64480': { w: 1.20, t: 4.04, kind: 'cpt', addon: 1, desc: 'TFESI cervical/thoracic, each add’l level' },
    '64483': { w: 1.90, t: 7.40, kind: 'cpt', desc: 'TFESI lumbar/sacral, single level' },
    '64484': { w: 1.00, t: 3.34, kind: 'cpt', addon: 1, desc: 'TFESI lumbar/sacral, each add’l level' },
    // ---- Epidural steroid injections (interlaminar/caudal, with imaging) ----
    '62320': { w: 1.55, t: 4.06, kind: 'cpt', desc: 'Interlaminar ESI cervical/thoracic, no imaging' },
    '62321': { w: 1.95, t: 7.89, kind: 'cpt', verify: 1, desc: 'Interlaminar ESI cervical/thoracic, w/ imaging' },
    '62322': { w: 1.80, t: 4.92, kind: 'cpt', desc: 'Interlaminar ESI lumbar/sacral, no imaging' },
    '62323': { w: 2.29, t: 7.98, kind: 'cpt', verify: 1, desc: 'Interlaminar ESI lumbar/sacral, w/ imaging' },
    // ---- Facet / medial branch blocks ----
    '64490': { w: 1.82, t: 5.79, kind: 'cpt', desc: 'Paravertebral facet inj, cervical/thoracic, 1st level' },
    '64491': { w: 1.16, t: 2.92, kind: 'cpt', addon: 1, desc: 'Facet inj cervical/thoracic, 2nd level' },
    '64492': { w: 1.16, t: 2.93, kind: 'cpt', addon: 1, desc: 'Facet inj cervical/thoracic, 3rd+ level' },
    '64493': { w: 1.52, t: 5.33, kind: 'cpt', desc: 'Paravertebral facet inj, lumbar/sacral, 1st level' },
    '64494': { w: 1.00, t: 2.73, kind: 'cpt', addon: 1, desc: 'Facet inj lumbar/sacral, 2nd level' },
    '64495': { w: 1.00, t: 2.73, kind: 'cpt', addon: 1, desc: 'Facet inj lumbar/sacral, 3rd+ level' },
    // ---- Radiofrequency / neurolytic facet denervation ----
    '64633': { w: 3.32, t: 13.15, kind: 'cpt', desc: 'RF facet denervation, cervical/thoracic, 1st joint' },
    '64634': { w: 1.32, t: 7.67, kind: 'cpt', addon: 1, desc: 'RF facet denervation cervical/thoracic, add’l' },
    '64635': { w: 3.32, t: 13.26, kind: 'cpt', desc: 'RF facet denervation, lumbar/sacral, 1st joint' },
    '64636': { w: 1.16, t: 7.20, kind: 'cpt', addon: 1, desc: 'RF facet denervation lumbar/sacral, add’l' },
    '64640': { w: null, t: null, kind: 'cpt', verify: 1, desc: 'Destruction by neurolytic agent, other peripheral nerve' },
    // ---- Peripheral nerve block ----
    '64450': { w: 0.75, t: 2.26, kind: 'cpt', desc: 'Injection, other peripheral nerve or branch' },
    // ---- SI / joints / soft tissue ----
    '27096': { w: 1.48, t: 4.93, kind: 'cpt', desc: 'Sacroiliac joint injection, w/ imaging' },
    '20610': { w: 0.79, t: 1.96, kind: 'cpt', desc: 'Arthrocentesis/inj, major joint, w/o US' },
    '20605': { w: 0.68, t: 1.66, kind: 'cpt', desc: 'Arthrocentesis/inj, intermediate joint, w/o US' },
    '20550': { w: 0.75, t: 1.74, kind: 'cpt', desc: 'Injection, tendon sheath/ligament' },
    '20552': { w: 0.75, t: 1.74, kind: 'cpt', desc: 'Trigger point injection, 1–2 muscles' },
    '20553': { w: 1.19, t: null, kind: 'cpt', verify: 1, desc: 'Trigger point injection, 3+ muscles' },
    // ---- Imaging guidance ----
    '77002': { w: 0.54, t: null, kind: 'cpt', addon: 1, verify: 1, desc: 'Fluoro guidance, needle (imaging bundled into most spine inj)' },
    '77003': { w: 0.60, t: 3.16, kind: 'cpt', addon: 1, desc: 'Fluoro guidance, spine/epidural inj' },
    // ---- Spinal cord stimulation ----
    '63650': { w: 7.15, t: null, kind: 'cpt', verify: 1, desc: 'Percutaneous implantation, neurostimulator electrode (facility-based)' }
  };

  // -------------------------------------------------------------------- storage
  function curEmail() {
    try {
      if (typeof window.bkUser === 'object' && window.bkUser && window.bkUser.email) return window.bkUser.email;
    } catch (e) {}
    try {
      // fall back to a per-user key already in localStorage
      var k = Object.keys(localStorage).find(function (x) { return /^sf_u::[^:]+::/.test(x) && x.indexOf('::_::') < 0; });
      if (k) return k.split('::')[1];
    } catch (e) {}
    return '_';
  }
  function LS_KEY() { return 'sf_u::' + curEmail() + '::mlsRvuTable'; }

  function defaultState() {
    return { version: SEED_VERSION, cf: CF_2026_NONQP, compPerWrvu: null, source: DATA_SOURCE, year: DATA_YEAR, table: cloneSeed() };
  }
  function cloneSeed() {
    var o = {}; Object.keys(SEED).forEach(function (c) { o[c] = JSON.parse(JSON.stringify(SEED[c])); }); return o;
  }
  function load() {
    var st;
    try { st = JSON.parse(localStorage.getItem(LS_KEY()) || 'null'); } catch (e) { st = null; }
    if (!st || typeof st !== 'object' || !st.table) st = defaultState();
    if (typeof st.cf !== 'number' || !(st.cf > 0)) st.cf = CF_2026_NONQP;
    // ensure newly-seeded codes appear even on an older saved table (additive, non-destructive)
    var seed = cloneSeed(), added = 0;
    Object.keys(seed).forEach(function (c) { if (!st.table[c]) { st.table[c] = seed[c]; added++; } });
    if (added) save(st);
    return st;
  }
  function save(st) { try { localStorage.setItem(LS_KEY(), JSON.stringify(st)); } catch (e) {} }
  var STATE = load();

  // ----------------------------------------------------------------- utilities
  function codeOf(s) {
    if (s == null) return null;
    var m = String(s).match(/\b([0-9CG][0-9A-Z]{4})\b/); // 5-char CPT/HCPCS
    if (m) return m[1];
    m = String(s).match(/\b(\d{5})\b/);
    return m ? m[1] : null;
  }
  function lookup(code) {
    if (!code) return null;
    var c = codeOf(code) || String(code).trim();
    var r = STATE.table[c];
    return r ? Object.assign({ code: c }, r) : { code: c, w: null, t: null, unknown: true };
  }
  function fmt(n) { return (n == null || isNaN(n)) ? '—' : (Math.round(n * 100) / 100).toFixed(2); }
  function money(n) { return (n == null || isNaN(n)) ? '—' : ('$' + (Math.round(n * 100) / 100).toFixed(2)); }

  // Sum a list of code strings/objects into a per-visit RVU summary.
  function sumVisit(codes) {
    var out = { w: 0, t: 0, tDollars: 0, items: [], unknown: [], hasT: false };
    if (!codes) return out;
    (Array.isArray(codes) ? codes : [codes]).forEach(function (raw) {
      var c = codeOf(raw); if (!c) return;
      var r = lookup(c);
      if (r.w == null && r.t == null) { out.unknown.push(c); out.items.push({ code: c, w: null, t: null, verify: true }); return; }
      if (typeof r.w === 'number') out.w += r.w;
      if (typeof r.t === 'number') { out.t += r.t; out.hasT = true; }
      out.items.push({ code: c, w: r.w, t: r.t, addon: r.addon, verify: r.verify });
    });
    out.tDollars = out.hasT ? out.t * STATE.cf : null;
    return out;
  }

  function isPremium() {
    try { if (typeof window.effectivePremium === 'function') return !!window.effectivePremium(); } catch (e) {}
    try { return !!(window.bkUser && (window.bkUser.premium || window.bkUser.isAdmin)); } catch (e) {}
    return false;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  // ---------------------------------------------------------------------- CSS
  function injectCSS() {
    if (document.getElementById('mlsRvuCSS')) return;
    var css = ''
      + '.mlsrvu-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;'
      + 'padding:1px 7px;border-radius:999px;background:var(--accent-weak,#e8f0fe);color:var(--accent,#2563eb);'
      + 'border:1px solid var(--accent,#2563eb);margin-left:8px;white-space:nowrap;vertical-align:middle;line-height:1.6}'
      + '.mlsrvu-badge.verify{background:#fff5e6;color:#b46a00;border-color:#e0a64d}'
      + '.mlsrvu-badge .t{opacity:.7;font-weight:600}'
      + '.mlsrvu-total{margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--panel,#f4f7fb);'
      + 'border:1px solid var(--line,#dbe2ec);font-size:12.5px;color:var(--text,#1f2a3a);display:flex;flex-wrap:wrap;gap:10px;align-items:center}'
      + '.mlsrvu-total b{font-size:14px}'
      + '.mlsrvu-total .pill{font-weight:700;color:var(--accent,#2563eb)}'
      + '.mlsrvu-foot{margin-top:6px;font-size:12px;color:var(--muted,#5b6b85)}'
      + '.mlsrvu-ov{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:99980;display:flex;align-items:center;justify-content:center;padding:18px}'
      + '.mlsrvu-modal{--bg:#fff;--text:#15233d;--panel:#eef2f9;--line:#cfd7e6;--muted:#5b6b85;--accent:#2563eb;'
      + 'background:var(--bg);color:var(--text);width:760px;max-width:96vw;max-height:90vh;overflow:auto;border-radius:14px;'
      + 'box-shadow:0 18px 60px rgba(0,0,0,.35);padding:0}'
      + '.mlsrvu-modal h3{margin:0;font-size:17px}'
      + '.mlsrvu-mh{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:2}'
      + '.mlsrvu-mb{padding:14px 18px}'
      + '.mlsrvu-x{border:none;background:transparent;font-size:20px;cursor:pointer;color:var(--muted);line-height:1}'
      + '.mlsrvu-tbl{width:100%;border-collapse:collapse;font-size:13px}'
      + '.mlsrvu-tbl th,.mlsrvu-tbl td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}'
      + '.mlsrvu-tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}'
      + '.mlsrvu-tbl td.num,.mlsrvu-tbl th.num{text-align:right;font-variant-numeric:tabular-nums}'
      + '.mlsrvu-tbl input{width:64px;border:1px solid var(--line);border-radius:6px;padding:3px 5px;font-size:13px;text-align:right}'
      + '.mlsrvu-tbl input.desc{width:100%;text-align:left}'
      + '.mlsrvu-btn{border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;font-weight:600}'
      + '.mlsrvu-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}'
      + '.mlsrvu-btn.warn{color:#b42318;border-color:#e6a39b}'
      + '.mlsrvu-row-actions{display:flex;gap:6px;flex-wrap:wrap}'
      + '.mlsrvu-note{font-size:12px;color:var(--muted);margin:8px 0}'
      + '.mlsrvu-verify{color:#b46a00;font-weight:700}'
      + '.mlsrvu-field{display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-right:14px}'
      + '.mlsrvu-field input{width:84px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:13px;text-align:right}'
      // productivity panel
      + '.mlsrvu-prod{border:1px solid var(--line,#dbe2ec);border-radius:12px;padding:16px;margin:14px 0;background:var(--card,#fff)}'
      + '.mlsrvu-prod h2{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:18px}'
      + '.mlsrvu-kpis{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}'
      + '.mlsrvu-kpi{flex:1 1 140px;min-width:130px;border:1px solid var(--line,#dbe2ec);border-radius:10px;padding:10px 12px;background:var(--panel,#f6f8fc)}'
      + '.mlsrvu-kpi .v{font-size:22px;font-weight:800;color:var(--accent,#2563eb);font-variant-numeric:tabular-nums}'
      + '.mlsrvu-kpi .l{font-size:11px;color:var(--muted,#5b6b85);text-transform:uppercase;letter-spacing:.03em;margin-top:2px}'
      + '.mlsrvu-bars{display:flex;align-items:flex-end;gap:6px;height:120px;margin:8px 0;padding-top:10px;border-bottom:1px solid var(--line,#dbe2ec)}'
      + '.mlsrvu-bar{flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px}'
      + '.mlsrvu-bar .b{width:70%;min-height:2px;background:var(--accent,#2563eb);border-radius:4px 4px 0 0;transition:height .2s}'
      + '.mlsrvu-bar .bl{font-size:9.5px;color:var(--muted,#5b6b85);white-space:nowrap;transform:rotate(-35deg);transform-origin:center;margin-top:6px}'
      + '.mlsrvu-bar .bv{font-size:10px;font-weight:700;color:var(--text,#1f2a3a)}'
      + '.mlsrvu-seg{display:inline-flex;border:1px solid var(--line,#dbe2ec);border-radius:8px;overflow:hidden;margin:4px 0}'
      + '.mlsrvu-seg button{border:none;background:var(--bg,#fff);padding:5px 12px;font-size:12.5px;cursor:pointer;color:var(--muted,#5b6b85)}'
      + '.mlsrvu-seg button.on{background:var(--accent,#2563eb);color:#fff;font-weight:700}'
      + '.mlsrvu-locked{border:1px dashed var(--line,#cfd7e6);border-radius:10px;padding:20px;text-align:center;color:var(--muted,#5b6b85)}'
      + '.mls-prem-pill,.mlsrvu-pill{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.04em;padding:2px 7px;border-radius:999px;background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;vertical-align:middle}';
    var s = document.createElement('style'); s.id = 'mlsRvuCSS'; s.textContent = css; document.head.appendChild(s);
  }

  // -------------------------------------------------------- badge / annotation
  function badgeHTML(r) {
    if (!r || (r.w == null && r.t == null)) return '<span class="mlsrvu-badge verify" title="RVU not set — verify against CMS RVU26A">— verify</span>';
    var t = (r.t == null) ? '' : ' <span class="t">· ' + fmt(r.t) + ' tot</span>';
    var cls = r.verify ? 'mlsrvu-badge verify' : 'mlsrvu-badge';
    var tip = r.verify ? 'wRVU (confirm vs CMS RVU26A)' : 'work RVU' + (r.t != null ? ' · total RVU (non-facility, GPCI 1.0)' : '');
    return '<span class="' + cls + '" title="' + esc(tip) + '">' + fmt(r.w) + ' wRVU' + t + (r.verify ? ' ⚠' : '') + '</span>';
  }

  // ---- 1) Visit-tab coding panel: #code_cpt / #code_em inside #codeCard ----
  function annotateCodeCard() {
    var card = document.getElementById('codeCard'); if (!card) return;
    var codes = [];
    [['code_cpt', 'cpt'], ['code_em', 'em']].forEach(function (pair) {
      var el = document.getElementById(pair[0]); if (!el) return;
      // find code tokens in the element's text; annotate inline once
      var txt = el.textContent || '';
      var found = txt.match(/\b([0-9CG][0-9A-Z]{4}|\d{5})\b/g) || [];
      found.forEach(function (c) { codes.push(c); });
      // inline badges: only annotate leaf nodes that ARE a code chip (avoid clutter) — append a single summary instead
    });
    // de-dupe while keeping order
    var seen = {}, uniq = codes.filter(function (c) { if (seen[c]) return false; seen[c] = 1; return true; });
    var sig = uniq.join(',');
    var holder = document.getElementById('mlsRvuCardTotal');
    if (card.getAttribute('data-mlsrvu-sig') === sig && holder) return; // unchanged
    card.setAttribute('data-mlsrvu-sig', sig);
    if (holder) holder.remove();
    if (!uniq.length) return;
    var s = sumVisit(uniq);
    holder = document.createElement('div');
    holder.id = 'mlsRvuCardTotal'; holder.className = 'mlsrvu-total';
    var perCode = s.items.map(function (it) {
      return '<span class="mlsrvu-badge' + (it.verify ? ' verify' : '') + '">' + esc(it.code) + ': ' + (it.w == null ? '— verify' : fmt(it.w) + ' wRVU') + '</span>';
    }).join(' ');
    holder.innerHTML =
      '<b>RVU</b> <span class="pill">' + fmt(s.w) + ' wRVU</span>'
      + (s.hasT ? ' &nbsp;·&nbsp; ' + fmt(s.t) + ' total RVU' : '')
      + (s.tDollars != null ? ' &nbsp;·&nbsp; ' + money(s.tDollars) + ' <span style="opacity:.7">est. Medicare (CF ' + money(STATE.cf) + ', GPCI 1.0)</span>' : '')
      + '<span style="flex-basis:100%;height:0"></span>' + perCode
      + (s.unknown.length ? '<span style="flex-basis:100%;height:0"></span><span class="mlsrvu-verify">No RVU on file for: ' + esc(s.unknown.join(', ')) + ' — add it in the RVU table.</span>' : '')
      + '<span style="flex-basis:100%;height:0"></span><button class="mlsrvu-btn" id="mlsRvuOpenFromCard" style="padding:3px 9px;font-size:12px">RVU table</button>';
    var disc = document.getElementById('codeDisclaim');
    if (disc && disc.parentNode === card) card.insertBefore(holder, disc); else card.appendChild(holder);
    var b = document.getElementById('mlsRvuOpenFromCard'); if (b) b.onclick = openManager;
  }

  // ---- 2) Billing Code Sheet picker + manager (.mlscs-ov / .mlscs-row) ----
  function annotateCodeSheet(root) {
    // Manager rows carry data-code on the row itself; picker rows (labels) carry
    // it on the child checkbox (.mlscs-chk[data-code]) — handle both.
    var rows = (root || document).querySelectorAll('.mlscs-row');
    rows.forEach(function (row) {
      if (row.querySelector('.mlsrvu-badge')) return;
      var withCode = row.getAttribute('data-code') ? row : row.querySelector('[data-code]');
      var code = (row.getAttribute('data-code')) || (withCode && withCode.getAttribute && withCode.getAttribute('data-code'));
      if (!code) { var cc = row.querySelector('.mlscs-code'); if (cc) code = cc.textContent.trim(); }
      code = codeOf(code) || code;
      if (!code) return;
      var r = lookup(code);
      var desc = row.querySelector('.mlscs-desc') || row.querySelector('.mlscs-code') || row;
      var b = document.createElement('span'); b.innerHTML = badgeHTML(r);
      (desc.parentNode === row ? row : desc).appendChild(b.firstChild);
    });
    // picker footer: live per-visit total of checked codes
    var ov = (root && root.classList && root.classList.contains('mlscs-ov')) ? root : (root || document).querySelector('.mlscs-ov');
    if (ov) {
      var foot = ov.querySelector('.mlscs-foot');
      var isPicker = !!ov.querySelector('.mlscs-chk');
      if (foot && isPicker && !foot.querySelector('#mlsRvuPickTotal')) {
        var span = document.createElement('span'); span.id = 'mlsRvuPickTotal';
        span.style.cssText = 'flex-basis:100%;margin-top:6px;font-size:12.5px;font-weight:700;color:var(--accent,#2563eb)';
        foot.appendChild(span);
        var update = function () {
          var picked = Array.prototype.map.call(ov.querySelectorAll('.mlscs-chk:checked'), function (c) { return c.getAttribute('data-code'); });
          var s = sumVisit(picked);
          span.innerHTML = picked.length
            ? ('Selected RVU: ' + fmt(s.w) + ' wRVU' + (s.hasT ? ' · ' + fmt(s.t) + ' total RVU' : '') + (s.tDollars != null ? ' · ' + money(s.tDollars) + ' est. Medicare' : '') + (s.unknown.length ? ' · (' + s.unknown.length + ' w/o RVU)' : ''))
            : '';
        };
        ov.addEventListener('change', function (e) { if (e.target && e.target.classList && e.target.classList.contains('mlscs-chk')) update(); });
        update();
      }
      // manager head: add an "RVU table" button once
      var head = ov.querySelector('.mlscs-head');
      var isManager = !ov.querySelector('.mlscs-chk');
      if (head && isManager && !head.querySelector('#mlsRvuMgrBtn')) {
        var btn = document.createElement('button');
        btn.id = 'mlsRvuMgrBtn'; btn.type = 'button'; btn.className = 'mlscs-btn';
        btn.textContent = '📊 RVU table'; btn.style.cssText = 'margin-left:auto;margin-right:8px';
        btn.onclick = openManager;
        var x = head.querySelector('.mlscs-x'); if (x) head.insertBefore(btn, x); else head.appendChild(btn);
      }
    }
  }

  // --------------------------------------------------- 3) Productivity tracker
  function startOfWeek(d) { var x = new Date(d); var day = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x; }
  function keyFor(ts, gran) {
    var d = new Date(ts);
    if (gran === 'day') return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (gran === 'week') { var s = startOfWeek(d); return s.getFullYear() + '-' + String(s.getMonth() + 1).padStart(2, '0') + '-' + String(s.getDate()).padStart(2, '0'); }
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); // month
  }
  function labelFor(key, gran) {
    if (gran === 'month') { var p = key.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1] + ' ' + p[0]; }
    var d = new Date(key + 'T00:00:00'); return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function gatherNotes(includeDrafts) {
    var notes = [];
    try { if (typeof window.patientNotes === 'function') notes = window.patientNotes() || []; } catch (e) { notes = []; }
    if (!Array.isArray(notes)) notes = [];
    var rows = [];
    notes.forEach(function (n) {
      if (!n || !n.coding) return;
      var signed = (n.signed === true || n.signed === 'true');
      if (!signed && !includeDrafts) return;
      var ts = +(n.created || n.updated || 0); if (!ts) return;
      var codes = [];
      if (Array.isArray(n.coding.cpt)) n.coding.cpt.forEach(function (x) { var c = codeOf(x); if (c) codes.push(c); });
      if (n.coding.em) { var ec = codeOf(n.coding.em); if (ec) codes.push(ec); }
      if (!codes.length) return;
      var s = sumVisit(codes);
      var provider = (n.provider || n.author || (window.bkUser && window.bkUser.name) || providerName() || 'This provider');
      rows.push({ ts: ts, w: s.w, t: s.t, hasT: s.hasT, dollars: s.tDollars, provider: provider, signed: signed, unknown: s.unknown.length });
    });
    return rows;
  }
  function providerName() {
    try { var k = 'sf_u::' + curEmail() + '::docname'; return localStorage.getItem(k) || localStorage.getItem('sf_u::' + curEmail() + '::providerName'); } catch (e) { return null; }
  }

  var PROD = { gran: 'month', drafts: false };

  function renderProductivity() {
    var view = document.getElementById('analysisView'); if (!view) return;
    var host = document.getElementById('mlsRvuProd');
    if (!host) {
      host = document.createElement('div'); host.id = 'mlsRvuProd'; host.className = 'mlsrvu-prod card';
      view.appendChild(host);
    }
    var prem = isPremium();
    var head = '<h2>📊 RVU Productivity <span class="mls-prem-pill">PREMIUM</span></h2>'
      + '<p class="mlsrvu-note">Work RVUs from your signed visits’ CPT &amp; E/M codes. Dollar figures are estimates using the Medicare conversion factor (national, GPCI 1.0) — not a payment guarantee.</p>';
    if (!prem) {
      host.innerHTML = head + '<div class="mlsrvu-locked"><div style="font-weight:700;font-size:15px;margin-bottom:4px">Premium feature</div>'
        + 'RVU productivity tracking (cumulative wRVUs by day/week/month and by provider, with dollar estimates) is included with the Premium plan. '
        + 'Per-code RVUs in your notes and code sheet remain available on every plan.</div>';
      return;
    }
    var rows = gatherNotes(PROD.drafts);
    if (!rows.length) {
      host.innerHTML = head + '<div class="mlsrvu-locked">No coded ' + (PROD.drafts ? '' : 'signed ') + 'visits yet. Sign a visit with CPT/E&amp;M codes and your wRVUs will appear here.'
        + ' <label style="display:block;margin-top:8px;font-size:12px"><input type="checkbox" id="mlsRvuDrafts"' + (PROD.drafts ? ' checked' : '') + '> include drafts</label></div>';
      var dc = document.getElementById('mlsRvuDrafts'); if (dc) dc.onchange = function () { PROD.drafts = dc.checked; renderProductivity(); };
      return;
    }
    // aggregate
    var totalW = 0, totalT = 0, totalD = 0, anyT = false, anyD = false, unknownVisits = 0;
    var byPeriod = {}, byProv = {};
    rows.forEach(function (r) {
      totalW += r.w; if (r.hasT) { totalT += r.t; anyT = true; } if (r.dollars != null) { totalD += r.dollars; anyD = true; }
      if (r.unknown) unknownVisits++;
      var k = keyFor(r.ts, PROD.gran); (byPeriod[k] = byPeriod[k] || { w: 0, n: 0 }); byPeriod[k].w += r.w; byPeriod[k].n++;
      (byProv[r.provider] = byProv[r.provider] || { w: 0, n: 0 }); byProv[r.provider].w += r.w; byProv[r.provider].n++;
    });
    var keys = Object.keys(byPeriod).sort();
    var maxW = Math.max.apply(null, keys.map(function (k) { return byPeriod[k].w; }).concat([0.0001]));
    var avgPerVisit = totalW / rows.length;

    var kpis = '<div class="mlsrvu-kpis">'
      + kpi(fmt(totalW), 'Total wRVU')
      + kpi(String(rows.length), (PROD.drafts ? 'visits' : 'signed visits'))
      + kpi(fmt(avgPerVisit), 'wRVU / visit')
      + (anyD ? kpi(money(totalD), 'est. Medicare ($)') : '')
      + (STATE.compPerWrvu ? kpi(money(totalW * STATE.compPerWrvu), 'est. comp @ ' + money(STATE.compPerWrvu) + '/wRVU') : '')
      + '</div>';

    var seg = '<div class="mlsrvu-seg" id="mlsRvuGran">'
      + ['day', 'week', 'month'].map(function (g) { return '<button data-g="' + g + '"' + (PROD.gran === g ? ' class="on"' : '') + '>' + g[0].toUpperCase() + g.slice(1) + '</button>'; }).join('')
      + '</div>';

    var lastKeys = keys.slice(-14);
    var bars = '<div class="mlsrvu-bars">' + lastKeys.map(function (k) {
      var h = Math.round((byPeriod[k].w / maxW) * 96);
      return '<div class="mlsrvu-bar" title="' + esc(labelFor(k, PROD.gran)) + ': ' + fmt(byPeriod[k].w) + ' wRVU (' + byPeriod[k].n + ' visits)">'
        + '<span class="bv">' + fmt(byPeriod[k].w) + '</span><div class="b" style="height:' + h + 'px"></div><span class="bl">' + esc(labelFor(k, PROD.gran)) + '</span></div>';
    }).join('') + '</div>';

    var provRows = Object.keys(byProv).sort(function (a, b) { return byProv[b].w - byProv[a].w; }).map(function (p) {
      return '<tr><td>' + esc(p) + '</td><td class="num">' + byProv[p].n + '</td><td class="num">' + fmt(byProv[p].w) + '</td><td class="num">' + fmt(byProv[p].w / byProv[p].n) + '</td></tr>';
    }).join('');
    var provTbl = '<table class="mlsrvu-tbl" style="margin-top:8px"><thead><tr><th>Provider</th><th class="num">Visits</th><th class="num">wRVU</th><th class="num">wRVU/visit</th></tr></thead><tbody>' + provRows + '</tbody></table>';

    var periodRows = keys.slice().reverse().slice(0, 12).map(function (k) {
      return '<tr><td>' + esc(labelFor(k, PROD.gran)) + '</td><td class="num">' + byPeriod[k].n + '</td><td class="num">' + fmt(byPeriod[k].w) + '</td>'
        + '<td class="num">' + (anyD ? money(periodDollars(rows, k)) : '—') + '</td></tr>';
    }).join('');
    var periodTbl = '<table class="mlsrvu-tbl" style="margin-top:8px"><thead><tr><th>' + PROD.gran[0].toUpperCase() + PROD.gran.slice(1) + '</th><th class="num">Visits</th><th class="num">wRVU</th><th class="num">est. Medicare</th></tr></thead><tbody>' + periodRows + '</tbody></table>';

    var ctl = '<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:10px">'
      + '<label class="mlsrvu-field">CF $ <input type="number" step="0.01" id="mlsRvuCF" value="' + STATE.cf + '"></label>'
      + '<label class="mlsrvu-field">$/wRVU <input type="number" step="0.01" id="mlsRvuComp" value="' + (STATE.compPerWrvu || '') + '" placeholder="optional"></label>'
      + '<label class="mlsrvu-field" style="gap:5px"><input type="checkbox" id="mlsRvuDrafts2"' + (PROD.drafts ? ' checked' : '') + '> include drafts</label>'
      + '<button class="mlsrvu-btn" id="mlsRvuOpenMgr2">RVU table</button>'
      + '</div>'
      + (unknownVisits ? '<p class="mlsrvu-note mlsrvu-verify">' + unknownVisits + ' visit(s) include a code with no RVU on file — add it in the RVU table for a complete total.</p>' : '');

    host.innerHTML = head + kpis + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><b style="font-size:13px">wRVU by ' + PROD.gran + '</b>' + seg + '</div>' + bars + periodTbl
      + '<b style="font-size:13px;display:block;margin-top:14px">By provider</b>' + provTbl + ctl;

    // wire controls
    var g = document.getElementById('mlsRvuGran'); if (g) g.querySelectorAll('button').forEach(function (b) { b.onclick = function () { PROD.gran = b.getAttribute('data-g'); renderProductivity(); }; });
    var cf = document.getElementById('mlsRvuCF'); if (cf) cf.onchange = function () { var v = parseFloat(cf.value); if (v > 0) { STATE.cf = v; save(STATE); renderProductivity(); } };
    var cp = document.getElementById('mlsRvuComp'); if (cp) cp.onchange = function () { var v = parseFloat(cp.value); STATE.compPerWrvu = (v > 0 ? v : null); save(STATE); renderProductivity(); };
    [document.getElementById('mlsRvuDrafts2')].forEach(function (d) { if (d) d.onchange = function () { PROD.drafts = d.checked; renderProductivity(); }; });
    var om = document.getElementById('mlsRvuOpenMgr2'); if (om) om.onclick = openManager;
  }
  function periodDollars(rows, key) { var s = 0; rows.forEach(function (r) { if (r.dollars != null && keyFor(r.ts, PROD.gran) === key) s += r.dollars; }); return s; }
  function kpi(v, l) { return '<div class="mlsrvu-kpi"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div></div>'; }

  // -------------------------------------------------------------- manager UI
  function openManager() {
    closeManager();
    injectCSS();
    var ov = document.createElement('div'); ov.className = 'mlsrvu-ov'; ov.id = 'mlsRvuOv';
    ov.addEventListener('click', function (e) { if (e.target === ov) closeManager(); });
    var codes = Object.keys(STATE.table).sort(function (a, b) {
      var ka = STATE.table[a].kind === 'em' ? '0' : '1', kb = STATE.table[b].kind === 'em' ? '0' : '1';
      return (ka + a).localeCompare(kb + b);
    });
    var body = codes.map(function (c) {
      var r = STATE.table[c];
      return '<tr data-code="' + esc(c) + '">'
        + '<td><b>' + esc(c) + '</b>' + (r.addon ? ' <span style="font-size:10px;color:#888">add-on</span>' : '') + (r.verify ? ' <span class="mlsrvu-verify" title="confirm vs CMS RVU26A">⚠</span>' : '') + '</td>'
        + '<td><input class="desc" data-f="desc" value="' + esc(r.desc || '') + '"></td>'
        + '<td class="num"><input data-f="w" type="number" step="0.01" value="' + (r.w == null ? '' : r.w) + '" placeholder="—"></td>'
        + '<td class="num"><input data-f="t" type="number" step="0.01" value="' + (r.t == null ? '' : r.t) + '" placeholder="—"></td>'
        + '<td class="num">' + (r.w == null ? '—' : money((r.t != null ? r.t : r.w) * STATE.cf)) + '</td>'
        + '<td><button class="mlsrvu-btn warn" data-del="' + esc(c) + '" title="remove">✕</button></td>'
        + '</tr>';
    }).join('');
    ov.innerHTML =
      '<div class="mlsrvu-modal" role="dialog" aria-label="RVU table">'
      + '<div class="mlsrvu-mh"><h3>📊 RVU table</h3><button class="mlsrvu-x" id="mlsRvuClose">✕</button></div>'
      + '<div class="mlsrvu-mb">'
      + '<p class="mlsrvu-note">Source: ' + esc(STATE.source) + ' · ' + esc(STATE.year) + '. <b>wRVU</b> = work RVU; <b>total</b> = total non-facility RVU (national, GPCI 1.0). '
      + 'Codes flagged ⚠ are <span class="mlsrvu-verify">to verify</span> against the official CMS RVU26A file. Edit any value; blank = unknown (shown as “— verify”). Nothing is billed from here.</p>'
      + '<div style="margin:8px 0;display:flex;flex-wrap:wrap;gap:14px;align-items:center">'
      + '<label class="mlsrvu-field">Conversion factor $ <input type="number" step="0.01" id="mlsRvuCFmgr" value="' + STATE.cf + '"></label>'
      + '<span class="mlsrvu-note" style="margin:0">CY2026: $33.40 non-QP · $33.57 QP</span>'
      + '</div>'
      + '<table class="mlsrvu-tbl"><thead><tr><th>Code</th><th>Description</th><th class="num">wRVU</th><th class="num">Total RVU</th><th class="num">est. $ (CF)</th><th></th></tr></thead><tbody id="mlsRvuBody">' + body + '</tbody></table>'
      + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">'
      + '<button class="mlsrvu-btn primary" id="mlsRvuAdd">+ Add code</button>'
      + '<button class="mlsrvu-btn" id="mlsRvuExport">⬇ Export JSON</button>'
      + '<button class="mlsrvu-btn" id="mlsRvuImport">⬆ Import JSON</button>'
      + '<button class="mlsrvu-btn warn" id="mlsRvuReset" title="restore the seeded values">↺ Reset to seed</button>'
      + '<input type="file" id="mlsRvuFile" accept="application/json,.json" style="display:none">'
      + '</div>'
      + '<p class="mlsrvu-note">Refreshing for a new year: download the official CMS RVU26A file, then edit the values here (or Import a JSON you maintain). Changes save automatically to your account.</p>'
      + '</div></div>';
    document.body.appendChild(ov);
    // wire
    document.getElementById('mlsRvuClose').onclick = closeManager;
    document.getElementById('mlsRvuCFmgr').onchange = function () { var v = parseFloat(this.value); if (v > 0) { STATE.cf = v; save(STATE); refreshAll(); openManager(); } };
    document.getElementById('mlsRvuBody').addEventListener('input', function (e) {
      var tr = e.target.closest('tr'); if (!tr) return; var c = tr.getAttribute('data-code'); var f = e.target.getAttribute('data-f'); if (!c || !f) return;
      var r = STATE.table[c]; if (!r) return;
      if (f === 'desc') r.desc = e.target.value;
      else { var v = e.target.value.trim(); r[f] = (v === '' ? null : parseFloat(v)); if (isNaN(r[f])) r[f] = null; if (r.w != null) r.verify = 0; }
      save(STATE);
    });
    document.getElementById('mlsRvuBody').addEventListener('click', async function (e) {
      var c = e.target.getAttribute && e.target.getAttribute('data-del'); if (!c) return;
      if (await window.mlsConfirm('Remove ' + c + ' from your RVU table?')) { delete STATE.table[c]; save(STATE); openManager(); refreshAll(); }
    });
    document.getElementById('mlsRvuAdd').onclick = async function () {
      var c = (await window.mlsPrompt('CPT / HCPCS code (5 chars):') || '').trim().toUpperCase(); if (!c) return;
      if (!/^[0-9A-Z]{5}$/.test(c)) { (window.toast||window.alert)('That doesn’t look like a 5-character code.'); return; }
      var w = await window.mlsPrompt('Work RVU for ' + c + ' (leave blank if unknown):'); var t = await window.mlsPrompt('Total non-facility RVU for ' + c + ' (optional):');
      STATE.table[c] = { w: (w && !isNaN(parseFloat(w))) ? parseFloat(w) : null, t: (t && !isNaN(parseFloat(t))) ? parseFloat(t) : null, kind: /^99[02]/.test(c) ? 'em' : 'cpt', desc: (await window.mlsPrompt('Short description (optional):')) || '' };
      save(STATE); openManager(); refreshAll();
    };
    document.getElementById('mlsRvuExport').onclick = function () {
      try {
        var blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mls-rvu-table.json'; a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      } catch (e) { (window.toast||window.alert)('Export failed: ' + e.message); }
    };
    document.getElementById('mlsRvuImport').onclick = function () { document.getElementById('mlsRvuFile').click(); };
    document.getElementById('mlsRvuFile').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return; var rd = new FileReader();
      rd.onload = function () {
        try {
          var j = JSON.parse(rd.result);
          var tbl = j.table || j; if (!tbl || typeof tbl !== 'object') throw new Error('no table');
          STATE.table = tbl; if (typeof j.cf === 'number' && j.cf > 0) STATE.cf = j.cf; if (typeof j.compPerWrvu === 'number') STATE.compPerWrvu = j.compPerWrvu;
          save(STATE); openManager(); refreshAll();
        } catch (e) { (window.toast||window.alert)('Import failed: ' + e.message); }
      };
      rd.readAsText(f);
    };
    document.getElementById('mlsRvuReset').onclick = async function () {
      if (await window.mlsConfirm('Reset the RVU table to the seeded values? Your edits will be lost.')) { STATE = defaultState(); save(STATE); openManager(); refreshAll(); }
    };
  }
  function closeManager() { var o = document.getElementById('mlsRvuOv'); if (o) o.remove(); }

  // ------------------------------------------------------------------ refresh
  function refreshAll() {
    try { annotateCodeCard(); } catch (e) {}
    try { annotateCodeSheet(document); } catch (e) {}
    try { if (document.getElementById('analysisView')) renderProductivity(); } catch (e) {}
  }

  // --------------------------------------------------------------------- boot
  function boot() {
    injectCSS();
    // observe DOM for the coding panel, code-sheet overlay, and analysis view
    var obs = new MutationObserver(function (muts) {
      var touchCard = false, touchCS = false, touchAna = false;
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.target && m.target.id === 'analysisView') touchAna = true;
        var nodes = m.addedNodes || [];
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j]; if (n.nodeType !== 1) continue;
          if (n.id === 'codeCard' || n.querySelector && n.querySelector('#code_cpt,#code_em')) touchCard = true;
          if ((n.classList && n.classList.contains('mlscs-ov')) || (n.querySelector && n.querySelector('.mlscs-row[data-code]'))) touchCS = true;
          if (n.id === 'analysisView' || (n.querySelector && n.querySelector('#analysisView'))) touchAna = true;
        }
        if (m.target && (m.target.id === 'codeCard' || (m.target.closest && m.target.closest('#codeCard')))) touchCard = true;
        if (m.target && m.target.closest && m.target.closest('.mlscs-ov')) touchCS = true;
      }
      if (touchCS) try { annotateCodeSheet(document); } catch (e) {}
      if (touchCard) try { annotateCodeCard(); } catch (e) {}
      if (touchAna) try { renderProductivity(); } catch (e) {}
    });
    try { obs.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (e) {}

    // light periodic sweep (covers re-renders the observer can miss)
    setInterval(function () {
      try {
        if (document.getElementById('codeCard')) annotateCodeCard();
        if (document.querySelector('.mlscs-ov')) annotateCodeSheet(document);
        var av = document.getElementById('analysisView');
        if (av && !document.getElementById('mlsRvuProd')) renderProductivity();
      } catch (e) {}
    }, 1600);

    refreshAll();
  }

  // --------------------------------------------------------------- public API
  window.__mlsRVU = {
    __installed: true,
    open: openManager,
    close: closeManager,
    lookup: lookup,
    wrvu: function (c) { var r = lookup(c); return r ? r.w : null; },
    total: function (c) { var r = lookup(c); return r ? r.t : null; },
    sumVisit: sumVisit,
    state: function () { return STATE; },
    seed: cloneSeed,
    refresh: refreshAll,
    _codeOf: codeOf,
    _gather: gatherNotes,
    _cf: function () { return STATE.cf; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
