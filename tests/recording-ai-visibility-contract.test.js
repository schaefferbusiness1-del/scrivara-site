'use strict';

/* 2026-07-22 recording/AI visibility fixes:
 * 1. A pasted/typed transcript must never claim "Resume recording" /
 *    "Recording stopped" when no audio session ever ran in this tab.
 * 2. The Assistant dictation mic must target the real in-app panel
 *    (#mlsAsstPanel — the hyphenated id belongs to the extension's Athena-side
 *    panel and never exists here) and surface every state instead of
 *    swallowing errors.
 * 3. Note generation must never hang forever: bounded timeout, visible error,
 *    live retry button.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- 1. honest recorder state (top flow lane, fl-1.8.0) ---- */
assert(connect.includes("var VERSION = 'fl-1.7.2';"), 'flow-lane honest-state version missing');
assert(connect.includes('var _recSessionSeen = false;'), 'audio-session-history flag missing');
assert(connect.includes('if (live) _recSessionSeen = true;'), 'live recording must mark the session flag');
assert(connect.includes("else if (!text.trim()) _recSessionSeen = false;"), 'clearing the transcript must reset the session flag');
assert(connect.includes("text.trim() && _recSessionSeen ? '\\uD83C\\uDFA4 Resume recording'"), 'Resume label no longer requires a real prior recording session');
assert(connect.includes("(_recSessionSeen ? 'Recording stopped. Resume to add more"), 'Recording-stopped hint no longer requires a real prior recording session');
assert(connect.includes("'Transcript added. Record to add more, or generate one note from every segment.'"), 'pasted-transcript hint missing');

/* ---- 2. assistant dictation mic ---- */
const micStart = connect.indexOf('b38 honest-mic');
assert(micStart >= 0, 'assistant honest-mic block missing');
const micEnd = connect.indexOf('instant local analytics in the SAME chat thread', micStart);
const mic = connect.slice(micStart, micEnd);
assert(mic.includes('$("mlsAsstPanel") || $("mls-assist-panel")'), 'assistant mic no longer targets the real in-app panel first');
assert(mic.includes('function asstMicToast(msg)'), 'assistant mic lost its visible error channel');
for (const state of ['"requesting"', '"listening"', '"blocked"', '"unavailable"', '"idle"']) {
  assert(mic.includes(state), `assistant mic state ${state} missing`);
}
assert(mic.includes('data-mic-state'), 'assistant mic state is not machine-readable');
assert(mic.includes('not-allowed') && mic.includes('service-not-allowed'), 'permission-blocked handling missing');
assert(mic.includes('audio-capture'), 'device-unavailable handling missing');
assert(mic.includes('click the assistant mic to retry'), 'retry-without-reload affordance missing');
assert(!/rec\.onerror = function \(\) \{ recOn = false; b\.classList\.remove\("rec"\); \};/.test(mic), 'silent error swallow is back');
assert(mic.includes('Voice dictation is not supported in this browser'), 'no-SpeechRecognition state missing');

/* ---- 3. bounded note generation with visible timeout ---- */
assert(app.includes("new Promise((_,reject)=>{ genTimeoutId=setTimeout(()=>reject(new Error('generation-timeout')),90000); })"), 'generation timeout race missing');
assert(app.includes('Note generation timed out after 90 seconds'), 'timeout error is not actionable/visible');
assert(app.includes("gb.disabled=false; gb.innerHTML='✨ Generate Note';"), 'generate button is not restored for retry');

console.log('PASS recording/AI visibility: honest resume state, stateful assistant mic on the real panel, bounded generation with visible timeout');
