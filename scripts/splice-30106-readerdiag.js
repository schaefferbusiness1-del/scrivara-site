/* splice-30106-readerdiag.js - readerdiag-1.0.0 (folded into 3.0.106): the
 * schedule reply carried no trace of WHICH reader path produced its rows, so
 * a refused day could not be diagnosed from the app side (measured 2026-09-01:
 * three extension releases were built on guesses about the path). The
 * receipt now carries PHI-free reader counts: strategy/via, row/provider
 * counts, and the heading-inheritance counters. Counts and constant strings
 * only - never a name, never a row. Indentation-agnostic anchor, CRLF-aware. */
'use strict';
var fs = require('fs');
var s = fs.readFileSync('background.js', 'latin1');
var NL = /\r\n/.test(s) ? '\r\n' : '\n';
var FIND = 'var __receipt = {';
var n = s.split(FIND).length - 1;
if (n !== 1) { console.error('ABORT: receipt anchor hits=' + n); process.exit(1); }
var REPL = FIND + NL + "          reader: { strategy: String(__dd.strategy || ''), via: String(__dd.via || ''), apptCount: Number(__dd.apptCount || 0), providerCount: Number(__dd.providerCount || 0), tables: Number(__dd.tables || 0), rowsScanned: Number(__dd.rowsScanned || 0), scrolled: !!__dd.scrolled, sectionHeaders: Number(__dd.sectionHeaders || 0), sectionTagged: Number(__dd.sectionTagged || 0), stackedTagged: Number(__dd.stackedTagged || 0), columnTagged: Number(__dd.columnTagged || 0), coordErr: String(__dd.coordErr || '').slice(0, 60) }, /* readerdiag-1.0.0: PHI-free reader trace */";
s = s.split(FIND).join(REPL);
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK readerdiag-1.0.0 spliced');
