'use strict';

/* 2026-07-29 contract: next-week day views render through the week-tab
 * dashboard, where the per-container provider header does NOT carry the
 * classic appointment-header2 class. The legacy day-grid roster derivation
 * must corroborate a fully-read grid from bounded header paint variants
 * (variant-classed nodes inside the container, container attributes, the
 * immediately preceding sibling, parent-scoped headers) - every candidate
 * still gated by the credential-anchored lh() shape. Fail-closed rules are
 * unchanged: zero headers or ambiguous headers refuse exactly as before and
 * a provider is never invented.
 *
 * Rev-3 (3.0.34): live Aug-4 selected-provider proof - a COMPLETE 2/2
 * request-bound read still ended provider-roster-incomplete and the receipt
 * could not say why (reason:legacy-unverified, targetDate:""). Two fixes,
 * both pinned here: (a) the attribution-coverage block now ALWAYS stamps
 * attributionCoverage.verdict naming the FIRST failing conjunct
 * ('already-complete' | 'schedule-incomplete' | 'authoritative-empty' |
 * 'request-id-mismatch' | 'no-rows' | 'no-headers' | 'row-unattributed' |
 * 'attribution-not-in-headers' | 'satisfied') - upgrade conditions are
 * byte-for-byte the same conjuncts as rev-2; (b) the legacy day-grid lane
 * never set out.schedDate (the week widget prints no prose date), so the
 * handler stamped targetDate:'' on every legacy roster receipt - the lane now
 * reads the selected day tab's data-date-value (the same source the weekstrip
 * goto reader proved live) and still refuses to guess when unreadable. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
/* 2026-07-29: this contract pins the STAGED candidate reader. Candidates live
   in extension-candidates/ so the published repo bytes stay coherent with the
   live feed; on publish, background.js itself carries these changes and the
   candidate path naturally wins either way. Newest candidate wins. */
const candidateChain = ['3.0.44', '3.0.43', '3.0.42', '3.0.41', '3.0.40', '3.0.38', '3.0.37', '3.0.36', '3.0.35', '3.0.34', '3.0.33', '3.0.32'].map(v => path.join(root, 'extension-candidates', v, 'background.js'));
const background = fs.readFileSync(candidateChain.find(p => fs.existsSync(p)) || path.join(root, 'background.js'), 'utf8');

for (const marker of [
  'function _legacyHeaderTextsL(list)',
  '_legacyHeaderTextsL(list).forEach(function(raw)',
  '_legacyHeaderTextsL(list).forEach(function(h)',
  "list.querySelectorAll('[class~=\"appointment-header2\"]')",
  "reason: 'attribution-coverage'",
  "corroboratedBy: 'complete-bound-schedule'",
  /* rev-3 (3.0.34) invariants */
  "__acVerdict = 'row-unattributed'",
  "__acVerdict = 'attribution-not-in-headers'",
  "__acVerdict = 'request-id-mismatch'",
  "verdict: 'satisfied'",
  "out.diag.schedDateVia='weektab-selected-day-tab'"
]) assert(background.includes(marker), 'missing header-variant invariant: ' + marker);

const nameStart = background.indexOf('function mlsParseName(raw)');
const readerStart = background.indexOf('async function mlsSchedDomInline(doc, CFG)', nameStart);
const readerEnd = background.indexOf('\n if (/stm\\.esp|', readerStart);
assert(nameStart >= 0 && readerStart > nameStart && readerEnd > readerStart,
  'could not extract the packaged schedule reader from background.js');

class FakeEvent {
  constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
}
const runtimeContext = vm.createContext({ setTimeout, clearTimeout, Promise, Date, Event: FakeEvent });
const runtime = vm.runInContext(
  background.slice(nameStart, readerEnd) + '\n({ mlsSchedDomInline });',
  runtimeContext,
  { timeout: 5000 }
);

function node(text, options = {}) {
  return {
    id: options.id || '',
    textContent: text,
    children: [],
    previousElementSibling: options.previousElementSibling || null,
    getAttribute(name) { return (options.attrs && options.attrs[name]) || ''; },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

/* A week-tab style container: NO appointment-header2 anywhere. Header paint is
 * configurable per variant under test. */
function weekTabContainer(rows, options = {}) {
  const container = {
    textContent: '', children: rows,
    previousElementSibling: options.previousElementSibling || null,
    parentElement: options.parentElement || null,
    contains(el) { return rows.indexOf(el) >= 0 || el === options.variantHeader; },
    getAttribute(name) { return (options.attrs && options.attrs[name]) || ''; },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector(selector) {
      if (selector.includes('filled-appointment-row')) return rows[0] || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('filled-appointment-row')) return rows;
      if (selector.includes('appointment-header2')) return [];
      if (options.variantHeader && (
        selector.includes('column-header') || selector.includes('provider-header') ||
        selector.includes('provider-name') || selector.includes('appointment-header')
      )) return [options.variantHeader];
      return [];
    }
  };
  return container;
}

function weekTabDoc(containers, extraNodes = [], dayTab = null) {
  const rows = containers.reduce((all, item) => all.concat(item.children || []), []);
  const allNodes = containers.concat(rows, extraNodes);
  return {
    body: { innerText: 'Week of August 2 - August 8, 2026' },
    location: { pathname: '/ax/dashboard' },
    scrollingElement: null,
    defaultView: { getComputedStyle() { return { overflowX: 'hidden', overflowY: 'hidden' }; } },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '*') return allNodes;
      if (selector === '[class~="appointments-container"]') return containers;
      if (selector === '[class~="filled-appointment-row"]') return rows;
      if (selector === 'div,span,h1,h2,h3,h4,th,td') return extraNodes;
      if (dayTab && selector === '.day-tab-container.selected') return [dayTab];
      return [];
    }
  };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

(async () => {
  /* 1. Variant-classed header INSIDE the container corroborates the roster:
     the fully-read next-week grid must produce a COMPLETE roster receipt. */
  {
    const variantHeader = node('Schaeffer_Matthew_MD');
    const rows = [
      node('9:00 AM Adams, Peter Office visit', { id: 'wk-1' }),
      node('9:20 AM Baker, Rose Follow up', { id: 'wk-2' })
    ];
    const container = weekTabContainer(rows, { variantHeader });
    const result = await runtime.mlsSchedDomInline(weekTabDoc([container], [variantHeader]), {});
    assert.strictEqual(result.diag.via, 'legacy-day-grid', JSON.stringify(result.diag));
    assert.strictEqual(result.diag.parsedCount, 2);
    assert.deepStrictEqual(plain(result.providers), ['Schaeffer_Matthew_MD'],
      'variant-painted header did not corroborate the roster');
    assert(result.appts.every(a => a.provider === 'Schaeffer_Matthew_MD'),
      'appointments lost their provider binding on the week-tab surface');
    assert.strictEqual(result.providerRosterReceipt.complete, true,
      'a fully-read next-week grid must produce a complete roster receipt: '
      + JSON.stringify(result.providerRosterReceipt));
    assert.strictEqual(result.providerRosterReceipt.partial, false);
    assert.strictEqual(result.providerRosterReceipt.observedCount, 1);
  }

  /* 2. Header painted as the container's PRECEDING SIBLING corroborates too. */
  {
    const sibling = node('Welby_Marcus_DO');
    const rows = [node('10:00 AM Cole, Dana Office visit', { id: 'wk-3' })];
    const container = weekTabContainer(rows, { previousElementSibling: sibling });
    const result = await runtime.mlsSchedDomInline(weekTabDoc([container], [sibling]), {});
    assert.deepStrictEqual(plain(result.providers), ['Welby_Marcus_DO']);
    assert.strictEqual(result.providerRosterReceipt.complete, true,
      'sibling-painted header did not corroborate: ' + JSON.stringify(result.providerRosterReceipt));
    assert.strictEqual(result.appts[0].provider, 'Welby_Marcus_DO');
  }

  /* 3. Chrome text never becomes a provider: a sibling that fails the
     credential-anchored header shape is ignored and the day refuses. */
  {
    const chrome = node('Appointments for next week');
    const rows = [node('10:20 AM Dean, Paula Office visit', { id: 'wk-4' })];
    const container = weekTabContainer(rows, { previousElementSibling: chrome });
    const result = await runtime.mlsSchedDomInline(weekTabDoc([container], [chrome]), {});
    assert.deepStrictEqual(plain(result.providers), [], 'chrome text was invented into a provider');
    assert.strictEqual(result.providerRosterReceipt.complete, false);
    assert.strictEqual(result.providerRosterReceipt.reason, 'no-provider-headers');
    assert.strictEqual(result.appts[0].provider, '', 'row was bound to an invented provider');
  }

  /* 4. Zero headers anywhere: the exact fail-closed refusal is unchanged. */
  {
    const rows = [node('10:40 AM Ellis, Mark Office visit', { id: 'wk-5' })];
    const container = weekTabContainer(rows, {});
    const result = await runtime.mlsSchedDomInline(weekTabDoc([container]), {});
    assert.strictEqual(result.providerRosterReceipt.complete, false);
    assert.strictEqual(result.providerRosterReceipt.reason, 'no-provider-headers');
    assert.deepStrictEqual(plain(result.providers), []);
  }

  /* 5. Ambiguous parent-scoped paint (two credentialed headers over one
     container) refuses rather than guessing which provider owns the rows. */
  {
    const headerOne = node('Doctor_One_MD');
    const headerTwo = node('Doctor_Two_MD');
    const parent = {
      children: [], textContent: '',
      querySelectorAll(selector) {
        if (selector.includes('provider-header') || selector.includes('appointment-header')
          || selector.includes('column-header') || selector.includes('provider-name')
          || /h1,h2,h3,h4/.test(selector)) return [headerOne, headerTwo];
        return [];
      }
    };
    const rows = [node('11:00 AM Frost, Gail Office visit', { id: 'wk-6' })];
    const container = weekTabContainer(rows, { parentElement: parent });
    const result = await runtime.mlsSchedDomInline(weekTabDoc([container], [headerOne, headerTwo]), {});
    assert.strictEqual(result.providerRosterReceipt.complete, false,
      'ambiguous week-tab headers must refuse: ' + JSON.stringify(result.providerRosterReceipt));
    assert.strictEqual(result.appts[0].provider, '', 'ambiguous headers were guessed onto a row');
  }

  /* 6. The classic current-week surface (appointment-header2) is untouched. */
  {
    const classicHeader = node('Matthew_Schaeffer_MD');
    const rows = [node('8:00 AM Field, Sarah Office visit', { id: 'classic-1' })];
    const container = {
      textContent: '', children: rows,
      getAttribute() { return ''; },
      getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
      querySelector(selector) {
        if (selector.includes('filled-appointment-row')) return rows[0] || null;
        if (selector.includes('appointment-header2')) return classicHeader;
        return null;
      },
      querySelectorAll(selector) {
        if (selector.includes('filled-appointment-row')) return rows;
        if (selector.includes('appointment-header2')) return [classicHeader];
        return [];
      }
    };
    const result = await runtime.mlsSchedDomInline(weekTabDoc([container], [classicHeader]), {});
    assert.deepStrictEqual(plain(result.providers), ['Matthew_Schaeffer_MD']);
    assert.strictEqual(result.providerRosterReceipt.complete, true);
    assert.strictEqual(result.appts[0].provider, 'Matthew_Schaeffer_MD');
  }

  /* 7. Attribution-coverage corroboration (rev-2, 3.0.33): the week-tab
     surface can never produce the structured end/bounds/restoration roster
     proof, so a legacy-unverified receipt may upgrade to complete:true with
     reason 'attribution-coverage' ONLY when the schedule receipt is complete
     and request-bound, EVERY parsed row carries a provider attribution, the
     attribution set is a subset of the observed header set, and at least one
     header was observed. Anything less keeps the exact refusal shipped today.
     Exercised against the extracted handler block itself. */
  {
    const acStart = background.indexOf('/* 2026-07-29 attribution-coverage corroboration');
    const acEnd = background.indexOf('var __receipt = {', acStart);
    assert(acStart >= 0 && acEnd > acStart, 'could not extract the attribution-coverage block');
    const upgrade = new Function(
      '__providerRosterReceipt', '__complete', '__authoritativeEmpty', '__schedRequestId', '__providerRoster', '__mlsM',
      background.slice(acStart, acEnd) + '\nreturn __providerRosterReceipt;'
    );
    const baseReceipt = () => ({
      complete: false, partial: true, reason: 'legacy-unverified',
      observedCount: 2, requestId: 'rq-77', targetDate: '2026-08-04'
    });
    const roster = [
      { stableKey: 'athena:doctor one md', raw: 'Doctor_One_MD', name: 'Doctor_One_MD' },
      { stableKey: 'athena:doctor two md', raw: 'Doctor_Two_MD', name: 'Doctor_Two_MD' }
    ];
    const rows = (p1, p2) => ({ appts: [
      { time: '9:00 AM', name: 'Adams Peter', provider: p1 },
      { time: '9:20 AM', name: 'Baker Rose', provider: p2 }
    ] });

    const upgraded = upgrade(baseReceipt(), true, false, 'rq-77', roster, rows('Doctor_One_MD', 'Doctor_Two_MD'));
    assert.strictEqual(upgraded.complete, true, 'all-attributed bound complete schedule must corroborate the roster');
    assert.strictEqual(upgraded.partial, false);
    assert.strictEqual(upgraded.reason, 'attribution-coverage');
    assert.strictEqual(upgraded.attributionCoverage.rows, 2);
    assert.strictEqual(upgraded.attributionCoverage.corroboratedBy, 'complete-bound-schedule');
    assert.strictEqual(upgraded.attributionCoverage.verdict, 'satisfied');

    const unattributed = upgrade(baseReceipt(), true, false, 'rq-77', roster, rows('Doctor_One_MD', ''));
    assert.strictEqual(unattributed.complete, false, 'a row missing attribution must keep the refusal');
    assert.strictEqual(unattributed.reason, 'legacy-unverified');
    assert.strictEqual(unattributed.attributionCoverage.verdict, 'row-unattributed',
      'the receipt must name the first failing conjunct');
    assert.strictEqual(unattributed.attributionCoverage.unattributedRows, 1);

    const foreign = upgrade(baseReceipt(), true, false, 'rq-77', roster, rows('Doctor_One_MD', 'Doctor_Three_MD'));
    assert.strictEqual(foreign.complete, false, 'an attribution outside the header set must keep the refusal');
    assert.strictEqual(foreign.attributionCoverage.verdict, 'attribution-not-in-headers');
    assert.strictEqual(foreign.attributionCoverage.foreignRows, 1);

    const unbound = upgrade(baseReceipt(), true, false, 'rq-88', roster, rows('Doctor_One_MD', 'Doctor_Two_MD'));
    assert.strictEqual(unbound.complete, false, 'an unbound schedule receipt must keep the refusal');
    assert.strictEqual(unbound.attributionCoverage.verdict, 'request-id-mismatch');

    const incompleteSchedule = upgrade(baseReceipt(), false, false, 'rq-77', roster, rows('Doctor_One_MD', 'Doctor_Two_MD'));
    assert.strictEqual(incompleteSchedule.complete, false, 'an incomplete schedule must keep the refusal');
    assert.strictEqual(incompleteSchedule.attributionCoverage.verdict, 'schedule-incomplete');

    const emptyDay = upgrade(baseReceipt(), true, true, 'rq-77', roster, { appts: [] });
    assert.strictEqual(emptyDay.complete, false, 'an authoritative-empty day must not mint a roster');
    assert.strictEqual(emptyDay.attributionCoverage.verdict, 'authoritative-empty');

    const noRows = upgrade(baseReceipt(), true, false, 'rq-77', roster, { appts: [] });
    assert.strictEqual(noRows.complete, false, 'zero parsed rows must not mint a roster');
    assert.strictEqual(noRows.attributionCoverage.verdict, 'no-rows');

    const noHeaders = upgrade(baseReceipt(), true, false, 'rq-77', [], rows('Doctor_One_MD', 'Doctor_Two_MD'));
    assert.strictEqual(noHeaders.complete, false, 'an empty header set must not mint a roster');
    assert.strictEqual(noHeaders.attributionCoverage.verdict, 'no-headers');

    const alreadyComplete = upgrade(
      Object.assign(baseReceipt(), { complete: true, partial: false, reason: 'complete' }),
      true, false, 'rq-77', roster, rows('Doctor_One_MD', 'Doctor_Two_MD'));
    assert.strictEqual(alreadyComplete.reason, 'complete', 'an already-complete receipt must keep its own reason');
    assert.strictEqual(alreadyComplete.complete, true);
    assert.strictEqual(alreadyComplete.attributionCoverage.verdict, 'already-complete');
  }

  /* 8. The live Aug-4 selected-provider shape END-TO-END: two credentialed
     headers over one container, both rows parse (complete 2/2), rows carry NO
     provider attribution - the roster stays refused AND the receipt now names
     the first failing conjunct directly instead of demanding archaeology. */
  {
    const acStart = background.indexOf('/* 2026-07-29 attribution-coverage corroboration');
    const acEnd = background.indexOf('var __receipt = {', acStart);
    const upgrade = new Function(
      '__providerRosterReceipt', '__complete', '__authoritativeEmpty', '__schedRequestId', '__providerRoster', '__mlsM',
      background.slice(acStart, acEnd) + '\nreturn __providerRosterReceipt;'
    );
    const headerOne = node('Doctor_One_MD');
    const headerTwo = node('Doctor_Two_MD');
    const parent = {
      children: [], textContent: '',
      querySelectorAll(selector) {
        if (selector.includes('provider-header') || selector.includes('appointment-header')
          || selector.includes('column-header') || selector.includes('provider-name')
          || /h1,h2,h3,h4/.test(selector)) return [headerOne, headerTwo];
        return [];
      }
    };
    const rows = [
      node('9:00 AM Adams, Peter Office visit', { id: 'a4-1' }),
      node('9:20 AM Baker, Rose Office visit', { id: 'a4-2' })
    ];
    const container = weekTabContainer(rows, { parentElement: parent });
    const result = await runtime.mlsSchedDomInline(weekTabDoc([container], [headerOne, headerTwo]), {});
    assert.strictEqual(result.diag.parsedCount, 2, JSON.stringify(result.diag));
    assert.strictEqual(result.providerRosterReceipt.complete, false);
    assert.strictEqual(result.providerRosterReceipt.reason, 'legacy-unverified');
    assert.strictEqual(result.providerRosterReceipt.observedCount, 2,
      'the Aug-4 receipt shape (2 observed, legacy-unverified) was not reproduced');
    assert(result.appts.every(a => a.provider === ''), 'ambiguous headers were guessed onto rows');
    const stamped = Object.assign({}, plain(result.providerRosterReceipt), { requestId: 'rq-a4' });
    const judged = upgrade(stamped, true, false, 'rq-a4', plain(result.providerRoster), { appts: plain(result.appts) });
    assert.strictEqual(judged.complete, false, 'the Aug-4 shape must stay refused (never guess a two-provider split)');
    assert.strictEqual(judged.attributionCoverage.verdict, 'row-unattributed',
      'the live Aug-4 refusal must now name row-unattributed on the receipt: ' + JSON.stringify(judged.attributionCoverage));
    assert.strictEqual(judged.attributionCoverage.unattributedRows, 2);
  }

  /* 9. targetDate plumbing (rev-3): the legacy lane reads the served day from
     the selected week-tab's data-date-value, so the handler's roster-receipt
     targetDate stamp stops being ''. Unreadable surfaces stay empty - the
     date is never guessed. */
  {
    const variantHeader = node('Schaeffer_Matthew_MD');
    const rows = [node('9:00 AM Adams, Peter Office visit', { id: 'dt-1' })];
    const container = weekTabContainer(rows, { variantHeader });
    const dayTab = node('Tue 8/4', { attrs: { 'data-date-value': '2026-08-04' } });
    const withTab = await runtime.mlsSchedDomInline(weekTabDoc([container], [variantHeader], dayTab), {});
    assert.strictEqual(withTab.schedDate, '2026-08-04',
      'the selected day tab date-value was not read into schedDate: ' + JSON.stringify(withTab.diag));
    assert.strictEqual(withTab.diag.schedDateVia, 'weektab-selected-day-tab');

    const withoutTab = await runtime.mlsSchedDomInline(weekTabDoc([container], [variantHeader]), {});
    assert(!withoutTab.schedDate, 'an unreadable week-tab surface fabricated a schedDate: ' + JSON.stringify(withoutTab.schedDate));
  }

  console.log('PASS week-tab header-variant roster corroboration, attribution verdict naming, served-date plumbing, and unchanged fail-closed refusals');
})().catch(error => { console.error(error); process.exit(1); });
