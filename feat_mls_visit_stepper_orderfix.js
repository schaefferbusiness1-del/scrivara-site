/* feat_mls_visit_stepper_orderfix.js — item51
 * Fix the Visit-header ping-pong between the visit stepper (#mlsVisitStepper, item46)
 * and the Active-problems strip (#mlsProblemStrip, item48).
 *
 * Root cause: the original stepper re-inserted its bar IMMEDIATELY BEFORE the allergy
 * strip on every 900ms tick, while the problem strip ALSO re-inserts itself immediately
 * before the allergy strip on its own tick. Two nodes cannot both be the immediate
 * predecessor of the allergy strip, so they swapped positions forever (visible flicker).
 * The original stepper's guard was additionally self-defeating: it tested
 * `bar.nextSibling === grid` but inserted before the allergy strip, so it never settled
 * and re-inserted on every tick.
 *
 * Fix: neutralize the original stepper's render (set its __reverted flag so its render
 * early-returns; remove its leftover node) and ship a corrected stepper that establishes
 * ONE deterministic order above the note:
 *      [visit stepper] -> [Active problems] -> [Allergies] -> .vx-grid
 * The corrected stepper anchors itself immediately BEFORE the problem strip (then the
 * allergy strip, then .vx-grid as fallbacks) and only moves when actually mis-positioned,
 * with a guard that checks the SAME anchor it inserts before. All three modules then
 * reach a stable fixed point with zero churn — no swapping, no flicker.
 *
 * Visuals/behaviour are byte-identical to item46 (same BAR_ID, STYLE_ID, CSS, steps,
 * computeState, click-to-jump) — only the positioning logic changed.
 *
 * Additive, reversible: window.__mlsVisitStepperOrderFix.revert()
 *   revert() removes the corrected stepper and re-enables the original module.
 */
(function () {
  if (window.__mlsVisitStepperOrderFix && window.__mlsVisitStepperOrderFix.__live) return;

  var BAR_ID = 'mlsVisitStepper';
  var STYLE_ID = 'mlsVisitStepper-style';
  var ALLERGY_ID = 'mlsAllergyStrip';
  var PROBLEM_ID = 'mlsProblemStrip';
  var timer = null;
  var lastState = '';

  // Reference to the original (buggy) stepper module so we can mute it reversibly.
  var orig = (window.__mlsVisitStepper && window.__mlsVisitStepper !== window.__mlsVisitStepperOrderFix)
    ? window.__mlsVisitStepper : null;

  // Mute the original without destroying it (its render early-returns on __reverted),
  // then drop any node it left behind. We own BAR_ID from now on. Reversible.
  function neutralizeOriginal() {
    try {
      if (orig) { orig.__reverted = true; }
      var old = document.getElementById(BAR_ID);
      // only remove a node we don't yet manage (the original's). Our own node is fine.
      if (old && old.parentNode && old.__mlsOrderFixOwned !== true) {
        old.parentNode.removeChild(old);
      }
    } catch (e) {}
  }

  var STEPS = [
    { key: 'pt',   label: 'Patient',        sub: 'select / confirm' },
    { key: 'cap',  label: 'Visit captured', sub: 'record or paste' },
    { key: 'note', label: 'Note ready',     sub: 'generate & review' },
    { key: 'sign', label: 'Ready to sign',  sub: 'finalize' }
  ];

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + BAR_ID + '{display:flex;align-items:stretch;gap:0;margin:0 0 12px 0;padding:6px;',
      'border-radius:14px;border:1px solid rgba(120,120,140,.18);background:rgba(255,255,255,.04);',
      'font:600 12.5px/1.2 inherit;overflow:hidden;}',
      '#' + BAR_ID + ' .mlsstp{flex:1 1 0;display:flex;align-items:center;gap:9px;',
      'padding:8px 12px;border:0;background:transparent;color:inherit;cursor:pointer;',
      'text-align:left;border-radius:10px;transition:background .15s ease;min-width:0;}',
      '#' + BAR_ID + ' .mlsstp:hover{background:rgba(127,127,150,.12);}',
      '#' + BAR_ID + ' .mlsstp-num{flex:0 0 auto;width:24px;height:24px;border-radius:50%;',
      'display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;',
      'background:rgba(127,127,150,.20);color:#9aa1b2;border:1px solid rgba(127,127,150,.25);}',
      '#' + BAR_ID + ' .mlsstp-txt{display:flex;flex-direction:column;min-width:0;}',
      '#' + BAR_ID + ' .mlsstp-lbl{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '#' + BAR_ID + ' .mlsstp-sub{font-weight:500;font-size:10.5px;opacity:.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '#' + BAR_ID + ' .mlsstp-sep{flex:0 0 auto;width:14px;align-self:center;height:2px;border-radius:2px;background:rgba(127,127,150,.22);}',
      '#' + BAR_ID + ' .mlsstp.is-done .mlsstp-num{background:rgba(16,185,129,.18);color:#2E6A4B;border-color:rgba(16,185,129,.35);}',
      '#' + BAR_ID + ' .mlsstp.is-done .mlsstp-lbl{color:#2E6A4B;}',
      '#' + BAR_ID + ' .mlsstp.is-now .mlsstp-num{background:rgba(59,130,246,.20);color:#3b82f6;border-color:rgba(59,130,246,.45);box-shadow:0 0 0 3px rgba(59,130,246,.12);}',
      '#' + BAR_ID + ' .mlsstp.is-now .mlsstp-lbl{color:#3b82f6;}'
    ].join('');
    document.head.appendChild(s);
  }

  function activeP() {
    try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; }
    catch (e) { return null; }
  }
  function visitVisible() {
    var g = document.querySelector('.vx-grid');
    return !!(g && g.offsetParent !== null);
  }
  function val(sel) {
    var el = document.querySelector(sel);
    return el ? String(el.value || el.textContent || '').trim() : '';
  }

  function computeState() {
    var ap = activeP();
    var hasPt = !!(ap && ap.name && String(ap.name).trim());
    var cap = val('#transcript').length > 15;
    var note = val('#noteBox').length > 15;
    var sign = hasPt && note;
    var done = { pt: hasPt, cap: cap, note: note, sign: sign };
    var order = ['pt', 'cap', 'note', 'sign'];
    var now = null;
    for (var i = 0; i < order.length; i++) { if (!done[order[i]]) { now = order[i]; break; } }
    return { done: done, now: now };
  }

  function jump(key) {
    try {
      if (key === 'pt') {
        var sw = document.querySelector('#mlsCtxBar') || document.querySelector('[id*=witchPatient],[id*=switchPatient]');
        (document.querySelector('#mlsCtxBar') || sw || document.body).scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (key === 'cap') {
        var tx = document.querySelector('#transcript');
        if (tx) { tx.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      } else if (key === 'note' || key === 'sign') {
        var nc = document.querySelector('#noteCard');
        if (nc) { nc.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
    } catch (e) {}
  }

  function build() {
    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.__mlsOrderFixOwned = true;
    STEPS.forEach(function (st, i) {
      if (i > 0) { var sep = document.createElement('span'); sep.className = 'mlsstp-sep'; bar.appendChild(sep); }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mlsstp';
      b.setAttribute('data-step', st.key);
      b.innerHTML = '<span class="mlsstp-num">' + (i + 1) + '</span>' +
        '<span class="mlsstp-txt"><span class="mlsstp-lbl">' + st.label + '</span>' +
        '<span class="mlsstp-sub">' + st.sub + '</span></span>';
      b.addEventListener('click', function () { jump(st.key); });
      bar.appendChild(b);
    });
    return bar;
  }

  // Deterministic, idempotent placement: stepper FIRST, then problem strip, then
  // allergy strip, then .vx-grid. Guard checks the SAME anchor we insert before, so
  // once placed the stepper never moves again.
  function place(bar, grid) {
    var ref = grid;
    var algy = document.getElementById(ALLERGY_ID);
    if (algy && algy.parentNode === grid.parentNode) ref = algy;
    var prob = document.getElementById(PROBLEM_ID);
    if (prob && prob.parentNode === grid.parentNode) ref = prob;
    if (bar.parentNode !== grid.parentNode || bar.nextSibling !== ref) {
      grid.parentNode.insertBefore(bar, ref);
    }
  }

  function render() {
    if (window.__mlsVisitStepperOrderFix && window.__mlsVisitStepperOrderFix.__reverted) return;
    var grid = document.querySelector('.vx-grid');
    var bar = document.getElementById(BAR_ID);
    if (!visitVisible() || !grid) { if (bar) bar.style.display = 'none'; return; }

    if (!bar || bar.__mlsOrderFixOwned !== true) { bar = build(); }
    place(bar, grid);
    bar.style.display = '';

    var st = computeState();
    var sig = JSON.stringify(st);
    if (sig === lastState) return;
    lastState = sig;

    STEPS.forEach(function (s) {
      var btn = bar.querySelector('.mlsstp[data-step="' + s.key + '"]');
      if (!btn) return;
      btn.classList.toggle('is-done', !!st.done[s.key]);
      btn.classList.toggle('is-now', st.now === s.key);
      var num = btn.querySelector('.mlsstp-num');
      if (num) num.textContent = st.done[s.key] ? '✓' : (STEPS.indexOf(s) + 1);
    });
  }

  function start() {
    neutralizeOriginal();
    css();
    render();
    if (timer) clearInterval(timer);
    timer = setInterval(render, 900);
  }

  window.__mlsVisitStepperOrderFix = {
    __live: true,
    __reverted: false,
    render: render,
    revert: function () {
      this.__reverted = true;
      this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      var b = document.getElementById(BAR_ID);
      if (b && b.parentNode) b.parentNode.removeChild(b);
      var st = document.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
      // Re-enable the original module so prior behaviour is restored.
      try { if (orig) { orig.__reverted = false; } } catch (e) {}
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
