'use strict';
/* si-1.7.7 — outdated-extension hint on receipt-gate failures.
 * Live 2026-07-18 (owner's father, Mac): every pull ended in a bare
 * "not verified" with no way out. An old MLS Assist cannot produce the
 * request-bound receipts the fail-closed gates demand, so the machine loops
 * forever unless someone guesses the extension is stale. The pull now names
 * the installed vs published version and says to update THIS computer.
 * Fail-closed behavior is unchanged — the hint only explains it. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

assert(si.includes('var VERSION = "si-1.7.9"'), 'si-1.7.9 release marker missing');

/* the hint must trigger ONLY on receipt-shaped failures, never on e.g. signin */
const gates = si.match(/RECEIPT_GATE_REASONS = \{([^}]+)\}/);
assert(gates, 'receipt-gate reason set missing');
for (const reason of ['no-read', 'schedule-incomplete', 'schedule-request-unbound', 'provider-roster-incomplete', 'provider-roster-unbound', 'unverified-day']) {
  assert(gates[1].includes('"' + reason + '"'), 'receipt-gate set must include ' + reason);
}
assert(!gates[1].includes('signin'), 'a sign-in failure must never blame the extension');
assert(!gates[1].includes('wrong-day'), 'a wrong-day failure is not an extension-age symptom');

/* pong version captured, published version fetched, hint attached in fail() */
assert(si.includes('extPong.version = String(pong && (pong.version || pong.extVersion) || "").trim()'),
  'the answering extension version must come from THIS pull\'s pong');
assert(si.includes('fetch("extension-version.json?ts="'), 'the published version must come from the site manifest');
assert(si.includes('out.extUpdateHint = hint'), 'the failure result must carry the hint');
assert(si.includes('update MLS Assist on THIS computer'), 'the hint must say which computer to update');

/* version compare: strictly less, never claims outdated on garbage */
const verLessSrc = si.match(/function verLess\(a, b\) \{[\s\S]*?\n  \}/);
assert(verLessSrc, 'verLess not found');
const verLess = new Function('return ' + verLessSrc[0])();
assert.strictEqual(verLess('2.9.22', '2.9.41'), true, '2.9.22 must read as older than 2.9.41');
assert.strictEqual(verLess('2.9.41', '2.9.41'), false, 'equal versions are not outdated');
assert.strictEqual(verLess('2.10.0', '2.9.41'), false, 'numeric compare, not string compare');
assert.strictEqual(verLess('1.65', '2.9.41'), true, 'legacy 1.x reads as older');
assert.strictEqual(verLess('', '2.9.41'), false, 'missing version must never claim outdated');
assert.strictEqual(verLess('abc', '2.9.41'), false, 'garbage version must never claim outdated');

/* the day-strip verdict surfaces the hint instead of a bare dead end */
assert(connect.includes('if (r && r.extUpdateHint) msg += '), 'pullOutcome must append the update hint to the verdict');

/* ---- si-1.7.8: duplicate-extension detection (runtime) -------------------
 * Two installed MLS Assist copies both answer one ping; the probe must call
 * that out by count (and versions when they differ). One answer stays silent.
 * The probe body is exercised directly: extracted with its real listener
 * wiring against a message-event stub. */
assert(si.includes('armPongProbe(); /* count answers to THIS ping'), 'the pong probe must arm before the ping');
assert(si.includes('TWO copies of MLS Assist look installed'), 'the duplicate hint must name the situation');
assert(si.includes('keep exactly ONE MLS Assist'), 'the duplicate hint must say the fix');
assert(si.includes('[duplicateExtHint(), extUpdateHint()]'), 'receipt-gate failures must carry both hints when present');

{
  const vm = require('vm');
  const probeSrc = si.match(/var pongProbe = \{ count: 0, versions: \{\} \};[\s\S]*?function duplicateExtHint\(\) \{[\s\S]*?\n    \}/);
  assert(probeSrc, 'pong probe block not found');
  const listeners = [];
  const fired = [];
  const ctx = {
    console, Math, Date, JSON, Object, String, Number,
    onStatus(msg, kind) { fired.push({ msg: String(msg), kind }); },
    safe(fn, d) { try { return fn(); } catch (e) { return d; } },
    setTimeout(fn) { ctx.__flush = fn; return 1; },
    window: null
  };
  ctx.window = {
    addEventListener(type, fn) { listeners.push(fn); },
    removeEventListener() {}
  };
  vm.createContext(ctx);
  vm.runInContext(probeSrc[0] + '; this.__arm = armPongProbe; this.__hint = duplicateExtHint;', ctx);

  /* one answer -> silence */
  ctx.__arm();
  listeners[0]({ data: { source: 'mls-ext', type: 'mlsPong', version: '2.9.41' } });
  ctx.__flush();
  assert.strictEqual(ctx.__hint(), '', 'a single pong must not warn');
  assert.strictEqual(fired.length, 0, 'a single pong must not emit a status');

  /* two answers with different versions -> named warning */
  ctx.__arm();
  const l2 = listeners[listeners.length - 1];
  l2({ data: { source: 'mls-ext', type: 'mlsPong', version: '2.9.41' } });
  l2({ data: { source: 'mls-ext', type: 'mlsPong', version: '1.65' } });
  ctx.__flush();
  const hint = ctx.__hint();
  assert(/2 answers/.test(hint), 'the warning must state the answer count');
  assert(hint.includes('v2.9.41') && hint.includes('v1.65'), 'differing versions must both be named');
  assert(/chrome:\/\/extensions/.test(hint), 'the warning must point at chrome://extensions');
  assert.strictEqual(fired.length, 1, 'the duplicate warning must surface as a status line');
  assert.strictEqual(fired[0].kind, 'err', 'the duplicate warning must be an error-kind status');

  /* foreign messages never count */
  ctx.__arm();
  const l3 = listeners[listeners.length - 1];
  l3({ data: { source: 'mls-app', type: 'mlsPong' } });
  l3({ data: { source: 'mls-ext', type: 'mlsAppScheduleResult' } });
  ctx.__flush();
  assert.strictEqual(ctx.__hint(), '', 'non-pong traffic must never trigger the duplicate warning');
}

/* ---- ds-1.4.0: one-click PHI-free pull error report ---------------------- */
assert(connect.includes("version: 'ds-1.4.0'"), 'ds-1.4.0 release marker missing');
assert(connect.includes('id="mlsDsDiagBtn"'), 'the Copy error report button must exist in the day strip');
assert(connect.includes("$('mlsDsDiagBtn').onclick = dsCopyDiag"), 'the report button must be wired');
assert(connect.includes('dsSyncDiagBtn(!ok)'), 'a failed pull must reveal the report button');
const diagSrc = connect.match(/function dsDiagReport\(\) \{[\s\S]*?\n  \}/);
assert(diagSrc, 'dsDiagReport not found');
/* whitelist-only: receipts as booleans/counts/reasons; never patient payloads */
for (const banned of ['resolvedAppointments', 'res.patients', 'appts', 'historyTargets', 'proofs']) {
  assert(!diagSrc[0].includes(banned), 'the error report must never serialize ' + banned);
}
assert(diagSrc[0].includes('retryReasons: dsReasonHistogram(hr.retry)'), 'history retry entries must reduce to a reason histogram (no ids/names)');
assert(diagSrc[0].includes('navigator.userAgent'), 'the report must carry the user agent (Chrome version diagnosis)');
assert(connect.includes("document.execCommand('copy')"), 'old-Chrome copy fallback (execCommand) must exist');

console.log('PASS ext-update hint + duplicate detection: receipt-gate failures on an outdated MLS Assist name the installed vs published version; TWO answering copies of MLS Assist are called out with the chrome://extensions fix (one answer stays silent, foreign traffic ignored); sign-in and wrong-day failures never blame the extension; version compare is numeric and fail-safe');
