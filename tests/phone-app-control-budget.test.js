'use strict';

/* "Very little buttons" — the owner's actual words — made enforceable.
 *
 * A minimal app does not stay minimal by intention. Every future request will
 * be for one more control, each individually reasonable, and eighteen months
 * later it is the crowded phone screen PHONE_AUDIT_2026-07-27.md was written
 * about. So the budget is a number, the number is checked, and raising it is a
 * deliberate edit to this file with a reason next to it.
 *
 * TEN controls. What each one is for:
 *
 *   1  emailInput     sign in
 *   2  pwInput        sign in
 *   3  totpInput      sign in, only when the account has 2FA
 *   4  goBtn          THE action. Sign in / Pull today / Pull chart — one dock
 *                     button whose label is whatever this screen's verb is.
 *   5  backBtn        leave a patient
 *   6  outBtn         sign out
 *   7  findInput      find a patient who is not on today's list
 *   8  .row (tap)     open a patient. One class, any number of patients.
 *
 * Plus two gestures that deliberately have NO button: pull-to-refresh, and
 * scrolling. The dock shows at most ONE button at a time, which is the property
 * that actually makes the screen feel empty.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.resolve(__dirname, '..', 'app.html'), 'utf8');
const BODY = APP.slice(APP.indexOf('<body>'), APP.indexOf('<script>', APP.indexOf('<body>')));

/* ---------- 1. the static markup declares exactly the budgeted controls --- */
const BUDGET = [
  'emailInput', 'pwInput', 'totpInput',
  'goBtn', 'backBtn', 'outBtn', 'findInput',
  /* 9  dayInput  phday-1.0.0 (2026-08-27). Serves the FIRST verb - "pull today"
   *              - by letting it mean a day other than today. S.date was
   *              initialised to todayISO() and then read in five places and
   *              written in none, so this app could only ever show the current
   *              day: a doctor who opened it on Wednesday could not reach
   *              Monday's visit at all. refreshToday() has always carried a
   *              staleness guard for a day that "moved under us", so the day
   *              was designed to move and the control was simply never built.
   *              Deliberately ONE control, not three: prev / next /
   *              back-to-today would have raised this app's whole control count
   *              by 43% to do what one native date field does in one field -
   *              and it brings the iOS date wheel with it, so there is nothing
   *              to learn and no way back to today needed. */
  'dayInput',
];

const declared = [...BODY.matchAll(/<(button|input|select|textarea|a)\b[^>]*>/gi)].map((m) => {
  const tag = m[0];
  const id = (tag.match(/\bid="([^"]+)"/) || [])[1] || '';
  return { tag: m[1].toLowerCase(), id, raw: tag };
});

const interactive = declared.filter((d) => d.tag !== 'a');
const ids = interactive.map((d) => d.id);

assert.deepStrictEqual(
  ids.slice().sort(),
  BUDGET.slice().sort(),
  'the phone app\'s control budget changed.\n' +
  '  found:    ' + JSON.stringify(ids.sort()) + '\n' +
  '  budgeted: ' + JSON.stringify(BUDGET.slice().sort()) + '\n' +
  'Adding a control to this app is allowed — but do it by editing the budget\n' +
  'in this file and writing down which of the two verbs it serves.'
);

assert.strictEqual(interactive.length, BUDGET.length,
  'an interactive element was added without an id — every control must be nameable');

/* Links are allowed but only for the two legal documents, and only on the
   signed-out screen. A link into the app is a control wearing a disguise. */
const links = declared.filter((d) => d.tag === 'a');
const hrefs = links.map((l) => (l.raw.match(/href="([^"]+)"/) || [])[1]);
assert.deepStrictEqual(hrefs.sort(), ['privacy.html', 'terms.html'],
  'app.html links somewhere other than Privacy and Terms: ' + JSON.stringify(hrefs));

/* ---------- 2. rows are the only dynamically-created control ------------- */
{
  /* listCard() is the single row factory, and it makes a <button> ONLY when the
     row does something. A visit row that looks pressable and is not is exactly
     the kind of dead control this app exists to avoid. */
  const factory = APP.slice(APP.indexOf('function listCard'), APP.indexOf('function firstName'));
  assert.ok(/if \(it\.onTap\)\{ r = el\('button','row'\)/.test(factory),
    'listCard no longer decides button-vs-div on whether the row does anything');
  assert.ok(/else \{ r = el\('div','row'\); \}/.test(factory),
    'a row with no action must be a div, not a disabled-looking button');

  /* And it is the ONLY place a button is created at runtime. */
  const created = [...APP.matchAll(/el\(\s*'button'/g)];
  assert.strictEqual(created.length, 1,
    'more than one place creates a button at runtime — rows must be the only dynamic control');
}

/* ---------- 3. the dock offers at most ONE action at a time ------------- */
{
  /* The dock markup holds one note and one button. Two primary buttons on a
     phone screen is the start of a toolbar. */
  const dock = BODY.slice(BODY.indexOf('<div id="dock">'), BODY.indexOf('</div></div>', BODY.indexOf('<div id="dock">')));
  const dockButtons = [...dock.matchAll(/<button/g)];
  assert.strictEqual(dockButtons.length, 1, 'the dock has more than one button');

  /* Its label is derived per screen, never a second element. */
  for (const verb of ['Sign in', 'Pull today', 'Pull chart']) {
    assert.ok(APP.includes(`'${verb}'`) || APP.includes(`: '${verb}'`) || APP.includes(`? '` ) ,
      `the dock button never says "${verb}"`);
  }
  assert.ok(/'Pull today'/.test(APP) && /'Pull chart'/.test(APP) && /'Sign in'/.test(APP),
    'the three dock verbs are not all present');
}

/* ---------- 4. two gestures replace the buttons that would have existed -- */
{
  assert.ok(/touchstart/.test(APP) && /touchmove/.test(APP) && /touchend/.test(APP),
    'pull-to-refresh is gone — refresh would need a button, and that is a control');
  assert.ok(/id="ptr"/.test(APP), 'the pull-to-refresh indicator is missing');
  /* Refresh must work on BOTH list screens, or one of them grows a button. */
  const ptr = APP.slice(APP.indexOf("scroller.addEventListener('touchend'"), APP.length);
  assert.ok(/S\.screen === 'patient'\) \? loadVisits\(\)/.test(ptr),
    'pull-to-refresh does not re-read the chart on the patient screen');
  assert.ok(/runFind\(S\.find\) : refreshToday\(\)/.test(ptr),
    'pull-to-refresh does not re-run the current search / day on the today screen');
}

/* ---------- 5. every control is thumb-sized ----------------------------- */
{
  /* Apple asks for 44pt, Android for 48dp. Take the larger. */
  assert.ok(/--tap:48px/.test(APP), 'the tap-target token is gone');
  assert.ok(/min-height:var\(--tap\)/.test(APP), '.row does not use the tap-target token');
  for (const [sel, min] of [['.primary', 54], ['.field input', 52], ['.find input', 46]]) {
    const rule = APP.slice(APP.indexOf(sel + '{'), APP.indexOf('}', APP.indexOf(sel + '{')));
    const m = rule.match(/min-height:(\d+)px/);
    assert.ok(m && Number(m[1]) >= min,
      `${sel} min-height is ${m ? m[1] : 'unset'}px — must be at least ${min}px`);
  }
  const hbtn = APP.slice(APP.indexOf('.hbtn{'), APP.indexOf('}', APP.indexOf('.hbtn{')));
  assert.ok(/width:38px;height:38px/.test(hbtn),
    'header buttons changed size — 38px plus the header padding is what keeps them a 44pt target');
}

console.log('phone-app-control-budget.test.js: OK — 7 declared controls + 1 row class, one dock button, 2 legal links, refresh is a gesture');
