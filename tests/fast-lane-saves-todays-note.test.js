'use strict';

/* Full Notes scope regression, under the contract ACTUALLY in force.
 *
 * This header used to read "OFF is schedule-only and cannot use onlyDate or
 * singlePull as a permission bypass". Half of that was revoked: a well-formed
 * onlyDate read is the MANDATORY pulled-day encounter note and is admitted in
 * BOTH modes, which is exactly the owner requirement that OFF still saves the
 * required same-day visit context. The suite kept asserting the revoked half
 * and was therefore red on main.
 * The half that stands, and is what this file really guards, is the other
 * sentence in the same gate: UNSCOPED reads remain hard-bounded by the
 * preference. singlePull cannot buy a full history under OFF, and an unmade
 * choice is reported as unchosen rather than as an explicit OFF. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const fv = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

/* ---- 1. the date-key normalizer, EXECUTED ---- */
{
  const s = bg.indexOf('function mlsVisitDateKeyForHint');
  assert(s > 0, 'date-key helper missing');
  const fn = bg.slice(s, bg.indexOf('function freezeVisitHint', s));
  const ctx = vm.createContext({});
  vm.runInContext(fn + '\nthis.k = mlsVisitDateKeyForHint;', ctx);
  assert.strictEqual(ctx.k('2026-07-28'), '2026-07-28', 'ISO passes through');
  assert.strictEqual(ctx.k('7/28/2026'), '2026-07-28', 'M/D/YYYY normalizes');
  assert.strictEqual(ctx.k('07/28/26'), '2026-07-28', 'MM/DD/YY normalizes');
  assert.strictEqual(ctx.k('Office visit 07/28/2026 note'), '2026-07-28', 'date inside row text still keys');
  assert.strictEqual(ctx.k(''), '', 'empty stays empty');
  assert.strictEqual(ctx.k('no date here'), '', 'dateless rows key to empty (never match a requested day)');
}

/* ---- 2. reader arithmetic: skipped day rows leave the exact-count gate closed ---- */
assert(bg.includes("onlyDate: mlsVisitDateKeyForHint(hint.onlyDate)"), 'freezeVisitHint must carry onlyDate');
assert(bg.includes('dateSkippedRows = []'), 'reader must track day-scoped skips');
/* scensus-1.0.0 pin, re-derived 2026-08-28 (skipkey-1.0.0). This demanded the
   single conflated condition
     frozenHint.onlyDate && mlsVisitDateKeyForHint(snap.date) !== frozenHint.onlyDate
   which treated an UNPARSEABLE date exactly like a known other-day row: the key
   comes back '' , '' !== onlyDate, so the row was skipped as "outside the
   requested day". That is absence-by-arithmetic - a row that can neither prove
   nor disprove the requested day being counted as proof it is not there. The
   worker split the two on purpose and says so at the branch itself. The suite
   was never re-derived, so it has been red on main for a correctness FIX.
   Note this file reads background.js, which is frozen at 3.0.84 by owner order -
   so the test is the only thing that could move here, and it is also the thing
   that was wrong.
   Pinned as the three properties that matter: the branch is scoped-only, an
   unreadable date is UNKNOWN rather than absent, and a known other-day row is
   skipped - with neither body read. */
assert(/if \(frozenHint\.onlyDate\) \{/.test(bg),
  'the scoped-day branch no longer keys on the frozen hint, so an unscoped pass could skip rows');
assert(/var scRowKey = mlsVisitDateKeyForHint\(snap\.date\);/.test(bg),
  'the scoped branch no longer derives the row key through the shared date normalizer');
assert(/if \(!scRowKey\) \{ dateUnknownRows\.push\(/.test(bg),
  'an UNPARSEABLE encounter date is being treated as a known other-day row again - it would shrink the ' +
  'scoped census into absence-by-arithmetic instead of making it partial');
assert(/if \(scRowKey !== frozenHint\.onlyDate\) \{ dateSkippedRows\.push\(/.test(bg),
  'the skip branch keys on the frozen hint');
assert(/dateUnknownRows\.length/.test(bg) && /dateSkippedRows\.length/.test(bg),
  'the scoped census no longer reports unknown and skipped rows separately, so a surface cannot tell ' +
  'an unreadable date from a genuinely different day');
assert(bg.includes('total - administrativeRows.length - dateSkippedRows.length'), 'completeness arithmetic must exclude the deliberately skipped rows');
assert(bg.includes('dateSkippedRows: dateSkippedRows.length'), 'the receipt must say exactly what was scoped out');
assert(bg.includes('(outside the requested day - body not read)'), 'skips are narrated, never silent');

/* ---- 3. vp gate: every reader option honors the preference, EXECUTED ---- */
{
  const s = mc.indexOf('api.runForPatient = function (p, onStatus, runOpts) {');
  const e = mc.indexOf('function ensureSettings', s);
  assert(s > 0 && e > s, 'runForPatient block missing');
  const block = mc.slice(s, e);
  const calls = [];
  let isOn = false;
  /* prefvocab-1.0.0 (2026-08-28): the gate now distinguishes an EXPLICIT OFF
     from a choice that was never made:
       skipped: choiceSettled ? 'preference-off' : 'preference-unchosen'
     and choiceSettled reads window.__mlsVisitNotesPref. This harness modelled
     no preference at all, so every call took the UNCHOSEN branch while the
     assertions demanded 'preference-off' - the suite has been red on main
     asserting a code path its own harness could not reach.
     That distinction is not cosmetic: unchosen is the fail-closed state that
     must prompt, and reporting it as an explicit OFF would tell the doctor
     they had made a choice they never made. Both branches are exercised now. */
  let settledChoice = null;
  const ctx = vm.createContext({
    api: { running: false, current: null },
    enabled: () => isOn,
    window: {
      __mlsCopyVisits: { run: (cb, p, opts) => { calls.push(opts || null); return Promise.resolve(3); } },
      get __mlsVisitNotesPref() {
        return settledChoice ? { read: () => settledChoice } : undefined;
      }
    },
    Promise, Error
  });
  vm.runInContext(block, ctx);
  return Promise.resolve()
    /* No choice on file: the gate must say so, not imply an explicit OFF. */
    .then(() => ctx.api.runForPatient({ id: 'p1', name: 'Zz' }, null))
    .then(r => assert.strictEqual(r && r.skipped, 'preference-unchosen',
      'an unmade Full Notes choice was reported as an explicit OFF - the doctor would be told they chose something they never chose'))
    /* ...and from here on, a SETTLED OFF, which is the state the rest of this
       block was always describing. */
    .then(() => { settledChoice = { settled: true, state: 'off' }; })
    .then(() => ctx.api.runForPatient({ id: 'p1', name: 'Zz' }, null))
    .then(r => assert.strictEqual(r && r.skipped, 'preference-off', 'full read stays gated by the preference'))
    .then(() => { ctx.api.running = false; ctx.api.current = null; })
    /* prefvocab-1.0.0: this asserted that onlyDate under OFF still skipped -
       "OFF is schedule-only and cannot use onlyDate as a permission bypass".
       That contract is REVOKED. An exact-day scoped read is the MANDATORY
       pulled-day encounter note and is admitted in both modes; the gate says so
       where it is written, and the owner requirement it implements is that OFF
       saves schedule/booking plus the required same-day visit context. Pinning
       the old literal would mean demanding the mandatory read be refused.
       What must still hold, and is pinned below, is the other half of that same
       sentence: UNSCOPED reads stay hard-bounded by the preference. */
    .then(() => ctx.api.runForPatient({ id: 'p1', name: 'Zz' }, null, { onlyDate: '2026-07-28' }))
    .then(r => {
      assert(!(r && r.skipped),
        'a SETTLED Full Notes OFF refused the date-scoped read (' + (r && r.skipped) + ') - that read is the ' +
        'mandatory pulled-day encounter note, and refusing it is what leaves the day without its own visit context');
      assert.strictEqual(calls.length, 1, 'the admitted day-scoped read never reached the visit reader');
      assert(calls[0] && calls[0].onlyDate === '2026-07-28',
        'the day-scoped read reached the reader without its scope - it would return every body, not the day');
    })
    .then(() => { ctx.api.running = false; ctx.api.current = null; })
    /* ...and the bypass this file was really guarding against is still shut:
       an UNSCOPED read under OFF stays refused. */
    .then(() => ctx.api.runForPatient({ id: 'p1', name: 'Zz' }, null, { singlePull: true }))
    .then(r => {
      assert.strictEqual(r && r.skipped, 'preference-off', 'singlePull bypassed Full Notes OFF');
      assert.strictEqual(calls.length, 1, 'an UNSCOPED read under OFF reached the visit reader');
      isOn = true;
    })
    .then(() => { ctx.api.running = false; ctx.api.current = null; })
    .then(() => ctx.api.runForPatient({ id: 'p1', name: 'Zz' }, null, { onlyDate: '2026-07-28' }))
    .then(r => {
      assert(r && r.ok === true, 'an explicitly ON date-scoped catch-up did not run');
      assert.strictEqual(calls.length, 2, 'cv.run invoked exactly once more for the ON catch-up');
      assert(calls[1] && calls[1].onlyDate === '2026-07-28', 'onlyDate forwarded to cv.run');
      part4();
      console.log('fast-lane-saves-todays-note: PASS');
    })
    .catch(err => { console.error(err); process.exit(1); });
}

function part4() {
  /* ---- 4. date capability remains, but every OFF auto-lane is fused ---- */
  assert(fv.includes("onlyDate: String(runOpts.onlyDate || '')"), 'cv payload must carry onlyDate');
  assert(fv.includes('function run(onStatus, patientOverride, runOpts)'), 'cv.run accepts opts');
  /* prefvocab-1.0.0 (2026-08-28): this demanded the inline OFF body lane be
     FUSED OFF. dayfacts-1.0.1 revoked that fuse in as many words, at the fuse:
       "the inline fold-in IS the day-facts same-day leg - it reads exactly the
        pulled-day encounter note while the row's chart is already open and
        verified ... The pre-contract fuse ('never enter it from this batch')
        is revoked together with schedule-only OFF."
     Re-fusing it to satisfy this literal would delete the mandatory same-day
     leg for every row whose direct scoped read failed - the owner's required
     same-day visit context, gone, to turn a test green.
     Pinned instead as the guards that keep the now-enabled lane honest. */
  assert(si.includes('var pulledDayNoteLaneEnabled = true;'),
    'the inline day-facts fold-in has been fused off again - every row whose direct scoped read failed would lose its same-day note');
  assert(/if \(pulledDayNoteLaneEnabled && !stopAfterTimeout && pullVisitBodies !== true && one\.visitsSkipped === true && rd && !inlineDayNoteFuse && one\.todayNote == null\) \{/.test(si),
    'the inline fold-in lost one of its own guards. It must stay OFF-mode-only (pullVisitBodies !== true, ' +
    'visitsSkipped), run only on a verified open chart (rd), respect the fuse, and never double-read a row ' +
    'whose note already landed through the direct scoped bridge (todayNote == null)');
  assert(/dayfacts-1\.0\.1 \(superseding owner DAY contract\)/.test(si),
    'the superseding DAY contract comment is gone - if the fold-in is no longer the day-facts same-day leg, re-derive this pin rather than silencing it');
  /* prefvocab-1.0.0: same revocation as the fold-in above. The tail pass is the
     day-facts CATCH-UP for rows the inline fold-in never reached, and it is
     mandatory under the superseding contract. Every identifier in it is
     todayNote* and it is keyed to the batch row's OWN day, so it cannot reach
     another day's note - which is what made "fuse it off" look safe and is
     exactly why it is not. tests/qol-pulled-day-note-honesty pins the same
     three properties; they agree deliberately, so a future revert cannot pass
     one suite while failing the other. */
  assert(!/var pulledDayNoteTailEnabled = false;/.test(si) || /pulledDayNoteTailEnabled = true;/.test(si),
    'the pulled-day tail fuse is off, which disables the mandatory day-facts catch-up for every row the inline fold-in missed');
  assert(/if \(pulledDayNoteTailEnabled && pullVisitBodies !== true && !__stpStopped\)/.test(si),
    'the tail catch-up is no longer OFF-mode-only and stop-aware - it could run under ON, or keep reading after a stop');
  assert(/todayNoteDayById\[pid\] = batchRowDay\(r\)/.test(si),
    'the pulled-day tail is no longer bound to the batch row OWN day - it could reach a different day than the one being pulled');
  /* prefvocab-1.0.0: this required niSyncFromReceipt to refuse every OFF
     receipt outright. Revoked at the function itself:
       "day-facts receipts DO carry a per-row day-note stage; the old
        OFF-has-no-stage premise is revoked with its contract"
       "the old refusal ('A Full Notes OFF receipt intentionally contains no
        visit-body stage') is revoked with the contract that wrote it"
     Restoring the blanket refusal would strand every OFF row whose same-day
     note failed both the direct read and the fold-in - the backfill is their
     last rung. What must still hold is that the backfill is fed from the
     per-row STATE, never re-opens a chart already accounted for, never chases a
     note that cannot exist yet, and cannot be armed by a stopped pull. Pinned
     identically in tests/qol-pulled-day-note-honesty. */
  assert(/if \(p\.todayNote === true \|\| p\.todayNote === "already-read"\) \{ niDrop\(p\.patientId, d, "read-in-pull"\); return; \}/.test(si),
    'the idle backfill would re-open a chart whose note was already read during the pull');
  assert(/if \(p\.todayNote === "not-yet" \|\| p\.todayNote === "future-day"\) return;/.test(si),
    'the idle backfill would chase a note that cannot exist yet');
  assert(/__mlsPullStopRequested === true/.test(si),
    'a STOPPED pull can still arm the deferred note-body reader');
  const skipIdx = si.indexOf('one.visitsSkipped = true');
  const win = si.slice(skipIdx - 300, skipIdx + 300);
  assert(!/parsedVisits|visitCount|persistedVisits/.test(win), 'the skip path must still never fabricate visit evidence');
}
