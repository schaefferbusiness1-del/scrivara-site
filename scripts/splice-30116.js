/* splice-30116.js - MLS Assist 3.0.116 native section-persistence readback.
 *
 * DRAFT SPLICE. Reads an input background.js as latin1, edits it by EXACT
 * WHOLE-LINE anchors only (never String.replace over the whole file), re-emits
 * every inserted or replaced line with the SAME terminator as its anchor line,
 * and writes the result to a separate output path. The tracked file is never
 * touched by this script - pass the paths explicitly.
 *
 *   node scripts/splice-30116.js <input-background.js> <output-background.js>
 *
 * WHAT IT CHANGES (all inside ATHENA_ACTION_V2_SAVENAMED_EXECUTE_START, except
 * edit A which is the execute-time A/P re-measure):
 *   A  refuse instead of silently falling through to an encounter Save press
 *      when the app authorized a native reconcile and the A/P editor is no
 *      longer Slate at execute time (reason section-persistence-surface-changed)
 *   B  proof-missing refusal: readOnly/serverVerified:false + plain-English error
 *   C  frame-changed refusal: readOnly/serverVerified:false + plain-English error
 *   D  nativeReadNorm / nativeReadLabel / nativeReadError helpers
 *   E  a 4-read settle window around the section read-back
 *   F  compare through nativeReadNorm instead of byte-exact !==
 *   G  loop refusal: attempted:false, readOnly:true, serverVerified:false, error
 *   H  success return: attempted:false, readOnly:true (nothing was pressed)
 *
 * It does NOT touch the probe leg, the write leg, proof minting, the token
 * lock, sign/order/billing, content.js, the manifest, or any version pin.
 */
'use strict';

var fs = require('fs');

var IN = process.argv[2], OUT = process.argv[3];
if (!IN || !OUT) {
  console.error('usage: node splice-30116.js <input-background.js> <output-background.js>');
  process.exit(1);
}

var s = fs.readFileSync(IN, 'latin1');

function census(str) {
  var cr = 0, lf = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c === 13) cr++; else if (c === 10) lf++;
  }
  return { bytes: str.length, cr: cr, lf: lf };
}

var before = census(s);

/* Every constant this script emits must be ASCII: the latin1 writer turns a
   stray Unicode code point into control bytes. */
function assertAscii(lines) {
  lines.forEach(function (line) {
    if (/[^\x09\x20-\x7e]/.test(line)) throw new Error('Non-ASCII payload line: ' + line.slice(0, 60));
  });
}

/* Resolve ONE whole line by exact content. The anchor must match the full line
   (terminator excluded) and must occur exactly once in the file. */
function lineSpan(anchor) {
  var hits = [], from = 0;
  for (;;) {
    var i = s.indexOf(anchor, from);
    if (i < 0) break;
    from = i + 1;
    var start = i === 0 ? 0 : s.lastIndexOf('\n', i - 1) + 1;
    if (start !== i) continue;
    var end = s.indexOf('\n', i);
    if (end < 0) continue; /* an unterminated last line is never an anchor here */
    var content = s.slice(start, end);
    if (content.charCodeAt(content.length - 1) === 13) content = content.slice(0, -1);
    if (content !== anchor) continue;
    hits.push({ start: start, end: end, eol: s.charCodeAt(end - 1) === 13 ? '\r\n' : '\n' });
  }
  if (hits.length !== 1) throw new Error('Anchor occurs ' + hits.length + ' time(s), expected 1: ' + anchor.trim().slice(0, 72));
  return hits[0];
}

var ops = [];

function emit(lines, eol) { return lines.map(function (line) { return line + eol; }).join(''); }

function replaceLine(tag, anchor, lines) {
  assertAscii([anchor]);
  assertAscii(lines);
  var span = lineSpan(anchor);
  s = s.slice(0, span.start) + emit(lines, span.eol) + s.slice(span.end + 1);
  ops.push({ tag: tag, kind: 'replace', eol: span.eol === '\r\n' ? 'CRLF' : 'LF', removed: 1, added: lines.length });
}

function insertAfterLine(tag, anchor, lines) {
  assertAscii([anchor]);
  assertAscii(lines);
  var span = lineSpan(anchor);
  s = s.slice(0, span.end + 1) + emit(lines, span.eol) + s.slice(span.end + 1);
  ops.push({ tag: tag, kind: 'insert-after', eol: span.eol === '\r\n' ? 'CRLF' : 'LF', removed: 0, added: lines.length });
}

function insertBeforeLine(tag, anchor, lines) {
  assertAscii([anchor]);
  assertAscii(lines);
  var span = lineSpan(anchor);
  s = s.slice(0, span.start) + emit(lines, span.eol) + s.slice(span.start);
  ops.push({ tag: tag, kind: 'insert-before', eol: span.eol === '\r\n' ? 'CRLF' : 'LF', removed: 0, added: lines.length });
}

/* ------------------------------------------------------------------ */
/* A. execute-time A/P re-measure: never fall through to a Save press. */
/* ------------------------------------------------------------------ */
insertAfterLine('A-surface-changed',
  '    nativeNamedSave = !!(nativeNamedSave && hit.nativePersistenceReconcile);',
  [
    '    /* surfacechange-1.0.0 (3.0.116): the probe found a Slate A/P editor and',
    '       the four native section proofs verified, so this request was authorized',
    '       as a reconcile of sections athenaOne persisted itself - NOT as a press',
    '       on the encounter Save control. If the A/P editor is no longer Slate at',
    '       execute time the surface changed underneath that authorization, and the',
    '       shipped fall-through would quietly become an encounter Save press the',
    '       app never asked for. Refuse instead. Nothing is clicked, read back or',
    '       written here. The context object is not built until below this line, so',
    '       this receipt deliberately carries no context. */',
    "    if (mode !== 'probe' && action === 'save_draft' && req.nativePersistenceProofSetVerified === true && !nativeNamedSave) return { ok: false, blocked: true, action: action, attempted: false, readOnly: true, verified: false, saved: false, persisted: false, serverVerified: false, reason: 'section-persistence-surface-changed', error: 'The A/P editor changed shape since MLS checked this encounter, so MLS did not press Save. Re-open the encounter, then press Confirm again.', noAutomaticChaining: 'no-automatic-chaining' };"
  ]);

/* ------------------------------------------------------------------ */
/* B. proof-missing refusal: honest receipt + plain-English sentence.  */
/* ------------------------------------------------------------------ */
replaceLine('B-proof-missing',
  "      if (req.nativePersistenceProofSetVerified !== true) return { ok: false, blocked: true, action: action, attempted: false, verified: false, saved: false, persisted: false, reason: 'section-persistence-proof-missing', context: context, noAutomaticChaining: 'no-automatic-chaining' };",
  [
    "      if (req.nativePersistenceProofSetVerified !== true) return { ok: false, blocked: true, action: action, attempted: false, readOnly: true, verified: false, saved: false, persisted: false, serverVerified: false, reason: 'section-persistence-proof-missing', error: 'MLS has no proof that Athena saved each reviewed section itself, so it did not verify the note. Nothing was pressed. Send the sections again.', context: context, noAutomaticChaining: 'no-automatic-chaining' };"
  ]);

/* ------------------------------------------------------------------ */
/* C. frame-changed refusal: honest receipt + plain-English sentence.  */
/* ------------------------------------------------------------------ */
replaceLine('C-frame-changed',
  "      if (!nativeFrameLifetimeMatches()) return { ok: false, blocked: true, action: action, attempted: false, verified: false, saved: false, persisted: false, reason: 'section-persistence-frame-changed', context: context, noAutomaticChaining: 'no-automatic-chaining' };",
  [
    "      if (!nativeFrameLifetimeMatches()) return { ok: false, blocked: true, action: action, attempted: false, readOnly: true, verified: false, saved: false, persisted: false, serverVerified: false, reason: 'section-persistence-frame-changed', error: 'The Athena encounter reloaded while MLS was reading the saved note back. Nothing was pressed. Let it finish loading, then press Confirm again.', context: context, noAutomaticChaining: 'no-automatic-chaining' };"
  ]);

/* ------------------------------------------------------------------ */
/* D. read-back normalizer + the refusal sentences.                    */
/* ------------------------------------------------------------------ */
insertBeforeLine('D-helpers',
  '      async function nativeReadSection(key, expectedValue) {',
  [
    "      /* readnorm-1.0.0 (3.0.116, measured live 2026-09-09): athenaOne's own",
    '         hydration of a section it persisted collapsed a duplicated space',
    '         inside an HPI line, so the byte-exact comparison refused a section',
    '         Athena really did save. Newline structure still has to match exactly',
    '         - only runs of spaces and tabs INSIDE a line are collapsed and the',
    '         line ends trimmed - and BOTH sides go through this one helper, so a',
    '         reviewed section that arrived with CRLF (noteNorm on the write leg',
    '         versus a bare trim on the expected side) cannot refuse either.',
    '         Different words are still a mismatch. */',
    '      function nativeReadNorm(v) {',
    "        return noteNorm(v).split('\\n').map(function (line) { return line.replace(/[ \\t]+/g, ' ').trim(); }).join('\\n');",
    '      }',
    "      function nativeReadLabel(key) { return { hpi: 'HPI', ros: 'ROS', exam: 'PE', ap: 'A/P' }[key] || 'reviewed'; }",
    '      /* honest-refusal-1.0.0 (3.0.116): every refusal this block can return',
    '         happens BEFORE any control is pressed, so each one says so in plain',
    '         English and names the one step that clears it. */',
    '      function nativeReadError(reason, key) {',
    '        var label = nativeReadLabel(key);',
    "        if (reason === 'section-persistence-frame-changed') return 'The Athena encounter reloaded while MLS was reading the saved note back. Nothing was pressed. Let it finish loading, then press Confirm again.';",
    "        if (reason === 'section-persistence-readback-missing') return 'MLS could not open the ' + label + ' section to read it back. Nothing was pressed. Open that section in the encounter, then press Confirm again.';",
    "        if (reason === 'section-persistence-readback-ambiguous') return 'MLS found more than one ' + label + ' section and did not guess. Nothing was pressed.';",
    "        if (reason === 'section-persistence-readback-mismatch') return 'The saved ' + label + ' text in Athena does not match the reviewed text. Nothing was pressed. Inspect that section before retrying.';",
    "        if (reason === 'note-editor-unreadable') return 'MLS could not read the ' + label + ' editor. Nothing was pressed. Let the encounter finish loading, then press Confirm again.';",
    "        if (reason === 'context-mismatch') return 'The encounter open in athenaOne changed while MLS was reading the saved note back. Nothing was pressed. Re-open the encounter, then press Confirm again.';",
    "        if (reason === 'forbidden-control') return 'The only control MLS could use to open the ' + label + ' section is a Sign, billing, order or close control. MLS will never click one. Nothing was pressed.';",
    "        return 'MLS did not verify the saved note in Athena. Nothing was pressed.';",
    '      }'
  ]);

/* ------------------------------------------------------------------ */
/* E. settle window: up to four reads, 400ms apart, re-resolving.      */
/* ------------------------------------------------------------------ */
replaceLine('E-settle-window',
  '        var value = editorValue(target.editor);',
  [
    '        /* settle-1.0.0 (3.0.116): athenaOne can still be hydrating the section',
    '           it just persisted when the first read lands, so one read is a coin',
    '           flip. Read up to FOUR times, 400ms apart on the hidden-tab-safe',
    '           sleep, re-resolving the editor and re-checking the frame lifetime',
    '           between reads. The stage-context gate above already ran and is not',
    '           repeated. Nothing is clicked and nothing is written. */',
    '        var nativeExpectedNorm = nativeReadNorm(expectedValue);',
    '        var value = editorValue(target.editor);',
    '        for (var settle = 1; settle < 4 && (value === null || nativeReadNorm(value) !== nativeExpectedNorm); settle++) {',
    '          await sleep(400);',
    "          if (!nativeFrameLifetimeMatches()) return { ok: false, reason: 'section-persistence-frame-changed' };",
    "          target = findNamedNoteAction(hit.frame, 'write_note', key);",
    "          if (!target || !target.editor || String(target.editor.getAttribute && target.editor.getAttribute('data-slate-editor') || '').toLowerCase() !== 'true') return { ok: false, reason: 'section-persistence-readback-missing' };",
    '          value = editorValue(target.editor);',
    '        }'
  ]);

/* ------------------------------------------------------------------ */
/* F. compare through the shared normalizer, not byte-exact.           */
/* ------------------------------------------------------------------ */
replaceLine('F-normalized-compare',
  "        if (value !== expectedValue) return { ok: false, reason: 'section-persistence-readback-mismatch' };",
  [
    "        if (nativeReadNorm(value) !== nativeExpectedNorm) return { ok: false, reason: 'section-persistence-readback-mismatch' };"
  ]);

/* ------------------------------------------------------------------ */
/* G. loop refusal: nothing was pressed, so say so.                    */
/* ------------------------------------------------------------------ */
replaceLine('G-loop-refusal',
  "        if (!nativeRead.ok) return { ok: false, blocked: true, action: action, attempted: true, verified: false, saved: false, persisted: false, serverVerified: true, reason: nativeRead.reason, failedDestination: nativeReadKey, sectionsDeclared: 5, persistedDestinations: nativeResults.length, context: context, results: nativeResults, noAutomaticChaining: 'no-automatic-chaining' };",
  [
    "        if (!nativeRead.ok) return { ok: false, blocked: true, action: action, attempted: false, readOnly: true, verified: false, saved: false, persisted: false, serverVerified: false, reason: nativeRead.reason, error: nativeReadError(nativeRead.reason, nativeReadKey), failedDestination: nativeReadKey, sectionsDeclared: 5, persistedDestinations: nativeResults.length, context: context, results: nativeResults, noAutomaticChaining: 'no-automatic-chaining' };"
  ]);

/* ------------------------------------------------------------------ */
/* H. success return: this leg pressed nothing either.                 */
/* ------------------------------------------------------------------ */
replaceLine('H-success-readonly',
  "      return { ok: true, action: action, attempted: true, verified: true, saved: true, persisted: true, serverVerified: true, reason: 'exact-section-persistence-reconciled', nativePersistenceReconcile: true, sectionsDeclared: 5, persistedDestinations: 4, signed: false, context: context, results: nativeResults, noAutomaticChaining: 'no-automatic-chaining' };",
  [
    "      return { ok: true, action: action, attempted: false, readOnly: true, verified: true, saved: true, persisted: true, serverVerified: true, reason: 'exact-section-persistence-reconciled', nativePersistenceReconcile: true, sectionsDeclared: 5, persistedDestinations: 4, signed: false, context: context, results: nativeResults, noAutomaticChaining: 'no-automatic-chaining' };"
  ]);

/* ------------------------------------------------------------------ */
/* Census: the terminator counts may move ONLY by the edited lines.    */
/* ------------------------------------------------------------------ */
var expectedCr = 0, expectedLf = 0;
ops.forEach(function (op) {
  var net = op.added - op.removed;
  expectedLf += net;
  if (op.eol === 'CRLF') expectedCr += net;
});

fs.writeFileSync(OUT, s, 'latin1');
var after = census(s);

console.log('input           : ' + IN);
console.log('output          : ' + OUT);
ops.forEach(function (op) {
  console.log('  ' + op.tag + '  ' + op.kind + '  eol=' + op.eol + '  -' + op.removed + ' +' + op.added);
});
console.log('census before   : bytes=' + before.bytes + ' CR=' + before.cr + ' LF=' + before.lf);
console.log('census after    : bytes=' + after.bytes + ' CR=' + after.cr + ' LF=' + after.lf);
console.log('byte delta      : ' + (after.bytes - before.bytes));
console.log('CR delta        : ' + (after.cr - before.cr) + ' (expected ' + expectedCr + ')');
console.log('LF delta        : ' + (after.lf - before.lf) + ' (expected ' + expectedLf + ')');

if (after.cr - before.cr !== expectedCr) { console.error('ABORT: CR census moved by more than the edited lines'); process.exit(1); }
if (after.lf - before.lf !== expectedLf) { console.error('ABORT: LF census moved by more than the edited lines'); process.exit(1); }
console.log('SPLICE OK (readnorm-1.0.0 / settle-1.0.0 / honest-refusal-1.0.0 / surfacechange-1.0.0)');
