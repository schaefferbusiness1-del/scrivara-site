'use strict';

/* Runtime regression for the easy-workflow Pause/Resume recording contract.
 *
 * Executes the REAL shipped code — the __mlsEz3Flow module slice from
 * mls-connect.js plus the real feat_mls_recording_segments.js — against a DOM
 * simulation, then drives Start -> Pause -> Resume -> Pause through the real
 * lane button and proves:
 *   - while recording the main button says "Pause recording";
 *   - pausing preserves the full transcript, does not generate a note, does
 *     not clear audio state, and never opens a stop-and-generate confirmation;
 *   - after pausing the same button says "Resume recording";
 *   - resuming adds a new recording segment for the same exact patient;
 *   - all segments stay combined in one transcript and carry the exact
 *     patient id/DOB;
 *   - a failed microphone request and a missing patient fail closed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const segmentsSource = fs.readFileSync(path.join(root, 'feat_mls_recording_segments.js'), 'utf8');

const flowStart = connect.indexOf('/* =============================================================================\n * __mlsEz3Flow');
const flowEnd = connect.indexOf('/* =============================================================================\n * __mlsGuidedTour', flowStart);
assert(flowStart >= 0 && flowEnd > flowStart, 'easy visit flow module boundary was not found');
const flowSource = connect.slice(flowStart, flowEnd).replace(/^\/\* =+\n \* __mlsEz3Flow[\s\S]*?\*\//, '');

/* ------------------------- DOM simulation ------------------------- */
function makeDom() {
  const byId = {};
  let seq = 0;

  function matchesToken(node, token) {
    token = token.trim();
    if (!token) return false;
    if (token[0] === '#') return node.id === token.slice(1);
    if (token[0] === '.') return String(node.className || '').split(/\s+/).includes(token.slice(1));
    return String(node.tagName || '').toLowerCase() === token.toLowerCase();
  }

  function makeNode(tag) {
    const node = {
      tagName: String(tag || 'div').toUpperCase(),
      _id: '', className: '', children: [], parentNode: null,
      listeners: {}, style: {
        _map: {},
        getPropertyValue(k) { return this._map[k] || ''; },
        setProperty(k, v) { this._map[k] = v; },
        display: ''
      },
      value: '', hidden: false, disabled: false, title: '', type: '',
      _text: '', attrs: {},
      classList: {
        _owner: null,
        contains(c) { return String(this._owner.className || '').split(/\s+/).includes(c); },
        toggle(c, force) {
          const has = this.contains(c);
          const want = force === undefined ? !has : !!force;
          if (want && !has) this._owner.className = (this._owner.className + ' ' + c).trim();
          if (!want && has) this._owner.className = String(this._owner.className).split(/\s+/).filter(x => x !== c).join(' ');
          return want;
        },
        add(c) { this.toggle(c, true); }, remove(c) { this.toggle(c, false); }
      },
      get id() { return this._id; },
      set id(v) { if (this._id) delete byId[this._id]; this._id = v; if (v) byId[v] = this; },
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); },
      get innerHTML() { return this._html || ''; },
      set innerHTML(h) {
        this._html = String(h);
        this.children.splice(0).forEach(c => { c.parentNode = null; });
        /* flat parse: create a child for every tag carrying id/class */
        const re = /<(textarea|div|span|button|label|input|select|a)\b([^>]*)>/g;
        let m;
        while ((m = re.exec(this._html))) {
          const child = makeNode(m[1]);
          const idm = /id="([^"]+)"/.exec(m[2]);
          const clm = /class="([^"]+)"/.exec(m[2]);
          if (clm) child.className = clm[1];
          if (idm) child.id = idm[1];
          child.parentNode = this;
          this.children.push(child);
        }
      },
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      removeEventListener() {},
      dispatchEvent(ev) {
        (this.listeners[(ev && ev.type) || ''] || []).forEach(fn => fn.call(this, ev));
        return true;
      },
      click() { (this.listeners.click || []).forEach(fn => fn.call(this, { target: this })); },
      focus() { doc.activeElement = this; },
      blur() { if (doc.activeElement === this) doc.activeElement = doc.body; },
      setSelectionRange() {},
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; },
      getBoundingClientRect() { return { top: 10, bottom: 90, left: 10, right: 400, width: 390, height: 80 }; },
      get offsetParent() { return this.parentNode; },
      get parentElement() { return this.parentNode; },
      get nextSibling() {
        if (!this.parentNode) return null;
        const i = this.parentNode.children.indexOf(this);
        return this.parentNode.children[i + 1] || null;
      },
      get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.body || n === doc.head; },
      contains(el) { if (el === this) return true; return this.children.some(c => c.contains && c.contains(el)); },
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
      insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c);
        const i = ref ? this.children.indexOf(ref) : -1;
        c.parentNode = this;
        if (i >= 0) this.children.splice(i, 0, c); else this.children.push(c);
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; }
        return c;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      getElementsByClassName(cls) { return this.querySelectorAll('.' + cls); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const groups = String(sel).split(',');
        const walk = (n) => {
          for (const c of n.children) {
            if (groups.some(g => g.trim().split(/(?=[.#])/).every(t => matchesToken(c, t)))) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      seq: ++seq
    };
    node.classList._owner = node;
    return node;
  }

  const doc = {};
  doc.body = makeNode('body');
  doc.head = makeNode('head');
  doc.documentElement = makeNode('html');
  doc.activeElement = doc.body;
  doc.readyState = 'complete';
  doc.hidden = false;
  doc.listeners = {};
  doc.getElementById = (id) => byId[id] || null;
  doc.createElement = (tag) => makeNode(tag);
  doc.addEventListener = (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
  doc.removeEventListener = () => {};
  doc.querySelector = (sel) => doc.body.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.body.querySelectorAll(sel);
  doc.contains = (el) => !!(el && el.isConnected);
  return { doc, makeNode, byId };
}

/* ------------------------- harness ------------------------- */
const { doc, makeNode } = makeDom();
const toasts = [];
const storage = {};
const context = {
  console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
  setTimeout(fn) { fn(); return ++context.__t; }, clearTimeout() {},
  setInterval() { return ++context.__t; }, clearInterval() {},
  requestAnimationFrame(fn) { fn(); return 1; }, cancelAnimationFrame() {},
  __t: 1,
  Event: function Event(type) { this.type = type; },
  MutationObserver: class { observe() {} disconnect() {} },
  getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
  innerWidth: 1400, innerHeight: 900,
  location: { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html', search: '' },
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  },
  document: doc,
  toast(message, kind) { toasts.push({ message, kind }); },
  confirm() { throw new Error('pause must never open a confirmation dialog'); },
  addEventListener() {}, removeEventListener() {},
  capturing: false
};
context.window = context;

/* base recorder stubs — the same observable surface the app exposes */
const captureBtn = makeNode('button');
captureBtn.id = 'captureBtn';
captureBtn.textContent = '▶ Start Visit';
doc.body.appendChild(captureBtn);
const transcript = makeNode('textarea');
transcript.id = 'transcript';
doc.body.appendChild(transcript);
const visitView = makeNode('div');
visitView.id = 'visitView';
doc.body.appendChild(visitView);

let startCalls = 0, stopCalls = 0, generateCalls = 0, failNextStart = false;
context.startCapture = context.window.startCapture = function () {
  startCalls++;
  if (failNextStart) { failNextStart = false; return false; }
  context.capturing = true;
  captureBtn.textContent = 'Recording… Stop Visit';
  return true;
};
context.stopCapture = context.window.stopCapture = function () {
  stopCalls++;
  context.capturing = false;
  captureBtn.textContent = '▶ Start Visit';
  return true;
};
context.generateNote = function () { generateCalls++; };
let activePatient = { id: 'pt-1', name: 'Casey Demo', dob: '1990-01-01' };
context.activePatient = () => activePatient;
context.getActivePtId = () => (activePatient ? activePatient.id : '');

/* the easy engine body: #mlsEz3Body > #ez3Wrap > .ez3-row2 (doctor home) */
const ez3Body = makeNode('div');
ez3Body.id = 'mlsEz3Body';
const ez3Wrap = makeNode('div');
ez3Wrap.id = 'ez3Wrap';
const row2 = makeNode('div');
row2.className = 'ez3-row2';
ez3Wrap.appendChild(row2);
ez3Body.appendChild(ez3Wrap);
doc.body.appendChild(ez3Body);

/* run the REAL segments module, then the REAL flow module */
vm.createContext(context);
vm.runInContext(segmentsSource, context, { filename: 'feat_mls_recording_segments.js' });
assert(context.__mlsRecSegments && context.__mlsRecSegments.installed, 'segments module did not install');
vm.runInContext(flowSource, context, { filename: 'mls-connect.js#__mlsEz3Flow' });
assert(context.__mlsEz3Flow && context.__mlsEz3Flow.installed, 'easy flow module did not install');

/* the flow module created the lane inside #ez3Wrap before .ez3-row2 */
const lane = ez3Wrap.querySelector('.ez3fl-record');
assert(lane, 'the easy lane was not created');
assert.strictEqual(ez3Wrap.children.indexOf(lane), ez3Wrap.children.indexOf(row2) - 1, 'the lane is not mounted before the action row');
assert.strictEqual(doc.body.querySelectorAll('.ez3fl-record').length, 1, 'more than one recording lane exists');
const recBtn = lane.querySelector('.ez3fl-recbtn');
const label = () => recBtn.querySelector('.ez3fl-rblabel').textContent;
assert(recBtn, 'the main easy recording button is missing');

const seg = context.__mlsRecSegments;
const segsFor = () => seg.state ? seg.state() : null;

/* ---- fail-closed: no active patient ---- */
activePatient = null;
recBtn.click();
assert.strictEqual(context.capturing, false, 'recording started without a verified patient');
assert(toasts.some(t => /choose a patient/i.test(t.message)), 'missing-patient start did not explain itself');
activePatient = { id: 'pt-1', name: 'Casey Demo', dob: '1990-01-01' };

/* ---- fail-closed: microphone failure ---- */
failNextStart = true;
recBtn.click();
assert.strictEqual(context.capturing, false, 'a failed microphone request left the recorder armed');
assert(toasts.some(t => /could not start/i.test(t.message)), 'mic failure did not explain itself');

/* ---- Start ---- */
toasts.length = 0;
recBtn.click();
assert.strictEqual(context.capturing, true, 'start did not begin capturing');
assert(/Pause recording/.test(label()), 'while recording the main button must say "Pause recording", got: ' + label());

/* speech lands in the canonical transcript */
transcript.value = 'Segment one text from the visit.';

/* ---- Pause ---- */
recBtn.click();
assert.strictEqual(context.capturing, false, 'pause did not stop capturing');
assert.strictEqual(stopCalls >= 1, true, 'pause did not stop the base recorder');
assert.strictEqual(generateCalls, 0, 'pausing generated a note');
assert.strictEqual(transcript.value, 'Segment one text from the visit.', 'pausing lost transcript text');
assert(/Resume recording/.test(label()), 'after pausing the button must say "Resume recording", got: ' + label());

/* ---- Resume ---- */
recBtn.click();
assert.strictEqual(context.capturing, true, 'resume did not restart capturing');
assert(/Pause recording/.test(label()), 'while resumed the button must say "Pause recording"');
transcript.value = 'Segment one text from the visit. And the second segment continues here.';

/* ---- Pause again ---- */
recBtn.click();
assert.strictEqual(context.capturing, false, 'second pause did not stop capturing');
assert.strictEqual(transcript.value, 'Segment one text from the visit. And the second segment continues here.',
  'the combined transcript was not preserved across segments');
assert.strictEqual(generateCalls, 0, 'a pause generated a note');

/* ---- segment counts + exact patient ownership ---- */
const raw = storage[Object.keys(storage).find(k => /mlsRecSegments/.test(k))];
assert(raw, 'segments were not persisted');
const segments = JSON.parse(raw);
assert.strictEqual(segments.length, 2, 'Start->Pause->Resume->Pause must produce exactly 2 segments, got ' + segments.length);
for (const s of segments) {
  assert.strictEqual(s.patientId, 'pt-1', 'a segment lost its exact patient id');
  assert.strictEqual(s.patientDob, '1990-01-01', 'a segment lost its exact patient DOB');
}
assert(segments[0].text.includes('Segment one text'), 'segment one content missing');
assert(segments[1].text.includes('second segment continues'), 'segment two content missing');

console.log('PASS easy pause/resume: Pause/Resume labels, non-destructive pause, per-segment exact patient ownership, and one combined transcript');
