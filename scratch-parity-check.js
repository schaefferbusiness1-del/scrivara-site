/* Report which parity-pinned functions drifted between ScribeFlow.html and
   ScribeFlow-staging.html, using the suite's own extractor verbatim. */
const fs = require('fs');
const assert = require('assert');

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  let lineComment = false, blockComment = false, regex = false, regexClass = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (regex) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '[') regexClass = true;
      else if (ch === ']' && regexClass) regexClass = false;
      else if (ch === '/' && !regexClass) regex = false;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '/') {
      const before = source.slice(Math.max(brace, i - 32), i).trimEnd();
      const prev = before.slice(-1);
      if (!prev || /[({\[=,:;!?&|+*%^~<>-]/.test(prev) || /\b(?:return|case|throw|typeof|instanceof|delete|void|yield|await)$/.test(before)) {
        regex = true; regexClass = false; escaped = false; continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated function ' + name);
}
function normalized(fn) { return fn.replace(/\r\n/g, '\n').trim(); }

const prod = fs.readFileSync('ScribeFlow.html', 'utf8');
const staging = fs.readFileSync('ScribeFlow-staging.html', 'utf8');
const names = process.argv.slice(2);
for (const n of names) {
  let p = '', s = '', err = '';
  try { p = normalized(extractFunction(prod, n)); } catch (e) { err += ' prod:' + e.message; }
  try { s = normalized(extractFunction(staging, n)); } catch (e) { err += ' staging:' + e.message; }
  console.log(n + ' ' + (err ? ('ERR' + err) : (p === s ? 'SAME' : 'DRIFT prodLen=' + p.length + ' stagLen=' + s.length)));
}
