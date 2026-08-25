'use strict';

/* The main generation controller must reach the hosted fetch, not merely win a
 * UI Promise.race while leaving an unowned request running in the background. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '1pScribeFlow.html'), 'utf8');
function between(first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start + first.length);
  assert(start >= 0 && end > start, `missing transport boundary ${first}`);
  return source.slice(start, end);
}

const callOpenAI = between('async function callOpenAI(transcript,key,options)', '/* ---------------------------------------------------------\n   CORE AI TRANSPORT');
const aiCallRaw = between('async function aiCallRaw(sys,user,key,opts)', 'async function postChat(sys,user,key,extraOpts)');
const postChat = between('async function postChat(sys,user,key,extraOpts)', '/* Coerce any AI value');
assert(callOpenAI.includes('signal:options.signal'), 'callOpenAI does not hand its controller signal to postChat');
assert((aiCallRaw.match(/signal:opts\.signal/g) || []).length >= 3, 'one or more hosted/freeform/direct fetch lanes dropped the signal');

let fetchSignal = null;
const context = {
  console, Promise, String, Number, Object, Array, RegExp, JSON, Math, Date,
  AbortController,
  backendMode: () => true,
  bkBase: () => 'https://synthetic.invalid',
  bkToken: () => 'synthetic-token',
  getGenStyle: () => 'soap',
  getNoteModel: () => 'gpt-4o-mini',
  hostedNotePreferences: () => ({ noteFormat: 'flat_hpi_ros_exam_assessment_plan_v1' }),
  handle401() {},
  parseGenJSON: JSON.parse,
  fetch(url, init) {
    fetchSignal = init.signal;
    return new Promise((resolve, reject) => {
      if (init.signal.aborted) {
        const error = new Error('aborted'); error.name = 'AbortError'; reject(error); return;
      }
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
      }, { once: true });
    });
  }
};
context.window = context;
vm.createContext(context);
vm.runInContext(`${aiCallRaw}\n${postChat}\nthis.postChat=postChat;`, context, { filename: 'generation-transport.js' });

(async function run() {
  const controller = new AbortController();
  const pending = context.postChat('system', 'TODAY_TRANSCRIPT_BEGIN\nsynthetic visit\nTODAY_TRANSCRIPT_END', '', { signal: controller.signal });
  await Promise.resolve();
  assert.strictEqual(fetchSignal, controller.signal, 'postChat/aiCallRaw replaced or dropped the main controller signal');
  controller.abort('generation-timeout');
  await assert.rejects(pending, (error) => error && error.name === 'AbortError');
  assert.strictEqual(fetchSignal.aborted, true, 'hosted fetch signal did not abort');
  console.log('PASS generation abort transport: callOpenAI → postChat → aiCallRaw → hosted fetch retains one AbortSignal');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
