'use strict';

/* RECORD IS NEVER REFUSED BY AN UNPROVEN SCHEDULE BINDING - owner report
 * 2026-07-26: with "This row is missing its exact Athena appointment ID"
 * showing, clicking Record did nothing. The warning's own text promises it
 * gates "Athena verification or send" - but lockAndStart's unproven-binding
 * branch returned BEFORE the opts.record click, so every entry point that
 * routes through it (home hero, row actions, ez3Now/ez3Nxt/ez3Next) was a
 * silent no-op. Recording and generation are LOCAL (the b438 note): the
 * branch must route them through requireExactScheduledBinding - the owner's
 * 2026-07-24 "blocking is BS" demotion gate (proceed unscheduled + visible
 * warning; block only a PROVEN cross-patient conflict) - exactly as ez3Rec2
 * and the voice paths already do.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* the FIRST lockAndStart copy is the one with the binding machinery */
const start = connect.indexOf('function lockAndStart(a, opts) {');
assert(start !== -1, 'lockAndStart must exist');
const end = connect.indexOf('function lockAndStartPatient', start);
const body = connect.slice(start, end);

assert(body.includes('exactBindingReady'),
  'the exact-binding check must still exist - this contract scopes it, never deletes it');
assert(/if\s*\(!exactBindingReady\)\s*\{\s*\n\s*if\s*\(!opts\.record\s*&&\s*!opts\.generate\)\s*\{\s*render\(\);\s*return;\s*\}/.test(body),
  'a plain open (no record/generate) keeps the warn-and-stop behavior');
assert(body.includes("requireExactScheduledBinding(a, opts.record ? 'recording' : 'note generation')"),
  'record/generate under an unproven binding must route through the demotion gate, not return');
assert(!/if\s*\(!exactBindingReady\)\s*\{\s*render\(\);\s*return;\s*\}/.test(body),
  'the bare blocking return (warn, render, stop - before opts.record) must stay retired');

/* the demotion gate itself keeps both halves of the ruling */
const gate = connect.slice(connect.indexOf('function requireExactScheduledBinding'),
  connect.indexOf('function lockAndStart(a, opts)'));
assert(gate.includes('Athena appointment not linked') && gate.includes('recording and note generation still work normally'),
  'the demotion gate must calmly explain that an Athena link is optional for recording/generation');
assert(gate.includes('DIFFERENT patient'),
  'the demotion gate must still block a proven cross-patient conflict');
assert(connect.includes("calmNotice ? 'ez3-infobar' : 'ez3-warnbar'") && connect.includes("(calmNotice ? '' : '⚠️ ')"),
  'the calm schedule notice must use neutral information presentation without a warning icon');
assert(!connect.includes('⚠️ Proceeding as an UNSCHEDULED visit'),
  'the retired double-warning Athena copy returned');
