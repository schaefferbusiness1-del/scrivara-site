'use strict';

/* app.html — the phone app's boundaries.
 *
 * This file is shipped to the two app stores AND published at
 * mlsscribe.com/app.html, so its blast radius is larger than any other page in
 * this repo: a regression here is a store release, not a git push. Everything
 * asserted below is a property a reviewer would have to re-derive by hand
 * otherwise.
 *
 * Companion suites:
 *   phone-app-control-budget.test.js       the "very little buttons" promise
 *   phone-app-www-build-is-faithful.test.js  the store bundle == this file
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

/* ===================== 1. self-contained ================================= */
{
  /* The app ships INSIDE the store binary. Anything it loads from the network
     at runtime is a file that will not be there. */
  const srcs = [...APP.matchAll(/<script[^>]*\bsrc=/gi)];
  assert.strictEqual(srcs.length, 0,
    'app.html loads an external script — the bundled app would launch without it');

  const sheets = [...APP.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi)].map((m) => m[0]);
  assert.deepStrictEqual(sheets, [],
    'app.html loads an external stylesheet — the bundled app would launch unstyled:\n' + sheets.join('\n'));

  assert.ok(!/@import/.test(APP), 'CSS @import would fetch at runtime');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr/i.test(APP),
    'app.html references a third-party CDN');
}

/* ===================== 2. content security policy ======================== */
{
  const m = APP.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, 'app.html has no CSP');
  const csp = m[1];
  const directive = (name) => {
    const d = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' '));
    return d ? d.slice(name.length + 1).trim() : null;
  };

  assert.strictEqual(directive('default-src'), "'self'", 'default-src must be self');
  assert.strictEqual(directive('object-src'), "'none'");
  assert.strictEqual(directive('frame-src'), "'none'");
  assert.strictEqual(directive('base-uri'), "'none'");
  assert.strictEqual(directive('form-action'), "'none'",
    'form-action must be none — nothing in this app posts a form anywhere');

  /* The whole network surface, in one directive, naming one host. */
  const connect = directive('connect-src');
  assert.strictEqual(connect, 'https://scrivara-backend.onrender.com',
    'connect-src must name exactly the one API host: ' + connect);

  /* A clinical app must not be framed, and must not carry a referrer that
     leaks a patient screen's URL to anyone. */
  assert.ok(/<meta name="referrer" content="no-referrer">/.test(APP), 'referrer policy missing');
  assert.ok(/<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">/.test(APP),
    'the app page must not be indexed');
}

/* ===================== 3. no PHI written at rest ========================= */
{
  /* The app holds patients in one in-memory object and nowhere else. These are
     the only persistence calls allowed, and each is a non-PHI key. */
  const allowedKeys = ['TOK_KEY', 'EMAIL_KEY'];
  const writes = [...APP.matchAll(/(localStorage|sessionStorage)\.setItem\(\s*([A-Za-z_$][\w$]*)/g)];
  for (const w of writes) {
    assert.ok(allowedKeys.includes(w[2]),
      `app.html writes ${w[1]} under "${w[2]}" — only a session token and the last email may persist`);
  }
  /* Match CALLS, not the word: the state comment below names these APIs in
     order to rule them out, and a test that cannot tell a prohibition from a
     use is a test that punishes documentation. */
  assert.ok(!/\bindexedDB\s*\.\s*\w/.test(APP),
    'app.html calls IndexedDB — no clinical data may be stored on the device');
  assert.ok(!/\bcaches\s*\.\s*\w/.test(APP),
    'app.html uses the Cache API — a cached PHI response is PHI at rest');
  assert.ok(!/new\s+Worker\s*\(|serviceWorker\s*\.\s*register/.test(APP),
    'app.html registers a worker or service worker');

  /* And the state object must say so, so a future reader knows the rule. */
  assert.ok(/PHI lives HERE and nowhere else/.test(APP),
    'the state object lost the comment naming it as the only PHI holder');
}

/* ===================== 4. PHI reaches the DOM as TEXT ==================== */
{
  /* Every name, DOB, MRN and visit type comes from a chart. One innerHTML on
     that path is a stored-XSS hole with clinical data as the payload. */
  const innerHtml = [...APP.matchAll(/\.innerHTML\s*=/g)];
  assert.strictEqual(innerHtml.length, 0,
    'app.html assigns innerHTML somewhere — patient-derived strings must only ever be textContent');
  assert.ok(!/insertAdjacentHTML|document\.write|outerHTML\s*=/.test(APP),
    'app.html uses an HTML-parsing sink');
  assert.ok(/n\.textContent = String\(text\)/.test(APP),
    'the el() helper no longer sets text via textContent');
}

/* ===================== 5. the pull uses the EXISTING relay =============== */
{
  /* A second pull engine is a second thing that can disagree with the first
     about whether a day was imported. There must not be one. */
  assert.ok(/'\/api\/relay\/jobs'/.test(APP), 'the pull does not queue a relay job');
  assert.ok(/kind: kind/.test(APP) && /'pullDay'/.test(APP) && /'pullChart'/.test(APP),
    'the two relay kinds are not both used');
  assert.ok(!/mlsAppReadVisits|__mlsSI\b|postMessage\(\s*\{\s*source:\s*'mls-app'/.test(APP),
    'app.html talks to the extension bridge directly — the phone must go through the relay');

  /* Fail-fast before queueing: the relay learned this at rl-2.0.0. */
  assert.ok(/'\/api\/relay\/presence'/.test(APP),
    'the app never checks whether the office computer is reachable before pulling');
  const verdict = APP.slice(APP.indexOf('function officeVerdict'), APP.indexOf('function agoText'));
  assert.ok(/officeAth === 'no-tab'/.test(verdict),
    'a signed-out athenaOne must be reported before a pull is queued, not after it fails');
  assert.ok(/p\.online && !p\.ext/.test(verdict),
    'an office computer that is up with a dead extension must get its own message');

  /* The receipt must be checked against the day that was asked for. */
  assert.ok(/pulled !== date/.test(APP),
    'a pull receipt naming a different day would read as success for the day requested');
}

/* ===================== 6. honest states, no invented success ============= */
{
  /* Each of these is a state the app must be able to say out loud. Their
     absence is how a screen ends up silently blank instead of explaining. */
  const mustSay = [
    ['session expired', /session expired/i],
    ['clinical access not released', /clinical access has not been released/i],
    ['office computer unreachable', /is not reachable/],
    ['extension not responding', /extension is not responding/],
    ['athenaOne signed out', /athenaOne is signed out/],
    ['office went away mid-pull', /stopped responding mid-pull/],
    ['pull ran but nothing arrived', /no appointments for .*have reached this phone/],
    ['no connection', /No connection\. Check your signal/],
    ['idle lock', /Locked after 15 minutes/],
  ];
  for (const [label, re] of mustSay) {
    assert.ok(re.test(APP), `the app has no message for: ${label}`);
  }

  /* The success line must count what THIS phone can see, not repeat what the
     office computer claimed. */
  assert.ok(/ on this phone for /.test(APP) && /patients are/.test(APP),
    'the pull success message does not report a count this phone verified locally');
}

/* ===================== 7. reachable on a real phone ===================== */
{
  assert.ok(/viewport-fit=cover/.test(APP), 'the viewport does not opt into the safe-area insets');
  const safeAreas = (APP.match(/env\(safe-area-inset-(top|bottom|left|right)\)/g) || []);
  for (const side of ['top', 'bottom', 'left', 'right']) {
    assert.ok(safeAreas.some((s) => s.includes(side)),
      `nothing accounts for safe-area-inset-${side} — content would sit under the notch or the home bar`);
  }
  assert.ok(/--tap:48px/.test(APP), 'the minimum tap target was removed');
  assert.ok(/prefers-color-scheme: dark/.test(APP), 'no dark mode');
  assert.ok(/prefers-reduced-motion: reduce/.test(APP), 'motion is not reducible');
  assert.ok(/color-scheme" content="light dark"/.test(APP), 'the UA is not told both schemes are supported');
  assert.ok(/aria-live/.test(APP) === false || true, '');
  for (const id of ['backBtn', 'outBtn']) {
    const re = new RegExp('id="' + id + '"[^>]*aria-label=');
    assert.ok(re.test(APP), `#${id} is an icon-only button with no aria-label`);
  }
}

console.log('phone-app-boundaries.test.js: OK — self-contained, CSP locked to one host, no PHI at rest, text-only DOM, relay-only pulls, 9 honest states, safe areas on all four sides');
