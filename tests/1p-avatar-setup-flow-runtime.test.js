'use strict';

/*
 * THE OWNER'S SCREEN, DRIVEN END TO END IN REAL CHROME (/1p only, synthetic).
 *
 * Owner, 2026-08-17, holding the avatar Set up screen — mode select reading
 * "My photo — closest likeness, moves gently while speaking (recommended)",
 * result text reading "No animated traits changed · 5 of 14 details were
 * readable; the match was incomplete, so all character settings stayed
 * unchanged":
 *
 *   "for the avatar this is unacceptable and always happens. And also when you
 *    take a picture it goes to 'My photo' — that's not ok, it should stay on
 *    avatar. And also once you're done, these things don't stop — just keep
 *    doing everything else."
 *
 * Source-level pins live in 1p-avatar-capture-fit.test.js. This file exists
 * because three of those four complaints are about what the DOM does after the
 * match resolves, and no source read can stand in for that: it boots the real
 * module, opens the real Setup form, hands it a portrait that really does read
 * five of fourteen (mid-brown skin at ordinary webcam framing — the case
 * 1p-avatar-capture-readability-proof measures at exactly 5), clicks the real
 * Match button, and then reads the screen he was looking at.
 *
 *   1. THE FIVE ARE APPLIED, and the controls carrying them say so.
 *   2. IT IS NOT CALLED A MATCH, and the nine that failed are named as
 *      defaults rather than as "unchanged".
 *   3. THE FACE STYLE DOES NOT MOVE. This is the untouched-select case — the
 *      ordinary one, and the one that used to flip to 'photo'.
 *   4. IT KEEPS GOING: the form publishes its state and its next control, marks
 *      that control for the glow lane, and fires mls:avatar-step.
 *
 * ⛔ The whole-read gate is not exercised into passing here and must not be:
 * a five-control read is a REFUSAL of the match, and everything below is what
 * an honest refusal is allowed to do.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = process.env.MLS_AVATAR_DIR || path.resolve(__dirname, '..');
const assetSource = fs.readFileSync(path.join(root, '1p-feat_mls_avatar.js'), 'utf8');
let passed = 0;
function ok(value, message) { assert.ok(value, message); passed++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); passed++; }

/* The portrait: a room, a person and a laptop lid, centre-square-cropped the
   way captureSquare crops. A head-only framing at 22% of frame height, with no
   top in shot — measured at exactly FIVE of fourteen (skin, hair style, hair
   colour, lip shape, eye spacing), which is the owner's number and lands
   between the whole-read bar of six and the partial floor of two.
   ⛔ NOT the mid-brown fixture, and the reason is worth keeping: measured, its
   #c68541 skin passes the pixel reader and is then refused by faceHexSkinGate's
   C* < 32 ceiling, so the combined evidence carries no skin and partial
   application correctly refuses. That ceiling is a KNOWN, separately-flagged
   narrowness (the file's own comment names #c68642 and #8d5524) and widening it
   is not this lane's decision — but a proof that silently rode it would have
   been measuring that refusal instead of this application. */
const PORTRAIT = function () {
  window.__flowPortrait = function () {
    const W = 1280, H = 720;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const skin = '#f0c8a0', hair = '#3a2a1c', lip = '#a95f47';
    x.fillStyle = '#d8d5cd'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#e9e7e1'; x.fillRect(0, 0, W, H * 0.16);
    const ry = (H * 0.22) / 2, rx = ry * 0.72, cx = W / 2, cy = H * 0.44;
    x.fillStyle = skin;
    x.fillRect(cx - rx * 0.34, cy + ry * 0.80, rx * 0.68, ry * 0.85);
    x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(cx - rx, cy + ry * 0.05, rx * 0.13, ry * 0.16, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(cx + rx, cy + ry * 0.05, rx * 0.13, ry * 0.16, 0, 0, 7); x.fill();
    x.fillStyle = hair;
    x.beginPath(); x.ellipse(cx, cy - ry * 0.66, rx * 1.03, ry * 0.42, 0, 0, 7); x.fill();
    x.fillRect(cx - rx * 0.62, cy - ry * 0.26, rx * 0.34, ry * 0.065);
    x.fillRect(cx + rx * 0.28, cy - ry * 0.26, rx * 0.34, ry * 0.065);
    const eyeDx = rx * 0.44, eyeY = cy - ry * 0.10;
    [-1, 1].forEach(function (s) {
      x.fillStyle = 'rgb(250,248,245)';
      x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, rx * 0.20, ry * 0.085, 0, 0, 7); x.fill();
      x.fillStyle = '#4a3423';
      x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, rx * 0.095, ry * 0.080, 0, 0, 7); x.fill();
      x.fillStyle = 'rgb(20,16,14)';
      x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, rx * 0.045, ry * 0.040, 0, 0, 7); x.fill();
    });
    x.fillStyle = 'rgba(0,0,0,0.20)';
    x.beginPath(); x.ellipse(cx - rx * 0.10, cy + ry * 0.30, rx * 0.055, ry * 0.035, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(cx + rx * 0.10, cy + ry * 0.30, rx * 0.055, ry * 0.035, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(0,0,0,0.10)';
    x.fillRect(cx + rx * 0.03, cy - ry * 0.02, rx * 0.09, ry * 0.32);
    x.fillStyle = lip;
    x.beginPath(); x.ellipse(cx, cy + ry * 0.53, rx * 0.30, ry * 0.065, 0, 0, 7); x.fill();
    /* captureSquare's rule: centre square, never upscaled, MEASURE_MAX 1024 */
    const side = Math.min(W, H), px2 = Math.min(1024, side);
    const s = document.createElement('canvas'); s.width = px2; s.height = px2;
    const sx = s.getContext('2d');
    sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
    sx.drawImage(c, (W - side) / 2, (H - side) / 2, side, side, 0, 0, px2, px2);
    return s.toDataURL('image/jpeg', 0.95);
  };
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  await page.setContent('<div id="visitView"></div>');
  await page.evaluate(() => {
    window.toast = () => {}; window.getPatients = () => []; window.getActivePtId = () => '';
    window.__mlsSessionEpoch = 71;
    window.__mlsSessionAccount = 'avatar-flow-proof@example.test';
    window.bkToken = () => 'synthetic-flow-token';
    window.bkBase = () => 'http://127.0.0.1:1';
    window.requestIdleCallback = window.requestIdleCallback || (f => setTimeout(f, 0));
    window.__avatarConfig = { ok: true, config: { name: 'Ava', faceImage: '', faceMode: 'drawn', questions: [] } };
    /* the only network dependency, answered locally. The vision route answers
       ok with no claims, which is the ordinary offline/unsure case. */
    window.fetch = (url) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(String(url).indexOf('/api/avatar/config') >= 0
        ? window.__avatarConfig : { ok: true })
    });
    window.__avatarSteps = [];
    window.addEventListener('mls:avatar-step', e => window.__avatarSteps.push(e.detail), false);
  });
  await page.evaluate(PORTRAIT);
  await page.evaluate((source) => {
    const script = document.createElement('script');
    script.setAttribute('data-mls-install-token', 'synthetic-flow-install');
    script.setAttribute('data-mls-asset', 'feat_mls_avatar.js');
    script.textContent = source;
    document.head.appendChild(script);
  }, assetSource);
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!(window.__mlsAvatar && window.__mlsAvatar.installed)),
    'the real preview avatar module did not install in Chrome');

  /* the portrait really does read five of fourteen; if it stops doing so, every
     assertion below is measuring a different case and must fail loudly */
  const pixelRead = await page.evaluate(async () => {
    const url = window.__flowPortrait();
    window.__flowUrl = url;
    const res = await new Promise(r => window.__mlsAvatar.deriveLookFromPhoto(url, r));
    return { claimed: (res && res.derived || []).length, derived: (res && res.derived || []).slice(),
      skin: res && res.look && res.look.skin };
  });
  eq(pixelRead.claimed, 5,
    'the fixture no longer reads five of fourteen (' + pixelRead.derived.join(', ') +
    '), so this file is no longer measuring the owner\'s case');
  ok(pixelRead.derived.indexOf('skin') >= 0, 'the fixture lost its skin claim, so partial application would refuse');

  /* ---- OPEN THE REAL SETUP FORM WITH THAT PORTRAIT SAVED ---------------- */
  const before = await page.evaluate(async () => {
    window.__avatarConfig = { ok: true, config: { name: 'Ava', faceImage: window.__flowUrl,
      faceMode: 'drawn', faceLook: {}, questions: [] } };
    window.__mlsAvatar.open();
    await new Promise(r => setTimeout(r, 400));
    const tabs = Array.prototype.slice.call(document.querySelectorAll('.mlsAvBack .mlsAvTab'));
    const setup = tabs.filter(b => /set ?up the avatar/i.test(String(b.textContent || '')))[0];
    if (setup) setup.click();
    await new Promise(r => setTimeout(r, 700));
    const mode = document.getElementById('mlsAvFaceMode');
    return {
      mounted: !!document.querySelector('[data-mls-avatar-setup-host]'),
      mode: mode && mode.value,
      firstOption: mode && mode.options[0] && mode.options[0].value,
      firstOptionText: mode && mode.options[0] && String(mode.options[0].textContent || ''),
      skin: (document.getElementById('mlsAvLook_skin') || {}).value,
      nose: (document.getElementById('mlsAvLook_nose') || {}).value,
      matchBtn: !!document.getElementById('mlsAvMatchBtn'),
      addQ: !!document.getElementById('mlsAvAddQuestion'),
      save: !!document.getElementById('mlsAvSaveBtn')
    };
  });
  ok(before.mounted, 'the Setup form did not mount');
  eq(before.mode, 'drawn', 'Setup opened on My photo despite a saved drawn choice');
  eq(before.firstOption, 'drawn', 'the Face style list still offers My photo first');
  ok(/recommended/.test(before.firstOptionText),
    'the recommendation is not on the animated character the product defaults to');
  ok(before.matchBtn && before.addQ && before.save,
    'the three controls the step machine addresses are not all present with their ids');

  /* ---- CLICK MATCH, THEN READ THE SCREEN HE WAS LOOKING AT -------------- */
  const after = await page.evaluate(async () => {
    document.getElementById('mlsAvMatchBtn').click();
    await new Promise(r => setTimeout(r, 1600));
    const mode = document.getElementById('mlsAvFaceMode');
    const form = document.querySelector('.mlsAvForm');
    const ledger = document.getElementById('mlsAvMatchLedger');
    /* lookRow builds `div > span(label) > span(badge)` then the control, so the
       badge is the label span's own child span */
    const badgeFor = key => {
      const input = document.getElementById('mlsAvLook_' + key);
      const row = input && input.parentNode;
      const span = row && row.querySelector('span > span');
      return span ? String(span.textContent || '') : '';
    };
    return {
      mode: mode && mode.value,
      note: String((document.getElementById('mlsAvLookNote') || {}).textContent || ''),
      skin: (document.getElementById('mlsAvLook_skin') || {}).value,
      hair: (document.getElementById('mlsAvLook_hair') || {}).value,
      nose: (document.getElementById('mlsAvLook_nose') || {}).value,
      skinBadge: badgeFor('skin'),
      noseBadge: badgeFor('nose'),
      state: form && form.getAttribute('data-mls-avatar-state'),
      next: form && form.getAttribute('data-mls-avatar-next'),
      marked: Array.prototype.slice.call(document.querySelectorAll('[data-mls-next-step]')).map(n => n.id),
      ledgerRows: ledger ? ledger.querySelectorAll('div').length : 0,
      ledgerText: ledger ? String(ledger.textContent || '') : '',
      retake: !!document.getElementById('mlsAvRetakePhoto'),
      steps: (window.__avatarSteps || []).map(s => s.state),
      receipt: window.__mlsAvatar.lastMatchReceipt || null
    };
  });

  /* 1. THE FIVE ARE APPLIED, AND THE CONTROLS SAY SO. */
  eq(after.skin.toLowerCase(), String(pixelRead.skin || '').toLowerCase(),
    'the skin tone the reader measured did not reach the character — the owner\'s "all character settings stayed unchanged"');
  ok(after.skin.toLowerCase() !== String(before.skin || '').toLowerCase(),
    'the skin control did not move at all, so nothing was applied');
  ok(/from your photo/.test(after.skinBadge),
    'an applied control is not labelled with where its value came from: "' + after.skinBadge + '"');
  eq(after.nose, before.nose, 'an UNREAD control was changed by the partial application');
  ok(/left at the default/.test(after.noseBadge),
    'an unread control still says merely "unchanged": "' + after.noseBadge + '"');
  ok(after.receipt && (after.receipt.partialApplied || []).length === 5,
    'the receipt does not report the five traits that were applied');

  /* 2. IT IS NOT CALLED A MATCH. */
  ok(/Applied 5 of 14/.test(after.note), 'the result does not say how much was applied: "' + after.note + '"');
  ok(/skin tone/.test(after.note), 'the result does not NAME the traits it applied');
  ok(/9 could not be read/.test(after.note), 'the result does not say how much could not be read');
  /* avfit-1.2.0 — AND WHICH OF THE NINE ARE NOT A FAILURE AT ALL. Five of the
     fourteen are only ever confirmed when the feature is visible (face shape is
     never claimed; facial hair, glasses, hairline and brow colour only when
     present), so reporting nine flat failures overstated the damage by five. */
  ok(/only ever confirmed when the feature is visible/.test(after.note),
    'the result still counts the never-volunteered controls as failures: ' + after.note);
  ['face shape', 'facial hair', 'glasses', 'hairline', 'brow colour'].forEach(name =>
    ok(after.note.indexOf(name) >= 0, 'the result does not name ' + name + ' among the only-if-visible controls'));
  ok(/only set by hand unless it is visible/.test(after.ledgerText),
    'the ledger lumps "never volunteered" in with "not readable"');
  ok(/not readable, retake/.test(after.ledgerText),
    'the ledger no longer tells the doctor which controls a retake would actually fix');
  ok(/retake in better light/.test(after.note), 'the result does not tell the doctor what to do');
  ok(/not a match/.test(after.note), 'a partial application is presented without saying it is not a match');
  ok(!/all character settings stayed unchanged/.test(after.note),
    'the owner\'s exact sentence is still on screen');
  eq(after.receipt && after.receipt.wholeReadRefusal, true,
    'a five-control read is recorded as a completed match');
  ok(after.retake, 'there is no one-tap Retake beside the result');
  ok(after.ledgerRows >= 14, 'the result ledger does not name all fourteen controls');
  ok(/skin tone/.test(after.ledgerText) && /face shape/.test(after.ledgerText),
    'the result ledger is missing controls');

  /* 3. THE FACE STYLE DOES NOT MOVE — the untouched-select case. */
  eq(after.mode, 'drawn',
    'taking a photo and matching it moved the patient-facing face to My photo, which is exactly what the owner reported');

  /* 4. IT KEEPS GOING. */
  eq(after.state, 'matched-partial', 'the form does not publish the state it ended in');
  eq(after.next, 'mlsAvAddQuestion',
    'with no questions saved the flow does not send the doctor to Add question');
  eq(after.marked.join(','), 'mlsAvAddQuestion',
    'the next control is not the only thing marked for the glow lane: ' + after.marked.join(','));
  ok(after.steps.indexOf('matching') >= 0 && after.steps.indexOf('matched-partial') >= 0,
    'the step events do not describe the match running and finishing: ' + after.steps.join(' -> '));

  eq(errors.length, 0, 'the page threw while driving the Setup form: ' + errors.join(' | '));
  await browser.close();
  console.log('PASS 1p avatar setup flow: ' + passed + ' assertions — five of fourteen applied and labelled, ' +
    'not called a match, Face style unmoved, and the flow moves on');
})().catch(err => { console.error(err && err.stack || String(err)); process.exit(1); });
