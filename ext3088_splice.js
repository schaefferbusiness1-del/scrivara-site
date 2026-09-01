/* ext 3.0.88: encopen-1.0.0 - after a successful open, the driver itself
   enters the encounter documentation stage and waits for the machine context,
   so the probe lands on a painted encounter with no human choreography. */
const fs = require('fs');
let s = fs.readFileSync('background.js', 'latin1');

const helperAnchor = 'function mlsExecTO(opts, ms) {';
const hi = s.indexOf(helperAnchor);
if (hi < 0) { console.error('HELPER ANCHOR MISSING'); process.exit(1); }
if (s.indexOf(helperAnchor, hi + 1) >= 0) { console.error('HELPER ANCHOR NOT UNIQUE'); process.exit(1); }

const helper = [
  '/* ===== encopen-1.0.0 (3.0.88, owner 2026-08-31: "pulling and writing should',
  '   be simple and easy and intuitive" / "the extension should be able to open',
  '   whoever up when its time to write with no user input") =================',
  '   After ANY successful chart/row open, the driver itself enters the',
  '   encounter documentation stage: if the machine-typed encounter context',
  '   (meta encounter_id) is not painted, it clicks the chart header\'s own',
  '   "Go to <stage>" opener - the exact button the doctor presses - and waits',
  '   for the context to appear. It NEVER matches "Done with ...", sign, save',
  '   or any completing control; a miss is reported honestly and the open',
  '   response still stands (fail-soft: the probe remains the gate). */',
  'function mlsEncMetaProbeFn() {',
  '  try {',
  '    var metas = document.querySelectorAll(\'meta\');',
  '    for (var i = 0; i < metas.length; i++) { if ((metas[i].getAttribute(\'content\') || \'\').indexOf(\'encounter_id\') >= 0) return { meta: true }; }',
  '  } catch (e) {}',
  '  return { meta: false };',
  '}',
  'function mlsEncStageClickFn() {',
  '  var out = { found: false, clicked: false, label: \'\' };',
  '  try {',
  '    var RE = /^go to (exam prep|exam|intake|checkout|check-out|sign-?off)$/i;',
  '    var els = Array.prototype.slice.call(document.querySelectorAll(\'a,button,div,span\')).filter(function (n) {',
  '      var t = (n.textContent || \'\').replace(/\\s+/g, \' \').trim();',
  '      if (!RE.test(t)) return false;',
  '      try { var r = n.getBoundingClientRect(); return r.width > 8 && r.height > 8; } catch (e) { return false; }',
  '    });',
  '    els.sort(function (a, b) { return (a.textContent || \'\').length - (b.textContent || \'\').length; });',
  '    var el = els[0]; if (!el) return out;',
  '    out.found = true; out.label = (el.textContent || \'\').trim().slice(0, 20);',
  '    var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;',
  '    [\'pointerover\', \'mouseover\', \'pointerdown\', \'mousedown\', \'pointerup\', \'mouseup\', \'click\'].forEach(function (et) {',
  '      try { el.dispatchEvent(new MouseEvent(et, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })); } catch (e) {}',
  '    });',
  '    out.clicked = true;',
  '  } catch (e) {}',
  '  return out;',
  '}',
  'async function mlsEnsureEncounterOpen(tabId) {',
  '  var out = { ran: true, hadMeta: false, clicked: false, stageLabel: \'\', metaAfter: false, waitedMs: 0 };',
  '  try {',
  '    var t0 = Date.now();',
  '    var p0 = await mlsExecTO({ target: { tabId: tabId, allFrames: true }, func: mlsEncMetaProbeFn }, 6000);',
  '    out.hadMeta = ((p0 && p0.r) || []).map(function (r) { return r && r.result; }).some(function (v) { return v && v.meta; });',
  '    if (out.hadMeta) { out.metaAfter = true; return out; }',
  '    var c = await mlsExecTO({ target: { tabId: tabId, allFrames: true }, func: mlsEncStageClickFn }, 8000);',
  '    var hits = ((c && c.r) || []).map(function (r) { return r && r.result; }).filter(function (v) { return v && v.clicked; });',
  '    if (!hits.length) { out.waitedMs = Date.now() - t0; return out; }',
  '    out.clicked = true; out.stageLabel = String(hits[0].label || \'\');',
  '    for (var i = 0; i < 15; i++) {',
  '      await mlsSleepW(3000);',
  '      var p1 = await mlsExecTO({ target: { tabId: tabId, allFrames: true }, func: mlsEncMetaProbeFn }, 5000);',
  '      if (((p1 && p1.r) || []).map(function (r) { return r && r.result; }).some(function (v) { return v && v.meta; })) { out.metaAfter = true; break; }',
  '    }',
  '    out.waitedMs = Date.now() - t0;',
  '  } catch (e) { out.err = String((e && e.message) || e).slice(0, 60); }',
  '  return out;',
  '}',
  ''
].join('\n');

s = s.slice(0, hi) + helper + s.slice(hi);

// Wire into the four open-success responses. Each anchor must be unique.
const sites = [
  "sendResponse({ ok: true, opened: true, via: bootstrapIdentity ? 'appointment-id' : 'schedule-click', candidates: sched.candidates,",
  "sendResponse({ ok: true, opened: true, via: 'findpatient', candidates: 1, dobOverride: true,",
  "sendResponse({ ok: true, opened: true, via: 'findpatient', candidates: 1, rowDob: findRes.rowDob",
  'sendResponse({ ok: true, opened: true, candidates: opened.candidates,'
];
let wired = 0;
for (const a of sites) {
  const i = s.indexOf(a);
  if (i < 0) { console.error('SITE ANCHOR MISSING: ' + a.slice(0, 50)); process.exit(1); }
  if (s.indexOf(a, i + 1) >= 0) { console.error('SITE ANCHOR NOT UNIQUE: ' + a.slice(0, 50)); process.exit(1); }
  const near = s.slice(Math.max(0, i - 2000), i);
  if (near.indexOf('tab.id') < 0 && s.slice(i, i + 600).indexOf('tab.id') < 0) { console.error('NO tab.id NEAR SITE: ' + a.slice(0, 50)); process.exit(1); }
  const inject = 'var __encOpen = await mlsEnsureEncounterOpen(tab.id);\n                ';
  const merged = a.replace('opened: true,', 'opened: true, encounterOpen: __encOpen,');
  s = s.slice(0, i) + inject + merged + s.slice(i + a.length);
  wired++;
}
console.log('wired sites: ' + wired);

const vFrom = '3.0.87', vTo = '3.0.88';
console.log('bg version sites: ' + (s.split(vFrom).length - 1));
s = s.split(vFrom).join(vTo);
fs.writeFileSync('background.js', s, 'latin1');
let m = fs.readFileSync('manifest.json', 'latin1');
if (m.indexOf(vFrom) < 0) { console.error('MANIFEST MISSING ' + vFrom); process.exit(1); }
fs.writeFileSync('manifest.json', m.split(vFrom).join(vTo), 'latin1');
console.log('SPLICE OK');
