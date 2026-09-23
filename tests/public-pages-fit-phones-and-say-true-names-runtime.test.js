'use strict';
/* Three public pages fit a phone and say what they mean (pagesfix-1.0.0, 2026-09-23).
   Found by the patient/public page hunt:
   - get-extension.html: on a 390px phone the SHA-256 digest ran off the card and
     the whole page scrolled sideways (scrollWidth 554 at 390).
   - phone-setup.html: "MLS Scribe" named two different apps. The computer card
     said "MLS Scribe is the small phone app" and called the recording app "the
     full MLS workspace", while the phone card's big "Open MLS Scribe" button
     opens the full phone app and calls app.html "the small read-only app".
   - lawyers.html: directory search matched the JSON KEY names, so typing "id",
     "states" or "headline" returned every profile; and on a phone the header,
     footer links (23px) and FAQ questions (27px) were too short to tap.
   Real Chrome; the directory API is stubbed with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP = { viewport: { width: 1400, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' };
const EXPERTS = [
  { id: 11, name: 'Dr. Ada Ortho', specialty: 'Orthopedic Surgery', states: ['PA', 'NJ'], headline: 'Spine and joint expert', depo_rate_cents: 150000 },
  { id: 12, name: 'Dr. Ben Neuro', specialty: 'Neurology', states: ['NY'], headline: 'Headache clinic' }
];

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const open = async (ctxOpts, file) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
    pg.on('pageerror', (e) => errs.push(file + ': ' + String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.route(/\/api\/public\/experts/, (r) => r.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ released: true, experts: EXPERTS }) }));
    await pg.goto(base + '/' + file, { waitUntil: 'load' });
    await pg.waitForTimeout(400);
    return pg;
  };
  try {
    /* 1. get-extension.html: the digest wraps inside the card on a phone, and
          stays on one line on a desktop. */
    {
      const pg = await open(PHONE, 'get-extension.html');
      const m = await pg.evaluate(() => { const d = document.querySelector('#status b'); const r = d.getBoundingClientRect();
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, right: r.right, text: d.textContent }; });
      assert.match(m.text, /^[a-f0-9]{64}$/, 'the digest text itself must be untouched: ' + m.text);
      assert.ok(m.right <= m.cw + 1, 'on a 390px phone the SHA-256 digest runs off the card (right edge ' + Math.round(m.right) + ' vs ' + m.cw + ')');
      assert.ok(m.sw <= m.cw, 'on a 390px phone get-extension.html scrolls sideways (scrollWidth ' + m.sw + ' vs ' + m.cw + ')');
      const pd = await open(DESKTOP, 'get-extension.html');
      const d = await pd.evaluate(() => ({ sw: document.documentElement.scrollWidth, lines: document.querySelector('#status b').getClientRects().length }));
      assert.strictEqual(d.sw, 1400, 'the desktop page scrolls sideways');
      assert.strictEqual(d.lines, 1, 'on a desktop the digest must stay on one line, as before');
    }

    /* 2. phone-setup.html: each app has one name, on the computer and on the phone. */
    {
      const pg = await open(DESKTOP, 'phone-setup.html');
      const desk = await pg.evaluate(() => document.getElementById('deskCard').innerText.replace(/\s+/g, ' '));
      assert.ok(!/MLS Scribe is the small/i.test(desk),
        'the computer card calls MLS Scribe "the small phone app" while the phone\'s big "Open MLS Scribe" button opens the full phone app: ' + desk);
      assert.ok(!/full MLS workspace/i.test(desk), 'the computer card gives the recording app a third name ("the full MLS workspace")');
      assert.match(desk, /MLS Scribe phone app[^.]*record/i, 'the computer card must say the MLS Scribe phone app is the one that records: ' + desk);
      assert.match(desk, /small read-only app[^.]*cannot record/i, 'the computer card must name the small read-only app and say it cannot record: ' + desk);

      const ph = await open(PHONE, 'phone-setup.html');
      const phone = await ph.evaluate(() => ({
        card: document.getElementById('openCard').innerText.replace(/\s+/g, ' '),
        hidden: document.getElementById('openCard').classList.contains('hide'),
        primary: document.getElementById('openApp').innerText, primaryHref: document.getElementById('openApp').getAttribute('href'),
        second: document.getElementById('openFull').innerText, secondHref: document.getElementById('openFull').getAttribute('href'),
        all: [...document.querySelectorAll('section.card:not(.hide)')].map((s) => s.innerText).join(' ').replace(/\s+/g, ' ')
      }));
      assert.ok(!phone.hidden, 'an iPhone must be shown the open-the-app card');
      assert.strictEqual(phone.primaryHref, 'ScribeFlow.html?phone=1');
      assert.strictEqual(phone.secondHref, 'app.html');
      assert.match(phone.card, /MLS Scribe phone app/, 'the phone card must use the same name for the big button\'s app as the computer card: ' + phone.card);
      assert.match(phone.primary, /MLS Scribe/, 'the big button opens MLS Scribe: ' + phone.primary);
      assert.match(phone.second, /small read-only app/, 'the second button must use the same name as the computer card: ' + phone.second);
      assert.ok(!/MLS Scribe is the small/i.test(phone.all), 'the phone view still calls MLS Scribe the small app');
    }

    /* 3. lawyers.html: search reads what the cards show, and a thumb can hit the links. */
    for (const [label, ctx] of [['desktop', DESKTOP], ['phone', PHONE]]) {
      const pg = await open(ctx, 'lawyers.html');
      const names = () => pg.$$eval('.docs-card h3', (h) => h.map((x) => x.innerText));
      assert.deepStrictEqual(await names(), ['Dr. Ada Ortho', 'Dr. Ben Neuro'], label + ': both released profiles show');
      for (const key of ['id', 'states', 'headline', 'specialty', 'name', '150000']) {
        await pg.fill('#dirSearch', key); await pg.waitForTimeout(80);
        assert.deepStrictEqual(await names(), [], label + ': searching "' + key + '" matches a hidden key name or raw value and returns every profile');
        assert.match(await pg.$eval('#dirStateMsg', (e) => e.innerText), /No released profiles match/, label + ': an empty search says so');
      }
      for (const [q, want] of [['neuro', ['Dr. Ben Neuro']], ['spine', ['Dr. Ada Ortho']], ['orthopedic', ['Dr. Ada Ortho']],
        ['pennsylvania', ['Dr. Ada Ortho']], ['NY', ['Dr. Ben Neuro']], ['1,500', ['Dr. Ada Ortho']]]) {
        await pg.fill('#dirSearch', q); await pg.waitForTimeout(80);
        assert.deepStrictEqual(await names(), want, label + ': searching "' + q + '" should find what the card shows');
      }
      await pg.fill('#dirSearch', ''); await pg.waitForTimeout(80);

      const taps = await pg.evaluate(() => [...document.querySelectorAll('a,button,summary,select,input')].filter((el) => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.disabled && !(el.tagName === 'A' && cs.display === 'inline');
      }).map((el) => ({ what: (el.tagName.toLowerCase() + ' "' + (el.innerText || el.value || '').trim().split('\n')[0].slice(0, 40) + '"'), h: el.getBoundingClientRect().height,
        foot: !!el.closest('footer .links'), summary: el.tagName === 'SUMMARY' })));
      if (label === 'phone') {
        const short = taps.filter((t) => t.h < 40).map((t) => t.what + ' ' + Math.round(t.h) + 'px');
        assert.deepStrictEqual(short, [], 'phone: these links and controls are shorter than 40px to tap: ' + short.join(', '));
        const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(sw <= 390, 'phone: lawyers.html scrolls sideways (' + sw + ')');
      } else {
        /* The phone fix must not restyle the desktop page. */
        const tall = taps.filter((t) => (t.foot || t.summary) && t.h >= 30).map((t) => t.what + ' ' + Math.round(t.h) + 'px');
        assert.deepStrictEqual(tall, [], 'desktop: footer links / FAQ questions changed height: ' + tall.join(', '));
      }
    }

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS public pages fit phones and say true names: the extension digest wraps inside the card at 390px (one line on desktop), phone-setup names the MLS Scribe phone app and the small read-only app the same way on a computer and a phone, and the attorney directory searches only what the cards show with 40px+ tap targets on a phone');
  } finally { await b.close(); srv.close(); }
});
