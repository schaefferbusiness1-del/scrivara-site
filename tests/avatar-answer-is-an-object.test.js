'use strict';
/*
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ANSWER IS AN OBJECT — ONE TURN MACHINE, ONE OWNER OF THE ANSWER BOUNDARY (av-6.4.0)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Owner, twice: "it litterly never gets out everyhting it wants to say caosue it picks up its own
 * talking and then everyhting gets so fucked up" and "fix the overlaying text to".
 *
 * SEVEN PATCH ROUNDS FAILED. Four of them moved a BOUNDARY, and every boundary cut where the
 * meaning lives, because English puts negation ("no", "not", "never", "denies") and laterality
 * ("left", "right") at the LEADING EDGE. Whichever fragment is dropped, what remains reads as
 * fluent, plausible and INVERTED, with no marker that anything was removed:
 *     "no pain in my left leg"  filed as  "pain in my left leg".
 * A clinician reading the chart cannot tell. That is a wrong-site / wrong-finding error under a
 * green receipt, which is why this file's controls are byte-exact string comparisons and not
 * shape matches.
 *
 * ⛔ EVERYTHING HERE IS EXECUTED, NOT MATCHED. tests/avatar-turn-machine-lib.js lifts the real
 * speech/turn range out of feat_mls_avatar.js and runs it in a vm against a fake recogniser in
 * BOTH shapes platforms actually deliver. A reimplementation would test my copy of the product.
 *
 * ⛔ THE CONTROL IS THE REAL PRE-FIX BYTES, NOT A SYNTHETIC MUTANT. The same probe runs against
 * three checkouts and the FILED STRINGS are diffed:
 *       MLS_AVATAR_MAIN=<path>   origin/main   — round 5, LIVE IN PRODUCTION TODAY
 *       MLS_AVATAR_R7=<path>     wip/avatar-speech-round6 tip 5b92872b — round 7, the failed work
 * Each control below states which of those it FAILS ON BY NAME. Where a control file is not
 * supplied the control is SKIPPED AND SAID SO OUT LOUD — a skipped control is reported, never
 * silently counted as a pass. (Running the same probe against old and new and diffing the filed
 * text is what exposed rounds 6 and 7 claiming a fix that changed nothing.)
 *
 * ═══ POPULATION STATEMENTS — WHAT EACH GROUP ENUMERATES AND WHO CHOSE IT ═══════════════════════
 *   THE LIFT            derived from the file: from the first present start marker to the FACE
 *                       banner after pvListen. Endpoints chosen by me and asserted present;
 *                       contents chosen by the module.
 *   RECOGNISER SHAPES   derived from the platform contract, not from taste: `resultIndex` either
 *                       advances (Chrome, continuous:true) or is always 0 with the list
 *                       re-delivered (non-continuous, polyfills, and round 7's own fake, whose
 *                       comment named the shape). Both, every scenario. A build that survives one
 *                       shape is not fixed.
 *   THE FOUR CONTROLS   CHOSEN BY THE ORCHESTRATOR AND MANDATED PERMANENT: "no pain in my left
 *                       leg", "not the right one", "never on the left side", "denies chest pain".
 *                       They are the four English shapes that INVERT when their head is dropped.
 *                       Not a sample — a fixed list, and it may only grow.
 *   THE REAL ANSWERS    also mandated: "in the morning", "the left one", "yes". They exist so an
 *                       over-refusing round fails HERE. Round 7 refused all four negation
 *                       controls as "overlap"; that is why it was a net regression.
 *   BOUNDARY WRITERS    DERIVED by scanning the whole file for assignments to AvFloor.tok — not a
 *                       list of places I remembered. Three separate defects in this lane were
 *                       hand-written populations that omitted what their author forgot.
 *   SPEECH STOPPERS     DERIVED: every function name in the file matching a stop-speech shape,
 *                       intersected with the bodies of the microphone-derived handlers.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ⛔ ASSERTIONS THIS CHANGE HAD TO MOVE, QUOTED VERBATIM, WITH THE REASON — see the final section.
 * Round 7 deleted an assertion and the product then failed it. Nothing here is weakened silently.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const lib = require('./avatar-turn-machine-lib.js');

const root = path.resolve(__dirname, '..');
const SRC = lib.readSource();
const H = () => lib.makeHarness(SRC);

/* the mandated permanent controls. THIS LIST MAY GROW AND MAY NEVER SHRINK. */
const NEGATION_CONTROLS = [
  'no pain in my left leg',
  'not the right one',
  'never on the left side',
  'denies chest pain',
];
const REAL_ANSWER_CONTROLS = ['in the morning', 'the left one', 'yes'];
const QUESTION = 'Which leg is it - is there any pain in your left leg?';
const notes = [];

/* ⚠️ CROSS-REALM ARRAYS ARE NOT HOST ARRAYS. The harness runs the module in a vm, so everything it
   returns has the vm's own Array/Object prototypes and assert.deepStrictEqual compares prototypes:
   it reported ['no pain in my left leg'] as unequal to ['no pain in my left leg']. Copied across
   the realm boundary once, here, so every comparison below is a real byte comparison of real
   strings and a green result cannot be an artifact of the instrument. */
function host(v) { return JSON.parse(JSON.stringify(v)); }
function logOf(h) { return host(h.log()); }

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   0. THE MACHINE EXISTS, AND THE HEADER NAMES ROUNDS 4-7 SO A LATER ROUND CANNOT RE-SPLIT IT
   ═════════════════════════════════════════════════════════════════════════════════════════════ */
{
  assert.ok(/function AvAnswer\(tok, rec\)/.test(SRC),
    'AvAnswer is gone — the answer is a string again, and a string cannot carry the boundary fact');
  assert.ok(/var AvFloor = \{/.test(SRC), 'AvFloor is gone — nothing owns where an answer began');
  const hdr = SRC.indexOf('THE ANSWER IS AN OBJECT: ONE TURN MACHINE');
  assert.ok(hdr > 0, 'the turn machine has lost its header, so the next round has no warning');
  const block = SRC.slice(hdr, hdr + 4200);
  for (const r of ['ROUND 4', 'ROUND 5', 'ROUND 6', 'ROUND 7']) {
    assert.ok(block.indexOf(r) >= 0,
      'the machine header no longer names ' + r + '. Four rounds each re-derived a finer boundary ' +
      'because nothing in the file told them why the last one failed; the header IS the fence ' +
      'against a fifth.');
  }
  assert.ok(/NEVER EDITED, TRIMMED|NEVER EDITED|never sliced|NEVER EDITED, TRIMMED, SPLICED/i.test(block) ||
    /A TRANSCRIPT IS NEVER EDITED, TRIMMED, SPLICED, REORDERED OR PARTIALLY FILED/.test(block),
    'the patient-safety rule ("accept the whole thing or refuse the whole thing") left the header');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   1. ONE OWNER OF THE BOUNDARY — THE WRITER POPULATION IS DERIVED FROM THE WHOLE FILE
   ═════════════════════════════════════════════════════════════════════════════════════════════
   POPULATION: every line in the file (comments blanked) that assigns to AvFloor.tok. Not a list of
   call sites I typed. Each one must sit inside AvFloor.open or AvFloor.shut — the two functions
   the design declares as the only writers. */
{
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const openAt = code.indexOf('    open: function () {');
  const shutAt = code.indexOf('    shut: function (reason) {');
  const tokenAt = code.indexOf('    tokenNow: function () {');
  assert.ok(openAt > 0 && shutAt > openAt && tokenAt > shutAt,
    'AvFloor no longer has open/shut/tokenNow in that order, so this scan cannot tell a writer ' +
    'from a reader');
  const writers = [];
  code.split('\n').forEach((ln, i) => { if (/AvFloor\.tok\s*=/.test(ln)) writers.push(i + 1); });
  assert.ok(writers.length >= 2,
    'only ' + writers.length + ' assignment(s) to AvFloor.tok found, so this audit is reading the ' +
    'wrong thing and guarding nothing');
  const firstLine = (idx) => code.slice(0, idx).split('\n').length;
  const openL = firstLine(openAt), shutL = firstLine(shutAt), endL = firstLine(tokenAt);
  const stray = writers.filter((n) => !((n >= openL && n < shutL) || (n >= shutL && n < endL)));
  assert.deepEqual(stray, [],
    'SOMETHING OTHER THAN AvFloor.open/AvFloor.shut WRITES THE ANSWER BOUNDARY, at line(s) ' +
    stray.join(', ') + '. Four cooperating mechanisms each holding a piece of this fact is exactly ' +
    'how the boundary moved four times in rounds 4 through 7. There are two writers or there is ' +
    'no owner.');
  /* and the mint has ONE call site, wired to the one statement that means "a sentence started" */
  const opens = (code.match(/AvFloor\.open\(\)/g) || []).length;
  assert.strictEqual(opens, 1,
    'AvFloor.open() has ' + opens + ' call sites. With more than one, "the boundary is minted by a ' +
    'question starting" is an unfounded claim.');
  assert.ok(/pvAudioStartAt = Date\.now\(\);\s*\n\s*AvFloor\.open\(\);/.test(code),
    'THE MINT HAS DRIFTED AWAY FROM THE ACT IT MEANS. AvFloor.open() must sit on the statement ' +
    'after pvAudioStartAt is stamped, i.e. the moment a sentence of ours starts with the ' +
    'microphone already live. Round 7 stamped its boundary when a sentence FINISHED, so any ' +
    'sentence completing opened the gate — including the one hosting the refusal — and a dropped ' +
    're-ask left it open with no asking having happened.');
  /* the two shut() sites, and one of them IS the refusal */
  const shuts = (code.match(/AvFloor\.shut\(/g) || []).length;
  assert.strictEqual(shuts, 2,
    'AvFloor.shut() has ' + shuts + ' call sites, not 2. They are the refusal (kioskReAsk) and the ' +
    'start of the backend round trip (kioskTurn); a third means the boundary can close for a ' +
    'reason nobody enumerated.');
  /* ⚠️ SCOPED TO THE FUNCTION, ORDERED BY STATEMENT — not a byte window. A byte window between
     these two statements broke on the comment that explains them, which is the shape of pin this
     lane has already had cry wolf five times in one change set. */
  /* ⚠️ THE BOUNDARY IS FOUND IN THE ORIGINAL SOURCE AND THE INDICES ARE REUSED — comments are
     blanked IN PLACE (character for character), so the two strings are the same length and an
     offset means the same thing in both. Looking for a comment inside the blanked copy returns -1,
     and `slice(x, -1)` silently hands back most of the file: my first version of this pin did
     exactly that and reported the whole module as kioskTurn's body. An instrument that quietly
     widens its own scope is worse than no instrument. */
  const turnAt = SRC.indexOf('function kioskTurn(');
  const turnEnd = SRC.indexOf('\n  /* THE SELF-END WATCHDOG', turnAt);
  assert.ok(turnAt > 0 && turnEnd > turnAt, 'kioskTurn could not be scoped from the source');
  const turnBody = code.slice(turnAt, turnEnd);
  assert.ok(turnBody.length > 500 && turnBody.length < 12000,
    'the kioskTurn scope is ' + turnBody.length + ' characters, which is not one function body — ' +
    'this pin is guarding either nothing or everything');
  const busyAt = turnBody.indexOf('kiosk.busy = true;');
  const shutAt2 = turnBody.indexOf("AvFloor.shut('busy')");
  assert.ok(busyAt > 0 && shutAt2 > busyAt,
    'kioskTurn no longer shuts the floor when it goes busy (busy at ' + busyAt + ', shut at ' +
    shutAt2 + '). The recogniser stays live across the round trip on purpose, so without this an ' +
    'answer arriving mid-request is filed against a question the server has already moved past.');
  assert.ok(!/\bpvStopVoice\(\)/.test(turnBody),
    'kioskTurn closes the MICROPHONE again at the start of a turn. Rebuilding it afterwards is what ' +
    'made a fragment byte-identical to a whole answer: the sentence is replaced, the ear is not.');
  const reAskAt = code.indexOf('function kioskReAsk(');
  assert.ok(reAskAt > 0 && /AvFloor\.shut\('re-ask'\);\s*\n/.test(code.slice(reAskAt, reAskAt + 1200)),
    'A REFUSAL NO LONGER SHUTS THE FLOOR IN ITS OWN BODY. That single statement is what makes a ' +
    'continuation structurally unfileable rather than conditionally so: the act of refusing IS the ' +
    'act of closing the gate, so there is no arrangement of callers, handlers or early returns in ' +
    'which a turn is refused and the next words are still fileable.');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   2. THE ANSWER'S BOUNDARY FACTS ARE WRITTEN ONCE AND NEVER RE-JUDGED
   ═════════════════════════════════════════════════════════════════════════════════════════════ */
{
  const at = SRC.indexOf('function AvAnswer(tok, rec)');
  const proto = SRC.indexOf('AvAnswer.current = null;');
  assert.ok(at > 0 && proto > at, 'the AvAnswer constructor and its prototype are not both present');
  const body = SRC.slice(at, proto);
  assert.ok(/this\.tok = tok;/.test(body) && /this\.rec = rec;/.test(body),
    'AvAnswer no longer copies the token and the recogniser instance at construction');
  /* nothing may re-assign them anywhere in the file */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const reassign = [];
  code.split('\n').forEach((ln, i) => {
    if (/\.tok\s*=/.test(ln) && !/AvFloor\.tok\s*=/.test(ln) && !/this\.tok = tok;/.test(ln)) {
      reassign.push((i + 1) + ': ' + ln.trim());
    }
  });
  assert.deepEqual(reassign, [],
    'AN ANSWER\'S TOKEN IS BEING RE-ASSIGNED after construction: ' + reassign.join(' | ') + '. ' +
    'Its fileability must be decided by a fact that existed BEFORE its first word; a token that ' +
    'can be upgraded later is the boundary moving again.');
  /* the no-floor test runs FIRST and unconditionally */
  const vAt = SRC.indexOf('AvAnswer.prototype.verdict');
  const vEnd = SRC.indexOf('AvAnswer.prototype.discard', vAt);
  const verdict = SRC.slice(vAt, vEnd);
  assert.ok(/if \(!this\.tok\) return 'no-floor';/.test(verdict),
    'verdict() no longer refuses outright when the boundary is unknown, or no longer does it first');
  assert.ok(verdict.indexOf("if (!this.tok) return 'no-floor';") <
    verdict.indexOf("return 'whole';"),
    'the no-floor test is no longer the FIRST thing verdict() does — a classification must never ' +
    'run before the fact');
  assert.ok(/this\.floorRec !== this\.rec/.test(verdict) && /this\.rec !== pvRec/.test(verdict),
    'THE RECOGNISER-IDENTITY FENCE IS GONE. kioskListen rebuilds the recogniser 400ms after an ' +
    'ordinary no-speech/network error; a rebuild mid-question otherwise yields an answer with a ' +
    'VALID token whose head went into the gap. That is round 4 re-entered in the fail-OPEN ' +
    'direction, and it is the single most dangerous line in this design.');
  /* THE SHARED BUFFER IS GONE — the "cannot contribute to its successor" property */
  const lAt = SRC.indexOf('function pvListen(');
  const lEnd = SRC.indexOf('av-5.0.0 — THE LIVING FACE');
  const listen = SRC.slice(lAt, lEnd);
  assert.ok(!/var finalText/.test(listen) && !/finalText \+=/.test(listen),
    'pvListen has a `finalText` accumulator again. A shared text buffer is where two answers meet, ' +
    'and answer N-1 appearing inside answer N is round 7\'s weld.');
  assert.ok(!/var turnText/.test(listen),
    'pvListen has a `turnText` accumulator again — rounds 6 and 7 by name');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   3. THE FOUR PERMANENT CONTROLS: BYTE-EXACT, OR REFUSED ENTIRE AND RE-ASKED
   ═════════════════════════════════════════════════════════════════════════════════════════════
   Two regimes for each of the four strings, in both recogniser shapes:
     (a) the answer arrives with the boundary KNOWN -> filed BYTE-EXACT, character for character;
     (b) the answer arrives with the boundary UNKNOWN (a continuation, or the backend round trip)
         -> refused WHOLE, with its exact bytes handed to the caller so the patient can be told,
         and NOTHING filed. Never trimmed, never partly filed. */
let byteExact = 0, refusedWhole = 0;
for (const shape of lib.SHAPES) {
  for (const said of NEGATION_CONTROLS) {
    /* (a) boundary known, and the patient answers DURING the question — the normal case, because
           patients answer as soon as they understand and the microphone opens before the first
           word. Round 4 swallowed the head here; round 7 refused the whole thing as "overlap". */
    {
      const h = H();
      h.listen();
      const rec = h.recs()[0];
      h.ask(QUESTION);
      rec.deliver(shape, [{ text: said, isFinal: true }], 0);
      h.askDone();
      h.flushTimers(3);
      assert.deepStrictEqual(logOf(h).filed, [said],
        'BYTE-EXACT CONTROL FAILED [' + shape + ', answered during the question]: ' +
        JSON.stringify(said) + ' filed as ' + JSON.stringify(logOf(h).filed) + '. If the head was ' +
        'dropped this is an INVERTED clinical fact, not a degraded one — a wrong-site error under ' +
        'a green receipt. If nothing was filed, the round is over-refusing and the patient is ' +
        'being asked to repeat a perfectly good answer.');
      byteExact++;
    }
    /* (b) boundary unknown: the previous turn is being filed (the backend round trip). This is the
           continuation case, and it is where main SILENTLY LOSES the words. */
    {
      const h = H();
      h.listen();
      const rec = h.recs()[0];
      h.ask(QUESTION);
      h.askDone();
      rec.deliver(shape, [{ text: 'my knee', isFinal: true }], 0);
      h.flushTimers(3);                                    /* files, busy, floor shut */
      rec.deliver(shape, [{ text: 'my knee', isFinal: true }, { text: said, isFinal: true }], 1);
      h.flushTimers(3);
      const L = logOf(h);
      assert.deepStrictEqual(L.filed, ['my knee'],
        'A CONTINUATION WAS FILED [' + shape + ']: ' + JSON.stringify(L.filed) + '. The boundary ' +
        'was not known, so nothing may be filed at all. ' + JSON.stringify(said) + ' is the rest ' +
        'of a sentence that already started; filing it as a complete answer is round 6.');
      assert.deepStrictEqual(L.refused.map((r) => r.text), [said],
        'THE REFUSED ANSWER WAS NOT HANDED OVER WHOLE [' + shape + ']: ' +
        JSON.stringify(L.refused) + '. It must arrive at the caller byte for byte so the patient ' +
        'can be told and asked again; handing over "just the suspect part" means deciding where ' +
        'the suspect part ended, which is the cut this design exists to refuse.');
      assert.deepStrictEqual(L.lost, [],
        'AN ANSWER WAS SILENTLY LOST [' + shape + ']: ' + JSON.stringify(L.lost) + '. Where speech ' +
        'genuinely cannot be accepted the patient must be TOLD. This is the requirement main ' +
        'violates in production today: kioskTurn drops a turn that arrives while it is busy and ' +
        'says nothing at all.');
      refusedWhole++;
    }
  }
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   4. THE REAL ANSWERS STILL FILE — so an over-refusing round fails HERE
   ═════════════════════════════════════════════════════════════════════════════════════════════
   These sit in the SAME FILE as the refusal controls on purpose, so a later round cannot merge the
   barge-in gate with the filing gate without one side of the pair going red. Measured against
   round 7: it refused all four negation controls above as "overlap", which is a large part of why
   it was a net regression. */
let realFiled = 0;
for (const shape of lib.SHAPES) {
  for (const said of REAL_ANSWER_CONTROLS) {
    const h = H();
    h.listen();
    const rec = h.recs()[0];
    h.ask(QUESTION);
    h.askDone();
    rec.deliver(shape, [{ text: said, isFinal: true }], 0);
    h.flushTimers(3);
    assert.deepStrictEqual(logOf(h).filed, [said],
      'A REAL ANSWER WAS NOT FILED [' + shape + ']: ' + JSON.stringify(said) + ' -> ' +
      JSON.stringify(logOf(h)) + '. A gate that refuses everything scores perfectly on the safety ' +
      'controls while deleting the product. Earlier rounds measured 9 of 12 and then 22 of 22 real ' +
      'answers deleted this way.');
    realFiled++;
  }
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   5. THE JOINING CASE: TURN N-1 MUST NEVER APPEAR INSIDE TURN N
   ═════════════════════════════════════════════════════════════════════════════════════════════
   Driven through the cumulative `resultIndex: 0` shape, in BOTH object regimes:
     · the platform hands back its live results list (same objects) — caught by identity;
     · the platform rebuilds the list from new objects — caught by the (index -> text, list length)
       ledger.
   FAILS ON: origin/main (both shapes, measured) and round 7 (both shapes, measured). */
let joinChecked = 0;
for (const fresh of [false, true]) {
  const h = H();
  h.listen();
  const rec = h.recs()[0];
  h.ask('What brings you in today?');
  h.askDone();
  const one = [{ text: 'my knee gave out', isFinal: true }];
  if (fresh) rec.deliverFresh(one); else rec.deliver('cumulative', one, 0);
  h.flushTimers(3);
  h.turnDone();
  h.ask('Is it worse in the morning?');
  h.askDone();
  const two = one.concat([{ text: 'in the morning', isFinal: true }]);
  if (fresh) rec.deliverFresh(two); else rec.deliver('cumulative', two, 1);
  h.flushTimers(3);
  const filed = logOf(h).filed;
  assert.deepStrictEqual(filed, ['my knee gave out', 'in the morning'],
    'ANSWER N-1 WAS WELDED ONTO ANSWER N [' + (fresh ? 'rebuilt objects' : 'live results list') +
    ']: ' + JSON.stringify(filed) + '. `ev.results` is CUMULATIVE and some platforms re-deliver it ' +
    'with resultIndex 0; round 7 cleared its absorbed set per turn and filed the previous answer ' +
    'again on the front of the next one. Measured on main: ' +
    '["my knee gave out","my knee gave out my knee gave out in the morning"].');
  for (const later of filed.slice(1)) {
    assert.ok(later.indexOf(filed[0]) < 0,
      'the bytes of answer 1 appear inside a later answer: ' + JSON.stringify(later));
  }
  joinChecked++;
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   5b. AND THE ANTI-WELD LEDGER MUST NOT EAT A REPEATED ONE-WORD ANSWER
   ═════════════════════════════════════════════════════════════════════════════════════════════
   ⚠️ THIS IS THE DESIGN REVIEW'S OWN STATED WEAKNESS, WITH A CONTROL, AND THE FIRST IMPLEMENTATION
   FAILED IT — measured: a session-scoped (index -> text) ledger filed "yes" once when the patient
   said "yes" to two consecutive questions on a non-continuous platform (index 0 reused). A silent
   single-word loss is the worst class this lane has been bitten by. Resolved with a third fact
   rather than a guess: a cumulative re-delivery arrives in a list that GREW, while a
   non-continuous platform REPLACES its list, so the list length discriminates them.
   The scenario uses rebuilt result objects because that is what a platform reusing an index must
   do — a SpeechRecognitionResult *is* its utterance, so the same object cannot be a new one. */
{
  const h = H();
  h.listen();
  const rec = h.recs()[0];
  h.ask('Any numbness?');
  h.askDone();
  rec.deliverFresh([{ text: 'yes', isFinal: true }]);
  h.flushTimers(3);
  h.turnDone();
  h.ask('Any weakness?');
  h.askDone();
  rec.deliverFresh([{ text: 'yes', isFinal: true }]);
  h.flushTimers(3);
  assert.deepStrictEqual(logOf(h).filed, ['yes', 'yes'],
    'A REPEATED ONE-WORD ANSWER WAS SWALLOWED BY THE ANTI-WELD LEDGER: ' +
    JSON.stringify(logOf(h).filed) + '. "yes" to two consecutive questions on a platform that ' +
    'reuses result index 0 is an ordinary interview, and dropping the second one is a silent ' +
    'single-word loss with nothing refused and nobody asked again.');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   6. THE MICROPHONE REBUILD MID-QUESTION IS REFUSED, NOT FILED
   ═════════════════════════════════════════════════════════════════════════════════════════════
   The design review named this as its most dangerous line. Chrome's speech service is
   network-backed and this module's own comment calls a `no-speech`/`network` error ORDINARY; the
   400ms deadTimer then rebuilds the recogniser. If that happens while a question is playing, the
   new recogniser's first result is the TAIL of an utterance whose head went into the gap — round 4,
   in the fail-OPEN direction, because the token minted for the question is still valid.
   FAILS ON: origin/main, measured — it files "in my left leg" as a complete answer. */
for (const shape of lib.SHAPES) {
  const h = H();
  h.listen();
  const rec1 = h.recs()[0];
  h.ask(QUESTION);                       /* the token is minted for rec1 */
  rec1.onerror();                        /* Chrome's ordinary no-speech */
  h.listen();                            /* the deadTimer rebuild -> rec2 */
  const rec2 = h.recs()[h.recs().length - 1];
  assert.notStrictEqual(rec2, rec1, 'the harness did not actually rebuild the recogniser');
  rec2.deliver(shape, [{ text: 'in my left leg', isFinal: true }], 0);
  h.askDone();
  h.flushTimers(3);
  const L = logOf(h);
  assert.deepStrictEqual(L.filed, [],
    'A HEADLESS FRAGMENT WAS FILED AFTER A MICROPHONE REBUILD [' + shape + ']: ' +
    JSON.stringify(L.filed) + '. "in my left leg" is what is left of "no pain in my left leg" ' +
    'when the head goes into a microphone that did not exist yet. Measured on origin/main: FILED.');
  assert.deepStrictEqual(L.refused.map((r) => r.text + '/' + r.why), ['in my left leg/no-floor'],
    'the rebuilt-microphone answer was not refused whole with a reason: ' + JSON.stringify(L.refused));
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   7. NOTHING THE MICROPHONE HEARS CAN END A SENTENCE
   ═════════════════════════════════════════════════════════════════════════════════════════════
   The owner's first complaint, in his words: "it litterly never gets out everyhting it wants to
   say caosue it picks up its own talking". This is the structural half — the interrupt moved off
   the microphone entirely.
   POPULATION: the speech-stopping function names are DERIVED by scanning the file for function
   declarations whose names match a stop-speech shape, plus the two platform calls. The handler
   bodies are the callbacks pvListen is given, located by their own call site. */
{
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const stoppers = [];
  const reFn = /function (pv[A-Za-z]*(?:Stop|Abandon|Cancel)[A-Za-z]*)\(/g;
  let m;
  while ((m = reFn.exec(code))) if (stoppers.indexOf(m[1]) < 0) stoppers.push(m[1]);
  assert.ok(stoppers.length >= 3,
    'only ' + stoppers.length + ' speech-stopping function(s) derived from the file (' +
    stoppers.join(', ') + '); with fewer than three this scan is reading the wrong thing');
  /* pvStopMicOnly closes the MICROPHONE, which is a different act and is allowed here */
  const speechStoppers = stoppers.filter((n) => n !== 'pvStopMicOnly')
    .concat(['speechSynthesis.cancel']);
  const listenAt = code.indexOf('function kioskListen(');
  assert.ok(listenAt > 0, 'kioskListen is gone');
  const handlersFrom = code.indexOf('var started = pvListen(', listenAt);
  const handlersTo = code.indexOf('if (!started) {', handlersFrom);
  assert.ok(handlersFrom > 0 && handlersTo > handlersFrom,
    'the microphone-derived handlers no longer have a single identifiable site in kioskListen');
  const handlers = code.slice(handlersFrom, handlersTo);
  const found = speechStoppers.filter((n) => handlers.indexOf(n + '(') >= 0);
  assert.deepEqual(found, [],
    'A MICROPHONE-DERIVED HANDLER CAN STOP THE SPEECH AGAIN, via: ' + found.join(', ') + '. Every ' +
    'audio rule and every text rule tried on that line was measured being fooled by the avatar\'s ' +
    'own voice — 42 of 232 mis-transcribed echoes read as an interruption with no gate at all, and ' +
    'the audio gate itself tripping on the avatar\'s own residual on nearly every question. A ' +
    'loudspeaker can defeat any classifier; it cannot press a button.');
  /* and the interim handler must not even PAINT over a question the patient is reading */
  assert.ok(/if \(pvAudioLive\(\)\) \{ kiosk\.heardWhileSpeaking = /.test(handlers),
    'the interim handler no longer stands down while audio is live. pvAudioLive(), NOT pvSaying: ' +
    'pvSaying is cleared by an ESTIMATED-duration watchdog, so a pvSaying fence lifts mid-sentence ' +
    'and lets the loudspeaker\'s own words back onto the patient-facing line.');
  /* exactly one thing in the file can end a sentence early, and it is the trusted tap */
  const callers = (code.match(/pvStopSpeechOnly\(\);/g) || []).length;
  assert.strictEqual(callers, 1,
    'pvStopSpeechOnly now has ' + callers + ' call sites — with more than one, nothing can be ' +
    'concluded about what silenced a question');
  const skipAt = code.indexOf('function kioskSkipSpeech(');
  assert.ok(skipAt > 0, 'kioskSkipSpeech is gone — there is no interrupt at all');
  const skip = code.slice(skipAt, code.indexOf('\n  /*', skipAt));
  assert.ok(/if \(!ev \|\| ev\.isTrusted !== true\) return false;/.test(skip),
    'THE INTERRUPT NO LONGER REQUIRES A TRUSTED EVENT. A loudspeaker cannot produce one and a ' +
    'mis-transcribed echo is a string, which has no path to this handler at all — that is what ' +
    'closes the forgery hole every barge-in rule in rounds 4-7 had. This codebase already relies ' +
    'on the same precedent elsewhere (a scripted .click() is refused for lacking isTrusted).');
  assert.ok(skip.indexOf('if (!ev || ev.isTrusted !== true) return false;') <
    skip.indexOf('pvStopSpeechOnly();'),
    'the trusted-event test no longer runs before the stop');
  assert.ok(/#mlsAvKioskSkip'\)\.addEventListener\('click', kioskSkipSpeech\)/.test(code),
    'the interrupt button is not wired to kioskSkipSpeech, so the only interrupt is unreachable');
  assert.ok(/<button type="button" id="mlsAvKioskSkip">/.test(SRC),
    'the interrupt button is not in the markup');
  /* EXECUTED: an untrusted event must be refused, a trusted one accepted. Lifted verbatim. */
  const gate = new Function('ev', 'live', `
    var kiosk = { open: true, consentAt: 1, ambient: false, paused: false, completed: false };
    var pvAudioLive = function () { return live; };
    var pvStopSpeechOnly = function () { stopped = true; };
    var stopped = false;
    ${SRC.slice(SRC.indexOf('function kioskSkipSpeech(ev) {'),
      SRC.indexOf('return true;\n  }', SRC.indexOf('function kioskSkipSpeech(ev) {')) + 16)}
    kioskSkipSpeech(ev);
    return stopped;
  `);
  assert.strictEqual(gate({ isTrusted: false }, true), false,
    'A SYNTHETIC EVENT STOPPED THE SPEECH. .click() from a script, a page extension, or anything ' +
    'downstream of the recogniser must not be able to silence the avatar.');
  assert.strictEqual(gate({}, true), false, 'an event with no isTrusted at all stopped the speech');
  assert.strictEqual(gate({ isTrusted: true }, true), true,
    'A REAL TAP NO LONGER STOPS THE SPEECH — the interrupt has been deleted, which is the other ' +
    'half of the owner\'s complaint (he still has to be able to cut it short)');
  assert.strictEqual(gate({ isTrusted: true }, false), false,
    'the skip button acts when nothing is playing');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   8. GRAFT 1 — THE WATCHDOG NEVER CUTS A LIVE SENTENCE, AND THE FENCE HAS NO CAP
   ═════════════════════════════════════════════════════════════════════════════════════════════
   50 CONSECUTIVE TICKS against a never-ending sentence. The pre-graft form waited at most three
   times and then FELL THROUGH into abandoning the sentence, cutting the audio mid-word — with its
   own suite asserting that breach as required behaviour. */
{
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const wdAt = code.indexOf('function kioskWatchdog() {');
  assert.ok(wdAt > 0, 'kioskWatchdog is gone');
  const wdEnd = code.indexOf('\n  function ', wdAt + 10);
  const wd = code.slice(wdAt, wdEnd);
  assert.ok(/if \(pvAudioLive\(\)\) \{/.test(wd),
    'the watchdog no longer defers to a live sentence — the silence timer can talk over the second ' +
    'half of the question it is waiting for');
  assert.ok(!/audioWaits < \d/.test(wd) && !/audioWaits <= \d/.test(wd),
    'THE AUDIO FENCE HAS A CAP AGAIN. A capped wait FALLS THROUGH, and what it falls through into ' +
    'is abandoning the sentence mid-word. Termination must come from pvAudioLive()\'s trust window ' +
    'closing, not from a counter.');
  assert.ok(/kioskArmWatchdog\(pvAudioRemainingMs\(\) \+ 750\)/.test(wd),
    'the re-arm is no longer computed from pvAudioRemainingMs(), so it can land INSIDE the trust ' +
    'window and spin instead of resolving');
  /* EXECUTED: 50 ticks, 0 cuts, no fall-through. Every downstream act is instrumented, so a cut ' +
     cannot hide as "nothing happened". */
  const ticks = new Function(`
    var cuts = 0, arms = [], fellThrough = 0;
    var kiosk = { ambient: false, open: true, busy: false, completed: false, mic: true, heard: false,
                  silent: 0, finishTries: 0, nudgedFor: null, lastSay: 'q' };
    function pvAudioLive() { return true; }              /* a sentence that never ends */
    function pvAudioRemainingMs() { return 1000; }
    function kioskArmWatchdog(ms) { arms.push(ms); }
    function pvAbandonSpeech() { cuts++; fellThrough++; }
    function pvStopVoice() { cuts++; fellThrough++; }
    function kioskTurn() { fellThrough++; }
    function kioskStopBounded() { fellThrough++; }
    function kioskMood() {}
    function pvSpeakShaped() { fellThrough++; }
    function kioskListen() { fellThrough++; }
    var NUDGE_LINE = 'n';
    ${SRC.slice(SRC.indexOf('function kioskWatchdog() {'),
      SRC.indexOf('\n  /* The client gives up HONESTLY', SRC.indexOf('function kioskWatchdog() {')))}
    for (var i = 0; i < 50; i++) kioskWatchdog();
    return { cuts: cuts, fellThrough: fellThrough, arms: arms.length, waits: kiosk.audioWaits };
  `)();
  assert.strictEqual(ticks.cuts, 0,
    'THE WATCHDOG CUT A LIVE SENTENCE ' + ticks.cuts + ' TIME(S) IN 50 TICKS. This is the owner\'s ' +
    '"it litterly never gets out everyhting it wants to say", arriving through the silence timer.');
  assert.strictEqual(ticks.fellThrough, 0,
    'the watchdog FELL THROUGH the audio fence ' + ticks.fellThrough + ' time(s) in 50 ticks');
  assert.strictEqual(ticks.arms, 50, 'the watchdog stopped re-arming, so the question can never revive');
  assert.strictEqual(ticks.waits, 50, 'the audioWaits counter stopped counting, so a stuck audio ' +
    'signal would be invisible in the receipt');
  /* THE CONTROL FOR THIS CONTROL: restore the cap and the same 50 ticks must cut. Written as a
     mutation of the SHIPPED bytes so it cannot pass by accident.
     ⛔ AND THE MUTATION IS APPLIED TO THE COMMENT-BLANKED COPY, WHICH IS NOT PEDANTRY. My first
     version mutated the raw source, and the raw source contains the string `if (pvAudioLive()) {`
     INSIDE the comment that explains why the cap was removed — so the replace landed in prose, the
     shipped code was left untouched, and the "control" measured 0 cuts and declared itself unable
     to fail. A text grep cannot tell code from prose; this lane has now had a sweep report its own
     documentation as a defect several times, and this is the same error in the other direction. */
  const wdFrom = SRC.indexOf('function kioskWatchdog() {');
  const wdTo = SRC.indexOf('\n  /* The client gives up HONESTLY', wdFrom);
  assert.ok(wdFrom > 0 && wdTo > wdFrom, 'the watchdog could not be scoped from the source');
  const capped = code.slice(wdFrom, wdTo)
    .replace('if (pvAudioLive()) {', 'if (pvAudioLive() && (kiosk.audioWaits || 0) < 3) {');
  assert.notStrictEqual(capped.indexOf('(kiosk.audioWaits || 0) < 3'), -1,
    'the capped-variant control could not be constructed, so the 50-tick result above proves nothing');
  assert.strictEqual((capped.match(/\(kiosk\.audioWaits \|\| 0\) < 3/g) || []).length, 1,
    'the cap was injected more than once, so the control is not the single mutation it claims to be');
  const cappedRun = new Function(`
    var cuts = 0;
    var kiosk = { ambient: false, open: true, busy: false, completed: false, mic: true, heard: false,
                  silent: 0, finishTries: 0, nudgedFor: null, lastSay: 'q' };
    function pvAudioLive() { return true; }
    function pvAudioRemainingMs() { return 1000; }
    function kioskArmWatchdog() {}
    function pvAbandonSpeech() { cuts++; }
    function pvStopVoice() { cuts++; }
    function kioskTurn() {}
    function kioskStopBounded() {}
    function kioskMood() {}
    function pvSpeakShaped() {}
    function kioskListen() {}
    var NUDGE_LINE = 'n';
    ${capped}
    for (var i = 0; i < 50; i++) kioskWatchdog();
    return cuts;
  `)();
  assert.ok(cappedRun > 0,
    'THE 50-TICK CONTROL CANNOT FAIL. Restoring the three-wait cap to the shipped bytes still ' +
    'produced 0 cuts, which means this group is not measuring what it claims to measure.');
  notes.push('watchdog: 50/50 ticks deferred, 0 cuts; the capped variant cuts ' + cappedRun + ' time(s)');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   9. GRAFT 2 — pvAudioLive()'s TRUST CEILING IS UNCONDITIONAL
   ═════════════════════════════════════════════════════════════════════════════════════════════
   EXECUTED with pvAudioStartAt = 0 and an Audio element reporting paused:false, ended:false. The
   pre-graft form applied the ceiling only when pvAudioStartAt happened to be set, so a stuck
   element answered TRUE FOR EVER — and every fence keyed to this predicate jammed shut at once. */
{
  const h = H();
  /* ⛔ THE GUARD ON THE GUARD. The harness falls back to `!!pvSaying` on any build without the
     predicate, so without this line every executed case below would pass VACUOUSLY on a build where
     pvAudioLive had simply been deleted — a control that cannot fail, which is the exact defect
     class this lane keeps shipping. */
  assert.strictEqual(h.hasAudioLive, true,
    'pvAudioLive() does not exist in these bytes, so every audio fence in the file is reading an ' +
    'ESTIMATE again and the executed cases below would prove nothing');
  h.audioStuck();
  assert.strictEqual(h.audioLive(), false,
    'pvAudioLive() ANSWERS TRUE WITH NO SENTENCE IN FLIGHT. An Audio element left at ' +
    'paused:false, ended:false with pvAudioStartAt cleared makes this predicate true for ever, ' +
    'and everything keyed to it jams shut: the silence watchdog returns, the interim line never ' +
    'paints, and the kiosk refuses every answer for the rest of the visit while reporting no fault.');
  assert.strictEqual(h.remainingMs(), 0, 'the remaining-audio window is non-zero with no sentence');
  h.audioOn();
  assert.strictEqual(h.audioLive(), true, 'pvAudioLive() is false while a sentence really is playing');
  assert.ok(h.remainingMs() > 0, 'the trust window is empty while a sentence is playing, so every ' +
    'caller that re-arms past it would re-arm immediately and spin');
  h.audioOff();
  assert.strictEqual(h.audioLive(), false, 'pvAudioLive() stays true after the sentence ends');
  /* and the shape of the fence, so the conditional form cannot come back */
  assert.ok(/if \(!pvAudioStartAt\) return false;\s*\n\s*if \(\(Date\.now\(\) - pvAudioStartAt\) > PV_AUDIO_TRUST_MS\) return false;/.test(SRC),
    'the trust window is no longer written as two unconditional early returns — the form that made ' +
    'it conditional (`if (pvAudioStartAt && age > ceiling)`) is the permanent hang');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   10. GRAFT 3 — A PURE-ECHO REFUSAL MUST NOT ARM THE RE-ASK GATE
   ═════════════════════════════════════════════════════════════════════════════════════════════
   MEASURED, and it cost a real answer before the stand-down existed: the question plays, its echo
   is refused, its late tail is refused, and then "My right knee is swollen and it gave out
   yesterday" — a real answer, into a silent room — was DROPPED. 0 of 1 filed with the gate armed
   on echo; 1 of 1 with the stand-down. Every word of an echo turn is a word we were saying, so the
   patient contributed nothing and there is no half-answer of theirs to protect. */
{
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const handlersFrom = code.indexOf('function (refused, why, hadOverlap, wasEcho)');
  assert.ok(handlersFrom > 0, 'the refusal handler is gone, so a refused answer is never re-asked');
  const handler = code.slice(handlersFrom, code.indexOf('if (!started) {', handlersFrom));
  assert.ok(/kiosk\.echoStoodDown = /.test(handler),
    'the pure-echo stand-down is gone from the refusal handler');
  assert.ok(handler.indexOf('kiosk.echoStoodDown') < handler.indexOf('kioskReAsk('),
    'THE ECHO STAND-DOWN NO LONGER RUNS BEFORE THE RE-ASK. Arming the gate on an echo was measured ' +
    'costing a real answer (0 of 1 filed, 1 of 1 with the stand-down), because a room with ' +
    'imperfect echo cancellation produces one of these on nearly every question.');
  /* EXECUTED, lifted verbatim: an all-echo refusal must not reach kioskReAsk; a real one must. */
  const decide = new Function('refused', 'saying', 'novel', 'selfEcho', 'wasEcho', `
    var reAsked = false, stoodDown = false;
    var kiosk = { open: true, completed: false, lastSay: saying };
    var pvSaying = saying;
    var pvIsSelfEcho = function () { return selfEcho; };
    var pvNovelWordCount = function () { return novel; };
    var kioskReAsk = function () { reAsked = true; };
    var handler = ${code.slice(handlersFrom, code.indexOf('\n    });', handlersFrom)) + '\n    }'};
    handler(refused, 'no-floor', false, wasEcho);
    stoodDown = !!kiosk.echoStoodDown;
    return { reAsked: reAsked, stoodDown: stoodDown };
  `);
  const Q = 'is the pain in your left leg';
  assert.deepStrictEqual(decide('is the pain in your', Q, 0, true, true), { reAsked: false, stoodDown: true },
    'A PURE ECHO ARMED THE RE-ASK GATE. The next real answer is then refused as a continuation of ' +
    'something the patient never said — measured at 0 of 1 filed.');
  assert.deepStrictEqual(decide('my right knee is swollen and it gave out yesterday', Q, 6, false, false),
    { reAsked: true, stoodDown: false },
    'A REAL REFUSED ANSWER WAS NOT RE-ASKED. A refusal is safe; a SILENT refusal is not — the ' +
    'patient answered, was not heard, and sits waiting for a machine that has moved on.');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   11. GRAFT 4 — OPENING A MICROPHONE CAN NEVER CANCEL A SENTENCE
   ═════════════════════════════════════════════════════════════════════════════════════════════
   Measured on the pre-graft bytes (probe p3.2): a 6.0s question playing since t=40ms, pvListen
   called at t=1000ms -> audio cut at 1000ms, speechSynthesis.cancel() at 1000ms, and finish
   callbacks fired = 0, so the continuation that re-arms the silence clock and re-opens the mic was
   STRANDED and nothing ever re-spoke the question. That is not a rare path: Chrome's speech
   service is network-backed and every ordinary error re-opens the microphone 400ms later. */
{
  const lAt = SRC.indexOf('function pvListen(');
  const head = SRC.slice(lAt, lAt + 1400);
  assert.ok(/pvStopMicOnly\(\);/.test(head) && !/pvStopVoice\(\);/.test(head),
    'pvListen tears down the VOICE again on its way to opening the microphone');
  /* EXECUTED: a sentence is in flight, the microphone opens, the sentence must survive */
  const h = H();
  h.listen();
  h.ask(QUESTION);
  const seqBefore = h.speakSeq();
  h.listen();                              /* the deadTimer rebuild, mid-question */
  assert.strictEqual(h.audioLive(), true,
    'OPENING THE MICROPHONE SILENCED THE SENTENCE THAT WAS PLAYING. This is one half of the ' +
    'owner\'s complaint, and it also strands the completion callback so nothing re-asks.');
  assert.strictEqual(h.speakSeq(), seqBefore,
    'opening the microphone bumped pvSpeakSeq, which makes the in-flight sentence\'s finish() ' +
    'unreachable for ever — measured as a hang, not a crash, which is why it was invisible');
  /* the three stops exist and are composed, so a caller picks the ACT rather than the lines */
  assert.ok(/function pvAbandonSpeech\(\)/.test(SRC), 'pvAbandonSpeech is gone');
  assert.ok(/function pvStopMicOnly\(\)/.test(SRC), 'pvStopMicOnly is gone');
  assert.ok(/function pvStopVoice\(\) \{\s*\n\s*pvAbandonSpeech\(\);\s*\n\s*pvStopMicOnly\(\);\s*\n\s*\}/.test(SRC),
    'pvStopVoice is no longer composed from the two halves, so there are two descriptions of each ' +
    'act again and a caller can copy the wrong lines');
  /* and pvStopSpeechOnly ENDS the sentence rather than orphaning it */
  const sAt = SRC.indexOf('function pvStopSpeechOnly() {');
  const s = SRC.slice(sAt, SRC.indexOf('function pvAbandonSpeech()', sAt));
  assert.ok(s.indexOf('if (ending) { safe(ending); }') < s.indexOf('pvSpeakSeq === seqBefore'),
    'pvStopSpeechOnly bumps pvSpeakSeq BEFORE running the in-flight continuation, which orphans it. ' +
    'On the closing line that continuation IS kioskFinish, so skipping the last sentence a patient ' +
    'ever hears leaves the check-in unfinished and the visit never handed back to staff.');
  /* ⛔ AND THE BUMP MUST NOT KILL A SENTENCE THE CONTINUATION JUST STARTED. A defect I introduced
     in this very change and found by walking the skip path: skipping a question runs its
     continuation, the continuation drains a deferred re-ask, the re-ask calls pvSpeakVoiced and
     takes the next sequence number — and an UNCONDITIONAL pvSpeakSeq++ after that invalidated the
     brand-new sentence, so the apology was swallowed in silence. Executed, both ways. */
  assert.ok(/if \(pvSpeakSeq === seqBefore\) pvSpeakSeq\+\+;/.test(SRC),
    'THE SEQUENCE BUMP IN pvStopSpeechOnly IS UNCONDITIONAL AGAIN. It exists only to stop a LATE tts ' +
    'fetch for the sentence just cut from starting a second voice; a sentence started INSIDE the ' +
    'continuation has already invalidated the cut one by taking its own number, and bumping again ' +
    'kills it — every one of its fetch callbacks tests mySeq !== pvSpeakSeq and bails.');
  const seqRun = new Function('startsNew', `
    var pvSpeakSeq = 7, pvSaying = 'q', pvHeld = [], pvWatchdog = null, ttsAudioNow = null;
    var pvAudioStartAt = 123;
    var window = { speechSynthesis: { cancel: function () {} } };
    function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
    function pvEchoHold() {}
    function faceTalkStop() {}
    var pvFinishNow = function () { if (startsNew) pvSpeakSeq++; };
    ${SRC.slice(SRC.indexOf('function pvStopSpeechOnly() {'),
      SRC.indexOf('function pvAbandonSpeech()', SRC.indexOf('function pvStopSpeechOnly() {')))}
    pvStopSpeechOnly();
    return pvSpeakSeq;
  `);
  assert.strictEqual(seqRun(false), 8,
    'a skip with NO new sentence in the continuation must still invalidate the cut sentence, or a ' +
    'late tts fetch starts a second voice over whatever comes next');
  assert.strictEqual(seqRun(true), 8,
    'A SENTENCE STARTED INSIDE THE CONTINUATION WAS KILLED BY THE BUMP (pvSpeakSeq reached ' +
    seqRun(true) + ', expected 8). The re-ask, the next question, or the closing line would be ' +
    'silently swallowed — a hang, not a crash, which is why this class of defect keeps surviving.');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   12. THE RE-ASK NEVER CUTS THE SENTENCE IT IS APOLOGISING FOR, AND IS BOUNDED ON THE APOLOGY ONLY
   ═════════════════════════════════════════════════════════════════════════════════════════════ */
{
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const at = code.indexOf('function kioskReAsk(why) {');
  assert.ok(at > 0, 'kioskReAsk is gone');
  const body = code.slice(at, code.indexOf('function kioskReAskSpeak(', at));
  assert.ok(/if \(pvAudioLive\(\) \|\| kiosk\.busy\) \{/.test(body),
    'the re-ask no longer defers while a sentence is playing or a round trip is in flight — it ' +
    'apologises OVER the question it is apologising for, which is the exact harm this round removes');
  assert.ok(/kiosk\.reAskDeferred = /.test(body),
    'the deferral is no longer counted, so a deferral that silently stopped happening would be ' +
    'invisible and the apology would be back to truncating questions');
  assert.ok(/reAsksExhausted/.test(body) && /Staff: I can/.test(body),
    'the bound is gone: three askings on one question must tell STAFF rather than going quiet');
  /* ⛔ AND THE BOUND MUST NOT RELEASE THE GATE. Round 6 for one turn is all it takes. */
  const exhaustFrom = body.indexOf('if (kiosk.reAsks > REASK_MAX) {');
  const exhaust = body.slice(exhaustFrom, body.indexOf('\n    }', exhaustFrom));
  assert.ok(!/AvFloor\.open|AvFloor\.tok/.test(exhaust),
    'THE EXHAUSTED RE-ASK PATH RE-OPENS THE FLOOR BY HAND. The bound is on the APOLOGY, never on ' +
    'the filing rule: every sentence the kiosk speaks mints a fresh boundary anyway, so releasing ' +
    'the gate to break a stall only puts round 6 back for that one turn.');
  /* the deferred apology is drained in exactly one place — the one place a sentence ends */
  const drains = (code.match(/kioskReAskSpeak\(/g) || []).length;
  assert.ok(drains >= 2 && drains <= 3,
    'kioskReAskSpeak has ' + drains + ' references; expected its definition plus the immediate and ' +
    'deferred paths. A list of drain sites is a list that the next caller will not be on.');
  assert.ok(/if \(kiosk && kiosk\.reAskPending && kiosk\.open && !kiosk\.completed && !kiosk\.busy && !pvAudioLive\(\)\)/.test(code),
    'the deferred apology is no longer drained from pvSpeakVoiced\'s finish(), which is the ONE ' +
    'place in the file where a sentence ends. It is safe to drain there precisely because nothing ' +
    'is STAMPED there any more: if the drain never runs, no token is minted and the machine ' +
    'refuses rather than files. That is round 7\'s failure inverted into the fail-safe direction.');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   13. NO POLLING TIMER WAS INTRODUCED
   ═════════════════════════════════════════════════════════════════════════════════════════════ */
{
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const polls = (code.match(/setInterval\(/g) || []).length;
  assert.strictEqual(polls, 0,
    'setInterval appears ' + polls + ' time(s). This module bans polling timers; the quiet window ' +
    'and the watchdog are re-armed per EVENT, which is why they drain instead of spinning.');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   14. THE CONTROLS: THE REAL PRE-FIX BYTES, FAILING THESE ASSERTIONS BY NAME
   ═════════════════════════════════════════════════════════════════════════════════════════════
   A control that is not run is not a control, so a missing checkout is REPORTED, never skipped
   silently. Where the file is present, the same probe runs against it and the FILED STRINGS are
   compared: a build that produces the same strings as the new one has not been fixed, which is
   exactly how rounds 6 and 7 came to claim a fix that changed nothing. */
function probeSet(src) {
  const out = {};
  const mk = () => lib.makeHarness(src);
  {   /* the microphone rebuild mid-question */
    const h = mk();
    h.listen();
    const r1 = h.recs()[0];
    h.ask(QUESTION);
    r1.onerror();
    h.listen();
    const r2 = h.recs()[h.recs().length - 1];
    r2.deliver('monotonic', [{ text: 'in my left leg', isFinal: true }], 0);
    h.askDone();
    h.flushTimers(3);
    out.restart = logOf(h);
  }
  {   /* the continuation across a filing */
    const h = mk();
    h.listen();
    const r = h.recs()[0];
    h.ask(QUESTION);
    h.askDone();
    r.deliver('monotonic', [{ text: 'my knee', isFinal: true }], 0);
    h.flushTimers(3);
    r.deliver('monotonic', [{ text: 'my knee', isFinal: true },
      { text: 'never on the left side', isFinal: true }], 1);
    h.flushTimers(3);
    out.cont = logOf(h);
  }
  {   /* joining, cumulative shape */
    const h = mk();
    h.listen();
    const r = h.recs()[0];
    h.ask('What brings you in today?');
    h.askDone();
    r.deliver('cumulative', [{ text: 'my knee gave out', isFinal: true }], 0);
    h.flushTimers(3);
    h.turnDone();
    h.ask('Is it worse in the morning?');
    h.askDone();
    r.deliver('cumulative', [{ text: 'my knee gave out', isFinal: true },
      { text: 'in the morning', isFinal: true }], 1);
    h.flushTimers(3);
    out.join = logOf(h);
  }
  {   /* the four negation controls, answered DURING the question */
    out.during = [];
    for (const said of NEGATION_CONTROLS) {
      const h = mk();
      h.listen();
      const r = h.recs()[0];
      h.ask(QUESTION);
      r.deliver('monotonic', [{ text: said, isFinal: true }], 0);
      h.askDone();
      h.flushTimers(3);
      out.during.push({ said: said, filed: logOf(h).filed.slice() });
    }
  }
  return out;
}

const MINE = probeSet(SRC);
const CONTROL_FILES = [
  { name: 'origin/main (round 5, LIVE)', env: 'MLS_AVATAR_MAIN',
    mustFail: ['restart files a headless fragment', 'the continuation is silently lost', 'answers are welded'] },
  { name: 'wip/avatar-speech-round6 (round 7)', env: 'MLS_AVATAR_R7',
    mustFail: ['answers are welded', 'the four negation controls are refused'] },
];
const controlLines = [];
for (const c of CONTROL_FILES) {
  const p = process.env[c.env];
  if (!p) {
    controlLines.push('SKIPPED (' + c.env + ' not set): ' + c.name + ' — expected to fail: ' +
      c.mustFail.join('; '));
    continue;
  }
  assert.ok(fs.existsSync(p), c.env + ' points at ' + p + ' and there is no such file, so the ' +
    'control cannot run and must not be reported as passing');
  const R = probeSet(fs.readFileSync(p, 'utf8'));
  const failures = [];
  /* 1. the pre-fix bytes must produce DIFFERENT filed strings somewhere, or nothing changed */
  const same = JSON.stringify([R.restart.filed, R.cont.filed, R.cont.lost, R.join.filed]) ===
    JSON.stringify([MINE.restart.filed, MINE.cont.filed, MINE.cont.lost, MINE.join.filed]);
  assert.ok(!same,
    'THE CONTROL PRODUCES THE SAME FILED STRINGS AS THE NEW CODE (' + c.name + '). Running the ' +
    'same probe against old and new and diffing the filed text is exactly what exposed rounds 6 ' +
    'and 7 claiming a fix that changed nothing. Either this change is a no-op or the probe is not ' +
    'reaching the behaviour.\n  control: ' + JSON.stringify(R) + '\n  new:     ' + JSON.stringify(MINE));
  /* 2. and it must fail the NAMED assertions */
  if (R.restart.filed.length) failures.push('restart files a headless fragment: ' + JSON.stringify(R.restart.filed));
  if (R.cont.lost.length) failures.push('the continuation is silently lost: ' + JSON.stringify(R.cont.lost));
  if (R.join.filed.some((t, i) => i > 0 && t.indexOf(R.join.filed[0]) >= 0)) {
    failures.push('answers are welded: ' + JSON.stringify(R.join.filed));
  }
  const overRefused = R.during.filter((d) => d.filed.length === 0).map((d) => d.said);
  if (overRefused.length) failures.push('the four negation controls are refused: ' + JSON.stringify(overRefused));
  const hit = c.mustFail.filter((m) => failures.some((f) => f.indexOf(m) === 0));
  assert.ok(hit.length > 0,
    'THE CONTROL PASSED (' + c.name + '). It was expected to fail at least one of: ' +
    c.mustFail.join('; ') + '. A control that passes means these assertions are not testing the ' +
    'thing they were written for — run the OLD code against the NEW test, and if it passes, the ' +
    'test is not a test.\n  observed: ' + (failures.join('\n            ') || '(nothing)'));
  controlLines.push('RAN ' + c.name + ' -> FAILS: ' + failures.join(' | '));
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   15. ASSERTIONS THIS CHANGE MOVED — QUOTED VERBATIM, WITH THE REASON
   ═════════════════════════════════════════════════════════════════════════════════════════════
   ⛔ Round 7 deleted an assertion and the product then failed it. Nothing may be weakened
   silently, so every assertion this rewrite contradicted is recorded here in its ORIGINAL WORDS
   together with what replaced it — and this group asserts the REPLACEMENT is present, so the
   requirement each one carried is still enforced by something.
   Population: derived by running the two existing avatar suites against the new bytes and
   collecting every assertion that went red. Five, in two files. */
const MOVED = [
  {
    file: 'tests/avatar-listens-while-speaking.test.js',
    was: "assert(/if \\(piece && pvIsSelfEcho\\(piece\\)\\) continue;/.test(source),\n" +
         "  'the echo filter must run INSIDE pvListen, per result — filtering only in the caller " +
         "means the avatar\\'s words enter finalText and the whole answer is rejected with them');",
    why: 'THIS ASSERTION PINNED ROUND 5\'S DEFECT IN PLACE. `continue` drops a segment out of the ' +
         'MIDDLE of an accumulation that is then filed as a complete answer — the exact partial ' +
         'filing that inverts a denial. The requirement it was written for (the filter must not ' +
         'sit only in the caller, or one echo costs the whole answer) is kept and strengthened: ' +
         'the classifier still runs per piece inside pvListen, but it MARKS the Answer instead of ' +
         'deleting words, and no piece is ever removed. This is the same correction the suite\'s ' +
         'own group 5d already made once, for the same reason: "a pin that holds a defect in ' +
         'place is worse than no pin".',
    nowAssert: () => assert.ok(/if \(pvIsSelfEcho\(p\)\) this\.echo = true;/.test(SRC) &&
      /this\.text \+= \(this\.text \? ' ' : ''\) \+ p;/.test(SRC),
      'the echo classifier no longer marks the Answer at the source — either it is gone or it is ' +
      'deleting words again'),
  },
  {
    file: 'tests/avatar-listens-while-speaking.test.js',
    was: "assert(/function submit\\(\\)[\\s\\S]{0,1200}if \\(!v\\) return;[\\s\\S]{0,200}rec\\.stop\\(\\)/.test(listen),\n" +
         "  'submit() must refuse BEFORE stopping the recogniser when nothing survived the filter " +
         "— otherwise one echo leaves the kiosk deaf until the 9s watchdog');",
    why: 'STRENGTHENED, NOT RELAXED: submit() no longer stops the recogniser AT ALL, so there is no ' +
         'ordering left to get wrong and the kiosk cannot go deaf after an echo. The half teardown ' +
         'this pinned was itself a defect in three ways (it left the quiet timer armed so the same ' +
         'answer filed twice; it left the handlers wired; and it forced the next turn to build a ' +
         'NEW recogniser, which is round 4 through the back door).',
    /* ⚠️ COMMENTS BLANKED. submit()'s own note QUOTES the teardown it removed, so a raw text scan
       reports the explanation as the defect — the seventh time in this lane a sweep has flagged its
       own documentation. */
    nowAssert: () => {
      const bare = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
      const from = bare.indexOf('function submit() {', bare.indexOf('function pvListen('));
      const to = bare.indexOf('function armQuiet(', from);
      assert.ok(from > 0 && to > from, 'submit() could not be scoped inside pvListen');
      assert.ok(!/rec\.stop\(\)/.test(bare.slice(from, to)),
        'submit() closes the microphone again — the next turn then starts listening at a moment ' +
        'nobody chose, and cannot know that what it hears is whole');
    },
  },
  {
    file: 'tests/avatar-listens-while-speaking.test.js',
    was: "assert(/if \\(pvSaying && otherVoice\\) pvStopSpeechOnly\\(\\);/.test(body),\n" +
         "  'barge-in must fire from the interim path, on the decided condition');",
    why: 'THE OWNER\'S COMPLAINT IS THIS LINE. Barge-in fired from the microphone, and the only ' +
         'thing between it and the avatar\'s own voice was a classifier that was measured being ' +
         'fooled — 42 of 232 mis-transcribed echoes read as an interruption. The requirement ' +
         '("the patient can still cut a question short") is kept in full and made unforgeable: it ' +
         'moved to #mlsAvKioskSkip, whose handler refuses any event that is not isTrusted. The ' +
         'sibling assertion that pvStopSpeechOnly has exactly ONE call site is kept UNCHANGED and ' +
         'is re-asserted in section 7 above.',
    nowAssert: () => assert.ok(/function kioskSkipSpeech\(ev\) \{/.test(SRC),
      'the interrupt was removed rather than moved — the patient can no longer cut a question short'),
  },
  {
    file: 'tests/avatar-finishes-its-sentences.test.js',
    was: "assert.ok(/pvNovelWordCount\\(pvSaying, interim\\)/.test(body),\n" +
         "  'barge-in no longer consults the novel-word count — the interim handler can silence " +
         "the avatar again');",
    why: 'The interim handler can no longer silence the avatar BY ANY MEANS, which is strictly ' +
         'stronger than consulting a better classifier first. The classifier itself ' +
         '(pvNovelWordCount) is untouched and is still required on the FILING path, where its ' +
         'calibration was measured; that assertion is unchanged and still green.',
    nowAssert: () => assert.ok(/function pvNovelWordCount\(/.test(SRC) &&
      /pvNovelWordCount\(tpl, refused\) < 1/.test(SRC),
      'pvNovelWordCount is gone or is no longer consulted where its calibration was measured'),
  },
  {
    file: 'tests/avatar-finishes-its-sentences.test.js',
    was: "assert.ok(/if \\(pvSaying && !otherVoice\\) return;/.test(body),\n" +
         "  'our own voice is no longer dropped before it can stop the speech or paint the " +
         "interim line');",
    why: 'BOTH HALVES ARE KEPT, by a fence that cannot be defeated by a classifier: while ' +
         'pvAudioLive() the interim handler returns without stopping the speech and without ' +
         'painting anything. pvAudioLive() rather than pvSaying is the correction — pvSaying is ' +
         'cleared by an ESTIMATED-duration watchdog, so the old fence lifted mid-sentence and let ' +
         'the loudspeaker\'s own words onto the patient-facing line.',
    nowAssert: () => assert.ok(/if \(pvAudioLive\(\)\) \{ kiosk\.heardWhileSpeaking = /.test(SRC),
      'the interim handler no longer stands down while audio is live'),
  },
];
for (const mv of MOVED) {
  assert.ok(mv.was.length > 40 && mv.why.length > 80,
    'a moved assertion is recorded without its original words or without a reason, which is how a ' +
    'weakening becomes invisible');
  mv.nowAssert();
}
assert.strictEqual(MOVED.length, 5,
  'the moved-assertion ledger has ' + MOVED.length + ' entries. It is derived from running the two ' +
  'existing avatar suites against these bytes; if that number changed, an assertion moved without ' +
  'being recorded.');

console.log('PASS the answer is an object: ' + byteExact + ' byte-exact filings and ' + refusedWhole +
  ' whole refusals across the four permanent negation/laterality controls in both recogniser ' +
  'shapes, ' + realFiled + ' real answers still filed (so an over-refusing round fails here), ' +
  joinChecked + ' joining scenarios with turn N-1 absent from turn N, a repeated one-word answer ' +
  'filed twice, a mid-question microphone rebuild REFUSED rather than filed, and no answer ' +
  'silently lost.\n' +
  '     ONE OWNER: AvFloor.tok, with every assignment in the file derived and proved to sit inside ' +
  'AvFloor.open/AvFloor.shut, one mint site on the statement a sentence starts, and two shut ' +
  'sites of which one IS the refusal.\n' +
  '     GRAFTS: ' + notes.join('; ') + '; pvAudioLive refuses a stuck element with no sentence in ' +
  'flight; the pure-echo stand-down runs before any re-ask; opening a microphone leaves a live ' +
  'sentence and its continuation intact.\n' +
  '     INTERRUPT: one call site, gated on a TRUSTED event — a synthetic click cannot silence the ' +
  'avatar, a real tap still can.\n' +
  '     CONTROLS: ' + controlLines.join('\n                ') + '\n' +
  '     MOVED ASSERTIONS: ' + MOVED.length + ', each quoted verbatim with its reason and a ' +
  'replacement that is asserted present.');
