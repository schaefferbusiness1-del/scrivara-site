/* feat_mls_schedpull_honest.js  ->  window.__mlsSchedPullHonest  (v1.0.0)  [item27]
 *
 * KILL THE RESIDUAL FALSE STATUS LINE after a per-doctor schedule pull.
 * Additive, reversible, read-only. No Athena writes. No network. No PHI logged.
 *
 * WHY THIS EXISTS (confirmed by reading current repo HEAD)
 * -------------------------------------------------------------------------
 * The which-doctor / one-day-in-one-day-out per-doctor pull is already in place
 * (feat_mls_schedpull_fix.js item18 + feat_athena_provider_picker.js + the
 * importer feat_mls_schedimport_exact.js). The import POST + calendar reload is
 * ASYNC. But two callers still judge success by a synchronous count delta in a
 * short window:
 *
 *   feat_mls_patientpick.js:520  and  feat_mls_assistant_exact.js:675
 *     ...
 *     if (added > 0) setPullStatus("Imported N appointment(s) ...", true);
 *     else setPullStatus("No new appointments were imported. Open your athenaOne
 *          Day schedule (the patient grid) with the day's patients and pull
 *          again.", false);
 *
 * When the import is still finishing (or the day was already imported), `added`
 * is <= 0 in that window and the FALSE, blame-y line shows even though the pull
 * succeeded. feat_athena_status_unify.js classifies that text as a RESULT line
 * and does NOT suppress results, so the lie survives.
 *
 * THE FIX (DOM-level, idiomatic to this codebase -- same surface approach as
 * feat_athena_status_unify.js): watch the status surfaces both callers write to
 * (.mlspk-pullstatus, .as-pullstatus, #heroPullStatus) plus a guarded generic
 * net, and the instant that exact false sentence appears, replace it with an
 * honest, non-blaming line that is TRUE whether the import is still finishing OR
 * there were genuinely none to add. Never fabricates success; never claims a
 * count; never tells the user to go do athenaOne steps that did nothing.
 *
 * SAFETY: read-only except rewriting that one status string; no Athena writes;
 * sends nothing to the extension; own IIFE; try/catch throughout; idempotent;
 * no PHI. Reversible: window.__mlsSchedPullHonest.revert() (disconnects the
 * observer and restores every original string it touched).
 */
(function () {
  'use strict';

  var NS = '__mlsSchedPullHonest';
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  var VERSION = '1.0.0';
  var ASSET = 'feat_mls_schedpull_honest.js';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /* Match the false sentence by its leading phrase (case-insensitive).
     Deliberately anchored so it never touches the honest "Imported N ..." line
     or any connection line. */
  var FALSE_RE = /^no new appointments were imported\b/i;

  /* Honest replacement -- true in BOTH residual cases (import still finishing,
     or nothing new to add). No false count, no blame, no pointless instruction.
     Chosen wording avoids status_unify's RESULT/INFLIGHT classifiers (no
     "imported N", no gerund + ellipsis) so the two layers never fight. */
  var HONEST = 'Schedule pull finished — give your calendar a moment to refresh, then check the day’s appointments.';

  /* Surfaces the two emitters write to (+ the hero status the engine writes). */
  var SELECTORS = ['.mlspk-pullstatus', '.as-pullstatus', '#mlsAsstPanel .as-pullstatus', '#heroPullStatus'];

  var restore = [];   // [{el, prev}] for revert
  var MAXLEN = 240;   // never touch large content blocks -- status lines only

  function fixEl(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.getAttribute && el.getAttribute('data-mls-honest') === '1') return;
    var t = norm(el.textContent);
    if (!t || t.length > MAXLEN) return;
    if (!FALSE_RE.test(t)) return;
    restore.push({ el: el, prev: el.textContent });
    el.textContent = HONEST;
    safe(function () { el.setAttribute('data-mls-honest', '1'); });
  }

  function scanSelectors() {
    for (var i = 0; i < SELECTORS.length; i++) {
      var list = safe(function () { return document.querySelectorAll(SELECTORS[i]); }, []);
      for (var j = 0; j < list.length; j++) fixEl(list[j]);
    }
  }

  /* Guarded generic net for a changed node (handles class/markup drift). */
  function scanNode(node) {
    safe(function () {
      if (!node) return;
      if (node.nodeType === 3) {                 // text node -> check its parent
        if (FALSE_RE.test(norm(node.nodeValue))) fixEl(node.parentNode);
        return;
      }
      if (node.nodeType !== 1) return;
      var t = norm(node.textContent);
      if (t && t.length <= MAXLEN && FALSE_RE.test(t)) fixEl(node);
    });
  }

  var mo = null, iv = null;

  function onMut(muts) {
    safe(function () {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData') { scanNode(m.target); }
        else if (m.addedNodes && m.addedNodes.length) {
          for (var k = 0; k < m.addedNodes.length; k++) scanNode(m.addedNodes[k]);
          scanNode(m.target);
        } else { scanNode(m.target); }
      }
    });
  }

  function start() {
    scanSelectors();
    mo = safe(function () {
      var o = new MutationObserver(onMut);
      o.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true });
      return o;
    }, null);
    /* cheap belt-and-suspenders sweep for the known surfaces */
    iv = safe(function () { return setInterval(scanSelectors, 800); }, null);
  }

  window[NS] = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    scan: function () { scanSelectors(); },
    audit: function () { return { fixed: restore.length, observing: !!mo }; },
    revert: function () {
      safe(function () { if (mo) mo.disconnect(); }); mo = null;
      safe(function () { if (iv) clearInterval(iv); }); iv = null;
      for (var i = 0; i < restore.length; i++) {
        (function (rec) {
          safe(function () {
            rec.el.textContent = rec.prev;
            if (rec.el.removeAttribute) rec.el.removeAttribute('data-mls-honest');
          });
        })(restore[i]);
      }
      restore = [];
      safe(function () { window[NS].installed = false; });
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
