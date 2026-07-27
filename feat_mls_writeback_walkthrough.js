/* =============================================================================
 * __mlsWritebackWalkthrough  wbw-1.0.0  (2026-07-27 — owner op-note v2 item 5:
 * "recording -> Athena write-back UI better + verified perfectly")
 * -----------------------------------------------------------------------------
 * A WALKTHROUGH STRIP for the unified Athena review (wf2's
 * openUnifiedConfirmation). The review is rigorous but presents as a wall of
 * expert detail; this strip shows the doctor WHERE THEY ARE in the one
 * sequence that exists:
 *
 *   1 Pick the action  ->  2 Athena checks it (read-only)  ->
 *   3 Confirm & write  ->  4 Verify in Athena
 *
 * HARD RULES:
 *   - STATUS ONLY. The strip adds ZERO action controls — this codebase has
 *     documented history (handOff over seven silent refusals) and a review
 *     that is easier to click through is a worse review. Every state is READ
 *     from the surface's own elements; nothing is inferred ahead of proof.
 *   - All writes land in one module-owned node (#wbwSteps); the review's own
 *     nodes are never touched.
 *   - No timers. Two ELEMENT-scoped observers (context + receipt boxes; never
 *     document-wide) plus the overlay's own change/click events drive updates,
 *     so the strip works in this app's real occluded posture.
 *   - Revertible on its own: revert() unwraps and removes the strip.
 * ==========================================================================*/
(function () {
  'use strict';
  var VERSION = 'wbw-1.0.0';
  var previous = null;
  try { previous = window.__mlsWritebackWalkthrough; } catch (e0) {}
  if (previous && previous.installed && previous.version === VERSION) return;
  if (previous && typeof previous.revert === 'function') { try { previous.revert(); } catch (e1) {} }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function S(x) { return x == null ? '' : String(x); }
  function isFn(f) { return typeof f === 'function'; }

  var observers = [];
  var wiredCard = null;

  var STEPS = [
    { key: 'pick',    label: 'Pick the action' },
    { key: 'check',   label: 'Athena checks it' },
    { key: 'confirm', label: 'Confirm & write' },
    { key: 'verify',  label: 'Verify in Athena' }
  ];

  /* Read the truth from the surface's own elements — never ahead of proof. */
  function evalSteps() {
    var picked = safe(function () { return !!document.querySelector('#mlsAthenaUnifiedConfirm input[name="mlsAthenaUnifiedAction"]:checked'); }, false);
    var ctxEl = $('mlsAthenaUnifiedContext');
    var ctxText = ctxEl ? S(ctxEl.textContent) : '';
    var checked = !!ctxText && !/waiting for the read-only check/i.test(ctxText) && !/could not|failed|refused/i.test(ctxText);
    var rcpt = $('mlsAthenaUnifiedReceipt');
    var rcptText = rcpt ? S(rcpt.textContent) : '';
    var written = /wrote|written|saved|draft saved|write receipt|proof/i.test(rcptText) && !/refused|failed|nothing was written/i.test(rcptText);
    var verified = /verified in athena|read-back|matches athena/i.test(rcptText);
    return {
      pick:    picked ? 'done' : 'now',
      check:   checked ? 'done' : (picked ? 'now' : 'todo'),
      confirm: written ? 'done' : (checked ? 'now' : 'todo'),
      verify:  verified ? 'done' : (written ? 'now' : 'todo')
    };
  }

  function stripHtml(states) {
    var h = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:10px 0 2px" aria-label="Where you are in the send">';
    for (var i = 0; i < STEPS.length; i++) {
      var st = states[STEPS[i].key];
      var color = st === 'done' ? '#205c43' : (st === 'now' ? '#204034' : '#8b9791');
      var bg = st === 'done' ? '#eaf5ef' : (st === 'now' ? '#fff' : '#f4f6f5');
      var border = st === 'now' ? '#204034' : '#dce5df';
      var mark = st === 'done' ? '✓ ' : ((i + 1) + ' ');
      h += '<span style="display:inline-flex;align-items:center;gap:4px;border:1.5px solid ' + border + ';background:' + bg + ';color:' + color + ';border-radius:999px;padding:4px 11px;font-size:12px;font-weight:' + (st === 'now' ? '800' : '650') + '">' + mark + STEPS[i].label + '</span>';
      if (i < STEPS.length - 1) h += '<span style="color:#b9c4be;font-size:11px">→</span>';
    }
    h += '</div><div style="font-size:11.5px;color:#52675c;margin-bottom:4px">' + hint(states) + '</div>';
    return h;
  }
  function hint(states) {
    if (states.verify === 'done') return 'All four steps are done — this note is in Athena and verified.';
    if (states.verify === 'now') return 'Written. Last step is yours: run Verify in Athena (or open the chart) to see it landed exactly where the receipt says.';
    if (states.confirm === 'now') return 'Athena confirmed the exact encounter. Nothing is sent until you press Confirm & write.';
    if (states.check === 'now') return 'Read-only check running — Athena is confirming the exact patient, encounter, and editor before anything can be written.';
    return 'Pick one READY row. Everything stays read-only until you explicitly confirm.';
  }

  function renderStrip() {
    var ov = $('mlsAthenaUnifiedConfirm'); if (!ov) return;
    var title = $('mlsAthenaUnifiedTitle'); if (!title) return;
    var host = $('wbwSteps');
    if (!host) {
      host = document.createElement('div');
      host.id = 'wbwSteps';
      /* directly after the title/header block, before the identity grid */
      var headerBlock = title.parentElement && title.parentElement.parentElement;
      if (headerBlock && headerBlock.parentElement) headerBlock.parentElement.insertBefore(host, headerBlock.nextSibling);
      else return;
    }
    host.innerHTML = stripHtml(evalSteps());
  }

  function unwire() {
    for (var i = 0; i < observers.length; i++) { try { observers[i].disconnect(); } catch (e) {} }
    observers = []; wiredCard = null;
  }
  function wire() {
    var ov = $('mlsAthenaUnifiedConfirm'); if (!ov || wiredCard === ov) return;
    unwire();
    wiredCard = ov;
    renderStrip();
    /* the surface's own events drive updates — radio picks bubble as change,
       button presses as click; the probe/receipt boxes re-render via two
       ELEMENT-scoped observers (never document-wide). */
    ov.addEventListener('change', renderStrip);
    ov.addEventListener('click', function () { safe(renderStrip); });
    var ctx = $('mlsAthenaUnifiedContext'), rcpt = $('mlsAthenaUnifiedReceipt');
    [ctx, rcpt].forEach(function (el) {
      if (!el || typeof MutationObserver !== 'function') return;
      var mo = new MutationObserver(function () { safe(renderStrip); });
      mo.observe(el, { childList: true, subtree: true, characterData: true });
      observers.push(mo);
    });
  }

  function wrapOpen() {
    var wf = window.__mlsWriteFlow;
    if (!wf || !isFn(wf.openUnifiedConfirmation) || wf.openUnifiedConfirmation.__wbwWrap) return false;
    var orig = wf.openUnifiedConfirmation;
    var w = function () {
      var r = orig.apply(this, arguments);
      safe(wire);
      return r;
    };
    w.__wbwWrap = true; w.__wbwOrig = orig;
    wf.openUnifiedConfirmation = w;
    return true;
  }

  /* wf2 loads before this idle-deferred module, so one wrap attempt at boot
     is normally enough; if wf2 is somehow later, re-attempt on the first
     interaction with its button (event-driven, no timers). */
  if (!wrapOpen()) {
    var once = function () {
      if (wrapOpen()) document.removeEventListener('click', once, true);
    };
    document.addEventListener('click', once, true);
  }

  var api = {
    installed: true,
    version: VERSION,
    rerender: function () { safe(renderStrip); },
    _eval: evalSteps,
    describe: function () {
      return 'write-back walkthrough strip on the unified Athena review: ' +
        'Pick -> Athena checks -> Confirm & write -> Verify, every state READ ' +
        'from the surface\'s own elements, zero added action controls, ' +
        'element-scoped observers only, revertible.';
    },
    revert: function () {
      api.installed = false;
      unwire();
      try { var s = $('wbwSteps'); if (s) s.remove(); } catch (e2) {}
      try {
        var wf = window.__mlsWriteFlow;
        if (wf && isFn(wf.openUnifiedConfirmation) && wf.openUnifiedConfirmation.__wbwWrap && isFn(wf.openUnifiedConfirmation.__wbwOrig)) {
          wf.openUnifiedConfirmation = wf.openUnifiedConfirmation.__wbwOrig;
        }
      } catch (e3) {}
      try { if (window.__mlsWritebackWalkthrough === api) delete window.__mlsWritebackWalkthrough; } catch (e4) {}
    }
  };
  window.__mlsWritebackWalkthrough = api;
})();
