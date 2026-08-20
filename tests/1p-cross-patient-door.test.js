'use strict';

/* xpdoor-1.0.0 — the cross-patient safety stop opens a door, not a dead end.
 *
 * Owner 2026-08-19, reading the live refusal: "this warning it gave is very
 * clunky it should be a better system."
 *
 * The refusal itself is correct and this suite proves it is UNTOUCHED: when
 * athenaOne has patient B open and MLS is on patient A, the extension refuses
 * to read a single encounter body and nothing is saved.
 *
 * What was clunky is what came next. The message sent the doctor away to find
 * or create that patient somewhere else and come back — for an answer MLS
 * already had. Measured at HEAD: background.js returns
 * {ok:false, identity, error} on the safety stop, and feat_visits' driveRequest
 * converts that reply into `new Error(d.error)` keeping only .requestId and
 * .retryOf — so the identity was discarded one layer below the refusal that
 * needed it.
 *
 * xpdoor observes that same reply (already addressed to the page; no new
 * Athena traffic) and offers one button. This suite EXECUTES the shipped block
 * out of 1pScribeFlow.html and proves both halves of the contract:
 *   - the door works: refusal -> one press -> the right patient is selected and
 *     the same pull re-runs;
 *   - the floor holds: every identity ambiguity refuses in words, changes
 *     nothing, and pulls nothing.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const twin = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const autopull = fs.readFileSync(path.join(root, 'feat_athena_autopull.js'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- the guard is not weakened, and the refusal text is untouched ---- */
{
  const SHIPPED = '⚠ athenaOne has a DIFFERENT patient open than the one selected here — MLS ' +
    'stopped on purpose so charts can never mix.';
  ok(autopull.indexOf(SHIPPED) > 0, 'the shipped cross-patient refusal must be unchanged');
  ok(shell.indexOf('xpdoor-1.0.0') > 0, 'the door must ship in 1pScribeFlow.html');
  ok(twin.indexOf('xpdoor-1.0.0') > 0, 'the door must ship in 1p/index.html');
  /* the block must never re-read Athena: no bridge verb of its own */
  const s = shell.indexOf('<!-- ===== xpdoor-1.0.0');
  const e = shell.indexOf('<!-- ===== end xpdoor-1.0.0');
  const blockText = shell.slice(s, e);
  ok(!/postMessage\s*\(/.test(blockText), 'the door must never post a message to Athena');
  ok(!/mlsAppRead|mlsAppSearch/.test(blockText.replace(/mlsAppAllVisitsResult/g, '')),
    'the door must issue no read verb of its own — it observes a reply already sent');
}

/* ---- extract and EXECUTE the shipped block ---- */
function blockSource() {
  const s = shell.indexOf('<!-- ===== xpdoor-1.0.0');
  const e = shell.indexOf('<!-- ===== end xpdoor-1.0.0');
  const seg = shell.slice(s, e);
  const a = seg.indexOf('<script>') + '<script>'.length;
  const b = seg.lastIndexOf('</script>');
  return seg.slice(a, b);
}
const SRC = blockSource();

function elementStub(id) {
  const el = {
    id: id || '', style: {}, children: [], _on: {},
    tagName: 'DIV', textContent: '',
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(t, fn) { (el._on[t] = el._on[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    remove() { if (el.parentNode) { const i = el.parentNode.children.indexOf(el); if (i >= 0) el.parentNode.children.splice(i, 1); } },
    click() { (el._on.click || []).forEach(fn => fn({})); },
    querySelector(sel) {
      const want = String(sel || '').replace(/^#/, '');
      const scan = node => {
        for (const c of node.children) { if (c.id === want) return c; const hit = scan(c); if (hit) return hit; }
        return null;
      };
      return scan(el);
    },
    querySelectorAll: () => []
  };
  return el;
}

function harness(opts) {
  opts = opts || {};
  const nodes = new Map();
  function byId(id) { if (!nodes.has(id)) nodes.set(id, elementStub(id)); return nodes.get(id); }
  const msgHandlers = [];
  const calls = { setActive: [], pulls: [], created: [], renders: 0 };
  const patients = opts.patients || [];
  let active = opts.active || null;

  const document = {
    readyState: 'complete',
    addEventListener() {}, removeEventListener() {},
    getElementById: id => nodes.has(id) ? nodes.get(id) : null,
    createElement: tag => { const el = elementStub(''); el.tagName = String(tag).toUpperCase(); return el; },
    body: elementStub('body'), documentElement: elementStub('html')
  };
  /* the status line must EXIST for arm() to observe it */
  nodes.set('pullChartStatus', elementStub('pullChartStatus'));
  nodes.set('ptPullAthenaBtn', elementStub('ptPullAthenaBtn'));

  const window = {
    document,
    addEventListener(t, fn) { if (t === 'message') msgHandlers.push(fn); },
    removeEventListener(t, fn) { const i = msgHandlers.indexOf(fn); if (i >= 0) msgHandlers.splice(i, 1); },
    __mlsAthenaAutoPull: {
      namesMatch: (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(),
      normDob: v => String(v || '').replace(/[^0-9]/g, ''),
      resolvePatient: idn => {
        const np = { id: 'p-created-1', name: idn.name, dob: idn.dob, mrn: idn.mrn, athenaId: idn.mrn };
        calls.created.push(np); patients.push(np);
        return { patient: np, created: true, via: 'created' };
      }
    },
    pullPatientFromAthenaPrompt: b => { calls.pulls.push(b); }
  };
  window.window = window;

  const sandbox = {
    window, document, MutationObserver: function (cb) { this.observe = () => {}; this.disconnect = () => {}; this._cb = cb; },
    setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {},
    getPatients: () => patients,
    setActivePtId: id => { calls.setActive.push(id); const p = patients.filter(x => String(x.id) === String(id))[0]; if (p) active = p; },
    activePatient: () => active,
    renderProfile: () => { calls.renders++; }, renderPatientBar: () => {}, renderPatients: () => {},
    console
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx, { filename: 'xpdoor-1.0.0' });
  function deliver(data) { msgHandlers.slice().forEach(fn => fn({ data })); }
  return { ctx, window, byId, deliver, calls, api: window.__mlsXpDoor, status: nodes.get('pullChartStatus') };
}

/* count every door node anywhere under the status line */
function countDoors(node) {
  let n = 0;
  for (const c of node.children) { if (c.id === 'xpDoorSwitch') n++; n += countDoors(c); }
  return n;
}

const SAFETY_ERROR = 'Safety stop: the live patient identity in the encounter-list frame did not match the frozen MLS patient (name plus DOB/MRN). No encounter body was read.';
const REFUSAL = '⚠ athenaOne has a DIFFERENT patient open than the one selected here — MLS stopped on purpose so charts can never mix.';
const CHART = { name: 'Maria Sandoval', dob: '04/11/1962', mrn: '7618711' };

function stop(identity) {
  return { type: 'mlsAppAllVisitsResult', ok: false, error: SAFETY_ERROR, identity: identity || CHART };
}

/* ---- 1. the identity the app used to throw away is captured ---- */
{
  const h = harness({});
  ok(h.api && h.api.installed, 'the door must install');
  ok(h.api.captured() === null, 'nothing is captured before a safety stop');
  h.deliver(stop());
  const cap = h.api.captured();
  ok(cap && cap.name === 'Maria Sandoval', 'the safety stop identity must be captured');
  ok(cap.dob === '04/11/1962' && cap.mrn === '7618711', 'DOB and MRN must be captured');
}
{
  const h = harness({});
  h.deliver({ type: 'mlsAppAllVisitsResult', ok: true, identity: CHART });
  ok(h.api.captured() === null, 'a SUCCESSFUL read must not arm the door');
  h.deliver({ type: 'mlsAppAllVisitsResult', ok: false, error: 'timeout', identity: CHART });
  ok(h.api.captured() === null, 'an unrelated failure must not arm the door');
  h.deliver(stop({ name: '', dob: '04/11/1962' }));
  ok(h.api.captured() === null, 'a nameless identity must not arm the door');
}

/* ---- 2. the door renders only on the real refusal ---- */
{
  const h = harness({});
  h.deliver(stop());
  h.status.textContent = 'Reading the chart…';
  h.api._test.offerDoor();
  ok(!h.status.querySelector('#xpDoorSwitch'), 'no door on an unrelated status line');
  h.status.textContent = REFUSAL;
  h.api._test.offerDoor();
  const btn = h.status.querySelector('#xpDoorSwitch');
  ok(btn, 'the refusal must offer the door');
  ok(btn.textContent === 'Switch to Maria Sandoval here and pull their chart',
    'the door must NAME the patient athenaOne has open (got "' + btn.textContent + '")');
  /* a repaint must not stack a second door */
  h.api._test.offerDoor();
  h.api._test.offerDoor();
  ok(countDoors(h.status) === 1, 'repeated repaints must leave exactly one door (got ' + countDoors(h.status) + ')');
}
{
  const h = harness({});
  h.status.textContent = REFUSAL;
  h.api._test.offerDoor();
  ok(!h.status.querySelector('#xpDoorSwitch'), 'no door without a captured identity — MLS must not invent a name');
}

/* ---- 3. one press: the right existing patient is selected, pull re-runs ---- */
{
  const existing = { id: 'p-maria', name: 'Maria Sandoval', dob: '04/11/1962', mrn: '7618711', athenaId: '7618711' };
  const h = harness({ patients: [existing], active: { id: 'p-other', name: 'Someone Else' } });
  h.deliver(stop());
  h.status.textContent = REFUSAL;
  h.api._test.offerDoor();
  h.status.querySelector('#xpDoorSwitch').click();
  ok(h.calls.setActive.length === 1 && h.calls.setActive[0] === 'p-maria',
    'the press must select the matching MLS record');
  ok(h.calls.created.length === 0, 'an existing record must never be duplicated');
  ok(h.calls.pulls.length === 1, 'the same pull must re-run exactly once');
  ok(/Switched to Maria Sandoval/.test(h.status.textContent), 'the line must say what happened');
}

/* ---- 4. no candidate at all: created from the captured identity, then pulled ---- */
{
  const h = harness({ patients: [], active: { id: 'p-other', name: 'Someone Else' } });
  h.deliver(stop());
  h.status.textContent = REFUSAL;
  h.api._test.offerDoor();
  h.status.querySelector('#xpDoorSwitch').click();
  ok(h.calls.created.length === 1, 'with no candidate the patient is created from the captured identity');
  ok(h.calls.created[0].dob === '04/11/1962' && h.calls.created[0].mrn === '7618711',
    'the created record must carry the identity athenaOne reported');
  ok(h.calls.setActive[0] === 'p-created-1', 'the new record must be selected');
  ok(h.calls.pulls.length === 1, 'the pull must re-run');
  ok(/Added Maria Sandoval/.test(h.status.textContent), 'the line must say the record was added');
}

/* ---- 5. THE FLOOR: every ambiguity refuses, changes nothing, pulls nothing ---- */
const conflicts = [
  ['same MRN, different DOB',
    [{ id: 'p1', name: 'Maria Sandoval', dob: '01/01/1970', mrn: '7618711', athenaId: '7618711' }],
    /different date of birth/],
  ['same MRN on two records',
    [{ id: 'p1', name: 'Maria Sandoval', dob: '04/11/1962', athenaId: '7618711' },
     { id: 'p2', name: 'Maria S Sandoval', dob: '04/11/1962', athenaId: '7618711' }],
    /more than one record here carries MRN/],
  ['same MRN, different name and no corroborating DOB',
    [{ id: 'p1', name: 'Robert Nguyen', dob: '', mrn: '7618711', athenaId: '7618711' }],
    /under a different name/],
  ['name+DOB matches two records',
    [{ id: 'p1', name: 'Maria Sandoval', dob: '04/11/1962' },
     { id: 'p2', name: 'Maria Sandoval', dob: '04/11/1962' }],
    /more than one record here matches that name and date of birth/],
  ['name+DOB match carries a different MRN',
    [{ id: 'p1', name: 'Maria Sandoval', dob: '04/11/1962', athenaId: '9999999' }],
    /different MRN/]
];
conflicts.forEach(function (row) {
  const h = harness({ patients: row[1].slice(), active: { id: 'p-other', name: 'Someone Else' } });
  h.deliver(stop());
  h.status.textContent = REFUSAL;
  h.api._test.offerDoor();
  h.status.querySelector('#xpDoorSwitch').click();
  ok(row[2].test(h.status.textContent), row[0] + ': the refusal must name the reason (got "' + h.status.textContent + '")');
  ok(/Nothing was changed and nothing was saved/.test(h.status.textContent), row[0] + ': the refusal must say nothing changed');
  ok(h.calls.setActive.length === 0, row[0] + ': no patient may be selected');
  ok(h.calls.created.length === 0, row[0] + ': no record may be created');
  ok(h.calls.pulls.length === 0, row[0] + ': nothing may be pulled');
});

/* a chart with neither DOB nor MRN can never be matched */
{
  const h = harness({ patients: [{ id: 'p1', name: 'Maria Sandoval', dob: '04/11/1962' }], active: { id: 'p-other' } });
  h.deliver(stop({ name: 'Maria Sandoval', dob: '', mrn: '' }));
  h.status.textContent = REFUSAL;
  h.api._test.offerDoor();
  h.status.querySelector('#xpDoorSwitch').click();
  ok(/did not report a date of birth or an MRN/.test(h.status.textContent),
    'a chart with no DOB and no MRN must refuse, never guess');
  ok(h.calls.setActive.length === 0 && h.calls.created.length === 0 && h.calls.pulls.length === 0,
    'nothing may happen for an unidentifiable chart');
}

/* ---- 6. the switch is VERIFIED before the pull re-runs ---- */
{
  const existing = { id: 'p-maria', name: 'Maria Sandoval', dob: '04/11/1962', mrn: '7618711', athenaId: '7618711' };
  const h = harness({ patients: [existing], active: { id: 'p-other', name: 'Someone Else' } });
  /* a store that refuses the switch */
  vm.runInContext('setActivePtId = function () { /* refuses */ };', h.ctx);
  h.deliver(stop());
  h.status.textContent = REFUSAL;
  h.api._test.offerDoor();
  h.status.querySelector('#xpDoorSwitch').click();
  ok(/could not make Maria Sandoval the selected patient/.test(h.status.textContent),
    'a failed switch must be reported, not assumed');
  ok(h.calls.pulls.length === 0, 'nothing may be pulled when the switch did not take');
}

/* ---- 7. revert ---- */
{
  const h = harness({});
  h.deliver(stop());
  ok(h.api.revert() === true, 'the block must revert');
  h.deliver(stop({ name: 'Someone New', dob: '01/02/1990', mrn: '5555555' }));
  ok(h.api.captured() === null || h.api.captured().name === 'Maria Sandoval',
    'a reverted door must stop capturing');
}

console.log('PASS 1p cross-patient door: ' + checks + ' checks — the safety stop is unchanged and still saves nothing, but it now names the patient athenaOne has open and offers one press that selects (or adds) them, verifies the switch, and re-runs the same read-only pull; five identity ambiguities and an unidentifiable chart each refuse in words, select nothing, create nothing and pull nothing');
