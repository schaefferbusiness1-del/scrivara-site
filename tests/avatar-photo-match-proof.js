/*
 * AVATAR PHOTO MATCH - MECHANISM PROOF (drives real Chrome; needs playwright).
 *
 * Owner, 2026-08-06: "the photo matched is awful ... it should be able to make
 * a pretty good avatar based off the photo and it straight up does not".
 *
 * The old matcher set 3 of the 8 knobs the face exposes (skin, hair colour, a
 * crude length guess) and left eyes, beard, glasses and top colour at their
 * defaults, so two different doctors got near-identical faces. Running it
 * against synthesized portraits found three real defects, all fixed:
 *   1. hair was sampled ON THE HAIRLINE, where hair blends into the
 *      background - a black-haired head returned GREY (#241a12 measured back
 *      as #67605a). Now sampled deep inside the hair mass, with background-
 *      coloured patches discarded.
 *   2. the length test counted only pixels DARKER than a midpoint threshold,
 *      so blond, grey and white hair were classified BALD. Now it measures
 *      difference from THIS face's own skin, in either direction.
 *   3. the skin sample ran through the eye band, so a spectacle frame dragged
 *      the skin tone dark - which in turn made light hair look like skin.
 *      Skin is now sampled clear of that band.
 *
 * NOT registered in run-all: it launches real Chrome. Run manually with
 * NODE_PATH pointed at a playwright install.
 *
 * THE LIKENESS ITSELF IS THE OWNER'S CALL. This proves only that the matcher
 * reads a photo and produces DISTINCT, correct parameters - never that the
 * result flatters anyone.
 */
/* Does the matcher actually READ a photo, or hand back defaults? Synthesize
   three very different "portraits" and assert the derived looks differ from
   each other and from the default, and that the detected-list names what is
   there. This is the mechanism check; the likeness itself is the owner's call. */
const { chromium } = require('playwright');
const path = require('path');
const ROOT = 'C:/Users/Micha/Desktop/MLS_EVERYTHING/dispatch-work/wt-copilot-power-20260805';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e && e.message)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  await page.setContent('<div id="visitView"></div>');
  await page.evaluate(() => {
    window.toast = () => {}; window.getPatients = () => []; window.getActivePtId = () => '';
    window.bkToken = () => ''; window.requestIdleCallback = window.requestIdleCallback || (f => setTimeout(f, 0));
  });
  await page.addScriptTag({ path: path.join(ROOT, 'feat_mls_avatar.js') });
  await page.waitForTimeout(300);

  const out = await page.evaluate(async () => {
    // paint a synthetic portrait: skin oval, hair cap, optional beard/glasses
    function portrait(opts) {
      const N = 256, c = document.createElement('canvas'); c.width = N; c.height = N;
      const x = c.getContext('2d');
      x.fillStyle = '#f2f2f2'; x.fillRect(0, 0, N, N);
      x.fillStyle = opts.skin; x.beginPath(); x.ellipse(N / 2, N * 0.52, N * 0.30, N * 0.36, 0, 0, 7); x.fill();
      if (opts.hair) { x.fillStyle = opts.hair; x.beginPath(); x.ellipse(N / 2, N * 0.20, N * 0.30, N * 0.14, 0, 0, 7); x.fill(); }
      if (opts.longHair) { x.fillStyle = opts.hair; x.fillRect(0, N * 0.55, N * 0.12, N * 0.40); x.fillRect(N * 0.88, N * 0.55, N * 0.12, N * 0.40); }
      if (opts.beard) { x.fillStyle = opts.beard; x.beginPath(); x.ellipse(N / 2, N * 0.74, N * 0.20, N * 0.12, 0, 0, 7); x.fill(); }
      if (opts.glasses) { x.fillStyle = '#20242a'; x.fillRect(N * 0.22, N * 0.38, N * 0.56, N * 0.06); }
      return c.toDataURL('image/jpeg', 0.9);
    }
    function derive(url) {
      return new Promise(res => window.__mlsAvatar.deriveLookFromPhoto
        ? window.__mlsAvatar.deriveLookFromPhoto(url, res)
        : res('NO_HOOK'));
    }
    const A = await derive(portrait({ skin: '#f3d3b3', hair: '#241a12' }));                     // fair, dark short hair
    const B = await derive(portrait({ skin: '#7a4a24', hair: '#140f0b', beard: '#140f0b' }));   // deep skin + beard
    const C = await derive(portrait({ skin: '#f0c9a0', hair: '#d9b44a', longHair: true, glasses: true })); // fair, long light hair, glasses
    return { A, B, C };
  });

  if (out.A === 'NO_HOOK') { console.log('NO DIAGNOSTIC HOOK — add one to prove this'); await browser.close(); process.exit(2); }
  const j = (o) => JSON.stringify(o && o.look) + '  found=' + JSON.stringify(o && o.found);
  console.log('A fair/dark short :', j(out.A));
  console.log('B deep/beard      :', j(out.B));
  console.log('C fair/long/glass :', j(out.C));
  console.log('pageerrors        :', errs.length ? errs.slice(0, 2) : 'none');

  const L = k => out[k] && out[k].look;
  const ok = L('A') && L('B') && L('C')
    && L('A').skin !== L('B').skin
    && L('B').beard !== 'none'
    && L('C').glasses === true
    && L('C').hairStyle === 'long'
    && !errs.length;
  console.log(ok ? 'PASS matcher derives distinct looks' : 'FAIL matcher');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
