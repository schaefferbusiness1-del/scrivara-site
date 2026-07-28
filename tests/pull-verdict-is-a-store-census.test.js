'use strict';

/* THE PULL REPORTED 19/19 AND WROTE ZERO CHARACTERS.
 *
 * MEASURED on the owner live account against a SIGNED-IN athenaOne, Wed
 * 2026-07-29, 19 appointments, 157 seconds:
 *   verdict            "Verified complete: schedule 19/19; history 19/19; failures 0"
 *   the recorder       19 patients "ok", storedOk 19, failures 0, reasons {}
 *   store before/after stamps 19 -> 19, problems 6 -> 6, problemChars 1555 -> 1555,
 *                      meds 0 -> 0, visits 18 -> 18  (BYTE IDENTICAL)
 *   same session       one of those patients had SEVEN documented active problems
 *                      (740 chars) that MLS does not hold
 *   ten patients       hold nothing but the ~32-character import stamp line
 *
 * The verdict was not lying about what it believed. It was structurally
 * incapable of disagreeing with itself: every number in it was a count of rows
 * the pull had WALKED.
 *   receipt.requested = rows.length + unresolved.length
 *   receipt.processed++ fires for a pure failure and for every patient
 *                       regardless of whether anything landed
 *   finalizeVerdict     derived complete from exactly those counters
 * No wording change to a walk counter could ever have caught this. The number
 * had to be measured against the store.
 *
 * So the verdict takes a CENSUS: for every patient of the day, resolve the
 * immutable local patient id through the resolver the history reader already
 * uses and ask whether that stored record actually holds clinical content.
 *
 * FIVE WAYS THE FIRST CENSUS COULD STILL BE SILENCED, each now pinned below,
 * because every one of them reproduced the original lie verbatim:
 *   1. a visit DATE counted as clinical content, so any dated index shell shut
 *      the gap - and the failing read produces exactly those shells
 *      (_normVisit sets raw to "" when indexOnly, feat_visits.js)
 *   2. VITALS were not counted at all, so a patient with BP, height, weight and
 *      BMI captured was reported as holding nothing - the same defect with the
 *      sign flipped, an instrument accusing a good read
 *   3. the placeholder vocabulary was narrower than the apps own isNoData, so
 *      allergies of "None on file" - a value the save deliberately KEEPS - made
 *      19 of 19 hold content, and a bullet of "SOCIAL: None on file" did it
 *      through the summary
 *   4. the denominator was rows only, so patients whose identity never resolved
 *      vanished from the fraction (2 of 6 became 2 of 2), and a day whose rows
 *      ALL failed resolution scored a vacuous 0 of 0 with measured true
 *   5. one census taken only AFTER the walk cannot tell a record THIS pull
 *      filled from one an earlier pull filled, so the second zero-write pull of
 *      the same day would close its own gap. There are now two censuses and a
 *      delta between them.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT DO. It does not turn an empty patient
 * into a failure. A genuinely empty Athena chart is a valid outcome, MLS cannot
 * tell it apart from a read that missed the content, and
 * tests/chart-refresh-merge-runtime.test.js correctly requires that a
 * verified-empty chart still SAVES. The requirement here is honest reporting,
 * not refusal - so this suite also pins that receipt.complete is NOT conjoined
 * with the census, and that no message ever guesses at a cause.
 *
 * It also does not fix the missing data. The chart read lands on
 * /ax/briefing/<patientId>, which has no Active Problems section, instead of
 * /ax/appointment/<apptId>/briefing, which does. That is a different build.
 * This suite makes sure the next such defect cannot hide behind a green verdict.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');

function between(source, begin, end, label) {
  const a = source.indexOf(begin);
  assert(a >= 0, 'missing source marker (' + label + '): ' + begin);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, 'missing source end marker (' + label + '): ' + end);
  return source.slice(a, b);
}

/* ------------------------------------------------------------------ *
 * 1. RUNTIME: the census measures the STORE, one patient at a time.
 * ------------------------------------------------------------------ */
const prelude = between(si, 'function safe(fn, d) {', '/* Managed schedule/history pulls', 'safe/gfn/callG');
const firstField = between(si, 'function firstField(a, fields) {', 'function rowMrn(a)', 'firstField');
const rowLocal = between(si, 'function rowLocalPatientId(a) {', '\n', 'rowLocalPatientId');
const byId = between(si, 'function patientById(id) {', 'function exactHistoryTarget(row)', 'patientById');
/* No build number in a source marker: bump-build renumbers those, and a marker
   that moves on the next build takes the whole suite with it. */
const censusSrc = between(si, 'var CENSUS_EMPTY_ITEM =', 'function recordHistoryVerdict(day', 'census');

const STAMP = 'Pulled from Athena 7/29/2026';
const BULLET = '• ';
const SEVEN_PROBLEMS = [
  'Type 2 diabetes mellitus without complications',
  'Essential hypertension',
  'Chronic kidney disease stage 3',
  'Hyperlipidemia',
  'Obstructive sleep apnea',
  'Osteoarthritis of the right knee',
  'Vitamin D deficiency'
].join('; ');

const store = [
  /* the patient whose seven active problems Athena showed and MLS now holds */
  { id: 'p_full', problems: SEVEN_PROBLEMS, meds: '', allergies: '', summary: STAMP + '\nActive problems captured.' },
  /* the ten who got the stamp line and nothing else - the whole defect */
  { id: 'p_stamp', problems: '', meds: '', allergies: '', summary: STAMP },
  /* same, written by the ScribeFlow dash-wrapped stamp */
  { id: 'p_stamp_dashes', problems: '', meds: '', allergies: '', summary: '— ' + STAMP + ' —' },
  /* placeholder text is not content either */
  { id: 'p_placeholder', problems: 'none recorded', meds: 'N/A', allergies: 'No known allergies', summary: STAMP },
  /* content can arrive through any single card */
  { id: 'p_meds_only', problems: '', meds: 'metformin 500 mg BID', summary: '' },
  { id: 'p_visits_only', problems: '', meds: '', summary: STAMP, visits: [{ date: '06/20/2026', type: 'Office visit', raw: 'Progress note text' }] },
  { id: 'p_history_only', problems: '', meds: '', summary: '', history: { pmh: 'Appendectomy 2011', social: '' } },
  /* VITALS ARE CLINICAL CONTENT. A first-visit patient with BP, height, weight
     and BMI captured and nothing else documented is the ordinary case, and the
     census used to report him as holding nothing at all. */
  { id: 'p_vitals_only', problems: '', meds: '', summary: STAMP, vitals: { bp: '128/78', heightIn: '70', weightLb: '190', bmi: '27.3', takenAt: '2026-07-29' } },
  /* A DATED INDEX SHELL IS NOT CONTENT. _normVisit sets raw to "" for an
     index-only row by construction, so this row carries a date, a type and zero
     clinical text - and the failing briefing read produces exactly this. */
  { id: 'p_index_shell', problems: '', meds: '', summary: STAMP, visits: [{ id: 'v1', date: '2026-05-04', type: 'Office visit', raw: '', indexOnly: true }] },
  /* the placeholder the SAVE DELIBERATELY KEEPS: merge retains the newest
     no-data value when no meaningful fact exists, and the summary bullet says
     the same thing a second time behind a LABEL: prefix */
  { id: 'p_none_on_file', problems: '', allergies: 'None on file', history: { social: 'None on file' }, summary: STAMP + '\nPrior history:\n' + BULLET + 'SOCIAL: None on file' },
  /* the other value the apps own isNoData knows and the census did not */
  { id: 'p_not_available', problems: 'Not available', meds: '', summary: '' },
  /* the summary form of the index shell: a Recent visits section whose bullets
     are "<date> - <type>" lines built from row metadata, not chart text */
  { id: 'p_visit_index_block', problems: '', meds: '', summary: STAMP + '\n\nRecent visits:\n' + BULLET + '06/20/2026 - Office visit', visits: [{ id: 'v2', date: '06/20/2026', raw: '', indexOnly: true }] },
  /* an empty visits array is not content, and this one never even got a stamp -
     so stampOnlySummary must come out BELOW withoutContent */
  { id: 'p_empty_visits', problems: '', meds: '', summary: '', visits: [] }
];

const ctx = {
  console, Date, Math, JSON, Object, String, Number, Array, Boolean, RegExp, isFinite
};
ctx.window = ctx;
ctx.window.getPatients = function () { return store.slice(); };
vm.runInNewContext(prelude + '\n' + firstField + '\n' + rowLocal + '\n' + byId + '\n' + censusSrc,
  ctx, { filename: 'store-census.js' });

assert.strictEqual(typeof ctx.storedContentCensus, 'function',
  'the census must be a real function in the schedule-import module, not a comment about one');

const row = id => ({ patient_external_id: id, scheduleDate: '2026-07-29' });
const dayRows = store.map(p => row(p.id)).concat([
  row('p_never_saved'),           /* an id the store never got */
  { scheduleDate: '2026-07-29' }, /* a row with no local patient id at all */
  row('p_full')                   /* second appointment, same patient */
]);
const census = ctx.storedContentCensus(dayRows);

assert.strictEqual(census.measured, true, 'the census must report that it actually ran');
assert.strictEqual(census.rows, 16, 'rows is the count the batch was handed');
assert.strictEqual(census.targets, 15,
  'targets counts DISTINCT patients plus rows with no id - a second appointment for one ' +
  'person must never manufacture a gap');
assert.strictEqual(census.resolved, 13, 'thirteen of the fifteen targets resolve to a stored record');
assert.strictEqual(census.unresolved, 2, 'the never-saved id and the id-less row are unresolved');

assert.strictEqual(census.withContent, 5,
  'p_full, p_meds_only, p_visits_only, p_history_only and p_vitals_only hold clinical content - ' +
  'and nobody else does');
assert.strictEqual(census.withoutContent, 8,
  'the stamp-only, placeholder, index-shell and empty records hold none');
assert.strictEqual(census.withContent + census.withoutContent, census.resolved,
  'every resolved record must be counted exactly once, or the fraction is arithmetic fiction');
assert.strictEqual(census.gap, 10,
  'the gap is every target the store cannot show content for: 8 empty + 2 unresolved. ' +
  'On the measured day this is the number the verdict called zero.');
assert.strictEqual(census.stampOnlySummary, 6,
  'the patients whose ONLY stored text is the import stamp must be counted separately - ' +
  'that is the signature of a read that landed on a page with no clinical section');

assert.strictEqual(census.fields.problems, 1, 'exactly one stored record holds problems');
assert.strictEqual(census.fields.meds, 1, 'exactly one stored record holds meds');
assert.strictEqual(census.fields.allergies, 0,
  '"No known allergies" and "None on file" are placeholders, not allergies');
assert.strictEqual(census.fields.vitals, 1, 'exactly one stored record holds vitals');
assert.strictEqual(census.fields.visits, 1,
  'only the visit carrying a real body counts. If this reads 3 the dated index shells are ' +
  'being counted and the failing read can close its own gap again.');
assert.strictEqual(census.fields.history, 1, 'exactly one stored record holds structured history');
assert.strictEqual(census.fields.summary, 1,
  'the ONLY summary that counts is the one with text beyond the stamp line. If this ever ' +
  'reads higher than 1 the stamp, a section heading, a placeholder bullet or an encounter ' +
  'index is being counted as content and the defect is back.');

/* ---- the individual predicates, asserted directly ---- */
assert.strictEqual(ctx.censusSummaryHasContent(STAMP), false,
  'a summary that is only the import stamp is a receipt that a read happened, not content');
assert.strictEqual(ctx.censusSummaryHasContent('— ' + STAMP + ' —'), false,
  'the dash-wrapped stamp form must not count either');
assert.strictEqual(ctx.censusSummaryHasContent(STAMP + '\nPROBLEMS: hypertension'), true,
  'a stamp FOLLOWED by captured text is content - the rule must not over-refuse');
assert.strictEqual(ctx.censusSummaryHasContent(STAMP + ' PROBLEMS: hypertension'), true,
  'content on the same line as the stamp is still content');
assert.strictEqual(ctx.censusSummaryHasContent('Longitudinal summary refreshed 7/29/2026'), false,
  'the other stamp the app writes is also not content');
assert.strictEqual(ctx.censusSummaryHasContent(''), false, 'an empty summary is not content');
assert.strictEqual(ctx.censusSummaryHasContent('Prior history:\n' + BULLET + 'SOCIAL: None on file'), false,
  'a section heading is structure and a bullet whose VALUE is a placeholder is not a fact');
assert.strictEqual(ctx.censusSummaryHasContent('Prior history:\n' + BULLET + 'SOCIAL: never smoked'), true,
  'the same bullet with a real value IS content - the rule must cut at the value, not the label');
assert.strictEqual(ctx.censusSummaryHasContent('Recent visits:\n' + BULLET + '06/20/2026 - Office visit'), false,
  'the Recent visits section is an encounter index assembled from row metadata, so it can ' +
  'never be the evidence that a chart body was captured');
assert.strictEqual(ctx.censusSummaryHasContent('SOCIAL:'), false,
  'a label with no value must not read as clinical text');

assert.strictEqual(ctx.censusVisitsHaveContent({ visits: [{ id: 'v', date: '2026-05-04', type: 'Office visit', raw: '', indexOnly: true }] }), false,
  'AN INDEX SHELL IS NOT A BODY. _emptyPlaceholder in feat_visits.js treats indexOnly as a ' +
  'shell unconditionally, and _normVisit empties raw for exactly those rows.');
assert.strictEqual(ctx.censusVisitsHaveContent({ visits: [{ id: 'v', date: '2026-05-04', type: 'Office visit' }] }), false,
  'a bare date and a bare visit type are metadata. _hasVisitContent deliberately ignores both.');
assert.strictEqual(ctx.censusVisitsHaveContent({ visits: [{ id: 'v', date: '2026-05-04', raw: 'text', indexOnly: true }] }), false,
  'indexOnly must be checked FIRST and unconditionally, exactly as _emptyPlaceholder does. ' +
  '_normVisit empties raw for an index-only row, so a row claiming both is malformed - and ' +
  '_strictVerifiedAthenaBody in this same file refuses indexOnly regardless of what raw holds.');
assert.strictEqual(ctx.censusVisitsHaveContent({ visits: [{ id: 'v', date: '2026-05-04', raw: 'Assessment and plan...' }] }), true,
  'a visit with a real body is content');
assert.strictEqual(ctx.censusVisitsHaveContent({ visits: [{ id: 'v', date: '2026-05-04', icd10: ['E11.9'] }] }), true,
  'coded diagnoses are content, matching _hasVisitContent');
assert.strictEqual(ctx.censusVisitsHaveContent({ visits: [{ id: 'v', date: '2026-05-04', raw: '', textHead: '2026-05-04 Office Visit' }] }), false,
  'textHead is the INDEX LINE, so it cannot be the evidence that a body was captured');
assert.strictEqual(ctx.censusVisitsHaveContent({ visits: [{ id: 'v', date: '2026-05-04', raw: '', aiSummary: 'Office visit on 2026-05-04.' }] }), false,
  'feat_visits._emptyPlaceholder states that this AI summary is derived from row metadata ' +
  'rather than encounter content, so the reader that produced only shells must not be able to ' +
  'use its own summaries as proof of capture');

assert.strictEqual(ctx.censusVitalsHaveContent({ vitals: { bp: '128/78' } }), true,
  'a captured blood pressure is clinical content - this module already lists vitals as one ' +
  'of its clinical fields');
assert.strictEqual(ctx.censusVitalsHaveContent({ vitals: { takenAt: '2026-07-29' } }), false,
  'when the vitals were taken is metadata, exactly like a visit date');
assert.strictEqual(ctx.censusVitalsHaveContent({ vitals: {} }), false, 'an empty vitals object is not content');
assert.strictEqual(ctx.censusVitalsHaveContent({ vitals: { bp: 'Not recorded' } }), false,
  'a placeholder vital is not a vital');

for (const placeholder of ['none', 'None recorded', 'None on file', 'Not available', 'Not applicable',
  'not documented', 'unknown', 'N/A', 'n / a', 'no data', 'No known allergies', 'NKA', 'nil', 'Deferred']) {
  assert.strictEqual(ctx.censusListHasContent(placeholder), false,
    'the placeholder vocabulary must be at least as wide as the apps own isNoData: [' + placeholder + '] slipped through');
}
assert.strictEqual(ctx.censusListHasContent('none recorded; essential hypertension'), true,
  'one real fact beside a placeholder is still content');

/* the census must never throw and never write */
assert.doesNotThrow(() => ctx.storedContentCensus(null), 'the census must survive a null row list');
assert.strictEqual(ctx.storedContentCensus([]).gap, 0, 'an empty day has no gap to report');
assert.strictEqual(ctx.storedContentCensus([]).measured, true,
  'a genuinely empty day IS measured - there is nothing to resolve and nothing to claim');
assert.strictEqual(JSON.stringify(ctx.storedContentCensus([row('p_stamp')]).emptyPatientIds), '["p_stamp"]',
  'the census must name which patients hold nothing, or the finding is not actionable');

/* ---- THE DENOMINATOR IS THE DAY, not the rows the batch happened to get ---- */
const unresolvedDay = ctx.storedContentCensus(
  [row('p_full'), row('p_meds_only')],
  [{ patientId: 'u1', reason: 'identity-target-unresolved' }, { patientId: 'u2', reason: 'retry-proof-missing' },
   { patientId: 'u3', reason: 'retry-identity-changed' }, { patientId: 'u4', reason: 'retry-target-unavailable' }]);
assert.strictEqual(unresolvedDay.targets, 6,
  'a six-appointment day with four unresolved rows has SIX targets. Censusing rows alone read ' +
  '"2 of 2" and made four patients that were never even attempted disappear from the fraction.');
assert.strictEqual(unresolvedDay.withContent, 2, 'two records hold content');
assert.strictEqual(unresolvedDay.neverAttempted, 4, 'the four unresolved patients are counted as never attempted');
assert.strictEqual(unresolvedDay.withoutContent, 0,
  'an unresolved patient is NOT a record we may call empty - we never looked at one. It lands ' +
  'in the gap and in unresolved, never in withoutContent.');
assert.strictEqual(unresolvedDay.gap, 4, 'the gap carries the four patients the day never accounted for');
const dedup = ctx.storedContentCensus([row('p_full')], [{ patientId: 'p_full', reason: 'history-partial' }]);
assert.strictEqual(dedup.targets, 1,
  'a patient present as BOTH a row and an unresolved entry is one target, not two');

/* THE INSTRUMENT LIES FIRST. A census that cannot resolve a single patient of a
   non-empty day has almost certainly not read the store at all, and a false
   "0 of 19 hold content" is the same class of defect as a false "19/19". */
const blind = ctx.storedContentCensus([row('nobody_1'), row('nobody_2')]);
assert.strictEqual(blind.measured, false,
  'zero resolutions out of a non-empty day must report UNMEASURED, never zero content');
assert.strictEqual(blind.gap, 0, 'an unmeasured census must not publish a gap it did not measure');
/* the same guard has to cover the day whose rows ALL failed identity resolution:
   the batch is handed zero rows and nineteen unresolved entries, which scored a
   vacuous "0 of 0, measured true" and rendered history 0/0 where the walk
   counters had at least said 0/19. */
const allUnresolved = ctx.storedContentCensus([], Array.from({ length: 19 }, (_, i) => ({ patientId: 'x' + i, reason: 'identity-target-unresolved' })));
assert.strictEqual(allUnresolved.targets, 19, 'the nineteen patients of the day are still nineteen targets');
assert.strictEqual(allUnresolved.measured, false,
  'a day on which nothing resolved must be reported UNMEASURED, not as a vacuous 0 of 0 pass');

/* it must not have invented a second resolver: the ids it reports come from the
   same rowLocalPatientId -> patientById chain the history reader itself uses */
assert(/rowLocalPatientId\(rows\[i\]\)/.test(censusSrc) && /patientById\(pid\)/.test(censusSrc),
  'the census must REUSE the existing row-to-patient resolver, not add a second one');
assert(!/getPatients/.test(censusSrc),
  'the census must go through patientById rather than opening its own getPatients loop - ' +
  'two resolvers is how a row silently resolves differently in two places');

/* ---- WHAT THIS PULL CAPTURED, as distinct from what MLS holds ---- */
assert.strictEqual(typeof ctx.censusDelta, 'function', 'the before/after delta must be a real function');
const beforeCensus = ctx.storedContentCensus(dayRows);
const zeroWrite = ctx.censusDelta(beforeCensus, ctx.storedContentCensus(dayRows));
assert.strictEqual(zeroWrite.measured, true, 'two measured censuses produce a measured delta');
assert.strictEqual(zeroWrite.compared, 13, 'every resolved record is compared');
assert.strictEqual(zeroWrite.changed, 0,
  'A PULL THAT WROTE NOTHING MUST REPORT ZERO CHANGED. This is the number that would have ' +
  'contradicted "history 19/19" on the day whose store was byte identical before and after, ' +
  'even for a store an earlier pull had already filled.');
store.find(p => p.id === 'p_stamp').problems = 'Essential hypertension';
const oneWrite = ctx.censusDelta(beforeCensus, ctx.storedContentCensus(dayRows));
assert.strictEqual(oneWrite.changed, 1, 'one record that gained content reads as one changed');
assert.strictEqual(oneWrite.unchanged, 12, 'the rest are unchanged');
store.find(p => p.id === 'p_stamp').problems = '';
/* the fingerprint must be content SIZE and never a save timestamp: the measured
   pull rewrote athenaChartImportedAt on records whose characters did not move,
   and a delta that counted that would call a zero-write pull a capture. */
assert(!/athenaChartImportedAt|capturedAt|Date\.now/.test(between(censusSrc, 'function censusFingerprint(', '\n  }', 'fingerprint')),
  'the content fingerprint must not include any save timestamp');
assert.strictEqual(ctx.censusDelta(null, beforeCensus).measured, false,
  'with no before-census there is no delta to claim');
assert.strictEqual(ctx.censusDelta(blind, beforeCensus).measured, false,
  'an unmeasured half makes the delta unmeasured');

/* ------------------------------------------------------------------ *
 * 2. STRUCTURE: the verdict is derived from the census, not the walk.
 * ------------------------------------------------------------------ */
const rhb = si.slice(si.indexOf('async function runHistoryBatch('), si.indexOf('function finalizeVerdict()'));
assert(rhb.length > 1000, 'runHistoryBatch must still exist ahead of finalizeVerdict');
assert(/receipt\.storeCensusBefore = storedContentCensus\(rows, unresolved\);/.test(rhb),
  'the store must be measured BEFORE the first chart is opened. One census taken after the ' +
  'walk cannot tell a record this pull filled from one an earlier pull filled, so the second ' +
  'zero-write pull of the same day would close its own gap.');
assert(rhb.indexOf('receipt.storeCensusBefore') < rhb.indexOf('ppStart((sweepProgressTotal'),
  'the before-census must be taken before the per-patient loop starts');

const fvAt = si.indexOf('function finalizeVerdict()');
assert(fvAt > 0, 'finalizeVerdict must still exist');
const fv = si.slice(fvAt, si.indexOf('\n    }', fvAt) + 6);

assert(/receipt\.storeCensus = storedContentCensus\(rows, unresolved\);/.test(fv),
  'finalizeVerdict must MEASURE THE STORE, and the census must be handed the days unresolved ' +
  'patients too - otherwise the denominator shrinks to hide the patients that were never ' +
  'attempted at all');
assert(fv.indexOf('receipt.storeCensus = storedContentCensus(rows, unresolved);') < fv.indexOf('receipt.complete ='),
  'the store must be measured BEFORE the verdict is computed - a census taken after the ' +
  'claim is a footnote to a lie');
assert(/receipt\.storeDelta = censusDelta\(receipt\.storeCensusBefore, receipt\.storeCensus\);/.test(fv),
  'the receipt must carry the before/after delta, or nothing in the verdict can say whether ' +
  'THIS pull captured anything');
assert(/receipt\.contentGap = /.test(fv) && /receipt\.contentVerified = /.test(fv),
  'the receipt must carry the gap and a separate content claim, so no consumer can read ' +
  'complete without the census being right there');
assert(/receipt\.storedContent = /.test(fv) && /receipt\.storedNoContent = /.test(fv),
  'the receipt must state how many patients hold content and how many hold none');
assert(/receipt\.storedChanged = /.test(fv) && /receipt\.storeChangeMeasured = /.test(fv),
  'the receipt must state how many stored records this pull changed');

/* HONEST REPORTING, NOT REFUSAL. If a future edit conjoins the census into
   receipt.complete, a patient whose Athena chart is genuinely empty becomes a
   hard failure: the day never completes, the Retry control appears with an
   empty retry list, and chart-refresh-merge-runtime.test.js (a verified-empty
   chart still saves) is contradicted at the day level. */
const completeLine = fv.split('\n').filter(l => /receipt\.complete = /.test(l)).join('\n');
assert(completeLine, 'the complete assignment must be findable');
assert(!/storeCensus|contentGap|contentVerified|storedContent|storeDelta/.test(completeLine),
  'receipt.complete must NOT be gated on the census. An empty chart is a valid outcome, ' +
  'not a failure - the census is reported, never refused.');

/* A SUBSET RUN MUST NOT OVERWRITE THE DAY. The automatic sweep and the manual
   retry both walk a handful of the days patients through this same
   finalizeVerdict, and the ledger record is keyed by day. */
assert(fv.indexOf('if (sweepDepth) return;') > 0,
  'a sweep sub-batch must not write the day ledger record: it walks three swept patients and ' +
  'would file them under day-level field names, and on the break paths of the sweep loop that ' +
  'subset record is the one left standing');
assert(fv.indexOf('if (sweepDepth) return;') < fv.indexOf('recordHistoryVerdict(day, receipt, rows.length)'),
  'the guard must come before the write, not after it');

/* the recorder persists it into the day ledger */
const recAt = si.indexOf('function recordHistoryVerdict(day, receipt, dayRowCount)');
assert(recAt > 0, 'the recorder must still exist with its original signature');
const rec = si.slice(recAt, si.indexOf('function markDone(', recAt));
assert(/contentOk: Number\(census\.withContent \|\| 0\)/.test(rec),
  'the ledger must record how many of the days patients hold real clinical content');
assert(/contentNone: Number\(census\.withoutContent \|\| 0\)/.test(rec),
  'the ledger must record how many hold none');
assert(/contentGap: Number\(census\.gap \|\| 0\)/.test(rec) && /census: ledgerCensus/.test(rec),
  'the ledger must record the gap and the full census, so a later investigation can ' +
  'compare the measurement against the walk counts sitting beside it');
assert(/contentMeasured: census\.measured === true/.test(rec),
  'an older receipt with no census must record UNMEASURED rather than zero content - ' +
  'zero would be a claim that was never measured');
assert(/contentChanged: Number\(delta\.changed \|\| 0\)/.test(rec) && /changeMeasured: delta\.measured === true/.test(rec),
  'the ledger must record what this pull CHANGED beside what the store holds - contentChanged 0 ' +
  'next to contentOk 19 is the shape of the measured defect written down');
assert(/athenaSourced: Number\(census\.athenaSourced \|\| 0\)/.test(rec),
  'the ledger must record how many records hold an Athena-attributed snapshot, so a fact the ' +
  'clinician typed by hand can be told apart from a fact a chart read brought in');
assert(/ck !== "prints"/.test(rec),
  'the per-patient content fingerprint exists for one comparison and must never be persisted ' +
  'into the bounded ledger');

/* ------------------------------------------------------------------ *
 * 3. THE SENTENCE THE DOCTOR ACTS ON.
 * ------------------------------------------------------------------ */
assert(/var historySummary = \(historyStoreCensus && historyStoreCensus\.measured === true\)/.test(si),
  'the history fraction in the terminal status line must be measured against the store; ' +
  'processed/requested are both walk counters and reported 19/19 on a day that stored nothing');
assert(/failures 0\." \+ freshnessNotice\(r\) \+ providerScopeNotice\(selectedProvider\.mode\) \+ contentNotice\(historyReceipt\)/.test(si),
  'the terminal verdict must carry the census notice. It is appended AFTER the freshness ' +
  'and provider notices so the distances pinned by all-providers-means-all-providers and ' +
  'schedule-read-declares-its-freshness stay byte-identical.');

const noticeSrc = between(si, 'function censusChangeClause(hr) {', '\n  function providerScopeReceipt', 'contentNotice');
const nctx = { console, Math, String, Number };
nctx.window = nctx;
vm.runInNewContext(noticeSrc, nctx, { filename: 'content-notice.js' });
assert.strictEqual(typeof nctx.contentNotice, 'function', 'contentNotice must be a real function');
const gapNotice = nctx.contentNotice({ storeCensus: { measured: true, targets: 19, withContent: 9 }, storeDelta: { measured: true, compared: 19, changed: 0 } });
assert(/Chart content in MLS: 9 of 19 patients\./.test(gapNotice), 'the terminal notice states the measurement');
assert(/10 hold none that MLS can see/.test(gapNotice), 'the gap is stated as a number of patients');
assert(/No stored record changed during this pull\./.test(gapNotice),
  'THE PULL SENTENCE. A store the doctor filled by hand, or an earlier pull filled, must not ' +
  'let a zero-write pull read as a capture.');
assert(!/was captured for/.test(gapNotice),
  'the notice must not claim that nothing was captured for those patients: a vitals-only ' +
  'record and a hand-typed record both hold content, so that phrasing accused good reads');
const changedNotice = nctx.contentNotice({ storeCensus: { measured: true, targets: 19, withContent: 19 }, storeDelta: { measured: true, compared: 19, changed: 7 } });
assert(/7 of 19 stored records changed during this pull\./.test(changedNotice), 'a real capture is stated as one');
assert(!/hold none/.test(changedNotice), 'full coverage must not invent a gap');
/* AN UNMEASURED CENSUS MUST NOT FALL SILENT: silence handed the sentence back to
   processed/requested with nothing saying the store had never been looked at. */
const unmeasuredNotice = nctx.contentNotice({ storeCensus: { measured: false, rows: 19, targets: 19, withContent: 0 } });
assert(/NOT measured/.test(unmeasuredNotice) && /rows walked rather than of records stored/.test(unmeasuredNotice),
  'an unmeasured census must say so out loud rather than leaving the discredited walk count ' +
  'standing unqualified');
assert(!/0 of 19/.test(unmeasuredNotice), 'it must not report a zero it never measured');
assert.strictEqual(nctx.contentNotice({}), '', 'a receipt with no census at all says nothing');
assert.strictEqual(nctx.contentNotice(null), '', 'a missing receipt must not throw');
/* asserted on the RENDERED sentences rather than the source, because the source
   comment has to be free to explain why the control is deliberately not named */
for (const rendered of [gapNotice, changedNotice, unmeasuredNotice]) {
  assert(!/Retry failed histories/.test(rendered),
    'the notice must NOT name Retry failed histories: that control is built from ' +
    'receipt.retry and is hidden when retry is empty, so these patients - who are not ' +
    'failures - would be sent to a button that is not there');
}

/* the owner-visible ready message */
const censusLineSrc = between(connect, 'function censusLine(hr) {', 'function pullOutcome(result, day)', 'censusLine');
const cctx = { console, Date, Math, JSON, Object, String, Number, Array, RegExp };
cctx.window = cctx;
vm.runInNewContext(censusLineSrc, cctx, { filename: 'census-line.js' });
assert.strictEqual(typeof cctx.censusLine, 'function', 'censusLine must be a real function');

const short = cctx.censusLine({ storeCensus: { measured: true, targets: 19, withContent: 9 }, storeDelta: { measured: true, compared: 19, changed: 0 } });
assert(/Chart content in MLS: 9 of 19 patients\./.test(short),
  'the ready message must state stored content as a fraction of the day, in words');
assert(/10 hold none that MLS can see\./.test(short),
  'the gap must be stated as a number of patients, not implied by subtraction');
assert(/No stored record changed during this pull\./.test(short),
  'the ready message must also state what this pull changed - the store census alone cannot ' +
  'catch a zero-write pull against a store an earlier pull filled');
assert(!/Retry failed histories/.test(short),
  'the ready message must not send the doctor to a control that is hidden when retry is empty');
assert(!/Athena is empty|athena has no|chart is empty|was captured for/i.test(short),
  'the message must NOT claim the Athena chart was empty, and must not claim nothing was ' +
  'captured for those patients - from here those are indistinguishable from a read that ' +
  'missed the content. Say what was measured, not why.');
assert(/Pulling this day again re-reads every chart\./.test(short),
  'the one route that is genuinely true must be named: an explicit pull always performs a ' +
  'fresh chart read for every row');

const full = cctx.censusLine({ storeCensus: { measured: true, targets: 19, withContent: 19 }, storeDelta: { measured: true, compared: 19, changed: 4 } });
assert(/Chart content in MLS: 19 of 19 patients\./.test(full), 'full coverage still states the measurement');
assert(!/hold none/.test(full), 'full coverage must not invent a gap');
assert(/4 of 19 stored records changed during this pull\./.test(full), 'and still says what it changed');
const one = cctx.censusLine({ storeCensus: { measured: true, targets: 1, withContent: 0 } });
assert(/0 of 1 patient\./.test(one) && /1 holds none/.test(one), 'the single-patient wording must agree in number');
const unmeasuredLine = cctx.censusLine({ storeCensus: { measured: false, rows: 19, targets: 19, withContent: 0 } });
assert(/was not measured for this day/.test(unmeasuredLine),
  'AN UNMEASURED CENSUS MUST NOT FALL SILENT in the ready message either. Returning an empty ' +
  'string left the owner with a message byte-identical to the one he was shown for the pull ' +
  'that stored nothing.');
assert(!/0 of 19/.test(unmeasuredLine), 'it must not report a zero it never measured');
assert.strictEqual(cctx.censusLine({}), '', 'a receipt with no census must say nothing');
assert.strictEqual(cctx.censusLine(null), '', 'a missing receipt must not throw');

const po = connect.slice(connect.indexOf('function pullOutcome(result, day)'), connect.indexOf('function pullOutcome(result, day)') + 2700);
assert(/\+ censusLine\(hr\)/.test(po),
  'the ready message must actually call the census line - an uncalled reporter is the ' +
  'present-but-unreachable pattern this codebase has shipped repeatedly');
assert(/ok: true, message: /.test(po) && po.indexOf('censusLine(hr)') > po.indexOf('ok: true, message: '),
  'the census must ride the ok:true ready message itself. That is the message the owner was ' +
  'shown for a pull that stored nothing.');
assert(/as the reader counted it/.test(po),
  'the ready message now carries TWO fractions - the readers own count of charts it finished, ' +
  'and the census of what the store holds. Say which is which, or the sentence contains two ' +
  'disagreeing numbers with nothing to separate them.');

/* ------------------------------------------------------------------ *
 * 4. EVERY VERDICT SURFACE, not just the loudest one.
 *
 * The Calendar "Pull <provider> - <date>" button renders its result AFTER the
 * promise resolves, which OVERWRITES the status text the inner onStatus had just
 * written - so the census sentence appeared and was then replaced by "Verified
 * complete: schedule N/M; histories 19/19; failures 0" rebuilt from hr.processed
 * and hr.requested. That is the last thing the owner sees on that surface, and
 * it is the exact sentence this whole change exists to make impossible.
 * ------------------------------------------------------------------ */
const polish = fs.readFileSync(path.join(root, 'feat_mls_calendar_polish.js'), 'utf8');
assert(/var storeCensus = hr\.storeCensus && hr\.storeCensus\.measured === true \? hr\.storeCensus : null;/.test(polish),
  'the Calendar provider-day verdict must read the census off the history receipt');
assert(/var historyDone = storeCensus \? Number\(storeCensus\.withContent \|\| 0\)/.test(polish) &&
  /var historyTotal = storeCensus \? Number\(storeCensus\.targets \|\| 0\)/.test(polish),
  'its histories fraction must be MEASURED against the store, with the walk counters kept only ' +
  'as the fallback for a receipt that carries no census');
assert(/api\.contentNotice/.test(polish) && (polish.match(/contentSay/g) || []).length === 3,
  'it must append the same census sentence, obtained from the ONE exported copy of the wording ' +
  'rather than a second paraphrase that can drift');
assert(/contentNotice: contentNotice,/.test(si),
  'the schedule-import module must export the notice so there is exactly one copy of the words');
const polishComplete = polish.split('\n').filter(l => /Verified complete: schedule/.test(l)).join('\n');
assert(polishComplete, 'the Calendar complete line must be findable');
assert(/contentSay/.test(polishComplete),
  'the Calendar COMPLETE line specifically must carry the census - an incomplete-only notice ' +
  'would leave the green verdict as the one place the lie still renders');

console.log('PASS the pull verdict is a STORE CENSUS: coverage is measured by resolving every ' +
  'patient of the day - rows AND the unresolved - to its stored record and asking whether that ' +
  'record actually holds clinical content, where a stamp-only summary, a section heading, a ' +
  'placeholder bullet, an encounter index and a dated index shell are all correctly NOT content ' +
  'and vitals correctly ARE; a second census taken before the walk states what this pull itself ' +
  'changed; an unmeasured census says so instead of falling silent; the census is recorded in ' +
  'the day ledger beside the walk counts it contradicts and only by the outer batch; and an ' +
  'empty chart stays a valid saved outcome rather than becoming a failure');
