'use strict';

/* 2026-07-29 contract: a schedule row that re-renders while being verified is
 * re-located by its stable key and re-verified (bounded: 2 extra passes with a
 * short settle). If it still refuses:
 *   - a row PROVABLY carrying no appointment id and no patient identity (a
 *     hold/block/frame row) is named in the receipt as
 *     unverifiableRows:[{kind:'no-identity-cell',...}], is NOT counted in
 *     parsedCount, and the day completes only when
 *     expectedCount - provenNonClinical === parsedCount;
 *   - any identity-bearing or still-mutating row keeps the day incomplete
 *     exactly as before (kind:'mutating'). A patient row is never guessed.
 * Live shape being pinned: Friday 2026-07-31 refused deterministically with
 * expectedCount 7 / parsedCount 6 because one declared row mutated mid-verify. */

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

/* ---- source markers: the receipt contract must exist verbatim ---- */
for (const marker of [
  "unverifiableRows: __unverifiableRows, unverifiableRowCount: __unverifiableRowCount, provenNonClinicalCount: __provenNonClinical,",
  "kind === 'no-identity-cell'",
  '__nonClinicalAccounted',
  '__parsedCount > 0 && __parsedCount >= __expectedCount && __unnamedCount === 0',
  "out.diag.unverifiableRows=_unvRowsS",
  "out.diag.unverifiableRows=_legacyUnvRowsL"
]) assert(background.includes(marker), 'missing re-verify receipt invariant: ' + marker);

/* ---- extract the packaged reader (the function Chrome actually injects) ---- */
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
  background.slice(nameStart, readerEnd) + '\n({ mlsParseName, mlsSchedDomInline });',
  runtimeContext,
  { timeout: 5000 }
);

/* ---- extract the handler's completeness equation and run it directly ---- */
const eqStart = background.indexOf('var __unverifiableRows = Array.isArray(__dd.unverifiableRows)');
const eqEnd = background.indexOf('/* sfp-1.0.0 STALENESS VERDICT', eqStart);
assert(eqStart >= 0 && eqEnd > eqStart, 'could not extract the schedule completeness equation');
const completeness = new Function(
  '__dd', '__parsedCount', '__expectedCount', '__unnamedCount', '__coverageComplete', '__authoritativeEmpty',
  background.slice(eqStart, eqEnd) +
  '\nreturn { complete: !!__complete, provenNonClinical: __provenNonClinical, unverifiableRows: __unverifiableRows };'
);
function receiptFor(diag, coverageComplete) {
  return completeness(
    diag,
    Number(diag.parsedCount || 0),
    Number(diag.candidateCount || 0),
    Number(diag.unnamedCount || 0),
    coverageComplete !== false,
    false
  );
}

/* ---- pure equation pins (the exact Friday arithmetic) ---- */
{
  const nonClinical = { unverifiableRows: [{ kind: 'no-identity-cell', time: '9:40 AM' }], unverifiableRowCount: 1 };
  assert.strictEqual(completeness(nonClinical, 6, 7, 1, true, false).complete, true,
    'expected 7 / parsed 6 / one proven non-clinical row must now complete');
  const mutating = { unverifiableRows: [{ kind: 'mutating', time: '9:40 AM' }], unverifiableRowCount: 1 };
  assert.strictEqual(completeness(mutating, 6, 7, 1, true, false).complete, false,
    'a mutating (possibly identity-bearing) row must keep the day incomplete');
  assert.strictEqual(completeness(nonClinical, 6, 8, 2, true, false).complete, false,
    'a second unaccounted row must keep the day incomplete');
  assert.strictEqual(completeness({ unverifiableRows: [], unverifiableRowCount: 0 }, 6, 7, 1, true, false).complete, false,
    'an unclassified unnamed row must keep the day incomplete');
  assert.strictEqual(completeness(nonClinical, 6, 7, 1, false, false).complete, false,
    'coverage failure still refuses regardless of classification');
  assert.strictEqual(completeness({ unverifiableRows: [], unverifiableRowCount: 0 }, 7, 7, 0, true, false).complete, true,
    'the unchanged all-verified branch must still complete');
}

/* ================= structure-lane doubles ================= */
function appointment(id, text, options = {}) {
  const getText = typeof text === 'function' ? text : () => text;
  return {
    id: 'react-' + id,
    get textContent() { return getText(); },
    children: [],
    getAttribute(name) {
      if (name === 'data-appointment-id') return (options.appointmentId || '');
      return '';
    },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}
function countingColumn(left, appointments, counter) {
  return {
    children: appointments,
    scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    getBoundingClientRect() { return { left, right: left + 200, width: 200 }; },
    querySelector(selector) {
      return selector.includes('PatientAppointment_appointment-container') ? (appointments[0] || null) : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('PatientAppointment_appointment-container')) { counter.pulls++; return appointments; }
      return [];
    }
  };
}
function header(provider, left) {
  return {
    textContent: provider, children: [],
    scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    getBoundingClientRect() { return { left, right: left + 200, width: 200 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}
function scheduleDoc({ columns, headers }) {
  const appointments = columns.reduce((all, col) => all.concat(col.children || []), []);
  const allNodes = headers.concat(columns, appointments);
  return {
    body: { innerText: '' },
    location: { pathname: '/schedule/day' },
    scrollingElement: null,
    defaultView: { getComputedStyle() { return { overflowX: 'hidden', overflowY: 'hidden' }; } },
    getElementById(id) { return appointments.find(a => a.id === id) || null; },
    querySelector(selector) {
      if (selector.includes('PatientAppointment_appointment-container')) return appointments[0] || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '*') return allNodes;
      if (selector.includes('ScheduleColumn_schedule-column')) return columns;
      if (selector === 'div,span,h1,h2,h3,h4,th,td') return headers;
      if (selector.includes('PatientAppointment_appointment-container')) return appointments;
      return [];
    }
  };
}

/* ================= legacy-lane doubles ================= */
function legacyRow(text, options = {}) {
  const getText = typeof text === 'function' ? text : () => text;
  return {
    id: options.id || '',
    get textContent() { return getText(); },
    children: [],
    getAttribute() { return ''; },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}
function legacyContainer(rows, providerHeader) {
  return {
    textContent: '', children: rows,
    getAttribute() { return ''; },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector(selector) {
      if (selector.includes('filled-appointment-row')) return rows[0] || null;
      if (selector.includes('appointment-header2')) return providerHeader || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('filled-appointment-row')) return rows;
      if (selector.includes('appointment-header2')) return providerHeader ? [providerHeader] : [];
      return [];
    }
  };
}
function legacyScheduleDoc(containers, providerHeaders) {
  const rows = containers.reduce((all, item) => all.concat(item.children || []), []);
  const allNodes = providerHeaders.concat(containers, rows);
  return {
    body: { innerText: 'Legacy Athena day schedule' },
    location: { pathname: '/schedule/day' },
    scrollingElement: null,
    defaultView: { getComputedStyle() { return { overflowX: 'hidden', overflowY: 'hidden' }; } },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '*') return allNodes;
      if (selector === '[class~="appointments-container"]') return containers;
      if (selector === '[class~="filled-appointment-row"]') return rows;
      if (selector === 'div,span,h1,h2,h3,h4,th,td') return providerHeaders;
      return [];
    }
  };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

(async () => {
  /* 1. STRUCTURE: a row that mutates mid-verification is re-located by its
     stable anchor and re-verified on an extra pass. Nothing is refused. */
  {
    const counter = { pulls: 0 };
    const good = appointment('good', '9:20 AM Smith, John (58yo M)');
    const mutating = appointment('mut', () => counter.pulls >= 3
      ? '9:00 AM Miller, Anna (52yo F)'
      : '9:00 AM');
    const col = countingColumn(0, [good, mutating], counter);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [col], headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(result.diag.parsedCount, 2, 'mutating row was not recovered: ' + JSON.stringify(result.diag));
    assert.strictEqual(result.diag.candidateCount, 2);
    assert.strictEqual(result.diag.unnamedCount, 0);
    assert(Number(result.diag.reverifyPasses || 0) >= 1, 'no re-verify pass ran');
    assert.deepStrictEqual(plain(result.diag.unverifiableRows || []), []);
    assert(result.appts.some(a => a.name === 'Anna Miller'), 'recovered row lost its verified identity');
    assert.strictEqual(receiptFor(result.diag, result.diag.viewportCoverage.complete).complete, true);
  }

  /* 2. STRUCTURE: an identity-less row (no appointment id, no name shape, no
     DOB/MRN) that never verifies is named in the receipt as non-clinical,
     excluded from parsedCount, and the day now completes. */
  {
    const counter = { pulls: 0 };
    const good = appointment('good2', '8:00 AM Smith, John (58yo M)');
    const hold = appointment('hold', '10:10 AM 15 min');
    const col = countingColumn(0, [good, hold], counter);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [col], headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(result.diag.parsedCount, 1, 'identity-less row leaked into parsedCount');
    assert.strictEqual(result.diag.candidateCount, 2, 'identity-less row vanished from candidate accounting');
    assert.strictEqual(result.diag.unnamedCount, 1);
    const rows = plain(result.diag.unverifiableRows || []);
    assert.strictEqual(rows.length, 1, 'unverifiable row was not named in the receipt');
    assert.strictEqual(rows[0].kind, 'no-identity-cell');
    assert.strictEqual(rows[0].time, '10:10 AM');
    assert(!('name' in rows[0]), 'receipt row must never carry name text');
    assert(!result.appts.some(a => a.time === '10:10 AM'), 'non-clinical row was imported');
    const receipt = receiptFor(result.diag, result.diag.viewportCoverage.complete);
    assert.strictEqual(receipt.provenNonClinical, 1);
    assert.strictEqual(receipt.complete, true, 'expectedCount - provenNonClinical === parsedCount must complete');
  }

  /* 3. STRUCTURE: an identity-bearing fragment that will not verify still
     refuses the day (kind mutating, never guessed, never completed). */
  {
    const counter = { pulls: 0 };
    const good = appointment('good3', '8:00 AM Smith, John (58yo M)');
    const fragment = appointment('frag', '10:30 AM Zeta');
    const col = countingColumn(0, [good, fragment], counter);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [col], headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(result.diag.parsedCount, 1);
    assert.strictEqual(result.diag.unnamedCount, 1);
    const rows = plain(result.diag.unverifiableRows || []);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'mutating', 'identity fragment was classified non-clinical');
    assert(!result.appts.some(a => /zeta/i.test(a.name || '')), 'identity fragment was guessed into a patient');
    assert.strictEqual(receiptFor(result.diag, result.diag.viewportCoverage.complete).complete, false,
      'identity-bearing unverifiable row completed the day');
  }

  /* 4. LEGACY: a grid row that re-renders mid-read is re-located by its own
     node and re-verified; the day imports every real patient. */
  {
    const provider = legacyRow('Matthew_Schaeffer_MD');
    let reads = 0;
    const good = legacyRow('10:40 AM Field, Sarah Office visit', { id: 'legacy-good' });
    const mutating = legacyRow(() => (++reads >= 2)
      ? '11:00 AM Green, Laura Office visit'
      : '11:00 AM', { id: 'legacy-mut' });
    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([good, mutating], provider)], [provider]), {});
    assert.strictEqual(result.diag.via, 'legacy-day-grid');
    assert.strictEqual(result.diag.parsedCount, 2, 'legacy mutating row was not recovered: ' + JSON.stringify(result.diag));
    assert.strictEqual(result.diag.candidateCount, 2);
    assert.strictEqual(result.diag.unnamedCount, 0);
    assert.deepStrictEqual(plain(result.diag.unverifiableRows || []), []);
    assert(result.appts.every(a => a.provider === 'Matthew_Schaeffer_MD'));
    assert.strictEqual(receiptFor(result.diag, true).complete, true);
  }

  /* 5. LEGACY: an identity-less hold/frame row is named non-clinical and the
     day completes without it; an identity fragment still refuses. */
  {
    const provider = legacyRow('Matthew_Schaeffer_MD');
    const good = legacyRow('11:10 AM Field, Sarah Office visit', { id: 'legacy-good-2' });
    const hold = legacyRow('11:20 AM 30 min', { id: 'legacy-hold' });
    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([good, hold], provider)], [provider]), {});
    assert.strictEqual(result.diag.parsedCount, 1);
    assert.strictEqual(result.diag.candidateCount, 2);
    const rows = plain(result.diag.unverifiableRows || []);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'no-identity-cell');
    assert.strictEqual(rows[0].lane, 'legacy-day-grid');
    assert.strictEqual(receiptFor(result.diag, true).complete, true);

    const fragment = legacyRow('11:40 AM Zeta', { id: 'legacy-frag' });
    const refused = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([good, fragment], provider)], [provider]), {});
    const refusedRows = plain(refused.diag.unverifiableRows || []);
    assert.strictEqual(refusedRows.length, 1);
    assert.strictEqual(refusedRows[0].kind, 'mutating');
    assert.strictEqual(receiptFor(refused.diag, true).complete, false,
      'legacy identity-bearing unverifiable row completed the day');
  }

  console.log('PASS mutating-row re-verify, non-clinical receipt naming, completeness equation, and fail-closed identity refusal');
})().catch(error => { console.error(error); process.exit(1); });
