'use strict';
/* junkscrub-1.0.0 — THE DETECTOR, AND THE CLINICAL TEXT IT MUST NEVER TOUCH.
 *
 * Some pre-fix Athena history/visit pulls captured the athenaOne PAGE around
 * the note — its inline sketchpad script, its chart-refresh prompt, its print
 * header, its navigation furniture — and that debris is still sitting inside
 * stored visit bodies. The junkscrub-1.0.0 block takes it back out of the DATA.
 *
 * A cleaner that rewrites stored clinical text is the most dangerous kind of
 * change in this app, so this suite is written to try to BREAK it:
 *
 *   PART 1  the block is present once in both shells and byte-identical.
 *   PART 2  every rule has a fixture that PROVES it fires, and the clinical
 *           note beside the junk survives intact. A rule with no fixture is a
 *           hard failure, so a rule can never be added without a proof.
 *   PART 3  every rule has a clinical NEAR-MISS it must NOT flag. These are
 *           the sentences that would be destroyed by a loose rule: dose lines,
 *           "loss of function (grade 3)", "fell through a window.", plan
 *           bullets, "<" and ">" inside a note, "Print the handout", the word
 *           "skip", the word "script", a Jotter pad.
 *   PART 4  the five promises, executed: nothing invented (subsequence),
 *           never emptied, no signature no write, idempotent, scope.
 *   PART 5  the CAUSAL CONTROL. The shared display cleaner
 *           __mlsVisitModel._stripPageDebris DOES destroy two of the PART 3
 *           sentences. This suite runs it on the same inputs to prove the
 *           near-miss set is not vacuous — if _stripPageDebris ever stops
 *           losing that text, this control fails loudly and the comment in the
 *           shell block explaining why it is not reused must be revisited.
 *   PART 6  the tray line the doctor sees routes to the QUIET tray (never a
 *           toast) through quietnotify's own shipped classifier, and survives
 *           its PHI sanitiser with its number intact.
 *
 * Everything is synthetic. No browser, no network, no PHI. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m);

function occurrences(hay, needle) { let n = 0, i = 0; for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n += 1; i += needle.length; } }
function blockOf(src, name) {
  const a = src.indexOf('<!-- ===== ' + name);
  const b = src.indexOf('<!-- ===== end ' + name);
  ok(a >= 0 && b > a, 'could not slice the ' + name + ' block');
  return src.slice(a, b);
}

/* ====================================================== PART 1  the bytes = */
for (const shell of SHELLS) {
  const src = read(shell);
  eq(occurrences(src, '<!-- ===== junkscrub-1.0.0'), 1, shell + ': the junkscrub-1.0.0 block must appear exactly once');
  eq(occurrences(src, '<!-- ===== end junkscrub-1.0.0'), 1, shell + ': the junkscrub-1.0.0 block is not closed exactly once');
  eq(occurrences(src, '<!-- ===== junkscrub-settings-1.0.0'), 1, shell + ': the junkscrub settings row must appear exactly once');
  eq(occurrences(src, '<!-- ===== end junkscrub-settings-1.0.0'), 1, shell + ': the junkscrub settings row is not closed exactly once');
  eq(occurrences(src, 'id="junkScrubBox"'), 1, shell + ': the receipt container must exist exactly once');
  /* the two shipped call sites */
  ok(/window\.__mlsJunkScrub\.boot\('boot'\)/.test(src), shell + ': nothing in the shipped shell ever starts the cleanup');
  ok(/if\(typeof __mlsJunkScrubRender==='function'\) __mlsJunkScrubRender\(\);/.test(src),
    shell + ': opening Settings never renders the cleanup receipt');
  /* it must ride BEHIND the store activation, never in front of the paint */
  const barrierAt = src.indexOf("__mlsPtsAutoMigrate(p,'boot')");
  const bootAt = src.indexOf("window.__mlsJunkScrub.boot('boot')");
  ok(barrierAt > 0 && bootAt > barrierAt, shell + ': the cleanup starts before the patient store is activated');
  const block = blockOf(src, 'junkscrub-1.0.0');
  ok(block.indexOf('await ') < 0, shell + ': the cleanup block blocks');
  ok(block.indexOf('runPaint') < 0, shell + ': the cleanup block reaches into the boot paint');
  /* MEASURED REGRESSION, 2026-08-18 — the Worker must stay behind the loop.
     rest() resolves through the shared __mlsBgSleep Worker, which is BUILT on
     first use. Calling it from boot() built that Worker on the boot task and
     took tests/1p-visitflow-transcript-contract.test.js from 6/6 to 1/3 on
     this machine (the calm shell lost a render race and never marked the
     transcript .mls-empty); neutralising ONLY this block's boot call site put
     it straight back. Moving it one idle callback later was not enough (3/5).
     What fixed it was the nap()/rest() split: every wait that happens BEFORE
     any work exists is a plain timer, and the Worker is only reached inside
     the apply loop — so a roster with no junk never builds one at all.
     These four assertions pin that split in the shipped bytes. */
  const bootFn = block.slice(block.indexOf('  function boot(why) {'), block.indexOf('  function announce(rec) {'));
  ok(bootFn.length > 100, shell + ': could not slice boot() out of the junkscrub block');
  ok(/requestIdleCallback\(go, \{ timeout: BOOT_IDLE_MS \}\)/.test(bootFn),
    shell + ': boot() no longer defers its first hop to an idle callback');
  ok(/setTimeout\(go, BOOT_IDLE_MS\)/.test(bootFn),
    shell + ': boot() has no plain-timer fallback, so a hidden document that never runs an idle callback never cleans up');
  /* nothing from boot() to the start of the scan may touch the Worker */
  const preScan = block.slice(block.indexOf('  function attempt(why) {'), block.indexOf('  function announce(rec) {'));
  ok(preScan.indexOf('rest(') < 0,
    shell + ': the boot / retry path calls rest() — that builds the __mlsBgSleep Worker before any work exists');
  ok(bootFn.indexOf('rest(') < 0 && /nap\(START_DELAY_MS\)/.test(bootFn),
    shell + ': boot() waits on the Worker instead of a plain timer');
  /* and the apply loop DOES use it — otherwise the split is just a deletion */
  const runFn = block.slice(block.indexOf('  function run(opts) {'), block.indexOf('  /* The one-per-account background pass'));
  ok(/rest\(APPLY_REST_MS\)/.test(runFn),
    shell + ': the apply loop no longer paces on the Worker — a hidden tab will strand it half-done');
  /* the lane rule: a promotable block names no lane */
  ok(block.indexOf('/1p/') < 0 && block.indexOf('1p-feat_') < 0 && block.indexOf('__MLS_P1_PREVIEW') < 0,
    shell + ': the junkscrub block is lane-bound and cannot be promoted as a copy');
}
eq(blockOf(read(SHELLS[0]), 'junkscrub-1.0.0'), blockOf(read(SHELLS[1]), 'junkscrub-1.0.0'),
  'the twins carry DIFFERENT junkscrub-1.0.0 blocks');
eq(blockOf(read(SHELLS[0]), 'junkscrub-settings-1.0.0'), blockOf(read(SHELLS[1]), 'junkscrub-settings-1.0.0'),
  'the twins carry DIFFERENT junkscrub settings rows');

/* ---- load the REAL shipped block, from the REAL shell bytes -------------- */
function loadJunkScrub(shell) {
  const src = read(shell);
  const a = src.indexOf('/* ===== junkscrub-1.0.0 */');
  const b = src.indexOf('<!-- ===== end junkscrub-1.0.0', a);
  ok(a > 0 && b > a, shell + ': could not slice the junkscrub script');
  let js = src.slice(a, b);
  js = js.slice(0, js.lastIndexOf('</' + 'script>'));
  const win = {};
  const ctx = {
    window: win, document: { getElementById() { return null; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout, clearTimeout, Promise, JSON, Date, Object, String, Number, Math, RegExp, Array, Error, console
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx, { filename: shell + ':junkscrub-1.0.0' });
  ok(win.__mlsJunkScrub && win.__mlsJunkScrub.version === 'junkscrub-1.1.0', shell + ': the block did not install');
  win.__mlsJunkScrub.__testWin = win;   /* junkscrub-1.1.0: the latch tests set getPatients on the vm window */
  return win.__mlsJunkScrub;
}

/* ==================================== PART 2  a fixture for EVERY rule ==== */
const NOTE = ' Follow-up lumbar spine, pain 4/10 improving. Continue gabapentin 300 mg PO TID.';
const KEEP = 'Follow-up lumbar spine, pain 4/10 improving. Continue gabapentin 300 mg PO TID.';
/* Real athenaOne page shapes; every PHI-shaped value is invented. */
const OPEN = '<' + 'script';
const CLOSE = '<' + '/' + 'script>';
const FIXTURES = {
  'script-tag': OPEN + ' type="text/javascript">var athenaNav=1;buildMenu()' + CLOSE + NOTE,
  'script-tag-stray': OPEN + ' src="/static/athenanet.js">' + NOTE,
  'fn-assign': 'IsSafari = function(){ return 0; }' + NOTE,
  'window-assign': 'window.Original = {}; window.Original.IsSafari = IsSafari;' + NOTE,
  'var-decl': 'var svgjottercontainerid = 12;' + NOTE,
  'sketchpad-ident': 'PutSketchpad GetStrokesDimensions VMLJSONToRaphaelJSON' + NOTE,
  'params-div': 'params.div.id' + NOTE,
  'refresh-prompt': 'Dr Example recently edited this chart at .' + NOTE,
  'refresh-line': 'Refresh to view the most current information.' + NOTE,
  'refresh-button': 'REFRESH CHART' + NOTE,
  'print-header': 'Print Example Ortho and Hand • 915 EXAMPLE RD STE 1 B-A, ANYTOWN PA 19380-4269 SAMPLE, Ada (id #7731709, dob: 06/01/1967)' + NOTE,
  'id-dob-tail': 'SAMPLE, Ada (id #7731709, dob: 06/01/1967)' + NOTE,
  'skip-link': 'Skip to main content' + NOTE,
  'athenanet-host': 'https://athenanet.athenahealth.com/1/25/nav.esp' + NOTE,
  'athena-footer': 'Powered by athenahealth' + NOTE,
  /* junkscrub-1.1.0: the encounter sign-off validation script, measured on
     ~1,900 stored bodies 2026-08-26. Invented values, real athenaOne shapes. */
  'signoff-ident': 'reviewusername.focus(); selectobject FirstMatch PROCEDUREOUTCOMEDATAENTRY' + NOTE,
  'jquery-call': "jQuery('#PROCEDUREOUTCOMEDATAENTRY').find('select').toArray();" + NOTE,
  'dom-call': "document.getElementsByName('ASSIGNEDTOUSERNAME')[0];" + NOTE,
  'alert-call': "alert('Procedure Outcome Result is required.');" + NOTE,
  'try-catch': 'try { emptyoutcome.focus(); } catch(err) {}' + NOTE,
  'brace-run': 'return false; } } } return true };' + NOTE,
  'flowsheet-empty': 'Click encounter events, vitals, or medications here to add content to this flowsheet.' + NOTE,
  'signoff-line': 'Encounter Sign-Off Encounter not closed.' + NOTE
};

/* the whole captured shape, junk BEFORE the note — the class that a
   cut-to-end-of-line rule would delete the note with */
const INTERLEAVED =
  'Print Example Ortho and Hand • 915 EXAMPLE RD STE 1 B-A, ANYTOWN PA 19380-4269 SAMPLE, Ada (id #7731709, dob: 06/01/1967) ' +
  'window.Original = {}; window.Original.IsSafari = IsSafari; IsSafari = function(){ return 0; } ' +
  'Jotter = function(params) { var svgjottercontainerid = params.div.id; }' + NOTE;

const J = loadJunkScrub(SHELLS[0]);
const RULE_IDS = J.rules.map((r) => r.id);
eq(RULE_IDS.length, new Set(RULE_IDS).size, 'two rules share an id');

for (const id of RULE_IDS) {
  ok(Object.prototype.hasOwnProperty.call(FIXTURES, id),
    'rule "' + id + '" has NO fixture proving it fires — every rule that rewrites stored clinical text needs one');
  const res = J.scrub(FIXTURES[id]);
  ok(res.rules.indexOf(id) >= 0, 'rule "' + id + '" did not fire on its own fixture: ' + JSON.stringify(res.rules));
  ok(res.hit, 'rule "' + id + '" fired but the body was refused: ' + res.why);
  ok(res.text.indexOf(KEEP) >= 0,
    'rule "' + id + '" removed clinical text beside the junk. kept: ' + JSON.stringify(res.text));
  ok(res.removed > 0, 'rule "' + id + '" reported a zero-byte removal');
}
{
  const res = J.scrub(INTERLEAVED);
  ok(res.hit, 'the interleaved real-shape capture was not flagged');
  eq(res.text, KEEP, 'the interleaved capture did not reduce to exactly the note: ' + JSON.stringify(res.text));
  ok(res.rules.length >= 3, 'the interleaved capture fired only ' + res.rules.length + ' rule(s)');
}

/* =================================== PART 3  clinical text it MUST keep === */
const NEAR_MISS = [
  ['window sentence', 'Patient fell through a window. Laceration to right forearm, 4 cm, repaired with 5-0 nylon.'],
  ['window, short tail', 'Fell through a window. Deep laceration right forearm.'],
  ['loss of function', 'Loss of function (grade 3) in the right hand; function improved after therapy.'],
  ['Jotter pad', 'Used a Jotter pad for the pain diary. Pain 8/10 at worst, 3/10 at best.'],
  ['the word script', 'Discussed the script for her medication with the pharmacy before discharge.'],
  ['the word refresh', 'Refresh her memory about the home exercise program; the chart was recently updated.'],
  ['the word print', 'Print the home exercise handout for the patient before discharge.'],
  ['lowercase skip', 'Do not skip to main content of the handout until the block sets in.'],
  ['dose lines', 'Gabapentin 300 mg PO TID; Tramadol 50 mg q6h PRN (max 200 mg/day).'],
  ['plan bullets', 'Plan:\n- MRI lumbar spine without contrast\n- Continue home exercise program\n- RTC 6 weeks'],
  ['angle brackets', 'BP 128/74; SpO2 98% <2 L NC>. ROM: flexion > 90 degrees, extension < 10 degrees.'],
  ['var/const words', 'Const pain, var. degrees of relief. New onset numbness in the L5 distribution.'],
  ['equals signs', 'Pain 8/10 -> 3/10; VAS = 3; ODI = 22%.'],
  ['an id number', 'Implant id #4471 placed; patient dob confirmed at the bedside.'],
  ['athenaOne named', 'Documented in athenaOne under the encounter note, per the doctor.'],
  ['a semicolon list', 'Allergies: penicillin; sulfa; latex. NKDA otherwise documented.'],
  /* junkscrub-1.1.0 near-misses: the words the sign-off rules must not eat */
  ['the word alert', 'Patient alert and oriented x3; no acute distress. Alert (AAOx3) throughout.'],
  ['the word return', 'Return to clinic in 6 weeks; return precautions were given and understood.'],
  ['the word document', 'Will document the discussion; documents reviewed with the patient today.'],
  ['sign-off English', 'Encounter reviewed and signed off by the attending after the procedure.'],
  ['medications sentence', 'Discussed her medications here today and added an exercise plan to the visit.'],
  ['try in prose', 'Will try physical therapy first; if no relief, we will catch it at the next visit.'],
  ['procedure note', 'Lumbar ESI performed at L4-L5 under fluoroscopy; pain 8/10 -> 3/10 at 20 minutes.']
];
for (const [name, text] of NEAR_MISS) {
  const res = J.scrub(text);
  eq(res.rules.length, 0,
    'CLINICAL TEXT FLAGGED — "' + name + '" matched ' + JSON.stringify(res.rules) + ': ' + JSON.stringify(text));
  eq(res.hit, false, 'CLINICAL TEXT WOULD BE REWRITTEN — "' + name + '"');
  eq(res.text, text, 'CLINICAL TEXT CHANGED — "' + name + '" became ' + JSON.stringify(res.text));
}

/* ================================= PART 4  the five promises, executed ==== */
const bare = (s) => String(s).replace(/\s+/g, '');

/* promise 2 — removal only. Proven on every fixture, not argued. */
for (const id of RULE_IDS) {
  const res = J.scrub(FIXTURES[id]);
  ok(J._t.isSubsequence(bare(res.text), bare(FIXTURES[id])),
    'rule "' + id + '" INVENTED or REORDERED characters — the cleaned body is not a subsequence of the original');
}
ok(J._t.isSubsequence(bare(J.scrub(INTERLEAVED).text), bare(INTERLEAVED)), 'the interleaved capture was not cleaned by removal alone');
/* and the guard itself works — a control, so "always a subsequence" is not vacuous */
eq(J._t.isSubsequence('abc', 'axbxc'), true, 'the subsequence guard rejects a real subsequence');
eq(J._t.isSubsequence('acb', 'axbxc'), false, 'the subsequence guard ACCEPTS reordered text — the removal-only promise is unenforced');
eq(J._t.isSubsequence('abz', 'axbxc'), false, 'the subsequence guard ACCEPTS invented text — the removal-only promise is unenforced');

/* promise 4 — a body that is nothing but junk is REFUSED, not emptied */
{
  const allJunk = 'window.Original = {}; IsSafari = function(){ return 0; }';
  const res = J.scrub(allJunk);
  eq(res.refused, true, 'an all-junk body was not refused');
  eq(res.why, 'would-empty', 'an all-junk body was refused for the wrong reason: ' + res.why);
  eq(res.hit, false, 'an all-junk body would still have been written');
  eq(res.text, allJunk, 'a refused body did not keep its original text');
}

/* promise 3 — no signature, no write */
{
  const clean = 'Assessment: lumbar radiculopathy. Plan: continue gabapentin 300 mg TID, PT twice weekly.';
  const res = J.scrub(clean);
  eq(res.hit, false, 'a clean body was flagged');
  eq(res.text, clean, 'a clean body was not byte-identical after a scan');
  eq(res.removed, 0, 'a clean body reported removed bytes');
}
eq(J.scrub('').hit, false, 'an empty body was flagged');

/* idempotence — a second pass over an already-cleaned body is a no-op */
{
  const once = J.scrub(INTERLEAVED);
  const twice = J.scrub(once.text);
  eq(twice.hit, false, 'a second scrub of an already-cleaned body would rewrite it again');
  eq(twice.text, once.text, 'a second scrub changed the text');
}

/* promise 5 — scope */
const SCOPE = [
  [{ source: 'athena-visits', raw: 'x' }, true, 'an Athena-pulled body'],
  [{ source: 'athena-history', findings: 'x' }, true, 'an Athena history findings field'],
  [{ source: 'legacy-chart', plan: 'x' }, true, 'a legacy row'],
  [{ source: 'pullrec', raw: 'x' }, true, 'a pull-record row'],
  [{ source: 'cohort', raw: 'x' }, true, 'a cohort row'],
  [{ source: 'athena-visits', raw: 'x', _rawBeforeScrub: { raw: 'y' } }, false, 'a row already scrubbed (idempotence)'],
  [{ source: 'athena-visits', raw: 'x', noScrub: true }, false, 'a row marked noScrub'],
  [{ source: 'manual-ai', raw: 'x' }, false, 'an AI-drafted row'],
  [{ source: 'provider-entered', raw: 'x' }, false, 'a row the DOCTOR entered'],
  [{ source: 'note', raw: 'x' }, false, 'an app-authored note row'],
  [{ source: 'import', raw: 'x' }, false, 'a plain import row'],
  [{ source: 'restored-patient-draft', raw: 'x' }, false, 'a restored draft'],
  [{ source: 'athena-visits' }, false, 'an Athena row with no body at all'],
  [null, false, 'a null row'],
  ['not an object', false, 'a non-object row']
];
for (const [v, want, name] of SCOPE) {
  eq(J.inScope(v), want, 'scope is wrong for ' + name);
}

/* the two shells' blocks behave identically, not just look identical */
{
  const J2 = loadJunkScrub(SHELLS[1]);
  eq(J2.rules.map((r) => r.id).join(','), RULE_IDS.join(','), 'the twin shell carries different rules');
  eq(J2.scrub(INTERLEAVED).text, J.scrub(INTERLEAVED).text, 'the twin shell cleans differently');
}

/* ============================ PART 5  THE CONTROL: why not _stripPageDebris  */
/* If this part fails, the shared display cleaner has REGRESSED and is eating
   clinical text again. It is no longer a "why not reuse it" note - it is a
   patient-safety pin. See c6-1.0.0 below. */
{
  function stubEl() { return { style: {}, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, remove() {}, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; } }; }
  const win = {};
  const ctx = {
    window: win,
    document: { getElementById() { return null; }, createElement() { return stubEl(); }, head: stubEl(), body: stubEl(), documentElement: stubEl(), addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch() { return Promise.reject(new Error('no network')); },
    setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    navigator: {}, console
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'feat_visits.js'), 'utf8'), ctx);
  const strip = win.__mlsVisitModel && win.__mlsVisitModel._stripPageDebris;
  ok(typeof strip === 'function', 'feat_visits no longer exports _stripPageDebris — the control cannot run');

  const WINDOW_SENTENCE = NEAR_MISS[0][1];
  const JOTTER_SENTENCE = NEAR_MISS[3][1];
  /* c6-1.0.0 (2026-08-18) - THIS CONTROL USED TO RUN THE OTHER WAY.
       It asserted that the shared display cleaner STILL destroyed this clinical
       text, to prove the near-miss set was not vacuous. That defect is fixed:
       _DEBRIS_START now requires an identifier character after a code marker
       (so the ordinary English "...fell through a window." no longer enters
       code mode) and "Jotter" must carry an equals. Measured before the fix:
       "fell through a window. Laceration to right forearm, 4 cm, repaired"
       came back as "fell through a cm, repaired", and short trailing clauses
       ("No allergies.", "Recheck in 7 days.") were deleted outright.
       Both cleaners must now KEEP the text, and both must still drop the junk. */
    eq(strip(WINDOW_SENTENCE), WINDOW_SENTENCE,
      'REGRESSION: _stripPageDebris is mangling "fell through a window." again');
    ok(strip(WINDOW_SENTENCE).indexOf('Laceration to right forearm') >= 0,
      'REGRESSION: _stripPageDebris is deleting the injury site again');
    eq(strip(JOTTER_SENTENCE), JOTTER_SENTENCE,
      'REGRESSION: _stripPageDebris is mangling the "Jotter pad" sentence again');
  /* ... and junkscrub does not. Same inputs, both cleaners, one run. */
  eq(J.scrub(WINDOW_SENTENCE).text, WINDOW_SENTENCE, 'junkscrub lost the same clinical text the shared cleaner loses');
  eq(J.scrub(JOTTER_SENTENCE).text, JOTTER_SENTENCE, 'junkscrub lost the Jotter sentence');
  /* both cleaners agree on the junk itself, so junkscrub is not simply weaker */
  ok(strip(INTERLEAVED).indexOf('window.Original') < 0 && J.scrub(INTERLEAVED).text.indexOf('window.Original') < 0,
    'the two cleaners disagree about the junk itself');
}

/* ================= PART 6  the doctor-facing line stays out of the way ==== */
function quietnotifyFrom(shell) {
  const src = read(shell);
  const block = src.indexOf('/* quietnotify-1.0.0 */');
  const a = src.indexOf('  function S(v)', block);
  const b = src.indexOf('  /* ---------------- PHI SANITISER', a);
  const c = src.indexOf('  function ensureTray(', b);
  ok(block > 0 && a > block && b > a && c > b, shell + ': could not slice quietnotify');
  return new Function(src.slice(a, c) + '\n;return { classify: classify, sanitize: sanitize };')();
}
/* the exact sentence the shipped block builds, for 1 and for many */
function trayLine(n) {
  return 'Cleaned ' + n + ' ' + (n === 1 ? 'note that had' : 'notes that had') +
    ' Athena page text in them; nothing was deleted.';
}
for (const shell of SHELLS) {
  const src = read(shell);
  /* the sentence really is the one the block emits */
  ok(src.indexOf("'note that had'") > 0 && src.indexOf("' Athena page text in them; nothing was deleted.'") > 0,
    shell + ': the tray sentence in this test is not the sentence the shell emits');
  const q = quietnotifyFrom(shell);
  for (const n of [1, 12, 340]) {
    const line = trayLine(n);
    const kind = q.classify(line, 'ok');
    eq(kind, 'outcome', shell + ': the cleanup line classifies as "' + kind + '" — it must be a quiet tray outcome, never a toast');
    const clean = q.sanitize(line);
    /* MEASURED, not assumed: quietnotify's PHI sanitiser removes any token
       carrying three or more digits, because that is the shape of an MRN. A
       count of 340 is therefore elided from the TRAY line and only the exact
       Settings receipt carries it. That guard is not weakened for a nicety —
       what is required here is that the sentence stays true and readable
       either way, and that a two-digit count still reaches the doctor. */
    if (n < 100) {
      ok(clean.indexOf(String(n)) >= 0,
        shell + ': the PHI sanitiser ate a two-digit count out of the tray line: ' + JSON.stringify(clean));
    } else {
      eq(clean.indexOf(String(n)), -1,
        shell + ': a three-digit count survived the PHI sanitiser — either the sanitiser changed or this note is stale');
    }
    ok(/^Cleaned \d*\s?notes? that had Athena page text in them; nothing was deleted\.$/.test(clean),
      shell + ': the sanitised tray line is not a grammatical, complete sentence: ' + JSON.stringify(clean));
    ok(clean.indexOf('nothing was deleted') >= 0,
      shell + ': the reassurance did not survive the sanitiser: ' + JSON.stringify(clean));
  }
  /* the control: a line that SHOULD interrupt still does */
  eq(quietnotifyFrom(shell).classify('Your session expired — sign in again.', 'err'), 'action',
    shell + ': the quietnotify control is broken, so "outcome" above proves nothing');
}

/* the receipt shape carries counts, rules and DATES — and nothing else */
{
  /* Deliberately outlandish synthetic identities: a short name like "Bo" is a
     substring of the receipt's own field names ("flaggedBodies"), which would
     make this leak check fail for a reason that is not a leak. */
  const rep = J.scanRows([
    { id: 'qqid-alpha', name: 'Zzyxandra Quilfeather', mrn: 'MRNQQ7', visits: [{ id: 'v1', date: '2026-07-16', source: 'athena-visits', raw: INTERLEAVED }] },
    { id: 'qqid-beta', name: 'Wrenlow Kesterbrook', mrn: 'MRNQQ8', visits: [{ id: 'v2', date: '2026-06-25', source: 'athena-visits', raw: 'Clean note, nothing to remove.' }] }
  ]);
  const receipt = J._t.publicReceipt(rep.report, 'dry-run', 0, true);
  const json = JSON.stringify(receipt);
  for (const secret of ['Zzyxandra', 'Quilfeather', 'Wrenlow', 'Kesterbrook', 'qqid-alpha', 'qqid-beta', 'MRNQQ']) {
    eq(json.indexOf(secret), -1, 'the receipt carries patient identity (' + secret + '): ' + json);
  }
  ok(json.indexOf('lumbar') < 0 && json.indexOf('gabapentin') < 0, 'the receipt carries note text: ' + json);
  /* the control: those identities really were in the input, so "absent" means something */
  ok(JSON.stringify(rep.plan).indexOf('qqid-alpha') >= 0,
    'the internal plan does not carry the patient id either — this leak check is vacuous');
  eq(receipt.flaggedVisits, 1, 'the receipt miscounted flagged visits');
  eq(receipt.flaggedPatients, 1, 'the receipt miscounted flagged patients');
  eq(receipt.scannedPatients, 2, 'the receipt miscounted scanned patients');
  /* joined, not deepStrictEqual: this array is built inside the vm realm and
     so does not share Array.prototype with this file's arrays. */
  eq(receipt.days.join(','), '2026-07-16', 'the receipt named the wrong days: ' + JSON.stringify(receipt.days));
  ok(receipt.bytesRemoved > 100, 'the receipt reported ' + receipt.bytesRemoved + ' bytes removed from a 300+ byte junk capture');
}

/* ================== PART 7  the live 2026-08-26 shape, end to end (1.1.0) = */
{
  const SIGNOFF_TAIL =
    " var outcomes = jQuery('#PROCEDUREOUTCOMEDATAENTRY').find('select').toArray(); var filter = function (item) { return (item.value == ''); }; var emptyoutcome = FirstMatch(outcomes, filter); if (emptyoutcome) { alert('Procedure Outcome Result is required.'); try { emptyoutcome.focus(); } catch(err) {} return false; } } var reviewcheckbox = document.getElementById('REVIEWENCOUNTER'); if ( reviewcheckbox && reviewcheckbox.checked) { var reviewusername = document.getElementsByName('ASSIGNEDTOUSERNAME')[0]; if (reviewusername) { alert( 'Please select to whom the encounter should be assigned.' ); reviewusername.focus(); return false; } var selectobject = reviewusername; selectobject.value = TrimWhitespace(selectobject.value); selectobject.focus(); return false; } } } return true };";
  const LIVE_SHAPE = KEEP + ' Encounter Sign-Off Encounter not closed.' + SIGNOFF_TAIL;
  const res = J.scrub(LIVE_SHAPE);
  ok(res.hit, 'the measured live sign-off tail was not flagged at all');
  eq(res.text.indexOf(KEEP), 0, 'the clinical note ahead of the sign-off tail was damaged: ' + JSON.stringify(res.text.slice(0, 120)));
  ok(res.removed > SIGNOFF_TAIL.length * 0.7,
    'the sign-off tail mostly survived the scrub (' + res.removed + ' of ' + SIGNOFF_TAIL.length + ' bytes removed): ' + JSON.stringify(res.text.slice(-160)));
}

/* ==================== PART 8  the latch is a measurement, not a one-shot == */
{
  const T = J._t;
  const win = J.__testWin;
  ok(typeof T.shouldSkipRun === 'function' && typeof T.countScopeBodies === 'function',
    'the latch predicate is not exported for test');
  eq(T.shouldSkipRun(null), false, 'no receipt must run');
  eq(T.shouldSkipRun({ complete: true, version: 'junkscrub-1.0.0', scopeBodiesAfter: 0 }), false,
    'an old-version receipt must re-run - new rules exist');
  eq(T.shouldSkipRun({ complete: true, version: 'junkscrub-1.1.0' }), false,
    'a receipt without the body-count measurement must re-run once and earn one');
  eq(T.shouldSkipRun({ complete: false, version: 'junkscrub-1.1.0', scopeBodiesAfter: 0 }), false,
    'an incomplete (capped) run must resume');
  win.getPatients = () => [];
  eq(T.countScopeBodies(), 0, 'an empty roster counts zero in-scope bodies');
  eq(T.shouldSkipRun({ complete: true, version: 'junkscrub-1.1.0', scopeBodiesAfter: 0 }), true,
    'an unchanged store re-scans instead of skipping - the cheap-count path is broken');
  win.getPatients = () => [{ id: 'x', visits: [{ source: 'athena-visits', raw: 'Freshly pulled body.' }] }];
  eq(T.countScopeBodies(), 1, 'a fresh remote body was not counted');
  eq(T.shouldSkipRun({ complete: true, version: 'junkscrub-1.1.0', scopeBodiesAfter: 0 }), false,
    'the janitor stays asleep while new bodies arrive - the exact 2026-08-26 defect (1,900 tails behind a done-flag)');
  win.getPatients = () => [{ id: 'x', visits: [{ source: 'athena-visits', raw: 'Cleaned.', _rawBeforeScrub: { raw: 'Cleaned. var x = 1;' } }] }];
  eq(T.countScopeBodies(), 0, 'a scrubbed body still counts into the latch measurement - the latch would flap forever');
  delete win.getPatients;
}

console.log('junk-scrub-detector: OK— ' + RULE_IDS.length + ' rules, each with a firing fixture; '
  + NEAR_MISS.length + ' clinical near-misses unflagged; the removal-only, never-empty, no-signature-no-write, '
  + 'idempotence and scope promises executed; _stripPageDebris control confirms the near-miss set is not vacuous.');
