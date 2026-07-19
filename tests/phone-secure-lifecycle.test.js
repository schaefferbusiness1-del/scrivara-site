'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const phone = fs.readFileSync(path.join(root, 'phone.html'), 'utf8');
const phoneUi = fs.readFileSync(path.join(root, 'feat_mls_force_full_phone.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'phone-manifest.json'), 'utf8'));

assert(!/maximum-scale|user-scalable/i.test(phone), 'phone recorder must preserve browser pinch zoom');
assert(phone.includes('<meta name="referrer" content="no-referrer">'), 'phone route needs a no-referrer document policy');
assert(phone.includes('<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">'), 'retired phone route must tell crawlers not to index or archive it');
assert(/Content-Security-Policy[^>]+default-src 'self'/.test(phone), 'phone route needs a self-denying CSP default');
assert(/Content-Security-Policy[^>]+connect-src https:\/\/scrivara-backend\.onrender\.com/.test(phone), 'phone CSP must allow only the reviewed recorder backend for network connections');
assert(!/Content-Security-Policy[^>]+unsafe-eval/.test(phone), 'phone CSP must not permit runtime code evaluation');
assert(!/new Function\s*\(/.test(phone), 'phone compatibility detection must remain compatible with a no-eval CSP');

const guardStart = phone.indexOf('__mlsPhoneGuard (b421)');
const guardEnd = phone.indexOf('</script>', guardStart);
assert(guardStart >= 0 && guardEnd > guardStart, 'secure phone lifecycle guard is missing');
const guard = phone.slice(phone.lastIndexOf('<script>', guardStart) + '<script>'.length, guardEnd);

assert(!/localStorage|sessionStorage|caches\.open/.test(guard), 'audio lifecycle must not use persistent browser storage or Cache Storage');
assert(!/createObjectStore|\.add\(\{[^}]*blob|\.put\(\{[^}]*blob/.test(guard), 'audio lifecycle must never create or write a durable audio record');
assert(!/createObjectURL|\.download\s*=|Download my audio|ensureDownloadBtn/.test(phone), 'bulk/recovery audio downloads must remain removed');
assert(guard.includes("LEGACY_DB='mlsPhoneRec'") && guard.includes("LEGACY_STORE='clips'"), 'the retired audio database must be named explicitly for cleanup');
assert(guard.includes("tx.objectStore(LEGACY_STORE).clear()"), 'legacy audio records must be cleared before database deletion');
assert(guard.includes('indexedDB.deleteDatabase(LEGACY_DB)'), 'the legacy audio database must be deleted');
assert(guard.indexOf('purgeLegacyAudio();') < guard.indexOf('window.uploadChunk=function'), 'legacy cleanup must run on page startup before uploads');
assert(/window\.finishRec\s*=\s*function\(\)[\s\S]*?clearVolatileAudio\(\);[\s\S]*?purgeLegacyAudio\(\);/.test(guard), 'Done must clear volatile retries and erase legacy storage');
assert(/addEventListener\('pagehide',endVolatileSession\)/.test(guard), 'page exit must clear volatile retries and retry legacy erasure');
assert(/addEventListener\('beforeunload',endVolatileSession\)/.test(guard), 'browser unload must clear volatile retries and retry legacy erasure');
assert(!/setInterval\s*\(/.test(guard), 'phone lifecycle must not retain permanent retry or mic polling intervals');

const fetchBlocks = [...phone.matchAll(/fetch\(BK\+'\/api\/mic\/'[\s\S]*?\n\s*\}\);/g)].map(match => match[0]);
assert(fetchBlocks.length >= 2, 'both the base and guarded upload paths must remain inspectable');
fetchBlocks.forEach((block, index) => {
  assert(block.includes("cache:'no-store'"), `audio upload path ${index + 1} must bypass HTTP caches`);
  assert(block.includes("credentials:'omit'"), `audio upload path ${index + 1} must not attach ambient cookies`);
  assert(block.includes("referrerPolicy:'no-referrer'"), `audio upload path ${index + 1} must suppress its referrer`);
});

const captureAt = phone.indexOf("var c=(hp('code')||hp('mic')||'').trim().toUpperCase()");
const scrubAt = phone.indexOf('if(location.search||location.hash) scrubPairingUrl();', captureAt);
const enterAt = phone.indexOf('enterRecorder(c);', captureAt);
assert(captureAt >= 0 && scrubAt > captureAt && enterAt > scrubAt, 'all query values must be scrubbed after code capture and before recorder entry');
assert(phone.includes("window.history.replaceState(null, document.title, location.pathname)"), 'URL scrub must drop both query and fragment rather than rewriting the pairing secret');
assert(!/qp\(['"](?:code|mic)['"]\)/.test(phone), 'legacy query pairing codes must fail closed instead of reaching recorder state');
assert(phone.includes('That old pairing link is no longer accepted.'), 'legacy query links need an explicit fresh-link recovery message');
assert(phone.includes("input.value=''"), 'manual pairing code must be removed from the input after capture');
assert(phone.includes("They are not saved to this phone's storage"), 'recorder footer must accurately describe volatile handling');
assert(phone.includes('held only in temporary memory while this page stays open'), 'offline UI must disclose the volatile retry boundary');
assert(phone.includes('was discarded from temporary memory'), 'failed final uploads must disclose discard instead of promising recovery');
assert.match(manifest.description, /short visit audio clips.+upload/i, 'phone install description must describe clip uploads without overstating streaming guarantees');
assert.strictEqual(manifest.theme_color, '#204034', 'installed phone recorder theme must match the live green recorder');
assert(phoneUi.includes('rel="noopener noreferrer"'), 'the pairing link must not send a referrer to the phone route');
assert(phoneUi.includes("clickEvent.isTrusted !== true"), 'trusted-click phone pairing gate must remain intact');
assert(app.includes('onclick="startPhoneMic(event)"'), 'base phone control must pass its real click event to the pairing owner');
const ownerStart = app.slice(app.indexOf('async function startPhoneMic(clickEvent)'), app.indexOf('async function pollPhoneMic()', app.indexOf('async function startPhoneMic(clickEvent)')));
assert(ownerStart.includes("if(!clickEvent || clickEvent.isTrusted!==true) return;"), 'base phone pairing owner must reject non-trusted and missing events');
assert(ownerStart.indexOf('clickEvent.isTrusted!==true') < ownerStart.indexOf("fetch(bkBase()+'/api/mic/start'"), 'trusted-click gate must precede pairing network work');
assert(phoneUi.includes('window.startPhoneMic(clickEvent)'), 'published phone UI module must preserve the original trusted event at the owner boundary');
const easyStart = connect.slice(connect.indexOf('function startPhoneMicFromEasy(clickEvent)'), connect.indexOf('function pasteTranscriptFromEasy()', connect.indexOf('function startPhoneMicFromEasy(clickEvent)')));
assert(easyStart.includes('clickEvent.isTrusted !== true'), 'Easy phone control must require its original trusted event');
assert(easyStart.includes('window.startPhoneMic(clickEvent)'), 'Easy phone control must pass the original trusted event through delayed UI reveal work');
assert(!easyStart.includes('pmBtn.click()'), 'Easy phone control must not synthesize an untrusted base-button click');
assert(app.includes("const link=location.origin+'/phone.html#code='+encodeURIComponent(phoneMicCode)"), 'desktop phone handoff must put the pairing code in a URL fragment');
assert(!app.includes("phone.html?code="), 'production app must not put a phone pairing code in an HTTP query');
assert(app.includes('id="phoneMicLink" href="#" target="_blank" rel="noopener noreferrer"'), 'desktop phone handoff link must suppress its referrer');
assert(phoneUi.includes('a[href*="phone.html#code="]'), 'phone UI mirror must resolve the fragment-based canonical link');
assert(!phoneUi.includes('phone.html?code='), 'phone UI mirror must not retain the query-based handoff');

const elements = {
  status: { textContent: '', style: {} },
  recErr: { textContent: '', style: {} },
  sent: { textContent: '', style: {} }
};
const listeners = {};
const timers = new Map();
let timerId = 0;
let openCalls = 0;
let clearCalls = 0;
let deleteCalls = 0;
let closeCalls = 0;
let finishCalls = 0;
let stopCalls = 0;
let fetchMode = 'ok';
const fetchCalls = [];

function fakeOpen() {
  openCalls++;
  const request = { transaction: { abort() {} } };
  setImmediate(() => {
    const database = {
      objectStoreNames: { contains(name) { return name === 'clips'; } },
      close() { closeCalls++; },
      transaction(name, mode) {
        assert.strictEqual(name, 'clips');
        assert.strictEqual(mode, 'readwrite');
        const tx = {
          objectStore() {
            return {
              clear() {
                clearCalls++;
                setImmediate(() => { if (tx.oncomplete) tx.oncomplete(); });
              }
            };
          }
        };
        return tx;
      }
    };
    if (request.onsuccess) { request.result = database; request.onsuccess(); }
  });
  return request;
}

function fakeDelete() {
  deleteCalls++;
  const request = {};
  setImmediate(() => { if (request.onsuccess) request.onsuccess(); });
  return request;
}

class FakeFileReader {
  constructor() { this.result = ''; this.onloadend = null; this.onerror = null; }
  readAsDataURL(blob) {
    this.result = `data:${blob.type || 'audio/webm'};base64,c3ludGhldGlj`;
    setImmediate(() => { if (this.onloadend) this.onloadend(); });
  }
}

const context = {
  Promise,
  Blob,
  FileReader: FakeFileReader,
  indexedDB: { open: fakeOpen, deleteDatabase: fakeDelete },
  setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
  clearTimeout(id) { timers.delete(id); },
  document: {
    visibilityState: 'visible',
    getElementById(id) { return elements[id] || null; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }
  },
  navigator: { mediaDevices: { getUserMedia() { return Promise.reject(new Error('not used')); } } },
  BK: 'https://scrivara-backend.onrender.com',
  code: 'SYN123',
  sentCount: 0,
  active: false,
  rec: null,
  stream: null,
  startSegment() {},
  startRec() { return Promise.resolve(); },
  stopRec() { stopCalls++; context.active = false; context.rec = null; context.stream = null; },
  finishRec() { finishCalls++; },
  fetch(url, options) {
    fetchCalls.push({ url, options });
    return fetchMode === 'ok'
      ? Promise.resolve({ ok: true, status: 200 })
      : Promise.reject(new Error('synthetic offline'));
  },
  console
};
context.window = context;
context.addEventListener = function addEventListener(type, fn) { (listeners[type] ||= []).push(fn); };
vm.createContext(context);
vm.runInContext(guard, context, { filename: 'phone-secure-guard.js' });

function flush() {
  return new Promise(resolve => setImmediate(() => setImmediate(() => setImmediate(resolve))));
}

(async () => {
  await flush();
  assert(openCalls >= 1 && clearCalls >= 1 && deleteCalls >= 1 && closeCalls >= 1, 'startup did not clear and delete the legacy audio database');

  context.uploadChunk(new Blob(['accepted'], { type: 'audio/webm' }), 'audio/webm');
  await flush();
  assert.strictEqual(context.__mlsPhoneGuard.pending(), 0, 'successful upload retained a volatile audio item');
  assert.strictEqual(context.sentCount, 1, 'successful upload was not counted');
  assert.strictEqual(fetchCalls[0].options.cache, 'no-store');
  assert.strictEqual(fetchCalls[0].options.credentials, 'omit');
  assert.strictEqual(fetchCalls[0].options.referrerPolicy, 'no-referrer');

  fetchMode = 'fail';
  context.uploadChunk(new Blob(['offline'], { type: 'audio/webm' }), 'audio/webm');
  await flush();
  assert.strictEqual(context.__mlsPhoneGuard.pending(), 1, 'failed active-session upload was not retained in the volatile retry queue');
  assert.match(elements.recErr.textContent, /temporary memory while this page stays open/i, 'offline status overstated volatile clip durability');
  assert([...timers.values()].some(timer => timer.ms === 6000), 'volatile failure did not schedule a bounded retry');

  const clearsBeforeFinish = clearCalls;
  const deletesBeforeFinish = deleteCalls;
  context.finishRec();
  await flush();
  assert.strictEqual(finishCalls, 1, 'secure lifecycle did not preserve the real Done behavior');
  assert.strictEqual(context.__mlsPhoneGuard.pending(), 0, 'Done retained failed audio in memory');
  assert(clearCalls > clearsBeforeFinish && deleteCalls > deletesBeforeFinish, 'Done did not clear and delete the legacy audio database again');

  context.uploadChunk(new Blob(['late-final'], { type: 'audio/webm' }), 'audio/webm');
  await flush();
  assert.strictEqual(context.__mlsPhoneGuard.pending(), 0, 'failed upload after Done was retained for recovery');
  assert.match(elements.recErr.textContent, /discarded from temporary memory/i, 'failed final upload did not disclose discard');

  assert(listeners.pagehide && listeners.pagehide.length === 1, 'pagehide cleanup listener missing');
  const deletesBeforePagehide = deleteCalls;
  context.active = true;
  context.rec = { state: 'recording' };
  listeners.pagehide[0]();
  await flush();
  assert(deleteCalls > deletesBeforePagehide, 'pagehide did not retry legacy database deletion');
  assert.strictEqual(stopCalls, 1, 'pagehide did not stop the active microphone lifecycle');

  console.log('PASS phone secure lifecycle: volatile-only audio, legacy erasure, no-store uploads, URL/privacy/accessibility contracts, and trusted-click pairing');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
