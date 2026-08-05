'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const bootstrapPath = path.join(root, 'sensitive-workflow-bootstrap.js');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const pages = {
  'appointment.html': { fetches: 3, required: ['query.t'] },
  'best-doctors-optout.html': { fetches: 2, required: ['query.t', 'query.token'], strictToken: true },
  'booking.html': { fetches: 3, required: ['query.token'] },
  'intake.html': { fetches: 2, required: ['query.token', 'query.intake'] },
  /* 7 at tv-1.0.0 (2026-08-05): the post-op video lane adds one wrapped call
     site — its api() helper — which fans out to eligibility/request/status/
     cancel/ice/signal. */
  'patient-portal.html': { fetches: 7, required: ['query.invite', 'fragment.session', 'fragment.claim', 'fragment.setup'] },
  'send-portal-invite.html': { fetches: 3, required: [], scrubAll: true }
};

for (const [name, contract] of Object.entries(pages)) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  const head = (html.match(/<head>[\s\S]*?<\/head>/i) || [''])[0];
  assert(head, `${name}: missing head`);
  assert(/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*noarchive[^"']*["']/i.test(head), `${name}: robots must be noindex + noarchive`);
  assert(/<meta\s+name=["']referrer["']\s+content=["']no-referrer["']/i.test(head), `${name}: no-referrer meta is missing`);
  assert(/http-equiv=["']Cache-Control["'][^>]+content=["'][^"']*no-store/i.test(head), `${name}: no-store navigation hint is missing`);
  assert(/http-equiv=["']Pragma["'][^>]+content=["']no-cache["']/i.test(head), `${name}: no-cache compatibility hint is missing`);

  const loader = head.match(/<script\b[^>]*src=["']sensitive-workflow-bootstrap\.js\?v=20260718["'][^>]*><\/script>/i);
  assert(loader, `${name}: synchronous sensitive URL bootstrap is missing from head`);
  assert(/referrerpolicy=["']no-referrer["']/i.test(loader[0]), `${name}: bootstrap request may not send a referrer`);
  assert(/data-query-keys=/.test(loader[0]) && /data-fragment-keys=/.test(loader[0]), `${name}: sensitive URL keys are not declared`);
  if (contract.scrubAll) {
    assert(/data-scrub-query=["']all["']/.test(loader[0]), `${name}: every query value must be discarded`);
    assert(/data-scrub-fragment=["']all["']/.test(loader[0]), `${name}: every fragment value must be discarded`);
  }
  if (contract.strictToken) {
    assert(/\/\^\[a-f0-9\]\{48\}\$\//.test(html), `${name}: token must match the backend's exact 24-byte lowercase-hex format`);
  }

  assert(!/\bfetch\s*\(/.test(html), `${name}: raw fetch bypasses the no-store/no-referrer wrapper`);
  assert.strictEqual((html.match(/\bmlsSensitiveFetch\s*\(/g) || []).length, contract.fetches, `${name}: sensitive fetch coverage drift`);
  assert(!/new\s+URLSearchParams\s*\(\s*location\.(?:search|hash)/.test(html), `${name}: URL secrets are read after the head scrub`);

  const boundaryTags = html.match(/<div\b[^>]*data-mls-synthetic-boundary=["']1["'][^>]*>/gi) || [];
  assert.strictEqual(boundaryTags.length, 1, `${name}: exactly one synthetic-evaluation boundary is required`);
  assert(/role=["']note["']/.test(boundaryTags[0]) && /aria-label=["']Synthetic evaluation only["']/.test(boundaryTags[0]), `${name}: boundary semantics are missing`);
  assert(!/(?:display\s*:\s*none|\bhidden\b|class=["'][^"']*hide)/i.test(boundaryTags[0]), `${name}: evaluation boundary is not visibly rendered`);
  const boundaryIndex = html.indexOf(boundaryTags[0]);
  assert(boundaryIndex > html.search(/<body\b/i), `${name}: boundary must be in the body`);
  const firstForm = html.search(/<form\b/i);
  if (firstForm >= 0) assert(boundaryIndex < firstForm, `${name}: boundary must appear before the first real-data form`);
  assert(html.includes('<strong>Synthetic evaluation only.</strong> Use fictional information; do not enter real patient or clinical data.'), `${name}: calm evaluation copy drifted`);

  assert(!/(?:Network error|Network problem|RESEND_API_KEY|MAIL_FROM|known owner-lookup bug|PORTAL-SESSION|cross-site cookies)/i.test(html), `${name}: technical jargon remains in user-visible copy`);
  for (const unsafeEcho of ['textContent=(res.j', 'showMsg((res.j', 'perr((res.j', 'err((res.j', 'fail((res.j', "body('⏳ '+(((res.j"]) {
    assert(!html.includes(unsafeEcho), `${name}: backend error text can still be echoed to the user`);
  }
  for (const ref of contract.required) {
    const [bucket, key] = ref.split('.');
    assert(new RegExp(`__mlsSensitiveUrl[^\\n]{0,160}${bucket}[^\\n]{0,160}${key}`).test(html) ||
      new RegExp(`portalBoot\\.${bucket}[^\\n]{0,80}${key}`).test(html) ||
      new RegExp(`captured\\.${key}`).test(html), `${name}: downstream flow lost captured ${ref}`);
  }
}

const invitePage = fs.readFileSync(path.join(root, 'send-portal-invite.html'), 'utf8');
assert(!/id=["']diag["']/.test(invitePage), 'invite diagnostics must not render in the clinician UI');
assert(/function diag\(t\)\{[^}]*console\.warn/.test(invitePage), 'invite diagnostics must remain available in the console');

assert(/options\.cache\s*=\s*['"]no-store['"]/.test(bootstrap), 'fetch wrapper must force cache:no-store');
assert(/options\.referrerPolicy\s*=\s*['"]no-referrer['"]/.test(bootstrap), 'fetch wrapper must force referrerPolicy:no-referrer');
assert(bootstrap.indexOf('history.replaceState') < bootstrap.indexOf('window.__mlsSensitiveUrl'), 'URL must be scrubbed before captured values are exposed downstream');

function runBootstrap(initialUrl, dataset) {
  let current = new URL(initialUrl);
  const replacements = [];
  const calls = [];
  const location = {};
  for (const key of ['href', 'pathname', 'search', 'hash']) {
    Object.defineProperty(location, key, { enumerable: true, get: () => current[key] });
  }
  const window = {
    location,
    history: {
      replaceState(_state, _title, target) {
        replacements.push(String(target));
        current = new URL(String(target), current.origin);
      }
    },
    fetch(input, init) {
      calls.push({ input: String(input), init });
      return Promise.resolve({ ok: false, status: 404 });
    }
  };
  const context = {
    window,
    document: { currentScript: { dataset } },
    URL,
    URLSearchParams,
    Object,
    Promise
  };
  vm.runInNewContext(bootstrap, context, { filename: 'sensitive-workflow-bootstrap.js' });
  return { window, calls, replacements, href: () => current.href };
}

(async function runtimeProof() {
  const one = runBootstrap(
    'https://mlsscribe.com/appointment.html?t=SYNTH_APPT_SECRET&code=SYNTH_CODE&safe=calendar#claim=SYNTH_CLAIM&tab=records',
    { queryKeys: 't token intake code invite', fragmentKeys: 'session claim setup token code invite' }
  );
  assert.strictEqual(one.window.__mlsSensitiveUrl.query.t, 'SYNTH_APPT_SECRET');
  assert.strictEqual(one.window.__mlsSensitiveUrl.query.code, 'SYNTH_CODE');
  assert.strictEqual(one.window.__mlsSensitiveUrl.fragment.claim, 'SYNTH_CLAIM');
  assert.strictEqual(one.href(), 'https://mlsscribe.com/appointment.html?safe=calendar#tab=records');
  assert.strictEqual(one.replacements.length, 1, 'sensitive URL should be replaced exactly once');

  await one.window.mlsSensitiveFetch('https://scrivara-backend.onrender.com/api/synthetic', {
    method: 'POST', cache: 'force-cache', referrerPolicy: 'origin', body: '{}'
  });
  assert.strictEqual(one.calls.length, 1);
  assert.strictEqual(one.calls[0].init.method, 'POST');
  assert.strictEqual(one.calls[0].init.cache, 'no-store');
  assert.strictEqual(one.calls[0].init.referrerPolicy, 'no-referrer');

  const all = runBootstrap(
    'https://mlsscribe.com/send-portal-invite.html?email=synthetic%40invalid.test&patient=SYNTHETIC#code=SYNTH_CODE&debug=1',
    {
      queryKeys: '', fragmentKeys: '',
      scrubQuery: 'all', scrubFragment: 'all'
    }
  );
  assert.strictEqual(all.href(), 'https://mlsscribe.com/send-portal-invite.html');
  assert.deepStrictEqual(Object.keys(all.window.__mlsSensitiveUrl.query), []);
  assert.deepStrictEqual(Object.keys(all.window.__mlsSensitiveUrl.fragment), []);

  const anchor = runBootstrap(
    'https://mlsscribe.com/appointment.html?safe=one%20two#records',
    { queryKeys: 't token code invite', fragmentKeys: 'token code invite' }
  );
  assert.strictEqual(anchor.href(), 'https://mlsscribe.com/appointment.html?safe=one%20two#records', 'safe URL values must not be normalized or removed');
  assert.strictEqual(anchor.replacements.length, 0, 'a safe URL must not be rewritten');

  console.log(`PASS sensitive public workflows: ${Object.keys(pages).length} pages, immediate URL scrub and private fetch runtime verified`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
