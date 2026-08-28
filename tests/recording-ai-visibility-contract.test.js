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
/* gentimeout-1.0.0 (2026-08-28): this pinned one exact expression -
     new Promise((_,reject)=>{ genTimeoutId=setTimeout(()=>reject(new Error('generation-timeout')),90000); })
   - and has been RED on main since that race was REPLACED by something
   strictly better, _mlsAwaitGeneration(run, promise, timeoutMs, reason). The
   old race only rejected: the underlying request kept running, the timer was
   never cleared, and nothing linked the timeout to the run's AbortController.
   The replacement aborts the real request, clears its timer, settles once, and
   honours an already-aborted signal. Keeping the literal would have meant
   asking for the weaker mechanism back.
   So this now proves the PROPERTY, by EXECUTING the shipped function rather
   than grepping for its shape. A generation that hangs must end, must end
   loudly, and must not leave a request or a timer running behind it.
   Declared as a function and invoked at the very end of this file: a top-level
   await here makes node unable to decide whether this suite is CommonJS or an
   ES module, and it refuses to run at all. */
async function __checkBoundedGeneration() {
  const vm = require('vm');
  const start = app.indexOf('function _mlsAwaitGeneration(run,promise,timeoutMs,timeoutReason){');
  assert(start >= 0, 'the bounded-generation helper _mlsAwaitGeneration is gone - note generation is no longer bounded at all');
  let i = app.indexOf('{', start), depth = 0, end = -1;
  for (; i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert(end > start, 'could not brace-match _mlsAwaitGeneration');

  const runOne = async (opts) => {
    const timers = { set: 0, cleared: 0 };
    const sandbox = {
      setTimeout(fn, ms) { timers.set++; return { fn, ms, id: timers.set }; },
      clearTimeout() { timers.cleared++; },
      Promise, Error, String,
      _mlsGenerationAbortError(code) { const e = new Error(String(code)); e.mlsAbortCode = String(code); return e; }
    };
    vm.createContext(sandbox);
    vm.runInContext(app.slice(start, end) + '\nthis.__fn=_mlsAwaitGeneration;', sandbox);

    const listeners = [];
    let aborted = null;
    const run = {
      abortReason: '',
      controller: {
        abort(reason) { aborted = reason; listeners.forEach((fn) => fn()); },
        signal: {
          aborted: !!opts.preAborted,
          addEventListener(_, fn) { listeners.push(fn); },
          removeEventListener() {}
        }
      }
    };
    let armed = null;
    const patched = { ...sandbox, setTimeout(fn, ms) { timers.set++; armed = fn; return { ms }; } };
    Object.assign(sandbox, { setTimeout: patched.setTimeout });

    const p = sandbox.__fn(run, opts.promise, 90000, 'generation-timeout');
    if (opts.fireTimeout && armed) armed();
    let value = null, error = null;
    try { value = await p; } catch (e) { error = e; }
    return { value, error, timers, aborted, run };
  };

  /* 1. the happy path still resolves, and does not leak its timer */
  {
    const r = await runOne({ promise: Promise.resolve({ note: 'ok' }) });
    assert.strictEqual(r.error, null, 'a generation that finished in time was rejected anyway');
    assert.deepStrictEqual(r.value, { note: 'ok' }, 'the generated result did not survive the bounded wrapper');
    assert.strictEqual(r.timers.cleared, 1, 'the timeout timer was not cleared after a successful generation - it leaks and can fire later');
  }

  /* 2. THE DEFECT THIS EXISTS FOR: a generation that never settles must end,
     with a reason the surface can name - and it must ABORT the request, not
     merely stop waiting for it. */
  {
    const r = await runOne({ promise: new Promise(() => {}), fireTimeout: true });
    assert(r.error, 'a generation that never settled hung forever - nothing ended it');
    assert.strictEqual(r.run.abortReason, 'generation-timeout',
      'the timeout did not stamp a reason, so the surface cannot tell the doctor WHY it stopped');
    /* This proves the helper CALLS abort with the reason. Whether the browser
       then tears down the in-flight fetch is the platform's job and cannot be
       observed from here - the point is that the old race never even asked. */
    assert.strictEqual(r.aborted, 'generation-timeout',
      'the timeout rejected without calling abort() on the run controller - the old race did exactly this, ' +
      'leaving the request with nothing to cancel it after the doctor was told it had stopped');
    assert.strictEqual(r.timers.cleared, 1, 'the timeout path did not clear its own timer');
  }

  /* 3. an already-aborted run never waits at all */
  {
    const r = await runOne({ promise: new Promise(() => {}), preAborted: true });
    assert(r.error, 'an already-aborted generation still waited for a promise that will never settle');
  }
}
/* ...and the doctor is told, in words, with the transcript preserved. */
assert(app.includes("}else if(abortCode==='generation-timeout'){"),
  'the generation-timeout outcome has no branch of its own, so a timeout would be reported as some other failure');
assert(/Note generation timed out after 90 seconds\. Your transcript is safe/.test(app),
  'the timeout message no longer tells the doctor the transcript is safe - that sentence is why a timeout is not a data-loss event');
assert(/if\(Number\.isFinite\(n\)&&n>=5&&n<=fallback\)return n;/.test(app),
  'the generation timeout override is no longer clamped to SHORTENING only - a runtime value could turn a bounded generation back into an unbounded one');
assert(app.includes('Note generation timed out after 90 seconds'), 'timeout error is not actionable/visible');
/* genbtn-1.0.0 (2026-08-28): this pinned the restore character for character,
   down to the space after the semicolon, and broke when the line gained an
   OWNERSHIP GUARD it needed:
     was  gb.disabled=false; gb.innerHTML='...';
     now  if(_mlsActiveGeneration===run&&gb){gb.disabled=false;gb.innerHTML='...';}
   Without that guard a superseded generation re-enables the button while a
   NEWER one is still running - a stale run disarming the live one, which is the
   arm-inside-the-mutex mistake. The property (the doctor always gets the button
   back) is unchanged; the mechanism got safer, and the literal punished it.
   Pinned as the property, on EVERY restore site rather than one of them. */
{
  const restores = [...app.matchAll(/gb\.disabled\s*=\s*false\s*;\s*gb\.innerHTML\s*=\s*'[^']*Generate Note'/g)];
  assert(restores.length >= 2,
    'the generate button is restored from fewer than both settle paths (' + restores.length + ') - one of success/failure would leave it stuck on "Generating…" forever');
  for (const m of restores) {
    const before = app.slice(Math.max(0, m.index - 90), m.index);
    assert(/_mlsActiveGeneration\s*===\s*run\s*&&\s*gb/.test(before),
      'a generate-button restore is not guarded by run ownership, so a SUPERSEDED generation can re-enable the button while a newer one is still running');
  }
  assert(/if\(gb\)\{gb\.disabled=true;gb\.innerHTML='<span class="spin"><\/span> Generating…';\}/.test(app),
    'the generate button no longer shows a working state when a generation starts');
}

__checkBoundedGeneration().then(() => {
  console.log('PASS recording/AI visibility: honest resume state, stateful assistant mic on the real panel, and bounded generation proven by EXECUTING the shipped waiter - a hung generation ends, stamps generation-timeout, CALLS controller.abort() rather than merely giving up on it (whether the browser then cancels the in-flight fetch is an integration concern this unit cannot see), clears its timer on every path, and tells the doctor the transcript is safe');
}, (error) => { console.error(error); process.exit(1); });
