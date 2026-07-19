'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = ['ScribeFlow.html', 'ScribeFlow-staging.html'];
const automaticNotice = 'Add your OpenAI key in Settings to start generating notes.';
const actionNotice = 'Add your OpenAI API key in Settings to generate notes.';

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert(!source.includes(automaticNotice), `${file} still schedules the unsolicited startup AI-key toast`);
  assert(source.includes('onclick="generateNote()"'), `${file} lost the explicit Generate Note action`);
  assert.strictEqual(source.split(actionNotice).length - 1, 1, `${file} must retain one clear action-time AI configuration error`);
  const generateStart = source.indexOf('async function generateNote()');
  const actionError = source.indexOf(actionNotice, generateStart);
  assert(generateStart >= 0 && actionError > generateStart, `${file} action-time error must remain inside Generate Note`);
}

console.log('PASS AI-key guidance is action-time only in production and staging');
