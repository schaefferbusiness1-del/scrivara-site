/* feat_mls_show_assistant.js -> window.__mlsShowAsst (sa-2.0.0)
 *
 * Destination teaching is deliberately not a second writeback screen. The
 * unified Athena review owns the visible controls and supplies one immutable
 * manifest row. This service asks MLS Assist to observe the next real click in
 * the one signed-in Athena tab, then stores only a validated, short-lived
 * selector binding for that exact row + patient + visit context.
 *
 * Teaching is read-only. It never focuses, navigates, reloads, clicks, types,
 * saves, signs, bills, orders, or changes Athena. The supervised writer still
 * requires its normal read-only probe, exact name/DOB/MRN/encounter checks, a
 * one-use token, and a fresh trusted Confirm click.
 */
(function () {
  'use strict';
  if (window.__mlsShowAsst && window.__mlsShowAsst.installed) return;

  var VERSION = 'sa-2.0.0';
  var STORE_PREFIX = 'mls-taught-destination-v2:';
  var CAPTURE_TTL_MS = 20 * 60 * 1000;
  var WATCH_TTL_MS = 60 * 1000;
  var ACTIONS = { write_note: 1, stage_billing: 1, save_draft: 1, sign_encounter: 1, place_order: 1 };
  var active = Object.create(null);
  var states = Object.create(null);
  var stopped = false;

  function S(v) { return v == null ? '' : String(v); }
  function trim(v) { return S(v).trim(); }
  function norm(v) { return trim(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function dateKey(v) {
    var m = /([01]?\d)[\/\-.]([0-3]?\d)[\/\-.](\d{2,4})/.exec(S(v));
    if (!m) return '';
    var y = m[3]; if (y.length === 2) y = (Number(y) > ((new Date().getFullYear() % 100) + 1) ? '19' : '20') + y;
    return Number(m[1]) + '/' + Number(m[2]) + '/' + y;
  }
  function stable(v) {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).sort().forEach(function (k) { out[k] = stable(v[k]); });
      return out;
    }
    return v == null ? '' : v;
  }
  function hash(v) {
    var src = ''; try { src = JSON.stringify(stable(v)); } catch (e) { src = S(v); }
    var h = 2166136261;
    for (var i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'td-' + (h >>> 0).toString(16);
  }
  function safeJson(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; } }
  function safeSessionGet(key) { try { return window.sessionStorage && window.sessionStorage.getItem(key); } catch (e) { return ''; } }
  function safeSessionSet(key, value) { try { if (window.sessionStorage) window.sessionStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function safeSessionRemove(key) { try { if (window.sessionStorage) window.sessionStorage.removeItem(key); } catch (e) {} }

  function patientHash(patient) {
    patient = patient || {};
    return hash({ id: trim(patient.patientId || patient.id), mrn: trim(patient.mrn || patient.athenaId), name: norm(patient.name), dob: dateKey(patient.dob) });
  }
  function visitHash(visit) {
    visit = visit || {};
    return hash({ visitDate: trim(visit.visitDate), provider: norm(visit.provider), appointmentId: trim(visit.appointmentId), encounterId: trim(visit.encounterId), encounterUrl: trim(visit.encounterUrl).split('#')[0] });
  }
  function contextFor(manifest, row) {
    manifest = manifest || {}; row = row || {};
    var ctx = {
      schema: 'mls-taught-destination-context-v2',
      action: trim(row.action), kind: trim(row.kind), rowId: trim(row.id), rowHash: trim(row.rowHash),
      manifestHash: trim(manifest.manifestHash), previewHash: trim(manifest.previewHash),
      patientHash: patientHash(manifest.patient), visitHash: visitHash(manifest.visit)
    };
    ctx.contextHash = hash(ctx);
    return ctx;
  }
  function validContext(manifest, row, ctx) {
    return !!(manifest && row && ctx && ACTIONS[ctx.action] && row.capability === 'ready' && ctx.rowId && ctx.rowHash && ctx.manifestHash &&
      trim(manifest.patient && manifest.patient.patientId) && trim(manifest.patient && manifest.patient.name) &&
      dateKey(manifest.patient && manifest.patient.dob) && trim(manifest.patient && manifest.patient.mrn) &&
      trim(manifest.visit && manifest.visit.visitDate) && trim(manifest.visit && manifest.visit.provider) &&
      (trim(manifest.visit && manifest.visit.appointmentId) ||
        (trim(manifest.visit && manifest.visit.encounterId) && trim(manifest.visit && manifest.visit.encounterUrl))));
  }
  function keyFor(ctx) { return STORE_PREFIX + ctx.contextHash; }
  function exactRecord(record, ctx) {
    return !!(record && record.schema === 'mls-taught-destination-v2' && record.contextHash === ctx.contextHash &&
      record.action === ctx.action && record.rowId === ctx.rowId && record.rowHash === ctx.rowHash &&
      record.manifestHash === ctx.manifestHash && record.patientHash === ctx.patientHash && record.visitHash === ctx.visitHash &&
      Number(record.expiresAt || 0) > Date.now() && record.target && trim(record.target.selector) &&
      trim(record.target.sectionLabel) && trim(record.target.framePath) && trim(record.target.targetFingerprint));
  }
  function learnedFor(manifest, row) {
    var ctx = contextFor(manifest, row), raw = safeSessionGet(keyFor(ctx)), record = null;
    try { record = raw ? JSON.parse(raw) : null; } catch (e) { record = null; }
    if (!exactRecord(record, ctx)) { if (raw) safeSessionRemove(keyFor(ctx)); return null; }
    return safeJson(record);
  }
  function transportFor(manifest, row) {
    var record = learnedFor(manifest, row);
    if (!record) return null;
    return {
      schema: record.schema, contextHash: record.contextHash, action: record.action,
      rowId: record.rowId, rowHash: record.rowHash, manifestHash: record.manifestHash,
      patientHash: record.patientHash, visitHash: record.visitHash,
      capturedAt: record.capturedAt, expiresAt: record.expiresAt,
      selector: record.target.selector, sectionLabel: record.target.sectionLabel,
      label: record.target.label, framePath: record.target.framePath,
      frameUrl: record.target.frameUrl, tag: record.target.tag,
      targetFingerprint: record.target.targetFingerprint
    };
  }
  function statusFor(manifest, row) {
    var ctx = contextFor(manifest, row);
    if (states[ctx.contextHash]) return safeJson(states[ctx.contextHash]);
    var learned = learnedFor(manifest, row);
    return learned ? { state: 'captured', message: 'Captured and validated for this exact destination.', contextHash: ctx.contextHash } : { state: 'idle', message: 'No destination taught for this exact row.', contextHash: ctx.contextHash };
  }
  function emit(entry, next) {
    if (!entry || stopped) return;
    next = next || {};
    next.contextHash = entry.context.contextHash;
    next.requestId = entry.requestId;
    states[entry.context.contextHash] = safeJson(next);
    if (typeof entry.onState === 'function') { try { entry.onState(safeJson(next)); } catch (e) {} }
  }
  function cleanTarget(v) {
    v = v && typeof v === 'object' ? v : {};
    return {
      selector: trim(v.selector).slice(0, 2000), sectionLabel: trim(v.sectionLabel || v.label).slice(0, 240),
      label: trim(v.label || v.sectionLabel).slice(0, 240), framePath: trim(v.framePath).slice(0, 100),
      frameUrl: trim(v.frameUrl).slice(0, 1200), tag: trim(v.tag).slice(0, 40),
      targetFingerprint: trim(v.targetFingerprint).slice(0, 120)
    };
  }
  function persistCapture(entry, resp) {
    var ctx = entry.context, target = cleanTarget(resp && resp.target);
    var binding = resp && resp.binding || {};
    if (!target.selector || !target.sectionLabel || !target.framePath || !target.targetFingerprint ||
        trim(binding.contextHash) !== ctx.contextHash || trim(binding.manifestHash) !== ctx.manifestHash ||
        trim(binding.rowHash) !== ctx.rowHash || trim(binding.action) !== ctx.action) return false;
    var now = Date.now();
    var record = {
      schema: 'mls-taught-destination-v2', contextHash: ctx.contextHash, action: ctx.action,
      rowId: ctx.rowId, rowHash: ctx.rowHash, manifestHash: ctx.manifestHash,
      patientHash: ctx.patientHash, visitHash: ctx.visitHash,
      capturedAt: new Date(now).toISOString(), expiresAt: now + CAPTURE_TTL_MS, target: target
    };
    return safeSessionSet(keyFor(ctx), JSON.stringify(record));
  }

  function messageTarget() { try { return window.location.origin || '*'; } catch (e) { return '*'; } }
  function post(message) { try { window.postMessage(message, messageTarget()); return true; } catch (e) { return false; } }
  function cancelEntry(entry, reason, notify, terminalState) {
    if (!entry || active[entry.requestId] !== entry) return false;
    /* Detach the exact generation before callbacks. A stale pagehide, timeout,
       or re-entrant onState handler can never tear down a newer watcher. */
    delete active[entry.requestId];
    if (entry.timer) clearTimeout(entry.timer); entry.timer = null;
    post({ source: 'mls-app', type: 'mlsAppTeachCancel', requestId: entry.requestId, binding: entry.context });
    if (notify !== false) emit(entry, {
      state: terminalState || 'failed', reason: reason || 'cancelled',
      message: terminalState === 'expired' ? 'The read-only watcher expired. Nothing was captured or changed.' : 'Teaching was cancelled. Nothing was captured or changed.'
    });
    return true;
  }
  function cancelAllActive(reason, notify) {
    Object.keys(active).map(function (id) { return active[id]; }).forEach(function (entry) { cancelEntry(entry, reason, notify); });
  }
  function start(manifest, row, onState) {
    var ctx = contextFor(manifest, row);
    if (!validContext(manifest, row, ctx)) {
      var refused = { state: 'failed', reason: 'invalid-context', message: 'This row is not a ready typed Athena destination.' };
      states[ctx.contextHash] = refused; if (typeof onState === 'function') onState(safeJson(refused)); return '';
    }
    /* Only one browser-wide Athena teaching gesture may be armed. Starting a
       different row first retires every older exact request generation. */
    cancelAllActive('replaced', true);
    var requestId = 'teach-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    var entry = { requestId: requestId, context: ctx, manifest: manifest, row: row, onState: onState, timer: null };
    active[requestId] = entry;
    emit(entry, { state: 'connected', message: 'Connected to MLS Assist. Preparing the read-only Athena watcher.' });
    if (!post({
      source: 'mls-app', type: 'mlsAppTeachStart', requestId: requestId,
      binding: ctx, action: ctx.action,
      patient: safeJson(manifest.patient || {}), expectedContext: safeJson(manifest.visit || {}),
      timeoutMs: WATCH_TTL_MS
    })) {
      emit(entry, { state: 'failed', reason: 'bridge-unavailable', message: 'MLS Assist could not be reached.' }); delete active[requestId]; return requestId;
    }
    entry.timer = setTimeout(function () {
      if (!active[requestId]) return;
      cancelEntry(entry, 'timeout', true, 'expired');
    }, WATCH_TTL_MS + 5000);
    return requestId;
  }
  function clear(manifest, row) {
    var ctx = contextFor(manifest, row);
    /* Clearing during an in-flight re-teach must stop the browser watcher first.
       Otherwise the next Athena click could still be consumed and recaptured. */
    cancel(manifest, row, 'cleared');
    safeSessionRemove(keyFor(ctx)); delete states[ctx.contextHash];
    return true;
  }
  function cancel(manifest, row, reason) {
    var ctx = contextFor(manifest, row), found = null;
    Object.keys(active).some(function (id) { if (active[id] && active[id].context.contextHash === ctx.contextHash) { found = active[id]; return true; } return false; });
    return found ? cancelEntry(found, reason || 'cancelled', true) : false;
  }
  function onMessage(ev) {
    var d = ev && ev.data;
    if (!d || d.source !== 'mls-ext' || (d.type !== 'mlsAppTeachStartResult' && d.type !== 'mlsAppTeachProgress')) return;
    var entry = active[trim(d.requestId)]; if (!entry) return;
    var resp = d.resp || {}, state = trim(resp.state);
    if (d.type === 'mlsAppTeachStartResult') {
      if (!resp.ok) {
        if (entry.timer) clearTimeout(entry.timer); emit(entry, { state: 'failed', reason: trim(resp.reason || resp.error) || 'watcher-unavailable', message: trim(resp.message || resp.error) || 'The Athena watcher is unavailable.' }); delete active[entry.requestId];
      } else emit(entry, { state: 'waiting', message: trim(resp.message) || 'Waiting for your next click in the exact Athena destination.' });
      return;
    }
    if (state === 'captured') {
      if (entry.timer) clearTimeout(entry.timer);
      if (persistCapture(entry, resp)) emit(entry, { state: 'captured', message: 'Captured and validated for this exact patient and destination.', target: cleanTarget(resp.target) });
      else emit(entry, { state: 'failed', reason: 'binding-mismatch', message: 'The captured destination did not match this exact review row.' });
      delete active[entry.requestId]; return;
    }
    if (state === 'failed' || state === 'expired') {
      if (entry.timer) clearTimeout(entry.timer);
      emit(entry, { state: state, reason: trim(resp.reason || resp.error), message: trim(resp.message || resp.error) || (state === 'expired' ? 'The watcher expired. Nothing changed.' : 'The destination could not be validated.') });
      delete active[entry.requestId]; return;
    }
    if (state === 'connected' || state === 'waiting') emit(entry, { state: state, message: trim(resp.message) });
  }

  function guidance() {
    var message = 'Open the final “Review everything going to Athena” screen, then use Teach destination beside the exact row you want to teach.';
    try { if (typeof window.toast === 'function') window.toast(message); } catch (e) {}
    return { matched: true, reply: message };
  }
  var wrapped = null;
  function wrapChat() {
    var router = null; try { router = window.__mlsWbRouter; } catch (e) {}
    if (!router || typeof router.parseCommand !== 'function' || router.__mlsShowAsstV2) return;
    var prior = router.parseCommand.bind(router);
    wrapped = function (text) {
      var low = trim(text).toLowerCase();
      if (/\b(show|teach|learn)\b/.test(low) && /\b(destination|where|field|section|writeback|athena)\b/.test(low)) return guidance();
      return prior(text);
    };
    router.__mlsShowAsstPrior = prior; router.__mlsShowAsstV2 = true; router.parseCommand = wrapped;
  }
  function revert() {
    cancelAllActive('revert', false);
    stopped = true;
    try { window.removeEventListener('message', onMessage, false); } catch (e) {}
    try { window.removeEventListener('pagehide', onPageExit, false); window.removeEventListener('unload', onPageExit, false); } catch (eExit) {}
    active = Object.create(null);
    try {
      var router = window.__mlsWbRouter;
      if (router && router.__mlsShowAsstV2 && router.__mlsShowAsstPrior && router.parseCommand === wrapped) router.parseCommand = router.__mlsShowAsstPrior;
      if (router) { delete router.__mlsShowAsstV2; delete router.__mlsShowAsstPrior; }
    } catch (e2) {}
    try { window.__mlsShowAsst.installed = false; } catch (e3) {}
  }

  function onPageExit() { cancelAllActive('page-exit', false); }

  window.addEventListener('message', onMessage, false);
  window.addEventListener('pagehide', onPageExit, false);
  window.addEventListener('unload', onPageExit, false);
  wrapChat();
  window.__mlsShowAsst = {
    installed: true, version: VERSION,
    contextFor: contextFor, learnedFor: learnedFor, forRow: transportFor, statusFor: statusFor,
    startForRow: start, clearForRow: clear, cancelForRow: cancel,
    open: guidance, start: start, clear: clear, learned: learnedFor,
    _handle: function (text) { var low = trim(text).toLowerCase(); return /\b(show|teach|learn)\b/.test(low) && /\b(destination|where|field|section|writeback|athena)\b/.test(low) ? guidance() : null; },
    revert: revert
  };
})();
