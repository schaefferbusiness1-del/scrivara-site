/* feat_athena_clarity.js  —  window.__mlsAthenaClarity  (v1.0.2)
 *
 * Makes EVERY Athena button instantly clear for a non-technical user:
 *   - plain, verb-first label
 *   - an ALWAYS-VISIBLE sub-label saying what it brings in / takes out (not hover-only)
 *   - a READ-ONLY / WRITES-TO-CHART / REMOVES-DATA tag chip
 *   - consistent icon + tone colour, generous tap target, strong contrast
 *   - per-patient (EMR-card) Athena buttons get the same clarity AND honest
 *     real-result reporting ("Pulled N real visits into <patient>") routed
 *     through the real §59/§61 result metadata — never a fabricated count.
 *
 * Additive, own IIFE, all work in try/catch, idempotent, reversible via
 * window.__mlsAthenaClarity.revert(). Reuses the §61 shared module
 * (window.__mlsAthenaActions) and the §59 doctor (window.__mlsAthenaDoctor)
 * read-only; never writes/saves/signs anything; reads only non-PHI metadata
 * (ok + count) from results — never the visit/chart text.
 */
(function () {
  'use strict';
  var VERSION = '1.0.3';
  if (window.__mlsAthenaClarity && window.__mlsAthenaClarity.installed) return;

  var STYLE_ID = 'mlsac-style';
  var ATTR = 'data-mlsac';            // marks a decorated button
  var SUB_CLS = 'mlsac-sub';          // the always-visible sub-label
  var TAG_CLS = 'mlsac-tag';          // the READ/WRITE/REMOVE chip
  var listeners = [];
  var observer = null;
  var pendingPull = null;             // {name, at} when a per-patient pull is in flight

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function isFn(f) { return typeof f === 'function'; }
  function norm(s) { return String(s || '').replace(/[\u{1F000}-\u{1FAFF}←-➿️]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  /* ---- the clarity catalogue: every Athena button, plain-language ---- */
  // tag: 'read'  -> READ-ONLY (green)  : only brings data IN, never changes a chart
  // tag: 'write' -> WRITES TO CHART (amber): types into the open chart (never signs)
  // tag: 'remove'-> REMOVES DATA (red) : deletes from MLS (never from Athena)
  var CATALOG = [
    { ids: ['ptPullAthenaBtn', 'ezPull'], text: ['pull from athena', 'pull open athena patient'],
      label: 'Pull from Athena', sub: 'Brings this patient’s name, DOB and past visits from the open Athena chart into MLS.', tag: 'read', icon: '📥', perPatient: true, pull: true },
    { ids: ['ptLinkBtn'], text: ['pre-visit link'],
      label: 'Pre-visit link', sub: 'Makes a link to send this patient before the visit. Stays in MLS — nothing is sent to Athena.', tag: 'read', icon: '📤', perPatient: true },
    { ids: ['ptFollowupBtn'], text: ['visit follow-ups', 'visit followups'],
      label: 'Visit follow-ups', sub: 'Shows the follow-up items from this patient’s past visits. Read-only — changes nothing.', tag: 'read', icon: '📨', perPatient: true },
    { ids: ['ptPurgeAthenaBtn'], text: ['remove athena-imported patients', 'remove athena imported patients'],
      label: 'Remove Athena-imported patients', sub: 'Deletes patients that were imported from Athena — from MLS only. Never touches the Athena chart.', tag: 'remove', icon: '🧹', perPatient: true },
    { ids: [], text: ['copy every visit', 'copy every visit from athena'],
      label: 'Copy every visit', sub: 'Brings every visit from the open Athena chart into MLS.', tag: 'read', icon: '📋', pull: true },
    { ids: [], text: ['pull today’s patients & their history', 'pull today’s schedule', 'pull todays patients & their history', 'pull today’s patients and their history'],
      label: 'Pull today’s patients', sub: 'Brings today’s scheduled patients from Athena into MLS.', tag: 'read', icon: '📅' },
    { ids: [], text: ['export everything for emr'],
      label: 'Export everything for EMR', sub: 'Copies the finished note so you can paste it into the chart. Copies only — does not write to Athena.', tag: 'read', icon: '⬇' },
    { ids: [], text: ['write note to athena chart'],
      label: 'Write note to Athena chart', sub: 'Types the finished note into the open chart as an unsigned draft. Never clicks Save or Sign.', tag: 'write', icon: '✍' },
    { ids: [], text: ['search athena & open chart', 'search by procedure', 'search athena and open chart'],
      label: 'Search Athena & open chart', sub: 'Searches Athena for matching patients and opens the chart. Read-only navigation.', tag: 'read', icon: '🔎' }
  ];

  var TAGINFO = {
    read:   { txt: 'READ-ONLY',       accent: '#15803d', bg: '#dcfce7', bd: '#86efac' },
    write:  { txt: 'WRITES TO CHART', accent: '#b45309', bg: '#fef3c7', bd: '#fcd34d' },
    remove: { txt: 'REMOVES DATA',    accent: '#b91c1c', bg: '#fee2e2', bd: '#fca5a5' }
  };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.' + SUB_CLS + '{display:block;margin-top:3px;font-size:11.5px;line-height:1.32;' +
        'color:#0f2233;opacity:.92;font-weight:400;white-space:normal;max-width:300px;}' +
      'button[' + ATTR + ']{min-height:42px;padding-top:7px;padding-bottom:7px;' +
        'text-align:left;line-height:1.25;height:auto;white-space:normal;}' +
      '.' + TAG_CLS + '{display:inline-block;margin-top:4px;padding:1px 7px;border-radius:999px;' +
        'font-size:9.5px;font-weight:700;letter-spacing:.04em;border:1px solid;}' +
      '.mlsac-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483600;' +
        'max-width:520px;padding:11px 16px;border-radius:10px;font-size:13px;font-weight:600;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.18);background:#fff;color:#0f2233;border:1px solid #cbd5e1;}' +
      '.mlsac-toast.ok{background:#EAF1EE;border-color:#D5E5DC;color:#204034;}' +
      '.mlsac-toast.warn{background:#FCF8EF;border-color:#EFE4CE;color:#B07636;}';
    (document.head || document.documentElement).appendChild(s);
  }

  function matchEntry(btn) {
    if (!btn || btn.nodeType !== 1) return null;
    var id = btn.id || '';
    var t = norm(btn.textContent);
    for (var i = 0; i < CATALOG.length; i++) {
      var e = CATALOG[i];
      if (id && e.ids.indexOf(id) >= 0) return e;
      for (var j = 0; j < e.text.length; j++) {
        var nt = norm(e.text[j]);
        if (nt && (t === nt || t.indexOf(nt) === 0)) return e;
      }
    }
    return null;
  }

  function decorateOne(btn) {
    /* Already-decorated controls dominate mature-idle scans. Bail out before
       catalog normalization/text matching so unrelated UI mutations stay
       essentially free. */
    if (!btn || btn.getAttribute(ATTR)) return false;
    var e = matchEntry(btn);
    if (!e) return false;
    btn.setAttribute(ATTR, e.tag);
    // always-visible sub-label
    var sub = document.createElement('span');
    sub.className = SUB_CLS;
    sub.textContent = e.sub;
    btn.appendChild(sub);
    // tag chip
    var ti = TAGINFO[e.tag] || TAGINFO.read;
    var chip = document.createElement('span');
    chip.className = TAG_CLS;
    chip.textContent = ti.txt;
    chip.style.color = ti.accent;
    chip.style.background = ti.bg;
    chip.style.borderColor = ti.bd;
    btn.appendChild(document.createElement('br'));
    btn.appendChild(chip);
    btn.setAttribute('title', e.label + ' — ' + e.sub);
    // keep §61's hidden intent attribute too (tooltip), but never remove it
    safe(function () {
      var sib = btn.nextSibling;
      if (sib && sib.classList && sib.classList.contains('mlsaa-intent')) sib.remove();
    });
    // per-patient pull: wire honest real-result reporting on click
    if (e.pull) {
      btn.addEventListener('click', onPullClick, true);
    }
    return true;
  }

  function currentPatientName() {
    return safe(function () {
      var ap = (typeof activePatient === 'function') ? activePatient() : null;
      if (!ap) return null;
      var nm = ap.name || ap.fullName || ((ap.first || '') + ' ' + (ap.last || '')).trim();
      return nm || null;
    }) || null;
  }

  function onPullClick() {
    pendingPull = { name: currentPatientName(), at: Date.now() };
    // auto-expire so a stray later result doesn't get mislabelled
    setTimeout(function () {
      if (pendingPull && Date.now() - pendingPull.at >= 45000) pendingPull = null;
    }, 46000);
  }

  function toast(msg, kind, opts) {
    opts = opts || {};
    ensureStyle();
    var el = document.createElement('div');
    el.className = 'mlsac-toast ' + (kind || '');
    if (opts.pullFailure) el.setAttribute('data-mls-athena-pull-failure', '1');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { safe(function () { el.remove(); }); }, 7000);
  }

  function localManagedPull(d) {
    d = d || {};
    var r = (d.resp && typeof d.resp === 'object') ? d.resp : d;
    var id = String(d.id || d.requestId || r.id || r.requestId || '');
    if (/^mlssi-[a-z0-9]+-[a-z0-9]+$/i.test(id)) return true;
    if (d.managed === true || d.background === true || d.silent === true ||
        r.managed === true || r.background === true || r.silent === true) return true;
    var owner = String(d.initiator || d.origin || d.mode || r.initiator || r.origin || r.mode || '').toLowerCase();
    return /^(?:background|batch|prefetch|automatic|auto)$/.test(owner);
  }

  function isManagedPull(d, doctor) {
    if (doctor && isFn(doctor.isManagedPullResult)) return !!safe(function () { return doctor.isManagedPullResult(d); });
    return localManagedPull(d);
  }

  function pullNoticeHandled(d) {
    try { return !!(d && d.__mlsAthenaPullNoticeHandled); } catch (e) { return false; }
  }

  function markPullNoticeHandled(d) {
    try { d.__mlsAthenaPullNoticeHandled = 'clarity'; } catch (e) {}
  }

  function clearTaggedPullFailures() {
    safe(function () {
      var nodes = document.querySelectorAll('[data-mls-athena-pull-failure="1"]');
      for (var i = 0; i < nodes.length; i++) if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    });
  }

  // Listen for the real extension result and report it clearly, by patient.
  function onMessage(ev) {
    safe(function () {
      var d = ev && ev.data;
      if (!d || d.source !== 'mls-ext' || !/Result$/.test(String(d.type || ''))) return;
      if (!pendingPull) return;                       // only report a per-patient pull we initiated
      if (Date.now() - pendingPull.at > 45000) { pendingPull = null; return; }
      var D = window.__mlsAthenaDoctor;
      var resultKind = (D && isFn(D.kindOf)) ? safe(function () { return D.kindOf(d.type); }) : (/AllVisits|Visits/i.test(String(d.type || '')) ? 'pull' : '');
      if (resultKind !== 'pull' || isManagedPull(d, D)) return;
      var meta = (D && isFn(D.resultMeta)) ? safe(function () { return D.resultMeta(d.resp || d); }) : null;
      var name = pendingPull.name || 'this patient';
      pendingPull = null;
      if (!meta) return;
      if (meta.ok && typeof meta.count === 'number' && meta.count > 0) {
        if (!(D && D.ownsPullNotices === true)) clearTaggedPullFailures();
        toast('✓ Pulled ' + meta.count + ' real visit' + (meta.count === 1 ? '' : 's') + ' into ' + name + ' — saved in MLS.', 'ok');
      } else if (meta.ok && (meta.count === 0 || meta.count == null)) {
        if (!(D && D.ownsPullNotices === true)) clearTaggedPullFailures();
        toast('ℹ Athena returned no past visits for ' + name + ' — nothing was added.', 'warn');
      } else {
        /* Athena Doctor is the one actionable manual-failure owner. It runs in
           capture phase and marks this exact result; Clarity remains a fallback
           only when Doctor is genuinely unavailable. */
        if (pullNoticeHandled(d) || (D && D.ownsPullNotices === true)) return;
        markPullNoticeHandled(d);
        toast('⚠ Couldn’t pull from Athena for ' + name + '. Open the patient’s chart in a signed-in athenaOne tab, then try again.', 'warn', { pullFailure: true });
      }
    });
  }

  function scan(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.nodeType === 1 && safe(function () { return scope.matches('button, a.btn, [role="button"]'); })) decorateOne(scope);
    var btns = scope.querySelectorAll('button, a.btn, [role="button"]');
    var n = 0;
    for (var i = 0; i < btns.length; i++) { if (decorateOne(btns[i])) n++; }
    return n;
  }

  var deb = null, pendingRoots = [];
  function queueRoot(node) {
    if (!node) return;
    if (node.nodeType === 3) node = node.parentNode;
    if (!node || node.nodeType !== 1) return;
    /* Decorating a button adds our own label/chip children. Ignore those
       mutations so this observer cannot schedule itself again. */
    if (safe(function () { return !!node.closest('button[' + ATTR + ']'); })) return;
    var relevant = safe(function () {
      return node.matches('button, a.btn, [role="button"]') || !!node.querySelector('button, a.btn, [role="button"]');
    });
    if (relevant && pendingRoots.indexOf(node) < 0) pendingRoots.push(node);
  }
  function onMutate(records) {
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes || [];
      for (var j = 0; j < added.length; j++) queueRoot(added[j]);
    }
    if (!pendingRoots.length || deb) return;
    deb = setTimeout(function () {
      deb = null;
      var roots = pendingRoots.slice(); pendingRoots.length = 0;
      for (var i = 0; i < roots.length; i++) safe(function (root) { return function () { scan(root); }; }(roots[i]));
    }, 80);
  }

  function mount() {
    ensureStyle();
    scan(document);
    observer = new MutationObserver(onMutate);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('message', onMessage, false);
    listeners.push(['message', onMessage]);
  }

  function revert() {
    safe(function () { if (observer) observer.disconnect(); });
    observer = null;
    if (deb) { clearTimeout(deb); deb = null; }
    pendingRoots.length = 0;
    listeners.forEach(function (l) { safe(function () { window.removeEventListener(l[0], l[1], false); }); });
    listeners = [];
    safe(function () {
      var decorated = document.querySelectorAll('button[' + ATTR + ']');
      for (var i = 0; i < decorated.length; i++) {
        var b = decorated[i];
        b.removeAttribute(ATTR);
        b.removeEventListener('click', onPullClick, true);
        var kids = b.querySelectorAll('.' + SUB_CLS + ',.' + TAG_CLS);
        for (var j = 0; j < kids.length; j++) kids[j].remove();
        // remove the <br> we added before the chip (trailing <br> children)
        var brs = b.querySelectorAll('br');
        for (var k = brs.length - 1; k >= 0; k--) { if (!brs[k].nextSibling) brs[k].remove(); }
      }
    });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s) s.remove(); });
    safe(function () { var t = document.querySelectorAll('.mlsac-toast'); for (var i = 0; i < t.length; i++) t[i].remove(); });
    window.__mlsAthenaClarity.installed = false;
  }

  var api = {
    installed: true,
    version: VERSION,
    asset: 'feat_athena_clarity.js',
    CATALOG: CATALOG,
    matchEntry: matchEntry,
    decorateOne: decorateOne,
    scan: scan,
    currentPatientName: currentPatientName,
    _onMessage: onMessage,
    _setPendingPull: function (name) { pendingPull = { name: name, at: Date.now() }; },
    revert: revert
  };
  window.__mlsAthenaClarity = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { safe(mount); }, { once: true });
  } else {
    safe(mount);
  }
})();
