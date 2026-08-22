'use strict';

/*
 * A SIGNED-OUT athenaOne still serves the day's schedule pull, and nothing
 * marked the rows stale.
 *
 * Owner report, 2026-07-25: "logged out of Athena, history definitely can't
 * pull -- but I HAVE SEEN the day's patients come through." He was right, and
 * his own repo had already recorded it. From
 * tests/live-e2e-artifacts/2026-07-22-acceptance.md:
 *
 *   "Schedule phase fine (18 rows now -- an 18th appointment was added
 *    mid-clinic; 17 updated post-click). ALL 17 history reads refused...
 *    Screenshot proof: the Athena tab was sitting on identity.athenahealth.com
 *    sign-in."
 *
 * THE MECHANISM, and why every existing guard missed it:
 *
 *  1. The schedule read is a PURE DOM SCRAPE of an already-painted grid. There
 *     is not one fetch/XHR to athenahealth anywhere in background.js. A grid
 *     already on screen needs no session to read.
 *  2. The session probe (mlsAthSessionProbeFn) only recognises a PAINTED
 *     sign-out -- a visible timeout heading or a visible login form. background
 *     .js says so itself: a globalframeset URL is UNCHANGED when athena renders
 *     its timeout page in a child frame. A session dead server-side but not yet
 *     repainted reads alive:true, and the picker hands the tab over.
 *  3. Nothing forces the repaint, because the scrape performs no navigation
 *     when a grid is already visible.
 *  4. The date guard is vacuous for a TODAY pull: goto-date verifies by
 *     re-reading the painted `.calendar-nav` week strip and comparing against
 *     `new Date()` -- the BROWSER's clock. A stale painted strip with "Today"
 *     still selected passes without athena serving anything.
 *
 * So rows hours old shipped as ok:true / scheduleVerified:true / complete:true,
 * and a cancelled or rescheduled appointment silently survived as a real
 * patient. The one honest message in the file,
 * `{ok:false, skipped:'athena-signed-out'}`, has zero callers on this path.
 *
 * WHAT sfp-1.0.0 DOES, and the line it deliberately does not cross:
 *
 *   It does not try to detect sign-out. It measures STALENESS, of which a dead
 *   session is one case -- and staleness is the safety property that actually
 *   matters. A grid the doctor left open for four hours is four hours old
 *   whether or not the session is alive, and saying so is correct, not a false
 *   positive.
 *
 *   It NEVER refuses and NEVER touches `complete`. This is load-bearing: the
 *   pull path works today and a staleness signal that can fail it would be a
 *   regression traded for a disclosure. `complete` stays a completeness claim;
 *   freshness is reported beside it.
 *
 * The arms below pin (a) the evidence the extension gathers, (b) that it is
 * evidence and not a gate, and (c) the real page-side rendering, lifted out of
 * the shipped file rather than modelled.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'latin1');
const si = fs.readFileSync(path.join(ROOT, 'feat_mls_schedimport_exact.js'), 'utf8');

/* =============================================== 1. the evidence is gathered */

assert(/self\.__mlsAthLive = self\.__mlsAthLive \|\| \{\}/.test(bg),
  'the live-session proof ledger must exist: without it the only session signal is the painted probe, which is blind to a server-side expiry');

assert(/function mlsAthNoteLiveSession\(tabId, via\)/.test(bg) && /function mlsAthLiveProof\(tabId\)/.test(bg),
  'both halves of the ledger must exist -- one records a served response, the other reports how long ago');

/* A COMMITTED navigation is the only event in this extension that a dead athena
   session cannot produce. Everything else it observes is a property of an
   already-loaded document. */
/* Matched at the REGISTRATION, not at the name. The first version of this arm
   tested for `chrome.webNavigation.onCommitted.addListener` -- which also
   appears in the feature-detection guard one line above, so deleting the actual
   listener still passed. Same circularity as the b669 gate that passed on its
   own regression: a check whose haystack contains the thing that removed it. */
assert(/chrome\.webNavigation\.onCommitted\.addListener\(function \(d\) \{/.test(bg),
  'the ledger must be fed by a REGISTERED webNavigation.onCommitted listener -- a commit was SERVED by athena, which is what makes it proof; a feature-detection mention is not a registration');
assert(/hostEquals: 'athenanet\.athenahealth\.com'/.test(bg),
  'the commit listener must be filtered to athena\'s product host: identity.athenahealth.com is where a DEAD session redirects, and counting that as proof of life inverts the whole receipt');

/* The two signals that must NOT be mistaken for proof of life. If either ever
   starts writing the ledger, the whole receipt becomes decorative. */
const ledgerWriters = (bg.match(/mlsAthNoteLiveSession\(/g) || []).length;
assert.strictEqual(ledgerWriters, 2,
  'exactly two mentions expected (the declaration and the single onCommitted call site). A third writer is almost certainly a content-script hello or an mlsAthPing result -- neither involves athena\'s server, and either would forge the proof this receipt exists to provide');

assert(!/mlsAthNoteLiveSession\([^)]*\)[\s\S]{0,200}?mlsAthenaHello/.test(bg),
  'a content-script hello must never write the ledger: it fires on focus, pageshow and visibilitychange of an ALREADY-LOADED document, with no server involved');

/* The redirect target is a different host, so it is excluded by the host test.
   The in-frame login/timeout URLs are excluded explicitly, because those ARE on
   athenanet and would otherwise forge a proof out of the sign-out itself. */
assert(/login\|logout\|signin\|sso\|timeout/.test(bg),
  'a commit to athena\'s own login/timeout URL must not count as proof of life -- that commit IS the sign-out');

/* ======================================== 2. the grid declares its own age */

assert(/performance\.timeOrigin/.test(bg) && /getEntriesByType\('resource'\)/.test(bg),
  'the schedule surface probe must report how old the painted document is and when the frame last heard from the server');

/* Chrome stops recording resource entries once the buffer fills. Reported
   alone, lastNetMs would then read as "no server contact for hours" on a busy
   frame that is perfectly fresh -- a confident false stale. */
assert(/netBufferFull/.test(bg),
  'a full resource-timing buffer must be reported: without it lastNetMs is a floor on freshness being read as a measurement');
assert(/__netUsable = \(__lastNetMs != null && !__netBufferFull\)/.test(bg),
  'lastNetMs must be discarded when the buffer is full, rather than trusted');

/* ================================= 3. it is EVIDENCE, not a gate (the rule) */

/* The `complete` computation is lifted verbatim and asserted to be untouched.
   This is the arm that protects the working pull path: a staleness signal that
   can fail a pull is a regression traded for a disclosure. */
/* Bound to the STATEMENT, not to the gap before `__receipt`: the staleness
   block now sits in that gap, so a gap-based slice would contain the very words
   this arm forbids and the assertion would fire on correct code. (It did, on
   the first run -- measure the instrument.) */
const completeAt = bg.indexOf('        var __complete = ');
assert(completeAt > 0, '__complete computation could not be found');
const completeLine = bg.slice(completeAt, bg.indexOf('\n', completeAt));
assert(/__coverageComplete/.test(completeLine) && completeLine.length < 400,
  '__complete computation could not be bounded to a single statement');
assert(!/stale|Stale|__live|sessionProof|dataAge/.test(completeLine),
  'the freshness verdict must NOT feed `complete`. A stale read is still a COMPLETE read; conflating them fails pulls that work today, which is exactly the trade this fix refuses to make');

/* And it must actually reach the page, on both terminal responses. A signal
   the app never receives is the defect this repo keeps shipping: 3.0.19's
   index-phase guard read correctly, tested green, and protected nothing. */
const okResp = bg.slice(bg.indexOf('        __schedRespond({ ok: true, scheduleVerified: true'));
assert(/sessionProof: __sessionProof/.test(okResp.slice(0, 600)),
  'the SUCCESS response must carry sessionProof -- it is the response that ships stale rows as a finished pull');
const incompleteResp = bg.slice(bg.indexOf("          return __schedRespond({ ok: false, reason: 'schedule-incomplete'"));
assert(/sessionProof: __sessionProof/.test(incompleteResp.slice(0, 600)),
  'the schedule-incomplete response must carry sessionProof too: it returns rows as retry diagnostics, and a retry against a dead session will not improve');

/* =========================== 4. the real page-side rendering, lifted not modelled */

const fStart = si.indexOf('  function freshnessNotice(resp) {');
const fEnd = si.indexOf('  function scopeProviderRows(');
assert(fStart > 0 && fEnd > fStart, 'the freshness helpers could not be bounded in feat_mls_schedimport_exact.js');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  '(function(){' + si.slice(fStart, fEnd) + '\nthis.freshnessNotice = freshnessNotice;\nthis.freshnessReceipt = freshnessReceipt;\n}).call(this)',
  sandbox
);
const { freshnessNotice, freshnessReceipt } = sandbox;

const resp = (sp) => ({ ok: true, receipt: { complete: true, sessionProof: sp }, sessionProof: sp });

/* --- a live session, proven by a served navigation: say nothing at all. --- */
const fresh = freshnessNotice(resp({ staleRisk: 'fresh', liveSessionProven: true, proofVia: 'athena-frame-load', proofAgeMs: 4000, dataAgeMs: 4000 }));
assert.strictEqual(fresh, '',
  'a proven-live session must produce NO extra text; a warning on every healthy pull is noise, and noise is how a real warning gets ignored');

/* --- the owner's case: grid painted hours ago, nothing served since. --- */
const stale = freshnessNotice(resp({ staleRisk: 'stale', liveSessionProven: false, proofVia: '', proofAgeMs: null, dataAgeMs: 4 * 3600 * 1000 }));
assert(/4 hours ago/.test(stale), 'the stale notice must state HOW OLD, in the doctor\'s units: "stale" alone is not actionable');
assert(/cancelled/.test(stale), 'the notice must name the clinical consequence -- a cancelled or moved appointment surviving as a real patient is the harm, not the staleness itself');
assert(!/signed out|logged out/i.test(stale),
  'the notice must NOT claim the doctor is signed out. It is not known: what was measured is that nothing proved the session served anything. A wrong instruction is worse than an honest "this may be old"');

/* Minutes, not hours, for a recent-but-unproven grid. */
const staleMin = freshnessNotice(resp({ staleRisk: 'stale', liveSessionProven: false, dataAgeMs: 22 * 60 * 1000 }));
assert(/22 minutes ago/.test(staleMin), 'sub-two-hour ages must read in minutes');

/* --- age unavailable: still say something, and do not invent a number. --- */
const unproven = freshnessNotice(resp({ staleRisk: 'unproven', liveSessionProven: false, dataAgeMs: null }));
assert(unproven.length > 0, 'an unmeasurable grid age must still be disclosed -- "could not tell" is a finding');
assert(!/NaN|null|undefined/.test(unproven), 'the unproven notice must not leak a missing number into the doctor\'s status line');

/* --- an OLDER extension sends no sessionProof. Absent must never read fresh. --- */
assert.strictEqual(freshnessNotice({ ok: true, receipt: { complete: true } }), '',
  'an extension predating sfp-1.0.0 must not produce a warning it has no evidence for');
const absent = freshnessReceipt({ ok: true, receipt: { complete: true } });
assert.strictEqual(absent.stated, false,
  'but the RECEIPT must record that freshness was never stated. Silence in the status line plus a clean receipt would upgrade "unknown" into "fresh", which is the original defect wearing a new hat');
assert.strictEqual(absent.staleRisk, 'not-reported',
  'the absent case must be distinguishable from a measured-fresh case in the ledger');
assert.notStrictEqual(absent.staleRisk, 'fresh', 'absent is not fresh');

/* --- the receipt carries the numbers, not just the verdict. --- */
const rec = freshnessReceipt(resp({ staleRisk: 'stale', liveSessionProven: false, proofVia: '', proofAgeMs: null, dataAgeMs: 900001 }));
assert.strictEqual(rec.stated, true);
assert.strictEqual(rec.staleRisk, 'stale');
assert.strictEqual(rec.dataAgeMs, 900001);
assert.strictEqual(rec.liveSessionProven, false);

/* --- and it is stamped onto the calendar receipt, not just spoken once. --- */
assert(/scheduleFreshness: freshnessReceipt\(r\)/.test(si),
  'the freshness verdict must be recorded on the calendar receipt: a status line is gone the moment the next one replaces it, and the import ledger is what anyone reviewing a bad row will read');
assert(!/complete: preSnapshotComplete && [\s\S]{0,80}stale/.test(si),
  'freshness must not be folded into the page-side `complete` either');

/* --- the terminal verdict is where it must appear. --- */
assert(/Verified complete: schedule[\s\S]{0,120}freshnessNotice\(r\)/.test(si),
  '"Verified complete" is the sentence the doctor acts on; if the notice is missing there it is missing where it matters');
assert(/Schedule-only complete:[^\r\n]*freshnessNotice\(r\)/.test(si),
  'the schedule-only verdict needs it too -- that is the ON=off path, which is the one the owner runs by default');
assert(/no appointments\." \+ freshnessNotice\(r\)/.test(si),
  'an EMPTY day read off a stale grid is the worst case of all: it is a positive clinical claim that nobody is coming');

/* ===================== 5. the signed-out session is NAMED (sfp-1.0.1) ====== */

/* `no-athena-tab` is what the picker returns when every athenaOne tab fails its
   session probe -- that is a signed-out athenaOne. It sits in SWEEPABLE_REASON,
   so a dead session triggers up to three full automatic re-sweeps that re-fail
   every patient, and the clinician is finally told "deferred after timeout": a
   timing story for a sign-in problem. Before this, no message in the whole
   orchestrator said athenaOne was signed out -- "signin" and "signin-expired"
   are the MLS BACKEND session (/api/me), a different thing entirely. */
assert(/no-athena-tab/.test(si.slice(si.indexOf('var __mismatch = 0'), si.indexOf('res.multiTabSuspected'))),
  'a `no-athena-tab` refusal must be counted alongside the other history failure classes -- it is the signature of a signed-out athenaOne and today it is silently swallowed by the retry sweep');
assert(/res\.athenaSignedOutSuspected = __noTab >= 2/.test(si),
  'the signed-out verdict must be recorded on the result, at a threshold of 2: one refusal can be a transient tab race, two in a row is the session');
const signedOutMsg = si.slice(si.indexOf('res.athenaSignedOutSuspected ? "'), si.indexOf('res.multiTabSuspected ? "'));
assert(/signed out or timed out/.test(signedOutMsg),
  'the message must name the actual cause; "deferred after timeout" sends the doctor to look at speed when the problem is authentication');
assert(/Sign in to athenaOne/.test(signedOutMsg),
  'and it must say what to DO -- this repo has a documented defect class where a failure message names no destination at all');
assert(/still had on screen/.test(signedOutMsg),
  'it must ALSO warn that the schedule above was scraped off a painted grid: that is the exact asymmetry the owner reported -- history refuses while the day\'s patients still come through');

console.log('schedule-read-declares-its-freshness: OK');
