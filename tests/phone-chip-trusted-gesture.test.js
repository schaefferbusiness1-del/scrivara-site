'use strict';

/* Audit finding M10 (verified): both "📱 Record on phone" chips were DEAD.
 *
 * startPhoneMic (ScribeFlow.html) and startPhoneMicFromEasy (mls-connect.js)
 * both open with `if (!clickEvent || clickEvent.isTrusted !== true) return;`
 * — a deliberate guard so nothing scripted can start a recording. Both chips
 * called the shim with NO event, so it returned instantly; the fallback then
 * fired a synthetic `.click()` on #phoneMicBtn, which the same guard also
 * refuses. Tapping the chip did nothing at all, silently, on both surfaces.
 *
 * The fix must forward the chip's OWN trusted event, and must never "recover"
 * by synthesizing a click — that would defeat the gesture gate the guard
 * exists to enforce. A chip that cannot start the session must SAY so.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function region(src, start, end, label) {
  const a = src.indexOf(start);
  assert(a >= 0, label + ': start marker missing');
  const b = src.indexOf(end, a + start.length);
  assert(b > a, label + ': end marker missing');
  return src.slice(a, b);
}

/* The guards this test exists to protect must still be there. */
assert(/async function startPhoneMic\(clickEvent\)\{\s*\n\s*if\(!clickEvent \|\| clickEvent\.isTrusted!==true\) return;/.test(app),
  'startPhoneMic must keep refusing untrusted callers — never relax this to make a chip work');
assert(/function startPhoneMicFromEasy\(clickEvent\) \{\s*\n\s*if \(!clickEvent \|\| clickEvent\.isTrusted !== true\) return;/.test(connect),
  'startPhoneMicFromEasy must keep refusing untrusted callers');

/* Surface 1 — the ez3 flow-lane quick chip. */
{
  const chip = region(connect, "mkq('&#128241; Record on phone'", 'After-visit summary', 'flow-lane phone chip');
  assert(/function \(ev\) \{/.test(chip), 'the flow-lane chip handler must accept its click event');
  assert(/ev && ev\.isTrusted === true/.test(chip), 'it must check the event is trusted before using it');
  assert(/__mlsStartPhoneMicFromEasy\(ev\)/.test(chip), 'it must FORWARD the trusted event, not call with none');
  assert(!/pm\.click\(\)/.test(chip),
    'it must not fall back to a synthetic click — the trusted-gesture gate would refuse it anyway, silently');
  assert(/needs a direct tap/.test(chip), 'if it cannot start, the chip must say so rather than fail silently');
}

/* Surface 2 — the collapsed Tools chip. */
{
  const chip = region(connect, "on('ez3QPhone'", "on('ez3QAvs'", 'tools phone chip');
  assert(/function \(btn, ev\) \{/.test(chip),
    'the dispatcher passes (btn, ev) — the handler must accept them');
  assert(/ev && ev\.isTrusted === true/.test(chip), 'it must check the event is trusted');
  assert(/__mlsStartPhoneMicFromEasy\(ev\)/.test(chip), 'it must forward the trusted event');
  assert(!/clickCanonicalControl\('phoneMicBtn'/.test(chip),
    'it must not fall back to clicking the canonical control — that synthetic click is refused by the same guard');
  assert(/needs a direct tap/.test(chip), 'it must tell the doctor why nothing happened');
}

/* The dispatcher contract the fix depends on. */
assert(/var fn = MCLICKS\[btn\.id\] \|\| CLICKS\[btn\.id\];\s*\n\s*if \(fn\) \{ fn\(btn, ev\); return; \}/.test(connect),
  'the id-click dispatcher must keep passing (btn, ev) to handlers');

console.log('PASS phone chip trusted gesture: both "Record on phone" chips forward their real click event, neither synthesizes one, the isTrusted guards are intact, and a chip that cannot start says so');
