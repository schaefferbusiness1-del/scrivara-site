'use strict';
/*
 * ONE OWNER FOR THE PATIENT-FACING LINE (av-6.2.0)
 * -----------------------------------------------------------------------------
 * Owner: "having text constantly overlapping and being such a paIUN IN THE ASS."
 *
 * It was never a layout defect. Measured: #mlsAvKioskInterim had FOURTEEN writers, while
 * #mlsAvKioskSay, #mlsAvKioskState and #mlsAvKioskName had exactly one each. The live
 * transcript, two microphone hints, three staff-recovery notices, the rest screen, the ambient
 * status and the finish line all assigned textContent directly, with no ownership and no
 * priority — so they clobbered each other mid-sentence and a notice the patient needed was
 * wiped by a transient transcript fragment a moment later.
 *
 * The tell that it was already hurting: one call site had grown a hand-rolled
 * `if (!ivOff.textContent)` guard. Somebody noticed the clobbering and patched the victim.
 *
 * This file EXECUTES the shipped arbitrator against adversarial orderings. The load-bearing
 * assertions are the two directions:
 *   - a transcript fragment must NOT be able to wipe a live staff alert, and
 *   - an alert must still be able to replace anything, and a new turn must clear the hold,
 *     or the cure is a line that freezes on the first warning it ever shows.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(process.env.AVATAR_SRC_OVERRIDE || path.join(root, 'feat_mls_avatar.js'), 'utf8');

/* ── 1. NO DIRECT WRITER MAY SURVIVE ──────────────────────────────────────────────────────
   Half-routing is worse than not doing it at all: the arbitrator would believe it owns a line
   another writer is still overwriting behind its back. So count them. */
{
  const lines = src.split('\n');
  const offenders = [];
  lines.forEach((ln, i) => {
    if (!/\.textContent\s*=/.test(ln)) return;
    if (!/\biv[A-Za-z0-9]*\b/.test(ln)) return;
    /* the arbitrator and its reset are the ONLY permitted direct writers */
    const ctx = lines.slice(Math.max(0, i - 24), i + 1).join('\n');
    if (/function kioskLine\(|function kioskLineReset\(/.test(ctx)) return;
    offenders.push((i + 1) + ': ' + ln.trim().slice(0, 96));
  });
  assert.deepEqual(offenders, [],
    'DIRECT WRITER(S) TO THE PATIENT LINE SURVIVE — the arbitrator cannot hold a line that ' +
    'something else still overwrites:\n  ' + offenders.join('\n  '));
}
{
  const n = (src.match(/kioskLine\('/g) || []).length;
  assert.ok(n >= 13, 'only ' + n + ' routed call sites — writers were dropped rather than routed');
  assert.ok(/kioskLineReset\(\);/.test(src), 'the per-turn reset is gone: a stale alert would silence the next question');
}

/* ── 2. EXECUTE THE ARBITRATOR ─────────────────────────────────────────────────────────── */
const from = src.indexOf('  var KL_RANK = {');
const to = src.indexOf('  function kioskState(');
assert.ok(from > 0 && to > from, 'could not extract the arbitrator');

function build() {
  let node = { textContent: '' };
  let now = 1000;
  const api = new Function('getNode', 'clock', 'window', `
    var gid = function () { return getNode(); };
    ${src.slice(from, to)}
    return { line: kioskLine, reset: kioskLineReset, state: kioskLineState };
  `);
  /* Date.now is what the holds are measured against; drive it rather than sleeping */
  const realNow = Date.now;
  const inst = (() => {
    Date.now = () => now;
    try { return api(() => node, null, {}); } finally { Date.now = realNow; }
  })();
  const wrap = (fn) => (...a) => { Date.now = () => now; try { return fn(...a); } finally { Date.now = realNow; } };
  return {
    line: wrap(inst.line), reset: wrap(inst.reset), state: wrap(inst.state),
    text: () => node.textContent,
    advance: (ms) => { now += ms; },
  };
}

/* 2a — THE DEFECT ITSELF: a transcript fragment must not wipe a staff alert. */
{
  const k = build();
  k.line('alert', 'Staff: nothing is being recorded. Allow the microphone for this site.');
  const alert = k.text();
  /* the recogniser keeps delivering while the alert stands — this is the real firing order */
  for (const frag of ['well', 'well it', 'well it hurts', 'well it hurts when I bend']) {
    assert.strictEqual(k.line('transcript', frag), false,
      'a transcript fragment overwrote a live staff alert — this is the owner\'s complaint');
  }
  assert.strictEqual(k.text(), alert, 'the alert did not survive the transcript stream');
}

/* 2b — but it must not freeze: the hold expires, and then the transcript flows again. */
{
  const k = build();
  k.line('alert', 'Staff: the check-in could not reach the server.');
  k.advance(21000);
  assert.strictEqual(k.line('transcript', 'my back hurts'), true,
    'the line froze on an old alert — after its hold expires the transcript must flow again');
  assert.strictEqual(k.text(), '',
    'interim words are still recognized but must not be painted as a fragmentary patient line');
}

/* 2c — a NEW TURN clears the hold immediately, or one warning silences every later question. */
{
  const k = build();
  k.line('alert', 'Staff: open the patient, then start the check-in again.');
  k.reset();
  assert.strictEqual(k.text(), '', 'the reset did not clear the line');
  assert.strictEqual(k.line('transcript', 'yes'), true,
    'a new turn is still blocked by the previous turn\'s alert — every question after a single ' +
    'warning would show nothing');
}

/* 2d — the full ranking, both directions, at every pair. */
{
  const RANK = ['transcript', 'hint', 'status', 'alert'];
  for (let lo = 0; lo < RANK.length; lo++) {
    for (let hi = 0; hi < RANK.length; hi++) {
      const k = build();
      k.line(RANK[hi], 'HELD-' + RANK[hi]);
      const held = k.text();
      const wrote = k.line(RANK[lo], 'NEW-' + RANK[lo]);
      const shouldWrite = lo >= hi || RANK[hi] === 'transcript';
      assert.strictEqual(wrote, shouldWrite,
        RANK[lo] + ' over a live ' + RANK[hi] + ': expected write=' + shouldWrite + ', got ' + wrote);
      const expectedText = shouldWrite
        ? (RANK[lo] === 'transcript' ? '' : ('NEW-' + RANK[lo]))
        : held;
      assert.strictEqual(k.text(), expectedText,
        'the line shows the wrong message after ' + RANK[lo] + ' over ' + RANK[hi]);
    }
  }
}

/* 2e — the transcript NEVER holds the line: it updates constantly and must not lock anything. */
{
  const k = build();
  k.line('transcript', 'my back');
  assert.strictEqual(k.state().holdMs, 0, 'the transcript holds the line — it would lock out every notice');
  assert.strictEqual(k.line('hint', 'Microphone is off — the interview will use typing.'), true,
    'a hint could not replace a transcript fragment');
}

/* 2f — the five clinically important messages must all be reachable over a running transcript,
   because these are the ones a patient or the staff must not miss. */
{
  const MUST_REACH = [
    ['alert', 'Staff: nothing is being recorded. Allow the microphone for this site.'],
    ['alert', 'Staff: start the check-in again and confirm consent. Nothing is being recorded.'],
    ['alert', 'The microphone is not available here — typing works below.'],
    ['status', 'Staff: NOTHING was filed — the capture could not be filed.'],
    ['status', 'Please hand the screen back to the team.'],
  ];
  for (const [kind, msg] of MUST_REACH) {
    const k = build();
    k.line('transcript', 'it mostly hurts in the morning');
    assert.strictEqual(k.line(kind, msg), true, 'could not show over a live transcript: ' + msg);
    assert.strictEqual(k.text(), msg, 'wrong text on the line for: ' + msg);
  }
}

/* ── 3. AND THE NAME SLOT MUST NEVER KEEP ITS PLACEHOLDER ─────────────────────────────────
   Measured in a real kiosk render: #mlsAvKioskName read "One moment…" through every state,
   because the only writer replaced it solely when a name arrived and the caller gated on
   j.avatar existing at all. */
{
  assert.ok(/kioskSetIdentity\(j\.avatar \|\| null\);/.test(src),
    'kioskSetIdentity is gated on j.avatar again — a turn without an identity payload leaves ' +
    '"One moment…" standing where the assistant\'s name belongs');
  const at = src.indexOf('function kioskSetIdentity');
  const body = src.slice(at, at + 1200);
  assert.ok(/name\.textContent = gotName \|\| kiosk\.avName \|\| 'Your check-in assistant'/.test(body),
    'the name slot no longer falls back — the placeholder can survive again');
}

/* ⚠️ NOT A DEFECT, recorded so nobody "fixes" it: #mlsAvKioskState showing
   "Speaking · listening" is DELIBERATE. The microphone is open while the question plays, and
   the chip is designed to say both rather than picking one and lying. I flagged it as broken
   from a DOM dump before reading KIOSK_STATES; it is correct. */
assert.ok(/duplex: 'Speaking · listening'/.test(src),
  'the duplex state label changed — it says both on purpose, because the mic is open while the ' +
  'question plays; picking one would be a lie');

console.log('PASS one owner for the patient line: 0 direct writers survive, ' +
  (src.match(/kioskLine\('/g) || []).length + ' routed call sites, ranking holds in all 16 ' +
  'pairings, a transcript cannot wipe an alert, an alert never freezes the line, a new turn ' +
  'clears the hold, all 5 must-reach messages get through, and the name slot cannot keep ' +
  '"One moment…"');
