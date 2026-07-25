/* Boot cost must be visible in the gate, not just felt by the doctor.
 *
 * Measured live 2026-07-25 (b581) on the owner's SIGNED-IN tab, warm, and this
 * time in the FOREGROUND, which is what finally reproduced it:
 *
 *   FCP 148ms, load 373ms                    -- the PAGE is fast
 *   Total Blocking Time 10,929ms             -- the app is NOT
 *   16 long tasks, last one ending at 24,568ms
 *   205 asset requests, 204 served from cache, response 0.7ms each
 *   median per-script QUEUE time (startTime -> fetchStart): 6,477ms
 *   aggregate queue 1,274,056ms over a 9,592ms wall span
 *
 * The SAME load in a BACKGROUND tab finishes its script phase in 1.4s with zero
 * long tasks, because a hidden tab skips the rendering work. That is why three
 * previous sessions could not reproduce "26 seconds" and concluded the loader
 * was a red herring. Measure boot in a tab that is actually in front.
 *
 * Theories killed by measurement - do not re-open:
 *   - network            204/205 from cache, 0.7ms response
 *   - parse/exec cost    all 212 scripts execute in 1,728ms total when isolated
 *   - one hot script     three runs blamed three DIFFERENT files; the blob floats
 *   - stylesheet count   196 <style> els, but one insert + forced layout = 1ms
 *   - the SW cache-write 1.7ms per put, ~350ms total (real waste, not the cause)
 *
 * AND THE REQUEST COUNT IS NOT THE CAUSE EITHER. This is the correction that
 * matters most, because both the 2026-07-24 handoff and my own first conclusion
 * said "bundle the feature scripts" and they were wrong.
 *
 * Re-fetched the SAME 205 cached assets through the SAME service worker on the
 * SAME page, with the main thread IDLE:
 *
 *   150 in parallel   124ms total, 0.83ms per request
 *   sequential        3.11ms per request
 *   projected for 205 ~170ms
 *
 * At boot those identical requests span 9,543ms with a 5,659ms median queue.
 * Same URLs, same worker, same cache: 56x. So fetching all 205 costs ~170ms and
 * the other ~9.4s is main-thread contention that the requests are merely QUEUED
 * BEHIND. The 6,477ms queue is a SYMPTOM, not the cause.
 *
 * Bundling 205 -> 1 therefore buys ~170ms of ~9,500ms. It is the highest-blast-
 * radius refactor in the product for a ~2% win, and a bundle still has to
 * execute the same code on the same thread. Do not do it on this evidence.
 *
 * What is actually left is the WORK each module does at boot over a real store:
 * 1,481 patients, 2,166 visits, 471KB, 1.74MB localStorage, 8,154 DOM nodes.
 * getPatients() is memoized (0.1ms first call, 0ms after), so it is not repeated
 * store parsing - it is what 234 modules each DO with it. That is where the next
 * measurement belongs: attribute main-thread time per module with the tab in
 * FRONT, and note that load-event-gap attribution does not work here (three runs
 * blamed three different files).
 *
 * The feature scripts also do not load until AFTER authentication - the login
 * screen is 5 resources - which is exactly why the owner reports this as
 * "it took way too long to login". It is not login.
 *
 * TWO measurements, because the two candidate fixes move different numbers and
 * the previous single measurement was blind to one of them:
 *
 *   A. HOW MANY distinct feature scripts the loader names.
 *      Moves when BUNDLING lands. Was the only arm before.
 *
 *   B. HOW MANY of them are inserted EAGERLY, i.e. during the loader's own
 *      evaluation rather than behind a deferral gate.
 *      Moves when DEFERRAL lands. A deferral fix leaves every name in place, so
 *      arm A would report zero progress on a change that could halve boot time.
 *      That blind spot was called out in the 2026-07-24 handoff; this is it.
 *
 * To earn deferral credit, route the insertion through window.__mlsDeferAsset()
 * or requestIdleCallback. That is deliberately a named, greppable primitive so
 * "deferred" is a fact about the code and not a guess about intent.
 *
 * Both arms are two-sided:
 *   - ABOVE the ceiling fails: boot got more expensive, on purpose or not.
 *   - BELOW the floor fails too: the fix landed, and the pin must be lowered so
 *     the win is locked in and cannot erode back one feature at a time.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const LOADER = 'mls-connect.js';

/* arm A - request count */
/* 234 -> 235 at b657, deliberately, for feat_mls_voice_cluster.js.
 *
 * Raised rather than dodged, and here is the why this file asks for:
 *   - It is the FIRST module in this loader that is NOT eager. It loads on
 *     requestIdleCallback with a 4s timeout, so it costs nothing at first paint
 *     — which is the cost this ceiling actually guards (the post-login burst on
 *     a main thread 234 modules already compete for), not the ~0.83ms download.
 *   - It REMOVES interface rather than adding it: three bottom-left controls
 *     (Copilot Voice, MLS Assistant, Dictate) become one bubble that expands.
 *     Net chrome goes down; net boot work goes down.
 *   - It could have been folded into an existing feat file to keep the count
 *     flat. That would have been the dishonest version: this slot's established
 *     pattern (feat_mls_copilot_voice_v2.js) is a separately revertible
 *     satellite, and merging three voice controls is exactly the change you
 *     want to be able to back out on its own. */
const CEILING = 235;
const FLOOR = 200;

/* arm B - deferral. 234 of the 235 are eager; the voice cluster is the first
   deferred one, so EAGER_CEILING deliberately does NOT move with CEILING. */
const EAGER_CEILING = 234;
const EAGER_FLOOR = 200;

/* A window of source before the reference is enough to tell how the insertion
 * is scheduled: these loader lines are single self-contained IIFEs. */
const LOOKBEHIND = 400;
const DEFER_MARKER = /requestIdleCallback|__mlsDeferAsset\(/;

const src = fs.readFileSync(path.join(ROOT, LOADER), 'utf8');
/* feat_ and NOT feat_mls_. The narrower form watched 164 of the 234 scripts the
 * loader actually names and missed 70 - the whole feat_athena_* family (24),
 * feat_visit*, feat_opnote_*, feat_autosave, feat_save_verify, feat_task3_*.
 * A ceiling with a 30% blind spot cannot do the job this file's header claims:
 * anyone could add feat_athena_anything.js forever and never trip it. */
const refs = new Set(src.match(/feat_[a-z0-9_]+\.js/g) || []);
const n = refs.size;

let eager = 0;
let deferred = 0;
const seen = new Set();
const re = /feat_[a-z0-9_]+\.js/g;
let m;
while ((m = re.exec(src))) {
  if (seen.has(m[0])) continue;
  seen.add(m[0]);
  const window_ = src.slice(Math.max(0, m.index - LOOKBEHIND), m.index);
  if (DEFER_MARKER.test(window_)) deferred++; else eager++;
}

let failed = false;

if (n > CEILING) {
  failed = true;
  console.error(
    '\nFAIL: ' + LOADER + ' now loads ' + n + ' feature scripts, up from ' + CEILING + '.\n' +
    'The cost of an added module is the WORK IT DOES at boot over a 1,481-patient\n' +
    'store on a main thread 234 other modules are already competing for - NOT its\n' +
    'download, which is ~0.83ms. Give it real work to do only when the screen that\n' +
    'needs it opens, defer it past first paint, or raise CEILING and say why.\n'
  );
}

if (n < FLOOR) {
  failed = true;
  console.error(
    '\nFAIL (good news): ' + LOADER + ' now names only ' + n + ' feature scripts,\n' +
    'below the floor of ' + FLOOR + '. Fewer modules run at boot. Lower CEILING and\n' +
    'FLOOR to the new numbers so the improvement is locked in.\n' +
    'NOTE: if this dropped because of BUNDLING, re-measure before celebrating -\n' +
    'fetching all 205 assets costs ~170ms, so a bundle alone moves almost nothing.\n'
  );
}

if (eager > EAGER_CEILING) {
  failed = true;
  console.error(
    '\nFAIL: ' + eager + ' feature scripts are inserted eagerly, up from ' + EAGER_CEILING + '.\n' +
    'Eager insertions all compete for dispatch during the same post-login burst.\n' +
    'Route it through window.__mlsDeferAsset() or requestIdleCallback, or raise\n' +
    'EAGER_CEILING deliberately and say why.\n'
  );
}

if (eager < EAGER_FLOOR) {
  failed = true;
  console.error(
    '\nFAIL (good news): only ' + eager + ' feature scripts are still eager, below the\n' +
    'floor of ' + EAGER_FLOOR + ' (' + deferred + ' deferred). Deferral has landed. Lower\n' +
    'EAGER_CEILING and EAGER_FLOOR so the win cannot erode back.\n'
  );
}

/* ---- arm C: what the modules DO, which is where the time actually goes ----
 *
 * Arms A and B count files. This one counts the two constructs that make 234
 * cheap modules expensive together, and it is the arm the measurements point at:
 *
 *   - a document-wide subtree MutationObserver reacts to EVERY DOM change made
 *     by every other module. During boot all 234 are mutating, so the cost is
 *     mutations x observers, not per-module.
 *   - a setInterval never stops. 200+ of them are a permanent background load,
 *     which is also why a long task shows up ~22s after load with nothing left
 *     to boot.
 *
 * This also explains the two things single-module attribution could not: why no
 * single script ever owns the blob (the work belongs to the observers reacting
 * to everyone else), and why a BACKGROUND tab reads 1.4s (observers still fire,
 * but the style and layout they dirty is never computed).
 *
 * tests/interaction-performance-contract.test.js already polices named modules
 * for exactly these two constructs. This is the population-level pin so the
 * total cannot grow while each individual addition looks reasonable. */
const featFiles = fs.readdirSync(ROOT).filter((f) => /^feat_.*\.js$/.test(f));
let docObservers = 0;
let intervals = 0;
for (const f of featFiles) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  docObservers += (s.match(/observe\(\s*document(?:\.documentElement|\.body)?\s*,\s*\{[^}]*subtree\s*:\s*true/g) || []).length;
  intervals += (s.match(/setInterval\s*\(/g) || []).length;
}

const OBSERVER_CEILING = 59;   // 60 at b596; one retired when the caption double-escape was fixed at source
const INTERVAL_CEILING = 214;

if (docObservers > OBSERVER_CEILING) {
  failed = true;
  console.error(
    '\nFAIL: ' + docObservers + ' document-wide subtree MutationObservers, up from ' +
    OBSERVER_CEILING + '.\nEach one runs on every DOM change every other module makes, so this is\n' +
    'multiplicative during boot. Scope the observer to the subtree it cares about\n' +
    '(see feat_mls_centerpiece.js, which is scoped to #visitView), or raise the\n' +
    'ceiling deliberately and say why.\n'
  );
}
if (intervals > INTERVAL_CEILING) {
  failed = true;
  console.error(
    '\nFAIL: ' + intervals + ' setInterval pollers across feature modules, up from ' +
    INTERVAL_CEILING + '.\nAn interval never stops. Prefer an event, a MutationObserver scoped to the\n' +
    'subtree, or a bounded set of timeouts, or raise the ceiling and say why.\n'
  );
}

assert(n > 0, 'expected to find feature-script references in ' + LOADER);
assert.strictEqual(eager + deferred, n, 'every referenced script must be classified eager or deferred');
assert(docObservers > 0 && intervals > 0, 'arm C found nothing - the detectors are broken, not the code');

if (failed) { process.exit(1); }

console.log(
  'boot-script-budget: OK (' + n + ' feature scripts, ceiling ' + CEILING + '; ' +
  eager + ' eager / ' + deferred + ' deferred, eager ceiling ' + EAGER_CEILING + '; ' +
  docObservers + ' document-wide observers, ' + intervals + ' intervals)'
);
