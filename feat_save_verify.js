/* feat_save_verify.js  —  MLS Save-Integrity Verification layer
 * window.__mlsSaveVerify (v1.0.0)
 *
 * PURPOSE (Michael's ask): every time data is saved/restored, automatically
 * SCAN the persisted store and HONESTLY confirm it actually landed — or flag
 * exactly what is missing. Real re-reads only. Never fabricate a pass.
 *
 * What it does
 *  1. POST-SAVE VERIFY (automatic):
 *     - Athena copy-every-visit pull (window.__mlsCopyVisits.run): after the
 *       pull saves N visits, re-read the patient's STORED visits and confirm
 *       each intended visit is genuinely present (by id / _visitKey) with key
 *       fields intact. Reports "Saved N of N visits" or "Only X of N".
 *     - Patient saves (window.upsertPatient): after a save, re-read getPatients()
 *       and confirm the record persisted. Surfaces on failure, on new patients,
 *       and on real visit-count increases (silent re-verify otherwise).
 *  2. CLEAR honest result: a high-contrast banner/toast, app-styled.
 *  3. ON-DEMAND CHECK: a "Verify saved data" button on the patient profile
 *     card + window.__mlsSaveVerify.scan() — re-reads and reports a patient's
 *     stored data integrity any time.
 *  4. Real comparison: compares STORED (re-read from the persisted model that
 *     survives reload) vs INTENDED. Local layer is always verified definitively.
 *     The server layer is independently re-read (READ-ONLY GET /api/patients
 *     reusing the app's own auth) when server mode is on; otherwise the result
 *     honestly states the local layer was verified. Never a fabricated pass.
 *  5. Lightweight, idempotent, no jitter/loops, additive, instantly reversible
 *     (window.__mlsSaveVerify.revert()).
 *
 * No PHI is logged. The on-demand report shows only the active patient's own
 * stored structure to the logged-in user; nothing is sent anywhere.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var ASSET = 'feat_save_verify.js';

  // Idempotent boot — exactly one instance ever.
  if (window.__mlsSaveVerify && window.__mlsSaveVerify.installed) { return; }

  // ---------------------------------------------------------------------------
  // small safe accessors
  // ---------------------------------------------------------------------------
  function fn(name) {
    try { return (typeof window[name] === 'function') ? window[name] : null; }
    catch (e) { return null; }
  }
  function model() { try { return window.__mlsVisitModel || null; } catch (e) { return null; } }

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

  // visitKey — prefer the model's own signature so STORED (normalised) and
  // INTENDED (pre-normalise) visits collapse to the same key. Fallback is a
  // date|type|first-cpt signature with light date normalisation.
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

  // Re-read a patient FRESH from the persisted store (getPatients reads
  // localStorage['uns_patients']) — never trust a stale in-memory reference.
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

  // dedupe a list of visits by visitKey (mirrors the model's de-dupe on save)
  function dedupeByKey(visits) {
    var seen = {}, out = [];
    arr(visits).forEach(function (v) {
      var k = visitKey(v);
      if (seen[k]) return;
      seen[k] = 1; out.push(v);
    });
    return out;
  }

  // Which key fields of an INTENDED visit must survive into the STORED one.
  function fieldDiffs(expected, stored) {
    var diffs = [];
    function subset(a, b) {
      a = arrS(a); b = arrS(b);
      return a.every(function (x) { return b.indexOf(x) >= 0; });
    }
    if (arrS(expected.cpt).length && !subset(expected.cpt, stored.cpt)) diffs.push('cpt');
    if (arrS(expected.icd10).length && !subset(expected.icd10, stored.icd10)) diffs.push('icd10');
    // raw content: if the intended visit carried real raw text, the stored one
    // must carry some clinical content too (raw OR codes OR fields).
    if (expected.raw && !realContent(stored)) diffs.push('content');
    return diffs;
  }

  // ---------------------------------------------------------------------------
  // CORE VERIFY (pure, testable)
  // ---------------------------------------------------------------------------

  // Verify that `expectedVisits` (the visits a pull/save INTENDED to store) are
  // genuinely present in the patient's persisted model.
  function verifyVisitsSaved(ref, expectedVisits) {
    var expected = dedupeByKey(arr(expectedVisits).filter(realContent));
    var result = {
      type: 'visits',
      ok: false,
      patientFound: false,
      expectedCount: expected.length,
      savedCount: 0,
      missing: [],
      mismatches: [],
      layer: 'local',
      ts: new Date().toISOString()
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
      if (!match) {
        result.missing.push({ id: id || null, date: ev.date || null, key: visitKey(ev) });
        return;
      }
      result.savedCount++;
      var diffs = fieldDiffs(ev, match);
      if (diffs.length) result.mismatches.push({ id: id || null, date: ev.date || null, fields: diffs });
    });

    result.ok = (result.expectedCount > 0) &&
      (result.savedCount === result.expectedCount) &&
      (result.mismatches.length === 0);
    return result;
  }

  // Verify a patient record itself persisted.
  function verifyPatientSaved(ref) {
    var p = freshPatient(ref);
    return {
      type: 'patient',
      ok: !!p,
      patientFound: !!p,
      name: (ref && ref.name) || (p && p.name) || null,
      visitCount: p ? storedVisits(p).length : 0,
      layer: 'local',
      ts: new Date().toISOString()
    };
  }

  // On-demand full integrity scan of one patient's stored data.
  function scanPatient(ref) {
    ref = ref || (fn('activePatient') ? safe(fn('activePatient')) : null);
    var rep = {
      type: 'scan',
      patientFound: false,
      name: (ref && ref.name) || null,
      visitCount: 0,
      visits: [],
      issues: [],
      layer: 'local',
      ts: new Date().toISOString()
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
        id: visitId(v) || null,
        date: v.date || null,
        type: v.type || v.procedure || null,
        source: v.source || null,
        cpt: arrS(v.cpt).length,
        icd10: arrS(v.icd10).length,
        hasContent: realContent(v),
        missing: missing
      });
      if (missing.length) rep.issues.push((v.date || '(no date)') + ': missing ' + missing.join(', '));
    });
    rep.ok = rep.patientFound && rep.issues.length === 0;
    return rep;
  }

  function safe(f) { try { return f(); } catch (e) { return null; } }

  // ---------------------------------------------------------------------------
  // SERVER LAYER (honest; only claims verified when it truly re-reads)
  // ---------------------------------------------------------------------------
  var _serverReader = null; // function(ref) -> Promise<{ ok:bool, visitCount:number }>
  function configureServer(opts) {
    if (opts && typeof opts.read === 'function') _serverReader = opts.read;
    else _serverReader = null;
    return !!_serverReader;
  }

  // Real, READ-ONLY, NON-MUTATING server confirm. Reuses the app's own auth
  // (bkBase()/bkToken()) to GET /api/patients — the exact endpoint the app's
  // syncPatientToServer POSTs to and loadPatientsFromServer GETs from. We never
  // call loadPatientsFromServer (it mutates local state + re-renders); we only
  // read and compare. The token is used in the Authorization header and is never
  // logged or stored. Returns honest status — never a fabricated pass.
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
      return Promise.resolve({
        checked: false, ok: null,
        reason: 'server re-read not available from the browser — the app\'s upsertPatient performs the server sync; local store verified'
      });
    }
    try {
      return Promise.resolve(_serverReader(ref)).then(function (r) {
        r = r || {};
        if (r.unavailable) return { checked: false, ok: null, reason: r.reason || null };
        return { checked: true, ok: !!r.ok, visitCount: (r.visitCount == null ? null : r.visitCount), reason: r.reason || null };
      }, function (e) {
        return { checked: false, ok: null, reason: 'server unreachable — could not confirm (local store verified)' };
      });
    } catch (e) {
      return Promise.resolve({ checked: false, ok: null, reason: 'server check error — local store verified' });
    }
  }

  // ---------------------------------------------------------------------------
  // UI — high-contrast, app-styled banner/toast (no white-on-white)
  // ---------------------------------------------------------------------------
  var STYLE_ID = 'mls-save-verify-style';
  var STACK_ID = 'mls-save-verify-stack';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = '' +
      '#' + STACK_ID + '{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);' +
      'z-index:2147483600;display:flex;flex-direction:column;gap:10px;align-items:stretch;' +
      'max-width:min(560px,94vw);width:max-content;pointer-events:none;font-family:inherit;}' +
      '.mls-sv-card{pointer-events:auto;border-radius:12px;padding:13px 16px;color:#fff;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.30);border:1px solid rgba(0,0,0,.18);' +
      'font-size:14px;line-height:1.4;display:flex;gap:11px;align-items:flex-start;' +
      'animation:mlsSvIn .18s ease-out;}' +
      '.mls-sv-ok{background:#0f8a3c;}' +
      '.mls-sv-warn{background:#b3500e;}' +
      '.mls-sv-info{background:#1f3a5f;}' +
      '.mls-sv-icon{font-size:18px;line-height:1.2;flex:0 0 auto;}' +
      '.mls-sv-body{flex:1 1 auto;min-width:0;}' +
      '.mls-sv-title{font-weight:700;letter-spacing:.1px;}' +
      '.mls-sv-lines{margin-top:3px;opacity:.97;font-size:13px;white-space:pre-line;word-break:break-word;}' +
      '.mls-sv-x{pointer-events:auto;flex:0 0 auto;background:transparent;border:0;color:#fff;' +
      'opacity:.8;cursor:pointer;font-size:16px;line-height:1;padding:0 2px;margin-left:4px;}' +
      '.mls-sv-x:hover{opacity:1;}' +
      '@keyframes mlsSvIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}' +
      '.mls-sv-verifybtn{display:inline-flex;align-items:center;gap:7px;margin:8px 0;' +
      'padding:9px 14px;border-radius:10px;border:1px solid #15406b;background:#1f3a5f;color:#fff;' +
      'font-weight:600;font-size:13px;cursor:pointer;}' +
      '.mls-sv-verifybtn:hover{background:#16314f;}' +
      '.mls-sv-report{margin:8px 0;border:1px solid #cfd8e3;border-radius:10px;background:#f6f9fc;' +
      'color:#15293f;padding:11px 13px;font-size:13px;line-height:1.45;}' +
      '.mls-sv-report b{color:#0d2238;}' +
      '.mls-sv-report .mls-sv-good{color:#0f6b30;font-weight:700;}' +
      '.mls-sv-report .mls-sv-bad{color:#a5400b;font-weight:700;}' +
      '.mls-sv-report ul{margin:6px 0 0;padding-left:18px;}';
    var st = document.createElement('style');
    st.id = STYLE_ID; st.type = 'text/css';
    st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }

  function stack() {
    var s = document.getElementById(STACK_ID);
    if (!s) {
      s = document.createElement('div');
      s.id = STACK_ID;
      (document.body || document.documentElement).appendChild(s);
    }
    return s;
  }

  // kind: 'ok' | 'warn' | 'info'.  sticky warns stay until closed.
  function banner(kind, title, lines, opts) {
    opts = opts || {};
    try {
      injectStyle();
      var card = document.createElement('div');
      card.className = 'mls-sv-card mls-sv-' + (kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : 'info');
      var icon = document.createElement('div');
      icon.className = 'mls-sv-icon';
      icon.textContent = kind === 'ok' ? '✓' : kind === 'warn' ? '⚠' : 'ℹ';
      var body = document.createElement('div');
      body.className = 'mls-sv-body';
      var t = document.createElement('div'); t.className = 'mls-sv-title'; t.textContent = title || '';
      body.appendChild(t);
      if (lines && lines.length) {
        var l = document.createElement('div'); l.className = 'mls-sv-lines';
        l.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
        body.appendChild(l);
      }
      var x = document.createElement('button');
      x.className = 'mls-sv-x'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×';
      x.onclick = function () { if (card.parentNode) card.parentNode.removeChild(card); };
      card.appendChild(icon); card.appendChild(body); card.appendChild(x);
      stack().appendChild(card);
      var ttl = opts.ttl != null ? opts.ttl : (kind === 'ok' ? 6000 : 0); // warns sticky by default
      if (ttl > 0) setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, ttl);
      return card;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // RESULT -> banner translators
  // ---------------------------------------------------------------------------
  function presentVisitResult(res, serverInfo) {
    var serverLine = serverSuffix(serverInfo);
    if (res.ok) {
      var n = res.savedCount;
      banner('ok', '✓ All ' + n + ' visit' + (n === 1 ? '' : 's') + ' saved and verified',
        serverLine ? [serverLine] : []);
    } else {
      var msg = [];
      if (!res.patientFound) {
        msg.push('The patient record was not found in the saved store — nothing persisted.');
      } else {
        msg.push('Saved ' + res.savedCount + ' of ' + res.expectedCount + ' visits.');
        if (res.missing.length) {
          msg.push('Missing: ' + res.missing.map(function (m) { return m.date || m.key || m.id || '?'; }).join(', '));
        }
        if (res.mismatches.length) {
          msg.push('Field mismatch on: ' + res.mismatches.map(function (m) {
            return (m.date || m.id || '?') + ' (' + m.fields.join('/') + ')';
          }).join(', '));
        }
        msg.push('Retry the save for the missing item(s).');
      }
      if (serverLine) msg.push(serverLine);
      banner('warn', '⚠ Save incomplete — ' + res.savedCount + ' of ' + res.expectedCount + ' verified', msg);
    }
  }

  function serverSuffix(serverInfo) {
    if (!serverInfo) return '';
    if (serverInfo.checked && serverInfo.ok) return 'Server: confirmed' + (serverInfo.visitCount != null ? ' (' + serverInfo.visitCount + ' on server)' : '') + '.';
    if (serverInfo.checked && !serverInfo.ok) return 'Server: sync in progress (not yet reflected) — local store is saved.';
    return 'Local store verified (survives reload). ' + (serverInfo.reason || 'Server sync handled by the app.');
  }

  // ---------------------------------------------------------------------------
  // HOOK 1 — Athena copy-every-visit pull
  // ---------------------------------------------------------------------------
  // Capture the intended-visits payload independently from the result message,
  // so verification does not rely on run()'s return shape.
  var _lastPull = null; // { visits:[], ok:bool, ts }
  function onResultMessage(ev) {
    try {
      var d = ev && ev.data;
      if (!d || typeof d !== 'object') return;
      var type = d.type || d.kind || '';
      if (type === 'mlsAppAllVisitsResult' || type === 'mlsAppReadAllVisitsResult') {
        var visits = d.visits || (d.result && d.result.visits) || (d.payload && d.payload.visits) || [];
        var ok = (d.ok != null) ? !!d.ok : (d.result ? !!d.result.ok : true);
        _lastPull = { visits: arr(visits), ok: ok, ts: Date.now() };
      }
    } catch (e) {}
  }

  function afterCopyVisits(ref, runResult) {
    // Prefer the run() resolved result; fall back to the captured message.
    var result = runResult && typeof runResult === 'object' ? runResult : null;
    var visits = (result && result.visits) ||
      (_lastPull && (Date.now() - _lastPull.ts < 60000) ? _lastPull.visits : null);
    var ok = result ? (result.ok != null ? !!result.ok : true)
      : (_lastPull ? _lastPull.ok : true);

    // Honest-failure / safety-stop path: nothing was meant to be saved.
    if (ok === false) {
      banner('info', 'No visits were saved',
        ['athenaOne returned no readable visits, or the name/DOB safety check stopped the save.',
          'Nothing was stored — this is the honest result, not an error to retry blindly.'], { ttl: 9000 });
      return;
    }
    if (!visits || !visits.length) {
      // We can't see the intended set — verify the patient's current stored
      // visits exist rather than claim a count we cannot prove.
      var sc = scanPatient(ref);
      if (sc.patientFound) {
        banner('info', 'Pull finished — ' + sc.visitCount + ' visit' + (sc.visitCount === 1 ? '' : 's') + ' on file',
          ['Re-read the saved store to confirm. (Could not see the pull payload to verify an exact count.)'], { ttl: 7000 });
      }
      return;
    }
    var res = verifyVisitsSaved(ref, visits);
    verifyServer(ref).then(function (srv) { presentVisitResult(res, srv); });
  }

  function wrapCopyVisits() {
    var cv;
    try { cv = window.__mlsCopyVisits; } catch (e) { return false; }
    if (!cv || typeof cv.run !== 'function') return false;
    if (cv.run.__mlsVerifyWrapped) return true;
    var orig = cv.run;
    var wrapped = function (onStatus) {
      var ref = fn('activePatient') ? safe(fn('activePatient')) : null;
      var ret;
      ret = orig.apply(this, arguments);
      try {
        Promise.resolve(ret).then(function (r) {
          try { afterCopyVisits(ref, r); } catch (e2) {}
        }, function () { try { afterCopyVisits(ref, { ok: false }); } catch (e3) {} });
      } catch (e) {
        setTimeout(function () { try { afterCopyVisits(ref, null); } catch (e4) {} }, 1500);
      }
      return ret;
    };
    wrapped.__mlsVerifyWrapped = true;
    wrapped.__mlsOrig = orig;
    cv.run = wrapped;
    return true;
  }

  // ---------------------------------------------------------------------------
  // HOOK 2 — upsertPatient (covers add-patient, cohort import, visit edits, …)
  // ---------------------------------------------------------------------------
  var _pendingUpsert = {}; // id -> timer
  var _prevVisitCount = {}; // id -> last seen stored visit count
  var _knownPatients = null; // Set of ids seen at least once

  function patientId(p) { return (p && p.id != null) ? String(p.id) : ('name:' + lc(p && p.name) + '|' + normDob(p && p.dob)); }

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
    var res = verifyPatientSaved(p);
    var isNew = false;
    if (_knownPatients && !_knownPatients.has(key)) isNew = true;
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
    // success: only surface for meaningful saves (new patient / real data added),
    // otherwise stay quiet (still verified). Avoids toast spam on tiny edits.
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
    // seed the "known patients" set so existing patients don't all toast as new
    try {
      var gp = fn('getPatients');
      _knownPatients = new Set();
      if (gp) (gp() || []).forEach(function (p) {
        var k = patientId(p); _knownPatients.add(k); _prevVisitCount[k] = storedVisits(p).length;
      });
    } catch (e) { _knownPatients = new Set(); }

    var wrapped = function (p) {
      var ret;
      ret = up.apply(this, arguments);
      try { scheduleUpsertVerify(p); } catch (e2) {}
      return ret;
    };
    wrapped.__mlsVerifyWrapped = true;
    wrapped.__mlsOrig = up;
    window.upsertPatient = wrapped;
    return true;
  }

  // ---------------------------------------------------------------------------
  // ON-DEMAND — "Verify saved data" button on the profile card
  // ---------------------------------------------------------------------------
  var BTN_ID = 'mlsSvVerifyBtn';
  var RPT_ID = 'mlsSvReport';

  function renderReport(rep) {
    var host = document.getElementById('profileCard') || document.body;
    var old = document.getElementById(RPT_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = document.createElement('div');
    box.id = RPT_ID; box.className = 'mls-sv-report';
    var html = '';
    if (!rep.patientFound) {
      html += '<b class="mls-sv-bad">⚠ Not found in the saved store.</b><br>' +
        'Nothing is persisted for "' + esc(rep.name || '?') + '". The data did not save — retry.';
    } else if (rep.ok) {
      html += '<b class="mls-sv-good">✓ All saved correctly.</b><br>' +
        '“' + esc(rep.name || 'Patient') + '” — <b>' + rep.visitCount + '</b> visit' + (rep.visitCount === 1 ? '' : 's') +
        ' stored, each with clinical content and a date. Re-read live from the saved store.';
    } else {
      html += '<b class="mls-sv-bad">⚠ ' + rep.issues.length + ' issue' + (rep.issues.length === 1 ? '' : 's') + ' found.</b><br>' +
        '“' + esc(rep.name || 'Patient') + '” — ' + rep.visitCount + ' visit' + (rep.visitCount === 1 ? '' : 's') + ' stored.';
      html += '<ul>';
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
    if (btn && btn.parentNode) btn.parentNode.insertBefore(box, btn.nextSibling);
    else host.appendChild(box);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function onDemandScan() {
    var ap = fn('activePatient') ? safe(fn('activePatient')) : null;
    var rep = scanPatient(ap);
    renderReport(rep);
    return rep;
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
  var _obs = null;
  var _wrapIv = null;
  var _scheduled = false;
  function scheduleEnsure() {
    if (_scheduled) return;
    _scheduled = true;
    setTimeout(function () {
      _scheduled = false;
      try { wrapCopyVisits(); } catch (e) {}
      try { ensureButton(); } catch (e) {}
    }, 120);
  }

  function boot() {
    injectStyle();
    // Auto-activate the real server confirm when the app is in server mode.
    try {
      if (!_serverReader && fn('bkBase') && fn('bkToken')) configureServer({ read: _defaultServerRead });
    } catch (e) {}
    window.addEventListener('message', onResultMessage, true); // capture phase, passive (read-only)
    wrapUpsert();
    wrapCopyVisits();
    ensureButton();
    // __mlsCopyVisits is defined by a separately-loaded asset that may execute
    // AFTER us (dynamic <script>, async). Poll a bounded number of times to wrap
    // its run() once it appears. wrapCopyVisits() is idempotent; the loop stops
    // as soon as run() is wrapped or after the bounded window (~10s).
    try {
      var tries = 0;
      _wrapIv = setInterval(function () {
        tries++;
        try { wrapCopyVisits(); } catch (e) {}
        var wrapped = !!(window.__mlsCopyVisits && window.__mlsCopyVisits.run &&
          window.__mlsCopyVisits.run.__mlsVerifyWrapped);
        if (wrapped || tries >= 25) { clearInterval(_wrapIv); _wrapIv = null; }
      }, 400);
    } catch (e) {}
    // Re-wrap copyVisits if its module loads later, and re-add the button if the
    // profile re-renders. The observer only ACTS when something is missing — it
    // never mutates on a steady state (the ctxbar idempotent lesson).
    try {
      _obs = new MutationObserver(function () {
        var needBtn = document.getElementById('profileCard') && !document.getElementById(BTN_ID);
        var needWrap = false;
        try { needWrap = window.__mlsCopyVisits && typeof window.__mlsCopyVisits.run === 'function' && !window.__mlsCopyVisits.run.__mlsVerifyWrapped; } catch (e) {}
        if (needBtn || needWrap) scheduleEnsure();
      });
      _obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {} _obs = null;
    try { if (_wrapIv) clearInterval(_wrapIv); } catch (e) {} _wrapIv = null;
    try { window.removeEventListener('message', onResultMessage, true); } catch (e) {}
    try {
      var cv = window.__mlsCopyVisits;
      if (cv && cv.run && cv.run.__mlsVerifyWrapped && cv.run.__mlsOrig) cv.run = cv.run.__mlsOrig;
    } catch (e) {}
    try {
      if (window.upsertPatient && window.upsertPatient.__mlsVerifyWrapped && window.upsertPatient.__mlsOrig)
        window.upsertPatient = window.upsertPatient.__mlsOrig;
    } catch (e) {}
    [STYLE_ID, STACK_ID, BTN_ID, RPT_ID].forEach(function (id) {
      var el = document.getElementById(id); if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    api.installed = false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------------
  var api = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    verifyVisitsSaved: verifyVisitsSaved,
    verifyPatientSaved: verifyPatientSaved,
    verifyServer: verifyServer,
    configureServer: configureServer,
    scan: onDemandScan,
    scanPatient: scanPatient,
    banner: banner,
    presentVisitResult: presentVisitResult,
    _wrapCopyVisits: wrapCopyVisits,
    _wrapUpsert: wrapUpsert,
    _afterCopyVisits: afterCopyVisits,
    _freshPatient: freshPatient,
    _visitKey: visitKey,
    _realContent: realContent,
    _defaultServerRead: _defaultServerRead,
    revert: revert
  };
  window.__mlsSaveVerify = api;

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } catch (e) {}

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
