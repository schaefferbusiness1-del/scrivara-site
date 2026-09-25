'use strict';

/* phone-upload-guard-rules  (micfix-1.2.0, 2026-09-25)
 * ============================================================================
 * The upload guard of phone.html (the __mlsPhoneGuard script) in a VM, with a
 * fake fetch and fake timers, so the exact numbers can be read off.
 *
 *  P1  Until MLS has answered a clip for a code with dedupe:true, one upload
 *      attempt may take 330 s + 1 s per 16 KB. Today's server gives no such
 *      marker, can take up to 300 s, holds every later clip's answer behind a
 *      slow one, and still adds a clip whose sender gave up; so an attempt is
 *      never given up and re-sent there. After the marker an attempt may take
 *      40 s + 1 s per 16 KB, capped at 330 s. The marker counts only for the
 *      code it came with.
 *  P2  A service-wide refusal (today's 502 ai-quota, ai-auth,
 *      ai-model-unavailable) never stops recording. The clips wait, a new clip
 *      waits behind them without being sent (also while the waiting clips are
 *      sent afterwards), and the first one is retried after 6, 12, 24, 48,
 *      60, 60 s until MLS takes a clip again. 402 and 403 (this account)
 *      still stop recording and hold the clips.
 *  P3  clipIds come from crypto.getRandomValues. On an old phone whose
 *      crypto.randomUUID is the compat layer's Math.random stand-in, two page
 *      loads at the same moment never produce the same clipId.
 *
 * Run: node tests/phone-upload-guard-rules.test.js
 *      ONLY=P2 node tests/phone-upload-guard-rules.test.js   (one part)
 *      PHONE_HTML=<file> reads another copy of phone.html (red/green runs).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const phone = fs.readFileSync(process.env.PHONE_HTML ? path.resolve(process.env.PHONE_HTML) : path.join(ROOT, 'phone.html'), 'utf8');
const guardStart = phone.indexOf('__mlsPhoneGuard (b421)');
assert(guardStart >= 0, 'the phone upload guard is missing');
const guard = phone.slice(phone.lastIndexOf('<script>', guardStart) + '<script>'.length, phone.indexOf('</script>', guardStart));
/* The compat layer's stand-in for crypto.randomUUID on old browsers, as
   shipped in phone.html's first script. */
const polyfill = phone.match(/def\(window\.crypto, 'randomUUID', (function \(\) \{[\s\S]*?\n  \})\);/);
assert(polyfill, 'the randomUUID stand-in of the compat layer was not found');

let checks = 0;
function ok(cond, msg) { checks++; assert(cond, msg); }
function eq(a, b, msg) { checks++; assert.deepStrictEqual(a, b, msg); }
const flush = () => new Promise(resolve => setImmediate(() => setImmediate(() => setImmediate(resolve))));

class FakeFileReader {
  constructor() { this.result = ''; this.onloadend = null; this.onerror = null; }
  readAsDataURL(blob) {
    this.result = `data:${blob.type || 'audio/webm'};base64,c3ludGhldGlj`;
    setImmediate(() => { if (this.onloadend) this.onloadend(); });
  }
}

/* One page load of the guard. answer(post) returns the reply for one upload:
   'hang' (never settles), {status, json}, or a promise of {status, json}. */
function boot({ answer, crypto, mathRandom } = {}) {
  const el = () => ({ textContent: '', style: {} });
  const elements = { status: el(), recErr: el(), waitErr: el(), sent: el(), linkPill: el(), recodeBtn: el() };
  const timers = new Map();
  let timerId = 0;
  const posts = [];
  const page = { stops: 0 };
  const context = {
    Promise, Blob, Uint8Array, FileReader: FakeFileReader, console,
    indexedDB: { open() { const r = {}; setImmediate(() => r.onerror && r.onerror()); return r; }, deleteDatabase() { const r = {}; setImmediate(() => r.onsuccess && r.onsuccess()); return r; } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: { visibilityState: 'visible', getElementById: id => elements[id] || null, addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia() { return Promise.reject(new Error('not used')); } } },
    AbortController,
    BK: 'https://scrivara-backend.onrender.com',
    code: 'CODE01', sentCount: 0, active: true, rec: { state: 'recording' }, stream: null,
    startSegment() {}, startRec() { return Promise.resolve(); }, finishRec() {},
    stopRec() { page.stops++; context.active = false; context.rec = null; },
    fetch(url, options) {
      const body = JSON.parse(options.body);
      const post = { code: decodeURIComponent(url.split('/api/mic/')[1].split('/')[0]), clipId: body.clipId, t: body.t, tag: body.mimetype };
      posts.push(post);
      const a = answer ? answer(post) : { status: 200, json: { ok: true, added: 5 } };
      if (a === 'hang') return new Promise(() => {});
      return Promise.resolve(a).then(r => ({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json }));
    }
  };
  if (crypto) context.crypto = crypto;
  context.window = context;
  context.addEventListener = () => {};
  vm.createContext(context);
  if (mathRandom) vm.runInContext(`Math.random = function () { return ${mathRandom}; };`, context);
  if (crypto && crypto.__polyfill) vm.runInContext(`crypto.randomUUID = ${polyfill[1]};`, context);
  vm.runInContext(guard, context, { filename: 'phone-upload-guard.js' });
  const clip = (bytes, tag, code) => context.uploadChunk(new Blob(['x'.repeat(bytes)], { type: 'audio/webm' }), tag || 'audio/webm', 1790000000000 + posts.length, code || 'CODE01');
  const attemptTimers = () => [...timers.values()].filter(t => t.ms > 2000).map(t => t.ms);
  const retryTimers = () => [...timers.entries()].filter(([, t]) => t.ms >= 6000 && t.ms <= 60000);
  return { context, elements, timers, posts, page, clip, attemptTimers, retryTimers };
}
const realCrypto = () => ({ getRandomValues: a => webcrypto.getRandomValues(a), randomUUID: () => webcrypto.randomUUID() });

async function deadlineGatedOnMarker() {
  const replies = [];
  const g = boot({ crypto: realCrypto(), answer: () => replies.shift() || 'hang' });
  /* 40,000 bytes = 3 blocks of 16 KB. Today's server: no marker yet. */
  g.clip(40000);
  await flush();
  eq(g.attemptTimers(), [333000], `P1: before MLS has shown it dedupes, an attempt must wait 330 s + 1 s per 16 KB (got ${JSON.stringify(g.attemptTimers())} ms)`);
  g.timers.clear();
  /* A 12 MB clip: the wait before the marker is not capped at 330 s. */
  g.clip(12 * 1024 * 1024);
  await flush();
  eq(g.attemptTimers(), [330000 + 768000], 'P1: before the marker, a large clip must get 330 s + 1 s per 16 KB');
  g.timers.clear();
  /* A 2xx without the marker (today's server) changes nothing. */
  replies.push({ status: 200, json: { ok: true, added: 12 } });
  g.clip(100);
  await flush();
  g.timers.clear();
  g.clip(40000);
  await flush();
  eq(g.attemptTimers(), [333000], 'P1: a 2xx without dedupe:true was taken as the marker');
  g.timers.clear();
  /* The marker for CODE01. */
  replies.push({ status: 200, json: { ok: true, added: 12, dedupe: true, clipId: 'echo' } });
  g.clip(100);
  await flush();
  g.timers.clear();
  g.clip(40000);
  await flush();
  eq(g.attemptTimers(), [43000], 'P1: after the marker, an attempt must be given up after 40 s + 1 s per 16 KB');
  g.timers.clear();
  g.clip(12 * 1024 * 1024);
  await flush();
  eq(g.attemptTimers(), [330000], 'P1: after the marker, the attempt time must stay capped at 330 s');
  g.timers.clear();
  /* Another code has not shown the marker. */
  g.clip(40000, 'audio/webm', 'CODE02');
  await flush();
  eq(g.attemptTimers(), [333000], 'P1: the marker of one code was used for another code');
}

async function serviceWideKeepsRecording() {
  let mode = 'quota';
  const gates = [];
  const g = boot({ crypto: realCrypto(), answer: () => (mode === 'quota'
    ? { status: 502, json: { error: 'The audio could not be transcribed. The AI provider reports this account is out of credit or has hit its quota.', code: 'ai-quota', retryable: false } }
    : new Promise(resolve => gates.push(() => resolve({ status: 200, json: { ok: true, added: 12, dedupe: true } })))) });
  g.clip(100, 'clip-1');
  await flush();
  eq(g.page.stops, 0, 'P2: a service-wide refusal stopped recording');
  ok(g.context.active === true, 'P2: recording is no longer active after a service-wide refusal');
  eq(g.context.__mlsPhoneGuard.pending(), 1, 'P2: the refused clip is not kept in temporary memory');
  eq(g.elements.status.textContent, '● Recording… — MLS cannot add clips right now; 1 waiting, retrying', 'P2: the status does not say MLS cannot add clips and that the phone retries');
  eq(g.elements.status.style.color, '#ffdcae', 'P2: the outage status is not amber');
  ok(/cannot transcribe audio right now/.test(g.elements.recErr.textContent) && /keeps recording/.test(g.elements.recErr.textContent) && /temporary memory/.test(g.elements.recErr.textContent), `P2: the error line does not explain the outage: ${JSON.stringify(g.elements.recErr.textContent)}`);
  ok(/retrying/.test(g.elements.waitErr.textContent) && !/paused/.test(g.elements.waitErr.textContent), `P2: the waiting line does not say the clips are retried: ${JSON.stringify(g.elements.waitErr.textContent)}`);
  /* A clip recorded during the outage waits behind the first, unsent. */
  g.clip(100, 'clip-2');
  g.clip(100, 'clip-3');
  await flush();
  eq(g.posts.length, 1, 'P2: a clip recorded during the outage was sent ahead of the clips waiting before it');
  eq(g.elements.status.textContent, '● Recording… — MLS cannot add clips right now; 3 waiting, retrying', 'P2: the waiting count in the status did not follow the queue');
  const waits = [];
  for (let i = 0; i < 6; i++) {
    const due = g.retryTimers();
    eq(due.length, 1, `P2: expected exactly one retry scheduled during the outage, got ${due.length}`);
    waits.push(due[0][1].ms);
    g.timers.delete(due[0][0]);
    due[0][1].fn();
    await flush();
    await flush();
  }
  eq(waits, [6000, 12000, 24000, 48000, 60000, 60000], 'P2: the retries during an outage do not back off from 6 s to 60 s');
  eq(g.posts.map(p => p.tag), ['clip-1', 'clip-1', 'clip-1', 'clip-1', 'clip-1', 'clip-1', 'clip-1'], 'P2: the outage retries did not keep to the first waiting clip');
  eq(g.page.stops, 0, 'P2: the retries stopped recording');
  mode = 'ok';
  const due = g.retryTimers();
  g.timers.delete(due[0][0]);
  due[0][1].fn();
  await flush();
  gates.shift()();
  await flush();
  await flush();
  /* clip-1 is added and clip-2 is on its way; a clip recorded now must wait
     behind clip-3, which has not been sent yet. */
  eq(g.posts.slice(-2).map(p => p.tag), ['clip-1', 'clip-2'], 'P2: once MLS took clips again, the waiting clips were not sent in the order they were recorded');
  g.clip(100, 'clip-4');
  await flush();
  for (let i = 0; i < 3 && gates.length; i++) { gates.shift()(); await flush(); await flush(); }
  eq(g.posts.slice(-4).map(p => p.tag), ['clip-1', 'clip-2', 'clip-3', 'clip-4'], 'P2: a clip recorded while the waiting clips were sent went ahead of them');
  eq(g.context.__mlsPhoneGuard.pending(), 0, 'P2: clips still wait after MLS took clips again');
  eq(g.elements.status.textContent, '● Recording… talk normally', 'P2: the status did not return to normal once MLS took clips again');
  ok(!/cannot transcribe/.test(g.elements.recErr.textContent), 'P2: the outage note outlived the outage');
  eq(g.retryTimers().length, 0, 'P2: a retry is still scheduled after the outage');
  /* Once the waiting clips are all sent, a new clip goes out at once again. */
  g.clip(100, 'clip-5');
  await flush();
  eq(g.posts[g.posts.length - 1].tag, 'clip-5', 'P2: after the outage a new clip was not sent at once');

  /* Two first tries are on their way when MLS stops transcribing; the second
     is refused only after a newer clip has started to wait. It still goes
     in front of that newer clip. */
  const quota = { status: 502, json: { error: 'The audio could not be transcribed.', code: 'ai-quota', retryable: false } };
  let late = [];
  const k = boot({ crypto: realCrypto(), answer: p => (late ? new Promise(resolve => late.push(resolve)) : (mode === 'quota' ? quota : { status: 200, json: { ok: true, added: 12, dedupe: true } })) });
  mode = 'quota';
  k.clip(100, 'clip-A');
  k.clip(100, 'clip-B');
  await flush();
  const [answerA, answerB] = late;
  late = null;
  answerA(quota);
  await flush();
  k.clip(100, 'clip-C');
  await flush();
  answerB(quota);
  await flush();
  mode = 'ok';
  const kdue = k.retryTimers();
  k.timers.delete(kdue[0][0]);
  kdue[0][1].fn();
  for (let i = 0; i < 4; i++) await flush();
  eq(k.posts.slice(2).map(p => p.tag), ['clip-A', 'clip-B', 'clip-C'], 'P2: a clip refused late was sent after a newer clip');

  for (const [status, json] of [[402, { error: 'no_access', code: 'NO_ACCESS', retryable: false }], [403, { error: 'Forbidden' }]]) {
    const h = boot({ crypto: realCrypto(), answer: () => ({ status, json }) });
    h.clip(100);
    await flush();
    eq(h.page.stops, 1, `P2: a ${status} for this account did not stop recording`);
    eq(h.context.__mlsPhoneGuard.pending(), 1, `P2: a ${status} did not hold the clip`);
    eq(h.retryTimers().length, 0, `P2: a ${status} is retried on its own`);
  }
}

async function clipIdsFromGetRandomValues() {
  let drawn = 0;
  const oldPhone = () => ({ __polyfill: true, getRandomValues: a => { drawn++; return webcrypto.getRandomValues(a); } });
  /* Two loads of the page (a reload), at the same moment, on an old phone
     whose Math.random is weak: the stand-in randomUUID repeats itself. */
  const first = boot({ crypto: oldPhone(), mathRandom: '0.5' });
  first.clip(100);
  first.clip(100);
  await flush();
  const second = boot({ crypto: oldPhone(), mathRandom: '0.5' });
  second.clip(100);
  await flush();
  const ids = [...first.posts, ...second.posts].map(p => p.clipId);
  eq(ids.length, 3, 'P3: expected three uploads');
  ok(ids.every(id => typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)), `P3: a clipId is not 128 random bits as hex: ${JSON.stringify(ids)}`);
  eq(new Set(ids).size, ids.length, `P3: a clipId was used twice across a reload: ${JSON.stringify(ids)}`);
  ok(drawn >= ids.length, `P3: the clipIds were not drawn from crypto.getRandomValues (${drawn} draws for ${ids.length} clips)`);
}

(async () => {
  const only = String(process.env.ONLY || '').split(',').filter(Boolean);
  for (const [name, run] of [['P1', deadlineGatedOnMarker], ['P2', serviceWideKeepsRecording], ['P3', clipIdsFromGetRandomValues]]) {
    if (!only.length || only.includes(name)) await run();
  }
  console.log(`PASS phone upload guard rules (${checks} checks): an attempt waits 330 s + 1 s/16 KB until MLS shows dedupe:true for that code, then 40 s + 1 s/16 KB capped at 330 s; a service-wide refusal keeps recording, queues new clips behind the waiting ones and retries after 6/12/24/48/60/60 s, while 402/403 still stop and hold; clipIds are 128 bits from crypto.getRandomValues and never repeat across a reload`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
