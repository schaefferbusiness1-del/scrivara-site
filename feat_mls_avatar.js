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

  var VERSION = 'av-5.6.7';
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
  function pvStopSpeechOnly() {
    pvSpeakSeq++;
    pvSaying = '';
    if (pvWatchdog) { safe(function () { clearTimeout(pvWatchdog); }); pvWatchdog = null; }
    pvHeld.length = 0;
    if (ttsAudioNow) { safe(function () { ttsAudioNow.onended = null; ttsAudioNow.onerror = null; ttsAudioNow.pause(); }); ttsAudioNow = null; }
    faceTalkStop();
    safe(function () { if (window.speechSynthesis) window.speechSynthesis.cancel(); });
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
  /* the sentence currently leaving the speaker, normalised - any recognition
     result that is merely a piece of THIS is the avatar hearing itself. */
  var pvSaying = '';
  function pvNorm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function pvIsSelfEcho(heard) {
    var h = pvNorm(heard);
    if (!h || !pvSaying) return false;
    if (pvSaying.indexOf(h) >= 0) return true;            /* a slice of our own sentence */
    var words = h.split(' ').filter(Boolean);
    if (words.length < 2) return false;
    var hits = 0;
    for (var i = 0; i < words.length; i++) if (pvSaying.indexOf(words[i]) >= 0) hits++;
    return (hits / words.length) > 0.8;                   /* mostly our words */
  }
  function pvSpeakVoiced(text, then, voiceOverride) {
    /* AMBIENT ROOM MODE IS SILENT: a scribe in the room does not talk.
       Enforced HERE, at the ONE place any voice can start, rather than by
       disarming a list of call sites - a list is a denylist, and the next
       call site added would not be on it. The continuation still runs, so
       no caller can strand waiting for a sentence that never plays. */
    if (kiosk && kiosk.ambient) { if (then) safe(then); return; }
    var mySeq = ++pvSpeakSeq;
    var finished = false;
    function finish() {
      if (finished || mySeq !== pvSpeakSeq) return;
      finished = true;
      pvSaying = '';
      if (pvWatchdog) { safe(function () { clearTimeout(pvWatchdog); }); pvWatchdog = null; }
      pvHeld.length = 0;
      faceTalkStop();
      if (then) safe(then);
    }
    var t = String(text == null ? '' : text);
    pvSaying = pvNorm(t);
    /* nothing to say: hand straight off. Speaking '' used to POST an empty
       body to the TTS proxy, take its 400, and trip the 2-minute circuit
       breaker — one blank turn downgraded the voice for the whole visit. */
    if (!t.trim()) { finish(); return; }
    var started = false;
    /* fetch guard: even a hung TTS request may not strand the loop — and a
       LATE fetch result must never start a second voice over the fallback. */
    pvWatchdog = setTimeout(function () {
      if (mySeq !== pvSpeakSeq || started) return;
      started = true;
      pvSpeakSynth(t, mySeq, finish);
    }, 5000);
    /* av-5.6.4 — STREAMED IN TWO PIECES. Time-to-first-word used to be the
       generation time of the WHOLE reply, because the audio was fetched as one
       blob and only then played. A reply is almost always a short
       acknowledgement plus a question ("Got it. How long has it been going
       on?"), so the first clause is generated far faster than the whole line.
       Both pieces are requested in PARALLEL and played in order: the patient
       hears the first words while the second half is still being made.

       Two pieces, not five — more requests would add round trips for no gain
       and risk an audible seam inside the question itself. Every failure path
       lands exactly where it landed before: if the first piece fails nothing
       has played yet, so the WHOLE line falls back to browser speech, which is
       the pre-existing behaviour. */
    var chunks = ttsSplitForSpeech(t);
    if (chunks.length === 2 && Date.now() >= ttsDownUntil) {
      var second = ttsFetchUrl(chunks[1], voiceOverride);   /* started FIRST so it overlaps the first piece */
      ttsFetchUrl(chunks[0], voiceOverride).then(function (u1) {
        if (mySeq !== pvSpeakSeq || finished || started) return;
        started = true;
        if (!u1) { pvSpeakSynth(t, mySeq, finish); return; }   /* nothing played yet — the old path, whole line */
        ttsPlayUrl(u1, mySeq, function () {
          if (mySeq !== pvSpeakSeq || finished) return;
          second.then(function (u2) {
            if (mySeq !== pvSpeakSeq || finished) return;
            if (u2) ttsPlayUrl(u2, mySeq, finish); else pvSpeakSynth(chunks[1], mySeq, finish);
          }, function () {
            if (mySeq !== pvSpeakSeq || finished) return;
            pvSpeakSynth(chunks[1], mySeq, finish);
          });
        });
      }, function () {
        if (mySeq !== pvSpeakSeq || finished || started) return;
        started = true;
        pvSpeakSynth(t, mySeq, finish);
      });
      return;
    }
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
  /* onDead fires when the recogniser TERMINATES on its own with nothing to
     submit (Chrome's speech service is network-backed: a `network`/`no-speech`
     error is ordinary). Without it the caller cannot tell "still listening"
     from "microphone is dead", and a kiosk that guesses wrong freezes with the
     listening halo still animating. Our own teardown never fires it:
     pvStopVoice nulls the handlers before stop(), and submit() nulls pvRec
     before onFinal. */
  function pvListen(onFinal, onInterim, onDead) {
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
    /* av-5.2.0: 1.3s of quiet after real speech submits — snappier turns */
    function armQuiet() { if (quiet) clearTimeout(quiet); quiet = setTimeout(function () { if (finalText.trim()) submit(); }, 1300); }
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
    rec.onerror = function () { if (pvRec === rec) { pvRec = null; if (onDead) safe(onDead); } };
    rec.onend = function () { if (pvRec === rec) { if (finalText.trim()) submit(); else { pvRec = null; if (onDead) safe(onDead); } } };
    try { rec.start(); return true; } catch (e) { pvRec = null; return false; }
  }

  /* =========================================================================
     av-5.0.0 — THE LIVING FACE. A drawn character with features a patient can
     actually read: blinking eyes, a wandering gaze, expressive brows, and a
     mouth that moves WITH the audio (amplitude lip-sync on the natural voice;
     a natural cycle while browser speech runs). Tinted from the doctor's
     portrait when one is saved. No ids inside the SVG — every part is
     class-scoped, so the Setup preview and the kiosk can coexist. ========= */
  /* av-5.3.0 — the face is now a CHARACTER the doctor owns: colours, hair,
     glasses and beard are all settable, and "Match my photo" derives them
     from the portrait so it genuinely resembles them. Every part is
     class-scoped (no ids) so several faces can live on one page. */
  var FACE_LOOK = { skin: '#f0c8a0', hair: '#4e3b2a', shirt: '#2E6A4B', lip: '#a95f47',
    eyes: '#4a3423', hairStyle: 'short', glasses: false, beard: 'none',
    /* FACE PASS 2026-08-07 - the character gained real features. Every one of
       these is OPTIONAL and defaults to neutral/off, so a look saved by any
       earlier release renders exactly the face it rendered before. */
    brows: 'normal', nose: 'straight', lips: 'normal', cap: false, stethoscope: false,
    /* CONFORM PASS 2026-08-07 - the owner asked the drawn face to "conform to
       the picture of the person better". These five describe the HEAD rather
       than the paint on it, and every one of them is measurable from a
       front-on portrait. All five default to the head this file already drew,
       so a look saved by any earlier release renders the same face it did. */
    faceShape: 'oval', eyeSet: 'normal', hairline: 'full', age: 'adult', browCol: '' };
  var FACE_HAIR_STYLES = ['short', 'wavy', 'long', 'bun', 'buzz', 'bald'];
  var FACE_BEARDS = ['none', 'stubble', 'beard'];
  var FACE_BROWS = ['thin', 'normal', 'thick'];
  var FACE_NOSES = ['button', 'straight', 'wide', 'roman'];
  var FACE_LIPS = ['thin', 'normal', 'full'];
  var FACE_SHAPES = ['oval', 'round', 'long', 'square'];
  var FACE_EYE_SETS = ['close', 'normal', 'wide'];
  var FACE_HAIRLINES = ['full', 'receding'];
  var FACE_AGES = ['adult', 'mature'];
  /* shade a whitelisted 6-digit hex toward white (amt > 0) or black (amt < 0).
     Accessory colours are DERIVED from the palette the doctor already picked,
     so a scrub cap matches the scrubs and no colour arrives unchosen. */
  function faceShade(hexv, amt) {
    var m = /^#([0-9a-fA-F]{6})$/.exec(String(hexv));
    if (!m) return '#888888';
    var n = parseInt(m[1], 16), out = '#', i, c;
    var parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (i = 0; i < 3; i++) {
      c = Math.round(parts[i] + (amt >= 0 ? (255 - parts[i]) * amt : parts[i] * amt));
      if (c < 0) c = 0;
      if (c > 255) c = 255;
      out += ('0' + c.toString(16)).slice(-2);
    }
    return out;
  }
  /* SKIN HAS AN UNDERTONE AND SO DO ITS SHADOWS. The nose, the nostrils, the
     dimples and the glabellar crease were drawn in flat black at a fixed
     alpha - the same grey shadow on every face in the practice. A shadow is
     the skin minus light, and it carries the skin's own cast: warm skin
     shadows run redder, cool skin shadows run bluer. Both come out of the
     SAME measured skin hex, so no colour arrives that the photo did not put
     there, and a look set by hand gets the treatment too. */
  function faceRgb(hexv) {
    var m = /^#([0-9a-fA-F]{6})$/.exec(String(hexv));
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function faceUndertone(hexv) {
    /* HUE, not warmth: r-b grows with depth on every skin, so a plain
       red-minus-blue test calls every deep complexion warm. Hue does not
       move when the same skin is lit dimmer. */
    var p = faceRgb(hexv);
    if (!p) return 'neutral';
    var mx = Math.max(p[0], p[1], p[2]), mn = Math.min(p[0], p[1], p[2]);
    if (mx - mn < 8) return 'neutral';
    var h;
    if (mx === p[0]) h = 60 * (((p[1] - p[2]) / (mx - mn)) % 6);
    else if (mx === p[1]) h = 60 * (((p[2] - p[0]) / (mx - mn)) + 2);
    else h = 60 * (((p[0] - p[1]) / (mx - mn)) + 4);
    if (h < 0) h += 360;
    if (h > 60 && h < 300) return 'neutral';          /* not a skin hue at all */
    return h < 21 ? 'cool' : (h > 34 ? 'warm' : 'neutral');
  }
  function faceHex(p) {
    var i, out = '#', c;
    for (i = 0; i < 3; i++) {
      c = Math.round(p[i]); if (c < 0) c = 0; if (c > 255) c = 255;
      out += ('0' + c.toString(16)).slice(-2);
    }
    return out;
  }
  function faceSkinShadow(hexv, amt) {
    var p = faceRgb(hexv);
    if (!p) return 'rgba(0,0,0,' + amt + ')';
    var tone = faceUndertone(hexv), k = 1 - amt;
    var br = tone === 'cool' ? 0.95 : tone === 'warm' ? 1.06 : 1;
    var bg2 = tone === 'cool' ? 0.98 : tone === 'warm' ? 0.99 : 1;
    var bb = tone === 'cool' ? 1.12 : tone === 'warm' ? 0.86 : 1;
    return faceHex([p[0] * k * br, p[1] * k * bg2, p[2] * k * bb]);
  }
  /* a flush is the skin pushed toward blood, not a fixed salmon dot: #e07a5f
     over deep skin is a smear of somebody else's cheek. */
  function faceBlushTone(hexv) {
    var p = faceRgb(hexv);
    if (!p) return '#e07a5f';
    return faceHex([p[0] * 1.06 + 12, p[1] * 0.80, p[2] * 0.82]);
  }
  function faceLookSafe(look) {
    var l = {}, src = look || {};
    function hex(v, dflt) { return /^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : dflt; }
    l.skin = hex(src.skin, FACE_LOOK.skin);
    l.hair = hex(src.hair, FACE_LOOK.hair);
    l.shirt = hex(src.shirt, FACE_LOOK.shirt);
    l.lip = hex(src.lip, FACE_LOOK.lip);
    l.eyes = hex(src.eyes, FACE_LOOK.eyes);
    l.hairStyle = FACE_HAIR_STYLES.indexOf(src.hairStyle) >= 0 ? src.hairStyle : 'short';
    l.beard = FACE_BEARDS.indexOf(src.beard) >= 0 ? src.beard : 'none';
    l.glasses = src.glasses === true;
    /* whitelisted EXACTLY like hairStyle/beard/glasses above: an unknown value
       can never reach an SVG attribute, and absence is the neutral default. */
    l.brows = FACE_BROWS.indexOf(src.brows) >= 0 ? src.brows : 'normal';
    l.nose = FACE_NOSES.indexOf(src.nose) >= 0 ? src.nose : 'straight';
    l.lips = FACE_LIPS.indexOf(src.lips) >= 0 ? src.lips : 'normal';
    l.cap = src.cap === true;
    l.stethoscope = src.stethoscope === true;
    /* the head itself, on the same whitelist rule. browCol is the ONLY field
       whose neutral value is the empty string: an eyebrow with no colour of
       its own follows the hair, which is what this file drew before there
       was a way to measure one. */
    l.faceShape = FACE_SHAPES.indexOf(src.faceShape) >= 0 ? src.faceShape : 'oval';
    l.eyeSet = FACE_EYE_SETS.indexOf(src.eyeSet) >= 0 ? src.eyeSet : 'normal';
    l.hairline = FACE_HAIRLINES.indexOf(src.hairline) >= 0 ? src.hairline : 'full';
    l.age = FACE_AGES.indexOf(src.age) >= 0 ? src.age : 'adult';
    l.browCol = hex(src.browCol, '');
    return l;
  }
  var FACE_MOUTHS = {
    /* av-5.2.0: a genuinely warm resting smile - the owner asked for smilier */
    smile:   'M76 130 Q100 149 124 130 Q100 141 76 130',
    grin:    'M70 126 Q100 162 130 126 Q100 140 70 126',
    soft:    'M84 134 Q100 141 116 134 Q100 138 84 134',
    concern: 'M82 140 Q100 131 118 140 Q100 137 82 140',
    /* thinking gets its OWN mouth: a slightly off-centre press. A thinking face
       wearing the resting smile is indistinguishable from an idle one. */
    think:   'M83 136 Q100 130 117 139 Q100 137 83 136',
    o:       'M91 132 Q100 126 109 132 Q109 146 100 147 Q91 146 91 132',
    open1:   'M86 131 Q100 137 114 131 Q100 149 86 131',
    open2:   'M83 129 Q100 136 117 129 Q100 158 83 129',
    open3:   'M79 127 Q100 134 121 127 Q100 167 79 127'
  };
  var FACE_HAIR_PATHS = {
    short: 'M42 92 Q40 30 100 28 Q160 30 158 92 Q158 64 138 58 Q140 44 118 44 Q96 40 78 50 Q58 52 60 70 Q44 72 42 92 Z',
    wavy:  'M42 94 Q38 28 100 26 Q162 28 158 94 Q152 74 146 84 Q140 62 130 74 Q124 52 112 62 Q104 44 92 58 Q80 46 72 64 Q62 56 58 76 Q50 70 42 94 Z',
    long:  'M42 92 Q40 30 100 28 Q160 30 158 92 Q158 64 138 58 Q140 44 118 44 Q96 40 78 50 Q58 52 60 70 Q44 72 42 92 Z',
    bun:   'M46 90 Q44 34 100 32 Q156 34 154 90 Q154 62 134 56 Q136 46 112 46 Q92 44 76 54 Q58 58 60 72 Q48 74 46 90 Z',
    buzz:  'M46 90 Q46 40 100 38 Q154 40 154 90 Q150 62 132 58 Q118 52 100 52 Q82 52 68 58 Q50 62 46 90 Z',
    bald:  ''
  };
  /* the parts that make one drawn doctor look like a different PERSON from the
     next. Each is a plain geometry table, so the whitelist in faceLookSafe is
     the only thing that decides which one is ever rendered. */
  var FACE_BROW_WEIGHT = { thin: 3.2, normal: 5, thick: 7.8 };
  var FACE_NOSE_PARTS = {
    button:   { d: 'M100 103 Q104 109 99 112', w: 3, nx: 5.2, ny: 112.4, nr: 1.5 },
    straight: { d: 'M100 98 Q105 111 97 115', w: 3, nx: 6.4, ny: 114.6, nr: 1.7 },
    wide:     { d: 'M100 100 Q106 111 100 114 M91 111 Q100 119.5 109 111', w: 2.8, nx: 7.6, ny: 113.2, nr: 2.1 },
    roman:    { d: 'M99 95 Q108 104 104 112 Q102 116 96 115', w: 3.2, nx: 6.2, ny: 114.8, nr: 1.7 }
  };
  /* LIPS. Volume is a real scale on the mouth group, and the lip line is the
     SAME path stroked in a darker shade of the chosen lip colour - so both the
     shape and the colour of the lips follow look.lip, and the line can never
     detach from the mouth when it opens. */
  var FACE_LIP_PARTS = {
    thin:   { scale: 0.78, w: 1.2 },
    normal: { scale: 1,    w: 2.2 },
    full:   { scale: 1.26, w: 3.6 }
  };
  /* THE SKULL. Four shapes a front-on portrait can honestly be measured for:
     the width-over-lower-height ratio splits round from long, and the jaw
     width taken 62% of the way from the eye line to the chin is what makes a
     square jaw square. `oval` is rx 58 / ry 66 - the one head this file drew
     before this pass - so the default is unchanged to the pixel. */
  var FACE_SHAPE_PARTS = {
    oval:   { rx: 58, ry: 66, jaw: 0 },
    round:  { rx: 63, ry: 60, jaw: 0.30 },
    long:   { rx: 52, ry: 74, jaw: 0 },
    square: { rx: 59, ry: 66, jaw: 0.85 }
  };
  /* half the distance between the pupils, on the default head. Everything
     that has to line up with an eye - the lids, the brows, the spectacle
     lenses, the crow's feet - is placed FROM this rather than repeating 71
     and 129, which is why moving the eyes used to be impossible. */
  var FACE_EYE_DX = { close: 25.5, normal: 29, wide: 32.5 };
  function faceSvg(look) {
    look = faceLookSafe(look || FACE_LOOK);
    /* THE HEAD IS MEASURED FIRST AND EVERY FEATURE IS PLACED FROM IT.
       Until this pass every doctor got one ellipse - rx 58, ry 66 - with the
       eyes, the blush, the spectacle lenses and the temples nailed to
       constants that only made sense on that ellipse, so a matcher could
       never move them even when it could see they were wrong. The oval is
       that ellipse exactly; the other three move the skull, and nothing below
       repeats a coordinate that the skull decides. */
    var sh = FACE_SHAPE_PARTS[look.faceShape] || FACE_SHAPE_PARTS.oval;
    var FX = sh.rx / 58, FY = sh.ry / 66;
    /* a long face is long in its LOWER third: the eyes hold their line while
       the nose and the mouth travel. Scaling the whole face instead just
       zooms the drawing and reads as a bigger head, not a longer one. */
    var dyN = (sh.ry - 66) * 0.30, dyM = (sh.ry - 66) * 0.62;
    var eyeDx = (FACE_EYE_DX[look.eyeSet] || FACE_EYE_DX.normal) * FX;
    function n2(v) { return String(Math.round(v * 100) / 100); }
    var cxL = Math.round((100 - eyeDx) * 100) / 100, cxR = Math.round((100 + eyeDx) * 100) / 100;
    /* brows follow the MEASURED brow colour when there was one. Painting them
       in the hair colour is wrong on every blond, grey or bald head, and dark
       brows under light hair are one of the strongest likeness cues there is. */
    var browPaint = look.browCol || look.hair;
    var shadeNose = faceSkinShadow(look.skin, 0.20);
    var shadeHole = faceSkinShadow(look.skin, 0.36);
    var shadeSoft = faceSkinShadow(look.skin, 0.14);
    var shadeKnit = faceSkinShadow(look.skin, 0.34);
    var blush = faceBlushTone(look.skin);
    /* one transform for everything that has to hug the skull: the crown, the
       beard, the cap and the back hair are all drawn for the default head. */
    var fit = 'translate(100,98) scale(' + n2(FX) + ',' + n2(FY) + ') translate(-100,-98)';
    function eye(cx, side) {
      return '<g class="fEye' + side + '" style="transform-box:fill-box;transform-origin:center;transition:transform .12s ease">' +
        '<ellipse cx="' + cx + '" cy="94" rx="11.5" ry="12.5" fill="#fff"/>' +
        '<g class="fPupil' + side + '" style="transition:transform .45s ease">' +
          '<circle cx="' + cx + '" cy="95" r="7" fill="' + look.eyes + '"/>' +
          '<circle cx="' + cx + '" cy="95" r="2.5" fill="#1d1710"/>' +
          '<circle cx="' + n2(cx + 2.4) + '" cy="92.2" r="2.1" fill="#fff"/>' +
        '</g>' +
        /* the LOWER lid: it rises into a smiling-eye arc on a genuine smile -
           the single strongest cue that a face means it */
        '<path class="fLow' + side + '" d="M' + n2(cx - 12) + ' 96 q12 12 24 0 v18 h-24 z" fill="' + look.skin + '" style="transform-box:fill-box;transform-origin:center bottom;transform:scaleY(0.02);transition:transform .3s ease"/>' +
        /* upper lid: a skin-coloured shutter that DROPS for sleepy/caring
           looks and lifts for surprise - real eyelid acting, not just scale */
        '<path class="fLid' + side + '" d="M' + n2(cx - 12) + ' 94 a12 12 0 0 1 24 0 z" fill="' + look.skin + '" style="transform-box:fill-box;transform-origin:center top;transform:scaleY(0.06);transition:transform .22s ease"/>' +
        '</g>';
    }
    var back = '';
    if (look.hairStyle === 'long') {
      back = '<path class="fHairBack" d="M40 96 Q34 168 56 178 Q48 120 52 96 Z M160 96 Q166 168 144 178 Q152 120 148 96 Z" fill="' + look.hair + '"/>';
    } else if (look.hairStyle === 'bun') {
      back = '<circle class="fHairBack" cx="100" cy="30" r="20" fill="' + look.hair + '"/>';
    }
    if (back) back = '<g class="fBackFit" transform="' + fit + '">' + back + '</g>';
    var hairPath = FACE_HAIR_PATHS[look.hairStyle] || FACE_HAIR_PATHS.short;
    var hair = hairPath ? '<path class="fHair" d="' + hairPath + '" fill="' + look.hair + '"/>' : '';
    /* A RECEDING HAIRLINE is two bare temples, so that is exactly what it is
       drawn as: skin-coloured wedges laid over the crown, inside the crown
       group so they ride the head and a cap still covers them. One pair of
       shapes works for every hair cut - there is no receding variant of each
       path to keep in step. */
    var temples = (look.hairline === 'receding' && look.hairStyle !== 'bald')
      ? '<path class="fTempleL" d="M46 94 Q49 60 82 44 Q63 66 60 94 Z" fill="' + look.skin + '"/>' +
        '<path class="fTempleR" d="M154 94 Q151 60 118 44 Q137 66 140 94 Z" fill="' + look.skin + '"/>'
      : '';
    var beard = '';
    if (look.beard === 'stubble') {
      beard = '<path class="fBeard" d="M52 108 Q56 160 100 164 Q144 160 148 108 Q140 150 100 152 Q60 150 52 108 Z" fill="' + look.hair + '" opacity=".28"/>';
    } else if (look.beard === 'beard') {
      beard = '<path class="fBeard" d="M50 104 Q54 164 100 168 Q146 164 150 104 Q142 148 100 150 Q58 148 50 104 Z" fill="' + look.hair + '" opacity=".92"/>' +
        '<path class="fStache" d="M80 124 Q100 118 120 124 Q100 130 80 124 Z" fill="' + look.hair + '" opacity=".92"/>';
    }
    var glasses = look.glasses
      ? '<g class="fGlasses" fill="none" stroke="#3d4a44" stroke-width="3" opacity=".85">' +
          '<rect x="' + n2(cxL - 16) + '" y="80" width="32" height="28" rx="10"/>' +
          '<rect x="' + n2(cxR - 16) + '" y="80" width="32" height="28" rx="10"/>' +
          '<path d="M' + n2(cxL + 16) + ' 92 Q100 88 ' + n2(cxR - 16) + ' 92"/>' +
          '<path d="M' + n2(cxL - 16) + ' 90 L' + n2(100 - sh.rx) + ' 94"/>' +
          '<path d="M' + n2(cxR + 16) + ' 90 L' + n2(100 + sh.rx) + ' 94"/>' +
        '</g>'
      : '';
    /* ACCESSORIES a doctor plausibly wears. Both default OFF; both are drawn
       from the doctor's own scrub colour so nothing arrives unchosen. The cap
       is inside the head group (it must ride the head tilt); the stethoscope is
       on the BODY, so it breathes with the chest and tucks under the chin. */
    var cap = look.cap
      ? '<g class="fCap">' +
          '<path class="fCapDome" d="M42 96 Q38 24 100 24 Q162 24 158 96 Q156 66 132 60 Q117 54 100 54 Q83 54 68 60 Q44 66 42 96 Z" fill="' + faceShade(look.shirt, 0.16) + '"/>' +
          '<path class="fCapBand" d="M42 96 Q44 66 68 60 Q83 54 100 54 Q117 54 132 60 Q156 66 158 96 Q150 76 132 69 Q117 63 100 63 Q83 63 68 69 Q50 76 42 96 Z" fill="' + faceShade(look.shirt, -0.18) + '"/>' +
          '<path class="fCapTie" d="M154 86 q15 5 13 21 q-5 -13 -16 -15 z" fill="' + faceShade(look.shirt, 0.16) + '"/>' +
        '</g>'
      : '';
    var steth = look.stethoscope
      ? '<g class="fSteth">' +
          '<path class="fSthTube" d="M74 146 C56 168 60 188 76 196" fill="none" stroke="#2f3b45" stroke-width="6" stroke-linecap="round"/>' +
          '<path class="fSthTube" d="M126 146 C143 163 140 173 131 179" fill="none" stroke="#2f3b45" stroke-width="6" stroke-linecap="round"/>' +
          '<circle class="fSthBell" cx="130" cy="187" r="9" fill="#d3d9de" stroke="#8c959c" stroke-width="3"/>' +
          '<circle class="fSthDot" cx="130" cy="187" r="3.6" fill="#98a1a8"/>' +
        '</g>'
      : '';
    /* THE JAW. An ellipse cannot be square, so a squarer jaw is an additive
       skin panel that leaves the cheekbones alone and only fills out the
       lower face. It meets the ellipse exactly at 20% of the way down, where
       the ellipse is still 98% of its full width, so there is no seam. */
    var jaw = '';
    if (sh.jaw > 0) {
      var jt1 = 98 + 0.20 * sh.ry, jt2 = 98 + 0.74 * sh.ry, jt3 = 98 + 0.99 * sh.ry;
      var jw1 = sh.rx * 0.98, jw2 = sh.rx * (0.694 + sh.jaw * 0.276);
      jaw = '<path class="fJaw fSkin" d="M' + n2(100 - jw1) + ' ' + n2(jt1) +
        ' L' + n2(100 - jw2) + ' ' + n2(jt2) +
        ' Q' + n2(100 - jw2) + ' ' + n2(jt3) + ' 100 ' + n2(jt3) +
        ' Q' + n2(100 + jw2) + ' ' + n2(jt3) + ' ' + n2(100 + jw2) + ' ' + n2(jt2) +
        ' L' + n2(100 + jw1) + ' ' + n2(jt1) + ' Z" fill="' + look.skin + '"/>';
    }
    /* AGE. Read from how much of the hair mass has gone grey, drawn as the
       two lines a face actually earns: the nasolabial folds and crow's feet.
       Both are in the skin's own shadow colour, both track the eyes and the
       mouth so they still land on a long face or a wide-set one. */
    var ageLines = look.age === 'mature'
      ? '<g class="fAge" fill="none" stroke="' + shadeNose + '" stroke-width="1.7" stroke-linecap="round" opacity=".5">' +
          '<path class="fFoldL" d="M89 ' + n2(110 + dyN) + ' Q79 ' + n2(126 + dyM) + ' 81 ' + n2(140 + dyM) + '"/>' +
          '<path class="fFoldR" d="M111 ' + n2(110 + dyN) + ' Q121 ' + n2(126 + dyM) + ' 119 ' + n2(140 + dyM) + '"/>' +
          '<path class="fCrowL" d="M' + n2(cxL - 13) + ' 89 l-7 -4 M' + n2(cxL - 14) + ' 95 l-8 0 M' + n2(cxL - 13) + ' 101 l-7 4"/>' +
          '<path class="fCrowR" d="M' + n2(cxR + 13) + ' 89 l7 -4 M' + n2(cxR + 14) + ' 95 l8 0 M' + n2(cxR + 13) + ' 101 l7 4"/>' +
        '</g>'
      : '';
    var browW = FACE_BROW_WEIGHT[look.brows] || FACE_BROW_WEIGHT.normal;
    var nose = FACE_NOSE_PARTS[look.nose] || FACE_NOSE_PARTS.straight;
    var lips = FACE_LIP_PARTS[look.lips] || FACE_LIP_PARTS.normal;
    var noseRy = (nose.nr * 0.7).toFixed(2);
    return '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" data-mood="idle" style="width:100%;height:100%;display:block">' +
      /* the CHEST is a real group: breathing moves GEOMETRY in here (the shirt
         ellipse itself grows and lifts), not a scale on the drawing */
      '<g class="fBody" style="transform-box:view-box;transform-origin:100px 180px;transition:transform .09s linear">' +
        '<ellipse class="fShirt" cx="100" cy="206" rx="74" ry="50" fill="' + look.shirt + '"/>' +
        '<path class="fCollar" d="M78 158 Q100 188 122 158 Q100 172 78 158 Z" fill="' + faceShade(look.shirt, -0.2) + '"/>' +
        steth +
      '</g>' +
      back +
      /* the RIG carries the FAST acting (breath bob, listening nod, concern
         head-shake). .fHead keeps the slow mood tilt on its own .45s
         transition, so the two never fight for one transform. */
      '<g class="fHeadRig" style="transform-box:view-box;transform-origin:100px 152px;transition:transform .16s ease-out">' +
      '<g class="fHead" style="transform-box:fill-box;transform-origin:50% 62%;transition:transform .45s ease">' +
        '<ellipse class="fSkin fEarL" cx="' + n2(100 - sh.rx) + '" cy="' + n2(98 + 2 * FY) + '" rx="9" ry="' + n2(13 * FY) + '" fill="' + look.skin + '"/>' +
        '<ellipse class="fSkin fEarR" cx="' + n2(100 + sh.rx) + '" cy="' + n2(98 + 2 * FY) + '" rx="9" ry="' + n2(13 * FY) + '" fill="' + look.skin + '"/>' +
        '<ellipse class="fSkin fFace" cx="100" cy="98" rx="' + sh.rx + '" ry="' + sh.ry + '" fill="' + look.skin + '"/>' +
        jaw +
        '<g class="fCrownFit" transform="' + fit + '">' + beard + hair + temples + cap + '</g>' +
        '<circle class="fBlush" cx="' + n2(100 - 37 * FX) + '" cy="' + n2(119 + dyN) + '" r="9" fill="' + blush + '" opacity=".22" style="transition:opacity .4s ease"/>' +
        '<circle class="fBlush" cx="' + n2(100 + 37 * FX) + '" cy="' + n2(119 + dyN) + '" r="9" fill="' + blush + '" opacity=".22" style="transition:opacity .4s ease"/>' +
        '<g class="fBrowL" style="transform-box:fill-box;transform-origin:center;transition:transform .35s ease"><path d="M' + n2(cxL - 13) + ' 78 Q' + n2(cxL - 1) + ' 72 ' + n2(cxL + 13) + ' 77" stroke="' + browPaint + '" stroke-width="' + browW + '" stroke-linecap="round" fill="none"/></g>' +
        '<g class="fBrowR" style="transform-box:fill-box;transform-origin:center;transition:transform .35s ease"><path d="M' + n2(cxR - 13) + ' 77 Q' + n2(cxR + 1) + ' 72 ' + n2(cxR + 13) + ' 78" stroke="' + browPaint + '" stroke-width="' + browW + '" stroke-linecap="round" fill="none"/></g>' +
        /* the glabellar KNIT - two short creases between the brows. Concern is
           read there before it is read anywhere else on a human face. */
        '<path class="fKnit" d="M96.5 72 Q97.5 66 96.5 61 M103.5 72 Q102.5 66 103.5 61" stroke="' + shadeKnit + '" stroke-width="2" stroke-linecap="round" fill="none" opacity="0" style="transition:opacity .3s ease"/>' +
        eye(cxL, 'L') + eye(cxR, 'R') + glasses +
        '<g class="fNoseSet" transform="translate(0,' + n2(dyN) + ')">' +
          '<path class="fNose" d="' + nose.d + '" stroke="' + shadeNose + '" stroke-width="' + nose.w + '" stroke-linecap="round" fill="none"/>' +
          '<ellipse class="fNostril fNostrilL" cx="' + n2(100 - nose.nx) + '" cy="' + nose.ny + '" rx="' + nose.nr + '" ry="' + noseRy + '" fill="' + shadeHole + '"/>' +
          '<ellipse class="fNostril fNostrilR" cx="' + n2(100 + nose.nx) + '" cy="' + nose.ny + '" rx="' + nose.nr + '" ry="' + noseRy + '" fill="' + shadeHole + '"/>' +
        '</g>' +
        '<g class="fMouthSet" transform="translate(0,' + n2(dyM) + ')">' +
        '<g class="fMouthWrap" style="transform-box:fill-box;transform-origin:center top;transition:transform .1s ease">' +
          '<g class="fLips" style="transform-box:fill-box;transform-origin:center;transform:scaleY(' + lips.scale + ');transition:transform .3s ease">' +
            '<path class="fMouth" d="' + FACE_MOUTHS.smile + '" fill="' + look.lip + '"/>' +
            '<path class="fLipUp" d="' + FACE_MOUTHS.smile + '" fill="none" stroke="' + faceShade(look.lip, -0.3) + '" stroke-width="' + lips.w + '" stroke-linejoin="round"/>' +
          '</g>' +
          '<path class="fDimpleL" d="M74 130 q-3 4 0 8" stroke="' + shadeSoft + '" stroke-width="2" fill="none" opacity="0" style="transition:opacity .3s ease"/>' +
          '<path class="fDimpleR" d="M126 130 q3 4 0 8" stroke="' + shadeSoft + '" stroke-width="2" fill="none" opacity="0" style="transition:opacity .3s ease"/>' +
        '</g>' +
        '</g>' +
        ageLines +
      '</g></g></svg>';
  }
  function makeFace(mount, look) {
    if (!mount) return null;
    mount.innerHTML = faceSvg(look);
    var root = mount.querySelector('svg');
    if (!root) return null;
    var ctl = null;
    function q(sel) { return root.querySelector(sel); }
    var head, rig, body, shirt, browL, browR, eyeL, eyeR, pupL, pupR,
      lidL, lidR, lowL, lowR, mouth, lipUp, lipsG, mouthWrap, dimpleL, dimpleR, knit, blush;
    function bind() {
      head = q('.fHead'); rig = q('.fHeadRig'); body = q('.fBody'); shirt = q('.fShirt');
      browL = q('.fBrowL'); browR = q('.fBrowR');
      eyeL = q('.fEyeL'); eyeR = q('.fEyeR'); pupL = q('.fPupilL'); pupR = q('.fPupilR');
      lidL = q('.fLidL'); lidR = q('.fLidR'); lowL = q('.fLowL'); lowR = q('.fLowR');
      mouth = q('.fMouth'); lipUp = q('.fLipUp'); lipsG = q('.fLips'); mouthWrap = q('.fMouthWrap');
      dimpleL = q('.fDimpleL'); dimpleR = q('.fDimpleR'); knit = q('.fKnit');
      blush = root.querySelectorAll('.fBlush');
    }
    bind();
    var timers = [], dead = false, cycling = false;
    var moodNow = 'idle', caringNow = false, happyNow = false;
    var reduced = safe(function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }, false);
    /* every fast gesture writes ONE of these and applyRig() composes them, so a
       nod landing inside a concern shake cannot erase the shake */
    var breathT = 0, breathY = 0, nodY = 0, shakeX = 0, shakeR = 0, browGesture = '';
    /* GESTURE GENERATION. Every gesture is transient and every mood change
       invalidates the ones in flight: without this, the curious brow started
       by "thinking" was still overriding applyBrows() a moment later and the
       concern knit never rendered at all. */
    var gestureGen = 0;
    var BREATH_CY = 206, BREATH_RY = 50;
    function faceLives() {
      /* a face whose mount has left the document is finished. The Setup preview
         controller is never explicitly destroyed, and a breathing loop on a
         detached tree would otherwise tick for the life of the tab. */
      return safe(function () {
        if (!root) return false;
        if (root.isConnected === true) return true;
        return !!(document.documentElement && document.documentElement.contains(root));
      }, true);
    }
    function later(fn, ms) {
      var t = setTimeout(function () {
        var i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1);
        if (dead) return;
        if (!faceLives()) { destroy(); return; }
        safe(fn);
      }, ms);
      timers.push(t); return t;
    }
    function killTransitions() {
      /* prefers-reduced-motion must stop MOTION, not merely the loops: without
         this the inline transitions still slide every state change. */
      safe(function () {
        var n = root.querySelectorAll('[style]'), i;
        for (i = 0; i < n.length; i++) { n[i].style.transition = 'none'; }
      });
    }
    function setMouth(shape) {
      var d = FACE_MOUTHS[shape] || FACE_MOUTHS.smile;
      if (mouth) mouth.setAttribute('d', d);
      /* the lip line is the SAME path - a separately drawn upper lip detaches
         the instant the mouth opens */
      if (lipUp) lipUp.setAttribute('d', d);
    }
    function baseMouth() {
      return caringNow ? 'concern'
        : happyNow ? 'grin'
        : moodNow === 'listening' ? 'soft'
        : moodNow === 'thinking' ? 'think' : 'smile';
    }
    function eyesBase() { return happyNow ? 'scaleY(.62)' : ''; }
    /* the upper lids do real acting: a genuine smile RAISES the cheek and
       narrows the eye (Duchenne), concern drops the lid, thinking half-closes
       one - the difference between a mask and a face. */
    function lidBase() {
      if (happyNow) return 0.34;
      if (caringNow) return 0.30;
      if (moodNow === 'thinking') return 0.22;
      return 0.06;
    }
    function applyLids() {
      var v = lidBase();
      if (lidL) lidL.style.transform = 'scaleY(' + v + ')';
      if (lidR) lidR.style.transform = 'scaleY(' + (moodNow === 'thinking' ? Math.min(0.5, v + 0.16) : v) + ')';
      /* smiling eyes: the lower lid climbs only on a real smile */
      var low = happyNow ? 1 : caringNow ? 0.30 : 0.02;
      if (lowL) lowL.style.transform = 'scaleY(' + low + ')';
      if (lowR) lowR.style.transform = 'scaleY(' + low + ')';
    }
    function blink() {
      if (dead) return;
      if (!reduced && lidL && lidR) {
        lidL.style.transform = 'scaleY(1)'; lidR.style.transform = 'scaleY(1)';
        later(applyLids, 120);
      }
      /* the occasional double-blink reads as alive, not mechanical */
      var again = Math.random() < 0.18;
      later(blink, again ? 260 : (2600 + Math.random() * 3200));
    }
    /* ---- GAZE. Where the eyes point is a mood, not a random walk: it settles
       on the viewer while speaking, holds steady while listening, and drifts up
       and away while thinking. That contrast is most of what makes a drawn face
       look like it is paying attention. ---- */
    function setGaze(dx, dy) {
      var t = 'translate(' + Number(dx).toFixed(2) + 'px,' + Number(dy).toFixed(2) + 'px)';
      if (pupL) pupL.style.transform = t;
      if (pupR) pupR.style.transform = t;
    }
    function gazeNext() {
      if (moodNow === 'listening') return [0, 0];
      if (moodNow === 'speaking') return [Math.random() * 0.9 - 0.45, Math.random() * 0.6 - 0.3];
      if (moodNow === 'thinking') {
        var s = Math.random() < 0.5 ? -1 : 1;
        return [s * (2.8 + Math.random() * 1.4), -(1.6 + Math.random() * 1.1)];
      }
      return [Math.random() * 5 - 2.5, Math.random() * 3 - 1.4];
    }
    function gazeDelay() {
      return moodNow === 'speaking' ? 1400 + Math.random() * 1800
        : moodNow === 'thinking' ? 900 + Math.random() * 900
        : moodNow === 'listening' ? 1200 + Math.random() * 900
        : 1800 + Math.random() * 2600;
    }
    function wander() {
      if (dead) return;
      if (!reduced) { var g = gazeNext(); setGaze(g[0], g[1]); } else setGaze(0, 0);
      later(wander, gazeDelay());
    }
    /* ---- THE RIG: breath + nod + shake, composed into one transform ---- */
    function applyRig() {
      if (!rig) return;
      if (reduced) { rig.style.transform = ''; return; }
      rig.style.transform = 'translate(' + shakeX.toFixed(2) + 'px,' + (breathY + nodY).toFixed(2) + 'px) rotate(' + shakeR.toFixed(2) + 'deg)';
    }
    function breathe() {
      if (dead) return;
      if (!reduced && shirt) {
        breathT += 0.13;
        var p = Math.sin(breathT);
        /* REAL geometry: the shoulders rise because the chest ellipse itself
           grows and lifts. A scale on the whole drawing would zoom the head. */
        shirt.setAttribute('ry', (BREATH_RY + p * 2.4).toFixed(2));
        shirt.setAttribute('cy', (BREATH_CY - p * 1.6).toFixed(2));
        if (body) body.style.transform = 'translateY(' + (-p * 1.1).toFixed(2) + 'px)';
        breathY = -p * 0.5;
        applyRig();
      }
      later(breathe, 90);
    }
    function nod() {
      /* ACKNOWLEDGEMENT while the patient talks - the cheapest honest signal
         that a listener is actually with you */
      if (dead || reduced) return;
      var g = gestureGen;
      nodY = 2.8; applyRig();
      later(function () { nodY = g === gestureGen ? -1 : 0; applyRig(); }, 190);
      later(function () { nodY = 0; applyRig(); }, 380);
    }
    function nodLoop() {
      if (dead) return;
      if (!reduced && moodNow === 'listening' && !caringNow) nod();
      later(nodLoop, 2400 + Math.random() * 2200);
    }
    function shake() {
      /* CONCERN: a small, slow head shake. Two beats and out - a wobble reads
         as a glitch, not as sympathy. */
      if (dead || reduced) return;
      var seq = [[-2.6, -2.2], [2.2, 1.8], [-1.2, -1], [0, 0]], i = 0, g = gestureGen;
      (function step() {
        if (dead) return;
        /* abandoned mid-shake, the head must NOT be left crooked */
        if (g !== gestureGen) { shakeX = 0; shakeR = 0; applyRig(); return; }
        if (i >= seq.length) return;
        shakeX = seq[i][0]; shakeR = seq[i][1]; i++;
        applyRig();
        later(step, 150);
      })();
    }
    function curious() {
      /* CURIOSITY: one brow up. The clearest "go on, tell me more" a face has,
         and it must be ASYMMETRIC or it just reads as surprise. */
      if (dead || reduced) return;
      var g = gestureGen;
      browGesture = 'curious'; applyBrows();
      later(function () {
        if (g !== gestureGen) return; /* a newer mood already cleared it */
        browGesture = ''; applyBrows();
      }, 1000);
    }
    function applyBrows() {
      var bl = '', br = '';
      if (caringNow) {
        /* a real KNIT: the INNER ends come up and together. The old code
           rotated them the other way, which is the anger brow, not concern. */
        bl = 'translate(2.2px,-1.4px) rotate(-9deg)';
        br = 'translate(-2.2px,-1.4px) rotate(9deg)';
      } else if (happyNow) { bl = br = 'translateY(-4px)'; }
      else if (moodNow === 'thinking') { bl = 'translateY(2.4px) rotate(4deg)'; br = 'translateY(-5.5px) rotate(-6deg)'; }
      else if (moodNow === 'listening') { bl = br = 'translateY(-2px)'; }
      if (browGesture === 'curious') { bl = 'translateY(0.6px)'; br = 'translateY(-6.5px) rotate(-6deg)'; }
      if (browL) browL.style.transform = bl;
      if (browR) browR.style.transform = br;
      if (knit) knit.style.opacity = caringNow ? '.55' : '0';
    }
    function applyHead() {
      if (!head) return;
      head.style.transform = reduced ? '' :
        moodNow === 'listening' ? 'rotate(2.4deg) translateY(1px)' :
        moodNow === 'thinking' ? 'rotate(-2.8deg) translateY(-2px)' :
        caringNow ? 'rotate(1.6deg) translateY(1.5px)' : '';
    }
    function mood(state, caring, happy) {
      var wasMood = moodNow, wasCaring = caringNow, wasHappy = happyNow;
      moodNow = state || 'idle'; caringNow = !!caring; happyNow = !!happy && !caring;
      /* a CHANGE retires every gesture in flight and every one scheduled. The
         new expression owns the brows from this instant. */
      if (moodNow !== wasMood || caringNow !== wasCaring || happyNow !== wasHappy) {
        gestureGen++; browGesture = '';
      }
      root.setAttribute('data-mood', moodNow + (caringNow ? ' caring' : '') + (happyNow ? ' happy' : ''));
      applyBrows();
      applyHead();
      if (eyeL && eyeR) { eyeL.style.transform = eyesBase(); eyeR.style.transform = eyesBase(); }
      applyLids();
      /* a real smile reaches the cheeks and dimples; concern drains them */
      var warm = happyNow ? '.42' : caringNow ? '.12' : '.22';
      Array.prototype.forEach.call(blush, function (n) { n.style.opacity = warm; });
      if (dimpleL) dimpleL.style.opacity = happyNow ? '1' : '0';
      if (dimpleR) dimpleR.style.opacity = happyNow ? '1' : '0';
      if (!cycling) setMouth(baseMouth());
      /* the gaze re-points IMMEDIATELY on a mood change - waiting for the next
         wander tick is exactly how a face reads as dead */
      if (!reduced) { var g = gazeNext(); setGaze(g[0], g[1]); } else setGaze(0, 0);
      /* ACTING fires on the CHANGE, never on a repaint of the same state */
      if (caringNow && !wasCaring) shake();
      if (moodNow === 'thinking' && wasMood !== 'thinking') curious();
      if (moodNow === 'listening' && wasMood !== 'listening') {
        /* scheduled, so they must check they are still wanted when they land */
        var g = gestureGen;
        later(function () { if (g === gestureGen) nod(); }, 500);
        if (Math.random() < 0.45) later(function () { if (g === gestureGen) curious(); }, 900);
      }
    }
    function talk(level) {
      /* level 0..1 = live amplitude from the natural voice; -1 = stop */
      if (dead || !mouth) return;
      if (level < 0) { setMouth(baseMouth()); if (mouthWrap) mouthWrap.style.transform = ''; return; }
      setMouth(level > 0.62 ? 'open3' : level > 0.34 ? 'open2' : level > 0.1 ? 'open1' : Math.random() < 0.2 ? 'o' : 'soft');
      /* the jaw travels with the voice - the mouth shape alone reads rubbery */
      if (mouthWrap && !reduced) mouthWrap.style.transform = 'translateY(' + (level * 2.6).toFixed(2) + 'px)';
    }
    function talkCycle(on) {
      /* browser-speech fallback carries no amplitude - cycle naturally */
      cycling = !!on;
      if (!on) { setMouth(baseMouth()); if (mouthWrap) mouthWrap.style.transform = ''; return; }
      (function step() {
        if (!cycling || dead) return;
        setMouth(['open1', 'open2', 'soft', 'open3', 'o', 'open1'][Math.floor(Math.random() * 6)]);
        later(step, 95 + Math.random() * 70);
      })();
    }
    /* A colour-only retint cannot add glasses, a cap, a beard or a different
       hair cut, so a full look change RE-RENDERS and re-binds - then replays the
       current mood so the face never flickers back to neutral. */
    function retint(lk) {
      if (!lk) return;
      var keep = { state: moodNow, caring: caringNow, happy: happyNow };
      mount.innerHTML = faceSvg(lk);
      var fresh = mount.querySelector('svg');
      if (!fresh) return;
      root = fresh;
      bind();
      /* the returned handle used to keep the ORIGINAL svg after a retint, so any
         caller holding .node was pointing into a detached tree */
      if (ctl) ctl.node = root;
      if (reduced) killTransitions();
      breathY = 0; nodY = 0; shakeX = 0; shakeR = 0; browGesture = ''; gestureGen++;
      applyRig();
      mood(keep.state, keep.caring, keep.happy);
    }
    function destroy() {
      dead = true; cycling = false;
      timers.forEach(function (t) { safe(function () { clearTimeout(t); }); });
      timers.length = 0;
    }
    if (reduced) killTransitions();
    mood('idle');
    blink(); wander();
    /* reduced motion does not merely skip the frames - the loops never start */
    if (!reduced) { breathe(); nodLoop(); }
    ctl = { mood: mood, talk: talk, talkCycle: talkCycle, retint: retint,
      nod: nod, shake: shake, curious: curious, gaze: setGaze,
      destroy: destroy, node: root };
    return ctl;
  }
  function faceTintFromPortrait(dataUrl, then) {
    /* "actually based off your face": derive as many of the character's knobs
       from the portrait as the pixels honestly support - skin, hair colour,
       hair length, facial hair, glasses and eye colour - and hand back BOTH the
       look and a plain-language list of what was detected, so the doctor can
       see it worked and correct any single knob by hand. Fails safe: an
       unusable photo returns null rather than a stranger's face. */
    if (!dataUrl || String(dataUrl).indexOf('data:image/') !== 0) { then(null); return; }
    var img = new Image();
    img.onload = function () {
      then(safe(function () {
        var N = 48;
        var c = document.createElement('canvas'); c.width = N; c.height = N;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0, N, N);
        var d = x.getImageData(0, 0, N, N).data;
        function px(xx, yy) { var i = ((yy | 0) * N + (xx | 0)) * 4; return [d[i], d[i + 1], d[i + 2]]; }
        function lum(p) { return (p[0] * 3 + p[1] * 4 + p[2]) / 8; }
        function hex(p) { return '#' + p.map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(''); }
        /* MEDIAN of several small patches - one patch landing on a shadow, a
           fringe or a frame no longer drags the whole sample. */
        function patchMedian(spots, r) {
          var cols = spots.map(function (s2) {
            var acc = [0, 0, 0], n = 0;
            for (var yy = s2[1] - r; yy <= s2[1] + r; yy++)
              for (var xx = s2[0] - r; xx <= s2[0] + r; xx++) {
                if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
                var p = px(xx, yy); acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2]; n++;
              }
            return n ? [acc[0] / n, acc[1] / n, acc[2] / n] : null;
          }).filter(Boolean);
          if (!cols.length) return null;
          cols.sort(function (a, b) { return lum(a) - lum(b); });
          return cols[Math.floor(cols.length / 2)];
        }
        /* Regions as fractions of the frame: the portrait is a centred square
           crop (stylizePortrait guarantees it), so these hold across faces. */
        var F = function (fx, fy) { return [Math.round(N * fx), Math.round(N * fy)]; };
        /* clear of the eye band: a spectacle frame sits around y 0.38-0.46 and
           dragged the skin sample dark, which then made light hair look like
           skin and read as bald. Cheeks and mid-face only. */
        var skin = patchMedian([F(0.30, 0.52), F(0.70, 0.52), F(0.32, 0.60), F(0.68, 0.60), F(0.50, 0.30), F(0.50, 0.62)], 2);
        /* background estimate from the four corners; hair patches that look
           like background are discarded rather than averaged in. */
        var bg = patchMedian([F(0.03, 0.03), F(0.97, 0.03), F(0.03, 0.97), F(0.97, 0.97)], 1);
        var bgL = bg ? lum(bg) : -999;
        function hairMedian() {
          /* deep INSIDE the hair mass, not on the hairline: edge patches blend
             hair with background and returned grey for a black-haired doctor. */
          var spots = [F(0.44, 0.13), F(0.50, 0.11), F(0.56, 0.13), F(0.40, 0.16), F(0.60, 0.16)];
          var keep = spots.filter(function (sp) {
            var p = patchMedian([sp], 1);
            return p && Math.abs(lum(p) - bgL) > 22;
          });
          return patchMedian(keep.length ? keep : spots, 1);
        }
        var hair = hairMedian();
        if (!skin || !hair) return null;
        var skinL = lum(skin), hairL = lum(hair);
        if (skinL < 55) return null;                       /* too dark to read */

        var found = [];
        var look = { skin: hex(skin), hair: hex(hair), shirt: FACE_LOOK.shirt,
                     lip: FACE_LOOK.lip, eyes: FACE_LOOK.eyes,
                     hairStyle: 'short', glasses: false, beard: 'none' };
        /* THE LEDGER OF WHAT WAS ACTUALLY MEASURED. Match used to hand back
           a whole look, so the caller could not tell a real reading from a
           default - and the only safe thing it could do with the knobs it
           doubted was refuse to apply any of them, which is precisely why
           the drawn face stopped resembling the photo. These five are
           always written below; anything else appends itself HERE at the
           moment it is genuinely detected. */
        var derived = ['skin', 'hair', 'hairStyle', 'beard', 'glasses'];
        found.push(skinL > 190 ? 'fair skin' : skinL > 140 ? 'medium skin' : skinL > 95 ? 'tan skin' : 'deep skin');

        /* HAIR: how much of the crown is darker than the face, and do the low
           side columns carry that same darkness (length)? */
        /* DIFFERENCE from this face's own skin, not darkness: blond, grey and
           white hair are LIGHTER than skin, and the old darker-than-threshold
           test classified every one of them as bald. */
        function unlikeSkin(p) {
          return (Math.abs(lum(p) - skinL) +
                  (Math.abs(p[0] - skin[0]) + Math.abs(p[1] - skin[1]) + Math.abs(p[2] - skin[2])) / 6) > 24;
        }
        var crown = 0, crownN = 0, sides = 0, sidesN = 0;
        for (var xx1 = Math.round(N * 0.30); xx1 < N * 0.70; xx1++)
          for (var yy1 = Math.round(N * 0.04); yy1 < N * 0.18; yy1++) { crownN++; if (unlikeSkin(px(xx1, yy1))) crown++; }
        for (var yy2 = Math.round(N * 0.55); yy2 < N * 0.92; yy2++) {
          for (var xx2 = 0; xx2 < N * 0.14; xx2++) { sidesN++; if (unlikeSkin(px(xx2, yy2))) sides++; }
          for (var xx3 = Math.round(N * 0.86); xx3 < N; xx3++) { sidesN++; if (unlikeSkin(px(xx3, yy2))) sides++; }
        }
        function sideLooksLikeHair() {
          var sp = patchMedian([F(0.06, 0.72), F(0.94, 0.72)], 2);
          if (!sp || !hair) return false;
          return (Math.abs(sp[0] - hair[0]) + Math.abs(sp[1] - hair[1]) + Math.abs(sp[2] - hair[2])) / 3 < 46;
        }
        var crownR = crownN ? crown / crownN : 0, sideR = sidesN ? sides / sidesN : 0;
        if (crownR < 0.20) { look.hairStyle = 'bald'; found.push('little or no hair'); }
        else if (crownR < 0.42) { look.hairStyle = 'buzz'; found.push('very short hair'); }
        else if (sideR > 0.30 && sideLooksLikeHair()) { look.hairStyle = 'long'; found.push('long hair'); }
        else { look.hairStyle = 'short'; found.push('short hair'); }
        if (look.hairStyle !== 'bald') found.push(hairL < 70 ? 'dark hair' : hairL > 165 ? 'light hair' : 'mid-tone hair');

        /* FACIAL HAIR: the chin/jaw measurably darker than the cheeks. Compared
           against this face's own skin, not an absolute threshold. */
        /* THE JAW, NOT THE MOUTH. These three patches used to sit at
           (0.50,0.74) and (0.40/0.60,0.70) - on the lips and immediately
           beside them - so a dark lip colour measured as a drop from the
           cheeks and a clean-shaven face came back bearded. Facial hair is
           read on the jaw sides and low on the chin, where a mouth is not. */
        var chin = patchMedian([F(0.34, 0.72), F(0.66, 0.72), F(0.50, 0.79)], 2);
        if (chin) {
          var drop = skinL - lum(chin);
          if (drop > 46) { look.beard = 'beard'; found.push('beard'); }
          else if (drop > 24) { look.beard = 'stubble'; found.push('stubble'); }
        }
        /* GLASSES: a band at eye level darker than BOTH the forehead and the
           cheeks below it, on both sides (a frame, not a shadow). */
        var browRow = patchMedian([F(0.32, 0.40), F(0.68, 0.40)], 1);
        var cheekRow = patchMedian([F(0.30, 0.56), F(0.70, 0.56)], 1);
        var brow2 = patchMedian([F(0.50, 0.30)], 1);
        /* THE BRIDGE IS WHAT MAKES A FRAME A FRAME. "Darker than the forehead
           and darker than the cheeks, on both sides" is equally well explained
           by THICK DARK EYEBROWS, and that is not a rare face. Measured: an
           8px brow bar came back as spectacles - and because the brow measure
           stands down whenever glasses are detected, the same face then lost
           its eyebrows too. One misread, two wrong answers, in the direction
           of adding a feature the doctor does not have.
           Eyebrows have a gap between them. A frame crosses it. */
        var bridge = patchMedian([F(0.50, 0.40)], 1);
        if (browRow && cheekRow && brow2 && bridge) {
          if (lum(bridge) < lum(cheekRow) - 20 &&
              lum(browRow) < lum(cheekRow) - 26 && lum(browRow) < lum(brow2) - 20) {
            look.glasses = true; found.push('glasses');
          }
        }
        /* EYES: the iris sits just inside each eye centre. Take the darker of
           the two samples but refuse near-black (that is pupil or lash). */
        var eye = patchMedian([F(0.36, 0.44), F(0.64, 0.44)], 1);
        if (eye && lum(eye) > 40 && lum(eye) < skinL - 20) { look.eyes = hex(eye); derived.push('eyes'); }

        /* ---- SHAPE PASS ---------------------------------------------------
           Brow weight, lip fullness and nose width are SHAPE questions, and
           the 48px read above cannot answer them - one pixel there is a fifth
           of an eyebrow. So the colour pass is left byte for byte as it was
           (its thresholds are tuned against real portraits and were verified
           live) and a SECOND, higher-resolution read answers only these.

           Every measure REFUSES rather than guesses: an unreadable one leaves
           the knob absent from `derived`, and the caller then keeps whatever
           the doctor set by hand. A confident wrong nose is worse than no
           nose - it makes the doctor correct the avatar instead of trust it.
           `roman` is deliberately unreachable from here: it is a profile
           feature and a front-on portrait carries no evidence for it, so it
           stays a choice rather than a claim. --------------------------- */
        safe(function () {
          var M = 128;
          var c2 = document.createElement('canvas'); c2.width = M; c2.height = M;
          var x2 = c2.getContext('2d'); x2.drawImage(img, 0, 0, M, M);
          var d2 = x2.getImageData(0, 0, M, M).data;
          function px2(xx, yy) { var i = ((yy | 0) * M + (xx | 0)) * 4; return [d2[i], d2[i + 1], d2[i + 2]]; }
          function lum2(p) { return (p[0] * 3 + p[1] * 4 + p[2]) / 8; }
          function at(fr) { return Math.round(M * fr); }
          function median(a) { if (!a.length) return null; a.sort(function (p, q) { return p - q; }); return a[Math.floor(a.length / 2)]; }
          function apart(a, b, n) {
            return !!(a && b) && (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3 > n;
          }

          /* BROWS: the vertical EXTENT of the dark band above each eye, taken
             per column and reduced by median, so one stray lash or fringe
             pixel cannot decide it. Skipped outright when glasses were
             detected - a frame lies across exactly this band and would read
             as the thickest brows on every bespectacled face in the practice. */
          if (!look.glasses) {
            /* BETWEEN the forehead and the eyes. It stops clear of the eyes
               at y 0.44 (pupil and lash would read as eyebrow) and opens
               BELOW the hair mass, whose bottom edge reaches y 0.34 - a band
               that started at 0.30 measured the fringe on a face that had no
               eyebrows drawn at all. */
            var by0 = at(0.355), by1 = at(0.43), browCols = [], browPix = [];
            for (var bx = at(0.26); bx < M * 0.75; bx++) {
              if (bx > M * 0.44 && bx < M * 0.56) continue;      /* the gap between the brows */
              var darkRows = 0;
              for (var byy = by0; byy < by1; byy++) {
                var bp = px2(bx, byy);
                if (lum2(bp) < skinL - 34) { darkRows++; browPix.push(bp); }
              }
              browCols.push(darkRows);
            }
            var browMed = median(browCols);
            if (browMed) {
              /* against the FACE height, not the band: a fraction of the band
                 changes meaning whenever the band moves, and the band had to
                 move once already.
                 The cut points come from proportions, not from the fixture: an
                 eyebrow is roughly 7-10mm tall on a face that runs about
                 185mm chin to hairline, so a natural brow is ~4-5% of the
                 face. Thin is nearer 5mm (2.7%) and thick nearer 12mm (6.5%).
                 The three-point test (thin / natural / thick) then shows the
                 classifier DISCRIMINATES; it is not what chose the numbers. */
              var bRatio = browMed / (M * 0.72);
              var bVal = bRatio < 0.035 ? 'thin' : (bRatio > 0.06 ? 'thick' : 'normal');
              look.brows = bVal; derived.push('brows');
              found.push(bVal === 'normal' ? 'natural brows' : bVal + ' brows');
              /* AND THEIR COLOUR, from the very pixels that were just counted.
                 Painting brows in the hair colour is wrong on every blond,
                 grey or balding head, and dark brows under light hair are one
                 of the strongest likeness cues a drawn face has. Taken only
                 when it actually differs from the hair - otherwise the honest
                 answer is the follow-the-hair default this file already had. */
              if (browPix.length > 12) {
                browPix.sort(function (p, q) { return lum2(p) - lum2(q); });
                var bc = browPix[Math.floor(browPix.length / 2)];
                if (apart(bc, hair, 30)) { look.browCol = hex(bc); derived.push('browCol'); found.push('brows a different colour from the hair'); }
              }
            }
          }

          /* LIPS: how much of the mouth band is measurably REDDER than this
             face's own cheek. Redness, not darkness - the shadow under a lip
             is dark but not red, and a beard is dark across the whole band. */
          function redness(p) { return p[0] - (p[1] + p[2]) / 2; }
          var cheek = [];
          for (var cx1 = at(0.20); cx1 < M * 0.32; cx1++)
            for (var cy1 = at(0.48); cy1 < M * 0.58; cy1++) cheek.push(redness(px2(cx1, cy1)));
          var cheekMed = median(cheek);
          if (cheekMed !== null) {
            var lipRows = 0, lipTot = 0;
            for (var lyy = at(0.62); lyy < M * 0.82; lyy++) {
              var hit = 0, wide = 0;
              for (var lxx = at(0.40); lxx < M * 0.60; lxx++) { wide++; if (redness(px2(lxx, lyy)) > cheekMed + 10) hit++; }
              lipTot++;
              if (wide && hit / wide > 0.45) lipRows++;
            }
            if (lipTot > 0 && lipRows > 0) {
              var lRatio = lipRows / lipTot;
              var lVal = lRatio < 0.18 ? 'thin' : (lRatio > 0.38 ? 'full' : 'normal');
              look.lips = lVal; derived.push('lips');
              found.push(lVal === 'normal' ? 'natural lips' : lVal + ' lips');
            }
          }

          /* NOSE WIDTH: the shaded span at the base of the nose, measured
             outward from the centre line and reduced by median across the
             rows. Scaled against the FACE width, not the frame, so a tight
             crop and a loose one give the same answer. */
          var mid = at(0.5), spans = [];
          for (var nyy = at(0.54); nyy < M * 0.62; nyy++) {
            /* the OUTERMOST shaded offset, not a contiguous run from the
               centre. The middle of a nose is the lit ridge - a contiguity
               scan starting there breaks on the first bright pixel and
               measures zero on every real face. The rows stop short of the
               mouth, which is darker than skin and is not a nose. */
            var half = 0;
            for (var off = 2; off < M * 0.22; off++) {
              if (lum2(px2(mid - off, nyy)) < skinL - 10 || lum2(px2(mid + off, nyy)) < skinL - 10) half = off;
            }
            if (half) spans.push(half * 2);
          }
          var noseMed = median(spans);
          if (noseMed) {
            var nRatio = noseMed / (M * 0.72);
            var nVal = nRatio < 0.17 ? 'button' : (nRatio > 0.26 ? 'wide' : 'straight');
            look.nose = nVal; derived.push('nose');
            found.push(nVal + ' nose');
          }

          /* TOP COLOUR: the strip below the chin. Taken only when it differs
             from BOTH the skin (or it is the neck) and the corner background
             (or it is the wall behind the doctor). A head-only crop fails one
             of those two and correctly keeps the scrub colour already chosen. */
          var tops = [];
          for (var sx = at(0.18); sx < M * 0.84; sx++) {
            if (sx > M * 0.38 && sx < M * 0.62) continue;        /* the chin and neck sit here */
            for (var sy = at(0.90); sy < M * 0.99; sy++) tops.push(px2(sx, sy));
          }
          if (tops.length) {
            tops.sort(function (p, q) { return lum2(p) - lum2(q); });
            var top = tops[Math.floor(tops.length / 2)];
            if (apart(top, skin, 34) && (!bg || apart(top, bg, 26))) {
              look.shirt = hex(top); derived.push('shirt');
              found.push('top colour');
            }
          }
          /* ---- THE SKULL --------------------------------------------------
             Everything above describes the paint. These describe the HEAD, and
             they all rest on one measurement: where the face ENDS. Scan inward
             from both edges at eye level until the pixels start looking like
             this face's own skin. If that fails - a background the same colour
             as the skin, a crop with no margin - the whole group declines
             together rather than each guessing from a bad width. */
          function chDist(a, b) { return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3; }
          function skinLike(p) {
            /* nearer the measured skin than the measured background. A fixed
               tolerance called a light wall skin and returned a face the full
               width of the frame - measured, not hypothetical. */
            if (!bg) return chDist(p, skin) < 30;
            return chDist(p, skin) < chDist(p, bg);
          }
          /* skinLike answers FACE OR BACKGROUND, where those are the only two
             options and a relative test is exactly right. Up on the crown
             there is a THIRD option - hair - and dark hair happens to sit
             nearer skin than it does a pale wall, so the relative test alone
             called a full head of hair a bare temple. Anything asking 'is
             this specifically skin' needs the absolute bound too. */
          function skinExact(p) { return chDist(p, skin) < 34 && skinLike(p); }
          function edgesAt(fy) {
            var y = at(fy), L = -1, R = -1, i;
            for (i = 0; i < M * 0.48; i++) if (skinLike(px2(i, y))) { L = i; break; }
            for (i = M - 1; i > M * 0.52; i--) if (skinLike(px2(i, y))) { R = i; break; }
            /* an edge ON the frame boundary is the face leaving the picture,
               not the face being that wide. Refuse. */
            if (L <= 0 || R >= M - 1) return null;
            return (L >= 0 && R > L) ? { L: L, R: R, w: R - L } : null;
          }
          var eyeEdges = edgesAt(0.45);
          if (eyeEdges && eyeEdges.w > M * 0.30) {
            var faceW = eyeEdges.w, eyeY = at(0.45);
            /* the chin: the last skin row down the centre line */
            var chinY = 0;
            for (var cy2 = at(0.60); cy2 < M; cy2++) if (skinLike(px2(mid, cy2))) chinY = cy2;
            /* the chin at the bottom row means the jaw is cropped off, so the
               lower-face height is a floor, not a measurement. Same refusal. */
            if (chinY >= M - 1) chinY = 0;
            var lowerH = chinY - eyeY;

            /* SHAPE. width over the LOWER face height - eyes to chin - because
               the upper bound of a face is hair, not bone. The three cut points
               are the ratios of the three heads faceSvg actually draws
               (oval 116/70 = 1.66, round 126/64 = 1.97, long 104/78 = 1.33),
               so a photo is being matched to the nearest head that exists
               rather than to a number invented here. */
            /* A BEARD HIDES THE JAW, AND WORSE, IT IMPERSONATES IT. skinLike
               is RELATIVE - nearer the measured skin than the measured
               background - and a dark beard on a light wall is nearer the
               skin, so the chin scan ran straight through the beard to its
               bottom edge and every bearded face measured LONG. That is a
               claimed shape, not a refusal: it overwrote whatever the doctor
               had chosen. There is no honest reading of a jaw that is under
               hair, so there is no reading. */
            if (lowerH > M * 0.18 && look.beard === 'none') {
              var shapeR = faceW / lowerH;
              var sVal = shapeR < 1.48 ? 'long' : (shapeR > 1.80 ? 'round' : 'oval');
              /* A SQUARE JAW OUTRANKS ALL THREE. It is not a proportion, it is
                 the face still being wide 62% of the way down to the chin -
                 the drawn oval has narrowed to 0.80 of its eye-level width by
                 there, so anything still above 0.88 is a jaw, not an oval. */
              var jawEdges = edgesAt(0.45 + (chinY - eyeY) * 0.62 / M);
              if (jawEdges && jawEdges.w / faceW > 0.88) sVal = 'square';
              look.faceShape = sVal; derived.push('faceShape');
              found.push(sVal === 'square' ? 'a square jaw' : sVal + ' face');
            }

            /* EYE SPACING. The darkest column inside each eye region is the
               iris. Measured against the SAME face's width, and compared with
               the spacing faceSvg draws by default (2 x 29 over a 116-wide
               head = 0.50), so the verdict names a head that exists. */
            function irisX(fx0, fx1) {
              /* THE DARK MASS, NOT THE DARKEST PIXEL. A solid iris has no
                 unique darkest pixel - JPEG ringing round its edge is as
                 dark as its centre - so 'the darkest pixel' is noise wearing
                 a measurement's clothes. Measured that way, three portraits
                 with byte-identical eyes came back close, normal and wide,
                 decided only by the skin colour around them. The centroid of
                 the whole dark mass does not move. */
              var sx = 0, sn = 0, lo = 1e9, hi = -1, ex, ey, L2;
              for (ex = at(fx0); ex < M * fx1; ex++)
                for (ey = at(0.42); ey < M * 0.48; ey++) {
                  L2 = lum2(px2(ex, ey));
                  if (L2 < skinL - 45) { sx += ex; sn++; if (ex < lo) lo = ex; if (ex > hi) hi = ex; }
                }
              /* AN IRIS IS COMPACT, AND A SPECTACLE FRAME IS NOT. The frame
                 is dark across the whole half of the face and was measured
                 as one enormous eye, so a bespectacled portrait returned an
                 eye spacing it had no way to see - and silently, because
                 eyeSet is in derived and 'normal' looks like a default. The
                 width test is the real gate here: it holds even on a frame
                 the glasses detector missed. */
              if (sn < 6 || (hi - lo + 1) > M * 0.14) return -1;
              return sx / sn;
            }
            /* and a second, independent gate on the flag the colour pass
               already raised - two gates, so a frame has to beat both. */
            var ixL = look.glasses ? -1 : irisX(0.25, 0.47);
            var ixR = look.glasses ? -1 : irisX(0.53, 0.75);
            if (ixL >= 0 && ixR > ixL) {
              var setR = (ixR - ixL) / faceW;
              var eVal = setR < 0.44 ? 'close' : (setR > 0.56 ? 'wide' : 'normal');
              look.eyeSet = eVal; derived.push('eyeSet');
              if (eVal !== 'normal') found.push(eVal + '-set eyes');
            }
          }

          /* A RECEDING HAIRLINE is bare TEMPLES with hair still on the crown -
             so it is read as exactly that contrast, and never on a head with no
             hair to recede from. Reading only the temples would call every bald
             head receding; reading only the crown could never see it at all. */
          if (look.hairStyle !== 'bald' && hair) {
            function bare(fx0, fx1) {
              var skinN = 0, tot = 0;
              for (var tx = at(fx0); tx < M * fx1; tx++)
                for (var ty = at(0.16); ty < M * 0.26; ty++) { tot++; if (skinExact(px2(tx, ty))) skinN++; }
              return tot ? skinN / tot : 0;
            }
            var tL = bare(0.28, 0.37), tR = bare(0.63, 0.72), crown = bare(0.44, 0.56);
            if (tL > 0.55 && tR > 0.55 && crown < 0.25) {
              look.hairline = 'receding'; derived.push('hairline');
              found.push('a receding hairline');
            }
          }
          /* `age` is NOT derived. Nasolabial folds and crow's feet are a few
             pixels of low-contrast texture at this resolution and are wiped out
             by ordinary lighting, so any verdict here would be a guess wearing
             a measurement's clothes - and guessing a doctor is old is the one
             wrong answer this feature must never volunteer. It stays a choice
             in Setup, which is why that control exists. */
        });
        return { look: look, found: found, derived: derived };
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
     a repeated question is instant, with a short circuit-breaker so an outage
     degrades to browser speech instead of stalling every question. ---- */
  var ttsCache = {}, ttsOrder = [], ttsDownUntil = 0, ttsAudioNow = null, ttsCtx = null, ttsRaf = 0;
  function ttsEnsureCtx() {
    if (ttsCtx) { safe(function () { if (ttsCtx.state === 'suspended') ttsCtx.resume(); }); return; }
    ttsCtx = safe(function () { var C = window.AudioContext || window.webkitAudioContext; return C ? new C() : null; }, null);
  }
  /* Split at the FIRST sentence boundary only, and only when there is real
     length to gain from it. A short line is already fast; splitting it would
     spend a second round trip to save nothing. */
  function ttsSplitForSpeech(text) {
    var t = String(text == null ? '' : text).trim();
    /* 28 chars, because the SHAPE this exists for is "Got it. How long has it
       been going on?" — a tiny acknowledgement in front of the real question.
       That acknowledgement is generated almost instantly, so the patient hears
       a voice while the question itself is still being made. A higher floor
       skipped exactly the case that matters most. */
    if (t.length < 28) return [t];
    var m = /^([^.!?]{4,150}[.!?])\s+(\S[\s\S]*)$/.exec(t);
    if (!m) return [t];
    var head = m[1].trim(), tail = m[2].trim();
    if (!head || !tail) return [t];
    /* AN ABBREVIATION IS NOT A SENTENCE END. "I think Dr. Smith should see
       you. How does that sound?" would otherwise be spoken as "I think
       Doctor." — pause — "Smith should see you...", which is worse than the
       latency the split saves: a change that makes the avatar sound broken is
       not an optimisation. Decimals ("3.5 weeks") are already safe because the
       match requires whitespace after the terminator; titles and initials are
       not, so they are named here. */
    if (/(?:^|\s)(?:[A-Za-z]|dr|drs|mr|mrs|ms|st|jr|sr|prof|rev|vs|approx|dept|est|fig|no|etc|e\.g|i\.e|a\.m|p\.m)\.$/i.test(head)) return [t];
    return [head, tail];
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
  function facePreviewNode(dataUrl, look) {
    var wrap = make('div', '');
    wrap.style.cssText = 'width:72px;height:72px;border-radius:999px;overflow:hidden;border:2px solid #E7E5DD;background:#F4F2EC;display:flex;align-items:center;justify-content:center;font-size:34px';
    if (dataUrl && String(dataUrl).indexOf('data:image/') === 0) {
      var img = document.createElement('img'); img.alt = ''; img.src = dataUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      wrap.appendChild(img);
    } else wrap.innerHTML = faceSvg(look || null); /* the drawn character, never a bare emoji */
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

      /* av-5.1.0: which face the kiosk wears once a photo exists */
      var faceModeLabel = make('label', '', 'Face style — what patients see in the office');
      var faceModeSelect = document.createElement('select');
      faceModeSelect.id = 'mlsAvFaceMode';
      faceModeSelect.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid #d7ded9;border-radius:10px;padding:9px 11px;font:13.5px \'Public Sans\',system-ui,sans-serif';
      [['drawn', 'Animated character — full facial expressions, tinted from your photo'], ['photo', 'My stylized photo — looks like me, moves as one piece']].forEach(function (opt) {
        var o = document.createElement('option'); o.value = opt[0]; o.textContent = opt[1];
        if ((cfg.faceMode || 'drawn') === opt[0]) o.selected = true;
        faceModeSelect.appendChild(o);
      });

      /* av-5.3.0 — THE APPEARANCE STUDIO. "Match my photo" derives the look
         from the portrait the doctor captured; every part is then editable by
         hand, with the real animated face previewing every change live. */
      var lookNow = faceLookSafe(cfg.faceLook || null);
      var lookLabel = make('label', '', 'Appearance — build the face patients meet');
      var lookWrap = make('div', '');
      lookWrap.style.cssText = 'display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;border:1px solid #E7E5DD;border-radius:14px;padding:12px;background:#FAF9F5';
      var lookStage = make('div', '');
      lookStage.id = 'mlsAvLookStage';
      lookStage.style.cssText = 'width:132px;height:132px;border-radius:999px;overflow:hidden;background:radial-gradient(circle at 50% 38%,#fff,#f2f4ef);border:3px solid #fff;box-shadow:0 8px 24px rgba(32,64,52,.16);flex:0 0 auto';
      var lookCtl = null;
      var lookGrid = make('div', '');
      lookGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;flex:1;min-width:220px';
      function lookApply() { if (lookCtl) safe(function () { lookCtl.retint(lookNow); }); }
      function lookRow(labelText, node) {
        var row = make('div', '');
        row.style.cssText = 'display:flex;flex-direction:column;gap:3px';
        var l = make('span', '', labelText);
        l.style.cssText = 'font:600 11.5px system-ui;color:#69736d';
        row.appendChild(l); row.appendChild(node);
        lookGrid.appendChild(row);
        return row;
      }
      function colourControl(key, labelText) {
        var input = document.createElement('input');
        input.type = 'color'; input.value = lookNow[key];
        input.id = 'mlsAvLook_' + key;
        input.style.cssText = 'width:100%;height:32px;border:1px solid #d7ded9;border-radius:8px;background:#fff;padding:2px;cursor:pointer';
        input.addEventListener('input', function () { lookNow[key] = input.value; lookApply(); });
        lookRow(labelText, input);
        return input;
      }
      function pickControl(key, labelText, options) {
        var sel = document.createElement('select');
        sel.id = 'mlsAvLook_' + key;
        sel.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid #d7ded9;border-radius:8px;padding:7px 8px;font:12.5px system-ui;background:#fff';
        options.forEach(function (opt) {
          var o = document.createElement('option'); o.value = opt[0]; o.textContent = opt[1];
          if (lookNow[key] === opt[0]) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () { lookNow[key] = sel.value; lookApply(); });
        lookRow(labelText, sel);
        return sel;
      }
      var skinPick = colourControl('skin', 'Skin');
      var hairPick = colourControl('hair', 'Hair');
      var eyesPick = colourControl('eyes', 'Eyes');
      var lipPick = colourControl('lip', 'Lip colour');
      colourControl('shirt', 'Scrubs / top');
      var stylePick = pickControl('hairStyle', 'Hair', [['short', 'Short'], ['wavy', 'Wavy'], ['long', 'Long'], ['bun', 'Tied back'], ['buzz', 'Buzzed'], ['bald', 'None']]);
      var beardPick = pickControl('beard', 'Facial hair', [['none', 'Clean-shaven'], ['stubble', 'Stubble'], ['beard', 'Beard']]);
      var browColWell = null;
      var browsPick = pickControl('brows', 'Eyebrows', [['thin', 'Thin'], ['normal', 'Natural'], ['thick', 'Thick']]);
      var nosePick = pickControl('nose', 'Nose', [['button', 'Button'], ['straight', 'Straight'], ['wide', 'Wide'], ['roman', 'Roman']]);
      var lipsPick = pickControl('lips', 'Lips', [['thin', 'Thin'], ['normal', 'Natural'], ['full', 'Full']]);
      /* THE HEAD ITSELF. faceSvg has drawn these since the same release that
         added them, and until now nothing could ask for one: no control here,
         no derivation from the photo. Correct behaviour the doctor cannot
         reach is indistinguishable from behaviour that was never built. */
      var shapePick = pickControl('faceShape', 'Face shape', [['oval', 'Oval'], ['round', 'Round'], ['long', 'Long'], ['square', 'Square jaw']]);
      var eyeSetPick = pickControl('eyeSet', 'Eye spacing', [['close', 'Close-set'], ['normal', 'Natural'], ['wide', 'Wide-set']]);
      var hairlinePick = pickControl('hairline', 'Hairline', [['full', 'Full'], ['receding', 'Receding']]);
      var agePick = pickControl('age', 'Face lines', [['adult', 'Smooth'], ['mature', 'Mature']]);
      var browColPick = pickControl('browCol', 'Eyebrow colour', [['', 'Same as hair']]);
      /* the brow colour is a COLOUR, but its neutral value is the empty string
         (follow the hair) and a native colour input cannot express "none". So
         it is a select with one option plus a real colour well beside it, and
         choosing a colour is what leaves the follow-the-hair default. */
      (function () {
        var well = document.createElement('input');
        well.type = 'color'; well.id = 'mlsAvLook_browColWell';
        well.value = lookNow.browCol || lookNow.hair;
        well.style.cssText = 'width:100%;height:28px;border:1px solid #d7ded9;border-radius:8px;background:#fff;padding:2px;cursor:pointer;margin-top:4px';
        well.addEventListener('input', function () {
          lookNow.browCol = well.value;
          if (browColPick.options.length < 2) {
            var o = document.createElement('option'); o.value = 'set'; o.textContent = 'Its own colour';
            browColPick.appendChild(o);
          }
          browColPick.value = 'set';
          lookApply();
        });
        browColPick.addEventListener('change', function () {
          lookNow.browCol = browColPick.value === 'set' ? well.value : '';
          lookApply();
        });
        browColPick.parentNode.appendChild(well);
        browColWell = well;
      }());
      /* the OPTIONAL accessories - same control pattern as the existing glasses
         box, all defaulting off, all whitelisted in faceLookSafe */
      function toggleControl(key, labelText) {
        var wrap = make('label', '');
        wrap.style.cssText = 'display:flex;align-items:center;gap:7px;font:600 12.5px system-ui;color:#204034;margin-top:16px';
        var box = document.createElement('input');
        box.type = 'checkbox'; box.id = 'mlsAvLook_' + key; box.checked = lookNow[key] === true;
        box.addEventListener('change', function () { lookNow[key] = box.checked; lookApply(); });
        wrap.appendChild(box); wrap.appendChild(document.createTextNode(labelText));
        lookGrid.appendChild(wrap);
        return box;
      }
      var glassesBox = toggleControl('glasses', 'Glasses');
      var capBox = toggleControl('cap', 'Surgical cap');
      var stethBox = toggleControl('stethoscope', 'Stethoscope');
      var lookActions = make('div', 'mlsAvActions');
      lookActions.style.marginTop = '4px';
      var matchBtn = make('button', 'mlsAvAction', '🪄 Match my photo');
      matchBtn.type = 'button';
      var lookNote = make('div', 'mlsAvMeta', '');
      matchBtn.addEventListener('click', function () {
        var src = pendingFace === undefined ? (cfg.faceImage || '') : pendingFace;
        if (!src) { lookNote.textContent = 'Capture your photo above first, then Match my photo.'; return; }
        lookNote.textContent = 'Reading your photo…';
        faceTintFromPortrait(src, function (res) {
          var look = res && res.look;
          if (!look) { lookNote.textContent = 'That photo was too dark or too flat to read - set the colours by hand.'; return; }


          /* APPLY EXACTLY WHAT THE PHOTO ANSWERED, AND NOTHING ELSE.
             res.derived names the knobs that were really measured; every other
             knob keeps the value the doctor set. That single rule replaces the
             hand-maintained keep-list this used to carry, which is what made
             Match feel broken: brow weight, nose and lip shape were listed as
             unreadable and pinned back to their defaults on every run, so the
             drawn face could not move toward the photo no matter how good the
             photo was. A cap and a stethoscope are still never touched -
             they are not in `derived` because no portrait can decide them. */
          var got = (res && res.derived) || [];
          var merged = {};
          Object.keys(FACE_LOOK).forEach(function (k) {
            merged[k] = (got.indexOf(k) >= 0 && look[k] !== undefined) ? look[k] : lookNow[k];
          });
          lookNow = faceLookSafe(merged);
          skinPick.value = lookNow.skin; hairPick.value = lookNow.hair; eyesPick.value = lookNow.eyes;
          lipPick.value = lookNow.lip;
          stylePick.value = lookNow.hairStyle; beardPick.value = lookNow.beard;
          browsPick.value = lookNow.brows; nosePick.value = lookNow.nose; lipsPick.value = lookNow.lips;
          shapePick.value = lookNow.faceShape; eyeSetPick.value = lookNow.eyeSet;
          hairlinePick.value = lookNow.hairline; agePick.value = lookNow.age;
          if (lookNow.browCol) {
            if (browColPick.options.length < 2) {
              var bo = document.createElement('option'); bo.value = 'set'; bo.textContent = 'Its own colour';
              browColPick.appendChild(bo);
            }
            browColPick.value = 'set';
            if (browColWell) browColWell.value = lookNow.browCol;
          } else { browColPick.value = ''; }
          glassesBox.checked = lookNow.glasses === true;
          capBox.checked = lookNow.cap === true;
          stethBox.checked = lookNow.stethoscope === true;
          lookApply();
          /* say what it actually saw - a silent generic face is exactly what
             "it straight up does not work" looks like from the doctor's side */
          var found = (res && res.found && res.found.length) ? res.found.join(', ') : '';
          lookNote.textContent = found
            ? ('Matched from your photo - detected ' + found + '. Adjust anything above to fine-tune.')
            : 'Matched from your photo - adjust anything above to fine-tune.';
        });
      });
      var moodBtn = make('button', 'mlsAvAction', '🙂 See the expressions');
      moodBtn.type = 'button';
      moodBtn.addEventListener('click', function () {
        if (!lookCtl) return;
        var reel = [['happy', 'Greeting - a real smile, all the way to the eyes'],
          ['listening', 'Listening - eye contact, and it nods'],
          ['curious', 'Curious - one brow up'],
          ['thinking', 'Thinking - the gaze drifts up and away'],
          ['caring', 'When it hurts - the brows knit and the head shakes'],
          ['idle', 'Resting - breathing']], i = 0;
        (function step() {
          if (i >= reel.length) { lookCtl.mood('idle', false, false); lookNote.textContent = ''; return; }
          var m = reel[i++];
          if (m[0] === 'curious') {
            lookCtl.mood('listening', false, false);
            safe(function () { lookCtl.curious(); });
          } else {
            lookCtl.mood(m[0] === 'happy' || m[0] === 'caring' ? 'speaking' : m[0], m[0] === 'caring', m[0] === 'happy');
          }
          lookNote.textContent = m[1];
          setTimeout(step, 1700);
        })();
      });
      lookActions.appendChild(matchBtn); lookActions.appendChild(moodBtn);
      lookWrap.appendChild(lookStage); lookWrap.appendChild(lookGrid);

      /* av-5.1.0: the kiosk exit PIN — End interview asks for it, so a
         patient holding the screen cannot exit into the app */
      var pinLabel = make('label', '', 'Kiosk exit PIN — required to end an office interview (4-8 digits; blank = off)');
      var pinInput = make('input');
      pinInput.id = 'mlsAvExitPin';
      pinInput.type = 'password'; pinInput.autocomplete = 'off'; pinInput.maxLength = 8;
      pinInput.setAttribute('inputmode', 'numeric');
      pinInput.placeholder = 'e.g. 2468';
      pinInput.value = cfg.exitPin || '';

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
      [['coral', 'Coral (female) - warm & caring (default)'], ['nova', 'Nova (female) - bright & upbeat'], ['shimmer', 'Shimmer (female) - soft & gentle'], ['sage', 'Sage (female) - calm & steady'], ['ash', 'Ash (male) - deep & reassuring'], ['echo', 'Echo (male) - clear & even'], ['onyx', 'Onyx (male) - rich & low'], ['alloy', 'Alloy (neutral) - balanced']].forEach(function (opt) {
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
        /* The server DROPS a malformed PIN to '' by design. Saving silently and
           reporting success let a doctor type "123", believe the kiosk was
           locked, and run it unlocked — so refuse here instead. */
        var wantPin = pinInput.value.trim();
        if (wantPin && !/^\d{4,8}$/.test(wantPin)) {
          status.textContent = 'The exit PIN must be 4 to 8 digits — nothing was saved.';
          safe(function () { pinInput.focus(); });
          return;
        }
        saveBtn.disabled = true; status.textContent = 'Saving…';
        api('/api/avatar/config', { method: 'POST', body: JSON.stringify({ name: nameInput.value.trim() || 'Ava', intro: introInput.value.trim(), questions: questions,
          tone: toneSelect.value,
          voice: voiceSelect.value,
          faceMode: faceModeSelect.value,
          faceLook: lookNow,
          exitPin: pinInput.value.trim(),
          faceImage: pendingFace === undefined ? (cfg.faceImage || '') : pendingFace }) })
          .then(function (r2) {
            saveBtn.disabled = false;
            if (r2.ok && r2.json && r2.json.ok) {
              /* read the AUTHORITATIVE echo — what the server actually stored */
              var saved = r2.json.config || {};
              pinInput.value = saved.exitPin || '';
              status.textContent =
                (questions.length ? ('Saved — the avatar now asks ' + questions.length + ' question' + (questions.length === 1 ? '' : 's') + '. Patients see it in their portal.') : 'Saved, but with no questions the check-in stays OFF for patients.') +
                (saved.exitPin ? ' Kiosk exit PIN is set.' : ' No exit PIN — “End interview” closes straight into your app.');
            } else status.textContent = 'Could not save — check your connection and try again.';
          }, function () { saveBtn.disabled = false; status.textContent = 'Could not save — check your connection and try again.'; });
      });
      /* av-5.3.0 — the typed rehearsal log is GONE by owner order ("GET RIDE
         OF THEAT AWEFUL ... BUTTON ON THE OLD AWERFUL SYSTEM"). It demoed a
         chat transcript the voice product no longer resembles. The real thing
         is one tap away: Visit → Start check-in interview. */

      form.appendChild(section('1 · Identity', 'Who greets your patients — the name, the tone, and your face.'));
      form.appendChild(nameLabel); form.appendChild(nameInput);
      form.appendChild(introLabel); form.appendChild(introInput);
      form.appendChild(toneLabel); form.appendChild(toneSelect);
      form.appendChild(voiceLabel); form.appendChild(voiceRow);
      form.appendChild(faceLabel); form.appendChild(faceRow); form.appendChild(camHost);
      form.appendChild(faceModeLabel); form.appendChild(faceModeSelect);
      form.appendChild(lookLabel); form.appendChild(lookWrap);
      form.appendChild(lookActions); form.appendChild(lookNote);
      form.appendChild(pinLabel); form.appendChild(pinInput);
      form.appendChild(section('2 · Questions', 'Asked in order. The avatar adds its own smart follow-ups when an answer needs detail.'));
      form.appendChild(qList); form.appendChild(addQBtn);
      form.appendChild(starterNote); form.appendChild(starters);
      form.appendChild(section('3 · Save', 'Save, then try the real thing: open a patient, go to Visit, and tap “Start check-in interview”.'));
      var btnRow = make('div', 'mlsAvActions');
      btnRow.appendChild(saveBtn);
      form.appendChild(btnRow); form.appendChild(status);
      host.appendChild(form);
      /* mount the living preview only once the form is in the document, so the
         face measures and animates from its first frame */
      lookCtl = makeFace(lookStage, lookNow);
      if (lookCtl) lookCtl.mood('idle', false, true);
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
      '#mlsAvKioskFace img{width:100%;height:100%;object-fit:cover}' +
      '#mlsAvKioskFace svg{animation:mlsAvKBreathe 4.5s ease-in-out infinite}' +
      '@keyframes mlsAvKBreathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(1.5px) scale(1.008)}}' +
      '#mlsAvKioskPin{display:none;position:absolute;inset:0;background:rgba(20,28,24,.55);align-items:center;justify-content:center;z-index:5}' +
      '#mlsAvKioskPinCard{background:#fff;border-radius:18px;padding:26px 30px;display:flex;flex-direction:column;gap:10px;box-shadow:0 24px 70px rgba(0,0,0,.35);min-width:min(340px,86vw)}' +
      '#mlsAvKioskPinTitle{font:800 17px \'Public Sans\',system-ui;color:#204034}' +
      '#mlsAvKioskPinSub{font:500 13px system-ui;color:#55605A}' +
      '#mlsAvKioskPinInput{border:1px solid #cfd9d2;border-radius:12px;padding:12px;font:700 22px system-ui;letter-spacing:8px;text-align:center}' +
      '#mlsAvKioskPinMsg{font:600 12.5px system-ui;color:#a33d2b;min-height:16px}' +
      '#mlsAvKioskPinRow{display:flex;gap:10px;flex-wrap:wrap}' +
      '#mlsAvKioskPinGo{border:0;border-radius:999px;padding:12px 20px;background:#2E6A4B;color:#fff;font:700 14px system-ui;cursor:pointer}' +
      '#mlsAvKioskPinBack{border:1px solid #cfd9d2;border-radius:999px;padding:12px 20px;background:#fff;color:#204034;font:600 14px system-ui;cursor:pointer}' +
      '#mlsAvKioskTypeRow{display:none;gap:10px;width:min(720px,90vw)}' +
      '#mlsAvKioskTypeRow textarea{flex:1;border:1px solid #cfd9d2;border-radius:16px;padding:14px;font:2.2vh system-ui;resize:none}' +
      '#mlsAvKioskTypeRow button{border:0;border-radius:999px;padding:0 26px;background:#204034;color:#fff;font:700 2.1vh system-ui;cursor:pointer}' +
      '#mlsAvKioskPinNote{font:500 12px/1.45 system-ui;color:#55605A;max-width:340px}' +
      /* AMBIENT ROOM MODE disclosure. It is CSS-driven off ONE class on the
         root, so "is it recording" and "does the screen say so" are the same
         fact and cannot drift apart. Never a toast: a toast fades, and the
         patient consented to intake questions, not to an exam being taped. */
      '#mlsAvKioskRec{display:none;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;font:800 2.1vh system-ui;color:#7a1f16;background:#fff;border:2px solid #c0392b;border-radius:999px;padding:1.2vh 2.6vh;box-shadow:0 6px 22px rgba(192,57,43,.18);max-width:min(920px,92vw);text-align:center}' +
      '#mlsAvKiosk.ambient #mlsAvKioskRec{display:flex}' +
      '#mlsAvKiosk.ambient #mlsAvKioskMic{display:none}' +
      '#mlsAvKiosk.ambient{background:linear-gradient(165deg,#F8F1EF,#F2E4E1 55%,#EAD9D5)}' +
      '#mlsAvKioskRec i{width:1.6vh;height:1.6vh;min-width:13px;min-height:13px;border-radius:999px;background:#c0392b;animation:mlsAvKRing 1.4s ease-in-out infinite}' +
      '#mlsAvKioskRecClock{font:700 1.9vh ui-monospace,SFMono-Regular,Menlo,monospace;color:#55605A;letter-spacing:.4px}' +
      /* av-5.6.0 - the save state rides INSIDE the recording disclosure, so
         "recording" and "backed up" are read in one glance and neither can be
         on screen without the other. */
      /* THE AI DISCLOSURE. Permanent, in both modes, and never smaller than
         the interim line - a screen wearing the doctor's face must say what
         it is at a glance, not in fine print. */
      '#mlsAvKioskState{font:800 1.7vh system-ui;letter-spacing:.4px;text-transform:uppercase;color:#55605A;background:#fff;border:1px solid #cfd9d2;border-radius:999px;padding:.45vh 1.6vh}' +
      '#mlsAvKioskState[data-state="listening"]{color:#26417a;border-color:#26417a}' +
      '#mlsAvKioskState[data-state="speaking"]{color:#2E6A4B;border-color:#2E6A4B}' +
      '#mlsAvKioskState[data-state="documenting"]{color:#7a1f16;border-color:#c0392b}' +
      '#mlsAvKioskState[data-state="saving"],#mlsAvKioskState[data-state="paused"]{color:#204034;border-color:#204034}' +
      '#mlsAvKioskAi{font:700 1.85vh/1.4 system-ui;color:#55605A;background:#fff;border:1px solid #cfd9d2;border-radius:999px;padding:.7vh 2vh;max-width:min(760px,92vw);margin-top:-.4vh}' +
      /* mute/pause, top-LEFT so it can never be hit while reaching for End */
      '#mlsAvKioskMute{position:absolute;top:14px;left:16px;border:1px solid #cfd9d2;background:#fff;color:#204034;border-radius:999px;padding:10px 18px;font:700 13px system-ui;cursor:pointer;z-index:6}' +
      '#mlsAvKioskMute[aria-pressed="true"]{background:#7a1f16;color:#fff;border-color:#7a1f16}' +
      /* PAUSED: the red dot stops, the banner goes grey, and nothing on this
         screen still implies a live microphone. */
      '#mlsAvKiosk.paused #mlsAvKioskRec{border-color:#cfd9d2;color:#55605A}' +
      '#mlsAvKiosk.paused #mlsAvKioskRec i{animation:none;background:#69736d}' +
      '#mlsAvKiosk.paused #mlsAvKioskMic{display:none}' +
      '#mlsAvKiosk.paused #mlsAvKioskWave{visibility:hidden}' +
      '#mlsAvKioskSave{font:700 1.6vh system-ui;font-style:normal;padding:.4vh 1.4vh;border-radius:999px;background:#EAF1EC;color:#204034}' +
      '#mlsAvKioskSave[data-state="bad"]{background:#F7E4E1;color:#7a1f16}' +
      '#mlsAvKiosk.saving #mlsAvKioskSave{background:#EDE7D6;color:#55605A}' +
      /* ONE end control during a capture. The interview-era button is hidden
         rather than left beside it: two ways to end a visit is one too many. */
      '#mlsAvKioskEndVisit{display:none;position:absolute;top:14px;right:16px;border:0;background:#204034;color:#fff;border-radius:999px;padding:12px 22px;font:800 14px system-ui;cursor:pointer;box-shadow:0 8px 26px rgba(32,64,52,.28);z-index:6}' +
      '#mlsAvKiosk.ambient #mlsAvKioskEndVisit{display:block}' +
      '#mlsAvKiosk.ambient #mlsAvKioskEnd{display:none}' +
      '#mlsAvKioskEndVisit:hover{background:#2E6A4B}' +
      /* the orders widget: compact, corner-mounted, never over the face, and
         absent entirely when there is nothing to confirm */
      '#mlsAvKioskOrders{display:none;position:absolute;right:16px;bottom:16px;width:min(370px,92vw);max-height:52vh;overflow:auto;background:#fff;border:1px solid #cfd9d2;border-radius:16px;box-shadow:0 14px 44px rgba(32,64,52,.2);padding:12px 13px;text-align:left;z-index:6}' +
      '#mlsAvKioskOrders .mlsAvOrdHead{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px}' +
      '#mlsAvKioskOrders .mlsAvOrdTitle{font:800 13px \'Public Sans\',system-ui;color:#204034}' +
      '#mlsAvKioskOrders .mlsAvOrdCount{font:700 11.5px system-ui;color:#55605A}' +
      '#mlsAvKioskOrders .mlsAvOrd{border:1px solid #E7E5DD;border-radius:12px;padding:9px 10px;margin-bottom:8px;background:#FCFBF8}' +
      '#mlsAvKioskOrders .mlsAvOrd[data-kind="medication"]{border-color:#e0cfc8}' +
      '#mlsAvKioskOrders .mlsAvOrdTop{display:flex;align-items:baseline;justify-content:space-between;gap:8px}' +
      '#mlsAvKioskOrders .mlsAvOrdTop b{font:800 13.5px \'Public Sans\',system-ui;color:#1A211C}' +
      '#mlsAvKioskOrders .mlsAvOrdKind{font:700 10.5px system-ui;color:#55605A;text-transform:uppercase;letter-spacing:.5px}' +
      '#mlsAvKioskOrders .mlsAvOrdDet{font:600 12.5px system-ui;color:#204034;margin-top:2px}' +
      '#mlsAvKioskOrders .mlsAvOrdHeard{font:italic 500 11.5px/1.4 system-ui;color:#69736d;margin-top:5px}' +
      '#mlsAvKioskOrders .mlsAvOrdMiss{font:700 11.5px/1.4 system-ui;color:#7a1f16;background:#F7E4E1;border-radius:8px;padding:5px 7px;margin-top:6px}' +
      '#mlsAvKioskOrders .mlsAvOrdFix{font:600 11.5px/1.4 system-ui;color:#26417a;margin-top:4px}' +
      '#mlsAvKioskOrders .mlsAvOrdOk{font:700 11.5px/1.4 system-ui;color:#2E6A4B;margin-top:5px}' +
      '#mlsAvKioskOrders .mlsAvOrdSide{display:flex;gap:6px;margin-top:6px}' +
      '#mlsAvKioskOrders .mlsAvOrdPick{flex:1;border:1px solid #cfd9d2;background:#fff;color:#204034;border-radius:9px;padding:7px 4px;font:700 12px system-ui;cursor:pointer}' +
      '#mlsAvKioskOrders .mlsAvOrdPick:hover{border-color:#2E6A4B;color:#2E6A4B}' +
      '#mlsAvKioskOrders .mlsAvOrdRow{display:flex;gap:6px;margin-top:8px}' +
      '#mlsAvKioskOrders .mlsAvOrdEdRow{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}' +
      '#mlsAvKioskOrders .mlsAvOrdEdIn{flex:1 1 100%;border:1px solid #2E6A4B;border-radius:9px;padding:8px 9px;font:600 12.5px system-ui;color:#1A211C}' +
      '#mlsAvKioskOrders .mlsAvOrdGo{flex:1;border:0;background:#2E6A4B;color:#fff;border-radius:9px;padding:8px 6px;font:800 12.5px system-ui;cursor:pointer}' +
      '#mlsAvKioskOrders .mlsAvOrdGo:disabled{background:#cfd9d2;color:#55605A;cursor:not-allowed}' +
      '#mlsAvKioskOrders .mlsAvOrdEdit,#mlsAvKioskOrders .mlsAvOrdNo{border:1px solid #cfd9d2;background:#fff;color:#55605A;border-radius:9px;padding:8px 10px;font:700 12.5px system-ui;cursor:pointer}' +
      '#mlsAvKioskOrders .mlsAvOrdFoot{font:600 10.8px/1.45 system-ui;color:#69736d;border-top:1px solid #E7E5DD;padding-top:7px;margin-top:2px}' +
      /* the review: one screen, one verdict, and the pending list said out
         loud rather than quietly omitted */
      '#mlsAvKioskReview{display:none;position:absolute;inset:0;background:rgba(20,28,24,.62);align-items:center;justify-content:center;z-index:8;padding:4vh 4vw}' +
      '#mlsAvKioskReview .mlsAvRevCard{background:#fff;border-radius:20px;padding:24px 26px;width:min(620px,94vw);max-height:88vh;overflow:auto;text-align:left;box-shadow:0 28px 80px rgba(0,0,0,.38)}' +
      '#mlsAvKioskReview .mlsAvRevHead{font:800 20px \'Public Sans\',system-ui;margin-bottom:8px}' +
      '#mlsAvKioskReview .mlsAvRevHead.ok{color:#2E6A4B}' +
      '#mlsAvKioskReview .mlsAvRevHead.bad{color:#7a1f16}' +
      '#mlsAvKioskReview .mlsAvRevLine{font:600 13.5px/1.5 system-ui;color:#204034}' +
      '#mlsAvKioskReview .mlsAvRevWarn{font:700 12.5px/1.5 system-ui;color:#7a1f16;background:#F7E4E1;border-radius:10px;padding:9px 11px;margin-top:10px}' +
      '#mlsAvKioskReview .mlsAvRevSub{font:800 12.5px system-ui;color:#204034;margin-top:14px}' +
      '#mlsAvKioskReview .mlsAvRevSub.bad{color:#7a1f16}' +
      '#mlsAvKioskReview .mlsAvRevList{margin:6px 0 0;padding-left:20px;font:600 13px/1.6 system-ui;color:#1A211C}' +
      '#mlsAvKioskReview .mlsAvRevList.bad{color:#7a1f16}' +
      '#mlsAvKioskReview .mlsAvRevNote{font:700 13px/1.5 system-ui;color:#204034;background:#EAF1EC;border-radius:10px;padding:10px 12px;margin-top:14px}' +
      '#mlsAvKioskReview .mlsAvRevNote.ok{color:#2E6A4B}' +
      '#mlsAvKioskReview .mlsAvRevNote.bad{color:#7a1f16;background:#F7E4E1}' +
      '#mlsAvKioskReview .mlsAvRevRow{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}' +
      '#mlsAvKioskReview .mlsAvRevGo{border:0;background:#2E6A4B;color:#fff;border-radius:999px;padding:12px 24px;font:800 14px system-ui;cursor:pointer}' +
      '#mlsAvKioskReview .mlsAvRevMore{border:1px solid #cfd9d2;background:#fff;color:#204034;border-radius:999px;padding:12px 22px;font:700 14px system-ui;cursor:pointer}' +
      '@media (max-width:720px){#mlsAvKioskOrders{right:8px;left:8px;bottom:8px;width:auto;max-height:44vh}}' +
      '@keyframes mlsAvKSpeak{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}' +
      '@keyframes mlsAvKLean{0%,100%{transform:rotate(0deg)}50%{transform:rotate(1.6deg)}}' +
      '@keyframes mlsAvKThink{0%,100%{transform:translateY(0)}50%{transform:translateY(-1vh)}}' +
      '@keyframes mlsAvKRing{0%,100%{opacity:.45}50%{opacity:1}}' +
      '@media (prefers-reduced-motion: reduce){#mlsAvKiosk *,#mlsAvKiosk.speaking #mlsAvKioskFace,#mlsAvKiosk.listening #mlsAvKioskFace,#mlsAvKiosk.thinking #mlsAvKioskFace{animation:none!important}}';
    (document.head || document.documentElement).appendChild(st);
  }
  /* av-5.6.7 — ONE STATE CHIP. The kiosk already carried its state in half a
     dozen places: a class on the root, a mic pill, a recording banner, a save
     badge. Each is true, but a doctor glancing over has to assemble the answer
     from four elements, and "what is it doing right now" is the question the
     screen should answer without being read. The chip is derived inside
     kioskMood — the same call that sets the classes — so what the screen SAYS
     and what the kiosk IS cannot drift apart. */
  var KIOSK_STATES = {
    ready: 'Ready', listening: 'Listening', speaking: 'Speaking', thinking: 'Thinking',
    /* the headline behaviour: the microphone is open WHILE the question plays,
       so the chip must be able to say both rather than picking one and lying */
    duplex: 'Speaking · listening',
    documenting: 'Ambiently documenting', saving: 'Saving', paused: 'Paused'
  };
  function kioskState(name) {
    var el = gid('mlsAvKioskState');
    if (!el) return;
    el.textContent = KIOSK_STATES[name] || KIOSK_STATES.ready;
    el.setAttribute('data-state', name);
  }
  function kioskMood(state, say, answer) {
    var root = gid('mlsAvKiosk'); if (!root) return;
    /* paused and documenting OUTRANK the momentary mood: a paused kiosk is
       paused whatever it was last doing, and a room capture is documenting
       even while the face is animating a listen. */
    kioskState(kiosk.paused ? 'paused' : (kiosk.ambient ? 'documenting' :
      (KIOSK_STATES[state] ? state : 'ready')));
    ['speaking', 'listening', 'thinking', 'caring', 'happy'].forEach(function (c) { root.classList.remove(c); });
    var caring = /pain|hurt|worse|can't|cannot|scared|worried|sad|tired|sick/i.test(String(answer || '') + ' ' + String(say || ''));
    var happy = /thank|welcome|great|wonderful|glad|nice|perfect|all set|covers everything|see you|good (morning|afternoon|evening)|hi[!,. ]|hello/i.test(String(say || ''));
    if (state === 'speaking') { root.classList.add('speaking'); if (caring) root.classList.add('caring'); else if (happy) root.classList.add('happy'); }
    else if (state === 'listening') { root.classList.add('listening'); if (caring) root.classList.add('caring'); }
    else if (state === 'thinking') root.classList.add('thinking');
    /* the FACE carries the emotion now: brows, eyes, mouth, head tilt */
    if (kiosk.face) kiosk.face.mood(state, caring, happy);
  }
  function kioskClose(reason) {
    pvStopVoice();
    if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
    if (kiosk.deadTimer) { safe(function () { clearTimeout(kiosk.deadTimer); }); kiosk.deadTimer = null; }
    kiosk.open = false; kiosk.busy = false;
    if (kiosk.face) { safe(function () { kiosk.face.destroy(); }); kiosk.face = null; }
    safe(function () { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {}); });
    var node = gid('mlsAvKiosk'); if (node && node.parentNode) node.parentNode.removeChild(node);
    /* the recording stops with the overlay, and the captured words go with
       it - they can never cross into the next patient's session */
    kiosk.ambient = false; kiosk.ambRec = null;
    kioskAmbientClear();
    kiosk.ambParts = []; kiosk.ambLast = ''; kiosk.ambBound = ''; kiosk.intake = [];
    kiosk.ambActions = []; kiosk.ambWindow = ''; kiosk.ambClosing = false; kiosk.ambEnding = false;
    kiosk.paused = false;
    if (reason === 'done' || kiosk.completed) {
      refreshCount(true);
      safe(function () { if (isFn(window.toast)) window.toast('Check-in complete — the highlights are on the Visit page.', 'ok'); });
    }
    kiosk.completed = false;
  }
  function kioskSetSay(text) { var el = gid('mlsAvKioskSay'); if (el) el.textContent = String(text || ''); }
  /* av-5.6.0 - WHAT THE CHART ALREADY KNOWS. An MA who has read the chart does
     not make the patient recite the allergy list the chart already carries.
     Built ONLY from the exact chart this interview is bound to - exactPatient
     fails closed on an unknown or ambiguous external id, so an unresolvable
     patient sends no context rather than the wrong patient's. Computed once
     per interview: the chart does not change while the patient is answering,
     and rebuilding it per turn would put roster work on the latency path. */
  function kioskChartContext() {
    var p = safe(function () { return exactPatient(kiosk.ext); }, null);
    if (!p) return null;
    function listOf(value, cap) {
      var text = '';
      if (Array.isArray(value)) {
        text = value.map(function (x) {
          return clean(typeof x === 'string' ? x : (x && (x.name || x.text || x.label || x.description)));
        }).filter(Boolean).join(', ');
      } else text = clean(value).replace(/\s*[\r\n]+\s*/g, ', ');
      return text.replace(/\s+/g, ' ').trim().slice(0, cap);
    }
    var ctx = {};
    var dob = clean(p.dob);
    if (dob) {
      var years = safe(function () {
        var d = new Date(dob.indexOf('T') < 0 ? dob + 'T00:00:00Z' : dob);
        if (isNaN(d.getTime())) return 0;
        var age = Math.floor((Date.now() - d.getTime()) / 31557600000);
        return (age > 0 && age < 130) ? age : 0;
      }, 0);
      if (years) ctx.age = String(years);
    }
    var sex = clean(p.sex || p.gender); if (sex) ctx.sex = sex.slice(0, 20);
    var reason = clean(p.visitReason || p.reason || p.apptReason);
    if (reason) ctx.visitReason = reason.slice(0, 200);
    var allergies = listOf(p.allergies, 240); if (allergies) ctx.allergies = allergies;
    var meds = listOf(p.meds || p.medications, 400); if (meds) ctx.medications = meds;
    var problems = listOf(p.problems, 400); if (problems) ctx.problems = problems;
    for (var k in ctx) { if (Object.prototype.hasOwnProperty.call(ctx, k)) return ctx; }
    return null;
  }
  function kioskTurn(answer, nonce, finish) {
    if (!kiosk.open || kiosk.busy) return;
    /* A FINISHED interview accepts nothing more. The typed row stays on screen
       in mic-off mode, so without this a patient could Send into a completed
       session: the server answers "this check-in is already complete", which
       overwrote the rest screen and re-spoke at them. Only the staff exit
       moves a finished kiosk. */
    if (kiosk.completed && !finish) return;
    if (kiosk.ambient) return;   /* ambient records the room, it never interviews */
    kiosk.busy = true;
    if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
    pvStopVoice();
    kioskMood('thinking', '', answer);
    var iv = gid('mlsAvKioskInterim'); if (iv) iv.textContent = '';
    var body = { clientSessionId: kiosk.sid, patientExternalId: kiosk.ext };
    /* the interview is stateless server-side, so the chart block rides with
       every turn - resolved once, at the first turn, and reused */
    if (kiosk.chartCtx === undefined) kiosk.chartCtx = kioskChartContext();
    if (kiosk.chartCtx) body.chartContext = kiosk.chartCtx;
    if (answer) { body.answer = answer; body.answerNonce = nonce || kioskNonce(); kiosk.silent = 0; kiosk.finishTries = 0; }
    if (finish) body.finish = true;
    api('/api/avatar/office/turn', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
      kiosk.busy = false;
      if (!kiosk.open) return;
      var j = r.json || {};
      /* A non-2xx that carries no {ok:false} — a 401, a 402 gate, a 429 whose
         body never parsed — must NEVER be walked as a successful turn: that
         path threw away the retry nonce and spoke an EMPTY string at the
         patient, then reopened the mic on a blank face forever. Any refusal
         keeps the answer resendable and re-opens the mic. */
      if (!r.ok || j.ok === false) {
        if (answer) kiosk.lastTry = { answer: answer, nonce: nonce };
        var msg = j.message || 'The connection hiccuped — your last answer is safe to say again.';
        kioskSetSay(msg);
        kioskMood('speaking', msg);
        pvSpeak(msg, function () { kioskListen(); });
        return;
      }
      kiosk.lastTry = null; kiosk.lastSay = String(j.say || '');
      /* Keep the check-in verbatim and LOCALLY: ambient room mode hands the
         doctor one transcript with the check-in and the visit both in it,
         and the patient's own answers are the check-in half. Recorded only
         on a SUCCESSFUL turn - a refused turn is re-asked and re-answered,
         and would otherwise appear twice. */
      if (j.avatar) kioskSetIdentity(j.avatar);
      /* AFTER kioskSetIdentity, never before: the avatar's name arrives on
         the first turn, so recording the label first filed question one as
         "Avatar" and every later one as the real name - one speaker under
         two names in a chart-bound transcript. */
      if (answer) kioskIntakeAdd('Patient', answer);
      if (kiosk.lastSay) kioskIntakeAdd(kiosk.avName || 'Avatar', kiosk.lastSay);
      kioskSetSay(kiosk.lastSay);
      var pg = gid('mlsAvKioskProgress');
      if (pg && j.progress && j.progress.total) pg.textContent = j.done ? '' : ('Question ' + Math.min(j.progress.covered || 1, j.progress.total) + ' of ' + j.progress.total);
      if (j.done) {
        kioskMood('speaking', kiosk.lastSay);
        pvSpeak(kiosk.lastSay, function () { kioskFinish(); });
        setTimeout(function () { if (kiosk.open && !kiosk.completed) kioskFinish(); }, 12000);
      } else {
        kioskMood('speaking', kiosk.lastSay, answer);
        /* owner: "it should be able to listen while it is talking" - the mic
           opens WITH the question, not after it. Patients answer as soon as
           they understand, usually before the sentence ends; those first
           words used to be discarded and the kiosk looked frozen. */
        kioskListen(true);
        pvSpeak(kiosk.lastSay, function () { if (!pvRec) kioskListen(); });
      }
    }, function () {
      kiosk.busy = false;
      if (!kiosk.open) return;
      kioskSetSay('The connection hiccuped — your last answer is safe to say again.');
      if (answer) kiosk.lastTry = { answer: answer, nonce: nonce };
      kioskListen();
    });
  }
  /* THE SELF-END WATCHDOG — armed on EVERY waiting path, not just the voice
     one. It used to be armed only after kioskListen's microphone-unavailable
     early return, so a typed-mode interview (mic blocked or absent — exactly
     the fallback the typed row exists for) never self-ended and never produced
     a summary. Activity lives on `kiosk.heard` so BOTH speech interims and
     typing can reset it. */
  function kioskArmWatchdog(ms) {
    /* AMBIENT ROOM MODE HAS NO SELF-END. This timer exists to close an
       abandoned INTERVIEW after three fruitless ~9s listens; an exam is
       silent for minutes at a time. Gated here AND in kioskWatchdog, so a
       timer armed a moment before the handoff still cannot end a capture. */
    if (kiosk.ambient) return;
    if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); }
    kiosk.nudgeTimer = setTimeout(kioskWatchdog, ms || 9000);
  }
  function kioskWatchdog() {
    if (kiosk.ambient) return;   /* see kioskArmWatchdog - the auto-finish must never end a room capture */
    if (!kiosk.open || kiosk.busy || kiosk.completed) return;
    var typed = (kiosk.mic === false);
    var wait = typed ? 20000 : 9000;   /* typing is slower than talking */
    if (kiosk.heard) {
      /* they are talking or typing (or the room is) — keep watching, and never
         give up the only timer that can revive this question. This guard used
         to RETURN, so one cough permanently disarmed the self-end. */
      kiosk.heard = false;
      kioskArmWatchdog(wait);
      return;
    }
    kiosk.silent = (kiosk.silent || 0) + 1;
    if (kiosk.silent >= 3) {
      /* BOUNDED: the auto-finish turn carries no answer, so kiosk.silent is
         never reset by it. Without a cap, a server that does not honour
         `finish` (or a fetch that rejects, or a cold-start 502 whose j.ok is
         undefined) had every 9s nudge re-fire the finish forever — the exact
         runaway this feature exists to prevent, burning backend calls. */
      kiosk.finishTries = (kiosk.finishTries || 0) + 1;
      if (kiosk.finishTries > 2) { kioskStopBounded(); return; }
      pvStopVoice();
      kioskTurn(null, null, true);
      return;
    }
    if (kiosk.nudgedFor !== kiosk.lastSay) {
      kiosk.nudgedFor = kiosk.lastSay;
      pvStopVoice();
      kioskMood('speaking', '');
      pvSpeak(NUDGE_LINE, function () { kioskListen(); });
    } else {
      pvStopVoice();
      kioskListen();
    }
  }
  /* The client gives up HONESTLY: it never claims the check-in was saved, it
     stops calling the server, and it still refuses to expose the app — a
     PIN-gated office rests for staff exactly as a normal completion does. */
  function kioskStopBounded() {
    pvStopVoice();
    if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
    kiosk.completed = true;
    kioskMood('speaking', 'thank you');
    kioskSetSay('Thanks — we\'ll stop here. Please hand the screen back to the team.');
    var iv = gid('mlsAvKioskInterim');
    if (iv) iv.textContent = 'Staff: the check-in could not reach the server — end the interview and check the connection.';
    var pg = gid('mlsAvKioskProgress'); if (pg) pg.textContent = '';
    var row = gid('mlsAvKioskTypeRow'); if (row) row.style.display = 'none';
    if (kiosk.pinSet === false) {
      safe(function () { if (isFn(window.toast)) window.toast('The check-in stopped early — the server could not be reached.', ''); });
      kioskClose('ended');
    }
  }
  function kioskListen(keepMood) {
    if (kiosk.ambient) return;
    if (kiosk.paused) return;         /* see kioskPauseToggle */   /* the ambient loop owns the microphone and never takes turns */
    if (!kiosk.open || kiosk.busy || kiosk.completed) return;
    if (keepMood && pvRec) return;            /* already listening */
    if (kiosk.mic === false) {
      var typeRow = gid('mlsAvKioskTypeRow'); if (typeRow) typeRow.style.display = 'flex';
      var input = gid('mlsAvKioskInput'); if (input) safe(function () { input.focus(); });
      kioskArmWatchdog(20000);   /* typed mode self-ends too */
      return;
    }
    if (!keepMood) kioskMood('listening', kiosk.lastSay);
    kiosk.heard = false;
    /* the chip is set HERE too, because the mic opens WITH the question: at
       kioskMood time the recogniser is not open yet, so 'speaking' alone
       would under-report what the kiosk is actually doing. */
    if (!kiosk.ambient && !kiosk.paused) {
      var stRoot = gid('mlsAvKiosk');
      kioskState(stRoot && stRoot.classList.contains('speaking') ? 'duplex' : 'listening');
    }
    var started = pvListen(function (finalText) {
      if (!kiosk.open) return;
      if (pvIsSelfEcho(finalText)) return;      /* never file our own voice */
      if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
      var reuse = kiosk.lastTry && kiosk.lastTry.answer === finalText ? kiosk.lastTry.nonce : kioskNonce();
      kiosk.lastTry = { answer: finalText, nonce: reuse };
      kioskTurn(finalText, reuse);
    }, function (interim) {
      /* the avatar hearing ITSELF must never become the patient's answer */
      if (pvIsSelfEcho(interim)) return;
      if (interim.trim()) kiosk.heard = true;
      /* BARGE-IN: real speech while the question is still playing stops the
         question mid-sentence, the way a person would. Guarded at two words
         so a cough, an 'mhm' or a nod-noise cannot cut it off. */
      if (pvSaying && interim.trim().split(/\s+/).filter(Boolean).length >= 2) pvStopSpeechOnly();
      var iv = gid('mlsAvKioskInterim'); if (iv) iv.textContent = interim;
    }, function () {
      /* the recogniser died on its own with nothing to submit — re-open the
         mic. The small delay keeps Chrome's routine `no-speech` error from
         becoming a hot restart loop. */
      if (kiosk.deadTimer) safe(function () { clearTimeout(kiosk.deadTimer); });
      kiosk.deadTimer = setTimeout(function () {
        kiosk.deadTimer = null;
        if (kiosk.open && !kiosk.busy && !kiosk.completed) kioskListen();
      }, 400);
    });
    if (!started) {
      kiosk.mic = false;
      var row = gid('mlsAvKioskTypeRow'); if (row) row.style.display = 'flex';
      var iv = gid('mlsAvKioskInterim'); if (iv) iv.textContent = 'The microphone is not available here — typing works below.';
      kioskArmWatchdog(20000);   /* a failed mic start must still self-end */
      return;
    }
    kioskArmWatchdog(9000);
  }
  /* Natural completion must not expose the app either — with a PIN set, the
     finished kiosk RESTS ("hand the screen back") until staff unlock it.
     kiosk.pinSet is TRI-STATE: true / false / null-unknown. Unknown is treated
     as LOCKED. It used to be seeded false and only ever raised from the
     answer-less first turn, so one dropped first request left the flag false
     for the whole interview and the finished kiosk auto-exited fullscreen into
     the doctor's app — the whole roster, in front of a patient. */
  function kioskFinish() {
    if (!kiosk.open) return;
    kiosk.completed = true;
    if (kiosk.pinSet === false) { kioskClose('done'); return; }
    pvStopVoice();
    kioskMood('speaking', 'thank you');
    kioskSetSay('All set — thank you! Please hand the screen back to the team.');
    var iv = gid('mlsAvKioskInterim'); if (iv) iv.textContent = 'Staff: “End interview” (top right) unlocks with the PIN, then End or Keep listening for the visit.';
    var pg = gid('mlsAvKioskProgress'); if (pg) pg.textContent = '';
  }
  /* End interview is a STAFF action: with an exit PIN configured, a patient
     holding the screen cannot end the kiosk into the doctor's app. The PIN is
     verified SERVER-side (it never rides to the client); no PIN configured =
     End closes immediately, and Setup encourages setting one. */
  function kioskRequestEnd() {
    if (kiosk.pinSet === false) { kioskEndForStaff('ended'); return; }
    pvStopVoice();
    if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
    var pad = gid('mlsAvKioskPin'), input = gid('mlsAvKioskPinInput'), msg = gid('mlsAvKioskPinMsg');
    if (!pad) { kioskEndForStaff('ended'); return; }
    if (msg) msg.textContent = '';
    if (input) input.value = '';
    pad.style.display = 'flex';
    if (input) safe(function () { input.focus(); });
    if (kiosk.pinSet === null) {
      /* We never learned whether this practice has a PIN (a dropped first
         turn). Ask the server — it answers unset:true for a no-PIN practice,
         so that office still exits in one tap, and an unreachable server
         leaves the gate CLOSED rather than open. */
      api('/api/avatar/office/unlock', { method: 'POST', body: JSON.stringify({ pin: '' }) }).then(function (r) {
        if (r.ok && r.json && r.json.ok && r.json.unset === true) { kiosk.pinSet = false; kioskEndForStaff('ended'); }
        else if (r.ok && r.json) { kiosk.pinSet = true; }
      }, function () {});
    }
  }
  /* Staff leaving must CLOSE the interview server-side, or the row sits
     'active' forever: both inbox queries are status-filtered, the session id
     is not persisted, and the patient's answers become invisible in every
     surface. Fire-and-forget — the request completes after the overlay goes,
     and the backend closes honestly and still runs the summary pipeline. */
  function kioskEndForStaff(reason) {
    /* AMBIENT FIRST. The capture is filed while the transcript box, the
       active chart and the overlay all still exist - kioskClose tears down
       every one of those, and a capture filed after them is a capture
       thrown away. */
    kioskAmbientStop('staff');
    kioskCloseServerSide();
    kioskClose(reason);
  }
  function kioskPinSubmit(mode) {
    /* TWO OUTCOMES, one gate. 'ambient' keeps the room microphone open for
       the consultation; anything else is today's behaviour, End. Both are
       behind the same server-verified PIN, so neither is reachable by the
       patient holding the screen. */
    var wantAmbient = (mode === 'ambient');
    var input = gid('mlsAvKioskPinInput'), msg = gid('mlsAvKioskPinMsg'), go = gid('mlsAvKioskPinGo');
    var amb = gid('mlsAvKioskPinAmb');
    var pin = input ? input.value.trim() : '';
    if (!/^\d{4,8}$/.test(pin)) { if (msg) msg.textContent = 'The PIN is 4 to 8 digits.'; return; }
    if (go) go.disabled = true;
    if (amb) amb.disabled = true;
    api('/api/avatar/office/unlock', { method: 'POST', body: JSON.stringify({ pin: pin }) }).then(function (r) {
      if (go) go.disabled = false;
      if (amb) amb.disabled = false;
      if (r.ok && r.json && r.json.ok) {
        if (wantAmbient) {
          /* THE HANDOFF. The overlay STAYS UP - it is the disclosure. */
          var pad = gid('mlsAvKioskPin'); if (pad) pad.style.display = 'none';
          if (input) input.value = '';
          if (msg) msg.textContent = '';
          kioskAmbientStart();
          return;
        }
        /* staff just proved themselves — a COMPLETED interview hands the
           doctor the summary immediately (the Ready inbox, fresh row on top).
           Never on the no-PIN auto-close path, where the patient may still
           be holding the screen. */
        var showSummary = kiosk.completed === true;
        kioskEndForStaff('ended');
        if (showSummary) safe(function () { open(); });
        return;
      }
      if (msg) msg.textContent = (r.json && r.json.message) || 'That PIN isn\'t right — try again.';
      if (input) { input.value = ''; safe(function () { input.focus(); }); }
    }, function () {
      if (go) go.disabled = false;
      if (msg) msg.textContent = 'Could not check the PIN — check the connection and try again.';
    });
  }
  function kioskMicPreflight(then) {
    /* Ask for the microphone ONCE, up front, while the DOCTOR still holds the
       screen — never mid-interview in front of the patient. */
    /* echoCancellation is the PREREQUISITE for an open mic during playback:
       without it the recogniser transcribes the avatar itself into the
       patient's answer, which corrupts the record rather than merely
       annoying anyone. */
    var media = safe(function () {
      return navigator.mediaDevices && navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    }, null);
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
    if (av && clean(av.name)) kiosk.avName = clean(av.name);   /* speaker label in the filed transcript */
    /* explicit — an identity payload that says "no PIN" must be able to LOWER
       the gate, and only a real payload resolves the unknown state */
    if (av && typeof av.exitPinSet === 'boolean') kiosk.pinSet = av.exitPinSet === true;
    var hasPhoto = av && typeof av.faceImage === 'string' && av.faceImage.indexOf('data:image/') === 0;
    if (hasPhoto && av.faceMode === 'photo') {
      /* the doctor chose THEIR stylized photo as the face — motion animations
         (pulse/lean/float) still run on the circle; the drawn controller is
         retired for this interview */
      if (!kiosk.photoFace) {
        kiosk.photoFace = true;
        if (kiosk.face) { safe(function () { kiosk.face.destroy(); }); kiosk.face = null; }
        var mount = gid('mlsAvKioskFace');
        if (mount) { mount.innerHTML = ''; var img = document.createElement('img'); img.alt = ''; img.src = av.faceImage; mount.appendChild(img); }
      }
    } else if (av && av.faceLook && !kiosk.tinted) {
      /* drawn mode: the doctor's SAVED appearance wins — colours, hair cut,
         glasses, facial hair — and the full expression range survives */
      kiosk.tinted = true;
      kiosk.look = faceLookSafe(av.faceLook);
      if (kiosk.face) safe(function () { kiosk.face.retint(kiosk.look); });
    } else if (hasPhoto && !kiosk.tinted) {
      /* no saved appearance yet: derive one from the portrait so the face
         still resembles the doctor on day one */
      kiosk.tinted = true;
      faceTintFromPortrait(av.faceImage, function (res) {
        var look = res && res.look;
        if (look && kiosk.face) { kiosk.look = look; kiosk.face.retint(look); }
      });
    }
  }
  /* =========================================================================
     av-5.4.0 - AMBIENT ROOM MODE. Owner, 2026-08-06: "make it possible for the
     avatar to just sit back and listen for even when the doctor comes back and
     just put that into the text box once done to be turned into all the notes
     and stuff ... just like having someone else in the room to ask questions
     then take notes all for the doctor."

     The intake interview already ends with the kiosk AT REST behind the staff
     exit PIN. That rest screen is the handoff point: the same PIN pad now has
     a second outcome - keep the room microphone open through the consultation,
     then hand the doctor ONE transcript with the check-in and the visit in it,
     in that order, with a visible boundary between them.

     Five things this mode has to get right, each of which is a defect this
     file has already paid for somewhere else:

     1. IT MUST NOT SPEAK. A participant asks questions; a scribe does not.
        Silence is enforced inside pvSpeakVoiced itself - the ONE place any
        voice can start - instead of by disarming a list of call sites. A list
        is a denylist, and the next call site added would not be on it.
     2. IT MUST NOT SELF-END. The 9s watchdog exists to close an ABANDONED
        interview after three fruitless listens. A real exam is silent for
        minutes at a time, so both kioskArmWatchdog and kioskWatchdog return
        early while ambient runs. The end conditions are different in kind:
        the staff PIN, or a hard 90 minute cap. Nothing else stops it.
     3. IT MUST SAY SO, CONTINUOUSLY. The disclosure is an element shown by one
        class on the root plus the avatar's own listening state - "recording"
        and "the screen says recording" are therefore the same fact and cannot
        drift apart. A toast would fade; a patient who consented to intake
        questions has not consented to an exam being taped.
     4. IT MUST FAIL CLOSED ON THE PATIENT. A consultation filed to the wrong
        chart is the worst thing this feature can produce, so the chart is
        compared at WRITE time against the chart the check-in was bound to. Not
        at start time, and never as "probably still the same patient".
     5. IT MUST SURVIVE LENGTH. Chrome's recogniser ends itself roughly every
        minute and dies silently on "no-speech" and "network". The loop owns its
        own recogniser (pvListen's 1.3s quiet-submit is turn-taking behaviour
        and would tear the microphone down every pause), restarts with a
        bounded backoff, and accumulates into an array that no restart can
        truncate. ============================================================ */
  var AMBIENT_MAX_MS = 90 * 60 * 1000;         /* hard cap - never into the next patient */
  var AMBIENT_HEAD_CHECKIN = '--- check-in ---';
  var AMBIENT_HEAD_VISIT = '--- visit ---';
  var AMBIENT_HEAD_ORDERS = '--- actions the doctor confirmed on screen ---';
  /* ONE source for the recording banner text: the markup and the resume path
     must never be able to disagree about what the screen says. */
  var NUDGE_LINE = 'Take your time — whenever you\'re ready, just start talking.';
  var AMBIENT_REC_TEXT = 'Recording this visit. The avatar is listening in the room and taking notes for the doctor.';

  /* =========================================================================
     av-5.6.0 - THE VISIT COPILOT. Room mode could already hear a whole
     consultation. Three things it could not do, each of which is a way a real
     visit loses information:

     1. IT FORGOT ON REFRESH. The capture lived in ONE array in ONE tab and
        reached the transcript exactly once, at the very end. A reload, a
        crashed renderer, a tab discarded under memory pressure, or a mis-tap
        threw away the entire consultation and left no trace that anything had
        ever been recorded - the doctor could not even know what was lost.
        Every finalised sentence is now persisted under the account namespace
        within ~1.5s, and an unfiled capture announces itself on the next load.
     2. IT HEARD ORDERS AND DID NOTHING WITH THEM. "Order an MRI lumbar spine
        without contrast" was recorded as prose and re-read later. It is now
        recognised as it is said and prepared as a PROPOSAL - never submitted,
        never completed by guesswork, and not confirmable at all while a
        clinically required detail (which side) is missing.
     3. IT HAD NO END. Capture ended through the staff PIN pad, which is a door
        back into the app, not a review of the visit. One End Visit control now
        flushes the recogniser, files, and reports honestly what was saved and
        what remains only proposed.
     ======================================================================== */

  /* ---- 1. THE BACKUP -----------------------------------------------------
     The in-memory capture stays authoritative; this is the crash copy. It is
     account-namespaced (never the next doctor's visit), chart-bound (it can
     only ever be filed to the chart it was taken on), and it degrades under
     quota by shedding its OLDEST sentences and SAYING SO - a backup that
     silently stopped updating an hour ago is worse than no backup. ------- */
  var AMBIENT_STORE_KEY = 'mlsAvRoomCaptureV1';
  var AMBIENT_SAVE_MS = 1500;
  function ambientStoreKey() {
    return safe(function () {
      return isFn(window.uns) ? (window.uns(AMBIENT_STORE_KEY) || AMBIENT_STORE_KEY) : AMBIENT_STORE_KEY;
    }, AMBIENT_STORE_KEY);
  }
  function ambientStoreRead() {
    return safe(function () {
      var raw = localStorage.getItem(ambientStoreKey());
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || typeof rec !== 'object' || !Array.isArray(rec.parts)) return null;
      /* an UNBOUND backup could only ever end in a refusal to write (see
         kioskAmbientFile), so it is not a recoverable capture at all */
      if (!clean(rec.bound)) return null;
      return rec;
    }, null);
  }
  function ambientStoreDrop() { safe(function () { localStorage.removeItem(ambientStoreKey()); }); }
  function ambientStoreWrite(rec) {
    var key = ambientStoreKey();
    var parts = (rec.parts || []).slice();
    var trimmed = false;
    for (var guard = 0; guard < 40; guard++) {
      var body = safe(function () {
        return JSON.stringify({
          v: 1, sid: rec.sid || '', bound: rec.bound || '', start: rec.start || 0,
          savedAt: Date.now(), avName: rec.avName || '', trimmed: trimmed,
          intake: rec.intake || [], actions: rec.actions || [], parts: parts
        });
      }, '');
      if (!body) return { ok: false, why: 'serialise', trimmed: trimmed };
      if (safe(function () { localStorage.setItem(key, body); return true; }, false)) {
        return { ok: true, trimmed: trimmed, bytes: body.length };
      }
      /* out of quota: shed the oldest quarter of the STORED copy and retry.
         kiosk.ambParts is untouched, so a visit that ends normally still
         files complete - only the crash copy loses its head. */
      if (parts.length < 2) return { ok: false, why: 'quota', trimmed: trimmed };
      parts = parts.slice(Math.ceil(parts.length / 4));
      trimmed = true;
    }
    return { ok: false, why: 'quota', trimmed: true };
  }
  function ambientActionsForStore() {
    return (kiosk.ambActions || []).map(function (a) {
      return { id: a.id, kind: a.kind, title: a.title, detail: a.detail, heard: a.heard,
        missing: (a.missing || []).slice(), status: a.status, at: a.at };
    });
  }
  function kioskAmbientSaveNow() {
    /* A FILED capture leaves no backup behind: the words are in the doctor's
       transcript now, and a stale copy would offer to file them a second
       time on the next load. */
    if (kiosk.ambFiled || !clean(kiosk.ambBound)) return null;
    var res = ambientStoreWrite({
      sid: kiosk.sid, bound: kiosk.ambBound, start: kiosk.ambStart, avName: kiosk.avName || '',
      intake: kiosk.intake || [], actions: ambientActionsForStore(), parts: kiosk.ambParts || []
    });
    kiosk.ambSavedAt = Date.now();
    kiosk.ambSaveOk = res.ok === true;
    kiosk.ambSaveTrim = res.trimmed === true;
    kioskAmbientSaveBadge();
    return res;
  }
  function kioskAmbientSave(force) {
    if (force) {
      if (kiosk.ambSaveTimer) { safe(function () { clearTimeout(kiosk.ambSaveTimer); }); kiosk.ambSaveTimer = null; }
      return kioskAmbientSaveNow();
    }
    if (!kiosk.ambient) return null;
    /* a trailing save is already queued and will carry this sentence too -
       one write per ~1.5s, not one per recognised phrase */
    if (kiosk.ambSaveTimer) return null;
    kiosk.ambSaveTimer = setTimeout(function () {
      kiosk.ambSaveTimer = null;
      kioskAmbientSaveNow();
    }, AMBIENT_SAVE_MS);
    return null;
  }
  function kioskAmbientSaveBadge() {
    var el = gid('mlsAvKioskSave');
    if (!el) return;
    if (kiosk.ambSaveOk === false) {
      el.textContent = 'Not backed up - this tab only';
      el.setAttribute('data-state', 'bad');
      return;
    }
    el.textContent = kiosk.ambSaveTrim ? 'Saved (backup trimmed)' : 'Saved';
    el.setAttribute('data-state', 'ok');
  }

  /* ---- 2. THE ACTION DETECTOR -------------------------------------------
     Pure, synchronous and LOCAL. It runs on the sentence the recogniser just
     finalised, so a proposal is on screen in the same tick the doctor stops
     speaking: no network hop, no model round trip, and it still works while
     the connection is crawling. Three rules it may never break:

       - IT READS ONLY WHAT WAS SAID. Every field it cannot hear stays empty.
         An empty field that is clinically required (which side, for a paired
         body part) blocks Confirm outright rather than being filled in with
         the likely answer.
       - IT PROPOSES, IT NEVER PLACES. Nothing here submits anything. The
         confirmed list is written into the doctor's transcript under its own
         heading; placing the order in the EMR remains the doctor's action.
       - IT IS CONSERVATIVE ON PURPOSE. One microphone means doctor and
         patient arrive on the same channel and cannot be told apart, so a
         question ("should we get an MRI?", "can I get an MRI?") and every
         negated, past, conditional or cancelled form is refused. A missed
         proposal costs one manual entry; a spurious one spends the doctor's
         attention in front of a patient on something nobody asked for. ---- */

  /* the trigger VERB is mandatory for every kind. On its own this refuses
     most of what a patient says about their own care ("I had an MRI last
     year", "my knee hurts") before any other guard runs. */
  var ACT_VERB = /\b(order|orders|ordering|get|getting|obtain|schedule|scheduling|book|repeat|prescribe|prescribing|start|starting|refer|referring|referral|send|draw|check|put (?:him|her|them) on|follow(?:ing)? up|come back|see (?:him|her|them) back)\b/i;

  /* HARD refusals: the sentence contains the words and no action was taken.
     These win over every commitment phrase, because "if it gets worse we'll
     order an MRI" is a plan for a different day, not an order for today. */
  var ACT_HARD_BLOCK = [
    /\b(?:don'?t|do not|does not|doesn'?t|did not|didn'?t|will not|won'?t|cannot|can'?t|no)\s+(?:\w+\s+){0,3}(?:need|want|order|require|indicat)/i,
    /\bnot\s+(?:\w+\s+){0,2}(?:going to\s+|gonna\s+)?(?:order|prescrib|refer|start|schedul|obtain)/i,
    /\bno need (?:for|to)\b/i,
    /\b(?:hold(?:ing)? off|defer(?:ring)?|avoid|against (?:an?|the)|instead of|rather than|cancel(?:led|ling)?|discontinue|stop(?:ping)?)\b/i,
    /\b(?:already (?:had|has|have|got|done|ordered)|last (?:year|month|week|visit)|previously|prior|in the past|years? ago|months? ago|weeks? ago)\b/i,
    /\bif\b[^.?!]*\b(?:worse|worsen|persist|fail|flare|doesn'?t (?:improve|help)|not better|no better)\b/i,
    /\b(?:worse|persist|fail|doesn'?t (?:improve|help)|not better|no better)\b[^.?!]*\bthen\b/i,
    /\?\s*$/,
    /^\s*(?:do|did|does|have|has|had|can|could|should|would|will|are|is|was|am|any|what|when|why|how|which)\b[^.!]*$/i,
    /\b(?:do|did|would|should|can|could|will) (?:you|we|i|he|she|they)\b/i,
    /\b(?:what|how) about\b/i,
    /\bhave you (?:had|ever|been)\b/i
  ];
  /* SOFT hedges - refused unless the same sentence also commits. "I would
     like to order an MRI" commits; "we might order an MRI" does not. */
  var ACT_SOFT_BLOCK = [/\b(?:might|maybe|perhaps|possibly|probably|consider(?:ing)?|thinking about|may want)\b/i];
  var ACT_COMMIT = [
    /\b(?:let'?s|we'?ll|we will|i'?ll|i will|i'?m going to|i am going to|go ahead and|please)\s+(?:\w+\s+){0,3}(?:order|get|obtain|schedul|book|prescrib|start|refer|send|draw|check|repeat)/i,
    /\bi(?:'d| would| want)?\s*(?:like\s+)?to (?:order|get|obtain|start|prescribe|refer|schedule|check|draw)\b/i,
    /^\s*(?:order|get|obtain|schedule|book|prescribe|start|refer|send|draw|check|repeat)\b/i
  ];
  function actAny(list, text) {
    for (var i = 0; i < list.length; i++) if (list[i].test(text)) return true;
    return false;
  }
  function actBlocked(text) {
    if (actAny(ACT_HARD_BLOCK, text)) return true;
    if (actAny(ACT_SOFT_BLOCK, text) && !actAny(ACT_COMMIT, text)) return true;
    return false;
  }

  var ACT_IMAGING = [
    ['MRI', /\b(?:m\s?r\s?i|magnetic resonance)\b/i],
    ['CT', /\b(?:c\s?t(?: scan)?|cat scan|computed tomography)\b/i],
    ['X-ray', /\b(?:x[- ]?rays?|radiographs?|plain films?)\b/i],
    ['Ultrasound', /\b(?:ultrasound|sonogram|doppler)\b/i],
    ['DEXA', /\b(?:dexa|bone density)\b/i],
    ['PET', /\bp\s?e\s?t(?: scan| ct)?\b/i],
    ['EMG / nerve conduction', /\b(?:e\s?m\s?g|electromyograph\w*|nerve conduction)\b/i],
    ['Bone scan', /\bbone scans?\b/i]
  ];
  /* longest first - "lumbar spine" must win over "spine", and "abdomen and
     pelvis" over either half */
  var ACT_REGIONS = ['abdomen and pelvis', 'lumbosacral spine', 'cervical spine', 'thoracic spine',
    'lumbar spine', 'sacroiliac joint', 'si joint', 'lower extremity', 'upper extremity',
    'brain', 'head', 'neck', 'chest', 'abdomen', 'pelvis', 'spine', 'sinus',
    'shoulder', 'elbow', 'forearm', 'wrist', 'hand', 'hip', 'knee', 'ankle', 'foot',
    'femur', 'tibia', 'humerus', 'clavicle', 'eye', 'ear', 'arm', 'leg'];
  /* paired structures: an imaging order without a side is not a complete
     order, so the widget refuses to let it be confirmed until the doctor
     picks one. It never picks for them. */
  var ACT_PAIRED = ['shoulder', 'elbow', 'forearm', 'wrist', 'hand', 'hip', 'knee', 'ankle', 'foot',
    'femur', 'tibia', 'humerus', 'clavicle', 'eye', 'ear', 'arm', 'leg', 'lower extremity', 'upper extremity'];
  var ACT_LABS = [
    ['CBC', /\bc\s?b\s?c\b|\bcomplete blood count\b/i],
    ['CMP', /\bc\s?m\s?p\b|\bcomprehensive metabolic\b/i],
    ['BMP', /\bb\s?m\s?p\b|\bbasic metabolic\b/i],
    ['HbA1c', /\b(?:hemoglobin\s+)?a\s?1\s?c\b/i],
    ['Lipid panel', /\blipid (?:panel|profile)\b/i],
    ['TSH', /\bt\s?s\s?h\b|\bthyroid (?:panel|function)\b/i],
    ['ESR', /\be\s?s\s?r\b|\bsed rate\b/i],
    ['CRP', /\bc\s?r\s?p\b|\bc[- ]reactive protein\b/i],
    ['Urinalysis', /\burinalysis\b|\bu\s?a\b/i],
    ['Vitamin D', /\bvitamin d\b/i],
    ['PT/INR', /\bp\s?t\s?\/?\s?i\s?n\s?r\b|\binr\b/i]
  ];
  var ACT_SPECIALTIES = ['orthopedics', 'orthopaedics', 'orthopedic surgery', 'ortho', 'neurosurgery',
    'neurology', 'cardiology', 'rheumatology', 'physical therapy', 'pt', 'pain management',
    'sports medicine', 'podiatry', 'dermatology', 'endocrinology', 'gastroenterology',
    'psychiatry', 'urology', 'ent', 'ophthalmology', 'oncology', 'vascular surgery',
    'general surgery', 'spine surgery', 'nephrology', 'pulmonology'];

  function actFindRegion(text) {
    for (var i = 0; i < ACT_REGIONS.length; i++) {
      if (new RegExp('\\b' + ACT_REGIONS[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)) return ACT_REGIONS[i];
    }
    return '';
  }
  function actFindSide(text) {
    if (/\bbilateral(?:ly)?\b|\bboth\b/i.test(text)) return 'bilateral';
    if (/\bleft\b|\bl\s?side\b/i.test(text)) return 'left';
    if (/\bright\b/i.test(text)) return 'right';
    return '';
  }
  function actFindContrast(text) {
    if (/\bwith and without contrast\b/i.test(text)) return 'with and without contrast';
    if (/\b(?:without|no|sans) contrast\b/i.test(text)) return 'without contrast';
    if (/\bwith contrast\b/i.test(text)) return 'with contrast';
    return '';
  }
  function actInterval(text) {
    var m = /\b(?:in|after)\s+(?:about\s+)?(\d+|one|two|three|four|five|six|eight|ten|twelve)\s+(day|week|month|year)s?\b/i.exec(text);
    return m ? (m[1] + ' ' + m[2] + (/^(1|one)$/i.test(m[1]) ? '' : 's')) : '';
  }
  function actTitleCase(s) { return String(s || '').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }

  /* detectActions(sentence) -> array of proposals (usually 0 or 1).
     Exposed for tests through window.__mlsAvatar.detectActions - it is a pure
     function of its argument and touches nothing. */
  function detectActions(sentence) {
    var raw = clean(sentence);
    if (!raw || raw.length > 600) return [];
    var directed = false;
    /* a sentence addressed to the assistant by name is an INSTRUCTION, not
       part of the conversation between the doctor and the patient */
    var wake = /^\s*(?:hey[, ]+|ok[, ]+|okay[, ]+)?(?:m\.?\s?l\.?\s?s\.?|scribe|avatar|copilot)\s*[,:.]?\s+(.{3,})$/i.exec(raw);
    var text = raw;
    if (wake) { directed = true; text = clean(wake[1]); }
    var out = [];
    function push(kind, title, detail, missing, fields) {
      out.push({
        id: 'act-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        kind: kind, title: title, detail: detail || '', missing: missing || [],
        fields: fields || {}, heard: raw, directed: directed, at: Date.now(), status: 'proposed'
      });
    }
    var hasVerb = ACT_VERB.test(text);
    /* A directed instruction still has to clear the refusals: "MLS, we are
       not ordering an MRI" must not produce an order. */
    if (actBlocked(text)) return [];

    if (hasVerb) {
      var side = actFindSide(text), region = actFindRegion(text), contrast = actFindContrast(text);
      var i, m;
      for (i = 0; i < ACT_IMAGING.length; i++) {
        if (!ACT_IMAGING[i][1].test(text)) continue;
        var bits = [];
        if (side) bits.push(actTitleCase(side));
        if (region) bits.push(region);
        if (contrast) bits.push(contrast);
        var need = [];
        if (region && ACT_PAIRED.indexOf(region) >= 0 && !side) need.push('side');
        if (!region) need.push('body part');
        push('imaging', ACT_IMAGING[i][0], bits.join(' '), need,
          { modality: ACT_IMAGING[i][0], region: region, side: side, contrast: contrast });
        break;
      }
      if (!out.length) {
        for (i = 0; i < ACT_LABS.length; i++) {
          if (!ACT_LABS[i][1].test(text)) continue;
          push('lab', ACT_LABS[i][0], '', [], { panel: ACT_LABS[i][0] });
          break;
        }
      }
      if (!out.length && /\b(?:refer|referral|send (?:him|her|them|the patient))\b/i.test(text)) {
        var spec = '';
        for (i = 0; i < ACT_SPECIALTIES.length; i++) {
          if (new RegExp('\\b' + ACT_SPECIALTIES[i] + '\\b', 'i').test(text)) { spec = ACT_SPECIALTIES[i]; break; }
        }
        push('referral', 'Referral' + (spec ? ' - ' + actTitleCase(spec) : ''), '',
          spec ? [] : ['specialty'], { specialty: spec });
      }
      if (!out.length && /\b(?:prescrib\w*|start(?:ing)? (?:him|her|them|the patient)? ?on|start(?:ing)?|refill|put (?:him|her|them) on|send (?:in|over) a (?:script|prescription))\b/i.test(text)) {
        /* the drug NAME is whatever the doctor said after the verb, verbatim
           and untouched - there is no dictionary here to guess against, and a
           mis-expanded drug name is the most dangerous thing this file could
           produce */
        m = /\b(?:prescribe|prescribing|start|starting|refill|put (?:him|her|them) on)\s+(?:(?:him|her|them|the patient)\s+on\s+)?([a-z][a-z0-9\- ]{2,40})/i.exec(text);
        /* the captured run stops at the first function word, then at the
           dose: "start gabapentin 300 mg at night" must name the drug
           "gabapentin", not "gabapentin 300 mg" - a title that carries a dose
           reads as a second, different dose next to the real one. */
        var drug = m ? clean(m[1])
          .replace(/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?|iu|milligrams?|micrograms?|grams?)\b.*$/i, '')
          .replace(/\b(?:at|for|and|with|to|in|by|the|a|an|of|on|every|once|twice|daily|nightly)\b.*$/i, '')
          .trim() : '';
        var dose = (/\b(\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|units?|iu|milligrams?|micrograms?|grams?))\b/i.exec(text) || [])[1] || '';
        var freq = (/\b(once daily|twice daily|three times (?:a day|daily)|every (?:\d+|other) (?:hours?|days?)|at (?:night|bedtime)|nightly|daily|b\.?i\.?d\.?|t\.?i\.?d\.?|q\.?h\.?s\.?|as needed|p\.?r\.?n\.?)\b/i.exec(text) || [])[1] || '';
        var route = (/\b(by mouth|orally|oral|topical(?:ly)?|injection|intramuscular|subcutaneous|i\.?m\.?|i\.?v\.?)\b/i.exec(text) || [])[1] || '';
        if (drug) {
          var dbits = [];
          if (dose) dbits.push(dose);
          if (route) dbits.push(route);
          if (freq) dbits.push(freq);
          var dneed = [];
          if (!dose) dneed.push('dose');
          if (!freq) dneed.push('frequency');
          push('medication', actTitleCase(drug), dbits.join(', '), dneed,
            { drug: drug, dose: dose, frequency: freq, route: route });
        }
      }
      if (!out.length && /\b(?:follow(?:ing)? up|come back|see (?:him|her|them) back|recheck)\b/i.test(text)) {
        var iv = actInterval(text);
        push('followUp', 'Follow-up' + (iv ? ' in ' + iv : ''), '', iv ? [] : ['interval'], { interval: iv });
      }
    }
    /* A named instruction that matched no clinical shape is still an
       instruction - it becomes a documentation note carrying the doctor's own
       words, which is exactly what "remind me to document that ..." asks for.
       Undirected speech never reaches here: the room is full of sentences. */
    if (!out.length && directed && text) {
      push('note', 'Documentation note', text, [], { text: text });
    }
    return out;
  }

  /* ---- the proposal list ------------------------------------------------
     Chrome finalises PHRASES, not sentences, so one spoken order can arrive
     as "order an MRI" then "of the lumbar spine without contrast". Detection
     therefore runs on a short rolling window a beat after the words stop, and
     a fuller proposal SUPERSEDES the thinner one it grew out of instead of
     stacking a second card beside it. Two genuinely different scans stay two
     cards: supersession requires the same modality AND a region the earlier
     card either did not have or already agreed with. ------------------- */
  var ACT_DETECT_MS = 1200;
  var ACT_SUPERSEDE_MS = 30000;

  /* ---- av-5.6.6 — CORRECTIONS ------------------------------------------
     Doctors correct themselves mid-sentence, constantly: "order an MRI of the
     knee — actually, make that the right knee." Until now the second half did
     nothing, so the card kept asking for a side the doctor had already said
     out loud. That is the copilot failing at the exact moment it looked like
     it was working.

     Two rules keep this safe:
       1. A correction only ever applies to a RECENT action, and only when it
          actually carries a new value. "Actually the pain is worse at night"
          is not an amendment — the cue alone changes nothing.
       2. Correcting something the doctor already CONFIRMED sends it back to
          unconfirmed. Silently editing a confirmed order would mean the thing
          they approved and the thing in the note are different, which is the
          one outcome this widget exists to prevent. ---------------------- */
  var ACT_CORRECT_WINDOW = 180000;
  var ACT_CANCEL_RE = /\b(?:cancel|scratch|forget|disregard|strike|withdraw)\s+(?:that|it|the\s+(?:order|scan|mri|ct|x-?ray|ultrasound|referral|prescription|labs?))\b|\bnever ?mind\b|\bactually,?\s*no\b|\bdon'?t (?:order|do) (?:that|it)\b/i;
  var ACT_CUE_RE = /\b(?:actually|sorry|i meant|i mean|make (?:that|it)|change (?:that|it)|correction|instead)\b/i;
  function actRebuildDetail(a) {
    var f = a.fields || {}, bits = [];
    if (a.kind === 'imaging') {
      if (f.side) bits.push(actTitleCase(f.side));
      if (f.region) bits.push(f.region);
      if (f.contrast) bits.push(f.contrast);
    } else if (a.kind === 'medication') {
      if (f.dose) bits.push(f.dose);
      if (f.route) bits.push(f.route);
      if (f.frequency) bits.push(f.frequency);
    } else return a.detail || '';
    return bits.join(a.kind === 'medication' ? ', ' : ' ');
  }
  function applyCorrection(sentence) {
    var text = clean(sentence);
    if (!text) return null;
    var list = kiosk.ambActions || [], target = null, i;
    for (i = list.length - 1; i >= 0; i--) {
      if (list[i].status === 'dismissed') continue;
      if (Date.now() - (list[i].at || 0) > ACT_CORRECT_WINDOW) break;
      target = list[i]; break;
    }
    if (!target) return null;
    if (ACT_CANCEL_RE.test(text)) {
      target.status = 'dismissed';
      target.correctedBy = text;
      return { kind: 'cancelled', on: target };
    }
    if (!ACT_CUE_RE.test(text)) return null;
    var side = actFindSide(text), contrast = actFindContrast(text);
    var dose = (/\b(\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|units?|iu|milligrams?|micrograms?|grams?))\b/i.exec(text) || [])[1] || '';
    var region = actFindRegion(text);
    var f = target.fields || (target.fields = {}), changed = false;
    if (side && target.kind === 'imaging' && f.side !== side) { f.side = side; target.picked = side; changed = true; }
    if (contrast && target.kind === 'imaging' && f.contrast !== contrast) { f.contrast = contrast; changed = true; }
    if (region && target.kind === 'imaging' && f.region !== region) { f.region = region; changed = true; }
    if (dose && target.kind === 'medication' && f.dose !== dose) { f.dose = dose; changed = true; }
    /* the cue alone is not a correction — without a new VALUE there is nothing
       to change, and guessing what was meant is exactly what this must not do */
    if (!changed) return null;
    target.detail = actRebuildDetail(target);
    target.missing = (target.missing || []).filter(function (k) {
      if (k === 'side') return !f.side;
      if (k === 'dose') return !f.dose;
      if (k === 'body part') return !f.region;
      return true;
    });
    target.correctedBy = text;
    if (target.status === 'confirmed') { target.status = 'proposed'; target.reconfirm = true; }
    return { kind: 'amended', on: target };
  }
  function actRoot(a) {
    var f = a.fields || {};
    return a.kind + '|' + clean(f.modality || f.panel || f.specialty || f.drug || (a.kind === 'note' ? a.detail : '')).toLowerCase();
  }
  function ordersUpsert(proposal) {
    if (!kiosk.ambActions) kiosk.ambActions = [];
    var list = kiosk.ambActions, root = actRoot(proposal), now = Date.now(), i;
    for (i = 0; i < list.length; i++) {
      var old = list[i];
      if (old.status !== 'proposed' || actRoot(old) !== root) continue;
      var oldRegion = clean((old.fields || {}).region).toLowerCase();
      var newRegion = clean((proposal.fields || {}).region).toLowerCase();
      var growth = (now - old.at) < ACT_SUPERSEDE_MS && (!oldRegion || oldRegion === newRegion);
      if (!growth) continue;
      /* keep the side the DOCTOR already picked on the card - the newer
         hearing must not silently drop a resolved requirement */
      if (old.picked) {
        proposal.picked = old.picked;
        proposal.fields.side = old.picked;
        proposal.detail = (actTitleCase(old.picked) + ' ' + proposal.detail).trim();
        proposal.missing = (proposal.missing || []).filter(function (k) { return k !== 'side'; });
      }
      proposal.id = old.id;
      list[i] = proposal;
      return proposal;
    }
    if (list.length >= 24) return null;    /* bounded - a visit is not a queue */
    list.push(proposal);
    return proposal;
  }
  function ordersDetectSoon(sentence) {
    if (!kiosk.ambient) return;
    var seg = clean(sentence);
    kiosk.ambWindow = ((kiosk.ambWindow || '') + ' ' + seg).slice(-400).trim();
    /* THE IMMEDIATE PASS. Most spoken orders arrive as ONE finalised phrase,
       and making the doctor wait the settle window for a card the detector
       already holds is latency we control and should not spend. Whatever this
       finds is on screen in the same tick the words land; the windowed pass
       below then UPGRADES it in place when the rest of the sentence arrives -
       which is exactly what ordersUpsert's supersession exists for. Measured:
       ~1200ms to first card before this, single-digit ms after. */
    /* A CORRECTION IS NOT A NEW ORDER. It is checked first and, when it
       lands, this phrase goes no further — otherwise "actually, make that the
       right knee" could sit a second card beside the one it was fixing. */
    var fixed = safe(function () { return applyCorrection(seg); }, null);
    if (fixed) { ordersRender(); kioskAmbientSave(true); return; }
    var immediate = detectActions(seg), grew = 0, k;
    for (k = 0; k < immediate.length; k++) if (ordersUpsert(immediate[k])) grew++;
    if (grew) { ordersRender(); kioskAmbientSave(true); }
    if (kiosk.ambDetectTimer) safe(function () { clearTimeout(kiosk.ambDetectTimer); });
    kiosk.ambDetectTimer = setTimeout(function () {
      kiosk.ambDetectTimer = null;
      var window_ = kiosk.ambWindow || '';
      kiosk.ambWindow = '';
      if (!window_) return;
      /* the LAST clause is the one that just finished; the window before it
         is context that has already been offered to the detector. Split
         WITHOUT lookbehind - this file still runs on browsers that predate
         it, and a syntax error here would take the whole module down. */
      var clauses = window_.replace(/([.!?])\s+/g, '$1\u0001').split('\u0001');
      var tail = clauses.slice(-2).join(' ');
      var found = detectActions(tail);
      var added = 0;
      for (var i = 0; i < found.length; i++) if (ordersUpsert(found[i])) added++;
      if (added) { ordersRender(); kioskAmbientSave(true); }
    }, ACT_DETECT_MS);
  }
  function ordersCounts() {
    var list = kiosk.ambActions || [], c = { proposed: 0, confirmed: 0, dismissed: 0 };
    for (var i = 0; i < list.length; i++) c[list[i].status] = (c[list[i].status] || 0) + 1;
    return c;
  }
  function ordersConfirmed() {
    return (kiosk.ambActions || []).filter(function (a) { return a.status === 'confirmed'; });
  }
  function ordersFind(id) {
    var list = kiosk.ambActions || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  var ACT_KIND_LABEL = { imaging: 'Imaging', lab: 'Lab', referral: 'Referral',
    medication: 'Medication', followUp: 'Follow-up', note: 'Note' };
  var ACT_MISSING_LABEL = { side: 'which side', 'body part': 'body part',
    dose: 'dose', frequency: 'how often', specialty: 'which specialty', interval: 'when' };
  function ordersMissingText(a) {
    return (a.missing || []).map(function (k) { return ACT_MISSING_LABEL[k] || k; }).join(', ');
  }
  /* the card is built with DOM nodes and textContent throughout: `heard` is
     raw speech off a microphone and must never be interpolated into markup */
  function ordersCard(a) {
    var card = make('div', 'mlsAvOrd');
    card.setAttribute('data-id', a.id);
    card.setAttribute('data-kind', a.kind);
    var top = make('div', 'mlsAvOrdTop');
    top.appendChild(make('b', '', a.title));
    top.appendChild(make('span', 'mlsAvOrdKind', ACT_KIND_LABEL[a.kind] || a.kind));
    card.appendChild(top);
    if (a.detail) card.appendChild(make('div', 'mlsAvOrdDet', a.detail));
    card.appendChild(make('div', 'mlsAvOrdHeard', '“' + a.heard + '”'));
    if (a.status === 'confirmed') {
      card.appendChild(make('div', 'mlsAvOrdOk', 'Confirmed - goes into the note. Place it in the EMR from the chart.'));
      return card;
    }
    /* the inline editor replaces the card's controls while it is open, so
       there is never a Confirm button next to a half-typed action */
    if (a.editing) {
      var ed = make('div', 'mlsAvOrdEdRow');
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'mlsAvOrdEdIn';
      input.value = a.title + (a.detail ? ' - ' + a.detail : '');
      input.setAttribute('aria-label', 'Edit this action');
      input.maxLength = 120;
      function commitEdit() {
        var v = clean(input.value);
        if (!v) return;                       /* an empty action is not a correction */
        a.title = v.slice(0, 120); a.detail = ''; a.missing = []; a.edited = true; a.editing = false;
        ordersRender(); kioskAmbientSave(true);
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); a.editing = false; ordersRender(); }
      });
      ed.appendChild(input);
      var save = make('button', 'mlsAvOrdGo', 'Save');
      save.type = 'button';
      save.addEventListener('click', commitEdit);
      var cancel = make('button', 'mlsAvOrdEdit', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { a.editing = false; ordersRender(); });
      ed.appendChild(save); ed.appendChild(cancel);
      card.appendChild(ed);
      /* focus after the node is in the document, or the caret goes nowhere */
      safe(function () { setTimeout(function () { safe(function () { input.focus(); input.select(); }); }, 0); });
      return card;
    }
    /* A CORRECTED order that was already confirmed says so loudly. The doctor
       approved different words a moment ago, and the note must carry what they
       approve NOW — so it goes back to needing a tap. */
    if (a.reconfirm) {
      card.appendChild(make('div', 'mlsAvOrdMiss', 'You corrected this after confirming it — confirm again to keep it in the note.'));
    }
    if (a.correctedBy) {
      card.appendChild(make('div', 'mlsAvOrdFix', '↻ corrected: “' + a.correctedBy + '”'));
    }
    var missing = a.missing || [];
    if (missing.length) {
      card.appendChild(make('div', 'mlsAvOrdMiss', 'Not stated: ' + ordersMissingText(a) + '. The avatar will not fill this in.'));
    }
    /* the ONE missing field a doctor can resolve in a single tap without
       typing. Everything else routes to Edit, which puts the words in their
       hands rather than inventing them. */
    if (missing.indexOf('side') >= 0) {
      var sideRow = make('div', 'mlsAvOrdSide');
      ['left', 'right', 'bilateral'].forEach(function (side) {
        var b = make('button', 'mlsAvOrdPick', side === 'bilateral' ? 'Both' : actTitleCase(side));
        b.type = 'button';
        b.addEventListener('click', function () {
          a.picked = side;
          a.fields.side = side;
          a.detail = (actTitleCase(side) + ' ' + (a.detail || '')).trim();
          a.missing = missing.filter(function (k) { return k !== 'side'; });
          ordersRender(); kioskAmbientSave(true);
        });
        sideRow.appendChild(b);
      });
      card.appendChild(sideRow);
    }
    var row = make('div', 'mlsAvOrdRow');
    var confirm = make('button', 'mlsAvOrdGo', 'Confirm');
    confirm.type = 'button';
    if ((a.missing || []).length) {
      confirm.disabled = true;
      confirm.title = 'Missing: ' + ordersMissingText(a);
    }
    confirm.addEventListener('click', function () {
      if ((a.missing || []).length) return;    /* the gate is enforced here too, not only by the attribute */
      a.status = 'confirmed';
      a.confirmedAt = Date.now();
      ordersRender(); kioskAmbientSave(true);
    });
    var edit = make('button', 'mlsAvOrdEdit', 'Edit');
    edit.type = 'button';
    /* INLINE, never window.prompt. A native dialog blocks the whole renderer -
       it would freeze the recording clock, the save badge and the microphone
       loop behind a modal the doctor may be holding open in front of a
       patient, and this app has already been wedged once by exactly that. */
    edit.addEventListener('click', function () { a.editing = true; ordersRender(); });
    var drop = make('button', 'mlsAvOrdNo', 'Dismiss');
    drop.type = 'button';
    drop.addEventListener('click', function () {
      a.status = 'dismissed';
      ordersRender(); kioskAmbientSave(true);
    });
    row.appendChild(confirm); row.appendChild(edit); row.appendChild(drop);
    card.appendChild(row);
    return card;
  }
  function ordersRender() {
    var host = gid('mlsAvKioskOrders');
    if (!host) return;
    var list = (kiosk.ambActions || []).filter(function (a) { return a.status !== 'dismissed'; });
    var counts = ordersCounts();
    /* NOTHING to show means nothing on screen. The widget is not a permanent
       panel competing with the patient for the doctor's attention - it
       appears when there is something to confirm and leaves when there is
       not. */
    if (!list.length) { host.style.display = 'none'; host.innerHTML = ''; return; }
    host.style.display = 'block';
    host.innerHTML = '';
    var head = make('div', 'mlsAvOrdHead');
    head.appendChild(make('span', 'mlsAvOrdTitle', 'Proposed actions'));
    var sub = counts.proposed
      ? (counts.proposed + ' to confirm' + (counts.confirmed ? ' · ' + counts.confirmed + ' confirmed' : ''))
      : (counts.confirmed + ' confirmed');
    head.appendChild(make('span', 'mlsAvOrdCount', sub));
    host.appendChild(head);
    var body = make('div', 'mlsAvOrdList');
    /* unconfirmed first: the thing that needs the doctor is the thing at the
       top of the widget */
    list.sort(function (x, y) {
      if (x.status === y.status) return x.at - y.at;
      return x.status === 'proposed' ? -1 : 1;
    });
    list.forEach(function (a) { body.appendChild(ordersCard(a)); });
    host.appendChild(body);
    host.appendChild(make('div', 'mlsAvOrdFoot', 'Nothing here is sent anywhere. Confirmed actions go into the visit note for you to place.'));
  }
  function ordersBlock() { return ordersBlockFrom(ordersConfirmed()); }
  function ordersBlockFrom(confirmed) {
    confirmed = (confirmed || []).filter(Boolean);
    if (!confirmed.length) return '';
    var lines = [AMBIENT_HEAD_ORDERS];
    confirmed.forEach(function (a) {
      lines.push('- [' + (ACT_KIND_LABEL[a.kind] || a.kind) + '] ' + a.title + (a.detail ? ' - ' + a.detail : '') +
        '  (heard: "' + a.heard + '")');
    });
    lines.push('[These were confirmed on screen by the doctor during the visit. They have NOT been transmitted to any EMR.]');
    return lines.join('\n');
  }
  function kioskAmbientClear() {
    ['ambCap', 'ambTick', 'ambRestart', 'ambSaveTimer', 'ambFlushTimer', 'ambDetectTimer'].forEach(function (key) {
      if (kiosk[key]) { safe(function () { clearTimeout(kiosk[key]); }); kiosk[key] = null; }
    });
  }
  function kioskAmbientElapsed() {
    var ms = Math.max(0, Date.now() - (kiosk.ambStart || Date.now()));
    var secs = Math.floor(ms / 1000), mins = Math.floor(secs / 60), hrs = Math.floor(mins / 60);
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return hrs ? (hrs + ':' + p2(mins % 60) + ':' + p2(secs % 60)) : (mins + ':' + p2(secs % 60));
  }
  function kioskAmbientWords() {
    var parts = kiosk.ambParts || [], n = 0;
    for (var i = 0; i < parts.length; i++) n += parts[i].split(/\s+/).filter(Boolean).length;
    return n;
  }
  function kioskAmbientClock() {
    var el = gid('mlsAvKioskRecClock');
    if (el) el.textContent = kioskAmbientElapsed() + '  |  ' + kioskAmbientWords() + ' words';
  }
  /* the clock is the LIVENESS proof: during a silent exam there are no
     recogniser events at all, so a label that only moved on speech would look
     identical to a capture that had quietly died. Self-rescheduling, bounded
     by the session - this module has no permanent polling. */
  function kioskAmbientTick() {
    if (!kiosk.ambient) return;
    kioskAmbientClock();
    kiosk.ambTick = setTimeout(kioskAmbientTick, 1000);
  }
  function kioskAmbientAppend(text) {
    var v = clean(text);
    if (!v) return;
    /* Chrome re-delivers the tail of the previous result after a restart. An
       EXACT repeat of the chunk just accepted is dropped; anything else is
       kept. Never the other way round - losing a real sentence of a
       consultation is far worse than keeping one duplicated one. */
    if (kiosk.ambLast === v) return;
    kiosk.ambLast = v;
    if (!kiosk.ambParts) kiosk.ambParts = [];
    kiosk.ambParts.push(v);
    /* the two things that must happen for EVERY finalised sentence: it
       reaches the crash backup, and it is offered to the action detector.
       Both are cheap and neither can throw into the recogniser callback. */
    safe(function () { kioskAmbientSave(false); });
    safe(function () { ordersDetectSoon(v); });
  }
  function kioskAmbientPaint(interim) {
    var iv = gid('mlsAvKioskInterim');
    if (iv) {
      var tail = clean(interim);
      if (!tail) { var parts = kiosk.ambParts || []; tail = parts.length ? parts[parts.length - 1] : ''; }
      iv.textContent = tail.length > 160 ? ('...' + tail.slice(tail.length - 160)) : tail;
    }
    kioskAmbientClock();
  }
  function kioskAmbientNoMic() {
    /* No recogniser at all. Say so and STOP: a red recording badge over a
       microphone that was never open is the one lie this feature must not
       tell. */
    var iv = gid('mlsAvKioskInterim');
    if (iv) iv.textContent = 'Staff: this browser cannot listen here, so nothing is being recorded.';
    kioskAmbientStop('no-microphone');
  }
  function kioskAmbientRetry() {
    if (!kiosk.ambient) return;
    if (kiosk.paused) return;         /* a restart while paused would reopen the mic behind the disclosure */
    /* End Visit stops the recogniser ON PURPOSE and then waits for its
       trailing final results. Without this the onend handler would read that
       deliberate stop as a death and reopen the microphone underneath the
       review screen - recording a room the doctor believes has stopped. */
    if (kiosk.ambClosing) return;
    if (kiosk.ambRestart) { safe(function () { clearTimeout(kiosk.ambRestart); }); kiosk.ambRestart = null; }
    /* A recogniser that RAN for a while and then ended is Chrome's ordinary
       behaviour, not a failure - it ends itself about once a minute and on
       every routine no-speech blip. Only INSTANT deaths are allowed to slow
       the loop down, or a quiet exam room would talk itself into a four
       second gap and lose the doctor's first sentence back in the room. */
    var lived = Date.now() - (kiosk.ambRecAt || 0);
    if (lived > 5000) kiosk.ambFails = 0;
    kiosk.ambFails = (kiosk.ambFails || 0) + 1;
    var wait = kiosk.ambFails > 6 ? 4000 : (kiosk.ambFails > 2 ? 800 : 200);
    kiosk.ambRestart = setTimeout(function () {
      kiosk.ambRestart = null;
      kioskAmbientListen();
    }, wait);
  }
  function kioskAmbientListen() {
    if (!kiosk.ambient) return false;
    if (kiosk.paused) return false;   /* paused means the microphone is CLOSED, not merely ignored */
    var C = safe(function () { return window.SpeechRecognition || window.webkitSpeechRecognition; }, null);
    if (!C) { kioskAmbientNoMic(); return false; }
    var rec = safe(function () { return new C(); }, null);
    if (!rec) { kioskAmbientRetry(); return false; }
    /* the old recogniser is torn down by hand with its handlers nulled FIRST,
       so our own stop() can never be read as "it died" and start a second
       restart. pvRec is set too, so every existing exit path in this file
       (pvStopVoice, kioskClose, revert) already kills this microphone. */
    if (pvRec) { safe(function () { pvRec.onresult = null; pvRec.onend = null; pvRec.onerror = null; pvRec.stop(); }); }
    pvRec = rec;
    kiosk.ambRec = rec;
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
    rec.onresult = function (ev) {
      if (!kiosk.ambient || kiosk.ambRec !== rec) return;
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var r = ev.results[i];
        if (r.isFinal) kioskAmbientAppend(String(r[0].transcript || ''));
        else interim += String(r[0].transcript || '');
      }
      kioskAmbientPaint(interim);
    };
    rec.onerror = function () { if (kiosk.ambRec === rec) { kiosk.ambRec = null; kioskAmbientRetry(); } };
    rec.onend = function () { if (kiosk.ambRec === rec) { kiosk.ambRec = null; kioskAmbientRetry(); } };
    var ok = safe(function () { rec.start(); return true; }, false);
    if (!ok) { if (kiosk.ambRec === rec) kiosk.ambRec = null; kioskAmbientRetry(); return false; }
    kiosk.ambRecAt = Date.now();
    return true;
  }
  function kioskIntakeAdd(who, text) {
    var v = clean(text);
    if (!v) return;
    if (!kiosk.intake) kiosk.intake = [];
    if (kiosk.intake.length > 400) return;    /* bounded - an interview is ~20 turns */
    kiosk.intake.push({ who: String(who || 'Avatar'), text: v });
  }
  function kioskIntakeText() { return intakeTextFrom(kiosk.intake); }
  function intakeTextFrom(rows) {
    rows = rows || [];
    var out = [];
    if (!rows.length) return '(no check-in answers were recorded in this session)';
    for (var i = 0; i < rows.length; i++) out.push(clean(rows[i] && rows[i].who) + ': ' + clean(rows[i] && rows[i].text));
    return out.join('\n');
  }
  function kioskAmbientBlock(body) {
    var mins = Math.max(1, Math.round((Date.now() - (kiosk.ambStart || Date.now())) / 60000));
    var lines = [];
    lines.push(AMBIENT_HEAD_CHECKIN);
    lines.push('[Avatar check-in - the patient\'s own words, chart ' + clean(kiosk.ambBound) + ']');
    lines.push(kioskIntakeText());
    lines.push('');
    lines.push(AMBIENT_HEAD_VISIT);
    lines.push('[Room capture - the avatar listened in the room for ' + mins + ' min. One microphone, so speakers are not separated.]');
    lines.push(body);
    /* Confirmed actions ride WITH the transcript, in the same write. Filing
       them separately would mean a visit whose note and whose orders could
       disagree about whether the write succeeded. */
    var orders = ordersBlock();
    if (orders) { lines.push(''); lines.push(orders); }
    return lines.join('\n');
  }
  function kioskAmbientFile() {
    if (kiosk.ambFiled) return { ok: false, why: 'this capture was already filed, so nothing was written again.' };
    /* PATIENT BINDING FAILS CLOSED - equality against the chart the check-in
       was bound to, evaluated HERE, at the write. */
    var bound = clean(kiosk.ambBound);
    var now = activePtIdSafe();
    if (!bound) return { ok: false, why: 'the recording was not bound to a chart, so nothing was written.' };
    if (!now) return { ok: false, why: 'no chart is open, so nothing was written. The recording belongs to chart ' + bound + '.' };
    if (now !== bound) return { ok: false, why: 'the open chart (' + now + ') is not the one this recording belongs to (' + bound + '), so nothing was written.' };
    var body = (kiosk.ambParts || []).join(' ').replace(/[ \t]+/g, ' ').trim();
    if (!body) return { ok: false, why: 'no speech was captured, so nothing was written.' };
    var box = gid('ez3flTranscript') || gid('ez3Transcript');
    if (!box || typeof box.value !== 'string') return { ok: false, why: 'the visit transcript box is not on this screen, so nothing was written.' };
    var block = kioskAmbientBlock(body);
    /* ADDITIVE AND NON-DESTRUCTIVE. The doctor's existing transcript is
       carried through BYTE FOR BYTE - no trim, no normalise, no rewrite of
       trailing whitespace - and the block is appended after it. Then the input
       event, which is the whole integration: it is what drives the app's
       transcript mirror to MERGE into #transcript instead of overwriting it. */
    var prior = box.value;
    box.value = prior + (prior ? '\n\n' : '') + block;
    safe(function () { box.dispatchEvent(new Event('input', { bubbles: true })); });
    kiosk.ambFiled = true;
    /* THE BACKUP DIES ONLY ON A PROVEN WRITE. Every refusal above returns
       before this line, so a capture that could not be filed (wrong chart
       open, no transcript box on screen) keeps its crash copy and can still
       be recovered on the next load. */
    ambientStoreDrop();
    safe(function () { if (isFn(window.toast)) window.toast('The visit recording is in the transcript - check-in and visit, in order.', 'ok'); });
    return { ok: true, chars: block.length };
  }
  /* ---- RECOVERY. What the backup is FOR. A capture survives the page that
     took it, so a reload mid-visit, a discarded tab or a crashed renderer
     costs the doctor one click instead of the consultation. The write obeys
     exactly the binding rule the live path obeys - the chart is compared at
     WRITE time, and a mismatch refuses and says which chart the words belong
     to rather than filing them somewhere plausible. ---------------------- */
  function ambientRecoverInfo() {
    var rec = ambientStoreRead();
    if (!rec) return null;
    /* A CAPTURE RUNNING IN THIS TAB IS NOT A RECOVERED ONE. The backup is
       written continuously while the room is being recorded, so without this
       the Visit card would offer "File the recovered visit" for a visit still
       in progress - filing half a consultation and dropping the backup that
       protects the other half. Recovery means the tab that took it is gone. */
    if (kiosk.ambient === true && clean(rec.sid) && clean(rec.sid) === clean(kiosk.sid)) return null;
    var body = (rec.parts || []).join(' ').replace(/[ \t]+/g, ' ').trim();
    if (!body) return null;
    var start = Number(rec.start) || 0, saved = Number(rec.savedAt) || 0;
    return {
      bound: clean(rec.bound), body: body, chars: body.length,
      words: body.split(/\s+/).filter(Boolean).length,
      savedAt: saved, trimmed: rec.trimmed === true,
      mins: (start && saved && saved > start) ? Math.max(1, Math.round((saved - start) / 60000)) : 0,
      actions: Array.isArray(rec.actions) ? rec.actions : [],
      intake: Array.isArray(rec.intake) ? rec.intake : []
    };
  }
  function ambientRecoverFile() {
    var info = ambientRecoverInfo();
    if (!info) return { ok: false, why: 'there is no recovered visit waiting.' };
    var now = activePtIdSafe();
    if (!now) return { ok: false, why: 'no chart is open. The recovered visit belongs to chart ' + info.bound + '.' };
    if (now !== info.bound) return { ok: false, why: 'the open chart (' + now + ') is not the one this recording belongs to (' + info.bound + ').' };
    var box = gid('ez3flTranscript') || gid('ez3Transcript');
    if (!box || typeof box.value !== 'string') return { ok: false, why: 'the visit transcript box is not on this screen — open the Visit recorder first.' };
    var lines = [];
    lines.push(AMBIENT_HEAD_CHECKIN);
    lines.push('[Avatar check-in - the patient\'s own words, chart ' + info.bound + ']');
    lines.push(intakeTextFrom(info.intake));
    lines.push('');
    lines.push(AMBIENT_HEAD_VISIT);
    lines.push('[Room capture RECOVERED after this page reloaded' +
      (info.trimmed ? ' - the backup had run out of room, so the EARLIEST part of this visit is missing' : '') +
      '. One microphone, so speakers are not separated.]');
    lines.push(info.body);
    var orders = ordersBlockFrom(info.actions.filter(function (a) { return a && a.status === 'confirmed'; }));
    if (orders) { lines.push(''); lines.push(orders); }
    var block = lines.join('\n');
    /* filing the same recovered capture twice would duplicate a whole visit
       in the note - the body is its own idempotency key */
    if (box.value.indexOf(info.body) >= 0) {
      ambientStoreDrop();
      return { ok: true, chars: 0, already: true };
    }
    var prior = box.value;
    box.value = prior + (prior ? '\n\n' : '') + block;
    safe(function () { box.dispatchEvent(new Event('input', { bubbles: true })); });
    ambientStoreDrop();
    return { ok: true, chars: block.length };
  }
  function kioskAmbientStart() {
    if (!kiosk.open) return false;
    if (kiosk.ambient) return true;
    var bound = clean(kiosk.ext);
    if (!bound) {
      /* refuse BEFORE the microphone opens - an unbindable recording could
         only ever end in a refusal to write, so it must not be taken */
      kioskSetSay('I cannot record this visit - the screen is not bound to a chart.');
      var iv0 = gid('mlsAvKioskInterim');
      if (iv0) iv0.textContent = 'Staff: open the patient, then start the check-in again. Nothing is being recorded.';
      return false;
    }
    /* Close the INTERVIEW row server-side first. The summary pipeline runs on
       that active->ready transition, and a row left 'active' is invisible to
       every status-filtered inbox query. Ambient capture is a local recording
       from here on: no turn is ever posted while it runs. */
    kioskCloseServerSide();
    kiosk.completed = true;
    kiosk.ambient = true;
    kiosk.ambBound = bound;
    kiosk.ambStart = Date.now();
    kiosk.ambParts = []; kiosk.ambLast = ''; kiosk.ambFails = 0;
    kiosk.ambFiled = false; kiosk.ambResult = null; kiosk.ambRec = null;
    kiosk.ambActions = []; kiosk.ambWindow = ''; kiosk.ambClosing = false;
    kiosk.ambEnding = false; kiosk.ambSaveOk = null; kiosk.ambSaveTrim = false;
    kiosk.ambSavedAt = 0;
    pvStopVoice();
    /* pvStopVoice deliberately LEAVES pvSaying set, so the last question would
       stay the echo template and the self-echo filter would silently eat real
       speech built from its words. Ambient never speaks - drop the template. */
    pvSaying = '';
    if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
    if (kiosk.deadTimer) { safe(function () { clearTimeout(kiosk.deadTimer); }); kiosk.deadTimer = null; }
    kioskAmbientClear();
    var pad = gid('mlsAvKioskPin'); if (pad) pad.style.display = 'none';
    var row = gid('mlsAvKioskTypeRow'); if (row) row.style.display = 'none';
    var pg = gid('mlsAvKioskProgress'); if (pg) pg.textContent = '';
    var root = gid('mlsAvKiosk'); if (root) root.classList.add('ambient');
    kioskSetSay('I am listening to the visit and taking notes for the doctor.');
    kioskMood('listening', '');
    kioskAmbientPaint('');
    /* HARD STOP. Ninety minutes and it ends itself and says so - a capture
       that rolled on would record the next patient in this room. */
    kiosk.ambCap = setTimeout(function () { kioskAmbientStop('cap'); }, AMBIENT_MAX_MS);
    kioskAmbientTick();
    ordersRender();
    /* Write the backup record BEFORE the first word. A capture that dies in
       its first thirty seconds still leaves proof it existed, with the chart
       it belonged to - the doctor learns that something was lost rather than
       wondering whether it was ever running. */
    kioskAmbientSave(true);
    kioskAmbientListen();
    return true;
  }
  /* ---- 3. END VISIT -----------------------------------------------------
     The recogniser is stopped on purpose and then WAITED ON: Chrome delivers
     any pending final result during stop(), and the last sentence of a visit
     is often the plan. Ending without that wait would drop it. ---------- */
  function kioskAmbientFlush(then) {
    kiosk.ambClosing = true;
    var rec = kiosk.ambRec;
    /* handlers stay attached - the tail results still have to arrive. The
       restart loop is disarmed by kiosk.ambClosing, not by unhooking. */
    if (rec) safe(function () { rec.stop(); });
    var waited = 0;
    (function poll() {
      waited += 120;
      if (!kiosk.ambRec || waited >= 960) { safe(then); return; }
      kiosk.ambFlushTimer = setTimeout(poll, 120);
    })();
  }
  /* ---- MUTE / PAUSE -----------------------------------------------------
     One control, both modes. During the INTERVIEW it silences the avatar and
     closes the microphone; during ROOM CAPTURE it stops recording. In both,
     the screen stops claiming to listen in the SAME action that closes the
     microphone - "paused" and "the screen says paused" are one fact off one
     class, exactly as the recording disclosure is.

     A pause that kept recording, or a screen still reading "Recording this
     visit" while paused, is the worst defect this file could ship: a patient
     asked for privacy and was told they had it. What was already captured is
     flushed to the backup BEFORE the microphone closes, so pausing can never
     cost the words already spoken. ------------------------------------- */
  function kioskPauseToggle() {
    kiosk.paused = !kiosk.paused;
    var root = gid('mlsAvKiosk'), btn = gid('mlsAvKioskMute'), recText = gid('mlsAvKioskRecText');
    if (btn) {
      btn.textContent = kiosk.paused ? '▶ Resume' : '⏸ Pause';
      btn.setAttribute('aria-pressed', kiosk.paused ? 'true' : 'false');
    }
    if (root) { if (kiosk.paused) root.classList.add('paused'); else root.classList.remove('paused'); }
    if (kiosk.paused) {
      if (kiosk.ambient) kioskAmbientSave(true);   /* nothing already heard is lost by pausing */
      pvStopVoice();                               /* stops the voice AND the microphone */
      kiosk.ambRec = null;
      kioskState('paused');
      if (recText) recText.textContent = 'PAUSED — not recording. Nothing is being captured right now.';
      kioskSetSay(kiosk.ambient ? 'Paused. I am not listening or recording.' : 'Paused. I am not listening.');
      return true;
    }
    if (recText) recText.textContent = AMBIENT_REC_TEXT;
    kioskState(kiosk.ambient ? 'documenting' : 'listening');
    if (kiosk.ambient) {
      kioskSetSay('I am listening to the visit and taking notes for the doctor.');
      kioskMood('listening', '');
      kioskAmbientListen();
    } else if (!kiosk.completed) {
      kioskSetSay(kiosk.lastSay || '');
      kioskListen();
    }
    return false;
  }
  function kioskEndVisit() {
    if (!kiosk.ambient || kiosk.ambEnding) return;
    kiosk.ambEnding = true;
    var root = gid('mlsAvKiosk'); if (root) root.classList.add('saving');
    kioskState('saving');
    kioskSetSay('Saving the visit…');
    var iv = gid('mlsAvKioskInterim');
    if (iv) iv.textContent = 'Finishing the recording and writing it to the transcript…';
    kioskAmbientFlush(function () {
      kioskAmbientSave(true);              /* the tail reaches the backup before the file attempt */
      var res = kioskAmbientStop('end-visit');
      if (root) root.classList.remove('saving');
      kioskReviewShow(res);
    });
  }
  /* THE REVIEW. It states what is true and nothing else: whether the words
     reached the transcript, how much, what the doctor confirmed, and - said
     plainly rather than left off - what was heard and never confirmed. */
  function kioskReviewShow(res) {
    var pane = gid('mlsAvKioskReview');
    if (!pane) return;
    var ok = !!(res && res.filed);
    pane.innerHTML = '';
    var card = make('div', 'mlsAvRevCard');
    card.appendChild(make('div', 'mlsAvRevHead' + (ok ? ' ok' : ' bad'),
      ok ? '✓ Saved to the visit transcript' : '⚠ Not saved'));
    var mins = Math.max(1, Math.round((Date.now() - (kiosk.ambStart || Date.now())) / 60000));
    card.appendChild(make('div', 'mlsAvRevLine', ok
      ? (mins + ' min captured · ' + kioskAmbientWords() + ' words · ' + ((res && res.chars) || 0) + ' characters written to the transcript for chart ' + clean(kiosk.ambBound) + '.')
      : ('Nothing was written: ' + ((res && res.why) || 'the capture could not be filed.'))));
    if (!ok) {
      card.appendChild(make('div', 'mlsAvRevWarn',
        'The words are still held in this browser under chart ' + clean(kiosk.ambBound) +
        '. Open that chart and use “File the recovered visit” on the Visit page - nothing has been thrown away.'));
    }
    if (kiosk.ambSaveOk === false) {
      card.appendChild(make('div', 'mlsAvRevWarn', ok
        ? 'Note: the crash backup could not be written while this visit ran (browser storage refused it). It did not matter this time - the transcript above saved normally.'
        : 'The crash backup could not be written while this visit ran either, so these words exist only in this tab. Copy them somewhere before you reload.'));
    } else if (kiosk.ambSaveTrim) {
      card.appendChild(make('div', 'mlsAvRevWarn',
        'The crash backup ran out of room and dropped its earliest sentences. The transcript above is complete; only the backup was trimmed.'));
    }
    var confirmed = ordersConfirmed();
    var pending = (kiosk.ambActions || []).filter(function (a) { return a.status === 'proposed'; });
    if (confirmed.length) {
      card.appendChild(make('div', 'mlsAvRevSub', 'Confirmed and written into the note (place them in the EMR from the chart):'));
      var ul = make('ul', 'mlsAvRevList');
      confirmed.forEach(function (a) {
        ul.appendChild(make('li', '', (ACT_KIND_LABEL[a.kind] || a.kind) + ': ' + a.title + (a.detail ? ' - ' + a.detail : '')));
      });
      card.appendChild(ul);
    }
    if (pending.length) {
      card.appendChild(make('div', 'mlsAvRevSub bad', 'Heard but NOT confirmed - these were not ordered and are not in the note:'));
      var ul2 = make('ul', 'mlsAvRevList bad');
      pending.forEach(function (a) {
        ul2.appendChild(make('li', '', (ACT_KIND_LABEL[a.kind] || a.kind) + ': ' + a.title +
          ((a.missing || []).length ? '  (missing ' + ordersMissingText(a) + ')' : '')));
      });
      card.appendChild(ul2);
    }
    if (!confirmed.length && !pending.length) {
      card.appendChild(make('div', 'mlsAvRevLine', 'No orders, prescriptions or referrals were recognised in this visit.'));
    }
    /* av-5.6.4 — THE DRAFT NOTE, STARTED HERE. The acceptance line is "End
       Visit -> complete note and actions ready for review", and filing a
       transcript is not a note. The app already owns note generation, so this
       calls the SAME function the Generate button calls rather than growing a
       second drafting path that could drift from it.
       It reports honestly: drafting, ready, or failed-with-a-retry. It never
       claims a note exists that does not, and it never blocks leaving — the
       transcript is already saved by the time this starts. */
    if (ok && isFn(window.generateNote)) {
      var noteLine = make('div', 'mlsAvRevNote', '✍️ Drafting the note from this visit…');
      card.appendChild(noteLine);
      var runNote = function () {
        noteLine.textContent = '✍️ Drafting the note from this visit…';
        noteLine.className = 'mlsAvRevNote';
        var done = false;
        var settle = function (good, why) {
          if (done) return;
          done = true;
          if (good) {
            noteLine.textContent = '✓ Draft note ready on the Visit page.';
            noteLine.className = 'mlsAvRevNote ok';
            return;
          }
          noteLine.textContent = '⚠ The note was not drafted' + (why ? ' (' + why + ')' : '') +
            '. The transcript IS saved — draft it from the Visit page.';
          noteLine.className = 'mlsAvRevNote bad';
          var retry = make('button', 'mlsAvRevMore', 'Try drafting again');
          retry.type = 'button';
          retry.addEventListener('click', function () {
            if (retry.parentNode) retry.parentNode.removeChild(retry);
            runNote();
          });
          noteLine.appendChild(document.createElement('br'));
          noteLine.appendChild(retry);
        };
        /* a note box that gains content is the proof, whatever the function
           returns — some versions resolve before the write lands */
        var box = gid('noteBox');
        var before = (box && typeof box.value === 'string') ? box.value.length : -1;
        var out = safe(function () { return window.generateNote(); }, null);
        if (out && isFn(out.then)) {
          out.then(function () {
            var b2 = gid('noteBox');
            settle(!!(b2 && typeof b2.value === 'string' && b2.value.trim().length > 0));
          }, function (e) { settle(false, String((e && e.message) || 'the drafter refused')); });
        }
        /* bounded fallback for the non-promise path: watch the box, give up
           honestly rather than spinning forever */
        var waited = 0;
        (function watch() {
          if (done) return;
          var b3 = gid('noteBox');
          var now = (b3 && typeof b3.value === 'string') ? b3.value.length : -1;
          if (now > 0 && now !== before) { settle(true); return; }
          waited += 500;
          if (waited >= 45000) { settle(false, 'it took too long'); return; }
          safe(function () { setTimeout(watch, 500); });
        })();
      };
      safe(function () { setTimeout(runNote, 0); });
    }
    var row = make('div', 'mlsAvRevRow');
    var back = make('button', 'mlsAvRevGo', 'Back to the chart');
    back.type = 'button';
    /* Ending the RECORDING needs no PIN - it is not a door into the app. The
       door still has the same lock it always had. */
    back.addEventListener('click', function () {
      if (kiosk.pinSet === false) { kioskEndForStaff('ended'); return; }
      pane.style.display = 'none';
      kioskRequestEnd();
    });
    row.appendChild(back);
    var again = make('button', 'mlsAvRevMore', 'Keep listening');
    again.type = 'button';
    again.addEventListener('click', function () {
      pane.style.display = 'none';
      /* a visit that is not over after all: a NEW capture, appended to the
         same chart on its own file. The filed one is never re-filed. */
      kiosk.ambEnding = false;
      kioskAmbientStart();
    });
    row.appendChild(again);
    card.appendChild(row);
    pane.appendChild(card);
    pane.style.display = 'flex';
  }
  function kioskAmbientStop(reason) {
    if (!kiosk.ambient) return null;
    kiosk.ambient = false;
    kiosk.ambRec = null;
    kioskAmbientClear();
    pvStopVoice();
    var res = kioskAmbientFile();
    kiosk.ambResult = { reason: String(reason || ''), filed: res.ok === true, why: res.why || '', chars: res.chars || 0 };
    var root = gid('mlsAvKiosk');
    if (root) root.classList.remove('ambient');
    if (!root) return kiosk.ambResult;      /* the overlay is already gone */
    kioskMood('speaking', 'thank you');
    var head = res.ok ? 'Recording stopped. The visit is in the doctor\'s transcript.'
                      : 'Recording stopped. Nothing was written.';
    if (reason === 'cap') {
      head = 'Recording stopped - the 90 minute limit was reached. ' +
        (res.ok ? 'The visit is in the doctor\'s transcript.' : 'Nothing was written.');
    }
    kioskSetSay(head);
    var iv = gid('mlsAvKioskInterim');
    if (iv) {
      iv.textContent = res.ok
        ? ('Staff: ' + res.chars + ' characters filed to the visit transcript for chart ' + clean(kiosk.ambBound) + '.')
        : ('Staff: ' + (res.why || 'the capture could not be filed.'));
    }
    return kiosk.ambResult;
  }
  /* Split out of kioskEndForStaff so BOTH staff outcomes close the interview
     row server-side: leaving, and staying to record. See the comment on
     kioskEndForStaff for why an 'active' row that is never closed strands the
     patient's answers in every surface. */
  function kioskCloseServerSide() {
    if (kiosk.open && !kiosk.completed && kiosk.sid && kiosk.ext) {
      safe(function () {
        api('/api/avatar/office/turn', { method: 'POST', body: JSON.stringify({
          clientSessionId: kiosk.sid, patientExternalId: kiosk.ext, finish: true }) })
          .then(function () { refreshCount(true); }, function () {});
      });
    }
  }
  function openKiosk() {
    var activeId = activePtIdSafe();
    if (!activeId) { toast('Open the patient first — the interview files to their chart.'); return; }
    if (kiosk.open) return;
    kioskStyle(); style();
    kiosk.open = true; kiosk.busy = false; kiosk.lastTry = null; kiosk.tinted = false;
    kiosk.pinSet = null; /* unknown until the server says — unknown means LOCKED */
    kiosk.photoFace = false; kiosk.completed = false; kiosk.silent = 0;
    kiosk.finishTries = 0; kiosk.heard = false;
    /* undefined means "not resolved yet"; null means "resolved to nothing".
       Both must reset, or the previous patient's chart block would ride into
       the next interview. */
    kiosk.chartCtx = undefined;
    /* kiosk.look and kiosk.nudgedFor already leak across interviews in this
       file. The recording state must never join them - it carries a
       patient's words, and a leak here is a cross-patient transcript. */
    kioskAmbientClear();
    kiosk.ambient = false; kiosk.ambParts = []; kiosk.ambLast = ''; kiosk.ambBound = '';
    kiosk.ambFiled = false; kiosk.ambResult = null; kiosk.ambRec = null; kiosk.ambFails = 0;
    kiosk.ambStart = 0; kiosk.ambRecAt = 0; kiosk.intake = []; kiosk.avName = '';
    /* the proposed actions carry a patient's clinical plan and must leak
       across interviews exactly as little as the transcript does */
    kiosk.ambActions = []; kiosk.ambWindow = ''; kiosk.ambClosing = false;
    kiosk.ambEnding = false; kiosk.ambSaveOk = null; kiosk.ambSaveTrim = false; kiosk.ambSavedAt = 0;
    kiosk.paused = false;   /* a paused kiosk must never be inherited by the next patient */
    kiosk.ext = activeId;
    kiosk.sid = 'office-' + Date.now().toString(36) + '-' + kioskNonce().slice(3);
    var root = document.createElement('div'); root.id = 'mlsAvKiosk';
    root.innerHTML =
      '<button type="button" id="mlsAvKioskEnd">End interview</button>' +
      '<div id="mlsAvKioskFaceWrap"><div id="mlsAvKioskFace"></div></div>' +
      '<div id="mlsAvKioskWave"><span></span><span></span><span></span><span></span><span></span></div>' +
      '<div id="mlsAvKioskName">One moment…</div>' +
      /* av-5.6.3 - THE AI DISCLOSURE. This screen can wear the doctor's own
         face (faceMode 'photo') and speak in a voice chosen to sound like
         them. Without this line a patient has no way to know they are not
         talking to their doctor - which is impersonation, not a feature.
         Mounted with the kiosk and never removed, in BOTH the interview and
         the room-capture modes, so it cannot be turned off by a state change.
         The spoken half lives in the backend's INTERVIEW_SYSTEM rule 9: the
         first thing it SAYS also identifies it. */
      '<div id="mlsAvKioskState" role="status" data-state="ready">Ready</div>' +
      '<div id="mlsAvKioskAi">🤖 AI assistant — not the doctor. What you tell me goes to your care team.</div>' +
      /* mute/pause: the patient stops being recorded the instant it is
         pressed, and the screen says so. See kioskPauseToggle. */
      '<button type="button" id="mlsAvKioskMute" aria-pressed="false">Pause</button>' +
      '<div id="mlsAvKioskSay">Getting ready…</div>' +
      '<div id="mlsAvKioskMic"><i></i>Listening — just talk, I\'ll know when you\'re finished</div>' +
      /* the PERMANENT recording disclosure - mounted with the kiosk, shown by
         the .ambient class alone, and never removed while capture runs */
      '<div id="mlsAvKioskRec" role="status"><i aria-hidden="true"></i><span id="mlsAvKioskRecText">' + AMBIENT_REC_TEXT + '</span><b id="mlsAvKioskRecClock" aria-hidden="true">0:00</b><em id="mlsAvKioskSave" data-state="ok">Saved</em></div>' +
      /* av-5.6.0: ONE control ends the visit. It ends the RECORDING and opens
         the review - it is not a way into the app, so it carries no PIN; the
         way back to the chart still does. */
      '<button type="button" id="mlsAvKioskEndVisit">End visit &amp; review</button>' +
      /* the orders widget mounts empty and stays invisible until something is
         actually proposed - see ordersRender */
      '<div id="mlsAvKioskOrders" role="region" aria-label="Proposed actions"></div>' +
      '<div id="mlsAvKioskReview" role="dialog" aria-label="Visit review"></div>' +
      '<div id="mlsAvKioskInterim"></div>' +
      '<div id="mlsAvKioskProgress"></div>' +
      /* NO buttons for the patient — the conversation IS the interface. The
         typed row appears by itself only when the microphone is unavailable.
         Saying "can you repeat that?" is handled by the interviewer itself. */
      '<div id="mlsAvKioskTypeRow"><textarea rows="2" id="mlsAvKioskInput" placeholder="Type your answer…"></textarea><button type="button" id="mlsAvKioskSend">Send</button></div>' +
      /* staff-only exit gate — shown when an exit PIN is configured */
      '<div id="mlsAvKioskPin"><div id="mlsAvKioskPinCard">' +
        '<div id="mlsAvKioskPinTitle">Staff only</div>' +
        '<div id="mlsAvKioskPinSub">Enter the exit PIN, then choose what happens next.</div>' +
        '<input id="mlsAvKioskPinInput" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="PIN">' +
        '<div id="mlsAvKioskPinMsg"></div>' +
        '<div id="mlsAvKioskPinRow"><button type="button" id="mlsAvKioskPinGo">Unlock &amp; end</button>' +
          '<button type="button" id="mlsAvKioskPinAmb">Unlock &amp; keep listening</button>' +
          '<button type="button" id="mlsAvKioskPinBack">Back to the interview</button></div>' +
        '<div id="mlsAvKioskPinNote">Keep listening records this visit in the room and puts it in the transcript under the check-in. The screen says so, in words, the whole time.</div>' +
      '</div></div>';
    (document.body || document.documentElement).appendChild(root);
    root.querySelector('#mlsAvKioskEnd').addEventListener('click', kioskRequestEnd);
    root.querySelector('#mlsAvKioskEndVisit').addEventListener('click', kioskEndVisit);
    root.querySelector('#mlsAvKioskMute').addEventListener('click', kioskPauseToggle);
    root.querySelector('#mlsAvKioskPinGo').addEventListener('click', function () { kioskPinSubmit('end'); });
    root.querySelector('#mlsAvKioskPinAmb').addEventListener('click', function () { kioskPinSubmit('ambient'); });
    root.querySelector('#mlsAvKioskPinInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); kioskPinSubmit('end'); } });
    root.querySelector('#mlsAvKioskPinBack').addEventListener('click', function () {
      var pad = gid('mlsAvKioskPin'); if (pad) pad.style.display = 'none';
      /* a FINISHED interview stays at rest — Back never reopens the mic */
      if (kiosk.open && !kiosk.busy && !kiosk.completed) kioskListen();
    });
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
    /* typing IS activity — it must reset the self-end watchdog the same way
       speech does, or a slow typist gets cut off mid-answer */
    root.querySelector('#mlsAvKioskInput').addEventListener('input', function () { kiosk.heard = true; });
    /* the LIVING face */
    kiosk.face = makeFace(gid('mlsAvKioskFace'), kiosk.look || null);
    kioskState('ready');
    /* TRUE fullscreen + the audio engine, both on the doctor's click (the
       one user gesture Chrome honours for either) */
    safe(function () {
      var el = document.documentElement;
      if (el.requestFullscreen) { var p = el.requestFullscreen({ navigationUI: 'hide' }); if (p && p.catch) p.catch(function () {}); }
    });
    ttsEnsureCtx();
    /* av-5.6.4 — the silence nudge is a CONSTANT string, so its audio can be
       made now, while the doctor is still handing the screen over. When it is
       needed the patient has already gone quiet and is waiting; paying a round
       trip at that exact moment is the worst possible time to spend one. Costs
       one request per interview and warms the TTS connection for the first
       real question as a side effect. */
    safe(function () { ttsFetchUrl(NUDGE_LINE, null); });
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
    var pend = safe(function () { return ambientRecoverInfo(); }, null);
    var sig = (activeHit ? 'a' + activeHit.id : 'n') + '|' + total + '|' + activeId +
      '|' + (pend ? 'r' + pend.bound + ':' + pend.chars : 'r0');
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
    /* Always rendered: gating it on an active patient made it VANISH, which
       reads as "the feature was removed" (the owner reported exactly that).
       openKiosk() already refuses honestly with a toast naming the
       precondition  that refusal is only reachable if the button is. */
    if (!activeHit) head.appendChild(visitButton('🎙 Start check-in interview', true, function () { openKiosk(); }));
    head.appendChild(visitButton(activeHit ? 'All check-ins' : (total ? 'Open check-ins' : 'Open'), false, function () { open(); }));
    /* av-2.0.2: flag FIRST, then open — the old order consumed the flag
       before it was set (Set up landed on the Ready tab) and left it armed
       to hijack the doctor's NEXT open. */
    if (!activeHit) head.appendChild(visitButton('Set up', false, function () { openSetupTab(); open(); }));
    card.appendChild(head);

    /* av-5.6.0 - A ROOM CAPTURE SURVIVED THE PAGE. It is announced here, on
       the screen the doctor is already looking at, with the chart it belongs
       to named out loud. It is never filed automatically: this browser cannot
       know whether the doctor already retyped the visit by hand. */
    if (pend) {
      var rec = make('div', '');
      rec.style.cssText = 'margin-top:10px;padding:10px 12px;border:1px solid #d8c6bf;border-radius:10px;background:#FBF3F0';
      var mine = pend.bound && activeId && pend.bound === activeId;
      var when = pend.savedAt ? formatDate(new Date(pend.savedAt).toISOString()) : '';
      var recLine = make('div', '', '🎙 A recorded visit was saved before this page reloaded' +
        (pend.mins ? ' (' + pend.mins + ' min, ' : ' (') + pend.words + ' words)' +
        (when ? ', last saved ' + when : '') + '.');
      recLine.style.cssText = 'font:700 12.5px/1.5 system-ui;color:#7a1f16';
      rec.appendChild(recLine);
      var recSub = make('div', '', mine
        ? 'It belongs to this chart. Nothing has been written yet.'
        : 'It belongs to chart ' + pend.bound + ' — open that chart to file it. It will not be written anywhere else.');
      recSub.style.cssText = 'font:500 12px/1.5 system-ui;color:#55605A;margin-top:3px';
      rec.appendChild(recSub);
      if (pend.trimmed) {
        var trimLine = make('div', '', 'The backup ran out of room, so the earliest part of this visit is missing.');
        trimLine.style.cssText = 'font:600 11.5px/1.45 system-ui;color:#7a1f16;margin-top:3px';
        rec.appendChild(trimLine);
      }
      var recActions = make('div', 'mlsAvActions');
      recActions.style.marginTop = '8px';
      if (mine) {
        recActions.appendChild(visitButton('File the recovered visit', true, function (b) {
          var out = ambientRecoverFile();
          if (out.ok) {
            b.disabled = true; b.textContent = out.already ? 'Already in transcript ✓' : 'Filed ✓';
            toast(out.already
              ? 'That recovered visit was already in the transcript — nothing was written twice.'
              : 'The recovered visit is in the transcript.');
            safe(function () { ensureVisitCard(); });
          } else toast('Not filed — ' + out.why);
        }));
      }
      recActions.appendChild(visitButton('Copy it', false, function (b) {
        var info = ambientRecoverInfo();
        if (!info) { toast('There is no recovered visit waiting.'); return; }
        safe(function () {
          navigator.clipboard.writeText(info.body).then(function () {
            b.textContent = 'Copied ✓';
          }, function () { toast('Could not copy — select the text from the transcript instead.'); });
        });
      }));
      /* Discard is DELIBERATE and says what it costs. Without it a capture
         the doctor has already handled would sit here forever, and the one
         thing worse than losing a visit is being nagged about a visit that
         was never lost. */
      /* TWO TAPS, no native dialog. window.confirm blocks the renderer, and
         this button deletes a consultation - it needs a deliberate second
         action, not a modal that can be dismissed by reflex. The button says
         what it is about to destroy before it destroys it. */
      recActions.appendChild(visitButton('Discard', false, function (b) {
        if (b.getAttribute('data-armed') !== '1') {
          b.setAttribute('data-armed', '1');
          b.textContent = 'Delete ' + pend.words + ' words?';
          b.style.color = '#7a1f16';
          safe(function () {
            setTimeout(function () {
              if (!b || b.getAttribute('data-armed') !== '1') return;
              b.removeAttribute('data-armed'); b.textContent = 'Discard'; b.style.color = '';
            }, 6000);
          });
          return;
        }
        ambientStoreDrop();
        toast('The recovered recording was deleted.');
        safe(function () { ensureVisitCard(); });
      }));
      rec.appendChild(recActions);
      card.appendChild(rec);
    }

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
          /* The refetch must be PROVEN, not assumed: detail.summary was already
             pre-seeded with the 4000-char cache truncation, so testing it after
             a failed refetch (non-2xx, or a colleague already marked the row
             seen) passed on the STALE cut — filing a mid-sentence slice into
             the chart, where the stamp guard then blocks the real summary
             forever, under a toast that said it worked. */
          var found = null;
          for (var j = 0; j < rows.length; j++) if (rows[j].id === detail.id) { found = rows[j]; break; }
          if (found && found.summary) {
            detail.summary = found.summary; detail.ready_at = found.ready_at;
            needSummary = false; run();
          } else toast('Could not load the full summary — open All check-ins and use it from there.');
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
  function onVisitContext() {
    /* THE CHART CHANGED UNDER A LIVE RECORDING. Everything said from here
       belongs to whoever is on screen now, so the microphone closes at
       once - and the write is refused, because the words already captured
       belong to the patient whose chart just left. */
    if (kiosk.ambient && activePtIdSafe() !== clean(kiosk.ambBound)) kioskAmbientStop('patient-changed');
    ensureVisitCard();
  }
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
    kioskEndForStaff('ended');
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
    closeKiosk: function () { kioskEndForStaff('ended'); },
    /* diagnostics: render the drawn character anywhere, so a look can be
       inspected (and pinned) without opening a kiosk in front of a patient */
    faceDemo: function (mount, look) { return makeFace(mount, faceLookSafe(look)); },
    /* diagnostics: derive a look from a portrait without touching Setup, so
       the matcher can be proven against real pixels. */
    deriveLookFromPhoto: function (dataUrl, then) { return faceTintFromPortrait(dataUrl, then); },
    /* diagnostics only: whether a room capture is running and how much it
       holds. READ-ONLY on purpose - starting a recording is a staff action
       behind the exit PIN and has no programmatic door. */
    ambientState: function () {
      return {
        running: kiosk.ambient === true,
        boundPatient: clean(kiosk.ambBound),
        startedAt: kiosk.ambStart || null,
        capturedChars: (kiosk.ambParts || []).join(' ').length,
        filed: kiosk.ambFiled === true,
        last: kiosk.ambResult || null,
        /* av-5.6.0: the backup and the proposal queue are part of "how much it
           holds" — a capture that is running but not backed up is a different
           state from one that is, and QA must be able to tell them apart. */
        backedUp: kiosk.ambSaveOk === null ? null : kiosk.ambSaveOk === true,
        backupTrimmed: kiosk.ambSaveTrim === true,
        actions: ambientActionsForStore()
      };
    },
    /* av-5.6.0 diagnostics. detectActions is PURE — it reads its argument and
       touches nothing — so a proposal set can be proven against any sentence
       without a microphone, a kiosk or a patient. */
    detectActions: function (sentence) { return detectActions(sentence); },
    /* the recovered-capture surface: what survived a reload, and the same
       fail-closed write the visit card calls. Reading never files. */
    pendingCapture: function () { return ambientRecoverInfo(); },
    fileRecoveredCapture: function () { return ambientRecoverFile(); },
    discardRecoveredCapture: function () { ambientStoreDrop(); return true; },
    refreshCount: refreshCount,
    exactPatient: exactPatient,
    importSummary: importSummary,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})();
