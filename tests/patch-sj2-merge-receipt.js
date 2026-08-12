#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-sj2-merge-receipt.js  (sj-2.0 phase-2, Commit D step 3, conflict C5)
 * 2026-08-11
 *
 * THE MERGE-RECEIPT EDIT (pre-registered criterion "the merge-receipt
 * naming"; provenance: the 8 silent dupe-collapse merges of 2026-08-11 -
 * "the self-heal was RIGHT but SILENT"): at mls-connect.js's F5 `merged++`
 * row-collapse site, every dupe-collapse now pushes a PHI-LEAN receipt onto
 * window.__mlsPtsMergeReceipts (ids + field-presence booleans only, newest 60
 * kept; absorbedId captured BEFORE p.id is overwritten; visitsAdded captures
 * unionVisits' hitherto-discarded return).
 *
 * The exact find/replace is LIFTED VERBATIM from the suites stage's
 * tools/assemble-sj2-root.js --with-merge-receipt (validation-only by its own
 * declaration - this file is the shipping patcher it could not be).
 * sj2-merge-receipt-required.test.js registers in the SAME commit as this
 * edit: it is RED on unedited bytes at exactly "SHIPPED CODE MERGED
 * SILENTLY" (executed proof, suites stage validation matrix).
 *
 * Scope: F5 row-collapse only (decision D8 default: the criterion is
 * row-collapse; _savePatientChart's field-level merge absorbs but never
 * collapses rows).
 *
 * EOL SAFETY: latin1 read/write (mls-connect.js is historically mixed-EOL),
 * exact-byte splice, occurrence==1, ASCII-only added bytes. Already-applied
 * judged on the REPLACE text (engine: tests/patch-daynote-foldin.js).
 * Backup OUTSIDE the repo.
 *
 * MODES:
 *   node tests/patch-sj2-merge-receipt.js            DRY-RUN (writes nothing)
 *   node tests/patch-sj2-merge-receipt.js --apply    apply (backup to tmpdir)
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');
const MC = 'mls-connect.js';

const EDITS = [
  {
    file: MC, id: 'mr-f5-receipt',
    why: 'a dupe-collapse self-heal must NAME what it merged - the 8 silent stub merges were RIGHT but invisible (pre-registered 2026-08-11).',
    find: '                    unionVisits(cand, p.visits);   /* F13e: never orphan pulled visits */\n' +
      '                    p.id = cand.id;\n' +
      '                    api.dedupStats.merged++;\n',
    replace: '                    var __mrAdded = unionVisits(cand, p.visits);   /* F13e: never orphan pulled visits */\n' +
      '                    var __mrAbsorbed = String(p.id);\n' +
      '                    p.id = cand.id;\n' +
      '                    api.dedupStats.merged++;\n' +
      '                    /* sj-2.0 merge receipt (pre-registered 2026-08-11; design\n' +
      '                       criterion "the merge-receipt naming"): a dupe-collapse\n' +
      '                       self-heal must NAME what it merged - the 8 silent stub\n' +
      '                       merges were RIGHT but invisible. PHI-lean: ids + field\n' +
      '                       flags only, newest 60 kept. */\n' +
      '                    try {\n' +
      '                      var __mrLog = window.__mlsPtsMergeReceipts = window.__mlsPtsMergeReceipts || [];\n' +
      '                      __mrLog.push({ at: Date.now(), key: \'name+dob\', survivorId: String(cand.id), absorbedId: __mrAbsorbed, visitsAdded: __mrAdded, offered: { problems: !!p.problems, meds: !!p.meds, allergies: !!p.allergies, dob: !!p.dob, reason: !!p.reason, summary: !!String(p.summary || \'\').trim() } });\n' +
      '                      if (__mrLog.length > 60) __mrLog.splice(0, __mrLog.length - 60);\n' +
      '                    } catch (eMr) {}\n'
  }
];

function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; }
}

function assertAscii(e) {
  for (let i = 0; i < e.replace.length; i++) {
    const c = e.replace.charCodeAt(i);
    if (!(c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126))) {
      throw new Error('[' + e.id + '] non-ASCII byte 0x' + c.toString(16) + ' at replace offset ' + i);
    }
  }
}

function applyToSources(sources, opts) {
  opts = opts || {};
  const out = Object.assign({}, sources);
  const log = [];
  for (const e of EDITS) {
    assertAscii(e);
    const src = out[e.file];
    if (typeof src !== 'string') throw new Error('missing source for ' + e.file);
    const nFind = occurrences(src, e.find);
    const nRepl = occurrences(src, e.replace);
    if (nRepl === 1) {
      if (opts.tolerateApplied) { log.push({ id: e.id, file: e.file, status: 'already-applied' }); continue; }
      throw new Error('[' + e.id + '] in ' + e.file + ': already applied - refusing to double-splice');
    }
    if (nFind !== 1) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': expected occurrence==1, found ' + nFind +
        (nRepl ? ' (replacement text present ' + nRepl + 'x)' : ''));
    }
    const at = src.indexOf(e.find);
    out[e.file] = src.slice(0, at) + e.replace + src.slice(at + e.find.length);
    log.push({ id: e.id, file: e.file, status: 'ok', at });
  }
  return { sources: out, log };
}

function postchecks(mc) {
  const must = (cond, msg) => { if (!cond) throw new Error('POSTCHECK FAIL: ' + msg); };
  must(occurrences(mc, 'api.dedupStats.merged++;') === 1, 'exactly one merged++ collapse site (the occurrence==1 pin)');
  must(occurrences(mc, '__mlsPtsMergeReceipts') === 2, 'receipt log referenced exactly at the collapse site (assign + reuse)');
  must(occurrences(mc, '__mrAbsorbed = String(p.id);') === 1, 'absorbedId captured BEFORE p.id is overwritten');
  const iAbs = mc.indexOf('var __mrAbsorbed = String(p.id);');
  const iOver = mc.indexOf('p.id = cand.id;', iAbs);
  must(iAbs >= 0 && iOver > iAbs, 'capture precedes the overwrite');
}

function main() {
  const APPLY = process.argv.indexOf('--apply') >= 0;
  const full = path.join(ROOT, MC);
  const sources = { [MC]: fs.readFileSync(full, 'latin1') };
  console.log('read  ' + MC + '  (' + sources[MC].length + ' bytes, latin1)');

  let result;
  try { result = applyToSources(sources, { tolerateApplied: !APPLY }); }
  catch (err) { console.error('\nDRY-RUN: FAIL'); console.error(String(err && err.message || err)); process.exit(1); }

  const applied = result.log.filter(l => l.status === 'already-applied');
  if (applied.length === EDITS.length) {
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED - the repo carries the merge receipt; nothing to do.');
    return;
  }
  for (const l of result.log) console.log('anchor ok  [' + l.id + ']  ' + l.file + ' @' + l.at);
  try { postchecks(result.sources[MC]); }
  catch (err) { console.error('\nDRY-RUN: FAIL'); console.error(String(err && err.message || err)); process.exit(1); }
  console.log('post-splice size ' + MC + ': ' + sources[MC].length + ' -> ' + result.sources[MC].length +
    ' (+' + (result.sources[MC].length - sources[MC].length) + ' bytes)');
  console.log('\nDRY-RUN: PASS - anchors verified, postchecks held.');

  if (!APPLY) {
    console.log('No files written. Re-run with --apply (backup goes OUTSIDE the repo).');
    console.log('REMINDER: sj2-merge-receipt-required.test.js registers in the SAME commit as this edit (it is RED without it).');
    return;
  }

  const os = require('os');
  const bakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sj2mr-bak-'));
  fs.writeFileSync(path.join(bakDir, MC + '.sj2mr.bak'), sources[MC], 'latin1');
  fs.writeFileSync(full, result.sources[MC], 'latin1');
  console.log('APPLIED ' + MC + ' (backup: ' + path.join(bakDir, MC + '.sj2mr.bak') + ')');
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, occurrences, postchecks };
