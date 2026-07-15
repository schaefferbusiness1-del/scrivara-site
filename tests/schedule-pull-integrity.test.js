'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const reference = fs.readFileSync(path.join(root, 'inject_dom.js'), 'utf8');

// The live reader must sweep both virtualized axes, prove the requested scroll
// positions were actually reached, restore scroll state, parse Athena's
// Last/First rows canonically, and reconcile only proven hidden/provider twins.
for (const marker of [
  'bounded Cartesian product',
  '_vsS.scrollTop=_voyS',
  'viewportCoverage=_coverageS',
  '_coverageS.positionsReached===_coverageS.cellsPlanned',
  'mlsParseName(t0)',
  "logicalKey=anchor.appointmentId?('appt:'",
  'out.diag.candidateCount=out.appts.length+_unmS',
  'out.diag.duplicateRowsRemoved=',
  'if(out.appts.length||_unmS)return out'
]) assert(background.includes(marker), `missing live virtualization invariant: ${marker}`);

assert(reference.includes('async function mlsSchedDomInline'));
assert(reference.includes('scrollTop=oldTop'));
assert(reference.includes('candidateCount=Object.keys(candidates).length'));

// Extract and exercise the pure merge helper. A partial DOM viewport and a
// richer text lane must be unioned; obvious UI/reason fragments are rejected.
const start = background.indexOf('var mlsProv = (function () {');
const end = background.indexOf('/* A schedule surface must be proven', start);
assert(start >= 0 && end > start, 'could not locate mlsProv');
const mlsProv = vm.runInNewContext(background.slice(start, end) + '\nmlsProv;', Object.create(null), { timeout: 1000 });

const dom = {
  appts: [
    { time: '8:00 AM', name: 'Alice Alpha', provider: 'Doctor_One_MD' },
    { time: '8:00 AM', name: 'Alice Alpha', provider: 'Doctor_Two_MD' },
    { time: '8:20 AM', name: 'Bob Beta', provider: 'Doctor_One_MD' }
  ],
  providers: ['Doctor_One_MD'], diag: { strategy: 'structure-id' }
};
const text = {
  appts: [
    { time: '8:00 AM', name: 'Alice Alpha', provider: '', reason: 'Follow up' },
    { time: '8:40 AM', name: 'Carol Gamma', provider: 'Doctor_Two_MD' },
    { time: '9:00 AM', name: 'Spine,No', provider: '' },
    { time: '9:20 AM', name: 'Open slot', provider: '' }
  ],
  providers: ['Doctor_Two_MD'], diag: { strategy: 'text' }
};
const merged = mlsProv.merge(dom, text);
assert.deepStrictEqual(Array.from(merged.appts, a => a.name).sort(), ['Alice Alpha', 'Alice Alpha', 'Bob Beta', 'Carol Gamma']);
assert.deepStrictEqual(Array.from(merged.appts.filter(a => a.name === 'Alice Alpha'), a => a.provider).sort(), ['Doctor_One_MD', 'Doctor_Two_MD']);
assert.deepStrictEqual(Array.from(merged.providers).sort(), ['Doctor_One_MD', 'Doctor_Two_MD'], 'provider roster must union every validated reader');
assert.strictEqual(merged.providerDiag.source, 'merged');
assert.strictEqual(merged.providerDiag.domValidRows, 3);
assert.strictEqual(merged.providerDiag.textValidRows, 2);
assert(merged.providerDiag.invalidRowsRemoved >= 1);
assert(merged.providerDiag.slotRowsRemoved >= 1);

// When Athena's live row DOM exposes stable source IDs, capture and preserve
// them through the DOM/text union. This does not fabricate IDs when attributes
// are absent.
function cell(text, attrs = {}) {
  return {
    textContent: text, children: [],
    getAttribute: name => attrs[name] || '',
    querySelectorAll: () => []
  };
}
const headers = [cell('Time'), cell('Patient'), cell('Provider')];
const sourceProvider = cell('Doctor One, MD', { 'data-provider-id': 'provider-live-7' });
const sourceRow = {
  textContent: '8:00 AM Alice Alpha Doctor One, MD', children: [],
  getAttribute: name => name === 'data-appointment-id' ? 'appointment-live-9' : '',
  querySelectorAll: selector => selector.includes('[role="cell"]') ? [cell('8:00 AM'), cell('Alice Alpha'), sourceProvider] : []
};
const sourceGrid = {
  querySelectorAll: selector => {
    if (selector.includes('thead th')) return headers;
    if (selector.includes('tbody tr')) return [sourceRow];
    return [];
  }
};
const sourceDoc = {
  querySelectorAll: selector => {
    if (selector === 'table, [role="grid"], [role="table"]') return [sourceGrid];
    return [];
  }
};
const liveIds = mlsProv.fromDom(sourceDoc);
assert.strictEqual(liveIds.appts.length, 1);
assert.strictEqual(liveIds.appts[0].appointmentId, 'appointment-live-9');
assert.strictEqual(liveIds.appts[0].providerId, 'provider-live-7');
const mergedIds = mlsProv.merge(liveIds, { appts: [{ time: '8:00 AM', name: 'Alice Alpha', provider: 'Doctor One, MD', reason: 'Follow-up' }], providers: ['Doctor One, MD'], diag: {} });
assert.strictEqual(mergedIds.appts[0].appointmentId, 'appointment-live-9');
assert.strictEqual(mergedIds.appts[0].providerId, 'provider-live-7');
assert.strictEqual(mergedIds.appts[0].reason, 'Follow-up');

// A verified frame is not enough: non-empty completion requires at least one
// parsed row, while zero rows need explicit empty-state proof.
assert(background.includes('var __authoritativeEmpty = __parsedCount === 0'));
assert(background.includes('__parsedCount > 0 && __parsedCount >= __expectedCount'));
assert(background.includes("reason: 'schedule-incomplete'"));
assert(background.includes('receipt: __receipt'));

// The visits driver and response handler must not silently re-truncate a
// complete long history after it has reconciled Athena's declared count.
assert(background.includes('var CAP = 500'));
assert(background.includes("reason: 'visits-incomplete'"));
assert(background.includes("visits: (r.visits || []).slice(0, 500), receipt: r.receipt"));
assert(!background.includes("visits: (r.visits || []).slice(0, 40), via: r.via || 'visits-pane'"));

// Exercise a vertically virtualized column whose framework reuses the same DOM
// id for every visible row. The sweep must recover all rows and restore scroll.
(async () => {
  const { mlsSchedDomInline } = require(path.join(root, 'inject_dom.js'));
  const rendered = [
    '8:00 AM Alice Alpha',
    '8:20 AM Bob Beta',
    '8:40 AM Carol Gamma'
  ];
  const scroller = {
    scrollHeight: 460, clientHeight: 200, scrollWidth: 200, clientWidth: 200,
    scrollLeft: 0, scrollTop: 0,
    dispatchEvent: () => {},
    querySelector: () => ({})
  };
  const appointment = {
    id: 'react-recycled-row',
    get textContent() { return rendered[Math.min(rendered.length - 1, Math.floor(scroller.scrollTop / 130))]; },
    getAttribute: () => '',
    querySelectorAll: () => [],
    children: []
  };
  const column = {
    getBoundingClientRect: () => ({ left: 0, right: 200, width: 200 }),
    querySelectorAll: selector => selector.includes('PatientAppointment_appointment-container') ? [appointment] : []
  };
  const header = {
    textContent: 'Doctor_One_MD', children: [],
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, right: 200, width: 200 })
  };
  const doc = {
    defaultView: { getComputedStyle: el => el === scroller ? { overflowX: 'hidden', overflowY: 'auto' } : { overflowX: 'hidden', overflowY: 'hidden' } },
    scrollingElement: null,
    querySelector: selector => selector.includes('PatientAppointment_appointment-container') ? appointment : null,
    querySelectorAll: selector => {
      if (selector === '*') return [scroller];
      if (selector.includes('ScheduleColumn_schedule-column')) return [column];
      if (selector === 'div,span,h1,h2,h3,h4,th,td') return [header];
      return [];
    }
  };
  const swept = await mlsSchedDomInline(doc);
  assert.deepStrictEqual(swept.appts.map(a => a.name), ['Alice Alpha', 'Bob Beta', 'Carol Gamma']);
  assert.strictEqual(swept.diag.candidateCount, 3);
  assert.strictEqual(swept.diag.parsedCount, 3);
  assert.strictEqual(scroller.scrollTop, 0);

  // A true 2D virtualizer exposes some appointments only when BOTH the
  // provider column and the time row are offscreen. Independent axis passes
  // miss Beta Bottom; the Cartesian sweep must see it and prove/restores both
  // stable bounds before the response can be complete.
  const grid = {
    scrollHeight: 500, clientHeight: 180, scrollWidth: 800, clientWidth: 320,
    scrollLeft: 0, scrollTop: 0,
    dispatchEvent: () => {},
    querySelector: () => ({})
  };
  const names2d = () => {
    const right = grid.scrollLeft >= 300;
    const bottom = grid.scrollTop >= 200;
    if (right && bottom) return '11:20 AM Beta Bottom';
    if (right) return '8:20 AM Beta Top';
    if (bottom) return '11:00 AM Alpha Bottom';
    return '8:00 AM Alpha Top';
  };
  const appt2d = {
    id: 'recycled-2d-row',
    get textContent() { return names2d(); },
    getAttribute: () => '', querySelectorAll: () => [], children: []
  };
  const col2d = {
    getBoundingClientRect: () => ({ left: 0, right: 200, width: 200 }),
    querySelectorAll: selector => selector.includes('PatientAppointment_appointment-container') ? [appt2d] : []
  };
  const hdr2d = {
    get textContent() { return grid.scrollLeft >= 300 ? 'Doctor_Two_MD' : 'Doctor_One_MD'; },
    children: [], querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, right: 200, width: 200 })
  };
  const doc2d = {
    defaultView: { getComputedStyle: el => el === grid ? { overflowX: 'auto', overflowY: 'auto' } : { overflowX: 'hidden', overflowY: 'hidden' } },
    scrollingElement: null,
    querySelector: selector => selector.includes('PatientAppointment_appointment-container') ? appt2d : null,
    querySelectorAll: selector => {
      if (selector === '*') return [grid];
      if (selector.includes('ScheduleColumn_schedule-column')) return [col2d];
      if (selector === 'div,span,h1,h2,h3,h4,th,td') return [hdr2d];
      return [];
    }
  };
  const swept2d = await mlsSchedDomInline(doc2d);
  const betaBottom = swept2d.appts.find(a => a.name === 'Beta Bottom');
  assert(betaBottom, 'bounded 2D sweep must recover the offscreen-provider + offscreen-row intersection');
  assert.strictEqual(betaBottom.provider, 'Doctor_Two_MD');
  assert.strictEqual(swept2d.diag.viewportCoverage.complete, true);
  assert.strictEqual(swept2d.diag.viewportCoverage.cellsVisited, swept2d.diag.viewportCoverage.cellsPlanned);
  assert.strictEqual(grid.scrollLeft, 0);
  assert.strictEqual(grid.scrollTop, 0);

  console.log('PASS 2D schedule virtualization, merge, empty-proof, and visit completeness contracts');
})().catch(err => { console.error(err); process.exit(1); });
