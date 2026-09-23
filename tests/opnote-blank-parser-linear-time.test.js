'use strict';
/* The op-note blank parser runs in linear time (opblank-2.0.0, b1294).
   opNoteBlankTokens is the ONE canonical blank count (chip, rail, ledger,
   save/PDF/Athena gates). Its [FILL: x] and double-brace patterns put a lazy
   group between two \s* runs: an unclosed "[FILL:" or "{{" followed by spaces
   took cubic time, so a hostile or mangled note - including one a surgeon
   returns - could freeze the owner's tab. Both are now linear scans. This
   proves (1) they return exactly what the old regexes returned, over random
   inputs built from the characters that matter, and (2) adversarial inputs of
   100k characters finish in milliseconds. The service's copy
   (scrivara-backend src/routes/opnoteBlanks.js) carries the same parity fuzz. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fnSrc(src, decl) {
  const at = src.indexOf(decl);
  assert(at >= 0, 'missing ' + decl);
  let d = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
  }
  throw new Error('unbalanced ' + decl);
}
/* The parser as it was, the two backtracking patterns included: the oracle. */
function reference(text) {
  var s = String(text || ''); var seen = {}; var out = []; var m;
  function add(key, label) { var k = String(key || '').toLowerCase(); if (!k || seen[k]) return; seen[k] = 1;
    out.push({ key: k, label: label || k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) }); }
  var re1 = /\[\[\s*([a-z0-9_]+)\s*\]\]/gi; while ((m = re1.exec(s))) add(m[1]);
  var re2 = /\[FILL:\s*([^\]]+?)\s*\]/gi; while ((m = re2.exec(s))) add(m[1].toLowerCase().replace(/[^a-z0-9]+/g, '_'), m[1]);
  var nd = 0, re3 = /\[not dictated\]/gi; while ((m = re3.exec(s))) { nd++; add('not_dictated_' + nd, 'Not dictated #' + nd); }
  var bl = 0, re4 = /(^|[^_])_{3,}(?!_)/g; while ((m = re4.exec(s))) { bl++; add('blank_line_' + bl, 'Blank #' + bl); }
  var re5 = /\[(?!\[)([A-Z][A-Z0-9 \/&-]{1,28}[A-Z0-9])\](?!\])/g; while ((m = re5.exec(s))) add(m[1].toLowerCase().replace(/[^a-z0-9]+/g, '_'), m[1]);
  var re6 = /\{\{\s*([A-Za-z0-9_ -]+?)\s*\}\}/g; while ((m = re6.exec(s))) add(m[1].toLowerCase().replace(/[^a-z0-9]+/g, '_'), m[1]);
  return out;
}

for (const file of ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html']) {
  const ctx = {};
  vm.runInNewContext(fnSrc(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), 'function opNoteBlankTokens(text){') + ';this.f=opNoteBlankTokens;', ctx);
  const parts = ['[FILL:', '[fill: ', '[FILL:x]', ']', '[', ']]', '[[', '{{', '}}', '{', '}', ' ', '  ', '\t', '\n', ' ', ' ', '_', '___', 'a', 'Z', '9', '-', '/', ':',
    '[not dictated]', '[NEEDLE GAUGE]', '[[needle_gauge]]', '{{ dose mg }}', 'Left L4-5'];
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  let fills = 0, curls = 0;
  for (let k = 0; k < 40000; k++) {
    let t = ''; const n = 1 + Math.floor(rnd() * 14);
    for (let i = 0; i < n; i++) t += parts[Math.floor(rnd() * parts.length)];
    if (/\[FILL:[^\]]+\]/i.test(t)) fills++;
    if (/\{\{[^}]*\}\}/.test(t)) curls++;
    assert.strictEqual(JSON.stringify(ctx.f(t)), JSON.stringify(reference(t)), file + ': differs from the original parser on ' + JSON.stringify(t));
  }
  assert(fills > 1000 && curls > 1000, file + ': the fuzz did not exercise both shapes (' + fills + ', ' + curls + ')');
  const t0 = Date.now();
  ctx.f('[FILL:' + ' '.repeat(50000) + 'x' + ' '.repeat(50000));
  ctx.f('{{' + ' '.repeat(90000) + 'a');
  ctx.f('[FILL:'.repeat(30000));
  const ms = Date.now() - t0;
  assert(ms < 1500, file + ': adversarial inputs took ' + ms + 'ms');
}
console.log('PASS op-note blank parser: identical to the original over 40,000 random notes in all three shells, and 100k-character unclosed [FILL: / {{ inputs finish in milliseconds');
