#!/usr/bin/env node
'use strict';
/* wcl-1.0.0 latin1 index-splice for background.js (the ONLY lawful editor for
 * this mixed-EOL file). Three exact-substring replacements; each must occur
 * exactly once or the splice refuses and writes nothing. */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'background.js');
let t = fs.readFileSync(file, 'latin1');

function splice(label, oldStr, newStr) {
  /* this region of background.js is uniformly CRLF; the templates above are
   * written with \n for readability and normalized here */
  oldStr = oldStr.replace(/\n/g, '\r\n');
  newStr = newStr.replace(/\n/g, '\r\n');
  const first = t.indexOf(oldStr);
  if (first < 0) throw new Error(label + ': target not found');
  if (t.indexOf(oldStr, first + 1) >= 0) throw new Error(label + ': target not unique');
  t = t.slice(0, first) + newStr + t.slice(first + oldStr.length);
  console.log('spliced', label, 'at byte', first);
}

/* ---- 1. clickRailByAttr: unique rail-verified candidate or honest refusal ---- */
splice('clickRailByAttr',
`    function clickRailByAttr(sectionId) {
      try {
        var lis = W.document.querySelectorAll('li.chart-tabs__list-item[data-chart-section-id="' + sectionId + '"],[data-chart-section-id="' + sectionId + '"]');
        for (var qi = 0; qi < lis.length; qi++) {
          var li = lis[qi];
          if (!visEl(li)) continue;
          var lbl = String((li.getAttribute && (li.getAttribute('aria-label') || li.getAttribute('data-icon-caption'))) || li.textContent || '').replace(/\\s+/g, ' ').trim();
          if (BAD.test(lbl)) continue;
          realClick(li);
          return true;
        }
      } catch (eA) {}
      return false;
    }`,
`    /* wcl-1.0.0 (Codex static map + owner "clicks around" live repro,
       2026-08-25): clicking the FIRST visible [data-chart-section-id] match
       let a same-attribute node OUTSIDE the chart rail take the click - the
       v2.01 recovery below documents it landing on athena's top-nav Calendar
       menu. A candidate now counts only when it sits in a PROVEN chart rail:
       a chart-tabs list item (or inside the chart-tabs container), the same
       left-edge geometry the label scan enforces, and at least two SIBLING
       section ids in the same container so a lone decoy cannot pass. Exactly
       one survivor is clicked; more than one returns 'ambiguous' - an honest
       refusal BEFORE any click; zero survivors falls back to the label scan,
       which has its own left-rail guard. */
    function clickRailByAttr(sectionId) {
      try {
        var lis = W.document.querySelectorAll('li.chart-tabs__list-item[data-chart-section-id="' + sectionId + '"],[data-chart-section-id="' + sectionId + '"]');
        var seen = [], survivors = [];
        for (var qi = 0; qi < lis.length; qi++) {
          var li = lis[qi];
          var dup = false;
          for (var di = 0; di < seen.length; di++) { if (seen[di] === li) { dup = true; break; } }
          if (dup) continue;
          seen.push(li);
          if (!visEl(li)) continue;
          var lbl = String((li.getAttribute && (li.getAttribute('aria-label') || li.getAttribute('data-icon-caption'))) || li.textContent || '').replace(/\\s+/g, ' ').trim();
          if (BAD.test(lbl)) continue;
          var rail = null;
          try { rail = li.closest ? li.closest('ul.chart-tabs__list,.chart-tabs,[class*="chart-tabs"]') : null; } catch (eRail) { rail = null; }
          var inRailList = !!rail || /chart-tabs__list-item/.test(String(li.className || ''));
          if (!inRailList) continue;
          var rect = null;
          try { rect = li.getBoundingClientRect(); } catch (eRect) { rect = null; }
          if (!rect || rect.left > 260) continue;
          var sibScope = rail || li.parentElement || li;
          var sibs = 0;
          try {
            var sibIds = ['browse', 'allergies', 'problems', 'medications', 'vitals', 'results', 'history'];
            for (var si = 0; si < sibIds.length; si++) {
              if (sibIds[si] === sectionId) continue;
              if (sibScope.querySelector && sibScope.querySelector('[data-chart-section-id="' + sibIds[si] + '"]')) sibs++;
            }
          } catch (eSib) { sibs = 0; }
          if (sibs < 2) continue;
          survivors.push(li);
        }
        if (survivors.length === 1) { realClick(survivors[0]); return true; }
        if (survivors.length > 1) return 'ambiguous';
      } catch (eA) {}
      return false;
    }`);

/* ---- 2. the click ladder: ambiguity is terminal, never guessed around ---- */
splice('rail ladder',
`    var clicked = false;
    var railDeadline = Date.now() + 12000; /* absolute deadline, short sleeps */
    while (!clicked && Date.now() < railDeadline) {
      clicked = clickRailByAttr('visits') || clickRailLabel('Visits');
      if (!clicked) await sleep(700);
    }
    if (!clicked) return { ok: false, reason: 'no-rail', chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', error: 'The left-rail "Visits" item was not found on the open chart. Refusing to read any other surface as if it were the verified Visits pane (wf_6) - nothing was captured.' };`,
`    var clicked = false, railAmbiguous = false;
    var railDeadline = Date.now() + 12000; /* absolute deadline, short sleeps */
    while (!clicked && Date.now() < railDeadline) {
      var attrRes = clickRailByAttr('visits');
      if (attrRes === true) { clicked = true; break; }
      if (attrRes === 'ambiguous') { railAmbiguous = true; break; } /* wcl-1.0.0: refuse before click */
      clicked = clickRailLabel('Visits');
      if (!clicked) await sleep(700);
    }
    if (railAmbiguous) return { ok: false, reason: 'rail-ambiguous', chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', error: 'More than one verified-looking left-rail "Visits" target is on screen, so MLS refused to guess which chart it belongs to (wcl-1.0.0) - nothing was clicked or captured. Close extra chart panels or windows in athenaOne, then retry.' };
    if (!clicked) return { ok: false, reason: 'no-rail', chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', error: 'The left-rail "Visits" item was not found on the open chart. Refusing to read any other surface as if it were the verified Visits pane (wf_6) - nothing was captured.' };`);

/* ---- 3. the v2.01 recovery re-click: an ambiguous attr result must not fall
 * through to a blind label click either ---- */
splice('recovery re-click',
`      try { clickRailByAttr('visits') || clickRailLabel('Visits'); } catch (eRe) {}`,
`      try { if (clickRailByAttr('visits') === false) clickRailLabel('Visits'); } catch (eRe) {} /* wcl-1.0.0: 'ambiguous' refuses the recovery click too */`);

fs.writeFileSync(file, t, 'latin1');
console.log('background.js spliced; bytes now', t.length);
