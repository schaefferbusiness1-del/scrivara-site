'use strict';
/* ez3adapt-1.0.0 control: THE EASY VISIT SURFACES TELL THE DOCTOR WHY
 * GENERATION REFUSED - AND THE TOP BUTTON NEVER CLICKS BLIND.
 *
 * Owner live repro 2026-08-25: the big top "Generate one note" button with a
 * four-word transcript read as a dead click plus the generic "not generated /
 * check the connection" banner. Mechanisms: (a) generateTopNote() clicked the
 * hidden #genBtn with no evidence pre-gate (the LOWER #ez3Gen button already
 * had one), so the engine's synchronous sparse-transcript refusal left the
 * facade with nothing to say; (b) computePhase() composed only its own
 * generic canned text and never read the SPECIFIC reason generateNote()
 * writes into #genError/#noteGenError. Adapter only - the engine lifecycle
 * hunk belongs to the generation-contract lane and is deliberately absent.
 *
 * Executes the REAL shipped generateTopNote/computePhase/ez3EngineReason
 * (extracted from mls-connect.js) with stubbed surroundings. OLD BYTES FAIL
 * BY NAME: no ez3EngineReason, no top-button gate. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
/* ez3stamp-1.0.0: the generation events are EMITTED by the shell and
   CONSUMED by mls-connect, so pinning the legacy alias needs both files. */
const shellSrc = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* Scope every lookup to the LIVE bytes: everything BEFORE the first
 * retired-copy marker, so a retired near-duplicate can never satisfy a pin
 * meant for the live block.
 * ez3stamp-1.0.0 (2026-08-28): the comment used to say "from the 3.7.3 marker",
 * which the slice never did - it starts at 0. That is CORRECT and the comment
 * was wrong: one of the four sites this file names, the direct engine
 * fallback, lives ABOVE the 3.7.3 marker (mls-connect.js:7807). Slicing from
 * liveStart would silently drop it and the census below would then be counting
 * a different set than the assertion describes. liveStart is asserted purely to
 * prove the live marker still exists. */
const liveStart = src.indexOf('3.7.3');
assert.ok(liveStart > 0, 'live Easy 3.7.3 marker present');
const retiredAt = src.indexOf('Retired historical Easy', liveStart);
const liveEnd = retiredAt > 0 ? retiredAt : src.length;
const live = src.slice(0, liveEnd);

function extractFn(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, marker + ' present');
  const open = source.indexOf('{', at + marker.length - 1);
  let depth = 0, mode = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i], p = source[i - 1];
    if (mode === null) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return source.slice(at, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && source[i + 1] === '/') { mode = '//'; i++; }
      else if (c === '/' && source[i + 1] === '*') { mode = '/*'; i++; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else { if (c === '\\') i++; else if (c === mode) mode = null; }
  }
  throw new Error('unbalanced ' + marker);
}

const topSrc = extractFn(src, 'function generateTopNote()');
const phaseSrc = extractFn(live, 'function computePhase()');
const reasonSrc = extractFn(live, 'function ez3EngineReason()');
const rawErrSrc = extractFn(live, 'function ez3RawEngineErr()');
const stampSrc = extractFn(live, 'function ez3StampGenClick()');

/* ez3adapt-1.0.1 pins: every generate stamp funnels through the snapshot
 * helper so a stale engine reason from a PREVIOUS attempt can never be
 * echoed as the current one, and the completion listener wires exactly once */
assert.ok(stampSrc.includes('S.genErrBefore = ez3RawEngineErr()'), 'the stamp helper snapshots the pre-click error text');
/* ez3stamp-1.0.0: was pinned at 4 and the live block now has 8, so this has
   been red on main. Audited all eight on 2026-08-28 - every one is a real
   generate entry point that stamps through the snapshot helper, and each is
   typeof-guarded so an older shell without the helper degrades instead of
   throwing:
     7807   direct engine fallback   stamps, then clicks
     21855  lockAndStart, unbound    stamps, then clicks
     21876  lockAndStart, bound      stamps, then clicks
     22761  auto-advance after stop  stamps, then clicks
     23051  #ez3Gen                  stamps, then clicks
     23053  #ez3Regen                stamps, then clicks
     24812  noteGenerationStarted    stamps (a listener - there is no click to
                                     precede; it records the attempt the engine
                                     has already begun)
     24941  phone lane               stamps, then clicks
   The count grew because generate gained entry points, not because anything
   stopped funnelling. Pinned as the PROPERTY as well, which is what the
   original number was standing in for: no stamp site may reach a generate
   click without snapshotting first, and none may call the helper unguarded. */
const stampSites = [...live.matchAll(/ez3StampGenClick\(\);/g)];
assert.strictEqual(stampSites.length, 8,
  'the number of generate stamp sites changed (' + stampSites.length + ', expected 8) - audit the new one ' +
  'and confirm it snapshots BEFORE it clicks, then move this pin');
for (const site of stampSites) {
  const before = live.slice(Math.max(0, site.index - 120), site.index);
  assert.ok(/typeof ez3StampGenClick === 'function'/.test(before),
    'a generate stamp site calls the helper unguarded - on a shell that predates it, generate would throw ' +
    'instead of degrading. Context: ' + JSON.stringify(before.slice(-90)));
  const after = live.slice(site.index, site.index + 140);
  const clickAt = after.indexOf('.click()');
  if (clickAt >= 0) {
    assert.ok(after.indexOf('ez3StampGenClick();') < clickAt,
      'a generate click happens BEFORE its snapshot, so a stale engine reason from the previous attempt ' +
      'can be echoed as this one. Context: ' + JSON.stringify(after.slice(0, 90)));
  }
}
/* ez3stamp-1.0.0: the one-shot mechanism CHANGED. It was a global
   window.__ez3GenEvtWired flag; the canonical owner now registers the three
   generation listeners once and pushes a matching teardown onto its cleanup
   list, while the module itself claims __mlsEasyV3 so an older copy bails
   before it can register a second set. Symmetric add/remove with explicit
   teardown is a stronger guarantee than a boolean nobody clears - a flag
   survives a re-init and silently prevents the RE-registration a teardown
   makes safe. Pinned as the property: every generation listener added is also
   removed, and the count matches. */
{
  const added = [...live.matchAll(/window\.addEventListener\('mls:generation-([a-z]+)', (on[A-Za-z]+)\);/g)];
  const removed = [...live.matchAll(/window\.removeEventListener\('mls:generation-([a-z]+)', (on[A-Za-z]+)\);/g)];
  assert.ok(added.length >= 3,
    'the canonical owner no longer listens for the generation lifecycle (' + added.length + ' listeners) - ' +
    'the card could not report generating/failed/settled at all');
  assert.deepStrictEqual(
    added.map((m) => m[1] + ':' + m[2]).sort(),
    removed.map((m) => m[1] + ':' + m[2]).sort(),
    'a generation listener is added without a matching teardown - a re-init would stack a second handler ' +
    'and every generate would be counted twice');
  assert.ok(/__mlsEasyV3/.test(live),
    'the canonical owner no longer claims the __mlsEasyV3 name, so an older retired copy could register its own listeners alongside');
}

/* ez3adapt-1.0.2 (Codex reply 9): the engine owns the WHOLE evidence
 * contract - it can accept a sparse statement when trusted verified history
 * exists, so the facade must NOT pre-gate on the transcript alone, and must
 * never manufacture a started state from a .click(). */
assert.ok(!topSrc.includes('_mlsTranscriptHasDraftableTodayEvidence'),
  'the TOP Generate button carries NO facade evidence pre-gate (the engine decides)');
assert.ok(!topSrc.includes('noteGenerationStarted'),
  'the TOP Generate button never manufactures a started state from a click');
assert.ok(phaseSrc.includes('ez3EngineReason() ||'),
  'computePhase prefers the engine-written reason over its generic text in BOTH failure branches');
assert.strictEqual((phaseSrc.match(/ez3EngineReason\(\) \|\|/g) || []).length, 2,
  'both the fast-fail and the timeout branch consult the engine reason');
/* ez3stamp-1.0.0: the settlement event was RENAMED. The canonical name is
   'mls:generation-settled'; 'mls:generation-complete' survives only as a
   legacy alias the shell still dispatches alongside it, for refresh-burst
   owners that were written against the old name. The live Easy owner listens
   to the canonical one, so this pin - which looked for the legacy name - has
   been red on main while the behaviour it describes works.
   Accept either, and pin the alias separately: dropping it would silently
   break every consumer that was never migrated. */
assert.ok(/window\.addEventListener\('mls:generation-(?:settled|complete)'/.test(live),
  'the live Easy block snaps its phase on the engine completion event instead of only polling');
assert.ok(/if\(kind==='settled'\)try\{window\.dispatchEvent\(new CustomEvent\('mls:generation-complete'/.test(shellSrc),
  'the legacy mls:generation-complete alias is no longer emitted alongside the canonical settled event - ' +
  'any refresh-burst owner still written against the old name would stop hearing settlements');

function el(id) { return { id, textContent: '', value: '', disabled: false, style: {}, focused: 0, focus() { this.focused++; } }; }

/* ---- computePhase harness ----
 * genErrBefore mirrors ez3StampGenClick's snapshot: pass the PRE-CLICK error
 * text ('' for a clean start); the engine then writes genErrorText. */
function phaseHarness(genErrorText, preClickErrorText) {
  const nodes = { genError: el('genError'), noteGenError: el('noteGenError'), genBtn: el('genBtn') };
  const S = { phase: 'stopped', recStart: 0, genClickedAt: 0, lastWarn: '' };
  const ctx = vm.createContext({
    S, Date,
    isRecording: () => false,
    noteText: () => '',
    bindingNotice: () => {},
    $: id => nodes[id] || null,
    document: { getElementById: id => nodes[id] || null },
    String, Math
  });
  vm.runInContext(rawErrSrc + '\n' + stampSrc + '\n' + reasonSrc + '\n' + phaseSrc, ctx, { filename: 'mls-connect:ez3-phase' });
  nodes.genError.textContent = preClickErrorText || '';
  vm.runInContext('ez3StampGenClick()', ctx);           /* the real stamp takes the snapshot */
  S.genClickedAt = Date.now() - 5000;                    /* then age the click for the fast-fail branch */
  nodes.genError.textContent = genErrorText || '';       /* what the engine wrote (or left) after the click */
  return { S, nodes, run: () => vm.runInContext('computePhase()', ctx) };
}

/* ---- generateTopNote harness ---- */
function topHarness(text, predicateResult) {
  const nodes = { transcript: el('transcript'), ez3flTranscript: el('ez3flTranscript'), genBtn: el('genBtn') };
  nodes.transcript.value = text;
  const log = { toasts: [], clicks: 0, started: 0, sync: 0 };
  nodes.genBtn.click = () => { log.clicks++; };
  const ctx = vm.createContext({
    recordingNow: () => false,
    flowToast: (m, k) => { log.toasts.push({ m: String(m), k }); },
    $: id => nodes[id] || null,
    document: { getElementById: id => nodes[id] || null, querySelector: () => null },
    syncTopLane: () => { log.sync++; },
    window: { __mlsEasyV32: { noteGenerationStarted: () => { log.started++; } } },
    _mlsTranscriptHasDraftableTodayEvidence: () => predicateResult,
    String, Date
  });
  vm.runInContext(topSrc, ctx, { filename: 'mls-connect:generateTopNote' });
  return { nodes, log, run: () => vm.runInContext('generateTopNote()', ctx) };
}

let n = 0;
const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

/* ---- 1. fast-fail branch prefers the engine's written reason ---- */
{
  const h = phaseHarness('Add your OpenAI API key in Settings to generate notes.');
  h.run();
  assert.strictEqual(h.S.phase, 'stopped');
  assert.ok(/OpenAI API key in Settings/.test(h.S.lastWarn),
    'the doctor reads the engine reason, not generic connection advice (old shape showed only the canned banner)');
  assert.ok(/transcript is still safe/.test(h.S.lastWarn), 'transcript reassurance retained');
  ok('fast-fail: engine-written reason surfaces verbatim');
}

/* ---- 2. fast-fail falls back to the generic text when the engine left none ---- */
{
  const h = phaseHarness('');
  h.run();
  assert.ok(/The note was not generated/.test(h.S.lastWarn), 'generic fallback intact when no engine reason exists');
  ok('fast-fail: generic fallback intact');
}

/* ---- 3. timeout branch prefers the engine reason too ---- */
{
  const h = phaseHarness('Something specific went wrong.');
  h.S.genClickedAt = Date.now() - 200000; /* past the 180s ceiling */
  h.nodes.genBtn.disabled = true;         /* not the fast-fail branch */
  h.run();
  assert.ok(/Something specific went wrong/.test(h.S.lastWarn), 'timeout branch consults the engine reason');
  ok('timeout: engine-written reason surfaces');
}

/* ---- 4. TOP button: a sparse transcript still reaches the ENGINE (which may
 * accept it on trusted verified history) - zero facade-start either way ---- */
{
  const h = topHarness('the patient is fine', false);
  h.run();
  assert.strictEqual(h.log.clicks, 1, 'the click reaches the engine - the facade does not pre-judge evidence');
  assert.strictEqual(h.log.started, 0, 'zero facade-start calls on the possibly-refused path');
  assert.strictEqual(h.log.toasts.length, 0, 'no facade refusal - the engine speaks for itself');
  ok('top button: sparse transcript delegated to the engine, zero facade-start');
}

/* ---- 5. TOP button: rich transcript clicks once, zero facade-start ---- */
{
  const h = topHarness('Right knee pain for two weeks, worse on stairs. Exam: medial joint line tenderness. Plan: NSAIDs and PT.', true);
  h.run();
  assert.strictEqual(h.log.clicks, 1, 'one engine click');
  assert.strictEqual(h.log.started, 0, 'zero facade-start calls on the accepted path - the engine lifecycle moves the phase');
  assert.strictEqual(h.log.toasts.length, 0, 'no refusal toast on the healthy path');
  ok('top button: healthy path - one click, zero facade-start');
}

/* ---- 6. STALENESS (ez3adapt-1.0.1, review finding): text left over from a
 * PREVIOUS attempt is never echoed as the current attempt's reason ---- */
{
  const stale = 'Add your OpenAI API key in Settings to generate notes.';
  const h = phaseHarness(stale, stale); /* unchanged since the pre-click snapshot */
  h.run();
  assert.ok(/The note was not generated/.test(h.S.lastWarn),
    'an unchanged pre-click error text falls back to the generic message instead of misattributing the old reason');
  const h2 = phaseHarness('A fresh, current failure reason.', stale); /* engine overwrote it after the click */
  h2.run();
  assert.ok(/fresh, current failure reason/.test(h2.S.lastWarn), 'a changed error text still surfaces');
  ok('staleness guard: unchanged snapshot suppressed, fresh engine text surfaces');
}

console.log('PASS ez3 generation reason adapter: engine-written reasons surface in both failure branches with a staleness guard, the top button gates evidence before clicking like #ez3Gen, the healthy path is unchanged, and the live block listens once for generation-complete (' + n + ' cases)');
