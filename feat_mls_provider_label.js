/* =============================================================================
 * feat_mls_provider_label.js -> window.__mlsProviderLabel  (plbl-1.0.0)
 * -----------------------------------------------------------------------------
 * ONE canonical provider-name resolver + a normalizer for the shared roster, so
 * every provider-selection surface in the app renders real names through the
 * SAME lookup instead of each builder inventing its own fallback.
 *
 * ROOT CAUSE of the "Provider undefined" panel (verified via full-app catalog):
 *   window._calProviders begins as clean {id,name} objects from /api/providers
 *   (only providers with a backend record -- e.g. Michael + Matthew -- are there).
 *   feat_mls_asst_fix.js then PUSHES bare recovered name STRINGS onto the same
 *   array (every other clinician seen in the schedule text). The base calendar
 *   dropdowns render each entry as `p.name || ('Provider ' + p.id)`. A bare
 *   STRING has neither .name nor .id, so it renders the literal "Provider
 *   undefined" -- which is why "all but the two backed providers" showed that.
 *   Other builders emit "[object Object]" (String(name-less object)) or
 *   "Provider <index>" for the same mixed array. ~10 divergent resolvers exist.
 *
 * TWO surfaces read a DIFFERENT roster (window.__mlsProviderRoster.list()): the
 * month/range and last-month pull-plan dropdowns. Those are routed through this
 * same resolver at their call sites (feat_mls_month_pull.js / _lastmonth_b51.js).
 *
 * WHAT THIS DOES:
 *   1) window.__mlsProviderLabel(entry) -- the single canonical per-entry
 *      resolver. Accepts a string, a {name|provider_raw|provider_key|provider|
 *      displayName|label|...} object, or a char-spread string object. Humanizes
 *      athenaOne machine usernames ('Benner_John_MD' -> 'John Benner, MD').
 *      Returns a clean display name, or '' for anything unnameable/junk
 *      ("Provider undefined", "Provider null", "Provider <n>", "[object Object]",
 *      "undefined", "No provider", "Unassigned", empty) so callers DROP it
 *      instead of showing a phantom row.
 *   2) Normalizes window._calProviders IN PLACE (idempotent, light interval):
 *      every entry becomes an object carrying a real .name (strings promoted,
 *      machine names humanized, original object fields incl. id preserved),
 *      unnameable phantoms dropped, deduped by name. Because EVERY base builder
 *      reads .name first, this one data fix makes all _calProviders-based
 *      dropdowns (calProvFilter / calAddDoc / calNewDoc / calE_doc, calpro,
 *      calendar_exact/polish, patientpick/simple_exact/assistant_exact) show
 *      the real names at once. The two backend {id,name} objects keep their id
 *      (their option value / doctor_user_id filtering is unchanged).
 *
 * Read-only w.r.t. clinical data; no Athena, no network, no note writes. Never
 * fabricates a name (unnameable -> dropped, not numbered). Idempotent; the
 * interval no-ops once the array is clean. Additive; reversible:
 * window.__mlsProviderLabel.revert(). ASCII-only.
 * ===========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsProviderLabel && window.__mlsProviderLabel.installed) return; } catch (e) { return; }

  var VERSION = 'plbl-1.2.0';

  /* labels that carry no real identity -> treat as unnameable ('') */
  var JUNK = /^(provider\s*(#?\s*\d+|undefined|null)?|no provider|unassigned|\[object object\]|undefined|null|n\/?a|all doctors|all providers|no preference)$/i;

  function humanize(raw) {
    raw = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    /* athenaOne machine username 'Last_First_CRED' -> 'First Last, CRED' */
    if (raw.indexOf('_') >= 0 && /^[A-Za-z][A-Za-z'\-]*_[A-Za-z]/.test(raw)) {
      var parts = raw.split('_').filter(function (x) { return x !== ''; });
      if (parts.length >= 2) {
        var last = parts[0], first = parts[1], cred = parts.slice(2).join(' ').trim();
        raw = first + ' ' + last + (cred ? (', ' + cred) : '');
      } else {
        raw = raw.replace(/_/g, ' ');
      }
    }
    return raw.replace(/\s+/g, ' ').trim();
  }

  function isCharSpread(o) {
    if (!o || typeof o !== 'object') return false;
    var keys = Object.keys(o);
    if (!keys.length) return false;
    for (var i = 0; i < keys.length; i++) { if (!/^\d+$/.test(keys[i])) return false; }
    return true;
  }

  /* THE canonical resolver: entry (string | object | char-spread) -> clean name | '' */
  function labelOf(entry) {
    try {
      if (entry == null) return '';
      var raw = '';
      if (typeof entry === 'string') {
        raw = entry;
      } else if (typeof entry === 'object') {
        if (isCharSpread(entry)) {
          raw = Object.keys(entry).sort(function (a, b) { return (+a) - (+b); })
            .map(function (k) { return entry[k]; }).join('');
        } else {
          raw = entry.name || entry.provider_raw || entry.provider_key ||
                entry.provider || entry.displayName || entry.label || '';
        }
      } else {
        return '';
      }
      var h = humanize(raw);
      if (!h || JUNK.test(h)) return '';
      return h;
    } catch (e) { return ''; }
  }

  /* Identity is deliberately separate from the display label. Two clinicians
     may have the same human name; an Athena/backend id or exact machine header
     keeps both selectable. A display-name key is only the last-resort legacy
     identity when no stronger source exists. */
  function stableIdentity(entry) {
    try {
      if (entry == null) return '';
      if (typeof entry === 'string') {
        var rs = String(entry).replace(/\s+/g, ' ').trim();
        return rs ? ('athena:' + rs.toLowerCase()) : '';
      }
      if (typeof entry !== 'object') return '';
      var explicit = entry.stableKey || entry.stable_key;
      if (explicit) return String(explicit).trim();
      var id = entry.id || entry.providerId || entry.provider_id || entry.doctor_user_id || entry.user_id;
      if (id !== undefined && id !== null && String(id).trim()) return 'backend:' + String(id).trim();
      var raw = entry.raw || entry.provider_raw || entry.provider_key || entry.provider;
      if (raw) return 'athena:' + String(raw).replace(/\s+/g, ' ').trim().toLowerCase();
      var nm = labelOf(entry);
      return nm ? ('legacy-name:' + nm.toLowerCase()) : '';
    } catch (e) { return ''; }
  }

  /* Normalize window._calProviders in place: promote strings to {name}, humanize
     machine names, preserve object fields (incl. id), drop unnameable phantoms,
     dedupe by name. Idempotent: returns true only when it actually changed. */
  function normalizeCalProviders() {
    try {
      var arr = window._calProviders;
      if (!Array.isArray(arr) || !arr.length) return false;
      var out = [], seen = {}, changed = false;
      for (var i = 0; i < arr.length; i++) {
        var e = arr[i];
        var nm = labelOf(e);
        if (!nm) { changed = true; continue; }            /* dropped a phantom */
        var k = stableIdentity(e) || ('legacy-name:' + nm.toLowerCase());
        if (seen[k]) { changed = true; continue; }         /* dropped a dupe */
        seen[k] = 1;
        if (e && typeof e === 'object' && !isCharSpread(e)) {
          if (e.name !== nm) { e.name = nm; changed = true; }
          if (!e.stableKey) { e.stableKey = k; changed = true; }
          out.push(e);
        } else {
          out.push({ name: nm, raw: typeof e === 'string' ? cleanRaw(e) : nm, stableKey: k });
          changed = true;
        }
      }
      if (out.length !== arr.length) changed = true;
      if (changed) window._calProviders = out;
      return changed;
    } catch (e) { return false; }
  }

  function cleanRaw(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

  var to = null, stopped = false, stableTicks = 0;
  function tick() {
    if (stopped) return;
    var changed = normalizeCalProviders();
    stableTicks = changed ? 0 : (stableTicks + 1);
    /* PERF (plbl-1.1.0): adaptive back-off. Run every 2.5s while the roster is
       still churning (asst_fix re-appending raw strings), but drop to a slow 20s
       heartbeat once it has settled (no change for 3 ticks) so this is never a
       persistent fast timer. A real change (a new pull) resets to fast cadence.
       Uses a self-scheduling setTimeout, not a fixed setInterval. */
    var delay = stableTicks >= 3 ? 20000 : 2500;
    try { to = setTimeout(tick, delay); } catch (e) {}
  }
  function boot() {
    normalizeCalProviders();
    try { to = setTimeout(tick, 2500); } catch (e) {}
  }
  function revert() {
    stopped = true;
    try { if (to) { clearTimeout(to); to = null; } } catch (e) {}
    try { window.__mlsProviderLabel.installed = false; } catch (e) {}
    return 'provider-label resolver reverted';
  }

  /* callable resolver + attached API */
  var api = function (entry) { return labelOf(entry); };
  api.installed = true;
  api.version = VERSION;
  api.asset = 'feat_mls_provider_label.js';
  api.label = labelOf;
  api.humanize = humanize;
  api.stableIdentity = stableIdentity;
  api.normalize = normalizeCalProviders;
  api.revert = revert;
  window.__mlsProviderLabel = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
