'use strict';

/* THE PULL-CHART ROW ANNOUNCED ITSELF WITH BROKEN GLYPHS (b759).
 *
 * Owner verbatim (#41): "also whwn i click pull chatt here it should work and also give
 * a loading thing to show its working right therre".
 *
 * The loading thing existed. It rendered as a broken glyph. Decoded as UTF-8 - which is
 * how the browser reads the served file - the three status messages in that row were:
 *
 *   chartRowStatus("<U+FFFD> Reading this chart in athenaOne (read-only)...")
 *   chartRowStatus("<0x13>    History loaded from athenaOne - ...")
 *   chartRowStatus("<U+FFFD> No chart came back. Open this patient in athenaOne ...")
 *
 * Raw bytes read as latin1: 0xCF, 0x13, 0xA0 - one surviving byte each. They are the
 * remains of multi-byte UTF-8 emoji written directly into a file that is read and
 * written as latin1; a round-trip destroyed all but one byte. So the loading state was
 * a replacement character, the success state was INVISIBLE, and the failure state was a
 * replacement character.
 *
 * THE FIX IS THE ENCODING DISCIPLINE, NOT THE PARTICULAR GLYPHS. This file already
 * demonstrated the correct convention a few thousand lines away: the working sparkle is
 * stored as the ASCII escape ✨, never as raw bytes. An escape cannot be damaged by
 * any future latin1 round-trip. That is what this suite pins.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT CLAIM. It does not assert that the pull starts,
 * nor that progress is rendered inline in that row rather than in a toast. Both are the
 * rest of #41 and are NOT fixed. A larger rewrite of the button was proposed and
 * rejected under adversarial review because it broke tests/fixtures/ui-control-manifest.json:
 * moving the first ">" after "<button" inside a conditional changes how
 * tools/ui-control-inventory.js extracts the control.
 *
 * SCOPE OF THE FILE-WIDE ARM. Only mls-connect.js is held to zero invalid UTF-8. Other
 * shipped files carry stray control characters that are all inside COMMENTS (mangled em
 * dashes in background.js and feat_mls_calm_shell.js) or are an intentional delimiter
 * (feat_visit_history_ext.js joins a search haystack with \x01). Those never reach a
 * user, and "fixing" them would be churn against the latin1 lane for no benefit.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const FILE = path.join(root, 'mls-connect.js');

const raw = fs.readFileSync(FILE);
const asUtf8 = raw.toString('utf8');
const asLatin1 = raw.toString('latin1');
const FFFD = String.fromCharCode(0xFFFD);

/* ---- 1. no invalid UTF-8 anywhere in the main UI surface ------------------ */
{
  const n = asUtf8.split(FFFD).length - 1;
  if (n !== 0) {
    const lines = asUtf8.split('\n');
    const where = [];
    lines.forEach(function (L, i) {
      if (L.indexOf(FFFD) >= 0) where.push('    line ' + (i + 1) + ': ' + L.replace(/\s+/g, ' ').trim().slice(0, 90));
    });
    assert.fail('mls-connect.js contains ' + n + ' invalid UTF-8 sequence(s); the browser renders each as a ' +
      'replacement character. Write the glyph as an ASCII \\uXXXX escape instead - this file is read and ' +
      'written as latin1, and a raw multi-byte emoji cannot survive that round-trip:\n' + where.join('\n'));
  }
}

/* ---- 2. the three status glyphs specifically ----------------------------- */
{
  const CASES = [
    ['\\u21BB', 'Reading this chart in athenaOne', 'the LOADING state - this is the "loading thing" he asked for'],
    ['\\u2713', 'History loaded from athenaOne', 'the SUCCESS state - it was an invisible 0x13 control character'],
    ['\\u26A0', 'No chart came back', 'the FAILURE state'],
  ];

  CASES.forEach(function (c) {
    const esc = c[0], msg = c[1], why = c[2];
    const wanted = 'chartRowStatus("' + esc + ' ' + msg;
    assert(asLatin1.indexOf(wanted) >= 0,
      'the pull-chart row must announce ' + why + ' with an ASCII escape. Expected to find:\n' +
      '    ' + wanted + '\n' +
      'A raw emoji here is destroyed by the latin1 round-trip this file requires, which is exactly ' +
      'how this shipped as mojibake.');
  });
}

/* ---- 3. the bytes that caused it must not come back ---------------------- */
{
  /* the three single bytes that were the remains of mangled emoji */
  [0xCF, 0x13, 0xA0].forEach(function (b) {
    const ch = String.fromCharCode(b);
    const hits = [];
    asLatin1.split('\n').forEach(function (L, i) {
      if (L.indexOf('chartRowStatus("' + ch) >= 0) hits.push(i + 1);
    });
    assert.strictEqual(hits.length, 0,
      'a chartRowStatus message starts with raw byte 0x' + b.toString(16).toUpperCase() +
      ' again (line(s) ' + hits.join(', ') + '). That byte is not valid UTF-8 on its own and renders as ' +
      'a broken or invisible character.');
  });

  /* no stray control characters may appear inside ANY chartRowStatus literal */
  const re = /chartRowStatus\("([^"]{0,120})"/g;
  let m, offenders = [];
  while ((m = re.exec(asLatin1)) !== null) {
    const body = m[1];
    for (let i = 0; i < body.length; i++) {
      const c = body.charCodeAt(i);
      if (c < 0x09 || (c > 0x0D && c < 0x20) || c === 0x7F) {
        offenders.push(JSON.stringify(body.slice(0, 40)));
        break;
      }
    }
  }
  assert.deepStrictEqual(offenders, [],
    'chartRowStatus message(s) contain a raw control character, which renders as nothing at all: ' +
    offenders.join(' | '));
}

console.log('PASS the chart-row status glyphs are not mojibake: the loading, success and failure states ' +
  'of the pull-chart row announce themselves with ASCII \\uXXXX escapes (21BB / 2713 / 26A0) that survive ' +
  'the latin1 round-trip this file requires, mls-connect.js carries zero invalid UTF-8 sequences, and the ' +
  'three raw bytes that shipped as a broken loading glyph and an INVISIBLE success message cannot return. ' +
  'NOTE: this pins the announcement only - whether the pull starts, and inline progress, are the rest of ' +
  '#41 and are not addressed');
