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
 *
 * Rev-2 (3.0.33) SNAPSHOT contract: live DOM walks lose the race against
 * Athena's React check-in widget, which continuously replaces the row subtree
 * (live-proven Friday 2026-07-31, appt 45532929: the row vanished between two
 * probes seconds apart while ONE synchronous outerHTML capture read it
 * intact). The reader captures outerHTML in ONE synchronous read and parses
 * identity from that STRING (_snapIdentity): a string cannot churn. The
 * First-Last capitalized-pair shape is accepted ONLY when the same row
 * carries an appointment id AND the name sits in a patient-bound region
 * (encounter-link anchor / patient-name node / data-patient-name) - the
 * id + confident-name bar the structured lane already uses. Conflicting ids,
 * foreign times, and multiple distinct region names stay refused as mutating.
 *
 * Rev-3 (3.0.34) CONTENT-KEYED STABILITY + WELD-HARDENED SNAPSHOT PARSE:
 * live Friday 2026-07-31 proof - the dashboard paints every appointment as
 * TWO identical LI copies in parallel appointments-container lists, and the
 * async check-in columns re-render/re-sort one copy pair mid-walk. (a) An
 * unresolved instance whose appointment id (or normalized text) already
 * produced a parsed row is a duplicate render of captured content: STABLE
 * regardless of DOM node identity or position, never kind:'mutating'.
 * (b) The live 9:40 row was INTACT at rest yet _snapIdentity extracted
 * nothing: the name rides raw row text (no patient-bound region) and athena
 * welds tokens ("40min"+first name, last name+"NNyo"). _snapIdentity now
 * strips/normalizes the known athena tokens BEFORE a capitalized-pair scan
 * over the whole snapshot text - accepted ONLY with the appointment id on
 * the same row, single unambiguous pair run, 2-letter-plus tokens. (c) Every
 * snapshot-read receipt row now names the failing stage in snapshotParse:
 * 'no-id-on-row' | 'no-name-candidate' | 'ambiguous-candidates' | 'accepted'
 * (plus 'foreign-time' | 'id-conflict' | 'empty-snapshot' for the early
 * refusals), so the next live run reads the failure directly. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
/* 2026-07-29: this contract pins the STAGED candidate reader. Candidates live
   in extension-candidates/ so the published repo bytes stay coherent with the
   live feed; on publish, background.js itself carries these changes and the
   candidate path naturally wins either way. Newest candidate wins. */
const candidateChain = ['3.0.34', '3.0.33', '3.0.32'].map(v => path.join(root, 'extension-candidates', v, 'background.js'));
const backgroundPath = candidateChain.find(p => fs.existsSync(p)) || path.join(root, 'background.js');
const background = fs.readFileSync(backgroundPath, 'utf8');

/* ---- source markers: the receipt + snapshot contract must exist verbatim ---- */
for (const marker of [
  "unverifiableRows: __unverifiableRows, unverifiableRowCount: __unverifiableRowCount, provenNonClinicalCount: __provenNonClinical,",
  "kind === 'no-identity-cell'",
  '__nonClinicalAccounted',
  '__parsedCount > 0 && __parsedCount >= __expectedCount && __unnamedCount === 0',
  "out.diag.unverifiableRows=_unvRowsS",
  "out.diag.unverifiableRows=_legacyUnvRowsL",
  'function _snapCapture(row)',
  'function _snapIdentity(html,expectTime,knownId)',
  'row.outerHTML',
  'out.diag.snapshotRecovered=_lgSnapRecovL',
  'out.diag.snapshotRecovered=_snapRecoveredS',
  'snapshot:a._snap===true',
  'snapshot:p._snapHad===true',
  /* rev-3 (3.0.34) invariants */
  'function _snapStripAthenaTokens(text)',
  'function _snapPairRuns(regionText)',
  "snapshotParse:a._snap===true?String(a._snapParse||''):''",
  "snapshotParse:p._snapHad===true?String(p._snapParse||''):''",
  'var _legacyParsedRawKeysL={}',
  'out.diag.duplicateUnverifiableCollapsed=_lgDupCollapsedL'
]) assert(background.includes(marker), 'missing re-verify/snapshot invariant: ' + marker);

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

/* ---- extract the snapshot toolkit and unit-test _snapIdentity directly ---- */
const helperStart = background.indexOf('var RT=/', readerStart);
const helperEnd = background.indexOf('function cp(s)', helperStart);
const snapStart = background.indexOf('function _snapCapture(row)', readerStart);
const snapEnd = background.indexOf('/* Strong legacy provider-scope proof', snapStart);
assert(helperStart > 0 && helperEnd > helperStart && snapStart > 0 && snapEnd > snapStart,
  'could not extract the snapshot toolkit');
const snapKit = vm.runInContext(
  background.slice(nameStart, readerStart) +
  '\nvar out={diag:{}};\n' +
  background.slice(helperStart, helperEnd) +
  '\n' + background.slice(snapStart, snapEnd) +
  '\n({ _snapIdentity, _snapPairName, _snapText, _snapStripAthenaTokens, _snapPairRuns });',
  vm.createContext({ Date, Math }),
  { timeout: 5000 }
);

const CHURN_HTML =
  '<li class="filled-appointment-row" data-appointment-id="45532929">' +
  '<span>9:40 AM</span>' +
  '<a class="encounter-link" href="/22724/6/ax/encounter/1/checkin">Reed Piper</a>' +
  '<span>68yo M 01-01-1958</span>' +
  '<div class="react-app-container">Check In</div>' +
  '</li>';
const DEBRIS_HTML_NO_ID =
  '<li class="filled-appointment-row">' +
  '<span>Lobby 12 Annex 34</span><span>9:40 AM</span>' +
  '<a class="encounter-link">Reed Piper</a>' +
  '</li>';
const DEBRIS_HTML_WITH_ID = DEBRIS_HTML_NO_ID.replace(
  'class="filled-appointment-row"', 'class="filled-appointment-row" data-appointment-id="45532929"');

{
  // u1: the live Friday shape - intact snapshot verifies id + region name + chip DOB
  const u1 = snapKit._snapIdentity(CHURN_HTML, '9:40 AM', '45532929');
  assert.strictEqual(u1.ok, true, JSON.stringify(u1));
  assert.strictEqual(u1.name, 'Reed Piper');
  assert.strictEqual(u1.appointmentId, '45532929');
  assert.strictEqual(u1.time, '9:40 AM');
  assert.strictEqual(u1.dob, '01/01/1958', 'age+sex chip DOB was not self-validated from the string snapshot');

  // u2: the SAME region name WITHOUT an appointment id is not accepted (id gate)
  const u2 = snapKit._snapIdentity(DEBRIS_HTML_NO_ID, '9:40 AM', '');
  assert.strictEqual(u2.ok, false, 'First-Last region name verified without an appointment id');
  assert.strictEqual(u2.noIdentity, false, 'an identity-bearing row was classified non-clinical');

  // u3: identical row WITH the id verifies through the patient-bound region
  const u3 = snapKit._snapIdentity(DEBRIS_HTML_WITH_ID, '9:40 AM', '');
  assert.strictEqual(u3.ok, true, JSON.stringify(u3));
  assert.strictEqual(u3.name, 'Reed Piper');

  // u4: two distinct patient-bound region names are ambiguous - refused even with id
  const u4 = snapKit._snapIdentity(
    CHURN_HTML.replace('</li>', '<a class="encounter-link">Sally Jones</a></li>'), '9:40 AM', '45532929');
  assert.strictEqual(u4.ok, false, 'a two-patient row was guessed');

  // u5: a snapshot showing a different time is a foreign row - refused
  assert.strictEqual(snapKit._snapIdentity(CHURN_HTML, '8:00 AM', '45532929').ok, false);

  // u6: a snapshot id conflicting with the caller's stable key is a foreign row - refused
  assert.strictEqual(snapKit._snapIdentity(CHURN_HTML, '9:40 AM', '99999999').ok, false);

  // u7: an identity-less hold snapshot classifies non-clinical
  const u7 = snapKit._snapIdentity('<li class="filled-appointment-row"><span>9:40 AM</span> 30 min hold</li>', '9:40 AM', '');
  assert.strictEqual(u7.ok, false);
  assert.strictEqual(u7.noIdentity, true, JSON.stringify(u7));

  /* ---- rev-3 (3.0.34): welded live shape + snapshotParse stage naming ---- */
  // u8: the EXACT live Friday failure shape - id on a BUTTON child, NO
  // patient-bound region, "40min" welded into the first name and the last
  // name welded into "NNyo". Token normalization must recover the pair.
  const LIVE_WELD =
    '<li class="filled-appointment-row">' +
    '<button type="button" class="appt-btn" data-stitching-url="/x/y" data-metrics-stage="s1" data-appointment-id="45532929"></button>' +
    '<span>9:40 AM</span><span>40minRoy Lee</span><span>68yo F | 01-01-1958</span>' +
    '<span>F/U ESI LUMBAR &amp; MBB</span>' +
    '</li>';
  const u8 = snapKit._snapIdentity(LIVE_WELD, '9:40 AM', '45532929');
  assert.strictEqual(u8.ok, true, 'welded live-shape row did not verify: ' + JSON.stringify(u8));
  assert.strictEqual(u8.name, 'Roy Lee', '2-letter/3-letter capitalized pair was not recovered');
  assert.strictEqual(u8.appointmentId, '45532929');
  assert.strictEqual(u8.dob, '01/01/1958', 'age+sex chip DOB was not self-validated');
  assert.strictEqual(u8.snapshotParse, 'accepted');

  // u8b: fully welded single text node ("40minRoy Lee68yo F | ...") still parses
  const u8b = snapKit._snapIdentity(
    '<li class="filled-appointment-row">' +
    '<button type="button" class="appt-btn" data-appointment-id="45532929"></button>' +
    '<span>9:40 AM 40minRoy Lee68yo F | 01-01-1958 F/U ESI LUMBAR &amp; MBB</span></li>',
    '9:40 AM', '45532929');
  assert.strictEqual(u8b.ok, true, JSON.stringify(u8b));
  assert.strictEqual(u8b.name, 'Roy Lee');
  assert.strictEqual(snapKit._snapStripAthenaTokens('9:40 AM 40minRoy Lee68yo F | 01-01-1958 F/U ESI LUMBAR & MBB'),
    'Roy Lee F/U ESI LUMBAR MBB', 'athena token normalization drifted');

  // u9: the SAME welded pair WITHOUT an appointment id anywhere is never
  // accepted (id gate) and the receipt names the stage.
  const u9 = snapKit._snapIdentity(LIVE_WELD.replace(' data-appointment-id="45532929"', ''), '9:40 AM', '');
  assert.strictEqual(u9.ok, false, 'whole-text pair name verified without an appointment id');
  assert.strictEqual(u9.snapshotParse, 'no-id-on-row');

  // u10: TWO distinct pair runs with an id stay refused as ambiguous - named.
  const u10 = snapKit._snapIdentity(LIVE_WELD.replace('</li>', '<span>Sally Jones</span></li>'), '9:40 AM', '45532929');
  assert.strictEqual(u10.ok, false, 'a two-pair snapshot was guessed');
  assert.strictEqual(u10.snapshotParse, 'ambiguous-candidates');

  // u11: every verdict names its stage - accepted / foreign-time / id-conflict
  assert.strictEqual(snapKit._snapIdentity(CHURN_HTML, '9:40 AM', '45532929').snapshotParse, 'accepted');
  assert.strictEqual(snapKit._snapIdentity(CHURN_HTML, '8:00 AM', '45532929').snapshotParse, 'foreign-time');
  assert.strictEqual(snapKit._snapIdentity(CHURN_HTML, '9:40 AM', '99999999').snapshotParse, 'id-conflict');
  assert.strictEqual(snapKit._snapPairRuns('Roy Lee and Sally Jones').length, 2, '_snapPairRuns lost run separation');
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
    outerHTML: options.outerHTML,
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
      if (selector.includes('data-appointment-id="')) {
        const m = selector.match(/data-appointment-id="([^"]+)"/);
        return (m && appointments.find(a => a.getAttribute('data-appointment-id') === m[1])) || null;
      }
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
    outerHTML: options.outerHTML,
    getAttribute(name) { return (options.attrs && options.attrs[name]) || ''; },
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

  /* 6. LEGACY react-churn: live reads are ALWAYS torn (the check-in widget
     replaces the subtree), but the single synchronous outerHTML snapshot is
     intact - the row verifies from the string with id, region name, and
     self-validated chip DOB. This is the exact Friday 2026-07-31 shape. */
  {
    const provider = legacyRow('Matthew_Schaeffer_MD');
    const good = legacyRow('10:40 AM Field, Sarah Office visit', { id: 'legacy-good-3' });
    const churn = legacyRow(() => '9:40 AM', {
      id: 'legacy-churn',
      attrs: { 'data-appointment-id': '45532929' },
      outerHTML: CHURN_HTML
    });
    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([good, churn], provider)], [provider]), {});
    assert.strictEqual(result.diag.parsedCount, 2, 'react-churn row was not snapshot-recovered: ' + JSON.stringify(result.diag));
    assert.strictEqual(result.diag.unnamedCount, 0);
    assert.strictEqual(Number(result.diag.snapshotRecovered || 0), 1, 'snapshot recovery was not accounted');
    assert.deepStrictEqual(plain(result.diag.unverifiableRows || []), []);
    const recovered = result.appts.find(a => a.time === '9:40 AM');
    assert(recovered, 'snapshot-recovered row missing from appts');
    assert.strictEqual(recovered.name, 'Reed Piper');
    assert.strictEqual(recovered.appointmentId, '45532929');
    assert.strictEqual(recovered.dob, '01/01/1958');
    assert.strictEqual(recovered.provider, 'Matthew_Schaeffer_MD');
    assert.strictEqual(receiptFor(result.diag, true).complete, true);
  }

  /* 7. STRUCTURE react-churn: same defect on the structured surface - the
     pending anchor (appointment id) relocates the row and the snapshot
     verifies it through the normal dedup. */
  {
    const counter = { pulls: 0 };
    const good = appointment('good7', '8:00 AM Smith, John (58yo M)');
    const churn = appointment('churn7', () => '9:40 AM', {
      appointmentId: '45532929',
      outerHTML: CHURN_HTML.replace('filled-appointment-row', 'PatientAppointment_appointment-container')
    });
    const col = countingColumn(0, [good, churn], counter);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [col], headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(result.diag.parsedCount, 2, 'structure churn row was not snapshot-recovered: ' + JSON.stringify(result.diag));
    assert.strictEqual(result.diag.unnamedCount, 0);
    assert.strictEqual(Number(result.diag.snapshotRecovered || 0), 1);
    const recovered = result.appts.find(a => a.appointmentId === '45532929');
    assert(recovered, 'structure snapshot-recovered row missing');
    assert.strictEqual(recovered.name, 'Reed Piper');
    assert.strictEqual(recovered.provider, 'Doctor_One_MD');
    assert.strictEqual(receiptFor(result.diag, result.diag.viewportCoverage.complete).complete, true);
  }

  /* 8. LEGACY react-churn ambiguity: a snapshot naming TWO patient-bound
     regions is never guessed - the row stays mutating and the day refuses. */
  {
    const provider = legacyRow('Matthew_Schaeffer_MD');
    const good = legacyRow('10:40 AM Field, Sarah Office visit', { id: 'legacy-good-4' });
    const churn = legacyRow(() => '9:40 AM', {
      id: 'legacy-churn-2',
      attrs: { 'data-appointment-id': '45532929' },
      outerHTML: CHURN_HTML.replace('</li>', '<a class="encounter-link">Sally Jones</a></li>')
    });
    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([good, churn], provider)], [provider]), {});
    assert.strictEqual(result.diag.parsedCount, 1, 'ambiguous two-patient snapshot was imported');
    assert(!result.appts.some(a => /piper|jones/i.test(a.name || '')), 'a guessed patient name leaked');
    const rows = plain(result.diag.unverifiableRows || []);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'mutating');
    assert.strictEqual(rows[0].snapshot, true, 'refusal did not record that a snapshot was read');
    assert.strictEqual(rows[0].snapshotParse, 'ambiguous-candidates',
      'the receipt did not name the failing snapshot-parse stage');
    assert.strictEqual(receiptFor(result.diag, true).complete, false);
  }

  /* 9. LEGACY double-render collapse (rev-3): the live dashboard paints every
     appointment as TWO identical LI copies in parallel lists. When one copy
     parses and the other churns mid-walk, the churning copy is a duplicate
     render of ALREADY-CAPTURED content - content-keyed stability drops it
     instead of refusing the day as kind:'mutating'. */
  {
    const provider = legacyRow('Matthew_Schaeffer_MD');
    const copyA = legacyRow('9:40 AM Doe, Bob Office visit', {
      id: 'legacy-copy-a', attrs: { 'data-appointment-id': '45532929' }
    });
    /* copy B: same appointment id, torn text forever, no snapshot available */
    const copyB = legacyRow(() => '9:40 AM', {
      id: 'legacy-copy-b', attrs: { 'data-appointment-id': '45532929' }
    });
    const other = legacyRow('10:00 AM Field, Sarah Office visit', { id: 'legacy-other' });
    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc(
        [legacyContainer([copyA, other], provider), legacyContainer([copyB], provider)],
        [provider]), {});
    assert.strictEqual(result.diag.parsedCount, 2, 'double-render collapse changed parsed truth: ' + JSON.stringify(result.diag));
    assert.strictEqual(result.diag.candidateCount, 2, 'the duplicate render leaked into candidate accounting');
    assert.strictEqual(result.diag.unnamedCount, 0, 'a duplicate render of captured content was counted unverifiable');
    assert.deepStrictEqual(plain(result.diag.unverifiableRows || []), [],
      'a same-id duplicate render produced a receipt refusal');
    assert.strictEqual(Number(result.diag.duplicateUnverifiableCollapsed || 0), 1,
      'the collapse was not accounted in diag');
    assert.strictEqual(result.appts.filter(a => a.appointmentId === '45532929').length, 1);
    assert.strictEqual(receiptFor(result.diag, true).complete, true,
      'relocated-only duplicate of identical captured content must not refuse the day');

    /* control: a genuinely unaccounted torn row (unique id, never parses)
       still refuses exactly as before - the collapse is id/content-keyed,
       not a blanket amnesty. */
    const foreign = legacyRow(() => '11:20 AM', {
      id: 'legacy-foreign', attrs: { 'data-appointment-id': '99911122' }
    });
    const refused = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([copyA, foreign], provider)], [provider]), {});
    const refusedRows = plain(refused.diag.unverifiableRows || []);
    assert.strictEqual(refusedRows.length, 1, 'a genuinely unaccounted row was collapsed away');
    assert.strictEqual(refusedRows[0].kind, 'mutating');
    assert.strictEqual(refusedRows[0].appointmentId, '99911122');
    assert.strictEqual(receiptFor(refused.diag, true).complete, false);
  }

  /* 10. STRUCTURE double-render collapse: a pending instance whose appointment
     id already produced a parsed candidate is skipped by the receipt build -
     node identity and position never enter the stability judgment. */
  {
    const counter = { pulls: 0 };
    const copyA = appointment('s-copy-a', '9:40 AM Doe, Bob (68yo F)', { appointmentId: '45532929' });
    const copyB = appointment('s-copy-b', () => '9:40 AM', { appointmentId: '45532929' });
    const good = appointment('s-good', '8:00 AM Smith, John (58yo M)');
    const col = countingColumn(0, [good, copyA, copyB], counter);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [col], headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(result.diag.parsedCount, 2, JSON.stringify(result.diag));
    assert.strictEqual(result.diag.unnamedCount, 0,
      'a same-id duplicate render was counted unverifiable on the structured surface');
    assert.deepStrictEqual(plain(result.diag.unverifiableRows || []), []);
    assert.strictEqual(result.appts.filter(a => a.appointmentId === '45532929').length, 1);
    assert.strictEqual(receiptFor(result.diag, result.diag.viewportCoverage.complete).complete, true);
  }

  console.log('PASS mutating-row re-verify, snapshot string verification, content-keyed double-render collapse, snapshotParse stage naming, non-clinical receipt naming, and fail-closed identity refusal');
})().catch(error => { console.error(error); process.exit(1); });
