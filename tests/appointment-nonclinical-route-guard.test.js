'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function sliceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  assert(start >= 0, `missing start marker: ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert(end > start, `missing end marker: ${endText}`);
  return source.slice(start, end);
}

const driverSource = sliceBetween(
  background,
  'async function mlsSearchOpenDriverFn(name, phase, requestGuard, appointmentId, requireAppointmentId)',
  '/* The exact appointment click is only a candidate'
).trim();

const deltaSource = sliceBetween(
  background,
  'function mlsNonclinicalAppointmentUrl(rawUrl)',
  'function bestFrameResult'
);
const deltaContext = { Map, Set, Array, String, Number, RegExp, Object, URL };
vm.runInNewContext(deltaSource, deltaContext, { filename: 'appointment-route-proof.js', timeout: 1000 });
const prove = deltaContext.mlsAppointmentNavigationDelta;

const syntheticId = 'apt_guard_1';
const schedule = 'https://athena.example/calendar/day/2026-08-25';
const management = `https://athena.example/schedule/apptworkflow.esp?ID=${syntheticId}`;
const reschedule = `https://athena.example/schedule/schedulingplatformcalendarview.esp?APPOINTMENTID=${syntheticId}&INITIALWORKFLOW`;
const encounter = `https://athena.example/ax/encounter/enc_synthetic/intake?APPOINTMENTID=${syntheticId}`;

assert.strictEqual(prove(syntheticId, [{ frameId: 1, url: schedule }], [{ frameId: 1, url: management }]).matched, false,
  'Change/Cancel management URL proved encounter navigation');
assert.strictEqual(prove(syntheticId, [{ frameId: 1, url: schedule }], [{ frameId: 1, url: reschedule }]).matched, false,
  'Reschedule URL proved encounter navigation');
assert.strictEqual(prove(syntheticId, [{ frameId: 1, url: schedule }], [{ frameId: 1, url: encounter }]).matched, true,
  'a changed clinical encounter URL carrying the exact appointment id was rejected');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    async function runRow(order) {
      return page.evaluate(async ({ source, order, syntheticId }) => {
        const links = {
          management: `<a href="/schedule/apptworkflow.esp?ID=${syntheticId}">August 25, 2026</a>`,
          reschedule: `<a href="/schedule/schedulingplatformcalendarview.esp?APPOINTMENTID=${syntheticId}&INITIALWORKFLOW">reschedule</a>`
        };
        document.body.innerHTML = `<table><tbody><tr data-appointment-id="${syntheticId}" style="height:40px"><td>Synthetic, Person</td><td>${order.map(key => links[key]).join(' ')}</td></tr></tbody></table>`;
        const events = [];
        for (const type of ['pointerdown', 'mousedown', 'click']) document.addEventListener(type, event => events.push({ type, tag: event.target.tagName }), true);
        const driver = (0, eval)(`(${source})`);
        const result = await driver('Synthetic, Person', 'open', { token: 'synthetic-guard', deadline: Date.now() + 5000 }, syntheticId, true);
        return { result, events };
      }, { source: driverSource, order, syntheticId });
    }

    for (const order of [['management', 'reschedule'], ['reschedule', 'management']]) {
      const observed = await runRow(order);
      assert.strictEqual(observed.result.opened, false, `nonclinical row opened in ${order.join('/')} order`);
      assert.strictEqual(observed.result.reason, 'appointment-target-not-clinical', `nonclinical row lacked explicit refusal in ${order.join('/')} order`);
      assert.deepStrictEqual(observed.events, [], `a pointer/click event escaped before refusal in ${order.join('/')} order`);
    }

    const benign = await page.evaluate(async ({ source, syntheticId }) => {
      document.body.innerHTML = `<div data-appointment-id="${syntheticId}" style="width:300px;height:50px"><div class="name" style="width:150px;height:25px">Synthetic, Person</div></div>`;
      let clicks = 0;
      document.addEventListener('click', () => { clicks += 1; }, true);
      const driver = (0, eval)(`(${source})`);
      const result = await driver('Synthetic, Person', 'open', { token: 'synthetic-benign', deadline: Date.now() + 5000 }, syntheticId, true);
      return { result, clicks };
    }, { source: driverSource, syntheticId });
    assert.strictEqual(benign.result.opened, true, 'safe href-less React appointment row was refused');
    assert.strictEqual(benign.result.diag.apptIdBound, true, 'safe React row lost exact appointment binding');
    assert(benign.clicks > 0, 'safe React row was not clicked');

    assert(driverSource.includes('if (rowNameMatches(t, true))') &&
      driverSource.includes('!rowNameMatches(rowText(row), idBound)') &&
      driverSource.includes('if (idBound !== true) return false;'),
      'exact row selection and final click must share the name echo gate; punctuation folding stays exact-ID-only');
    assert(background.includes("requireAppointmentId === true ? { el: null, sc: 0, scanned: 0 } : scanOnce()"),
      'exact appointment mode regained a name-only fallback');

    console.log('PASS appointment nonclinical route guard: management/reschedule rows receive zero clicks and cannot prove navigation; href-less exact React and clinical routes remain allowed');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
