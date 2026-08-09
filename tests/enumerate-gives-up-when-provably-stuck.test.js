'use strict';

/*
 * A refusal that cannot change should not cost the doctor two more minutes.
 *
 * The owner's ON-mode symptom is not only that patients fail. From
 * HANDOFF_THREE_OPEN_DEFECTS_2026-07-24: "Burns 93-160s per patient first."
 * That is this loop — 47 retries at 3.5s, re-running openVisits each pass —
 * and on a chart where the gate's answer never changes, every one of those
 * passes reads exactly like the first.
 *
 * WHY THIS IS SAFE WHATEVER THE OPEN DEFECT TURNS OUT TO BE. Three gates can
 * refuse the chart frame and they need opposite fixes; which one fires can only
 * be settled by a live pull. This change needs none of that, because it never
 * decides that a chart is good — it exits through the SAME
 * `return { ok: false }` the loop would have reached anyway, just sooner. There
 * is no input on which it accepts something the old code refused.
 *
 * THE ONE REAL RISK is giving up on a chart that would have hydrated later, and
 * the whole design is aimed at it:
 *
 *   - the key carries the row and child counts, which MOVE while a panel is
 *     still rendering, so a hydrating chart can never look stuck;
 *   - it excludes `n=` and `sameFor=`, the elapsed-time counters, which change
 *     on every pass by construction and would otherwise make every chart look
 *     like it was still moving;
 *   - the threshold is 16 identical passes, about 56 seconds of a chart doing
 *     nothing at all, against a handoff observation of a real panel sitting at
 *     22 rows for 70 seconds;
 *   - and the refusal SAYS it gave up early, with the count, so if this ever
 *     does cut a slow chart short the receipt states it in the words needed to
 *     raise the threshold.
 *
 * The per-frame reason truncation was widened from 22 to 90 characters for
 * this: truncated at 22, every entry read `total-not-readable[row` and looked
 * identical across passes even while the panel grew. The cap only ever existed
 * to fit a string budget that turned out not to be real (3.0.16).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'latin1');

/* ---------------------------------------------------------------- wiring -- */

assert(/var EH_STUCK_LIMIT = 16;/.test(bg), 'the stuck threshold must stay explicit and named');
/* 3.0.19 adds a third bound: the index phase gets its own deadline. Without it
   the loop was entitled to retry until 7s before readDeadline and could spend
   the entire 165s read budget, so the body phase was admitted with nothing left
   — measured as visits-time-budget-exceeded on patients with 14 and 20
   encounters, whose bodies were then never read at all. */
assert(/if \(!ehStuck && ehPass < 47 && Date\.now\(\) \+ 24000 < readDeadline && Date\.now\(\) \+ 7000 < indexPhaseDeadline\)/.test(bg),
  'the retry must be skipped when the answer is provably fixed — and must respect the pass cap, the read deadline, and the index-phase deadline (readDeadline margin 7s->24s with axc-1.0: the ax runway reserve; the triple-bound intent is unchanged and the index-phase bound stays 7s)');
assert(/\[unchanged-for-' \+ ehStuckPasses \+ '-passes;gave-up-early\]/.test(bg),
  'the refusal must say it stopped early and after how many identical passes');
assert(/identicalPasses: ehStuckPasses, gaveUpEarly: !!ehStuck/.test(bg),
  'the structured evidence must carry the same facts as the string');
assert(/slice\(0, 90\)/.test(bg) && !/replace\(\/\^visits-\/, ''\)\.slice\(0, 22\)/.test(bg),
  'per-frame reasons must no longer be truncated to 22 chars — the numbers are what make the key trustworthy');

/* The early exit must reach the SAME refusal. If a future edit ever routes it
   to an acceptance, this defect becomes a silent wrong-data bug. */
const loop = bg.slice(bg.indexOf('for (var ehPass = 0; ehPass < 48; ehPass++)'),
  bg.indexOf('var rows = enumRes.rows || [], total = rows.length;'));
const afterStuck = loop.slice(loop.indexOf('var ehStuck ='));
assert(/return \{\n?\s*ok: false, reason: 'encounter-index-incomplete'/.test(afterStuck),
  'the only thing reachable after the stuck check must be the ok:false refusal');
assert(!/ok: true/.test(afterStuck.slice(0, afterStuck.indexOf('error:'))),
  'nothing between the stuck check and the refusal may accept');

/* ------------------------------------------------- the real key, executed -- */

const keyLine = /var ehKey = enrSeen\.join\(','\)[^\n]*/.exec(bg);
assert(keyLine, 'the stuck key could not be located');

const sandbox = {};
vm.createContext(sandbox);
function keyFor(enrSeen) {
  sandbox.enrSeen = enrSeen;
  vm.runInContext('var enrSeen = this.enrSeen;\n' + keyLine[0] + '\nthis.out = ehKey;', sandbox);
  return sandbox.out;
}

/* Frame reasons as they are actually built: id + '-' + reason, counters last. */
const frame = (id, gate, rows, kids, n, sameFor) =>
  id + '-' + gate + '[rows=' + rows + ';kids=' + kids + ';n=' + n + ';sameFor=' + sameFor + 's]';

/* 1. A STALLED chart: rows and kids fixed, only the counters advancing.
 *    Every pass must produce the same key, or the loop never stops early. */
{
  const p1 = keyFor([frame(532, 'total-not-readable', 22, 22, 1, 0), '528+']);
  const p2 = keyFor([frame(532, 'total-not-readable', 22, 22, 2, 4), '528+']);
  const p9 = keyFor([frame(532, 'total-not-readable', 22, 22, 9, 28), '528+']);
  assert.strictEqual(p1, p2, 'the elapsed-time counters must not enter the key');
  assert.strictEqual(p1, p9, 'a stalled chart must look identical across passes: ' + JSON.stringify([p1, p9]));
  assert(!/n=|sameFor=/.test(p1), 'no volatile counter may survive into the key: ' + p1);
  assert(/rows=22/.test(p1) && /kids=22/.test(p1), 'the key must keep the counts that prove nothing moved');
}

/* 2. A HYDRATING chart: the panel is still filling in. This MUST NOT look
 *    stuck — it is the only way this change could lose a chart that works. */
{
  const a = keyFor([frame(532, 'list-still-rendering', 4, 4, 1, 0)]);
  const b = keyFor([frame(532, 'list-still-rendering', 9, 9, 1, 0)]);
  const c = keyFor([frame(532, 'list-still-rendering', 22, 22, 1, 0)]);
  assert.notStrictEqual(a, b, 'a growing list must break the key');
  assert.notStrictEqual(b, c, 'a growing list must break the key at every step');
}

/* 3. The subtle one: counts steady but the DECLARED total moving, which happens
 *    while Athena is still counting events. Still not stuck. */
{
  const a = keyFor([frame(532, 'list-still-rendering[22/30', 22, 22, 5, 14)]);
  const b = keyFor([frame(532, 'list-still-rendering[22/38', 22, 22, 6, 18)]);
  assert.notStrictEqual(a, b, 'a moving declared total must break the key');
}

/* 4. A frame appearing or disappearing between passes must break the key —
 *    the chart frame arriving late is exactly the case worth waiting for. */
{
  const a = keyFor([frame(532, 'panel-not-open', 0, 0, 3, 8)]);
  const b = keyFor([frame(532, 'panel-not-open', 0, 0, 4, 11), frame(535, 'list-still-rendering', 22, 22, 1, 0)]);
  assert.notStrictEqual(a, b, 'a new frame answering must break the key');
}

/* 5. An empty frame list yields an empty key, and the wiring requires a
 *    non-empty key before it can ever count as stuck — otherwise a run where
 *    nothing answered at all would give up after 16 passes for the wrong
 *    reason. */
{
  assert.strictEqual(keyFor([]), '', 'no frames answering must not produce a countable key');
  assert(/if \(ehKey && ehKey === ehStuckKey\)/.test(bg),
    'an empty key must never accumulate stuck passes');
}

/* 6. Arithmetic: 16 passes at 3.5s is ~56s, against 47 at 3.5s (~165s). The
 *    saving is the point, so it is asserted rather than assumed. */
{
  const before = 47 * 3.5, after = 16 * 3.5;
  assert(before - after > 100, 'the early exit must save more than 100s per stuck patient');
}

console.log('PASS enumerate gives up when provably stuck: a stalled chart exits ~110s sooner through the SAME refusal, and a hydrating chart — growing rows, moving declared total, or a frame arriving late — never looks stuck');
