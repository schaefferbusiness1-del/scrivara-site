'use strict';

/* vcp-1.0.0 — every microphone in this app reaches the ONE Copilot brain, and
 * one spoken sentence renders exactly one user bubble.
 *
 * WHAT WAS MEASURED, AND WHY EACH ARM EXISTS
 * ------------------------------------------
 * Five microphone surfaces shipped. Two of them constructed a SpeechRecognition
 * without ever registering with mlsSpeechHub():
 *
 *   copilotMic()                  ScribeFlow.html — comment claimed "its own
 *                                 instance so it never clashes with visit
 *                                 dictation", which is the exact claim the
 *                                 one-recognizer truce exists to disprove
 *   feat_mls_voice_commands.js    watched the #captureBtn class instead, which
 *                                 only reports the VISIT recorder — and its FAB
 *                                 is CSS-retired while the opt-in persists in
 *                                 localStorage, so it ran invisibly
 *
 * And since cv2-1.2.1 the Copilot thread rendered ANSWERS WITH NO QUESTIONS:
 * deterministic spoken commands ran locally and appended nothing to the shared
 * conversation, so a reply bubble arrived with nothing above it.
 *
 * THE DE-DUPLICATOR IS THE PART THAT FAILS SILENTLY. Three surfaces disagree
 * about who renders the question, so the router echoes the user bubble and drops
 * the assistant's identical append. If that wrapper is ever removed, every
 * spoken sentence that reaches the assistant renders TWICE and nothing throws.
 * Arm 5 runs the shipped module and counts bubbles; it is the only arm here that
 * would catch that.
 *
 * BOTH DIRECTIONS PROVEN before this gate was trusted (the rule earned by the
 * review-clearance gate, which passed on its own regression):
 *   - arm 1 fails when the hub registration is removed from either surface
 *   - arm 5 fails when installDedupe() is neutered (2 bubbles, not 1)
 *   - all five pass on the real tree
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const routerSrc = read('feat_mls_voice_copilot.js');
const commandsSrc = read('feat_mls_voice_commands.js');
const bridgeSrc = read('feat_mls_voice_ai_micbridge.js');
const cv2Src = read('feat_mls_copilot_voice_v2.js');
const html = read('ScribeFlow.html');

/* ---------- 1. every recognizer owner is in the one-recognizer truce ---------- */
/* A microphone owner is a file that CONSTRUCTS a recognizer. Constructing one
   without a hub lease is the defect; the hub is the only thing that can order
   two owners, because SpeechRecognition.stop() releases the device
   asynchronously. */
const owners = [
  { label: 'visit recorder + Copilot card mic (ScribeFlow.html)', src: html, ids: ["register('copilot-card'", "hub.register('visit'"] },
  { label: 'Copilot Voice (feat_mls_copilot_voice_v2.js)', src: cv2Src, ids: ["h.register('copilot'"] },
  { label: 'voice commands (feat_mls_voice_commands.js)', src: commandsSrc, ids: ["h.register('voice-commands'"] }
];
for (const o of owners) {
  assert(/new\s+(?:SR|SRC|Ctor|C)\s*\(/.test(o.src) || /new\s+SRC\(/.test(o.src),
    o.label + ': expected this file to construct a recognizer — re-derive this gate if it no longer does');
  for (const id of o.ids) {
    assert(o.src.includes(id),
      o.label + ' no longer registers with mlsSpeechHub as ' + id +
      ' — it is outside the one-recognizer truce, so it can hold the microphone ' +
      'while another owner holds it too, and neither will know');
  }
}
/* the Copilot card mic must also WAIT for the previous owner, not just claim */
assert(/lease\.whenReady\(begin\)/.test(html.slice(html.indexOf('function copilotMic()'), html.indexOf('function copilotMic()') + 5200)),
  'copilotMic() claims the hub but starts without lease.whenReady — stop() releases the device ' +
  'asynchronously, so starting immediately puts two recognizers on one microphone anyway');
/* ...and it must not go back to failing silently */
const micBlock = html.slice(html.indexOf('function copilotMic()'), html.indexOf("function copilotMic()") + 5200);
assert(/not-allowed/.test(micBlock) && /audio-capture/.test(micBlock),
  'copilotMic() no longer names its microphone failures — a blocked mic must not look ' +
  'identical to "no speech yet"');

/* ---------- 2. the router is a router, not a third brain ---------- */
/* Scan CODE, not prose. This module's header names every API it refuses to own,
   which is exactly the text a naive substring search would trip over — the same
   trap that made an earlier gate in this repo pass on its own regression. */
function stripComments(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const routerCode = stripComments(routerSrc);
for (const forbidden of ['SpeechRecognition', 'getUserMedia', 'MediaRecorder', '.claim(']) {
  assert(!routerCode.includes(forbidden),
    'the voice router now references ' + forbidden + ' — it must own no recognizer and no ' +
    'microphone lease. The moment it owns one it is a fourth brain, not the seam between them');
}
assert(!/setInterval\s*\(/.test(routerCode),
  'the voice router added a setInterval — it has two one-shot jobs, and this app already ' +
  'carries a pinned population of feature-module pollers');
assert(/registerIntent\('voice-ai-delegate'/.test(routerSrc),
  'the delegating intent is gone — save-draft and pull-patient-from-Athena become unreachable ' +
  'by voice once the mic bridge stands down');
assert(/ai\.parse\(q\)/.test(routerSrc),
  'the delegate stopped asking __mlsVoiceAI\'s OWN parser. If it grows its own patterns it ' +
  'becomes the third brain this module exists to prevent');
assert(/UNIQUE_TO_VOICE_AI\[p\.intents\[i\]\]/.test(routerSrc),
  'the delegate no longer restricts itself to intents no other layer implements — it can now ' +
  'hijack "generate ..." from the real Copilot AI');

/* ---------- 3. the command recognizer routes finals, never interim ---------- */
assert(/if \(fin\) \{/.test(commandsSrc) && /routeToCopilot\(fin\)/.test(commandsSrc),
  'feat_mls_voice_commands.js no longer routes its FINAL transcripts to the one brain');
assert(!/routeToCopilot\(chunk\)/.test(commandsSrc) && !/routeToCopilot\(buf\)/.test(commandsSrc),
  'an interim/rolling-buffer transcript is being routed — a half-heard sentence must never run ' +
  'a clinical action');
/* the legacy matcher must survive as the no-router fallback: the
   visible-clinical-action gate pins doStartRecording() by name */
assert(/function doStartRecording\(\)/.test(commandsSrc),
  'the legacy fallback was deleted — a page where the router did not load now has no voice at all');

/* ---------- 4. the mic bridge stands down, or one sentence fires twice ---------- */
assert(/routerOwnsRouting\(\)\) return;/.test(bridgeSrc),
  'feat_mls_voice_ai_micbridge.js no longer stands down when the router is installed. It taps the ' +
  'SAME recognizer __mlsVoice routes from, so every spoken sentence would be acted on twice — a ' +
  'double-fire on clinical actions, not a cosmetic duplicate');

/* ---------- 5. RUNTIME: one utterance, exactly one user bubble ---------- */
/* This is the arm that catches a removed de-duplicator. Everything above is a
   source assertion and would still pass. */
function runRouter(opts) {
  const history = [];
  const convo = {
    append(role, text) { history.push({ role, text }); return { role, text }; },
    messages() { return history.slice(); }
  };
  const sandbox = {
    window: {},
    document: { readyState: 'complete', addEventListener() {} },
    setTimeout, clearTimeout, Date
  };
  sandbox.window.__mlsCopilotConvo = convo;
  sandbox.window.document = sandbox.document;
  if (opts.assistantAppends) {
    /* the real __mlsAsstFix._handleSend calls addUser() -> convo.append('user', q) */
    sandbox.window.__mlsAsstFix = {
      installed: true,
      _handleSend(q) { sandbox.window.__mlsCopilotConvo.append('user', q); sandbox.window.__mlsCopilotConvo.append('ai', 'answered'); },
      registerIntent() { return function () {}; }
    };
  }
  if (opts.copilotVoice) {
    sandbox.window.__mlsCopilotVoiceV2 = {
      installed: true,
      handle(text) {
        if (opts.localLeg) { sandbox.window.__mlsCopilotConvo.append('ai', 'Recording stopped.'); return 'local'; }
        /* the chat path: cv2 hands off to the assistant, which appends its own user turn */
        if (sandbox.window.__mlsAsstFix) sandbox.window.__mlsAsstFix._handleSend(text);
        return 'chat';
      }
    };
  }
  /* The control (5c) must disable the mechanism AT SOURCE. Calling
     _test.removeDedupe() proves nothing: echoUser() re-installs the wrapper on
     its next call, so the "control" would silently measure the healthy tree —
     and an arm that cannot fail is worse than no arm. */
  let src = routerSrc;
  if (opts.neuterDedupe) {
    const line = '    c.append = wrapped;';
    assert.strictEqual(src.split(line).length - 1, 1,
      'the control cannot find the single line that installs the de-duplicator — re-derive it');
    src = src.replace(line, '    /* control: de-duplicator deliberately not installed */');
  }
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'feat_mls_voice_copilot.js' });
  const api = sandbox.window.__mlsVoiceCopilot;
  assert(api && api.installed && api.version === 'vcp-1.0.0', 'the voice router did not install');
  const res = api.route('stop recording', 'test');
  return { api, res, history, users: history.filter((m) => m.role === 'user') };
}

/* 5a. a LOCAL command: the words must appear, because nothing else appends them */
{
  const r = runRouter({ copilotVoice: true, localLeg: true });
  assert.strictEqual(r.res.via, 'copilot-voice', 'the router did not choose Copilot Voice');
  assert.strictEqual(r.users.length, 1,
    'a spoken local command rendered ' + r.users.length + ' user bubbles, expected 1 — before ' +
    'vcp-1.0.0 this was 0, which is why the Copilot thread showed answers with no questions');
  assert.strictEqual(r.users[0].text, 'stop recording');
  assert.strictEqual(r.history[0].role, 'user',
    'the answer rendered BEFORE the question — the doctor sees a reply to nothing');
}

/* 5b. a CHAT question: the assistant appends its own user turn, and the router
       must not double it */
{
  const r = runRouter({ copilotVoice: true, localLeg: false, assistantAppends: true });
  assert.strictEqual(r.users.length, 1,
    'one spoken question rendered ' + r.users.length + ' user bubbles — the de-duplicator on ' +
    '__mlsCopilotConvo.append is gone or no longer matches, and every spoken question now ' +
    'appears twice in the thread');
  assert(r.api.brains().dedupeDropped >= 1, 'the de-duplicator recorded no drop, so it is not the thing that kept the count at 1');
}

/* 5c. the control: with the de-duplicator removed the SAME input renders two
       bubbles. Without this, 5b could be passing for the wrong reason. */
{
  const r = runRouter({ copilotVoice: true, localLeg: false, assistantAppends: true, neuterDedupe: true });
  assert.strictEqual(r.users.length, 2,
    'removing the de-duplicator did NOT produce the duplicate this gate claims to prevent — ' +
    'arm 5b is therefore passing for some other reason and proves nothing');
}

/* 5d. no brain at all: the utterance must not vanish, and the message must name
       a route that exists */
{
  const r = runRouter({});
  assert.strictEqual(r.res.ok, false);
  const ai = r.history.filter((m) => m.role === 'ai');
  assert.strictEqual(ai.length, 1, 'a spoken utterance was dropped silently when Copilot was not loaded');
  assert(/Copilot box/.test(ai[0].text),
    'the failure message does not name a route that exists — it must point at a control the ' +
    'doctor can actually use, not at a screen that is missing');
}

/* 5e. revert() puts append back, or the wrapper outlives the module */
{
  const r = runRouter({ copilotVoice: true, localLeg: true });
  r.api.revert();
  assert(!r.api.brains().dedupe, 'revert() left the de-duplicator installed');
}

console.log('PASS voice reaches one Copilot brain: 3 recognizer owners in the truce, router owns 0 recognizers/0 leases/0 patterns, mic bridge stands down, and one utterance renders exactly 1 user bubble (2 with the de-duplicator removed — the control)');
