/* 1p-pull-door-contract — the owner's final pull design (2026-08-19):
 * "have that button ask for a name and date of birth and we will pull that
 * patient in for you." The door must: exist under the whoever-is-open button,
 * validate in plain words, find-or-create through the real store path, refuse
 * a DOB conflict on an existing record, make the patient active, and invoke
 * the PROVEN pull (pullPatientChartViaAssist) — never its own pull plumbing.
 * Also pins the owner's wording fix: the button's explainer is ONE plain
 * sentence, not the old multi-line weld ("the confusing mess").
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const http = require('http');

const root = path.join(__dirname, '..');
let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ---------- statics ---------- */
function statics() {
  const shells = ['1pScribeFlow.html', path.join('1p', 'index.html')].map(f => fs.readFileSync(path.join(root, f), 'latin1'));
  for (const s of shells) {
    eq((s.match(/pulldoor-1\.0\.0 - type a name and DOB/g) || []).length, 1, 'block opens exactly once');
    eq((s.match(/end pulldoor-1\.0\.0/g) || []).length, 1, 'block closes exactly once');
    ok(s.indexOf('mlsPullDoorOpen') > 0 && s.indexOf('pdName') > 0 && s.indexOf('pdDob') > 0 && s.indexOf('pdGo') > 0, 'door controls present');
    ok(s.indexOf('pullPatientChartViaAssist(g, { name: nm, dob: dv })') > 0, 'the door hands {name, dob} to the PROVEN pull, no new plumbing and no store writes');
  }
  const a = shells[0], b = shells[1];
  const blk = (s) => s.slice(s.indexOf('pulldoor-1.0.0'), s.indexOf('end pulldoor-1.0.0'));
  ok(blk(a) === blk(b), 'block byte-identical in both twins');
  /* production untouched */
  for (const prod of ['ScribeFlow.html', 'mls-connect.js']) {
    eq(fs.readFileSync(path.join(root, prod), 'latin1').indexOf('pulldoor-1.0.0'), -1, `${prod} untouched`);
  }
}

/* ---------- runtime ---------- */
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      try { res.end(fs.readFileSync(p)); } catch (e) { res.statusCode = 404; res.end('nf'); }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForTimeout(4000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'pulldoor-harness@mlsscribe.test';
    });
    await page.evaluate(() => { const b = document.getElementById('nav_patients'); if (b) b.click(); });
    await page.waitForTimeout(1200);

    /* the door exists under the button, and mounts even on late render */
    const mounted = await page.evaluate(() => {
      if (window.__mlsPullDoor) window.__mlsPullDoor.mount();
      const host = document.getElementById('ptPullAthenaBtn');
      const door = document.getElementById('mlsPullDoor');
      return {
        version: window.__mlsPullDoor && window.__mlsPullDoor.version,
        doorAfterBtn: !!(host && door && host.nextSibling === door),
        openerText: String((document.getElementById('mlsPullDoorOpen') || {}).textContent || ''),
        titleNow: String((host || {}).title || '')
      };
    });
    eq(mounted.version, 'pulldoor-1.0.0', 'module installed');
    ok(mounted.doorAfterBtn, 'door mounts directly under the whoever-is-open button');
    ok(/type a name and date of birth/i.test(mounted.openerText), 'opener says what it does in plain words');
    /* t9pullbutton owns the title surface; the door must not re-weld it.
       The contract here: the old 268-char explainer never comes back. */
    ok(mounted.titleNow.length < 80, `the welded explainer stays gone (title is ${mounted.titleNow.length} chars)`);

    /* stub the proven pull; capture invocations AND the identity handoff —
       v2: the door never touches the store; pullPatientChartViaAssist gets
       {name, dob} and does find-or-create itself (t10write's measurement). */
    await page.evaluate(() => {
      window.__pdCalls = [];
      window.pullPatientChartViaAssist = async function (btn, opts) {
        window.__pdCalls.push({ btnId: btn && btn.id, opts: opts || null });
        return true;
      };
    });

    const press = (nm, dob) => page.evaluate(([n, d]) => {
      document.getElementById('mlsPullDoorOpen').click();
      document.getElementById('pdName').value = n;
      document.getElementById('pdDob').value = d;
      document.getElementById('pdGo').click();
      return new Promise(r => setTimeout(() => r({
        say: String((document.getElementById('pdSay') || {}).textContent || ''),
        calls: (window.__pdCalls || []).length,
        patients: (typeof getPatients === 'function') ? getPatients().filter(p => /doorcase/i.test(String(p.name || ''))).map(p => ({ name: p.name, dob: p.dob, id: String(p.id) })) : []
      }), 400));
    }, [nm, dob]);

    /* refusals in words */
    let r = await press('', '01/02/1960');
    ok(/name first/i.test(r.say), 'empty name refused in words');
    eq(r.calls, 0, 'no pull on refusal');
    r = await press('Doorcase Alpha', 'yesterday');
    ok(/mm\/dd\/yyyy/i.test(r.say), 'bad DOB refused in words');
    eq(r.calls, 0, 'no pull on bad DOB');

    /* the handoff: identity goes to the proven machinery, store untouched */
    r = await press('Doorcase Alpha', '01/02/1960');
    eq(r.calls, 1, 'the proven pull ran exactly once');
    eq(r.patients.length, 0, 'the door itself wrote NOTHING to the store (creation belongs to the machinery)');
    const handoff = await page.evaluate(() => (window.__pdCalls || [])[0]);
    eq(handoff.opts && handoff.opts.name, 'Doorcase Alpha', 'typed name handed to the pull');
    eq(handoff.opts && handoff.opts.dob, '01/02/1960', 'typed DOB handed to the pull');
    eq(handoff.btnId, 'pdGo', 'the pull anchors its status at the door button');

    /* re-press just pulls again — still no store writes from the door */
    r = await press('Doorcase Alpha', '01/02/1960');
    eq(r.patients.length, 0, 'still no store writes on re-press');
    eq(r.calls, 2, 'pull ran again');

    /* DOB conflict against an EXISTING record refuses before any pull */
    await page.evaluate(() => {
      const all = getPatients();
      all.push({ id: 'doorcase-x', name: 'Doorcase Alpha', dob: '01/02/1959', visits: [] });
      savePatients(all);
    });
    r = await press('Doorcase Alpha', '03/04/1961');
    ok(/different date of birth/i.test(r.say), 'DOB conflict refused in words');
    eq(r.calls, 2, 'no pull on conflict');

    /* ISO-stored DOB matches slash-typed (the r23 idread lesson) */
    await page.evaluate(() => {
      const all = getPatients();
      all.push({ id: 'doorcase-iso', name: 'Doorcase Iso', dob: '1962-03-04', visits: [] });
      savePatients(all);
    });
    r = await press('Doorcase Iso', '03/04/1962');
    eq(r.calls, 3, 'ISO-stored DOB matched the slash-typed DOB and pulled');
    ok(!/different date of birth/i.test(r.say), 'no false conflict across DOB formats');

    /* busy contract: the go button disables while the pull runs */
    await page.evaluate(() => {
      window.pullPatientChartViaAssist = function () { return new Promise(r2 => setTimeout(() => r2(true), 800)); };
    });
    const busy = await page.evaluate(() => {
      document.getElementById('pdName').value = 'Doorcase Busy';
      document.getElementById('pdDob').value = '01/02/1960';
      document.getElementById('pdGo').click();
      return new Promise(r3 => setTimeout(() => r3({
        disabled: document.getElementById('pdGo').disabled,
        label: document.getElementById('pdGo').textContent
      }), 200));
    });
    ok(busy.disabled, 'go button disabled while pulling');
    ok(/pulling/i.test(busy.label), 'go button says it is pulling');
    await page.waitForTimeout(900);
    const restored = await page.evaluate(() => ({ disabled: document.getElementById('pdGo').disabled, label: document.getElementById('pdGo').textContent }));
    ok(!restored.disabled && /pull this patient in/i.test(restored.label), 'go button restored after the pull');

    eq(errs.length, 0, `no page errors (got ${JSON.stringify(errs.slice(0, 3))})`);
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  statics();
  await runtime();
  console.log(`PASS 1p-pull-door-contract — ${checks} checks`);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
