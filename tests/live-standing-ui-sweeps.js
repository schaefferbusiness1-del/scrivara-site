'use strict';

/*
 * TWO STANDING UI SWEEPS - the recurring defect classes, turned into instruments.
 *
 * WHY THESE TWO AND NOT OTHERS. Both were promoted from one-off investigations after
 * the same class of defect appeared repeatedly:
 *
 *   DRAWN BUT UNREACHABLE. A control that renders, measures a healthy rectangle, and
 *   still cannot be clicked because something is on top of it. This project has hit it
 *   as "present, correct, unreachable" three separate times, and earlier as "FOCUSED is
 *   not CLICKABLE" - scrollIntoView({block:'nearest'}) parks a control flush with the
 *   viewport bottom, where a fixed bubble covers it: on screen, focused, and 78%
 *   unclickable. Geometry alone always said it was fine.
 *
 *   DUPLICATE VISIBLE CONTROLS. The owner asked "WHY IS THERE 2 GENERATE NITES HERE".
 *   Investigating that ONE pair cost a full agent and found the wrong pair twice. The
 *   general form - every visible label that appears on more than one control at the same
 *   time - answers the next instance without a new investigation.
 *
 * THIS FILE IS NOT A GATED SUITE AND MUST NOT BE ADDED TO run-all.js. Both questions are
 * about LAYOUT and HIT TESTING, which need a real engine; jsdom performs no layout, so a
 * node-side assertion here could only ever be theatre. It follows the tests/live-*.js
 * convention: a standalone instrument, run against a real browser, outside the gate.
 *
 * THE SWEEPS ARE EXPORTED AS SOURCE STRINGS so the same logic can be injected by any
 * harness (the heavy synthetic-Chrome audits in this folder, a devtools paste, or the
 * one-pass console script) instead of being reimplemented per caller and drifting.
 *
 *   node tests/live-standing-ui-sweeps.js --print     emit paste-ready browser code
 *   require('./live-standing-ui-sweeps').SWEEP_SRC    inject into an existing harness
 *
 * INSTRUMENT HONESTY, which is the entire point of this file:
 *   - It refuses to report anything when innerWidth is 0. A hidden or background tab
 *     reports a zero viewport, every rect becomes a wrapped-text artifact, and every
 *     height lies. The sweep returns a VOID marker instead of plausible numbers.
 *   - It carries a POSITIVE CONTROL. Before believing "no unreachable controls", it
 *     proves the probe can SEE unreachability by planting a covered element, measuring
 *     it, and removing it. A sweep that cannot detect a defect it created has no
 *     standing to report the absence of defects it did not.
 */

const CHECK_VIEWPORT = `
  if (!window.innerWidth || !window.innerHeight) {
    return { VOID: 'viewport is 0x0 - this tab is hidden or backgrounded. Every rectangle ' +
      'would be a wrapped-text artifact. Foreground the tab and re-run.' };
  }`;

/* ---------------------------------------------------------------- sweep 1 */
const DRAWN_BUT_UNREACHABLE_SRC = `(function drawnButUnreachable() {
${CHECK_VIEWPORT}

  function centreHit(el) {
    var r = el.getBoundingClientRect();
    var cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return { offscreen: true };
    var hit = null;
    try { hit = document.elementFromPoint(cx, cy); } catch (e) { return { error: true }; }
    if (!hit) return { nothing: true };
    /* an ancestor or descendant at the centre still routes the click to the control */
    if (hit === el || el.contains(hit) || hit.contains(el)) return { ok: true };
    return { blocked: true, by: (hit.id || hit.tagName + '.' + String(hit.className || '').slice(0, 24)),
             byZ: (function () { try { return getComputedStyle(hit).zIndex; } catch (e) { return '?'; } })() };
  }

  /* POSITIVE CONTROL - prove the probe can see an unreachable control before we let it
     claim there are none. Plant a button, cover it with a higher-z overlay, measure. */
  var control = { ran: false, detected: false };
  try {
    var host = document.createElement('div');
    host.setAttribute('data-sweep-control', '1');
    host.style.cssText = 'position:fixed;left:10px;top:10px;width:120px;height:40px;z-index:2147480000;';
    var victim = document.createElement('button');
    victim.textContent = 'sweep control';
    victim.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    var lid = document.createElement('div');
    lid.style.cssText = 'position:absolute;inset:0;z-index:2147481000;background:rgba(0,0,0,.01);';
    host.appendChild(victim); host.appendChild(lid);
    (document.body || document.documentElement).appendChild(host);
    control.ran = true;
    control.detected = !!centreHit(victim).blocked;
    host.parentNode.removeChild(host);
  } catch (e) { control.error = String(e).slice(0, 80); }

  var out = { positiveControl: control, findings: [], scanned: 0 };
  if (!control.detected) {
    out.UNTRUSTWORTHY = 'the positive control was NOT detected as blocked - this probe cannot ' +
      'see unreachability, so an empty findings list below means nothing';
  }

  var els = [].slice.call(document.querySelectorAll('button,a[href],input,select,textarea,[role=button],summary,[onclick]'));
  els.forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;              /* not drawn at all */
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    if (Number(cs.opacity) === 0) return;
    if (cs.pointerEvents === 'none') return;                 /* deliberately inert */
    out.scanned++;
    var h = centreHit(el);
    if (h.blocked) {
      out.findings.push({
        id: el.id || null,
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 30),
        label: String(el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
        box: [Math.round(r.width), Math.round(r.height)],
        at: [Math.round(r.x), Math.round(r.y)],
        blockedBy: h.by,
        blockerZIndex: h.byZ
      });
    }
  });
  out.summary = out.findings.length + ' of ' + out.scanned + ' visible controls are drawn but not clickable at their own centre';
  return out;
})()`;

/* ---------------------------------------------------------------- sweep 2 */
const DUPLICATE_VISIBLE_CONTROLS_SRC = `(function duplicateVisibleControls() {
${CHECK_VIEWPORT}

  function norm(el) {
    return String(el.textContent || el.value || el.getAttribute('aria-label') || '')
      .replace(/\\s+/g, ' ').trim().toLowerCase();
  }
  /* A TOAST IS NOT A SECOND COPY OF THE SCREEN'S CONTROLS.
     Transient notice cards carry their own dismiss "×", and while one is on
     screen every dialog in the app appears to have two close buttons. Measured:
     the op-note Templates tab and Settings were each reported as having a
     duplicate "×" because a .mls-sv-card save-verify toast happened to be up -
     a toast that retires itself seconds later, in a different corner, dismissing
     a different thing. The duplicate-control check is about two controls that
     both belong to the surface and compete for the same intent; a notice belongs
     to no surface. Excluded by container, not by label, so a real duplicate that
     merely happens to say "×" is still caught. */
  var TRANSIENT = '.mls-sv-card, #mlsMobileNoticeShelf, #toast, .toast, [role=alert], [role=status], .mls-toast, #mlsBusyPill';
  /* A MODAL AND THE PAGE BEHIND IT ARE NOT ONE SCREEN.
     While a dialog is open the page behind it is covered by the scrim and
     cannot be clicked, so a label appearing once in the dialog and once behind
     it is not a doctor's choice between two controls - it is one control and a
     backdrop. Measured: with the op-note Templates tab open, "history" was
     reported as a duplicate at all four viewports, pairing the template
     library's own button with the #mlsRightNow patient-History segment on the
     page underneath - at 1440x900 that second control sat at y=-1032, a
     thousand pixels above the top of the window.
     When a dialog is open, only what is INSIDE an open dialog is a candidate.
     With no dialog open the whole page is, exactly as before.

     The scope list can NEST - the op-note room reparents #templatesModal inside
     itself, so two .modal-bg.show ancestors contain the very same buttons - and
     collecting per root without de-duplicating reported every control on the
     tab as its own twin, at identical coordinates. Identity, not markup, is
     what makes two controls two. */
  var openModals = [].slice.call(document.querySelectorAll('.modal-bg.show'));
  var scope = openModals.length ? openModals : [document];
  var seen = {};
  var els = [];
  scope.forEach(function (rootEl) {
    [].slice.call(rootEl.querySelectorAll('button,a[href],[role=button],summary')).forEach(function (el) {
      if (els.indexOf(el) < 0) els.push(el);
    });
  });
  els.forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return;
    try { if (el.closest(TRANSIENT)) return; } catch (e) {}
    var k = norm(el);
    if (!k) return;
    (seen[k] = seen[k] || []).push({
      id: el.id || null,
      cls: String(el.className || '').slice(0, 28),
      box: [Math.round(r.width), Math.round(r.height)],
      at: [Math.round(r.x), Math.round(r.y)],
      disabled: !!el.disabled
    });
  });

  var dups = Object.keys(seen).filter(function (k) { return seen[k].length > 1; })
    .map(function (k) { return { label: k.slice(0, 50), count: seen[k].length, controls: seen[k] }; })
    .sort(function (a, b) { return b.count - a.count; });

  /* A near-duplicate is the one the owner actually complained about: two controls whose
     labels are not identical but share a leading verb phrase, e.g. "generate note" and
     "generate note from 3 selected recordings". Identical-label matching would miss it. */
  var keys = Object.keys(seen);
  var near = [];
  for (var i = 0; i < keys.length; i++) {
    for (var j = i + 1; j < keys.length; j++) {
      var a = keys[i], b = keys[j];
      if (a === b) continue;
      var pa = a.split(' ').slice(0, 2).join(' '), pb = b.split(' ').slice(0, 2).join(' ');
      if (pa.length >= 6 && pa === pb) near.push({ a: a.slice(0, 44), b: b.slice(0, 44), sharedPrefix: pa });
    }
  }

  return {
    exactDuplicates: dups,
    nearDuplicates: near.slice(0, 12),
    summary: dups.length + ' label(s) on more than one visible control; ' +
             near.length + ' pair(s) share a leading two-word phrase'
  };
})()`;

const SWEEP_SRC = '(function(){ return {' +
  ' drawnButUnreachable: ' + DRAWN_BUT_UNREACHABLE_SRC + ',' +
  ' duplicateVisibleControls: ' + DUPLICATE_VISIBLE_CONTROLS_SRC +
  ' }; })()';

module.exports = { DRAWN_BUT_UNREACHABLE_SRC, DUPLICATE_VISIBLE_CONTROLS_SRC, SWEEP_SRC, CHECK_VIEWPORT };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.indexOf('--print') !== -1) {
    process.stdout.write(SWEEP_SRC + '\n');
  } else {
    process.stdout.write(
      'Two standing UI sweeps (browser instruments, deliberately NOT in run-all.js).\n\n' +
      '  --print            emit paste-ready browser code for a devtools console\n' +
      "  require(...)       use .SWEEP_SRC to inject into an existing live-* harness\n\n" +
      'Both refuse to report when the viewport is 0x0, and the unreachability sweep runs a\n' +
      'POSITIVE CONTROL first: it plants a covered button and proves it can detect the\n' +
      'blockage before it is allowed to claim no controls are blocked.\n'
    );
  }
}
