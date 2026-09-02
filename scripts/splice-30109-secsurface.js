/* splice-30109-secsurface.js - ext 3.0.109 secsurf-1.0.0.
 *
 * MEASURED LIVE 2026-09-02 00:5x-01:1x (owner's tab, app b1196, MLS Assist
 * 3.0.107, test patient Adam #7833832, encounter 08-31 bound). The Send to
 * Athena sheet wrote and read back Reviewed HPI, Review of Systems and
 * Physical Exam inside ~30s each. The fourth row, "Write reviewed Assessment
 * narrative" (Athena encounter > Assessment & Plan > Assessment), sat in
 * "Checking Athena ... nothing sent yet" for the full 150s read-only bound
 * TWICE, printing "athenaOne is still painting the encounter it just opened",
 * then settled "not sent" and re-armed. Plan / Follow-up and the combined
 * Assessment & Plan row were never reached at all.
 *
 * THE CAUSE IS ONE RETURN IN THE DRIVER. When the candidate loop ends with no
 * candidate it always answers `context-unverified` / "Could not identify one
 * exact patient encounter frame" - the same code and the same sentence whether
 * NO encounter is open or the encounter IS open and only the requested named
 * section's editor could not be resolved. The app reads that code as "the
 * surface is still painting", which starts its paced re-probe ladder and then a
 * read-only re-open of the encounter; the re-open re-arms the pacing, so the
 * ladder recycles against a surface that will never change and only the
 * caller's bound can end it. On a practice whose A/P stage renders ONE combined
 * "Assessment & Plan" editor there is no separate Assessment or Plan field to
 * find at all - which is exactly why the combined destination exists
 * (ap-1.0.0, live-verified 2026-08-26).
 *
 * THE CURE. The PHI-free census this driver already builds knows the two apart:
 * hetDiag.qualified is true only when a machine-typed athena stage frame bound
 * THIS patient's encounter, and hetDiag.noteTargetFound is false when the
 * requested section's own editor was not resolvable inside it. Frame bound +
 * section not found + no postGate stamp gets its own honest refusal code,
 * `note-section-not-on-surface`, whose sentence deliberately avoids the words
 * the app's still-painting predicate matches on. Every other zero-candidate
 * outcome keeps the exact answer it has today.
 *
 * NO GATE MOVES: the request is still refused, still blocked, nothing is read
 * or written beyond the same read-only pass, and no identity, scope, editor or
 * equality check is touched.
 *
 * ONE edit, background.js only; content.js is not touched. Single-line exact-
 * count anchor, CRLF-aware, ASCII-only insert. DO NOT RUN - Fable releases the
 * extension.
 */
'use strict';
var fs = require('fs');

function splice(file, edits) {
  var s = fs.readFileSync(file, 'latin1');
  var NL = /\r\n/.test(s) ? '\r\n' : '\n';
  edits.forEach(function (e, i) {
    var find = e.find.split('\n').join(NL);
    var repl = e.repl.split('\n').join(NL);
    if (/[^\x00-\x7f]/.test(e.repl)) { console.error('ABORT ' + file + ' edit ' + i + ': non-ASCII insert'); process.exit(1); }
    var n = s.split(find).length - 1;
    if (n !== e.n) { console.error('ABORT ' + file + ' edit ' + i + ': hits=' + n + ' expected ' + e.n + ' for: ' + e.find.slice(0, 90)); process.exit(1); }
    s = s.split(find).join(repl);
  });
  fs.writeFileSync(file, s, 'latin1');
  console.log('OK ' + file + ' (' + edits.length + ' edits)');
}

splice('background.js', [
  /* 1. the zero-candidate return tells the two refusals apart */
  { n: 1,
    find: "    if (candidates.length !== 1) return { ok: false, blocked: true, reason: candidates.length ? 'context-mismatch' : (mode === 'teach' && sawOtherPatient ? 'patient-mismatch' : 'context-unverified'), hetDiag: hetDiag, hetFrames: hetFrames, error: mode === 'teach' && sawOtherPatient ? 'The open Athena chart is not the patient in this review.' : 'Could not identify one exact patient encounter frame.' };",
    repl: "    /* secsurf-1.0.0 (3.0.109, measured live 2026-09-02): a named section whose\n" +
      "       OWN editor is not resolvable is not the same refusal as \"no encounter is\n" +
      "       open at all\", and answering both with context-unverified is what made the\n" +
      "       app pace and re-open forever against a surface that was already painted.\n" +
      "       qualified === true means a machine-typed stage frame bound THIS patient's\n" +
      "       encounter; noteTargetFound === false means the requested section's editor\n" +
      "       was not resolvable inside it; an unset postGate means no frame ever bound\n" +
      "       an editor and was dropped by a later gate (that is a different refusal).\n" +
      "       Still refused, still blocked, nothing read or written beyond this same\n" +
      "       read-only pass - only the sentence and the code get honest. */\n" +
      "    if (candidates.length === 0 && mode !== 'teach' && action === 'write_note' && requestedNoteSection && requestedNoteSection !== 'note' && hetDiag.qualified === true && hetDiag.noteTargetFound === false && !hetDiag.postGate) {\n" +
      "      return { ok: false, blocked: true, reason: 'note-section-not-on-surface', hetDiag: hetDiag, hetFrames: hetFrames, noteSection: requestedNoteSection, destination: NAMED_NOTE_DESTINATIONS[requestedNoteSection] || '', error: 'This encounter is open in athenaOne, but MLS could not resolve one exact editor for the reviewed section on the surface it is showing. Nothing was changed.' };\n" +
      "    }\n" +
      "    if (candidates.length !== 1) return { ok: false, blocked: true, reason: candidates.length ? 'context-mismatch' : (mode === 'teach' && sawOtherPatient ? 'patient-mismatch' : 'context-unverified'), hetDiag: hetDiag, hetFrames: hetFrames, error: mode === 'teach' && sawOtherPatient ? 'The open Athena chart is not the patient in this review.' : 'Could not identify one exact patient encounter frame.' };" }
]);
console.log('SPLICE 3.0.109 secsurf-1.0.0 DONE');
