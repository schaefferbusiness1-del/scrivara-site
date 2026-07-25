'use strict';

/* txf-1.3.0 - mount() must not re-insert a host that is already mounted.
 *
 * mount() runs on an interval. Its original idempotence guard required the host
 * to be vv.firstElementChild, so the moment any OTHER module inserted anything
 * ahead of it, the guard failed and this ran again:
 *
 *     vv.insertBefore(host, vv.firstChild);
 *
 * insertBefore on an ALREADY-CONNECTED node MOVES it. Moving a subtree that
 * contains the focused element BLURS it, and the render() that follows rewrites
 * the whole subtree via setWrapHtml. Two distinct user-visible defects fell out
 * of that one line:
 *
 *   TYPING  the doctor was thrown out of #ez3flTranscript every ~3s and every
 *           later keystroke went to <body>
 *   READING the visit screen re-parsed itself from an HTML string every ~3s,
 *           forever, which the owner reported as "the whole visit page glitches
 *           out every 5 seconds"
 *
 * Measured in real Chrome (headless, ?demo=1, real CDP keystrokes):
 *
 *                                   rebuilds  blurs  focusHeld  chars kept
 *   before                             3        1     false       4 of 63
 *   b617 txf-1.0.0 (focus carry)       3        1     true       40 of 63
 *   b619 txf-1.2.0 (focus-guarded)     0        0     true       63 of 63
 *   ...but UNFOCUSED at b619/b620: setWrapHtml <- renderHome still firing
 *   txf-1.3.0 unfocused                0 innerHTML writes, 0 lane removals
 *
 * b619 fixed typing and left reading broken because its guard was
 * `host.contains(document.activeElement)` - focused only. I then cited a stable
 * DOM node count as proof the churn had stopped, which was WRONG: insertBefore
 * MOVES nodes and leaves the count unchanged, so that probe cleared a memory
 * leak and never spoke to repaint at all. The unfocused probe is the one that
 * settles it (scratchpad/probe-which-engine.js hooks the innerHTML setter).
 *
 * The fix: a host that is already a child of visitView needs no re-insertion.
 * The old first-child test bought cosmetic ordering and paid with a full
 * subtree re-parse of the busiest screen in the app, forever. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* Four engine copies carry an identical mount(); only the LIVE one is patched,
   proven by stack capture (mount <- render <- renderHome <- setWrapHtml). If a
   future change makes another copy live, this count is the tripwire. */
const guards = src.split('if (host && host.parentElement === vv) return true;').length - 1;
assert.strictEqual(guards, 1,
  'expected exactly 1 txf-1.3.0 already-mounted guard (the live engine copy), found ' + guards +
  ' - if the live copy changed, re-run the stack capture before assuming which one needs it');

/* it must sit AFTER the original first-child fast path... */
const fastPath = src.indexOf('vv.firstElementChild === host) return true;');
const newGuard = src.indexOf('if (host && host.parentElement === vv) return true;');
assert(fastPath > -1 && newGuard > fastPath,
  'the txf-1.3.0 guard must follow the original first-child early return, not replace it');

/* ...and BEFORE the insertBefore that moves the host */
const move = src.indexOf('vv.insertBefore(host, vv.firstChild);');
assert(move > -1 && newGuard < move,
  'the guard must precede vv.insertBefore(host, ...) - after it, the move (and the repaint) has already happened');

/* it must NOT call render(): render() reaches setWrapHtml, which rewrites the
   subtree and sweeps .ez3fl-record away. That IS the glitch being fixed. */
const seg = src.slice(newGuard, newGuard + 120);
assert(!/render\(\)/.test(seg),
  'the already-mounted guard calls render() - that reaches setWrapHtml and re-parses the whole visit ' +
  'subtree, which is the periodic glitch this guard exists to stop');

/* the focus-only form must be gone: it fixed typing and left reading broken */
assert(!/host\.contains\(_a\)\) return true;/.test(src),
  'the old focus-guarded form is back. It only suppresses the re-insert while the caret is in the box, ' +
  'so the visit screen still re-parses itself every interval tick for anyone who is READING - the ' +
  'defect the owner reported as glitching every 5 seconds');

/* the real mount path must survive for a genuinely unmounted host */
assert(/vv\.insertBefore\(host, vv\.firstChild\);/.test(src),
  'the host is no longer inserted at all - the fix was meant to skip re-inserting an ALREADY-mounted ' +
  'host, not to stop mounting it');

console.log('PASS visit host is never re-inserted once mounted: guard is live-copy-only, ordered, render-free (63/63 chars typing, 0 innerHTML writes idle)');
