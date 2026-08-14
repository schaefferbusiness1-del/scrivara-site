'use strict';

/*
 * /1p/ preview only — CAMERA ENDURANCE AND THE UPLOAD DOOR, IN REAL CHROME.
 *
 * Two of the 2026-08-13 repairs cannot be proven by reading source:
 *
 *  1. THE SHARED SCRATCH CANVAS. faceReadPortrait and frameQuality stopped
 *     allocating a canvas per call — the 8Hz live view was discarding three
 *     GPU-backed surfaces every 125ms, which is the mechanism behind "if u
 *     take too long to take the picutre it blacks out". Reuse is only correct
 *     if a canvas carrying the PREVIOUS frame cannot influence the next read.
 *     Node cannot answer that; a real 2D context can. This drives forty
 *     alternating reads of two different faces through the real module and
 *     requires every repeat to be byte-identical to its first answer — the one
 *     result shape that a leaking surface could not produce.
 *
 *  2. THE MODULE STILL INSTALLS AND THE SETUP FORM STILL BUILDS. This file has
 *     shipped a ReferenceError inside the capture path before (`later is not
 *     defined`, live from b982 until it was found by driving a real camera),
 *     and `node --check` cannot see an undefined identifier. So the Setup form
 *     is mounted for real here and the page is failed on ANY pageerror.
 *
 * Registered: it launches Chrome exactly like 1p-avatar-loader-runtime.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const assetSource = fs.readFileSync(path.join(root, '1p-feat_mls_avatar.js'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* A webcam-framed portrait: the head filling about half the frame, a brighter
   ceiling above it and shoulders below — the geometry the product actually
   receives, not a head-shaped crop. Two visibly different people, so a read
   that leaked from the previous frame would show up as the wrong palette. */
const FIXTURE = function (o) {
  const N = 320, c = document.createElement('canvas'); c.width = N; c.height = N;
  const x = c.getContext('2d');
  x.fillStyle = o.bg || '#eceae4'; x.fillRect(0, 0, N, N);
  if (o.ceiling) { x.fillStyle = o.ceiling; x.fillRect(0, 0, N, N * 0.22); }
  const rx = 0.29 * (o.scale || 1), ry = 0.33 * (o.scale || 1);
  const cy = 0.46 + (o.dy || 0);
  x.fillStyle = o.shirt || '#2f5d78';
  x.beginPath(); x.ellipse(N / 2, N * (cy + ry + 0.30), N * rx * 2.1, N * 0.26, 0, 0, 7); x.fill();
  x.fillStyle = o.skin;
  x.beginPath(); x.ellipse(N / 2, N * cy, N * rx, N * ry, 0, 0, 7); x.fill();
  x.fillRect(N * (0.5 - rx * 0.34), N * (cy + ry * 0.92), N * rx * 0.68, N * 0.20);
  x.fillStyle = o.hair;
  x.beginPath(); x.ellipse(N / 2, N * (cy - ry * 0.86), N * rx * 1.03, N * ry * 0.42, 0, 0, 7); x.fill();
  x.fillStyle = '#241a12';
  x.beginPath(); x.ellipse(N * (0.5 - rx * 0.42), N * (cy - ry * 0.16), N * 0.026, N * 0.022, 0, 0, 7); x.fill();
  x.beginPath(); x.ellipse(N * (0.5 + rx * 0.42), N * (cy - ry * 0.16), N * 0.026, N * 0.022, 0, 0, 7); x.fill();
  x.fillStyle = o.brow || '#2a1d12';
  x.fillRect(N * (0.5 - rx * 0.62), N * (cy - ry * 0.40), N * rx * 0.46, N * 0.018);
  x.fillRect(N * (0.5 + rx * 0.16), N * (cy - ry * 0.40), N * rx * 0.46, N * 0.018);
  if (o.beard) { x.fillStyle = o.beard; x.beginPath(); x.ellipse(N / 2, N * (cy + ry * 0.70), N * rx * 0.70, N * ry * 0.34, 0, 0, 7); x.fill(); }
  return c.toDataURL('image/jpeg', 0.95);
};

const PEOPLE = {
  A: { skin: '#f3d3b3', hair: '#241a12', beard: '#241a12', shirt: '#2f5d78', scale: 0.92, ceiling: '#ffffff' },
  B: { skin: '#8d5524', hair: '#c9c6c0', shirt: '#7a2f3a', scale: 0.86, bg: '#3a3f45' }
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  await page.setContent('<div id="visitView"></div>');

  await page.evaluate(() => {
    window.toast = () => {};
    window.getPatients = () => [];
    window.getActivePtId = () => '';
    window.__mlsSessionEpoch = 71;
    window.__mlsSessionAccount = 'avatar-endurance-proof@example.test';
    window.bkToken = () => 'synthetic-endurance-token';
    window.bkBase = () => 'http://127.0.0.1:1';
    window.requestIdleCallback = window.requestIdleCallback || (f => setTimeout(f, 0));
    /* the Setup form's only network dependency, answered locally: this proof
       is about the client, and a real call would leave the device */
    window.__avatarConfig = { ok: true, config: { name: 'Ava', faceImage: '', faceMode: 'drawn', questions: [] } };
    window.fetch = (url) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(String(url).indexOf('/api/avatar/config') >= 0
        ? window.__avatarConfig : { ok: true })
    });
  });
  await page.evaluate((source) => {
    const script = document.createElement('script');
    script.setAttribute('data-mls-install-token', 'synthetic-endurance-install');
    script.setAttribute('data-mls-asset', 'feat_mls_avatar.js');
    script.textContent = source;
    document.head.appendChild(script);
  }, assetSource);
  await page.waitForTimeout(300);

  ok(await page.evaluate(() => !!(window.__mlsAvatar && window.__mlsAvatar.installed)),
    'the real preview avatar module did not install in Chrome');

  /* ---- 1. FORTY READS THROUGH ONE REUSED SURFACE ----------------------- */
  const endurance = await page.evaluate(async ({ fixtureSrc, people, rounds }) => {
    const portrait = eval('(' + fixtureSrc + ')');
    const urls = { A: portrait(people.A), B: portrait(people.B) };
    const read = url => new Promise(resolve => {
      const accepted = window.__mlsAvatar.deriveLookFromPhoto(url, resolve);
      if (accepted === false) resolve('REFUSED');
    });
    const seen = { A: [], B: [] };
    for (let i = 0; i < rounds; i++) {
      const who = i % 2 === 0 ? 'A' : 'B';
      const res = await read(urls[who]);
      seen[who].push(JSON.stringify(res && { look: res.look, derived: res.derived, receipt: res.receipt }));
    }
    return { seen, first: { A: seen.A[0], B: seen.B[0] } };
  }, { fixtureSrc: FIXTURE.toString(), people: PEOPLE, rounds: 40 });

  ok(endurance.first.A && endurance.first.A !== 'null' && endurance.first.A !== '"REFUSED"',
    'the reused analysis canvas stopped the reader producing any result at all');
  ok(endurance.first.A !== endurance.first.B,
    'the two fixture people read identically, so this proof could not detect contamination');
  for (const who of ['A', 'B']) {
    const distinct = new Set(endurance.seen[who]);
    eq(distinct.size, 1,
      `read of person ${who} changed across 20 alternating reads — the shared scratch canvas leaks between frames`);
  }

  const firstA = JSON.parse(endurance.first.A);
  ok(firstA.receipt && Number(firstA.receipt.examined) >= 10,
    'the portrait reader no longer examines its full control ledger');
  ok((firstA.derived || []).indexOf('skin') >= 0,
    'the portrait reader no longer identifies skin on a clear webcam-framed face');

  /* ---- 2. THE SETUP FORM BUILDS, WITH THE NEW DOORS -------------------- */
  const form = await page.evaluate(async () => {
    window.__mlsAvatar.open();
    await new Promise(r => setTimeout(r, 400));
    const tabs = Array.prototype.slice.call(document.querySelectorAll('.mlsAvBack .mlsAvTab'));
    const setup = tabs.filter(b => /set ?up the avatar/i.test(String(b.textContent || '')))[0];
    if (setup) setup.click();
    await new Promise(r => setTimeout(r, 600));
    const text = n => String((n && n.textContent) || '');
    const buttons = Array.prototype.slice.call(document.querySelectorAll('.mlsAvBack button'));
    return {
      mounted: !!document.querySelector('[data-mls-avatar-setup-host]'),
      upload: !!document.getElementById('mlsAvFaceUpload'),
      uploadIsFile: (document.getElementById('mlsAvFaceUpload') || {}).type === 'file',
      uploadAccept: (document.getElementById('mlsAvFaceUpload') || {}).accept || '',
      uploadBtn: buttons.some(b => /upload a photo/i.test(text(b))),
      cameraBtn: buttons.some(b => /create from my camera/i.test(text(b))),
      matchBtn: buttons.some(b => /match my photo/i.test(text(b))),
      faceMode: !!document.getElementById('mlsAvFaceMode'),
      faceModeValue: (document.getElementById('mlsAvFaceMode') || {}).value || ''
    };
  });

  ok(form.mounted, 'the Setup form did not mount — the avatar setup host is absent');
  ok(form.cameraBtn, 'the camera button vanished from the face row');
  ok(form.matchBtn, 'the Match my photo button vanished from the face row');
  ok(form.uploadBtn, 'there is no Upload a photo button on the face row');
  ok(form.upload && form.uploadIsFile, 'the upload control is not a file input');
  ok(/image\/jpeg/.test(form.uploadAccept) && !/svg/i.test(form.uploadAccept),
    'the upload picker offers SVG or refuses JPEG');
  ok(form.faceMode, 'the Face style select is missing');

  /* The doctor picks Animated character; a match that refuses may not undo it.
     Driven through the real select and the real Match button, with no portrait
     saved — which is the refusal path. */
  const kept = await page.evaluate(async () => {
    const mode = document.getElementById('mlsAvFaceMode');
    mode.value = 'drawn';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const buttons = Array.prototype.slice.call(document.querySelectorAll('.mlsAvBack button'));
    const match = buttons.filter(b => /match my photo/i.test(String(b.textContent || '')))[0];
    match.click();
    await new Promise(r => setTimeout(r, 600));
    return { mode: mode.value, note: String((document.getElementById('mlsAvLookNote') || {}).textContent || '') };
  });
  eq(kept.mode, 'drawn', 'a refused match overwrote the doctor’s deliberate Animated character choice');

  eq(errors.length, 0, 'the page threw while building the Setup form and driving the face row: ' + errors.join(' | '));

  await browser.close();
  console.log('1p avatar camera endurance: ' + checks + ' checks passed (40 real reads, 0 page errors)');
})().catch(err => { console.error(err); process.exit(1); });
