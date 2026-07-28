'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

// The primary Visit lane must own three distinct, inline controls and retire
// only their fixed duplicates while that complete lane is visible.
const quickAt = connect.indexOf("q.className = 'ez3fl-quick'");
const quickEnd = connect.indexOf('rec.appendChild(q);', quickAt);
assert(quickAt >= 0 && quickEnd > quickAt, 'primary QUICK TOOLS lane not found');
const quick = connect.slice(quickAt, quickEnd);
[
  /* 2026-07-28: the Copilot Voice pair left with the feature (owner retired it). */
  ['ez3flAssistant', 'mlsAsstFab'],
  ['ez3flDictate', 'mlsDaDock']
].forEach(([proxy, real]) => {
  assert(quick.includes(proxy), `missing inline ${proxy} control`);
  assert(quick.includes(real), `${proxy} must proxy the real ${real} behavior`);
});
assert(quick.includes("$('ez3flTranscript')") && quick.includes('top.focus()'), 'inline Dictate must focus the primary transcript before dictating');
assert(connect.includes('html body.mls-top-voice-tools #mlsCopVoiceBtn,html body.mls-top-voice-tools #mlsAsstFab,html body.mls-top-voice-tools #mlsDaDock{display:none!important;}'), 'visible primary lane must suppress all three fixed duplicates');
assert(connect.includes("document.body.classList.toggle('mls-top-voice-tools', visible)"), 'fixed-control suppression must follow actual lane visibility');
assert(connect.includes("document.body.classList.remove('mls-top-voice-tools')"), 'revert must restore fixed controls');
assert(connect.includes('#appWrap{padding-bottom:96px!important;scroll-padding-bottom:96px;}'), 'fixed row needs a reserved page safe area outside the Visit lane');

// Execute the legacy fixed-row layout against the exact live widths that
// exposed the overlap. This catches both omissions of Dictate and a regression
// where its translateX(-50%) is left active after row positioning.
const blockStart = connect.indexOf(' * MLS Scribe -- b42 "bottom-left tidy + voice state"');
const iifeStart = connect.indexOf('(function () {', blockStart);
const blockEnd = connect.indexOf('/* =========================================================================\n * MLS Scribe -- b41', iifeStart);
assert(blockStart >= 0 && iifeStart > blockStart && blockEnd > iifeStart, 'b42 layout block not found');
const code = connect.slice(iifeStart, blockEnd);

function cssStyle(initial) {
  const values = Object.assign({}, initial || {});
  const priorities = {};
  return {
    getPropertyValue(name) { return values[name] || ''; },
    getPropertyPriority(name) { return priorities[name] || ''; },
    setProperty(name, value, priority) { values[name] = String(value); priorities[name] = priority || ''; },
    removeProperty(name) { delete values[name]; delete priorities[name]; }
  };
}

function classList(initial) {
  const set = new Set(initial || []);
  return {
    contains(name) { return set.has(name); },
    add(name) { set.add(name); },
    remove(name) { set.delete(name); },
    toggle(name, on) {
      if (arguments.length > 1) { if (on) set.add(name); else set.delete(name); return !!on; }
      if (set.has(name)) { set.delete(name); return false; }
      set.add(name); return true;
    }
  };
}

const elements = Object.create(null);
function makeElement(id, width, initialStyle) {
  const el = {
    id: id || '', width: width || 0, style: cssStyle(initialStyle), classList: classList(),
    display: 'inline-flex', visibility: 'visible', innerHTML: '', title: '', firstChild: null,
    _dot: null, _styleAttr: null,
    getAttribute(name) { return name === 'style' ? this._styleAttr : null; },
    setAttribute(name, value) { if (name === 'style') this._styleAttr = String(value); },
    removeAttribute(name) { if (name === 'style') this._styleAttr = null; },
    querySelector(sel) { return sel === '.mls-bl42-dot' ? this._dot : null; },
    insertBefore(child) { this._dot = child; this.firstChild = child; },
    addEventListener() {},
    remove() { if (this.id) delete elements[this.id]; },
    getBoundingClientRect() {
      let left = parseFloat(this.style.getPropertyValue('left')) || 0;
      if (/translateX\(-50%\)/.test(this.style.getPropertyValue('transform'))) left -= this.width / 2;
      return { left, right: left + this.width, width: this.width, height: 40, top: 0, bottom: 40 };
    }
  };
  if (id) elements[id] = el;
  return el;
}

const voice = makeElement('mlsCopVoiceBtn', 207);
voice.innerHTML = 'MLS Copilot Voice';
const assistant = makeElement('mlsAsstFab', 149);
const dictate = makeElement('mlsDaDock', 88, { transform: 'translateX(-50%)' });
const tab = makeElement('mlsTabPickerChip', 100);
const bodyClasses = classList(['mls-rd-shell']);
const document = {
  readyState: 'complete',
  body: { classList: bodyClasses },
  head: { appendChild(el) { if (el.id) elements[el.id] = el; } },
  getElementById(id) { return elements[id] || null; },
  createElement(tag) { return makeElement('', 0); },
  addEventListener() {},
  removeEventListener() {}
};
let timerId = 0;
class FakeMutationObserver { observe() {} disconnect() {} }
const window = { innerWidth: 1280, __mlsBLTidyB42: null };
const context = vm.createContext({
  window, document, MutationObserver: FakeMutationObserver,
  getComputedStyle(el) { return { display: el.display, visibility: el.visibility }; },
  setInterval() { timerId += 1; return timerId; }, clearInterval() {},
  Date, Math
});
vm.runInContext(code, context, { filename: 'b42-layout.js' });
assert(window.__mlsBLTidyB42 && typeof window.__mlsBLTidyB42.layout === 'function', 'b42 layout API did not install');

function rects() { return [voice, assistant, dictate, tab].map(el => el.getBoundingClientRect()); }
function assertNonOverlapping(label) {
  const rs = rects();
  for (let i = 1; i < rs.length; i += 1) {
    assert(rs[i].left >= rs[i - 1].right + 10, `${label}: controls ${i - 1} and ${i} overlap`);
  }
  assert(rs[rs.length - 1].right <= window.innerWidth - 12, `${label}: final control falls offscreen`);
}
assert.strictEqual(dictate.style.getPropertyValue('transform'), 'none', 'Dictate centering transform must be cleared by unified row layout');
assert.strictEqual(dictate.style.getPropertyPriority('transform'), 'important', 'legacy Dictate CSS must not restore its overlap transform');
assertNonOverlapping('1280px live viewport');

window.innerWidth = 780;
window.__mlsBLTidyB42.layout();
assertNonOverlapping('780px responsive desktop viewport');

// Visibility handoff is viewport-based, not merely mounted-size-based. When
// the doctor scrolls from the primary lane into the advanced workspace, the
// inline chips leave the viewport and the body suppression class must clear so
// the fixed controls are available again.
const visStart = connect.indexOf('function topLaneIsVisible(rec)');
const visEnd = connect.indexOf('function clickTopVoiceControl(id, label)', visStart);
assert(visStart >= 0 && visEnd > visStart, 'primary voice visibility handoff block not found');
const visibilityCode = connect.slice(visStart, visEnd);
const handoffClasses = classList();
const visit = { display: 'block', visibility: 'visible' };
const lane = {
  parentNode: {}, display: 'flex', visibility: 'visible',
  rect: { left: 100, right: 700, top: 100, bottom: 300, width: 600, height: 200 },
  getBoundingClientRect() { return this.rect; },
  querySelector() { return null; }
};
const handoffWindow = { innerWidth: 1280, innerHeight: 720 };
const handoffDocument = { body: { classList: handoffClasses }, documentElement: { clientWidth: 1280, clientHeight: 720 } };
const handoffContext = vm.createContext({
  window: handoffWindow,
  document: handoffDocument,
  $: id => id === 'visitView' ? visit : null,
  getComputedStyle(el) { return { display: el.display, visibility: el.visibility }; }
});
vm.runInContext(`${visibilityCode}\nwindow.__syncPrimaryVoiceToolsForTest = syncPrimaryVoiceTools;`, handoffContext, { filename: 'primary-voice-handoff.js' });
handoffWindow.__syncPrimaryVoiceToolsForTest(lane);
assert(handoffClasses.contains('mls-top-voice-tools'), 'onscreen inline controls must suppress their fixed duplicates');
lane.rect = { left: 100, right: 700, top: 800, bottom: 1000, width: 600, height: 200 };
handoffWindow.__syncPrimaryVoiceToolsForTest(lane);
assert(!handoffClasses.contains('mls-top-voice-tools'), 'offscreen inline controls must restore fixed Copilot Voice, MLS Assistant, and Dictate');

console.log('PASS voice dock layout: viewport-aware inline handoff, fixed control restore, safe area, non-overlapping responsive fallback row');
