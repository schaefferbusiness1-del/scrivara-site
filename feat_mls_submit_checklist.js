/* feat_mls_submit_checklist.js  ->  window.__mlsSubmitChecklist  (v1.0.0)
 * =====================================================================
 * PRIMARY: turn MLS Easy Slide 5 ("Finish") into a destination CHECKLIST
 * with checkboxes + a SINGLE "Submit" button, so the doctor can save the
 * finished note to multiple places at once (Michael: "what if I want to
 * save to my history AND save to Athena").
 *
 * Destinations (each REUSES the real existing function — nothing reimplemented):
 *   [x] Save to MLS history     -> window.saveCurrentNote(false)
 *                                  (verified REAL by a getNotes() before/after diff)
 *   [ ] Write note to Athena    -> window.__mlsAthenaWriteback.writeNoteToChart()
 *       chart                      (the §62/§74 guarded path: name+DOB gate,
 *                                  NEVER signs; we additionally gate the ATTEMPT
 *                                  on __mlsConnTruth.isConnected() and never try a
 *                                  write when not really connected)
 *   [ ] After-visit summary     -> window.generateAVS()
 *                                  (opens/produces the patient summary for review;
 *                                  it is NEVER auto-sent)
 *
 * Submit runs every CHECKED destination IN ORDER and shows HONEST, REAL per-
 * destination status (done / failed — never fabricated), then advances ("does
 * next") only when nothing failed. A failure keeps the panel up so it is never
 * hidden behind a green "next".
 *
 * SAFETY (matches the standing MLS guardrails):
 *   - "Write note to Athena chart" via Submit is a DELIBERATE doctor action (he
 *     ticked it + pressed Submit). It routes to the EXISTING guarded write-back,
 *     which keeps the name+DOB patient-match gate and NEVER clicks Save/Sign.
 *   - There is NO auto-Save&Sign here and no "Sign" capability is invoked. The
 *     Athena write is an UNSIGNED draft; the doctor signs in Athena. (No "Sign"
 *     checkbox is offered because auto-signing is intentionally not a capability.)
 *   - The Athena row is DISABLED with an honest reason whenever
 *     __mlsConnTruth.isConnected() is false (single source of truth, re-read at
 *     render time) — so a write is never attempted into a phantom connection.
 *   - Additive, idempotent, reversible (window.__mlsSubmitChecklist.revert()).
 *     Wraps no existing function. Composes with §70 (__mlsProtocol): it hides the
 *     §70 finish-tail buttons (#mlsProtoTail) only while the checklist is shown,
 *     and restores them on revert. No PHI is read, logged, or written. NUL-free.
 * ===================================================================== */
(function () {
  'use strict';
  try { if (window.__mlsSubmitChecklist && window.__mlsSubmitChecklist.installed) return; } catch (e) { return; }

  var VERSION = '1.0.0';
  var ASSET = 'feat_mls_submit_checklist.js';
  var STYLE_ID = 'mlsSubmitChecklistStyle';
  var PANEL_ID = 'mlsSubmitChecklist';
  var ON_CLASS = 'mlssk-on';

  /* ---------------- tiny safe helpers ---------------- */
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
  function esc(s) {
    try { if (window.esc) return window.esc(s); } catch (e) {}
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m, k) { safe(function () { window.toast && window.toast(m, k || ''); }); }
  function panel() { return gid('mlsEasyPanel'); }
  function body() { var p = panel(); return p ? (p.querySelector('.ez-body') || p) : null; }
  function easyState() { return safe(function () { return window.__mlsEasy && window.__mlsEasy.state; }, null) || {}; }
  function curStep() { var s = easyState(); return s && s.step ? s.step : 0; }
  function inEasy() { var s = easyState(); return !s || s.mode !== 'full'; }
  function onFinish() { return curStep() === 5 && inEasy(); }

  function tlStep(text, state) {
    var ok = false;
    safe(function () { if (window.__mlsAthenaActions && window.__mlsAthenaActions._step) { window.__mlsAthenaActions._step(text, state || 'note'); ok = true; } });
    safe(function () { if (window.__mlsUxUnify && window.__mlsUxUnify.mirror) window.__mlsUxUnify.mirror(text); });
    if (!ok) toast(text);
  }

  /* ---------------- connection truth (single source) ---------------- */
  function athenaConnected() {
    var ct = window.__mlsConnTruth;
    if (ct && isFn(ct.isConnected)) return !!safe(function () { return ct.isConnected(); }, false);
    return false; // no truth source -> treat as NOT connected (honest default)
  }
  function writebackAvailable() { return !!(window.__mlsAthenaWriteback && isFn(window.__mlsAthenaWriteback.writeNoteToChart)); }
  function avsAvailable() { return isFn(window.generateAVS); }
  function mlsSaveAvailable() { return isFn(window.saveCurrentNote) && isFn(window.getNotes); }

  /* ---------------- the destination catalogue ---------------- */
  function notesSignature() {
    // a real, store-backed fingerprint of the saved notes (no PHI: ids + timestamps only)
    return safe(function () {
      var arr = window.getNotes() || [];
      return arr.length + '|' + arr.map(function (n) { return (n && n.id) + ':' + (n && (n.updated || n.created || '')); }).join(',');
    }, null);
  }

  function runSaveToHistory() {
    return new Promise(function (resolve) {
      if (!mlsSaveAvailable()) { resolve({ ok: false, msg: 'Save isn’t available right now.' }); return; }
      var before = notesSignature();
      safe(function () { window.saveCurrentNote(false); });
      // saveCurrentNote is synchronous; verify by a real store diff (a new/updated record appears).
      setTimeout(function () {
        var after = notesSignature();
        if (after != null && after !== before) {
          var nm = safe(function () { var p = window.activePatient && window.activePatient(); return p && p.name; }, '') || '';
          resolve({ ok: true, msg: nm ? ('Saved to MLS history.') : 'Saved to MLS history (Unassigned — attach it in History).' });
        } else {
          resolve({ ok: false, msg: 'Nothing was saved — generate the note first.' });
        }
      }, 60);
    });
  }

  function runWriteToAthena() {
    return new Promise(function (resolve) {
      // Re-check the SINGLE source of truth at execution time. Never attempt a
      // write into a phantom/disconnected Athena.
      if (!athenaConnected()) {
        resolve({ ok: false, msg: 'Athena not connected — nothing written. Open a signed-in athenaOne tab.' });
        return;
      }
      if (!writebackAvailable()) {
        resolve({ ok: false, msg: 'The Athena write-back isn’t loaded.' });
        return;
      }
      var settled = false;
      function settle(r) { if (settled) return; settled = true; safe(function () { window.removeEventListener('message', onMsg, true); }); resolve(r); }
      // Listen for the REAL paste result event (the same event the write path uses).
      function onMsg(ev) {
        var d = ev && ev.data; if (!d || d.source !== 'mls-ext' || d.type !== 'mlsAppPasteResult') return;
        var resp = d.resp || {};
        if (resp.ok && resp.confirmed) settle({ ok: true, msg: 'Wrote the note into the open chart — confirmed (unsigned draft; you sign in Athena).' });
        else if (resp.ok && !resp.confirmed) settle({ ok: false, msg: 'Wrote to a field but could NOT confirm — check the chart before signing.' });
        else settle({ ok: false, msg: 'Athena write did not complete — see the write-back panel for the reason.' });
      }
      safe(function () { window.addEventListener('message', onMsg, true); });
      // Hand off to the guarded write-back (name+DOB gate; never signs).
      safe(function () { window.__mlsAthenaWriteback.writeNoteToChart({}); });
      // Honest timeout: if no paste result arrives (e.g. the wrong-patient gate
      // refused, or the doctor must confirm an override in the write-back panel),
      // we DO NOT claim done — we report it as handed off + needing the panel.
      setTimeout(function () {
        settle({ ok: null, msg: 'Handed to the guarded write-back — review its panel for the confirmed/failed result (it never signs).' });
      }, 60000);
    });
  }

  function runAfterVisitSummary() {
    return new Promise(function (resolve) {
      if (!avsAvailable()) { resolve({ ok: false, msg: 'After-visit summary isn’t available.' }); return; }
      var r;
      try { r = window.generateAVS(); } catch (e) { resolve({ ok: false, msg: 'Couldn’t start the summary (' + (e && e.message || e) + ').' }); return; }
      Promise.resolve(r).then(check, function () { check(); });
      function check() {
        setTimeout(function () {
          // Real check: the AVS card/body is populated for review.
          var bodyEl = gid('avsBody');
          var txt = bodyEl ? (bodyEl.textContent || '').trim() : '';
          var card = gid('avsCard');
          var shown = card && safe(function () { return getComputedStyle(card).display !== 'none'; }, false);
          if (txt && txt.length > 0 && shown !== false) {
            resolve({ ok: true, msg: 'After-visit summary ready — review it before sending (never auto-sent).' });
          } else {
            resolve({ ok: false, msg: 'No summary produced — generate the note first.' });
          }
        }, 120);
      }
    });
  }

  var DESTS = [
    {
      id: 'save', key: 'mlssk-save', label: '💾 Save to MLS history',
      sub: 'Saves this visit into the patient’s record in MLS.',
      defChecked: true,
      avail: function () { return mlsSaveAvailable(); },
      enabled: function () { return mlsSaveAvailable(); },
      reason: function () { return 'Save isn’t available right now.'; },
      run: runSaveToHistory
    },
    {
      id: 'athena', key: 'mlssk-athena', label: '✍️ Write note to Athena chart',
      sub: 'Pastes the finished note into the chart open in athenaOne. It never signs — you review and sign in Athena.',
      badge: 'WRITES TO CHART · never signs',
      defChecked: false,
      avail: function () { return writebackAvailable(); },
      enabled: function () { return writebackAvailable() && athenaConnected(); },
      reason: function () {
        if (!writebackAvailable()) return 'The Athena write-back isn’t loaded.';
        return 'Athena not connected — open a signed-in athenaOne tab to enable this.';
      },
      run: runWriteToAthena
    },
    {
      id: 'avs', key: 'mlssk-avs', label: '🧾 After-visit summary',
      sub: 'Generates a plain-language summary for the patient. You review it before anything is sent (never auto-sent).',
      defChecked: false,
      avail: function () { return avsAvailable(); },
      enabled: function () { return avsAvailable(); },
      reason: function () { return 'After-visit summary isn’t available.'; },
      run: runAfterVisitSummary
    }
  ];

  /* ---------------- styles ---------------- */
  function injectStyle() {
    if (gid(STYLE_ID)) return;
    var st = ce('style'); st.id = STYLE_ID;
    st.textContent = [
      '#mlsEasyPanel.' + ON_CLASS + ' #mlsProtoTail{display:none !important;}', /* compose with §70: hide its tail buttons while the checklist is up */
      '#' + PANEL_ID + '{margin:12px 0 2px;padding:13px 13px 11px;border-radius:14px;',
      'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.22);}',
      '#' + PANEL_ID + ' .mlssk-h{font-size:15.5px;font-weight:800;color:#fff;line-height:1.25;margin:0 0 3px;}',
      '#' + PANEL_ID + ' .mlssk-hsub{font-size:12.8px;color:#EAF1EC;opacity:.95;line-height:1.4;margin:0 0 11px;}',
      '#' + PANEL_ID + ' .mlssk-row{display:flex;align-items:flex-start;gap:11px;padding:10px 11px;margin:0 0 8px;',
      'border-radius:12px;background:#fff;border:2px solid rgba(255,255,255,.55);}',
      '#' + PANEL_ID + ' .mlssk-row.mlssk-disabled{opacity:.62;background:#F4F2EC;border-color:rgba(255,255,255,.3);}',
      '#' + PANEL_ID + ' .mlssk-cb{flex:0 0 auto;width:22px;height:22px;margin-top:2px;cursor:pointer;accent-color:#0a7d2c;}',
      '#' + PANEL_ID + ' .mlssk-row.mlssk-disabled .mlssk-cb{cursor:not-allowed;}',
      '#' + PANEL_ID + ' .mlssk-main{flex:1 1 auto;min-width:0;}',
      '#' + PANEL_ID + ' .mlssk-lbl{font-size:15px;font-weight:800;color:#0b1f33;line-height:1.25;display:flex;align-items:center;flex-wrap:wrap;gap:7px;}',
      '#' + PANEL_ID + ' .mlssk-badge{font-size:10px;font-weight:900;letter-spacing:.03em;color:#7c2d12;background:#fde68a;border:1px solid #f59e0b;border-radius:6px;padding:2px 6px;text-transform:uppercase;}',
      '#' + PANEL_ID + ' .mlssk-sub{font-size:12.6px;font-weight:500;color:#204034;line-height:1.4;margin-top:3px;}',
      '#' + PANEL_ID + ' .mlssk-reason{font-size:12px;font-weight:700;color:#b45309;line-height:1.4;margin-top:4px;}',
      '#' + PANEL_ID + ' .mlssk-stat{font-size:12.3px;font-weight:700;line-height:1.4;margin-top:5px;display:none;}',
      '#' + PANEL_ID + ' .mlssk-stat.show{display:block;}',
      '#' + PANEL_ID + ' .mlssk-stat.run{color:#2E6A4B;}',
      '#' + PANEL_ID + ' .mlssk-stat.ok{color:#0a7a33;}',
      '#' + PANEL_ID + ' .mlssk-stat.fail{color:#b91c1c;}',
      '#' + PANEL_ID + ' .mlssk-stat.hand{color:#7c5b00;}',
      '#' + PANEL_ID + ' .mlssk-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:4px;}',
      '#' + PANEL_ID + ' .mlssk-submit{flex:1 1 auto;min-width:180px;min-height:52px;border:0;border-radius:12px;cursor:pointer;',
      'background:#0a7d2c;color:#fff;font-size:16px;font-weight:800;line-height:1.2;box-shadow:0 3px 10px rgba(8,40,20,.25);}',
      '#' + PANEL_ID + ' .mlssk-submit:disabled{background:#9aa6b2;cursor:not-allowed;box-shadow:none;}',
      '#' + PANEL_ID + ' .mlssk-submit:focus-visible{outline:3px solid #ffd34d;outline-offset:2px;}',
      '#' + PANEL_ID + ' .mlssk-next{min-height:46px;border-radius:10px;cursor:pointer;border:1px solid rgba(255,255,255,.5);',
      'background:rgba(255,255,255,.16);color:#fff;font-size:14px;font-weight:700;padding:0 15px;}',
      '#' + PANEL_ID + ' .mlssk-summary{font-size:13px;font-weight:700;color:#fff;line-height:1.4;margin:9px 1px 0;display:none;}',
      '#' + PANEL_ID + ' .mlssk-summary.show{display:block;}',
      '#' + PANEL_ID + ' .mlssk-summary.allok{color:#bff7cf;}',
      '#' + PANEL_ID + ' .mlssk-summary.somefail{color:#ffd9d0;}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------------- build the checklist ---------------- */
  var running = false;

  function rowEl(d) {
    var row = ce('div', 'mlssk-row'); row.id = 'mlsskRow-' + d.id; row.setAttribute('data-dest', d.id);
    var cb = ce('input', 'mlssk-cb'); cb.type = 'checkbox'; cb.id = 'mlsskCb-' + d.id;
    var main = ce('div', 'mlssk-main');
    var lbl = ce('label', 'mlssk-lbl'); lbl.setAttribute('for', cb.id);
    lbl.innerHTML = esc(d.label) + (d.badge ? ' <span class="mlssk-badge">' + esc(d.badge) + '</span>' : '');
    var sub = ce('div', 'mlssk-sub'); sub.textContent = d.sub;
    var reason = ce('div', 'mlssk-reason'); reason.id = 'mlsskReason-' + d.id;
    var stat = ce('div', 'mlssk-stat'); stat.id = 'mlsskStat-' + d.id;
    main.appendChild(lbl); main.appendChild(sub); main.appendChild(reason); main.appendChild(stat);
    row.appendChild(cb); row.appendChild(main);
    return row;
  }

  function build() {
    var b = body(); if (!b) return;
    if (gid(PANEL_ID)) return;
    injectStyle();
    var host = ce('div'); host.id = PANEL_ID;
    var head = '<div class="mlssk-h">Save &amp; finish — choose where this note goes:</div>' +
      '<div class="mlssk-hsub">Tick every destination you want, then press <b>Submit</b> once. It runs them in order and shows the real result of each.</div>';
    host.innerHTML = head;
    DESTS.forEach(function (d) { if (d.avail()) host.appendChild(rowEl(d)); });
    var foot = ce('div', 'mlssk-foot');
    foot.innerHTML = '<button type="button" class="mlssk-submit" id="mlsskSubmit">Submit</button>';
    host.appendChild(foot);
    var summary = ce('div', 'mlssk-summary'); summary.id = 'mlsskSummary';
    host.appendChild(summary);

    // place after the §70 tail if present, else after .ez-actions, else append
    var anchor = gid('mlsProtoTail') || b.querySelector('.ez-actions') || null;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor.nextSibling);
    else b.appendChild(host);

    // default checks
    DESTS.forEach(function (d) {
      var cb = gid('mlsskCb-' + d.id); if (cb) cb.checked = !!d.defChecked && d.enabled();
    });
    var sb = gid('mlsskSubmit');
    if (sb && !sb.__mlssk) { sb.__mlssk = true; sb.addEventListener('click', onSubmit); }
    refreshEnable();
    safe(function () { panel().classList.add(ON_CLASS); });
  }

  // Re-read the single source of truth at render time and enable/disable rows.
  function refreshEnable() {
    if (running) return;
    DESTS.forEach(function (d) {
      var row = gid('mlsskRow-' + d.id); if (!row) return;
      var cb = gid('mlsskCb-' + d.id); var reason = gid('mlsskReason-' + d.id);
      var en = d.enabled();
      if (en) {
        row.classList.remove('mlssk-disabled');
        if (cb) cb.disabled = false;
        if (reason) reason.textContent = '';
      } else {
        row.classList.add('mlssk-disabled');
        if (cb) { cb.checked = false; cb.disabled = true; }
        if (reason) reason.textContent = d.reason();
      }
    });
  }

  function setStat(id, cls, msg) {
    var s = gid('mlsskStat-' + id); if (!s) return;
    s.className = 'mlssk-stat show ' + cls;
    s.textContent = msg;
  }

  function onSubmit() {
    if (running) return;
    var chosen = DESTS.filter(function (d) { var cb = gid('mlsskCb-' + d.id); return cb && cb.checked && !cb.disabled; });
    if (!chosen.length) { toast('Tick at least one destination first.', 'err'); return; }
    running = true;
    var sb = gid('mlsskSubmit'); if (sb) { sb.disabled = true; sb.textContent = 'Submitting…'; }
    var sum = gid('mlsskSummary'); if (sum) { sum.className = 'mlssk-summary'; sum.textContent = ''; }
    // disable checkboxes during run
    DESTS.forEach(function (d) { var cb = gid('mlsskCb-' + d.id); if (cb) cb.disabled = true; });
    var results = [];
    tlStep('Submitting the visit to ' + chosen.length + ' destination' + (chosen.length > 1 ? 's' : '') + '…', 'run');

    // run sequentially, in declared order
    var ordered = DESTS.filter(function (d) { return chosen.indexOf(d) >= 0; });
    var i = 0;
    function next() {
      if (i >= ordered.length) return finish();
      var d = ordered[i++];
      setStat(d.id, 'run', '… running');
      Promise.resolve().then(d.run).then(function (r) {
        r = r || {};
        if (r.ok === true) { setStat(d.id, 'ok', '✓ ' + r.msg); results.push({ id: d.id, ok: true }); }
        else if (r.ok === null) { setStat(d.id, 'hand', '→ ' + r.msg); results.push({ id: d.id, ok: null }); }
        else { setStat(d.id, 'fail', '✗ ' + r.msg); results.push({ id: d.id, ok: false }); }
        next();
      }, function (e) {
        setStat(d.id, 'fail', '✗ Unexpected error (' + (e && e.message || e) + ').');
        results.push({ id: d.id, ok: false }); next();
      });
    }

    function finish() {
      running = false;
      var failed = results.filter(function (r) { return r.ok === false; }).length;
      var handed = results.filter(function (r) { return r.ok === null; }).length;
      var okc = results.filter(function (r) { return r.ok === true; }).length;
      var sum = gid('mlsskSummary');
      var sb = gid('mlsskSubmit');
      if (failed === 0 && handed === 0) {
        if (sum) { sum.className = 'mlssk-summary show allok'; sum.textContent = '✓ All ' + okc + ' destination' + (okc > 1 ? 's' : '') + ' done.'; }
        tlStep('All selected destinations completed.', 'done');
        // advance ("does next") only when nothing failed / nothing left pending
        if (sb) { sb.disabled = false; sb.textContent = 'Submit'; }
        advanceSoon();
      } else {
        var parts = [];
        if (okc) parts.push(okc + ' done');
        if (handed) parts.push(handed + ' handed off');
        if (failed) parts.push(failed + ' failed');
        if (sum) { sum.className = 'mlssk-summary show somefail'; sum.textContent = parts.join(' · ') + '. Review the lines above — nothing is hidden. Fix and Submit again, or continue.'; }
        tlStep('Submit finished: ' + parts.join(', ') + '.', failed ? 'fail' : 'warn');
        // do NOT auto-advance over a failure; offer an explicit "next patient"
        if (sb) { sb.disabled = false; sb.textContent = 'Submit'; }
        offerNext();
        // re-enable checkboxes so the doctor can retry
        refreshEnable();
      }
    }
    next();
  }

  function offerNext() {
    var foot = gid(PANEL_ID) ? gid(PANEL_ID).querySelector('.mlssk-foot') : null;
    if (!foot || foot.querySelector('.mlssk-next')) return;
    var b = ce('button', 'mlssk-next'); b.type = 'button'; b.textContent = 'Done — start next patient →';
    b.addEventListener('click', advanceNow);
    foot.appendChild(b);
  }

  var _advT = null;
  function advanceSoon() { _advT = setTimeout(advanceNow, 1400); }
  function advanceNow() {
    if (_advT) { clearTimeout(_advT); _advT = null; }
    // "does next" — start the next patient via the real flow (back to Slide 1).
    var ez = window.__mlsEasy;
    if (ez && isFn(ez.goto)) safe(function () { ez.goto(1); });
  }

  /* ---------------- keep present on step 5; remove elsewhere ---------------- */
  function teardownUI() {
    safe(function () { var h = gid(PANEL_ID); if (h) h.remove(); });
    safe(function () { var p = panel(); if (p) p.classList.remove(ON_CLASS); });
    if (_advT) { clearTimeout(_advT); _advT = null; }
  }

  var _obs = null, _pollT = null, _raf = 0;
  function tick() {
    safe(function () {
      injectStyle();
      if (onFinish()) {
        build();
        if (!running) refreshEnable();
      } else {
        if (gid(PANEL_ID)) teardownUI();
      }
    });
  }
  function scheduleTick() {
    if (_raf) return;
    _raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { _raf = 0; tick(); });
  }
  function startObserver() {
    safe(function () { _obs = new MutationObserver(function () { scheduleTick(); }); _obs.observe(document.body, { childList: true, subtree: true }); });
    _pollT = setInterval(tick, 1500);
  }

  /* ---------------- revert ---------------- */
  function revert() {
    safe(function () { if (_obs) _obs.disconnect(); });
    safe(function () { if (_pollT) clearInterval(_pollT); });
    if (_advT) { clearTimeout(_advT); _advT = null; }
    teardownUI();
    safe(function () { var st = gid(STYLE_ID); if (st) st.remove(); });
    safe(function () { window.__mlsSubmitChecklist.installed = false; });
  }

  /* ---------------- boot ---------------- */
  function boot() { injectStyle(); startObserver(); scheduleTick(); }

  window.__mlsSubmitChecklist = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    build: build,
    refreshEnable: refreshEnable,
    _dests: DESTS,
    _runSave: runSaveToHistory,
    _runAthena: runWriteToAthena,
    _runAvs: runAfterVisitSummary,
    _onSubmit: onSubmit,
    revert: revert
  };

  try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }
  catch (e) { safe(boot); }
})();
