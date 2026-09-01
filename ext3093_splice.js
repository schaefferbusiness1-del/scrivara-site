/* ext 3.0.93: well-form token ids at the lane's clean() choke-point + quarantine-read diag. */
const fs = require('fs');
let s = fs.readFileSync('background.js', 'latin1');

const a1 = "  function clean(v) { return String(v == null ? '' : v).trim(); }";
const i1 = s.indexOf(a1);
if (i1 < 0) { console.error('CLEAN ANCHOR MISSING'); process.exit(1); }
if (s.indexOf(a1, i1 + 1) >= 0) { console.error('CLEAN NOT UNIQUE'); process.exit(1); }
const r1 = [
'  /* idwellform-3.0.93: token ids derive from athena context strings; a LONE',
'     UTF-16 SURROGATE inside one poisons every derived surface - the',
'     chrome.storage key AND the quarantine alarm NAME (chrome.alarms.get on an',
'     ill-formed name throws, so authQuarantineState reported available:false',
'     and every claim died token-state-unavailable with an EMPTY diag ring).',
'     Well-form at this single choke-point every token-lane id flows through.',
'     Old records keyed by ill-formed ids become unreachable - they are exactly',
'     the poisoned ones. */',
'  function clean(v) {',
'    var str = String(v == null ? \'\' : v).trim();',
'    try {',
'      if (typeof str.toWellFormed === \'function\') return str.toWellFormed();',
'      var outStr = \'\';',
'      for (var ci = 0; ci < str.length; ci++) {',
'        var code = str.charCodeAt(ci);',
'        if (code >= 0xD800 && code <= 0xDBFF) {',
'          var nxt = ci + 1 < str.length ? str.charCodeAt(ci + 1) : 0;',
'          if (nxt >= 0xDC00 && nxt <= 0xDFFF) { outStr += str[ci] + str[ci + 1]; ci++; }',
'          else outStr += \'\\uFFFD\';',
'        } else if (code >= 0xDC00 && code <= 0xDFFF) outStr += \'\\uFFFD\';',
'        else outStr += str[ci];',
'      }',
'      return outStr;',
'    } catch (e) { return str; }',
'  }'
].join('\n');
s = s.slice(0, i1) + r1 + s.slice(i1 + a1.length);

// instrument authQuarantineState read failure
const a2 = "      var name = authQuarantineAlarmName(kind, id), alarm = await chrome.alarms.get(name);\n      return { available: true, marked: !!(alarm && alarm.name === name) };\n    } catch (e) { return { available: false, marked: false }; }";
const i2 = s.indexOf(a2);
if (i2 < 0) { console.error('QSTATE ANCHOR MISSING'); process.exit(1); }
const r2 = "      var name = authQuarantineAlarmName(kind, id), alarm = await chrome.alarms.get(name);\n      var mk = !!(alarm && alarm.name === name);\n      if (mk) tokDiag('quarantine-marked', kind);\n      return { available: true, marked: mk };\n    } catch (e) { tokDiag('quarantine-state-throw', (e && e.message) || e); return { available: false, marked: false }; }";
s = s.slice(0, i2) + r2 + s.slice(i2 + a2.length);

console.log('ver sites: ' + (s.split('3.0.92').length - 1));
s = s.split('3.0.92').join('3.0.93');
fs.writeFileSync('background.js', s, 'latin1');
let m = fs.readFileSync('manifest.json', 'latin1');
fs.writeFileSync('manifest.json', m.split('3.0.92').join('3.0.93'), 'latin1');
console.log('OK');
