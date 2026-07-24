/* =========================================================================
   MLS Seamless Athena Pop-up  —  content-script overlay  (v1.61)
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

  var VERSION = '1.61';
  var DISPLAY_VERSION = VERSION;
  try {
    var manifestVersion = String(chrome.runtime.getManifest().version || '').trim();
    if (/^\d+(?:\.\d+){0,3}$/.test(manifestVersion)) DISPLAY_VERSION = manifestVersion;
  } catch (eVersion) {}

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
      var handler = function (m, sender, sendResponse) {
        try { return cb(m, sender, sendResponse); } catch (e) { return false; }
      };
      chrome.runtime.onMessage.addListener(handler);
      return function () { try { chrome.runtime.onMessage.removeListener(handler); } catch (e) {} };
    }
  };

  // ====================================================================== //
  //  CORE STATE MACHINE  (pure-ish — drives rendering; unit-tested)         //
  // ====================================================================== //
  var STATES = ['idle','pulling','ready','captured','generating',
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
      note: null,              // {soap, insurance, em_level, icd10[], cpt[], ...}
      codes: null,             // validated codes from __mlsCodeSheet
      mismatch: null,          // {mlsIdentity, chartIdentity} when the gate blocks
      written: null,           // {sections[], codesAdded[], codesMissed[]}
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
           stale lock instead of offering actions under the wrong identity.
           The writeback hard gate still protects every attempted write. */
        var changed = false;
        if (st.patient && st.patient.name && !st.busy && st.state !== 'idle') {
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

    // ---- STEP 2: current-visit note ------------------------------------
    // Audio capture is owned by the MLS Visit screen/linked phone. This
    // overlay deliberately accepts only a visible typed or pasted note until
    // extension transcription is implemented and certified end to end.
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

    function reset() {
      st.state = 'idle'; st.patient = null; st.visitCount = null; st.transcript = '';
      st.typedNotes = ''; st.note = null; st.codes = null;
      st.mismatch = null; st.written = null; st.narration = []; st.error = null; st.busy = false;
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
    }

    return {
      st: st, STATES: STATES,
      render: render, setState: setState, narrate: narrate,
      refreshStatus: refreshStatus, connColor: connColor, canGo: canGo,
      go: go,
      setTypedNotes: setTypedNotes, hasContent: hasContent,
      generate: generate, writeBack: writeBack, reset: reset, ingest: ingest,
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
  function isAthenaProductHost() {
    try { return String(location.hostname || '').toLowerCase() === 'athenanet.athenahealth.com'; }
    catch (e) { return false; }
  }

  function mountDOM() {
    if (!hasDOM) return null;
    if (!isAthenaProductHost()) return null;
    /* Owner 2026-07-24: "just remove this mls thing - the one that pops up
       when on athena". This is the only unrequested overlay MLS puts on top
       of a live chart, and the doctor already drives every pull, read and
       write from the MLS app itself, so the widget only duplicates a surface
       the owner is deliberately simplifying. Not deleted: the module stays
       loaded and window.__mlsPopup keeps its entire API, so anything calling
       into it still works and re-enabling is a flag rather than a revert -
       set window.__mlsPopupShowOnAthena = true before load. mountDOM already
       returns null on three other paths, so every caller handles this. */
    if (window.__mlsPopupShowOnAthena !== true) return null;
    if (document.getElementById('mls-popup-root')) return null;

    var root = document.createElement('div');
    root.id = 'mls-popup-root';
    (document.body || document.documentElement).appendChild(root);

    var core = createCore({ transport: transport, onRender: paint });
    var collapsed = true;
    var pos = null;
    var disposed = false, statusTimer = 0, offRuntime = function () {}, clearDrag = function () {};
    var dragMoved = false; /* v1.61: true only between a real drag's mouseup and the click it spawns */

    // restore persisted position / collapsed state
    try {
      if (hasChrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['mlsPopupPos', 'mlsPopupCollapsed'], function (v) {
          if (v && v.mlsPopupPos) { pos = v.mlsPopupPos; applyPos(); }
          if (v && typeof v.mlsPopupCollapsed === 'boolean') { collapsed = v.mlsPopupCollapsed; paint(core.st); }
        });
      }
    } catch (e) {}

    function clampPos(next) {
      next = next || {};
      var r = root.getBoundingClientRect();
      var w = Math.max(48, Number(r.width) || 48), h = Math.max(40, Number(r.height) || 40);
      var maxLeft = Math.max(0, (window.innerWidth || w) - w);
      var maxTop = Math.max(0, (window.innerHeight || h) - h);
      return {
        left: Math.max(0, Math.min(maxLeft, Number(next.left) || 0)),
        top: Math.max(0, Math.min(maxTop, Number(next.top) || 0))
      };
    }
    function applyPos() {
      if (!pos) return;
      pos = clampPos(pos);
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
      if (disposed) return;
      var focus = null, active = document.activeElement;
      try {
        if (active && root.contains(active) && active.getAttribute('data-mlsp-focus')) {
          focus = { key: active.getAttribute('data-mlsp-focus'), start: active.selectionStart, end: active.selectionEnd };
        }
      } catch (e) {}
      root.innerHTML = '';
      if (collapsed) root.appendChild(renderPill(s));
      else root.appendChild(renderCard(s));
      applyPos();
      if (focus) {
        try {
          var restored = root.querySelector('[data-mlsp-focus="' + focus.key + '"]');
          if (restored) { restored.focus(); if (restored.setSelectionRange) restored.setSelectionRange(focus.start, focus.end); }
        } catch (e2) {}
      }
    }

    function openSurface() {
      if (disposed) return false;
      collapsed = false; saveCollapsed(); paint(core.st); core.refreshStatus();
      setTimeout(applyPos, 0);
      return true;
    }

    function renderPill(s) {
      var pill = el('div', 'mlsp-pill');
      var dot = el('span', 'mlsp-dot ' + core.connColor());
      pill.appendChild(dot);
      pill.appendChild(el('span', null, '🩺 MLS'));
      /* v1.61: the collapsed pill is draggable too — a real drag moves it
         (and never pops the card open); a plain click still opens it. */
      pill.addEventListener('click', function () {
        if (dragMoved) { dragMoved = false; return; }
        openSurface();
      });
      enableDrag(pill);
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
      foot.appendChild(el('span', null, 'v' + DISPLAY_VERSION));
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
          body.appendChild(el('p', 'mlsp-sub', s.conn.patientOpen ? 'Pull the open patient\'s history into MLS.' : 'Open a patient below, then pull their history into MLS.'));
          body.appendChild(bigBtn('▶  Pull history', 'primary', function () { core.go(); }, !core.canGo()));
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
          var notes1 = el('textarea', 'mlsp-notes'); notes1.placeholder = 'Type or paste the current visit note…';
          notes1.setAttribute('data-mlsp-focus', 'visit-note');
          notes1.value = s.typedNotes; notes1.addEventListener('input', function (e) { core.setTypedNotes(e.target.value, true); }); /* v1.42 fix #3: silent update — keep focus while typing */
          body.appendChild(notes1);
          body.appendChild(el('p', 'mlsp-sub', 'Record in the MLS Visit screen or on your linked phone. This Athena widget accepts an existing current-visit note.'));
          var continueBtn = el('button', 'mlsp-btn primary', 'Continue to draft review →');
          continueBtn.addEventListener('click', function () {
            if (core.hasContent()) core.setState('captured');
            else core.narrate('Type or paste the current visit note first.', 'warn');
          });
          body.appendChild(continueBtn);
          break;

        case 'captured':
          body.appendChild(el('h2', 'mlsp-title', 'Ready to build the draft'));
          body.appendChild(el('p', 'mlsp-sub', 'Generate a reviewable note and code draft. Nothing is written yet.'));
          body.appendChild(bigBtn('✨  Generate review draft', 'primary', function () { core.generate(); }));
          var re = el('button', 'mlsp-btn secondary', 'Edit current note');
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
          body.appendChild(el('h2', 'mlsp-title', '✓ Draft written'));
          body.appendChild(el('p', 'mlsp-sub', summaryLine(s)));
          renderNarration(body, s);
          body.appendChild(el('p', 'mlsp-sub', 'The draft is not saved, signed, or attested. Review it in Athena and complete the final action yourself.'));
          body.appendChild(bigBtn('Review and finish in Athena →', 'ghost', function () {
            transport.send({ type: 'MLS_OVL_FOCUS_ATHENA' }); // brings tab forward, clicks nothing
          }));
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
      box.appendChild(el('p', 'mlsp-sub', 'Open the correct patient chart in athenaOne, press Go again, and retry. There is no wrong-patient override.'));
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
      var sx, sy, ox, oy, dragging = false, moved = false;
      clearDrag();
      function onDown(e) {
        dragging = true; moved = false; dragMoved = false; handle.classList.add('mlsp-dragging');
        var r = root.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        e.preventDefault();
      }
      function onMove(e) {
        if (!dragging) return;
        /* v1.61: 4px threshold — a shaky click is a click, not a drag */
        if (!moved && Math.abs(e.clientX - sx) < 4 && Math.abs(e.clientY - sy) < 4) return;
        moved = true;
        pos = clampPos({ left: ox + (e.clientX - sx), top: oy + (e.clientY - sy) });
        applyPos();
      }
      function onUp() {
        if (!dragging) return; dragging = false; handle.classList.remove('mlsp-dragging');
        if (!moved) return;
        savePos();
        /* v1.61: the click that follows a real drag must not activate the
           handle (pill click = expand). dragMoved covers the handle's own
           listeners; the capture-phase swallow covers descendants
           (same proven pattern as feat_fab_layout.js). */
        dragMoved = true;
        var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); handle.removeEventListener('click', swallow, true); };
        handle.addEventListener('click', swallow, true);
        setTimeout(function () { try { handle.removeEventListener('click', swallow, true); dragMoved = false; } catch (e) {} }, 60);
      }
      handle.addEventListener('mousedown', onDown);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      clearDrag = function () {
        try { handle.removeEventListener('mousedown', onDown); } catch (e) {}
        try { document.removeEventListener('mousemove', onMove); } catch (e2) {}
        try { document.removeEventListener('mouseup', onUp); } catch (e3) {}
        dragging = false;
      };
    }

    // One runtime listener owns both streamed progress and toolbar expansion.
    offRuntime = transport.onMessage(function (m, sender, sendResponse) {
      if (m && m.type === 'mlsOpenPanel') {
        var opened = openSurface();
        try { if (sendResponse) sendResponse({ ok: opened, surface: 'athena-widget' }); } catch (e) {}
        return false;
      }
      core.ingest(m);
      return false;
    });

    // first paint + status
    paint(core.st);
    core.refreshStatus();
    /* v1.51: keep the pill honest — re-check the OPEN chart every 5s (read-only,
       passive; re-renders only on change so it never steals typing focus). */
    try { statusTimer = setInterval(function () { if (!disposed) core.refreshStatus(); }, 5000); } catch (e) {}
    function onResize() { if (pos) { applyPos(); savePos(); } }
    try { window.addEventListener('resize', onResize); } catch (eResize) {}

    return {
      installed: true, version: VERSION, core: core,
      open: openSurface,
      dispose: function () {
        if (disposed) return;
        disposed = true;
        try { if (statusTimer) clearInterval(statusTimer); } catch (e) {}
        statusTimer = 0;
        try { offRuntime(); } catch (e2) {}
        offRuntime = function () {};
        try { clearDrag(); } catch (e3) {}
        clearDrag = function () {};
        try { window.removeEventListener('resize', onResize); } catch (e4) {}
        var n = document.getElementById('mls-popup-root'); if (n) n.remove();
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
  var api = { installed: true, version: VERSION, createCore: createCore, _stopped: false };
  var inst = null, mo = null;
  function bindInstance(next) {
    inst = next || null;
    api.core = inst ? inst.core : null;
    return inst;
  }
  api.open = function () { return !!(inst && inst.open && inst.open()); };
  api.revert = function () {
    if (api._stopped) return;
    api._stopped = true;
    try { if (mo) mo.disconnect(); } catch (e) {}
    mo = null;
    try { if (inst && inst.dispose) inst.dispose(); } catch (e2) {}
    bindInstance(null);
    api.installed = false;
  };
  if (hasDOM && isAthenaProductHost()) {
    bindInstance(mountDOM());
    // Athena's SPA may replace the content-script root. Dispose the prior
    // owner before remounting so only one listener/timer/drag lifecycle lives.
    if (typeof MutationObserver !== 'undefined' && document.body) {
      mo = new MutationObserver(function () {
        if (api._stopped || document.getElementById('mls-popup-root')) return;
        try { if (inst && inst.dispose) inst.dispose(); } catch (e) {}
        bindInstance(mountDOM());
      });
      try { mo.observe(document.body, { childList: true, subtree: false }); } catch (eObserve) {}
    }
  }

  if (typeof window !== 'undefined') window.__mlsPopup = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createCore: createCore, VERSION: VERSION };
})();
