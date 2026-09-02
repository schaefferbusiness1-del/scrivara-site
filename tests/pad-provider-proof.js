'use strict';

/* padprov-1.0.0 - THE "PULL THIS DAY FROM ATHENA" SCOPE MUST NEVER BE A LABEL
 * SENTENCE. Plain node: no Athena account, no backend, no browser, no PHI.
 *
 * MEASURED LIVE (2026-09-02 05:5x, owner's tab): #mlsPadBtn was pressed for
 * 2026-08-06 while athenaOne showed a full column of appointments that day.
 * MLS answered "athenaOne shows no appointments on Aug 6, 2026 for Your
 * athenaOne view (default) - nothing imported, no charts to pull" - a FALSE
 * empty. The handler resolved provider scope as
 *   prov = (t && !/^all providers$/i.test(t)) ? t : 'all'
 * where t was the text of #ez3PullFor - and the current month card paints
 * that label as "Your athenaOne view (default)" (DEFAULT_PROVIDER_SCOPE_LABEL,
 * 1p-mls-connect.js ~line 21009) when no one doctor is picked. The control
 * pulled for a provider literally named "Your athenaOne view (default)",
 * matched no rows, and reported "no appointments" for a day with a full
 * schedule.
 *
 * Neither activeProviderLabel() nor DEFAULT_PROVIDER_SCOPE_LABEL is exposed
 * on window (both are closure-private to 1p-mls-connect.js), so the fix
 * (resolvePadScope, in 1p-feat_mls_b121_pack.js) recognizes the label text
 * directly - both the default-scope wording AND the older "all providers"
 * wording resolve to 'all' - and cross-checks any other resolved name
 * against window.__mlsProviderRoster.providers() when that roster is
 * installed and populated, falling back to 'all' rather than ever inventing
 * a provider filter athenaOne cannot match.
 *
 * This suite lifts the REAL resolvePadScope() function out of the shipped
 * asset (never reimplements it) and executes it in a DOM/window stub for
 * every case above, plus the untouched #ez3sPullProv override path.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, '1p-feat_mls_b121_pack.js'), 'utf8');

let checks = 0;
function ok(cond, message) { checks++; assert.ok(cond, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }

/* ---- brace walker (quote/comment-aware), same pattern as
   attention-days-proof.js / day-note-proof.js / capture-keeps-selection-proof.js
   - comments are recognised BEFORE quotes since this file's blocks are
   documented in prose full of apostrophes. ---- */
function balanced(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'slice not found: ' + (label || signature));
  let depth = 0, quote = '', i = source.indexOf('{', start);
  assert(i > start, 'slice has no body: ' + (label || signature));
  for (; i < source.length; i++) {
    const ch = source[i], prev = source[i - 1];
    if (quote) { if (ch === quote && prev !== '\\') quote = ''; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated slice: ' + (label || signature));
}

const resolvePadScopeSrc = balanced(SRC, 'function resolvePadScope() {', 'resolvePadScope');

/* pin the fix by shape: the old, buggy single-line reduction must be gone,
   and the default-scope wording must be recognised by name. */
assert.ok(!/!\/\^all providers\$\/i\.test\(t\)\)\s*\?\s*t\s*:\s*'all'/.test(resolvePadScopeSrc),
  'the old bare "all providers"-only reduction must not survive verbatim');
assert.ok(resolvePadScopeSrc.indexOf('your athenaone view (default)') >= 0,
  'resolvePadScope must recognize the default-scope label text');
assert.ok(resolvePadScopeSrc.indexOf('all providers') >= 0,
  'resolvePadScope must still recognize the older "All providers" wording');
assert.ok(resolvePadScopeSrc.indexOf('ez3sPullProv') >= 0,
  'resolvePadScope must still honor an older card\'s explicit dropdown');
assert.ok(resolvePadScopeSrc.indexOf('__mlsProviderRoster') >= 0,
  'resolvePadScope must cross-check a resolved name against the provider roster when reachable');

function run(html, rosterProviders, ez3sPullProvValue) {
  const nodes = {
    ez3PullFor: { textContent: html == null ? '' : html },
  };
  if (ez3sPullProvValue !== undefined) {
    nodes.ez3sPullProv = { value: ez3sPullProvValue };
  }
  const sandbox = {
    document: {
      getElementById: function (id) { return Object.prototype.hasOwnProperty.call(nodes, id) ? nodes[id] : null; }
    },
    window: {
      __mlsProviderRoster: rosterProviders === undefined ? undefined : {
        providers: function () { return rosterProviders; }
      }
    },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(resolvePadScopeSrc, sandbox, { filename: 'resolvePadScope.vm.js' });
  return sandbox.resolvePadScope();
}

/* ---- Case 1: the exact live-measured false-empty label -> 'all' -------- */
eq(run('Your athenaOne view (default)', undefined, ''), 'all',
  'the default-scope label must resolve to the "all" scope, not a literal provider name');

/* ---- Case 2: the older "All providers" wording -> 'all' --------------- */
eq(run('All providers', undefined, ''), 'all',
  'the older "All providers" wording must still resolve to "all"');

/* ---- Case 3: a real, roster-known provider name is preserved ---------- */
eq(run('Uyen Phan, PA-C', ['Uyen Phan, PA-C', 'Matthew Schaeffer, MD'], ''), 'Uyen Phan, PA-C',
  'a real provider name recognized by the roster must reach runFlow unchanged');

/* ---- Case 3b: same, with no roster installed (older builds) ----------- */
eq(run('Uyen Phan, PA-C', undefined, ''), 'Uyen Phan, PA-C',
  'a provider name must still be honored when no roster is reachable at all');

/* ---- Case 4: an older card's #ez3sPullProv dropdown always wins ------- */
eq(run('Your athenaOne view (default)', undefined, 'Kelly Carter, PA-C'), 'Kelly Carter, PA-C',
  'an older card exposing #ez3sPullProv must win outright, even over a default-scope label');

/* ---- Case 5: roster reachable and populated, but silent on this label ->
   never invent a provider filter athenaOne cannot match ----------------- */
eq(run('Some Stale Cached Name', ['Uyen Phan, PA-C', 'Matthew Schaeffer, MD'], ''), 'all',
  'a name the populated roster does not recognize must fall back to "all", never reach runFlow as a fake filter');

/* ---- Case 6: no label at all (element missing / blank) -> 'all' ------- */
eq(run('', undefined, ''), 'all', 'a blank/missing label must resolve to "all", never an empty-string filter');
eq(run(null, undefined, undefined), 'all', 'a missing #ez3PullFor node must resolve to "all"');

console.log('PAD_PROVIDER_PROOF_OK checks=' + checks);
