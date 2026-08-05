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

  var VERSION = 'av-1.1.0';
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

  /* ---- event-driven badge refresh (no polling) ---- */
  var lastRefreshAt = 0, refreshInFlight = false;
  function refreshCount(force) {
    if (refreshInFlight) return;
    var now = Date.now();
    if (!force && (now - lastRefreshAt) < REFRESH_MIN_MS) return;
    if (!token()) return;
    refreshInFlight = true; lastRefreshAt = now;
    api('/api/avatar/checkins?status=ready').then(function (r) {
      refreshInFlight = false;
      if (r.ok && r.json && Array.isArray(r.json.checkins)) setCount(r.json.checkins.length);
    }, function () { refreshInFlight = false; });
  }

  function close() {
    var back = gid(BACK_ID);
    if (back && back.parentNode) back.parentNode.removeChild(back);
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(event) { if (event.key === 'Escape') close(); }
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
    if (!patient) return;
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
      var nameLabel = make('label', '', 'Avatar name (what patients see)');
      var nameInput = make('input'); nameInput.value = cfg.name || 'Ava'; nameInput.maxLength = 60;
      var introLabel = make('label', '', 'Greeting line (optional)');
      var introInput = make('input'); introInput.value = cfg.intro || ''; introInput.maxLength = 400;
      introInput.placeholder = 'e.g. A few quick questions before your visit with Dr. Schaeffer.';
      var qLabel = make('label', '', 'Questions the avatar asks — ONE PER LINE, in order (up to 20)');
      var qArea = make('textarea'); qArea.rows = 9;
      qArea.value = Array.isArray(cfg.questions) ? cfg.questions.join('\n') : '';
      qArea.placeholder = 'What brings you in today?\nHow bad is the pain on a 0-10 scale?\nAny new medications or allergies since your last visit?';
      var saveBtn = make('button', 'mlsAvAction primary', 'Save avatar');
      saveBtn.type = 'button';
      var status = make('div', 'mlsAvMeta', '');
      saveBtn.addEventListener('click', function () {
        var questions = qArea.value.split('\n').map(function (line) { return line.trim(); }).filter(Boolean).slice(0, 20);
        saveBtn.disabled = true; status.textContent = 'Saving…';
        api('/api/avatar/config', { method: 'POST', body: JSON.stringify({ name: nameInput.value.trim() || 'Ava', intro: introInput.value.trim(), questions: questions }) })
          .then(function (r2) {
            saveBtn.disabled = false;
            status.textContent = (r2.ok && r2.json && r2.json.ok)
              ? (questions.length ? ('Saved — the avatar now asks ' + questions.length + ' question' + (questions.length === 1 ? '' : 's') + '. Patients see it in their portal.') : 'Saved, but with no questions the check-in stays OFF for patients.')
              : 'Could not save — check your connection and try again.';
          }, function () { saveBtn.disabled = false; status.textContent = 'Could not save — check your connection and try again.'; });
      });
      form.appendChild(nameLabel); form.appendChild(nameInput);
      form.appendChild(introLabel); form.appendChild(introInput);
      form.appendChild(qLabel); form.appendChild(qArea);
      form.appendChild(saveBtn); form.appendChild(status);
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
      if (status === 'ready') setCount(rows.length);
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
    inboxList(body, 'ready');
  }

  /* ---- mount (event-driven, bounded retry ladder — no permanent polling) ---- */
  var retryTimers = [], lifecycleBound = [], visBound = false;
  function scheduleEnsure() {
    [0, 160, 420, 900, 1800, 3200].forEach(function (delay) {
      retryTimers.push(setTimeout(function () { ensureButton(); }, delay));
    });
  }
  function onLifecycle() { scheduleEnsure(); refreshCount(false); }
  function onVisibility() { if (!document.hidden) refreshCount(false); }
  function boot() {
    scheduleEnsure();
    ['mls:ui-ready', 'mls:topbar-ready', 'mls:header-rendered'].forEach(function (name) {
      safe(function () { window.addEventListener(name, onLifecycle, false); lifecycleBound.push([name, onLifecycle]); });
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
