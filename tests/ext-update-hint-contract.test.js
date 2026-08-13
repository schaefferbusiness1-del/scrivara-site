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

/* pin moved si-1.7.17 -> si-1.7.18 deliberately: mdx-1.1.0 captures the
   bodies/index refusal sub-cause evidence (failedIndexes histogram, enumDiag)
   and guards the pace learner against fast empty reads; the update-hint
   behavior this suite pins is unchanged. */
/* pin moved si-1.7.18 -> si-1.7.19 deliberately: mdx-2.0.0 collapses roster
   display echoes of the SAME clinician for the selected-provider name
   fallback (Mac field report 2026-08-06, b894) and discloses the basis. */
assert(si.includes('var VERSION = "si-1.7.23-default-census"'), 'si-1.7.23 default-census release marker missing');

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
  const probeSrc = si.match(/var pongProbe = \{ pings: 0, pongs: 0, versions: \{\} \};[\s\S]*?function duplicateExtHint\(\) \{[\s\S]*?\n    \}/);
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
  function feed(msgs) {
    const l = listeners[listeners.length - 1];
    msgs.forEach((m) => l({ data: m }));
  }
  const PING = { source: 'mls-app', type: 'mlsPing' };
  const PONG = (v) => ({ source: 'mls-ext', type: 'mlsPong', version: v });

  /* one healthy extension: each ping answered once -> silence */
  ctx.__arm();
  feed([PING, PONG('2.9.41')]);
  ctx.__flush();
  assert.strictEqual(ctx.__hint(), '', 'one answer per ping must not warn');

  /* live 2026-07-18 false positive: a post-reload probe STORM (many pings,
     one answer each) must stay silent — this fired "5 answers" on a healthy
     machine when the probe only counted pongs */
  ctx.__arm();
  feed([PING, PONG('2.9.41'), PING, PONG('2.9.41'), PING, PONG('2.9.41'), PING, PONG('2.9.41'), PING, PONG('2.9.41')]);
  ctx.__flush();
  assert.strictEqual(ctx.__hint(), '', 'a probe storm with one answer per ping must never read as duplicates');

  /* one boundary-straddling pong must not warn either */
  ctx.__arm();
  feed([PONG('2.9.41'), PING, PONG('2.9.41')]);
  ctx.__flush();
  assert.strictEqual(ctx.__hint(), '', 'a single stale boundary pong must not warn');

  /* two installed copies: every ping answered twice -> named warning */
  ctx.__arm();
  feed([PING, PONG('2.9.41'), PONG('1.65'), PING, PONG('2.9.41'), PONG('1.65')]);
  ctx.__flush();
  const hint = ctx.__hint();
  assert(/2 check-in\(s\) got 4 answers/.test(hint), 'the warning must state pings vs answers: ' + hint);
  assert(hint.includes('v2.9.41') && hint.includes('v1.65'), 'differing versions must both be named');
  assert(/chrome:\/\/extensions/.test(hint), 'the warning must point at chrome://extensions');
  assert(/TWO copies of MLS Assist/.test(hint), 'the warning must name the situation');
  assert.strictEqual(fired.length, 0, 'the probe timer must NEVER overwrite a status line (hints ride fail() only)');

  /* foreign messages never count */
  ctx.__arm();
  feed([{ source: 'mls-app', type: 'mlsPong' }, { source: 'mls-ext', type: 'mlsAppScheduleResult' }]);
  ctx.__flush();
  assert.strictEqual(ctx.__hint(), '', 'non-bridge traffic must never trigger the duplicate warning');
}

/* nav races between two copies also carry the dup hint */
assert(si.includes('out.reason === "nav-failed" || out.reason === "wrong-day"'), 'nav-failed/wrong-day must carry the duplicate hint when detected');

/* ---- ds-2.0.2: one-click PHI-free pull error report survives the move to
 * one selected-day Easy shell; date unification must not remove diagnostics. */
assert(connect.includes("version: 'ds-2.0.2'"), 'ds-2.0.2 release marker missing');
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

/* si-1.7.11 → si-1.7.14: first-goto week-strip lag gets ESCALATING settle-retries
   (live 2026-07-20: one 2.5s settle missed a slow dashboard→Day render; the next
   manual click succeeded — the first click must absorb that lag itself) */
assert(si.includes('function gotoDateSettled()'), 'nav settle-retry helper missing');
assert(si.includes('Athena is still switching days'), 'settle-retry must say what it is doing');
assert(si.includes('mlsAppGotoDateResult", "mlsAppGotoDate", 60000, { date: date, probe: false }'), 'the settle-retry must re-dispatch the same goto');
const settleWaits = si.match(/var settleWaits = \[([0-9, ]+)\];/);
assert(settleWaits, 'escalating settle waits missing');
const waits = settleWaits[1].split(',').map(s => Number(s.trim()));
assert(waits.length >= 3, 'first-click nav needs at least three settle rounds, got ' + waits.length);
assert(waits.every((w, i) => i === 0 || w > waits[i - 1]), 'settle waits must escalate: ' + settleWaits[1]);
assert(si.includes('return attempt(round + 1);') && si.includes('round >= settleWaits.length'), 'settle recursion must be bounded by the wait table');

/* si-1.7.15→16: the post-save verification read-back can trail the async
   save pipeline (measured live: the request-bound fresh stamp appeared ~20s
   after the gate's first read while the store converged correctly).
   ESCALATING bounded settle-rechecks close that window for the race-class
   refusals only. This can never false-pass: the verdict requires the stamp
   bound to THIS operation's requestId, which exists only if this exact save
   persisted. Non-race failures still throw immediately. */
assert(si.includes('function verifyStored()'), 'post-save verification helper missing');
const settleTable = si.match(/var verifySettleWaits = \[([0-9, ]+)\];/);
assert(settleTable, 'escalating verify settle waits missing');
const vWaits = settleTable[1].split(',').map(s => Number(s.trim()));
assert(vWaits.length >= 4 && vWaits[vWaits.length - 1] >= 20000,
  'the settle series must reach the measured ~20s pipeline lag: ' + settleTable[1]);
assert(vWaits.every((w, i) => i === 0 || w > vWaits[i - 1]), 'verify settle waits must escalate');
const settleBody = si.match(/function verifyWithSettle\(round\) \{[\s\S]*?verifyWithSettle\(round \+ 1\);[\s\S]*?\}/);
assert(settleBody, 'the bounded settle-recheck recursion is missing');
assert(/save-unproven\|freshness-unproven\|save-request-unproven\|persistence-unproven/.test(settleBody[0]),
  'the settle-recheck must cover exactly the read-back race class');
assert(/if \(!racy \|\| round >= verifySettleWaits\.length\) return Promise\.reject\(vErr\);/.test(settleBody[0]),
  'non-race failures must reject immediately and the recursion must be bounded');

console.log('PASS ext-update hint + duplicate detection: receipt-gate failures on an outdated MLS Assist name the installed vs published version; TWO answering copies of MLS Assist are called out with the chrome://extensions fix (one answer stays silent, foreign traffic ignored); sign-in and wrong-day failures never blame the extension; version compare is numeric and fail-safe');
