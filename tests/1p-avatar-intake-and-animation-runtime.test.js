'use strict';

/*
 * /1p ONLY. THE AVATAR'S INTAKE MEMORY, ITS MOUTH, AND THE ONE ENCOUNTER RECORD
 * ============================================================================
 * Owner, 2026-08-17, §14/§15/§16: the avatar must stop looking and behaving like a
 * toy, must actually run an intake (understand corrections, avoid repetition, hand
 * off to the physician), and intake plus visit must be ONE encounter record with no
 * disconnected duplicate versions.
 *
 * Three measured defects this file pins, all found by reading the shipped code:
 *
 *  1. THE CHECK-IN ONLY REACHED THE CHART IF SOMEBODY RECORDED THE VISIT.
 *     kioskAmbientBlock() was the SOLE writer of kiosk.intake into the transcript and
 *     it only runs from kioskAmbientFile / ambientRecoverFile. If the doctor never
 *     tapped "Doctor - start listening", the patient's own words died with the overlay
 *     in kioskClose()/scrubAvatarSession() and the encounter kept only the backend's
 *     LLM summary. kioskIntakeFile() now files it at kioskFinish through the SAME
 *     proven writer, and must be incapable of producing a second copy.
 *
 *  2. THERE WAS NO REPETITION GUARD AT ALL. j.progress.covered was written into a
 *     text label and used for nothing. A re-asked question was re-asked verbatim.
 *
 *  3. CORRECTIONS WERE ORDER-ONLY. applyCorrection/ACT_CUE_RE exist and work, but
 *     their only caller returns early with `if (!kiosk.ambient) return;`, so an
 *     intake answer of "sorry, I meant the left knee" was appended verbatim beside
 *     the answer it contradicted and nothing said which one won.
 *
 * EVERY assertion below EXECUTES the shipped code - the topic vocabulary is run
 * against real sentences, the correction detector against real corrections, the
 * viseme mapper against a real line, and the filing path against a fake transcript
 * whose contents are then read back. Source-shape assertions are used ONLY for the
 * three ordering facts that cannot be observed from outside kioskTurn, and each says
 * so and says why the order matters.
 *
 * No PHI, no network, no microphone, no camera. Synthetic strings only.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_avatar.js'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function deep(actual, expected, message) { assert.deepStrictEqual(actual, expected, message); checks++; }

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = SOURCE.indexOf(marker);
  assert(start >= 0, 'missing function ' + name);
  const brace = SOURCE.indexOf('{', start);
  let depth = 0, quote = '', line = false, block = false, escape = false;
  for (let i = brace; i < SOURCE.length; i++) {
    const c = SOURCE[i], n = SOURCE[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return SOURCE.slice(start, i + 1);
  }
  throw new Error('unterminated function ' + name);
}
function between(first, last) {
  const a = SOURCE.indexOf(first), b = SOURCE.indexOf(last, a);
  assert(a >= 0 && b > a, 'missing source boundary: ' + first);
  return SOURCE.slice(a, b);
}
function build(body, env) {
  const names = Object.keys(env);
  return new Function(...names, body)(...names.map(n => env[n]));
}

/* ---- 0. THE SAFETY LINES THIS LANE MAY NOT CROSS ------------------------- */

ok(/examined >= 10 && claimed >= 6 && hasIdentityPalette/.test(SOURCE),
  'the avatar match gate is no longer `examined >= 10 && claimed >= 6 && hasIdentityPalette` - an art-direction or intake pass may not weaken the identity gate');
ok(/examined >= 10 && claimed >= 6/.test(fs.readFileSync(path.join(ROOT, '1p-feat_mls_avatar_face.js'), 'utf8')),
  'the Face Studio shell no longer mirrors the match gate, so the meter and the engine can disagree about what applies');

/* ---- 1. THE TOPIC VOCABULARY, EXECUTED ---------------------------------- */

const intakeBlock = between(
  '/* ===== avintake-1.0.0 (2026-08-17) — THE INTERVIEW GETS A MEMORY.',
  '/* ===== end avintake-1.0.0 ===== */\n  function kioskIntakeText'
);

function makeIntake(kiosk) {
  return build(
    intakeBlock +
    '\nreturn { INTAKE_TOPICS: INTAKE_TOPICS, topicsIn: intakeTopicsIn, coverAdd: intakeCoverAdd,' +
    ' covered: intakeCoveredList, missing: intakeMissingList, key: intakeQuestionKey,' +
    ' seen: intakeSeenQuestion, clip: intakeClip, correctionIn: intakeCorrectionIn,' +
    ' correctionAgainst: intakeCorrectionAgainst, REASK: INTAKE_REASK_LEAD };',
    { kiosk, clean: v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim() }
  );
}

{
  const api = makeIntake({});
  /* the regex literals must EXECUTE against real sentences, not merely be present:
     a backslash lost in transport still parses and still matches nothing (see the
     shell-transport-eats-backslashes memory - four /1p regexes shipped that way) */
  const cases = [
    ['it started about three weeks ago', 'onset'],
    ['the pain is in my left knee', 'location'],
    ['I would say an 8 out of 10 today', 'severity'],
    ['stairs make it worse and ice helps', 'modifiers'],
    ['I cannot walk to the shops any more', 'function'],
    ['I stopped taking the naproxen last month', 'meds'],
    ['I am allergic to penicillin', 'allergy'],
    ['I am hoping to get back to golf', 'goals'],
    ['there is some numbness down my foot', 'redflag']
  ];
  cases.forEach(([sentence, topic]) => {
    ok(api.topicsIn(sentence).indexOf(topic) >= 0,
      'the topic vocabulary did not detect "' + topic + '" in "' + sentence + '" - a lost escape matches nothing and fails silently');
  });
  eq(api.topicsIn('').length, 0, 'an empty answer covered a topic');
  eq(api.topicsIn('yes').length, 0, 'a bare "yes" covered a topic, so the guard would suppress questions nobody answered');
  /* 9 topics is the list the backend spec is written against; if it changes, the
     spec in the lane report and j.progress.covered have to change with it */
  eq(api.INTAKE_TOPICS.length, 9, 'the intake topic list changed size - the backend spec (coveredTopics/missingTopics) is written against exactly these nine');
}

/* ---- 2. THE LEDGER: COVERED GROWS, MISSING SHRINKS, AND IT IS PER PATIENT - */

{
  const kiosk = {};
  const api = makeIntake(kiosk);
  deep(api.covered(), [], 'a fresh interview already claims covered topics');
  eq(api.missing().length, 9, 'a fresh interview does not report all nine topics as missing');
  api.coverAdd('it started three weeks ago in my left knee');
  deep(api.covered(), ['onset', 'location'], 'the ledger did not record the two topics that answer actually covered');
  eq(api.missing().indexOf('onset'), -1, 'a covered topic is still reported as missing, so the server would be told to ask it again');
  api.coverAdd('about an 8 out of 10');
  deep(api.covered(), ['onset', 'location', 'severity'], 'the ledger did not accumulate across turns');
  /* the reset that openKiosk and kioskClose both perform */
  kiosk.covered = {};
  deep(api.covered(), [], 'clearing kiosk.covered did not clear the ledger - the next patient would inherit this one');
}

/* ---- 3. THE REPETITION GUARD -------------------------------------------- */

{
  const kiosk = {};
  const api = makeIntake(kiosk);
  eq(api.seen('What brings you in today?'), false, 'the first asking of a question was reported as a repeat');
  eq(api.seen('What brings you in today?'), true, 'the SAME question asked twice was not detected');
  eq(api.seen('what brings you in today'), true,
    'punctuation and case defeated the repeat guard - two renderings of one question differ that way far more often than by words');
  eq(api.seen('How bad is the pain?'), false, 'a genuinely new question was reported as a repeat');
  eq(api.seen(''), false, 'an empty line was recorded as an asked question');
  ok(api.REASK.length > 0 && /right/i.test(api.REASK),
    'the re-ask lead is empty, so a repeated question is repeated with nothing acknowledging it');
  /* ⛔ A REPEAT IS ANNOUNCED, NOT DROPPED. The questions are the doctor's, authored in
     Setup; a client that silently skips one changes the interview the doctor designed.
     This pins the CHOICE so a later pass cannot quietly turn it into a filter. */
  ok(SOURCE.indexOf('lead += INTAKE_REASK_LEAD;') >= 0 && SOURCE.indexOf('kiosk.lastSay = lead + kiosk.lastSay;') >= 0,
    'the repeat handling no longer PREFIXES the doctor-authored question - if it now drops or rewrites it, that is a change to the interview the doctor designed');
}

/* ---- 4. CORRECTIONS ----------------------------------------------------- */

{
  const kiosk = {};
  const api = makeIntake(kiosk);

  /* a correction WITHIN one answer */
  const inline = api.correctionIn('it is the right knee, sorry, I meant the left knee');
  ok(inline, 'a self-correction inside one answer was not detected at all');
  eq(inline.from, 'it is the right knee', 'the corrected value is wrong');
  eq(inline.to, 'the left knee', 'the correcting value is wrong');

  /* a correction of the PREVIOUS answer, which is the common shape */
  const rows = [
    { who: 'Avatar', text: 'Which knee is it?' },
    { who: 'Patient', text: 'the right knee' },
    { who: 'Avatar', text: 'How long has it been going on?' }
  ];
  const prior = api.correctionAgainst(rows, 'actually it is the left knee');
  ok(prior, 'a correction of the previous answer was not detected');
  eq(prior.from, 'the right knee', 'the correction was not bound to the previous PATIENT answer');
  eq(prior.to, 'it is the left knee', 'the correcting value is wrong');

  /* ⛔ AN APOLOGY IS NOT A CORRECTION. "sorry" with nothing after it would otherwise
     put "the patient corrected X to nothing" in a chart. */
  eq(api.correctionIn('sorry'), null, 'a bare apology was treated as a correction');
  eq(api.correctionIn('sorry.'), null, 'a bare apology with punctuation was treated as a correction');
  eq(api.correctionIn('my knee hurts'), null, 'an ordinary answer was treated as a correction');
  eq(api.correctionAgainst([], 'actually the left one'), null,
    'a correction with nothing to correct was accepted - there is no previous answer to supersede');
  eq(api.correctionAgainst([{ who: 'Avatar', text: 'Which knee?' }], 'actually the left one'), null,
    'a correction was bound to the AVATAR\'s line instead of a patient answer');

  /* the acknowledgement the patient hears, and the row the doctor reads */
  eq(api.clip('short'), 'short', 'the clip helper mangles a short value');
  eq(api.clip('x'.repeat(200)).length, 64, 'a correction quote is not bounded, so one rambling answer could flood the chart line');
  ok(SOURCE.indexOf('kiosk.ackLine = \'Got it - you said \'') >= 0,
    'the avatar no longer says the correction back to the patient');
  ok(SOURCE.indexOf('kioskIntakeAdd(\'[correction]\'') >= 0,
    'the correction is no longer written into the record as its own row, so a doctor reading the chart sees two contradictory answers and has to guess which won');
}

/* ---- 5. THE ORDERING FACTS INSIDE kioskTurn ------------------------------
   These three cannot be observed from outside kioskTurn without a whole kiosk, a
   consent, a patient and a backend. They are asserted on the source, and each one
   is a defect that WOULD be silent: the code still runs and still parses. */

{
  const turn = extractFunction('kioskTurn');
  const correctionAt = turn.indexOf('var turnCorrection = answer ? intakeCorrectionAgainst(kiosk.intake, answer)');
  const addAt = turn.indexOf('kioskIntakeAdd(\'Patient\', answer);');
  ok(correctionAt >= 0 && addAt >= 0 && correctionAt < addAt,
    'the correction is computed AFTER the answer is appended to kiosk.intake - the detector then finds the new answer as the "previous" one and reports the sentence correcting itself');

  const continuedAt = turn.indexOf('continued = kioskTakeSpeech();');
  const leadAt = turn.indexOf('if (intakeSeenQuestion(kiosk.lastSay))');
  ok(continuedAt >= 0 && leadAt >= 0 && continuedAt < leadAt,
    'the repeat guard now runs BEFORE the continuation branch - a queued clause replaces the server line entirely, so registering it there arms the guard for a question the patient never heard');

  /* lastIndexOf: the FIRST of these two sites is inside the emergency branch, which
     is deliberately upstream of the lead (an emergency warning is never prefixed).
     The one that matters here is the ordinary question path. */
  const recordAt = turn.lastIndexOf('kioskIntakeAdd(kiosk.avName || \'Avatar\', kiosk.lastSay);');
  ok(leadAt >= 0 && recordAt >= 0 && leadAt < recordAt,
    'the acknowledgement and re-ask lead are added AFTER the line is recorded, so the transcript no longer says what the patient actually heard');

  ok(turn.indexOf('body.coveredTopics = coveredNow;') >= 0 && turn.indexOf('body.missingTopics = intakeMissingList();') >= 0,
    'the turn no longer ships the covered/missing ledger, so the backend is being asked to guess what has already been answered');
  ok(turn.indexOf('if (kiosk.ambient) return;') >= 0,
    'kioskTurn no longer refuses to interview during a room capture');
}

/* ---- 6. ONE ENCOUNTER RECORD: THE CHECK-IN FILES ONCE, AND ONLY ONCE ----- */

function makeFiler(options) {
  const opts = options || {};
  const kiosk = Object.assign({
    ext: 'chart-1', consentAt: 0, corrections: 0, intake: [], intakeFiled: false,
    ambBound: 'chart-1', ambStart: Date.now(), ambParts: []
  }, opts.kiosk || {});
  const wrote = [];
  const env = {
    kiosk,
    clean: v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim(),
    safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
    AMBIENT_HEAD_CHECKIN: '--- check-in ---',
    AMBIENT_HEAD_VISIT: '--- visit ---',
    kioskIntakeText: () => kiosk.intake.map(r => r.who + ': ' + r.text).join('\n'),
    ordersBlock: () => '',
    activePtIdSafe: () => (opts.openChart === undefined ? 'chart-1' : opts.openChart),
    ambientCaptureVisitReceipt: () => (opts.receipt === undefined ? { v: 1, bindingId: 'b1' } : opts.receipt),
    ambientCommitTranscript(bound, block, receipt) {
      if (!receipt) return { ok: false, why: 'the open patient and visit binding could not be verified, so nothing was written.' };
      wrote.push({ bound, block });
      return { ok: true, chars: block.length, already: false };
    }
  };
  const api = build(
    extractFunction('kioskIntakeBlock') + '\n' +
    extractFunction('kioskIntakeFile') + '\n' +
    extractFunction('kioskAmbientBlock') + '\n' +
    'return { file: kioskIntakeFile, intakeBlock: kioskIntakeBlock, ambientBlock: kioskAmbientBlock };',
    env
  );
  return { api, kiosk, wrote };
}

{
  /* the happy path: an interview finishes, nobody records the visit, and the
     patient's own words are in the encounter anyway */
  const h = makeFiler({ kiosk: { consentAt: 1755400000000, corrections: 1, intake: [
    { who: 'Avatar', text: 'What brings you in today?' },
    { who: 'Patient', text: 'my right knee' },
    { who: '[correction]', text: 'the patient corrected "my right knee" to "the left knee"' }
  ] } });
  const res = h.api.file();
  eq(res.ok, true, 'the finished check-in was NOT filed into the encounter: ' + JSON.stringify(res));
  eq(h.wrote.length, 1, 'the check-in produced ' + h.wrote.length + ' writes instead of exactly one');
  eq(h.kiosk.intakeFiled, true, 'the filed flag was not set, so the room capture would file the check-in a second time');
  const block = h.wrote[0].block;
  ok(block.indexOf('--- check-in ---') === 0, 'the block does not open with the check-in heading the rest of the record uses');
  ok(block.indexOf('Patient: my right knee') >= 0, 'the patient\'s own words are not in the block');
  ok(block.indexOf('Recording consent confirmed') >= 0,
    'the consent attestation did not ride with the words it authorised - a record of speech with no record of consent is the one thing that must never be filed');
  ok(/corrected 1 answer during the check-in/.test(block),
    'the block does not tell the reader that a correction supersedes what it corrects');

  /* ⛔ AND NOW THE DUPLICATE TEST. This is §16 in one assertion: after the check-in
     is filed, a room capture must write the visit half WITHOUT replaying the intake. */
  const roomBlock = h.api.ambientBlock('the doctor and patient spoke');
  eq(roomBlock.indexOf('--- visit, continued ---'), 0,
    'a room capture started after the check-in was filed did not use the continued heading');
  eq(roomBlock.indexOf('Patient: my right knee'), -1,
    'THE CHECK-IN WAS WRITTEN TWICE: the room capture replayed the intake that kioskIntakeFile had already filed. A doctor reading that chart cannot tell a repeated question from a duplicated paste.');
  ok(roomBlock.indexOf('Recording consent confirmed') >= 0,
    'the consent attestation was dropped from the continued block - it must ride with EVERY block of words');
}

{
  /* filing twice writes once */
  const h = makeFiler({ kiosk: { intake: [{ who: 'Patient', text: 'my knee' }] } });
  eq(h.api.file().ok, true, 'the first file failed');
  const second = h.api.file();
  eq(second.ok, false, 'the check-in filed a SECOND copy into the same encounter');
  ok(/already in this transcript/.test(second.why), 'the second refusal does not say why: ' + second.why);
  eq(h.wrote.length, 1, 'two writes reached the transcript');
}

{
  /* every refusal path fails CLOSED, with a reason, and writes nothing */
  const wrongChart = makeFiler({ openChart: 'chart-9', kiosk: { intake: [{ who: 'Patient', text: 'my knee' }] } });
  const r1 = wrongChart.api.file();
  eq(r1.ok, false, 'the check-in was written into a DIFFERENT patient\'s open chart');
  ok(/is not the one this check-in belongs to/.test(r1.why), 'the wrong-chart refusal is not named: ' + r1.why);
  eq(wrongChart.wrote.length, 0, 'a refused write still reached the transcript');

  const noChart = makeFiler({ openChart: '', kiosk: { intake: [{ who: 'Patient', text: 'x' }] } });
  eq(noChart.api.file().ok, false, 'the check-in was filed with no chart open');
  eq(noChart.wrote.length, 0, 'a refused write still reached the transcript');

  const unbound = makeFiler({ kiosk: { ext: '', intake: [{ who: 'Patient', text: 'x' }] } });
  eq(unbound.api.file().ok, false, 'an unbound interview was filed somewhere');

  const empty = makeFiler({ kiosk: { intake: [] } });
  const r2 = empty.api.file();
  eq(r2.ok, false, 'an interview with no answers filed an empty check-in block');
  ok(/no check-in answers/.test(r2.why), 'the empty refusal is not named: ' + r2.why);

  const noBinding = makeFiler({ receipt: null, kiosk: { intake: [{ who: 'Patient', text: 'x' }] } });
  const r3 = noBinding.api.file();
  eq(r3.ok, false, 'the check-in was filed with no verified visit binding');
  eq(r3.why, 'the open patient and visit binding could not be verified, so nothing was written.',
    'the binding refusal from the shared writer was swallowed instead of returned');
  eq(noBinding.kiosk.intakeFiled, false,
    'a REFUSED file still set intakeFiled - the room capture would then skip the check-in and the encounter would lose it entirely');
}

{
  /* kioskFinish must file, and must never let the write stop the hand-off */
  const finish = extractFunction('kioskFinish');
  ok(finish.indexOf('kioskIntakeFile()') >= 0,
    'kioskFinish no longer files the check-in, so the verbatim half of the encounter again depends on somebody starting a room recording');
  ok(/safe\(function \(\) \{ return kioskIntakeFile\(\); \}/.test(finish),
    'the intake file is not wrapped in safe() - an additive transcript write must never be able to stop the kiosk resting or handing over to the doctor');
  const fileAt = finish.indexOf('kioskIntakeFile()');
  const restAt = finish.indexOf('kioskRestShow();');
  ok(fileAt >= 0 && restAt > fileAt,
    'the rest screen is shown before the check-in is filed, so the staff line cannot report whether it landed');
  ok(finish.indexOf('the check-in is NOT in the transcript yet') >= 0,
    'a failed file is not reported to staff in words - a missing check-in would then be discovered at signing time');
}

/* ---- 7. THE MOUTH SAYS THE WORDS (avanim-1.0.0) -------------------------- */

const visemeApi = build(
  extractFunction('faceVisemeFor') + '\n' + extractFunction('faceVisemes') + '\n' +
  extractFunction('faceVisemeDrop') + '\n' +
  'return { visemes: faceVisemes, drop: faceVisemeDrop };', {});

{
  const seq = visemeApi.visemes('Mama put the boot on.');
  ok(seq.length > 4, 'faceVisemes produced almost nothing for a real sentence: ' + JSON.stringify(seq));
  ok(seq.every(v => typeof v.shape === 'string' && v.ms > 0), 'a viseme carries no shape or no duration');

  /* the bilabial in "Mama"/"put"/"boot" CLOSES the mouth - the single most visible
     viseme there is, and the one whose absence reads as "not saying words" */
  ok(seq.some(v => v.shape === 'neutral'), 'no bilabial closure in a line full of m, p and b');
  /* "boot" and "put" are rounded, "Mama" is wide - a mapping that returns one shape
     for every vowel is the random loop with extra steps */
  const shapes = seq.map(v => v.shape);
  ok(shapes.indexOf('o') >= 0, 'the rounded vowels in "boot"/"put" produced no rounded mouth');
  ok(shapes.indexOf('open2') >= 0, 'the open vowels in "Mama" produced no open mouth');
  ok(new Set(shapes).size >= 3, 'the whole sentence produced fewer than three distinct mouth shapes: ' + shapes.join(','));

  /* it is a FUNCTION of the text, which is the whole difference from the old
     Math.random() cycle: the same line twice gives the same mouth */
  deep(visemeApi.visemes('Where does it hurt?'), visemeApi.visemes('Where does it hurt?'),
    'faceVisemes is not deterministic - it is still guessing rather than reading the words');
  ok(JSON.stringify(visemeApi.visemes('Where does it hurt?')) !== JSON.stringify(visemeApi.visemes('Mama put the boot on.')),
    'two different sentences produced the SAME mouth sequence');

  deep(visemeApi.visemes(''), [], 'an empty line produced visemes');
  deep(visemeApi.visemes(null), [], 'a null line produced visemes');
  /* punctuation holds the closed mouth long enough to read as a breath */
  const withStop = visemeApi.visemes('yes. no');
  ok(withStop.some(v => v.shape === 'neutral' && v.ms >= 190), 'a full stop does not hold the mouth closed, so the line runs on');

  /* the jaw travels with the shape, from ONE table, so the amplitude path and the
     viseme path cannot disagree about how far a given shape drops */
  ok(visemeApi.drop('open3') > visemeApi.drop('open2'), 'the jaw does not travel further on a wider mouth');
  ok(visemeApi.drop('open2') > visemeApi.drop('open1'), 'the jaw drop is not ordered by aperture');
  eq(visemeApi.drop('neutral'), 0, 'a closed mouth drops the jaw');
}

/* ---- 8. THE ANIMATION STATE MACHINE ------------------------------------- */

const makeFaceSrc = extractFunction('makeFace');

{
  /* ⛔ rAF DOES NOT FIRE IN A HIDDEN OR NON-COMPOSITING TAB, and a kiosk parked on
     the rest screen while the doctor works in another tab is exactly that state.
     Every loop in the face controller must be a timer. */
  ok(!/requestAnimationFrame\s*\(/.test(makeFaceSrc),
    'the face controller calls requestAnimationFrame - it does not fire in a hidden or non-compositing tab, which is precisely where a resting kiosk face lives');
  ok(!/setInterval\s*\(/.test(makeFaceSrc), 'the face controller arms a permanent interval');
  ['blink', 'wander', 'breathe', 'nodLoop', 'microGaze'].forEach(fn => {
    ok(new RegExp('later\\(' + fn + ',').test(makeFaceSrc) || new RegExp('later\\(step,').test(makeFaceSrc),
      'the ' + fn + ' loop no longer re-arms itself through later()/setTimeout');
  });

  /* THE RESTING FACE DOES NOT SMILE. This is the owner's §14 item in one line. */
  ok(/moodNow === 'speaking' \? 'smile' : 'neutral'/.test(makeFaceSrc),
    'baseMouth() no longer resolves idle to the neutral mouth - the resting face is smiling again, permanently, for the whole rest period');
  ok(/neutral:\s*'M79 137/.test(SOURCE), 'the neutral resting mouth path is gone from FACE_MOUTHS');
  ok(SOURCE.indexOf('FACE_MOUTHS.smile') < 0,
    'a static mouth path in faceSvg went back to `smile`, so a face rendered without a controller rests on a smile');

  /* blink cadence is jittered AND state-aware; a periodic blink is visible in
     about four repeats */
  const gap = extractFunction('blinkGapMs');
  ok(/Math\.random\(\)/.test(gap), 'the blink interval is no longer jittered - a periodic blink is the most robotic thing a drawn face can do');
  ['speaking', 'thinking', 'listening'].forEach(state => {
    ok(gap.indexOf(state) >= 0, 'the blink cadence no longer varies for the ' + state + ' state');
  });
  ok(/later\(applyLids, 95 \+ Math\.round\(Math\.random\(\) \* 70\)\)/.test(makeFaceSrc),
    'the blink CLOSURE is a fixed length again - every blink the same length reads as a shutter, not an eye');

  /* the lid table must land on the drawing. The shutter bbox is y 80..99 and the
     aperture starts at 89.8, so a value at or below 0.51 moves nothing at all -
     which is exactly the state the shipped code was in. */
  const lid = extractFunction('lidBase');
  const values = (lid.match(/return ([\d.]+);/g) || []).map(m => Number(m.replace(/[^\d.]/g, '')));
  ok(values.length >= 4, 'lidBase no longer returns a table of values');
  ok(values.every(v => v >= 0.5 && v <= 0.95),
    'a lidBase value is outside the 0.52-0.70 band the re-cut shutter responds to - values below 0.516 do not reach the eye aperture at all and are silent no-ops: ' + values.join(','));
  ok(new Set(values).size === values.length, 'two moods share a lid value, so the acting is not distinct');

  /* the sway is a fourth RIG term, never a second writer on .fHead - two writers on
     one transform is how the nod erased the concern shake once already */
  ok(/shakeX \+ swayX/.test(makeFaceSrc) && /breathY \+ nodY \+ swayY/.test(makeFaceSrc) && /shakeR \+ swayR/.test(makeFaceSrc),
    'the head sway is not composed into applyRig with the other three terms');
  ok((makeFaceSrc.match(/head\.style\.transform/g) || []).length === 1,
    'there is more than one writer on .fHead\'s transform');

  /* micro-saccades between wander targets, composed rather than overwriting */
  ok(/gazeX \+ microX/.test(makeFaceSrc) && /gazeY \+ microY/.test(makeFaceSrc),
    'the gaze is no longer target + jitter, so the pupils are perfectly still between wander ticks');
  ok(/setGazeTarget\(g\[0\], g\[1\]\)/.test(makeFaceSrc),
    'wander() overwrites the micro-saccade layer instead of moving only the target');

  /* reduced motion stops MOTION, not just the loops */
  ok(/if \(!reduced\) \{ breathe\(\); nodLoop\(\); microGaze\(\); \}/.test(makeFaceSrc),
    'the new loops start under prefers-reduced-motion');
  ok(/if \(!reduced\) \{\s*microX =/.test(makeFaceSrc) || /if \(!reduced\) \{[^}]*microX/.test(makeFaceSrc),
    'micro-saccades are written even under prefers-reduced-motion');

  /* speaking is a distinct FACE, not just a distinct mouth */
  ok(/moodNow === 'speaking' \? 'rotate\(-0\.9deg\)/.test(makeFaceSrc),
    'the speaking state has no head angle of its own again - a speaking face wearing the idle head and idle lids is a mask that talks');
}

console.log('PASS 1p avatar intake + animation runtime — ' + checks + ' checks');
