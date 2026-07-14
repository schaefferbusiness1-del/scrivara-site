/* feat_nextup_connect.js -- exact verified schedule snapshot -> top visit UI
 *
 * The backend calendar may also contain manual or legacy MLS rows, so the top
 * Choose / Next Up / Agenda surfaces must not blindly re-expand a verified
 * Athena pull from window._calAppts. When __mlsSI has an authoritative
 * day/provider snapshot, this module feeds only that exact backend-id slice to
 * the existing renderer. Unclassified rows remain stored and are surfaced as
 * a count; this module never deletes or writes appointments.
 */
;(function () {
  'use strict';
  var VERSION = 'nextup-2.0.0';
  try { if (window.__mlsNextUp && window.__mlsNextUp.version === VERSION) return; } catch (e) { }
  var previousApi = safe(function () { return window.__mlsNextUp || null; }, null);

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(fn) { return typeof fn === 'function'; }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }

  function todayKey() {
    var dbg = safe(function () { return window.__mlsNextUpDebugDate || (window.sessionStorage && sessionStorage.getItem('__mlsNextUpDebugDate')); }, '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(dbg || ''))) return String(dbg);
    var n = new Date();
    return n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2);
  }
  function localDateOf(a) {
    if (a && a.appt_date) return String(a.appt_date).slice(0, 10);
    return safe(function () {
      if (!a || !a.start_at) return '';
      var d = new Date(a.start_at);
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }, '');
  }
  function patientDob(name) {
    return safe(function () {
      var pts = (isFn(window.getPatients) ? window.getPatients() : []) || [];
      var key = String(name || '').trim().toLowerCase();
      if (!key) return '';
      var matches = pts.filter(function (x) { return String(x && x.name || '').trim().toLowerCase() === key; });
      /* A display name is not identity proof. Use this legacy DOB fallback only
         when exactly one local patient has that name. Authoritative appointment
         rows normally already carry their exact patient DOB. */
      return matches.length === 1 ? (matches[0].dob || matches[0].DOB || matches[0].birthDate || '') : '';
    }, '');
  }
  function authoritativeRows(day) {
    return safe(function () {
      var si = window.__mlsSI;
      if (!si || !isFn(si.authoritativeRowsForDay)) return null;
      var rows = si.authoritativeRowsForDay(day);
      return Array.isArray(rows) ? rows : null;
    }, null);
  }
  function authoritativeStatus(day) {
    return safe(function () {
      var si = window.__mlsSI;
      return si && isFn(si.authoritativeStatusForDay) ? si.authoritativeStatusForDay(day) : null;
    }, null);
  }
  function toHeroRows(src, day) {
    var out = [], hhmm = isFn(window._apptHHMMTz) ? window._apptHHMMTz : function () { return ''; };
    var labelOf = isFn(window._calLabelOf) ? window._calLabelOf : function () { return ''; };
    (src || []).forEach(function (a) {
      a = a || {}; if (localDateOf(a) !== day) return;
      var name = String(a.name || labelOf(a) || '').trim(); if (!name) return;
      if (safe(function () { return window.__mlsStaffMark && isFn(window.__mlsStaffMark.isStaff) && window.__mlsStaffMark.isStaff(name); }, false)) return;
      var dob = a.dob || patientDob(name);
      out.push({
        id: a.id,
        name: name,
        time: hhmm(a.start_at),
        reason: a.reason || '',
        provider: a.provider || '',
        patient_external_id: a.patient_external_id || '',
        dob: dob || '',
        start_at: a.start_at,
        appt_date: a.appt_date
      });
    });
    return out;
  }
  function buildToday() {
    var day = todayKey(), exact = authoritativeRows(day);
    return toHeroRows(exact !== null ? exact : (window._calAppts || []), day);
  }

  function renderUnclassifiedNote() {
    safe(function () {
      var status = authoritativeStatus(todayKey()), note = gid('mlsScheduleUnclassifiedNote');
      var count = status && status.available ? Number(status.unclassifiedCount || 0) : 0;
      if (!count) { if (note) note.hidden = true; return; }
      if (!note && document.createElement) {
        note = document.createElement('div'); note.id = 'mlsScheduleUnclassifiedNote'; note.setAttribute('role', 'status');
        note.style.cssText = 'margin:8px auto 0;max-width:720px;padding:7px 10px;border:1px solid #d8d2c5;border-radius:9px;background:#faf8f2;color:#4b514c;font-size:12px;line-height:1.35;';
        var anchor = gid('heroToday') || gid('heroTodayBox') || gid('heroPickPatient');
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(note, anchor.nextSibling);
        else (document.body || document.documentElement).appendChild(note);
      }
      if (!note) return;
      note.hidden = false;
      note.textContent = count + ' calendar row' + (count === 1 ? ' is' : 's are') + ' kept outside this verified Athena selection.';
    });
  }

  var guardedRenderer = null;
  function installRendererGuard() {
    var current = safe(function () { return window._renderTodayPatients; }, null);
    if (!isFn(current) || current.__mlsAuthoritativeScheduleGuard) return !!(current && current.__mlsAuthoritativeScheduleGuard);
    var original = current;
    var wrapper = function (rows) {
      var exact = authoritativeRows(todayKey());
      var chosen = exact !== null ? toHeroRows(exact, todayKey()) : rows;
      if (exact !== null) window._heroTodayList = chosen.slice();
      var result = original.apply(this, [chosen]);
      renderUnclassifiedNote();
      return result;
    };
    safe(function () { Object.keys(original).forEach(function (key) { if (/^__/.test(key) && key !== '__orig') wrapper[key] = original[key]; }); });
    wrapper.__mlsAuthoritativeScheduleGuard = true;
    wrapper.__orig = original;
    guardedRenderer = wrapper;
    window._renderTodayPatients = wrapper;
    return true;
  }

  function renderFromCalendar() {
    safe(function () {
      installRendererGuard();
      if (!isFn(window._renderTodayPatients)) return;
      window._renderTodayPatients(buildToday());
      var name = gid('heroPtName'), nameEmpty = !name || !String(name.value || '').trim();
      if (nameEmpty && isFn(window._calLoadNextUp)) window._calLoadNextUp();
      var dob = gid('heroPtDob');
      if (dob && !String(dob.value || '').trim() && name && String(name.value || '').trim()) {
        var storedDob = patientDob(name.value); if (storedDob) dob.value = storedDob;
      }
      renderUnclassifiedNote();
    });
  }

  var loading = false;
  function ensureToday(force) {
    safe(function () {
      var status = authoritativeStatus(todayKey());
      var need = !!force || (!!status && status.reason === 'backend-rows-pending') || ((!status || status.reason === 'no-snapshot') && (!window._calAppts || !window._calAppts.length));
      var haveToken = isFn(window.bkToken) && window.bkToken();
      if (need && haveToken && isFn(window.loadCalendar) && !loading) {
        loading = true;
        Promise.resolve(window.loadCalendar()).catch(function () { }).then(function () { loading = false; renderFromCalendar(); });
      } else renderFromCalendar();
    });
  }
  function signature() {
    return safe(function () {
      var day = todayKey(), status = authoritativeStatus(day), src = authoritativeRows(day);
      if (src === null) src = (window._calAppts || []).filter(function (a) { return localDateOf(a) === day; });
      var parts = src.map(function (a) { return String(a && a.id || '') + '#' + String(a && a.dob || '') + '#' + String(a && (a.start_at || a.appt_date) || ''); }).sort();
      var hero = (window._heroTodayList || []).map(function (a) { return String(a && a.id || '') + '#' + String(a && a.name || '') + '#' + String(a && (a.start_at || a.time) || ''); }).sort();
      return day + '|' + (status && status.reason || 'raw') + '|' + (status && status.unclassifiedCount || 0) + '|' + parts.join(',') + '|hero:' + hero.join(',');
    }, '');
  }
  var lastSignature = ' ';
  function tick() {
    installRendererGuard();
    var now = signature(); if (now !== lastSignature) { lastSignature = now; renderFromCalendar(); }
  }
  function start() {
    installRendererGuard(); ensureToday(false);
    setTimeout(function () { ensureToday(false); }, 1200);
    setTimeout(function () { ensureToday(false); }, 4000);
    setInterval(tick, 1500);
    safe(function () { window.addEventListener('mls-authoritative-schedule', function () { lastSignature = ' '; ensureToday(false); }); });
  }
  function revert() {
    safe(function () { if (window._renderTodayPatients === guardedRenderer && guardedRenderer.__orig) window._renderTodayPatients = guardedRenderer.__orig; });
    safe(function () { if (previousApi) window.__mlsNextUp = previousApi; else window.__mlsNextUp.__installed = false; });
  }

  window.__mlsNextUp = {
    __installed: true,
    version: VERSION,
    _buildToday: buildToday,
    _render: renderFromCalendar,
    _ensure: ensureToday,
    _patientDob: patientDob,
    _todayKey: todayKey,
    _installRendererGuard: installRendererGuard,
    reload: function () { ensureToday(true); },
    revert: revert
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
