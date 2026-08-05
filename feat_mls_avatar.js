/* ============================================================================
 * feat_mls_avatar.js -> window.__mlsAvatar (av-1.0.0)
 * ---------------------------------------------------------------------------
 * The doctor's side of the AVATAR — the patient-facing AI check-in that the
 * practice programs. Three jobs:
 *
 *   1. PROGRAM: a panel where the doctor names the avatar and writes the
 *      question list (one per line). Saved server-side (encrypted at rest);
 *      the patient portal interviews from it.
 *   2. KNOW: a top-bar menu entry with a red badge when completed check-ins
 *      are READY. Counts refresh event-driven only — one fetch after app
 *      ready, on tab refocus (min 2 minutes apart), and on panel open.
 *      NO permanent polling, NO document-wide observers.
 *   3. READ + IMPORT: each ready check-in shows the doctor bullets (red flags
 *      first) and the patient-reported summary. "Add to visit summary" appends
 *      it to the EXACT chart with a provenance stamp and an idempotency guard
 *      (never twice); the chart resolves fail-closed by external id — an
 *      ambiguous or unknown patient disables the button and says so.
 *
 * HARD SAFETY: read-only against the backend inbox except mark-seen; the only
 * chart write is the local summary append via upsertPatient. No Athena, no
 * orders, no signing. Idempotent, reversible: window.__mlsAvatar.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsAvatar && window.__mlsAvatar.installed) return; } catch (e) { return; }
  if (window.__MLS_PUBLIC_PREVIEW && window.__MLS_PUBLIC_PREVIEW.enabled === true) {
    window.__mlsAvatar = { installed: false, skipped: 'public-synthetic-preview', version: 'av-1.0.0' };
    return;
  }

  var VERSION = 'av-2.0.2';
  var ASSET = 'feat_mls_avatar.js';
  var BUTTON_ID = 'mlsAvBtn';
  var BACK_ID = 'mlsAvBack';
  var STYLE_ID = 'mlsAvStyle';
  var REFRESH_MIN_MS = 120000;

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function isFn(f) { return typeof f === 'function'; }
  function clean(value) {
    var text = value == null ? '' : String(value).trim();
    return (!text || /^(undefined|null)$/i.test(text)) ? '' : text;
  }
  function token() {
    return safe(function () {
      if (isFn(window.bkToken)) return window.bkToken() || '';
      return localStorage.getItem('sf_bk_token') || sessionStorage.getItem('sf_bk_token') || '';
    }, '');
  }
  function apiBase() {
    return safe(function () { return isFn(window.bkBase) ? window.bkBase() : 'https://scrivara-backend.onrender.com'; },
      'https://scrivara-backend.onrender.com');
  }
  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var auth = token();
    if (auth) headers.Authorization = 'Bearer ' + auth;
    return fetch(apiBase() + path, Object.assign({}, options, { headers: headers })).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (json) {
        return { ok: response.ok, status: response.status, json: json };
      });
    });
  }
  function primaryExternal(patient) {
    if (!patient || typeof patient !== 'object') return '';
    return clean(patient.id) || clean(patient.athenaId) || clean(patient.mrn);
  }
  function exactPatient(externalId) {
    var id = clean(externalId);
    if (!id) return null;
    var patients = safe(function () { return window.getPatients && window.getPatients(); }, []);
    if (!Array.isArray(patients)) return null;
    var matches = patients.filter(function (patient) { return primaryExternal(patient) === id; });
    return matches.length === 1 ? matches[0] : null;
  }

  function style() {
    if (gid(STYLE_ID)) return;
    var node = document.createElement('style');
    node.id = STYLE_ID;
    node.textContent =
      '#' + BUTTON_ID + '.mlsAvFallback{border:1px solid #d7ded9;background:#fff;color:#204034;border-radius:10px;padding:8px 12px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}' +
      '#' + BUTTON_ID + ' .mlsAvCount{display:none;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#9f2d2d;color:#fff;font-size:11px;align-items:center;justify-content:center}' +
      '#' + BUTTON_ID + ' .mlsAvCount.on{display:inline-flex}' +
      '.mlsAvBack{position:fixed;inset:0;z-index:2147483000;background:rgba(20,33,28,.55);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.mlsAvPanel{width:min(760px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(20,33,28,.32);padding:22px;color:#1A211C;font-family:\'Public Sans\',system-ui,-apple-system,\'Segoe UI\',sans-serif}' +
      '.mlsAvHead{display:flex;gap:16px;justify-content:space-between;align-items:flex-start}.mlsAvHead h2{font:700 21px/1.2 \'Newsreader\',Georgia,serif;color:#204034;margin:0 0 4px}.mlsAvSub{font-size:13px;color:#55605A;max-width:610px}' +
      '.mlsAvClose{border:1px solid #E7E5DD;background:#F4F2EC;color:#204034;border-radius:9px;padding:8px 11px;font-weight:700;cursor:pointer}' +
      '.mlsAvTabs{display:flex;gap:7px;margin:16px 0 12px}.mlsAvTab{border:1px solid #d7ded9;background:#fff;color:#204034;border-radius:999px;padding:7px 12px;font-weight:700;cursor:pointer}.mlsAvTab.on{background:#204034;color:#fff}' +
      '.mlsAvNotice{border-radius:10px;padding:10px 12px;font-size:13px;background:#FCF8EF;border:1px solid #EFE4CE;color:#845d2d}' +
      '.mlsAvList{display:grid;gap:10px}.mlsAvCard{border:1px solid #E7E5DD;border-radius:12px;padding:13px;background:#FCFBF8}.mlsAvTitle{font-weight:800;color:#204034}.mlsAvMeta{font-size:12px;color:#69736d;margin-top:2px}' +
      '.mlsAvBullets{margin:10px 0 0;padding-left:19px;font-size:13.5px;display:grid;gap:4px}.mlsAvBullets li.flag{color:#9f2d2d;font-weight:700}' +
      '.mlsAvSummary{margin-top:9px;font-size:13px;color:#3a453f;background:#fff;border:1px solid #E7E5DD;border-radius:10px;padding:9px 11px;white-space:pre-wrap;max-height:180px;overflow:auto}' +
      '.mlsAvActions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.mlsAvAction{border:1px solid #cbd8d0;background:#EAF1EE;color:#204034;border-radius:9px;padding:8px 11px;font-weight:750;cursor:pointer}.mlsAvAction.primary{border-color:#204034;background:#204034;color:#fff}.mlsAvAction[disabled]{opacity:.6;cursor:default}' +
      '.mlsAvForm{display:grid;gap:9px}.mlsAvForm label{font-size:12.5px;font-weight:700;color:#55605A}.mlsAvForm input,.mlsAvForm textarea{width:100%;box-sizing:border-box;border:1px solid #d7ded9;border-radius:10px;padding:9px 11px;font:13.5px \'Public Sans\',system-ui,sans-serif}' +
      '@media(max-width:600px){.mlsAvPanel{padding:17px}.mlsAvAction{min-height:44px}.mlsAvHead h2{font-size:19px}}';
    (document.head || document.documentElement).appendChild(node);
  }

  function buttonMarkup(button) {
    button.innerHTML = '<span aria-hidden="true">&#129489;&#8205;&#9877;&#65039;</span><span>Avatar check-ins</span><span class="mlsAvCount" aria-label="ready check-ins"></span>';
  }
  function ensureButton() {
    style();
    var existing = gid(BUTTON_ID);
    var menu = gid('mlsTbMenuPanel');
    var tools = safe(function () { return document.querySelector('.tools'); }, null);
    var host = menu || tools;
    if (!host) return false;
    if (!existing) {
      existing = document.createElement('button');
      existing.id = BUTTON_ID;
      existing.type = 'button';
      existing.addEventListener('click', function (event) {
        event.preventDefault(); event.stopPropagation();
        safe(function () { if (window.__mlsTopbar) window.__mlsTopbar.closeMenu(); });
        open();
      });
      buttonMarkup(existing);
    }
    if (menu) {
      existing.className = 'mlsTbItem';
      var settings = Array.prototype.find.call(menu.querySelectorAll('button'), function (node) {
        return /settings/i.test(node.textContent || '');
      });
      if (existing.parentNode !== menu || (settings && existing.nextSibling !== settings)) menu.insertBefore(existing, settings || null);
    } else if (existing.parentNode !== tools) {
      existing.className = 'mlsAvFallback';
      tools.appendChild(existing);
    }
    return true;
  }
  function setCount(count) {
    var badge = safe(function () { var b = gid(BUTTON_ID); return b && b.querySelector('.mlsAvCount'); }, null);
    if (!badge) return;
    var value = Math.max(0, Number(count) || 0);
    badge.textContent = value > 99 ? '99+' : String(value);
    badge.classList.toggle('on', value > 0);
  }

  /* ---- event-driven badge refresh (no polling) ----
     av-1.2.0: the fetched ready list is CACHED on the public surface so the
     Copilot's snapshot can answer "who's ready for me?" without a second
     network path. The cache carries a timestamp; consumers judge freshness. */
  var lastRefreshAt = 0, refreshInFlight = false;
  function cacheReady(rows) {
    safe(function () {
      /* av-2.0.2: the ACTIVE patient's row must survive the sampling — with
         21+ ready, an older check-in for the open patient vanished from the
         Visit card while the panel showed it. */
      var sample = (rows || []).slice(0, 20);
      var activeId = activePtIdSafe();
      if (activeId && (rows || []).length > sample.length) {
        var inSample = sample.some(function (c) { return clean(c.patient_external_id) === activeId; });
        if (!inSample) {
          for (var ri = 20; ri < rows.length; ri++) {
            if (clean(rows[ri].patient_external_id) === activeId) { sample.push(rows[ri]); break; }
          }
        }
      }
      window.__mlsAvatar.lastReady = {
        at: Date.now(),
        total: (rows || []).length, /* the TRUE count — the list below is a sample */
        checkins: sample.map(function (c) {
          return {
            id: c.id,
            patient_external_id: clean(c.patient_external_id),
            ready_at: c.ready_at || null,
            bullets: (Array.isArray(c.bullets) ? c.bullets : []).slice(0, 3).map(function (b) { return String(b).slice(0, 160); }),
            /* av-2.0.0: the Visit card files the summary into transcript/chart
               without a second fetch — bounded to keep the cache small.
               av-2.0.2: a slice is a TRUNCATION and must say so — the card
               refetches the full row before filing a truncated one, or a
               mid-sentence cut would be stamped into the chart forever. */
            summary: c.summary ? String(c.summary).slice(0, 4000) : null,
            truncated: !!(c.summary && String(c.summary).length > 4000),
            flags: Array.isArray(c.flags) ? c.flags : []
          };
        })
      };
    });
  }
  function refreshCount(force) {
    if (refreshInFlight) return;
    var now = Date.now();
    if (!force && (now - lastRefreshAt) < REFRESH_MIN_MS) return;
    if (!token()) return;
    refreshInFlight = true; lastRefreshAt = now;
    api('/api/avatar/checkins?status=ready').then(function (r) {
      refreshInFlight = false;
      if (r.ok && r.json && Array.isArray(r.json.checkins)) {
        setCount(r.json.checkins.length);
        cacheReady(r.json.checkins);
        ensureVisitCard();
      }
    }, function () { refreshInFlight = false; });
  }

  function close() {
    safe(function () { stopCamera(); }); /* never leave the camera running */
    var back = gid(BACK_ID);
    if (back && back.parentNode) back.parentNode.removeChild(back);
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(event) {
    if (event.key !== 'Escape') return;
    /* Escape while TYPING in the panel (preview answers, the question list)
       must not destroy unsaved edits — blur the field instead of closing. */
    var target = event.target;
    if (target && target.closest && target.closest('.mlsAvPanel') && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '')) {
      safe(function () { target.blur(); });
      return;
    }
    close();
  }
  function make(tag, className, textValue) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue != null) node.textContent = textValue;
    return node;
  }
  function formatDate(value) {
    return safe(function () {
      var date = new Date(String(value).indexOf('T') < 0 ? String(value).replace(' ', 'T') + 'Z' : value);
      return isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }, '');
  }

  /* ---- import into the exact chart, once ----
     av-1.1.0: NEVER mutate the store object before the save is confirmed —
     getPatients() rows alias the app's memoized store, so a pre-save mutation
     followed by a failed/absent upsert left a stamp on an object nothing
     persisted: the button then lied "Already in chart" while the summary was
     lost. The write goes through a COPY, and success is only claimed after
     re-reading the store and finding the stamp (confirming must record). */
  function importStamp(checkin) {
    return '[Avatar check-in #' + (checkin.id != null ? checkin.id : '?') + ' — completed ' +
      (formatDate(checkin.ready_at) || checkin.ready_at || '') + ']';
  }
  function importSummary(checkin, button) {
    var patient = exactPatient(checkin.patient_external_id);
    if (!patient) {
      /* av-2.0.2: never a silent dead click — the panel pre-disables this
         case, but the Visit card reaches here on an ambiguous/unknown match. */
      toast('No single exact chart matches this portal patient, so nothing was filed. Open Patients and add it there.');
      return;
    }
    var stamp = importStamp(checkin);
    if (String(patient.summary || '').indexOf(stamp) >= 0) {
      button.disabled = true; button.textContent = 'Already in chart';
      return;
    }
    var existingSummary = String(patient.summary || '').trim();
    var block = stamp + '\n' + String(checkin.summary || '').trim();
    var updated = {};
    for (var k in patient) if (Object.prototype.hasOwnProperty.call(patient, k)) updated[k] = patient[k];
    updated.summary = existingSummary ? (existingSummary + '\n\n' + block) : block;
    safe(function () { if (isFn(window.upsertPatient)) window.upsertPatient(updated); });
    /* Trust only what the store proves: re-read and require the stamp. */
    var verify = exactPatient(checkin.patient_external_id);
    if (verify && String(verify.summary || '').indexOf(stamp) >= 0) {
      button.disabled = true; button.textContent = 'Added to chart ✓';
      safe(function () { if (isFn(window.toast)) window.toast('Check-in summary added to ' + (verify.name || 'the patient') + '\'s chart.', 'ok'); });
    } else {
      button.disabled = false; button.textContent = 'Could not save — try again or use Patients';
      safe(function () { if (isFn(window.toast)) window.toast('The summary was NOT saved to the chart — nothing was recorded. Try again, or open the chart and paste it.', ''); });
    }
  }

  function checkinCard(checkin) {
    var card = make('div', 'mlsAvCard');
    var patient = exactPatient(checkin.patient_external_id);
    var title = patient ? (patient.name || 'Patient') : ('Patient (portal id ' + (clean(checkin.patient_external_id) || 'unknown') + ')');
    card.appendChild(make('div', 'mlsAvTitle', title));
    card.appendChild(make('div', 'mlsAvMeta',
      (checkin.status === 'ready' ? 'Ready ' : 'Seen ') + (formatDate(checkin.ready_at || checkin.created_at) || '') +
      ' · ' + (Number(checkin.turns) || 0) + ' turns'));
    if (Array.isArray(checkin.bullets) && checkin.bullets.length) {
      var ul = make('ul', 'mlsAvBullets');
      checkin.bullets.forEach(function (bullet) {
        var li = make('li', /^⚠/.test(String(bullet)) ? 'flag' : '', String(bullet));
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    if (checkin.summary) card.appendChild(make('div', 'mlsAvSummary', String(checkin.summary)));
    var actions = make('div', 'mlsAvActions');
    if (checkin.summary) {
      var copyBtn = make('button', 'mlsAvAction', 'Copy summary');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', function () {
        /* No eager Promise.reject fallback — that constructs an unhandled
           rejection on every SUCCESSFUL copy. */
        var p;
        try { p = navigator.clipboard.writeText(String(checkin.summary)); }
        catch (e) { p = Promise.reject(e); }
        Promise.resolve(p).then(function () { copyBtn.textContent = 'Copied ✓'; },
          function () { copyBtn.textContent = 'Could not copy'; });
      });
      actions.appendChild(copyBtn);
    }
    var openBtn = make('button', 'mlsAvAction', patient ? 'Open chart' : 'No matching chart');
    openBtn.type = 'button';
    if (patient) {
      openBtn.addEventListener('click', function () {
        var localId = clean(patient.id);
        safe(function () { if (window.setActivePtId) window.setActivePtId(localId); });
        safe(function () { if (window.openPatient) window.openPatient(localId); else if (window.showView) window.showView('patients'); });
        close();
      });
    } else {
      openBtn.disabled = true;
      openBtn.title = 'No single exact chart matches this portal patient — open Patients and find them by name.';
    }
    actions.appendChild(openBtn);
    var importBtn = make('button', 'mlsAvAction primary', 'Add to visit summary');
    importBtn.type = 'button';
    if (patient && checkin.summary) importBtn.addEventListener('click', function () { importSummary(checkin, importBtn); });
    else { importBtn.disabled = true; importBtn.title = patient ? 'No summary to import.' : 'Needs an exact chart match first.'; }
    actions.appendChild(importBtn);
    if (checkin.status === 'ready') {
      var seenBtn = make('button', 'mlsAvAction', 'Mark seen');
      seenBtn.type = 'button';
      seenBtn.addEventListener('click', function () {
        seenBtn.disabled = true; seenBtn.textContent = 'Saving...';
        api('/api/avatar/checkins/' + checkin.id + '/seen', { method: 'POST' }).then(function (r) {
          if (r.ok) { seenBtn.textContent = 'Seen ✓'; refreshCount(true); }
          else { seenBtn.disabled = false; seenBtn.textContent = 'Mark seen'; }
        }, function () { seenBtn.disabled = false; seenBtn.textContent = 'Mark seen'; });
      });
      actions.appendChild(seenBtn);
    }
    card.appendChild(actions);
    return card;
  }

  /* ---- the avatar's face: camera capture -> stylized portrait ----
     Local only: the camera runs in THIS panel on the doctor's click, the
     snapshot is stylized on a canvas, and only the small final portrait is
     saved (encrypted, in the avatar config). Tracks are stopped on every exit
     path including panel close. */
  var cameraStream = null;
  function stopCamera() {
    if (!cameraStream) return;
    safe(function () { cameraStream.getTracks().forEach(function (t) { t.stop(); }); });
    cameraStream = null;
  }
  function stylizePortrait(video) {
    var size = 256;
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    var vw = video.videoWidth || size, vh = video.videoHeight || size;
    var side = Math.min(vw, vh);
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
    /* gentle stylization: posterized tones + a touch of warmth — a friendly
       illustrated rendition of the doctor's face, not a raw photo */
    var img = ctx.getImageData(0, 0, size, size), d = img.data;
    var levels = 6, step = 255 / (levels - 1);
    for (var i = 0; i < d.length; i += 4) {
      d[i] = Math.round(Math.min(255, d[i] * 1.06) / step) * step;
      d[i + 1] = Math.round(d[i + 1] / step) * step;
      d[i + 2] = Math.round((d[i + 2] * 0.97) / step) * step;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.82);
  }
  function facePreviewNode(dataUrl) {
    var wrap = make('div', '');
    wrap.style.cssText = 'width:72px;height:72px;border-radius:999px;overflow:hidden;border:2px solid #E7E5DD;background:#F4F2EC;display:flex;align-items:center;justify-content:center;font-size:34px';
    if (dataUrl && String(dataUrl).indexOf('data:image/') === 0) {
      var img = document.createElement('img'); img.alt = ''; img.src = dataUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      wrap.appendChild(img);
    } else wrap.textContent = '🧑‍⚕️';
    return wrap;
  }

  /* ---- setup tab ---- */
  function setupForm(host) {
    host.innerHTML = '';
    var notice = make('div', 'mlsAvNotice', 'Loading your avatar setup…');
    host.appendChild(notice);
    api('/api/avatar/config').then(function (r) {
      /* av-1.1.0: a failed GET must NOT fail open to an editable EMPTY form —
         one Save from that state would overwrite the real question list and
         switch the patient-facing check-in off. */
      if (!r.ok || !r.json || r.json.ok !== true) {
        notice.textContent = 'Setup could not load your current avatar — nothing is shown so nothing can be overwritten. Try again in a moment.';
        return;
      }
      host.innerHTML = '';
      var cfg = r.json.config || {};
      var form = make('div', 'mlsAvForm');
      function section(text, sub) {
        var s = make('div', '');
        s.style.cssText = 'margin-top:6px;padding-top:10px;border-top:1px solid #EFEDE6';
        var h = make('div', '', text); h.style.cssText = 'font:800 13px \'Public Sans\',system-ui;color:#204034';
        s.appendChild(h);
        if (sub) { var p = make('div', '', sub); p.style.cssText = 'font-size:12px;color:#69736d;margin-top:2px'; s.appendChild(p); }
        return s;
      }
      var nameLabel = make('label', '', 'Avatar name (what patients see)');
      var nameInput = make('input'); nameInput.value = cfg.name || 'Ava'; nameInput.maxLength = 60;
      var introLabel = make('label', '', 'Greeting line (optional)');
      var introInput = make('input'); introInput.value = cfg.intro || ''; introInput.maxLength = 400;
      introInput.placeholder = 'e.g. A few quick questions before your visit with Dr. Schaeffer.';
      /* ---- face section ---- */
      var pendingFace; /* undefined = keep current; '' = remove; data URL = new */
      var faceLabel = make('label', '', 'Avatar face — patients see this portrait during the check-in');
      var faceRow = make('div', '');
      faceRow.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap';
      var facePreview = facePreviewNode(cfg.faceImage);
      var camBtn = make('button', 'mlsAvAction', '📷 Create from my camera');
      camBtn.type = 'button';
      var removeFaceBtn = make('button', 'mlsAvAction', 'Remove face');
      removeFaceBtn.type = 'button';
      var camHost = make('div', '');
      removeFaceBtn.addEventListener('click', function () {
        pendingFace = '';
        var fresh = facePreviewNode(null);
        faceRow.replaceChild(fresh, facePreview); facePreview = fresh;
        status.textContent = 'Face removed — Save to make it permanent. Patients will see the standard assistant icon.';
      });
      camBtn.addEventListener('click', function () {
        camHost.innerHTML = '';
        stopCamera();
        var media = safe(function () { return navigator.mediaDevices && navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }); }, null);
        if (!media) { camHost.appendChild(make('div', 'mlsAvNotice', 'This browser cannot open the camera here.')); return; }
        media.then(function (stream) {
          cameraStream = stream;
          var video = document.createElement('video');
          video.autoplay = true; video.playsInline = true; video.muted = true;
          video.srcObject = stream;
          video.style.cssText = 'width:200px;height:200px;object-fit:cover;border-radius:14px;border:1px solid #E7E5DD;transform:scaleX(-1)';
          var snapBtn = make('button', 'mlsAvAction primary', 'Snap photo'); snapBtn.type = 'button';
          var cancelBtn = make('button', 'mlsAvAction', 'Cancel'); cancelBtn.type = 'button';
          var row = make('div', 'mlsAvActions');
          row.appendChild(snapBtn); row.appendChild(cancelBtn);
          camHost.appendChild(video); camHost.appendChild(row);
          cancelBtn.addEventListener('click', function () { stopCamera(); camHost.innerHTML = ''; });
          snapBtn.addEventListener('click', function () {
            var dataUrl = safe(function () { return stylizePortrait(video); }, null);
            stopCamera(); camHost.innerHTML = '';
            if (!dataUrl || dataUrl.length > 150000) {
              camHost.appendChild(make('div', 'mlsAvNotice', 'That capture did not work — try again with more light.'));
              return;
            }
            pendingFace = dataUrl;
            var fresh = facePreviewNode(dataUrl);
            faceRow.replaceChild(fresh, facePreview); facePreview = fresh;
            status.textContent = 'Portrait captured (stylized from your photo, processed on this device). Save to publish it to your patients.';
          });
        }, function () {
          camHost.appendChild(make('div', 'mlsAvNotice', 'Camera permission was declined — nothing was captured.'));
        });
      });
      faceRow.appendChild(facePreview); faceRow.appendChild(camBtn); faceRow.appendChild(removeFaceBtn);

      var toneLabel = make('label', '', 'Tone — how the avatar talks to your patients');
      var toneSelect = document.createElement('select');
      toneSelect.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid #d7ded9;border-radius:10px;padding:9px 11px;font:13.5px \'Public Sans\',system-ui,sans-serif';
      [['friendly', 'Warm & friendly (default)'], ['professional', 'Professional & brief'], ['simple', 'Plain & simple language']].forEach(function (opt) {
        var o = document.createElement('option'); o.value = opt[0]; o.textContent = opt[1];
        if ((cfg.tone || 'friendly') === opt[0]) o.selected = true;
        toneSelect.appendChild(o);
      });

      /* av-2.0.0: a REAL question editor — one row per question with remove
         and reorder, plus one-tap starter questions. The avatar asks these in
         order and adds its own smart follow-ups live. */
      var qList = make('div', ''); qList.style.cssText = 'display:grid;gap:6px';
      var qRows = [];
      function qValues() {
        return qRows.map(function (r) { return r.input.value.trim(); }).filter(Boolean).slice(0, 20);
      }
      function reflowQ() {
        qList.innerHTML = '';
        qRows.forEach(function (r, i) {
          r.num.textContent = (i + 1) + '.';
          r.up.disabled = i === 0; r.down.disabled = i === qRows.length - 1;
          qList.appendChild(r.row);
        });
      }
      function addQRow(text, focus) {
        if (qRows.length >= 20) { safe(function () { window.toast('Up to 20 questions.', ''); }); return; }
        var row = make('div', ''); row.style.cssText = 'display:flex;gap:6px;align-items:center';
        var num = make('span', ''); num.style.cssText = 'font:700 12px system-ui;color:#69736d;min-width:20px;text-align:right';
        var input = make('input'); input.value = text || ''; input.placeholder = 'Type a question…'; input.maxLength = 300; input.style.flex = '1';
        var up = make('button', 'mlsAvAction', '↑'); up.type = 'button'; up.title = 'Move up';
        var down = make('button', 'mlsAvAction', '↓'); down.type = 'button'; down.title = 'Move down';
        var del = make('button', 'mlsAvAction', '✕'); del.type = 'button'; del.title = 'Remove this question';
        [up, down, del].forEach(function (b) { b.style.padding = '6px 9px'; });
        var entry = { row: row, input: input, num: num, up: up, down: down };
        up.addEventListener('click', function () { var i = qRows.indexOf(entry); if (i > 0) { qRows.splice(i, 1); qRows.splice(i - 1, 0, entry); reflowQ(); } });
        down.addEventListener('click', function () { var i = qRows.indexOf(entry); if (i >= 0 && i < qRows.length - 1) { qRows.splice(i, 1); qRows.splice(i + 1, 0, entry); reflowQ(); } });
        del.addEventListener('click', function () { var i = qRows.indexOf(entry); if (i >= 0) { qRows.splice(i, 1); reflowQ(); } });
        row.appendChild(num); row.appendChild(input); row.appendChild(up); row.appendChild(down); row.appendChild(del);
        qRows.push(entry); reflowQ();
        if (focus) safe(function () { input.focus(); });
      }
      (Array.isArray(cfg.questions) ? cfg.questions : []).forEach(function (q) { addQRow(q); });
      var addQBtn = make('button', 'mlsAvAction', '+ Add question'); addQBtn.type = 'button';
      addQBtn.addEventListener('click', function () { addQRow('', true); });
      var starters = make('div', 'mlsAvActions');
      var starterNote = make('div', 'mlsAvMeta', qRows.length ? 'Quick add:' : 'Start from the basics — tap to add:');
      [['What brings you in today?'], ['How bad is the pain right now, 0-10?'], ['Where exactly is the pain, and does it travel anywhere?'], ['Any new medications, allergies, or health changes since your last visit?'], ['What makes it better or worse?']].forEach(function (s) {
        var chip = make('button', 'mlsAvAction', '+ ' + s[0]); chip.type = 'button';
        chip.addEventListener('click', function () {
          if (qValues().indexOf(s[0]) >= 0) return;
          addQRow(s[0]);
        });
        starters.appendChild(chip);
      });
      var saveBtn = make('button', 'mlsAvAction primary', 'Save avatar');
      saveBtn.type = 'button';
      var status = make('div', 'mlsAvMeta', '');
      saveBtn.addEventListener('click', function () {
        var questions = qValues();
        saveBtn.disabled = true; status.textContent = 'Saving…';
        api('/api/avatar/config', { method: 'POST', body: JSON.stringify({ name: nameInput.value.trim() || 'Ava', intro: introInput.value.trim(), questions: questions,
          tone: toneSelect.value,
          faceImage: pendingFace === undefined ? (cfg.faceImage || '') : pendingFace }) })
          .then(function (r2) {
            saveBtn.disabled = false;
            status.textContent = (r2.ok && r2.json && r2.json.ok)
              ? (questions.length ? ('Saved — the avatar now asks ' + questions.length + ' question' + (questions.length === 1 ? '' : 's') + '. Patients see it in their portal.') : 'Saved, but with no questions the check-in stays OFF for patients.')
              : 'Could not save — check your connection and try again.';
          }, function () { saveBtn.disabled = false; status.textContent = 'Could not save — check your connection and try again.'; });
      });
      /* av-1.2.0: PREVIEW — walk the interview exactly as a patient would see
         the scripted flow, from the UNSAVED form values, entirely local (no
         network, no session, nothing stored). The live interview adds AI
         follow-ups on top of this script. */
      var previewBtn = make('button', 'mlsAvAction', 'Preview the interview');
      previewBtn.type = 'button';
      var previewHost = make('div', '');
      previewBtn.addEventListener('click', function () {
        var questions = qValues();
        previewHost.innerHTML = '';
        if (!questions.length) { previewHost.appendChild(make('div', 'mlsAvNotice', 'Write at least one question above, then preview.')); return; }
        var log = make('div', 'mlsAvSummary'); log.style.maxHeight = '260px';
        var idx = 0;
        function sayLine(who, text) { var d = make('div', '', who + ': ' + text); d.style.margin = '4px 0'; if (who !== 'You') d.style.fontWeight = '600'; log.appendChild(d); log.scrollTop = log.scrollHeight; }
        var avName = nameInput.value.trim() || 'Ava';
        sayLine(avName, 'Hi, I\'m ' + avName + '. ' + (introInput.value.trim() ? introInput.value.trim() + ' ' : '') + 'This takes just a few minutes. ' + questions[0]);
        var row = make('div', ''); row.style.cssText = 'display:flex;gap:8px;margin-top:6px';
        var inp = make('input'); inp.placeholder = 'Type a sample answer…'; inp.style.cssText = 'flex:1;border:1px solid #d7ded9;border-radius:10px;padding:8px 10px;font:13px system-ui';
        var send = make('button', 'mlsAvAction', 'Send'); send.type = 'button';
        function advance() {
          var v = inp.value.trim(); if (!v) return;
          sayLine('You', v); inp.value = '';
          idx++;
          if (idx < questions.length) { sayLine(avName, 'Thanks. ' + questions[idx]); }
          else {
            sayLine(avName, 'That covers everything — thank you! Your answers are on their way to your care team.');
            inp.disabled = true; send.disabled = true;
            previewHost.appendChild(make('div', 'mlsAvMeta', 'Preview complete (' + questions.length + ' questions). Nothing was saved or sent. The live interview also asks smart follow-ups when answers need detail.'));
          }
        }
        send.addEventListener('click', advance);
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); advance(); } });
        row.appendChild(inp); row.appendChild(send);
        previewHost.appendChild(log); previewHost.appendChild(row);
        inp.focus();
      });

      form.appendChild(section('1 · Identity', 'Who greets your patients — the name, the tone, and your face.'));
      form.appendChild(nameLabel); form.appendChild(nameInput);
      form.appendChild(introLabel); form.appendChild(introInput);
      form.appendChild(toneLabel); form.appendChild(toneSelect);
      form.appendChild(faceLabel); form.appendChild(faceRow); form.appendChild(camHost);
      form.appendChild(section('2 · Questions', 'Asked in order. The avatar adds its own smart follow-ups when an answer needs detail.'));
      form.appendChild(qList); form.appendChild(addQBtn);
      form.appendChild(starterNote); form.appendChild(starters);
      form.appendChild(section('3 · Save & try it', 'Preview walks the interview exactly as a patient sees the script — nothing is saved or sent by the preview.'));
      var btnRow = make('div', 'mlsAvActions');
      btnRow.appendChild(saveBtn); btnRow.appendChild(previewBtn);
      form.appendChild(btnRow); form.appendChild(status);
      form.appendChild(previewHost);
      host.appendChild(form);
    }, function () {
      notice.textContent = 'Setup is temporarily unavailable — try again in a moment.';
    });
  }

  /* ---- inbox tab ---- */
  function inboxList(host, status) {
    host.innerHTML = '';
    var notice = make('div', 'mlsAvNotice', 'Checking for completed check-ins…');
    host.appendChild(notice);
    api('/api/avatar/checkins?status=' + status).then(function (r) {
      host.innerHTML = '';
      var rows = (r.ok && r.json && Array.isArray(r.json.checkins)) ? r.json.checkins : null;
      if (!rows) { host.appendChild(make('div', 'mlsAvNotice', 'Could not load check-ins — try again in a moment.')); return; }
      if (status === 'ready') { setCount(rows.length); cacheReady(rows); }
      if (!rows.length) {
        host.appendChild(make('div', 'mlsAvNotice', status === 'ready'
          ? 'No completed check-ins waiting. When a patient finishes the avatar interview in their portal, it lands here with the highlights.'
          : 'Nothing here yet.'));
        return;
      }
      var list = make('div', 'mlsAvList');
      rows.forEach(function (checkin) { list.appendChild(checkinCard(checkin)); });
      host.appendChild(list);
    }, function () {
      notice.textContent = 'Could not load check-ins — try again in a moment.';
    });
  }

  function open() {
    close();
    style();
    var back = make('div', 'mlsAvBack'); back.id = BACK_ID;
    back.addEventListener('click', function (event) { if (event.target === back) close(); });
    var panel = make('div', 'mlsAvPanel');
    var head = make('div', 'mlsAvHead');
    var heading = make('div');
    heading.appendChild(make('h2', '', 'Avatar check-ins'));
    heading.appendChild(make('div', 'mlsAvSub', 'Your programmed avatar interviews patients in their portal before the visit. Completed check-ins land here with the key points first; import the summary into the chart with one tap.'));
    var closeBtn = make('button', 'mlsAvClose', 'Close');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', close);
    head.appendChild(heading); head.appendChild(closeBtn);
    panel.appendChild(head);
    var tabs = make('div', 'mlsAvTabs');
    var body = make('div');
    var defs = [['ready', 'Ready'], ['seen', 'Seen'], ['setup', 'Set up the avatar']];
    defs.forEach(function (def, index) {
      var tab = make('button', 'mlsAvTab' + (index === 0 ? ' on' : ''), def[1]);
      tab.type = 'button';
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(tabs.children, function (node) { node.classList.remove('on'); });
        tab.classList.add('on');
        if (def[0] === 'setup') setupForm(body); else inboxList(body, def[0]);
      });
      tabs.appendChild(tab);
    });
    panel.appendChild(tabs);
    panel.appendChild(body);
    back.appendChild(panel);
    (document.body || document.documentElement).appendChild(back);
    document.addEventListener('keydown', onKey, true);
    if (pendingSetupTab) {
      pendingSetupTab = false;
      Array.prototype.forEach.call(tabs.children, function (node) { node.classList.remove('on'); });
      tabs.children[2].classList.add('on');
      setupForm(body);
    } else {
      inboxList(body, 'ready');
    }
  }

  /* ---- the Visit-page presence: check-ins meet the doctor where he works.
     A compact card at the BOTTOM of #visitView (never near the patient
     banner — standing owner rule): ready count, a highlight line when the
     ACTIVE patient completed their check-in, one Open button. Rebuilt on
     view/patient events and after each badge refresh — no polling. ---- */
  function activePtIdSafe() {
    return safe(function () { return isFn(window.getActivePtId) ? clean(window.getActivePtId()) : ''; }, '');
  }

  /* av-2.0.0: the patient's own words flow into the VISIT — insert the
     check-in summary into the visit transcript box as a clearly labelled
     patient-reported block, so the drafted note incorporates it. Typing and
     pasting into that box is a first-class supported path (the box invites
     it), and the transcript mirror merges rather than overwrites. Idempotent
     by stamp; honest toast when the box is not on screen. */
  function transcriptStamp(checkin) {
    return '[Pre-visit check-in #' + (checkin.id != null ? checkin.id : '?') + ' — patient-reported]';
  }
  function addToTranscript(checkin, button) {
    var box = gid('ez3flTranscript') || gid('ez3Transcript');
    if (!box || typeof box.value !== 'string') {
      toast('The visit transcript box is not on this screen right now — open the Visit recorder first.');
      return false;
    }
    var stamp = transcriptStamp(checkin);
    if (box.value.indexOf(stamp) >= 0) {
      if (button) { button.disabled = true; button.textContent = 'In transcript ✓'; }
      return true;
    }
    var block = stamp + '\n' + String(checkin.summary || '').trim() + '\n';
    box.value = box.value.trim() ? (box.value.replace(/\s+$/, '') + '\n\n' + block) : block;
    safe(function () { box.dispatchEvent(new Event('input', { bubbles: true })); });
    if (button) { button.disabled = true; button.textContent = 'In transcript ✓'; }
    toast('Patient-reported check-in added to the visit transcript — the drafted note will include it.');
    return true;
  }

  function visitButton(label, primary, onTap) {
    var b = make('button', 'mlsAvAction' + (primary ? ' primary' : ''), label);
    b.type = 'button';
    b.addEventListener('click', function (event) { event.preventDefault(); onTap(b); });
    return b;
  }

  function ensureVisitCard() {
    var view = gid('visitView'); if (!view) return;
    var card = gid('mlsAvVisitCard');
    if (!card) {
      style();
      card = document.createElement('div');
      card.id = 'mlsAvVisitCard';
      card.style.cssText = 'margin:8px 2px 12px;padding:12px 14px;border:1px solid #E7E5DD;border-radius:12px;background:#FCFBF8;font-family:\'Public Sans\',system-ui,sans-serif';
      /* TOP of the visit view — where the doctor's eye already is. (The app's
         top patient banner is untouched; this lives inside the Visit content.) */
      view.insertBefore(card, view.firstChild);
    }
    /* av-2.0.1: the Easy-lane host also claims first-child when it remounts,
       which would sink this card BELOW the entire workspace. Re-assert first
       position on OUR events only (no interval): moving THIS card never
       touches the host subtree, so the doctor's caret in the transcript is
       untouched — the one thing we skip is moving the card out from under a
       focused element of its own. */
    if (view.firstElementChild !== card) {
      var focusInCard = safe(function () { return card.contains(document.activeElement); }, false);
      if (!focusInCard) safe(function () { view.insertBefore(card, view.firstElementChild); });
    }
    var cache = safe(function () { return window.__mlsAvatar.lastReady; }, null);
    var total = cache && Array.isArray(cache.checkins) ? (Number(cache.total) || cache.checkins.length) : null;
    var activeId = activePtIdSafe();
    var activeHit = null;
    if (cache && activeId) {
      for (var i = 0; i < cache.checkins.length; i++) {
        if (clean(cache.checkins[i].patient_external_id) === activeId) { activeHit = cache.checkins[i]; break; }
      }
    }
    /* Same content -> no rebuild (buttons keep their done/disabled states). */
    var sig = (activeHit ? 'a' + activeHit.id : 'n') + '|' + total + '|' + activeId;
    if (card.getAttribute('data-mls-av-sig') === sig) return;
    card.setAttribute('data-mls-av-sig', sig);
    card.innerHTML = '';
    var head = make('div', '');
    head.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    var title = make('span', '', '🧑‍⚕️ Avatar');
    title.style.cssText = 'font-weight:800;color:#204034;font-size:13.5px';
    head.appendChild(title);
    var line = make('span', '', activeHit
      ? '✨ This patient completed their pre-visit check-in:'
      : (total == null ? 'Your AI check-in assistant — patients answer your questions before the visit.'
        : (total === 0 ? 'No completed check-ins waiting.' : (total + ' patient' + (total === 1 ? '' : 's') + ' finished their check-in.'))));
    line.style.cssText = 'font-size:12.5px;color:' + (activeHit ? '#2E6A4B;font-weight:700' : '#55605A');
    head.appendChild(line);
    head.appendChild(visitButton(activeHit ? 'All check-ins' : (total ? 'Open check-ins' : 'Open'), false, function () { open(); }));
    /* av-2.0.2: flag FIRST, then open — the old order consumed the flag
       before it was set (Set up landed on the Ready tab) and left it armed
       to hijack the doctor's NEXT open. */
    if (!activeHit) head.appendChild(visitButton('Set up', !total, function () { openSetupTab(); open(); }));
    card.appendChild(head);

    if (activeHit) {
      /* THE REVIEW UI: the doctor sees the patient's key points right here,
         no click required, and files them where they belong with one tap. */
      var full = null; /* full summary text arrives via the panel cache rows */
      if (Array.isArray(activeHit.bullets) && activeHit.bullets.length) {
        var ul = make('ul', 'mlsAvBullets');
        activeHit.bullets.forEach(function (bullet) {
          ul.appendChild(make('li', /^⚠/.test(String(bullet)) ? 'flag' : '', String(bullet)));
        });
        card.appendChild(ul);
      }
      var actions = make('div', 'mlsAvActions');
      actions.style.marginTop = '9px';
      var detail = { id: activeHit.id, patient_external_id: activeHit.patient_external_id, ready_at: activeHit.ready_at, summary: activeHit.summary || null };
      var needSummary = !detail.summary || activeHit.truncated === true;
      function withSummary(run, button) {
        if (!needSummary) { run(); return; }
        button.disabled = true; var was = button.textContent; button.textContent = 'Loading…';
        api('/api/avatar/checkins?status=ready').then(function (r) {
          button.disabled = false; button.textContent = was;
          var rows = (r.ok && r.json && Array.isArray(r.json.checkins)) ? r.json.checkins : [];
          for (var j = 0; j < rows.length; j++) if (rows[j].id === detail.id) { detail.summary = rows[j].summary; detail.ready_at = rows[j].ready_at; break; }
          if (detail.summary) { needSummary = false; run(); }
          else toast('Could not load the full summary — open All check-ins and use it from there.');
        }, function () { button.disabled = false; button.textContent = was; toast('Could not load the full summary — try again.'); });
      }
      actions.appendChild(visitButton('Add to visit transcript', true, function (b) {
        withSummary(function () { addToTranscript(detail, b); }, b);
      }));
      actions.appendChild(visitButton('Add to chart', false, function (b) {
        withSummary(function () { importSummary(detail, b); }, b);
      }));
      actions.appendChild(visitButton('Full summary', false, function (b) {
        withSummary(function () {
          if (full && full.parentNode) { full.parentNode.removeChild(full); full = null; b.textContent = 'Full summary'; return; }
          full = make('div', 'mlsAvSummary', String(detail.summary));
          card.appendChild(full); b.textContent = 'Hide summary';
        }, b);
      }));
      card.appendChild(actions);
    }
  }
  var pendingSetupTab = false;
  function openSetupTab() { pendingSetupTab = true; }

  /* ---- mount (event-driven, bounded retry ladder — no permanent polling) ---- */
  var retryTimers = [], lifecycleBound = [], visBound = false;
  function scheduleEnsure() {
    /* av-1.3.1: this module is idle-DEFERRED, so the app's ready events can
       fire BEFORE it loads — a fresh login landing on Visit then showed no
       card until the user switched views. The bounded ladder now mounts the
       Visit card too, and its last rung does the one boot count-refresh the
       missed events would have done. Still zero permanent polling. */
    [0, 160, 420, 900, 1800, 3200].forEach(function (delay, index, all) {
      retryTimers.push(setTimeout(function () {
        ensureButton();
        ensureVisitCard();
        if (index === all.length - 1) refreshCount(false);
      }, delay));
    });
  }
  function onLifecycle() { scheduleEnsure(); refreshCount(false); ensureVisitCard(); }
  function onVisibility() { if (!document.hidden) refreshCount(false); }
  function onVisitContext() { ensureVisitCard(); }
  function boot() {
    scheduleEnsure();
    ['mls:ui-ready', 'mls:topbar-ready', 'mls:header-rendered'].forEach(function (name) {
      safe(function () { window.addEventListener(name, onLifecycle, false); lifecycleBound.push([name, onLifecycle]); });
    });
    /* mls:easy-mode-changed: a staff→doctor mode flip remounts the Easy host
       WITHOUT a view change — without this event the card sinks below the
       workspace until the next unrelated event. */
    ['mls:view-changed', 'mls:active-patient-changed', 'mls:patient-changed', 'mls:easy-mode-changed'].forEach(function (name) {
      safe(function () { window.addEventListener(name, onVisitContext, false); lifecycleBound.push([name, onVisitContext]); });
    });
    if (!visBound) {
      safe(function () { document.addEventListener('visibilitychange', onVisibility, false); visBound = true; });
    }
  }
  function revert() {
    retryTimers.forEach(function (timer) { safe(function () { clearTimeout(timer); }); });
    retryTimers = [];
    lifecycleBound.forEach(function (row) { safe(function () { window.removeEventListener(row[0], row[1], false); }); });
    lifecycleBound = [];
    if (visBound) { safe(function () { document.removeEventListener('visibilitychange', onVisibility, false); }); visBound = false; }
    close();
    var button = gid(BUTTON_ID); if (button && button.parentNode) button.parentNode.removeChild(button);
    var visitCard = gid('mlsAvVisitCard'); if (visitCard && visitCard.parentNode) visitCard.parentNode.removeChild(visitCard);
    var styleNode = gid(STYLE_ID); if (styleNode && styleNode.parentNode) styleNode.parentNode.removeChild(styleNode);
    try { window.__mlsAvatar.installed = false; } catch (e) {}
  }

  window.__mlsAvatar = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    open: open,
    close: close,
    refreshCount: refreshCount,
    exactPatient: exactPatient,
    importSummary: importSummary,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})();
