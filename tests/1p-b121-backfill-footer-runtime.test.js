'use strict';
/* =============================================================================
 * b121 VISIT-BACKFILL FOOTER  (1p lineage promoted to production)
 *
 * THE MEASUREMENT THIS SUITE EXISTS FOR - owner's live /cloned pull,
 * 2026-08-17, ext 3.0.62, with THREE signed-in athenaOne tabs open:
 *
 *   footer   "Visit backfill: <Full Patient Name> - open-failed: Open your
 *             signed-in athenaOne in another tab, then try again"
 *
 * Three defects in one line: a patient NAME in persistent chrome; an
 * instruction that was FALSE (the extension's tab picker had merely missed its
 * 1.2-1.5 s session ping while athena was rendering); and no retry at all, so a
 * transient was rendered as a terminal verdict.
 *
 * The fix first lived in 1p-feat_mls_b121_pack.js. On 2026-08-20 the owner
 * promoted the whole /1p lineage to production (3967feec), and
 * scripts/derive-production-from-1p.js became the authoritative definition of
 * production. feat_mls_b121_pack.js must therefore carry the SAME fix, with
 * only the official lane-identity rewrite in its bytes.
 *
 * What is proved, and how:
 *   1  LINEAGE     production is exactly the 1p pack modulo the official asset
 *                  identity rewrite; both carry the delimited fix, and the
 *                  PHI-bearing footer write is gone from both.
 *   2  LOADERS     both twins enter exactly one bundle, that bundle loads the
 *                  fork once under the canonical dedupe identity, production
 *                  loads its derived production-identity file, and the twins
 *                  stay canonical.
 *   3  PINS        the fork is registered in every list that enumerates forks
 *                  (P1_FILES, publication inventory + boundary classification,
 *                  fork parity baseline), the /cloned derivation is PRISTINE,
 *                  and any production drift is only the reviewed signup bridge.
 *   4  VOCABULARY  reason codes come from the pull lane's own
 *                  _todayNoteReasonCode - EXECUTED here, not grepped for.
 *   5  QUIET       both sanctioned sentences are classified by the REAL
 *                  quietnotify-1.0.0 classifier taken from BOTH shells, and the
 *                  block refuses to hand toast() anything that is not
 *                  outcome/info.
 *   6  RUNTIME     both real modules run in a vm against a fake extension and a
 *                  virtual clock: the footer is PHI-free with a name-shaped
 *                  fixture; open-failed -> presence VERIFIED -> retried ->
 *                  recovered; presence ABSENT -> honest verdict with nothing
 *                  re-driven; no probe at all -> nothing re-driven; and the
 *                  retry is bounded at two rounds with a 2 s / 6 s backoff.
 *
 * No network, no extension, no Athena, no PHI - synthetic names only.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');
const lines = (s) => s.split('\r\n').join('\n').split('\n');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

const FORK = '1p-feat_mls_b121_pack.js';
const SHARED = 'feat_mls_b121_pack.js';
const forkSrc = read(FORK);
const sharedSrc = read(SHARED);

/* ================================================ 1  THE PROMOTED LINEAGE == */
{
  const i = forkSrc.indexOf('/* ===== p1-backfill-footer-1.0.0 ===');
  const j = forkSrc.indexOf('/* ===== end p1-backfill-footer-1.0.0 ===');
  ok(i > 0 && j > i, 'the p1-backfill-footer-1.0.0 block is missing or unclosed in the fork');
  const si = sharedSrc.indexOf('/* ===== p1-backfill-footer-1.0.0 ===');
  const sj = sharedSrc.indexOf('/* ===== end p1-backfill-footer-1.0.0 ===');
  ok(si > 0 && sj > si, 'the promoted production pack lost or truncated the footer block');

  /* The official production derivation rewrites every 1p-feat_ asset identity
     to feat_. This pack presently has exactly one such identity (in the
     one-engine comment); after that exact rewrite EVERY byte must match.
     The whole authoritative derivation is also executed in section 3. */
  eq((forkSrc.match(/1p-feat_/g) || []).length, 1,
    'the b121 pack gained another lane-identity occurrence; review it against the official derivation');
  eq(forkSrc.split('1p-feat_').join('feat_'), sharedSrc,
    'production is not the exact promoted 1p b121 pack modulo official asset identity');

  for (const [name, src] of [[FORK, forkSrc], [SHARED, sharedSrc]]) {
    ok(src.indexOf("el.textContent = 'Visit backfill: ' + STATE.status;") < 0,
      name + ' writes the raw, name-bearing status line into the footer again');
    ok(src.indexOf('"Finishing today\'s notes in the background"') > 0,
      name + ' lost the sanctioned in-progress sentence');
    ok(src.indexOf('nothing was lost') > 0, name + ' lost the sanctioned deferred sentence');
  }
}

/* ======================================================== 2  THE LOADERS == */
{
  const connect = read('1p-mls-connect.js');
  const prodConnect = read('mls-connect.js');

  eq((connect.match(/s\.src='1p-feat_mls_b121_pack\.js\?v='/g) || []).length, 1,
    '1p bundle must load the forked pack exactly once');
  ok(connect.indexOf("s.setAttribute('data-mls-asset','feat_mls_b121_pack.js')") >= 0,
    '1p pack loader must retain the canonical dedupe identity');
  ok(connect.indexOf("s.src='feat_mls_b121_pack.js?v='") < 0,
    '1p bundle still loads the shared production pack');
  ok(connect.indexOf("1p-feat_mls_b121_pack.js?v='+(window.__MLS_AV||Date.now())") >= 0,
    'the 1p pack loader lost the build-number cache-buster (a hand token goes stale)');

  ok(prodConnect.indexOf("s.src='feat_mls_b121_pack.js?v='+(window.__MLS_AV||Date.now())") >= 0,
    'production no longer loads its derived pack with the build-number cache-buster');
  ok(prodConnect.indexOf('1p-feat_mls_b121_pack') < 0,
    'the production-identity bundle contains a 1p asset name');

  /* The pack has never had a loader in the shells, so "the fork loads on the 1p
     shell (both twins)" is honestly stated as: each twin enters exactly one
     bundle, and that bundle is the one asserted above. */
  const shell = read('1pScribeFlow.html');
  const live = read('1p/index.html');
  for (const [name, text] of [['1pScribeFlow.html', shell], ['1p/index.html', live]]) {
    eq((text.match(/s\.src='1p-mls-connect\.js\?v='\+window\.__MLS_AV/g) || []).length, 1,
      name + ' must enter exactly one 1p bundle');
    ok(text.indexOf("s.src='mls-connect.js?v='+window.__MLS_AV") < 0,
      name + ' must never enter the production bundle');
    ok(!/src=['"](?:1p-)?feat_mls_b121_pack\.js/.test(text),
      name + ' must not load the pack directly - the bundle owns that loader');
  }

  /* twins canonical: the live shell differs only by its route/CSP bootstrap */
  const canon = (v) => String(v)
    .replace("base-uri 'self'", "base-uri 'none'")
    .replace(/<!-- p1-live-1\.0\.0:[\s\S]*?<base href="\/1p">\r?\n/, '')
    .replace("route:'/1p/'", "route:'/1pScribeFlow.html'");
  eq(canon(live), shell, 'the twins drifted beyond the live route/CSP bootstrap');
}

/* ============================================================ 3  THE PINS == */
{
  ok(read(path.join('tests', '1p-preview-contract.test.js')).indexOf("'1p-feat_mls_b121_pack.js'") > 0,
    'the fork is not in P1_FILES, so nothing freezes its bytes against the 1p baseline');

  const inventory = JSON.parse(read('pages-publication-inventory.json'));
  ok(inventory.paths.indexOf('1p-feat_mls_b121_pack.js') >= 0,
    'the fork is absent from the publication inventory - Pages would not publish it and /1p would 404 on the loader');
  ok(inventory.paths.indexOf('cloned-feat_mls_b121_pack.js') >= 0,
    'the derived clone of the fork is absent from the publication inventory');

  const boundary = read(path.join('tests', 'public-publication-boundary.test.js'));
  ok(boundary.indexOf("'1p-feat_mls_b121_pack.js'") > 0 && boundary.indexOf("'cloned-feat_mls_b121_pack.js'") > 0,
    'the publication boundary suite does not classify the new fork or its clone');

  ok(read(path.join('tests', '1p-fork-parity-contract.test.js')).indexOf("'feat_mls_b121_pack.js': []") > 0,
    'the fork pair has no recorded parity baseline, so a later absence would arrive silently');

  ok(fs.existsSync(path.join(ROOT, 'cloned-feat_mls_b121_pack.js')),
    'the derived cloned counterpart of the fork does not exist on disk');

  const clonedDerived = spawnSync(process.execPath, [path.join('scripts', 'derive-cloned-from-1p.js'), '--check'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  eq(clonedDerived.status, 0, 'scripts/derive-cloned-from-1p.js --check is not clean:\n' +
    String(clonedDerived.stdout || '') + String(clonedDerived.stderr || ''));
  ok(/^PRISTINE/.test(String(clonedDerived.stdout || '').trim()),
    'derive-cloned-from-1p.js did not report PRISTINE: ' + String(clonedDerived.stdout || '').trim());

  /* The signup compatibility bridge is intentionally production-only: public
     signup accounts can still use policy 0 while the preview keeps its own
     account ceremony. Keep the derivation audit live, allow exactly that one
     shell, and require the bridge's fail-closed markers. */
  const productionDerived = spawnSync(process.execPath, [path.join('scripts', 'derive-production-from-1p.js'), '--check'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const productionDeriveText = String(productionDerived.stdout || '') + String(productionDerived.stderr || '');
  if (productionDerived.status === 0) {
    ok(/^PRISTINE/.test(productionDeriveText.trim()),
      'derive-production-from-1p.js exited cleanly without reporting PRISTINE');
  } else {
    eq(productionDerived.status, 1, 'the production derivation failed for a reason other than reviewed byte drift');
    assert.deepStrictEqual(Array.from(productionDeriveText.matchAll(/^DRIFT:\s+(.+)$/gm), (m) => m[1]),
      ['ScribeFlow.html'], 'production drift escaped the reviewed signup-only shell boundary');
    checks++;
    const productionShell = read('ScribeFlow.html');
    const previewShell = read('1pScribeFlow.html');
    ok(productionShell.indexOf('function agLegacySignRequest') > 0 &&
      productionShell.indexOf('SIGNED_RECORD_VERIFICATION_PENDING') > 0 &&
      previewShell.indexOf('function agLegacySignRequest') < 0,
      'the sole production derivation exception is not the reviewed policy-0 signup bridge');
  }
}

/* ================================================ 4  THE CODE VOCABULARY == */
/* The pull lane's REAL mapper, sliced out of the 1p importer and executed, so
   "codes via _todayNoteReasonCode" is a measurement rather than a claim. */
const laneReasonCode = (function () {
  const src = read('1p-feat_mls_schedimport_exact.js');
  const a = src.indexOf('  var TN_NO_TAB_REASON = ');
  const b = src.indexOf('  function tnIsNoTabReason(');
  assert.ok(a > 0 && b > a, 'could not slice TN_NO_TAB_REASON..tnReasonCode out of the 1p importer');
  return new Function(src.slice(a, b) + '\n;return tnReasonCode;')();
})();
{
  eq(laneReasonCode('open-failed:Open your signed-in athenaOne in another tab, then try again'), 'no-athena-tab',
    "the pull lane's own mapper does not classify the owner's measured footer as no-athena-tab");
  eq(laneReasonCode('wrong-chart'), 'other', 'the lane mapper misclassifies a deterministic refusal');
  eq(laneReasonCode(''), 'unknown', 'the lane mapper does not report an empty reason as unknown');
}

/* ============================================== 5  THE QUIET CLASSIFIER === */
const SENTENCE_RUNNING = "Finishing today's notes in the background (3 left)";
const SENTENCE_LATER = "Today's notes will finish next time you pull — nothing was lost";
const OLD_FOOTER = 'Visit backfill: Jane Q. Doe - open-failed: Open your signed-in athenaOne in another tab, then try again';
function classifierFrom(shellName) {
  const src = read(shellName);
  const block = src.indexOf('/* quietnotify-1.0.0 */');
  const a = src.indexOf('  function S(v)', block);      /* classify()'s only helper */
  const b = src.indexOf('  /* ---------------- PHI SANITISER', a);
  assert.ok(block > 0 && a > block && b > a, 'could not slice the quietnotify classifier out of ' + shellName);
  return new Function(src.slice(a, b) + '\n;return classify;')();
}
const CLASSIFY = classifierFrom('1pScribeFlow.html');
for (const shellName of ['1pScribeFlow.html', '1p/index.html']) {
  const classify = classifierFrom(shellName);
  for (const s of [SENTENCE_RUNNING, SENTENCE_LATER]) {
    const kind = classify(s, '');
    ok(kind === 'outcome' || kind === 'info',
      shellName + ': the footer sentence classifies as "' + kind + '" - only outcome/info stay quiet: ' + JSON.stringify(s));
  }
  /* the control: the sentence this fix REPLACED is action-needed, i.e. a toast.
     Without it, "everything is quiet" could just mean a broken classifier. */
  eq(classify(OLD_FOOTER, ''), 'action',
    shellName + ': the measured old footer no longer classifies as action - the control is broken');
}

/* ================================================= 6  THE RUNTIME HARNESS = */
function moduleOf(text, label) {
  const src = lines(text).join('\n');
  const a = src.indexOf("(function () {\n  'use strict';\n  try { if (window.__mlsVisitsBackfill) return; }");
  const b = src.indexOf('window.__mlsVisitsBackfill_revert = revert; /* deploy-convention alias */');
  assert.ok(a > 0 && b > a, 'could not slice the visits-backfill module out of ' + label);
  const end = src.indexOf('})();', b);
  assert.ok(end > b, 'could not find the end of the visits-backfill IIFE in ' + label);
  return src.slice(a, end + 5);
}
const MODULE_SRC = moduleOf(forkSrc, FORK);
const PRODUCTION_MODULE_SRC = moduleOf(sharedSrc, SHARED);
eq(MODULE_SRC.split('1p-feat_').join('feat_'), PRODUCTION_MODULE_SRC,
  'the executed production module is not the exact promoted 1p module modulo lane identity');
let activeModuleSrc = MODULE_SRC;
let activeModuleLabel = FORK;

/* Mutation control: recreate only the two measured regressions inside the real
   current module. This replaces the obsolete "production still has the old
   bytes" control while preserving proof that the harness actually detects a
   raw footer and an engine that gives up without asking presence. */
function mutateOnce(src, from, to, label) {
  eq(src.split(from).length - 1, 1, 'mutation control anchor moved: ' + label);
  return src.replace(from, to);
}
let LEGACY_CONTROL_SRC = MODULE_SRC;
LEGACY_CONTROL_SRC = mutateOnce(LEGACY_CONTROL_SRC,
  '      var text = bfFootText();',
  "      var text = 'Visit backfill: ' + STATE.status;",
  'raw footer');
LEGACY_CONTROL_SRC = mutateOnce(LEGACY_CONTROL_SRC,
  "    return !!row && row.ok !== true && bfReasonCode(row.reason) === 'no-athena-tab';",
  '    return false; /* TEST MUTATION: legacy engine never rechecked presence */',
  'no retry');

class FakeEl {
  constructor(tag, dom) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null;
    this.style = { cssText: '' }; this.attrs = {};
    this.hidden = false; this.className = ''; this.id = '';
    this._text = '';
    this._dom = dom;
  }
  get textContent() { return this._text; }
  set textContent(v) {
    this._text = String(v == null ? '' : v);
    if (String(this.id) === 'mlsVbfStatus') this._dom.footSeen.push(this._text);
  }
  setAttribute(k, v) { this.attrs[String(k)] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, String(k)) ? this.attrs[String(k)] : null; }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this; this.children.push(c);
    if (c.id) this._dom.byId.set(String(c.id), c);
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    if (c.id) this._dom.byId.delete(String(c.id));
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  querySelector(sel) {
    const want = String(sel);
    const hit = (n) => (want.charAt(0) === '.'
      ? String(n.className).split(' ').indexOf(want.slice(1)) >= 0
      : (want.charAt(0) === '#' ? String(n.id) === want.slice(1) : n.tagName === want.toUpperCase()));
    const walk = (n) => {
      for (const c of n.children) { if (hit(c)) return c; const d = walk(c); if (d) return d; }
      return null;
    };
    return walk(this);
  }
}

function makeSandbox(options) {
  const opts = options || {};
  const dom = { byId: new Map(), footSeen: [] };
  const doc = {
    createElement: (t) => new FakeEl(t, dom),
    getElementById: (id) => dom.byId.get(String(id)) || null,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const panel = new FakeEl('div', dom); panel.id = 'mlsPullProgPanel';
  const ppc = new FakeEl('div', dom); ppc.className = 'ppc';
  panel.appendChild(ppc);
  dom.byId.set('mlsPullProgPanel', panel);
  doc.body = new FakeEl('body', dom);

  let now = Date.UTC(2026, 7, 18, 16, 0, 0);
  let seq = 0;
  const timers = [];
  function FakeDate(...args) {
    if (!(this instanceof FakeDate)) return new Date(now).toString();
    return args.length ? new Date(...args) : new Date(now);
  }
  FakeDate.now = () => now;
  FakeDate.parse = Date.parse;
  FakeDate.UTC = Date.UTC;
  FakeDate.prototype = Date.prototype;

  const listeners = [];
  const posted = [];
  const opens = [];
  const reads = [];
  const toasts = [];
  const presenceCalls = [];
  const patients = opts.patients || [{ id: 'p1', name: 'Jane Q. Doe', dob: '01/02/1970', visits: [] }];

  function deliver(data) {
    for (const fn of listeners.slice()) { try { fn({ data }); } catch (e) { /* a listener threw */ } }
  }

  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Promise, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError,
    Set, Map, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    Date: FakeDate,
    setTimeout(fn, ms) {
      const t = { id: ++seq, fn, at: now + (Number(ms) || 0), ms: Number(ms) || 0, dead: false, fired: false };
      timers.push(t);
      return t.id;
    },
    clearTimeout(id) { const t = timers.find((x) => x.id === id); if (t) t.dead = true; },
    document: doc,
    addEventListener(type, fn) { if (String(type) === 'message') listeners.push(fn); },
    removeEventListener(type, fn) {
      if (String(type) !== 'message') return;
      const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
    },
    postMessage(msg) {
      posted.push(msg);
      const d = msg || {};
      const later = (data) => { sandbox.setTimeout(() => deliver(data), 5); };
      if (d.type === 'mlsPing') { later({ type: 'mlsPong', source: 'mls-ext' }); return; }
      if (d.type === 'mlsAppSearchOpenPatient') {
        opens.push({ name: d.name, dob: d.dob, at: now });
        later({ source: 'mls-ext', type: 'mlsAppSearchOpenResult', resp: opts.openResult(opens.length) });
        return;
      }
      if (d.type === 'mlsAppReadVisits') {
        reads.push({ name: d.name, at: now });
        later({ source: 'mls-ext', type: 'mlsAppReadVisitsResult', resp: opts.readResult(reads.length) });
      }
    },
    getPatients: () => patients,
    upsertPatient: () => true,
    renderProfile: () => {},
    __mlsVisitModel: {
      addVisit(pid, v) {
        const p = patients.find((x) => x.id === pid);
        if (!p) return null;
        p.visits.push({ date: v.date, type: v.type, raw: v.raw, source: v.source });
        return true;
      }
    }
  };
  if (opts.toast !== null) {
    const fn = function (msg, type) { toasts.push({ msg: String(msg), type: String(type || '') }); return null; };
    if (opts.quietWrapped) fn.__mlsQuietWrapped = true;
    sandbox.toast = fn;
  }
  if (opts.quiet) sandbox.__mlsQuietNotify = opts.quiet;
  if (opts.si !== null) {
    sandbox.__mlsSI = Object.assign({
      _athenaPresenceProbe: (ms) => {
        presenceCalls.push({ ms, at: now });
        return Promise.resolve(opts.presence ? opts.presence(presenceCalls.length) : null);
      },
      _todayNoteReasonCode: laneReasonCode,
      _todayNoteReasonCodes: () => ['pass-budget-exhausted', 'no-athena-tab', 'pull-in-flight', 'deadline',
        'surface-race', 'no-encounter', 'safety-stop', 'extension-too-old', 'reader-unavailable', 'other', 'unknown']
    }, opts.si || {});
  }
  sandbox.window = sandbox;
  sandbox.self = sandbox;

  const runtimeSrc = Object.prototype.hasOwnProperty.call(opts, 'moduleSrc') ? opts.moduleSrc : activeModuleSrc;
  const runtimeLabel = opts.moduleLabel || activeModuleLabel;
  vm.runInContext(runtimeSrc, vm.createContext(sandbox),
    { filename: runtimeLabel + ':visits-backfill' });

  async function flush(turns) { for (let i = 0; i < (turns || 25); i++) await Promise.resolve(); }
  /* fire timers in time order, jumping the virtual clock to each, until done()
     or the step budget is spent. */
  async function drive(done, maxSteps) {
    const budget = maxSteps || 600;
    for (let step = 0; step < budget; step++) {
      await flush();
      if (done && done()) return true;
      const live = timers.filter((t) => !t.dead && !t.fired);
      if (!live.length) { await flush(); return !!(done && done()); }
      live.sort((a, b) => a.at - b.at);
      const t = live[0];
      t.fired = true;
      if (t.at > now) now = t.at;
      try { t.fn(); } catch (e) { /* a module timer threw */ }
    }
    await flush();
    return !!(done && done());
  }

  return {
    api: () => sandbox.__mlsVisitsBackfill,
    sandbox, patients, opens, reads, posted, toasts, presenceCalls,
    footSeen: dom.footSeen,
    footEl: () => dom.byId.get('mlsVbfStatus') || null,
    now: () => now,
    drive, flush
  };
}

const NAME = 'Jane Q. Doe';
const OPEN_FAILED = { ok: false, findReason: 'Open your signed-in athenaOne in another tab, then try again' };
const OPEN_OK = { ok: true, opened: true };
const VISITS_OK = {
  ok: true,
  identity: { name: NAME, dob: '01/02/1970' },
  visits: [{
    date: '2026-08-14', type: 'Office visit', provider: 'Dr Synthetic',
    text: 'Synthetic encounter text long enough to clear the junk-row minimum length.'
  }]
};
const ended = (h) => () => { const s = h.api().state; return !s.running && s.done > 0; };

async function autoBackfillHonorsFullNotesScope() {
  const h = makeSandbox({ openResult: () => OPEN_OK, readResult: () => VISITS_OK });
  const api = h.api();
  h.sandbox.__mlsVisitNotesPref = { read: () => ({ state: 'off', on: false }) };
  eq(api.enqueueFromRun([{ name: NAME, ok: true }], { receipt: { visitNotesRequested: false } }), 0,
    'an OFF pull receipt armed the automatic individual-visits backfill');
  eq(api.enqueueFromRun([{ name: NAME, ok: true }]), 0,
    'the falling-edge path ignored the shared Full Notes OFF setting');
  h.sandbox.__mlsVisitNotesPref = { read: () => ({ state: 'on', on: true }) };
  eq(api.enqueueFromRun([{ name: NAME, ok: true }], { receipt: { visitNotesRequested: true } }), 1,
    'an explicit ON receipt could not arm the backfill control case');
  api.stop();
}

/* ---- 6a  the footer never prints a patient name -------------------------- */
async function footerIsPhiFree() {
  const h = makeSandbox({
    openResult: () => OPEN_FAILED,
    readResult: () => VISITS_OK,
    presence: () => ({ athenaOpen: false, reason: 'no-athena-tab' })
  });
  const api = h.api();
  ok(api && api.version, 'the visits-backfill module did not install in the harness');
  eq(api.runOnce([NAME], { force: true }), 1, 'the name-shaped fixture was not queued');

  ok(await h.drive(() => {
    const el = h.footEl();
    return !!el && el.textContent.indexOf('Finishing') === 0;
  }), 'the footer never showed the in-progress sentence');
  const running = h.footEl().textContent;
  ok(/^Finishing today's notes in the background \(\d+ left\)$/.test(running),
    'the in-progress footer is not the sanctioned sentence plus a count: ' + JSON.stringify(running));

  ok(await h.drive(ended(h)), 'the pump never finished');
  eq(h.footEl().textContent, SENTENCE_LATER,
    'the ended-with-work-left footer is not the sanctioned sentence');
  eq(h.footEl().getAttribute('data-mls-quiet'), 'outcome',
    'the footer is not marked as a quiet line');

  /* every byte the footer ever held, not just the last one */
  ok(h.footSeen.length >= 2, 'the footer was never painted');
  for (const seen of h.footSeen) {
    ok(seen.indexOf('Jane') < 0 && seen.indexOf('Doe') < 0,
      'a patient name reached the footer: ' + JSON.stringify(seen));
    ok(seen.indexOf('open-failed') < 0 && seen.indexOf('athenaOne') < 0 && seen.indexOf('reading ') < 0,
      'a raw engineering reason reached the footer: ' + JSON.stringify(seen));
  }
  /* the name and the raw reason are not DELETED - they moved to diagnostics */
  const diag = api.diagnostics();
  ok(diag.indexOf(NAME) > 0, 'the copyable diagnostics lost the patient name the footer used to print');
  ok(diag.indexOf('open-failed') > 0, 'the copyable diagnostics lost the raw reason');
  const receipt = JSON.stringify(api.receipt());
  ok(receipt.indexOf('Jane') < 0 && receipt.indexOf('Doe') < 0, 'the PHI-free receipt carries a patient name');
  ok(receipt.indexOf('open-failed') < 0, 'the PHI-free receipt carries a raw reason string');
  /* and the raw status is still available to a diagnostic caller */
  ok(String(api.state.status).length > 0, 'STATE.status stopped carrying the raw engineering line');
  api.revert();
}

/* ---- 6b  open-failed -> presence VERIFIED -> retried -> recovered -------- */
async function presenceVerifiedRecovers() {
  const h = makeSandbox({
    openResult: (n) => (n === 1 ? OPEN_FAILED : OPEN_OK),
    readResult: () => VISITS_OK,
    presence: () => ({ athenaOpen: true, reason: 'presence-verified' })
  });
  const api = h.api();
  eq(api.runOnce([NAME], { force: true }), 1, 'the fixture was not queued');
  ok(await h.drive(ended(h)), 'the pump never finished the recovery scenario');

  const r = api.receipt();
  eq(h.presenceCalls.length, 1, 'the presence verb was not asked exactly once');
  eq(h.presenceCalls[0].ms, 3500, 'the presence probe was not given the lane"s 3.5 s budget');
  eq(h.opens.length, 2, 'the patient was not re-driven after presence was verified');
  eq(r.presenceChecks, 1, 'receipt: presenceChecks');
  eq(r.presenceVerified, 1, 'receipt: presenceVerified');
  eq(r.retried, 1, 'receipt: retried');
  eq(r.recovered, 1, 'receipt: recovered - the retried patient did not end ok');
  eq(r.backoffMs, 2000, 'the first retry did not wait the sanctioned 2 s');
  eq(r.codes['no-athena-tab'], 1, 'the refusal was not counted under the lane code');
  eq(api.state.ok, 1, 'the recovered patient was not booked ok');
  eq(h.patients[0].visits.length, 1, 'the recovered patient filed no visit');
  eq(api.receipt().footer, '', 'a finished, fully recovered run still shows a footer');
  /* the count is a number the doctor reads, so it must be honest even during
     the backoff: ONE patient can never be reported as two left. */
  const overCounted = h.footSeen.filter((t) => /\((?:[2-9]|\d\d+) left\)/.test(t));
  assert.deepStrictEqual(overCounted, [],
    'the footer over-counted the queue while a retried patient was in backoff');
  checks++;
  api.revert();
}

/* ---- 6c  presence ABSENT -> honest, and nothing re-driven --------------- */
async function presenceAbsentIsHonest() {
  const h = makeSandbox({
    openResult: () => OPEN_FAILED,
    readResult: () => VISITS_OK,
    presence: () => ({ athenaOpen: false, reason: 'no-athena-tab' })
  });
  const api = h.api();
  eq(api.runOnce([NAME], { force: true }), 1, 'the fixture was not queued');
  ok(await h.drive(ended(h)), 'the pump never finished the presence-absent scenario');

  const r = api.receipt();
  eq(h.presenceCalls.length, 1, 'the presence verb was not asked');
  eq(h.opens.length, 1, 'a patient was re-driven although athena was proven ABSENT');
  eq(r.presenceAbsent, 1, 'receipt: presenceAbsent');
  eq(r.retried, 0, 'receipt: retried must stay 0 when presence is absent');
  eq(r.recovered, 0, 'receipt: recovered must stay 0 when presence is absent');
  eq(r.backoffMs, 0, 'a backoff was spent on an absent athena');
  eq(api.state.rows.length, 1, 'the attempt was not booked as a row');
  eq(api.state.rows[0].presenceVerdict, 'presence-absent', 'the honest verdict was not recorded on the row');
  eq(api.state.rows[0].ok, false, 'an unrecovered row was booked as ok');
  ok(api.state.rows[0].reason.indexOf('open-failed') === 0, 'the row lost its raw reason');
  api.revert();
}

/* ---- 6d  no presence verb at all -> nothing re-driven ------------------- */
async function noProbeMeansNoRetry() {
  const h = makeSandbox({
    si: null,
    openResult: () => OPEN_FAILED,
    readResult: () => VISITS_OK
  });
  const api = h.api();
  eq(api.runOnce([NAME], { force: true }), 1, 'the fixture was not queued');
  ok(await h.drive(ended(h)), 'the pump never finished the no-probe scenario');

  const r = api.receipt();
  eq(h.opens.length, 1, 'a patient was re-driven with no presence evidence at all');
  eq(r.probeUnavailable, 1, 'receipt: probeUnavailable');
  eq(r.presenceUnknown, 1, 'receipt: presenceUnknown');
  eq(r.retried, 0, 'receipt: retried must stay 0 without evidence');
  /* the local fallback still classifies the refusal correctly without the lane */
  eq(api._bfReasonCode('open-failed:Open your signed-in athenaOne in another tab, then try again'), 'no-athena-tab',
    'the local fallback classifier does not recognise the measured refusal');
  eq(api._bfReasonCode('wrong-chart'), 'other', 'the local fallback invents a code it cannot know');
  api.revert();
}

/* ---- 6e  the retry is BOUNDED: two rounds, 2 s then 6 s ---------------- */
async function retryIsBounded() {
  const h = makeSandbox({
    openResult: () => OPEN_FAILED,
    readResult: () => VISITS_OK,
    presence: () => ({ athenaOpen: true, reason: 'presence-verified' })
  });
  const api = h.api();
  eq(api._bfConfig().rounds, 2, 'the round ceiling moved');
  /* the vm is a separate realm, so compare the VALUES, not the array identity */
  eq(JSON.stringify(Array.from(api._bfConfig().waits)), '[2000,6000]', 'the sanctioned backoff moved');
  eq(api.runOnce([NAME], { force: true }), 1, 'the fixture was not queued');
  ok(await h.drive(ended(h)), 'the pump never finished the bounded-retry scenario');

  const r = api.receipt();
  eq(h.opens.length, 3, 'the bounded retry did not spend exactly two extra rounds');
  eq(r.retried, 2, 'receipt: retried');
  eq(r.backoffWaits, 2, 'receipt: backoffWaits');
  eq(r.backoffMs, 8000, 'the backoff ladder is not 2 s then 6 s');
  eq(r.roundsExhausted, 1, 'the exhausted round was not recorded');
  eq(r.recovered, 0, 'nothing recovered, yet recovery was counted');
  /* an "athena-tab-unverified" answer is ALSO presence, per the pull lane */
  eq(api._bfPresenceLives({ reason: 'athena-tab-unverified' }), true,
    'a busy-render presence answer is being treated as an absent athena');
  eq(api._bfPresenceLives({ athenaOpen: false, reason: 'no-athena-tab' }), false,
    'an absent athena is being treated as present');
  eq(api._bfPresenceLives(null), false, 'no answer is being treated as proof of presence');
  api.revert();
}

/* ---- 6f  the block cannot raise a toast -------------------------------- */
async function quietByConstruction() {
  const quiet = { classify: CLASSIFY };
  const h = makeSandbox({
    quiet, quietWrapped: true,
    openResult: () => OPEN_OK,
    readResult: () => VISITS_OK,
    presence: () => ({ athenaOpen: true, reason: 'presence-verified' })
  });
  const api = h.api();
  const before = h.toasts.length;
  eq(api._bfQuiet(SENTENCE_LATER), 'info', 'the sanctioned deferred sentence was not routed to the quiet tray');
  eq(h.toasts.length, before + 1, 'the quiet line never reached the wrapped toast/tray');
  eq(api._bfQuiet(OLD_FOOTER), 'refused:action',
    'the block handed an action-needed line to toast() - that is the shouting this fix removes');
  eq(h.toasts.length, before + 1, 'an action-class line reached toast() from this block');
  api.revert();

  /* without quietnotify installed the block stays inline-only: it never calls a
     raw, unwrapped toast() by itself. */
  const h2 = makeSandbox({
    openResult: () => OPEN_OK, readResult: () => VISITS_OK,
    presence: () => ({ athenaOpen: true, reason: 'presence-verified' })
  });
  const api2 = h2.api();
  const before2 = h2.toasts.length;
  eq(api2._bfQuiet(SENTENCE_LATER), 'inline-only', 'the block did not fall back to the inline status line');
  eq(h2.toasts.length, before2, 'the block called an unwrapped toast()');
  api2.revert();
}

/* ---- 6g  mutation control: the harness catches BOTH original defects ----- */
async function legacyMutationIsCaught() {
  const h = makeSandbox({
    moduleSrc: LEGACY_CONTROL_SRC,
    moduleLabel: 'TEST-MUTATION-legacy-b121',
    openResult: () => OPEN_FAILED,
    readResult: () => VISITS_OK,
    presence: () => ({ athenaOpen: true, reason: 'presence-verified' })
  });
  const api = h.api();
  ok(api && api.version, 'the legacy mutation control did not install');
  eq(api.runOnce([NAME], { force: true }), 1, 'the mutation-control fixture was not queued');
  ok(await h.drive(ended(h)), 'the mutation-control pump never finished');

  eq(h.presenceCalls.length, 0,
    'the no-retry mutation still asked the presence verb; the negative control is not causal');
  eq(h.opens.length, 1,
    'the no-retry mutation re-drove the patient; the negative control is not causal');
  ok(h.footSeen.some((t) => t.indexOf('Jane') >= 0 || t.indexOf('Doe') >= 0),
    'the raw-footer mutation did not leak the synthetic name; the PHI control would be insensitive');
  ok(h.footSeen.some((t) => t.indexOf('open-failed') >= 0),
    'the raw-footer mutation did not expose the synthetic reason; the footer control would be insensitive');
  ok(h.footSeen.some((t) => t.indexOf('Visit backfill: ') === 0),
    'the raw-footer mutation did not reproduce the measured legacy prefix');
  api.revert();
}

(async () => {
  const watchdog = setTimeout(() => {
    console.error('TIMEOUT: the b121 backfill footer suite did not settle');
    process.exit(1);
  }, 120000);

  await legacyMutationIsCaught();

  /* Run the complete matrix twice. The negative controls stay live on BOTH
     published identities: names/raw reasons must never reach the footer,
     absent or unknowable presence must never retry, retries must remain
     bounded, and action-class text must never reach toast(). */
  for (const lane of [[FORK, MODULE_SRC], [SHARED, PRODUCTION_MODULE_SRC]]) {
    activeModuleLabel = lane[0];
    activeModuleSrc = lane[1];
    await footerIsPhiFree();
    await presenceVerifiedRecovers();
    await presenceAbsentIsHonest();
    await noProbeMeansNoRetry();
    await retryIsBounded();
    await quietByConstruction();
    await autoBackfillHonorsFullNotesScope();
  }

  clearTimeout(watchdog);
  console.log('PASS b121 backfill footer (' + checks + ' checks): production is the exact promoted 1p pack modulo official ' +
    'lane identity, cloned derivation is pristine, and the production-only signup exception is explicitly bounded; the complete runtime matrix passes on both published identities; the ' +
    'footer is two sanctioned sentences and a count with the name and raw reason moved to copyable diagnostics; a ' +
    'no-athena-tab refusal asks __mlsSI._athenaPresenceProbe and is re-driven ONLY while presence is verified (2 s then ' +
    '6 s, two rounds, then stop), absent or unknowable presence re-drives nothing, reason codes come from ' +
    '_todayNoteReasonCode, and the real quietnotify classifier keeps both sentences quiet while the replaced footer is a ' +
    'live action-class negative control; OFF receipts/settings cannot arm automatic visit backfill while an explicit ON receipt can');
})().catch((err) => { console.error(err); process.exit(1); });
