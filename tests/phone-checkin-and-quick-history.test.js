'use strict';

/* THE INTAKE SUMMARY, AND THE HISTORY UNDER THE PATIENT  (ph3-1.0.0)
 * =============================================================================
 * Owner, 2026-08-08, verbatim:
 *
 *   "the patient quick history should be available on the phone up under each
 *    patient in the patient view if you click on a patient. Save the big stuff
 *    for the desktop but quick history should definitely be there."
 *
 *   "the patient enters the room the avatar starts recording them and asking
 *    them questions ... then there convo ends and the doctor should get a
 *    notification that the patient intake convo is done and then give the
 *    doctor the important summary on the phone app we have here."
 *
 * WHAT THIS SUITE IS ACTUALLY GUARDING. Both features are about ABSENCES and
 * ATTRIBUTION, and both fail silently when they get those wrong:
 *
 *   1. "No allergies recorded" and "we have never read this chart" render as
 *      the same empty field and mean opposite things. One of them is a sentence
 *      a doctor acts on with a needle in their hand.
 *   2. A brief attached to the wrong patient is one person's intake answers
 *      read in another person's room. The row carries a portal id and no name,
 *      so the match is on the id or there is no match.
 *   3. A chart printed under an appointment it was never tied to is the same
 *      defect one layer down, and it is this repo's own recurring class. ph2
 *      printed snapshot.active's NAME and window.activePatient()'s ALLERGIES in
 *      the same card with no assertion that they were one person.
 *   4. A "notification" that cannot reach a pocketed phone must never be
 *      described as one. A doctor who believes the phone will buzz stops
 *      looking, and the summary sits unread.
 *   5. A badge that counts what has already been READ stops meaning anything by
 *      9am, and a doctor who learns to ignore a red number ignores the one that
 *      mattered.
 *
 * WHAT MOVED FROM ph2 TO ph3, AND WHY THE ASSERTIONS BELOW LOOK DIFFERENT
 * ----------------------------------------------------------------------
 *   - There is no tab bar. Two screens, 'day' and 'visit'; the ph2 "Today tab
 *     badge" is now the header pill #mlsPh3Alert, and it counts UNREAD.
 *   - Nothing auto-expands on arrival. ph2 opened a newly arrived brief under
 *     whatever the doctor was already reading (`if (fresh.length === 1)
 *     S.ckOpen = fresh[0].id`), which moved the page AND left the badge
 *     contradicting a summary plainly on screen.
 *   - The arrival announcement is the header pill, not a body banner. ph2's
 *     banner cleared its own flag WHILE BUILDING the string, so the next repaint
 *     erased the announcement -- and repaints are continuous while anything is
 *     live.
 *   - quickHistory() has an IDENTITY GATE. The chart prints only when it ties to
 *     the active appointment by portal id, or by name AND date of birth
 *     together. Otherwise the screen says it cannot confirm and prints nothing.
 *   - ck-open carries data-id (was data-ck); ids are #mlsPh3*; the poll is the
 *     one 45s setInterval and api._ckPoll is the READER itself, not a number.
 *
 * Everything is EXECUTED: the module's real fetch path, its real delegated
 * click handler, its real render. Nothing here reads the source as text except
 * the two places that deliberately assert a STYLESHEET rule, because "this
 * sentence is not clipped" is a layout claim and cannot be made about a string.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_phone_ui.js'), 'utf8');
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function makeHarness(opts) {
  opts = opts || {};
  const byId = new Map();
  const timers = [];
  const calls = { toasts: [], vibrate: [], fetches: [] };

  function makeNode(tag) {
    const n = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '', textContent: '', value: '', disabled: false, hidden: false,
      style: { cssText: '', display: '', overflow: '', setProperty() {} },
      children: [], parentNode: null, isConnected: true,
      _handlers: {}, _html: '',
      classList: { _set: new Set(), add(c) { n.classList._set.add(c); }, remove(c) { n.classList._set.delete(c); }, contains(c) { return n.classList._set.has(c); }, toggle(c, f) { const w = f === undefined ? !n.classList._set.has(c) : !!f; if (w) n.classList._set.add(c); else n.classList._set.delete(c); return w; } },
      get innerHTML() { return n._html; },
      set innerHTML(v) { n._html = String(v == null ? '' : v); registerIds(n._html); },
      setAttribute(k, v) { n['attr_' + k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(n, 'attr_' + k) ? n['attr_' + k] : null; },
      removeAttribute(k) { delete n['attr_' + k]; },
      addEventListener(t, fn) { (n._handlers[t] = n._handlers[t] || []).push(fn); },
      removeEventListener(t, fn) { n._handlers[t] = (n._handlers[t] || []).filter(f => f !== fn); },
      dispatchEvent() { return true; },
      appendChild(c) { n.children.push(c); c.parentNode = n; if (c.id) byId.set(c.id, c); return c; },
      insertBefore(c) { n.children.unshift(c); c.parentNode = n; if (c.id) byId.set(c.id, c); return c; },
      removeChild(c) { n.children = n.children.filter(x => x !== c); c.parentNode = null; c.isConnected = false; return c; },
      remove() { if (n.parentNode) n.parentNode.removeChild(n); n.isConnected = false; },
      querySelector(sel) { return n._q ? n._q(sel) : null; },
      querySelectorAll(sel) { return n._qa ? n._qa(sel) : []; },
      closest() { return null; }, scrollIntoView() {}, select() {}, setSelectionRange() {}, focus() {},
      fire(type, ev) { (n._handlers[type] || []).forEach(fn => fn(ev)); }
    };
    return n;
  }
  function registerIds(html) {
    const re = /id="([A-Za-z0-9_-]+)"/g; let m;
    while ((m = re.exec(html))) if (!byId.has(m[1])) byId.set(m[1], makeNode('div'));
  }

  const body = makeNode('body'); body.id = 'body';
  const head = makeNode('head');
  const document = {
    readyState: 'complete', visibilityState: opts.hidden ? 'hidden' : 'visible', activeElement: null,
    body, head, documentElement: head, createElement: makeNode,
    getElementById(id) { return byId.get(id) || null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(t, fn) { (document._h = document._h || {})[t] = (document._h[t] || []).concat(fn); },
    removeEventListener() {},
    _fire(t, ev) { ((document._h || {})[t] || []).forEach(fn => fn(ev)); }
  };

  const snapshot = Object.assign({ day: '2026-08-07', phase: 'idle', active: null, recSecs: 0, warn: '', today: [] }, opts.snapshot || {});

  /* The check-in payload the endpoint returns, and the schedule that resolves
     its portal ids to names. */
  let checkins = opts.checkins || [];
  const win = {
    __mlsPhoneHome: { wantPhone: () => true, ensure() {} },
    __mlsDeviceRole: { role: () => 'phone', name: () => 'iOS · Safari', deviceNoun: () => 'iPhone' },
    __mlsEasyV32: {
      remote: {
        snapshot: () => snapshot,
        startVisitFor() { return true; }, record() { return true; },
        stopRecording() { return true; }, generate() { return true; }, requestSendReview() { return true; }
      }
    },
    __mlsDaySwitch: { currentDay: () => snapshot.day, setDay() { return true; }, shiftDay() { return true; }, rowsFor: () => snapshot.today, pullDay() {} },
    __mlsRelayLink: { shouldRelay: () => true, extPresent: () => false, activeJob: () => null, cancelActive() { return Promise.resolve(true); } },
    backendMode: () => true, bkToken: () => 'tok', bkBase: () => 'https://backend.example',
    toast(m, k) { calls.toasts.push({ m: String(m), k }); },
    _acctTodayKey: () => '2026-08-07',
    _calAppts: opts.appts || [],
    activePatient: () => (opts.chart === undefined ? null : opts.chart),
    patientNotes: () => (opts.notes || []),
    _athenaChartLanded: (p) => !!(p && p.athenaChartImportedAt),
    matchMedia: () => ({ matches: false }),
    showView() {},
    addEventListener(t, fn) { (win._h = win._h || {})[t] = (win._h[t] || []).concat(fn); },
    removeEventListener() {},
    navigator: {
      userAgent: IPHONE_UA, maxTouchPoints: 5,
      clipboard: { writeText() { return Promise.resolve(); } },
      vibrate(p) { calls.vibrate.push(p); return true; }
    },
    location: { search: '' }, open() {}, innerHeight: 800,
    fetch(url) {
      calls.fetches.push(String(url));
      if (/\/api\/avatar\/checkins/.test(String(url))) {
        if (opts.ckFails) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(null) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ checkins: checkins }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.presence || null) });
    }
  };
  win.window = win; win.document = document;
  win.MutationObserver = function (cb) { this.observe = function () { win._mo = cb; }; this.disconnect = function () {}; };
  win.setTimeout = function (fn, ms) { const id = timers.length; timers.push({ fn, ms, id, live: true, kind: 'timeout' }); return id; };
  win.clearTimeout = function (id) { if (timers[id]) timers[id].live = false; };
  /* ph3 arms the 45s check-in watch with setInterval (ph2 used a re-armed
     setTimeout chain). The harness has to hand out a real handle, because the
     module clears it with `!== null` and a handle of 0 is falsy -- exactly the
     defect that rule exists for. Interval entries are NOT retired when fired:
     an interval that stopped after one tick would make a repeat-poll assertion
     pass for the wrong reason. */
  win.setInterval = function (fn, ms) { const id = timers.length; timers.push({ fn, ms, id, live: true, kind: 'interval' }); return id; };
  win.clearInterval = function (id) { if (timers[id]) timers[id].live = false; };
  win.sessionStorage = { _m: {}, getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
  win.localStorage = { _m: {}, getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); } };
  win.Event = function (t) { this.type = t; };
  win.console = console;
  win.Date = Date; win.Math = Math; win.JSON = JSON; win.String = String; win.Number = Number;
  win.Object = Object; win.Array = Array; win.Promise = Promise; win.Error = Error; win.isNaN = isNaN;

  vm.createContext(win);
  vm.runInContext(source, win, { filename: 'feat_mls_phone_ui.js' });

  return {
    win, document, body, byId, calls, timers, snapshot,
    api: () => win.__mlsPhoneUI,
    /* ph3 ids throughout. The frame is #mlsPh3, the scroller #mlsPh3Body, the
       ONE contextual action lives in #mlsPh3Act, and the unread count is the
       header pill #mlsPh3Alert -- there is no tab bar to hang a badge on. */
    frame: () => body.children.filter(c => c.id === 'mlsPh3')[0] || null,
    screen: () => (byId.get('mlsPh3Body') || { _html: '' })._html,
    /* ph3 at b1003 moved the briefs OFF the day screen and onto their own, so
       every assertion about brief CONTENT has to go where the briefs are.
       (owner: "the check ins before the room needs to be a completly spreate
       tab that u can aget to both throgyuth thetop left 3 lines or throguht
       ththe notifications".) The day screen is the patient list; several open
       briefs used to push it below the fold. */
    briefs() { this.api().go('checkins'); return (byId.get('mlsPh3Body') || { _html: '' })._html; },
    bar: () => (byId.get('mlsPh3Act') || { _html: '' })._html,
    sheet: () => (byId.get('mlsPh3Sheet') || { _html: '' })._html,
    pill: () => byId.get('mlsPh3Alert') || null,
    css: () => String((byId.get('mlsPh3Css') || {}).textContent || ''),
    setCheckins(rows) { checkins = rows; },
    /* ph3's delegated handler WALKS parentNode up to the frame looking for
       data-act; it does not call closest(). Driving it any other way would test
       a path the phone never takes. */
    tap(act, attrs) {
      const f = this.frame();
      const el = {
        parentNode: f,
        getAttribute: (k) => (k === 'data-act' ? act : (((attrs || {})[k] == null) ? null : String(attrs[k])))
      };
      f.fire('click', { target: el });
    },
    /* Let the module's fetch chain settle. */
    settle() { return new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0))); },
    /* The check-in watch, and only it: >=30s separates the 45s poll from the
       1s repaint ticker and the 500ms sign-out watch. */
    fireWatch() {
      timers.filter(t => t.live && t.ms >= 30000).forEach(t => { if (t.kind === 'timeout') t.live = false; t.fn(); });
    }
  };
}

/* Ages are computed from a real clock, so the expected value is computed the
   same way rather than frozen into a string that rots on a birthday. */
function ageOf(dob) {
  const p = String(dob).slice(0, 10).split('-');
  const b = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--;
  return a + 'y';
}

const READY = {
  id: 77, headline: 'Left knee giving way on stairs for 3 weeks; no red flags.',
  patient_external_id: 'ext-9', ready_at: new Date(Date.now() - 4 * 60000).toISOString(),
  turns: 11, audited: 'passed', inProgress: false,
  bullets: ['Pain 6/10, worse descending stairs', 'No fever, no night pain'],
  summary: 'Patient reports 3 weeks of left knee instability...',
  askAbout: ['Whether the knee has ever locked']
};
const READY2 = {
  id: 79, headline: 'Right shoulder stiff since a fall in June.',
  patient_external_id: 'ext-4', ready_at: new Date(Date.now() - 9 * 60000).toISOString(),
  turns: 8, audited: 'passed', inProgress: false,
  bullets: ['Cannot reach overhead'], summary: 'Fell onto an outstretched hand...'
};
const FLAGGED_LIVE = {
  id: 78, headline: '⚠ Chest pressure while walking — interview still running.',
  patient_external_id: 'ext-4', ready_at: new Date(Date.now() - 60000).toISOString(),
  turns: 3, audited: null, inProgress: true, flags: ['cardiac'], bullets: ['⚠ Chest pressure on exertion']
};
const APPTS = [
  { id: 'a1', name: 'Marcus Bell', patient_external_id: 'ext-9', appt_date: '2026-08-07' },
  { id: 'a2', name: 'Priya Raman', patient_external_id: 'ext-4', appt_date: '2026-08-07' }
];

/* The visit fixtures below all carry a DOB on snapshot.active, because ph3's
   identity gate releases the chart on a portal-id tie or on name AND dob
   together -- and a suite that only ever exercised the release path would not
   be testing the gate at all. */
const MARCUS = { id: 'a1', name: 'Marcus Bell', dob: '1968-03-04', time: '9:20 AM' };

async function main() {

/* ===========================================================================
 * 1. A FINISHED INTAKE REACHES THE PHONE — AND ONLY ONCE
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY], appts: APPTS });
  await h.settle();
  assert(h.calls.fetches.some((u) => /\/api\/avatar\/checkins\?status=ready/.test(u)),
    'the phone must read the SAME endpoint the avatar lane already publishes — a second pipeline would ' +
    'be a second summary of the same conversation');

  const s = h.briefs();
  assert(/Left knee giving way on stairs/.test(s), 'the headline must reach the check-ins screen');
  assert(/Marcus Bell/.test(s),
    'the brief must say WHOSE it is — the row carries a portal id and no name, and three anonymous ' +
    'briefs is three rooms the doctor cannot tell apart');
  /* The screen names itself in its HEADER now, not in a section label above a
     stack on the day list, so the phrase is asserted where a doctor reads it. */
  h.api().menu(true);
  assert(/data-act="checkins"/.test(h.sheet()),
    'the ☰ menu must carry the always-available route to the briefs — the pill only exists while ' +
    'something is unread, so without this a brief already read has no way back');
  assert(/Check-ins before the room/.test(h.sheet()),
    'the menu route must name what it is: these are people sitting in the waiting room NOW');

  assert.strictEqual(h.calls.vibrate.length, 0,
    'THE FIRST LOAD MUST NOT BUZZ: opening the app at 9am would otherwise vibrate for every check-in ' +
    'that finished yesterday');

  /* ph2 exported api._ckPoll = 45000, a number nobody could call. ph3 exports
     the READER, which is what "Refresh" in the menu actually invokes — a poll
     interval you cannot trigger by hand is a poll you cannot prove. */
  assert.strictEqual(typeof h.api()._ckPoll, 'function',
    'the check-in reader must be callable, because Refresh has to re-read it on demand');
  const before = h.calls.fetches.length;
  h.api()._ckPoll();
  await h.settle();
  assert(h.calls.fetches.length > before, 'and calling it must actually hit the endpoint again');
}
{
  /* The arrival WHILE HE IS LOOKING is the one that is news. */
  const h = makeHarness({ checkins: [], appts: APPTS });
  await h.settle();
  assert.strictEqual(h.calls.vibrate.length, 0, 'nothing to announce yet');
  assert.strictEqual(h.pill().hidden, true, 'and nothing to count');

  h.setCheckins([READY]);
  h.fireWatch();
  await h.settle();
  assert.strictEqual(h.calls.vibrate.length, 1, 'an intake finishing while the app is open must buzz once');

  /* THE ANNOUNCEMENT LIVES IN THE HEADER, NOT IN THE BODY. ph2 drew a banner
     inside the scroller and cleared its own flag WHILE BUILDING the string, so
     the very next repaint erased it — and repaints are continuous while
     anything is live. The pill has to survive an arbitrary repaint. */
  const p1 = h.pill();
  assert.strictEqual(p1.hidden, false, 'the arrival must be visible in words, not only felt as a buzz');
  assert(/1 check-in/.test(p1.innerHTML), 'and it must say how many');
  h.api().render();
  h.api().render();
  assert.strictEqual(h.pill().hidden, false,
    'AND IT MUST SURVIVE A REPAINT: an announcement that clears itself while the string is being built ' +
    'is gone before the doctor looks up');

  /* (b) NOTHING AUTO-EXPANDS ON ARRIVAL. ph2 opened a single fresh brief under
     whatever the doctor was already reading, which moved the page AND left the
     badge counting something plainly on screen. Arrival is announced; opening
     is a decision. */
  const s = h.briefs();
  assert(!/Patient reports 3 weeks/.test(s),
    'an arriving check-in must NOT expand itself — it lands under the doctor\'s thumb and moves the page');
  assert(/data-act="ck-open" data-id="77" aria-expanded="false"/.test(s),
    'and the card must say it is closed, so the control and the screen agree');

  /* The same row on the next poll is not news again. */
  h.fireWatch();
  await h.settle();
  assert.strictEqual(h.calls.vibrate.length, 1, 'the same check-in must not buzz on every poll');
}
{
  /* KEYED BY id AND STATE. The endpoint returns a flagged interview that is
     still running so a red flag arrives early; keyed by id alone, that first
     announcement burns the id and the FINISH — the event that carries the
     summary — never announces at all. */
  const h = makeHarness({ checkins: [], appts: APPTS });
  await h.settle();

  h.setCheckins([FLAGGED_LIVE]);
  h.fireWatch();
  await h.settle();
  assert.strictEqual(h.calls.vibrate.length, 1, 'a flag raised mid-interview must reach the doctor early');
  assert(/STILL ANSWERING/.test(h.briefs()),
    'and must NOT be announced as finished — there is no summary to go and read yet');
  assert.strictEqual(h.pill().hidden, true,
    'and the unread count must not include it: a badge that sends the doctor to read something that ' +
    'does not exist yet teaches him to ignore the badge');

  const done = Object.assign({}, FLAGGED_LIVE, { inProgress: false, summary: 'Cardiac screen...', turns: 9 });
  h.setCheckins([done]);
  h.fireWatch();
  await h.settle();
  assert.strictEqual(h.calls.vibrate.length, 2,
    'THE ONE app.html SHIPPED BROKEN: the interview FINISHING is a different event about the same ' +
    'check-in. Keyed by id alone it is not "fresh", so the one class of check-in most likely to matter ' +
    'is the one that never announces.');
  assert.strictEqual(h.pill().hidden, false, 'and the finish is what the badge counts');
  assert(!/STILL ANSWERING/.test(h.briefs()), 'and the finish is rendered as a finish');
}

/* ===========================================================================
 * 2. THE BADGE COUNTS UNREAD, AND READING ONE DROPS IT
 * ---------------------------------------------------------------------------
 * ph2's Today badge was ckReadyCount() — every ready row the endpoint returned,
 * forever, because ready rows are not cleared server-side. A doctor who read
 * all five briefs at 8:05 carried a red 5 all morning and the number stopped
 * meaning anything. This is the whole reason the check-in half was rebuilt.
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY, READY2, FLAGGED_LIVE], appts: APPTS });
  await h.settle();
  assert.strictEqual(h.api().state().screen, 'day', 'precondition: the app opens on the day');
  assert.strictEqual(h.api().state().tab, 'day',
    'and state().tab still aliases the screen, because mls-connect.js reads this object');

  const p = h.pill();
  assert.strictEqual(p.hidden, false, 'two ready check-ins must show a count');
  assert.strictEqual(p.getAttribute('aria-label'), '2 unread patient check-ins',
    'THE COUNT IS UNREAD, AND IT SAYS SO. Three rows are on screen and one of them is a flagged ' +
    'interview still running with no summary to read; the number a doctor acts on is 2.');

  h.tap('ck-open', { 'data-id': '77' });
  assert.strictEqual(h.pill().getAttribute('aria-label'), '1 unread patient check-in',
    'READING ONE DROPS IT. ph2 counted rows, so opening a brief changed nothing and the badge was ' +
    'still 5 at noon.');
  assert(/1 check-in</.test(h.pill().innerHTML), 'and one is singular');

  /* Closing it again is not un-reading it. */
  h.tap('ck-open', { 'data-id': '77' });
  assert.strictEqual(h.pill().getAttribute('aria-label'), '1 unread patient check-in',
    'collapsing a brief he has already read must not resurrect the badge');

  h.tap('ck-open', { 'data-id': '79' });
  assert.strictEqual(h.pill().hidden, true, 'and reading the last one clears the pill entirely');

  /* Clearing the COUNT must not delete the BRIEFS. */
  const s = h.briefs();
  assert(/Left knee giving way/.test(s) && /Right shoulder stiff/.test(s) && /Chest pressure while walking/.test(s),
    'all three briefs must still be on the day screen — the badge is a count of what is unread, not a ' +
    'queue that empties');
}

/* ===========================================================================
 * 3. IT NEVER PROMISES A NOTIFICATION IT CANNOT SEND
 * -----------------------------------------------------------------------------
 * There is no APNs/FCM credential and no server holding device tokens, so
 * nothing reaches a phone that is asleep. A doctor who believes otherwise stops
 * looking, and the summary sits unread. ph3 added a whole surface ph2 did not
 * have — the menu sheet — so the scan covers it too.
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY], appts: APPTS });
  await h.settle();
  /* Order matters: going to the check-ins screen CLOSES the menu (a sheet left
     open over a screen the doctor just navigated to is a sheet in the way), so
     the briefs are captured first and the sheet is opened after. */
  const briefsHtml = h.briefs();
  h.api().menu(true);
  const everything = briefsHtml + h.bar() + h.sheet() + h.frame()._html + String(h.pill().innerHTML);
  for (const lie of [
    'we will notify you', "we'll notify you", 'you will be notified', 'notify you when',
    'push notification', 'even when the app is closed', 'in the background'
  ]) {
    assert(everything.toLowerCase().indexOf(lie) < 0,
      'the phone promises a notification it has no way to send: "' + lie + '"');
  }
  assert(/Add to Home Screen/.test(h.sheet()),
    'precondition: the menu sheet really was rendered, so the scan above covered something');
  h.api().menu(false);
}

/* ===========================================================================
 * 4. A FAILED POLL IS NOT "NO CHECK-INS"
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY], appts: APPTS });
  await h.settle();
  assert(/Left knee giving way/.test(h.briefs()), 'precondition: a brief is on screen');

  h.win.fetch = function (url) {
    if (/checkins/.test(String(url))) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(null) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
  };
  h.fireWatch();
  await h.settle();
  assert(/Left knee giving way/.test(h.briefs()),
    'THE BRIEF HE WAS READING MUST SURVIVE: a failure to REFRESH is not a reason to withdraw what is ' +
    'already in hand');
}
{
  /* And with nothing in hand, the failure has to be said. "No check-ins" and
     "we could not ask" render as the same empty section and mean opposite
     things — one of them means a patient is sitting in a room, finished. */
  const h = makeHarness({ checkins: [], ckFails: true, appts: APPTS });
  await h.settle();
  const s = h.briefs();
  assert(/could not read the check-ins/i.test(s),
    'a check-in list that could not be FETCHED must say so, in words, on the screen');
  assert(!/no check-ins/i.test(s) && !/nobody has checked in/i.test(s),
    'and it must not state the opposite claim — that nobody has checked in');
}

/* ===========================================================================
 * 5. THE BRIEF OPENS, AND IT IS THE WHOLE BRIEF
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY], appts: APPTS });
  await h.settle();
  assert(!/Patient reports 3 weeks/.test(h.briefs()), 'the summary starts collapsed');
  h.tap('ck-open', { 'data-id': '77' });
  const open = h.briefs();
  assert(/Pain 6\/10, worse descending stairs/.test(open), 'the bullets must be there');
  assert(/Patient reports 3 weeks of left knee instability/.test(open), 'and the summary itself');
  assert(/Worth asking/.test(open) && /ever locked/.test(open),
    'and what the check-in did NOT settle — that is the half a doctor uses in the room');
  assert(/aria-expanded="true"/.test(open), 'and the control says it is open');
  h.tap('ck-open', { 'data-id': '77' });
  assert(!/Patient reports 3 weeks/.test(h.screen()), 'tapping again closes it');
}
{
  /* A REJECTED audit is not an ordinary summary, and the sentence saying so
     must not sit on a line a 375px phone clips. In ph2 it had to be lifted OUT
     of the meta line onto its own; in ph3 it rides the meta line and the meta
     line WRAPS — which is the same guarantee made a different way, so the
     assertion is made against the stylesheet rather than the string. */
  const h = makeHarness({ checkins: [Object.assign({}, READY, { audited: 'rejected' })], appts: APPTS });
  await h.settle();
  const s = h.briefs();
  assert(/AUDIT REJECTED THIS SUMMARY/.test(s),
    'a rejected audit must be stated — the doctor is about to walk into the room on this summary');
  const rule = (h.css().match(/\.ph3-ckmeta\{([^}]*)\}/) || [])[1] || '';
  assert(rule, 'precondition: the meta line has a style rule to inspect');
  assert(!/nowrap/.test(rule) && !/ellipsis/.test(rule),
    'and the line carrying it must WRAP: a clipped "AUDIT REJECTED…" reads as an ordinary summary');
}
{
  /* Never graded is a third state and must not read like "passed". */
  const h = makeHarness({ checkins: [Object.assign({}, READY, { audited: null })], appts: APPTS });
  await h.settle();
  assert(/not audit-checked/.test(h.briefs()),
    'a summary nothing has checked against the transcript must say so');
}

/* ===========================================================================
 * 6. THE BRIEF ON THE VISIT SCREEN BELONGS TO THAT PATIENT
 * -----------------------------------------------------------------------------
 * Matched on the portal id through the schedule row. Two patients sharing a
 * name is ordinary; attaching one person's intake answers to another is the
 * worst thing this feature could do.
 * =========================================================================*/
{
  const h = makeHarness({
    checkins: [READY, FLAGGED_LIVE], appts: APPTS,
    snapshot: { active: MARCUS, phase: 'idle' }
  });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/Their check-in/.test(s), 'the open patient\'s check-in must be on their visit screen');
  assert(/Left knee giving way/.test(s), 'and it must be THEIR check-in');
  assert(!/Chest pressure while walking/.test(s),
    'THE ONE THAT MATTERS: the other patient\'s intake must not appear in this room');
}
{
  /* No portal id on the appointment => no match, and nothing shown. A brief
     attached by guesswork is worse than no brief. */
  const h = makeHarness({
    checkins: [READY], appts: [{ id: 'a1', name: 'Marcus Bell', appt_date: '2026-08-07' }],
    snapshot: { active: MARCUS, phase: 'idle' }
  });
  await h.settle();
  h.api().go('visit');
  assert(!/Their check-in/.test(h.screen()),
    'with no portal id to match on, the visit screen must show no brief at all rather than the ' +
    'nearest one');
}

/* ===========================================================================
 * 7. QUICK HISTORY — AND WHOSE HISTORY IT IS
 * ---------------------------------------------------------------------------
 * (c) THE IDENTITY GATE. ph2 printed snapshot.active's NAME at the top of the
 * visit screen and window.activePatient()'s ALLERGIES, MEDICATIONS and PROBLEMS
 * directly underneath it, with no assertion anywhere that the two described one
 * person. If the host's active-patient state lags or fails to re-bind — which
 * is this repo's own recurring defect class — that is one patient's drug list
 * printed under another patient's name, on the last screen a doctor reads
 * before walking into the room.
 * =========================================================================*/
const CHART_NOTES = [
  { date: '2026-06-02', type: 'Follow-up', outcome: { pain: 7 } },
  { date: '2026-07-14', type: 'Injection', outcome: { pain: 4 } }
];
const MARCUS_CHART = {
  id: 'ext-9', name: 'Marcus Bell', dob: '1968-03-04', sex: 'M', mrn: 'A2213',
  allergies: 'Penicillin\nSulfa', meds: 'Meloxicam 15mg\nGabapentin 300mg\nLisinopril 10mg\nAtorvastatin',
  problems: 'Left knee OA\nLumbar radiculopathy', athenaChartImportedAt: '2026-08-01T10:00:00Z'
};
{
  /* RELEASED BY PORTAL ID: the chart's id IS the appointment's portal id. That
     is the strongest tie this product has and it is tried first. */
  const h = makeHarness({
    chart: MARCUS_CHART, notes: CHART_NOTES, appts: APPTS,
    snapshot: { active: MARCUS, phase: 'idle' }
  });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/Quick history/.test(s), 'tapping a patient must land on a screen that carries their quick history');
  assert(/Penicillin, Sulfa/.test(s), 'allergies are the field most likely to be acted on');
  assert(/<dt class="ph3-dt">Visits<\/dt><dd class="ph3-dd">2 &middot; last seen 7\/14\/2026<\/dd>/.test(s),
    'the visit count and the last-seen date, and the date must be the LATEST note rather than the ' +
    'store\'s arbitrary insertion order');
  assert(/<dt class="ph3-dt">Last pain<\/dt><dd class="ph3-dd">4\/10<\/dd>/.test(s),
    'the most recent pain score, not the first');
  assert(/Meloxicam 15mg, Gabapentin 300mg, Lisinopril 10mg \+1 more/.test(s),
    'a long med list must say how much is not shown rather than silently truncate');
  assert(s.indexOf(ageOf('1968-03-04')) >= 0, 'age, computed from the DOB');
  assert(/full chart .* is on the office computer/i.test(s),
    'and it must say where the rest is — the owner asked for quick history, not the chart');
}
{
  /* RELEASED BY NAME AND DOB TOGETHER: the chart id is the app's own local id
     and ties to nothing, so the fallback has to carry it — and it needs BOTH
     halves. */
  const chart = Object.assign({}, MARCUS_CHART, { id: 'local-p1' });
  const h = makeHarness({
    chart, notes: CHART_NOTES, appts: APPTS,
    snapshot: { active: MARCUS, phase: 'idle' }
  });
  await h.settle();
  h.api().go('visit');
  assert(/Penicillin, Sulfa/.test(h.screen()),
    'a chart with no portal id may still be released — on name AND date of birth together');
}
{
  /* THE GATE CLOSES: same name, and NOT ONE DATE OF BIRTH between them. A name
     on its own is not an identity in this product — the standing rule is that an
     EMR record is never matched by name equality, and a clinic with two Maria
     Garcias is the ordinary case, not the edge one. */
  const chart = Object.assign({}, MARCUS_CHART, { id: 'local-p1' });
  const h = makeHarness({
    chart, notes: CHART_NOTES, appts: APPTS,
    snapshot: { active: { id: 'a1', name: 'Marcus Bell' }, phase: 'idle' }   /* no dob */
  });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/cannot confirm the chart it has open belongs to Marcus Bell/.test(s),
    'the weakest possible evidence dressed as a match must be refused, in words');
  assert(!/Penicillin/.test(s) && !/Meloxicam/.test(s),
    'AND NOTHING MAY BE PRINTED: a refusal that still prints the allergies is not a refusal');
  assert(!/ph3-dl/.test(s), 'the whole field list must be absent, not blanked');
}
{
  /* THE ONE THAT MATTERS. The host has a DIFFERENT patient's chart open — the
     exact cross-patient shape this repo keeps rediscovering. ph2 printed the
     wrong person's latex allergy under Marcus Bell's name and said nothing. */
  const other = {
    id: 'ext-4', name: 'Priya Raman', dob: '1991-11-02', sex: 'F', mrn: 'B7781',
    allergies: 'Latex', meds: 'Sertraline 50mg', problems: 'Rotator cuff tendinopathy',
    athenaChartImportedAt: '2026-08-01T10:00:00Z'
  };
  const h = makeHarness({
    chart: other, notes: CHART_NOTES, appts: APPTS,
    snapshot: { active: MARCUS, phase: 'idle' }
  });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/Marcus Bell/.test(s), 'precondition: the visit is Marcus Bell\'s');
  assert(!/Latex/.test(s) && !/Sertraline/.test(s) && !/Priya Raman/.test(s),
    'ANOTHER PATIENT\'S ALLERGIES MUST NOT APPEAR UNDER THIS PATIENT\'S NAME. A latex allergy read in ' +
    'the wrong room is the worst thing this screen can do, and it is invisible when it happens.');
  assert(/cannot confirm the chart it has open belongs to Marcus Bell/.test(s),
    'and the screen must say it cannot confirm, rather than render an empty card that reads as ' +
    '"this patient has nothing"');
}
{
  /* (d) CHART FIELDS ARRIVING AS AN ARRAY. Depending on which importer wrote
     them, allergies/meds/problems are newline text OR an array. String(array)
     split on newlines is ONE line reading "a,b,c" and a count of 1 — so a
     four-drug list prints with no "+N more" and looks complete. Both shapes
     must produce the SAME dd. */
  const meds4 = ['Meloxicam 15mg', 'Gabapentin 300mg', 'Lisinopril 10mg', 'Atorvastatin'];
  const asArray = makeHarness({
    chart: Object.assign({}, MARCUS_CHART, { meds: meds4, allergies: ['Penicillin', 'Sulfa'] }),
    notes: CHART_NOTES, appts: APPTS, snapshot: { active: MARCUS, phase: 'idle' }
  });
  await asArray.settle();
  asArray.api().go('visit');
  const arr = asArray.screen();

  const asText = makeHarness({
    chart: MARCUS_CHART, notes: CHART_NOTES, appts: APPTS, snapshot: { active: MARCUS, phase: 'idle' }
  });
  await asText.settle();
  asText.api().go('visit');
  const txt = asText.screen();

  const medDd = (s) => (s.match(/<dt class="ph3-dt">Medications<\/dt><dd class="ph3-dd">([^<]*)<\/dd>/) || [])[1];
  assert(medDd(arr), 'precondition: a Medications row was rendered from the array chart');
  assert(/\+1 more/.test(medDd(arr)),
    'A FOUR-ITEM ARRAY IS FOUR MEDICATIONS. Counted as one joined line it prints with no "+1 more" and ' +
    'a doctor reads a truncated drug list as the whole list.');
  assert.strictEqual(medDd(arr), medDd(txt),
    'and the two shapes must render identically — one reader, not two, or the count depends on which ' +
    'importer happened to write the chart');
  assert(/<dt class="ph3-dt">Allergies<\/dt><dd class="ph3-dd">Penicillin, Sulfa<\/dd>/.test(arr),
    'a two-item array is two allergies, joined, with nothing hidden');
}

/* ===========================================================================
 * 8. WHAT IT SAYS WHEN IT DOES NOT KNOW
 * -----------------------------------------------------------------------------
 * Three absences that render as the same blank field and mean three different
 * things. Every one of them is stated in words, in every box.
 * =========================================================================*/
{
  /* THE LOAD-BEARING CASE. A chart that athenaOne has never been read into
     looks exactly like a chart with nothing in it. */
  const chart = { id: 'ext-9', name: 'Nina Petrov', dob: '1990-01-02' };   /* no athenaChartImportedAt */
  const h = makeHarness({
    chart, notes: [], appts: APPTS,
    snapshot: { active: { id: 'a1', name: 'Nina Petrov', dob: '1990-01-02' }, phase: 'idle' }
  });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/never read from athenaOne/.test(s),
    'THE ONE THAT MATTERS: an empty allergy field on a never-read chart must say it is UNKNOWN. ' +
    '"None recorded" is a clinical claim, and this app has never had the evidence for it.');
  assert(!/none recorded/i.test(s), 'and must not make that claim anywhere on the card');
  assert(/has never been read onto this account/.test(s),
    'the footer must say it too, in a full sentence, for the doctor who reads the card and not the field');
}
{
  /* A landed chart with genuinely empty fields says the opposite thing. */
  const chart = { id: 'ext-9', name: 'Owen Marsh', dob: '1975-05-05', athenaChartImportedAt: '2026-08-02T09:00:00Z' };
  const h = makeHarness({
    chart, notes: [], appts: APPTS,
    snapshot: { active: { id: 'a1', name: 'Owen Marsh', dob: '1975-05-05' }, phase: 'idle' }
  });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/none recorded/.test(s), 'a chart that HAS been read may say a field is empty');
  assert(!/never read from athenaOne/.test(s), 'and must not claim ignorance it does not have');
}
{
  /* No chart record bound at all: say so, do not render an empty card that
     reads as "this patient has no history". This is a DIFFERENT sentence from
     the identity refusal above — "we have nothing open" and "what we have open
     may be someone else" are not the same problem and do not have the same
     fix. */
  const h = makeHarness({ chart: null, appts: APPTS, snapshot: { active: MARCUS, phase: 'idle' } });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/No chart record is open for Marcus Bell/.test(s),
    'an unbound visit must say the history is missing, not render a card of blanks');
  assert(!/cannot confirm the chart it has open/.test(s),
    'and it must not borrow the mismatch sentence — there is no chart to have mistaken');
}

/* ===========================================================================
 * 9. SIGNING OUT TAKES THE PATIENTS' ANSWERS WITH IT
 * -----------------------------------------------------------------------------
 * ph2 listened for 'mls:session-boundary'. ph3 does it on the teardown itself:
 * render() re-checks owns() && authed() on EVERY repaint, and the repaints are
 * driven by the app's own DOM, so the teardown that produces the login screen is
 * itself the trigger — and unmount() calls forgetSession(). The account boundary
 * has to take the briefs, the read record AND the announced-already record, or
 * the next doctor's first arrivals are silently swallowed.
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY], appts: APPTS });
  await h.settle();
  assert(/Left knee giving way/.test(h.briefs()), 'precondition: a brief is on screen');
  h.tap('ck-open', { 'data-id': '77' });
  assert.strictEqual(h.pill().hidden, true, 'precondition: he has read it, so nothing is unread');

  /* The account goes away. */
  h.win.bkToken = () => '';
  h.api().render();
  assert.strictEqual(h.frame(), null,
    'the whole frame must come down — a phone shell left over the login screen hides the only way ' +
    'back in, and it is still holding another account\'s patients');
  assert.strictEqual(h.body.classList.contains('mls-ph3'), false,
    'and the body class goes with it, or the desktop app stays hidden under nothing');

  /* A different doctor signs in on the same phone, and the endpoint is empty. */
  h.setCheckins([]);
  h.win.bkToken = () => 'tok';
  h.api().ensure();
  await h.settle();
  assert(h.frame(), 'precondition: the app mounted again');
  assert(!/Left knee giving way/.test(h.screen()),
    'a session boundary must drop another account\'s patients answering another account\'s questions');

  /* ...and the record of what was already announced, and of what was already
     READ, or the next doctor's first arrivals are silently swallowed and his
     badge starts at zero over a brief he has never seen. */
  h.setCheckins([READY]);
  h.fireWatch();
  await h.settle();
  assert.strictEqual(h.calls.vibrate.length, 1,
    'the announced-already record must be dropped with the session too');
  assert.strictEqual(h.pill().getAttribute('aria-label'), '1 unread patient check-in',
    'and so must the READ record: a brief the previous doctor opened is unread for this one');
}

console.log('PASS the intake summary and the quick history (ph3): the phone reads the avatar lane\'s OWN ' +
  'endpoint and _ckPoll is the reader itself; the first load never buzzes and a repeat poll never ' +
  're-buzzes; a flag mid-interview announces early AND the finish announces again (keyed by id AND ' +
  'state); NOTHING auto-expands on arrival and the header pill survives repaints; the badge counts ' +
  'UNREAD and drops as briefs are opened without deleting them; no screen — including the new menu ' +
  'sheet — promises a notification it cannot send; a failed poll never renders as "no check-ins" and ' +
  'never withdraws the brief in hand; a rejected audit is stated on a line that wraps; the visit screen ' +
  'shows only the OPEN patient\'s brief and none at all without a portal id; the quick history is ' +
  'released ONLY on a portal-id tie or name AND dob together, refuses another patient\'s chart in ' +
  'words and prints none of its fields, counts an ARRAY of four medications as four, and distinguishes ' +
  '"none recorded" from "never read from athenaOne" from "no chart record open"; and signing out drops ' +
  'the briefs, the read record and the announced record together');
}

main().then(null, function (err) { console.error(err && err.stack || err); process.exit(1); });
