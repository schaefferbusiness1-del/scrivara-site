'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
assert(/<title>MLS Assist<\/title>/i.test(html), 'extension popup lacks a descriptive document title');

for (const id of ['bkTime', 'key', 'backend']) {
  assert(new RegExp(`<label[^>]*\\bfor=["']${id}["']`, 'i').test(html),
    `extension popup input #${id} lacks an explicit label`);
}
for (const id of ['conn', 'bkStatus', 'ok']) {
  const tag = html.match(new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`, 'i'))?.[0] || '';
  assert(/\brole=["']status["']/i.test(tag) && /\baria-live=["']polite["']/i.test(tag),
    `extension popup status #${id} is not announced accessibly`);
}

function luminance(hex) {
  const values = hex.match(/[0-9a-f]{2}/ig).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}
function ratio(a, b) {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

assert(ratio('5F6B64', 'FFFFFF') >= 4.5, 'muted popup text fails 4.5:1 on white');
assert(ratio('5F6B64', 'FBFAF7') >= 4.5, 'muted popup text fails 4.5:1 on the popup background');
assert(!/#79837C|#8A8F86/i.test(html), 'known low-contrast popup text color remains');

console.log('PASS extension popup labels, live status announcements, and text contrast');
