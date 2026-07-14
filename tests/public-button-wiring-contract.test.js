'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pages = [
  'index.html', 'booking.html', 'easy-book.html', 'patient-portal.html',
  'lawyers.html', 'expert.html', 'legal-connect.html', 'appointment.html',
  'intake.html', 'send-portal-invite.html', 'phone.html'
];

let handlers = 0;
const missing = [];
const deadLinks = [];

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  let corpus = html;
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const raw = m[1].split(/[?#]/)[0];
    if (/^(?:https?:)?\/\//i.test(raw)) continue;
    const file = path.resolve(path.dirname(path.join(root, page)), raw);
    if (file.startsWith(root + path.sep) && fs.existsSync(file)) corpus += '\n' + fs.readFileSync(file, 'utf8');
  }
  for (const m of html.matchAll(/\bonclick=["']\s*([A-Za-z_$][\w$]*)\s*\(/gi)) {
    handlers += 1;
    const name = m[1];
    const def = new RegExp(`(?:function\\s+${name}\\s*\\(|(?:window\\.)?${name}\\s*=)`);
    if (!def.test(corpus)) missing.push(`${page}: ${name}`);
  }
  for (const m of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (!/\bhref=["']#["']/i.test(attrs)) continue;
    if (!/\bonclick=|\brole=["']button["']/i.test(attrs)) deadLinks.push(`${page}: ${m[0].slice(0, 100)}`);
  }
}

assert.deepStrictEqual(missing, [], `Public buttons call missing handlers:\n${missing.join('\n')}`);
assert.deepStrictEqual(deadLinks, [], `Public pages contain dead # links:\n${deadLinks.join('\n')}`);
assert(handlers >= 20, 'expected to audit the public interactive controls');

console.log(`PASS public button wiring: ${handlers} inline controls across ${pages.length} non-extension pages`);
