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
  '#4B564F': 1,   // "b578"
  '#d8b574': 8,   // "b578"
  '#b58105': 1,   // "b581"
  '#5b7186': 19,  // "b718"
  '#6b7280': 5,   // "b728"
  '#6B756E': 1,   // "b756"
  '#B07636': 42,  // "b763"
  '#6b7684': 1,   // "b768"
  '#b9770a': 6,   // "b977"
};

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
