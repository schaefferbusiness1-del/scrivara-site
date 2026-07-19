'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'expert-marketplace-ui.js'), 'utf8');
const pages = ['ScribeFlow.html', 'ScribeFlow-staging.html'];

function between(source, begin, end) {
  const start = source.indexOf(begin);
  assert(start >= 0, `missing source marker: ${begin}`);
  const stop = source.indexOf(end, start + begin.length);
  assert(stop > start, `missing source end marker: ${end}`);
  return source.slice(start, stop);
}

function buttonById(html, id) {
  const match = html.match(new RegExp(`<button\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?<\\/button>`, 'i'));
  assert(match, `missing ${id}`);
  return match[0];
}

new Function(editor); // eslint-disable-line no-new-func

assert.strictEqual((editor.match(/\bfetch\s*\(/g) || []).length, 1,
  'doctor-facing editor must route every request through the hardened wrapper');
for (const required of [
  "request.cache = 'no-store'",
  "request.credentials = 'omit'",
  "request.referrerPolicy = 'no-referrer'",
  "p.public_ready === true && p.publication_status === 'released'",
  "typeof STATE.profile.public_url === 'string'",
  'rel="noopener noreferrer"',
  'Synthetic evaluation only',
  'Request independent review for public release',
  'No public review requested',
  'Review requested. This draft is not public',
  'Released after independent review'
]) assert(editor.includes(required), `editor is missing release/security contract: ${required}`);

for (const forbidden of [
  /you are listed/i,
  /list me publicly/i,
  /advertise yourself/i,
  /build my advertisement/i,
  /board-certified/i,
  /24-hour reports/i,
  /reports in 24h/i,
  /generate-bio/i,
  /mxPhotoFile/,
  /mxDocFile/,
  /downloadable from your public/i,
  /de-identified sample report/i
]) assert(!forbidden.test(editor), `editor retains misleading or real-data solicitation: ${forbidden}`);

assert(editor.includes("STATE.profile.public_url = isReleased(d) && typeof d.public_url === 'string' ? d.public_url : ''"),
  'save response can retain a stale public URL after publication is invalidated');

function makeRuntime(source, page) {
  const nodes = {
    expertBody: { innerHTML: '' },
    expListed: { checked: true },
    expSpec: { value: 'Synthetic specialty' },
    expJur: { value: 'ZZ' },
    expBio: { value: 'Invented evaluation summary' }
  };
  const calls = [];
  const toasts = [];
  const context = {
    Promise,
    Array,
    JSON,
    document: { getElementById(id) { return nodes[id] || null; } },
    bkBase() { return 'https://backend.invalid'; },
    bkToken() { return 'synthetic-token'; },
    // Exercise the dormant implementation explicitly; production holds this
    // helper false behind an immutable release boundary.
    publicExpertWorkspaceReleased() { return true; },
    esc(value) { return String(value == null ? '' : value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
    toast(text, kind) { toasts.push({ text, kind }); },
    async fetch(url, opts) {
      calls.push({ url, opts: opts || {} });
      const posted = opts && opts.method === 'POST';
      const data = posted
        ? { ok: true, listed: nodes.expListed.checked, public_ready: false, publication_status: nodes.expListed.checked ? 'pending_review' : 'not_requested' }
        : { listed: nodes.expListed.checked, public_ready: false, publication_status: nodes.expListed.checked ? 'pending_review' : 'not_requested', specialty: '', jurisdiction: '', bio: '' };
      return { ok: true, async json() { return data; } };
    }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: page });
  return { context, nodes, calls, toasts };
}

(async function run() {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const subscribe = buttonById(html, 'lawSubscribeBtn');
    const submit = buttonById(html, 'lawSubmitBtn');
    assert(/\bdisabled\b/i.test(subscribe) && /Subscription unavailable/i.test(subscribe) && !/onclick=/i.test(subscribe),
      `${page} exposes the legal subscription action`);
    assert(/\bdisabled\b/i.test(submit) && /Request submission unavailable/i.test(submit) && !/onclick=/i.test(submit),
      `${page} exposes real legal request submission`);

    const lawyerCard = between(html, '<div class="card" id="lawBillingCard"', '<div class="card" style="margin-top:20px" id="lawExpertCard">');
    for (const required of ['Synthetic request draft', 'invented details', 'No file intake', 'Submission and payment unavailable', 'no name, DOB, claim, or PHI']) {
      assert(lawyerCard.includes(required), `${page} request draft is missing boundary copy: ${required}`);
    }
    assert(!/Subscribe\s*[—-]\s*\$5|Submit request|After submitting/i.test(lawyerCard),
      `${page} still markets subscription or request submission`);

    const browseCard = between(html, '<div class="card" style="margin-top:20px" id="lawExpertCard">', '<div class="card" style="margin-top:20px">');
    for (const required of ['Released expert profiles', 'does not confirm availability', 'cannot start case intake']) {
      assert(browseCard.includes(required), `${page} released-profile card is missing: ${required}`);
    }

    const billingFn = between(html, 'async function lawyerSubscribe()', '/* ===== Receptionist front-desk mode');
    const submitFn = between(html, 'async function submitLegalRequest()', '/* ---- Lawyer portal: load + render "My requests" ---- */');
    const browseFn = between(html, '/* ===== Attorney side: browse the expert marketplace ===== */', 'async function loadLawyerRequests()');
    const profileFn = between(html, '/* ===== Expert marketplace — doctor opt-in ===== */', '/* ===== Stripe Connect');

    assert(!/fetch\s*\(|billing\/checkout|lawyer_monthly/i.test(billingFn), `${page} subscription stub can still reach checkout`);
    assert(!/fetch\s*\(|api\/legal\/request|target_email|offer_cents/i.test(submitFn), `${page} request stub can still submit case data`);
    assert(!/window\.prompt|api\/experts\/['"+]|request sent to/i.test(browseFn), `${page} expert browse retains hidden case intake`);
    for (const required of ["cache:'no-store'", "credentials:'omit'", "referrerPolicy:'no-referrer'", 'No independently released expert profiles', 'Availability is not confirmed']) {
      assert(browseFn.includes(required), `${page} expert browse is missing fail-closed contract: ${required}`);
    }
    for (const required of ['public_ready===true', "publication_status==='released'", 'Review requested. This profile is not public.', 'No public review requested.', 'does not publish the profile']) {
      assert(profileFn.includes(required), `${page} legacy profile is missing status contract: ${required}`);
    }
    assert(!/Discoverable to attorneys now|Listed in the expert marketplace|Save listing|Board certifications/i.test(profileFn),
      `${page} legacy profile retains immediate-publication language`);
    assert.strictEqual((profileFn.match(/cache:'no-store'/g) || []).length, 2, `${page} legacy profile fetches are not both no-store`);
    assert.strictEqual((profileFn.match(/credentials:'omit'/g) || []).length, 2, `${page} legacy profile fetches can send cookies`);
    assert.strictEqual((profileFn.match(/referrerPolicy:'no-referrer'/g) || []).length, 2, `${page} legacy profile fetches can disclose a referrer`);

    const rt = makeRuntime(profileFn, page);
    rt.context.renderExpertProfile({ listed: false, public_ready: false, publication_status: 'not_requested', specialty: '', jurisdiction: '', bio: '' });
    assert(rt.nodes.expertBody.innerHTML.includes('No public review requested.'), `${page} not-requested status is wrong at runtime`);
    rt.context.renderExpertProfile({ listed: true, public_ready: false, publication_status: 'pending_review', specialty: '', jurisdiction: '', bio: '' });
    assert(rt.nodes.expertBody.innerHTML.includes('Review requested. This profile is not public.'), `${page} pending status is wrong at runtime`);
    rt.context.renderExpertProfile({ listed: true, public_ready: true, publication_status: 'released', specialty: '', jurisdiction: '', bio: '' });
    assert(rt.nodes.expertBody.innerHTML.includes('Independently reviewed and released.'), `${page} released status is wrong at runtime`);

    rt.nodes.expListed.checked = true;
    await rt.context.saveExpertProfile();
    await Promise.resolve();
    const post = rt.calls.find(call => call.opts.method === 'POST');
    assert(post, `${page} save runtime did not issue the profile request`);
    assert.strictEqual(post.opts.cache, 'no-store');
    assert.strictEqual(post.opts.credentials, 'omit');
    assert.strictEqual(post.opts.referrerPolicy, 'no-referrer');
    assert(rt.toasts.some(t => /review requested; this profile is not public/i.test(t.text)), `${page} save toast claims immediate publication`);
  }

  console.log('PASS expert marketplace review boundary: private draft, pending review, exact release status, no live intake/checkout, hardened fetches');
})().catch(err => { console.error(err); process.exit(1); });
