'use strict';

/* Loading-states lane contract (owner directive 2026-07-23/24: every wait in
   the app is NAMED and honest — to the day-pull gold standard). Pins the
   behaviors shipped across b511–b523 so no later cleanup can quietly regress
   them back to silent spinners or invisible queues. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const templateLib = fs.readFileSync(path.join(root, 'feat_mls_template_library.js'), 'utf8');
const legalPack = fs.readFileSync(path.join(root, 'feat_mls_legalpack.js'), 'utf8');
const visitFocus = fs.readFileSync(path.join(root, 'feat_mls_visit_focus.js'), 'utf8');

/* togglePtMore ownership is one shared chain. Both modules may observe the
   app's canonical function, but neither may capture the other's wrapper. */
assert(legalPack.includes("window.__mlsTogglePtMoreChain") && legalPack.includes("TOGGLE_CHAIN_OWNER = 'p1-legalpack'"),
  'Legal / IME does not install through the shared togglePtMore chain');
assert(visitFocus.includes("window.__mlsTogglePtMoreChain") && visitFocus.includes("TOGGLE_CHAIN_OWNER = 'visit-focus'"),
  'Visit focus does not install through the shared togglePtMore chain');
assert(!legalPack.includes('window.togglePtMore = wrappedTogglePtMore') && !visitFocus.includes('window.togglePtMore = wrapped'),
  'togglePtMore regained independent wrapper ownership and can recurse');

/* b523 br-1.0.0 — the post-auth module-train window is named and self-clears. */
/* br-1.2.0: only required local modules block readiness; ui-ready settles the
   strip so optional satellites cannot leave Starting up visible on a normal
   no-patient or Visit surface. */
/* b733: br-1.1.0 — the strip also stamps performance.marks per engine-live
   transition and exposes __mlsBootTimeline() for the owner's 5-second bar. */
assert(connect.includes("window.__mlsBootReadiness={installed:true,version:'br-1.2.0'}"),
  'boot-readiness strip module must be installed exactly once');
assert(connect.includes('var QUIET_MS=2500') && /Date\.now\(\)-t0<QUIET_MS\) return/.test(connect),
  'a fast boot must stay visually quiet instead of flashing a readiness strip');
assert(connect.includes("'Still starting up…' : 'Starting up…'"),
  'a genuinely slow boot must use short human-facing startup language');
assert(connect.includes("var settled=false,iv=null") && connect.includes("window.addEventListener('mls:ui-ready',function(){settle('ui-ready')"),
  'a settled local UI must retire the readiness strip even when optional satellites are late');
assert(connect.includes("var CORE=[['Athena pull engine'") && !connect.includes("['Assistant',function(){return !!(window.__mlsAsstFix"),
  'optional Assistant/Copilot satellites must not block the required local boot lane');
assert(!/el\.textContent\s*=\s*['"]Getting MLS ready/.test(connect),
  'the visible boot strip must not regress to engine-count implementation language');
assert(connect.includes("settle(n>=CORE.length?'core':'deadline')") && connect.includes("Date.now()-t0>30000"),
  'the boot strip must self-clear on a hard deadline — it can never wedge (b733: the deadline branch also stamps the all-live mark first)');
assert(connect.indexOf('__mlsSI&&window.__mlsSI.pull') > 0 && connect.indexOf('__mlsPatientLock') > 0,
  'readiness must be judged on the real core engines, not timers');

/* b514 — the history RETRY paints the same progress bar as the pull. */
assert(/fill\.textContent = \(cvOpts\.label \|\| 'Retry '\) \+ mm\[1\] \+ '\/' \+ mm\[2\]/.test(connect),
  'retry must show real X/N progress while allowing the continuous-pull lane to keep its own label');
assert(connect.includes('DS.retryStartedAt = Date.now()'),
  'retry progress must carry elapsed time from its own start');

/* b518 — every saved note names its sync truth; queue changes re-render live. */
assert(shell.includes('⏳ Syncing') && shell.includes('☁ Synced') && shell.includes('📱 This device'),
  'History rows must carry the three-state sync chip');
const pbSetAt = shell.indexOf('function _pendingBackupSet(a){');
assert(pbSetAt > 0 && shell.slice(pbSetAt, pbSetAt + 400).includes("renderHistory"),
  'sync-queue changes must live-refresh the open History list');

/* b519/b522 — quick tools fold behind ONE chip on BOTH surfaces, shared pref. */
assert((connect.match(/uns\('ez3ToolsOpen'\)/g) || []).length >= 4,
  'both quick-tools surfaces must share the single remembered Tools preference');
assert(connect.includes("id=\"ez3QToolsToggle\"") && connect.includes("qt.id = 'ez3flToolsToggle'"),
  'each quick-tools surface must carry its own single Tools toggle chip');

/* b520 — the self-advancing loop stays opt-out-able and safety-gated. */
assert(connect.includes("localStorage.getItem(uns('ez3AutoGenerate')) !== '0'"),
  'auto-generate must remain an opt-out preference, never unconditional');
assert(/installAutoAdvance[\s\S]{0,900}requireExactScheduledBinding\(S\.appt, 'note generation'\)/.test(connect),
  'auto-generate must pass the same exact-binding gate as the manual button');

/* b511 tl-1.2.0 — form saves surface their preview where the user acted. */
assert(templateLib.includes('function importResultBox'),
  'template import previews must target the box where the user acted');

console.log('PASS loading-states contract: named boot readiness (self-clearing), real retry progress, three-state sync chips with live refresh, single shared Tools fold on both surfaces, gated opt-out auto-advance, and act-local template previews');
