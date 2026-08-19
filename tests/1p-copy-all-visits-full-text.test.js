'use strict';

/* cvfull-1.0.0 — "copy every visit" must mean the notes, not the gist.
 *
 * Owner 2026-08-19: "copy every visit from athenaOne must take EVERY VISIT's
 * full text, not just the summary."
 *
 * WHAT WAS MEASURED AT HEAD, and is pinned here so nobody re-derives it:
 *   - "Copy every visit from athenaOne" (feat_visits.js) is an IMPORTER. It
 *     holds no clipboard code whatsoever. This suite asserts that, so the day
 *     someone gives it a clipboard the two controls are reconciled on purpose
 *     rather than by accident.
 *   - Its primary path already refuses anything short of full bodies
 *     (receipt.bodyComplete AND receipt.fullDetail), so the note text IS
 *     pulled and IS stored. The summary took over one step later: the import
 *     ends in summarizeAll() and the cards render v.aiSummary.
 *   - So the fix is not a new pull. It is a copy that reads the STORED bodies.
 *
 * The proof below runs the SHIPPED cvfull block against the SHIPPED histview
 * builders — both extracted out of 1pScribeFlow.html and executed. Only the
 * pvr resolver is stubbed, because that is the seam where stored visits enter
 * the room; every record, every section and every line of copied text is built
 * by the real code. The fixture is fifteen encounters, the count the owner's
 * own patient carries, each with a body marker that cannot appear by accident.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const twin = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const visitsJs = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

function blockSource(text, name) {
  const s = text.indexOf('<!-- ===== ' + name);
  const e = text.indexOf('<!-- ===== end ' + name);
  assert.ok(s > 0 && e > s, name + ' block must be present');
  const seg = text.slice(s, e);
  const a = seg.indexOf('<script>') + '<script>'.length;
  const b = seg.lastIndexOf('</script>');
  return seg.slice(a, b);
}

const CV_SRC = blockSource(shell, 'cvfull-1.0.0');
const HX_SRC = blockSource(shell, 'histview-1.0.0');

/* ================================================================ 1. SHIPPED */
{
  ok(shell.indexOf('cvfull-1.0.0') > 0, 'the copy must ship in 1pScribeFlow.html');
  ok(twin.indexOf('cvfull-1.0.0') > 0, 'the copy must ship in 1p/index.html');

  /* It is a STORE-side copy. It must never touch Athena, and must never
     become a second pull — that machinery is owned elsewhere on purpose. */
  ok(!/postMessage\s*\(/.test(CV_SRC), 'the copy must never post a message to Athena');
  ok(!/mlsAppRead|mlsAppSearch|mlsAppCapture|mlsAppGoto/.test(CV_SRC),
    'the copy must issue no Athena verb of its own — it reads what is already stored');

  /* The whole point: the copied text may never be sourced from the summary. */
  ok(!/aiSummary/.test(CV_SRC), 'the copy must never read aiSummary');
  ok(!/\.summary\b/.test(CV_SRC), 'the copy must never read a record summary field');

  /* It must not reinvent a reader. The builders are histview's. */
  ok(/textBlock/.test(CV_SRC), 'bodies must come from the shipped textBlock builder');
  ok(/forPatient/.test(CV_SRC), 'records must come from the shipped ONE resolver path');
  ok(!/localStorage/.test(CV_SRC), 'the copy must not open a store of its own');
}

/* ---- the measured fact about the control the owner named ---- */
{
  ok(visitsJs.indexOf('Copy every visit from athenaOne') > 0,
    'the athenaOne import bar button must still exist under its shipped label');
  const bar = visitsJs.slice(visitsJs.indexOf('function ensureBar'), visitsJs.indexOf('function start()'));
  ok(!/clipboard|execCommand/.test(bar),
    'MEASURED: the athenaOne bar button is an importer and writes no clipboard — if this fails, ' +
    'the two copy controls must be reconciled deliberately');
  ok(/receipt\.bodyComplete === true/.test(visitsJs) && /receipt\.fullDetail === true/.test(visitsJs),
    'the importer must still refuse an index without full detail — full bodies really are stored');
}

/* ============================================================== 2. HARNESS */
function elementStub(id, cls) {
  const el = {
    id: id || '', className: cls || '', style: {}, children: [], _on: {}, _attr: {},
    tagName: 'DIV', textContent: '', hidden: false, type: '', title: '', value: '',
    setAttribute(k, v) { el._attr[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._attr, k) ? el._attr[k] : null; },
    addEventListener(t, fn) { (el._on[t] = el._on[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    insertBefore(c, ref) {
      const i = el.children.indexOf(ref);
      if (i < 0) el.children.push(c); else el.children.splice(i, 0, c);
      c.parentNode = el; return c;
    },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    select() {},
    click() { (el._on.click || []).forEach(fn => fn({})); },
    get nextSibling() {
      if (!el.parentNode) return null;
      const i = el.parentNode.children.indexOf(el);
      return el.parentNode.children[i + 1] || null;
    },
    querySelector(sel) {
      const want = String(sel || '');
      const hit = node => {
        if (want.charAt(0) === '#') return node.id === want.slice(1);
        if (want.charAt(0) === '.') return String(node.className || '').split(/\s+/).indexOf(want.slice(1)) >= 0;
        return String(node.tagName || '').toLowerCase() === want.toLowerCase();
      };
      const scan = node => {
        for (const c of node.children) { if (hit(c)) return c; const d = scan(c); if (d) return d; }
        return null;
      };
      return scan(el);
    },
    querySelectorAll: () => []
  };
  return el;
}

/* Fifteen encounters — the count the owner's own patient carries. Each body
   carries a marker that cannot occur by accident, and a one-line gist that
   must NEVER reach the clipboard. */
function fixture(opts) {
  opts = opts || {};
  const indexOnlyAt = opts.indexOnlyAt || [];
  const entries = [];
  for (let i = 1; i <= 15; i++) {
    const n = ('0' + i).slice(-2);
    const isIdx = indexOnlyAt.indexOf(i) >= 0;
    const row = isIdx
      ? { indexOnly: true, textHead: '2026-0' + ((i % 9) + 1) + '-1' + (i % 9) + ' Office visit', raw: '' }
      : {
        indexOnly: false,
        raw: [
          'HISTORY OF PRESENT ILLNESS',
          'Patient reports symptoms beginning three days ago. BODYMARK' + n + 'HPI here.',
          'ASSESSMENT',
          'Working diagnosis recorded this visit. BODYMARK' + n + 'ASSESS here.',
          'PLAN',
          'Continue current therapy and review in two weeks. BODYMARK' + n + 'PLAN here.'
        ].join('\n')
      };
    entries.push({
      key: 'visit-' + n,
      date: '2026-0' + ((i % 9) + 1) + '-1' + (i % 9),
      type: 'Office visit ' + n,
      source: 'athena',
      summary: 'GISTONLY' + n + ' one line summary that must never be copied',
      row: row
    });
  }
  return entries;
}

function harness(opts) {
  opts = opts || {};
  const entries = opts.entries || fixture();
  const patient = opts.patient || { id: 'p-tom', name: 'Test Patient', dob: '02/02/1963' };
  const nodes = new Map();
  const clip = { writes: [] };

  const sandbox = {
    console,
    MutationObserver: function (cb) { this.observe = () => {}; this.disconnect = () => {}; this._cb = cb; },
    setInterval: () => 1, clearInterval: () => {}, setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {}
  };
  const ctx = vm.createContext(sandbox);

  /* Publish the REAL renderer first, through histview's own API-only branch
     (it mounts nothing when there is no usable document). */
  sandbox.window = { };
  sandbox.window.window = sandbox.window;
  vm.runInContext(HX_SRC, ctx, { filename: 'histview-1.0.0' });

  /* Now give the realm a document and the store seam, and run the copy. */
  /* A real document finds a node the page just created, not only the ones the
     harness registered — otherwise every status line reads as empty and the
     harness grades a working module as broken. */
  function findById(id) {
    if (nodes.has(id)) return nodes.get(id);
    const scan = node => {
      for (const c of node.children) { if (c.id === id) return c; const d = scan(c); if (d) return d; }
      return null;
    };
    for (const rootNode of nodes.values()) { const hit = scan(rootNode); if (hit) return hit; }
    return null;
  }
  const document = {
    readyState: 'complete',
    addEventListener() {}, removeEventListener() {},
    getElementById: findById,
    createElement: tag => { const el = elementStub(''); el.tagName = String(tag).toUpperCase(); return el; },
    body: elementStub('body'), documentElement: elementStub('html'),
    execCommand: () => true
  };
  sandbox.document = document;
  sandbox.window.document = document;
  sandbox.navigator = {
    clipboard: { writeText: t => { clip.writes.push(t); return Promise.resolve(); } }
  };
  sandbox.window.navigator = sandbox.navigator;
  sandbox.activePatient = () => patient;
  sandbox.window.activePatient = sandbox.activePatient;
  /* the ONE resolver, stubbed at its published boundary */
  sandbox.window.__mlsPtVisits = {
    version: 'pvr-test',
    resolve: () => ({ count: entries.length, entries: entries })
  };

  const section = elementStub('mlsHxSection');
  const lead = elementStub('', 'hx-lead');
  section.appendChild(lead);
  nodes.set('mlsHxSection', section);

  vm.runInContext(CV_SRC, ctx, { filename: 'cvfull-1.0.0' });

  const api = sandbox.window.__mlsCvFull;
  return { ctx, sandbox, api, section, nodes, clip, patient, entries,
    enc: sandbox.window.__mlsEncView,
    byId: id => nodes.get(id) || null };
}

/* ===================================== 3. THE REAL BUILDERS ARE REACHABLE */
{
  const h = harness();
  ok(h.enc && typeof h.enc.textBlock === 'function', 'the shipped histview builders must be published');
  ok(h.api && h.api.installed, 'the copy module must install');
  const v = h.api._test.view();
  ok(v && v.records.length === 15, 'the room must resolve all fifteen encounters, got ' + (v && v.records.length));
}

/* ============================ 4. EVERY VISIT'S FULL TEXT, NOT THE SUMMARY */
{
  const h = harness();
  const built = h.api._test.compose(h.api._test.view(), 'Test Patient');
  ok(built && built.text, 'the copy must build text');

  for (let i = 1; i <= 15; i++) {
    const n = ('0' + i).slice(-2);
    ok(built.text.indexOf('BODYMARK' + n + 'HPI') >= 0, 'visit ' + n + ' HPI body must be copied in full');
    ok(built.text.indexOf('BODYMARK' + n + 'ASSESS') >= 0, 'visit ' + n + ' assessment must be copied in full');
    ok(built.text.indexOf('BODYMARK' + n + 'PLAN') >= 0, 'visit ' + n + ' plan must be copied in full');
  }
  ok(!/GISTONLY/.test(built.text), 'THE DEFECT: no one-line summary may ever reach the copy');

  ok(built.tally.total === 15 && built.tally.full === 15,
    'all fifteen must be graded as carrying a full note');
  ok(/15 encounters/.test(built.text), 'the copy must state its own count');
  ok(built.text.indexOf('AT A GLANCE') >= 0, 'the glance table must head the copy');

  /* oldest first, like the chronology the same builders already produce */
  const first = built.text.indexOf('BODYMARK01HPI');
  const last = built.text.indexOf('BODYMARK15HPI');
  ok(first > 0 && last > 0, 'both ends must be present');
}

/* ===================================== 5. NO CLAIM IT CANNOT PROVE (W4) */
{
  const h = harness({ entries: fixture({ indexOnlyAt: [3, 9] }) });
  const built = h.api._test.compose(h.api._test.view(), 'Test Patient');
  ok(built.tally.total === 15, 'the total must still be fifteen');
  ok(built.tally.full === 13, 'thirteen must carry a full note, got ' + built.tally.full);
  ok(built.tally.indexOnly === 2, 'two must be graded index only, got ' + built.tally.indexOnly);
  ok(/2 index only/.test(built.text), 'the copy must NAME the two that carry no note text');
  ok(/Where a note is missing above it is missing from the record/.test(built.text),
    'the copy must say where the gap actually is');
  ok(built.text.indexOf('BODYMARK03HPI') < 0, 'an index-only encounter has no body to copy');
  ok(built.text.indexOf('BODYMARK04HPI') >= 0, 'its neighbours must be unaffected');
  ok(!/every visit|all visits/i.test(built.text),
    'the copy must never claim "every visit" when some carry no note text');
}
{
  /* the grades, directly */
  const h = harness();
  const g = h.api._test.grade;
  ok(g({ indexOnly: true, sections: [] }) === 'indexOnly', 'index-only must grade as index-only');
  ok(g({ illegible: true, sections: [] }) === 'illegible', 'illegible must grade as illegible');
  ok(g({ sections: [] }) === 'empty', 'a record with no sections must grade as empty');
  ok(g({ sections: [{ label: 'Plan', parts: [] }] }) === 'full', 'a record with sections grades as full');
  ok(g(null) === 'empty', 'a missing record must never grade as full');

  const t = h.api._test.tally([{ sections: [{}] }, { indexOnly: true }, { illegible: true }, { sections: [] }]);
  ok(t.total === 4 && t.full === 1 && t.indexOnly === 1 && t.illegible === 1 && t.empty === 1,
    'every grade must be counted');
  const line = h.api._test.tallyLine(t);
  ok(/1 with the full note/.test(line), 'the tally must lead with what it can prove');
  ok(/1 index only/.test(line) && /1 not legible/.test(line) && /1 with no documented text/.test(line),
    'the tally must name all three kinds of gap: ' + line);
}

/* ================================================= 6. IT REACHES THE CLIPBOARD */
{
  const h = harness();
  ok(h.api.copy() === true, 'the copy must run');
  ok(h.clip.writes.length === 1, 'exactly one clipboard write');
  const text = h.clip.writes[0];
  ok(text.indexOf('BODYMARK01HPI') >= 0 && text.indexOf('BODYMARK15PLAN') >= 0,
    'the clipboard must carry the first and last encounters in full');
  ok(!/GISTONLY/.test(text), 'the clipboard must never carry a summary');
  ok(h.api.last() && h.api.last().tally.full === 15, 'the module must remember what it proved');
}
{
  /* clipboard refused -> say so, never a silent success */
  const h = harness();
  h.sandbox.navigator.clipboard = null;
  h.sandbox.document.execCommand = () => false;
  h.api._test.mount();
  h.api.copy();
  const say = h.section.querySelector('#' + h.api._test.sayId);
  ok(say && /would not let MLS copy/.test(say.textContent),
    'a refused clipboard must be reported, got: ' + (say && say.textContent));
}
{
  /* nothing on the chart -> nothing claimed */
  const h = harness({ entries: [] });
  ok(h.api.copy() === false, 'an empty chart must not claim a copy');
  ok(h.clip.writes.length === 0, 'and must write nothing');
}

/* The success path reports through the clipboard PROMISE, so a status line
   read in the same synchronous turn is always empty. Await a turn — asserting
   it synchronously would grade the module on the harness's impatience. */
const tick = () => new Promise(r => setImmediate(r));

async function main() {

/* ======================================================== 7. THE CONTROL */
{
  const h = harness();
  ok(h.api._test.mount() === true, 'the control must mount into the visits room');
  const btn = h.section.querySelector('#' + h.api._test.btnId);
  ok(btn, 'the button must exist');
  ok(/full notes/.test(btn.textContent), 'the label must say what it copies: ' + btn.textContent);
  ok(/15 encounters/.test(btn.textContent), 'the label must carry the real count: ' + btn.textContent);
  ok(parseInt(String(btn.style.cssText).match(/min-height:(\d+)px/)[1], 10) >= 40,
    'the control must meet the 40px touch floor');

  /* a repaint must never leave two of them */
  h.api._test.mount(); h.api._test.mount();
  let n = 0;
  const scan = node => { for (const c of node.children) { if (c.id === h.api._test.wrapId) n++; scan(c); } };
  scan(h.section);
  ok(n === 1, 'exactly one copy control per surface, found ' + n);

  /* pressing it copies */
  btn.click();
  ok(h.clip.writes.length === 1, 'the button press must copy');
  await tick();
  const say = h.section.querySelector('#' + h.api._test.sayId);
  ok(/Copied 15 encounters/.test(say.textContent), 'the status must report the real count: ' + say.textContent);
  ok(/15 with the full note/.test(say.textContent), 'the status must prove what it copied: ' + say.textContent);
  ok(!/GISTONLY|BODYMARK/.test(say.textContent), 'the status line must stay free of chart text');
}
{
  /* the status must degrade honestly too: gaps named, never rounded away */
  const h = harness({ entries: fixture({ indexOnlyAt: [3, 9] }) });
  h.api._test.mount();
  h.section.querySelector('#' + h.api._test.btnId).click();
  await tick();
  const say = h.section.querySelector('#' + h.api._test.sayId);
  ok(/Copied 15 encounters/.test(say.textContent), 'the total must be stated: ' + say.textContent);
  ok(/13 with the full note/.test(say.textContent), 'the provable part must be stated: ' + say.textContent);
  ok(/2 index only/.test(say.textContent), 'the gap must be stated at the control too: ' + say.textContent);
}
{
  /* no encounters -> no control at all */
  const h = harness({ entries: [] });
  ok(h.api._test.mount() === false, 'an empty chart must not grow a copy control');
  ok(!h.section.querySelector('#' + h.api._test.btnId), 'and no button may appear');
}
{
  /* revert puts the room back */
  const h = harness();
  h.api._test.mount();
  ok(h.section.querySelector('#' + h.api._test.wrapId), 'mounted first');
  ok(h.api.revert() === true, 'revert must report success');
  ok(!h.section.querySelector('#' + h.api._test.wrapId), 'revert must remove the control');
  ok(h.api._test.mount() === false, 'and it must stay off after revert');
}

}

main().then(function () {
  console.log('1p-copy-all-visits-full-text: ' + checks + ' checks passed');
}, function (err) {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
