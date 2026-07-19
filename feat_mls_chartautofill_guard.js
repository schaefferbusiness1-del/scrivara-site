/* ============================================================================
 * feat_mls_chartautofill_guard.js  ->  window.__mlsChartFillGuard  (cfg-1.0.2)
 * ---------------------------------------------------------------------------
 * BUG FIX (Bug Breaker): feat_mls_chartautofill.js auto-reads the open
 * athenaOne tab on load and fills the visit hero name (#heroPtName) + patient
 * label (#patientLabel). When the open athenaOne tab is NOT a patient chart
 * (e.g. the SIGN-IN / login page or the dashboard), it extracts a bogus "name"
 * -- observed live: "In Athena", "Hint S'" -- and fills it into those fields
 * with a falsely-confident toast:
 *   'Filled "In Athena" from your open athenaOne chart - please verify ...'
 * A clinician could start a visit attached to that junk name.
 *
 * Why it slipped through: the source STOP/NOISE lists reject "athenanet" /
 * "athenahealth" but not bare "athena" or "in", so "In Athena" reads as a
 * two-word First-Last name.
 *
 * THIS MODULE (additive, reversible, ASCII-only, read-only):
 *   1) wraps __mlsChartFill.parseIdentity to refuse to parse obvious non-chart
 *      / login pages, and to reject junk-name guesses (expanded junk-token set)
 *      BEFORE anything is filled or any toast is shown;
 *   2) scrubs junk values from the live fields on a short poll for the first
 *      ~10s after load -- the athenaOne read is an extension round-trip that can
 *      land a junk fill several seconds in, and the structured-banner fill path
 *      bypasses the parser guard, so a one-shot scrub is not enough. The scrub
 *      never touches a field the user is editing and never clears the exact
 *      selected patient's name, even if that name contains a generic UI word.
 *
 * It does not write to athenaOne, does not auto-submit/sign/save, and is fully
 * reversible via window.__mlsChartFillGuard.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsChartFillGuard && window.__mlsChartFillGuard.installed) return; } catch (e) { return; }

  var VERSION = 'cfg-1.0.2';
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  // Tokens that are never part of a real patient name (athenaOne chrome, login
  // page words, app chrome, generic UI). Whole-word match only, so real
  // surnames that merely CONTAIN these letters (e.g. "Newman") are unaffected.
  var JUNK = {};
  ('athena athenaone athenanet athenahealth epic cerner sign signin login logout log in out on off '
    + 'hint username user password pass passcode otp welcome loading please wait error page notfound found '
    + 'open close connect connected disconnect disconnected here today tomorrow yesterday start stop '
    + 'null undefined true false menu home search dashboard portal account profile settings help support '
    + 'continue cancel submit back forgot reset verify code unable session timeout secure remember '
    + 'patient patients chart charts note notes visit visits schedule scheduling registration billing '
    + 'clinicals messaging communicator quickview claims financials reports quality').split(/\s+/)
    .forEach(function (w) { JUNK[w] = 1; });

  // Page text that means the open tab is NOT a patient chart.
  var LOGIN_RE = /(sign ?in|log ?in|password|user ?name|one[-\s]?time|two[-\s]?step|verification code|forgot your|keep me signed|single sign|sso\b)/i;

  function nameIsJunk(name) {
    if (!name) return true;
    var words = String(name).toLowerCase().replace(/[^a-z'\-\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    for (var i = 0; i < words.length; i++) { if (JUNK[words[i]]) return true; }
    return false;
  }

  function selectedPatientName() {
    return safe(function () {
      var p = null;
      if (typeof window.activePatient === 'function') p = window.activePatient();
      else if (typeof window.activePt === 'function') p = window.activePt();
      return p && p.id && p.name ? String(p.name).replace(/\s+/g, ' ').trim().toLowerCase() : '';
    }, '');
  }

  function install() {
    var cf = window.__mlsChartFill;
    if (!cf || cf.__guarded) return false;
    var origParse = cf.parseIdentity;
    if (typeof origParse !== 'function') return false;
    cf.__origParseIdentity = origParse;
    cf.parseIdentity = function (text) {
      // refuse obvious non-chart / login pages outright
      if (LOGIN_RE.test(String(text || ''))) return null;
      var id = origParse.apply(this, arguments);
      // reject junk-name guesses (e.g. "In Athena", "Sign In", "Hint S")
      if (id && nameIsJunk(id.name)) return null;
      return id;
    };
    cf.__guarded = true;
    return true;
  }

  // Clear junk already auto-filled into the live fields.
  function scrubFields() {
    var selectedName = selectedPatientName();
    ['heroPtName', 'patientLabel'].forEach(function (id) {
      var el = safe(function () { return document.getElementById(id); }, null);
      if (!el) return;
      if (el === document.activeElement) return;            // never touch what the user is editing
      var fieldName = String(el.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      // A selected patient record is a stronger identity source than this
      // heuristic. Do not erase its exact name (or emit a synthetic input that
      // makes an already-saved visit look unsaved) merely because a real name
      // contains a generic token such as "Patient".
      if (selectedName && fieldName === selectedName) return;
      if (el.value && nameIsJunk(el.value)) {
        el.value = '';
        safe(function () { el.dispatchEvent(new Event('input', { bubbles: true })); });
        safe(function () { el.dispatchEvent(new Event('change', { bubbles: true })); });
      }
    });
  }

  // Install as soon as chartautofill exists.
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (install() || tries > 60) { clearInterval(iv); }
  }, 150);
  install();

  // Scrub junk on a short poll for the first ~10s (covers slow extension reads
  // and the structured-banner fill path that bypasses the parser guard).
  var scrubN = 0;
  var scrubIv = setInterval(function () {
    scrubN++;
    scrubFields();
    if (scrubN > 25) { clearInterval(scrubIv); }
  }, 400);
  scrubFields();

  function revert() {
    safe(function () { clearInterval(iv); });
    safe(function () { clearInterval(scrubIv); });
    safe(function () {
      var cf = window.__mlsChartFill;
      if (cf && cf.__origParseIdentity) {
        cf.parseIdentity = cf.__origParseIdentity;
        cf.__guarded = false;
        delete cf.__origParseIdentity;
      }
    });
    safe(function () { window.__mlsChartFillGuard.installed = false; });
  }

  window.__mlsChartFillGuard = {
    installed: true,
    version: VERSION,
    nameIsJunk: nameIsJunk,
    isLoginText: function (t) { return LOGIN_RE.test(String(t || '')); },
    scrub: scrubFields,
    revert: revert
  };
})();
