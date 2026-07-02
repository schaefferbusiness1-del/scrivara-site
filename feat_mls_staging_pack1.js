/* ============================================================================
 * feat_mls_staging_pack1.js  ->  window.__mlsPack1   (v1.0.1)   [item80]
 *
 * Three NEW features, staging-first (Michael picks what promotes to prod):
 *
 *  S1  TEMPLATES SUITE - a toolbar above "Saved templates":
 *        - Upload templates (multi-file; .txt/.md and other text files; AI
 *          cleans each into a named template with [FILL: ...] slots)
 *        - Upload a FOLDER of templates (reads every text file inside)
 *        - Starter pack: 6 quality spine/pain op-note templates, one click
 *        - Delete ALL templates (typed confirmation + one-click restore of
 *          the automatic backup) - touches TEMPLATES ONLY, never patients
 *        - "Add standard line" relocated to the BOTTOM of the Templates tab
 *        - "Always add my standard lines" toggle (persists; applies the
 *          existing standard-line engine after each generation)
 *        - Upload button also appears in the Prep-op-note modal header.
 *  S2  SIMPLE MODE - a dictation "tunnel": one thing at a time
 *        (Who -> Talk -> Generate -> Review -> Finish), big buttons, voice
 *        input for the patient line, drives the app's REAL controls.
 *        Never writes to Athena; never signs.
 *  S3  MLS AGENT - a side chat dock that plans + runs multi-step jobs from
 *        plain English ("prep all my op notes for tomorrow"), using ONLY a
 *        whitelisted action registry (open views, pull via the real button,
 *        prep op notes for a day, list a day, set active patient, starter
 *        templates, open tunnel, fill blanks). Writeback/sign/delete are
 *        deliberately NOT in the registry. Honest per-step results.
 *
 * GUARDRAILS: additive & reversible (window.__mlsPack1.revert()); reuses the
 * app's own functions; no autonomous Athena writes; no deletes of patient
 * data; honest failures. STAGING ONLY until Michael promotes.
 * ==========================================================================*/
;(function () {
  'use strict';
  try { if (window.__mlsPack1 && window.__mlsPack1.installed) return; } catch (e) { return; }
  var P = { installed: true, v: '1.0.1', feats: {}, _ivs: [], _nodes: [], _orig: {} };
  window.__mlsPack1 = P;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function remember(n) { if (n) P._nodes.push(n); return n; }
  function addStyle(id, css) { if ($(id)) return; var st = document.createElement('style'); st.id = id; st.textContent = css; document.head.appendChild(st); remember(st); }
  function safeToast(m, k) { try { if (typeof toast === 'function') toast(m, k || ''); } catch (e) {} }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function isoPlus(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function dayLabel(iso) { try { return new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); } catch (e) { return iso; } }
  function apptDate(a) { if (!a) return ''; if (a.appt_date) return String(a.appt_date).slice(0, 10); try { if (a.start_at) { var d = new Date(a.start_at); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); } } catch (e) {} return ''; }
  function apptsOn(iso) { try { return (window._calAppts || []).filter(function (a) { return apptDate(a) === iso; }); } catch (e) { return []; } }
  function findBtnByText(rx, root) {
    var list = (root || document).querySelectorAll('button, [role="button"], .btn, a');
    for (var i = 0; i < list.length; i++) { var el = list[i]; if (el.offsetParent && rx.test((el.textContent || '').trim())) return el; }
    return null;
  }
  function ai(sys, user) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof aiCallRaw !== 'function') { reject(new Error('AI helper not available on this page.')); return; }
        var key = ''; try { key = (typeof getKey === 'function') ? getKey() : ''; } catch (e) {}
        Promise.resolve(aiCallRaw(sys, user, key, { freeform: true })).then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }
  function parseJsonLoose(s) {
    s = String(s || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) {}
    var m = s.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
    return null;
  }

  /* ==================================================================== S1
   * TEMPLATES SUITE
   * ==================================================================== */
  try {
    addStyle('mlsP1TplStyle',
      '#mlsP1TplBar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0;padding:10px 12px;border:1px solid var(--line,#d8e1ec);border-radius:12px;background:var(--card,#fff)}' +
      '#mlsP1TplBar .p1-b{border:0;border-radius:9px;padding:8px 13px;font-size:12.5px;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#0d3c78,#2168c9);color:#fff}' +
      '#mlsP1TplBar .p1-b.ghost{background:rgba(33,104,201,.1);color:#0d3c78}' +
      '#mlsP1TplBar .p1-b.danger{background:#8f1d2c}' +
      '#mlsP1TplLog{font-size:11.5px;opacity:.8;width:100%;max-height:90px;overflow:auto}' +
      '#mlsP1AlwaysWrap{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--ink,#15243a)}');

    var STARTERS = [
      ['Lumbar TFESI (transforaminal epidural steroid injection)', 'OPERATIVE REPORT\nPROCEDURE: [FILL: side] L[FILL: level] transforaminal epidural steroid injection under fluoroscopy\nINDICATION: [FILL: radicular pain distribution]\nCONSENT: Obtained; risks/benefits/alternatives discussed.\nANESTHESIA: Local - [FILL: local anesthetic + volume]\nTECHNIQUE: Patient prone. Skin prepped/draped sterilely. Under fluoroscopic guidance a [FILL: needle gauge] spinal needle advanced to the [FILL: side] L[FILL: level] neuroforamen. Position confirmed in AP/oblique/lateral views with [FILL: contrast volume] contrast demonstrating appropriate epidural flow without vascular uptake.\nINJECTATE: [FILL: steroid + dose] with [FILL: anesthetic + volume].\nFLUORO TIME: [FILL: minutes].\nCOMPLICATIONS: None immediate.\nDISPOSITION: Recovered, discharged with instructions; follow-up [FILL: interval].'],
      ['Interlaminar ESI', 'OPERATIVE REPORT\nPROCEDURE: Interlaminar epidural steroid injection at [FILL: level]\nCONSENT: Obtained.\nANESTHESIA: Local - [FILL: agent/volume]\nTECHNIQUE: Prone position, sterile prep. Loss-of-resistance technique at [FILL: level] with a [FILL: gauge] Tuohy needle. Epidurogram with [FILL: contrast volume] confirmed epidural spread, no vascular/intrathecal pattern.\nINJECTATE: [FILL: steroid + dose] in [FILL: diluent + volume].\nFLUORO TIME: [FILL: minutes].\nCOMPLICATIONS: None immediate.\nDISPOSITION: Stable to recovery; standard post-procedure instructions.'],
      ['Medial branch block (MBB)', 'OPERATIVE REPORT\nPROCEDURE: [FILL: side] medial branch blocks at [FILL: levels]\nINDICATION: Facet-mediated axial pain.\nCONSENT: Obtained.\nTECHNIQUE: Prone, sterile prep/drape. Under fluoroscopy, [FILL: gauge] needles positioned at the junction of the superior articular process and transverse process at each target level. Negative aspiration at each site.\nINJECTATE PER SITE: [FILL: anesthetic + volume per level].\nFLUORO TIME: [FILL: minutes].\nCOMPLICATIONS: None immediate.\nPLAN: Pain diary; consider RFA if >=80% concordant relief.'],
      ['Radiofrequency ablation (RFA)', 'OPERATIVE REPORT\nPROCEDURE: [FILL: side] radiofrequency ablation of the medial branches at [FILL: levels]\nCONSENT: Obtained.\nANESTHESIA: Local + [FILL: sedation if any]\nTECHNIQUE: Prone, sterile technique. RF cannulae ([FILL: gauge/tip]) positioned parallel to each target medial branch. Motor/sensory stimulation testing satisfactory at each level ([FILL: thresholds]). Lesions at [FILL: temperature] for [FILL: seconds] per level after [FILL: anesthetic] pre-lesion.\nFLUORO TIME: [FILL: minutes].\nCOMPLICATIONS: None immediate.\nDISPOSITION: Discharged with RFA aftercare instructions.'],
      ['Sacroiliac joint injection', 'OPERATIVE REPORT\nPROCEDURE: [FILL: side] sacroiliac joint injection under fluoroscopy\nCONSENT: Obtained.\nTECHNIQUE: Prone, sterile prep. [FILL: gauge] needle advanced into the inferior SI joint; arthrogram with [FILL: contrast volume] confirmed intra-articular placement.\nINJECTATE: [FILL: steroid + dose] with [FILL: anesthetic + volume].\nFLUORO TIME: [FILL: minutes].\nCOMPLICATIONS: None immediate.\nDISPOSITION: Recovered; follow-up [FILL: interval].'],
      ['Trigger point injections', 'PROCEDURE NOTE\nPROCEDURE: Trigger point injections - [FILL: muscles/regions]\nCONSENT: Obtained.\nTECHNIQUE: Skin cleansed. Taut bands identified by palpation. [FILL: gauge] needle used; each point injected after negative aspiration.\nINJECTATE PER POINT: [FILL: agent + volume]; TOTAL POINTS: [FILL: number].\nCOMPLICATIONS: None immediate.\nPLAN: Stretching program; follow-up [FILL: interval].']
    ];

    function tplGet() { try { return ((typeof getTemplates === 'function' ? getTemplates() : []) || []).slice(); } catch (e) { return []; } }
    function tplSet(arr, announce) {
      try { if (typeof setTemplates === 'function') setTemplates(arr); } catch (e) {}
      try { if (typeof dedupeSavedTemplates === 'function') dedupeSavedTemplates(false); } catch (e) {}
      try { if (typeof renderTemplates === 'function') renderTemplates(); } catch (e) {}
      if (announce) safeToast(announce, 'ok');
    }
    function tplLog(m) { var l = $('mlsP1TplLog'); if (l) { var d = document.createElement('div'); d.textContent = m; l.appendChild(d); l.scrollTop = l.scrollHeight; } }

    function aiCleanTemplate(fileName, raw) {
      var sys = 'You convert a raw uploaded document into ONE reusable clinical note template for a spine/pain practice. Keep the author\'s structure and wording. Replace patient-specific values (names, dates, sides, levels, volumes, doses) with placeholder tokens exactly like [FILL: what goes here]. Output STRICT JSON only: {"name":"short template name","text":"the full template text"}';
      return ai(sys, 'FILE NAME: ' + fileName + '\n\nRAW CONTENT:\n' + String(raw).slice(0, 14000)).then(function (out) {
        var j = parseJsonLoose(out);
        if (j && j.name && j.text) return { name: String(j.name).slice(0, 80), text: String(j.text) };
        return { name: fileName.replace(/\.[a-z0-9]+$/i, ''), text: String(raw) };
      }).catch(function () { return { name: fileName.replace(/\.[a-z0-9]+$/i, ''), text: String(raw) }; });
    }
    function looksTexty(name, content) {
      if (/\.(txt|md|text|rtf|csv|template)$/i.test(name)) return true;
      if (/\.(png|jpe?g|gif|pdf|zip|docx|xlsx|pptx|exe|bin)$/i.test(name)) return false;
      var sample = String(content || '').slice(0, 800); if (!sample) return false;
      var printable = sample.replace(/[^\x20-\x7E\r\n\t -￿]/g, '');
      return printable.length / sample.length > 0.9;
    }
    function ingestFiles(fileList, done) {
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) { done(0, 0); return; }
      var added = 0, skipped = 0, i = 0;
      tplLog('Reading ' + files.length + ' file(s)...');
      (function next() {
        if (i >= files.length) {
          var cur = tplGet();
          tplSet(cur, null);
          done(added, skipped);
          return;
        }
        var f = files[i++];
        if (f.size > 300000) { skipped++; tplLog('- skipped ' + f.name + ' (too large)'); next(); return; }
        if (/\.docx?$/i.test(f.name)) { skipped++; tplLog('- skipped ' + f.name + ' (Word file - save it as .txt and re-upload; Word support is on the roadmap)'); next(); return; }
        var r = new FileReader();
        r.onload = function () {
          var raw = String(r.result || '');
          if (!looksTexty(f.name, raw)) { skipped++; tplLog('- skipped ' + f.name + ' (not a text file)'); next(); return; }
          tplLog('- AI-cleaning ' + f.name + ' ...');
          aiCleanTemplate(f.name, raw).then(function (t) {
            var cur = tplGet();
            cur.push({ name: t.name, text: t.text, created: Date.now(), source: 'upload' });
            tplSet(cur, null);
            added++; tplLog('  saved as "' + t.name + '"');
            next();
          });
        };
        r.onerror = function () { skipped++; next(); };
        r.readAsText(f);
      })();
    }
    function mountTplBar() {
      var list = $('tplList'); if (!list || $('mlsP1TplBar')) return;
      var bar = document.createElement('div');
      bar.id = 'mlsP1TplBar';
      bar.innerHTML =
        '<button class="p1-b" id="mlsP1Up">⬆ Upload templates</button>' +
        '<button class="p1-b" id="mlsP1UpFolder">📁 Upload a folder</button>' +
        '<button class="p1-b ghost" id="mlsP1Starter">✨ Add starter pack (6)</button>' +
        '<button class="p1-b danger" id="mlsP1DelAll">🗑 Delete ALL templates</button>' +
        '<button class="p1-b ghost" id="mlsP1Restore" style="display:none">↩ Restore backup</button>' +
        '<span id="mlsP1AlwaysWrap"><input type="checkbox" id="mlsP1Always"><label for="mlsP1Always">Always add my standard lines to generated notes</label></span>' +
        '<div id="mlsP1TplLog"></div>' +
        '<input type="file" id="mlsP1File" multiple style="display:none">' +
        '<input type="file" id="mlsP1Folder" webkitdirectory directory multiple style="display:none">';
      list.insertAdjacentElement('beforebegin', bar);
      remember(bar);
      $('mlsP1Up').onclick = function () { $('mlsP1File').click(); };
      $('mlsP1UpFolder').onclick = function () { $('mlsP1Folder').click(); };
      $('mlsP1File').onchange = function () { ingestFiles(this.files, function (a, s) { safeToast('Templates: added ' + a + (s ? (', skipped ' + s) : '') + '.', 'ok'); tplLog('Done - added ' + a + ', skipped ' + s + '.'); }); this.value = ''; };
      $('mlsP1Folder').onchange = function () { ingestFiles(this.files, function (a, s) { safeToast('Folder: added ' + a + (s ? (', skipped ' + s) : '') + '.', 'ok'); tplLog('Folder done - added ' + a + ', skipped ' + s + '.'); }); this.value = ''; };
      $('mlsP1Starter').onclick = function () {
        var cur = tplGet(); var names = {}; cur.forEach(function (t) { names[String(t.name || '').toLowerCase()] = 1; });
        var n = 0;
        STARTERS.forEach(function (s) { if (!names[s[0].toLowerCase()]) { cur.push({ name: s[0], text: s[1], created: Date.now(), source: 'starter' }); n++; } });
        tplSet(cur, 'Added ' + n + ' starter template' + (n === 1 ? '' : 's') + '.');
        tplLog('Starter pack: +' + n);
      };
      $('mlsP1DelAll').onclick = function () {
        var cur = tplGet();
        if (!cur.length) { safeToast('No templates to delete.', ''); return; }
        var typed = window.prompt('This deletes ALL ' + cur.length + ' saved templates (patients and notes are NOT touched).\nA backup is kept for one-click restore.\n\nType DELETE ALL to confirm:');
        if (typed !== 'DELETE ALL') { safeToast('Delete cancelled.', ''); return; }
        try { localStorage.setItem('mlsP1TplBackup', JSON.stringify(cur)); } catch (e) {}
        tplSet([], 'Deleted ' + cur.length + ' templates. Backup saved.');
        $('mlsP1Restore').style.display = 'inline-block';
      };
      $('mlsP1Restore').onclick = function () {
        try {
          var b = JSON.parse(localStorage.getItem('mlsP1TplBackup') || '[]');
          if (!b.length) { safeToast('No backup found.', 'err'); return; }
          tplSet(b, 'Restored ' + b.length + ' templates from backup.');
        } catch (e) { safeToast('Restore failed.', 'err'); }
      };
      try { $('mlsP1Always').checked = localStorage.getItem('mlsP1AlwaysLine') === '1'; } catch (e) {}
      $('mlsP1Always').onchange = function () {
        try { localStorage.setItem('mlsP1AlwaysLine', this.checked ? '1' : '0'); } catch (e) {}
        safeToast(this.checked ? 'Standard lines will be added to every generated note.' : 'Standard lines auto-add turned off.', 'ok');
      };
      /* move the existing "Add standard line" control to the BOTTOM of the templates area */
      try {
        var std = null;
        var cands = document.querySelectorAll('[id*="stdline" i],[id*="stdLine"],[class*="stdline" i]');
        if (cands.length) std = cands[0];
        if (!std) { var btn = findBtnByText(/add (a )?standard line|standard line/i, list.parentElement); if (btn) std = btn.closest('div'); }
        if (std && list.parentElement && std !== bar) { list.parentElement.appendChild(std); std.style.marginTop = '14px'; }
      } catch (e) {}
      tplLog('Templates toolbar ready (staging).');
    }
    var tplIv = setInterval(mountTplBar, 1500); P._ivs.push(tplIv); mountTplBar();

    /* Upload button inside the Prep-op-note modal header */
    function mountOpPrepUpload() {
      var hdr = $('opPrepHdr'); if (!hdr || $('mlsP1OpUp')) return;
      var b = document.createElement('button');
      b.id = 'mlsP1OpUp'; b.type = 'button'; b.textContent = '⬆ Upload templates';
      b.style.cssText = 'margin-left:10px;border:0;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:800;cursor:pointer;background:rgba(255,255,255,.2);color:inherit;border:1px solid rgba(120,150,190,.4)';
      b.onclick = function () { var f = $('mlsP1File'); if (f) f.click(); else safeToast('Open the Templates tab once first.', ''); };
      hdr.appendChild(b); remember(b);
    }
    var opUpIv = setInterval(mountOpPrepUpload, 1800); P._ivs.push(opUpIv);

    /* "always add standard lines": after a generation completes, run the std-line engine */
    if (typeof window.generateNote === 'function' && !window.generateNote.__p1Wrap) {
      P._orig.generateNote = window.generateNote;
      var gWrap = function () {
        var r = P._orig.generateNote.apply(this, arguments);
        var after = function () {
          try {
            if (localStorage.getItem('mlsP1AlwaysLine') !== '1') return;
            var api = window.__mlsStdLineInsert || window.__mlsStdLine;
            if (api && typeof api.applyAll === 'function') { api.applyAll(); safeToast('Standard lines added.', 'ok'); }
            else if (api && typeof api.insert === 'function') { api.insert(); safeToast('Standard line added.', 'ok'); }
          } catch (e) {}
        };
        try { if (r && typeof r.then === 'function') r.then(function () { setTimeout(after, 800); }, function () {}); else setTimeout(after, 2500); } catch (e) {}
        return r;
      };
      gWrap.__p1Wrap = true;
      window.generateNote = gWrap;
    }
    P.feats.templates = true;
  } catch (e) { P.feats.templates = 'error: ' + e.message; }

  /* ==================================================================== S2
   * SIMPLE MODE - THE TUNNEL
   * ==================================================================== */
  try {
    addStyle('mlsP1TunStyle',
      '#mlsP1Tunnel{position:fixed;inset:0;z-index:99998;background:linear-gradient(160deg,#0a2450,#123c7d 55%,#1b5db1);display:none;align-items:center;justify-content:center}' +
      '#mlsP1Tunnel .tn-card{width:640px;max-width:94vw;color:#fff;text-align:center;padding:20px}' +
      '#mlsP1Tunnel .tn-step{font-size:12px;font-weight:800;letter-spacing:1.5px;opacity:.75;text-transform:uppercase}' +
      '#mlsP1Tunnel h2{font-size:30px;margin:10px 0 6px;font-weight:850}' +
      '#mlsP1Tunnel .tn-sub{font-size:14.5px;opacity:.85;margin-bottom:18px}' +
      '#mlsP1Tunnel input,#mlsP1Tunnel textarea{width:100%;box-sizing:border-box;border:0;border-radius:12px;padding:14px 16px;font-size:17px;margin:7px 0;color:#123}' +
      '#mlsP1Tunnel textarea{min-height:150px;font-size:14px;text-align:left}' +
      '#mlsP1Tunnel .tn-big{display:inline-flex;align-items:center;gap:10px;border:0;border-radius:14px;padding:15px 26px;font-size:17px;font-weight:850;cursor:pointer;background:#fff;color:#0d3c78;margin:8px 6px}' +
      '#mlsP1Tunnel .tn-big.rec{background:#e5484d;color:#fff}' +
      '#mlsP1Tunnel .tn-ghost{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.4)}' +
      '#mlsP1Tunnel .tn-nav{margin-top:16px;display:flex;justify-content:space-between;align-items:center}' +
      '#mlsP1Tunnel .tn-nav button{border:0;border-radius:10px;padding:10px 18px;font-weight:800;cursor:pointer;font-size:13.5px}' +
      '#mlsP1Tunnel .tn-status{min-height:22px;font-size:13px;opacity:.9;margin-top:8px}' +
      '#mlsP1TunnelLaunch{border:0;border-radius:11px;padding:9px 15px;font-size:13px;font-weight:800;cursor:pointer;background:#10b981;color:#fff;box-shadow:0 3px 10px rgba(16,185,129,.4)}');
    var tun = { step: 0, name: '', dob: '' };
    function tunEl() { return $('mlsP1Tunnel'); }
    function ensureTunnel() {
      if (tunEl()) return;
      var ov = document.createElement('div');
      ov.id = 'mlsP1Tunnel';
      ov.innerHTML = '<div class="tn-card"><div class="tn-step" id="mlsP1TnStep"></div><h2 id="mlsP1TnTitle"></h2><div class="tn-sub" id="mlsP1TnSub"></div><div id="mlsP1TnBody"></div><div class="tn-status" id="mlsP1TnStatus"></div>' +
        '<div class="tn-nav"><button id="mlsP1TnBack" style="background:rgba(255,255,255,.15);color:#fff">← Back</button><button id="mlsP1TnClose" style="background:rgba(255,255,255,.15);color:#fff">Exit</button><button id="mlsP1TnNext" style="background:#fff;color:#0d3c78">Next →</button></div></div>';
      document.body.appendChild(ov); remember(ov);
      $('mlsP1TnClose').onclick = closeTunnel;
      $('mlsP1TnBack').onclick = function () { if (tun.step > 0) { tun.step--; paintTunnel(); } };
      $('mlsP1TnNext').onclick = tunnelNext;
    }
    function tnStatus(m) { var s = $('mlsP1TnStatus'); if (s) s.textContent = m || ''; }
    function visibleNoteBox() {
      var nb = $('noteBox'); if (nb && nb.offsetParent) return nb;
      var best = null;
      Array.prototype.forEach.call(document.querySelectorAll('textarea'), function (t) { if (t.offsetParent && t.offsetHeight > 90 && (!best || t.value.length > best.value.length)) best = t; });
      return best || nb;
    }
    var STEPS = [
      function who(body) {
        $('mlsP1TnTitle').textContent = 'Who are you seeing?';
        $('mlsP1TnSub').textContent = 'Say it or type it - just the name and date of birth.';
        body.innerHTML = '<input id="mlsP1TnName" placeholder="Patient name (First Last)" value="' + esc(tun.name) + '">' +
          '<input id="mlsP1TnDob" placeholder="Date of birth (MM/DD/YYYY)" value="' + esc(tun.dob) + '">' +
          '<button class="tn-big tn-ghost" id="mlsP1TnMic">🎤 Dictate it</button>';
        $('mlsP1TnMic').onclick = function () {
          var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (!SR) { tnStatus('Voice input is not available in this browser - type instead.'); return; }
          var r = new SR(); r.lang = 'en-US'; r.interimResults = false;
          tnStatus('Listening... say "Jane Doe, June 3rd 1980"');
          r.onresult = function (ev) {
            var t = ev.results[0][0].transcript || '';
            tnStatus('Heard: "' + t + '"');
            var dm = t.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
            if (!dm) { var wm = t.match(/([A-Za-z]+ \d{1,2}(?:st|nd|rd|th)?,? \d{4})/); if (wm) { var d = new Date(wm[1].replace(/(st|nd|rd|th)/, '')); if (!isNaN(d)) dm = [null, (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear()]; } }
            var nm = t.replace(/([A-Za-z]+ \d{1,2}(st|nd|rd|th)?,? \d{4})|(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|date of birth|dob|born/gi, '').replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
            if (nm) $('mlsP1TnName').value = nm.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
            if (dm) $('mlsP1TnDob').value = dm[1];
          };
          r.onerror = function () { tnStatus('Didn’t catch that - try again or type.'); };
          r.start();
        };
      },
      function talk(body) {
        $('mlsP1TnTitle').textContent = 'Have the visit - just talk.';
        $('mlsP1TnSub').textContent = 'Start recording, talk naturally, stop when done. (Or paste/type below.)';
        body.innerHTML = '<button class="tn-big" id="mlsP1TnRec">🎙️ Start recording</button>' +
          '<textarea id="mlsP1TnTx" placeholder="...or type/paste the visit here"></textarea>';
        var recBtn = $('mlsP1TnRec'), recording = false;
        recBtn.onclick = function () {
          var target = recording ? findBtnByText(/stop recording/i) : findBtnByText(/start recording/i);
          if (!target) { tnStatus(recording ? 'Couldn’t find the app’s Stop button - use the app screen.' : 'Couldn’t find the app’s Record button - type the visit below instead.'); return; }
          target.click();
          recording = !recording;
          recBtn.textContent = recording ? '⏹ Stop recording' : '🎙️ Start recording';
          recBtn.classList.toggle('rec', recording);
          tnStatus(recording ? 'Recording via the app’s real recorder...' : 'Stopped.');
        };
      },
      function gen(body) {
        $('mlsP1TnTitle').textContent = 'Make the note.';
        $('mlsP1TnSub').textContent = 'MLS generates the structured note from your visit.';
        body.innerHTML = '<button class="tn-big" id="mlsP1TnGen">✨ Generate the note</button>';
        $('mlsP1TnGen').onclick = function () {
          var tx = $('mlsP1TnTx'); /* may be gone after repaint; that's fine */
          try { if (tx && tx.value.trim()) { var cap = document.querySelector('textarea[placeholder*="conversation" i], textarea[placeholder*="transcript" i]'); if (cap && !cap.value) { cap.value = tx.value; cap.dispatchEvent(new Event('input', { bubbles: true })); } } } catch (e) {}
          var g = $('genBtn') && $('genBtn').offsetParent ? $('genBtn') : findBtnByText(/generate/i);
          if (!g) { tnStatus('Couldn’t find the Generate button - generate from the app screen, then press Next.'); return; }
          var nb = visibleNoteBox(); var before = nb ? nb.value.length : 0;
          g.click();
          tnStatus('Generating... (this uses your normal note engine)');
          var tries = 0;
          var iv = setInterval(function () {
            tries++;
            var now = visibleNoteBox();
            if (now && now.value.length > before + 40) { clearInterval(iv); tnStatus('Note ready.'); tun.step = 3; paintTunnel(); }
            else if (tries > 120) { clearInterval(iv); tnStatus('Still working or nothing arrived - check the app screen, then press Next.'); }
          }, 1000);
        };
      },
      function review(body) {
        $('mlsP1TnTitle').textContent = 'Review it.';
        $('mlsP1TnSub').textContent = 'Edit anything. Fill the blanks if MLS queued any.';
        var nb = visibleNoteBox();
        body.innerHTML = '<textarea id="mlsP1TnNote"></textarea><button class="tn-big tn-ghost" id="mlsP1TnBlanks">✏️ Fill the blanks</button>';
        var box = $('mlsP1TnNote'); box.value = nb ? nb.value : '';
        box.addEventListener('input', function () { if (nb) { nb.value = box.value; nb.dispatchEvent(new Event('input', { bubbles: true })); } });
        $('mlsP1TnBlanks').onclick = function () { var bar = $('mlsFpBlankBar'); if (bar && bar.style.display !== 'none') bar.click(); else tnStatus('No blanks queued - the note has no [FILL] slots.'); };
      },
      function fin(body) {
        $('mlsP1TnTitle').textContent = 'Done - what next?';
        $('mlsP1TnSub').textContent = 'You review and sign in the app as always. MLS never signs for you.';
        body.innerHTML = '<button class="tn-big" id="mlsP1TnOp">💉 Prep op note</button>' +
          '<button class="tn-big tn-ghost" id="mlsP1TnAgain">➕ Next patient</button>' +
          '<button class="tn-big tn-ghost" id="mlsP1TnDone">✅ Finish</button>';
        $('mlsP1TnOp').onclick = function () { try { if (typeof openOpPrepSmart === 'function') openOpPrepSmart(); closeTunnel(); } catch (e) {} };
        $('mlsP1TnAgain').onclick = function () { tun = { step: 0, name: '', dob: '' }; paintTunnel(); };
        $('mlsP1TnDone').onclick = closeTunnel;
      }
    ];
    function paintTunnel() {
      ensureTunnel();
      var ov = tunEl(); ov.style.display = 'flex';
      $('mlsP1TnStep').textContent = 'Simple mode - step ' + (tun.step + 1) + ' of ' + STEPS.length;
      tnStatus('');
      var body = $('mlsP1TnBody'); body.innerHTML = '';
      STEPS[tun.step](body);
      $('mlsP1TnBack').style.visibility = tun.step === 0 ? 'hidden' : 'visible';
      $('mlsP1TnNext').style.visibility = tun.step >= STEPS.length - 1 ? 'hidden' : 'visible';
    }
    function tunnelNext() {
      if (tun.step === 0) {
        tun.name = ($('mlsP1TnName') || {}).value || ''; tun.dob = ($('mlsP1TnDob') || {}).value || '';
        if (!tun.name.trim()) { tnStatus('Enter or dictate the patient’s name first.'); return; }
        try {
          var n = $('heroPtName'); if (n) { n.value = tun.name.trim(); n.dispatchEvent(new Event('input', { bubbles: true })); }
          var d = $('heroPtDob'); if (d && tun.dob.trim()) { d.value = tun.dob.trim(); d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true })); }
          if (typeof _heroSyncName === 'function') _heroSyncName();
        } catch (e) {}
      }
      if (tun.step < STEPS.length - 1) { tun.step++; paintTunnel(); }
    }
    function closeTunnel() { var ov = tunEl(); if (ov) ov.style.display = 'none'; }
    function mountTunnelLaunch() {
      if ($('mlsP1TunnelLaunch')) return;
      /* v1.0.1: resilient anchor chain - show-more row, else the schedule date row, else a fixed launcher */
      var row = null, fixed = false;
      var host = findBtnByText(/show more/i);
      if (host) row = host.parentElement;
      if (!row) { var di = document.querySelector('input[type="date"]'); if (di && di.offsetParent) row = di.parentElement; }
      if (!row) { row = document.body; fixed = true; }
      if (!row) return;
      var b = document.createElement('button');
      b.id = 'mlsP1TunnelLaunch'; b.type = 'button'; b.textContent = '\uD83C\uDFAF Simple mode (tunnel)';
      b.title = 'One thing at a time: Who -> Talk -> Generate -> Review -> Finish';
      if (fixed) b.style.cssText = 'position:fixed;right:18px;bottom:128px;z-index:99995;border:0;border-radius:11px;padding:9px 15px;font-size:13px;font-weight:800;cursor:pointer;background:#10b981;color:#fff;box-shadow:0 3px 10px rgba(16,185,129,.4)';
      b.onclick = function () { tun = { step: 0, name: '', dob: '' }; paintTunnel(); };
      row.appendChild(b); remember(b);
    }
    var tunIv = setInterval(mountTunnelLaunch, 2000); P._ivs.push(tunIv); mountTunnelLaunch();
    P.openTunnel = function () { tun = { step: 0, name: '', dob: '' }; paintTunnel(); };
    P.feats.tunnel = true;
  } catch (e) { P.feats.tunnel = 'error: ' + e.message; }

  /* ==================================================================== S3
   * MLS AGENT - SIDE CHAT DOCK
   * ==================================================================== */
  try {
    addStyle('mlsP1AgStyle',
      '#mlsP1Ag{position:fixed;top:0;right:0;bottom:0;width:340px;z-index:99996;background:var(--card,#fff);color:var(--ink,#15243a);border-left:1px solid var(--line,#d8e1ec);box-shadow:-10px 0 30px rgba(15,25,40,.18);display:none;flex-direction:column;font-size:13.5px}' +
      '#mlsP1Ag .ag-h{display:flex;align-items:center;gap:8px;padding:12px 14px;background:linear-gradient(135deg,#0d3c78,#2168c9);color:#fff;font-weight:850}' +
      '#mlsP1Ag .ag-h button{margin-left:auto;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:8px;padding:3px 10px;cursor:pointer;font-weight:700}' +
      '#mlsP1AgMsgs{flex:1;overflow:auto;padding:12px}' +
      '#mlsP1AgMsgs .m{border-radius:12px;padding:9px 12px;margin:6px 0;max-width:92%;line-height:1.5;white-space:pre-wrap}' +
      '#mlsP1AgMsgs .m.you{background:rgba(33,104,201,.12);margin-left:auto}' +
      '#mlsP1AgMsgs .m.ai{background:rgba(15,37,64,.06);border:1px solid var(--line,#e2e9f2)}' +
      '#mlsP1AgMsgs .m.step{font-size:12.5px;background:transparent;border:1px dashed var(--line,#cdd9e8);opacity:.9}' +
      '#mlsP1AgIn{display:flex;gap:7px;padding:10px;border-top:1px solid var(--line,#d8e1ec)}' +
      '#mlsP1AgIn input{flex:1;border:1px solid var(--line,#c9d5e4);border-radius:10px;padding:10px 12px;font-size:13.5px}' +
      '#mlsP1AgIn button{border:0;border-radius:10px;padding:9px 13px;font-weight:800;cursor:pointer;background:#2168c9;color:#fff}' +
      '#mlsP1AgFab{position:fixed;right:18px;bottom:76px;z-index:99995;border:0;border-radius:999px;padding:12px 18px;font-size:14px;font-weight:850;cursor:pointer;background:linear-gradient(135deg,#0d3c78,#2168c9);color:#fff;box-shadow:0 8px 26px rgba(15,40,90,.45)}');
    function agEl() { return $('mlsP1Ag'); }
    function agMsg(txt, cls) {
      var box = $('mlsP1AgMsgs'); if (!box) return;
      var d = document.createElement('div'); d.className = 'm ' + (cls || 'ai'); d.textContent = txt;
      box.appendChild(d); box.scrollTop = box.scrollHeight;
      return d;
    }
    function dayWordToISO(w) {
      w = String(w || '').toLowerCase().trim();
      if (!w || w === 'today') return todayISO();
      if (w === 'tomorrow' || w === 'tmrw' || w === 'tommorow' || w === 'toomow' || w === 'tomorow') return isoPlus(1);
      if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
      var days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      var idx = days.indexOf(w);
      if (idx >= 0) { var d = new Date(); var add = (idx - d.getDay() + 7) % 7 || 7; return isoPlus(add); }
      var p = new Date(w); if (!isNaN(p)) return p.toISOString().slice(0, 10);
      return todayISO();
    }
    var ACTIONS = {
      open_view: function (a) { if (typeof showView === 'function' && a.view) { showView(String(a.view)); return 'Opened ' + a.view + '.'; } throw new Error('view not available'); },
      pull_schedule: function () {
        var b = document.querySelector('button[onclick^="pullScheduleViaAssist"]') || findBtnByText(/pull (this|today)/i);
        if (!b) throw new Error('Pull button not found on this screen - open the Visit screen.');
        b.click();
        return 'Started the Athena pull (progress shows in the pull box). It reads whichever day your Athena tab has open - honest status only.';
      },
      list_day: function (a) {
        var iso = dayWordToISO(a.day), list = apptsOn(iso);
        if (!list.length) return 'No appointments on the MLS calendar for ' + dayLabel(iso) + '. If they exist in Athena, open that day there and run the pull.';
        var lines = list.slice().sort(function (p, q) { return String(p.start_at || '').localeCompare(String(q.start_at || '')); }).slice(0, 30).map(function (x) {
          var t = ''; try { if (x.start_at) { var dd = new Date(x.start_at); t = dd.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } } catch (e) {}
          return (t || '--') + '  ' + (x.name || 'Patient') + (x.reason ? (' - ' + String(x.reason).slice(0, 34)) : '');
        });
        return dayLabel(iso) + ' - ' + list.length + ' appointment(s):\n' + lines.join('\n');
      },
      prep_op_notes: function (a) {
        var iso = dayWordToISO(a.day), list = apptsOn(iso);
        if (!list.length) throw new Error('Nothing on the MLS calendar for ' + dayLabel(iso) + ' yet. Open that day in your Athena tab and click Pull first - then ask me again.');
        if (typeof openOpPrep !== 'function') throw new Error('Op-note prep is not available on this screen.');
        openOpPrep(iso);
        return 'Opened op-note prep for ' + dayLabel(iso) + ' (' + list.length + ' patients). Procedures auto-fill from the Athena schedule where known; press "Generate all" there when ready, and use the blanks walker for anything not dictated.';
      },
      generate_all_opnotes: function () {
        var g = $('opPrepGenAllBtn');
        if (!g || !g.offsetParent) throw new Error('The op-prep window is not open (ask me to "prep op notes for <day>" first).');
        g.click();
        return 'Pressed Generate-all. Watch the op-prep window for per-patient results; nothing is sent to Athena automatically.';
      },
      find_patient: function (a) {
        if (!a.name) throw new Error('No name given.');
        try { if (typeof showView === 'function') showView('visit'); } catch (e) {}
        var n = $('heroPtName'); if (!n) throw new Error('Patient field not found.');
        n.value = String(a.name); n.dispatchEvent(new Event('input', { bubbles: true }));
        try { if (typeof _heroSyncName === 'function') _heroSyncName(); } catch (e) {}
        return 'Set the active patient to ' + a.name + '.';
      },
      add_starter_templates: function () { var b = $('mlsP1Starter'); if (b) { b.click(); return 'Starter template pack added.'; } throw new Error('Open the Templates tab once first.'); },
      open_tunnel: function () { if (P.openTunnel) { P.openTunnel(); return 'Simple-mode tunnel opened.'; } throw new Error('Tunnel unavailable.'); },
      fill_blanks: function () { var bar = $('mlsFpBlankBar'); if (bar && bar.style.display !== 'none') { bar.click(); return 'Opened the fill-in-the-blank walker.'; } return 'No blanks are queued right now.'; }
    };
    function runActions(actions) {
      var i = 0;
      (function next() {
        if (i >= actions.length) return;
        var a = actions[i++] || {};
        var fn = ACTIONS[a.type];
        if (!fn) { agMsg('✖ Unknown action "' + a.type + '" - skipped (not in my whitelist).', 'step'); next(); return; }
        try { var res = fn(a); agMsg('✔ ' + res, 'step'); }
        catch (e) { agMsg('✖ ' + e.message, 'step'); }
        setTimeout(next, 350);
      })();
    }
    function keywordPlan(q) {
      var t = q.toLowerCase();
      var dayWord = (t.match(/tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}/) || [''])[0];
      if (/prep.*op|op ?note/.test(t)) return { reply: 'On it - opening op-note prep' + (dayWord ? (' for ' + dayWord) : '') + '.', actions: [{ type: 'prep_op_notes', day: dayWord || 'today' }] };
      if (/pull/.test(t)) return { reply: 'Starting the Athena pull.', actions: [{ type: 'pull_schedule' }] };
      if (/who|schedule|list|patients/.test(t)) return { reply: 'Here’s the day:', actions: [{ type: 'list_day', day: dayWord || 'today' }] };
      if (/simple|tunnel|dictate/.test(t)) return { reply: 'Opening simple mode.', actions: [{ type: 'open_tunnel' }] };
      if (/starter|template pack/.test(t)) return { reply: 'Adding the starter templates.', actions: [{ type: 'add_starter_templates' }] };
      if (/blank/.test(t)) return { reply: 'Opening the blanks walker.', actions: [{ type: 'fill_blanks' }] };
      if (/calendar|patients tab|settings|analysis|visit/.test(t)) { var v = (t.match(/calendar|patients|settings|analysis|visit/) || ['visit'])[0]; return { reply: 'Opening ' + v + '.', actions: [{ type: 'open_view', view: v }] }; }
      return { reply: 'I can: prep op notes for a day, run the Athena pull, list a day’s patients, set the active patient, open simple mode, add starter templates, open screens, or start the blanks walker. Try: "prep all my op notes for tomorrow".', actions: [] };
    }
    function agentAsk(q) {
      agMsg(q, 'you');
      var thinking = agMsg('…thinking', 'ai');
      var ctx = 'TODAY=' + todayISO() + '; TOMORROW=' + isoPlus(1) +
        '; APPTS_TODAY=' + apptsOn(todayISO()).length + '; APPTS_TOMORROW=' + apptsOn(isoPlus(1)).length +
        '; ACTIVE_PATIENT=' + (($('heroPtName') || {}).value || 'none');
      var sys = 'You are MLS Agent inside a medical-scribe web app. You may ONLY use these whitelisted actions (no others exist): ' +
        'open_view{view: calendar|patients|visit|analysis|settings|studio}, pull_schedule{}, list_day{day}, prep_op_notes{day}, generate_all_opnotes{}, find_patient{name}, add_starter_templates{}, open_tunnel{}, fill_blanks{}. ' +
        'You NEVER sign notes, never write to the EMR, never delete anything - those are not actions you have. Day values: today|tomorrow|a weekday|YYYY-MM-DD. ' +
        'Reply with STRICT JSON only: {"reply":"short friendly sentence of what you are doing or the answer","actions":[{"type":"...","day":"...","view":"...","name":"..."}]} - use [] for no actions. Be honest: if data is likely missing, still use the action (it reports honestly).';
      ai(sys, 'CONTEXT: ' + ctx + '\n\nDOCTOR SAYS: ' + q).then(function (out) {
        var j = parseJsonLoose(out) || keywordPlan(q);
        thinking.textContent = j.reply || '...';
        if (j.actions && j.actions.length) runActions(j.actions.slice(0, 5));
      }).catch(function () {
        var j = keywordPlan(q);
        thinking.textContent = j.reply;
        if (j.actions.length) runActions(j.actions);
      });
    }
    function mountAgent() {
      if ($('mlsP1AgFab')) return;
      var fab = document.createElement('button');
      fab.id = 'mlsP1AgFab'; fab.type = 'button'; fab.textContent = '🤖 MLS Agent';
      fab.title = 'Side chat that runs multi-step jobs: "prep all my op notes for tomorrow"';
      document.body.appendChild(fab); remember(fab);
      var dock = document.createElement('div');
      dock.id = 'mlsP1Ag';
      dock.innerHTML = '<div class="ag-h">🤖 MLS Agent <span style="font-size:10px;background:rgba(255,255,255,.25);border-radius:999px;padding:2px 8px">STAGING</span><button id="mlsP1AgX" type="button">Close</button></div>' +
        '<div id="mlsP1AgMsgs"></div>' +
        '<div id="mlsP1AgIn"><input id="mlsP1AgQ" placeholder="e.g. prep all my op notes for tomorrow"><button id="mlsP1AgMic" type="button" title="Speak">🎤</button><button id="mlsP1AgSend" type="button">Send</button></div>';
      document.body.appendChild(dock); remember(dock);
      fab.onclick = function () { dock.style.display = dock.style.display === 'flex' ? 'none' : 'flex'; if (dock.style.display === 'flex' && !dock.__welcomed) { dock.__welcomed = true; agMsg('Hi - tell me what you need. I can prep the day’s op notes, run the Athena pull, list a day, set your active patient, open simple mode, add starter templates and more. I never sign or send anything to Athena myself.', 'ai'); } };
      $('mlsP1AgX').onclick = function () { dock.style.display = 'none'; };
      function send() { var q = $('mlsP1AgQ').value.trim(); if (!q) return; $('mlsP1AgQ').value = ''; agentAsk(q); }
      $('mlsP1AgSend').onclick = send;
      $('mlsP1AgQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
      $('mlsP1AgMic').onclick = function () {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { agMsg('Voice input not available in this browser.', 'step'); return; }
        var r = new SR(); r.lang = 'en-US';
        agMsg('Listening…', 'step');
        r.onresult = function (ev) { var t = ev.results[0][0].transcript || ''; $('mlsP1AgQ').value = t; send(); };
        r.onerror = function () { agMsg('Didn’t catch that.', 'step'); };
        r.start();
      };
    }
    var agIv = setInterval(mountAgent, 2000); P._ivs.push(agIv); mountAgent();
    P.feats.agent = true;
  } catch (e) { P.feats.agent = 'error: ' + e.message; }

  /* ------------------------------------------------------------------ */
  P.revert = function () {
    try { P._ivs.forEach(function (i) { clearInterval(i); }); } catch (e) {}
    try { if (P._orig.generateNote) window.generateNote = P._orig.generateNote; } catch (e) {}
    try { P._nodes.forEach(function (n) { if (n && n.parentElement) n.parentElement.removeChild(n); }); } catch (e) {}
    try { ['mlsP1TplStyle', 'mlsP1TunStyle', 'mlsP1AgStyle'].forEach(function (id) { var s = $(id); if (s && s.parentElement) s.parentElement.removeChild(s); }); } catch (e) {}
    P.installed = false;
    try { delete window.__mlsPack1; } catch (e) { window.__mlsPack1 = undefined; }
  };

  try { console.log('[MLS staging pack1 item80] installed', P.feats); } catch (e) {}
})();
