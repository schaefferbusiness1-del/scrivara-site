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

  var VERSION = 'av-5.0.0';
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
  /* av-2.1.0: the PREVIEW speaks and listens exactly like the patient side —
     the doctor's first meeting with the avatar must BE the product, not a
     typed sketch of it. Recognition runs only while the preview is open and
     stops on every exit (panel close included) so it can never collide with
     the app's dictation. */
  var pvRec = null;
  /* av-4.0.0: the speak engine that CANNOT dead-end.
     Chrome garbage-collects utterances mid-sentence, so onend silently never
     fires and everything chained after speech (like opening the microphone)
     dies — the exact "it just sits there and makes me type" failure. Three
     defenses: (1) every utterance is HELD in a module array until it truly
     finishes; (2) a duration watchdog fires the continuation even if Chrome
     never does; (3) the continuation is once-only so double-fires are safe. */
  var pvHeld = [], pvSpeakSeq = 0, pvWatchdog = null, pvVoice;
  function pvPickVoice() {
    if (pvVoice !== undefined) return pvVoice;
    pvVoice = null;
    safe(function () {
      var synth = window.speechSynthesis; if (!synth || !isFn(synth.getVoices)) return;
      var voices = synth.getVoices() || [];
      if (!voices.length) { safe(function () { synth.addEventListener('voiceschanged', function () { pvVoice = undefined; }, { once: true }); }); return; }
      var prefer = ['Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Samantha'];
      for (var i = 0; i < prefer.length && !pvVoice; i++) {
        for (var j = 0; j < voices.length; j++) {
          if (voices[j].name && voices[j].name.indexOf(prefer[i]) >= 0) { pvVoice = voices[j]; break; }
        }
      }
      if (!pvVoice) for (var k = 0; k < voices.length; k++) if (/^en(-|_)/i.test(voices[k].lang || '')) { pvVoice = voices[k]; break; }
    });
    return pvVoice;
  }
  function pvStopVoice() {
    pvSpeakSeq++;
    if (pvWatchdog) { safe(function () { clearTimeout(pvWatchdog); }); pvWatchdog = null; }
    pvHeld.length = 0;
    if (ttsAudioNow) { safe(function () { ttsAudioNow.onended = null; ttsAudioNow.onerror = null; ttsAudioNow.pause(); }); ttsAudioNow = null; }
    faceTalkStop();
    safe(function () { if (window.speechSynthesis) window.speechSynthesis.cancel(); });
    if (pvRec) { safe(function () { pvRec.onresult = null; pvRec.onend = null; pvRec.onerror = null; pvRec.stop(); }); pvRec = null; }
  }
  /* pvSpeak: the NATURAL backend voice first (MP3 + real lip-sync), the
     browser's speechSynthesis only as fallback. The completion contract is
     identical either way: `then` fires exactly once — event, error, or
     watchdog — so the speak->listen chain can never strand. */
  function pvSpeak(text, then) { pvSpeakVoiced(text, then, null); }
  function pvSpeakVoiced(text, then, voiceOverride) {
    var mySeq = ++pvSpeakSeq;
    var finished = false;
    function finish() {
      if (finished || mySeq !== pvSpeakSeq) return;
      finished = true;
      if (pvWatchdog) { safe(function () { clearTimeout(pvWatchdog); }); pvWatchdog = null; }
      pvHeld.length = 0;
      faceTalkStop();
      if (then) safe(then);
    }
    var t = String(text == null ? '' : text);
    var started = false;
    /* fetch guard: even a hung TTS request may not strand the loop — and a
       LATE fetch result must never start a second voice over the fallback. */
    pvWatchdog = setTimeout(function () {
      if (mySeq !== pvSpeakSeq || started) return;
      started = true;
      pvSpeakSynth(t, mySeq, finish);
    }, 8000);
    ttsFetchUrl(t, voiceOverride).then(function (url) {
      if (mySeq !== pvSpeakSeq || finished || started) return;
      started = true;
      if (url) { ttsPlayUrl(url, mySeq, finish); return; }
      pvSpeakSynth(t, mySeq, finish);
    }, function () {
      if (mySeq !== pvSpeakSeq || finished || started) return;
      started = true;
      pvSpeakSynth(t, mySeq, finish);
    });
  }
  function pvSpeakSynth(text, mySeq, finish) {
    var synth = safe(function () { return window.speechSynthesis; }, null);
    if (mySeq !== pvSpeakSeq) return;
    if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') { finish(); return; }
    try {
      synth.cancel();
      var u = new window.SpeechSynthesisUtterance(String(text));
      u.rate = 0.98; u.pitch = 1.02;
      var voice = pvPickVoice(); if (voice) u.voice = voice;
      u.onend = finish;
      u.onerror = finish;
      pvHeld.push(u); /* defeat the GC */
      /* watchdog: ~160 wpm reading speed + 3s grace — speech that "never
         ends" still hands off to the next stage. */
      if (pvWatchdog) { safe(function () { clearTimeout(pvWatchdog); }); }
      var expectMs = Math.min(30000, Math.max(2500, String(text).split(/\s+/).length * 380 + 3000));
      pvWatchdog = setTimeout(finish, expectMs);
      faceTalkCycle(true);
      synth.speak(u);
    } catch (e) { finish(); }
  }
  function pvListen(onFinal, onInterim) {
    var C = safe(function () { return window.SpeechRecognition || window.webkitSpeechRecognition; }, null);
    if (!C) return false;
    pvStopVoice();
    var rec; try { rec = new C(); } catch (e) { return false; }
    pvRec = rec;
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
    var finalText = '', quiet = null;
    function submit() {
      var v = finalText.trim();
      if (pvRec === rec) { safe(function () { rec.stop(); }); pvRec = null; }
      if (v && onFinal) onFinal(v);
    }
    function armQuiet() { if (quiet) clearTimeout(quiet); quiet = setTimeout(function () { if (finalText.trim()) submit(); }, 2000); }
    rec.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var r = ev.results[i];
        if (r.isFinal) finalText += (finalText ? ' ' : '') + String(r[0].transcript || '').trim();
        else interim += String(r[0].transcript || '');
      }
      if (onInterim) onInterim((finalText + ' ' + interim).trim());
      armQuiet();
    };
    rec.onerror = function () { if (pvRec === rec) pvRec = null; };
    rec.onend = function () { if (pvRec === rec) { if (finalText.trim()) submit(); else pvRec = null; } };
    try { rec.start(); return true; } catch (e) { pvRec = null; return false; }
  }

  /* =========================================================================
     av-5.0.0 — THE LIVING FACE. A drawn character with features a patient can
     actually read: blinking eyes, a wandering gaze, expressive brows, and a
     mouth that moves WITH the audio (amplitude lip-sync on the natural voice;
     a natural cycle while browser speech runs). Tinted from the doctor's
     portrait when one is saved. No ids inside the SVG — every part is
     class-scoped, so the Setup preview and the kiosk can coexist. ========= */
  var FACE_LOOK = { skin: '#f0c8a0', hair: '#4e3b2a', shirt: '#2E6A4B', lip: '#a95f47' };
  var FACE_MOUTHS = {
    smile:   'M78 132 Q100 145 122 132 Q100 140 78 132',
    grin:    'M74 129 Q100 153 126 129 Q100 141 74 129',
    soft:    'M84 134 Q100 141 116 134 Q100 138 84 134',
    concern: 'M82 140 Q100 131 118 140 Q100 137 82 140',
    o:       'M91 132 Q100 126 109 132 Q109 146 100 147 Q91 146 91 132',
    open1:   'M86 131 Q100 137 114 131 Q100 149 86 131',
    open2:   'M83 129 Q100 136 117 129 Q100 158 83 129',
    open3:   'M79 127 Q100 134 121 127 Q100 167 79 127'
  };
  function faceSvg(look) {
    look = look || FACE_LOOK;
    function eye(cx, side) {
      return '<g class="fEye' + side + '" style="transform-box:fill-box;transform-origin:center;transition:transform .12s ease">' +
        '<ellipse cx="' + cx + '" cy="94" rx="11.5" ry="12.5" fill="#fff"/>' +
        '<g class="fPupil' + side + '" style="transition:transform .5s ease">' +
          '<circle cx="' + cx + '" cy="95" r="6.2" fill="#4a3423"/>' +
          '<circle cx="' + (cx + 2) + '" cy="92.6" r="2" fill="#fff"/>' +
        '</g></g>';
    }
    return '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" data-mood="idle" style="width:100%;height:100%;display:block">' +
      '<ellipse class="fShirt" cx="100" cy="206" rx="74" ry="50" fill="' + look.shirt + '"/>' +
      '<g class="fHead" style="transform-box:fill-box;transform-origin:50% 62%;transition:transform .45s ease">' +
        '<ellipse class="fSkin" cx="42" cy="100" rx="9" ry="13" fill="' + look.skin + '"/>' +
        '<ellipse class="fSkin" cx="158" cy="100" rx="9" ry="13" fill="' + look.skin + '"/>' +
        '<ellipse class="fSkin fFace" cx="100" cy="98" rx="58" ry="66" fill="' + look.skin + '"/>' +
        '<path class="fHair" d="M42 92 Q40 30 100 28 Q160 30 158 92 Q158 64 138 58 Q140 44 118 44 Q96 40 78 50 Q58 52 60 70 Q44 72 42 92 Z" fill="' + look.hair + '"/>' +
        '<circle class="fBlush" cx="63" cy="119" r="9" fill="#e07a5f" opacity=".16"/>' +
        '<circle class="fBlush" cx="137" cy="119" r="9" fill="#e07a5f" opacity=".16"/>' +
        '<g class="fBrowL" style="transform-box:fill-box;transform-origin:center;transition:transform .35s ease"><path d="M58 78 Q70 72 84 77" stroke="' + look.hair + '" stroke-width="5" stroke-linecap="round" fill="none"/></g>' +
        '<g class="fBrowR" style="transform-box:fill-box;transform-origin:center;transition:transform .35s ease"><path d="M116 77 Q130 72 142 78" stroke="' + look.hair + '" stroke-width="5" stroke-linecap="round" fill="none"/></g>' +
        eye(71, 'L') + eye(129, 'R') +
        '<path class="fNose" d="M100 101 Q104 110 98 114" stroke="rgba(0,0,0,.15)" stroke-width="3" stroke-linecap="round" fill="none"/>' +
        '<path class="fMouth" d="' + FACE_MOUTHS.smile + '" fill="' + look.lip + '"/>' +
      '</g></svg>';
  }
  function makeFace(mount, look) {
    if (!mount) return null;
    mount.innerHTML = faceSvg(look);
    var root = mount.querySelector('svg');
    if (!root) return null;
    function q(sel) { return root.querySelector(sel); }
    var head = q('.fHead'), browL = q('.fBrowL'), browR = q('.fBrowR'),
      eyeL = q('.fEyeL'), eyeR = q('.fEyeR'), pupL = q('.fPupilL'), pupR = q('.fPupilR'),
      mouth = q('.fMouth');
    var timers = [], dead = false, cycling = false;
    var moodNow = 'idle', caringNow = false, happyNow = false;
    var reduced = safe(function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }, false);
    function later(fn, ms) {
      var t = setTimeout(function () { var i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); if (!dead) safe(fn); }, ms);
      timers.push(t); return t;
    }
    function setMouth(shape) { if (mouth) mouth.setAttribute('d', FACE_MOUTHS[shape] || FACE_MOUTHS.smile); }
    function baseMouth() { return caringNow ? 'concern' : happyNow ? 'grin' : moodNow === 'listening' ? 'soft' : 'smile'; }
    function eyesBase() { return happyNow ? 'scaleY(.6)' : ''; }
    function blink() {
      if (dead) return;
      if (!reduced && eyeL && eyeR) {
        eyeL.style.transform = 'scaleY(.08)'; eyeR.style.transform = 'scaleY(.08)';
        later(function () { eyeL.style.transform = eyesBase(); eyeR.style.transform = eyesBase(); }, 130);
      }
      later(blink, 2600 + Math.random() * 3200);
    }
    function wander() {
      if (dead) return;
      if (!reduced && pupL && pupR && moodNow !== 'listening') {
        var dx = (Math.random() * 5 - 2.5).toFixed(1), dy = (Math.random() * 3 - 1.4).toFixed(1);
        pupL.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        pupR.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      } else if (pupL && pupR) { pupL.style.transform = ''; pupR.style.transform = ''; }
      later(wander, 1800 + Math.random() * 2600);
    }
    function mood(state, caring, happy) {
      moodNow = state || 'idle'; caringNow = !!caring; happyNow = !!happy && !caring;
      root.setAttribute('data-mood', moodNow + (caringNow ? ' caring' : '') + (happyNow ? ' happy' : ''));
      var bl = '', br = '';
      if (caringNow) { bl = 'translateY(-2.5px) rotate(7deg)'; br = 'translateY(-2.5px) rotate(-7deg)'; }
      else if (happyNow) { bl = br = 'translateY(-3.5px)'; }
      else if (moodNow === 'thinking') { bl = 'translateY(1.5px) rotate(-4deg)'; br = 'translateY(-2px) rotate(-4deg)'; }
      else if (moodNow === 'listening') { bl = br = 'translateY(-1.5px)'; }
      if (browL) browL.style.transform = bl;
      if (browR) browR.style.transform = br;
      if (head) head.style.transform = reduced ? '' :
        moodNow === 'listening' ? 'rotate(2.4deg) translateY(1px)' :
        moodNow === 'thinking' ? 'rotate(-1.6deg) translateY(-2px)' :
        caringNow ? 'rotate(1.2deg)' : '';
      if (eyeL && eyeR) { eyeL.style.transform = eyesBase(); eyeR.style.transform = eyesBase(); }
      if (!cycling) setMouth(baseMouth());
    }
    function talk(level) {
      /* level 0..1 = live amplitude from the natural voice; -1 = stop */
      if (dead || !mouth) return;
      if (level < 0) { setMouth(baseMouth()); return; }
      setMouth(level > 0.62 ? 'open3' : level > 0.34 ? 'open2' : level > 0.1 ? 'open1' : Math.random() < 0.2 ? 'o' : 'soft');
    }
    function talkCycle(on) {
      /* browser-speech fallback carries no amplitude — cycle naturally */
      cycling = !!on;
      if (!on) { setMouth(baseMouth()); return; }
      (function step() {
        if (!cycling || dead) return;
        setMouth(['open1', 'open2', 'soft', 'open3', 'o', 'open1'][Math.floor(Math.random() * 6)]);
        later(step, 95 + Math.random() * 70);
      })();
    }
    function retint(lk) {
      if (!lk) return;
      Array.prototype.forEach.call(root.querySelectorAll('.fSkin'), function (n) { n.setAttribute('fill', lk.skin); });
      var hair = root.querySelector('.fHair'); if (hair) hair.setAttribute('fill', lk.hair);
      Array.prototype.forEach.call(root.querySelectorAll('.fBrowL path,.fBrowR path'), function (n) { n.setAttribute('stroke', lk.hair); });
    }
    function destroy() {
      dead = true; cycling = false;
      timers.forEach(function (t) { safe(function () { clearTimeout(t); }); });
      timers.length = 0;
    }
    mood('idle');
    blink(); wander();
    return { mood: mood, talk: talk, talkCycle: talkCycle, retint: retint, destroy: destroy, node: root };
  }
  function faceTintFromPortrait(dataUrl, then) {
    /* "based off the doctor's look": sample the saved portrait for hair and
       skin and paint the character with them. Fails safe to the defaults. */
    if (!dataUrl || String(dataUrl).indexOf('data:image/') !== 0) { then(null); return; }
    var img = new Image();
    img.onload = function () {
      then(safe(function () {
        var c = document.createElement('canvas'); c.width = 24; c.height = 24;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
        var d = x.getImageData(0, 0, 24, 24).data;
        function avg(x0, y0, x1, y1) {
          var r = 0, g = 0, b = 0, n = 0;
          for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++) { var i = (yy * 24 + xx) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
          return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
        }
        function hex(c3) { return '#' + c3.map(function (v) { return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2); }).join(''); }
        var hair = avg(6, 0, 18, 5), skin = avg(8, 11, 16, 19);
        var skinLum = (skin[0] * 3 + skin[1] * 4 + skin[2]) / 8, hairLum = (hair[0] * 3 + hair[1] * 4 + hair[2]) / 8;
        /* a usable sample: skin brighter than hair and not shadow-dark */
        if (skinLum < 70 || skinLum <= hairLum + 8) return null;
        return { skin: hex(skin), hair: hex(hair), shirt: FACE_LOOK.shirt, lip: FACE_LOOK.lip };
      }, null));
    };
    img.onerror = function () { then(null); };
    img.src = dataUrl;
  }
  function faceTalkStop() {
    if (ttsRaf) { safe(function () { cancelAnimationFrame(ttsRaf); }); ttsRaf = 0; }
    safe(function () { if (kiosk.face) { kiosk.face.talkCycle(false); kiosk.face.talk(-1); } });
  }
  function faceTalkCycle(on) { safe(function () { if (kiosk.face) kiosk.face.talkCycle(on); }); }

  /* ---- NATURAL SPEECH: the backend voice first, the browser as fallback.
     MP3 from /api/avatar/office/tts (clinician-authed), cached per text so
     "Hear that again" is instant, with a short circuit-breaker so an outage
     degrades to browser speech instead of stalling every question. ---- */
  var ttsCache = {}, ttsOrder = [], ttsDownUntil = 0, ttsAudioNow = null, ttsCtx = null, ttsRaf = 0;
  function ttsEnsureCtx() {
    if (ttsCtx) { safe(function () { if (ttsCtx.state === 'suspended') ttsCtx.resume(); }); return; }
    ttsCtx = safe(function () { var C = window.AudioContext || window.webkitAudioContext; return C ? new C() : null; }, null);
  }
  function ttsFetchUrl(text, voice) {
    var key = (voice || '') + '|' + text;
    if (ttsCache[key]) return Promise.resolve(ttsCache[key]);
    if (Date.now() < ttsDownUntil) return Promise.resolve(null);
    var ctrl = safe(function () { return new AbortController(); }, null);
    var timer = ctrl ? setTimeout(function () { safe(function () { ctrl.abort(); }); }, 6500) : null;
    var headers = { 'Content-Type': 'application/json' };
    var auth = token(); if (auth) headers.Authorization = 'Bearer ' + auth;
    return fetch(apiBase() + '/api/avatar/office/tts', {
      method: 'POST', headers: headers,
      body: JSON.stringify(voice ? { text: text, voice: voice } : { text: text }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok || String(r.headers.get('content-type') || '').indexOf('audio') !== 0) {
        ttsDownUntil = Date.now() + 120000;
        return null;
      }
      return r.blob().then(function (b) {
        var url = URL.createObjectURL(b);
        ttsCache[key] = url; ttsOrder.push(key);
        while (ttsOrder.length > 24) {
          (function (old) { safe(function () { URL.revokeObjectURL(ttsCache[old]); }); delete ttsCache[old]; })(ttsOrder.shift());
        }
        return url;
      });
    }).catch(function () {
      if (timer) clearTimeout(timer);
      ttsDownUntil = Date.now() + 120000;
      return null;
    });
  }
  function ttsPlayUrl(url, mySeq, finish) {
    var a = new Audio(url);
    ttsAudioNow = a;
    a.onended = finish; a.onerror = finish;
    a.onloadedmetadata = function () {
      if (mySeq !== pvSpeakSeq) return;
      if (pvWatchdog) { safe(function () { clearTimeout(pvWatchdog); }); }
      pvWatchdog = setTimeout(finish, Math.min(45000, Math.max(2500, (a.duration || 12) * 1000 + 2500)));
    };
    /* amplitude lip-sync when the AudioContext is willing; otherwise cycle */
    var wired = safe(function () {
      if (!ttsCtx || ttsCtx.state !== 'running' || !kiosk.face) return false;
      var src = ttsCtx.createMediaElementSource(a);
      var an = ttsCtx.createAnalyser(); an.fftSize = 256;
      src.connect(an); an.connect(ttsCtx.destination);
      var buf = new Uint8Array(an.frequencyBinCount);
      var lastAt = 0;
      (function amp(now) {
        if (mySeq !== pvSpeakSeq || a.ended) { faceTalkStop(); return; }
        ttsRaf = requestAnimationFrame(amp);
        if (now - lastAt < 70) return;
        lastAt = now;
        an.getByteFrequencyData(buf);
        var sum = 0; for (var i = 2; i < 40; i++) sum += buf[i];
        kiosk.face.talk(Math.min(1, (sum / 38) / 150));
      })(0);
      return true;
    }, false);
    if (!wired) faceTalkCycle(true);
    var p = safe(function () { return a.play(); }, null);
    if (p && p.catch) p.catch(function () { finish(); });
  }

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
    } else wrap.innerHTML = faceSvg(null); /* the drawn character, never a bare emoji */
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

      /* av-5.0.0: the NATURAL voice — server-whitelisted names, previewable
         right here with one tap (spoken by the same engine the kiosk uses). */
      var voiceLabel = make('label', '', 'Voice — the natural voice patients hear in the office');
      var voiceRow = make('div', '');
      voiceRow.style.cssText = 'display:flex;gap:8px;align-items:center';
      var voiceSelect = document.createElement('select');
      voiceSelect.id = 'mlsAvVoicePick';
      voiceSelect.style.cssText = toneSelect.style.cssText; voiceSelect.style.flex = '1'; voiceSelect.style.width = 'auto';
      [['coral', 'Coral — warm & caring (default)'], ['nova', 'Nova — bright & upbeat'], ['shimmer', 'Shimmer — soft & gentle'], ['sage', 'Sage — calm & steady'], ['ash', 'Ash — deep & reassuring'], ['echo', 'Echo — clear & even'], ['alloy', 'Alloy — balanced'], ['onyx', 'Onyx — rich & low']].forEach(function (opt) {
        var o = document.createElement('option'); o.value = opt[0]; o.textContent = opt[1];
        if ((cfg.voice || 'coral') === opt[0]) o.selected = true;
        voiceSelect.appendChild(o);
      });
      var voiceTry = make('button', 'mlsAvAction', '▶ Hear this voice');
      voiceTry.type = 'button';
      voiceTry.addEventListener('click', function () {
        pvStopVoice();
        pvSpeakVoiced('Hi, I\'m ' + (nameInput.value.trim() || 'Ava') + '. It\'s lovely to meet you — this only takes a few minutes.', null, voiceSelect.value);
      });
      voiceRow.appendChild(voiceSelect); voiceRow.appendChild(voiceTry);

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
          voice: voiceSelect.value,
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
        /* av-2.1.0: the preview TALKS like the real thing — spoken question,
           then listening; a spoken answer fills the box and advances. */
        function speakAndListen(text) {
          pvSpeak(text, function () {
            pvListen(function (finalText) { inp.value = finalText; advance(); },
              function (interim) { inp.value = interim; });
          });
        }
        var greeting = 'Hi, I\'m ' + avName + '. ' + (introInput.value.trim() ? introInput.value.trim() + ' ' : '') + 'This takes just a few minutes. ' + questions[0];
        sayLine(avName, greeting);
        speakAndListen(greeting);
        var row = make('div', ''); row.style.cssText = 'display:flex;gap:8px;margin-top:6px';
        var inp = make('input'); inp.placeholder = 'Type a sample answer…'; inp.style.cssText = 'flex:1;border:1px solid #d7ded9;border-radius:10px;padding:8px 10px;font:13px system-ui';
        var send = make('button', 'mlsAvAction', 'Send'); send.type = 'button';
        function advance() {
          var v = inp.value.trim(); if (!v) return;
          pvStopVoice();
          sayLine('You', v); inp.value = '';
          idx++;
          if (idx < questions.length) { var nextQ = 'Thanks. ' + questions[idx]; sayLine(avName, nextQ); speakAndListen(nextQ); }
          else {
            var doneMsg = 'That covers everything — thank you! Your answers are on their way to your care team.';
            sayLine(avName, doneMsg);
            pvSpeak(doneMsg, null);
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
      form.appendChild(voiceLabel); form.appendChild(voiceRow);
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

  /* =========================================================================
     av-3.0.0 — THE OFFICE INTERVIEW (kiosk): the patient walks in, the doctor
     taps Start, and the WHOLE SCREEN becomes the avatar — the doctor-faced
     portrait with living emotion states, huge spoken questions, big-button
     voice answering. Clinician-authenticated (/api/avatar/office/turn), filed
     to the ACTIVE patient's chart, lands in the same inbox/Visit-card/import
     pipeline. The app is fully hidden behind an opaque overlay while a
     patient is looking at the screen.
     Emotions: motion + color + a mood badge over the portrait — happy on
     greeting/thanks, attentive while listening, thinking while the AI works,
     caring when the patient's words sound like pain/distress. Reduced-motion
     kills all of it. ========================================================= */
  var kiosk = { open: false, sid: null, ext: null, busy: false, lastSay: '', lastTry: null };
  function kioskNonce() {
    var v = 'an-', A = 'abcdefghjkmnpqrstuvwxyz23456789';
    for (var i = 0; i < 16; i++) v += A[Math.floor(Math.random() * A.length)];
    return v;
  }
  function kioskStyle() {
    if (gid('mlsAvKioskStyle')) return;
    var st = document.createElement('style'); st.id = 'mlsAvKioskStyle';
    st.textContent =
      '#mlsAvKiosk{position:fixed;inset:0;z-index:2147483200;background:linear-gradient(165deg,#F7F5EE,#E9F0EA 55%,#DEE9E1);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.6vh;font-family:\'Public Sans\',system-ui,sans-serif;padding:4vh 5vw;text-align:center}' +
      '#mlsAvKioskEnd{position:absolute;top:14px;right:16px;border:1px solid #cfd9d2;background:#fff;color:#55605A;border-radius:999px;padding:8px 14px;font:600 12.5px system-ui;cursor:pointer;opacity:.75}' +
      '#mlsAvKiosk.speaking{background:linear-gradient(165deg,#F5F7EE,#E4F0E6 55%,#D6E8DC)}' +
      '#mlsAvKiosk.listening{background:linear-gradient(165deg,#F0F4F8,#E2EBF4 55%,#D6E2F0)}' +
      '#mlsAvKioskWave{display:flex;gap:7px;align-items:center;height:4.4vh;min-height:30px;visibility:hidden}' +
      '#mlsAvKiosk.speaking #mlsAvKioskWave{visibility:visible}' +
      '#mlsAvKioskWave span{width:8px;border-radius:999px;background:#2E6A4B;height:22%;animation:mlsAvKWave 1s ease-in-out infinite}' +
      '#mlsAvKioskWave span:nth-child(2){animation-delay:.12s}#mlsAvKioskWave span:nth-child(3){animation-delay:.24s}#mlsAvKioskWave span:nth-child(4){animation-delay:.36s}#mlsAvKioskWave span:nth-child(5){animation-delay:.48s}' +
      '@keyframes mlsAvKWave{0%,100%{height:22%}50%{height:100%}}' +
      '#mlsAvKioskMic{display:none;align-items:center;gap:10px;font:700 2.1vh system-ui;color:#26417a;background:#fff;border-radius:999px;padding:1.2vh 2.4vh;box-shadow:0 6px 22px rgba(38,65,122,.18)}' +
      '#mlsAvKiosk.listening #mlsAvKioskMic{display:inline-flex}' +
      '#mlsAvKioskMic i{width:1.6vh;height:1.6vh;min-width:12px;min-height:12px;border-radius:999px;background:#c0392b;animation:mlsAvKRing 1.4s ease-in-out infinite}' +
      '#mlsAvKioskFaceWrap{position:relative;width:min(40vh,420px);height:min(40vh,420px)}' +
      '#mlsAvKioskFace{width:100%;height:100%;border-radius:999px;overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center;font-size:12vh;border:5px solid #fff;box-shadow:0 18px 60px rgba(32,64,52,.22);transition:box-shadow .5s ease}' +
      '#mlsAvKioskFace{background:radial-gradient(circle at 50% 38%,#ffffff,#f2f4ef)}' +
      '#mlsAvKioskFaceWrap::after{content:"";position:absolute;inset:-14px;border-radius:999px;border:3px solid transparent;transition:border-color .4s ease}' +
      '#mlsAvKiosk.speaking #mlsAvKioskFace{animation:mlsAvKSpeak 1s ease-in-out infinite}' +
      '#mlsAvKiosk.speaking #mlsAvKioskFaceWrap::after{border-color:rgba(46,106,75,.55);animation:mlsAvKRing 1.6s ease-in-out infinite}' +
      '#mlsAvKiosk.listening #mlsAvKioskFaceWrap::after{border-color:rgba(38,99,168,.55);animation:mlsAvKRing 2.2s ease-in-out infinite}' +
      '#mlsAvKiosk.listening #mlsAvKioskFace{animation:mlsAvKLean 3.4s ease-in-out infinite}' +
      '#mlsAvKiosk.thinking #mlsAvKioskFace{animation:mlsAvKThink 2.2s ease-in-out infinite}' +
      '#mlsAvKiosk.caring #mlsAvKioskFace{box-shadow:0 18px 60px rgba(168,99,60,.3)}' +
      '#mlsAvKioskName{font:800 3vh \'Newsreader\',Georgia,serif;color:#204034;margin-top:-.6vh}' +
      '#mlsAvKioskSay{font:600 3.4vh/1.35 \'Public Sans\',system-ui;color:#1A211C;max-width:900px;min-height:9vh}' +
      '#mlsAvKioskInterim{font:500 2.4vh/1.4 system-ui;color:#55605A;max-width:820px;min-height:3.4vh}' +
      '#mlsAvKioskProgress{font:700 1.9vh system-ui;color:#69736d;letter-spacing:.4px}' +
      '#mlsAvKioskActions{display:flex;gap:14px;flex-wrap:wrap;justify-content:center}' +
      '#mlsAvKioskActions button{border:0;border-radius:999px;padding:2.1vh 3.6vh;font:700 2.3vh system-ui;cursor:pointer;min-height:56px}' +
      '#mlsAvKioskDone{background:#2E6A4B;color:#fff;box-shadow:0 8px 26px rgba(46,106,75,.35)}' +
      '#mlsAvKioskRepeat{background:#fff;color:#204034;border:1px solid #cfd9d2!important}' +
      '#mlsAvKioskType{background:transparent!important;color:#8b958e;text-decoration:underline;font-weight:500!important;font-size:1.7vh!important;padding:1vh!important;min-height:0!important}' +
      '#mlsAvKioskTypeRow{display:none;gap:10px;width:min(720px,90vw)}' +
      '#mlsAvKioskTypeRow textarea{flex:1;border:1px solid #cfd9d2;border-radius:16px;padding:14px;font:2.2vh system-ui;resize:none}' +
      '#mlsAvKioskTypeRow button{border:0;border-radius:999px;padding:0 26px;background:#204034;color:#fff;font:700 2.1vh system-ui;cursor:pointer}' +
      '@keyframes mlsAvKSpeak{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}' +
      '@keyframes mlsAvKLean{0%,100%{transform:rotate(0deg)}50%{transform:rotate(1.6deg)}}' +
      '@keyframes mlsAvKThink{0%,100%{transform:translateY(0)}50%{transform:translateY(-1vh)}}' +
      '@keyframes mlsAvKRing{0%,100%{opacity:.45}50%{opacity:1}}' +
      '@media (prefers-reduced-motion: reduce){#mlsAvKiosk *,#mlsAvKiosk.speaking #mlsAvKioskFace,#mlsAvKiosk.listening #mlsAvKioskFace,#mlsAvKiosk.thinking #mlsAvKioskFace{animation:none!important}}';
    (document.head || document.documentElement).appendChild(st);
  }
  function kioskMood(state, say, answer) {
    var root = gid('mlsAvKiosk'); if (!root) return;
    ['speaking', 'listening', 'thinking', 'caring', 'happy'].forEach(function (c) { root.classList.remove(c); });
    var caring = /pain|hurt|worse|can't|cannot|scared|worried|sad|tired|sick/i.test(String(answer || '') + ' ' + String(say || ''));
    var happy = /thank|welcome|great|covers everything|hi[!,. ]|hello/i.test(String(say || ''));
    if (state === 'speaking') { root.classList.add('speaking'); if (caring) root.classList.add('caring'); else if (happy) root.classList.add('happy'); }
    else if (state === 'listening') { root.classList.add('listening'); if (caring) root.classList.add('caring'); }
    else if (state === 'thinking') root.classList.add('thinking');
    /* the FACE carries the emotion now: brows, eyes, mouth, head tilt */
    if (kiosk.face) kiosk.face.mood(state, caring, happy);
  }
  function kioskClose(reason) {
    pvStopVoice();
    if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
    kiosk.open = false; kiosk.busy = false;
    if (kiosk.face) { safe(function () { kiosk.face.destroy(); }); kiosk.face = null; }
    safe(function () { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {}); });
    var node = gid('mlsAvKiosk'); if (node && node.parentNode) node.parentNode.removeChild(node);
    if (reason === 'done') {
      refreshCount(true);
      safe(function () { if (isFn(window.toast)) window.toast('Check-in complete — the highlights are on the Visit page.', 'ok'); });
    }
  }
  function kioskSetSay(text) { var el = gid('mlsAvKioskSay'); if (el) el.textContent = String(text || ''); }
  function kioskTurn(answer, nonce) {
    if (!kiosk.open || kiosk.busy) return;
    kiosk.busy = true;
    if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
    pvStopVoice();
    kioskMood('thinking', '', answer);
    var iv = gid('mlsAvKioskInterim'); if (iv) iv.textContent = '';
    var body = { clientSessionId: kiosk.sid, patientExternalId: kiosk.ext };
    if (answer) { body.answer = answer; body.answerNonce = nonce || kioskNonce(); }
    api('/api/avatar/office/turn', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
      kiosk.busy = false;
      if (!kiosk.open) return;
      var j = r.json || {};
      if (j.ok === false) {
        kioskSetSay(j.message || 'Something went wrong — the doctor will be right with you.');
        kioskMood('speaking', j.message || '');
        pvSpeak(j.message || 'Something went wrong.', null);
        return;
      }
      kiosk.lastTry = null; kiosk.lastSay = String(j.say || '');
      if (j.avatar) kioskSetIdentity(j.avatar);
      kioskSetSay(kiosk.lastSay);
      var pg = gid('mlsAvKioskProgress');
      if (pg && j.progress && j.progress.total) pg.textContent = j.done ? '' : ('Question ' + Math.min(j.progress.covered || 1, j.progress.total) + ' of ' + j.progress.total);
      if (j.done) {
        kioskMood('speaking', kiosk.lastSay);
        pvSpeak(kiosk.lastSay, function () { kioskClose('done'); });
        setTimeout(function () { if (kiosk.open) kioskClose('done'); }, 12000);
      } else {
        kioskMood('speaking', kiosk.lastSay, answer);
        pvSpeak(kiosk.lastSay, function () { kioskListen(); });
      }
    }, function () {
      kiosk.busy = false;
      if (!kiosk.open) return;
      kioskSetSay('The connection hiccuped — your last answer is safe to say again.');
      if (answer) kiosk.lastTry = { answer: answer, nonce: nonce };
      kioskListen();
    });
  }
  function kioskListen() {
    if (!kiosk.open || kiosk.busy) return;
    if (kiosk.mic === false) {
      var typeRow = gid('mlsAvKioskTypeRow'); if (typeRow) typeRow.style.display = 'flex';
      var input = gid('mlsAvKioskInput'); if (input) safe(function () { input.focus(); });
      return;
    }
    kioskMood('listening', kiosk.lastSay);
    var heardAnything = false;
    var started = pvListen(function (finalText) {
      if (!kiosk.open) return;
      if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
      var reuse = kiosk.lastTry && kiosk.lastTry.answer === finalText ? kiosk.lastTry.nonce : kioskNonce();
      kiosk.lastTry = { answer: finalText, nonce: reuse };
      kioskTurn(finalText, reuse);
    }, function (interim) {
      heardAnything = heardAnything || !!interim.trim();
      var iv = gid('mlsAvKioskInterim'); if (iv) iv.textContent = interim;
    });
    if (!started) {
      kiosk.mic = false;
      var row = gid('mlsAvKioskTypeRow'); if (row) row.style.display = 'flex';
      var iv = gid('mlsAvKioskInterim'); if (iv) iv.textContent = 'The microphone is not available here — typing works below.';
      return;
    }
    /* HANDS-FREE SAFETY NET: silence gets ONE warm nudge per question, and a
       hard stall (recognition alive but nothing ever heard) re-opens the mic
       — this loop can never quietly die into a frozen screen. */
    if (kiosk.nudgeTimer) safe(function () { clearTimeout(kiosk.nudgeTimer); });
    kiosk.nudgeTimer = setTimeout(function () {
      if (!kiosk.open || kiosk.busy || heardAnything) return;
      if (kiosk.nudgedFor !== kiosk.lastSay) {
        kiosk.nudgedFor = kiosk.lastSay;
        pvStopVoice();
        kioskMood('speaking', '');
        pvSpeak('Take your time — whenever you\'re ready, just start talking.', function () { kioskListen(); });
      } else {
        pvStopVoice();
        kioskListen();
      }
    }, 9000);
  }
  function kioskMicPreflight(then) {
    /* Ask for the microphone ONCE, up front, while the DOCTOR still holds the
       screen — never mid-interview in front of the patient. */
    var media = safe(function () { return navigator.mediaDevices && navigator.mediaDevices.getUserMedia({ audio: true }); }, null);
    if (!media) { kiosk.mic = false; then(); return; }
    media.then(function (stream) {
      safe(function () { stream.getTracks().forEach(function (t) { t.stop(); }); });
      kiosk.mic = true; then();
    }, function () {
      kiosk.mic = false;
      var iv = gid('mlsAvKioskInterim'); if (iv) iv.textContent = 'Microphone is off — the interview will use typing.';
      var row = gid('mlsAvKioskTypeRow'); if (row) row.style.display = 'flex';
      then();
    });
  }
  function kioskSetIdentity(av) {
    var name = gid('mlsAvKioskName');
    if (name && av && av.name) name.textContent = av.name;
    /* the portrait no longer REPLACES the face — it tints the drawn character
       (hair + skin sampled from the doctor's photo) so expressions survive */
    if (av && typeof av.faceImage === 'string' && av.faceImage.indexOf('data:image/') === 0 && !kiosk.tinted) {
      kiosk.tinted = true;
      faceTintFromPortrait(av.faceImage, function (look) {
        if (look && kiosk.face) { kiosk.look = look; kiosk.face.retint(look); }
      });
    }
  }
  function openKiosk() {
    var activeId = activePtIdSafe();
    if (!activeId) { toast('Open the patient first — the interview files to their chart.'); return; }
    if (kiosk.open) return;
    kioskStyle(); style();
    kiosk.open = true; kiosk.busy = false; kiosk.lastTry = null; kiosk.tinted = false;
    kiosk.ext = activeId;
    kiosk.sid = 'office-' + Date.now().toString(36) + '-' + kioskNonce().slice(3);
    var root = document.createElement('div'); root.id = 'mlsAvKiosk';
    root.innerHTML =
      '<button type="button" id="mlsAvKioskEnd">End interview</button>' +
      '<div id="mlsAvKioskFaceWrap"><div id="mlsAvKioskFace"></div></div>' +
      '<div id="mlsAvKioskWave"><span></span><span></span><span></span><span></span><span></span></div>' +
      '<div id="mlsAvKioskName">One moment…</div>' +
      '<div id="mlsAvKioskSay">Getting ready…</div>' +
      '<div id="mlsAvKioskMic"><i></i>Listening — just talk, I\'ll know when you\'re finished</div>' +
      '<div id="mlsAvKioskInterim"></div>' +
      '<div id="mlsAvKioskProgress"></div>' +
      '<div id="mlsAvKioskActions">' +
        '<button type="button" id="mlsAvKioskDone">✓ That\'s my answer</button>' +
        '<button type="button" id="mlsAvKioskRepeat">🔁 Hear that again</button>' +
        '<button type="button" id="mlsAvKioskType">Prefer typing?</button>' +
      '</div>' +
      '<div id="mlsAvKioskTypeRow"><textarea rows="2" id="mlsAvKioskInput" placeholder="Type your answer…"></textarea><button type="button" id="mlsAvKioskSend">Send</button></div>';
    (document.body || document.documentElement).appendChild(root);
    root.querySelector('#mlsAvKioskEnd').addEventListener('click', function () { kioskClose('ended'); });
    root.querySelector('#mlsAvKioskDone').addEventListener('click', function () { if (pvRec) { safe(function () { pvRec.stop(); }); } else kioskListen(); });
    root.querySelector('#mlsAvKioskRepeat').addEventListener('click', function () { if (kiosk.lastSay) { pvStopVoice(); kioskMood('speaking', kiosk.lastSay); pvSpeak(kiosk.lastSay, function () { kioskListen(); }); } });
    root.querySelector('#mlsAvKioskType').addEventListener('click', function () { var row = gid('mlsAvKioskTypeRow'); if (row) row.style.display = row.style.display === 'flex' ? 'none' : 'flex'; });
    function kioskTypedSubmit() {
      var input = gid('mlsAvKioskInput'); var value = input ? input.value.trim() : '';
      if (!value || kiosk.busy) return;
      pvStopVoice();
      if (input) input.value = '';
      var reuse = kiosk.lastTry && kiosk.lastTry.answer === value ? kiosk.lastTry.nonce : kioskNonce();
      kiosk.lastTry = { answer: value, nonce: reuse };
      kioskTurn(value, reuse);
    }
    root.querySelector('#mlsAvKioskSend').addEventListener('click', kioskTypedSubmit);
    root.querySelector('#mlsAvKioskInput').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); kioskTypedSubmit(); } });
    /* the LIVING face */
    kiosk.face = makeFace(gid('mlsAvKioskFace'), kiosk.look || null);
    /* TRUE fullscreen + the audio engine, both on the doctor's click (the
       one user gesture Chrome honours for either) */
    safe(function () {
      var el = document.documentElement;
      if (el.requestFullscreen) { var p = el.requestFullscreen({ navigationUI: 'hide' }); if (p && p.catch) p.catch(function () {}); }
    });
    ttsEnsureCtx();
    /* mic permission FIRST (the doctor's click is the gesture, the doctor
       still holds the screen), then the conversation begins. */
    kioskMicPreflight(function () { kioskTurn(null, null); });
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
    /* av-3.0.0: the headline action — the patient is in the room, start the
       interview on THIS screen for THIS patient. */
    if (!activeHit && activeId) head.appendChild(visitButton('🎙 Start check-in interview', true, function () { openKiosk(); }));
    head.appendChild(visitButton(activeHit ? 'All check-ins' : (total ? 'Open check-ins' : 'Open'), false, function () { open(); }));
    /* av-2.0.2: flag FIRST, then open — the old order consumed the flag
       before it was set (Set up landed on the Ready tab) and left it armed
       to hijack the doctor's NEXT open. */
    if (!activeHit) head.appendChild(visitButton('Set up', false, function () { openSetupTab(); open(); }));
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
    kioskClose('ended');
    var kioskStyleNode = gid('mlsAvKioskStyle'); if (kioskStyleNode && kioskStyleNode.parentNode) kioskStyleNode.parentNode.removeChild(kioskStyleNode);
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
    openKiosk: openKiosk,
    closeKiosk: function () { kioskClose('ended'); },
    refreshCount: refreshCount,
    exactPatient: exactPatient,
    importSummary: importSummary,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})();
