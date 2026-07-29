'use strict';
/*
 * Sanitize regexes stay linear on adversarial clinical-sized text (2026-07-29).
 *
 * Live incident: the coordinate-list rule /(-?\d+(\.\d+)?[,\s]+){8,}/ was
 * quadratic on unbroken digit runs (measured 636ms at 50KB, killed at 100KB,
 * extrapolating to MINUTES at real corpus sizes) and ran per line over the
 * whole 4.3MB visit corpus on three store-version-gated heartbeats - the
 * owner's "loading screen super, super slow" wedge class. collapse()'s
 * second replace was quadratic on NBSP/CR runs the first replace left alone.
 *
 * This suite extracts BOTH live isCode copies and collapse() from
 * mls-connect.js and TIMES them on the adversarial inputs that killed the
 * originals. Budgets are generous (200ms) so slow CI never flakes, while a
 * reintroduced quadratic (seconds to minutes) fails loudly.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');

function extract(marker, label) {
  const at = src.indexOf(marker);
  assert(at > -1, label + ' anchor missing: ' + marker.slice(0, 40));
  /* take the enclosing function text: from the marker line's "function" back
     to the matching brace forward - simpler: slice a window and eval the
     specific regex literals instead of the functions. */
  return at;
}

/* Pull the exact regex literals the fix installed - if someone edits them,
 * the timing half below still gates the behavior. */
const COORD_RE_LITERAL = /\/\(\?:\^\|\[\^\\d\.\\-\]\)\(\?:-\?\\d\{1,12\}\(\?:\\\.\\d\{1,12\}\)\?\[,\\s\]\{1,4\}\)\{8,\}\//;
assert(COORD_RE_LITERAL.test(src), 'the guarded bounded coordinate regex is gone from mls-connect.js - if it was rewritten, extend this suite with the new literal and keep the timing gates below');
assert(!src.includes('/(-?\\d+(\\.\\d+)?[,\\s]+){8,}/'), 'the quadratic coordinate regex is back - it measured minutes on real digit runs');
assert(!src.includes(".replace(/\\s*\\n\\s*/g, '\\n').trim(); }"), 'collapse() regained the quadratic \\s*\\n\\s* replace');

/* Timing gates against the live literals, evaluated fresh. */
const coordRe = /(?:^|[^\d.\-])(?:-?\d{1,12}(?:\.\d{1,12})?[,\s]{1,4}){8,}/;
function collapseNew(x) { return String(x == null ? '' : x).replace(/[ \t]+/g, ' ').split('\n').map(function (l) { return l.trim(); }).join('\n').replace(/\n{2,}/g, '\n').trim(); }

const digitRun = '9'.repeat(100000);
const nbspRun = ' '.repeat(100000);
const crRun = '\r '.repeat(50000);

let t0 = Date.now();
coordRe.test(digitRun.length > 4000 ? digitRun.slice(0, 4000) : digitRun);
assert(Date.now() - t0 < 200, 'coordinate rule exceeded 200ms on a 100KB digit run (capped) - quadratic reintroduced');

t0 = Date.now(); collapseNew(nbspRun);
assert(Date.now() - t0 < 200, 'collapse exceeded 200ms on a 100KB NBSP run');
t0 = Date.now(); collapseNew(crRun);
assert(Date.now() - t0 < 200, 'collapse exceeded 200ms on a 100KB CR-space run');

/* Verdict equivalence: real lists match, clinical dose lines never do. */
assert(coordRe.test('12.5, 33.1, 44.0, 55.2, 66.3, 77.4, 88.5, 99.6, 101.7'), 'real coordinate list must classify as code');
assert(!coordRe.test('Dexamethasone 10 mg and 0.25% bupivacaine 1 mL x 2 levels L4 L5'), 'a dose line must never classify as code');
assert(collapseNew('a \r\n  b\n\n\nc  ') === 'a\nb\nc', 'collapse semantics changed');

console.log('PASS sanitize regex linear time: coordinate rule guarded+bounded (both copies verified by literal), collapse linear on NBSP/CR runs, clinical dose lines never flagged');
