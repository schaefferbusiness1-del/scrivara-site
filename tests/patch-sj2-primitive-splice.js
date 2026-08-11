#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-sj2-primitive-splice.js  (sj-2.0 phase-2, Commit A)  2026-08-11
 *
 * THE PRIMITIVE SPLICE (INTEGRATION-ORDER.md section 2, conflict C5): inserts
 * the sj-2.0 __mlsPtsStore block into ScribeFlow.html immediately after
 * 'var __mlsPtsMemo=null;' - after uns()/_mlsPtsDecode exist, before
 * savePatients and the batch object, inside the region the registered suites
 * extract. The block itself is the CANONICAL salvage deliverable
 * (handoff-2026-08-11/salvage/sj2/primitive/mls-pts-store.js) with the two
 * mandatory cross-anchor fixes ALREADY applied to that file at Commit A:
 *   (a) the literal token 'qg-2.0' spelled 'qg 2.0' in comments (3x) so the
 *       quota-guard suite's first-indexOf anchor is not stolen by a comment;
 *   (b) the two raw 0x01 join separators written as the six-ASCII-char escape
 *       backslash-u0001 (runtime separator identical, source pure ASCII).
 * This patcher REFUSES an unfixed block (fail-closed, same as the suites
 * stage's assemble-sj2-root.js, which is validation-only by declaration and
 * must never point at the repo).
 *
 * BLOCK SOURCE: --block=<path> or env MLS_SJ2_BLOCK. There is deliberately NO
 * in-repo copy of the block: post-splice the authoritative bytes live inside
 * ScribeFlow.html between the BEGIN/END markers (the sj2 suites extract from
 * there, never from a file copy) - a second in-repo copy would be a
 * divergence vector. After the one-time apply this patcher is the historical
 * record of the splice; its dry-run on an applied repo reports already-applied
 * without needing byte-identity of the external file.
 *
 * EOL SAFETY: latin1 read/write (byte-preserving), exact byte splice,
 * occurrence==1 assertion, no normalization. ASCII-only added bytes
 * (self-checked). Already-applied judged on marker presence, never on the
 * find's absence (the find SURVIVES the apply - it is the splice prefix).
 *
 * MODES:
 *   node tests/patch-sj2-primitive-splice.js --block=<path>          DRY-RUN
 *   node tests/patch-sj2-primitive-splice.js --block=<path> --apply  apply,
 *       backup OUTSIDE the repo (os tmpdir) first.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');
const SF = 'ScribeFlow.html';
const BEGIN = '/* ===== BEGIN mls-pts-store (sj-2.0) ===== */';
const END = '/* ===== END mls-pts-store (sj-2.0) ===== */';
const FIND = 'var __mlsPtsMemo=null;\n';

function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; }
}

function loadBlock(blockPath) {
  const block = fs.readFileSync(blockPath, 'latin1');
  const must = (cond, msg) => { if (!cond) throw new Error('BLOCK VALIDATION FAIL: ' + msg); };
  must(occurrences(block, BEGIN) === 1, 'BEGIN marker occurrence==1 (found ' + occurrences(block, BEGIN) + ')');
  must(occurrences(block, END) === 1, 'END marker occurrence==1 (found ' + occurrences(block, END) + ')');
  must(occurrences(block, 'qg-2.0') === 0,
    "the literal token 'qg-2.0' is present - the canonical block fix (Commit A step 1) has not been applied; " +
    'splicing it would let the quota-guard suite anchor on a comment. REFUSING.');
  for (let i = 0; i < block.length; i++) {
    const c = block.charCodeAt(i);
    must(c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126),
      'non-ASCII byte 0x' + c.toString(16) + ' at offset ' + i + ' - ASCII-only travel is the law for ScribeFlow-destined bytes');
  }
  must(occurrences(block.toLowerCase(), '</script') === 0, 'a </script sequence would terminate the host script element');
  must(occurrences(block, 'window.__mlsPtsStore') >= 1, 'the block must define window.__mlsPtsStore');
  /* the two retired v1 journal names and the qg latch identifier must not
     ride in (grep-count guards elsewhere assume it) */
  must(occurrences(block, '__mlsPtsEdit' + 'AtRiskUnknown') === 0, 'the qg latch identifier may not appear in the block');
  return /\n$/.test(block) ? block : block + '\n';
}

function main() {
  const APPLY = process.argv.indexOf('--apply') >= 0;
  const blockArg = process.argv.find(a => a.indexOf('--block=') === 0);
  const blockPath = (blockArg && blockArg.slice('--block='.length)) || process.env.MLS_SJ2_BLOCK || '';

  const sfPath = path.join(ROOT, SF);
  const sf = fs.readFileSync(sfPath, 'latin1');
  console.log('read  ' + SF + '  (' + sf.length + ' bytes, latin1)');

  /* ALREADY APPLIED first, judged on the markers (the find survives a correct
     apply - judging on its absence would be the dn-1.0 double-splice trap). */
  const nBegin = occurrences(sf, BEGIN), nEnd = occurrences(sf, END);
  if (nBegin === 1 && nEnd === 1) {
    console.log('ALREADY APPLIED: the repo ScribeFlow.html carries the sj-2.0 block (BEGIN/END markers present exactly once). Nothing to do.');
    if (APPLY) { console.error('--apply refused: a double-splice is never allowed.'); process.exit(1); }
    return;
  }
  if (nBegin !== 0 || nEnd !== 0) {
    console.error('CORRUPT STATE: BEGIN x' + nBegin + ' / END x' + nEnd + ' - neither pristine nor applied. Restore the file from git before running this patcher.');
    process.exit(1);
  }

  if (!blockPath) {
    console.error('usage: node tests/patch-sj2-primitive-splice.js --block=<path-to-fixed-mls-pts-store.js> [--apply]  (or env MLS_SJ2_BLOCK)');
    process.exit(2);
  }
  let block;
  try { block = loadBlock(blockPath); }
  catch (err) { console.error(String(err && err.message || err)); process.exit(1); }
  console.log('block ' + blockPath + '  (' + block.length + ' bytes, validated: markers 1/1, qg-token 0, pure ASCII, no script-close)');

  const nFind = occurrences(sf, FIND);
  if (nFind !== 1) { console.error('ANCHOR FAILURE: expected occurrence==1 for ' + JSON.stringify(FIND) + ', found ' + nFind); process.exit(1); }
  const at = sf.indexOf(FIND);
  const REPLACE = FIND + block + '\n';
  const spliced = sf.slice(0, at) + REPLACE + sf.slice(at + FIND.length);

  /* post-splice invariants (mirror of the anchor-overlap check's audit) */
  const must = (cond, msg) => { if (!cond) { console.error('POSTCHECK FAIL: ' + msg); process.exit(1); } };
  must(occurrences(spliced, BEGIN) === 1 && occurrences(spliced, END) === 1, 'markers exactly once post-splice');
  must(occurrences(spliced, FIND) === 1, 'memo anchor still exactly once post-splice');
  const qgAt = spliced.indexOf('qg-2.0');
  const upsertAt = spliced.indexOf('function upsertPatient(');
  must(qgAt > 0 && upsertAt > 0, 'qg-2.0 token and upsertPatient located post-splice');
  must(qgAt > upsertAt, 'the FIRST qg-2.0 occurrence must sit inside upsertPatient (the real splice), not in the block - the quota-guard suite anchors on first-indexOf');

  console.log('DRY-RUN: PASS - splice at byte ' + at + ', ' + sf.length + ' -> ' + spliced.length + ' bytes (+' + (spliced.length - sf.length) + ').');

  if (!APPLY) {
    console.log('No files written. Re-run with --apply to splice (backup goes OUTSIDE the repo).');
    console.log('REMINDER after apply (INTEGRATION-ORDER Commit A): boot barrier wiring (patch-sj2-boot-barrier.js), register the sj2 suites in tests/run-all.js, full gate with the completeness line.');
    return;
  }

  /* Backups go OUTSIDE the repo: a .bak in the repo root is publication debris
     (public-publication-boundary refuses unreviewed root extensions). */
  const os = require('os');
  const bakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sj2sp-bak-'));
  fs.writeFileSync(path.join(bakDir, SF + '.sj2sp.bak'), sf, 'latin1');
  fs.writeFileSync(sfPath, spliced, 'latin1');
  console.log('APPLIED ' + SF + ' (backup: ' + path.join(bakDir, SF + '.sj2sp.bak') + ')');
}

if (require.main === module) main();
module.exports = { FIND, BEGIN, END, loadBlock };
