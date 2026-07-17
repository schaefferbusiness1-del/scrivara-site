/* v2.9.34 owner directive: pulls must NEVER create, move, or resize browser
 * windows. Replace the quiet-pull strip machinery inside ensureBody with the
 * minimal safe action: select the Athena tab in whatever window it already
 * lives in (unless that would yank a tab the doctor is using), then proceed -
 * visible or throttled. Release/epoch/serialization semantics unchanged. */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'background.js');
const src = fs.readFileSync(FILE, 'latin1');
const crCount = s => { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === '\r') n++; return n; };
const CR_BEFORE = crCount(src);

const START = '  async function ensureBody(tab, senderTabId) {';
const END = "    if (!QP.flashed) { QP.flashed = true; try { if (QP.winId != null) chrome.windows.update(QP.winId, { drawAttention: true }); } catch (e) {} }\n    return 'limp';\n  }\n";
const a = src.indexOf(START);
if (a < 0) throw new Error('ensureBody start missing');
if (src.indexOf(START, a + 1) >= 0) throw new Error('ensureBody start not unique');
const b = src.indexOf(END, a);
if (b < 0 || b - a > 12000) throw new Error('ensureBody end missing or too far');
const bodyEnd = b + END.length;

const NEW =
"  async function ensureBody(tab, senderTabId) {\n" +
"    if (await tabVisible(tab.id)) return 'visible'; /* already on screen (incl. doctor parked on athena) */\n" +
"    /* v2.9.34 owner directive: a read must NEVER create, move, or resize a\n" +
"       browser window. The old quiet-pull work-strip (windows.create at preset\n" +
"       bounds, cross-display moves, raise-jiggles) confused the doctor and was\n" +
"       the most Mac-fragile surface in the extension (fullscreen spaces,\n" +
"       occlusion throttling, display arrangement). The ONLY action allowed\n" +
"       now is selecting the Athena tab inside whatever window it already\n" +
"       lives in - and only when that would not displace a tab the doctor is\n" +
"       actively using. If the Athena window stays hidden or occluded, the\n" +
"       read proceeds throttled ('limp') under the callers' existing budgets\n" +
"       and bounded retries, exactly like the covered-strip case before. */\n" +
"    try {\n" +
"      var t2 = await chrome.tabs.get(tab.id);\n" +
"      if (!t2.active) {\n" +
"        if (await mlsReadFocusWouldYank(tab.id)) return 'limp';\n" +
"        await chrome.tabs.update(tab.id, { active: true });\n" +
"      }\n" +
"    } catch (e) {}\n" +
"    await qpSleep(400); /* let the compositor recompute occlusion */\n" +
"    if (await tabVisible(tab.id)) return 'strip';\n" +
"    await qpSleep(700);\n" +
"    if (await tabVisible(tab.id)) return 'strip';\n" +
"    return 'limp';\n" +
"  }\n";
if (/[^\x00-\x7F]/.test(NEW) || /\r/.test(NEW)) throw new Error('bad replacement');
const out = src.slice(0, a) + NEW + src.slice(bodyEnd);
if (crCount(out) !== CR_BEFORE) throw new Error('CR census changed');
fs.writeFileSync(FILE, out, 'latin1');
console.log('OK ensureBody replaced: CRs', crCount(out), 'size', out.length);
