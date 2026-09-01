'use strict';
/* plv-1.0.0 — PROVIDERS LINKED TO THEIR PATIENTS.
 *
 * Owner, 2026-09-01: "the providers needs to be linked to there patients".
 *
 * The whole feature is a DERIVATION, so the whole suite is about what the
 * derivation is allowed to conclude. The three things that would make this
 * feature worse than not having it:
 *
 *   1. GUESSING. A patient with no attributed appointment must end with NO
 *      provider field - not "Unassigned", not the logged-in doctor, not the
 *      practice. Proven below on blank-provider rows, on unlinkable rows, and
 *      on an ambiguous name+DOB pair claimed by two charts.
 *   2. FLAPPING. _calAppts holds only the LOADED calendar window. A derivation
 *      that recomputed a bare integer would say 12 in August and 2 after
 *      paging to September. Proven cumulative + idempotent below: day keys
 *      merge, a re-run over already-counted rows changes nothing and saves
 *      nothing.
 *   3. WRITING DURING A PULL. The auto-merge learned this live on 2026-07-18:
 *      rewriting the patient store mid-history-batch makes every patientById
 *      proof miss and the pull reports history-partial though every save
 *      verified. Proven below - busy defers, and the deferred run lands once
 *      the pull is idle.
 *
 * And the one that would make it dangerous: a derivation must never be able to
 * REMOVE a chart. The save is proven below to carry the identical id set and
 * to pass no allowRemovals - that flag exists to let a save drop rows.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }
/* values built inside the vm context carry that realm's Array/Object
   prototypes, so deepStrictEqual would fail on identical data. Compare the
   serialized form - this suite is about values, not realms. */
function deep(a, b, m) { checks++; assert.deepStrictEqual(JSON.parse(JSON.stringify(a === undefined ? null : a)), JSON.parse(JSON.stringify(b === undefined ? null : b)), m); }

const root = path.resolve(__dirname, '..');
const MODULE = 'feat_mls_provider_link.js';
const src = fs.readFileSync(path.join(root, MODULE), 'utf8');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];
const CONNECTS = ['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'];

new Function(src); /* syntax gate - a module that cannot parse proves nothing */

/* ------------------------------------------------------------------ harness */

function fakeSelect() {
  const sel = {
    id: 'mlsPlvSel', style: {}, value: '', options: [],
    setAttribute() {}, onchange: null,
    get innerHTML() { return sel._html || ''; },
    set innerHTML(v) {
      sel._html = String(v);
      sel.options = [];
      const re = /<option value="([^"]*)">([^<]*)<\/option>/g;
      let m;
      while ((m = re.exec(sel._html))) sel.options.push({ value: m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'), text: m[2] });
    }
  };
  return sel;
}

function makeSandbox(opts) {
  opts = opts || {};
  const timers = [];
  const store = {};
  const saves = [];
  let patients = opts.patients || [];
  let rows = opts.rows || [];
  const els = { mlsPlvSel: opts.mountSelect ? fakeSelect() : null, ptList: { _mlsRoster: {}, _mlsSig: 'x' }, ptSearchRow: null, ptSort: null };
  if (opts.mountRow) {
    els.ptSearchRow = {
      children: [],
      appendChild(n) { this.children.push(n); n.parentNode = this; els[n.id] = n; return n; },
      insertBefore(n) { this.children.push(n); n.parentNode = this; els[n.id] = n; return n; }
    };
  }
  const events = [];
  let renders = 0;

  const context = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, RegExp, Error,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    document: { getElementById(id) { return Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null; }, createElement() { return fakeSelect(); } },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
  };
  context.window = context;
  context.window.addEventListener = function () {};
  context.window.removeEventListener = function () {};
  context.window.dispatchEvent = function (ev) { events.push(ev); return true; };
  context.getPatients = function () {
    const a = patients.slice();
    if (opts.readGen != null) Object.defineProperty(a, '__mlsReadGen', { value: opts.readGen, configurable: true });
    return a;
  };
  context.savePatients = function (arr, key, o) {
    saves.push({ arr, key, opts: o, readGen: arr && arr.__mlsReadGen });
    patients = arr;
    return undefined;
  };
  context.renderPatients = function () { renders++; };
  context._calAppts = rows;

  vm.createContext(context);
  vm.runInContext(src, context);

  return {
    context, timers, saves, events, els, store,
    api() { return context.window.__mlsProviderLink; },
    patients() { return patients; },
    renders() { return renders; },
    setRows(next) { rows = next; context._calAppts = next; },
    setPatients(next) { patients = next; }
  };
}

const PT = (id, name, dob, extra) => Object.assign({ id, name, dob, visits: [] }, extra || {});
const ROW = (o) => Object.assign({ id: 'a' + Math.random().toString(36).slice(2, 8) }, o);

/* =====================================================================
   1. DERIVATION CORRECTNESS
   ===================================================================== */

{ /* majority wins; the runner-up is still listed */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [
      ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' }),
      ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-17' }),
      ROW({ patient_external_id: 'p1', provider: 'Sarah Nguyen, PA-C', appt_date: '2026-08-24' })
    ]
  });
  const out = sb.api().run({});
  eq(out.saved, 1, 'one patient must have been stamped');
  const p = sb.patients()[0];
  eq(p.providerLink.primaryProvider, 'Matthew Schaeffer, MD', 'the provider with the most attributed days must be primary');
  eq(p.providerLink.providersSeen.length, 2, 'every distinct attributed provider must be listed');
  eq(p.providerLink.providersSeen[0].count, 2, 'the primary entry must count its distinct days');
  eq(p.providerLink.providersSeen[0].last, '2026-08-17', 'the entry must carry its most recent day');
  eq(p.providerLink.providersSeen[1].name, 'Sarah Nguyen, PA-C', 'the runner-up must survive as providersSeen');
  eq(p.providerLink.v, 1, 'the stored shape must be versioned');
}

{ /* a tie goes to the most RECENT, and never to array order */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [
      ROW({ patient_external_id: 'p1', provider: 'Sarah Nguyen, PA-C', appt_date: '2026-08-02' }),
      ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-20' })
    ]
  });
  sb.api().run({});
  eq(sb.patients()[0].providerLink.primaryProvider, 'Matthew Schaeffer, MD',
    'a 1-1 tie must be broken by the most recent attributed day');

  /* and the reverse row order must reach the identical verdict */
  const sb2 = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [
      ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-20' }),
      ROW({ patient_external_id: 'p1', provider: 'Sarah Nguyen, PA-C', appt_date: '2026-08-02' })
    ]
  });
  sb2.api().run({});
  eq(sb2.patients()[0].providerLink.primaryProvider, 'Matthew Schaeffer, MD',
    'the tie-break must not depend on the order rows arrive in');
}

{ /* BLANK PROVIDER ROWS CONTRIBUTE NOTHING, and a patient with only blank rows
     ends with NO field at all - the honest empty the owner asked for */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11'), PT('p2', 'Jane Doe', '1975-06-01')],
    rows: [
      ROW({ patient_external_id: 'p1', provider: '', appt_date: '2026-08-03' }),
      ROW({ patient_external_id: 'p1', provider: '   ', appt_date: '2026-08-04' }),
      ROW({ patient_external_id: 'p1', appt_date: '2026-08-05' }),
      /* a row carrying only a normalized KEY is attributed-but-unnameable */
      ROW({ patient_external_id: 'p1', provider_key: 'matthew schaeffer', appt_date: '2026-08-06' }),
      ROW({ patient_external_id: 'p2', provider: 'Sarah Nguyen, PA-C', appt_date: '2026-08-06' })
    ]
  });
  const out = sb.api().run({});
  eq(out.saved, 1, 'only the patient with a NAMED provider may be stamped');
  eq(sb.patients()[0].providerLink, undefined, 'blank-provider rows must leave the record with no provider field');
  ok(!('providerLink' in sb.patients()[0]), 'the field must be ABSENT, not present-and-empty');
  eq(sb.patients()[1].providerLink.primaryProvider, 'Sarah Nguyen, PA-C', 'the attributed patient must still be stamped');
  eq(out.rows.blank, 4, 'unattributed rows must be counted honestly in the receipt');
  eq(out.rows.attributed, 1, 'only a named provider counts as attribution');
}

{ /* zero rows at all -> nothing written, nothing saved */
  const sb = makeSandbox({ patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')], rows: [] });
  const out = sb.api().run({});
  eq(out.saved, 0, 'an empty calendar must write nothing');
  eq(out.reason, 'no-change', 'and must say so');
  eq(sb.saves.length, 0, 'savePatients must not be called at all');
  ok(!('providerLink' in sb.patients()[0]), 'a patient with zero attributed rows carries no provider field');
}

/* =====================================================================
   2. IDENTITY - the derivation may never attribute across two humans
   ===================================================================== */

{ /* the STRONG link: every pointer spelling the shell itself accepts */
  for (const field of ['patient_external_id', '_mlsTargetPatientId', 'patientId']) {
    const rowObj = { provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' };
    rowObj[field] = 'p1';
    const sb = makeSandbox({ patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')], rows: [ROW(rowObj)] });
    sb.api().run({});
    eq(sb.patients()[0].providerLink.primaryProvider, 'Matthew Schaeffer, MD',
      'a row linked by ' + field + ' must attribute');
  }
}

{ /* the WEAK link: name + a canonical DOB, and only when the roster is
     unambiguous. THE FORMATS DO NOT MATCH ON THE WIRE: an Athena row arrives
     MM/DD/YYYY while the chart stores YYYY-MM-DD, so a raw-digit comparison
     ("02111980" vs "19800211") refuses every weak link it was written to
     allow. Found by this test; cured with the shell's own _opDobKey. */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam J Schaeffer', '1980-02-11')],
    rows: [ROW({ name: 'adam j schaeffer', dob: '02/11/1980', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  sb.api().run({});
  ok(sb.patients()[0].providerLink,
    'a name+DOB row must attribute across DOB FORMATS - MM/DD/YYYY on the appointment, YYYY-MM-DD on the chart');
  eq(sb.patients()[0].providerLink.primaryProvider, 'Matthew Schaeffer, MD',
    'an unambiguous name+DOB row must attribute even with no patient pointer');

  /* and the same date written four ways is one identity, while a DOB that is
     not a date at all is no identity */
  const sbK = makeSandbox({});
  const dk = (v) => {
    const s2 = makeSandbox({ patients: [PT('x', 'N N', v)], rows: [ROW({ name: 'N N', dob: '1980-02-11', provider: 'P, MD', appt_date: '2026-08-03' })] });
    s2.api().run({});
    return !!s2.patients()[0].providerLink;
  };
  for (const form of ['1980-02-11', '02/11/1980', '2/11/1980', '1980/2/11']) {
    ok(dk(form), 'the chart DOB "' + form + '" must resolve to the same identity as 1980-02-11');
  }
  for (const bad of ['80', 'unknown', '', '1980']) {
    ok(!dk(bad), 'the non-date DOB "' + bad + '" must NOT satisfy the weak link');
  }
  void sbK;
}

{ /* NAME ALONE IS NEVER ENOUGH */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam J Schaeffer', '1980-02-11')],
    rows: [ROW({ name: 'Adam J Schaeffer', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  const out = sb.api().run({});
  eq(out.saved, 0, 'a name-only row must never attribute a provider to a chart');
  ok(!('providerLink' in sb.patients()[0]), 'name-only attribution must leave the record untouched');
  eq(out.rows.unlinked, 1, 'the unlinkable row must be reported, not silently dropped');
}

{ /* AN AMBIGUOUS name+DOB PAIR IS CLAIMED BY NOBODY. Duplicate charts of one
     person are a live condition; a coin flip here would stamp the wrong chart. */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11'), PT('p2', 'Adam Schaeffer', '1980-02-11')],
    rows: [ROW({ name: 'Adam Schaeffer', dob: '1980-02-11', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  const out = sb.api().run({});
  eq(out.saved, 0, 'an ambiguous name+DOB must attribute to NEITHER duplicate');
  ok(!('providerLink' in sb.patients()[0]) && !('providerLink' in sb.patients()[1]),
    'neither duplicate chart may be stamped from an ambiguous row');
}

{ /* a DOB that is not a real date cannot carry a weak link on either side */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '80')],
    rows: [ROW({ name: 'Adam Schaeffer', dob: '80', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  eq(sb.api().run({}).saved, 0, 'a DOB that is not a canonical date must not satisfy the weak link');
}

{ /* a strong pointer at an id that is not in the roster attributes to nobody -
     it must NOT fall through to the name match and stamp a different chart */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [ROW({ patient_external_id: 'GHOST', name: 'Someone Else', dob: '1999-01-01', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  eq(sb.api().run({}).saved, 0, 'a row pointing at an absent chart must attribute to nobody');
}

/* =====================================================================
   3. IDEMPOTENCE AND ACCUMULATION
   ===================================================================== */

{ /* running twice on the same evidence must save exactly once */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  eq(sb.api().run({}).saved, 1, 'the first run must stamp');
  const after1 = JSON.stringify(sb.patients()[0].providerLink.providersSeen);
  const second = sb.api().run({});
  eq(second.saved, 0, 'a second run over identical evidence must save NOTHING');
  eq(second.reason, 'no-change', 'and must report no-change');
  eq(sb.saves.length, 1, 'savePatients must have been called exactly once across two runs');
  eq(JSON.stringify(sb.patients()[0].providerLink.providersSeen), after1, 'the stored value must be stable');
}

{ /* THE WINDOW MOVES BUT THE HISTORY DOES NOT SHRINK. _calAppts only ever
     holds the loaded calendar window; paging to September must ADD to August,
     never replace it, and re-showing August must not double-count. */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [
      ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' }),
      ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-17' })
    ]
  });
  sb.api().run({});
  eq(sb.patients()[0].providerLink.providersSeen[0].count, 2, 'August must count two days');

  sb.setRows([ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-09-04' })]);
  eq(sb.api().run({}).saved, 1, 'a new month of evidence must be recorded');
  const seen = sb.patients()[0].providerLink.providersSeen[0];
  eq(seen.count, 3, 'the September day must ADD to the August days, not replace them');
  eq(seen.last, '2026-09-04', 'the most recent day must advance');
  deep(seen.days, ['2026-09-04', '2026-08-17', '2026-08-03'], 'the counted day keys must be kept, newest first');

  /* back to August: already-counted days must not be counted again */
  sb.setRows([
    ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' }),
    ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-17' })
  ]);
  eq(sb.api().run({}).saved, 0, 're-showing an already-counted month must change nothing');
  eq(sb.patients()[0].providerLink.providersSeen[0].count, 3, 'the count must not inflate on a re-run');
}

{ /* two rows on the SAME day with the same provider are one visit day */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [
      ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03', start_at: '2026-08-03T14:00:00Z' }),
      ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03', start_at: '2026-08-03T16:30:00Z' })
    ]
  });
  sb.api().run({});
  eq(sb.patients()[0].providerLink.providersSeen[0].count, 1, 'two rows on one day are one visit day');
}

{ /* an evidence set that only ADDS a second provider must still be a change */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  sb.api().run({});
  sb.setRows([ROW({ patient_external_id: 'p1', provider: 'Sarah Nguyen, PA-C', appt_date: '2026-08-05' })]);
  eq(sb.api().run({}).saved, 1, 'a newly seen provider must be recorded');
  eq(sb.patients()[0].providerLink.providersSeen.length, 2, 'both providers must survive');
  eq(sb.patients()[0].providerLink.primaryProvider, 'Sarah Nguyen, PA-C',
    'a 1-1 tie must resolve to the more recent day, even across runs');
}

/* =====================================================================
   4. BOUNDED - a per-patient field on a 1400-record roster
   ===================================================================== */

{
  const rows = [];
  for (let d = 1; d <= 15; d++) rows.push(ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-' + String(d).padStart(2, '0') }));
  for (const n of ['A One, MD', 'B Two, MD', 'C Three, MD', 'D Four, MD', 'E Five, MD']) {
    rows.push(ROW({ patient_external_id: 'p1', provider: n, appt_date: '2026-07-01' }));
  }
  const sb = makeSandbox({ patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')], rows });
  sb.api().run({});
  const l = sb.patients()[0].providerLink;
  ok(l.providersSeen.length <= 4, 'providersSeen must be bounded (got ' + l.providersSeen.length + ')');
  eq(l.providersSeen[0].count, 12, 'the day window must be bounded at 12');
  eq(l.providersSeen[0].capped, true, 'a bounded entry must SAY it is bounded rather than under-report silently');
  eq(l.providersSeen[0].days.length, 12, 'exactly the bounded day keys are stored');
  eq(l.providersSeen[0].days[0], '2026-08-15', 'the kept days must be the most recent ones');
  ok(JSON.stringify(l).length < 1200, 'the per-patient field must stay small (got ' + JSON.stringify(l).length + ' bytes)');
}

/* =====================================================================
   5. NEVER DURING A PULL
   ===================================================================== */

{
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  sb.context.window.__mlsPullBusyAt = Date.now();
  const out = sb.api().run({});
  eq(out.saved, 0, 'a busy pull must not rewrite the patient store');
  eq(out.reason, 'deferred-pull-busy', 'the deferral must be stated honestly');
  eq(sb.saves.length, 0, 'savePatients must not be reached while a pull is busy');
  const armed = sb.timers.filter((t) => t.fn && t.ms === 20000);
  eq(armed.length, 1, 'exactly one deferred re-check must be armed');

  sb.api().run({});
  eq(sb.timers.filter((t) => t.fn && t.ms === 20000).length, 1, 'repeated busy calls must not stack deferred timers');

  sb.context.window.__mlsPullBusyAt = 0;
  armed[0].fn();
  eq(sb.saves.length, 1, 'the deferred run must stamp once the pull is idle');
  eq(sb.patients()[0].providerLink.primaryProvider, 'Matthew Schaeffer, MD', 'and must produce the same verdict');
}

{ /* a stale busy stamp (a crashed pull) must not block forever */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  sb.context.window.__mlsPullBusyAt = Date.now() - 120000;
  eq(sb.api().run({}).saved, 1, 'a stale busy stamp must not suppress the derivation forever');
}

{ /* ANOTHER TAB'S pull owns the store too - the shield is shared on purpose */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  sb.context.window.__mlsPullShieldForeign = function () { return true; };
  const out = sb.api().run({});
  eq(out.reason, 'deferred-pull-busy', 'a foreign tab holding the pull shield must defer this derivation too');
  eq(sb.saves.length, 0, 'no write may land while another tab is pulling');
}

/* =====================================================================
   6. THE SAVE - a field update, never a removal
   ===================================================================== */

{
  const before = [PT('p1', 'Adam Schaeffer', '1980-02-11'), PT('p2', 'Jane Doe', '1975-06-01'), PT('p3', 'No Rows', '1960-01-01')];
  const sb = makeSandbox({
    patients: before,
    readGen: 4242,
    rows: [
      ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' }),
      ROW({ patient_external_id: 'p2', provider: 'Sarah Nguyen, PA-C', appt_date: '2026-08-04' })
    ]
  });
  sb.api().run({});
  eq(sb.saves.length, 1, 'exactly one save');
  const call = sb.saves[0];

  /* THE FLAG THAT LETS A SAVE DROP A CHART MUST NOT BE HERE */
  eq(call.opts && call.opts.allowRemovals, undefined,
    'a provider stamp must NEVER pass allowRemovals - that flag exists to let a save DROP rows');
  deep(call.arr.map((p) => p.id), ['p1', 'p2', 'p3'],
    'the id set going in must equal the id set coming out, in order');
  eq(call.arr.length, before.length, 'no row may be added or removed by a derivation');
  deep((call.opts && call.opts.dirtyIds) || [], ['p1', 'p2'],
    'only the rows that actually changed may be declared dirty');
  eq(call.readGen, 4242,
    'the read generation must survive onto the saved array - dropping it falls back to the 12-second clock rule');

  /* the untouched record must be the SAME object (no needless delta) and the
     changed ones must be COPIES, or the store compares a row against itself */
  eq(call.arr[2], before[2], 'an unchanged row must be passed through by reference');
  ok(call.arr[0] !== before[0], 'a stamped row must be a COPY - an in-place edit is invisible to the store delta');
  eq(before[0].providerLink, undefined, 'the derivation must not mutate the array it was handed');
  eq(call.arr[0].name, 'Adam Schaeffer', 'every other field must ride along untouched');
  ok(Array.isArray(call.arr[0].visits), 'visits must ride along untouched');
}

{ /* a save that throws must be reported, not swallowed as success */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  sb.context.savePatients = function () { throw new Error('quota'); };
  const out = sb.api().run({});
  eq(out.saved, 0, 'a failed save must not be counted as a stamp');
  eq(out.reason, 'save-failed', 'a failed save must say so');
}

{ /* deriveAll is a READ - it must write nothing */
  const sb = makeSandbox({
    patients: [PT('p1', 'Adam Schaeffer', '1980-02-11')],
    rows: [ROW({ patient_external_id: 'p1', provider: 'Matthew Schaeffer, MD', appt_date: '2026-08-03' })]
  });
  const res = sb.api().deriveAll({});
  eq(sb.saves.length, 0, 'deriveAll must never save');
  ok(!('providerLink' in sb.patients()[0]), 'deriveAll must never mutate a record');
  deep(res.changed, ['p1'], 'deriveAll must still report what WOULD change');
  eq(res.providers.length, 1, 'deriveAll must roll the roster up by provider');
  eq(res.providers[0].patients, 1, 'the rollup counts PATIENTS per provider');
}

/* =====================================================================
   7. THE DOOR - the additive field survives the server round trip
   ===================================================================== */

function lift(src2, name) {
  const i = src2.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing function ' + name);
  let d = 0, e = -1;
  const j = src2.indexOf('{', i);
  for (let k = j; k < src2.length; k++) {
    const c = src2[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  assert.ok(e > 0, 'unbalanced function ' + name);
  return src2.slice(i, e);
}

for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');

  /* the ptshape door coerces four chart fields and MUST leave everything else
     alone - if it ever became an allowlist, providerLink would vanish on every
     hydration from the server */
  const api = new Function(
    lift(html, '_mlsGenerationFieldText') + '\n' + lift(html, '_mlsNormalizePatientChartFields') +
    '\nreturn _mlsNormalizePatientChartFields;')();
  const link = {
    v: 1, primaryProvider: 'Matthew Schaeffer, MD', primaryProviderKey: 'matthew schaeffer',
    providersSeen: [{ name: 'Matthew Schaeffer, MD', key: 'matthew schaeffer', count: 2, last: '2026-08-17', days: ['2026-08-17', '2026-08-03'] }],
    at: 1756700000000
  };
  const serverRow = { name: 'Adam Schaeffer', dob: '1980-02-11', problems: ['A', 'B'], providerLink: JSON.parse(JSON.stringify(link)) };
  const wire = JSON.stringify(serverRow.providerLink);
  api(serverRow);
  eq(JSON.stringify(serverRow.providerLink), wire,
    shell + ': the chart-field door MODIFIED providerLink - an additive field must pass through untouched');
  eq(typeof serverRow.problems, 'string', shell + ': this suite is measuring nothing if the door stopped coercing');

  /* and the field survives a real JSON round trip, which is exactly what
     POST /api/patients + GET /api/patients do to it (data is an opaque blob) */
  deep(JSON.parse(JSON.stringify(link)), link, 'providerLink must be JSON-round-trippable with no loss');

  /* ---------------- shell wiring, pinned in every lane ---------------- */
  ok(html.indexOf("if(__prev.providerLink&&p.providerLink==null)p.providerLink=__prev.providerLink;") > 0,
    shell + ': upsertPatient replaces a record wholesale (arr[i]=p) - without the providerLink carry, every ' +
    'demographics edit silently drops the patient\'s provider until the next pull');
  ok(html.indexOf("try{ if(typeof window.__mlsPlvChip==='function') chips+=(window.__mlsPlvChip(p)||''); }catch(e){}") > 0,
    shell + ': the patient list row does not call the provider chip');
  ok(html.indexOf("if(Array.isArray(_plvOut)) matched=_plvOut;") > 0,
    shell + ': the Patients list does not apply the provider filter');
  ok(html.indexOf("((p.providerLink&&p.providerLink.v===1&&p.providerLink.primaryProvider)?('Provider '+p.providerLink.primaryProvider):'')") > 0,
    shell + ': the patient card does not name the derived provider');

  /* THE FILTER MUST NARROW BEFORE THE 150-ROW CAP. Filtering the capped page
     would hide every patient of that provider who sorts past position 150 -
     and the list would look empty for a provider who has forty. */
  const iFilter = html.indexOf('__mlsPlvFilter(matched)');
  const iCap = html.indexOf('const PT_CAP=150;');
  ok(iFilter > 0 && iCap > 0 && iFilter < iCap,
    shell + ': the provider filter must run BEFORE the 150-row cap, not after it');

  /* and the count must stop claiming "N patients" once something narrowed it */
  ok(/var baseCount=\(ql\|\|_plvNarrowed\) \?/.test(html),
    shell + ': the patient count still says "N patients" while the provider filter is hiding rows');

  /* the module's provider key must be the CALENDAR's provider key, or a
     provider grouped here is a different provider than the calendar groups */
  const calKey = new Function(lift(html, '_calProvKey') + '\nreturn _calProvKey;')();
  const sbK = makeSandbox({});
  for (const sample of ['Matthew Schaeffer, MD', 'Schaeffer, Matthew M.D.', 'Sarah Nguyen, PA-C', 'Uyen Tran DO', '', 'Dr. Adam Best']) {
    eq(sbK.api().provKey(sample), calKey(sample),
      shell + ': the provider key disagrees with the calendar for "' + sample + '"');
  }
}

/* =====================================================================
   8. THE FILTER SURFACE
   ===================================================================== */

{
  const link = (name, key, last) => ({ v: 1, primaryProvider: name, primaryProviderKey: key, providersSeen: [{ name, key, count: 1, last, days: [last] }] });
  const sb = makeSandbox({
    mountSelect: true,
    patients: [
      PT('p1', 'A', '1980-02-11', { providerLink: link('Matthew Schaeffer, MD', 'matthew schaeffer', '2026-08-03') }),
      PT('p2', 'B', '1981-02-11', { providerLink: link('Matthew Schaeffer, MD', 'matthew schaeffer', '2026-08-04') }),
      PT('p3', 'C', '1982-02-11', { providerLink: link('Sarah Nguyen, PA-C', 'nguyen sarah', '2026-08-05') }),
      PT('p4', 'D', '1983-02-11')
    ]
  });
  sb.api().syncFilterOptions();
  const sel = sb.els.mlsPlvSel;
  deep(sel.options.map((o) => o.value), ['', 'matthew schaeffer', 'nguyen sarah', '__no_provider__'],
    'the dropdown must offer exactly the derived providers plus the honest "no provider" bucket');
  eq(sel.options[1].text, 'Matthew Schaeffer, MD (2)', 'each provider option must carry its real patient count');
  eq(sel.options[3].text, 'No provider recorded (1)', 'the unattributed bucket must be counted honestly');

  /* the filter itself */
  const rows = sb.patients().map((p) => ({ patient: p }));
  sb.store['mls_provider_link_filter_v1'] = 'matthew schaeffer';
  deep(sb.context.window.__mlsPlvFilter(rows).map((r) => r.patient.id), ['p1', 'p2'], 'a provider filter must select exactly that provider\'s patients');
  sb.store['mls_provider_link_filter_v1'] = '__no_provider__';
  deep(sb.context.window.__mlsPlvFilter(rows).map((r) => r.patient.id), ['p4'], '"No provider recorded" must select exactly the unattributed patients');
  delete sb.store['mls_provider_link_filter_v1'];
  eq(sb.context.window.__mlsPlvFilter(rows).length, 4, 'an unarmed filter must pass every row through unchanged');

  /* AN ARMED PROVIDER THAT NO LONGER EXISTS MUST DISARM, not silently filter
     the whole list to nothing */
  sb.store['mls_provider_link_filter_v1'] = 'gone away';
  sel._mlsPlvSig = null;
  sb.api().syncFilterOptions();
  eq(sb.store['mls_provider_link_filter_v1'], undefined, 'a vanished provider must disarm the filter');
  eq(sel.value, '', 'and the control must return to All providers');
}

{ /* ARMING THE FILTER MUST ACTUALLY REPAINT. renderPatients returns EARLY when
     the roster object, query, sort and group mode are unchanged - and a filter
     change moves none of them, so without clearing that memo the control would
     visibly do nothing. Driven here through the REAL control the module mounts
     and its REAL onchange handler. */
  const link = { v: 1, primaryProvider: 'M, MD', primaryProviderKey: 'm', providersSeen: [{ name: 'M, MD', key: 'm', count: 1, last: '2026-08-03', days: ['2026-08-03'] }] };
  const sb = makeSandbox({ mountRow: true, patients: [PT('p1', 'A', '1980-02-11', { providerLink: link })] });
  eq(sb.api().mountFilter(), true, 'the filter control must mount into the patient search row');
  const sel = sb.els.mlsPlvSel;
  ok(sel, 'the mounted control must be findable by id');
  eq(typeof sel.onchange, 'function', 'the mounted control must carry a change handler');
  deep(sel.options.map((o) => o.value), ['', 'm'], 'the mounted control must list the derived provider');

  const list = sb.els.ptList;
  list._mlsRoster = { memo: true }; list._mlsNotesVer = 7; list._mlsSig = 'stale';
  const before = sb.renders();
  sel.value = 'm';
  sel.onchange();
  eq(sb.store['mls_provider_link_filter_v1'], 'm', 'the chosen provider must be remembered');
  eq(list._mlsRoster, null, 'the render memo must be cleared, or renderPatients returns early and the filter does nothing');
  eq(list._mlsNotesVer, null, 'the notes-version half of the memo must be cleared too');
  eq(list._mlsSig, '', 'the html signature must be cleared or the list keeps the old innerHTML');
  eq(sb.renders(), before + 1, 'the Patients list must actually be re-rendered');

  /* and clearing the selection must disarm rather than store an empty key */
  sel.value = '';
  sel.onchange();
  eq(sb.store['mls_provider_link_filter_v1'], undefined, 'choosing All providers must remove the stored filter');
}

{ /* nothing derived at all -> the control hides rather than offering one empty choice */
  const sb = makeSandbox({ mountSelect: true, patients: [PT('p1', 'A', '1980-02-11')] });
  sb.api().syncFilterOptions();
  eq(sb.els.mlsPlvSel.style.display, 'none', 'with no derived provider the filter must stay out of the way');
}

/* =====================================================================
   9. THE CHIP
   ===================================================================== */

{
  const sb = makeSandbox({});
  eq(sb.api().chip({ id: 'p1' }), '', 'a patient with no derived provider must render NO chip - never "Unassigned"');
  eq(sb.api().chip({ id: 'p1', providerLink: { v: 1, primaryProvider: '' } }), '', 'an empty derived name must render no chip');
  eq(sb.api().chip(null), '', 'a missing patient must render no chip');
  const html = sb.api().chip({
    id: 'p1',
    providerLink: {
      v: 1, primaryProvider: 'Matthew Schaeffer, MD', primaryProviderKey: 'matthew schaeffer',
      providersSeen: [
        { name: 'Matthew Schaeffer, MD', key: 'matthew schaeffer', count: 2, last: '2026-08-17', days: ['2026-08-17', '2026-08-03'] },
        { name: 'Sarah Nguyen, PA-C', key: 'nguyen sarah', count: 1, last: '2026-08-05', days: ['2026-08-05'] }
      ]
    }
  });
  ok(html.indexOf('Matthew Schaeffer, MD') > 0, 'the chip must name the primary provider');
  ok(html.indexOf('+1') > 0, 'the chip must say when a second provider was also seen');
  ok(/2 visit days recorded/.test(html), 'the chip tooltip must state what the count is counting');
  ok(/derived from attributed appointments/.test(html), 'the chip must say where the provider came from');

  /* a hostile provider name may not escape the attribute or the row */
  const hostile = { id: 'p1', providerLink: { v: 1, primaryProvider: '"><img src=x onerror=alert(1)>', primaryProviderKey: 'x"y', providersSeen: [{ name: 'x', key: 'x', count: 1, last: '2026-08-01', days: ['2026-08-01'] }] } };
  const evil = sb.api().chip(hostile);
  ok(evil.indexOf('<img') < 0, 'a provider name must be escaped before it reaches the patient row');
  ok(evil.indexOf('&lt;img') > 0, 'the escaped form must actually be present');

  /* and on the REAL path, where the shell's own esc() is installed - the chip
     lands inside a title="..." attribute, so the double quote matters most */
  const shellEsc = new Function('return ' + /function esc\(s\)\{[^\n]*\}/.exec(fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8'))[0].replace(/^function esc/, 'function esc') + ';')();
  const sb2 = makeSandbox({});
  sb2.context.window.esc = shellEsc;
  const evil2 = sb2.api().chip(hostile);
  ok(evil2.indexOf('<img') < 0, 'the shell esc() must also neutralise a hostile provider name');
  ok(evil2.indexOf('"><img') < 0, 'a provider name must not be able to close the title attribute');
  eq((evil2.match(/"/g) || []).length, (evil2.match(/="/g) || []).length * 2,
    'every quote in the chip must be an attribute delimiter - a stray quote is an escape hole');
}

/* =====================================================================
   10. WIRING AND HOUSE SHAPE
   ===================================================================== */

/* THE TWINS MUST BE IDENTICAL IN THE EDITED REGIONS. Four shells are touched -
   the 1p source, its /1p twin, and the production and cloned derivations - and
   a hook that lands in three of them is a feature that works everywhere except
   where the owner happens to be looking. Every inserted BLOCK, comment and all,
   must appear exactly once in every lane. */
{
  const BLOCKS = [
    /* upsertPatient carry */
    "      /* plv-1.0.0: providerLink is DERIVED state with exactly one writer\n" +
    "         (feat_mls_provider_link.js). No caller of this function produces it,\n" +
    "         so an incoming object without it is always a caller that simply never\n" +
    "         saw it - not an erasure anybody asked for. arr[i]=p replaces the\n" +
    "         record wholesale, so without this line every demographics edit and\n" +
    "         every stale-reference write-back would silently drop the patient's\n" +
    "         provider until the next pull re-derived it. Fill-only: a value the\n" +
    "         caller DOES carry is never overwritten. */\n" +
    "      if(__prev.providerLink&&p.providerLink==null)p.providerLink=__prev.providerLink;",
    /* roster row chip */
    "  /* plv-1.0.0: the patient's DERIVED provider, or nothing at all. The module\n" +
    "     owns the whole chip (and returns '' when no attributed appointment ever\n" +
    "     named a provider) so this list never has to guess one. */\n" +
    "  try{ if(typeof window.__mlsPlvChip==='function') chips+=(window.__mlsPlvChip(p)||''); }catch(e){}",
    /* roster filter */
    "  /* plv-1.0.0: the provider filter narrows the RANKED roster, before the\n" +
    "     150-row cap below - filtering the capped page instead would silently hide\n" +
    "     every patient of that provider who sorts past position 150. */\n" +
    "  var _plvBefore=matched.length;\n" +
    "  try{ if(typeof window.__mlsPlvFilter==='function'){ var _plvOut=window.__mlsPlvFilter(matched); if(Array.isArray(_plvOut)) matched=_plvOut; } }catch(e){}\n" +
    "  var _plvNarrowed=matched.length!==_plvBefore;",
    /* patient card */
    "  /* plv-1.0.0: the chart says who this patient's provider is, when an\n" +
    "     attributed appointment established one. filter(Boolean) drops it silently\n" +
    "     when nothing has - the card never guesses a provider. */"
  ];
  for (const shell of SHELLS) {
    const file = path.join(root, shell);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    BLOCKS.forEach((b, i) => {
      eq(html.split(b).length - 1, 1,
        shell + ': plv hook block #' + (i + 1) + ' must appear EXACTLY once - the four shells must be byte-identical here');
    });
  }
}

/* EVERY EDITED LANE MUST STILL PARSE. A hook spliced into the shell's 35k-line
   inline block is exactly the edit that can pass a grep and fail the parser -
   and a shell that does not parse is a doctor who cannot log in. Four shells
   are touched; all four are compiled here, script by script. */
for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc=/i.test(attrs)) continue;
    if (/type="(?!text\/javascript|module|application\/javascript)/i.test(attrs)) continue;
    n++;
    let boom = '';
    try { new vm.Script(m[2], { filename: shell + '#' + n }); } catch (e) { boom = String(e.message || e); }
    eq(boom, '', shell + ': inline script #' + n + ' does not parse - the app would not boot');
  }
  ok(n > 50, shell + ': only ' + n + ' inline scripts compiled - this gate is measuring the wrong document');
}

for (const c of CONNECTS) {
  const text = fs.readFileSync(path.join(root, c), 'latin1');
  let boom = '';
  try { new vm.Script(fs.readFileSync(path.join(root, c), 'utf8'), { filename: c }); } catch (e) { boom = String(e.message || e); }
  eq(boom, '', c + ': the bundle does not parse');
  ok(text.indexOf("s.src='feat_mls_provider_link.js?v='+(window.__MLS_AV||Date.now());") > 0,
    c + ': the provider-link module is never loaded');
  ok(text.indexOf("data-mls-asset=\"feat_mls_provider_link.js\"") > 0,
    c + ': the loader has no duplicate-install guard');
  /* a late surface has no claim on the sign-in seconds (owner 5s bar) */
  const at = text.indexOf('feat_mls_provider_link.js');
  const stanza = text.slice(Math.max(0, at - 400), at);
  ok(/__mlsDeferAsset\|\|window\.requestIdleCallback/.test(stanza),
    c + ': the provider-link module must load DEFERRED, past first paint');
}

{
  const inv = JSON.parse(fs.readFileSync(path.join(root, 'pages-publication-inventory.json'), 'utf8'));
  ok(inv.paths.indexOf('feat_mls_provider_link.js') >= 0,
    'the module is not in the publication inventory - it would 404 on the deployed site');
}

{ /* ES5 house shape: this file ships beside modules that must parse in the
     same lane, and the whole feature-module set is written without arrows */
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/=>/.test(body), 'the module must stay ES5 (no arrow functions)');
  ok(!/\blet\b|\bconst\b/.test(body), 'the module must stay ES5 (var only)');
  ok(/window\.__mlsProviderLink_revert/.test(src), 'the module must be revertible');
  ok(/version: VERSION/.test(src) && /var VERSION = 'plv-1\.0\.0'/.test(src), 'the release marker must be stated');
  /* the flag may be NAMED in prose (the module explains why it is absent) but
     must never appear in executable code */
  ok(src.indexOf('allowRemovals') > 0, 'the module must state, in prose, why it does not pass allowRemovals');
  ok(!/allowRemovals/.test(body),
    'the module must never mention allowRemovals in CODE - that flag exists to let a save DROP rows');
}

{ /* the exported surface the Month report lane will consume */
  const sb = makeSandbox({});
  const api = sb.api();
  for (const fn of ['deriveAll', 'forPatient', 'status', 'run']) {
    eq(typeof api[fn], 'function', 'window.__mlsProviderLink.' + fn + ' must be exported');
  }
  eq(api.status().version, 'plv-1.0.0', 'status() must state the version');
  eq(api.forPatient('nobody'), null, 'forPatient must return null for an unknown id, never a guess');
}

{ /* boot must arm behind the auto-merge, and must react to a completed pull */
  const sb = makeSandbox({});
  const boot = sb.timers.filter((t) => t.fn && t.ms === 14000);
  eq(boot.length, 1, 'exactly one boot-time derivation must be armed');
  ok(14000 > 12000, 'the boot derivation must land AFTER the auto-merge boot sweep, so it derives the survivor');
  ok(/j\.kind !== 'schedule_pull'/.test(src), 'the derivation must hook the schedule-pull job event');
  ok(/j\.status === 'completed' \|\| j\.status === 'partial'/.test(src), 'a completed OR partial pull must re-derive');
  ok(/\}, 5000\);/.test(src), 'the post-pull derivation must land after the auto-merge post-pull sweep (4s)');
}

console.log('provider-patient-linkage: ' + checks + ' checks passed');
