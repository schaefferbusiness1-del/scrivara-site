'use strict';

/* wfbindbar-1.0.0 — the visit-screen banner carries its own cure.
 *
 * Owner 2026-08-19, reading the live banner and calling it unacceptable:
 *
 *   "The visit opened, but MLS could not prove its exact Athena appointment
 *    binding. Re-pull this day before using Athena verification or send."
 *
 * The banner names a cure and then makes the doctor go perform it somewhere
 * else. This block puts that cure on the banner, reusing writeflow's
 * implementation (__mlsWriteFlow.bindCure.pullDay) so there is ONE navigate +
 * confirm-day + pull in the codebase, not two.
 *
 * This suite EXECUTES the shipped wfbindbar block out of 1p-mls-connect.js and
 * proves both halves:
 *   - the cure works: press -> the exact day is re-pulled -> the binding is
 *     re-checked through the UNCHANGED installScheduledVisitBinding +
 *     exactScheduledBindingMatches pair -> the warning clears;
 *   - it cannot bind anything by itself: if the re-pull does not produce an
 *     agreeing exact binding, the warning stays and says so.
 *
 * The gate is never weakened here. This block calls the same two binding
 * functions the rest of the visit screen calls and believes only their answer.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- the block ships, and the banner offers it ---- */
const START = connect.indexOf('/* ===== wfbindbar-1.0.0');
const END = connect.indexOf('/* ===== end wfbindbar-1.0.0');
{
  ok(START > 0 && END > START, 'the wfbindbar-1.0.0 block must ship in 1p-mls-connect.js');
  ok(/id="ez3BindNow"/.test(connect), 'the banner must render the cure control');
  ok(/on\('ez3BindNow', function \(btn\) \{ bindCureRun\(btn\); \}\)/.test(connect),
    'the cure control must be wired to the cure');
  ok(/re-pull this day\/i\.test\(S\.lastWarn\) && bindCureOffered\(\)/.test(connect),
    'the cure must appear only on a warning whose stated remedy IS a day re-pull');
  const block = connect.slice(START, END);
  /* it must not bind anything itself */
  ok(!/currentVisitAthenaBinding\s*=/.test(block), 'the banner cure must never assign a visit binding');
  ok(!/_athenaSetVisitBinding\s*\(/.test(block), 'the banner cure must never set a binding directly');
  ok(/installScheduledVisitBinding\(fresh\) && exactScheduledBindingMatches\(fresh\)/.test(block),
    'the cure must believe only the unchanged binding pair');
}

/* ---- EXECUTE the shipped block ---- */
const block = connect.slice(START, END);

function harness(opts) {
  opts = opts || {};
  const toasts = [];
  const renders = [];
  const timers = [];
  const timeouts = [];
  const pulls = [];
  const S = { appt: opts.appt === undefined ? { id: 'row-1', provider: 'Dr Synthetic', appt_date: '2026-08-14' } : opts.appt, lastWarn: 'x' };
  const window = {
    _calAppts: opts.calAppts || [],
    __mlsWriteFlow: opts.noApi ? null : {
      bindCure: {
        pullDay: (day, say) => {
          pulls.push({ day, say });
          return opts.pullPending ? new Promise(() => {}) : Promise.resolve(opts.pullResult || { ok: true });
        }
      }
    }
  };
  let bindOk = opts.bindOk === undefined ? false : opts.bindOk;
  const calls = { install: 0, exact: 0 };
  const factory = new Function(
    'window', 'safe', 'S', 'apptDay', 'exactScheduledBindingMatches', 'installScheduledVisitBinding',
    'toast', 'render', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    block + '\n; return { bindCureOffered: bindCureOffered, bindCureRun: bindCureRun, bindCureDay: bindCureDay, bindCureFreshRow: bindCureFreshRow, bindCureBound: bindCureBound };');
  const fns = factory(
    window,
    (fn, d) => { try { return fn(); } catch (e) { return d; } },
    S,
    a => String((a && (a.appt_date || a.day_local)) || ''),
    () => { calls.exact++; return bindOk; },
    () => { calls.install++; return bindOk; },
    (m, k) => toasts.push({ m: String(m), k: String(k || '') }),
    () => renders.push(1),
    (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    (fn, ms) => { const t = { fn, ms, cleared: false }; timeouts.push(t); return t; },
    t => { if (t) t.cleared = true; }
  );
  return { fns, S, toasts, renders, timers, timeouts, pulls, calls, setBound: v => { bindOk = v; }, window };
}

const tick = () => new Promise(r => setImmediate(r));

(async function run() {

  /* ---- 1. when the cure is offered, and when it is honestly not ---- */
  {
    ok(harness({}).fns.bindCureOffered() === true, 'an unbound scheduled row with a day and provider must be offered the cure');
    ok(harness({ bindOk: true }).fns.bindCureOffered() === false, 'a row that is already bound needs no cure');
    ok(harness({ appt: null }).fns.bindCureOffered() === false, 'no appointment, no cure');
    ok(harness({ appt: { id: 'r', _pt: true, provider: 'Dr X', appt_date: '2026-08-14' } }).fns.bindCureOffered() === false,
      'a patient-search visit has no schedule day to re-pull');
    ok(harness({ appt: { id: 'r', provider: '', appt_date: '2026-08-14' } }).fns.bindCureOffered() === false,
      'a row with no provider cannot be cured by a day pull');
    ok(harness({ appt: { id: 'r', provider: 'Dr X', appt_date: '' } }).fns.bindCureOffered() === false,
      'a row with no day cannot be cured by a day pull');
    ok(harness({ noApi: true }).fns.bindCureOffered() === false,
      'without writeflow\'s cure the banner must not offer one');
  }

  /* ---- 2. one press re-pulls the EXACT day and rebinds ---- */
  {
    const h = harness({ calAppts: [{ id: 'row-1', provider: 'Dr Synthetic', appt_date: '2026-08-14' }] });
    const btn = { disabled: false, textContent: 'Bind this visit — re-pull this day' };
    h.fns.bindCureRun(btn);
    ok(btn.disabled === true && /Re-pulling 2026-08-14/.test(btn.textContent), 'the control must go busy at itself');
    ok(h.pulls.length === 1 && h.pulls[0].day === '2026-08-14', 'the cure must re-pull the visit\'s exact day');
    await tick();
    const live = h.timers.filter(t => !t.cleared);
    ok(live.length === 1, 'a started pull must arm exactly one bounded poller');
    live[0].fn();
    ok(h.S.lastWarn === 'x', 'the warning must stay while the binding does not agree');
    ok(!live[0].cleared, 'the poller must keep waiting');

    h.setBound(true);
    live[0].fn();
    ok(live[0].cleared === true, 'the poller must disarm the moment the binding agrees');
    ok(h.S.lastWarn === '', 'a proven binding must clear the warning');
    ok(h.renders.length >= 1, 'the visit screen must repaint');
    ok(h.toasts.some(t => /bound to its exact Athena appointment/.test(t.m) && t.k === 'ok'),
      'the doctor must be told verification and send are available');
    ok(btn.disabled === false, 'the control must be released');
    ok(h.timeouts.length === 1 && h.timeouts[0].cleared === true,
      'a settled pull must clear its pending-pull timeout');
  }

  /* ---- 2b. a never-settling day pull must release the cure control ---- */
  {
    const h = harness({ pullPending: true });
    const btn = { disabled: false, textContent: 'Bind this visit — re-pull this day' };
    h.fns.bindCureRun(btn);
    await tick();
    ok(h.pulls.length === 1 && h.timeouts.length === 1 && h.timeouts[0].cleared === false,
      'a pending day pull must own one bounded timeout');
    h.fns.bindCureRun(btn);
    ok(h.pulls.length === 1, 'a second press must not start another pending day pull');
    h.timeouts[0].fn();
    ok(btn.disabled === false && btn.textContent === 'Bind this visit — re-pull this day',
      'a stalled day pull must restore the cure control');
    ok(h.toasts.some(t => /did not return in time/i.test(t.m) && t.k === 'err'),
      'a stalled day pull must say that nothing changed');
  }

  /* ---- 3. the row object is RE-RESOLVED, never re-checked stale ---- */
  {
    const stale = { id: 'row-1', provider: 'Dr Synthetic', appt_date: '2026-08-14' };
    const fresh = { id: 'row-1', provider: 'Dr Synthetic', appt_date: '2026-08-14', athena_appointment_id: '70001234' };
    const h = harness({ appt: stale, calAppts: [fresh] });
    ok(h.fns.bindCureFreshRow(stale) === fresh,
      'the cure must re-resolve the schedule row a pull replaced, not re-check the stale reference');
    h.setBound(true);
    ok(h.fns.bindCureBound(stale) === true, 'the binding must be checked against the FRESH row');
    ok(h.calls.install >= 1 && h.calls.exact >= 1, 'both unchanged binding functions must be consulted');
  }

  /* ---- 4. a refused re-pull: honest, and nothing is claimed ---- */
  {
    const h = harness({ pullResult: { ok: false, message: 'athenaOne could not be sent to 2026-08-14. Nothing was changed.' } });
    const btn = { disabled: false, textContent: 'Bind this visit — re-pull this day' };
    h.fns.bindCureRun(btn);
    await tick();
    ok(h.timers.length === 0, 'a refused re-pull must arm no poller');
    ok(h.toasts.some(t => /could not be sent/.test(t.m) && t.k === 'err'), 'the refusal must be said in words');
    ok(h.S.lastWarn === 'x', 'the warning must stay after a refused re-pull');
    ok(btn.disabled === false && btn.textContent === 'Bind this visit — re-pull this day', 'the control must be released');
  }

  /* ---- 5. the pull lands but the binding never agrees: fail closed ---- */
  {
    const h = harness({ calAppts: [{ id: 'row-1', provider: 'Dr Synthetic', appt_date: '2026-08-14' }] });
    const btn = { disabled: false, textContent: 'Bind this visit — re-pull this day' };
    h.fns.bindCureRun(btn);
    await tick();
    const poller = h.timers.filter(t => !t.cleared)[0];
    for (let i = 0; i < 36; i++) poller.fn();
    ok(poller.cleared === true, 'the poller must be bounded');
    ok(h.S.lastWarn === 'x', 'an unbindable visit keeps its warning');
    ok(h.toasts.some(t => /still cannot prove/.test(t.m) && t.k === 'err'),
      'the failure must say plainly that the binding is still unproven');
    ok(h.toasts.some(t => /recording, the note and history are unaffected/i.test(t.m)),
      'it must say what still works — Athena send is gated, the visit is not');
    ok(btn.disabled === false, 'the control must be released after the bounded wait');
  }

  /* ---- 6. two presses cannot run two cures ---- */
  {
    const h = harness({ calAppts: [{ id: 'row-1', provider: 'Dr Synthetic', appt_date: '2026-08-14' }] });
    h.fns.bindCureRun(null);
    await tick();
    h.fns.bindCureRun(null);
    await tick();
    ok(h.pulls.length === 1, 'a second press while a cure is polling must not start a second pull');
  }

  console.log('PASS 1p visit-banner bind cure: ' + checks + ' checks — the banner the owner called unacceptable now carries the same one-press cure as the confirm sheet, re-pulls the visit\'s exact day, re-resolves the schedule row the pull replaced, bounds a stalled pull and clears only on the unchanged binding pair\'s own answer; a refused pull, an unbindable visit and a double press each keep the warning and change nothing');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
