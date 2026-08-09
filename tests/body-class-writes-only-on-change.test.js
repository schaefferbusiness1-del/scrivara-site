'use strict';

/*
 * Nothing on a repeating pass may rewrite <body class> without first checking
 * whether the value would actually change.
 *
 * MEASURED on the owner's signed-in visit screen, FOREGROUND tab (document
 * visible, window focused, and the page's own clock observed ticking 77 times
 * inside the window - so this is not a throttled-background artifact):
 *
 *     <body> class attribute writes    86   over 44s, median gap 691ms
 *     writes that changed the value     0
 *
 * The owner's report was "the whole visit page glitches out every few seconds".
 * A body-class write invalidates style for the entire document; no other
 * element in this app has that blast radius. 86 in 44 seconds is ~1.4
 * whole-page style recalculations per second, every one of them for nothing.
 *
 * classList.add() and remove() re-commit the class attribute even when the token
 * set does not change: both run the DOM update steps unconditionally, which
 * re-serialises and re-sets the attribute.
 *
 * toggle(name, force) does NOT — see the measurement under rule 3. It returns
 * early when presence already matches force. An earlier version of this file
 * claimed otherwise and that claim was wrong; the guards on toggle sites are
 * harmless belt-and-braces, not the fix.
 *
 * WHY THIS SURVIVED SO LONG. The obvious instrumentation cannot see it. Hooking
 * body.className, or Element.prototype.setAttribute, catches NOTHING here -
 * classList mutates the attribute node directly and goes through neither path.
 * Only hooking DOMTokenList.prototype, filtered on
 * `this === document.body.classList`, observes these writes. An earlier pass
 * measured with a setAttribute hook and concluded the body was quiet: a
 * confident false negative that cost a round.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* Enumerated so the count tripwire below covers every published file, not a
   hand-written list. Three rounds of this fix each found another writer in a file
   the previous round had not opened: seven in three files, then an eighth in
   ScribeFlow.html, then three more in feat_mls_redesign.js. A rule scoped to the
   files you already suspect is a rule that keeps missing the next one. */
const PUBLISHED = (() => {
  const inv = JSON.parse(read('pages-publication-inventory.json'));
  const all = new Set();
  for (const v of Object.values(inv)) {
    if (!Array.isArray(v)) continue;
    for (const f of v) if (typeof f === 'string' && /\.(js|html)$/.test(f) && fs.existsSync(path.join(root, f))) all.add(f);
  }
  return [...all];
})();

/* ---- 1. every writer on a repeating pass compares before it commits -------
 *
 * The first three were named by stack sampling during the measurement. The
 * next four were found by reading all 22 body.classList sites rather than only
 * the sampled ones - each runs on a render or reconcile pass, so each is the
 * same defect; they simply did not happen to be sampled. Note that
 * mls-top-voice-tools has TWO writers: guarding only the sampled one would have
 * left the churn roughly where it was.
 *
 * The last three are in ScribeFlow.html, which was outside the scope of the
 * first fix entirely. Re-measuring live at b632 found it immediately:
 * remove('mls-has-active-pt') committed 5 times in 80s, 0 of them changing the
 * value. Scoping a rule to the files you already suspect is how the eighth
 * writer survives the fix for the first seven.
 */

const GUARDED = [
  ['mls-connect.js', 'syncPrimaryVoiceTools', 'toggle — belt-and-braces, 0 records',
    "if (document.body.classList.contains('mls-top-voice-tools') !== !!visible) document.body.classList.toggle('mls-top-voice-tools', visible);"],
  ['feat_athena_tooltip_dedupe.js', 'reconcileAdvanced', 'add() — 54 REAL re-commits',
    "if (!document.body.classList.contains('mls-has-easy-advanced-trigger')) document.body.classList.add('mls-has-easy-advanced-trigger');"],
  ['feat_mls_pervisit_unify.js', 'per-visit unify', 'add/remove — 14 REAL re-commits',
    'if (cls.contains("mls-pvu-rich") !== pvuWant) cls.toggle("mls-pvu-rich", pvuWant);'],
  ['mls-connect.js', 'render() — the second writer of the same class', 'unsampled',
    "if (document.body.classList.contains('mls-top-voice-tools') !== wantTvt) document.body.classList.toggle('mls-top-voice-tools', wantTvt);"],
  ['mls-connect.js', 'primary-lane sync', 'unsampled',
    "if (body.classList.contains('ez3fl-top-owns') !== wantOwns) body.classList.toggle('ez3fl-top-owns', wantOwns);"],
  ['feat_athena_tooltip_dedupe.js', 'reconcilePortalOwner', 'unsampled',
    "if (document.body.classList.contains('mls-has-exact-portal-action') !== wantPortal) document.body.classList.toggle('mls-has-exact-portal-action', wantPortal);"],
  ['feat_athena_tooltip_dedupe.js', 'settings reconcile', 'unsampled',
    "if (document.body && document.body.classList.contains('mls-settings-open') !== open) document.body.classList.toggle('mls-settings-open', open);"],
  ['ScribeFlow.html', 'ctx-bar build(), remove arm', 'remove() — 5 REAL re-commits, live at b632',
    'safe(function(){ if (document.body.classList.contains(BODY_CLS)) document.body.classList.remove(BODY_CLS); });'],
  ['ScribeFlow.html', 'ctx-bar build(), add arm', 'add() — 5 REAL re-commits, live at b632',
    'safe(function(){ if (!document.body.classList.contains(BODY_CLS)) document.body.classList.add(BODY_CLS); });'],
  ['ScribeFlow.html', 'renderProfile()', 'unsampled',
    "if(document.body.classList.contains('pt-has-active')!==wantPta) document.body.classList.toggle('pt-has-active', wantPta);"],
  /* Runs from a CAPTURE-phase 'input' listener on document, so it makes three
     classList calls per character typed. They are toggle(name, force), which is
     already conditional, so they re-committed NOTHING. An earlier version of this
     file claimed three style invalidations per keystroke; that was inferred from a
     wrong premise and never measured. Guards kept: comparing beats calling on a
     per-keystroke path. */
  ['feat_mls_redesign.js', 'syncClinicalSurfaceState, per keystroke', 'toggle — belt-and-braces',
    "if(bcl.contains('mls-has-active-patient')!==wantHas) bcl.toggle('mls-has-active-patient',wantHas);"],
  ['feat_mls_redesign.js', 'syncClinicalSurfaceState, per keystroke', 'toggle — belt-and-braces',
    "if(bcl.contains('mls-no-active-patient')!==wantNone) bcl.toggle('mls-no-active-patient',wantNone);"],
  ['feat_mls_redesign.js', 'syncClinicalSurfaceState, per keystroke', 'toggle — belt-and-braces',
    "if(bcl.contains('mls-has-note-draft')!==wantDraft) bcl.toggle('mls-has-note-draft',wantDraft);"],
  /* Found by static audit, never by measurement: applyDoctorRestrictions() returns
     early unless isLiteUser(), which is false for admin and Premium accounts. Every
     live measurement in this work ran on the owner's admin account and recorded
     zero. On a Lite account it is an unguarded add() on setInterval(tick, 1500) -
     ~40 no-op whole-document style invalidations per minute, all session. Same
     defect as the original, on the one population nobody sampled. */
  ['mls-connect.js', 'applyDoctorRestrictions (LITE USERS ONLY)', 'add() — ~40/min all session',
    "if (!document.body.classList.contains('mls-lite')) document.body.classList.add('mls-lite');"],
  /* 2026-08-07, ph2-1.0.0. Two sides of one handover, and BOTH run on a
     repeating pass on a phone: __mlsPhoneHome.ensure() is a 1600ms interval, and
     the new phone UI's ensure() re-runs on every engine mode change. Each drops
     `mls-phone` when the new UI owns the screen, so without the compare a phone
     would eat a whole-document style invalidation roughly every 1.6 seconds for
     a class that was already gone — on the one device in this product with the
     least main thread to spare. */
  ['mls-connect.js', '__mlsPhoneHome.ensure(), new-UI handover', 'remove() on a 1600ms interval',
    "if (document.body.classList.contains('mls-phone')) document.body.classList.remove('mls-phone');"],
  ['feat_mls_phone_ui.js', '__mlsPhoneUI.ensure(), legacy stand-down', 'remove() on every ensure()',
    "if (document.body.classList.contains('mls-phone')) document.body.classList.remove('mls-phone');"]
];

for (const [file, fn, volume, guard] of GUARDED) {
  assert(read(file).includes(guard),
    file + ': ' + fn + ' (' + volume + ') must compare before it commits. For add()/remove() ' +
    'an unchanged body class is still re-serialised and re-set, invalidating style for the whole ' +
    'document; for toggle() the guard is belt-and-braces. Expected:\n    ' + guard);
}

/* ---- 2. the unguarded forms are actually gone, not merely shadowed ------- */

const BANNED = [
  ['mls-connect.js', "try { document.body.classList.toggle('mls-top-voice-tools', visible); } catch (e) {}"],
  ['mls-connect.js', "      body.classList.toggle('ez3fl-top-owns', !staff && laneMounted);"],
  ['feat_athena_tooltip_dedupe.js', "\n    document.body.classList.add('mls-has-easy-advanced-trigger');"],
  ['feat_athena_tooltip_dedupe.js', "    document.body.classList.toggle('mls-has-exact-portal-action', !!(exact && exact.isConnected));"],
  ['feat_athena_tooltip_dedupe.js', "    if (document.body) document.body.classList.toggle('mls-settings-open', open);"],
  ['feat_mls_pervisit_unify.js', '    if (rich && base) cls.add("mls-pvu-rich");\n    else cls.remove("mls-pvu-rich");'],
  ['ScribeFlow.html', 'safe(function(){ document.body.classList.remove(BODY_CLS); });'],
  ['ScribeFlow.html', 'safe(function(){ document.body.classList.add(BODY_CLS); });'],
  ['ScribeFlow.html', "try{ document.body.classList.toggle('pt-has-active', !!p); }catch(e){}"],
  ['feat_mls_redesign.js', "document.body.classList.toggle('mls-has-active-patient',hasPatient);"],
  ['feat_mls_redesign.js', "document.body.classList.toggle('mls-no-active-patient',!hasPatient);"],
  ['feat_mls_redesign.js', "document.body.classList.toggle('mls-has-note-draft',!!(hasPatient&&noteText));"],
  ['mls-connect.js', "\n      document.body.classList.add('mls-lite');"]
];
for (const [file, snippet] of BANNED) {
  assert(!read(file).includes(snippet),
    file + ' still contains the unguarded write:\n    ' + snippet.trim());
}

/* ---- 3. WHICH FORMS ACTUALLY RE-COMMIT — the correction ------------------
 *
 * An earlier version of this suite enforced "no unguarded toggle(name, force)
 * on <body>" across every published file. That rule guarded a non-issue, and
 * this comment exists so nobody reinstates it.
 *
 * Measured on the live page, on document.body, with page-originated calls
 * counted separately and a zero-call control:
 *
 *     50x toggle(present, force=true)    ->   0 attribute records
 *     50x toggle(absent,  force=false)   ->   0
 *     50x add(alreadyPresent)            ->  50
 *     50x remove(notPresent)             ->  50
 *     50x setAttribute('class', same)    ->  50
 *     50x className = same               ->  50
 *     toggle causing a REAL change       ->   1 per change (correct)
 *
 * The DOM spec agrees: toggle with a force argument returns early when the
 * token's presence already matches force, WITHOUT running the update steps.
 * add() and remove() run the update steps unconditionally, so they re-serialise
 * and re-set the attribute even when the token set did not change.
 *
 * So the churn measured on the owner's screen came from add() and remove():
 *   54x add('mls-has-easy-advanced-trigger')   feat_athena_tooltip_dedupe.js
 *   14x remove('mls-pvu-rich')                 feat_mls_pervisit_unify.js
 *    5x remove('mls-has-active-pt')            ScribeFlow.html ctx-bar build()
 * which is the large majority of the 86 records seen in 44s. The toggle guards
 * in the GUARDED list above are belt-and-braces: semantically identical, they
 * skip a call, and they remove no style invalidation. They are kept, but they
 * are not the fix and must not be cited as one.
 *
 * There is no static rule here for add/remove, deliberately. 30 unguarded
 * add/remove sites exist across the published files and most are one-shot mount
 * or teardown paths, which are not churn. "Runs on a repeating pass" is not
 * decidable from the source line, so the count tripwire below is the guard: any
 * new site forces a human to open this file and read the measurement.
 */

const scanned = PUBLISHED.length;

/* A count tripwire, so that a new unguarded add()/remove() on a repeating pass
   forces someone to open this file and read the measurement above. All sites at
   these counts have been read by hand; one-shot init and teardown paths are
   included and are not churn. */
/* 2026-07-28: site 23 is the ez3sec0 fold toggle in renderDoctor - it
   compares contains() to the wanted state before toggling, so a repeating
   render pass re-commits nothing (read by hand). */
/* 2026-07-29: site 24 is the body.mls-recording toggle beside the live-pill
   toggle in the flow-bar painter. THREE modules (magic, polish-everywhere,
   ui-clinical) stand down while that class is present and NOTHING ever added it,
   so every one of those guards was dead - and a guard that cannot fire reads in
   review as a safety property already handled. This is the one place that already
   knows whether capture is live, so it is the honest place to say so.
   It DOES run on a repeating pass, and it is guarded exactly like the pill
   beside it: `if (contains('mls-recording') !== live)` before toggling, so an
   unchanged pass re-commits nothing and cannot cost a whole-document style
   recalc (read by hand). */
/* 2026-08-07: site 25 in mls-connect.js is the new-UI handover in
   __mlsPhoneHome.ensure() — it drops `mls-phone` when feat_mls_phone_ui.js owns
   the screen, on that module's 1600ms interval, and it compares first (read by
   hand, and pinned in GUARDED above).
   feat_mls_phone_ui.js JOINS this tripwire at 3 rather than being left off it,
   because the whole point of the enumeration above is that a rule scoped to the
   files you already suspect keeps missing the next one. Its three sites are:
   add('mls-ph2') on mount and remove('mls-ph2') on unmount, both one-shot and
   both behind an isConnected/mounted check, plus the guarded `mls-phone`
   removal above. */
/* b977 route fast-path: the three additional ScribeFlow sites are guarded
   add/remove calls in syncRouteLayout(). They are O(1) route-state repairs,
   never recurring passes, and prevent a stale patient identity from showing
   while its cold record refresh waits for browser idle. */
const SITES = { 'mls-connect.js': 25, 'feat_athena_tooltip_dedupe.js': 9, 'feat_mls_pervisit_unify.js': 1, 'ScribeFlow.html': 15, 'feat_mls_redesign.js': 6, 'feat_mls_phone_ui.js': 3 };
const ANY_OP = /(?:document\.body|\bbody)\.classList\.(?:add|remove|toggle)\(/g;
for (const [file, expected] of Object.entries(SITES)) {
  const found = (read(file).match(ANY_OP) || []).length;
  assert.strictEqual(found, expected,
    file + ' has ' + found + ' body-class mutation sites, expected ' + expected + '. If you added ' +
    'one, confirm it does not run on a repeating pass — or guard it — then update this count.');
}

/* ---- 4. the two changed satellites ship under tokens that moved ----------
 *
 * Both load through fixed ?v= URLs and the service worker serves versioned
 * assets cache-first, so a corrected file behind a frozen token is a fix that
 * reaches no browser at all. That is how six builds of Calm Shell work were
 * lost in July; feat_mls_pervisit_unify.js was not even registered in the
 * immutable-loader contract until this change, so nothing would have objected.
 */

const connect = read('mls-connect.js');
assert(connect.includes("var A='feat_athena_tooltip_dedupe.js'") &&
  connect.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())"),
  'feat_athena_tooltip_dedupe.js must follow the shared build cache token');
assert(!connect.includes('20260808ui127perf2') && !connect.includes('20260808ui126perf1'),
  'feat_athena_tooltip_dedupe.js still exposes a retired hand-maintained token');
for (const [asset, token, retired] of [
  ['feat_mls_pervisit_unify.js', '20260725pvu1c2', '20260629pvu1c1']
]) {
  /* The loaders build the URL from a variable — s.src = A + '?v=' + token — so
     the literal "asset.js?v=token" never appears in the source. Assert on the
     token itself, exactly as the immutable-satellite contract does: present
     once, and the retired one gone. */
  assert(connect.includes(asset), asset + ' has no production loader at all');
  assert.strictEqual(connect.split('?v=' + token).length - 1, 1,
    asset + ' was changed by this fix, so it must be served under a token that moved. ' +
    'Expected exactly one loader carrying ?v=' + token + '. The service worker serves ' +
    'versioned assets cache-first: a corrected file behind a frozen token reaches no browser.');
  assert(!connect.includes(retired),
    asset + ' still exposes the retired cache token ' + retired + ' somewhere in the loader bundle');
}
assert(connect.includes("var A='feat_mls_redesign.js',V='3.2.4'") &&
  connect.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())"),
  'redesign is a high-churn performance owner and must follow the shared build token');
assert(!connect.includes('20260808rd332perf2') && !connect.includes('20260804rd331'),
  'a retired hand-maintained redesign cache token is still reachable');

console.log('PASS body-class churn: the 3 measured add()/remove() writers (54+14+5 no-op attribute re-commits) now compare first, 10 further toggle sites carry belt-and-braces guards, and changed satellites use fresh or build-bound cache tokens (' + scanned + ' published files scanned)');
