'use strict';
/*
 * A TURN IS FILED WHOLE OR REFUSED WHOLE — AND NOTHING HANGS (av-6.3.1)
 * ===========================================================================================
 * ⛔ THIS IS THE THIRD ROUND OF THE SAME DEFECT AT A FINER BOUNDARY, AND THE GRANULARITY IS THE
 * SUBJECT OF THIS FILE. Read the history before changing anything here:
 *
 *   round 4  closed the microphone while the avatar spoke. Patients answer as soon as they
 *            understand — the normal case — so the head of the answer went into a shut microphone
 *            and the recogniser's first result was the TAIL. "no pain in my left leg" was filed as
 *            "pain in my left leg": a wrong-finding entry in a chart, under a green receipt.
 *   round 5  opened the microphone and tagged each recognition SEGMENT held/clean, refusing held
 *            segments and filing the rest. But AN ANSWER SPANS SEVERAL SEGMENTS. A held leading
 *            segment was refused and the clean remainder was filed AS A COMPLETE ANSWER — the
 *            identical inversion, one boundary finer, and much harder to see. Its own suite pinned
 *            that behaviour as CORRECT, which is why it survived a review round.
 *
 * THE LAW THIS FILE EXISTS TO KEEP: any boundary-based separation of "our audio" from "their
 * speech" inside an accumulated transcript CUTS SOMEWHERE, and wherever it cuts is where the
 * meaning lives. English puts negation ("no", "not", "never", "denies") and laterality ("left",
 * "right") at the LEADING EDGE. So the only safe unit is the WHOLE TURN: if any part of the
 * material accumulated for a turn was heard while audio was live, the ENTIRE turn is refused and
 * the patient is asked to say it again. Never spliced, never trimmed, never "the clean part".
 * Occasionally asking a patient to repeat themselves is a cost. Filing an inverted denial is a harm.
 *
 * ⛔ AND THE OTHER HALF, IN THE SAME FILE ON PURPOSE (group T2): a real answer must still be FILED.
 * An earlier round in this lane put an echo rule on the filing path and deleted 9 of 12, then 22 of
 * 22, ordinary "A or B" answers. The refusal gate and the filing gate must never be merged, and
 * keeping both controls here is what makes merging them fail loudly.
 *
 * CONTROL — THE PRE-FIX BYTES, AND THE RESULT, RECORDED.
 * Run against the whole round-5 module, T1 fires first and by name:
 *   `"no pain in my left leg" WAS FILED WITHOUT ITS LEADING WORDS ("no pain in my") ... Filed:
 *    ["left leg"]`
 * — the round-5 defect, demonstrated. But a single red proves only that the FIRST group can fail
 * (assert throws; nothing after it is evaluated), so every group has its own one-fix-at-a-time
 * control in tests/avatar-half-duplex-control.js, each reverting the round-5 bytes for exactly that
 * fix. Run it: `node tests/avatar-half-duplex-control.js`. All of this file's groups are covered
 * there by id — T1, T3, T3b, T4, T5, T6, T6b, A1c, A8d — and each fails by name.
 * ⚠️ T3b is my OWN first attempt at this fix, kept as a control: it identified the turn by "the
 * highest result index seen + 1", which assumes result indices keep rising, and on a recogniser that
 * reuses index 0 the kiosk went permanently deaf after one answer. A rendered proof caught it, not
 * this file — which is why the index-reuse case is now a fixture in group T4.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcPath = process.env.AVATAR_SRC_OVERRIDE || path.join(root, 'feat_mls_avatar.js');
const src = fs.readFileSync(srcPath, 'utf8');

function lift(startNeedle, endNeedle, what) {
  const a = src.indexOf(startNeedle);
  assert.ok(a > 0, what + ': start marker is gone (' + startNeedle + ')');
  const b = src.indexOf(endNeedle, a + startNeedle.length);
  assert.ok(b > a, what + ': end marker is gone (' + endNeedle + ')');
  return src.slice(a, b);
}
/* comments blanked LINE FOR LINE, so a scan cannot report the module's own prose as its defect and
   the line numbers in a failure message still mean something */
function codeOnly(s) { return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')); }

const pvListenSrc = lift('function pvListen(onFinal, onInterim, onDead, onOverlap)', '\n  /* =====', 'pvListen');
/* ⛔ AND ITS ABSENCE IS AN ASSERTION, NOT A LIFT ERROR. Run against the pre-fix bytes, a bare
   lift() dies with "start marker is gone", which tells a reader that the TEST is broken rather than
   that the PRODUCT has no restart gate. A control that cannot be read is not a control. */
assert.ok(src.indexOf('  var pvReAsk = false;') > 0,
  '🚨🚨 THERE IS NO RESTART GATE IN THIS FILE. A refused turn is therefore followed by whatever the ' +
  'recogniser delivers next — and because a "turn" is ended by a 1.3-second silence timer, what it ' +
  'delivers next is routinely the SECOND HALF of the sentence that was just refused, filed as a ' +
  'complete answer with its negation or its laterality missing. That is rounds 4, 5 and 6 of this ' +
  'defect, and no choice of boundary fixes it: the mechanism has to be refuse -> RE-ASK -> accept ' +
  'only speech that BEGAN after the asking (pvArmReAsk / pvOpenReAsk / pvReAskState).');
/* THE RESTART GATE, LIFTED RATHER THAN STUBBED (av-6.3.2). A stub of pvArmReAsk/pvOpenReAsk would be
   a re-implementation of the thing under test, and this lane has already shipped a stub looser than
   the real thing that hid the call it was written to catch. These are the module's own bytes. */
const reAskSrc = lift('  var pvReAsk = false;',
  '  /* ── WHY THERE IS NO LONGER A DEFERRED LISTEN', 'the restart gate');

/* ── THE MICROPHONE HARNESS: the SHIPPED pvListen, executed ────────────────────────────────────
   Nothing here re-implements the module. The recogniser is fake so the result stream is under the
   test's control, and `audioLive` is injectable so a segment can be made to begin during playback
   or after it. Every handler that runs is the shipped one. */
function mic(opts) {
  const o = opts || {};
  const log = [];
  const api = new Function('log', 'cfg', `
    var pvRec = null, pvSaying = cfg.saying || '', pvSpeakSeq = 1;
    var audioLive = !!cfg.audioLive;
    var isFn = function (f) { return typeof f === 'function'; };
    var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
    var pvAudioLive = function () { return audioLive; };
    var pvIsSelfEcho = function (t) { return (cfg.echo || []).indexOf(String(t)) >= 0; };
    /* ⚠️ A CONTROLLED CLOCK, because the whole of group T7 is about WHEN things happened and this
       harness runs a whole interview inside one millisecond of wall clock. With the real Date.now()
       an answer that began before the re-prompt and one that began after it are the same number, so
       the test would pass or fail on the machine's timer resolution rather than on the code. */
    var clock = 1600000000000;
    var Date = { now: function () { return clock; } };
    var timers = [], nextId = 1;
    var setTimeout = function (fn, ms) { timers.push({ id: nextId, fn: fn, ms: ms }); return nextId++; };
    var clearTimeout = function (id) { for (var i = 0; i < timers.length; i++) if (timers[i].id === id) { timers.splice(i, 1); return; } };
    var rec = null;
    var window = { SpeechRecognition: function () {
      rec = this;
      this.start = function () { log.push('rec.start'); };
      this.stop = function () { log.push('rec.stop'); };
    } };
    function pvStopMicOnly() {
      log.push('pvStopMicOnly');
      if (!pvRec) return;
      safe(function () { if (isFn(pvRec.__killQuiet)) pvRec.__killQuiet(); });
      safe(function () { pvRec.onresult = null; pvRec.onend = null; pvRec.onerror = null; pvRec.stop(); });
      pvRec = null;
    }
    ${reAskSrc}
    ${pvListenSrc}
    var got = { filed: [], refused: [], why: [], painted: [], dead: 0 };
    var started = pvListen(
      function (v) { got.filed.push(v); },
      function (v) { got.painted.push(v); },
      function () { got.dead++; },
      function (v, why) { got.refused.push(v); got.why.push(why || ''); });
    /* ONE RESULT EVENT, shaped exactly like Chrome's: \`results\` is CUMULATIVE and resultIndex says
       where it changed. Sending only the new segment would leave the shipped loop with nothing to
       iterate — a mistake that made an earlier fixture report a splice the module never performed. */
    function emit(segs, from) {
      var results = segs.map(function (s) { return [{ transcript: s.text }]; });
      results.forEach(function (r, i) { r.isFinal = !!segs[i].final; });
      rec.onresult({ resultIndex: from === undefined ? 0 : from, results: results });
    }
    return {
      started: started, got: got, emit: emit,
      live: function (v) { audioLive = v; },
      say: function (v) { pvSaying = v; },
      quiet: function () { var t = timers.slice(); timers.length = 0; t.forEach(function (x) { x.fn(); }); },
      pending: function () { return timers.length; },
      end: function () { rec.onend(); },
      rec: function () { return pvRec; },
      /* the restart gate, driven exactly the way the module drives it: kioskReAsk calls pvArmReAsk
         (and the refusal itself arms it), and pvSpeakVoiced's finish() calls pvOpenReAsk when the
         asking has finished being spoken. Nothing here re-implements either. */
      arm: function () { pvArmReAsk(); },
      /* the caller's own decision when every word of a refused turn was a word we were saying */
      standDown: function () { pvReAskStandDown(); },
      reprompted: function () { pvOpenReAsk(); },
      gate: function () { return pvReAskState(); },
      tick: function (ms) { clock += (ms === undefined ? 500 : ms); return clock; }
    };
  `);
  return { inst: api(log, o), log };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   T1. THE PERMANENT CONTROLS. These four sentences are the reason this subsystem is dangerous.
   Each one must survive BYTE-EXACT through the filing path, or be refused ENTIRELY. There is no
   third outcome and there is no partial credit: a shortened version of any of them is a different
   clinical fact, and it is filed under a receipt that says everything worked.
   ⛔ DO NOT ADD A CASE THAT EXPECTS A REMAINDER TO BE FILED. That is what round 5's suite did.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
const NEGATIONS = [
  /* label,                              the whole answer,          where the question's tail cuts it */
  ['negation + laterality', 'no pain in my left leg', 'no pain in my'],
  ['negation + laterality, other side', 'not the right one', 'not the'],
  ['negation + frequency + laterality', 'never on the left side', 'never on the'],
  ['a clinician-style denial', 'denies chest pain', 'denies'],
];
{
  for (const [label, whole, head] of NEGATIONS) {
    const tail = whole.slice(head.length).trim();
    assert.ok(tail && head && head + ' ' + tail === whole,
      'the fixture for "' + label + '" does not split its own sentence cleanly, so it is testing ' +
      'nothing (' + JSON.stringify([head, tail]) + ')');

    /* (a) THE STRADDLE: the patient starts answering over the tail of the question. Chrome finalises
       the part it had, then the rest. The turn is refused ENTIRE — head and tail together. */
    const straddle = mic({ audioLive: true, saying: 'is the pain in your left leg' });
    straddle.inst.emit([{ text: head, final: true }]);
    straddle.inst.live(false);                     /* the question ends mid-answer */
    straddle.inst.emit([{ text: head, final: true }, { text: tail, final: true }], 1);
    straddle.inst.quiet();
    assert.deepEqual(straddle.inst.got.filed, [],
      '🚨🚨 "' + whole + '" WAS FILED WITHOUT ITS LEADING WORDS ("' + head + '"). The answer began ' +
      'while the avatar was still speaking, so its first segment is held and its second is clean — ' +
      'and filing the clean remainder files "' + tail + '" as a complete answer. English puts ' +
      'negation and laterality at the front, so the words dropped are exactly the ones that decide ' +
      'the clinical fact: this is the round-4 wrong-site defect at a finer boundary. The unit is the ' +
      'TURN. Filed: ' + JSON.stringify(straddle.inst.got.filed));
    assert.deepEqual(straddle.inst.got.refused, [whole],
      'the refused turn was not reported WHOLE and byte-exact for "' + label + '". A refusal is ' +
      'safe; a silent or partial one is not — the patient must be asked to say it again, and the ' +
      'material handed to the caller must be everything the turn accumulated, in arrival order. ' +
      'Refused: ' + JSON.stringify(straddle.inst.got.refused));

    /* (b) THE CLEAN CASE, which the refusal must never eat: the same sentence with the room to
       itself must reach the server BYTE-EXACT, leading words included. */
    const clean = mic({ audioLive: false });
    clean.inst.emit([{ text: head, final: false }]);
    clean.inst.emit([{ text: whole, final: true }]);
    clean.inst.quiet();
    assert.deepEqual(clean.inst.got.filed, [whole],
      '🚨 "' + whole + '" WAS NOT FILED VERBATIM when nothing was playing (' + label + '). ' +
      'Refusing is safe; refusing everything is a kiosk that cannot take an answer, and an answer ' +
      'silently altered is worse than either. Filed: ' + JSON.stringify(clean.inst.got.filed));
    assert.deepEqual(clean.inst.got.refused, [],
      'a clean utterance was reported as refused (' + label + ')');

    /* (c) AND THE SPLIT MUST NOT MATTER. The same whole answer delivered as three clean segments is
       still that answer, in order, with nothing joined out of sequence or dropped. */
    const words = whole.split(' ');
    const thirds = [words.slice(0, 1).join(' '), words.slice(1, 2).join(' '), words.slice(2).join(' ')];
    const many = mic({ audioLive: false });
    for (let i = 0; i < thirds.length; i++) {
      many.inst.emit(thirds.slice(0, i + 1).map((t) => ({ text: t, final: true })), i);
    }
    many.inst.quiet();
    assert.deepEqual(many.inst.got.filed, [whole],
      'a clean answer delivered as ' + thirds.length + ' segments was not filed as the sentence the ' +
      'patient said (' + label + '): ' + JSON.stringify(many.inst.got.filed) + '. Segment count is ' +
      'Chrome\'s business, not a clinical boundary.');
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   T2. THE REAL-ANSWER CONTROL, IN THIS FILE ON PURPOSE.
   The refusal gate above and the filing gate below must never be merged into one rule. They have
   been, twice, and the merge deleted 9 of 12 and then 22 of 22 ordinary answers — measured. These
   are the shapes that were deleted: answers built entirely from the question's own words, bare
   lateralities, bare refusals, and numbers.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
{
  const REAL = ['in the morning', 'the left one', 'yes', 'no', 'left', 'seven',
    'its more in my lower back on the right side'];
  for (const said of REAL) {
    const h = mic({ audioLive: false, saying: 'is it worse in the morning, or the evening?' });
    h.inst.emit([{ text: said, final: true }]);
    h.inst.quiet();
    assert.deepEqual(h.inst.got.filed, [said],
      '🚨 A PATIENT\'S ANSWER WAS DROPPED: "' + said + '". Nothing was playing, so there is no ' +
      'overlap and no reason to refuse. Deciding to stop talking is never destructive; refusing to ' +
      'file an answer destroys clinical information. This is the regression that cost 9 of 12 and ' +
      'then 22 of 22 ordinary A-or-B answers. Filed: ' + JSON.stringify(h.inst.got.filed));
  }
  /* and an all-echo turn is refused, costs the microphone nothing, and files nothing */
  const echo = mic({ audioLive: true, saying: 'is the pain in your left leg',
    echo: ['is the pain in your left leg'] });
  echo.inst.emit([{ text: 'is the pain in your left leg', final: true }]);
  echo.inst.quiet();
  assert.deepEqual(echo.inst.got.filed, [], 'the avatar\'s own voice was filed as the patient\'s answer');
  assert.deepEqual(echo.inst.got.refused, ['is the pain in your left leg'],
    'an all-echo turn vanished with no report, so "the avatar records itself talking" cannot be ' +
    'measured, only argued about');
  assert.ok(echo.log.indexOf('rec.stop') < 0,
    'AN ALL-ECHO TURN COST THE MICROPHONE. One echo would then leave the kiosk deaf until the ' +
    '9-second watchdog revived it — the "it doesn\'t listen for answers" half of the owner\'s report.');
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   T3. THE BOUNDARY IS THE TURN, AND IT IS EXPLICIT IN THE CODE.
   A property, not a fixture: for a turn of N segments, refusal must depend ONLY on whether any
   segment was held — never on which one, never on how many.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
{
  const SEGS = ['well it started', 'about three weeks ago', 'and its worse at night'];
  for (let heldAt = -1; heldAt < SEGS.length; heldAt++) {
    const h = mic({ audioLive: false, saying: 'tell me about the pain' });
    for (let i = 0; i < SEGS.length; i++) {
      h.inst.live(i === heldAt);
      h.inst.emit(SEGS.slice(0, i + 1).map((t) => ({ text: t, final: true })), i);
    }
    h.inst.live(false);
    h.inst.quiet();
    const whole = SEGS.join(' ');
    if (heldAt < 0) {
      assert.deepEqual(h.inst.got.filed, [whole],
        'a turn with no overlap at all was not filed: ' + JSON.stringify(h.inst.got.filed));
    } else {
      assert.deepEqual(h.inst.got.filed, [],
        '🚨 A REMAINDER WAS FILED because only segment ' + heldAt + ' of ' + SEGS.length +
        ' overlapped the avatar. Refusal may not depend on WHICH segment was held — the held one ' +
        'may be the patient\'s own leading words, and what is filed would then be their sentence ' +
        'with its front removed. Filed: ' + JSON.stringify(h.inst.got.filed));
      assert.deepEqual(h.inst.got.refused, [whole],
        'the refused turn was not handed over whole when segment ' + heldAt + ' was the held one: ' +
        JSON.stringify(h.inst.got.refused));
    }
  }
  /* ── AND THE TAG IS WRITTEN ONCE, ON FIRST SIGHTING — WHICH ONLY MATTERS IN THIS DIRECTION ────
     The whole-turn latch already makes re-tagging harmless when a segment goes clean -> held. The
     case it does NOT cover is the other way round, and it costs a patient their answer: the patient
     answers into a silent room (clean), and while they are still speaking the avatar starts saying
     something — the 9-second nudge, a refusal apology. A re-tagging rule would then judge the
     growing segment 'held' and REFUSE an answer that began with the room to itself.
     ⛔ That is a DROPPED ANSWER, the one outcome this file must never risk, so it is a control and
     not a footnote. */
  const nudged = mic({ audioLive: false, saying: '' });
  nudged.inst.emit([{ text: 'its my lower', final: false }]);
  nudged.inst.live(true);                          /* the silence nudge starts talking over them */
  nudged.inst.emit([{ text: 'its my lower back on the right side', final: true }]);
  nudged.inst.live(false);
  nudged.inst.quiet();
  assert.deepEqual(nudged.inst.got.filed, ['its my lower back on the right side'],
    '🚨 A PATIENT\'S ANSWER WAS REFUSED BECAUSE THE AVATAR INTERRUPTED THEM. The utterance began ' +
    'with the room to itself, so it is theirs and it is whole; the avatar only started speaking ' +
    '(the nudge, an apology) while they were mid-sentence. A segment must be tagged ONCE, on first ' +
    'sighting — re-judging it later moves the boundary as the patient talks, and here it moves it ' +
    'onto a perfectly good answer. Filed: ' + JSON.stringify(nudged.inst.got.filed));

  /* AND THE GRANULARITY IS WRITTEN DOWN WHERE THE NEXT ROUND WILL READ IT. A comment is not a
     fence, but this one is the difference between a fix and a fix that gets quietly refined back
     into the defect — round 5 was exactly that, and its own suite blessed it. */
  const listenCode = codeOnly(pvListenSrc);
  assert.ok(/turnHeld/.test(listenCode) && /turnText/.test(listenCode),
    'the single accumulation and the single overlap latch are gone from pvListen. Two buckets is a ' +
    'splice with a nicer name: a held leading segment refused and a clean remainder filed is how ' +
    '"no pain in my left leg" became "left leg".');
  assert.ok(!/heldText/.test(listenCode),
    'THE SECOND BUCKET IS BACK. `heldText` alongside the filed accumulation means the two are ' +
    'separated, and separating them is the cut this design exists to refuse.');
  assert.ok(/THE UNIT IS THE TURN/.test(pvListenSrc),
    'the granularity is no longer stated in the code. It has been refined back into the defect ' +
    'twice; the next author has to be able to read why the boundary is where it is.');
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   T4. submit() DOES NOT TEAR THE MICROPHONE DOWN, AND A TURN IS FILED AT MOST ONCE.
   The old teardown was `if (pvRec === rec) { rec.stop(); pvRec = null; }` — half of one. It left
   the quiet timer armed and the accumulation populated, so a trailing result re-entered submit();
   and because pvRec was already null by then, the second entry SKIPPED the teardown and went
   straight to onFinal. The same answer, filed twice, as two turns.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
{
  const h = mic({ audioLive: false });
  h.inst.emit([{ text: 'its my lower back', final: true }]);
  h.inst.quiet();                                  /* 1.3s of quiet -> filed */
  assert.deepEqual(h.inst.got.filed, ['its my lower back'], 'the answer was not filed at all');
  assert.ok(h.log.indexOf('rec.stop') < 0,
    'submit() STOPPED THE RECOGNISER. Closing the microphone between turns forces the next turn to ' +
    'build a new one, and a recogniser that starts listening at a moment nobody chose cannot know ' +
    'whether the first thing it hears is the middle of the patient\'s sentence. Log: ' +
    JSON.stringify(h.log));
  assert.ok(h.inst.rec(), 'submit() cleared pvRec, so the next caller will build a second recogniser');
  assert.strictEqual(h.inst.pending(), 0,
    'submit() left the 1.3-second quiet timer armed. It fires again with the accumulation still ' +
    'populated, and the second entry files the SAME answer a second time as a separate turn.');
  /* ⛔ AND THE MICROPHONE MUST STILL WORK ON A PLATFORM THAT REUSES RESULT INDEX 0. This is the
     regression that my own first turn boundary introduced and that a rendered proof caught: it
     identified the turn by "the highest index seen + 1", so on a recogniser that delivers every
     utterance as `resultIndex:0, results:[one]` — a non-continuous session, a polyfill, several real
     platforms — every index after the first turn was below the floor, the loop iterated zero times,
     and THE KIOSK WENT PERMANENTLY DEAF AFTER ONE ANSWER with the microphone light still on. */
  h.inst.emit([{ text: 'about a seven', final: true }]);
  h.inst.quiet();
  assert.deepEqual(h.inst.got.filed, ['its my lower back', 'about a seven'],
    '🚨 THE KIOSK IS DEAF AFTER ITS FIRST ANSWER. The second utterance arrived at the same result ' +
    'index as the first — which is what a non-continuous session and several platforms actually do ' +
    '— and nothing was filed. A turn may be identified by what it has ABSORBED, never by an ' +
    'assumption that result indices keep rising. Filed: ' + JSON.stringify(h.inst.got.filed));
  /* and a CUMULATIVE list re-delivered from index 0 mid-turn must not count the same words twice */
  const dup = mic({ audioLive: false });
  dup.inst.emit([{ text: 'the left one', final: true }]);
  dup.inst.emit([{ text: 'the left one', final: true }]);   /* same event again, resultIndex 0 */
  dup.inst.quiet();
  assert.deepEqual(dup.inst.got.filed, ['the left one'],
    '🚨 THE SAME WORDS WERE COUNTED TWICE INSIDE ONE TURN. `results` is cumulative, so a platform ' +
    'that re-delivers it from index 0 would have the answer doubled ("the left one the left one") ' +
    'and its audio boundary re-judged on every event. Filed: ' + JSON.stringify(dup.inst.got.filed));

  /* ⛔ AND DIFFERENT WORDS AT A REUSED INDEX ARE NEW AUDIO, NOT A RE-DELIVERY. This is the silent
     loss my first `absorbed` guard had: keyed on the index alone, a platform that reused index 0 for
     a genuinely new utterance inside one turn had that utterance DROPPED without a word. Worse, the
     old segment's tag would have been reused, so words spoken over the next question could have been
     filed under a stale 'clean' verdict — the unsafe direction. Both halves are checked here: the
     new words must be taken in, and their own audio boundary must decide the turn. */
  const reuse = mic({ audioLive: false, saying: '' });
  reuse.inst.emit([{ text: 'and also my knee', final: true }]);   /* clean, during the round trip */
  reuse.inst.say('does the pain wake you at night');
  reuse.inst.live(true);                                          /* the NEXT question starts */
  reuse.inst.emit([{ text: 'and also my knee hurts when i kneel', final: true }]);
  reuse.inst.live(false);
  reuse.inst.quiet();
  assert.deepEqual(reuse.inst.got.filed, [],
    '🚨 WORDS SPOKEN OVER A QUESTION WERE FILED UNDER A STALE "CLEAN" VERDICT, or dropped in ' +
    'silence. A reused result index carrying DIFFERENT final words is a new utterance: it must be ' +
    'absorbed (never swallowed) and re-tagged against the audio that was playing when IT arrived, ' +
    'not inherited from the segment that used to live at that index. Filed: ' +
    JSON.stringify(reuse.inst.got.filed));
  assert.ok(reuse.inst.got.refused.length === 1 &&
    reuse.inst.got.refused[0].indexOf('hurts when i kneel') >= 0,
    'the new words at the reused index were SWALLOWED — neither filed nor reported, so the patient ' +
    'is never told and nobody can count it. Refused: ' + JSON.stringify(reuse.inst.got.refused));
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   T5. A LIVE RECOGNISER IS NEVER TORN DOWN AND REBUILT BY ANY CALLER.
   Proven over the WHOLE FILE rather than over a list of callers I remembered: every call site is
   found by walking the source, and the two structural facts that make the property hold are
   asserted directly.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
{
  const code = codeOnly(src);
  const lines = code.split('\n');
  /* (1) pvListen has exactly ONE caller. Everything else in this group rests on that. */
  const listenCalls = [];
  let fn = '';
  lines.forEach((ln, i) => {
    const m = /^  function ([A-Za-z0-9_$]+)/.exec(ln);
    if (m) fn = m[1];
    if (/[^.\w]pvListen\(/.test(ln) && !/function pvListen/.test(ln)) listenCalls.push(fn + ':' + (i + 1));
  });
  assert.deepEqual(listenCalls, ['kioskListen:' + listenCalls[0].split(':')[1]],
    'pvListen is called from ' + listenCalls.length + ' place(s): ' + listenCalls.join(', ') +
    '. It must have exactly one caller, kioskListen, because kioskListen is where the "already ' +
    'listening" refusal lives — a second caller bypasses it and builds a recogniser on top of a ' +
    'live one.');
  /* (2) that caller REFUSES when the microphone is already open, rather than replacing it */
  const kl = codeOnly(lift('function kioskListen(keepMood)', '\n  /* ── THE INTERRUPT', 'kioskListen'));
  assert.ok(/if \(pvRec\) \{[\s\S]{0,400}return;/.test(kl),
    'kioskListen no longer returns early when a recogniser is already live, so every caller that ' +
    'arrives mid-question (the 400ms retry after an ordinary Chrome no-speech error, resume, the ' +
    'PIN pad Back, the next turn\'s own question) replaces it and re-clips the patient mid-word');
  /* (3) the interview loop stops the SPEECH without closing the microphone. Every function that
     closes it is a lifecycle boundary or a human action; the ones inside the loop must not. */
  const closers = [];
  fn = '';
  lines.forEach((ln, i) => {
    const m = /^  function ([A-Za-z0-9_$]+)/.exec(ln);
    if (m) fn = m[1];
    if (/pvStopVoice\(\);/.test(ln) && !/function pvStopVoice/.test(ln) && fn !== 'pvStopVoice') {
      closers.push({ fn, line: i + 1 });
    }
  });
  assert.ok(closers.length >= 8,
    'only ' + closers.length + ' microphone-closing call sites found, so this walk is not seeing ' +
    'them and is guarding nothing');
  /* ⛔ AN ALLOWLIST, NOT A DENYLIST, AND THAT DISTINCTION IS THE WHOLE POINT OF THIS ROUND. My first
     version of this check listed the functions that must NOT close the microphone
     (['kioskTurn', 'kioskWatchdog', 'pvListen']) — which is a list I wrote from memory, so a NEW
     function added inside the interview loop would not have been on it and would have passed
     silently. That is the same defect as the fifteen-id element list and the five-landscape viewport
     list: a population chosen by its author cannot contain what its author forgot.
     Turned round, every mic-closing site must NAME ITSELF as a lifecycle boundary or a human
     action, and anything new is red by default. Each entry below is a place where listening is
     genuinely over — the screen closing, staff exiting, the pause toggle, the hand-off into room
     capture, a finished interview, or the Setup voice preview, which has no kiosk at all. */
  const MIC_MAY_CLOSE = ['setupForm', 'kioskClose', 'kioskRequestEnd', 'kioskPauseToggle', 'openKiosk',
    'kioskAmbientStart', 'kioskAmbientStop', 'kioskStopBounded', 'kioskFinish'];
  assert.deepEqual(closers.filter((c) => MIC_MAY_CLOSE.indexOf(c.fn) < 0).map((c) => c.fn + ':' + c.line),
    [],
    '🚨 A FUNCTION THAT IS NOT A LIFECYCLE BOUNDARY CLOSES THE MICROPHONE (pvStopVoice). If it runs ' +
    'while an interview is in progress — kioskTurn runs on every answer, kioskWatchdog re-opens the ' +
    'mic on the next line — it is a tear-down and rebuild once per turn: the replacement recogniser ' +
    'starts listening at a moment nobody chose, and a fragment is byte-identical to a whole answer. ' +
    'Use pvAbandonSpeech, which silences the sentence and leaves the microphone alone. If listening ' +
    'really is over, add the function to MIC_MAY_CLOSE and say why.');
  /* (4) and the two halves really are separate functions, so a caller has to choose */
  assert.ok(/function pvAbandonSpeech\(\)/.test(src) && /function pvStopMicOnly\(\)/.test(src),
    'the speech stop and the microphone teardown are one function again, so no caller can silence ' +
    'the avatar without also going deaf');
  assert.ok(/function pvStopVoice\(\) \{\s*\n\s*pvAbandonSpeech\(\);\s*\n\s*pvStopMicOnly\(\);\s*\n\s*\}/
    .test(src),
    'pvStopVoice is no longer the COMPOSITION of the two halves, so there are two descriptions of ' +
    'each half and they will drift');
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   T6. THE HANG. A bounded wait that asserts PROGRESS — not merely that nothing threw.
   The audio-authority work added a permanent hang the pre-fix code did not have, in two places:
     · pvAudioLive() applied its trust ceiling only when pvAudioStartAt happened to be set, so an
       Audio element left reporting `paused:false, ended:false` after finish() cleared that field
       made the predicate answer TRUE FOR EVER. Everything keyed to it then jammed shut: the silence
       watchdog returned, the closing net never fired, and every recognition segment was tagged
       'held', so the kiosk refused every answer for the rest of the visit with no fault showing.
     · the closing net was a ONE-SHOT guarded by !pvAudioLive(). The net is the only thing that ends
       an interview whose continuation was stranded — that is its entire purpose — so when audio was
       still live at t=12000 it evaporated and the patient sat on the "thank you" screen for ever.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
const liveSrc = lift('  var pvAudioStartAt = 0;', '\n  /* the continuation of the sentence', 'pvAudioLive');
{
  /* (1) THE PREDICATE CANNOT BE STUCK TRUE. Driven with the worst platform behaviour this lane has
     measured: an element that never reports itself ended, and a synthesiser that never stops. */
  const ask = (cfg) => new Function('cfg', `
    var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
    var pvSaying = cfg.saying || '';
    var pvSpeakSeq = 1, pvWatchdog = null;
    var ttsAudioNow = cfg.el || null;
    var window = { speechSynthesis: { speaking: !!cfg.synth } };
    var clearTimeout = function () {}, setTimeout = function () { return 1; };
    ${liveSrc}
    pvAudioStartAt = cfg.noStart ? 0 : (Date.now() - (cfg.age || 0));
    return { live: pvAudioLive(), remaining: pvAudioRemainingMs(), ceiling: PV_AUDIO_TRUST_MS };
  `)(cfg);
  const NEVER_ENDS = { paused: false, ended: false };
  assert.strictEqual(ask({ el: NEVER_ENDS, noStart: true }).live, false,
    '🚨 THE KIOSK IS DEAF FOR THE REST OF THE VISIT. There is no sentence in flight (pvAudioStartAt ' +
    'is 0, i.e. finish() has run) and an Audio element is still reporting itself unpaused and not ' +
    'ended — a stalled decode, a clip longer than the trust ceiling, a device whose clock ran ' +
    'behind. With the ceiling applied only when pvAudioStartAt is set, this answers TRUE for ever: ' +
    'the silence watchdog returns, the closing net never fires, and every recognition segment is ' +
    'tagged held, so every answer is refused with no fault showing anywhere.');
  assert.strictEqual(ask({ synth: true, noStart: true, saying: 'left over' }).live, false,
    'the same hang through the synthesiser: speechSynthesis.speaking can stay true after the sound ' +
    'stops (this lane has already been bitten by Chrome collecting a live utterance), and with no ' +
    'sentence in flight there is no window to bound it');
  const ceiling = ask({ synth: true, saying: 'x' }).ceiling;
  assert.strictEqual(ask({ el: NEVER_ENDS, saying: 'x', age: ceiling + 1000 }).live, false,
    'a signal stuck true past the trust ceiling still deafens the kiosk');
  assert.strictEqual(ask({ el: NEVER_ENDS, saying: 'x', age: 10 }).live, true,
    'the fence no longer answers TRUE while the loudspeaker is genuinely playing — a fence that ' +
    'cannot say yes files the avatar\'s own voice as the patient\'s answer');
  assert.strictEqual(ask({ noStart: true }).remaining, 0,
    'pvAudioRemainingMs invents a wait when no sentence is in flight, so every caller that re-arms ' +
    'against it would postpone itself for nothing');

  /* ── AND THE WHOLE TRUTH TABLE, NOT FIVE CASES I CHOSE ────────────────────────────────────────
     The four named cases above exist for their failure messages. The property they are examples of
     is checked here over the COMPLETE product of the predicate's inputs (element playing, synth
     speaking, a sentence in flight, a start time, an age inside or past the ceiling — 2^4 x 2 = 32
     states), because a fence is only as good as the state it was never shown. The invariant:
        pvAudioLive() can answer YES only inside a trust window that a sentence opened.
     Everything else is a hang waiting for a platform to misbehave. */
  {
    const rows = [];
    for (const el of [null, { paused: false, ended: false }, { paused: true, ended: true }]) {
      for (const synth of [false, true]) {
        for (const saying of ['', 'a sentence']) {
          for (const noStart of [false, true]) {
            for (const age of [10, ceiling + 1000]) {
              const r = ask({ el, synth, saying, noStart, age });
              const inWindow = !noStart && age <= ceiling;
              if (r.live && !inWindow) {
                rows.push(JSON.stringify({ el: el && (el.paused ? 'done' : 'playing'), synth, saying: !!saying,
                  startAt: !noStart, age, live: r.live }));
              }
            }
          }
        }
      }
    }
    assert.deepEqual(rows, [],
      '🚨 pvAudioLive() ANSWERED YES OUTSIDE ANY TRUST WINDOW, in ' + rows.length + ' of 24 states. ' +
      'Every one of them is a permanent hang: the predicate gates the silence watchdog, the closing ' +
      'net, the patient-facing transcript and the held/clean tag on every recognition segment, so a ' +
      'YES it cannot take back deafens the kiosk for the rest of the visit with no fault showing. ' +
      'States: ' + rows.join(' | '));
  }

  /* (2) finish() RELEASES THE ELEMENT, so the state above cannot even be reached. */
  const speakSrc = lift('function pvSpeakVoiced(text, then, voiceOverride, shape)',
    '\n    var t = String(text == null', 'pvSpeakVoiced head');
  const out = new Function(`
    var pvSpeakSeq = 0, pvSaying = '', pvWatchdog = null, pvHeld = [];
    var released = 0, paused = 0;
    var ttsAudioNow = { paused: false, ended: false, pause: function () { paused++; this.paused = true; } };
    var kiosk = { ambient: false };
    var safe = function (f, d) { try { return f(); } catch (e) { return d; } };
    var window = { speechSynthesis: { speaking: false, cancel: function () {} } };
    var faceTalkStop = function () {};
    var pvEchoHold = function () {};
    var pvNorm = function (t) { return String(t).toLowerCase(); };
    var clearTimeout = function () {};
    var setTimeout = function () { return 1; };
    /* the restart gate is lifted, not stubbed: finish() stamps the boundary through it, and group
       T7 relies on that being the SHIPPED call rather than a test double */
    var pvRec = null;
    var isFn = function (f) { return typeof f === 'function'; };
    ${reAskSrc}
    ${liveSrc}
    ${speakSrc}
      pvSaying = pvNorm(text);
      pvFinishNow = finish;
      pvAudioStartAt = Date.now();
      return { finish: finish };
    }
    var handle = pvSpeakVoiced('the closing line', function () {});
    handle.finish();
    return { held: !!ttsAudioNow, paused: paused, startAt: pvAudioStartAt, live: pvAudioLive() };
  `)();
  assert.strictEqual(out.paused, 1,
    'finish() DECLARED THE SENTENCE OVER AND LEFT THE LOUDSPEAKER PLAYING. It is armed three ways ' +
    'and one of them is an ESTIMATE, so it reaches this point with the element still unpaused — and ' +
    'the rest of the file now believes nothing is playing while the patient can still hear it.');
  assert.strictEqual(out.held, false,
    'finish() left the finished sentence\'s Audio element in ttsAudioNow. With pvAudioStartAt ' +
    'cleared on the same line, that object is exactly the permanent-hang state group T6(1) describes.');
  assert.strictEqual(out.live, false,
    'the audio fence is still up after the sentence finished, so nothing the patient says next can ' +
    'be filed');
}
{
  /* (3) THE CLOSING NET REACHES kioskFinish EVEN IF THE AUDIO NEVER STOPS — bounded, and measured
     by DRAINING the timers it arms rather than by hoping. */
  const netSrc = lift('  var DONE_NET_MAX', '\n  /* THE SELF-END WATCHDOG', 'the closing net');
  assert.ok(/kioskArmDoneNet\(12000, 0\);/.test(src),
    'the closing branch no longer arms the safety net, so a stranded continuation leaves the patient ' +
    'on the "thank you" screen for ever');
  const run = (live) => {
    const log = [];
    const timers = [];
    new Function('log', 'live', 'setTimeout', `
      var kiosk = { open: true, completed: false };
      var pvAudioLive = function () { return !!live; };
      var pvAudioRemainingMs = function () { return 4000; };
      var kioskFinish = function () { log.push('kioskFinish'); };
      ${netSrc}
      kioskArmDoneNet(12000, 0);
    `)(log, live, (fn, ms) => { timers.push({ fn, ms }); });
    let fired = 0;
    const waits = [];
    while (timers.length && fired < 40) { fired++; const t = timers.shift(); waits.push(t.ms); t.fn(); }
    return { log, fired, waits, pending: timers.length };
  };
  const stuck = run(true);
  assert.deepEqual(stuck.log, ['kioskFinish'],
    '🚨 THE CHECK-IN NEVER FINISHES. The safety net is the only thing that can end an interview ' +
    'whose closing-line continuation was stranded, and a ONE-SHOT net guarded by !pvAudioLive() ' +
    'simply evaporates when audio is still live at t=12000. The rest screen never comes up, the ' +
    'visit is never handed back to staff, and nothing on screen says anything is wrong. The pre-fix ' +
    'code had no such hang: its net was unconditional. Timers fired: ' + stuck.fired +
    ', waits: ' + JSON.stringify(stuck.waits));
  assert.ok(stuck.fired > 1,
    'the net finished the check-in on its FIRST expiry with audio still live, i.e. it cut the ' +
    'closing line off — the defect the guard was added for');
  assert.ok(stuck.fired <= 6,
    'the net extended ' + stuck.fired + ' times. An unbounded extension is a polling timer, which ' +
    'this module forbids, and it is a hang wearing a different hat.');
  assert.strictEqual(stuck.pending, 0, 'the net left a timer armed after finishing the check-in');
  assert.strictEqual(stuck.waits[0], 12000, 'the net no longer waits 12 seconds before its first check');
  const quiet = run(false);
  assert.deepEqual(quiet.log, ['kioskFinish'], 'the net no longer ends a stranded check-in at all');
  assert.strictEqual(quiet.fired, 1,
    'with nothing playing the net must finish on its first expiry; it took ' + quiet.fired +
    ' expiries, so an ordinary close is delayed by up to a minute');
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   T7. THE CONTINUATION. THIS IS THE GROUP ROUND 6 DID NOT HAVE, AND ITS ABSENCE IS WHY MOVING THE
   BOUNDARY FROM SEGMENT TO TURN CHANGED NOTHING AT ALL.
   ⛔ A "turn" is ended by a 1.3-second silence timer. A patient who pauses mid-sentence for longer
   than that has ONE answer split into TWO turns: turn 1 (held) is refused, turn 2 is clean and files
   AS A COMPLETE ANSWER. It IS a complete turn by the system's definition and it is NOT one by the
   patient's — so round 6 filed "in my left leg" exactly as round 5 filed it, and a lens running the
   same probe against both files got the same strings.
   🔑 The fix is not a finer boundary. It is that a continuation is UNFILEABLE: refuse -> RE-ASK ->
   accept only speech that BEGAN AFTER the re-prompt finished. Every case below is that law.
   ⚠️ THE GATE IS DRIVEN BY THE MODULE'S OWN FUNCTIONS: `arm()` is pvArmReAsk (what kioskReAsk calls)
   and `reprompted()` is pvOpenReAsk (what pvSpeakVoiced's finish() calls when the asking ends).
   Nothing here re-implements either, and the refusal itself arms the gate inside submit().
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
{
  for (const [label, whole, head] of NEGATIONS) {
    const tail = whole.slice(head.length).trim();

    /* (a) THE ROUND-6 DEFECT, EXACTLY. The head arrives over the question and is refused. The
       patient pauses longer than 1.3s — so the quiet timer FIRES between the two halves — and then
       finishes their sentence into a silent room. The remainder must NOT be filed. */
    const split = mic({ audioLive: true, saying: 'is the pain in your left leg' });
    split.inst.emit([{ text: head, final: true }]);
    split.inst.live(false);
    split.inst.quiet();                              /* >1.3s of silence: turn 1 ends and is refused */
    assert.deepEqual(split.inst.got.filed, [], 'the held head of the sentence was filed');
    assert.deepEqual(split.inst.got.refused, [head], 'the held head was not refused whole');
    assert.strictEqual(split.inst.got.why[0], 'overlap',
      'the first refusal was reported as "' + split.inst.got.why[0] + '" rather than an overlap');
    /* the patient carries on, in a silent room, with no re-prompt spoken yet */
    split.inst.emit([{ text: tail, final: true }]);
    split.inst.quiet();
    assert.deepEqual(split.inst.got.filed, [],
      '🚨🚨 A CONTINUATION WAS FILED AS A COMPLETE ANSWER: ' + JSON.stringify(split.inst.got.filed) +
      '. "' + whole + '" was split by a pause longer than the 1.3-second quiet timer, so its head ' +
      'became one turn (refused, correctly) and its tail became another — and the tail is a whole ' +
      'turn by this system\'s definition and a FRAGMENT by the patient\'s. This is round 5 and round ' +
      '6 verbatim: "' + tail + '" reads as fluent, plausible and INVERTED, with nothing to mark that ' +
      'the negation was removed. A finer boundary cannot fix this. The answer must be refused until ' +
      'the patient has been RE-ASKED and has STARTED AGAIN.');
    assert.deepEqual(split.inst.got.refused, [head, tail],
      'the continuation was neither filed nor reported. A patient who is talking must be told we are ' +
      'not taking it, or they answer a question nobody is listening to. Refused: ' +
      JSON.stringify(split.inst.got.refused));
    assert.strictEqual(split.inst.got.why[1], 'continuation',
      'the continuation was refused for reason "' + split.inst.got.why[1] + '". The caller needs to ' +
      'know which refusal this is: an overlap may be our own echo and needs no apology, while a ' +
      'continuation always has a patient waiting to be asked again.');

    /* (b) AND AFTER THE RE-PROMPT, THE WHOLE ANSWER IS FILED BYTE-EXACT. The gate must not become a
       kiosk that cannot take an answer — that is the other failure this file exists to prevent. */
    split.inst.arm();                                /* kioskReAsk: discard, close the gate */
    assert.deepEqual(split.inst.gate(), { armed: true, from: 0 },
      'after a refusal the gate is not armed with an UNKNOWN boundary. from:0 is what refuses ' +
      'everything until the asking has actually finished; a non-zero boundary set before the ' +
      'sentence has been said would accept speech the patient began before hearing it.');
    split.inst.reprompted();                         /* finish(): the asking has been said */
    const at = split.inst.gate().from;
    assert.ok(at > 0, 'the boundary was never stamped, so nothing can ever be filed again');
    split.inst.emit([{ text: whole, final: true }]);
    split.inst.quiet();
    assert.deepEqual(split.inst.got.filed, [whole],
      '🚨 THE PATIENT SAID THE WHOLE ANSWER AGAIN AFTER BEING ASKED, AND IT WAS NOT FILED (' + label +
      '). A gate that refuses for ever is a kiosk that cannot take an answer — the 9-of-12 and ' +
      '22-of-22 regression in a different costume. Filed: ' + JSON.stringify(split.inst.got.filed));
    assert.deepEqual(split.inst.gate(), { armed: false, from: 0 },
      'the gate did not stand down when an answer was filed WHOLE. It must, or every later turn in ' +
      'the interview is measured against a stale boundary.');
  }

  /* (c) THE BOUNDARY IS A *START* TIME, NOT THE ABSENCE OF AN OVERLAP — and this is the case where
     the start-time term is the ONLY thing doing the work. The patient talks THROUGH the re-ask: their
     continuation is already accumulating when the asking finishes, and no audio is live by the time
     the quiet timer submits it. Held/clean says "clean". The answer must still be refused, because
     the system knows it began before the patient could have heard the asking. */
  {
    const h = mic({ audioLive: true, saying: 'and how long has that been going on?' });
    h.inst.emit([{ text: 'about three', final: true }]);
    h.inst.live(false);
    h.inst.tick(1400);
    h.inst.quiet();                                  /* turn 1 refused; the gate arms, boundary unknown */
    assert.strictEqual(h.inst.got.why[0], 'overlap', 'the first turn was not refused as an overlap');
    h.inst.tick(300);
    h.inst.emit([{ text: 'weeks maybe a month', final: true }]);  /* the continuation STARTS here */
    h.inst.tick(600);
    h.inst.reprompted();                             /* the asking only finishes NOW */
    h.inst.tick(1400);
    h.inst.quiet();
    assert.deepEqual(h.inst.got.filed, [],
      '🚨 AN ANSWER THAT BEGAN BEFORE THE RE-PROMPT FINISHED WAS FILED. Nothing was playing while its ' +
      'words arrived, so the held/clean test says "clean" — and that is exactly why held/clean cannot ' +
      'be the only term. The system has to know where the answer BEGAN, not merely that no sound ' +
      'overlapped it. Filed: ' + JSON.stringify(h.inst.got.filed));
    assert.strictEqual(h.inst.got.why[1], 'continuation',
      'refused for "' + h.inst.got.why[1] + '" rather than as a continuation');
    /* ⚠️ AND EVERY REFUSAL DEMANDS A FRESH ASKING. The boundary went back to "unknown" when this turn
       was refused, so the previous asking cannot license the next answer either — otherwise one
       re-prompt would authorise an unlimited series of fragments. */
    assert.deepEqual(h.inst.gate(), { armed: true, from: 0 },
      'the boundary survived a second refusal, so ONE asking now licenses every later fragment');
    /* and the same words, begun AFTER a fresh asking, are filed: the term is a time, not a blacklist */
    h.inst.tick(400);
    h.inst.reprompted();
    h.inst.tick(400);
    h.inst.emit([{ text: 'weeks maybe a month', final: true }]);
    h.inst.tick(1400);
    h.inst.quiet();
    assert.deepEqual(h.inst.got.filed, ['weeks maybe a month'],
      'the identical words, begun after the asking finished, were still refused — so the gate is not ' +
      'a start-time test at all and the interview cannot move on. Filed: ' +
      JSON.stringify(h.inst.got.filed));
  }

  /* (d) AND AN ORDINARY INTERVIEW IS UNTOUCHED: with no refusal anywhere, the gate is inert. If it
     were not, it would be refusing answers on every turn and nobody would notice until a chart was
     empty. */
  {
    const h = mic({ audioLive: false, saying: 'is it worse in the morning, or the evening?' });
    assert.deepEqual(h.inst.gate(), { armed: false, from: 0 },
      'the restart gate is armed before anything has been refused, so it is gating ordinary turns');
    for (const said of ['in the morning', 'the left one', 'yes']) {
      const g = mic({ audioLive: false, saying: 'is it worse in the morning, or the evening?' });
      g.inst.emit([{ text: said, final: true }]);
      g.inst.quiet();
      assert.deepEqual(g.inst.got.filed, [said],
        '🚨 A PATIENT\'S ANSWER WAS DROPPED BY THE RESTART GATE: "' + said + '". Nothing had been ' +
        'refused, so there is no continuation to protect against and nothing to gate.');
    }
  }

  /* ══ (d2) 🚨 AND AN ECHO REFUSAL MUST NOT GATE THE NEXT REAL ANSWER ═══════════════════════════
     ⛔ THIS IS THE ONE MY OWN FIX GOT WRONG FIRST, AND IT COST A REAL ANSWER. submit() arms the gate
     on EVERY refusal so no caller can forget to — but a turn whose every word is a word we were
     saying is our own loudspeaker, not a patient, and a room with imperfect echo cancellation
     produces one on nearly every question. Left armed there it DROPPED the patient's next answer:
     measured with the rendered consent/turn-taking proof, "My right knee is swollen and it gave out
     yesterday" filed 0 of 1 with the gate armed on echo, 1 of 1 with the stand-down.
     So the caller runs the calibrated echo test and stands the gate down when nothing of theirs was
     ever in flight (pvReAskStandDown), and this fixture is the control for that decision. */
  {
    const h = mic({ audioLive: true, saying: 'what brings you in today',
      echo: ['what brings you in today'] });
    h.inst.emit([{ text: 'what brings you in today', final: true }]);   /* our own voice, refused */
    h.inst.live(false);
    h.inst.tick(1400);
    h.inst.quiet();
    assert.deepEqual(h.inst.got.refused, ['what brings you in today'], 'the echo was not refused');
    /* the caller's decision, executed: every word was ours, so the gate stands down */
    h.inst.standDown();
    assert.deepEqual(h.inst.gate(), { armed: false, from: 0 },
      'the gate is still armed after an ALL-ECHO refusal. Nothing of the patient\'s was ever in ' +
      'flight, so there is no continuation to protect against — and a room with imperfect echo ' +
      'cancellation produces one of these on nearly every question.');
    h.inst.tick(600);
    h.inst.emit([{ text: 'my right knee is swollen and it gave out yesterday', final: true }]);
    h.inst.tick(1400);
    h.inst.quiet();
    assert.deepEqual(h.inst.got.filed, ['my right knee is swollen and it gave out yesterday'],
      '🚨 A REAL ANSWER WAS DROPPED AFTER AN ECHO REFUSAL. The gate armed itself on our own ' +
      'loudspeaker coming back through the microphone, and then refused the patient. That is the ' +
      'harm class this file exists to keep out — 9 of 12 and then 22 of 22 answers deleted in an ' +
      'earlier round. Filed: ' + JSON.stringify(h.inst.got.filed));
  }

  /* (e) THE DISCARD IS REAL: material already accumulated when the refusal happens can never
     re-appear inside the next answer. Round 5's remainder came back through exactly this door. */
  {
    const h = mic({ audioLive: true, saying: 'is the pain in your left leg' });
    h.inst.emit([{ text: 'no pain in my', final: true }]);
    h.inst.live(false);
    h.inst.arm();                                    /* refused elsewhere; everything in flight goes */
    h.inst.reprompted();
    h.inst.emit([{ text: 'no pain in my left leg', final: true }]);
    h.inst.quiet();
    assert.deepEqual(h.inst.got.filed, ['no pain in my left leg'],
      '🚨 THE REFUSED WORDS SURVIVED INTO THE NEXT ANSWER: ' + JSON.stringify(h.inst.got.filed) +
      '. pvArmReAsk must DISCARD the live recogniser\'s accumulation (rec.__endTurn), or the answer ' +
      'the patient gives after being asked again is their new words with the old fragment welded to ' +
      'the front — a sentence nobody said.');
  }

  /* (f) AND THE MECHANISM IS WHERE THE NEXT ROUND WILL LOOK FOR IT. Three structural facts, because
     each of them is a way a later round could quietly reintroduce a boundary. */
  {
    const code = codeOnly(src);
    /* the boundary is stamped in ONE place, and it is the end of a sentence */
    const finishBody = /function finish\(\)\s*\{([\s\S]*?)\n    \}/.exec(codeOnly(
      src.slice(src.indexOf('function pvSpeakVoiced'))));
    assert.ok(finishBody && /pvOpenReAsk\(\)/.test(finishBody[1]),
      'THE RESTART BOUNDARY IS NO LONGER STAMPED WHERE A SENTENCE ENDS. pvSpeakVoiced\'s finish() is ' +
      'the single place in this file where speech finishes, so it is the only place that can say when ' +
      'the last thing we said to the patient ended. Moved to a call site, the next call site added ' +
      'does not stamp it — and an unstamped boundary refuses every answer for the rest of the visit.');
    const stamps = (code.match(/pvOpenReAsk\(\)/g) || []).length;
    assert.strictEqual(stamps, 2,
      'pvOpenReAsk is called from ' + stamps + ' place(s) (expected 2: its own definition and ' +
      'finish()). More than one stamping site means more than one opinion about where an answer may ' +
      'begin, which is a boundary by another name.');
    /* the refusal itself arms the gate, so no caller can forget to */
    const submitBody = /function submit\(\)\s*\{([\s\S]*?)\n    \}/.exec(codeOnly(
      src.slice(src.indexOf('function pvListen(onFinal'))));
    assert.ok(submitBody && /pvReAsk = true/.test(submitBody[1]),
      'THE GATE IS NO LONGER ARMED BY THE REFUSAL ITSELF. If arming lives only in the caller, then a ' +
      'refusal path that forgets to call it files the next fragment — and there are three refusal ' +
      'paths (overlap, echo, continuation). Arming in submit() is what makes a continuation ' +
      'structurally unfileable rather than unfileable by convention.');
    assert.ok(/pvClearReAsk\(\)/.test(submitBody[1]),
      'the gate never stands down inside submit(), so it must be cleared somewhere a turn merely ' +
      'ARRIVED — which re-opens the hole it exists to close');
    /* and the patient is asked again, out loud, in plain words */
    assert.ok(/REASK_OVERLAP_LINE|REASK_CONT_LINE/.test(code) &&
      /pvSpeakShaped\(line,/.test(code),
      'THE RE-ASK IS NOT SPOKEN. Round 6 printed a hint on the transcript line and nothing else — a ' +
      'patient who is mid-sentence neither reads it nor stops, which is how the rest of their ' +
      'sentence arrived as a fresh "complete" turn. Refuse -> RE-PROMPT -> accept only what starts ' +
      'after it; the middle step has to be audible.');
    assert.ok(/kioskLine\('hint', line\)/.test(code),
      'the re-ask is spoken but never shown, so a patient with the sound down is told nothing');
    /* it may not cut the sentence it is apologising for */
    const reask = lift('  function kioskReAsk(why)', '\n  /* the asking itself', 'kioskReAsk');
    assert.ok(/if \(pvAudioLive\(\)\)/.test(reask) && !/pvAbandonSpeech\(\)/.test(reask),
      'kioskReAsk CUTS THE SENTENCE IT IS APOLOGISING FOR. A refusal usually arrives because the ' +
      'patient talked over a question, so that question is very often still playing — and abandoning ' +
      'it to say sorry is the owner\'s original complaint ("it never gets out everything it wants to ' +
      'say") caused by the fix for a different one. It must WAIT: the sentence finishes, its own ' +
      'ending stamps the boundary, and the asking happens then.');
    assert.ok(/kiosk\.reAsks > REASK_MAX/.test(code),
      'the asking is unbounded, so a patient who keeps talking over the avatar is apologised to for ' +
      'ever');
    assert.ok(!/pvClearReAsk\(\)/.test(reask),
      'kioskReAsk RELEASES THE GATE to break a stall. That puts round 6 back for exactly one turn, ' +
      'which is all it takes: the bound belongs on the APOLOGY, never on the filing rule. Every ' +
      'sentence the kiosk speaks — including the 9-second nudge — stamps a fresh boundary, so a ' +
      'patient can always get an answer in without the gate being opened by hand.');
  }
}

console.log('PASS a turn is filed whole or refused whole, and nothing hangs:');
console.log('  T1 the four permanent controls — "no pain in my left leg", "not the right one", ' +
  '"never on the left side", "denies chest pain" — each survive BYTE-EXACT when the room is theirs ' +
  '(including split across three segments) and are refused ENTIRE, and reported whole, when any ' +
  'part of the turn overlapped playback. No remainder is ever filed.');
console.log('  T2 seven real answers still reach the server, including the ones a previous round ' +
  'deleted (the question\'s own words, a bare laterality, a bare refusal, a number), and an ' +
  'all-echo turn is refused without costing the microphone.');
console.log('  T3 refusal depends only on WHETHER a segment was held, never on which of ' +
  '3 it was; one accumulation, one latch, no second bucket, and the granularity is stated in the ' +
  'code where the next round will read it.');
console.log('  T4 submit() never stops the recogniser, never clears pvRec, leaves no timer armed, ' +
  'and files one answer once — a trailing result cannot re-file it and the next turn still arrives.');
console.log('  T5 pvListen has exactly one caller, that caller refuses to rebuild a live ' +
  'recogniser, and no function inside the interview loop closes the microphone (' +
  'walked over the whole file, not a remembered list).');
console.log('  T6 the audio fence cannot be stuck true outside a sentence or past its ceiling, ' +
  'finish() pauses and releases the element it declared finished, and the closing net reaches ' +
  'kioskFinish through a bounded set of extensions even when the audio never reports itself done.');
console.log('  T7 THE CONTINUATION — the case round 6 did not have, which is why moving the ' +
  'boundary from segment to turn changed nothing. For each of the four permanent controls, an ' +
  'answer split by a pause LONGER than the 1.3s quiet timer is refused in both halves and no ' +
  'fragment is filed; after the re-prompt the whole sentence is filed byte-exact; an answer that ' +
  'BEGAN before the asking finished is refused even though nothing was playing; every refusal ' +
  'demands a fresh asking; the refused words can never re-appear inside the next answer; an ' +
  'interview with no refusal is untouched; and the mechanism is structural — the boundary is ' +
  'stamped only where a sentence ends, the gate is armed by the refusal itself, the re-ask is ' +
  'both spoken and shown, and it never cuts the sentence it is apologising for.');
