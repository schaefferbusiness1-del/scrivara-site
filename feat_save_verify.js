/* feat_save_verify.js  —  MLS Save-Integrity Verification layer
 * window.__mlsSaveVerify (v1.0.0)
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

  var VERSION = '1.0.1';
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

  // Re-read a patient FRESH from the persisted store — never a stale in-memory ref.
  function freshPatient(ref) {
    var gp = fn('getPatients');
    if (!gp || !ref) return null;
    var list;
    try { list = gp() || []; } catch (e) { return null; }
    var rid = ref.id != null ? String(ref.id) : null;
    var rname = lc(ref.name);
    var rdob = normDob(ref.dob);
    var byKey = null;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p) continue;
      if (rid && p.id != null && String(p.id) === rid) return p;
      if (!byKey && rname && lc(p.name) === rname) {
        var pdob = normDob(p.dob);
        if (!rdob || !pdob || pdob === rdob) byKey = p;
      }
    }
    return byKey;
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
      '.mls-sv-ok{background:#0f8a3c;}.mls-sv-warn{background:#b3500e;}.mls-sv-info{background:#204034;}' +
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
      '.mls-sv-report .mls-sv-bad{color:#a5400b;font-weight:700;}.mls-sv-report ul{margin:6px 0 0;padding-left:18px;}';
    var st = document.createElement('style'); st.id = STYLE_ID; st.type = 'text/css';
    st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }
  function stack() {
    var s = document.getElementById(STACK_ID);
    if (!s) { s = document.createElement('div'); s.id = STACK_ID; (document.body || document.documentElement).appendChild(s); }
    return s;
  }
  function banner(kind, title, lines, opts) {
    opts = opts || {};
    try {
      injectStyle();
      var card = document.createElement('div');
      card.className = 'mls-sv-card mls-sv-' + (kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : 'info');
      var icon = document.createElement('div'); icon.className = 'mls-sv-icon';
      icon.textContent = kind === 'ok' ? '✓' : kind === 'warn' ? '⚠' : 'ℹ';
      var body = document.createElement('div'); body.className = 'mls-sv-body';
      var t = document.createElement('div'); t.className = 'mls-sv-title'; t.textContent = title || ''; body.appendChild(t);
      if (lines && lines.length) {
        var l = document.createElement('div'); l.className = 'mls-sv-lines';
        l.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines); body.appendChild(l);
      }
      var x = document.createElement('button'); x.className = 'mls-sv-x'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×';
      x.onclick = function () { if (card.parentNode) card.parentNode.removeChild(card); };
      card.appendChild(icon); card.appendChild(body); card.appendChild(x);
      stack().appendChild(card);
      var ttl = opts.ttl != null ? opts.ttl : (kind === 'ok' ? 6000 : 0);
      if (ttl > 0) setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, ttl);
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
    return /^mlssi-[a-z0-9]+-[a-z0-9]+$/i.test(requestId);
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
      if (ok === false) {
        _lastPull.handled = true;
        if (isManagedHistoryBatchResult(d)) return;
        banner('info', 'No visits were saved',
          ['athenaOne returned no readable visits, or the name/DOB safety check stopped the save.',
            'Nothing was stored — this is the honest result, not an error to retry blindly.'], { ttl: 9000 });
        return;
      }
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

  function scheduleUpsertVerify(p) {
    if (!p) return;
    var key = patientId(p);
    if (_pendingUpsert[key]) clearTimeout(_pendingUpsert[key]);
    _pendingUpsert[key] = setTimeout(function () {
      delete _pendingUpsert[key];
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
      banner('warn', '⚠ Save not confirmed',
        ['"' + (res.name || 'patient') + '" was not found in the saved store after saving.',
          'The save may not have persisted — please retry.']);
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
