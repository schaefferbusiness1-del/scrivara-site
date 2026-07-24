/* feat_save_verify.js  —  MLS Save-Integrity Verification layer
 * window.__mlsSaveVerify (v1.0.2)
 *
 * PURPOSE (Michael's ask): every time data is saved/restored, automatically
 * SCAN the persisted store and HONESTLY confirm it actually landed — or flag
 * exactly what is missing. Real re-reads only. Never fabricate a pass.
 *
 * HOW IT TRIGGERS (robust, non-competing chokepoints — never wraps the fragile
 * __mlsCopyVisits.run, which the real Copy-every-visit BUTTON bypasses):
 *  - Athena copy-every-visit pull: a capture-phase listener catches the
 *    extension's `mlsAppAllVisitsResult` window message (the same shared event
 *    family the §50 counter-guard uses) → records the INTENDED visits → after
 *    the app persists them, re-reads the patient's STORED visits and confirms
 *    each intended visit is present (by id / _visitKey) with key fields intact.
 *    Reports "✓ Saved N of N visits" or "⚠ Only X of N — [which]".
 *  - ALL saves (manual add, cohort import, visit edits, AND the pull's own
 *    persistence) flow through `window.upsertPatient` — hooked to re-read
 *    getPatients() afterwards and confirm the record persisted. A debounce
 *    coalesces the many upserts of one pull into a single verification.
 *
 * Local store (localStorage['uns_patients'], what survives reload and what
 * upsertPatient writes) is ALWAYS verified definitively. The server layer is
 * independently re-read (READ-ONLY GET /api/patients, reusing the app's own
 * auth) when server mode is on; otherwise the result honestly says the local
 * layer was verified. Never a fabricated pass; if it can't verify, it says so.
 *
 * On-demand: a "🛡 Verify saved data" button on the profile card +
 * window.__mlsSaveVerify.scan(). Lightweight, idempotent, no jitter/loops,
 * additive, instantly reversible (window.__mlsSaveVerify.revert()).
 * No PHI is logged or sent anywhere.
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';
  var ASSET = 'feat_save_verify.js';

  if (window.__mlsSaveVerify && window.__mlsSaveVerify.installed) { return; }

  // ---------------------------------------------------------------------------
  // small safe accessors
  // ---------------------------------------------------------------------------
  function fn(name) {
    try { return (typeof window[name] === 'function') ? window[name] : null; }
    catch (e) { return null; }
  }
  function model() { try { return window.__mlsVisitModel || null; } catch (e) { return null; } }
  function safe(f) { try { return f(); } catch (e) { return null; } }

  function normDob(d) {
    var m = model();
    if (m && typeof m._normDob === 'function') { try { var r = m._normDob(d); if (r) return String(r); } catch (e) {} }
    return (d == null ? '' : String(d)).trim();
  }
  function lc(s) { return (s == null ? '' : String(s)).trim().toLowerCase(); }
  function arr(a) { return Array.isArray(a) ? a.slice() : []; }
  function arrS(a) { return arr(a).map(function (x) { return String(x); }); }

  // realContent — consistent with the §48 honest guard (excludes aiSummary).
  function realContent(v) {
    if (!v) return false;
    return !!(v.raw ||
      (Array.isArray(v.cpt) && v.cpt.length) ||
      (Array.isArray(v.icd10) && v.icd10.length) ||
      v.meds || v.findings || v.plan);
  }

  function visitId(v) { return (v && v.id != null) ? String(v.id) : ''; }

  function visitKey(v) {
    var m = model();
    if (m && typeof m._visitKey === 'function') {
      try { var k = m._visitKey(v); if (k) return String(k); } catch (e) {}
    }
    if (!v) return '';
    var date = '';
    if (m && typeof m._svcToYMD === 'function') { try { date = m._svcToYMD(v.date) || ''; } catch (e) {} }
    if (!date) date = (v.date == null ? '' : String(v.date)).trim();
    var type = lc(v.type || v.procedure);
    var cpt = arrS(v.cpt).sort()[0] || '';
    return date + '|' + type + '|' + cpt;
  }

  /* sv-1.0.3 (owner screenshot 2026-07-21): the dedupe guards deliberately
     FOLD a pulled name variant ("Ellis Huff") into the existing full record
     ("Ellis R Huff") under a DIFFERENT id — the save persists, but this
     verifier's exact-name fallback could not see it, so every pull carrying a
     name variant produced a false "Save not confirmed". The fallback now
     mirrors the dedupe's identity rules: DOB- or MRN-anchored with
     token-tolerant names (prefix / single-initial). Never name-only fuzzy. */
  function _svNameTokens(s) { return lc(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; }); }
  function _svTokensCompatible(refName, storedName) {
    var A = _svNameTokens(refName);
    if (!A.length) return false;
    var Ball = lc(storedName).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (!Ball.length) return false;
    function okTok(t) {
      for (var i = 0; i < Ball.length; i++) {
        var h = Ball[i];
        if (h === t) return true;
        if (h.length >= 4 && t.length >= 4 && (h.indexOf(t) === 0 || t.indexOf(h) === 0)) return true;
        if (h.length === 1 && h === t.charAt(0)) return true;
      }
      return false;
    }
    var hits = 0; A.forEach(function (t) { if (okTok(t)) hits++; });
    return hits >= Math.min(2, A.length) && okTok(A[0]) && okTok(A[A.length - 1]);
  }
  function _svMrn(x) { return String((x && (x.athenaId || x.mrn)) || '').replace(/[^a-z0-9]/gi, '').toLowerCase(); }
  // Re-read a patient FRESH from the persisted store — never a stale in-memory ref.
  function freshPatient(ref) {
    var gp = fn('getPatients');
    if (!gp || !ref) return null;
    var list;
    try { list = gp() || []; } catch (e) { return null; }
    var rid = ref.id != null ? String(ref.id) : null;
    var rname = lc(ref.name);
    var rdob = normDob(ref.dob);
    var rmrn = _svMrn(ref);
    var byKey = null, byFold = null;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p) continue;
      if (rid && p.id != null && String(p.id) === rid) return p;
      var pdob = normDob(p.dob);
      if (!byKey && rname && lc(p.name) === rname) {
        if (!rdob || !pdob || pdob === rdob) byKey = p;
      }
      if (!byKey && !byFold) {
        var pmrn = _svMrn(p);
        if (rmrn && pmrn && rmrn === pmrn) byFold = p;
        else if (rdob && pdob && rdob === pdob && _svTokensCompatible(ref.name, p.name)) byFold = p;
      }
    }
    return byKey || byFold;
  }

  function storedVisits(p) {
    var m = model();
    if (m && typeof m.getVisits === 'function') { try { return m.getVisits(p) || []; } catch (e) {} }
    return (p && Array.isArray(p.visits)) ? p.visits.slice() : [];
  }

  function dedupeByKey(visits) {
    var seen = {}, out = [];
    arr(visits).forEach(function (v) {
      var k = visitKey(v);
      if (seen[k]) return;
      seen[k] = 1; out.push(v);
    });
    return out;
  }

  function fieldDiffs(expected, stored) {
    var diffs = [];
    function subset(a, b) {
      a = arrS(a); b = arrS(b);
      return a.every(function (x) { return b.indexOf(x) >= 0; });
    }
    if (arrS(expected.cpt).length && !subset(expected.cpt, stored.cpt)) diffs.push('cpt');
    if (arrS(expected.icd10).length && !subset(expected.icd10, stored.icd10)) diffs.push('icd10');
    if (expected.raw && !realContent(stored)) diffs.push('content');
    return diffs;
  }

  // ---------------------------------------------------------------------------
  // CORE VERIFY (pure, testable)
  // ---------------------------------------------------------------------------
  function verifyVisitsSaved(ref, expectedVisits) {
    var expected = dedupeByKey(arr(expectedVisits).filter(realContent));
    var result = {
      type: 'visits', ok: false, patientFound: false,
      expectedCount: expected.length, savedCount: 0,
      missing: [], mismatches: [], layer: 'local', ts: new Date().toISOString()
    };
    var p = freshPatient(ref);
    result.patientFound = !!p;
    if (!p) { result.reason = 'patient not found in saved store'; return result; }

    var stored = storedVisits(p);
    var byId = {}, byKey = {};
    stored.forEach(function (s) {
      var id = visitId(s); if (id) byId[id] = s;
      var k = visitKey(s); if (k && !byKey[k]) byKey[k] = s;
    });
    expected.forEach(function (ev) {
      var id = visitId(ev);
      var match = (id && byId[id]) || byKey[visitKey(ev)] || null;
      if (!match) { result.missing.push({ id: id || null, date: ev.date || null, key: visitKey(ev) }); return; }
      result.savedCount++;
      var diffs = fieldDiffs(ev, match);
      if (diffs.length) result.mismatches.push({ id: id || null, date: ev.date || null, fields: diffs });
    });
    result.ok = (result.expectedCount > 0) && (result.savedCount === result.expectedCount) && (result.mismatches.length === 0);
    return result;
  }

  function verifyPatientSaved(ref) {
    var p = freshPatient(ref);
    return {
      type: 'patient', ok: !!p, patientFound: !!p,
      name: (ref && ref.name) || (p && p.name) || null,
      visitCount: p ? storedVisits(p).length : 0,
      layer: 'local', ts: new Date().toISOString()
    };
  }

  function scanPatient(ref) {
    ref = ref || (fn('activePatient') ? safe(fn('activePatient')) : null);
    var rep = {
      type: 'scan', patientFound: false, name: (ref && ref.name) || null,
      visitCount: 0, visits: [], issues: [], layer: 'local', ts: new Date().toISOString()
    };
    if (!ref) { rep.issues.push('No patient selected to verify.'); rep.ok = false; return rep; }
    var p = freshPatient(ref);
    rep.patientFound = !!p;
    rep.name = (p && p.name) || rep.name;
    if (!p) { rep.issues.push('Patient "' + (rep.name || '?') + '" was not found in the saved store.'); rep.ok = false; return rep; }
    var stored = storedVisits(p);
    rep.visitCount = stored.length;
    stored.forEach(function (v) {
      var missing = [];
      if (!v.date) missing.push('date');
      if (!realContent(v)) missing.push('clinical content');
      rep.visits.push({
        id: visitId(v) || null, date: v.date || null, type: v.type || v.procedure || null,
        source: v.source || null, cpt: arrS(v.cpt).length, icd10: arrS(v.icd10).length,
        hasContent: realContent(v), missing: missing
      });
      if (missing.length) rep.issues.push((v.date || '(no date)') + ': missing ' + missing.join(', '));
    });
    rep.ok = rep.patientFound && rep.issues.length === 0;
    return rep;
  }

  // ---------------------------------------------------------------------------
  // SERVER LAYER (honest; only "verified" when it truly re-reads)
  // ---------------------------------------------------------------------------
  var _serverReader = null;
  function configureServer(opts) {
    if (opts && typeof opts.read === 'function') _serverReader = opts.read; else _serverReader = null;
    return !!_serverReader;
  }
  // Real, READ-ONLY, NON-MUTATING server confirm via GET /api/patients reusing
  // the app's own bkBase()/bkToken(). Never calls loadPatientsFromServer (which
  // mutates local state); token used only in the Authorization header, never logged.
  function _defaultServerRead(ref) {
    var baseF = fn('bkBase'), tokF = fn('bkToken');
    if (!baseF || !tokF) return Promise.resolve({ unavailable: true, reason: 'local mode (no server configured)' });
    var b, k;
    try { b = baseF(); k = tokF(); } catch (e) { return Promise.resolve({ unavailable: true, reason: 'no server credentials' }); }
    if (!b || !k) return Promise.resolve({ unavailable: true, reason: 'local mode (no server configured)' });
    var url = String(b).replace(/\/+$/, '') + '/api/patients';
    return fetch(url, { headers: { 'Authorization': 'Bearer ' + k }, credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (data) {
        var list = Array.isArray(data) ? data
          : (data && Array.isArray(data.patients) ? data.patients
            : (data && Array.isArray(data.items) ? data.items : null));
        if (!list) return { unavailable: true, reason: 'unexpected server response shape' };
        var rid = ref && ref.id != null ? String(ref.id) : null;
        var rname = lc(ref && ref.name), rdob = normDob(ref && ref.dob);
        var hit = null;
        for (var i = 0; i < list.length; i++) {
          var p = list[i]; if (!p) continue;
          if (rid && p.id != null && String(p.id) === rid) { hit = p; break; }
          if (!hit && rname && lc(p.name) === rname) {
            var pd = normDob(p.dob);
            if (!rdob || !pd || pd === rdob) hit = p;
          }
        }
        if (!hit) return { ok: false, present: false, reason: 'not yet reflected on the server (sync may be in progress)' };
        var vc = Array.isArray(hit.visits) ? hit.visits.length : null;
        return { ok: true, present: true, visitCount: vc };
      });
  }
  function verifyServer(ref) {
    if (!_serverReader) {
      return Promise.resolve({ checked: false, ok: null,
        reason: 'server re-read not available — the app\'s upsertPatient performs the server sync; local store verified' });
    }
    try {
      return Promise.resolve(_serverReader(ref)).then(function (r) {
        r = r || {};
        if (r.unavailable) return { checked: false, ok: null, reason: r.reason || null };
        return { checked: true, ok: !!r.ok, visitCount: (r.visitCount == null ? null : r.visitCount), reason: r.reason || null };
      }, function () { return { checked: false, ok: null, reason: 'server unreachable — could not confirm (local store verified)' }; });
    } catch (e) { return Promise.resolve({ checked: false, ok: null, reason: 'server check error — local store verified' }); }
  }

  // ---------------------------------------------------------------------------
  // UI — high-contrast, app-styled banner/toast
  // ---------------------------------------------------------------------------
  var STYLE_ID = 'mls-save-verify-style', STACK_ID = 'mls-save-verify-stack';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = '' +
      '#' + STACK_ID + '{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);' +
      'z-index:2147483600;display:flex;flex-direction:column;gap:10px;align-items:stretch;' +
      'max-width:min(560px,94vw);width:max-content;pointer-events:none;font-family:inherit;}' +
      '.mls-sv-card{pointer-events:auto;border-radius:12px;padding:13px 16px;color:#fff;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.30);border:1px solid rgba(0,0,0,.18);' +
      'font-size:14px;line-height:1.4;display:flex;gap:11px;align-items:flex-start;animation:mlsSvIn .18s ease-out;}' +
      '.mls-sv-ok{background:#0d7e37;}.mls-sv-warn{background:#b3500e;}.mls-sv-info{background:#204034;}' +
      '.mls-sv-icon{font-size:18px;line-height:1.2;flex:0 0 auto;}' +
      '.mls-sv-body{flex:1 1 auto;min-width:0;}.mls-sv-title{font-weight:700;letter-spacing:.1px;}' +
      '.mls-sv-lines{margin-top:3px;opacity:.97;font-size:13px;white-space:pre-line;word-break:break-word;}' +
      '.mls-sv-x{pointer-events:auto;flex:0 0 auto;background:transparent;border:0;color:#fff;opacity:.8;' +
      'cursor:pointer;font-size:16px;line-height:1;padding:0 2px;margin-left:4px;}.mls-sv-x:hover{opacity:1;}' +
      '@keyframes mlsSvIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}' +
      '.mls-sv-verifybtn{display:inline-flex;align-items:center;gap:7px;margin:8px 0;padding:9px 14px;' +
      'border-radius:10px;border:1px solid #204034;background:#204034;color:#fff;font-weight:600;font-size:13px;cursor:pointer;}' +
      '.mls-sv-verifybtn:hover{background:#1E2B24;}' +
      '.mls-sv-report{margin:8px 0;border:1px solid #cfd8e3;border-radius:10px;background:#f6f9fc;' +
      'color:#1A211C;padding:11px 13px;font-size:13px;line-height:1.45;}' +
      '.mls-sv-report b{color:#0d2238;}.mls-sv-report .mls-sv-good{color:#0f6b30;font-weight:700;}' +
      '.mls-sv-report .mls-sv-bad{color:#a5400b;font-weight:700;}.mls-sv-report ul{margin:6px 0 0;padding-left:18px;}' +
      '#' + STACK_ID + ':empty{display:none!important;}' +
      '@media(max-width:760px){#mlsMobileNoticeShelf>#' + STACK_ID + '{position:static;left:auto;bottom:auto;transform:none;' +
      'z-index:auto;width:100%;max-width:none;display:flex;gap:8px;box-sizing:border-box;}' +
      '#mlsMobileNoticeShelf .mls-sv-card{width:100%;box-sizing:border-box;border-radius:11px;padding:11px 13px;' +
      'font-size:13.5px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,.15);}}';
    var st = document.createElement('style'); st.id = STYLE_ID; st.type = 'text/css';
    st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }
  function refreshMobileShelf() {
    try { if (typeof window.__mlsRefreshMobileNoticeShelf === 'function') window.__mlsRefreshMobileNoticeShelf(); } catch (e) {}
  }
  function syncStackHost(node) {
    var s = node && node.id === STACK_ID ? node : document.getElementById(STACK_ID);
    if (!s) return null;
    try { if (typeof window.__mlsPlaceMobileNotice === 'function') window.__mlsPlaceMobileNotice(s); } catch (e) {}
    refreshMobileShelf();
    return s;
  }
  function removeCard(card) {
    try { if (card && card.parentNode) card.parentNode.removeChild(card); } catch (e) {}
    refreshMobileShelf();
  }
  function stack() {
    var s = document.getElementById(STACK_ID);
    if (!s) {
      s = document.createElement('div'); s.id = STACK_ID; s.setAttribute('aria-label', 'Save verification notices');
      (document.body || document.documentElement).appendChild(s);
    }
    return syncStackHost(s);
  }
  function banner(kind, title, lines, opts) {
    opts = opts || {};
    try {
      injectStyle();
      var host = stack();
      var key = String(kind || 'info') + '|' + String(title || '') + '|' + (Array.isArray(lines) ? lines.join('\n') : String(lines || ''));
      var oldSuccess = [];
      for (var ci = 0; host && ci < host.children.length; ci++) {
        var prior = host.children[ci];
        if (prior.__mlsSvKey === key) return prior;
        if (kind === 'ok' && prior.__mlsSvKind === 'ok') oldSuccess.push(prior);
      }
      /* Success is current state, not a growing activity log. Keep only the
         newest success; persistent warnings/errors remain until dismissed. */
      for (var oi = 0; oi < oldSuccess.length; oi++) removeCard(oldSuccess[oi]);
      var card = document.createElement('div');
      card.className = 'mls-sv-card mls-sv-' + (kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : 'info');
      card.__mlsSvKey = key; card.__mlsSvKind = kind || 'info';
      card.setAttribute('role', kind === 'warn' ? 'alert' : 'status');
      card.setAttribute('aria-live', kind === 'warn' ? 'assertive' : 'polite'); card.setAttribute('aria-atomic', 'true');
      if (opts.pullFailure) card.setAttribute('data-mls-athena-pull-failure', '1');
      var icon = document.createElement('div'); icon.className = 'mls-sv-icon';
      icon.textContent = kind === 'ok' ? '✓' : kind === 'warn' ? '⚠' : 'ℹ';
      var body = document.createElement('div'); body.className = 'mls-sv-body';
      var t = document.createElement('div'); t.className = 'mls-sv-title'; t.textContent = title || ''; body.appendChild(t);
      if (lines && lines.length) {
        var l = document.createElement('div'); l.className = 'mls-sv-lines';
        l.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines); body.appendChild(l);
      }
      var x = document.createElement('button'); x.className = 'mls-sv-x'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×';
      x.onclick = function () { removeCard(card); };
      card.appendChild(icon); card.appendChild(body); card.appendChild(x);
      host.appendChild(card); refreshMobileShelf();
      var ttl = opts.ttl != null ? opts.ttl : (kind === 'ok' ? 6000 : 0);
      if (ttl > 0) setTimeout(function () { removeCard(card); }, ttl);
      return card;
    } catch (e) { return null; }
  }

  function serverSuffix(serverInfo) {
    if (!serverInfo) return '';
    if (serverInfo.checked && serverInfo.ok) return 'Server: confirmed' + (serverInfo.visitCount != null ? ' (' + serverInfo.visitCount + ' on server)' : '') + '.';
    if (serverInfo.checked && !serverInfo.ok) return 'Server: sync in progress (not yet reflected) — local store is saved.';
    return 'Local store verified (survives reload). ' + (serverInfo.reason || 'Server sync handled by the app.');
  }
  function presentVisitResult(res, serverInfo) {
    var serverLine = serverSuffix(serverInfo);
    if (res.ok) {
      var n = res.savedCount;
      banner('ok', '✓ All ' + n + ' visit' + (n === 1 ? '' : 's') + ' saved and verified', serverLine ? [serverLine] : []);
    } else {
      var msg = [];
      if (!res.patientFound) {
        msg.push('The patient record was not found in the saved store — nothing persisted.');
      } else {
        msg.push('Saved ' + res.savedCount + ' of ' + res.expectedCount + ' visits.');
        if (res.missing.length) msg.push('Missing: ' + res.missing.map(function (m) { return m.date || m.key || m.id || '?'; }).join(', '));
        if (res.mismatches.length) msg.push('Field mismatch on: ' + res.mismatches.map(function (m) { return (m.date || m.id || '?') + ' (' + m.fields.join('/') + ')'; }).join(', '));
        msg.push('Retry the save for the missing item(s).');
      }
      if (serverLine) msg.push(serverLine);
      banner('warn', '⚠ Save incomplete — ' + res.savedCount + ' of ' + res.expectedCount + ' verified', msg);
    }
  }

  // ---------------------------------------------------------------------------
  // patient identity helpers
  // ---------------------------------------------------------------------------
  function patientId(p) { return (p && p.id != null) ? String(p.id) : ('name:' + lc(p && p.name) + '|' + normDob(p && p.dob)); }
  function samePatient(a, b) { if (!a || !b) return false; return patientId(a) === patientId(b); }

  // ---------------------------------------------------------------------------
  // HOOK 1 — Athena copy-every-visit pull (capture the result message)
  // ---------------------------------------------------------------------------
  var _lastPull = null; // { visits, ok, ts, ref, handled }

  function handlePullVerify(pull) {
    if (!pull || pull.handled) return;
    pull.handled = true;
    var real = arr(pull.visits).filter(realContent);
    if (real.length) {
      var res = verifyVisitsSaved(pull.ref, pull.visits);
      verifyServer(pull.ref).then(function (srv) { presentVisitResult(res, srv); });
    } else {
      // intended list not visible in the message — confirm the patient persisted
      // and report the genuine stored visit count (no fabricated number).
      var vp = verifyPatientSaved(pull.ref);
      if (vp.ok) {
        verifyServer(pull.ref).then(function (srv) {
          banner('ok', '✓ Pull saved — ' + vp.visitCount + ' visit' + (vp.visitCount === 1 ? '' : 's') + ' on file & verified',
            [serverSuffix(srv)].filter(Boolean), { ttl: 6000 });
        });
      } else {
        banner('warn', '⚠ Pull save not confirmed',
          ['The patient was not found in the saved store after the pull — retry.']);
      }
    }
  }

  /* The exact provider/day history workflow owns its aggregate receipt and
     deliberately gives every internal bridge request an `mlssi-*` correlation
     id.  A failed patient read is already counted in that receipt; showing this
     standalone warning for every patient obscures the one honest final batch
     result.  Manual/standalone reads use their own ids and keep the warning. */
  function isManagedHistoryBatchResult(d) {
    d = d || {};
    var nested = d.resp || d.result || d.payload || {};
    var requestId = String(d.id || d.requestId || nested.id || nested.requestId || '');
    if (/^mlssi-[a-z0-9]+-[a-z0-9]+$/i.test(requestId)) return true;
    if (d.managed === true || d.background === true || d.silent === true ||
        nested.managed === true || nested.background === true || nested.silent === true) return true;
    var owner = String(d.initiator || d.origin || d.mode || nested.initiator || nested.origin || nested.mode || '').toLowerCase();
    return /^(?:background|batch|prefetch|automatic|auto)$/.test(owner);
  }

  function pullNoticeHandled(d) {
    try { return !!(d && d.__mlsAthenaPullNoticeHandled); } catch (e) { return false; }
  }

  function markPullNoticeHandled(d) {
    try { d.__mlsAthenaPullNoticeHandled = 'save-verify'; } catch (e) {}
  }

  var _manualReadFailureRef = null;
  function resultRef(d) {
    d = d || {};
    var nested = d.resp || d.result || d.payload || {};
    return {
      requestId: String(d.id || d.requestId || nested.id || nested.requestId || ''),
      correlationId: String(d.correlationId || d.retryOf || d.parentRequestId || nested.correlationId || nested.retryOf || nested.parentRequestId || '')
    };
  }
  function successMatchesManualReadFailure(d) {
    var a = _manualReadFailureRef;
    if (!a) return false;
    var b = resultRef(d);
    if (a.requestId) return b.requestId === a.requestId || b.correlationId === a.requestId || (!!a.correlationId && b.correlationId === a.correlationId);
    if (a.correlationId) return b.correlationId === a.correlationId || b.requestId === a.correlationId;
    return !b.requestId && !b.correlationId;
  }
  function clearManualReadFailureCards() {
    try {
      var nodes = document.querySelectorAll('[data-mls-athena-pull-failure="1"]');
      for (var i = 0; i < nodes.length; i++) if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    } catch (e) {}
    _manualReadFailureRef = null;
  }

  function showManualReadFailure(d) {
    if (pullNoticeHandled(d)) return;
    var doctor = safe(function () { return window.__mlsAthenaDoctor; });
    if (doctor && doctor.ownsPullNotices === true) return;
    markPullNoticeHandled(d);
    _manualReadFailureRef = resultRef(d);
    banner('info', 'No visits were saved',
      ['athenaOne returned no readable visits, or the name/DOB safety check stopped the save.',
        'Nothing was stored — this is the honest result, not an error to retry blindly.'],
      { ttl: 9000, pullFailure: true });
  }

  function routeManualReadFailure(d) {
    /* Save Verify can be registered before Athena Doctor's capture listener.
       Defer only when another notice owner is present so the same event can be
       claimed first; the standalone module keeps its immediate honest fallback. */
    var hasPeer = !!safe(function () { return window.__mlsAthenaDoctor || window.__mlsAthenaClarity; });
    if (!hasPeer) { showManualReadFailure(d); return; }
    setTimeout(function () { showManualReadFailure(d); }, 0);
  }

  function onResultMessage(ev) {
    try {
      var d = ev && ev.data;
      if (!d || typeof d !== 'object') return;
      var type = d.type || d.kind || '';
      if (type !== 'mlsAppAllVisitsResult' && type !== 'mlsAppReadAllVisitsResult') return;
      var visits = d.visits || (d.result && d.result.visits) || (d.payload && d.payload.visits) || [];
      var ok = (d.ok != null) ? !!d.ok : (d.result ? !!d.result.ok : true);
      var ref = fn('activePatient') ? safe(fn('activePatient')) : null;
      _lastPull = { visits: arr(visits), ok: ok, ts: Date.now(), ref: ref, handled: false };
      if (isManagedHistoryBatchResult(d)) {
        /* The provider/day owner supplies one aggregate receipt for both
           failures and successes. Per-patient save banners would reintroduce
           the same noise through the success-verification timer. */
        _lastPull.handled = true;
        return;
      }
      if (ok === false) {
        _lastPull.handled = true;
        routeManualReadFailure(d);
        return;
      }
      if (successMatchesManualReadFailure(d)) clearManualReadFailureCards();
      // Fallback: if no upsert-triggered verify fires, verify once the save settles.
      (function (p) {
        setTimeout(function () { if (_lastPull === p && !p.handled) handlePullVerify(p); }, 3500);
      })(_lastPull);
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // HOOK 2 — upsertPatient (every save path) — debounced post-save verify
  // ---------------------------------------------------------------------------
  var _pendingUpsert = {}, _prevVisitCount = {}, _knownPatients = null;

  /* Live 2026-07-21 (owner screenshot): a login glitch mid-hydration produced a
     WALL of "Save not confirmed" warnings — the session boundary purged the
     store while dozens of upsert verifications were still queued, so every one
     re-read an empty store and screamed false data loss over the access-gate
     screen. Three guards: (1) a session epoch cancels every queued
     verification at any account boundary; (2) verification is suppressed while
     signed out, while account identity is unresolved, or while the app screen
     is hidden behind a gate; (3) repeated warnings collapse into ONE honest
     summary instead of a stacked wall. */
  var _verifyEpoch = 0;
  try {
    window.addEventListener('mls:session-boundary', function () {
      _verifyEpoch++;
      try { Object.keys(_pendingUpsert).forEach(function (k) { clearTimeout(_pendingUpsert[k]); }); } catch (e) {}
      _pendingUpsert = {}; _prevVisitCount = {}; _knownPatients = null;
      _resaveAttempted = Object.create(null);
    });
  } catch (e) {}
  function verifySuppressed() {
    return safe(function () {
      var hosted = (typeof window.backendMode === 'function') && window.backendMode();
      if (hosted && !((typeof window.bkToken === 'function') && window.bkToken())) return true;
      if (hosted && typeof window.uns === 'function' && String(window.uns('X')).indexOf('::_::') >= 0) return true;
      var app = document.getElementById('appScreen');
      if (app && window.getComputedStyle && getComputedStyle(app).display === 'none') return true;
      return false;
    }) === true;
  }
  /* sv-1.0.3: ONE aggregated card instead of a stacked wall (owner screenshot:
     three orange banners covering the page). Every unconfirmed name within a
     rolling window folds into the same self-replacing card; the card names the
     items, the state, and the safe retry. */
  var _svUnconfirmed = [], _svUnconfirmedCard = null, _svUnconfirmedTs = 0;

  /* sv-1.1.0 (owner 2026-07-24: "6 saves not confirmed … do not rely on the
     user to manually reload and retry"). A row still missing after the settle
     is re-saved ONCE, automatically, before anything is shown. The retry
     re-issues the SAME patient object through upsertPatient, which keys by
     patient id — so it can only rewrite that exact record: it cannot create a
     duplicate and cannot touch another chart. __mlsOrig skips this module's
     own verify scheduling (no retry loop) while keeping every other guard in
     the wrap chain. Only a retry that ALSO fails is worth interrupting the
     doctor for. */
  var _resaveAttempted = Object.create(null);
  function resaveOnce(p) {
    if (!p || p.id == null) return null;
    var key = patientId(p);
    if (_resaveAttempted[key]) return null;
    _resaveAttempted[key] = 1;
    var up = fn('upsertPatient');
    if (!up) return null;
    try { (up.__mlsOrig || up).call(window, p); } catch (e) { return null; }
    return safe(function () { return verifyPatientSaved(p); });
  }

  function warnSaveNotConfirmed(name) {
    var t = Date.now();
    if (t - _svUnconfirmedTs > 90000) _svUnconfirmed = [];
    _svUnconfirmedTs = t;
    var nm = String(name || 'patient');
    if (_svUnconfirmed.indexOf(nm) < 0) _svUnconfirmed.push(nm);
    if (_svUnconfirmedCard) { try { _svUnconfirmedCard.remove(); } catch (e) {} _svUnconfirmedCard = null; }
    var n = _svUnconfirmed.length;
    var shown = _svUnconfirmed.slice(0, 4).join(', ') + (n > 4 ? ' and ' + (n - 4) + ' more' : '');
    _svUnconfirmedCard = banner('warn',
      n === 1 ? '⚠ Save not confirmed' : ('⚠ ' + n + ' saves not confirmed'),
      [shown + (n === 1 ? ' was' : ' were') + ' not found in the saved store after saving.',
        'MLS already re-saved ' + (n === 1 ? 'it' : 'them') + ' automatically and checked again — still missing, so this needs a look. Nothing was written to another chart.',
        'Pull that patient again to restore the record; your other charts are unaffected.']);
  }

  function scheduleUpsertVerify(p) {
    if (!p) return;
    var key = patientId(p);
    var ep = _verifyEpoch;
    if (_pendingUpsert[key]) clearTimeout(_pendingUpsert[key]);
    _pendingUpsert[key] = setTimeout(function () {
      delete _pendingUpsert[key];
      if (ep !== _verifyEpoch || verifySuppressed()) return;
      try { runUpsertVerify(p, key); } catch (e) {}
    }, 650);
  }

  function runUpsertVerify(p, key) {
    // If a recent Athena pull result is pending for this patient, do the precise
    // "N of N visits" verification (the save has now settled).
    if (_lastPull && !_lastPull.handled && (Date.now() - _lastPull.ts < 15000) &&
      (samePatient(_lastPull.ref, p) || !_lastPull.ref)) {
      handlePullVerify(_lastPull);
      var vp = verifyPatientSaved(p);
      _prevVisitCount[key] = vp.visitCount;
      if (_knownPatients) _knownPatients.add(key);
      return;
    }
    var res = verifyPatientSaved(p);
    var isNew = !!(_knownPatients && !_knownPatients.has(key));
    if (_knownPatients) _knownPatients.add(key);
    var prev = _prevVisitCount[key];
    var grew = (prev != null && res.visitCount > prev);
    _prevVisitCount[key] = res.visitCount;

    if (!res.ok) {
      /* Settle-recheck (2026-07-20, seen live): during startup/cloud hydration
         an upsert can verify before the store write settles — "John M." was
         flagged missing while present moments later. Re-check once after a
         settle; the honest warning fires only if the record is STILL absent. */
      var epRecheck = _verifyEpoch;
      setTimeout(function () {
        if (epRecheck !== _verifyEpoch || verifySuppressed()) return;
        try {
          var again = verifyPatientSaved(p);
          if (again.ok) { _prevVisitCount[key] = again.visitCount; return; }
        } catch (e) {}
        /* Shorthand stubs ("John M." — appointment-style first name + last
           initial) are deliberately folded into the existing full-name patient
           by the dedupe guards (client skip + server match-before-create), so
           a separate record SHOULD be absent. Say that calmly instead of
           raising a false data-loss alarm (seen live 2026-07-20). */
        if (/^[A-Za-z][A-Za-z'-]* [A-Za-z]\.?$/.test(String(res.name || '').trim())) {
          banner('info', 'Schedule shorthand — no separate chart created',
            ['"' + res.name + '" is a shorthand schedule name, so it was not stored as a separate patient record.',
              'If this is a real new patient, add them from Patients with their full name.'], { ttl: 8000 });
          return;
        }
        /* Retry before reporting — see resaveOnce (sv-1.1.0). */
        var healed = resaveOnce(p);
        if (healed && healed.ok) {
          _prevVisitCount[key] = healed.visitCount;
          banner('ok', '✓ Saved & verified: ' + (healed.name || res.name || 'patient'),
            ['The first save did not settle, so MLS saved it again and confirmed it.'], { ttl: 5000 });
          return;
        }
        warnSaveNotConfirmed(res.name);
      }, 2500);
      return;
    }
    if (isNew) {
      banner('ok', '✓ Saved & verified: ' + (res.name || 'patient'),
        [res.visitCount + ' visit' + (res.visitCount === 1 ? '' : 's') + ' stored.'], { ttl: 4500 });
    } else if (grew) {
      banner('ok', '✓ Saved & verified: ' + (res.name || 'patient'),
        ['Now ' + res.visitCount + ' visit' + (res.visitCount === 1 ? '' : 's') + ' on file.'], { ttl: 4500 });
    }
  }

  function wrapUpsert() {
    var up = fn('upsertPatient');
    if (!up) return false;
    if (up.__mlsVerifyWrapped) return true;
    try {
      var gp = fn('getPatients');
      _knownPatients = new Set();
      if (gp) (gp() || []).forEach(function (p) { var k = patientId(p); _knownPatients.add(k); _prevVisitCount[k] = storedVisits(p).length; });
    } catch (e) { _knownPatients = new Set(); }
    var wrapped = function (p) {
      var ret = up.apply(this, arguments);
      try { scheduleUpsertVerify(p); } catch (e2) {}
      return ret;
    };
    wrapped.__mlsVerifyWrapped = true; wrapped.__mlsOrig = up;
    try { for (var _k in up) { if (/Wrapped$/.test(_k)) wrapped[_k] = up[_k]; } } catch (e) {} /* b171: carry other modules' upsert-wrap markers so their guards don't re-wrap */
    window.upsertPatient = wrapped;
    return true;
  }

  // ---------------------------------------------------------------------------
  // ON-DEMAND — "Verify saved data" button on the profile card
  // ---------------------------------------------------------------------------
  var BTN_ID = 'mlsSvVerifyBtn', RPT_ID = 'mlsSvReport';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function renderReport(rep) {
    var host = document.getElementById('profileCard') || document.body;
    var old = document.getElementById(RPT_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = document.createElement('div'); box.id = RPT_ID; box.className = 'mls-sv-report';
    var html = '';
    if (!rep.patientFound) {
      html += '<b class="mls-sv-bad">⚠ Not found in the saved store.</b><br>Nothing is persisted for "' + esc(rep.name || '?') + '". The data did not save — retry.';
    } else if (rep.ok) {
      html += '<b class="mls-sv-good">✓ All saved correctly.</b><br>“' + esc(rep.name || 'Patient') + '” — <b>' + rep.visitCount + '</b> visit' + (rep.visitCount === 1 ? '' : 's') + ' stored, each with clinical content and a date. Re-read live from the saved store.';
    } else {
      html += '<b class="mls-sv-bad">⚠ ' + rep.issues.length + ' issue' + (rep.issues.length === 1 ? '' : 's') + ' found.</b><br>“' + esc(rep.name || 'Patient') + '” — ' + rep.visitCount + ' visit' + (rep.visitCount === 1 ? '' : 's') + ' stored.<ul>';
      rep.issues.slice(0, 12).forEach(function (i) { html += '<li>' + esc(i) + '</li>'; });
      html += '</ul>';
    }
    box.innerHTML = html;
    var srvNote = document.createElement('div');
    srvNote.style.cssText = 'margin-top:7px;font-size:12px;opacity:.85;';
    box.appendChild(srvNote);
    verifyServer(rep).then(function (srv) {
      srvNote.textContent = srv.checked
        ? (srv.ok ? 'Server: confirmed' + (srv.visitCount != null ? ' (' + srv.visitCount + ' visit' + (srv.visitCount === 1 ? '' : 's') + ' on server)' : '') + '.'
          : 'Server: sync in progress (not yet reflected) — local store is saved.')
        : 'Verified against the local saved store (survives reload). ' + (srv.reason || '');
    });
    var btn = document.getElementById(BTN_ID);
    if (btn && btn.parentNode) btn.parentNode.insertBefore(box, btn.nextSibling); else host.appendChild(box);
  }
  function onDemandScan() {
    var ap = fn('activePatient') ? safe(fn('activePatient')) : null;
    var rep = scanPatient(ap); renderReport(rep); return rep;
  }
  function ensureButton() {
    var host = document.getElementById('profileCard');
    if (!host) return false;
    if (document.getElementById(BTN_ID)) return true;
    injectStyle();
    var btn = document.createElement('button');
    btn.id = BTN_ID; btn.type = 'button'; btn.className = 'mls-sv-verifybtn';
    btn.textContent = '🛡 Verify saved data';
    btn.setAttribute('aria-label', 'Verify this patient\'s saved data is intact');
    btn.onclick = function () { try { onDemandScan(); } catch (e) {} };
    host.insertBefore(btn, host.firstChild);
    return true;
  }

  // ---------------------------------------------------------------------------
  // boot / observer (idempotent, no jitter)
  // ---------------------------------------------------------------------------
  var _obs = null, _scheduled = false;
  function scheduleEnsure() {
    if (_scheduled) return;
    _scheduled = true;
    setTimeout(function () { _scheduled = false; try { wrapUpsert(); } catch (e) {} try { ensureButton(); } catch (e) {} }, 120);
  }
  function boot() {
    injectStyle();
    try { if (!_serverReader && fn('bkBase') && fn('bkToken')) configureServer({ read: _defaultServerRead }); } catch (e) {}
    window.addEventListener('message', onResultMessage, true); // capture phase, passive
    window.addEventListener('resize', syncStackHost, { passive: true });
    wrapUpsert();
    ensureButton();
    // Re-add the profile button if the profile re-renders, and re-wrap upsert if
    // a later module replaced it. Observer only ACTS when something is missing —
    // never mutates on a steady state (the ctxbar idempotent lesson).
    try {
      _obs = new MutationObserver(function () {
        var needBtn = document.getElementById('profileCard') && !document.getElementById(BTN_ID);
        var needUpsert = false;
        try { needUpsert = typeof window.upsertPatient === 'function' && !window.upsertPatient.__mlsVerifyWrapped; } catch (e) {}
        if (needBtn || needUpsert) scheduleEnsure();
      });
      _obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {} _obs = null;
    try { window.removeEventListener('message', onResultMessage, true); } catch (e) {}
    try { window.removeEventListener('resize', syncStackHost, { passive: true }); } catch (e) {}
    try {
      if (window.upsertPatient && window.upsertPatient.__mlsVerifyWrapped && window.upsertPatient.__mlsOrig)
        window.upsertPatient = window.upsertPatient.__mlsOrig;
    } catch (e) {}
    [STYLE_ID, STACK_ID, BTN_ID, RPT_ID].forEach(function (id) { var el = document.getElementById(id); if (el && el.parentNode) el.parentNode.removeChild(el); });
    api.installed = false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------------
  var api = {
    installed: true, version: VERSION, asset: ASSET,
    verifyVisitsSaved: verifyVisitsSaved,
    verifyPatientSaved: verifyPatientSaved,
    verifyServer: verifyServer,
    configureServer: configureServer,
    scan: onDemandScan,
    scanPatient: scanPatient,
    banner: banner,
    presentVisitResult: presentVisitResult,
    _onResultMessage: onResultMessage,
    _handlePullVerify: handlePullVerify,
    _wrapUpsert: wrapUpsert,
    _runUpsertVerify: runUpsertVerify,
    _freshPatient: freshPatient,
    _visitKey: visitKey,
    _realContent: realContent,
    _isManagedHistoryBatchResult: isManagedHistoryBatchResult,
    _defaultServerRead: _defaultServerRead,
    revert: revert
  };
  window.__mlsSaveVerify = api;

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  } catch (e) {}

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();
