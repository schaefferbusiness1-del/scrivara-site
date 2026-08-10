'use strict';

/* A FLOATING CARD NEVER SITS OVER AN INTERACTIVE CONTROL
 * =============================================================================
 * This product has now produced the same defect twice in one day, on two
 * different surfaces, which is the definition of a class that needs a rule
 * rather than a patch:
 *
 *   1. ON THE PHONE — `#mlsR46VerBanner` ("MLS Assist is not installed in this
 *      browser"), 230x332 at z-index 2147483100, sat in the middle of a 375x812
 *      screen and `elementFromPoint` proved it swallowed 3 of the 16 controls on
 *      the day screen: the pull button and the FIRST PATIENT OF THE DAY.
 *
 *   2. ON THE DESKTOP — `#mlsGetPhoneCard` is anchored `bottom:16px`, so it
 *      grows UPWARD. The moment a QR was added to it it went from 176px to
 *      299px tall, and at 1280x800 — the MacBook Air 13" default — its top edge
 *      landed on `#mlsDsPullBtn`, the button labelled "📥 Pull today".
 *      Measured on the shipped tree with the control run both ways: covered
 *      with the QR block, clickable with the QR block hidden. It was found an
 *      hour before a live clinical session in which a doctor was expected to
 *      press exactly that button.
 *
 * WHY THIS SUITE IS IN A REAL BROWSER. The defect is a LAYOUT and HIT-TEST
 * fact. A string test cannot see it: nothing in the source says "299px", the
 * height is the sum of the card's children under a font the test would have to
 * render anyway. Asserting it any other way would be a gate that cannot fail —
 * which is how the 299px card shipped in the first place.
 *
 * ⛔ AND THE INSTRUMENT HAS TO BE ASSERTED BEFORE IT IS BELIEVED.
 * `document.elementFromPoint` returns <body> for EVERY point until the page has
 * composited after a layout change. The first version of the runtime guard for
 * this defect asked "is any control covered?" on the tick it appended the card,
 * got "no" from an instrument that was not ready, FAILED OPEN and kept the
 * full-height card. So every hit test below is gated: a control known to be on
 * top must first resolve to itself, and until it does the measurement is
 * refused rather than graded. Rectangle intersection is used for the geometric
 * invariants because rectangles need no compositing.
 */

const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.resolve(__dirname, '..');

/* The shipped card's own source, so the invariants below are asserted against
   what actually ships rather than against a copy. */
const shell = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
assert.ok(/var CARD_ID = 'mlsGetPhoneCard'/.test(shell),
  'the desktop phone card was renamed — this suite is pinned to #mlsGetPhoneCard');
assert.ok(/function controlCoveredBy/.test(shell),
  'THE RULE IS GONE: controlCoveredBy() is what makes this card yield to a control');
assert.ok(/function settleThenYield/.test(shell),
  'THE RULE IS GONE: settleThenYield() is what withdraws the card when it cannot fit');
/* The runtime guard must NOT depend on elementFromPoint — see the header. */
const guardFrom = shell.indexOf('function controlCoveredBy');
const guardTo = shell.indexOf('function settleThenYield');
assert.ok(guardTo > guardFrom, 'could not slice the guard');
assert.ok(!/elementFromPoint/.test(shell.slice(guardFrom, guardTo)),
  'the runtime guard uses elementFromPoint, which returns <body> until the page composites — it ' +
  'will fail OPEN on the tick the card is appended, which is exactly when it runs');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'ScribeFlow.html';
      const abs = path.join(root, rel);
      if (!abs.startsWith(root) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(abs));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  /* `channel: 'chrome'` is this repo's convention for every real-browser suite:
     it drives the INSTALLED Google Chrome rather than a downloaded playwright
     build, so the gate needs no `npx playwright install` step and measures the
     engine the clinicians actually run. */
  const browser = await chromium.launch({ channel: 'chrome' });
  let failure = null;
  try {
    /* 1280x800 IS THE CASE THAT BIT: the MacBook Air 13" default. */
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://127.0.0.1:' + port + '/ScribeFlow.html', { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const out = {};
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      /* A stand-in for the day-switch pull button, placed exactly where the
         real one sits at this viewport: x 1104..1215, y 547..581. Using a
         synthetic control keeps the suite independent of whether the pull strip
         has mounted yet, while measuring the same geometry that bit. */
      const victim = document.createElement('button');
      victim.id = 'pullStandIn';
      victim.textContent = '📥 Pull today';
      victim.style.cssText = 'position:fixed;left:1104px;top:547px;width:111px;height:34px;z-index:900';
      document.body.appendChild(victim);

      /* The card only offers itself to a SIGNED-IN desktop, and it decides that
         by asking whether #appScreen is displayed. This suite is about geometry,
         not auth, so the one condition it cannot reach through the login form is
         satisfied directly — everything else (not handheld, not standalone, not
         dismissed) is already true in a 1280x800 Chrome. */
      let appScreen = document.getElementById('appScreen');
      if (!appScreen) {
        appScreen = document.createElement('div');
        appScreen.id = 'appScreen';
        document.body.appendChild(appScreen);
      }
      appScreen.style.setProperty("display", "block", "important");

      try { localStorage.removeItem('mls_getphone_dismissed'); } catch (e) {}
      const api = window.__mlsGetPhone;
      out.apiPresent = !!(api && typeof api.show === 'function');
      if (!out.apiPresent) return out;
      /* THE 12-SECOND FLOOR IS REAL AND IT IS DELIBERATE. hintOwnsCorner()
         returns true for the first 12s after load so this card cannot mount on
         top of the keyboard hint that arrives a second later. Waiting it out is
         what makes this suite exercise the SHIPPED gate instead of a doctored
         one. */
      for (let i = 0; i < 60; i++) { if (api.eligible()) break; await sleep(400); }
      out.eligibleAfterWait = api.eligible();
      if (!out.eligibleAfterWait) return out;
      api.show();
      await sleep(500);

      const card = document.getElementById(api.cardId);
      out.cardShown = !!card;
      if (!card) return out;

      const cr = card.getBoundingClientRect();
      const vr = victim.getBoundingClientRect();
      out.card = [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)];
      out.rectOverlap = cr.left < vr.right && cr.right > vr.left && cr.top < vr.bottom && cr.bottom > vr.top;
      out.gapPx = Math.round(cr.top - vr.bottom);
      out.clipped = card.scrollHeight > Math.round(cr.height) + 1;

      /* Every control the card offers must be inside it and reachable — a cap
         that clips "Got it" trades a covered control for an unreachable one. */
      out.buttons = Array.from(card.querySelectorAll('button')).map((b) => {
        const q = b.getBoundingClientRect();
        return { t: (b.textContent || '').trim(), h: Math.round(q.height), inside: q.bottom <= cr.bottom + 1 && q.top >= cr.top - 1 };
      });

      /* THE HIT TEST, gated on the instrument proving itself first. */
      let ready = false;
      for (let i = 0; i < 40 && !ready; i++) {
        const p = document.elementFromPoint(Math.round(cr.left + cr.width / 2), Math.round(cr.top + 6));
        ready = !!(p && (p === card || card.contains(p)));
        if (!ready) await sleep(50);
      }
      out.instrumentReady = ready;
      if (ready) {
        const hit = document.elementFromPoint(Math.round(vr.left + vr.width / 2), Math.round(vr.top + vr.height / 2));
        out.victimHit = hit ? (hit.id || hit.tagName) : null;
        out.victimReachable = !!(hit && (hit === victim || victim.contains(hit)));
      }
      return out;
    });

    assert.ok(result.apiPresent, '__mlsGetPhone.show() is gone — the card this suite guards no longer exists');
    assert.ok(result.cardShown, 'precondition: the card must actually render, or this suite grades nothing');

    /* THE GEOMETRIC INVARIANT — needs no compositing, so it can never be
       defeated by a sleepy instrument. The 299px version put its top edge at
       y=486 with the button at 547..581; anything that overlaps fails. */
    assert.strictEqual(result.rectOverlap, false,
      'THE CARD IS BACK OVER THE PULL BUTTON. card=' + JSON.stringify(result.card) +
      ' overlaps the control at 1104,547 111x34. It is anchored bottom:16px, so every line added ' +
      'to it grows UPWARD into the workspace.');
    assert.ok(result.gapPx >= 8,
      'only ' + result.gapPx + 'px of clearance above the control — too thin to survive a font or ' +
      'zoom change; the 3px version of this fix was rejected for the same reason');

    /* A cap is not a fix if it hides the way out. */
    assert.strictEqual(result.clipped, false,
      'the card is clipped by its own height cap — the first attempt at this fix cut off "Got it", ' +
      'so the clinician could not dismiss the thing covering their controls');
    assert.ok(result.buttons.length >= 2, 'the card must still offer Copy link and Got it');
    for (const b of result.buttons) {
      assert.ok(b.inside, 'the "' + b.t + '" button is outside the visible card — an unreachable control');
      assert.ok(b.h >= 30, 'the "' + b.t + '" button is only ' + b.h + 'px tall');
    }

    /* THE HIT TEST, believed only once the instrument proved itself. */
    assert.ok(result.instrumentReady,
      'elementFromPoint never resolved the card to itself, so no hit-test verdict here can be ' +
      'trusted — REFUSING to grade rather than reporting a false pass');
    assert.strictEqual(result.victimReachable, true,
      'a finger aimed at the pull button lands on "' + result.victimHit + '" instead');

    console.log('PASS a floating card never covers a control: at 1280x800 (the MacBook Air 13" default) ' +
      'the desktop phone card measures ' + result.card[2] + 'x' + result.card[3] + ' with ' + result.gapPx +
      'px of clearance above the pull button, nothing of it is clipped, both of its own buttons are ' +
      'inside it and >=30px, and elementFromPoint — asserted ready first — puts a finger on the button ' +
      'and not on the card. The runtime guard (controlCoveredBy/settleThenYield) is present and does ' +
      'NOT depend on elementFromPoint, so it cannot fail open on the tick it runs.');
  } catch (e) {
    failure = e;
  } finally {
    await browser.close();
    server.close();
  }
  if (failure) { console.error(failure && failure.message ? failure.message : failure); process.exit(1); }
})();
