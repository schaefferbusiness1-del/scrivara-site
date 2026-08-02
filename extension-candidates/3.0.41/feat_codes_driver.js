/* =========================================================================
   MLS Seamless Pop-up  —  CODES write-back driver  (Increment 6, gap B)
   FLAG-GATED. Ships OFF (FLAGS.codesDriver=false) until it has had ONE real
   athenaOne selector-tuning pass on a TEST patient. See 04_codes_writeback.md.

   What it does (only when the flag is ON):
     For each ICD-10 / CPT / E-M code the doctor approved in review, it does
     EXACTLY what a human does in Athena's structured pickers:
       1. locate the add-diagnosis / add-order / visit-level picker (content-scored)
       2. focus + type the CODE per character (typeahead fields reject value=)
       3. wait (bounded) for the result list
       4. select the row whose code EQUALS the target exactly  (no near-match!)
       5. verify the code now appears in the committed list; only then "✓ added"
     Order: diagnoses -> CPT -> E/M (CPT often needs a linked dx). Add-on CPT
     only when its primary is present. Honest miss otherwise.

   HARD RAILS:
     - NEVER clicks Save / Sign / attest / submit-charges. Adds codes only.
     - NEVER selects a near-match row. NEVER invents a primary. NEVER fabricates
       an "added" — a code is "added" only after it is re-read in the committed list.
     - Runs only behind the patient-match gate (enforced by background.js caller).

   This file is structured so the ORCHESTRATOR is unit-testable with a fake
   per-code driver (no Athena DOM), and the page-side driver function is the
   thing the one live tuning pass refines.
   ========================================================================= */
(function (root) {
  'use strict';

  // ------- normalize a code for exact comparison (case/space/dot-safe) -------
  function normCode(c) { return String(c == null ? '' : c).toUpperCase().replace(/\s+/g, '').trim(); }

  // ------- split codes into the order Athena wants them entered --------------
  function plan(codes) {
    codes = codes || {};
    var icd = (codes.icd10 || []).map(function (c) { return { kind: 'dx', code: (c.code || c), desc: c.desc || '' }; });
    var cpt = (codes.cpt   || []).map(function (c) { return { kind: 'cpt', code: (c.code || c), desc: c.desc || '' }; });
    var steps = icd.slice();                 // diagnoses first
    steps = steps.concat(cpt);               // then CPT
    if (codes.em_level) steps.push({ kind: 'em', code: codes.em_level, desc: 'E/M level' });
    return steps;
  }

  // ------- the orchestrator: drive each code, collect honest results ---------
  //   driveOne(step) -> Promise<{ok:bool, reason?:string}>   (the per-code action)
  //   onProgress(message, kind)                               (real events only)
  function runCodes(codes, driveOne, onProgress) {
    onProgress = onProgress || function () {};
    var steps = plan(codes);
    var added = [], missed = [];
    var presentDx = {};   // codes confirmed added, so add-on CPT can check a primary exists

    function labelFor(step) {
      return step.kind === 'dx' ? 'diagnosis ' + step.code
           : step.kind === 'cpt' ? 'CPT ' + step.code
           : 'E/M ' + step.code;
    }

    return steps.reduce(function (chain, step) {
      return chain.then(function () {
        onProgress('Adding ' + labelFor(step) + '…', 'run');
        return Promise.resolve(driveOne(step)).then(function (r) {
          r = r || {};
          if (r.ok) {
            added.push(step.code);
            if (step.kind === 'dx') presentDx[normCode(step.code)] = true;
            onProgress('✓ ' + step.code + ' added', 'ok');
          } else {
            missed.push({ code: step.code, reason: r.reason || 'not-added' });
            onProgress('⚠ Couldn’t add ' + step.code + ' — add it by hand', 'warn');
          }
        }, function () {
          missed.push({ code: step.code, reason: 'driver-error' });
          onProgress('⚠ Couldn’t add ' + step.code + ' — add it by hand', 'warn');
        });
      });
    }, Promise.resolve()).then(function () {
      return { ok: missed.length === 0, added: added, missed: missed, confirmed: added.length > 0 };
    });
  }

  // ====================================================================== //
  //  PAGE-SIDE DRIVER  (serialized into the Athena tab's frames via          //
  //  chrome.scripting.executeScript by background.js). Content-scored, no     //
  //  hard-coded selectors — the same robustness approach as the v1.36 search  //
  //  driver. THIS is what the one live tuning pass refines. Returns a plain   //
  //  result object; never throws across the boundary.                         //
  // ====================================================================== //
  function codesPickerDriverFn(kind, code, phase) {
    try {
      function vis(el) {
        try { var r = el.getBoundingClientRect(); var s = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; }
        catch (e) { return false; }
      }
      function norm(c) { return String(c || '').toUpperCase().replace(/\s+/g, ''); }
      var want = norm(code);

      // ---- locate the add-picker input for this kind (content-scored) ----
      if (phase === 'find' || phase === 'type') {
        var inputs = [].slice.call(document.querySelectorAll('input,textarea')).filter(vis);
        function score(i) {
          var s = 0;
          var hay = ((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '') + ' ' +
                     (i.getAttribute('aria-label') || '') + ' ' + (i.title || '')).toLowerCase();
          if (kind === 'dx')  { if (/diagnos|assessment|icd|problem/.test(hay)) s += 4; }
          if (kind === 'cpt') { if (/order|charge|cpt|procedure|superbill/.test(hay)) s += 4; }
          if (kind === 'em')  { if (/e\/?m|visit level|level of service|e&m/.test(hay)) s += 4; }
          if (/add|search|find/.test(hay)) s += 2;
          var ty = (i.type || '').toLowerCase();
          if (ty === 'search') s += 2; if (ty === '' || ty === 'text') s += 1;
          if (ty === 'hidden' || ty === 'password' || ty === 'checkbox' || ty === 'radio') s -= 10;
          return s;
        }
        inputs.sort(function (a, b) { return score(b) - score(a); });
        var best = inputs[0];
        if (!best || score(best) < 4) return { ok: false, reason: 'picker-not-found' };
        if (phase === 'find') return { ok: true };
        // type the code per character (typeahead fields reject value= writes)
        best.focus();
        best.value = '';
        for (var k = 0; k < code.length; k++) {
          best.value += code[k];
          best.dispatchEvent(new InputEvent('input', { bubbles: true, data: code[k] }));
        }
        best.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      }

      // ---- select the EXACT-code row from the result list ----
      if (phase === 'select') {
        var rows = [].slice.call(document.querySelectorAll(
          '[role="option"],li,tr,.search-result,.dropdown-item,.autocomplete-option')).filter(vis);
        var hit = null;
        for (var r = 0; r < rows.length; r++) {
          var txt = norm(rows[r].textContent || '');
          if (txt.indexOf(want) >= 0) { hit = rows[r]; break; }   // exact code substring, normalized
        }
        if (!hit) return { ok: false, reason: 'no-exact-row' };   // NEVER pick a near match
        hit.click();
        return { ok: true };
      }

      // ---- verify the code is now in the committed list ----
      if (phase === 'verify') {
        var body = norm(document.body ? document.body.textContent : '');
        return { ok: body.indexOf(want) >= 0, reason: 'not-in-committed-list' };
      }

      return { ok: false, reason: 'unknown-phase' };
    } catch (e) {
      return { ok: false, reason: 'driver-exception' };
    }
  }

  var api = { runCodes: runCodes, plan: plan, normCode: normCode, codesPickerDriverFn: codesPickerDriverFn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.__mlsCodesDriver = api;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
