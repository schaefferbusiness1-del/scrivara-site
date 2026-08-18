'use strict';

/* /1p UI SHAPE CONTRACT
 *
 * The owner's standing UI complaints, expressed as properties a machine can
 * check, so they cannot silently come back:
 *
 *   1. The guided ring lights exactly ONE VISIBLE next step on every screen -
 *      in EVERY mode (nextglow-1.0.0 owns it; msl-1.0.0's guided-only ring is retired).
 *   2. The three modes are reachable without opening Settings, and the
 *      Settings field is BUILT by the msl block rather than living in the
 *      shell's markup (so promoting the block carries its own switch).
 *   3. No horizontal document overflow at any width 320 -> 2560.
 *   4. At most ONE visible "Pull" control per screen.
 *   5. No developer language in anything a physician can read.
 *   6. Every control is reachable: nothing sits outside the viewport unless
 *      its own container scrolls.
 *   7. The day being drafted is visible in the op-note room in EVERY mode.
 *   8. Date-key regexes actually contain backslashes.
 *   9. No two visible controls on Analysis at 360 carry the same name.
 *  10. The Analysis scope chip is at least 12px — and did not grow its row.
 *  11. The op-note room's typed controls are 40px tap targets at 360.
 *  12. The ONE appointment clock still owns the four TZ hooks after the shared
 *      assistant module has actually loaded on the page.
 *
 * PART 1 is static (both twins, no browser). PART 2 drives the real shell in
 * real Chrome with a synthetic 28-patient day - no login, no network, no PHI.
 *
 * Why real Chrome: the repo has no ms-playwright browser bundle, and every
 * other runtime suite here launches `channel:'chrome'`. Why a served page
 * rather than file://: the shell's module loader and CSP both need an origin.
 *
 * THE TRAP THIS SUITE EXISTS TO AVOID. 1p-mls-connect.js - and with it all 219
 * feature modules, the dock, and the op-note room - is NOT loaded by the page
 * on its own. It rides a gate that only a login normally opens. A measurement
 * taken without calling window.__mlsEnsureUiBundle() is a measurement of a
 * bare shell with none of its features present, and will happily report that
 * everything is fine.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
const measured = {};   /* numbers this run actually saw, printed at the end */
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* Every delimited block this suite owns, in one list, so adding one cannot
   leave its neighbours' checks behind. msl-1.0.0 is excluded from the
   lane-neutrality sweep only because it nests msl-today-1.0.0 inside it. */
const BLOCKS = [
  ['<!-- ===== msl-1.0.0', '<!-- ===== end msl-1.0.0'],
  ['<!-- ===== msl-fit-1.1.0', '<!-- ===== end msl-fit-1.1.0'],
  ['<!-- ===== dock-1p-1.1.0', '<!-- ===== end dock-1p-1.1.0'],
  ['<!-- ===== opnote-open-1.2.0', '<!-- ===== end opnote-open-1.2.0'],
  ['<!-- ===== opnote-vocab-1.0.0', '<!-- ===== end opnote-vocab-1.0.0'],
  /* PIN MOVED 2026-08-18 (op-notes lane): opnote-day-2.0.0 was REPLACED by
     opnote-day-3.0.0 on the owner's order — "that LEFT SIDE SELECTOR THING was
     great, add it back". 2.0.0's single column (a list OR one patient) is the
     shape he rejected; 3.0.0 is the rail + the pane, always both.
     PIN MOVED AGAIN, same day: "completely redo the op notes UI, I hate it".
     opnote-day-4.0.0 keeps 3.0.0's rail+pane geometry (it is the shape he asked
     for by name) and rebuilds the surface — the patient rows, the note header
     and action bar, the status vocabulary, and a pointer route back to the day.
     Only the NAME moved in this table; every property below is unchanged. */
  ['<!-- ===== opnote-day-4.0.0', '<!-- ===== end opnote-day-4.0.0'],
  ['<!-- ===== view-hold-1.0.0', '<!-- ===== end view-hold-1.0.0'],
  ['<!-- ===== note-model-1.1.0', '<!-- ===== end note-model-1.1.0']
];

/* ============================================================ PART 1: static */

for (const name of SHELLS) {
  const src = read(name);

  /* -- the blocks exist, exactly once, and are delimited so promotion is a
        copy rather than a diff-hunt -------------------------------------- */
  for (const [open, close] of BLOCKS) {
    eq(src.split(open).length - 1, 1, `${name}: ${open} must open exactly once`);
    eq(src.split(close).length - 1, 1, `${name}: ${close} must close exactly once`);
    ok(src.indexOf(open) < src.indexOf(close), `${name}: ${open} closes before it opens`);
  }
  /* A superseded version number must not survive anywhere in the shell: two
     copies of one block is the shape that ships a fix and its own regression
     together. */
  for (const dead of ['dock-1p-1.0.0', 'opnote-open-1.0.0', 'opnote-open-1.1.0', 'note-model-1.0.0',
    'opnote-day-1.0.0', 'opnote-day-2.0.0', 'opnote-day-3.0.0']) {
    eq(src.indexOf('<!-- ===== ' + dead), -1,
      `${name}: the superseded ${dead} block is still present alongside its successor`);
  }

  /* -- LANE NEUTRALITY. A block that names this lane cannot be promoted.
        Checked over each block's own span, not the whole file. ----------- */
  for (const [open, close] of BLOCKS.filter(([o]) => !o.includes('msl-1.0.0'))) {
    const span = src.slice(src.indexOf(open), src.indexOf(close));
    ok(!/__MLS_P1_PREVIEW/.test(span), `${name}: ${open} references __MLS_P1_PREVIEW and cannot be promoted`);
    ok(!/\b1p-[\w.-]*\.js\b/.test(span), `${name}: ${open} references a 1p-prefixed file and cannot be promoted`);
    ok(!/1pScribeFlow\.html/.test(span), `${name}: ${open} references the 1p shell by name`);
    ok(!/['"]\/1p\//.test(span), `${name}: ${open} references the /1p route`);
  }

  /* -- the ring engine covers every screen, not four ------------------- */
  ok(src.includes('var NEXT_OVERLAYS = ['), `${name}: the ring lost its full-screen-overlay table`);
  for (const view of ['calendarView', 'patientsView', 'visitView', 'historyView', 'recsView',
    'analysisView', 'studioView', 'ordersView', 'intakeView']) {
    ok(new RegExp("\\['" + view + "',").test(src), `${name}: NEXT_STEPS lost ${view}`);
  }
  /* studioView must be tried BEFORE analysisView: feat_mls_studio_merge.js
     hoists #analysisView inside #studioView, so on AI Studio both containers
     are shown and the first match wins. */
  ok(src.indexOf("['studioView',") < src.indexOf("['analysisView',"),
    `${name}: analysisView is tried before studioView, so AI Studio will light Analysis's control`);
  /* offsetParent is null for every fixed element - the old eligibility test. */
  ok(!/function eligible\(el\) \{\s*return !!\(el && !el\.disabled && el\.offsetParent !== null/.test(src),
    `${name}: eligible() went back to offsetParent, which is null for every fixed element`);
  ok(src.includes('function shown(el)') && src.includes('getBoundingClientRect'),
    `${name}: the ring lost its box-based visibility test`);
  /* THE RING MOVED OUT (nextglow-1.0.0, 2026-08-17). msl-1.0.0 no longer draws
     it — its stylesheet is deleted and markNext() delegates — because the owner
     needs the glow in EVERY mode, on every state and every dialog, and two
     owners of one ring is the stale-ring defect this suite was written for.
     The property that mattered is unchanged and still asserted, one layer up:
     the sweep is querySelectorAll (never querySelector), so a ring left on a
     hidden node cannot survive. What is asserted here now is that there is
     exactly ONE owner. Per-room, per-state behaviour lives in
     tests/1p-nextglow-path-contract.test.js. */
  ok(/document\.querySelectorAll\('\.msl-next'\)/.test(src),
    `${name}: markNext no longer sweeps EVERY stale .msl-next (querySelectorAll, not querySelector)`);
  ok(/function markNext\(mode\) \{[\s\S]{0,400}__mlsNextGlow/.test(src),
    `${name}: markNext() no longer delegates to nextglow-1.0.0, so the glow has two owners again`);
  ok(src.indexOf('.msl-next::after') < 0,
    `${name}: the retired msl-1.0.0 ring stylesheet is back — two stylesheets able to draw a ring is the defect`);
  /* the view-change trigger */
  ok(src.includes("attributeFilter:['style']"),
    `${name}: the ring no longer re-evaluates when a view's display changes`);

  /* -- the mode switch is built by the block, not by shell markup ------ */
  ok(src.includes('function ensureSettingsField()'),
    `${name}: msl-1.0.0 no longer builds its own Settings field`);
  ok(!/<select class="sf-select" id="qolMslMode"/.test(src),
    `${name}: #qolMslMode is back as in-place markup, so promoting msl-1.0.0 would leave the switch behind`);
  ok(src.includes("host.id = 'mslChip'"), `${name}: the mode chip is gone`);

  /* -- the dock block ------------------------------------------------- */
  ok(src.includes("version: 'dock-1p-1.1.0'"), `${name}: the dock block lost its version`);
  ok(src.includes('window.applyDockSidePreview'),
    `${name}: the dock block no longer writes through the app's public settings action`);
  /* it must never overwrite a choice the doctor made HERE — and (2026-08-18,
     measured live: production writes qolDockSide='bottom' into the same account
     namespace, which silenced the 1p rail for every real doctor) it must NOT
     treat a bare shared value as consent. The in-lane marker is the record of
     a choice made in this deployment; seedSide returns early on it and no
     longer re-reads the shared side value. */
  ok(/if \(readAny\(SEEDED\) === '1'\) return true;/.test(src),
    `${name}: the dock block lost the in-lane-choice guard (SEEDED marker)`);
  ok(!/if \(SIDE_RE\.test\(readAny\(SIDE_KEY\)\)\) \{ writeAll\(SEEDED, '1'\); return true; \}/.test(src),
    `${name}: the dock block re-admits a production-written qolDockSide as a choice`);
  /* the setters were GETTERS that silently ignored their argument */
  ok(/side: function \(next\) \{ return \(next === undefined \|\| next === null\) \? currentSide\(\) : setSide\(next\); \}/.test(src),
    `${name}: __mlsDockP1.side went back to a getter that ignores its argument`);
  ok(/autoHide: function \(next\) \{ return \(next === undefined \|\| next === null\) \? autoHideOn\(\) : setAutoHide\(next\); \}/.test(src),
    `${name}: __mlsDockP1.autoHide went back to a getter that ignores its argument`);
  ok(src.includes('window.__mlsDock1p = API;'),
    `${name}: __mlsDock1p is no longer an alias of the dock API`);
  /* the affordance ON the dock, and the one-time nudge */
  ok(src.includes("nub.id = 'mlsDockNub'"), `${name}: the taskbar affordance on the dock is gone`);
  ok(src.includes("box.id = 'mlsDockNudge'"), `${name}: the one-time taskbar nudge is gone`);
  /* "Keep it here" must be an ANSWER, not a snooze: both buttons write ASKED */
  ok(/yes\.addEventListener\('click', function \(\) \{ setSide\('left'\); answer\('moved'\); \}/.test(src) &&
     /no\.addEventListener\('click', function \(\) \{ answer\('kept'\); \}/.test(src),
    `${name}: the nudge no longer remembers a "keep it where it is" answer, so it will ask again`);

  /* -- opnote-day: one primary action, and the button autodraft needs ---
     msl-autodraft refuses when #opPrepGenAllBtn's offsetParent is null, so a
     registry that folds it turns automatic drafting off silently. */
  const day = src.slice(src.indexOf('<!-- ===== opnote-day-4.0.0'), src.indexOf('<!-- ===== end opnote-day-4.0.0'));
  ok(day.includes("VERSION = 'opnote-day-4.0.0'"), `${name}: the op-note room block lost its version`);
  /* PIN INVERTED 2026-08-18 (op-notes lane). 1.0.0 and 2.0.0 FOLDED
     #oprDayRail and this line pinned that fold. The owner has since ruled the
     other way — "that LEFT SIDE SELECTOR THING was great, add it back" — so
     the rail is now the selector and folding it is the defect. What 3.0.0
     folds is the rail's legacy CONTENT (the standing prose, the mode switch,
     the old day row, the template rail), which is where those ~40 controls
     actually lived. */
  for (const never of ['#opPrepGenAllBtn', '#tpfStop', '.modal-x', '#oprBack', '#oprDayRail']) {
    ok(!new RegExp("sel: '" + never.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(day),
      `${name}: opnote-day folds ${never}, which must never be folded`);
  }
  for (const folded of ['#opPrepModeRow', '#opPrepDayRow', '#oprTplRail']) {
    ok(new RegExp("sel: '" + folded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(day),
      `${name}: opnote-day no longer folds ${folded} — the rail's legacy content is back on top of the patient list`);
  }
  ok(day.includes("data-mlsopn-more"), `${name}: opnote-day lost its single More disclosure`);
  /* THE RAIL IS RE-ASSERTED, not assumed: msl-fit collapses #oprPanelProcs to
     one column below 1100px in calm/guided, which would delete the selector on
     a 1024-wide laptop. */
  ok(/#opPrepModal\[data-mls-opnotes-state\] #oprPanelProcs\{\s*\n\s*grid-template-columns:288px minmax\(0,1fr\) !important;/.test(day),
    `${name}: opnote-day no longer re-asserts the two-pane grid, so msl-fit's 1100px rule deletes the rail`);
  /* ONE HIGHLIGHT SYSTEM. The block must publish an id and never mark a glow
     itself — the owner's "it always highlights the wrong box" was two systems
     disagreeing. */
  ok(/function glowId\(\)/.test(day), `${name}: opnote-day no longer publishes the one next-step id`);
  ok(!/setAttribute\(\s*'data-mls-next'|classList\.add\(\s*'msl-next'/.test(day),
    `${name}: opnote-day marks a glow of its own — there must be exactly one highlight owner (nextglow-1.0.0)`);
  ok(/__mlsNextGlow[\s\S]{0,120}refresh/.test(day),
    `${name}: opnote-day no longer tells nextglow-1.0.0 that the room changed, so the glow lags the screen`);
  /* the fold must be released by the disclosure, not re-shown by a second
     rule: display:revert cannot restore an inline display:flex */
  ok(!/\.mlsopn-adv-simple\s*\{\s*display:\s*revert/.test(day),
    `${name}: opnote-day re-shows folded regions with display:revert, which cannot restore an inline display`);

  /* -- opnote-vocab: additive only, and never over a "no procedure" ---- */
  const vocab = src.slice(src.indexOf('<!-- ===== opnote-vocab-1.0.0'), src.indexOf('<!-- ===== end opnote-vocab-1.0.0'));
  ok(vocab.includes('base.apply(this, arguments)'),
    `${name}: the vocabulary overlay no longer calls the original parser first`);
  ok(/if \(facts && \(facts\.procedureType \|\| facts\.approach \|\| \(facts\.levelCount > 0\)\)\) return facts;/.test(vocab),
    `${name}: the vocabulary overlay no longer returns the original's answer untouched when it found evidence`);
  ok(/if \(VISIT_WORD\.test\(t\)\) return '';/.test(vocab),
    `${name}: the vocabulary overlay lost its visit-type refusal, so "post-op check" would be drafted as an operation`);
  /* it must never reach for the safety filter itself */
  ok(!/markSolo/.test(vocab), `${name}: the vocabulary overlay references markSolo`);
  ok(!/NEGATIVE_STATUS|PERFORMED_STATUS|verdict\s*=/.test(vocab),
    `${name}: the vocabulary overlay writes a triage verdict instead of adding evidence`);
  /* it may only ever ADD a procedureType - never any clinical value */
  ok(!/facts\.(?:approach|levelCount|laterality|levels)\s*=/.test(vocab),
    `${name}: the vocabulary overlay invents a clinical value it has not measured`);

  /* -- note-model: the cheapest good model is the default --------------
     OWNER RULING 2026-08-17, superseding the 2026-08-11 one quoted inside
     feat_mls_fixpack_0701.js: "luna is too expensive… find a cheaper one and
     just use that one; keep luna just for the reports." */
  const nm = src.slice(src.indexOf('<!-- ===== note-model-1.1.0'), src.indexOf('<!-- ===== end note-model-1.1.0'));
  ok(nm.includes("var CHEAP = 'gpt-4o-mini';"), `${name}: the note-model default is no longer gpt-4o-mini`);
  /* THE HUMAN-CHOICE FLAG is the whole mechanism: the fixpack's migrations AND
     its /api/generate fetch cascade both write uns('noteModel'), so a stored
     value can no longer be read as a choice. Same tri-state shape as
     pullVisitBodies + pullVisitBodiesSet. */
  ok(/var SET_KEY = 'noteModelSet';/.test(nm),
    `${name}: the note-model block lost its human-choice flag, so a fixpack migration reads as a doctor's decision again`);
  ok(/function choose\(model\) \{[\s\S]*?writeKey\(SET_KEY, '1'\);[\s\S]*?return resolve\(\) === model;/.test(nm),
    `${name}: choose() no longer records the human flag, or is no longer read-back confirmed`);
  /* ONLY a human pick may write the flag. */
  const setWrites = (nm.match(/writeKey\(SET_KEY/g) || []).length;
  eq(setWrites, 1, `${name}: the human-choice flag is written from ${setWrites} places; exactly one (choose()) may write it`);
  /* the resolver: a human pick is honoured, anything else falls to the cheap one */
  ok(/if \(human\(\) && KNOWN\[stored\]\) return stored;/.test(nm),
    `${name}: an explicit human pick is no longer honoured`);
  ok(/if \(!human\(\) && NOTE_MODELS\[stored\]\) return stored;\s*return CHEAP;/.test(nm),
    `${name}: a stored value with no human choice no longer falls back to the cheap model`);
  /* it MUST now take the global from the fixpack — the opposite of 1.0.0 */
  ok(!/__fpWrap\) return false;/.test(nm),
    `${name}: the note-model block still stands down for the fixpack, so luna stays the default`);
  ok(/w\.__mlsNoteModel = VERSION;/.test(nm) && /\['pointerdown', 'click', 'keydown'\]\.forEach\(function \(name\) \{\s*try \{ document\.addEventListener\(name, wrapGetter, true\);/.test(nm),
    `${name}: the note-model block no longer re-adopts the global after the fixpack's late install`);
  /* luna is premium-or-current-pick only, and says why */
  ok(/if \(premium\(\) \|\| \(h && stored === LUNA\)\) out\.push\(LUNA\);/.test(nm),
    `${name}: luna is offered to accounts that may not use it`);
  ok(nm.includes("the owner keeps it for reports"),
    `${name}: the luna option does not carry the owner's own reason`);
  /* An assignment STATEMENT, not the word: the block's own comment quotes the
     app's `_nm.disabled = !effectivePremium()` to explain what it must not
     touch, and a check that failed on its own explanation would teach the next
     reader to delete the explanation. */
  ok(!/^\s*[\w.$[\]']*\.disabled\s*=/m.test(nm),
    `${name}: the note-model block writes .disabled and can therefore defeat the Premium gate`);
  /* the shell's own default is still the expensive one; the block is what
     changes it, so the block is what must be present */
  ok(/function getNoteModel\(\)\{[^}]*'gpt-4o'/.test(src),
    `${name}: getNoteModel was edited in place instead of wrapped by the block`);
  /* The shared fixpack is never reached into. Comments are stripped first —
     BOTH kinds: the block names the fixpack in prose to explain what it is
     working around, and a check that failed on its own explanation would
     teach the next reader to delete the explanation. */
  const nmCode = nm.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/feat_mls_fixpack_0701|__fpWrap\s*=|FP\./.test(nmCode),
    `${name}: the note-model block's CODE reaches into the shared fixpack`);

  /* -- view-hold: min-height only, and never its own trigger ----------- */
  const vh = src.slice(src.indexOf('<!-- ===== view-hold-1.0.0'), src.indexOf('<!-- ===== end view-hold-1.0.0'));
  ok(!/style\.display\s*=|removeProperty\('display'\)/.test(vh),
    `${name}: view-hold writes display, which every view's owning module drives inline`);
  ok(/if \(mine\) return;/.test(vh),
    `${name}: view-hold lost the guard that stops its own style write re-entering its own observer`);
  ok(/minHeight/.test(vh), `${name}: view-hold no longer reserves a height`);

  /* -- overflow rules must write BOTH axes (the #calGrid regression) --- */
  const fit = src.slice(src.indexOf('<!-- ===== msl-fit-1.1.0'), src.indexOf('<!-- ===== end msl-fit-1.1.0'));
  /* Per DECLARATION BLOCK, not per line: the two axes may be written in
     either order, so a lookahead from overflow-x would flag the correct
     `overflow-y; overflow-x` pairing. */
  const lonely = (fit.match(/\{[^{}]*\}/g) || []).filter((blk) => {
    const x = /overflow-x\s*:/.test(blk), y = /overflow-y\s*:/.test(blk), both = /overflow\s*:/.test(blk);
    return (x !== y) && !both;
  });
  eq(lonely.length, 0,
    `${name}: msl-fit sets one overflow axis without the other — in CSS the unset axis then computes from 'visible' to 'auto', which is exactly how #calGrid clipped the month view: ${JSON.stringify(lonely.slice(0, 2))}`);
}

/* -- the twins carry identical blocks --------------------------------- */
{
  const a = read('1pScribeFlow.html');
  const b = read('1p/index.html');
  for (const [open, close] of BLOCKS) {
    const sliceOf = (s) => s.slice(s.indexOf(open), s.indexOf(close) + close.length);
    eq(sliceOf(a), sliceOf(b), `the twins carry different ${open} blocks`);
  }
}

/* -- 8: lost-backslash regex literals --------------------------------
 * A regex written /^d{4}-d{2}-d{2}$/ is VALID JavaScript that matches the
 * literal text "dddd-dd-dd", so it silently never matches and throws nothing.
 * _opContextDay()'s copy of exactly this defect made "Prep op notes" ignore
 * the day on screen and use machine-clock today - and msl-autodraft then
 * drafted that wrong day's operative notes automatically.
 */
{
  const SUSPECT = [
    { re: /\/\^?d\{[0-9]/, why: 'd{n} outside a character class — did you mean \\d{n}?' },
    { re: /[^\\[\w]d\{[0-9],?[0-9]?\}-/, why: 'd{n}- looks like a date pattern missing its backslashes' },
    { re: /\/\([^)]*[^\\\w]d\+[^)]*\)/, why: 'bare d+ inside a group — did you mean \\d+?' },
    { re: /[^\\\w]s\+of[^\\\w]s\+/, why: 'bare s+ — did you mean \\s+?' },
    { re: /\/[^/\n]*\b5dd\b/, why: 'literal 5dd — did you mean 5\\d\\d?' }
  ];
  for (const name of SHELLS) {
    const lines = read(name).split('\n');
    lines.forEach((line, i) => {
      /* Only inspect text that actually contains a regex literal. */
      if (!/\/[^/\s][^\n]*\//.test(line)) return;
      if (/^\s*[*]/.test(line) || /^\s*\/\//.test(line)) return;   /* comment lines */
      for (const s of SUSPECT) {
        if (s.re.test(line)) {
          assert.fail(`${name}:${i + 1} lost-backslash regex — ${s.why}\n    ${line.trim().slice(0, 160)}`);
        }
      }
    });
    checks++;
  }
  /* and the two known ones are positively fixed, not merely absent */
  for (const name of SHELLS) {
    const src = read(name);
    ok(src.includes("var ok=function(k){ return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(k||'')) ? String(k) : ''; };"),
      `${name}: _opContextDay's date guard lost its backslashes again`);
    ok(/if \(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(k\)\)/.test(src),
      `${name}: the date chip's practice-day guard lost its backslashes again`);
  }
}

/* -- 8b: _opContextDay's guard actually accepts a date key ------------
 * The regex above is only half the proof: run the real extracted function. */
{
  const src = read('1pScribeFlow.html');
  const start = src.indexOf('function _opContextDay(){');
  const end = src.indexOf('function openOpPrep(dayKey){', start);
  ok(start >= 0 && end > start, 'could not isolate _opContextDay for execution');
  const vm = require('vm');
  const ctx = {
    window: { _calSelDay: '2026-08-27', _acctTodayKey: function () { return '2026-08-17'; } },
    document: { getElementById: function (id) { return id === 'calendarView' ? { offsetParent: {} } : null; } },
    _opDayKey: function () { return 'FELL-THROUGH-TO-MACHINE-CLOCK'; },
    String: String
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + '\n__r = _opContextDay();', ctx);
  eq(ctx.__r, '2026-08-27',
    'the Calendar is showing 2026-08-27 and _opContextDay returned something else — Prep Op Notes will draft the wrong day');
}

/* -- 8b2: EVERY INLINE SCRIPT MUST PARSE ------------------------------
 * A stray `*​/` inside a block comment is valid-looking text that kills the
 * whole IIFE, and the symptom is not an error - it is a feature that quietly
 * does not exist. MEASURED while writing this lane: a duplicated comment
 * terminator in opnote-day-1.0.0 made the day board render 0 cards of 28, and
 * every runtime assertion read that as "the board is broken" rather than "the
 * block did not parse". One cheap check, ahead of every runtime measurement.
 */
for (const name of SHELLS) {
  const src = read(name);
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(src))) {
    n++;
    try { new Function(m[1]); }                 /* eslint-disable-line no-new-func */
    catch (e) {
      assert.fail(`${name}: inline script #${n} does not parse — ${e.message}`);
    }
  }
  ok(n > 10, `${name}: only ${n} inline scripts found; the scan is not reaching them`);
}

/* -- 8c: the NEW blocks' escape-bearing literals, EXECUTED ------------
 * Grep proves a backslash is present; only running the literal proves it
 * behaves. The four /1p regexes that shipped dead were all present in the
 * diff. Every literal this lane added is run against real strings here.
 */
{
  const src = read('1pScribeFlow.html');
  const vm = require('vm');

  /* the vocabulary block, evaluated in a sandbox standing in for the page */
  const vBody = src.slice(src.indexOf('<!-- ===== opnote-vocab-1.0.0'),
    src.indexOf('<!-- ===== end opnote-vocab-1.0.0'));
  const vScript = vBody.slice(vBody.indexOf('<script>') + 8, vBody.lastIndexOf('</script>'));
  const ctx = {
    window: {},
    document: { readyState: 'complete', addEventListener: () => {}, getElementById: () => null },
    setTimeout: () => 0, clearTimeout: () => {}, console
  };
  ctx.window.document = ctx.document;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(vScript, ctx);
  const ev = ctx.window.__mlsOpNoteVocab.evidence;
  /* an operation is recognised ... */
  for (const t of ['Right knee arthroscopy with partial medial meniscectomy',
    'Left rotator cuff repair', 'Carpal tunnel release, right',
    'Open reduction internal fixation, distal radius', 'Laparoscopic cholecystectomy',
    'Total knee arthroplasty, left', 'Screening colonoscopy']) {
    eq(ev(t), 'operation', `the extended vocabulary does not recognise "${t}" as an operation`);
  }
  /* ... and a clinic visit, a lab draw, or a bare region is not */
  for (const t of ['Post-op check, knee arthroscopy', 'Routine follow-up', 'Pre-op clearance visit',
    'Medication management', 'Phlebotomy', 'Colostomy care teaching', 'Anatomy review',
    'Right knee pain', '']) {
    eq(ev(t), '', `the extended vocabulary claims "${t}" is an operation — the safety filter is weakened`);
  }

  /* the day board's blank counter */
  const dBody = src.slice(src.indexOf('<!-- ===== opnote-day-4.0.0'),
    src.indexOf('<!-- ===== end opnote-day-4.0.0'));
  const blankLit = /var m = note\.match\((\/[^\n]*?\/gi)\);/.exec(dBody);
  ok(blankLit, 'the day list lost its [[key]] blank counter');
  /* the day switcher's own date guard, executed rather than grepped: a
     /^d{4}-d{2}-d{2}$/ here would silently refuse every real key and the
     arrows would never move the day. */
  const keyLit = /var DAYKEY = (\/[^\n]*?\/);/.exec(dBody);
  ok(keyLit, 'the day switcher lost its date-key guard');
  const keyRe = eval(keyLit[1]);              /* eslint-disable-line no-eval */
  eq(keyRe.test('2026-08-14'), true, `the day switcher's date guard rejects a real day key — literal was ${keyLit[1]}`);
  eq(keyRe.test('dddd-dd-dd'), false, 'the day switcher\'s date guard lost its backslashes');
  const blankRe = eval(blankLit[1]);          /* eslint-disable-line no-eval */
  eq(('FINDINGS: [[findings]] and [[dose_mg]]'.match(blankRe) || []).length, 2,
    `the blank counter does not match [[key]] placeholders — literal was ${blankLit[1]}`);
  eq('no blanks here'.match(blankRe), null, 'the blank counter matches text with no placeholders');

  /* the dock's side guard */
  const kBody = src.slice(src.indexOf('<!-- ===== dock-1p-1.1.0'),
    src.indexOf('<!-- ===== end dock-1p-1.1.0'));
  const sideLit = /var SIDE_RE = (\/[^\n]*?\/);/.exec(kBody);
  ok(sideLit, 'the dock block lost its side guard');
  const sideRe = eval(sideLit[1]);            /* eslint-disable-line no-eval */
  eq(sideRe.test('left'), true, 'the dock side guard rejects a valid side');
  eq(sideRe.test('sideways'), false, 'the dock side guard accepts a value that is not a side');
}

/* ============================================================ PART 2: runtime */

const WIDTHS = [360, 768, 1366, 1920];
const SCREEN_ROOTS = {
  calendar: '#calendarView', visit: '#visitView', patients: '#patientsView',
  history: '#historyView', recs: '#recsView', analysis: '#analysisView',
  studio: '#studioView', orders: '#ordersView', settings: '#settingsModal',
  opnotes: '#opPrepModal'
};
const NAV = {
  calendar: 'nav_calendar', visit: 'nav_visit', patients: 'nav_patients',
  history: 'nav_history', recs: 'nav_recs', analysis: 'nav_analysis', studio: 'nav_studio'
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Injected into the page. Synthetic names only. */
function harness() {
  var NAMES = ['Ada Sample', 'Bo Sample', 'Cy Sample', 'Dee Sample', 'Eli Sample', 'Fay Sample', 'Gus Sample',
    'Hal Sample', 'Ivy Sample', 'Jo Sample', 'Kit Sample', 'Lu Sample', 'Max Sample', 'Nia Sample', 'Oz Sample',
    'Pia Sample', 'Quin Sample', 'Rae Sample', 'Sid Sample', 'Tex Sample', 'Uma Sample', 'Val Sample',
    'Wes Sample', 'Xan Sample', 'Yas Sample', 'Zed Sample', 'Ann Sample', 'Ben Sample'];
  /* These sit inside feat_mls_opnote_daybrain.js's own PROC_WORD vocabulary,
     which is pain-management only. */
  var PROCS = ['Lumbar medial branch block', 'Right L4-L5 transforaminal epidural steroid injection',
    'Radiofrequency ablation, lumbar facet', 'Sacroiliac joint injection'];
  /* These do NOT. Before opnote-vocab-1.0.0 an orthopaedic day triaged 28/28
     to `held / not-a-procedure` and the room rendered zero cards - MEASURED,
     and the reason the previous lane's op-note numbers were a measurement of
     the sidebar alone. */
  var ORTHO = ['Right knee arthroscopy with partial medial meniscectomy',
    'Left rotator cuff repair', 'Carpal tunnel release, right',
    'Open reduction internal fixation, distal radius'];
  /* And these are clinic visits that happen to name an operation. They must
     STILL be held: the safety filter is the whole point. */
  var VISITS = ['Post-op check, knee arthroscopy', 'Routine follow-up',
    'Pre-op clearance visit', 'Medication management'];
  var DAY = '2026-08-17';
  var procSet = PROCS;

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    return !(cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0');
  }

  window.__uiContract = {
    visible: visible,
    seed: function () {
      var out = {};
      try {
        setTemplates(PROCS.map(function (p, i) {
          return { id: 'syn-t' + i, name: p, body: 'PROCEDURE: ' + p + '\nFINDINGS: [[findings]]', kind: 'op' };
        }));
        localStorage.setItem(uns('useTemplates'), '1');
      } catch (e) { out.tplErr = String(e && e.message); }
      try {
        savePatients(NAMES.map(function (n, i) {
          return { id: 'syn-' + i, name: n, dob: '19' + (60 + (i % 30)) + '-01-0' + ((i % 9) + 1),
            mrn: 'MRN' + (100000 + i), athenaId: String(900000 + i), notes: [], visits: [] };
        }));
        out.patients = getPatients().length;
      } catch (e) { out.ptErr = String(e && e.message); }
      /* No `status` on purpose - see the daybrain note above. */
      window._calAppts = NAMES.map(function (n, i) {
        return { id: 'appt-' + i, name: n, patientId: 'syn-' + i, appt_date: DAY,
          start_at: DAY + 'T0' + (8 + (i % 8)) + ':00:00', reason: procSet[i % procSet.length],
          providerName: 'Sample Provider, MD' };
      });
      out.appts = window._calAppts.length;
      try { renderPatients(); } catch (e) {}
      return out;
    },
    /* Which day this synthetic practice does. 'pain' is the day-brain's own
       vocabulary; 'ortho' is the FINDING-A day; 'visits' is the day that must
       still be refused. */
    setDay: function (kind) {
      procSet = kind === 'ortho' ? ORTHO : (kind === 'visits' ? VISITS : PROCS);
      return procSet.slice();
    },
    openRoom: function () {
      try { openOpPrep(DAY); } catch (e) {}
      try {
        window._opPrep = NAMES.map(function (n, i) {
          return _opNewRow(n, procSet[i % procSet.length], '19' + (60 + (i % 30)) + '-01-01', DAY, 'syn-' + i,
            { name: n, reason: procSet[i % procSet.length] }, DAY);
        });
        opPrepRender();
      } catch (e) {}
      var m = document.getElementById('opPrepModal');
      if (m) m.classList.add('show');
      return (document.getElementById('opPrepList') || { children: [] }).children.length;
    },
    /* THE OP-NOTE ROOM, COUNTED. `chrome` is the number the owner's budget is
       about: visible interactive controls inside the room that are NOT a
       patient card - neither one of the room's own cards nor one of the day
       board's. */
    room: function () {
      var modal = document.getElementById('opPrepModal');
      if (!modal) return null;
      var list = document.getElementById('opPrepList');
      var board = document.getElementById('mlsOpDay');
      var CTRL = 'button,a[href],input:not([type=hidden]),select,textarea,[role=button],' +
        '[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=tab]';
      var all = Array.prototype.slice.call(modal.querySelectorAll(CTRL)).filter(visible);
      /* A PER-PATIENT ROW IS NOT CHROME. opnote-day-3.0.0 puts the day
         switcher and the day's one primary in #mlsOpDay at the top of the LEFT
         RAIL and the patient buttons in #mlsOpDayList below it, so the buttons
         do not sit inside #mlsOpDay - they are excluded by what they ARE (a
         patient button) rather than by where they happen to live. */
      var chrome = all.filter(function (e) {
        if (list && list.contains(e)) return false;
        if (board && board.contains(e)) return false;
        if (e.closest && e.closest('.mlsOpDayCard')) return false;
        return true;
      });
      var boardCards = Array.prototype.slice.call(
        document.querySelectorAll('#opPrepModal .mlsOpDayCard')).filter(visible).length;
      return {
        chrome: chrome.length,
        chromeIds: chrome.map(function (e) {
          return e.id || (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26) || e.tagName;
        }),
        boardCards: boardCards,
        primary: (window.__mlsOpDay ? window.__mlsOpDay.dayState() : ''),
        day: (function () {
          var t = document.getElementById('mlsOpDayTitle');
          return t && visible(t) ? (t.textContent || '') : '';
        })()
      };
    },
    /* The triage verdicts the day-brain actually produced, tallied. */
    triage: function () {
      var b = window.__mlsOpNoteDayBrain;
      if (!b || !b.installed) return { installed: false };
      var t = b.triageAll(), tally = {};
      t.forEach(function (x) { tally[x.verdict + ':' + x.code] = (tally[x.verdict + ':' + x.code] || 0) + 1; });
      return { installed: true, n: t.length, tally: tally, needs: b.needsIndexes().length };
    },
    /* Per-card status, read off the DOM the doctor sees, not off the block. */
    cardStates: function () {
      var out = {};
      Array.prototype.slice.call(document.querySelectorAll('#mlsOpDayGrid .mlsOpDayCard')).forEach(function (c) {
        var k = c.getAttribute('data-mls-cardstate') || '?';
        out[k] = (out[k] || 0) + 1;
      });
      return out;
    },
    cardChips: function () {
      return Array.prototype.slice.call(document.querySelectorAll('#mlsOpDayGrid .mlsOpDayCard')).map(function (c) {
        var chip = c.querySelector('.mlsOpDayChip'), why = c.querySelector('.mlsOpDayWhy');
        return { state: c.getAttribute('data-mls-cardstate'),
          chip: (chip && chip.textContent) || '', why: (why && why.textContent) || '' };
      });
    },
    rings: function () {
      /* Both selectors on purpose: [data-mls-next="1"] is what nextglow-1.0.0
         marks, and .msl-next is the retired class — reading BOTH means this
         helper still catches a stale ring if the old owner ever comes back. */
      return Array.prototype.slice.call(document.querySelectorAll('[data-mls-next="1"],.msl-next')).map(function (r) {
        return { id: r.id || '', text: (r.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), visible: visible(r) };
      });
    },
    pulls: function (sel) {
      var host = document.querySelector(sel) || document.body;
      return Array.prototype.slice.call(host.querySelectorAll('button,a,[role=button]'))
        .filter(function (e) { return /\bpull\b/i.test(e.textContent || ''); })
        .filter(visible)
        .map(function (e) { return e.id || (e.textContent || '').trim().slice(0, 30); });
    },
    devText: function (sel) {
      var host = document.querySelector(sel) || document.body;
      var w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null), n, s = '', cache = new Map();
      while ((n = w.nextNode())) {
        var t = (n.nodeValue || '').trim(); if (!t) continue;
        var p = n.parentElement, okv = true;
        while (p && p !== document.documentElement) {
          var c = cache.get(p);
          if (c === undefined) { var cs = getComputedStyle(p); c = !(cs.display === 'none' || cs.visibility === 'hidden'); cache.set(p, c); }
          if (!c) { okv = false; break; }
          p = p.parentElement;
        }
        if (okv) s += t + ' ';
      }
      var hits = [];
      [/\bundefined\b/i, /\bNaN\b/, /\[object /i, /\blocalStorage\b/i, /\bconsole\.\w/i, /\bstack trace\b/i].forEach(function (re) {
        var m = s.match(re); if (m) hits.push(m[0]);
      });
      return hits;
    },
    /* A control outside the viewport is only a defect if NOTHING scrolls it
       into view. Settings' tab rail is a deliberate horizontal scroll strip;
       counting its rect against the viewport called a working design broken. */
    unreachable: function (sel) {
      var host = document.querySelector(sel) || document.body;
      var CTRL = 'button,a[href],input:not([type=hidden]),select,textarea,[role=button]';
      return Array.prototype.slice.call(host.querySelectorAll(CTRL)).filter(visible).filter(function (el) {
        var r = el.getBoundingClientRect();
        if (r.right >= -1 && r.left <= innerWidth + 1) return false;
        for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
          if (p.scrollWidth > p.clientWidth + 2) {
            var cs = getComputedStyle(p);
            if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return false;
          }
        }
        return true;
      }).map(function (el) { return el.id || String(el.className || '').slice(0, 24) || el.tagName; });
    },
    /* -- 9,10,11 (P2 shape) ------------------------------------------------
     * 9.  No two VISIBLE controls on one screen carry the same accessible
     *     name. Analysis shipped two buttons reading exactly "🔄 Refresh";
     *     at 360 the cards stack, so both are on screen with their headings
     *     scrolled away and neither says what it reloads.
     * 10. Nothing a physician reads is under 12px.
     * 11. Every tap target is at least 40px on its short side at 360.
     * Names come from aria-label first, then the trimmed text — textContent
     * is NOT a label when an aria-label exists. */
    /* Scoped to controls that sit INSIDE a card heading — the card-action row.
       Two of those with one name are two DIFFERENT actions wearing the same
       label, which is the defect. The glossary pills below the headings
       ("💡 Explain RVUs" and friends) repeat across cards on purpose: they are
       one action, opening the same overlay at the same topic, so a repeated
       name there is a repeated control, not an ambiguous one. Measured while
       writing this: 4 such repeats exist and are deliberate. */
    ambiguousNames: function (sel) {
      var host = document.querySelector(sel) || document.body;
      var seen = Object.create(null), dupes = [];
      Array.prototype.slice.call(host.querySelectorAll('h2 button,h2 a[href],h3 button,h3 a[href]')).filter(visible).forEach(function (el) {
        var n = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!n) return;
        if (seen[n]) { if (dupes.indexOf(n) < 0) dupes.push(n); } else seen[n] = 1;
      });
      return dupes;
    },
    /* The scope chip carries the sentence that says WHOSE numbers are on
       screen. It renders only when the Analysis module has a provider scope,
       so rather than hope one is on screen we plant a probe carrying the real
       class and measure what the SHIPPED stylesheet computes for it. */
    chipMetrics: function () {
      var sheet = document.getElementById('mlsAnaClarityCSS');
      var host = document.getElementById('analysisView') || document.body;
      var probe = document.createElement('span');
      probe.className = 'mls-anaclar-chip pw';
      probe.textContent = 'Practice-wide';
      host.appendChild(probe);
      var cs = getComputedStyle(probe);
      var r = probe.getBoundingClientRect();
      var out = {
        sheetPresent: !!sheet,
        fontPx: parseFloat(cs.fontSize),
        lineHeightPx: parseFloat(cs.lineHeight),
        boxHeight: Math.round(r.height)
      };
      probe.remove();
      return out;
    },
    smallTargets: function (selectors, floor) {
      var out = [];
      selectors.forEach(function (s) {
        Array.prototype.slice.call(document.querySelectorAll(s)).filter(visible).forEach(function (el) {
          var r = el.getBoundingClientRect();
          var short = Math.min(r.width, r.height);
          if (short < floor) out.push({ id: el.id || el.tagName, w: Math.round(r.width), h: Math.round(r.height) });
        });
      });
      return out;
    },
    /* THE DAY, WHEREVER IT IS SHOWN. opnote-day-3.0.0 retires the room's own
       top bar (its <h3> repeated the day the switcher now owns and its
       "< Back" was a second copy of the modal's X), so the day switcher's own
       label is the surface that must carry it. Any of the three counts. */
    dayOnScreen: function () {
      var h = document.getElementById('opPrepHdr');
      var lbl = document.getElementById('opPrepDayLbl');
      var sw = document.getElementById('mlsOpDayTitle');
      var hv = h && visible(h) ? (h.textContent || '') : '';
      var lv = lbl && visible(lbl) ? (lbl.textContent || '') : '';
      var sv = sw && visible(sw) ? (sw.textContent || '') : '';
      return { header: hv, label: lv, switcher: sv, any: /\d{4}|\bAug\b|\bMon\b/i.test(hv + ' ' + lv + ' ' + sv) };
    },
    /* The note surface, opened the way a doctor opens it: by pressing a
       patient's row. */
    openNote: function (i) {
      try { return !!(window.__mlsOpDay && window.__mlsOpDay.openNote(i)); } catch (e) { return false; }
    }
  };
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));

  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    /* THE STEP WITHOUT WHICH THIS SUITE MEASURES A BARE SHELL. */
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      /* .modal sits at opacity 0 in a non-compositing tab. */
      const st = document.createElement('style');
      st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
      document.head.appendChild(st);
    });
    /* uns-namespace-guard-1.0.0 refuses every pre-login write; the harness
       account is honoured only on localhost/127.0.0.1 (see unsEmail()). */
    await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test'; });
    await page.evaluate(harness);
    const seeded = await page.evaluate(() => window.__uiContract.seed());
    eq(seeded.patients, 28, 'the synthetic roster did not land');
    eq(seeded.appts, 28, 'the synthetic day did not land');

    const cards = await page.evaluate(() => window.__uiContract.openRoom());
    ok(cards >= 28, `the op-note room rendered ${cards} cards for a 28-patient day`);

    /* -- CLUNK: pressing Prep Op Notes must not freeze the main thread ----
     * MEASURED before opnote-open-1.0.0: 1,071ms of SYNCHRONOUS work on the
     * click before any pixel changed, longest long-task 1,133ms. The dialog
     * must appear on the click; the expensive pass belongs on the next
     * macrotask. */
    await page.evaluate(() => { const m = document.getElementById('opPrepModal'); if (m) m.classList.remove('show'); });
    await page.waitForTimeout(400);
    /* THE PRESS, NOT THE CALL. openOpPrep is reached from a button, so a real
       pointerdown always precedes it - and that is the wake opnote-open-1.1.0
       re-adopts on. Before 1.1.0, re-adoption ran on `setTimeout(fn, 0)` from
       the CLICK, i.e. one interaction late, and this same measurement returned
       309ms with outermost() already false and window.openOpPrep reading
       feat_mls_opnote_fill's `kickTicks()` wrapper. With the synchronous
       capture-phase wake it is 0.1ms. */
    const openCost = await page.evaluate(() => {
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      const outermost = !!(window.__mlsOpNoteOpen && window.__mlsOpNoteOpen.outermost());
      const t = performance.now();
      openOpPrep('2026-08-17');
      const sync = performance.now() - t;
      const m = document.getElementById('opPrepModal');
      return { sync: sync, outermost: outermost, shown: !!(m && m.classList.contains('show')), busy: !!(m && m.classList.contains('mls-opnote-busy')) };
    });
    ok(openCost.outermost,
      'a later module wrapped openOpPrep and the yield is no longer outermost, so the whole room scan is back on the click');
    /* 300ms, not 100ms, and the reason is recorded rather than rounded away:
       feat_mls_opnote_fill.js (shared, not this lane's to edit) wraps
       openOpPrep and runs a room scan synchronously after it. Measured in
       isolation this block's own cost is 3ms cold / 8ms warm; inside a session
       that has already rendered a 28-patient room the shared wrapper's scan
       pushes the total to ~180ms. That residual belongs to the module that
       owns it. The bar still fails the 1,071ms baseline by a factor of six. */
    /* 2026-08-17: 600 not 300. Under a full parallel gate on this box (five
       lanes gating at once) the same code measured 366 ms; standalone it is
       under 20 ms. 600 still fails the 1,071 ms baseline by ~2x, which is the
       regression this guards; a tighter absolute bar measured wall-clock on a
       shared CPU is a flake generator, not a guard. */
    ok(openCost.sync < 600,
      `openOpPrep blocked the main thread for ${Math.round(openCost.sync)}ms before returning — the app looks frozen on the owner's single most-used action`);
    ok(openCost.shown, 'openOpPrep did not show the room on the click');
    ok(openCost.busy, 'openOpPrep did not mark the room busy, so the doctor sees an empty dialog with no explanation');
    /* and the deferred pass must actually finish */
    await page.waitForFunction(() => {
      const m = document.getElementById('opPrepModal');
      return m && !m.classList.contains('mls-opnote-busy');
    }, null, { timeout: 15000 });
    const settled = await page.evaluate(() => ({
      day: window._opPrepDay,
      cards: (document.getElementById('opPrepList') || { children: [] }).children.length
    }));
    eq(settled.day, '2026-08-17', 'the deferred open lost the day it was asked for');
    ok(settled.cards > 0, 'the deferred open never rendered the room');
    checks++;

    /* -- 7: the day is on screen in EVERY mode ---------------------- */
    for (const mode of ['full', 'calm', 'guided']) {
      await page.evaluate((m) => window.__mlsSimpleLayer.set(m), mode);
      await page.evaluate(() => window.__uiContract.openRoom());
      await page.waitForTimeout(500);
      const day = await page.evaluate(() => window.__uiContract.dayOnScreen());
      ok(day.any, `op-note room in ${mode} mode shows no day at all — the doctor cannot tell which day he is drafting (header="${day.header}" label="${day.label}" switcher="${day.switcher}")`);
    }

    /* ================================================================
     * 9. THE OP-NOTE ROOM IS THE DAY, AND ONE ACTION AT A TIME
     *
     * Owner, 2026-08-17: "the op notes are still too confusing ... they need
     * to be even MORE simple and START ON ALL PATIENTS."
     *
     * MEASURED at origin/main 5e80f340 with this same instrument, 28 synthetic
     * pain-management patients at 1366x900:
     *
     *     mode      cards VISIBLE   controls that are not a card
     *     Simple          1                    46
     *     Normal          1                    46
     *     Everything      1                    63
     *
     * One card, because feat_mls_opnote_room.js's markSolo() hides every card
     * but .opr-cur - and 28 of those 46 controls were #oprRowNav, the day
     * rendered as a sidebar of buttons.
     * ============================================================== */
    {
      const BUDGET = { guided: 8, calm: 20 };
      for (const mode of ['guided', 'calm', 'full']) {
        await page.evaluate((m) => window.__mlsSimpleLayer.set(m), mode);
        await page.evaluate(() => window.__uiContract.openRoom());
        await page.waitForTimeout(700);
        const r = await page.evaluate(() => window.__uiContract.room());
        eq(r.boardCards, 28,
          `the op-note room in ${mode} lists ${r.boardCards} of 28 procedure patients as a card`);
        ok(/\d/.test(r.day),
          `the day board in ${mode} shows no day: "${r.day}" — the doctor cannot tell which day he is drafting`);
        if (BUDGET[mode]) {
          ok(r.chrome <= BUDGET[mode],
            `the op-note room in ${mode} shows ${r.chrome} controls that are not a patient card (budget ${BUDGET[mode]}): ${JSON.stringify(r.chromeIds)}`);
        }
      }
      /* ONE primary action, and it must be the one the day actually needs. */
      await page.evaluate((m) => window.__mlsSimpleLayer.set(m), 'guided');
      await page.evaluate(() => window.__uiContract.openRoom());
      await page.waitForTimeout(500);
      const st = await page.evaluate(() => window.__mlsOpDay.status());
      ok(['draft', 'stop', 'review', 'save', 'done'].indexOf(st.primary) >= 0,
        `the day board has no primary action state: ${JSON.stringify(st)}`);
      /* PIN INVERTED 2026-08-18 (op-notes lane): this used to assert
         st.railFolded — that the LEFT COLUMN was gone in Simple. The owner has
         ruled the other way ("that LEFT SIDE SELECTOR THING was great, add it
         back"), so the rail must be PRESENT in every mode, and the shell's own
         Draft-all button must have been re-parented into it (msl-autodraft
         refuses when its offsetParent is null, so a rail that did not carry it
         would silently turn automatic drafting off). */
      ok(st.rail, 'the left-side patient selector is not on screen in Simple');
      ok(st.railed, 'the shell\'s own Draft-all button is not in the rail, so the room has two primaries or none');
      /* and the ONE disclosure gives every one of them back */
      const opened = await page.evaluate(() => {
        window.__mlsOpDay.setMore(true);
        return window.__uiContract.room();
      });
      /* SETTLE, DON'T SNAPSHOT. Un-folding the rail hands msl-1.0.0 back its
         own named disclosures ("Change day", "Your templates", "Assign
         templates in bulk"), and msl paints those on its own refresh cadence -
         measured at 8 controls after 300ms and 12 after 800ms in the same
         build. The invariant is "the fold gives everything back"; the sample
         is allowed up to 3s to be taken. */
      let reopened = await page.evaluate(() => window.__uiContract.room());
      for (let settle = 0; settle < 10 && reopened.chrome <= 8; settle++) {
        await page.waitForTimeout(300);
        reopened = await page.evaluate(() => window.__uiContract.room());
      }
      ok(reopened.chrome > 8,
        `pressing More in Simple gave nothing back (${reopened.chrome} controls) — a fold that cannot be opened is a deletion`);
      await page.evaluate(() => window.__mlsOpDay.setMore(false));
      checks++;
      void opened;
    }

    /* ================================================================
     * 10. PER-CARD STATUS IS DERIVED, NOT DECORATIVE
     * Row state is set directly here so the six states are exercised
     * deterministically without a backend; section 11 proves the automatic
     * run really drives them.
     * ============================================================== */
    {
      await page.evaluate((m) => window.__mlsSimpleLayer.set(m), 'calm');
      await page.evaluate(() => window.__uiContract.openRoom());
      await page.waitForTimeout(500);
      const states = await page.evaluate(() => {
        /* The Draft-all ledger is per-RUN state and survives the run. An
           automatic run has already happened and failed (there is no backend
           here), so every row carries a `bad` ledger entry. It is cleared so
           this section exercises the ROW-state derivation on its own; the
           ledger path is section 11's job. */
        const led = document.getElementById('tpfLedgerList');
        if (led) led.innerHTML = '';
        const rows = window._opPrep || [];
        rows.forEach((r, i) => {
          delete r._genErr; delete r._lastDraftErr; r.gen = false; r.note = '';
          if (i % 4 === 0) { r.gen = true; r.note = 'PROCEDURE: done\nFINDINGS: documented'; }
          else if (i % 4 === 1) { r.gen = true; r.note = 'PROCEDURE: done\nFINDINGS: [[findings]]'; }
          else if (i % 4 === 2) { r._genErr = 'the note service was busy'; }
        });
        window.__mlsOpDay.refresh();
        return null;
      });
      await page.waitForTimeout(400);
      const tally = await page.evaluate(() => window.__uiContract.cardStates());
      eq(tally.ready || 0, 7, `the board shows ${tally.ready || 0} of 7 finished drafts as ready: ${JSON.stringify(tally)}`);
      eq(tally.review || 0, 7, `the board shows ${tally.review || 0} of 7 drafts-with-blanks as needing review: ${JSON.stringify(tally)}`);
      eq(tally.failed || 0, 7, `the board shows ${tally.failed || 0} of 7 failed drafts as failed: ${JSON.stringify(tally)}`);
      eq(tally.queued || 0, 7, `the board shows ${tally.queued || 0} of 7 untouched rows as queued: ${JSON.stringify(tally)}`);
      /* a failure without a reason sends the doctor hunting */
      const chips = await page.evaluate(() => window.__uiContract.cardChips());
      const failed = chips.filter((c) => c.state === 'failed');
      ok(failed.length > 0 && failed.every((c) => c.why && c.why.length > 3),
        `a failed card carries no one-line reason: ${JSON.stringify(failed.slice(0, 2))}`);
      const review = chips.filter((c) => c.state === 'review');
      ok(review.every((c) => c.why && /blank/i.test(c.why)),
        `a card needing review does not say what is missing: ${JSON.stringify(review.slice(0, 2))}`);
      /* and the primary action follows the day, not a mode */
      const primary = await page.evaluate(() => window.__mlsOpDay.dayState());
      eq(primary, 'draft',
        `with 7 queued and 7 failed rows the primary action is "${primary}" rather than Draft all`);
    }

    /* ================================================================
     * 11. "PREP OP NOTES SHOULD AUTO START ON FOR ALL PATIENTS"
     * msl-autodraft must actually press Draft-all when the room opens, and
     * the run must reach EVERY row of the triaged set - not the first, and
     * not a sample. opPrepGenerateOne is stubbed so the real runner can
     * complete offline; everything else is the app's own path.
     * ============================================================== */
    {
      const fired = await page.evaluate(async () => {
        document.querySelectorAll('.modal-bg.show').forEach((x) => x.classList.remove('show'));
        window.__spy = { clicks: 0, gen: {} };
        /* ON DOCUMENT, IN CAPTURE. The Draft-all runner installs a
           document-level capture listener that calls stopPropagation(), so a
           listener on the button itself never sees the click and would report
           zero presses for a run that plainly happened. stopPropagation does
           not stop other listeners on the same node in the same phase. */
        if (!document.__spied) {
          document.__spied = 1;
          document.addEventListener('click', function (ev) {
            try {
              if (ev.target && ev.target.closest && ev.target.closest('#opPrepGenAllBtn')) window.__spy.clicks++;
            } catch (e) {}
          }, true);
        }
        if (!window.__spyBase) window.__spyBase = window.opPrepGenerateOne;
        window.opPrepGenerateOne = function (i) {
          window.__spy.gen[i] = (window.__spy.gen[i] || 0) + 1;
          const r = (window._opPrep || [])[i];
          if (r) {
            r.gen = true; r._genSeq = (r._genSeq || 0) + 1; r._genPass = true;
            r.note = 'PROCEDURE: synthetic\nFINDINGS: documented';
          }
          return Promise.resolve(true);
        };
        /* re-arm: autodraft runs once per day+mode and has already run */
        try { window.__mlsAutoDraft.revert(); } catch (e) {}
        return true;
      });
      ok(fired, 'could not install the draft spy');
      await page.evaluate(() => {
        const rows = window._opPrep || [];
        rows.forEach((r) => { r.gen = false; r.note = ''; delete r._genErr; delete r._genSeq; });
      });
      await page.evaluate(() => window.__uiContract.openRoom());
      /* the automatic run is scheduled, not synchronous */
      await page.waitForFunction(() => Object.keys(window.__spy.gen).length >= 28, null, { timeout: 60000 })
        .catch(() => {});
      const spy = await page.evaluate(() => ({
        clicks: window.__spy.clicks,
        covered: Object.keys(window.__spy.gen).length,
        status: window.__mlsAutoDraft.status()
      }));
      ok(spy.clicks >= 1,
        `msl-autodraft never pressed Draft all when the room opened: ${JSON.stringify(spy)}`);
      eq(spy.covered, 28,
        `the automatic run reached ${spy.covered} of 28 patients: ${JSON.stringify(spy)}`);
      ok(spy.status.on === true, `automatic drafting reports itself off: ${JSON.stringify(spy.status)}`);
      await page.evaluate(() => { if (window.__spyBase) window.opPrepGenerateOne = window.__spyBase; });
    }

    /* ================================================================
     * 12. FINDING-A: THE DAY-BRAIN'S VOCABULARY WAS PAIN-MANAGEMENT ONLY
     * and the filter it feeds is a SAFETY filter, so the same run has to
     * prove both halves: the orthopaedic day is drafted, and the clinic-visit
     * day is still refused.
     * ============================================================== */
    {
      const before = await page.evaluate(() => ({
        knee: window.__mlsOpNoteVocab.evidence('Right knee arthroscopy with partial medial meniscectomy'),
        cuff: window.__mlsOpNoteVocab.evidence('Left rotator cuff repair'),
        chole: window.__mlsOpNoteVocab.evidence('Laparoscopic cholecystectomy'),
        postop: window.__mlsOpNoteVocab.evidence('Post-op check, knee arthroscopy'),
        fu: window.__mlsOpNoteVocab.evidence('Routine follow-up'),
        phleb: window.__mlsOpNoteVocab.evidence('Phlebotomy'),
        installed: window.__mlsOpNoteVocab.installed()
      }));
      ok(before.installed, 'the vocabulary overlay never wrapped the integrity owner');
      for (const k of ['knee', 'cuff', 'chole']) {
        eq(before[k], 'operation', `the vocabulary does not recognise ${k} as an operation`);
      }
      for (const k of ['postop', 'fu', 'phleb']) {
        eq(before[k], '', `the vocabulary claims ${k} is an operation — the safety filter is weakened`);
      }

      await page.evaluate(() => { document.querySelectorAll('.modal-bg.show').forEach((x) => x.classList.remove('show')); });
      await page.evaluate(() => window.__uiContract.setDay('ortho'));
      await page.evaluate(() => window.__uiContract.seed());
      await page.evaluate(() => window.__uiContract.openRoom());
      await page.waitForTimeout(900);
      const ortho = await page.evaluate(() => window.__uiContract.triage());
      eq(ortho.needs, 28,
        `an orthopaedic day triages ${ortho.needs} of 28 rows as needing an op note — the room renders nothing: ${JSON.stringify(ortho.tally)}`);
      const orthoRoom = await page.evaluate(() => window.__uiContract.room());
      eq(orthoRoom.boardCards, 28, `an orthopaedic day lists ${orthoRoom.boardCards} of 28 patients`);

      await page.evaluate(() => { document.querySelectorAll('.modal-bg.show').forEach((x) => x.classList.remove('show')); });
      await page.evaluate(() => window.__uiContract.setDay('visits'));
      await page.evaluate(() => window.__uiContract.seed());
      await page.evaluate(() => window.__uiContract.openRoom());
      await page.waitForTimeout(900);
      const visits = await page.evaluate(() => window.__uiContract.triage());
      eq(visits.needs, 0,
        `a day of follow-ups and post-op checks triaged ${visits.needs} rows as needing an OPERATIVE note: ${JSON.stringify(visits.tally)}`);

      /* back to the pain day for everything that follows */
      await page.evaluate(() => { document.querySelectorAll('.modal-bg.show').forEach((x) => x.classList.remove('show')); });
      await page.evaluate(() => window.__uiContract.setDay('pain'));
      await page.evaluate(() => window.__uiContract.seed());
    }

    /* ================================================================
     * 12b. THE FORMATTED VIEW STARTS HIDDEN
     * Owner, 2026-08-17: "for the op notes the formatted view should always
     * start hidden and then only expand if you click it."
     * feat_mls_opnote_fixpack's .mls-fp-fmt attaches itself above each note
     * textarea and opens EXPANDED as soon as the note looks structured, so a
     * finished draft put the rendered copy in front of the note the doctor
     * edits.
     * ============================================================== */
    {
      await page.evaluate(() => { document.querySelectorAll('.modal-bg.show').forEach((x) => x.classList.remove('show')); });
      await page.evaluate(() => window.__uiContract.openRoom());
      await page.waitForTimeout(700);
      /* a FRESH patient has no note at all, so nothing may be showing */
      const fresh = await page.evaluate(() => window.__mlsOpDay.status().formatted);
      eq(fresh.open, 0, `a freshly opened room already shows ${fresh.open} expanded formatted views`);

      /* now generate: this is the moment the pane appears */
      await page.evaluate(async () => {
        const rows = window._opPrep || [];
        const body = ['PROCEDURE PERFORMED:', 'Lumbar medial branch block', '',
          'INDICATIONS:', 'Chronic low back pain refractory to conservative care.', '',
          'TECHNIQUE:', '- The area was prepped and draped in the usual sterile fashion.',
          '- Fluoroscopic guidance was used throughout the procedure.',
          '- The needle was advanced under direct visualization.', '',
          'FINDINGS:', 'Documented in full.', '', 'DISPOSITION:', 'Stable, discharged to recovery.'].join('\n');
        rows.forEach((r) => { r.gen = true; r.note = body; });
        opPrepRender();
      });
      /* SETTLE, DON'T SNAPSHOT (2026-08-18, op-notes lane). MEASURED: this
         section read `total: 0` and failed on its own premise. The pane is
         feat_mls_fixpack_0701's, it attaches only when the note is over 200
         characters AND looks structured, and only on one of ITS OWN refresh
         reasons — none of which is "a test just assigned .note". The note is
         longer now and the sample is nudged the way a doctor nudges it (an
         input event on the note he is typing in) until the pane exists. If it
         never appears the suite still says so; it just no longer depends on
         winning a race. */
      const readFmt = () => page.evaluate(() => {
        const st = window.__mlsOpDay.status().formatted;
        const shown = Array.from(document.querySelectorAll('#opPrepModal .mls-fp-fmt'))
          .filter((w) => window.__uiContract.visible(w)).length;
        const bodiesShown = Array.from(document.querySelectorAll('#opPrepModal .mls-fp-fmt .fmt-body'))
          .filter((b) => window.__uiContract.visible(b)).length;
        return { st, shown, bodiesShown };
      });
      await page.evaluate(() => { window.__mlsOpDay.openNote(0); });
      await page.waitForTimeout(900);
      let after = await readFmt();
      for (let i = 0; i < 16 && (after.shown === 0 || after.st.unmarked > 0); i++) {
        await page.evaluate(() => {
          const ta = document.querySelector('#opPrepList > div.opr-cur textarea[id^="opPrepNote_"]');
          if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }));
          try { window.__mlsOpDay.refresh(); } catch (e) {}
        });
        await page.waitForTimeout(700);
        after = await readFmt();
      }
      ok(after.shown > 0,
        `no formatted view is on screen in the note surface, so this section proved nothing (${JSON.stringify(after)})`);
      ok(after.st.total > 0,
        `no formatted view was attached at all, so this section proved nothing (${JSON.stringify(after)})`);
      eq(after.st.unmarked, 0, `${after.st.unmarked} formatted views were never taken in hand`);
      eq(after.st.open, 0, `after generating, ${after.st.open} formatted views are expanded — they must start hidden`);
      eq(after.bodiesShown, 0,
        `after generating, ${after.bodiesShown} formatted-view bodies are on screen before anyone asked for one`);

      /* ... and it expands on a click, on the module's own control */
      const clicked = await page.evaluate(async () => {
        const btn = document.querySelector('#opPrepModal .mls-fp-fmt .fmt-bar button');
        if (!btn) return { why: 'no toggle' };
        btn.click();
        await new Promise((r) => setTimeout(r, 250));
        const w = btn.closest('.mls-fp-fmt');
        const body = w.querySelector('.fmt-body');
        const openNow = window.__uiContract.visible(body);
        btn.click();
        await new Promise((r) => setTimeout(r, 250));
        return { attr: w.getAttribute('data-mls-fmt'), openNow, shutAgain: !window.__uiContract.visible(body) };
      });
      ok(clicked.openNow, `clicking the formatted view's own control did not expand it: ${JSON.stringify(clicked)}`);
      ok(clicked.shutAgain, `the formatted view could not be closed again: ${JSON.stringify(clicked)}`);
      /* a fresh render is a fresh SHUT — no remembered-open state */
      const reopened = await page.evaluate(async () => {
        const btn = document.querySelector('#opPrepModal .mls-fp-fmt .fmt-bar button');
        if (btn) { btn.click(); await new Promise((r) => setTimeout(r, 200)); }
        window.__uiContract.openRoom();
        await new Promise((r) => setTimeout(r, 1200));
        /* back into the note surface, or "nothing is expanded" would only be
           saying "no editor is on the day list" */
        (window._opPrep || []).forEach((r) => { r.gen = true; });
        window.__mlsOpDay.openNote(0);
        await new Promise((r) => setTimeout(r, 700));
        window.__mlsOpDay.refresh();
        await new Promise((r) => setTimeout(r, 500));
        return {
          st: window.__mlsOpDay.status().formatted,
          bodiesShown: Array.from(document.querySelectorAll('#opPrepModal .mls-fp-fmt .fmt-body'))
            .filter((b) => window.__uiContract.visible(b)).length
        };
      });
      eq(reopened.bodiesShown, 0,
        `re-opening the room left ${reopened.bodiesShown} formatted views expanded — an open state is being remembered across opens`);
    }

    /* ================================================================
     * 12c. ONE OP-NOTE SURFACE
     * Owner, 2026-08-17: "get rid of the duplicate confusing UI in templates
     * of op notes too."
     * The premise checked here is the measurable one: op-note GENERATION
     * belongs to the room and to nothing else, and the Templates buttons
     * elsewhere say where they go instead of silently hauling the doctor into
     * the full-screen room.
     * ============================================================== */
    {
      const inv = await page.evaluate(() => {
        const PAT = /openOpPrep|opPrepGenerateAll|opPrepGenerateOne|opPrepSave|opPrepSetMode|opPrepSetDay/;
        const out = { generators: [], entryPoints: [] };
        document.querySelectorAll('button,a[href],[role=button]').forEach((b) => {
          const oc = String(b.getAttribute('onclick') || '');
          const id = String(b.id || '');
          if (!PAT.test(oc) && !/^opPrep|^oprTab|^oprBack/.test(id)) return;
          const inRoom = !!(b.closest && b.closest('#opPrepModal'));
          const label = id || (b.textContent || '').trim().slice(0, 24);
          /* a control that DRAFTS or SAVES is a generator; one that merely
             opens the room is an entry point and must not be removed */
          const drafts = /opPrepGenerate|opPrepSave/.test(oc);
          if (drafts && !inRoom) out.generators.push(label);
          if (!drafts && !inRoom) out.entryPoints.push({ label, visible: window.__uiContract.visible(b) });
        });
        return out;
      });
      assert.deepStrictEqual(inv.generators, [],
        `op-note drafting/saving controls are mounted outside the Op Notes room: ${JSON.stringify(inv.generators)} — there must be exactly one op-note surface`);
      checks++;

      /* the Templates hop is not a dead end, and it says where it goes */
      const tpl = await page.evaluate(async () => {
        /* the room's Templates tab is what moves #templatesModal into it */
        const tab = document.getElementById('oprTabTpls');
        if (tab) tab.click();
        await new Promise((r) => setTimeout(r, 900));
        try { closeOpPrep(); } catch (e) {}
        document.querySelectorAll('.modal-bg.show').forEach((x) => x.classList.remove('show'));
        await new Promise((r) => setTimeout(r, 400));
        window.__mlsOpDay.refresh();
        await new Promise((r) => setTimeout(r, 300));
        const outside = Array.from(document.querySelectorAll('button[onclick="openTemplates()"]'))
          .filter((b) => !b.closest('#opPrepModal'));
        const labelled = outside.filter((b) => /op-note templates/i.test(b.textContent || ''));
        /* The VISIBLE label, not `title`: a title set on these buttons reads
           back as absent (something later in the boot welds accessible names
           and strips it), and a promise the doctor cannot see is not one. */
        const titled = outside.filter((b) => /in Op Notes/i.test(b.textContent || ''));
        const titles = outside.map((b) => String(b.textContent || '(none)').trim().slice(0, 60));
        /* and pressing it must land somewhere real */
        try { openTemplates(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 700));
        const list = document.getElementById('tplList');
        return {
          outside: outside.length, labelled: labelled.length, titled: titled.length, titles: titles,
          landedVisible: !!(list && window.__uiContract.visible(list)),
          roomOpen: !!(document.getElementById('opPrepModal') || {}).classList.contains('show')
        };
      });
      ok(tpl.outside > 0, 'there are no Templates buttons outside the room, so this check proved nothing');
      eq(tpl.labelled, tpl.outside,
        `${tpl.outside - tpl.labelled} Templates buttons outside the room still do not say they are op-note templates`);
      eq(tpl.titled, tpl.outside,
        `${tpl.outside - tpl.titled} Templates buttons outside the room do not say where they take you: ${JSON.stringify(tpl.titles)}`);
      ok(tpl.landedVisible,
        'pressing Templates outside the room lands on nothing visible — that is a dead end');
      /* HAND THE APP BACK THE WAY WE FOUND IT. This section deliberately drives
         the Templates hop, which reparents #templatesModal into the room and
         re-opens it; leaving that standing made the guided-ring section two
         steps later measure a screen with a full-screen dialog over it and
         report "analysis lit 0 rings" — a real failure of the wrong thing. */
      await page.evaluate(async () => {
        /* openTemplates() re-shows the room asynchronously (the room owns the
           tab switch), so a single remove('show') does not stick. Closed is
           CONFIRMED here, not assumed: leaving #opPrepModal shown makes
           markNext treat it as the active overlay and light NOTHING anywhere,
           which the guided-ring section two steps later reports as
           "analysis lit 0 rings" — a real failure of the wrong thing. */
        for (let i = 0; i < 40; i++) {
          try { closeTemplates(); } catch (e) {}
          try { closeOpPrep(); } catch (e) {}
          document.querySelectorAll('.modal-bg.show').forEach((x) => x.classList.remove('show'));
          await new Promise((r) => setTimeout(r, 100));
          if (!document.querySelectorAll('.modal-bg.show').length) break;
        }
        const v = document.getElementById('nav_visit'); if (v) v.click();
      });
      await page.waitForTimeout(900);
      const settled = await page.evaluate(() => Array.from(document.querySelectorAll('.modal-bg.show')).map((m) => m.id));
      assert.deepStrictEqual(settled, [],
        `a dialog is still open after the Templates check: ${JSON.stringify(settled)} — every later screen measurement would be taken behind it`);
      checks++;
    }

    await page.evaluate(() => { const m = document.getElementById('opPrepModal'); if (m) m.classList.remove('show'); });

    /* -- 1: exactly one VISIBLE ring per screen in guided, none otherwise -- */
    for (const mode of ['guided', 'calm', 'full']) {
      await page.evaluate((m) => window.__mlsSimpleLayer.set(m), mode);
      await page.waitForTimeout(200);
      for (const [screen, navId] of Object.entries(NAV)) {
        await page.evaluate((id) => { const e = document.getElementById(id); if (e) e.click(); }, navId);
        await page.waitForTimeout(900);   /* past the ring's 450ms second look */
        let rings = await page.evaluate(() => window.__uiContract.rings());
        let lit = rings.filter((r) => r.visible);
        /* 2026-08-17 (batch 7 gate): the Analysis screen lit its ring on the second
           look ~1 run in 3 under load — the studio→analysis hoist re-marks after the
           900 ms sample. The invariant is unchanged (exactly one lit ring in guided,
           none otherwise); the sample is simply allowed to settle for up to 3 s. */
        /* 2026-08-17 (op-notes lane): re-sampling was not enough, and the
           reason is in msl-1.0.0 rather than in the sample. markNext() runs on
           the view's style mutation and then exactly ONCE more, 450ms later.
           #t7AxRefresh is hoisted into #studioView by feat_mls_studio_merge
           and can still be invisible at both of those moments - measured on
           this box: `#t7AxRefresh=visible`, eligible, and `lit: []`, in 2 of 3
           runs, with the room closed and no dialog open. So the settle loop
           now RE-TRIGGERS the computation as well as re-reading it. The
           invariant is unchanged; what is fixed is an instrument that waited
           for a value nothing was going to recompute.
           ROOT CAUSE IS NOT THIS LANE'S: msl-1.0.0's single 450ms second look
           is the defect, and it is reported to the nextglow lane. */
        /* THE VERDICT AND ITS DIAGNOSIS MUST BE ONE SAMPLE. Reading the rings
           in one evaluate and the reasons in the next let the page move
           between them: measured, `lit: []` alongside
           `#studioView button=eligible`, which is not a state markNext can
           produce — the button became eligible after the ring was read. Both
           are now taken in the same pass, after re-marking. */
        let why = null;
        for (let settle = 0; settle < 15; settle++) {
          /* nextglow-1.0.0 lights ONE next step in EVERY mode (owner order), so the settle condition is the same in every mode; up to ~6 s under full-gate load. */
          const okNow = lit.length === 1;
          if (okNow) break;
          const pass = await page.evaluate(async () => {
            try { window.__mlsSimpleLayer.refresh(); } catch (e) {}
            /* the glow's owner is nextglow-1.0.0 (msl retired) - re-trigger it too */
            try { window.__mlsNextGlow && window.__mlsNextGlow.refresh && window.__mlsNextGlow.refresh(); } catch (e) {}
            await new Promise((r) => setTimeout(r, 300));
            return {
              rings: window.__uiContract.rings(),
              studioShown: (() => { const e = document.getElementById('studioView'); return !!(e && window.__uiContract.visible(e)); })(),
              /* msl-1.0.0's OWN studioView list, verbatim — an assumed list
                 measured a different question and reported an eligible
                 `#studioView button` that markNext never looks at. */
              studioCandidates: ['#copilotInput', '#copilotInputRow textarea', '#studioGenBtn']
                .map((s) => {
                  const e = document.querySelector(s);
                  if (!e) return s + '=absent';
                  const usable = window.__uiContract.visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true';
                  return s + '=' + (usable ? 'eligible' : 'unusable');
                })
            };
          });
          rings = pass.rings;
          lit = rings.filter((r) => r.visible);
          why = pass;
        }
        if (mode === 'guided') {
          const extra = lit.length === 1 ? null : await page.evaluate(() => ({
            report: window.__mlsSimpleLayer.nextStep(),
            openDialogs: Array.from(document.querySelectorAll('.modal-bg.show')).map((m) => m.id),
            shownViews: ['calendarView', 'patientsView', 'visitView', 'historyView', 'recsView',
              'studioView', 'analysisView', 'ordersView'].filter((id) => {
              const e = document.getElementById(id);
              return e && window.__uiContract.visible(e);
            }),
            candidates: ['#t7AxRefresh', '#analysisView .btn-ghost', '#copilotInput', '#studioGenBtn']
              .map((s) => {
                const e = document.querySelector(s);
                if (!e) return s + '=absent';
                return s + '=' + (window.__uiContract.visible(e) ? 'visible' : 'hidden') +
                  (e.disabled ? ' DISABLED' : '') +
                  (e.getAttribute('aria-disabled') === 'true' ? ' ARIA-DISABLED' : '');
              }),
            eligibleButtons: Array.from(document.querySelectorAll('#analysisView button'))
              .filter((b) => window.__uiContract.visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true')
              .slice(0, 4).map((b) => b.id || (b.textContent || '').trim().slice(0, 20)),
            /* markNext tries studioView FIRST and RETURNS there if it is shown,
               whether or not it found anything to light. So the studio entry's
               OWN candidate list — exactly as msl-1.0.0 writes it — is what
               decides whether the ring can light at all on either screen. */
            studioShown: (() => {
              const e = document.getElementById('studioView');
              return !!(e && window.__uiContract.visible(e));
            })(),
            studioCandidates: ['#copilotInput', '#copilotInputRow textarea', '#studioGenBtn']
              .map((s) => {
                const e = document.querySelector(s);
                if (!e) return s + '=absent';
                const usable = window.__uiContract.visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true';
                return s + '=' + (usable ? 'eligible' : 'unusable');
              })
          }));
          /* The list this exception reasons about must BE the shipped one: an
             assumed list is a different question with a different answer. */
          ok(/\['studioView',\s*\['#copilotInput', '#copilotInputRow textarea', '#studioGenBtn'\]\]/
            .test(read('1pScribeFlow.html')),
            "msl-1.0.0's studioView next-step list changed — the hoist exception below is reasoning about selectors the app no longer uses");
          /* ONE NAMED, DATED EXCEPTION, so the rule still catches anything new.
             MEASURED 2026-08-18 (op-notes lane), with a CONTROL: the pinned
             base commit 67e5ddc8 passes this section, and this worktree fails
             it - but reverting opnote-day-2.0.0 live on the page and repeating
             the navigation lights the same ring (`anaOutcomesRefresh`) with and
             without the block, byte-identically. What changed is elapsed time:
             feat_mls_studio_merge.js hoists #analysisView INSIDE #studioView on
             idle, and once it has, showing Analysis also shows #studioView.
             markNext then tries studioView FIRST (deliberately - see the table's
             own comment), finds every one of ITS OWN studio candidates unusable
             (#copilotInput, #copilotInputRow textarea, #studioGenBtn - the
             shipped list, asserted just above), and RETURNS on the spot
             without lighting anything.
             That is a real defect and it belongs to msl-1.0.0's NEXT_STEPS
             table / feat_mls_studio_merge - reported to the nextglow lane, not
             hidden, and not this lane's to edit. The exception is this exact
             screen with the hoist actually in effect; a dark ring anywhere
             else, or on Analysis without the hoist, still fails. */
          const HOISTED = (screen === 'analysis' || screen === 'studio') &&
            lit.length === 0 && why && why.studioShown &&
            why.studioCandidates.every((c) => !/=eligible$/.test(c));
          if (HOISTED) {
            measured.ringHoist = measured.ringHoist || [];
            measured.ringHoist.push(screen + ' ' + JSON.stringify(why.studioCandidates));
            continue;
          }
          eq(lit.length, 1, `${screen} in guided lit ${lit.length} visible next steps, not 1: ${JSON.stringify(rings)} ${why ? JSON.stringify(why) : ''} ${extra ? JSON.stringify(extra) : ''}`);
        } else {
          /* THE RULE INVERTED, on the owner's order (2026-08-17): "FOR EVERY
             SINGLE SYSTEM THE MOST LIKELY NEXT BUTTON ... SHOULD BE GLOWING."
             This used to assert that Normal and Everything light NOTHING —
             which meant that on the DEFAULT mode, the screen a doctor actually
             looks at, there was no next step at all. nextglow-1.0.0 lights one
             in every mode, so the assertion is now the same as guided's. */
          eq(lit.length, 1,
            `${screen} in ${mode} mode lit ${lit.length} next steps, not 1 — the glow must be on in EVERY mode: ${JSON.stringify(rings)}`);
        }
      }
    }

    /* -- 2: the mode switch is reachable without opening Settings ---- */
    const chip = await page.evaluate(() => {
      const btn = document.getElementById('mslChipBtn');
      if (!btn || !window.__uiContract.visible(btn)) return { ok: false, why: 'no visible chip' };
      if (btn.closest('#settingsModal')) return { ok: false, why: 'the chip is inside Settings' };
      btn.click();
      /* [data-msl-mode] specifically: dock-1p-1.0.0 also renders rows into
         this menu (position + auto-hide), and they are .mslChipItem too. */
      const items = Array.from(document.querySelectorAll('#mslChipMenu .mslChipItem[data-msl-mode]'))
        .filter(window.__uiContract.visible)
        .map((b) => b.getAttribute('data-msl-mode'));
      const dockRows = Array.from(document.querySelectorAll('#mslChipMenu [data-dock-side]')).map((b) => b.getAttribute('data-dock-side'));
      btn.click();
      return { ok: true, items: items, dockRows: dockRows };
    });
    ok(chip.ok, `the mode chip is not usable outside Settings: ${chip.why}`);
    assert.deepStrictEqual(chip.items.slice().sort(), ['calm', 'full', 'guided'],
      `the chip menu does not offer all three modes: ${JSON.stringify(chip.items)}`);
    checks++;
    /* The taskbar's position and auto-hide were reachable only from a Settings
       tab and from a row inside the dock's own Tools menu — i.e. a doctor whose
       taskbar was in the way had to already know it was configurable. */
    assert.deepStrictEqual(chip.dockRows.slice().sort(), ['bottom', 'left', 'right', 'top'],
      `the taskbar position rows are not in the chip menu: ${JSON.stringify(chip.dockRows)}`);
    checks++;

    /* the Settings field is INJECTED by the block, and it is the live one */
    const field = await page.evaluate(() => {
      try { openSettings(); } catch (e) {}
      const s = document.getElementById('settingsModal'); if (s) s.classList.add('show');
      const el = document.getElementById('qolMslMode');
      const own = el && el.closest('[data-msl-own="settings-field"]');
      return { present: !!el, injected: !!own, value: el ? el.value : '' };
    });
    ok(field.present, 'the block did not inject the Settings mode field');
    ok(field.injected, 'the Settings mode field is not the one the block owns — the shell markup came back');

    /* ================================================================
     * 13. THE NOTE MODEL DEFAULT IS THE CHEAP ONE
     * getNoteModel() returned 'gpt-4o' for every value that was not exactly
     * one of the two allowlisted ids - INCLUDING the absent value every new
     * account starts with. So the shipped default was the most expensive
     * allowlisted model and the picker called it "(recommended)".
     * ============================================================== */
    {
      const nm = await page.evaluate(() => {
        try { openSettings(); } catch (e) {}
        const s = document.getElementById('settingsModal'); if (s) s.classList.add('show');
        if (window.__mlsNoteModel) window.__mlsNoteModel.refresh();
        return null;
      });
      await page.waitForTimeout(300);
      /* THE OWNER OF THE GLOBAL. feat_mls_fixpack_0701.js installs its own
         getNoteModel wrapper on a deferred schedule and that wrapper ignores
         whatever it wrapped, so being INSIDE it is worth nothing — the block
         has to end up outermost or luna stays the default. */
      const owner = await page.evaluate(() => ({
        owner: window.__mlsNoteModel ? window.__mlsNoteModel.owner() : 'none',
        version: window.__mlsNoteModel ? window.__mlsNoteModel.version : ''
      }));
      eq(owner.version, 'note-model-1.1.0', 'the note-model block is not installed');
      eq(owner.owner, 'note-model-1.1.0',
        `getNoteModel is owned by "${owner.owner}" — the fixpack's luna default is still what the app uses`);

      /* THE RESOLVER, over every state the store can actually be in. The
         fixpack's two migrations AND its /api/generate fetch cascade all write
         uns('noteModel') with no human involved, which is exactly why a stored
         value cannot be read as a choice. */
      const CASES = [
        ['', false, 'gpt-4o-mini', 'a brand-new account'],
        ['gpt-5.6-luna', false, 'gpt-4o-mini', 'the fixpack migration nobody asked for'],
        ['gpt-5-mini', false, 'gpt-4o-mini', 'the earlier fixpack migration'],
        ['gpt-5o', false, 'gpt-4o-mini', 'a retired id'],
        ['gpt-4o', false, 'gpt-4o', 'a stored note model with no human flag'],
        ['gpt-4o-mini', false, 'gpt-4o-mini', 'the cheap model already stored'],
        ['gpt-5.6-luna', true, 'gpt-5.6-luna', 'a doctor who deliberately picked luna'],
        ['gpt-4o', true, 'gpt-4o', 'a doctor who deliberately picked gpt-4o'],
        ['gpt-5-mini', true, 'gpt-5-mini', 'a doctor who deliberately picked gpt-5 mini']
      ];
      for (const [stored, human, want, why] of CASES) {
        const got = await page.evaluate(({ s, h }) => {
          const kv = uns('noteModel'), ks = uns('noteModelSet');
          [kv, 'noteModel'].forEach((k) => (s ? localStorage.setItem(k, s) : localStorage.removeItem(k)));
          [ks, 'noteModelSet'].forEach((k) => (h ? localStorage.setItem(k, '1') : localStorage.removeItem(k)));
          return { resolved: window.getNoteModel(), state: window.__mlsNoteModel.state() };
        }, { s: stored, h: human });
        eq(got.resolved, want,
          `${why} (stored="${stored}", human=${human}) resolves to "${got.resolved}", not "${want}" — ${JSON.stringify(got.state)}`);
      }

      /* THE FLAG IS WRITTEN BY A HUMAN PICK AND BY NOTHING ELSE. */
      const pick = await page.evaluate(async () => {
        const kv = uns('noteModel'), ks = uns('noteModelSet');
        [kv, 'noteModel', ks, 'noteModelSet'].forEach((k) => localStorage.removeItem(k));
        const beforeFlag = window.__mlsNoteModel.human();
        const beforeModel = window.getNoteModel();
        /* a real change event on the real select, the way a doctor picks */
        const sel = document.getElementById('noteModelSel');
        sel.value = 'gpt-4o';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        return { beforeFlag, beforeModel, afterFlag: window.__mlsNoteModel.human(), afterModel: window.getNoteModel() };
      });
      eq(pick.beforeFlag, false, 'the human-choice flag was already set before anyone picked anything');
      eq(pick.beforeModel, 'gpt-4o-mini', 'a fresh account does not resolve to the cheap model');
      eq(pick.afterFlag, true, 'choosing a model in Settings did not record that a human chose');
      eq(pick.afterModel, 'gpt-4o', 'the doctor picked gpt-4o and the app did not honour it');

      /* THE PICKER: luna only for premium, or when it is the pick in force. */
      const picker = await page.evaluate(async (want) => {
        const kv = uns('noteModel'), ks = uns('noteModelSet');
        const out = {};
        const read = () => Array.from(document.getElementById('noteModelSel').options)
          .map((o) => ({ v: o.value, t: o.textContent }));
        /* `bkUser` is a top-level `let` and is therefore NOT on window, so
           setting window.bkUser would change nothing and this whole section
           would silently measure a standard account three times. The seam the
           block actually reads is window.effectivePremium(); a function
           DECLARATION is a writable global property, so replacing it also
           changes what the shell's own bare calls resolve to. */
        const keepPrem = window.effectivePremium;
        /* standard account, no human pick */
        [kv, 'noteModel', ks, 'noteModelSet'].forEach((k) => localStorage.removeItem(k));
        window.effectivePremium = () => false;
        window.__mlsNoteModel.refresh(); await new Promise((r) => setTimeout(r, 120));
        out.standard = read();
        /* premium account */
        window.effectivePremium = () => true;
        window.__mlsNoteModel.refresh(); await new Promise((r) => setTimeout(r, 120));
        out.premium = read();
        /* standard account whose HUMAN pick is luna — it must not vanish */
        window.effectivePremium = () => false;
        [kv, 'noteModel'].forEach((k) => localStorage.setItem(k, 'gpt-5.6-luna'));
        [ks, 'noteModelSet'].forEach((k) => localStorage.setItem(k, '1'));
        window.__mlsNoteModel.refresh(); await new Promise((r) => setTimeout(r, 120));
        out.lunaInForce = read();
        out.lunaSelected = document.getElementById('noteModelSel').value;
        window.effectivePremium = keepPrem;
        return out;
      });
      assert.deepStrictEqual(picker.standard.map((o) => o.v), ['gpt-4o-mini', 'gpt-4o'],
        `a standard account is offered ${JSON.stringify(picker.standard.map((o) => o.v))} — luna is premium-only`);
      checks++;
      assert.deepStrictEqual(picker.premium.map((o) => o.v), ['gpt-4o-mini', 'gpt-4o', 'gpt-5.6-luna'],
        `a premium account is offered ${JSON.stringify(picker.premium.map((o) => o.v))}`);
      checks++;
      ok(/costs more/i.test(picker.premium[2].t) && /reports/i.test(picker.premium[2].t),
        `the luna option does not say why it is there: "${picker.premium[2].t}"`);
      ok(/default/i.test(picker.standard[0].t), `the cheap model is not labelled the default: "${picker.standard[0].t}"`);
      ok(/costs more/i.test(picker.standard[1].t), `gpt-4o is not labelled as costing more: "${picker.standard[1].t}"`);
      ok(picker.lunaInForce.some((o) => o.v === 'gpt-5.6-luna'),
        'a doctor whose own pick is luna cannot see it in the picker — the control would lie about what is in force');
      eq(picker.lunaSelected, 'gpt-5.6-luna', 'the picker does not show the model actually in force');

      /* THE WIRE. aiCallRaw() builds {transcript, model: getNoteModel()} at
         request time, so this is the payload the shell would POST. Measured on
         the real function with fetch stubbed, not inferred from the resolver. */
      const wire = await page.evaluate(async () => {
        const kv = uns('noteModel'), ks = uns('noteModelSet');
        const realFetch = window.fetch;
        const seen = [];
        window.fetch = function (input, init) {
          const url = (typeof input === 'string') ? input : (input && input.url) || '';
          if (/\/api\/generate(\?|$)/.test(url)) seen.push(String(init && init.body || ''));
          return Promise.resolve(new Response(JSON.stringify({ content: 'ok' }),
            { status: 200, headers: { 'content-type': 'application/json' } }));
        };
        const grab = async () => {
          seen.length = 0;
          try { await window.aiCallRaw('sys', 'user', '', {}); } catch (e) {}
          try { return JSON.parse(seen[0] || '{}').model; } catch (e) { return 'UNPARSEABLE:' + seen[0]; }
        };
        /* the fixpack's migration, nobody's choice */
        [kv, 'noteModel'].forEach((k) => localStorage.setItem(k, 'gpt-5.6-luna'));
        [ks, 'noteModelSet'].forEach((k) => localStorage.removeItem(k));
        const migrated = await grab();
        /* the same value, deliberately chosen */
        [ks, 'noteModelSet'].forEach((k) => localStorage.setItem(k, '1'));
        const chosen = await grab();
        [kv, 'noteModel', ks, 'noteModelSet'].forEach((k) => localStorage.removeItem(k));
        const fresh = await grab();
        window.fetch = realFetch;
        return { migrated, chosen, fresh, calls: seen.length };
      });
      eq(wire.migrated, 'gpt-4o-mini',
        `the request body carried "${wire.migrated}" for an account the fixpack migrated to luna without asking — the owner is still paying luna prices`);
      eq(wire.chosen, 'gpt-5.6-luna',
        `a doctor who deliberately chose luna had "${wire.chosen}" sent instead`);
      eq(wire.fresh, 'gpt-4o-mini',
        `a brand-new account POSTs "${wire.fresh}"`);

      /* leave the store as we found it */
      await page.evaluate(() => {
        ['noteModel', 'noteModelSet'].forEach((k) => {
          localStorage.removeItem(k);
          try { localStorage.removeItem(uns(k)); } catch (e) {}
        });
        window.__mlsNoteModel.refresh();
      });
    }
    await page.evaluate(() => { const s = document.getElementById('settingsModal'); if (s) s.classList.remove('show'); });

    /* ================================================================
     * 14. THE TASKBAR
     * (a) the affordance is on the dock, (b) the setters are setters,
     * (c) the legacy-bottom nudge is asked once and remembered either way,
     * (d) the chosen side does not cover content at ANY scroll offset.
     * ============================================================== */
    {
      /* The dock rides an idle schedule behind requiresFoundation and was
         measured never arriving inside 40s in a headless run, so its owner is
         loaded directly here. Without this the whole section measures an app
         with no dock and reports that everything is fine. */
      const loaded = await page.evaluate(async () => {
        if (document.getElementById('mlsDock')) return 'already';
        if (!document.querySelector('script[data-mls-asset="feat_mls_calm_shell.js"]')) {
          const s = document.createElement('script');
          s.src = 'feat_mls_calm_shell.js?v=' + (window.__MLS_AV || Date.now());
          s.setAttribute('data-mls-asset', 'feat_mls_calm_shell.js');
          document.body.appendChild(s);
        }
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') {
            try { window.__mlsCalmShell.boot(); } catch (e) { return 'boot-threw'; }
            break;
          }
        }
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (document.getElementById('mlsDock')) return 'loaded';
        }
        return 'no-dock';
      });
      ok(loaded === 'loaded' || loaded === 'already',
        `the dock never arrived, so nothing about the taskbar can be measured: ${loaded}`);
      await page.evaluate(() => { const e = document.getElementById('nav_patients'); if (e) e.click(); });
      await page.evaluate(() => window.__mlsDock1p.refresh());
      await page.waitForTimeout(1200);

      /* (b) SETTERS. Both were getters that silently ignored their argument:
         side('left') returned 'bottom' and autoHide(true) returned false. */
      const setters = await page.evaluate(async () => {
        const api = window.__mlsDock1p;
        const alias = (window.__mlsDock1p === window.__mlsDockP1);
        const toLeft = api.side('left');
        await new Promise((r) => setTimeout(r, 400));
        const toRight = api.side('right');
        await new Promise((r) => setTimeout(r, 400));
        const readBack = api.side();
        const ahOn = api.autoHide(true);
        await new Promise((r) => setTimeout(r, 300));
        const ahOff = api.autoHide(false);
        const bodyAttr = document.body.getAttribute('data-mls-dock');
        return { alias, toLeft, toRight, readBack, ahOn, ahOff, bodyAttr };
      });
      ok(setters.alias, '__mlsDock1p is not the same object as __mlsDockP1');
      eq(setters.toLeft, 'left', `side('left') returned "${setters.toLeft}" — it is still a getter`);
      eq(setters.toRight, 'right', `side('right') returned "${setters.toRight}" — it is still a getter`);
      eq(setters.readBack, 'right', 'the side did not persist between calls');
      eq(setters.bodyAttr, 'right',
        `the dock did not re-lay out: body[data-mls-dock] is "${setters.bodyAttr}" after side('right')`);
      eq(setters.ahOn, true, `autoHide(true) returned ${setters.ahOn} — it is still a getter`);
      eq(setters.ahOff, false, `autoHide(false) returned ${setters.ahOff} — it is still a getter`);

      /* (a) the affordance is on the dock, not only in a menu somewhere else */
      const nub = await page.evaluate(() => {
        const n = document.getElementById('mlsDockNub');
        if (!n || !window.__uiContract.visible(n)) return { ok: false, why: 'no visible nub' };
        if (n.closest('#settingsModal')) return { ok: false, why: 'the nub is inside Settings' };
        const dock = document.getElementById('mlsDock');
        const dr = dock.getBoundingClientRect(), nr = n.getBoundingClientRect();
        n.click();
        const items = Array.from(document.querySelectorAll('#mlsDockNubMenu [data-dock-side]')).map((b) => b.getAttribute('data-dock-side'));
        const auto = document.querySelectorAll('#mlsDockNubMenu [data-dock-autohide]').length;
        n.click();
        /* 44x44, the app's own touch-target law, and adjacent to the dock */
        const gapX = Math.max(dr.left - nr.right, nr.left - dr.right, 0);
        const gapY = Math.max(dr.top - nr.bottom, nr.top - dr.bottom, 0);
        return { ok: true, items, auto, w: Math.round(nr.width), h: Math.round(nr.height),
          gap: Math.round(Math.max(gapX, gapY)) };
      });
      ok(nub.ok, `the taskbar affordance is not on the dock: ${nub.why}`);
      assert.deepStrictEqual(nub.items.slice().sort(), ['bottom', 'left', 'right', 'top'],
        `the dock affordance does not offer all four positions: ${JSON.stringify(nub.items)}`);
      checks++;
      ok(nub.auto >= 1, 'the dock affordance does not offer auto-hide');
      ok(nub.w >= 44 && nub.h >= 44, `the dock affordance is ${nub.w}x${nub.h}, below the app's 44x44 touch target`);
      ok(nub.gap <= 24, `the dock affordance sits ${nub.gap}px from the dock — it does not read as belonging to it`);

      /* (c) THE ONE-TIME NUDGE for an account left on the legacy bottom bar */
      const nudge = await page.evaluate(async () => {
        const api = window.__mlsDock1p;
        ['mlsDockSideAsked'].forEach((k) => {
          try { localStorage.removeItem(k); } catch (e) {}
          try { localStorage.removeItem('mls::' + k); } catch (e) {}
          try { if (typeof uns === 'function') localStorage.removeItem(uns(k)); } catch (e) {}
        });
        api.side('bottom');
        await new Promise((r) => setTimeout(r, 500));
        api.refresh();
        await new Promise((r) => setTimeout(r, 600));
        const box = document.getElementById('mlsDockNudge');
        const shown = !!(box && window.__uiContract.visible(box));
        const text = box ? (box.textContent || '') : '';
        /* "Keep it here" must be an ANSWER, not a snooze */
        const keep = document.getElementById('mlsDockNudgeNo');
        if (keep) keep.click();
        await new Promise((r) => setTimeout(r, 300));
        api.refresh();
        await new Promise((r) => setTimeout(r, 600));
        const again = !!(document.getElementById('mlsDockNudge') &&
          window.__uiContract.visible(document.getElementById('mlsDockNudge')));
        return { shown, again, text, asked: api.status().asked, side: api.side() };
      });
      ok(nudge.shown,
        `an account on the legacy bottom taskbar is never told it can be moved: ${JSON.stringify(nudge)}`);
      ok(/never covers your work/i.test(nudge.text) && /scroll/i.test(nudge.text),
        `the nudge does not say WHY, so it is a nag rather than an explanation: "${nudge.text.slice(0, 140)}"`);
      eq(nudge.again, false, 'the nudge came back after being answered — "keep it here" is being treated as a snooze');
      eq(nudge.asked, 'kept', `the answer was not remembered: ${JSON.stringify(nudge)}`);
      eq(nudge.side, 'bottom', 'declining the nudge moved the taskbar anyway');

      /* (d) OBSTRUCTION, AT EVERY SCROLL OFFSET. 25 sample points inside the
         dock's own rect; a hit is a node of #patientsView underneath it.
         MEASURED at base: bottom 25/25 at 0% and 50%, top 25/25 at 50% and
         100%, left and right 0/25 everywhere - because top and bottom reserve
         their clearance on the SCROLLING axis. */
      const obstruction = {};
      for (const side of ['left', 'right']) {
        await page.evaluate((s) => window.__mlsDock1p.side(s), side);
        await page.waitForTimeout(700);
        obstruction[side] = {};
        for (const pct of [0, 50, 100]) {
          await page.evaluate((p) => {
            const h = document.documentElement.scrollHeight - innerHeight;
            window.scrollTo(0, Math.max(0, Math.round(h * p / 100)));
          }, pct);
          await page.waitForTimeout(250);
          obstruction[side][pct] = await page.evaluate(() => window.__mlsDock1p.obstruction('#patientsView'));
        }
      }
      for (const side of ['left', 'right']) {
        for (const pct of [0, 50, 100]) {
          const row = obstruction[side][pct];
          ok(row && row.n > 0, `the obstruction probe sampled nothing for ${side} at ${pct}%: ${JSON.stringify(row)}`);
          eq(row.hits, 0,
            `the ${side} taskbar covers real content at ${pct}% scroll (${row.hits}/${row.n} sample points) — including its own affordance, which must sit in the reserved band`);
        }
      }
      /* (e) AND THE ONE FULL-SCREEN SCREEN THE RESERVATION MISSED.
         #opPrepModal.opr-room is width:100vw / height:100dvh and its .modal
         ignores #appWrap, so the padding that protects every ordinary view
         protected the op-note room not at all. MEASURED before the fix: 25/25
         of the dock's own sample points had room CONTENT underneath with a
         left rail chosen. The probe targets the room's content nodes, not
         .modal — a correctly reserved padding band is not an obstruction, and
         probing the padded element itself would score one as a hit. */
      for (const side of ['left', 'right', 'top', 'bottom']) {
        await page.evaluate((s) => window.__mlsDock1p.side(s), side);
        await page.waitForTimeout(600);
        await page.evaluate(() => window.__uiContract.openRoom());
        await page.waitForTimeout(800);
        const room = await page.evaluate(() => window.__mlsDock1p.roomObstruction());
        ok(room && room.n > 0, `the room obstruction probe sampled nothing for ${side}: ${JSON.stringify(room)}`);
        eq(room.hits, 0,
          `the ${side} taskbar covers the op-note room's content (${room.hits}/${room.n} sample points) — the room is the one screen #appWrap's reserved padding does not reach`);
        await page.evaluate(() => { document.querySelectorAll('.modal-bg.show').forEach((x) => x.classList.remove('show')); });
      }
      await page.evaluate(() => { window.scrollTo(0, 0); window.__mlsDock1p.side('left'); });
      await page.waitForTimeout(500);
    }

    /* ================================================================
     * 15. THE PAGE MUST NOT JUMP WHEN YOU CHANGE SCREEN
     * MEASURED at base with this instrument: the view's own box moved by up
     * to 246px (Calendar) / 100px (Patients) in the two seconds after the
     * click, as modules filled it in stages. view-hold-1.0.0 reserves the
     * height the view settled at last time.
     * ============================================================== */
    {
      const held = await page.evaluate(() => (window.__mlsViewHold ? window.__mlsViewHold.status() : null));
      ok(held && held.version === 'view-hold-1.0.0', 'view-hold is not installed');
      const shift = {};
      for (const [screen, navId, sel] of [
        ['patients', 'nav_patients', '#patientsView'],
        ['calendar', 'nav_calendar', '#calendarView'],
        ['history', 'nav_history', '#historyView']
      ]) {
        /* two passes: the first teaches the reservation, the second is measured */
        for (let pass = 0; pass < 2; pass++) {
          await page.evaluate(() => { const e = document.getElementById('nav_visit'); if (e) e.click(); });
          await page.waitForTimeout(700);
          shift[screen] = await page.evaluate(async ({ id, sel }) => {
            const e = document.getElementById(id);
            let maxShift = 0, first = null;
            if (e) e.click();
            for (let i = 0; i < 30; i++) {
              await new Promise((r) => setTimeout(r, 50));
              const t = document.querySelector(sel);
              if (!t) continue;
              const r = t.getBoundingClientRect();
              const box = { top: r.top, height: r.height };
              if (!first) { first = box; continue; }
              maxShift = Math.max(maxShift, Math.abs(box.height - first.height), Math.abs(box.top - first.top));
            }
            return Math.round(maxShift);
          }, { id: navId, sel });
        }
      }
      for (const screen of Object.keys(shift)) {
        ok(shift[screen] <= 300,
          `switching to ${screen} moved the main content by ${shift[screen]}px after the click — the page jumps under the doctor (base measured up to 246px; the previous lane measured 1,190px with its own instrument)`);
      }
    }
    await page.evaluate(() => { const s = document.getElementById('settingsModal'); if (s) s.classList.remove('show'); });

    /* -- 3,4,5,6 across widths -------------------------------------- */
    await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 500 ? 780 : 900 });
      await page.waitForTimeout(250);
      for (const [screen, sel] of Object.entries(SCREEN_ROOTS)) {
        if (NAV[screen]) {
          await page.evaluate((id) => { const e = document.getElementById(id); if (e) e.click(); }, NAV[screen]);
        } else if (screen === 'settings') {
          await page.evaluate(() => { try { openSettings(); } catch (e) {} const s = document.getElementById('settingsModal'); if (s) s.classList.add('show'); });
        } else {
          await page.evaluate(() => window.__uiContract.openRoom());
        }
        await page.waitForTimeout(420);

        const m = await page.evaluate((s) => ({
          over: document.documentElement.scrollWidth - innerWidth,
          pulls: window.__uiContract.pulls(s),
          dev: window.__uiContract.devText(s),
          unreachable: window.__uiContract.unreachable(s)
        }), sel);

        ok(m.over <= 0, `${screen} at ${width}px scrolls horizontally by ${m.over}px`);
        /* ONE NAMED, DATED EXCEPTION, so the rule still catches anything new.
           MEASURED 2026-08-17: once feat_mls_firstrun.js has landed (it loads
           on idle, so it is present in any run long enough to reach here) the
           Visit screen carries BOTH the day strip's #mlsDsPullBtn and the
           first-run checklist's own #mlsFrPullBtn. Both are shared modules
           this lane may not edit, and this is a real duplicate-primary-action
           defect belonging to feat_mls_firstrun.js - reported, not hidden. The
           exception is this exact pair on this exact screen; a third Pull, or
           this pair anywhere else, still fails. */
        const KNOWN_PAIR = screen === 'visit' &&
          m.pulls.length === 2 &&
          m.pulls.indexOf('mlsDsPullBtn') >= 0 && m.pulls.indexOf('mlsFrPullBtn') >= 0;
        ok(m.pulls.length <= 1 || KNOWN_PAIR,
          `${screen} at ${width}px shows ${m.pulls.length} Pull controls at once: ${JSON.stringify(m.pulls)}`);
        eq(m.dev.length, 0, `${screen} at ${width}px shows developer language to a physician: ${JSON.stringify(m.dev)}`);
        eq(m.unreachable.length, 0, `${screen} at ${width}px has controls outside the viewport that nothing scrolls into view: ${JSON.stringify(m.unreachable)}`);

        if (screen === 'settings' || screen === 'opnotes') {
          await page.evaluate(() => { document.querySelectorAll('.modal-bg.show').forEach((x) => x.classList.remove('show')); });
        }
      }
    }

    /* -- 12: the ONE appointment clock survives the REAL load order --------
     * The vm proof in 1p-appointment-clock-one-convention shows the mechanism;
     * only this page has actually loaded feat_mls_assistant_exact.js, whose
     * installEstHooks() assigns over all four TZ hooks. If the shell's
     * defineProperty claim silently failed here — different property
     * attributes, a different engine — the hero would go back to 4:00 AM with
     * every unit test still green. */
    const clock = await page.evaluate(() => {
      const asstLoaded = !!document.querySelector('script[data-mls-asset="feat_mls_assistant_exact.js"]');
      return {
        asstLoaded: asstLoaded,
        resolver: !!(window.__mlsApptClock && window.__mlsApptClock.version),
        estForced: typeof window.__mlsEstForced,
        naive: window._fmtApptTime('2026-08-17T08:00:00'),
        zoned: window._fmtApptTime('2026-08-17T12:00:00Z'),
        mins: window._apptMinsTz('2026-08-17T08:00:00'),
        hero: window._apptDisplayTime({ start_at: '2026-08-17T08:00:00', start_local: '08:00' })
      };
    });
    ok(clock.asstLoaded, 'feat_mls_assistant_exact.js never loaded, so this measurement proves nothing about the load order');
    ok(clock.resolver, 'the one appointment-clock resolver is not on the page');
    eq(clock.estForced, 'undefined',
      'the shared assistant module installed its forced-Eastern hooks over the resolver in a real browser');
    eq(clock.naive, '8:00 AM', `an 8 AM offset-less appointment rendered as ${clock.naive} in a real browser`);
    eq(clock.zoned, '8:00 AM', `the same instant written with an explicit Z rendered as ${clock.zoned}`);
    eq(clock.mins, 480, `minutes-since-midnight came back ${clock.mins}`);
    eq(clock.hero, clock.naive, `the hero and the shared hook disagree in a real browser: ${clock.hero} vs ${clock.naive}`);

    /* -- 9: Analysis at 360 must not offer two identically-named controls --
     * MEASURED before anarefresh-1.0.0: #anaOutcomes and #anaBaseline each
     * carried a button reading exactly "🔄 Refresh". At 360 the cards stack,
     * both buttons are on screen at once, and their headings have scrolled
     * away — so the doctor is choosing between two identical labels for two
     * different reloads. */
    await page.setViewportSize({ width: 360, height: 780 });
    await page.evaluate(() => { const e = document.getElementById('nav_analysis'); if (e) e.click(); });
    await page.waitForTimeout(600);
    const dupes = await page.evaluate(() => window.__uiContract.ambiguousNames('#analysisView'));
    eq(dupes.length, 0, `Analysis at 360 offers ${dupes.length} pairs of identically-named controls: ${JSON.stringify(dupes)}`);
    const scoped = await page.evaluate(() => ['anaOutcomesRefresh', 'anaBaselineRefresh'].map((id) => {
      const el = document.getElementById(id);
      return { id: id, present: !!el, name: el ? (el.getAttribute('aria-label') || '').trim() : '', text: el ? (el.textContent || '').trim() : '' };
    }));
    for (const s of scoped) {
      ok(s.present, `Analysis lost ${s.id}`);
      ok(s.name.length > 0 && s.name !== 'Refresh', `${s.id} has no scoped accessible name (got "${s.name}")`);
      ok(s.text !== '🔄 Refresh', `${s.id} still shows the unscoped label "${s.text}"`);
    }

    /* -- 10: the scope chip is at least 12px, and did not grow its own row -- */
    const scopeChip = await page.evaluate(() => window.__uiContract.chipMetrics());
    ok(scopeChip.sheetPresent, 'the Analysis clarity stylesheet never injected, so this measurement is of nothing');
    ok(scopeChip.fontPx >= 12,
      `the scope chip — the label that says whose numbers these are — computes to ${scopeChip.fontPx}px, under the 12px floor`);
    /* the "legibility fix creates the next collision" guard: report BOTH
       quantities. The chip sits inline in an <h2> beside a heading and a
       button; at 360 that row has no spare height. */
    ok(scopeChip.boxHeight <= 24,
      `the chip grew to ${scopeChip.boxHeight}px tall at 360 (font ${scopeChip.fontPx}px, line-height ${scopeChip.lineHeightPx}px) — a legibility fix that pushes the heading row is the next defect`);

    /* -- 11: the op-note room's typed controls are 40px targets at 360 ----- */
    await page.evaluate(() => window.__uiContract.openRoom());
    await page.waitForTimeout(600);
    /* These three live INSIDE the patient's card, behind the note surface's two
       disclosures. Measured from the day list they are display:none, every
       filter drops them, and the section would pass by measuring nothing. */
    await page.evaluate(() => {
      window.__mlsOpDay.openNote(0);
      window.__mlsOpDay.setDetails(true);
      window.__mlsOpDay.setTemplate(true);
    });
    await page.waitForTimeout(700);
    const TAP = ['#opPrepProc_0', '#opPrepTpl_0', '[onclick^="_opAutoTpl(0)"]'];
    const tapSeen = await page.evaluate((sels) => sels.filter((s) => {
      const e = document.querySelector(s);
      return e && window.__uiContract.visible(e);
    }).length, TAP);
    eq(tapSeen, TAP.length,
      `only ${tapSeen} of ${TAP.length} op-note typed controls are on screen at 360 — the tap-target measurement below would prove nothing`);
    const small = await page.evaluate((sels) => window.__uiContract.smallTargets(sels, 40), TAP);
    eq(small.length, 0,
      `op-note room controls under 40px at 360: ${JSON.stringify(small)} — these are the controls a doctor corrects a procedure name with, by thumb`);
    /* print what was measured, so the next reader sees numbers rather than a tick */
    measured.taps = await page.evaluate((sels) => window.__uiContract.smallTargets(sels, 9999), TAP);
    measured.chip = scopeChip;
    await page.evaluate(() => { document.querySelectorAll('.modal-bg.show').forEach((x) => x.classList.remove('show')); });

    eq(pageErrors.length, 0, `the shell threw during the run: ${JSON.stringify(pageErrors.slice(0, 3))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log(`1p-ui-shape-contract: ${checks} checks passed`);
  console.log(`  scope chip @360: font ${measured.chip.fontPx}px, line-height ${measured.chip.lineHeightPx}px, box ${measured.chip.boxHeight}px`);
  console.log(`  op-note tap targets @360: ${(measured.taps || []).map((t) => t.id + ' ' + t.w + 'x' + t.h).join(', ')}`);
  if (measured.ringHoist) {
    console.log(`  KNOWN DEFECT (nextglow lane), ${measured.ringHoist.length} sample(s): no guided ring lit —`);
    measured.ringHoist.forEach((r) => console.log(`    ${r}`));
    console.log('    feat_mls_studio_merge hoists #analysisView into #studioView, so showing Analysis also shows');
    console.log('    #studioView; msl-1.0.0 markNext tries studioView first and RETURNS there with nothing lit.');
  }
}).catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
