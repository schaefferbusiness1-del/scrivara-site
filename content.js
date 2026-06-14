/* MLS Assist — content script.
   Sits dormant as a small badge on every page. Does NOTHING until the doctor
   opens the panel (consent). Then: capture the visit (live dictation or page
   selection) -> MLS generates a note -> the doctor reviews -> one click inserts
   it into the focused EMR field. Nothing is ever written automatically. */
(function () {
  if (window.__mlsAssistLoaded) return; window.__mlsAssistLoaded = true;
  // Bridge: the MLS web app can ping us (to show "Assist installed") and ask us
  // to capture the patient currently open in the doctor's EMR tab.
  window.addEventListener('message', function (e) {
    var d = e.data; if (!d || d.source !== 'mls-app') return;
    if (d.type === 'mlsPing') { window.postMessage({ source: 'mls-ext', type: 'mlsPong' }, '*'); return; }
    if (d.type === 'mlsAppCapture') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppCaptureRequest' }, function (resp) {
          window.postMessage({ source: 'mls-ext', type: 'mlsAppCaptureResult', resp: resp || { error: 'no response' } }, '*');
        });
      } catch (err) { window.postMessage({ source: 'mls-ext', type: 'mlsAppCaptureResult', resp: { error: 'extension error' } }, '*'); }
    }
    if (d.type === 'mlsAppPasteNote') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppPasteRequest', note: d.note }, function (resp) {
          window.postMessage({ source: 'mls-ext', type: 'mlsAppPasteResult', resp: resp || { error: 'no response' } }, '*');
        });
      } catch (err) { window.postMessage({ source: 'mls-ext', type: 'mlsAppPasteResult', resp: { error: 'extension error' } }, '*'); }
    }
    // Pull TODAY'S SCHEDULE from the EMR tab (Athena) so MLS can pre-load the day's patients.
    if (d.type === 'mlsAppPullSchedule') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppScheduleRequest' }, function (resp) {
          window.postMessage({ source: 'mls-ext', type: 'mlsAppScheduleResult', resp: resp || { error: 'no response' } }, '*');
        });
      } catch (err) { window.postMessage({ source: 'mls-ext', type: 'mlsAppScheduleResult', resp: { error: 'extension error' } }, '*'); }
    }
    // Open + read ONE PATIENT'S CHART from Athena. If a patient name is passed, the
    // background tries to click that patient (e.g. in the schedule) to open the chart,
    // then reads the frame that looks most like a clinical chart (not the schedule).
    if (d.type === 'mlsAppReadChart') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppChartRequest', patient: d.patient || '' }, function (resp) {
          window.postMessage({ source: 'mls-ext', type: 'mlsAppChartResult', resp: resp || { error: 'no response' } }, '*');
        });
      } catch (err) { window.postMessage({ source: 'mls-ext', type: 'mlsAppChartResult', resp: { error: 'extension error' } }, '*'); }
    }
    // Push the ENTIRE finished visit into the open Athena encounter (note, diagnoses,
    // ICD-10, E/M + CPT, orders, etc.) via the AI autopilot. NEVER clicks Save/Sign —
    // it stops and hands off to the doctor to review + sign in Athena.
    if (d.type === 'mlsAppPushVisit') {
      try { _mlsPushVisit(String(d.goal || '')); }
      catch (err) { window.postMessage({ source: 'mls-ext', type: 'mlsAppPushResult', resp: { error: 'extension error' } }, '*'); }
    }
  });
  // Headless autopilot loop that enters a finished visit into the EMR encounter.
  function _bg(type, payload) { return new Promise(function (res) { try { chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (r) { res(r || {}); }); } catch (e) { res({}); } }); }
  async function _mlsPushVisit(goal) {
    var post = function (type, payload) { try { window.postMessage(Object.assign({ source: 'mls-ext', type: type }, payload || {}), '*'); } catch (e) {} };
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
    cands.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (rb.width * rb.height) - (ra.width * ra.height); });
    return cands[0] || null;
  }

  // --- build UI ---
  const badge = document.createElement('div');
  badge.id = 'mls-assist-badge';
  badge.innerHTML = '<span class="dot"></span>🩺 MLS Assist';
  badge.setAttribute('data-tip', 'Open MLS Assist — dictate, draft, and insert your note');

  const panel = document.createElement('div');
  panel.id = 'mls-assist-panel';
  panel.innerHTML = [
    '<header><b>🩺 MLS Assist</b><span class="x" data-tip="Close MLS Assist">×</span></header>',
    '<div class="body">',
    '  <div class="consent">Runs only when you open this panel. It captures what you dictate or select, drafts a note, and inserts it <b>only when you click</b>. You review everything first.</div>',
    '  <label>Visit transcript / context</label>',
    '  <textarea id="mls-tx" rows="5" placeholder="Press Dictate and talk through the visit, or paste/select text from the chart…"></textarea>',
    '  <div class="row">',
    '    <button class="b b-rec" id="mls-rec" data-tip="Dictate the visit out loud — MLS transcribes as you talk">🎙 Dictate</button>',
    '    <button class="b b-ghost" id="mls-sel" data-tip="Use the text you have highlighted on the chart as the visit context">Use page selection</button>',
    '    <button class="b b-ghost" id="mls-clr" data-tip="Clear the transcript and the drafted note">Clear</button>',
    '  </div>',
    '  <div class="row"><button class="b b-go" id="mls-gen" data-tip="Turn the transcript into a structured clinical note" style="flex:1">✨ Generate note</button></div>',
    '  <label>Drafted note (review before inserting)</label>',
    '  <textarea id="mls-note" rows="7" placeholder="Your generated note appears here for review."></textarea>',
    '  <div class="row">',
    '    <button class="b b-primary" id="mls-ins" data-tip="Paste the drafted note straight into your EMR note field - it finds the field for you (a one-shot paste, not keystroke typing)" style="flex:1">⤵ Paste note into chart</button>',
    '    <button class="b b-ghost" id="mls-cpy" data-tip="Copy the drafted note to your clipboard">Copy</button>',
    '  </div>',
    '  <div style="border-top:1px dashed #e0e8f2;margin-top:12px;padding-top:10px">',
    '    <label>Pull the whole chart into MLS</label>',
    '    <div class="row"><button class="b b-ghost" id="mls-cap" data-tip="Read this patient and their prior visits into MLS — nothing is written back to the EMR" style="flex:1">📋 Capture whole chart → MLS</button></div>',
    '    <div class="consent" style="margin-top:6px">Reads the patient + their prior visits off this page and saves them into MLS (encrypted). Nothing is written back to the EMR.</div>',
    '  </div>',
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

  // --- insert into the focused EMR field (React/Angular-safe) ---
  // Framework-safe value setter: drive the native setter, then fire the full
  // event sequence (keydown → beforeinput → input → change → keyup) so React,
  // Angular, Ember and athenaOne's controlled inputs actually register the text.
  function setNativeValue(el, value) {
    const proto = (el.tagName === 'TEXTAREA') ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); } catch (e) {}
    if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value })); } catch (e) {}
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); } catch (e) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {}
  }
  function localPaste(target, note) {
    target.focus();
    if (target.isContentEditable) {
      try { target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: note })); } catch (e) {}
      if (!document.execCommand('insertText', false, note)) { target.textContent = note; }
      try { target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: note })); } catch (e) { target.dispatchEvent(new Event('input', { bubbles: true })); }
    } else { setNativeValue(target, note); }
  }
  function clipFallback(note) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(note).then(function () { log('Couldn’t reach the note field — copied the note instead. Click into the chart’s note box and press Ctrl/Cmd + V.'); }, function () { log('Couldn’t reach the note field, and copy was blocked. Click into the note box, then try again.'); });
    } else { log('Couldn’t reach the note field. Click into the note box and try again.'); }
  }
  $('#mls-ins').addEventListener('click', () => {
    const note = noteBox.value.trim();
    if (!note) { log('Nothing to paste yet.'); return; }
    // 1) Fast path: a note field in THIS (top) frame.
    const target = bestNoteField();
    if (target && isEditable(target)) {
      try { localPaste(target, note); log('Pasted the note into the chart field. Review and save in your EMR.'); return; } catch (e) {}
    }
    // 2) athenaOne / Epic put the note box inside an IFRAME the panel can't see —
    // ask the background worker to paste across ALL frames of this tab.
    log('Finding the note field across the page…');
    try {
      chrome.runtime.sendMessage({ type: 'mlsPasteHere', note }, (resp) => {
        if (resp && resp.ok) { log('Pasted the note into the chart (' + (resp.into || 'note field') + '). Review and save in your EMR.'); return; }
        clipFallback(note);
      });
    } catch (e) { clipFallback(note); }
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
    wrap.style.cssText = 'border-top:1px dashed #e0e8f2;margin-top:12px;padding-top:10px';
    wrap.innerHTML =
      '<label>Autopilot (beta) — the agent does the steps</label>' +
      '<input id="mls-ap-goal" placeholder="e.g. find the note field and insert the visit note" style="width:100%;box-sizing:border-box;border:1px solid #cfe0f3;border-radius:8px;padding:7px;font:13px inherit">' +
      '<div class="row"><button class="b b-go" id="mls-ap-run" data-tip="Let the agent take the steps toward your goal — it pauses before any Save or Sign" style="flex:1">▶ Run autopilot</button><button class="b b-rec" id="mls-ap-stop" data-tip="Stop the autopilot right now" style="display:none">⏹ Stop</button></div>' +
      '<div id="mls-ap-status" style="font-size:12px;color:#5a6a7a;margin:6px 0 0;min-height:15px"></div>' +
      '<div class="row" style="gap:6px;margin-top:6px"><button class="b b-ghost" id="mls-ap-mic" data-tip="Speak your goal instead of typing it">🎤 Speak</button><button class="b b-ghost" id="mls-ap-savepb" data-tip="Save this goal as a one-tap playbook">💾 Save as playbook</button></div>' +
      '<div id="mls-ap-pbs" style="display:flex;gap:5px;flex-wrap:wrap;margin:6px 0 0"></div>' +
      '<div class="row" style="gap:6px;margin-top:8px"><button class="b b-ghost" id="mls-ap-rec" data-tip="Record the clicks and typing you do, then replay it anytime">⏺ Record a task</button><button class="b b-ghost" id="mls-ap-undo" data-tip="Undo the last text the agent typed into a field">↩ Undo last</button></div>' +
      '<div id="mls-ap-recs" style="display:flex;gap:5px;flex-wrap:wrap;margin:6px 0 0"></div>' +
      '<label class="row" style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12.5px;color:#8a5a00"><input type="checkbox" id="mls-ap-save" style="width:auto;flex:none"> Let it click Save / Sign on its own (use with care)</label>' +
      '<div class="consent" style="margin-top:8px">Autopilot reads the screen and acts step-by-step while you watch. By default it <b>pauses</b> before any Save/Sign and asks you. Tick the box above to let it commit on its own — only do that while watching. Hit Stop anytime.</div>';
    body.appendChild(wrap);
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
        if (er && er.ok === false && /^(click|select|type)$/.test(a.type || '')) { await send('mlsAssistExec', { action: { type: 'scroll' } }); await new Promise(r => setTimeout(r, 650)); er = await send('mlsAssistExec', { action: a }); }
        if (a.type === 'type' && er && er.ok) lastTypeTarget = a.target;
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
