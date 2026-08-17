'use strict';

/* apptclock-1.0.0 — ONE TIME CONVENTION, PROVEN BY EXECUTION.
 *
 * THE DEFECT (readiness §23/§27, measured on one 360px screen, ONE appointment):
 * the Visit hero rendered "4:00 AM" and the day-chip rail rendered "8:00 AM".
 * Three conventions were fighting:
 *   1. feat_mls_assistant_exact.js:151 — `new Date(s + "Z")` DECLARES an
 *      offset-less ISO to be UTC, then renders it in Eastern (8 AM -> 4 AM),
 *      and installs itself over the app's four TZ hooks;
 *   2. 1pScribeFlow.html — `new Date(s)`, which ES2015+ reads as BROWSER-local,
 *      so the answer moved with the laptop;
 *   3. 1p-mls-connect.js startIso() — built the instant browser-locally and
 *      then PERSISTED it with .toISOString().
 *
 * This suite runs the shipped resolver, the shipped hero path, and the shared
 * module's own installer, in THREE process timezones. It asserts:
 *   - the hero string and the rail string are the same string;
 *   - that string does not change when the laptop's timezone changes;
 *   - the offset-less string is never turned into UTC by appending "Z" (proven
 *     by a positive control that reproduces the old 4:00 AM answer, so a
 *     passing run cannot be a vacuous one);
 *   - the shared module can no longer re-point any of the four hooks;
 *   - the WRITE side produces the same instant from every laptop.
 *
 * Timezones are set per-process, so the suite re-spawns itself as a probe.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const PRACTICE_TZ = 'America/New_York';
const LAPTOP_TZS = ['America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];

function slice(src, start, end, label) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `could not find start of ${label}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `could not find end of ${label}`);
  return src.slice(a, b);
}

/* ============================================================ the probe body */
function isoOf(d) {
  if (!d || typeof d.getTime !== 'function' || isNaN(d.getTime())) return 'INVALID';
  return d.toISOString();
}

function probe() {
  const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
  const asst = fs.readFileSync(path.join(root, 'feat_mls_assistant_exact.js'), 'utf8');

  const shellSrc = [
    slice(shell, 'function _acctTz(){', '\n', '_acctTz'),
    slice(shell, 'var _mlsTzFmtCache={};', '/* One shared account-clock truth', '_mlsTzFmt'),
    slice(shell, '/* ===== apptclock-1.0.0', '/* ===== end apptclock-1.0.0 ===== */', 'apptclock block'),
    slice(shell, 'function _apptDisplayTime(a){', 'function _apptScheduleId(a){', '_apptDisplayTime')
  ].join('\n');

  const ctx = {
    console,
    localStorage: { getItem: () => null, setItem: () => {} },
    uns: (s) => 'sf_u::probe::' + s,
    Intl, Date, Math, Number, String, Boolean, Object, Array, JSON, isFinite, parseInt, parseFloat, RegExp
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(shellSrc, ctx);

  /* the appointment: an 8 AM clinic slot as athenaOne hands it over — an
     offset-less wall clock, the shape that started the whole split. */
  const NAIVE = '2026-08-17T08:00:00';
  const ZONED = '2026-08-17T12:00:00Z';           /* the SAME instant, offset carried */
  const appt = { name: 'Ada Sample', start_at: NAIVE, start_local: '08:00', time_display: '8:00 AM' };

  const out = {
    tz: process.env.TZ || '',
    /* HERO: _renderTodayPatients -> _apptDisplayTime -> _fmtApptTime */
    hero: ctx._apptDisplayTime(appt),
    /* RAIL / picker / calendar feed / day-progress: all read the global hook */
    rail: ctx.window._fmtApptTime(NAIVE),
    railFromLocal: ctx.window._fmtApptTime(appt.start_local),
    railFromDisplay: ctx.window._fmtApptTime(appt.time_display),
    zoned: ctx.window._fmtApptTime(ZONED),
    mins: ctx.window._apptMinsTz(NAIVE),
    hhmm: ctx.window._apptHHMMTz(NAIVE),
    dayKey: ctx.window._calDateOf({ start_at: NAIVE }),
    meridian: ctx.window._fmtApptTime('4:00 PM'),
    meridianHhmm: ctx.window._apptHHMMTz('4:00 PM'),
    raw: ctx.window._fmtApptTime('TBD'),
    /* the WRITE side: 1p-mls-connect startIso() routes through this */
    written: ctx.window.__mlsApptClock.wallClockIso('2026-08-17', 8, 0),
    writtenWinter: ctx.window.__mlsApptClock.wallClockIso('2026-12-17', 8, 0),
    /* DST edges must not throw, must not return NaN, and must land on the same
       INSTANT from every laptop (compared as ISO, never as a local toString) */
    dstSpring: isoOf(ctx.window.__mlsApptClock.instant('2026-03-08T02:30:00')),
    dstFall: isoOf(ctx.window.__mlsApptClock.instant('2026-11-01T01:30:00'))
  };

  /* POSITIVE CONTROL — run the SHARED module's own convention on the same
     string. If this does not reproduce the old wrong answer, the instrument is
     broken and a green result means nothing. */
  {
    const asstSrc = slice(asst, 'var EST_TZ = "America/New_York";', 'function estDateKey(iso)', 'assistant clock')
      + '\nfunction pad2(n){return (n<10?"0":"")+n;}';
    const c2 = { Intl, Date, Math, Number, String, Object, Array, isFinite, parseInt };
    c2.window = c2; c2.globalThis = c2;
    vm.createContext(c2);
    vm.runInContext(asstSrc + '\n__old = fmtTime("' + NAIVE + '");', c2);
    out.oldConvention = c2.__old;
  }

  /* THE CLAIM — the shared module's installer must not be able to take any of
     the four hooks back. Run its real bytes, strict, exactly as it ships. */
  {
    const asstClock = slice(asst, 'var EST_TZ = "America/New_York";', 'function estDateKey(iso)', 'assistant clock');
    const asstKey = slice(asst, 'function estDateKey(iso)', 'function nowMins()', 'estDateKey');
    const asstInstall = slice(asst, 'var _origHooks = {}, _hooksInstalled = false;', 'installEstHooks();', 'installEstHooks');
    const before = {
      fmt: ctx.window._fmtApptTime, mins: ctx.window._apptMinsTz,
      hhmm: ctx.window._apptHHMMTz, date: ctx.window._calDateOf
    };
    vm.runInContext(
      '(function(){"use strict";\nfunction pad2(n){return (n<10?"0":"")+n;}\n'
      + asstClock + '\n' + asstKey + '\n' + asstInstall
      + '\ntry{ installEstHooks(); }catch(e){}\n'
      + 'window.__probeHooksInstalled = _hooksInstalled;\n})();', ctx);
    out.moduleInstalled = ctx.window.__probeHooksInstalled === true;
    out.hookStillOurs = {
      fmt: ctx.window._fmtApptTime === before.fmt,
      mins: ctx.window._apptMinsTz === before.mins,
      hhmm: ctx.window._apptHHMMTz === before.hhmm,
      date: ctx.window._calDateOf === before.date
    };
    out.heroAfterModule = ctx._apptDisplayTime(appt);
    out.railAfterModule = ctx.window._fmtApptTime(NAIVE);
  }
  return out;
}

if (process.argv[2] === '--probe') {
  process.stdout.write(JSON.stringify(probe()));
  process.exit(0);
}

/* ============================================================ the assertions */
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* -- the block is present, once, and identical in both twins --------------- */
{
  const spans = SHELLS.map((name) => {
    const src = fs.readFileSync(path.join(root, name), 'utf8');
    eq(src.split('/* ===== apptclock-1.0.0').length - 1, 1, `${name}: apptclock-1.0.0 must open exactly once`);
    eq(src.split('/* ===== end apptclock-1.0.0 ===== */').length - 1, 1, `${name}: apptclock-1.0.0 must close exactly once`);
    return slice(src, '/* ===== apptclock-1.0.0', '/* ===== end apptclock-1.0.0 ===== */', `${name} block`);
  });
  eq(spans[0], spans[1], 'the twins carry different apptclock-1.0.0 blocks');

  /* The literal defect, banned by source scan as well as by behaviour. Comments
     are stripped first: the block's own header QUOTES `new Date(s + "Z")` as
     the thing it exists to stop, and a scanner that cannot tell the warning
     from the crime is the instrument lying first. */
  const code = spans[0].replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const bad of ['+ "Z"', "+ 'Z'", '+"Z"', "+'Z'"]) {
    ok(code.indexOf(bad) < 0,
      `apptclock-1.0.0 appends ${bad} to a string — that is the exact move that turned an 8 AM appointment into 4 AM`);
  }
  /* and the scanner itself is not vacuous */
  ok(spans[0].indexOf('+ "Z"') >= 0,
    'the block header no longer quotes the defect it exists to prevent — if the header text changed, re-check that this scanner still has something to distinguish');
  /* the old browser-local parse must be gone from the two call sites too */
  for (const name of SHELLS) {
    const src = fs.readFileSync(path.join(root, name), 'utf8');
    ok(src.indexOf('if(a.start_at){ var d=new Date(a.start_at); if(!isNaN(d.getTime())){ var z=_fmtApptTime') < 0,
      `${name}: _apptDisplayTime still validates start_at with a browser-local new Date()`);
    ok(src.indexOf("try{ if(a.start_at && typeof _acctDateKeyOf==='function'){ var d=new Date(a.start_at);") < 0,
      `${name}: _apptScheduleDate still derives the day key with a browser-local new Date()`);
  }
}

/* -- the write side routes through the resolver ---------------------------- */
{
  const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
  const startIso = slice(connect, 'function startIso(iso, t){', '/* ---- create a linked MLS calendar entry', 'startIso');
  const startIsoCode = startIso.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(startIsoCode.indexOf('wallClockIso') > 0, 'startIso no longer routes through the one resolver');
  ok(!/new Date\(iso\s*\+\s*'T'/.test(startIsoCode),
    'startIso still builds the instant from an offset-less string in the BROWSER timezone and persists it with toISOString()');
  ok(/new Date\(iso\s*\+\s*'T'/.test(startIso),
    'the startIso comment no longer records the convention it replaced — keep the defect named where the next reader will look');
}

/* -- run the real thing in three laptop timezones -------------------------- */
const runs = LAPTOP_TZS.map((tz) => {
  const raw = execFileSync(process.execPath, [__filename, '--probe'], {
    env: Object.assign({}, process.env, { TZ: tz }),
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
  });
  return JSON.parse(raw);
});

/* the positive control fires: the OLD convention really did say 4:00 AM */
eq(runs[0].oldConvention, '4:00 AM',
  `the shared module's convention no longer reproduces the measured defect (got ${runs[0].oldConvention}) — this suite cannot prove anything until it does`);

for (let i = 0; i < runs.length; i++) {
  const r = runs[i], tz = LAPTOP_TZS[i];

  /* THE HEADLINE: hero and rail are the same string. */
  eq(r.hero, r.rail, `[laptop ${tz}] the hero and the rail disagree about the same appointment: hero=${r.hero} rail=${r.rail}`);
  eq(r.hero, '8:00 AM', `[laptop ${tz}] an 8 AM practice appointment rendered as ${r.hero}`);

  /* every other spelling of the same appointment agrees too */
  eq(r.railFromLocal, '8:00 AM', `[laptop ${tz}] start_local rendered as ${r.railFromLocal}`);
  eq(r.railFromDisplay, '8:00 AM', `[laptop ${tz}] time_display rendered as ${r.railFromDisplay}`);
  eq(r.zoned, '8:00 AM', `[laptop ${tz}] the SAME instant written with an explicit Z rendered as ${r.zoned}`);
  eq(r.mins, 480, `[laptop ${tz}] minutes-since-midnight came back ${r.mins}, not 480`);
  eq(r.hhmm, '08:00', `[laptop ${tz}] the 24-hour form came back ${r.hhmm}`);
  eq(r.dayKey, '2026-08-17', `[laptop ${tz}] the day key came back ${r.dayKey}`);

  /* b242 must survive: an explicit meridian is authoritative */
  eq(r.meridian, '4:00 PM', `[laptop ${tz}] "4:00 PM" re-rendered as ${r.meridian}`);
  eq(r.meridianHhmm, '16:00', `[laptop ${tz}] "4:00 PM" became ${r.meridianHhmm} in 24-hour form`);
  /* and an unparseable cell keeps its own words rather than going blank */
  eq(r.raw, 'TBD', `[laptop ${tz}] an unparseable schedule cell rendered as ${JSON.stringify(r.raw)}`);

  /* the shared module cannot take the hooks back */
  eq(r.moduleInstalled, false, `[laptop ${tz}] the shared assistant module installed its own TZ hooks over the resolver`);
  for (const k of ['fmt', 'mins', 'hhmm', 'date']) {
    eq(r.hookStillOurs[k], true, `[laptop ${tz}] the shared module replaced the ${k} hook`);
  }
  eq(r.heroAfterModule, '8:00 AM', `[laptop ${tz}] the hero moved to ${r.heroAfterModule} after the shared module loaded`);
  eq(r.railAfterModule, '8:00 AM', `[laptop ${tz}] the rail moved to ${r.railAfterModule} after the shared module loaded`);

  /* the write side: one instant, whatever laptop created it */
  eq(r.written, '2026-08-17T12:00:00.000Z', `[laptop ${tz}] an 8 AM booking was persisted as ${r.written}`);
  eq(r.writtenWinter, '2026-12-17T13:00:00.000Z', `[laptop ${tz}] an 8 AM winter booking was persisted as ${r.writtenWinter} (EST is UTC-5)`);

  /* DST edges resolve to a real instant rather than throwing or NaN. 02:30 on
     spring-forward morning does not exist in New York; the resolver settles it
     onto 01:30 EST rather than inventing an hour, and the fall-back overlap
     takes the first (EDT) occurrence. Both are decisions, not accidents. */
  eq(r.dstSpring, '2026-03-08T06:30:00.000Z', `[laptop ${tz}] the spring-forward gap produced ${r.dstSpring}`);
  eq(r.dstFall, '2026-11-01T05:30:00.000Z', `[laptop ${tz}] the fall-back overlap produced ${r.dstFall}`);
}

/* -- and the answer is the SAME on every laptop ---------------------------- */
for (const field of ['hero', 'rail', 'zoned', 'mins', 'hhmm', 'dayKey', 'written', 'writtenWinter', 'dstSpring', 'dstFall']) {
  const values = runs.map((r) => String(r[field]));
  eq(new Set(values).size, 1,
    `the laptop's own timezone changed "${field}": ${LAPTOP_TZS.map((t, i) => t + '=' + values[i]).join(', ')} — the practice clock (${PRACTICE_TZ}) is the only one that may decide`);
}

console.log(`1p-appointment-clock-one-convention: ${checks} checks passed across ${LAPTOP_TZS.length} laptop timezones`);
