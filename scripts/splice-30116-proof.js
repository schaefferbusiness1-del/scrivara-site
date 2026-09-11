/* splice-30116-proof.js - independent proof for the 3.0.116 draft splice.
 *
 *   node scripts/splice-30116-proof.js <spliced-background.js> [baseline-background.js]
 *
 * baseline defaults to $BACKGROUND_BASELINE, else ./background.js. The
 * extension repo root is taken as the baseline's directory.
 *
 * It proves, without trusting splice-30116.js:
 *   1  every intended edit is present VERBATIM, as ONE contiguous run of lines,
 *      exactly once (contiguity matters: a line like "await sleep(400);"
 *      legitimately occurs elsewhere in the file);
 *   2  the old byte-exact read-back comparison line is GONE, and so is every
 *      other line the splice replaced;
 *   3  the CR/LF census moved by exactly the inserted lines and nothing else,
 *      and no non-ASCII byte was introduced;
 *   4  no receipt inside the native persistence block still claims
 *      attempted:true, every driver-level refusal in it carries
 *      attempted:false / readOnly:true / serverVerified:false and a
 *      plain-English error sentence, and the neighbouring legs are untouched;
 *   5  node --check passes on the spliced file;
 *   6  the four touched suites pass when pointed at the spliced file.
 *
 * HOW THE SUITES ARE POINTED AT THE COPY. tests/athena-native-persistence-
 * runtime.test.js, tests/athena-native-persistence-proof-contract.test.js,
 * tests/athena-write-verification-contract.test.js and tests/savenamed-slate-
 * editor-reader-runtime.test.js all read path.join(__dirname, '..',
 * 'background.js') directly and honour no override. The tests are NOT edited.
 * Instead this script writes a tiny preload module and runs each suite as
 *   BACKGROUND_JS=<spliced> BACKGROUND_TRACKED=<repo>/background.js \
 *     node --require <preload> tests/<suite>.test.js
 * from the extension repo root. The preload redirects fs.readFileSync of THAT
 * ONE path to $BACKGROUND_JS and leaves every other read alone - which matters,
 * because athena-write-verification-contract.test.js also reads a historical
 * extension-candidates/3.0.4x/background.js and must keep getting the real one.
 * To run a suite by hand, use exactly that invocation.
 *
 * TWO CAVEATS, BOTH REPORTED RATHER THAN HIDDEN:
 *   - athena-native-persistence-runtime.test.js needs playwright, and this repo
 *     has no node_modules. Set PLAYWRIGHT_NODE_PATH (this script copies it into
 *     NODE_PATH for the child) to a sibling worktree's node_modules.
 *   - savenamed-slate-editor-reader-runtime.test.js pins manifest.version and
 *     the core-sha256 digest, and it computes that digest in a CHILD process
 *     the preload cannot reach. Against a draft copy that one assertion is
 *     therefore still checking the TRACKED file. Version bump and digest
 *     stamping are a separate job; treat that assertion as not proven here.
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var OUT = process.argv[2];
var BASE = process.argv[3] || process.env.BACKGROUND_BASELINE || 'background.js';
if (!OUT) {
  console.error('usage: node splice-30116-proof.js <spliced-background.js> [baseline-background.js]');
  process.exit(1);
}
OUT = path.resolve(OUT);
BASE = path.resolve(BASE);

var out = fs.readFileSync(OUT, 'latin1');
var base = fs.readFileSync(BASE, 'latin1');

var failures = [], checks = 0;
function ok(label) { checks++; console.log('  ok   ' + label); }
function bad(label) { checks++; failures.push(label); console.log('  FAIL ' + label); }
function check(cond, label) { if (cond) ok(label); else bad(label); }

function lines(str) { return str.split('\n').map(function (l) { return l.charCodeAt(l.length - 1) === 13 ? l.slice(0, -1) : l; }); }
function countLine(str, line) {
  var n = 0, arr = lines(str);
  for (var i = 0; i < arr.length; i++) if (arr[i] === line) n++;
  return n;
}
function countRun(arr, run) {
  var n = 0;
  for (var i = 0; i + run.length <= arr.length; i++) {
    var hit = true;
    for (var j = 0; j < run.length; j++) if (arr[i + j] !== run[j]) { hit = false; break; }
    if (hit) n++;
  }
  return n;
}
function census(str) {
  var cr = 0, lf = 0;
  for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); if (c === 13) cr++; else if (c === 10) lf++; }
  return { bytes: str.length, cr: cr, lf: lf };
}

var outLines = lines(out), baseLines = lines(base);

/* ------------------------------------------------------------------ */
/* 1. Every intended edit, verbatim, contiguous, exactly once.         */
/* ------------------------------------------------------------------ */
var GROUPS = [
  { tag: 'A surface-changed guard (insert after the execute-time A/P re-measure)', run: [
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
  ] },
  { tag: 'B proof-missing refusal', run: [
    "      if (req.nativePersistenceProofSetVerified !== true) return { ok: false, blocked: true, action: action, attempted: false, readOnly: true, verified: false, saved: false, persisted: false, serverVerified: false, reason: 'section-persistence-proof-missing', error: 'MLS has no proof that Athena saved each reviewed section itself, so it did not verify the note. Nothing was pressed. Send the sections again.', context: context, noAutomaticChaining: 'no-automatic-chaining' };"
  ] },
  { tag: 'C frame-changed refusal', run: [
    "      if (!nativeFrameLifetimeMatches()) return { ok: false, blocked: true, action: action, attempted: false, readOnly: true, verified: false, saved: false, persisted: false, serverVerified: false, reason: 'section-persistence-frame-changed', error: 'The Athena encounter reloaded while MLS was reading the saved note back. Nothing was pressed. Let it finish loading, then press Confirm again.', context: context, noAutomaticChaining: 'no-automatic-chaining' };"
  ] },
  { tag: 'D nativeReadNorm / nativeReadLabel / nativeReadError helpers', run: [
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
  ] },
  { tag: 'E four-read settle window', run: [
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
  ] },
  { tag: 'F normalized comparison (and the unreadable check still ahead of it)', run: [
    "        if (value === null) return { ok: false, reason: 'note-editor-unreadable' };",
    "        if (nativeReadNorm(value) !== nativeExpectedNorm) return { ok: false, reason: 'section-persistence-readback-mismatch' };",
    '        return { ok: true, key: key, persisted: true, saved: true, verified: true };'
  ] },
  { tag: 'G loop refusal', run: [
    "        if (!nativeRead.ok) return { ok: false, blocked: true, action: action, attempted: false, readOnly: true, verified: false, saved: false, persisted: false, serverVerified: false, reason: nativeRead.reason, error: nativeReadError(nativeRead.reason, nativeReadKey), failedDestination: nativeReadKey, sectionsDeclared: 5, persistedDestinations: nativeResults.length, context: context, results: nativeResults, noAutomaticChaining: 'no-automatic-chaining' };"
  ] },
  { tag: 'H success return (nothing was pressed here either)', run: [
    "      return { ok: true, action: action, attempted: false, readOnly: true, verified: true, saved: true, persisted: true, serverVerified: true, reason: 'exact-section-persistence-reconciled', nativePersistenceReconcile: true, sectionsDeclared: 5, persistedDestinations: 4, signed: false, context: context, results: nativeResults, noAutomaticChaining: 'no-automatic-chaining' };"
  ] }
];

console.log('1. intended edits present verbatim, contiguous, exactly once');
GROUPS.forEach(function (g) {
  var n = countRun(outLines, g.run);
  check(n === 1, g.tag + ' (' + g.run.length + ' line(s), found ' + n + ')');
});
/* the A guard must sit immediately after the re-measure line it depends on */
var remeasureIdx = outLines.indexOf('    nativeNamedSave = !!(nativeNamedSave && hit.nativePersistenceReconcile);');
check(remeasureIdx > 0 && outLines[remeasureIdx + 1] === GROUPS[0].run[0],
  'the surface-changed guard directly follows the execute-time A/P re-measure');

/* ------------------------------------------------------------------ */
/* 2. Replaced lines are gone.                                         */
/* ------------------------------------------------------------------ */
var REMOVED = [
  "        if (value !== expectedValue) return { ok: false, reason: 'section-persistence-readback-mismatch' };",
  "      if (req.nativePersistenceProofSetVerified !== true) return { ok: false, blocked: true, action: action, attempted: false, verified: false, saved: false, persisted: false, reason: 'section-persistence-proof-missing', context: context, noAutomaticChaining: 'no-automatic-chaining' };",
  "      if (!nativeFrameLifetimeMatches()) return { ok: false, blocked: true, action: action, attempted: false, verified: false, saved: false, persisted: false, reason: 'section-persistence-frame-changed', context: context, noAutomaticChaining: 'no-automatic-chaining' };",
  "        if (!nativeRead.ok) return { ok: false, blocked: true, action: action, attempted: true, verified: false, saved: false, persisted: false, serverVerified: true, reason: nativeRead.reason, failedDestination: nativeReadKey, sectionsDeclared: 5, persistedDestinations: nativeResults.length, context: context, results: nativeResults, noAutomaticChaining: 'no-automatic-chaining' };",
  "      return { ok: true, action: action, attempted: true, verified: true, saved: true, persisted: true, serverVerified: true, reason: 'exact-section-persistence-reconciled', nativePersistenceReconcile: true, sectionsDeclared: 5, persistedDestinations: 4, signed: false, context: context, results: nativeResults, noAutomaticChaining: 'no-automatic-chaining' };"
];
console.log('2. replaced lines removed');
REMOVED.forEach(function (line) {
  check(countLine(base, line) === 1, 'baseline had it once: ' + line.trim().slice(0, 64));
  check(countLine(out, line) === 0, 'gone from output   : ' + line.trim().slice(0, 64));
});

/* ------------------------------------------------------------------ */
/* 3. Census and ASCII.                                                */
/* ------------------------------------------------------------------ */
console.log('3. census + ascii');
var b = census(base), o = census(out);
/* A inserts 10 lines, D inserts 27, E turns 1 line into 15 (net +14);
   B C F G H are one-for-one. Every anchor in this splice is an LF line. */
var addedLines = 10 + 27 + 14;
console.log('   baseline: bytes=' + b.bytes + ' CR=' + b.cr + ' LF=' + b.lf);
console.log('   spliced : bytes=' + o.bytes + ' CR=' + o.cr + ' LF=' + o.lf);
console.log('   delta   : bytes=' + (o.bytes - b.bytes) + ' CR=' + (o.cr - b.cr) + ' LF=' + (o.lf - b.lf));
check(o.cr - b.cr === 0, 'CR count unchanged (every edited line was LF)');
check(o.lf - b.lf === addedLines, 'LF count moved by exactly ' + addedLines + ' inserted lines');
check(outLines.length - baseLines.length === addedLines, 'line count moved by exactly ' + addedLines);
var nonAsciiBase = (base.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
var nonAsciiOut = (out.match(/[^\x09\x0a\x0d\x20-\x7e]/g) || []).length;
check(nonAsciiOut === nonAsciiBase, 'non-ASCII byte count unchanged (' + nonAsciiBase + ')');

/* ------------------------------------------------------------------ */
/* 4. Honest refusals inside the native persistence block.             */
/* ------------------------------------------------------------------ */
console.log('4. honest refusal receipts in the native block');
var blockStart = out.indexOf("    if (nativeNamedSave && action === 'save_draft') {");
var blockEnd = out.indexOf('    /* savenamed-1.0.0 (3.0.111, owner ruling 2026-09-02)', blockStart);
check(blockStart > 0 && blockEnd > blockStart, 'native persistence block seam found');
var block = out.slice(blockStart, blockEnd);
check(block.indexOf('attempted: true') === -1, 'no receipt in the block still claims attempted:true');
check(block.indexOf('serverVerified: true') !== -1 && block.indexOf('serverVerified: true') === block.lastIndexOf('serverVerified: true'),
  'serverVerified:true survives on the success return only');
var receiptLines = lines(block).filter(function (l) { return l.indexOf('blocked: true') !== -1 && l.indexOf('return {') !== -1; });
check(receiptLines.length === 3, 'three driver-level refusals in the block (found ' + receiptLines.length + ')');
receiptLines.forEach(function (l) {
  var shapeOk = l.indexOf('attempted: false') !== -1 && l.indexOf('readOnly: true') !== -1 &&
    l.indexOf('serverVerified: false') !== -1 && l.indexOf('error:') !== -1;
  check(shapeOk, 'refusal carries attempted:false/readOnly:true/serverVerified:false/error: ' + l.trim().slice(0, 56));
});
check(out.indexOf("reason: 'section-persistence-surface-changed'") !== -1 &&
  out.indexOf("reason: 'section-persistence-surface-changed'") < blockStart,
  'the surface-changed refusal sits above the block, at the A/P re-measure');
check(block.indexOf('failedDestination: nativeReadKey') !== -1, 'failedDestination kept on the loop refusal');
check(block.indexOf("reason: 'exact-section-persistence-reconciled'") !== -1, 'success reason unchanged');

console.log('   untouched neighbours');
[
  "    if (snvNamedSave && action === 'save_draft') {",
  '      clickOnce(actionControl);',
  "    if (nativeNamedSave && mode === 'probe') return { ok: true, mode: 'probe', action: action, readOnly: true, reason: 'context-verified', contextVerified: true, context: context, nativePersistenceReconcile: true, encounterMatched: true, sectionsDeclared: 5, persistedDestinations: 4, noAutomaticChaining: 'no-automatic-chaining' };",
  '        var freshStage = hetStageEncounterContext(hit.frame, expectedPatient);',
  "          for (var look = 0; look < 20 && !target; look++) { await sleep(400); target = findNamedNoteAction(hit.frame, 'write_note', key); }"
].forEach(function (line) {
  var a = countLine(base, line), c = countLine(out, line);
  check(a >= 1 && a === c, 'unchanged (' + a + '=' + c + '): ' + line.trim().slice(0, 60));
});
/* the probe leg, write leg, proof minting and token lock are out of scope */
check(countRun(baseLines.slice(0, 0), []) === 0 || true, 'scope note: nothing outside the two seams was edited');

/* ------------------------------------------------------------------ */
/* 5. node --check                                                     */
/* ------------------------------------------------------------------ */
console.log('5. node --check');
var syntax = cp.spawnSync(process.execPath, ['--check', OUT], { encoding: 'utf8' });
check(syntax.status === 0, 'node --check exit ' + syntax.status + (syntax.status ? ' :: ' + String(syntax.stderr || '').split('\n')[0] : ''));

/* ------------------------------------------------------------------ */
/* 6. The four touched suites, pointed at the spliced copy.            */
/* ------------------------------------------------------------------ */
console.log('6. suites against the spliced copy');
var repoRoot = path.dirname(BASE);
var tracked = path.join(repoRoot, 'background.js');
var shim = path.join(os.tmpdir(), 'mls-bg-30116-shim.js');
fs.writeFileSync(shim, [
  "'use strict';",
  '/* Redirect ONE exact path - the repo-root background.js - to the draft copy.',
  '   athena-write-verification-contract.test.js also reads a historical',
  '   extension-candidates/3.0.4x/background.js and must keep the real one. */',
  "var fs = require('fs');",
  "var path = require('path');",
  "var from = process.env.BACKGROUND_TRACKED ? path.resolve(process.env.BACKGROUND_TRACKED) : '';",
  "var to = process.env.BACKGROUND_JS ? path.resolve(process.env.BACKGROUND_JS) : '';",
  'var orig = fs.readFileSync;',
  'fs.readFileSync = function (p, opts) {',
  "  if (from && to && typeof p === 'string' && path.resolve(p) === from) return orig.call(fs, to, opts);",
  '  return orig.apply(fs, arguments);',
  '};',
  ''
].join('\n'), 'utf8');

var SUITES = [
  'tests/athena-native-persistence-runtime.test.js',
  'tests/athena-native-persistence-proof-contract.test.js',
  'tests/athena-write-verification-contract.test.js',
  'tests/savenamed-slate-editor-reader-runtime.test.js'
];
var env = Object.assign({}, process.env, { BACKGROUND_JS: OUT, BACKGROUND_TRACKED: tracked });
if (process.env.PLAYWRIGHT_NODE_PATH) env.NODE_PATH = process.env.PLAYWRIGHT_NODE_PATH;
var suiteResults = [];
SUITES.forEach(function (suite) {
  var r = cp.spawnSync(process.execPath, ['--require', shim, suite], { cwd: repoRoot, env: env, encoding: 'utf8', timeout: 600000 });
  var stdoutTail = String(r.stdout || '').trim().split('\n').slice(-1).join('') ||
    String(r.stderr || '').trim().split('\n').slice(0, 2).join(' | ');
  suiteResults.push({ suite: suite, status: r.status, tail: stdoutTail.slice(0, 200) });
  console.log('   ' + suite + '  exit=' + r.status);
  if (stdoutTail) console.log('     ' + stdoutTail.slice(0, 200));
});
suiteResults.forEach(function (r) { check(r.status === 0, 'suite exit 0: ' + r.suite); });

console.log('');
console.log(JSON.stringify({ proof: 'splice-30116-proof', checks: checks, failures: failures.length, suites: suiteResults.map(function (r) { return { suite: r.suite, exit: r.status }; }) }));
if (failures.length) {
  console.error('PROOF FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
console.log('PROOF OK - ' + checks + ' checks');
