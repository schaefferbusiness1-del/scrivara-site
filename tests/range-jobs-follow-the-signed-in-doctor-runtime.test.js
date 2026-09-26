'use strict';

/* h10-1.0.0 (2026-09-25): a saved Month/Year pull is never stranded, and the
 * signed-in doctor's controls act only on that doctor's own job.
 *
 *   JOBS-4  A Year pull stopped as 'account-changed' (another account signed
 *           in while its day was in flight) had no Resume anywhere and never
 *           auto-resumed, while its card said "Check Athena, then Resume".
 *   JOBS-5  After a sign-out/sign-in, the new doctor's Cancel was applied to
 *           the previous doctor's still-settling job (A cancelled, B untouched),
 *           and Resume answered "already running" with the previous doctor's
 *           job.
 *   JOBS-6  A pull scoped to a clinician picked from "Seen on the athena
 *           calendar" could never resume once the roster verified that same
 *           clinician: Resume refused as provider-unverified and the picker
 *           stayed locked to "Saved verified provider".
 *
 * Real Chrome, the real 1p-feat_mls_rangejobs.js and
 * 1p-feat_athena_provider_roster.js, a synthetic importer. Nothing leaves
 * 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

const COMMON = (account) => "window.__MLS_P1_PREVIEW={enabled:true,route:'/1pScribeFlow.html',build:'range-test'};window.__MLS_AV='range-test';" +
  "window.__acct='" + account + "';window.__mlsSessionAccount=window.__acct;window.__mlsSessionEpoch=1;window.session={email:window.__acct};" +
  "window.uns=function(s){return 'sf_u::'+(window.__acct||'_')+'::'+s;};localStorage.setItem('sf_bk_token','synthetic');" +
  "window.__mlsVisitNotesPref={read:function(){return {state:'off',on:false,settled:true};},ensureChosenForBulkPull:function(){return Promise.resolve({ok:true,on:false});},choicePending:function(){return false;}};" +
  "window.__boundary=function(prev,next){window.__acct=next;window.__mlsSessionAccount=next;window.session=next?{email:next}:null;" +
  "window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{previousAccount:prev,nextAccount:next}}));};" +
  "window.__read=function(a){var raw=localStorage.getItem('sf_u::'+a+'::p1RangeJobV1');var m=raw&&JSON.parse(raw);return m&&{kind:m.kind,target:m.target,status:m.status,reason:m.reason};};" +
  /* importer: three days land, then the fourth day stays in flight until the test releases it */
  "window.__pulls=[];window.__pending=null;window.__stopSettles=false;" +
  "window.__importer={pullMonth:function(o){window.__pulls.push({acct:window.__acct,month:o.month,provider:o.provider&&o.provider.stableKey});" +
  "var done=o.dates.slice(0,3).map(function(d){var r={date:d,ok:true,complete:true,reason:'complete'};o.onDayCheckpoint(r);return r;});" +
  "return new Promise(function(res){window.__pending=function(){window.__pending=null;res({ok:false,complete:false,reason:'month-partial',stoppedByUser:true,days:done});};});}," +
  "stopPull:function(){if(window.__stopSettles&&window.__pending)setTimeout(window.__pending,0);}," +
  "_resolveProviderRequest:function(raw){if(raw==='all'||raw==null)return {ok:true,provider:'all'};var e=window.__mlsProviderRoster&&window.__mlsProviderRoster.resolve(raw);" +
  "if(!e)return {ok:false,reason:'provider-unverified'};return {ok:true,provider:{id:e.id||'',stableKey:e.stableKey,raw:e.raw,name:e.name,rosterVerified:e.rosterVerified===true,detectedOnly:e.rosterVerified!==true}};}};" +
  "window.__mlsSI=window.__importer;window._calProviders=[];window._calAppts=[];";

const CARD = '<div class="ez3-card ez3-pull" id="card"><select id="ez3Prov"><option value="__all">Your athenaOne view (default)</option></select>' +
  '<button id="ez3PullStart">Start month pull</button></div>';
const PAGES = {
  '/switch.html': (q) => '<!doctype html><meta charset=utf-8><body>' + CARD + '<script>' + COMMON(q.get('account')) + '</script>' +
    '<script src="/1p-feat_mls_rangejobs.js"></script></body>',
  '/roster.html': () => '<!doctype html><meta charset=utf-8><body>' + CARD + '<script>' + COMMON('doctor-a@example.invalid') +
    "window.__mlsP1ProviderRosterLoader={installed:true,version:'p1-provider-roster-1.0.0',installToken:'tok'};</script>" +
    '<script src="/1p-feat_athena_provider_roster.js" data-mls-install-token="tok" data-mls-asset="feat_athena_provider_roster.js"></script>' +
    '<script src="/1p-feat_mls_rangejobs.js"></script></body>'
};
const A = 'doctor-a@example.invalid', B = 'doctor-b@example.invalid';

const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://127.0.0.1');
  if (PAGES[u.pathname]) { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(PAGES[u.pathname](u.searchParams)); }
  const f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': path.extname(f) === '.js' ? 'application/javascript' : 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  let checks = 0;
  const ok = (v, m) => { assert.ok(v, m); checks++; };
  const eq = (a, e, m) => { assert.strictEqual(a, e, m); checks++; };
  const open = async (url) => {
    const ctx = await browser.newContext();
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e.message)));
    await page.goto('http://127.0.0.1:' + srv.address().port + url, { waitUntil: 'load' });
    await page.waitForSelector('#mlsP1YearStart');
    return { ctx, page };
  };
  const card = (page) => page.evaluate(() => {
    const shown = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
    const st = window.__mlsP1RangeJobs.state();
    return { status: st && st.status, reason: st && st.reason, resume: shown('mlsP1YearResume'), cancel: shown('mlsP1YearCancel'),
      text: document.getElementById('mlsP1YearStatus').textContent };
  });
  const startYear = async (page) => {
    await page.selectOption('#mlsP1YearChoice', '2025');
    await page.click('#mlsP1YearStart');
    await page.waitForFunction(() => window.__pulls.length >= 1 && window.__pending);
  };
  try {
    /* ---- JOBS-4: an 'account-changed' job waits for its own account ---- */
    {
      const { ctx, page } = await open('/switch.html?account=' + A);
      await startYear(page);
      await page.evaluate(([a, b]) => { window.__boundary(a, ''); window.__boundary('', b); }, [A, B]);
      await page.evaluate(() => window.__pending());                          // A's in-flight day settles under B
      await page.waitForFunction((a) => { const m = window.__read(a); return m && m.status === 'account-changed'; }, A);
      /* hold the importer back so A's card can be read before the boot resume */
      await page.evaluate(() => { window.__mlsSI = { stopPull: function () {} }; });
      await page.evaluate(([a, b]) => { window.__boundary(b, ''); window.__boundary('', a); }, [A, B]);
      await page.waitForFunction(() => { const st = window.__mlsP1RangeJobs.state(); return st && st.status === 'account-changed' &&
        !document.getElementById('mlsP1YearResume').hidden; }, null, { timeout: 5000 }).catch(() => {});
      const held = await card(page);
      eq(held.status, 'account-changed', 'fixture: A did not come back to its account-changed job');
      ok(held.resume, 'the account-changed Year job offers no Resume: ' + JSON.stringify(held));
      ok(/stopped when another account signed in\. Resume continues it/.test(held.text), 'the card does not say why the pull stopped: ' + held.text);
      await page.evaluate(() => { window.__mlsSI = window.__importer; });   // the importer is ready again
      await page.waitForFunction(() => window.__pulls.length === 2, null, { timeout: 8000 }).catch(() => {});
      const pulls = await page.evaluate(() => window.__pulls);
      eq(pulls.length, 2, 'the account-changed Year job never resumed when its own account signed back in');
      eq(pulls[1].acct, A, 'the resumed pull ran under the wrong account');
      eq((await card(page)).status, 'running', 'the account-changed Year job is not running again');
      eq(await page.evaluate((b) => window.__read(b), B), null, 'the resumed job crossed into the other account');
      eq(page.errors.length, 0, 'page errors: ' + page.errors.join(' | '));
      await ctx.close();
    }

    /* ---- JOBS-5: the new doctor's controls act on the new doctor's job ---- */
    {
      const { ctx, page } = await open('/switch.html?account=' + B);
      await page.evaluate(async () => {
        window.__stopSettles = true;
        window.__mlsP1RangeJobs.startMonth('2025-03', { provider: 'all' });
        await new Promise((r) => setTimeout(r, 200));
        await window.__mlsP1RangeJobs.pause();
        await new Promise((r) => setTimeout(r, 300));
      });
      eq((await page.evaluate((b) => window.__read(b), B)).status, 'paused', 'fixture: B has no paused job');
      await page.evaluate(([a, b]) => { window.__boundary(b, ''); window.__boundary('', a); window.__stopSettles = false; }, [A, B]);
      await page.waitForTimeout(400);
      await startYear(page);                                                  // A's importer does not stop instantly
      await page.evaluate(([a, b]) => { window.__boundary(a, ''); window.__boundary('', b); }, [A, B]);
      await page.waitForTimeout(400);
      const resumed = await page.evaluate(() => window.__mlsP1RangeJobs.resume());
      eq(resumed.reason, 'pull-in-flight', 'B\'s Resume was not told another pull is still active');
      eq(resumed.state, null, 'B\'s Resume answered with the previous account\'s job');
      await page.click('#mlsP1YearResume');
      await page.waitForTimeout(300);
      eq((await page.evaluate((b) => window.__read(b), B)).status, 'paused', 'B\'s refused Resume changed B\'s job');
      eq(await page.evaluate(() => window.__pulls.length), 2, 'B\'s refused Resume started a pull');
      await page.click('#mlsP1YearCancel');
      await page.waitForFunction((b) => window.__read(b).status === 'cancelled', B, { timeout: 3000 }).catch(() => {});
      eq((await page.evaluate((b) => window.__read(b), B)).status, 'cancelled', 'B\'s Cancel did not cancel B\'s own job');
      const aAfter = await page.evaluate((a) => window.__read(a), A);
      ok(aAfter.status !== 'cancelled', 'B\'s Cancel cancelled the previous doctor\'s job');
      await page.evaluate(() => window.__pending && window.__pending());     // A's day finally settles
      await page.waitForTimeout(300);
      eq((await page.evaluate((a) => window.__read(a), A)).status, 'account-changed', 'the previous doctor\'s job lost its resume position');
      eq(page.errors.length, 0, 'page errors: ' + page.errors.join(' | '));
      await ctx.close();
    }

    /* ---- JOBS-6: a calendar-seen clinician's pull survives the verification ---- */
    for (const verify of [true, false]) {
      const { ctx, page } = await open('/roster.html');
      await page.evaluate(() => {
        const R = window.__mlsProviderRoster;
        R.beginOperation({ targetDate: '2026-09-24', requestId: 'req-1', providerMode: 'all' });
        R.ingestResp({ requestId: 'req-1', providerRoster: [{ name: 'Jane Smith' }], text: '' });
        window.dispatchEvent(new Event('mls:view-changed'));
      });
      await page.waitForFunction(() => [...document.querySelectorAll('#mlsP1YearProv option')].some((o) => o.textContent === 'Jane Smith'));
      const seenValue = await page.evaluate(() => [...document.querySelectorAll('#mlsP1YearProv option')].find((o) => o.textContent === 'Jane Smith').value);
      ok(/calendar-seen/.test(decodeURIComponent(seenValue)), 'fixture: Jane Smith is not the calendar-seen choice');
      await page.selectOption('#mlsP1YearProv', seenValue);
      await page.evaluate(() => { window.__stopSettles = true; });
      await startYear(page);
      await page.click('#mlsP1YearPause');
      await page.waitForFunction(() => window.__mlsP1RangeJobs.state().status === 'paused');
      if (verify) {
        await page.evaluate(() => { window._calProviders = [{ id: '42', name: 'Jane Smith', source: 'backend-calendar' }]; window.__mlsProviderRoster.list(); });
        eq(await page.evaluate(() => window.__mlsProviderRoster.seenOnCalendar().length), 0, 'fixture: the roster did not verify Jane Smith');
        eq(await page.evaluate(() => { const e = window.__mlsProviderRoster.resolve('calendar-seen:janesmith|'); return e && e.stableKey; }), 'backend:42',
          'the roster no longer answers the calendar-seen key once it verifies that clinician');
      }
      await page.evaluate(() => window.dispatchEvent(new Event('mls:view-changed')));
      await page.waitForTimeout(200);
      const locked = await page.evaluate(() => document.getElementById('mlsP1YearProvLock').textContent);
      ok(/locked to Jane Smith\./.test(locked), (verify ? 'verified' : 'control') + ': the paused pull is not shown locked to Jane Smith: ' + locked);
      await page.click('#mlsP1YearResume');
      await page.waitForFunction(() => window.__pulls.length === 2, null, { timeout: 4000 }).catch(() => {});
      const after = await card(page);
      eq(after.status, 'running', (verify ? 'verified' : 'control') + ': Resume refused a pull whose clinician the roster verified: ' + JSON.stringify(after));
      const pulls = await page.evaluate(() => window.__pulls);
      eq(pulls.length, 2, (verify ? 'verified' : 'control') + ': the resumed pull never reached the importer');
      eq(pulls[1].provider, verify ? 'backend:42' : 'calendar-seen:janesmith|', 'the resumed pull is not scoped to the same clinician');
      eq(page.errors.length, 0, 'page errors: ' + page.errors.join(' | '));
      await ctx.close();
    }
    console.log('PASS range jobs follow the signed-in doctor: an account-changed pull resumes for its own account, another account\'s controls never touch it, and a calendar-seen clinician\'s pull survives verification (' + checks + ' checks)');
  } catch (e) {
    console.error(e && e.stack || e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
  }
});
