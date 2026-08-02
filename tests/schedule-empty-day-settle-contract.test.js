/* er-1.2 (3.0.40) SETTLED-EMPTY + SCOPED SERVED-DAY CONTRACT.
 *
 * The 2026-08-02 adversarial audit CONFIRMED (high confidence) that er-1.1
 * (3.0.39) could mint a day-PROVEN false verified-empty: the selected day tab
 * flips the instant it is clicked while the grid's rows load seconds later, so
 * a read racing the weekstrip transition carried schedDate == the requested
 * day beside an emptiness verdict whose evidence was a PRE-scrape probe of the
 * old day - and the day gate then stored a real 12-patient day as verified
 * empty. Its selector ladder was also document-wide: [class*="selected"]
 * substring-matches "unselected", an ancestor "active" wrapper descends to the
 * week's FIRST tab, and a selected date-picker cell echoes the typed date.
 *
 * er-1.2 pins four behaviors, each replayed through the ACTUAL injected reader
 * (mlsSchedDomInline) against stateful fake documents:
 *   1. a transitional grid (rows appear during the 900ms settle) never sets
 *      diag.emptyStable, so the handler's authoritative-empty gate refuses;
 *   2. a genuinely settled empty day sets emptyStable with the served day;
 *   3. a served-day flip during the settle clears schedDate (fail-closed);
 *   4. the ladder is scoped and negative classnames are skipped (BEM
 *      "unselected" tabs can never donate the week's first date), and a rung
 *      whose matches disagree refuses rather than first-match-wins.
 * Plus the handler equation itself: probe-verified empty WITHOUT the frame's
 * settled proof must not be authoritative. */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const candidateChain = ['3.0.40', '3.0.38', '3.0.37', '3.0.36', '3.0.35', '3.0.34', '3.0.33', '3.0.32'].map(v => path.join(root, 'extension-candidates', v, 'background.js'));
const bgPath = candidateChain.find(p => fs.existsSync(p)) || path.join(root, 'background.js');
const background = fs.readFileSync(bgPath, 'utf8');

/* ---- source markers ---- */
for (const marker of [
  'var _edSelDayIso=function(){',
  "if(!r)r=scan(doc,['.day-tab-container.selected','.day-tab.selected']);",
  'out.diag.emptyStable=',
  '&& __dd.emptyStable === true) || __allSlotDay;',
  "out.diag.schedDateVia='settle-disagreement'",
]) {
  assert.ok(background.indexOf(marker) !== -1, 'er-1.2 marker present: ' + marker);
}

/* ---- extract the reader + name parser into a sandbox ---- */
const nameStart = background.indexOf('function mlsParseName(');
const readerStart = background.indexOf('async function mlsSchedDomInline');
const readerEndAnchor = '  }catch(e){out.diag.err=String(e&&e.message||e).slice(0,120);}';
const readerEnd = background.indexOf('  return out;\r\n}', background.indexOf(readerEndAnchor, readerStart)) + '  return out;\r\n}'.length;
assert.ok(nameStart > 0 && readerStart > nameStart && readerEnd > readerStart, 'extraction markers');
const sandbox = vm.createContext({ Date, Math, setTimeout, console, Promise });
vm.runInContext(
  background.slice(nameStart, readerStart) +
  '\nfunction mlsParseDate(s){var m=/(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(s||""));return m?m[0]:"";}\n' +
  background.slice(readerStart, readerEnd) +
  '\nthis.__reader = mlsSchedDomInline;',
  sandbox, { timeout: 10000 });
const reader = sandbox.__reader;
assert.strictEqual(typeof reader, 'function', 'reader extracted');

/* ---- fake DOM ---- */
function el(props) {
  return Object.assign({
    className: '', tagName: 'DIV', textContent: '', children: [],
    getAttribute(n) { return (this.attrs && this.attrs[n] != null) ? this.attrs[n] : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  }, props);
}
function dayTab(cls, iso) {
  return el({ className: cls, attrs: { 'data-date-value': iso } });
}
/* qsa/qs maps may be functions (called per invocation) for stateful fixtures */
function fakeDoc(qsaMap, qsMap, innerText) {
  const calls = {};
  return {
    location: { pathname: '/22724/6/ax/dashboard' },
    body: { get innerText() { return (typeof innerText === 'function') ? innerText() : (innerText || ''); } },
    querySelectorAll(sel) {
      calls[sel] = (calls[sel] || 0) + 1;
      const v = qsaMap[sel];
      if (typeof v === 'function') return v(calls[sel]);
      return v || [];
    },
    querySelector(sel) {
      const v = qsMap[sel];
      if (typeof v === 'function') return v();
      return v != null ? v : null;
    },
    __calls: calls,
  };
}
const GATE = '.calendar-nav,[class~="appointments-container"],.day-tab-container,[data-date-value],h1.fe_c_heading--subsection';

let n = 0;
function ok(name) { n++; console.log('ok ' + n + ' - ' + name); }

(async () => {
  /* 1. transitional grid: zero rows at parse, rows appear during the settle */
  {
    const cnav = el({
      querySelectorAll(sel) {
        if (sel === '.day-tab-container.selected') return [dayTab('day-tab-container selected', '2026-08-07')];
        return [];
      },
    });
    const doc = fakeDoc(
      { '[class~="filled-appointment-row"]': (call) => (call === 1 ? [] : [el({}), el({})]) },
      { '.calendar-nav': cnav, [GATE]: el({}) },
      'No appointments'
    );
    const out = await reader(doc, {});
    assert.strictEqual(out.appts.length, 0, 'no rows parsed');
    assert.strictEqual(out.schedDate, '2026-08-07', 'served day read from the selected tab');
    assert.strictEqual(out.diag.emptyStable, false, 'rows appearing during the settle must break emptyStable: ' + JSON.stringify(out.diag.emptyProof));
    ok('transitional grid (rows paint during settle) never sets emptyStable');
  }

  /* 2. genuinely settled empty day */
  {
    const cnav = el({
      querySelectorAll(sel) {
        if (sel === '.day-tab-container.selected') return [dayTab('day-tab-container selected', '2026-08-07')];
        return [];
      },
    });
    const doc = fakeDoc(
      { '[class~="filled-appointment-row"]': [] },
      { '.calendar-nav': cnav, [GATE]: el({}) },
      'No appointments scheduled for this day'
    );
    const out = await reader(doc, {});
    assert.strictEqual(out.schedDate, '2026-08-07');
    assert.strictEqual(out.diag.schedDateVia, 'weektab-selected-day-tab');
    assert.strictEqual(out.diag.emptyStable, true, 'settled empty day must prove stable: ' + JSON.stringify(out.diag.emptyProof));
    ok('settled empty day sets emptyStable with the served day');
  }

  /* 3. served-day flip during the settle clears the date (fail-closed) */
  {
    let flip = 0;
    const cnav = el({
      querySelectorAll(sel) {
        if (sel === '.day-tab-container.selected') { flip++; return [dayTab('day-tab-container selected', flip === 1 ? '2026-08-06' : '2026-08-07')]; }
        return [];
      },
    });
    const doc = fakeDoc(
      { '[class~="filled-appointment-row"]': [] },
      { '.calendar-nav': cnav, [GATE]: el({}) },
      'No appointments'
    );
    const out = await reader(doc, {});
    assert.strictEqual(out.schedDate, '', 'a flipping served day must clear schedDate');
    assert.strictEqual(out.diag.schedDateVia, 'settle-disagreement');
    assert.strictEqual(out.diag.emptyStable, false, 'a flipping day is never a stable empty');
    ok('served-day flip during settle refuses the date and the empty');
  }

  /* 4a. BEM "unselected" tabs never donate a date */
  {
    const cnav = el({
      querySelectorAll(sel) {
        if (sel === '[class*="selected"]') {
          return [
            dayTab('day-tab day-tab--unselected', '2026-08-03'),
            dayTab('day-tab day-tab--unselected', '2026-08-04'),
            dayTab('day-tab day-tab--selected', '2026-08-06'),
          ];
        }
        return [];
      },
    });
    const doc = fakeDoc(
      { '[class~="filled-appointment-row"]': [] },
      { '.calendar-nav': cnav, [GATE]: el({}) },
      'No appointments'
    );
    const out = await reader(doc, {});
    assert.strictEqual(out.schedDate, '2026-08-06', 'the SELECTED BEM tab wins, never the first unselected: got ' + out.schedDate);
    ok('negative classnames (unselected/deselected/inactive) are skipped');
  }

  /* 4b. rung disagreement refuses rather than first-match-wins */
  {
    const cnav = el({
      querySelectorAll(sel) {
        if (sel === '[aria-selected="true"]') {
          return [dayTab('day-tab', '2026-08-03'), dayTab('date-picker-cell', '2026-08-07')];
        }
        return [];
      },
    });
    const doc = fakeDoc(
      { '[class~="filled-appointment-row"]': [] },
      { '.calendar-nav': cnav, [GATE]: el({}) },
      'No appointments'
    );
    const out = await reader(doc, {});
    assert.ok(!out.schedDate, 'disagreeing selected dates must refuse (no schedDate), got ' + JSON.stringify(out.schedDate));
    assert.strictEqual(out.diag.schedDateAmbiguous, true);
    ok('date disagreement inside one rung refuses (schedDateAmbiguous)');
  }

  /* 4c. document-wide fallback keeps only the precise day-tab selectors */
  {
    assert.ok(background.indexOf("if(!r)r=scan(doc,['.day-tab-container.selected','.day-tab.selected']);") !== -1,
      'document-wide fallback restricted to precise selectors');
    assert.ok(background.indexOf("if(cnav)r=scan(cnav,['.day-tab-container.selected','.day-tab.selected','[aria-selected=\"true\"]','[class*=\"selected\"]','[class*=\"active\"]']);") !== -1,
      'broad rungs only inside .calendar-nav (the proven wsSelectedIso scope)');
    ok('ladder scope pinned: broad rungs only inside .calendar-nav');
  }

  /* 5. handler equation: probe-empty without the frame proof is NOT authoritative */
  {
    const eqStart = background.indexOf('var __authoritativeEmpty = ');
    const eqEnd = background.indexOf('|| __allSlotDay;', eqStart) + '|| __allSlotDay;'.length;
    const eq = new Function('__parsedCount', '__surface', '__dd', '__allSlotDay',
      background.slice(eqStart, eqEnd) + '\nreturn __authoritativeEmpty;');
    const probeEmpty = { probes: [{ verified: true, empty: true }] };
    assert.strictEqual(eq(0, probeEmpty, {}, false), false, 'probe-empty alone must not be authoritative');
    assert.strictEqual(eq(0, probeEmpty, { emptyStable: true }, false), true, 'probe-empty + settled frame proof is authoritative');
    assert.strictEqual(eq(0, probeEmpty, { emptyStable: false }, false), false, 'an unsettled frame refuses');
    assert.strictEqual(eq(0, { probes: [] }, { emptyStable: true }, true), true, 'the narrow all-slot-day proof is preserved');
    ok('handler gate: authoritative-empty requires the settled frame proof');
  }

  console.log('# schedule-empty-day-settle-contract: ' + n + ' checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
