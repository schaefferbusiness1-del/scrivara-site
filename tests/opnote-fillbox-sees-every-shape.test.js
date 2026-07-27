'use strict';

/* THE FIELDS BOX SEES EVERY PLACEHOLDER SHAPE, AND NEVER DIES SILENTLY
 * (onf-2.11.0) - the owner asked "confirm the fill-in-the-blank popups exist
 * and work"; live at b712 they existed but were broken twice over:
 *
 * (A) fillTokens knew [FILL: label] and [[snake]] but not the [CAPS] shape
 *     _genOpNote itself emits - 8 of 10 blanks in a real draft were invisible
 *     to the box while the draft-quarantine scanner counted them.
 * (B) buildFillBox ran inside a bare safe(); one swallowed throw during the
 *     first tick killed the box for the whole session, because the stored
 *     text-signature skipped every retry. Box absent, no console error.
 *
 * Contracts, both directions:
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const onf = fs.readFileSync(path.join(root, 'feat_mls_opnote_fill.js'), 'utf8');

/* 1 - the three shapes are enumerated from ONE source and shared by the two
 * scanners whose disagreement resets field state (fillTokens/renderLayout) */
assert(onf.includes("var CAPS_TOKEN_SRC = '\\\\[([A-Z][A-Z0-9 /&-]{1,28}[A-Z0-9])\\\\]'"),
  'the CAPS shape must be defined once');
assert(onf.split('CAPS_TOKEN_SRC').length - 1 >= 5,
  'fillTokens, renderLayout, sigOf and mainBoxWithBlanks must all use the shared CAPS shape');

/* 2 - executable check: fillTokens extracted into a sandbox must see all
 * three shapes and dedupe repeats */
const ftStart = onf.indexOf('var CAPS_TOKEN_SRC');
const ftEnd = onf.indexOf('function replaceToken');
const helpers = onf.slice(onf.indexOf('function keyToLabel'), onf.indexOf('/* onf-2.5.0'));
const sandbox = { S: v => v == null ? '' : String(v) };
vm.createContext(sandbox);
vm.runInContext(helpers + '\n' + onf.slice(ftStart, ftEnd) + '\nthis.fillTokens=fillTokens;', sandbox);
const tokens = sandbox.fillTokens(
  'A [GAUGE] needle at [LEVELS], [LEVELS] again; [[provider_npi]]; [FILL: fluoro time]; ' +
  'prose [bracketed placeholders] stays; [MLS TEST] matches by shape.');
assert(tokens.indexOf('gauge') >= 0 && tokens.indexOf('levels') >= 0,
  'CAPS placeholders must surface as fields (lowercased labels)');
assert(tokens.indexOf('provider npi') >= 0 && tokens.indexOf('fluoro time') >= 0,
  'the two legacy shapes must keep working');
assert(tokens.filter(t => t === 'levels').length === 1,
  'repeated tokens must dedupe to one field');
assert(tokens.indexOf('bracketed placeholders') < 0,
  'lowercase prose brackets must never become fields');

/* 3 - replaceToken fills the CAPS form too, and only the CAPS form */
vm.runInContext(onf.slice(onf.indexOf('function replaceToken'), onf.indexOf('function noteBoxes')) + '\nthis.replaceToken=replaceToken;', sandbox);
const replaced = sandbox.replaceToken('needle [GAUGE] and [[gauge]] and [FILL: gauge]', 'gauge', '22g');
assert(replaced.indexOf('[GAUGE]') < 0 && replaced.indexOf('[[gauge]]') < 0 && replaced.indexOf('[FILL:') < 0,
  'one value must fill all three forms of the same label');

/* 4b (onf-2.11.1) - the heartbeat's creation must never depend on the first
 * beat: boot ran tick() BARE before setInterval, so one boot-time throw left
 * the whole session tickless. */
assert(/function boot\(\) \{ css\(\); safe\(seedProfile\); safe\(wrapOpeners\); safe\(tick\); iv = setInterval/.test(onf),
  'boot must safe-wrap the first tick so the interval is always created');

/* 4c (onf-2.12.0) - the OPEN MOMENT must not wait for the interval. In the
 * app's real posture (MLS occluded behind athenaOne) Chrome throttles hidden
 * tab intervals to ~1/minute - measured live at b714: visibilityState
 * 'hidden', modal open, ZERO ticks across 5s watches, manual tick instant.
 * The drafter's own openers kick a burst of ticks. */
assert(onf.includes("['openOpPrep', 'openOpPrepForPatient', 'openOpPrepSmart'].forEach"),
  'all three drafter openers must be wrapped to kick the Fields box');
assert(onf.includes('function kickTicks()'),
  'the open-moment kick must exist');
assert(/kickTicks\(\)[\s\S]{0,200}\[150, 700, 2000\]/.test(onf),
  'the kick must ladder several attempts - one 0ms shot still throttles in a hidden tab');
assert(onf.includes('orig.__onfKick'),
  'the opener wrap must be idempotent');

/* 4 - buildFillBox failures are surfaced, never swallowed */
assert(onf.includes('function noteFillError('),
  'fill failures must have a named reporter');
assert(onf.includes('lastFillError'),
  'the export must carry the last failure for live diagnosis');
assert(!/safe\(function \(\) \{ buildFillBox/.test(onf),
  'no buildFillBox call may hide inside a bare safe() again');
