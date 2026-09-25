'use strict';
/* The owner's Admin console shows what the server says, and offers only what
   works (bla-1.0.0, 2026-09-25). Confirmed in real Chromium against the real
   backend:
   - #15 After one account was created, a failed create for the next person
         left the previous person's private invite under "Ready for first
         login", and nothing in the box said whose invite it was.
   - #16 The Audit log card always said "No audit entries yet." - the client
         read d.entries, the server answers { audit: rows }.
   - #18 A revoked access code read "Available" with a Revoke button - the
         client tested active===false, the server sends the integer 0.
   - #20 The owner's own row offered Comp, Trial..., Block and Wksp, which the
         server refuses, and Reset PW, which signed the owner out of every
         session - the row tested role==='owner', the server sends 'admin'.
   - #21 Billing "Access source" read "direct" for every account - the cell
         showed commercial.source, never the server's accessSource.
   Real Chromium; nothing leaves 127.0.0.1 (the MLS server is stubbed). */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OWNER = { id: 1, email: 'owner@clinic.test', name: 'Clinic Owner', role: 'admin', isAdmin: true, premium: true, hasAccess: true, agreements: { required: false, signerComplete: true } };

/* what the server sends; a step may change these */
const S = {
  users: [
    /* /api/admin/users sends the owner as role 'admin' with no isAdmin field */
    { id: 1, email: 'owner@clinic.test', name: 'Clinic Owner', role: 'admin', access: 'comp', readiness: { state: 'ready', reasons: [] }, visits: 3 },
    { id: 2, email: 'dr.lee@clinic.test', name: 'Sam Lee, DO', role: 'doctor', access: 'active', readiness: { state: 'ready', reasons: [] }, visits: 1 }
  ],
  audit: { audit: [
    { id: 7, user_id: 1, action: 'revoke_code', target_id: 5, ip: '10.0.0.1', ts: '2026-09-24 12:00:00' },
    { id: 6, user_id: 1, action: 'create_code:forever', target_id: 5, ip: '10.0.0.1', ts: '2026-09-24 11:59:00' }
  ] },
  codes: { codes: [
    { id: 5, code: 'SCRIV-AAAA-0000', type: 'trial', days: 30, note: 'revoked-int', active: 0, redeemed_by: null },
    { id: 6, code: 'SCRIV-BBBB-1111', type: 'forever', note: 'live', active: 1, redeemed_by: null },
    { id: 7, code: 'SCRIV-CCCC-2222', type: 'forever', note: 'revoked-bool', active: false },
    { id: 8, code: 'SCRIV-DDDD-3333', type: 'forever', note: 'no-field' }
  ] },
  billing: { plans: [], users: [
    { id: 3, email: 'sub@clinic.test', role: 'head', plan: 'standard_monthly', accessSource: 'subscription', hasSubscription: 1, stripe_status: 'active', readiness: { state: 'ready', reasons: [] }, commercialEntitlement: { source: 'direct', hasAccess: true } },
    { id: 4, email: 'trial@clinic.test', role: 'head', plan: 'standard_monthly', accessSource: 'trial', readiness: { state: 'ready', reasons: [] }, commercialEntitlement: { source: 'direct', hasAccess: true } },
    { id: 5, email: 'comp@clinic.test', role: 'head', plan: 'standard_monthly', accessSource: 'admin-override', readiness: { state: 'ready', reasons: [] }, commercialEntitlement: { source: 'direct', hasAccess: true } },
    { id: 6, email: 'member@clinic.test', role: 'doctor', accessSource: 'none', readiness: { state: 'ready', reasons: [] }, commercialEntitlement: { source: 'practice-enterprise', coverageActive: true, coverageBlocked: false, hasAccess: true } }
  ] },
  ready: []   /* queued answers for POST /api/admin/accounts/ready: [status, body] */
};
const hits = [];
function answer(url, method, body) {
  const u = String(url);
  hits.push(method + ' ' + u.replace(/^https?:\/\/[^/]+/, ''));
  if (/\/api\/admin\/users\/\d+\/reset-password/.test(u)) return [200, { ok: true }];
  if (/\/api\/admin\/users(\?|$)/.test(u)) return [200, { users: S.users }];
  if (/\/api\/admin\/legal-release(\?|$)/.test(u)) return [200, { releaseConfigured: true, grants: [{ userId: 1 }, { userId: 2 }] }];
  if (/\/api\/admin\/audit(\?|$)/.test(u)) return [200, S.audit];
  if (/\/api\/admin\/codes(\?|$)/.test(u)) return [200, S.codes];
  if (/\/api\/admin\/billing\/overview/.test(u)) return [200, S.billing];
  if (/\/api\/admin\/billing\/webhooks/.test(u)) return [200, { webhookConfigured: true, counts: [], events: [] }];
  if (/\/api\/admin\/accounts\/ready/.test(u) && method === 'POST') return S.ready.shift() || [500, { error: 'no answer queued' }];
  if (/\/api\/me(\?|$)/.test(u)) return [200, { user: Object.assign({ access: 'comp' }, OWNER) }];
  if (/\/api\/auth\/me\b/.test(u)) return [200, { user: Object.assign({ totp_enabled: false }, OWNER) }];
  if (/\/api\/auth\/2fa\/status/.test(u)) return [200, { enabled: false }];
  if (/\/api\/keys\b/.test(u)) return [200, { keys: [] }];
  if (/\/api\/health\b/.test(u)) return [200, { ok: true }];
  if (/\/api\/agreements\/me(\?|$)/.test(u)) return [200, { signed: true, version: '2026-06-10' }];
  if (/\/api\/prefs(\?|$)/.test(u)) return [200, { prefs: {} }];
  return null;
}

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'America/New_York', locale: 'en-US' });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('sf_session', 'owner@clinic.test'); sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {} });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
      const req = r.request();
      let body = null; try { body = req.postDataJSON(); } catch (e) {}
      const a = answer(req.url(), req.method(), body);
      return a ? r.fulfill({ status: a[0], contentType: 'application/json', body: JSON.stringify(a[1]) }) : r.fulfill({ status: 503, body: 'x' });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await pg.waitForTimeout(4000);
    await pg.evaluate((user) => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'owner@clinic.test';
      try { sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {}
      try { bkUser = user; } catch (e) {}
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
      try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
    }, OWNER);
    await pg.waitForTimeout(2500);
    for (let i = 0; i < 12; i++) {
      await pg.evaluate(() => {
        const bs = [...document.querySelectorAll('button')].filter((x) => x.offsetParent);
        const f = bs.find((x) => /Use faster day-only pulls/.test(x.textContent)); if (f) f.click();
        const m = bs.find((x) => /^No, it is mine$/.test(x.textContent.trim())); if (m) m.click();
        const l = bs.find((x) => /^Later$/.test(x.textContent.trim())); if (l) l.click();
      });
      await pg.waitForTimeout(250);
    }
    await pg.evaluate((user) => { try { bkUser = user; } catch (e) {} showView('admin'); }, OWNER);
    await pg.waitForFunction(() => document.querySelectorAll('#adminUsersBody tr').length >= 2, null, { timeout: 30000 });

    const failed = [];
    const section = async (label, fn) => {
      try { await fn(); console.log('ok   ' + label); }
      catch (e) { failed.push(label); console.log('FAIL ' + label + ' :: ' + String(e && e.message || e).slice(0, 400)); }
      await pg.evaluate(() => { const d = document.getElementById('_mlsAskDialog'); if (d) { const no = d.querySelector('#_mlsAskNo'); if (no) no.click(); } });
    };
    const rowOf = (email) => pg.evaluate((email) => {
      const tr = [...document.querySelectorAll('#adminUsersBody tr')].find((x) => x.cells[0] && x.cells[0].textContent.trim() === email);
      if (!tr) return null;
      return { access: tr.cells[2].textContent.replace(/\s+/g, ' ').trim(), actions: tr.cells[5].textContent.replace(/\s+/g, ' ').trim(),
        buttons: [...tr.cells[5].querySelectorAll('button')].map((x) => x.textContent.trim()) };
    }, email);
    const dialog = () => pg.evaluate(() => { const m = document.getElementById('_mlsAskMsg'); return m ? m.textContent : null; });

    /* ---- #20: the owner's own row offers nothing the server refuses ---- */
    await section('#20 the owner row offers no failing actions', async () => {
      const own = await rowOf('owner@clinic.test');
      assert.ok(own, 'the owner row is listed');
      assert.deepStrictEqual(own.buttons, [], 'the owner row has no Comp / Trial / Reset PW / Block / Wksp buttons: ' + JSON.stringify(own));
      assert.ok(/^Owner$/.test(own.actions), 'the owner row says Owner: ' + JSON.stringify(own));
      assert.ok(/Owner/.test(own.access) && !/Comp \(forever\)/.test(own.access), 'the owner\'s access reads Owner, not Comp (forever): ' + JSON.stringify(own));
      const doc = await rowOf('dr.lee@clinic.test');
      for (const want of ['Comp', 'Trial…', 'Reset PW', 'Block']) assert.ok(doc.buttons.includes(want), 'a customer row keeps ' + want + ': ' + JSON.stringify(doc));
    });
    await section('#20 Reset PW on the signed-in owner asks first and does nothing on Cancel', async () => {
      const before = hits.filter((h) => /reset-password/.test(h)).length;
      await pg.evaluate(() => { window.__resetDone = adminResetPassword(1); });
      await pg.waitForSelector('#_mlsAskMsg', { timeout: 5000 });
      const said = await dialog();
      assert.ok(/every session/.test(said) && /including this one/.test(said), 'the first question says every session ends, this one too: ' + said);
      await pg.click('#_mlsAskNo');
      await pg.evaluate(() => window.__resetDone);
      await pg.waitForTimeout(300);
      assert.strictEqual(await dialog(), null, 'Cancel asks nothing more');
      assert.strictEqual(hits.filter((h) => /reset-password/.test(h)).length, before, 'Cancel resets nothing');
    });
    await section('#20 Reset PW on the owner goes ahead only after the confirm', async () => {
      const before = hits.filter((h) => /reset-password/.test(h)).length;
      await pg.evaluate(() => { window.__resetDone = adminResetPassword(1); });
      await pg.waitForSelector('#_mlsAskMsg', { timeout: 5000 });
      assert.ok(/every session/.test(await dialog()), 'the confirm comes first');
      await pg.click('#_mlsAskYes');
      await pg.waitForFunction(() => { const i = document.getElementById('_mlsAskInput'); return !!i; }, null, { timeout: 5000 });
      await pg.fill('#_mlsAskInput', 'NewOwnerPass999!');
      await pg.click('#_mlsAskYes');
      await pg.evaluate(() => window.__resetDone);
      assert.strictEqual(hits.filter((h) => /reset-password/.test(h)).length, before + 1, 'the reset is sent after both answers');
    });
    await section('#20 Reset PW on a customer asks only for the password', async () => {
      await pg.evaluate(() => { window.__resetDone = adminResetPassword(2); });
      await pg.waitForSelector('#_mlsAskMsg', { timeout: 5000 });
      assert.ok(/^Set a new password for dr\.lee@clinic\.test/.test(await dialog()), 'a customer reset opens the password prompt directly');
      await pg.click('#_mlsAskNo');
      await pg.evaluate(() => window.__resetDone);
    });

    /* ---- #16: the audit card reads { audit: rows } --------------------- */
    await section('#16 the audit card lists the server\'s audit rows', async () => {
      const out = await pg.evaluate(async () => {
        await loadAdminAudit();
        const t = document.getElementById('adminAuditTable'), e = document.getElementById('adminAuditEmpty');
        const rows = [...document.querySelectorAll('#adminAuditBody tr')].map((r) => [...r.cells].map((c) => c.textContent.trim()));
        return { table: getComputedStyle(t).display, empty: getComputedStyle(e).display, rows, want: new Date(Date.UTC(2026, 8, 24, 12, 0, 0)).toLocaleString() };
      });
      assert.strictEqual(out.table, 'table', 'the audit table shows: ' + JSON.stringify(out));
      assert.strictEqual(out.empty, 'none', '"No audit entries yet." is hidden: ' + JSON.stringify(out));
      assert.deepStrictEqual(out.rows.map((r) => r[2]), ['revoke_code', 'create_code:forever'], 'newest first: ' + JSON.stringify(out.rows));
      assert.strictEqual(out.rows[0][0], out.want, 'the server\'s UTC time is shown in the viewer\'s time: ' + JSON.stringify(out));
    });
    await section('#16 the audit card still reads { entries } and an array', async () => {
      S.audit = { entries: [{ id: 9, user_id: 1, action: 'grant', target_id: 2, ip: '10.0.0.2', ts: '2026-09-24T13:00:00.000Z' }] };
      const a = await pg.evaluate(async () => { await loadAdminAudit(); return document.querySelectorAll('#adminAuditBody tr').length; });
      S.audit = [{ id: 10, user_id: 1, action: 'block', target_id: 3, ip: '', ts: '2026-09-24 14:00:00' }, { id: 11, user_id: 1, action: 'grant', target_id: 3, ip: '', ts: '2026-09-24 14:01:00' }];
      const c = await pg.evaluate(async () => { await loadAdminAudit(); return document.querySelectorAll('#adminAuditBody tr').length; });
      assert.deepStrictEqual([a, c], [1, 2], 'entries and a bare array are read too');
    });

    /* ---- #18: a code with active 0 is revoked -------------------------- */
    await section('#18 revoked codes read Revoked with no Revoke button', async () => {
      const rows = await pg.evaluate(async () => {
        await loadAdminCodes();
        return [...document.querySelectorAll('#adminCodesBody tr')].map((r) => ({ code: r.cells[0].textContent.trim(), status: r.cells[3].textContent.trim(), revoke: r.cells[4].querySelectorAll('button').length }));
      });
      const by = Object.fromEntries(rows.map((r) => [r.code, r]));
      assert.deepStrictEqual([by['SCRIV-AAAA-0000'].status, by['SCRIV-AAAA-0000'].revoke], ['Revoked', 0], 'active 0 is Revoked with no Revoke button: ' + JSON.stringify(rows));
      assert.deepStrictEqual([by['SCRIV-CCCC-2222'].status, by['SCRIV-CCCC-2222'].revoke], ['Revoked', 0], 'active false is Revoked: ' + JSON.stringify(rows));
      assert.deepStrictEqual([by['SCRIV-BBBB-1111'].status, by['SCRIV-BBBB-1111'].revoke], ['Available', 1], 'active 1 is Available with Revoke: ' + JSON.stringify(rows));
      assert.deepStrictEqual([by['SCRIV-DDDD-3333'].status, by['SCRIV-DDDD-3333'].revoke], ['Available', 1], 'a row with no active field is not called revoked: ' + JSON.stringify(rows));
    });

    /* ---- #21: Billing shows the server's access source ------------------ */
    await section('#21 Billing shows the access source the server reports', async () => {
      const cells = await pg.evaluate(async () => {
        await loadAdminBilling();
        return Object.fromEntries([...document.querySelectorAll('#adminBillingBody tr')].map((r) => [r.cells[0].textContent.trim(), (r.cells[3].querySelector('.mini') || {}).textContent]));
      });
      assert.deepStrictEqual(cells, { 'sub@clinic.test': 'subscription', 'trial@clinic.test': 'trial', 'comp@clinic.test': 'admin-override', 'member@clinic.test': 'practice-enterprise' },
        'each row names why it has access: ' + JSON.stringify(cells));
    });

    /* ---- #15: a failed create clears the previous person's invite ------- */
    const create = async (name, email) => {
      await pg.evaluate(([name, email]) => {
        document.getElementById('adminCreateName').value = name;
        document.getElementById('adminCreateEmail').value = email;
        const role = document.getElementById('adminCreateRole'); role.value = 'head'; role.dispatchEvent(new Event('change'));
        document.getElementById('adminCreateClinicalApproved').checked = true;
      }, [name, email]);
      await pg.click('#adminCreateBtn');
      await pg.waitForFunction(() => !document.getElementById('adminCreateBtn').disabled, null, { timeout: 10000 });
      await pg.waitForTimeout(300);
    };
    const result = () => pg.evaluate(() => {
      const box = document.getElementById('adminCreateResult');
      let stored = null; try { stored = sessionStorage.getItem(adminPendingInviteKey()); } catch (e) {}
      return { shown: !!box && getComputedStyle(box).display !== 'none', title: document.getElementById('adminCreateResultTitle').textContent,
        detail: document.getElementById('adminCreateResultDetail').textContent, invite: document.getElementById('adminCreateInviteUrl').value,
        status: document.getElementById('adminCreateStatus').textContent, stored };
    });
    const aliceOk = [200, { user: { id: 10, email: 'alice@clinic.test', name: 'Alice Head', role: 'head', setupPolicyVersion: 2 }, readiness: { state: 'ready', reasons: [] }, inviteUrl: 'https://mlsscribe.com/ScribeFlow.html#invite=TOKALICE' }];
    await section('#15 the result box names whose invite it is', async () => {
      S.ready.push(aliceOk);
      await create('Alice Head', 'alice@clinic.test');
      const r = await result();
      assert.ok(r.shown && /TOKALICE/.test(r.invite), 'Alice\'s invite is shown: ' + JSON.stringify(r));
      assert.ok(/alice@clinic\.test/.test(r.detail) && /Alice Head/.test(r.detail), 'the box names the account the invite belongs to: ' + JSON.stringify(r));
    });
    await section('#15 a server refusal for the next person clears the previous invite', async () => {
      S.ready.length = 0; S.ready.push(aliceOk);
      await create('Alice Head', 'alice@clinic.test');
      assert.ok(/TOKALICE/.test((await result()).invite), 'Alice\'s invite is up first');
      S.ready.push([409, { error: 'That email already belongs to role doctor; no account changes were made.', code: 'ACCOUNT_ROLE_MISMATCH' }]);
      await create('Bob Newhire', 'doc2@clinic.test');
      const r = await result();
      assert.ok(/Nothing was reported as Ready/.test(r.status), 'the refusal is said: ' + JSON.stringify(r));
      assert.ok(!r.shown && r.invite === '' && !r.stored, 'Alice\'s invite is gone from the screen and from this tab: ' + JSON.stringify(r));
      await pg.evaluate(async () => { await loadAdminUsers(); });
      const again = await result();
      assert.ok(!again.shown && again.invite === '', 'a users reload does not bring Alice\'s invite back: ' + JSON.stringify(again));
    });
    await section('#15 a form error for the next person clears the previous invite', async () => {
      S.ready.length = 0; S.ready.push(aliceOk);
      await create('Alice Head', 'alice@clinic.test');
      assert.ok(/TOKALICE/.test((await result()).invite), 'Alice\'s invite is up first');
      const posts = hits.filter((h) => /accounts\/ready/.test(h)).length;
      await create('Bob Newhire', 'bob-at-nowhere');
      const r = await result();
      assert.ok(/valid email/.test(r.status), 'the form error is said: ' + JSON.stringify(r));
      assert.strictEqual(hits.filter((h) => /accounts\/ready/.test(h)).length, posts, 'nothing is sent');
      assert.ok(!r.shown && r.invite === '' && !r.stored, 'Alice\'s invite is gone: ' + JSON.stringify(r));
    });

    assert.deepStrictEqual(failed, [], 'every section passes: ' + JSON.stringify(failed));
    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS admin console reads what the server says: the owner row offers no refused action and Reset PW on the owner asks first, the audit card reads { audit } in UTC, a code with active 0 reads Revoked, Billing names the server\'s access source, and a failed create clears the previous person\'s invite, which is now named');
  } finally { await b.close(); srv.close(); }
});
