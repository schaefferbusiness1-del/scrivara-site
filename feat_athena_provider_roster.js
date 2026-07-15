/* feat_athena_provider_roster.js  ->  window.__mlsProviderRoster  (v2.0.0)
 *
 * "Whose patients?" dropdown — make the list REAL.
 *
 * THE PROBLEM THIS FIXES
 * ----------------------
 * Michael's athenaOne practice is multi-provider (e.g. Matthew Schaeffer,
 * Jonathon Hoynak, Matthew Schaeffer staff — visible in his Inbox "Assigned to").
 * But the "🩺 Whose patients?" dropdown (feat_athena_provider_picker.js, §68/§69)
 * only ever showed "Dr. Schaeffer (you)" + "All doctors". That is a LIE: the real
 * providers exist, they just weren't being read.
 *
 * Root cause: the picker populates its list ONLY from `resp.providers` /
 * `resp.appts[].provider`, which are emitted ONLY by the v1.37+ MLS Assist
 * extension AND only when a multi-doctor schedule grid is open. §69 confirmed the
 * INSTALLED extension is still pre-v1.37 (it returns just the flat `resp.text`),
 * so those fields were empty and the dropdown stayed stuck on "just you."
 *
 * THE FIX (no extension change required)
 * --------------------------------------
 * The MLS Assist schedule read ALWAYS returns the flat schedule innerText as
 * `resp.text` (every version, §68.0 contract `{ok,text,url,title,frames}`). That
 * flat dump contains the per-provider grouping athenaOne renders ("Benner, John MD
 * — 3 appointments", then that provider's rows; or a provider/rendering column).
 * This module recovers the DISTINCT REAL PROVIDERS from `resp.text` CLIENT-SIDE —
 * the same proven text extractor used by the deployed extractor (ext_provider_
 * extract.js, 29/29 tests) — and feeds them into the picker's existing persistent
 * roster cache (`mergeProviders`). The dropdown then renders the real names.
 *
 * It also recovers per-appointment provider tags from the same flat text and, when
 * the extension did NOT supply structured `resp.appts` (i.e. pre-v1.37), enriches
 * the picker's `lastResp` so the EXISTING §68 scoping works too — selecting a real
 * provider scopes the pull to only that provider's patients, with NO extension
 * reload. (When v1.37 structured data IS present, that wins; we only add to it.)
 *
 * SOURCE PRECEDENCE (most → least trusted), all REAL, none fabricated:
 *   1. resp.providers        (v1.37 structured distinct provider list)
 *   2. resp.appts[].provider (v1.37 structured per-appointment provider)
 *   3. recovered from resp.text via the text extractor (ALL versions) <- the fix
 *   4. window.__schedRaw.text (defensive: last raw schedule payload, if a message
 *      was missed)
 *
 * HONEST EMPTY STATE: if NO real providers can be read from any source, this module
 * does NOTHING — the dropdown shows the honest "just you + All doctors" state. It
 * NEVER injects a hardcoded or fabricated name. Real names appear only when really
 * read.
 *
 * PHI: `resp.text` contains patient names. They are read TRANSIENTLY only to find
 * the clinician grouping and are NEVER persisted, logged, or emitted. The roster
 * cache and the (optional) diag carry CLINICIAN names + structural counts only —
 * never a patient name, DOB, or appointment detail. Recovered per-appt objects
 * (which include patient names) live only in the picker's in-memory `lastResp`,
 * exactly as the v1.37 path already does — same discipline, never written out.
 *
 * SAFETY: read-only. Sends NOTHING to the MLS Assist extension; never
 * preventDefault/stops any event, never posts, never Saves/Signs/writes a chart.
 * Additive, own IIFE, try/catch throughout, idempotent, reversible via
 * window.__mlsProviderRoster.revert(). Companion to feat_athena_provider_picker.js
 * — touches only the picker's PUBLIC API; the deployed picker is unchanged.
 */
(function (root) {
  'use strict';
  try { if (root.__mlsProviderRoster && root.__mlsProviderRoster.installed) return; } catch (e) {}

  var VERSION = '2.0.1';
  var ASSET = 'feat_athena_provider_roster.js';

  // ---------- tiny safe helpers ----------
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function S(x) { return x == null ? '' : String(x); }
  function clean(s) { return S(s).replace(/\s+/g, ' ').trim(); }

  // ============================================================
  //  Provider recovery from flat schedule text
  //  (ported verbatim in spirit from the deployed ext_provider_extract.js
  //   mlsExtractScheduleFromText — the 29/29-tested recovery logic)
  // ============================================================
  var RE_TIME = /\b(\d{1,2}):(\d{2})\s*([ap]\.?\s?m\.?)?\b/i;
  var RE_TIME_G = /\b\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?\b/gi;
  var RE_CRED = /(?:^|[^A-Za-z])(MD|DO|NP|PA-?C?|APRN|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DPM|DDS|DMD|PHD|PSY\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC)(?:[^A-Za-z]|$)/;
  var CRED_I = /^(md|do|np|pa|pac|aprn|fnp|dnp|agnp|whnp|pmhnp|rn|lpn|dpm|dds|dmd|phd|psyd|mbbs|cnm|crna|od|lcsw|lpc)$/;
  var RE_APPTWORD = /\bappointment/i;
  var RE_NAMECOMMA = /([A-Z][A-Za-z'’-]+)\s*,\s*([A-Z][A-Za-z'’-]+)/;
  var STOP = /^(am|pm|new|est|established|office|visit|tele|telehealth|video|phone|follow|followup|fu|consult|consultation|annual|physical|wellness|exam|sick|nurse|lab|labs|injection|inj|procedure|recheck|np|min|mins|minute|minutes|arrived|checkedin|checked|scheduled|confirmed|cancelled|canceled|noshow|no|show|room|status|reason|provider|patient|time|type|resource|rendering|department|dept|appt|appts|total|appointments)$/i;

  function hasTime(s) { return RE_TIME.test(S(s)); }
  function firstTime(s) { var m = S(s).match(RE_TIME_G); return m ? clean(m[0]) : ''; }

  function cleanProvider(s) {
    var t = clean(s);
    t = t.replace(/[•‣▪●>*\-–—]+\s*$/g, '');
    t = t.replace(/[-–—:|(]*\s*\d+\s*appointments?\b.*$/i, '');
    t = t.replace(/\b\d+\s*appointments?\b/i, '');
    t = t.replace(/\(\s*\d+\s*\)\s*$/, '');
    t = t.replace(/[\s,;:|–—-]+$/, '');
    return clean(t);
  }
  function looksLikeProviderHeader(line) {
    var t = clean(line);
    if (!t || t.length > 80) return false;
    if (hasTime(t)) return false;
    var hasCred = RE_CRED.test(t);
    var hasApptWord = RE_APPTWORD.test(t);
    var hasName = RE_NAMECOMMA.test(t) || /[A-Z][a-z]+[ _][A-Z][a-z]+/.test(t);
    if ((hasCred && hasName) || (hasApptWord && hasName)) return true;
    if (hasCred && RE_NAMECOMMA.test(t) && t.split(/\s+/).length <= 5) return true;
    return false;
  }
  function patientNameFromRow(line) {
    var t = clean(line);
    var mc = t.match(RE_NAMECOMMA);
    if (mc) return clean(mc[0]);
    var afterTime = t.replace(RE_TIME_G, ' ');
    var words = afterTime.split(/\s+/).filter(function (w) { return /[A-Za-z]/.test(w); });
    var picked = [];
    for (var i = 0; i < words.length && picked.length < 3; i++) {
      var w = words[i].replace(/[^A-Za-z'’-]/g, '');
      if (!w) continue;
      if (STOP.test(w) || CRED_I.test(w.toLowerCase())) { if (picked.length) break; else continue; }
      if (/^[A-Z]/.test(w)) picked.push(w); else if (picked.length) break;
    }
    return picked.join(' ');
  }

  // Returns { providers: [display strings], appts: [{time,name,provider}], diag:{} }.
  // PHI note: appts[].name is a patient name and is used ONLY in-memory to enable
  // scoping; it is NEVER persisted/logged by this module. diag is provider-only.
  function recoverFromText(text) {
    var out = { providers: [], appts: [], diag: { strategy: 'text', lineCount: 0, headerCount: 0, apptCount: 0, providerCount: 0, providerNames: [] } };
    try {
      var raw = S(text);
      if (!raw.trim()) return out;
      var lines = raw.split(/\r?\n/).map(clean).filter(function (l) { return l.length; });
      out.diag.lineCount = lines.length;
      var current = '';
      var provSet = {}, provOrder = [];
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        if (looksLikeProviderHeader(ln)) {
          var p = cleanProvider(ln);
          if (p) {
            current = p;
            if (!provSet[p.toLowerCase()]) { provSet[p.toLowerCase()] = 1; provOrder.push(p); }
            out.diag.headerCount++;
          }
          continue;
        }
        if (hasTime(ln)) {
          // best-effort: a credentialed "Last, First MD" inside the appointment row
          // itself (provider/rendering COLUMN collapsed into the flat line)
          var inRow = '';
          if (RE_CRED.test(ln)) {
            var mNme = ln.match(/([A-Z][A-Za-z'’-]+\s*,\s*[A-Z][A-Za-z'’-]+\s*(?:MD|DO|NP|PA-?C?|APRN|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DPM|DDS|DMD|PHD|MBBS|CNM|CRNA|OD|LCSW|LPC)\b)/);
            if (mNme) {
              inRow = cleanProvider(mNme[1]);
              if (inRow && !provSet[inRow.toLowerCase()]) { provSet[inRow.toLowerCase()] = 1; provOrder.push(inRow); }
            }
          }
          var nm = patientNameFromRow(ln);
          if (nm) out.appts.push({ time: firstTime(ln), name: nm, provider: inRow || current || '' });
        }
      }
      var withAppts = {};
      out.appts.forEach(function (a) { if (a.provider) withAppts[a.provider.toLowerCase()] = a.provider; });
      var provs = Object.keys(withAppts).length ? provOrder.filter(function (p) { return withAppts[p.toLowerCase()]; }) : provOrder;
      out.providers = provs;
      out.diag.apptCount = out.appts.length;
      out.diag.providerCount = provs.length;
      out.diag.providerNames = provs.slice(0, 20); // CLINICIAN names only — PHI-free
    } catch (e) { out.diag.err = S(e && e.message || e).slice(0, 120); }
    return out;
  }

  // ============================================================
  //  Canonical structured roster + legacy picker bridge
  // ============================================================
  function picker() { return safe(function () { return root.__mlsProviderPicker || null; }, null); }

  var CACHE_KEY = 'mlsSchedProviders';       // legacy display-only cache
  var CACHE_V2_KEY = 'mlsProviderRosterV2';  // stable-identity structured cache
  var RECEIPT_KEY = 'mlsProviderRosterReceiptV2';
  function unsGet(name) { return safe(function () { if (!isFn(root.uns)) return ''; return S(localStorage.getItem(root.uns(name)) || ''); }, '') || ''; }
  function unsSet(name, v) { safe(function () { if (isFn(root.uns)) localStorage.setItem(root.uns(name), S(v)); }); }
  function normKey(v) { return clean(v).toLowerCase(); }
  function humanName(raw) {
    var v = clean(raw);
    var shared = safe(function () { return isFn(root.__mlsProviderLabel) ? root.__mlsProviderLabel(v) : ''; }, '');
    if (shared) return clean(shared);
    if (/^[A-Za-z][A-Za-z'\-]*_[A-Za-z]/.test(v)) {
      var p = v.split('_').filter(Boolean), last = p.shift() || '', first = p.shift() || '', cred = p.join(' ');
      return clean(first + ' ' + last + (cred ? ', ' + cred : ''));
    }
    return v;
  }
  function makeEntry(input, source) {
    if (input == null) return null;
    var obj = typeof input === 'object' ? input : {}, raw = clean(typeof input === 'string' ? input : (obj.raw || obj.provider_raw || obj.provider_key || obj.provider || ''));
    var id = clean(obj.id || obj.providerId || obj.provider_id || obj.doctor_user_id || obj.user_id || '');
    var name = humanName(obj.name || obj.displayName || obj.label || raw);
    var stableKey = clean(obj.stableKey || obj.stable_key || '');
    if (!stableKey && id) stableKey = 'backend:' + id;
    if (!stableKey && raw) stableKey = 'athena:' + normKey(raw);
    if (!stableKey && name) stableKey = 'legacy-name:' + normKey(name);
    if (!stableKey || !name) return null;
    return {
      stableKey: stableKey,
      id: id,
      raw: raw || clean(obj.name || name),
      name: name,
      source: clean(obj.source || source || 'legacy-unverified'),
      rosterVerified: obj.rosterVerified === true || (!!id && (source === 'backend-calendar' || obj.source === 'backend-calendar'))
    };
  }
  function storedEntries() {
    var saved = safe(function () { return JSON.parse(unsGet(CACHE_V2_KEY) || '[]'); }, []);
    var arr = Array.isArray(saved) ? saved : [];
    if (!arr.length) {
      var legacy = safe(function () { return JSON.parse(unsGet(CACHE_KEY) || '[]'); }, []);
      if (Array.isArray(legacy)) arr = legacy.map(function (x) { return makeEntry(x, 'legacy-cache'); }).filter(Boolean);
    }
    return arr.map(function (x) { return makeEntry(x, x && x.source); }).filter(Boolean);
  }
  function mergeEntries(list, source) {
    var have = storedEntries(), byKey = {}, order = [];
    have.concat(list || []).forEach(function (raw) {
      var e = makeEntry(raw, source); if (!e) return;
      var k = e.stableKey;
      if (!byKey[k]) { byKey[k] = e; order.push(k); return; }
      var prior = byKey[k];
      if (!prior.id && e.id) prior.id = e.id;
      if ((!prior.raw || /^legacy-name:/.test(prior.stableKey)) && e.raw) prior.raw = e.raw;
      if (e.name) prior.name = e.name;
      if (e.source && (!prior.source || /legacy/.test(prior.source))) prior.source = e.source;
      prior.rosterVerified = prior.rosterVerified || e.rosterVerified;
    });
    var out = order.map(function (k) { return byKey[k]; }).slice(-240);
    unsSet(CACHE_V2_KEY, JSON.stringify(out));
    /* Keep the old picker usable, but never use its name-only cache as the
       canonical roster. Same-name clinicians remain distinct in V2. */
    var legacyNames = [], legacySeen = {};
    out.forEach(function (e) { var k = normKey(e.name); if (k && !legacySeen[k]) { legacySeen[k] = 1; legacyNames.push(e.name); } });
    unsSet(CACHE_KEY, JSON.stringify(legacyNames.slice(-200)));
    var pk = picker();
    if (pk && isFn(pk.mergeProviders)) safe(function () { pk.mergeProviders(legacyNames); });
    mergeIntoCalendar(out);
    return out;
  }
  function mergeIntoCalendar(entries) {
    safe(function () {
      var arr = Array.isArray(root._calProviders) ? root._calProviders : [], seen = {}, out = [];
      arr.concat(entries || []).forEach(function (raw) {
        var e = makeEntry(raw, raw && raw.source || 'calendar'); if (!e || seen[e.stableKey]) return;
        seen[e.stableKey] = 1;
        /* Preserve backend-specific fields while supplying canonical identity. */
        if (raw && typeof raw === 'object') {
          Object.keys(raw).forEach(function (k) { if (e[k] == null || e[k] === '') e[k] = raw[k]; });
        }
        out.push(e);
      });
      root._calProviders = out;
    });
  }
  function syncCalendarProviders() {
    var cal = safe(function () { return Array.isArray(root._calProviders) ? root._calProviders.slice() : []; }, []);
    if (cal.length) return mergeEntries(cal, 'backend-calendar');
    mergeIntoCalendar(storedEntries());
    return storedEntries();
  }
  function cachedCount() { return storedEntries().length; }
  function mergeProviders(list) { return mergeEntries(list, 'legacy-structured'); }
  function renderDropdown() { var pk = picker(); if (pk && isFn(pk.renderDropdown)) safe(pk.renderDropdown); }
  function setLastResp(r) { var pk = picker(); if (pk && isFn(pk._setLastResp)) safe(function () { pk._setLastResp(r); }); }
  function notifyRosterUpdated(entries, receipt) {
    var detail = { entries: (entries || []).slice(), receipt: receipt || null, version: VERSION };
    safe(function () {
      var ev = null;
      if (typeof root.CustomEvent === 'function') ev = new root.CustomEvent('mls-provider-roster-updated', { detail: detail });
      else if (root.document && isFn(root.document.createEvent)) { ev = root.document.createEvent('CustomEvent'); ev.initCustomEvent('mls-provider-roster-updated', false, false, detail); }
      else ev = { type: 'mls-provider-roster-updated', detail: detail };
      if (isFn(root.dispatchEvent)) root.dispatchEvent(ev);
    });
    /* Immediate same-turn refresh for pages where a synthetic test/event shim
       does not implement dispatchEvent. This is UI-only and never starts a
       pull. */
    safe(function () { if (root.__mlsCalPolish && isFn(root.__mlsCalPolish.enhance)) root.__mlsCalPolish.enhance(); });
  }

  var lastReceipt = safe(function () { var r = JSON.parse(unsGet(RECEIPT_KEY) || 'null'); return r && typeof r === 'object' ? r : null; }, null);
  function normalizeReceipt(receipt, observed, reason) {
    var r = receipt && typeof receipt === 'object' ? receipt : {};
    var complete = r.complete === true && r.partial !== true;
    return {
      complete: complete,
      partial: !complete,
      reason: clean(r.reason || reason || (complete ? 'complete' : 'legacy-unverified')),
      expectedCount: r.expectedCount == null ? null : Number(r.expectedCount),
      observedCount: r.observedCount == null ? Number(observed || 0) : Number(r.observedCount),
      reachedEnd: r.reachedEnd === true,
      capReached: r.capReached === true,
      budgetExpired: r.budgetExpired === true,
      restored: r.restored == null ? null : r.restored === true,
      steps: Number(r.steps || 0),
      updatedAt: Date.now()
    };
  }
  function setReceipt(receipt, observed, reason) {
    lastReceipt = normalizeReceipt(receipt, observed, reason);
    unsSet(RECEIPT_KEY, JSON.stringify(lastReceipt));
    return lastReceipt;
  }
  function listEntries() { syncCalendarProviders(); return storedEntries().map(function (e) { var c = {}; Object.keys(e).forEach(function (k) { c[k] = e[k]; }); return c; }); }
  function resolveProvider(ref) {
    var entries = listEntries(), raw = ref;
    if (ref && typeof ref === 'object') raw = ref.stableKey || ref.id || ref.raw || ref.name || '';
    raw = clean(raw);
    if (raw.indexOf('pv:') === 0) { try { raw = decodeURIComponent(raw.slice(3)); } catch (e) { return null; } }
    if (!raw) return null;
    var exact = entries.filter(function (e) { return e.stableKey === raw; });
    if (exact.length === 1) return exact[0];
    exact = entries.filter(function (e) { return e.id && e.id === raw; });
    if (exact.length === 1) return exact[0];
    exact = entries.filter(function (e) { return normKey(e.raw) === normKey(raw); });
    if (exact.length === 1) return exact[0];
    exact = entries.filter(function (e) { return normKey(e.name) === normKey(raw); });
    return exact.length === 1 ? exact[0] : null; // same-name ambiguity fails closed
  }

  // diag for the live tuning run (PHI-FREE — provider names + counts only)
  var lastDiag = null;
  function publishDiag(d) {
    lastDiag = d;
    safe(function () { root.__mlsProviderRosterDiag = d; });
  }

  // ============================================================
  //  Process one schedule-read result (READ-ONLY)
  // ============================================================
  var _lastTextKey = '';
  function ingestResp(resp) {
    return safe(function () {
      var r = resp || {};
      var structuredRoster = Array.isArray(r.providerRoster) ? r.providerRoster : [];
      var structuredProviders = Array.isArray(r.providers) ? r.providers.filter(Boolean) : [];
      var structuredAppts = Array.isArray(r.appts) ? r.appts : [];
      var hasStructuredScope = structuredAppts.some(function (a) { return a && a.provider; });

      // recover from the flat text the extension ALWAYS returns
      var rec = recoverFromText(r.text);

      // 1+2+3+4: union of every REAL provider signal (no fabrication)
      var union = [];
      structuredRoster.forEach(function (p) {
        var c = {}; Object.keys(p || {}).forEach(function (k) { c[k] = p[k]; });
        c.source = c.source || 'athena-schedule-header';
        c.rosterVerified = !!(r.providerRosterReceipt && r.providerRosterReceipt.complete);
        union.push(c);
      });
      structuredProviders.forEach(function (p) { union.push(makeEntry(p, 'legacy-extension-provider')); });
      structuredAppts.forEach(function (a) { if (a && a.provider) union.push(makeEntry(a.provider, 'appointment-attribution')); });
      rec.providers.forEach(function (p) { union.push(makeEntry(p, 'text-recovery')); });

      var diag = {
        version: VERSION,
        source: structuredRoster.length ? 'structured-roster' : (structuredProviders.length || hasStructuredScope ? 'legacy-structured+text' : (rec.providers.length ? 'text-recovery' : 'none')),
        structuredRosterCount: structuredRoster.length,
        structuredProviderCount: structuredProviders.length,
        structuredApptScoped: hasStructuredScope,
        textProviderCount: rec.providers.length,
        textApptCount: rec.appts.length,
        textLineCount: rec.diag.lineCount,
        providerNames: [], // filled after merge — CLINICIAN names only, PHI-free
        textDiagErr: rec.diag.err || null
      };

      var before = cachedCount();
      var afterList = union.length ? mergeEntries(union, 'schedule-result') : listEntries();
      var receiptReason = r.error ? 'schedule-read-error' : (structuredRoster.length ? 'structured-roster-unverified' : (afterList.length ? 'legacy-unverified' : 'no-provider-headers'));
      var receipt = setReceipt(r.providerRosterReceipt, structuredRoster.length || afterList.length, receiptReason);
      diag.providerNames = afterList.map(function (e) { return e.name; }).slice(0, 50);
      diag.added = afterList.length - before;
      diag.receipt = receipt;

      // Enable §68 scoping WITHOUT v1.37: if the extension supplied no structured
      // per-appt provider but we recovered one from the flat text, hand the picker
      // an enriched lastResp so applyScope can attach + filter by provider.
      if (!hasStructuredScope && rec.appts.length && rec.providers.length) {
        setLastResp({ appts: rec.appts, providers: rec.providers });
        diag.scopeEnabledFromText = true;
      } else {
        diag.scopeEnabledFromText = false;
      }

      publishDiag(diag);

      // Re-render only if we actually added real names (avoid needless churn /
      // fighting the picker's glitch-fix signature guard).
      if (diag.added > 0 || structuredRoster.length || r.providerRosterReceipt) renderDropdown();
      notifyRosterUpdated(afterList, receipt);
      return diag;
    }, null);
  }

  // ---------- read-only message listener ----------
  function onMessage(e) {
    safe(function () {
      var d = e && e.data;
      if (!d || d.source !== 'mls-ext' || d.type !== 'mlsAppScheduleResult') return;
      var r = d.resp || {};
      // de-dupe identical back-to-back deliveries
      var key = S(r.text).length + '|' + (Array.isArray(r.providers) ? r.providers.length : 0) + '|' + (Array.isArray(r.providerRoster) ? r.providerRoster.length : 0) + '|' + (Array.isArray(r.appts) ? r.appts.length : 0) + '|' + S(r.providerRosterReceipt && r.providerRosterReceipt.reason);
      if (key === _lastTextKey) { ingestResp(r); return; }
      _lastTextKey = key;
      ingestResp(r);   // r is never mutated or forwarded
    });
  }

  // ---------- defensive sweep of the last raw schedule payload, if present ----------
  function sweepSchedRaw() {
    safe(function () {
      var raw = root.__schedRaw;
      if (!raw) return;
      // __schedRaw may be the resp object or carry {text}
      var resp = (raw && (raw.text || raw.providers || raw.providerRoster || raw.appts)) ? raw : (raw && raw.resp ? raw.resp : null);
      if (resp) ingestResp(resp);
    });
  }

  // ---------- listener (attached SYNCHRONOUSLY so a pull can never beat it) ----------
  var _listening = false;
  function attachListener() {
    if (_listening) return;
    safe(function () { root.addEventListener('message', onMessage, true); _listening = true; });
  }

  // ---------- boot (DOM-/timer-dependent work only) ----------
  var _bootSweepT = null;
  function boot() {
    attachListener();
    // one-time light sweep in case a pull already happened before this loaded
    sweepSchedRaw();
    var n = 0;
    _bootSweepT = setInterval(function () { n++; sweepSchedRaw(); if (n > 6) { clearInterval(_bootSweepT); _bootSweepT = null; } }, 1500);
  }

  // ---------- revert ----------
  function revert() {
    safe(function () { root.removeEventListener('message', onMessage, true); _listening = false; });
    safe(function () { if (_bootSweepT) { clearInterval(_bootSweepT); _bootSweepT = null; } });
    safe(function () { delete root.__mlsProviderRosterDiag; });
    safe(function () { root.__mlsProviderRoster.installed = false; });
    // Note: this does NOT erase real providers already merged into the cache —
    // they were really read. To clear them, the user/picker manages the cache.
  }

  root.__mlsProviderRoster = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    recoverFromText: recoverFromText,
    ingestResp: ingestResp,
    sweepSchedRaw: sweepSchedRaw,
    list: listEntries,
    providers: function () { return listEntries().map(function (e) { return e.name; }); },
    merge: mergeEntries,
    resolve: resolveProvider,
    getReceipt: function () { return lastReceipt || normalizeReceipt(null, listEntries().length, 'not-yet-verified'); },
    getDiag: function () { return lastDiag; },
    notify: function () { notifyRosterUpdated(listEntries(), lastReceipt); },
    _makeEntry: makeEntry,
    _looksLikeProviderHeader: looksLikeProviderHeader,
    _cleanProvider: cleanProvider,
    _patientNameFromRow: patientNameFromRow,
    revert: revert
  };

  // Attach the read-only listener immediately (independent of DOM readiness) so a
  // schedule result can never arrive before we are listening.
  attachListener();

  try {
    if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } catch (e) { safe(boot); }
})(typeof window !== 'undefined' ? window : this);
