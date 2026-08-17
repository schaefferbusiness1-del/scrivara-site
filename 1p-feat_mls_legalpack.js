/* ============================================================================
   MLS 1p PREVIEW ONLY - Medical-Legal / IME Draft Workspace
   __mlsP1LegalPack p1-legal-1.0.0

   This is deliberately not the networked Legal product. It is an isolated,
   reversible preview overlay with a smaller authority surface:
     - exact currently-active patient only; no patient search or retargeting
     - read-only chart chronology; no patient/chart/Athena writes
     - browser-local PDF, DOCX and text extraction; raw file bytes are never uploaded
     - 14-section AI draft (13 chronology sections + OPINIONS) through the
       app's existing aiCallRaw only, closed by a locally written attestation
     - copy, download and print are the only exits

   There is no intake, public PHI form, payment, lawyer messaging, signing,
   delivery, chart filing, Athena bridge or /api/legal call in this module.
   ============================================================================ */
(function () {
  'use strict';
  if (!window.__MLS_P1_PREVIEW || window.__MLS_P1_PREVIEW.enabled !== true) return;
  var installScript = document.currentScript;
  var liveLoader = window.__mlsP1LegalLoader;
  if (!installScript || !liveLoader || liveLoader.installed !== true || liveLoader.version !== 'p1-legal-1.0.0' ||
      !liveLoader.installToken || installScript.getAttribute('data-mls-install-token') !== liveLoader.installToken ||
      installScript.getAttribute('data-mls-asset') !== 'feat_mls_legalpack.js') return;
  if (window.__mlsP1LegalPack && window.__mlsP1LegalPack.installed) return;

  var VERSION = 'p1-legal-1.0.0';
  var ROOT_ID = 'mlsP1LegalRoot';
  var STYLE_ID = 'mlsP1LegalStyle';
  var MAX_LOCAL_FILE_BYTES = 20 * 1024 * 1024;
  var MAX_LOCAL_TOTAL_BYTES = 50 * 1024 * 1024;
  var MAX_LOCAL_FILES = 8;
  var MAX_LOCAL_READERS = 2;
  var MAX_LOCAL_TEXT_CHARS = 60000;
  var MAX_AI_CONTEXT_CHARS = 105000;
  var LOCAL_PARSE_TIMEOUT_MS = 20000;
  var AI_CALL_TIMEOUT_MS = 45000;
  var AI_RUN_TIMEOUT_MS = 8 * 60 * 1000;
  var autoOpenTimer = null;
  var queryOpenPending = false;
  var door = null;
  var doorSnapshot = null;
  var doorClick = null;
  var originalTogglePtMore = null;
  var wrappedTogglePtMore = null;
  var api = null;
  var apiLive = true;
  var state = {
    open: false,
    session: 0,
    runSeq: 0,
    run: null,
    bound: null,
    model: null,
    providerFilter: null,
    sources: [],
    imports: {},
    importQueue: [],
    importActive: 0,
    importSeq: 0,
    draft: '',
    generating: false,
    priorFocus: null,
    /* ===== p1-legal-flow-2.0.0 state ===== */
    stage: 'unbound',      /* unbound | bound | report-picked | generated | exported */
    reportType: '',        /* key into REPORT_TYPES; '' until the clinician picks */
    snapshot: null,        /* the frozen chart snapshot the chronology was built from */
    snapshotSig: '',       /* signature of that snapshot, re-measured to detect drift */
    snapshotAt: 0,
    rebindIntent: null,    /* {patientId, at} - an IN-WORKSPACE Change, not an external switch */
    athenaOp: '',          /* the read op currently running, '' when idle */
    athenaNote: ''         /* last honest receipt from an Athena read */
  };

  function isFn(value) { return typeof value === 'function'; }
  function byId(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
  }
  function toast(message, kind) {
    try { if (isFn(window.toast)) window.toast(message, kind || ''); } catch (e) {}
  }
  function currentAccountUser() {
    try {
      if (typeof bkUser !== 'undefined') return bkUser;
      if (Object.prototype.hasOwnProperty.call(window, 'bkUser')) return window.bkUser;
    } catch (e) {}
    return undefined;
  }
  function clinicalAccess() {
    var user = currentAccountUser();
    if (typeof user === 'undefined') return 'unknown';
    if (!user) return 'blocked';
    var role = clean(user.role).toLowerCase();
    if (role === 'receptionist' || role === 'lawyer' || user.isLawyer === true) return 'blocked';
    if (user.isAdmin === true || user.isHead === true || /^(owner|admin|head|user|doctor|clinician|physician)$/.test(role)) return 'eligible';
    return 'blocked';
  }
  function snapshotNode(node) {
    var attrs = [];
    try {
      if (isFn(node.getAttributeNames)) node.getAttributeNames().forEach(function (name) { attrs.push([name, node.getAttribute(name)]); });
      else Array.prototype.forEach.call(node.attributes || [], function (attr) { attrs.push([attr.name, attr.value]); });
    } catch (e) {}
    return { node: node, attrs: attrs, text: node.textContent };
  }
  function restoreNode(snapshot) {
    if (!snapshot || !snapshot.node) return;
    var node = snapshot.node;
    try {
      var names = isFn(node.getAttributeNames) ? node.getAttributeNames() : Array.prototype.slice.call(node.attributes || []).map(function (attr) { return attr.name; });
      names.forEach(function (name) { node.removeAttribute(name); });
      snapshot.attrs.forEach(function (pair) { node.setAttribute(pair[0], pair[1]); });
      node.textContent = snapshot.text;
    } catch (e) {}
  }
  function releaseDoor() {
    if (door && doorClick) try { door.removeEventListener('click', doorClick); } catch (e) {}
    restoreNode(doorSnapshot);
    door = null; doorSnapshot = null; doorClick = null;
  }
  function doorEligible() { return clinicalAccess() === 'eligible'; }
  function syncDoor() {
    var node = byId('ptLawyerBtn');
    if (!node || !doorEligible()) { releaseDoor(); return false; }
    if (door !== node) {
      releaseDoor(); door = node; doorSnapshot = snapshotNode(node);
      doorClick = function (event) {
        if (event) { event.preventDefault(); event.stopPropagation(); }
        if (!doorEligible()) { syncDoor(); return; }
        openOverlay();
      };
      node.addEventListener('click', doorClick);
    }
    node.hidden = false; node.disabled = false;
    node.removeAttribute('hidden'); node.removeAttribute('disabled'); node.removeAttribute('aria-disabled');
    node.removeAttribute('aria-hidden'); node.removeAttribute('tabindex');
    node.style.display = '';
    node.textContent = '⚖️ Legal / IME — Free preview';
    node.setAttribute('title', 'Open the free 1p read-only Legal / IME draft preview for the exact active patient');
    node.setAttribute('data-mls-p1-legal-door', VERSION);
    return true;
  }
  function installDoorHook() {
    try {
      if (!wrappedTogglePtMore && isFn(window.togglePtMore)) {
        originalTogglePtMore = window.togglePtMore;
        wrappedTogglePtMore = function () {
          var result = originalTogglePtMore.apply(this, arguments);
          syncDoor();
          return result;
        };
        window.togglePtMore = wrappedTogglePtMore;
      }
    } catch (e) {}
    syncDoor();
  }
  function removeDoorHook() {
    releaseDoor();
    try { if (wrappedTogglePtMore && window.togglePtMore === wrappedTogglePtMore) window.togglePtMore = originalTogglePtMore; } catch (e) {}
    wrappedTogglePtMore = null; originalTogglePtMore = null;
  }
  function makeAbortController() {
    try { if (typeof AbortController === 'function') return new AbortController(); } catch (e) {}
    var listeners = [], signal = {
      aborted: false,
      addEventListener: function (name, fn) { if (name === 'abort' && isFn(fn)) listeners.push(fn); },
      removeEventListener: function (name, fn) { if (name === 'abort') listeners = listeners.filter(function (x) { return x !== fn; }); }
    };
    return { signal: signal, abort: function () {
      if (signal.aborted) return; signal.aborted = true;
      listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} }); listeners = [];
    } };
  }
  function abortError(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function pad2(value) { value = String(value); return value.length < 2 ? '0' + value : value; }
  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function ymd(value) {
    try {
      if (value == null || value === '') return '';
      var s = String(value).trim(), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (m) return m[1] + '-' + m[2] + '-' + m[3];
      m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/.exec(s);
      if (m) {
        var year = m[3].length === 2 ? ((+m[3] > 40 ? '19' : '20') + m[3]) : m[3];
        return year + '-' + pad2(m[1]) + '-' + pad2(m[2]);
      }
      var d = new Date(value);
      return isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    } catch (e) { return ''; }
  }
  function niceDate(value) {
    if (!value) return 'Undated';
    try {
      var p = value.split('-');
      return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch (e) { return value; }
  }

  /* Exact active-record snapshot. An id alone is insufficient: an async result
     also has to match the active-patient switch epoch captured at open time. */
  function activePatientNow() {
    try { return isFn(window.activePatient) ? window.activePatient() : null; } catch (e) { return null; }
  }
  function activeIdNow() {
    try {
      if (isFn(window.getActivePtId)) return clean(window.getActivePtId());
      var p = activePatientNow(); return p ? clean(p.id) : '';
    } catch (e) { return ''; }
  }
  function captureBinding() {
    var p = activePatientNow();
    if (!p || !clean(p.id) || activeIdNow() !== clean(p.id)) return null;
    return Object.freeze({
      patientId: clean(p.id),
      patientEpoch: Number(window._mlsActivePtEpoch || 0),
      name: clean(p.name),
      dob: clean(p.dob),
      mrn: clean(p.mrn)
    });
  }
  function bindingCurrent(binding) {
    if (!binding || activeIdNow() !== binding.patientId) return false;
    if (Number(window._mlsActivePtEpoch || 0) !== Number(binding.patientEpoch || 0)) return false;
    var p = activePatientNow();
    return !!p && clean(p.id) === binding.patientId;
  }
  function pendingImportCount() { return Object.keys(state.imports).length; }
  function runSlotOwned(run) {
    return !!run && state.run === run && run.session === state.session && state.open && state.bound === run.binding;
  }
  function runOwned(run) {
    return runSlotOwned(run) && bindingCurrent(run.binding);
  }
  function clearRunTimers(run) {
    if (!run) return;
    if (run.wholeTimer) { clearTimeout(run.wholeTimer); run.wholeTimer = null; }
    (run.callControllers || []).forEach(function (controller) { try { controller.abort(); } catch (e) {} });
    run.callControllers = [];
  }
  function abortCurrentRun(reason) {
    var run = state.run;
    if (!run) return false;
    state.run = null;
    run.cancelReason = reason || 'canceled';
    clearRunTimers(run);
    try { run.controller.abort(); } catch (e) {}
    if (run.session === state.session) state.generating = false;
    updateControls();
    return true;
  }
  function cancelAllImports() {
    var tasks = state.imports;
    state.imports = {}; state.importQueue = []; state.importActive = 0;
    Object.keys(tasks).forEach(function (id) { try { tasks[id].controller.abort(); } catch (e) {} });
    updateControls();
  }
  function abortForPatientChange() {
    if (!state.open || bindingCurrent(state.bound)) return false;
    abortCurrentRun('patient-changed');
    cancelAllImports();
    state.session++;
    state.bound = null;
    state.model = null;
    state.providerFilter = null;
    state.sources = [];
    state.draft = '';
    state.open = false;
    state.stage = 'unbound';
    state.reportType = '';
    state.snapshot = null; state.snapshotSig = ''; state.snapshotAt = 0;
    state.rebindIntent = null; state.athenaOp = ''; state.athenaNote = '';
    renderNoPatient('The active patient changed. This preview closed the prior workspace and discarded every in-progress result. Open Legal / IME again for the patient now on screen.');
    return true;
  }

  var CATEGORIES = [
    ['visit', 'Visits & encounters'],
    ['procedure', 'Procedures & operative notes'],
    ['imaging', 'Imaging & diagnostic studies'],
    ['diagnosis', 'Diagnoses'],
    ['plan', 'Treatment plans'],
    ['followup', 'Follow-ups'],
    ['document', 'Uploaded chart records'],
    ['outside', 'Outside records']
  ];
  var CATEGORY_ICONS = {
    visit: '\uD83E\uDE7A', procedure: '\uD83D\uDD2A', imaging: '\uD83E\uDDBB', diagnosis: '\uD83E\uDDEC',
    plan: '\uD83D\uDCCB', followup: '\uD83D\uDCC5', document: '\uD83D\uDCCE', outside: '\uD83C\uDFE5'
  };
  var RE_PROCEDURE = /\b(operative|procedure|surgery|surgical|injection|epidural|arthroscop|fusion|discectomy|laminectomy|ablation|rfa|block)\b/i;
  var RE_IMAGING = /\b(mri|x-?ray|radiograph|ct\b|ultrasound|emg|ncs\b|dexa|imaging|diagnostic stud)/i;
  var RE_OUTSIDE = /\b(outside|external|records from|hospital records|emergency department|transferred)\b/i;
  var RE_FOLLOW = /\b(follow[ -]?up|f\/u|return in|return to|recheck|re-evaluate|next visit)\b/i;

  /* ===== p1-legal-restore-2.0.0 ===========================================
     Behaviour the /1p fork LOST when it was written from scratch instead of
     forked from the shipped production pack. Each item below is a measured
     production behaviour (feat_mls_legalpack.js) that the fork did not have,
     restored here without weakening any 1p authority boundary. The fork's own
     additions (exact-binding ownership, local-only file reading, letterhead,
     IME certainty framing) are untouched.

       1. provOfVisit    - an imported chart row usually carries NO `provider`
                           field; the clinician's name is inside the raw text
                           line "MM-DD-YYYY, Provider, Cred, Specialty". The
                           fork read only the explicit field, so every imported
                           row collapsed into one "Unattributed" chip and the
                           provider filter had nothing to filter.
       2. normProv       - "M Schaeffer" and "M Schaeffer, DO" were two chips.
       3. classifiable   - that same raw athenaOne line ends in the provider's
                           SPECIALTY. "Orthopedic Surgery" made RE_PROCEDURE
                           match, so ordinary office visits were filed as
                           operative notes. Strip those lines before matching.
       4. RE_OPMARK      - a note that MENTIONS a prior injection is still a
                           visit. Only an explicit operative/procedure-note
                           marker promotes a note to `procedure`.
       5. planOf         - the fork's inline PLAN regex stopped at the first
                           ALL-CAPS heading only; production also stops at a
                           following S:/O:/A: block, which is how dictated
                           SOAP notes are actually shaped.
       6. icdOf          - diagnoses were regex-scraped from prose only. The
                           structured `note.coding` object the app already
                           stores was ignored entirely.
       7. calendar follow-ups - a scheduled FUTURE appointment is a documented
                           follow-up and belongs in a legal chronology.
       8. visit aiSummary - stored AI summaries were dropped silently.
       9. activeFilterNote - the fork filtered the EXPORT by provider without
                           saying so anywhere in the exported document. A
                           records-request compilation that silently omits a
                           provider is the single most dangerous thing this
                           tool can produce.
     ====================================================================== */
  /* explicit op/procedure-NOTE markers - much stricter than RE_PROCEDURE */
  var RE_OPMARK = /\b(operative\s+(?:report|note)|procedure\s+note|procedure\s*(?:\(s\))?\s+performed|description\s+of\s+(?:the\s+)?procedure|operation\s+performed)\b/i;
  var RE_ATHENA_ROW = /^\s*\d{2}-\d{2}-\d{4}/;
  var RE_SLASH_ROW = /^\s*\d{1,2}\/\d{1,2}\/\d{2,4}/;

  /* Provider of an imported row: explicit field first, else the raw athenaOne
     line "<type>\n<MM-DD-YYYY[ h:mm AM]>, <Provider>, <Cred>, <Specialty>". */
  function provOfVisit(row) {
    try {
      var explicit = providerOf(row);
      if (explicit) return explicit;
      var raw = String((row && (row.raw || row.detail)) || '');
      var lines = raw.split(/\r?\n/);
      for (var i = 0; i < lines.length && i < 4; i++) {
        var ln = lines[i];
        if (RE_ATHENA_ROW.test(ln) || RE_SLASH_ROW.test(ln)) {
          var parts = ln.split(',');
          if (parts.length >= 2) {
            var cand = clean(parts[1]);
            if (cand && !/^\d/.test(cand)) return cand;
          }
        }
      }
    } catch (e) {}
    return '';
  }
  /* Group providers without credential suffixes so one clinician is ONE chip. */
  function normProv(value) {
    return clean(String(value == null ? '' : value)
      .replace(/\s*,?\s*(MD|DO|PA-?C?|NP|CRNP|DPT|PT|RN|FNP|APRN)\.?\s*$/i, ''));
  }
  /* Strip athenaOne "MM-DD-YYYY, Provider, Cred, Specialty" lines so a
     provider's SPECIALTY never mis-classifies the row. */
  function classifiable(type, body) {
    var lines = String(body || '').split(/\r?\n/).filter(function (ln) {
      return !((RE_ATHENA_ROW.test(ln) || RE_SLASH_ROW.test(ln)) && ln.indexOf(',') >= 0);
    });
    return String(type || '') + '\n' + lines.join('\n');
  }
  /* PLAN section of a SOAP-style note ('' when the note has none). */
  function planOf(text) {
    try {
      var m = String(text || '').match(/(?:^|\n)\s*(?:P\s*[:\-]|PLAN\s*[:\-]?)\s*\n?([\s\S]*?)(?=\n\s*(?:[A-Z][A-Z /&-]{3,}:|S\s*:|O\s*:|A\s*:)|$)/);
      if (!m || !clean(m[1])) return '';
      return m[1].trim();
    } catch (e) { return ''; }
  }
  function fuLinesOf(text) {
    var out = [];
    try {
      String(text || '').split(/\r?\n/).forEach(function (ln) { if (RE_FOLLOW.test(ln)) out.push(ln.trim()); });
    } catch (e) {}
    return out;
  }
  /* Structured ICD-10 coding the app already stores, then prose as a fallback. */
  function icdOf(coding) {
    var out = [];
    try {
      if (!coding) return out;
      var arr = Array.isArray(coding.icd) ? coding.icd : (Array.isArray(coding.icd10) ? coding.icd10 : null);
      if (arr) {
        arr.forEach(function (c) {
          var t = typeof c === 'string' ? c : (clean(c && c.code) + ((c && c.desc) ? ' - ' + clean(c.desc) : ''));
          if (clean(t)) out.push(clean(t));
        });
        return out;
      }
      var txt = typeof coding === 'string' ? coding : '';
      (String(txt).match(/\b[A-TV-Z]\d{2}(?:\.\d{1,4})?\b[^\n]*/g) || []).forEach(function (l) { out.push(l.trim()); });
    } catch (e) {}
    return out;
  }
  /* The honest export banner for an active provider filter. */
  function activeFilterNote() {
    if (!state.model || !state.providerFilter) return '';
    var off = state.model.providers.filter(function (p) { return state.providerFilter[p] === false; });
    if (!off.length) return '';
    return 'PROVIDER FILTER ACTIVE - EXCLUDED FROM THIS COMPILATION: ' + off.join(', ') +
      '. This compilation is therefore PARTIAL; request an unfiltered copy for a complete record.';
  }
  /* ===== end p1-legal-restore-2.0.0 ===== */

  function visitsFor(patient) {
    try {
      var vm = window.__mlsVisitModel;
      if (vm && isFn(vm.getVisits)) return clone(vm.getVisits(patient) || []) || [];
    } catch (e) {}
    return clone(patient && Array.isArray(patient.visits) ? patient.visits : []) || [];
  }
  function notesFor(patient) {
    try { return clone(isFn(window.patientNotes) ? (window.patientNotes(patient.id) || []) : []) || []; }
    catch (e) { return []; }
  }
  function documentsFor(patient) {
    return clone(patient && Array.isArray(patient.docs) ? patient.docs : []) || [];
  }
  function providerOf(row) {
    return clean(row && (row.provider || row.providerName || row.doctor || row.clinician));
  }
  function rowMatchesBinding(row, binding) {
    if (!row || !binding) return false;
    var rowPatientId = clean(row.patientId || row.patient_id || row.ptId || row.patient || '');
    return !rowPatientId || rowPatientId === binding.patientId;
  }
  function addItem(items, item) {
    /* p1-legal-restore-2.0.0: normProv collapses "M Schaeffer" and
       "M Schaeffer, DO" into ONE provider chip. */
    item.provider = normProv(item.provider) || 'Unattributed';
    item.body = String(item.body || '').trim();
    item.title = clean(item.title) || 'Record entry';
    item.date = ymd(item.date);
    items.push(item);
  }
  function buildModel(patientSnapshot, binding) {
    if (!patientSnapshot || !binding || clean(patientSnapshot.id) !== binding.patientId) {
      return { binding: binding || null, items: [], providers: [], counts: {} };
    }
    var items = [];
    visitsFor(patientSnapshot).forEach(function (row) {
      if (!rowMatchesBinding(row, binding)) return;
      var type = clean(row.type || row.procedure || row.title) || 'Visit';
      var body = String(row.detail || row.raw || row.text || '').trim();
      /* p1-legal-restore-2.0.0: classifiable() drops the athenaOne
         "MM-DD-YYYY, Provider, Cred, Specialty" line so a provider's SPECIALTY
         cannot file an office visit as an operative note. The TYPE decides
         imaging/procedure; only an explicit op-note MARKER promotes prose. */
      var blob = classifiable(type, body);
      var category = RE_OUTSIDE.test(blob) ? 'outside'
        : (RE_IMAGING.test(type) ? 'imaging'
        : (RE_PROCEDURE.test(type) || RE_OPMARK.test(blob) ? 'procedure' : 'visit'));
      var summary = clean(row.aiSummary);
      addItem(items, { date: row.date || row.updated, category: category, title: type,
        provider: provOfVisit(row), source: clean(row.source) || 'Stored visit',
        body: body + (summary ? ((body ? '\n\n' : '') + 'AI summary (AI-generated - verify): ' + summary) : '') });
    });
    notesFor(patientSnapshot).forEach(function (note) {
      if (!rowMatchesBinding(note, binding) || note.isDraft) return;
      var body = String(note.soap || note.text || '').trim();
      var when = note.updated || note.created;
      var isOp = RE_OPMARK.test(body.slice(0, 900));
      addItem(items, { date: when, category: isOp ? 'procedure' : 'visit',
        title: (isOp ? 'Procedure / operative note' : 'Visit note') + (note.signed ? ' (signed)' : ' (unsigned)'),
        provider: provOfVisit(note), source: 'MLS visit note', body: body });
      var plan = planOf(body);
      if (plan) addItem(items, { date: when, category: 'plan', title: 'Documented treatment plan', provider: provOfVisit(note), source: 'MLS visit note (Plan section)', body: plan });
      fuLinesOf(plan || body).forEach(function (line) {
        addItem(items, { date: when, category: 'followup', title: 'Documented follow-up', provider: provOfVisit(note), source: 'MLS visit note', body: line });
      });
      /* structured coding first (p1-legal-restore-2.0.0), prose as a fallback */
      var coded = icdOf(note.coding);
      if (coded.length) {
        coded.forEach(function (dx) {
          addItem(items, { date: when, category: 'diagnosis', title: clean(dx.split(' - ')[0]) || 'Diagnosis',
            provider: provOfVisit(note), source: 'Visit coding (ICD-10)', body: dx });
        });
      } else {
        (body.match(/\b[A-TV-Z]\d{2}(?:\.\d{1,4})?\b[^\n]*/g) || []).forEach(function (line) {
          addItem(items, { date: when, category: 'diagnosis', title: clean(line), provider: provOfVisit(note), source: 'Documented diagnosis', body: line });
        });
      }
      if (RE_IMAGING.test(body)) {
        var imaging = body.split(/\r?\n/).filter(function (line) { return RE_IMAGING.test(line); }).slice(0, 12);
        if (imaging.length) addItem(items, { date: when, category: 'imaging', title: 'Imaging referenced in note', provider: provOfVisit(note), source: 'MLS visit note', body: imaging.join('\n') });
      }
    });
    String(patientSnapshot.problems || '').split(/\r?\n|;/).map(clean).filter(Boolean).forEach(function (problem) {
      addItem(items, { date: '', category: 'diagnosis', title: problem, provider: 'Unattributed', source: 'Problem list', body: problem });
    });
    documentsFor(patientSnapshot).forEach(function (doc) {
      if (!rowMatchesBinding(doc, binding)) return;
      var name = clean(doc.name) || 'Chart document';
      var text = String(doc.text || doc.aiSummary || '').trim();
      addItem(items, { date: doc.date || doc.updated, category: RE_OUTSIDE.test(name + '\n' + text.slice(0, 1800)) ? 'outside' : 'document',
        title: name + (doc.kind === 'image' ? ' (image)' : ''), provider: 'Unattributed', source: 'Stored chart document',
        body: text ? text.slice(0, 20000) + (text.length > 20000 ? '\n[truncated for preview display]' : '') : '(no extractable text stored)' });
    });
    /* p1-legal-restore-2.0.0: a SCHEDULED FUTURE appointment is a documented
       follow-up. Matched on the exact bound name only; an unnamed or
       non-matching calendar row is never attributed to this patient. */
    try {
      var boundName = clean(binding.name).toLowerCase();
      var today = todayYmd();
      (window._calAppts || []).forEach(function (appt) {
        var apptName = clean(appt && appt.name).toLowerCase();
        if (!apptName || !boundName || apptName !== boundName) return;
        var when = ymd(appt.appt_date || String(appt.start_at || '').slice(0, 10));
        if (!when || when <= today) return;
        addItem(items, { date: when, category: 'followup', title: 'Scheduled appointment',
          provider: provOfVisit(appt), source: 'MLS calendar', body: clean(appt.reason) || 'Scheduled visit' });
      });
    } catch (e) {}
    items.sort(function (a, b) {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1; if (!b.date) return -1;
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    });
    var providerSet = {}, counts = {};
    items.forEach(function (item) { providerSet[item.provider] = true; counts[item.category] = (counts[item.category] || 0) + 1; });
    return { binding: binding, items: items, providers: Object.keys(providerSet).sort(), counts: counts };
  }
  function filteredItems() {
    if (!state.model) return [];
    if (!state.providerFilter) return state.model.items.slice();
    return state.model.items.filter(function (item) { return state.providerFilter[item.provider] !== false; });
  }
  function chronologyText() {
    if (!state.model || !state.bound || !bindingCurrent(state.bound)) {
      if (state.open) abortForPatientChange();
      return '';
    }
    var lines = ['READ-ONLY MEDICAL-LEGAL CHRONOLOGY', 'Patient: ' + (state.bound.name || '[name unavailable]'),
      'DOB: ' + (state.bound.dob || '[not documented]') + (state.bound.mrn ? ' | MRN: ' + state.bound.mrn : ''),
      'Compiled: ' + new Date().toLocaleString(),
      'Preview draft source; handle as PHI.'];
    /* p1-legal-restore-2.0.0: an export whose provider filter silently drops a
       clinician is a partial record presented as a whole one. Say it, at the
       top, in the exported bytes - not only in the on-screen chips. */
    var note = activeFilterNote();
    if (note) lines.push('', note);
    lines.push('');
    var items = filteredItems();
    CATEGORIES.forEach(function (category) {
      var rows = items.filter(function (item) { return item.category === category[0]; });
      lines.push(category[1].toUpperCase() + ' (' + rows.length + ')');
      lines.push('--------------------------------------------------');
      if (!rows.length) lines.push('(none documented)');
      rows.forEach(function (item) {
        lines.push(niceDate(item.date) + ' - ' + item.title + ' - ' + item.provider + ' [' + item.source + ']');
        if (item.body && item.body !== item.title) lines.push(item.body);
        lines.push('');
      });
      lines.push('');
    });
    lines.push('Compiled locally from the exact active chart snapshot. No data was written or delivered.');
    lines.push('Nothing here is invented; anything missing from the chart is shown as missing.');
    return lines.join('\n');
  }

  /* Browser-local readers only. The shared PDF/DOCX helpers are client-side
     parsers. Image OCR is intentionally absent because its existing helper uses
     a backend vision route, which would upload a file. */
  function readLocalFile(file, options) {
    var name = clean(file && file.name), lower = name.toLowerCase();
    if (!file) return Promise.reject(new Error('No file selected.'));
    if (Number(file.size || 0) > MAX_LOCAL_FILE_BYTES) {
      return Promise.reject(new Error('This local file is over the 20 MB preview limit. Split it into smaller searchable records; nothing was uploaded.'));
    }
    var work;
    try {
      if (/\.pdf$/.test(lower)) {
        if (!isFn(window.extractPdfText)) return Promise.reject(new Error('Local PDF reader unavailable.'));
        work = Promise.resolve(window.extractPdfText(file));
      } else if (/\.docx$/.test(lower)) {
        if (!isFn(window._extractDocxText)) return Promise.reject(new Error('Local Word reader unavailable.'));
        work = Promise.resolve(window._extractDocxText(file));
      } else if (/^text\//i.test(file.type || '') || /\.(txt|md|markdown|rtf|csv|tsv|json|html?)$/.test(lower)) {
        work = isFn(file.text) ? Promise.resolve(file.text()) : Promise.reject(new Error('Local text reader unavailable.'));
      } else if (/^image\//i.test(file.type || '') || /\.(png|jpe?g|webp|gif|bmp|heic|tiff?)$/.test(lower)) {
        return Promise.reject(new Error('Image OCR is disabled here because this preview never uploads files. Save the scan as a searchable PDF or paste its text.'));
      } else return Promise.reject(new Error('Use a local text, searchable PDF, or DOCX file.'));
    } catch (e) { work = Promise.reject(e); }
    options = options || {};
    if (!options.signal && !options.timeoutMs) return work;
    return new Promise(function (resolve, reject) {
      var done = false, timer = null, signal = options.signal;
      function finish(ok, value) {
        if (done) return; done = true;
        if (timer) clearTimeout(timer);
        if (signal && isFn(signal.removeEventListener)) signal.removeEventListener('abort', onAbort);
        if (ok) resolve(value); else reject(value);
      }
      function onAbort() { finish(false, abortError('local-read-canceled', 'Local file reading was canceled.')); }
      if (signal && signal.aborted) return onAbort();
      if (signal && isFn(signal.addEventListener)) signal.addEventListener('abort', onAbort, { once: true });
      if (options.timeoutMs) timer = setTimeout(function () {
        finish(false, abortError('local-read-timeout', 'Local file reading reached the 20-second preview limit. Try a smaller searchable file.'));
        try { if (options.controller) options.controller.abort(); } catch (e) {}
      }, options.timeoutMs);
      work.then(function (value) { finish(true, value); }, function (error) { finish(false, error); });
    });
  }
  function fileCount() { return state.sources.length + pendingImportCount(); }
  function fileBytes() {
    var total = state.sources.reduce(function (n, source) { return n + Number(source.bytes || 0); }, 0);
    Object.keys(state.imports).forEach(function (id) { total += Number(state.imports[id].bytes || 0); });
    return total;
  }
  function settleImport(task, error, text) {
    if (state.imports[task.id] !== task) return;
    delete state.imports[task.id];
    if (task.started) state.importActive = Math.max(0, state.importActive - 1);
    if (state.open && task.session === state.session && state.bound === task.binding && !bindingCurrent(task.binding)) {
      abortForPatientChange(); return;
    }
    if (state.open && task.session === state.session && state.bound === task.binding && bindingCurrent(task.binding)) {
      text = String(text || '').trim();
      state.sources.push({ id: task.id, name: task.name, bytes: task.bytes, chars: text.length,
        text: text.slice(0, MAX_LOCAL_TEXT_CHARS), truncated: text.length > MAX_LOCAL_TEXT_CHARS,
        error: error ? (clean(error.message) || 'Local read failed.') : (text ? '' : 'No readable text layer.') });
      setStatus(error ? ('Could not read ' + task.name + ': ' + (clean(error.message) || 'local read failed') + '.') :
        (pendingImportCount() ? ('Read ' + task.name + '. ' + pendingImportCount() + ' local file(s) still pending.') : 'All selected local records are ready. Generate is available.'), !!error);
      renderSources();
    }
    updateControls(); pumpImports();
  }
  function pumpImports() {
    if (state.open && state.bound && !bindingCurrent(state.bound)) { abortForPatientChange(); return; }
    while (state.open && state.importActive < MAX_LOCAL_READERS && state.importQueue.length) {
      var task = state.importQueue.shift();
      if (!task || state.imports[task.id] !== task) continue;
      if (task.session !== state.session || state.bound !== task.binding || !bindingCurrent(task.binding)) { cancelImport(task.id); continue; }
      task.started = true; state.importActive++;
      renderSources(); updateControls();
      readLocalFile(task.file, { signal: task.controller.signal, controller: task.controller, timeoutMs: LOCAL_PARSE_TIMEOUT_MS }).then(function (ownedTask) {
        return function (text) { settleImport(ownedTask, null, text); };
      }(task), function (ownedTask) {
        return function (error) { settleImport(ownedTask, error, ''); };
      }(task));
    }
  }
  function cancelImport(id) {
    var task = state.imports[id];
    if (!task) return false;
    delete state.imports[id];
    state.importQueue = state.importQueue.filter(function (queued) { return queued !== task; });
    if (task.started) state.importActive = Math.max(0, state.importActive - 1);
    try { task.controller.abort(); } catch (e) {}
    renderSources(); updateControls(); pumpImports();
    return true;
  }
  function addFiles(fileList) {
    if (!state.open || !state.bound || !bindingCurrent(state.bound)) { abortForPatientChange(); return 0; }
    if (state.run || state.generating) { setStatus('Wait for the current draft run to finish or cancel it before adding files.', true); return 0; }
    var files = Array.prototype.slice.call(fileList || []), accepted = 0, refused = [];
    files.forEach(function (file) {
      var bytes = Number(file && file.size || 0), name = clean(file && file.name) || 'Local file';
      if (fileCount() >= MAX_LOCAL_FILES) { refused.push('Only ' + MAX_LOCAL_FILES + ' local files may be staged at once.'); return; }
      if (bytes > MAX_LOCAL_FILE_BYTES) { refused.push(name + ' is over the 20 MB per-file limit.'); return; }
      if (fileBytes() + bytes > MAX_LOCAL_TOTAL_BYTES) { refused.push('The selected files exceed the 50 MB combined preview limit.'); return; }
      var id = 'local-' + (++state.importSeq), task = { id: id, file: file, name: name, bytes: bytes,
        binding: state.bound, session: state.session, controller: makeAbortController(), started: false };
      state.imports[id] = task; state.importQueue.push(task); accepted++;
    });
    renderSources(); updateControls();
    if (accepted) setStatus('Reading ' + accepted + ' local file(s) in this browser. Generate stays unavailable until every reader settles.' + (refused.length ? ' ' + refused[0] : ''), refused.length > 0);
    else if (refused.length) setStatus(refused[0] + ' Nothing was uploaded.', true);
    pumpImports();
    return accepted;
  }

  /* ===== p1-legal-letterhead-1.0.0 =========================================
     An IME report that leaves the practice must say WHOSE practice it is and
     WHAT standard its opinions are held to. Both were missing: the draft
     opened with a bare "MEDICAL-LEGAL / IME WORKSPACE DRAFT" line, and no
     section stated the certainty standard or carried a signature attestation.

     Every letterhead value comes from a field the app ALREADY stores through
     its own Settings getters - nothing is invented and nothing is asked for
     twice. An unset field prints as a bracketed instruction, never as a
     plausible-looking blank or a guess. getName() (the login/account display
     name) is deliberately NOT a fallback for the provider identity: an account
     name must never scope a clinical document.
     The one field the app has no home for is a contact email, so the workspace
     carries its own small Letterhead input, persisted per user under uns().
     ====================================================================== */
  function lhSafe(fn) { try { return fn(); } catch (e) { return undefined; } }
  var LETTERHEAD_EMAIL_KEY = 'legalLetterheadEmail';
  var CERTAINTY_STANDARD = 'to a reasonable degree of medical certainty';
  var UNSET = function (what) { return '[' + what + ' is not configured - set it in Settings before this report is signed]'; };
  function settingText(fn) {
    return clean(lhSafe(function () { return isFn(window[fn]) ? String(window[fn]() || '') : ''; }) || '');
  }
  /* The OPEN workspace field outranks storage, so an email typed and not yet
     committed still prints on the draft the doctor presses Generate on. */
  function letterheadEmail() {
    var field = byId('mlsP1LegalLetterheadEmail');
    var typed = field ? clean(field.value) : '';
    if (typed) return typed;
    return clean(lhSafe(function () {
      if (!isFn(window.uns)) return '';
      return localStorage.getItem(window.uns(LETTERHEAD_EMAIL_KEY)) || '';
    }) || '');
  }
  function saveLetterheadEmail(value) {
    return lhSafe(function () {
      if (!isFn(window.uns)) return false;
      /* The namespace guard refuses writes while the account is unresolved;
         a refusal must be reported, never swallowed. */
      return localStorage.setItem(window.uns(LETTERHEAD_EMAIL_KEY), clean(value)) !== false;
    }) === true;
  }
  function letterhead(emailOverride) {
    return {
      emailOverridden: emailOverride != null,
      practice: settingText('getPracticeName'),
      provider: settingText('getProviderName'),
      credentials: settingText('getProviderCred'),
      npi: settingText('getNpi'),
      address: settingText('getClinicAddress'),
      phone: settingText('getClinicPhone'),
      email: emailOverride != null ? clean(emailOverride) : letterheadEmail()
    };
  }
  function signatureName(lh) {
    if (!lh.provider) return UNSET('The evaluating provider name');
    return lh.credentials ? (lh.provider + ', ' + lh.credentials) : lh.provider;
  }
  /* The block printed at the top of the report, the .txt download and print. */
  function letterheadBlock(emailOverride) {
    var lh = letterhead(emailOverride), lines = [];
    lines.push(lh.practice || UNSET('The practice name'));
    lines.push(signatureName(lh));
    if (lh.npi) lines.push('NPI ' + lh.npi);
    lines.push(lh.address || UNSET('The practice address'));
    var contact = [];
    if (lh.phone) contact.push('Tel ' + lh.phone);
    if (lh.email) contact.push(lh.email);
    lines.push(contact.length ? contact.join('  ·  ') : UNSET('A practice phone or email'));
    lines.push('---------------------------------------------------------------');
    return lines.join('\n');
  }
  /* Deterministic, never AI-written: a closing attestation must say exactly
     what it says. It states the certainty standard ONCE for the whole report,
     names what the opinions rest on, says they may change on new records, and
     leaves a signature line the clinician has to sign. */
  function attestationBlock() {
    var lh = letterhead();
    return 'XV. ATTESTATION\n' +
      'The opinions in this report are held ' + CERTAINTY_STANDARD + ' (more likely than not), and rest solely ' +
      'on the records reviewed and the examination documented above. They are subject to revision if additional ' +
      'records, imaging, or examination findings are provided. This is an UNSIGNED DRAFT prepared for clinician ' +
      'review: nothing in it is a medical-legal opinion until the evaluating provider has verified every statement ' +
      'and signed below.\n\n' +
      'Signature: __________________________________________    Date: ______________\n' +
      signatureName(lh) + '\n' +
      (lh.practice || UNSET('The practice name'));
  }
  /* ===== end p1-legal-letterhead-1.0.0 ===== */

  var SECTIONS = [
    ['I. PATIENT INTRODUCTION', 'Identify the patient and evaluation context using documented facts only.'],
    ['II. DATE OF INJURY AND MECHANISM', 'State the documented onset/injury date and mechanism; identify conflicts.'],
    ['III. INITIAL PRESENTATION', 'Describe the first documented symptoms, examination and working diagnoses.'],
    ['IV. PRIOR AND PRE-EXISTING HISTORY', 'Summarize relevant pre-event history without assuming undocumented negatives.'],
    ['V. IMAGING AND DIAGNOSTIC STUDIES', 'List documented studies chronologically with documented impressions.'],
    ['VI. TREATMENT TIMELINE', 'Describe documented treatment chronologically with dates and providers.'],
    ['VII. PROCEDURES PERFORMED', 'Describe each documented procedure and documented response.'],
    ['VIII. RESPONSE TO TREATMENT', 'Summarize documented improvement, plateau or worsening.'],
    ['IX. CURRENT CONDITION', 'Use the most recent documentation for symptoms, findings and function.'],
    ['X. CAUSATION ANALYSIS', 'Analyze causation only to the extent supported; mark undeterminable issues.'],
    ['XI. MEDICAL NECESSITY OF CARE', 'Discuss documented care without inventing utilization facts.'],
    ['XII. FUTURE TREATMENT', 'Distinguish documented recommendations from bracketed draft placeholders.'],
    ['XIII. SUMMARY AND CONCLUSION', 'Summarize the record and clearly label limits of the available evidence.'],
    /* p1-legal-letterhead-1.0.0: the standard IME opinions section. Every
       opinion must be STATED to the certainty standard and must carry its own
       one-line basis, so a reader can see what each opinion rests on. An
       opinion the record cannot support must be declared undeterminable
       rather than softened into a hedge that still reads as an opinion. */
    ['XIV. OPINIONS', 'State each opinion as a separate numbered item, each one worded "' + CERTAINTY_STANDARD +
      '" (or "to a reasonable degree of medical probability"), immediately followed by a single-line "Basis:" naming the ' +
      'documented records, dates, studies or findings that opinion rests on. Offer an opinion ONLY where the supplied ' +
      'record supports one; where it does not, write the item as "Undeterminable on the record reviewed" with the same ' +
      'one-line basis explaining what is missing. Never state a certainty for a fact that is bracketed or undocumented.']
  ];
  /* ===== p1-legal-reports-2.0.0 ===========================================
     "You can pick the report and all that stuff" (owner, 2026-08-17). The pack
     could produce exactly one document. Every type below is built by the SAME
     section engine, the same letterhead and the same attestation - only the
     section list differs - so a new type cannot invent a new authority.
     `chronology` runs ZERO AI calls: it is a deterministic export of the
     compiled record, which is what a records request actually asks for.
     ====================================================================== */
  var COUNSEL_SECTION = ['XIII-A. ANSWERS TO THE QUESTIONS ASKED',
    'Restate and answer EACH supplied question separately and in order, grounding every answer in the documented record. ' +
    'Where the record cannot answer a question, write that it is undeterminable on the record reviewed and say what is missing. ' +
    'Never answer a question from assumption.'];
  var RECORDS_SECTIONS = [
    ['I. RECORDS REVIEWED', 'List every record source supplied - chart entries by date range, and each local file by name - and state plainly what was NOT available.'],
    ['II. CHRONOLOGY OF CARE', 'Summarize the documented course of care chronologically with dates and providers, without interpretation.'],
    ['III. DIAGNOSES DOCUMENTED', 'List the documented diagnoses with their dates and the source that documents each one.'],
    ['IV. TREATMENT AND RESPONSE', 'Summarize documented treatment and the documented response to it.'],
    ['V. SUMMARY OF THE RECORD', 'Summarize what the record establishes and state clearly where the record is silent. Offer no opinions in this report type.']
  ];
  var REPORT_TYPES = [
    { key: 'ime', label: 'IME / independent medical evaluation',
      blurb: 'Full 14-section evaluation ending in numbered OPINIONS, each stated to the certainty standard with its own one-line basis.',
      counsel: true, ai: true },
    { key: 'narrative', label: 'Medical-legal narrative',
      blurb: 'The 13-section treating-physician narrative: presentation, imaging, treatment, causation, necessity and future care. No numbered opinions section.',
      counsel: true, ai: true },
    { key: 'records', label: 'Records review summary',
      blurb: 'A short five-section summary of what the records establish. States no opinions at all.',
      counsel: false, ai: true },
    { key: 'chronology', label: 'Records chronology only',
      blurb: 'The compiled categorized chronology on your letterhead. Deterministic - no AI is called and no text is generated.',
      counsel: false, ai: false }
  ];
  function reportTypeFor(key) {
    for (var i = 0; i < REPORT_TYPES.length; i++) if (REPORT_TYPES[i].key === key) return REPORT_TYPES[i];
    return null;
  }
  /* The default is the IME set, so an API caller that never picks a type gets
     exactly the document this workspace has always produced. */
  function sectionsFor(key) {
    if (key === 'narrative') return SECTIONS.slice(0, 13);
    if (key === 'records') return RECORDS_SECTIONS.slice();
    if (key === 'chronology') return [];
    return SECTIONS.slice();
  }
  function runSections(key) {
    var report = reportTypeFor(key) || reportTypeFor('ime');
    var list = sectionsFor(report.key);
    var questions = String((byId('mlsP1LegalQuestions') || {}).value || '').trim();
    if (report.counsel && questions) list = list.concat([COUNSEL_SECTION]);
    return list;
  }
  function pickReportType(key) {
    var report = reportTypeFor(key);
    if (!report) return false;
    if (state.run || state.generating) { setStatus('Cancel the current draft run before changing the report type.', true); return false; }
    state.reportType = report.key;
    state.draft = '';
    var box = byId('mlsP1LegalDraft'); if (box) { box.value = ''; box.hidden = true; }
    enableExports(false);
    renderReportTypes();
    setStage('report-picked');
    updateControls();
    setStatus('Report type: ' + report.label + '. ' + report.blurb, false);
    return true;
  }
  /* ===== end p1-legal-reports-2.0.0 ===== */

  function draftSystem(header, instruction) {
    return 'Draft only ONE section of a physician-reviewed medical-legal / IME workspace. ' +
      'Output professional plain text only, without markdown and without repeating the heading. Section: ' + header + '. ' + instruction + ' ' +
      'Use ONLY the supplied documented record and locally extracted files. Never fabricate a finding, date, diagnosis, imaging result, causation opinion, impairment, restriction, or record reviewed. Put any unsupported needed fact in [brackets]. ' +
      'This is an unsigned DRAFT for clinician verification, not legal advice and not a final report.';
  }
  function draftContext() {
    var lines = ['EXACT ACTIVE PATIENT BINDING', 'Name: ' + (state.bound.name || '[not documented]'),
      'DOB: ' + (state.bound.dob || '[not documented]'), 'MRN: ' + (state.bound.mrn || '[not documented]'),
      '', chronologyText()];
    var doi = clean((byId('mlsP1LegalDoi') || {}).value);
    var questions = String((byId('mlsP1LegalQuestions') || {}).value || '').trim();
    if (doi) lines.push('\nUSER-ENTERED DATE OF INJURY / ONSET (verify against record):\n' + doi);
    if (questions) lines.push('\nQUESTIONS TO ADDRESS AS DRAFTING CONTEXT:\n' + questions);
    state.sources.forEach(function (source) {
      if (source.text) lines.push('\nLOCALLY EXTRACTED FILE TEXT (raw file bytes stay in the browser): ' + source.name + '\n' + source.text);
    });
    var context = lines.join('\n');
    var originalChars = context.length, truncated = originalChars > MAX_AI_CONTEXT_CHARS;
    if (truncated) {
      context = context.slice(0, MAX_AI_CONTEXT_CHARS) +
        '\n\n[INPUT CONTEXT TRUNCATED AT THE PREVIEW LIMIT. Verify this draft against the full chronology and every original local record.]';
    }
    return { text: context, truncated: truncated, originalChars: originalChars, includedChars: Math.min(originalChars, MAX_AI_CONTEXT_CHARS) };
  }
  function finishOwnedRun(run) {
    if (state.run !== run) return false;
    state.run = null; state.generating = false;
    clearRunTimers(run); updateControls();
    return true;
  }
  function callAiForRun(run, section, index, context) {
    return new Promise(function (resolve, reject) {
      if (!runOwned(run)) { reject(abortError('stale-run', 'Draft run is no longer current.')); return; }
      var controller = makeAbortController(), done = false, timer = null;
      run.callControllers.push(controller);
      function cleanup() {
        if (timer) clearTimeout(timer);
        if (run.controller.signal && isFn(run.controller.signal.removeEventListener)) run.controller.signal.removeEventListener('abort', onRunAbort);
        run.callControllers = run.callControllers.filter(function (candidate) { return candidate !== controller; });
      }
      function finish(ok, value) { if (done) return; done = true; cleanup(); if (ok) resolve(value); else reject(value); }
      function onRunAbort() { try { controller.abort(); } catch (e) {} finish(false, abortError('ai-run-canceled', 'Drafting was canceled.')); }
      if (run.controller.signal.aborted) { onRunAbort(); return; }
      if (isFn(run.controller.signal.addEventListener)) run.controller.signal.addEventListener('abort', onRunAbort, { once: true });
      timer = setTimeout(function () {
        try { controller.abort(); } catch (e) {}
        finish(false, abortError('ai-call-timeout', 'Section ' + (index + 1) + ' reached the 45-second AI limit'));
      }, AI_CALL_TIMEOUT_MS);
      var raw;
      try {
        raw = window.aiCallRaw(draftSystem(section[0], section[1]), context + '\n\nWrite only ' + section[0] + '.',
          isFn(window.getKey) ? window.getKey() : '', { freeform: true, legal: true, signal: controller.signal });
      } catch (error) { finish(false, error); return; }
      Promise.resolve(raw).then(function (value) { finish(true, value); }, function (error) { finish(false, error); });
    });
  }
  function cancelGeneration(message) {
    var canceled = abortCurrentRun('user-canceled');
    if (canceled && state.open) setStatus(message || 'Generation canceled. Any late response is blocked from this workspace.', false);
    return canceled;
  }
  function generateDraft() {
    if (state.run || state.generating) return Promise.resolve(false);
    if (pendingImportCount()) {
      setStatus('Wait for all selected local files to finish reading, or remove them, before Generate. Nothing was sent.', true);
      updateControls(); return Promise.resolve(false);
    }
    if (!state.bound || !bindingCurrent(state.bound)) { abortForPatientChange(); return Promise.resolve(false); }
    /* p1-legal-reports-2.0.0: an API caller that never picked a type still gets
       exactly the IME document this workspace has always produced, and the
       state now SAYS which type was used rather than leaving it blank. */
    if (!state.reportType) { state.reportType = 'ime'; renderReportTypes(); }
    var report = reportTypeFor(state.reportType) || reportTypeFor('ime');
    var sections = runSections(report.key);
    var binding = state.bound;
    /* The deterministic type calls no model at all. */
    if (!report.ai) {
      var chronOnly = chronologyText();
      if (!chronOnly) { abortForPatientChange(); return Promise.resolve(false); }
      state.draft = [letterheadBlock(), report.label.toUpperCase(),
        'Patient: ' + (binding.name || '[not documented]'),
        'Date: ' + new Date().toLocaleDateString(),
        'UNSIGNED DRAFT - verify every statement before use',
        chronOnly, attestationBlock()].join('\n\n');
      var chronBox = byId('mlsP1LegalDraft');
      if (chronBox) { chronBox.value = state.draft; chronBox.hidden = false; }
      enableExports(true); setStage('generated'); updateControls();
      setStatus('Records chronology compiled on your letterhead. No AI was called and no text was generated — every line came from the compiled record.', false);
      toast('1p Legal / IME chronology ready for clinician review.', 'ok');
      return Promise.resolve(true);
    }
    if (!isFn(window.aiCallRaw)) { setStatus('AI drafting is unavailable in this MLS session. Nothing was sent.', true); return Promise.resolve(false); }
    var contextReceipt = draftContext(), context = contextReceipt.text;
    var run = { id: ++state.runSeq, session: state.session, binding: binding,
      controller: makeAbortController(), callControllers: [], wholeTimer: null };
    /* p1-legal-letterhead-1.0.0: the practice letterhead is the FIRST thing on
       the report, before the draft banner, exactly as it would be on paper. */
    var output = [letterheadBlock(),
      'MEDICAL-LEGAL / IME WORKSPACE DRAFT', 'Report type: ' + report.label,
      'Patient: ' + (binding.name || '[not documented]'),
      'Date: ' + new Date().toLocaleDateString(), 'UNSIGNED DRAFT - verify every statement before use'];
    if (contextReceipt.truncated) output.push('IMPORTANT SOURCE-LIMIT NOTICE: Only the first ' + contextReceipt.includedChars.toLocaleString() +
      ' of ' + contextReceipt.originalChars.toLocaleString() + ' compiled context characters were supplied to AI. Verify every section against the full chronology and every original local record; later records may be absent from this draft.');
    state.run = run; state.generating = true; updateControls();
    run.wholeTimer = setTimeout(function () {
      if (!runSlotOwned(run)) return;
      if (!bindingCurrent(run.binding)) { abortForPatientChange(); return; }
      abortCurrentRun('whole-run-timeout');
      setStatus('Drafting stopped at the eight-minute preview limit. No partial draft was exported; the inputs remain editable.', true);
    }, AI_RUN_TIMEOUT_MS);
    var chain = Promise.resolve();
    sections.forEach(function (section, index) {
      chain = chain.then(function () {
        if (!runOwned(run)) throw abortError('stale-run', 'Draft run is no longer current.');
        setStatus('Drafting section ' + (index + 1) + ' of ' + sections.length + ': ' + section[0], false);
        return callAiForRun(run, section, index, context);
      }).then(function (part) {
        if (!runOwned(run)) throw abortError('stale-run', 'Draft run is no longer current.');
        part = String(part || '').replace(/^```\w*\s*/, '').replace(/```\s*$/, '').trim();
        output.push(section[0] + '\n' + (part || '[No draft text returned; clinician must complete this section.]'));
      });
    });
    return chain.then(function () {
      if (!runOwned(run)) throw abortError('stale-run', 'Draft run is no longer current.');
      /* p1-legal-letterhead-1.0.0: the attestation is written here, not by the
         model - a closing certainty statement and a signature line must say
         exactly what they say, every time. */
      output.push(attestationBlock());
      state.draft = output.join('\n\n');
      var box = byId('mlsP1LegalDraft');
      if (box) { box.value = state.draft; box.hidden = false; }
      enableExports(true); finishOwnedRun(run); setStage('generated');
      setStatus('Draft ready: ' + sections.length + ' of ' + sections.length + ' sections.' + (contextReceipt.truncated ?
        ' SOURCE-LIMIT WARNING: the compiled context exceeded the preview limit, so later records may be absent. Verify against the full chronology and every original local record.' : '') +
        ' It remains unsigned and local until you explicitly copy, download, or print it.', contextReceipt.truncated);
      toast('1p Legal / IME draft ready for clinician review.', 'ok');
      return true;
    }).catch(function (error) {
      /* This is the critical ownership boundary: an old canceled, closed, or
         patient-switched Promise is never allowed to mutate a newer workspace. */
      if (!runSlotOwned(run)) return false;
      if (!bindingCurrent(run.binding)) { abortForPatientChange(); return false; }
      finishOwnedRun(run);
      setStatus('Drafting stopped: ' + (clean(error && error.message) || 'AI request failed') + '. No partial draft was exported.', true);
      return false;
    });
  }

  /* ===== p1-legal-bind-2.0.0 ==============================================
     "It really needs to be able to add a patient to it - or grab a patient
     from Athena and then add it" (owner, 2026-08-17).

     Before this block the workspace could only ever show whoever happened to
     be the app's active patient, and an active-patient change CLOSED it. That
     is why it felt like it could not "add a patient": there was no way in.

     The fix does NOT weaken the exact-binding model, which is the whole
     safety architecture here. Instead:
       - a bind is REQUESTED through the app's own single switch choke point
         (openPatient / setActivePtId). The app remains the one owner of which
         chart is active, so the workspace can never disagree with the rest of
         MLS about who is on screen.
       - the workspace records an INTENT before it asks. When the resulting
         mls:active-patient-changed event names the patient it asked for, that
         is an intentional re-bind: abort every run, discard every prior
         result, capture a FRESH binding and re-freeze the snapshot. Any OTHER
         patient change is still the external event it always was and still
         fails closed exactly as before.
       - "Grab from Athena" is a read-only DELEGATION. This module owns no
         transport: it builds no message envelope, posts nothing, and knows no
         verb strings. It calls two named read entry points the app already
         ships, and its op table is the allowlist - a key that is not in it
         reaches no delegate at all.
     ====================================================================== */
  var STAGES = ['unbound', 'bound', 'report-picked', 'generated', 'exported'];
  function setStage(stage) {
    if (STAGES.indexOf(stage) < 0) return false;
    state.stage = stage;
    var root = byId(ROOT_ID);
    if (root && isFn(root.setAttribute)) root.setAttribute('data-mls-legal-state', stage);
    return true;
  }

  function rosterPatients() {
    try { return isFn(window.getPatients) ? (window.getPatients() || []) : []; } catch (e) { return []; }
  }
  function patientById(id) {
    var wanted = clean(id), list = rosterPatients();
    for (var i = 0; i < list.length; i++) if (clean(list[i] && list[i].id) === wanted) return list[i];
    return null;
  }
  /* Roster search over the three identity fields a legal request is keyed on. */
  function rosterMatches(query, limit) {
    var q = clean(query).toLowerCase();
    if (q.length < 2) return [];
    var out = [];
    rosterPatients().forEach(function (p) {
      if (out.length >= (limit || 12)) return;
      var hay = (clean(p && p.name) + ' ' + clean(p && p.dob) + ' ' + clean(p && p.mrn)).toLowerCase();
      if (hay.indexOf(q) >= 0) out.push(p);
    });
    return out;
  }
  /* A frozen snapshot is only honest while it still matches the chart. */
  function snapshotSignature(patient) {
    if (!patient) return '';
    var parts = [];
    [visitsFor(patient), notesFor(patient), documentsFor(patient)].forEach(function (list) {
      parts.push((list || []).length);
      (list || []).forEach(function (row) {
        parts.push(clean(row && (row.updated || row.created || row.date)) + ':' + String((row && (row.soap || row.detail || row.raw || row.text || '')) || '').length);
      });
    });
    parts.push(clean(patient.problems).length);
    return parts.join('|');
  }
  function snapshotDrifted() {
    if (!state.snapshotSig || !state.bound) return false;
    var live = activePatientNow();
    if (!live || clean(live.id) !== state.bound.patientId) return false;
    return snapshotSignature(live) !== state.snapshotSig;
  }

  /* Adopt whatever the app now says is active as this workspace's binding.
     Everything from the prior binding is discarded, never carried across. */
  function adoptBinding(reason) {
    var binding = captureBinding();
    abortCurrentRun(reason || 'rebind');
    cancelAllImports();
    state.session++;
    state.rebindIntent = null;
    state.generating = false;
    state.model = null; state.providerFilter = null; state.sources = []; state.draft = '';
    state.reportType = '';
    state.snapshot = null; state.snapshotSig = ''; state.snapshotAt = 0;
    state.bound = binding || null;
    state.open = true;
    renderBinding(); renderReportTypes(); renderSources(); enableExports(false);
    var box = byId('mlsP1LegalDraft'); if (box) { box.value = ''; box.hidden = true; }
    var chron = byId('mlsP1LegalChronology'); if (chron) chron.innerHTML = '';
    var provs = byId('mlsP1LegalProviders'); if (provs) provs.innerHTML = '';
    ['mlsP1LegalChronCopy', 'mlsP1LegalChronDownload', 'mlsP1LegalChronPrint'].forEach(function (id) {
      var n = byId(id); if (n) n.disabled = true;
    });
    if (!binding) {
      setStage('unbound');
      renderSnapshotNotice(); updateControls();
      setStatus('No patient is bound. Add a patient from this account, or grab one from Athena.', true);
      return false;
    }
    setStage('bound');
    /* Re-freeze: a Change must re-take the snapshot, never inherit the old one. */
    compileHistory();
    updateControls();
    setStatus('Bound to ' + (binding.name || '[name unavailable]') + '. The chronology was re-compiled from a fresh snapshot. Pick a report type next.', false);
    return true;
  }

  /* Ask the app to make `id` the active patient, then adopt it. */
  function requestBind(id) {
    var wanted = clean(id);
    if (!wanted) return false;
    if (state.run || state.generating) { setStatus('Cancel the current draft run before changing patient.', true); return false; }
    if (state.athenaOp) { setStatus('Wait for the current read to finish before changing patient.', true); return false; }
    var p = patientById(wanted);
    if (!p) { setStatus('That patient is not in this account’s roster. Nothing was changed.', true); return false; }
    if (activeIdNow() === wanted) { return adoptBinding('picked'); }
    var switcher = isFn(window.openPatient) ? window.openPatient : (isFn(window.setActivePtId) ? window.setActivePtId : null);
    if (!switcher) {
      setStatus('This build exposes no patient switcher, so this workspace cannot change the active chart. Open the patient from the patient list, then reopen Legal / IME.', true);
      return false;
    }
    state.rebindIntent = { patientId: wanted, at: Date.now() };
    try { switcher(wanted); } catch (e) {
      state.rebindIntent = null;
      setStatus('The app refused to open that chart: ' + (clean(e && e.message) || 'unknown reason') + '. Nothing was changed.', true);
      return false;
    }
    /* Some builds switch without emitting the event; adopt directly when the
       app already agrees, and leave the intent for the event otherwise. */
    if (state.rebindIntent && activeIdNow() === wanted) return adoptBinding('picked');
    return true;
  }

  /* --- read-only delegation to the reads the app already ships ------------
     This table IS the allowlist. There is no default branch, no verb string
     and no transport in this module, so nothing outside these two entries can
     be asked for, and neither entry writes anything to the EMR. */
  var ATHENA_READ_OPS = {
    day: {
      label: 'Pull a day of the schedule',
      blurb: 'Reads one day of your signed-in schedule and its chart histories through the app’s existing read-only pull. Patients not yet in MLS arrive with name, DOB and MRN, then appear in the list above.',
      needs: 'the schedule reader',
      resolve: function () {
        var si = window.__mlsSI;
        return (si && isFn(si.dayPull)) ? function (opts) { return si.dayPull(opts); } : null;
      },
      args: function (input, onStatus) {
        return { date: clean(input && input.date) || todayYmd(), includeHistory: true, onStatus: onStatus };
      }
    },
    chart: {
      label: 'Re-read the bound patient’s chart',
      blurb: 'Re-reads the chart of the patient bound above through the app’s existing read-only chart reader, then re-compiles this workspace from the refreshed record.',
      needs: 'the chart reader',
      resolve: function () {
        return isFn(window.pullPatientChartViaAssist) ? function (opts) { return window.pullPatientChartViaAssist(null, opts); } : null;
      },
      args: function () {
        return { patientId: state.bound ? state.bound.patientId : '' };
      }
    }
  };
  function readOpKeys() { return Object.keys(ATHENA_READ_OPS); }
  function readOpAvailable(key) {
    if (!Object.prototype.hasOwnProperty.call(ATHENA_READ_OPS, key)) return false;
    try { return !!ATHENA_READ_OPS[key].resolve(); } catch (e) { return false; }
  }
  /* One gateway. A key that is not an own property of the table above never
     resolves a delegate, so no unlisted operation can be invoked from here. */
  function runReadOp(key, input) {
    if (!Object.prototype.hasOwnProperty.call(ATHENA_READ_OPS, key)) {
      setStatus('This workspace can only run its two read-only lookups. "' + clean(key) + '" is not one of them, so nothing ran.', true);
      return Promise.resolve(false);
    }
    var op = ATHENA_READ_OPS[key];
    if (state.athenaOp) { setStatus('A read is already running. Wait for it to finish.', true); return Promise.resolve(false); }
    if (state.run || state.generating) { setStatus('Cancel the current draft run before reading from the EMR.', true); return Promise.resolve(false); }
    if (key === 'chart' && !(state.bound && bindingCurrent(state.bound))) {
      setStatus('Bind a patient before re-reading a chart. Nothing ran.', true); return Promise.resolve(false);
    }
    var run;
    try { run = op.resolve(); } catch (e) { run = null; }
    if (!run) {
      state.athenaNote = op.label + ' is unavailable in this session: ' + op.needs + ' is not loaded. Nothing ran and nothing was faked.';
      setStatus(state.athenaNote, true); renderReadOps();
      return Promise.resolve(false);
    }
    state.athenaOp = key; state.athenaNote = ''; renderReadOps(); updateControls();
    setStatus(op.label + ' — reading. This reads only; nothing is written to the EMR.', false);
    var onStatus = function (message) { setStatus(op.label + ' — ' + clean(message), false); };
    function settle(okText, errText, error) {
      state.athenaOp = '';
      state.athenaNote = error ? (errText + ' ' + (clean(error && error.message) || 'the read did not complete')) : okText;
      renderReadOps(); renderRoster(); updateControls();
      setStatus(state.athenaNote, !!error);
      return !error;
    }
    var work;
    try { work = run(op.args(input || {}, onStatus)); } catch (e) {
      return Promise.resolve(settle('', 'The read could not start:', e));
    }
    return Promise.resolve(work).then(function () {
      if (key === 'chart' && state.bound && bindingCurrent(state.bound)) compileHistory();
      return settle(op.label + ' finished. The patient list above was refreshed from this account’s roster.', '', null);
    }, function (error) {
      return settle('', 'The read stopped:', error || new Error('the read did not complete'));
    });
  }
  /* ===== end p1-legal-bind-2.0.0 ===== */

  function downloadText(filename, text) {
    try {
      var blob = new Blob([String(text || '')], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 0);
    } catch (e) { toast('Could not download this local draft.', 'err'); }
  }
  function printText(title, text) {
    try {
      var win = window.open('', '_blank', 'width=900,height=1000');
      if (!win || !win.document) { toast('Allow pop-ups to print.', 'err'); return; }
      win.document.open();
      win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>body{font:14px/1.55 system-ui,sans-serif;padding:36px;color:#183a2f}pre{white-space:pre-wrap;font:inherit}</style></head><body><pre>' + esc(text) + '</pre></body></html>');
      win.document.close(); win.focus(); setTimeout(function () { try { win.print(); } catch (e) {} }, 250);
    } catch (e) { toast('Could not open the local print view.', 'err'); }
  }
  function copyText(text, label) {
    if (!navigator.clipboard || !isFn(navigator.clipboard.writeText)) { toast('Clipboard access is unavailable.', 'err'); return; }
    navigator.clipboard.writeText(String(text || '')).then(function () { toast(label + ' copied.', 'ok'); }, function () { toast('Could not copy.', 'err'); });
  }

  var CSS = [
    '#' + ROOT_ID + '{position:fixed;inset:0;z-index:2147483000;background:#f6f4ed;color:#183a2f;overflow:auto;font:14px/1.48 "Public Sans",system-ui,sans-serif}',
    '#' + ROOT_ID + ' *{box-sizing:border-box}',
    '#' + ROOT_ID + ' .p1l-shell{max-width:1180px;margin:0 auto;padding:28px 26px 80px}',
    '#' + ROOT_ID + ' .p1l-top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:18px}',
    '#' + ROOT_ID + ' h1{font:750 28px/1.18 Georgia,serif;margin:0 0 6px}',
    '#' + ROOT_ID + ' .p1l-badge{display:inline-flex;border:1px solid #bfd3c7;background:#eaf3ed;color:#2e6a4b;border-radius:999px;padding:5px 10px;font-weight:750;font-size:12px}',
    '#' + ROOT_ID + ' .p1l-close{border:1px solid #d6d9d3;background:#fff;border-radius:999px;min-height:42px;padding:0 16px;font-weight:700;cursor:pointer}',
    '#' + ROOT_ID + ' .p1l-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:16px}',
    '#' + ROOT_ID + ' .p1l-card{background:#fff;border:1px solid #dedfd9;border-radius:17px;padding:18px;box-shadow:0 10px 28px rgba(32,64,52,.06);min-width:0}',
    '#' + ROOT_ID + ' .p1l-card.wide{grid-column:1/-1}',
    '#' + ROOT_ID + ' h2{font-size:18px;margin:0 0 5px}',
    '#' + ROOT_ID + ' p{margin:5px 0 12px;color:#596a62}',
    '#' + ROOT_ID + ' .p1l-bind{padding:12px;border:1px solid #bdd4c5;background:#eef6f0;border-radius:12px;font-weight:700;margin:12px 0}',
    '#' + ROOT_ID + ' .p1l-warn{padding:11px 12px;border:1px solid #ead6a8;background:#fff8e8;color:#765616;border-radius:11px;margin:10px 0}',
    '#' + ROOT_ID + ' .p1l-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}',
    '#' + ROOT_ID + ' button{min-height:42px;border:1px solid #cfd8d1;background:#fff;color:#204034;border-radius:10px;padding:8px 13px;font-weight:700;cursor:pointer}',
    '#' + ROOT_ID + ' button.primary{background:#2e6a4b;color:#fff;border-color:#2e6a4b}',
    '#' + ROOT_ID + ' button[disabled]{opacity:.48;cursor:default}',
    '#' + ROOT_ID + ' input,#' + ROOT_ID + ' textarea{width:100%;border:1px solid #d7ddd8;border-radius:10px;padding:10px 11px;color:#183a2f;background:#fff;font:inherit}',
    '#' + ROOT_ID + ' textarea{min-height:92px;resize:vertical}',
    '#' + ROOT_ID + ' #mlsP1LegalDraft{min-height:520px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px}',
    '#' + ROOT_ID + ' .p1l-drop{display:block;width:100%;border:2px dashed #becdc3;border-radius:12px;padding:16px;text-align:center;cursor:pointer;background:#fafbf8}',
    '#' + ROOT_ID + ' .p1l-source{border-top:1px solid #e8e9e5;padding:8px 0;font-size:12.5px}',
    '#' + ROOT_ID + ' .p1l-filter{display:inline-flex;align-items:center;gap:5px;border:1px solid #ccd8d0;border-radius:999px;padding:6px 10px;cursor:pointer}',
    '#' + ROOT_ID + ' .p1l-filter.off{text-decoration:line-through;opacity:.5}',
    '#' + ROOT_ID + ' .p1l-section{margin-top:14px;border-top:1px solid #e5e8e4;padding-top:10px}',
    '#' + ROOT_ID + ' .p1l-item{border-left:3px solid #c7d9ce;padding:7px 9px;margin:7px 0;background:#fafbf9}',
    '#' + ROOT_ID + ' .p1l-item pre{white-space:pre-wrap;max-height:180px;overflow:auto;font:12px/1.45 ui-monospace,monospace}',
    '#' + ROOT_ID + ' .p1l-status{min-height:22px;font-weight:650;color:#2e6a4b}',
    /* ===== p1-legal-flow-2.0.0 ===== */
    '#' + ROOT_ID + ' .p1l-step{display:inline-flex;align-items:center;gap:7px;font:750 12px/1 "Public Sans",system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#5c7a68;margin:0 0 6px}',
    '#' + ROOT_ID + ' .p1l-step i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:21px;height:21px;border-radius:50%;background:#e4efe7;color:#2e6a4b;font-size:12px}',
    '#' + ROOT_ID + ' .p1l-card[data-mls-legal-done="true"] .p1l-step i{background:#2e6a4b;color:#fff}',
    '#' + ROOT_ID + ' .p1l-bindcard{background:#eef6f0;border:1px solid #bdd4c5}',
    '#' + ROOT_ID + ' .p1l-bindhead{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}',
    '#' + ROOT_ID + ' .p1l-bindname{font:750 25px/1.2 Georgia,serif;margin:0;color:#183a2f;word-break:break-word}',
    '#' + ROOT_ID + ' .p1l-chips{display:flex;gap:7px;flex-wrap:wrap;margin:9px 0 0}',
    '#' + ROOT_ID + ' .p1l-chip{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #c3d6c9;border-radius:999px;padding:5px 12px;font:650 14px/1.2 "Public Sans",system-ui,sans-serif;color:#204034}',
    '#' + ROOT_ID + ' .p1l-chip b{font-weight:750;color:#5c7a68;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase}',
    '#' + ROOT_ID + ' .p1l-chip.missing{color:#8a5a1a;border-color:#e2cfa4;background:#fffaf0}',
    '#' + ROOT_ID + ' .p1l-change{min-height:44px;font-size:15px;padding:0 18px;background:#2e6a4b;color:#fff;border-color:#2e6a4b}',
    '#' + ROOT_ID + ' .p1l-explain{font-size:14.5px;line-height:1.5;color:#3f5a4c;margin:6px 0 10px;max-width:64ch}',
    '#' + ROOT_ID + ' .p1l-picker{border:1px solid #d7ddd8;border-radius:12px;background:#fff;margin:8px 0 0;padding:6px}',
    '#' + ROOT_ID + ' .p1l-pick{display:block;width:100%;text-align:left;border:1px solid transparent;background:transparent;border-radius:9px;padding:9px 11px;font:650 14px/1.35 "Public Sans",system-ui,sans-serif;min-height:auto}',
    '#' + ROOT_ID + ' .p1l-pick:hover{background:#eef6f0}',
    '#' + ROOT_ID + ' .p1l-pick small{display:block;font-weight:400;color:#5c7a68;margin-top:2px}',
    '#' + ROOT_ID + ' .p1l-report{display:block;width:100%;text-align:left;margin:6px 0;padding:11px 13px;border-radius:12px;font-size:15px;line-height:1.35}',
    '#' + ROOT_ID + ' .p1l-report[aria-pressed="true"]{background:#2e6a4b;color:#fff;border-color:#2e6a4b}',
    '#' + ROOT_ID + ' .p1l-report small{display:block;font-weight:400;font-size:13px;margin-top:3px;opacity:.86}',
    '#' + ROOT_ID + ' .p1l-freeze{font-size:13px;color:#5c7a68;margin:8px 0 0}',
    '#' + ROOT_ID + ' .p1l-freeze.stale{color:#8a5a1a;background:#fff8e8;border:1px solid #ead6a8;border-radius:10px;padding:9px 11px}',
    '#' + ROOT_ID + ' .p1l-readop{border-top:1px solid #e8e9e5;padding:9px 0;font-size:13px}',
    '#' + ROOT_ID + ' .p1l-readop b{display:block;font-size:14px;color:#204034}',
    '@media(max-width:820px){#' + ROOT_ID + ' .p1l-grid{grid-template-columns:1fr}#' + ROOT_ID + ' .p1l-card.wide{grid-column:auto}#' + ROOT_ID + ' .p1l-shell{padding:18px 13px 70px}#' + ROOT_ID + ' .p1l-bindname{font-size:21px}}'
  ].join('\n');

  function ensureStyle() {
    if (byId(STYLE_ID)) return;
    var style = document.createElement('style'); style.id = STYLE_ID; style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }
  function shellHtml() {
    /* p1-legal-flow-2.0.0: the same cards, in the order the work is actually
       done, each one labelled with its step number. Nothing was removed. */
    return '<div class="p1l-shell">' +
      '<div class="p1l-top"><div><span class="p1l-badge">Free 1p preview · read-only draft workspace</span><h1 id="mlsP1LegalTitle">Legal / IME workspace</h1><p>Bind a patient, pick a report, generate, export. Exact chart, local files, and a clinician-review draft on your practice letterhead. No signing, delivery, chart filing, Athena writing, payment, messaging, or public intake.</p></div><button type="button" class="p1l-close" id="mlsP1LegalClose">Close preview</button></div>' +
      '<section class="p1l-card p1l-bindcard" data-mls-legal-step="bind"><div class="p1l-step"><i>1</i>Patient</div>' +
      '<div id="mlsP1LegalBanner" class="p1l-bindhead"></div>' +
      '<div id="mlsP1LegalRoster"></div>' +
      '<div id="mlsP1LegalReadOps"></div>' +
      '</section>' +
      '<section class="p1l-card" data-mls-legal-step="report"><div class="p1l-step"><i>2</i>Report type</div>' +
      '<p class="p1l-explain">Pick what this workspace should produce. Every type prints on the same letterhead and closes with the same signature attestation; only the sections differ.</p>' +
      '<div id="mlsP1LegalReportTypes"></div></section>' +
      '<div class="p1l-grid">' +
      '<section class="p1l-card wide" data-mls-legal-step="inputs"><h2>Chronology (read-only)</h2><p class="p1l-explain">Built from the patient as of when you opened this workspace — a frozen snapshot, so a chart edit made elsewhere cannot change a report you are part-way through. Provider filters change only the preview and export; they never change the chart.</p><div class="p1l-actions"><button type="button" class="primary" id="mlsP1LegalCompile">Compile history</button><button type="button" id="mlsP1LegalChronCopy" disabled>Copy chronology</button><button type="button" id="mlsP1LegalChronDownload" disabled>Download .txt</button><button type="button" id="mlsP1LegalChronPrint" disabled>Print</button></div><div id="mlsP1LegalFreeze" class="p1l-freeze" role="status" aria-live="polite"></div><div id="mlsP1LegalProviders" class="p1l-actions" aria-label="Filter chronology by provider"></div><div id="mlsP1LegalChronology"></div></section>' +
      '<section class="p1l-card" data-mls-legal-step="inputs"><h2>Local records</h2><p id="mlsP1LegalFileHelp">Searchable PDF, DOCX, and text files are read by this browser. Raw file bytes never leave the browser. When you press Generate, extracted text from files still listed here is included in the configured MLS AI context; remove a file first if its text should not be included. Up to 8 files / 50 MB total. Image OCR is intentionally disabled.</p><button type="button" class="p1l-drop" id="mlsP1LegalDrop" aria-describedby="mlsP1LegalFileHelp">Choose or drop local files</button><input id="mlsP1LegalFile" type="file" multiple accept=".pdf,.docx,.txt,.md,.rtf,.csv,.tsv,.json,.html,text/*" hidden><div id="mlsP1LegalSources" aria-live="polite"></div></section>' +
      '<section class="p1l-card" data-mls-legal-step="generate"><div class="p1l-step"><i>3</i>Generate</div><label>Date of injury / onset <input id="mlsP1LegalDoi" type="text" placeholder="Only if known; the draft must reconcile it with the record"></label><label style="display:block;margin-top:10px">Questions to address <textarea id="mlsP1LegalQuestions" placeholder="Optional questions. Unsupported answers must stay bracketed or undeterminable."></textarea></label><fieldset id="mlsP1LegalLetterhead" style="margin-top:12px;border:1px solid #d7ddd8;border-radius:10px;padding:10px 12px"><legend style="font-weight:750;font-size:13px;padding:0 4px">Letterhead</legend><p style="margin:2px 0 8px">Printed at the top of the report and above the signature line. Practice name, provider name, credentials, NPI, address and phone come from Settings; change them there.</p><pre id="mlsP1LegalLetterheadPreview" style="white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:#fafbf8;border:1px solid #e4e8e4;border-radius:8px;padding:8px;margin:0 0 8px"></pre><label>Contact email for the letterhead <input id="mlsP1LegalLetterheadEmail" type="email" autocomplete="off" placeholder="Optional; saved for this account on this device"></label></fieldset><div class="p1l-actions"><button type="button" class="primary" id="mlsP1LegalGenerate">Generate report</button><button type="button" id="mlsP1LegalCancel" disabled>Cancel current generation</button></div><div class="p1l-warn">AI disclosure: this sends the compiled record context to the existing configured MLS AI path only when you press Generate. It is an unsigned draft, may be incomplete or wrong, and requires clinician verification.</div><div id="mlsP1LegalStatus" class="p1l-status" role="status" aria-live="polite"></div></section>' +
      '<section class="p1l-card wide" data-mls-legal-step="export"><div class="p1l-step"><i>4</i>Export</div><h2 id="mlsP1LegalDraftLabel">Unsigned clinician-review draft</h2><div class="p1l-actions"><button id="mlsP1LegalDraftCopy" disabled>Copy</button><button id="mlsP1LegalDraftDownload" disabled>Download .txt</button><button id="mlsP1LegalDraftPrint" disabled>Print</button></div><textarea id="mlsP1LegalDraft" aria-labelledby="mlsP1LegalDraftLabel" hidden spellcheck="true"></textarea></section>' +
      '</div></div>';
  }
  function renderNoPatient(message) {
    var root = byId(ROOT_ID); if (!root) return;
    root.innerHTML = '<div class="p1l-shell"><div class="p1l-top"><div><span class="p1l-badge">Free 1p preview · fail closed</span><h1 id="mlsP1LegalTitle">Legal / IME workspace</h1></div><button type="button" class="p1l-close" id="mlsP1LegalClose">Close preview</button></div><div class="p1l-card"><h2>No bound patient workspace</h2><div class="p1l-warn" role="alert">' + esc(message || 'Select exactly one active patient, then reopen this preview.') + '</div></div></div>';
    var close = byId('mlsP1LegalClose'); if (close) close.addEventListener('click', closeOverlay);
  }
  function setStatus(message, error) {
    var node = byId('mlsP1LegalStatus');
    if (node) { node.textContent = String(message || ''); node.style.color = error ? '#9a3d29' : '#2e6a4b'; }
  }
  function updateControls() {
    var pending = pendingImportCount(), running = !!state.run || state.generating, reading = !!state.athenaOp;
    /* p1-legal-flow-2.0.0: Generate is only reachable once a patient is bound
       AND a report type is picked, so the next step is the only live control. */
    var generate = byId('mlsP1LegalGenerate');
    if (generate) {
      generate.disabled = running || reading || pending > 0 || !state.bound || !state.reportType;
      var report = reportTypeFor(state.reportType);
      if (isFn(generate.setAttribute)) {
        generate.setAttribute('title', !state.bound ? 'Bind a patient first (step 1).'
          : (!state.reportType ? 'Pick a report type first (step 2).'
          : ('Generate the ' + report.label + '.')));
      }
      generate.textContent = report ? ('Generate ' + report.label) : 'Generate report';
    }
    var cancel = byId('mlsP1LegalCancel'); if (cancel) cancel.disabled = !running;
    var drop = byId('mlsP1LegalDrop'); if (drop) drop.disabled = running || reading;
    var input = byId('mlsP1LegalFile'); if (input) input.disabled = running || reading;
    var compile = byId('mlsP1LegalCompile'); if (compile) compile.disabled = !state.bound || running || reading;
    var root = byId(ROOT_ID);
    if (root && isFn(root.setAttribute)) {
      root.setAttribute('data-mls-legal-report', state.reportType || '');
      root.setAttribute('data-mls-legal-bound', state.bound ? 'true' : 'false');
    }
  }
  function enableExports(on) {
    ['mlsP1LegalDraftCopy', 'mlsP1LegalDraftDownload', 'mlsP1LegalDraftPrint'].forEach(function (id) { var node = byId(id); if (node) node.disabled = !on; });
  }
  function renderSources() {
    var node = byId('mlsP1LegalSources'); if (!node) return;
    var pending = Object.keys(state.imports).map(function (id) { return state.imports[id]; });
    node.innerHTML = pending.map(function (task) {
      return '<div class="p1l-source"><b>' + esc(task.name) + '</b> · ' + (task.started ? 'reading locally…' : 'queued for local reading…') +
        ' <button type="button" data-cancel-import="' + esc(task.id) + '" style="min-height:30px;padding:3px 8px;float:right">Cancel file</button></div>';
    }).join('') + state.sources.map(function (source, index) {
      return '<div class="p1l-source"><b>' + esc(source.name) + '</b> · ' + (source.error ? '<span style="color:#9a3d29">' + esc(source.error) + '</span>' : (source.truncated ? ('first ' + MAX_LOCAL_TEXT_CHARS.toLocaleString() + ' of ' + source.chars.toLocaleString() + ' local characters kept for this draft') : source.chars.toLocaleString() + ' local characters read')) + ' <button type="button" data-remove-source="' + index + '" style="min-height:30px;padding:3px 8px;float:right">Remove</button></div>';
    }).join('');
    Array.prototype.forEach.call(node.querySelectorAll('button[data-cancel-import]'), function (button) {
      button.addEventListener('click', function () { cancelImport(button.getAttribute('data-cancel-import')); });
    });
    Array.prototype.forEach.call(node.querySelectorAll('button[data-remove-source]'), function (button) {
      button.addEventListener('click', function () { state.sources.splice(+button.getAttribute('data-remove-source'), 1); renderSources(); updateControls(); });
    });
  }
  /* ===== p1-legal-flow-2.0.0 renderers ===================================== */
  function chip(label, value, missingText) {
    var have = clean(value);
    return '<span class="p1l-chip' + (have ? '' : ' missing') + '"><b>' + esc(label) + '</b>' +
      esc(have || missingText) + '</span>';
  }
  function renderBinding() {
    var node = byId('mlsP1LegalBanner'); if (!node) return false;
    if (!state.bound) {
      node.innerHTML = '<div><h2 class="p1l-bindname">No patient bound</h2>' +
        '<p class="p1l-explain">Nothing can be compiled or drafted yet. Add a patient from this account below, or grab one from the EMR, and this workspace binds to that exact chart.</p></div>';
      return true;
    }
    node.innerHTML = '<div><h2 class="p1l-bindname">Bound to ' + esc(state.bound.name || '[name unavailable]') + '</h2>' +
      '<div class="p1l-chips">' + chip('DOB', state.bound.dob, 'not documented') +
      chip('MRN', state.bound.mrn, 'not documented') + '</div></div>' +
      '<button type="button" class="p1l-change" id="mlsP1LegalChange">Change</button>';
    var change = byId('mlsP1LegalChange');
    if (change && isFn(change.addEventListener)) change.addEventListener('click', function () {
      var box = byId('mlsP1LegalRosterSearch');
      setStatus('Search this account’s patients below, or grab one from the EMR, to re-bind this workspace.', false);
      if (box && isFn(box.focus)) box.focus();
    });
    return true;
  }
  function renderRosterResults(query) {
    var node = byId('mlsP1LegalRosterResults'); if (!node) return 0;
    var q = clean(query);
    if (q.length < 2) { node.innerHTML = ''; return 0; }
    var hits = rosterMatches(q, 12);
    if (!hits.length) {
      node.innerHTML = '<p class="p1l-explain">No patient in this account matches “' + esc(q) + '”. Grab them from the EMR below, or check the spelling — nothing is guessed.</p>';
      return 0;
    }
    node.innerHTML = '<div class="p1l-picker" role="listbox">' + hits.map(function (p) {
      return '<button type="button" class="p1l-pick" role="option" data-bind-id="' + esc(clean(p.id)) + '">' +
        esc(clean(p.name) || '(unnamed record)') +
        '<small>' + esc([clean(p.dob) ? 'DOB ' + clean(p.dob) : 'DOB not on file',
          clean(p.mrn) ? 'MRN ' + clean(p.mrn) : 'MRN not on file'].join(' · ')) + '</small></button>';
    }).join('') + '</div>';
    Array.prototype.forEach.call(node.querySelectorAll('button[data-bind-id]'), function (button) {
      button.addEventListener('click', function () { requestBind(button.getAttribute('data-bind-id')); });
    });
    return hits.length;
  }
  function renderRoster() {
    var node = byId('mlsP1LegalRoster'); if (!node) return false;
    var prior = byId('mlsP1LegalRosterSearch');
    var typed = prior ? clean(prior.value) : '';
    var total = rosterPatients().length;
    node.innerHTML = '<label style="display:block;margin-top:12px" for="mlsP1LegalRosterSearch">' +
      (state.bound ? 'Change to another patient' : 'Add a patient') +
      ' <input id="mlsP1LegalRosterSearch" type="text" autocomplete="off" placeholder="Search this account by name, DOB or MRN — ' + total + ' on file"></label>' +
      '<div id="mlsP1LegalRosterResults" aria-live="polite"></div>';
    var box = byId('mlsP1LegalRosterSearch');
    if (box) {
      box.value = typed;
      box.addEventListener('input', function () { renderRosterResults(box.value); });
    }
    if (typed) renderRosterResults(typed);
    return true;
  }
  function renderReadOps() {
    var node = byId('mlsP1LegalReadOps'); if (!node) return false;
    var priorDate = byId('mlsP1LegalReadDay');
    var typedDate = priorDate ? clean(priorDate.value) : '';
    var busy = !!state.athenaOp;
    node.innerHTML = '<div style="margin-top:14px"><b style="font-size:14px">Grab from the EMR (read-only)</b>' +
      '<p class="p1l-explain">These run the reads MLS already ships. They read the signed-in EMR tab and bring the record into this account; nothing is ever written back to the EMR by this workspace.</p>' +
      readOpKeys().map(function (key) {
        var op = ATHENA_READ_OPS[key], available = readOpAvailable(key);
        var running = state.athenaOp === key;
        return '<div class="p1l-readop"><b>' + esc(op.label) + '</b>' + esc(op.blurb) +
          (key === 'day' ? '<label style="display:block;margin-top:7px">Day to read <input id="mlsP1LegalReadDay" type="text" placeholder="YYYY-MM-DD; blank reads today"></label>' : '') +
          '<div class="p1l-actions"><button type="button" data-read-op="' + esc(key) + '"' +
          (available && !busy ? '' : ' disabled') + '>' + (running ? 'Reading…' : esc(op.label)) + '</button>' +
          (available ? '' : '<span style="color:#8a5a1a;font-size:12.5px;align-self:center">Unavailable in this session — ' + esc(op.needs) + ' is not loaded.</span>') +
          '</div></div>';
      }).join('') +
      (state.athenaNote ? '<p class="p1l-explain">' + esc(state.athenaNote) + '</p>' : '') + '</div>';
    var dateBox = byId('mlsP1LegalReadDay'); if (dateBox) dateBox.value = typedDate;
    Array.prototype.forEach.call(node.querySelectorAll('button[data-read-op]'), function (button) {
      button.addEventListener('click', function () {
        var box = byId('mlsP1LegalReadDay');
        runReadOp(button.getAttribute('data-read-op'), { date: box ? clean(box.value) : '' });
      });
    });
    return true;
  }
  function renderReportTypes() {
    var node = byId('mlsP1LegalReportTypes'); if (!node) return false;
    node.innerHTML = REPORT_TYPES.map(function (report) {
      var on = state.reportType === report.key;
      var count = sectionsFor(report.key).length;
      return '<button type="button" class="p1l-report" aria-pressed="' + (on ? 'true' : 'false') +
        '" data-report-type="' + esc(report.key) + '">' + esc(report.label) +
        '<small>' + esc(report.blurb) + ' ' + (report.ai ? (count + ' AI-drafted sections.') : 'No AI sections.') + '</small></button>';
    }).join('');
    Array.prototype.forEach.call(node.querySelectorAll('button[data-report-type]'), function (button) {
      button.addEventListener('click', function () { pickReportType(button.getAttribute('data-report-type')); });
    });
    return true;
  }
  function renderSnapshotNotice() {
    var node = byId('mlsP1LegalFreeze'); if (!node) return false;
    if (!state.bound) { node.textContent = 'No patient bound, so nothing is compiled.'; node.className = 'p1l-freeze'; return true; }
    if (!state.model) { node.textContent = 'Not compiled yet — press Compile history.'; node.className = 'p1l-freeze'; return true; }
    var when = state.snapshotAt ? new Date(state.snapshotAt).toLocaleTimeString() : 'this session';
    if (snapshotDrifted()) {
      node.className = 'p1l-freeze stale';
      node.textContent = 'This chart has changed since the snapshot was frozen at ' + when +
        '. This workspace is still showing the frozen record; press Compile history to re-freeze it and include the new entries.';
      return true;
    }
    node.className = 'p1l-freeze';
    node.textContent = 'Frozen at ' + when + ' — ' + state.model.items.length + ' documented entries. Re-checked against the chart just now: unchanged.';
    return true;
  }
  /* ===== end p1-legal-flow-2.0.0 renderers ===== */

  function renderProviders() {
    var node = byId('mlsP1LegalProviders'); if (!node || !state.model) return;
    if (!state.bound || !bindingCurrent(state.bound)) { abortForPatientChange(); return; }
    if (!state.providerFilter) { state.providerFilter = {}; state.model.providers.forEach(function (p) { state.providerFilter[p] = true; }); }
    node.innerHTML = state.model.providers.map(function (provider) {
      var on = state.providerFilter[provider] !== false;
      return '<button type="button" class="p1l-filter' + (on ? '' : ' off') + '" aria-pressed="' + (on ? 'true' : 'false') + '" data-provider="' + esc(provider) + '">' + esc(provider) + '</button>';
    }).join('');
    Array.prototype.forEach.call(node.querySelectorAll('button[data-provider]'), function (chip) {
      chip.addEventListener('click', function () {
        var p = chip.getAttribute('data-provider'), on = state.providerFilter[p] === false;
        filterProvider(p, on);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        chip.className = 'p1l-filter' + (on ? '' : ' off');
      });
    });
  }
  /* The single provider-filter mutation. The chip above and the public API
     both go through it, so what a test drives is what a click does. */
  function filterProvider(provider, on) {
    if (!state.model) return false;
    if (!state.providerFilter) { state.providerFilter = {}; state.model.providers.forEach(function (p) { state.providerFilter[p] = true; }); }
    if (state.model.providers.indexOf(provider) < 0) return false;
    state.providerFilter[provider] = !!on;
    renderChronology();
    return true;
  }
  function renderChronology() {
    var node = byId('mlsP1LegalChronology'); if (!node || !state.model) return;
    if (!state.bound || !bindingCurrent(state.bound)) { abortForPatientChange(); return; }
    var items = filteredItems(), html = '';
    CATEGORIES.forEach(function (category) {
      var rows = items.filter(function (item) { return item.category === category[0]; });
      html += '<div class="p1l-section"><b>' + esc((CATEGORY_ICONS[category[0]] || '') + ' ' + category[1]) + ' (' + rows.length + ')</b>';
      if (!rows.length) html += '<p>(none documented)</p>';
      rows.forEach(function (item) {
        html += '<div class="p1l-item"><b>' + esc(niceDate(item.date)) + ' · ' + esc(item.title) + '</b><div>' + esc(item.provider) + ' · ' + esc(item.source) + '</div>' + (item.body && item.body !== item.title ? '<pre>' + esc(item.body) + '</pre>' : '') + '</div>';
      });
      html += '</div>';
    });
    node.innerHTML = html;
  }
  function compileHistory() {
    if (!state.bound) {
      setStatus('Bind a patient before compiling a chronology. Nothing was compiled.', true);
      renderSnapshotNotice();
      return false;
    }
    if (!bindingCurrent(state.bound)) { abortForPatientChange(); return false; }
    var patient = clone(activePatientNow());
    if (!patient || clean(patient.id) !== state.bound.patientId) { abortForPatientChange(); return false; }
    state.model = buildModel(patient, state.bound); state.providerFilter = null;
    /* p1-legal-flow-2.0.0: freezing is what makes the chronology trustworthy,
       so record WHAT was frozen and WHEN, and re-measure it later rather than
       assuming the chart stood still. */
    state.snapshot = patient;
    state.snapshotSig = snapshotSignature(patient);
    state.snapshotAt = Date.now();
    renderProviders(); renderChronology(); renderSnapshotNotice();
    ['mlsP1LegalChronCopy', 'mlsP1LegalChronDownload', 'mlsP1LegalChronPrint'].forEach(function (id) { var node = byId(id); if (node) node.disabled = false; });
    setStatus('Read-only chronology compiled from ' + state.model.items.length + ' documented entries.', false);
    return true;
  }
  function wire() {
    /* Null-safe: the shell renders every control, but a caller may drive this
       module against a partial DOM. A missing node must be a missing control,
       never a thrown boot. */
    function on(id, event, handler) {
      var node = byId(id);
      if (node && isFn(node.addEventListener)) node.addEventListener(event, handler);
      return node;
    }
    function exportIfCurrent(getText, action) {
      if (!state.bound || !bindingCurrent(state.bound)) { abortForPatientChange(); return; }
      action(getText());
    }
    function exportDraft(action) {
      exportIfCurrent(function () { return (byId('mlsP1LegalDraft') || {}).value || state.draft; }, function (text) {
        action(text);
        /* p1-legal-flow-2.0.0: the flow ends when the report actually leaves. */
        if (state.stage === 'generated') setStage('exported');
      });
    }
    on('mlsP1LegalClose', 'click', closeOverlay);
    on('mlsP1LegalCompile', 'click', compileHistory);
    on('mlsP1LegalChronCopy', 'click', function () { exportIfCurrent(chronologyText, function (text) { copyText(text, 'Chronology'); }); });
    on('mlsP1LegalChronDownload', 'click', function () { exportIfCurrent(chronologyText, function (text) { downloadText('MLS_1p_Legal_Chronology_' + todayYmd() + '.txt', text); }); });
    on('mlsP1LegalChronPrint', 'click', function () { exportIfCurrent(chronologyText, function (text) { printText('Read-only medical-legal chronology', text); }); });
    on('mlsP1LegalGenerate', 'click', function () { if (!state.model && !compileHistory()) return; generateDraft(); });
    on('mlsP1LegalCancel', 'click', function () { cancelGeneration('Generation canceled. Any late response is blocked; the current inputs remain editable.'); });
    on('mlsP1LegalDraftCopy', 'click', function () { exportDraft(function (text) { copyText(text, 'Draft'); }); });
    on('mlsP1LegalDraftDownload', 'click', function () { exportDraft(function (text) { downloadText('MLS_1p_Legal_IME_DRAFT_' + todayYmd() + '.txt', text); }); });
    on('mlsP1LegalDraftPrint', 'click', function () { exportDraft(function (text) { printText('Medical-Legal / IME DRAFT', text); }); });
    var drop = byId('mlsP1LegalDrop'), input = byId('mlsP1LegalFile');
    if (drop && input) {
      drop.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
      drop.addEventListener('dragover', function (event) { event.preventDefault(); });
      drop.addEventListener('drop', function (event) { event.preventDefault(); if (event.dataTransfer) addFiles(event.dataTransfer.files); });
    }
    /* p1-legal-flow-2.0.0: step 1 (patient) and step 2 (report type). */
    renderBinding(); renderRoster(); renderReadOps(); renderReportTypes(); renderSnapshotNotice();
    /* p1-legal-letterhead-1.0.0: show what will print, and take the one field
       Settings has no home for. A refused save is SAID, never swallowed. */
    var lhEmail = byId('mlsP1LegalLetterheadEmail');
    if (lhEmail) {
      lhEmail.value = letterheadEmail();
      lhEmail.addEventListener('input', function () { renderLetterheadPreview(); });
      lhEmail.addEventListener('change', function () {
        if (saveLetterheadEmail(lhEmail.value)) renderLetterheadPreview();
        else setStatus('The letterhead email could not be saved for this account. It will still print on this draft.', true);
      });
    }
    renderLetterheadPreview();
    updateControls();
  }
  function renderLetterheadPreview() {
    var node = byId('mlsP1LegalLetterheadPreview');
    if (!node) return false;
    /* the block already prefers the live field, so this previews exactly
       what Generate will print */
    node.textContent = letterheadBlock();
    return true;
  }
  function dialogFocusable(root) {
    if (!root || !isFn(root.querySelectorAll)) return [];
    return Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(function (node) {
      return !node.hidden && (!node.style || node.style.display !== 'none');
    });
  }
  function onDialogKeydown(event) {
    if (!byId(ROOT_ID)) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeOverlay(); return;
    }
    if (event.key !== 'Tab') return;
    var root = byId(ROOT_ID), focusable = dialogFocusable(root); if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1], current = document.activeElement;
    if (isFn(root.contains) && !root.contains(current)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && current === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && current === last) { event.preventDefault(); first.focus(); }
  }
  function closeOverlayInternal(restoreFocus) {
    var prior = state.priorFocus;
    abortCurrentRun('closed'); cancelAllImports(); state.session++;
    state.open = false; state.generating = false; state.bound = null;
    state.model = null; state.providerFilter = null; state.sources = []; state.draft = '';
    state.stage = 'unbound'; state.reportType = '';
    state.snapshot = null; state.snapshotSig = ''; state.snapshotAt = 0;
    state.rebindIntent = null; state.athenaOp = ''; state.athenaNote = '';
    var root = byId(ROOT_ID); if (root && root.parentNode) root.parentNode.removeChild(root);
    state.priorFocus = null;
    if (restoreFocus && prior && isFn(prior.focus)) { try { prior.focus(); } catch (e) {} }
  }
  function closeOverlay() {
    closeOverlayInternal(true);
  }
  function openOverlay() {
    if (clinicalAccess() !== 'eligible') {
      toast('The free Legal / IME preview is available only to signed-in clinical users. Nothing was opened.', 'err');
      return false;
    }
    /* p1-legal-bind-2.0.0: an unbound open is now a legitimate state - it is
       how a clinician ADDS a patient. It is not a silent one: the workspace
       says plainly that nothing is bound and offers the two ways in. */
    var binding = captureBinding();
    var existingRoot = byId(ROOT_ID), active = document.activeElement;
    var prior = existingRoot && isFn(existingRoot.contains) && existingRoot.contains(active) ? state.priorFocus : active;
    closeOverlayInternal(false); ensureStyle();
    state.open = true; state.bound = binding || null; state.sources = []; state.draft = '';
    state.reportType = ''; state.priorFocus = prior;
    state.snapshot = null; state.snapshotSig = ''; state.snapshotAt = 0; state.rebindIntent = null;
    state.athenaOp = ''; state.athenaNote = '';
    var root = document.createElement('div'); root.id = ROOT_ID; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'mlsP1LegalTitle'); root.innerHTML = shellHtml();
    root.addEventListener('keydown', onDialogKeydown);
    (document.body || document.documentElement).appendChild(root);
    setStage(binding ? 'bound' : 'unbound');
    wire();
    if (binding) compileHistory();
    else setStatus('No patient bound — add a patient from this account, or grab one from the EMR.', true);
    updateControls();
    var close = byId('mlsP1LegalClose'); if (close && isFn(close.focus)) close.focus();
    return true;
  }
  function tryPendingQueryOpen() {
    if (!queryOpenPending || state.open) return false;
    var access = clinicalAccess();
    if (access !== 'eligible' || !captureBinding()) { syncDoor(); return false; }
    queryOpenPending = false;
    return openOverlay();
  }
  function onPatientChange() {
    /* p1-legal-bind-2.0.0: a change this workspace ASKED for is a re-bind; any
       other change is the external event it has always been and still fails
       closed. The intent is consumed either way, so a stale intent can never
       adopt a later, unrelated patient. */
    if (state.open && state.rebindIntent) {
      var wanted = state.rebindIntent.patientId;
      state.rebindIntent = null;
      if (activeIdNow() === wanted) { adoptBinding('changed'); syncDoor(); return; }
    }
    abortForPatientChange(); syncDoor(); tryPendingQueryOpen();
  }
  function onSessionBoundary() {
    /* Account identity is an unconditional lifetime boundary, even when both
       accounts are clinicians. Never let account B inherit account A's PHI. */
    if (state.open) closeOverlayInternal(false);
    /* Do not consume a pending deep link against the pre-boundary patient.
       A post-boundary patient event (or an explicit door click) may open it. */
    syncDoor();
  }
  try { window.addEventListener('mls:active-patient-changed', onPatientChange, true); } catch (e) {}
  try { window.addEventListener('mls:session-boundary', onSessionBoundary, true); } catch (e) {}
  installDoorHook();

  function apiCurrent() {
    return apiLive === true && window.__mlsP1LegalPack === api &&
      api && api.installToken === liveLoader.installToken;
  }
  api = {
    installed: true,
    version: VERSION,
    installToken: liveLoader.installToken,
    open: function () { return apiCurrent() ? openOverlay() : false; },
    close: function () { if (!apiCurrent()) return false; closeOverlay(); return true; },
    buildModel: function (patient, binding) { return apiCurrent() ? buildModel(patient, binding) : { binding: null, items: [], providers: [], counts: {} }; },
    chronologyText: function () { return apiCurrent() ? chronologyText() : ''; },
    readLocalFile: function (file, options) { return apiCurrent() ? readLocalFile(file, options) : Promise.reject(abortError('stale-api', 'This Legal / IME preview instance is no longer current.')); },
    bindingCurrent: function (binding) { return apiCurrent() && bindingCurrent(binding); },
    generateDraft: function () { return apiCurrent() ? generateDraft() : Promise.resolve(false); },
    cancel: function () { return apiCurrent() ? cancelGeneration() : false; },
    addFiles: function (files) { return apiCurrent() ? addFiles(files) : 0; },
    sections: SECTIONS.slice(),
    /* p1-legal-letterhead-1.0.0: what the report will print at the top and
       above the signature line, and the certainty standard it states. Read
       only - no patient data, no PHI. */
    letterhead: function () { return apiCurrent() ? letterhead() : null; },
    letterheadBlock: function () { return apiCurrent() ? letterheadBlock() : ''; },
    attestationBlock: function () { return apiCurrent() ? attestationBlock() : ''; },
    certaintyStandard: CERTAINTY_STANDARD,
    /* ===== p1-legal-flow-2.0.0 / p1-legal-bind-2.0.0 public surface =====
       Read-only receipts and the four flow verbs. No PHI leaves through any
       of these except the roster row the clinician is already looking at. */
    stages: STAGES.slice(),
    reportTypes: REPORT_TYPES.map(function (r) {
      return { key: r.key, label: r.label, blurb: r.blurb, ai: r.ai, sectionCount: sectionsFor(r.key).length };
    }),
    sectionsFor: function (key) { return apiCurrent() ? sectionsFor(key) : []; },
    runSections: function (key) { return apiCurrent() ? runSections(key) : []; },
    pickReport: function (key) { return apiCurrent() ? pickReportType(key) : false; },
    roster: function (query) {
      return apiCurrent() ? rosterMatches(query, 12).map(function (p) { return { id: clean(p.id), name: clean(p.name), dob: clean(p.dob), mrn: clean(p.mrn) }; }) : [];
    },
    bindTo: function (id) { return apiCurrent() ? requestBind(id) : false; },
    filterProvider: function (provider, on) { return apiCurrent() ? filterProvider(provider, on) : false; },
    readOps: function () {
      return apiCurrent() ? readOpKeys().map(function (key) {
        return { key: key, label: ATHENA_READ_OPS[key].label, available: readOpAvailable(key) };
      }) : [];
    },
    runReadOp: function (key, input) { return apiCurrent() ? runReadOp(key, input) : Promise.resolve(false); },
    snapshotDrifted: function () { return apiCurrent() && snapshotDrifted(); },
    /* p1-legal-restore-2.0.0: the restored production extractors, exposed so
       each one is EXECUTED by a test rather than grepped for. */
    restored: {
      provOfVisit: provOfVisit, normProv: normProv, classifiable: classifiable,
      planOf: planOf, fuLinesOf: fuLinesOf, icdOf: icdOf, activeFilterNote: activeFilterNote
    },
    state: function () { return { open: apiCurrent() && state.open, patientBound: apiCurrent() && !!state.bound, generating: apiCurrent() && state.generating,
      sourceCount: state.sources.length, pendingFileCount: pendingImportCount(), activeReaderCount: state.importActive,
      sectionCount: SECTIONS.length,
      stage: apiCurrent() ? state.stage : 'unbound', reportType: apiCurrent() ? state.reportType : '',
      reading: apiCurrent() ? state.athenaOp : '' }; },
    revert: function () {
      if (!apiCurrent()) { apiLive = false; return false; }
      apiLive = false;
      if (autoOpenTimer) { clearTimeout(autoOpenTimer); autoOpenTimer = null; }
      queryOpenPending = false;
      closeOverlay();
      try { window.removeEventListener('mls:active-patient-changed', onPatientChange, true); } catch (e) {}
      try { window.removeEventListener('mls:session-boundary', onSessionBoundary, true); } catch (e) {}
      removeDoorHook();
      var style = byId(STYLE_ID); if (style && style.parentNode) style.parentNode.removeChild(style);
      if (window.__mlsP1LegalPack === api) {
        try { delete window.__mlsP1LegalPack; } catch (e2) { window.__mlsP1LegalPack = null; }
      }
      return true;
    }
  };
  window.__mlsP1LegalPack = api;
  try {
    var params = new URLSearchParams(location.search || '');
    if (params.get('tool') === 'legal') {
      queryOpenPending = true;
      autoOpenTimer = setTimeout(function () { autoOpenTimer = null; tryPendingQueryOpen(); }, 0);
    }
  } catch (e) {}
})();
