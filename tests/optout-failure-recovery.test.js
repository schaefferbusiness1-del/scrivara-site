'use strict';
/*
 * best-doctors-optout.html is where a patient withdraws their visit from the
 * aggregate rating. It is the one page on the site where a failure that looks
 * cosmetic is a consent failure: if the page says the choice cannot be made and
 * leaves nothing to press, the patient closes the tab and the visit keeps
 * counting.
 *
 * The shipped page did exactly that. Its request chain was
 *   .then(r => r.ok ? r.json() : null, () => null)
 * so a dropped connection, a 500, and a genuinely retired token all arrived as
 * null and all printed "This link is no longer valid." - a permanent-sounding
 * verdict for a transient fault - after replacing every control on the page.
 * The save path had the same shape and, on failure, printed "Something went
 * wrong. Please try again later." with no button left to try again with.
 *
 * This suite executes the page's real script against scripted responses. It is
 * behavioural on purpose: the previous copy read fine in review, and only
 * driving the branches showed that two of them were unreachable-by-design dead
 * ends. Static string assertions would not have caught it.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PAGE = path.join(path.resolve(__dirname, '..'), 'best-doctors-optout.html');
const html = fs.readFileSync(PAGE, 'utf8');
const blocks = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
assert(blocks.length, 'opt-out page must carry its inline workflow script');
const code = blocks[blocks.length - 1][1];
const TOKEN = 'a'.repeat(48); /* visitRatings.newToken(): 24 random bytes, lowercase hex */

function run(plan) {
  const els = {};
  const el = (id) => (els[id] || (els[id] = { id, innerHTML: '', textContent: '', disabled: false, onclick: null }));
  const body = el('body');
  /* Must answer null for controls the current markup does not contain, or
   * "did the page leave the patient anything to press?" cannot be asked. */
  const present = (id) => (id === 'body' ? true : new RegExp('id="' + id + '"').test(body.innerHTML));
  const calls = [];
  const sandbox = {
    window: { __mlsSensitiveUrl: { query: { t: TOKEN } } },
    document: { getElementById: (id) => (present(id) ? el(id) : null) },
    encodeURIComponent,
    mlsSensitiveFetch: (url, opts) => {
      calls.push((opts && opts.method) || 'GET');
      const step = plan.shift();
      assert(step, 'page issued more requests than the scenario scripted');
      if (step.reject) return Promise.reject(new Error('unreachable'));
      return Promise.resolve({
        ok: step.status >= 200 && step.status < 300,
        status: step.status,
        json: () => (step.bad ? Promise.reject(new Error('unreadable')) : Promise.resolve(step.json)),
      });
    },
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return {
    calls,
    text: () => body.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    has: present,
    click(id) { assert(present(id), 'expected a #' + id + ' control to press, page showed: ' + this.text()); return el(id).onclick(); },
  };
}

const settle = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
const LOADED = { status: 200, json: { ok: true, doctor: 'Dr Reyes' } };
const SAVED = { status: 200, json: { ok: true } };

(async () => {
  /* 1. Cannot reach MLS while loading: recoverable, and never dressed up as a
   *    dead link. */
  let s = run([{ reject: true }]);
  await settle();
  assert(!/no longer valid/i.test(s.text()), 'an unreachable backend must not be reported as an invalid link: ' + s.text());
  assert(s.has('again'), 'unreachable load must leave a way to retry: ' + s.text());

  /* 2. That retry must actually re-issue the request and recover. */
  s = run([{ reject: true }, LOADED]);
  await settle();
  s.click('again');
  await settle();
  assert(s.has('go'), 'retry after an unreachable load must reach the real choice: ' + s.text());
  assert.deepStrictEqual(s.calls, ['GET', 'GET'], 'retry must reuse the same request site');

  /* 3. Server trouble is transient, not a verdict on the link. */
  s = run([{ status: 503 }]);
  await settle();
  assert(!/no longer valid/i.test(s.text()), '5xx must not be reported as an invalid link: ' + s.text());
  assert(s.has('again'), '5xx must leave a way to retry: ' + s.text());

  /* 4. A retired token is permanent - no false hope, and a route forward. */
  for (const dead of [{ status: 410 }, { status: 404 }, { status: 200, json: { ok: false } }]) {
    s = run([dead]);
    await settle();
    assert(/no longer valid/i.test(s.text()), 'a retired token must be stated plainly: ' + s.text());
    assert(!s.has('again'), 'a retired token must not offer a retry that cannot work: ' + s.text());
    assert(/ask for a new one/i.test(s.text()), 'a retired token must say how to get a working link: ' + s.text());
  }

  /* 5. The consent-critical chain: a failed save must never read as success,
   *    and must stay recoverable. */
  s = run([LOADED, { reject: true }, SAVED]);
  await settle();
  assert(s.has('go'), 'loaded page must offer the exclude control: ' + s.text());
  s.click('go');
  await settle();
  assert(/not been excluded yet/i.test(s.text()), 'a failed save must say the visit is still included: ' + s.text());
  assert(!/thank you/i.test(s.text()), 'a failed save must not read as a confirmation: ' + s.text());
  assert(s.has('again'), 'a failed save must leave a way to retry: ' + s.text());
  s.click('again');
  await settle();
  assert(/will not contribute to any rating/i.test(s.text()), 'retrying a failed save must be able to succeed: ' + s.text());
  assert.deepStrictEqual(s.calls, ['GET', 'POST', 'POST'], 'save retry must reuse the same request site');

  /* 6. An unreadable body is trouble, never a silent success. */
  s = run([{ status: 200, bad: true }]);
  await settle();
  assert(s.has('again') && !/Done/i.test(s.text()), 'an unreadable answer must be recoverable, not confirmed: ' + s.text());

  /* The page is pinned to exactly two sensitive fetch call sites by
   * sensitive-public-workflows-boundary; every retry above therefore has to go
   * back through one of them rather than adding a third. */
  assert.strictEqual((html.match(/\bmlsSensitiveFetch\s*\(/g) || []).length, 2,
    'retry must reuse the existing request sites, not add new ones');

  console.log('PASS opt-out failure recovery: transient faults stay recoverable, retired links stay honest, a failed save never reads as consent withdrawn');
})();
