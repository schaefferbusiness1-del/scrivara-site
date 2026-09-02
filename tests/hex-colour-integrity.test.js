/* Build bumps must never rewrite a colour.
 *
 * 2026-07-24: a build bump replaced the bare token "b551" with "b557" using a
 * plain string replace. The token also sits INSIDE the hex literal #6b5518, so
 * the replace produced #6b5578 and shipped LIVE. Nobody saw it in review - a
 * one-character colour change is invisible in a diff full of version pins, and
 * the site kept working. It surfaced only because the extension's core digest
 * refused to match.
 *
 * The corrupted output always carries a signature: replacing bOLD with bNEW
 * inside a hex leaves a hex that CONTAINS bNEW, the current build number. So
 * this test asserts one invariant that fires exactly on the corruption and
 * never on a deliberate colour:
 *
 *     no hex literal may contain the CURRENT build token
 *
 * Colours that already contained a bNNN-shaped substring before the build
 * number reached it are listed in PREEXISTING below with the exact number of
 * occurrences. Those are real, chosen colours - not corruption - and each one
 * becomes a live hazard on one specific future build. Pinning their counts
 * means that if a bump ever does rewrite one, the count moves and this test
 * names it, even on the build where the invariant itself must stay quiet.
 *
 * Note this test does NOT depend on the bump tooling being correct. A
 * boundary-anchored regex is the right fix and is in use, but it is one script
 * among several that touch version tokens, and the next one written under time
 * pressure will not remember. This catches the damage regardless of source.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const EXT = new Set(['.js', '.html', '.css']);
const SKIP_DIR = new Set(['node_modules', '.git', 'tests', 'scripts', '_u183207', '_u8190110', '_u9191505']);
const HEX = /#[0-9a-fA-F]{6}\b/g;
const BUILD_TOKEN_IN_HEX = /b\d{3}/i;

/* Colour -> occurrences, for every hex whose text contains a bNNN substring
   that the build number has NOT yet reached. Each will collide with the
   invariant on exactly one future build; the count is what protects it then.
   Counted at build b559 on 2026-07-24. */
const PREEXISTING = {
  '#b8860b': 6,   // "b886" — darkgoldenrod, one copy each in ScribeFlow.html /
                  //          -staging / _test since long before b886;
                  //          git-verified identical on origin/main (b885) at
                  //          the moment the build number caught up to it on
                  //          2026-08-05. The boundary-anchored bumper cannot
                  //          touch it ("b886" is followed by "0b").
                  //          +1 on 2026-08-16: the /cloned lane. Clone count
                  //          matches ScribeFlow.html exactly; inherited copies,
                  //          not new design. A build bumper must treat the
                  //          cloned files like their originals.
                  //          2026-08-17, RE-COUNTED, TOTAL UNCHANGED: /cloned is
                  //          no longer derived from production but from /1p
                  //          (scripts/derive-cloned-from-1p.js) and gained 15
                  //          cloned-feat_*.js files. Measured per source file:
                  //          ScribeFlow.html 1, 1pScribeFlow.html 1,
                  //          cloned/index.html 1, all 15 1p-feat_*.js 0, all 15
                  //          cloned-feat_*.js 0. The clone's source moved; its
                  //          contribution did not.
  '#2fb986': 2,   // "b986" — a green in ScribeFlow-staging.html and
                  //          ScribeFlow_test.html, present since the commit that
                  //          ADDED staging (7a986898), long before the build number
                  //          approached it. The build number caught up on
                  //          2026-08-09 and this invariant fired; git-verified
                  //          untouched by the b986 bump (identical at HEAD~1, ~2
                  //          and ~3), so it is a collision, not a corruption.
                  //          The bumper cannot reach it either: bump-build.js:88
                  //          replaces /\bb\d{3,5}\b/ and the "f" before "b986"
                  //          is a word character, so there is no \b to match on.
  '#2bb673': 1,   // "b673" — calendar-polish green, present since before b600;
                  //          collided with the live build number on 2026-07-26
                  //          (git-verified untouched by the b673 bump)
  '#4B564F': 1,   // "b564"
  '#d8b574': 8,   // "b574"
  '#b58105': 3,   // "b581"
                  //          +1 on 2026-08-16: the /cloned lane. Clone count
                  //          matches mls-connect.js exactly; inherited copies,
                  //          not new design. A build bumper must treat the
                  //          cloned files like their originals.
                  //          2026-08-17, RE-COUNTED, TOTAL UNCHANGED after
                  //          /cloned was re-derived from /1p: mls-connect.js 1,
                  //          1p-mls-connect.js 1, cloned-mls-connect.js 1, and
                  //          0 in every 1p-feat_*.js and cloned-feat_*.js.
  '#5b7186': 26,  // "b718"
                  //          -4 on 2026-08-20: the production promotion
                  //          (derive-production-from-1p) replaced the old
                  //          shared feat files with the 1p forks, which use
                  //          this colour four fewer times. Shell + connect
                  //          counts verified unchanged (3 + 1).
                  //          +4 on 2026-08-16: the /cloned lane. Clone count
                  //          matches ScribeFlow.html + mls-connect.js exactly;
                  //          inherited copies, not new design. A build bumper
                  //          must treat the cloned files like their originals.
                  //          2026-08-17, RE-COUNTED, TOTAL UNCHANGED after
                  //          /cloned was re-derived from /1p: shell 3 + bundle 1
                  //          in EACH of the three lanes (production, /1p,
                  //          /cloned), and 0 in every forked feature file.
  '#6b7280': 10,   // "b728" — +1 on 2026-08-06: the 3.0.45 full-file candidate
                  //          (same review_screen.js copy; verified the delta is
                  //          exactly 1 and lives only in extension-candidates/3.0.45)
                  //          +1 on 2026-08-03: the 3.0.44 full-file candidate
                  //          adds another review_screen.js copy.
                  //          +1 on 2026-08-02: extension-candidates/3.0.40 is
                  //          the first candidate staged with ALL 20 files (the
                  //          release-coherence copy), so review_screen.js's
                  //          copy of this colour now counts twice repo-wide
                  //          +1 on 2026-08-16: the /cloned lane. Verified the
                  //          clone's count matches mls-connect.js EXACTLY, so
                  //          these are inherited copies, not new design and not
                  //          corruption.
                  //          NOTE: the clone doubles this colour's exposure to a
                  //          plain-replace build bump - a bumper must treat
                  //          cloned-mls-connect.js / cloned/index.html the same
                  //          way it treats their originals.
                  //          2026-08-17, RE-COUNTED, TOTAL UNCHANGED after
                  //          /cloned was re-derived from /1p: mls-connect.js 1,
                  //          1p-mls-connect.js 1, cloned-mls-connect.js 1, and
                  //          0 in every 1p-feat_*.js and cloned-feat_*.js.
  '#6B756E': 1,   // "b756"
  '#B07636': 69,  // "b076" — +3 on 2026-08-06 (the 3.0.45 candidate's
                  //          mls-popup.css copy; delta verified to be exactly 3
                  //          and confined to extension-candidates/3.0.45)
                  //          +3 on 2026-08-02 (the 3.0.40 candidate's
                  //          mls-popup.css copy), +3 again on 2026-08-03
                  //          (the 3.0.44 full-file candidate, same copy)
                  //          +9 on 2026-08-16: the /cloned lane. Verified the
                  //          clone's count matches mls-connect.js EXACTLY, so
                  //          these are inherited copies, not new design and not
                  //          corruption.
                  //          NOTE: the clone doubles this colour's exposure to a
                  //          plain-replace build bump - a bumper must treat
                  //          cloned-mls-connect.js / cloned/index.html the same
                  //          way it treats their originals.
                  //          2026-08-17, RE-COUNTED, TOTAL UNCHANGED after
                  //          /cloned was re-derived from /1p: mls-connect.js 9,
                  //          1p-mls-connect.js 9, cloned-mls-connect.js 9, and
                  //          0 in every 1p-feat_*.js and cloned-feat_*.js.
  '#6b7684': 1,   // "b768"
  '#b9770a': 12,  // "b977" — collided with the live build number on 2026-08-08.
                  //          The bump script rewrote all 6 to #b9780a before a
                  //          diff caught it; the bump now masks hex literals.
                  //          +2 on 2026-08-16: the /cloned lane. Verified the
                  //          clone's count matches ScribeFlow.html EXACTLY, so
                  //          these are inherited copies, not new design and not
                  //          corruption.
                  //          NOTE: the clone doubles this colour's exposure to a
                  //          plain-replace build bump - a bumper must treat
                  //          cloned-mls-connect.js / cloned/index.html the same
                  //          way it treats their originals.
                  //          2026-08-17, RE-COUNTED, TOTAL UNCHANGED after
                  //          /cloned was re-derived from /1p: ScribeFlow.html 2,
                  //          1pScribeFlow.html 2, cloned/index.html 2, and 0 in
                  //          every 1p-feat_*.js and cloned-feat_*.js.
  '#8b9791': 8,   // "b979" — the write-back walkthrough's muted todo colour
                  //          +1 on 2026-08-20: the production promotion —
                  //          ScribeFlow.html is now the 1p shell, which
                  //          carries one use (verified 0 -> 1, shell only).
                  //          +3 on 2026-09-02: writeui-1.0.0 (b1193) reused the
                  //          same muted todo colour for the Send to Athena
                  //          sheet in 1p-feat_mls_writeflow.js, which derives
                  //          into feat_mls_writeflow.js and
                  //          cloned-feat_mls_writeflow.js (1 each, measured
                  //          per file; every other copy unchanged).
                  // (feat_mls_writeback_walkthrough.js), plus residue-athena-1.0.0's
                  // evidence-derived step chips reusing the palette in both twins
                  // + derived cloned (2026-08-18: 1 production + 3 residue).
                  //          byte-identical since its introduction in
                  //          d1aa8a98 on 2026-07-27; the b979 bump did not
                  //          edit that asset or this chosen colour.
  '#e0b877': 6,   // "b877" — the fill-box amber border and its dictation-
                  //          +1 on 2026-08-20: the production promotion —
                  //          ScribeFlow.html is now the 1p shell (0 -> 1,
                  //          shell only, connect unchanged).
                  // corr button (feat_mls_opnote_fill.js), plus the opnote-day
                  // shell comments naming the colour in both twins + derived
                  // cloned (2026-08-18: 2 CSS literals + 3 prose comments).
                  //          correction twin in feat_mls_opnote_fill.js.
                  //          Collided with the live build number on 2026-08-05
                  //          at the b876 -> b877 bump. Git-verified untouched:
                  //          both occurrences are byte-identical at HEAD b876,
                  //          in a file the b877 change never opened.
  '#b7791f': 1,   // "b779" — AuthPilot amber (--mod), byte-identical since the
                  //          file's first upload; collided with the live build
                  //          number on 2026-07-28 (git-verified untouched by
                  //          any bump: same hex at 51940a2a and da2bf625)
  '#f5b942': 7,   // "b942" — the checking/warning amber: the connection dot in
                  //          mls-connect.js (twice, the inline colour and its
                  //          .mls-b35-dot.chk rule) and the off-today outline in
                  //          feat_mls_fixpack_0701.js. Collided with the live
                  //          build number on 2026-08-07 at the b941 -> b942
                  //          phone-rebuild bump. Git-verified untouched: all
                  //          three are byte-identical at HEAD b941, and the
                  //          bump's diff does not contain the string f5b94 at
                  //          all — two of the three live in a file the bump
                  //          edited, which is exactly the case this pin exists
                  //          to keep honest.
};

/* 2026-08-12: the reviewed 1p preview added one shell and three prefixed
   runtime copies to the repository. The seven totals changed above are the
   exact additive occurrences in those four files; production colours did not
   move. Keeping them in the totals makes future preview build-token corruption
   fail this same repository-wide guard instead of exempting the preview. */
/* The dedicated p1/index.html live route is a byte-copy of that reviewed
   preview shell apart from its route/base bootstrap. Its exact additive
   shell-only occurrences are +1 #b8860b, +3 #5b7186, and +2 #b9770a. */
/* 2026-08-17: /cloned stopped being a production clone and became a DERIVED
   copy of /1p (scripts/derive-cloned-from-1p.js), which added 15
   cloned-feat_*.js files to the repository. Every at-risk hex was re-counted
   file by file before this file was touched, and NOT ONE TOTAL MOVED: the /1p
   shell and bundle carry exactly the production counts (1/0/3/0/2 vs 0/1/1/9/2
   for the six annotated colours, identical to ScribeFlow.html / mls-connect.js),
   and all 15 1p-feat_*.js — and therefore all 15 cloned-feat_*.js — contain
   ZERO at-risk hex literals. The clone's SOURCE changed; its contribution to
   every pin above did not. The per-colour annotations record the measurement. */

/* The annotations above have rotted before: successive blanket build bumps
   rewrote the b564 and b574 comments to b581 — which is exactly the defect
   this file exists to prevent, committed against the file that prevents it.
   Nobody noticed, because a comment cannot fail a suite. Now it can: each
   annotation is checked against the hex it describes. */
{
  const src = fs.readFileSync(__filename, 'utf8');
  const documented = src.match(/'#[0-9a-fA-F]{6}':\s*\d+,\s*\/\/\s*"b\d{3}"/g) || [];
  assert(documented.length >= 8,
    'PREEXISTING annotations disappeared; found ' + documented.length);
  for (const line of documented) {
    const hex = line.match(/'(#[0-9a-fA-F]{6})'/)[1];
    const said = line.match(/"(b\d{3})"/)[1].toLowerCase();
    const real = (hex.match(BUILD_TOKEN_IN_HEX) || [''])[0].toLowerCase();
    assert(said === real, 'hex ' + hex + ' is annotated "' + said + '" but actually contains "' +
      real + '". A build bump rewrote the comment: bump pins, never prose.');
  }
}

function currentBuildToken() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-version.json'), 'utf8'));
  const m = String(raw.build || '').match(/(b\d{3,})$/i);
  assert(m, 'app-version.json build must end in a bNNN token, got: ' + raw.build);
  return m[1].toLowerCase();
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
assert(files.length > 50, 'expected to scan the whole site, found ' + files.length + ' files');

const token = currentBuildToken();
const counts = new Map();
const offenders = [];

for (const file of files) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
  const found = text.match(HEX);
  if (!found) continue;
  for (const hex of found) {
    if (!BUILD_TOKEN_IN_HEX.test(hex)) continue;
    counts.set(hex, (counts.get(hex) || 0) + 1);
    if (hex.toLowerCase().includes(token) && !Object.prototype.hasOwnProperty.call(PREEXISTING, hex)) {
      offenders.push(hex + '  in  ' + path.relative(ROOT, file));
    }
  }
}

let failures = 0;

if (offenders.length) {
  failures++;
  console.error(
    '\nFAIL: hex colour(s) contain the current build token "' + token + '".\n' +
    'This is the signature of a build bump that string-replaced the version\n' +
    'token inside a colour. Restore the original colour, then bump with a\n' +
    'boundary-anchored pattern:\n' +
    "  new RegExp('(^|[^0-9A-Za-z])' + tok + '(?![0-9A-Za-z])', 'g')\n" +
    'If the colour is genuinely intentional, add it to PREEXISTING with its\n' +
    'occurrence count and say why.\n  ' + offenders.join('\n  ') + '\n'
  );
}

for (const [hex, want] of Object.entries(PREEXISTING)) {
  const got = counts.get(hex) || 0;
  if (got !== want) {
    failures++;
    console.error(
      '\nFAIL: pinned colour ' + hex + ' occurs ' + got + ' time(s), expected ' + want + '.\n' +
      'These colours contain a bNNN substring the build number has not reached\n' +
      'yet, so a plain-replace bump would silently rewrite them. A changed count\n' +
      'is either that corruption or a deliberate design change - confirm which,\n' +
      'and only then update PREEXISTING.\n'
    );
  }
}

if (failures) {
  console.error('hex-colour-integrity: ' + failures + ' failure(s)');
  process.exit(1);
}

console.log(
  'hex-colour-integrity: OK (build ' + token + '; scanned ' + files.length +
  ' files; ' + counts.size + ' at-risk colours; ' + Object.keys(PREEXISTING).length + ' pinned)'
);
