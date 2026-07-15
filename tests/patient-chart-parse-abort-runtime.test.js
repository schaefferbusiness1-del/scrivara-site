'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function functionDecl(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `missing ${signature}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${signature}`);
}

async function verifyFile(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const parseDecl = functionDecl(source, 'async function _parsePatientChart');
  const aiDecl = functionDecl(source, 'async function aiCallRaw');
  assert(parseDecl.includes('{freeform:true,signal:opts.signal}'), `${file} parser did not forward AbortSignal`);
  assert.strictEqual((aiDecl.match(/signal:opts\.signal/g) || []).length, 3, `${file} did not attach AbortSignal to all three AI fetch routes`);

  let observedSignal = null;
  const context = {
    console, Promise, JSON, String, Object, Array, RegExp, AbortController,
    backendMode: () => true,
    bkBase: () => 'https://example.invalid',
    bkToken: () => 'token',
    getKey: () => '',
    fetch(_url, init) {
      observedSignal = init.signal;
      return new Promise((_resolve, reject) => {
        if (init.signal.aborted) { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); return; }
        init.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
      });
    }
  };
  vm.runInNewContext(`${aiDecl}\n${parseDecl}`, context, { filename: `${file}-abort.js` });
  const controller = new AbortController();
  const pending = context._parsePatientChart('Verified exact-patient chart text', { signal: controller.signal });
  assert.strictEqual(observedSignal, controller.signal, `${file} lost the exact AbortSignal before fetch`);
  controller.abort();
  const error = await pending.then(() => null, reason => reason);
  assert(error && error.name === 'AbortError', `${file} chart parse fetch did not abort`);
}

(async () => {
  await verifyFile('ScribeFlow.html');
  await verifyFile('ScribeFlow-staging.html');
  console.log('PASS patient chart parse AbortSignal parity in production and staging');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
