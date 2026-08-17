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
    priorFocus: null
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
  var RE_PROCEDURE = /\b(operative|procedure|surgery|surgical|injection|epidural|arthroscop|fusion|discectomy|laminectomy|ablation|rfa|block)\b/i;
  var RE_IMAGING = /\b(mri|x-?ray|radiograph|ct\b|ultrasound|emg|ncs\b|dexa|imaging|diagnostic stud)/i;
  var RE_OUTSIDE = /\b(outside|external|records from|hospital records|emergency department|transferred)\b/i;
  var RE_FOLLOW = /\b(follow[ -]?up|f\/u|return in|return to|recheck|re-evaluate|next visit)\b/i;

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
    item.provider = providerOf(item) || clean(item.provider) || 'Unattributed';
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
      var blob = type + '\n' + body;
      var category = RE_OUTSIDE.test(blob) ? 'outside' : (RE_IMAGING.test(type) ? 'imaging' : (RE_PROCEDURE.test(type) ? 'procedure' : 'visit'));
      addItem(items, { date: row.date || row.updated, category: category, title: type,
        provider: providerOf(row), source: clean(row.source) || 'Stored visit', body: body });
    });
    notesFor(patientSnapshot).forEach(function (note) {
      if (!rowMatchesBinding(note, binding) || note.isDraft) return;
      var body = String(note.soap || note.text || '').trim();
      var when = note.updated || note.created;
      addItem(items, { date: when, category: RE_PROCEDURE.test(body.slice(0, 900)) ? 'procedure' : 'visit',
        title: 'Visit note' + (note.signed ? ' (signed)' : ' (unsigned)'), provider: providerOf(note), source: 'MLS visit note', body: body });
      var plan = /(?:^|\n)\s*(?:PLAN|P)\s*[:\-]?\s*([\s\S]*?)(?=\n\s*[A-Z][A-Z /&-]{3,}:|$)/i.exec(body);
      if (plan && clean(plan[1])) addItem(items, { date: when, category: 'plan', title: 'Documented treatment plan', provider: providerOf(note), source: 'MLS visit note', body: plan[1] });
      body.split(/\r?\n/).forEach(function (line) {
        if (RE_FOLLOW.test(line)) addItem(items, { date: when, category: 'followup', title: 'Documented follow-up', provider: providerOf(note), source: 'MLS visit note', body: line });
      });
      (body.match(/\b[A-TV-Z]\d{2}(?:\.\d{1,4})?\b[^\n]*/g) || []).forEach(function (line) {
        addItem(items, { date: when, category: 'diagnosis', title: clean(line), provider: providerOf(note), source: 'Documented diagnosis', body: line });
      });
      if (RE_IMAGING.test(body)) {
        var imaging = body.split(/\r?\n/).filter(function (line) { return RE_IMAGING.test(line); }).slice(0, 12);
        if (imaging.length) addItem(items, { date: when, category: 'imaging', title: 'Imaging referenced in note', provider: providerOf(note), source: 'MLS visit note', body: imaging.join('\n') });
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
        title: name, provider: 'Unattributed', source: 'Stored chart document',
        body: text ? text.slice(0, 20000) + (text.length > 20000 ? '\n[truncated for preview display]' : '') : '(no extractable text stored)' });
    });
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
      'Preview draft source; handle as PHI.', ''];
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
    if (!isFn(window.aiCallRaw)) { setStatus('AI drafting is unavailable in this MLS session. Nothing was sent.', true); return Promise.resolve(false); }
    var binding = state.bound, contextReceipt = draftContext(), context = contextReceipt.text;
    var run = { id: ++state.runSeq, session: state.session, binding: binding,
      controller: makeAbortController(), callControllers: [], wholeTimer: null };
    /* p1-legal-letterhead-1.0.0: the practice letterhead is the FIRST thing on
       the report, before the draft banner, exactly as it would be on paper. */
    var output = [letterheadBlock(),
      'MEDICAL-LEGAL / IME WORKSPACE DRAFT', 'Patient: ' + (binding.name || '[not documented]'),
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
    SECTIONS.forEach(function (section, index) {
      chain = chain.then(function () {
        if (!runOwned(run)) throw abortError('stale-run', 'Draft run is no longer current.');
        setStatus('Drafting section ' + (index + 1) + ' of ' + SECTIONS.length + ': ' + section[0], false);
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
      enableExports(true); finishOwnedRun(run);
      setStatus('Draft ready: ' + SECTIONS.length + ' of ' + SECTIONS.length + ' sections.' + (contextReceipt.truncated ?
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
    '@media(max-width:820px){#' + ROOT_ID + ' .p1l-grid{grid-template-columns:1fr}#' + ROOT_ID + ' .p1l-card.wide{grid-column:auto}#' + ROOT_ID + ' .p1l-shell{padding:18px 13px 70px}}'
  ].join('\n');

  function ensureStyle() {
    if (byId(STYLE_ID)) return;
    var style = document.createElement('style'); style.id = STYLE_ID; style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }
  function shellHtml(binding) {
    return '<div class="p1l-shell">' +
      '<div class="p1l-top"><div><span class="p1l-badge">Free 1p preview · read-only draft workspace</span><h1 id="mlsP1LegalTitle">Legal / IME workspace</h1><p>Exact active chart, local files, and a ' + SECTIONS.length + '-section clinician-review draft on your practice letterhead. No signing, delivery, chart filing, Athena writing, payment, messaging, or public intake.</p></div><button type="button" class="p1l-close" id="mlsP1LegalClose">Close preview</button></div>' +
      '<div id="mlsP1LegalBanner" class="p1l-bind">Bound to ' + esc(binding.name || '[name unavailable]') + ' · DOB ' + esc(binding.dob || '[not documented]') + (binding.mrn ? ' · MRN ' + esc(binding.mrn) : '') + '</div>' +
      '<div class="p1l-grid">' +
      '<section class="p1l-card wide"><h2>Read-only categorized chronology</h2><p>Compiled from a frozen snapshot of the patient active when this workspace opened. Provider filters affect preview/export only.</p><div class="p1l-actions"><button type="button" class="primary" id="mlsP1LegalCompile">Compile history</button><button type="button" id="mlsP1LegalChronCopy" disabled>Copy chronology</button><button type="button" id="mlsP1LegalChronDownload" disabled>Download .txt</button><button type="button" id="mlsP1LegalChronPrint" disabled>Print</button></div><div id="mlsP1LegalProviders" class="p1l-actions" aria-label="Filter chronology by provider"></div><div id="mlsP1LegalChronology"></div></section>' +
      '<section class="p1l-card"><h2>Local records</h2><p id="mlsP1LegalFileHelp">Searchable PDF, DOCX, and text files are read by this browser. Raw file bytes never leave the browser. When you press Generate, extracted text from files still listed here is included in the configured MLS AI context; remove a file first if its text should not be included. Up to 8 files / 50 MB total. Image OCR is intentionally disabled.</p><button type="button" class="p1l-drop" id="mlsP1LegalDrop" aria-describedby="mlsP1LegalFileHelp">Choose or drop local files</button><input id="mlsP1LegalFile" type="file" multiple accept=".pdf,.docx,.txt,.md,.rtf,.csv,.tsv,.json,.html,text/*" hidden><div id="mlsP1LegalSources" aria-live="polite"></div></section>' +
      '<section class="p1l-card"><h2>Draft inputs</h2><label>Date of injury / onset <input id="mlsP1LegalDoi" type="text" placeholder="Only if known; the draft must reconcile it with the record"></label><label style="display:block;margin-top:10px">Questions to address <textarea id="mlsP1LegalQuestions" placeholder="Optional questions. Unsupported answers must stay bracketed or undeterminable."></textarea></label><fieldset id="mlsP1LegalLetterhead" style="margin-top:12px;border:1px solid #d7ddd8;border-radius:10px;padding:10px 12px"><legend style="font-weight:750;font-size:13px;padding:0 4px">Letterhead</legend><p style="margin:2px 0 8px">Printed at the top of the report and above the signature line. Practice name, provider name, credentials, NPI, address and phone come from Settings; change them there.</p><pre id="mlsP1LegalLetterheadPreview" style="white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:#fafbf8;border:1px solid #e4e8e4;border-radius:8px;padding:8px;margin:0 0 8px"></pre><label>Contact email for the letterhead <input id="mlsP1LegalLetterheadEmail" type="email" autocomplete="off" placeholder="Optional; saved for this account on this device"></label></fieldset><div class="p1l-actions"><button type="button" class="primary" id="mlsP1LegalGenerate">Generate ' + SECTIONS.length + '-section draft</button><button type="button" id="mlsP1LegalCancel" disabled>Cancel current generation</button></div><div class="p1l-warn">AI disclosure: this sends the compiled record context to the existing configured MLS AI path only when you press Generate. It is an unsigned draft, may be incomplete or wrong, and requires clinician verification.</div><div id="mlsP1LegalStatus" class="p1l-status" role="status" aria-live="polite"></div></section>' +
      '<section class="p1l-card wide"><h2 id="mlsP1LegalDraftLabel">Unsigned clinician-review draft</h2><div class="p1l-actions"><button id="mlsP1LegalDraftCopy" disabled>Copy</button><button id="mlsP1LegalDraftDownload" disabled>Download .txt</button><button id="mlsP1LegalDraftPrint" disabled>Print</button></div><textarea id="mlsP1LegalDraft" aria-labelledby="mlsP1LegalDraftLabel" hidden spellcheck="true"></textarea></section>' +
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
    var pending = pendingImportCount(), running = !!state.run || state.generating;
    var generate = byId('mlsP1LegalGenerate'); if (generate) generate.disabled = running || pending > 0;
    var cancel = byId('mlsP1LegalCancel'); if (cancel) cancel.disabled = !running;
    var drop = byId('mlsP1LegalDrop'); if (drop) drop.disabled = running;
    var input = byId('mlsP1LegalFile'); if (input) input.disabled = running;
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
        state.providerFilter[p] = on;
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        chip.className = 'p1l-filter' + (on ? '' : ' off');
        renderChronology();
      });
    });
  }
  function renderChronology() {
    var node = byId('mlsP1LegalChronology'); if (!node || !state.model) return;
    if (!state.bound || !bindingCurrent(state.bound)) { abortForPatientChange(); return; }
    var items = filteredItems(), html = '';
    CATEGORIES.forEach(function (category) {
      var rows = items.filter(function (item) { return item.category === category[0]; });
      html += '<div class="p1l-section"><b>' + esc(category[1]) + ' (' + rows.length + ')</b>';
      if (!rows.length) html += '<p>(none documented)</p>';
      rows.forEach(function (item) {
        html += '<div class="p1l-item"><b>' + esc(niceDate(item.date)) + ' · ' + esc(item.title) + '</b><div>' + esc(item.provider) + ' · ' + esc(item.source) + '</div>' + (item.body && item.body !== item.title ? '<pre>' + esc(item.body) + '</pre>' : '') + '</div>';
      });
      html += '</div>';
    });
    node.innerHTML = html;
  }
  function compileHistory() {
    if (!state.bound || !bindingCurrent(state.bound)) { abortForPatientChange(); return false; }
    var patient = clone(activePatientNow());
    if (!patient || clean(patient.id) !== state.bound.patientId) { abortForPatientChange(); return false; }
    state.model = buildModel(patient, state.bound); state.providerFilter = null;
    renderProviders(); renderChronology();
    ['mlsP1LegalChronCopy', 'mlsP1LegalChronDownload', 'mlsP1LegalChronPrint'].forEach(function (id) { var node = byId(id); if (node) node.disabled = false; });
    setStatus('Read-only chronology compiled from ' + state.model.items.length + ' documented entries.', false);
    return true;
  }
  function wire() {
    function exportIfCurrent(getText, action) {
      if (!state.bound || !bindingCurrent(state.bound)) { abortForPatientChange(); return; }
      action(getText());
    }
    byId('mlsP1LegalClose').addEventListener('click', closeOverlay);
    byId('mlsP1LegalCompile').addEventListener('click', compileHistory);
    byId('mlsP1LegalChronCopy').addEventListener('click', function () { exportIfCurrent(chronologyText, function (text) { copyText(text, 'Chronology'); }); });
    byId('mlsP1LegalChronDownload').addEventListener('click', function () { exportIfCurrent(chronologyText, function (text) { downloadText('MLS_1p_Legal_Chronology_' + todayYmd() + '.txt', text); }); });
    byId('mlsP1LegalChronPrint').addEventListener('click', function () { exportIfCurrent(chronologyText, function (text) { printText('Read-only medical-legal chronology', text); }); });
    byId('mlsP1LegalGenerate').addEventListener('click', function () { if (!state.model && !compileHistory()) return; generateDraft(); });
    byId('mlsP1LegalCancel').addEventListener('click', function () { cancelGeneration('Generation canceled. Any late response is blocked; the current inputs remain editable.'); });
    byId('mlsP1LegalDraftCopy').addEventListener('click', function () { exportIfCurrent(function () { return (byId('mlsP1LegalDraft') || {}).value || state.draft; }, function (text) { copyText(text, 'Draft'); }); });
    byId('mlsP1LegalDraftDownload').addEventListener('click', function () { exportIfCurrent(function () { return (byId('mlsP1LegalDraft') || {}).value || state.draft; }, function (text) { downloadText('MLS_1p_Legal_IME_DRAFT_' + todayYmd() + '.txt', text); }); });
    byId('mlsP1LegalDraftPrint').addEventListener('click', function () { exportIfCurrent(function () { return (byId('mlsP1LegalDraft') || {}).value || state.draft; }, function (text) { printText('Medical-Legal / IME DRAFT', text); }); });
    var drop = byId('mlsP1LegalDrop'), input = byId('mlsP1LegalFile');
    drop.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
    drop.addEventListener('dragover', function (event) { event.preventDefault(); });
    drop.addEventListener('drop', function (event) { event.preventDefault(); if (event.dataTransfer) addFiles(event.dataTransfer.files); });
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
    var binding = captureBinding();
    if (!binding) { toast('Open exactly one active patient before Legal / IME. Nothing was opened.', 'err'); return false; }
    var existingRoot = byId(ROOT_ID), active = document.activeElement;
    var prior = existingRoot && isFn(existingRoot.contains) && existingRoot.contains(active) ? state.priorFocus : active;
    closeOverlayInternal(false); ensureStyle();
    state.open = true; state.bound = binding; state.sources = []; state.draft = ''; state.priorFocus = prior;
    var root = document.createElement('div'); root.id = ROOT_ID; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'mlsP1LegalTitle'); root.innerHTML = shellHtml(binding);
    root.addEventListener('keydown', onDialogKeydown);
    (document.body || document.documentElement).appendChild(root); wire(); compileHistory();
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
  function onPatientChange() { abortForPatientChange(); syncDoor(); tryPendingQueryOpen(); }
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
    state: function () { return { open: apiCurrent() && state.open, patientBound: apiCurrent() && !!state.bound, generating: apiCurrent() && state.generating,
      sourceCount: state.sources.length, pendingFileCount: pendingImportCount(), activeReaderCount: state.importActive,
      sectionCount: SECTIONS.length }; },
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
