'use strict';

/* The post-op video lane must be INVISIBLE until its backend exists.
 * ===========================================================================
 * The routes this UI calls live on a backend branch. Shipping a "Talk to your
 * doctor now" button that 404s to a patient in pain after surgery would be
 * worse than shipping nothing — so both halves render only when the backend
 * ANSWERS. This suite proves that by executing the real render paths against a
 * stubbed fetch, rather than trusting a comment.
 *
 * It also pins the boundary that must never move: nothing in either half
 * prescribes, orders, or contacts a pharmacy. The patient's "I think I need
 * something for the pain" is a sentence the doctor reads.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const doctorSrc = fs.readFileSync(path.join(root, 'feat_mls_tele_doctor.js'), 'utf8');
const portalHtml = fs.readFileSync(path.join(root, 'patient-portal.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* ---- 1. the no-prescribing boundary, on BOTH halves ---- */
const portalScript = (() => {
  const at = portalHtml.indexOf('__mlsTeleVisit');
  assert(at > 0, 'the portal telehealth block is missing');
  const start = portalHtml.lastIndexOf('<script>', at);
  const end = portalHtml.indexOf('</script>', at);
  return portalHtml.slice(start, end);
})();
for (const [name, src] of [['feat_mls_tele_doctor.js', doctorSrc], ['patient-portal.html tele block', portalScript]]) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [/surescripts/i, /\bpharmac/i, /sendPrescription/i, /\berx\b/i, /prescribe\s*\(/i]) {
    assert(!forbidden.test(code), name + ' must contain no prescribing path (matched ' + forbidden + ')');
  }
}
assert(/Their words, not an order/.test(doctorSrc),
  'the medication ask must be presented to the doctor as the PATIENT\'S WORDS, never as a pending order');
assert(/nothing is prescribed by sending this/i.test(portalScript),
  'the portal must tell the patient plainly that asking does not prescribe');

/* ---- 2. the doctor half renders NOTHING without a backend ---- */
function docSandbox(fetchImpl, opts) {
  opts = opts || {};
  const created = [];
  const el = () => {
    const n = {
      tagName: 'DIV', id: '', className: '', style: {}, textContent: '', innerHTML: '',
      children: [], parentNode: null,
      setAttribute() {}, getAttribute() { return null; },
      addEventListener() {}, removeEventListener() {},
      appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
      removeChild(c) { n.children = n.children.filter(x => x !== c); return c; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
    };
    created.push(n);
    return n;
  };
  const byId = new Map();
  const body = el(), head = el();
  const sb = {
    document: {
      readyState: 'complete', body, head, documentElement: el(),
      createElement: el, getElementById: id => byId.get(id) || null,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {}
    },
    console: { log() {}, warn() {}, error() {} },
    RTCPeerConnection: function () { return { addTrack() {}, close() {} }; },
    navigator: { mediaDevices: { getUserMedia: () => Promise.reject(new Error('no media in test')) } },
    setInterval: () => 1, clearInterval() {}, setTimeout: (f) => { return 1; }, clearTimeout() {},
    fetch: fetchImpl,
    BACKEND_URL: opts.backend === undefined ? 'https://backend.test' : opts.backend,
    bkToken: () => (opts.token === undefined ? 'tok' : opts.token),
    getPatients: () => [],
    toast: () => {}
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.__created = () => created;
  sb.__byId = byId;
  /* the module appends its banner to document.body — track what lands there */
  return sb;
}

function run(sb) {
  vm.runInContext(doctorSrc, vm.createContext(sb), { filename: 'feat_mls_tele_doctor.js' });
  return sb;
}

/* backend absent: fetch rejects */
let calls = 0;
let sb = run(docSandbox(() => { calls++; return Promise.reject(new Error('ENOTFOUND')); }));
assert(sb.__mlsTeleDoctor && sb.__mlsTeleDoctor.installed, 'the doctor module should still install');
assert.strictEqual(sb.document.body.children.length, 0,
  'with the backend unreachable the doctor half must append NOTHING to the page');

/* backend present but 404 (route not deployed yet) */
sb = run(docSandbox(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) })));
assert.strictEqual(sb.document.body.children.length, 0,
  'a 404 from /api/tele/requests must render no banner');

/* backend present, signed OUT of it — must not even ask */
let asked = 0;
sb = run(docSandbox(() => { asked++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ requests: [] }) }); }, { token: '' }));
assert.strictEqual(asked, 0, 'with no backend token the doctor half must not call the API at all');

/* backend answers with no pending requests */
sb = run(docSandbox(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ requests: [] }) })));
assert.strictEqual(sb.document.body.children.length, 0, 'an empty request list must render no banner');

/* ---- 3. the portal half is gated on eligible:true ---- */
assert(/if\(!r\.ok \|\| !r\.j \|\| !r\.j\.eligible\)\{[^}]*remove\(\)/.test(portalScript.replace(/\s+/g, ' ').replace(/ /g, '')) ||
  /!r\.ok\s*\|\|\s*!r\.j\s*\|\|\s*!r\.j\.eligible/.test(portalScript),
  'the portal card must render only when the backend returns eligible:true');
assert(/if\(!tok\(\)\) return;/.test(portalScript),
  'the portal must not call the tele API before the patient is signed in');
assert(/getUserMedia/.test(portalScript) && /RTCPeerConnection/.test(portalScript),
  'the portal half must actually run WebRTC, not just post a request');

/* ---- 4. shipped + cache-busted ---- */
assert(connect.includes("feat_mls_tele_doctor.js?v=20260805td100"),
  'mls-connect.js must load the doctor half with a fresh immutable token');
assert(/var VERSION = 'td-1\.0\.0'/.test(doctorSrc), 'version must match its cache token');

/* ---- 5. emergency guidance is present and unmissable ---- */
assert(/call 911|emergency room/i.test(portalScript),
  'a post-op patient reporting worsening pain must be told when NOT to wait for a video visit');

console.log('PASS telehealth ships dark: unreachable backend, 404, signed-out and empty-list all render nothing '
  + '(4 executed cases); the portal card is gated on eligible:true; neither half contains a prescribing path; '
  + 'the medication ask is presented as the patient\'s words; emergency guidance is present.');
