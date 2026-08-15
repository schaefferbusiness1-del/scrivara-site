'use strict';
/* /1p-only visual proof.  No backend, PHI, camera, or patient data. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const P1 = path.join(ROOT, '1p-feat_mls_avatar.js');
const MAIN = path.join(ROOT, 'feat_mls_avatar.js');
const CONTACT = path.join(ROOT, 'tests', 'p1-avatar-professional-contact-sheet.png');

function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function gitSha(file) {
  const cp = require('child_process');
  return cp.execFileSync('git', ['show', 'HEAD:' + path.basename(file)], { cwd: ROOT });
}

(async () => {
  /* The production/main avatar must remain byte-identical to origin/main. */
  assert.strictEqual(sha(MAIN), crypto.createHash('sha256').update(gitSha(MAIN)).digest('hex'),
    'regular avatar file changed; p1 proof boundary failed');

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 980, height: 760 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message)));
  await page.setContent('<body style="margin:0;background:#eef2ef"><main id="gallery"></main></body>');
  await page.evaluate(() => {
    window.__mlsSessionAccount = 'synthetic-avatar-proof@example.test';
    window.__mlsSessionEpoch = 1;
    window.bkToken = () => 'synthetic-avatar-proof-token';
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, config: {} }) });
    window.toast = () => {};
    window.addEventListener = window.addEventListener || (() => {});
    window.requestIdleCallback = window.requestIdleCallback || (fn => setTimeout(fn, 0));
  });
  /* addScriptTag cannot set the p1 loader capability, so emulate the real
     loader's owned script node while still executing the exact file bytes. */
  await page.evaluate(src => {
    const script = document.createElement('script');
    script.setAttribute('data-mls-install-token', 'synthetic-avatar-proof-install');
    script.textContent = src;
    document.head.appendChild(script);
  }, fs.readFileSync(P1, 'utf8'));
  await page.waitForTimeout(120);
  const result = await page.evaluate(() => {
    const owner = window.__mlsAvatar;
    if (!owner || typeof owner.faceDemo !== 'function') return { owner: false };
    const root = document.getElementById('gallery');
    const looks = [
      { skin:'#7b4b35', hair:'#17110e', shirt:'#204034', lip:'#8d5046', eyes:'#3b2a22', faceShape:'square', hairStyle:'short', beard:'beard', glasses:true, age:'mature' },
      { skin:'#b97858', hair:'#35251f', shirt:'#315b6b', lip:'#9a5e54', eyes:'#2f4a3f', faceShape:'long', hairStyle:'long', beard:'none', glasses:false, age:'adult' },
      { skin:'#e0ad87', hair:'#a8a39c', shirt:'#5b4c72', lip:'#a2675d', eyes:'#3c4e70', faceShape:'oval', hairStyle:'bun', beard:'stubble', glasses:true, age:'mature' }
    ];
    const cards = looks.map((look, i) => {
      const card = document.createElement('section'); card.style.cssText = 'display:inline-grid;gap:8px;margin:14px;vertical-align:top;width:302px';
      const title = document.createElement('strong'); title.textContent = 'Synthetic professional look ' + (i + 1); title.style.cssText = 'font:600 14px system-ui;color:#204034';
      const stage = document.createElement('div'); stage.style.cssText = 'width:302px;height:302px;background:#fff;border-radius:20px;overflow:hidden';
      card.append(title, stage); root.appendChild(card);
      const ctl = owner.faceDemo(stage, look);
      ctl.mood('idle', false, false);
      return { stage, ctl };
    }).map(x => ({
      width: x.stage.getBoundingClientRect().width,
      height: x.stage.getBoundingClientRect().height,
      svg: !!x.stage.querySelector('svg'),
      ids: Array.from(x.stage.querySelectorAll('[id]')).map(n => n.id),
      mouth: x.stage.querySelector('.fMouth') && x.stage.querySelector('.fMouth').getAttribute('d'),
      blush: x.stage.querySelector('.fBlush') && x.stage.querySelector('.fBlush').style.opacity,
      dimple: x.stage.querySelector('.fDimpleL') && x.stage.querySelector('.fDimpleL').style.opacity,
      hooks: ['fHead','fHeadRig','fBody','fMouth','fPupilL','fLidL','fDimpleL'].every(k => !!x.stage.querySelector('.' + k))
    }));
    return { owner: true, cards: cards };
  });
  assert.ok(result.owner, 'p1 owner did not boot with synthetic credentials: ' + JSON.stringify(await page.evaluate(() => window.__mlsAvatar || null)));
  assert.ok(result.cards.every(x => x.svg && x.width === 302 && x.height === 302), '302px kiosk renders are not real SVG stages');
  assert.ok(result.cards.every(x => x.hooks && x.ids.length === new Set(x.ids).size), 'animation hooks or SVG id isolation regressed');
  assert.ok(result.cards.every(x => Number(x.blush) <= 0.07), 'idle blush remains too strong for adult art direction');
  assert.ok(result.cards.every(x => x.dimple === '0'), 'idle dimple remains visible');
  await page.screenshot({ path: CONTACT, fullPage: true });
  assert.strictEqual(errors.length, 0, 'p1 visual proof raised page errors: ' + errors.join('; '));
  await browser.close();
  console.log('PASS p1 avatar professional likeness proof: main boundary hash, three synthetic looks, 302px kiosk geometry, hooks, isolation, and contact sheet');
  console.log(CONTACT);
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
