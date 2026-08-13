/*
 * AVATAR PHOTO MATCH - MECHANISM PROOF (drives real Chrome; needs playwright).
 *
 * Owner, 2026-08-06: "the photo matched is awful ... it should be able to make
 * a pretty good avatar based off the photo and it straight up does not".
 * Owner, 2026-08-07: "have it conform to the picture of the person better".
 *
 * THE LIKENESS ITSELF IS THE OWNER'S CALL. This proves only that the matcher
 * READS a photo and produces distinct, correct parameters - never that the
 * result flatters anyone.
 *
 * Round one (colour) found three real defects against synthesized portraits:
 *   1. hair was sampled ON THE HAIRLINE, where hair blends into the
 *      background - a black-haired head returned GREY (#241a12 measured back
 *      as #67605a). Now sampled deep inside the hair mass.
 *   2. the length test counted only pixels DARKER than a midpoint threshold,
 *      so blond, grey and white hair were classified BALD. Now it measures
 *      difference from THIS face's own skin, in either direction.
 *   3. the skin sample ran through the eye band, so a spectacle frame dragged
 *      the skin tone dark - which in turn made light hair look like skin.
 *
 * Round two (shape) found three more, all of which this file now pins:
 *   4. THE BEARD DETECTOR SAMPLED THE MOUTH. Its three patches sat at (0.50,
 *      0.74) and (0.40/0.60, 0.70) - on the lips and beside them - so a dark
 *      lip colour read as a drop from the cheeks and a CLEAN-SHAVEN face came
 *      back bearded. Case E is that exact portrait.
 *   5. the brow band ran to y 0.45 and the eyes are sampled at 0.44, so pupil
 *      and lash counted as eyebrow.
 *   6. the nose measure scanned CONTIGUOUSLY outward from the centre line -
 *      but the middle of a nose is the lit ridge, so the scan broke on the
 *      first bright pixel and measured zero on every real face.
 *
 * THE CONTRACT THIS FILE EXISTS FOR: `derived` must name only what was really
 * measured. A knob that is absent from it is one the caller leaves alone, so
 * an over-eager entry silently overwrites a setting the doctor chose by hand.
 * Cases F and G are the negative side of that and matter more than the rest:
 * a flat face must claim NO nose, and a head-only crop must claim NO top.
 *
 * NOT registered in run-all: it launches real Chrome. Run manually with
 * NODE_PATH pointed at a playwright install.
 */
const { chromium } = require('playwright');
const path = require('path');
/* the tree this file lives in, not a machine-specific absolute path: a proof
   pinned to one worktree silently measures ANOTHER lane's bytes when it is run
   from anywhere else. MLS_AVATAR_DIR overrides it for old-vs-new controls. */
const ROOT = process.env.MLS_AVATAR_DIR || path.resolve(__dirname, '..');
const ASSET = process.env.MLS_AVATAR_ASSET || 'feat_mls_avatar.js';
const IS_P1 = /^1p-/.test(path.basename(ASSET));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e && e.message)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  await page.setContent('<div id="visitView"></div>');
  await page.evaluate((isP1) => {
    window.toast = () => {}; window.getPatients = () => []; window.getActivePtId = () => '';
    window.__mlsSessionEpoch = isP1 ? 91 : 0;
    window.__mlsSessionAccount = isP1 ? 'avatar-proof@example.test' : '';
    window.bkToken = () => isP1 ? 'synthetic-avatar-proof-token' : '';
    window.requestIdleCallback = window.requestIdleCallback || (f => setTimeout(f, 0));
  }, IS_P1);
  const assetSource = require('fs').readFileSync(path.join(ROOT, ASSET), 'utf8');
  await page.evaluate(({assetSource,isP1,asset}) => {
    const script = document.createElement('script');
    if (isP1) {
      script.setAttribute('data-mls-install-token','synthetic-avatar-proof-install');
      script.setAttribute('data-mls-asset',asset);
    }
    script.textContent = assetSource; document.head.appendChild(script);
  }, {assetSource,isP1:IS_P1,asset:ASSET});
  await page.waitForTimeout(300);

  const out = await page.evaluate(async () => {
    /* a synthetic portrait at 256px, in the SAME geometry stylizePortrait
       guarantees: a centred square crop with the head filling the frame. */
    function portrait(o) {
      const N = 256, c = document.createElement('canvas'); c.width = N; c.height = N;
      const x = c.getContext('2d');
      x.fillStyle = o.bg || '#f2f2f2'; x.fillRect(0, 0, N, N);
      if (o.shirt) { x.fillStyle = o.shirt; x.fillRect(0, N * 0.86, N, N * 0.14); }
      /* THE HEAD, drawn in the SAME proportions faceSvg draws — rx 58, ry 66,
         centred at y 98 on a 200 viewBox — so "oval" here means the exact head
         the product renders, and the shape thresholds are being tested against
         the geometry they were derived from rather than an arbitrary egg.
         A NOTE ON WHAT THIS DOES NOT PROVE: real portraits arrive through
         stylizePortrait's centred square crop, and how tightly a real head
         fills that crop has not been measured. If the shape verdict is wrong
         on the owner's own photo, the crop is the first place to look. */
      const rx = (o.rx || 0.29), ry = (o.ry || 0.33), cy = 0.49;
      x.fillStyle = o.skin; x.beginPath(); x.ellipse(N / 2, N * cy, N * rx, N * ry, 0, 0, 7); x.fill();
      /* a square jaw is the face still being wide low down — drawn as a
         straight-sided block from the cheeks to the chin, which is what
         actually distinguishes one from an oval in a front-on photo. */
      if (o.squareJaw) {
        x.fillStyle = o.skin;
        x.fillRect(N * (0.5 - rx * 0.97), N * 0.55, N * rx * 1.94, N * (cy + ry - 0.55));
      }
      /* the irises: two dark discs at a KNOWN separation, so eye spacing is
         measured against a number the fixture chose rather than inferred. */
      if (o.irisDx) {
        x.fillStyle = '#241a12';
        x.beginPath(); x.ellipse(N * (0.5 - o.irisDx), N * 0.45, N * 0.028, N * 0.028, 0, 0, 7); x.fill();
        x.beginPath(); x.ellipse(N * (0.5 + o.irisDx), N * 0.45, N * 0.028, N * 0.028, 0, 0, 7); x.fill();
      }
      if (o.hair) { x.fillStyle = o.hair; x.beginPath(); x.ellipse(N / 2, N * 0.18, N * rx, N * 0.14, 0, 0, 7); x.fill(); }
      /* a receding hairline: skin painted back over the two temples, leaving
         the crown haired. Bare temples ALONE would be a bald head, and the
         detector has to tell those apart. */
      if (o.receding) {
        x.fillStyle = o.skin;
        x.fillRect(N * 0.26, N * 0.13, N * 0.13, N * 0.16);
        x.fillRect(N * 0.61, N * 0.13, N * 0.13, N * 0.16);
      }
      if (o.longHair) { x.fillStyle = o.hair; x.fillRect(0, N * 0.55, N * 0.12, N * 0.40); x.fillRect(N * 0.88, N * 0.55, N * 0.12, N * 0.40); }
      /* the beard rides the JAW, so it moves with the head rather than
         hanging off a long face and onto the background. */
      if (o.beard) { x.fillStyle = o.beard; x.beginPath(); x.ellipse(N / 2, N * (cy + ry * 0.72), N * rx * 0.69, N * ry * 0.33, 0, 0, 7); x.fill(); }
      /* brows sit BETWEEN the forehead and the eyes - y 0.37, just above the
         eye line at 0.44. Drawn at 0.33 they were inside the hair mass, which
         is how the first run of this file caught the matcher measuring a
         fringe on a face that had no eyebrows at all. */
      if (o.browPx) {
        x.fillStyle = o.browColor || '#2a1d12';
        x.fillRect(N * 0.28, N * 0.37, N * 0.15, o.browPx);
        x.fillRect(N * 0.57, N * 0.37, N * 0.15, o.browPx);
      }
      /* the alar shading of a nose: two shaded flanks, a LIT ridge between
         them - the arrangement that broke the first version of the measure */
      if (o.noseHalf) {
        x.fillStyle = 'rgba(0,0,0,0.22)';
        x.fillRect(N * (0.5 - o.noseHalf), N * 0.54, N * (o.noseHalf - 0.02), N * 0.09);
        x.fillRect(N * (0.5 + 0.02), N * 0.54, N * (o.noseHalf - 0.02), N * 0.09);
      }
      if (o.lipPx) {
        x.fillStyle = o.lipColor || '#b8543f';
        x.beginPath(); x.ellipse(N / 2, N * 0.72, N * 0.11, o.lipPx, 0, 0, 7); x.fill();
      }
      /* a real frame sits across y 0.38-0.44, which is where the matcher probes
         for one AND where an eyebrow is. That collision is the point of case
         C: the frame must be read as glasses, and the brow measure must then
         decline to answer rather than report the frame as thick eyebrows. */
      if (o.glasses) { x.fillStyle = '#20242a'; x.fillRect(N * 0.22, N * 0.38, N * 0.56, N * 0.06); }
      return c.toDataURL('image/jpeg', 0.95);
    }
    function derive(url) {
      return new Promise(res => {
        if (!window.__mlsAvatar || !window.__mlsAvatar.deriveLookFromPhoto) return res('NO_HOOK');
        const accepted = window.__mlsAvatar.deriveLookFromPhoto(url, res);
        if (accepted === false) res('REFUSED');
      });
    }
    const A = await derive(portrait({ skin: '#f3d3b3', hair: '#241a12' }));
    const B = await derive(portrait({ skin: '#7a4a24', hair: '#140f0b', beard: '#140f0b' }));
    const C = await derive(portrait({ skin: '#f0c9a0', hair: '#d9b44a', longHair: true, glasses: true }));
    /* D: thick brows, full lips, a WIDE nose and a teal top - every shape knob
       at its far end at once, so a matcher that ignores them cannot pass. */
    const D = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', browPx: 16, lipPx: 16, noseHalf: 0.115, shirt: '#1f6f78' }));
    /* E: RED LIPS AND NO BEARD - defect 4's exact portrait. */
    const E = await derive(portrait({ skin: '#f3d3b3', hair: '#241a12', lipPx: 13, lipColor: '#9e3324' }));
    /* F: a flat face - nothing to measure. Must claim no nose and no lips. */
    const F = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c' }));
    /* G: head-only crop on a plain wall - must NOT claim a top colour. */
    const G = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', bg: '#eceae4' }));
    /* H: thin brows and a narrow nose - the OTHER end of D, so the classifier
       is proven to discriminate rather than to answer "thick" every time. */
    const H = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', browPx: 4, lipPx: 3, noseHalf: 0.05 }));
    /* I: the MIDDLE of every scale. Two ends can be split by a single
       threshold in the wrong place; three cannot. */
    const I = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', browPx: 8, lipPx: 8, noseHalf: 0.085 }));
    /* ---- the HEAD, not the paint on it ---- */
    /* J: a LONG face — narrow and tall. */
    const J = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', rx: 0.26, ry: 0.37 }));
    /* K: a ROUND face — wide and short. */
    const K = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', rx: 0.315, ry: 0.30 }));
    /* L: a SQUARE JAW on otherwise oval proportions. It must outrank the
       oval verdict, or a jaw is only ever visible on a face that was already
       going to be called round. */
    const L2 = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', squareJaw: true }));
    /* M/N: the two ends of eye spacing, at separations the fixture chose. */
    const M2 = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', irisDx: 0.115 }));
    const N2 = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', irisDx: 0.195 }));
    /* O: a RECEDING hairline — bare temples, haired crown. */
    const O = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', receding: true }));
    /* P: BALD — bare temples AND a bare crown. Must NOT be called receding:
       the two look identical to a temples-only test. */
    const P = await derive(portrait({ skin: '#f0c9a0' }));
    /* Q: DARK BROWS UNDER GREY HAIR — the strongest likeness cue the drawn
       face has, and the one it could not express while brows were painted in
       the hair colour. */
    const Q = await derive(portrait({ skin: '#f0c9a0', hair: '#c9c6c0', browPx: 8, browColor: '#241a12' }));
    /* R: brows the SAME colour as the hair. The honest answer is to say
       nothing and let them follow the hair, not to set a redundant colour. */
    const R = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', browPx: 8, browColor: '#3a2a1c' }));
    /* S: A HEAD THAT RUNS OFF THE PICTURE. The first version of the frame-
       boundary guard was UNTESTED - deleting it left this suite at 37/37,
       which is the same as not having written it. A crop with no margin
       makes the edge scan return column 0 and column M-1: that is not a
       very wide face, it is an unanswerable question, and the whole skull
       group must decline together rather than compute from a full-frame
       width. Tight crops are ordinary - phones frame faces like this. */
    const S = await derive(portrait({ skin: '#f0c9a0', hair: '#3a2a1c', rx: 0.52, ry: 0.30 }));
    return { A, B, C, D, E, F, G, H, I, J, K, L2, M2, N2, O, P, Q, R, S };
  });

  if (out.A === 'NO_HOOK') { console.log('NO DIAGNOSTIC HOOK — add one to prove this'); await browser.close(); process.exit(2); }
  const L = k => (out[k] && out[k].look) || {};
  const D_ = k => (out[k] && out[k].derived) || [];
  const show = (k, label) => console.log(
    label.padEnd(24) + JSON.stringify(L(k)) + '\n' + ' '.repeat(24) + 'derived=' + JSON.stringify(D_(k)));
  show('A', 'A fair/dark short');
  show('B', 'B deep/beard');
  show('C', 'C fair/long/glasses');
  show('D', 'D thick+full+wide+top');
  show('E', 'E red lips, NO beard');
  show('F', 'F flat face');
  show('G', 'G head-only crop');
  show('H', 'H thin+narrow');
  show('I', 'I mid on every scale');
  show('J', 'J long face');
  show('K', 'K round face');
  show('L2', 'L square jaw');
  show('M2', 'M close-set eyes');
  show('N2', 'N wide-set eyes');
  show('O', 'O receding hairline');
  show('P', 'P bald (not receding)');
  show('Q', 'Q dark brows / grey hair');
  show('R', 'R brows match the hair');
  show('S', 'S head runs off frame');
  console.log('pageerrors        :', errs.length ? errs.slice(0, 2) : 'none');

  const checks = [
    ['colour still works: skin differs between fair and deep', L('A').skin !== L('B').skin],
    ['colour still works: the bearded portrait reads a beard', L('B').beard !== 'none'],
    ['colour still works: glasses detected', L('C').glasses === true],
    ['colour still works: long hair detected', L('C').hairStyle === 'long'],
    ['D: thick brows read as thick', L('D').brows === 'thick'],
    ['D: full lips read as full', L('D').lips === 'full'],
    ['D: a wide nose reads as wide', L('D').nose === 'wide'],
    ['D: the top colour is taken from the photo', D_('D').indexOf('shirt') >= 0],
    ['D: and it is not the stock scrub green', L('D').shirt !== '#2E6A4B'],
    ['H: thin brows read as thin (not everything is "thick")', L('H').brows === 'thin'],
    ['H: thin lips read as thin', L('H').lips === 'thin'],
    ['H: a narrow nose reads as button (not everything is "wide")', L('H').nose === 'button'],
    ['I: mid brows land in the MIDDLE, not at an end', L('I').brows === 'normal'],
    ['I: mid lips land in the middle', L('I').lips === 'normal'],
    ['I: a mid nose lands in the middle', L('I').nose === 'straight'],
    ['F: a face with no eyebrows claims NO brows (the hairline is not a brow)', D_('F').indexOf('brows') < 0],
    ['E: RED LIPS ON A CLEAN-SHAVEN FACE DO NOT READ AS A BEARD',
      L('E').beard !== 'beard' && L('E').beard !== 'stubble' && D_('E').indexOf('beard') < 0],
    ['E: those same lips ARE read as lips', D_('E').indexOf('lips') >= 0],
    ['F: a flat face claims NO nose', D_('F').indexOf('nose') < 0],
    ['F: a flat face claims NO lips', D_('F').indexOf('lips') < 0],
    ['G: a head-only crop claims NO top colour', D_('G').indexOf('shirt') < 0],
    ['C: a spectacle frame is not reported as eyebrows', D_('C').indexOf('brows') < 0],
    ['derived never names a knob no photo can decide (cap)', !['A','B','C','D','E','F','G','H','I','J','K','L2','M2','N2','O','P','Q','R','S'].some(k => D_(k).indexOf('cap') >= 0)],
    ['derived never names a knob no photo can decide (stethoscope)', !['A','B','C','D','E','F','G','H','I','J','K','L2','M2','N2','O','P','Q','R','S'].some(k => D_(k).indexOf('stethoscope') >= 0)],
    /* One front-on silhouette cannot reliably separate face shape from crop,
       hairstyle and camera distance. Refusal is safer than painting a guessed
       jaw onto a clinician, and the model may only rescue it as part of a
       coherent whole-face receipt. */
    ['J: a narrow tall crop does not claim a face shape', D_('J').indexOf('faceShape') < 0],
    ['K: a wide short crop does not claim a face shape', D_('K').indexOf('faceShape') < 0],
    ['L: a synthetic square jaw does not create a standalone shape claim', D_('L2').indexOf('faceShape') < 0],
    ['A: an ordinary head does not present the default oval as measured', D_('A').indexOf('faceShape') < 0],
    ['M: close-set irises read as close', L('M2').eyeSet === 'close'],
    ['N: wide-set irises read as wide', L('N2').eyeSet === 'wide'],
    ['O: bare temples with a haired crown read as receding', L('O').hairline === 'receding'],
    ['P: A BALD HEAD IS NOT A RECEDING ONE (bare temples alone must not decide)', L('P').hairline !== 'receding'],
    ['Q: dark brows under grey hair get their own colour', D_('Q').indexOf('browCol') >= 0],
    ['Q: and it is the brow colour, not the hair colour', L('Q').browCol && L('Q').browCol !== L('Q').hair],
    ['R: brows matching the hair claim NO separate colour', D_('R').indexOf('browCol') < 0],
    ['`age` is never derived — folds are not measurable at this resolution',
      !['A','B','C','D','E','F','G','H','I','J','K','L2','M2','N2','O','P','Q','R','S'].some(k => D_(k).indexOf('age') >= 0)],
    ['S: A FACE THAT RUNS OFF THE PICTURE CLAIMS NO SHAPE', D_('S').indexOf('faceShape') < 0],
    ['S: and no eye spacing either - the group declines together', D_('S').indexOf('eyeSet') < 0],
    ['no page errors', !errs.length],
  ];
  let bad = 0;
  for (const [name, ok] of checks) { if (!ok) bad++; console.log((ok ? '  ok   ' : '  FAIL ') + name); }
  console.log(bad
    ? ('FAIL photo match: ' + bad + ' of ' + checks.length + ' checks')
    : ('PASS photo match: ' + checks.length + '/' + checks.length + ' — colour and supported geometry are read from the photo, ' +
       'and `derived` refuses to claim what the pixels do not show'));
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
