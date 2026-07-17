'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const start = source.indexOf(' * __mlsUxPhoneMicRestore v1.0.0');
const end = source.indexOf(' * __mlsUxPatientsStability', start);
assert(start >= 0 && end > start, 'phone/paste capture lane is missing');
const lane = source.slice(start, end);

assert(lane.includes("var api = { ver: '1.0.1'"), 'centered capture lane version is not installed');
assert(lane.includes("row.style.setProperty('justify-content', 'center', 'important');"),
  'Phone mic and Paste transcript are not centered as one row');
assert(lane.includes("row.style.setProperty('flex-wrap', 'wrap', 'important');"),
  'capture actions cannot wrap cleanly on phone widths');
assert(lane.includes("row.style.setProperty('width', '100%', 'important');"),
  'capture row does not own the full available width');

assert(source.includes("#mlsEz3 .ez3-qchip.on.seen{opacity:1 !important;}"),
  'the highlighted patient can still be washed out by the seen-state opacity');
assert(source.includes('font-weight:800 !important;box-shadow:0 0 0 2px rgba(32,64,52,.24) !important;'),
  'the highlighted patient does not have a bold high-contrast selected state');

console.log('PASS Visit active controls: centered phone/paste row and bold selected patient');
