'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'expert.html'), 'utf8');

assert(html.includes('href="fonts/fonts.css"'), 'expert profile must load the shared MLS fonts');
assert(html.includes('<meta name="theme-color" content="#204034">'), 'expert profile theme must use MLS deep green');
assert(html.includes("--serif:'Newsreader'"), 'expert profile must use Newsreader headings');
assert(html.includes("--sans:'Public Sans'"), 'expert profile must use Public Sans body text');
assert(html.includes('--paper:#FBFAF7') && html.includes('--deep:#204034'), 'expert profile is missing the portal palette');
assert(html.includes('<b>MLS Scribe</b><span class="tagpill">For Attorneys</span>'), 'expert header must match the attorney portal lockup');

assert.strictEqual((html.match(/>Request this expert</g) || []).length, 1, 'expert request needs one profile-level primary action');
assert(html.includes('class="aside-kicker">What happens next'), 'engagement card must explain the next step instead of duplicating the request button');
assert(html.includes('Stripe-confirmed payment unlocks the full signed report in the portal'), 'engagement flow must explain payment continuity');

assert(html.includes('class="profile-skeleton"'), 'expert profile needs a layout-stable loading skeleton');
assert(html.includes('role="status" aria-live="polite" aria-busy="true"'), 'loading state must be announced accessibly');
assert(html.includes("setAttribute('aria-busy','false')"), 'loading and error states must settle their busy status');
assert(html.includes('@media(prefers-reduced-motion:reduce)'), 'loading animation must respect reduced-motion preferences');

for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=|application\/ld\+json/i.test(match[1])) continue;
  new Function(match[2]); // eslint-disable-line no-new-func
}

console.log('PASS expert profile: portal-aligned design, one primary request action, stable accessible loading states');
