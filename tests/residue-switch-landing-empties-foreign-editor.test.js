'use strict';
/* residue-1.0.0 (2026-09-15) - A SWITCH THAT LANDS WITH ANOTHER PATIENT'S TEXT
 * ON SCREEN EMPTIES THE EDITOR BEFORE THE NEW PATIENT'S OWN WORK COMES BACK.
 *
 * Walkthrough 2026-09-15 (V1): with a transcript typed for patient A, one press
 * on the hero's up-next chip moved the banner to patient B while A's text
 * stayed in the box. The switch chokepoint's preserve-then-reset is skipped
 * for a switch the lock predicts it will refuse, and a refusal the doctor then
 * overrides lands with the previous patient's editor intact. Every WRITE was
 * already refused in that state (ownerAllows: "written for a different
 * patient"), so nothing could be saved or sent under B - but the text was
 * shown under B's banner, which is the cross-patient display class.
 *
 * This suite executes the shipped visitowner-1.0.0 block from BOTH 1p twins in
 * a VM with a minimal document and pins:
 *   1. a switch landing on B with A's editor still owned by A empties it and
 *      counts residueCleared, and B's own stash then restores as before;
 *   2. an ordinary switch (newVisit already ran, owner === B) clears nothing;
 *   3. an editor with no owner is left alone (documented limit, unchanged);
 *   4. the twins carry the byte-identical hunk.
 * Synthetic ids only, no patient text.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const OPEN = '<!-- ===== visitowner-1.0.0';
const CLOSE = '<!-- ===== end visitowner-1.0.0';
let checks = 0;
const eq = (a, b, m) => { checks++; assert.strictEqual(a, b, m + '\n   got: ' + JSON.stringify(a) + '\n   expected: ' + JSON.stringify(b)); };
const ok = (c, m) => { checks++; assert.ok(c, m); };

function blockOf(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const span = src.slice(src.indexOf(OPEN), src.indexOf(CLOSE));
  const s = span.indexOf('<script>'), e = span.lastIndexOf('</script>');
  assert(s > 0 && e > s, file + ': visitowner block script not bounded');
  return span.slice(s + '<script>'.length, e);
}
const twins = ['1pScribeFlow.html', '1p/index.html'].map(blockOf);
eq(twins[0].replace(/\r\n/g, '\n'), twins[1].replace(/\r\n/g, '\n'), 'the two 1p twins carry the same visitowner block');
ok(twins[0].includes('residue-1.0.0'), 'the residue hunk is present');
ok(twins[0].includes("if (owner && owner !== next && editorState().any) {"), 'the guard keys on owner, active id and editor content');
ok(twins[0].includes("newVisit({ patientSwitchReset: true, preserveRecovery: true });"), 'the clear is the engine\'s own switch reset with the recovery slot kept');

function boot() {
  const nodes = {};
  const node = (id) => nodes[id] || (nodes[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, children: [], childElementCount: 0, classList: { remove() {}, add() {} }, querySelector() { return null; }, remove() {} });
  const listeners = {};
  const store = {};
  let active = '';
  const ctx = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Error, Promise, setTimeout, clearTimeout, clearInterval,
    setInterval: (f, ms) => { const t = setInterval(f, ms); t.unref(); return t; },
    document: { getElementById: (id) => (id in nodes ? nodes[id] : node(id)), querySelectorAll() { return []; }, addEventListener() {}, body: node('body') },
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    uns: (k) => 'test::' + k,
    getActivePtId: () => active,
    findPatient: (id) => ({ id, name: 'Synthetic ' + id }),
    toast: () => {},
    _acctTodayKey: () => '2026-09-15',
    activePtChosenThisSession: () => true,
    _athenaHandleActivePatientChange: function () {},
    currentSoap: '', currentInsurance: '', currentFormat: 'soap', currentNoteProvenance: 'typed', currentNoteId: null, finalText: '',
    newVisitCalls: [],
  };
  ctx.newVisit = function (opts) {
    ctx.newVisitCalls.push(opts || {});
    node('transcript').value = ''; node('noteBox').value = ''; ctx.currentSoap = ''; ctx.currentInsurance = '';
  };
  ctx.window = ctx;
  ctx.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  ctx.removeEventListener = (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); };
  ctx.dispatchEvent = (ev) => { (listeners[ev.type] || []).slice().forEach((fn) => fn(ev)); return true; };
  node('signLine').style.display = 'none';   /* unsigned editor, as the shell paints it */
  vm.runInNewContext(twins[0], ctx, { filename: 'visitowner.js' });
  assert(ctx.__mlsVisitOwner && ctx.__mlsVisitOwner.installed, 'visitowner did not install');
  return {
    ctx, node,
    setActive(id) { active = id; },
    switchTo(id) { active = id; ctx.dispatchEvent(new ctx.CustomEvent('mls:active-patient-changed', { detail: { patientId: id } })); return new Promise((r) => setTimeout(r, 25)); },
  };
}

(async () => {
  /* 1. the V1 shape: A's editor, banner moves to B, no reset ran ------------- */
  {
    const h = boot();
    const api = h.ctx.__mlsVisitOwner;
    h.setActive('syn-A');
    h.ctx.__mlsVisitEditorOwnerId = 'syn-A';
    h.node('transcript').value = 'typed for the first chart';
    /* B has parked work of its own from earlier */
    h.ctx.sessionStorage.setItem('test::visitDraftByPt', JSON.stringify({ 'syn-B': { ptId: 'syn-B', t: 'parked for the second chart', soap: '', ts: Date.now() } }));
    api.stashBeforeSwitch('syn-A', 'syn-B');           /* what _athenaHandleActivePatientChange does on every path */
    await h.switchTo('syn-B');
    eq(api.residueCleared, 1, 'the foreign editor was counted as residue');
    eq(h.ctx.newVisitCalls.length, 1, 'the engine\'s own reset ran once');
    eq(h.ctx.newVisitCalls[0].patientSwitchReset, true, 'as the switch-internal reset');
    eq(h.ctx.newVisitCalls[0].preserveRecovery, true, 'with the recovery slot kept');
    eq(h.node('transcript').value, 'parked for the second chart', 'and B\'s own parked work came back into the emptied editor');
    eq(api.restored, 1, 'restore counted');
    const stash = JSON.parse(h.ctx.sessionStorage.getItem('test::visitDraftByPt') || '{}');
    eq((stash['syn-A'] || {}).t, 'typed for the first chart', 'A\'s text is parked under A, not lost');
  }
  /* 2. an ordinary switch: newVisit already ran, owner is B ------------------ */
  {
    const h = boot();
    const api = h.ctx.__mlsVisitOwner;
    h.setActive('syn-A');
    h.ctx.__mlsVisitEditorOwnerId = 'syn-A';
    h.node('transcript').value = 'typed for the first chart';
    api.stashBeforeSwitch('syn-A', 'syn-B');
    h.setActive('syn-B');
    h.ctx.newVisit({ patientSwitchReset: true });        /* the chokepoint's reset, as shipped */
    h.ctx.__mlsVisitEditorOwnerId = 'syn-B';
    const before = h.ctx.newVisitCalls.length;
    await h.switchTo('syn-B');
    eq(api.residueCleared, 0, 'nothing counted as residue on an ordinary switch');
    eq(h.ctx.newVisitCalls.length, before, 'no second reset');
    eq(h.node('transcript').value, '', 'editor stays empty (B has no parked work)');
  }
  /* 3. no owner at all: left alone, exactly as before ------------------------ */
  {
    const h = boot();
    const api = h.ctx.__mlsVisitOwner;
    h.setActive('syn-A');
    h.ctx.__mlsVisitEditorOwnerId = '';
    h.node('transcript').value = 'ownerless text';
    await h.switchTo('syn-B');
    eq(api.residueCleared, 0, 'an ownerless editor is not touched (documented limit)');
    eq(h.node('transcript').value, 'ownerless text', 'its text stays');
  }
  console.log('PASS residue-1.0.0: a switch landing on another patient\'s owned text empties the editor, restores the new patient\'s own parked work, and leaves ordinary switches alone (' + checks + ' checks)');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
