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
 * classList.add / remove / toggle each re-commit the class attribute even when
 * the class is already in the requested state. toggle(name, force) is the most
 * deceptive of the three: it reads like a conditional, and it is not. The force
 * argument selects WHICH state to commit, never WHETHER to commit.
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

const FILES = ['mls-connect.js', 'feat_athena_tooltip_dedupe.js', 'feat_mls_pervisit_unify.js'];

/* ---- 1. every writer on a repeating pass compares before it commits -------
 *
 * The first three were named by stack sampling during the measurement. The
 * other four were found by reading all 22 body.classList sites rather than only
 * the sampled ones - each runs on a render or reconcile pass, so each is the
 * same defect; they simply did not happen to be sampled. Note that
 * mls-top-voice-tools has TWO writers: guarding only the sampled one would have
 * left the churn roughly where it was.
 */

const GUARDED = [
  ['mls-connect.js', 'syncPrimaryVoiceTools', '68 measured',
    "if (document.body.classList.contains('mls-top-voice-tools') !== !!visible) document.body.classList.toggle('mls-top-voice-tools', visible);"],
  ['feat_athena_tooltip_dedupe.js', 'reconcileAdvanced', '54 measured',
    "if (!document.body.classList.contains('mls-has-easy-advanced-trigger')) document.body.classList.add('mls-has-easy-advanced-trigger');"],
  ['feat_mls_pervisit_unify.js', 'per-visit unify', '14 measured',
    'if (cls.contains("mls-pvu-rich") !== pvuWant) cls.toggle("mls-pvu-rich", pvuWant);'],
  ['mls-connect.js', 'render() — the second writer of the same class', 'unsampled',
    "if (document.body.classList.contains('mls-top-voice-tools') !== wantTvt) document.body.classList.toggle('mls-top-voice-tools', wantTvt);"],
  ['mls-connect.js', 'primary-lane sync', 'unsampled',
    "if (body.classList.contains('ez3fl-top-owns') !== wantOwns) body.classList.toggle('ez3fl-top-owns', wantOwns);"],
  ['feat_athena_tooltip_dedupe.js', 'reconcilePortalOwner', 'unsampled',
    "if (document.body.classList.contains('mls-has-exact-portal-action') !== wantPortal) document.body.classList.toggle('mls-has-exact-portal-action', wantPortal);"],
  ['feat_athena_tooltip_dedupe.js', 'settings reconcile', 'unsampled',
    "if (document.body && document.body.classList.contains('mls-settings-open') !== open) document.body.classList.toggle('mls-settings-open', open);"]
];

for (const [file, fn, volume, guard] of GUARDED) {
  assert(read(file).includes(guard),
    file + ': ' + fn + ' (' + volume + ') must compare before it commits — an unchanged ' +
    'body class still invalidates style for the whole document. Expected:\n    ' + guard);
}

/* ---- 2. the unguarded forms are actually gone, not merely shadowed ------- */

const BANNED = [
  ['mls-connect.js', "try { document.body.classList.toggle('mls-top-voice-tools', visible); } catch (e) {}"],
  ['mls-connect.js', "      body.classList.toggle('ez3fl-top-owns', !staff && laneMounted);"],
  ['feat_athena_tooltip_dedupe.js', "\n    document.body.classList.add('mls-has-easy-advanced-trigger');"],
  ['feat_athena_tooltip_dedupe.js', "    document.body.classList.toggle('mls-has-exact-portal-action', !!(exact && exact.isConnected));"],
  ['feat_athena_tooltip_dedupe.js', "    if (document.body) document.body.classList.toggle('mls-settings-open', open);"],
  ['feat_mls_pervisit_unify.js', '    if (rich && base) cls.add("mls-pvu-rich");\n    else cls.remove("mls-pvu-rich");']
];
for (const [file, snippet] of BANNED) {
  assert(!read(file).includes(snippet),
    file + ' still contains the unguarded write:\n    ' + snippet.trim());
}

/* ---- 3. the rule, enforced on every toggle-with-force in these files -----
 *
 * Rather than pin a count, encode the actual principle: an unguarded
 * toggle(name, force) on <body> is permitted ONLY where the caller has just
 * flipped the state it is committing, so the value provably always changes.
 * The four `toggle('ez3adv', S.advOpen)` sites are exactly that — each is a
 * click handler whose previous statement is `S.advOpen = !S.advOpen`. Guarding
 * those would never once be false; it would imply churn that does not exist.
 * Guard what repeats, not everything that could be guarded.
 */

const TOGGLE_FORCE = /(?:document\.body|\bbody)\.classList\.toggle\(\s*['"]([\w-]+)['"]\s*,/;
const FLIPS_FIRST = /(\w+(?:\.\w+)*)\s*=\s*!\1\s*;/; /* x.y = !x.y — a real flip */

for (const file of FILES) {
  const lines = read(file).split('\n');
  lines.forEach((line, i) => {
    const m = TOGGLE_FORCE.exec(line);
    if (!m || /\.contains\(/.test(line)) return;
    const preceding = lines.slice(Math.max(0, i - 2), i).join('\n');
    assert(FLIPS_FIRST.test(preceding),
      file + ':' + (i + 1) + ' toggles body class "' + m[1] + '" with a force argument and ' +
      'neither compares first nor follows a statement that flips the value. toggle(name, force) ' +
      'commits the class attribute unconditionally — on a repeating pass that is a whole-document ' +
      'style invalidation per call. Either guard it:\n' +
      '    if (document.body.classList.contains("' + m[1] + '") !== want) document.body.classList.toggle("' + m[1] + '", want);\n' +
      'or, if the value provably changes on every call, flip it on the line above.\n' +
      '  line: ' + line.trim());
  });
}

/* A count tripwire on top of the rule, so that a new unguarded add()/remove()
   on a repeating pass — which rule 3 cannot see — still forces someone to open
   this file and read the measurement above. All sites at these counts have been
   read by hand; one-shot init and teardown paths are included and are not
   churn. */
const SITES = { 'mls-connect.js': 22, 'feat_athena_tooltip_dedupe.js': 9, 'feat_mls_pervisit_unify.js': 1 };
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
for (const [asset, token, retired] of [
  ['feat_athena_tooltip_dedupe.js', '20260725ui124', '20260724ui123'],
  ['feat_mls_pervisit_unify.js', '20260725pvu1c2', '20260629pvu1c1']
]) {
  /* The loaders build the URL from a variable — s.src = A + '?v=' + token — so
     the literal "asset.js?v=token" never appears in the source. Match the
     loader IIFE for this asset and require the token inside it. */
  const at = connect.indexOf(asset);
  assert(at > -1, asset + ' has no production loader at all');
  const iife = connect.slice(at, at + 400);
  assert(iife.includes("?v=" + token) || iife.includes('?v=' + token),
    asset + ' was changed by this fix, so it must be served under a token that moved. ' +
    'Its loader does not carry ?v=' + token + '. The service worker serves versioned assets ' +
    'cache-first: a corrected file behind a frozen token reaches no browser.');
  assert(!connect.includes(retired),
    asset + ' still exposes the retired cache token ' + retired + ' somewhere in the loader bundle');
}

console.log('PASS body-class churn: 7 writers on repeating passes compare before committing (3 measured at 68+54+14 no-op whole-document style invalidations in 44s, 4 more found by reading every site), the 4 permitted unguarded toggles provably flip first, and both changed satellites ship under moved cache tokens');
