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
 * CONTROL — the PRE-FIX BYTES, i.e. the round-5 module, failing each group BY NAME:
 *   AVATAR_SRC_OVERRIDE=<round-5 copy> node tests/avatar-turn-is-whole-or-refused.test.js
 * Result recorded in the report at the bottom of this comment block when the suite is run with
 * MLS_CONTROL_NOTE=1. Groups that pass against the pre-fix bytes are stated as such rather than
 * left to look load-bearing.
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
    ${pvListenSrc}
    var got = { filed: [], refused: [], painted: [], dead: 0 };
    var started = pvListen(
      function (v) { got.filed.push(v); },
      function (v) { got.painted.push(v); },
      function () { got.dead++; },
      function (v) { got.refused.push(v); });
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
      rec: function () { return pvRec; }
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
  /* a trailing result after the filing — Chrome does deliver these — must not re-file it */
  h.inst.emit([{ text: 'its my lower back', final: true }]);
  h.inst.quiet();
  assert.deepEqual(h.inst.got.filed, ['its my lower back'],
    '🚨 THE SAME ANSWER WAS FILED TWICE. A segment already accounted for was read into the next ' +
    'turn, so the patient\'s answer was posted again as a new turn: ' + JSON.stringify(h.inst.got.filed));
  /* and the SECOND, genuinely new turn still files — the microphone really is still live */
  h.inst.emit([{ text: 'its my lower back', final: true }, { text: 'about a seven', final: true }], 1);
  h.inst.quiet();
  assert.deepEqual(h.inst.got.filed, ['its my lower back', 'about a seven'],
    'the microphone did not survive the first turn: the second answer never arrived, which is the ' +
    '"it doesn\'t listen for answers" half of the owner\'s report. Filed: ' +
    JSON.stringify(h.inst.got.filed));
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
  const IN_THE_LOOP = ['kioskTurn', 'kioskWatchdog', 'pvListen'];
  assert.deepEqual(closers.filter((c) => IN_THE_LOOP.indexOf(c.fn) >= 0).map((c) => c.fn + ':' + c.line),
    [],
    '🚨 A FUNCTION INSIDE THE INTERVIEW LOOP CLOSES THE MICROPHONE (pvStopVoice). kioskTurn runs on ' +
    'every answer and kioskWatchdog re-opens the mic on the next line, so this is a tear-down and ' +
    'rebuild once per turn: the replacement recogniser starts listening at a moment nobody chose, ' +
    'and a fragment is byte-identical to a whole answer. Use pvAbandonSpeech, which silences the ' +
    'sentence and leaves the microphone alone.');
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
