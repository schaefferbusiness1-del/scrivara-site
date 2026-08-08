'use strict';

/* THE QR LANDS SOMEWHERE THAT TEACHES  (phone-setup.html, rl-2.1.0)
 * =============================================================================
 * Owner, 2026-08-07: "make a guide to download the app from the desktop using a
 * QR code that actually works and has the person click like the save website to
 * app yk on iPhone or android."
 *
 * WHAT WAS WRONG. The Settings QR encoded ScribeFlow.html?phone=1 — the APP.
 * Scanning it opened MLS in a browser tab and stopped there. Nothing on that
 * path ever mentioned adding it to the Home Screen, so what the doctor got was
 * a bookmark they had to re-find through a browser every morning. The only
 * add-to-home-screen instructions in the entire product lived in a mailto: body
 * (__mlsPhoneHome.setupEmailParts) that nobody had opened, and they asked the
 * reader to identify their own platform.
 *
 * WHAT THIS PINS. The QR points at the guide; the guide reads the phone it is
 * opened on and gives that phone's real taps; and it never tells a computer it
 * is a phone. The platform branches are EXECUTED against real user agents,
 * because a guide that shows Android steps on an iPhone is worse than no guide.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const page = read('phone-setup.html');
const connect = read('mls-connect.js');

/* ---- 1. the QR points at the GUIDE, and the app URL is no longer the QR ---- */
assert(/var PHONE_GUIDE_URL = 'https:\/\/mlsscribe\.com\/phone-setup\.html';/.test(connect),
  'the relay module must define the guide URL');
const cardStart = connect.indexOf("card.id = 'mlsRlCard'");
const cardEnd = connect.indexOf('var cardIv', cardStart);
assert(cardStart > 0 && cardEnd > cardStart, 'the Settings phone card could not be located');
const card = connect.slice(cardStart, cardEnd);
assert(/new window\.QRCode\(box, \{ text: PHONE_GUIDE_URL/.test(card),
  'THE POINT OF THE CHANGE: the QR must encode the guide, not the app — an app URL opens a tab and ' +
  'teaches nothing, which is how "the app" stayed a bookmark');
assert(!/text: PHONE_URL\b/.test(card), 'the old app-URL QR is back');
assert(/Add to Home Screen/.test(card),
  'the desktop card must say what the phone will be asked to do, or the doctor cannot tell somebody else how to do it');
/* A QR that fails to draw must name the address, on the same card. */
assert(/The code could not be drawn\. Type <b>' \+ esc\(PHONE_GUIDE_URL/.test(card),
  'a QR that cannot render must print the address to type instead of pointing at "the link below"');

/* ---- 2. the guide is a reviewed, published page ---- */
const config = read('_config.yml');
assert(/^\s+- "phone-setup\.html"$/m.test(config), 'the guide must be on the Jekyll include allowlist or it is never served');
const inventory = JSON.parse(read('pages-publication-inventory.json'));
assert(inventory.paths.includes('phone-setup.html'), 'the guide must be in the reviewed generated-tree inventory');
assert(inventory.paths.includes('feat_mls_phone_ui.js'), 'the phone app module must be in the reviewed inventory');
assert(/'phone-setup\.html',/.test(read('sw.js')),
  'the guide must be in the service worker public navigation inventory, or the worker treats it as retired');

/* ---- 3. it is self-contained: no third-party anything ---- */
assert(!/api\.qrserver\.com|create-qr-code|chart\.googleapis/i.test(page),
  'the guide must never hand a URL to a third-party QR image service');
for (const m of page.matchAll(/\b(?:href|src)\s*=\s*"([^"]+)"/g)) {
  const target = m[1];
  if (/^(?:#|data:|mailto:)/.test(target)) continue;
  assert(!/^https?:\/\//i.test(target), 'the guide loads an off-origin resource: ' + target);
  const file = target.split(/[?#]/)[0];
  assert(fs.existsSync(path.join(root, file)), 'the guide references a missing local asset: ' + file);
}
assert(/<script src="vendor_qrcode\.js\?v=[^"]+"><\/script>/.test(page),
  'the guide must load the checked-in local QR implementation');
assert(page.indexOf('vendor_qrcode.js') < page.indexOf('new QRCode('),
  'the guide can call QRCode before its implementation has loaded');

/* ---- 4. THE BRANCHES, EXECUTED ----------------------------------------------
 * The whole value of this page is that it knows which device is reading it. A
 * source-only assertion would pass on a page that shows Android steps to an
 * iPhone, so the real script runs against real user agents. */
const UAS = {
  iphone:  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  mac:     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

const script = (() => {
  const marker = "(function () {\n  'use strict';";
  const at = page.indexOf(marker);
  assert(at > 0, 'the guide script could not be located');
  return page.slice(at, page.lastIndexOf('})();') + 5);
})();

function run(ua, extra) {
  extra = extra || {};
  const nodes = new Map();
  const mk = (id) => {
    const n = {
      id, textContent: '', _html: '', _cls: new Set(extra.hidden && extra.hidden.includes(id) ? ['hide'] : []),
      classList: { add: (c) => n._cls.add(c), remove: (c) => n._cls.delete(c), contains: (c) => n._cls.has(c) },
      get innerHTML() { return n._html; }, set innerHTML(v) { n._html = String(v); },
      setAttribute() {}, addEventListener() {}, querySelector: () => mk(id + ':q')
    };
    return n;
  };
  for (const id of ['title', 'lede', 'deskCard', 'installCard', 'openCard', 'afterCard', 'installEyebrow',
    'installTitle', 'installWhy', 'installSteps', 'installNow', 'selfUrl', 'copyBtn', 'qr', 'qrFallback',
    'openApp', 'openFull']) nodes.set(id, mk(id));
  /* Every card starts hidden except the desktop one, exactly as the markup ships. */
  nodes.get('installCard')._cls.add('hide');
  nodes.get('openCard')._cls.add('hide');
  nodes.get('afterCard')._cls.add('hide');
  nodes.get('installNow')._cls.add('hide');

  const drawn = [];
  const ctx = {
    document: { getElementById: (id) => nodes.get(id) || null },
    navigator: { userAgent: ua, maxTouchPoints: /iPhone|Android|iPad/.test(ua) ? 5 : 0 },
    location: { origin: 'https://mlsscribe.com', pathname: '/phone-setup.html' },
    matchMedia: () => ({ matches: !!extra.standalone }),
    addEventListener() {},
    setTimeout() {},
    QRCode: function (host, o) { drawn.push(o); },
    console
  };
  ctx.window = ctx;
  ctx.QRCode.CorrectLevel = { M: 0 };
  if (extra.standalone) ctx.navigator.standalone = true;
  vm.createContext(ctx);
  vm.runInContext(script, ctx, { filename: 'phone-setup.js' });
  const shown = (id) => !nodes.get(id)._cls.has('hide');
  return { nodes, drawn, shown, steps: nodes.get('installSteps')._html, title: nodes.get('title').textContent, lede: nodes.get('lede').textContent };
}

/* ---- 4a. OPEN COMES BEFORE SAVE, and that ordering is a correctness property.
 * "Add to Home Screen" saves the page currently on screen. If this guide told a
 * doctor to add first, the icon on their phone would open this instruction
 * sheet — forever, and silently, because it would look like it worked. */
{
  const html = page;
  const openAt = html.indexOf('id="openCard"');
  const installAt = html.indexOf('id="installCard"');
  assert(openAt > 0 && installAt > 0, 'both phone cards must exist');
  assert(openAt < installAt,
    'the OPEN step must come before the SAVE step: add-to-home-screen captures the page on screen, ' +
    'so instructing the save first produces an icon that opens this instruction sheet instead of the app');
  assert(/Do this on the MLS Scribe screen, not on this one/.test(html),
    'the guide must say WHERE the taps happen — the one sentence that stops a doctor bookmarking the instructions');
  assert(/id="openApp" href="app\.html"/.test(html),
    'the primary button must open the installable app (app.html), which is the page that should end up on the Home Screen');
}

/* iPhone: Safari's Share sheet, and NOT Android's overflow menu. */
{
  const r = run(UAS.iphone);
  assert(r.shown('installCard') && r.shown('openCard'), 'a phone must be shown the install steps and the way in');
  assert(!r.shown('deskCard'), 'a phone must not be shown the scan-this-with-your-phone card');
  assert(/Share button/.test(r.steps) && /Add to Home Screen/.test(r.steps),
    'iOS must be told about the Share sheet: ' + r.steps.slice(0, 200));
  assert(!/three dots|⋮|Add to Home screen<\/b>/.test(r.steps), 'iOS must not be given Android instructions');
  assert(/Put MLS Scribe on your iPhone/.test(r.title), 'the page must name the device it is being read on: ' + r.title);
  assert.strictEqual(r.drawn.length, 0, 'a phone does not need a QR code pointing at the page it is already on');
}

/* Android: the overflow menu, and both names Chrome uses for the item. */
{
  const r = run(UAS.android);
  assert(/menu/.test(r.steps) && /Add to Home screen/.test(r.steps),
    'Android must be told about the overflow menu: ' + r.steps.slice(0, 200));
  assert(/Install app/.test(r.steps),
    'Chrome calls it "Install app" on some versions — a doctor who cannot find the exact words gives up');
  assert(!/Share button/.test(r.steps), 'Android must not be given iOS instructions');
  assert(/Put MLS Scribe on your Android phone/.test(r.title), 'the device must be named: ' + r.title);
}

/* Already installed: it must not instruct a reader to do what they have done. */
{
  const r = run(UAS.iphone, { standalone: true });
  assert(/MLS Scribe is already on your Home Screen/i.test(r.nodes.get('installTitle').textContent),
    'a page being read FROM the home screen must say so, not repeat the instructions');
  assert.strictEqual(r.steps, '', 'the steps must be cleared once they are done');
}

/* A computer: the QR, and never a claim that this machine is a phone. */
for (const [name, ua] of [['Mac', UAS.mac], ['Windows', UAS.windows]]) {
  const r = run(ua);
  assert(r.shown('deskCard'), name + ' must be shown the QR card');
  assert(!r.shown('installCard'), name + ' must not be shown add-to-home-screen steps for itself');
  assert.strictEqual(r.drawn.length, 1, name + ' must get exactly one QR drawn locally');
  assert.strictEqual(r.drawn[0].text, 'https://mlsscribe.com/phone-setup.html',
    'the QR must encode this page\'s own address, built from the origin rather than a literal that can drift');
  assert(!/Put MLS Scribe on your (Mac|Windows|computer)\b/.test(r.title),
    name + ' was told to put MLS on itself: ' + r.title);
  assert(/You are on a /.test(r.lede), name + ' must be told plainly that it is a computer: ' + r.lede);
}

/* ---- 5. the email that travels to a phone carries the guide too ---- */
const emailStart = connect.indexOf('function setupEmailParts()');
const emailEnd = connect.indexOf('function accountEmail()', emailStart);
assert(emailStart > 0 && emailEnd > emailStart, 'the setup email builder could not be located');
const email = connect.slice(emailStart, emailEnd);
assert(/PHONE_GUIDE_URL2/.test(email) && !/PHONE_URL2/.test(email),
  'the emailed link must be the guide — an app URL in an email opens a browser tab and ends there');

console.log('PASS the QR lands somewhere that teaches: the Settings QR encodes the guide (not the app) and ' +
  'names the address when it cannot draw, the page is reviewed/published/SW-known, it loads nothing off-origin, ' +
  'and its platform branches were EXECUTED — iPhone gets the Share sheet, Android gets the overflow menu plus ' +
  '"Install app", an installed reader is told it is already done, and a Mac or PC gets the QR and is never ' +
  'told to put MLS on itself');
