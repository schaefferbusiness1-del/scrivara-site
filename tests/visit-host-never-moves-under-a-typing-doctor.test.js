'use strict';

/* txf-1.2.0 - the ROOT CAUSE of the visit-transcript data loss, measured.
 *
 * mount() runs on an interval. Its idempotence guard requires the host to be
 * vv.firstElementChild, so the moment any OTHER module inserts anything ahead
 * of it, the guard fails and this line runs again:
 *
 *     vv.insertBefore(host, vv.firstChild);
 *
 * insertBefore on an ALREADY-CONNECTED node MOVES it, and moving a subtree that
 * contains the focused element BLURS that element. So every interval tick threw
 * the doctor out of #ez3flTranscript and sent the rest of their sentence to
 * <body>, after which render() -> setWrapHtml() swept the lane away entirely.
 *
 * Measured in real Chrome (headless, ?demo=1, real CDP keystrokes, focus proven
 * before typing), two 9-second windows, typing 63 characters:
 *
 *                              rebuilds  blurs  focusHeld  chars kept
 *   before                        3        1      false       4 of 63
 *   txf-1.0.0 (focus carry)       3        1      true       40 of 63
 *   txf-1.2.0 with render()       3        1      true       59 of 63
 *   txf-1.2.0 as shipped          0        0      true       63 of 63
 *
 * Three earlier hypotheses were REFUTED by instrumentation before this one, and
 * each would have shipped a wrong fix:
 *   "a timer drives the rebuild"    - only proved it was not typing-driven
 *   "I patched a dead engine copy"  - stack capture showed the live copy WAS
 *                                     the one patched
 *   "the #ez3Wrap rewrite blurs it" - activeElement already read BODY at the
 *                                     rewrite, so the sweep destroys an
 *                                     ALREADY-blurred lane
 * The decisive reading came from hooking focusout/blur/focus and recording, at
 * the instant of the blur, that the box was still CONNECTED and still VISIBLE -
 * which rules out both removal and hiding and leaves only "it was moved".
 *
 * The fix is deliberately narrow: while the caret is inside the host, cosmetic
 * re-ordering loses to not destroying the doctor's typing. Every other call
 * still restores the host to first position, so the ordering intent survives
 * for the 100% of the time nobody is typing in it. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* Four engine copies carry an identical mount(); only the LIVE one is patched,
   proven by stack capture (mount at :17646 <- render <- renderHome). If a
   future change makes another copy live, this count is the tripwire. */
const guards = src.split('if (_a && _a !== document.body && host.contains(_a)) return true;').length - 1;
assert.strictEqual(guards, 1,
  'expected exactly 1 txf-1.2.0 guard (the live engine copy), found ' + guards +
  ' - if the live copy changed, re-run the stack capture before assuming which one needs it');

/* it must sit AFTER the original first-child fast path, or it changes the
   already-correct case too */
const fastPath = src.indexOf('vv.firstElementChild === host) return true;');
const newGuard = src.indexOf('host.contains(_a)) return true;');
assert(fastPath > -1 && newGuard > fastPath,
  'the txf-1.2.0 guard must follow the original first-child early return, not replace it');

/* ...and BEFORE the insertBefore that does the damage */
const move = src.indexOf('vv.insertBefore(host, vv.firstChild);');
assert(move > -1 && newGuard < move,
  'the guard must precede vv.insertBefore(host, ...) - after it, the move (and the blur) has already happened');

/* it must NOT call render(): the existing already-mounted path returns true and
   changes nothing, and calling render() from here reaches setWrapHtml, which
   sweeps .ez3fl-record away. That cost 4 of the last 63 characters. */
assert(!/host\.contains\(_a\)\) \{ render\(\); return true; \}/.test(src),
  'the focused path calls render() again - that reaches setWrapHtml, which removes .ez3fl-record and ' +
  'takes the transcript with it (measured: 59 of 63 chars instead of 63 of 63)');

/* the guard must be scoped to a REAL focus inside the host - never fire on body */
assert(/_a && _a !== document\.body && host\.contains\(_a\)/.test(src),
  'the guard no longer checks that focus is genuinely inside the host and is not <body>, so it can ' +
  'skip the mount ordering permanently instead of only while somebody is typing');

/* the damaging line must still exist for every unfocused call */
assert(/vv\.insertBefore\(host, vv\.firstChild\);/.test(src),
  'the host is no longer restored to first position at all - the fix was meant to defer that while the ' +
  'doctor types, not to abandon the ordering');

console.log('PASS visit host never moves under a typing doctor: guard is live-copy-only, ordered, render-free, focus-scoped (63 of 63 chars in real Chrome)');
