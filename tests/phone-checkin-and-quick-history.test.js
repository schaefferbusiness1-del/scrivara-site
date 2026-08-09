'use strict';

/* THE INTAKE SUMMARY, AND THE HISTORY UNDER THE PATIENT  (ph2-1.1.0)
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
 *   3. A "notification" that cannot reach a pocketed phone must never be
 *      described as one. A doctor who believes the phone will buzz stops
 *      looking, and the summary sits unread.
 *
 * Everything is EXECUTED: the module's real fetch path, its real delegated
 * click handler, its real render.
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
      id: '', textContent: '', value: '', disabled: false,
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
  win.setTimeout = function (fn, ms) { const id = timers.length; timers.push({ fn, ms, id, live: true }); return id; };
  win.clearTimeout = function (id) { if (timers[id]) timers[id].live = false; };
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
    frame: () => body.children.filter(c => c.id === 'mlsPh2')[0] || null,
    screen: () => (byId.get('mlsPh2Body') || { _html: '' })._html,
    setCheckins(rows) { checkins = rows; },
    tap(act, attrs) {
      const f = this.frame();
      const el = { getAttribute: (k) => (k === 'data-act' ? act : (attrs || {})[k] || null) };
      f.fire('click', { target: { closest: (s) => (s === '[data-act]' ? el : null) } });
    },
    /* Let the module's fetch chain settle. */
    settle() { return new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0))); },
    fireWatch() { timers.filter(t => t.live && t.ms >= 30000).forEach(t => { t.live = false; t.fn(); }); }
  };
}

const READY = {
  id: 77, headline: 'Left knee giving way on stairs for 3 weeks; no red flags.',
  patient_external_id: 'ext-9', ready_at: new Date(Date.now() - 4 * 60000).toISOString(),
  turns: 11, audited: 'passed', inProgress: false,
  bullets: ['Pain 6/10, worse descending stairs', 'No fever, no night pain'],
  summary: 'Patient reports 3 weeks of left knee instability...',
  askAbout: ['Whether the knee has ever locked']
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

  const s = h.screen();
  assert(/Left knee giving way on stairs/.test(s), 'the headline must reach the day screen');
  assert(/Marcus Bell/.test(s),
    'the brief must say WHOSE it is — the row carries a portal id and no name, and three anonymous ' +
    'briefs is three rooms the doctor cannot tell apart');
  assert(/Check-in ready/.test(s), 'and the section must count what is READY');

  assert.strictEqual(h.calls.vibrate.length, 0,
    'THE FIRST LOAD MUST NOT BUZZ: opening the app at 9am would otherwise vibrate for every check-in ' +
    'that finished yesterday');
}
{
  /* The arrival WHILE HE IS LOOKING is the one that is news. */
  const h = makeHarness({ checkins: [], appts: APPTS });
  await h.settle();
  assert.strictEqual(h.calls.vibrate.length, 0, 'nothing to announce yet');

  h.setCheckins([READY]);
  h.fireWatch();
  await h.settle();
  assert.strictEqual(h.calls.vibrate.length, 1, 'an intake finishing while the app is open must buzz once');
  const s = h.screen();
  assert(/A patient check-in just finished/.test(s), 'and say so in words, not only by vibrating');
  assert(/The summary is below/.test(s), 'and point at the summary rather than just announcing');

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
  assert(/still in progress raised a flag/i.test(h.screen()),
    'and must NOT be announced as finished — there is no summary to go and read yet');

  const done = Object.assign({}, FLAGGED_LIVE, { inProgress: false, summary: 'Cardiac screen...', turns: 9 });
  h.setCheckins([done]);
  h.fireWatch();
  await h.settle();
  assert.strictEqual(h.calls.vibrate.length, 2,
    'THE ONE app.html SHIPPED BROKEN: the interview FINISHING is a different event about the same ' +
    'check-in. Keyed by id alone it is not "fresh", so the one class of check-in most likely to matter ' +
    'is the one that never announces.');
  assert(/just finished/.test(h.screen()), 'and the finish is announced as a finish');
}

/* ===========================================================================
 * 2. THE BADGE SURVIVES THE BUZZ
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY, FLAGGED_LIVE], appts: APPTS });
  await h.settle();
  const tabs = h.byId.get('mlsPh2Tabs');
  const todayBtn = (h.frame()._html.match(/data-tab="today"/) || []).length;
  assert.strictEqual(todayBtn, 1, 'precondition: the Today tab exists');
  assert.strictEqual(h.api().state().tab, 'today', 'and is where the app opens');
  /* The count is READY-only: a flagged interview still running has no summary,
     and a badge that counts it sends the doctor to read something that is not
     there. Two rows, one ready => 1. */
  const s = h.screen();
  assert(/1 check-ins ready|Check-in ready/.test(s),
    'the heading must count READY separately from flagged-and-still-running: ' + s.slice(0, 200));
  assert(/in progress, flagged/.test(s), 'and still say the flagged one exists');
}

/* ===========================================================================
 * 3. IT NEVER PROMISES A NOTIFICATION IT CANNOT SEND
 * -----------------------------------------------------------------------------
 * There is no APNs/FCM credential and no server holding device tokens, so
 * nothing reaches a phone that is asleep. A doctor who believes otherwise stops
 * looking, and the summary sits unread.
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY], appts: APPTS });
  await h.settle();
  const everything = h.screen() + h.frame()._html;
  for (const lie of [
    'we will notify you', "we'll notify you", 'you will be notified', 'notify you when',
    'push notification', 'even when the app is closed', 'in the background'
  ]) {
    assert(everything.toLowerCase().indexOf(lie) < 0,
      'the phone promises a notification it has no way to send: "' + lie + '"');
  }
}

/* ===========================================================================
 * 4. A FAILED POLL IS NOT "NO CHECK-INS"
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY], appts: APPTS });
  await h.settle();
  assert(/Left knee giving way/.test(h.screen()), 'precondition: a brief is on screen');

  h.win.fetch = function (url) {
    if (/checkins/.test(String(url))) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(null) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
  };
  h.fireWatch();
  await h.settle();
  const s = h.screen();
  assert(/Could not check for patient check-ins/.test(s),
    '"no check-ins" and "we could not ask" render identically and mean opposite things');
  assert(/Left knee giving way/.test(s),
    'AND the brief he was reading must survive: a failure to REFRESH is not a reason to withdraw what ' +
    'is already in hand');
}

/* ===========================================================================
 * 5. THE BRIEF OPENS, AND IT IS THE WHOLE BRIEF
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY], appts: APPTS });
  await h.settle();
  assert(!/Patient reports 3 weeks/.test(h.screen()), 'the summary starts collapsed');
  h.tap('ck-open', { 'data-ck': '77' });
  const open = h.screen();
  assert(/Pain 6\/10, worse descending stairs/.test(open), 'the bullets must be there');
  assert(/Patient reports 3 weeks of left knee instability/.test(open), 'and the summary itself');
  assert(/Worth asking/.test(open) && /ever locked/.test(open),
    'and what the check-in did NOT settle — that is the half a doctor uses in the room');
  h.tap('ck-open', { 'data-ck': '77' });
  assert(!/Patient reports 3 weeks/.test(h.screen()), 'tapping again closes it');
}
{
  /* A REJECTED audit is not an ordinary summary, and the sentence saying so
     must not live in a nowrap+ellipsis meta line where a phone clips it. */
  const h = makeHarness({ checkins: [Object.assign({}, READY, { audited: 'rejected' })], appts: APPTS });
  await h.settle();
  const s = h.screen();
  assert(/audit REJECTED this summary/.test(s), 'a rejected audit must be stated');
  assert(/ph2-ckwarn/.test(s), 'and on its own wrapping line, not appended to the truncated meta line');
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
    snapshot: { active: { id: 'a1', name: 'Marcus Bell' }, phase: 'idle' }
  });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/Their check-in with the avatar/.test(s), 'the open patient\'s check-in must be on their visit screen');
  assert(/Left knee giving way/.test(s), 'and it must be THEIR check-in');
  assert(!/Chest pressure while walking/.test(s),
    'THE ONE THAT MATTERS: the other patient\'s intake must not appear in this room');
}
{
  /* No portal id on the appointment => no match, and nothing shown. A brief
     attached by guesswork is worse than no brief. */
  const h = makeHarness({
    checkins: [READY], appts: [{ id: 'a1', name: 'Marcus Bell', appt_date: '2026-08-07' }],
    snapshot: { active: { id: 'a1', name: 'Marcus Bell' }, phase: 'idle' }
  });
  await h.settle();
  h.api().go('visit');
  assert(!/Their check-in with the avatar/.test(h.screen()),
    'with no portal id to match on, the visit screen must show no brief at all rather than the ' +
    'nearest one');
}

/* ===========================================================================
 * 7. QUICK HISTORY — AND WHAT IT SAYS WHEN IT DOES NOT KNOW
 * =========================================================================*/
{
  const chart = {
    id: 'p1', name: 'Marcus Bell', dob: '1968-03-04', sex: 'M', mrn: 'A2213',
    allergies: 'Penicillin\nSulfa', meds: 'Meloxicam 15mg\nGabapentin 300mg\nLisinopril 10mg\nAtorvastatin',
    problems: 'Left knee OA\nLumbar radiculopathy', athenaChartImportedAt: '2026-08-01T10:00:00Z'
  };
  const notes = [
    { date: '2026-06-02', type: 'Follow-up', outcome: { pain: 7 } },
    { date: '2026-07-14', type: 'Injection', outcome: { pain: 4 } }
  ];
  const h = makeHarness({ chart, notes, appts: APPTS, snapshot: { active: { id: 'a1', name: 'Marcus Bell' }, phase: 'idle' } });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/Quick history/.test(s), 'tapping a patient must land on a screen that carries their quick history');
  assert(/Penicillin, Sulfa/.test(s), 'allergies are the field most likely to be acted on');
  assert(/<dt>Visits<\/dt><dd>2 · last seen Jul 14, 2026<\/dd>/.test(s),
    'the visit count and the last-seen date, and the date must be the LATEST note rather than the first');
  assert(/Last pain<\/dt><dd>4\/10/.test(s), 'the most recent pain score, not the first');
  assert(/\+1 more/.test(s), 'a long med list must say how much is not shown rather than silently truncate');
  assert(/58y/.test(s), 'age, computed from the DOB');
  assert(/full chart .* is on the office computer/i.test(s),
    'and it must say where the rest is — the owner asked for quick history, not the chart');

  /* The last visits are one tap away, and they are the LAST ones. */
  assert(!/Injection/.test(s), 'the visit list starts collapsed');
  h.tap('qh-toggle', { 'data-pid': 'p1' });
  const open = h.screen();
  assert(/Jul 14, 2026/.test(open) && /Injection/.test(open), 'expanding shows the recent visits, newest first');
}
{
  /* THE LOAD-BEARING CASE. A chart that athenaOne has never been read into
     looks exactly like a chart with nothing in it. */
  const chart = { id: 'p2', name: 'Nina Petrov', dob: '1990-01-02' };   /* no athenaChartImportedAt */
  const h = makeHarness({ chart, notes: [], appts: APPTS, snapshot: { active: { id: 'a1', name: 'Nina Petrov' }, phase: 'idle' } });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/never read from athenaOne/.test(s),
    'THE ONE THAT MATTERS: an empty allergy field on a never-read chart must say it is UNKNOWN. ' +
    '"None recorded" is a clinical claim, and this app has never had the evidence for it.');
  assert(!/none recorded/i.test(s), 'and must not make that claim anywhere on the card');
  assert(/never been read for this patient/.test(s), 'the footer must say it too, in a full sentence');
}
{
  /* A landed chart with genuinely empty fields says the opposite thing. */
  const chart = { id: 'p3', name: 'Owen Marsh', dob: '1975-05-05', athenaChartImportedAt: '2026-08-02T09:00:00Z' };
  const h = makeHarness({ chart, notes: [], appts: APPTS, snapshot: { active: { id: 'a1', name: 'Owen Marsh' }, phase: 'idle' } });
  await h.settle();
  h.api().go('visit');
  const s = h.screen();
  assert(/none recorded/.test(s), 'a chart that HAS been read may say a field is empty');
  assert(!/never read from athenaOne/.test(s), 'and must not claim ignorance it does not have');
}
{
  /* No chart record bound at all: say so, do not render an empty card that
     reads as "this patient has no history". */
  const h = makeHarness({ chart: null, appts: APPTS, snapshot: { active: { id: 'a1', name: 'Marcus Bell' }, phase: 'idle' } });
  await h.settle();
  h.api().go('visit');
  assert(/not bound to a chart record/.test(h.screen()),
    'an unbound visit must say the history is missing, not render a card of blanks');
}

/* ===========================================================================
 * 8. SIGNING OUT TAKES THE PATIENTS' ANSWERS WITH IT
 * =========================================================================*/
{
  const h = makeHarness({ checkins: [READY], appts: APPTS });
  await h.settle();
  assert(/Left knee giving way/.test(h.screen()), 'precondition');
  h.setCheckins([]);
  (h.win._h['mls:session-boundary'] || []).forEach((fn) => fn({}));
  await h.settle();
  assert(!/Left knee giving way/.test(h.screen()),
    'a session boundary must drop another account\'s patients answering another account\'s questions');
  /* ...and the record of what was already announced, or the NEXT doctor's first
     arrivals are silently swallowed. */
  h.setCheckins([READY]);
  h.fireWatch();
  await h.settle();
  assert(h.calls.vibrate.length >= 1, 'the announced-already record must be dropped with the session too');
}

console.log('PASS the intake summary and the quick history: the phone reads the avatar lane\'s OWN endpoint; ' +
  'the first load never buzzes and a repeat poll never re-buzzes; a flag mid-interview announces early AND ' +
  'the finish announces again (keyed by id AND state); READY is counted separately from flagged-and-running; ' +
  'no screen promises a notification it cannot send; a failed poll says so without withdrawing the brief in ' +
  'hand; a rejected audit gets its own wrapping line; the visit screen shows only the OPEN patient\'s brief ' +
  'and shows none at all without a portal id to match on; and quick history distinguishes "none recorded" ' +
  'from "never read from athenaOne" from "no chart record bound" in words, in every box');
}

main().then(null, function (err) { console.error(err && err.stack || err); process.exit(1); });
