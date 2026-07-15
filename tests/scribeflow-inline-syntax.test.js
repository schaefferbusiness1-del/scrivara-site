'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const errors = [];
let count = 0, match;
while ((match = re.exec(html))) {
  if (/\bsrc\s*=/.test(match[1])) continue;
  const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i);
  if (type && !/^(?:text|application)\/(?:java|ecma)script$|^module$/i.test(type[1].trim())) continue;
  const code = match[2].replace(/^\s*<!--/, '').replace(/-->\s*$/, '');
  if (!code.trim()) continue;
  count++;
  try { Function(code); } catch (err) { errors.push('inline script ' + count + ': ' + err.message); }
}
assert(count > 0, 'no inline scripts were checked');
assert.deepStrictEqual(errors, [], errors.join('\n'));
console.log('PASS ScribeFlow inline syntax: ' + count + ' scripts compile');
