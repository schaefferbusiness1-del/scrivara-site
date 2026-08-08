/*
 * THE PHOTO A WEBCAM ACTUALLY TAKES (drives real Chrome; needs playwright).
 *
 * Owner, 2026-08-07, holding his own Setup screen: "the match avataer to face
 * doesnt work at all make it actally match with skin tone beard or not and all
 * that kinda stuff it needs to have a facial algeraithum." The screenshot he
 * sent shows a dark-haired, bearded man and, beside it, the face the matcher
 * built from that photo: pale ivory hair, no beard.
 *
 * WHY THE EXISTING PROOF COULD NOT CATCH IT. tests/avatar-photo-match-proof.js
 * draws the head filling the frame - rx 0.29, ry 0.33, centred - and says so in
 * its own comment: "how tightly a real head fills that crop has not been
 * measured. If the shape verdict is wrong on the owner's own photo, the crop is
 * the first place to look." Every measurement in the old matcher was a fixed
 * fraction of the PICTURE, so on that fixture it worked and on a photograph
 * taken at arm's length it read the wall above the head as hair and the chest
 * as skin. 39 of 39 green, and the feature did not work.
 *
 * So this file draws the SAME faces the way a camera frames them: the head
 * filling a third to a half of the frame, sitting high or off to one side, with
 * a brighter ceiling above it and shoulders below - and asks for the same
 * answers. Nothing here is a new capability; it is the same capability, proven
 * on the input the product actually receives.
 *
 * IT RUNS THE OLD FILE TOO, from git, over the identical fixtures. That is the
 * control: if the old matcher passes these, this file is decoration.
 *
 * NOT registered in run-all: it launches real Chrome. Run manually with
 * NODE_PATH pointed at a playwright install. MLS_AVATAR_OLD may name a
 * checkout of the previous module to control against.
 */
const { chromium } = require('playwright');
const path = require('path');
const ROOT = process.env.MLS_AVATAR_DIR || path.resolve(__dirname, '..');
const OLD = process.env.MLS_AVATAR_OLD || '';

/* the fixture, drawn INSIDE a camera transform. o.scale/dx/dy place the head
   the way a webcam does; o.ceiling paints the brighter band above it that made
   a black-haired doctor come back blond; o.shoulders is the torso that a
   head-only crop does not have. */
const FIXTURE = function (o) {
  const N = 256, c = document.createElement('canvas'); c.width = N; c.height = N;
  const x = c.getContext('2d');
  x.fillStyle = o.bg || '#eceae4'; x.fillRect(0, 0, N, N);
  if (o.ceiling) { x.fillStyle = o.ceiling; x.fillRect(0, 0, N, N * (o.ceilingH || 0.20)); }
  if (o.shoulders) {
    x.fillStyle = o.shoulders;
    const sy = N * (0.5 + (o.dy || 0) + (o.scale || 1) * 0.36);
    x.beginPath(); x.ellipse(N / 2 + N * (o.dx || 0), sy + N * 0.30, N * 0.44, N * 0.26, 0, 0, 7); x.fill();
  }
  x.save();
  const s = o.scale || 1;
  x.translate(N / 2 + N * (o.dx || 0), N / 2 + N * (o.dy || 0));
  x.scale(s, s);
  x.translate(-N / 2, -N / 2);
  const rx = (o.rx || 0.29), ry = (o.ry || 0.33), cy = 0.49;
  if (o.face !== false) {
    x.fillStyle = o.skin; x.beginPath(); x.ellipse(N / 2, N * cy, N * rx, N * ry, 0, 0, 7); x.fill();
    /* the neck, which a real photograph always has and which is what a chin
       detector has to stop at */
    x.fillStyle = o.skin; x.fillRect(N * (0.5 - rx * 0.34), N * (cy + ry * 0.92), N * rx * 0.68, N * 0.22);
    if (o.irisDx) {
      x.fillStyle = '#241a12';
      x.beginPath(); x.ellipse(N * (0.5 - o.irisDx), N * 0.45, N * 0.028, N * 0.028, 0, 0, 7); x.fill();
      x.beginPath(); x.ellipse(N * (0.5 + o.irisDx), N * 0.45, N * 0.028, N * 0.028, 0, 0, 7); x.fill();
    }
    if (o.hair) { x.fillStyle = o.hair; x.beginPath(); x.ellipse(N / 2, N * 0.18, N * rx, N * 0.14, 0, 0, 7); x.fill(); }
    if (o.longHair) { x.fillStyle = o.hair; x.fillRect(N * (0.5 - rx - 0.09), N * 0.55, N * 0.09, N * 0.34); x.fillRect(N * (0.5 + rx), N * 0.55, N * 0.09, N * 0.34); }
    if (o.beard) { x.fillStyle = o.beard; x.beginPath(); x.ellipse(N / 2, N * (cy + ry * 0.72), N * rx * 0.69, N * ry * 0.33, 0, 0, 7); x.fill(); }
    if (o.glasses) { x.fillStyle = '#20242a'; x.fillRect(N * 0.22, N * 0.38, N * 0.56, N * 0.06); }
  }
  x.restore();
  return c.toDataURL('image/jpeg', 0.92);
};

/* every case is the SAME face as the tight-crop suite, framed by a camera */
const CASES = {
  /* the headline: a webcam portrait with a bright ceiling above the head. This
     is the owner's photo in geometry - and the answer the old matcher gave was
     ivory hair. */
  W1: { label: 'webcam, dark hair, bright ceiling', o: { skin: '#f3d3b3', hair: '#241a12', scale: 0.55, dy: -0.02, ceiling: '#ffffff' } },
  W2: { label: 'webcam, dark hair AND a beard', o: { skin: '#f3d3b3', hair: '#241a12', beard: '#241a12', scale: 0.50, dy: 0.03, ceiling: '#fbfbfb' } },
  W3: { label: 'far back - head is a third of the frame', o: { skin: '#f0c9a0', hair: '#3a2a1c', scale: 0.38, ceiling: '#ffffff' } },
  W4: { label: 'off to one side', o: { skin: '#f0c9a0', hair: '#3a2a1c', scale: 0.55, dx: -0.13, dy: -0.04 } },
  W5: { label: 'grey hair, small in frame', o: { skin: '#f0c9a0', hair: '#c9c6c0', scale: 0.50, bg: '#3a3f45' } },
  W6: { label: 'bald, small in frame', o: { skin: '#f0c9a0', scale: 0.50, ceiling: '#ffffff' } },
  W7: { label: 'glasses, small in frame', o: { skin: '#f0c9a0', hair: '#3a2a1c', glasses: true, scale: 0.52 } },
  W8: { label: 'long hair, small in frame', o: { skin: '#f0c9a0', hair: '#4a3a28', longHair: true, scale: 0.52 } },
  W9: { label: 'deep skin, black hair, small', o: { skin: '#5a3418', hair: '#140f0b', scale: 0.52, bg: '#dcdcd6' } },
  W10: { label: 'NO FACE - a beige wall', o: { face: false, bg: '#e8d9c0', skin: '#e8d9c0' } },
  W11: { label: 'a warm beige wall AND a small face', o: { skin: '#f3d3b3', hair: '#241a12', scale: 0.44, bg: '#e8d9c0' } },
  W12: { label: 'shoulders in shot (a teal top)', o: { skin: '#f0c9a0', hair: '#3a2a1c', scale: 0.55, shoulders: '#1f6f78' } },
  W13: { label: 'irises visible, small in frame', o: { skin: '#f0c9a0', hair: '#3a2a1c', scale: 0.55, irisDx: 0.195 } }
};

async function probe(file) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e && e.message)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  await page.setContent('<div id="visitView"></div>');
  await page.evaluate(() => {
    window.toast = () => {}; window.getPatients = () => []; window.getActivePtId = () => '';
    window.bkToken = () => ''; window.requestIdleCallback = window.requestIdleCallback || (f => setTimeout(f, 0));
  });
  await page.addScriptTag({ path: file });
  await page.waitForTimeout(250);
  const out = await page.evaluate(async ({ fixtureSrc, cases }) => {
    const portrait = eval('(' + fixtureSrc + ')');
    const res = {};
    for (const k of Object.keys(cases)) {
      const url = portrait(cases[k].o);
      res[k] = await new Promise(r => window.__mlsAvatar.deriveLookFromPhoto
        ? window.__mlsAvatar.deriveLookFromPhoto(url, r) : r('NO_HOOK'));
    }
    return res;
  }, { fixtureSrc: FIXTURE.toString(), cases: CASES });
  await browser.close();
  return { out, errs };
}

function lumOf(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return -1;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return (r * 3 + g * 4 + b) / 8;
}

/* the claims, expressed against whatever result set is handed in, so the new
   file and the old file are judged by exactly the same yardstick */
function checks(out) {
  const L = k => (out[k] && out[k].look) || {};
  const D = k => (out[k] && out[k].derived) || [];
  const got = k => !!(out[k] && out[k].look);
  return [
    ['W1 a webcam portrait is read at all', got('W1')],
    ['W1 DARK HAIR STAYS DARK under a bright ceiling (the reported defect)', lumOf(L('W1').hair) >= 0 && lumOf(L('W1').hair) < 90],
    ['W1 and the head is not called bald', L('W1').hairStyle !== 'bald'],
    ['W1 fair skin is still fair', lumOf(L('W1').skin) > 170],
    ['W2 the beard is found on a webcam portrait', L('W2').beard === 'beard'],
    ['W2 and its hair is still dark', lumOf(L('W2').hair) >= 0 && lumOf(L('W2').hair) < 90],
    ['W3 a head filling a third of the frame is still read', got('W3')],
    ['W3 dark hair, from a third of a frame', lumOf(L('W3').hair) >= 0 && lumOf(L('W3').hair) < 110],
    ['W4 an off-centre head is read', got('W4')],
    ['W4 with dark hair', lumOf(L('W4').hair) >= 0 && lumOf(L('W4').hair) < 110],
    ['W5 grey hair is not BALD (it is lighter than the skin, not darker)', L('W5').hairStyle !== 'bald'],
    ['W5 and it reads light', lumOf(L('W5').hair) > 150],
    ['W6 a bald head IS bald', L('W6').hairStyle === 'bald'],
    ['W7 glasses are found on a small face', L('W7').glasses === true],
    ['W8 long hair is found on a small face', L('W8').hairStyle === 'long'],
    ['W9 deep skin is read as deep, not lightened', lumOf(L('W9').skin) > 0 && lumOf(L('W9').skin) < 110],
    ['W9 and its black hair is not mistaken for the skin', lumOf(L('W9').hair) >= 0 && lumOf(L('W9').hair) < 70],
    ['W10 A WALL WITH NO FACE IS REFUSED, not described', !got('W10')],
    /* W11 IS THE HARD ONE AND THE CLAIM IS DELIBERATELY THE WEAKER ONE. A face
       against a wall of nearly the same colour AND the same brightness (beige
       #e8d9c0 behind #f3d3b3 skin - four luminance apart) cannot be separated
       by colour, because there is no colour difference to separate. What must
       never happen is the wall being reported as the doctor's skin tone. Either
       answer is acceptable: the face, or an honest refusal that sends the
       doctor back to retake the photo. Today it refuses, and Setup says why. */
    ['W11 a skin-coloured wall is NEVER reported as the doctor\'s skin',
      !got('W11') || Math.abs(lumOf(L('W11').skin) - lumOf('#f3d3b3')) < 40],
    ['W12 the top colour comes off the shoulders', D('W12').indexOf('shirt') >= 0 && lumOf(L('W12').shirt) >= 0],
    ['W12 and it is not the stock scrub green', L('W12').shirt !== '#2E6A4B'],
    ['W13 eye spacing is read when the irises are visible', D('W13').indexOf('eyeSet') >= 0],
    ['W13 and wide-set irises read as wide', L('W13').eyeSet === 'wide']
  ];
}

(async () => {
  const now = await probe(path.join(ROOT, 'feat_mls_avatar.js'));
  if (now.out.W1 === 'NO_HOOK') { console.log('NO DIAGNOSTIC HOOK'); process.exit(2); }
  for (const k of Object.keys(CASES)) {
    const r = now.out[k];
    console.log(k.padEnd(4) + CASES[k].label.padEnd(42) +
      (r ? JSON.stringify({ skin: r.look.skin, hair: r.look.hair, style: r.look.hairStyle, beard: r.look.beard, glasses: r.look.glasses, shirt: r.look.shirt }) : 'REFUSED (null)'));
  }
  console.log('pageerrors:', now.errs.length ? now.errs.slice(0, 2) : 'none');

  const rows = checks(now.out);
  let bad = 0;
  for (const [name, ok] of rows) { if (!ok) bad++; console.log((ok ? '  ok   ' : '  FAIL ') + name); }
  console.log('no page errors'.padEnd(0) + (now.errs.length ? '  FAIL page errors' : '  ok   no page errors'));
  if (now.errs.length) bad++;

  /* ---- THE CONTROL ---- */
  if (OLD) {
    const before = await probe(OLD);
    const oldRows = checks(before.out);
    const oldBad = oldRows.filter(r => !r[1]).length;
    console.log('\nCONTROL — the same fixtures against ' + OLD);
    for (const [name, ok] of oldRows) console.log((ok ? '  ok   ' : '  FAIL ') + name);
    console.log('CONTROL RESULT: ' + oldBad + ' of ' + oldRows.length + ' fail on the old matcher' +
      (oldBad ? '' : '  <-- THE OLD CODE PASSES: THIS FILE IS NOT TESTING ANYTHING'));
    if (!oldBad) bad++;
  }

  console.log(bad
    ? ('FAIL framed photo match: ' + bad + ' problems')
    : ('PASS framed photo match: ' + rows.length + '/' + rows.length +
       ' — the face is located before it is measured, so a webcam portrait reads the same as a tight crop, ' +
       'and a photo with no face in it is refused'));
  process.exit(bad ? 1 : 0);
})();
