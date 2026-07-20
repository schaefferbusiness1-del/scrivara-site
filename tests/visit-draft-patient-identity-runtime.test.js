'use strict';

/* The per-user visit-draft slot survives patient switches (openPatient never
 * wipes it), so the restore bar can appear on a DIFFERENT patient's fresh
 * Visit view. Before 2026-07-20 the bar was anonymous ("You have an unsaved
 * visit from 2:41 PM") and Restore placed another patient's content into the
 * open workspace, where the mistake only surfaced later as the bound-editor
 * save error. Contract now, in BOTH shells:
 *   - _saveVisitDraft stamps the draft with ptId (binding patientId first,
 *     else the active patient id);
 *   - the restore bar NAMES the draft's patient;
 *   - when the draft belongs to a different patient than the open one, the
 *     primary action is "Open <name>" (switch, then re-offer), never a bare
 *     Restore;
 *   - _restoreVisitDraft refuses a cross-patient restore outright with an
 *     honest toast, changing nothing.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

for (const file of ['ScribeFlow.html', 'ScribeFlow-staging.html']) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');

  // static: the draft payload carries ptId
  const saveStart = html.indexOf('function _saveVisitDraft()');
  const saveEnd = html.indexOf('function _wipeVisitDraft()', saveStart);
  assert(saveStart > 0 && saveEnd > saveStart, file + ': draft save boundaries missing');
  const saveSrc = html.slice(saveStart, saveEnd);
  assert(/ptId:/.test(saveSrc), file + ': _saveVisitDraft does not stamp the draft with ptId');

  const start = html.indexOf('function _maybeRestoreVisitDraft()');
  const end = html.indexOf('function _dismissVisitRestore()', start);
  assert(start > 0 && end > start, file + ': restore-bar boundaries missing');
  const src = html.slice(start, end);
  assert(src.includes('function _openVisitDraftPatient()'), file + ': the open-draft-patient action is missing');

  function makeContext(activeId, storedDraft) {
    const store = new Map([['acct:visitDraft', JSON.stringify(storedDraft)]]);
    let insertedBar = null;
    const toasts = [];
    const opened = [];
    const transcript = { value: '', parentNode: { insertBefore: (bar) => { insertedBar = bar; } } };
    function makeEl(tag) {
      return {
        tag, id: '', style: {}, children: [], _text: '',
        set textContent(v) { this._text = String(v); },
        get textContent() { return this._text; },
        set onclick(fn) { this._onclick = fn; },
        get onclick() { return this._onclick; },
        set className(v) { this._cls = v; }, get className() { return this._cls || ''; },
        appendChild(child) { this.children.push(child); },
        remove() { insertedBar = null; }
      };
    }
    const context = vm.createContext({
      sessionStorage: { getItem: k => (store.has(k) ? store.get(k) : null), removeItem: k => store.delete(k), setItem: (k, v) => store.set(k, String(v)) },
      document: {
        getElementById: id => (id === 'transcript' ? transcript : (id === '_visitRestoreBar' ? insertedBar : null)),
        createElement: makeEl
      },
      getActivePtId: () => activeId,
      findPatient: id => (id === 'pA' ? { id: 'pA', name: 'Alice Draftowner' } : null),
      openPatient: id => opened.push(id),
      showView: () => {},
      toast: (msg, kind) => toasts.push({ msg: String(msg), kind: String(kind || '') }),
      uns: n => 'acct:' + n,
      _visitDraftKey: () => 'acct:visitDraft',
      Date, JSON,
      console
    });
    vm.runInContext('var _visitDirty=false;', context);
    vm.runInContext(src, context, { filename: file + ':restore-bar' });
    return { context, probe: { bar: () => insertedBar, toasts, opened, transcript } };
  }

  const DRAFT = { t: 'Alice transcript body', soap: 'Alice soap', pt: 'Alice Draftowner', ptId: 'pA', ts: 1784500000000 };

  // 1. Matching patient: bar names the patient and offers Restore.
  {
    const { context, probe } = makeContext('pA', DRAFT);
    vm.runInContext('_maybeRestoreVisitDraft()', context);
    const bar = probe.bar();
    assert(bar, file + ': restore bar was not shown for the matching patient');
    const lead = bar.children[0];
    assert(lead && lead.textContent.includes('Alice Draftowner'), file + ': the bar does not name the draft patient');
    assert(!lead.textContent.includes('different patient'), file + ': matching patient wrongly warned about a mismatch');
    assert.strictEqual(bar.children[1].textContent, 'Restore it', file + ': matching patient lost the Restore action');
  }

  // 2. Different active patient: bar says so and offers Open, not Restore.
  {
    const { context, probe } = makeContext('pB', DRAFT);
    vm.runInContext('_maybeRestoreVisitDraft()', context);
    const bar = probe.bar();
    assert(bar, file + ': restore bar missing for the mismatch case');
    assert(bar.children[0].textContent.includes('different patient'), file + ': mismatch not called out');
    assert(/^Open /.test(bar.children[1].textContent), file + ': mismatch primary action must open the draft patient, got ' + JSON.stringify(bar.children[1].textContent));
    bar.children[1].onclick();
    assert.deepStrictEqual(probe.opened, ['pA'], file + ': Open action did not open the draft patient');
  }

  // 3. Direct cross-patient restore refuses and changes nothing.
  {
    const { context, probe } = makeContext('pB', DRAFT);
    vm.runInContext('_restoreVisitDraft()', context);
    assert.strictEqual(probe.transcript.value, '', file + ': cross-patient restore modified the transcript');
    assert(probe.toasts.some(t => t.kind === 'err' && t.msg.includes('Alice Draftowner')), file + ': cross-patient refusal toast missing or anonymous');
  }

  // 4. Matching restore still works.
  {
    const { context, probe } = makeContext('pA', DRAFT);
    vm.runInContext('_restoreVisitDraft()', context);
    assert.strictEqual(probe.transcript.value, 'Alice transcript body', file + ': matching restore no longer restores the transcript');
  }
}

console.log('PASS visit-draft patient identity: drafts are stamped with their patient, the restore bar names them, cross-patient restores are redirected to Open-that-patient and refused outright on direct calls');
