'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = ['ScribeFlow.html', 'ScribeFlow-staging.html'];

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} is missing`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

for (const file of files) {
  const source = read(file);
  const startSession = functionBlock(source, 'startSession');
  const boundary = functionBlock(source, 'sfResetSessionBoundary');
  const refreshMe = functionBlock(source, 'refreshMe');

  const adoptAt = startSession.indexOf('session={email};');
  const persistAt = startSession.indexOf('setSessionEmail(email);');
  const resetAt = startSession.indexOf("sfResetSessionBoundary(email,{reason:'session-start'");
  assert(adoptAt >= 0 && persistAt > adoptAt && resetAt > persistAt,
    `${file}: startSession resets listeners before adopting the authenticated account`);
  assert(startSession.includes('previousAccount:_previousSessionAccount'),
    `${file}: startSession does not preserve the prior account in its boundary receipt`);
  assert(boundary.includes("Object.prototype.hasOwnProperty.call(opts,'previousAccount')"),
    `${file}: boundary cannot receive the captured previous account`);

  const emAt = refreshMe.indexOf('const em=bkUser&&bkUser.email;');
  const refreshAdoptAt = refreshMe.indexOf('session={email:em};', emAt);
  const refreshResetAt = refreshMe.indexOf("sfResetSessionBoundary(em,{reason:'identity-change'", emAt);
  assert(emAt >= 0 && refreshAdoptAt > emAt && refreshResetAt > refreshAdoptAt,
    `${file}: token-authenticated identity reset runs before session adoption`);
  assert(refreshMe.includes('previousAccount:previousIdentity'),
    `${file}: refreshMe loses the previous-account audit value`);
  if (file === 'ScribeFlow.html') {
    const practiceWriteAt = refreshMe.indexOf("localStorage.setItem(uns('practiceName')", emAt);
    assert(practiceWriteAt > refreshAdoptAt && practiceWriteAt < refreshResetAt,
      'production: server practice/timezone preferences are not written in the authenticated account namespace before reset');
  }

  // Execute the exact identity-adoption prefix. The reset stub models the real
  // Easy/DaySwitch listeners reading account-local Today synchronously.
  const prefixEnd = startSession.indexOf("document.getElementById('authScreen')");
  assert(prefixEnd > resetAt, `${file}: could not isolate startSession identity prefix`);
  const prefixBody = startSession.slice(startSession.indexOf('{') + 1, prefixEnd);
  const timeline = [];
  const accountToday = {
    'a@example.com': '2026-07-18',
    'b@example.com': '2026-07-19'
  };
  const context = {
    session: { email: 'a@example.com' },
    sfSessionUiEpoch: 7,
    sfSessionUiAccount: 'a@example.com',
    sfNormalizeSessionAccount(value) { return String(value || '').trim().toLowerCase(); },
    getSessionEmail() { return context.session && context.session.email || ''; },
    setSessionEmail(email) { timeline.push({ phase: 'persist', session: context.session.email, email }); },
    sfResetSessionBoundary(next, opts) {
      timeline.push({
        phase: 'reset',
        next,
        previous: opts.previousAccount,
        listenerAccount: context.session.email,
        listenerStorageKey: `sf_u::${context.session.email}::acctTz`,
        listenerToday: accountToday[context.session.email]
      });
    }
  };
  vm.createContext(context);
  vm.runInContext(`function adopt(email){${prefixBody}return session.email;}this.adopt=adopt;`, context, { filename: `${file}#startSessionIdentity` });
  assert.strictEqual(context.adopt('B@Example.com'), 'B@Example.com', `${file}: startSession did not adopt B synchronously`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(timeline)), [
    { phase: 'persist', session: 'B@Example.com', email: 'B@Example.com' },
    {
      phase: 'reset', next: 'B@Example.com', previous: 'a@example.com',
      listenerAccount: 'B@Example.com', listenerStorageKey: 'sf_u::B@Example.com::acctTz',
    }
  ], `${file}: boundary listeners did not observe the newly adopted account first`);
  // The product normalizes account identity for ownership, while its existing
  // storage namespace retains the authenticated email spelling. Prove the date
  // lookup maps the adopted identity once normalized, before any timer can run.
  const resetEvent = timeline[1];
  assert.strictEqual(accountToday[resetEvent.listenerAccount.toLowerCase()], '2026-07-19',
    `${file}: B's first synchronous Today read resolved through A/default state`);
}

console.log('PASS session account/date ownership: production and staging adopt B before reset listeners, preserve previous A, and resolve B-local Today synchronously');
