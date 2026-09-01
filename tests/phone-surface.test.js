'use strict';

/* phone-surface  (2026-09-01, phone verification lane)
 * ============================================================================
 * WHY THIS FILE EXISTS.
 *
 * The phone is the one surface of this product that nobody edits. Builds b1131
 * through b1162 rewrote the shell, the dock, the writeflow, the templates and
 * the reports, and not one of those commit messages says the word "phone". The
 * phone still worked, mostly - but one thing had already gone wrong quietly and
 * it is the reason this file is here:
 *
 *   dupadopt-1.0.0 (b1124, 2026-08-30) changed _calExactLocalTarget in the
 *   SHELL so that duplicate charts of one person stop blocking Start Recording.
 *   That resolver is not a desktop resolver. The phone's Day rows reach it too,
 *   through the same Easy startVisitFor. The lane ran six suites, none of them
 *   the phone's, and tests/phone-day-row-record-identity-runtime went red at
 *   b1124 and stayed red through thirty-eight builds.
 *
 * Nothing about that was a bad change. The behaviour is correct and owner-ruled.
 * What failed is that a shared seam moved and the phone half of it was invisible
 * to the lane that moved it. So this file pins the SEAMS - the places where the
 * phone depends on something a non-phone lane owns - rather than re-testing the
 * phone's own behaviour, which its twenty-nine other suites already cover.
 *
 * Every assertion here is a cross-file or cross-lane dependency. If one of them
 * reds, a lane that was not thinking about phones has just changed something a
 * phone needs. That is exactly the notification that did not exist at b1124.
 *
 * No network, no browser, no PHI, no extension. Source and JSON only.
 *
 * Run: node tests/phone-surface.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

let checks = 0;
function ok(cond, msg) { checks++; assert(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

/* The three lanes, named the way the derive scripts name them. A phone seam
   that holds in one lane and not another is a derive defect, so every seam
   below is checked in all three. */
const LANES = [
  { lane: '1p', shell: '1pScribeFlow.html', connect: '1p-mls-connect.js', writeflow: '1p-feat_mls_writeflow.js' },
  { lane: 'production', shell: 'ScribeFlow.html', connect: 'mls-connect.js', writeflow: 'feat_mls_writeflow.js' },
  { lane: 'cloned', shell: 'cloned/index.html', connect: 'cloned-mls-connect.js', writeflow: 'cloned-feat_mls_writeflow.js' }
];
const SRC = {};
for (const l of LANES) {
  SRC[l.lane] = { shell: read(l.shell), connect: read(l.connect), writeflow: read(l.writeflow), names: l };
}
/* The phone module itself has NO lane fork - production, /1p and /cloned all
   serve these same bytes. That is stated in mls-connect.js's own phclean-1.0.0
   header and it is why every fix for the phone lives in a file this repo forks.
   Pin it, because the day someone adds a 1p-feat_mls_phone_ui.js the overlays
   in mls-connect.js silently start fighting a second copy of the module. */
const phone = read('feat_mls_phone_ui.js');
ok(!fs.existsSync(path.join(ROOT, '1p-feat_mls_phone_ui.js')),
  'feat_mls_phone_ui.js gained a 1p fork; the mls-connect overlays assume one shared copy');
ok(!fs.existsSync(path.join(ROOT, 'cloned-feat_mls_phone_ui.js')),
  'feat_mls_phone_ui.js gained a cloned fork; the mls-connect overlays assume one shared copy');

/* ==========================================================================
 * A. THE MAP. Four surfaces answer to the word "phone" and they are different
 *    products. A doctor reaches each one a different way, and a lane that
 *    retires one of them without the others is how a QR code starts pointing
 *    at a 404.
 * ========================================================================*/
const inventory = JSON.parse(read('pages-publication-inventory.json'));
const published = JSON.stringify(inventory);
for (const asset of ['phone.html', 'phone-setup.html', 'phone-manifest.json',
  'app.html', 'feat_mls_phone_ui.js', 'feat_mls_force_full_phone.js',
  'feat_mls_mobile_encounter.js']) {
  ok(fs.existsSync(path.join(ROOT, asset)), `phone surface asset ${asset} is missing from the repo`);
  ok(published.includes('"' + asset + '"'),
    `${asset} is not in pages-publication-inventory.json, so Pages will not serve it`);
}

/* A1. phone-setup.html is the only page that explains the choice, and both of
   its buttons must keep going where they say they go. `?phone=1` is one of the
   four clauses the phone loader accepts; drop it and the primary CTA hands a
   handheld the desktop app. */
const setup = read('phone-setup.html');
ok(/href="ScribeFlow\.html\?phone=1"/.test(setup),
  'phone-setup.html primary CTA no longer opens the app in phone mode');
ok(/href="app\.html"/.test(setup),
  'phone-setup.html no longer offers the small read-only app');

/* A2. Three manifests, three scopes, three different apps. If two of them ever
   claim the same start_url the installed icons collide on the Home Screen. */
const manifests = {
  'phone-manifest.json': '/phone.html',
  'app-manifest.json': '/app.html',
  'manifest.webmanifest': '/ScribeFlow.html'
};
const starts = [];
for (const file of Object.keys(manifests)) {
  const m = JSON.parse(read(file));
  eq(m.start_url, manifests[file], `${file} start_url moved`);
  starts.push(m.start_url);
}
eq(new Set(starts).size, starts.length, 'two phone manifests now claim the same start_url');

/* ==========================================================================
 * B. THE LOADER. One eager loader in mls-connect.js decides whether a device
 *    gets the phone app at all. ph3-1.0.0 shipped a fix here for a setting
 *    that saved and did nothing: wantPhone() had read mls_layout_pref since
 *    dr-1.5.0 but the loader that FETCHES the file did not, so Settings ->
 *    "Simple phone app" answered yes in one place and never loaded anything.
 *    Both halves of that fix are pinned, in every lane.
 * ========================================================================*/
for (const l of LANES) {
  const c = SRC[l.lane].connect;
  const loader = /;\(function\(\)\{try\{var want=false;var lay=''[\s\S]{0,1400}?feat_mls_phone_ui\.js'\);/.exec(c);
  ok(loader, `${l.lane}: the phone loader is no longer recognisable in ${l.connect}`);
  const text = loader[0];
  ok(text.indexOf("localStorage.getItem('mls_layout_pref')") >= 0,
    `${l.lane}: the phone loader stopped reading the Settings layout preference`);
  ok(text.indexOf("if(lay==='full')return;") >= 0,
    `${l.lane}: the phone loader no longer honours an explicit "full desktop" preference`);
  ok(text.indexOf("if(lay==='simple')want=true;") >= 0,
    `${l.lane}: the phone loader no longer honours an explicit "simple phone app" preference`);
  ok(/\[\?&\]phone=1/.test(text),
    `${l.lane}: the phone loader stopped honouring ?phone=1, which phone-setup.html links to`);
  /* Window width must never classify a device. It did once, and narrow-windowed
     laptops went into phone mode. */
  ok(!/innerWidth|matchMedia|clientWidth/.test(text),
    `${l.lane}: the phone loader started classifying devices by window width`);
  /* Deliberately NOT deferred: this module hides the desktop chrome, so
     deferring it past first paint shows a doctor the dock and the workspace
     for a second before replacing them. */
  ok(text.indexOf('__mlsDeferAsset') < 0,
    `${l.lane}: the phone module was routed through the deferred-asset scheduler; it must load eagerly`);
}

/* ==========================================================================
 * C. THE PHONE-CONFIRMED WRITE SEAM. This is the interplay the extension is
 *    actually part of, and it is a THREE-file contract nothing else checks as
 *    a whole:
 *
 *      feat_mls_writeflow.js   builds the confirmation sheet and stamps the
 *                              go button with data-mls-preview-hash
 *      mls-connect.js          (phsend/phconfirm) reads that hash, relays it
 *                              to the phone, and presses that same button
 *      content.js (extension)  reads the same attribute off the clicked button
 *
 *    A writeflow refactor that renames either element id, or stops setting the
 *    attribute, breaks a phone two rooms away and reds nothing that mentions
 *    phones. Pin it in every lane.
 * ========================================================================*/
for (const l of LANES) {
  const wf = SRC[l.lane].writeflow;
  const c = SRC[l.lane].connect;

  /* C1. The writeflow still CREATES both elements the phone half addresses. */
  ok(/ov\.id = 'mlsAthenaActionConfirm'/.test(wf),
    `${l.lane}: the writeflow no longer creates #mlsAthenaActionConfirm - the phone's abandon watchdog polls that id`);
  ok(/id="mlsAthenaActionGo"/.test(wf),
    `${l.lane}: the writeflow no longer renders #mlsAthenaActionGo - the phone presses that button`);

  /* C2. And still stamps the binding the phone confirms against. Without the
     attribute phsendPressStagedConfirm refuses every time and the doctor is
     told the computer could not complete a confirmation it prepared. */
  ok(/go\.setAttribute\('data-mls-preview-hash', previewHash\)/.test(wf),
    `${l.lane}: the writeflow stopped stamping data-mls-preview-hash on the confirm button`);

  /* C3. The phone half still addresses exactly those names. */
  ok(c.indexOf("document.getElementById('mlsAthenaActionGo')") >= 0,
    `${l.lane}: the phone confirm leg no longer looks up the writeflow's go button`);
  ok(c.indexOf("document.getElementById('mlsAthenaActionConfirm')") >= 0,
    `${l.lane}: the phone confirm leg no longer watches the writeflow's confirmation sheet`);

  /* C4. The capability switch. Absent phoneConfirmedWriteV1 the whole remote
     path is inert and the flow is the staged-desktop-confirm behaviour. This
     is the ONE place the extension's pong reaches the phone lane. */
  ok(/phoneConfirmedWriteV1 === true/.test(c),
    `${l.lane}: the phone-confirmed write is no longer gated on the extension capability`);

  /* C5. The relay runner allowlist stays the two NON-FINAL actions. A phone may
     never reach sign / order / billing, whatever the server or extension allow. */
  const actions = /var PHSEND_ACTIONS = \{([^}]*)\}/.exec(c);
  ok(actions, `${l.lane}: PHSEND_ACTIONS is no longer an explicit object literal`);
  assert.deepStrictEqual(
    actions[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean).sort(),
    ['save_draft', 'write_note'],
    `${l.lane}: the phone's relayable action set changed`);
  checks++;

  /* C6. The phone's note text comes from the shell's own note box, and its
     visibility from the Easy engine's snapshot. Rename either and the Send to
     Athena bar silently never appears. */
  ok(c.indexOf("document.getElementById('noteBox')") >= 0,
    `${l.lane}: the phone send bar no longer reads the shell note box`);
  ok(/#noteBox|id="noteBox"/.test(SRC[l.lane].shell),
    `${l.lane}: the shell no longer carries #noteBox, which the phone send bar reads`);
  ok(c.indexOf('window.__mlsEasyV32') >= 0,
    `${l.lane}: the Easy engine global the phone send bar reads is gone`);
}

/* C7. The extension's own half of the same attribute. background.js is
   read-only in this lane and content.js is the extension's content script -
   this only ASSERTS the shape both sides already agree on. */
const extContent = read('content.js');
ok(/data-mls-preview-hash/.test(extContent),
  'the extension content script no longer reads data-mls-preview-hash');
ok(/phoneConfirmedWriteV1: true/.test(extContent),
  'the extension pong no longer advertises phoneConfirmedWriteV1');

/* C8. The phone confirm bar mounts into the ph3 frame by id. The phone module
   and mls-connect.js are different files with no shared constant, so these two
   spellings can drift apart in silence. */
for (const id of ['mlsPh3', 'mlsPh3Act']) {
  ok(phone.indexOf(id) >= 0, `feat_mls_phone_ui.js no longer builds #${id}`);
  ok(SRC.production.connect.indexOf("getElementById('" + id + "')") >= 0,
    `mls-connect.js no longer mounts the phone send bar against #${id}`);
}

/* ==========================================================================
 * D. ONE RESOLVER, NOT TWO. The phone opens a Day row by delegating to the
 *    shared Easy engine; it does not carry its own idea of which chart a
 *    schedule row belongs to. That is the property dupadopt moved underneath,
 *    and it is worth having in writing: the correct response to a phone
 *    identity defect is to fix the shared resolver, never to give the phone a
 *    second one.
 * ========================================================================*/
ok(/r\.startVisitFor\(id, \{ record: false/.test(phone),
  'the phone Day row no longer delegates to the shared Easy startVisitFor');
ok(!/getPatients\(\)/.test(phone),
  'feat_mls_phone_ui.js started resolving charts itself; identity has one owner');

/* D1. And the shared resolver still carries dupadopt's law in BOTH directions.
   Adopting one survivor is what unblocked recording; refusing a pool that holds
   two DIFFERENT MRNs or DOBs is what keeps two people two people. The runtime
   proof of both lives in tests/phone-day-row-record-identity-runtime; this pins
   that the code is still shaped to be capable of them. */
for (const l of LANES) {
  const s = SRC[l.lane].shell;
  const surv = /function _calDupSurvivor\(pool\)\{([\s\S]*?)\n\}/.exec(s);
  ok(surv, `${l.lane}: _calDupSurvivor is gone from the shell`);
  ok(/if\(Object\.keys\(mrns\)\.length>1\) return null;/.test(surv[1]),
    `${l.lane}: the duplicate survivor stopped refusing a pool holding two DIFFERENT MRNs`);
  ok(/if\(Object\.keys\(dobs\)\.length>1\) return null;/.test(surv[1]),
    `${l.lane}: the duplicate survivor stopped refusing a pool holding two DIFFERENT DOBs`);
  ok(/_calDupSurvivor\(hits\)/.test(s),
    `${l.lane}: the exact-local-target resolver no longer reaches the duplicate survivor`);
}

/* D2. The suite that caught this must stay registered. It was registered the
   whole time and still went unnoticed for thirty-eight builds, so registration
   is a floor, not a ceiling - but an unregistered suite is not even a floor. */
const runAll = read(path.join('tests', 'run-all.js'));
const phoneSuites = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter(n => /\.test\.js$/.test(n) && /(phone|mobile)/i.test(n));
ok(phoneSuites.length >= 20, 'the phone suite family shrank unexpectedly');
for (const suite of phoneSuites) {
  ok(runAll.indexOf("'" + suite + "'") >= 0,
    `${suite} is not registered in run-all.js, so nothing runs it`);
}

/* ==========================================================================
 * E. WHAT A PHONE CANNOT DO. MLS Assist is a Chrome extension; iOS and Android
 *    cannot install one. Every phone-facing claim about athenaOne therefore has
 *    to route through an office computer, and the app has to keep saying so.
 * ========================================================================*/
for (const l of LANES) {
  const c = SRC[l.lane].connect;
  ok(/function canHostExtension\(\)/.test(c),
    `${l.lane}: canHostExtension() is gone; a phone can be set as the office computer again`);
  ok(/function roleUnhonourable\(r\) \{ return r === 'office' && !canHostExtension\(\); \}/.test(c),
    `${l.lane}: the office role is no longer refused on a device that cannot host the extension`);
}
/* The phone app names the machine AND the next move for every relayed-pull
   blocker. A blocker with no next move is half a message. */
ok(/MLS Assist is not responding on/.test(phone),
  'the phone lost its honest "the extension is not answering over there" blocker');
ok(/cannot sign in for it/.test(phone),
  'the phone lost its honest "athenaOne is signed out over there" blocker');

/* And the phone must never print a chart write the office computer did not
   verify. phverif-1.0.0 is the direction that under-claims on purpose. */
for (const l of LANES) {
  const c = SRC[l.lane].connect;
  ok(/verifiedWrite === true/.test(c),
    `${l.lane}: the phone stopped distinguishing a verified Athena write from a staged one`);
  ok(/Athena has NOT confirmed a note write/.test(c),
    `${l.lane}: the phone lost the sentence it prints when nothing was actually written`);
}

/* ==========================================================================
 * F. ph3quiet-1.0.0. The phone module's budget is written down and absolute:
 *    "A MOUNTED, IDLE, VISIBLE PHONE HOLDS NO TIMERS AT ALL." b1143 armed a
 *    500 ms poller in the shell with no guard of any kind, and every pass of it
 *    forces a style resolution (getComputedStyle) for a History screen the
 *    phone app does not have. Four shells carry that code and all four must
 *    carry the guard - the two 1p sources are edited by hand, the two outputs
 *    are derived, and a shell that drifts is a phone that drains.
 * ========================================================================*/
const SHELL_FILES = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
for (const f of SHELL_FILES) {
  const s = read(f);
  ok(/function phoneOwnsPage\(\) \{\s*return safe\(function \(\) \{ return !!document\.getElementById\('mlsPh3'\); \}, false\);/.test(s),
    `${f}: the History poller lost its phone test`);
  ok(/if \(!phoneOwnsPage\(\)\) timer = safe\(function \(\) \{ return setInterval\(tick, 500\); \}, null\);/.test(s),
    `${f}: the History poller is minted again without asking whether the phone owns the page`);
  ok(/if \(phoneOwnsPage\(\)\) \{\s*if \(timer\) \{ safe\(function \(\) \{ clearInterval\(timer\); \}\); timer = null; \}/.test(s),
    `${f}: the History poller no longer retires itself when the phone app mounts after it armed`);
  /* Both orders matter and neither check is sufficient alone, so neither may be
     quietly dropped as redundant. */
  eq((s.match(/phoneOwnsPage\(\)/g) || []).length, 3,
    `${f}: the phone test is no longer used in all three places (definition, mint guard, self-retire)`);
}

/* ==========================================================================
 * G. phrefuse-1.0.0, at RUNTIME. startAthenaAction refuses in eleven places
 *    before a confirmation sheet exists and calls opts.onResult in none of
 *    them - it answers a LOCAL caller by painting the desk status line. The
 *    phone runner used to discard that promise, so a refused send went quiet
 *    and the phone blamed the doctor nine minutes later for a refusal the
 *    computer had already made. opbatch made that the ordinary case rather
 *    than a rare one: an op-note batch holds the unified review open across a
 *    whole day's queue, and 'unified-review-open' is what a phone send gets.
 *
 *    The relay module is executed for real; only the writeflow is stubbed,
 *    because the shape being pinned is exactly what the phone does with the
 *    writeflow's ANSWER.
 * ========================================================================*/
const vm = require('vm');
const sendSuite = read(path.join('tests', '1p-phone-send-to-athena-contract.test.js'));
const connect1p = SRC['1p'].connect;
const relayStart = connect1p.indexOf('/* ===== __mlsRelayLink rl-1.0.0');
const relayEnd = connect1p.indexOf('/* ===== __mlsPhoneHome ph-1.0.0');
ok(relayStart > 0 && relayEnd > relayStart, 'the relay module is no longer locatable for runtime evaluation');
let relaySrc = connect1p.slice(relayStart, relayEnd);
relaySrc = relaySrc.slice(0, relaySrc.lastIndexOf('})();') + 5);
ok(relaySrc.indexOf('phrefuse-1.0.0') >= 0, 'the sliced relay module no longer contains the phrefuse block');

/* Reuse the phone lane's established browserless DOM and relay sandbox rather
   than writing a second interpretation of how this module is stood up. */
const hStart = sendSuite.indexOf('function makeEl(id, tag) {');
const hEnd = sendSuite.indexOf('const flush = () =>');
ok(hStart > 0 && hEnd > hStart, 'the phone relay harness is no longer extractable from its own suite');
const harness = new Function('assert', 'vm', 'relaySrc',
  sendSuite.slice(hStart, hEnd) + '\nreturn harness;')(assert, vm, relaySrc);

const flush = () => new Promise((r) => setImmediate(r));
const JOB = (id) => ({ id, payload: { action: 'write_note', noteText: 'Reviewed note body.', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });

/* Refuse the way startAthenaAction refuses: resolve a value, never call
   onResult, never build a sheet. */
function refusingFlow(h, value, reject) {
  h.ctx.window.__mlsWriteFlow = {
    startAthenaAction: (action, o) => {
      h.ctx.__wf = { action, opts: o };
      return reject ? Promise.reject(new Error('boom')) : Promise.resolve(value);
    }
  };
}

async function main() {
  /* G1. The refusal opbatch makes routine, answered at once and by name. */
  {
    const h = harness({});
    refusingFlow(h, { ok: false, error: 'unified-review-open' });
    const out = await h.api.runSendNote(JOB('g1'));
    eq(out.ok, false, 'a refused send must not read as sent');
    ok(/[Aa]nother Athena review is already open/.test(out.error),
      'the phone must name the op-note batch holding the review, not blame the doctor for not confirming');
    ok(/[Nn]othing was sent/.test(out.error), 'a refusal must say nothing was sent');
    ok(!/[Nn]obody confirmed/.test(out.error),
      'the refusal is still being reported as a nine-minute human timeout');
  }

  /* G2. And it is answered WITHOUT waiting out the deadline. This is the whole
     point: the old behaviour also ended in ok:false, nine minutes later, with
     the wrong cause. Time is never advanced in this case. */
  {
    const h = harness({});
    refusingFlow(h, { ok: false, error: 'busy' });
    let settledEarly = false;
    const p = h.api.runSendNote(JOB('g2')).then((o) => { settledEarly = true; return o; });
    await flush(); await flush();
    eq(settledEarly, true, 'a pre-sheet refusal still makes the phone wait; it must answer immediately');
    const out = await p;
    ok(/[Aa]nother Athena action is already awaiting confirmation/.test(out.error),
      'the busy refusal must name what is busy and where');
  }

  /* G3. An unrecognised token is printed verbatim rather than smoothed into a
     sentence that hides which refusal fired. */
  {
    const h = harness({});
    refusingFlow(h, { ok: false, error: 'some-future-reason' });
    const out = await h.api.runSendNote(JOB('g3'));
    eq(out.ok, false, 'an unknown refusal must still fail');
    ok(out.error.indexOf('some-future-reason') >= 0,
      'an unrecognised refusal must carry its own token so the doctor can read it back');
    ok(/[Nn]othing was sent/.test(out.error), 'an unknown refusal must still say nothing was sent');
  }

  /* G4. The read-only probe's own wording beats anything invented here. */
  {
    const h = harness({});
    refusingFlow(h, { ok: false, error: 'Athena returned a different chart than the one MLS holds.' });
    const out = await h.api.runSendNote(JOB('g4'));
    ok(out.error.indexOf('Athena returned a different chart') === 0,
      'a human sentence from the probe must be forwarded, not replaced');
    ok(/[Nn]othing was sent\.$/.test(out.error), 'a forwarded sentence must still end by saying nothing was sent');
  }

  /* G5. A thrown/rejected check is an UNCERTAIN outcome, not a clean refusal.
     Claiming "nothing was written" here would be a claim this half cannot make. */
  {
    const h = harness({});
    refusingFlow(h, null, true);
    const out = await h.api.runSendNote(JOB('g5'));
    eq(out.ok, false, 'a thrown Athena check must not read as sent');
    ok(/did not say why/.test(out.error), 'a rejection must be reported as a rejection');
    ok(/check the open encounter/.test(out.error),
      'an uncertain outcome must send the doctor to look, not assert nothing happened');
  }

  /* G6. THE NON-REGRESSION. ok === true means the sheet is up and the answer
     still arrives through onResult - phrefuse must not pre-empt the living
     flow. Proven by driving the normal success to completion. */
  {
    const h = harness({});
    const p = h.api.runSendNote(JOB('g6'));
    await flush();
    ok(h.ctx.__wf, 'the normal path must still reach the write flow');
    h.standUpSheet('pv_ok');
    h.ctx.__wf.opts.onProbe({ ok: true, context: {} });
    h.advance(3000); await flush();
    h.ctx.__wf.opts.onResult({ ok: true }, { context: { encounterId: 'enc-1' }, verifiedWrite: true });
    const out = await p;
    eq(out.ok, true, 'phrefuse pre-empted a send that was still alive');
    eq(out.data.verifiedWrite, true, 'the verified-write receipt no longer reaches the phone');
    h.tearDownSheet();
  }

  /* G7. showActionConfirm's OWN refusal path calls onResult and then the outer
     promise still resolves ok:true. Exactly one answer must reach the phone,
     and it must be the specific one onResult carried - not phrefuse's generic
     line arriving second. */
  {
    const h = harness({});
    const p = h.api.runSendNote(JOB('g7'));
    await flush();
    h.ctx.__wf.opts.onResult({ ok: false, error: 'The Athena chart does not match the saved patient identity.' }, { context: {} });
    const out = await p;
    eq(out.ok, false, 'a refuseAction result must still fail');
    ok(/does not match the saved patient identity/.test(out.error),
      'the specific refusal was replaced by the generic one');
  }
}

/* A SUITE CAN PASS WITHOUT RUNNING, and this one proved it on itself. With the
   phrefuse guard mutated out, G1's runSendNote promise never settles - and
   because every timer inside the harness is a fake one held in a Map, node's
   real event loop is empty, the process exits 0 having asserted nothing, and
   run-all (which judges on exit code) calls that green. The mutation test that
   was supposed to prove these assertions load-bearing instead printed nothing
   at all and was mistaken for a pass.

   Two guards, and both are needed. The real setTimeout holds the loop open so
   node cannot drain and leave; the exit hook is the one that cannot be argued
   with, because it fires on EVERY path out of the process, including one that
   never reached either half of the .then below. */
let finished = false;
const watchdog = setTimeout(function () {
  console.error('phone-surface: the runtime section never completed - some promise under test never settled.');
  process.exit(1);
}, 60000);
process.on('exit', function (code) {
  if (!finished && code === 0) {
    console.error('phone-surface: exited 0 without finishing. Nothing here was proven.');
    process.exitCode = 1;
  }
});

main().then(function () {
  finished = true;
  clearTimeout(watchdog);
  console.log('PASS phone-surface: ' + checks + ' checks - four phone surfaces published and distinctly scoped; ' +
    'the loader honours the Settings preference and never measures window width; the three-file phone-confirmed ' +
    'write seam (writeflow sheet ids + preview-hash stamp, mls-connect press, extension capability) holds in all ' +
    'three lanes; the phone owns no second chart resolver and dupadopt still refuses two people; every ' +
    'phone/mobile suite is registered; ph3quiet keeps the History poller off a phone in all four shells; and ' +
    'phrefuse carries a pre-sheet writeflow refusal to the phone at once, by name, without pre-empting a live send.');
}, function (err) {
  finished = true;
  clearTimeout(watchdog);
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
