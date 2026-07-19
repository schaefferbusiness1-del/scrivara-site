'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_force_full_phone.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function between(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert(start >= 0 && end > start, `could not bound ${startText}`);
  return source.slice(start, end);
}

const pairSource = between('function pair(clickEvent)', 'function stripProto');
const ensureSource = between('function ensureQR()', 'function ensurePhoneOption');
const bootSource = between('function tick()', "if (document.readyState === 'loading')");
const explicitBoxHandler = "box.addEventListener('click', function(e){ if (e.target.tagName !== 'A') pair(e); });";

assert(pairSource.includes("clickEvent.isTrusted !== true"), 'pairing must require a trusted clinician click');
assert(pairSource.indexOf('clickEvent.isTrusted !== true') < pairSource.indexOf('window.startPhoneMic(clickEvent)'), 'the trusted-click gate must precede phone pairing');
assert(!/\bpair\s*\(|startPhoneMic\s*\(/.test(ensureSource.replace(explicitBoxHandler, '')), 'QR boot/repair must not start or retry pairing outside its click handler');
assert(!/startPhoneMic\s*\(|\bpair\s*\(/.test(bootSource), 'ticks, mutations, and boot must remain phone-pairing passive');
assert(!/setInterval\s*\(/.test(source), 'phone UI must not retain a permanent polling/repair interval');
assert(source.includes("new MutationObserver(function(rows){ if (needsRepair(rows)) schedule(); })"), 'phone UI remount recovery must be mutation-filtered');
assert(source.includes("window.addEventListener('mls:view-changed', schedule)"), 'phone UI must repair on explicit route lifecycle events');
assert(source.includes(explicitBoxHandler), 'the QR box must preserve its explicit click action');
assert(source.includes('Click here to prepare a scan code'), 'the passive QR state must tell the clinician that a click is required');
assert.strictEqual((connect.match(/feat_mls_force_full_phone\.js/g) || []).length, 1, 'the guarded phone module must remain registered exactly once');

const elements = new Map();
function register(el) { if (el.id) elements.set(el.id, el); return el; }

class FakeElement {
  constructor(tagName, id) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.id = id || '';
    this.style = {};
    this.listeners = {};
    this.children = [];
    this.nextElementSibling = null;
    this.textContent = '';
    this.src = '';
    this.href = '';
    this.attributes = {};
    this._innerHTML = '';
  }
  set innerHTML(value) {
    this._innerHTML = String(value || '');
    const re = /<([a-z]+)[^>]*\sid="([^"]+)"[^>]*>/gi;
    let match;
    while ((match = re.exec(this._innerHTML))) register(new FakeElement(match[1], match[2]));
  }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) { this.children.push(child); register(child); return child; }
  insertAdjacentElement(_where, child) { this.nextElementSibling = child; register(child); return child; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  matches(selector) { return selector.split(',').some(part => part.trim() === `#${this.id}`); }
  querySelector(selector) { return this.children.find(child => child.matches(selector) || child.querySelector(selector)) || null; }
}

const head = register(new FakeElement('head', 'head'));
const body = register(new FakeElement('body', 'body'));
const hero = register(new FakeElement('section', 'visitHero'));
const card = register(new FakeElement('section', 'captureCard'));
const capture = register(new FakeElement('button', 'captureBtn'));
register(new FakeElement('button', 'phoneMicBtn'));
register(new FakeElement('img', 'phoneMicQR'));
const canonicalPhoneLink = register(new FakeElement('a', 'phoneMicLink'));
canonicalPhoneLink.href = 'https://example.test/phone.html#code=SYN123';

let startCalls = 0;
const startEvents = [];
let fetchCalls = 0;
let mutationCallback = null;
const timeouts = [];
const intervals = [];
const windowListeners = {};
const storage = new Map();

const context = {
  window: {
    startPhoneMic(event) { startCalls++; startEvents.push(event); },
    __mlsEasy: null,
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); }
  },
  document: {
    readyState: 'complete',
    head,
    body,
    documentElement: head,
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { return new FakeElement(tag); },
    querySelector(selector) { return selector === 'a[href*="phone.html#code="]' ? canonicalPhoneLink : null; },
    addEventListener() {}
  },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); }
  },
  getComputedStyle() { return { position: 'static' }; },
  MutationObserver: function MutationObserver(fn) { mutationCallback = fn; this.observe = function observe() {}; },
  setTimeout(fn, ms) { timeouts.push({ fn, ms }); return timeouts.length; },
  setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
  fetch() { fetchCalls++; return Promise.reject(new Error('network forbidden in test')); },
  console
};
context.window.window = context.window;
context.window.document = context.document;
vm.createContext(context);
vm.runInContext(source, context);

function runTimeouts() {
  while (timeouts.length) timeouts.shift().fn();
}

assert.strictEqual(startCalls, 0, 'module boot started phone pairing');
assert.strictEqual(fetchCalls, 0, 'module boot attempted network work');
assert.strictEqual(intervals.length, 0, 'module registered a permanent background interval');
assert.strictEqual(elements.get('mlsGpLink').href, canonicalPhoneLink.href, 'passive phone mirror did not preserve the fragment handoff URL');
assert.strictEqual(elements.get('mlsGpCode').textContent, 'Code SYN123', 'passive phone mirror did not derive the label from the fragment code');

assert.strictEqual(typeof mutationCallback, 'function', 'module must retain DOM self-repair observation');
mutationCallback([{ target: body, addedNodes: [new FakeElement('div', 'unrelated')], removedNodes: [] }]);
assert.strictEqual(timeouts.length, 0, 'unrelated DOM churn scheduled phone UI repair');
mutationCallback([{ target: body, addedNodes: [card], removedNodes: [] }]);
runTimeouts();
assert.strictEqual(startCalls, 0, 'mutation repair started phone pairing');
assert(windowListeners['mls:view-changed'] && windowListeners['mls:view-changed'].length === 1, 'route lifecycle repair listener missing');
windowListeners['mls:view-changed'][0]();
runTimeouts();
assert.strictEqual(startCalls, 0, 'route lifecycle repair started phone pairing');

const box = elements.get('mlsGpQrBox');
assert(box && box.listeners.click && box.listeners.click.length === 1, 'manual QR click target was not mounted');
const click = box.listeners.click[0];
click({ target: box, isTrusted: false });
assert.strictEqual(startCalls, 0, 'programmatic click crossed the pairing boundary');

click({ target: box, isTrusted: true });
assert.strictEqual(startCalls, 1, 'one explicit clinician click did not start pairing exactly once');
assert.strictEqual(startEvents[0].isTrusted, true, 'phone UI did not preserve the original trusted event for the pairing owner');
runTimeouts();
assert.strictEqual(startCalls, 1, 'post-click mirror/repair restarted pairing');
assert.strictEqual(fetchCalls, 0, 'phone UI module performed network work itself');

const anchor = elements.get('mlsGpLink');
click({ target: anchor, isTrusted: true });
assert.strictEqual(startCalls, 1, 'clicking the existing pairing link started a second session');

console.log('PASS phone pairing is boot-passive and starts once only after a trusted clinician click');
