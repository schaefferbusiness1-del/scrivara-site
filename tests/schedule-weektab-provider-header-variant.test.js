'use strict';

/* 2026-07-29 contract: next-week day views render through the week-tab
 * dashboard, where the per-container provider header does NOT carry the
 * classic appointment-header2 class. The legacy day-grid roster derivation
 * must corroborate a fully-read grid from bounded header paint variants
 * (variant-classed nodes inside the container, container attributes, the
 * immediately preceding sibling, parent-scoped headers) - every candidate
 * still gated by the credential-anchored lh() shape. Fail-closed rules are
 * unchanged: zero headers or ambiguous headers refuse exactly as before and
 * a provider is never invented. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
/* 2026-07-29: this contract pins the STAGED 3.0.32 candidate reader. The
   candidate lives in extension-candidates/ so the published 3.0.31 repo bytes
   stay coherent with the live feed; on publish, background.js itself carries
   these changes and the candidate path naturally wins either way. */
const candidatePath = path.join(root, 'extension-candidates', '3.0.32', 'background.js');
const background = fs.readFileSync(fs.existsSync(candidatePath) ? candidatePath : path.join(root, 'background.js'), 'utf8');

for (const marker of [
  'function _legacyHeaderTextsL(list)',
  '_legacyHeaderTextsL(list).forEach(function(raw)',
  '_legacyHeaderTextsL(list).forEach(function(h)',
  "list.querySelectorAll('[class~=\"appointment-header2\"]')"
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

function weekTabDoc(containers, extraNodes = []) {
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

  console.log('PASS week-tab header-variant roster corroboration with unchanged fail-closed refusals');
})().catch(error => { console.error(error); process.exit(1); });
