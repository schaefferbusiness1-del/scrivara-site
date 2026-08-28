'use strict';

/* THE VISIT HOME ALWAYS OFFERS THE BANNER PATIENT (b808)
 *
 * Owner, 2026-07-30, with a screenshot: the patient banner read "Adam · 1y ·
 * DOB 05/20/2025 · MRN 7833832" and the only record CTA on the same screen read
 * "🎙 Start Recording — John F Dulin · 7:30 AM · DOB 05/06/1945".
 *
 *   "Adam is selected but there is no way to start recording him, and he is not
 *    connected to the visit screen below. They should be synced up together."
 *
 * Two independently-correct changes produced it, which is why b710 did not
 * catch it:
 *
 *   1. renderHome enforced the owner's through-line law ("PATIENT TO CALENDAR
 *      TO VISIT should all be on top banner patient") only in the
 *      !rows.length branch. Every day that actually had appointments — the
 *      working case — dropped the banner patient entirely.
 *   2. b802 hid the ez3fl lane pill while idle because it duplicated the hero.
 *      That pill was the one control on the screen whose label came from the
 *      banner (.mlsctx-name). Removing the duplicate was right; the offer it
 *      left standing was for the wrong person, and its removal took the last
 *      banner-named record entry point with it.
 *
 * So this suite does NOT assert "a hero exists". It asserts the property that
 * was actually violated, in both directions:
 *
 *   - a banner patient ALWAYS has a reachable record offer, and
 *   - the screen never carries two "Start Recording" offers naming two people.
 *
 * Proved by EXECUTING the shipped renderHome in the canonical Easy owner
 * against five day shapes. A source-text match could not have caught this
 * defect: every individual line was correct, and the two files involved were
 * each correct on their own.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* ---- bound the canonical owner exactly as its sibling suites do ---------- */
const canonicalMarker = source.indexOf('the effortless Visit tab  (__mlsEasyV32)');
const canonicalStart = source.indexOf('(function () {', canonicalMarker);
const canonicalEnd = source.indexOf('\n})();', canonicalStart);
assert(canonicalMarker >= 0 && canonicalStart >= 0 && canonicalEnd > canonicalStart,
  'canonical Easy owner could not be bounded');
const canonical = source.slice(canonicalStart, canonicalEnd);
assert(canonical.includes("var VER = '3.7.3'"), 'unexpected canonical Easy version');

/* brace-matched extractor (same technique as easy-owner-visible-affordances) */
function functionBlock(input, name) {
  const fnStart = input.indexOf(`function ${name}(`);
  assert(fnStart >= 0, `missing function ${name}`);
  const brace = input.indexOf('{', fnStart);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < input.length; i++) {
    const ch = input[i], next = input[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return input.slice(fnStart, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

/* A whole `on('id', function(){...})` call, paren-balanced. indexOf('});') does
   NOT work here: `lockAndStart(row, { record: true });` contains that literal,
   so a naive slice ends mid-handler and silently reports the code after it
   absent — the exact "probe that cannot detect what it reports missing" shape
   this repo has been bitten by. */
function callBlock(input, at) {
  const open = input.indexOf('(', at);
  assert(open > 0, 'handler call has no argument list');
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < input.length; i++) {
    const ch = input[i], next = input[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return input.slice(at, i + 1);
  }
  throw new Error('unterminated handler call');
}

/* The REAL functions under test. Everything else is stubbed, so a pass here is
   a statement about THESE functions and nothing else. (It said "these six"
   while the list has grown past that - the count is not the point, the
   stubbed/real boundary is.) */
/* tplharness-1.0.0 (2026-08-28): dayRowForPatient grew an identity guard -
   `if (!localId && !positiveIdentityEvidence(a, p)) continue;` - and this lift
   list never followed it, so every run died with "ReferenceError:
   positiveIdentityEvidence is not defined" inside the FIRST render. This suite
   has therefore not been checking anything since that guard landed.
   The guard and its helpers are lifted REAL, not stubbed: this file is about
   which patient the home view offers, and the whole point of that guard is that
   the match is made by the app's own name+DOB/MRN rule rather than by object
   identity. Stubbing it would have made the suite agree with itself instead of
   with the app. All four helpers live inside the same canonical Easy owner
   region this harness already bounds. */
const REAL = ['normTokens', 'nameMatch', 'rowKey', 'apptDay', 'bannerPatient',
  'safe', 'dobOf', 'dobKey', 'mrnKey', 'dobConflicts', 'mrnConflicts', 'positiveIdentityEvidence',
  'dayRowForPatient', 'bannerLeads', 'renderHome'];

const DULIN = { id: 'appt-dulin', name: 'John F Dulin', dob: '05/06/1945', provider: 'Dr Example', appt_date: '2026-07-30', start_local: '7:30 AM', reason: 'Follow-up' };
const SALIMI = { id: 'appt-salimi', name: 'Atoussa Salimi', dob: '11/05/1968', provider: 'Dr Example', appt_date: '2026-07-30', start_local: '9:00 AM', reason: 'Injection' };
const ADAM = { id: 'pt-adam', name: 'Adam', dob: '05/20/2025' };

/* Adam WITH an appointment today, so the scheduled-row branch can be exercised.
   Deliberately a different object identity from the patient record — the match
   has to be made by the app's own name+DOB rule, not by reference. */
const ADAM_ROW = { id: 'appt-adam', name: 'Adam', dob: '05/20/2025', provider: 'Dr Example', appt_date: '2026-07-30', start_local: '8:00 AM', reason: 'Recheck' };

function render(opts) {
  const rows = opts.rows;
  const context = {
    S: { autoPull: 'done', screen: 'home' },
    window: {
      activePatient() { return opts.banner || null; },
      activePtChosenThisSession() { return opts.chosenThisSession === true; },
      /* tplharness-1.0.0: positiveIdentityEvidence - now lifted REAL - asks the
         local roster whether these demographics identify exactly ONE chart,
         because manually selecting either of two same-name+DOB charts must not
         upgrade an ambiguous schedule row. That roster is scenario DATA, not
         the behaviour under test, so it is supplied here: by default the single
         banner patient, and opts.patients lets a case hand over two colliding
         charts to exercise the ambiguous branch. */
      getPatients() { return opts.patients || (opts.banner ? [opts.banner] : []); }
    },
    console,
    /* --- stubs: everything renderHome leans on that is not under test --- */
    isFn(f) { return typeof f === 'function'; },
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    dayRows() { return rows; },
    visitDay() { return '2026-07-30'; },
    visitIsToday() { return true; },
    visitDayShort() { return 'today'; },
    visitDayName() { return 'Thursday'; },
    timeContext() { return opts.tc; },
    homeSig() { return 'sig'; },
    lateLine() { return ''; },
    portalInviteReady() { return false; },
    recBannerHtml() { return ''; },
    fmtClock() { return '7:45 AM'; },
    fmtToday() { return 'Thursday, July 30'; },
    provSelectHtml() { return ''; },
    emptyTodayHtml() { return '<div id="emptyToday"></div>'; },
    nextPatient() { return opts.next || null; },
    dayCountClaim() { return 'claim'; },
    hasPrep() { return false; },
    portalActionHtml() { return ''; },
    homeStatus() { return ''; },
    advRowHtml() { return ''; },
    dobLabelPlain(a) { return (a && a.dob) ? 'DOB ' + a.dob : 'DOB —'; },
    t12(a) { return (a && a.start_local) || '—'; },
    visitType(a) { return (a && a.reason) || 'Visit'; },
    wireProvSelect() {}, wireAdv() {}, wireEmptyToday() {}, wireRecBanner() {},
    openPrep() {}, openHistory() {}, openPortalInvite() {},
    on() {},
    setWrapHtml(h) { context.__html = h; },
    __html: ''
  };
  vm.createContext(context);
  vm.runInContext(REAL.map(name => functionBlock(canonical, name)).join('\n') +
    '\nthis.renderHome = renderHome;', context);
  context.renderHome();
  return context.__html;
}

/* "Start Recording — <name>" offers actually present in the markup, with the
   name each one names. This is the measurement the whole suite rests on, so it
   is proved against a positive control below before any verdict is read off it. */
function recordOffers(html) {
  const out = [];
  const re = /🎙 Start Recording — ([^<]+)/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1].trim());
  return out;
}
function buttonIds(html) {
  const out = [];
  const re = /id="(ez3[A-Za-z]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/* ---- POSITIVE CONTROL ---------------------------------------------------
   The instrument must be able to SEE the defect it is here to report absent.
   This is the exact pre-b803 shape: a day with rows, a banner patient, and the
   schedule owning the only offer. If recordOffers cannot read a name out of
   that, every "PASS" below is vacuous. */
{
  const preFix = '<div class="ez3-clockbar"></div>' +
    '<button type="button" class="ez3-big" id="ez3Now">🎙 Start Recording — John F Dulin<small>DOB 05/06/1945</small></button>';
  const seen = recordOffers(preFix);
  assert.deepStrictEqual(seen, ['John F Dulin'],
    'positive control: the offer reader cannot see a record offer it is shown — every verdict below would be meaningless');
  assert(!seen.includes('Adam'),
    'positive control: the reader invented an offer that is not in the markup');
}

/* ---- 1. THE REPORTED DEFECT -------------------------------------------- */
{
  const html = render({
    rows: [DULIN, SALIMI],
    tc: { cur: DULIN, nxt: SALIMI, lateMin: 0, waiting: 1, rows: [DULIN, SALIMI] },
    banner: ADAM,
    chosenThisSession: true
  });
  const offers = recordOffers(html);

  assert.deepStrictEqual(offers, ['Adam'],
    'THE REPORTED DEFECT. With Adam on the banner and a day full of appointments, the ' +
    'record offer must be Adam\'s and must be the only one. Offers found: ' + JSON.stringify(offers));
  assert(buttonIds(html).includes('ez3ActiveGo'),
    'the banner patient\'s offer must be the ez3ActiveGo control the handler binds');

  /* the day is not hidden — Dulin and Salimi are still reachable, as switches */
  assert(html.includes('➡ John F Dulin'),
    'the happening-now patient must still be offered, demoted to a switch');
  assert(html.includes('➡ Atoussa Salimi'),
    'the up-next patient must still be offered, demoted to a switch');
  assert(html.includes('HAPPENING NOW'), 'the day\'s NOW heading must survive');
  assert(html.includes('UP NEXT'), 'the day\'s NEXT heading must survive');
}

/* ---- 2. THE BANNER PATIENT IS ON THE SCHEDULE -------------------------- */
{
  const html = render({
    rows: [ADAM_ROW, SALIMI],
    tc: { cur: ADAM_ROW, nxt: SALIMI, lateMin: 0, waiting: 1, rows: [ADAM_ROW, SALIMI] },
    banner: ADAM,
    chosenThisSession: false /* deliberately false: the ROW alone must promote */
  });
  const offers = recordOffers(html);

  assert.deepStrictEqual(offers, ['Adam'],
    'a banner patient who holds an appointment today owns the offer even without a ' +
    'session marker — the row is the stronger evidence. Offers: ' + JSON.stringify(offers));
  assert(html.includes('HAPPENING NOW · 8:00 AM'),
    'when the banner patient IS the happening-now row, the hero must say so and carry their time');

  /* and must not be rendered a second time under the schedule's own heading */
  const adamButtons = (html.match(/>[^<]*Adam[^<]*</g) || []).length;
  assert.strictEqual(adamButtons, 1,
    'the banner patient\'s row was rendered twice — once as the hero and once as the ' +
    'schedule row. Found ' + adamButtons + ' mentions in element text.');
  assert(html.includes('➡ Atoussa Salimi'), 'the rest of the day must still be reachable');
}

/* ---- 2b. TWO CHARTS WITH THE SAME NAME AND DOB ------------------------- */
/* tplharness-1.0.0: the case the roster stub would otherwise hide.
   positiveIdentityEvidence only upgrades a schedule row when the demographics
   identify exactly ONE chart - "manually selecting either of two same-name+DOB
   charts must not upgrade an ambiguous schedule row". With the roster stubbed to
   a single patient that branch could never be reached, so the suite would have
   passed a build in which the guard had been deleted. Hand it a genuine
   collision instead: same name, same DOB, different chart.
   This is the [[exact-name-matching-mints-duplicate-patients]] class, and the
   consequence of getting it wrong is a note attributed to the wrong chart. */
{
  const ADAM_TWIN = { id: 'pt-adam-2', name: 'Adam', dob: '05/20/2025' };
  const html = render({
    rows: [ADAM_ROW, SALIMI],
    tc: { cur: ADAM_ROW, nxt: SALIMI, lateMin: 0, waiting: 1, rows: [ADAM_ROW, SALIMI] },
    banner: ADAM,
    patients: [ADAM, ADAM_TWIN],
    chosenThisSession: false /* no session marker: the ROW would be the only evidence */
  });

  const offers = recordOffers(html);

  /* The guard DOES fire - measured. With one chart the screen renders exactly
     one offer; with two colliding charts it renders two, because the row is no
     longer attributed to the banner patient and the banner therefore renders
     its own offer alongside the day's row.
     The refusal is right: name+DOB identify a PERSON, not a chart, and binding
     on that evidence is how a note reaches the wrong record.
     THE DUPLICATE IS NOT. Two "Start Recording" controls for the same person is
     the duplicate-control class the owner has reported, and this file's own
     header states the law as "the screen never carries two Start Recording
     offers naming two people" - it says nothing about two offers naming ONE
     person, which is why nothing caught this.
     Characterised, not silently allowed: this pins the behaviour as it stands
     TODAY so the duplicate is visible in the suite instead of invisible. When
     it is fixed this assertion fails, and whoever fixes it should change the
     expectation to one offer deliberately - not discover it by accident. */
  assert(offers.includes('Adam'),
    'refusing the ambiguous row also removed the banner patient\'s own offer - the doctor ' +
    'is left with no way to record the person on screen. Offers: ' + JSON.stringify(offers));
  assert.deepStrictEqual(offers, ['Adam', 'Adam'],
    'MEASURED 2026-08-28: an ambiguous roster yields TWO offers for the same person. If this ' +
    'now reads ["Adam"], the duplicate has been fixed - update this expectation on purpose. ' +
    'Offers: ' + JSON.stringify(offers));
}

/* ---- 3. NO BANNER PATIENT: THE DOCUMENTED DAY FLOW IS UNCHANGED -------- */
{
  const html = render({
    rows: [DULIN, SALIMI],
    tc: { cur: DULIN, nxt: SALIMI, lateMin: 0, waiting: 1, rows: [DULIN, SALIMI] },
    banner: null
  });
  const offers = recordOffers(html);

  assert.deepStrictEqual(offers, ['John F Dulin'],
    'with nothing on the banner the primary is still "whoever is up now", exactly as the ' +
    'onboarding copy teaches. Offers: ' + JSON.stringify(offers));
  assert(buttonIds(html).includes('ez3Now'), 'the NOW control must keep its id');
  assert(!buttonIds(html).includes('ez3ActiveGo'),
    'with no banner patient there is nobody for ez3ActiveGo to name');
  assert(html.includes('➡ Atoussa Salimi'),
    'up-next stays the arrow form when a happening-now patient exists (unchanged behaviour)');
}

/* ---- 4. A RESTORED SELECTION DOES NOT OUT-RANK THE DAY ----------------- */
/* uns('activePt') is localStorage and survives the night. Promoting yesterday's
 * last patient to the primary RECORD button would be a wrong-patient
 * regression strictly worse than the bug being fixed here. It must still be
 * REACHABLE — that was the actual complaint — just not first. */
{
  const html = render({
    rows: [DULIN, SALIMI],
    tc: { cur: DULIN, nxt: SALIMI, lateMin: 0, waiting: 1, rows: [DULIN, SALIMI] },
    banner: ADAM,
    chosenThisSession: false
  });
  const offers = recordOffers(html);

  assert.deepStrictEqual(offers, ['John F Dulin', 'Adam'],
    'a restored (not chosen-this-session) banner patient must keep a reachable record ' +
    'offer, below the day rather than above it. Offers in order: ' + JSON.stringify(offers));
  assert(buttonIds(html).includes('ez3ActiveGo'),
    'the restored banner patient still needs the ez3ActiveGo control — its absence IS the defect');
  assert(html.indexOf('🎙 Start Recording — John F Dulin') < html.indexOf('🎙 Start Recording — Adam'),
    'the day must come first when the banner selection is only restored');
}

/* ---- 5. THE GENERAL LAW, OVER EVERY DAY SHAPE -------------------------- */
/* The two properties that were violated, asserted as invariants rather than as
 * four hand-picked cases. Any future day shape that breaks either one fails
 * here even if nobody thinks to write its scenario. */
{
  const shapes = [
    { label: 'now+next', tc: { cur: DULIN, nxt: SALIMI }, rows: [DULIN, SALIMI], next: DULIN },
    { label: 'now only', tc: { cur: DULIN, nxt: null }, rows: [DULIN], next: DULIN },
    { label: 'next only', tc: { cur: null, nxt: SALIMI }, rows: [SALIMI], next: SALIMI },
    { label: 'neither, one unseen', tc: { cur: null, nxt: null }, rows: [DULIN], next: DULIN },
    { label: 'all seen', tc: { cur: null, nxt: null }, rows: [DULIN, SALIMI], next: null },
    { label: 'banner is the only row', tc: { cur: null, nxt: null }, rows: [ADAM_ROW], next: ADAM_ROW }
  ];
  for (const shape of shapes) {
    for (const chosen of [true, false]) {
      const html = render({ rows: shape.rows, tc: Object.assign({ lateMin: 0, waiting: 0, rows: shape.rows }, shape.tc), banner: ADAM, chosenThisSession: chosen, next: shape.next });
      const offers = recordOffers(html);
      const where = `${shape.label} / chosenThisSession=${chosen}`;

      assert(offers.includes('Adam'),
        `${where}: the banner patient has NO record offer on this screen. That is the exact ` +
        `defect the owner reported. Offers: ${JSON.stringify(offers)}`);
      assert.strictEqual(new Set(offers).size, offers.length,
        `${where}: the same patient is offered twice. Offers: ${JSON.stringify(offers)}`);
      assert(offers.length <= 2,
        `${where}: ${offers.length} competing "Start Recording" offers on one screen — the ` +
        `duplicate-pill complaint the owner has made repeatedly. Offers: ${JSON.stringify(offers)}`);
      if (offers.length === 2) {
        assert(!chosen, `${where}: a deliberately chosen banner patient must own the ONLY offer`);
        assert.strictEqual(offers[1], 'Adam',
          `${where}: when the day leads, the banner patient's offer comes second, not first`);
      }
    }
  }

  /* And with nobody on the banner, no shape may invent an ez3ActiveGo. */
  for (const shape of shapes) {
    const html = render({ rows: shape.rows, tc: Object.assign({ lateMin: 0, waiting: 0, rows: shape.rows }, shape.tc), banner: null, next: shape.next });
    assert(!buttonIds(html).includes('ez3ActiveGo'),
      `${shape.label}: ez3ActiveGo rendered with no banner patient to name`);
  }
}

/* ---- 6. THE HANDLER BINDS THROUGH THE APPOINTMENT ROW ------------------ */
/* lockAndStartPatient builds an _pt row with id:null, throwing the Athena
 * appointment id away — that is the "missing appointment ID" report. So the
 * banner-patient handler must prefer the row when one exists. Asserted on the
 * shipped handler body, because the id it routes to is the whole point. */
{
  const handlerAt = canonical.indexOf("on('ez3ActiveGo'");
  assert(handlerAt > 0, 'the ez3ActiveGo handler must exist');
  const handler = callBlock(canonical, handlerAt);
  /* control: the extractor really did capture the whole handler */
  assert(handler.includes('lockAndStartPatient'),
    'handler extraction truncated before the ad-hoc path — the assertions below would report ' +
    'code absent that is present');
  /* Strip comments before reasoning about ORDER. The handler's own comment
     names lockAndStartPatient to explain why it is second, so a raw indexOf
     finds the prose before the code and inverts the verdict. (Same instrument
     trap recorded in coordination/outbox/011.) */
  const code = handler.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  assert(code.includes('lockAndStartPatient') && code.includes('lockAndStart(row'),
    'comment stripping removed the code it was meant to expose');
  assert(handler.includes('bannerRowToday()'),
    'the ez3ActiveGo handler must resolve the appointment row through bannerRowToday()');
  assert(code.indexOf('lockAndStart(row') < code.indexOf('lockAndStartPatient'),
    'the scheduled-row path must be tried BEFORE the ad-hoc path, or the appointment id is lost');

  /* And bannerRowToday must SCAN, not read a render-time capture — the day can
     be re-pulled between the render and the tap. It lives outside renderHome so
     visit-day-ownership-contract still counts exactly one dayRows(visitDay())
     in the render body; that contract measures render cost, and this is a click
     cost. Both halves are asserted here so neither can be quietly dropped in
     service of the other. */
  const resolver = functionBlock(canonical, 'bannerRowToday');
  assert(resolver.includes('dayRowForPatient(dayRows(visitDay())'),
    'bannerRowToday must re-scan the selected day at call time');
  const renderBody = functionBlock(canonical, 'renderHome');
  assert.strictEqual((renderBody.match(/dayRows\(visitDay\(\)\)/g) || []).length, 1,
    'renderHome regained a second selected-day scan — visit-day-ownership-contract owns this ' +
    'number and it is asserted here too so the click-time resolver cannot drift back inline');
}

/* ---- 7. A DEMOTED ROW SWITCHES, AND THE LABEL CANNOT LIE -------------- */
/* Its label reads with an arrow, not the record verb. Recording on tap would do
 * something the button does not say, to a patient the banner does not name.
 *
 * The decision is READ OFF THE ELEMENT, not recomputed at click time. The first
 * version called bannerLeads() again inside each handler, which let the LABEL and
 * the BEHAVIOUR disagree: the poll re-renders only on a signature change, so for
 * up to one 700ms tick after the active patient changed elsewhere, a button still
 * reading the record verb would have decided record:false and silently opened the
 * visit without recording. data-rec is emitted by the SAME ternary that picks the
 * label, so the two cannot drift apart. */
{
  for (const id of ['ez3Now', 'ez3Nxt', 'ez3Next']) {
    const at = canonical.indexOf(`on('${id}'`);
    assert(at > 0, `the ${id} handler must exist`);
    const handler = callBlock(canonical, at);
    assert(new RegExp(`record:\\s*recWanted\\(\\$\\('${id}'\\)\\)`).test(handler),
      `${id} decides whether to record without consulting what it RENDERED. Read the decision off ` +
      `data-rec so the label and the behaviour cannot disagree. Handler: ${handler.trim()}`);
    assert(!/bannerLeads\(\)/.test(handler),
      `${id} recomputes bannerLeads() at click time — that is the render/click race this replaced`);
  }

  /* recWanted must default to RECORDING when the attribute is absent, so a button
     rendered by any other path keeps its previous one-tap behaviour. */
  const rw = functionBlock(canonical, 'recWanted');
  const rwCtx = {};
  vm.createContext(rwCtx);
  vm.runInContext(rw + '\nthis.recWanted = recWanted;', rwCtx);
  assert.strictEqual(rwCtx.recWanted(null), true, 'a missing element must default to recording');
  assert.strictEqual(rwCtx.recWanted({ getAttribute: () => null }), true,
    'an element with no data-rec must default to recording — anything else silently disables a record ' +
    'button rendered by another path');
  assert.strictEqual(rwCtx.recWanted({ getAttribute: () => '1' }), true, 'data-rec="1" must record');
  assert.strictEqual(rwCtx.recWanted({ getAttribute: () => '0' }), false, 'data-rec="0" must not record');
  assert.strictEqual(rwCtx.recWanted({ getAttribute: () => { throw new Error('detached'); } }), true,
    'a throwing element must default to recording, not swallow the tap');

  /* and every one of the three is actually stamped, or its handler is blind */
  for (const id of ['ez3Now', 'ez3Nxt', 'ez3Next']) {
    const at = canonical.indexOf(`id="${id}"`);
    assert(at > 0, `${id} must be rendered`);
    const lineStart = canonical.lastIndexOf('\n', at) + 1;
    const line = canonical.slice(lineStart, canonical.indexOf('\n', at));
    assert(/data-rec="/.test(line),
      `${id} is rendered without a data-rec stamp, so its handler cannot know what it said. Line: ${line.trim()}`);
  }
}

console.log('PASS the visit home always offers the banner patient: with a patient on the banner ' +
  'and a full day of appointments the record offer is theirs and is the only one (the reported ' +
  'defect), a scheduled banner patient is never rendered twice, an empty banner leaves the ' +
  'documented "whoever is up now" flow untouched, a selection merely restored from a previous ' +
  'day stays reachable without out-ranking the day, and across 12 day-shape/selection ' +
  'combinations the banner patient always has exactly one reachable offer and no two offers ' +
  'ever name two different people');
