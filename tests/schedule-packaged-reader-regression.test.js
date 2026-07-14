'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

/* Exercise the function Chrome actually injects from background.js.  The
 * historical reference copy in inject_dom.js is useful documentation, but a
 * parser drift between that file and the packaged runtime caused real
 * schedule-name failures to escape the former regression coverage. */
const nameStart = background.indexOf('function mlsParseName(raw)');
const readerStart = background.indexOf('async function mlsSchedDomInline(doc, CFG)', nameStart);
const readerEnd = background.indexOf('\n if (/stm\\.esp|', readerStart);
assert(nameStart >= 0 && readerStart > nameStart && readerEnd > readerStart,
  'could not extract the packaged schedule reader from background.js');

class FakeEvent {
  constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
}

const runtimeContext = vm.createContext({
  setTimeout,
  clearTimeout,
  Promise,
  Date,
  Event: FakeEvent
});
const runtime = vm.runInContext(
  background.slice(nameStart, readerEnd) + '\n({ mlsParseName, mlsSchedDomInline });',
  runtimeContext,
  { timeout: 2000 }
);

const mergeStart = background.indexOf('var mlsProv = (function () {');
const mergeEnd = background.indexOf('/* A schedule surface must be proven', mergeStart);
assert(mergeStart >= 0 && mergeEnd > mergeStart, 'could not extract packaged schedule merge logic');
const mlsProv = vm.runInNewContext(
  background.slice(mergeStart, mergeEnd) + '\nmlsProv;',
  Object.create(null),
  { timeout: 2000 }
);

function appointment(id, text, options = {}) {
  const getText = typeof text === 'function' ? text : () => text;
  return {
    id: 'react-' + id,
    get textContent() { return getText(); },
    children: [],
    getAttribute(name) {
      if (name === 'data-appointment-id') return options.appointmentId || '';
      return '';
    },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

function column(left, appointments) {
  return {
    children: appointments,
    scrollHeight: 0,
    clientHeight: 0,
    scrollWidth: 0,
    clientWidth: 0,
    getBoundingClientRect() { return { left, right: left + 200, width: 200 }; },
    querySelector(selector) {
      return selector.includes('PatientAppointment_appointment-container')
        ? (appointments[0] || null) : null;
    },
    querySelectorAll(selector) {
      return selector.includes('PatientAppointment_appointment-container')
        ? appointments : [];
    }
  };
}

function header(provider, left) {
  return {
    textContent: provider,
    children: [],
    scrollHeight: 0,
    clientHeight: 0,
    scrollWidth: 0,
    clientWidth: 0,
    getBoundingClientRect() { return { left, right: left + 200, width: 200 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

function verticalScroller(appointmentNode) {
  return {
    scrollHeight: 500,
    clientHeight: 200,
    scrollWidth: 200,
    clientWidth: 200,
    scrollLeft: 0,
    scrollTop: 0,
    children: [],
    dispatchEvent() {},
    querySelector(selector) {
      return selector.includes('PatientAppointment_appointment-container')
        ? appointmentNode : null;
    },
    querySelectorAll() { return []; }
  };
}

function scheduleDoc({ columns, headers, scroller = null, bodyText = '' }) {
  const appointments = columns.reduce((all, col) => all.concat(col.children || []), []);
  const allNodes = (scroller ? [scroller] : []).concat(headers, columns, appointments);
  return {
    body: { innerText: bodyText },
    location: { pathname: '/schedule/day' },
    scrollingElement: null,
    defaultView: {
      getComputedStyle(el) {
        if (el === scroller) return { overflowX: 'hidden', overflowY: 'auto' };
        return { overflowX: 'hidden', overflowY: 'hidden' };
      }
    },
    querySelector(selector) {
      if (selector.includes('PatientAppointment_appointment-container')) return appointments[0] || null;
      if (selector.includes('ScheduleColumn_schedule-column')) return columns[0] || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '*') return allNodes;
      if (selector.includes('ScheduleColumn_schedule-column')) return columns;
      if (selector === 'div,span,h1,h2,h3,h4,th,td') return headers;
      return [];
    }
  };
}

function legacyNode(text, options = {}) {
  return {
    id: options.id || '',
    textContent: text,
    children: [],
    scrollHeight: 0,
    clientHeight: 0,
    scrollWidth: 0,
    clientWidth: 0,
    getAttribute() { return ''; },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

function legacyContainer(rows, providerHeader) {
  return {
    textContent: '',
    children: rows,
    scrollHeight: 0,
    clientHeight: 0,
    scrollWidth: 0,
    clientWidth: 0,
    getAttribute() { return ''; },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector(selector) {
      if (selector.includes('filled-appointment-row')) return rows[0] || null;
      if (selector.includes('appointment-header2')) return providerHeader;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('filled-appointment-row')) return rows;
      if (selector.includes('appointment-header2')) return [providerHeader];
      return [];
    }
  };
}

function legacyScheduleDoc(containers, providerHeaders, bodyText = 'Legacy Athena day schedule') {
  const rows = containers.reduce((all, item) => all.concat(item.children || []), []);
  const sequence = [];
  containers.forEach((item, index) => {
    sequence.push(providerHeaders[index]);
    sequence.push(...item.children);
  });
  const allNodes = providerHeaders.concat(containers, rows);
  return {
    body: { innerText: bodyText },
    location: { pathname: '/schedule/day' },
    scrollingElement: null,
    defaultView: {
      getComputedStyle() { return { overflowX: 'hidden', overflowY: 'hidden' }; }
    },
    querySelector(selector) {
      if (selector.includes('PatientAppointment_appointment-container')
          || selector.includes('ScheduleColumn_schedule-column')) return null;
      if (selector.includes('appointments-container') || selector.includes('filled-appointment-row')) {
        return containers[0] || rows[0] || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '*') return allNodes;
      if (selector === '[class~="appointments-container"]') return containers;
      if (selector === '[class~="filled-appointment-row"]') return rows;
      if (selector.includes('ScheduleColumn_schedule-column')) return [];
      if (selector === 'div,span,h1,h2,h3,h4,th,td') return providerHeaders;
      if (selector === 'div,li,tr,section,article,a,span,p') return sequence;
      return [];
    }
  };
}

function mergeReaderResult(result) {
  return mlsProv.merge(result, { appts: [], providers: [], diag: { strategy: 'empty-text-fixture' } });
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function alphaSuffix(i) {
  return String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

function timeAt(index) {
  const total = (7 * 60) + (index * 10);
  const hour24 = Math.floor(total / 60);
  const minute = String(total % 60).padStart(2, '0');
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour = ((hour24 + 11) % 12) + 1;
  return `${hour}:${minute} ${suffix}`;
}

(async () => {
  // The actual structure lane must canonicalize Athena's "Last, First" row,
  // rather than returning a one-token first name that the merge rejects.
  {
    const row = appointment('canonical', '8:00 AM Smith, John (58yo M)');
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [column(0, [row])],
      headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.deepStrictEqual(plain(result.appts.map(a => a.name)), ['John Smith'], JSON.stringify(result));
    assert.strictEqual(result.diag.candidateCount, 1);
    assert.strictEqual(mergeReaderResult(result).appts.length, 1);
  }

  // A React row can expose its time before its patient text hydrates. The two
  // render states are one appointment candidate, and the hydrated identity
  // must replace—not sit beside—the loading snapshot.
  {
    let scroller;
    const row = appointment('hydrating', () => scroller.scrollTop === 0
      ? '8:20 AM Loading...'
      : '8:20 AM Jones, Maria (45yo F)');
    scroller = verticalScroller(row);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [column(0, [row])],
      headers: [header('Doctor_One_MD', 0)],
      scroller
    }), {});
    const merged = mergeReaderResult(result);
    assert.strictEqual(result.diag.candidateCount, 1, 'loading and hydrated snapshots became two candidates');
    assert.deepStrictEqual(plain(merged.appts.map(a => a.name)), ['Maria Jones']);
    assert.strictEqual(scroller.scrollTop, 0, 'vertical sweep did not restore the original position');
  }

  // Athena renders a providerless hidden copy beside its attributed copy.
  // That is one appointment, but two genuinely attributed providers remain two.
  {
    const hiddenTwin = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [
        column(0, [appointment('twin-attributed', '8:40 AM Brown, Alice (50yo F)')]),
        column(500, [appointment('twin-hidden', '8:40 AM Brown, Alice (50yo F)')])
      ],
      headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(hiddenTwin.diag.candidateCount, 1, 'providerless hidden twin inflated candidate count');
    assert.strictEqual(mergeReaderResult(hiddenTwin).appts.length, 1);

    const twoProviders = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [
        column(0, [appointment('provider-one', '9:00 AM White, Robert (60yo M)')]),
        column(300, [appointment('provider-two', '9:00 AM White, Robert (60yo M)')])
      ],
      headers: [header('Doctor_One_MD', 0), header('Doctor_Two_MD', 300)]
    }), {});
    assert.strictEqual(twoProviders.diag.candidateCount, 2, 'two real provider bookings were collapsed');
    assert.strictEqual(mergeReaderResult(twoProviders).appts.length, 2);
    assert.deepStrictEqual(
      plain(mergeReaderResult(twoProviders).appts.map(a => a.provider).sort()),
      ['Doctor_One_MD', 'Doctor_Two_MD']
    );
  }

  // A row that never hydrates remains an unresolved candidate. It must not be
  // imported, and the same completion predicate used by the handler stays false.
  {
    const unresolved = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [column(0, [appointment('unresolved', '9:20 AM Loading...')])],
      headers: [header('Doctor_One_MD', 0)]
    }), {});
    const merged = mergeReaderResult(unresolved);
    const expected = Number(unresolved.diag.candidateCount || 0);
    const complete = merged.appts.length > 0 && merged.appts.length >= expected;
    assert.strictEqual(expected, 1, 'unresolved appointment vanished from candidate accounting');
    assert.strictEqual(merged.appts.length, 0, 'unresolved loading row was imported as a patient');
    assert.strictEqual(complete, false, 'persistent unresolved row did not fail closed');
  }

  // Reproduce the live cardinality shape: 18 real appointments, each rendered
  // once with a provider and once in a providerless hidden lane, plus two exact
  // attributed DOM copies. All 38 raw containers reconcile to exactly 18.
  {
    const attributed = [], providerless = [];
    for (let i = 0; i < 18; i++) {
      const suffix = alphaSuffix(i);
      const raw = `${timeAt(i)} Last${suffix}, First${suffix} (50yo F)`;
      attributed.push(appointment(`bulk-a-${i}`, raw));
      providerless.push(appointment(`bulk-h-${i}`, raw));
    }
    attributed.push(
      appointment('bulk-a-duplicate-0', attributed[0].textContent),
      appointment('bulk-a-duplicate-1', attributed[1].textContent)
    );
    const rawCount = attributed.length + providerless.length;
    assert.strictEqual(rawCount, 38);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [column(0, attributed), column(500, providerless)],
      headers: [header('Doctor_One_MD', 0)],
      bodyText: 'Day schedule'
    }), {});
    const merged = mergeReaderResult(result);
    assert.strictEqual(result.diag.candidateCount, 18, '38 DOM copies did not reconcile to 18 candidates');
    assert.strictEqual(merged.appts.length, 18, '38 DOM copies did not merge to 18 appointments');
    assert.strictEqual(new Set(plain(merged.appts.map(a => `${a.time}|${a.name}`))).size, 18);
  }

  // Legacy athenaOne's day list renders two complete copies of the same list
  // (alternate sort/layout containers). Each copy includes the same 18 real
  // patients plus two OPEN capacity rows. A long but valid patient row must not
  // be discarded by the old <300-character grouped-DOM heuristic.
  {
    const provider = 'Matthew_Schaeffer_MD';
    const providerHeaders = [legacyNode(provider), legacyNode(provider)];
    const patientRows = [];
    let longName = '';
    for (let i = 0; i < 18; i++) {
      const suffix = alphaSuffix(i);
      const name = `First${suffix} Last${suffix}`;
      let raw = `${timeAt(i)} ${name} Office visit`;
      if (i === 9) {
        longName = name;
        raw += ' ' + 'clinically relevant scheduling detail '.repeat(12);
        assert(raw.length > 300, 'long-row fixture no longer exceeds the legacy cutoff');
      }
      patientRows.push(raw);
    }
    const openRows = ['10:20 AM OPEN', '10:30 AM OPEN slot'];
    const firstCopy = patientRows.concat(openRows).map((text, i) => legacyNode(text, { id: `legacy-a-${i}` }));
    const secondCopy = patientRows.concat(openRows).map((text, i) => legacyNode(text, { id: `legacy-b-${i}` }));
    const containers = [
      legacyContainer(firstCopy, providerHeaders[0]),
      legacyContainer(secondCopy, providerHeaders[1])
    ];
    assert.strictEqual(firstCopy.length + secondCopy.length, 40, 'legacy raw-row fixture must remain 40 rows');

    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc(containers, providerHeaders),
      {}
    );
    const merged = mergeReaderResult(result);
    assert.strictEqual(result.diag.legacyContainers, 2);
    assert.strictEqual(result.diag.legacyFilledRows, 40);
    assert.strictEqual(result.diag.candidateCount, 18,
      'duplicate legacy containers or OPEN slots inflated candidate completeness: ' + JSON.stringify({
        diag: result.diag,
        apptCount: result.appts.length,
        mergedCount: merged.appts.length,
        mergedNames: merged.appts.map(a => a.name)
      }));
    assert.strictEqual(result.appts.length, 18,
      'legacy reader did not reconcile two duplicate containers to 18 real appointments');
    assert.strictEqual(merged.appts.length, 18,
      'packaged reader + merge did not preserve exactly 18 legacy appointments');
    assert(merged.appts.some(a => a.name === longName),
      'real legacy appointment over 300 characters was dropped');
    assert(merged.appts.every(a => a.provider === provider),
      'legacy single-provider scope was not preserved on every appointment');
    assert(!merged.appts.some(a => /\bopen\b/i.test(a.name || '')),
      'OPEN capacity row survived as a patient');
    assert(Number(result.diag.slotRowsRemoved || merged.providerDiag.slotRowsRemoved || 0) >= 4,
      'the four duplicate OPEN rows were not visibly accounted for');
    assert.strictEqual(new Set(plain(merged.appts.map(a => `${a.time}|${a.name}|${a.provider}`))).size, 18,
      'duplicate legacy appointment rows survived reconciliation');
  }

  // A non-slot legacy row that never resolves to a two-token patient remains a
  // completeness candidate but can never become an imported appointment.
  {
    const provider = 'Matthew_Schaeffer_MD';
    const providerHeaders = [legacyNode(provider), legacyNode(provider)];
    const unresolvedText = '11:00 AM Loading patient details';
    const containers = [
      legacyContainer([legacyNode(unresolvedText, { id: 'legacy-unresolved-a' })], providerHeaders[0]),
      legacyContainer([legacyNode(unresolvedText, { id: 'legacy-unresolved-b' })], providerHeaders[1])
    ];
    const unresolved = await runtime.mlsSchedDomInline(
      legacyScheduleDoc(containers, providerHeaders),
      {}
    );
    const merged = mergeReaderResult(unresolved);
    const expected = Number(unresolved.diag.candidateCount || 0);
    const complete = merged.appts.length > 0
      && merged.appts.length >= expected
      && Number(unresolved.diag.unnamedCount || 0) === 0;
    assert.strictEqual(expected, 1, 'duplicate unresolved legacy row was lost or double-counted');
    assert.strictEqual(merged.appts.length, 0, 'unresolved legacy row was imported as a patient');
    assert(Number(unresolved.diag.unnamedCount || 0) >= 1,
      'unresolved legacy row was not exposed to completeness diagnostics');
    assert.strictEqual(complete, false, 'unresolved legacy row did not fail closed');
  }

  console.log('PASS packaged schedule reader modern + legacy dedup, long rows, slots, provider scope, and fail-closed completeness');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
