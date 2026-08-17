'use strict';

/* FORK PARITY, measured by function set rather than by release token.
 *
 * Why this file exists: the /1p regression audit that cleared the fork was
 * token/line-presence only ("pdr-1.0.0: 3 hits vs 0", "226 tokens vs 267").
 * That instrument is structurally blind to any production function that
 * carries no release token - and exactly such a function (ownAttemptResult,
 * the honest per-attempt pull receipt owner) had been missing from both forks
 * with five live production call sites, unseen by a green 676-suite gate.
 *
 * The instrument here is a `function NAME(` set diff between each production
 * file and its 1p fork. A production function that is CALLED in production but
 * absent from the fork must either be ported, or carry an explicit supersession
 * record naming the fork mechanism that replaced it - and that record's own
 * evidence must still be findable in the fork, so a record cannot rot into a
 * lie after the mechanism it names is deleted.
 *
 * Scope honesty:
 *  - TIER 1 (mls-connect.js -> 1p-mls-connect.js) is fully adjudicated: every
 *    absence is either closed or carries a verified record.
 *  - TIER 2 (the other eight fork pairs) is pinned to a measured baseline
 *    taken 2026-08-17. Those absences are NOT audited; the contract's job
 *    there is to make a NEW absence fail loudly instead of arriving silently.
 * cloned-* is DERIVED from 1p by the release lane, so it is reported for
 * information and never enforced here. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cache = new Map();
function read(file) {
  if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(root, file), 'utf8'));
  return cache.get(file);
}
function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}
function lineOf(starts, index) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}
function lineText(src, starts, line) {
  const start = starts[line - 1];
  const end = line < starts.length ? starts[line] - 1 : src.length;
  return src.slice(start, end);
}

function declaredFunctions(file) {
  const src = read(file);
  const starts = lineIndex(src);
  const out = new Map();
  const re = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!out.has(m[1])) out.set(m[1], lineOf(starts, m.index));
  }
  return out;
}

/* A call site is an invocation that is neither the declaration itself nor a
 * property access (obj.name(...)), and is not inside a line that is entirely a
 * comment. Deliberately conservative: it may undercount, never overcount. */
function callSites(file, name) {
  const src = read(file);
  const starts = lineIndex(src);
  const re = new RegExp('(^|[^A-Za-z0-9_$.])' + name + '\\s*\\(', 'g');
  const declRe = new RegExp('function\\s+' + name + '\\s*\\(');
  const hits = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = lineOf(starts, m.index);
    const text = lineText(src, starts, line);
    if (/^\s*(?:\/\*|\*|\/\/)/.test(text)) continue;
    if (declRe.test(text)) continue;
    hits.push(line);
  }
  return hits;
}

/* -------------------------------------------------------------------------
 * TIER 1 - mls-connect.js, fully adjudicated.
 * Each record must name (a) the fork mechanism that replaced the production
 * function and (b) evidence strings that must all still be present in the
 * fork. `port` records exist so a later deletion of a ported function is
 * reported as a REGRESSION rather than silently re-classified.
 * ---------------------------------------------------------------------- */
const SUPERSESSIONS = {
  'mls-connect.js': {
    tag: {
      by: 'p1-avatar-loader-1.0.0 (window.__mlsP1AvatarLoader)',
      why: 'production tag() is a local helper of the inline av-6.0.8 avatar-skeleton IIFE. ' +
        'The fork replaced that whole IIFE with one loader controller that owns the ' +
        'script[data-mls-asset] lookup, the skeleton node and its retirement, and the later ' +
        'hook only calls ctl.mountSkeleton(). There is no second script-creation path to name.',
      evidence: [
        "var A='feat_mls_avatar.js',SRC='1p-feat_mls_avatar.js'",
        "V='p1-avatar-loader-1.0.0',KEY='__mlsP1AvatarLoader'",
        'typeof ctl.mountSkeleton===\'function\')ctl.mountSkeleton();',
        'function exactSkeleton()'
      ]
    }
  }
};

/* -------------------------------------------------------------------------
 * TIER 2 - measured baseline 2026-08-17 at 1e0151a4 + this lane's ports.
 * These absences are recorded, NOT audited. A name may only leave the list;
 * a name arriving that is not on the list fails the gate.
 * ---------------------------------------------------------------------- */
const BASELINE_ABSENCES = {
  'feat_athena_provider_roster.js': ['operationFromReceipt', 'picker', 'renderDropdown', 'setLastResp'],
  'feat_fullhistory_pdf.js': [],
  'feat_mls_avatar.js': ['applyVision', 'commitEdit', 'faceHiSave'],
  'feat_mls_legalpack.js': [
    'activeFilterNote', 'allPatients', 'buildCaseContext', 'buildHost', 'classifiable',
    'currentNarrative', 'docsOf', 'download', 'filterModel', 'fuLinesOf', 'hide', 'icdOf',
    'mount', 'mountLegacyLegalTool', 'normProv', 'notesOf', 'patientById', 'pickPatient',
    'planOf', 'provOfVisit', 'providerIdentityBlock', 'providerName', 'readAnyFile',
    'renderProvChips', 'say', 'step', 'sysFor', 'visitsOf', 'wireDrop', 'wireSearch'
  ],
  'feat_mls_schedimport_exact.js': [
    'exactNonnegativeInteger', 'exactProviderUnknownCensusRows', 'legacyResumeKey',
    'newResumeIntentId', 'productionAppointmentCensusDecision', 'productionAppointmentCensusScope',
    'publishProviderUnknownAppointmentSnapshot', 'readAuthoritativeStore', 'resumeIntentSignature',
    'rowProviderName', 'validResumeIntentId'
  ],
  'feat_mls_writeflow.js': [],
  'feat_nextup_connect.js': [],
  'feat_task3_frontsync.js': []
};

/* discover the pairs from disk so a NEW fork file cannot dodge the contract */
const forkFiles = fs.readdirSync(root).filter((f) => /^1p-.*\.js$/.test(f));
const pairs = forkFiles
  .map((fork) => [fork.replace(/^1p-/, ''), fork])
  .filter(([prod]) => fs.existsSync(path.join(root, prod)))
  .sort((a, b) => a[0].localeCompare(b[0]));

assert(pairs.length >= 9, 'expected at least 9 production/1p fork pairs, found ' + pairs.length);
assert(pairs.some(([prod]) => prod === 'mls-connect.js'),
  'the mls-connect.js fork pair vanished - the parity contract lost its primary subject');

const report = [];
let tier1Absences = 0;
let tier2New = 0;
let tier2Closed = [];

pairs.forEach(([prod, fork]) => {
  const prodFns = declaredFunctions(prod);
  const forkFns = declaredFunctions(fork);
  const absent = [...prodFns.keys()].filter((n) => !forkFns.has(n));
  const absentWithCalls = absent.filter((n) => callSites(prod, n).length > 0).sort();

  if (prod === 'mls-connect.js') {
    absentWithCalls.forEach((name) => {
      tier1Absences += 1;
      const record = (SUPERSESSIONS[prod] || {})[name];
      const sites = callSites(prod, name);
      assert(record, 'FORK PARITY: production function `' + name + '` (' + prod + ':' + prodFns.get(name) +
        ', ' + sites.length + ' call sites at ' + sites.join(',') + ') has no counterpart in ' + fork +
        ' and no supersession record. Port it, or add a record naming the fork mechanism that replaced it.');
      assert(typeof record.by === 'string' && record.by.length > 8,
        'the supersession record for `' + name + '` does not name a replacement mechanism');
      assert(Array.isArray(record.evidence) && record.evidence.length > 0,
        'the supersession record for `' + name + '` carries no evidence to verify');
      const forkSrc = read(fork);
      record.evidence.forEach((token) => {
        assert(forkSrc.indexOf(token) >= 0,
          'the supersession record for `' + name + '` claims ' + record.by +
          ' but its evidence is gone from ' + fork + ': ' + JSON.stringify(token));
      });
    });
    report.push(prod + ' -> ' + fork + ': ' + prodFns.size + ' vs ' + forkFns.size +
      ' functions, ' + absentWithCalls.length + ' called-but-absent (all recorded)');
    return;
  }

  const baseline = BASELINE_ABSENCES[prod];
  assert(Array.isArray(baseline),
    'FORK PARITY: fork pair ' + prod + ' -> ' + fork + ' has no recorded baseline. ' +
    'Add one (measured, dated) so a later absence cannot arrive silently.');
  const unexpected = absentWithCalls.filter((n) => baseline.indexOf(n) < 0);
  unexpected.forEach((name) => {
    tier2New += 1;
    const sites = callSites(prod, name);
    assert(false, 'FORK PARITY (new absence): production function `' + name + '` (' + prod + ':' +
      prodFns.get(name) + ', ' + sites.length + ' call sites at ' + sites.join(',') +
      ') is called in production and absent from ' + fork + ', and is NOT on the 2026-08-17 baseline. ' +
      'Port it, or record it deliberately.');
  });
  const closed = baseline.filter((n) => absentWithCalls.indexOf(n) < 0);
  if (closed.length) tier2Closed = tier2Closed.concat(closed.map((n) => prod + ':' + n));
  report.push(prod + ' -> ' + fork + ': ' + prodFns.size + ' vs ' + forkFns.size +
    ' functions, ' + absentWithCalls.length + ' called-but-absent (baseline ' + baseline.length + ')');
});

/* The two functions this contract was written for must now be PRESENT. */
const p1 = declaredFunctions('1p-mls-connect.js');
[
  ['ownAttemptResult', 'the honest per-attempt pull receipt owner (oar-1.0.0)'],
  ['providerRenderProof', 'the b1026 provider Day render proof (pdr-1.0.0)'],
  ['providerSnapshotResolve', 'the b1026 exact roster resolver (pdr-1.0.0)'],
  ['sameProviderIdentity', 'the b1026 identity comparison (pdr-1.0.0)'],
  ['rememberRenderedProvider', 'the render receipt writer (pdr-1.0.0)'],
  ['renderedProvider', 'the render receipt reader (pdr-1.0.0)'],
  ['requestedRenderedProvider', 'the explicit-selection test (pdr-1.0.0)']
].forEach(([name, what]) => {
  assert(p1.has(name), 'REGRESSION: ' + what + ' (`' + name + '`) is missing from 1p-mls-connect.js again');
});
/* and they must be WIRED, not merely declared */
const p1src = read('1p-mls-connect.js');
assert(/DS\.lastAttemptResult = owned;/.test(p1src) && /var si = window\.__mlsSI, res = DS\.lastAttemptResult \|\| null;/.test(p1src),
  'ownAttemptResult is declared but the 1p error report no longer reads its receipt');
assert(/rowMatchesActiveProvider\(a, providerProof\)/.test(p1src),
  'providerRenderProof is declared but the 1p Day renderer no longer uses it');

/* cloned-* is DERIVED by the release lane: reported, never enforced. */
if (fs.existsSync(path.join(root, 'cloned-mls-connect.js'))) {
  const cl = declaredFunctions('cloned-mls-connect.js');
  const pendingDerivation = [...p1.keys()].filter((n) => !cl.has(n)).length;
  report.push('cloned-mls-connect.js: ' + cl.size + ' functions, ' + pendingDerivation +
    ' 1p functions not yet re-derived (informational - the release lane derives cloned from 1p)');
}

report.forEach((line) => console.log('  ' + line));
if (tier2Closed.length) {
  console.log('  baseline entries now CLOSED (safe to prune): ' + tier2Closed.join(', '));
}
assert.strictEqual(tier2New, 0, 'new unrecorded fork absences');
console.log('PASS 1p fork parity contract (' + pairs.length + ' fork pairs, tier-1 absences recorded: ' +
  tier1Absences + ')');
