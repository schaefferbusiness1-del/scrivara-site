/* ============================================================================
 * feat_mls_fixpack_0701.js  ->  window.__mlsFixpack   (v1.0.2)   [item79]
 *
 * PROD FIX-PACK (July 1, 2026) - nine additive, independently-guarded fixes
 * to things Michael is actively hitting on live. Each sub-fix is wrapped in
 * try/catch and degrades to a no-op. Nothing here deletes or mutates patient
 * data; all wraps keep the original functions and restore them on revert.
 *
 *  F1  Pull progress panel: the "Pull today's patients" hero box now shows a
 *      live step-by-step progress card (mirrors every honest status message,
 *      spinner while the pull is in flight). No fabricated statuses - it only
 *      mirrors what the real pull reports.
 *  F1b Any-day pull clarity: the import already files each appt on its own
 *      day; when the pulled day is NOT today the status now says so plainly
 *      and offers a one-click "View that day in Calendar" button. Button
 *      title updated to say pulls work for the day open in Athena (today,
 *      tomorrow, any day).
 *  F2  Op-prep procedure autodetect: kills the "No procedure entered yet -
 *      type it below" placeholder. If the patient's Athena appointment
 *      carries a procedure-ish reason it is auto-filled into the row input
 *      (marked "from Athena schedule"); otherwise a friendlier prompt shows.
 *  F3  Note model upgrade: note generation now requests gpt-5o first, with
 *      an honest automatic fallback cascade (gpt-5o -> gpt-5 -> gpt-5-mini ->
 *      gpt-4o) if the backend/OpenAI rejects the model id. The working model
 *      is remembered. Settings dropdown gains the 5-series options.
 *  F4  Today-button blink cap: any infinitely-blinking "Today" control is
 *      capped to 3 pulses (then a calm static highlight when the app is
 *      viewing a non-today day). No more permanent blinking.
 *  F5  Agenda chip = primary: the "Today's agenda" chip (item77) is styled
 *      as the primary button and always shows its full name.
 *  F6  Day/Week honest fallback: if the Calendar day/week panel renders zero
 *      appointments while the app actually HAS appointments for that date
 *      (they are provider-untagged until the backend fix), a clearly-labeled
 *      "All providers" list is shown instead of a blank panel.
 *  F7  Find-anything Pro: quick-find now searches screens/menu items,
 *      quick actions, TEMPLATES and patients, with ranking + keyboard nav,
 *      and rebuilds its index on every open (fixes breaks-after-one-use).
 *  F8  Formatted note preview: the good-looking op-note/SOAP formatting is
 *      now visible IN the app (live formatted preview attached to the main
 *      note box), not only in the PDF. Textarea stays the source of truth.
 *  F9  Fill-in-the-blanks restore: op-note drafts queue a fill-in-the-blank
 *      walker for anything not dictated (solution amounts, doses, levels).
 *      The AI op-note path is instructed to emit [FILL: ...] tokens instead
 *      of inventing specifics; the walker replaces them one at a time.
 *
 * GUARDRAILS: additive and reversible; never auto-saves, never auto-signs,
 * never touches athenaOne, never deletes records, never fabricates status.
 * Revert everything: window.__mlsFixpack.revert()
 * ==========================================================================*/
;(function () {
  'use strict';
  try { if (window.__mlsFixpack && window.__mlsFixpack.installed) return; } catch (e) { return; }

  var FP = {
    installed: true,
    v: '1.0.2',
    fixes: {},
    _obs: [],
    _ivs: [],
    _tos: [],
    _listeners: [],
    _refreshers: [],
    _orig: {},
    _nodes: []
  };
  window.__mlsFixpack = FP;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function dayLabel(iso) {
    try { return new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); }
    catch (e) { return iso; }
  }
  function apptDate(a) {
    if (!a) return '';
    if (a.appt_date) return String(a.appt_date).slice(0, 10);
    try { if (a.start_at) { var d = new Date(a.start_at); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); } } catch (e) {}
    return '';
  }
  function normName(n) { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function safeToast(m, k) { try { if (typeof toast === 'function') toast(m, k || ''); } catch (e) {} }
  function remember(node) { if (node) FP._nodes.push(node); return node; }
  function later(fn, delay) {
    var id = setTimeout(function () {
      var at = FP._tos.indexOf(id);
      if (at >= 0) FP._tos.splice(at, 1);
      if (!FP.installed) return;
      try { fn(); } catch (e) {}
    }, delay);
    FP._tos.push(id);
    return id;
  }
  function listen(target, name, fn, options) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(name, fn, options);
    FP._listeners.push({ target: target, name: name, fn: fn, options: options });
  }
  function registerRefresh(fn) { if (typeof fn === 'function') FP._refreshers.push(fn); }

  /* One filtered refresh bus replaces several permanent UI/layout polls below.
     It is installed after all nine fixes register their refresh callbacks. */
  var refreshTimer = null, refreshRoots = [], refreshReasons = {};
  function queueRefresh(root, reason, delay) {
    if (!FP.installed) return;
    root = root && (root.nodeType === 1 || root.nodeType === 9) ? root : document;
    if (root === document) {
      refreshRoots = [document];
    } else if (refreshRoots.indexOf(document) < 0 && refreshRoots.indexOf(root) < 0) {
      if (refreshRoots.length < 12) refreshRoots.push(root);
      else refreshRoots = [document];
    }
    refreshReasons[reason || 'event'] = 1;
    if (refreshTimer) return;
    refreshTimer = later(function () {
      refreshTimer = null;
      var roots = refreshRoots.slice(), why = Object.keys(refreshReasons).join(',');
      refreshRoots = []; refreshReasons = {};
      if (!roots.length) roots = [document];
      for (var r = 0; r < roots.length; r++) {
        for (var i = 0; i < FP._refreshers.length; i++) {
          try { FP._refreshers[i](roots[r], why); } catch (e) {}
        }
      }
    }, delay == null ? 100 : delay);
  }
  var refreshBurstSeq = {};
  function refreshBurst(reason, delays) {
    reason = reason || 'fallback';
    delays = delays || [];
    var token = (refreshBurstSeq[reason] || 0) + 1;
    refreshBurstSeq[reason] = token;
    delays.forEach(function (ms) {
      later(function () { if (refreshBurstSeq[reason] === token) queueRefresh(document, reason, 0); }, ms);
    });
  }
  /* Invalidate every pending timer of a burst (bumping the token makes them
     no-ops). Lets a completed/failed generation stop its own refresh tail
     instead of hammering the document for the full burst window. */
  function cancelBurst(reason) { refreshBurstSeq[reason] = (refreshBurstSeq[reason] || 0) + 1; }
  FP.cancelBurst = cancelBurst;
  function addStyle(id, css) {
    if ($(id)) return;
    var st = document.createElement('style'); st.id = id; st.textContent = css;
    document.head.appendChild(st); remember(st);
  }

  /* ------------------------------------------------------------------ F1/F1b
   * PULL PROGRESS PANEL + ANY-DAY CLARITY
   * ------------------------------------------------------------------ */
  try {
    addStyle('mlsFpStyle',
      '#mlsFpPullCard{display:none;margin-top:8px;background:rgba(8,25,50,.55);border:1px solid rgba(255,255,255,.35);border-radius:11px;padding:9px 11px;color:#fff;max-width:560px}' +
      '#mlsFpPullCard .fp-head{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:800;letter-spacing:.3px}' +
      '#mlsFpPullCard .fp-spin{width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:mlsfpspin .8s linear infinite;display:none}' +
      '#mlsFpPullCard.fp-active .fp-spin{display:inline-block}' +
      '@keyframes mlsfpspin{to{transform:rotate(360deg)}}' +
      '#mlsFpPullLog{margin-top:6px;max-height:132px;overflow:auto;font-size:12px;line-height:1.45}' +
      '#mlsFpPullLog .fp-ln{padding:1.5px 0;border-bottom:1px dashed rgba(255,255,255,.12)}' +
      '#mlsFpPullLog .fp-ln.err{color:#ffd9d9}' +
      '#mlsFpPullLog .fp-ln .fp-t{opacity:.6;font-size:10.5px;margin-right:6px}' +
      '#mlsFpDayBtn{margin-top:7px;display:none;background:#fff;color:#204034;border:0;border-radius:9px;padding:7px 12px;font-size:12.5px;font-weight:800;cursor:pointer}');

    function ensureCard() {
      var st = $('heroPullStatus');
      if (!st || $('mlsFpPullCard')) return $('mlsFpPullCard');
      var card = document.createElement('div');
      card.id = 'mlsFpPullCard';
      card.innerHTML =
        '<div class="fp-head"><span class="fp-spin"></span><span id="mlsFpPullTitle">Pull progress</span></div>' +
        '<div id="mlsFpPullLog"></div>' +
        '<button id="mlsFpDayBtn" type="button">View that day in Calendar</button>';
      st.insertAdjacentElement('afterend', card);
      remember(card);
      return card;
    }
    function logLine(txt, isErr) {
      var card = ensureCard(); if (!card) return;
      card.style.display = 'block';
      var log = $('mlsFpPullLog'); if (!log) return;
      var last = log.lastElementChild;
      if (last && last.getAttribute('data-m') === txt) return; /* de-dupe repeats */
      var d = document.createElement('div');
      d.className = 'fp-ln' + (isErr ? ' err' : '');
      d.setAttribute('data-m', txt);
      var t = new Date();
      d.innerHTML = '<span class="fp-t">' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2) + '</span>' + esc(txt);
      log.appendChild(d);
      while (log.children.length > 40) log.removeChild(log.firstChild);
      log.scrollTop = log.scrollHeight;
      var fin = /✅|already on your calendar|No new appointments found|isn’t responding|isn't responding|Couldn’t|Couldn't|try again|OLDER version/i.test(txt);
      if (fin) { setTimeout(function () { card.classList.remove('fp-active'); }, 900); }
      else { card.classList.add('fp-active'); }
    }
    function watchStatus() {
      var st = $('heroPullStatus'); if (!st || st.__fpWatched) return;
      st.__fpWatched = true;
      var mo = new MutationObserver(function () {
        var txt = String(st.textContent || '').trim(); if (!txt) return;
        var isErr = /ffe0e0/i.test(st.style.color || '') || /rgb\(255,\s*224/.test(st.style.color || '');
        logLine(txt, isErr);
      });
      mo.observe(st, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
      FP._obs.push(mo);
    }
    watchStatus();
    registerRefresh(function (root) {
      var relevant = root === document;
      try { if (!relevant && root) relevant = root.id === 'heroPullStatus' || !!(root.closest && root.closest('#heroPullStatus')) || !!(root.querySelector && root.querySelector('#heroPullStatus')); } catch (e) {}
      if (relevant) watchStatus();
    });

    /* wrap pullScheduleViaAssist: mark active + clearer button title */
    if (typeof window.pullScheduleViaAssist === 'function' && !window.pullScheduleViaAssist.__fpWrap) {
      FP._orig.pull = window.pullScheduleViaAssist;
      var wrappedPull = function (btn) {
        try { var c = ensureCard(); if (c) { c.classList.add('fp-active'); c.style.display = 'block'; } } catch (e) {}
        try { logLine('Pull started - reading the day currently open in your Athena tab (works for today, tomorrow, any day).'); } catch (e) {}
        return FP._orig.pull.apply(this, arguments);
      };
      wrappedPull.__fpWrap = true;
      window.pullScheduleViaAssist = wrappedPull;
    }
    /* clearer hero button tooltip + label (any-day) */
    try {
      var pb = document.querySelector('button[onclick^="pullScheduleViaAssist"]');
      if (pb) {
        pb.title = 'Pulls the patients for whichever DAY is open in your Athena tab (today, tomorrow, any day) AND auto-pulls each patient’s chart history. Live progress shows below.';
        if (/Pull today/i.test(pb.textContent || '')) {
          pb.innerHTML = pb.innerHTML.replace(/Pull today’s patients|Pull today's patients/, 'Pull this day’s patients');
        }
      }
    } catch (e) {}

    /* wrap _importPulledSchedule for non-today day summary + jump button */
    if (typeof window._importPulledSchedule === 'function' && !window._importPulledSchedule.__fpWrap) {
      FP._orig.importSched = window._importPulledSchedule;
      var wrappedImport = function (appts) {
        var self = this, args = arguments;
        var tally = {};
        try {
          (appts || []).forEach(function (a) {
            if (!a || !String(a.name || '').trim()) return;
            var d = '';
            try { d = (typeof _normDate === 'function' ? _normDate(a.date) : '') || ''; } catch (e) {}
            if (!d) { try { d = (typeof _detectSchedDate === 'function' ? _detectSchedDate(window.__schedRaw && window.__schedRaw.text) : '') || ''; } catch (e) {} }
            if (!d) d = todayISO();
            tally[d] = (tally[d] || 0) + 1;
          });
        } catch (e) {}
        var p = FP._orig.importSched.apply(self, args);
        var after = function () {
          try {
            var days = Object.keys(tally); if (!days.length) return;
            var dom = days.reduce(function (m, k) { return tally[k] > (tally[m] || 0) ? k : m; }, days[0]);
            if (dom && dom !== todayISO()) {
              logLine('📅 These patients were filed on ' + dayLabel(dom) + ' (not today) - that’s the day your Athena tab was showing.');
              var b = $('mlsFpDayBtn');
              if (b) {
                b.style.display = 'inline-block';
                b.textContent = 'View ' + dayLabel(dom) + ' in Calendar';
                b.onclick = function () {
                  try { if (typeof showView === 'function') showView('calendar'); } catch (e) {}
                  try { if (typeof calOpenDay === 'function') calOpenDay(dom); } catch (e) {}
                };
              }
            } else {
              var b2 = $('mlsFpDayBtn'); if (b2) b2.style.display = 'none';
            }
          } catch (e) {}
        };
        try { if (p && typeof p.then === 'function') { p.then(after, function () {}); } else { setTimeout(after, 400); } } catch (e) {}
        return p;
      };
      wrappedImport.__fpWrap = true;
      window._importPulledSchedule = wrappedImport;
    }
    /* history-pull banner (its per-chart statuses already stream via onStatus) */
    if (typeof window._pullAllHistories === 'function' && !window._pullAllHistories.__fpWrap) {
      FP._orig.pullHist = window._pullAllHistories;
      var wrappedHist = function (appts) {
        try { logLine('Now pulling each patient’s chart history (' + ((appts || []).length) + ' patients) — you can keep working while this runs.'); } catch (e) {}
        var p = FP._orig.pullHist.apply(this, arguments);
        try { if (p && typeof p.then === 'function') p.then(function () { logLine('✅ Chart histories pulled.'); }, function () {}); } catch (e) {}
        return p;
      };
      wrappedHist.__fpWrap = true;
      window._pullAllHistories = wrappedHist;
    }
    FP.fixes.pullProgress = true;
  } catch (e) { FP.fixes.pullProgress = 'error: ' + e.message; }

  /* ------------------------------------------------------------------ F2
   * OP-PREP PROCEDURE AUTODETECT (kills "No procedure entered yet")
   * ------------------------------------------------------------------ */
  try {
    var GENERIC_REASONS = /^(office visit|follow ?up|f\/?u|new patient|np|est(ablished)? patient|consult(ation)?|visit|appt|appointment|recheck|check ?up)$/i;
    function reasonLooksProcedural(r) {
      r = String(r || '').trim();
      if (r.length < 3) return false;
      if (GENERIC_REASONS.test(r)) return false;
      return true;
    }
    function findReasonFor(name, wantDate) {
      var nm = normName(name); if (!nm) return '';
      var best = '';
      try {
        var ap = (window._calAppts || []).filter(function (a) { return normName(a.name || (typeof _calLabelOf === 'function' ? _calLabelOf(a) : '')) === nm && String(a.reason || '').trim(); });
        if (ap.length) {
          var exact = wantDate ? ap.filter(function (a) { return apptDate(a) === wantDate; }) : [];
          var pick = (exact[0] || ap.sort(function (p, q) { return String(q.appt_date || q.start_at || '').localeCompare(String(p.appt_date || p.start_at || '')); })[0]);
          if (pick && reasonLooksProcedural(pick.reason)) best = String(pick.reason).trim();
        }
      } catch (e) {}
      if (!best) {
        try {
          var pts = (typeof getPatients === 'function' ? getPatients() : []) || [];
          var hit = pts.find(function (x) { return normName(x.name) === nm && String(x.reason || '').trim(); });
          if (hit && reasonLooksProcedural(hit.reason)) best = String(hit.reason).trim();
        } catch (e) {}
      }
      return best;
    }
    var PLACEHOLDER_RX = /No procedure entered yet — type it below|No procedure entered yet — type it below/g;
    if (typeof window._opPreviewHtml === 'function' && !window._opPreviewHtml.__fpWrap) {
      FP._orig.opPrev = window._opPreviewHtml;
      var wrappedPrev = function (proc, name, dateStr) {
        var p = String(proc || '').trim();
        if (!p) {
          var det = '';
          try { det = findReasonFor(name, ''); } catch (e) {}
          if (det) {
            var out = FP._orig.opPrev.call(this, det, name, dateStr);
            return out + '<div style="font-size:11px;margin-top:3px;opacity:.85;color:#2E6A4B;font-weight:700">⚡ Procedure auto-detected from the Athena schedule — edit below if wrong.</div>';
          }
          var out2 = FP._orig.opPrev.apply(this, arguments);
          return String(out2).replace(PLACEHOLDER_RX, 'Type the procedure below — MLS fills this in automatically once the Athena pull knows it');
        }
        return FP._orig.opPrev.apply(this, arguments);
      };
      wrappedPrev.__fpWrap = true;
      window._opPreviewHtml = wrappedPrev;
    }
    /* prefill empty row inputs after the op-prep list renders */
    function prefillOpPrepRows() {
      try {
        var list = $('opPrepList'); if (!list) return;
        var inputs = list.querySelectorAll('input[onchange*="opProcChanged"], textarea[onchange*="opProcChanged"]');
        Array.prototype.forEach.call(inputs, function (inp) {
          if (String(inp.value || '').trim()) return;
          var row = inp.closest('div');
          var scope = row; var name = '';
          for (var hop = 0; hop < 4 && scope; hop++) {
            var m = String(scope.textContent || '').match(/🧑\s*([^·\n]+)/); /* person emoji then name */
            if (m) { name = m[1].trim(); break; }
            scope = scope.parentElement;
          }
          if (!name) return;
          var det = findReasonFor(name, String(window._opPrepDay || ''));
          if (!det) return;
          inp.value = det;
          try { inp.dispatchEvent(new Event('change', { bubbles: true })) } catch (e) {}
          try {
            var mIdx = String(inp.getAttribute('onchange') || '').match(/opProcChanged\((\d+)/);
            if (mIdx && typeof window.opProcChanged === 'function') window.opProcChanged(+mIdx[1], det);
          } catch (e) {}
        });
      } catch (e) {}
    }
    ['openOpPrep', 'openOpPrepForPatient', 'opPrepSetMode'].forEach(function (fn) {
      if (typeof window[fn] === 'function' && !window[fn].__fpWrap) {
        FP._orig['op_' + fn] = window[fn];
        var w = function () {
          var r = FP._orig['op_' + fn].apply(this, arguments);
          setTimeout(prefillOpPrepRows, 300);
          setTimeout(prefillOpPrepRows, 900);
          return r;
        };
        w.__fpWrap = true;
        window[fn] = w;
      }
    });
    FP.fixes.opPrepAuto = true;
  } catch (e) { FP.fixes.opPrepAuto = 'error: ' + e.message; }

  /* ------------------------------------------------------------------ F3
   * NOTE MODEL -> 5-SERIES WITH HONEST FALLBACK CASCADE
   * ------------------------------------------------------------------ */
  try {
    var MODELS = ['gpt-5o', 'gpt-5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini'];
    function modelKey() { try { return (typeof uns === 'function') ? uns('noteModel') : 'noteModel'; } catch (e) { return 'noteModel'; } }
    /* one-time migration: stored legacy 4-series defaults move to gpt-5o (Michael's ask);
       runs once, so a deliberate later choice in Settings is respected forever after. */
    try {
      var MIG = 'mlsFpModelMig1';
      if (!localStorage.getItem(MIG)) {
        var curM = localStorage.getItem(modelKey());
        if (!curM || curM === 'gpt-4o' || curM === 'gpt-4o-mini') localStorage.setItem(modelKey(), 'gpt-5o');
        localStorage.setItem(MIG, '1');
      }
    } catch (e) {}
    if (typeof window.getNoteModel === 'function' && !window.getNoteModel.__fpWrap) {
      FP._orig.getNoteModel = window.getNoteModel;
      var gnm = function () {
        try { var v = localStorage.getItem(modelKey()); if (MODELS.indexOf(v) >= 0) return v; } catch (e) {}
        return 'gpt-5o';
      };
      gnm.__fpWrap = true;
      window.getNoteModel = gnm;
    }
    /* extend the Settings dropdown when it appears */
    function extendModelSel() {
      var sel = $('noteModelSel'); if (!sel || sel.__fpExtended) return;
      sel.__fpExtended = true;
      var have = {};
      Array.prototype.forEach.call(sel.options, function (o) { have[o.value] = 1; });
      [['gpt-5o', 'Best — GPT-5o (newest, recommended)'], ['gpt-5', 'GPT-5 — full power'], ['gpt-5-mini', 'GPT-5 mini — fast + smart']].reverse().forEach(function (pair) {
        if (have[pair[0]]) return;
        var o = document.createElement('option'); o.value = pair[0]; o.textContent = pair[1];
        sel.insertBefore(o, sel.firstChild);
      });
      try { sel.value = window.getNoteModel(); } catch (e) {}
    }
    extendModelSel();
    registerRefresh(function (root, reason) {
      var relevant = root === document && /settings|boot|ui-ready/.test(reason || '');
      try { if (!relevant && root) relevant = root.id === 'noteModelSel' || !!(root.closest && root.closest('#noteModelSel')) || !!(root.querySelector && root.querySelector('#noteModelSel')); } catch (e) {}
      if (relevant) extendModelSel();
    });

    /* fetch cascade on /api/generate model rejections */
    if (!window.fetch.__fpWrap) {
      FP._orig.fetch = window.fetch;
      var fpFetch = function (input, init) {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var isGen = /\/api\/generate(\?|$)/.test(url);
        var bodyStr = init && typeof init.body === 'string' ? init.body : '';
        if (!isGen || !bodyStr || bodyStr.indexOf('"model"') < 0) {
          return FP._orig.fetch.apply(this, arguments);
        }
        var attempt = function (bStr, triedIdx) {
          var init2 = {}; for (var k in init) init2[k] = init[k];
          init2.body = bStr;
          return FP._orig.fetch.call(window, input, init2).then(function (res) {
            if (res.ok) {
              try {
                var mm = bStr.match(/"model"\s*:\s*"([^"]+)"/);
                if (mm && MODELS.indexOf(mm[1]) >= 0) localStorage.setItem(modelKey(), mm[1]);
              } catch (e) {}
              return res;
            }
            if ([400, 404, 422, 500, 502].indexOf(res.status) < 0) return res;
            return res.clone().text().then(function (t) {
              if (!/model|invalid|unsupported|does not exist|not found|unknown/i.test(t || '')) return res;
              var m = bStr.match(/"model"\s*:\s*"([^"]+)"/);
              var cur = m ? m[1] : '';
              var idx = MODELS.indexOf(cur);
              var next = (idx >= 0 && idx < MODELS.length - 1) ? MODELS[idx + 1] : '';
              if (!next || triedIdx > 2) return res;
              safeToast('⚠ Model ' + cur + ' was rejected — retrying with ' + next + '.', '');
              var b2 = bStr.replace(/"model"\s*:\s*"[^"]+"/, '"model":"' + next + '"');
              return attempt(b2, triedIdx + 1);
            }).catch(function () { return res; });
          });
        };
        return attempt(bodyStr, 0);
      };
      fpFetch.__fpWrap = true;
      window.fetch = fpFetch;
    }
    FP.fixes.model5 = true;
  } catch (e) { FP.fixes.model5 = 'error: ' + e.message; }

  /* ------------------------------------------------------------------ F4
   * TODAY-BUTTON BLINK CAP
   * ------------------------------------------------------------------ */
  try {
    addStyle('mlsFpTodayStyle', '.mls-fp-offtoday{outline:2px solid #f5b942 !important;outline-offset:1px;border-radius:9px}');
    function blinkRootRelevant(root) {
      if (!root || root === document) return true;
      try {
        if (root.id === 'calendarView' || root.id === 'mlsAgendaChip') return true;
        if (root.closest && root.closest('#calendarView,#mlsAgendaChip')) return true;
        if (root.matches && root.matches('[data-scope="today"],.mlspk-tab')) return true;
        if (/today/i.test(String(root.id || '') + ' ' + String(root.className || ''))) return true;
        return !!(root.querySelector && root.querySelector('[data-scope="today"],.mlspk-tab,#mlsAgendaChip'));
      } catch (e) { return false; }
    }
    function capBlink(root) {
      try {
        var offToday = false;
        try { offToday = !!(window._calRefDate && window._calRefDate !== todayISO()); } catch (e) {}
        var base = root && root !== document ? root : document;
        var cands = [];
        if (base.nodeType === 1) cands.push(base);
        if (base.querySelectorAll) {
          var found = base.querySelectorAll('[data-scope="today"],[id*="oday"],[class*="oday"],button,.mlspk-tab');
          for (var q = 0; q < found.length && cands.length < 250; q++) cands.push(found[q]);
        }
        for (var i = 0; i < cands.length && i < 250; i++) {
          var el = cands[i];
          var txt = String(el.textContent || '');
          if (!/today/i.test(txt) && !/today/i.test(el.id || '') && !/today/i.test(el.className || '')) continue;
          var cs;
          try { cs = getComputedStyle(el); } catch (e) { continue; }
          if (cs && cs.animationName && cs.animationName !== 'none' && /infinite/i.test(cs.animationIterationCount || '')) {
            el.style.animationIterationCount = '3'; /* pulse 3x then stop - never blink forever */
            el.__fpBlinkCapped = true;
          }
          if (el.classList && (el.__fpBlinkCapped || el.classList.contains('mls-fp-offtoday'))) {
            if (offToday) el.classList.add('mls-fp-offtoday'); else el.classList.remove('mls-fp-offtoday');
          }
        }
      } catch (e) {}
    }
    registerRefresh(function (root, reason) {
      if (/input|change/.test(reason || '') && root && root.tagName === 'TEXTAREA') return;
      if (root === document && !/boot|navigation|calendar|schedule|view|ui-ready/.test(reason || '')) return;
      if (blinkRootRelevant(root)) capBlink(root);
    });
    FP.fixes.blinkCap = true;
  } catch (e) { FP.fixes.blinkCap = 'error: ' + e.message; }

  /* ------------------------------------------------------------------ F5
   * AGENDA CHIP = PRIMARY + FULL NAME
   * ------------------------------------------------------------------ */
  try {
    function upgradeAgendaChip() {
      var chip = $('mlsAgendaChip'); if (!chip) return;
      if (!chip.__fpStyled) {
        chip.__fpStyled = true;
        chip.style.background = 'linear-gradient(135deg,#204034,#2E6A4B)';
        chip.style.color = '#fff';
        chip.style.fontWeight = '800';
        chip.style.fontSize = '13.5px';
        chip.style.padding = '8px 15px';
        chip.style.borderRadius = '11px';
        chip.style.boxShadow = '0 3px 10px rgba(20,60,120,.3)';
        chip.style.border = '0';
        chip.style.cursor = 'pointer';
        try { chip.style.order = '-1'; } catch (e) {}
        chip.title = 'Today’s agenda — the full ordered schedule (seen / up now / upcoming). Click a row to load that patient.';
      }
      /* always show the full name */
      if (chip.__fpRelabeling) return;
      var t = String(chip.textContent || '');
      if (t && !/Today’s agenda|Today's agenda/i.test(t)) {
        chip.__fpRelabeling = true;
        try { chip.innerHTML = String(chip.innerHTML).replace(/Agenda/, 'Today’s agenda'); } catch (e) {}
        chip.__fpRelabeling = false;
      }
    }
    upgradeAgendaChip();
    registerRefresh(function () { upgradeAgendaChip(); });
    FP.fixes.agendaPrimary = true;
  } catch (e) { FP.fixes.agendaPrimary = 'error: ' + e.message; }

  /* ------------------------------------------------------------------ F6
   * DAY/WEEK HONEST FALLBACK LIST
   * ------------------------------------------------------------------ */
  try {
    function apptTimeLbl(a) {
      try { if (a.start_at) { var d = new Date(a.start_at); var h = d.getHours(), mi = ('0' + d.getMinutes()).slice(-2); var ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + mi + ' ' + ap; } } catch (e) {}
      return '';
    }
    var fallbackSig = '';
    function ensureDayFallback() {
      try {
        var calView = $('calendarView');
        if (!calView || calView.style.display === 'none') { removeFb(); return; }
        var date = String(window._calRefDate || '');
        if (!date) { removeFb(); return; }
        var appts = (window._calAppts || []).filter(function (a) { return apptDate(a) === date; });
        var old = $('mlsFpDayFallback');
        if (!appts.length) { removeFb(); return; }
        /* does the visible panel already show any of these patient names? */
        var panel = $('calDayPanel') && $('calDayPanel').style.display !== 'none' ? $('calDayPanel') : calView;
        var shown = 0;
        var ptxt = String(panel.textContent || '').toLowerCase();
        /* Never count this fallback's own rows as evidence that the real
           calendar rendered them; that caused a remove/recreate ping-pong. */
        if (old) ptxt = ptxt.replace(String(old.textContent || '').toLowerCase(), '');
        appts.forEach(function (a) {
          var nm = normName(a.name || '');
          if (nm && ptxt.indexOf(nm.split(' ')[0]) >= 0 && ptxt.indexOf(nm.split(' ').slice(-1)[0]) >= 0) shown++;
        });
        if (shown > 0) { removeFb(); return; } /* panel is rendering them - stay out of the way */
        var rows = appts.slice().sort(function (p, q) { return String(p.start_at || '').localeCompare(String(q.start_at || '')); }).map(function (a) {
          return '<div style="display:flex;gap:9px;align-items:center;background:linear-gradient(135deg,#204034,#2E6A4B);color:#fff;border-radius:9px;padding:8px 12px;margin:5px 0;font-size:13px;font-weight:700">' +
            '<span style="opacity:.85;min-width:64px">' + esc(apptTimeLbl(a) || '—') + '</span><span>' + esc(a.name || (typeof _calLabelOf === 'function' ? _calLabelOf(a) : 'Patient')) + '</span>' +
            (a.reason ? '<span style="opacity:.75;font-weight:600;font-size:12px;margin-left:auto">' + esc(String(a.reason).slice(0, 40)) + '</span>' : '') + '</div>';
        }).join('');
        var box = old;
        if (!box) {
          box = document.createElement('div');
          box.id = 'mlsFpDayFallback';
          box.style.cssText = 'margin:10px 0;padding:11px 13px;border:1px solid var(--line,#E4E1D8);border-radius:12px;background:var(--card,#fff)';
          panel.insertAdjacentElement('afterbegin', box);
          remember(box);
        }
        var html = '<div style="font-size:12.5px;font-weight:800;margin-bottom:2px">' + esc(dayLabel(date)) + ' — ' + appts.length + ' appointment' + (appts.length === 1 ? '' : 's') + ' (all providers)</div>' +
          '<div style="font-size:11.5px;opacity:.75;margin-bottom:4px">Shown as one list because these appointments aren’t tagged with a doctor yet — the Athena pull update will fix per-doctor filtering.</div>' + rows;
        var sig = date + '|' + html;
        if (fallbackSig !== sig || box.__fpFallbackSig !== sig) {
          fallbackSig = sig;
          box.__fpFallbackSig = sig;
          box.innerHTML = html;
        }
      } catch (e) {}
    }
    function removeFb() { var o = $('mlsFpDayFallback'); if (o && o.parentElement) o.parentElement.removeChild(o); fallbackSig = ''; }
    registerRefresh(function (root, reason) {
      if (root === document && /generation|note|input|change/.test(reason || '') && !/calendar|navigation|schedule/.test(reason || '')) return;
      if (root !== document) {
        var inCalendar = false;
        try { inCalendar = !!(root.closest && root.closest('#calendarView')) || !!(root.querySelector && root.querySelector('#calendarView')); } catch (e) {}
        if (!inCalendar && !/calendar|schedule|navigation|boot|action/.test(reason || '')) return;
      }
      ensureDayFallback();
    });
    FP.fixes.dayWeekFallback = true;
  } catch (e) { FP.fixes.dayWeekFallback = 'error: ' + e.message; }

  /* ------------------------------------------------------------------ F7
   * FIND-ANYTHING PRO (screens + menu + actions + TEMPLATES + patients)
   * ------------------------------------------------------------------ */
  try {
    addStyle('mlsFpQfStyle',
      '#mlsFpQf{position:fixed;inset:0;z-index:99999;background:rgba(15,25,40,.5);display:none;align-items:flex-start;justify-content:center;padding-top:11vh}' +
      '#mlsFpQf .qf-card{width:600px;max-width:93vw;background:var(--card,#fff);color:var(--ink,#15243a);border:1px solid var(--line,#E4E1D8);border-radius:16px;box-shadow:0 24px 70px rgba(15,25,40,.5);overflow:hidden}' +
      '#mlsFpQfInput{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--line,#E4E1D8);padding:15px 17px;font-size:16px;background:transparent;color:inherit;outline:none}' +
      '#mlsFpQfList{max-height:52vh;overflow:auto;padding:6px}' +
      '#mlsFpQfStatus{display:none;margin:0 12px 10px;padding:9px 11px;border:1px solid #E4C7C7;border-radius:9px;background:#FFF5F5;color:#7A2525;font-size:12.5px;font-weight:650}' +
      '#mlsFpQfList .qf-h{font-size:10.5px;font-weight:800;letter-spacing:.7px;opacity:.55;padding:8px 12px 3px;text-transform:uppercase}' +
      '#mlsFpQfList .qf-it{display:flex;gap:10px;align-items:center;padding:9px 12px;border-radius:10px;cursor:pointer;font-size:14px}' +
      '#mlsFpQfList .qf-it.sel,#mlsFpQfList .qf-it:hover{background:rgba(33,104,201,.12)}' +
      '#mlsFpQfList .qf-sub{opacity:.6;font-size:12px;margin-left:auto;white-space:nowrap}');
    var qfSel = 0, qfItems = [];
    function qfEl() { return $('mlsFpQf'); }
    function qfEnsure() {
      if (qfEl()) return;
      var ov = document.createElement('div');
      ov.id = 'mlsFpQf';
      ov.innerHTML = '<div class="qf-card"><input id="mlsFpQfInput" placeholder="Find anything — screens, menu items, templates, patients, actions…" autocomplete="off">' +
        '<div id="mlsFpQfList"></div><div id="mlsFpQfStatus" role="status" aria-live="polite"></div></div>';
      document.body.appendChild(ov); remember(ov);
      ov.addEventListener('click', function (e) { if (e.target === ov) qfClose(); });
      var inp = $('mlsFpQfInput');
      inp.addEventListener('input', function () { qfClearError(); qfRender(inp.value); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') qfClose();
        else if (e.key === 'ArrowDown') { e.preventDefault(); qfSel = Math.min(qfSel + 1, qfItems.length - 1); qfPaint(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); qfSel = Math.max(qfSel - 1, 0); qfPaint(); }
        else if (e.key === 'Enter') { e.preventDefault(); qfGo(qfSel); }
      });
    }
    function qfClose() { var o = qfEl(); if (o) o.style.display = 'none'; }
    function qfClearError() {
      var status = $('mlsFpQfStatus');
      if (!status) return;
      status.textContent = ''; status.style.display = 'none';
    }
    function qfFail(message) {
      var status = $('mlsFpQfStatus');
      if (status) { status.textContent = String(message || 'That result could not be opened safely.'); status.style.display = 'block'; }
      var input = $('mlsFpQfInput'); if (input) { try { input.focus(); } catch (e) {} }
      return false;
    }
    /* __MLS_QF_CANONICAL_START__ */
    function qfSessionContext() {
      var account = '';
      try { account = String(window.__mlsSessionAccount || (typeof window.getSessionEmail === 'function' ? window.getSessionEmail() : '') || '').trim().toLowerCase(); } catch (e) {}
      var epoch = null;
      try { if (typeof window.__mlsSessionEpoch === 'number' && isFinite(window.__mlsSessionEpoch)) epoch = Number(window.__mlsSessionEpoch); } catch (e2) {}
      return { account: account, epoch: epoch };
    }
    function qfSameSession(expected, live) {
      expected = expected || {}; live = live || {};
      if (String(expected.account || '') !== String(live.account || '')) return false;
      if (expected.epoch != null || live.epoch != null) return Number(expected.epoch) === Number(live.epoch);
      return true;
    }
    function qfPatientRoute(indexedPatient, expectedSession) {
      var id = String(indexedPatient && indexedPatient.id || '').trim();
      if (!id) return qfFail('This patient result has no stable chart ID. Nothing was changed; search for the exact chart from Patients.');
      if (!qfSameSession(expectedSession, qfSessionContext())) {
        return qfFail('The signed-in account changed. Nothing was selected; search again in the current account.');
      }
      var current = [];
      try {
        current = ((typeof window.getPatients === 'function' ? window.getPatients() : []) || []).filter(function (p) {
          return p && String(p.id || '').trim() === id;
        });
      } catch (e0) { current = []; }
      if (current.length !== 1) return qfFail('That chart is no longer uniquely available. Nothing was selected; search again.');
      if (typeof window.showView !== 'function' ||
          (typeof window.openPatient !== 'function' && typeof window.selectPatient !== 'function') ||
          typeof window.getActivePtId !== 'function' || typeof window.activePatient !== 'function') {
        return qfFail('The patient workspace is still loading. Nothing was selected; try again in a moment.');
      }
      var patient = current[0], opened = false;
      try {
        if (typeof window.openPatient === 'function') { window.openPatient(id); opened = true; }
        else if (typeof window.selectPatient === 'function') { window.selectPatient(id); opened = true; }
      } catch (e1) { opened = false; }
      var active = null, activeId = '';
      try { activeId = String(window.getActivePtId() || '').trim(); active = window.activePatient(); } catch (e2) {}
      if (!opened || activeId !== id || !active || String(active.id || '').trim() !== id) {
        return qfFail('MLS could not verify the selected chart. The Visit screen was not opened; choose the exact chart from Patients.');
      }
      try { window.showView('visit'); } catch (e3) {
        return qfFail('The Visit workspace could not open. The Find window stayed open so you can try again.');
      }
      try {
        var nameInput = $('heroPtName'), dobInput = $('heroPtDob');
        if (nameInput) nameInput.value = patient.name || '';
        if (dobInput) dobInput.value = patient.dob || '';
        if (typeof window._heroSyncName === 'function') window._heroSyncName();
        if (typeof window.renderPatientBar === 'function') window.renderPatientBar();
      } catch (e4) {}
      try {
        activeId = String(window.getActivePtId() || '').trim(); active = window.activePatient();
        if (activeId !== id || !active || String(active.id || '').trim() !== id ||
            (window.__mlsCurrentView && window.__mlsCurrentView !== 'visit')) {
          return qfFail('MLS could not verify the patient in the Visit workspace. Find stayed open; choose the exact chart from Patients.');
        }
      } catch (e5) { return qfFail('MLS could not verify the patient in the Visit workspace. Find stayed open; try again.'); }
      safeToast('Active patient: ' + (patient.name || 'selected chart'), 'ok');
      return true;
    }
    /* __MLS_QF_CANONICAL_END__ */
    function buildIndex() {
      var out = [];
      var patientSession = qfSessionContext();
      /* screens + menu items straight from the DOM (always current) */
      var seen = {};
      Array.prototype.forEach.call(document.querySelectorAll('[onclick*="showView("]'), function (el) {
        var lbl = String(el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!lbl || lbl.length > 40 || seen['v:' + lbl]) return;
        seen['v:' + lbl] = 1;
        out.push({ g: 'Screens & menu', label: lbl, sub: '', go: function () { try { el.click(); } catch (e) {} } });
      });
      /* Use the same canonical feature locations as Help. */
      try {
        (window.__mlsFeatureDirectory || []).forEach(function (feature) {
          if (!feature || !feature.name) return;
          out.push({
            g: 'Features',
            label: '✦ ' + String(feature.name),
            sub: String(feature.where || ''),
            search: String(feature.k || '') + ' ' + String(feature.how || ''),
            go: function () { try { if (typeof window.mlsOpenFeature === 'function') window.mlsOpenFeature(feature); } catch (e) {} }
          });
        });
      } catch (e) {}
      /* quick actions */
      var acts = [
        ['📥 Pull this day’s patients from Athena', function () { var b = document.querySelector('button[onclick^="pullScheduleViaAssist"]'); if (b) b.click(); else safeToast('Open the Visit screen first.', ''); }],
        ['💉 Prep op note', function () { if (typeof openOpPrepSmart === 'function') openOpPrepSmart(); }],
        ['🗓 Today’s agenda', function () { var c = $('mlsAgendaChip'); if (c) c.click(); }],
        ['⚙️ Settings', function () { if (typeof openSettings === 'function') openSettings(); }],
        ['📅 Calendar — today', function () { try { if (typeof showView === 'function') showView('calendar'); if (typeof calToday === 'function') calToday(); } catch (e) {} }]
      ];
      acts.forEach(function (a) { out.push({ g: 'Actions', label: a[0], sub: '', go: a[1] }); });
      /* templates */
      try {
        ((typeof getTemplates === 'function' ? getTemplates() : []) || []).forEach(function (t) {
          if (!t || !t.name) return;
          out.push({
            g: 'Templates', label: '📄 ' + String(t.name), sub: String(t.text || '').slice(0, 46),
            go: function () {
              try {
                var nav = Array.prototype.find.call(document.querySelectorAll('[onclick*="showView("]'), function (el) { return /template|studio/i.test(el.textContent || ''); });
                if (nav) nav.click(); else if (typeof showView === 'function') showView('studio');
                safeToast('Template: ' + t.name, 'ok');
              } catch (e) {}
            }
          });
        });
      } catch (e) {}
      /* patients -> select as the active visit patient */
      try {
        ((typeof getPatients === 'function' ? getPatients() : []) || []).slice(0, 800).forEach(function (p) {
          if (!p || !p.name) return;
          out.push({
            g: 'Patients', label: '🧑 ' + String(p.name), sub: p.dob ? ('DOB ' + p.dob) : '',
            go: function () { return qfPatientRoute(p, patientSession); }
          });
        });
      } catch (e) {}
      return out;
    }
    var qfIndex = [];
    function score(q, label) {
      var L = label.toLowerCase(), i = L.indexOf(q);
      if (!q) return 1;
      if (L.replace(/^[^a-z0-9]+/, '').indexOf(q) === 0) return 100;
      if (i === 0) return 95;
      if (i > 0 && /[\s/-]/.test(L[i - 1] || '')) return 70;
      if (i > 0) return 40;
      /* subsequence */
      var qi = 0;
      for (var c = 0; c < L.length && qi < q.length; c++) { if (L[c] === q[qi]) qi++; }
      return qi === q.length ? 15 : 0;
    }
    function qfRender(q) {
      q = String(q || '').trim().toLowerCase();
      var scored = [];
      qfIndex.forEach(function (it) {
        var s = score(q, it.label + ' ' + (it.sub || '') + ' ' + (it.search || ''));
        if (s > 0) scored.push([s, it]);
      });
      scored.sort(function (a, b) { return b[0] - a[0]; });
      qfItems = scored.slice(0, 14).map(function (x) { return x[1]; });
      qfSel = 0;
      qfPaint();
    }
    function qfPaint() {
      var list = $('mlsFpQfList'); if (!list) return;
      var html = '', lastG = '';
      qfItems.forEach(function (it, i) {
        if (it.g !== lastG) { html += '<div class="qf-h">' + esc(it.g) + '</div>'; lastG = it.g; }
        html += '<div class="qf-it' + (i === qfSel ? ' sel' : '') + '" data-i="' + i + '">' + esc(it.label) + (it.sub ? '<span class="qf-sub">' + esc(it.sub) + '</span>' : '') + '</div>';
      });
      list.innerHTML = html || '<div style="padding:16px;opacity:.6;font-size:13.5px">No matches — try fewer letters.</div>';
      Array.prototype.forEach.call(list.querySelectorAll('.qf-it'), function (el) {
        el.addEventListener('click', function () { qfGo(+el.getAttribute('data-i')); });
      });
    }
    function qfGo(i) {
      var it = qfItems[i]; if (!it) return qfFail('Choose a result first.');
      try { if (it.go() === false) return false; }
      catch (e) { return qfFail('That result could not be opened safely. Nothing was changed.'); }
      qfClose(); return true;
    }
    if (typeof window.mlsQuickFind === 'function' && !window.mlsQuickFind.__fpWrap) {
      FP._orig.quickFind = window.mlsQuickFind;
      var qfOpen = function () {
        qfEnsure();
        qfIndex = buildIndex(); /* fresh every open - fixes stale-after-one-use */
        var o = qfEl(); o.style.display = 'flex';
        var inp = $('mlsFpQfInput'); inp.value = ''; qfClearError(); qfRender(''); setTimeout(function () { inp.focus(); }, 30);
      };
      qfOpen.__fpWrap = true;
      window.mlsQuickFind = qfOpen;
    }
    listen(window, 'mls:session-boundary', function () {
      var o = qfEl();
      qfIndex = []; qfItems = [];
      if (!o || o.style.display === 'none') return;
      var inp = $('mlsFpQfInput'); if (inp) inp.value = '';
      qfIndex = buildIndex(); qfRender('');
      qfFail('The signed-in account changed. Search again in the current account.');
    });
    FP.fixes.quickFindPro = true;
  } catch (e) { FP.fixes.quickFindPro = 'error: ' + e.message; }

  /* ------------------------------------------------------------------ F8
   * FORMATTED NOTE PREVIEW IN THE TEXT BOXES
   * ------------------------------------------------------------------ */
  try {
    addStyle('mlsFpFmtStyle',
      '.mls-fp-fmt{border:1px solid var(--line,#E4E1D8);border-radius:12px;background:var(--card,#fff);margin:8px 0;overflow:hidden}' +
      '.mls-fp-fmt .fmt-bar{display:flex;align-items:center;gap:8px;padding:7px 12px;background:linear-gradient(135deg,#204034,#2E6A4B);color:#fff;font-size:12px;font-weight:800}' +
      '.mls-fp-fmt .fmt-bar button{margin-left:auto;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:8px;padding:3px 10px;font-size:11.5px;font-weight:700;cursor:pointer}' +
      '.mls-fp-fmt .fmt-body{padding:12px 16px;font-size:13.5px;line-height:1.55;max-height:340px;overflow:auto}' +
      '.mls-fp-fmt .fmt-body h4{margin:12px 0 4px;font-size:13px;letter-spacing:.5px;color:#204034;border-bottom:1px solid var(--line,#e3e9f2);padding-bottom:2px}' +
      '.mls-fp-fmt .fmt-body ul{margin:2px 0 6px 20px;padding:0}' +
      '.mls-fp-fmt .fmt-body .fmt-fill{background:#fff3cd;border:1px dashed #d9a406;border-radius:5px;padding:0 5px;font-weight:700}');
    function looksStructured(t) {
      return /^[A-Z][A-Z /&()\-]{3,}:?\s*$/m.test(t || '') || /\[FILL:/.test(t || '') || /operative|procedure:/i.test(t || '');
    }
    function fmtHtml(t) {
      var lines = String(t || '').split(/\r?\n/), html = '', ul = false;
      function closeUl() { if (ul) { html += '</ul>'; ul = false; } }
      lines.forEach(function (ln) {
        var s = ln.trim();
        var withFills = esc(s).replace(/\[FILL:([^\]]*)\]/gi, '<span class="fmt-fill">[FILL:$1]</span>').replace(/_{3,}/g, '<span class="fmt-fill">_____</span>');
        if (!s) { closeUl(); return; }
        if (/^[A-Z][A-Z0-9 /&()\-]{3,}:?\s*$/.test(s) || (/:$/.test(s) && s.length < 48 && !/[a-z]{6,}/.test(s))) {
          closeUl(); html += '<h4>' + withFills.replace(/:$/, '') + '</h4>';
        } else if (/^[-•*]\s+/.test(s)) {
          if (!ul) { html += '<ul>'; ul = true; }
          html += '<li>' + withFills.replace(/^[-•*]\s+/, '') + '</li>';
        } else {
          closeUl(); html += '<div style="margin:3px 0">' + withFills + '</div>';
        }
      });
      closeUl();
      return html || '<div style="opacity:.55">Nothing to format yet.</div>';
    }
    var previewEntries = [];
    function attachPreview(ta) {
      if (!ta || ta.__fpFmt) return;
      var wrap = document.createElement('div');
      wrap.className = 'mls-fp-fmt';
      wrap.style.display = 'none';
      wrap.innerHTML = '<div class="fmt-bar">📄 Formatted view (live)<button type="button">Hide</button></div><div class="fmt-body"></div>';
      ta.insertAdjacentElement('beforebegin', wrap);
      remember(wrap);
      var body = wrap.querySelector('.fmt-body');
      var btn = wrap.querySelector('button');
      var entry = { ta: ta, wrap: wrap, body: body, hidden: false, lastValue: null, lastShow: null, lastHtml: null, render: null };
      ta.__fpFmt = entry;
      previewEntries.push(entry);
      function rerender(force) {
        var t = ta.value || '';
        var show = looksStructured(t) && t.length > 60;
        if (!force && t === entry.lastValue && show === entry.lastShow) return;
        entry.lastValue = t;
        entry.lastShow = show;
        var wantDisplay = show ? 'block' : 'none';
        if (wrap.style.display !== wantDisplay) wrap.style.display = wantDisplay;
        if (!show || entry.hidden) return;
        var html = fmtHtml(t);
        if (html !== entry.lastHtml) {
          entry.lastHtml = html;
          body.innerHTML = html;
        }
      }
      entry.render = rerender;
      btn.addEventListener('click', function () {
        entry.hidden = !entry.hidden;
        body.style.display = entry.hidden ? 'none' : 'block';
        btn.textContent = entry.hidden ? 'Show' : 'Hide';
        if (!entry.hidden) rerender(true);
      });
      rerender(true);
    }
    function considerPreview(ta) {
      if (!ta || ta.tagName !== 'TEXTAREA' || ta.__fpFmt) return;
      try {
        var value = ta.value || '';
        if (ta.id === 'noteBox' || (value.length > 200 && looksStructured(value))) attachPreview(ta);
      } catch (e) {}
    }
    function scanBoxes(root) {
      root = root || document;
      if (root === document) {
        var nb = $('noteBox'); if (nb) considerPreview(nb);
      } else if (root.tagName === 'TEXTAREA') {
        considerPreview(root);
      }
      var scope = root.querySelectorAll ? root : document;
      Array.prototype.forEach.call(scope.querySelectorAll('textarea'), function (ta) {
        try {
          considerPreview(ta);
        } catch (e) {}
      });
    }
    function refreshPreviews() {
      for (var i = previewEntries.length - 1; i >= 0; i--) {
        var entry = previewEntries[i];
        if (!entry.ta || !entry.ta.isConnected) { previewEntries.splice(i, 1); continue; }
        entry.render(false);
      }
    }
    registerRefresh(function (root, reason) {
      if (root === document && /calendar|navigation/.test(reason || '') && !/patient|view|boot|note|generation/.test(reason || '')) return;
      scanBoxes(root);
      refreshPreviews();
    });
    FP.fixes.fmtPreview = true;
  } catch (e) { FP.fixes.fmtPreview = 'error: ' + e.message; }

  /* ------------------------------------------------------------------ F9
   * OP-NOTE FILL-IN-THE-BLANKS (restore)
   * ------------------------------------------------------------------ */
  try {
    var FILL_RULES = '\n\nSTRICT DICTATION RULE: never invent a specific value. For a case-specific value that was NOT dictated and is NOT stated in the template/source (injectate/solution amounts and volumes, medication names and doses, needle gauge, fluoroscopy time, laterality, spinal levels, complications), output ONE placeholder token EXACTLY in the form [FILL: short description of the missing value]. Example: "injected [FILL: volume of 0.25% bupivacaine] at each level". Use a placeholder ONLY when that value is genuinely missing — if the template, chart, or context already states it, copy it verbatim instead; never placeholder prose that needs no case-specific value, and never emit two placeholders for the same missing fact. Keep every heading.';
    /* harden the AI op-note path: append rules to the system prompt for op-note-ish calls */
    (function () {
      var origFetch = window.fetch; /* note: this is the F3-wrapped fetch, chain is fine */
      var f9Fetch = function (input, init) {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        var nextInit = init;
        try {
          if (init && typeof init.body === 'string' && init.body.indexOf('"system"') >= 0 && /\/api\//.test(url)) {
            var b = init.body;
            if (/operative|op[ -]?note|procedure note|injection/i.test(b) && b.indexOf('STRICT DICTATION RULE') < 0) {
              try {
                var o = JSON.parse(b);
                if (o && typeof o.system === 'string') {
                  o.system += FILL_RULES;
                  var init2 = {}; for (var k in init) init2[k] = init[k];
                  init2.body = JSON.stringify(o);
                  nextInit = init2;
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
        var pending = origFetch.call(window, input, nextInit);
        if (/\/api\/generate(?:\?|$)/.test(url) && pending && typeof pending.then === 'function') {
          return pending.then(function (res) {
            refreshBurst('network,generation,note', [0, 150, 500, 1000, 2000]);
            return res;
          });
        }
        return pending;
      };
      f9Fetch.__fpWrap = true;
      window.fetch = f9Fetch;
      FP._orig.fetch9 = origFetch;
    })();

    /* RETIRED (owner directive 2026-07-16): the floating "N blank(s) to fill —
       tap to start" bar + one-at-a-time typed walker are gone. The op-note
       fill box (feat_mls_opnote_fill.js) is the ONE fill mechanism: it pops up
       at the note itself, pre-fills every field with its most-likely value,
       and offers a dropdown (+ "Other") to change it. Keeping two UIs for the
       same blanks confused the flow and the walker made doctors type values
       the app already knew. FILL_RULES above stays — it is what guarantees the
       AI emits [FILL:] placeholders instead of inventing values. */
    try {
      var oldBar = $('mlsFpBlankBar'); if (oldBar && oldBar.parentNode) oldBar.parentNode.removeChild(oldBar);
      var oldModal = $('mlsFpBlankModal'); if (oldModal && oldModal.parentNode) oldModal.parentNode.removeChild(oldModal);
      var oldStyle = $('mlsFpBlankStyle'); if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle);
    } catch (e) {}
    FP.fixes.fillBlanks = 'retired: the op-note fill box (feat_mls_opnote_fill.js) owns every blank';
  } catch (e) { FP.fixes.fillBlanks = 'error: ' + e.message; }

  /* ------------------------------------------------------------------
   * EVENT-DRIVEN REFRESH BUS
   * ------------------------------------------------------------------
   * One child-list observer, scoped to the app host and filtered to the
   * calendar/agenda/textarea surfaces, replaces the former F4/F5/F6/F8/F9
   * idle polls. Input/change and known app lifecycle events update instantly.
   * Finite retry bursts cover programmatic textarea fills that emit no event.
   */
  function mutationRefreshRoot(node) {
    var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    if (!el) return null;
    try {
      if (el.tagName === 'TEXTAREA' || el.id === 'mlsAgendaChip' || el.id === 'calendarView' || el.id === 'heroPullStatus' || el.id === 'noteModelSel') return el;
      if (el.matches && el.matches('[data-scope="today"],.mlspk-tab')) return el;
      if (/today/i.test(String(el.id || '') + ' ' + String(el.className || ''))) return el;
      if (el.closest && el.closest('#calendarView,#mlsAgendaChip,#heroPullStatus,#noteModelSel')) return el;
      if (el.querySelector && el.querySelector('textarea,#mlsAgendaChip,#calendarView,#heroPullStatus,#noteModelSel,[data-scope="today"],.mlspk-tab')) return el;
    } catch (e) {}
    return null;
  }
  function installRefreshBus() {
    if (FP._refreshBusInstalled || !FP.installed) return;
    var host = $('appScreen') || document.body;
    if (!host) { later(installRefreshBus, 100); return; }
    FP._refreshBusInstalled = true;

    listen(document, 'input', function (e) {
      var ta = e && e.target;
      if (ta && ta.tagName === 'TEXTAREA') queueRefresh(ta, 'input,textarea', 80);
    }, true);
    listen(document, 'change', function (e) {
      var ta = e && e.target;
      if (ta && ta.tagName === 'TEXTAREA') queueRefresh(ta, 'change,textarea', 80);
    }, true);
    listen(document, 'click', function (e) {
      var target = e && e.target;
      var action = target && target.closest ? target.closest('button,a,[role="button"],#mlsAgendaChip,.mlspk-tab') : null;
      if (!action) return;
      var label = String(action.textContent || '') + ' ' + String(action.id || '') + ' ' + String(action.className || '');
      if (/generate|draft|prep|op[ -]?note|procedure note|create note|one note|soap/i.test(label)) {
        /* Bounded tail: the old [ …16s, 24s, 36s ] tail kept whole-document
           refresh passes running long after a generation finished or FAILED,
           and stacked with chart-navigation bursts into visible freezes. The
           burst now ends at 6s, and mls:generation-complete cancels it early. */
        refreshBurst('action,generation,note', [80, 350, 900, 1800, 3500, 6000]);
      } else if (/settings|preferences/i.test(label)) {
        refreshBurst('action,settings', [60, 250, 700, 1500, 3000]);
      } else if (/patient|visit|record|switch/i.test(label)) {
        refreshBurst('action,patient,view', [60, 250, 700, 1500, 3000, 5000]);
      } else if (/today|calendar|day|week|agenda|next|previous/i.test(label) || (action.closest && action.closest('#calendarView'))) {
        refreshBurst('action,navigation,calendar', [60, 250, 700, 1500, 3000, 5000]);
      }
    }, true);

    ['mls:ui-ready', 'mls:view-changed', 'mls:patient-changed', 'mls:note-generated',
      'mls:generation-complete', 'mls:schedule-updated', 'mls:calendar-updated'].forEach(function (name) {
      listen(window, name, function () { queueRefresh(document, name, 40); }, false);
    });
    /* Generation settled (success OR failure): stop the generation burst —
       one settle-refresh above is enough. */
    listen(window, 'mls:generation-complete', function () { cancelBurst('action,generation,note'); }, false);

    try {
      var mo = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var rec = records[i], targetRoot = null, target = null;
          try {
            target = rec.target && rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
            if (target && target.closest && target.closest('#calendarView,#mlsAgendaChip')) targetRoot = target;
          } catch (e) {}
          if (targetRoot) queueRefresh(targetRoot, 'mutation,calendar', 100);
          var groups = [rec.addedNodes || [], rec.removedNodes || []];
          for (var g = 0; g < groups.length; g++) {
            for (var n = 0; n < groups[g].length; n++) {
              var root = mutationRefreshRoot(groups[g][n]);
              if (root) queueRefresh(g ? (target || document) : root, g ? 'mutation,textarea-removed' : 'mutation', 100);
            }
          }
        }
      });
      mo.observe(host, { childList: true, subtree: true });
      FP._obs.push(mo);
    } catch (e) {}

    refreshBurst('boot', [0, 300, 1000, 2500, 5000, 9000]);
  }
  if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', installRefreshBus, { once: true });
  else installRefreshBus();

  /* ------------------------------------------------------------------
   * REVERT
   * ------------------------------------------------------------------ */
  FP.revert = function () {
    try { FP._ivs.forEach(function (i) { clearInterval(i); }); } catch (e) {}
    try { FP._tos.forEach(function (i) { clearTimeout(i); }); FP._tos.length = 0; } catch (e) {}
    try { FP._obs.forEach(function (o) { o.disconnect(); }); } catch (e) {}
    try {
      FP._listeners.forEach(function (r) { r.target.removeEventListener(r.name, r.fn, r.options); });
      FP._listeners.length = 0;
    } catch (e) {}
    try {
      if (FP._orig.pull) window.pullScheduleViaAssist = FP._orig.pull;
      if (FP._orig.importSched) window._importPulledSchedule = FP._orig.importSched;
      if (FP._orig.pullHist) window._pullAllHistories = FP._orig.pullHist;
      if (FP._orig.opPrev) window._opPreviewHtml = FP._orig.opPrev;
      ['openOpPrep', 'openOpPrepForPatient', 'opPrepSetMode'].forEach(function (fn) { if (FP._orig['op_' + fn]) window[fn] = FP._orig['op_' + fn]; });
      if (FP._orig.getNoteModel) window.getNoteModel = FP._orig.getNoteModel;
      if (FP._orig.quickFind) window.mlsQuickFind = FP._orig.quickFind;
      if (FP._orig.fetch) window.fetch = FP._orig.fetch; /* unwinds F9 too (it chained on top) */
    } catch (e) {}
    try { FP._nodes.forEach(function (n) { if (n && n.parentElement) n.parentElement.removeChild(n); }); } catch (e) {}
    try {
      if (typeof previewEntries !== 'undefined') previewEntries.forEach(function (entry) {
        if (entry && entry.ta && entry.ta.__fpFmt === entry) delete entry.ta.__fpFmt;
      });
    } catch (e) {}
    try {
      ['mlsFpStyle', 'mlsFpTodayStyle', 'mlsFpQfStyle', 'mlsFpFmtStyle', 'mlsFpBlankStyle'].forEach(function (id) { var s = $(id); if (s && s.parentElement) s.parentElement.removeChild(s); });
    } catch (e) {}
    FP.installed = false;
    try { delete window.__mlsFixpack; } catch (e) { window.__mlsFixpack = undefined; }
  };

  try { console.log('[MLS fixpack item79] installed', FP.fixes); } catch (e) {}
})();
