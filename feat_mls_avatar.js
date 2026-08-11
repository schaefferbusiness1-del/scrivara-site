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

  var VERSION = 'av-5.7.0';
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
      /* av-5.7.0 - the pre-visit headline. Bigger than the bullets on purpose:
         it is the line a doctor reads while opening the door. */
      '.mlsAvBrief{margin-top:9px;font:700 15.5px/1.4 \'Public Sans\',system-ui;color:#204034;background:#EAF1EE;border-left:4px solid #2E6A4B;border-radius:8px;padding:9px 11px}' +
      '.mlsAvBrief.flag{color:#7a1f16;background:#F7E4E1;border-left-color:#c0392b}' +
      '.mlsAvAskHead{margin-top:10px;font:800 12px system-ui;color:#55605A;text-transform:uppercase;letter-spacing:.4px}' +
      '.mlsAvAsk{margin:4px 0 0;padding-left:19px;font-size:13px;color:#26417a;display:grid;gap:3px}' +
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
            /* A SLICE IS A TRUNCATION AND MUST SAY SO - the same law the summary
               field above already obeys. The bullets now travel into the chart and
               into the visit transcript (briefLines), and the server writes up to
               SIX of them: filing this three-bullet display sample would have
               dropped bullets 4-6 silently, and the ⚠ emergency bullet is
               unshifted to the FRONT, so what went missing was the tail of the
               clinical detail. The card refetches the full row before filing. */
            bulletsTruncated: (Array.isArray(c.bullets) ? c.bullets : []).length > 3,
            /* av-2.0.0: the Visit card files the summary into transcript/chart
               without a second fetch — bounded to keep the cache small.
               av-2.0.2: a slice is a TRUNCATION and must say so — the card
               refetches the full row before filing a truncated one, or a
               mid-sentence cut would be stamped into the chart forever. */
            summary: c.summary ? String(c.summary).slice(0, 4000) : null,
            truncated: !!(c.summary && String(c.summary).length > 4000),
            flags: Array.isArray(c.flags) ? c.flags : [],
            /* av-5.7.0: the headline rides in the cache too, or the Visit card -
               the surface the doctor actually looks at - would be the one place
               the brief never reaches. It is one short line; nothing about the
               cache's size argument applies to it. */
            /* 280, not 200. The server may PREPEND "⚠ EMERGENCY LANGUAGE IN
               CHECK-IN — " to a headline that is already up to 200 characters, so
               the stamped line runs to about 250 - and a 200-character cut here
               silently amputated the end of the one line the doctor reads first,
               on exactly the check-ins where it matters most. A cap below the
               longest value the writer can produce is a truncation presented as a
               field. */
            headline: c.headline ? String(c.headline).slice(0, 280) : null,
            /* the Visit card never carried these, so the doctor's most-used surface
               could not show the auditor's verdict or the gaps at all - a
               pre-existing omission that only became visible once 'rejected'
               existed to be dropped */
            audited: c.audited || null,
            askAbout: (Array.isArray(c.askAbout) ? c.askAbout : []).slice(0, 3).map(function (a) { return String(a).slice(0, 160); })
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
  /* Used only to decide whether the chart block may say "TODAY" out loud - see
     importSummary. Unparseable or missing timestamps answer NO, so the sentence
     is never printed on a check-in we cannot date. */
  function isToday(value) {
    return safe(function () {
      var d = new Date(String(value).indexOf('T') < 0 ? String(value).replace(' ', 'T') + 'Z' : value);
      if (isNaN(d.getTime())) return false;
      var now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }, false);
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
  /* THE AUDIT VERDICT TRAVELS WITH THE WORDS (av-5.7.2, review round three).
     The summary the doctor reads is written by one model and checked by another.
     Every surface that SHOWS the summary was rendering all four verdicts
     identically, and both paths that write it into the permanent record - the
     chart (importSummary) and the visit transcript (addToTranscript) - dropped the
     verdict entirely. So a summary the auditor REJECTED, meaning it could not be
     reconciled with what the patient actually said, landed in the chart under
     "Added to chart ✓" and fed the note draft, indistinguishable from a verified one.
     Every state gets a line, including the absent one: silence is what made
     "never audited" and "audit failed" the same fact. Absent is real and expected -
     an older backend does not send the field at all. */
  function auditNote(audited) {
    var a = clean(audited);
    if (a === 'rejected') {
      return '[⚠ AI AUDIT REJECTED THIS SUMMARY — it could not be reconciled with the ' +
        'patient\'s own answers. Treat it as unverified and read the check-in itself before relying on it.]';
    }
    if (a === 'corrected') return '[AI audit: corrected against the patient\'s answers.]';
    if (a === 'passed') return '[AI audit: checked against the patient\'s answers.]';
    return '[AI audit: no verdict recorded for this check-in.]';
  }
  /* THE RED FLAG AND THE BULLETS TRAVEL WITH THE WORDS (av-5.7.6, review round four).
     Both paths into the permanent record - the chart (importSummary) and the visit
     transcript (addToTranscript, which is the box the note is DRAFTED from) - built
     their block out of `checkin.summary` and NOTHING else. Every deterministic
     emergency cure the backend has was installed on the two fields that did not
     travel: patientAvatar.js unshifts "⚠ Patient used emergency-sounding language
     during check-in" into bullets[0] and prefixes "⚠ EMERGENCY LANGUAGE IN CHECK-IN
     — " onto the headline, and leaves summary.summary untouched. So a check-in the
     server FLAGGED became byte-for-byte indistinguishable from a routine one the
     moment the doctor filed it - under a line saying the summary had been checked.
     It is patient WORDS, not a glyph: SUMMARY_VERIFY_SYSTEM rule 2 lets a
     doctor-important patient-stated fact (it names medication changes and red flags)
     live in the BULLETS ALONE and still pass the audit, so a borrowed nitroglycerin
     tablet or a new arm numbness could be in bullets[1] and nowhere else.
     askAbout deliberately does NOT travel. It is a list of what nobody knows yet,
     not something the patient said, and neither note prompt has any notion of a
     check-in block - "Worth asking whether the patient has taken aspirin today"
     riding inside the transcript risks becoming a plan item never discussed.
     A bullet whose text is already inside the note body is SKIPPED: the same
     sentence written twice reads as the patient having said it twice. */
  function briefLines(checkin) {
    var lines = [];
    var body = clean(checkin.summary).toLowerCase();
    var head = clean(checkin.headline);
    var flags = Array.isArray(checkin.flags) ? checkin.flags : [];
    /* the flag is stamped from a column, so it survives a summary that never
       mentioned it; the headline's own ⚠ is the same fact and is not repeated */
    if (flags.indexOf('emergency-language') >= 0 && !/^⚠/.test(head)) {
      lines.push('⚠ EMERGENCY LANGUAGE IN CHECK-IN — the patient used emergency-sounding words while checking in. Read the check-in itself before relying on the summary below.');
    }
    if (head) lines.push(head);
    var bullets = Array.isArray(checkin.bullets) ? checkin.bullets : [];
    var kept = [];
    for (var bi = 0; bi < bullets.length; bi++) {
      var b = clean(bullets[bi]);
      if (!b) continue;
      if (body && body.indexOf(b.toLowerCase()) >= 0) continue;
      kept.push('• ' + b);
    }
    if (kept.length) {
      lines.push('Check-in key points (patient-reported):');
      lines = lines.concat(kept);
    }
    return lines.length ? (lines.join('\n') + '\n') : '';
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
    /* THE CHART BLOCK SAYS WHEN IT IS FROM (av-5.7.6). patient.summary is emitted to
       the note model as "Running history / prior-visit summary", inside a line that
       tells it "this is history, NOT today's encounter - do NOT invent exam findings,
       vitals, ROS, or new diagnoses from it". That is right for the running history and
       wrong for a check-in the patient finished twenty minutes ago, and the note system
       prompt never states today's date, so the model has no way to tell. This one
       sentence is the only thing that can: it rides INSIDE summary (a new field on the
       patient row would die on the next upsert - upsertPatient is REPLACE-shaped), and
       it is added AFTER the stamp so the stamp stays the untouched idempotency key -
       changing that key would have re-filed every block already in every chart. */
    var todayLine = isToday(checkin.ready_at)
      ? '[TODAY\'s pre-visit check-in — the patient\'s own reported words for THIS encounter, not prior history.]\n' : '';
    /* the verdict sits between the stamp and the words, so it cannot be read as
       part of either - see auditNote */
    var block = stamp + '\n' + todayLine + auditNote(checkin.audited) + '\n' + briefLines(checkin) + String(checkin.summary || '').trim();
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
      ' · ' + (Number(checkin.turns) || 0) + ' turns' +
      /* 'rejected' HAS A SURFACE NOW. The backend gained that state and every
         consumer gave it the empty arm - byte-for-byte the rendering of null,
         which means "never audited". A note the auditor refused and could not
         replace read exactly like an ordinary one. */
      (checkin.audited === 'corrected' ? ' · summary corrected by the audit pass' :
       checkin.audited === 'passed' ? ' · summary audited' :
       checkin.audited === 'rejected' ? ' · ⚠ THE AUDIT REJECTED THIS SUMMARY — read the transcript' : '')));
    /* av-5.7.0 - THE HEADLINE, FIRST AND BIGGEST. The owner asked for a summary
       that "tells the docotor the improatn parts before he sees the pateint",
       and a brief the doctor has to read four labelled lines of is not that. A
       flagged headline arrives already carrying its own ⚠ from the server, so
       the class follows the content rather than being decided again here. */
    /* mlsAvBrief, NOT mlsAvHead: .mlsAvHead is already the panel's own header
       and carries `display:flex` - reusing it would have laid the headline out
       as a flex row of words. */
    if (checkin.headline) {
      card.appendChild(make('div', 'mlsAvBrief' + (/^⚠/.test(String(checkin.headline)) ? ' flag' : ''),
        String(checkin.headline)));
    }
    if (Array.isArray(checkin.bullets) && checkin.bullets.length) {
      var ul = make('ul', 'mlsAvBullets');
      checkin.bullets.forEach(function (bullet) {
        var li = make('li', /^⚠/.test(String(bullet)) ? 'flag' : '', String(bullet));
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    if (checkin.summary) card.appendChild(make('div', 'mlsAvSummary', String(checkin.summary)));
    /* WHAT THE CHECK-IN DID NOT SETTLE. Kept visually distinct from the bullets
       because it is the opposite kind of information: the bullets are what the
       patient said, this is what nobody knows yet. It names gaps only - the
       server's own prompt forbids a diagnosis, a test or a drug here. */
    if (Array.isArray(checkin.askAbout) && checkin.askAbout.length) {
      card.appendChild(make('div', 'mlsAvAskHead', 'Worth asking — this check-in did not settle:'));
      var ask = make('ul', 'mlsAvAsk');
      checkin.askAbout.forEach(function (item) { ask.appendChild(make('li', '', String(item))); });
      card.appendChild(ask);
    }
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
    /* THE ROUTE INTO TODAY'S NOTE MUST SURVIVE "MARK SEEN" (av-5.7.6).
       Filing into the visit TRANSCRIPT is the only route that stamps the words as
       today-side, patient-reported text in the box the note is drafted from - and it
       existed on the Visit card alone, which renders only while the row is still in
       the status=ready answer that feeds lastReady. One tap on "Mark seen" - by the
       doctor, a colleague, or the phone - removes the row from that answer, and the
       transition is one-way (the backend's UPDATE is `WHERE id = ? AND status =
       'ready'` and nothing anywhere sets 'seen' back). From then on this panel's only
       file button was "Add to visit summary", i.e. the CHART, which ScribeFlow emits
       to the note model as "Running history / prior-visit summary" under an
       instruction not to build today's findings from it. So a symptom reported this
       morning reached the note labelled as prior history, or not at all.
       BOUND, NOT GLOBAL. addToTranscript writes into whichever visit is open, and the
       Visit card could only ever offer it for the OPEN patient. Reached from the
       panel it has to prove that itself: filing one patient's check-in into another
       patient's visit transcript would be the worst defect on this screen, so this
       refuses, names the chart to open, and writes nothing. */
    var txBtn = make('button', 'mlsAvAction', 'Add to visit transcript');
    txBtn.type = 'button';
    if (patient && checkin.summary) {
      txBtn.addEventListener('click', function () {
        var openId = activePtIdSafe();
        if (!openId || (openId !== clean(patient.id) && openId !== clean(checkin.patient_external_id))) {
          toast('Nothing was written: open ' + (patient.name || 'this patient') +
            '\'s visit first, then use this button — the transcript belongs to whichever chart is open.');
          return;
        }
        addToTranscript(checkin, txBtn);
      });
    } else {
      txBtn.disabled = true;
      txBtn.title = patient ? 'No summary to file.' : 'Needs an exact chart match first.';
    }
    actions.appendChild(txBtn);
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
  /* WHICH OF THE EIGHT BACKEND VOICES IS CONFIGURED, so the fallback can pick a
     browser voice of the same sex. Filled from the turn response (see
     kioskSetIdentity); null until the first turn lands, which is honest - before
     that we genuinely do not know. */
  var pvWantMale = null;
  /* THE FALLBACK USED TO CHANGE THE AVATAR'S SEX MID-INTERVIEW — av-5.8.1.
     This runs on every network hiccup, not in some corner case: one failed or
     slow TTS fetch sets ttsDownUntil two minutes into the future, so the browser
     voice speaks the next several questions. The old picker took the first of
     four hard-coded names and, failing all four, THE FIRST en VOICE IN THE LIST
     - which on Windows is normally "Microsoft David", a man. A practice running
     the default `coral` (female) therefore had its avatar answer in a male voice
     for two minutes and then switch back, wearing the same face, mid-interview.
     Nothing about that reads as "a person"; it reads as a broken machine.
     Three things changed:
       1. SEX FIRST. The configured backend voice is known (pvWantMale), so
          candidates of the wrong sex are ranked below every candidate of the
          right one. Continuity of identity outranks absolute voice quality -
          a slightly worse voice of the right sex is far less jarring.
       2. THE NATURAL VOICES WIN WHEN THEY EXIST. Windows ships its good voices
          as "Microsoft Aria Online (Natural)" and the robotic ones as plain
          "Microsoft Zira"/"David". The old list named 'Microsoft Aria' without
          preferring the Natural variant, and put 'Google US English' - the
          synthetic-sounding one - ahead of both. Scored on the name now, so a
          machine that HAS a natural voice always uses it.
       3. IT SCORES INSTEAD OF SHORT-CIRCUITING. `indexOf(name) >= 0` returning
          the first match meant list order inside the browser decided the
          outcome, which is not something we control or can test against.
     Deliberately NOT a denylist: a voice we have never heard of scores 0 and is
     still usable, which is the only behaviour that survives a new browser. */
  /* language is a HARD gate and separate from the score, because a score can go
     negative (wrong sex) and "no voice at all" must never win against a usable
     English one - that would hand the line to whatever the browser defaults to,
     which is the outcome this function exists to avoid */
  function pvVoiceUsable(v) { return /^en(-|_)/i.test(String((v && v.lang) || '')); }
  function pvVoiceScore(v) {
    var n = String((v && v.name) || '');
    var lang = String((v && v.lang) || '');
    var s = 0;
    /* SEX MATCH, weighted above every quality signal - see note 1 */
    /* Chrome's own voices are named by LOCALE, not by person, so they have to be
       named explicitly or they score as unknown-sex and lose to a worse voice
       that happens to have a first name: "Google US English" is a female voice,
       and without this line a coral practice fell back to Microsoft Zira (a
       robotic SAPI voice) purely because "Zira" is a recognisable name. */
    var male = /\b(david|mark|guy|christopher|eric|roger|steffan|daniel|alex|fred|tom|onyx|ash|echo)\b/i.test(n) ||
      /google uk english male/i.test(n);
    var female = /\b(aria|jenny|zira|michelle|ana|samantha|victoria|karen|moira|tessa|fiona|susan|allison|ava|coral|nova|shimmer|sage)\b/i.test(n) ||
      /google us english/i.test(n) || /google uk english female/i.test(n);
    if (pvWantMale === true && male) s += 100;
    else if (pvWantMale === false && female) s += 100;
    else if (pvWantMale !== null && (male || female)) s -= 100;   /* known, and it is the wrong one */
    if (/natural/i.test(n)) s += 40;                   /* Windows' good voices say so in the name */
    if (/online/i.test(n)) s += 8;
    if (v && v.localService === false) s += 6;         /* network voices are the modern ones */
    if (/\b(aria|jenny|samantha|ava|michelle|christopher|eric|guy)\b/i.test(n)) s += 12;
    if (/google us english/i.test(n)) s += 5;          /* usable, but the synthetic one */
    if (/\b(zira|david|mark)\b/i.test(n)) s -= 10;     /* the old robotic SAPI voices */
    /* ACCENT CONTINUITY, weighted above every quality signal but below sex.
       All eight backend voices are American, so an en-GB or en-AU fallback
       swaps the avatar's accent mid-interview - the same defect as swapping its
       sex, and just as audible. At +3 this lost: "Google UK English Male"
       (network voice, +6) outranked the American "Microsoft David" for a
       practice running `ash`, so a hiccup turned a US assistant British. */
    if (/^en-US/i.test(lang)) s += 25;
    return s;
  }
  function pvPickVoice() {
    if (pvVoice !== undefined) return pvVoice;
    pvVoice = null;
    safe(function () {
      var synth = window.speechSynthesis; if (!synth || !isFn(synth.getVoices)) return;
      var voices = synth.getVoices() || [];
      if (!voices.length) { safe(function () { synth.addEventListener('voiceschanged', function () { pvVoice = undefined; }, { once: true }); }); return; }
      var best = null, bestScore = 0;
      for (var i = 0; i < voices.length; i++) {
        if (!pvVoiceUsable(voices[i])) continue;
        var sc = pvVoiceScore(voices[i]);
        if (best === null || sc > bestScore) { bestScore = sc; best = voices[i]; }
      }
      pvVoice = best;
    });
    return pvVoice;
  }
  function pvStopSpeechOnly() {
    pvSpeakSeq++;
    /* BARGE-IN STILL ECHOES. The words already out of the speaker are still
       travelling through the recogniser, so the template they came from has to
       survive being cut off mid-sentence. */
    pvEchoHold(pvEchoSaying);
    pvEchoSaying = '';
    pvSaying = '';
    if (pvWatchdog) { safe(function () { clearTimeout(pvWatchdog); }); pvWatchdog = null; }
    pvHeld.length = 0;
    if (ttsAudioNow) { safe(function () { ttsAudioNow.onended = null; ttsAudioNow.onerror = null; ttsAudioNow.pause(); }); ttsAudioNow = null; }
    faceTalkStop();
    safe(function () { if (window.speechSynthesis) window.speechSynthesis.cancel(); });
  }
  function pvStopVoice() {
    pvSpeakSeq++;
    /* THE TEMPLATE EXPIRES HERE TOO. This function used to leave pvSaying set
       forever - deliberately, so ambient could clear it by hand - which meant
       kioskTurn's network-failure path reopened the microphone against a
       PERMANENT echo template: every later answer built from that question's
       words was silently deleted, for the rest of the interview. It goes to the
       bounded tail like every other stop. */
    pvEchoHold(pvEchoSaying);
    pvEchoSaying = '';
    pvSaying = '';
    if (pvWatchdog) { safe(function () { clearTimeout(pvWatchdog); }); pvWatchdog = null; }
    pvHeld.length = 0;
    if (ttsAudioNow) { safe(function () { ttsAudioNow.onended = null; ttsAudioNow.onerror = null; ttsAudioNow.pause(); }); ttsAudioNow = null; }
    faceTalkStop();
    safe(function () { if (window.speechSynthesis) window.speechSynthesis.cancel(); });
    pvStopMic();
  }
  /* ── THE MICROPHONE HALF OF pvStopVoice, ON ITS OWN ────────────────────────
     Owner: "it litterly never gets out everyhting it wants to say caosue it picks
     up its own talking."
     pvStopVoice did TWO jobs — end the sentence, and tear down the recogniser —
     and a derived walk of this file (see the suite named below) found that every
     caller reachable from a microphone event wanted only the second one. So a
     routine Chrome `no-speech` error, or the avatar's own words arriving at
     rec.onresult, re-entered pvListen and cancelled the sentence the avatar was
     still in the middle of saying.
     This is an EDGE REMOVAL, not a guard: the mic path no longer has a call that
     could stop speech, so there is no flag for a later round to invert.
     🔑 IT STILL EXPIRES THE ECHO TEMPLATE, AND THAT IS WHY FILING IS UNCHANGED.
     Every one of the three mic-travelled call sites used to reach pvStopVoice,
     which moved the sentence into the bounded echo tail; leaving pvEchoSaying set
     instead is what made round 9 file the avatar's own question as the patient's
     answer in 9 of 15 turns — the next pvSpeakVoiced overwrote the template
     before anything held it, so the old question's late tail met an empty filter.
     pvEchoSaying therefore clears HERE, at exactly the moment origin/main cleared
     pvSaying, and only the LIVENESS value (pvSaying) survives the teardown.
     Callers that genuinely end the interview (kioskClose, kioskPauseToggle,
     kioskRequestEnd, the ambient stop) still call pvStopVoice: they are reached
     from a visible control or the page lifecycle, never from the microphone. */
  function pvStopMic() {
    /* a no-op when pvStopVoice is the caller — it cleared pvEchoSaying two
       statements ago and pvEchoHold('') returns immediately. Kept in BOTH places
       so pvStopVoice's statement order is byte-for-byte what origin/main ran. */
    pvEchoHold(pvEchoSaying);
    pvEchoSaying = '';
    if (pvRec) {
      /* KILL THE QUIET TIMER, not just the recogniser. It lives in pvListen's
         closure, so nulling the handlers and calling stop() left it armed: 1.3s
         later it fired, submit() saw pvRec was already null so it skipped the
         teardown, and handed the buffered text to onFinal anyway - posting a
         turn and speaking the next question while the screen read "Paused". */
      safe(function () { if (isFn(pvRec.__killQuiet)) pvRec.__killQuiet(); });
      safe(function () { pvRec.onresult = null; pvRec.onend = null; pvRec.onerror = null; pvRec.stop(); });
      pvRec = null;
    }
  }
  /* pvSpeak: the NATURAL backend voice first (MP3 + real lip-sync), the
     browser's speechSynthesis only as fallback. The completion contract is
     identical either way: `then` fires exactly once — event, error, or
     watchdog — so the speak->listen chain can never strand. */
  function pvSpeak(text, then) { pvSpeakVoiced(text, then, null, null); }
  /* the same speak engine, told WHAT KIND of line this is so the backend can
     shape the delivery (see ttsFetchUrl). Separate from pvSpeak only so the
     four existing call sites keep their exact two-argument shape. */
  function pvSpeakShaped(text, then, shape) { pvSpeakVoiced(text, then, null, shape); }
  /* the sentence currently leaving the speaker, normalised — LIVENESS ONLY.
     "Is a sentence still playing?" Read by the barge-in decision, by the voice
     gate's room-floor learning, and by the silence watchdog, and by nothing that
     decides what is FILED. */
  var pvSaying = '';
  /* ── AND THE SAME STRING AGAIN, FOR A DIFFERENT QUESTION ───────────────────
     ONE TOKEN CANNOT ANSWER TWO QUESTIONS. Until now `pvSaying` answered both
     "what are we saying right now?" (read to keep a sentence alive) and "what do
     we compare against for echo?" (read by BOTH filing gates — pvIsSelfEcho and
     the novel-word refusal in kioskListen). Those two have INCOMPATIBLE
     LIFETIMES, and nine rounds died on it: the microphone must be able to tear
     down the recogniser without ending the sentence, which requires the liveness
     value to survive pvStopMic — and the moment it did, the filing gates were
     reading a template that origin/main had already expired into the bounded
     tail. Measured: the avatar filed its own question as the patient's answer in
     9 of 15 ordinary turns, and 5 of 32 identical-input scenarios filed different
     strings, every one a silent loss.
     So the echo comparison gets its OWN binding with its OWN lifetime. It is set
     and cleared at EXACTLY the statements where origin/main set and cleared
     pvSaying — pvSpeakVoiced's assignment and its finish(), pvStopSpeechOnly,
     pvStopVoice, pvStopMic (which is where the three mic-travelled callers used
     to reach pvStopVoice) and kioskAmbientStart — so the filed output is
     byte-identical for every input. The liveness value is then free to outlive it
     without touching filing at all.
     ⛔ DO NOT read this one to decide whether to keep talking, and do not read
     pvSaying to decide what to file. That conflation IS the defect. */
  var pvEchoSaying = '';
  /* av-5.7.0 - AND THE SENTENCES THAT JUST LEFT IT. Owner, 2026-08-07: "it
     records itself talking and doesnt listen for answers and is just a mess".
     THE MECHANISM: Chrome finalises a recognition result hundreds of
     milliseconds - sometimes seconds - after the words were actually spoken.
     `pvSaying` was cleared the instant the audio ended, so the TAIL of every
     question arrived at an empty template, passed the echo filter, and was
     posted to the server as the patient's answer. The avatar interviewed
     itself, and the summary was built on its own questions.
     The template therefore has to OUTLIVE the speech. It must not outlive it
     for long: a patient answering in the question's own words ("it has been
     going on for three weeks") must not be silenced, so the tail is bounded
     and every entry expires by wall clock. */
  /* 1.6s, not 4: Chrome finalises on the pause in the audio, so our own tail
     arrives within a few hundred milliseconds of the speaker going quiet. The
     longer the window, the more real answers it can eat - and the answer to
     "is it worse at night?" is "worse at night". */
  var PV_ECHO_TAIL_MS = 1600;
  var pvEchoTail = [];
  function pvEchoHold(norm) {
    if (!norm) return;
    pvEchoTail.push({ norm: norm, until: Date.now() + PV_ECHO_TAIL_MS });
    while (pvEchoTail.length > 6) pvEchoTail.shift();
  }
  function pvEchoDrop() { pvEchoTail.length = 0; }
  function pvNorm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  /* WORD BOUNDARIES, not substrings. `indexOf` matched inside words, so a
     patient answering "no" was deleted by any question carrying "not",
     "know" or "now" - and a one-word refusal is the most consequential answer
     in an intake. */
  function pvHasRun(hay, needle) { return (' ' + hay + ' ').indexOf(' ' + needle + ' ') >= 0; }
  /* ── BARGE-IN NEEDS EVIDENCE OF ANOTHER VOICE ──────────────────────────────
     Owner: "it doesnt even say eve4ryhhting its going to say it hears its self its a MESS."
     Those are ONE defect. pvStopSpeechOnly has exactly one call site — the interim handler in
     kioskListen — so the ONLY thing that can cut a question off mid-sentence is barge-in, and
     the only thing standing between barge-in and the avatar's own voice was pvIsSelfEcho.
     Every time that filter missed, the avatar heard itself, concluded it was being interrupted,
     and silenced its own question.
     MEASURED (scratchpad/echo-bargein-probe.js, the shipped classifier over this interview's
     real questions with the ordinary microphone-hearing-a-loudspeaker error modes):
         clean transcript   0% missed
         one word dropped   0% missed
         a homophone       21% missed
         two words merged  52% missed      overall 42 of 232 = 18%
     and the misses are concentrated in SHORT prefixes — 2 to 5 words — which is precisely what
     the recogniser emits FIRST, at the start of every single question. Two causes: pvEchoMatch's
     overlap test is `> 0.8`, so a 5-word echo with one wrong word scores exactly 0.8 and fails;
     and a merged pair ("bringsyou") is not a word in the sentence, so no contiguous run matches.
     The old rule was NEGATIVE — cut the question unless we can prove this is our own voice.
     This one is POSITIVE: cut the question only when at least two words are ones we are NOT
     saying. A mis-heard echo has no novel words; a person talking over the avatar has plenty.
     ⚠️ Deliberately NOT applied to the filing path. pvIsSelfEcho stays exactly as calibrated,
     because a novel-word rule there would delete the one-word answers that reuse the question's
     own words ("back", "worse", "ten") — measured at 9 of 12 and 22 of 22 in a previous round,
     and the most expensive answers in the interview to lose. This gate only decides whether to
     STOP TALKING, which is never destructive. */
  function pvEditDistance1(a, b) {
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la === lb) { i++; j++; }
      else if (la > lb) i++;
      else j++;
    }
    if (i < la || j < lb) edits++;
    return edits <= 1;
  }
  function pvNovelWordCount(tpl, heard) {
    var t = pvNorm(tpl || ''), h = pvNorm(heard);
    if (!h) return 0;
    if (!t) return h.split(' ').filter(Boolean).length;
    var mine = t.split(' ').filter(Boolean);
    var words = h.split(' ').filter(Boolean);
    var novel = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 2) continue;                    /* 'a', 'i' carry no evidence either way */
      if (pvHasRun(t, w)) continue;                  /* a word we are saying right now */
      var ours = false;
      for (var j = 0; j < mine.length && !ours; j++) {
        var m = mine[j];
        /* a MERGE: the recogniser ran two of our words together, or clipped one of them */
        if (m.length >= 4 && (w.indexOf(m) >= 0 || (w.length >= 4 && m.indexOf(w) >= 0))) ours = true;
        /* a HOMOPHONE or a single mis-heard letter: pain->pane, back->bag, ten->tan */
        else if (m.length >= 4 && w.length >= 4 && pvEditDistance1(w, m)) ours = true;
      }
      if (!ours) novel++;
    }
    return novel;
  }
  /* ── THE VOICE GATE: echo cancellation + a local voice detector (av-6.1.0) ────────────
     Owner's choice, asked and answered: keep the ability to interrupt, and add REAL echo
     cancellation rather than closing the microphone while the avatar talks.
     The insight that makes this small instead of a rewrite: **the two jobs are different.**
       - Deciding "is somebody else talking right now?" needs no words at all. It is an
         ENERGY question, and on an echo-cancelled stream the avatar's own voice is gone —
         so any residual speech energy IS another person. Instant, local, no network.
       - Turning what they said into TEXT still needs the recogniser.
     So the recogniser keeps doing words, and this does presence. Barge-in and self-echo
     both stop being string problems, which is what made them unfixable: "in the morning"
     the echo and "in the morning" the answer are the same string, but they are not the
     same SOUND — one arrives with the room silent.
     Why AEC can work here at all: the good voice plays through `new Audio(url)` and the
     AudioContext (see pvSpeak), i.e. the browser renders it, so Chrome's canceller has the
     reference signal. A system speechSynthesis fallback would NOT be in that mix.
     ⚠️ POSITIVE ASSERTION, not an assumption: we ask for echoCancellation and then read
     `track.getSettings()` back to confirm the browser actually applied it. If it did not,
     `vgReady` stays false and every decision below falls back to the string gate exactly as
     it behaves today. A device without AEC must never be made worse by this. */
  var vgStream = null, vgCtx = null, vgNode = null, vgData = null, vgRaf = 0;
  var vgReady = false, vgWhy = 'not started', vgLevel = 0, vgFloor = 0;
  var vgFloorSamples = [], vgLoudFrames = 0, vgQuietFrames = 0, vgSettings = null;
  var VG_FRAME_MS = 40;          /* ~25 reads a second: fast enough to feel instant */
  var VG_ONSET_FRAMES = 4;       /* ~160ms of sustained energy - a cough or a click cannot pass */
  var VG_MARGIN = 2.6;           /* how far above the measured room floor counts as speech */
  function vgRms() {
    if (!vgNode || !vgData) return 0;
    safe(function () { vgNode.getByteTimeDomainData(vgData); });
    var sum = 0;
    for (var i = 0; i < vgData.length; i++) { var v = (vgData[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / vgData.length);
  }
  /* ADOPT a stream somebody else already obtained. This is the path the kiosk uses: the mic
     preflight asks once, on the staff tap, with exactly these constraints — so the gate must
     never make a request of its own there. Returns true only if the gate is genuinely live. */
  function pvVoiceGateAdopt(stream) {
    if (vgReady) return true;
    if (!stream) { vgWhy = 'no stream to adopt'; return false; }
    var ok = safe(function () {
      var track = stream.getAudioTracks()[0];
      vgSettings = (track && track.getSettings) ? track.getSettings() : null;
      /* THE CONFIRMATION. A browser may hand back a track with the constraint ignored;
         believing the request rather than the applied setting is how a guard becomes
         decoration. Without this the whole design would rest on an assumption. */
      if (!vgSettings || vgSettings.echoCancellation !== true) {
        vgWhy = 'the browser did not apply echo cancellation' +
          (vgSettings ? ' (echoCancellation=' + String(vgSettings.echoCancellation) + ')' : '');
        return false;
      }
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) { vgWhy = 'no AudioContext'; return false; }
      vgStream = stream;
      vgCtx = new C();
      var srcNode = vgCtx.createMediaStreamSource(stream);
      vgNode = vgCtx.createAnalyser();
      vgNode.fftSize = 1024;
      vgNode.smoothingTimeConstant = 0.2;
      srcNode.connect(vgNode);       /* analyser only - never connected to destination */
      vgData = new Uint8Array(vgNode.fftSize);
      vgFloorSamples = []; vgLoudFrames = 0; vgQuietFrames = 0;
      vgReady = true; vgWhy = 'echo cancellation active';
      /* ⛔ NOT a timer. This module forbids permanent polling and the contract suite enforces
         it module-wide; my first version used a repeating interval and was caught. An
         animation-frame loop is the right instrument anyway: it is throttled to the display,
         it costs nothing while the kiosk is not being painted, and a hidden tab freezes it —
         which is correct here, because a kiosk nobody is looking at has no turn to take. */
      var vgLast = 0;
      function vgFrame(ts) {
        if (!vgReady) return;
        vgRaf = safe(function () { return requestAnimationFrame(vgFrame); }, 0);
        if (ts && vgLast && (ts - vgLast) < VG_FRAME_MS) return;
        vgLast = ts || 0;
        safe(function () {
          vgLevel = vgRms();
          /* The room floor is learned only while NOTHING is playing and nobody has been
             judged to be speaking, so the avatar's own residual can never raise the bar it
             is being measured against — that would quietly deafen the gate. */
          if (!pvSaying && vgLoudFrames === 0) {
            vgFloorSamples.push(vgLevel);
            if (vgFloorSamples.length > 50) vgFloorSamples.shift();
            var sorted = vgFloorSamples.slice().sort(function (a, b) { return a - b; });
            /* a MEDIAN floor, so one door slam during calibration cannot raise it */
            vgFloor = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
          }
          var bar = Math.max(0.012, vgFloor * VG_MARGIN);
          if (vgLevel > bar) { vgLoudFrames++; vgQuietFrames = 0; }
          else { vgQuietFrames++; if (vgQuietFrames > 3) vgLoudFrames = 0; }
        });
      }
      vgRaf = safe(function () { return requestAnimationFrame(vgFrame); }, 0);
      return true;
    }, false);
    if (!ok) { vgStream = null; vgCtx = null; vgNode = null; vgData = null; vgReady = false; }
    return ok;
  }
  /* DIAGNOSTICS ONLY — this one makes its own request, so it must never be called from the
     kiosk path: the mic is requested exactly once, on the staff tap (see kioskMicPreflight).
     It exists so the gate can be proven in a harness without driving a whole interview. */
  function pvVoiceGateStart(done) {
    if (vgReady || vgStream) { if (done) safe(done); return; }
    var md = safe(function () { return navigator.mediaDevices; }, null);
    if (!md || !md.getUserMedia) { vgWhy = 'this browser has no getUserMedia'; if (done) safe(done); return; }
    safe(function () {
      md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then(function (stream) {
          if (!pvVoiceGateAdopt(stream)) safe(function () { stream.getTracks().forEach(function (t) { t.stop(); }); });
          if (done) safe(done);
        }, function (err) {
          vgWhy = 'microphone refused for the voice gate (' + String(err && err.name || err) + ')';
          if (done) safe(done);
        });
    });
  }
  function pvVoiceGateStop() {
    if (vgRaf) { safe(function () { cancelAnimationFrame(vgRaf); }); vgRaf = 0; }
    if (vgStream) safe(function () { vgStream.getTracks().forEach(function (t) { t.stop(); }); });
    if (vgCtx) safe(function () { vgCtx.close(); });
    vgStream = null; vgCtx = null; vgNode = null; vgData = null; vgReady = false;
    vgLevel = 0; vgFloor = 0; vgFloorSamples = []; vgLoudFrames = 0; vgQuietFrames = 0;
  }
  /* true only with sustained energy ABOVE the learned room floor on the echo-cancelled
     stream. While the avatar is speaking, its own voice has already been removed, so this
     answers the only question barge-in ever needed to ask. */
  function pvOtherVoiceNow() { return !!(vgReady && vgLoudFrames >= VG_ONSET_FRAMES); }
  /* ⛔ A COUGH IS NOT AN INTERRUPTION, and energy alone cannot tell them apart.
     avatar-listens-while-speaking.test.js has pinned since av-1.x that "a cough or an 'mhm'
     must not cut the question off", and the two-word rule enforced it for free: a cough
     produces no words. My first av-6.1.0 barge-in used pvOtherVoiceNow() alone, which is a
     ~160ms energy test — and a cough is 200-400ms of loud, sustained energy, so it would have
     cut the question off. The pin was right and the extension lane's red main is how I found
     out, because my own b991 gate died at the freshness guard before it ever reached this file.
     So audio presence is necessary but NOT sufficient. Speech distinguishes itself two ways:
     it produces WORDS, or it KEEPS GOING far longer than a throat-clear. Either will do. */
  var VG_SPEECH_FRAMES = 18;   /* ~720ms of continuous energy: past any cough or 'mhm' */
  function pvOtherVoiceSustained() { return !!(vgReady && vgLoudFrames >= VG_SPEECH_FRAMES); }
  function pvVoiceGateReady() { return !!vgReady; }
  function pvVoiceGateReport() {
    return { ready: !!vgReady, why: vgWhy, level: Math.round(vgLevel * 1000) / 1000,
      floor: Math.round(vgFloor * 1000) / 1000, loudFrames: vgLoudFrames,
      echoCancellation: vgSettings ? vgSettings.echoCancellation : null,
      noiseSuppression: vgSettings ? vgSettings.noiseSuppression : null };
  }
  function pvEchoMatch(tpl, h, words, minRun, minOverlapWords) {
    if (!tpl) return false;
    if (words.length >= minRun && pvHasRun(tpl, h)) return true;   /* a slice of our own sentence */
    if (words.length < minOverlapWords) return false;
    var hits = 0;
    for (var i = 0; i < words.length; i++) if (pvHasRun(tpl, words[i])) hits++;
    return (hits / words.length) > 0.8;                            /* mostly our words */
  }
  /* TWO REGIMES, because the evidence is not the same in both - and getting
     this wrong is measurably expensive in BOTH directions. Run against the
     live av-5.6.7 classifier, "no, nothing makes it worse" - the actual answer
     to "does anything make it worse, or is there nothing that changes it?" -
     came back as SELF-ECHO and was deleted. A patient answered and the chart
     recorded nothing.
       WHILE THE SPEAKER IS ACTIVE, any recognisable piece of our own sentence
     is our own voice. A patient talking over the question produces words of
     their own, and in the rare case they quote it back, the server already has
     the question - so aggressive is right here.
       AFTER IT STOPS, the same words are far more likely to be the ANSWER: the
     reply to "is it worse at night?" is "worse at night". Only a LONG
     contiguous quote counts, and the window itself is short. */
  /* the answers a patient gives in ONE word, which are also the answers it costs
     the most to lose: a laterality, a refusal, a number on a pain scale. These
     are never treated as echo, whatever the avatar happens to be saying. */
  var PV_ANSWER_WORDS = /^(yes|yeah|yep|yup|no|nope|none|never|left|right|both|neither|better|worse|same|zero|one|two|three|four|five|six|seven|eight|nine|ten)$/;
  function pvIsSelfEcho(heard) {
    var h = pvNorm(heard);
    if (!h) return false;
    var words = h.split(' ').filter(Boolean);
    /* ⛔ REVERTED, AND THE MEASUREMENT IS WHY. av-5.7.0 made a one-word result
       droppable when the avatar was saying that word and it was not on a
       whitelist of answers (yes/no/left/right/numbers). The intent was sound: the
       avatar's own trailing word was being filed as the patient's answer. The
       effect was much worse than the defect.
       MEASURED, twice, independently, by running this classifier against ordinary
       intake questions: it deletes the answer to almost every "A or B?" question
       this interview asks - "back", "neck", "morning", "evening", "sharp",
       "weeks", "standing", "shoulder", "ibuprofen" - 9 of 12 in one sweep and 22
       of 22 in another, against 0 of 12 for the code it replaced. The patient
       answers "back" to "is the pain in your back, or in your neck?" and the word
       is in the question, so it went in the bin. Worse, the whitelist exempted
       exactly the tokens that END the programmed questions, so the guard could
       barely catch the thing it was written for.
       A one-word answer is the most common shape in an A-or-B intake question and
       the most expensive to lose. A one-word ECHO fragment is rare, because
       Chrome returns phrases, and when it happens the MA persona simply asks
       again - visibly, in one turn. So the smaller harm is accepted deliberately:
       one word is never treated as the echo of a sentence.
       (The multi-word cases are untouched: they are what actually caught the
       owner's "it records itself talking".) */
    if (words.length < 2) return false;
    /* THE ECHO TEMPLATE, not the liveness value — see `var pvEchoSaying`. This is
       a FILING GATE: what it returns true for is deleted and never reaches the
       chart, so it must compare against a string whose lifetime is the one this
       classifier was calibrated against, not against "is audio still playing". */
    if (pvEchoSaying && pvEchoMatch(pvEchoSaying, h, words, 2, 2)) return true;
    var now = Date.now();
    for (var i = 0; i < pvEchoTail.length; i++) {
      /* THE TAIL IS CONTIGUITY ONLY. The overlap branch (>80% of the heard words
         appearing anywhere in the sentence) could delete a real answer for 1.6
         seconds after the question ended - including a red-flag answer, which is
         the worst thing in this file to lose - because a short reply reuses the
         question's words by nature. The comment always claimed only a long
         contiguous quote counted here; now that is what the code does. The
         minOverlapWords argument is deliberately unreachable. */
      if (pvEchoTail[i].until > now && pvEchoMatch(pvEchoTail[i].norm, h, words, 4, 9999)) return true;
    }
    return false;
  }
  function pvSpeakVoiced(text, then, voiceOverride, shape) {
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
      /* pvSaying clears, and the sentence moves to the bounded echo tail: the
         recogniser is still delivering these words. Clearing it OUTRIGHT is
         what made the avatar file its own questions as answers; keeping it
         forever would silence a patient who answers in the question's words. */
      pvEchoHold(pvEchoSaying);
      pvEchoSaying = '';
      pvSaying = '';
      if (pvWatchdog) { safe(function () { clearTimeout(pvWatchdog); }); pvWatchdog = null; }
      pvHeld.length = 0;
      faceTalkStop();
      if (then) safe(then);
    }
    var t = String(text == null ? '' : text);
    pvSaying = pvNorm(t);
    /* the two bindings are born together and identical; only their DEATHS differ
       (see `var pvEchoSaying`), so this is the one place either is ever set */
    pvEchoSaying = pvSaying;
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
    /* AN EMERGENCY WARNING IS NEVER SPLIT. Two independent generations cannot
       carry one continuous urgent contour, and the piece that matters most is
       the instruction to call for help - it is spoken as one line, with one
       delivery, or the shaping means nothing. The extra second of latency on the
       rarest line in the interview is the right trade. */
    var chunks = (shape === 'alert') ? [t] : ttsSplitForSpeech(t);
    if (chunks.length === 2 && Date.now() >= ttsDownUntil) {
      var second = ttsFetchUrl(chunks[1], voiceOverride, 'cont');   /* started FIRST so it overlaps the first piece */
      ttsFetchUrl(chunks[0], voiceOverride, 'open').then(function (u1) {
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
    ttsFetchUrl(t, voiceOverride, shape).then(function (url) {
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
      /* rate 0.94, pitch 1.0. Two deliberate changes from 0.98/1.02:
         PITCH IS NO LONGER TOUCHED. 1.02 bought nothing audible and it is not
         free - several SAPI voices implement a pitch shift by resampling, which
         adds exactly the metallic edge this lane exists to remove. A 2% shift is
         inaudible as pitch and audible as artifact, which is the worst trade
         available.
         RATE DROPS to 0.94. The browser voices are the ones a patient hears when
         the network hiccups, and they are markedly less intelligible than the
         backend voice; the thing that most reliably makes a synthetic voice
         easier to listen to is giving it more time. It also brings the fallback
         closer in pace to the real voice, so a mid-interview downgrade is less
         of a jolt. */
      u.rate = 0.94; u.pitch = 1.0; u.volume = 1;
      var voice = pvPickVoice();
      if (voice) {
        u.voice = voice;
        /* SET THE LANG WITH THE VOICE. Chrome resolves an utterance against
           BOTH, and with lang left at the document's value a chosen en-GB or
           en-AU voice can be silently overridden back to the platform default -
           which is how a carefully picked voice turns into Microsoft David
           anyway, with nothing in the code looking wrong. */
        if (voice.lang) u.lang = voice.lang;
      }
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
    /* pvStopMic, NOT pvStopVoice. Re-opening the microphone is the single most
       travelled path in the interview — the duplex open that rides with every
       question, and Chrome's routine `no-speech`/`network` error, which arrives
       through onerror -> onDead -> kioskListen -> here several times a minute.
       While that call was pvStopVoice, the microphone ENDED THE SENTENCE THE
       AVATAR WAS STILL SAYING every single time. The echo template still expires
       here, inside pvStopMic, exactly as it did inside pvStopVoice. */
    pvStopMic();
    var rec; try { rec = new C(); } catch (e) { return false; }
    pvRec = rec;
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
    var finalText = '', quiet = null, dead = false;
    /* published on the recogniser so a teardown can reach into this closure and
       disarm the quiet timer - see pvStopVoice */
    function killQuiet() { if (quiet) { safe(function () { clearTimeout(quiet); }); quiet = null; } dead = true; }
    rec.__killQuiet = killQuiet;
    function submit() {
      if (dead) return;
      var v = finalText.trim();
      /* NOTHING TO SUBMIT IS NOT A REASON TO GO DEAF. The echo filter now runs
         below, at the source, so a result that was entirely the avatar's own
         voice leaves finalText empty - and the microphone must stay open.
         Before this, an echo was accumulated, submitted, REJECTED by the
         caller, and the recogniser was already torn down by then: mic dead, no
         answer taken, and only the 9s watchdog could revive the question. That
         is the "doesn't listen for answers" half of the owner's report. */
      if (!v) return;
      if (pvRec === rec) { safe(function () { rec.stop(); }); pvRec = null; }
      if (onFinal) onFinal(v);
    }
    /* av-5.2.0: 1.3s of quiet after real speech submits — snappier turns */
    function armQuiet() { if (quiet) clearTimeout(quiet); quiet = setTimeout(function () { if (finalText.trim()) submit(); }, 1300); }
    rec.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var r = ev.results[i];
        var piece = String(r[0].transcript || '').trim();
        /* THE FILTER BELONGS HERE. It used to sit only in the caller, so the
           avatar's own words entered finalText and the caller then had to
           reject the WHOLE result - the patient's words with it. */
        if (piece && pvIsSelfEcho(piece)) continue;
        if (r.isFinal) { if (piece) finalText += (finalText ? ' ' : '') + piece; }
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
    /* THE HAIRLINE IS THE INNER BOUNDARY OF THESE PATHS, and it was a stepped,
       asymmetric sweep with a notch above the left temple — at kiosk size that reads as
       the rubber edge of a swim cap, which is what made "flat cap" the first thing the
       owner said about the hair. It is now one continuous line: a smooth temple corner,
       a slight forward bulge over the forehead, and the same on the other side. Even and
       unnoticeable is the whole goal — a hairline is only ever noticed when it is wrong. */
    short: 'M42 92 Q40 30 100 28 Q160 30 158 92 Q157 63 140 53 Q118 46 100 51 Q82 46 60 53 Q43 63 42 92 Z',
    wavy:  'M42 94 Q38 28 100 26 Q162 28 158 94 Q152 74 146 84 Q140 62 130 74 Q124 52 112 62 Q104 44 92 58 Q80 46 72 64 Q62 56 58 76 Q50 70 42 94 Z',
    long:  'M42 92 Q40 30 100 28 Q160 30 158 92 Q157 63 140 53 Q118 46 100 51 Q82 46 60 53 Q43 63 42 92 Z',
    bun:   'M46 90 Q44 34 100 32 Q156 34 154 90 Q153 63 136 54 Q118 48 100 52 Q82 48 64 54 Q47 63 46 90 Z',
    buzz:  'M46 90 Q46 40 100 38 Q154 40 154 90 Q150 62 132 58 Q118 52 100 52 Q82 52 68 58 Q50 62 46 90 Z',
    bald:  ''
  };
  /* the parts that make one drawn doctor look like a different PERSON from the
     next. Each is a plain geometry table, so the whitelist in faceLookSafe is
     the only thing that decides which one is ever rendered. */
  var FACE_BROW_WEIGHT = { thin: 3.2, normal: 5, thick: 7.8 };
  /* EVERY NOSE NEEDS THE LINE UNDER THE TIP (av-6.0.0). Three of these four were a
     single one-sided bridge stroke ending in mid-air, which from the front reads as a
     tick or a question mark drawn on the cheek — it was the weakest feature on the face
     once the eyes and the skull were rebuilt. `wide` was the only one that already had
     the second sub-path (the ala curve under the tip), and it was also the only one that
     read as a nose. So all four now carry one: a bridge shadow down ONE side, and the
     underside of the tip spanning both nostrils, which is exactly what a front-lit nose
     shows. The four `d` strings stay mutually distinct and the nostril geometry (nx/ny/nr)
     is untouched, so the pins on shape-distinctness and on wide nostrils still hold. */
  var FACE_NOSE_PARTS = {
    /* ⛔ AND THEN THEY WERE TOO MUCH. Adding the ala line fixed "a tick mark on the cheek"
       and created a new problem the square harness could not show: at the kiosk's real
       302px the bridge stroke plus the ala curve plus two nostrils collide into a small
       dark squiggle in the middle of the face — the owner saw it immediately. A nose on a
       front-lit face is mostly a SHADOW, not a line. So: the bridge starts lower and is
       shorter, the ala is flatter and wider (a base, not a bowl), the strokes are thinner,
       and the whole group is drawn at .5 opacity in the skin's own shadow — see fNoseSet.
       The four shapes stay mutually distinct and nx/ny/nr are untouched, so the pins on
       distinctness and on wide nostrils still hold. */
    button:   { d: 'M100.5 106 Q103 110 100 112 M94 111 Q100 114.5 106 111', w: 2.2, nx: 5.2, ny: 112.4, nr: 1.5 },
    straight: { d: 'M100.5 103 Q103.5 111 100 113 M93 112 Q100 116 107 112', w: 2.2, nx: 6.4, ny: 114.6, nr: 1.7 },
    wide:     { d: 'M100.5 104 Q104.5 112 100 114 M91 112.5 Q100 117.5 109 112.5', w: 2.2, nx: 7.6, ny: 113.2, nr: 2.1 },
    roman:    { d: 'M99.5 99 Q105 106 103 112 Q102 114 100 114 M93.5 112.5 Q100 116.5 106.5 112.5', w: 2.4, nx: 6.2, ny: 114.8, nr: 1.7 }
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
  /* every drawn face needs its OWN gradient and clip ids. Setup renders a preview beside
     the kiosk, the Visit card can render another, and duplicate SVG ids in one document
     silently cross-wire: the second face would paint with the first face's skin ramp and
     iris. A counter is enough and stays stable within a render. */
  var faceUidSeq = 0;
  function faceSvg(look) {
    look = faceLookSafe(look || FACE_LOOK);
    var faceUid = 'f' + (++faceUidSeq);
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
    /* ---- THE EYE, REBUILT FOR A HUMAN FACE (av-6.0.0) --------------------------
       Owner: "make the avatar much more human like and more like profetional completly
       cahgne the avatar."
       The old eye was a 23x25 white ellipse with a 14-wide iris and a 5-wide pupil —
       taller than it was wide, which is an owl, not a person. Rendered side by side with
       three other looks it was the single strongest cartoon signal on the face.
       A human eye is an ALMOND roughly twice as wide as it is tall, the iris is partly
       hidden by the upper lid, the sclera is never pure white, and there is a dark lash
       line along the upper aperture. All of that is here, and every animation hook
       (fPupil / fLid / fLow) keeps its name and its transform origin so blinking, gaze,
       the sleepy lid and the smiling lower-lid arc all still drive it. */
    /* one ear, mirrored by sign. Top at the brow line, lobe at the nose base — the two
       landmarks a real ear is actually placed between. */
    function earOf(sgn) {
      /* the ear is anchored INSIDE the skull edge (0.90rx) and projects past it, so the
         skull drawn on top of it hides the anchored part and leaves a real ear standing
         off the head. Anchoring it at 0.94rx with a 9.5 projection left only a 5-unit
         sliver visible — measured, not guessed: getBBox put the ear at x 155-163 against
         a face whose own edge is 158. */
      var ex = 100 + sgn * sh.rx * 0.90;
      var top = 98 - sh.ry * 0.26, bot = 98 + sh.ry * 0.22;
      var out = sgn * 13;
      return '<g class="fSkin fEar' + (sgn < 0 ? 'L' : 'R') + '" pointer-events="none">' +
        '<path d="M' + n2(ex) + ' ' + n2(top) +
          ' C' + n2(ex + out) + ' ' + n2(top + 1) + ' ' + n2(ex + out * 1.05) + ' ' + n2(bot - 6) + ' ' + n2(ex + out * 0.42) + ' ' + n2(bot) +
          ' C' + n2(ex + out * 0.18) + ' ' + n2(bot + 2.5) + ' ' + n2(ex - out * 0.10) + ' ' + n2(bot - 1) + ' ' + n2(ex) + ' ' + n2(bot - 4) +
          ' Z" fill="' + faceShade(look.skin, -0.06) + '"/>' +
        '<path d="M' + n2(ex + out * 0.30) + ' ' + n2(top + 4) + ' C' + n2(ex + out * 0.72) + ' ' + n2(top + 5) + ' ' + n2(ex + out * 0.70) + ' ' + n2(bot - 7) + ' ' + n2(ex + out * 0.34) + ' ' + n2(bot - 5) + '" ' +
          'fill="none" stroke="' + faceShade(look.skin, -0.34) + '" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>' +
      '</g>';
    }
    function eye(cx, side) {
      var apId = 'mlsAvEyeAp' + side + faceUid;
      var irisId = 'mlsAvIris' + side + faceUid;
      /* the aperture: 24 wide, 13 tall, corners lower than the centre so the lid has a
         natural lift toward the outer canthus */
      var ap = 'M' + n2(cx - 12) + ' 94.6 Q' + n2(cx - 6) + ' 87.4 ' + cx + ' 87.6 Q' + n2(cx + 6) + ' 87.9 ' + n2(cx + 12) + ' 94.2 ' +
               'Q' + n2(cx + 6) + ' 100.8 ' + cx + ' 101 Q' + n2(cx - 6) + ' 100.9 ' + n2(cx - 12) + ' 94.6 Z';
      return '<g class="fEye' + side + '" style="transform-box:fill-box;transform-origin:center;transition:transform .12s ease">' +
        '<defs>' +
          '<clipPath id="' + apId + '"><path d="' + ap + '"/></clipPath>' +
          '<radialGradient id="' + irisId + '" cx="42%" cy="34%" r="72%">' +
            '<stop offset="0%" stop-color="' + faceShade(look.eyes, 0.34) + '"/>' +
            '<stop offset="62%" stop-color="' + look.eyes + '"/>' +
            '<stop offset="100%" stop-color="' + faceShade(look.eyes, -0.42) + '"/>' +
          '</radialGradient>' +
        '</defs>' +
        '<g clip-path="url(#' + apId + ')">' +
          /* sclera: warm off-white, never #fff, with the upper half in lid shadow */
          '<rect x="' + n2(cx - 13) + '" y="86" width="26" height="17" fill="#f3efe8"/>' +
          '<ellipse cx="' + cx + '" cy="88.6" rx="13" ry="4.4" fill="' + faceShade(look.skin, -0.3) + '" opacity=".28"/>' +
          '<g class="fPupil' + side + '" style="transition:transform .45s ease">' +
            /* the iris sits high and is CROPPED by the upper lid, as a real one is */
            '<circle cx="' + cx + '" cy="94.1" r="5.5" fill="url(#' + irisId + ')"/>' +
            '<circle cx="' + cx + '" cy="94.1" r="5.5" fill="none" stroke="' + faceShade(look.eyes, -0.55) + '" stroke-width="0.9" opacity=".75"/>' +
            '<circle cx="' + cx + '" cy="94.1" r="2.15" fill="#120d09"/>' +
            '<ellipse cx="' + n2(cx - 1.9) + '" cy="91.9" rx="1.5" ry="1.1" fill="#fff" opacity=".92"/>' +
            '<ellipse cx="' + n2(cx + 2.2) + '" cy="96.4" rx="1.1" ry="0.7" fill="#fff" opacity=".3"/>' +
          '</g>' +
        /* the LOWER lid: it rises into a smiling-eye arc on a genuine smile -
           the single strongest cue that a face means it. Inside the clip now, so it
           sweeps the aperture instead of painting a slab over the cheek. */
        '<path class="fLow' + side + '" d="M' + n2(cx - 13) + ' 96 q13 10 26 0 v10 h-26 z" fill="' + look.skin + '" style="transform-box:fill-box;transform-origin:center bottom;transform:scaleY(0.02);transition:transform .3s ease"/>' +
        /* upper lid: a skin-coloured shutter that DROPS for sleepy/caring
           looks and lifts for surprise - real eyelid acting, not just scale */
        '<path class="fLid' + side + '" d="M' + n2(cx - 13) + ' 94 q13 -11 26 0 v-11 h-26 z" fill="' + look.skin + '" style="transform-box:fill-box;transform-origin:center top;transform:scaleY(0.06);transition:transform .22s ease"/>' +
        '</g>' +
        /* THE LASH LINE. A human upper lid casts a dark edge over the eye; without it the
           aperture reads as a hole cut in a mask. Drawn OUTSIDE the clip so it survives
           the lid shutters, and tapered - heavier at the outer third, like real lashes. */
        '<path d="M' + n2(cx - 12.4) + ' 94.4 Q' + n2(cx - 6) + ' 86.9 ' + cx + ' 87.2 Q' + n2(cx + 6) + ' 87.5 ' + n2(cx + 12.4) + ' 94" ' +
          'fill="none" stroke="' + faceShade(look.hair, -0.25) + '" stroke-width="1.7" stroke-linecap="round" opacity=".9"/>' +
        /* the lid CREASE above it, and the inner-corner shadow - both are why an eye
           looks set INTO a face rather than printed on one */
        '<path d="M' + n2(cx - 9.5) + ' 85.2 Q' + cx + ' 81.4 ' + n2(cx + 9.5) + ' 84.8" fill="none" stroke="' + faceShade(look.skin, -0.34) + '" stroke-width="1.1" stroke-linecap="round" opacity=".5"/>' +
        '<path d="M' + n2(cx - 12.6) + ' 94.6 q2.6 1.8 4.4 2.2" fill="none" stroke="' + faceShade(look.skin, -0.4) + '" stroke-width="1.1" stroke-linecap="round" opacity=".45"/>' +
        '</g>';
    }
    /* ---- HAIR WITH VOLUME (av-6.0.0) ------------------------------------------------
       Owner, on the previous version: the hair "is still a flat cap shape".
       That was literal: one closed path filled flat, drawn INSIDE the skull silhouette.
       Hair drawn inside the skull is paint on a scalp; real hair has a mass that stands
       OFF the skull, and the silhouette of the head-plus-hair is bigger than the head.
       So volume is now a shape drawn BEHIND the head, deliberately taller and wider than
       the skull by an amount that depends on the cut: a buzz stands off almost nothing,
       a wavy cut a lot. Only the rim of it shows past the skull, which is exactly what
       hair looks like from the front. Built from sh.rx / sh.ry so a long narrow head
       gets a long narrow head of hair. */
    var VOL = { short: { dx: 6, dy: 11 }, wavy: { dx: 10, dy: 16 }, long: { dx: 8, dy: 13 },
      bun: { dx: 3, dy: 6 }, buzz: { dx: 1.5, dy: 3 }, bald: null };
    var vol = look.hairStyle === 'bald' ? null : (VOL[look.hairStyle] || VOL.short);
    var back = '';
    if (vol) {
      var vR = 58 + vol.dx, vT = 32 - vol.dy;   /* nominal skull half-width 58, crown y 32 */
      back += '<path class="fHairVol" d="M' + n2(100 - vR) + ' 104' +
        ' C' + n2(100 - vR) + ' ' + n2(vT + 14) + ' ' + n2(100 - vR * 0.55) + ' ' + n2(vT) + ' 100 ' + n2(vT) +
        ' C' + n2(100 + vR * 0.55) + ' ' + n2(vT) + ' ' + n2(100 + vR) + ' ' + n2(vT + 14) + ' ' + n2(100 + vR) + ' 104' +
        ' Z" fill="url(#mlsAvHair' + faceUid + ')"/>';
    }
    if (look.hairStyle === 'long') {
      /* LONG HAIR FALLS BEHIND THE SHOULDERS. It was two thin sickles hugging the jaw,
         which read as sideburns. A mass that reaches the shoulder line and passes behind
         the neck is what makes it read as length. */
      back += '<path class="fHairBack" d="M' + n2(100 - 58 - 8) + ' 96 C' + n2(100 - 74) + ' 150 ' + n2(100 - 70) + ' 186 ' + n2(100 - 52) + ' 198' +
        ' C' + n2(100 - 60) + ' 160 ' + n2(100 - 58) + ' 124 ' + n2(100 - 54) + ' 96 Z' +
        ' M' + n2(100 + 58 + 8) + ' 96 C' + n2(100 + 74) + ' 150 ' + n2(100 + 70) + ' 186 ' + n2(100 + 52) + ' 198' +
        ' C' + n2(100 + 60) + ' 160 ' + n2(100 + 58) + ' 124 ' + n2(100 + 54) + ' 96 Z" fill="' + faceShade(look.hair, -0.16) + '"/>';
    } else if (look.hairStyle === 'bun') {
      /* a bun sits at the BACK of the crown, so from the front only its top shows above
         the head - a circle centred on the crown read as a ball balanced on the skull */
      back += '<ellipse class="fHairBack" cx="100" cy="26" rx="19" ry="14" fill="' + faceShade(look.hair, -0.12) + '"/>' +
        '<path class="fHairBand" d="M84 32 Q100 26 116 32" fill="none" stroke="' + faceShade(look.hair, -0.34) + '" stroke-width="2.4"/>';
    }
    if (back) back = '<g class="fBackFit" transform="' + fit + '">' + back + '</g>';
    var hairPath = FACE_HAIR_PATHS[look.hairStyle] || FACE_HAIR_PATHS.short;
    var hairClip = 'mlsAvHairClip' + faceUid;
    /* the front hair, in three layers that cost almost nothing and do all the work:
         1. a CONTACT SHADOW - the same path nudged down, in a dark hair shade. Where the
            hair meets the forehead this is the HAIRLINE: hair casts a shadow on the brow,
            and without it hair and forehead look like two flat colours meeting at a line.
         2. the hair itself, on the vertical hair ramp rather than one flat fill.
         3. a highlight sweep across the upper crown, CLIPPED to the hair so it cannot
            escape onto the forehead on a low cut like a buzz. */
    var hair = hairPath
      ? '<clipPath id="' + hairClip + '"><path d="' + hairPath + '"/></clipPath>' +
        '<path class="fHairLine" d="' + hairPath + '" fill="' + faceShade(look.hair, -0.45) + '" opacity=".55" transform="translate(0,3.2)"/>' +
        '<path class="fHair" d="' + hairPath + '" fill="url(#mlsAvHair' + faceUid + ')"/>' +
        '<g clip-path="url(#' + hairClip + ')">' +
          /* a SOFT sheen, not a stripe. A solid wedge at .30 read as a plastic highlight
             — on a buzz cut it looked like a parting shaved into the crown. A radial
             fade has no edge to notice, and the clip keeps it off the forehead. */
          '<ellipse class="fHairShine" cx="76" cy="48" rx="30" ry="22" fill="url(#mlsAvShine' + faceUid + ')"/>' +
        '</g>'
      : '';
    /* A RECEDING HAIRLINE is two bare temples, so that is exactly what it is
       drawn as: skin-coloured wedges laid over the crown, inside the crown
       group so they ride the head and a cap still covers them. One pair of
       shapes works for every hair cut - there is no receding variant of each
       path to keep in step. */
    var temples = (look.hairline === 'receding' && look.hairStyle !== 'bald')
      ? '<path class="fTempleL" d="M46 94 Q49 60 82 44 Q63 66 60 94 Z" fill="url(#mlsAvSkin' + faceUid + ')"/>' +
        '<path class="fTempleR" d="M154 94 Q151 60 118 44 Q137 66 140 94 Z" fill="url(#mlsAvSkin' + faceUid + ')"/>'
      : '';
    /* ---- THE BEARD FOLLOWS THE JAW (av-6.0.0) ---------------------------------------
       ⛔ It used to be a near-full-face slab: `M50 104 Q54 164 100 168 Q146 164 150 104`
       filled at .92 opacity spans the ENTIRE lower face out to the head's own silhouette,
       so on a dark beard the whole lower half of the head went to one flat near-black
       field with a hard horizontal edge across both cheeks. It read as a balaclava, and
       it was also why the ears looked wrong: they are ordinary brown, but a brown ear
       against a black cheek reads as a pale blob stuck on the side.
       A beard is a CRESCENT. Its outer edge is the jaw silhouette; its inner edge climbs
       from the corner of the mouth out to the sideburn in front of the ear, and it leaves
       the upper cheek bare. Nominal skull coordinates (rx 58 / ry 66) because this sits
       inside .fCrownFit, which applies the face-shape fit for us. */
    /* the sideburn starts BELOW the eye line, not at it. Starting at y=94 (the eye line)
       put beard on the upper cheek and the ears ended up sitting on a black field, which
       is what made ordinary brown ears look like pale blobs stuck on the sides. */
    /* and the beard reaches the CHIN. Ending at y=157 left a bare crescent of chin below
       it, which reads as a chin strap. y=164 is the chin for every face shape here, not
       just the oval one: this sits inside .fCrownFit, whose fit scales nominal y by
       sh.ry/66 about y=98, so nominal 164 maps to 98+sh.ry exactly — the chin — whatever
       shape the matcher chose. 162 keeps it a hair inside the silhouette. */
    var beardOuter = ' C50 128 66 154 100 162 C134 154 150 128 152 106';
    var beard = '';
    if (look.beard === 'stubble') {
      /* stubble is the same crescent, thinner and much fainter — shadow, not hair */
      beard = '<path class="fBeard" d="M52 108' + beardOuter.replace('152 106', '148 108') +
        ' C146 118 136 124 120 128 C113 130 106 131 100 131 C94 131 87 130 80 128 C64 124 54 118 52 108 Z" ' +
        'fill="' + look.hair + '" opacity=".26"/>';
    } else if (look.beard === 'beard') {
      beard = '<path class="fBeard" d="M48 106' + beardOuter +
        ' C150 118 139 126 122 131 C114 134 107 135 100 135 C93 135 86 134 78 131 C61 126 50 118 48 106 Z" ' +
        'fill="' + look.hair + '" opacity=".9"/>' +
        /* a moustache sits ON the upper lip, so it is placed off the mouth's own line
           rather than at a fixed y - on a long face the mouth travels and it must follow */
        '<path class="fStache" d="M80 ' + n2(124 + dyM) + ' Q100 ' + n2(117 + dyM) + ' 120 ' + n2(124 + dyM) +
          ' Q100 ' + n2(129 + dyM) + ' 80 ' + n2(124 + dyM) + ' Z" fill="' + look.hair + '" opacity=".9"/>';
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
        ' L' + n2(100 + jw1) + ' ' + n2(jt1) + ' Z" fill="url(#mlsAvSkin' + faceUid + ')"/>';
    }
    /* AGE. Read from how much of the hair mass has gone grey, drawn as the
       two lines a face actually earns: the nasolabial folds and crow's feet.
       Both are in the skin's own shadow colour, both track the eyes and the
       mouth so they still land on a long face or a wide-set one. */
    var ageLines = look.age === 'mature'
      /* the crow's feet were 8 units long at .5 opacity and 1.7 wide: three straight rays
         off each outer corner, which read as WHISKERS at kiosk size rather than as age —
         and on dark skin the light shade made them look like scratches. Age is carried by
         the nasolabial folds; the eye corners only need a hint, so they are half the
         length, thinner, fainter and just two rays. */
      ? '<g class="fAge" fill="none" stroke="' + shadeNose + '" stroke-width="1.7" stroke-linecap="round" opacity=".45">' +
          /* a nasolabial fold is a crease in SKIN. Drawn over a full beard it is painted in
             the skin's shadow colour, which is lighter than the beard — so on a dark beard
             the two folds rendered as pale scratches down the chin. A bearded face simply
             does not show them, so they are omitted rather than recoloured. */
          (look.beard === 'beard' ? '' :
            '<path class="fFoldL" d="M89 ' + n2(110 + dyN) + ' Q79 ' + n2(126 + dyM) + ' 81 ' + n2(140 + dyM) + '"/>' +
            '<path class="fFoldR" d="M111 ' + n2(110 + dyN) + ' Q121 ' + n2(126 + dyM) + ' 119 ' + n2(140 + dyM) + '"/>') +
          '<g stroke-width="1.1" opacity=".55">' +
            '<path class="fCrowL" d="M' + n2(cxL - 13.5) + ' 91 l-4 -2.5 M' + n2(cxL - 14) + ' 96.5 l-4.5 1.5"/>' +
            '<path class="fCrowR" d="M' + n2(cxR + 13.5) + ' 91 l4 -2.5 M' + n2(cxR + 14) + ' 96.5 l4.5 1.5"/>' +
          '</g>' +
        '</g>'
      : '';
    var browW = FACE_BROW_WEIGHT[look.brows] || FACE_BROW_WEIGHT.normal;
    var nose = FACE_NOSE_PARTS[look.nose] || FACE_NOSE_PARTS.straight;
    var lips = FACE_LIP_PARTS[look.lips] || FACE_LIP_PARTS.normal;
    var noseRy = (nose.nr * 0.7).toFixed(2);
    return '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" data-mood="idle" style="width:100%;height:100%;display:block">' +
      /* ---- THE PAINT (av-6.0.0) ------------------------------------------------------
         Skin, hair and garment all ramp instead of filling flat. The skin ramp is
         deliberately narrow — +18% at the forehead to -22% at the jaw — because a wide
         ramp on a stylised face reads as plastic rather than as light. */
      '<defs>' +
        /* userSpaceOnUse, NOT the default objectBoundingBox: the skull is not the only
           shape filled with skin — the squarer-jaw panel and the bare temples of a
           receding hairline are too. Per-object bounding boxes would run a fresh
           forehead-to-jaw ramp across each of those small shapes, so the jaw panel came
           out up to 22% lighter than the face it is welded to and the temples up to 15%
           darker: a bright chin and two dark patches, seams exactly where the redesign
           was trying to remove them. One ramp in head coordinates makes every skin
           shape sample the same light. */
        '<linearGradient id="mlsAvSkin' + faceUid + '" gradientUnits="userSpaceOnUse" ' +
          'x1="100" y1="' + n2(98 - sh.ry) + '" x2="100" y2="' + n2(98 + sh.ry) + '">' +
          '<stop offset="0%" stop-color="' + faceShade(look.skin, 0.18) + '"/>' +
          '<stop offset="46%" stop-color="' + look.skin + '"/>' +
          '<stop offset="100%" stop-color="' + faceShade(look.skin, -0.22) + '"/>' +
        '</linearGradient>' +
        '<linearGradient id="mlsAvHair' + faceUid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + faceShade(look.hair, 0.24) + '"/>' +
          '<stop offset="55%" stop-color="' + look.hair + '"/>' +
          '<stop offset="100%" stop-color="' + faceShade(look.hair, -0.30) + '"/>' +
        '</linearGradient>' +
        '<linearGradient id="mlsAvShirt' + faceUid + '" x1="0" y1="0" x2="0.35" y2="1">' +
          '<stop offset="0%" stop-color="' + faceShade(look.shirt, 0.16) + '"/>' +
          '<stop offset="60%" stop-color="' + look.shirt + '"/>' +
          '<stop offset="100%" stop-color="' + faceShade(look.shirt, -0.26) + '"/>' +
        '</linearGradient>' +
        /* the face vignette: nothing at all across the middle two thirds, then a gentle
           fall-off at the silhouette. Transparent-to-dark on the SAME hue as the skin, so
           it deepens the tone instead of greying it. */
        '<radialGradient id="mlsAvBlush' + faceUid + '" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0%" stop-color="' + blush + '" stop-opacity="1"/>' +
          '<stop offset="100%" stop-color="' + blush + '" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<radialGradient id="mlsAvShine' + faceUid + '" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0%" stop-color="' + faceShade(look.hair, 0.46) + '" stop-opacity=".38"/>' +
          '<stop offset="100%" stop-color="' + faceShade(look.hair, 0.46) + '" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<radialGradient id="mlsAvVig' + faceUid + '" cx="50%" cy="42%" r="62%">' +
          '<stop offset="0%" stop-color="' + faceShade(look.skin, 0.20) + '" stop-opacity=".28"/>' +
          '<stop offset="58%" stop-color="' + look.skin + '" stop-opacity="0"/>' +
          '<stop offset="100%" stop-color="' + faceShade(look.skin, -0.40) + '" stop-opacity=".42"/>' +
        '</radialGradient>' +
      '</defs>' +
      /* ---- COMPOSED FOR THE CIRCLE IT IS ACTUALLY SHOWN IN (av-6.0.1) ------------------
         ⛔ EVERY judgement of this drawing was made in a SQUARE div, because that is what
         faceDemo mounts and what the harnesses and the gallery use. The two shipped
         surfaces are both ROUND with overflow:hidden — #mlsAvKioskFace is a 302px circle
         and the Setup/Settings preview is 72px — so a square-framed portrait arrives
         cropped on the diagonal: measured on the real kiosk, the crown crowded the top
         arc, the ears were cut by the sides, and .fShirt spanned y 250-380 inside a
         302-tall box, i.e. the shoulders, the V-neck and the collar — the parts that make
         it read as a clinician — were almost entirely outside the mask. The owner's words
         were "does not work correctly or look good".
         The content is therefore inset so the whole head, both ears and a real shoulder
         line all sit inside the inscribed circle. 0.84 with an 8-unit drop was chosen by
         rendering five candidates INSIDE the real 302px and 72px masks and looking at
         them, not by reasoning about the viewBox. .fFrame wraps everything except <defs>,
         so every id reference still resolves and no animation hook moves: the rig, the
         head tilt and the breathing transform are all inside it and compose with it. */
      '<g class="fFrame" transform="translate(100,106) scale(0.84) translate(-100,-98)">' +
      /* the CHEST is a real group: breathing moves GEOMETRY in here (the shirt
         ellipse itself grows and lifts), not a scale on the drawing */
      '<g class="fBody" style="transform-box:view-box;transform-origin:100px 180px;transition:transform .09s linear">' +
        /* ---- SHOULDERS, NOT A DOME (av-6.0.0) -----------------------------------------
           The torso was one ellipse rx74 ry50, which gives a rounded hump — the silhouette
           of a snowman, not a person in scrubs. A human shoulder line leaves the neck almost
           horizontally, breaks at the acromion, and drops. Three curves do it, and the
           breathing transform on .fBody moves this path exactly as it moved the ellipse. */
        '<path class="fShirt" d="M100 168 C' + '82 168 68 174 54 186 C40 198 30 214 26 256 L174 256 C170 214 160 198 146 186 C132 174 118 168 100 168 Z" ' +
          'fill="url(#mlsAvShirt' + faceUid + ')"/>' +
        /* ---- SCRUBS, NOT A BLOB (av-6.0.0). The garment was one flat ellipse with a
           notch, which read as a jumper. A clinician's top has shoulder seams, a V-neck
           with a visible under-tee, and a chest pocket — three cheap shapes that carry
           most of the "professional" signal. */
        '<g class="fUniform" pointer-events="none">' +
          /* ⛔ NO SHOULDER SEAMS, AND NO SLEEVE SHADOW EITHER. Two curves from the collar
             out to the shoulder tips read as bag straps. Moved to the outer shoulder they
             read as pale epaulettes — and that one was instructive: the arc crossed the
             garment's edge, so half of a dark stroke at .45 opacity was landing on the
             PAGE, which mixed it up to a light grey. Barely 30px of chest survives the
             kiosk crop; the V-neck and collar carry the whole "clinician" signal, and
             every extra mark here has cost more than it earned. */
          /* the V opening shows the SHADOW INSIDE THE GARMENT, not skin. Filling it with a
             skin shade rendered as a brown wedge sitting on the chest. */
          '<path d="M84 157 Q100 186 116 157 Q100 170 84 157 Z" fill="' + faceShade(look.shirt, -0.46) + '"/>' +
          '<path class="fCollar" d="M80 156 Q100 192 120 156 Q100 174 80 156 Z" fill="none" stroke="' + faceShade(look.shirt, -0.34) + '" stroke-width="2.6" stroke-linejoin="round"/>' +
          /* ⛔ AND NO POCKET. It was an outlined rectangle (a floating square), then two
             strokes (a floating right-angle that read as a rendering glitch). Only ~30px
             of chest is above the crop at kiosk size, and a pocket carries no clinical
             signal — the V-neck and the sleeve shadow do all the "clinician" work. */
        '</g>' +
        steth +
      '</g>' +
      /* ---- THE NECK (av-6.0.0) ------------------------------------------------------
         There was none: the jaw sat straight on the garment, which is most of why the old
         drawing read as a head-and-shoulders sticker rather than a person. It is drawn
         AFTER the torso and BEFORE the head, so the collar overlaps its base and the jaw
         overlaps its top — that overlap is what makes the three read as one body.
         The shadow across the top is the jaw's own shadow falling on the throat; without
         it a neck looks like a post the head is balanced on. */
      '<g class="fNeck" pointer-events="none">' +
        '<path d="M' + n2(100 - sh.rx * 0.40) + ' ' + n2(98 + sh.ry * 0.72) + ' L' + n2(100 - sh.rx * 0.34) + ' 172 Q100 178 ' + n2(100 + sh.rx * 0.34) + ' 172 L' + n2(100 + sh.rx * 0.40) + ' ' + n2(98 + sh.ry * 0.72) + ' Z" ' +
          'fill="' + faceShade(look.skin, -0.13) + '"/>' +
        '<path d="M' + n2(100 - sh.rx * 0.38) + ' ' + n2(98 + sh.ry * 0.74) + ' Q100 ' + n2(98 + sh.ry * 0.98) + ' ' + n2(100 + sh.rx * 0.38) + ' ' + n2(98 + sh.ry * 0.74) + ' L' + n2(100 + sh.rx * 0.36) + ' ' + n2(98 + sh.ry * 0.86) + ' Q100 ' + n2(98 + sh.ry * 1.10) + ' ' + n2(100 - sh.rx * 0.36) + ' ' + n2(98 + sh.ry * 0.86) + ' Z" ' +
          'fill="' + faceShade(look.skin, -0.40) + '" opacity=".45"/>' +
      '</g>' +
      back +
      /* the RIG carries the FAST acting (breath bob, listening nod, concern
         head-shake). .fHead keeps the slow mood tilt on its own .45s
         transition, so the two never fight for one transform. */
      '<g class="fHeadRig" style="transform-box:view-box;transform-origin:100px 152px;transition:transform .16s ease-out">' +
      '<g class="fHead" style="transform-box:fill-box;transform-origin:50% 62%;transition:transform .45s ease">' +
        /* ---- EARS (av-6.0.0). They were two circles pinned to the widest point of the
           balloon, which is exactly how a cartoon does it. A real ear is taller than it is
           wide, its top sits level with the BROW and its lobe level with the nose base, it
           tucks INTO the skull rather than being stuck on, and it has a visible helix rim
           and inner fold. Placed off the skull's own temple landmark so a narrow face gets
           narrow-set ears. */
        earOf(-1) + earOf(1) +
        /* ---- THE SKULL, BUILT FROM SCRATCH (av-6.0.0) ---------------------------------
           Owner: "completly chan gei t liek from scratch."
           It was ONE ELLIPSE. Every human head is widest at the temples, narrows through
           the cheekbones, and tapers to a jaw and a chin — an ellipse has none of that, so
           no amount of shading painted on top could stop it reading as a balloon with
           features printed on it. This is a closed path in eight arcs, built from the same
           sh.rx / sh.ry the matcher decides, so a round face is still round and a long face
           still long; only the SHAPE of the boundary changed.
           Landmarks, all as fractions of the skull so nothing is nailed to a constant:
             temple  ±0.98rx at y = 98 - 0.34ry     (widest point, just above the eyes)
             cheek   ±0.86rx at y = 98 + 0.16ry
             jaw     ±0.52rx at y = 98 + 0.66ry     (the corner of the mandible)
             chin     0      at y = 98 + 1.00ry     (with a slight square, not a point) */
        '<path class="fSkin fFace" d="' +
          'M100 ' + n2(98 - sh.ry) +
          ' C' + n2(100 + sh.rx * 0.60) + ' ' + n2(98 - sh.ry) + ' ' + n2(100 + sh.rx * 0.98) + ' ' + n2(98 - sh.ry * 0.72) + ' ' + n2(100 + sh.rx * 0.98) + ' ' + n2(98 - sh.ry * 0.34) +
          ' C' + n2(100 + sh.rx * 0.98) + ' ' + n2(98 - sh.ry * 0.02) + ' ' + n2(100 + sh.rx * 0.90) + ' ' + n2(98 + sh.ry * 0.10) + ' ' + n2(100 + sh.rx * 0.86) + ' ' + n2(98 + sh.ry * 0.30) +
          ' C' + n2(100 + sh.rx * 0.80) + ' ' + n2(98 + sh.ry * 0.50) + ' ' + n2(100 + sh.rx * 0.70) + ' ' + n2(98 + sh.ry * 0.62) + ' ' + n2(100 + sh.rx * 0.52) + ' ' + n2(98 + sh.ry * 0.74) +
          ' C' + n2(100 + sh.rx * 0.36) + ' ' + n2(98 + sh.ry * 0.90) + ' ' + n2(100 + sh.rx * 0.20) + ' ' + n2(98 + sh.ry * 1.00) + ' 100 ' + n2(98 + sh.ry) +
          ' C' + n2(100 - sh.rx * 0.20) + ' ' + n2(98 + sh.ry * 1.00) + ' ' + n2(100 - sh.rx * 0.36) + ' ' + n2(98 + sh.ry * 0.90) + ' ' + n2(100 - sh.rx * 0.52) + ' ' + n2(98 + sh.ry * 0.74) +
          ' C' + n2(100 - sh.rx * 0.70) + ' ' + n2(98 + sh.ry * 0.62) + ' ' + n2(100 - sh.rx * 0.80) + ' ' + n2(98 + sh.ry * 0.50) + ' ' + n2(100 - sh.rx * 0.86) + ' ' + n2(98 + sh.ry * 0.30) +
          ' C' + n2(100 - sh.rx * 0.90) + ' ' + n2(98 + sh.ry * 0.10) + ' ' + n2(100 - sh.rx * 0.98) + ' ' + n2(98 - sh.ry * 0.02) + ' ' + n2(100 - sh.rx * 0.98) + ' ' + n2(98 - sh.ry * 0.34) +
          ' C' + n2(100 - sh.rx * 0.98) + ' ' + n2(98 - sh.ry * 0.72) + ' ' + n2(100 - sh.rx * 0.60) + ' ' + n2(98 - sh.ry) + ' 100 ' + n2(98 - sh.ry) +
          ' Z" fill="url(#mlsAvSkin' + faceUid + ')"/>' +
        /* ---- MODELLING (av-6.0.0). A single flat fill is why the old face read as a
           sticker: a real head is lit from above, so the forehead is the brightest plane,
           the temples and the jaw fall away, and there is a shadow under the cheekbone and
           beneath the chin. None of these are interactive and all sit UNDER the features,
           so nothing here can intercept a click or change a measurement. */
        /* ⛔ TWO ATTEMPTS AT PAINTED SHADING, BOTH REJECTED ON SIGHT (av-6.0.0).
           First five hard ellipses: they read as blotches — dark bands down the sides with
           a pale block stranded across the eye line. Then one radial vignette: it read as a
           translucent BAND across the face, edge to edge over the ears. The owner's verdict
           on the second was "that looks so weird".
           The lesson is structural, not a tuning problem: an overlay painted ON a flat
           ellipse always looks like an overlay, because the silhouette underneath is not a
           head. Modelling belongs in the GEOMETRY — a skull that is wider at the temples
           than at the jaw, with a chin — and in the skin ramp that follows it. So there is
           no overlay layer here at all now; see fFace below. */
        /* the chin's own shadow. At 0.86ry it sat ON the chin and read as a smudge on it;
           a chin shadow falls BELOW the chin, onto the throat, so it belongs at the very
           edge of the silhouette where the neck takes over. */
        '<g class="fModel" pointer-events="none">' +
          '<ellipse cx="100" cy="' + n2(98 + sh.ry * 1.00) + '" rx="' + n2(sh.rx * 0.26) + '" ry="' + n2(sh.ry * 0.055) + '" fill="' + faceShade(look.skin, -0.42) + '" opacity=".18"/>' +
        '</g>' +
        jaw +
        '<g class="fCrownFit" transform="' + fit + '">' + beard + hair + temples + cap + '</g>' +
        /* CHEEK WARMTH, not clown spots (av-6.0.0). Two hard-edged circles at 22% read as
           a doll's painted cheeks. An adult's flush is a soft diffuse ellipse, wider than
           it is tall, sitting on the cheekbone rather than the middle of the cheek. The
           class and the opacity transition are unchanged, so the mood code that raises the
           flush on a warm greeting still drives exactly this. */
        /* ⛔ STILL CLOWN CHEEKS AT REAL SIZE. Softening the SHAPE (hard circles -> ellipses)
           was only half of it; at the kiosk's 302px two salmon patches at .13 on a pale skin
           still read as painted-on doll blush — visible in the very first real-surface
           screenshot. An adult's flush is barely there. .07 base, wider and flatter, and it
           fades out at its own edge instead of ending on one, so there is no rim to notice.
           The class and the transition are unchanged, so the mood code that raises the flush
           on a warm greeting still drives exactly this, from a quieter floor. */
        '<ellipse class="fBlush" cx="' + n2(100 - 36 * FX) + '" cy="' + n2(115 + dyN) + '" rx="15" ry="7.5" fill="url(#mlsAvBlush' + faceUid + ')" opacity=".07" style="transition:opacity .4s ease"/>' +
        '<ellipse class="fBlush" cx="' + n2(100 + 36 * FX) + '" cy="' + n2(115 + dyN) + '" rx="15" ry="7.5" fill="url(#mlsAvBlush' + faceUid + ')" opacity=".07" style="transition:opacity .4s ease"/>' +
        '<g class="fBrowL" style="transform-box:fill-box;transform-origin:center;transition:transform .35s ease"><path d="M' + n2(cxL - 13) + ' 78 Q' + n2(cxL - 1) + ' 72 ' + n2(cxL + 13) + ' 77" stroke="' + browPaint + '" stroke-width="' + browW + '" stroke-linecap="round" fill="none"/></g>' +
        '<g class="fBrowR" style="transform-box:fill-box;transform-origin:center;transition:transform .35s ease"><path d="M' + n2(cxR - 13) + ' 77 Q' + n2(cxR + 1) + ' 72 ' + n2(cxR + 13) + ' 78" stroke="' + browPaint + '" stroke-width="' + browW + '" stroke-linecap="round" fill="none"/></g>' +
        /* the glabellar KNIT - two short creases between the brows. Concern is
           read there before it is read anywhere else on a human face. */
        '<path class="fKnit" d="M96.5 72 Q97.5 66 96.5 61 M103.5 72 Q102.5 66 103.5 61" stroke="' + shadeKnit + '" stroke-width="2" stroke-linecap="round" fill="none" opacity="0" style="transition:opacity .3s ease"/>' +
        eye(cxL, 'L') + eye(cxR, 'R') + glasses +
        /* the whole nose sits at half strength: a nose is a shadow, and at 302px full-strength
           strokes plus two dark nostrils read as a squiggle drawn on the face. The nostrils
           take the same treatment — shadeHole at full opacity punched two black dots either
           side of the tip, which is the single most cartoon mark on the face. */
        '<g class="fNoseSet" transform="translate(0,' + n2(dyN) + ')" opacity=".6">' +
          '<path class="fNose" d="' + nose.d + '" stroke="' + shadeNose + '" stroke-width="' + nose.w + '" stroke-linecap="round" fill="none"/>' +
          '<ellipse class="fNostril fNostrilL" cx="' + n2(100 - nose.nx) + '" cy="' + nose.ny + '" rx="' + nose.nr + '" ry="' + noseRy + '" fill="' + shadeNose + '" opacity=".72"/>' +
          '<ellipse class="fNostril fNostrilR" cx="' + n2(100 + nose.nx) + '" cy="' + nose.ny + '" rx="' + nose.nr + '" ry="' + noseRy + '" fill="' + shadeNose + '" opacity=".72"/>' +
        '</g>' +
        '<g class="fMouthSet" transform="translate(0,' + n2(dyM) + ')">' +
        '<g class="fMouthWrap" style="transform-box:fill-box;transform-origin:center top;transition:transform .1s ease">' +
          '<g class="fLips" style="transform-box:fill-box;transform-origin:center;transform:scaleY(' + lips.scale + ');transition:transform .3s ease">' +
            '<path class="fMouth" d="' + FACE_MOUTHS.smile + '" fill="' + look.lip + '"/>' +
            /* THE INSIDE OF THE MOUTH (av-6.0.1). Every shape — including open1/open2/open3
               and the talking cycle — was one path filled with the LIP colour, so the moment
               the avatar spoke its mouth became a flat lip-coloured disc. That is what the
               patient sees for most of the visit, and it is the first thing the real-kiosk
               screenshot caught. A mouth that is open shows the cavity behind the lips: the
               same path, inset by a uniform scale so the lip colour survives as a RIM, filled
               with a dark shade OF look.lip so it still tracks the doctor's chosen colour.
               On the closed shapes the inset collapses to a thin line, which is exactly what
               a closed mouth is, so one shape table serves both. */
            '<path class="fMouthIn" d="' + FACE_MOUTHS.smile + '" fill="' + faceShade(look.lip, -0.66) + '" ' +
              'style="transform-box:fill-box;transform-origin:center;transform:scale(0.82,0.62)"/>' +
            /* the LINER, not an outline. Stroked at full strength around a shape only ~8
               units tall, the dark liner covered most of the lip fill, so at 302px the
               mouth read as a thin brown SLIT rather than lips — the shape was right and
               the weight was wrong. Thinner and half-transparent lets the lip colour show
               between the lines, which is what makes a mouth look soft. */
            '<path class="fLipUp" d="' + FACE_MOUTHS.smile + '" fill="none" stroke="' + faceShade(look.lip, -0.34) + '" stroke-width="' + (Math.round(lips.w * 0.62 * 100) / 100) + '" stroke-linejoin="round" opacity=".7"/>' +
          '</g>' +
          '<path class="fDimpleL" d="M74 130 q-3 4 0 8" stroke="' + shadeSoft + '" stroke-width="2" fill="none" opacity="0" style="transition:opacity .3s ease"/>' +
          '<path class="fDimpleR" d="M126 130 q3 4 0 8" stroke="' + shadeSoft + '" stroke-width="2" fill="none" opacity="0" style="transition:opacity .3s ease"/>' +
        '</g>' +
        '</g>' +
        ageLines +
      '</g></g></g></svg>';   /* fHead / fHeadRig / fFrame */
  }
  function makeFace(mount, look) {
    if (!mount) return null;
    mount.innerHTML = faceSvg(look);
    var root = mount.querySelector('svg');
    if (!root) return null;
    var ctl = null;
    function q(sel) { return root.querySelector(sel); }
    /* .fShirt is deliberately NOT bound any more: breathing drives .fBody, and a
       binding kept only so a dead code path can write to it is how the chest came to
       stop moving without anything noticing. */
    var head, rig, body, mouthIn, browL, browR, eyeL, eyeR, pupL, pupR,
      lidL, lidR, lowL, lowR, mouth, lipUp, lipsG, mouthWrap, dimpleL, dimpleR, knit, blush;
    function bind() {
      head = q('.fHead'); rig = q('.fHeadRig'); body = q('.fBody');
      browL = q('.fBrowL'); browR = q('.fBrowR');
      eyeL = q('.fEyeL'); eyeR = q('.fEyeR'); pupL = q('.fPupilL'); pupR = q('.fPupilR');
      lidL = q('.fLidL'); lidR = q('.fLidR'); lowL = q('.fLowL'); lowR = q('.fLowR');
      mouth = q('.fMouth'); mouthIn = q('.fMouthIn'); lipUp = q('.fLipUp'); lipsG = q('.fLips'); mouthWrap = q('.fMouthWrap');
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
      if (mouthIn) mouthIn.setAttribute('d', d);
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
      if (!reduced && body) {
        breathT += 0.13;
        var p = Math.sin(breathT);
        /* ⛔ THE CHEST STOPPED BREATHING AND THE PIN WATCHING IT STILL PASSED (av-6.0.0).
           This used to be setAttribute('ry') / setAttribute('cy') on .fShirt, which was
           an <ellipse>. av-6.0.0 gave the torso a shoulder PATH instead — and `ry`/`cy`
           mean nothing on a <path>, so both writes became no-ops. Nothing crashed: an
           unrecognised attribute is still stored and still reads back, so the harness
           sampling `shirt.getAttribute('ry')` watched a dead attribute tick up and down
           and reported "the chest RADIUS itself changes over time" for a chest that was
           only bobbing 1px. The measurement must be the RENDERED box, never an attribute.
           The expansion now rides a transform on .fBody. That group holds ONLY the torso,
           the uniform and the stethoscope — the head, neck and face are all outside it —
           so this is a chest inflating, not a zoom of the drawing, which is what the old
           comment here was rightly afraid of. */
        body.style.transform = 'translateY(' + (-p * 1.1).toFixed(2) + 'px) scale(' +
          (1 + p * 0.014).toFixed(4) + ',' + (1 + p * 0.010).toFixed(4) + ')';
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
  /* =========================================================================
     av-5.7.0 - THE FACE IS FOUND BEFORE IT IS MEASURED.

     Owner, 2026-08-07: "the match avataer to face doesnt work at all make it
     actally match with skin tone beard or not and all that kinda stuff it needs
     to have a facial algeraithum."

     THE MECHANISM, and it explains every symptom at once. Every measurement in
     the previous matcher was taken at a FIXED FRACTION OF THE PICTURE - skin at
     (0.30, 0.52), hair at (0.50, 0.11), the jaw at (0.72) - on the stated
     assumption that "the portrait is a centred square crop with the head
     filling the frame". A webcam does not frame a head that way. Sitting at
     arm's length the head fills perhaps a third of the frame and sits high, so
     those coordinates land on the WALL and the SHIRT: the crown patches read
     whatever was above the head (a pale ceiling reads as pale hair on a
     black-haired doctor, which is exactly what the owner was shown), the jaw
     patch reads collar, and the "skin" patches read chest. The classifiers
     underneath were sound; they were being fed the wrong pixels.

     So the geometry comes out of the picture now instead of being assumed:

       1. A SKIN MASK in YCbCr. The chroma of skin is remarkably constant across
          every skin tone while its luminance is not - which is why no
          brightness test could ever have done this job.
       2. A SECOND PASS, because DARK HAIR IS CHROMATICALLY SKIN. Measured:
          #3a2a1b hair sits inside the skin-chroma cluster, so the hair mass
          merged with the face, the box began at the top of the hair, and the
          skin sample came back the colour of the hair. The first pass finds a
          head; the brighter half of it estimates the skin; the mask is then
          rebuilt against THAT estimate and the hair falls out of it.
       3. CONNECTED COMPONENTS, and the face is chosen by shape and position,
          not merely size. A beige wall is one enormous component and is
          rejected for covering too much of the frame; an arm is rejected on
          aspect ratio; a scatter of warm pixels is rejected on fill.
       4. THE BOX comes from the component's own row-width profile: the widest
          row is the cheekbones, and the chin is where the width collapses
          toward the neck.
       5. THE EYE LINE IS ANATOMICAL, NOT PROPORTIONAL. The cheekbones sit level
          with the eyes, so the widest row IS the eye line - a measurement,
          available even on a face whose eyes cannot be seen. When two dark
          masses ARE found near it, they refine it.
       6. EVERY MEASUREMENT IS THEN BOX-RELATIVE, so the same face read at three
          different distances gives the same answer, and features are scaled
          against the face's own WIDTH - the one dimension a fringe cannot move.

     Refusals are unchanged in spirit and stricter in fact: `derived` names only
     what was really measured, and a photo with no findable face returns null
     rather than a confident description of somebody's living room.
     ======================================================================= */
  function faceTintFromPortrait(dataUrl, then) {
    if (!dataUrl || String(dataUrl).indexOf('data:image/') !== 0) { then(null); return; }
    var img = new Image();
    img.onload = function () { then(safe(function () { return faceReadPortrait(img); }, null)); };
    img.onerror = function () { then(null); };
    img.src = dataUrl;
  }
  /* skin in YCbCr. The bounds are the standard skin-chroma cluster; the
     luminance guard only throws away pixels that carry no usable chroma at all
     (crushed shadow, blown highlight). */
  function faceIsSkinRgb(r, g, b) {
    var y = 0.299 * r + 0.587 * g + 0.114 * b;
    if (y < 32 || y > 250) return false;
    var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    var cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    return cr >= 134 && cr <= 178 && cb >= 76 && cb <= 128 && r > b;
  }
  /* CIELAB, because skin is a HUE band and RGB has no such axis. Standard sRGB ->
     linear -> XYZ (D65) -> L*a*b*; h_ab = atan2(b*,a*) is the one number that separates
     every real skin tone from pink, and C* keeps lip vermilion out. Used by the skin
     gate in faceReadPortrait. */
  function faceLab(rgb) {
    function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
    var X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    var Y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
    var Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116); }
    var fx = f(X), fy = f(Y), fz = f(Z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }
  function faceHueAb(lab) {
    var h = Math.atan2(lab.b, lab.a) * 180 / Math.PI;
    return h < 0 ? h + 360 : h;
  }
  function faceChroma(lab) { return Math.sqrt(lab.a * lab.a + lab.b * lab.b); }

  function faceReadPortrait(img) {
    var M = 128;
    var c = document.createElement('canvas'); c.width = M; c.height = M;
    var x = c.getContext('2d');
    /* COVER, never stretch. A webcam frame is 4:3 or 16:9, and squeezing one
       into a square turns a round head oval - a shape verdict invented by the
       scaler. stylizePortrait already centre-crops what it captures; a photo
       arriving from anywhere else gets the same treatment here. */
    var iw = img.naturalWidth || img.width || M, ih = img.naturalHeight || img.height || M;
    var side = Math.min(iw, ih) || M;
    x.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, M, M);
    var d = x.getImageData(0, 0, M, M).data;
    function px(xx, yy) { var i = ((yy | 0) * M + (xx | 0)) * 4; return [d[i], d[i + 1], d[i + 2]]; }
    function lum(p) { return (p[0] * 3 + p[1] * 4 + p[2]) / 8; }
    function hex(p) { return '#' + p.map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(''); }
    function chDist(a, b) { return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3; }
    function medianCol(list) {
      if (!list || !list.length) return null;
      list.sort(function (p, q) { return lum(p) - lum(q); });
      return list[Math.floor(list.length / 2)];
    }
    function median(a) { if (!a.length) return null; a.sort(function (p, q) { return p - q; }); return a[Math.floor(a.length / 2)]; }

    /* ---- 0. WHITE BALANCE, FOR DETECTION ONLY (av-6.0.5) ------------------------------
       faceIsSkinRgb is an ABSOLUTE YCbCr window (cr 134-178, cb 76-128). That is fine under
       daylight and useless under a tungsten bulb, because the cast moves every pixel in the
       frame the same way. MEASURED on realfaces/p2.jpg, a man photographed in warm amber
       indoor light: 15,096 of 16,384 grid pixels — 92% of the picture, walls, wood panelling
       and a tan shirt included — pass the skin test, they merge into ONE component filling
       the frame, and the face becomes unfindable. Most photographs taken indoors in the
       evening look like that.
       Grey-world: the average of a whole scene is close to neutral, so the per-channel means
       give the cast, and dividing it out puts the picture back where the skin window expects
       it. Two deliberate limits:
         1. IT IS A NO-OP UNLESS THERE IS A REAL CAST. Below an 8% spread between the strongest
            and weakest channel nothing is touched at all, so every neutral photo — and every
            fixture in the two photo suites — goes down exactly the path it went down before.
            A change that quietly re-tints the ordinary case to fix the unusual one is the
            wider-than-the-defect cure this project keeps getting burned by.
         2. GAINS ARE CLAMPED to 0.65-1.55. An intentionally monochrome or single-colour
            photograph has a huge "cast" that is the subject, not the light, and an unclamped
            correction would invent colour that was never there.
       ⛔ AND IT IS USED FOR THE MASK ONLY. Every colour this function REPORTS still comes from
       the untouched pixels through px(): white-balancing the reported skin tone would be a
       different (arguable) change, and mixing it in here would make it impossible to tell
       which half moved a verdict. Detection is where the failure was. */
    var wbR = 1, wbG = 1, wbB = 1, wbOn = false;
    (function () {
      var sr = 0, sg = 0, sb = 0, sn = M * M, wq;
      for (wq = 0; wq < sn; wq++) { sr += d[wq * 4]; sg += d[wq * 4 + 1]; sb += d[wq * 4 + 2]; }
      var mr = sr / sn, mg = sg / sn, mb = sb / sn;
      var lo = Math.min(mr, mg, mb), hi = Math.max(mr, mg, mb);
      if (lo < 8 || hi <= 0) return;                 /* a near-black frame has no cast to read */
      if (hi / lo < 1.08) return;                    /* neutral enough: touch nothing */
      var grey = (mr + mg + mb) / 3;
      function gain(m) { var g = grey / m; return g < 0.65 ? 0.65 : g > 1.55 ? 1.55 : g; }
      wbR = gain(mr); wbG = gain(mg); wbB = gain(mb); wbOn = true;
    })();
    function wbPx(xx0, yy0) {
      var q = px(xx0, yy0);
      if (!wbOn) return q;
      var r0 = q[0] * wbR, g0 = q[1] * wbG, b0 = q[2] * wbB;
      return [r0 > 255 ? 255 : r0, g0 > 255 ? 255 : g0, b0 > 255 ? 255 : b0];
    }
    /* ---- 1. the skin mask, and the components in it -------------------- */
    var yy, xx, p;
    /* the mask is built as a RETRYABLE ATTEMPT — see wbPx. Attempt one is the untouched
       pixels, exactly as every build before this one; the white-balanced attempt happens ONLY
       if that finds no head at all. Gating on the size of the cast instead was measured and
       rejected: realfaces/p1.jpg, an ordinary sunny street, has a 29% channel spread, so an
       8% threshold fired on a photo that was already working and made it claim SPECTACLES the
       man is not wearing. A retry cannot do that to any photo that currently succeeds, because
       a photo that currently succeeds never reaches it. */
    function faceMaskAttempt(useWb) {
      var ch = new Uint8Array(M * M);
      for (var ay = 0; ay < M; ay++) {
        for (var ax = 0; ax < M; ax++) {
          var q = useWb ? wbPx(ax, ay) : px(ax, ay);
          if (faceIsSkinRgb(q[0], q[1], q[2])) ch[ay * M + ax] = 1;
        }
      }
      var lab = labelComponents(ch);
      return { chroma: ch, pass1: lab, head: pickFace(lab.comps) };
    }
    var stack = new Int32Array(M * M);
    function labelComponents(mask) {
      var label = new Int32Array(M * M), comps = [], next = 0;
      for (var s = 0; s < M * M; s++) {
        if (!mask[s] || label[s]) continue;
        next++;
        var top = 0; stack[top++] = s; label[s] = next;
        var area = 0, minX = M, maxX = -1, minY = M, maxY = -1;
        while (top > 0) {
          var cur = stack[--top], cy = (cur / M) | 0, cx = cur - cy * M;
          area++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          if (cx > 0 && mask[cur - 1] && !label[cur - 1]) { label[cur - 1] = next; stack[top++] = cur - 1; }
          if (cx < M - 1 && mask[cur + 1] && !label[cur + 1]) { label[cur + 1] = next; stack[top++] = cur + 1; }
          if (cy > 0 && mask[cur - M] && !label[cur - M]) { label[cur - M] = next; stack[top++] = cur - M; }
          if (cy < M - 1 && mask[cur + M] && !label[cur + M]) { label[cur + M] = next; stack[top++] = cur + M; }
        }
        comps.push({ id: next, area: area, minX: minX, maxX: maxX, minY: minY, maxY: maxY });
      }
      return { label: label, comps: comps };
    }
    function pickFace(comps) {
      var best = null, bestScore = 0;
      for (var ci = 0; ci < comps.length; ci++) {
        var cp = comps[ci], cw = cp.maxX - cp.minX + 1, ch = cp.maxY - cp.minY + 1;
        if (cp.area < M * M * 0.012) continue;          /* a face is never 1% of a portrait */
        if (cp.area > M * M * 0.72) continue;           /* that is a wall the colour of skin */
        if (cw < M * 0.10 || ch < M * 0.12) continue;
        var aspect = cw / ch;
        /* 1.9, not 1.7: a phone held close crops the forehead and the chin, and
           what is left is a wide band of face. Measured - the tight-crop
           fixture was REJECTED at 1.7, and the fallback then handed back the
           unrefined head, whose "skin" was the colour of the hair. */
        if (aspect < 0.42 || aspect > 1.9) continue;    /* an arm, a hand, a strip of background */
        if (cp.area / (cw * ch) < 0.42) continue;       /* a face is a solid mass, not a scatter */
        /* position matters as well as size: a portrait puts the head near the
           middle and slightly high. Size alone picks the neck-and-chest mass
           on a photo with an open collar. */
        var mx = (cp.minX + cp.maxX) / 2 / M, my = (cp.minY + cp.maxY) / 2 / M;
        var centre = 1 - Math.min(1, Math.abs(mx - 0.5) + Math.abs(my - 0.45));
        var score = cp.area * (0.35 + centre);
        if (score > bestScore) { bestScore = score; best = cp; }
      }
      return best;
    }
    var attempt = faceMaskAttempt(false);
    var wbUsed = false;
    if (!attempt.head && wbOn) {
      var retry = faceMaskAttempt(true);
      if (retry.head) { attempt = retry; wbUsed = true; }
    }
    var chroma = attempt.chroma, pass1 = attempt.pass1, head = attempt.head;
    /* NO HEAD, NO VERDICT. Everything downstream is relative to this box, so a
       guess here would not be one wrong knob - it would be a confident,
       complete description of the wall behind the doctor. */
    if (!head) {
      /* ⛔ THREE DIFFERENT GIVE-UPS USED TO RETURN THE SAME BARE null (av-6.0.5), so Setup
         printed one generic "I could not find a face" for causes that need opposite actions.
         MEASURED on a real photograph (realfaces/p2.jpg, a man in warm amber indoor light):
         15,096 of 16,384 grid pixels — 92% of the frame — pass the skin-chroma test, they form
         ONE component filling the whole picture, and pickFace correctly rejects it on its
         own "area > M*M*0.72 -> that is a wall the colour of skin" rule. THE GUARD IS RIGHT:
         describing the curtains as his face would be far worse. What was wrong is that the
         refusal said nothing, so the number that explains it — and the one thing that would
         fix the photo — never reached him. The coverage is measured here and named. */
      var onN = 0;
      for (var hq = 0; hq < M * M; hq++) if (chroma[hq]) onN++;
      var frac = onN / (M * M);
      return { look: null, derived: [], found: [frac > 0.60
        ? (Math.round(frac * 100) + "% of this picture reads as skin-coloured, so I cannot tell your face " +
           "from the room behind it — warm indoor light makes walls, wood and a tan shirt measure the same as " +
           "skin. Retake it facing a window, or in cooler and more even light, or against a plainer wall.")
        : frac < 0.02
          ? ("I could not find any skin-coloured area at all (" + Math.round(frac * 100) + "% of the picture). " +
             "That is usually a very dark or very bright photo, or a face too small in the frame — move closer " +
             "and face the light.")
          : ("I found skin-coloured areas but none of them was shaped like a face (" + Math.round(frac * 100) +
             "% of the picture reads as skin). Usually the head is small in the frame or turned away — take it " +
             "square-on with your face filling more of the picture.")] };
    }

    /* ---- 2. the second pass: separate SKIN from HAIR inside that head ---
       Dark brown and black hair fall inside the skin-chroma cluster, so pass 1
       returns head-and-hair as one mass. The brighter half of it is skin (hair
       is the darker half whichever tone the skin is), and rebuilding the mask
       against that estimate drops the hair out. Blond, grey and white hair
       never entered the mask at all - their chroma is outside the cluster - so
       this pass cannot take them for skin either. */
    var inHead = [];
    for (yy = head.minY; yy <= head.maxY; yy++) {
      for (xx = head.minX; xx <= head.maxX; xx++) {
        if (pass1.label[yy * M + xx] === head.id) inHead.push(px(xx, yy));
      }
    }
    var headMedL = median(inHead.map(lum)) || 0;
    var bright = inHead.filter(function (q) { return lum(q) >= headMedL; });
    var skinRef = medianCol(bright.length ? bright : inHead);
    if (!skinRef) {
      /* the head was found but no usable skin reference came out of it — see the !head branch
         above for why a silent null is not good enough */
      return { look: null, derived: [], found: ["I found your head but could not get a clean skin " +
        "reading from it — usually hard side light, a strong colour cast, or a filter. Retake it in even " +
        "light with no filter."] };
    }
    var refL = lum(skinRef);
    var mask = new Uint8Array(M * M);
    for (var s2 = 0; s2 < M * M; s2++) {
      if (!chroma[s2]) continue;
      var q2 = px(s2 % M, (s2 / M) | 0);
      if (lum(q2) > refL - 42 && chDist(q2, skinRef) < 56) mask[s2] = 1;
    }
    /* ---- 2b. CLOSE THE HORIZONTAL CUTS before labelling. A spectacle frame is
       a dark bar right across the face, so it SPLITS the skin into a forehead
       component and a face component - and the picker then measured whichever
       half was bigger, from below the frame. Measured on the fixture: the box
       began at y=55 on a face that starts at y=20, and hair, brows and glasses
       all came back wrong from that one cut. A moustache cuts the same way. So
       gaps of up to ~8% of the frame are bridged for the GEOMETRY, while every
       colour is still sampled from the raw skin mask - a filled gap is a
       measurement of where the face IS, never of what colour it is. */
    var closed = new Uint8Array(M * M);
    closed.set(mask);
    var GAP = Math.max(4, Math.round(M * 0.08));
    for (var cxx = 0; cxx < M; cxx++) {
      var lastOn = -1;
      for (var cyy = 0; cyy < M; cyy++) {
        if (mask[cyy * M + cxx]) {
          if (lastOn >= 0 && cyy - lastOn <= GAP) {
            for (var fy = lastOn + 1; fy < cyy; fy++) closed[fy * M + cxx] = 1;
          }
          lastOn = cyy;
        }
      }
    }
    var pass2 = labelComponents(closed);
    var best = pickFace(pass2.comps);
    /* NO FALLBACK TO THE UNREFINED HEAD. That fallback is how a hair-coloured
       "skin tone" reached the doctor: pass 1 deliberately contains the hair. If
       the refined pass cannot find a face, the honest answer is that this photo
       could not be read. */
    if (!best) {
      return { look: null, derived: [], found: ["I found your head but could not separate your skin from " +
        "your hair inside it — usually very dark hair in low light, where the two measure the same. Retake it " +
        "with more light on your face."] };
    }
    var label = pass2.label;

    /* the background, sampled from the frame border EXCLUDING the face mass */
    var bgList = [];
    for (xx = 0; xx < M; xx += 2) {
      [0, 1, M - 2, M - 1].forEach(function (by) { if (label[by * M + xx] !== best.id) bgList.push(px(xx, by)); });
    }
    for (yy = 0; yy < M; yy += 2) {
      [0, 1, M - 2, M - 1].forEach(function (bx) { if (label[yy * M + bx] !== best.id) bgList.push(px(bx, yy)); });
    }
    var bg = medianCol(bgList);
    var bgL = bg ? lum(bg) : -999;
    function isBg(pp) { return !!bg && chDist(pp, bg) < 26; }

    /* ---- 3. the box, from the component's own row-width profile -------- */
    function rowRun(ry) {
      /* THE OUTER EXTENT OF THIS COMPONENT ON THIS ROW, not the widest
         contiguous run of it. Every dark feature - lips, nostrils, a frame, a
         moustache - is a HOLE in the skin mask, and a contiguity measure reads
         a hole as the face having ended. Measured: the lip ellipse split the
         mouth row into two 23px runs on a 74px face, so the chin was "found"
         at the mouth and every proportion below the eyes was taken against a
         face two thirds of its length. An earring or a raised hand cannot
         widen this, because they are a different component. */
      var bL = -1, bR = -2;
      for (var rx = 0; rx < M; rx++) {
        if (label[ry * M + rx] === best.id) { if (bL < 0) bL = rx; bR = rx; }
      }
      return bR >= bL && bL >= 0 ? { L: bL, R: bR, w: bR - bL + 1 } : null;
    }
    var rows = [], maxW = 0;
    for (var ry2 = best.minY; ry2 <= best.maxY; ry2++) {
      var rr2 = rowRun(ry2);
      rows.push(rr2);
      if (rr2 && rr2.w > maxW) maxW = rr2.w;
    }
    function runAt(ry) { return (ry >= best.minY && ry <= best.maxY) ? rows[ry - best.minY] : null; }
    /* THE CHEEKBONE ROW IS THE MIDDLE OF THE WIDEST BAND, not the first row to
       reach the maximum. A face barely narrows for ten rows either side of its
       widest point, so the single widest row is decided by JPEG bleed at the
       edge of the head - measured, it landed 10px above the true cheekbones,
       and everything anchored on it (the eye line, the jaw sample, the hanging
       hair) moved with it. */
    var wideRows = [];
    for (var wy = best.minY; wy <= best.maxY; wy++) {
      var wr = runAt(wy);
      if (wr && wr.w >= maxW * 0.97) wideRows.push(wy);
    }
    var maxWY = wideRows.length ? median(wideRows) : best.minY;
    var faceT = best.minY;
    /* the chin: below the cheeks, the first row whose width has collapsed. The
       neck is narrower than the jaw, so this is where the face ends even when
       the mask runs on down the throat. */
    /* WHERE THE NARROWING STOPS, not where it reaches an arbitrary fraction. A
       face narrows continuously from the cheekbones to the chin; below the chin
       a NECK holds roughly constant width and shoulders widen again. So the chin
       is the last row of the narrowing - which needs no threshold and works
       whether or not the neck is in the picture at all. A fixed "55% of the
       widest row" cut landed 8px above the real chin on the drawn heads and
       ran straight down the throat on a photograph. */
    var chinY = best.maxY, prevW = null, flat = 0;
    /* WHY the scan stopped is part of the answer, not a debugging aid: a scan that
       ended because the outline WIDENED has not found a jaw, it has found the top
       edge of something else (a bridged shadow, a collar, a shoulder). */
    var chinStop = 'mask-end';
    var flatCap = Math.max(3, Math.round(maxW * 0.10));
    for (var dy = maxWY + Math.max(2, Math.round(maxW * 0.12)); dy <= best.maxY; dy++) {
      var rw = runAt(dy);
      if (!rw) { chinY = dy - 1; chinStop = 'mask-hole'; break; }
      /* PAST THE CHEEKS FIRST. Around the widest row a face barely narrows at
         all, so both end tests fire there: measured, the plateau test stopped
         at the cheekbones and returned a face 29px long instead of 70. Neither
         test is asked anything until the width has actually come down. */
      /* AND A PLATEAU IS ONLY A NECK IF IT IS NECK-WIDTH. An under-chin shadow
         bridged by the GAP closing manufactures its own plateau - measured, one
         face with a shadow growing monotonically moved the chin 103 -> 91 and
         flipped faceShape from round to square, with faceShape asserted as
         measured every time. The shadow's plateau sat at 0.65 of the widest row;
         a real neck is nearer 0.45. So a run that is still more than 0.62 of the
         face wide is not the neck, and the scan keeps going down. */
      if (prevW !== null && rw.w < maxW * 0.85) {
        /* WIDENING ALWAYS ENDS THE FACE, at any width. Below the jaw, anything
           that gets WIDER again is not face: shoulders, a collar, or - the case
           this was measured on - an under-chin shadow whose hole the GAP closing
           bridges back at the shadow's own (wider) extent. Gating this test on a
           width bound was my own error: the shadow sat at 0.80 of the widest row,
           the test was skipped, and the scan ran on down the neck. One face, one
           shadow growing monotonically, moved the chin 103 -> 91 and flipped
           faceShape round -> square with faceShape asserted as measured. */
        if (rw.w > prevW + 1) { chinY = dy - 1; chinStop = 'widening'; break; }
        /* the FLAT test is the one that needs a width bound - a plateau is only a
           neck if it is neck-width. 0.75, not 0.62: a broad neck is ordinary. */
        if (Math.abs(rw.w - prevW) <= 1 && rw.w <= maxW * 0.75) {
          flat++;
          if (flat >= flatCap) { chinY = dy - flat; chinStop = 'neck'; break; }
        } else if (Math.abs(rw.w - prevW) > 1) flat = 0;
      }
      prevW = rw.w;
      chinY = dy;
    }
    if (chinY <= maxWY) chinY = best.maxY;
    var faceRun = runAt(maxWY) || { L: best.minX, R: best.maxX, w: best.maxX - best.minX + 1 };
    var faceW = faceRun.w;
    var cxMid = Math.round((faceRun.L + faceRun.R) / 2);
    /* A FACE IS SYMMETRIC ABOUT ITS OWN CENTRE LINE; A HAND ON THE CHEEK IS NOT.
       Measured: a skin-coloured hand held clear of the face is correctly a
       separate component at every gap down to 0.03N - but TOUCHING, it merges,
       faceW goes 74 -> 97 (+32%), and every width-normalised verdict moves with
       it: a thick brow read as thin, an oval face as round, both asserted in
       `derived`. The nose centre line is the robust centre here (the median x of
       the mask across the mid-face), so an arm on one side cannot move it. Where
       the two halves disagree by more than a third, the WIDTH is taken from the
       narrower half - which is the face - and the group that describes the skull
       declines, because the outline it would measure is not all face. */
    /* THE CENTRE LINE COMES FROM THE UPPER FACE, where a hand is not. Taking it
       from the mid-face rows was my own first attempt and it cannot work: the
       hand is IN those rows, so it drags the centre with it and the two halves
       come out balanced - measured, asym stayed under the threshold and the
       clamp never fired. The forehead and temples are above where a hand rests
       against a cheek, so their centre is the face's own. */
    /* 🚨 THE OWNER'S OWN FACE MEASURED 12 PIXELS WIDE (av-5.7.4). He pressed Match,
       got "Clean-shaven" over his moustache and a pink swatch, and said it did an
       awful job. Measured on a fixture built to his photo, faceW came back 12 on a
       head whose widest row is 48, and that one number aims the beard, brow, nose
       and lip windows off his face entirely: the jaw patches landed at x 44/48/81
       with FOUR skin pixels across three 5x5 windows, so the luminance drop read 4
       against a stubble threshold of 24.
       WHY. His hair sweeps to one side, so the first four mask rows are a narrow
       sliver of exposed forehead - rowRuns [41,81,83,3] [42,80,83,4] [43,78,83,6]
       [44,78,84,7] before the head proper starts at [45,43,84,42]. Every one of
       those rows entered midCols with equal weight, and `median()` returns the
       UPPER middle of an even-length list, so [64,64,64,64,81,81,82,82] chose 81
       instead of 64. asym then read 6.83, the lopsided clamp fired, and
       faceW = 2*min(41,6) = 12.
       It was also HANDEDNESS-DEPENDENT: the same fixture mirrored measures asym
       1.04, faceW 48, and correctly detects stubble. A face cannot be allowed to
       get a different answer for parting its hair the other way.
       TWO FIXES, both narrow: only rows wide enough to HAVE a centre may vote, and
       the vote is width-weighted rather than a bare median. `median()` itself is
       untouched - it also feeds maxWY and wideRows, both calibrated in 128-space. */
    var midPairs = [];
    for (var mcy = faceT; mcy <= Math.min(best.maxY, faceT + Math.max(2, Math.round((maxWY - faceT) * 0.45))); mcy++) {
      var mr = runAt(mcy);
      /* a 3-px sliver of forehead beside a fringe carries no information about where
         the middle of a head is, and there are often more sliver rows than real ones */
      if (mr && mr.w >= Math.max(3, maxW * 0.35)) midPairs.push({ c: Math.round((mr.L + mr.R) / 2), w: mr.w });
    }
    var midCols = midPairs.map(function (p) { return p.c; });
    /* width-weighted median: a 42-px row counts fourteen times what a 3-px row does,
       and on an even split it interpolates instead of preferring the upper value */
    function midOf(pairs) {
      if (!pairs.length) return null;
      var sorted = pairs.slice().sort(function (a, b) { return a.c - b.c; });
      var total = 0, i;
      for (i = 0; i < sorted.length; i++) total += sorted[i].w;
      var half = total / 2, run = 0;
      for (i = 0; i < sorted.length; i++) {
        run += sorted[i].w;
        if (run >= half) {
          if (run === half && i + 1 < sorted.length) return (sorted[i].c + sorted[i + 1].c) / 2;
          return sorted[i].c;
        }
      }
      return sorted[sorted.length - 1].c;
    }
    var trueMid = midPairs.length ? midOf(midPairs) : cxMid;
    var halfL = Math.max(1, trueMid - faceRun.L), halfR = Math.max(1, faceRun.R - trueMid);
    var asym = Math.max(halfL, halfR) / Math.min(halfL, halfR);
    /* 1.20, not 1.35. An adversarial sweep of the SAME hand fixture across ten
       framings measured asym at 1.38, 1.39, 1.37, 1.38, 1.38, 1.41, 1.33, 1.32,
       1.35, 1.33 - so a threshold of 1.35 sat INSIDE this measurement's own noise
       band and the guard missed the hand at three framings (0.55, 0.50, 0.40),
       leaving faceW inflated 18-20% exactly where the framed suite lives. The
       clean face measures 1.03 on the same estimator, including under an 8-degree
       tilt, so 1.20 separates the two populations with room on both sides instead
       of splitting one of them. */
    var lopsided = asym > 1.20;
    /* AND THE CLAMP MUST STAY PLAUSIBLE. Halving a face is a reasonable response to an
       arm across one cheek; collapsing it to a quarter is not a measurement of a head.
       A hand fixture clamps to roughly 0.7 of the widest row; the owner's swept fringe
       drove it to 12/48 = 0.25, which then aimed every lower-face window into his hair.
       Below this floor the asymmetry is evidence that the OUTLINE is unreliable, not
       that the face is narrow, so the honest move is to keep the measured width and
       say the outline looked odd rather than to act on a number this far from the
       silhouette. */
    var geomOdd = false;
    if (lopsided) {
      var clamped = 2 * Math.min(halfL, halfR);
      if (clamped >= Math.max(6, maxW * 0.45)) {
        faceW = clamped;
        cxMid = trueMid;
      } else {
        geomOdd = true;
        lopsided = false;
      }
    }

    /* ---- 4. facial hair as GEOMETRY, before anything below the eyes is
       measured. A beard is not skin, so the mask STOPS at the moustache line:
       the "chin" found above is the top of the beard, and every proportion
       below the eyes would be taken against a face two thirds of its real
       length. The extension below the mask is measured directly - not
       background, not skin, inside the face's own column - and when it is
       there it IS the lower face. */
    var beardRows = 0, beardPix = [], beardBottom = chinY;
    var beardHalf = Math.max(2, Math.round(faceW * 0.30));
    for (var byy = chinY + 1; byy < Math.min(M, chinY + Math.round(faceW * 0.7)); byy++) {
      var hit = 0, wide = 0, rowPix = [];
      for (var bxx = cxMid - beardHalf; bxx <= cxMid + beardHalf; bxx++) {
        if (bxx < 0 || bxx >= M) continue;
        wide++;
        var bp = px(bxx, byy);
        if (!isBg(bp) && !mask[byy * M + bxx]) { hit++; rowPix.push(bp); }
      }
      if (wide && hit / wide > 0.6) { beardRows++; beardBottom = byy; beardPix = beardPix.concat(rowPix); }
      else break;
    }
    var beardDepth = beardRows / Math.max(1, faceW);
    var lowerChin = beardDepth > 0.10 ? beardBottom : chinY;
    var faceH = lowerChin - faceT + 1;

    /* ---- 5. the eye line. THE CHEEKBONES SIT LEVEL WITH THE EYES, so the
       widest row of the face is the eye line - and unlike any proportion of the
       box it does not move when a fringe hides the forehead. Two dark masses
       found NEAR it refine it; two found far from it are the mouth, a beard
       shadow or a shirt collar, and are ignored. --------------------------- */
    /* EVERY STATISTIC HERE IS A MEDIAN OR A COUNT, never a min and a max. The
       first version measured width as (rightmost - leftmost) dark pixel, and a
       single stray pixel from JPEG ringing at the edge of the window made a
       7px iris measure 26px wide - the same width as a spectacle frame. So the
       one number that had to tell an eye from a bar could not. Columns carrying
       at least two dark pixels are the mass; its width is HOW MANY of those
       there are, its height is the median column, and `round` is the ratio. An
       eye is about as tall as it is wide; a brow bar and a frame are three
       times wider than they are tall, at any distance and under any blur. */
    function darkMass(x0, x1, y0, y1, cut) {
      var cols = {}, ys = [], n = 0;
      for (var ey = y0; ey <= y1; ey++) {
        for (var ex = x0; ex <= x1; ex++) {
          if (ex < 0 || ex >= M || ey < 0 || ey >= M) continue;
          if (lum(px(ex, ey)) < cut) { cols[ex] = (cols[ex] || 0) + 1; ys.push(ey); n++; }
        }
      }
      if (!n) return null;
      var keep = Object.keys(cols).map(Number).filter(function (k) { return cols[k] >= 2; })
        .sort(function (a, b) { return a - b; });
      if (!keep.length) return null;
      var heights = keep.map(function (k) { return cols[k]; });
      var tall = median(heights) || 1;
      var wide = keep.length;
      return { medY: median(ys), cx: median(keep.slice()), n: n,
               spread: wide, tall: tall, round: tall / wide };
    }
    function atX(fr) { return Math.round(faceRun.L + faceW * fr); }
    function atY(fr) { return Math.round(faceT + faceH * fr); }
    /* `trueMedian` is OPT-IN and every existing call site omits it (av-6.0.6).
       ⛔ THIS IS THE SECOND ATTEMPT, AND THE FIRST ONE IS THE REASON FOR THE OPT-IN.
       The name says median and the vote ACROSS the five patches is one, but WITHIN a patch
       this sums and divides — and a mean cannot reject an outlier, it only dilutes itself
       with one. That is the owner's complaint restated exactly: "it needs to see the skin
       color of my face not my background + my face." The mask+component test excludes the
       wall, but it cannot exclude what is genuinely inside the face component and genuinely
       not skin — a spectacle rim, a nostril shadow, stubble, the dark line of a lid.
       The first attempt added an opt-OUT flag and set it at the skin call. patchMedian has
       TEN call sites, so that silently switched the other EIGHT — chin, cheek row, brow row,
       forehead, bridge, top colour — and the glasses read depends on the brow and bridge
       samples: avatar-photo-match-proof went 39 -> 38, and three fixes aimed at the skin
       path did nothing because the skin path was never what broke. Opt-IN inverts that: a
       call site that says nothing keeps the statistic it was calibrated on, so only the ONE
       sample I am deliberately changing can move. See the memory note this cost:
       a-flag-on-a-shared-helper-must-default-to-shipped. */
    function patchMedian(spots, r, skinOnly, trueMedian) {
      var cols = spots.map(function (sp) {
        var acc = [0, 0, 0], n = 0, pool = trueMedian ? [] : null;
        for (var py = sp[1] - r; py <= sp[1] + r; py++) {
          for (var pxx = sp[0] - r; pxx <= sp[0] + r; pxx++) {
            if (pxx < 0 || py < 0 || pxx >= M || py >= M) continue;
            if (skinOnly) {
              var si = py * M + pxx;
              /* 🚨 IT WAS MEASURING HIS WALL AND HIS FACE TOGETHER (av-5.7.7).
                 Owner: "it needs to see the skin color of my face not my background +
                 my face." Exactly right, and this line is why.
                 `mask` is built over the WHOLE FRAME in pass 2 with a chroma tolerance
                 of 56 - about 22% per channel - so it is not "the face", it is "every
                 pixel anywhere that resembles the reference". Measured against fair skin
                 [236,199,174]: a warm off-white wall scores 14.0 and is ADMITTED, a grey
                 shirt 26.3 ADMITTED, pale pink 19.3 ADMITTED. The comment that used to
                 sit here claimed this made "a wall the colour of a cheek impossible to
                 sample by accident"; it was false by a factor of four.
                 `label[i] === best.id` is the actual face: the connected component the
                 face detector CHOSE. A wall pixel can look like skin, but it cannot be
                 part of the component the head occupies. Both conditions now, so a
                 sample is skin AND on the face. */
              if (!mask[si]) continue;
              if (label[si] !== best.id) continue;
            }
            var q = px(pxx, py);
            if (pool) pool.push(q);
            acc[0] += q[0]; acc[1] += q[1]; acc[2] += q[2]; n++;
          }
        }
        if (!n) return null;
        if (!pool) return [acc[0] / n, acc[1] / n, acc[2] / n];
        /* ranked by LUMINANCE and the whole pixel returned, so the three channels stay from
           the same pixel. Averaging channels independently can synthesise a hue that appears
           nowhere in the photograph, which is the same class of error one level down — and
           `lum` is the same weighting medianCol uses for the vote across patches, so the two
           stages agree about what "middle" means. */
        pool.sort(function (a2, b2) { return lum(a2) - lum(b2); });
        return pool[Math.floor((pool.length - 1) / 2)];
      }).filter(Boolean);
      return medianCol(cols);
    }
    /* SKIN IS SAMPLED WHERE THE MASK SAYS SKIN **AND THE FACE COMPONENT SAYS FACE**.
       Either alone is not enough: the mask spans the whole frame, and the component
       alone would include hair and spectacle frames that the mask excludes. */
    var skin = patchMedian([[atX(0.20), maxWY], [atX(0.80), maxWY],
                            [atX(0.24), maxWY + Math.round(faceH * 0.12)],
                            [atX(0.76), maxWY + Math.round(faceH * 0.12)],
                            [cxMid, Math.round((faceT + maxWY) / 2)]], 2, true, true) || skinRef;
    /* THE 4th ARGUMENT IS THE OPT-IN, AND THIS IS THE ONLY CALL SITE THAT TAKES IT (av-6.0.6).
       The per-patch statistic here is now a TRUE MEDIAN. The first attempt at this made the
       flag an opt-OUT and cost the glasses read, because patchMedian has TEN call sites and
       eight of them silently changed with it; inverting the flag confines the change to this
       one sample, which is all I ever wanted to move. Both photo suites are green (39/39,
       40/40), and the refactor was proven inert before the opt-in was added.
       ⛔ AND IT DID NOT FIX WHAT IT WAS AIMED AT — measured on both real photographs, so this
       is recorded rather than claimed. The median moves the sampled value a few units
       (p1 #9d6c64 -> #a16765, p2 #af6228 -> #ab602b) and `derived` is IDENTICAL either way:
       the skin is REFUSED by the hue gate in both, so nothing the doctor sees changes. The
       statistic was never the blocker. The sampled colour is a muddy rose around hue 30-34°
       on a fair-skinned man, which means the SAMPLE IS NOT LANDING ON HIS CHEEK — the next
       lever is WHERE the five patches sit and what the mask admits, not how they are averaged.
       The median stays because it is the right statistic, it is free, and it cannot dilute
       itself with a spectacle rim; it is just not the cure. */
    /* the SAME five patches read as a mean, used ONLY to place the dark-mass cuts below.
       Every one of those thresholds is an offset from this number and was tuned against it;
       re-basing them on the median moved them all at once and cost a glasses detection that
       had been passing. The claim the doctor sees is `skin`, the median — an actual pixel
       colour from his face rather than an average of his cheek and whatever shared the patch. */
    /* ⛔ THREE ARGUMENTS, DELIBERATELY — skinCut EXISTS to be the MEAN. Every dark-mass cut
       below is an offset from it and was calibrated against the mean, so this is the one
       sample that must NOT follow the opt-in above. When the 4th parameter was renamed from
       asMean to trueMedian, this call still read `, 2, true, true)` from the earlier attempt
       and silently became a median too — which would have moved every threshold at once, the
       exact failure the opt-in was introduced to prevent, one rename later. Caught by counting
       arguments at all ten call sites rather than by reading the diff. */
    var skinCut = patchMedian([[atX(0.20), maxWY], [atX(0.80), maxWY],
                            [atX(0.24), maxWY + Math.round(faceH * 0.12)],
                            [atX(0.76), maxWY + Math.round(faceH * 0.12)],
                            [cxMid, Math.round((faceT + maxWY) / 2)]], 2, true) || skin;
    var skinL = lum(skinCut);
    /* the BAND THE DOCTOR IS TOLD must describe the colour he is SHOWN, so it reads the
       median like the swatch does — not the threshold statistic. */
    var skinLsaid = lum(skin);
    var eyeCut = skinL - 40;
    var eyeY = maxWY;
    var eyeBandTop = Math.max(faceT, maxWY - Math.round(faceH * 0.22));
    var eyeBandBot = Math.min(lowerChin, maxWY + Math.round(faceH * 0.10));
    var eL = darkMass(atX(0.10), atX(0.44), eyeBandTop, eyeBandBot, eyeCut);
    var eR = darkMass(atX(0.56), atX(0.90), eyeBandTop, eyeBandBot, eyeCut);
    /* THE CHEEKBONE ROW IS THE EYE LINE, FULL STOP. I tried refining it with
       the two dark masses and it is not worth the risk: on a face whose irises
       are not visible - a photo in ordinary room light, half of them - the
       masses available in that band are the EYEBROWS or a spectacle frame, and
       accepting either drags the eye line 11-14px above the cheekbones. The
       brow band then opens across the brows' own lower half and a thick brow
       measures thin, which is exactly the failure this pass was written to fix.
       The cheekbones are level with the eyes anatomically, they are a
       measurement rather than a proportion, and they do not move. The dark
       masses still earn their keep: their CENTROIDS give eye spacing, gated on
       roundness so a bar can never supply it. */
    var compact = eL && eR && eL.round > 0.70 && eR.round > 0.70;
    var lowerH = lowerChin - eyeY;
    if (lowerH < faceH * 0.20) lowerH = Math.round(faceH * 0.55);
    function belowEye(fr) { return Math.round(eyeY + lowerH * fr); }

    var found = [];
    /* SAY IT WHEN THE READING CAME OFF A CORRECTED COPY. The first attempt found no face at all
       and the second one only worked after dividing out a strong colour cast, so the doctor is
       entitled to know that before he trusts a swatch — a reading is not the same fact when the
       light had to be corrected to get it. It is disclosed, not hidden behind a green result. */
    if (wbUsed) {
      found.push("the light in this photo is strongly coloured, so I corrected the cast before I could " +
        "find your face at all — the shapes are reliable, but check the colours it chose, and a photo in " +
        "even daylight will read better.");
    }
    var look = { skin: hex(skin), hair: FACE_LOOK.hair, shirt: FACE_LOOK.shirt,
                 lip: FACE_LOOK.lip, eyes: FACE_LOOK.eyes,
                 hairStyle: 'short', glasses: false, beard: 'none' };
    /* THE LEDGER OF WHAT WAS ACTUALLY MEASURED. A knob absent from it is one
       the caller leaves exactly as the doctor set it. */
    /* NOTHING IS SEEDED HERE EXCEPT THE SKIN. A knob in this list is a CLAIM, and
       the caller applies every claim over whatever the doctor set by hand. Seeding
       'glasses' and 'beard' meant a NON-DETECTION was applied as a detection of
       absence: a doctor who ticked Glasses had the box UNTICKED by Match whenever
       the detector missed his frames - which, until the fix above, was every
       bald or shaved head. A detector that finds nothing has measured nothing.
       Each of these is now pushed by the branch that positively decides it. */
    /* ⛔ EVEN THE SKIN MUST EARN ITS PLACE (av-5.7.6). The owner's swatch came back PALE
       PINK and pink is not a skin tone - but the file was seeding 'skin' unconditionally,
       which is the one exemption from the rule stated directly above.
       TWO INDEPENDENT REASONS a pink answer arrives, and both are refused here:
       1. THE SOURCE IS THE ILLUSTRATION, NOT THE PHOTOGRAPH. stylizeCanvas posterizes
          every channel to six levels (steps of 51). Measured: the whole ordinary
          fair-skin gamut - 4,305 RGB triples, R 222-250 / G 182-214 / B 160-196 -
          collapses to exactly TWO output colours, 76% #ffcc99 and 24% #ffcccc, and
          #ffcccc IS pale pink. No estimator can recover a tone from that. The source is
          detected from its own pixels rather than trusted from a storage flag, because
          the flag is per-device and a portrait taken before av-5.7.2 has no
          full-quality copy at all: the chance of a real photograph having all three
          channels within +-6 of a multiple of 51 is (13/51)^3 = 1.7%, against ~100%
          for the posterized copy - a 50x separation that survives JPEG chroma
          subsampling.
       2. THE SAMPLE IS NOT SKIN-COLOURED. Skin of every tone sits in a narrow band of
          CIELAB hue: measured across all ten Monk Skin Tone shades, h_ab spans
          48.8-89.1 degrees, while every pink candidate falls below it (#f6d5d0 32.1,
          #f2cdc8 31.0, #efd0cf 22.8, a flushed cheek #e8b4a8 38.0, and the quantiser's
          own #ffcccc 21.0). ⛔ NOT the intuitive b*-a*>2 form: MST8 #604134 measures
          1.7 there and real deep skin would be refused. C* < 32 is the secondary guard,
          which excludes lip vermilion at 38.5 (MST maximum is 27.9). */
    var posterFrac = 0;
    (function () {
      var hits = 0, seen = 0;
      for (var pi = 0; pi < d.length; pi += 4 * 7) {          /* every 7th pixel is plenty */
        seen++;
        if (Math.abs(d[pi] % 51) <= 6 || Math.abs(d[pi] % 51) >= 45) {
          if ((Math.abs(d[pi + 1] % 51) <= 6 || Math.abs(d[pi + 1] % 51) >= 45) &&
              (Math.abs(d[pi + 2] % 51) <= 6 || Math.abs(d[pi + 2] % 51) >= 45)) hits++;
        }
      }
      posterFrac = seen ? hits / seen : 0;
    }());
    var fromIllustration = posterFrac > 0.5;
    var skinLab = faceLab(skin);
    var skinHue = faceHueAb(skinLab), skinChroma = faceChroma(skinLab);
    var skinIsSkinColoured = skinHue >= 45 && skinChroma < 32;
    var derived = [];
    if (fromIllustration) {
      found.push('this is the stylized copy of your photo, not the photograph — its colours are ' +
        'reduced to six steps per channel, so no colour was taken from it. Retake your photo and Match again.');
    } else if (!skinIsSkinColoured) {
      found.push('the skin sample came back ' + hex(skin) + ', which is outside the range real skin ' +
        'occupies (hue ' + Math.round(skinHue) + '°, needs 45°+) — usually the wall behind you ' +
        'bleeding into the sample, so your own skin colour was left alone');
    } else {
      derived.push('skin');
    }
    /* ONLY DESCRIBE A TONE THAT WAS ACCEPTED. Measured on a real photograph, the list read
       "the skin sample came back #9d6c64, which is outside the range real skin
       occupies ... so your own skin colour was left alone" and then, on the very next
       line, "tan skin" - two contradictory statements about the same sample. A refusal
       followed by a description reads as though the refusal did not happen. */
    if (derived.indexOf('skin') >= 0) {
      found.push(skinLsaid > 190 ? 'fair skin' : skinLsaid > 140 ? 'medium skin' : skinLsaid > 95 ? 'tan skin' : 'deep skin');
    }

    /* ---- 6. HAIR, in the band ABOVE the box ----------------------------
       Not a fixed row near the top of the picture - the band directly above
       THIS face, as tall as the face is long. "Hair" is what is neither this
       face's skin nor the background: the only definition that works for black
       hair on a pale wall AND white hair on a dark one, which are the two cases
       a brightness test gets backwards. */
    function unlikeSkin(pp) {
      /* 20, not 24: grey hair against fair skin scored 23.3 on this measure -
         a marginal miss that classified a grey-haired head as BALD. The band
         this runs in is ABOVE the face box, so the only other thing in it is
         the background, and isBg has already removed that. */
      return (Math.abs(lum(pp) - skinL) + chDist(pp, skinCut) * 0.5) > 20;
    }
    var bandTop = Math.max(0, faceT - Math.round(faceH * 0.55));
    var hairPix = [], crown = 0, crownN = 0;
    for (yy = bandTop; yy < faceT; yy++) {
      for (xx = atX(0.12); xx <= atX(0.88); xx++) {
        if (xx < 0 || xx >= M) continue;
        crownN++;
        p = px(xx, yy);
        if (!isBg(p) && !mask[yy * M + xx] && unlikeSkin(p)) {
          crown++;
          if (xx > atX(0.25) && xx < atX(0.75)) hairPix.push(p);
        }
      }
    }
    var crownR = crownN ? crown / crownN : 0;
    var hair = medianCol(hairPix);
    /* HAIR THE COLOUR OF THE WALL IS NOT A BALD HEAD - IT IS AN UNANSWERABLE
       QUESTION. isBg() is a distance test, so when the wall lands within 26 of
       the hair the whole hair mass classifies as background: measured on one
       fixture face with only the wall changing, #454a50 gave crownR 0.79 and
       "short hair", #3a3f45 gave crownR 0 and "BALD" - a cliff, from a wall.
       The two cases are told apart by GEOMETRY, not colour. A genuinely bald
       scalp is part of the skin mass, so the mask's top row is a narrow DOME. A
       head whose hair was mistaken for wall has its mask cut off flat at the
       forehead, so the top row is nearly as wide as the cheeks. When the top is
       wide, something is covering the crown and this photo cannot say what
       colour it is - so hairStyle and hair are left out of `derived` and the
       doctor's own setting stands. */
    var topRun = runAt(faceT);
    var flatTop = !!(topRun && maxW && (topRun.w / maxW) > 0.55);
    var hairUnreadable = (crownR < 0.20 && flatTop);
    /* side columns BESIDE the box, below the eye line: hair that hangs */
    var sideHit = 0, sideN = 0;
    var sideW = Math.max(2, Math.round(faceW * 0.28));
    /* from the CHEEKBONES down, not from the eye line: hair that hangs starts
       level with the ear. Beginning higher counts empty rows beside the temples
       and dilutes the ratio - measured, it put a full head of long hair at
       0.29 against a 0.30 threshold. */
    for (yy = maxWY; yy <= Math.min(M - 1, lowerChin + Math.round(faceH * 0.15)); yy++) {
      for (xx = Math.max(0, faceRun.L - sideW); xx < faceRun.L; xx++) {
        sideN++;
        p = px(xx, yy);
        if (!isBg(p) && !mask[yy * M + xx] && (!hair || chDist(p, hair) < 52)) sideHit++;
      }
      for (xx = faceRun.R + 1; xx <= Math.min(M - 1, faceRun.R + sideW); xx++) {
        sideN++;
        p = px(xx, yy);
        if (!isBg(p) && !mask[yy * M + xx] && (!hair || chDist(p, hair) < 52)) sideHit++;
      }
    }
    var sideR = sideN ? sideHit / sideN : 0;
    if (hairUnreadable) {
      /* say it out loud rather than answering. `hairStyle` never enters
         `derived`, so Match leaves the doctor's own choice alone.
         AND SAY THE RIGHT REASON. When the photo is cropped above the hairline
         there is no band to measure at all - bandTop clamps to 0, the loop never
         runs, and crownR is 0 BY CONSTRUCTION rather than by measurement. Blaming
         the background then sends the doctor to change his wall. crownN tells the
         two apart: zero means nothing was looked at. */
      found.push(crownN === 0
        ? 'hair could not be read — the top of the head is outside the photo'
        : 'hair could not be read — the background is too close to it in colour');
    }
    /* BALD IS SHOWN, NEVER CLAIMED (av-5.7.2, review round three). `!hair` means no
       hair pixel was found ANYWHERE - a non-detection, and this branch asserted it
       as a detection of absence, which is the exact mistake `derived` was rebuilt to
       stop making. It is reachable on ordinary heads: light blond (#e8d79a) passes
       faceIsSkinRgb and survives the pass-2 rebuild, so the hair joins the SKIN
       component, faceT sits at the top of the hair, and the crown band above it is
       background - byte-identical to a shaved head. Measured: 'bald' was claimed on
       42 of 120 skin x hair x background combinations where the head demonstrably
       HAD hair, overwriting the doctor's own hairStyle with 'bald' and greeting his
       patients with a bald avatar.
       A genuinely bald scalp and very light hair are the SAME measurement here, so
       the honest answer is to report and refuse, not to pick one. */
    else if (crownR < 0.20 || !hair) {
      look.hairStyle = 'bald';
      found.push('little or no hair — but very light hair measures the same as a shaved head, ' +
        'so your own hair setting was left alone');
    }
    else if (crownR < 0.42) { look.hairStyle = 'buzz'; derived.push('hairStyle'); found.push('very short hair'); }
    else if (sideR > 0.30) { look.hairStyle = 'long'; derived.push('hairStyle'); found.push('long hair'); }
    else { look.hairStyle = 'short'; derived.push('hairStyle'); found.push('short hair'); }
    if (!hairUnreadable && look.hairStyle !== 'bald' && hair) {
      look.hair = hex(hair);
      derived.push('hair');
      var hairL = lum(hair);
      found.push(hairL < 70 ? 'dark hair' : hairL > 165 ? 'light hair' : 'mid-tone hair');
    }

    /* ---- 7. FACIAL HAIR. The geometric read from step 4 is the strong
       evidence - a mass below the mask, in the face's own column, that is
       neither skin nor background. Stubble does not break the mask, so it is
       still read as the jaw being measurably darker than the cheeks, and both
       are compared against THIS face's own skin rather than a threshold. */
    if (beardDepth > 0.10 && beardPix.length > 20) {
      var bcol = medianCol(beardPix);
      look.beard = 'beard'; derived.push('beard'); found.push('beard');
      /* THE BEARD IS NOT THE HAIR. This branch fires exactly when no hair pixel was
         found, which is both the genuinely-bald head AND the head whose hair the
         background or the skin cluster swallowed - and in the second case it takes
         the colour from the BEARD and claims it as scalp hair. Shown, never claimed:
         a facial-hair colour applied to the head is a visible wrong answer, and
         `hairUnreadable` two branches up has already told the doctor why. */
      if (bcol && !hair && lum(bcol) < skinL - 20) { look.hair = hex(bcol); }
    } else {
      /* THE JAW, NOT THE MOUTH. Patches on or beside the lips made a dark lip
         colour read as a drop from the cheeks, and a clean-shaven face came
         back bearded. */
      /* skinOnly, and CLAMPED ABOVE THE CHIN. The three patch centres are on the
         face, but with r=2 the 5x5 window of the lowest one reached rows past
         lowerChin - so on a dark wall it sampled the WALL and the jaw came back
         "stubble" on a clean-shaven face. Measured with a resolving control, one
         face, wall only: #f2f2f2 -> drop -6 (none); #4a4f55 -> 25 (stubble);
         #3a3f45 -> 28; #000000 -> 40. The same three patches with skinOnly gave
         drop 1 in every case. Real stubble stays inside the mask - it darkens
         skin without leaving the skin-chroma cluster - so nothing that should be
         detected is lost by demanding the mask. */
      var jawY = Math.min(belowEye(0.88), lowerChin - 3);
      var chinY2 = Math.min(belowEye(1.0), lowerChin - 3);
      var chin = patchMedian([[atX(0.30), jawY], [atX(0.70), jawY], [cxMid, chinY2]], 2, true);
      if (chin) {
        var drop = skinL - lum(chin);
        if (drop > 46) { look.beard = 'beard'; derived.push('beard'); found.push('beard'); }
        else if (drop > 24) { look.beard = 'stubble'; derived.push('beard'); found.push('stubble'); }
      }
    }

    /* ---- 8. GLASSES: a bar across the BRIDGE at the measured eye line.
       "Darker than the forehead and the cheeks on both sides" is equally well
       explained by thick dark eyebrows - and eyebrows have a gap between them
       that a frame crosses. */
    /* THE FRAME'S OWN ROW IS FOUND, not assumed to be the eye line. Frames sit
       anywhere from the brow line to mid-eye depending on the face and the
       photograph, and probing one row missed a frame drawn 9px higher - which
       then had its bar measured as the thickest eyebrows in the practice. The
       darkest BRIDGE in the band is the candidate, because the bridge is what
       makes a frame a frame: eyebrows have a gap there and a frame crosses it. */
    var cheekRow = patchMedian([[atX(0.20), belowEye(0.30)], [atX(0.80), belowEye(0.30)]], 1, false);
    /* -1e9, not -1: darkness is a NEGATIVE luminance, so seeding the comparator
       at -1 meant no row was ever darker than the seed and the scan silently
       found nothing. A frame detector that always declines looks exactly like a
       face with no glasses. */
    /* WHERE THE HAIR STOPS, measured before the frame is looked for. A fringe
       hanging to the eye line is dark all the way across INCLUDING the bridge,
       and the bridge is the one thing this detector treats as proof of a frame:
       measured, a face with no spectacles anywhere read GLASSES at fringe bottoms
       0.40, 0.41 and 0.42 of the frame, and then abandoned the brow read too,
       because the brow measure stands down whenever glasses are "found". A
       spectacle frame sits on a nose, not in hair - so the scan starts below the
       hair mass. */
    var fringeStop = faceT;
    {
      var fcols = [];
      for (var ffx = atX(0.14); ffx <= atX(0.86); ffx++) {
        if (ffx < 0 || ffx >= M) continue;
        var flow = faceT, fseen = false, fstart = -1;
        for (var ffy = Math.max(0, faceT - Math.round(faceH * 0.55)); ffy < eyeY; ffy++) {
          var fpx = px(ffx, ffy);
          var fhair = !isBg(fpx) && !mask[ffy * M + ffx] && unlikeSkin(fpx);
          if (fhair) { if (!fseen) fstart = ffy; fseen = true; flow = ffy; }
          else if (fseen) break;
        }
        /* THE RUN MUST START ABOVE THE FACE, or it is not hair.
           ON A BALD OR SHAVED HEAD THE SCALP IS IN THE SKIN MASK, so the only
           thing this definition can find above the eyes is the SPECTACLE FRAME
           ITSELF - and it then set its own floor, the frame scan started below the
           frame, and glasses became undetectable on exactly the heads that have no
           hair to hide them. Measured and swept. A fringe begins above faceT (the
           top of the skin); a frame sits inside the face. */
        fcols.push((fstart >= 0 && fstart < faceT) ? flow : faceT);
      }
      var fmed = median(fcols);
      if (fmed !== null) fringeStop = Math.max(faceT, fmed + 2);
    }
    var frameY = -1, frameDark = -1e9;
    for (var gy = Math.max(fringeStop, eyeY - Math.round(faceH * 0.22)); gy <= Math.min(lowerChin, eyeY + Math.round(faceH * 0.06)); gy++) {
      var brg = patchMedian([[cxMid, gy]], 1, false);
      if (!brg) continue;
      var darkness = -lum(brg);
      if (darkness > frameDark) { frameDark = darkness; frameY = gy; }
    }
    var browRow = frameY >= 0 ? patchMedian([[atX(0.26), frameY], [atX(0.74), frameY]], 1, false) : null;
    var foreRow = patchMedian([[cxMid, Math.round((faceT + eyeY) / 2)]], 1, false);
    var bridge = frameY >= 0 ? patchMedian([[cxMid, frameY]], 1, false) : null;
    if (browRow && cheekRow && foreRow && bridge) {
      if (lum(bridge) < lum(cheekRow) - 20 &&
          lum(browRow) < lum(cheekRow) - 26 && lum(browRow) < lum(foreRow) - 20) {
        look.glasses = true; derived.push('glasses'); found.push('glasses');
      }
    }
    /* ---- 9. EYE COLOUR: just inside each eye centre; refuse near-black,
       which is pupil or lash rather than iris. */
    var eye = patchMedian([[atX(0.30), eyeY], [atX(0.70), eyeY]], 1, false);
    if (eye && lum(eye) > 40 && lum(eye) < skinL - 20) { look.eyes = hex(eye); derived.push('eyes'); }

    /* ---- 10. BROWS, in the band between the top of the face and the eyes,
       clear of both. Skipped outright when glasses were detected: a frame lies
       across exactly this band and would read as the thickest brows on every
       bespectacled face. Thickness is scaled against the face's own WIDTH,
       which no fringe can move - the visible height of a face changes with how
       much forehead the hair leaves showing. */
    var dbgBrow = null;
    if (!look.glasses) {
      /* THE BAND OPENS BELOW THE HAIR, AND THE HAIR SAYS WHERE THAT IS.
         A fraction of the forehead is not good enough: a fringe curves down
         into the top of any fixed band, its antialiased edge reads as dark, and
         measured on the fixtures it reached a MAJORITY of the columns - so the
         median column carried one dark row and a face with no eyebrows drawn at
         all came back with thin brows. The lowest hair-like pixel in each
         column is measured instead, and the band starts below it. */
      /* CONTIGUOUS with the hair mass, which is what makes it a fringe. The
         first version took the LOWEST hair-like row above the eyes, and an
         eyebrow is hair-like: measured, the brow bar itself set the bottom of
         the fringe, the band opened below it, and a thick brow read as thin.
         The walk starts at the first hair-like row and stops at the first row
         that is not - so a brow, separated from the hair by forehead, is never
         mistaken for the bottom of the hair. */
      var fringe = [];
      for (var fx = atX(0.14); fx <= atX(0.86); fx++) {
        if (fx < 0 || fx >= M) continue;
        var low = faceT, started = false;
        for (var fyy = Math.max(0, faceT - Math.round(faceH * 0.55)); fyy < eyeY; fyy++) {
          var fp = px(fx, fyy);
          var isHair = !isBg(fp) && !mask[fyy * M + fx] && unlikeSkin(fp);
          if (isHair) { started = true; low = fyy; }
          else if (started) break;
        }
        fringe.push(low);
      }
      var fringeBottom = median(fringe);
      var by0 = Math.max(faceT, (fringeBottom === null ? faceT : fringeBottom) + 2);
      var gap = Math.max(3, eyeY - by0);
      var by1 = Math.max(by0 + 1, Math.round(eyeY - Math.max(1, gap * 0.10)));
      var browCols = [], browPix = [], bridgeCols = [];
      for (var bx2 = atX(0.14); bx2 <= atX(0.86); bx2++) {
        if (bx2 < 0 || bx2 >= M) continue;
        var isBridge = (bx2 > atX(0.44) && bx2 < atX(0.56));   /* the gap between the brows */
        var darkRows = 0;
        for (var byy2 = by0; byy2 < by1; byy2++) {
          var bp2 = px(bx2, byy2);
          /* NOT THE WALL. Every other scan in this function carries !isBg() - the
             crown, the beard and both fringe walks - and this one did not, so on a
             head whose box reaches the edge of the frame the BACKGROUND was counted
             as eyebrow. `mask` is deliberately not consulted: a brow is darker than
             skin and is outside the skin component, exactly like hair. */
          if (isBg(bp2)) continue;
          if (lum(bp2) < skinL - 34) { darkRows++; if (!isBridge) browPix.push(bp2); }
        }
        if (isBridge) bridgeCols.push(darkRows); else browCols.push(darkRows);
      }
      var browMed = median(browCols);
      /* IS IT A BAR ACROSS THE FACE, OR TWO BROWS? A spectacle frame runs straight
         over the nose bridge; eyebrows stop either side of it. The bridge columns
         were being skipped entirely, so when the glasses detector missed, the frame
         was measured as the doctor's eyebrows - 84 of 175 bespectacled framings
         claimed a brow weight the same face without frames does not claim at all.
         Now the bridge is measured too, and a band that continues across it is not
         eyebrows and claims nothing. */
      var bridgeMed = median(bridgeCols);
      var frameLike = (browMed && bridgeMed !== null && bridgeMed >= browMed * 0.6);
      /* the brow read is the measurement this file has got wrong most often, so
         the numbers it came from ride back with the result for inspection */
      dbgBrow = { by0: by0, by1: by1, fringe: fringeBottom, med: browMed, cols: browCols.length };
      if (browMed) {
        /* an eyebrow is roughly 7-10mm tall on a face about 140mm wide, so a
           natural brow is ~5-7% of the face's WIDTH; thin is nearer 3% and
           thick nearer 9%. The three-point test (thin / natural / thick) then
           shows the classifier DISCRIMINATES; it is not what chose the
           numbers. */
        var bRatio = browMed / faceW;
        /* the three drawn brows measure 3, 5 and 9 rows on a 74px face - 0.041,
           0.068 and 0.122 - so the cuts sit between them, and they agree with
           the anatomy: a brow is 7-10mm on a face about 140mm wide, so 5-7% is
           natural, 3% thin and 9%+ thick. The three-point test is what shows
           the classifier DISCRIMINATES; it is not what chose the numbers. */
        var bVal = bRatio < 0.054 ? 'thin' : (bRatio > 0.095 ? 'thick' : 'normal');
        /* CLAIMED ONLY WHEN IT WAS ACTUALLY MEASURABLE (av-5.7.2, review round three).
           Round three found two independent ways this knob was confidently wrong: the
           wall counted as brow (fixed above with !isBg), and a missed spectacle frame
           measured as eyebrows (fixed above with the bridge test). The third is
           resolution: browMed IS the brow's thickness in analysis rows, and below
           three rows the darkest pixel in the band is a blend by construction, so
           neither the weight nor the colour can be recovered - a thin brow is
           sub-pixel at ordinary webcam distance. Blanket-declaiming this was my first
           cure and it was too wide: it broke "dark brows under grey hair get their own
           colour", a case the fixtures prove works. So the gate is the MEASUREMENT,
           not the knob. */
        var browReadable = (browMed >= 3 && !frameLike);
        /* 🕶 AND THE BAR ACROSS THE BRIDGE IS THE GLASSES DETECTOR (av-5.7.6).
           The existing detector at step 9 hunts a DARK BAR and needs a solid one: swept
           against stroked rims it returns false at 0.5, 1.0, 1.5, 2.6 and 4.1 px and
           only refuses (null) at 7.7 - and the framed suite's own fixture draws
           fillRect(N*0.22, N*0.38, N*0.56, N*0.06), a filled bar 7.7px at the analysis
           grid, which is the ONLY thing it can see. That is why it looked like it
           worked while the owner's thin rims were invisible.
           The discriminator was already here, doing the opposite job: eyebrows STOP
           either side of the nose bridge and a spectacle frame CROSSES it, which is
           exactly what `frameLike` measures - and on the owner's own fixture it already
           fires. A frame is thin, so its rows are few; the bridge continuity is what
           identifies it, not its darkness. Claimed only when the existing detector has
           not already spoken, so the two never disagree in `derived`. */
        /* ⛔ AND IT MUST BE THIN, or a brow ridge in hard light IS a frame (av-5.8.1).
           Measured on a REAL photograph (an outdoor selfie in harsh sun, no spectacles
           anywhere): browMed came back 8 rows - the brow plus the shadow under the brow
           ridge - and that band crosses the bridge, so bridge continuity alone CLAIMED
           glasses on a man who wears none. My own b960 change did that, and no synthetic
           fixture could show it: painted brows have no shadow.
           A spectacle rim at this grid is 1-3 rows on any real framing; the owner's own
           thin-rim fixture measures 3. A brow-and-shadow band is 6-10. Thinness is the
           property that separates them, and it is already measured. */
        var rimThin = browMed <= 4;
        if (frameLike && rimThin && look.glasses !== true) {
          look.glasses = true;
          derived.push('glasses');
          found.push('glasses — a thin rim runs across the nose bridge, where an eyebrow would stop');
        } else if (frameLike && !rimThin) {
          found.push('a dark band crosses the nose bridge but it is too thick to be a spectacle rim — ' +
            'usually a brow ridge in hard light, so your glasses setting was left alone');
        }
        look.brows = bVal;
        if (browReadable) derived.push('brows');
        found.push((bVal === 'normal' ? 'natural brows' : bVal + ' brows') +
          (browReadable ? '' : (frameLike
            ? ' — but a bar runs across the nose bridge, so this may be a spectacle frame; your own setting was left alone'
            : ' — too small in this photo to measure reliably, so your own setting was left alone')));
        /* THE INTERIOR OF THE BROW, NOT ITS MEDIAN. Every pixel counted here is
           merely "darker than the skin", so on a thin brow the set is mostly the
           ANTIALIASED EDGE - and its median is a mid-tan that exists nowhere on
           the face. Measured, with brows painted in EXACTLY the hair colour
           #3a2a1c: browPx 3 -> browCol #7f6147, browPx 4 -> #7c634c, browPx 6 ->
           #7f6147, each ~56 from the hair and so clearing the guard below, each
           then painted into the SVG and saved as the doctor's own choice. The
           pattern is not monotonic in thickness (5, 7 and 8 were fine), which is
           why one pinned thickness could never have caught it.
           The darkest quarter is the brow itself; the blend sorts above it. */
        /* > 12, NOT >= 24. The count scales with head AREA, so doubling the floor
           while also changing the estimator (median -> darkest quarter) refused a
           correct brow colour at ordinary webcam distance: measured on one fixture,
           scale 1.0 gave 111 pixels and scale 0.55 gave 41 - both of which return
           the right colour with the new estimator, and both of which the doubled
           floor was fine with, but the margin was gone. The estimator was the fix;
           the floor was never the problem, so it goes back to what it was. */
        /* back to >= 24 (av-5.7.2). Round two lowered this to > 12 on a measurement
           taken from a NORMAL-thickness brow; on a thin brow the 13-23 band is the
           antialiased edge, and a sweep over six fixtures x thirteen framings scored
           the lower floor 9 new wrong colours against 4 new right ones. The whole
           net loss lands at webcam framing, where the brow is sub-pixel. */
        if (browPix.length >= 24) {
          browPix.sort(function (pp, qq) { return lum(pp) - lum(qq); });
          var bc = browPix[Math.floor(browPix.length * 0.25)];
          /* shown, never claimed - see look.brows above. A thin brow is at most 1.5px
             tall on the 128px analysis grid at any webcam framing, so the darkest
             pixel in the band is a BLEND at every distance (measured #53402e against
             a truth of #3a2a1c even at scale 1): the estimator cannot return the
             right colour, so it must not overwrite the doctor's. */
          if (hair && chDist(bc, hair) > 30) {
            look.browCol = hex(bc);
            /* same gate as the weight: three analysis rows of real brow, and not a
               bar across the bridge. Above that the darkest quarter IS the brow and
               the fixtures show it returns the right colour; below it, it is edge
               blend and returned a mid-tan that exists nowhere on the face. */
            if (browReadable) {
              derived.push('browCol');
              found.push('brows a different colour from the hair');
            } else {
              found.push('brows may be a different colour from the hair — not measurable in this photo, so your own setting was left alone');
            }
          }
        }
      }
    }

    /* ---- 11. LIPS: how much of the mouth band is measurably REDDER than this
       face's own cheek. Redness, not darkness - the shadow under a lip is dark
       but not red, and a beard is dark across the whole band. */
    function redness(pp) { return pp[0] - (pp[1] + pp[2]) / 2; }
    var cheekRed = [];
    for (var cx1 = atX(0.12); cx1 < atX(0.30); cx1++) {
      for (var cy1 = belowEye(0.12); cy1 < belowEye(0.40); cy1++) {
        if (cx1 < 0 || cx1 >= M || cy1 < 0 || cy1 >= M) continue;
        cheekRed.push(redness(px(cx1, cy1)));
      }
    }
    var cheekMed = median(cheekRed);
    if (cheekMed !== null) {
      var lipRows = 0, lipTot = 0;
      for (var lyy = belowEye(0.40); lyy < belowEye(1.02); lyy++) {
        var lhit = 0, lwide = 0;
        for (var lxx = atX(0.38); lxx < atX(0.62); lxx++) {
          if (lxx < 0 || lxx >= M || lyy < 0 || lyy >= M) continue;
          lwide++;
          if (redness(px(lxx, lyy)) > cheekMed + 10) lhit++;
        }
        lipTot++;
        if (lwide && lhit / lwide > 0.45) lipRows++;
      }
      if (lipTot > 0 && lipRows > 0) {
        var lRatio = lipRows / lipTot;
        var lVal = lRatio < 0.18 ? 'thin' : (lRatio > 0.38 ? 'full' : 'normal');
        look.lips = lVal; derived.push('lips');
        found.push(lVal === 'normal' ? 'natural lips' : lVal + ' lips');
      }
    }

    /* ---- 12. NOSE WIDTH: the shaded span at the base of the nose, measured
       outward from the centre line and reduced by median across the rows. The
       OUTERMOST shaded offset, not a contiguous run - the middle of a nose is
       the lit ridge, and a contiguity scan starting there measures zero on
       every real face. Scaled against the FACE width. */
    /* the widest offset this scan is ABLE to test. Kept as a number so a span that
       reaches it can be recognised as a floor rather than read as a measurement. */
    var noseMaxOff = Math.floor(faceW * 0.30) - 1;
    /* MEASURED TWICE, AT TWO DARKNESS CUTS. Everything here is relative to skinL, so the
       span depends on how much darker than the skin a pixel has to be before it counts as
       nostril shadow - and that made the verdict move with the SKIN rather than with the
       nose. Measured on one fixture: 'wide' on fair skin, 'button' on the same geometry
       with a warmer tone, a swing across two whole categories. A verdict that changes when
       the subject's complexion changes is not a description of a nose. Two cuts eight
       apart must AGREE before this is applied. */
    function noseScan(cut) {
      var s = [], sat = 0;
      for (var nyy = belowEye(0.22); nyy < belowEye(0.42); nyy++) {
        var half = 0;
        for (var off = 2; off < faceW * 0.30; off++) {
          var lx = cxMid - off, rx3 = cxMid + off;
          if (lx < 0 || rx3 >= M || nyy < 0 || nyy >= M) break;
          if (lum(px(lx, nyy)) < skinL - cut || lum(px(rx3, nyy)) < skinL - cut) half = off;
        }
        if (half) { s.push(half * 2); if (half >= noseMaxOff) sat++; }
      }
      var med = median(s);
      var r = med ? med / faceW : 0;
      return { med: med, spans: s, sat: sat, val: r < 0.24 ? 'button' : (r > 0.36 ? 'wide' : 'straight'), ratio: r };
    }
    var noseA = noseScan(10), noseB = noseScan(18);
    var spans = noseA.spans, noseSat = noseA.sat;
    var noseMed = noseA.med;
    if (noseMed) {
      var nRatio = noseA.ratio;
      var nVal = noseA.val;
      look.nose = nVal;
      /* A SATURATED SCAN IS A FLOOR, NOT A MEASUREMENT (av-5.7.6). The owner's fixture
         claimed "wide nose" and the same face at a slightly different framing claimed
         "button" - a verdict that moves with the crop is not a description of a nose.
         The mechanism: `half` can run all the way to the loop's own bound, so the span
         reported is "at least this wide", and dividing a bound by faceW manufactures a
         ratio of exactly 0.60 which is always past the 0.36 'wide' cut. Shadow at the
         nostril line also reaches the loop bound on any strongly side-lit face.
         So: claim only when the shaded span STOPPED on its own, on most of the rows,
         and there were enough rows to take a median of. Otherwise show the value and
         say why it is not being applied - the doctor's own setting stands. */
      /* AND NOT SITTING ON A BOUNDARY. The owner's fixture measures 0.375 against the
         'wide' cut of 0.36 - a 4% margin on a quantity whose own inputs move by more
         than that between framings, which is the definition of a verdict that flips.
         Within 0.02 of a cut the two neighbouring answers are indistinguishable, so
         neither is claimed. This is deliberately NOT a wider dead band: the fixtures
         hold genuinely wide and genuinely button noses well clear of the cuts, and
         widening it until nothing is claimed would be the blanket refusal that broke
         the eyebrow case. */
      var noseNearCut = Math.abs(nRatio - 0.24) < 0.02 || Math.abs(nRatio - 0.36) < 0.02;
      var noseSolid = spans.length >= 3 && noseSat * 2 <= spans.length &&
        noseB.val === nVal && !noseNearCut;
      if (noseSolid) {
        derived.push('nose');
        found.push(nVal + ' nose');
      } else {
        found.push(spans.length < 3
          ? 'nose width could not be read from this photo, so your own setting was left alone'
          : (noseB.val !== nVal
            ? 'the nose measured ' + nVal + ' or ' + noseB.val + ' depending on how much shadow is counted, so your own nose setting was left alone'
            : (noseNearCut
              ? 'the nose measured right on the line between two shapes, so your own nose setting was left alone'
              : 'the shading at the base of the nose runs past what this photo can measure, so your own nose setting was left alone')));
      }
    }

    /* ---- 13. TOP COLOUR: the strip below the chin, outside the neck column.
       Taken only when it differs from BOTH the skin (or it is the neck) and the
       background (or it is the wall). A head-only crop fails one of those two
       and correctly keeps the colour the doctor already chose. */
    var tops = [];
    for (var sx = atX(-0.15); sx < atX(1.15); sx++) {
      if (sx < 0 || sx >= M) continue;
      if (sx > atX(0.28) && sx < atX(0.72)) continue;          /* the neck sits here */
      for (var sy = lowerChin + Math.round(faceH * 0.08); sy < lowerChin + Math.round(faceH * 0.45); sy++) {
        if (sy < 0 || sy >= M) continue;
        tops.push(px(sx, sy));
      }
    }
    var topCol = medianCol(tops);
    if (topCol && chDist(topCol, skinCut) > 34 && (!bg || chDist(topCol, bg) > 26)) {
      look.shirt = hex(topCol); derived.push('shirt');
      found.push('top colour');
    } else {
      /* SAY THE REFUSAL OUT LOUD (av-5.7.4). This branch had no else, so a refused top
         left the product default - scrub green - sitting in the swatch with nothing to
         explain it, and the owner reasonably read it as the answer. Measured on a
         fixture built to his photo: a light grey tee scores chDist 19 against skin
         (needs >34) and 2-6 against a light wall (needs >26), so it is refused at every
         realistic shoulder height. Both reasons are worth telling apart, because one is
         fixable by standing somewhere else and the other by wearing something else. */
      found.push(topCol && bg && chDist(topCol, bg) <= 26
        ? 'your top and the wall behind you are too close in colour to tell apart, so your own choice was left alone'
        : 'I could not see your top in this photo, so your own choice was left alone');
    }

    /* ---- 14. THE SKULL. Width at the eye line over the LOWER face height -
       eyes to chin - because the upper bound of a face is hair, not bone. The
       three cut points are the ratios of the three heads faceSvg actually draws
       (oval 116/70 = 1.66, round 126/64 = 1.97, long 104/78 = 1.33), so a photo
       is matched to the nearest head that EXISTS rather than to a number
       invented here.
       A BEARD HIDES THE JAW, AND WORSE, IT IMPERSONATES IT: there is no honest
       reading of a jaw that is under hair, so there is no reading. */
    var eyeRun = runAt(eyeY) || faceRun;
    var eyeW = eyeRun.w;
    /* `lopsided` joins offFrame here: when one half of the outline is a third
       wider than the other, the thing being measured is not only a face, and a
       shape verdict from it would overwrite the doctor's own setting with the
       geometry of his hand. */
    var offFrame = (eyeRun.L <= 0 || eyeRun.R >= M - 1 || faceRun.L <= 0 || faceRun.R >= M - 1 || lopsided);
    /* AND THE CHIN HAS TO HAVE BEEN FOUND FOR A GOOD REASON.
       My first attempt at this gate demanded that eye-to-chin be at least 0.48 of
       the face's width, on the reasoning that no adult face is near 0.40 - and it
       broke two cases that had been passing, because a WIDE SHORT face is exactly
       a short lower face over a wide one (the fixture's round head measures 0.37).
       The lesson: a proportion cannot separate "an unusual face" from "a bad
       measurement", because unusual faces are the ones this feature exists for.
       WHY the scan stopped can. A scan that ended on a WIDENING did not find a
       jaw - it found the top edge of something else, and an under-chin shadow
       bridged by the closing is exactly that. When it stopped that way AND there
       is a lot of unexplained mask left below the chin, the chin is not
       trustworthy and neither is anything measured from it. */
    var unexplained = best.maxY - chinY;
    /* MEASURED, not reasoned about: chinStop came back "neck" for BOTH the
       shadowed and the unshadowed face, so a gate on the stop reason could never
       have fired. What actually happens is that the shadow REMOVES the jaw's
       lowest rows from the skin mask, so the narrowing reaches neck-width eleven
       rows early and the plateau is genuinely there. The mask is wrong, not the
       scan.
       So the question to ask is whether the SILHOUETTE continues below the chin
       we found: a band of pixels that are neither background nor skin, inside the
       face's own columns, means the face goes on and this chin is not the chin. A
       real beard is already handled above (it moves lowerChin), and a real neck is
       skin, so neither fires this. */
    /* ⛔ chinPlausible IS GONE, and faceShape is no longer CLAIMED. Read the
       measurements before restoring either.
       This guard was my third attempt to make the face-SHAPE verdict safe against
       an under-chin shadow, and an adversarial sweep measured it doing both wrong
       things at once: it FIRED on an ordinary shaded neck where the chin had been
       measured exactly right (belowR jumped 0 -> 0.53 the moment the shade crossed
       the mask's luminance cut, with chinY byte-identical to the unshadowed twin),
       and it was exactly 0.00 at EVERY framing at or below 0.65 - the entire band
       this file exists for - so where it was aimed it could not fire at all.
       Three calibrations, three failures, on a signal that is not there at the
       distances that matter. So the honest answer is not a fourth threshold: the
       photo does not reliably support a shape verdict, so it stops making one.
       look.faceShape is still computed and still reported in `found` (it is useful
       information), but it NEVER enters `derived` - which means Match never
       overwrites the Face-shape control the doctor set by hand. A cosmetic knob is
       not worth a wrong answer, and the four knobs the owner actually asked about
       (skin, hair, beard, glasses) do not depend on the chin. */
    if (!offFrame && eyeW > M * 0.10 && lowerH > faceH * 0.20 && look.beard === 'none') {
      var shapeR = eyeW / lowerH;
      var sVal = shapeR < 1.48 ? 'long' : (shapeR > 1.80 ? 'round' : 'oval');
      /* A SQUARE JAW OUTRANKS ALL THREE: it is not a proportion, it is the face
         still being wide 62% of the way down to the chin. The drawn oval has
         narrowed to about 0.79 of its widest by there; a drawn jaw is at 0.97.
         MEASURED FROM THE CHEEKBONE ROW, the widest row, because that landmark
         does not move - hung off the eye line instead, the same ellipse scored
         0.875 or 0.914 depending only on whether the portrait happened to show
         an iris, and 0.88 sat between them. */
      var jawRun = runAt(Math.round(maxWY + (lowerChin - maxWY) * 0.62));
      if (jawRun && jawRun.w / maxW > 0.88) sVal = 'square';
      /* COMPUTED AND REPORTED, NEVER CLAIMED — see the note above. It goes into
         `found` so the doctor can see what the photo looked like, and stays out of
         `derived` so Match cannot overwrite his own choice with it. */
      look.faceShape = sVal;
      found.push(sVal === 'square' ? 'a square jaw' : sVal + ' face');
    }
    /* EYE SPACING, from the two dark masses measured in step 5. THE DARK MASS,
       NOT THE DARKEST PIXEL: a solid iris has no unique darkest pixel, so "the
       darkest pixel" is noise wearing a measurement's clothes. AN IRIS IS
       COMPACT AND A SPECTACLE FRAME IS NOT - the spread test holds even on a
       frame the glasses detector missed. */
    if (!offFrame && !look.glasses && compact && eR.cx > eL.cx && eL.n >= 6 && eR.n >= 6) {
      var setR = (eR.cx - eL.cx) / eyeW;
      var eVal = setR < 0.44 ? 'close' : (setR > 0.56 ? 'wide' : 'normal');
      look.eyeSet = eVal; derived.push('eyeSet');
      if (eVal !== 'normal') found.push(eVal + '-set eyes');
    }
    /* A RECEDING HAIRLINE is bare TEMPLES with hair still on the crown - so it
       is read as exactly that contrast, and never on a head with no hair to
       recede from. Reading only the temples would call every bald head
       receding; reading only the crown could never see it at all. */
    if (look.hairStyle !== 'bald' && hair) {
      /* WHERE THE SKIN STARTS, COLUMN BY COLUMN. A receding head is not "bare
         temples" - every head with an ordinary fringe has bare temples, because
         a fringe is narrower than the skull. It is bare temples that reach
         MEASURABLY HIGHER than the middle of the forehead does, and that
         difference is scale-free.
         Measured on the fixtures: the ordinary head's temples start 5px above
         its centre parting and the receding one's start 24px above, on faces
         81px long - so the honest cut is a fraction of the face, and a
         coverage-ratio test inside one fixed band called both of them the
         same. */
      function skinTopIn(f0, f1) {
        var tops = [];
        for (var tx = atX(f0); tx < atX(f1); tx++) {
          if (tx < 0 || tx >= M) continue;
          for (var ty = Math.max(0, faceT - Math.round(faceH * 0.10)); ty <= lowerChin; ty++) {
            if (mask[ty * M + tx]) { tops.push(ty); break; }
          }
        }
        return median(tops);
      }
      var tL = skinTopIn(0.05, 0.25), tR = skinTopIn(0.75, 0.95), midTop = skinTopIn(0.40, 0.60);
      if (tL !== null && tR !== null && midTop !== null) {
        var lift = midTop - Math.max(tL, tR);
        if (lift > faceH * 0.12 && crownR > 0.20) {
          look.hairline = 'receding'; derived.push('hairline');
          found.push('a receding hairline');
        }
      }
    }
    /* `age` is NOT derived. Nasolabial folds and crow's feet are a few pixels of
       low-contrast texture at this resolution and are wiped out by ordinary
       lighting, so any verdict here would be a guess wearing a measurement's
       clothes - and guessing that a doctor looks old is the one wrong answer
       this feature must never volunteer. It stays a choice in Setup. */
    /* NO COLOUR SURVIVES THE ILLUSTRATION. Shape can still be read from a posterized
       copy - an outline is an outline - but every hue in it has been snapped to one of
       six steps per channel, so hair, eyes, lips and the top are as unrecoverable as the
       skin was. Stripped here, at the single exit, rather than at each of the four
       pushes: a fifth colour knob added later would otherwise quietly escape. */
    if (fromIllustration) {
      derived = derived.filter(function (k) {
        return k !== 'skin' && k !== 'hair' && k !== 'eyes' && k !== 'lip' &&
               k !== 'shirt' && k !== 'browCol';
      });
    }
    return { look: look, found: found, derived: derived,
             box: { L: faceRun.L, R: faceRun.R, T: faceT, B: lowerChin, eyeY: eyeY,
                    w: faceW, h: faceH, crownR: Math.round(crownR * 100) / 100,
                    sideR: Math.round(sideR * 100) / 100, beardDepth: Math.round(beardDepth * 100) / 100,
                    skinL: Math.round(skinL), bgL: Math.round(bgL),
                    maxWY: maxWY, maxW: maxW, brow: dbgBrow,
                    chinStop: chinStop, unexplained: unexplained, asym: Math.round(asym * 100) / 100,
                    lopsided: lopsided, hairUnreadable: hairUnreadable, flatTop: flatTop,
                    eL: eL && { y: eL.medY, cx: Math.round(eL.cx), sp: eL.spread, n: eL.n },
                    eR: eR && { y: eR.medY, cx: Math.round(eR.cx), sp: eR.spread, n: eR.n } } };
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
  /* THE HEAD IS AN ACKNOWLEDGEMENT OR THERE IS NO SPLIT — av-5.8.1.
     Owner, 2026-08-08: "the voices they need to sound much more natural".
     A split is not free the way the comment below assumed. The two pieces are
     two SEPARATE TTS generations, sampled independently, played back to back
     from two <audio> elements: the first lands on its own falling full stop with
     the encoder's trailing silence, and the second opens at fresh-utterance
     pitch and energy. That discontinuity is a machine seam, and it is the single
     most-heard artifact in the product because almost every reply has an early
     sentence boundary and therefore split.
     The comment right below states exactly what the split is FOR — a tiny
     acknowledgement in front of the real question — but the code never enforced
     it: the head was allowed up to 150 characters. So a full content sentence
     ("Hi there, I'm Ava, the practice's AI assistant.") was severed from what
     followed, which is the case where the seam is most audible AND where the
     latency gain is smallest, because a 150-character head takes nearly as long
     to generate as the whole line does.
     Capped at PV_ACK_MAX. Under the cap, a distinct beat after "Got it." is how
     a person talks anyway, so the seam reads as a breath; over it, the line is
     spoken as one generation with one continuous contour. This also makes FEWER
     requests than before, so it costs nothing and saves a little. */
  function ttsSplitForSpeech(text) {
    /* ⛔ DECLARED INSIDE, ON PURPOSE. avatar-visit-copilot.test.js lifts this function by
       string slice and runs it through `new Function`, so it executes with NO module scope:
       a `var PV_ACK_MAX` one line above the function is invisible there and the suite dies
       with "PV_ACK_MAX is not defined" — which `node --check` cannot see, because the file
       itself is perfectly valid. Any constant a liftable function reads has to live in it. */
    var PV_ACK_MAX = 34;
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
    /* see PV_ACK_MAX — a real sentence is not an acknowledgement, and severing
       one costs more in naturalness than the split saves in latency */
    if (head.length > PV_ACK_MAX) return [t];
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
  /* THE DELIVERY SHAPE. The backend used to build one identical delivery
     instruction for every line it was ever asked to speak - the greeting, a
     routine question, the 911 warning and the two HALVES of one sentence all
     got "warm, gentle, unhurried, in person". Half of what makes a line sound
     human is which KIND of line it is, and only this side knows: the backend
     receives a bare string with no idea whether it is a whole sentence, an
     opening clause that must not fall to a full stop, or a continuation that
     must come in mid-flow. It is a short whitelisted token, never instruction
     text — the server maps it (see SPEECH_SHAPE in routes/patientAvatar.js) and
     ignores anything it does not recognise.
       'open'  head of a split line — do not land it, no trailing pause
       'cont'  tail of a split line — come in mid-flow, no fresh start
       'calm'  the silence nudge — softer, slower, no impatience
       'greet' the first thing this patient hears
       'alert' an emergency warning (the server also detects this from the text
               itself, so a missing or forged shape cannot soften it) */
  function ttsFetchUrl(text, voice, shape) {
    /* THE SHAPE IS PART OF THE CACHE KEY. Without it the first rendering of a
       string wins forever: NUDGE_LINE is pre-fetched at consent time (see
       kioskConsentYes) and spoken later, and the same text asked for with a
       different shape is a DIFFERENT recording. Keyed on text alone, the
       pre-fetch would either serve the wrong delivery or - if the shapes
       disagreed - miss the cache entirely and pay a round trip at the one
       moment the pre-fetch exists to avoid paying one. */
    var key = (voice || '') + '|' + (shape || '') + '|' + text;
    if (ttsCache[key]) return Promise.resolve(ttsCache[key]);
    if (Date.now() < ttsDownUntil) return Promise.resolve(null);
    var ctrl = safe(function () { return new AbortController(); }, null);
    var timer = ctrl ? setTimeout(function () { safe(function () { ctrl.abort(); }); }, 6500) : null;
    var headers = { 'Content-Type': 'application/json' };
    var auth = token(); if (auth) headers.Authorization = 'Bearer ' + auth;
    var payload = { text: text };
    if (voice) payload.voice = voice;
    if (shape) payload.shape = shape;
    return fetch(apiBase() + '/api/avatar/office/tts', {
      method: 'POST', headers: headers,
      body: JSON.stringify(payload),
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
  /* ---- THE PHOTO THE MATCHER MEASURES IS NOT THE PHOTO PATIENTS SEE ------------
     Owner, 2026-08-08: "it has to find my skin color my eyes and hair and more and
     matches it and also make sure it takes a good picture and uses the high res
     picture not the low res one."
     He was describing a real defect, and it was worse than resolution alone. Three
     things stood between his face and the measurement:
       1. the camera was opened with facingMode ONLY, so the browser handed back its
          default - typically 640x480;
       2. stylizePortrait POSTERIZED every channel to SIX levels (steps of 51) and
          re-compressed at JPEG 0.82 - and that posterized copy was the only image
          stored, so "find my skin colour" was being asked of a 6-level image whose
          every tone had been snapped up to 51 units away from the truth;
       3. it was then downsampled again to the 128-px analysis grid.
     Now there are TWO images from one chosen frame: a measurement-grade square crop
     at capture resolution with no posterizing, which is what Match reads, and the
     stylized portrait, which is only ever what patients see. The illustrated look was
     deliberate and it stays - it just no longer defines what the doctor's skin, hair
     and eyes are measured from.
     MEASURE_MAX stays 512: the analysis grid is 128, so 512 gives a clean 4:1 box
     average per analysis pixel (real averaging of real tones, which is what fixes the
     colour) without carrying a megapixel data URL around. Raising the grid itself
     needs every absolute pixel floor in faceReadPortrait re-derived first - they were
     calibrated in 128-space - so that is a separate change, deliberately not smuggled
     in here. */
  /* av-6.0.2 — 1024, because THE MODEL READS THIS IMAGE TOO. Owner: "take a higher rtes
     photo". The paragraph above is still right about the PIXEL grid: it stays 128 and every
     absolute floor in faceReadPortrait is calibrated in 128-space, so raising the grid remains
     a separate change and is deliberately still not smuggled in here (task #23).
     But since av-5.8.0 this same frame is what /api/avatar/office/facelook sends to the vision
     model, and that path does NOT downsample to 128 — it reads the photograph. At 512 the model
     was being handed a quarter of the detail the camera gave us, on the one question the pixel
     matcher keeps getting wrong (is that a moustache, are those spectacles, which of these tones
     is skin). 1024 quadruples what the model sees and changes NOTHING about the pixel analysis,
     which still box-averages down to 128. It stays inside the route's 900 000-character cap: a
     1024 square at JPEG 0.95 is roughly 250-400KB, i.e. 340-540KB of base64. */
  var MEASURE_MAX = 1024;
  function captureSquare(video, out) {
    var vw = video.videoWidth || 0, vh = video.videoHeight || 0;
    if (!vw || !vh) return null;
    var side = Math.min(vw, vh);
    /* NEVER UPSCALE. Inventing pixels would make a low-res camera look like a
       high-res one to every check below, which is the opposite of the point. */
    var px2 = Math.max(64, Math.min(out, side));
    var canvas = document.createElement('canvas');
    canvas.width = px2; canvas.height = px2;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, px2, px2);
    return canvas;
  }
  /* "MAKE SURE IT TAKES A GOOD PICTURE" - measured, not hoped for. Sharpness is mean
     absolute gradient energy on a small grey copy (a blurred or motion-smeared frame
     has little); exposure is the mean luminance, which catches both a dark room and a
     blown-out window behind the doctor. Both are computed on the SAME downscale so
     the numbers are comparable between frames. */
  function frameQuality(canvas) {
    return safe(function () {
      var G = 96;
      var g = document.createElement('canvas'); g.width = G; g.height = G;
      var gx = g.getContext('2d');
      gx.drawImage(canvas, 0, 0, G, G);
      var d = gx.getImageData(0, 0, G, G).data;
      var grey = new Float64Array(G * G), sum = 0;
      for (var i = 0, j = 0; i < d.length; i += 4, j++) {
        grey[j] = (d[i] * 3 + d[i + 1] * 4 + d[i + 2]) / 8;
        sum += grey[j];
      }
      var mean = sum / (G * G), edge = 0, n = 0;
      for (var y = 1; y < G - 1; y++) {
        for (var x = 1; x < G - 1; x++) {
          var c = grey[y * G + x];
          edge += Math.abs(grey[y * G + x + 1] - c) + Math.abs(grey[(y + 1) * G + x] - c);
          n += 2;
        }
      }
      return { sharp: n ? edge / n : 0, exposure: mean };
    }, { sharp: 0, exposure: 0 });
  }
  /* BEST OF SEVERAL FRAMES, not whichever frame the tap landed on. A single grab
     catches a blink, a turn, or the frame the autofocus was still working on. */
  function grabBestFrame(video, tries, then) {
    var best = null, bestQ = null, left = Math.max(1, tries);
    function step() {
      var canvas = captureSquare(video, MEASURE_MAX);
      if (canvas) {
        var q = frameQuality(canvas);
        if (!bestQ || q.sharp > bestQ.sharp) { best = canvas; bestQ = q; }
      }
      if (--left <= 0) { then(best, bestQ); return; }
      safe(function () { setTimeout(step, 120); }, null);
    }
    step();
  }
  function stylizeCanvas(src) {
    /* 512, NOT 256 (av-6.0.7). Owner: "the photo needs to be higher res like not try to image
       to avatar off a small low quaility image it saves."
       This is the copy that is SAVED and shown to patients, and it was rendered at 256 and then
       displayed at 302px in the kiosk — upscaled, so visibly soft on every screen, and softer
       again on a retina panel where 302 CSS px is 604 device px. 512 covers the kiosk at 1x and
       is close at 2x, and it costs one JPEG: measured below against the capture guard.
       The MEASUREMENT copy is separate and already 1024 (MEASURE_MAX) — nothing here is what the
       matcher or the vision model reads, so raising this cannot move a single verdict. It is
       purely what he and his patients look at. */
    var size = 512;
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(src, 0, 0, size, size);
    /* gentle stylization: posterized tones + a touch of warmth — a friendly
       illustrated rendition of the doctor's face, not a raw photo. DISPLAY ONLY:
       nothing measures this copy any more. */
    var img = ctx.getImageData(0, 0, size, size), d = img.data;
    var levels = 6, step2 = 255 / (levels - 1);
    for (var i = 0; i < d.length; i += 4) {
      d[i] = Math.round(Math.min(255, d[i] * 1.06) / step2) * step2;
      d[i + 1] = Math.round(d[i + 1] / step2) * step2;
      d[i + 2] = Math.round((d[i + 2] * 0.97) / step2) * step2;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.82);
  }
  function stylizePortrait(video) {
    var raw = captureSquare(video, MEASURE_MAX);
    return raw ? stylizeCanvas(raw) : null;
  }
  /* the measurement copy lives on THIS DEVICE only. It is a real photograph of the
     doctor's face at capture resolution, so it is not shipped to the server with the
     stylized portrait patients see - and it is namespaced per account like every
     other local key here. */
  var FACE_HI_KEY = 'mlsAvFaceMeasureV1';
  function faceHiKey() {
    return safe(function () {
      return isFn(window.uns) ? (window.uns(FACE_HI_KEY) || FACE_HI_KEY) : FACE_HI_KEY;
    }, FACE_HI_KEY);
  }
  function faceHiSave(dataUrl) {
    return safe(function () { localStorage.setItem(faceHiKey(), String(dataUrl)); return true; }, false);
  }
  function faceHiRead() {
    return safe(function () {
      var v = localStorage.getItem(faceHiKey());
      return (v && String(v).indexOf('data:image/') === 0) ? v : '';
    }, '');
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
      /* THE FULL-QUALITY FRAME, HELD IN MEMORY FOR THIS SESSION (av-6.0.2).
         Owner: "take a higher rtes photo acatlly save the photo." faceHiSave writes the
         ~0.95-quality JPEG into localStorage, which is 5-10MB SHARED with the whole app —
         and when it refuses, Match fell back to measuring the STYLIZED portrait, which is
         posterized to six levels per channel. So the best copy of his face could be thrown
         away between taking it and measuring it, and the only symptom was one clause in a
         status line. Storage is now a CACHE for later sessions, not the only path: the frame
         we just captured stays right here, and Match prefers it. */
      var pendingHiUrl = '';
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
        /* ASK FOR THE HIGH-RESOLUTION STREAM. With facingMode alone the browser hands
           back its default - typically 640x480 - and every colour the matcher reports
           was measured from that. `ideal` degrades gracefully: a camera that cannot do
           1920x1080 still opens, at the best it has, and captureSquare never upscales
           so a modest camera is never dressed up as a good one. */
        var media = safe(function () {
          return navigator.mediaDevices && navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 1920 }, height: { ideal: 1080 }
            }
          });
        }, null);
        /* a browser that refuses the sized request must still get a camera, or asking
           for quality would have COST him the feature */
        if (!media) {
          media = safe(function () {
            return navigator.mediaDevices && navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
          }, null);
        }
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
            snapBtn.disabled = true; snapBtn.textContent = 'Taking the best of a few…';
            grabBestFrame(video, 6, function (bestCanvas, q) {
              var vw = video.videoWidth || 0, vh = video.videoHeight || 0;
              stopCamera(); camHost.innerHTML = '';
              if (!bestCanvas) {
                camHost.appendChild(make('div', 'mlsAvNotice', 'The camera did not deliver a frame — try again.'));
                return;
              }
              /* SAY WHAT IS WRONG WITH THE PICTURE, rather than storing a bad one and
                 reporting invented colours from it. Both numbers are measured on the
                 chosen frame (see frameQuality). */
              var why = '';
              if (q && q.exposure < 45) why = 'the picture is too dark — turn a light on, or face a window';
              else if (q && q.exposure > 225) why = 'the picture is washed out — move the bright light behind you out of shot';
              else if (q && q.sharp < 2.2) why = 'the picture is blurred — hold still, and give the camera a moment to focus';
              if (why) {
                camHost.appendChild(make('div', 'mlsAvNotice',
                  'Not captured: ' + why + '. Nothing was saved, so your current photo is untouched.'));
                return;
              }
              var dataUrl = safe(function () { return stylizeCanvas(bestCanvas); }, null);
              var hiUrl = safe(function () { return bestCanvas.toDataURL('image/jpeg', 0.95); }, '');
              /* the guard rises WITH the portrait (av-6.0.7), as HEADROOM — not because 150000
                 was observed to fail. MEASURED in Chrome through this exact pipeline over the
                 real photographs in scratchpad/realfaces (probe: measure-portrait-size.js):
                     440x586  -> 256: 35,471   512: 105,715
                     960x1444 -> 256: 22,195   512:  73,191
                 So a 512 stylized JPEG is far SMALLER than I first assumed — the 6-level
                 posterize flattens the image and JPEG pays almost nothing for the extra pixels,
                 and 0 of 2 would have tripped the old cap. What the old number left was thin
                 margin: 105,715 is 70% of 150000, i.e. 1.4x, and a live webcam frame carries
                 more sensor noise than a downloaded photograph. 600000 keeps the guard's real
                 job — stopping a pathological encode — with 5.7x margin on the largest measured. */
              if (!dataUrl || dataUrl.length > 600000) {
                camHost.appendChild(make('div', 'mlsAvNotice', 'That capture did not work — try again with more light.'));
                return;
              }
              pendingFace = dataUrl;
              /* the measurement copy, kept on this device for Match. If storage refuses
                 it (quota), Match falls back to the stylized portrait AND says so - it
                 must never silently go back to measuring the posterized copy. */
              var hiOk = hiUrl ? faceHiSave(hiUrl) : false;
              pendingHiUrl = hiUrl || '';   /* survives a quota refusal — see pendingHiUrl */
              var fresh = facePreviewNode(dataUrl);
              faceRow.replaceChild(fresh, facePreview); facePreview = fresh;
              status.textContent = 'Portrait captured from a ' + (bestCanvas.width) + '×' + (bestCanvas.height) +
                ' crop of your ' + (vw && vh ? (vw + '×' + vh + ' ') : '') + 'camera' +
                ' — best of 6 frames, processed on this device' +
                (hiOk ? '. Match my photo will measure the full-quality copy, not the stylized one.'
                      : '. This device would not store the full-quality copy, so Match will measure the stylized one and say so.') +
                ' Save to publish the portrait to your patients.';
              /* AND MATCH IT, WITHOUT BEING ASKED (av-6.0.2). Owner: "I shopuld not have to
                 click match my photo when I take the picutre it sohuld auto match my photo."
                 Right: taking a photo of your face IS the request to be drawn from it. The
                 button stays, because a doctor who has hand-tuned a knob and then retakes the
                 photo needs a way to ask again — but nobody should have to find it.
                 Deferred one tick so the preview and the status line paint first, and routed
                 through the button's own handler rather than a copy of it: a second
                 implementation of the match would be a second thing to keep in step, and the
                 whole reason the AI read was ever missing from a surface is that it had two.
                 matchBtn is declared further down this same function scope, so it is assigned by
                 the time this runs; guarded anyway, because a build that removes the button
                 must degrade to 'no auto-match', never to a thrown error inside a capture.
                 ⛔ AND IT DID THROW, from b982 until now: this line called `later(fn, ms)`, a
                 helper that exists ONLY inside makeFace's scope — setupForm has no such
                 binding, so every capture raised "later is not defined" and the auto-match
                 never ran once. `node --check` cannot see an undefined identifier, and the
                 safe() was one level too deep: it wrapped the callback, not the call that
                 threw, so the guard this comment promises was never in the throwing position.
                 Found by driving the real capture with a real photograph through a fake camera
                 (scratchpad/facelook/autocapture.js) and reading pageerror — the owner's
                 symptom, "once the image is taken it sohuld auto change avatar", exactly. */
              safe(function () {
                setTimeout(function () {
                  safe(function () { if (matchBtn && !matchBtn.disabled) matchBtn.click(); });
                }, 60);
              });
            });
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
      var lookBadges = {};
      function lookRow(labelText, node, key) {
        var row = make('div', '');
        row.style.cssText = 'display:flex;flex-direction:column;gap:3px';
        var l = make('span', '', labelText);
        l.style.cssText = 'font:600 11.5px system-ui;color:#69736d';
        /* WHICH OF THESE CAME FROM THE PHOTO (av-5.7.4). The owner pressed Match, saw a
           green top and salmon lips, and reported that it "did an aweful job
           completely" - counting eight wrong answers. He was right about what he saw
           and it was worse than a wrong measurement: THREE of those knobs had never
           been measured at all. The top was refused (a grey tee against a light wall
           cannot clear the guard) and left showing the product's scrub green, and lip
           COLOUR has no measurement path in this file at all - only lip shape. A
           correct refusal and a wrong answer were pixel-identical in this grid, so
           every future improvement would still read as "awful". Each control now says
           where its value came from, driven directly off `derived` rather than prose. */
        var badge = make('span', '', '');
        badge.style.cssText = 'font:700 9.5px system-ui;letter-spacing:.2px;padding:1px 5px;border-radius:5px;margin-left:6px';
        l.appendChild(badge);
        if (key) lookBadges[key] = badge;
        row.appendChild(l); row.appendChild(node);
        lookGrid.appendChild(row);
        return row;
      }
      /* filled only AFTER a Match: before one, every value is trivially the doctor's
         own and labelling it would be noise. */
      function setLookBadges(measured, aiRead) {
        var got = measured || [], ai = aiRead || [];
        Object.keys(lookBadges).forEach(function (k) {
          var b = lookBadges[k]; if (!b) return;
          /* THREE STATES, NOT TWO (av-5.8.0). "read by AI" is a different fact from
             "measured on this device": one is a model's confident answer, the other is
             arithmetic over pixels. The doctor is entitled to know which one moved his
             setting, because the two fail in different ways and he will trust them
             differently once he has seen each be wrong. */
          var byAi = ai.indexOf(k) >= 0;
          var on = byAi || got.indexOf(k) >= 0;
          b.textContent = byAi ? 'read by AI' : (on ? 'from your photo' : 'your setting');
          b.style.color = byAi ? '#4a2d7a' : (on ? '#1f5c41' : '#8a938d');
          b.style.background = byAi ? '#efe8fb' : (on ? '#e6f7ef' : '#f2f1ec');
        });
      }
      function colourControl(key, labelText) {
        var input = document.createElement('input');
        input.type = 'color'; input.value = lookNow[key];
        input.id = 'mlsAvLook_' + key;
        input.style.cssText = 'width:100%;height:32px;border:1px solid #d7ded9;border-radius:8px;background:#fff;padding:2px;cursor:pointer';
        input.addEventListener('input', function () { lookNow[key] = input.value; lookApply(); });
        lookRow(labelText, input, key);
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
        lookRow(labelText, sel, key);
        return sel;
      }
      var skinPick = colourControl('skin', 'Skin');
      var hairPick = colourControl('hair', 'Hair');
      var eyesPick = colourControl('eyes', 'Eyes');
      var lipPick = colourControl('lip', 'Lip colour');
      /* THE HANDLE WAS THROWN AWAY. `colourControl('shirt', ...)` discarded its return
         and nothing ever assigned to it, so this swatch was frozen at whatever
         lookNow.shirt held when the row was built - it read green even on a photo
         where the top WAS measured and pushed into `derived`, while the drawn avatar
         beside it got the measured colour. The swatch and the face could disagree,
         which is worse than either being wrong on its own. */
      var shirtPick = colourControl('shirt', 'Scrubs / top');
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
        var shown = pendingFace === undefined ? (cfg.faceImage || '') : pendingFace;
        /* MEASURE THE PHOTOGRAPH, NOT THE ILLUSTRATION. The stylized portrait is
           posterized to six levels per channel - snapping every tone up to 51 units
           from the truth - so measuring it could not answer "what colour is my skin"
           however good the camera was. The full-quality copy of the same frame is kept
           on this device by the capture above; when it is missing (an older portrait
           captured before av-5.7.2, or a device that refused to store it) the stylized
           copy is still measured, because a refusal would be worse - but the note says
           which one was read, so a wrong swatch can be explained rather than puzzled over. */
        var hi = pendingHiUrl || faceHiRead();   /* this session's frame first — see pendingHiUrl */
        var src = hi || shown;
        var usedHi = !!hi;
        if (!src) { lookNote.textContent = 'Capture your photo above first, then Match my photo.'; return; }
        lookNote.textContent = usedHi
          ? 'Reading the full-quality copy of your photo…'
          : 'Reading your photo… (only the stylized copy is on this device — retake it for a full-quality reading)';
        /* ---- THE MODEL READS IT TOO (av-5.8.0) ------------------------------------
           Owner, 2026-08-08: "do the api way and make it good."
           The pixel matcher stays and runs first - it is offline, instant, and it is what
           produces the shape verdicts. The model answers the questions pixels kept
           getting wrong: which of these tones is his SKIN rather than his wall, is that a
           moustache, are those spectacles.
           WHERE THEY DISAGREE, THE MODEL WINS ONLY IF IT SAID 'high'. The route already
           refuses to return anything less as a claim, so this cannot apply a guess over a
           setting the doctor made by hand - the rule that governs `derived` is unchanged,
           the model is simply another source that must earn its place in it.
           AND IT NEVER BLOCKS: no backend, no key, a 502, a timeout - the pixel answer is
           already applied by the time this resolves, so a failure costs the doctor
           nothing except the extra precision. */
        var visionSrc = src;
        function applyVision(base, note) {
          safe(function () {
            /* api(path, options) takes FETCH options, not a body object - passing
               { image: ... } here would have issued a GET with no payload and the route
               would have answered 404 for the rest of time */
            api('/api/avatar/office/facelook', {
              method: 'POST',
              body: JSON.stringify({ image: visionSrc })
            }).then(function (vr) {
              if (!vr || !vr.ok || !vr.json || vr.json.ok !== true) {
                lookNote.textContent = note + ' (the AI reading was unavailable, so this is the on-device measurement only)';
                return;
              }
              var vl = vr.json.look || {}, vClaimed = vr.json.claimed || [], vUnsure = vr.json.unsure || [];
              if (!vClaimed.length) {
                lookNote.textContent = note + ' The AI looked too and was not confident about anything, so nothing of its was applied.';
                return;
              }
              vClaimed.forEach(function (k) {
                if (vl[k] === undefined) return;
                lookNow[k] = vl[k];
                if (aiKnobs.indexOf(k) < 0) aiKnobs.push(k);
              });
              lookNow = faceLookSafe(lookNow);
              skinPick.value = lookNow.skin; hairPick.value = lookNow.hair; eyesPick.value = lookNow.eyes;
              shirtPick.value = lookNow.shirt; lipPick.value = lookNow.lip;
              stylePick.value = lookNow.hairStyle; beardPick.value = lookNow.beard;
              glassesBox.checked = lookNow.glasses === true;
              /* ⛔ EVERY CONTROL, OR THE SCREEN CONTRADICTS ITSELF (av-6.0.4). This path synced
                 EIGHT pickers while the pixel path below syncs all fifteen — which was harmless
                 only because the route was never asked about the other seven. Now that the model
                 answers faceShape / eyeSet / brows / browCol / nose / lips / hairline / age, a
                 missing sync would leave the drawing showing the model's read while the SELECT
                 next to it still showed the old value — and the next Save writes back whatever
                 the control says, so the model's answer would be silently undone by the doctor
                 doing nothing. Same list, same order as the pixel path, deliberately. */
              browsPick.value = lookNow.brows; nosePick.value = lookNow.nose; lipsPick.value = lookNow.lips;
              shapePick.value = lookNow.faceShape; eyeSetPick.value = lookNow.eyeSet;
              hairlinePick.value = lookNow.hairline; agePick.value = lookNow.age;
              if (lookNow.browCol) {
                if (browColPick.options.length < 2) {
                  var vbo = document.createElement('option'); vbo.value = 'set'; vbo.textContent = 'Its own colour';
                  browColPick.appendChild(vbo);
                }
                browColPick.value = 'set';
                if (browColWell) browColWell.value = lookNow.browCol;
              } else { browColPick.value = ''; }
              setLookBadges(base, aiKnobs);
              lookApply();
              lookNote.textContent = note + ' The AI also read it and was confident about ' +
                vClaimed.join(', ') + (vUnsure.length ? ('; unsure about ' + vUnsure.join(', ') + ', so those were left as they were.') : '.');
            }, function () {
              lookNote.textContent = note + ' (the AI reading could not be reached, so this is the on-device measurement only)';
            });
          });
        }
        var aiKnobs = [];
        faceTintFromPortrait(src, function (res) {
          var look = res && res.look;
          /* av-5.7.0: the honest failure is "I could not FIND a face", and it
             names the two things that actually cause it - because the previous
             message ("too dark or too flat") sent the doctor to the colour
             pickers when the real problem was that the head filled a third of
             the frame and the matcher had measured the wall. */
          if (!look) {
            /* SAY WHICH FAILURE IT WAS (av-6.0.5). The reader now names the cause and the number
               behind it — see the !head branch in faceReadPortrait — and those three causes want
               opposite actions from the doctor: move closer, or change the LIGHT, or change the
               BACKGROUND. The generic sentence below advised all three at once, which is the same
               as advising none, and it was printed even when the reader knew exactly which one it
               was. The specific reason wins when there is one; the general advice stays as the
               fallback for a reader that returned nothing at all. */
            var whyNoFace = (res && Array.isArray(res.found) && res.found.length)
              ? res.found.join(' ')
              : ('I could not find a face in that photo. Retake it with your face filling more of the frame, ' +
                 'looking straight at the camera, and with a background that is not the same colour as your skin - or set the colours by hand.');
            lookNote.textContent = whyNoFace;
            return;
          }


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
          lipPick.value = lookNow.lip; shirtPick.value = lookNow.shirt;
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
          /* every control now states its provenance from the SAME list that decided
             what to overwrite, so "your setting" and "not measured" cannot drift apart */
          setLookBadges(got);
          lookApply();
          /* say what it actually saw - a silent generic face is exactly what
             "it straight up does not work" looks like from the doctor's side */
          var found = (res && res.found && res.found.length) ? res.found.join(', ') : '';
          var pixNote = found
            ? ('Matched from your photo - detected ' + found + '. Adjust anything above to fine-tune.')
            : 'Matched from your photo - adjust anything above to fine-tune.';
          lookNote.textContent = pixNote;
          /* the model reads the same photo and refines what pixels get wrong. Started
             AFTER the on-device answer is already applied, so a slow or missing backend
             costs precision and never the feature. */
          applyVision(got, pixNote);
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
        /* THE PREVIEW HAS TO BE THE REAL THING. The doctor chooses the voice his
           patients will hear from this one button, and the sample was neither
           what they hear nor how they hear it: no AI disclosure (so it was
           shorter and simpler than every real greeting), and no delivery shape,
           so it was generated with the generic instruction while the actual
           greeting is generated with 'greet'. He was auditioning a voice on
           material it never speaks. This mirrors INTERVIEW_SYSTEM rule 9's
           example, spoken exactly as the kiosk speaks the opening line. */
        pvSpeakVoiced('Hi there, I\'m ' + (nameInput.value.trim() || 'Ava') + ' — I\'m the practice\'s AI assistant, and I help get everyone settled before the doctor comes in. It\'s good to meet you. This only takes a few minutes, and you can just answer in your own words.', null, voiceSelect.value, 'greet');
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
              /* av-6.0.7 — DID THE PHOTO SURVIVE THE ROUND TRIP? The server drops a portrait
                 that fails its shape test or its size cap, and until now that drop was silent:
                 you pressed Save, saw "Saved", and your face was simply not there. Judge it by
                 the ECHO, not by the flag — a stored portrait comes back in the config. */
              var sentPhoto = (pendingFace === undefined ? (cfg.faceImage || '') : pendingFace);
              var photoLost = !!(sentPhoto && sentPhoto.indexOf('data:image/') === 0 &&
                String(saved.faceImage || '').indexOf('data:image/') !== 0);
              var why = String(r2.json.faceImageRefused || '');
              status.textContent =
                (questions.length ? ('Saved — the avatar now asks ' + questions.length + ' question' + (questions.length === 1 ? '' : 's') + '. Patients see it in their portal.') : 'Saved, but with no questions the check-in stays OFF for patients.') +
                (saved.exitPin ? ' Kiosk exit PIN is set.' : ' No exit PIN — “End interview” closes straight into your app.') +
                (photoLost || why ? (' ⚠ Your photo was NOT saved' +
                  (why === 'too_large' ? ' — it came out too large for the server (' + Math.round(sentPhoto.length / 1024) + 'KB). Retake it a little further back.'
                    : why === 'shape' ? ' — the camera returned something this server will not store. Retake it.'
                    : ' — the server did not store it. Retake the photo and save again.')) : '');
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
      /* av-5.7.0 - THE CONSENT GATE. Opaque, not translucent: until staff
         answer, the patient must not be able to read the doctor's app through
         it, and nothing behind it is running - no microphone, no turn, no
         fullscreen. It covers the whole overlay including the End and Pause
         buttons, so the only two things reachable on this screen are Yes and
         No. */
      '#mlsAvKioskConsent{display:flex;position:absolute;inset:0;background:linear-gradient(165deg,#F7F5EE,#E9F0EA 55%,#DEE9E1);align-items:center;justify-content:center;z-index:12;padding:4vh 5vw}' +
      '#mlsAvKioskConsentCard{background:#fff;border-radius:22px;padding:30px 32px;display:flex;flex-direction:column;gap:14px;box-shadow:0 26px 74px rgba(32,64,52,.28);width:min(680px,94vw);text-align:left}' +
      '#mlsAvKioskConsentTitle{font:800 26px/1.3 \'Newsreader\',Georgia,serif;color:#204034}' +
      '#mlsAvKioskConsentSub{font:600 15px/1.55 system-ui;color:#55605A}' +
      '#mlsAvKioskConsentRow{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px}' +
      '#mlsAvKioskConsentYes{border:0;background:#2E6A4B;color:#fff;border-radius:999px;padding:15px 28px;font:800 16px system-ui;cursor:pointer}' +
      '#mlsAvKioskConsentYes:hover{background:#26583E}' +
      '#mlsAvKioskConsentNo{border:1px solid #cfd9d2;background:#fff;color:#204034;border-radius:999px;padding:15px 24px;font:700 16px system-ui;cursor:pointer}' +
      /* CONTAINMENT, NOT PAINT. The consent card used to cover the screen by
         z-index and nothing more: no `inert`, no focus trap, no pointer-events
         rule. Tab still reached Pause and End interview behind it, and both of
         those lead to kioskListen - so the microphone opened with no consent
         recorded. An opaque card is not a gate against a keyboard.
         display:none is the point: a hidden control is not focusable, so the tab
         order genuinely contains two buttons while this class is on. The code
         path is gated as well (kioskListen/kioskTurn/kioskCloseServerSide test
         kiosk.consentAt), because one mechanism is a single point of failure. */
      '#mlsAvKiosk.preconsent #mlsAvKioskEnd,#mlsAvKiosk.preconsent #mlsAvKioskMute,' +
      '#mlsAvKiosk.preconsent #mlsAvKioskEndVisit,#mlsAvKiosk.preconsent #mlsAvKioskTypeRow,' +
      '#mlsAvKiosk.preconsent #mlsAvKioskRest,#mlsAvKiosk.preconsent #mlsAvKioskPin,' +
      '#mlsAvKiosk.preconsent #mlsAvKioskOrders,#mlsAvKiosk.preconsent #mlsAvKioskReview{display:none!important}' +
      /* av-5.7.0 - THE REST SCREEN AND ITS ONE BUTTON. A finished check-in
         stays up and tells the patient the doctor is coming; the doctor walks
         in and taps once to start the room recording. Starting a disclosed
         recording is not a door into the app, so it carries no PIN - the door
         still does. */
      '#mlsAvKioskRest{display:none;flex-direction:column;align-items:center;gap:1.4vh}' +
      '#mlsAvKioskRoomGo{border:0;background:#204034;color:#fff;border-radius:999px;padding:2vh 4vh;font:800 2.4vh system-ui;cursor:pointer;box-shadow:0 10px 30px rgba(32,64,52,.28)}' +
      '#mlsAvKioskRoomGo:hover{background:#2E6A4B}' +
      '#mlsAvKioskRestNote{font:600 1.8vh/1.45 system-ui;color:#55605A;max-width:min(680px,92vw)}' +
      '#mlsAvKiosk.ambient #mlsAvKioskRest{display:none}' +
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
    documenting: 'Ambiently documenting', saving: 'Saving', paused: 'Paused',
    /* av-5.7.0: a FINISHED check-in is not "Speaking". kioskFinish set the mood
       to speaking so the closing line would play, and the chip then read Speaking
       - with the wave animating - for the whole rest period, sometimes for
       minutes, while the screen was silent and waiting. */
    resting: 'Waiting for the doctor'
  };
  /* ── ONE OWNER FOR THE PATIENT-FACING LINE (av-6.2.0) ─────────────────────────────────
     Owner: "having text constantly overlapping and being such a paIUN IN THE ASS".
     It was never a layout defect. #mlsAvKioskInterim had FOURTEEN writers - the live
     transcript, two microphone hints, three staff-recovery notices, the rest screen, the
     ambient status, the finish line - all assigning textContent directly, with no ownership
     and no priority. They clobbered each other mid-sentence: a notice the patient needed was
     wiped by a transient transcript fragment a moment later, and back again.
     The evidence that this was already hurting: one call site had grown a hand-rolled
     `if (!ivOff.textContent)` guard - somebody noticed the clobbering and patched the victim
     rather than the cause. Same shape as two-modules-fight-over-one-attribute.
     Now every write goes through here and carries a KIND, ranked:
       alert      (staff must act: no server, no mic, no consent, wrong patient)
       status     (the kiosk is doing something: resting, finishing, filed)
       hint       (advice: the mic is off, type below)
       transcript (what is being heard right now - transient, never holds the line)
     A lower-ranked write cannot replace a higher-ranked message while its hold is live. The
     transcript holds for zero milliseconds, so it can never lock the line, but it also can
     never wipe an alert. kioskLineReset() is called at the start of each turn - without it an
     alert from the previous turn would blank the next question's transcript for its whole hold.
     ⚠️ ALL call sites are routed. Half-routing would be worse than not doing it: the arbitrator
     would believe it owns a line that another writer is still overwriting behind its back. */
  var KL_RANK = { transcript: 0, hint: 1, status: 2, alert: 3 };
  var KL_HOLD = { transcript: 0, hint: 6000, status: 9000, alert: 20000 };
  var klKind = '', klUntil = 0;
  function kioskLine(kind, text) {
    var iv = gid('mlsAvKioskInterim');
    if (!iv) return false;
    var rank = KL_RANK[kind]; if (rank === undefined) rank = 0;
    var now = Date.now();
    var heldRank = (klKind && klUntil > now) ? KL_RANK[klKind] : -1;
    if (heldRank === undefined) heldRank = -1;
    if (rank < heldRank) return false;          /* a more important message is still standing */
    iv.textContent = (text === null || text === undefined) ? '' : String(text);
    klKind = kind;
    klUntil = now + (KL_HOLD[kind] || 0);
    return true;
  }
  /* a new turn is a new context: drop any hold, or a stale alert silences the next question */
  function kioskLineReset() {
    klKind = ''; klUntil = 0;
    var iv = gid('mlsAvKioskInterim');
    if (iv) iv.textContent = '';
    return true;
  }
  /* what is on the line right now, for tests and for the receipt */
  function kioskLineState() { return { kind: klKind, holdMs: Math.max(0, klUntil - Date.now()) }; }
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
    /* release the echo-cancelled companion stream with the overlay, or the microphone light
       stays on after the kiosk is gone — a patient-facing screen must never leave the mic
       open once it has closed (av-6.1.0) */
    safe(function () { pvVoiceGateStop(); });
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
    /* the consent dies with the screen it was given on - nothing reached from a
       later session may act on it */
    kiosk.consentAt = 0;
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
    /* AND NO TURN EITHER, including a `finish`. This is the second half of the
       same defect: from the consent screen, Tab+Enter on "End interview" reached
       kioskCloseServerSide, which POSTs finish:true — and the backend INSERTS the
       row for that session id, runs the summary model over a transcript with no
       patient turns, and flips it to 'ready'. A phantom completed check-in, with
       an AI-written headline, in the doctor's inbox and on his phone, for a
       patient who never consented and never spoke. */
    if (!kiosk.consentAt) return;
    /* A FINISHED interview accepts nothing more. The typed row stays on screen
       in mic-off mode, so without this a patient could Send into a completed
       session: the server answers "this check-in is already complete", which
       overwrote the rest screen and re-spoke at them. Only the staff exit
       moves a finished kiosk. */
    if (kiosk.completed && !finish) return;
    if (kiosk.ambient) return;   /* ambient records the room, it never interviews */
    kiosk.busy = true;
    if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
    /* pvStopMic, NOT pvStopVoice. This is the ordinary turn: the answer arrives
       through rec.onresult while the question is still playing (the mic opens WITH
       it), so cancelling here truncated the question on EVERY answer — and on every
       echo the classifier missed, which is a question cut off by its own voice.
       The next line still replaces this one: pvSpeakShaped bumps pvSpeakSeq when
       the reply lands. What is gone is the silence in between. */
    pvStopMic();
    kioskMood('thinking', '', answer);
    kioskLineReset();
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
        /* SPOKEN, so it apologises like a person and does not name our plumbing.
           "The connection hiccuped" describes something the patient cannot see,
           did not cause and cannot fix; what they need is permission to just say
           it again. Shaped 'calm' for the same reason the silence nudge is: this
           is the moment a patient decides the machine is broken, and a brisk
           delivery here is what makes them give up and wait for a human. */
        var msg = j.message || 'Sorry, I didn\'t quite catch that on my end. Could you say it once more?';
        kioskSetSay(msg);
        kioskMood('speaking', msg);
        pvSpeakShaped(msg, function () { kioskListen(); }, 'calm');
        return;
      }
      kiosk.lastTry = null; kiosk.lastSay = String(j.say || '');
      /* WHICH KIND OF LINE THIS IS, decided here because this is the only place
         that can see it. `greet` fires once per interview — the first line the
         patient ever hears, and the one the owner cares most about sounding
         welcoming; `alert` rides the server's own emergency verdict rather than
         any guess about the words, so the warning and its delivery are the same
         fact. Read once into a local: kiosk.spoke flips below and the closing
         branch must not accidentally re-greet. */
      var saidShape = null;
      if (j.emergency === true) saidShape = 'alert';
      else if (!kiosk.spoke) saidShape = 'greet';
      kiosk.spoke = true;
      /* Keep the check-in verbatim and LOCALLY: ambient room mode hands the
         doctor one transcript with the check-in and the visit both in it,
         and the patient's own answers are the check-in half. Recorded only
         on a SUCCESSFUL turn - a refused turn is re-asked and re-answered,
         and would otherwise appear twice. */
      /* av-6.2.0: called UNCONDITIONALLY. Gating on j.avatar meant a turn response without an
         identity payload never resolved the name slot at all, leaving its "One moment…"
         placeholder on screen. kioskSetIdentity is null-safe throughout and now falls back. */
      kioskSetIdentity(j.avatar || null);
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
        pvSpeakShaped(kiosk.lastSay, function () { kioskFinish(); }, saidShape);
        setTimeout(function () { if (kiosk.open && !kiosk.completed) kioskFinish(); }, 12000);
      } else {
        kioskMood('speaking', kiosk.lastSay, answer);
        /* owner: "it should be able to listen while it is talking" - the mic
           opens WITH the question, not after it. Patients answer as soon as
           they understand, usually before the sentence ends; those first
           words used to be discarded and the kiosk looked frozen. */
        kioskListen(true);
        pvSpeakShaped(kiosk.lastSay, function () {
          if (!pvRec) { kioskListen(); return; }
          /* THE SILENCE CLOCK STARTS WHEN THE QUESTION ENDS. kioskListen arms
             it, and the microphone now opens WITH the question, so a long
             question spent its own patience: a 6-second question left 3
             seconds before the kiosk talked over the patient's first words
             with "take your time". Re-armed here, from the moment there is
             actually something to answer. */
          kioskArmWatchdog(9000);
        });
      }
    }, function () {
      kiosk.busy = false;
      if (!kiosk.open) return;
      /* the same words the spoken refusal above uses. This path is DISPLAY only
         (nothing is spoken when the fetch itself rejects), and two different
         apologies for one condition is how a patient ends up reading one thing
         and hearing another. */
      kioskSetSay('Sorry, I didn\'t quite catch that on my end. Could you say it once more?');
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
    /* AND A SENTENCE STILL PLAYING COUNTS AS ACTIVITY — WITH NO CAP ON THE WAIT.
       This reads `pvSaying`, the LIVENESS value, and it must: it is asking "is the
       avatar still talking?", not "what do we compare against for echo?". It was
       not consulted here at all, so a question longer than one window burned its
       own patience — silence counted against the patient while nobody had been
       given anything to answer yet — and at three windows this function fell
       straight through to pvStopVoice, the avatar cut off mid-word by its own
       silence clock. Routing the stops to pvStopMic instead would not have helped:
       the nudge branch speaks NUDGE_LINE over the question, and pvSpeakShaped bumps
       pvSpeakSeq, which kills it anyway. So the fix is this CONDITION.
       It joins the existing UNCAPPED re-arm rather than adding a second, capped
       one: a sentence in flight is watched for as long as it takes. It cannot
       wedge, because pvSaying is cleared by pvSpeakVoiced's finish(), which is
       itself guaranteed by that function's own watchdog (pinned by the suite). */
    if (kiosk.heard || pvSaying) {
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
      /* 'calm' must match the shape the pre-fetch used in kioskConsentYes, or
         the cache key differs and the one request this line exists to have
         already made is paid for again, right when the patient is waiting */
      pvSpeakShaped(NUDGE_LINE, function () { kioskListen(); }, 'calm');
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
    kioskLine('alert', 'Staff: the check-in could not reach the server — end the interview and check the connection.');
    var pg = gid('mlsAvKioskProgress'); if (pg) pg.textContent = '';
    var row = gid('mlsAvKioskTypeRow'); if (row) row.style.display = 'none';
    /* the visit still deserves a transcript even when the check-in could not
       reach the server, so the hand-off button is offered here too */
    kioskRestShow();
    if (kiosk.pinSet === false) {
      safe(function () { if (isFn(window.toast)) window.toast('The check-in stopped early — the server could not be reached.', ''); });
      kioskClose('ended');
    }
  }
  /* NO CONSENT, NO MICROPHONE — enforced INSIDE this function, at the one place
     the interview opens one. An adversarial pass on av-5.7.0 found the consent
     card was containment by Z-INDEX ALONE: nothing behind it was inert, so Tab
     reached #mlsAvKioskMute and #mlsAvKioskEnd, and Pause→Resume and the PIN
     pad's "Back to the interview" both call this function. The microphone opened
     with consentAt === 0 and the patient's words were POSTed. The card is now
     genuinely contained (see .preconsent in kioskStyle) AND consent is a term in
     the code, because either mechanism alone is a single point of failure.
     The guard lives on the first line of the body and this note lives out here on
     purpose: the contract suite reads the first 400 characters of this function
     looking for the paused guard, and a comment that long inside the body pushed
     it out of that window. A pin that stops seeing its subject is a pin that has
     stopped working. */
  function kioskListen(keepMood) {
    if (!kiosk.consentAt) return;     /* see the note above this function */
    if (kiosk.ambient) return;
    if (kiosk.paused) return;         /* see kioskPauseToggle */   /* the ambient loop owns the microphone and never takes turns */
    if (!kiosk.open || kiosk.busy || kiosk.completed) return;
    if (keepMood && pvRec) return;            /* already listening */
    if (kiosk.mic === false) {
      kioskArmWatchdog(20000);   /* typed mode self-ends too — armed on the FIRST
         line of this branch so it sits beside its subject: the contract suite
         reads a 320-character window from `kiosk.mic === false` looking for it,
         and a comment added below once pushed it out of view. */
      var typeRow = gid('mlsAvKioskTypeRow'); if (typeRow) typeRow.style.display = 'flex';
      var input = gid('mlsAvKioskInput'); if (input) safe(function () { input.focus(); });
      /* SAID HERE, not only at the preflight. kioskTurn blanks the interim line
         at the start of every turn, so the preflight's "Microphone is off" notice
         survived exactly until the first question - after which a patient faced a
         typing box with no explanation. This runs on every turn, so it holds. */
      var ivOff = gid('mlsAvKioskInterim');
      if (ivOff && !ivOff.textContent) kioskLine('hint', 'The microphone is off on this screen — type your answer below.');
      return;
    }
    if (!keepMood) kioskMood('listening', kiosk.lastSay);
    /* ⛔ NO getUserMedia HERE. My first attempt started the gate from this line,
       which made the kiosk request the microphone a SECOND time — and
       avatar-consent-and-turn-taking-proof.js caught it ("the microphone was requested ONCE,
       on the staff tap [calls = 2]"). The gate now ADOPTS the stream the preflight already
       obtained with the same constraints, so the count stays at one. */
    kiosk.heard = false;
    /* THE SILENCE CLOCK IS NOT ARMED HERE ON THE DUPLEX PATH. keepMood means the
       microphone is opening WITH a question that is about to play, and the arm at
       the bottom of this function used to start the 9-second countdown against
       the question's own duration: any question longer than that nudged "take
       your time" over its own second half. pvSpeak's continuation arms it when
       the question actually ends (see kioskTurn). Every other caller - the nudge,
       the recogniser-died path, resume - passes no keepMood and still arms below. */
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
      /* THE HALF STRING MATCHING COULD NOT DO (av-6.1.0). "in the morning" the echo and "in
         the morning" the answer are the same string, so no classifier can separate them —
         which is why a mis-heard echo could still be FILED as the patient's answer. They are
         not the same SOUND: the echo arrives while the room is silent, because on the
         echo-cancelled stream the avatar's own voice has been removed.
         Deliberately conditional on pvVoiceGateReady(): this refusal only ever fires when
         there is hard audio evidence. Without confirmed AEC the behaviour is byte-for-byte
         what it is today, so the measured real-answer harm (9 of 12, 22 of 22 in an earlier
         round) cannot come back on a device that cannot support the gate. */
      /* ⛔ AND IT NEEDS TWO INDEPENDENT REASONS, NOT ONE. An adversarial sweep raised this
         path: the room floor is learned from whatever is in the room, and the bar is
         floor x 2.6. In a NOISY room - a busy waiting area, a fan, a bystander talking while
         the gate adopts the stream - the bar rises, a soft-spoken patient never clears it,
         pvOtherVoiceNow() stays false, and this branch would then delete EVERY answer they
         give while the avatar is still speaking. One verifier called that refuted; three
         never ran (weekly agent limit), so I am not treating it as settled - and deleting a
         patient's answers is the worst outcome in this file.
         So the audio evidence is necessary but NOT sufficient: the transcript must ALSO look
         like our own sentence, i.e. carry zero words we are not saying. A mis-transcribed
         echo scores zero by construction (homophones and merges resolve back to our words -
         see pvNovelWordCount). A real answer almost always carries a novel word, and now
         survives even when the microphone never registered the person who spoke it.
         Fail-safe by construction beats a threshold I would have to keep re-tuning. */
      /* THE ECHO TEMPLATE, not the liveness value — see `var pvEchoSaying`. The
         second filing gate: everything it refuses is deleted, so it reads the
         string whose lifetime origin/main gave it. */
      if (pvEchoSaying && pvVoiceGateReady() && !pvOtherVoiceNow() &&
          pvNovelWordCount(pvEchoSaying, finalText) === 0) {
        kiosk.echoRefused = (kiosk.echoRefused || 0) + 1;
        return;
      }
      if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
      var reuse = kiosk.lastTry && kiosk.lastTry.answer === finalText ? kiosk.lastTry.nonce : kioskNonce();
      kiosk.lastTry = { answer: finalText, nonce: reuse };
      kioskTurn(finalText, reuse);
    }, function (interim) {
      /* the avatar hearing ITSELF must never become the patient's answer */
      if (pvIsSelfEcho(interim)) return;
      /* BARGE-IN: real speech while the question is still playing stops the question
         mid-sentence, the way a person would — but it must be SOMEONE ELSE's speech.
         Two words is not evidence of another person when the avatar is mid-sentence and
         the microphone is pointed at the speaker playing it; see pvNovelWordCount for the
         measured miss rate of the old negative rule (18% overall, 52% on merged words),
         every miss silencing the avatar's own question. While nothing is playing there is
         no question to protect, so the old two-word floor stands unchanged. */
      var novel = pvSaying ? pvNovelWordCount(pvSaying, interim) : 0;
      /* av-6.1.0: when echo cancellation is CONFIRMED active, presence is an audio fact and
         the words are irrelevant to it — the avatar's own voice is not in the signal, so
         sustained energy is another person. The novel-word rule remains the fallback for any
         device where the browser did not apply AEC; see pvVoiceGateStart. */
      var otherVoice;
      if (!pvSaying) {
        /* nothing is playing, so there is no question to protect — the historical two-word
           floor stands, unchanged, and this is the line the contract suite reads */
        otherVoice = interim.trim().split(/\s+/).filter(Boolean).length >= 2;
      } else if (pvVoiceGateReady()) {
        /* somebody is audibly there AND it behaves like speech rather than a throat-clear:
           it produced a word the avatar is not saying, or it has run on well past any cough.
           Presence alone is not enough — see pvOtherVoiceSustained. */
        otherVoice = pvOtherVoiceNow() && (novel >= 1 || pvOtherVoiceSustained());
      } else {
        /* no confirmed echo cancellation: fall back to the measured string gate exactly as
           av-6.0.9 shipped it, which a cough also cannot pass (it yields no novel words) */
        otherVoice = novel >= 2;
      }
      if (pvSaying && !otherVoice) return;   /* our own voice coming back: do not stop, do not paint */
      if (interim.trim()) kiosk.heard = true;
      if (pvSaying && otherVoice) pvStopSpeechOnly();
      kioskLine('transcript', interim);
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
      kioskLine('alert', 'The microphone is not available here — typing works below.');
      kioskArmWatchdog(20000);   /* a failed mic start must still self-end */
      return;
    }
    if (!keepMood) kioskArmWatchdog(9000);
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
    /* av-5.7.0 - IT ALWAYS RESTS NOW, PIN OR NO PIN. A no-PIN practice used to
       have the finished kiosk close itself straight into the doctor's app - the
       whole roster, in front of the patient who was still holding the screen -
       and it also meant the hand-off the owner asked for could not exist,
       because the screen was gone before the doctor walked in. The exit is
       still one tap for a no-PIN office (End interview), so nobody is trapped. */
    /* pvStopMic, NOT pvStopVoice: THE CLOSING LINE IS THE ONE MOST OFTEN CUT.
       kioskTurn arms a 12-second safety timer beside the done-path speak, and any
       closing line longer than that reached this function while it was still
       playing — a hard cap on the last thing the patient hears. The timer still
       does its real job (a speak that never completes cannot strand the kiosk);
       it just no longer amputates the sentence to do it. */
    pvStopMic();
    kioskMood('speaking', 'thank you');
    kioskSetSay('All set — thank you. Your doctor will be in with you soon.');
    var iv = gid('mlsAvKioskInterim');
    kioskLine('status', 'Please hand the screen back to the team. Staff: the button below starts listening to the visit; “End interview” leaves.');
    var pg = gid('mlsAvKioskProgress'); if (pg) pg.textContent = '';
    var row = gid('mlsAvKioskTypeRow'); if (row) row.style.display = 'none';
    kioskRestShow();
  }
  /* THE ONE BUTTON. Owner: "this avatar once its done should say your doctor
     will be in with you soon ... but it needs to stay up so when the doctor
     enters the room they click one button and the avatar just listens."
     It is not behind the exit PIN on purpose: the PIN guards the way back into
     the app, and starting a recording that the screen declares in words, that
     Pause stops instantly and that can only ever be written to the chart this
     check-in was bound to, is not that. */
  function kioskRestShow() {
    var host = gid('mlsAvKioskRest'); if (!host) return;
    host.style.display = 'flex';
    /* AND THE SCREEN STOPS CLAIMING TO SPEAK. kioskFinish sets the mood to
       'speaking' so the closing line plays; without this the chip read "Speaking"
       and the waveform animated for the whole rest period, which on a busy day is
       minutes of a silent screen insisting it is talking. The class goes too, or
       the wave keeps running underneath a corrected chip. */
    safe(function () {
      var root = gid('mlsAvKiosk');
      if (root) root.classList.remove('speaking', 'listening', 'thinking');
    });
    kioskState('resting');
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
      /* av-6.1.0: KEEP this stream instead of throwing it away. The comment above already
         said echo cancellation is the prerequisite for an open mic during playback — but the
         stream carrying it was stopped one line later, and the recogniser then opened its own
         microphone with no constraints at all. So the reasoning was right and nothing used it.
         The voice gate adopts this stream, which means the mic is still requested exactly ONCE
         on the staff tap (the contract avatar-consent-and-turn-taking-proof.js pins) and never
         again in front of a patient. My first attempt started a second getUserMedia from
         kioskListen, and that suite caught it. If adoption fails for any reason the stream is
         released exactly as before, so the old behaviour is the floor. */
      var adopted = pvVoiceGateAdopt(stream);
      if (!adopted) safe(function () { stream.getTracks().forEach(function (t) { t.stop(); }); });
      kiosk.mic = true; then();
    }, function () {
      kiosk.mic = false;
      kioskLine('hint', 'Microphone is off — the interview will use typing.');
      var row = gid('mlsAvKioskTypeRow'); if (row) row.style.display = 'flex';
      then();
    });
  }
  /* which of the eight backend voices are male. Named rather than inferred: the
     list is fixed server-side (TTS_VOICES in openai.js) and a voice we do not
     recognise leaves pvWantMale null, which means "do not guess". */
  var PV_MALE_VOICES = { ash: 1, echo: 1, onyx: 1 };
  var PV_FEMALE_VOICES = { coral: 1, nova: 1, shimmer: 1, sage: 1 };
  function kioskSetIdentity(av) {
    var name = gid('mlsAvKioskName');
    /* av-6.2.0 — "One moment…" IS THE NAME SLOT'S PLACEHOLDER, and this was the only thing
       that ever replaced it, only when a name actually arrived. A turn response without
       avatar.name therefore left "One moment…" standing where the assistant's NAME belongs,
       in front of the patient, for the entire interview. Measured in a real kiosk render:
       #mlsAvKioskName read "One moment…" through every state.
       Resolve it either way now — the delivered name, else the one we already learned, else a
       neutral label. A waiting-message must never be left where a name goes. */
    var gotName = clean(av && av.name);
    if (name) name.textContent = gotName || kiosk.avName || 'Your check-in assistant';
    if (gotName) kiosk.avName = gotName;   /* speaker label in the filed transcript */
    /* THE CONFIGURED VOICE WAS DELIVERED AND THROWN AWAY. The turn response has
       carried `avatar.voice` for several releases specifically so the client can
       see which voice is speaking, and this function - the one place that reads
       the identity payload - ignored it. That is why the browser fallback could
       answer in the wrong sex: the information it needed was already on the
       wire. `alloy` is deliberately in NEITHER table; it is the neutral voice
       and guessing a sex for it would be worse than not matching.
       The pick is CACHED in pvVoice, so learning this has to invalidate it -
       the first turn can easily land after something has already spoken. */
    safe(function () {
      if (!av || typeof av.voice !== 'string') return;
      var want = PV_MALE_VOICES[av.voice] ? true : (PV_FEMALE_VOICES[av.voice] ? false : null);
      if (want === pvWantMale) return;
      pvWantMale = want;
      pvVoice = undefined;   /* re-pick against the new preference */
    });
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
  /* ONE SLOT WAS ONE PATIENT TOO FEW (fixed av-5.7.2, found by review round three
     and confirmed by executing the store against a fake localStorage).
     Every capture wrote the SAME key, so the first backup write of the next room
     recording overwrote the previous one — unconditionally, with setItem. A visit
     that failed to file (wrong chart open, no transcript box on screen) keeps only
     its crash copy, and the very next patient's hand-off tap destroyed it, along
     with the Visit card's offer to recover it. Nothing said so: the panel simply
     never appeared again.
     The record is now keyed BY THE CHART IT IS BOUND TO, so held captures for
     different patients coexist and each is offered to the chart it belongs to.
     The bare legacy key is still read, so a capture taken by b954 or earlier is
     still recoverable, and it is dropped by its own key when it is filed. */
  function ambientStoreKeyFor(bound) {
    var b = clean(bound);
    return b ? (ambientStoreKey() + ':' + b) : ambientStoreKey();
  }
  function ambientRecParse(raw) {
    if (!raw) return null;
    var rec = safe(function () { return JSON.parse(raw); }, null);
    if (!rec || typeof rec !== 'object' || !Array.isArray(rec.parts)) return null;
    /* an UNBOUND backup could only ever end in a refusal to write (see
       kioskAmbientFile), so it is not a recoverable capture at all */
    if (!clean(rec.bound)) return null;
    return rec;
  }
  /* every held capture, newest first. Enumerated from localStorage rather than
     from a remembered list, because the list is exactly what a reload loses. */
  function ambientStoreList() {
    var base = ambientStoreKey();
    var out = [], seen = {};
    function add(k) {
      if (!k || seen[k]) return;
      var rec = ambientRecParse(safe(function () { return localStorage.getItem(k); }, null));
      if (rec) { seen[k] = 1; out.push({ key: k, rec: rec }); }
    }
    /* enumeration is the general case: any chart may be holding one */
    safe(function () {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || (k !== base && k.indexOf(base + ':') !== 0)) continue;
        add(k);
      }
    });
    /* AND A DIRECT LOOK, ALWAYS. If enumeration is unavailable or throws part-way
       (a storage implementation without length/key, a partitioned or blocked store),
       an empty list is indistinguishable from "no capture is waiting" - so the
       recovery offer would silently disappear and the consultation with it. These two
       keys are the ones that matter: the legacy single slot, and the chart on screen. */
    add(base);
    var open = clean(safe(function () { return activePtIdSafe(); }, ''));
    if (open) add(ambientStoreKeyFor(open));
    if (kiosk && clean(kiosk.ambBound)) add(ambientStoreKeyFor(clean(kiosk.ambBound)));
    out.sort(function (a, b) { return (Number(b.rec.savedAt) || 0) - (Number(a.rec.savedAt) || 0); });
    return out;
  }
  /* WHICH held capture to offer. A CAPTURE RUNNING IN THIS TAB IS NOT A RECOVERED
     ONE - the backup is written continuously while the room is being recorded, so
     without this filter the Visit card would offer to file a visit still in
     progress, writing half a consultation and dropping the backup protecting the
     other half. The open chart's own capture wins over a newer one belonging to a
     different chart: it is the only one the doctor can file from where he stands. */
  function ambientStorePick() {
    var live = clean(kiosk.sid);
    var list = ambientStoreList().filter(function (e) {
      return !(kiosk.ambient === true && live && clean(e.rec.sid) === live);
    });
    if (!list.length) return null;
    var open = clean(safe(function () { return activePtIdSafe(); }, ''));
    var chosen = null;
    if (open) {
      for (var i = 0; i < list.length; i++) {
        if (clean(list[i].rec.bound) === open) { chosen = list[i]; break; }
      }
    }
    if (!chosen) chosen = list[0];
    chosen.held = list.length;
    return chosen;
  }
  /* drop BY KEY. A drop that recomputed the key from current state would delete
     whichever capture the store happens to be pointing at now, not the one the
     doctor just filed or deliberately discarded. */
  function ambientStoreDrop(key) {
    var k = clean(key);
    safe(function () { localStorage.removeItem(k || ambientStoreKey()); });
  }
  function ambientStoreWrite(rec) {
    /* keyed by the bound chart, so this write can never land on another
       patient's held capture. An unbound record is unrecoverable by
       construction (ambientRecParse refuses it), so it keeps the bare key. */
    var key = ambientStoreKeyFor(rec.bound);
    var parts = (rec.parts || []).slice();
    var trimmed = false;
    /* ⛔ A NEW SESSION MUST NOT ERASE ANOTHER SESSION'S RECORDED WORDS.
       The slot is keyed by the bound chart, and kioskAmbientStart writes a backup BEFORE the first
       ROOM word is spoken. Starting a check-in on a chart that still held an UNFILED consultation
       therefore landed a record with zero room words on top of the only copy of it, returned
       ok:true, and the doctor's Visit-card offer vanished at the same moment (ambientRecoverInfo
       yields nothing for a bodyless record).
       ⚠️ "EMPTY" MEANS NO ROOM WORDS - IT MUST NOT COUNT intake. The sole writer
       (kioskAmbientSaveNow) always forwards kiosk.intake, so after any interview the incoming
       record carries the whole check-in; an intake-counting test can NEVER fire on the path that
       does the damage. A previous version of this guard counted intake and was a measured no-op
       for exactly that reason, with a green test over it that hard-coded the one shape the caller
       never produces.
       ⚠️ AND IT MOVES THE HELD CAPTURE ASIDE RATHER THAN REFUSING THE WRITE. Refusing sets
       kiosk.ambSaveOk false, which paints the patient-facing recording disclosure as a backup
       failure, and it would also drop this check-in's own backup. The aside key keeps the chart
       prefix so ambientStoreList's enumeration still finds it, while the live capture keeps the
       plain chart key that ambientStoreList's DIRECT LOOK can reconstruct without knowing a sid. */
    if (!parts.length) {
      var heldRaw = safe(function () { return localStorage.getItem(key); }, null);
      var held = heldRaw ? ambientRecParse(heldRaw) : null;
      /* only a held record with ROOM WORDS is worth keeping: a bodyless one can never be offered,
         so preserving those would silt up the chart's slot with nothing. A record carrying THIS
         session's sid is the same capture updating itself and must simply be overwritten. */
      if (held && (held.parts || []).length && clean(held.sid) !== clean(rec.sid)) {
        var aside = key + '#' + (clean(held.sid) || ('t' + (Number(held.savedAt) || 0)));
        var moved = safe(function () { localStorage.setItem(aside, heldRaw); return true; }, false);
        /* the store is too full to hold the copy. A recorded consultation is worth more than a
           placeholder with no words in it, so keep it and report the storage failure honestly
           instead of overwriting a real visit to make room for an empty one. */
        if (!moved) return { ok: false, why: 'quota', trimmed: false, kept: true };
      }
    }
    for (var guard = 0; guard < 40; guard++) {
      var body = safe(function () {
        return JSON.stringify({
          v: 1, sid: rec.sid || '', bound: rec.bound || '', start: rec.start || 0,
          savedAt: Date.now(), avName: rec.avName || '', trimmed: trimmed,
          intake: rec.intake || [], actions: rec.actions || [], parts: parts,
          /* THE CONSENT AND THE FILED FLAG ARE PART OF THE RECORD, not of this
             tab's memory. Without them a recovered capture filed with NO consent
             attestation - breaking the invariant this train exists to enforce -
             and re-filed the whole check-in block a second time, so the patient's
             intake answers landed in the chart twice. Both are in-memory-only
             flags that a reload is exactly the event that loses. */
          consentAt: rec.consentAt || 0, intakeFiled: rec.intakeFiled === true
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
      intake: kiosk.intake || [], actions: ambientActionsForStore(), parts: kiosk.ambParts || [],
      /* carried so a RECOVERED capture can state its consent and can tell whether
         the check-in has already reached the transcript - see ambientStoreWrite */
      consentAt: kiosk.consentAt || 0, intakeFiled: kiosk.intakeFiled === true
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
    /* the room transcript is a TRANSCRIPT: it must never outrank a staff alert (av-6.2.0) */
    var tail = clean(interim);
    if (!tail) { var parts = kiosk.ambParts || []; tail = parts.length ? parts[parts.length - 1] : ''; }
    kioskLine('transcript', tail.length > 160 ? ('...' + tail.slice(tail.length - 160)) : tail);
    kioskAmbientClock();
  }
  function kioskAmbientNoMic() {
    /* No recogniser, or a microphone that has been revoked mid-capture. Say so and
       STOP: a red recording badge over a microphone that is not open is the one lie
       this feature must not tell.
       THE MESSAGE RIDES THROUGH THE STOP. Writing it here and calling the stop on
       the next line lost it every time - the stop rewrites the say line and the
       interim synchronously, with no paint in between, so staff saw the ordinary
       "Recording stopped" and never learned the microphone had gone. */
    kiosk.ambSayOverride = 'The microphone stopped working, so I stopped recording.';
    /* THE CAUSE ONLY. This line used to end "Anything already captured is in the
       transcript" - a constant, asserted before the filing attempt had happened and
       printed unchanged when that attempt was REFUSED, so staff were told the words
       were safe at the exact moment they were not. kioskAmbientStop appends the real
       verdict to whatever a caller passes in. */
    kiosk.ambInterimOverride = 'Staff: the microphone was refused or lost, so nothing more is being recorded.';
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
    rec.onerror = function (ev) {
      if (kiosk.ambRec !== rec) return;
      kiosk.ambRec = null;
      /* PERMISSION IS NOT A HICCUP. `not-allowed` and `service-not-allowed` mean
         the microphone will not open on the next try either, and the bounded
         backoff then keeps the recording disclosure on screen forever over a
         capture that never records a word. Ordinary `no-speech` / `network`
         blips still retry - that is what the loop is for. */
      var code = String((ev && ev.error) || '');
      if (code === 'not-allowed' || code === 'service-not-allowed') { kioskAmbientNoMic(); return; }
      kioskAmbientRetry();
    };
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
    /* THE CHECK-IN GOES IN ONCE. "Keep listening" on the review screen starts a
       SECOND capture on the same session, and this block always led with the
       whole intake - so the patient's answers, and the consent attestation with
       them, were appended to the transcript a second time. A doctor reading that
       chart cannot tell a repeated question from a duplicated paste. */
    if (kiosk.intakeFiled) {
      lines.push('--- visit, continued ---');
      lines.push('[Room capture resumed. The check-in and the earlier part of this visit are already above.]');
      /* ⛔ THE CONSENT LINE MUST RIDE WITH EVERY BLOCK OF WORDS, INCLUDING THIS ONE.
         This early return suppressed the whole header to avoid appending the patient's answers
         a second time — correct for the INTAKE, wrong for the attestation, and they were being
         dropped together.
         `intakeFiled` is a claim about a PREVIOUS write, and the early return treated it as
         proof that the consent line is already in THIS transcript. It is not: a day flip
         re-binds the visit, recovery can resume into a fresh session (see the crash record,
         which carries consentAt and intakeFiled separately for exactly this reason), and the
         doctor can edit the box. In any of those cases these words were filed with NO consent
         record anywhere — which is the thing the note below says must never happen: "a recording
         whose consent lives only in someone's memory is a recording nobody can defend later".
         The asymmetry decides it. Repeating one bracketed line costs a duplicated line in a
         chart; omitting it costs an undefendable recording. So the intake stays suppressed and
         the attestation always rides. */
      if (kiosk.consentAt) {
        lines.push('[Recording consent confirmed by practice staff at ' +
          safe(function () { return new Date(kiosk.consentAt).toLocaleString(); }, String(kiosk.consentAt)) +
          ', before any microphone was opened]');
      }
      lines.push(body);
      var ordersMore = ordersBlock();
      if (ordersMore) { lines.push(''); lines.push(ordersMore); }
      return lines.join('\n');
    }
    lines.push(AMBIENT_HEAD_CHECKIN);
    lines.push('[Avatar check-in - the patient\'s own words, chart ' + clean(kiosk.ambBound) + ']');
    /* THE CONSENT IS PART OF THE RECORD. A recording whose consent lives only
       in someone's memory is a recording nobody can defend later, so the
       confirmation and its clock time ride in the same block as the words it
       authorised. It is written from kiosk.consentAt, the same flag that gates
       the microphone - the transcript cannot claim a consent the kiosk did not
       actually have. */
    if (kiosk.consentAt) {
      lines.push('[Recording consent confirmed by practice staff at ' +
        safe(function () { return new Date(kiosk.consentAt).toLocaleString(); }, String(kiosk.consentAt)) +
        ', before any microphone was opened]');
    }
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
    /* the check-in has now reached the transcript, so a resumed capture must not
       lead with it again - see kioskAmbientBlock */
    kiosk.intakeFiled = true;
    /* THE BACKUP DIES ONLY ON A PROVEN WRITE. Every refusal above returns
       before this line, so a capture that could not be filed (wrong chart
       open, no transcript box on screen) keeps its crash copy and can still
       be recovered on the next load. By KEY: another chart's held capture must
       survive this one being filed - and THIS path is the live one, so the key is
       this capture's own binding. (An earlier version of this line said info.key
       here; there is no `info` in the live path - that identifier belongs to
       ambientRecoverFile - so it was a ReferenceError on every successful file,
       caught by the keyless-drop assertion in avatar-visit-copilot rather than by
       node --check, which cannot see an undefined identifier.) */
    ambientStoreDrop(ambientStoreKeyFor(kiosk.ambBound));
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
    /* the live-capture filter and the choice of WHICH held capture to offer both
       live in ambientStorePick now - see the comment there */
    var picked = ambientStorePick();
    if (!picked) return null;
    var rec = picked.rec;
    var body = (rec.parts || []).join(' ').replace(/[ \t]+/g, ' ').trim();
    if (!body) return null;
    var start = Number(rec.start) || 0, saved = Number(rec.savedAt) || 0;
    return {
      bound: clean(rec.bound), body: body, chars: body.length,
      words: body.split(/\s+/).filter(Boolean).length,
      /* the record's OWN key, so filing and discarding delete the capture the
         doctor acted on rather than whatever the store points at afterwards */
      key: picked.key,
      /* which SESSION took it - the only way ambientRecoverFile can tell whether the
         words it just filed are also sitting in this tab's kiosk.ambParts */
      sid: clean(rec.sid),
      /* how many captures are held in total. A second one belongs to another
         chart and would otherwise be invisible until someone opened that chart. */
      held: Number(picked.held) || 1,
      savedAt: saved, trimmed: rec.trimmed === true,
      mins: (start && saved && saved > start) ? Math.max(1, Math.round((saved - start) / 60000)) : 0,
      actions: Array.isArray(rec.actions) ? rec.actions : [],
      intake: Array.isArray(rec.intake) ? rec.intake : [],
      /* both persisted from av-5.7.1 - an OLDER record simply has neither, which
         reads as "consent not recorded" and "check-in not yet filed": the safe
         direction on both counts (it states the gap, and it errs toward including
         the check-in rather than losing it) */
      consentAt: Number(rec.consentAt) || 0,
      intakeFiled: rec.intakeFiled === true
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
    /* THE CHECK-IN GOES IN ONCE, ACROSS A RELOAD TOO. The live path tracks this
       with kiosk.intakeFiled, which is in-memory - so before the flag was
       persisted, a recovered capture led with the whole intake again and the
       patient's answers landed in the chart twice. */
    if (!info.intakeFiled) {
      lines.push(AMBIENT_HEAD_CHECKIN);
      lines.push('[Avatar check-in - the patient\'s own words, chart ' + info.bound + ']');
      /* AND IT CARRIES ITS CONSENT, or says it cannot. A recovered recording used
         to file with no attestation at all, which is the one thing this train
         exists to prevent - and silence reads as "nobody asked". */
      lines.push(info.consentAt
        ? ('[Recording consent confirmed by practice staff at ' +
            safe(function () { return new Date(info.consentAt).toLocaleString(); }, String(info.consentAt)) +
            ', before any microphone was opened]')
        : '[Recording consent: NOT RECORDED in the recovered file — confirm with the staff member who ran this check-in before relying on this transcript]');
      lines.push(intakeTextFrom(info.intake));
      lines.push('');
    }
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
      ambientStoreDrop(info.key);
      return { ok: true, chars: 0, already: true };
    }
    var prior = box.value;
    box.value = prior + (prior ? '\n\n' : '') + block;
    safe(function () { box.dispatchEvent(new Event('input', { bubbles: true })); });
    /* BY KEY: this recovered record, not whichever capture the store points at now -
       another chart may be holding one, and a keyless drop would delete that instead
       and leave this one to offer itself again forever. */
    ambientStoreDrop(info.key);
    /* AND THIS TAB MUST LEARN THAT ITS OWN WORDS ARE NOW FILED. Recovery files from
       the STORE and never touched the in-memory copy, so after a stop that failed to
       file, a recovery from the Visit card followed by the rest screen's hand-off tap
       carried the same sentences into the resumed capture - they are unfiled as far as
       kiosk.ambFiled knows - and filed the whole body a SECOND time. The record's own
       sid is what says whether these are this tab's words. */
    if (clean(info.sid) && clean(info.sid) === clean(kiosk.sid)) {
      kiosk.ambFiled = true;
      kiosk.intakeFiled = true;
    }
    return { ok: true, chars: block.length };
  }
  function kioskAmbientStart() {
    if (!kiosk.open) return false;
    if (kiosk.ambient) return true;
    /* NO CONSENT, NO MICROPHONE - and the gate is here rather than only on the
       button, because this function is reachable from the PIN pad, the review
       screen's "Keep listening" and the rest screen. A list of call sites is a
       denylist; the next one added would not be on it. */
    if (!kiosk.consentAt) {
      kioskSetSay('I cannot record this visit — recording consent was not confirmed.');
      kioskLine('alert', 'Staff: start the check-in again and confirm consent. Nothing is being recorded.');
      return false;
    }
    /* AND NOT WITHOUT A MICROPHONE. The preflight already knows the answer, and
       starting anyway paints the red "Recording this visit" banner and its
       ticking clock over a session that captures nothing - the one lie this
       feature must never tell. Chrome's recogniser makes this easy to get wrong:
       rec.start() SUCCEEDS on a denied microphone and only reports it later
       through onerror, where the retry loop treated it as an ordinary hiccup and
       tried again forever behind the banner. */
    if (kiosk.mic === false) {
      kioskSetSay('I cannot record this visit — the microphone is not available on this screen.');
      kioskLine('alert', 'Staff: nothing is being recorded. Allow the microphone for this site, then start the check-in again.');
      return false;
    }
    var bound = clean(kiosk.ext);
    if (!bound) {
      /* refuse BEFORE the microphone opens - an unbindable recording could
         only ever end in a refusal to write, so it must not be taken */
      kioskSetSay('I cannot record this visit - the screen is not bound to a chart.');
      kioskLine('alert', 'Staff: open the patient, then start the check-in again. Nothing is being recorded.');
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
    /* AN UNFILED CAPTURE IS NEVER DISCARDED BY STARTING A NEW ONE. Before the rest
       screen existed, a stop that failed to file left only the exit control, so the
       words stayed in memory and in the crash backup. Restoring the hand-off button
       on every stop created a one-tap path to this line - which used to reset
       ambParts and then immediately overwrite the backup with the empty new record,
       destroying the only copy of a consultation that had just failed to file.
       Whatever was captured and not filed is carried into the resumed capture. */
    var unfiled = !kiosk.ambFiled;
    var carried = (unfiled && Array.isArray(kiosk.ambParts) && kiosk.ambParts.length)
      ? kiosk.ambParts.slice() : [];
    /* THE ORDERS LEDGER IS CARRIED TOO (av-5.7.2). Carrying the words but not the
       actions was worse than carrying neither: the resumed capture's first backup
       write serialises ambientActionsForStore() - i.e. [] - straight over the
       stored record, so a prescription the doctor had CONFIRMED on screen, and
       which the review panel still listed under "confirmed and written into the
       note", vanished from memory and from the crash copy in the same tap. The
       resumed capture is the same room, the same visit and the same patient
       (openKiosk clears all of this between patients), so the ledger belongs to it. */
    var carriedActions = (unfiled && Array.isArray(kiosk.ambActions) && kiosk.ambActions.length)
      ? kiosk.ambActions.slice() : [];
    /* A RESUMED CAPTURE MUST NOT BE BORN DEAF. kiosk.paused is cleared only on the
       mount path (openKiosk), and neither the pause toggle nor the stop clears it -
       so pausing the interview, stopping, and then tapping the hand-off produced a
       capture whose recogniser kioskListen refuses to start while the screen said
       "Recording this visit" with a running clock. Nothing on screen contradicted it. */
    kiosk.paused = false;
    kiosk.ambParts = carried; kiosk.ambLast = ''; kiosk.ambFails = 0;
    kiosk.ambFiled = false; kiosk.ambResult = null; kiosk.ambRec = null;
    kiosk.ambActions = carriedActions; kiosk.ambWindow = ''; kiosk.ambClosing = false;
    kiosk.ambEnding = false; kiosk.ambSaveOk = null; kiosk.ambSaveTrim = false;
    kiosk.ambSavedAt = 0;
    pvStopVoice();
    /* pvStopVoice deliberately LEAVES pvSaying set, so the last question would
       stay the echo template and the self-echo filter would silently eat real
       speech built from its words. Ambient never speaks - drop the template,
       and the bounded tail with it: a room capture is verbatim, and a doctor
       who repeats the avatar's last question back to the patient must appear in
       the transcript. */
    pvSaying = '';
    pvEchoSaying = '';
    pvEchoDrop();
    if (kiosk.nudgeTimer) { safe(function () { clearTimeout(kiosk.nudgeTimer); }); kiosk.nudgeTimer = null; }
    if (kiosk.deadTimer) { safe(function () { clearTimeout(kiosk.deadTimer); }); kiosk.deadTimer = null; }
    kioskAmbientClear();
    var pad = gid('mlsAvKioskPin'); if (pad) pad.style.display = 'none';
    var row = gid('mlsAvKioskTypeRow'); if (row) row.style.display = 'none';
    /* explicitly, not by class: kioskRestShow sets an INLINE display, and an
       inline style outranks the .ambient rule that would otherwise hide it -
       the hand-off button would sit on screen through the whole recording. */
    var rest = gid('mlsAvKioskRest'); if (rest) rest.style.display = 'none';
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
    kioskLine('status', 'Finishing the recording and writing it to the transcript…');
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
    /* the hand-off button comes back BELOW, after the mood and the say line are
       written - see the end of this function. Calling it here put the 'resting'
       chip on screen one line before kioskMood('speaking') took it straight back
       off, so the screen read "Speaking", waveform animating, over a stopped
       recording. */
    kioskMood('speaking', 'thank you');
    var head = res.ok ? 'Recording stopped. The visit is in the doctor\'s transcript.'
                      : 'Recording stopped. Nothing was written.';
    if (reason === 'cap') {
      head = 'Recording stopped - the 90 minute limit was reached. ' +
        (res.ok ? 'The visit is in the doctor\'s transcript.' : 'Nothing was written.');
    }
    kioskSetSay(head);
    /* the filing OUTCOME is a status the staff must be able to read: it outranks the
       transcript, so a late recogniser result cannot wipe it a moment later (av-6.2.0) */
    kioskLine('status', res.ok
      ? ('Staff: ' + res.chars + ' characters filed to the visit transcript for chart ' + clean(kiosk.ambBound) + '.')
      : ('Staff: ' + (res.why || 'the capture could not be filed.')));
    /* NOW the hand-off comes back, after the mood/say/interim writes above rather
       than before them. It is also the LAST thing that touches the chip, so
       "Waiting for the doctor" is what actually stays on screen. */
    if (kiosk.completed) kioskRestShow();
    /* AND THE REASON SURVIVES. kioskAmbientNoMic writes its explanation and then
       calls this function on the next line, which used to overwrite both the say
       line and the interim synchronously - so the only sentence telling staff the
       microphone had been revoked never reached a paint. A caller that has already
       explained itself passes its line in, and it wins. */
    if (kiosk.ambSayOverride) {
      kioskSetSay(kiosk.ambSayOverride);
      if (kiosk.ambInterimOverride) {
        /* the caller explains the CAUSE; the OUTCOME is this function's to state, and
           it must be the measured one. Replacing the interim line wholesale erased a
           refusal and left a reassuring constant in its place.
           av-6.2.0: routed through the arbitrator as a STATUS, so a late transcript
           fragment cannot wipe a filing refusal the staff still need to read. */
        kioskLine('status', kiosk.ambInterimOverride + ' ' + (res.ok
          ? (res.chars + ' characters were filed to the visit transcript for chart ' + clean(kiosk.ambBound) + '.')
          : ('NOTHING was filed — ' + (res.why || 'the capture could not be filed.') +
             ' The words are still held in this browser and can be recovered from the chart.')));
      }
      kiosk.ambSayOverride = ''; kiosk.ambInterimOverride = '';
    }
    return kiosk.ambResult;
  }
  /* Split out of kioskEndForStaff so BOTH staff outcomes close the interview
     row server-side: leaving, and staying to record. See the comment on
     kioskEndForStaff for why an 'active' row that is never closed strands the
     patient's answers in every surface. */
  function kioskCloseServerSide() {
    /* A session that never had consent has no row to close - and asking the
       server to close it CREATES one. See the comment in kioskTurn. */
    if (!kiosk.consentAt) return;
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
    /* NOTHING HAS BEEN SAID TO *THIS* PATIENT YET. kioskTurn uses this to mark
       the opening line as a greeting so it is delivered as a welcome rather
       than as question four. Left un-reset it is a one-patient flag on a screen
       that sees a patient an hour: the FIRST check-in after a page load would be
       greeted warmly and every one after it would not, which is both the harder
       bug to notice and the one that affects almost every patient. */
    kiosk.spoke = false;
    /* consent is per PATIENT, so it resets with the screen. A carried-over
       flag would let the next patient be recorded on the last one's answer. */
    kiosk.consentAt = 0;
    /* and this patient's check-in has never been filed, whatever the last one
       did - see kioskAmbientBlock */
    kiosk.intakeFiled = false;
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
    /* mounted PRE-CONSENT: every other control is display:none until the consent
       question is answered, so the tab order contains exactly Yes and No */
    root.className = 'preconsent';
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
      /* av-5.7.0 - the hand-off: ONE button, mounted with the kiosk and shown
         only once the check-in is finished. See kioskRestShow. */
      '<div id="mlsAvKioskRest">' +
        '<button type="button" id="mlsAvKioskRoomGo">Doctor — start listening to the visit</button>' +
        '<div id="mlsAvKioskRestNote">One tap. The screen says it is recording the whole time, Pause stops it instantly, and “End visit &amp; review” writes the visit into the transcript.</div>' +
      '</div>' +
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
      '</div></div>' +
      /* av-5.7.0 - THE CONSENT GATE, mounted LAST so it sits over everything
         and shown by default. Owner: "when u start avatar it should say did the
         patient consent to recording then then u click yes and then it goes."
         It is also the trusted gesture the browser demands: fullscreen, the
         audio engine and the microphone prompt all need a click, and that
         prompt must land on the doctor rather than in front of the patient. */
      '<div id="mlsAvKioskConsent" role="dialog" aria-label="Recording consent"><div id="mlsAvKioskConsentCard">' +
        '<div id="mlsAvKioskConsentTitle">Did the patient consent to being recorded?</div>' +
        '<div id="mlsAvKioskConsentSub">Ask them out loud, in the room. The check-in listens to their voice, and if you choose to keep listening afterwards the visit itself is recorded too. Nothing is recorded — and no microphone is opened — until you tap Yes.</div>' +
        '<div id="mlsAvKioskConsentRow">' +
          '<button type="button" id="mlsAvKioskConsentYes">Yes — they consented</button>' +
          '<button type="button" id="mlsAvKioskConsentNo">No — cancel</button>' +
        '</div>' +
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
    root.querySelector('#mlsAvKioskRoomGo').addEventListener('click', function () {
      /* THE HAND-OFF, in one tap. See kioskRestShow.
         kiosk.mic IS A ONE-SHOT LATCH: it is written once, by the preflight on the
         consent tap, and never again. So a doctor who dismissed the permission
         prompt at the start of the check-in found the room recording permanently
         unavailable for the rest of the visit, with the new refusal telling him the
         microphone was not available and no way to change that answer. This tap is
         a fresh user gesture, which is exactly what a permission prompt needs, so
         it re-probes before refusing. */
      if (kiosk.mic === false) {
        kioskMicPreflight(function () {
          /* ⛔ TYPING IS NOT A FALLBACK FOR ROOM CAPTURE. The preflight above reveals the typing
             row on denial, which is right for the INTERVIEW — a patient can type answers. Here
             it is being used as a re-probe for the room recording, and if the microphone is
             refused again the row is left on the hand-off screen with nothing to type into:
             a visible input on a surface where input does nothing, next to an alert saying
             nothing is being recorded. Hide it again when the re-probe fails.
             (Only when it FAILED — a granted re-probe leaves the interview's own state alone.)
             ⚠️ Do NOT name the preflight function in this comment: avatar-doctor-runtime.test.js
             COUNTS textual occurrences inside openKiosk and requires exactly one, to prove the
             open path never touches the microphone before the consent answer. A mention in prose
             reads as a second call site. Seventh time today a text-matching check has flagged my
             own comment — the guard is right, the wording is what has to give. */
          if (kiosk.mic === false) {
            var tr = gid('mlsAvKioskTypeRow');
            if (tr) safe(function () { tr.style.display = 'none'; });
          }
          kioskAmbientStart();
        });
        return;
      }
      kioskAmbientStart();
    });
    root.querySelector('#mlsAvKioskConsentYes').addEventListener('click', kioskConsentYes);
    root.querySelector('#mlsAvKioskConsentNo').addEventListener('click', kioskConsentNo);
    /* put the keyboard INSIDE the card. Without this the focus stays wherever it
       was in the doctor's app, and Tab walks his own page - which is how the
       controls behind an "impassable" overlay turned out to be reachable. */
    safe(function () { root.querySelector('#mlsAvKioskConsentYes').focus(); });
    /* the LIVING face */
    kiosk.face = makeFace(gid('mlsAvKioskFace'), kiosk.look || null);
    kioskState('ready');
    kioskSetSay('One more thing before we start.');
    /* NOTHING ELSE HAPPENS HERE. Fullscreen, the audio engine, the microphone
       prompt and the first turn all used to run on this click - which meant the
       microphone was opened, and the patient was being listened to, before
       anyone had been asked whether that was allowed. They now run on the
       consent answer, which is a click of its own and therefore just as
       trusted a gesture. See kioskConsentYes. */
  }
  /* av-5.7.0 - CONSENT, THEN EVERYTHING ELSE. The Yes tap carries three jobs
     that all need a user gesture and were previously spent on the Start click:
     true fullscreen, the audio context the lip-sync analyser needs, and the
     microphone permission prompt (which must reach the DOCTOR, never the
     patient mid-interview). */
  function kioskConsentYes() {
    if (!kiosk.open || kiosk.consentAt) return;
    kiosk.consentAt = Date.now();
    var pad = gid('mlsAvKioskConsent'); if (pad) pad.style.display = 'none';
    /* the rest of the kiosk becomes reachable only now */
    var rootNow = gid('mlsAvKiosk'); if (rootNow) rootNow.classList.remove('preconsent');
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
    safe(function () { ttsFetchUrl(NUDGE_LINE, null, 'calm'); });
    kioskSetSay('Getting ready…');
    kioskMicPreflight(function () { kioskTurn(null, null); });
  }
  /* Refused: no microphone was ever opened, no turn was ever posted, and there
     is no server row to close - the session id was never used. The kiosk closes
     with nothing recorded and says exactly that. */
  function kioskConsentNo() {
    if (!kiosk.open) return;
    safe(function () { if (isFn(window.toast)) window.toast('Check-in cancelled — nothing was recorded.', ''); });
    kioskClose('no-consent');
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
    /* the note is DRAFTED from this transcript, so an unverified summary must
       carry its verdict here too - see auditNote; and the flag and the bullets
       must arrive with it, or the note is drafted from the half of the brief
       that carries no red flag at all - see briefLines */
    var block = stamp + '\n' + auditNote(checkin.audited) + '\n' + briefLines(checkin) + String(checkin.summary || '').trim() + '\n';
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
    /* av-6.0.8 — UNCONDITIONAL, because this card may have been created by someone else.
       The loader in mls-connect.js paints an instant skeleton under this exact id (owner:
       "this top thing show shoup uop right away not take a secod" — this module is the ~52nd
       of ~100 serially-loaded deferred assets, so the real card was tens of seconds late).
       style() is id-guarded and idempotent, but it used to be called ONLY on the create
       branch — adopting a skeleton would therefore have skipped it and left every
       .mlsAvAction button in this card unstyled. */
    style();
    var CARD_BOX = 'margin:8px 2px 12px;padding:12px 14px;border:1px solid #E7E5DD;border-radius:12px;background:#FCFBF8;font-family:\'Public Sans\',system-ui,sans-serif';
    if (card && card.getAttribute('data-mls-av-skeleton')) {
      /* take ownership: drop the placeholder's click-to-hurry handler by replacing the node's
         guts, and re-assert the canonical box so the skeleton's copy can never drift from it */
      safe(function () { card.removeAttribute('data-mls-av-skeleton'); });
      safe(function () { card.style.cssText = CARD_BOX; });
      safe(function () { card.removeAttribute('data-mls-av-sig'); });
    }
    if (!card) {
      card = document.createElement('div');
      card.id = 'mlsAvVisitCard';
      card.style.cssText = CARD_BOX;
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
    /* ⛔ TWO MODULES WERE CLAIMING visitView.firstElementChild (av-6.0.2).
       Owner, on a screenshot of the Visit page: "where did that start avatar thing in the top
       go I loved that."
       feat_mls_calm_shell.js:2437 re-asserts the Prep/Record/Review/Sign/Send rail as
       `visit.firstElementChild` "every pass, because ez3 re-inserts itself on its own
       schedule and winning the race once is not the same as staying first" — and it is there
       because the owner ALSO complained that the rail was in the wrong spot. So both of his
       requirements are real and they were competing for one slot, which no amount of
       re-asserting can settle: whoever runs last wins and the other one moves.
       The slot is not the point. The rail goes first, this card goes DIRECTLY BELOW IT, and
       neither has to win a race. `wantAfter` resolves the rail by id if it is present and
       falls back to the very top when it is not, so this is correct on a build without the
       rail too. */
    var focusInCard = safe(function () { return card.contains(document.activeElement); }, false);
    if (!focusInCard) {
      var rail = safe(function () { return view.querySelector('#mlsStages'); }, null);
      var wantAfter = (rail && rail.parentNode === view) ? rail.nextElementSibling : view.firstElementChild;
      if (card !== wantAfter && card.previousElementSibling !== rail) {
        safe(function () { view.insertBefore(card, wantAfter); });
      }
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
    /* the signature must include EVERY fact the card draws, or the card will not
       repaint when only that fact changed. `audited` is the case that matters: the
       verdict is written by a second model AFTER the row goes ready, so it arrives
       on a later poll with the id, count and chart all identical - and the card
       would keep painting the unverified summary as if nothing had been decided.
       headline and bullet count are here for the same reason. */
    var sig = (activeHit ? 'a' + activeHit.id + ':' + clean(activeHit.audited) +
        ':' + String(activeHit.headline || '').length +
        ':' + (Array.isArray(activeHit.bullets) ? activeHit.bullets.length : 0) : 'n') + '|' + total + '|' + activeId +
      /* pend.held is in the signature, or a SECOND held capture appearing would
         not rebuild the card and its line would never be drawn */
      '|' + (pend ? 'r' + pend.bound + ':' + pend.chars + ':' + pend.held : 'r0');
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
      /* A SECOND HELD CAPTURE MUST NOT BE INVISIBLE. Captures are now kept per
         chart, so more than one can be waiting; this panel can only offer the one
         it picked. Before the per-chart keys the extra ones did not exist at all -
         each new recording overwrote the last - so silence here would read as
         "nothing else is waiting" when a whole other consultation is. */
      if (pend.held > 1) {
        var moreLine = make('div', '',
          (pend.held - 1) + ' other recorded visit' + (pend.held - 1 === 1 ? '' : 's') +
          ' ' + (pend.held - 1 === 1 ? 'is' : 'are') + ' also held for other charts. ' +
          'Open the chart it belongs to and this panel will offer it.');
        moreLine.style.cssText = 'font:600 11.5px/1.45 system-ui;color:#7a1f16;margin-top:3px';
        rec.appendChild(moreLine);
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
        ambientStoreDrop(pend.key);
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
      /* av-5.7.0: the HEADLINE leads here too. This card is the surface the
         doctor is already looking at when he opens the visit, so the brief has
         to arrive here or it may as well not exist. */
      if (activeHit.headline) {
        /* A REJECTED SUMMARY MUST NOT BE PAINTED REASSURINGLY. The flag class was
           chosen from the HEADLINE's leading ⚠ alone, which the server writes for
           clinical red flags - so an unverified brief with a calm headline arrived
           in the same green block as a verified one. The audit verdict is an
           independent fact from the clinical one and now colours the block too. */
        var rejectedBrief = clean(activeHit.audited) === 'rejected';
        card.appendChild(make('div', 'mlsAvBrief' +
          ((rejectedBrief || /^⚠/.test(String(activeHit.headline))) ? ' flag' : ''),
          String(activeHit.headline)));
      }
      /* the verdict itself, on the surface the doctor reads before the room. All four
         states were rendering byte-identically here: `audited` was added to this
         card's own cache payload by av-5.7.0 and then read by nothing. */
      card.appendChild(make('div', 'mlsAvMeta' + (clean(activeHit.audited) === 'rejected' ? ' flag' : ''),
        clean(activeHit.audited) === 'rejected'
          ? '⚠ The AI audit REJECTED this summary — it could not be reconciled with the patient\'s answers. Read the check-in before relying on it.'
          : (clean(activeHit.audited) === 'corrected' ? 'AI audit: corrected against the patient\'s answers.'
            : (clean(activeHit.audited) === 'passed' ? 'AI audit: checked against the patient\'s answers.'
              : 'AI audit: no verdict recorded for this check-in.'))));
      if (Array.isArray(activeHit.bullets) && activeHit.bullets.length) {
        var ul = make('ul', 'mlsAvBullets');
        activeHit.bullets.forEach(function (bullet) {
          ul.appendChild(make('li', /^⚠/.test(String(bullet)) ? 'flag' : '', String(bullet)));
        });
        card.appendChild(ul);
      }
      var actions = make('div', 'mlsAvActions');
      actions.style.marginTop = '9px';
      /* `audited` MUST be on this object. Both write paths stamp the verdict beside
         the words now (auditNote), and this hand-built copy was the one place it was
         dropped - so a REJECTED summary filed from the Visit card, the surface the
         doctor actually uses, would have been stamped "no verdict recorded". */
      /* THE FLAG, THE HEADLINE AND THE BULLETS MUST BE ON THIS OBJECT TOO. briefLines
         reads them, and this hand-built copy is what the Visit card's two file buttons
         hand it - so a check-in the server flagged would have been filed from the one
         surface the doctor actually uses with the ⚠ dropped by construction. */
      var detail = { id: activeHit.id, patient_external_id: activeHit.patient_external_id, ready_at: activeHit.ready_at, summary: activeHit.summary || null, audited: activeHit.audited || null,
        headline: activeHit.headline || null, bullets: Array.isArray(activeHit.bullets) ? activeHit.bullets : [], flags: Array.isArray(activeHit.flags) ? activeHit.flags : [] };
      var needSummary = !detail.summary || activeHit.truncated === true || activeHit.bulletsTruncated === true;
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
            /* the refetch is the FRESHER verdict - an audit that finished after the
               cache row was built arrives here and must not be thrown away */
            detail.audited = found.audited || detail.audited || null;
            /* and the fresher brief: the whole reason this refetch can be demanded by
               bulletsTruncated is to replace the three-bullet display sample with all
               six, so taking the summary and leaving the bullets behind would have
               made the refetch pointless for exactly the rows that needed it */
            detail.headline = found.headline || detail.headline || null;
            if (Array.isArray(found.bullets)) detail.bullets = found.bullets;
            if (Array.isArray(found.flags)) detail.flags = found.flags;
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

  /* ---- THE AVATAR IN SETTINGS (av-5.7.5) --------------------------------------
     Owner: "add avatar to settings like I like the set up thing to start but add it to
     settings so u can chagne it whenever and easily found."
     The setup wizard stays exactly where it was; this is a second door, and the door
     that is always there. Before this, the only way back into the questions, the voice
     and the face was the Visit card's "Set up" button, which renders only when the open
     patient has NO completed check-in - so the more the practice used the feature, the
     harder it became to change it.
     THE SAME FORM, NOT A COPY. setupForm() owns that markup; a second set of controls
     in ScribeFlow.html would be a second source of truth for the questions a patient is
     asked, and two sources of truth for clinical questions drift.
     MOUNTED LAZILY AND ONCE PER OPEN. setupForm fetches /api/avatar/config, so it must
     not run on every reconcile - that event fires on any Settings mutation. */
  var settingsMountedFor = 0;
  function mountAvatarSettings(open) {
    var host = gid('mlsAvSettingsHost');
    if (!host) return;                       /* an older ScribeFlow without the section */
    if (!open) { settingsMountedFor = 0; return; }
    /* ⛔ THE LATCH IS NOT THE AUTHORITY — THE DOM IS (av-6.0.7).
       Owner, on a screenshot of Settings > Check-in avatar showing nothing but the static
       placeholder: "Its not acatlly there."
       `if (settingsMountedFor) return;` is a one-shot latch that only ever resets when this
       function is called with open === false. TWO ordinary paths leave it set with no form on
       screen, and both end in the placeholder sitting there forever:
         1. Settings is closed WITHOUT a reconciled event carrying open:false — nothing resets
            the latch, so the next open returns early and never mounts.
         2. setupForm THROWS. It is called inside safe(), which swallows the throw by design,
            but the latch was already set one line earlier — so the failure is permanent and
            silent, and the doctor sees "Opening your avatar setup…" for the rest of the tab's
            life with no way to retry.
       The original intent is still honoured and is the reason this is not simply unconditional:
       a MOUNTED form must never be re-rendered under the doctor's fingers, because that would
       discard an edit he had not saved. But "mounted" is a fact about the DOM, not about a
       variable — a host that holds no control at all cannot be holding an unsaved edit. */
    var hasForm = safe(function () { return !!host.querySelector('input,select,textarea'); }, false);
    if (settingsMountedFor && hasForm) return;
    settingsMountedFor = Date.now();
    safe(function () { setupForm(host); });
  }
  /* whether the settings modal is on screen right now, read from the modal itself rather than
     from an event we may have missed — see mountAvatarSettings */
  function settingsOpenNow() {
    return safe(function () {
      var modal = gid('settingsModal');
      if (!modal) return false;
      if (modal.classList && modal.classList.contains('show')) return true;
      /* "exists" and "visible" are independent facts: a modal shown by inline style rather
         than a class is still open, and this panel is reachable that way. */
      var host = gid('mlsAvSettingsHost');
      return !!(host && host.offsetParent !== null);
    }, false);
  }
  function onSettingsReconciled(ev) {
    var open = !!(ev && ev.detail && ev.detail.open);
    /* the organizer tells us; when it is absent, fall back to the modal's own class -
       "exists" and "open" are independent facts and neither implies the other */
    if (!ev || !ev.detail) {
      var modal = gid('settingsModal');
      open = !!(modal && modal.classList && modal.classList.contains('show'));
    }
    mountAvatarSettings(open);
  }

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
        /* AND THE SETTINGS PANEL, from the same ladder (av-6.0.7). Its mount was driven by the
           mls:settings-reconciled event and NOTHING ELSE, so a settings modal opened by any
           route that does not emit that event showed the static placeholder forever. This rung
           asks the modal itself whether it is open, and mountAvatarSettings is now idempotent
           against a mounted form, so calling it here cannot re-render over an unsaved edit. */
        if (settingsOpenNow()) mountAvatarSettings(true);
        if (index === all.length - 1) refreshCount(false);
      }, delay));
    });
  }
  function onLifecycle() {
    scheduleEnsure(); refreshCount(false); ensureVisitCard();
    /* a view or account change can happen with Settings already open — see mountAvatarSettings */
    if (settingsOpenNow()) mountAvatarSettings(true);
  }
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
    /* the Settings organizer's one canonical lifecycle signal - documented there as
       existing precisely so a small augmentation like this does not have to install its
       own page-wide observer or poll */
    safe(function () {
      window.addEventListener('mls:settings-reconciled', onSettingsReconciled, false);
      lifecycleBound.push(['mls:settings-reconciled', onSettingsReconciled]);
    });
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
    /* av-6.1.0 RECEIPT for the voice gate. "Echo cancellation is on" is a claim; this is the
       evidence, read back from the live track rather than from the constraint we asked for.
       ready:false with a `why` is the honest state on a device that cannot do it - and in that
       state every turn-taking decision falls back to the string gate. Also reports how many
       finals were refused as echo, so a filed-echo problem can be counted instead of argued. */
    voiceGate: function () {
      var r = pvVoiceGateReport();
      r.echoFinalsRefused = (kiosk && kiosk.echoRefused) || 0;
      return r;
    },
    voiceGateStart: function (then) { return pvVoiceGateStart(then); },
    voiceGateStop: function () { return pvVoiceGateStop(); },
    otherVoiceNow: function () { return pvOtherVoiceNow(); },
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
    /* discards the capture currently being OFFERED, by its own key - never
       "whatever the store points at", which is how another chart's held
       recording would be deleted by a discard aimed at this one */
    discardRecoveredCapture: function () {
      var info = safe(function () { return ambientRecoverInfo(); }, null);
      if (!info) return false;
      ambientStoreDrop(info.key);
      return true;
    },
    refreshCount: refreshCount,
    exactPatient: exactPatient,
    importSummary: importSummary,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})();
