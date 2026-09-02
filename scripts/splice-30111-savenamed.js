/* splice-30111-savenamed.js - ext 3.0.111 savenamed-1.0.0.
 *
 * THE OWNER RULING (2026-09-02, verbatim): "unblock the save block in mls
 * assistant it should be able to do it if someone clicks save on mls site",
 * under the standing law "no one should have to touch Athena this entire
 * process, mls needs to be a perfect overlay". Sign stays the doctor's manual
 * click in athenaOne.
 *
 * THE BLOCK, MEASURED FROM THE SHIPPED CODE. background.js findNoteAction
 * (~691) resolves a Save control ONLY inside exactly one GENERIC encounter
 * note scope: explicitNoteScopes (~646) filters a machine selector list to
 * noteScopeStrength >= 3, noteScopeStrength refuses any scope whose visible
 * human label is outside the CLOSED GENERIC_NOTE_HUMAN_CORES allowlist (~620:
 * encounter note, clinical note, progress note, ...), that one scope must
 * contain exactly ONE editor, and the control's own label must equal save /
 * save draft / save note. A review that targets NAMED sections (Reviewed HPI,
 * ROS, Physical Exam, Assessment & Plan through uta-ap-note and friends - the
 * shape this practice actually has, proven live) has neither a single generic
 * scope nor a single editor, so findNoteAction returns null for save_draft.
 * And it never even gets that far: ~1170 refuses save_draft outright with
 * named-section-final-action-unsupported BEFORE the probe/execute split, so
 * there was no read-only verification of an encounter save to build on.
 *
 * WHAT THIS CHANGE ADDS. One more leg on the SAME supervised path - the same
 * candidate loop, the same patient banner / machine-typed stage context /
 * encounter id / appointment id / visit date / provider gates, the same
 * read-only probe, the same one-use action token, the same fresh-trusted-click
 * requirement in the handler, the same single executeBusy lane, the same
 * clickOnce boundary. The ONLY thing it drops is the generic-note-scope
 * requirement, which is the one reason a named-section review could not save.
 *
 * NO NEW REQUEST FIELD. The shape is declared by the request the app already
 * sends: `sections`. This leg is taken only when EVERY reviewed section is a
 * named destination (never 'note'), every one is execute:true, and every one
 * carries the exact NAMED_NOTE_DESTINATIONS string for its canonical key. Each
 * of those tuples (key, text, execute, destination) is inside notePayloadKey
 * (~2320), which is hashed into the one-use token and re-compared at execute,
 * so the shape cannot change between probe and execute.
 *
 * WHAT MAY BE CLICKED IS NARROWER, NEVER WIDER. The label contract is
 * exactSave itself - the SAME closed allowlist the generic save_draft leg
 * uses (save / save draft / save note, with its own sign|submit|post|bill|
 * charge|claim|delete|discard|void ban) - PLUS a second closed ban that also
 * refuses order, close, finalize and attest, PLUS wsForbiddenControl, PLUS a
 * region ban that refuses any control inside an orders / billing / charges /
 * claims / prescription / medication / signature region, PLUS clickOnce at the
 * mutation boundary. Sign & Save, Sign, Close encounter and Bill are refused
 * by construction and are never clicked.
 *
 * VERIFIED MEANS READ BACK. The execute leg answers verified/saved ONLY when
 * newScopedStatus - the extension's one existing piece of knowledge about how
 * these stage surfaces announce a save - sees a NEWLY CREATED status node
 * carrying the same closed phrase set the generic save_draft leg has shipped
 * with. Anything else is save-readback-missing with partialMutation:true.
 *
 * SEVEN edits, background.js only; content.js is NOT touched (its batch arm
 * already allows write_note and save_draft, and its save_draft confirm-label
 * matcher already accepts the app's aria-label 'Confirm save draft in Athena').
 *
 * LINE ENDINGS - READ THIS BEFORE COPYING THIS SCRIPT. background.js is NOT a
 * uniform CRLF file: it mixes CRLF and bare-LF terminators. So each edit here
 * detects the terminator of ITS OWN anchor line and joins the inserted lines
 * with that. Everything else keeps the proven shape: latin1 in, exact
 * single-line anchor, exact occurrence count (abort otherwise), ASCII-only
 * insert, latin1 out, print what it did.
 *
 * IDEMPOTENCE: refuses to run twice - aborts if the savenamed-1.0.0 marker is
 * already present.
 *
 * DO NOT RUN AS PART OF A RELEASE - the coordinator releases the extension.
 */
'use strict';
var fs = require('fs');

var LF = String.fromCharCode(10);
var CR = String.fromCharCode(13);

/* Split into lines that KEEP their own terminator, so a mixed-EOL file
   round-trips byte-for-byte through join(''). */
function splitKeepEol(s) {
  var out = [], start = 0, i;
  for (i = 0; i < s.length; i++) {
    if (s.charAt(i) === LF) { out.push(s.slice(start, i + 1)); start = i + 1; }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}
function bodyOf(line) {
  var b = line;
  if (b.charAt(b.length - 1) === LF) b = b.slice(0, -1);
  if (b.charAt(b.length - 1) === CR) b = b.slice(0, -1);
  return b;
}
function eolOf(line) {
  if (line.charAt(line.length - 1) !== LF) return '';
  return (line.charAt(line.length - 2) === CR) ? (CR + LF) : LF;
}

function splice(file, marker, edits) {
  var s = fs.readFileSync(file, 'latin1');
  if (s.indexOf(marker) >= 0) {
    console.error('ABORT ' + file + ': marker ' + marker + ' is already present - this splice has already run');
    process.exit(1);
  }
  var lines = splitKeepEol(s);
  edits.forEach(function (e, i) {
    var joined = e.lines.join(LF);
    if (/[^\x00-\x7f]/.test(joined)) { console.error('ABORT ' + file + ' edit ' + i + ': non-ASCII insert'); process.exit(1); }
    if (/[\r\n]/.test(e.find)) { console.error('ABORT ' + file + ' edit ' + i + ': anchor is not a single line'); process.exit(1); }
    var at = -1, n = 0, j;
    for (j = 0; j < lines.length; j++) { if (bodyOf(lines[j]) === e.find) { n++; at = j; } }
    if (n !== e.n) { console.error('ABORT ' + file + ' edit ' + i + ': hits=' + n + ' expected ' + e.n + ' for: ' + e.find.slice(0, 90)); process.exit(1); }
    var eol = eolOf(lines[at]) || LF;
    var block = e.lines.map(function (t) { return t + eol; }).join('');
    if (e.where === 'before') lines[at] = block + lines[at];
    else lines[at] = lines[at] + block;
    console.log('  edit ' + i + ': ' + e.where + ' line ' + (at + 1) + ' (' + (eol === LF ? 'LF' : 'CRLF') + '), +' + e.lines.length + ' lines');
  });
  fs.writeFileSync(file, lines.join(''), 'latin1');
  console.log('OK ' + file + ' (' + edits.length + ' edits)');
}

var EDITS = [
  /* 0. the encounter-save finder and its closed allowlists. Placed with the
        other note-action finders, inside the note-scope region, so everything
        it leans on (norm, label, interactive, exactSave, wsForbiddenControl,
        parentAcrossRoots) is the SAME helper the shipped legs use. It resolves
        a control; it decides nothing about identity - the candidate loop's
        unchanged gates do that, above and below the call site. */
  {
    n: 1,
    where: 'after',
    find: "    /* ATHENA_ACTION_V2_NOTE_SCOPE_END */",
    lines: [
      "    /* ATHENA_ACTION_V2_SAVENAMED_HELPERS_START */",
      "    /* savenamed-1.0.0 (3.0.111, owner ruling 2026-09-02) - the",
      "       encounter-level Save for a review that placed NAMED Athena sections.",
      "       findNoteAction can only see a Save that sits inside exactly one",
      "       GENERIC encounter-note scope holding exactly one editor, and the",
      "       named-section surface has neither, so a practice whose reviews are",
      "       HPI/ROS/Exam/Assessment-and-Plan could not reach ANY save at all.",
      "       This finder drops that generic-scope requirement and NOTHING else.",
      "       WHAT MAY BE CLICKED STAYS NARROWER THAN THE GENERIC LEG:",
      "         - exactSave: the label core must EQUAL save / save draft / save",
      "           note, and its own ban already refuses sign, submit, post, bill,",
      "           charge, claim, delete, discard and void;",
      "         - SNV_FORBIDDEN_SAVE_LABEL: additionally refuses order, close,",
      "           finalize and attest, so Sign & Save, Sign, Close encounter and",
      "           Bill are structurally unreachable;",
      "         - wsForbiddenControl: the shipped final/irrevocable-control ban;",
      "         - SNV_BANNED_REGION: refuses a control that lives anywhere inside",
      "           an orders, billing, charges, claims, prescription, medication or",
      "           signature region, so a Save button belonging to some other",
      "           workspace inside the same frame can never be taken;",
      "         - exactly ONE surviving candidate, or the leg refuses.",
      "       Identity is NOT this finder's job and it does not attempt it: it is",
      "       called from inside the candidate loop, AFTER the patient banner and",
      "       machine-typed stage-context gates and BEFORE the encounter-id,",
      "       appointment-id, visit-date and provider gates, so the control it",
      "       returns either belongs to the one bound encounter or its candidate",
      "       is dropped by those unchanged gates. */",
      "    var SNV_SAVE_CORES = { 'save': 1, 'save draft': 1, 'save note': 1 };",
      "    var SNV_FORBIDDEN_SAVE_LABEL = /\\b(sign|bill|billing|order|orders|close|finalize|finalise|attest|submit|post|charge|charges|claim|claims|delete|discard|void|cancel)\\b/;",
      "    var SNV_BANNED_REGION = /\\b(order|orders|billing|charge|charges|claim|claims|prescription|prescriptions|medication|medications|erx|e rx|sign|signature|signoff|attest|finalize|finalise)\\b/;",
      "    var SNV_ENCOUNTER_REGION = /\\b(encounter|visit|clinical|chart|documentation|note)\\b/;",
      "    function snvLabelSources(el) {",
      "      var raw = [];",
      "      try { raw = [el.textContent, el.value, el.getAttribute && el.getAttribute('aria-label'), el.getAttribute && el.getAttribute('title')].filter(function (v) { return String(v || '').trim(); }); } catch (eSnvLs) {}",
      "      if (!raw.length) raw = [label(el)];",
      "      return raw.map(norm);",
      "    }",
      "    function snvSaveCore(el) {",
      "      /* The receipt's control name is a member of the CLOSED allowlist or",
      "         the empty string - never free text lifted off the page. */",
      "      var src = snvLabelSources(el), i;",
      "      for (i = 0; i < src.length; i++) if (SNV_SAVE_CORES[src[i]] === 1) return src[i];",
      "      return '';",
      "    }",
      "    function snvForbiddenSaveLabel(el) {",
      "      var src = snvLabelSources(el), i;",
      "      for (i = 0; i < src.length; i++) if (SNV_FORBIDDEN_SAVE_LABEL.test(src[i])) return true;",
      "      return false;",
      "    }",
      "    function snvOwnDescriptor(el) {",
      "      /* The element's OWN machine attributes only - deliberately NOT",
      "         scopeDescriptor, which also sweeps up descendant headings. A",
      "         container that inherited its children's headings would let one",
      "         Orders card inside the encounter ban the whole encounter, and would",
      "         let an outer shell's heading text vouch for a region it does not",
      "         own. */",
      "      var out = '';",
      "      try { out = [el.id, el.getAttribute && el.getAttribute('name'), el.getAttribute && el.getAttribute('aria-label'), el.getAttribute && el.getAttribute('data-testid'), el.getAttribute && el.getAttribute('data-component'), String(el.className || '')].join(' '); } catch (eSnvOd) {}",
      "      return norm(out);",
      "    }",
      "    function snvScopeTag(el) {",
      "      /* A PHI-free name for the region the control was found in: the",
      "         container's own machine attributes with every digit run removed, so",
      "         no id - and therefore no MRN- or encounter-shaped number - can ride",
      "         into a receipt. Capped at 80 characters. */",
      "      return snvOwnDescriptor(el).replace(/[0-9]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 80);",
      "    }",
      "    function snvSaveScope(frame, control) {",
      "      var cur = control, guard = 0, scope = null;",
      "      while (cur && guard++ < 12) {",
      "        var snvD = snvOwnDescriptor(cur);",
      "        if (SNV_BANNED_REGION.test(snvD)) return null;",
      "        if (!scope && SNV_ENCOUNTER_REGION.test(snvD)) scope = cur;",
      "        cur = parentAcrossRoots(cur);",
      "      }",
      "      if (scope) return scope;",
      "      try { return (frame && frame.doc && frame.doc.body) || null; } catch (eSnvSc) { return null; }",
      "    }",
      "    function snvFindEncounterSave(frame) {",
      "      var all = [], accepted = [], refused = 0, i, snvScope;",
      "      try { all = interactive(frame.doc, frame.w); } catch (eSnvAll) { all = []; }",
      "      for (i = 0; i < all.length; i++) {",
      "        if (!exactSave(all[i])) continue;",
      "        if (snvForbiddenSaveLabel(all[i]) || wsForbiddenControl(all[i])) { refused++; continue; }",
      "        snvScope = snvSaveScope(frame, all[i]);",
      "        if (!snvScope) { refused++; continue; }",
      "        accepted.push({ control: all[i], editor: all[i], root: snvScope, strength: 3, encounterSave: true, labelCore: snvSaveCore(all[i]) });",
      "      }",
      "      var snvWhy = accepted.length === 1 ? 'found' : (accepted.length > 1 ? 'save-control-ambiguous' : (refused ? 'forbidden-control' : 'save-control-not-found'));",
      "      if (hetDiag.savenamed !== 'found') hetDiag.savenamed = snvWhy;",
      "      return accepted.length === 1 ? accepted[0] : null;",
      "    }",
      "    /* ATHENA_ACTION_V2_SAVENAMED_HELPERS_END */"
    ]
  },
  /* 1. the shape flag. Computed from the request the app ALREADY sends - no
        new field - and therefore already bound into the one-use token through
        notePayloadKey, so it cannot differ between probe and execute. */
  {
    n: 1,
    where: 'after',
    find: "    var requestedNoteSection = 'note';",
    lines: [
      "    /* ===== savenamed-1.0.0 (3.0.111) ==================================",
      "       OWNER RULING 2026-09-02, verbatim on the next line:",
      "         unblock the save block in mls assistant it should be able to do it",
      "         if someone clicks save on mls site",
      "       - a trusted press on the MLS site may drive athenaOne's encounter",
      "       Save (save DRAFT) for the reviews that write named sections. Sign",
      "       stays the doctor's manual click in athenaOne.",
      "       THE SHAPE IS DECLARED BY THE REQUEST ITSELF - there is NO new field.",
      "       The app already sends the reviewed destinations in `sections`, and",
      "       every one of those tuples (key, text, execute, destination) is inside",
      "       notePayloadKey, which is hashed into the one-use action token and",
      "       re-compared byte for byte at execute - so the shape a probe verified",
      "       is provably the shape an execute runs.",
      "       This leg is taken ONLY when EVERY reviewed section is a named Athena",
      "       destination (never 'note'), every one is execute:true, and every one",
      "       carries the exact reviewed NAMED_NOTE_DESTINATIONS string for its",
      "       canonical key. A generic or mixed shape, and every teach request,",
      "       keep the shipped behaviour byte for byte. */",
      "    var snvNamedSave = false;",
      "    try {",
      "      snvNamedSave = action === 'save_draft' && mode !== 'teach' && noteSections.length > 0 && noteSections.every(function (section) {",
      "        var snvKey = canonicalNamedNoteKey(section && section.key);",
      "        return !!snvKey && snvKey !== 'note' && section.execute === true && text(section.destination) === NAMED_NOTE_DESTINATIONS[snvKey];",
      "      });",
      "    } catch (eSnvShape) { snvNamedSave = false; }"
    ]
  },
  /* 2. the shipped refusal keeps every OTHER named-section final action. Only
        the exact all-named save_draft shape walks past it. */
  {
    n: 1,
    where: 'before',
    find: "      return { ok: false, blocked: true, reason: 'named-section-final-action-unsupported', error: 'Review and save independently placed named sections directly in Athena.' };",
    lines: [
      "      /* savenamed-1.0.0: this refusal still owns every OTHER named-section",
      "         final action - sign_encounter ALWAYS, and any save_draft whose",
      "         reviewed shape is generic or mixed. The one shape declared above",
      "         walks past it into the same probe/execute split, the same identity",
      "         gates and the same one-use token every note write already uses.",
      "         The guard is a bare if on its own line so the shipped refusal line",
      "         below stays byte-identical. */",
      "      if (!snvNamedSave)"
    ]
  },
  /* 3. resolve the encounter Save instead of the generic note action. Every
        identity gate above and below this line is untouched. */
  {
    n: 1,
    where: 'before',
    find: "        noteTarget = (action === 'write_note' && requestedNoteSection !== 'note') ? findNamedNoteAction(fr, action, requestedNoteSection) : findNoteAction(fr, action);",
    lines: [
      "        /* savenamed-1.0.0: a named-section surface has no generic",
      "           encounter-note scope for findNoteAction to resolve, so the",
      "           encounter Save is resolved by its own closed-allowlist finder.",
      "           Everything else in this loop is unchanged: the patient banner and",
      "           machine-typed stage-context gates already ran ABOVE this line, and",
      "           the encounter-id, appointment-id, visit-date and provider gates",
      "           all still run BELOW it, so this control belongs to the one bound",
      "           encounter or its candidate is dropped. */",
      "        if (snvNamedSave) noteTarget = snvFindEncounterSave(fr); else"
    ]
  },
  /* 4. the reviewed-value admission gate does not apply to the save leg. */
  {
    n: 1,
    where: 'before',
    find: "        if (mode !== 'teach' && action !== 'write_note' && currentNote !== reviewedNote) {",
    lines: [
      "        /* savenamed-1.0.0: this admission gate asks one editor to already",
      "           hold the whole reviewed note. On a named-section surface the",
      "           reviewed text lives in the SEVERAL section editors the write rows",
      "           already placed and read back one at a time, and athenaOne shows",
      "           only the open stage tab's section at once, so the question is not",
      "           answerable here and asking it would refuse every save forever.",
      "           It is skipped for that one leg and for nothing else; every",
      "           ENCOUNTER gate below still runs. What binds the content is the",
      "           one-use token: it carries the exact reviewed sections and is",
      "           re-compared at execute. */",
      "        if (!snvNamedSave)"
    ]
  },
  /* 5. closed refusal codes, in the shape secsurf-1.0.0 already established
        for a named-section outcome that is not the same thing as "no encounter
        is open at all". */
  {
    n: 1,
    where: 'before',
    find: "    if (candidates.length !== 1) return { ok: false, blocked: true, reason: candidates.length ? 'context-mismatch' : (mode === 'teach' && sawOtherPatient ? 'patient-mismatch' : 'context-unverified'), hetDiag: hetDiag, hetFrames: hetFrames, error: mode === 'teach' && sawOtherPatient ? 'The open Athena chart is not the patient in this review.' : 'Could not identify one exact patient encounter frame.' };",
    lines: [
      "    /* savenamed-1.0.0: the encounter-save leg answers its own outcomes with",
      "       CLOSED codes instead of the one generic context-unverified sentence,",
      "       so the app can name what actually happened and the doctor is not sent",
      "       to look for an encounter that is open. encounter-mismatch is read off",
      "       the SAME hetDiag.postGate the write lane already sets when the bound",
      "       frame's encounter or appointment id does not equal the reviewed one;",
      "       the other three come from the finder above. Nothing here is clicked,",
      "       read or written - this is the same read-only pass. Any other outcome",
      "       still falls through to the unchanged refusal below. */",
      "    if (snvNamedSave && candidates.length === 0) {",
      "      var snvGate = String(hetDiag.postGate || ''), snvWhy = String(hetDiag.savenamed || '');",
      "      if (snvGate === 'encounter-id' || snvGate === 'appointment-id') return { ok: false, blocked: true, action: action, savenamed: true, encounterMatched: false, reason: 'encounter-mismatch', hetDiag: hetDiag, hetFrames: hetFrames, error: 'The encounter open in athenaOne is not the encounter in this review. Nothing was saved.', noAutomaticChaining: 'no-automatic-chaining' };",
      "      if (snvWhy === 'save-control-ambiguous') return { ok: false, blocked: true, action: action, savenamed: true, encounterMatched: snvGate === 'pushed', reason: 'save-control-ambiguous', hetDiag: hetDiag, hetFrames: hetFrames, error: 'More than one Save control is showing in this encounter, so MLS cannot tell which one saves it. Save it in athenaOne. Nothing was changed.', noAutomaticChaining: 'no-automatic-chaining' };",
      "      if (snvWhy === 'forbidden-control') return { ok: false, blocked: true, action: action, savenamed: true, encounterMatched: snvGate === 'pushed', reason: 'forbidden-control', hetDiag: hetDiag, hetFrames: hetFrames, error: 'The only Save-like control MLS can see in this encounter is a Sign, billing, order or close control. MLS will never click one. Nothing was changed.', noAutomaticChaining: 'no-automatic-chaining' };",
      "      if (snvWhy === 'save-control-not-found') return { ok: false, blocked: true, action: action, savenamed: true, encounterMatched: snvGate === 'pushed', reason: 'save-control-not-found', hetDiag: hetDiag, hetFrames: hetFrames, error: 'MLS could not see one exact Save control in the open encounter. Nothing was changed.', noAutomaticChaining: 'no-automatic-chaining' };",
      "    }"
    ]
  },
  /* 6. the read-only probe answer. Same ok/contextVerified/context shape the
        caller mints its one-use token from, plus the closed control receipt. */
  {
    n: 1,
    where: 'before',
    find: "    if (mode === 'probe') return { ok: true, mode: 'probe', action: action, readOnly: true, reason: action === 'stage_billing' ? 'billing-context-verified' : (action === 'place_order' ? 'order-workspace-context-verified' : 'context-verified'), contextVerified: true, context: context, noAutomaticChaining: 'no-automatic-chaining' };",
    lines: [
      "    /* savenamed-1.0.0: the encounter-save probe is READ-ONLY exactly like",
      "       every other probe on this path. It has already resolved the one exact",
      "       Save control and passed every identity gate above, and it clicks",
      "       nothing - the mutation boundary is still further down, behind the",
      "       one-use token and the handler's fresh-trusted-click requirement. It",
      "       answers the same ok / contextVerified / context shape the caller mints",
      "       that token from, and adds only PHI-free receipt fields: labelCore is a",
      "       member of the closed save allowlist by construction, scope is the",
      "       region's machine attributes with every digit removed, and",
      "       encounterMatched states that the reviewed encounter is the open one. */",
      "    if (snvNamedSave && mode === 'probe') return { ok: true, mode: 'probe', action: action, readOnly: true, reason: 'context-verified', contextVerified: true, context: context, savenamed: true, encounterMatched: true, sectionsDeclared: noteSections.length, control: { labelCore: snvSaveCore(actionControl), scope: snvScopeTag(actionScope) }, noAutomaticChaining: 'no-automatic-chaining' };"
    ]
  },
  /* 7. the execute leg. Placed AFTER clickOnce and BEFORE the shipped generic
        save_draft block, which stays exactly as it is for the old shape. */
  {
    n: 1,
    where: 'before',
    find: "    /* ATHENA_ACTION_V2_SAVE_DRAFT_START */",
    lines: [
      "    /* ATHENA_ACTION_V2_SAVENAMED_EXECUTE_START */",
      "    /* savenamed-1.0.0 (3.0.111, owner ruling 2026-09-02): a trusted press on",
      "       the MLS site drives athenaOne's encounter Save for a review that",
      "       placed NAMED sections. This block adds NO authorization of its own.",
      "       Everything that authorizes this click already happened and is",
      "       unchanged: the read-only probe above minted a one-use action token",
      "       bound to this exact patient, encounter and reviewed section payload;",
      "       the handler refused to inject execute without a FRESH TRUSTED CLICK",
      "       (userGesture + gestureProof, or a consumed batch-hash item from the",
      "       same trusted click), re-checked every token equality, re-queried the",
      "       Athena tab, and took the single executeBusy lane; and this driver then",
      "       re-ran the whole candidate loop and every identity gate against the",
      "       live DOM before reaching this line.",
      "       WHY IT CANNOT REACH A SIGN CONTROL. The label allowlist is CLOSED and",
      "       is re-checked here, immediately before the click, because the DOM can",
      "       repaint between probe and execute: exactSave requires the label core",
      "       to EQUAL save / save draft / save note; SNV_FORBIDDEN_SAVE_LABEL",
      "       additionally refuses any label containing sign, bill, order, close,",
      "       finalize or attest; wsForbiddenControl refuses every final or",
      "       irrevocable control; and clickOnce refuses again at the boundary. Sign",
      "       & Save, Sign, Close encounter and Bill are unreachable by",
      "       construction. Orders, billing, diagnoses and Sign remain the doctor's",
      "       manual click in athenaOne, and nothing is chained after this one.",
      "       THE READ-BACK SIGNAL, AND WHY IT CANNOT MISFIRE. newScopedStatus is",
      "       the extension's ONE existing piece of knowledge about how these stage",
      "       surfaces announce a save, and this leg reuses it verbatim, with the",
      "       same closed phrase set the generic save_draft leg has shipped with",
      "       (draft saved / note saved / saved successfully / changes saved). Its",
      "       rule is the strong one: the status node must be NEWLY CREATED after",
      "       our click - a pre-existing node that merely changes its text does NOT",
      "       count, which is what makes athenaOne's reused global toast nodes",
      "       unable to vouch for us. The phrase set is closed, so unrelated",
      "       athenaOne copy cannot satisfy it. The roots are this bound encounter's",
      "       own scope plus its frame, and that frame is machine-bound to the",
      "       expected patient's encounter while the single executeBusy lane",
      "       guarantees nothing else of ours is running in it. The extension",
      "       carries no knowledge of an athenaOne unsaved/dirty marker, so none is",
      "       asserted here. No signal inside the window is reported honestly as",
      "       save-readback-missing with partialMutation:true - the click happened",
      "       and only the confirmation is missing; nothing claims a verified save. */",
      "    if (snvNamedSave && action === 'save_draft') {",
      "      if (!exactSave(actionControl) || snvForbiddenSaveLabel(actionControl) || wsForbiddenControl(actionControl)) {",
      "        return { ok: false, blocked: true, action: action, attempted: false, verified: false, saved: false, savenamed: true, encounterMatched: true, control: { labelCore: snvSaveCore(actionControl), scope: snvScopeTag(actionScope) }, reason: 'forbidden-control', error: 'The control MLS bound for this encounter save is a Sign, billing, order or close control. MLS will never click one. Nothing was changed.', context: context, noAutomaticChaining: 'no-automatic-chaining' };",
      "      }",
      "      var snvRoots = [actionScope];",
      "      try { if (hit.frame.doc && hit.frame.doc.body && hit.frame.doc.body !== actionScope) snvRoots.push(hit.frame.doc.body); } catch (eSnvRoots) {}",
      "      var snvBefore = statusEvidenceSnapshot(snvRoots);",
      "      mutationAttempted = true;",
      "      clickOnce(actionControl);",
      "      await sleep(1400);",
      "      var snvSaved = newScopedStatus(snvBefore, snvRoots, /\\b(draft saved|note saved|saved successfully|changes saved)\\b/);",
      "      var snvReceipt = { action: action, attempted: true, savenamed: true, encounterMatched: true, sectionsDeclared: noteSections.length, control: { labelCore: snvSaveCore(actionControl), scope: snvScopeTag(actionScope) }, signed: false, context: context, noAutomaticChaining: 'no-automatic-chaining' };",
      "      if (!snvSaved) return Object.assign(snvReceipt, { ok: false, verified: false, saved: false, partialMutation: true, reason: 'save-readback-missing', error: 'MLS pressed the encounter Save control, but athenaOne did not paint a saved confirmation MLS can read. Check the open encounter in athenaOne before treating this review as saved.' });",
      "      return Object.assign(snvReceipt, { ok: true, verified: true, saved: true, partialMutation: false, reason: 'exact-save-control-context-verified' });",
      "    }",
      "    /* ATHENA_ACTION_V2_SAVENAMED_EXECUTE_END */"
    ]
  }
];

/* Running this file splices. REQUIRING it only hands over the declared edits,
   so tests/savenamed-splice-proof.js can rebuild the pre-splice file from a
   background.js that already carries this change and prove the shipped bytes
   are exactly what this script produces. Nothing is written on require. */
if (require.main === module) {
  splice('background.js', 'savenamed-1.0.0', EDITS);
  console.log('SPLICE 3.0.111 savenamed-1.0.0 DONE');
} else {
  module.exports = { MARKER: 'savenamed-1.0.0', TARGET: 'background.js', EDITS: EDITS, splitKeepEol: splitKeepEol, bodyOf: bodyOf, eolOf: eolOf };
}
