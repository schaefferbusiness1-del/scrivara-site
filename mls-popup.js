/* =========================================================================
   MLS Seamless Athena Pop-up  —  content-script overlay  (v0.2.0)
   Injected by MLS Assist on athenaOne pages. Clean, dead-simple control
   surface that sits OVER Athena. Presentation only: it sends intents to
   background.js (chrome.runtime) and renders honest, real progress.

   HARD RAILS (do not weaken):
     - Read-only except the two deliberate, gated writes (note + codes).
     - NEVER clicks Save / Sign / attest / submit-charges. Sign is the doctor's.
     - Success is shown ONLY when the engine confirmed it. No fake spinners,
       no fabricated counts, no fabricated success.

   Self-contained, idempotent, instantly reversible: window.__mlsPopup.revert().
   Exposes a testable core (no chrome/DOM required) for the jsdom suite.
   ========================================================================= */
(function () {
  'use strict';
  if (typeof window !== 'undefined' && window.__mlsPopup && window.__mlsPopup.installed) return;

  var VERSION = '1.50';

  // ---- environment detection (so the same file is unit-testable) ----------
  var hasChrome = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  var hasDOM = (typeof document !== 'undefined' && !!document.createElement);

  // ====================================================================== //
  //  TRANSPORT — the ONLY channel to the extension. chrome.runtime, never   //
  //  page postMessage, so the mlsTrustedOrigin gate is neither widened nor  //
  //  depended upon. Injectable for tests.                                   //
  // ====================================================================== //
  var transport = {
    send: function (msg) {
      return new Promise(function (resolve) {
        if (!hasChrome) { resolve({ error: 'no-extension' }); return; }
        try {
          chrome.runtime.sendMessage(msg, function (resp) {
            if (chrome.runtime.lastError) { resolve({ error: 'no-extension' }); return; }
            resolve(resp || { error: 'empty' });
          });
        } catch (e) { resolve({ error: 'no-extension' }); }
      });
    },
    // streamed progress events from background (mlsAppVisitsProgress, paste/code results)
    onMessage: function (cb) {
      if (!hasChrome || !chrome.runtime.onMessage) return function () {};
      var handler = function (m) { try { cb(m); } catch (e) {} };
      chrome.runtime.onMessage.addListener(handler);
      return function () { try { chrome.runtime.onMessage.removeListener(handler); } catch (e) {} };
    }
  };

  // ====================================================================== //
  //  CORE STATE MACHINE  (pure-ish — drives rendering; unit-tested)         //
  // ====================================================================== //
  var STATES = ['idle','pulling','ready','recording','captured','generating',
                'review','writingback','codeswriting','written'];

  function createCore(opts) {
    opts = opts || {};
    var tx = opts.transport || transport;
    var onRender = opts.onRender || function () {};

    var st = {
      version: VERSION,
      state: 'idle',
      conn: { ext: false, athenaOpen: false, mlsApp: false, patientOpen: false },
      patient: null,           // {name, dob} read at Go — the session lockedIdentity
      visitCount: null,
      transcript: '',
      typedNotes: '',
      recording: false,
      note: null,              // {soap, insurance, em_level, icd10[], cpt[], ...}
      codes: null,             // validated codes from __mlsCodeSheet
      mismatch: null,          // {mlsIdentity, chartIdentity} when the gate blocks
      written: null,           // {sections[], codesAdded[], codesMissed[]}
      signedConfirmed: false,  // true ONLY when Athena confirmed the sign+save
      narration: [],           // [{text, kind}]  kind: run|ok|warn|fail|note
      error: null,
      busy: false
    };

    function render() { onRender(st); }
    function setState(s) { if (STATES.indexOf(s) < 0) return; st.state = s; render(); }
    function narrate(text, kind) { st.narration.push({ text: text, kind: kind || 'note' }); render(); }
    function clearNarr() { st.narration = []; }

    // ---- connection / readiness (read-only, passive) --------------------
    /* v1.51: token-overlap name match (same rule as the writeback gate) */
    function mlspNameMatch(a, b) {
      if (!a || !b) return true;
      var ta = String(a).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (x) { return x.length > 1; });
      var tb = String(b).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (x) { return x.length > 1; });
      var o = ta.filter(function (x) { return tb.indexOf(x) >= 0; }).length;
      return o >= 2 || (o >= 1 && Math.min(ta.length, tb.length) === 1);
    }
    var _lastConnSig = '';
    function refreshStatus() {
      return tx.send({ type: 'MLS_OVL_STATUS' }).then(function (r) {
        r = r || {};
        st.conn = {
          ext: !r.error,
          athenaOpen: !!r.athenaOpen,
          mlsApp: !!r.mlsApp,
          patientOpen: !!r.patientOpen
        };
        st.liveIdentity = r.identity || null;
        /* v1.51 STALE-BINDING FIX: if the chart open in athenaOne is not the
           patient this pill locked onto (or no chart is open anymore), DROP the
           stale lock instead of offering Record under the wrong identity.
           Never fires mid-recording — the writeback hard gate still protects. */
        var changed = false;
        if (st.patient && st.patient.name && !st.busy && !st.recording && st.state !== 'idle') {
          var lid = st.liveIdentity;
          var mismatch = !!(lid && lid.name && !mlspNameMatch(lid.name, st.patient.name));
          var gone = !st.conn.patientOpen;
          if (mismatch || gone) {
            st.state = 'idle'; st.patient = null; st.visitCount = null; st.error = null;
            narrate(mismatch
              ? ('athenaOne is now on ' + lid.name + ' — press Go to read this patient.')
              : 'The patient chart was closed in athenaOne — open a patient, then press Go.', 'warn');
            changed = true;
          }
        }
        /* render only when something changed — a fixed-interval full render
           steals focus from the overlay note box (v1.42 regression class) */
        var sig = JSON.stringify(st.conn) + '|' + ((st.liveIdentity && st.liveIdentity.name) || '');
        if (changed || sig !== _lastConnSig) { _lastConnSig = sig; render(); }
        return st.conn;
      });
    }
    function connColor() {
      if (!st.conn.ext) return 'red';
      if (st.conn.athenaOpen && st.conn.mlsApp) return 'green';
      return 'amber';
    }
    function canGo() {
      return connColor() === 'green' && st.conn.patientOpen && !st.busy;
    }

    // ---- STEP 1: Go — read open patient + pull all visits (READ-ONLY) ----
    function go() {
      if (!canGo()) return Promise.resolve();
      st.busy = true; st.error = null; clearNarr(); setState('pulling');
      narrate('Reading the open patient…', 'run');
      return tx.send({ type: 'MLS_OVL_GO' }).then(function (r) {
        st.busy = false;
        r = r || {};
        if (r.error || r.ok === false) {
          // HONEST failure — nothing saved, no fabricated count
          narrate(r.message || "Couldn't read this chart's visits — nothing saved.", 'fail');
          st.error = r.message || 'pull-failed';
          setState('idle');
          return r;
        }
        st.patient = r.identity || null;                 // session lockedIdentity
        st.visitCount = Array.isArray(r.visits) ? r.visits.length : (r.savedCount || 0);
        narrate('✓ ' + st.visitCount + ' visit(s) on file', 'ok');
        setState('ready');
        return r;
      });
    }

    // ---- STEP 2: Record (reuses §35 recorder via offscreen doc in BG) ----
    function startRecording() {
      if (st.state !== 'ready' && st.state !== 'recording') return Promise.resolve();
      /* v1.51: NEVER start Record under a non-matching identity — re-check the
         OPEN chart right now, not whatever was locked earlier. */
      return refreshStatus().then(function () {
        if (st.state !== 'ready' && st.state !== 'recording') return; /* stale lock was just dropped */
        var lid = st.liveIdentity;
        if (st.patient && st.patient.name && lid && lid.name && !mlspNameMatch(lid.name, st.patient.name)) {
          narrate('athenaOne is on ' + lid.name + ', not ' + st.patient.name + ' — open the right chart and press Go first. Nothing was recorded.', 'fail');
          return;
        }
        st.recording = true; setState('recording'); narrate('Recording…', 'run');
        return tx.send({ type: 'MLS_OVL_RECORD_START' });
      });
    }
    function stopRecording() {
      st.recording = false;
      return tx.send({ type: 'MLS_OVL_RECORD_STOP' }).then(function () {
        if (hasContent()) setState('captured');
        else { setState('recording'); narrate('Say something or type a note first.', 'warn'); }
      });
    }
    function setTypedNotes(t, silent) { st.typedNotes = t || ''; if (!silent) render(); } /* v1.42 fix #3: allow a silent update so typing in the overlay note box doesn't trigger a full re-render (which was stealing focus on every keystroke). */
    function hasContent() {
      return (st.transcript && st.transcript.trim().length > 0) ||
             (st.typedNotes && st.typedNotes.trim().length > 0);
    }

    // ---- STEP 3: Finish — generate note + codes -------------------------
    function generate() {
      if (!hasContent()) { narrate('No transcript or notes yet.', 'warn'); return Promise.resolve(); }
      st.busy = true; setState('generating'); clearNarr();
      narrate('Writing the note…', 'run');
      return tx.send({ type: 'MLS_OVL_GENERATE', transcript: st.transcript, typedNotes: st.typedNotes })
        .then(function (r) {
          st.busy = false; r = r || {};
          if (r.error || !r.note) {
            narrate(r.message || "Couldn't generate the note.", 'fail');
            st.error = r.message || 'generate-failed'; setState('captured'); return r;
          }
          st.note = r.note; st.codes = r.codes || null;
          narrate('✓ Note + codes ready', 'ok');
          setState('review');
          return r;
        });
    }

    // ---- STEP 5/6: Write-back — gated, verified, NEVER signs -------------
    function writeBack(override) {
      st.busy = true; st.mismatch = null; setState('writingback'); clearNarr();
      narrate('Confirming this is the right chart…', 'run');
      return tx.send({
        type: 'MLS_OVL_WRITEBACK',
        note: st.note, codes: st.codes, override: !!override
      }).then(function (r) {
        st.busy = false; r = r || {};
        // ---- patient-match gate ----
        if (r.blocked) {
          st.mismatch = { mlsIdentity: r.mlsIdentity, chartIdentity: r.chartIdentity };
          narrate('⛔ This looks like a different patient — nothing written.', 'fail');
          setState('review');
          return r;
        }
        if (r.error) {
          narrate(r.message || 'Write failed.', 'fail'); st.error = r.message || 'write-failed';
          setState('review'); return r;
        }
        // ---- note destinations (honest verified/unverified) ----
        (r.note && r.note.sections || []).forEach(function (s) {
          if (s.confirmed) narrate('✓ Note → ' + s.section + ' — verified', 'ok');
          else narrate('⚠ Wrote to ' + s.section + ' but couldn’t confirm — check before signing', 'warn');
        });
        // ---- codes (flag-gated; may be deferred) ----
        if (r.codes) {
          setState('codeswriting');
          (r.codes.added || []).forEach(function (c) { narrate('✓ ' + c + ' added', 'ok'); });
          (r.codes.missed || []).forEach(function (m) {
            narrate('⚠ Couldn’t add ' + (m.code || m) + ' — add it by hand', 'warn');
          });
          if (r.codes.deferred) narrate('Codes left for you to add (coding driver not enabled yet).', 'note');
        }
        st.written = {
          sections: (r.note && r.note.sections) || [],
          codesAdded: (r.codes && r.codes.added) || [],
          codesMissed: (r.codes && r.codes.missed) || []
        };
        narrate('Draft written (unsigned). MLS did NOT click Save or Sign.', 'note');
        setState('written');
        return r;
      });
    }

    // ---- STEP 7 (optional, USER-INITIATED): Sign & Save in Athena ----------
    // Fires ONLY from the doctor's click here. Background re-checks the name+DOB
    // gate and auto-clicks Athena's Sign & Save, reporting "signed" ONLY when
    // Athena confirms the save/sign. Never fakes success, never autonomous.
    function signSave() {
      if (st.busy || st.signedConfirmed) return Promise.resolve();
      st.busy = true; st.error = null;
      narrate('Signing & saving in athenaOne...', 'run');
      return tx.send({ type: 'MLS_OVL_SIGNSAVE', userInitiated: true }).then(function (r) {
        st.busy = false; r = r || {};
        if (r.signed === true) { st.signedConfirmed = true; narrate('✓ Athena confirmed - signed & saved.', 'ok'); }
        else if (r.blocked) { narrate('⛔ ' + (r.message || 'Patient gate failed - nothing signed.'), 'fail'); }
        else if (r.error) { st.error = r.error; narrate(r.message || 'Sign & Save unavailable.', 'fail'); }
        else { narrate(r.message || 'Clicked Sign & Save but Athena didn’t confirm - check the chart before relying on it.', 'warn'); }
        render();
        return r;
      });
    }

    function reset() {
      st.state = 'idle'; st.patient = null; st.visitCount = null; st.transcript = '';
      st.typedNotes = ''; st.recording = false; st.note = null; st.codes = null;
      st.mismatch = null; st.written = null; st.signedConfirmed = false; st.narration = []; st.error = null; st.busy = false;
      render();
    }

    // ---- streamed progress in (real events only) ------------------------
    function ingest(msg) {
      if (!msg || !msg.type) return;
      if (msg.type === 'MLS_OVL_PROGRESS') { narrate(msg.message, msg.kind || 'run'); }
      else if (msg.type === 'MLS_OVL_TRANSCRIPT') {
        // segments arrive one COMPLETE chunk at a time -> append (never fabricate)
        var t = msg.text || '';
        if (!t) { render(); return; }
        if (msg.append) st.transcript = (st.transcript ? st.transcript + ' ' : '') + t;
        else st.transcript = t;
        render();
      }
      else if (msg.type === 'MLS_OVL_RECORD_ERROR') {
        // honest mic-failure degrade: stop recording, keep type-only path open
        st.recording = false;
        narrate(msg.reason === 'mic-denied'
          ? 'Microphone blocked — type your note instead.'
          : 'Mic problem — type your note instead.', 'warn');
        if (st.state === 'recording') setState('ready');
      }
    }

    return {
      st: st, STATES: STATES,
      render: render, setState: setState, narrate: narrate,
      refreshStatus: refreshStatus, connColor: connColor, canGo: canGo,
      go: go, startRecording: startRecording, stopRecording: stopRecording,
      setTypedNotes: setTypedNotes, hasContent: hasContent,
      generate: generate, writeBack: writeBack, signSave: signSave, reset: reset, ingest: ingest,
      /* v1.50 patient picker */
      listPatients: function () { return tx.send({ type: 'MLS_OVL_LIST_PATIENTS' }); },
      openPatient: function (name) {
        return tx.send({ type: 'MLS_OVL_OPEN_PATIENT', name: name }).then(function (r) {
          r = r || {};
          if (r.identity && r.identity.name) narrate('Opened ' + r.identity.name + '.', 'ok');
          else if (r.ok && r.opened) narrate('Opened the chart \u2014 confirming the patient\u2026', 'run');
          else if (r.ok) narrate('Tried to open the chart \u2014 check the Athena tab.', 'warn');
          else narrate(r.error || 'Could not open the chart.', 'fail');
          return refreshStatus().then(function () { return r; });
        });
      }
    };
  }

  // ====================================================================== //
  //  DOM LAYER  (only runs in the browser; thin renderer over the core)    //
  // ====================================================================== //
  var ATHENA_RE = /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i;

  function mountDOM() {
    if (!hasDOM) return null;
    if (!ATHENA_RE.test(location.host) && !ATHENA_RE.test(location.href) && !/athena/i.test(document.title || '')) return null;  /* v1.50 title-aware */
    if (document.getElementById('mls-popup-root')) return null;

    var root = document.createElement('div');
    root.id = 'mls-popup-root';
    (document.body || document.documentElement).appendChild(root);

    var core = createCore({ transport: transport, onRender: paint });
    var collapsed = true;
    var pos = null;

    // restore persisted position / collapsed state
    try {
      if (hasChrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['mlsPopupPos', 'mlsPopupCollapsed'], function (v) {
          if (v && v.mlsPopupPos) { pos = v.mlsPopupPos; applyPos(); }
          if (v && typeof v.mlsPopupCollapsed === 'boolean') { collapsed = v.mlsPopupCollapsed; paint(core.st); }
        });
      }
    } catch (e) {}

    function applyPos() {
      if (!pos) return;
      root.style.top = pos.top + 'px'; root.style.left = pos.left + 'px';
      root.style.right = 'auto';
    }
    function savePos() {
      try { if (hasChrome && chrome.storage) chrome.storage.local.set({ mlsPopupPos: pos }); } catch (e) {}
    }
    function saveCollapsed() {
      try { if (hasChrome && chrome.storage) chrome.storage.local.set({ mlsPopupCollapsed: collapsed }); } catch (e) {}
    }

    function el(tag, cls, txt) {
      var n = document.createElement(tag); if (cls) n.className = cls;
      if (txt != null) n.textContent = txt; return n;
    }
    function bigBtn(label, cls, on, disabled) {
      var b = el('button', 'mlsp-btn ' + (cls || ''), label);
      if (disabled) b.disabled = true;
      b.addEventListener('click', on);
      return b;
    }

    function paint(s) {
      root.innerHTML = '';
      if (collapsed) { root.appendChild(renderPill(s)); return; }
      root.appendChild(renderCard(s));
    }

    function renderPill(s) {
      var pill = el('div', 'mlsp-pill');
      var dot = el('span', 'mlsp-dot ' + core.connColor());
      pill.appendChild(dot);
      pill.appendChild(el('span', null, '🩺 MLS'));
      pill.addEventListener('click', function () { collapsed = false; saveCollapsed(); core.refreshStatus(); paint(core.st); });
      return pill;
    }

    function renderCard(s) {
      var card = el('div', 'mlsp-card');

      // ---- header (drag handle) ----
      var head = el('div', 'mlsp-head');
      head.appendChild(el('span', 'mlsp-dot ' + core.connColor()));
      head.appendChild(el('span', 'mlsp-brand', 'MLS'));
      head.appendChild(el('span', 'mlsp-pt', s.patient ? (s.patient.name || '') : ''));
      var collapseBtn = el('button', 'mlsp-iconbtn', '–');
      collapseBtn.addEventListener('click', function () { collapsed = true; saveCollapsed(); paint(core.st); });
      head.appendChild(collapseBtn);
      enableDrag(head);
      card.appendChild(head);

      // ---- body ----
      var body = el('div', 'mlsp-body');
      renderState(body, s);
      card.appendChild(body);

      // ---- footer ----
      var foot = el('div', 'mlsp-foot');
      foot.appendChild(el('span', null, 'read-only until you choose to write · never signs'));
      foot.appendChild(el('span', null, 'v' + VERSION));
      card.appendChild(foot);
      return card;
    }

    function renderNarration(body, s) {
      if (!s.narration.length && s.state !== 'pulling' && s.state !== 'generating') return;
      if (s.busy && (s.state === 'pulling' || s.state === 'generating' || s.state === 'writingback')) {
        var bar = el('div', 'mlsp-bar'); bar.appendChild(el('i')); body.appendChild(bar);
      }
      var strip = el('div', 'mlsp-narr'); strip.setAttribute('aria-live', 'polite');
      s.narration.forEach(function (ln) {
        var row = el('div', 'line'); row.appendChild(el('span', ln.kind, ln.text)); strip.appendChild(row);
      });
      body.appendChild(strip);
    }

    function renderState(body, s) {
      switch (s.state) {
        case 'idle':
          body.appendChild(el('h2', 'mlsp-title', s.conn.patientOpen ? 'Ready' : 'Open a patient in Athena'));
          body.appendChild(el('p', 'mlsp-sub', 'Read this patient & pull their full history.'));
          body.appendChild(bigBtn('▶  Go', 'primary', function () { core.go(); }, !core.canGo()));
          /* v1.50 patient picker: one-tap open from today's MLS schedule */
          (function () {
            var pickBtn = el('button', 'mlsp-btn secondary', '📋 Pick a patient (today’s schedule)');
            pickBtn.style.cssText = 'display:block;width:100%;margin-top:6px';
            pickBtn.addEventListener('click', function () {
              pickBtn.disabled = true; pickBtn.textContent = 'Loading today’s schedule…';
              core.listPatients().then(function (r) {
                pickBtn.disabled = false; pickBtn.textContent = '📋 Pick a patient (today’s schedule)';
                var old = body.querySelector('.mlsp-picklist'); if (old) old.remove();
                var box = el('div', 'mlsp-picklist');
                box.style.cssText = 'max-height:180px;overflow:auto;margin-top:8px;border:1px solid rgba(120,150,220,.35);border-radius:10px;padding:4px';
                var list = (r && r.patients) || [];
                if (!r || !r.ok || !list.length) {
                  box.appendChild(el('p', 'mlsp-sub', (r && r.error) || 'No patients on today’s MLS schedule yet — open mlsscribe.com and Pull today’s patients first.'));
                }
                list.slice(0, 60).forEach(function (pt) {
                  var row = el('button', 'mlsp-btn secondary', (pt.time ? pt.time + ' · ' : '') + pt.name);
                  row.style.cssText = 'display:block;width:100%;text-align:left;margin:2px 0';
                  row.addEventListener('click', function () {
                    row.disabled = true; row.textContent = 'Opening ' + pt.name + '…';
                    core.openPatient(pt.name).then(function () { try { box.remove(); } catch (e) {} });
                  });
                  box.appendChild(row);
                });
                body.appendChild(box);
              });
            });
            body.appendChild(pickBtn);
          })();
          if (core.connColor() !== 'green') body.appendChild(el('p', 'mlsp-sub', connHint(s)));
          break;

        case 'pulling':
          body.appendChild(el('h2', 'mlsp-title', 'Pulling history…'));
          renderNarration(body, s);
          break;

        case 'ready':
          body.appendChild(el('h2', 'mlsp-title', s.patient ? s.patient.name : 'Patient ready'));
          body.appendChild(el('p', 'mlsp-sub', (s.visitCount || 0) + ' visit(s) on file'));
          var notes1 = el('textarea', 'mlsp-notes'); notes1.placeholder = 'Type a note (optional)…';
          notes1.value = s.typedNotes; notes1.addEventListener('input', function (e) { core.setTypedNotes(e.target.value, true); }); /* v1.42 fix #3: silent update — keep focus while typing */
          body.appendChild(notes1);
          body.appendChild(bigBtn('🎙  Record', 'primary', function () { core.startRecording(); }));
          var skip = el('button', 'mlsp-btn secondary', 'Skip recording → type a note');
          skip.addEventListener('click', function () { if (core.hasContent()) core.setState('captured'); });
          body.appendChild(skip);
          break;

        case 'recording':
          body.appendChild(el('h2', 'mlsp-title', 'Recording…'));
          body.appendChild(el('p', 'mlsp-sub', 'Talk through the visit. Stop when done.'));
          if (s.transcript) { var t = el('div', 'mlsp-narr'); t.appendChild(el('span', null, s.transcript)); body.appendChild(t); }
          body.appendChild(bigBtn('⏹  Stop', 'danger', function () { core.stopRecording(); }));
          break;

        case 'captured':
          body.appendChild(el('h2', 'mlsp-title', 'Ready to finish'));
          body.appendChild(el('p', 'mlsp-sub', 'Generate the note + codes and write them into the chart.'));
          body.appendChild(bigBtn('✨  Finish', 'primary', function () { core.generate(); }));
          var re = el('button', 'mlsp-btn secondary', 'Re-record / edit text');
          re.addEventListener('click', function () { core.setState('ready'); });
          body.appendChild(re);
          break;

        case 'generating':
          body.appendChild(el('h2', 'mlsp-title', 'Generating…'));
          renderNarration(body, s);
          break;

        case 'review':
          body.appendChild(el('h2', 'mlsp-title', 'Review'));
          if (s.mismatch) renderMismatch(body, s);
          renderReviewRows(body, s);
          body.appendChild(el('span', 'mlsp-writebadge', 'WRITES TO CHART · DOES NOT SIGN'));
          body.appendChild(bigBtn('✍  Write to chart', 'primary', function () { core.writeBack(false); }));
          var edit = el('button', 'mlsp-btn secondary', 'Edit the note');
          edit.addEventListener('click', function () { core.narrate('Open the full note editor in the MLS tab to edit.', 'note'); });
          body.appendChild(edit);
          break;

        case 'writingback':
        case 'codeswriting':
          body.appendChild(el('h2', 'mlsp-title', s.state === 'codeswriting' ? 'Adding codes…' : 'Writing to chart…'));
          if (s.mismatch) renderMismatch(body, s);
          renderNarration(body, s);
          break;

        case 'written':
          body.appendChild(el('h2', 'mlsp-title', s.signedConfirmed ? '✓ Signed & saved' : '✓ Draft written'));
          body.appendChild(el('p', 'mlsp-sub', summaryLine(s)));
          renderNarration(body, s);
          if (s.signedConfirmed) {
            body.appendChild(el('p', 'mlsp-sub', 'Athena confirmed the note was signed & saved.'));
          } else {
            body.appendChild(el('p', 'mlsp-sub', 'The note is written (unsigned). You can sign & save it in Athena from here, or do it yourself.'));
            body.appendChild(el('span', 'mlsp-writebadge', 'SIGNS THE CHART · ONLY ON YOUR CLICK'));
            body.appendChild(bigBtn('🖊  Sign & Save in Athena', 'primary', function () { core.signSave(); }, s.busy));
            body.appendChild(bigBtn('Just open Athena (I’ll sign) →', 'ghost', function () {
              transport.send({ type: 'MLS_OVL_FOCUS_ATHENA' }); // brings tab forward, clicks nothing
            }));
          }
          var next = el('button', 'mlsp-btn secondary', '→ Next patient');
          next.addEventListener('click', function () { core.reset(); core.refreshStatus(); });
          body.appendChild(next);
          break;
      }
    }

    function renderMismatch(body, s) {
      var box = el('div', 'mlsp-mismatch');
      box.appendChild(el('b', null, 'Patient mismatch — nothing was written.'));
      var m = s.mismatch || {};
      box.appendChild(el('div', null, 'MLS: ' + idStr(m.mlsIdentity)));
      box.appendChild(el('div', null, 'Open chart: ' + idStr(m.chartIdentity)));
      var ov = el('button', 'mlsp-btn danger', 'Write anyway — I confirmed this patient');
      ov.addEventListener('click', function () { core.writeBack(true); });
      box.appendChild(ov);
      body.appendChild(box);
    }

    function renderReviewRows(body, s) {
      if (!s.note) return;
      addRow(body, 'Note', s.note.soap || s.note.text || '');
      if (s.note.insurance) addRow(body, 'Insurance note', s.note.insurance);
      var codeBox = el('div', null);
      if (s.note.em_level) codeBox.appendChild(chip('E/M ' + s.note.em_level, 'ok'));
      (chipsFor(s, 'icd10')).forEach(function (c) { codeBox.appendChild(c); });
      (chipsFor(s, 'cpt')).forEach(function (c) { codeBox.appendChild(c); });
      if (codeBox.childNodes.length) {
        var det = document.createElement('details'); det.className = 'mlsp-row'; det.open = true;
        det.appendChild(el('summary', null, 'Codes'));
        var b = el('div', 'mlsp-rowbody'); b.appendChild(codeBox); det.appendChild(b);
        body.appendChild(det);
      }
    }
    function chipsFor(s, key) {
      var list = (s.note && s.note[key]) || [];
      var status = (s.codes && s.codes.status) || {};
      return list.map(function (c) {
        var code = c.code || c;
        var stt = status[code] || 'ok';   // ok | offsheet | retired
        var cls = stt === 'retired' ? 'bad' : (stt === 'offsheet' ? 'warn' : 'ok');
        var label = code + (stt === 'retired' ? ' (retired)' : (stt === 'offsheet' ? ' (off-sheet)' : ''));
        return chip(label, cls);
      });
    }
    function chip(text, kind) {
      var c = el('span', 'mlsp-chip' + (kind === 'warn' ? ' warn' : (kind === 'bad' ? ' bad' : '')), text);
      return c;
    }
    function addRow(body, title, content) {
      var det = document.createElement('details'); det.className = 'mlsp-row';
      det.appendChild(el('summary', null, title));
      det.appendChild(el('div', 'mlsp-rowbody', content));
      body.appendChild(det);
    }

    function enableDrag(handle) {
      var sx, sy, ox, oy, dragging = false;
      handle.addEventListener('mousedown', function (e) {
        dragging = true; handle.classList.add('mlsp-dragging');
        var r = root.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        e.preventDefault();
      });
      document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        pos = { left: Math.max(0, ox + (e.clientX - sx)), top: Math.max(0, oy + (e.clientY - sy)) };
        applyPos();
      });
      document.addEventListener('mouseup', function () {
        if (!dragging) return; dragging = false; handle.classList.remove('mlsp-dragging'); savePos();
      });
    }

    // streamed progress (real events only)
    transport.onMessage(function (m) { core.ingest(m); });

    // first paint + status
    paint(core.st);
    core.refreshStatus();
    /* v1.51: keep the pill honest — re-check the OPEN chart every 5s (read-only,
       passive; re-renders only on change so it never steals typing focus). */
    try { setInterval(function () { core.refreshStatus(); }, 5000); } catch (e) {}

    return {
      installed: true, version: VERSION, core: core,
      revert: function () {
        var n = document.getElementById('mls-popup-root'); if (n) n.remove();
        if (window.__mlsPopup) window.__mlsPopup.installed = false;
      }
    };
  }

  function connHint(s) {
    if (!s.conn.ext) return 'MLS isn’t connected — reload the extension.';
    if (!s.conn.athenaOpen) return 'Open / sign into athenaOne.';
    if (!s.conn.mlsApp) return 'Sign into mlsscribe.com in a tab.';
    if (!s.conn.patientOpen) return 'Open a patient in Athena first.';
    return '';
  }
  function idStr(id) { id = id || {}; return (id.name || '?') + (id.dob ? ' (' + id.dob + ')' : ''); }
  function summaryLine(s) {
    var w = s.written || {}; var parts = [];
    if ((w.sections || []).length) parts.push('Note → ' + w.sections.map(function (x) { return x.section; }).join(', '));
    if ((w.codesAdded || []).length) parts.push(w.codesAdded.length + ' code(s) added');
    if ((w.codesMissed || []).length) parts.push(w.codesMissed.length + ' to add by hand');
    return parts.join(' · ') || 'Draft written (unsigned).';
  }

  // ---- boot ----
  var api = { installed: true, version: VERSION, createCore: createCore };
  if (hasDOM) {
    var inst = mountDOM();
    if (inst) { api.revert = inst.revert; api.core = inst.core; }
    // re-mount if Athena's SPA wipes the node
    if (typeof MutationObserver !== 'undefined' && document.body) {
      var mo = new MutationObserver(function () {
        if (ATHENA_RE.test(location.href) && !document.getElementById('mls-popup-root')) {
          var again = mountDOM(); if (again) { api.revert = again.revert; api.core = again.core; }
        }
      });
      try { mo.observe(document.body, { childList: true, subtree: false }); } catch (e) {}
    }
  }

  if (typeof window !== 'undefined') window.__mlsPopup = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createCore: createCore, VERSION: VERSION };
})();
