'use strict';

/* ptq-1.0.0 — the patients-list search matches every query token, not the
 * whole query as one substring.
 *
 * Measured live 2026-08-26 on the owner's account: searching "Adam Schaeffer"
 * on a 1,766-patient roster returned ONE row — a hollow duplicate ("ADAM
 * Schaeffer", wrong DOB, no MRN, 0 visits) — while the real "Adam J Schaeffer"
 * (MRN 7833832, 7 visits) did not match, because the whole-query substring
 * dies on the middle initial. A doctor could open (and chart into) the empty
 * twin. Token-AND matching fixes the class: every whitespace token must appear
 * somewhere in the row's search key; single-word queries behave exactly as
 * before.
 *
 * This suite EXECUTES the shipped filter lines from the shell (not a copy) and
 * proves twin parity.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const twin = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

function extractFilter(src, label) {
  const a = src.indexOf('// ptq-1.0.0');
  ok(a > 0, 'ptq-1.0.0 must ship in ' + label);
  const b = src.indexOf('const PT_CAP', a);
  ok(b > a, 'the filter must sit directly above the render cap in ' + label);
  const seg = src.slice(a, b);
  ok(seg.indexOf('row.search.indexOf(qTokens[qi])') > 0, label + ' must test each token against the search key');
  ok(!/row\.search\.indexOf\(ql\)/.test(seg), label + ' must not keep the whole-query substring');
  return seg;
}

const segShell = extractFilter(shell, '1pScribeFlow.html');
const segTwin = extractFilter(twin, '1p/index.html');
ok(segShell === segTwin, 'the twins must carry byte-identical filter code');

/* execute the REAL lines */
const run = new Function('ql', 'ranked', segShell + '\nreturn matched;');

const ROWS = [
  { search: 'adam j schaeffer 03/24/2006 7833832', id: 'real' },
  { search: 'adam schaeffer 04/24/2006', id: 'hollow' },
  { search: 'barbara a schaeffer 05/05/1944 6612162', id: 'barbara' },
  { search: 'sue minarchi 06/28/1956 7506226', id: 'sue' }
];
const ids = (q) => run(q.toLowerCase().trim(), ROWS).map(r => r.id).join(',');

ok(ids('adam schaeffer') === 'real,hollow',
  'the live defect: "adam schaeffer" must match Adam J Schaeffer THROUGH the middle initial (got ' + ids('adam schaeffer') + ')');
ok(ids('schaeffer adam') === 'real,hollow', 'token order must not matter');
ok(ids('adam j schaeffer') === 'real', 'the full name with initial still narrows to the exact row');
ok(ids('schaeffer') === 'real,hollow,barbara', 'single-word queries behave exactly as before');
ok(ids('schaeffer 7833832') === 'real', 'a name token plus an MRN token narrows to one row');
ok(ids('adam zzz') === '', 'an unmatched token must fail the row (AND, not OR)');
ok(run('', ROWS).length === 4, 'an empty query returns the whole ranking');
ok(ids('  adam   schaeffer  ') === 'real,hollow', 'stray whitespace must not mint empty tokens');

console.log('PASS 1p patient search tokens: ' + checks + ' checks — every query token must match the row\'s search key, so "adam schaeffer" finds Adam J Schaeffer through the middle initial instead of surfacing only a hollow duplicate; single-word behavior is unchanged, token order is free, and the twins carry identical bytes');
