'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_visit_voice_one.js'), 'utf8');

let animationFrames = 0;
let observers = 0;
let documentListeners = 0;
let windowListeners = 0;

const documentObject = {
  readyState: 'complete',
  body: {},
  addEventListener() { documentListeners += 1; },
  removeEventListener() {},
  getElementById() { return null; }
};

function MutationObserver() {
  observers += 1;
  this.observe = function () {};
  this.disconnect = function () {};
}

const windowObject = {
  document: documentObject,
  __mlsCurrentView: 'patients',
  requestAnimationFrame() { animationFrames += 1; return animationFrames; },
  cancelAnimationFrame() {},
  addEventListener() { windowListeners += 1; },
  removeEventListener() {}
};
windowObject.window = windowObject;

vm.runInNewContext(source, {
  window: windowObject,
  document: documentObject,
  MutationObserver,
  console
}, { filename: 'feat_mls_visit_voice_one.js' });

assert(windowObject.__mlsVisitVoiceOne && windowObject.__mlsVisitVoiceOne.installed,
  'the reversible visit-voice owner API must still install');
assert.strictEqual(observers, 0,
  'a one-option disclosure can never mount and must not observe the Visit subtree');
assert.strictEqual(animationFrames, 0,
  'a one-option disclosure can never mount and must not queue animation frames');
assert.strictEqual(documentListeners, 0,
  'a one-option disclosure must not install document interaction listeners');
assert.strictEqual(windowListeners, 0,
  'a one-option disclosure must not install a view listener');

/* Keep the dormant multi-option path safe if a future owner decision restores
   another named tool: both enqueue and execution must reject hidden Visit
   work, and the canonical route event is its only activation signal. */
assert(/if \(frame \|\| !visitActive\(\)\) return;/.test(source),
  'hidden Visit mutations must be rejected before an animation frame is queued');
assert(/frame = 0;[\s\S]{0,220}?if \(!visitActive\(\)\) return;[\s\S]{0,80}?safe\(mount\)/.test(source),
  'a queued frame must recheck the active route before touching Visit layout');
assert(source.includes("W.addEventListener('mls:view-changed', onViewChanged)"),
  'future multi-option activation must use the canonical route lifecycle');
assert(source.includes("W.removeEventListener('mls:view-changed', onViewChanged)"),
  'the canonical route lifecycle listener must remain reversible');

console.log('PASS visit voice hidden-work runtime: 1 static option, 0 observers, 0 frames, 0 listeners');
