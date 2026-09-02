'use strict';
/* gcx-1.0.0 control: A BLOCKED "GENERATE ONE NOTE" CLICK IS LOUD, AND THE
 * ANTI-INVENTION GATE STILL BLOCKS.
 *
 * Owner live repro 2026-08-27 (production): the big .ez3-big "Generate one
 * note" button reads fully enabled (disabled:false, opacity 1, pointer-events
 * auto, zero console errors) and clicking it does NOTHING VISIBLE while the
 * anti-invention evidence gate is refusing. Measured mechanisms:
 *   (1) toast() returns early when an identical message is already showing,
 *       so the 2nd..Nth refusal of the SAME sentence produced no toast at all;
 *   (2) the Easy facade re-rendered the identical warn banner, so the repaint
 *       changed zero pixels;
 *   (3) the ez3Gen handler's first arm was a bare `return` on !S.appt -- a
 *       literally silent dead click;
 *   (4) #ez3Gen shipped a hard `disabled` attribute for the empty-transcript
 *       case, and a disabled button swallows the click and explains nothing.
 *
 * This suite executes the REAL shipped bytes -- the shell's generation engine
 * (generateNote / _mlsRefuseGeneration / _mlsShoutGeneration /
 * _mlsFlashGenerationBlock / _mlsGenerationBlockReason), the shipped refusal
 * CSS, the shipped Easy gate-paint helpers, and the shipped ez3Gen click
 * handler -- in a real browser DOM. The gate itself is deliberately NOT
 * stubbed: part B proves a sparse transcript is still refused and never
 * reaches the model.
 *
 * OLD BYTES FAIL BY NAME: no _mlsShoutGeneration, no _mlsFlashGenerationBlock,
 * no _mlsGenerationBlockReason, no syncGenGateUi.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const twin = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

function between(text, startMarker, endMarker, label) {
  const start = text.indexOf(startMarker);
  assert.ok(start >= 0, 'missing shipped span start: ' + (label || startMarker));
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, 'missing shipped span end: ' + (label || endMarker));
  return text.slice(start, end);
}

function extractFn(text, marker) {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, 'missing shipped function: ' + marker);
  const open = text.indexOf('{', at + marker.length - 1);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i], next = text[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i += 1; continue; }
    if (ch === '/' && next === '*') { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error('unbalanced shipped function: ' + marker);
}

function handlerExpression(text, marker) {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, 'missing shipped handler: ' + marker);
  const start = text.indexOf('function () {', at);
  return extractFn(text.slice(start), 'function () {');
}

/* ---- the shipped bytes this control executes ---------------------------- */
const refusalCss = between(
  shell,
  '  @keyframes mlsGateShake{',
  '  /* 2026-07-30: a third level',
  'gcx refusal emphasis stylesheet'
);
const toastCss = between(
  shell,
  '  .toast{position:fixed;',
  '  /* ===== ENTRANCE, AND WHY IT CANNOT STRAND',
  'shipped toast stylesheet'
);
const toastFn = extractFn(shell, 'function toast(msg,type){');
const draftableFn = extractFn(shell, 'function _mlsTranscriptHasDraftableTodayEvidence(text)');
const engine = between(
  shell,
  'var _mlsGenerationSequence=0;',
  '/* =========================================================\n   AUTO-POPULATE EXTRAS',
  'shipped generation engine'
);
const gateReasonFn = extractFn(connect, 'function genGateReason() {');
/* RE-AIMED 2026-09-01 (genvis-1.0.0). paintGenGate gained a fourth parameter,
 * `run` - the read-only generation-lifecycle overlay published by the flow
 * lane - and syncGenGateUi now asks genRunOverlay() for it. This suite is
 * about the PRE-CLICK gate, which is unchanged: with no lane mounted (the case
 * below) genRunOverlay returns null and every assertion in this file measures
 * exactly what it measured before. The marker moved because the signature
 * moved; nothing here is weakened, and genRunOverlay is added to the bundle so
 * the shipped syncGenGateUi can be executed as shipped rather than stubbed. */
const paintGateFn = extractFn(connect, 'function paintGenGate(btn, reason, readyHint, run) {');
const runOverlayFn = extractFn(connect, 'function genRunOverlay() {');
const syncGateFn = extractFn(connect, 'function syncGenGateUi() {');
const shoutFn = extractFn(connect, 'function shoutGenBlock(message) {');
const ez3GenHandler = handlerExpression(connect, "on('ez3Gen', function () {");

/* The exact refusal sentence is READ from the shipped gate, never retyped:
 * this control must never be the place a second wording is invented. */
const refusalSentence = (function () {
  const at = shell.indexOf("code:'sparse-today-evidence',message:'");
  assert.ok(at >= 0, 'shipped sparse refusal sentence is missing');
  const from = at + "code:'sparse-today-evidence',message:'".length;
  return shell.slice(from, shell.indexOf("'", from));
})();
assert.ok(refusalSentence.indexOf('Add one specific detail from today') === 0,
  'the shipped refusal no longer opens with the sentence the owner sees');

/* ---- source pins: the silent shapes must not come back ------------------ */
assert.ok(shell.includes('function _mlsShoutGeneration(message){'),
  'the shell no longer ships the repeat-refusal re-announcer');
assert.ok(shell.includes('function _mlsFlashGenerationBlock(message){'),
  'the shell no longer ships the refusal banner emphasis');
assert.ok(shell.includes('function _mlsGenerationBlockReason(text){'),
  'the shell no longer exposes the read-only pre-click gate verdict');
assert.ok(shell.includes('_mlsFlashGenerationBlock(message);'),
  'the refusal path no longer emphasises the banner');
assert.ok(!shell.includes("if(showToast!==false)toast(message,'err');"),
  'the refusal path fell back to the deduped toast, so a repeat click is silent again');
assert.ok(!ez3GenHandler.includes('if (!S.appt || !requireExactScheduledBinding'),
  'the ez3Gen handler restored its silent !S.appt early return');
assert.ok(!connect.includes("id=\"ez3Gen\"' + (tx.trim().length ? '' : ' disabled')"),
  'the Generate hero is hard-disabled again, so a blocked click is swallowed');
assert.ok(extractFn(connect, 'function syncTx() {').includes('syncGenGateUi();'),
  'the blocked/ready state is no longer re-derived on every transcript keystroke');
assert.ok(connect.includes("'.ez3-big.dim{background:"),
  'the hero button lost the dim skin the blocked state renders in');
assert.ok(connect.includes("'#mlsEz3 .ez3fl-gen[aria-disabled=\"true\"]"),
  'the top-lane Generate lost its blocked skin');
assert.ok(/\.toast\{[^}]*pointer-events:none/.test(shell),
  'the transient notice can swallow the click on the control it is explaining again');

/* The two 1p shells ship as twins: an emphasis that lands in only one of them
 * is a fix on a screen half the traffic never sees. */
[
  'function _mlsShoutGeneration(message){',
  'function _mlsFlashGenerationBlock(message){',
  'function _mlsGenerationBlockReason(text){',
  '@keyframes mlsGateShake{'
].forEach((needle) => {
  assert.strictEqual(
    (shell.split(needle).length - 1),
    (twin.split(needle).length - 1),
    '1pScribeFlow.html and 1p/index.html disagree about: ' + needle
  );
});

/* The SHIPPED toast geometry, not test furniture: this notice is fixed at
 * z-index 99999 near the top of the viewport, so the hero is positioned under
 * it on purpose. If the toast ever regains pointer-events it will swallow the
 * very next click on the control whose refusal it is explaining -- which is
 * the second half of the reported dead click, and this page will catch it. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
${toastCss}
${refusalCss}
  :root{--red:#b4231e;--ink:#1A211C;--mls-notice-top:70px;--mls-dur-1:.1s;--mls-dur-2:.15s;--mls-dur-3:.2s;
    --mls-ease-inout:ease-in-out;--mls-ease-out:ease-out;--mls-ease-spring:ease-out}
  body{margin:0;height:2400px}
  .ez3-warnbar{padding:10px;border:1px solid #b4231e}
  .ez3-big{display:block;width:600px;height:82px;margin:20px auto}
</style></head><body>
  <div class="toast" id="toast"></div>
  <div id="ez3Wrap">
    <div class="ez3-warnbar" role="status"></div>
    <button type="button" class="ez3-big" id="ez3Gen">Generate one note<small>Uses every recorded and typed segment above</small></button>
    <textarea id="ez3Transcript"></textarea>
  </div>
  <div id="genError" role="alert" style="display:none"></div>
  <div id="noteGenError" role="alert" style="display:none"></div>
  <textarea id="transcript"></textarea>
  <button type="button" id="genBtn">Generate note</button>
</body></html>`;

const BOOT = `
  var toastT, toastKey='';
  function mlsPlaceMobileNotice(){}
  function mlsSyncNoticeAnchor(){}
  function mlsRefreshMobileNoticeShelf(){}
  ${toastFn}
  window.toast = toast;
  ${draftableFn}
  ${engine}
  window.generateNote = generateNote;
  window.__aiCalls = 0;
  /* No verified prior visit exists, so "the patient is fine" has no trusted
     history to lean on and the shipped gate must refuse it. */
  window.activePatient = function(){ return null; };
  window.callOpenAI = function(){ window.__aiCalls += 1; return Promise.resolve({}); };
  window.__lifecycle = [];
  ['started','refused','settled'].forEach(function(kind){
    window.addEventListener('mls:generation-' + kind, function(ev){
      window.__lifecycle.push({ kind: kind, detail: ev.detail || {} });
    });
  });

  /* ---- the shipped Easy gate-paint + announcement helpers --------------- */
  function isFn(f){ return typeof f === 'function'; }
  function $(id){ return document.getElementById(id); }
  var GEN_READY_HINT = 'Uses every recorded and typed segment above';
  var GEN_NO_TEXT_HINT = 'Add some transcript text first';
  ${gateReasonFn}
  ${runOverlayFn}
  ${paintGateFn}
  ${syncGateFn}
  ${shoutFn}
  window.__mlsSyncGenerationGateUi = syncGenGateUi;
  window.syncGenGateUi = syncGenGateUi;

  /* ---- the shipped ez3Gen click handler, with its real surroundings ----- */
  window.__renders = 0;
  window.__bindingCalls = 0;
  window.__hiddenClicks = 0;
  var S = { appt: { id: 'synthetic-appointment' }, phase: 'idle', genClickedAt: 0, signedAt: 0, lastWarn: '' };
  window.S = S;
  function render(){ window.__renders += 1; }
  function requireExactScheduledBinding(){ window.__bindingCalls += 1; return true; }
  function genBtnResolve(){ var g = $('genBtn'); return (g && !g.disabled) ? g : null; }
  /* The hidden engine runs for real in parts A and B (that is the whole point
     of those parts). Part D measures only what the HANDLER contributes to an
     ACCEPTED click, so the engine is parked there rather than half-stubbed --
     its own post-evidence guards belong to generate-note-lifecycle. */
  window.__engineLive = true;
  document.getElementById('genBtn').addEventListener('click', function(){
    window.__hiddenClicks += 1;
    if (window.__engineLive) window.__pendingGenerate = window.generateNote();
  });
  window.__ez3Gen = ${ez3GenHandler};
  document.getElementById('ez3Gen').addEventListener('click', function(){ window.__ez3Gen(); });

  /* Instrument the emphasis the way the OWNER measures it: count the animation
     the banner actually plays. A repeat click that restarts no animation moved
     no pixels, which is the reported dead click. The class-mutation counter
     beside it reads oldValue, because a remove+reflow+add pair is delivered as
     ONE batched observer callback and a naive "does it have the class now"
     check cannot see the re-arm at all. */
  window.__flashes = 0;
  window.__flashClassAdds = 0;
  (function(){
    var bar = document.querySelector('.ez3-warnbar');
    bar.addEventListener('animationstart', function(ev){
      if (ev.animationName === 'mlsGateShake') window.__flashes += 1;
    });
    new MutationObserver(function(records){
      records.forEach(function(rec){
        var before = String(rec.oldValue || '').indexOf('mls-gate-flash') >= 0;
        var after = bar.classList.contains('mls-gate-flash');
        if (!before && after) window.__flashClassAdds += 1;
      });
    }).observe(bar, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  })();
  /* One macrotask (the refusal emphasis is scheduled with setTimeout 0, never
     rAF, because this tab can be occluded) plus two painted frames, which is
     when animationstart is actually delivered. */
  window.__settle = function(){
    return new Promise(function(r){ setTimeout(r, 0); })
      .then(function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); });
  };
`;

function snapshot() {
  const toastEl = document.getElementById('toast');
  const bar = document.querySelector('.ez3-warnbar');
  const genError = document.getElementById('genError');
  const hero = document.getElementById('ez3Gen');
  const small = hero.querySelector('small');
  const box = hero.getBoundingClientRect();
  const overHero = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return {
    toastOverlapsHero: !!(toastEl.getBoundingClientRect().bottom > box.top &&
                          toastEl.getBoundingClientRect().top < box.bottom &&
                          toastEl.classList.contains('show')),
    hitTestReachesHero: !!(overHero && (overHero === hero || hero.contains(overHero))),
    toastText: toastEl.textContent,
    toastShown: toastEl.classList.contains('show'),
    toastErr: toastEl.classList.contains('err'),
    toastRole: toastEl.getAttribute('role') || '',
    barFlash: bar.classList.contains('mls-gate-flash'),
    barAnimations: bar.getAnimations ? bar.getAnimations().length : -1,
    genErrorText: genError.textContent,
    genErrorShown: genError.style.display === 'block',
    focusedIsBanner: document.activeElement === genError || document.activeElement === bar,
    scrolled: window.scrollY,
    heroDisabled: hero.disabled,
    heroAria: hero.getAttribute('aria-disabled'),
    heroTitle: hero.getAttribute('title') || '',
    heroDim: hero.classList.contains('dim'),
    heroSmall: small ? small.textContent : '',
    flashes: window.__flashes,
    flashClassAdds: window.__flashClassAdds,
    renders: window.__renders,
    hiddenClicks: window.__hiddenClicks,
    aiCalls: window.__aiCalls,
    lastWarn: window.S.lastWarn,
    lifecycle: window.__lifecycle.map(function (e) { return e.kind + ':' + (e.detail.code || e.detail.status || ''); })
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => { failures.push('pageerror: ' + error.message); });
    await page.setContent(PAGE);
    await page.addScriptTag({ content: BOOT });
    await page.addScriptTag({ content: 'window.__snapshot = ' + snapshot.toString() + ';' });
    assert.deepStrictEqual(failures, [], 'the shipped bytes threw while booting');

    /* =================================================================
     * A. A BLOCKED CLICK IS LOUD -- AND STAYS LOUD ON THE REPEAT CLICK
     * ================================================================= */
    await page.evaluate(() => {
      document.getElementById('transcript').value = 'The patient is fine';
      window.syncGenGateUi();
    });

    const beforeClick = await page.evaluate(() => window.__snapshot());
    assert.strictEqual(beforeClick.heroDisabled, false,
      'the blocked hero is hard-disabled, so its click can never be answered');
    assert.strictEqual(beforeClick.heroAria, 'true',
      'the hero does not announce itself blocked while the gate is refusing');
    assert.strictEqual(beforeClick.heroDim, true,
      'the hero does not render in the blocked (dim) skin while the gate is refusing');
    assert.strictEqual(beforeClick.heroTitle, refusalSentence,
      'the hero tooltip does not carry the gate reason');
    assert.strictEqual(beforeClick.heroSmall, refusalSentence,
      'the hero sub-label does not carry the gate reason');

    /* A REAL mouse click at the button's own coordinates. `force` only skips
       Playwright's actionability convention (it treats aria-disabled as "not
       enabled"); the browser itself delivers the pointer/click events exactly
       as it does for the owner, because aria-disabled is ADVISORY -- that is
       the whole point of using it instead of the `disabled` attribute. */
    await page.click('#ez3Gen', { force: true });
    await page.evaluate(() => window.__settle());
    await page.evaluate(() => window.__settle());
    const first = await page.evaluate(() => window.__snapshot());

    assert.strictEqual(first.toastText, refusalSentence,
      'the blocked click did not toast the exact gate sentence');
    assert.ok(first.toastShown, 'the refusal toast is not on screen');
    assert.ok(first.toastErr, 'the refusal toast is not styled as an error');
    assert.strictEqual(first.toastRole, 'alert', 'the refusal toast is not announced assertively');
    assert.strictEqual(first.genErrorText, refusalSentence,
      'the persistent inline error does not carry the gate sentence');
    assert.ok(first.genErrorShown, 'the persistent inline error stayed hidden');
    assert.ok(first.barFlash, 'the on-screen banner was not emphasised by the blocked click');
    assert.ok(first.barAnimations > 0, 'the banner emphasis is not actually animating');
    assert.ok(first.focusedIsBanner, 'the blocked click did not move focus to the reason');
    assert.strictEqual(first.flashes, 1, 'the first blocked click did not emphasise exactly once');
    assert.ok(first.toastOverlapsHero,
      'the test page no longer places the shipped toast over the hero, so it cannot prove click-through');
    assert.ok(first.hitTestReachesHero,
      'the refusal toast is sitting ON the button it is explaining and swallowing the next click');

    /* THE OWNER'S ACTUAL COMPLAINT: click it again with the SAME sentence
     * already on screen. toast() dedupes identical live messages, so old bytes
     * produced literally nothing here. */
    await page.evaluate(() => { window.__flashes = 0; window.__flashClassAdds = 0; });
    await page.click('#ez3Gen', { force: true });
    await page.evaluate(() => window.__settle());
    await page.evaluate(() => window.__settle());
    const repeat = await page.evaluate(() => window.__snapshot());
    assert.ok(repeat.flashes >= 1,
      'a REPEAT blocked click produced no visible emphasis -- the reported dead click');
    assert.strictEqual(repeat.toastText, refusalSentence,
      'the repeat blocked click lost the toast sentence');
    assert.ok(repeat.toastShown, 'the repeat blocked click left no toast on screen');
    assert.ok(repeat.barAnimations > 0, 're-announcement did not restart the banner animation');

    /* =================================================================
     * B. THE GATE STILL BLOCKS -- NOTHING REACHED THE MODEL
     * ================================================================= */
    assert.strictEqual(first.aiCalls, 0, 'a refused sparse transcript reached the model');
    assert.strictEqual(repeat.aiCalls, 0, 'a repeated refused transcript reached the model');
    const refused = await page.evaluate(() => {
      window.__lifecycle.length = 0;
      return window.generateNote().then(function (result) {
        return { result: result, lifecycle: window.__lifecycle.map(function (e) { return { kind: e.kind, code: e.detail.code, status: e.detail.status, message: e.detail.message }; }), aiCalls: window.__aiCalls };
      });
    });
    assert.strictEqual(refused.result, false, 'the shipped engine did not refuse the sparse transcript');
    assert.strictEqual(refused.aiCalls, 0, 'the shipped engine called the model on a refused transcript');
    assert.strictEqual(refused.lifecycle.filter((e) => e.kind === 'started').length, 0,
      'a refused generation claimed it had started');
    const refusedEvents = refused.lifecycle.filter((e) => e.kind === 'refused');
    assert.strictEqual(refusedEvents.length, 1, 'the refusal did not publish exactly one receipt');
    assert.strictEqual(refusedEvents[0].code, 'sparse-today-evidence',
      'the anti-invention gate no longer owns this refusal');
    assert.strictEqual(refusedEvents[0].message, refusalSentence,
      'the refusal receipt lost the exact gate sentence');

    /* =================================================================
     * C. A QUALIFYING DETAIL RE-ENABLES THE BUTTON, LIVE
     * ================================================================= */
    const enabled = await page.evaluate(() => {
      const tx = document.getElementById('transcript');
      tx.value = 'Left knee pain is worse since Monday. Exam shows medial joint line tenderness. Assessment osteoarthritis flare. Plan naproxen and physical therapy.';
      const reason = window.syncGenGateUi();
      return { reason: reason, snap: window.__snapshot() };
    });
    assert.strictEqual(enabled.reason, '',
      'a transcript with real current-visit detail is still reported blocked');
    assert.strictEqual(enabled.snap.heroAria, 'false', 'the hero stayed marked blocked after the gate cleared');
    assert.strictEqual(enabled.snap.heroDim, false, 'the hero stayed in the blocked skin after the gate cleared');
    assert.strictEqual(enabled.snap.heroTitle, '', 'the hero kept a stale blocked tooltip');
    assert.strictEqual(enabled.snap.heroSmall, 'Uses every recorded and typed segment above',
      'the hero kept a stale blocked sub-label');

    /* Empty transcript is the third state, and it is blocked the same visible
     * way -- never by swallowing the click behind `disabled`. */
    const emptied = await page.evaluate(() => {
      document.getElementById('transcript').value = '';
      window.syncGenGateUi();
      return window.__snapshot();
    });
    assert.strictEqual(emptied.heroDisabled, false, 'the empty-transcript hero swallows its own click again');
    assert.strictEqual(emptied.heroAria, 'true', 'the empty-transcript hero does not announce itself blocked');
    assert.strictEqual(emptied.heroSmall, 'Add some transcript text first',
      'the empty-transcript hero lost its reason');

    /* =================================================================
     * D. NO FEEDBACK REGRESSION ON THE HAPPY PATH
     * ================================================================= */
    const happy = await page.evaluate(() => {
      const tx = document.getElementById('transcript');
      tx.value = 'Left knee pain is worse since Monday. Exam shows medial joint line tenderness. Assessment osteoarthritis flare. Plan naproxen and physical therapy.';
      window.syncGenGateUi();
      document.getElementById('toast').className = 'toast';
      document.getElementById('toast').textContent = '';
      document.querySelector('.ez3-warnbar').classList.remove('mls-gate-flash');
      window.__flashes = 0; window.__flashClassAdds = 0;
      window.__renders = 0;
      window.__hiddenClicks = 0;
      window.S.lastWarn = '';
      window.__engineLive = false;
      window.__ez3Gen();
      return window.__settle().then(() => window.__settle()).then(() => window.__snapshot());
    });
    assert.strictEqual(happy.hiddenClicks, 1, 'the accepted click did not delegate exactly once to the engine');
    assert.strictEqual(happy.renders, 1, 'the accepted click did not repaint exactly once');
    assert.strictEqual(happy.flashes, 0, 'the accepted click emphasised a refusal that did not happen');
    assert.strictEqual(happy.toastText, '', 'the accepted click invented a diagnosis toast');
    assert.strictEqual(happy.lastWarn, '', 'the accepted click invented a warning banner');

    /* =================================================================
     * E. EVERY OTHER EARLY RETURN IN THE SAME HANDLER IS LOUD TOO
     * ================================================================= */
    const noVisit = await page.evaluate(() => {
      window.S.appt = null;
      window.__flashes = 0; window.__flashClassAdds = 0; window.__renders = 0; window.__hiddenClicks = 0;
      document.getElementById('toast').className = 'toast';
      document.getElementById('toast').textContent = '';
      window.__ez3Gen();
      return window.__settle().then(() => window.__settle()).then(() => window.__snapshot());
    });
    assert.strictEqual(noVisit.hiddenClicks, 0, 'a visit-less click still reached the engine');
    assert.ok(noVisit.toastShown && noVisit.toastText.length > 0,
      'the no-visit early return is still a silent dead click');
    assert.ok(/nothing to generate/i.test(noVisit.toastText),
      'the no-visit refusal does not say what is wrong');
    assert.ok(noVisit.flashes >= 1, 'the no-visit refusal did not emphasise its banner');
    assert.strictEqual(noVisit.renders, 1, 'the no-visit refusal did not repaint its banner');
    assert.ok(noVisit.lastWarn.length > 0, 'the no-visit refusal left no persistent banner text');

    const noText = await page.evaluate(() => {
      window.S.appt = { id: 'synthetic-appointment' };
      document.getElementById('transcript').value = '   ';
      window.__flashes = 0; window.__flashClassAdds = 0; window.__hiddenClicks = 0;
      document.getElementById('toast').className = 'toast';
      document.getElementById('toast').textContent = '';
      window.__ez3Gen();
      return window.__settle().then(() => window.__settle()).then(() => {
        const snap = window.__snapshot();
        snap.transcriptFocused = document.activeElement === document.getElementById('ez3Transcript');
        return snap;
      });
    });
    assert.strictEqual(noText.hiddenClicks, 0, 'an empty-transcript click still reached the engine');
    assert.ok(noText.toastShown && /visit text first/i.test(noText.toastText),
      'the empty-transcript early return is still silent');
    assert.ok(noText.flashes >= 1, 'the empty-transcript refusal did not emphasise its banner');

    const busy = await page.evaluate(() => {
      document.getElementById('transcript').value = 'Left knee pain is worse since Monday. Exam shows medial joint line tenderness. Assessment osteoarthritis flare. Plan naproxen and physical therapy.';
      document.getElementById('genBtn').disabled = true;   /* exactly what an in-flight generation looks like */
      window.__flashes = 0; window.__flashClassAdds = 0; window.__hiddenClicks = 0;
      document.getElementById('toast').className = 'toast';
      document.getElementById('toast').textContent = '';
      window.__ez3Gen();
      return window.__settle().then(() => window.__settle()).then(() => window.__snapshot());
    });
    assert.strictEqual(busy.hiddenClicks, 0, 'a busy-engine click still reached the engine');
    assert.ok(busy.toastShown && /still generating/i.test(busy.toastText),
      'the busy early return does not name BUSY -- it is either silent or guessing "not found"');
    assert.ok(busy.flashes >= 1, 'the busy refusal did not emphasise its banner');

    assert.deepStrictEqual(failures, [], 'the shipped bytes threw during the run');
  } finally {
    await browser.close();
  }

  console.log('PASS generate-block-visible-feedback-runtime: a blocked Generate click toasts, ' +
    'flashes and focuses its reason on the FIRST and every REPEAT click; the anti-invention gate ' +
    'still refuses sparse evidence with nothing reaching the model; a qualifying detail re-enables ' +
    'the control live; and the accepted click stays feedback-free');
}

main().catch((error) => { console.error(error); process.exit(1); });
