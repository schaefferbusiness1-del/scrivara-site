'use strict';

/* PHONE BREAKAGE FIXES B2/B3/B5 (b729, from the 2026-07-27 phone audit -
 * PHONE_AUDIT_2026-07-27.md):
 *  B2 - the phone had NO transcript anywhere: a CSS-hidden lane still claimed
 *       ez3fl-top-owns (mounted != visible) and visit_focus's :has rule
 *       cannot see display:none. Phone now excluded from both claims.
 *  B3 - post-stop dead end: the ph hide list blanket-hid .ez3-row2 (blocking
 *       the visit_focus disclosure that owns those controls) and hid the one
 *       disclosure chip. Row2 left the list; #ez3QuickTools re-shown.
 *  B5 - every mic diagnostic was written into #micWarn inside the permanently
 *       hidden #captureCard. An invisible warn now also toasts. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const vfocus = fs.readFileSync(path.join(root, 'feat_mls_visit_focus.js'), 'utf8');

/* B2 */
assert(connect.includes("var wantOwns = !staff && laneMounted && !(document.body && document.body.classList.contains('mls-phone'));"),
  'a mounted-but-CSS-hidden lane must never claim the top on phone (mounted is not visible)');
assert(vfocus.includes(":not(.mls-phone) #visitView #mlsEz3Body:has(.ez3fl-record:not([hidden])"),
  "visit_focus's transcript-card hide must exclude phone - :not([hidden]) cannot see display:none");

/* B3 */
assert(!connect.includes("'body.mls-phone .ez3-row2, body.mls-phone #ez3Adv,',"),
  'the blanket .ez3-row2 phone hide is back - the post-stop dead end returns');
assert(connect.includes("'html body.mls-phone #ez3QuickTools{ display:inline-flex !important; min-height:44px; }',"),
  'the phone must keep ONE disclosure that reaches every folded control');

/* B5 - source + runtime */
assert(app.includes('try{ if(!w.offsetParent){ toast(msg,\'err\'); } }catch(e){}'),
  'an invisible #micWarn must fall through to a visible toast');
const fn = app.slice(app.indexOf('function showMicWarn(msg){'), app.indexOf('/* ===== RECORD-FIRST HERO'));
const toasts = [];
const warnNode = { style: {}, offsetParent: null, querySelector: function () { return { textContent: '' }; } };
const ctx = { document: { getElementById: function () { return warnNode; } }, toast: function (m) { toasts.push(String(m)); }, console: console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fn, ctx, { filename: 'showMicWarn.js' });
ctx.showMicWarn('Microphone blocked — allow mic access.');
assert(toasts.length === 1 && /Microphone blocked/.test(toasts[0]), 'hidden warn must toast the same message');
warnNode.offsetParent = {};
ctx.showMicWarn('second');
assert(toasts.length === 1, 'a VISIBLE warn must not double-announce as a toast');

console.log('PASS phone has a transcript and a way on: top-owns never claims a hidden lane, the :has hide excludes phone, row2 unfolds through the kept disclosure, and mic failures are never silent');
