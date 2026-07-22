'use strict';

/* v2.9.22 — live Athena v26.3 prior-visit two-stage contract.
 *
 * Live failure this protects (2026-07-14, 0/15 bodies): the clicked
 * li.encounter-list-item first expands metadata (`accordion-open`); its visible
 * slideout trigger then creates a new encounter-summary child iframe whose
 * exact #SECTIONCONTAINER owns the full clinical body.
 *
 * Runs the REAL injected driver (mlsVisitsDriverFn) against a mock accordion
 * DOM: enumerate -> click -> detail must produce row-bound clinical bodies via
 * BOTH the descendant path and the exact-row accordion fallback, stay bound
 * when another row is expanded and huge, refuse non-clinical expansions, and
 * accept already-open rows without collapsing them. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

const driverStart = background.indexOf('function mlsVisitsDriverFn(op, cfg, idx, expectedBinding)');
assert(driverStart >= 0, 'visit DOM driver not found');
const driverEnd = background.indexOf('// ---- orchestrator (background scope', driverStart);
assert(driverEnd > driverStart, 'visit DOM driver end not found');
const driverSource = background.slice(driverStart, driverEnd);

// ---- source-level invariants -----------------------------------------------
for (const invariant of [
  'function isOpenRow(n)',
  'function resolveRow(g, index, expected)',
  'accordion-open',
  'preRowHash',
  'preRowLen',
  'alreadyOpen',
  "op === 'openDetailFrame'",
  "op === 'closeDetailFrame'",
  "op === 'detailFrame'",
  "document.getElementById('SECTIONCONTAINER')",
  "cfg.rowSelectors[s] === 'li.encounter-list-item') ? 400000 : 1200",
  'rowText: t.slice(0, 1200)'
]) assert(driverSource.includes(invariant), `missing accordion-body invariant: ${invariant}`);
assert((driverSource.match(/\[class\*="summary" i\]/g) || []).length >= 2,
  'summary-class detail selectors must be symmetric between pre-click capture and detail scan');
assert(driverSource.includes('rowHash !== expectedBinding.indexTextHash'),
  'exact-row fallback must refuse a body identical to the frozen index text');
assert(driverSource.includes('grewPastIndex && changedSinceClick && clinicalBody(rowRaw)'),
  'exact-row fallback must require growth + change + clinical content');
assert(driverSource.includes('excluded(indexText(row))'),
  'destructive-label click guard must evaluate the row header, not the expanded body');
assert(driverSource.includes("cfg.rowSelectors[s] !== 'li.encounter-list-item' && excluded(t)"),
  'canonical encounter rows must not be dropped because a clinical label says post-op or signed');

// ---- mini DOM with a real-enough selector engine ----------------------------
function parseCompound(sel) {
  sel = sel.trim();
  const out = { tag: '', id: '', classes: [], attrs: [] };
  const tagMatch = sel.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tagMatch) out.tag = tagMatch[0].toLowerCase();
  const idMatch = sel.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) out.id = idMatch[1];
  let rest = sel.slice(tagMatch ? tagMatch[0].length : 0);
  const classRe = /\.([a-zA-Z0-9_-]+)/g;
  let m;
  const restNoAttrs = rest.replace(/\[[^\]]*\]/g, '');
  while ((m = classRe.exec(restNoAttrs))) out.classes.push(m[1]);
  const attrRe = /\[([a-zA-Z0-9_-]+)(?:([*^$|~]?=)"([^"]*)"(\s+i)?)?\]/g;
  while ((m = attrRe.exec(rest))) out.attrs.push({ name: m[1], op: m[2] || '', value: m[3] || '', ci: !!m[4] });
  return out;
}
function attrValue(el, name) {
  if (name === 'class') return String(el.className || '');
  if (name === 'id') return String((el.attrs && el.attrs.id) || '');
  return el.attrs && el.attrs[name] != null ? String(el.attrs[name]) : null;
}
function matchesCompound(el, c) {
  if (!el || !el.tagName) return false;
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && attrValue(el, 'id') !== c.id) return false;
  const cls = String(el.className || '').split(/\s+/).filter(Boolean);
  for (const want of c.classes) if (!cls.includes(want)) return false;
  for (const a of c.attrs) {
    let have = attrValue(el, a.name);
    if (have == null) return false;
    if (!a.op) continue;
    let want = a.value;
    if (a.ci) { have = have.toLowerCase(); want = want.toLowerCase(); }
    if (a.op === '=' && have !== want) return false;
    if (a.op === '*=' && !have.includes(want)) return false;
    if (a.op === '^=' && !have.startsWith(want)) return false;
  }
  return true;
}
function matchesSelector(el, selectorList) {
  return String(selectorList).split(',').some(one => {
    const parts = one.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    if (!matchesCompound(el, parseCompound(parts[parts.length - 1]))) return false;
    let cur = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      const c = parseCompound(parts[i]);
      while (cur && !matchesCompound(cur, c)) cur = cur.parentElement;
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  });
}
function queryAll(rootEl, selectorList, out = []) {
  for (const child of rootEl.children || []) {
    if (matchesSelector(child, selectorList)) out.push(child);
    queryAll(child, selectorList, out);
  }
  return out;
}
function makeEl(tag, opts = {}) {
  return {
    tagName: tag.toUpperCase(),
    _text: opts.text || '',
    attrs: Object.assign({}, opts.attrs || {}),
    className: opts.className || '',
    children: [],
    parentElement: null,
    hidden: false,
    onclick: opts.onclick || null,
    get innerText() {
      let s = this._text;
      for (const c of this.children) { const t = c.innerText; if (t) s += (s ? ' ' : '') + t; }
      return s;
    },
    get textContent() { return this.innerText; },
    getAttribute(name) { return attrValue(this, name); },
    get attributes() { return Object.keys(this.attrs).map(name => ({ name })); },
    getBoundingClientRect() { return { width: 240, height: 26 }; },
    matches(sel) { return matchesSelector(this, sel); },
    closest(sel) { let cur = this; while (cur && cur.tagName) { if (matchesSelector(cur, sel)) return cur; cur = cur.parentElement; } return null; },
    querySelector(sel) { return queryAll(this, sel)[0] || null; },
    querySelectorAll(sel) { return queryAll(this, sel); },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    click() { if (typeof this.onclick === 'function') this.onclick(); else if (this.parentElement && this.parentElement.click) this.parentElement.click(); }
  };
}

const CLINICAL_BODY =
  'HPI: chronic low back pain, worse with standing. Assessment: lumbar radiculopathy M54.16. ' +
  'Physical exam documented. Plan: continue home exercise program and follow-up in four weeks.';

function buildChart(options = {}) {
  const rootEl = makeEl('#document-root');
  /* 3.0.2: enumeration refuses an encounter index that is not inside the real
     "Visits and Cases" panel (the chart landing pane clones the same row
     markup and hydrates first). Mirror the real panel surface here. */
  const panel = makeEl('div', { className: 'visits-panel' });
  panel.appendChild(makeEl('div', { className: 'visits-panel-header', text: 'Visits and Cases' }));
  panel.appendChild(makeEl('div', { className: 'visits-panel-show', text: 'SHOW: All Events (' + (options.rows ? options.rows.length : 3) + ')' }));
  rootEl.appendChild(panel);
  const ul = makeEl('ul', { className: 'encounter-list autostart' });
  panel.appendChild(ul);
  const rows = [];
  const specs = options.rows || [
    { eid: 'enc-1001', header: '01/02/2026 Office visit established', bodyClass: 'clinical-summary-section', body: CLINICAL_BODY + ' Extra descendant-scoped documentation for encounter one.' },
    { eid: 'enc-1002', header: '02/03/2026 Follow-up visit', bodyClass: '', body: CLINICAL_BODY },
    { eid: 'enc-1003', header: '03/04/2026 Procedure injection', bodyClass: '', body: CLINICAL_BODY + ' ' + 'Detailed operative narrative. '.repeat(80) }
  ];
  for (const spec of specs) {
    const li = makeEl('li', { className: 'encounter-list-item previous-visit', attrs: { 'data-encounter-id': spec.eid, 'data-section': 'previous-visit' } });
    const header = makeEl('div', { className: 'accordion-header clickable accordion-trigger', text: spec.header });
    li.appendChild(header);
    li.onclick = () => {
      if (/(^|\s)accordion-open(\s|$)/.test(li.className)) return; // real accordions toggle; keep test deterministic
      li.className += ' accordion-open';
      if (spec.body) {
        const body = spec.bodyClass
          ? makeEl('div', { className: spec.bodyClass, text: spec.body })
          : makeEl('div', { text: spec.body });
        li.appendChild(body);
      }
    };
    if (spec.preOpen) li.onclick();
    ul.appendChild(li);
    rows.push(li);
  }
  return { rootEl, ul, rows };
}

function makeDriver(rootEl, options = {}) {
  const ctx = {
    Map, Math, Number, String, Array, Object, RegExp, Date, JSON,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    location: { href: options.href || 'https://athenanet.athenahealth.com/briefing' },
    document: {
      querySelectorAll: sel => queryAll(rootEl, sel),
      querySelector: sel => queryAll(rootEl, sel)[0] || null,
      getElementById: id => queryAll(rootEl, `[id="${id}"]`)[0] || null,
      body: { innerText: '', textContent: '' }
    }
  };
  ctx.window = ctx;
  vm.runInNewContext(driverSource + '\nthis.__driver = mlsVisitsDriverFn;', ctx, { filename: 'visit-accordion-driver.js', timeout: 2000 });
  return (op, cfg, idx, expected) => {
    const guarded = Object.assign({}, cfg || {});
    /* Production sends one immutable guard on every click-capable operation.
       Keep this DOM fixture faithful to that contract while read-only enumerate
       and detail probes remain intentionally guard-free. */
    if (/^(?:openVisits|click|openDetailFrame|closeDetailFrame)$/.test(op) && !guarded.__requestToken) {
      guarded.__requestToken = 'accordion-runtime';
      guarded.__readDeadline = Date.now() + 60000;
    }
    return ctx.__driver(op, guarded, idx, expected);
  };
}

// ---- scenario 1: fresh accordion — descendant path AND exact-row fallback ----
{
  const chart = buildChart();
  const run = makeDriver(chart.rootEl);
  const idx = run('enumerate', {});
  assert.strictEqual(idx.ok, true, 'enumerate failed');
  assert.strictEqual(idx.selector, 'li.encounter-list-item');
  assert.strictEqual(idx.count, 3);
  assert.strictEqual(idx.indexComplete, true, 'index with data-encounter-id rows must be complete');
  assert(idx.rows.every(r => /^enc:enc-10/.test(r.rowKey)), 'stable keys must come from data-encounter-id');

  const bodies = [];
  for (let i = 0; i < idx.rows.length; i++) {
    const expected = idx.rows[i].binding;
    const clickRes = run('click', {}, i, expected);
    assert.strictEqual(clickRes.clicked, true, `row ${i} click failed: ${clickRes.reason || ''}`);
    const detail = run('detail', {}, i, expected);
    assert.strictEqual(detail.fullDetail, true, `row ${i} body missing: ${detail.reason || ''}`);
    assert(detail.raw.includes('Assessment'), `row ${i} body lost clinical content`);
    assert.strictEqual(detail.binding.rowKey, expected.rowKey, `row ${i} body bound to the wrong row`);
    bodies.push(detail.raw);
  }
  assert(bodies[0].includes('encounter one'), 'descendant-scoped body path broken');
  assert(bodies[1].includes('follow-up in four weeks'), 'exact-row accordion fallback broken');
  assert(bodies[2].length > 1200, 'long expanded row body was truncated or dropped');
  assert.strictEqual(new Set(bodies).size, 3, 'row-scoped bodies must be distinct per encounter');

  // Positional integrity AFTER expansions: re-enumerate must keep all three
  // rows (the huge expanded row must not drop from the explicit selector group)
  // and cap index rowText.
  const idx2 = run('enumerate', {});
  assert.strictEqual(idx2.count, 3, 'expanded rows dropped out of the encounter group');
  assert(idx2.rows.every(r => r.rowText.length <= 1200), 'index rowText must stay capped after expansion');
  assert.deepStrictEqual(idx2.rows.map(r => r.rowKey), idx.rows.map(r => r.rowKey), 'stable keys must survive expansion');
}

// ---- scenario 2: already-open rows (re-pull) are read without collapsing ----
{
  const chart = buildChart({ rows: [
    { eid: 'enc-2001', header: '01/05/2026 Office visit', bodyClass: '', body: CLINICAL_BODY, preOpen: true },
    { eid: 'enc-2002', header: '02/06/2026 Follow-up visit', bodyClass: '', body: CLINICAL_BODY + ' Second encounter narrative.' }
  ] });
  const run = makeDriver(chart.rootEl);
  const idx = run('enumerate', {});
  assert.strictEqual(idx.count, 2);
  const expected0 = idx.rows[0].binding;
  const click0 = run('click', {}, 0, expected0);
  assert.strictEqual(click0.clicked, true);
  assert.strictEqual(click0.alreadyOpen, true, 'already-open row must be recognized');
  assert(/accordion-open/.test(chart.rows[0].className), 'already-open row must NOT be collapsed by a second click');
  const detail0 = run('detail', {}, 0, expected0);
  assert.strictEqual(detail0.fullDetail, true, `already-open body refused: ${detail0.reason || ''}`);
  assert(detail0.raw.includes('Assessment'));
}

// ---- scenario 3: fail-closed — non-clinical or unchanged rows stay refused ---
{
  const chart = buildChart({ rows: [
    { eid: 'enc-3001', header: '01/07/2026 Office visit', bodyClass: '', body: 'No additional documentation available for this encounter row at this practice.' },
    { eid: 'enc-3002', header: '02/08/2026 Office visit', bodyClass: '', body: '' } // click opens but renders nothing
  ] });
  const run = makeDriver(chart.rootEl);
  const idx = run('enumerate', {});
  const exp0 = idx.rows[0].binding;
  run('click', {}, 0, exp0);
  const nonClinical = run('detail', {}, 0, exp0);
  assert.strictEqual(nonClinical.fullDetail, false, 'non-clinical expansion must not become a body');
  assert.strictEqual(nonClinical.reason, 'no-bound-clinical-detail');

  const exp1 = idx.rows[1].binding;
  run('click', {}, 1, exp1);
  const unchanged = run('detail', {}, 1, exp1);
  assert.strictEqual(unchanged.fullDetail, false, 'an expansion that rendered nothing must stay refused');

  // A detail request whose frozen binding matches no live row must fail closed,
  // never rebind to a neighboring row's open body.
  const ghost = { index: 0, rowKey: 'enc:ghost', encounterId: 'ghost', date: '01/07/2026', indexTextHash: 'nope', indexTextLen: 30 };
  const ghostDetail = run('detail', {}, 0, ghost);
  assert.strictEqual(ghostDetail.fullDetail, false, 'ghost binding must not read any body');
}

// ---- scenario 4: a legitimate post-op encounter is not mistaken for Post ----
{
  const chart = buildChart({ rows: [
    { eid: 'enc-4001', header: '04/05/2026 Post-op follow-up visit', bodyClass: '', body: CLINICAL_BODY + ' Post-operative recovery is progressing as expected.' }
  ] });
  const run = makeDriver(chart.rootEl);
  const idx = run('enumerate', {});
  assert.strictEqual(idx.count, 1, 'post-op encounter must remain in the verified index');
  const expected = idx.rows[0].binding;
  const click = run('click', {}, 0, expected);
  assert.strictEqual(click.clicked, true, `post-op encounter was blocked: ${click.reason || ''}`);
  const detail = run('detail', {}, 0, expected);
  assert.strictEqual(detail.fullDetail, true, `post-op clinical body was refused: ${detail.reason || ''}`);
}

// ---- scenario 5: a stale OPEN body on another encounter never leaks ---------
{
  const chart = buildChart({ rows: [
    { eid: 'enc-5001', header: '05/01/2026 Office visit', bodyClass: '', body: '' }, // click renders nothing
    { eid: 'enc-5002', header: '05/02/2026 Follow-up visit', bodyClass: '', body: CLINICAL_BODY + ' Stale neighboring open encounter body.', preOpen: true }
  ] });
  const run = makeDriver(chart.rootEl);
  const idx = run('enumerate', {});
  assert.strictEqual(idx.count, 2);
  const exp0 = idx.rows[0].binding;
  const click0 = run('click', {}, 0, exp0);
  assert.strictEqual(click0.clicked, true);
  const detail0 = run('detail', {}, 0, exp0);
  assert.strictEqual(detail0.fullDetail, false, "a neighboring encounter's open body must never satisfy this row");
  assert.strictEqual(detail0.reason, 'no-bound-clinical-detail');
}

// ---- scenario 6: duplicate stable keys fail the index closed ----------------
{
  const chart = buildChart({ rows: [
    { eid: 'enc-6001', header: '06/01/2026 Office visit', bodyClass: '', body: CLINICAL_BODY },
    { eid: 'enc-6001', header: '06/02/2026 Follow-up visit', bodyClass: '', body: CLINICAL_BODY }
  ] });
  const run = makeDriver(chart.rootEl);
  const idx = run('enumerate', {});
  assert.strictEqual(idx.indexComplete, false, 'duplicate encounter ids must fail the index closed');
}

// ---- scenario 7: 15/15 full pass — every body parsed, keys unique -----------
{
  const specs = [];
  for (let i = 0; i < 15; i++) {
    specs.push({
      eid: `enc-7${String(i).padStart(3, '0')}`,
      header: `${String((i % 12) + 1).padStart(2, '0')}/${String((i % 27) + 1).padStart(2, '0')}/2025 Office visit ${i + 1}`,
      bodyClass: i % 3 === 0 ? 'clinical-summary-section' : '',
      body: CLINICAL_BODY + ` Distinct encounter narrative number ${i + 1}.`
    });
  }
  const chart = buildChart({ rows: specs });
  const run = makeDriver(chart.rootEl);
  const idx = run('enumerate', {});
  assert.strictEqual(idx.count, 15);
  assert.strictEqual(idx.indexComplete, true);
  const keys = new Set();
  let parsed = 0;
  for (let i = 0; i < 15; i++) {
    const expected = idx.rows[i].binding;
    const click = run('click', {}, i, expected);
    assert.strictEqual(click.clicked, true, `15/15 row ${i} click failed: ${click.reason || ''}`);
    const detail = run('detail', {}, i, expected);
    assert.strictEqual(detail.fullDetail, true, `15/15 row ${i} body failed: ${detail.reason || ''}`);
    assert(detail.raw.includes(`number ${i + 1}.`), `15/15 row ${i} carried the wrong encounter's body`);
    keys.add(expected.rowKey);
    parsed++;
  }
  assert.strictEqual(parsed, 15, '15/15 must parse every body');
  assert.strictEqual(keys.size, 15, '15/15 stable keys must be unique');
}

// ---- scenario 8: real two-stage slideout + exact child-frame body -----------
{
  const chart = buildChart({ rows: [
    { eid: 'enc-8001', header: '08/09/2026 Office visit', bodyClass: '', body: CLINICAL_BODY }
  ] });
  let slideoutRequested = false;
  const slideTrigger = makeEl('span', { className: 'slideout-trigger-open' });
  slideTrigger.onclick = () => { slideoutRequested = true; };
  chart.rows[0].appendChild(slideTrigger);
  const runParent = makeDriver(chart.rootEl);
  const idx = runParent('enumerate', {});
  const expected = idx.rows[0].binding;
  assert.strictEqual(runParent('click', {}, 0, expected).clicked, true);
  const opened = runParent('openDetailFrame', {}, 0, expected);
  assert.strictEqual(opened.clicked, true, `second-stage trigger failed: ${opened.reason || ''}`);
  assert.strictEqual(slideoutRequested, true, 'exact row slideout trigger was not clicked');

  const childRoot = makeEl('#document-root');
  childRoot.appendChild(makeEl('div', {
    attrs: { id: 'SECTIONCONTAINER' },
    text: CLINICAL_BODY + ' Exact encounter-summary frame narrative.'
  }));
  const runChild = makeDriver(childRoot, {
    href: 'https://athenanet.athenahealth.com/encounter/summary?FROMSTREAMLINED=1&CROSSFRAMEID=test'
  });
  const detail = runChild('detailFrame', {}, 0, expected);
  assert.strictEqual(detail.fullDetail, true, `exact child-frame body failed: ${detail.reason || ''}`);
  assert.strictEqual(detail.frameContract, true);
  assert(detail.raw.includes('Exact encounter-summary frame narrative'));

  const wrongFrame = makeDriver(childRoot, { href: 'https://athenanet.athenahealth.com/briefing' })('detailFrame', {}, 0, expected);
  assert.strictEqual(wrongFrame.fullDetail, false, 'a non-encounter frame must never satisfy a visit body');
  assert.strictEqual(wrongFrame.reason, 'encounter-frame-contract-mismatch');
}

console.log('PASS exact-row accordion + unique encounter-summary frame contract, fail-closed binding, post-op rows, stale-neighbor/duplicate-key/ghost refusals, 15/15 full pass');
