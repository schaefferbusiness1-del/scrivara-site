'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const previewHref = 'ScribeFlow.html?preview=1';
const previewLabel = 'Explore a sample day';
const previewHelper = 'No account · invented patients · nothing connects or sends';

const previewLinks = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
  .filter((match) => new RegExp(`\\bhref=["']${previewHref.replace(/[?.]/g, '\\$&')}["']`, 'i').test(match[1]));

assert(previewLinks.length >= 3, 'homepage must surface the self-guided sample in the hero, walkthrough, and final CTA');
for (const link of previewLinks) {
  assert.strictEqual(link[2].replace(/<[^>]+>/g, '').trim(), previewLabel, 'every public preview link needs the explicit sample-day label');
  assert(!/\btarget\s*=\s*["']_blank["']/i.test(link[1]), 'sample-day preview must open in the same browser tab');
}

assert(html.includes(previewHelper), 'homepage must state that the self-guided sample needs no account and cannot connect or send');
assert(!html.includes('See it on a real visit'), 'homepage must not describe the synthetic preview as a real visit');

const demo = html.match(/<section id="demo"[\s\S]*?<\/section>/i);
assert(demo, 'guided demo section is missing');
assert(demo[0].includes('Walk through a sample visit'), 'walkthrough must be labeled as a sample visit');
assert(/same Today workspace with invented patients/i.test(demo[0]), 'walkthrough must explain that it opens the same Today workspace with invented patients');
assert(/Athena, cloud storage, sending, and signing stay off/i.test(demo[0]), 'walkthrough must explicitly keep Athena, cloud storage, sending, and signing off');
assert(!/\b(?:HIPAA[- ]compliant|production[- ]ready|ready for real patient|live Athena)\b/i.test(demo[0]), 'walkthrough must not claim clinical readiness');

assert(/href=["']#demo["'][^>]*>Book a 20-minute demo<\/a>/i.test(html), 'guided Book a 20-minute demo pathway must remain available');
assert(/<form class="demo-form"[^>]*onsubmit="return submitDemo\(event\)"/i.test(html), 'guided demo request form must remain wired');
assert(/<button class="btn btn-primary" type="submit">Request my demo<\/button>/i.test(html), 'guided demo form submit action must remain visible');

console.log(`PASS homepage self-guided preview: ${previewLinks.length} safe sample-day CTAs plus preserved guided demo`);
