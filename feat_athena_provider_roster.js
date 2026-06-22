/* feat_athena_provider_roster.js  ->  window.__mlsProviderRoster  (v1.0.0)
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

  var VERSION = '1.0.0';
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
  //  Bridge to the picker (single source of truth for the cache + render)
  // ============================================================
  function picker() { return safe(function () { return root.__mlsProviderPicker || null; }, null); }

  // Fallback cache if the picker isn't present yet (same key the picker reads).
  var CACHE_KEY = 'mlsSchedProviders';
  function unsGet(name) { return safe(function () { if (!isFn(root.uns)) return ''; return S(localStorage.getItem(root.uns(name)) || ''); }, '') || ''; }
  function unsSet(name, v) { safe(function () { if (isFn(root.uns)) localStorage.setItem(root.uns(name), S(v)); }); }
  function fallbackMerge(list) {
    var have = safe(function () { var a = JSON.parse(unsGet(CACHE_KEY) || '[]'); return Array.isArray(a) ? a : []; }, []) || [];
    var seen = {}, out = [];
    have.concat(list || []).forEach(function (p) { p = clean(p); var k = p.toLowerCase(); if (p && !seen[k]) { seen[k] = 1; out.push(p); } });
    unsSet(CACHE_KEY, JSON.stringify(out.slice(0, 40)));
    return out;
  }
  function cachedCount() {
    var pk = picker();
    if (pk && isFn(pk.cachedProviders)) return safe(function () { return pk.cachedProviders().length; }, 0) || 0;
    return safe(function () { var a = JSON.parse(unsGet(CACHE_KEY) || '[]'); return Array.isArray(a) ? a.length : 0; }, 0) || 0;
  }
  function mergeProviders(list) {
    var pk = picker();
    if (pk && isFn(pk.mergeProviders)) return safe(function () { return pk.mergeProviders(list); }, null) || fallbackMerge(list);
    return fallbackMerge(list);
  }
  function renderDropdown() { var pk = picker(); if (pk && isFn(pk.renderDropdown)) safe(pk.renderDropdown); }
  function setLastResp(r) { var pk = picker(); if (pk && isFn(pk._setLastResp)) safe(function () { pk._setLastResp(r); }); }

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
      var structuredProviders = Array.isArray(r.providers) ? r.providers.filter(Boolean) : [];
      var structuredAppts = Array.isArray(r.appts) ? r.appts : [];
      var hasStructuredScope = structuredAppts.some(function (a) { return a && a.provider; });

      // recover from the flat text the extension ALWAYS returns
      var rec = recoverFromText(r.text);

      // 1+2+3+4: union of every REAL provider signal (no fabrication)
      var union = [];
      structuredProviders.forEach(function (p) { union.push(p); });
      structuredAppts.forEach(function (a) { if (a && a.provider) union.push(a.provider); });
      rec.providers.forEach(function (p) { union.push(p); });

      var diag = {
        version: VERSION,
        source: structuredProviders.length || hasStructuredScope ? 'structured(v1.37)+text' : (rec.providers.length ? 'text-recovery' : 'none'),
        structuredProviderCount: structuredProviders.length,
        structuredApptScoped: hasStructuredScope,
        textProviderCount: rec.providers.length,
        textApptCount: rec.appts.length,
        textLineCount: rec.diag.lineCount,
        providerNames: [], // filled after merge — CLINICIAN names only, PHI-free
        textDiagErr: rec.diag.err || null
      };

      var before = cachedCount();
      if (union.length) mergeProviders(union);
      var pk = picker();
      var afterList = pk && isFn(pk.cachedProviders) ? safe(function () { return pk.cachedProviders(); }, []) : safe(function () { var a = JSON.parse(unsGet(CACHE_KEY) || '[]'); return Array.isArray(a) ? a : []; }, []);
      afterList = afterList || [];
      diag.providerNames = afterList.slice(0, 20);
      diag.added = afterList.length - before;

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
      if (diag.added > 0) renderDropdown();
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
      var key = S(r.text).length + '|' + (Array.isArray(r.providers) ? r.providers.length : 0) + '|' + (Array.isArray(r.appts) ? r.appts.length : 0);
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
      var resp = (raw && (raw.text || raw.providers || raw.appts)) ? raw : (raw && raw.resp ? raw.resp : null);
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
    getDiag: function () { return lastDiag; },
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
