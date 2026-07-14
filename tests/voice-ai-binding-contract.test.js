'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_voice_ai.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function element(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(), style: {}, attrs: {}, children: [], parentNode: null,
    innerHTML: '', textContent: '', value: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter(x => x !== child); },
    addEventListener() {}
  };
}

function harness(generateImpl) {
  const byId = Object.create(null);
  const head = element('head');
  const body = element('body');
  const noteBox = element('textarea');
  noteBox.value = 'verified note';
  byId.noteBox = noteBox;
  let reviews = 0;
  const context = {
    console, Date, Math, Promise, Object, Array, String, Number, RegExp, JSON,
    setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
    currentVisitAthenaBinding: { id: 'visit-a', patient: { patientId: 'A', name: 'Patient A' } },
    currentVisitAthenaEpoch: 1,
    generateNote: generateImpl,
    pushEntireVisitToAthena() { reviews += 1; return true; },
    _athenaGuardBoundEditor() { return true; },
    _athenaAsyncBindingStillSafe(binding, _label, epoch) {
      return !!(binding && context.currentVisitAthenaBinding
        && binding.id === context.currentVisitAthenaBinding.id
        && Number(epoch) === Number(context.currentVisitAthenaEpoch));
    },
    document: {
      head, body, documentElement: head,
      getElementById(id) { return byId[id] || null; },
      createElement(tag) {
        const node = element(tag);
        Object.defineProperty(node, 'id', {
          get() { return this._id || ''; },
          set(v) { this._id = String(v); if (v) byId[this._id] = this; }
        });
        return node;
      }
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'feat_mls_voice_ai.js' });
  return { context, reviews: () => reviews };
}

(async () => {
  const pending = deferred();
  const switched = harness(() => pending.promise);
  const switchedRun = switched.context.__mlsVoiceAI.executeChain(['generate_note', 'save_to_athena']);
  switched.context.currentVisitAthenaBinding = { id: 'visit-b', patient: { patientId: 'B', name: 'Patient B' } };
  switched.context.currentVisitAthenaEpoch = 2;
  pending.resolve(true);
  const switchedResult = await switchedRun;
  assert.strictEqual(switched.reviews(), 0, 'patient-A voice chain opened Athena review after switching to patient B');
  assert.strictEqual(switchedResult.results.length, 2, 'the failed chain did not account for its skipped remainder');
  assert.strictEqual(switchedResult.results[1].status, 'skipped');

  const rejected = harness(() => Promise.resolve(false));
  const rejectedResult = await rejected.context.__mlsVoiceAI.executeChain(['generate_note', 'save_to_athena']);
  assert.strictEqual(rejected.reviews(), 0, 'Athena review opened after generation explicitly returned false');
  assert.strictEqual(rejectedResult.results[1].status, 'skipped');

  const accepted = harness(() => Promise.resolve(true));
  const acceptedResult = await accepted.context.__mlsVoiceAI.executeChain(['generate_note', 'save_to_athena']);
  assert.strictEqual(acceptedResult.ok, true);
  assert.strictEqual(accepted.reviews(), 1, 'a valid unchanged chain did not open exactly one supervised review');

  const reviewIndex = source.indexOf('var review = window.pushEntireVisitToAthena');
  const directIndex = source.indexOf('writeNoteToChart');
  assert(reviewIndex >= 0 && (directIndex < 0 || reviewIndex < directIndex), 'voice Athena route does not lead with supervised review');

  console.log('PASS voice AI binding: failed/stale generation terminates the chain and valid work opens one supervised review');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
