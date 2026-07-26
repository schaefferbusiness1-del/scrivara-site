'use strict';

/* Two patient-facing surfaces, both fixed by REMOVING motion rather than adding it.
 *
 * 1. patient-portal.html silently truncated a patient's own record.
 *
 *      .li-detail{max-height:0;overflow:hidden;transition:max-height .24s ease}
 *      li.li-x[data-exp="1"] .li-detail{max-height:640px}
 *
 *    max-height REFLOWS the record list every frame for 240ms — a layout
 *    property, the one kind this app's motion system forbids — and eased over a
 *    FIXED 640px range rather than the real content height, so a short detail
 *    snapped open in ~40ms then sat still for 200ms.
 *
 *    Worse, overflow:hidden at 640px CLIPPED anything longer, with no scrollbar
 *    and no affordance. A patient reading their own medications would conclude
 *    that was all of them. The @media print rule (max-height:none!important) is
 *    the tell that someone already hit this and fixed it for paper only.
 *
 * 2. phone.html pulsed the Record button through prefers-reduced-motion.
 *
 *    Every other animation on that page sits inside the no-preference block. This
 *    one sat outside it, and the page has no `reduce` block at all — so it was the
 *    only unstoppable animation there, running for the ENTIRE visit on a battery
 *    device holding a wake lock and uploading audio, repainting a 200px circle
 *    plus a 14px ring every frame.
 *
 *    Only the animation moved inside the guard. background and color stay
 *    unconditional, so the recording state is still unmistakable by colour:
 *    reduce motion, never reduce information.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

/* ---- 1. a patient's record is never clipped, and never reflows ---- */
{
  const portal = fs.readFileSync(path.join(root, 'patient-portal.html'), 'utf8');

  assert.ok(
    !/transition:\s*max-height/.test(portal),
    'a max-height transition is back. It animates a LAYOUT property, reflowing ' +
    'the record list every frame, and eased over a fixed range it cannot even ' +
    'time correctly. If a beat is wanted, put opacity/transform on .li-detail-in ' +
    'inside the existing no-preference block.'
  );
  assert.ok(
    !/\.li-detail\{[^}]*max-height:\s*\d+px/.test(portal) &&
    !/\[data-exp="1"\][^{]*\.li-detail\{[^}]*max-height:\s*\d+px/.test(portal),
    'the open state uses a NUMERIC max-height again. Anything longer than that ' +
    'number is clipped with no scrollbar and no affordance, and a patient reading ' +
    'their own medications concludes that is the whole record.'
  );
  assert.ok(
    /\[data-exp="1"\][^{]*\.li-detail\{[^}]*max-height:\s*none/.test(portal),
    'the open state must be max-height:none so nothing can ever be truncated'
  );
}

/* ---- 2. nothing on the phone animates through a reduced-motion request ---- */
{
  const phone = fs.readFileSync(path.join(root, 'phone.html'), 'utf8');

  const guardIdx = phone.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(guardIdx > 0, 'phone.html lost its reduced-motion guard block entirely');

  /* every animation declaration must sit inside the guard */
  const re = /animation:\s*[a-zA-Z]/g;
  let m;
  const stray = [];
  while ((m = re.exec(phone))) {
    if (m.index < guardIdx) stray.push(phone.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, ' '));
  }
  assert.deepStrictEqual(
    stray, [],
    'animation declared OUTSIDE the no-preference block, so it cannot be turned ' +
    'off. On the phone recorder this runs for the whole visit, on battery, while ' +
    'holding a wake lock and uploading audio:\n  ' + stray.join('\n  ')
  );

  /* and the recording state must still be legible without motion */
  assert.ok(
    /\.recBtn\.on\{[^}]*background:[^}]*color:/.test(phone),
    'the .recBtn.on colour must stay OUTSIDE the motion guard. Reduce motion, ' +
    'never reduce information — someone who asked for less motion still has to be ' +
    'able to see that recording is live.'
  );
}

/* ---- 3. the guards can fail ---- */
{
  assert.ok(
    /transition:\s*max-height/.test('.x{transition:max-height .24s ease}'),
    'the max-height detector does not match a real declaration'
  );
  assert.ok(
    /\.li-detail\{[^}]*max-height:\s*\d+px/.test('.li-detail{max-height:640px}'),
    'the numeric-clip detector does not match a real declaration'
  );
}

console.log('PASS patient-surfaces-clip-nothing-and-stop-moving: the portal record expands to ' +
  'its full height with no layout animation, and every phone animation honours ' +
  'prefers-reduced-motion while the recording colour does not');
