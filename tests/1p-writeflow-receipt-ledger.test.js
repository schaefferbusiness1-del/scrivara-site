'use strict';

/* wfsum-1.0.0 — the "What happened" receipt tells the truth across reopens.
 *
 * Owner 2026-08-26, with a screenshot of the receipt list: "this should tell
 * the truth cause im watching it work and it still says not attempted ...
 * send checked sections should be different then done its confusing ... can
 * it do a confirmation once everything has been written and that screen shot
 * I gave u is the only way someone knows whats done and what isnt."
 *
 * Measured defect: every sheet REOPEN (rebind cure, re-check rebuild, srr
 * rebind) starts a fresh state with EMPTY receipts, so a section he watched
 * land and verify repainted as NOT ATTEMPTED. The cure is a module-level
 * ledger keyed receiptSessionId+rowId (reopen paths reuse the session id).
 *
 * This suite EXECUTES the shipped functions through the wfsum test seam —
 * the same remember/rowState/render calls the sheet itself makes — and
 * proves the causal story both ways:
 *   1. a verified outcome survives a reopen of the SAME review;
 *   2. a DIFFERENT review (new receiptSessionId) inherits nothing;
 *   3. an uncertain outcome ALSO survives (the halt story must stay visible);
 *   4. a blocked refusal is NOT banked (a fresh probe re-decides it);
 *   5. note-editor-not-empty refusals paint ALREADY IN ATHENA, in green;
 *   6. when every note row is in Athena the render shows ONE green
 *      completion banner, the exit button becomes "Done — close review", and
 *      the batch button says there is nothing left to send;
 *   7. control: with a row still unwritten there is NO banner and the batch
 *      button stays live — completion can never be claimed early;
 *   8. the ledger can never make a row sendable (it stores outcomes only —
 *      no capability, no token, no probe fields are read from it).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- source pins: the wiring the runtime cases rely on ---- */
{
  ok(src.indexOf('var sectionLedger = Object.create(null);') > 0, 'the module-level ledger exists');
  ok(/state\.receipts\[row\.id\] = receipt;\s*\n\s*rememberRowOutcome\(state, row\.id, receipt\);/.test(src),
    'resultToUnifiedReceipt banks every stored receipt into the ledger');
  ok(src.indexOf("'already in Athena': '#205c43'") > 0, 'ALREADY IN ATHENA paints green, not gray');
  /* wfprog-1.0.0 kept this tick and gave it one more job: inside a batch the
     driver owns the button's "Writing 2 of 3" label, so the tick decorates
     that label instead of overwriting it. The elapsed seconds still land on
     the confirm button either way, which is what this pin is about. */
  ok(src.indexOf('wfsumStopTick') > 0 && src.indexOf("(state.batchRunning ? (S(state.batchLabel) || wfsumVerb) : wfsumVerb) + '... ' + secs + 's'") > 0,
    'the execute loading bar ticks elapsed seconds on the confirm button');
  ok(/wfsumStopTick\(\);\s*\n\s*if \(state\.closed \|\| unifiedAthenaState !== state\) return;/.test(src),
    'both bridge handlers stop the ticker before anything else');
}

/* ---- VM harness (same shape as the bind-cure suite) ---- */
function makeContext() {
  const store = new Map();
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  function elementStub() {
    const el = {
      style: {}, dataset: {}, attrs: {}, children: [], _on: {},
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return el.attrs[k] != null ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el._on[t] = el._on[t] || []).push(fn); },
      removeEventListener() {},
      appendChild(c) { el.children.push(c); return c; },
      insertBefore(c) { el.children.push(c); return c; },
      remove() {}, focus() {}, select() {},
      click() { (el._on.click || []).forEach(fn => fn({})); },
      querySelector(sel) { return String(sel || '').charAt(0) === '#' ? resolveId(sel) : null; },
      querySelectorAll: () => [], closest: () => null,
      classList: { add() {}, remove() {}, contains() { return false; } },
      textContent: '', value: '', disabled: false
    };
    let html = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return html; },
      set(v) { html = String(v); el.children.length = 0; }
    });
    return el;
  }
  const byId = new Map();
  function resolveId(sel) {
    const key = String(sel || '').replace(/^#/, '');
    if (!byId.has(key)) byId.set(key, elementStub());
    return byId.get(key);
  }
  const document = {
    readyState: 'complete', activeElement: null,
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return String(sel || '').charAt(0) === '#' ? resolveId(sel) : null; },
    querySelectorAll: () => [],
    getElementById(id) { return resolveId(id); },
    createElement: elementStub,
    body: elementStub(), head: elementStub(), documentElement: elementStub(),
    execCommand() { return false; }
  };
  const window = {
    _calAppts: [],
    uns: n => `acct:${n}`,
    addEventListener() {}, removeEventListener() {},
    document, localStorage,
    location: { origin: 'https://mlsscribe.com' },
    postMessage() {},
    toast() {}
  };
  window.window = window;
  const ctx = vm.createContext({
    window, document, localStorage,
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: () => 1, clearTimeout: () => {},
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    console
  });
  return { ctx, window, resolveId };
}

const PATIENT = { id: 'syn-wfsum-pid', patientId: 'syn-wfsum-pid', name: 'Synthetic Patient Wfsum', dob: '02/02/1980', mrn: '100888' };

function openReview(wf, sessionId) {
  return wf.openUnifiedConfirmation({
    patient: PATIENT,
    sections: [
      { key: 'hpi', text: 'Synthetic HPI body for the wfsum suite.' },
      { key: 'ros', text: 'Synthetic ROS body for the wfsum suite.' }
    ],
    requireExpectedVisit: true,
    receiptSessionId: sessionId
  });
}

(function run() {
  const h = makeContext();
  vm.runInContext(src, h.ctx, { filename: '1p-feat_mls_writeflow.js' });
  const wf = h.window.__mlsWriteFlow;
  ok(wf && wf.installed, 'writeflow installed in the VM');
  const seam = wf.diagnostics.receiptLedger;
  ok(seam && seam.v === 'wfsum-1.0.0', 'the wfsum seam is exported');

  /* ---- 1. a verified outcome survives a reopen of the SAME review ---- */
  const SESSION = 'wfsum-session-alpha';
  const m1 = openReview(wf, SESSION);
  ok(m1 && m1.receiptSessionId === SESSION, 'the manifest carries the caller receiptSessionId');
  const state1 = wf.diagnostics.state();
  ok(state1 && state1.manifest === m1, 'the sheet state wraps this manifest');
  const hpiRow = m1.rows.filter(r => /hpi/i.test(r.id) || /hpi/i.test(r.label))[0] || m1.rows[0];
  ok(!!hpiRow, 'the review has a first note row to bank');
  const pre = seam.rowState(state1, hpiRow);
  ok(pre.status !== 'verified', 'before anything runs the row is NOT verified (got ' + pre.status + ')');
  seam.remember(state1, hpiRow.id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });

  const m2 = openReview(wf, SESSION); /* the reopen: fresh state, empty receipts */
  const state2 = wf.diagnostics.state();
  ok(state2 !== state1, 'the reopen minted a brand-new state object');
  ok(Object.keys(state2.receipts).length === 0, 'the reopen wiped state.receipts (the measured defect)');
  const row2 = m2.rows.filter(r => r.id === hpiRow.id)[0];
  ok(!!row2, 'the reopened manifest has the same row id');
  const after = seam.rowState(state2, row2);
  ok(after.status === 'verified', 'REOPEN TRUTH: the row stays VERIFIED (got ' + after.status + ')');
  ok(/from earlier in this review/.test(after.message), 'and says the outcome came from earlier in this review');

  /* ---- 2. a DIFFERENT review inherits nothing ---- */
  const m3 = openReview(wf, 'wfsum-session-beta');
  const state3 = wf.diagnostics.state();
  const row3 = m3.rows.filter(r => r.id === hpiRow.id)[0];
  ok(!!row3, 'the beta review has the same row id');
  const beta = seam.rowState(state3, row3);
  ok(beta.status !== 'verified', 'a NEW review (new session id) must NOT inherit the alpha outcome (got ' + beta.status + ')');

  /* ---- 3. an uncertain outcome ALSO survives ---- */
  seam.remember(state3, row3.id, { status: 'uncertain', message: 'No completion response; inspect Athena before retrying.' });
  openReview(wf, 'wfsum-session-beta');
  const state3b = wf.diagnostics.state();
  const unc = seam.rowState(state3b, row3);
  ok(unc.status === 'uncertain', 'an UNCERTAIN outcome survives the reopen (the halt story stays visible), got ' + unc.status);

  /* ---- 4. a blocked refusal is NOT banked ---- */
  seam.remember(state3b, 'row-blocked-probe', { status: 'blocked', message: 'Athena refused (context-unverified).' });
  ok(seam.rowState(state3b, { id: 'row-blocked-probe', capability: 'ready', reason: '' }).status === 'not attempted',
    'a blocked refusal is never banked - the next probe re-decides it');

  /* ---- 5. note-editor-not-empty refusals paint ALREADY IN ATHENA ---- */
  const notEmptyRow = { id: 'row-hpi-full', capability: 'blocked', reason: 'Refused: note-editor-not-empty - the destination field already holds text.' };
  const paint = seam.rowState(state3b, notEmptyRow);
  ok(paint.status === 'already in Athena', 'note-editor-not-empty paints ALREADY IN ATHENA (got ' + paint.status + ')');
  ok(/nothing to send/i.test(paint.message), 'and the copy says there is nothing to send');
  const otherBlocked = seam.rowState(state3b, { id: 'row-other', capability: 'blocked', reason: 'The exact visit needs its date, provider, and appointment ID.' });
  ok(otherBlocked.status === 'blocked', 'control: any OTHER blocked reason still paints BLOCKED');

  /* ---- 6. completion: banner + Done + nothing left to send ---- */
  const mAll = openReview(wf, 'wfsum-session-gamma');
  const stateAll = wf.diagnostics.state();
  const noteRows = mAll.rows.filter(r => r.action === 'write_note');
  ok(noteRows.length >= 2, 'the gamma review has at least two note rows (got ' + noteRows.length + ')');
  noteRows.forEach(r => seam.remember(stateAll, r.id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' }));
  seam.render(stateAll);
  const host = h.resolveId('mlsAthenaUnifiedReceipt');
  ok(host.innerHTML.indexOf('Everything on this review is in Athena') >= 0,
    'ALL note rows in Athena -> the single green completion banner renders');
  ok(host.innerHTML.indexOf(noteRows.length + ' of ' + noteRows.length + ' note sections verified') >= 0,
    'the banner counts n of n');
  ok(/Save \/ Sign in Athena yourself/.test(host.innerHTML), 'the banner still hands Save/Sign to the human');
  const cancelBtn = h.resolveId('mlsAthenaUnifiedCancel');
  ok(cancelBtn.textContent === 'Done — close review', 'the exit button becomes "Done - close review" (got "' + cancelBtn.textContent + '")');
  /* sheetux-1.0.0: the footer's send button is now the ONE merged primary. */
  const batchBtn = h.resolveId('mlsAthenaUnifiedGo');
  ok(batchBtn.disabled === true && batchBtn.textContent === 'Nothing left to send',
    'the merged send button says there is nothing left to send');

  /* ---- 7. control: one row still unwritten -> NO banner, batch stays live ---- */
  const mHalf = openReview(wf, 'wfsum-session-delta');
  const stateHalf = wf.diagnostics.state();
  const half = mHalf.rows.filter(r => r.action === 'write_note');
  seam.remember(stateHalf, half[0].id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
  const cancelBtn2 = h.resolveId('mlsAthenaUnifiedCancel');
  cancelBtn2.textContent = 'Cancel'; cancelBtn2.style = {};
  const batchBtn2 = h.resolveId('mlsAthenaUnifiedGo');
  batchBtn2.disabled = false; batchBtn2.textContent = 'Confirm & Send to Athena';
  seam.render(stateHalf);
  ok(host.innerHTML.indexOf('Everything on this review is in Athena') < 0,
    'with a row still unwritten there is NO completion banner');
  ok(host.innerHTML.indexOf('What happened') >= 0, 'but the receipt list itself renders (an outcome exists)');
  /* RE-AIMED, wfdone-1.0.0 (2026-09-02). This case guards ONE property:
     completion may never be claimed early. It used to check that by asserting
     the send button was still LIVE - but this fixture's review is UNBOUND, and
     case 8 below proves not one of its rows is sendable, so unifiedPrimaryPlan
     has always answered 'none' for it. The button was live here only because
     this case forced it live two lines up and nothing re-synced it: a live
     Confirm the plan refuses, which is precisely the defect wfdone-1.0.0
     exists to kill. The receipt render now hands such a button the plan's OWN
     reason. The guarded property is unchanged and is what is asserted instead -
     a partly written review is never dressed up as a finished one, and the
     "nothing to send" it is given is the unbound one, not the finished one. */
  ok(batchBtn2.textContent === 'Confirm & Send to Athena',
    'with a row still unwritten the send button was relabelled as though the review were finished');
  ok(batchBtn2.textContent !== 'Nothing left to send',
    'COMPLETION CLAIMED EARLY: a partly written review told the doctor there was nothing left to send');
  ok(batchBtn2.disabled === true &&
    batchBtn2.getAttribute('data-mls-primary-blocked') === wf.diagnostics.sheetClarity.noneReadyReason,
    'a button the plan refuses is still live, or is dead without carrying the plan\'s own reason (got "' +
      batchBtn2.getAttribute('data-mls-primary-blocked') + '")');
  ok(cancelBtn2.textContent === 'Close review (writes stay in Athena)',
    'once anything landed the exit button stops reading like an undo (got "' + cancelBtn2.textContent + '")');

  /* ---- 8. the ledger can never make a row sendable ---- */
  const rowAfter = mHalf.rows.filter(r => r.id === half[0].id)[0];
  ok(rowAfter.capability !== 'ready',
    'this unbound review\'s row is non-sendable by the resolver (capability ' + rowAfter.capability + ') - the premise the next check needs');
  ok(seam.rowState(stateHalf, rowAfter).status === 'verified' && rowAfter.capability !== 'ready',
    'a banked VERIFIED paints truth but the row itself stays non-sendable (capability ' + rowAfter.capability + ') - the ledger holds outcomes, not permissions');

  console.log('PASS 1p-writeflow-receipt-ledger: ' + checks + ' checks - verified/uncertain outcomes survive reopens of the SAME review only, blocked refusals are never banked, note-editor-not-empty paints ALREADY IN ATHENA in green, full completion shows one banner + "Done - close review" + a dead batch button, partial completion shows none of that, and the ledger cannot make a row sendable');
})();
