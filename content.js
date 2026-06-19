/* MLS Assist — content script.
   Sits dormant as a small badge on every page. Does NOTHING until the doctor
   opens the panel (consent). Then: capture the visit (live dictation or page
   selection) -> MLS generates a note -> the doctor reviews -> one click inserts
   it into the focused EMR field. Nothing is ever written automatically. */
(function () {
  /* MLS Assist v1.35 — scope guard: never run on github.com (perf+privacy; via <all_urls> the panel/observers used to inject into GitHub and could freeze its renderer). Belt-and-suspenders with manifest exclude_matches. athenaOne + mlsscribe.com are unaffected. */
  try { var __mlsHost = (location && location.hostname || '').toLowerCase(); if (__mlsHost === 'github.com' || __mlsHost.slice(-11) === '.github.com' || __mlsHost === 'githubusercontent.com' || __mlsHost.slice(-22) === '.githubusercontent.com' || __mlsHost === 'github.dev' || __mlsHost.slice(-11) === '.github.dev') { return; } } catch (e) {}
  if (window.__mlsAssistLoaded) return; window.__mlsAssistLoaded = true;
  // SECURITY (v1.26) -- trusted-origin gate for the page->extension postMessage bridge.
  // The content script runs on <all_urls> so the doctor can open the MLS Assist panel
  // on ANY page (that any-page behavior is intentional and unchanged). BUT the bridge
  // below can drive the extension to scrape the open EMR/Athena chart and return PHI,
  // so it must only be drivable by the MLS web app itself. We therefore (1) validate
  // e.origin against an allowlist of MLS app origins, (2) validate the message shape
  // and type, and (3) reply ONLY to the trusted origin -- never '*'. The doctor's own
  // panel/popup actions do NOT use this bridge (they use chrome.runtime messaging),
  // so a malicious page can neither puppet the extension nor receive chart data, while
  // the doctor's any-page usage is fully preserved.
  var MLS_BRIDGE_TYPES = { mlsPing: 1, mlsAppCapture: 1, mlsAppPasteNote: 1, mlsAppPullSchedule: 1, mlsAppReadChart: 1, mlsAppReadReport: 1, mlsAppPushVisit: 1, mlsAppSearchProcedure: 1 };
  // Optional operator-set extra origins (e.g. a staging domain, or http://localhost:PORT
  // for development). Defaults to none, so out of the box ONLY mlsscribe.com is trusted.
  var _mlsExtraOrigins = [];
  try {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['mlsTrustedOrigins'], function (c) {
        try { if (c && Array.isArray(c.mlsTrustedOrigins)) _mlsExtraOrigins = c.mlsTrustedOrigins.filter(function (o) { return typeof o === 'string'; }).map(function (o) { return o.toLowerCase(); }); } catch (e) {}
      });
    }
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area === 'local' && ch && ch.mlsTrustedOrigins) { try { var v = ch.mlsTrustedOrigins.newValue; _mlsExtraOrigins = Array.isArray(v) ? v.filter(function (o) { return typeof o === 'string'; }).map(function (o) { return o.toLowerCase(); }) : []; } catch (e) {} }
      });
    }
  } catch (e) {}
  function mlsTrustedOrigin(origin) {
    if (!origin || typeof origin !== 'string') return false;
    var o = origin.toLowerCase();
    try {
      var u = new URL(origin);
      if (u.protocol === 'https:' && (u.hostname === 'mlsscribe.com' || u.hostname === 'www.mlsscribe.com' || u.hostname.endsWith('.mlsscribe.com'))) return true;
    } catch (e) {}
    if (_mlsExtraOrigins.indexOf(o) >= 0) return true;
    return false;
  }
  function mlsStr(v, max) { return (typeof v === 'string') ? v.slice(0, max || 100000) : ''; }

  // Bridge: the MLS web app (mlsscribe.com) can ping us (to show "Assist installed")
  // and ask us to capture the patient currently open in the doctor's EMR tab.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.source !== 'mls-app') return;
    if (typeof d.type !== 'string' || !MLS_BRIDGE_TYPES[d.type]) return;
    if (!mlsTrustedOrigin(e.origin)) return;
    var origin = e.origin;
    var reply = function (payload) { try { window.postMessage(payload, origin); } catch (err) {} };
    if (d.type === 'mlsPing') { reply({ source: 'mls-ext', type: 'mlsPong' }); return; }
    if (d.type === 'mlsAppCapture') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppCaptureRequest' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppCaptureResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppCaptureResult', resp: { error: 'extension error' } }); }
    }
    if (d.type === 'mlsAppPasteNote') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppPasteRequest', note: mlsStr(d.note) }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppPasteResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppPasteResult', resp: { error: 'extension error' } }); }
    }
    // Pull TODAY'S SCHEDULE from the EMR tab (Athena) so MLS can pre-load the day's patients.
    if (d.type === 'mlsAppPullSchedule') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppScheduleRequest' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppScheduleResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppScheduleResult', resp: { error: 'extension error' } }); }
    }
    // Open + read ONE PATIENT'S CHART from Athena. If a patient name is passed, the
    // background tries to click that patient (e.g. in the schedule) to open the chart,
    // then reads the frame that looks most like a clinical chart (not the schedule).
    if (d.type === 'mlsAppReadChart') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppChartRequest', patient: mlsStr(d.patient, 200) }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppChartResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppChartResult', resp: { error: 'extension error' } }); }
    }
    // READ-ONLY: read the open Athena REPORT / claims / procedure / patient LIST tab so MLS
    // can enumerate patients by procedure/CPT (Study cohort, Mode B). Unlike mlsAppPullSchedule
    // (which scores frames for a SCHEDULE), this scores frames for a REPORT/LIST table (dates,
    // CPT-like codes, $ charges, "claim/procedure/service date" headers, many rows) and returns
    // the richest table frame plus a capped concat of the top frames. It never writes anything.
    if (d.type === 'mlsAppReadReport') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppReportRequest' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppReportResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppReportResult', resp: { error: 'extension error' } }); }
    }
    // Push the ENTIRE finished visit into the open Athena encounter (note, diagnoses,
    // ICD-10, E/M + CPT, orders, etc.) via the AI autopilot. NEVER clicks Save/Sign --
    // it stops and hands off to the doctor to review + sign in Athena.
    if (d.type === 'mlsAppPushVisit') {
      try { _mlsPushVisit(mlsStr(d.goal, 4000), origin); }
      catch (err) { reply({ source: 'mls-ext', type: 'mlsAppPushResult', resp: { error: 'extension error' } }); }
    }
    // READ-ONLY autopilot (Mode C): DRIVE an athenaOne procedure/claims search, run it, and
    // PAGINATE through every result page, harvesting each row's text. The app parses + filters
    // + verifies+imports the rows through its existing strict name+DOB gate. Operates only the
    // search controls (CPT/procedure + date range + Run/Next); it NEVER clicks Save/Sign.
    if (d.type === 'mlsAppSearchProcedure') {
      try { _mlsSearchProcedure(d.params || {}, d.cfg || {}, origin); }
      catch (err) { reply({ source: 'mls-ext', type: 'mlsAppSearchResult', resp: { error: 'extension error' } }); }
    }
  });
  // Headless autopilot loop that enters a finished visit into the EMR encounter.
  function _bg(type, payload) { return new Promise(function (res) { try { chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (r) { res(r || {}); }); } catch (e) { res({}); } }); }
  async function _mlsPushVisit(goal, trustedOrigin) {
    // v1.26: results/progress go ONLY to the trusted MLS origin that initiated the push,
    // never '*' -- so a hostile page can't observe the autopilot's PHI-bearing progress.
    var _to = trustedOrigin || 'https://mlsscribe.com';
    var post = function (type, payload) { try { window.postMessage(Object.assign({ source: 'mls-ext', type: type }, payload || {}), _to); } catch (e) {} };
    if (!goal) { post('mlsAppPushResult', { resp: { error: 'Nothing to push.' } }); return; }
    var history = [], lastSig = '', sameN = 0;
    post('mlsAppPushProgress', { msg: 'Starting — reading the Athena encounter…' });
    try {
      for (var step = 0; step < 60; step++) {
        post('mlsAppPushProgress', { msg: 'Entering the visit into Athena… step ' + (step + 1) });
        var cap = await _bg('mlsAssistCapture');
        var pt = await _bg('mlsAssistPageText'); var pageText = (pt && pt.text) || '';
        if (pageText.replace(/\s/g, '').length < 40) { await new Promise(function (r) { setTimeout(r, 1300); }); pt = await _bg('mlsAssistPageText'); pageText = (pt && pt.text) || ''; }
        var els = await _bg('mlsAssistElements'); var elements = (els && els.list) || [];
        var resp = await _bg('mlsAssistAgentStep', { goal: goal, pageText: pageText, screenshot: (cap && cap.dataUrl) || '', history: history, elements: elements });
        if (!resp || resp.error) { post('mlsAppPushResult', { resp: { ok: false, error: (resp && resp.error) || 'no response from the AI' } }); return; }
        var a = resp.action || {}; if (resp.reasoning) post('mlsAppPushProgress', { msg: '(' + (step + 1) + ') ' + String(resp.reasoning).slice(0, 110) });
        history.push({ type: a.type, target: a.target });
        // Loop-guard keyed on type+target+a coarse page signature, so legitimately repeating
        // the SAME control on a CHANGED screen (e.g. adding several diagnoses) isn't blocked.
        var sig = (a.type || '') + '|' + (a.target || '') + '|' + pageText.length;
        if (sig === lastSig) sameN++; else { sameN = 0; lastSig = sig; }
        if (sameN >= 4) { post('mlsAppPushResult', { resp: { ok: true, partial: true, msg: 'Got stuck repeating a step — paused. Review Athena and finish the rest manually.' } }); return; }
        if (a.type === 'done') { post('mlsAppPushResult', { resp: { ok: true, msg: 'Entered the visit into Athena. Review everything and sign it there.' } }); return; }
        if (a.type === 'confirm') { post('mlsAppPushResult', { resp: { ok: true, paused: true, msg: 'Everything is entered. Athena is asking to Save/Sign — review it and click Sign yourself.' } }); return; }
        if (a.type === 'ask') { post('mlsAppPushResult', { resp: { ok: true, paused: true, msg: 'Athena needs a choice from you: ' + (a.target || a.reasoning || '') + '. Handle that, then re-run.' } }); return; }
        if (a.type === 'switchtab') { await _bg('mlsAssistExec', { action: a }); await new Promise(function (r) { setTimeout(r, 1200); }); continue; }
        await _bg('mlsAssistExec', { action: a });
        await new Promise(function (r) { setTimeout(r, 850); });
      }
      post('mlsAppPushResult', { resp: { ok: true, partial: true, msg: 'Entered as much as I could — review Athena and finish any remaining fields, then sign.' } });
    } catch (e) { post('mlsAppPushResult', { resp: { ok: false, error: String((e && e.message) || e) } }); }
  }

  // Mode C orchestrator: tell the background to FILL+RUN the athenaOne search, then page
  // through every result page (read -> Next -> read ...) accumulating the row text, and hand
  // the whole thing back to the MLS app to parse + verify + import. Progress is posted ONLY to
  // the trusted MLS origin that started it (never '*'). The background does all DOM work in the
  // signed-in athenaOne tab via chrome.scripting; this content script never touches Athena DOM.
  function _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function _mlsSearchProcedure(params, cfg, trustedOrigin) {
    var _to = trustedOrigin || 'https://mlsscribe.com';
    var post = function (type, payload) { try { window.postMessage(Object.assign({ source: 'mls-ext', type: type }, payload || {}), _to); } catch (e) {} };
    cfg = cfg || {};
    var pageWait = cfg.pageWaitMs || 1600, initWait = cfg.initialWaitMs || 2200, maxPages = cfg.maxPages || 60;
    try {
      post('mlsAppSearchProgress', { msg: 'Asking athenaOne to run the procedure search...' });
      var fill = await _bg('mlsAppSearchFill', { params: params, cfg: cfg });
      if (!fill || !fill.ok) { post('mlsAppSearchResult', { resp: { ok: false, error: (fill && fill.error) || 'Could not reach your athenaOne tab.' } }); return; }
      var tabId = fill.tabId;
      if (!(fill.acted && fill.acted.acted)) {
        post('mlsAppSearchResult', { resp: { ok: false, code: 'NO_FORM', error: 'Could not find the procedure-search fields on your athenaOne screen. Open the procedure/claims report or charge-search page (so the CPT/procedure + date filters are visible), or tune window.__mlsStudyConfig.search, then retry. You can also run the report yourself and use the read-only Find in Athena.' } }); return;
      }
      await _sleep(initWait);
      var io = {
        read: function () { return _bg('mlsAppSearchRead', { tabId: tabId, cfg: cfg }); },
        next: function () { return _bg('mlsAppSearchNext', { tabId: tabId, cfg: cfg }); }
      };
      var result = await mlsPaginate(io, {
        maxPages: maxPages,
        wait: function () { return _sleep(pageWait); },
        onProgress: function (pages, rows) { post('mlsAppSearchProgress', { msg: 'Read page ' + pages + ' (' + rows + ' rows on this page)...' }); }
      });
      post('mlsAppSearchResult', { resp: { ok: true, text: result.text || '', pages: result.pages || 0, ranControls: fill.acted } });
    } catch (e) { post('mlsAppSearchResult', { resp: { ok: false, error: String((e && e.message) || e) } }); }
  }

  /*MLS_PAGINATE_START*/
  async function mlsPaginate(io, opts) {
    opts = opts || {};
    var maxPages = opts.maxPages || 60;
    var seen = {}, pages = 0, all = '';
    var onProgress = opts.onProgress || function () {};
    for (var p = 0; p < maxPages; p++) {
      var rd = await io.read();
      if (!rd || !rd.ok) break;
      pages++;
      var dup = !!(rd.sig && seen[rd.sig]);
      if (rd.text && !dup) { if (all.length < 300000) all += (all ? '\n' : '') + rd.text; }
      if (rd.sig) seen[rd.sig] = 1;
      onProgress(pages, rd.rowCount || 0);
      if (dup) break;
      if (!rd.hasNext) break;
      var nx = await io.next();
      if (!nx || !nx.clicked) break;
      if (opts.wait) { await opts.wait(); }
    }
    return { text: all, pages: pages };
  }
  /*MLS_PAGINATE_END*/

  // --- custom hover tooltips: appear only after the cursor rests ~2s on a button ---
  (function () {
    var DELAY = 2000, tipEl = null, timer = null, currentEl = null;
    function ensure() { if (tipEl) return tipEl; tipEl = document.createElement('div'); tipEl.id = 'mls-tip'; (document.body || document.documentElement).appendChild(tipEl); return tipEl; }
    function show(el) {
      if (!el || !el.getAttribute) return;
      var txt = el.getAttribute('data-tip'); if (!txt) return;
      var t = ensure(); t.textContent = txt; t.style.display = 'block'; t.style.opacity = '0';
      var r = el.getBoundingClientRect(), tw = t.offsetWidth, th = t.offsetHeight;
      var left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
      var top = r.top - th - 8; if (top < 8) top = r.bottom + 8;
      t.style.left = left + 'px'; t.style.top = top + 'px'; t.style.opacity = '1';
    }
    function hide() { if (timer) { clearTimeout(timer); timer = null; } if (tipEl) tipEl.style.display = 'none'; }
    document.addEventListener('mouseover', function (e) {
      var el = (e.target && e.target.closest) ? e.target.closest('[data-tip]') : null;
      if (el === currentEl) return;
      currentEl = el; hide();
      if (el) timer = setTimeout(function () { show(el); }, DELAY);
    }, true);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
  })();

  // --- remember the last editable field the user focused (the note field) ---
  let lastEditable = null;
  function isEditable(el) {
    if (!el) return false;
    const t = (el.tagName || '').toUpperCase();
    if (t === 'TEXTAREA') return true;
    if (t === 'INPUT') return /^(text|search|email|url|tel|)$/i.test(el.type || '');
    return !!el.isContentEditable;
  }
  document.addEventListener('focusin', e => { if (isEditable(e.target)) lastEditable = e.target; }, true);
  // Smart note-field detection so the doctor doesn't have to click the field first.
  function bestNoteField() {
    if (isEditable(lastEditable)) return lastEditable;
    if (isEditable(document.activeElement)) return document.activeElement;
    const cands = [...document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"]')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 120 && r.height > 36 && r.bottom > 0 && r.top < innerHeight; });
    // v1.26: score by identity (label/aria/placeholder/name/id + associated <label>) + size,
    // so a real note field beats a large search/chat box; falls back to largest-area when
    // identity is ambiguous, so the v1.25 behavior still holds (no regression).
    function _hay(el){ var h=((el.getAttribute&&(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('name')||el.getAttribute('title')||el.id))||''); try{ if(el.id){ var lb=document.querySelector('label[for="'+el.id+'"]'); if(lb) h+=' '+(lb.textContent||''); } }catch(e){} return String(h).toLowerCase(); }
    function _score(el){ var r=el.getBoundingClientRect(); var s=Math.min(r.width*r.height,400000)/1000; var h=_hay(el); if(/note|hpi|assess|plan|soap|progress|narrative|subjective|objective|chief|complaint|document|free.?text|encounter|impression|history of present/.test(h)) s+=1000; if(/search|find|lookup|filter|chat|messag|comment|reason for|address|e-?mail|phone|\bnpi\b|\bmrn\b|patient.?id|claim|invoice|login|password|user.?name|\bzip\b|\bcity\b|\bstate\b/.test(h)) s-=1500; if((el.tagName||'')==='TEXTAREA') s+=120; if(el.isContentEditable) s+=100; return s; }
    cands.sort((a, b) => _score(b) - _score(a));
    return cands[0] || null;
  }

  // --- build UI ---
  const badge = document.createElement('div');
  badge.id = 'mls-assist-badge';
  badge.innerHTML = '<span class="dot"></span>🩺 MLS Assist';
  badge.setAttribute('data-tip', 'Open MLS Assist — dictate, draft, and insert your note');

  const panel = document.createElement('div');
  panel.id = 'mls-assist-panel';
  var SECH = 'font-weight:800;font-size:11.5px;color:#15528f;letter-spacing:.2px;margin:15px 0 7px;display:flex;align-items:center;gap:7px';
  var NUM = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#1f7ae0;color:#fff;font-size:11px;font-weight:800;flex:none';
  panel.innerHTML = [
    '<header><b>🩺 MLS Assist</b><span class="x" data-tip="Close MLS Assist">×</span></header>',
    '<div class="body">',
    '  <div class="consent">Dictate or select the visit → MLS drafts the note → it goes into the chart <b>only when you click</b>. You review everything.</div>',

    '  <div style="' + SECH + '"><span style="' + NUM + '">1</span> Capture the visit</div>',
    '  <textarea id="mls-tx" rows="4" placeholder="Press 🎙 Dictate and talk through the visit — or paste / highlight text from the chart."></textarea>',
    '  <div class="row">',
    '    <button class="b b-rec" id="mls-rec" data-tip="Dictate the visit out loud — MLS transcribes as you talk">🎙 Dictate</button>',
    '    <button class="b b-ghost" id="mls-sel" data-tip="Use the text you have highlighted on the chart as the visit context">Use selection</button>',
    '    <button class="b b-ghost" id="mls-clr" data-tip="Clear the transcript and the drafted note">Clear</button>',
    '  </div>',

    '  <div style="' + SECH + '"><span style="' + NUM + '">2</span> Write &amp; insert the note</div>',
    '  <div class="row"><button class="b b-go" id="mls-gen" data-tip="Turn the transcript into a structured clinical note" style="flex:1">✨ Generate note</button></div>',
    '  <textarea id="mls-note" rows="6" placeholder="Your drafted note appears here — review it before inserting." style="margin-top:7px"></textarea>',
    '  <div class="row">',
    '    <button class="b b-primary" id="mls-ins" data-tip="Drops the drafted note straight into your EMR note field — it finds the field for you (one-shot paste)" style="flex:1">⤵ Insert into chart</button>',
    '    <button class="b b-ghost" id="mls-cpy" data-tip="Copy the drafted note to your clipboard">Copy</button>',
    '  </div>',

    '  <div style="' + SECH + '"><span style="' + NUM + '">3</span> Pull the chart into MLS</div>',
    '  <div class="row"><button class="b b-ghost" id="mls-cap" data-tip="Read this patient and their prior visits into MLS — nothing is written back to the EMR" style="flex:1">📋 Capture chart → MLS</button></div>',
    '  <div class="consent" style="margin-top:6px">Reads the patient + prior visits off this page into MLS (encrypted). Nothing is written back to the EMR.</div>',

    '  <div class="log" id="mls-log"></div>',
    '</div>'
  ].join('');

  document.documentElement.appendChild(badge);
  document.documentElement.appendChild(panel);

  const $ = s => panel.querySelector(s);
  const tx = $('#mls-tx'), noteBox = $('#mls-note'), logBox = $('#mls-log');
  function log(m) { const d = document.createElement('div'); d.textContent = '• ' + m; logBox.prepend(d); }

  function mlsVerCmp(a, b) { a = String(a).split('.').map(Number); b = String(b).split('.').map(Number); for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x > y) return 1; if (x < y) return -1; } return 0; }
  let _updChecked = false;
  async function checkForUpdate() {
    if (_updChecked) return; _updChecked = true;
    try {
      const cur = chrome.runtime.getManifest().version;
      const r = await fetch('https://mlsscribe.com/extension-version.json?t=' + Date.now());
      const d = await r.json();
      if (d && d.version && mlsVerCmp(d.version, cur) > 0) {
        const url = d.url || 'https://mlsscribe.com/assist.html';
        const bn = document.createElement('div');
        bn.style.cssText = 'background:#fff7e6;border:1px solid #f0d9a0;border-radius:8px;padding:8px 10px;margin:0 0 8px;font-size:12.5px;color:#8a5a00';
        bn.innerHTML = '\u{1F504} <b>Update available</b> (v' + String(d.version).replace(/[<>&"]/g, '') + '). <a href="' + url + '" target="_blank" style="color:#1f7ae0;font-weight:700">Download</a>, then reload it at chrome://extensions.';
        const body = panel.querySelector('.body'); if (body) body.insertBefore(bn, body.firstChild);
        log('A newer version of MLS Assist is available.');
      }
    } catch (e) {}
  }
  badge.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    if (open) { log('Panel opened — capture is active.'); checkForUpdate(); }
  });
  $('.x').addEventListener('click', () => { panel.classList.remove('open'); stopRec(); });
  chrome.runtime.onMessage.addListener((m, s, send) => { if (m && m.type === 'mlsOpenPanel') { panel.classList.add('open'); log('Opened MLS Assist from the toolbar.'); try { send && send({ ok: true }); } catch (e) {} } return true; });

  // --- live dictation (Web Speech API) ---
  let rec = null, recing = false;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recBtn = $('#mls-rec');
  if (!SR) { recBtn.disabled = true; recBtn.textContent = '🎙 (no speech support)'; }
  function startRec() {
    if (!SR) return;
    rec = new SR(); rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
    let base = tx.value;
    rec.onresult = (e) => {
      let finalTxt = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTxt += e.results[i][0].transcript + ' ';
      }
      if (finalTxt) { base += (base && !/\s$/.test(base) ? ' ' : '') + finalTxt.trim() + ' '; tx.value = base; }
    };
    rec.onerror = (e) => log('Dictation: ' + (e.error || 'error'));
    rec.onend = () => { if (recing) { try { rec.start(); } catch (e) {} } };
    try { rec.start(); recing = true; recBtn.textContent = '⏹ Stop'; badge.classList.add('active'); log('Dictation started.'); } catch (e) { log('Could not start mic.'); }
  }
  function stopRec() {
    recing = false; if (rec) { try { rec.stop(); } catch (e) {} } recBtn.textContent = '🎙 Dictate'; badge.classList.remove('active');
  }
  recBtn.addEventListener('click', () => { recing ? (stopRec(), log('Dictation stopped.')) : startRec(); });

  // --- use page selection ---
  $('#mls-sel').addEventListener('click', () => {
    const sel = (window.getSelection ? window.getSelection().toString() : '').trim();
    if (!sel) { log('No text selected on the page.'); return; }
    tx.value = (tx.value ? tx.value + '\n\n' : '') + sel; log('Added ' + sel.length + ' chars from selection.');
  });
  $('#mls-clr').addEventListener('click', () => { tx.value = ''; noteBox.value = ''; });

  // --- generate (key + network handled by the background worker) ---
  $('#mls-gen').addEventListener('click', () => {
    const transcript = tx.value.trim();
    if (!transcript) { log('Add a transcript or selection first.'); return; }
    const btn = $('#mls-gen'); btn.disabled = true; btn.textContent = '… generating';
    chrome.runtime.sendMessage({ type: 'mlsAssistGenerate', transcript }, (resp) => {
      btn.disabled = false; btn.textContent = '✨ Generate note';
      if (!resp) { log('No response (extension reloaded?).'); return; }
      if (resp.error) { log('Error: ' + resp.error); return; }
      noteBox.value = resp.note || '';
      log('Note drafted' + (resp.model ? ' (' + resp.model + ')' : '') + ' — review, then Insert.');
    });
  });

  // --- capture the whole chart (read all data) into MLS ---
  $('#mls-cap').addEventListener('click', () => {
    const pageText = ((document.body && document.body.innerText) || '').trim().slice(0, 20000);
    if (!pageText) { log('Nothing readable on this page to capture.'); return; }
    const btn = $('#mls-cap'); btn.disabled = true; btn.textContent = '… capturing chart';
    chrome.runtime.sendMessage({ type: 'mlsAssistExtract', pageText, url: location.href }, (resp) => {
      btn.disabled = false; btn.textContent = '📋 Capture whole chart → MLS';
      if (!resp) { log('No response (extension reloaded?).'); return; }
      if (resp.ok) { log('✓ Captured ' + (resp.patient || 'patient') + ' + ' + (resp.visits || 0) + ' prior visit(s) into MLS.'); return; }
      log('Capture: ' + (resp.error || 'no patient identity found on this page.'));
    });
  });

  // --- insert into the focused EMR field (v1.28: patient-gated, section-routed) ---
  // v1.28 — hardened, VERIFIED text entry (same logic as background mlsRobustType):
  // resolves a real editable field from a label/wrapper, clicks+focuses, native-setter ->
  // simulated paste -> per-character keystrokes (mask-aware), then selects a matching
  // typeahead suggestion, and re-reads after a settle + blur to confirm. Returns a boolean.
  async function _robustType(el, txt) {
    txt = String(txt == null ? '' : txt);
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    function _isEd(e) { if (!e || !e.tagName) return false; if (e.isContentEditable) return true; var tg = e.tagName.toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') { var t = (e.getAttribute('type') || 'text').toLowerCase(); return /^(text|search|email|url|tel|number|password|date|month|week|time|datetime-local|)$/.test(t); } return false; }
    function _resolve(e) { if (_isEd(e)) return e; if (!e || !e.tagName) return e; try { if (e.tagName.toUpperCase() === 'LABEL') { var f = e.getAttribute('for'); if (f) { var byId = document.getElementById(f); if (_isEd(byId)) return byId; } var within = e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(within)) return within; } } catch (e2) {} try { var n = e.querySelector && e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(n)) return n; } catch (e3) {} try { var p = e.parentElement, d = 0; while (p && d < 3) { var inp = p.querySelector && p.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(inp)) return inp; p = p.parentElement; d++; } } catch (e5) {} return e; }
    el = _resolve(el);
    if (!el || !_isEd(el) || el.readOnly || el.disabled) return false;
    var CE = !!el.isContentEditable;
    function rd() { return CE ? (el.innerText || el.textContent || '') : (el.value || ''); }
    function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
    function digits(s) { return String(s || '').replace(/\D/g, ''); }
    function isMasked() { try { if (CE) return false; var t = (el.getAttribute('type') || '').toLowerCase(); if (t === 'date' || t === 'tel') return true; var ph = el.getAttribute('placeholder') || ''; if (/[\/\-.]/.test(ph) && /[mdyhMDYH#0_]/.test(ph)) return true; if (el.getAttribute('inputmode') === 'numeric') return true; if (el.getAttribute('data-mask') || el.getAttribute('pattern')) return true; var ml = el.maxLength; if (ml && ml > 0 && ml <= 12 && /[\/\-.]/.test(ph)) return true; } catch (e) {} return false; }
    var masked = isMasked();
    function landed() { var cur = rd(); if (!cur && txt) return false; var a = norm(cur), b = norm(txt); if (!b) return true; if (a.indexOf(b.slice(0, Math.min(b.length, 40))) >= 0) return true; if (masked) { var dc = digits(cur), dt = digits(txt); if (dt && dc.indexOf(dt) >= 0) return true; } return cur.replace(/\s+/g, '').length >= Math.min(txt.replace(/\s+/g, '').length, 15); }
    function setNative(v) { if (CE) { try { el.textContent = v; } catch (e) {} return; } var pr = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var d = Object.getOwnPropertyDescriptor(pr, 'value'); if (d && d.set) d.set.call(el, v); else el.value = v; }
    function fireInput(data, type) { try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type || 'insertText', data: data })); } catch (e) { try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {} } }
    function clearField() { try { if (!CE && el.setSelectionRange) el.setSelectionRange(0, (el.value || '').length); } catch (e) {} setNative(''); fireInput('', 'deleteContentBackward'); }
    function _vis(e) { try { var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e2) { return true; } }
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    try { el.click(); } catch (e) {}
    try { el.focus(); } catch (e) {}
    await sleep(0);
    async function keystroke() { clearField(); for (var i = 0; i < txt.length; i++) { var ch = txt.charAt(i); try { el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true })); } catch (e) {} if (CE) { var ok; try { ok = document.execCommand('insertText', false, ch); } catch (e) { ok = false; } if (!ok) setNative(rd() + ch); } else { var base = (el.value != null) ? el.value : ''; setNative(base + ch); } fireInput(ch, 'insertText'); try { el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true })); } catch (e) {} await sleep(masked ? 18 : 6); } try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
    async function pickSuggestion() { await sleep(320); var opts = []; var ac = el.getAttribute && (el.getAttribute('aria-controls') || el.getAttribute('aria-owns')); if (ac) { var box = document.getElementById(ac); if (box) opts = [].slice.call(box.querySelectorAll('[role=option],li,.option,.item')).filter(_vis); } if (!opts.length) opts = [].slice.call(document.querySelectorAll('[role=option],[role=listbox] li,.autocomplete-item,.suggestion,.typeahead-option,ul[class*=auto] li,ul[class*=suggest] li,li[class*=option]')).filter(_vis); if (!opts.length) { var lists = [].slice.call(document.querySelectorAll('ul,ol,[role=listbox],[role=menu]')).filter(_vis); for (var L = 0; L < lists.length && !opts.length; L++) { var items = [].slice.call(lists[L].querySelectorAll('li,[role=option],[role=menuitem]')).filter(_vis); if (items.length && items.length <= 25) opts = items; } } if (!opts.length) return false; var want = norm(txt), pick = null; for (var i = 0; i < opts.length; i++) { if (norm(opts[i].textContent).indexOf(want) >= 0) { pick = opts[i]; break; } } if (!pick) pick = opts[0]; if (!pick) return false; try { pick.scrollIntoView({ block: 'center' }); } catch (e) {} var r = pick.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }; ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) { try { pick.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {} }); try { pick.click(); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); } catch (e) {} await sleep(150); return true; }
    var method = '';
    if (!masked) {
      try { try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); } catch (e) {} if (CE) { try { var rg = document.createRange(); rg.selectNodeContents(el); var se = window.getSelection(); se.removeAllRanges(); se.addRange(rg); } catch (e) {} try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt })); } catch (e) {} var _ec; try { _ec = document.execCommand('insertText', false, txt); } catch (e) { _ec = false; } if (!_ec) setNative(txt); } else { clearField(); setNative(txt); } fireInput(txt, 'insertText'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {} } catch (e) {}
      await sleep(0); if (landed()) method = 'native';
      if (!method) { try { var dt = new DataTransfer(); dt.setData('text/plain', txt); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); fireInput(txt, 'insertFromPaste'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } catch (e) {} await sleep(0); if (landed()) method = 'paste'; }
    }
    if (!method && txt.length <= 4000) { try { await keystroke(); } catch (e) {} if (landed()) method = 'keystroke'; }
    var picked = false; try { picked = await pickSuggestion(); } catch (e) {}
    if (picked) await sleep(60);
    await sleep(120);
    if (!landed()) { try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {} await sleep(80); }
    return landed();
  }
  function localPaste(target, note) { return _robustType(target, note); }
  function clipFallback(note) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(note).then(function () { log('Couldn’t reach the field — copied the note instead. Click into the right field and press Ctrl/Cmd + V.'); }, function () { log('Couldn’t reach the field, and copy was blocked. Click into the field, then try again.'); });
    } else { log('Couldn’t reach the field. Click into the field and try again.'); }
  }
  // remove any leftover override button from a previous attempt
  function _clearOverride() { try { var b = panel.querySelector('#mls-ins-override'); if (b) b.remove(); } catch (e) {} }
  // dob shown only in the doctor's own browser; nothing is logged off-device
  function _short(name, dob) { var s = (name || '').trim(); if (dob) s += (s ? ' ' : '') + '(' + dob + ')'; return s || 'unknown'; }
  function _renderWrite(resp) {
    _clearOverride();
    if (!resp) { clipFallback(noteBox.value.trim()); return; }
    if (resp.error) { log('⚠ ' + resp.error); return; }
    // PATIENT GATE blocked the write
    if (resp.blocked) {
      var p = resp.patient || {};
      if (resp.patientStatus === 'mismatch') {
        log('⛔ PATIENT MISMATCH — nothing was written. MLS active patient: ' + _short(p.mlsName, p.mlsDob) + ' · Athena chart shows: ' + _short(p.athName, p.athDob) + '. Open the correct chart (or switch the MLS patient) so they match, then Insert again.');
      } else {
        log('⛔ Could not verify the patient — nothing was written. MLS: ' + _short(p.mlsName, p.mlsDob) + ' · Athena chart read: ' + _short(p.athName, p.athDob) + '. Make sure the patient chart is open in Athena and the right patient is active in MLS.');
      }
      // offer an explicit, consent-based override
      try {
        var btn = document.createElement('button'); btn.id = 'mls-ins-override'; btn.className = 'b';
        btn.style.cssText = 'margin-top:6px;width:100%;border:1px solid #c0392b;color:#c0392b;background:#fff5f4;font-weight:700';
        btn.textContent = '⚠ Insert anyway — I confirmed this is the right patient';
        btn.addEventListener('click', function () { _clearOverride(); log('Override confirmed — writing…'); _doVerifiedWrite(noteBox.value.trim(), true); });
        var host = panel.querySelector('#mls-log'); if (host && host.parentNode) host.parentNode.insertBefore(btn, host);
      } catch (e) {}
      return;
    }
    // MATCH (or override): show who, then each field that was written
    var pt = resp.patient || {};
    log('✓ Found patient: ' + _short(pt.athName || pt.mlsName, pt.athDob || pt.mlsDob) + (resp.forced ? ' (override)' : '') + ' — writing to this chart.');
    var wr = resp.wrote || [];
    if (!wr.length) { log('⚠ Patient verified, but I found no matching field to write into. Open the section you want and click its field, then Insert.'); return; }
    var okN = 0, badN = 0;
    wr.forEach(function (w) {
      if (w.confirmed) { okN++; log('   ✓ ' + (w.targetLabel || w.section) + (w.chosenLabel && w.chosenLabel !== w.targetLabel ? ' (' + w.chosenLabel + ')' : '') + ' — verified.'); }
      else if (w.notfound) { badN++; log('   ⚠ ' + (w.targetLabel || w.section) + ' — no matching field found here (not written).'); }
      else { badN++; log('   ⚠ ' + (w.targetLabel || w.section) + ' — wrote but could not confirm; check before signing.'); }
    });
    log((badN === 0 ? '✓ All sections placed and verified.' : '⚠ ' + okN + ' verified, ' + badN + ' need a check.') + ' Review and sign in your EMR — MLS never saves or signs for you.');
  }
  function _doVerifiedWrite(note, force) {
    if (!note) { log('Nothing to insert yet.'); return; }
    log(force ? 'Writing (override)…' : 'Finding and verifying the patient…');
    try { chrome.runtime.sendMessage({ type: 'mlsVerifiedWrite', note: note, force: !!force }, function (resp) { _renderWrite(resp); }); }
    catch (e) { clipFallback(note); }
  }
  $('#mls-ins').addEventListener('click', () => {
    const note = noteBox.value.trim();
    if (!note) { log('Nothing to paste yet.'); return; }
    // EVERY write goes through the patient-match gate first (no silent top-frame bypass).
    _doVerifiedWrite(note, false);
  });
  $('#mls-cpy').addEventListener('click', () => {
    const txt = noteBox.value || '';
    function ec() {
      try { noteBox.focus(); const s = noteBox.selectionStart, e2 = noteBox.selectionEnd; noteBox.select(); const ok = document.execCommand('copy'); try { noteBox.setSelectionRange(s, e2); } catch (e) {} if (ok) { log('Copied to clipboard.'); return; } } catch (e) {}
      log('Copy blocked — select the note text and press Ctrl/Cmd + C.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(() => log('Copied to clipboard.'), ec); } else { ec(); }
  });
})();

/* MLS Assist — Stage 2 Autopilot (beta).
   A supervised agent loop: screenshot + page text -> MLS agent brain decides the
   next action -> we execute it on the page -> repeat. Hard safety rail: it never
   commits to the chart; on a Save/Sign it PAUSES and asks the doctor to do it. */
(function () {
  function ready() { const p = document.getElementById('mls-assist-panel'); if (!p) return setTimeout(ready, 600); init(p); }
  ready();
  function init(panel) {
    const body = panel.querySelector('.body'); if (!body || panel.__apInit) return; panel.__apInit = true;
    const log = panel.querySelector('#mls-log'); const L = m => { const d = document.createElement('div'); d.textContent = '⤷ ' + m; log.prepend(d); };
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border-top:1px solid #e8eef6;margin-top:14px;padding-top:4px';
    wrap.innerHTML =
      // Collapsible header — autopilot is advanced, so it stays tucked away until opened.
      '<div id="mls-ap-toggle" style="cursor:pointer;user-select:none;font-weight:800;font-size:11.5px;color:#15528f;letter-spacing:.2px;display:flex;align-items:center;gap:7px;padding:9px 0">' +
        '<span id="mls-ap-caret" style="display:inline-block;transition:transform .15s">▸</span> 🤖 Autopilot <span style="font-weight:500;color:#9aa7b4;font-size:11px">— advanced, optional</span>' +
      '</div>' +
      '<div id="mls-ap-wrap" style="display:none">' +
        '<div class="consent" style="margin:0 0 8px">Tell the agent what to do and it takes the steps on screen while you watch. It <b>pauses before any Save/Sign</b> unless you allow it below.</div>' +
        '<input id="mls-ap-goal" placeholder="e.g. find the note field and insert the visit note" style="width:100%;box-sizing:border-box;border:1px solid #cfe0f3;border-radius:8px;padding:8px;font:13px inherit">' +
        '<div class="row" style="margin-top:6px"><button class="b b-go" id="mls-ap-run" data-tip="Let the agent take the steps toward your goal — it pauses before any Save or Sign" style="flex:1">▶ Run</button><button class="b b-rec" id="mls-ap-stop" data-tip="Stop the autopilot right now" style="display:none">⏹ Stop</button><button class="b b-ghost" id="mls-ap-mic" data-tip="Speak your goal instead of typing it">🎤</button></div>' +
        '<div id="mls-ap-status" style="font-size:12px;color:#5a6a7a;margin:7px 0 0;min-height:15px"></div>' +
        '<div id="mls-ap-pbs" style="display:flex;gap:5px;flex-wrap:wrap;margin:7px 0 0"></div>' +
        '<div id="mls-ap-recs" style="display:flex;gap:5px;flex-wrap:wrap;margin:5px 0 0"></div>' +
        // The rarely-used controls go under a second "More" fold so the menu stays clean.
        '<div id="mls-ap-more-toggle" style="cursor:pointer;user-select:none;font-size:11.5px;color:#6a7a8a;margin-top:9px">＋ More options</div>' +
        '<div id="mls-ap-more" style="display:none;margin-top:7px">' +
          '<div class="row" style="gap:6px"><button class="b b-ghost" id="mls-ap-savepb" data-tip="Save this goal as a one-tap playbook">💾 Save as playbook</button><button class="b b-ghost" id="mls-ap-rec" data-tip="Record the clicks and typing you do, then replay it anytime">⏺ Record a task</button><button class="b b-ghost" id="mls-ap-undo" data-tip="Undo the last text the agent typed into a field">↩ Undo</button></div>' +
          '<label class="row" style="display:flex;align-items:center;gap:6px;margin-top:9px;font-size:12px;color:#8a5a00"><input type="checkbox" id="mls-ap-save" style="width:auto;flex:none"> Let it click Save / Sign on its own (only while watching)</label>' +
        '</div>' +
      '</div>';
    body.appendChild(wrap);
    // toggles for the two collapsibles
    (function () {
      var tg = wrap.querySelector('#mls-ap-toggle'), apw = wrap.querySelector('#mls-ap-wrap'), car = wrap.querySelector('#mls-ap-caret');
      if (tg) tg.addEventListener('click', function () { var open = apw.style.display === 'none'; apw.style.display = open ? 'block' : 'none'; if (car) car.style.transform = open ? 'rotate(90deg)' : 'none'; });
      var mt = wrap.querySelector('#mls-ap-more-toggle'), mm = wrap.querySelector('#mls-ap-more');
      if (mt) mt.addEventListener('click', function () { var open = mm.style.display === 'none'; mm.style.display = open ? 'block' : 'none'; mt.textContent = open ? '－ Fewer options' : '＋ More options'; });
    })();
    const goalI = wrap.querySelector('#mls-ap-goal'), runB = wrap.querySelector('#mls-ap-run'), stopB = wrap.querySelector('#mls-ap-stop');
    const send = (type, extra) => new Promise(res => chrome.runtime.sendMessage(Object.assign({ type }, extra || {}), res));
    let running = false;
    let lastTypeTarget = null;
    function findEl(target) {
      if (!target) return null;
      try { const el = document.querySelector(target); if (el) return el; } catch (e) {}
      const t = String(target).toLowerCase().trim();
      const cand = [...document.querySelectorAll('button,a,[role=button],input[type=submit],input[type=button],label,[onclick]')];
      return cand.find(e => ((e.innerText || e.value || e.getAttribute('aria-label') || '')).toLowerCase().trim().includes(t)) || null;
    }
    function typeInto(el, text) {
      el.focus();
      if (el.isContentEditable) { if (!document.execCommand('insertText', false, text)) { el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true })); } }
      else { const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const s = Object.getOwnPropertyDescriptor(p, 'value'); if (s && s.set) s.set.call(el, text); else el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    async function loop() {
      if (running) return;
      const statusEl = wrap.querySelector('#mls-ap-status');
      const setStatus = (m, k) => { if (statusEl) { statusEl.textContent = m || ''; statusEl.style.color = k === 'err' ? '#c0392b' : k === 'ok' ? '#16924e' : '#5a6a7a'; } };
      const uiRun = (on) => { running = on; if (runB) runB.style.display = on ? 'none' : ''; if (stopB) stopB.style.display = on ? '' : 'none'; };
      // Flip to Stop IMMEDIATELY — before anything that could fail or early-return —
      // so the user is never stuck with a dead Start button.
      uiRun(true);
      const goal = (goalI && goalI.value || '').trim();
      if (!goal) { uiRun(false); setStatus('Type what you want it to do first — e.g. “capture this chart into MLS”.', 'err'); try { goalI.focus(); var _ob = goalI.style.borderColor; goalI.style.borderColor = '#c0392b'; setTimeout(function () { goalI.style.borderColor = _ob || ''; }, 2200); } catch (e) {} L('Enter a goal for autopilot, then press Run.'); return; }
      const history = []; var _lastSig = '', _sameN = 0; setStatus('Starting — reading the screen…'); L('Starting — reading the screen…');
      try {
      for (let step = 0; step < 50 && running; step++) {
        setStatus('Working… step ' + (step + 1) + ' — press Stop to cancel.');
        const cap = await send('mlsAssistCapture');
        let pt = await send('mlsAssistPageText');
        let pageText = (pt && pt.text) || '';
        // If the page looks like it is still loading, wait briefly and re-read once before deciding.
        if (pageText.replace(/\s/g, '').length < 40) { await new Promise(r => setTimeout(r, 1300)); pt = await send('mlsAssistPageText'); pageText = (pt && pt.text) || ''; }
        if (!running) break;
        const els = await send('mlsAssistElements');
        const elements = (els && els.list) || [];
        const resp = await send('mlsAssistAgentStep', { goal, pageText, screenshot: (cap && cap.dataUrl) || '', history, elements });
        if (!resp || resp.error) {
          var _em = (resp && resp.error) || 'no response';
          if (/api key|not authenticated|login|bearer|expired|sign in/i.test(_em)) { L('⚠ Not connected. Open MLS (mlsscribe.com) in a tab and sign in — MLS Assist uses your login automatically, no key needed. (You can still paste an API key via the toolbar icon if you prefer.)'); setStatus('Not connected — open MLS and sign in.', 'err'); }
          else { L('Assistant: ' + _em + ' — try again in a moment.'); setStatus('Error: ' + String(_em).slice(0, 70), 'err'); }
          break;
        }
        const a = resp.action || {}; if (resp.reasoning) L('(' + (step + 1) + ') ' + String(resp.reasoning).slice(0, 120));
        history.push({ type: a.type, target: a.target });
        var _sig = (a.type || '') + '|' + (a.target || ''); if (_sig === _lastSig) { _sameN++; } else { _sameN = 0; _lastSig = _sig; }
        if (_sameN >= 3) { L('I seem stuck repeating the same step — stopping so I don’t loop. Try rephrasing the goal, or do that one step yourself.'); break; }
        if (a.type === 'done') { L('✓ Autopilot finished.'); break; }
        if (a.type === 'confirm') {
          var _allow = !!((document.getElementById('mls-ap-save') || {}).checked);
          if (_allow) { const cr = await send('mlsAssistExec', { action: { type: 'click', target: a.target } }); if (cr && cr.ok) { L('✅ ' + cr.msg + ' (Save/Sign allowed)'); await new Promise(function (r) { setTimeout(r, 1000); }); continue; } L('Wanted to commit but ' + ((cr && cr.msg) || 'failed') + ' — paused.'); break; }
          L('⚠ Agent wants to commit ("' + (a.target || '') + '"). Tick "Let it click Save/Sign" to allow, or do it yourself — paused.'); break;
        }
        if (a.type === 'ask') { L('Agent needs you: ' + (a.target || a.reasoning || '')); break; }
        if (a.type === 'switchtab') { const sr = await send('mlsAssistExec', { action: a }); L((sr && sr.ok) ? ('\u21B9 ' + sr.msg) : ('Could not switch tab: ' + ((sr && sr.msg) || ''))); await new Promise(function (r) { setTimeout(r, 1200); }); continue; }
        if (a.type === 'capturechart') {
          var ptc = await send('mlsAssistPageText');
          var ex = await send('mlsAssistExtract', { pageText: (ptc && ptc.text) || '' });
          L((ex && ex.ok) ? ('📋 Captured ' + (ex.patient || 'patient') + ' (' + (ex.visits || 0) + ' visits) into MLS') : ('Capture: ' + ((ex && ex.error) || 'no patient found on this screen')));
          await new Promise(function (r) { setTimeout(r, 1000); }); continue;
        }
        if (a.type === 'pastenote') {
          var nb = document.getElementById('mls-note');
          var note = (nb && nb.value || '').trim();
          if (!note) { L('No drafted note to paste — Generate one in MLS Assist first.'); break; }
          var pr = await send('mlsAssistExec', { action: { type: 'pastenote', text: note } });
          L((pr && pr.msg) || 'Pasted the note.');
          await new Promise(function (r) { setTimeout(r, 1000); }); continue;
        }
        let er = await send('mlsAssistExec', { action: a });
        // Retry only when the control wasn't FOUND yet (async render) — scroll + retry once.
        // Do NOT retry a "stuck" type (field found but rejected the text): re-typing into a
        // typeahead/masked field never helps.
        if (er && er.ok === false && er.notfound && /^(click|select|type)$/.test(a.type || '')) { await send('mlsAssistExec', { action: { type: 'scroll' } }); await new Promise(r => setTimeout(r, 650)); er = await send('mlsAssistExec', { action: a }); }
        if (a.type === 'type' && er && er.ok) lastTypeTarget = a.target;
        // STOP (don't loop) when typing/pasting genuinely won't stick — clear failure, hand back to the doctor.
        if (/^(type|pastenote)$/.test(a.type || '') && er && er.ok === false && er.stuck) {
          L('⛔ ' + ((er && er.msg) || 'Could not type into the field — it would not accept the text.') + ' Stopping here so I don’t loop. Type it yourself, then press Run to continue.');
          setStatus('Couldn’t type into ' + (a.target || 'a field') + ' — please type it manually, then Run.', 'err');
          break;
        }
        L((er && er.msg) ? er.msg : ('Did: ' + (a.type || '')));
        await new Promise(r => setTimeout(r, /^(click|select|switchtab)$/.test(a.type || '') ? 1500 : 800));
      }
      if (running) setStatus('Reached the step limit — press Run to continue.', 'ok');
      } catch (e) {
        L('Autopilot hit an error: ' + ((e && e.message) || e));
        setStatus('Stopped after an error — press Run to try again.', 'err');
      } finally {
        uiRun(false);
      }
    }
    runB.addEventListener('click', function () { try { loop(); } catch (e) { try { runB.style.display = ''; stopB.style.display = 'none'; running = false; } catch (e2) {} } });
    stopB.addEventListener('click', function () { running = false; if (runB) runB.style.display = ''; if (stopB) stopB.style.display = 'none'; var _s = wrap.querySelector('#mls-ap-status'); if (_s) { _s.textContent = 'Stopped.'; _s.style.color = '#16924e'; } L('Stopped by you.'); });
    (function () {
      var micB = wrap.querySelector('#mls-ap-mic'); if (!micB) return;
      var SRx = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SRx) { micB.disabled = true; micB.textContent = '🎤 (no voice)'; return; }
      var arec = null, aon = false;
      micB.addEventListener('click', function () {
        if (aon) { try { arec.stop(); } catch (e) {} return; }
        arec = new SRx(); arec.lang = 'en-US'; arec.interimResults = true; arec.continuous = false;
        var base = goalI.value;
        arec.onresult = function (e) { var t = ''; for (var i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript; goalI.value = (base ? base + ' ' : '') + t; };
        arec.onerror = function () { aon = false; micB.textContent = '🎤 Speak'; };
        arec.onend = function () { aon = false; micB.textContent = '🎤 Speak'; };
        try { arec.start(); aon = true; micB.textContent = '⏹ Listening…'; } catch (e) {}
      });
    })();
    function pbGet() { try { return JSON.parse(localStorage.getItem('mls_playbooks') || '[]') || []; } catch (e) { return []; } }
    function pbSet(a) { try { localStorage.setItem('mls_playbooks', JSON.stringify(a.slice(0, 12))); } catch (e) {} }
    function pbRender() {
      var box = wrap.querySelector('#mls-ap-pbs'); if (!box) return;
      var a = pbGet(); box.innerHTML = '';
      a.forEach(function (g, i) {
        var chip = document.createElement('span'); chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#eef4fc;border:1px solid #cfe0f3;border-radius:999px;padding:3px 4px 3px 9px;font-size:12px;max-width:100%';
        var run = document.createElement('button'); run.textContent = '▶ ' + (g.length > 26 ? g.slice(0, 26) + '…' : g); run.title = g; run.style.cssText = 'background:none;border:none;color:#1f7ae0;font:inherit;cursor:pointer;padding:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        run.addEventListener('click', function () { goalI.value = g; loop(); });
        var del = document.createElement('button'); del.textContent = '✕'; del.title = 'Remove'; del.style.cssText = 'background:none;border:none;color:#9aa7b4;font:inherit;cursor:pointer;padding:0 2px';
        del.addEventListener('click', function (ev) { ev.stopPropagation(); var arr = pbGet(); arr.splice(i, 1); pbSet(arr); pbRender(); });
        chip.appendChild(run); chip.appendChild(del); box.appendChild(chip);
      });
    }
    var savepb = wrap.querySelector('#mls-ap-savepb');
    if (savepb) savepb.addEventListener('click', function () { var g = goalI.value.trim(); if (!g) { L('Type or speak a goal first, then save it.'); return; } var a = pbGet(); if (a.indexOf(g) === -1) { a.unshift(g); pbSet(a); pbRender(); L('Saved playbook.'); } });
    pbRender();
    var undoB = wrap.querySelector('#mls-ap-undo');
    if (undoB) undoB.addEventListener('click', async function () {
      if (!lastTypeTarget) { L('Nothing to undo yet.'); return; }
      var er = await send('mlsAssistExec', { action: { type: 'type', target: lastTypeTarget, text: '' } });
      L((er && er.ok) ? ('Cleared: ' + lastTypeTarget) : ('Could not undo: ' + ((er && er.msg) || '')));
      lastTypeTarget = null;
    });
    var recOn = false, recSteps = [];
    var recB = wrap.querySelector('#mls-ap-rec');
    function elSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return '';
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return '#' + el.id;
      if (el.getAttribute && el.getAttribute('name')) return el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]';
      var txt = (el.innerText || el.value || '').trim();
      if (txt && txt.length < 40 && /^(BUTTON|A|LABEL)$/.test(el.tagName)) return txt;
      var s = el.tagName.toLowerCase();
      if (typeof el.className === 'string' && el.className.trim()) { var cl = el.className.trim().split(/\s+/)[0].replace(/[^\w-]/g, ''); if (cl) s += '.' + cl; }
      return s;
    }
    function fieldLabel(el) {
      try {
        if (el.getAttribute) {
          var al = el.getAttribute('aria-label'); if (al) return al.trim();
          var ph = el.getAttribute('placeholder'); if (ph) return ph.trim();
          if (el.id) { var lab = document.querySelector('label[for="' + el.id + '"]'); if (lab && lab.textContent) return lab.textContent.trim().slice(0, 50); }
        }
        var p = el.closest && el.closest('label'); if (p) { var t = p.textContent.replace(el.value || '', '').trim(); if (t) return t.slice(0, 50); }
        var nm = el.getAttribute && el.getAttribute('name'); if (nm) return nm;
      } catch (e) {}
      return (el.tagName || 'field').toLowerCase();
    }
    function stepDesc(type, el, text) {
      if (type === 'click') return 'Click "' + ((el.innerText || el.value || fieldLabel(el)) || '').trim().replace(/\s+/g, ' ').slice(0, 50) + '"';
      if (type === 'type') return 'Type "' + String(text || '').slice(0, 40) + '" into the "' + fieldLabel(el) + '" field';
      if (type === 'select') return 'Choose "' + String(text || '').slice(0, 40) + '" in the "' + fieldLabel(el) + '" dropdown';
      return type;
    }
    function recPush(type, el, text) {
      if (!recOn || !el || panel.contains(el)) return;
      var target = elSelector(el); if (!target) return;
      recSteps.push({ type: type, target: target, text: text || '', desc: stepDesc(type, el, text) });
      if (recB) recB.textContent = '⏹ Stop (' + recSteps.length + ')';
    }
    function recClick(e) { var el = (e.target && e.target.closest) ? (e.target.closest('button,a,[role=button],input[type=submit],input[type=button],[onclick],label') || e.target) : e.target; if (el && el.tagName === 'SELECT') return; recPush('click', el); }
    function recChange(e) { var el = e.target; if (!el) return; if (el.tagName === 'SELECT') recPush('select', el, (el.options[el.selectedIndex] || {}).text || ''); else if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) recPush('type', el, el.value); }
    function recStart() { recOn = true; recSteps = []; document.addEventListener('click', recClick, true); document.addEventListener('change', recChange, true); if (recB) recB.textContent = '⏹ Stop (0)'; L('Recording — do your task, then press Stop.'); }
    function recStop() {
      recOn = false; document.removeEventListener('click', recClick, true); document.removeEventListener('change', recChange, true);
      if (recB) recB.textContent = '⏺ Record a task';
      if (!recSteps.length) { L('Nothing was recorded.'); return; }
      var name = prompt('Name this recorded task:', 'Task ' + (mrGet().length + 1));
      if (name === null) { L('Recording discarded.'); return; }
      var a = mrGet(); a.unshift({ name: String(name).slice(0, 40) || 'Task', steps: recSteps.slice() }); mrSet(a); mrRender();
      L('Saved recording (' + recSteps.length + ' steps).');
    }
    if (recB) recB.addEventListener('click', function () { recOn ? recStop() : recStart(); });
    function mrGet() { try { return JSON.parse(localStorage.getItem('mls_recordings') || '[]') || []; } catch (e) { return []; } }
    function mrSet(a) { try { localStorage.setItem('mls_recordings', JSON.stringify(a.slice(0, 12))); } catch (e) {} }
    async function mrReplay(steps) {
      L('▶ Replaying ' + steps.length + ' steps (smart/adaptive)…'); running = true; runB.style.display = 'none'; stopB.style.display = '';
      for (var i = 0; i < steps.length && running; i++) {
        var s = steps[i];
        var er = await send('mlsAssistExec', { action: s });
        if (!er || er.ok === false) {
          L('  ' + (i + 1) + '. page changed — adapting: ' + (s.desc || s.type));
          var cap = await send('mlsAssistCapture');
          var pt = await send('mlsAssistPageText');
          var resp = await send('mlsAssistAgentStep', { goal: 'Do exactly this ONE UI step on the current screen and nothing else: ' + (s.desc || (s.type + ' ' + s.target)), pageText: (pt && pt.text) || '', screenshot: (cap && cap.dataUrl) || '', history: [] });
          if (resp && resp.action && resp.action.type && resp.action.type !== 'ask' && resp.action.type !== 'done') {
            er = await send('mlsAssistExec', { action: resp.action });
            L('     \u21B3 ' + ((er && er.msg) || 'adapted') + (resp.reasoning ? (' — ' + String(resp.reasoning).slice(0, 60)) : ''));
          } else {
            L('     \u21B3 could not adapt this step.');
          }
        } else {
          L('  ' + (i + 1) + '. ' + ((er && er.msg) || s.type));
        }
        await new Promise(function (r) { setTimeout(r, 900); });
      }
      running = false; runB.style.display = ''; stopB.style.display = 'none'; L('\u2713 Replay finished.');
    }
    function mrRender() {
      var box = wrap.querySelector('#mls-ap-recs'); if (!box) return; var a = mrGet(); box.innerHTML = '';
      a.forEach(function (rec, i) {
        var chip = document.createElement('span'); chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#eef9f1;border:1px solid #bfe6cf;border-radius:999px;padding:3px 4px 3px 9px;font-size:12px';
        var run = document.createElement('button'); run.textContent = '🎬 ' + rec.name; run.title = 'Replay (' + rec.steps.length + ' steps)'; run.style.cssText = 'background:none;border:none;color:#1c7a43;font:inherit;cursor:pointer;padding:0;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        run.addEventListener('click', function () { mrReplay(rec.steps); });
        var del = document.createElement('button'); del.textContent = '✕'; del.title = 'Remove'; del.style.cssText = 'background:none;border:none;color:#9aa7b4;font:inherit;cursor:pointer;padding:0 2px';
        del.addEventListener('click', function (ev) { ev.stopPropagation(); var arr = mrGet(); arr.splice(i, 1); mrSet(arr); mrRender(); });
        chip.appendChild(run); chip.appendChild(del); box.appendChild(chip);
      });
    }
    mrRender();
  }
})();
/* MLS Assist content.js — v1.17 schedule-pull build */

/* === MLS Assist v1.35 — Copy-every-visit bridge (APPEND-ONLY to content.js) ===
 * Self-contained. Adds its own message listeners; does not touch the existing
 * bridge router. Relays the app's mlsAppReadAllVisits request to background and
 * streams mlsAppVisitsProgress / mlsAppAllVisitsResult back to the page. */
(function () {
  'use strict';
  try { if (window.__mlsAllVisitsBridge) return; window.__mlsAllVisitsBridge = 1; } catch (e) { return; }
  var activeOrigin = '', activeUntil = 0;
  function trusted(origin) {
    if (!origin || typeof origin !== 'string') return false;
    try {
      var u = new URL(origin);
      if (u.protocol === 'https:' && (u.hostname === 'mlsscribe.com' || u.hostname === 'www.mlsscribe.com' || u.hostname.endsWith('.mlsscribe.com'))) return true;
    } catch (e) {}
    return false;
  }
  function post(origin, type, payload) {
    try { window.postMessage(Object.assign({ source: 'mls-ext', type: type }, payload || {}), origin); } catch (e) {}
  }
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data; if (!d || d.type !== 'mlsAppReadAllVisits' || d.source !== 'mls-app' || !trusted(ev.origin)) return;
    var origin = ev.origin;
    activeOrigin = origin; activeUntil = Date.now() + 300000;
    try {
      chrome.runtime.sendMessage({ type: 'mlsAppAllVisitsRequest', hint: d.hint || {} }, function (res) {
        var err = chrome.runtime && chrome.runtime.lastError;
        if (err || !res) { post(origin, 'mlsAppAllVisitsResult', { ok: false, error: (err && err.message) || 'No response from MLS Assist' }); return; }
        var out = {}; for (var k in res) out[k] = res[k]; out.type = 'mlsAppAllVisitsResult';
        post(origin, 'mlsAppAllVisitsResult', out);
      });
    } catch (e) { post(origin, 'mlsAppAllVisitsResult', { ok: false, error: String((e && e.message) || e) }); }
  }, false);
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'mlsAppVisitsProgress') {
        if (activeOrigin && Date.now() < activeUntil) post(activeOrigin, 'mlsAppVisitsProgress', { message: msg.message, n: msg.n, total: msg.total });
      }
    });
  } catch (e) {}
})();

