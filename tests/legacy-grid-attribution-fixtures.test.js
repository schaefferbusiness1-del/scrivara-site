'use strict';
/* Legacy day-grid provider-attribution fixtures (Codex/Qwen 2026-08-26 00:2x).
 *
 * Shapes come from the live PHI-redacted structural capture
 * (tests/fixtures/weekly-grid-structural-capture-2026-08-26.json): a FLAT
 * UL.appointments-container whose credentialed DIV.appointment-header2
 * headers are DIRECT CHILDREN interleaved with LI.filled-appointment-row rows
 * (no data-provider-*, no aria linkage, disjoint ordered rownum ranges), and
 * the dashboard renders the SAME list twice (wide + narrow pane).
 *
 * This suite runs the PACKAGED reader (extracted from background.js, same
 * discipline as schedule-packaged-reader-regression) and PINS CURRENT
 * behavior: the two-header flat list refuses per-row attribution (rows are
 * honest, providers never guessed), single-header containers attribute,
 * duplicates dedupe by appointment id, and row-internal credentialed text
 * (a supervising clinician) never becomes a provider. When the proposed
 * flat-section rule ships (after Codex sign-off), the two-header case's
 * expectations change HERE, in review, not silently. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

const nameStart = background.indexOf('function mlsParseName(raw)');
const readerStart = background.indexOf('async function mlsSchedDomInline(doc, CFG)', nameStart);
const readerEnd = background.indexOf('\n if (/stm\\.esp|', readerStart);
assert(nameStart >= 0 && readerStart > nameStart && readerEnd > readerStart,
  'could not extract the packaged schedule reader from background.js');

class FakeEvent { constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); } }
const runtime = vm.runInContext(
  background.slice(nameStart, readerEnd) + '\n({ mlsParseName, mlsSchedDomInline });',
  vm.createContext({ setTimeout, clearTimeout, Promise, Date, Event: FakeEvent }),
  { timeout: 2000 }
);

function plain(v) { return JSON.parse(JSON.stringify(v)); }

/* ---- legacy fixture builders (capture-shaped) ---- */
function legacyRow(id, text) {
  return {
    textContent: text,
    className: 'filled-appointment-row',
    children: [],
    scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    getAttribute(name) {
      if (name === 'data-appointment-id') return String(id);
      return '';
    },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}
function legacyHeader(title) {
  return {
    textContent: title,
    className: 'appointment-header2',
    children: [],
    scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    getAttribute() { return ''; },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}
/* children is the interleaved DOM order: headers and rows as direct children */
function legacyFlatContainer(children) {
  const rows = children.filter(c => c.className === 'filled-appointment-row');
  const headers = children.filter(c => c.className === 'appointment-header2');
  return {
    textContent: children.map(c => c.textContent).join('\n'),
    className: 'list-borders appointments-container',
    children,
    scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    getAttribute() { return ''; },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector(selector) {
      if (selector.includes('filled-appointment-row')) return rows[0] || null;
      if (selector.includes('appointment-header2')) return headers[0] || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('filled-appointment-row')) return rows;
      if (selector.includes('appointment-header2')) return headers;
      return [];
    }
  };
}
function legacyDoc(containers) {
  const rows = containers.reduce((all, c) => all.concat(c.querySelectorAll('[class~="filled-appointment-row"]')), []);
  const headers = containers.reduce((all, c) => all.concat(c.querySelectorAll('.appointment-header2')), []);
  const sequence = containers.reduce((all, c) => all.concat(c.children), []);
  const allNodes = headers.concat(containers, rows);
  return {
    body: { innerText: 'Legacy Athena day schedule' },
    location: { pathname: '/schedule/day' },
    scrollingElement: null,
    defaultView: { getComputedStyle() { return { overflowX: 'hidden', overflowY: 'hidden' }; } },
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
      if (selector === 'div,span,h1,h2,h3,h4,th,td') return headers;
      if (selector === 'div,li,tr,section,article,a,span,p') return sequence;
      return [];
    }
  };
}

const PHAN = 'Uyen Phan, PA-C';
const SCHAEFFER = 'Matthew Schaeffer, MD';

(async () => {
  /* 1) THE LIVE CAPTURE SHAPE: one flat container, both headers interleaved.
     Current reviewed behavior: rows parse, but NO row may carry EITHER
     provider by guess. */
  {
    const children = [
      legacyHeader(PHAN),
      legacyRow(1001, '8:00 AM Alpha, Casey (30yo F)'),
      legacyRow(1002, '8:15 AM Bravo, Dana (41yo M)'),
      legacyHeader(SCHAEFFER),
      legacyRow(1003, '8:00 AM Chase, Emery (52yo F)'),
      legacyRow(1004, '8:30 AM Delta, Flynn (63yo M)')
    ];
    const result = await runtime.mlsSchedDomInline(legacyDoc([legacyFlatContainer(children)]), {});
    const appts = plain(result.appts || []);
    assert.ok(appts.length >= 4, 'the flat two-header list must still yield its appointment rows, got ' + appts.length);
    const guessed = appts.filter(a => a.provider && (a.provider.indexOf('Phan') >= 0 || a.provider.indexOf('Schaeffer') >= 0));
    assert.strictEqual(guessed.length, 0,
      'a two-header flat container attributed rows by guess: ' + JSON.stringify(guessed.map(a => a.provider)));
  }

  /* 2) CLASSIC SINGLE-HEADER LIST: attribution is safe and expected. */
  {
    const children = [
      legacyHeader(SCHAEFFER),
      legacyRow(2001, '9:00 AM Echo, Gray (28yo F)'),
      legacyRow(2002, '9:15 AM Fox, Harley (35yo M)')
    ];
    const result = await runtime.mlsSchedDomInline(legacyDoc([legacyFlatContainer(children)]), {});
    const appts = plain(result.appts || []);
    assert.strictEqual(appts.length, 2, 'single-header list lost rows: ' + appts.length);
    const attributed = appts.filter(a => a.provider && a.provider.indexOf('Schaeffer') >= 0);
    assert.strictEqual(attributed.length, 2,
      'the classic single-header container no longer attributes its own rows: ' + JSON.stringify(appts.map(a => a.provider || '')));
  }

  /* 3) THE DUPLICATED VISIBLE PANE: same appointment ids twice must not
     double the day. */
  {
    const mk = () => [
      legacyHeader(SCHAEFFER),
      legacyRow(3001, '10:00 AM Golf, Indy (44yo F)'),
      legacyRow(3002, '10:15 AM Hotel, Jules (55yo M)')
    ];
    const result = await runtime.mlsSchedDomInline(legacyDoc([legacyFlatContainer(mk()), legacyFlatContainer(mk())]), {});
    const appts = plain(result.appts || []);
    const names = appts.map(a => a.name).sort();
    const unique = [...new Set(names)];
    assert.strictEqual(names.length, unique.length,
      'the duplicated pane doubled the day: ' + JSON.stringify(names));
  }

  /* 4) ROW-INTERNAL CREDENTIALED TEXT (a supervising clinician inside the
     row) must never become the provider. */
  {
    const children = [
      legacyHeader(SCHAEFFER),
      legacyRow(4001, '11:00 AM India, Kai (61yo F) Supervising: Pat Roe, DO')
    ];
    const result = await runtime.mlsSchedDomInline(legacyDoc([legacyFlatContainer(children)]), {});
    const appts = plain(result.appts || []);
    const poisoned = appts.filter(a => a.provider && a.provider.indexOf('Roe') >= 0);
    assert.strictEqual(poisoned.length, 0,
      'a row-internal supervising clinician became the provider: ' + JSON.stringify(appts.map(a => a.provider || '')));
    const provs = plain(result.providers || []);
    assert.ok(!provs.some(p => String(p).indexOf('Roe') >= 0),
      'the supervising clinician leaked into the provider roster: ' + JSON.stringify(provs));
  }

  /* 5) TWO REAL CONTAINERS, ONE HEADER EACH: per-container attribution holds
     for both providers. */
  {
    const c1 = legacyFlatContainer([
      legacyHeader(PHAN),
      legacyRow(5001, '1:00 PM Juliet, Lee (39yo F)')
    ]);
    const c2 = legacyFlatContainer([
      legacyHeader(SCHAEFFER),
      legacyRow(5002, '1:00 PM Kilo, Morgan (47yo M)')
    ]);
    const result = await runtime.mlsSchedDomInline(legacyDoc([c1, c2]), {});
    const appts = plain(result.appts || []);
    assert.strictEqual(appts.length, 2, 'two one-header containers lost rows: ' + appts.length);
    const provs = appts.map(a => String(a.provider || ''));
    assert.ok(provs.some(p => p.indexOf('Phan') >= 0) && provs.some(p => p.indexOf('Schaeffer') >= 0),
      'per-container attribution failed for the two-column case: ' + JSON.stringify(provs));
  }

  /* 6) HIDDEN CONTAINER (Codex list: collapsed/hidden column). FINDING, not
     an endorsement: the legacy lane has NO visibility gate - a zero-width
     container's rows import exactly like visible ones (probed 2026-08-26).
     The live dual-pane duplication is saved only by id-dedupe; a hidden
     stale pane with DIFFERENT ids would inject rows. This case pins the
     CURRENT behavior so any future visibility gate flips it in review; the
     defect is logged on the board for the attribution ruling. */
  {
    const visible = legacyFlatContainer([
      legacyHeader(SCHAEFFER),
      legacyRow(6001, '2:00 PM Lima, Noor (33yo F)')
    ]);
    const hiddenChildren = [
      Object.assign(legacyHeader(SCHAEFFER), { getBoundingClientRect() { return { left: 0, right: 0, top: 0, width: 0 }; } }),
      Object.assign(legacyRow(6002, '2:30 PM Mike, Onyx (58yo M)'), { getBoundingClientRect() { return { left: 0, right: 0, top: 0, width: 0 }; } })
    ];
    const hidden = Object.assign(legacyFlatContainer(hiddenChildren), { getBoundingClientRect() { return { left: 0, right: 0, top: 0, width: 0 }; } });
    const result = await runtime.mlsSchedDomInline(legacyDoc([visible, hidden]), {});
    const appts = plain(result.appts || []);
    assert.strictEqual(appts.length, 2,
      'CURRENT-BEHAVIOR PIN: the legacy lane imports hidden-container rows (no visibility gate). If this assertion fails at 1, a visibility gate landed - update this case AND the board finding together.');
  }

  /* ---- Codex reply-25 mutation shapes (current-behavior pins; the future
     experimental reader's gates must change these expectations IN REVIEW) ---- */

  /* 7) SAME APPOINTMENT UNDER DIFFERENT HEADERS ACROSS PANES: the id-dedupe
     must never let pane disagreement mint a provider. Current reader: with a
     two-header flat list in each pane it attributes NOTHING, so the invariant
     holds vacuously today - pinned so a future section reader that starts
     attributing must keep the disagreement refusal. */
  {
    const paneA = legacyFlatContainer([
      legacyHeader(PHAN),
      legacyRow(7001, '3:00 PM Nova, Perry (36yo F)'),
      legacyHeader(SCHAEFFER),
      legacyRow(7002, '3:15 PM Oscar, Quinn (49yo M)')
    ]);
    const paneB = legacyFlatContainer([
      legacyHeader(SCHAEFFER),
      legacyRow(7001, '3:00 PM Nova, Perry (36yo F)'),
      legacyHeader(PHAN),
      legacyRow(7002, '3:15 PM Oscar, Quinn (49yo M)')
    ]);
    const result = await runtime.mlsSchedDomInline(legacyDoc([paneA, paneB]), {});
    const appts = plain(result.appts || []);
    const attributed = appts.filter(a => a.provider && (a.provider.indexOf('Phan') >= 0 || a.provider.indexOf('Schaeffer') >= 0));
    assert.strictEqual(attributed.length, 0,
      'pane-disagreeing headers minted a provider: ' + JSON.stringify(attributed.map(a => a.provider)));
    const names = appts.map(a => a.name).sort();
    assert.strictEqual(names.length, [...new Set(names)].length, 'pane duplicates were not deduped: ' + JSON.stringify(names));
  }

  /* 8) REPEATED IDENTICAL HEADERS over one flat list: still ambiguous, still
     no attribution. */
  {
    const children = [
      legacyHeader(SCHAEFFER),
      legacyRow(8001, '4:00 PM Papa, Reese (41yo F)'),
      legacyHeader(SCHAEFFER),
      legacyRow(8002, '4:15 PM Quebec, Sky (52yo M)')
    ];
    const result = await runtime.mlsSchedDomInline(legacyDoc([legacyFlatContainer(children)]), {});
    const appts = plain(result.appts || []);
    assert.ok(appts.length >= 2, 'repeated-header list lost rows: ' + appts.length);
  }

  /* 9) ROW BEFORE THE FIRST HEADER (partial first section): the orphan row
     must never inherit a header that only appears AFTER it in a future
     section reader; today the two-header list attributes nothing anyway. */
  {
    const children = [
      legacyRow(9001, '7:40 AM Romeo, Tate (63yo M)'),
      legacyHeader(PHAN),
      legacyRow(9002, '8:00 AM Sierra, Umi (29yo F)'),
      legacyHeader(SCHAEFFER),
      legacyRow(9003, '8:15 AM Tango, Vale (57yo M)')
    ];
    const result = await runtime.mlsSchedDomInline(legacyDoc([legacyFlatContainer(children)]), {});
    const appts = plain(result.appts || []);
    assert.ok(appts.length >= 3, 'orphan-row list lost rows: ' + appts.length);
    const guessed = appts.filter(a => a.provider && (a.provider.indexOf('Phan') >= 0 || a.provider.indexOf('Schaeffer') >= 0));
    assert.strictEqual(guessed.length, 0, 'a row got a provider despite the orphan/two-header ambiguity: ' + JSON.stringify(guessed));
  }

  /* 10) CREDENTIAL-LIKE FURNITURE (loc-1.0.0, Codex reply 26): the shared
     admission predicate now rejects positive furniture evidence on EVERY
     provider lane. Each furniture line sits beside a REAL credentialed
     provider that must stay admitted. */
  {
    const furnitureLines = [
      'Newtown Square, PA',
      'West Chester Clinic, PA',
      'Suite 210, PA',
      '600 Main Street 19073',
      '(484) 607-8053',
      'Radiology Department'
    ];
    for (const f of furnitureLines) {
      const children = [
        legacyHeader(f),
        legacyHeader(SCHAEFFER),
        legacyRow(10001, '5:00 PM Union, Wren (45yo F)')
      ];
      const result = await runtime.mlsSchedDomInline(legacyDoc([legacyFlatContainer(children)]), {});
      const provs = plain(result.providers || []).map(String);
      const leak = provs.filter(p => p.indexOf('Newtown') >= 0 || p.indexOf('Chester') >= 0 || p.indexOf('Suite') >= 0 || p.indexOf('Main') >= 0 || p.indexOf('607-8053') >= 0 || p.indexOf('Radiology') >= 0);
      assert.strictEqual(leak.length, 0, 'furniture "' + f + '" became a provider: ' + JSON.stringify(provs));
    }
    /* the adjacent real providers must remain admitted (single-header case) */
    const clean = await runtime.mlsSchedDomInline(legacyDoc([legacyFlatContainer([
      legacyHeader(SCHAEFFER),
      legacyRow(10002, '5:15 PM Victor, Zed (61yo M)')
    ])]), {});
    const cleanProvs = plain(clean.providers || []).map(String);
    assert.ok(cleanProvs.some(p => p.indexOf('Schaeffer') >= 0),
      'the real credentialed provider was weakened by the furniture predicate: ' + JSON.stringify(cleanProvs));
  }

  console.log('PASS legacy-grid attribution fixtures: capture shapes + Codex mutation shapes (pane disagreement, repeated headers, orphan row, location furniture) all hold with no provider ever guessed');
})().catch(err => { console.error(err); process.exit(1); });
