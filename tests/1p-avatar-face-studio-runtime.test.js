'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const file = path.join(root, '1p-feat_mls_avatar_face.js');
const source = fs.readFileSync(file, 'utf8');
let passed = 0;
function ok(value, message) { assert.ok(value, message); passed++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); passed++; }

function node(tag) {
  return {
    tagName: String(tag || '').toUpperCase(),
    id: '', className: '', textContent: '', innerHTML: '', parentNode: null,
    children: [], style: {}, attributes: {},
    classList: { add() {}, remove() {} },
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); },
    getAttribute(k) { return this.attributes[k] || null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; },
    insertBefore(child, before) { const i = this.children.indexOf(before); child.parentNode = this; if (i < 0) this.children.push(child); else this.children.splice(i, 0, child); return child; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
  };
}

const head = node('head');
const documentElement = node('html');
const currentScript = node('script');
currentScript.setAttribute('data-mls-install-token', 'face-test-token');
const document = {
  head, documentElement, currentScript,
  createElement: node,
  getElementById() { return null; },
  querySelectorAll() { return []; }
};
const window = {
  addEventListener() {}, removeEventListener() {},
  __MLS_P1_PREVIEW: { enabled: true },
  __mlsP1AvatarFaceLoader: { installed: true, version: 'p1-face-studio-1.0.1', installToken: 'face-test-token' },
  __mlsAvatarFaceStudio: null
};
class MutationObserver {
  constructor(fn) { this.fn = fn; }
  observe() { this.observing = true; }
  disconnect() { this.observing = false; }
}
const context = vm.createContext({ window, document, MutationObserver, setTimeout() {}, clearTimeout() {}, console });
vm.runInContext(source, context, { filename: file });

const api = window.__mlsAvatarFaceStudio;
ok(api && api.installed === true, 'preview face studio did not install');
eq(api.version, 'p1-face-studio-1.0.1', 'unexpected studio version');
eq(api.installToken, 'face-test-token', 'studio did not bind to the exact loader installation');
ok(typeof api.summarizeReceipt === 'function', 'PHI-free match summarizer is unavailable');
ok(typeof api.reconcile === 'function' && typeof api.revert === 'function', 'studio lifecycle API is incomplete');

let s = api.summarizeReceipt({ claimed: 12, refused: 2, examined: 14, faceW: 154, grid: 256 });
eq(s.level, 'strong', 'a well-framed 12-of-14 match is not strong');
ok(s.score >= 80 && s.score <= 100, 'strong score is outside its honest range');
ok(/12 of 14/.test(s.detail) && /2 left unchanged/.test(s.detail), 'strong summary hides refusals');

s = api.summarizeReceipt({ claimed: 5, refused: 9, examined: 14, faceW: 108, grid: 256 });
eq(s.level, 'usable', 'a correctly framed partial match is not presented as a useful starting point');
ok(/9 left unchanged/.test(s.detail), 'partial match implies that refused fields changed');

const photo = api.summarizeReceipt({ claimed: 8, refused: 6, examined: 14, faceW: 120, grid: 256 });
const illustration = api.summarizeReceipt({ claimed: 8, refused: 6, examined: 14, faceW: 120, grid: 256, fromIllustration: true });
ok(illustration.score < photo.score, 'a manufactured illustration is scored like a full-quality photo');
eq(illustration.level, 'limited', 'illustration fallback is overclaimed');

s = api.summarizeReceipt({ claimed: 99, refused: -4, examined: 14, faceW: 9999, grid: 256 });
eq(s.score, 100, 'confidence is not bounded at 100');
ok(!/undefined|NaN/.test(JSON.stringify(s)), 'malformed counts leak into visible copy');
s = api.summarizeReceipt(null);
eq(s.score, 0, 'empty receipt must not receive confidence points');
eq(s.level, 'limited', 'empty receipt is not limited');
ok(/No appearance details were changed/.test(s.detail), 'empty receipt pretends a match occurred');

ok(source.includes('This is the exact portrait patients see'), 'photo mode does not describe the actual patient-facing portrait');
ok(source.includes('data-face-preview-kind'), 'studio copy cannot distinguish the photo from its fallback');
ok(source.includes('makes eye contact, changes expression, and moves its mouth with the selected voice'), 'animated mode no longer explains speaking compatibility');
ok(source.includes('aria-live') && source.includes('aria-atomic'), 'match result is not announced accessibly');
ok(source.includes('prefers-reduced-motion'), 'studio added motion without a reduced-motion rule');
ok(source.includes("typeof api.revert !== 'function'") && source.includes('observer.disconnect()'), 'hot reload cannot retire or fail closed on the old studio owner');
ok(source.includes('restoreAttrs(row.note, row.noteAttrs)') && source.includes('restoreAttrs(row.matchButton, row.matchAttrs)'),
  'hot reload leaves accessibility changes on core-owned controls');
ok(source.includes('timers.indexOf(timer)') && source.includes('clearPollTimers()'), 'bounded receipt polling survives revert');
ok(source.includes('Number(latest.at || 0) > before'), 'a stale prior match receipt can paint a new run');
ok(source.includes('help.__mlsP1FaceCopy === copyKey'), 'mutation reconciliation can rewrite its own copy forever');
ok(!/fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/.test(source), 'presentation shell gained network or storage ownership');
ok(!/athena|extension|chrome\.runtime/i.test(source), 'face studio crosses into Athena or extension ownership');
ok(!source.includes('patientExternalId') && !source.includes('getPatients'), 'face studio reads patient identity');

/* Withdrawing the preview marker makes all presentation actions inert, but it
   cannot strand the exact installation when its controller tears it down. */
window.__MLS_P1_PREVIEW.enabled = false;
eq(api.reconcile(), false, 'face studio stayed active after the preview marker was withdrawn');
api.revert();
eq(api.installed, false, 'revert did not retire the studio owner');
eq(window.__mlsAvatarFaceStudio, undefined, 'revert left the retired studio globally installed');

/* A saved reference from a retired installation must be powerless against a
   newer controller/API, even when both installations have the same version. */
const newer = { installed: true, version: api.version, installToken: 'new-face-token' };
window.__MLS_P1_PREVIEW.enabled = true;
window.__mlsP1AvatarFaceLoader = { installed: true, version: api.version, installToken: 'new-face-token' };
window.__mlsAvatarFaceStudio = newer;
eq(api.reconcile(), false, 'stale studio reference can still reconcile the newer DOM');
eq(api.revert(), false, 'stale studio reference can still invoke teardown');
eq(window.__mlsAvatarFaceStudio, newer, 'stale studio reference removed the newer owner');
eq(newer.installed, true, 'stale studio reference retired the newer owner object');
currentScript.setAttribute('data-mls-install-token', 'face-test-token');
vm.runInContext(source, context, { filename: file + '#late-old-token' });
eq(window.__mlsAvatarFaceStudio, newer, 'late old-token asset evaluation replaced the newer owner');
eq(newer.installed, true, 'late old-token asset evaluation retired the newer owner');

/* A stale owner's revert may synchronously publish its successor. Asset
   evaluation must re-read the canonical owner and never overwrite either an
   exact current successor or an unexpected live collision. */
for (const exact of [true, false]) {
  const token = exact ? 'reentrant-exact-token' : 'reentrant-collision-token';
  const replacement = {
    installed: true,
    version: exact ? api.version : 'foreign-face-owner',
    installToken: exact ? token : 'foreign-token',
    reconcile() {}, revert() { this.installed = false; }
  };
  const stale = {
    installed: true, version: 'retiring-face-owner', installToken: 'retiring-token',
    revert() { this.installed = false; window.__mlsAvatarFaceStudio = replacement; }
  };
  window.__MLS_P1_PREVIEW.enabled = true;
  window.__mlsP1AvatarFaceLoader = { installed: true, version: api.version, installToken: token };
  window.__mlsAvatarFaceStudio = stale;
  currentScript.setAttribute('data-mls-install-token', token);
  vm.runInContext(source, context, { filename: file + (exact ? '#reentrant-exact' : '#reentrant-collision') });
  eq(window.__mlsAvatarFaceStudio, replacement,
    exact ? 'asset overwrote a reentrant exact current owner' : 'asset overwrote a reentrant foreign owner');
  eq(replacement.installed, true,
    exact ? 'asset retired a reentrant exact current owner' : 'asset retired a reentrant foreign owner');
}
for (const replacement of [undefined, { installed: false, version: 'inactive-replacement' }]) {
  const token = 'broken-retirement-token';
  const retiring = {
    installed: true, version: 'retiring-face-owner', installToken: 'retiring-token',
    revert() {
      if (replacement) window.__mlsAvatarFaceStudio = replacement;
      else delete window.__mlsAvatarFaceStudio;
      return true;
    }
  };
  window.__mlsP1AvatarFaceLoader = { installed: true, version: api.version, installToken: token };
  window.__mlsAvatarFaceStudio = retiring;
  currentScript.setAttribute('data-mls-install-token', token);
  vm.runInContext(source, context, { filename: file + '#broken-retirement' });
  eq(retiring.installed, true, 'synthetic broken studio unexpectedly proved retirement');
  eq(window.__mlsAvatarFaceStudio, replacement,
    'face asset installed alongside an old owner that never retired');
}

/* Initialization is transactional. A DOM/listener failure may leave neither a
   globally installed owner nor a controller-visible false success. */
{
  const failedWindow = {
    __MLS_P1_PREVIEW: { enabled: true },
    __mlsP1AvatarFaceLoader: { installed: true, version: api.version, installToken: 'failed-token' },
    addEventListener() { throw new Error('listener install failed'); },
    removeEventListener() {}
  };
  const failedScript = node('script'); failedScript.setAttribute('data-mls-install-token', 'failed-token');
  const failedHead = node('head');
  const failedDocument = {
    head: failedHead, documentElement: node('html'), currentScript: failedScript,
    createElement: node, getElementById() { return null; }, querySelectorAll() { return []; }
  };
  const failedContext = vm.createContext({
    window: failedWindow, document: failedDocument, MutationObserver,
    setTimeout() {}, clearTimeout() {}, console
  });
  vm.runInContext(source, failedContext, { filename: file + '#failed-init' });
  ok(!failedWindow.__mlsAvatarFaceStudio || failedWindow.__mlsAvatarFaceStudio.installed !== true,
    'failed initialization left a globally installed face owner');
}

console.log('PASS 1p avatar face studio: ' + passed + ' assertions');
