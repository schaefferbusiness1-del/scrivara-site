/* ext 3.0.94: log at the token-state-unavailable emitter itself. */
const fs = require('fs');
let s = fs.readFileSync('background.js', 'latin1');

const a = "if (!(await storeActionToken(tok, tokenRecord, action === 'place_order' ? { senderTabId: sender.tab.id, previewHash: previewHash } : null))) return { ok: false, blocked: true, reason: 'token-state-unavailable',";
const i = s.indexOf(a);
if (i < 0) { console.error('ANCHOR MISSING'); process.exit(1); }
if (s.indexOf(a, i + 1) >= 0) { console.error('NOT UNIQUE'); process.exit(1); }
const r = "var __mintOk = false; try { tokDiag('mint-call', String(tok || '').length + ':' + action); __mintOk = await storeActionToken(tok, tokenRecord, action === 'place_order' ? { senderTabId: sender.tab.id, previewHash: previewHash } : null); tokDiag('mint-result', __mintOk === true ? 'ok' : ('falsy:' + typeof __mintOk)); } catch (eMint) { tokDiag('mint-throw', (eMint && eMint.message) || eMint); __mintOk = false; }\n        if (!__mintOk) return { ok: false, blocked: true, reason: 'token-state-unavailable',";
s = s.slice(0, i) + r + s.slice(i + a.length);
console.log('ver sites: ' + (s.split('3.0.93').length - 1));
s = s.split('3.0.93').join('3.0.94');
fs.writeFileSync('background.js', s, 'latin1');
let m = fs.readFileSync('manifest.json', 'latin1');
fs.writeFileSync('manifest.json', m.split('3.0.93').join('3.0.94'), 'latin1');
console.log('OK');
