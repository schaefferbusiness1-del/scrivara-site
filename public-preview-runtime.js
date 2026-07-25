/* MLS public synthetic preview runtime.
 *
 * This file is intentionally inert unless public-preview-policy.js has already
 * installed the exact immutable, memory-only preview contract. It must be
 * loaded after ScribeFlow's main inline app script and before the MLS UI bundle
 * loader. Normal MLS sessions receive no listeners, globals, storage writes,
 * styles, or DOM changes from this file.
 */
(function (window, document) {
  'use strict';

  var config = window.__MLS_PUBLIC_PREVIEW;
  if (!config || config.enabled !== true ||
      config.mode !== 'synthetic-read-only' ||
      config.storageMode !== 'memory' ||
      config.memoryStorageReady !== true ||
      window.__MLS_SYNTHETIC_ONLY !== true) return;

  /* A public preview must never inherit hosted mode. Refuse to seed even the
     memory facade if the page did not disable its backend first. */
  try {
    if (typeof backendMode !== 'function' || backendMode() !== false) return;
  } catch (backendError) { return; }

  var VERSION = 'preview-runtime-1.0.0';
  var EMAIL = 'preview@synthetic.invalid';
  var ACCOUNT_PREFIX = 'sf_u::' + EMAIL + '::';
  var SOURCE = 'mls-public-preview-synthetic';
  var MONTH_SOURCE = 'mls-public-preview-synthetic-month';
  var DAY_SOURCE = 'mls-public-preview-synthetic-day';
  var STRIP_ID = 'mlsPublicPreviewStrip';
  var STYLE_ID = 'mlsPublicPreviewStyle';
  var STATUS_ID = 'mlsPublicPreviewStatus';
  var ready = false;
  var observer = null;
  var currentPatients = [];
  var currentNotes = [];
  var baseAppointments = [];

  function pad2(value) { value = String(value); return value.length < 2 ? '0' + value : value; }
  function keyOf(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }
  function parseDay(day) {
    var parts = String(day || '').split('-');
    return new Date(+parts[0], +parts[1] - 1, +parts[2], 12, 0, 0, 0);
  }
  function plusDays(day, amount) {
    var date = parseDay(day); date.setDate(date.getDate() + amount); return keyOf(date);
  }
  function todayKey() {
    try {
      if (typeof session !== 'undefined' && session &&
          String(session.email || '').toLowerCase() === EMAIL &&
          typeof _acctTodayKey === 'function') return _acctTodayKey();
    } catch (e) {}
    /* The first seed happens before startSession adopts the sample account, so
       use the same explicit timezone that the seed will give that account. */
    try {
      var parts = {}, formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      formatted.forEach(function (part) { parts[part.type] = part.value; });
      if (parts.year && parts.month && parts.day) return parts.year + '-' + parts.month + '-' + parts.day;
    } catch (e2) {}
    return keyOf(new Date());
  }
  function ymOf(day) { return String(day || '').slice(0, 7); }
  function monthLastDay(ym) {
    var parts = String(ym || '').split('-');
    return new Date(+parts[0], +parts[1], 0, 12, 0, 0, 0).getDate();
  }
  function timestamp(day, hour) {
    var date = parseDay(day); date.setHours(hour || 12, 0, 0, 0); return date.getTime();
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function samplePatients(today) {
    var priorA = plusDays(today, -28), priorB = plusDays(today, -9);
    return [
      {
        id: 'preview-patient-001', name: 'Sample Patient One', dob: '1975-01-15',
        mrn: 'SAMPLE-001', sex: 'Female', phone: '555-0101', source: SOURCE,
        problems: 'Sample lumbar pain; sample hypertension', meds: 'Sample medication 10 mg daily',
        allergies: 'No sample allergies documented',
        summary: 'SAMPLE DATA ONLY. Fictional follow-up history used to demonstrate the MLS workspace. No information came from Athena.',
        visits: [
          { date: priorB, type: 'Sample follow-up', cpt: ['99213'], aiSummary: 'Fictional symptoms improved with the sample home program.', source: SOURCE },
          { date: priorA, type: 'Sample consultation', cpt: ['99203'], aiSummary: 'Fictional initial evaluation and conservative plan.', source: SOURCE }
        ], created: timestamp(priorA), updated: timestamp(priorB)
      },
      {
        id: 'preview-patient-002', name: 'Sample Patient Two', dob: '1968-04-22',
        mrn: 'SAMPLE-002', sex: 'Male', phone: '555-0102', source: SOURCE,
        problems: 'Sample knee osteoarthritis', meds: 'Sample topical medication as needed',
        allergies: 'Sample allergy: adhesive',
        summary: 'SAMPLE DATA ONLY. Fictional prior knee visit for product evaluation. No information came from Athena.',
        visits: [{ date: plusDays(today, -14), type: 'Sample follow-up', cpt: ['99213'], aiSummary: 'Fictional imaging and activity plan reviewed.', source: SOURCE }],
        created: timestamp(plusDays(today, -45)), updated: timestamp(plusDays(today, -14))
      },
      {
        id: 'preview-patient-003', name: 'Sample Patient Three', dob: '1982-09-03',
        mrn: 'SAMPLE-003', sex: 'Female', phone: '555-0103', source: SOURCE,
        problems: 'Sample shoulder pain', meds: '', allergies: 'NKDA (sample)',
        summary: 'SAMPLE DATA ONLY. Fictional shoulder history for product evaluation. No information came from Athena.',
        visits: [], created: timestamp(plusDays(today, -18)), updated: timestamp(plusDays(today, -4))
      },
      {
        id: 'preview-patient-004', name: 'Sample Patient Four', dob: '1959-12-11',
        mrn: 'SAMPLE-004', sex: 'Male', phone: '555-0104', source: SOURCE,
        problems: 'Sample cervical pain', meds: 'Sample medication as needed', allergies: '',
        summary: 'SAMPLE DATA ONLY. Fictional cervical follow-up context. No information came from Athena.',
        visits: [], created: timestamp(plusDays(today, -30)), updated: timestamp(plusDays(today, -2))
      },
      {
        id: 'preview-patient-005', name: 'Sample Patient Five', dob: '1990-06-19',
        mrn: 'SAMPLE-005', sex: 'Other', phone: '555-0105', source: SOURCE,
        problems: 'Sample ankle pain', meds: '', allergies: '',
        summary: 'SAMPLE DATA ONLY. Fictional new-patient context. No information came from Athena.',
        visits: [], created: timestamp(plusDays(today, -3)), updated: timestamp(today)
      },
      {
        id: 'preview-patient-006', name: 'Sample Patient Six', dob: '1971-02-28',
        mrn: 'SAMPLE-006', sex: 'Female', phone: '555-0106', source: SOURCE,
        problems: 'Sample hip pain', meds: '', allergies: '',
        summary: 'SAMPLE DATA ONLY. Fictional hip follow-up context. No information came from Athena.',
        visits: [], created: timestamp(plusDays(today, -20)), updated: timestamp(today)
      },
      {
        id: 'preview-patient-007', name: 'Sample Patient Seven', dob: '1964-08-08',
        mrn: 'SAMPLE-007', sex: 'Male', phone: '555-0107', source: SOURCE,
        problems: 'Sample thoracic pain', meds: '', allergies: '',
        summary: 'SAMPLE DATA ONLY. Fictional thoracic follow-up context. No information came from Athena.',
        visits: [], created: timestamp(plusDays(today, -12)), updated: timestamp(today)
      },
      {
        id: 'preview-patient-008', name: 'Sample Patient Eight', dob: '1987-11-24',
        mrn: 'SAMPLE-008', sex: 'Female', phone: '555-0108', source: SOURCE,
        problems: 'Sample wrist pain', meds: '', allergies: '',
        summary: 'SAMPLE DATA ONLY. Fictional wrist follow-up context. No information came from Athena.',
        visits: [], created: timestamp(plusDays(today, -7)), updated: timestamp(today)
      }
    ];
  }

  function sampleNotes(today, patients) {
    var byId = {};
    patients.forEach(function (patient) { byId[patient.id] = patient; });
    function note(id, patientId, day, complaint, assessment) {
      var patient = byId[patientId];
      return {
        id: id, patientId: patientId, patient: patient.name, patientDob: patient.dob,
        patientMrn: patient.mrn, cc: complaint, transcript: '',
        soap: 'SAMPLE NOTE — FICTIONAL DATA ONLY\n\nSubjective: ' + complaint + '.\nObjective: Sample examination findings for interface demonstration.\nAssessment: ' + assessment + '.\nPlan: Sample conservative plan reviewed; follow up as appropriate.',
        insurance: '', coding: { em: '99213', em_just: 'Synthetic preview fixture', icd: ['Z00.00'], cpt: [] },
        emr: { cc: complaint, dx: assessment, meds: 'Sample list reviewed', orders: 'None (sample)', fu: 'Sample follow-up' },
        signed: true, signLine: 'Electronically signed — SAMPLE ONLY', isDraft: false,
        visitDate: day, provider: 'Dr. Sample Clinician', appointmentId: '', encounterId: '',
        source: SOURCE, created: timestamp(day, 10), updated: timestamp(day, 10)
      };
    }
    return [
      note('preview-note-001', 'preview-patient-001', plusDays(today, -9), 'Fictional low-back follow-up', 'Sample lumbar pain, improving'),
      note('preview-note-002', 'preview-patient-001', plusDays(today, -28), 'Fictional initial consultation', 'Sample lumbar pain'),
      note('preview-note-003', 'preview-patient-002', plusDays(today, -14), 'Fictional knee follow-up', 'Sample knee osteoarthritis')
    ];
  }

  /* The production calendar treats start_at as an absolute instant and renders
     it in the saved practice timezone. Preview fixtures therefore need an
     explicit Eastern offset; a timezone-less timestamp is parsed differently
     across browsers and used to turn an 8:10 AM sample into 4:10 AM. */
  function nthSundayKey(year, month, nth) {
    var firstWeekday = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)).getUTCDay();
    var day = 1 + ((7 - firstWeekday) % 7) + ((nth - 1) * 7);
    return year + '-' + pad2(month) + '-' + pad2(day);
  }

  function easternOffsetForDay(day) {
    var match = String(day || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '-05:00';
    var year = +match[1];
    var daylightStart = nthSundayKey(year, 3, 2);
    var daylightEnd = nthSundayKey(year, 11, 1);
    return day >= daylightStart && day < daylightEnd ? '-04:00' : '-05:00';
  }

  function easternStart(day, time) {
    return day + 'T' + time + ':00' + easternOffsetForDay(day);
  }

  function appointment(id, patient, day, time, provider, reason, source) {
    var match = String(time).match(/^(\d{2}):(\d{2})$/), hour = +(match ? match[1] : 8);
    var suffix = hour >= 12 ? 'PM' : 'AM', displayHour = hour % 12 || 12;
    return {
      id: id, appointment_id: id, appt_date: day, day_local: day,
      start_local: time, time_display: displayHour + ':' + (match ? match[2] : '00') + ' ' + suffix,
      start_at: easternStart(day, time), name: patient.name, dob: patient.dob, mrn: patient.mrn,
      patient_external_id: patient.id, patientId: patient.id, provider: provider,
      reason: reason, status: 'booked', source: source || SOURCE, syntheticPreview: true
    };
  }

  function sampleAppointments(today, patients) {
    var slots = [
      [0, '08:10', 0, 'Sample follow-up'], [0, '09:00', 1, 'Sample new-patient visit'],
      [0, '10:20', 2, 'Sample imaging review'], [0, '13:10', 3, 'Sample procedure follow-up'],
      [1, '08:30', 4, 'Sample consultation'], [1, '09:40', 5, 'Sample follow-up'],
      [1, '14:00', 6, 'Sample test review'], [2, '08:20', 7, 'Sample new-patient visit'],
      [2, '11:10', 0, 'Sample follow-up'], [3, '09:20', 1, 'Sample recheck'],
      [5, '08:50', 2, 'Sample follow-up']
    ];
    return slots.map(function (slot, index) {
      return appointment('preview-appt-' + pad2(index + 1), patients[slot[2]], plusDays(today, slot[0]), slot[1],
        index % 3 === 0 ? 'Dr. Sample Clinician' : 'Dr. Example Clinician', slot[3], SOURCE);
    });
  }

  function monthAppointments(ym, patients) {
    if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return [];
    var last = monthLastDay(ym), days = [3, 6, 10, 14, 18, 22, 26].filter(function (day) { return day <= last; });
    var times = ['08:00', '08:50', '09:40', '10:30', '13:00', '14:10', '15:20'];
    return days.map(function (day, index) {
      var patient = patients[index % patients.length];
      return appointment('preview-month-' + ym + '-' + pad2(index + 1), patient, ym + '-' + pad2(day), times[index],
        index % 2 ? 'Dr. Example Clinician' : 'Dr. Sample Clinician', 'Sample month-prep appointment', MONTH_SOURCE);
    });
  }

  function writeStorage(today) {
    currentPatients = samplePatients(today);
    currentNotes = sampleNotes(today, currentPatients);
    baseAppointments = sampleAppointments(today, currentPatients);
    var account = {};
    account[EMAIL] = { email: EMAIL, hash: 'synthetic-preview-no-password', created: timestamp(today), syntheticPreview: true };
    localStorage.setItem('sf_accounts', JSON.stringify(account));
    localStorage.setItem('sf_session', EMAIL);
    sessionStorage.setItem('sf_session', EMAIL);
    localStorage.removeItem('sf_bk_token');
    sessionStorage.removeItem('sf_bk_token');
    localStorage.setItem(ACCOUNT_PREFIX + 'patients', JSON.stringify(currentPatients));
    localStorage.setItem(ACCOUNT_PREFIX + 'notes', JSON.stringify(currentNotes));
    localStorage.setItem(ACCOUNT_PREFIX + 'activePt', currentPatients[0].id);
    localStorage.setItem(ACCOUNT_PREFIX + 'docname', 'Dr. Sample Clinician');
    localStorage.setItem(ACCOUNT_PREFIX + 'docspec', 'Sample orthopedics');
    localStorage.setItem(ACCOUNT_PREFIX + 'providerName', 'Dr. Sample Clinician');
    localStorage.setItem(ACCOUNT_PREFIX + 'practiceName', 'Sample Practice');
    localStorage.setItem(ACCOUNT_PREFIX + 'acctTz', 'America/New_York');
    localStorage.setItem(ACCOUNT_PREFIX + 'assistPromptSeen', '1');
    localStorage.setItem(ACCOUNT_PREFIX + 'idleMins', '240');
    localStorage.setItem(ACCOUNT_PREFIX + 'autoSendEMR', '0');
    localStorage.setItem(ACCOUNT_PREFIX + 'calApptsCacheV2', JSON.stringify({
      appointments: baseAppointments, me: { email: EMAIL, name: 'Dr. Sample Clinician' },
      providers: [{ id: 'preview-provider-1', name: 'Dr. Sample Clinician' }, { id: 'preview-provider-2', name: 'Dr. Example Clinician' }]
    }));
    sessionStorage.setItem('mlsEz3AutoPull.' + today, '1');
  }

  function syntheticUser() {
    return Object.freeze({
      id: 'preview-synthetic-user', email: EMAIL, name: 'Dr. Sample Clinician',
      specialty: 'Sample orthopedics', role: 'user', isHead: false, isAdmin: false,
      hasAccess: true, access: 'synthetic-preview-only', clinicalUseAuthorized: false,
      premium: false, lite: false, syntheticPreview: true
    });
  }

  function adoptSyntheticUser() {
    var user = syntheticUser();
    try { if (typeof bkUser !== 'undefined') bkUser = user; } catch (e) {}
    try { window.bkUser = user; } catch (e2) {}
    return user;
  }

  function installCalendar(rows) {
    rows = clone(rows || []);
    var providers = [{ id: 'preview-provider-1', name: 'Dr. Sample Clinician' }, { id: 'preview-provider-2', name: 'Dr. Example Clinician' }];
    try { if (typeof _calAppts !== 'undefined') _calAppts = rows; } catch (e) {}
    try { if (typeof _calMe !== 'undefined') _calMe = { email: EMAIL, name: 'Dr. Sample Clinician' }; } catch (e2) {}
    try { if (typeof _calProviders !== 'undefined') _calProviders = providers; } catch (e3) {}
    window._calAppts = rows;
    window._calMe = { email: EMAIL, name: 'Dr. Sample Clinician' };
    window._calProviders = providers;
    return rows;
  }

  function selectSampleProvider() {
    var select = document.getElementById('ez3Prov'); if (!select || !select.options) return false;
    var value = '';
    for (var index = 0; index < select.options.length; index++) {
      if (/^Dr\. Sample Clinician$/.test(String(select.options[index].textContent || '').trim())) {
        value = select.options[index].value; break;
      }
    }
    if (!value || select.value === value) return !!value;
    select.value = value;
    try { select.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    return true;
  }

  function refreshSeedThroughApp() {
    try { if (typeof savePatients === 'function') savePatients(clone(currentPatients)); } catch (e) {}
    try { if (typeof saveNotes === 'function') saveNotes(clone(currentNotes)); } catch (e2) {}
    try { if (typeof setActivePtId === 'function') setActivePtId(currentPatients[0].id); } catch (e3) {}
    try { if (typeof renderPatients === 'function') renderPatients(); } catch (e4) {}
    try { if (typeof renderHistory === 'function') renderHistory(); } catch (e5) {}
    try { if (typeof renderPatientBar === 'function') renderPatientBar(); } catch (e6) {}
    try { if (typeof updateNavCounts === 'function') updateNavCounts(); } catch (e7) {}
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent =
      'body.mls-public-preview{padding-bottom:58px!important;}' +
      '#mlsPublicPreviewStrip{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;align-items:center;gap:12px;min-height:50px;box-sizing:border-box;padding:8px 16px;background:#183a2f;color:#fff;border-top:2px solid #8fd8be;box-shadow:0 -5px 22px rgba(16,37,30,.24);font:600 13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
      '#mlsPublicPreviewStrip .mls-preview-copy{min-width:0;flex:1 1 auto;}' +
      '#mlsPublicPreviewStrip strong{display:inline-block;margin-right:7px;letter-spacing:.04em;}' +
      '#mlsPublicPreviewStatus{display:inline;color:#d8eee6;font-weight:500;}' +
      '#mlsPublicPreviewStrip .mls-preview-actions{display:flex;gap:7px;flex:0 0 auto;}' +
      '#mlsPublicPreviewStrip button{border:1px solid rgba(255,255,255,.62);border-radius:8px;background:#fff;color:#183a2f;padding:7px 11px;font:700 12px system-ui;cursor:pointer;white-space:nowrap;}' +
      '#mlsPublicPreviewStrip button:last-child{background:transparent;color:#fff;}' +
      '[data-mls-preview-blocked="1"]{opacity:.58!important;cursor:not-allowed!important;}' +
      '[data-mls-preview-readonly="1"]{background:#f4f3ef!important;cursor:not-allowed!important;}' +
      '[data-mls-preview-action="sample-month"],[data-mls-preview-action="sample-day"]{opacity:1!important;cursor:pointer!important;background:#204034!important;color:#fff!important;}' +
      '.mls-preview-menu-badge{display:inline-flex;margin-left:auto;border:1px solid #8fd8be;border-radius:999px;padding:2px 7px;background:#e8f7f1;color:#183a2f;font:800 10px/1.2 system-ui;letter-spacing:.04em;text-transform:uppercase;}' +
      '@media(max-width:680px){body.mls-public-preview{padding-bottom:104px!important;}#mlsPublicPreviewStrip{align-items:flex-start;flex-wrap:wrap;padding:8px 10px;gap:6px 9px;}#mlsPublicPreviewStrip .mls-preview-copy{flex-basis:100%;font-size:12px;}#mlsPublicPreviewStrip .mls-preview-actions{width:100%;}#mlsPublicPreviewStrip button{flex:1 1 0;}}';
    (document.head || document.documentElement).appendChild(style);
  }

  function explain(message) {
    var status = document.getElementById(STATUS_ID);
    if (status) status.textContent = message || 'Preview is read-only. No data was sent or saved.';
  }

  function resetPreview() {
    explain('Resetting the invented sample data…');
    try { if (typeof config.resetStorage === 'function') config.resetStorage(); } catch (e) {}
    try { window.location.reload(); } catch (e2) {}
  }

  function exitPreview() {
    explain('Leaving the sample workspace…');
    try { if (typeof config.resetStorage === 'function') config.resetStorage(); } catch (e) {}
    var target;
    try {
      target = new URL(String(config.exitUrl || '/ScribeFlow.html'), window.location.href);
      if (target.origin !== window.location.origin) throw new Error('cross-origin exit refused');
      window.location.replace(target.href);
    } catch (e2) {
      try { window.location.replace('/ScribeFlow.html'); } catch (e3) {}
    }
  }

  function mountStrip() {
    addStyle();
    document.body.classList.add('mls-public-preview');
    document.documentElement.setAttribute('data-mls-synthetic-boundary', '1');
    document.body.setAttribute('data-mls-synthetic-boundary', '1');
    var existing = document.getElementById(STRIP_ID); if (existing) return existing;
    var strip = document.createElement('aside'); strip.id = STRIP_ID;
    strip.setAttribute('data-mls-synthetic-boundary', '1');
    strip.setAttribute('role', 'status'); strip.setAttribute('aria-live', 'polite');
    strip.setAttribute('aria-label', 'Sample workspace status');
    var copy = document.createElement('div'); copy.className = 'mls-preview-copy';
    var strong = document.createElement('strong'); strong.textContent = 'SAMPLE WORKSPACE';
    var status = document.createElement('span'); status.id = STATUS_ID;
    status.textContent = 'Invented patients only · Not connected to Athena · Nothing sends or signs · resets on reload.';
    copy.appendChild(strong); copy.appendChild(status);
    var actions = document.createElement('div'); actions.className = 'mls-preview-actions';
    var reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset sample'; reset.addEventListener('click', resetPreview);
    var exit = document.createElement('button'); exit.type = 'button'; exit.textContent = 'Exit preview'; exit.addEventListener('click', exitPreview);
    actions.appendChild(reset); actions.appendChild(exit); strip.appendChild(copy); strip.appendChild(actions);
    document.body.appendChild(strip); return strip;
  }

  var dangerousWords = /(?:\brecord(?:ing)?\b|\bdictat(?:e|ion)\b|\bvoice\b|\bmicrophone\b|\bmic\b|\bcall\b|\bgenerate\b|\bafter[ -]visit summary\b|\bsend\b|\bsign\b|\bsave\b|\bdelete\b|\bremove\b|\binvite\b|\bemail\b|\bfax\b|\bmessage\b|\bbook\b|\bschedule\b|\bcancel\b|\bwrite(?:back)?\b|\bsubmit\b|\bupload\b|\bimport\b|\bexport\b|\bdownload\b|\bpull\b|\bretry failed\b|\bverify\b|\bathena\b|\bconnect\b|\bpair\b|\bcheck[ -]?in\b|\broom\b|\bapprove\b|\bconfirm\b|\bredeem\b|\bpurchase\b|\bsubscribe\b|\blog ?out\b|\bnew patient\b|\badd patient\b)/i;
  var dangerousIds = /(?:record|capture|dictat|voice|mic|phone|generate|avs|send|sign|save|delete|invite|writeback|athena|pull|retry|upload|import|export|pair|checkout|subscribe|patientnew|addpatient)/i;

  function actionText(control) {
    return [control.id || '', control.getAttribute && control.getAttribute('onclick') || '',
      control.getAttribute && control.getAttribute('data-action') || '',
      control.getAttribute && control.getAttribute('data-mls-action') || '',
      control.getAttribute && control.getAttribute('aria-label') || '',
      control.getAttribute && control.getAttribute('title') || '', control.textContent || ''].join(' ');
  }

  function isDangerousControl(control) {
    if (!control || control.id === STRIP_ID || (control.closest && control.closest('#' + STRIP_ID))) return false;
    if (control.id === 'ez3PullStart') return false;
    if (control.getAttribute && control.getAttribute('data-mls-action') === 'staff-prep') return false;
    var href = control.getAttribute && control.getAttribute('href') || '';
    if (/^(?:mailto|tel|sms):/i.test(href)) return true;
    var text = actionText(control);
    return dangerousIds.test(control.id || '') || dangerousWords.test(text);
  }

  function isSafePreviewNavigation(control) {
    if (!control) return false;
    var id = control.id || '';
    if (/^(?:mlsDsPrev|mlsDsNext|mlsDsTodayBtn|ez3Choose|ez3Hist|ez3Prep|ez3Adv)$/.test(id)) return true;
    try { if (control.matches && control.matches('.ez3fl-openws')) return true; } catch (e) {}
    return false;
  }

  function markBlocked(control, reason) {
    if (!control || control.getAttribute('data-mls-preview-blocked') === '1') return;
    control.setAttribute('data-mls-preview-blocked', '1');
    control.setAttribute('aria-disabled', 'true');
    control.setAttribute('title', reason || 'Unavailable in the read-only sample workspace.');
  }

  function markPreviewNavigation(control) {
    if (!control) return;
    control.removeAttribute('data-mls-preview-blocked');
    control.setAttribute('aria-disabled', 'false');
    try { control.disabled = false; } catch (e) {}
  }

  function markReadOnly(field) {
    if (!field || (field.closest && field.closest('#' + STRIP_ID))) return;
    var id = field.id || '', type = String(field.type || '').toLowerCase();
    if (id === 'ez3sMonth' || id === 'ez3From' || id === 'ez3To' || id === 'ptSearch' || id === 'ptSort' || id === 'histSearch' || id === 'histFilter' || type === 'search') return;
    if (field.tagName === 'TEXTAREA' || /^(?:text|email|tel|number|password|url|time)$/.test(type)) {
      try { field.readOnly = true; } catch (e) {}
      field.setAttribute('data-mls-preview-readonly', '1');
      field.setAttribute('aria-readonly', 'true');
      field.setAttribute('title', 'Sample workspace: editing is disabled.');
    } else if (/^(?:checkbox|radio|file|submit|reset)$/.test(type)) {
      markBlocked(field, 'Sample workspace: this control is disabled.');
    } else if (field.tagName === 'SELECT' && !(field.closest && field.closest('#mlsEz3'))) {
      markBlocked(field, 'Sample workspace: settings cannot be changed.');
    }
  }

  function rewriteStaffCopy(root) {
    var start = document.getElementById('ez3PullStart');
    if (!start || (root && root.nodeType === 1 && root !== start && !root.contains(start) && !start.contains(root))) return;
    start.removeAttribute('data-mls-preview-blocked'); start.setAttribute('aria-disabled', 'false');
    start.disabled = false;
    start.setAttribute('data-mls-preview-action', 'sample-month'); start.textContent = 'Load sample month';
    start.title = 'Loads invented appointments into this memory-only preview. MLS sends no request to Athena or MLS Assist.';
    var card = start.closest ? start.closest('.ez3-pull') : null;
    if (card) {
      var heading = card.querySelector('.ph'); if (heading) heading.textContent = 'Load a sample month';
      var warning = card.querySelector('.pw'); if (warning) warning.textContent = 'Preview only: choosing a month loads invented appointments from memory. MLS sends no request to Athena or MLS Assist.';
      var connection = card.querySelector('#ez3PullConn'); if (connection) connection.textContent = 'Sample data only — choose a month, then load it into this temporary workspace.';
      var pullingFor = card.querySelector('#ez3PullFor'); if (pullingFor) pullingFor.textContent = 'Sample practice';
      if (pullingFor && pullingFor.previousElementSibling && pullingFor.previousElementSibling.tagName === 'LABEL') {
        putPreviewText(pullingFor.previousElementSibling, 'Sample scope');
      }
      [['ez3cSaved', 'loaded'], ['ez3cDup', 'already loaded'], ['ez3cFail', 'not loaded']].forEach(function (item) {
        var count = card.querySelector('#' + item[0]);
        var label = count && count.parentElement && count.parentElement.querySelector('span');
        if (label) putPreviewText(label, item[1]);
      });
      var current = card.querySelector('#ez3PullNow');
      if (current && /nothing pulled yet/i.test(current.textContent || '')) putPreviewText(current, 'No sample month loaded yet.');
    }
  }

  function decorateStaffMenu(root) {
    /* Orders is a legacy navtab proxy rather than an .mlsTbItem, so the
       generic menu-item pass below does not see it. Keep the preview menu
       focused on its one useful sample workspace instead of exposing a dead
       live-route affordance. */
    var orders = document.querySelector && document.querySelector('#mlsTbMenuPanel #nav_orders');
    if (orders) {
      markBlocked(orders, 'Orders are unavailable in the read-only sample workspace.');
      hidePreviewNode(orders);
      /* Topbar reconciliation writes its own inline display:flex!important
         after this pass. Detach this legacy proxy in preview so it cannot win
         that style race or remain in the accessibility tree. */
      try { if (orders.parentNode) orders.parentNode.removeChild(orders); } catch (e00) {}
    }
    var menuItems = [];
    try { menuItems = document.querySelectorAll('#mlsTbMenuPanel .mlsTbItem'); } catch (e0) {}
    Array.prototype.forEach.call(menuItems, function (item) {
      if (item.getAttribute && item.getAttribute('data-mls-action') === 'staff-prep') return;
      markBlocked(item, 'Only the sample Staff prep workspace is available in this read-only preview.');
      try { item.disabled = true; } catch (e1) {}
      hidePreviewNode(item);
    });
    var rows = [];
    try { rows = document.querySelectorAll('#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]'); } catch (e) {}
    Array.prototype.forEach.call(rows, function (row) {
      row.removeAttribute('data-mls-preview-blocked'); row.setAttribute('aria-disabled', 'false');
      try { row.disabled = false; } catch (e2) {}
      row.setAttribute('data-mls-preview-staff-entry', '1');
      var labels = row.querySelectorAll ? row.querySelectorAll('span') : [];
      if (labels.length > 1) putPreviewText(labels[1], 'Staff prep · sample month');
      if (row.querySelector && row.querySelector('.mls-preview-menu-badge')) return;
      var badge = document.createElement('span'); badge.className = 'mls-preview-menu-badge'; badge.textContent = 'Sample';
      row.appendChild(badge);
    });
  }

  /* The voice cluster's face opens a menu. It cannot contact Athena,
     record, send or save — the three tools inside can, and they stay
     blocked. Blocking the face too left the sample workspace with an inert
     bubble a prospect could not open, which hides the feature instead of
     disclosing that it is read-only. */
  function rewriteVoiceCluster() {
    var face = document.getElementById('mlsVcFace'); if (!face) return;
    face.removeAttribute('data-mls-preview-blocked');
    face.setAttribute('aria-disabled', 'false');
    try { face.disabled = false; } catch (e) {}
    face.setAttribute('data-mls-preview-action', 'voice-cluster');
    face.setAttribute('data-tip', 'Opens the voice and assistant tools. In this sample workspace they are read-only.');
  }

  function openVoiceCluster(target) {
    var api = window.__mlsVoiceCluster;
    if (!api || typeof api.toggle !== 'function') { explain('Voice tools are still loading.'); return; }
    var open = api.toggle();
    if (target) target.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function rewriteDayPull() {
    var button = document.getElementById('mlsDsPullBtn'); if (!button) return;
    button.removeAttribute('data-mls-preview-blocked'); button.setAttribute('aria-disabled', 'false');
    button.disabled = false;
    button.setAttribute('data-mls-preview-action', 'sample-day'); button.textContent = 'Reload sample day';
    button.title = 'Reloads invented appointments for the selected day from memory. MLS sends no request to Athena or MLS Assist.';
  }

  function selectedPreviewDay() {
    var day = todayKey(), daySwitch = window.__mlsDaySwitch;
    try { if (daySwitch && typeof daySwitch.currentDay === 'function') day = daySwitch.currentDay() || day; } catch (e) {}
    return String(day || '').slice(0, 10);
  }

  function selectedDayCount() {
    var day = selectedPreviewDay(), count = 0, provider = 'Dr. Sample Clinician';
    var providerSelect = document.getElementById('ez3Prov');
    try {
      var selectedOption = providerSelect && providerSelect.options && providerSelect.options[providerSelect.selectedIndex];
      if (selectedOption) provider = !/all providers/i.test(selectedOption.textContent || '') ? String(selectedOption.textContent || '').trim() : '';
    } catch (e0) {}
    try {
      (window._calAppts || []).forEach(function (row) {
        if (row && String(row.appt_date || row.day_local || '').slice(0, 10) === day &&
            (!provider || String(row.provider || '').trim() === provider)) count++;
      });
    } catch (e) {}
    return count;
  }

  function putPreviewText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function hidePreviewNode(node) {
    if (!node) return;
    try { node.style.setProperty('display', 'none', 'important'); } catch (e) { try { node.style.display = 'none'; } catch (e2) {} }
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('data-mls-preview-hidden', '1');
  }

  function showPreviewNode(node) {
    if (!node || node.getAttribute('data-mls-preview-hidden') === '1') return;
    try { node.style.removeProperty('display'); } catch (e) {}
    node.removeAttribute('aria-hidden');
  }

  function rewriteStaffSurface() {
    var start = document.getElementById('ez3PullStart');
    if (!start) return;
    var subtitle = document.querySelector('#ez3Wrap .ez3-sub');
    if (subtitle) putPreviewText(subtitle, 'Explore invented schedules by provider or load a sample month. Recording and Athena stay off.');

    ['ez3ProvRefresh', 'ez3sPullToday', 'mlsMpoBtn', 'mlsMpoNote', 'ez3PullRetry', 'ez3PullCancel'].forEach(function (id) {
      hidePreviewNode(document.getElementById(id));
    });
    hidePreviewNode(document.getElementById('mlsPadRow'));
    var todayPull = document.getElementById('ez3sPullToday');
    if (todayPull && todayPull.nextElementSibling && /mlsaa-intent/.test(todayPull.nextElementSibling.className || '')) hidePreviewNode(todayPull.nextElementSibling);
    var practiceControl = document.getElementById('ez3sProv');
    if (practiceControl && practiceControl.closest) hidePreviewNode(practiceControl.closest('.ez3-card'));
    var staffActions = [];
    try { staffActions = document.querySelectorAll('#ez3Wrap .ez3fl-dayhist,#ez3Wrap .ez3-exbtn'); } catch (e) {}
    Array.prototype.forEach.call(staffActions, hidePreviewNode);
    var empty = document.querySelector && document.querySelector('#ez3Wrap .ez3-empty');
    if (empty) putPreviewText(empty, 'No invented appointments in this sample range. Choose another range or load the sample month.');
  }

  function rewritePatientSurface() {
    var view = document.getElementById('patientsView');
    if (!view) return;

    /* Patient rows and the profile are for browsing only. Default-deny every
       action control in this view, then restore only the explicit search,
       sort, and grouping controls. This also covers buttons rendered later by
       renderPatients/renderProfile (Record, Delete, Start visit, Schedule,
       Draft, Share, Export, Edit, Upload, Pull, New, and future additions). */
    var patientActions = [];
    try {
      patientActions = view.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"],input[type="file"]');
    } catch (e) {}
    Array.prototype.forEach.call(patientActions, function (control) {
      var id = String(control.id || '');
      var safeGroup = /^ptgb_(?:all|upcoming|procedure|type)$/.test(id) ||
        (control.closest && control.closest('#ptGroupBar'));
      if (safeGroup) {
        control.removeAttribute('data-mls-preview-hidden');
        control.removeAttribute('aria-hidden');
        control.removeAttribute('data-mls-preview-blocked');
        control.setAttribute('aria-disabled', 'false');
        try { control.style.removeProperty('display'); } catch (e2) {}
        try { control.disabled = false; } catch (e3) {}
        return;
      }
      markBlocked(control, 'Read-only sample profile: this action is unavailable.');
      try { control.disabled = true; } catch (e4) {}
      hidePreviewNode(control);
    });

    /* Hide action-only panels as well as their controls so a previously open
       menu cannot leave stale live affordances visible in the sample view. */
    ['ptMore', 'previsitLinkRow', 'pendingIntakeBox', 'bookingLinkRow', 'recTabBar',
      'availBox', 'boardBox', 'receptionBox', 'lawyerBox', 'doctorBox',
      'followupBox', 'recMessages', 'recComms', 'recSettings'].forEach(function (id) {
      hidePreviewNode(document.getElementById(id));
    });

    /* These modals live outside #patientsView. They must not provide a race
       around the view-level default deny. Document text remains browsable, but
       analysis, merge, and copy controls are removed; only Close survives. */
    ['patientModal', 'shareModal'].forEach(function (id) {
      var modal = document.getElementById(id); if (!modal) return;
      try { modal.classList.remove('show'); } catch (e5) {}
      modal.setAttribute('aria-hidden', 'true'); hidePreviewNode(modal);
    });
    var docModal = document.getElementById('docModal');
    if (docModal && docModal.querySelectorAll) {
      var docButtons = [];
      try { docButtons = docModal.querySelectorAll('button,a,[role="button"]'); } catch (e6) {}
      Array.prototype.forEach.call(docButtons, function (button) {
        var handler = String(button.getAttribute && button.getAttribute('onclick') || '');
        if (/closeDocModal\s*\(/.test(handler)) return;
        markBlocked(button, 'Read-only sample document: analysis, merge, copy, and export are unavailable.');
        try { button.disabled = true; } catch (e7) {}
        hidePreviewNode(button);
      });
    }

    var sub = view.querySelector && view.querySelector('.card > p.sub');
    if (sub) putPreviewText(sub, 'Eight invented patients are loaded. Select one to explore a sample profile.');
    var empty = document.getElementById('ptEmpty');
    if (empty) putPreviewText(empty, 'Sample patients are loading. No patient information can be added in this preview.');
    var none = document.getElementById('profileNonePanel');
    if (none) {
      var noneCopy = none.querySelector && none.querySelector('.empty');
      if (noneCopy) putPreviewText(noneCopy, 'Choose an invented patient above to explore their read-only sample chart.');
    }
    hidePreviewNode(document.getElementById('mlsSrcLegend'));
    var glance = document.querySelector && document.querySelector('#profAtGlance span');
    if (glance && /new patient.*start their first visit/i.test(glance.textContent || '')) {
      putPreviewText(glance, 'Invented patient with no prior sample visits.');
    }
    var profileEmpty = document.querySelector && document.querySelector('#profileCard .mlsxh-empty');
    if (profileEmpty && /athena|add one|copy/i.test(profileEmpty.textContent || '')) {
      putPreviewText(profileEmpty, 'No invented visits are included for this sample patient.');
    }
    var sourceHeadline = document.querySelector && document.querySelector('#mlsSrcSummary .mls-src-headline');
    if (sourceHeadline) putPreviewText(sourceHeadline, 'Invented sample history only');
    putPreviewText(document.getElementById('mlsEpReasonBody'), 'No visit reason is included in this sample record.');
    var timelineEmpty = document.querySelector && document.querySelector('#mlsVtlCard .vtl-empty');
    if (timelineEmpty) putPreviewText(timelineEmpty, 'No dated sample visits are included in this preview.');
    [
      ['#insBox p.mini', 'No invented insurance or benefits data is included in this sample record.'],
      ['#pf2Docs p.mini', 'No invented documents are included in this sample record.'],
      ['#mlsOrBox p.mini', 'No invented outside records or imaging are included in this sample record.']
    ].forEach(function (item) {
      var copyNode = document.querySelector && document.querySelector(item[0]);
      if (copyNode) putPreviewText(copyNode, item[1]);
    });
    var search = document.getElementById('ptSearch');
    if (search) {
      search.removeAttribute('data-mls-preview-readonly'); search.removeAttribute('aria-readonly');
      search.removeAttribute('data-mls-preview-blocked'); search.setAttribute('aria-disabled', 'false');
      try { search.readOnly = false; search.disabled = false; } catch (e8) {}
    }
    var sort = document.getElementById('ptSort');
    if (sort) {
      sort.removeAttribute('data-mls-preview-blocked'); sort.setAttribute('aria-disabled', 'false');
      try { sort.disabled = false; } catch (e9) {}
    }
  }

  function activeSampleName() {
    var name = document.querySelector('.mlsctx-name');
    return name && /^Sample Patient /.test(String(name.textContent || '').trim()) ? String(name.textContent || '').trim() : 'the selected sample patient';
  }

  function rewriteHistorySurface() {
    var card = document.getElementById('historyCard');
    if (!card) return;
    var heading = card.querySelector && card.querySelector('h2');
    if (heading && heading.getAttribute('data-mls-preview-heading') !== '1') {
      heading.textContent = '';
      var title = document.createElement('span'); title.textContent = 'Visit history'; heading.appendChild(title);
      var badge = document.createElement('span'); badge.textContent = 'SAMPLE - READ-ONLY';
      badge.setAttribute('data-mls-preview-history-badge', '1'); heading.appendChild(badge);
      heading.setAttribute('data-mls-preview-heading', '1');
    }
    hidePreviewNode(document.getElementById('histNewVisitBtn'));
    hidePreviewNode(document.getElementById('pullChartBtn'));
    hidePreviewNode(document.getElementById('chartSumBtn'));
    hidePreviewNode(document.getElementById('chartSumCard'));
    var headingButtons = [];
    try { headingButtons = card.querySelectorAll('h2 button'); } catch (e) {}
    Array.prototype.forEach.call(headingButtons, function (button) {
      if (/schedule follow-up|draft op note/i.test(button.textContent || '')) hidePreviewNode(button);
    });
    var rowActions = [];
    try { rowActions = card.querySelectorAll('.hist-item button'); } catch (e2) {}
    Array.prototype.forEach.call(rowActions, function (button) {
      if (/review athena actions|delete|remove/i.test(button.textContent || '')) hidePreviewNode(button);
    });
    var sub = null;
    try {
      Array.prototype.some.call(card.children || [], function (child) {
        if (child && child.tagName === 'P' && /(?:^|\s)sub(?:\s|$)/.test(child.className || '')) { sub = child; return true; }
        return false;
      });
    } catch (e4) {}
    if (!sub && card.querySelector) sub = card.querySelector('p.sub');
    if (sub) {
      var sampleName = activeSampleName();
      var desired = 'Showing invented visits for ' + sampleName + '. Temporary memory only - resets on reload.';
      if (sub.textContent !== desired || !document.getElementById('histWho')) {
        sub.textContent = '';
        sub.appendChild(document.createTextNode('Showing invented visits for '));
        var who = document.createElement('b'); who.id = 'histWho'; who.textContent = sampleName; sub.appendChild(who);
        sub.appendChild(document.createTextNode('. Temporary memory only - resets on reload.'));
      }
    }
    putPreviewText(document.getElementById('histStorageNote'), 'SAMPLE DATA ONLY · Invented visit history · temporary memory · resets on reload.');
    var empty = document.getElementById('histEmpty');
    if (empty && /(?:no saved visits|generate a note|save to history)/i.test(empty.textContent || '')) {
      putPreviewText(empty, 'No invented visits in this sample record. Choose another sample patient to explore read-only history.');
    }
    var search = document.getElementById('histSearch');
    if (search) {
      search.removeAttribute('data-mls-preview-readonly'); search.removeAttribute('aria-readonly');
      search.removeAttribute('data-mls-preview-blocked'); search.setAttribute('aria-disabled', 'false');
      try { search.readOnly = false; search.disabled = false; } catch (e5) {}
    }
    var filter = document.getElementById('histFilter');
    if (filter) { filter.removeAttribute('data-mls-preview-blocked'); filter.setAttribute('aria-disabled', 'false'); try { filter.disabled = false; } catch (e3) {} }
    var viewModal = document.getElementById('viewModal');
    var modalButtons = [];
    try { modalButtons = viewModal ? viewModal.querySelectorAll('button') : []; } catch (e6) {}
    Array.prototype.forEach.call(modalButtons, function (button) {
      if (/reopen in editor/i.test(button.textContent || '')) {
        markBlocked(button, 'Read-only sample history cannot be reopened for editing.');
        try { button.disabled = true; } catch (e7) {}
        hidePreviewNode(button);
      }
    });
  }

  function rewriteSampleChooserActions() {
    var actions = [];
    try { actions = document.querySelectorAll('#ez3Wrap .ez3-exbtn'); } catch (e) {}
    Array.prototype.forEach.call(actions, function (button) {
      if (button.getAttribute('data-act') === 'rec' && /^preview-(?:appt|day|month)-/.test(String(button.getAttribute('data-k') || ''))) {
        button.removeAttribute('data-mls-preview-blocked');
        button.setAttribute('aria-disabled', 'false');
        button.setAttribute('data-mls-preview-action', 'open-sample-appointment');
        if (!/Open sample patient/.test(button.textContent || '')) button.innerHTML = 'Open sample patient<small>View without recording</small>';
        button.setAttribute('title', 'Opens this invented patient in the read-only sample workspace.');
      } else hidePreviewNode(button);
    });
  }

  function rewriteDateContext() {
    var day = selectedPreviewDay(), isToday = day === todayKey();
    var prev = document.getElementById('mlsDsPrev'), next = document.getElementById('mlsDsNext');
    if (prev) prev.setAttribute('aria-label', 'Previous day');
    if (next) next.setAttribute('aria-label', 'Next day');
    var strip = document.getElementById('mlsDsStrip');
    if (strip) strip.setAttribute('aria-label', 'Visit date controls');
    var dayLabel = document.getElementById('mlsDsDayLbl');
    if (dayLabel) { dayLabel.setAttribute('aria-live', 'polite'); dayLabel.setAttribute('aria-atomic', 'true'); }

    var dayProgress = document.getElementById('mlsDayProgress');
    var agenda = document.getElementById('mlsAgendaChip');
    var appt = document.getElementById('mlsCtxApptChip');
    if (!isToday) {
      hidePreviewNode(dayProgress); hidePreviewNode(agenda); hidePreviewNode(appt);
    } else {
      [dayProgress, agenda, appt].forEach(function (node) {
        if (!node) return;
        node.removeAttribute('data-mls-preview-hidden');
        try { node.style.removeProperty('display'); } catch (e) {}
        node.removeAttribute('aria-hidden');
      });
      if (agenda) {
        putPreviewText(agenda, 'Sample agenda (0/' + selectedDayCount() + ')');
        markBlocked(agenda, 'Use Choose patient to browse the invented schedule.');
        try { agenda.setAttribute('tabindex', '-1'); } catch (e2) {}
      }
    }
  }

  function rewritePreviewCopy() {
    selectSampleProvider();
    hidePreviewNode(document.getElementById('mlsPullFlowPanel'));
    hidePreviewNode(document.getElementById('mlsRdNewBtn'));
    hidePreviewNode(document.getElementById('mlsSyncPop'));
    hidePreviewNode(document.getElementById('ez3VRow'));
    hidePreviewNode(document.getElementById('nav_studio'));
    hidePreviewNode(document.getElementById('nav_analysis'));
    /* The global finder is intentionally backed by live screens and can append
       an online-assistant result. A read-only box is a misleading dead end, so
       omit it from the self-guided sample and retain the dedicated Patients and
       appointment chooser search surfaces instead. */
    hidePreviewNode(document.getElementById('mlsPqsBox'));
    hidePreviewNode(document.getElementById('mlsPqsInput'));
    hidePreviewNode(document.getElementById('mlsQuickFindOv'));
    /* These Easy-room proxies can appear after a sample patient is opened.
       Their handlers delegate to live chart, note-prep, or portal controls;
       remove both the proxies and portal source rather than leaving controls
       that only fail after a click. */
    ['ez3Chart2', 'ez3Prep2', 'ez3Portal', 'mlsPortalInviteBtn'].forEach(function (id) {
      var control = document.getElementById(id);
      if (!control) return;
      markBlocked(control, 'This live action is unavailable in the read-only sample workspace.');
      try { control.disabled = true; } catch (e0) {}
      hidePreviewNode(control);
    });
    var dayEmpty = document.getElementById('ez3DayEmpty');
    if (dayEmpty) {
      putPreviewText(dayEmpty, 'No invented appointments are included for this sample date. Use Reload sample day to restore memory-only sample rows. Nothing contacts Athena.');
    }
    var visitFlow = document.querySelector && document.querySelector('#ez3Wrap .ez3-flow');
    hidePreviewNode(visitFlow);
    rewriteDateContext();
    rewriteStaffSurface();
    rewritePatientSurface();
    rewriteHistorySurface();
    rewriteSampleChooserActions();
    putPreviewText(document.getElementById('appFooterNotice'), '⚕️ SAMPLE DATA ONLY. Invented patients and notes stay in temporary memory and reset when you reload or leave. Do not enter real patient information.');
    putPreviewText(document.getElementById('heroPullStatus'),
      'Sample schedule loaded - choose a patient to explore the workspace.');
    putPreviewText(document.getElementById('mlsPrfProgress'),
      'Sample schedule ready - invented appointments are loaded for this day.');

    ['ez3Now', 'ez3Next', 'ez3Nxt'].forEach(function (id) {
      var next = document.getElementById(id);
      if (!next) return;
      putPreviewText(next, 'Sample visit - recording off');
      markBlocked(next, 'Recording is off in the read-only sample workspace.');
    });
    var heroRecord = document.getElementById('heroRecBtn');
    if (heroRecord) {
      putPreviewText(heroRecord, 'Recording off in preview');
      markBlocked(heroRecord, 'Recording is off in the read-only sample workspace.');
    }
    ['ez3Rec', 'ez3Rec2', 'ez3Stop', 'ez3Gen'].forEach(function (id) {
      var visitRecord = document.getElementById(id);
      if (!visitRecord) return;
      /* Canonical Easy owns these controls synchronously. The single disabled
         hero status is the truthful preview recording surface. */
      hidePreviewNode(visitRecord);
      markBlocked(visitRecord, 'Recording and note generation are off in the read-only sample workspace.');
      try { visitRecord.disabled = true; } catch (e0) {}
    });

    var laneButtons = [];
    try { laneButtons = document.querySelectorAll('.ez3fl-recbtn'); } catch (e) {}
    Array.prototype.forEach.call(laneButtons, function (button) {
      var label = button.querySelector && button.querySelector('.ez3fl-rblabel');
      putPreviewText(label || button, 'Recording off in preview');
      markBlocked(button, 'Recording is off in the read-only sample workspace.');
    });

    var hints = [];
    try { hints = document.querySelectorAll('.ez3fl-rechint'); } catch (e2) {}
    Array.prototype.forEach.call(hints, function (hint) {
      putPreviewText(hint, 'Sample workspace only - recording, cloud sync, Athena, sending, and signing are off.');
    });
    var transcript = document.getElementById('ez3Transcript') || document.getElementById('ez3flTranscript');
    if (transcript) transcript.setAttribute('placeholder', 'Transcript editing is off in this read-only sample.');
    var txHead = document.querySelector('.ez3-transcript-head span,.ez3fl-txhead span');
    if (txHead) putPreviewText(txHead, 'Read-only sample transcript');
    var txMeta = document.querySelector('.ez3-transcript-meta span:last-child,.ez3fl-txmeta span:last-child');
    if (txMeta) putPreviewText(txMeta, 'Nothing is recorded or stored.');

    var quickTools = [];
    try { quickTools = document.querySelectorAll('.ez3fl-qchip'); } catch (e3) {}
    Array.prototype.forEach.call(quickTools, function (control) {
      if (/record on phone/i.test(control.textContent || '')) {
        putPreviewText(control, 'Phone recording off');
        markBlocked(control, 'Phone recording is off in the read-only sample workspace.');
      } else if (/paste a transcript/i.test(control.textContent || '')) {
        putPreviewText(control, 'Transcript paste off');
        markBlocked(control, 'Transcript paste is off in the read-only sample workspace.');
      } else if (control.id === 'ez3QAssistant' || control.id === 'ez3flAssistant') {
        putPreviewText(control, 'Assistant off in preview');
        markBlocked(control, 'The online assistant is off in the read-only sample workspace.');
      } else if (control.id === 'ez3QVoice') {
        putPreviewText(control, 'Voice off in preview');
        markBlocked(control, 'Voice tools are off in the read-only sample workspace.');
      } else if (control.id === 'ez3QDictate') {
        putPreviewText(control, 'Dictation off in preview');
        markBlocked(control, 'Dictation is off in the read-only sample workspace.');
      } else if (control.id === 'ez3QAvs') {
        putPreviewText(control, 'Summary off in preview');
        markBlocked(control, 'After-visit summary generation is off in the read-only sample workspace.');
      } else if (control.id === 'ez3QOrders') {
        putPreviewText(control, 'Orders off in preview');
        markBlocked(control, 'Orders are off in the read-only sample workspace.');
      }
    });

    var offlineActions = [];
    try {
      offlineActions = document.querySelectorAll('#mlsEz3Body button,#mlsWdNew,#mlsWdStudio,#mlsWdDeck .wd-btn');
    } catch (e40) {}
    Array.prototype.forEach.call(offlineActions, function (control) {
      if (/(?:op note.*draft|prep note|ask copilot|recommendations|paste transcript|new widget|add this widget|send to patient|phone mic|^\s*manage\s*$)/i.test(control.textContent || '')) {
        markBlocked(control, 'This action is off in the read-only sample workspace.');
        try { control.disabled = true; } catch (e41) {}
        hidePreviewNode(control);
      }
    });
    hidePreviewNode(document.getElementById('mlsStEzPanel'));
    var offlineGroupLabels = [];
    try { offlineGroupLabels = document.querySelectorAll('#mlsEz3Body .ez3-toolslbl'); } catch (e42) {}
    Array.prototype.forEach.call(offlineGroupLabels, function (label) {
      if (/(?:ai & visit tools|your widgets)/i.test(label.textContent || '')) hidePreviewNode(label);
    });

    var syncChips = [];
    try { syncChips = document.querySelectorAll('#mlsCardSlot .mls-sync'); } catch (e4) {}
    Array.prototype.forEach.call(syncChips, function (chip) {
      putPreviewText(chip, 'Athena off in preview');
      markBlocked(chip, 'This sample workspace never connects to Athena.');
    });
  }

  function harden(root, skipGlobalRewrite) {
    root = root && root.querySelectorAll ? root : document;
    rewriteStaffCopy(root);
    rewriteDayPull();
    rewriteVoiceCluster();
    decorateStaffMenu(root);
    if (!skipGlobalRewrite) rewritePreviewCopy();
    var controls = [];
    try { controls = root.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]'); } catch (e) {}
    try {
      if (root !== document && root.matches && root.matches('button,a,[role="button"],input[type="button"],input[type="submit"]')) {
        controls = [root].concat(Array.prototype.slice.call(controls));
      }
    } catch (e0) {}
    Array.prototype.forEach.call(controls, function (control) {
      if (control.id === 'ez3PullStart' || control.id === 'mlsDsPullBtn' ||
          (control.getAttribute && control.getAttribute('data-mls-action') === 'staff-prep') ||
          (control.getAttribute && control.getAttribute('data-mls-preview-action') === 'open-sample-appointment')) return;
      if (isSafePreviewNavigation(control)) { markPreviewNavigation(control); return; }
      if (isDangerousControl(control)) markBlocked(control, 'Read-only sample workspace: this action cannot contact Athena, record, send, or save.');
    });
    var fields = [];
    try { fields = root.querySelectorAll('input,textarea,select,[contenteditable="true"]'); } catch (e2) {}
    try {
      if (root !== document && root.matches && root.matches('input,textarea,select,[contenteditable="true"]')) {
        fields = [root].concat(Array.prototype.slice.call(fields));
      }
    } catch (e20) {}
    Array.prototype.forEach.call(fields, function (field) {
      if (field.getAttribute && field.getAttribute('contenteditable') === 'true') {
        field.setAttribute('contenteditable', 'false'); field.setAttribute('data-mls-preview-readonly', '1');
      } else markReadOnly(field);
    });
  }

  function renderLoadedMonth(ym, count) {
    function put(id, text) { var node = document.getElementById(id); if (node) node.textContent = text; }
    put('ez3cFound', String(count)); put('ez3cSaved', String(count)); put('ez3cDup', '0'); put('ez3cFail', '0');
    put('ez3PullNow', 'Loaded ' + count + ' invented appointment' + (count === 1 ? '' : 's') + ' for ' + ym + '.');
    put('ez3PullNow2', 'Memory-only sample data · MLS sent no request to Athena or MLS Assist.');
    var bar = document.getElementById('ez3PullBar'); if (bar) bar.style.width = '100%';
    rewriteStaffCopy(document);
    harden(document);
  }

  function chooseStaffRangeForMonth(ym) {
    var today = todayKey(), currentYm = ymOf(today), current = parseDay(today);
    current.setDate(1);
    current.setMonth(current.getMonth() - 1); var priorYm = keyOf(current).slice(0, 7);
    var button = null;
    if (ym === currentYm) button = document.querySelector('#ez3Seg [data-r="month"]');
    else if (ym === priorYm) button = document.querySelector('#ez3Seg [data-r="lastmonth"]');
    if (button) { button.click(); return; }
    button = document.querySelector('#ez3Seg [data-r="custom"]');
    if (!button) return; button.click();
    var from = document.getElementById('ez3From');
    if (from) { from.value = ym + '-01'; from.dispatchEvent(new Event('change', { bubbles: true })); }
    var to = document.getElementById('ez3To');
    if (to) { to.value = ym + '-' + pad2(monthLastDay(ym)); to.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  function loadSampleMonth() {
    var input = document.getElementById('ez3sMonth'), ym = input && input.value;
    if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) ym = ymOf(todayKey());
    var extra = monthAppointments(ym, currentPatients);
    var keep = (window._calAppts || []).filter(function (row) { return row && row.source !== MONTH_SOURCE; });
    installCalendar(keep.concat(extra));
    chooseStaffRangeForMonth(ym);
    window.setTimeout(function () { renderLoadedMonth(ym, extra.length); }, 0);
    explain('Loaded ' + extra.length + ' invented appointments for ' + ym + ' from memory only. Athena was not contacted.');
  }

  function loadSampleDay() {
    var day = todayKey(), daySwitch = window.__mlsDaySwitch, easy = window.__mlsEasyV32;
    try { if (daySwitch && typeof daySwitch.currentDay === 'function') day = daySwitch.currentDay() || day; } catch (e) {}
    var baseline = baseAppointments.filter(function (row) { return row.appt_date === day; });
    var rows = baseline;
    if (!rows.length) {
      rows = [
        appointment('preview-day-' + day + '-01', currentPatients[0], day, '08:15', 'Dr. Sample Clinician', 'Sample selected-day follow-up', DAY_SOURCE),
        appointment('preview-day-' + day + '-02', currentPatients[1], day, '09:45', 'Dr. Example Clinician', 'Sample selected-day consultation', DAY_SOURCE)
      ];
    }
    var keep = (window._calAppts || []).filter(function (row) {
      if (!row || row.appt_date !== day) return true;
      return row.source !== SOURCE && row.source !== DAY_SOURCE;
    });
    installCalendar(keep.concat(rows));
    try { if (daySwitch && typeof daySwitch.setDay === 'function') daySwitch.setDay(day); } catch (e2) {}
    try { if (easy && typeof easy.open === 'function') easy.open('home'); } catch (e3) {}
    selectSampleProvider();
    harden(document);
    explain('Reloaded ' + rows.length + ' invented appointment' + (rows.length === 1 ? '' : 's') + ' for ' + day + ' from memory only. Athena was not contacted.');
  }

  function openSampleAppointment(control) {
    var key = String(control && control.getAttribute('data-k') || '');
    var appointmentId = key.split('|')[0];
    var easy = window.__mlsEasyV32, opened = false;
    if (!/^preview-appt-/.test(appointmentId) && !/^preview-day-/.test(appointmentId) && !/^preview-month-/.test(appointmentId)) {
      explain('That sample appointment could not be verified. Nothing changed.'); return;
    }
    try {
      if (easy && easy.remote && typeof easy.remote.startVisitFor === 'function') {
        opened = easy.remote.startVisitFor(appointmentId, { record: false }) === true;
      }
    } catch (e) { opened = false; }
    if (!opened) { explain('That sample appointment could not be opened. Nothing changed.'); return; }
    harden(document);
    explain('Opened the invented patient without recording, saving, or contacting Athena.');
  }

  function blockedClick(event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-mls-preview-action],[data-mls-preview-blocked="1"]') : null;
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (target.getAttribute('data-mls-preview-action') === 'sample-month') loadSampleMonth();
    else if (target.getAttribute('data-mls-preview-action') === 'sample-day') loadSampleDay();
    else if (target.getAttribute('data-mls-preview-action') === 'open-sample-appointment') openSampleAppointment(target);
    else if (target.getAttribute('data-mls-preview-action') === 'voice-cluster') openVoiceCluster(target);
    else explain('That action is disabled in the read-only sample workspace. Nothing was sent, saved, recorded, or pulled.');
  }

  function blockedSubmit(event) {
    if (!event.target || (event.target.closest && event.target.closest('#' + STRIP_ID))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    explain('Forms cannot be submitted from the read-only sample workspace.');
  }

  function blockedEdit(event) {
    var target = event.target;
    if (!target || !target.getAttribute || target.getAttribute('data-mls-preview-readonly') !== '1') return;
    event.preventDefault(); event.stopImmediatePropagation();
    explain('Editing is disabled in the read-only sample workspace.');
  }

  function blockedChange(event) {
    var target = event.target;
    if (!target || !target.getAttribute || target.getAttribute('data-mls-preview-blocked') !== '1') return;
    event.preventDefault(); event.stopImmediatePropagation();
    explain('That setting cannot be changed in the read-only sample workspace.');
  }

  function blockedShortcut(event) {
    var key = String(event.key || '').toLowerCase();
    var target = event.target;
    var typing = target && /^(?:INPUT|TEXTAREA|SELECT)$/.test(String(target.tagName || '').toUpperCase());
    if ((!typing && key === '/' && !event.altKey && !event.ctrlKey && !event.metaKey) ||
        (key === 'k' && !event.altKey && (event.ctrlKey || event.metaKey))) {
      event.preventDefault(); event.stopImmediatePropagation();
      explain('Global commands are off in the read-only sample workspace. Use Today, Patients, or History.');
      return;
    }
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (key !== 'g' && key !== 'r' && key !== 's') return;
    event.preventDefault(); event.stopImmediatePropagation();
    explain('Recording, generation, and saving shortcuts are disabled in the sample workspace.');
  }

  function installGuards() {
    window.addEventListener('click', blockedClick, true);
    window.addEventListener('submit', blockedSubmit, true);
    window.addEventListener('beforeinput', blockedEdit, true);
    window.addEventListener('paste', blockedEdit, true);
    window.addEventListener('drop', blockedEdit, true);
    window.addEventListener('change', blockedChange, true);
    window.addEventListener('keydown', blockedShortcut, true);
    harden(document);
    try {
      observer = new MutationObserver(function (records) {
        if (!document.getElementById(STRIP_ID)) mountStrip();
        var addedElement = false;
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes || [], function (node) {
            if (node && node.nodeType === 1) { addedElement = true; harden(node, true); }
          });
        });
        /* Existing-node clock/status text changes are deliberately ignored.
           Only newly-rendered controls need another global truth/safety pass. */
        if (addedElement) rewritePreviewCopy();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  function canonicalToday() {
    installCalendar(baseAppointments);
    refreshSeedThroughApp();
    try { if (typeof showView === 'function') showView('visit'); } catch (e) {}
    var today = todayKey(), daySwitch = window.__mlsDaySwitch, easy = window.__mlsEasyV32;
    try {
      if (daySwitch && typeof daySwitch.setDay === 'function') daySwitch.setDay(today);
      else if (easy && easy.remote && typeof easy.remote.setVisitDay === 'function') easy.remote.setVisitDay(today);
    } catch (e2) {}
    try { if (easy && typeof easy.open === 'function') easy.open('home'); } catch (e3) {}
    harden(document);
    ready = !!(document.getElementById('mlsEz3') && document.getElementById('ez3Wrap'));
    try {
      window.dispatchEvent(new CustomEvent('mls:public-preview-ready', {
        detail: { version: VERSION, account: EMAIL, today: today, appointments: baseAppointments.length, ready: ready }
      }));
    } catch (e4) {}
    return ready;
  }

  function onUiReady() {
    canonicalToday();
    window.setTimeout(canonicalToday, 120);
    window.setTimeout(canonicalToday, 700);
  }

  /* Seed synchronously. ScribeFlow's already-registered DOMContentLoaded
     handler then finds this local account and enters startSession without any
     signup or legal-manifest ceremony. */
  var initialToday = todayKey();
  writeStorage(initialToday);
  adoptSyntheticUser();

  function boot() {
    mountStrip();
    adoptSyntheticUser();
    var activeEmail = '';
    try { if (typeof getSessionEmail === 'function') activeEmail = getSessionEmail(); } catch (e) {}
    if (String(activeEmail || '').toLowerCase() !== EMAIL) {
      try { if (typeof startSession === 'function') startSession(EMAIL); } catch (e2) {}
    }
    installCalendar(baseAppointments);
    refreshSeedThroughApp();
    installGuards();
    window.addEventListener('mls:ui-ready', onUiReady);
    try {
      if (window.__mlsUiBundleReady) onUiReady();
      else if (window.__mlsSessionReady && typeof window.__mlsSessionReady.then === 'function') window.__mlsSessionReady.then(onUiReady, onUiReady);
    } catch (e3) {}
  }

  window.__MLS_PUBLIC_PREVIEW_RUNTIME = Object.freeze({
    installed: true, version: VERSION, account: EMAIL, source: SOURCE,
    syntheticOnly: true, storageMode: 'memory', ready: function () { return ready; },
    reset: resetPreview, exit: exitPreview, canonicalToday: canonicalToday,
    sampleCounts: function () { return { patients: currentPatients.length, notes: currentNotes.length, appointments: baseAppointments.length }; }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window, document);
