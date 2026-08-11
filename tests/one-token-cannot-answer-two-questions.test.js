'use strict';
/*
 * ONE TOKEN CANNOT ANSWER TWO QUESTIONS
 * =============================================================================
 * `pvSaying` carried TWO contracts with incompatible lifetimes:
 *   1. "what are we saying right now" — read to keep a sentence alive.
 *   2. "what do we compare against for echo" — read by BOTH filing gates,
 *      pvIsSelfEcho and the novel-word refusal in kioskListen.
 *
 * The microphone must be able to tear down the recogniser WITHOUT ending the
 * sentence (owner: "it litterly never gets out everyhting it wants to say caosue
 * it picks up its own talking"), which requires contract 1 to survive the
 * teardown — and the moment it did, contract 2 started reading a template that
 * the live build had already expired into the bounded echo tail. Round 9 did
 * exactly that and the avatar filed its own question as the patient's answer in
 * 9 of 15 ordinary turns; 5 of 32 identical-input scenarios filed different
 * strings, every one a silent loss.
 *
 * THE CURE IS A SPLIT, NOT A GATE. `pvEchoSaying` is set and cleared at exactly
 * the statements where the live build set and cleared `pvSaying`; both filing
 * gates read it; only the liveness value outlives the teardown.
 *
 * WHAT EACH SECTION ENUMERATES, AND WHO CHOSE THE POPULATION
 * ---------------------------------------------------------
 * S1  THE ACCEPTANCE GATE. 32 scenarios = a full cross product of three axes,
 *     enumerated by nested loops so nothing can be omitted by an author's
 *     imagination:
 *       A (4) — every moment the LIVE build mutates the echo template, in the
 *               order the shipped code reaches them: the duplex mic-open, a
 *               mid-sentence recogniser re-open (Chrome's routine `no-speech`,
 *               the owner's actual complaint), the natural end of the sentence,
 *               and a re-open after that end. Derived from the live build's own
 *               set/clear sites, not chosen.
 *       B (4) — the transcript shapes the SHIPPED classifier branches on, taken
 *               from its own thresholds: pvEchoMatch is called with minRun 2
 *               while the template is live and minRun 4 for the tail, so the
 *               lengths that straddle both are 2, 4 and the whole template;
 *               plus one real answer carrying novel words, which is the only
 *               shape that cannot be a slice of the question.
 *       C (2) — the two device states the shipped filing refusal is explicitly
 *               conditional on: `pvVoiceGateReady()` false, and true with a
 *               silent room. Both are inputs, set directly on vgReady /
 *               vgLoudFrames, so the comparison isolates the template contract
 *               rather than re-measuring an audio loop.
 *     Every scenario is run through the SHIPPED bytes of three builds — this
 *     working tree, the live build, and the round-9 bytes — by the SAME probe.
 *     The probe never names pvSaying or pvEchoSaying: it drives pvSpeakVoiced,
 *     the real pvListen, the real recogniser handlers and the real onFinal
 *     handler lifted out of kioskListen, so it is valid against a build that has
 *     one binding and a build that has two.
 *     ACCEPTANCE: this tree vs the live build = 0 differences. Round 9 vs the
 *     live build must be NON-zero, or this gate could not have caught it.
 * S1b THE TWO-TURN SEQUENCE, because 32 single-turn scenarios provably CANNOT
 *     reach the mechanism the brief measured. 4 shapes x 2 device states = 8,
 *     driven as: question 1 starts, the microphone re-opens mid-sentence, then
 *     question 2 starts and OVERWRITES the template — after which question 1's
 *     late tail arrives. Added because the S1 control found round 9 differing in
 *     the OPPOSITE direction (over-refusing), which did not match the measured
 *     direction; a control that disagrees with the measurement it reproduces is a
 *     hole in the population, not a discrepancy to explain away. Here round 9
 *     files the avatar's own question, as measured.
 * S2  Negation + laterality byte-exact, plus real-answer controls. Population
 *     CHOSEN BY THE BRIEF, not by this file's author, and asserted to be GREEN
 *     on the live build too: live passes these, so a red here means the fence is
 *     wrong, not the product.
 * S3  Every function reachable from a microphone-derived event, DERIVED by
 *     walking the call graph of the shipped bytes. Nobody chose it: the seeds
 *     are the function expressions installed on the event properties of a value
 *     that traces back to SpeechRecognition, plus the analyser closures reading
 *     the mic stream; the sinks are the functions whose text cancels synthesis,
 *     pauses the tts audio element, or invalidates the utterance sequence. Then
 *     the three real microphone handlers are DRIVEN with the avatar's own words.
 *     CONTROL, in-suite: the same walk and the same execution over the LIVE
 *     bytes must fail, naming pvListen, kioskTurn and kioskFinish.
 * S4  Fifty consecutive silence-watchdog ticks against a sentence that never
 *     ends. Fifty is not a threshold to tune — the assertion is that the wait is
 *     UNCAPPED, so any N would do and a cap at any value fails. CONTROL,
 *     in-suite: the LIVE bytes must cut the sentence and must stop re-arming.
 *
 * ⛔ NOTHING HERE IS A NEW FILING GATE. No state machine, no boundary token, no
 * held/clean tagging. The only product change this suite guards is a split
 * binding and one condition on a watchdog.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const SRC_PATH = process.env.AVATAR_SRC_OVERRIDE || path.join(root, 'feat_mls_avatar.js');

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); pass++; }

/* ═══════════════════════════════════════════════════════════════════════════
   THE THREE BUILDS, PINNED BY COMMIT SHA AND VERIFIED BY DIGEST
   ---------------------------------------------------------------------------
   A baseline named by a BRANCH moves under the suite; a baseline named by a
   commit cannot. Each is pinned by sha AND by the sha256 of the bytes retrieved,
   so a substituted git, a dirty worktree or a rewritten history fails loudly
   instead of quietly comparing this build against itself.
   ═══════════════════════════════════════════════════════════════════════════ */
const BUILDS = {
  live: {
    /* origin/main at the time of this change — THE LIVE BUILD */
    commit: '5cc3aab6c3aaad334314fd7a3cb27f5a20ebdf44',
    sha256: '560d6228a77338135c850f1b0471a244580c418002fef8d0a31c6e8a5bd64969',
  },
  round9: {
    /* the preserved round-9 regression: pvStopMic without the split. Its branch
       is claude/mic-cannot-end-speech-20260811; the commit is what is pinned. */
    commit: 'f8937267ed24492785370de28f582a0dcfcd4030',
    sha256: 'd1f34f729ad627a22bf1259fd8c1c0470e0a5ffb6917ec0f6245b1406d2da69f',
  },
};
/* ⛔ A COMMIT THAT IS NOT PUSHED DOES NOT EXIST. The round-9 regression lives on a
   local branch, so `git show` for it works on THIS machine and nowhere else — a
   suite that depended on it would be red in every clone and would block every
   other lane's gate. Both baselines are therefore carried as gzipped fixtures
   beside this file, verified by the sha256 pin above, with git-show kept only as a
   last resort for a tree that has the objects. */
function bytesOf(commit) {
  const short = commit.slice(0, 8);
  const envKey = 'AVATAR_BASELINE_' + short.toUpperCase();
  if (process.env[envKey]) return fs.readFileSync(process.env[envKey], 'utf8');
  const plain = path.join(__dirname, 'fixtures', 'feat_mls_avatar.' + short + '.js');
  if (fs.existsSync(plain)) return fs.readFileSync(plain, 'utf8');
  const gz = plain + '.gz';
  if (fs.existsSync(gz)) return zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
  /* pinned to the COMMIT, never to a branch name */
  return execFileSync('git', ['show', commit + ':feat_mls_avatar.js'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const SRC = { work: fs.readFileSync(SRC_PATH, 'utf8') };
Object.keys(BUILDS).forEach(k => {
  let text = null, why = '';
  try { text = bytesOf(BUILDS[k].commit); } catch (e) { why = String(e && e.message || e); }
  ok(text && text.length > 100000,
    'THE ' + k.toUpperCase() + ' BASELINE COULD NOT BE READ (' + BUILDS[k].commit.slice(0, 8) + '): ' +
    why + '. This suite\'s acceptance gate is a DIFF against the live build; with no baseline it ' +
    'would pass by having nothing to compare against, which is the exact silent-pass failure four ' +
    'defects in this lane were. Supply it as tests/fixtures/feat_mls_avatar.' +
    BUILDS[k].commit.slice(0, 8) + '.js or via AVATAR_BASELINE_' + BUILDS[k].commit.slice(0, 8).toUpperCase() + '.');
  eq(sha(text), BUILDS[k].sha256,
    'THE ' + k.toUpperCase() + ' BASELINE IS NOT THE PINNED BYTES. Commit ' +
    BUILDS[k].commit.slice(0, 8) + ' should hash to ' + BUILDS[k].sha256 + ' and hashed to ' +
    sha(text) + '. A baseline that can be substituted is not a baseline: the diff below would be ' +
    'comparing this build against something nobody named.');
  SRC[k] = text;
});
/* the two baselines must not be the same bytes, or the round-9 control below
   would be comparing the live build against itself and could never fail */
ok(BUILDS.live.sha256 !== BUILDS.round9.sha256,
  'the live and round-9 baselines are byte-identical, so the control that proves this gate can ' +
  'CATCH a regression is vacuous');

/* ── AND "LIVE" MUST STILL MEAN LIVE ──────────────────────────────────────────
   This suite's whole claim is "byte-identical to the LIVE build". A pin is
   immutable, which is what makes the comparison reproducible — and is exactly how
   it could come to certify against bytes that stopped being live months ago.
   ⚠️ THIS IS NOT PARANOIA: origin/main moved 13 commits WHILE this change was
   being gated, and the only reason the pin was still live is that none of the 13
   touched this file. Verified, not assumed. If a later lane changes
   feat_mls_avatar.js on main, this fails and names the one-line fix, rather than
   quietly grading a new build against a retired baseline. */
{
  let served = null, why = '';
  try {
    execFileSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: root, stdio: 'ignore', timeout: 45000 });
    served = execFileSync('git', ['show', 'origin/main:feat_mls_avatar.js'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { why = String(e && e.message || e); }
  if (served === null) {
    /* NOT a skip of the gate — the pinned-digest assertions above still ran and
       the whole comparison below still runs. Only the freshness cross-check is
       unavailable, and it says so out loud rather than passing silently. */
    console.log('  [UNVERIFIED] could not reach origin/main to confirm the pinned live baseline is ' +
      'still the served one (' + why.split('\n')[0] + '). The acceptance diff below is against ' +
      'commit ' + BUILDS.live.commit.slice(0, 8) + ', digest-verified, but whether that is still ' +
      'what main serves was NOT checked in this run.');
  } else {
    eq(sha(served), BUILDS.live.sha256,
      'THE PINNED "LIVE" BASELINE IS NO LONGER WHAT origin/main SERVES. feat_mls_avatar.js on ' +
      'origin/main now hashes to ' + sha(served) + '; this suite is pinned to ' +
      BUILDS.live.commit.slice(0, 8) + ' at ' + BUILDS.live.sha256 + '. Every "byte-identical to ' +
      'live" claim below is therefore about a retired build.\n' +
      'FIX: re-pin BUILDS.live to the commit that last changed feat_mls_avatar.js, regenerate ' +
      'tests/fixtures/feat_mls_avatar.<short>.js.gz from it, update the sha256, and re-read the ' +
      'diff — a genuine change to the filing path on main is a decision this gate must not hide.');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOOLING, PER SOURCE: a masker so nothing below mistakes a comment or a string
   for code, and a brace-matching lifter so every slice is scoped to a FUNCTION
   rather than a byte window. A byte window is how five pins in this repo cried
   wolf, and one of those false alarms trained a real red to be dismissed.
   ═══════════════════════════════════════════════════════════════════════════ */
function maskLiterals(s) {
  const out = s.split('');
  let i = 0, prev = '';
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { let e = s.indexOf('\n', i); if (e < 0) e = s.length; blank(i, e); i = e; continue; }
    if (c === '/' && s[i + 1] === '*') { let e = s.indexOf('*/', i); e = e < 0 ? s.length : e + 2; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === c) break; j++; }
      blank(i, Math.min(j + 1, s.length)); i = Math.min(j + 1, s.length); prev = 'x'; continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev))) {
      let k = i + 1, inClass = false, closed = false;
      while (k < s.length) {
        const ch = s[k];
        if (ch === '\\') { k += 2; continue; }
        if (ch === '\n') break;
        if (inClass) { if (ch === ']') inClass = false; }
        else if (ch === '[') inClass = true;
        else if (ch === '/') { closed = true; break; }
        k++;
      }
      if (closed) { while (k + 1 < s.length && /[a-z]/.test(s[k + 1])) k++; blank(i, k + 1); i = k + 1; prev = 'x'; continue; }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}
function matchPair(m, open, oc, cc) {
  let d = 0;
  for (let i = open; i < m.length; i++) {
    if (m[i] === oc) d++;
    else if (m[i] === cc) { d--; if (d === 0) return i; }
  }
  return -1;
}
function tooling(src, label) {
  const masked = maskLiterals(src);
  function liftFn(name) {
    const at = masked.indexOf('function ' + name + '(');
    assert.ok(at >= 0, 'liftFn[' + label + ']: ' + name + ' is gone from this module');
    const po = masked.indexOf('(', at);
    const pc = matchPair(masked, po, '(', ')');
    const bo = masked.indexOf('{', pc);
    const bc = matchPair(masked, bo, '{', '}');
    assert.ok(bc > bo, 'liftFn[' + label + ']: could not brace-match ' + name);
    return src.slice(at, bc + 1);
  }
  function liftRegion(startNeedle, endNeedle) {
    const a = masked.indexOf(startNeedle);
    const b = masked.indexOf(endNeedle, a + 1);
    assert.ok(a >= 0 && b > a, 'liftRegion[' + label + ']: ' + startNeedle + ' .. ' + endNeedle + ' is gone');
    return src.slice(a, b);
  }
  /* the onFinal handler that files the patient's answer, lifted as the function
     expression it is — so the probe drives the SHIPPED gates in the SHIPPED
     handler rather than a restatement of them. Restating one line of pvListen is
     precisely how a suite goes green over a live defect. */
  function liftHandler(which, sig) {
    const kl = masked.indexOf('function kioskListen');
    assert.ok(kl > 0, 'liftHandler[' + label + ']: kioskListen is gone');
    const call = masked.indexOf('pvListen(function (finalText)', kl);
    assert.ok(call > 0, 'liftHandler[' + label + ']: kioskListen no longer passes an inline onFinal to pvListen');
    const fn = masked.indexOf('function ' + sig, which === 'final' ? call : call + 1);
    assert.ok(fn > 0, 'liftHandler[' + label + ']: kioskListen no longer passes an inline `function ' +
      sig + '` to pvListen — the probe cannot drive the shipped handler');
    const bo = masked.indexOf('{', masked.indexOf(')', fn));
    const bc = matchPair(masked, bo, '{', '}');
    assert.ok(bc > bo, 'liftHandler[' + label + ']: could not brace-match the ' + which + ' handler');
    return src.slice(fn, bc + 1);
  }
  const liftOnFinal = () => liftHandler('final', '(finalText)');
  /* the interim handler is lifted TOO, and driven, because barge-in lives inside
     it: pvStopSpeechOnly holds the echo template into the bounded tail, so an
     interim that fires it can change what a LATER final result is compared
     against. That coupling must be measured, not argued about. */
  const liftOnInterim = () => liftHandler('interim', '(interim)');
  return { src, masked, label, liftFn, liftRegion, liftOnFinal, liftOnInterim };
}
const T = { work: tooling(SRC.work, 'work'), live: tooling(SRC.live, 'live'), round9: tooling(SRC.round9, 'round9') };

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1 — THE ACCEPTANCE GATE: 32 SCENARIOS, THREE BUILDS, ONE PROBE
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── THE PROBE. Build-agnostic BY CONSTRUCTION: it names no template binding.
   The template is set by calling the shipped pvSpeakVoiced, moved to the bounded
   tail by firing the shipped pvSpeakVoiced watchdog (which lands in finish()),
   and expired by calling the shipped pvListen — whose first statement is the
   teardown whose identity is the whole question at issue. ─────────────────── */
function probeHarness(tl) {
  /* ONE contiguous region, so the stop functions are lifted exactly once. A
     second lift would leave a duplicate declaration and the harness would test
     whichever copy it evaluated last rather than the shipped code. */
  const region = tl.liftRegion('function pvVoiceUsable(v)', 'function pvSpeakVoiced(');
  const speak = tl.liftFn('pvSpeakVoiced');
  const listen = tl.liftFn('pvListen');
  const onFinalSrc = tl.liftOnFinal();
  const onInterimSrc = tl.liftOnInterim();
  /* the harness can only observe the template contract if the classifier, the
     stops and the tail all live inside the lifted region — checked, not assumed */
  ['function pvStopVoice()', 'function pvStopSpeechOnly()', 'function pvIsSelfEcho(',
    'function pvEchoHold(', 'function pvNovelWordCount(', 'var pvEchoTail'].forEach(needle => {
    assert.ok(region.indexOf(needle) >= 0,
      'probe[' + tl.label + ']: `' + needle + '` is not inside the lifted region, so the probe ' +
      'would drive a filing path it cannot observe — a silent pass');
  });
  const body = `
    var report = { filed: [], painted: [] };
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function isFn(f) { return typeof f === 'function'; }
    var pvVoice, pvWantMale = null, pvHeld = [], pvRec = null, pvWatchdog = null, pvSpeakSeq = 0;
    var ttsAudioNow = null, ttsDownUntil = 0;
    function faceTalkStop() {}
    function faceTalkCycle() {}
    function ttsSplitForSpeech(t) { return [t]; }
    /* a fetch that NEVER settles, so the only route out of pvSpeakVoiced is its
       own watchdog — which is what the probe fires to end the sentence */
    function ttsFetchUrl() { return new Promise(function () {}); }
    function ttsPlayUrl() {}
    function pvSpeakSynth(t, mySeq, finish) { finish(); }
    var kiosk = { ambient: false, open: true, echoRefused: 0, nudgeTimer: null, lastTry: null, heard: false };
    function kioskNonce() { return 'n'; }
    function kioskTurn(answer) { report.filed.push(answer); }
    function kioskLine(kind, text) { report.painted.push(kind + ':' + text); }
    var window = {
      speechSynthesis: { cancel: function () {}, getVoices: function () { return []; },
                         speak: function () {}, addEventListener: function () {} },
      SpeechRecognition: FakeRec, webkitSpeechRecognition: FakeRec,
      AudioContext: null, webkitAudioContext: null,
    };
    var _timers = {}, _next = 1;
    function setTimeout(fn) { _timers[_next] = fn; return _next++; }
    function clearTimeout(h) { delete _timers[h]; }
    ${region}
    ${speak}
    ${listen}
    ${'var onFinal = ' + onFinalSrc + ';'}
    ${'var onInterim = ' + onInterimSrc + ';'}
    return {
      report: report,
      /* AXIS C: the two device states the shipped refusal is conditional on,
         supplied as INPUTS on the shipped variables rather than measured */
      gate: function (ready, loud) { vgReady = !!ready; vgLoudFrames = loud | 0; },
      speak: function (q) { pvSpeakVoiced(q, null, null, null); },
      /* the shipped route out of pvSpeakVoiced: its own fetch watchdog lands in
         pvSpeakSynth, which hands straight to the real finish() */
      endSpeech: function () { var h = pvWatchdog; if (h && _timers[h]) { var f = _timers[h]; delete _timers[h]; f(); } },
      openMic: function () { return pvListen(onFinal, onInterim, function () {}); },
      deliverFinal: function (text) {
        /* ⛔ ONLY THE TIMER THE RESULT ITSELF ARMS. Firing every pending timer
           also fired pvSpeakVoiced's fetch watchdog, which lands in finish() and
           ends the sentence — so every scenario silently became "after the
           question ended" and the mid-sentence regime, the one this whole change
           is about, was never probed at all. The probe was wrong before it was
           read; the symptom was the second filing gate never firing once in 32
           scenarios, and that is why that emptiness is asserted on. */
        var before = Object.keys(_timers);
        /* AS CHROME STREAMS IT: the same words as an interim first, then as the
           final. The interim result is what reaches the barge-in decision, and
           barge-in can hold the echo template into the bounded tail — so leaving
           it out would have made the tail state at filing time a matter of
           argument instead of measurement. */
        pvRec.onresult({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: false }] });
        pvRec.onresult({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: true }] });
        /* the shipped 1.3s quiet timer is what submits */
        Object.keys(_timers).forEach(function (k) {
          if (before.indexOf(k) >= 0) return;
          var f = _timers[k]; delete _timers[k]; f();
        });
      },
      refused: function () { return kiosk.echoRefused | 0; },
      hasRec: function () { return !!pvRec; },
    };
  `;
  function FakeRec() { this.onresult = null; this.onerror = null; this.onend = null; }
  FakeRec.prototype.start = function () { this.started = true; };
  FakeRec.prototype.stop = function () { this.stopped = true; };
  return () => new Function('FakeRec', 'Promise', body)(FakeRec, Promise);
}

/* ── THE POPULATION, ENUMERATED BY NESTED LOOPS ───────────────────────────── */
const QUESTION = 'Is it worse in the morning, or in the evening?';
const QWORDS = QUESTION.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
/* AXIS A — every moment the live build mutates the echo template, named by what
   the interview is actually doing. The mic opens BEFORE the question is spoken
   (kioskTurn: `kioskListen(true); pvSpeakShaped(kiosk.lastSay, …)`), so that is
   the order here too. */
const MOMENTS = [
  ['duplex', h => { h.openMic(); h.speak(QUESTION); }],
  ['micReopenMidSentence', h => { h.openMic(); h.speak(QUESTION); h.openMic(); }],
  ['sentenceEnded', h => { h.openMic(); h.speak(QUESTION); h.endSpeech(); }],
  ['micReopenAfterEnd', h => { h.openMic(); h.speak(QUESTION); h.endSpeech(); h.openMic(); }],
];
/* AXIS B — the shapes the SHIPPED filing path branches on, read off the code
   rather than imagined. pvIsSelfEcho calls pvEchoMatch with minRun 2 while the
   template is live and minRun 4 for the bounded tail, so a 2-word and a 4-word
   contiguous slice straddle both thresholds (a longer slice adds no new branch —
   it clears both). The novel-word refusal in kioskListen is reachable only by a
   transcript pvIsSelfEcho MISSES whose words all resolve back to the template,
   which is the merge/clip error mode that gate was measured against (18%
   overall, 52% on merged words) — so that shape is derived from the gate's own
   reason for existing. And one real answer, which is the only shape that cannot
   be a slice of the question at all. */
const SHAPES = [
  ['echoRun2', QWORDS.slice(0, 2).join(' ')],
  ['echoRun4', QWORDS.slice(0, 4).join(' ')],
  /* "worse in the morning" as Chrome mangles a loudspeaker: one merge and one
     clipped word. pvNovelWordCount resolves both back to ours; pvIsSelfEcho
     cannot, because neither is a word of the sentence. */
  ['echoMergedAndClipped', QWORDS.slice(2, 4).join('') + ' the ' + QWORDS[5].slice(0, -1)],
  ['answerNovel', 'about three weeks now'],
];
/* AXIS C — the two device states pvVoiceGateReady() splits the filing refusal on */
const DEVICES = [['noAec', [false, 0]], ['aecSilentRoom', [true, 0]]];

function runPopulation(make) {
  const rows = [];
  MOMENTS.forEach(([mName, arrange]) => {
    SHAPES.forEach(([sName, transcript]) => {
      DEVICES.forEach(([dName, gate]) => {
        const h = make();
        h.gate(gate[0], gate[1]);
        arrange(h);
        if (!h.hasRec()) { rows.push([mName, sName, dName, 'NO-RECOGNISER', 0, '[]']); return; }
        h.deliverFinal(transcript);
        rows.push([mName, sName, dName, JSON.stringify(h.report.filed), h.refused(),
          JSON.stringify(h.report.painted)]);
      });
    });
  });
  return rows;
}

const POP = MOMENTS.length * SHAPES.length * DEVICES.length;
eq(POP, 32,
  'the scenario population is ' + POP + ', not the 32 the acceptance gate is stated over. The ' +
  'axes are derived (4 template-mutating moments x 4 classifier shapes x 2 device states); if one ' +
  'axis changed, say so in the report rather than letting the headline number drift.');

const RESULT = { work: runPopulation(probeHarness(T.work)), live: runPopulation(probeHarness(T.live)),
  round9: runPopulation(probeHarness(T.round9)) };

function diffRows(a, b) {
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const ka = a[i].slice(0, 3).join('/');
    if (a[i][3] !== b[i][3] || a[i][4] !== b[i][4]) {
      out.push(ka + ': live filed ' + b[i][3] + ' refused=' + b[i][4] +
        ' | this build filed ' + a[i][3] + ' refused=' + a[i][4]);
    }
  }
  return out;
}

/* the probe must actually FILE things and actually REFUSE things, or all three
   builds would agree on an empty result and the gate would be decoration */
{
  const filedAny = RESULT.live.filter(r => r[3] !== '[]' && r[3] !== 'NO-RECOGNISER').length;
  const refusedAny = RESULT.live.filter(r => r[4] > 0).length;
  const echoRefused = RESULT.live.filter(r => r[3] === '[]').length;
  ok(filedAny >= 4,
    'the probe filed an answer in only ' + filedAny + ' of ' + POP + ' scenarios on the LIVE build. ' +
    'A probe that files nothing agrees with every build about nothing — this gate would be green ' +
    'with the whole filing path deleted.');
  ok(echoRefused >= 4,
    'the probe refused an echo in only ' + echoRefused + ' of ' + POP + ' scenarios on the LIVE ' +
    'build, so the echo filter is barely exercised and a build that stopped filtering would still ' +
    'match. ' + JSON.stringify(RESULT.live.map(r => r.slice(0, 3).join('/') + '=' + r[3])));
  ok(refusedAny >= 1,
    'the shipped novel-word refusal never fired in any of the ' + POP + ' scenarios, so axis C ' +
    '(device state) is inert and the second filing gate is untested');
}

/* ── THE GATE ─────────────────────────────────────────────────────────────── */
{
  const d = diffRows(RESULT.work, RESULT.live);
  eq(d.length, 0,
    'THE FILED OUTPUT IS NOT BYTE-IDENTICAL TO THE LIVE BUILD. ' + d.length + ' of ' + POP +
    ' scenarios file a different string:\n    ' + d.join('\n    ') + '\n' +
    'This is the acceptance condition of the split and it is absolute — a DIFFERENCE is a defect ' +
    'even when it looks like an improvement, because every one of round 9\'s five differences ' +
    'looked defensible in isolation and all five were silent losses of a patient\'s answer. If the ' +
    'split is right, the echo template\'s lifetime is unchanged and this number is 0.');
}

/* ── THE LIVENESS SIDE IS ALLOWED TO DIVERGE, AND IS MEASURED SO IT CANNOT ───
   SURPRISE ANYONE. The interim handler paints the transcript line and sets
   kiosk.heard, and it reads the LIVENESS value — which now stays set through the
   microphone teardown, because that is the whole point. So mid-sentence the
   avatar's own echo is recognised as its own voice and no longer painted into the
   patient's transcript line, where live painted it (live could not know a sentence
   was playing: it had just cancelled it). This is reported, never asserted: it is
   a deliberate consequence, it is not filing, and no byte of it reaches the chart. */
{
  const paint = [];
  for (let i = 0; i < RESULT.work.length; i++) {
    if (RESULT.work[i][5] !== RESULT.live[i][5]) {
      paint.push(RESULT.work[i].slice(0, 3).join('/') + ': live painted ' + RESULT.live[i][5] +
        ', this build ' + RESULT.work[i][5]);
    }
  }
  console.log('  [measured, NOT a claim] interim PAINT differs from live in ' + paint.length +
    ' of ' + POP + ' scenarios — the liveness side, by design. Filing is asserted identical above.');
  paint.forEach(s => console.log('      ' + s));
}

/* ── AND THE CONTROL THAT PROVES THE GATE CAN FAIL ────────────────────────── */
{
  const d = diffRows(RESULT.round9, RESULT.live);
  ok(d.length > 0,
    'THE ROUND-9 BYTES NOW AGREE WITH THE LIVE BUILD ON ALL ' + POP + ' SCENARIOS. Round 9 is the ' +
    'preserved regression that filed the avatar\'s own question as the patient\'s answer, so a ' +
    'probe that cannot tell it apart from live cannot certify this build either. Either the probe ' +
    'stopped exercising the template lifetime or the wrong commit is pinned.');
  /* and it must fail in the direction that was measured: the avatar's own words
     reaching the chart, at the moment the microphone re-opened mid-sentence */
  const midSentence = d.filter(s => /^micReopenMidSentence/.test(s));
  ok(midSentence.length > 0,
    'round 9 differs from live in ' + d.length + ' scenario(s) but NONE of them at the mid-sentence ' +
    'microphone re-open, which is the moment its regression was measured at. The probe is diverging ' +
    'for some other reason and this control is not proving what it claims:\n    ' + d.join('\n    '));
  console.log('  [control] round9 vs live: ' + d.length + ' of ' + POP + ' scenarios differ');
  d.forEach(s => console.log('      ' + s));
}

/* ── SECTION 1b — THE TWO-TURN SEQUENCE THE ROUND-9 NUMBER WAS MEASURED ON ───
   The 32 above are single-turn, and a single turn CANNOT reach the mechanism the
   brief measured ("filed its own question as the patient's answer in 9 of 15
   ordinary turns"). That needs two questions: the microphone re-opens during
   question 1, then question 2 starts and OVERWRITES the template. On live,
   question 1 went into the bounded tail at the re-open, so its late tail is still
   recognised. Leave the template live instead and nothing ever holds question 1 —
   the next speak overwrites it — so question 1's own words arrive at an empty
   filter and are filed as the patient's answer.
   POPULATION: the same four derived shapes, taken from QUESTION 1 (the one whose
   tail is arriving late), x the same two device states = 8. Derived, not listed.
   ⚠️ Discovered because the 32-scenario control found round 9 differing in the
   OPPOSITE direction (over-refusing), which did not match the brief's measured
   direction. A control that disagrees with the measurement it is meant to
   reproduce is a gap in the population, not a discrepancy to explain away. */
{
  const Q1 = QUESTION;
  const Q2 = 'And how long has it been going on for?';
  function twoTurn(make) {
    const rows = [];
    SHAPES.forEach(([sName, transcript]) => {
      DEVICES.forEach(([dName, gate]) => {
        const h = make();
        h.gate(gate[0], gate[1]);
        h.openMic();
        h.speak(Q1);
        h.openMic();          /* Chrome's routine `no-speech` during question 1 */
        h.speak(Q2);          /* the next question overwrites the template */
        h.deliverFinal(transcript);   /* question 1's late tail arrives here */
        rows.push([sName, dName, JSON.stringify(h.report.filed), h.refused()]);
      });
    });
    return rows;
  }
  const w = twoTurn(probeHarness(T.work));
  const l = twoTurn(probeHarness(T.live));
  const r = twoTurn(probeHarness(T.round9));
  eq(w.length, SHAPES.length * DEVICES.length, 'the two-turn population is not 4 shapes x 2 devices');
  const d = [];
  for (let i = 0; i < w.length; i++) {
    if (w[i][2] !== l[i][2] || w[i][3] !== l[i][3]) {
      d.push(w[i][0] + '/' + w[i][1] + ': live filed ' + l[i][2] + ', this build ' + w[i][2]);
    }
  }
  eq(d.length, 0,
    'THE TWO-TURN SEQUENCE FILES DIFFERENTLY FROM LIVE in ' + d.length + ' of ' + w.length +
    ' cases:\n    ' + d.join('\n    ') + '\nThis is the exact mechanism the round-9 regression was ' +
    'measured on. If question 1 is not held into the bounded tail at the microphone teardown, its ' +
    'late tail meets an empty filter after question 2 overwrites the template, and the avatar\'s ' +
    'own question is filed as the patient\'s answer.');
  /* THE CONTROL, IN THE MEASURED DIRECTION: round 9 must file the avatar's own
     question here — refusing where live files would be a different defect. */
  const ownVoiceFiled = [];
  for (let i = 0; i < r.length; i++) {
    if (r[i][2] !== l[i][2] && l[i][2] === '[]' && r[i][2] !== '[]') {
      ownVoiceFiled.push(r[i][0] + '/' + r[i][1] + ': live refused it, round 9 filed ' + r[i][2]);
    }
  }
  ok(ownVoiceFiled.length > 0,
    'CONTROL FAILED: on the round-9 bytes the two-turn sequence never files a transcript that live ' +
    'refuses, so this section does not reproduce the measured regression ("filed its own question ' +
    'as the patient\'s answer") and cannot certify that this build avoids it. round9 rows: ' +
    JSON.stringify(r));
  console.log('  [control] two-turn, round9 files the avatar\'s OWN QUESTION in ' +
    ownVoiceFiled.length + ' of ' + r.length + ' cases live refuses:');
  ownVoiceFiled.forEach(s => console.log('      ' + s));
}

/* ── AND THE LIFETIMES, SIDE BY SIDE, AS A STRUCTURAL PIN ─────────────────
   The diff above is the proof; this is the invariant that makes it hold for
   inputs the population does not reach. Every statement that CLEARS or SETS the
   live build's pvSaying must have a pvEchoSaying twin in this build, and the two
   filing gates must read the echo binding while the liveness readers keep the
   liveness one. */
{
  /* the innermost NAMED function containing an offset — brace-matched, so a
     statement inside finish() is attributed to finish() and not to its parent */
  function namedScopes(masked) {
    const out = [];
    const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(masked))) {
      const pc = matchPair(masked, masked.indexOf('(', m.index + 8), '(', ')');
      if (pc < 0) continue;
      let q = pc + 1;
      while (q < masked.length && /\s/.test(masked[q])) q++;
      if (masked[q] !== '{') continue;
      const bc = matchPair(masked, q, '{', '}');
      if (bc < 0) continue;
      out.push({ name: m[1], start: m.index, end: bc + 1 });
    }
    return out;
  }
  function assignmentScopes(txt, ident) {
    const masked = maskLiterals(txt);
    const scopes = namedScopes(masked);
    const out = {};
    const re = new RegExp('\\b' + ident + '\\s*=[^=]', 'g');
    let x;
    while ((x = re.exec(masked))) {
      let best = null;
      scopes.forEach(s => { if (s.start < x.index && x.index < s.end && (!best || s.start > best.start)) best = s; });
      const key = best ? best.name : '(module scope)';
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }
  const livePvSaying = assignmentScopes(SRC.live, 'pvSaying');
  const workEcho = assignmentScopes(SRC.work, 'pvEchoSaying');
  const workPvSaying = assignmentScopes(SRC.work, 'pvSaying');
  const fmt = o => Object.keys(o).sort().map(k => k + ' x' + o[k]).join(', ');
  ok(Object.keys(livePvSaying).length >= 5,
    'the walk found pvSaying assigned in only ' + Object.keys(livePvSaying).length + ' scope(s) on ' +
    'the live build (' + fmt(livePvSaying) + '), so the lifetime comparison below is blind');
  /* THE ONE PERMITTED ADDITION, and the reason it is not a lifetime change:
     pvStopMic IS the second half of pvStopVoice. On live, all three mic-travelled
     callers (pvListen, kioskTurn, kioskFinish) reached pvStopVoice and its clear
     ran; here they reach pvStopMic, so the clear has to be there or the template
     would outlive the moment live expired it. pvStopVoice still runs its own copy
     first, so the pvStopMic call it makes is a no-op — same statement, same order. */
  const expected = Object.assign({}, livePvSaying, { pvStopMic: 1 });
  eq(fmt(workEcho), fmt(expected),
    'THE TWO LIFETIMES NO LONGER MATCH.\n  live pvSaying  : ' + fmt(livePvSaying) +
    '\n  expected echo  : ' + fmt(expected) + '\n  this build echo: ' + fmt(workEcho) + '\n' +
    'pvEchoSaying must be set and cleared at EXACTLY the live build\'s moments, plus pvStopMic ' +
    '(which is pvStopVoice\'s own extracted half and the routing target of the three mic-travelled ' +
    'callers). One missing clear leaves a dead question as the echo template and silently deletes ' +
    'every later answer built from its words; one missing set leaves both filing gates comparing ' +
    'against nothing, which files the avatar\'s own voice as the patient\'s answer.');
  /* and the LIVENESS value must not have quietly gained or lost a site either:
     it is allowed to keep exactly live's scopes (it is the same variable) */
  eq(fmt(workPvSaying), fmt(livePvSaying),
    'the LIVENESS binding pvSaying is now assigned in different scopes than on live:\n  live: ' +
    fmt(livePvSaying) + '\n  here: ' + fmt(workPvSaying) + '\nThe split was supposed to leave it ' +
    'alone. A new clear on the liveness side is a sentence cut off; a lost clear wedges the ' +
    'uncapped silence wait for ever and the interview never produces a summary.');
  console.log('  lifetimes: live pvSaying [' + fmt(livePvSaying) + ']');
  console.log('             this pvEchoSaying [' + fmt(workEcho) + ']');
  /* the filing gates read the ECHO binding */
  const isSelfEcho = T.work.liftFn('pvIsSelfEcho');
  ok(/pvEchoSaying && pvEchoMatch\(pvEchoSaying,/.test(isSelfEcho),
    'FILING GATE 1 (pvIsSelfEcho) no longer compares against pvEchoSaying. It is reading the ' +
    'liveness value again, which is the round-9 defect exactly: a template that outlives the ' +
    'microphone teardown changes what is filed.');
  ok(!/\bpvSaying\b/.test(maskLiterals(isSelfEcho)),
    'pvIsSelfEcho reads pvSaying as well as pvEchoSaying. A filing gate with one foot in each ' +
    'contract is the defect this change exists to remove.');
  const kl = T.work.liftFn('kioskListen');
  ok(/if \(pvEchoSaying && pvVoiceGateReady\(\) && !pvOtherVoiceNow\(\) &&\s*\n\s*pvNovelWordCount\(pvEchoSaying, finalText\) === 0\)/.test(kl),
    'FILING GATE 2 (the novel-word refusal in kioskListen) no longer compares against ' +
    'pvEchoSaying — everything it refuses is DELETED, so it must read the binding whose lifetime ' +
    'the live build calibrated it against');
  /* and the liveness readers keep the liveness one */
  const onFinal = T.work.liftOnFinal();
  ok(!/\bpvSaying\b/.test(maskLiterals(onFinal)),
    'the onFinal handler that files the patient\'s answer still reads pvSaying somewhere. Filing ' +
    'must depend on the echo binding alone.');
  const dog = T.work.liftFn('kioskWatchdog');
  ok(/if \(kiosk\.heard \|\| pvSaying\)/.test(dog),
    'the silence watchdog no longer waits on pvSaying, the LIVENESS value. Either the uncapped ' +
    'speech wait is gone (S4 will say so) or it was pointed at the echo binding, which expires at ' +
    'the microphone teardown and would let the watchdog cut a sentence that is still playing.');
  ok(!/pvEchoSaying/.test(maskLiterals(dog)),
    'the silence watchdog reads pvEchoSaying. That binding expires when the microphone is torn ' +
    'down, so the watchdog would stop seeing a sentence that is still coming out of the speaker.');
  const mic = T.work.liftFn('pvStopMic');
  ok(/pvEchoHold\(pvEchoSaying\);\s*\n\s*pvEchoSaying = '';/.test(mic),
    'pvStopMic no longer expires the echo template. Every one of its three mic-travelled callers ' +
    'used to reach pvStopVoice, which moved the sentence into the bounded tail — dropping that is ' +
    'exactly how round 9 came to file the avatar\'s own question as the patient\'s answer.');
  ok(!/\bpvSaying\b/.test(maskLiterals(mic)),
    'pvStopMic touches pvSaying. It is the MICROPHONE teardown; if it ends the sentence, nothing ' +
    'has been fixed.');
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 — NEGATION AND LATERALITY, BYTE-EXACT, ON BOTH BUILDS
   ---------------------------------------------------------------------------
   Population CHOSEN BY THE BRIEF: the four negation/laterality sentences named
   in it, plus the three real-answer controls named in it, because a gate that
   refuses everything scores perfectly on negation while deleting the interview.
   ⚠️ ASSERTED GREEN ON THE LIVE BUILD FIRST. Live passes these, so a red here is
   the fence being wrong, not the product.
   ═══════════════════════════════════════════════════════════════════════════ */
const NEGATIONS = [
  ['no pain in my left leg', 'do you have any pain in your left leg'],
  ['not the right one', 'is it the right one or the left one'],
  ['never on the left side', 'does it ever happen on the left side'],
  ['denies chest pain', 'have you had any chest pain'],
];
const REAL_ANSWERS = [
  ['in the morning', 'is it worse in the morning or in the evening'],
  ['the left one', 'is it the right one or the left one'],
  ['yes', 'have you taken anything for it'],
];
/* ⛔ S2's DEVICE AXIS IS NOT S1's, AND THE DIFFERENCE IS PHYSICAL, NOT COSMETIC.
   A patient giving an answer IS a person audibly in the room, so the confirmed-AEC
   state that a real answer arrives in has vgLoudFrames at or above VG_ONSET_FRAMES
   and pvOtherVoiceNow() true — which is precisely when the shipped novel-word
   refusal stands down. S1 deliberately pairs a transcript with a room the gate
   measured as SILENT, because that is the only state that reaches gate 2 at all;
   that is sound for a DIFF and unsound as a correctness claim.
   MEASURED AND REPORTED BELOW, NOT ASSERTED: in the silent-room state the LIVE
   build already deletes some of these real answers mid-question. Its own comment
   predicted it ("in a NOISY room ... this branch would then delete EVERY answer
   they give while the avatar is still speaking"). It is a live property, it is out
   of this lane's scope, and this suite must not pretend either way. */
const S2_DEVICES = [['noAec', [false, 0]], ['aecPatientAudiblyPresent', [true, 4]]];
/* ⛔ AND THE REGIMES ARE NOT INTERCHANGEABLE EITHER, DELIBERATELY.
   The live build treats a contiguous quote of a sentence STILL PLAYING as its own
   voice ("in the morning" while it is asking "is it worse in the morning or in the
   evening" is the avatar hearing itself), and treats the same words AFTER the
   sentence ends as the ANSWER. That two-regime split is the calibration the
   comments in pvIsSelfEcho record and it is pinned below by execution.
   So the four NEGATIONS — which are the fence, because each scores just UNDER
   pvEchoMatch's 0.8 overlap bar — are required byte-exact in BOTH regimes, and
   the three real-answer controls in the AFTER regime, which is the regime a real
   answer to a finished question arrives in. Asserting a real answer survives
   mid-question would be asserting the aggressive regime away, which is a filing
   change and forbidden in this lane. */
const S2_CASES = NEGATIONS.map(c => [c[0], c[1], 'both'])
  .concat(REAL_ANSWERS.map(c => [c[0], c[1], 'afterOnly']));
function negationRun(tl, devices) {
  const make = probeHarness(tl);
  const out = [];
  S2_CASES.forEach(([answer, question, scope]) => {
    const regimes = scope === 'both' ? [['midQuestion', false], ['afterQuestion', true]]
      : [['afterQuestion', true]];
    regimes.forEach(([regime, ended]) => {
      devices.forEach(([dName, gate]) => {
        const h = make();
        h.gate(gate[0], gate[1]);
        h.openMic();
        h.speak(question);
        if (ended) h.endSpeech();
        h.deliverFinal(answer);
        out.push({ answer, question, regime, dName, filed: h.report.filed.join('|') });
      });
    });
  });
  return out;
}
{
  const live = negationRun(T.live, S2_DEVICES);
  const work = negationRun(T.work, S2_DEVICES);
  eq(live.length, (NEGATIONS.length * 2 + REAL_ANSWERS.length) * S2_DEVICES.length,
    'the S2 population is not the 4 negations x 2 regimes + 3 real answers x 1 regime, x 2 device ' +
    'states, that it is stated as');
  live.forEach(r => {
    eq(r.filed, r.answer,
      'THE FENCE IS WRONG, NOT THE PRODUCT: on the LIVE build "' + r.answer + '" (' + r.regime +
      ', ' + r.dName + ', question "' + r.question + '") was filed as ' + JSON.stringify(r.filed) +
      ' instead of byte-exact. Live passes these sentences in production, so this suite must be ' +
      'green on live BEFORE it is allowed to judge anything.');
  });
  work.forEach((r, i) => {
    eq(r.filed, r.answer,
      'FILING REGRESSION — "' + r.answer + '" (' + r.regime + ', ' + r.dName + ', answered to "' +
      r.question + '") was filed as ' + JSON.stringify(r.filed) + ' instead of the exact bytes. ' +
      'The live build files it correctly (' + JSON.stringify(live[i].filed) + '). Round 7 refused ' +
      'all four negations as "overlap" and round 8 stripped the negation from any answer split by ' +
      'a pause; a negation or a laterality lost on the way to the chart is the most expensive ' +
      'thing in this file to get wrong.');
  });
  /* ── MEASURED, REPORTED, NOT ASSERTED — and it must be IDENTICAL on both ────
     The same seven controls in the silent-room state S1 uses. Whatever the live
     build does there, this build must do the same; that is the acceptance
     condition, and it is checked. What it does is a live property this lane is
     not fixing, so it is printed rather than judged. */
  {
    const silent = [['aecSilentRoom', [true, 0]]];
    const lv = negationRun(T.live, silent);
    const wk = negationRun(T.work, silent);
    const lost = lv.filter(r => r.filed !== r.answer);
    lv.forEach((r, i) => {
      eq(wk[i].filed, r.filed,
        'the silent-room state diverges from live for "' + r.answer + '" (' + r.regime + '): live ' +
        JSON.stringify(r.filed) + ', this build ' + JSON.stringify(wk[i].filed) + '. Byte-identical ' +
        'means byte-identical in every device state, including the ones this lane is not fixing.');
    });
    console.log('  [measured, NOT a claim] with confirmed AEC and a room the gate measured as ' +
      'SILENT, the LIVE build already deletes ' + lost.length + ' of ' + lv.length +
      ' brief controls: ' + (lost.map(r => '"' + r.answer + '" (' + r.regime + ')').join(', ') || 'none') +
      '. Its own comment predicted this. Out of scope here; this build matches it exactly.');
  }

  /* ── THE TWO REGIMES, PINNED BY EXECUTION ─────────────────────────────────
     A later round that collapses them breaks one direction or the other, and
     both directions are measured harms: collapsing to permissive is how the
     avatar came to interview itself; collapsing to aggressive is the 9-of-12 /
     22-of-22 deletion of ordinary A-or-B answers. */
  {
    const mk = probeHarness(T.work);
    const Q = 'is it worse in the morning or in the evening';
    const mid = mk(); mid.gate(false, 0); mid.openMic(); mid.speak(Q); mid.deliverFinal('in the morning');
    eq(mid.report.filed.length, 0,
      'THE AGGRESSIVE REGIME IS GONE: while the avatar is still saying "' + Q + '", the contiguous ' +
      'quote "in the morning" is no longer treated as its own voice — this is how the avatar came ' +
      'to interview itself and build the summary out of its own questions');
    const aft = mk(); aft.gate(false, 0); aft.openMic(); aft.speak(Q); aft.endSpeech();
    aft.deliverFinal('in the morning');
    eq(aft.report.filed.join('|'), 'in the morning',
      'THE AFTER REGIME IS GONE: once the question has ended, "in the morning" is the ANSWER to it ' +
      'and it is being deleted. That is the harm measured at 9 of 12 and 22 of 22 in earlier rounds.');
  }

  /* and the filter must not have become a universal accept, or the controls
     above prove nothing */
  const make = probeHarness(T.work);
  const h = make();
  h.gate(false, 0);
  h.openMic();
  h.speak('is the pain in your back or in your neck');
  h.deliverFinal('is the pain in your back');
  eq(h.report.filed.length, 0,
    'A UNIVERSAL ACCEPT PROVES NOTHING: a contiguous quote of the question the avatar is still ' +
    'saying was FILED as the patient\'s answer, so every control above would pass with the echo ' +
    'filter deleted outright');
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3 — THE DERIVED WALK, AND THE SENTENCE SURVIVING ITS OWN ECHO
   ---------------------------------------------------------------------------
   Population: DERIVED. Nobody wrote a list of microphone handlers or of stops.
   The seeds are the function expressions installed on the event properties of a
   value that traces back to SpeechRecognition, plus the analyser closures over
   the mic stream. The sinks are the functions whose own text cancels synthesis,
   pauses the tts audio element, or bumps the utterance sequence. Three earlier
   defects in this lane were hand-written populations that omitted what their
   author did not think of; there is no list here to omit from.
   ⚠️ Without the `safe(fn)` immediate-body rule below, the walk marked 516 of
   605 functions mic-reachable — the whole file — which is why that rule is
   structural rather than a name exception.
   ═══════════════════════════════════════════════════════════════════════════ */
function buildGraphOver(tl, pass2Roots) {
  const src = tl.src, masked = tl.masked;
  const nodes = [];
  const re = /\bfunction\b/g;
  let m;
  while ((m = re.exec(masked))) {
    let p = m.index + 8;
    while (p < masked.length && /\s/.test(masked[p])) p++;
    let name = '';
    const nm = /^[A-Za-z_$][\w$]*/.exec(masked.slice(p, p + 80));
    if (nm) { name = nm[0]; p += name.length; }
    while (p < masked.length && /\s/.test(masked[p])) p++;
    if (masked[p] !== '(') continue;
    const pc = matchPair(masked, p, '(', ')'); if (pc < 0) continue;
    const params = src.slice(p + 1, pc).split(',').map(s => s.trim()).filter(Boolean);
    let q = pc + 1;
    while (q < masked.length && /\s/.test(masked[q])) q++;
    if (masked[q] !== '{') continue;
    const bc = matchPair(masked, q, '{', '}'); if (bc < 0) continue;
    const before = masked.slice(Math.max(0, m.index - 90), m.index);
    const lbl = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*=\s*$/.exec(before);
    const dv = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before);
    nodes.push({
      id: nodes.length, name, params, label: lbl ? lbl[1].replace(/\s+/g, '') : '',
      declName: dv ? dv[1] : name, start: m.index, bodyStart: q, end: bc + 1,
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  nodes.forEach(a => {
    let best = null;
    nodes.forEach(b => { if (b !== a && b.start < a.start && a.end <= b.end && (!best || b.start > best.start)) best = b; });
    a.parent = best ? best.id : null;
    a.children = [];
  });
  nodes.forEach(a => { if (a.parent !== null) nodes[a.parent].children.push(a.id); });
  /* A function EXPRESSION installed on an event property, or handed to
     addEventListener, is not executed by the enclosing function — the event
     source executes it. Everything else nested (safe(), setTimeout(), .then())
     is reachable from the body that wrote it. */
  nodes.forEach(a => {
    a.isHandler = /\.on[a-z]+$/.test(a.label);
    if (!a.isHandler) {
      const pre = masked.slice(Math.max(0, a.start - 200), a.start);
      a.isHandler = /addEventListener\s*\(\s*$/.test(pre) || /addEventListener\s*\([^()]*,\s*$/.test(pre);
    }
    if (pass2Roots[a.start]) a.isHandler = true;
  });
  nodes.forEach(a => {
    const holes = [];
    (function collect(id) {
      nodes[id].children.forEach(c => { if (nodes[c].isHandler) holes.push([nodes[c].start, nodes[c].end]); else collect(c); });
    })(a.id);
    const t = masked.slice(a.bodyStart, a.end).split('');
    holes.forEach(h => { for (let k = h[0]; k < h[1]; k++) { const o = k - a.bodyStart; if (o >= 0 && o < t.length && t[o] !== '\n') t[o] = ' '; } });
    a.own = t.join(''); a.ownOffset = a.bodyStart;
    const it = masked.slice(a.bodyStart, a.end).split('');
    a.children.forEach(c => { for (let k = nodes[c].start; k < nodes[c].end; k++) { const o = k - a.bodyStart; if (o >= 0 && o < it.length && it[o] !== '\n') it[o] = ' '; } });
    a.immediate = it.join('');
  });
  const declCache = {};
  function declsOf(id) {
    const key = String(id);
    if (!declCache[key]) {
      const out = {};
      const kids = id === null ? nodes.filter(x => x.parent === null) : nodes[id].children.map(c => nodes[c]);
      kids.forEach(k => { if (k.declName) out[k.declName] = k.id; });
      declCache[key] = out;
    }
    return declCache[key];
  }
  function resolve(from, ident) {
    let cur = from;
    for (;;) {
      const d = declsOf(cur);
      if (Object.prototype.hasOwnProperty.call(d, ident)) return d[ident];
      if (cur === null) return null;
      cur = nodes[cur].parent;
    }
  }
  nodes.forEach(a => { a.out = {}; a.noEdge = {}; });
  const domRootStarts = {};
  const paramBind = {};
  const bind = (fnId, p, t) => {
    const k = fnId + ':' + p;
    if (!paramBind[k]) paramBind[k] = [];
    if (!paramBind[k].includes(t)) paramBind[k].push(t);
  };
  /* a NAMED function handed to addEventListener is a DOM root, not a callee */
  nodes.forEach(a => {
    const lr = /addEventListener\s*\(/g;
    let lm;
    while ((lm = lr.exec(a.own))) {
      const o = lm.index + lm[0].length - 1;
      const c = matchPair(a.own, o, '(', ')'); if (c < 0) continue;
      const parts = a.own.slice(o + 1, c).split(',');
      if (parts.length < 2) continue;
      const second = parts[1].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(second)) continue;
      const t = resolve(a.id, second);
      if (t !== null) a.noEdge[t] = true;
    }
  });
  nodes.forEach(a => {
    const ir = /[A-Za-z_$][\w$]*/g;
    let im;
    while ((im = ir.exec(a.own))) {
      if (a.own[im.index - 1] === '.') continue;
      const t = resolve(a.id, im[0]);
      if (t !== null && t !== a.id && !a.noEdge[t]) a.out[t] = true;
    }
    a.children.forEach(c => { if (!nodes[c].isHandler) a.out[c] = true; });
  });
  /* `safe(fn)` invokes fn in its OWN immediate body: the argument runs under the
     caller and the caller->argument edge already models it. Merging a global
     binding for such a parameter would make every function ever passed to safe
     reachable from every other — the whole file. `pvListen(onFinal, …)` invokes
     its callback only from a closure the MICROPHONE drives, and that binding is
     the edge this suite exists to follow. The discriminator is structural. */
  function syncTrampoline(fn, p) {
    const esc = p.replace(/\$/g, '\\$');
    const rx = new RegExp('(^|[^.\\w$])' + esc + '\\s*(\\(|\\.\\s*(call|apply)\\s*\\()');
    if (!rx.test(fn.immediate)) return false;
    return !fn.children.some(c => rx.test(nodes[c].own));
  }
  function handlerOnly(fn, p) {
    const esc = p.replace(/\$/g, '\\$');
    const rx = new RegExp('(^|[^.\\w$])' + esc + '($|[^\\w$])');
    if (rx.test(fn.immediate)) return false;
    let inH = false, inPlain = false;
    (function scan(id, under) {
      nodes[id].children.forEach(c => {
        const h = under || nodes[c].isHandler;
        if (rx.test(nodes[c].immediate)) { if (h) inH = true; else inPlain = true; }
        scan(c, h);
      });
    })(fn.id, false);
    return inH && !inPlain;
  }
  function argSpans(text, offset, open) {
    const close = matchPair(text, open, '(', ')'); if (close < 0) return null;
    let d = 0, last = open + 1;
    const parts = [];
    for (let i = open + 1; i < close; i++) {
      const ch = text[i];
      if ('([{'.includes(ch)) d++;
      else if (')]}'.includes(ch)) d--;
      else if (ch === ',' && d === 0) { parts.push([last, i]); last = i + 1; }
    }
    parts.push([last, close]);
    return parts.map(p => [p[0] + offset, p[1] + offset]);
  }
  nodes.forEach(a => {
    const cr = /([A-Za-z_$][\w$]*)\s*\(/g;
    let cm;
    while ((cm = cr.exec(a.own))) {
      if (a.own[cm.index - 1] === '.') continue;
      const callee = resolve(a.id, cm[1]);
      if (callee === null) continue;
      const spans = argSpans(a.own, a.ownOffset, cm.index + cm[0].length - 1);
      if (!spans) continue;
      const cps = nodes[callee].params;
      spans.forEach((sp, idx) => {
        if (idx >= cps.length) return;
        if (syncTrampoline(nodes[callee], cps[idx])) return;
        const inline = nodes.filter(x => x.start >= sp[0] && x.end <= sp[1] + 1).sort((x, y) => x.start - y.start);
        if (inline.length) {
          bind(callee, cps[idx], inline[0].id);
          if (handlerOnly(nodes[callee], cps[idx])) { delete a.out[inline[0].id]; domRootStarts[inline[0].start] = true; }
          return;
        }
        const raw = src.slice(sp[0], sp[1]).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(raw)) {
          const t = resolve(a.id, raw);
          if (t !== null) bind(callee, cps[idx], t);
        }
      });
    }
  });
  nodes.forEach(a => {
    a.params.forEach(p => {
      const k = a.id + ':' + p;
      if (!paramBind[k]) return;
      const rx = new RegExp('(^|[^.\\w$])' + p.replace(/\$/g, '\\$') + '($|[^\\w$])');
      (function walk(id) {
        if (rx.test(nodes[id].own)) paramBind[k].forEach(x => { nodes[id].out[x] = true; });
        nodes[id].children.forEach(walk);
      })(a.id);
    });
  });
  return { nodes, resolve, domRootStarts };
}
/* TWO PASSES: pass 1 discovers the DOM roots, pass 2 excludes them from their
   parent's text so a repaint does not appear to press the buttons it drew. */
function walkOf(tl) {
  const g = buildGraphOver(tl, buildGraphOver(tl, {}).domRootStarts);
  const N = g.nodes;
  const masked = tl.masked, src = tl.src;
  const nameOf = n => (n.name || n.label || ('anon@L' + n.line)) + ' @L' + n.line;
  /* seeds: DERIVED */
  const recHolders = {};
  {
    let changed = true, rounds = 0;
    while (changed && rounds++ < 8) {
      changed = false;
      const ar = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*=\s*([^;\n]{0,160})/g;
      let am;
      while ((am = ar.exec(masked))) {
        const lhs = am[1].replace(/\s+/g, '');
        const rhs = am[2];
        const rhsSrc = src.slice(am.index + am[1].length, am.index + am[0].length);
        let isRec = /SpeechRecognition/.test(rhsSrc);
        if (!isRec) {
          const nw = /\bnew\s+([A-Za-z_$][\w$]*)\s*\(/.exec(rhs);
          if (nw && recHolders[nw[1]]) isRec = true;
          const pl = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(rhs);
          if (pl && recHolders[pl[1]]) isRec = true;
        }
        if (isRec && !recHolders[lhs]) { recHolders[lhs] = true; changed = true; }
      }
    }
  }
  const seeds = {}, seedWhy = {};
  N.forEach(n => {
    if (!n.isHandler) return;
    const base = n.label.replace(/\.on[a-z]+$/, '');
    if (recHolders[base]) { seeds[n.id] = true; seedWhy[n.id] = 'installed on ' + n.label; }
  });
  N.forEach(n => {
    if (!/createMediaStreamSource/.test(n.immediate)) return;
    n.children.forEach(c => { if (!seeds[c]) { seeds[c] = true; seedWhy[c] = 'analyser closure over the microphone stream'; } });
  });
  const seedIds = Object.keys(seeds).map(Number);
  /* sinks: DERIVED from what the code does */
  const sinks = {}, sinkWhy = {};
  N.forEach(n => {
    const r = [];
    if (/speechSynthesis\s*\.\s*cancel\s*\(/.test(n.own)) r.push('speechSynthesis.cancel()');
    if (/ttsAudio\w*\s*\.\s*pause\s*\(/.test(n.own)) r.push('tts audio pause()');
    if (/\bpvSpeakSeq\s*\+\+/.test(n.own)) r.push('pvSpeakSeq++ invalidates the utterance in flight');
    if (r.length) { sinks[n.id] = true; sinkWhy[n.id] = r.join(' + '); }
  });
  const seen = {};
  {
    const q = seedIds.slice();
    q.forEach(i => { seen[i] = true; });
    while (q.length) {
      const cur = q.shift();
      Object.keys(N[cur].out).forEach(nx => { if (!seen[nx]) { seen[nx] = true; q.push(+nx); } });
    }
  }
  const reach = Object.keys(seen).map(Number);
  function offendersInto(stopName, allowed) {
    const t = N.filter(x => x.name === stopName)[0];
    if (!t) return null;
    const out = [];
    reach.forEach(i => {
      if (!N[i].out[t.id]) return;
      const caller = N[i];
      if (allowed[caller.name]) return;
      const rx = new RegExp('(^|[^.\\w$])' + stopName + '\\s*\\(', 'g');
      const at = [];
      let cm;
      while ((cm = rx.exec(caller.immediate))) at.push(src.slice(0, caller.ownOffset + cm.index).split('\n').length);
      out.push({ name: caller.name || nameOf(caller),
        text: nameOf(caller) + ' -> ' + stopName + (at.length ? ' at line(s) ' + at.join(', ') : ' (via a nested closure)') });
    });
    return out;
  }
  return { N, nodes: N, nameOf, recHolders, seedIds, seeds, sinks, reach, offendersInto,
    stopNode: nm => N.filter(x => x.name === nm)[0] };
}

/* THE PINNED SAFE SET, WITH THE REASON EACH ONE IS ALLOWED TO STAY. A caller not
   on this list is a failure, so the set cannot be widened quietly.
   ⚠️ THE FLAT ASSERTION "nothing mic-reachable may reach pvStopSpeechOnly" IS
   PROVABLY IMPOSSIBLE: avatar-finishes-its-sentences:55 and
   avatar-listens-while-speaking:135,139 require that exact call to stay in
   kioskListen's interim handler with ONE call site. Round 8 asserted the flat
   version and it was false. So the barge-in edge is pinned by COUNT instead. */
const ALLOWED = {
  kioskClose: 'teardown: the overlay is removed, so the voice must stop with it',
  kioskStopBounded: 'bounded give-up, gated by the uncapped speech wait (S4)',
  kioskWatchdog: 'all three stops sit after the uncapped speech wait (S4)',
  kioskAmbientStop: 'ambient mode is silent by construction (asserted below)',
};
const ALLOWED_SPEECH_ONLY_CALLERS = 1;

{
  const w = walkOf(T.work);
  ok(w.recHolders.rec && w.recHolders.pvRec,
    'the walk can no longer find the SpeechRecognition instances — every assertion below would ' +
    'pass vacuously. Derived holders: ' + Object.keys(w.recHolders).join(', '));
  ok(w.seedIds.length >= 6,
    'the derived microphone seed set collapsed to ' + w.seedIds.length + ' functions. Every ' +
    'reachability assertion below is only as strong as this set, so a collapse must fail loudly.');
  ok(w.nodes.length > 500,
    'the walk found only ' + w.nodes.length + ' function nodes in a ~500KB module — the brace ' +
    'matcher has stopped tracking the file');
  ok(w.reach.length > 100 && w.reach.length < w.nodes.length * 0.6,
    'the microphone-reachable closure is ' + w.reach.length + ' of ' + w.nodes.length + ' functions. ' +
    'Too few means the walk stopped following the call graph and "no mic path reaches a stop" ' +
    'would be true by blindness; more than 60% of the file means the safe(fn) immediate-body rule ' +
    'has broken and everything looks reachable (it once marked 516 of 605).');
  /* every recogniser event property must be represented in the seeds, so a
     handler added later (onnomatch, onspeechend) cannot slip past */
  {
    const props = new Set();
    const hr = /\b(?:rec|pvRec|ambRec)\s*\.\s*(on[a-z]+)\s*=/g;
    let hm;
    while ((hm = hr.exec(T.work.masked))) props.add(hm[1]);
    const covered = new Set(w.seedIds.map(i => (w.N[i].label.match(/\.(on[a-z]+)$/) || [])[1]).filter(Boolean));
    props.forEach(p => {
      ok(covered.has(p),
        'the recogniser event `' + p + '` is assigned in this module but the derived seed set does ' +
        'not contain it, so nothing below inspects what it can reach. This is exactly the ' +
        'hand-written-population failure this suite is built to avoid.');
    });
  }
  ['pvStopVoice', 'pvStopSpeechOnly'].forEach(nm => {
    ok(w.sinks[w.stopNode(nm).id],
      nm + ' is no longer detected as a speech-stopping function. Either it was renamed (and this ' +
      'suite now guards nothing) or it stopped cancelling speech.');
  });
  const off = w.offendersInto('pvStopVoice', ALLOWED);
  eq(off.length, 0,
    'A MICROPHONE-DERIVED HANDLER CAN END THE AVATAR\'S SENTENCE.\nThe derived walk found ' +
    off.length + ' mic-reachable path(s) into the full voice teardown that are not on the pinned ' +
    'safe list:\n    ' + off.map(o => o.text).join('\n    ') + '\nEach one means the avatar\'s own ' +
    'voice, or a routine Chrome recogniser error, can cut off the sentence it is in the middle of ' +
    'saying. Sever the edge (route the caller at pvStopMic instead); do not add a condition, ' +
    'because a later round can invert a condition.');
  const so = w.offendersInto('pvStopSpeechOnly', {});
  eq(so.length, ALLOWED_SPEECH_ONLY_CALLERS,
    'the patient\'s voice interrupt now has ' + so.length + ' mic-reachable call sites (' +
    so.map(o => o.text).join(', ') + '). With more than one, nothing can reason about what is able ' +
    'to cut a question off; with none, the interrupt three existing pins require has been deleted.');
  /* a FIFTH name on the safe list is a failure: the set is a pin, not a bucket */
  eq(Object.keys(ALLOWED).length, 4,
    'the pinned safe set has ' + Object.keys(ALLOWED).length + ' entries, not four. Adding a name ' +
    'here is how "nothing mic-reachable stops speech" quietly becomes "a few things do".');
  /* the ambient claim in ALLOWED, asserted rather than asserted-about */
  ok(/kiosk\.ambient\) \{ if \(then\) safe\(then\); return; \}/.test(T.work.liftFn('pvSpeakVoiced')),
    'ambient room mode is no longer silent at the one place a voice can start, so ' +
    'kioskAmbientStop\'s presence on the pinned safe list is no longer justified');
  /* the interrupt the patient is left with must be a VISIBLE CONTROL: an
     untrusted event cannot press a button, so our own audio cannot forge it */
  ok(/#mlsAvKioskMute'\)\.addEventListener\('click', kioskPauseToggle\)/.test(T.work.liftFn('openKiosk')) &&
     /pvStopVoice\(\)/.test(T.work.liftFn('kioskPauseToggle')),
    'the visible pause control is no longer wired to a real click listener that stops the voice — ' +
    'with the microphone unable to end speech, this button is the interrupt the patient has left');

  /* ── THE CONTROL: THE SAME WALK OVER THE LIVE BYTES MUST NAME THE THREE ──── */
  const lw = walkOf(T.live);
  const lo = lw.offendersInto('pvStopVoice', ALLOWED);
  ['pvListen', 'kioskTurn', 'kioskFinish'].forEach(nm => {
    ok(lo.some(o => o.name === nm),
      'CONTROL FAILED: the derived walk over the LIVE bytes does not name ' + nm + ' as a ' +
      'mic-reachable caller of the full voice teardown. Live is the pre-fix state — if the walk ' +
      'cannot see the defect there, its silence on this build means nothing. It named: ' +
      lo.map(o => o.name).join(', '));
  });
  console.log('  [control] live bytes: ' + lo.length + ' mic-reachable stops -> ' +
    lo.map(o => o.text).join(' | '));
}

/* ── EXECUTED: the sentence survives its own echo ─────────────────────────── */
function makeSpeechHarness(tl) {
  const region = tl.liftRegion('function pvVoiceUsable(v)', 'function pvSpeakVoiced(');
  const listen = tl.liftFn('pvListen');
  assert.ok(/function pvStopVoice\(\)/.test(region) && /function pvStopSpeechOnly\(\)/.test(region),
    'the speech-stop functions are no longer inside the region this harness lifts, so it would ' +
    'drive a recogniser with no way to observe a stop at all — a silent pass');
  const hasSplit = /var pvEchoSaying/.test(tl.masked);
  const setter = 'function pvSayingSet(t) { pvSaying = pvNorm(t);' + (hasSplit ? ' pvEchoSaying = pvSaying;' : '') + ' }';
  const body = `
    var report = { cancels: 0, pauses: 0, faceStops: 0 };
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function isFn(f) { return typeof f === 'function'; }
    var pvVoice, pvWantMale = null, pvHeld = [], pvRec = null, pvWatchdog = null, pvSpeakSeq = 0;
    var ttsAudioNow = { onended: null, onerror: null, pause: function () { report.pauses++; } };
    function faceTalkStop() { report.faceStops++; }
    var window = {
      speechSynthesis: { cancel: function () { report.cancels++; }, getVoices: function () { return []; },
                         speak: function () {}, addEventListener: function () {} },
      SpeechRecognition: FakeRec, webkitSpeechRecognition: FakeRec,
      AudioContext: null, webkitAudioContext: null,
    };
    var _timers = [];
    function setTimeout(fn) { _timers.push({ fn: fn, dead: false }); return _timers.length; }
    function clearTimeout(h) { if (_timers[h - 1]) _timers[h - 1].dead = true; }
    ${region}
    ${listen}
    ${setter}
    return {
      report: report,
      say: function (t) { pvSayingSet(t); },
      /* PROVED BY THE CLASSIFIER, NOT BY READING A VARIABLE: a template is in
         flight iff the shipped pvIsSelfEcho still recognises a two-word quote of
         it in the LIVE regime (minRun 2), which the bounded tail (minRun 4)
         cannot do. Build-agnostic, and it observes the thing that matters. */
      templateLive: function () { return pvIsSelfEcho('is the'); },
      seq: function () { return pvSpeakSeq; },
      listen: function (onFinal, onInterim, onDead) { return pvListen(onFinal, onInterim, onDead); },
      rec: function () { return pvRec; },
      fire: function () { _timers.forEach(function (t) { if (!t.dead) { t.dead = true; t.fn(); } }); },
      /* ZERO THE INSTRUMENTS AFTER THE MICROPHONE IS ALREADY OPEN, so every stop
         counted afterwards is provably caused by a microphone event and not by
         the harness setting the scene. */
      reset: function () { report.cancels = 0; report.pauses = 0; report.faceStops = 0; pvSpeakSeq = 0; },
      stopMicPresent: typeof pvStopMic === 'function',
    };
  `;
  function FakeRec() { this.onresult = null; this.onerror = null; this.onend = null; }
  FakeRec.prototype.start = function () { this.started = true; };
  FakeRec.prototype.stop = function () { this.stopped = true; };
  return () => new Function('FakeRec', body)(FakeRec);
}

/* population: the three microphone handlers the S3 walk derived as seeds on the
   interview recogniser, driven with the avatar's OWN words plus the two
   lifecycle events Chrome fires constantly on a network-backed recogniser */
function driveOwnEcho(tl) {
  const h = makeSpeechHarness(tl)();
  const SENTENCE = 'is the pain in your back, or in your neck';
  const filed = [];
  h.say(SENTENCE);
  const reopen = () => h.listen(v => filed.push(v), () => {}, reopen);
  const opened = reopen();
  h.reset();
  ['is the pain', 'is the pain in your', 'is the pain in your back or in your neck']
    .forEach((p, i, all) => {
      h.rec().onresult({ resultIndex: 0, results: [{ 0: { transcript: p }, isFinal: i === all.length - 1 }] });
    });
  h.rec().onerror({ error: 'no-speech' });
  h.rec().onend();
  h.fire();
  return { opened, h, filed, r: h.report };
}
{
  const d = driveOwnEcho(T.work);
  ok(d.opened, 'the harness could not open a recogniser — this section would pass vacuously');
  ok(d.h.stopMicPresent,
    'pvStopMic does not exist in this module, so every microphone re-open still runs the full ' +
    'voice teardown: the avatar cannot finish a sentence while the microphone is open. This is ' +
    'the pre-fix state.');
  eq(d.r.cancels, 0,
    'THE MICROPHONE CANCELLED SPEECH SYNTHESIS ' + d.r.cancels + ' time(s) while the avatar was ' +
    'mid-sentence, driven by nothing but the avatar\'s own words and Chrome\'s ordinary recogniser ' +
    'lifecycle. This is the owner\'s report: "it litterly never gets out everyhting it wants to ' +
    'say caosue it picks up its own talking."');
  eq(d.r.pauses, 0,
    'THE MICROPHONE PAUSED THE AVATAR\'S AUDIO ELEMENT ' + d.r.pauses + ' time(s) while it was ' +
    'still speaking — the sentence is cut off mid-word by its own echo');
  eq(d.r.faceStops, 0,
    'the microphone stopped the talking face ' + d.r.faceStops + ' time(s) mid-sentence, so the ' +
    'avatar visibly freezes while its own voice is still playing');
  eq(d.filed.length, 0,
    'the avatar\'s own sentence was filed as the patient\'s answer (' + JSON.stringify(d.filed) + ')');
  /* AND THE ECHO TEMPLATE MUST HAVE EXPIRED ANYWAY. This is the round-9 trap: a
     surviving sentence is worthless if it drags a permanent echo template along,
     because the next question overwrites it before anything holds it and the old
     question's late tail is then filed as the patient's answer. */
  eq(d.h.templateLive(), false,
    'THE ECHO TEMPLATE SURVIVED THE MICROPHONE TEARDOWN. The sentence is alive, which is right, ' +
    'but the FILING template is still live too — so it never entered the bounded echo tail, the ' +
    'next pvSpeakVoiced will overwrite it with nothing holding it, and this question\'s late tail ' +
    'becomes fileable as the patient\'s answer. That is round 9 exactly: 9 of 15 ordinary turns.');

  /* ── THE CONTROL: THE SAME EXECUTION OVER THE LIVE BYTES MUST CUT ────────── */
  const l = driveOwnEcho(T.live);
  ok(!l.h.stopMicPresent,
    'CONTROL FAILED: the LIVE bytes already contain pvStopMic, so the pinned live commit is not ' +
    'the pre-fix state and nothing above is a demonstrated change');
  ok(l.r.cancels + l.r.pauses + l.r.faceStops > 0,
    'CONTROL FAILED: driving the LIVE bytes with the avatar\'s own words and a routine `no-speech` ' +
    'error produced no cut at all (cancels=' + l.r.cancels + ' pauses=' + l.r.pauses +
    ' faceStops=' + l.r.faceStops + '). The harness cannot observe the defect, so its silence on ' +
    'this build proves nothing.');
  console.log('  [control] live bytes mid-sentence: cancels=' + l.r.cancels + ' pauses=' + l.r.pauses +
    ' faceStops=' + l.r.faceStops);
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 — EXECUTED: THE SILENCE FENCE HAS NO CAP
   ---------------------------------------------------------------------------
   Population: fifty consecutive watchdog ticks against a sentence that never
   ends. Fifty is not a threshold to tune — the assertion is that the wait is
   UNCAPPED, so any N would do and a cap at any value fails.
   ═══════════════════════════════════════════════════════════════════════════ */
function watchdogRun(tl, ticks) {
  const arm = tl.liftFn('kioskArmWatchdog');
  const dog = tl.liftFn('kioskWatchdog');
  const hasSplit = /var pvEchoSaying/.test(tl.masked);
  const h = new Function(`
    var report = { stops: 0, turns: 0, bounded: 0, spoke: 0, rearms: 0, listens: 0 };
    var pvSaying = 'is the pain in your back or in your neck';
    ${hasSplit ? "var pvEchoSaying = pvSaying;" : ''}
    var NUDGE_LINE = 'take your time';
    var kiosk = { open: true, busy: false, completed: false, ambient: false, mic: true,
                  heard: false, silent: 0, finishTries: 0, nudgedFor: null, lastSay: 'a question',
                  nudgeTimer: null };
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function clearTimeout() {}
    function setTimeout(fn) { report.rearms++; return 1; }
    function pvStopVoice() { report.stops++; }
    function pvStopMic() {}
    function kioskTurn() { report.turns++; }
    function kioskStopBounded() { report.bounded++; }
    function kioskMood() {}
    function kioskListen() { report.listens++; }
    function pvSpeakShaped() { report.spoke++; }
    ${arm}
    ${dog}
    return { report: report, tick: kioskWatchdog,
             endSentence: function () { pvSaying = ''; ${hasSplit ? "pvEchoSaying = '';" : ''} } };
  `)();
  for (let i = 0; i < ticks; i++) h.tick();
  return h;
}
{
  const TICKS = 50;
  const h = watchdogRun(T.work, TICKS);
  /* A SNAPSHOT, not the live object: the three ticks after endSentence() below
     mutate it, and a printed line taken afterwards would report numbers no
     assertion ever made — which is how a receipt comes to disagree with its gate. */
  const r = JSON.parse(JSON.stringify(h.report));
  eq(r.stops, 0,
    'THE SILENCE WATCHDOG CUT THE SENTENCE ' + r.stops + ' time(s) in ' + TICKS + ' ticks while ' +
    'the avatar was still speaking. The wait is CAPPED: after three windows it falls through to ' +
    'pvStopVoice and the avatar is cut off mid-word by its own silence clock.');
  eq(r.turns, 0,
    'the watchdog started ' + r.turns + ' turn(s) while the avatar was still speaking — the ' +
    'auto-finish fires over the question it has not finished asking');
  eq(r.bounded, 0,
    'the watchdog fell through to the bounded stop ' + r.bounded + ' time(s) while the avatar was ' +
    'still speaking — the interview gives up mid-sentence');
  eq(r.spoke, 0,
    'the watchdog spoke the silence nudge ' + r.spoke + ' time(s) OVER the question still playing. ' +
    'Two voices at once is the same defect as a cut: pvSpeakShaped bumps pvSpeakSeq and the ' +
    'question dies. Routing the watchdog\'s stops to pvStopMic would NOT have fixed this — the ' +
    'nudge itself kills the sentence, which is why the fix here is a condition.');
  eq(r.rearms, TICKS,
    'the watchdog re-armed ' + r.rearms + ' times in ' + TICKS + ' ticks — a tick that neither ' +
    'acts nor re-arms has silently disarmed the only timer that can revive the question');
  /* AND IT MUST STILL BE ABLE TO ACT once the sentence actually ends, or this is
     a feature deletion dressed as a fix — the mistake round 7 made when it
     refused all four negation controls as "overlap". */
  h.endSentence();
  h.tick(); h.tick(); h.tick();
  ok(h.report.spoke + h.report.turns + h.report.stops > 0,
    'with the sentence finished, three silent windows produced no nudge, no turn and no stop: the ' +
    'self-end watchdog has been disabled outright, so an abandoned interview never ends and never ' +
    'produces a summary');
  console.log('  watchdog ' + TICKS + ' ticks: cuts=' + r.stops + ' bounded=' + r.bounded +
    ' nudges=' + r.spoke + ' turns=' + r.turns + ' rearms=' + r.rearms);

  /* ── THE CONTROL: THE LIVE BYTES MUST CUT, AND MUST STOP RE-ARMING ──────── */
  const l = watchdogRun(T.live, TICKS).report;
  ok(l.stops + l.bounded + l.spoke > 0,
    'CONTROL FAILED: the LIVE watchdog took no action at all in ' + TICKS + ' ticks against a ' +
    'sentence in flight, so it was never capped and the condition added here changed nothing');
  ok(l.rearms < TICKS,
    'CONTROL FAILED: the LIVE watchdog re-armed all ' + TICKS + ' times, so the "0 re-arms" ' +
    'measurement this change was made against cannot be reproduced');
  console.log('  [control] live watchdog ' + TICKS + ' ticks: cuts=' + l.stops + ' bounded=' + l.bounded +
    ' nudges=' + l.spoke + ' turns=' + l.turns + ' rearms=' + l.rearms);
}

console.log('one-token-cannot-answer-two-questions: ' + pass + ' assertions passed (' +
  path.basename(SRC_PATH) + ')');
