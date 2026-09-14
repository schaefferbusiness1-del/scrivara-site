'use strict';
/* MLS Assist 3.0.125 — exactread / dayauthority / readlock / draftonly-1.1.0 pins.
 * Executes the actual source seams where a closure can be lifted, and pins the
 * rest by exact text so a later splice cannot silently reopen a closed path. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const cs = fs.readFileSync(path.join(root, 'content.js'), 'latin1');
const wsg = fs.readFileSync(path.join(root, 'write_safety_guard.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const count = (s, needle) => s.split(needle).length - 1;

/* 1. exactread-1.0.0: the chart read's identity gate is the canonical resolver and it refuses instead of accepting name-only */
ok(bg.includes("const exactGlobalPair = want ? mlsExactIdentityPair({name:want,dob:wantDob,mrn:wantMrn}, ident || {}) : { ok: false, reason: 'no-target' };"), 'chart read computes the exact pair');
ok(bg.includes("if (want && exactGlobalPair.reason === 'identity-hint-incomplete') {"), 'no DOB -> identity-hint-incomplete refusal');
ok(bg.includes("if (want && exactGlobalPair.reason === 'identity-ambiguous') {"), 'ambiguous banner -> refusal');
ok(bg.includes("const globalStrongMismatch = !!(want && ident && ident.name && !exactGlobalPair.ok);"), 'wrong-chart fires on any exact-pair failure');
ok(!bg.includes("const globalStrongMismatch = !!(globalNameMatches && wantDob && (!ident.dob || !sameDobStrict(ident.dob, wantDob)));"), 'the old name-only-when-no-DOB gate is gone');
ok(bg.includes("if (want && !(ident && ident.name)) {"), 'an opened chart with no readable identity is unverified, never ok:true');
ok(bg.includes("if (!chosenStrict.length || !String(chartTextStrict || '').trim()) {"), 'zero captured text is refused');
ok(bg.includes("reason: 'chart-frames-unbound'"), 'chart-frames-unbound reason exists');
{
  /* execute the resolver copy that lives at module scope and prove the refusal mapping */
  const i = bg.indexOf('function mlsExactIdentityPair(expected, observed) {');
  const j = bg.indexOf('function mlsExactNameKey(value) {');
  const k = bg.indexOf('function mlsExactDobKey(value) {');
  ok(i > 0 && j > 0 && k > 0, 'resolver copies present');
  const lift = (start) => { let d = 0, e = start; for (; e < bg.length; e++) { if (bg[e] === '{') d++; else if (bg[e] === '}') { d--; if (d === 0) { e++; break; } } } return bg.slice(start, e); };
  const src = lift(j) + '\n' + lift(k) + '\n' + lift(i) + '\nreturn mlsExactIdentityPair;';
  const pair = new Function(src)();
  eq(pair({ name: 'Jane Doe', dob: '' }, { name: 'Jane Doe', dob: '01/02/1960' }).reason, 'identity-hint-incomplete', 'no requested DOB refuses');
  eq(pair({ name: 'Jane Doe', dob: '01/02/1960' }, { name: 'Jane Doe', dob: '01/02/1960', ambiguous: true }).reason, 'identity-ambiguous', 'ambiguous refuses');
  eq(pair({ name: 'Jane Doe', dob: '1960-01-02' }, { name: 'DOE, JANE', dob: '01/02/1960' }).ok, true, 'ISO and slash DOB agree, comma form agrees');
  eq(pair({ name: 'Jane Doe', dob: '1960-01-02', mrn: '1' }, { name: 'Jane Doe', dob: '01/02/1960', mrn: '2' }).ok, true, 'MRN never vetoes an exact pair');
  eq(pair({ name: 'Jane Doe', dob: '1960-01-02', mrn: '1' }, { name: 'Jane Doe', dob: '01/02/1960', mrn: '2' }).mrnConflict, true, 'MRN conflict is reported');
  eq(pair({ name: 'Jane Doe', dob: '1962-03-04' }, { name: 'Jane Doe', dob: '1942-03-04' }).ok, false, 'decades never collide');
}

/* 2. dayauthority-1.0.0 */
ok(bg.includes("var __authoritativeEmpty = (__parsedCount === 0 && !!((pick && pick.s && pick.s.schedDate) || '') &&"), 'proven-empty day needs a readable schedule date');
ok(bg.includes("'schedule-date-unreadable'"), 'schedule-date-unreadable cause exists');
ok(bg.includes("var __expectedDay = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(msg.expectedDate || '')) ? String(msg.expectedDate) : '';"), 'schedule read honours an expected day');
ok(bg.includes("reason: 'schedule-day-mismatch'"), 'schedule-day-mismatch refusal exists');
ok(cs.includes("expectedDate: (/^\\d{4}-\\d{2}-\\d{2}$/.test(mlsStr(d.expectedDate || d.date, 10)) ? mlsStr(d.expectedDate || d.date, 10) : '')"), 'bridge forwards the expected day');

/* 3. honest progress */
ok(bg.includes("' checked; ' + visits.length + ' full note' + (visits.length === 1 ? '' : 's') + ' read so far."), 'history progress states bodies actually held');
ok(!bg.includes("'Read full encounter ' + (i + 1) + ' of ' + total"), 'the position-as-count message is gone');

/* 4. exactopen-1.0.0: the name-scan opener */
ok(bg.includes("if (!fname) return { el: null, sc: 0, scanned: nodes.length, reason: 'first-name-required' };"), 'surname-only never clicks');
ok(bg.includes("if (ties > 1) return { el: null, sc: bestSc, scanned: nodes.length, ambiguous: true, nameAmbiguous: true, matches: ties };"), 'a top-score tie refuses');
ok(bg.includes("reason: hit.nameAmbiguous ? 'ambiguous' : 'appointment-id-ambiguous'"), 'ambiguity reason is named');
{
  /* execute scanOnce's tie logic on a synthetic node list */
  const s = bg.indexOf("          if (!fname) return { el: null, sc: 0, scanned: nodes.length, reason: 'first-name-required' };");
  const e = bg.indexOf("          return { el: best, sc: bestSc, scanned: nodes.length };", s);
  const body = bg.slice(s, e + "          return { el: best, sc: bestSc, scanned: nodes.length };".length);
  const fn = new Function('nodes', 'fname', 'rowText', 'scoreRow', body);
  const mk = (t) => ({ t, contains: () => false });
  const scoreRow = (tx) => tx.indexOf('doe') >= 0 && tx.indexOf('jane') >= 0 ? 8 : 0;
  const one = fn([mk('doe, jane 8:00'), mk('smith, john')], 'jane', (n) => n.t, scoreRow);
  ok(one.el && one.el.t === 'doe, jane 8:00', 'a single top row is picked');
  const two = fn([mk('doe, jane 8:00'), mk('doe, jane 2:00')], 'jane', (n) => n.t, scoreRow);
  eq(two.ambiguous, true, 'two distinct top rows refuse');
  eq(two.matches, 2, 'tie count reported');
  const none = fn([mk('doe, jane 8:00')], '', (n) => n.t, scoreRow);
  eq(none.reason, 'first-name-required', 'surname-only refuses');
}

/* 5. readlock-1.0.0 */
eq(count(bg, 'self.__mlsReadInFlight = (Number(self.__mlsReadInFlight) || 0) + 1;'), 2, 'chart read and history read both mark in-flight');
eq(count(bg, 'self.__mlsReadInFlight = Math.max(0, (Number(self.__mlsReadInFlight) || 0) - 1);'), 2, 'both release on their single terminal');
ok(bg.includes("if ((Number(self.__mlsReadInFlight) || 0) > 0) return { ok: false, blocked: true, reason: 'read-in-progress'"), 'execute refuses while a read is in flight');
{
  const i = bg.indexOf("        actionToken = clean(msg.actionToken);");
  const j = bg.indexOf("var tokenClaim = await claimActionToken(actionToken);", i);
  ok(i > 0 && j > i && bg.slice(i, j).includes("reason: 'read-in-progress'"), 'the read lock is checked before the token is claimed (nothing consumed)');
}

/* 6. openterminal-1.0.0 + oneterminal-1.0.0 */
ok(bg.includes("/* openterminal-1.0.0 (3.0.125): one terminal answer per open request, even if an await never settles. */"), 'searchOpen has a wall-clock terminal');
ok(bg.includes("var __v2Responded = false; function __v2Respond(r) { if (__v2Responded) return; __v2Responded = true; try { sendResponse(r); } catch (eV2R) {} }"), 'ActionV2 handler answers exactly once');
ok(bg.includes("})().then(function (r) { __v2Respond(r); }, function (e) { __v2Respond({ ok: false, reason: 'outcome-uncertain'"), 'rejection path uses the same funnel');
ok(!bg.includes("})().then(function (r) { sendResponse(r); }).catch(function (e) { sendResponse({ ok: false, reason: 'outcome-uncertain'"), 'the double-response shape is gone');

/* 7. draftonly-1.1.0: sign paths deleted, legacy writer deleted */
eq(count(bg, 'async function mlsUnifiedWriteDriverFn('), 0, 'unified write driver deleted');
eq(count(bg, 'mlsUnifiedWriteDriverFn'), 1, 'only the tombstone comment names it');
ok(!bg.includes("var ta = nrmName(a).split(' ').filter(function (x) { return x.length > 1; });"), 'token-overlap name comparator gone');
ok(!bg.includes("      var trustedSender = false;"), 'legacy write orchestration gone');
ok(bg.includes("reason: 'unified-confirmation-required'"), 'the legacy message name still answers a refusal');
ok(!bg.includes("  // ----- SIGN (clicks; user-initiated; never invoked autonomously) -----"), 'sign half of mlsAthenaSignSave deleted');
ok(!bg.includes("clickEl(controls[0].el);"), 'no sign control click remains');
ok(bg.includes("      var mode = 'probe'; /* draftonly-1.1.0 (3.0.125): probe-only; the sign half no longer exists */"), 'overlay sign wrapper is probe-only');
ok(!bg.includes("var signStatusEvidenceSnapshot = statusEvidenceSnapshot([noteScope]);"), 'SIGN_ENCOUNTER clicker deleted');
ok(bg.includes("if (action === 'sign_encounter') return { ok: false, blocked: true, action: action, attempted: false, verified: false, signed: false, reason: 'final-action-blocked'"), 'sign_encounter is an explicit refusal in the driver');
ok(bg.includes('/* SIGN_ENCOUNTER_START */') && bg.includes('/* SIGN_ENCOUNTER_END */'), 'markers kept');
ok(!bg.includes("place_order execute through the SAME supervised path as write_note"), 'stale wsg-2.0.0 comment gone');
ok(bg.includes("if (!/^(write_note|save_draft)$/.test(clean(rec.action))) return false; /* draftonly-1.1.0 (3.0.125) */"), 'persisted tokens with forbidden verbs never hydrate');
{
  /* the wsForbidden lists in both copies carry the new entries, identically */
  const need = ['close_encounter', 'file_claim', 'checkin', 'check-in', 'check_in', 'checkout', 'check-out', 'check_out', 'discharge', 'deleteencounter', 'delete-encounter', 'delete_encounter', 'voidencounter', 'void-encounter', 'void_encounter'];
  const bgLine = bg.slice(bg.indexOf('var WS_FORBIDDEN_ATTRS = ['), bg.indexOf('];', bg.indexOf('var WS_FORBIDDEN_ATTRS = [')));
  const wsgBlock = wsg.slice(wsg.indexOf('var FORBIDDEN_ATTR_FRAGMENTS = ['), wsg.indexOf('];', wsg.indexOf('var FORBIDDEN_ATTR_FRAGMENTS = [')));
  for (const n of need) { ok(bgLine.includes("'" + n + "'"), 'driver attrs carry ' + n); ok(wsgBlock.includes("'" + n + "'"), 'guard attrs carry ' + n); }
  const bgAttrs = (bgLine.match(/'[^']+'/g) || []).map((x) => x.slice(1, -1)).sort();
  const wsgAttrs = (wsgBlock.match(/'[^']+'/g) || []).map((x) => x.slice(1, -1)).sort();
  assert.deepStrictEqual(bgAttrs, wsgAttrs, 'driver and guard attribute lists are identical sets'); checks++;
  ok(bg.includes("/\\bcheck\\s*-?\\s*(?:in|out)\\b/, /\\bdischarge\\b/, /\\bvoid\\b/];"), 'driver labels refuse check-in/out, discharge, void');
  ok(wsg.includes("'\\\\bcheck\\\\s*-?\\\\s*(?:in|out)\\\\b',") && wsg.includes("'\\\\bdischarge\\\\b',") && wsg.includes("'\\\\bvoid\\\\b'"), 'guard labels refuse check-in/out, discharge, void');
  /* execute the guard's label matcher on the new phrases */
  const labelSrcStart = wsg.indexOf('var FORBIDDEN_LABEL_SOURCES = [');
  const labelSrcEnd = wsg.indexOf('];', labelSrcStart) + 2;
  const labelFn = new Function(wsg.slice(labelSrcStart, labelSrcEnd) + '\nreturn function (label) { return FORBIDDEN_LABEL_SOURCES.some(function (s) { return new RegExp(s, "i").test(label); }); };')();
  for (const l of ['Check In', 'Check-out', 'Discharge patient', 'Void encounter', 'Sign and Save', 'Close Encounter']) ok(labelFn(l.toLowerCase()), 'guard label refuses "' + l + '"');
  for (const l of ['Save', 'Save Draft', 'Save note']) ok(!labelFn(l.toLowerCase()), 'guard label still allows "' + l + '"');
}
{
  const re = "|file\\s+(?:the\\s+)?claim|check\\s*-?\\s*(?:in|out)|close\\s+encounter|discharge|unlock|reopen|delete|remove|void)\\b/i";
  eq(count(bg, re), 2, 'FINAL_ACTION extended in both copies');
  const line = bg.slice(bg.indexOf('var FINAL_ACTION = /'), bg.indexOf('\n', bg.indexOf('var FINAL_ACTION = /')));
  const FINAL_ACTION = new Function(line.trim().replace(/;\s*$/, '') + '; return FINAL_ACTION;')();
  for (const l of ['Check In', 'check-in', 'Close Encounter', 'Discharge', 'Unlock note', 'Reopen', 'Check out', 'Sign']) ok(FINAL_ACTION.test(l), 'FINAL_ACTION refuses "' + l + '"');
  ok(!FINAL_ACTION.test('Next page'), 'FINAL_ACTION allows navigation');
}

/* 8. mrnreport-1.0.0 + gestureclass-1.0.0 + sleeptab-1.0.0 */
ok(bg.includes("var __mrnConflictAtExecute = !!(digits(p && p.mrn) && digits(rec.locked && rec.locked.mrn) && digits(p.mrn) !== digits(rec.locked && rec.locked.mrn));"), 'execute compares the app MRN to the live-locked MRN');
ok(!bg.includes("if (rec.expectedMrn && rec.expectedMrn !== digits(rec.locked && rec.locked.mrn)) return {ok:false,blocked:true,reason:'patient-mismatch'};"), 'the tautological MRN re-check is gone');
ok(bg.includes("executed.mrnConflict = __mrnConflictAtExecute; executed.gestureClass = clean(msg.gestureClass) || 'trusted-click';"), 'receipt carries mrnConflict and gestureClass');
ok(bg.includes("readOnly: true, mrnConflict: !!(digits(p && p.mrn) && digits(probe.context && probe.context.mrn) && digits(p.mrn) !== digits(probe.context.mrn)),"), 'probe receipt carries mrnConflict');
ok(bg.includes("&& !(typeof mlsAthTabSleeping === 'function' && mlsAthTabSleeping(t)); } catch (e) { return false; } }); /* sleeptab-1.0.0 (3.0.125) */"), 'sleeping tabs are never write candidates');
ok(!bg.includes('__mlsWalkAliasRec'), 'the nickname-alias residue is gone');
ok(bg.includes("/* draftonly-1.1.0 (3.0.125): the action map above is CLOSED to write_note"), 'corrected guard comment present');
ok(count(bg, 'MLS only opened that section tab to read it; no Save or Sign was pressed.') >= 5, 'read-back refusals say what was pressed');

/* 9. content.js: dead sign gesture gone, dead label patterns gone, remote arm hardened, nav relay */
eq(count(cs, '_mlsSignGestureUntil'), 0, 'no sign gesture variable');
ok(!cs.includes("if (action === 'stage_billing') return") && !cs.includes("if (action === 'sign_encounter') return") && !cs.includes("if (action === 'place_order') return /\\bconfirm"), 'dead label patterns gone');
ok(cs.includes("if (!/^(write_note|save_draft)$/.test(action)) return false; // draftonly-1.0.0"), 'label matcher still closed');
ok(cs.includes("if (mlsLoopbackOrigin(event.origin)) return; /* ra-origin-1.1.0 (3.0.125): loopback is synthetic-only and can never arm a write */"), 'remote arm refuses loopback');
ok(cs.includes("gestureClass: 'remote-relay',") && cs.includes("gestureClass: 'trusted-click' /* gestureclass-1.0.0 (3.0.125) */"), 'both arms carry a class');
ok(cs.includes("gestureClass = String(arm.gestureClass || 'trusted-click');") && cs.includes("          gestureClass: gestureClass,"), 'the class rides the bridge request');
ok(cs.includes('function mlsRelayNav(req, cb) {'), 'navigation relay helper exists');
eq(count(cs, "mlsRelayNav({ type: 'mlsAppSearchOpenRequest',"), 2, 'both chart opens use the navigation relay');
ok(cs.includes("mlsRelayNav({ type: 'mlsAppGotoDateRequest',") && cs.includes("mlsRelayNav({ type: 'mlsAppGoHomeRequest' }"), 'goto/home use the navigation relay');
ok(!cs.includes("mlsRelayRetry({ type: 'mlsAppSearchOpenRequest',") && !cs.includes("mlsRelayRetry({ type: 'mlsAppGotoDateRequest',") && !cs.includes("mlsRelayRetry({ type: 'mlsAppGoHomeRequest' }"), 'no blind auto-retry on a navigation verb');
{
  /* execute mlsRelayNav: a mid-action death (lastError without "receiving end") must NOT re-send */
  const s = cs.indexOf('  function mlsRelayNav(req, cb) {');
  const e = cs.indexOf('  function mlsRelayRetry(req, cb) {', s);
  const body = cs.slice(s, e);
  const run = (errMsg) => new Promise((resolve) => {
    let sends = 0;
    const chrome = { runtime: { lastError: null, sendMessage: (req, cb) => { sends++; chrome.runtime.lastError = errMsg ? { message: errMsg } : null; cb(undefined); chrome.runtime.lastError = null; } } };
    const fn = new Function('chrome', 'setTimeout', body + '\nreturn mlsRelayNav;')(chrome, (f) => f());
    fn({ type: 'x' }, () => resolve(sends));
  });
  (async () => {
    eq(await run('The message port closed before a response was received.'), 1, 'port-closed (worker died mid-action) is not re-sent');
    eq(await run('Could not establish connection. Receiving end does not exist.'), 2, 'never-received is re-sent once');
    eq(await run(null), 1, 'a null answer without an error is not re-sent');
    console.log('PASS exactread-30125-runtime: ' + checks + ' checks');
  })().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
}
