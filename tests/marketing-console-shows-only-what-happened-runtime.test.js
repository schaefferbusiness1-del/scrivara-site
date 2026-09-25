'use strict';
/* THE MARKETING CONSOLE SHOWS ONLY WHAT HAPPENED (h9-1.0.0, 2026-09-25;
   hunt9 MC-03, MC-04, MC-07 to MC-10, MC-12 to MC-16).

   Measured at f57f2aaf, in both console pages (mls-marketing-console.html and
   its twin mls-marketing.html) and on the patient's review page:
   - MC-09  "Approve & publish" read "✓ Approved & saved locally" and disabled
            itself on a 401, a 500 and a dropped connection. Nothing was saved.
   - MC-15  "Skip" only dimmed the card; the reply came back on reload.
   - MC-10  "Draft replies" went through /api/widget/ai (Premium-only), ignored
            every refusal and said "Drafted 3" over three empty boxes.
   - MC-08  approving promised publishing that nothing performs.
   - MC-07  the automation table said MLS "sends automatically"; cadence and
            "Enable sending" controls fed nothing.
   - MC-14  the review links were posted fire-and-forget while the note said
            "Saved.", and a link typed without https:// was silently lost.
   - MC-04  private feedback had no reader anywhere; a failed patient submit
            read "Saved — thank you."
   - MC-12  with the Premium plan lapsed, the live campaign and its Pause
            button were hidden; Disconnect said "Not connected." whatever the
            server answered.
   - MC-13  a cancelled checkout said nothing.
   - MC-03  a seat was offered billing it may not manage.
   - MC-16  review-link inputs (and the 1p workspace's "Clear drafts") ran off a
            390 px screen.
   h9-1.1.0 (round 2):
   - R2-2   with a live campaign and a stored Google token MLS can no longer
            use, Pause failed, Disconnect was refused, and Connect was hidden
            while connected: no way out from MLS. Reconnect is now offered while
            connected, and a failed Pause says to use it.
   - R2-5a  the header still said "every action doctor-approved before it
            publishes" and the footer "auto-posts on your behalf without your
            opt-in": MLS posts nothing for the doctor.
   - R2-0   the patient's review page named nobody when the request carried a
            practice but no clinician.
   Real Chrome; the API is stubbed with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PAGES = ['mls-marketing-console.html', 'mls-marketing.html'];
const VP = { desktop: { viewport: { width: 1280, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } };
const SCAN = { payload: { reviews: [
  { source: 'google', rating: 5, scope: 'doctor', text: 'Great office, kind staff.' },
  { source: 'google', rating: 4, scope: 'practice', text: 'Short wait, clear answers.' },
  { source: 'healthgrades', rating: 2, scope: 'unknown', text: 'Billing was confusing.' },
] } };

function base() {
  return {
    'GET /api/marketing/status': [200, { ok: true, billingConfigured: true, status: 'active', plan: 'marketing_premium', active: true,
      billingOwner: true, canManageBilling: true, tiers: [], entitlements: { listing: true, replies: true, campaigns: true, autoreview: true, ads: true },
      settings: { reviewConsent: true, reviewLinks: {} } }],
    'GET /api/marketing/replies': [200, { ok: true, replies: [{ id: 7, source: 'google', rating: 5, scope: 'doctor', review: 'Great office, kind staff.', draft: 'Thank you so much!', status: 'draft' }] }],
    'GET /api/reviews/requests/stats': [200, { ok: true, stats: { total: 1, sent: 1, opened: 0, posted: 0, conversionRate: 0 } }],
    'GET /api/reviews/requests': [200, { ok: true, requests: [] }],
    'GET /api/marketing/campaigns': [200, { ok: true, campaign: { message: 'Thanks for visiting.' } }],
    'GET /api/marketing/ads/status': [200, { ok: true, configured: true, entitled: true, connected: false, customerId: null }],
    'GET /api/marketing/connect/status': [200, { ok: true, connected: false, ready: false }],
  };
}

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  if (p === '/__host.html') {
    r.writeHead(200, { 'content-type': 'text/html' });
    return r.end('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body><div id=app>app</div>' +
      "<script>window.__MLS_P1_PREVIEW={enabled:true};window.__mlsP1MarketingLoader={installed:true,version:'mkt-p1-1.0.0',installToken:'T1'};" +
      "window.__mlsP1MarketingIdentity=function(){return {resolved:true,email:'alice@example.test',role:'head',epoch:1};};" +
      "window.getPracticeName=function(){return 'Chester County Spine & Pain Management Associates';};window.getProviderName=function(){return 'Dr. Alice Head';};" +
      "window.getClinicAddress=function(){return '1234 West Chester Pike, Suite 200, West Chester, PA 19382';};window.mlsConfirm=function(){return Promise.resolve(true);};</script>" +
      '<script src="/1p-feat_mls_marketing.js" data-mls-install-token="T1"></script></body>');
  }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  let checks = 0;
  const ok = (v, m) => { assert.ok(v, m); checks++; };
  const eq = (a, e, m) => { assert.strictEqual(a, e, m); checks++; };
  /* routes: { 'METHOD /path': [status, body] | 'abort' | fn(bodyJson) -> same }; calls: every API request made */
  const open = async (page, routes, o) => {
    o = o || {};
    const ctx = await b.newContext(VP[o.vp || 'desktop']);
    await ctx.addInitScript((a) => {
      try { if (a.token) sessionStorage.setItem('sf_bk_token', a.token); localStorage.setItem('mlsRFScrapeCache2', JSON.stringify(a.scan)); } catch (e) {}
    }, { token: o.signedOut ? '' : 'tok', scan: SCAN });
    const pg = await ctx.newPage();
    pg.calls = [];
    pg.on('pageerror', (e) => errs.push(page + ': ' + String(e.message).slice(0, 160)));
    const table = Object.assign(base(), routes || {});
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const req = route.request(), u = new URL(req.url());
      if (u.hostname !== 'scrivara-backend.onrender.com') return route.abort();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const key = req.method() + ' ' + u.pathname;
      let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) {}
      pg.calls.push({ key, body });
      let h = table[key];
      if (typeof h === 'function') h = h(body);
      if (h === 'abort') return route.abort('connectionreset');
      if (!h) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"ok":false,"error":"not_found"}' });
      return route.fulfill({ status: h[0], headers: cors, contentType: 'application/json', body: JSON.stringify(h[1]) });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/' + page + (o.search || ''), { waitUntil: 'load' });
    await pg.waitForTimeout(400);
    return pg;
  };
  const text = (pg, sel) => pg.$eval(sel, (el) => el.innerText || el.textContent || '');
  try {
    for (const PAGE of PAGES) {
      /* MC-09: a failed approval is never shown as one */
      for (const [label, reply] of [['401', [401, { error: 'Not authenticated' }]], ['500', [500, { error: 'boom' }]], ['network', 'abort']]) {
        const pg = await open(PAGE, { 'POST /api/marketing/replies/approve': reply });
        await pg.click('#replyQueue .rc-appr'); await pg.waitForTimeout(400);
        const note = await text(pg, '#replyQueue .rc-note');
        const btn = await pg.$eval('#replyQueue .rc-appr', (x) => ({ t: x.textContent, d: x.disabled }));
        ok(!/Approved|saved locally/.test(note) && /^Not approved|sign in again/.test(note), `${PAGE} MC-09 ${label}: a failed approval reads as success: "${note}"`);
        eq(btn.d, false, `${PAGE} MC-09 ${label}: the Approve button must stay usable after a failure`);
        if (label === '401') ok(/sign in again/i.test(note), `${PAGE} MC-09: a 401 asks the doctor to sign in again: "${note}"`);
        await pg.context().close();
      }
      /* MC-08: a real approval says who posts it; nothing on the page promises publishing */
      {
        const pg = await open(PAGE, { 'POST /api/marketing/replies/approve': [200, { ok: true, id: 7, published: false, message: 'Approved.' }] });
        const btnText = await pg.$eval('#replyQueue .rc-appr', (x) => x.textContent);
        ok(!/publish/i.test(btnText), `${PAGE} MC-08: the approve button still says publish: "${btnText}"`);
        await pg.click('#replyQueue .rc-appr'); await pg.waitForTimeout(400);
        ok(/does not post/i.test(await text(pg, '#replyQueue .rc-note')), `${PAGE} MC-08: the approval must say MLS does not post the reply`);
        const body = await pg.evaluate(() => document.body.innerText);
        ok(!/queued for publishing|publishing turns on|then publish\b|auto-publish/i.test(body), `${PAGE} MC-08: the page still promises publishing`);
        await pg.context().close();
      }
      /* MC-15: Skip is saved on the server, and only then shown */
      {
        const pg = await open(PAGE, { 'POST /api/marketing/replies/7/skip': [200, { ok: true }] });
        await pg.click('#replyQueue .rc-skip'); await pg.waitForTimeout(400);
        ok(pg.calls.some((c) => c.key === 'POST /api/marketing/replies/7/skip'), `${PAGE} MC-15: Skip never told the server`);
        eq((await text(pg, '#replyQueue .rc-note')).trim(), 'Skipped.', `${PAGE} MC-15: a saved skip says so`);
        await pg.context().close();
        const bad = await open(PAGE, { 'POST /api/marketing/replies/7/skip': [500, { error: 'boom' }] });
        await bad.click('#replyQueue .rc-skip'); await bad.waitForTimeout(400);
        ok(!/^Skipped\.$/.test((await text(bad, '#replyQueue .rc-note')).trim()), `${PAGE} MC-15: a failed skip read "Skipped."`);
        await bad.context().close();
      }
      /* MC-10: drafting goes through the entitled route and counts only real drafts */
      {
        let n = 0;
        const pg = await open(PAGE, {
          'GET /api/marketing/replies': [200, { ok: true, replies: [] }],
          'POST /api/marketing/replies/draft': () => (++n === 2 ? [502, { error: 'AI is unavailable right now -- try again.' }] : [200, { ok: true, draft: 'Thank you #' + n }]),
        });
        await pg.click('#draftGo'); await pg.waitForTimeout(600);
        ok(!pg.calls.some((c) => c.key === 'POST /api/widget/ai'), `${PAGE} MC-10: drafting still goes through the Premium-only /api/widget/ai`);
        eq(pg.calls.filter((c) => c.key === 'POST /api/marketing/replies/draft').length, 3, `${PAGE} MC-10: one draft call per review`);
        const note = await text(pg, '#draftNote');
        ok(/Drafted 2 of 3/.test(note), `${PAGE} MC-10: a failed draft was counted as drafted: "${note}"`);
        await pg.context().close();
        const locked = await open(PAGE, { 'GET /api/marketing/replies': [200, { ok: true, replies: [] }], 'POST /api/marketing/replies/draft': [402, { error: 'subscription_required' }] });
        await locked.click('#draftGo'); await locked.waitForTimeout(600);
        ok(/subscription/i.test(await text(locked, '#draftNote')), `${PAGE} MC-10: a 402 says a subscription is needed`);
        eq(await locked.$$eval('#replyQueue .rev', (x) => x.length), 0, `${PAGE} MC-10: no empty "drafts" after a 402`);
        await locked.context().close();
      }
      /* MC-07 + MC-14: no scheduler is claimed; Saved only when both saves landed */
      {
        const pg = await open(PAGE, {
          'POST /api/marketing/settings': [200, { ok: true, settings: { reviewLinks: { healthgrades: 'https://www.healthgrades.com/x' } }, droppedLinks: ['vitals'] }],
          'POST /api/marketing/campaigns': [200, { ok: true, campaign: { message: 'Hi' } }],
        });
        const body = await pg.evaluate(() => document.body.innerText);
        ok(!/sends? automatically/i.test(body), `${PAGE} MC-07: the console still says MLS sends automatically`);
        ok(!/AUTOMATIC|monthly summary/.test(body), `${PAGE} MC-07: the console still claims automations that do not exist`);
        eq(await pg.$('#autoTbl input'), null, `${PAGE} MC-07: switches for automations nothing reads`);
        eq(await pg.$('#campCadence'), null, `${PAGE} MC-07: a cadence control that feeds no scheduler`);
        eq(await pg.$('#campEnabled'), null, `${PAGE} MC-07: an "Enable sending" switch that enables nothing`);
        await pg.fill('#lnkHealthgrades', 'www.healthgrades.com/x');
        await pg.fill('#lnkVitals', 'not a link');
        await pg.click('#campSave'); await pg.waitForTimeout(400);
        const note = await text(pg, '#campNote');
        ok(/Vitals/.test(note), `${PAGE} MC-14: a link the server could not use must be named: "${note}"`);
        eq(await pg.$eval('#lnkHealthgrades', (x) => x.value), 'https://www.healthgrades.com/x', `${PAGE} MC-14: the saved link is shown as saved`);
        const camp = pg.calls.find((c) => c.key === 'POST /api/marketing/campaigns');
        ok(camp && camp.body && !('cadence' in camp.body) && !('enabled' in camp.body), `${PAGE} MC-07: the save still sends dead scheduler fields`);
        await pg.context().close();
        const bad = await open(PAGE, { 'POST /api/marketing/settings': [500, { error: 'boom' }], 'POST /api/marketing/campaigns': [200, { ok: true, campaign: {} }] });
        await bad.click('#campSave'); await bad.waitForTimeout(400);
        const badNote = await text(bad, '#campNote');
        ok(!/^Saved\.$/.test(badNote.trim()) && /Not saved/.test(badNote), `${PAGE} MC-14: a failed links save read "${badNote}"`);
        await bad.context().close();
      }
      /* MC-04: private feedback can be read in the console */
      {
        const pg = await open(PAGE, {
          'GET /api/reviews/requests': [200, { ok: true, requests: [{ id: 41, ref: 'RV-ABC123', provider: 'Dr. Bob Seat', status: 'opened', created_at: '2026-09-20 10:00:00', hasFeedback: true }] }],
          'GET /api/reviews/requests/41/feedback': [200, { ok: true, ref: 'RV-ABC123', message: 'The wait was long, please call me.' }],
        });
        ok(await pg.$('#feedback .fb-read'), `${PAGE} MC-04: the console has no way to read private feedback`);
        await pg.click('#feedback .fb-read'); await pg.waitForTimeout(400);
        ok((await text(pg, '#feedback')).includes('The wait was long, please call me.'), `${PAGE} MC-04: the feedback text is not shown`);
        await pg.context().close();
      }
      /* MC-12: a lapsed plan still shows the live campaign and its Pause; a refused Disconnect is not "Not connected." */
      {
        const pg = await open(PAGE, {
          'GET /api/marketing/ads/status': [200, { ok: true, configured: true, entitled: false, connected: true, customerId: '1234567890' }],
          'GET /api/marketing/ads/campaigns': [200, { ok: true, campaigns: [{ id: 3, name: 'Spine', budget_cents: 2000, status: 'live' }] }],
          'POST /api/marketing/ads/disconnect': [409, { ok: false, error: 'live_campaigns', message: 'Pause your live campaign(s) first.' }],
        });
        ok(await pg.isVisible('#adsList .ad-pause'), `${PAGE} MC-12: with the plan lapsed, the live campaign's Pause is hidden`);
        ok(!(await pg.isVisible('#adPropose')), `${PAGE} MC-12: proposing still needs the Premium tier`);
        await pg.click('#adsDisconnect'); await pg.waitForTimeout(400);
        ok(/Pause your live campaign/.test(await text(pg, '#adsNote')), `${PAGE} MC-12: the refusal reason is not shown`);
        ok(!/Not connected/.test(await text(pg, '#adsStatusText')), `${PAGE} MC-12: a refused Disconnect reads "Not connected."`);
        await pg.context().close();
      }
      /* h9-1.2.0: a confirmed Disconnect with a live campaign goes through, and says the campaign keeps running in Google Ads; a removed campaign reads as removed */
      {
        const pg = await open(PAGE, {
          'GET /api/marketing/ads/status': [200, { ok: true, configured: true, entitled: true, connected: true, customerId: '1234567890' }],
          'GET /api/marketing/ads/campaigns': [200, { ok: true, campaigns: [{ id: 3, name: 'Spine', budget_cents: 2000, status: 'live' }, { id: 4, name: 'Old', budget_cents: 1000, status: 'removed' }] }],
          'POST /api/marketing/ads/disconnect': (body) => (body && body.confirmLive === true) ? [200, { ok: true }] : [409, { ok: false, error: 'live_campaigns', message: 'Pause your live campaign(s) first.' }],
        });
        ok(/REMOVED IN GOOGLE ADS/.test(await text(pg, '#adsList')), `${PAGE} h9-1.2.0: a campaign removed in Google Ads is not shown as removed`);
        pg.once('dialog', (d) => d.accept());
        await pg.click('#adsDisconnect'); await pg.waitForTimeout(600);
        const sent = pg.calls.filter((c) => c.key === 'POST /api/marketing/ads/disconnect').map((c) => !!(c.body && c.body.confirmLive));
        eq(JSON.stringify(sent), '[false,true]', `${PAGE} h9-1.2.0: the first press must not confirm, and the confirmed one must say so`);
        ok(/still running in Google Ads/.test(await text(pg, '#adsNote')), `${PAGE} h9-1.2.0: a confirmed Disconnect must say the campaign keeps running: "${await text(pg, '#adsNote')}"`);
        await pg.context().close();
      }
      /* R2-2: a dead Google token is not a dead end: Reconnect while connected */
      {
        const oauth = 'http://127.0.0.1:' + srv.address().port + '/__google-oauth?state=r2';
        const pg = await open(PAGE, {
          'GET /api/marketing/ads/status': [200, { ok: true, configured: true, entitled: true, connected: true, customerId: '1234567890' }],
          'GET /api/marketing/ads/campaigns': [200, { ok: true, campaigns: [{ id: 3, name: 'Spine', budget_cents: 2000, status: 'live' }] }],
          'POST /api/marketing/ads/campaigns/3/pause': [502, { error: 'Could not pause: Invalid authentication tag length: 24' }],
          'POST /api/marketing/ads/disconnect': [409, { ok: false, error: 'live_campaigns', message: 'Pause your live campaign(s) first. After you disconnect, MLS can no longer pause them.' }],
          'POST /api/marketing/ads/connect': [200, { ok: true, url: oauth }],
        });
        await pg.click('#adsList .ad-pause'); await pg.waitForTimeout(400);
        const pauseNote = await text(pg, '#adsList .ad-note');
        ok(/Could not pause/.test(pauseNote) && /Reconnect Google Ads/.test(pauseNote) && /in Google Ads/.test(pauseNote),
          `${PAGE} R2-2: a failed Pause must say how to get out (Reconnect, or pause in Google Ads): "${pauseNote}"`);
        await pg.click('#adsDisconnect'); await pg.waitForTimeout(400);
        ok(await pg.isVisible('#adsConnect'), `${PAGE} R2-2: with a live campaign, a failed Pause and a refused Disconnect, Connect is hidden: no way out`);
        ok(/Reconnect Google Ads/.test(await text(pg, '#adsConnect')), `${PAGE} R2-2: while connected the button must read Reconnect`);
        ok(/Reconnect/.test(await text(pg, '#adsNote')), `${PAGE} R2-2: the refused Disconnect must point at Reconnect: "${await text(pg, '#adsNote')}"`);
        await Promise.all([pg.waitForURL(/__google-oauth/, { timeout: 5000 }), pg.click('#adsConnect')]);
        ok(pg.calls.some((c) => c.key === 'POST /api/marketing/ads/connect'), `${PAGE} R2-2: Reconnect never asked the server for a Google sign-in`);
        await pg.context().close();
        const off = await open(PAGE, {});
        eq(await text(off, '#adsConnect'), 'Connect Google Ads', `${PAGE} R2-2: not connected, the button still reads Connect`);
        await off.context().close();
        /* back from Google after a Reconnect: the account is already chosen, so
           the note does not ask for a choice there is none to make */
        const back = await open(PAGE, { 'GET /api/marketing/ads/status': [200, { ok: true, configured: true, entitled: true, connected: true, customerId: '1234567890' }],
          'GET /api/marketing/ads/campaigns': [200, { ok: true, campaigns: [] }] }, { search: '?ads=connected' });
        const backNote = await text(back, '#adsNote');
        ok(/Google Ads connected/.test(backNote) && !/choose your account/.test(backNote), `${PAGE} R2-2: back from Reconnect the note reads "${backNote}"`);
        await back.context().close();
      }
      /* R2-5a: no tagline says MLS publishes or auto-posts */
      {
        const pg = await open(PAGE, {});
        const body = await pg.evaluate(() => document.body.innerText);
        const hit = /before it publishes|nothing publishes|auto-posts on your behalf/i.exec(body);
        ok(!hit, `${PAGE} R2-5a: the page still suggests MLS publishes: "${hit && hit[0]}"`);
        ok(!/\bpublishes\b|\bauto-posts\b/i.test(body), `${PAGE} R2-5a: "publishes"/"auto-posts" is still claimed`);
        await pg.context().close();
      }
      /* MC-13: a cancelled checkout says so */
      {
        const pg = await open(PAGE, { 'GET /api/marketing/status': [200, { ok: true, billingConfigured: true, status: 'inactive', billingOwner: true, tiers: [], entitlements: {}, settings: {} }] }, { search: '?checkout=cancelled' });
        ok(/Checkout cancelled/.test(await text(pg, '#actNote')), `${PAGE} MC-13: a cancelled checkout says nothing`);
        await pg.context().close();
      }
      /* MC-03: a seat is told billing is the owner's, and is not offered it */
      {
        const pg = await open(PAGE, { 'GET /api/marketing/status': [200, { ok: true, billingConfigured: true, status: 'inactive', billingOwner: false, canManageBilling: false, tiers: [], entitlements: {}, settings: {} }] });
        ok(/Only the practice owner/.test(await text(pg, '#billingBanner')), `${PAGE} MC-03: a seat is not told billing is the owner's`);
        eq(await pg.$eval('#actGo', (x) => x.disabled), true, `${PAGE} MC-03: a seat is offered Subscribe`);
        await pg.context().close();
      }
      /* MC-16: nothing runs off a phone screen */
      {
        const pg = await open(PAGE, {}, { vp: 'phone' });
        const m = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          right: Math.max(...['lnkGoogle', 'lnkHealthgrades', 'lnkVitals', 'lnkZocdoc'].map((id) => document.getElementById(id).getBoundingClientRect().right)) }));
        ok(m.sw <= m.cw && m.right <= m.cw, `${PAGE} MC-16: horizontal overflow at 390 px: ${JSON.stringify(m)}`);
        await pg.context().close();
      }
    }

    /* MC-04 (patient side): a feedback send that failed never reads as saved */
    for (const [status, want, wantNot] of [[404, /could not be sent/i, /Saved|Sent/], [200, /Sent to the office/, /could not/i], ['abort', /could not be sent/i, /Thank you\.$/]]) {
      const ctx = await b.newContext(VP.phone);
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => errs.push('patient-review: ' + String(e.message).slice(0, 160)));
      await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
        const req = route.request(), u = new URL(req.url());
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (/\/feedback$/.test(u.pathname)) return status === 'abort' ? route.abort('connectionreset') : route.fulfill({ status, headers: cors, contentType: 'application/json', body: '{"ok":' + (status === 200) + '}' });
        if (/\/api\/reviews\/request\/[^/]+$/.test(u.pathname)) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, doctor: '', practice: 'Test Practice', draft: '', links: {} }) });
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true}' });
      });
      await pg.goto('http://127.0.0.1:' + srv.address().port + '/patient-review.html?token=' + 'a'.repeat(48), { waitUntil: 'load' });
      await pg.waitForTimeout(300);
      /* R2-0: a request with a practice and no clinician still says who it is from */
      ok(/Test Practice/.test(await text(pg, '#hSub')), `patient-review R2-0: the header names nobody: "${await text(pg, '#hSub')}"`);
      await pg.click('#btnPriv'); await pg.fill('#privMsg', 'Please call me about the wait.');
      await pg.click('#btnPrivSend'); await pg.waitForTimeout(400);
      const note = await text(pg, '#privNote');
      ok(want.test(note) && !wantNot.test(note), `patient-review MC-04: feedback send ${status} reads "${note}"`);
      await ctx.close();
    }

    /* MC-16 (1p workspace): the top bar wraps instead of running off a phone */
    {
      const ctx = await b.newContext(VP.phone);
      const pg = await ctx.newPage();
      await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await pg.goto('http://127.0.0.1:' + srv.address().port + '/__host.html', { waitUntil: 'load' });
      eq(await pg.evaluate(() => window.__mlsP1Marketing && window.__mlsP1Marketing.open()), true, 'the 1p workspace opens');
      await pg.waitForTimeout(300);
      const m = await pg.evaluate(() => { const ws = document.getElementById('mlsP1MktWorkspace'); const r = document.getElementById('mlsP1MktClear').getBoundingClientRect(); return { sw: ws.scrollWidth, cw: ws.clientWidth, right: Math.round(r.right), vw: document.documentElement.clientWidth }; });
      ok(m.sw <= m.cw && m.right <= m.vw, 'MC-16: the 1p workspace top bar runs off a 390 px screen: ' + JSON.stringify(m));
      await ctx.close();
    }

    eq(errs.length, 0, 'page errors: ' + errs.join(' | '));
    console.log('PASS marketing console shows only what happened: ' + checks + ' checks across both console pages, the patient review page and the 1p workspace at 390 px');
  } catch (e) {
    console.error(e && e.stack || e);
    process.exitCode = 1;
  } finally {
    await b.close();
    srv.close();
  }
});
