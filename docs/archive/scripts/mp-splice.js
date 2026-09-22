/* mp-1.0 (3.0.55) - department-scope primitives for multi-provider coverage.
 * Passive census 2026-08-09 (15 frames, owner's dashboard): the Day-view widget
 * has NO within-view provider filter; the ONLY drivable scope control is the
 * DEPARTMENTID select (216 options, frameset child frame). So multi-provider =
 * department switching. These are PRIMITIVES ONLY - inert until si calls them:
 * policy (always-restore on every exit, never while the owner works, switch =
 * day-flip with full re-binding) lives si-side in the managed pull lifecycle.
 * deptSet fails CLOSED on an unknown value and never auto-navigates. */
const fs = require('fs');
const F = 'background.js';
let s = fs.readFileSync(F, 'latin1');
const before = s.length;
function must(anchor, label) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR ' + label + ' count=' + n); process.exit(1); }
  return s.indexOf(anchor);
}

const A = "    if (op === 'diagnose') { return diagnose(); }";
must(A, 'A-op-family');
const ops =
`    if (op === 'deptGet') {
      /* mp-1.0: read the session department scope from THIS frame. Department
         names are practice metadata, not PHI. options ride only when the
         caller asks (cfg.deptList) - the census is one config-time read. */
      var dgSel = document.getElementById('DEPARTMENTID');
      if (!dgSel || String(dgSel.tagName) !== 'SELECT') return { ok: true, present: false };
      var dgOut = { ok: true, present: true, value: String(dgSel.value || ''), selectedText: String((dgSel.options[dgSel.selectedIndex] || {}).text || '').slice(0, 60), count: dgSel.options.length };
      if (cfg && cfg.deptList === true) {
        var dgL = [];
        for (var dgI = 0; dgI < dgSel.options.length && dgI < 300; dgI++) dgL.push({ v: String(dgSel.options[dgI].value || ''), t: String(dgSel.options[dgI].text || '').slice(0, 48) });
        dgOut.options = dgL;
      }
      return dgOut;
    }
    if (op === 'deptSet') {
      /* mp-1.0: set the session department scope in THIS frame. The target
         value rides the driver's third positional (idx). Fails CLOSED unless
         the value exists among the select's own options; returns prev so the
         si orchestration can restore on EVERY exit path. Fires input+change
         only - whatever navigation athena wires to that select is athena's,
         and the caller must treat the switch as a DAY-FLIP (re-bind all). */
      var dsSel = document.getElementById('DEPARTMENTID');
      if (!dsSel || String(dsSel.tagName) !== 'SELECT') return { ok: false, reason: 'dept-select-not-in-frame' };
      var dsTarget = String(idx || '');
      if (!dsTarget) return { ok: false, reason: 'dept-target-missing' };
      var dsFound = false;
      for (var dsI = 0; dsI < dsSel.options.length; dsI++) { if (String(dsSel.options[dsI].value || '') === dsTarget) { dsFound = true; break; } }
      if (!dsFound) return { ok: false, reason: 'dept-target-not-an-option' };
      var dsPrev = String(dsSel.value || '');
      if (dsPrev === dsTarget) return { ok: true, prev: dsPrev, now: dsPrev, changed: false };
      try {
        dsSel.value = dsTarget;
        try { dsSel.dispatchEvent(new Event('input', { bubbles: true })); } catch (eDsI) {}
        dsSel.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (eDs) { return { ok: false, reason: 'dept-set-failed', prev: dsPrev }; }
      return { ok: true, prev: dsPrev, now: String(dsSel.value || ''), changed: true };
    }
${A}`;
s = s.slice(0, s.indexOf(A)) + ops.slice(0, ops.length - A.length) + s.slice(s.indexOf(A));

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED mp-1.0 bytes ' + before + ' -> ' + s.length);
