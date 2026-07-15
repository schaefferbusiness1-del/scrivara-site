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

  var VERSION = '2.2.0';
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
    /* Use only the label module's mechanical humanizer here. Calling its full
       resolver would recurse once that resolver delegates provider validation
       back to this canonical roster. */
    var shared = safe(function () {
      return root.__mlsProviderLabel && isFn(root.__mlsProviderLabel.humanize)
        ? root.__mlsProviderLabel.humanize(v) : '';
    }, '');
    if (shared) return clean(shared);
    if (/^[A-Za-z][A-Za-z'\-]*_[A-Za-z]/.test(v)) {
      var p = v.split('_').filter(Boolean), last = p.shift() || '', first = p.shift() || '', cred = p.join(' ');
      return clean(first + ' ' + last + (cred ? ', ' + cred : ''));
    }
    return v;
  }

  /* Provider values arrive through several legacy lanes. Some of those lanes
     used to pass arbitrary schedule cells (dates, visit reasons, addresses,
     insurance text and labels such as "Performed by ...") into the roster.
     Every provider UI consumes this module, so validate once at this boundary
     instead of teaching each dropdown a different blacklist. */
  var PROVIDER_CRED = /^(?:MD|DO|DPM|PA-?C?|NP-?C?|APRN|CRNP|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DDS|DMD|PHD|PSY\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC|DC|DPT|PT|OT|OTR|PHARMD|RPH)$/i;
  var PROVIDER_CRED_AT_END = /(?:,\s*|\s+)(MD|M\.?D\.?|DO|D\.?O\.?|DPM|PA-?C?|P\.?A\.?-?C\.?|NP-?C?|N\.?P\.?-?C\.?|APRN|CRNP|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DDS|DMD|PHD|PH\.?D\.?|PSY\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC|DC|DPT|PT|OT|OTR|PHARMD|RPH)\s*$/i;
  var PROVIDER_PREFIX = /^(?:(?:rendering|performing|ordering|referring|supervising|scheduled|assigned)\s+provider|provider|doctor|physician|clinician|performed\s+by|seen\s+by|rendered\s+by|ordered\s+by|referred\s+by|scheduled\s+with|assigned\s+to)\b\s*(?::|[-–—])?\s*/i;
  var PROVIDER_NOISE = /\b(?:appointment|appt|encounter|patient|reason|chief\s+complaint|insurance|insurer|policy|member\s*id|subscriber|copay|authorization|authorisation|facility|location|department|resource|room|address|phone|fax|email|status|scheduled|confirmed|cancelled|canceled|no\s*show|checked\s*in|arrived|office\s+visit|follow\s*-?\s*up|new\s+patient|procedure|injection|imaging|mri|x-?ray|referral|therapy|therapist|diagnosis|allerg(?:y|ies)|medication|pharmacy|billing|claim|aetna|cigna|medicare|medicaid|anthem|united\s*health|uhc|blue\s+cross|blue\s+shield|independence\s+blue|posm|clinic|hospital|health\s*system|medical\s+center|street|avenue|road|boulevard|suite|square|clearwater|low\s+back\s+pain|back\s+pain|neck\s+pain|radiculopathy|sciatica|stenosis|spondylosis|cervicalgia|lumbar|thoracic|west\s+chester|king\s+of\s+prussia)\b/i;
  var PROVIDER_DATE_WORD = /\b(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
  var PROVIDER_DATE_WORD_G = /\b(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/ig;

  function normalizeCredential(raw) {
    var c = clean(raw).replace(/[.\s]/g, '').toUpperCase();
    if (c === 'PAC' || c === 'PA-C') return 'PA-C';
    if (c === 'NPC' || c === 'NP-C') return 'NP-C';
    if (c === 'PSYD') return 'PsyD';
    if (c === 'PHD') return 'PhD';
    if (c === 'PHARMD') return 'PharmD';
    return c;
  }
  function machineProviderIdentity(raw) {
    return /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*_[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’. -]*(?:_[A-Za-z-]+)?$/.test(clean(raw));
  }
  function providerIdentityParts(canonical) {
    var v = clean(canonical), staff = /\s+(?:staff|team)$/i.test(v) ? 'staff' : '';
    v = v.replace(/^Dr\.?\s+/i, '').replace(/\s+(?:staff|team)$/i, '');
    var cm = v.match(PROVIDER_CRED_AT_END), cred = cm ? normalizeCredential(cm[1]).toLowerCase() : '';
    if (cm) v = v.slice(0, cm.index);
    try { if (v.normalize) v = v.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return { base: v.toLowerCase().replace(/[^a-z]/g, ''), credential: cred, staff: staff };
  }
  function reorderLastFirst(last, given) {
    var suffix = '', sm = clean(given).match(/^(.*?)\s+(Jr\.?|Sr\.?|II|III|IV)$/i);
    if (sm) { given = clean(sm[1]); suffix = clean(sm[2]).replace(/^(Jr|Sr)$/i, '$1.'); }
    return clean(given + ' ' + last + (suffix ? (' ' + suffix) : ''));
  }
  function normalizeLastFirst(v) {
    var parts = String(v || '').split(',').map(clean).filter(Boolean);
    if (parts.length === 2 && !PROVIDER_CRED.test(parts[1]) && /^[A-Za-zÀ-ÖØ-öø-ÿ'’.-]+$/.test(parts[0])) {
      var secondCred = parts[1].match(/^(.*?)(?:\s+)(MD|M\.?D\.?|DO|D\.?O\.?|DPM|PA-?C?|P\.?A\.?-?C\.?|NP-?C?|N\.?P\.?-?C\.?|APRN|CRNP|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DDS|DMD|PHD|PH\.?D\.?|PSY\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC|DC|DPT|PT|OT|OTR|PHARMD|RPH)$/i);
      if (secondCred && clean(secondCred[1])) return clean(reorderLastFirst(parts[0], secondCred[1]) + ', ' + normalizeCredential(secondCred[2]));
      return reorderLastFirst(parts[0], parts[1]);
    }
    if (parts.length === 3 && PROVIDER_CRED.test(parts[2]) && /^[A-Za-zÀ-ÖØ-öø-ÿ'’.-]+$/.test(parts[0])) {
      return clean(reorderLastFirst(parts[0], parts[1]) + ', ' + normalizeCredential(parts[2]));
    }
    return v;
  }
  function canonicalProviderName(raw, allowPlainPA, allowUncredentialed) {
    var v = clean(raw).replace(/\u00a0/g, ' ');
    if (!v) return '';
    /* A clear label prefix is removed; an embedded label/noise word still
       rejects the value. Thus "Performed by: Jane Doe, MD" can contribute the
       clinician Jane Doe, MD, but the polluted label itself never renders. */
    var explicitPrefix = PROVIDER_PREFIX.test(v), machineIdentity = machineProviderIdentity(v);
    for (var p = 0; p < 2 && PROVIDER_PREFIX.test(v); p++) v = clean(v.replace(PROVIDER_PREFIX, ''));
    /* Legacy collapsed schedule rows sometimes prefix a valid clinician with a
       date/time. Remove only a leading, syntactically complete date/time token;
       dates elsewhere continue to reject the value. */
    v = v.replace(/^(?:(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\s+)?(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}[\/-]\d{1,2}[\/-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})(?:\s+\d{1,2}:\d{2}\s*(?:am|pm)?)?\s*(?:[-–—|:]\s*)?/i, '');
    v = v.replace(/^\d{1,2}:\d{2}\s*(?:am|pm)\s*(?:[-–—|:]\s*)?/i, '');
    v = v.replace(/\s+(?:[-–—|]\s*)?(?:athena|provider)(?::|=)[A-Za-z0-9_.:-]+\s*$/i, '');
    v = v.replace(/\s*(?:\||[-–—])\s*\d+\s+appointments?\b.*$/i, '');
    v = v.replace(/\s*\(\s*\d+\s+appointments?\s*\)\s*$/i, '');
    v = v.replace(/\s+Close\s*$/i, '');
    v = humanName(v);
    v = normalizeLastFirst(v);
    if (!v || v.length < 3 || v.length > 72) return '';
    if (/\d|[@/\\|]|https?:|www\./i.test(v)) return '';
    var dateWords = v.match(PROVIDER_DATE_WORD_G) || [];
    if (/\b(?:am|pm)\b/i.test(v) || dateWords.length > 1 || /^(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i.test(v) || PROVIDER_NOISE.test(v)) return '';
    if (/^(?:all\s+(?:doctors?|providers?)|no\s+provider|unassigned|unknown|none|n\/?a|provider(?:\s+undefined|\s+null|\s+#?\d+)?)$/i.test(v)) return '';
    if (/\[[^\]]+\]|\{[^}]+\}|\([^)]{3,}\)/.test(v)) return '';

    var cred = '', cm = v.match(PROVIDER_CRED_AT_END);
    if (cm) {
      cred = normalizeCredential(cm[1]);
      /* A trailing state abbreviation is indistinguishable from plain PA in
         arbitrary text ("Newtown Square, PA"). Admit plain PA only when the
         field came from a provider-typed source/id, or carried an explicit
         Provider/Doctor/Physician label. PA-C is unambiguous. */
      if (cred === 'PA' && allowPlainPA !== true && !explicitPrefix) return '';
      var namePart = clean(v.slice(0, cm.index).replace(/[,]\s*$/, ''));
      namePart = namePart.replace(/,\s*(Jr\.?|Sr\.?|II|III|IV)$/i, function (_, suffix) { return ' ' + clean(suffix).replace(/^(Jr|Sr)$/i, '$1.'); });
      v = namePart + ', ' + cred;
    }
    if (!cred && dateWords.length && allowUncredentialed !== true) return '';
    if (!cred && !explicitPrefix && !machineIdentity && allowUncredentialed !== true) return '';
    var body = v.replace(/^Dr\.?\s+/i, '').replace(/,\s*[^,]+$/, '').replace(/\s+(?:staff|team)$/i, '');
    body = body.replace(/,\s*(Jr\.?|Sr\.?|II|III|IV)$/i, ' $1');
    var words = body.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 6) return '';
    for (var i = 0; i < words.length; i++) {
      if (!/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*$/.test(words[i])) return '';
    }
    /* Multiple long acronyms without a credential are schedule/resource text,
       not a person's name (for example "POSM CL Kennett Square"). */
    var acronymCount = words.filter(function (w) { return /^[A-Z]{2,}$/.test(w.replace(/[.]/g, '')); }).length;
    if (!cred && acronymCount > 1) return '';
    return clean(v);
  }
  function providerEquivalentKey(raw, allowPlainPA, allowUncredentialed) {
    var v = canonicalProviderName(raw, allowPlainPA, allowUncredentialed); if (!v) return '';
    var parts = providerIdentityParts(v);
    return parts.base ? (parts.base + '|' + parts.credential + (parts.staff ? ('|' + parts.staff) : '')) : '';
  }
  function makeEntry(input, source) {
    if (input == null) return null;
    var obj = typeof input === 'object' ? input : {}, raw = clean(typeof input === 'string' ? input : (obj.raw || obj.provider_raw || obj.provider_key || obj.provider || ''));
    var id = clean(obj.id || obj.providerId || obj.provider_id || obj.doctor_user_id || obj.user_id || '');
    var sourceName = clean(source || obj.source || 'legacy-unverified');
    var suppliedStableKey = clean(obj.stableKey || obj.stable_key || '');
    var nameInput = clean(obj.name || obj.displayName || obj.label || '');
    var typedProviderSource = /provider|roster|appointment-attribution|text-recovery|backend-calendar|schedule-header/i.test(sourceName);
    var machineEvidence = machineProviderIdentity(raw) || machineProviderIdentity(nameInput);
    var prefixEvidence = PROVIDER_PREFIX.test(raw) || PROVIDER_PREFIX.test(nameInput);
    var weakMigration = obj.providerEligible === false || /^legacy-name:/.test(suppliedStableKey) || /^(?:legacy-cache|legacy-structured|legacy-unverified|backend-calendar|calendar)$/i.test(sourceName);
    var allowPlainPA = !!id || typedProviderSource || machineEvidence || prefixEvidence;
    var allowUncredentialed = !!id || machineEvidence || prefixEvidence || weakMigration;
    var named = canonicalProviderName(nameInput, allowPlainPA, allowUncredentialed);
    var fromRaw = canonicalProviderName(raw, allowPlainPA, allowUncredentialed);
    if (named && fromRaw) {
      var namedIdentity = providerIdentityParts(named), rawIdentity = providerIdentityParts(fromRaw);
      /* One input object may never synthesize a hybrid clinician from a name
         belonging to one person and a raw identity belonging to another. */
      if (!namedIdentity.base || !rawIdentity.base || namedIdentity.base !== rawIdentity.base || namedIdentity.staff !== rawIdentity.staff || (namedIdentity.credential && rawIdentity.credential && namedIdentity.credential !== rawIdentity.credential)) return null;
    }
    var name = named || fromRaw;
    /* Prefer a credential-bearing raw Athena identity when the display label is
       the same person but omitted the credential. */
    if (named && fromRaw) {
      var namedBase = providerEquivalentKey(named, allowPlainPA, true).split('|')[0], rawBase = providerEquivalentKey(fromRaw, allowPlainPA, true).split('|')[0];
      if (namedBase && namedBase === rawBase && !PROVIDER_CRED_AT_END.test(named) && PROVIDER_CRED_AT_END.test(fromRaw)) name = fromRaw;
    }
    var chosenIdentity = providerIdentityParts(name), providerEligible = !!(id || chosenIdentity.credential || machineEvidence || prefixEvidence);
    if (!providerEligible && !weakMigration) return null;
    var stableKey = suppliedStableKey;
    if (!stableKey && id) stableKey = 'backend:' + id;
    /* Unstructured strings are display evidence, not stable Athena identities.
       Key them by canonical equivalence so spelling/punctuation echoes collapse.
       A real structured Athena stableKey is preserved above. */
    if (!stableKey && name) stableKey = 'legacy-name:' + providerEquivalentKey(name, allowPlainPA, true);
    if (!stableKey || !name) return null;
    return {
      stableKey: stableKey,
      id: id,
      raw: fromRaw || raw || clean(obj.name || name),
      name: name,
      source: sourceName,
      rosterVerified: obj.rosterVerified === true || (!!id && (source === 'backend-calendar' || obj.source === 'backend-calendar')),
      equivalentKey: providerEquivalentKey(name, allowPlainPA, true),
      providerEligible: providerEligible,
      aliases: Array.isArray(obj.aliases) ? obj.aliases.map(clean).filter(Boolean) : []
    };
  }
  function providerEntriesCompatible(a, b) {
    var ap = providerIdentityParts(a && a.name), bp = providerIdentityParts(b && b.name);
    if (!ap.base || !bp.base || ap.base !== bp.base || ap.staff !== bp.staff) return false;
    if (ap.credential && bp.credential && ap.credential !== bp.credential) return false;
    return true;
  }
  function providerEntryStrength(e) {
    var p = providerIdentityParts(e && e.name);
    return (e && e.providerEligible ? 100 : 0) + (e && e.id ? 20 : 0) + (p.credential ? 10 : 0) + (e && e.rosterVerified ? 1 : 0);
  }
  function hasProviderSignal(input) {
    if (typeof input === 'string') return !!clean(input);
    if (!input || typeof input !== 'object') return false;
    return !!clean(input.name || input.displayName || input.label || input.raw || input.provider_raw || input.provider_key || input.provider || input.stableKey || input.stable_key || input.id || input.providerId || input.provider_id || input.doctor_user_id || input.user_id || '');
  }
  var _cacheSanitized = false;
  function storedEntries() {
    var saved = safe(function () { return JSON.parse(unsGet(CACHE_V2_KEY) || '[]'); }, []);
    var arr = Array.isArray(saved) ? saved : [];
    if (!arr.length) {
      var legacy = safe(function () { return JSON.parse(unsGet(CACHE_KEY) || '[]'); }, []);
      if (Array.isArray(legacy)) {
        var legacyClean = legacy.map(function (x) { return makeEntry(x, 'legacy-cache'); }).filter(Boolean);
        if (legacyClean.length !== legacy.filter(hasProviderSignal).length) _cacheSanitized = true;
        arr = legacyClean;
      }
    }
    var cleaned = arr.map(function (x) { return makeEntry(x, x && x.source); }).filter(Boolean);
    if (cleaned.length !== arr.filter(hasProviderSignal).length || cleaned.some(function (e) { return e.providerEligible === false; })) _cacheSanitized = true;
    return cleaned;
  }
  var _lastMergeIdentityConflict = false;
  function mergeEntries(list, source) {
    var have = storedEntries(), byKey = {}, order = [], conflicted = {};
    _lastMergeIdentityConflict = false;
    var incoming = Array.isArray(list) ? list : [];
    have.concat(incoming).forEach(function (raw, index) {
      var entrySource = index < have.length ? (raw && raw.source) : source;
      var e = makeEntry(raw, entrySource);
      if (!e) {
        /* A semantic row discarded from a live/calendar merge invalidates any
           previously complete receipt. Benign null placeholders do not. A
           wrapper that canonicalizes to a real provider is retained and is
           therefore not treated as contamination. */
        if (index >= have.length && hasProviderSignal(raw)) _cacheSanitized = true;
        return;
      }
      var k = e.stableKey;
      if (e.providerEligible === false && index >= have.length) _cacheSanitized = true;
      if (conflicted[k]) return;
      if (!byKey[k]) { byKey[k] = e; order.push(k); return; }
      var prior = byKey[k];
      if (!providerEntriesCompatible(prior, e)) {
        /* Same stable identity/ID claiming two clinicians is quarantined in
           full. Never keep either side and never assemble a name/raw hybrid. */
        delete byKey[k]; conflicted[k] = 1; _cacheSanitized = true; _lastMergeIdentityConflict = true; return;
      }
      var aliasSeen = {};
      (prior.aliases || []).concat(e.aliases || []).forEach(function (a) { if (a) aliasSeen[a] = 1; });
      var chosen = providerEntryStrength(e) > providerEntryStrength(prior) ? e : prior;
      chosen.aliases = Object.keys(aliasSeen);
      chosen.rosterVerified = prior.rosterVerified || e.rosterVerified;
      byKey[k] = chosen;
    });
    var candidates = order.map(function (k) { return byKey[k]; }).filter(Boolean);
    /* Drop an id-less legacy echo whenever one or more exact canonical strong
       identities already exist. Distinct real IDs/stable Athena identities are
       deliberately retained; same-name clinicians remain independently routable. */
    var strongEq = {}, strongBase = {};
    candidates.forEach(function (e) {
      if (!/^legacy-name:/.test(e.stableKey) && e.equivalentKey) {
        if (!strongEq[e.equivalentKey]) strongEq[e.equivalentKey] = [];
        strongEq[e.equivalentKey].push(e);
        var base = providerIdentityParts(e.name).base;
        if (base) { if (!strongBase[base]) strongBase[base] = []; strongBase[base].push(e); }
      }
    });
    var out = candidates.filter(function (e) {
      if (!/^legacy-name:/.test(e.stableKey)) return true;
      var weakParts = providerIdentityParts(e.name);
      var targets = strongEq[e.equivalentKey] || (!weakParts.credential ? strongBase[weakParts.base] : null);
      if (!targets || !targets.length) return true; /* unresolved weak alias stays internal, never renders */
      /* A unique strong counterpart inherits the discarded weak identity as
         an alias, so an already-selected dropdown value resolves to the same
         clinician after cleanup. Ambiguous aliases deliberately map nowhere. */
      if (targets.length === 1) {
        var target = targets[0], seenAlias = {};
        (target.aliases || []).concat([e.stableKey, e.raw]).forEach(function (a) { if (a) seenAlias[a] = 1; });
        target.aliases = Object.keys(seenAlias);
      }
      return false;
    }).slice(-240);
    unsSet(CACHE_V2_KEY, JSON.stringify(out));
    /* Keep the old picker usable, but never use its name-only cache as the
       canonical roster. Same-name clinicians remain distinct in V2. */
    var legacyNames = [], legacySeen = {};
    out.forEach(function (e) { var k = normKey(e.name); if (e.providerEligible !== false && k && !legacySeen[k]) { legacySeen[k] = 1; legacyNames.push(e.name); } });
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
        var e = makeEntry(raw, raw && raw.source || 'calendar'); if (!e || e.providerEligible === false || seen[e.stableKey]) return;
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
  /* ---- batch-bound operation provenance (v2.2.0) ----------------------
     A roster receipt is trustworthy for ONE exact pull only. The importer
     arms the batch context (exact requested date, the frozen schedule
     requestId, and the exact requested provider scope) BEFORE dispatching
     the schedule read; the receipt then carries that provenance only when
     the ingested schedule reply proves it belongs to that exact request.
     Anything else - a stale replayed reply, a probe, a reload sweep, a
     weakly typed or contradictory operation - yields EMPTY provenance so
     every downstream batch-binding gate fails closed. */
  var OPERATION_TTL_MS = 10 * 60 * 1000;
  var _armedOperation = null;
  function normalizeOperation(op) {
    if (!op || typeof op !== 'object') return null;
    var targetDate = typeof op.targetDate === 'string' ? clean(op.targetDate) : '';
    var requestId = typeof op.requestId === 'string' ? clean(op.requestId) : '';
    var providerMode = typeof op.providerMode === 'string' ? clean(op.providerMode).toLowerCase() : '';
    var requestedProviderId = typeof op.requestedProviderId === 'string' ? clean(op.requestedProviderId) : '';
    var requestedProviderStableKey = typeof op.requestedProviderStableKey === 'string' ? clean(op.requestedProviderStableKey) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
    if (!requestId || requestId.length > 100) return null;
    if (providerMode !== 'all' && providerMode !== 'selected') return null;
    if (providerMode === 'all' && (requestedProviderId || requestedProviderStableKey)) return null;
    if (providerMode === 'selected' && !requestedProviderId && !requestedProviderStableKey) return null;
    return {
      targetDate: targetDate,
      requestId: requestId,
      providerMode: providerMode,
      requestedProviderId: requestedProviderId,
      requestedProviderStableKey: requestedProviderStableKey,
      armedAt: Date.now()
    };
  }
  function beginOperation(op) {
    _armedOperation = normalizeOperation(op);
    if (!_armedOperation) return null;
    return {
      targetDate: _armedOperation.targetDate,
      requestId: _armedOperation.requestId,
      providerMode: _armedOperation.providerMode,
      requestedProviderId: _armedOperation.requestedProviderId,
      requestedProviderStableKey: _armedOperation.requestedProviderStableKey
    };
  }
  function operationForResponse(resp) {
    var respRequestId = clean(resp && (resp.requestId || resp.id) || '');
    if (!_armedOperation || !respRequestId) return null;
    if (respRequestId !== _armedOperation.requestId) return null;
    if ((Date.now() - Number(_armedOperation.armedAt || 0)) > OPERATION_TTL_MS) return null;
    return _armedOperation;
  }
  function operationFromReceipt(r) {
    if (!r || typeof r !== 'object') return null;
    return normalizeOperation({
      targetDate: typeof r.targetDate === 'string' ? r.targetDate : '',
      requestId: typeof r.requestId === 'string' ? r.requestId : '',
      providerMode: typeof r.providerMode === 'string' ? r.providerMode : '',
      requestedProviderId: typeof r.requestedProviderId === 'string' ? r.requestedProviderId : '',
      requestedProviderStableKey: typeof r.requestedProviderStableKey === 'string' ? r.requestedProviderStableKey : ''
    });
  }
  function normalizeReceipt(receipt, observed, reason, operation) {
    var r = receipt && typeof receipt === 'object' ? receipt : {};
    var op = operation && typeof operation === 'object' ? normalizeOperation(operation) : null;
    var complete = r.complete === true && r.partial !== true;
    var observedCount = r.observedCount == null ? Number(observed || 0) : Number(r.observedCount);
    var fullSweep = complete && r.reachedEnd === true && r.capReached === false &&
      r.budgetExpired === false && r.restored === true && r.boundsStable === true;
    return {
      complete: complete,
      partial: !complete,
      reason: clean(r.reason || reason || (complete ? 'complete' : 'legacy-unverified')),
      expectedCount: r.expectedCount == null ? (fullSweep ? observedCount : null) : Number(r.expectedCount),
      observedCount: observedCount,
      reachedEnd: r.reachedEnd === true,
      capReached: r.capReached === true,
      budgetExpired: r.budgetExpired === true,
      restored: r.restored == null ? null : r.restored === true,
      boundsStable: r.boundsStable === true,
      steps: Number(r.steps || 0),
      targetDate: op ? op.targetDate : '',
      requestId: op ? op.requestId : '',
      providerMode: op ? op.providerMode : '',
      requestedProviderId: op ? op.requestedProviderId : '',
      requestedProviderStableKey: op ? op.requestedProviderStableKey : '',
      updatedAt: Date.now()
    };
  }
  function setReceipt(receipt, observed, reason, operation) {
    lastReceipt = normalizeReceipt(receipt, observed, reason, operation);
    unsSet(RECEIPT_KEY, JSON.stringify(lastReceipt));
    return lastReceipt;
  }
  function listEntries() {
    syncCalendarProviders();
    var cleanList = storedEntries();
    /* A formerly-complete receipt cannot survive discovery that its persisted
       roster contained non-provider rows. Keep the clean entries visible, but
       require a fresh exact Athena sweep before selected-provider pulls. */
    if (_cacheSanitized && lastReceipt && lastReceipt.complete === true) {
      lastReceipt = normalizeReceipt({ complete: false, partial: true, reason: 'cached-roster-sanitized', observedCount: cleanList.length }, cleanList.length, 'cached-roster-sanitized', operationFromReceipt(lastReceipt));
      unsSet(RECEIPT_KEY, JSON.stringify(lastReceipt));
    }
    return cleanList.filter(function (e) { return e.providerEligible !== false; }).map(function (e) { var c = {}; Object.keys(e).forEach(function (k) { c[k] = e[k]; }); return c; });
  }
  function receiptSnapshot() {
    var base=lastReceipt||normalizeReceipt(null,listEntries().length,'not-yet-verified');
    var out={};Object.keys(base||{}).forEach(function(k){out[k]=base[k];});
    var entries=listEntries(),keys=[],seen={};
    entries.forEach(function(entry){var key=clean(entry&&entry.stableKey);if(key&&!seen[key]){seen[key]=1;keys.push(key);}});
    keys.sort();out.listedCount=entries.length;out.identityKeys=keys;
    return out;
  }
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
    exact = entries.filter(function (e) { return Array.isArray(e.aliases) && e.aliases.indexOf(raw) >= 0; });
    if (exact.length === 1) return exact[0];
    exact = entries.filter(function (e) { return normKey(e.raw) === normKey(raw); });
    if (exact.length === 1) return exact[0];
    exact = entries.filter(function (e) { return normKey(e.name) === normKey(raw); });
    if (exact.length === 1) return exact[0];
    var eq = providerEquivalentKey(raw, true);
    exact = eq ? entries.filter(function (e) { return e.equivalentKey === eq; }) : [];
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
      /* Snapshot legacy calendar/provider selections before the exact Athena
         roster merge. A fresh response may arrive before any picker/list call;
         mergeIntoCalendar() would otherwise discard a weak uncredentialed old
         value before it can become a non-rendering alias of one unique strong
         identity. Ambiguous matches still fail closed in mergeEntries(). */
      syncCalendarProviders();
      var structuredRosterRaw = Array.isArray(r.providerRoster) ? r.providerRoster : [];
      var structuredRoster = structuredRosterRaw.map(function (p) { return makeEntry(p, 'athena-schedule-header'); }).filter(Boolean);
      var structuredIdentityConflict = false, structuredByStable = {};
      structuredRoster.forEach(function (entry) {
        var prior = structuredByStable[entry.stableKey];
        if (prior && !providerEntriesCompatible(prior, entry)) structuredIdentityConflict = true;
        else if (!prior) structuredByStable[entry.stableKey] = entry;
      });
      var structuredProvidersRaw = Array.isArray(r.providers) ? r.providers.filter(Boolean) : [];
      var structuredProviders = structuredProvidersRaw.map(function (p) { return makeEntry(p, 'legacy-extension-provider'); }).filter(Boolean);
      var structuredAppts = Array.isArray(r.appts) ? r.appts : [];
      var hasStructuredScope = structuredAppts.some(function (a) { return a && makeEntry(a.provider, 'appointment-attribution'); });

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
      structuredProviders.forEach(function (p) { union.push(p); });
      structuredAppts.forEach(function (a) { if (a && a.provider) { var apptProvider = makeEntry(a.provider, 'appointment-attribution'); if (apptProvider) union.push(apptProvider); } });
      rec.providers.forEach(function (p) { var recoveredProvider = makeEntry(p, 'text-recovery'); if (recoveredProvider) union.push(recoveredProvider); });

      var diag = {
        version: VERSION,
        source: structuredRoster.length ? 'structured-roster' : (structuredProviders.length || hasStructuredScope ? 'legacy-structured+text' : (rec.providers.length ? 'text-recovery' : 'none')),
        structuredRosterCount: structuredRoster.length,
        structuredProviderCount: structuredProviders.length,
        rejectedStructuredRosterCount: structuredRosterRaw.length - structuredRoster.length,
        rejectedLegacyProviderCount: structuredProvidersRaw.length - structuredProviders.length,
        structuredIdentityConflict: structuredIdentityConflict,
        structuredApptScoped: hasStructuredScope,
        textProviderCount: rec.providers.length,
        textApptCount: rec.appts.length,
        textLineCount: rec.diag.lineCount,
        providerNames: [], // filled after merge — CLINICIAN names only, PHI-free
        textDiagErr: rec.diag.err || null
      };

      var before = cachedCount();
      var afterList = union.length ? mergeEntries(union, 'schedule-result') : listEntries();
      var mergeIdentityConflict = _lastMergeIdentityConflict;
      var receiptReason = r.error ? 'schedule-read-error' : (structuredRoster.length ? 'structured-roster-unverified' : (afterList.length ? 'legacy-unverified' : 'no-provider-headers'));
      var receiptInput = r.providerRosterReceipt;
      /* Batch binding: this reply's provenance is accepted only when the reply
         itself carries the exact armed schedule requestId. A raw extension
         receipt claiming a DIFFERENT requestId than its own reply is stale or
         replayed evidence and voids completeness outright. */
      var respRequestId = clean(r.requestId || r.id || '');
      var boundOperation = operationForResponse(r);
      var extensionReceiptRequestId = clean(receiptInput && receiptInput.requestId || '');
      var requestEchoConflict = !!(extensionReceiptRequestId && respRequestId && extensionReceiptRequestId !== respRequestId) ||
        !!(extensionReceiptRequestId && boundOperation && extensionReceiptRequestId !== boundOperation.requestId);
      if (receiptInput && receiptInput.complete === true) {
        var uniqueStructured = {}, uniqueCount = 0;
        structuredRoster.forEach(function (e) { if (!uniqueStructured[e.stableKey]) { uniqueStructured[e.stableKey] = 1; uniqueCount++; } });
        var declaredObserved = receiptInput.observedCount == null ? null : Number(receiptInput.observedCount);
        var declaredExpected = receiptInput.expectedCount == null ? null : Number(receiptInput.expectedCount);
        /* Exact duplicate stable identities are harmless and are intentionally
           deduped. Rejected semantic rows or a receipt/count mismatch are not. */
        var contaminated = structuredRosterRaw.length !== structuredRoster.length || !structuredRosterRaw.length || structuredIdentityConflict || mergeIdentityConflict;
        if (declaredObserved != null && isFinite(declaredObserved) && declaredObserved !== uniqueCount) contaminated = true;
        if (declaredExpected != null && isFinite(declaredExpected) && declaredExpected !== uniqueCount) contaminated = true;
        if (requestEchoConflict) contaminated = true;
        if (contaminated) {
          receiptInput = {
            complete: false, partial: true, reason: requestEchoConflict ? 'provider-roster-request-mismatch' : 'provider-roster-contaminated',
            expectedCount: receiptInput.expectedCount == null ? null : receiptInput.expectedCount,
            observedCount: uniqueCount, reachedEnd: receiptInput.reachedEnd === true,
            capReached: receiptInput.capReached === true, budgetExpired: receiptInput.budgetExpired === true,
            restored: receiptInput.restored, steps: receiptInput.steps
          };
        } else _cacheSanitized = false; /* a fresh exact clean sweep supersedes an old polluted cache */
      }
      var receipt = setReceipt(receiptInput, structuredRoster.length || afterList.length, receiptReason, requestEchoConflict ? null : boundOperation);
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
    beginOperation: beginOperation,
    getReceipt: receiptSnapshot,
    getDiag: function () { return lastDiag; },
    notify: function () { notifyRosterUpdated(listEntries(), lastReceipt); },
    _makeEntry: makeEntry,
    _canonicalName: canonicalProviderName,
    _equivalentKey: providerEquivalentKey,
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
