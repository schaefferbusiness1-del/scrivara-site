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
 * What is left is the request COUNT: 205 separately-fetched, strictly-ordered
 * (s.async=false) scripts whose dispatch gets paced by a main thread that is
 * hydrating a real clinic's data at the same time. Serving each one is instant;
 * waiting for a turn is not.
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

/* arm A - bundling */
const CEILING = 164;   // measured at b564, unchanged at b581
const FLOOR = 140;

/* arm B - deferral. Every one of the 164 is eager today. */
const EAGER_CEILING = 164;
const EAGER_FLOOR = 140;

/* A window of source before the reference is enough to tell how the insertion
 * is scheduled: these loader lines are single self-contained IIFEs. */
const LOOKBEHIND = 400;
const DEFER_MARKER = /requestIdleCallback|__mlsDeferAsset\(/;

const src = fs.readFileSync(path.join(ROOT, LOADER), 'utf8');
const refs = new Set(src.match(/feat_mls_[a-z0-9_]+\.js/g) || []);
const n = refs.size;

let eager = 0;
let deferred = 0;
const seen = new Set();
const re = /feat_mls_[a-z0-9_]+\.js/g;
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
    'Every added file is another request that has to wait its turn behind the\n' +
    'others - measured median queue 6,477ms per script at b581. Either bundle it\n' +
    'with an existing module, defer it past first paint, or raise CEILING\n' +
    'deliberately and say why.\n'
  );
}

if (n < FLOOR) {
  failed = true;
  console.error(
    '\nFAIL (good news): ' + LOADER + ' now names only ' + n + ' feature scripts,\n' +
    'below the floor of ' + FLOOR + '. Bundling has landed. Lower CEILING and FLOOR\n' +
    'to the new numbers so the improvement is locked in.\n'
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

assert(n > 0, 'expected to find feature-script references in ' + LOADER);
assert.strictEqual(eager + deferred, n, 'every referenced script must be classified eager or deferred');

if (failed) { process.exit(1); }

console.log(
  'boot-script-budget: OK (' + n + ' feature scripts, ceiling ' + CEILING + '; ' +
  eager + ' eager / ' + deferred + ' deferred, eager ceiling ' + EAGER_CEILING + ')'
);
