/* feat_mls_visit_stepper.js — item46
 * Visit flow stepper — ties the three Visit columns (Capture, Clinical note, EMR)
 * into ONE guided end-to-end flow with a single shared progress truth, so the
 * separate panels feel like one cohesive product and the doctor always knows
 * where they are and what's next.
 * Steps:  (1) Patient  (2) Visit captured  (3) Note ready  (4) Ready to sign
 * Source of truth (read-only, honest, detectable state):
 *   (1) window.activePatient() has a name
 *   (2) #transcript has real content (>15 chars)
 *   (3) #noteBox has real content (>15 chars)
 *   (4) patient + note both present
 * Clicking a step scrolls to / focuses the matching panel (reuses existing DOM).
 * Additive, reversible: window.__mlsVisitStepper.revert()
 */
(function () {
  if (window.__mlsVisitStepper && window.__mlsVisitStepper.__live) return;

  var BAR_ID = 'mlsVisitStepper';
  var STYLE_ID = 'mlsVisitStepper-style';
  var timer = null;
  var lastState = '';

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
      // done
      '#' + BAR_ID + ' .mlsstp.is-done .mlsstp-num{background:rgba(16,185,129,.18);color:#10b981;border-color:rgba(16,185,129,.35);}',
      '#' + BAR_ID + ' .mlsstp.is-done .mlsstp-lbl{color:#10b981;}',
      // current
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
    // current = first not-done step (that has a sensible predecessor)
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

  function render() {
    if (window.__mlsVisitStepper && window.__mlsVisitStepper.__reverted) return;
    var grid = document.querySelector('.vx-grid');
    var bar = document.getElementById(BAR_ID);
    if (!visitVisible() || !grid) { if (bar) bar.style.display = 'none'; return; }

    if (!bar) { bar = build(); }
    if (bar.parentNode !== grid.parentNode || bar.nextSibling !== grid) {
      // keep the stepper as the first of our inserted bars (above any allergy strip)
      var ref = grid;
      var algy = document.getElementById('mlsAllergyStrip');
      if (algy && algy.parentNode === grid.parentNode) ref = algy;
      grid.parentNode.insertBefore(bar, ref);
    }
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
    css();
    render();
    if (timer) clearInterval(timer);
    timer = setInterval(render, 900);
  }

  window.__mlsVisitStepper = {
    __live: true,
    __reverted: false,
    render: render,
    revert: function () {
      this.__reverted = true;
      this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      var b = document.getElementById(BAR_ID); if (b) b.remove();
      var s = document.getElementById(STYLE_ID); if (s) s.remove();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
