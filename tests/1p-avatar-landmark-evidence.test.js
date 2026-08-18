'use strict';

/*
 * /1p/ preview only — avml-1.0.0: THE BUNDLED FACE LANDMARK MODEL, AND THE
 * ABSENCES IT MAKES CLAIMABLE.
 *
 * Owner, 2026-08-18: "this face to avatar is still a nightmare and needs a lot
 * of work." The lane before this one measured exactly why and could not fix it:
 * five of the fourteen ledger entries — beard, glasses, hairline, browCol,
 * faceShape — are pushed ONLY when the feature is PRESENT, or never, so a
 * clean-shaven doctor with no glasses "CANNOT score above nine of fourteen
 * however good the photograph is". It also wrote down the price of the fix:
 * claiming an absence needs POSITIVE EVIDENCE, and the pixel ladder has no
 * region it can point at and call "chin".
 *
 * This suite is the proof that the bundled model supplies that region, and that
 * nothing was loosened to get the count up. It has three parts:
 *
 *   PART 1  the bundle itself — exact bytes, exact digests, the size budget, the
 *           licence notices, and the two CSP edits (both /1p twins carry
 *           'wasm-unsafe-eval'; production ScribeFlow.html and /cloned do not).
 *   PART 2  THE EXECUTING PROOF — real Chrome, the real module, the real model
 *           loaded from 1p-avatar-model/ over http, driven across nine
 *           synthetic sitters. It prints the per-fixture table and asserts the
 *           counts, the absences, and that a blank frame is still refused.
 *   PART 3  the fallback — with the model file blocked, the reader must fall
 *           back to the avfit pixel ladder, keep working, and SAY SO.
 *
 * ⛔ WHAT THIS SUITE DELIBERATELY DOES NOT DO. It does not assert a floor on
 * eyeSet, nose or lip-thinness. Driving this model over sitters drawn from
 * eyeSep 0.36 to 0.58 moved the measured spacing 1.450 -> 1.527 — the landmark
 * net regresses to its own prior — so those traits are NOT claimed by the
 * landmark path and pretending otherwise here would be the test teaching the
 * code to lie. They remain the pixel ladder's to claim.
 *
 * The fixtures are synthetic and drawn by tests/avml-synthetic-sitter.fixture.js
 * from canonical facial proportions. No real face, no PHI, nothing downloaded.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0;
function ok(v, m) { assert.ok(v, m); passed++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); passed++; }

/* ======================================================================== */
/* PART 1 — THE BUNDLE                                                       */
/* ======================================================================== */

const MODEL_DIR = '1p-avatar-model';
/* Every published byte, pinned. A digest that moves without this table moving
   is a third-party runtime nobody re-reviewed. */
const MODEL_FILES = [
  ['face-api-1.7.15.js', 1333943, '0160f7af3a8c78cece45c7ecc765383bad74becfd438bb787cdd627b2d6f2cf6'],
  ['face_landmark_68_model-weights_manifest.json', 8489, '4a5058cee2e126a313462085b3750a95d0421ac490b620f5514fc38cf9dae99f'],
  ['face_landmark_68_model.weights', 356840, '4611ef65c87d836d03d684b30eec4d195d8b219fa1dd58fc58945831c6b9299b'],
  ['tfjs-backend-wasm-simd.wasm', 424594, '77ebb28a6d34f371dbbf2086b7f2de8994acd8ea5a3cf1fa24d2c26c840cac7b'],
  ['tfjs-backend-wasm.wasm', 311123, '70a5d516060464e5269f01c74bac1772d6b8ab6cb612acf16b5cdaf61f78d892'],
  ['tiny_face_detector_model-weights_manifest.json', 3223, 'fa86dcb1b43a8939348598c3c988d14de658e1812118ff41d6846587cf09039b'],
  ['tiny_face_detector_model.weights', 193321, 'b7503ce7df31039b1c43316a9b865cab6a70dd748cc602d3fa28b551503c3871']
];
const MODEL_BUDGET_BYTES = 8 * 1024 * 1024;

const onDisk = fs.readdirSync(path.join(ROOT, MODEL_DIR)).sort();
const expectedOnDisk = MODEL_FILES.map((r) => r[0])
  .concat(['LICENSE-face-api.txt', 'LICENSE-tensorflow.txt', 'NOTICE.md']).sort();
assert.deepStrictEqual(onDisk, expectedOnDisk,
  'the model folder gained or lost a file. Every byte here is published and has to be reviewed on purpose.');
passed++;

let runtimeBytes = 0;
for (const [name, bytes, sha] of MODEL_FILES) {
  const buf = fs.readFileSync(path.join(ROOT, MODEL_DIR, name));
  eq(buf.length, bytes, `${name} changed size — re-pin it deliberately or restore the reviewed copy`);
  eq(crypto.createHash('sha256').update(buf).digest('hex'), sha,
    `${name} changed bytes without its digest moving — that is an unreviewed third-party runtime`);
  runtimeBytes += buf.length;
}
ok(runtimeBytes <= MODEL_BUDGET_BYTES,
  `the bundled model is ${runtimeBytes} bytes, over the ${MODEL_BUDGET_BYTES} budget`);
console.log(`  bundle: ${runtimeBytes} bytes (${(runtimeBytes / 1048576).toFixed(2)} MiB) of ${MODEL_BUDGET_BYTES}`);

/* THE .weights RENAME IS LOAD-BEARING, NOT COSMETIC. _config.yml fails closed on
   every .bin (the b948 deploy-failure rule), so a weight shard named .bin would
   commit, test green, and 404 in the browser because Pages never served it.
   Both halves are asserted: the exclusion still exists, and no shard is a .bin. */
const config = read('_config.yml');
ok(/^\s+- "\*\.\[Bb\]\[Ii\]\[Nn\]"$/m.test(config) && /^\s+- "\*\*\/\*\.\[Bb\]\[Ii\]\[Nn\]"$/m.test(config),
  'the .bin publication exclusion vanished — the .weights rename below is now unexplained');
for (const manifestName of ['tiny_face_detector_model-weights_manifest.json', 'face_landmark_68_model-weights_manifest.json']) {
  const manifest = JSON.parse(read(path.posix.join(MODEL_DIR, manifestName)));
  ok(Array.isArray(manifest) && manifest.length > 0, `${manifestName} is not a weights manifest`);
  for (const group of manifest) {
    for (const rel of group.paths || []) {
      ok(!/\.bin$/i.test(rel), `${manifestName} still points at a .bin shard, which GitHub Pages will not serve: ${rel}`);
      ok(fs.existsSync(path.join(ROOT, MODEL_DIR, rel)), `${manifestName} points at a missing shard: ${rel}`);
    }
  }
}

const notice = read(path.posix.join(MODEL_DIR, 'NOTICE.md'));
ok(/MIT/.test(notice) && /Apache-2\.0/.test(notice), 'NOTICE.md must name both licences the bundle redistributes under');
ok(/wasm-unsafe-eval/.test(notice), 'NOTICE.md must say why the CSP source expression is needed');
ok(read(path.posix.join(MODEL_DIR, 'LICENSE-face-api.txt')).indexOf('MIT License') === 0,
  'the face-api licence text is not the MIT licence');
ok(/Apache License/.test(read(path.posix.join(MODEL_DIR, 'LICENSE-tensorflow.txt'))),
  'the TensorFlow licence text is not the Apache licence');

/* ---- THE CSP EDIT, ON EXACTLY TWO FILES -------------------------------- */
function cspOf(rel) {
  const m = read(rel).match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(m, `${rel} has no shell CSP`);
  return m[1];
}
/* WHY /1p CARRIES IT AND PRODUCTION DOES NOT.
   Instantiating a WebAssembly module counts as script execution under CSP, so
   the bundled tfjs wasm backend cannot start without 'wasm-unsafe-eval' in
   script-src. Only /1p runs it: the avatar landmark reader is a /1p fork
   (1p-feat_mls_avatar.js), production's ScribeFlow.html loads no wasm at all,
   and /cloned is DERIVED from /1p but has not been promoted this feature. So
   the source expression is granted exactly where the capability is used and
   nowhere else — production keeps the strictly narrower policy it has always
   had, and this test is what stops the expression drifting into it. */
for (const twin of ['1pScribeFlow.html', '1p/index.html']) {
  const csp = cspOf(twin);
  ok(/script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'\s*;/.test(csp),
    `${twin} must carry 'wasm-unsafe-eval' in script-src or the bundled model cannot start`);
  ok(!/'unsafe-eval'(?!\s*;)/.test(csp.replace(/'wasm-unsafe-eval'/g, '')),
    `${twin} must not have gained plain 'unsafe-eval' — wasm only`);
  ok(/object-src 'none'/.test(csp) && /worker-src 'self' blob:/.test(csp),
    `${twin} lost an unrelated CSP directive while the wasm expression was added`);
}
for (const strict of ['ScribeFlow.html', 'ScribeFlow-staging.html', 'cloned/index.html']) {
  ok(!/wasm-unsafe-eval/.test(cspOf(strict)),
    `${strict} must NOT carry 'wasm-unsafe-eval' — it runs no wasm, and widening it here would widen production`);
}

/* ---- THE MODULE REFERENCES THE MODEL SAME-ORIGIN AND LAZILY ------------- */
const avatarSrc = read('1p-feat_mls_avatar.js');
ok(avatarSrc.indexOf("var FACE_LM_ASSET = '1p-avatar-model/face-api-1.7.15.js'") >= 0,
  'the module no longer names the bundled model by its relative same-origin path');
ok(!/1p-avatar-model[^'"\n]*(?:https?:)?\/\//.test(avatarSrc), 'the model must never be referenced through a remote host');
/* LAZY: the ONLY caller of faceLandmarkReady outside its own definition and the
   match flow is setupForm. If a boot path ever calls it, 2.5 MB starts
   downloading on every page load for every doctor who never opens Setup. */
const readyCalls = (avatarSrc.match(/faceLandmarkReady\(\)/g) || []).length;
eq(readyCalls, 3, 'faceLandmarkReady() call sites changed — it must be called from setupForm, from faceLandmarkEvidence, and returned from its own memo, and nowhere else');
ok(/host\.innerHTML = '';[\s\S]{0,900}?safe\(function \(\) \{ faceLandmarkReady\(\); \}\);/.test(avatarSrc),
  'the lazy load must be armed by setupForm, not at module boot');
/* THE GATE IS UNTOUCHED — the whole point of the lane. */
ok(avatarSrc.indexOf("examined >= 10 && claimed >= 6 && hasIdentityPalette") >= 0,
  'the avatar match gate was edited; it must stay examined>=10 && claimed>=6 && skin && hair');
ok(/lm\.claimed\.forEach\(function \(knob\) \{[\s\S]{0,500}?faceVisionClaimGate\(knob, v\)/.test(avatarSrc),
  'landmark claims must still pass faceVisionClaimGate value by value');
/* faceCombineEvidence builds a FRESH receipt, so the landmark provenance has to
   be carried across it on purpose or lastMatchReceipt cannot say which reader
   moved a trait. */
ok(/combinedEvidence: true,[\s\S]{0,700}?landmarkClaimed: Array\.isArray\(pxReceipt\.landmarkClaimed\)/.test(avatarSrc),
  'the landmark provenance is dropped by faceCombineEvidence');

console.log(`PART 1 ok — ${passed} assertions on the bundle, the digests and the CSP`);

/* ======================================================================== */
/* PART 2 + 3 — THE EXECUTING PROOF                                          */
/* ======================================================================== */

const FIXTURE_SRC = fs.readFileSync(path.join(__dirname, 'avml-synthetic-sitter.fixture.js'), 'utf8');
const MODULE_SRC = read('1p-feat_mls_avatar.js');

const MIME = { '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.weights': 'application/octet-stream', '.html': 'text/html; charset=utf-8', '.txt': 'text/plain' };

const HARNESS_HTML = '<!doctype html><meta charset="utf-8"><title>avml harness</title><div id="visitView"></div>';

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url).split('?')[0]);
    if (rel === '/__avml_harness') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(HARNESS_HTML);
    }
    const abs = path.join(ROOT, rel);
    if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(404); return res.end('no');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(fs.readFileSync(abs));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* The nine sitters. `truth` is what each was DRAWN with, so an assertion can
   compare a claim against the ground truth rather than against itself. */
const SITTERS = [
  { name: 'fair/dark-hair', spec: {}, truth: { glasses: false, beard: 'none', hairline: 'full' } },
  { name: 'deep skin', spec: { skin: '#8a5533', hair: '#1a1210' }, truth: { glasses: false, beard: 'none', hairline: 'full' } },
  { name: 'fair/blonde', spec: { skin: '#f2d3b4', hair: '#c9a227' }, truth: { glasses: false, beard: 'none', hairline: 'full' } },
  { name: 'long hair', spec: { longHair: true, hair: '#5b3a20' }, truth: { glasses: false, beard: 'none', hairline: 'full' } },
  { name: 'sitting back 1280x720', spec: { headFrac: 0.22, w: 1280, h: 720 }, truth: { glasses: false, beard: 'none' } },
  { name: 'glasses', spec: { glasses: true }, truth: { glasses: true, beard: 'none' } },
  { name: 'glasses + deep skin', spec: { glasses: true, skin: '#8a5533', hair: '#1a1210' }, truth: { glasses: true } },
  { name: 'full beard', spec: { beard: '#2a2018' }, truth: { glasses: false, beard: 'beard' } },
  { name: 'high hairline', spec: { foreheadFrac: 0.80 }, truth: { glasses: false, beard: 'none', hairline: 'receding' } },
  { name: 'high hairline/deep', spec: { foreheadFrac: 0.88, skin: '#8a5533', hair: '#1a1210' }, truth: { hairline: 'receding' } },
  { name: 'long narrow face', spec: { widthRatio: 0.56, jawRatio: 0.66 }, truth: { glasses: false, faceShape: 'long' } }
];

async function bootModule(page, port, opts) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  /* no external network, ever — the whole point of bundling the model */
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  if (opts && opts.blockModel) {
    await page.route('**/1p-avatar-model/face-api-1.7.15.js', (r) => r.abort());
  }
  await page.goto('http://127.0.0.1:' + port + '/__avml_harness');
  await page.evaluate(() => {
    window.toast = () => {}; window.getPatients = () => []; window.getActivePtId = () => '';
    window.__mlsSessionEpoch = 88;
    window.__mlsSessionAccount = 'avml-proof@example.test';
    window.bkToken = () => 'synthetic-avml-token';
    window.bkBase = () => 'http://127.0.0.1:1';
    window.requestIdleCallback = window.requestIdleCallback || ((f) => setTimeout(f, 0));
    window.__avatarConfig = { ok: true, config: { name: 'Ava', faceImage: '', faceMode: 'drawn', questions: [] } };
    window.fetch = (url, init) => {
      const u = String(url);
      /* the model's own weight/wasm fetches must reach the local server */
      if (u.indexOf('1p-avatar-model') >= 0 || u.indexOf('.wasm') >= 0 || u.indexOf('.weights') >= 0) {
        return window.__nativeFetch(url, init);
      }
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve(u.indexOf('/api/avatar/config') >= 0 ? window.__avatarConfig : { ok: true }) });
    };
  });
  await page.evaluate(() => { window.__nativeFetch = window.__nativeFetch || fetch.bind(window); });
  /* __nativeFetch must be captured BEFORE the override; re-do in the right order */
  await page.evaluate(FIXTURE_SRC);
  await page.evaluate((source) => {
    const s = document.createElement('script');
    s.setAttribute('data-mls-install-token', 'synthetic-avml-install');
    s.setAttribute('data-mls-asset', 'feat_mls_avatar.js');
    s.textContent = source;
    document.head.appendChild(s);
  }, MODULE_SRC);
  await page.waitForTimeout(250);
  return errors;
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    /* ---------- PART 2 : the model is present ---------------------------- */
    const page = await browser.newPage();
    /* capture the real fetch before anything replaces it */
    await page.addInitScript(() => { window.__nativeFetch = fetch.bind(window); });
    const errors = await bootModule(page, port, {});
    ok(await page.evaluate(() => !!(window.__mlsAvatar && window.__mlsAvatar.installed)),
      'the real preview avatar module did not install in Chrome');

    const rows = await page.evaluate(async (sitters) => {
      function square(src) {
        const side = Math.min(src.width, src.height), px = Math.max(64, Math.min(1024, side));
        const c = document.createElement('canvas'); c.width = px; c.height = px;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, px, px);
        return c;
      }
      const out = [];
      for (const s of sitters) {
        const raw = window.__avFace(Object.assign({ headFrac: 0.42 }, s.spec));
        const r = await new Promise((res) => {
          if (!window.__mlsAvatar.landmarkRead(square(raw), res)) res(null);
        });
        out.push({ name: s.name, truth: s.truth, r });
      }
      /* the two negative controls: a blank frame, and a textured wall */
      for (const neg of ['blank', 'wall']) {
        const c = document.createElement('canvas'); c.width = 640; c.height = 480;
        const g = c.getContext('2d');
        g.fillStyle = neg === 'wall' ? '#c8b49a' : '#d8d5cd'; g.fillRect(0, 0, 640, 480);
        if (neg === 'wall') { g.fillStyle = 'rgba(0,0,0,0.06)'; for (let i = 0; i < 12; i++) g.fillRect(0, i * 40, 640, 3); }
        const r = await new Promise((res) => { if (!window.__mlsAvatar.landmarkRead(square(c), res)) res(null); });
        out.push({ name: neg, truth: null, r });
      }
      return out;
    }, SITTERS);

    const status = await page.evaluate(() => window.__mlsAvatar.landmarkStatus());
    ok(status && status.ready === true,
      'the bundled model did not load in real Chrome over http: ' + JSON.stringify(status));
    console.log(`  model loaded in ${status.loadMs} ms from ${MODEL_DIR}/`);

    console.log('  fixture                    found  score  pixel  lmark  CLAIMED/EXAMINED  glasses  beard   hairline  shape');
    let strong = 0;
    for (const row of rows) {
      const r = row.r;
      if (!r) { console.log(`  ${row.name.padEnd(26)} (no result)`); continue; }
      const L = r.look || {};
      console.log('  ' + row.name.padEnd(26) +
        String(r.faceFound).padEnd(7) + String(Math.round(r.score*100)/100).padEnd(7) +
        String(r.pixelClaimed.length).padEnd(7) + String(r.landmarkClaimed.length).padEnd(7) +
        (r.claimed.length + '/' + r.examined).padEnd(18) +
        String(L.glasses === undefined ? '—' : L.glasses).padEnd(9) +
        String(L.beard === undefined ? '—' : L.beard).padEnd(8) +
        String(L.hairline === undefined ? '—' : L.hairline).padEnd(10) +
        String(L.faceShape === undefined ? '—' : L.faceShape).padEnd(7) + JSON.stringify(r.notes || {}));
      if (row.truth === null) continue;
      if (r.examined >= 10 && r.claimed.length >= 6) strong++;
    }

    /* ---- THE COUNT, THE OWNER'S ACTUAL COMPLAINT ------------------------ */
    ok(strong >= 3,
      `only ${strong} of ${SITTERS.length} sitters reached examined>=10 && claimed>=6 — the gate's own bar`);
    const faces = rows.filter((x) => x.truth !== null).map((x) => x.r);
    for (const r of faces) {
      eq(r.examined, 14, 'the ledger denominator moved off fourteen');
    }
    const best = Math.max.apply(null, faces.map((r) => r.claimed.length));
    ok(best >= 10,
      `no sitter reached ten of fourteen claimed (best was ${best}) — the owner's target is not met`);
    console.log(`  ${strong} of ${SITTERS.length} sitters clear the gate bar; best read ${best} of 14`);

    /* ---- THE ABSENCES ARE EVIDENCE, NOT ASSUMPTION ---------------------- */
    let absences = 0;
    for (const row of rows) {
      if (row.truth === null || !row.r) continue;
      const L = row.r.look || {};
      if (row.truth.glasses === false && L.glasses !== undefined) {
        eq(L.glasses, false, `${row.name}: claimed glasses on a sitter drawn without them`);
        absences++;
      }
      if (row.truth.glasses === true && L.glasses !== undefined) {
        eq(L.glasses, true, `${row.name}: claimed NO glasses on a sitter wearing them`);
      }
      if (row.truth.beard === 'none' && L.beard !== undefined) {
        eq(L.beard, 'none', `${row.name}: claimed facial hair on a clean-shaven sitter`);
        absences++;
      }
      if (row.truth.beard === 'beard' && L.beard !== undefined) {
        ok(L.beard === 'beard' || L.beard === 'stubble', `${row.name}: called a full beard "${L.beard}"`);
      }
      if (row.truth.hairline === 'full' && L.hairline !== undefined) {
        eq(L.hairline, 'full', `${row.name}: claimed a receding hairline on a full one`);
        absences++;
      }
      if (row.truth.hairline === 'receding' && L.hairline !== undefined) {
        eq(L.hairline, 'receding', `${row.name}: called a high hairline "full"`);
      }
      if (row.truth.faceShape && L.faceShape !== undefined) {
        eq(L.faceShape, row.truth.faceShape,
          `${row.name}: face shape read "${L.faceShape}" on a sitter drawn ${row.truth.faceShape}`);
      }
    }
    /* A CONSTANT IS NOT A MEASUREMENT. If every sitter came back the same shape
       and the same hairline, these two would be decorations rather than reads. */
    const shapes = new Set(faces.map((r) => r.look.faceShape).filter((v) => v !== undefined));
    ok(shapes.size >= 2, 'faceShape returned the same answer for every sitter, so it is not measuring anything: ' + [...shapes]);
    const hairlines = new Set(faces.map((r) => r.look.hairline).filter((v) => v !== undefined));
    ok(hairlines.size >= 2, 'hairline returned the same answer for every sitter: ' + [...hairlines]);
    /* AND THE DISPLACEMENT IS RECORDED, NOT SILENT. */
    ok(faces.some((r) => (r.displaced || []).length > 0),
      'no pixel claim was ever displaced by the landmark reader — the authority list is doing nothing, ' +
      'or the pixel ladder stopped producing the false beard this was measured against');
    ok(absences >= 6,
      `only ${absences} honest absences were claimed across the sitters — this lane exists to make absences claimable`);
    /* the glasses sitters must actually be CAUGHT, or "no glasses" is worthless */
    const glassRows = rows.filter((x) => x.truth && x.truth.glasses === true && x.r);
    ok(glassRows.length >= 2 && glassRows.every((x) => x.r.look.glasses === true),
      'a sitter wearing glasses was not detected as wearing them, so the absence claim carries no information');
    console.log(`  ${absences} absences claimed with evidence; both glasses sitters detected`);

    /* ---- THE RECEIPT IS PHI-FREE, STRUCTURALLY -------------------------- */
    /* Not "we were careful" — executed. A receipt may carry counts, knob names
       and scalar measurements. A data URL, a base64 blob or a landmark
       coordinate array would show up here as a long string or a nested array. */
    for (const r of faces) {
      for (const [key, value] of Object.entries(r.notes || {})) {
        ok(value === null || typeof value === 'number' || typeof value === 'boolean',
          `receipt note ${key} is a ${typeof value}; only scalars may ride in a receipt`);
      }
      for (const knob of r.landmarkClaimed) {
        ok(typeof knob === 'string' && knob.length < 20 && /^[a-zA-Z]+$/.test(knob),
          `receipt claim "${String(knob).slice(0, 40)}" is not a bare knob name`);
      }
      ok(!JSON.stringify(r.notes || {}).includes('data:'), 'a receipt note carried a data URL');
    }
    console.log('  receipts carry only counts, knob names and scalar measurements');

    /* ---- THE NEGATIVE CONTROLS ------------------------------------------ */
    const blank = rows.filter((x) => x.name === 'blank')[0].r;
    ok(blank, 'the blank frame produced no result object at all');
    eq(blank.faceFound, false, 'a blank frame was reported as a face');
    eq(blank.applies, false, 'the match gate accepted a blank frame');
    ok(blank.claimed.length < 6, `a blank frame claimed ${blank.claimed.length} appearance details`);
    const wall = rows.filter((x) => x.name === 'wall')[0].r;
    eq(wall.faceFound, false, 'a textured wall was accepted as a face by the landmark reader');
    eq(wall.applies, false, 'the match gate accepted a textured wall');
    console.log('  blank frame and textured wall both refused');

    eq(errors.length, 0, 'the module threw in Chrome: ' + errors.join(' | '));
    await page.close();

    /* ---------- PART 3 : the model is NOT available ---------------------- */
    const page2 = await browser.newPage();
    await page2.addInitScript(() => { window.__nativeFetch = fetch.bind(window); });
    const errors2 = await bootModule(page2, port, { blockModel: true });
    const fallback = await page2.evaluate(async () => {
      function square(src) {
        const side = Math.min(src.width, src.height), px = Math.max(64, Math.min(1024, side));
        const c = document.createElement('canvas'); c.width = px; c.height = px;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, px, px);
        return c;
      }
      const raw = window.__avFace({ headFrac: 0.42 });
      const r = await new Promise((res) => { if (!window.__mlsAvatar.landmarkRead(square(raw), res)) res(null); });
      return { r: r, status: window.__mlsAvatar.landmarkStatus() };
    });
    ok(fallback.r, 'with the model blocked the reader returned nothing at all instead of falling back');
    eq(fallback.r.modelReady, false, 'the model reported ready with its own file blocked');
    ok(String(fallback.r.modelWhy || '').length > 10,
      'the fallback must carry a plain-words reason, not an empty string');
    eq(fallback.r.faceFound, false, 'a landmark face was reported with the model blocked');
    eq(fallback.r.examined, 14, 'the fallback ledger stopped examining fourteen controls');
    eq(fallback.r.landmarkClaimed.length, 0, 'landmark claims appeared with the model blocked');
    ok(fallback.r.claimed.length === fallback.r.pixelClaimed.length,
      'the fallback did not return exactly the avfit pixel ladder\'s own claims');
    ok(fallback.r.claimed.length >= 1, 'the pixel ladder claimed nothing at all in the fallback');
    console.log(`  fallback: pixel ladder alone claimed ${fallback.r.claimed.length} of 14 — "${fallback.r.modelWhy}"`);
    eq(errors2.length, 0, 'the module threw in the fallback case: ' + errors2.join(' | '));
    await page2.close();

    console.log(`PASS 1p-avatar-landmark-evidence (${passed} assertions)`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
