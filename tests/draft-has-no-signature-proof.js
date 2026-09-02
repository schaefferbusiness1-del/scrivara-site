/* draftsig-1.0.0 — A DRAFT NEVER CARRIES A SIGNATURE LINE.
 *
 * OWNER-MEASURED, 2026-09-02 ~11:4x, a real visit in the owner's own tab:
 * the generated display note ended with "Electronically signed by:" followed by
 * NOTHING — an empty attestation on an UNSIGNED draft — and every generated
 * draft that day carried "Electronically signed by: <doctor name>" before the
 * doctor had signed anything. His words: "this is a stale UI element."
 *
 * CAUSE (located in the shipped source, both twins):
 *   applyVisitCommentToNote() ran withSignatureBlock() on GENERATION (and on
 *   every save and every Settings-save), and withSignatureBlock() appended the
 *   saved-credentials setting under a literal "Electronically signed by:" line
 *   unconditionally. Two separate wrongs fell out of that:
 *     (a) an attestation naming the doctor appeared on a note nobody had
 *         signed — the app asserting, in the chart text, something untrue;
 *     (b) with the credential setting EMPTY the shape that survived a round
 *         trip was a BARE label with no name under it, and stripSignatureBlock's
 *         pattern REQUIRED a newline after the colon — so the one shape the
 *         defect minted was the one shape strip could not remove. It persisted
 *         through save, reopen and re-generate for as long as it was there.
 *
 * CURE (draftsig-1.0.0):
 *   1. _signatureBlockArmed() — a gate that answers "has the doctor signed this
 *      note in MLS", from two independent witnesses signNote() writes: the
 *      `signed` badge state and a visible #signLine attestation sentence.
 *   2. withSignatureBlock() became a POLICY function: unarmed, it STRIPS.
 *      Every pre-existing caller became correct without moving, and a stale
 *      block carried in from an older save is removed on the next fold.
 *   3. signNote() folds the block in — the single moment the attestation is
 *      true — and un-folds it on the save-failed path.
 *   4. stripSignatureBlock() accepts the bare label too, so notes already
 *      saved with the defective shape round-trip clean.
 *
 * This suite lifts the SHIPPED functions out of BOTH twins (never copies them)
 * and proves each of those, plus the property the whole write lane rests on:
 * the athena derivation of a DRAFT is BYTE-IDENTICAL with and without a
 * signature block, so nothing downstream of the display note moved.
 *
 * EMPTY-CREDENTIAL RULING (stated out loud, per the owner's instruction to say
 * which was chosen): NO PLACEHOLDER. An empty credential appends nothing at
 * all, signed or not. There is never a bare "Electronically signed by:" line in
 * a note. The doctor is not left unattested by that choice — signNote() paints
 * the real attestation into #signLine ("Electronically signed by <name> on
 * <ts>. AI-generated - reviewed before signing."), which names the signer and
 * the timestamp, does not depend on this setting, and is what copy / download /
 * print / history already carry.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TWINS = ['1pScribeFlow.html', path.join('1p', 'index.html')];

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

function liftFn(src, name, rel) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, rel + ': shipped function ' + name + ' is missing');
  const i = src.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  assert.fail(rel + ': unbalanced braces lifting ' + name);
}

function liftAutodraftRegion(src, rel) {
  const a = src.indexOf('var AUTODRAFT_MARKER_TEXT');
  const b = src.indexOf('/* Per-visit row.');
  assert.ok(a > 0 && b > a, rel + ': autodraft constants/functions region is missing');
  return src.slice(a, b);
}

/* One context per case. `state` decides what the two witnesses of "signed" say
   and what the credential setting holds, exactly as the browser would. */
function buildContext(src, rel, state) {
  const st = state || {};
  const ctx = {
    console,
    currentSoap: '',
    currentInsurance: '',
    currentFormat: 'soap',
    signed: st.signed === true,
    _mlsSyncAthenaAfterStandardNoteMutation: () => true,
    getQolSignature: () => String(st.credential || ''),
    getVisitComment: () => String(st.comment || ''),
    document: {
      getElementById: (id) => {
        if (id === 'visitComment') return { value: String(st.comment || '') };
        if (id === 'signLine') {
          return {
            style: { display: st.signLineVisible ? 'block' : 'none' },
            textContent: st.signLineVisible ? String(st.signLineText || 'Electronically signed by Adam Smith, MD on 9/2/2026. AI-generated - reviewed before signing.') : '',
          };
        }
        return null;
      },
    },
    window: {},
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  vm.createContext(ctx);
  const pieces = [
    liftAutodraftRegion(src, rel),
    liftFn(src, 'stripSignatureBlock', rel),
    liftFn(src, '_signatureBlockArmed', rel),
    liftFn(src, 'withSignatureBlock', rel),
    liftFn(src, 'stripCommentBlock', rel),
    liftFn(src, 'withCommentBlock', rel),
    liftFn(src, 'applyVisitCommentToNote', rel),
    liftFn(src, '_mlsAthenaNoteQualityError', rel),
    liftFn(src, '_mlsAthenaBodyIsSubstantive', rel),
    liftFn(src, '_mlsValidateAthenaNote', rel),
    liftFn(src, '_mlsAthenaNoteWithVisitComment', rel),
  ];
  vm.runInContext(pieces.join('\n'), ctx, { filename: rel + '#draftsig-lift' });
  return ctx;
}

const FIVE = [
  'HPI:', 'Right knee pain for two weeks after a fall, worse with stairs.', '',
  'ROS:', 'Negative except as in HPI; no fevers, no numbness.', '',
  'EXAM:', 'Right knee with medial joint line tenderness, stable ligaments.', '',
  'ASSESSMENT:', 'Right knee medial meniscus strain, improving.', '',
  'PLAN:', 'Home exercise program and NSAIDs as needed; return in four weeks.',
].join('\n');
const CRED = 'Matthew W. Schaeffer, MD\nChester County Spine Care';
const OLD_LITERAL = '\n\nElectronically signed by:\n' + CRED;
const BARE_LITERAL = '\n\nElectronically signed by:';
/* The signature line, exactly as a reader sees it: the label at the start of a
   line. This is the predicate every case below is judged by. */
const SIG_LINE = /(^|\n)[ \t]*Electronically signed by:/;

function run(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');

  /* ---------------------------------------------------------------------
     1. A GENERATED DRAFT HAS NO SIGNATURE LINE — the owner's measurement.
     The credential IS saved (this is his machine); the note is not signed.
     --------------------------------------------------------------------- */
  {
    const ctx = buildContext(src, rel, { credential: CRED, signed: false, signLineVisible: false });
    ctx.currentSoap = FIVE;
    vm.runInContext('applyVisitCommentToNote()', ctx);
    ok(!SIG_LINE.test(ctx.currentSoap), rel + ': a generated draft must carry NO signature line');
    eq(ctx.currentSoap, FIVE, rel + ': the draft body must come through the fold byte-for-byte unchanged');
  }

  /* 1b. IDEMPOTENT: fold the draft again and again — still nothing. */
  {
    const ctx = buildContext(src, rel, { credential: CRED, signed: false, signLineVisible: false });
    ctx.currentSoap = FIVE;
    vm.runInContext('applyVisitCommentToNote();applyVisitCommentToNote();applyVisitCommentToNote()', ctx);
    ok(!SIG_LINE.test(ctx.currentSoap), rel + ': repeated folds of a draft must never mint a signature line');
  }

  /* 1c. A SETTINGS SAVE ON AN OPEN DRAFT CLEANS UP, it does not paint.
     saveSettings() calls applyVisitCommentToNote() "to refresh the signature on
     any open note"; a draft that already carries the defective bare line (a note
     saved before today) must come back CLEAN, not keep it. */
  {
    const ctx = buildContext(src, rel, { credential: CRED, signed: false, signLineVisible: false });
    ctx.currentSoap = FIVE + BARE_LITERAL;
    vm.runInContext('applyVisitCommentToNote()', ctx);
    ok(!SIG_LINE.test(ctx.currentSoap), rel + ': a stale bare signature line on a draft must be removed, not preserved');
    eq(ctx.currentSoap, FIVE, rel + ': removing the stale line must leave the body untouched');
  }
  {
    const ctx = buildContext(src, rel, { credential: CRED, signed: false, signLineVisible: false });
    ctx.currentSoap = FIVE + OLD_LITERAL;
    vm.runInContext('applyVisitCommentToNote()', ctx);
    ok(!SIG_LINE.test(ctx.currentSoap), rel + ': a stale NAMED signature line on a draft must be removed too');
  }

  /* ---------------------------------------------------------------------
     2. A SIGNED NOTE HAS EXACTLY ONE SIGNATURE LINE, CARRYING THE CREDENTIAL.
     Both witnesses are exercised on their own, because signNote() sets both and
     the history restore of a signed note sets both — either alone must arm.
     --------------------------------------------------------------------- */
  for (const witness of [{ signed: true, signLineVisible: false }, { signed: false, signLineVisible: true }]) {
    const label = witness.signed ? 'badge' : '#signLine';
    const ctx = buildContext(src, rel, Object.assign({ credential: CRED }, witness));
    ctx.currentSoap = FIVE;
    vm.runInContext('applyVisitCommentToNote()', ctx);
    const hits = String(ctx.currentSoap).split('Electronically signed by:').length - 1;
    eq(hits, 1, rel + ': a note signed in MLS (' + label + ' witness) must carry exactly one signature line');
    ok(ctx.currentSoap.endsWith('Electronically signed by:\n' + CRED),
      rel + ': the signed note must end with the label and the saved credential (' + label + ' witness)');
    /* signing twice, or saving a signed note repeatedly, must not duplicate it */
    vm.runInContext('applyVisitCommentToNote();applyVisitCommentToNote()', ctx);
    eq(String(ctx.currentSoap).split('Electronically signed by:').length - 1, 1,
      rel + ': re-saving a signed note must not duplicate the signature line (' + label + ' witness)');
  }

  /* ---------------------------------------------------------------------
     3. EMPTY CREDENTIAL -> NO LINE, EVEN WHEN SIGNED. No placeholder, and
     above all no bare "Electronically signed by:" — the exact defect shape.
     --------------------------------------------------------------------- */
  {
    const ctx = buildContext(src, rel, { credential: '', signed: true, signLineVisible: true });
    ctx.currentSoap = FIVE;
    vm.runInContext('applyVisitCommentToNote()', ctx);
    ok(!SIG_LINE.test(ctx.currentSoap), rel + ': an empty credential must append NOTHING even on a signed note');
    ok(ctx.currentSoap.indexOf('Electronically signed by') === -1,
      rel + ': there must never be a bare "Electronically signed by:" line, signed or not');
    eq(ctx.currentSoap, FIVE, rel + ': an empty credential must leave a signed note byte-for-byte unchanged');
  }
  {
    /* whitespace-only credential is empty too */
    const ctx = buildContext(src, rel, { credential: '   \n \t ', signed: true, signLineVisible: true });
    ctx.currentSoap = FIVE;
    vm.runInContext('applyVisitCommentToNote()', ctx);
    ok(!SIG_LINE.test(ctx.currentSoap), rel + ': a whitespace-only credential must append nothing');
  }

  /* ---------------------------------------------------------------------
     4. stripSignatureBlock STRIPS BOTH LITERALS.
     The old one (label, newline, credential block) so every note saved before
     today still round-trips, and the bare label the defect minted — which the
     old pattern could NOT remove, because it demanded a newline after the colon.
     --------------------------------------------------------------------- */
  {
    const ctx = buildContext(src, rel, { credential: CRED, signed: false, signLineVisible: false });
    const call = (arg) => { ctx.__s = arg; return vm.runInContext('stripSignatureBlock(__s)', ctx); };
    eq(call(FIVE + OLD_LITERAL), FIVE, rel + ': strip must remove the OLD literal (label + credential)');
    eq(call(FIVE + BARE_LITERAL), FIVE, rel + ': strip must remove the BARE label (the measured defect shape)');
    eq(call(FIVE + BARE_LITERAL + '   '), FIVE, rel + ': strip must remove a bare label with trailing spaces');
    eq(call(FIVE + '\nElectronically signed by:\n' + CRED), FIVE, rel + ': strip must not care how many blank lines precede the label');
    eq(call(FIVE), FIVE, rel + ': strip must leave a note with no signature alone');
    eq(call(''), '', rel + ': strip must tolerate an empty note');
    /* a strip is a strip is a strip */
    eq(call(call(FIVE + OLD_LITERAL) + BARE_LITERAL), FIVE, rel + ': strip must be idempotent across both shapes');
    /* and it must not eat clinical prose that merely mentions signing */
    const prose = FIVE + '\n\nThe prior operative report was electronically signed by the surgeon.';
    eq(call(prose), prose, rel + ': strip must not eat prose that mentions signing');
  }

  /* ---------------------------------------------------------------------
     5. THE ATHENA DERIVATION OF A DRAFT IS BYTE-IDENTICAL BEFORE AND AFTER.
     The write lane reads the display note through _mlsAthenaNoteWithVisitComment.
     Before draftsig-1.0.0 a draft arrived at that door WITH a signature block;
     after it, without one. If the door's output moved by a single byte the whole
     write lane moved with it. It does not: the door strips first.
     --------------------------------------------------------------------- */
  {
    const ctx = buildContext(src, rel, { credential: CRED, signed: false, signLineVisible: false });
    const door = (arg) => { ctx.__d = arg; return vm.runInContext('_mlsAthenaNoteWithVisitComment(__d)', ctx); };
    const after = door(FIVE);                    /* what a draft looks like now */
    const beforeNamed = door(FIVE + OLD_LITERAL);/* what a draft looked like yesterday */
    const beforeBare = door(FIVE + BARE_LITERAL);/* ...with an empty credential */
    ok(after && typeof after.text === 'string', rel + ': the athena derivation door must return note text');
    eq(beforeNamed.text, after.text, rel + ': athena_note must be byte-identical with and without the named signature block');
    eq(beforeBare.text, after.text, rel + ': athena_note must be byte-identical with and without the bare signature line');
    ok(after.text.indexOf('Electronically signed by') === -1, rel + ': athena_note must never carry a signature line');
  }

  /* ---------------------------------------------------------------------
     6. THE SHIPPED SOURCE SAYS SO — the gate exists, the sign path is the only
     thing that opens it, and the Settings help text is true.
     --------------------------------------------------------------------- */
  ok(/function withSignatureBlock\(text\)\{\s*const base=stripSignatureBlock\(text\);\s*if\(!_signatureBlockArmed\(\)\) return base;/.test(src),
    rel + ': withSignatureBlock must strip-and-return when the note is not signed in MLS');
  ok(src.indexOf("(text||'').replace(/\\n*Electronically signed by:[ \\t]*(?:\\n[\\s\\S]*)?$/,'')") > 0,
    rel + ': stripSignatureBlock must accept the bare label as well as the old literal');
  ok(/_signatureBlockArmed\(\)\{[\s\S]*typeof signed!=='undefined' && signed===true[\s\S]*getElementById\('signLine'\)/.test(src),
    rel + ': the gate must read both witnesses signNote() writes');
  {
    /* signNote() folds it in, and un-folds it when the save refuses */
    const sn = liftFn(src, 'signNote', rel);
    const foldAt = sn.indexOf("if(currentFormat==='soap'){ try{ applyVisitCommentToNote(); }catch(eSignFold){} }");
    const saveAt = sn.indexOf('if(saveCurrentNote(false)!==true){');
    const undoAt = sn.indexOf("if(currentFormat==='soap'){ try{ applyVisitCommentToNote(); }catch(eSignUnfold){} }");
    ok(foldAt > 0 && saveAt > foldAt, rel + ': signNote must fold the signature block in BEFORE it saves');
    ok(undoAt > saveAt, rel + ': signNote must un-fold the signature block when the save refuses');
    ok(sn.indexOf('line.textContent=`Electronically signed by ${name} on ${ts}') > 0 &&
      sn.indexOf('line.textContent=`Electronically signed by ${name} on ${ts}') < foldAt,
      rel + ': the #signLine attestation must be armed before the fold, or the gate would still be shut');
  }
  {
    /* GENERATION never opens the gate: the only appender is withSignatureBlock,
       and no call site of it may pre-arm the gate itself. */
    const appenders = src.split("'\\n\\nElectronically signed by:\\n'").length - 1;
    eq(appenders, 1, rel + ': exactly one place may render the signature block into a note');
    eq(src.split('function _signatureBlockArmed(').length - 1, 1,
      rel + ': the gate must be defined exactly once');
    eq(src.split('if(!_signatureBlockArmed())').length - 1, 1,
      rel + ': the gate must be consulted exactly once — inside withSignatureBlock');
  }
  ok(src.indexOf('Saved credentials added to the bottom of every generated note') === -1,
    rel + ': the Settings help text must no longer promise a block on every GENERATED note');
  ok(src.indexOf('Saved credentials added to the bottom of a note under an "Electronically signed by:" line when you sign it in MLS (Review &amp; Sign). A draft never carries one. Leave blank to append nothing.') > 0,
    rel + ': the Settings help text must say when the block is actually appended');
  ok(src.indexOf('>✍️ Provider signature block <span style="font-weight:400;color:var(--muted)">(appended when you sign)</span>') > 0,
    rel + ': the Settings field label must not say "appended to notes"');
}

TWINS.forEach(run);

/* The twins are not byte-identical documents, but this hunk must be identical
   in both — a fix that lands in one lane only is the defect the owner keeps
   paying for. */
{
  const bodies = TWINS.map((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    return ['stripSignatureBlock', '_signatureBlockArmed', 'withSignatureBlock']
      .map((n) => liftFn(src, n, rel)).join('\n');
  });
  eq(bodies[0], bodies[1], 'both twins must carry the identical draftsig-1.0.0 signature functions');
}

console.log('PASS draft-has-no-signature-proof — ' + checks + ' checks over ' + TWINS.length + ' twins: a generated draft carries no signature line; a signed note carries exactly one with the saved credential; an empty credential appends nothing (no placeholder, never a bare label); stripSignatureBlock removes the old literal AND the bare label; the athena derivation of a draft is byte-identical with and without a signature block');
