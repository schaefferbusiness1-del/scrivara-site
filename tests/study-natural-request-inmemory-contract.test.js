'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const asset = path.join(__dirname, '..', 'feat_mls_study_request.js');
const study = require(asset);
const source = fs.readFileSync(asset, 'utf8');

assert.match(source, /sg\.analyze\(inMemoryGroup\)/);
assert.match(source, /sg\.chartSVG\(analysis\)/);
assert.match(source, /inMemory:\s*true/);
assert.doesNotMatch(source, /sg\.createGroup\s*\(/);
assert.doesNotMatch(source, /sg\.addPatient\s*\(/);
assert.doesNotMatch(source, /sg\.runStudy\s*\(/);
assert.doesNotMatch(source, /sgRef\.deleteGroup\s*\(/);
assert.match(source, /promiseWithTimeout/);
assert.match(source, /pdf-loader-timeout/);
assert.match(source, /var deadline = setTimeout\(function \(\) \{ finish\(false,/,
  'the standalone CDN script must have a terminal timeout');
assert.match(source, /if \(uiRunPromise\)[\s\S]{0,240}return uiRunPromise;/,
  'repeated Enter/click submissions must return the one in-flight UI promise');

(async () => {
  const previous = global.loadJsPdf;
  global.loadJsPdf = () => new Promise(() => {});
  const started = Date.now();
  await assert.rejects(
    study.getJsPDF({ dependencyTimeoutMs: 25 }),
    (error) => error && error.code === 'pdf-loader-timeout' && /did not finish loading/i.test(error.message)
  );
  assert.ok(Date.now() - started < 500, 'a stuck shared dependency loader must terminate promptly');
  if (previous === undefined) delete global.loadJsPdf;
  else global.loadJsPdf = previous;
  console.log('study-natural-request-inmemory-contract: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
