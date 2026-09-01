'use strict';
/* =============================================================================
 * setupvid-1.0.0 + rerunsetup-1.0.0  -  THE PROOF
 * -----------------------------------------------------------------------------
 * OWNER, 2026-09-01, verbatim: "upload to video as the first thing u see when u
 * first log in as part of the set up prosess" and "also make it possible to re
 * run the set up process".
 *
 * This suite EXECUTES the shipped slices rather than describing them. Every
 * behavioural claim below runs the real function bytes lifted out of the shell
 * (a paraphrase of the code under test proves only that the paraphrase works),
 * in all four shells where that is a static question:
 *
 *   PART 1  VIDEO FIRST. su_step0 is the wizard's first pane and the player
 *           host is the first thing inside it, above the welcome copy. The
 *           real suAllowedSteps() starts at 0 for every role, and the real
 *           suShow() run at SU_STEP 0 paints step 0 and mounts the player.
 *   PART 2  THE PLAYER. The real mlsSvMount() builds one <video> with controls,
 *           a PUBLISHED poster, playsinline, preload=metadata, sound ON and no
 *           autoplay, sourcing MLS_HowTo_v1.mp4.
 *   PART 3  THE ASSET IS NOT THERE YET. Firing the source's error event - which
 *           is exactly what a 404 delivers - swaps the player for a short,
 *           honest card. Nothing throws, nothing is disabled, setup continues.
 *   PART 4  NOBODY IS TRAPPED. The real suShow() leaves Skip and Next live and
 *           visible on the video step, in every video state.
 *   PART 5  SETTINGS. Both controls and the second player host exist in all
 *           four shells, inside a section every role can open.
 *   PART 6  RE-RUN RESETS TWO FLAGS AND NOTHING ELSE. The real
 *           mlsSvResetSetupProgress() runs against instrumented storage that
 *           records every read, write and removal; the removals are enumerated
 *           exactly, setItem is never called, and a decoy account survives
 *           byte for byte.
 *   PART 7  CONFIRM FIRST. The real mlsSvRerunSetup() with confirm() false
 *           touches nothing and opens nothing; with confirm() true it resets,
 *           opens the wizard on the USER path and forces step 0 - the video.
 *   PART 8  PUBLICATION. The CURRENT tree (no MLS_HowTo_v1.mp4) still passes
 *           the real fail-closed source audit, the inventory carries no
 *           speculative entry for a file that does not exist, and the auditor
 *           is shown REFUSING an inventory mp4 whose source is missing - which
 *           is why the video-landing commit, not this one, edits the inventory.
 * ===========================================================================*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];
const VIDEO = 'MLS_HowTo_v1.mp4';

/* A SUITE CAN PASS WITHOUT RUNNING (2026-08-28): the async half below could
   exit 0 having settled nothing. An explicit completion flag, checked on exit,
   makes a silent green impossible. */
let COMPLETED = false;
process.on('exit', (code) => {
  if (code === 0 && !COMPLETED) {
    console.error('setup-video.js EXITED WITHOUT COMPLETING - the async half never settled; this is a RED, not a pass');
    process.exitCode = 1;
  }
});

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks += 1; }
function eq(a, b, m) { assert.deepStrictEqual(a, b, m); checks += 1; }
/* arrays built inside a vm realm carry that realm's Array.prototype, which
   deepStrictEqual refuses against a host array. Compare the CONTENTS. */
const host = (a) => Array.prototype.slice.call(a);

const source = {};
for (const rel of SHELLS) source[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ------------------------------------------------------------------ lifting */
function balanced(src, marker, label) {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, label + ': ' + marker + ' is present');
  const open = src.indexOf('{', at + marker.length - 1);
  let depth = 0, mode = null;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i], p = src[i - 1];
    if (mode === null) {
      if (c === '{') depth += 1;
      else if (c === '}') { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && src[i + 1] === '/') { mode = '//'; i += 1; }
      else if (c === '/' && src[i + 1] === '*') { mode = '/*'; i += 1; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else if (c === '\\') i += 1;
    else if (c === mode) mode = null;
  }
  throw new Error(label + ': ' + marker + ' is not balanced');
}

/* The whole setupvid/rerunsetup block, lifted in one contiguous slice so a
   partial extraction cannot quietly drop a function this suite then "proves". */
function svBlock(src) {
  const from = src.indexOf("var MLS_SV_SRC='");
  const to = src.indexOf('async function openSetup(autoOpen){');
  assert.ok(from > 0 && to > from, 'the setupvid block sits directly above openSetup');
  return src.slice(from, to);
}

/* ------------------------------------------------------------- a small DOM */
function El(tag) {
  this.tagName = String(tag).toUpperCase();
  this.childNodes = [];
  this.parentNode = null;
  this._attrs = {};
  this._on = {};
  this.style = { cssText: '', display: '' };
  this.textContent = '';
  this.className = '';
  this.disabled = false;
}
Object.defineProperty(El.prototype, 'firstChild', { get() { return this.childNodes[0] || null; } });
El.prototype.setAttribute = function (k, v) { this._attrs[String(k)] = String(v); };
El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, String(k)) ? this._attrs[String(k)] : null; };
El.prototype.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, String(k)); };
El.prototype.appendChild = function (n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; };
El.prototype.removeChild = function (n) { const i = this.childNodes.indexOf(n); assert.ok(i >= 0, 'removeChild on a non-child'); this.childNodes.splice(i, 1); n.parentNode = null; return n; };
El.prototype.addEventListener = function (t, fn) { (this._on[t] = this._on[t] || []).push(fn); };
El.prototype.fire = function (t) { (this._on[t] || []).slice().forEach((fn) => fn({ type: t, target: this })); };
El.prototype.scrollIntoView = function () { this._scrolled = true; };
El.prototype.querySelector = function () { return null; };

function makeDocument(ids) {
  const nodes = {};
  (ids || []).forEach((id) => { nodes[id] = new El('div'); nodes[id].id = id; });
  return {
    nodes,
    api: {
      getElementById(id) { return nodes[id] || null; },
      createElement(tag) { return new El(tag); },
      querySelectorAll() { return []; }
    }
  };
}

/* ---------------------------------------------------- instrumented storage */
function makeStore(seed) {
  const map = new Map(Object.entries(seed || {}));
  const log = { get: [], set: [], remove: [], clear: 0 };
  return {
    map, log,
    api: {
      getItem(k) { log.get.push(String(k)); return map.has(String(k)) ? map.get(String(k)) : null; },
      setItem(k, v) { log.set.push([String(k), String(v)]); map.set(String(k), String(v)); },
      removeItem(k) { log.remove.push(String(k)); map.delete(String(k)); },
      clear() { log.clear += 1; map.clear(); },
      key(i) { return Array.from(map.keys())[i] || null; },
      get length() { return map.size; }
    }
  };
}

const ACCOUNT = 'doc@example.test';
const K = (suffix) => 'sf_u::' + ACCOUNT + '::' + suffix;

/* A realistic account: charts, notes, templates, keys, identity, schedule, the
   OTHER onboarding flags. None of it is flow progress, so none of it may move. */
function decoyAccount() {
  return {
    [K('patients')]: '[{"id":"p1","name":"Adam S."}]',
    [K('visits')]: '[{"id":"v1","note":"HPI ..."}]',
    [K('templates')]: '[{"id":"t1","body":"SOAP"}]',
    [K('apiKey')]: 'sk-do-not-touch',
    [K('docname')]: 'Jane A. Smith',
    [K('providerName')]: 'Jane A. Smith',
    [K('practiceName')]: 'Chester County Spine Care',
    [K('npi')]: '1234567890',
    [K('qolSignature')]: 'Jane A. Smith, MD',
    [K('draftTuningV1')]: '{"sections":["hpi"]}',
    [K('mlsSchedProviders')]: '["Jane A. Smith"]',
    [K('firstRunDone')]: '1',
    ['mls_onboard_tour_done::' + ACCOUNT]: '1',
    [K('setupDone')]: '1'
  };
}

/* =========================================================== PART 1: FIRST */
const WELCOME = 'Welcome to MLS';
for (const rel of SHELLS) {
  const s = source[rel];
  const modal = s.indexOf('id="setupModal"');
  ok(modal > 0, rel + ': the setup wizard modal is present');

  const step0 = s.indexOf('id="su_step0"', modal);
  const step1 = s.indexOf('id="su_step1"', modal);
  const host = s.indexOf('id="mlsSvSetupHost"', modal);
  const welcome = s.indexOf(WELCOME, step0);
  ok(step0 > modal && step1 > step0, rel + ': su_step0 is still the wizard\'s first pane');
  ok(host > step0 && host < step1, rel + ': the walkthrough host is inside su_step0');
  ok(host < welcome, rel + ': the walkthrough player is ABOVE the welcome copy - the owner asked for the video FIRST');

  /* step 0 is the only pane that is not display:none in the markup */
  const openTag0 = s.slice(step0 - 40, step0 + 60);
  ok(!/display:none/.test(openTag0), rel + ': su_step0 no longer opens visible');
  for (let i = 1; i <= 5; i += 1) {
    const at = s.indexOf('id="su_step' + i + '"', modal);
    ok(at > 0 && /display:none/.test(s.slice(at, at + 60)), rel + ': su_step' + i + ' must stay hidden until reached');
  }
  ok(s.indexOf(VIDEO) > 0, rel + ': the walkthrough source is ' + VIDEO);
}

/* the real suAllowedSteps(): every role starts at 0 */
{
  const src = source['1pScribeFlow.html'];
  const ctx = vm.createContext({});
  vm.runInContext(
    balanced(src, 'function suRole()', 'suRole') + '\n' +
    balanced(src, 'function suTier()', 'suTier') + '\n' +
    balanced(src, 'function suHasCapability(name)', 'suHasCapability') + '\n' +
    balanced(src, 'function suCanSchedule()', 'suCanSchedule') + '\n' +
    balanced(src, 'function suAllowedSteps()', 'suAllowedSteps') + '\n' +
    'this.allowed = suAllowedSteps;', ctx);
  const roles = ['doctor', 'head', 'user', 'nurse', 'receptionist'];
  for (const role of roles) {
    ctx.bkUser = { role, capabilities: {} };
    ctx.SU_STATE = { capabilities: {}, role, tier: 'standard' };
    const a = ctx.allowed();
    eq(a[0], 0, 'role ' + role + ': the wizard must still begin at the video step');
  }
  /* even a lite tier, which loses the schedule steps, still begins at 0 */
  ctx.bkUser = { role: 'doctor', capabilities: { tier: 'lite' } };
  ctx.SU_STATE = { capabilities: { tier: 'lite' }, role: 'doctor', tier: 'lite' };
  eq(ctx.allowed()[0], 0, 'a lite account must still begin at the video step');
}

/* ============================================ PARTS 2-4: THE REAL PLAYER */
function mountHarness(rel) {
  const doc = makeDocument(['mlsSvSetupHost', 'mlsSvSettingsHost', 'mlsSvRerunBtn']);
  const ctx = vm.createContext({
    document: doc.api,
    String, Array, Object,
    uns: K,
    SU_PROMPT_SESSION_KEY: 'sf_setup_prompted',
    bkUser: { role: 'doctor', capabilities: {} },
    localStorage: makeStore({}).api,
    sessionStorage: makeStore({}).api
  });
  vm.runInContext(svBlock(source[rel]) + '\nthis.__api = { mount: mlsSvMount, fallback: mlsSvFallbackCard, src: MLS_SV_SRC, poster: MLS_SV_POSTER, watch: mlsSvWatchWalkthrough, keys: mlsSvRerunKeys, reset: mlsSvResetSetupProgress, rerun: mlsSvRerunSetup, avail: mlsSvSetupAvailable, applyUI: mlsSvApplySettingsUI, confirmText: MLS_SV_RERUN_CONFIRM };', ctx);
  return { ctx, doc, api: ctx.__api };
}

const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages-publication-inventory.json'), 'utf8')).paths;

for (const rel of SHELLS) {
  const h = mountHarness(rel);
  eq(h.api.src, VIDEO, rel + ': the player must source ' + VIDEO);
  ok(inventory.indexOf(h.api.poster) >= 0,
    rel + ': the poster still has to be a PUBLISHED asset (' + h.api.poster + ') or the fallback state ships with a second 404');

  /* PART 2 - one player, correctly configured */
  const host = h.doc.nodes.mlsSvSetupHost;
  h.api.mount(host);
  eq(host.childNodes.length, 1, rel + ': mount builds exactly one child');
  const v = host.childNodes[0];
  eq(v.tagName, 'VIDEO', rel + ': the child is a <video>');
  ok(v.hasAttribute('controls'), rel + ': the player must expose controls');
  ok(v.hasAttribute('playsinline'), rel + ': the player must play inline on a phone');
  eq(v.getAttribute('preload'), 'metadata', rel + ': the player must not eagerly download the whole file');
  eq(v.getAttribute('poster'), h.api.poster, rel + ': the player must carry a poster');
  eq(v.muted, false, rel + ': a narrated walkthrough must play with SOUND - muted=false');
  ok(!v.hasAttribute('autoplay'), rel + ': the walkthrough must never start by itself');
  ok(String(v.getAttribute('aria-label') || '').length > 3, rel + ': the player needs an accessible name');
  eq(v.childNodes.length, 1, rel + ': one <source>');
  eq(v.childNodes[0].getAttribute('src'), VIDEO, rel + ': the <source> points at the walkthrough');
  eq(v.childNodes[0].getAttribute('type'), 'video/mp4', rel + ': the <source> declares video/mp4');

  /* idempotent: showing the pane twice must not stack players */
  h.api.mount(host);
  eq(host.childNodes.length, 1, rel + ': a second mount must not stack a second player');

  /* PART 3 - the asset is not published yet: a 404 delivers an error event */
  v.childNodes[0].fire('error');
  eq(host.childNodes.length, 1, rel + ': the failed player is replaced, not appended to');
  const card = host.childNodes[0];
  eq(card.getAttribute('data-mls-sv'), 'fallback', rel + ': a missing walkthrough degrades to the fallback card');
  const text = card.childNodes.map((n) => n.textContent).join(' ');
  ok(/being produced/i.test(text), rel + ': the fallback says the video is being produced');
  ok(/continue with setup/i.test(text), rel + ': the fallback tells the doctor to carry on - it must not read like a failure');
  ok(!/error|failed|sorry/i.test(text), rel + ': the fallback must not shout an error at a new doctor');

  /* a second error (video AND source both fire) must not double-swap */
  v.fire('error');
  eq(host.childNodes.length, 1, rel + ': a second error event must not stack a second card');

  /* the Settings host uses the SAME builder, so the two surfaces cannot drift */
  h.api.watch(null);
  eq(h.doc.nodes.mlsSvSettingsHost.childNodes.length, 1, rel + ': the Settings button mounts the same player');
  eq(h.doc.nodes.mlsSvSettingsHost.childNodes[0].tagName, 'VIDEO', rel + ': Settings gets a real player too');
}

/* PART 4 - the real suShow() on the video step: nothing traps the doctor */
{
  const src = source['1pScribeFlow.html'];
  const ids = ['su_step0', 'su_step1', 'su_step2', 'su_step3', 'su_step4', 'su_step5',
    'su_progress', 'su_bar', 'su_backBtn', 'su_skipBtn', 'su_nextBtn', 'setupMsg', 'mlsSvSetupHost'];
  const doc = makeDocument(ids);
  let mounted = 0;
  const ctx = vm.createContext({
    document: doc.api, Math, String, Array, Object,
    SU_STEP: 0, SU_MAX: 5,
    SU_STATE: { error: '', capabilities: {}, role: 'doctor', tier: 'standard' },
    suAllowedSteps: () => [0, 1, 2, 3, 4, 5],
    suRenderSchedule: () => { throw new Error('suShow must not render the schedule on the video step'); },
    suRenderPayments: () => { throw new Error('suShow must not render payments on the video step'); },
    mlsSvMount: (host) => { mounted += 1; assert.ok(host, 'suShow must hand mount the real host'); return host; }
  });
  vm.runInContext(balanced(src, 'function suShow()', 'suShow') + '\nthis.show = suShow;', ctx);
  ctx.show();

  eq(doc.nodes.su_step0.style.display, '', 'the video step is the pane on screen');
  eq(doc.nodes.su_step1.style.display, 'none', 'later panes stay hidden');
  eq(mounted, 1, 'showing the first pane mounts the walkthrough exactly once');
  eq(doc.nodes.su_skipBtn.style.display, '', 'SKIP MUST BE LIVE ON THE VIDEO STEP - a doctor is never trapped by a video');
  eq(doc.nodes.su_nextBtn.disabled, false, 'Next stays enabled on the video step');
  /* source stays ASCII-only: the shell's own label ends in a RIGHTWARDS ARROW */
  eq(doc.nodes.su_nextBtn.textContent, 'Get started ' + String.fromCharCode(0x2192), 'the video step still advances with Get started');
  eq(doc.nodes.su_backBtn.style.display, 'none', 'there is nothing before the video');

  /* the mount is guarded - a shell without the host must still paint the step */
  const doc2 = makeDocument(ids.filter((i) => i !== 'mlsSvSetupHost'));
  const ctx2 = vm.createContext({
    document: doc2.api, Math, String, Array, Object,
    SU_STEP: 0, SU_MAX: 5, SU_STATE: { error: '', capabilities: {} },
    suAllowedSteps: () => [0, 1, 4, 5],
    suRenderSchedule: () => {}, suRenderPayments: () => {},
    mlsSvMount: (host) => { assert.strictEqual(host, null, 'a missing host arrives as null'); return null; }
  });
  vm.runInContext(balanced(src, 'function suShow()', 'suShow') + '\nthis.show = suShow;', ctx2);
  ctx2.show();
  eq(doc2.nodes.su_step0.style.display, '', 'the wizard still paints when the video host is absent');
}

/* the skip and close controls are wired to the real closer, in every shell */
for (const rel of SHELLS) {
  const s = source[rel];
  const modal = s.indexOf('id="setupModal"');
  const end = s.indexOf('id="legalModal"', modal);
  const block = s.slice(modal, end > modal ? end : modal + 200000);
  ok(/id="su_skipBtn"[^>]*onclick="closeSetup\('deferred'\)"/.test(block),
    rel + ': the Skip control must stay wired to closeSetup - a doctor is never trapped by the wizard');
  ok(/class="modal-x"[^>]*onclick="closeSetup\('deferred'\)"/.test(block),
    rel + ': the wizard close button must stay wired to closeSetup');
}

/* ==================================================== PART 5: SETTINGS ROWS */
for (const rel of SHELLS) {
  const s = source[rel];
  const settings = s.indexOf('id="settingsModal"');
  ok(settings > 0, rel + ': Settings is present');
  const field = s.indexOf('id="mlsSvSettingsField"', settings);
  ok(field > settings, rel + ': the walkthrough / re-run row is inside Settings');

  /* it lives in Account & access: the one group allowedSettingsGroup() opens
     for every role, so the walkthrough cannot become role-invisible */
  const accountHead = s.indexOf('Account &amp; access', settings);
  const accountEnd = s.indexOf('/Account & access section', settings);
  ok(accountHead > 0 && accountEnd > field && field > accountHead,
    rel + ': the row must stay inside the Account & access section - a new .set-section with an unmapped heading is reachable from NO tab');

  ok(s.indexOf('id="mlsSvWatchBtn"', field) > field, rel + ': "Watch the walkthrough" control is present');
  ok(s.indexOf('id="mlsSvRerunBtn"', field) > field, rel + ': "Re-run setup" control is present');
  ok(s.indexOf('id="mlsSvSettingsHost"', field) > field, rel + ': the Settings player host is present');
  ok(/onclick="mlsSvWatchWalkthrough\(this\)"/.test(s.slice(field, field + 2000)), rel + ': the watch button calls the real mounter');
  ok(/onclick="mlsSvRerunSetup\(this\)"/.test(s.slice(field, field + 2000)), rel + ': the re-run button calls the real re-runner');
  /* openSettings has to CALL the role gate. Searching the whole shell would
     match the function's own definition, so this reads openSettings' body. */
  const openSettings = balanced(s, 'function openSettings()', rel + ' openSettings');
  ok(/mlsSvApplySettingsUI\(\)/.test(openSettings),
    rel + ': openSettings no longer applies the re-run role gate - the button would ship unguarded to owner/admin/lawyer accounts');
}

/* the role gate itself, executed */
{
  const h = mountHarness('1pScribeFlow.html');
  const cases = [
    [{ role: 'doctor', capabilities: {} }, true],
    [{ role: 'head', capabilities: {} }, true],
    [{ role: 'nurse', capabilities: {} }, true],
    [{ role: 'receptionist', capabilities: {} }, true],
    [{ role: 'owner', capabilities: {} }, false],
    [{ role: 'admin', capabilities: {} }, false],
    [{ role: 'lawyer', capabilities: {} }, false],
    [{ role: 'doctor', isAdmin: true, capabilities: {} }, false],
    [{ role: 'doctor', capabilities: { setupAllowed: false } }, false],
    [null, false]
  ];
  for (const [user, want] of cases) {
    h.ctx.bkUser = user;
    eq(h.api.avail(), want, 'setup availability for ' + JSON.stringify(user));
    h.api.applyUI();
    eq(h.doc.nodes.mlsSvRerunBtn.style.display, want ? '' : 'none',
      'the re-run button visibility for ' + JSON.stringify(user));
  }
}

/* ==================================== PARTS 6-7: RE-RUN RESETS TWO FLAGS */
const EXPECTED_LOCAL = [K('setupDone')];
const EXPECTED_SESSION = [K('sf_setup_prompted')];

{
  const doc = makeDocument(['mlsSvSetupHost', 'mlsSvSettingsHost', 'mlsSvRerunBtn']);
  const local = makeStore(decoyAccount());
  const session = makeStore({ [K('sf_setup_prompted')]: '1', [K('sf_invite_setup_token')]: 'keep-me' });
  const before = new Map(local.map);

  const ctx = vm.createContext({
    document: doc.api, String, Array, Object,
    uns: K,
    SU_PROMPT_SESSION_KEY: 'sf_setup_prompted',
    bkUser: { role: 'doctor', capabilities: {} },
    localStorage: local.api,
    sessionStorage: session.api
  });
  vm.runInContext(svBlock(source['1pScribeFlow.html']) + '\nthis.__api = { keys: mlsSvRerunKeys, reset: mlsSvResetSetupProgress };', ctx);

  /* the NAMED keys, straight out of the shipped function */
  const named = ctx.__api.keys();
  eq(host(named.local), EXPECTED_LOCAL, 'the re-run resets exactly one localStorage flag, by name');
  eq(host(named.session), EXPECTED_SESSION, 'the re-run resets exactly one sessionStorage latch, by name');

  const cleared = ctx.__api.reset();
  eq(host(cleared), EXPECTED_LOCAL.concat(EXPECTED_SESSION), 'the re-run reports exactly the two flags it cleared');

  /* ENUMERATED: every storage call the reset made */
  eq(local.log.remove, EXPECTED_LOCAL, 'localStorage.removeItem was called for exactly these keys');
  eq(session.log.remove, EXPECTED_SESSION, 'sessionStorage.removeItem was called for exactly these keys');
  eq(local.log.set, [], 'a re-run WRITES nothing to localStorage');
  eq(session.log.set, [], 'a re-run WRITES nothing to sessionStorage');
  eq(local.log.clear, 0, 'a re-run never clears localStorage');
  eq(session.log.clear, 0, 'a re-run never clears sessionStorage');

  /* the decoy account, key by key */
  const survivors = [];
  for (const [k, v] of before) {
    if (k === K('setupDone')) { ok(!local.map.has(k), 'the setupDone flag is gone'); continue; }
    eq(local.map.get(k), v, 'DATA LOSS: re-running setup changed ' + k);
    survivors.push(k);
  }
  ok(survivors.length >= 12, 'the decoy account is big enough to be meaningful (' + survivors.length + ' keys)');
  eq(session.map.get(K('sf_invite_setup_token')), 'keep-me', 'an unrelated session key survives the re-run');
  /* the flags this re-run deliberately does NOT touch */
  eq(local.map.get(K('firstRunDone')), '1', 'the first-run CHECKLIST flag is a different flow and stays put');
  eq(local.map.get('mls_onboard_tour_done::' + ACCOUNT), '1', 'the guided-tour done flag is a different flow and stays put');
}

/* PART 7 - confirm gates the whole thing */
/* The confirmation must go through the app's own promise dialog. A native
   confirm() freezes the UI thread and is silently suppressed in kiosk and
   automation contexts, which leaves the button DEAD with no message - which is
   why tests/no-native-dialogs-contract.test.js bans it outright. Pinned in the
   source AND executed through a stub below. */
for (const rel of SHELLS) {
  const block = svBlock(source[rel]);
  ok(/await mlsConfirm\(MLS_SV_RERUN_CONFIRM/.test(block),
    rel + ': the re-run must confirm through mlsConfirm, the non-blocking in-app dialog');
  /* same shape as tests/no-native-dialogs-contract.test.js: comments stripped,
     and a bare `confirm()` with empty parens is prose, not a call */
  const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/mlsConfirm\(/g, 'mlsX(');
  ok(!/(?:^|[^.\w'"])(?:window\.)?(?:confirm|prompt|alert)\((?!\))/.test(code),
    rel + ': a native confirm()/prompt()/alert() came back into the re-run path - it freezes the thread and dies silently under automation');
}

function rerunHarness(answer) {
  const doc = makeDocument(['mlsSvSetupHost', 'mlsSvSettingsHost', 'mlsSvRerunBtn']);
  const local = makeStore(decoyAccount());
  const session = makeStore({ [K('sf_setup_prompted')]: '1' });
  const trace = { confirms: [], opts: [], opens: [], shows: 0, closedSettings: 0 };
  const ctx = vm.createContext({
    document: doc.api, String, Array, Object, Promise,
    uns: K,
    SU_PROMPT_SESSION_KEY: 'sf_setup_prompted',
    bkUser: { role: 'doctor', capabilities: {} },
    localStorage: local.api,
    sessionStorage: session.api,
    SU_STEP: 4,
    mlsConfirm(msg, opts) { trace.confirms.push(String(msg)); trace.opts.push(opts || null); return Promise.resolve(answer); },
    closeSettings() { trace.closedSettings += 1; },
    openSetup(auto) { trace.opens.push(auto); return Promise.resolve(true); },
    suShow() { trace.shows += 1; }
  });
  vm.runInContext(svBlock(source['1pScribeFlow.html']) + '\nthis.__api = { rerun: mlsSvRerunSetup, text: MLS_SV_RERUN_CONFIRM };', ctx);
  return { ctx, local, session, trace, api: ctx.__api };
}

(async () => {
  /* declined */
  {
    const h = rerunHarness(false);
    const r = await h.api.rerun(null);
    eq(r, false, 'declining the confirm returns false');
    eq(h.trace.confirms.length, 1, 'the doctor is ASKED before setup re-runs');
    eq(h.local.log.remove, [], 'declining removes nothing');
    eq(h.session.log.remove, [], 'declining removes nothing from the session');
    eq(h.trace.opens, [], 'declining opens no wizard');
    eq(h.ctx.SU_STEP, 4, 'declining leaves the wizard step where it was');
    ok(/deleted|not touched/i.test(h.api.text), 'the confirm text promises nothing is deleted');
    ok(/walkthrough video/i.test(h.api.text), 'the confirm text says where the re-run lands');
    const opts = h.trace.opts[0] || {};
    ok(String(opts.okLabel || '').length > 1 && String(opts.cancelLabel || '').length > 1,
      'the dialog names both outcomes rather than shipping bare OK / Cancel');
  }
  /* Escape closes the in-app dialog by RESOLVING it - with anything other than
     a literal true, the re-run must not fire. */
  for (const answer of [undefined, null, false, 0, '']) {
    const h = rerunHarness(answer);
    const r = await h.api.rerun(null);
    eq(r, false, 'a dialog that resolved ' + JSON.stringify(answer) + ' must not re-run setup');
    eq(h.local.log.remove, [], 'a dismissed dialog removes nothing (' + JSON.stringify(answer) + ')');
  }
  /* accepted */
  {
    const h = rerunHarness(true);
    const r = await h.api.rerun(null);
    eq(r, true, 'accepting re-runs setup');
    eq(h.trace.confirms.length, 1, 'exactly one confirm');
    eq(h.local.log.remove, EXPECTED_LOCAL, 'accepting clears exactly the local flow flag');
    eq(h.session.log.remove, EXPECTED_SESSION, 'accepting clears exactly the session latch');
    eq(h.local.log.set, [], 'accepting writes nothing');
    eq(h.trace.closedSettings, 1, 'Settings closes so the wizard is not stacked behind it');
    eq(h.trace.opens, [false], 'the wizard reopens on the USER-INITIATED path (openSetup(false))');
    eq(h.ctx.SU_STEP, 0, 'THE RE-RUN LANDS ON STEP 0 - the video - not on a resumed middle step');
    eq(h.trace.shows, 1, 'the wizard repaints on step 0');
    eq(h.local.map.get(K('patients')), '[{"id":"p1","name":"Adam S."}]', 'charts survive an accepted re-run');
    eq(h.local.map.get(K('apiKey')), 'sk-do-not-touch', 'saved keys survive an accepted re-run');
  }
  /* a wizard that refuses to open must not silently claim success */
  {
    const doc = makeDocument(['mlsSvRerunBtn']);
    const local = makeStore(decoyAccount());
    const session = makeStore({});
    const ctx = vm.createContext({
      document: doc.api, String, Array, Object, Promise,
      uns: K, SU_PROMPT_SESSION_KEY: 'sf_setup_prompted',
      bkUser: { role: 'doctor', capabilities: {} },
      localStorage: local.api, sessionStorage: session.api,
      SU_STEP: 3,
      confirm() { return true; },
      closeSettings() {},
      openSetup() { return Promise.reject(new Error('backend unreachable')); },
      suShow() { throw new Error('suShow must not run when the wizard never opened'); }
    });
    vm.runInContext(svBlock(source['1pScribeFlow.html']) + '\nthis.__api = { rerun: mlsSvRerunSetup };', ctx);
    const r = await ctx.__api.rerun(null);
    eq(r, false, 'a wizard that could not open reports false rather than pretending');
  }

  /* ============================================== PART 8: PUBLICATION WIRING */
  const audit = require(path.join(ROOT, 'scripts', 'audit-pages-build.js'));

  /* 1. NO SPECULATIVE HOLE. The walkthrough asset does not exist yet, so it is
        deliberately NOT in the inventory. */
  eq(fs.existsSync(path.join(ROOT, VIDEO)), false,
    'this commit wires the SURFACE only - ' + VIDEO + ' is produced separately');
  eq(inventory.indexOf(VIDEO), -1,
    'the inventory must not carry ' + VIDEO + ' before the file exists - that is a speculative hole AND a red CI audit');

  /* 2. THE CURRENT TREE STILL PASSES THE REAL FAIL-CLOSED SOURCE AUDIT. */
  const now = audit.inspectExpectedSources(ROOT);
  eq(now.failures, [], 'the current tree fails the reviewed-source audit: ' + JSON.stringify(now.failures.slice(0, 5)));
  ok(now.valid.size === inventory.length,
    'every one of the ' + inventory.length + ' reviewed paths resolves to a real regular file');

  /* 3. WHY THE INVENTORY EDIT BELONGS TO THE VIDEO-LANDING COMMIT: the auditor
        refuses an inventory entry whose source is absent. Shown with the real
        auditor against a root that has none of them, using the mp4 the repo
        already publishes as the named subject. */
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-pub-audit-'));
  try {
    const missing = audit.inspectExpectedSources(empty);
    const mp4s = inventory.filter((p) => p.endsWith('.mp4'));
    ok(mp4s.length >= 1, 'the repo already publishes at least one mp4 as precedent');
    for (const rel of mp4s) {
      ok(missing.failures.indexOf('missing reviewed source file: ' + rel) >= 0,
        'the reviewed-source audit must REFUSE an inventory mp4 whose file is absent (' + rel + ')');
    }
  } finally {
    try { fs.rmSync(empty, { recursive: true, force: true }); } catch (e) {}
  }

  /* 4. WHAT THE VIDEO-LANDING COMMIT DOES *NOT* HAVE TO EDIT, measured:
        _config.yml has no exclude glob for .mp4, and the mp4 this repo already
        publishes is on NO include line - so Jekyll publishes an mp4 by default
        and the allowlist needs no new entry. */
  const config = fs.readFileSync(path.join(ROOT, '_config.yml'), 'utf8');
  const includeAt = config.indexOf('\ninclude:');
  ok(includeAt > 0, '_config.yml still has an include allowlist');
  const excludeBlock = config.slice(0, includeAt);
  const includeBlock = config.slice(includeAt);
  ok(!/mp4/i.test(excludeBlock), '_config.yml must not have grown an mp4 exclude glob - the walkthrough would stop publishing');
  for (const rel of inventory.filter((p) => p.endsWith('.mp4'))) {
    ok(includeBlock.indexOf('"' + rel + '"') < 0,
      'precedent: ' + rel + ' publishes with NO include line, so ' + VIDEO + ' needs no _config.yml edit either');
  }

  /* 5. AND WHAT THE BOUNDARY SUITE ALREADY ALLOWS: mp4 is a reviewed root
        extension, so a landing .mp4 needs no allowance edit there either. */
  const boundary = fs.readFileSync(path.join(ROOT, 'tests', 'public-publication-boundary.test.js'), 'utf8');
  const reviewed = boundary.slice(boundary.indexOf('const ROOT_EXT_REVIEWED'), boundary.indexOf('const ROOT_EXT_REVIEWED') + 300);
  ok(/'mp4'/.test(reviewed),
    "public-publication-boundary.test.js must keep 'mp4' in ROOT_EXT_REVIEWED, or a landing walkthrough is an unreviewed root extension");

  console.log('setup-video.js: OK - ' + checks + ' checks. ' +
    'The walkthrough player is the first thing in su_step0 in all 4 shells; the real mlsSvMount builds one ' +
    'controls/poster/playsinline/preload=metadata, unmuted, non-autoplay <video> on ' + VIDEO + '; a source error ' +
    '(what a 404 delivers) swaps it for an honest "being produced" card without disabling anything; the real suShow ' +
    'keeps Skip and Get started live on the video step; Settings carries the same player plus Re-run setup inside ' +
    'Account & access in all 4 shells; the real reset removes EXACTLY ' + EXPECTED_LOCAL.concat(EXPECTED_SESSION).join(' + ') +
    ' and writes nothing, with a 14-key decoy account intact; re-run confirms first, reopens on the user path and ' +
    'forces step 0; and the current tree - with no ' + VIDEO + ' and no inventory entry for it - still passes the ' +
    'real fail-closed reviewed-source audit over ' + inventory.length + ' paths.');
  COMPLETED = true;
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
