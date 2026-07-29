'use strict';

const fs = require('fs');
const path = require('path');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text was ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const root = path.join(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
let connect = fs.readFileSync(connectPath, 'latin1');
const cakeBytes = '\xF0\x9F\x8E\x82';

connect = replaceOnce(
  connect,
  "    try { [].forEach.call(document.querySelectorAll('span,em,i,b,div'), function (n) { if (n.childElementCount === 0 && /" + cakeBytes + "/.test(n.textContent || '') && (n.textContent || '').length < 30 && !n.classList.contains('mls-r44-bday')) n.classList.add('mls-r44-bday'); }); } catch (e) {}",
  "    try { if (!c.birthdays) [].forEach.call(document.querySelectorAll('span,em,i,b,div'), function (n) { if (n.childElementCount === 0 && /" + cakeBytes + "/.test(n.textContent || '') && (n.textContent || '').length < 30 && !n.classList.contains('mls-r44-bday')) n.classList.add('mls-r44-bday'); }); } catch (e) {}",
  'skip birthday classification while birthdays are visible'
);

fs.writeFileSync(connectPath, connect, 'latin1');

const testPath = path.join(root, 'tests', 'interaction-performance-contract.test.js');
let test = fs.readFileSync(testPath, 'utf8');

test = replaceOnce(
  test,
  "assert(messageFix.includes('function queue(node,deep)') && messageFix.includes('fix(batch[i].node,batch[i].deep)'), 'status text repair is not scoped to changed subtrees');",
  [
    "assert(messageFix.includes('function queue(node,deep)') && messageFix.includes('fix(batch[i].node,batch[i].deep)'), 'status text repair is not scoped to changed subtrees');",
    "assert(connect.includes(\"if (!c.birthdays) [].forEach.call(document.querySelectorAll('span,em,i,b,div')\"), 'visible birthdays still trigger a full-document classification scan every two seconds');"
  ].join('\n'),
  'pin default birthday scan stand-down'
);

fs.writeFileSync(testPath, test, 'utf8');
console.log('Patched ' + connectPath);
console.log('Patched ' + testPath);
