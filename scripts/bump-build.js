#!/usr/bin/env node
'use strict';

/*
 * Bump the build token everywhere it is pinned, and return a commit subject that
 * names the build actually written.
 *
 * WHY THIS EXISTS. bdf150e shipped labelled b661 while app-version.json said
 * b662, and it turned main red for every lane running run-all.js. That was not
 * author error. The ship path detected a build-number collision, re-bumped
 * app-version.json, and pushed with the subject it had already composed. The
 * file moved; the message did not. It recurs on EVERY collision, and collisions
 * happened repeatedly in a single day.
 *
 * The gate that caught it had to have its cutoff advanced to let main go green,
 * and the QA lane's note on that exemption is the reason this file exists:
 *
 *     "ADVANCING THE CUTOFF IS NOT FREE AND SHOULD NOT BECOME ROUTINE. Each
 *      advance exempts a real violation. If this constant moves again, the
 *      honest conclusion is that a SHIP PATH IS ROUTING AROUND THE GATE."
 *
 * So the fix belongs at the writer, not in another reader: the same step that
 * computes the number writes it into the subject, and REFUSES when there is no
 * token to correct. A subject cannot go stale underneath its author if the
 * author never supplies the final number.
 *
 * Usage:
 *   node scripts/bump-build.js "b000: my subject"     -> prints the corrected subject
 *   node scripts/bump-build.js --check "b664: subj"   -> validate only, write nothing
 *
 * Exit non-zero, loudly, when the subject carries no bNNN token.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* Every file that pins the build token. A partial bump is refused. */
const TARGETS = [
  'app-version.json',
  'mls-connect.js',
  'ScribeFlow.html',
  'tests/boot-loading-visual-contract.test.js',
  'tests/interaction-performance-contract.test.js',
  'tests/patient-card-contrast-contract.test.js',
  'tests/same-tab-session-ui-isolation-runtime.test.js',
  'tests/startup-hydration-contract.test.js'
];

/* BOUNDARY-ANCHORED, and this is not optional. `bNNN` matches inside hex
 * colours - '#6b5518' contains 'b551' - and a naive build-bump regex has
 * already corrupted a colour in production in this repo. A token is only
 * rewritten when the characters on both sides are non-alphanumeric, so 'b551'
 * inside '#6b5518' (preceded by '6') and 'b5510' (followed by '0') are both
 * left alone. Guarded the same way since 063f10d. */
function replaceToken(src, oldToken, newToken) {
  let out = '', i = 0, hits = 0;
  for (;;) {
    const at = src.indexOf(oldToken, i);
    if (at === -1) { out += src.slice(i); break; }
    const prev = at > 0 ? src[at - 1] : ' ';
    const next = src[at + oldToken.length] || ' ';
    const isolated = !/[0-9a-zA-Z]/.test(prev) && !/[0-9a-zA-Z]/.test(next);
    out += src.slice(i, at) + (isolated ? (hits++, newToken) : oldToken);
    i = at + oldToken.length;
  }
  return { out, hits };
}

function currentBuild() {
  const raw = fs.readFileSync(path.join(ROOT, 'app-version.json'), 'utf8');
  const m = /"build":"(\d{4}-\d{2}-\d{2})-b(\d+)"/.exec(raw);
  if (!m) throw new Error('app-version.json has no readable build token');
  return { date: m[1], token: 'b' + m[2], n: Number(m[2]) };
}

/* The whole point of the file: the subject must name the build that was
   written, and must contain a token to correct in the first place. */
function retargetSubject(subject, newToken) {
  const s = String(subject || '');
  if (!/\bb\d{3,5}\b/.test(s)) {
    throw new Error(
      'commit subject carries no bNNN build token to correct: ' + JSON.stringify(s.slice(0, 80)) + '\n' +
      'Every build-bumping commit must name its build in the subject. Pass a placeholder ' +
      'such as "b000: ..." and this script will rewrite it to the real number.');
  }
  return s.replace(/\bb\d{3,5}\b/, newToken);
}

module.exports = { replaceToken, retargetSubject, currentBuild, TARGETS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const checkOnly = args[0] === '--check';
  const subject = checkOnly ? args[1] : args[0];
  if (!subject) {
    console.error('usage: node scripts/bump-build.js [--check] "<subject containing bNNN>"');
    process.exit(2);
  }
  let cur;
  try { cur = currentBuild(); } catch (e) { console.error(e.message); process.exit(1); }
  const next = 'b' + (cur.n + 1);

  let out;
  try { out = retargetSubject(subject, next); }
  catch (e) { console.error(e.message); process.exit(1); }

  if (checkOnly) { console.log(out); process.exit(0); }

  let sites = 0;
  const staged = [];
  for (const rel of TARGETS) {
    const file = path.join(ROOT, rel);
    const r = replaceToken(fs.readFileSync(file, 'latin1'), cur.token, next);
    if (!r.hits) {
      console.error('NO ' + cur.token + ' IN ' + rel + ' - refusing a partial bump');
      process.exit(1);
    }
    staged.push([file, r.out]);
    sites += r.hits;
  }
  for (const [file, content] of staged) fs.writeFileSync(file, content, 'latin1');

  const stagingFile = path.join(ROOT, 'ScribeFlow-staging.html');
  const staging = fs.readFileSync(stagingFile, 'latin1');
  fs.writeFileSync(stagingFile, staging.replace(/__MLS_AV='b\d+'/g, "__MLS_AV='" + next + "'"), 'latin1');

  process.stderr.write('bumped ' + cur.token + ' -> ' + next + ' (' + sites + ' sites + staging)\n');
  console.log(out);
}
