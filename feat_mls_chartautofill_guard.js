/* ============================================================================
 * feat_mls_chartautofill_guard.js  ->  window.__mlsChartFillGuard  (cfg-1.0.0)
 * ---------------------------------------------------------------------------
 * BUG FIX (Bug Breaker): feat_mls_chartautofill.js auto-reads the open
 * athenaOne tab on load and fills the visit hero name (#heroPtName) + patient
 * label (#patientLabel). When the open athenaOne tab is NOT a patient chart
 * (e.g. the SIGN-IN / login page or the dashboard), its parser still extracts a
 * bogus "name" -- observed live: "In Athena", "Hint S'" -- and fills it into
 * those fields with a falsely-confident toast:
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
 *   2) scrubs any junk value already auto-filled into the live fields on this
 *      load -- never touching a field the user is editing, and never clearing a
 *      plausible real name.
 *
 * It does not write to athenaOne, does not auto-submit/sign/save, and is fully
 * reversible via window.__mlsChartFillGuard.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsChartFillGuard && window.__mlsChartFillGuard.installed) return; } catch (e) { return; }

  var VERSION = 'cfg-1.0.0';
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

  // Clear junk already auto-filled into the live fields on this load.
  function scrubFields() {
    ['heroPtName', 'patientLabel'].forEach(function (id) {
      var el = safe(function () { return document.getElementById(id); }, null);
      if (!el) return;
      if (el === document.activeElement) return;            // never touch what the user is editing
      if (el.value && nameIsJunk(el.value)) {
        el.value = '';
        safe(function () { el.dispatchEvent(new Event('input', { bubbles: true })); });
        safe(function () { el.dispatchEvent(new Event('change', { bubbles: true })); });
      }
    });
  }

  // Install as soon as chartautofill exists; scrub current junk a couple of times early.
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (install() || tries > 60) { clearInterval(iv); }
  }, 150);
  install();
  var t1 = setTimeout(scrubFields, 400);
  var t2 = setTimeout(scrubFields, 1500);

  function revert() {
    safe(function () { clearInterval(iv); });
    safe(function () { clearTimeout(t1); });
    safe(function () { clearTimeout(t2); });
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
