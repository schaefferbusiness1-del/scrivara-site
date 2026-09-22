#!/usr/bin/env node
'use strict';
/* vst-1.0.0 latin1 index-splice for background.js (the only lawful editor for
 * this mixed-EOL file). Codex red contract visits-surface-targeting: the
 * injected Visits driver (mlsVisitsDriverFn/openVisits) may navigate only a
 * UNIQUE, visibly-scoped Visits rail; generic encounter-shaped DOM proves
 * nothing; and a deep encounter frame never wanders through browser history.
 * Every target is matched LF-first then CRLF and the replacement inherits the
 * matched form; each must occur exactly once or the script refuses. */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'background.js');
let t = fs.readFileSync(file, 'latin1');

function splice(label, oldStr, newStr) {
  for (const eol of ['\n', '\r\n']) {
    const o = oldStr.replace(/\n/g, eol);
    const first = t.indexOf(o);
    if (first < 0) continue;
    if (t.indexOf(o, first + 1) >= 0) throw new Error(label + ': target not unique');
    t = t.slice(0, first) + newStr.replace(/\n/g, eol) + t.slice(first + o.length);
    console.log('spliced', label, eol === '\n' ? '(LF)' : '(CRLF)');
    return;
  }
  throw new Error(label + ': target not found in either EOL form');
}

/* ---- 1. the rail pick refuses ambiguity instead of guessing ---- */
splice('unique-rail selection',
`      var tab = null;
      for (var oi = 0; oi < icons.length; oi++) {
        try {
          var cand = icons[oi].closest && icons[oi].closest('li.chart-tabs__list-item');
          if (!cand) continue;
          var rr = cand.getBoundingClientRect();
          if (rr.width > 1 && rr.height > 1) { tab = cand; break; }
          if (!tab) tab = cand;
        } catch (e1) {}
      }`,
`      /* vst-1.0.0: collect every DISTINCT rendered rail candidate. Two
         visible Visits rails (dual chart panes, a decoy) are a refusal by
         name, never a guess - the same uniqueness law wcl-1.0.x enforces on
         the app-side click paths. */
      var tab = null, vstRendered = [], vstHiddenOnly = null;
      for (var oi = 0; oi < icons.length; oi++) {
        try {
          var cand = icons[oi].closest && icons[oi].closest('li.chart-tabs__list-item');
          if (!cand) continue;
          var rr = cand.getBoundingClientRect();
          if (rr.width > 1 && rr.height > 1) { if (vstRendered.indexOf(cand) < 0) vstRendered.push(cand); }
          else if (!vstHiddenOnly) vstHiddenOnly = cand;
        } catch (e1) {}
      }
      if (vstRendered.length > 1) return { ok: false, reason: 'visits-tab-ambiguous', candidates: vstRendered.length };
      tab = vstRendered[0] || vstHiddenOnly;`);

/* ---- 2. generic encounter-shaped DOM is not Visits-surface proof ---- */
splice('scoped surface proof',
`      var visitsSurfaceOpen = false;
      try { visitsSurfaceOpen = !!document.querySelector('li.encounter-list-item'); } catch (eVsOpen) {}`,
`      var visitsSurfaceOpen = false;
      try {
        /* vst-1.0.0: an encounter-shaped row proves the OPEN VISITS surface
           only when it sits under a visits-scoped ancestor. A bare
           li.encounter-list-item anywhere in the chart (orders, documents,
           a decoy pane) proves nothing - the rail is re-driven instead,
           which on a truly-open panel is the click the 3.0.2 collapse note
           already tolerates on an inactive tab. */
        var vsRow = document.querySelector('li.encounter-list-item');
        visitsSurfaceOpen = !!(vsRow && vsRow.closest && vsRow.closest('[class*="visits" i],[id*="visits" i],.chart-tabs__tab-content,[class*="encounter-list" i]'));
      } catch (eVsOpen) {}`);

/* ---- 3. a deep encounter frame never wanders through history ---- */
splice('no history wandering',
`          if (rstHref) { try { location.assign(rstHref); return { ok: true, recovered: 'briefing-link' }; } catch (eRstG) {} }
          try { history.back(); return { ok: true, recovered: 'history-back' }; } catch (eRstB) {}
        }
        return { ok: false, reason: 'visits-tab-not-found' };`,
`          if (rstHref) { try { location.assign(rstHref); return { ok: true, recovered: 'briefing-link' }; } catch (eRstG) {} }
          /* vst-1.0.0: history.back() from a deep encounter frame is
             UNVALIDATED navigation - where it lands depends on how the walk
             got here, and a wrong landing reads a wrong surface. Without an
             exact briefing link this frame refuses by name; the orchestrator's
             own re-open path (a fresh verified chart open) is the recovery. */
          return { ok: false, reason: 'visits-rail-unreachable-deep-encounter' };
        }
        return { ok: false, reason: 'visits-tab-not-found' };`);

fs.writeFileSync(file, t, 'latin1');
console.log('background.js spliced; bytes now', t.length);
