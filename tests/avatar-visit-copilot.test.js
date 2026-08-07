'use strict';
/*
 * AVATAR — THE VISIT COPILOT (av-5.6.3)
 * -----------------------------------------------------------------------------
 * Room mode could already hear a whole consultation. This train is about the
 * three ways it still lost the visit, and every claim below is EXECUTED against
 * the real module source rather than asserted about it.
 *
 *   1. DURABILITY. The capture lived in one array in one tab and reached the
 *      transcript exactly once, at the very end — a reload, a discarded tab or
 *      a crashed renderer threw the consultation away and left no trace that
 *      anything had been recorded. Proved here: every finalised sentence is
 *      persisted, the backup survives a simulated reload, it sheds its OLDEST
 *      sentences under quota instead of failing the write, and it is dropped
 *      ONLY after a proven file.
 *
 *   2. THE ACTION DETECTOR. "Order an MRI lumbar spine without contrast" is
 *      recognised as it is said. The dangerous half of that feature is
 *      everything it must REFUSE — with one microphone the doctor and the
 *      patient arrive on the same channel, so negated, past, conditional,
 *      hedged, cancelled and interrogative forms all have to come back empty.
 *      33 executed sentences below, of which 17 must produce nothing.
 *
 *   3. NEVER GUESSING. An imaging order for a paired body part with no side
 *      spoken is not a complete order. The proposal carries the gap, and the
 *      confirm gate is enforced in the handler and not only on the attribute.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_avatar.js'), 'utf8');

function slice(from, to, why) {
  const a = source.indexOf(from);
  const b = source.indexOf(to);
  assert(a >= 0 && b > a, 'cannot slice ' + why + ' (' + from.slice(0, 40) + ')');
  return source.slice(a, b);
}

/* ===========================================================================
   PART 1 — THE DETECTOR, EXECUTED
   =========================================================================*/
const detectorSrc = slice('var ACT_VERB =', '/* ---- the proposal list', 'the action detector');
const box = { console, Date, Math, RegExp, JSON };
vm.createContext(box);
vm.runInContext(
  'function clean(v){var t=v==null?"":String(v).trim();return(!t||/^(undefined|null)$/i.test(t))?"":t;}\n' +
  detectorSrc + '\nthis.detectActions = detectActions;', box);

const detect = box.detectActions;
/* the module runs in its own realm, so its arrays fail deepStrictEqual's
   prototype check against ours — round-trip the result into this realm and
   compare values, which is what these assertions are actually about */
function one(sentence) {
  const out = detect(sentence);
  assert(out && typeof out.length === 'number', 'detectActions must always return an array');
  return JSON.parse(JSON.stringify(out));
}

/* ---- 1a. what it MUST recognise ---- */
{
  const a = one('Order an MRI lumbar spine without contrast.');
  assert.strictEqual(a.length, 1, 'the headline sentence must produce exactly one proposal');
  assert.strictEqual(a[0].kind, 'imaging');
  assert.strictEqual(a[0].title, 'MRI');
  assert.strictEqual(a[0].fields.region, 'lumbar spine', 'the region must be the SPECIFIC one — "spine" would be a different scan');
  assert.strictEqual(a[0].fields.contrast, 'without contrast');
  assert.deepStrictEqual(a[0].missing, [], 'the lumbar spine is not paired — nothing is missing here');
  assert.strictEqual(a[0].status, 'proposed', 'a detected action is never born confirmed');
  assert.strictEqual(a[0].heard, 'Order an MRI lumbar spine without contrast.',
    'the verbatim sentence must ride with the proposal — the doctor confirms against what was SAID');
}
{
  const a = one("Let's get an MRI of the left knee.");
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].fields.side, 'left');
  assert.strictEqual(a[0].fields.region, 'knee');
  assert.deepStrictEqual(a[0].missing, [], 'the side was spoken, so nothing is missing');
}
{
  const a = one('Order an MRI of the knee.');
  assert.strictEqual(a.length, 1);
  assert.deepStrictEqual(a[0].missing, ['side'],
    'a knee MRI with no side spoken MUST carry the gap — this is the whole "never guess" rule');
}
{
  const a = one('We should also get a CT of the abdomen and pelvis with contrast.');
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].title, 'CT');
  assert.strictEqual(a[0].fields.region, 'abdomen and pelvis', 'the longest region must win over "abdomen" alone');
  assert.strictEqual(a[0].fields.contrast, 'with contrast');
}
{
  const a = one("I'd like to order a CBC.");
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].kind, 'lab'); assert.strictEqual(a[0].title, 'CBC');
}
{
  const a = one("Let's refer him to orthopedics.");
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].kind, 'referral');
  assert.strictEqual(a[0].fields.specialty, 'orthopedics');
  assert.deepStrictEqual(a[0].missing, []);
}
{
  const a = one("Let's refer her out.");
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].kind, 'referral');
  assert.deepStrictEqual(a[0].missing, ['specialty'], 'a referral with no specialty named must say so, not pick one');
}
{
  const a = one('Start gabapentin 300 mg at night.');
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].kind, 'medication');
  assert.strictEqual(a[0].fields.drug, 'gabapentin');
  assert.strictEqual(a[0].title, 'Gabapentin', 'the drug name must not carry the dose — that reads as a second dose');
  assert.strictEqual(a[0].fields.dose, '300 mg');
  assert.strictEqual(a[0].fields.frequency, 'at night');
  assert.deepStrictEqual(a[0].missing, []);
}
{
  const a = one('Start meloxicam.');
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].fields.drug, 'meloxicam');
  assert.deepStrictEqual(a[0].missing.sort(), ['dose', 'frequency'],
    'a prescription with no dose and no frequency must carry BOTH gaps');
}
{
  const a = one('Follow up in six weeks.');
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].kind, 'followUp');
  assert.strictEqual(a[0].fields.interval, 'six weeks');
}
{
  /* the named instruction — the doctor talking TO the assistant, mid-visit */
  const a = one('MLS, remind me to document that the pain radiates into the left leg.');
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].kind, 'note');
  assert.strictEqual(a[0].directed, true, 'a wake-word sentence must be flagged as directed at the assistant');
  assert.strictEqual(a[0].detail, 'remind me to document that the pain radiates into the left leg.',
    'the instruction must be carried VERBATIM — it is documentation, not a paraphrase');
}
{
  const a = one('Hey scribe, order an X-ray of the right shoulder.');
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].kind, 'imaging', 'a directed sentence with a clinical shape stays clinical, not a note');
  assert.strictEqual(a[0].fields.side, 'right');
  assert.strictEqual(a[0].directed, true);
}

/* ---- 1b. what it MUST refuse. Each of these contains the words of an order
   and no order was placed. A detector without them puts a scan on screen
   because the doctor said the patient does not need one. ---- */
const REFUSALS = [
  ["We don't need an MRI.", 'plain negation'],
  ['She had an MRI last year.', 'past tense — the patient describing their own history'],
  ['Should we order an MRI?', 'a question, not an instruction'],
  ["If the pain gets worse we'll order an MRI.", 'a conditional plan for a different day'],
  ['Can I get an MRI?', 'the PATIENT asking — one microphone cannot tell us apart, so this must fail closed'],
  ["I'm not going to order an MRI.", 'negated intent'],
  ["Let's hold off on the MRI.", 'explicitly deferred'],
  ['Cancel the MRI.', 'cancellation is not an order'],
  ['My knee hurts.', 'no trigger verb at all'],
  ['Have you had an MRI before?', 'history question'],
  ['We might order an MRI.', 'hedged with no commitment'],
  ['Do you want to get an MRI?', 'question addressed to the patient'],
  ['I would consider an MRI if physical therapy fails.', 'conditional and hedged'],
  ['No need for an MRI at this point.', 'explicit refusal'],
  ['The patient wants an MRI.', 'a report of what someone wants, not an order'],
  ['They already ordered a CBC last month.', 'someone else, previously'],
  ['What about a referral to orthopedics?', 'a question about a referral']
];
REFUSALS.forEach(([sentence, why]) => {
  const out = one(sentence);
  assert.strictEqual(out.length, 0,
    'MUST NOT propose an action for "' + sentence + '" (' + why + ') — got ' +
    JSON.stringify(out.map(a => a.kind + ':' + a.title)));
});

/* a DIRECTED sentence still has to clear the refusals — the wake word is not
   a bypass around the safety rules */
assert.strictEqual(one('MLS, we are not ordering an MRI.').length, 0,
  'the wake word must not turn a negated sentence into an order');

/* the detector is PURE and bounded */
assert.strictEqual(one('').length, 0, 'empty input is not an action');
assert.strictEqual(one(null).length, 0, 'null input must not throw');
assert.strictEqual(one('x'.repeat(900)).length, 0, 'an absurdly long run is refused rather than parsed');

/* ===========================================================================
   PART 2 — THE BACKUP, EXECUTED (persistence, reload, quota, drop)
   =========================================================================*/
const storeSrc = slice("var AMBIENT_STORE_KEY =", 'function ambientActionsForStore', 'the backup');

function makeStore(limitBytes) {
  const mem = {};
  return {
    mem,
    api: {
      getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
      removeItem: k => { delete mem[k]; },
      setItem: (k, v) => {
        const total = Object.keys(mem).reduce((n, key) => (key === k ? n : n + mem[key].length), 0) + v.length;
        if (limitBytes && total > limitBytes) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
        mem[k] = String(v);
      }
    }
  };
}
function bootStore(limitBytes, nsFn) {
  const store = makeStore(limitBytes);
  const sandbox = { console, Date, Math, JSON, localStorage: store.api };
  sandbox.window = { uns: nsFn };
  vm.createContext(sandbox);
  vm.runInContext(
    'function safe(fn,fb){try{return fn();}catch(e){return fb;}}\n' +
    'function isFn(f){return typeof f==="function";}\n' +
    'function clean(v){var t=v==null?"":String(v).trim();return(!t||/^(undefined|null)$/i.test(t))?"":t;}\n' +
    storeSrc +
    '\nthis.read=ambientStoreRead; this.write=ambientStoreWrite; this.drop=ambientStoreDrop; this.key=ambientStoreKey;',
    sandbox);
  return { sandbox, store };
}

/* 2a. the round trip: what was captured survives a "reload" (a fresh context
   reading the same storage) */
{
  const a = bootStore(0, s => 'acct7::' + s);
  const res = a.sandbox.write({ sid: 'office-1', bound: 'PT-100', start: 1000,
    parts: ['the back pain started three weeks ago', 'it radiates into the left leg'],
    intake: [{ who: 'Patient', text: 'my back hurts' }], actions: [] });
  assert.strictEqual(res.ok, true, 'the capture must persist');
  assert.strictEqual(res.trimmed, false);
  assert(Object.keys(a.store.mem)[0].indexOf('acct7::') === 0,
    'the backup MUST be account-namespaced — an unscoped key is the next doctor reading this visit');

  /* the reload: brand new context, same storage */
  const b = bootStore(0, s => 'acct7::' + s);
  Object.assign(b.store.mem, a.store.mem);
  const back = b.sandbox.read();
  assert(back, 'the capture must be readable after a reload');
  assert.strictEqual(back.bound, 'PT-100', 'the chart binding must survive — without it the words can never be filed');
  assert.deepStrictEqual(back.parts, ['the back pain started three weeks ago', 'it radiates into the left leg']);
  assert.strictEqual(back.intake.length, 1, 'the check-in half must survive too');
}

/* 2b. an UNBOUND record is not a recoverable capture — it could only ever end
   in a refusal to write, so read() must not offer it */
{
  const a = bootStore(0, s => 'acct7::' + s);
  a.sandbox.write({ sid: 'x', bound: '', start: 1, parts: ['words'], intake: [], actions: [] });
  assert.strictEqual(a.sandbox.read(), null, 'an unbound backup must not present itself as recoverable');
}

/* 2c. QUOTA: the backup degrades by shedding its OLDEST sentences and SAYS so.
   A write that simply failed would leave a backup that silently stopped
   updating an hour ago — the worst possible outcome. */
{
  const parts = [];
  for (let i = 0; i < 400; i++) parts.push('sentence number ' + i + ' of the consultation, spoken aloud in the room');
  const big = bootStore(0, s => s);
  const unlimited = big.sandbox.write({ sid: 's', bound: 'PT-9', start: 1, parts, intake: [], actions: [] });
  assert.strictEqual(unlimited.trimmed, false, 'with room to spare nothing is trimmed');

  const tight = bootStore(6000, s => s);
  const res = tight.sandbox.write({ sid: 's', bound: 'PT-9', start: 1, parts, intake: [], actions: [] });
  assert.strictEqual(res.ok, true, 'a quota refusal must degrade, not abandon the backup');
  assert.strictEqual(res.trimmed, true, 'a trimmed backup must DECLARE that it was trimmed');
  const kept = tight.sandbox.read();
  assert(kept.parts.length > 0 && kept.parts.length < 400, 'some of the visit must survive, not all of it');
  assert.strictEqual(kept.trimmed, true, 'the trimmed flag must survive the round trip so the doctor can be told');
  assert(kept.parts[kept.parts.length - 1].indexOf('399') >= 0,
    'the NEWEST sentences must be the ones kept — a visit is trimmed from its head, never its tail');
}

/* 2d. an impossible write fails honestly rather than looping */
{
  const tiny = bootStore(10, s => s);
  const res = tiny.sandbox.write({ sid: 's', bound: 'PT-9', start: 1, parts: ['a', 'b'], intake: [], actions: [] });
  assert.strictEqual(res.ok, false, 'a backup that cannot fit at all must report failure');
  assert.strictEqual(res.why, 'quota');
}

/* 2e. drop actually drops */
{
  const a = bootStore(0, s => s);
  a.sandbox.write({ sid: 's', bound: 'PT-1', start: 1, parts: ['x y z'], intake: [], actions: [] });
  assert(a.sandbox.read(), 'sanity');
  a.sandbox.drop();
  assert.strictEqual(a.sandbox.read(), null, 'drop must remove the record');
}

/* ===========================================================================
   PART 3 — THE WIRING. Claims that live in call order, not in a pure function.
   =========================================================================*/

/* 3a. every finalised sentence reaches the backup AND the detector */
assert(/kiosk\.ambParts\.push\(v\);[\s\S]{0,400}kioskAmbientSave\(false\)[\s\S]{0,200}ordersDetectSoon\(v\)/.test(source),
  'a finalised sentence must be persisted and offered to the detector — otherwise the backup lags the room');

/* 3b. the backup is dropped ONLY after a proven write, and every refusal in
   kioskAmbientFile returns BEFORE that line */
{
  const fileFn = slice('function kioskAmbientFile', 'function kioskAmbientStart', 'the file path');
  const dropAt = fileFn.indexOf('ambientStoreDrop()');
  const filedAt = fileFn.indexOf('kiosk.ambFiled = true');
  assert(dropAt > 0 && filedAt > 0 && dropAt > filedAt,
    'the backup must be dropped only AFTER the write is marked filed');
  const refusals = fileFn.slice(0, filedAt).match(/return \{ ok: false/g) || [];
  assert(refusals.length >= 5,
    'the fail-closed refusals must all precede the drop (found ' + refusals.length + ')');
  assert(fileFn.slice(0, dropAt).indexOf('box.value = prior') > 0,
    'the transcript write must happen before the backup is discarded');
}

/* 3c. End Visit WAITS for the recogniser's trailing results. The last sentence
   of a visit is usually the plan; ending without the wait drops it. */
assert(source.includes('function kioskAmbientFlush'), 'the flush-before-file step was removed');
assert(/rec\.stop\(\);[\s\S]{0,400}waited >= 960/.test(source),
  'End Visit must stop the recogniser and then WAIT for its tail results');
assert(/function kioskEndVisit[\s\S]{0,600}kioskAmbientFlush\(function \(\) \{[\s\S]{0,200}kioskAmbientSave\(true\)[\s\S]{0,120}kioskAmbientStop/.test(source),
  'End Visit must flush, then save, then file — in that order');
assert(/function kioskAmbientRetry\(\)[\s\S]{0,500}if \(kiosk\.ambClosing\) return;/.test(source),
  'the restart loop must be disarmed while closing, or the mic reopens under the review screen');

/* 3d. the confirm gate is enforced in the HANDLER, not only on the attribute —
   a disabled attribute is a UI hint, not a safety property */
assert(/confirm\.addEventListener\('click', function \(\) \{\s*\n\s*if \(\(a\.missing \|\| \[\]\)\.length\) return;/.test(source),
  'Confirm must re-check the missing fields inside the handler');
assert(/confirm\.disabled = true;/.test(source), 'Confirm must also be visibly disabled while a field is missing');

/* 3e. nothing here submits anything, and the note says so */
assert(source.includes('have NOT been transmitted to any EMR'),
  'the confirmed-orders block must state plainly that nothing was transmitted');
assert(!/fetch\([^)]*order/i.test(source), 'this module must not gain an order-submitting network call');

/* 3f. raw speech never reaches innerHTML — `heard` is microphone text */
{
  const card = slice('function ordersCard', 'function ordersRender', 'the order card');
  assert(!card.includes('innerHTML'),
    'the order card must be built from DOM nodes — interpolating recognised speech into markup is an injection path');
  assert(card.includes("make('div', 'mlsAvOrdHeard'"), 'the verbatim heard line was removed from the card');
}

/* 3f-bis. NO NATIVE BLOCKING DIALOG anywhere in this flow. window.prompt and
   window.confirm freeze the renderer — they would stall the recording clock,
   the save badge and the microphone restart loop behind a modal held open in
   front of a patient, and this app has been wedged by exactly that before.
   Correcting an action is inline; discarding a recovered visit is two taps. */
assert(!/window\.(prompt|confirm)\s*\(/.test(source),
  'a native blocking dialog is back in the avatar module — it would freeze the capture loop mid-visit');
assert(source.includes('a.editing = true'), 'the inline action editor was removed');
assert(/function commitEdit\(\)[\s\S]{0,200}if \(!v\) return;/.test(source),
  'saving an empty edit must be a no-op, not a blank action');
assert(/data-armed/.test(source), 'the two-tap discard guard was removed — one reflex tap would delete a consultation');

/* 3g. the widget is ABSENT when there is nothing to confirm — it is not a
   permanent panel competing with the patient for the doctor's attention */
assert(/if \(!list\.length\) \{ host\.style\.display = 'none'/.test(source),
  'an empty proposal list must hide the widget entirely');

/* 3h. the review tells the truth about what was NOT confirmed */
assert(source.includes('Heard but NOT confirmed'),
  'the review must name the unconfirmed proposals rather than quietly omitting them');
assert(/function kioskReviewShow[\s\S]{0,3000}Nothing was written: /.test(source),
  'a failed file must be reported as a failure in the review, not glossed');

/* 3i. recovery obeys the SAME fail-closed binding rule as the live path */
{
  const rec = slice('function ambientRecoverFile', 'function kioskAmbientStart', 'the recovery write');
  assert(rec.includes('activePtIdSafe()'), 'recovery must resolve the chart at WRITE time');
  /* a capture still RUNNING in this tab is not a recovered one — offering it
     would file half a consultation and drop the backup protecting the rest */
  {
    const info = slice('function ambientRecoverInfo', 'function ambientRecoverFile', 'the recovery reader');
    assert(/kiosk\.ambient === true && clean\(rec\.sid\)[\s\S]{0,80}return null;/.test(info),
      'a capture running in THIS tab must not be offered as recoverable');
  }
  assert(rec.includes('is not the one this recording belongs to'),
    'a chart mismatch must refuse and name the chart the words belong to');
  assert(rec.lastIndexOf('ambientStoreDrop()') > rec.indexOf('box.value = prior'),
    'the recovered backup must not be discarded before it is written');
  /* the ONE earlier drop is the idempotency branch: the words are already in
     the transcript, so the backup has done its job and must not keep offering
     itself. It must return WITHOUT appending anything a second time. */
  assert(rec.includes('box.value.indexOf(info.body) >= 0'),
    'filing the same recovered capture twice must be a no-op — that would duplicate a whole visit');
  {
    const dupAt = rec.indexOf('box.value.indexOf(info.body) >= 0');
    const writeAt = rec.indexOf('box.value = prior');
    assert(dupAt > 0 && writeAt > dupAt, 'the duplicate check must guard the write, not follow it');
    assert(rec.slice(dupAt, writeAt).includes('already: true'),
      'the duplicate branch must return an "already" result instead of appending');
  }
}

/* 3j. the recording state never leaks into the next patient */
{
  const open = slice('function openKiosk', 'var root = document.createElement', 'the kiosk reset');
  ['ambActions', 'ambWindow', 'ambClosing', 'ambEnding'].forEach(k => {
    assert(open.includes('kiosk.' + k), 'openKiosk must reset kiosk.' + k + ' — proposals must not cross patients');
  });
}

/* 3k. ending the RECORDING needs no PIN; the door back into the app still has
   the lock it always had */
assert(/back\.addEventListener\('click', function \(\) \{[\s\S]{0,200}kiosk\.pinSet === false[\s\S]{0,120}kioskRequestEnd\(\)/.test(source),
  'leaving the kiosk from the review must still pass through the exit-PIN gate');
assert(/#mlsAvKiosk\.ambient #mlsAvKioskEndVisit\{display:block\}/.test(source),
  'the End Visit control must be visible during a capture');
assert(/#mlsAvKiosk\.ambient #mlsAvKioskEnd\{display:none\}/.test(source),
  'the interview-era End button must be hidden during a capture — two ways to end a visit is one too many');

/* 3l. WHAT THE CHART ALREADY KNOWS. The intake stops making the patient recite
   what the chart carries — but only from the EXACT chart the interview is
   bound to, and it must not survive into the next patient. */
{
  const ctxFn = slice('function kioskChartContext', 'function kioskTurn', 'the chart context builder');
  assert(ctxFn.includes('exactPatient(kiosk.ext)'),
    'the chart block must come from the exact bound chart — exactPatient fails closed on an ambiguous id');
  assert(/if \(!p\) return null;/.test(ctxFn),
    'an unresolvable patient must send NO context rather than the wrong chart');
  ['allergies', 'medications', 'problems'].forEach(k =>
    assert(ctxFn.includes('ctx.' + k), 'the chart block lost its ' + k + ' field'));
  assert(/\.slice\(0, 400\)|, 400\)/.test(ctxFn), 'the chart fields must be capped client-side too');
}
assert(/if \(kiosk\.chartCtx === undefined\) kiosk\.chartCtx = kioskChartContext\(\);/.test(source),
  'the chart context must be resolved once per interview, not rebuilt on the latency path of every turn');
assert(/kiosk\.chartCtx = undefined;/.test(source),
  'openKiosk must reset the chart context — the previous patient\'s chart must never ride into the next interview');
{
  /* it rides on the OFFICE turn only; the portal is a different module and a
     different session, and the backend refuses it there regardless */
  const turn = slice('function kioskTurn', 'THE SELF-END WATCHDOG', 'the turn body');
  assert(turn.includes('body.chartContext = kiosk.chartCtx'), 'the chart block never reaches the request');
  assert(turn.includes("'/api/avatar/office/turn'"), 'the chart block must ride the clinician-authenticated route');
}

/* 3m. THE AI DISCLOSURE. This screen can wear the doctor's own face and speak
   in a voice chosen to sound like them. Without a disclosure that is not a
   feature, it is impersonation — so the line is mounted with the kiosk, in
   BOTH modes, and cannot be removed by any state change. */
assert(source.includes('mlsAvKioskAi'), 'the AI disclosure element was removed');
assert(/AI assistant\s*—\s*not the doctor/.test(source),
  'the disclosure must say plainly that this is not the doctor');
{
  /* it must NOT be hidden by any mode class — a disclosure that disappears
     during room capture is worse than none, because the patient saw one */
  assert(!/#mlsAvKiosk[^{]*#mlsAvKioskAi\s*\{[^}]*display:\s*none/.test(source),
    'a CSS rule hides the AI disclosure in some kiosk state');
  const markup = slice("root.innerHTML =", "(document.body || document.documentElement).appendChild(root);", 'the kiosk markup');
  assert(markup.indexOf('mlsAvKioskAi') > 0, 'the disclosure must be mounted with the kiosk, not added later');
}

/* 3n. MUTE / PAUSE. The one invariant: a paused kiosk must never still claim
   to be recording, and pausing must not cost what was already heard. */
assert(source.includes('function kioskPauseToggle'), 'the mute/pause control was removed');
assert(source.includes('mlsAvKioskMute'), 'the mute/pause button was removed');
{
  const p = slice('function kioskPauseToggle', 'function kioskEndVisit', 'the pause toggle');
  assert(/kiosk\.ambient\) kioskAmbientSave\(true\)[\s\S]{0,120}pvStopVoice\(\)/.test(p),
    'the capture must be flushed to the backup BEFORE the microphone closes — pausing must not cost words');
  assert(/PAUSED[^']*not recording/.test(p),
    'the banner must stop claiming to record the moment pause is pressed');
  assert(p.indexOf('pvStopVoice()') > 0, 'pause must actually close the microphone, not merely relabel the screen');
}
/* nothing may reopen the microphone while paused — three separate doors */
['function kioskAmbientListen', 'function kioskAmbientRetry', 'function kioskListen'].forEach((fn) => {
  const at = source.indexOf(fn);
  assert(at > 0, 'missing ' + fn);
  assert(/if \(kiosk\.paused\) return/.test(source.slice(at, at + 400)),
    fn + ' can reopen the microphone while paused');
});
assert(/kiosk\.paused = false;/.test(source), 'the paused state must reset — it must not be inherited by the next patient');
{
  /* one source for the banner text, so the markup and the resume path cannot
     drift into disagreeing about what the screen says */
  assert(source.includes('var AMBIENT_REC_TEXT'), 'the shared recording-banner constant was removed');
  assert(source.includes("<span id=\"mlsAvKioskRecText\">' + AMBIENT_REC_TEXT + '</span>"),
    'the markup must use the shared banner constant');
}

/* 3o. the module still reports itself honestly */
assert(source.includes("var VERSION = 'av-5.6.3'"), 'VERSION must move with this train');
{
  const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
  const tokenM = connect.match(/feat_mls_avatar\.js\?v=\d{8}av(\d+)/);
  assert(tokenM && tokenM[1] === '563', 'the loader cache token must name av-5.6.3 (found ' + (tokenM && tokenM[1]) + ')');
}

console.log('PASS avatar visit copilot (av-5.6.3): detector executed on ' + (12 + REFUSALS.length + 4) +
  ' sentences (' + REFUSALS.length + ' must-refuse, all empty), backup round-trips a reload, sheds its OLDEST ' +
  'sentences under quota and is dropped only after a proven write, End Visit flushes before filing, ' +
  'confirm gate enforced in the handler, recovery fails closed on the chart');
