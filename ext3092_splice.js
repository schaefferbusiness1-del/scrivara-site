/* ext 3.0.92: well-formed tokenStateClone (lone-surrogate cure). */
const fs = require('fs');
let s = fs.readFileSync('background.js', 'latin1');

const anchor = '  function tokenStateClone(value) {\n    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }\n  }';
const i = s.indexOf(anchor);
if (i < 0) { console.error('ANCHOR MISSING'); process.exit(1); }
if (s.indexOf(anchor, i + 1) >= 0) { console.error('NOT UNIQUE'); process.exit(1); }

const replacement = [
  '  function tokenStateClone(value) {',
  '    /* wellform-3.0.92 (measured live 2026-08-31, tokDiag: tokenSessionWrite-verify',
  '       "mismatch len 4232 vs 4232"): a LONE UTF-16 SURROGATE inside an embedded',
  '       context string survives JSON.stringify, but chrome.storage\\u0027s structured',
  '       serialization replaces it with U+FFFD - same length, different bytes -',
  '       so the fail-closed write-verify could never match and every mint died',
  '       token-state-unavailable. Well-form every string BEFORE storing so the',
  '       compared record is byte-identical to what storage keeps. Idempotent on',
  '       well-formed strings; no gate or value semantics change. */',
  '    try {',
  '      return JSON.parse(JSON.stringify(value, function (k, v) {',
  '        if (typeof v !== \'string\') return v;',
  '        try {',
  '          if (typeof v.toWellFormed === \'function\') return v.toWellFormed();',
  '          var outStr = \'\';',
  '          for (var ci = 0; ci < v.length; ci++) {',
  '            var code = v.charCodeAt(ci);',
  '            if (code >= 0xD800 && code <= 0xDBFF) {',
  '              var nxt = ci + 1 < v.length ? v.charCodeAt(ci + 1) : 0;',
  '              if (nxt >= 0xDC00 && nxt <= 0xDFFF) { outStr += v[ci] + v[ci + 1]; ci++; }',
  '              else outStr += \'\\uFFFD\';',
  '            } else if (code >= 0xDC00 && code <= 0xDFFF) outStr += \'\\uFFFD\';',
  '            else outStr += v[ci];',
  '          }',
  '          return outStr;',
  '        } catch (eW) { return v; }',
  '      }));',
  '    } catch (e) { return null; }',
  '  }'
].join('\n');

s = s.slice(0, i) + replacement + s.slice(i + anchor.length);
console.log('ver sites: ' + (s.split('3.0.91').length - 1));
s = s.split('3.0.91').join('3.0.92');
fs.writeFileSync('background.js', s, 'latin1');
let m = fs.readFileSync('manifest.json', 'latin1');
fs.writeFileSync('manifest.json', m.split('3.0.91').join('3.0.92'), 'latin1');
console.log('OK');
