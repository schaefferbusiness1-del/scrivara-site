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
const document = {
  head, documentElement,
  createElement: node,
  getElementById() { return null; },
  querySelectorAll() { return []; }
};
const window = {
  addEventListener() {}, removeEventListener() {},
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
ok(source.includes("typeof api.revert === 'function'") && source.includes('observer.disconnect()'), 'hot reload cannot retire the old studio owner');
ok(source.includes('timers.indexOf(timer)') && source.includes('clearPollTimers()'), 'bounded receipt polling survives revert');
ok(source.includes('Number(latest.at || 0) > before'), 'a stale prior match receipt can paint a new run');
ok(source.includes('help.__mlsP1FaceCopy === copyKey'), 'mutation reconciliation can rewrite its own copy forever');
ok(!/fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/.test(source), 'presentation shell gained network or storage ownership');
ok(!/athena|extension|chrome\.runtime/i.test(source), 'face studio crosses into Athena or extension ownership');
ok(!source.includes('patientExternalId') && !source.includes('getPatients'), 'face studio reads patient identity');

api.revert();
eq(api.installed, false, 'revert did not retire the studio owner');

console.log('PASS 1p avatar face studio: ' + passed + ' assertions');
