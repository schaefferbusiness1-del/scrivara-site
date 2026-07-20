'use strict';

/* b443: the today-path exact-scheduled gate refusal must persist for as long
 * as it is true. Live-caught 2026-07-20: an appointment row with no provider
 * opened cleanly, the one-shot lastWarn was wiped by computePhase the moment a
 * note existed (and by state probes), and record/generate then refused with no
 * visible reason. The cross-day path has a persistent row-derived badge since
 * b438; bindingNotice() is the today-path equivalent — recomputed every
 * computePhase, present while the binding is unprovable, gone when it becomes
 * ready, never overwriting a more specific active warning.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

// isolate the LIVE engine's computePhase + bindingNotice pair (the only
// computePhase followed by bindingNotice in the bundle)
const anchor = connect.indexOf('function bindingNotice()');
assert(anchor > 0, 'bindingNotice missing from the live engine');
assert(connect.indexOf('function bindingNotice()', anchor + 10) < 0, 'bindingNotice must exist exactly once');
const start = connect.lastIndexOf('function computePhase()', anchor);
const end = connect.indexOf('function fmtTimer()', anchor);
assert(start > 0 && end > anchor, 'computePhase/bindingNotice boundaries missing');
const slice = connect.slice(start, end);
assert((slice.match(/bindingNotice\(\)/g) || []).length >= 3, 'computePhase must invoke bindingNotice on both its note and idle exits');

function makeContext() {
  const state = { S: { appt: null, phase: 'idle', lastWarn: '', genClickedAt: 0, recStart: 0 }, bindReady: false, note: '' };
  const context = vm.createContext({
    get S() { return state.S; },
    isRecording: () => false,
    noteText: () => state.note,
    $: () => null,
    Date,
    exactScheduledBindingMatches: () => state.bindReady,
    scheduledAppointmentId: a => String(a && (a.appointmentId || a.appointment_id) || '').trim()
  });
  vm.runInContext(slice, context, { filename: 'live-engine:computePhase' });
  return { state, run: () => vm.runInContext('computePhase()', context) };
}

// 1. Provider-less row: the notice appears and PERSISTS across repeated passes
//    and across the note-written wipe path.
{
  const { state, run } = makeContext();
  state.S.appt = { id: '3884', name: 'Adam J Schaeffer', provider: '' };
  run();
  assert(/no provider/.test(state.S.lastWarn), 'provider-less row did not produce the persistent notice');
  state.note = 'A generated note easily longer than thirty characters of content.';
  run(); run(); run();
  assert(/no provider/.test(state.S.lastWarn), 'the notice was wiped once a note existed — the exact live defect');
}

// 2. The moment the binding becomes provable, the notice clears itself.
{
  const { state, run } = makeContext();
  state.S.appt = { id: '3884', name: 'Adam J Schaeffer', provider: 'Michael Schaeffer' };
  run();
  assert(state.S.lastWarn.length > 0, 'unbindable row with provider must still carry a notice');
  state.bindReady = true;
  state.note = 'A generated note easily longer than thirty characters of content.';
  run();
  assert.strictEqual(state.S.lastWarn, '', 'a ready binding must clear the notice');
}

// 3. A more specific active warning is never overwritten.
{
  const { state, run } = makeContext();
  state.S.appt = { id: '3884', name: 'Adam J Schaeffer', provider: '' };
  state.S.lastWarn = 'The note was not generated. Your full transcript is still safe below.';
  state.S.phase = 'stopped';
  run();
  assert(/not generated/.test(state.S.lastWarn), 'bindingNotice overwrote a more specific active warning');
}

// 4. Search-picked visits get the honest schedule-row explanation.
{
  const { state, run } = makeContext();
  state.S.appt = { _pt: true, _patientId: 'x', name: 'Adam J Schaeffer' };
  run();
  assert(/patient search/.test(state.S.lastWarn), 'search-picked visit did not explain the schedule-row requirement');
}

// 5. No appointment at all: silent.
{
  const { state, run } = makeContext();
  run();
  assert.strictEqual(state.S.lastWarn, '', 'bindingNotice invented a warning with no visit open');
}

console.log('PASS binding-notice persistence: gate refusals stay visible exactly while true, name the real blocker (provider/appointment id/search-picked), self-clear on a ready binding, and never mask specific warnings');
