#!/usr/bin/env node
'use strict';
/*
 * Derive the /cloned lane FROM THE /1p LANE — deterministically, identity only.
 *
 *   node scripts/derive-cloned-from-1p.js [--token cloned-YYYYMMDD-rN] [--check]
 *
 * ============================================================================
 * WHY THIS EXISTS (owner's model, 2026-08-17)
 * ============================================================================
 * /1p is the testing ground. /cloned is the RELEASE CANDIDATE: it must carry
 * ALL of /1p's features while wearing production's route identity, so it can be
 * tested live at mlsscribe.com/cloned/ and then become main.
 *
 * Until today /cloned was a pristine byte-clone of PRODUCTION
 * (scripts/regenerate-cloned-lane.js) and features were meant to graduate into
 * it one delimited block at a time (scripts/promote-1p-block-to-cloned.js).
 * That block-promotion path stays valid for the day /cloned diverges from /1p,
 * but it is NOT the mechanism here: /1p differs from production by hundreds of
 * KB of IN-PLACE edits, a different bundle, and 15 forked feature files. There
 * is no set of delimited blocks that adds up to /1p.
 *
 * So the clone is DERIVED instead. This script is the whole definition of
 * "cloned == 1p modulo lane identity", and tests/cloned-lane-contract.test.js
 * proves the files on disk are exactly what it generates.
 *
 * ============================================================================
 * THE AUDIT — every /1p-only reference, classified BEFORE it was rewritten
 * ============================================================================
 * TWO instruments were used, because one was not enough.
 *
 *   (a) the forbidden-token grep over 1pScribeFlow.html + 1p-mls-connect.js +
 *       the 15 1p-feat_*.js:
 *         grep -n "__MLS_P1_PREVIEW|window\.__MLS_P1|'/1p|\"/1p|1p-feat_|
 *                  1p-mls-connect|p1-live-1\.0\.0"
 *       54 matching LINES in 17 files = 83 occurrences, counted exactly:
 *         48 __MLS_P1_PREVIEW, 24 `1p-feat_`, 1 `1p-mls-connect`,
 *          7 quoted `/1p` route literals (at 5 sites — the two fail-closed
 *            route assertions spell it twice each), 3 build token.
 *
 *   (b) an exhaustive STRING-LITERAL scan — extract every quoted literal and
 *       test it for the lane named as a word. This exists because (a) cannot
 *       see prose, and two hand-written prose regexes each missed real
 *       user-facing labels. It reports 13 literals in /1p and must report 0 in
 *       /cloned; that assertion now lives in tests/cloned-lane-contract.test.js.
 *
 * Each finding is IDENTITY (route / loader / marker name — rewritten
 * mechanically) or BEHAVIOUR (code or text that changes what the app DOES or
 * SAYS because it is the preview — decided case by case and justified here).
 *
 * IDENTITY
 * --------
 *  1. The lane marker `__MLS_P1_PREVIEW` (26x bundle, 21x forks, 1x shell).
 *     Every one is an install guard or a `preview()`/`isPreview()`/`live()`/
 *     `active()` predicate in front of a loader. Renamed to `__MLS_CLONED`, so
 *     the clone's frozen marker arms exactly the same code paths /1p arms.
 *  2. `1p-feat_<name>.js` asset/loader names (14 in the bundle, 1 chained from
 *     1p-feat_mls_schedimport_exact.js -> 1p-feat_nextup_connect.js, plus each
 *     fork's own self-referencing ASSET constant). Renamed cloned-feat_*.js.
 *     NOTE the `data-mls-asset` values are NOT renamed: those name the SHARED
 *     production module a fork retires (e.g. feat_mls_legalpack.js), and
 *     renaming them would break the retire-the-shared-owner handshake.
 *  3. `1p-mls-connect.js` bundle loader in the shell -> cloned-mls-connect.js.
 *  4. The build token `p1-20260815-launch-r1` (1x shell, 2x bundle) ->
 *     CLONED_BUILD. The clone needs a distinct immutable asset identity or an
 *     already-active root service worker replays stale shared modules into it.
 *  5. Route literals: the shell marker's `route:'/1pScribeFlow.html'`, the
 *     version-checker's `fetch('/1p/?nc=')`, mobile-encounter's
 *     `Object.freeze({ route: '/1p/' })`, and the two fail-closed route
 *     assertions in rangejobs/study_provenance
 *     `(preview.route === '/1p/' || preview.route === '/1pScribeFlow.html')`.
 *     The clone has ONE route, so that disjunction collapses to
 *     `(preview.route === '/cloned/')` — same fail-closed intent, one spelling.
 *  6. The service-worker line. /1p ALREADY refuses registration; only its
 *     message text carries the lane name. Rewritten to the exact cloned-lane
 *     refusal string, so the clone still registers NO service worker (a clone
 *     that registered the root SW would hijack the production origin).
 *  7. CSP `base-uri 'none'` -> `'self'` and the cloned-live-1.0.0 URL-normalize
 *     block + `<base href="/cloned">`, taken verbatim from the shape
 *     scripts/regenerate-cloned-lane.js already established.
 *
 * BEHAVIOUR — decided, not rewritten blindly
 * ------------------------------------------
 *  B1. 1p-mls-connect.js:~44371 — the marker RETIRES the historical embedded
 *      "Next Up" IIFE (`__mlsP1LegacyNextUpRetired`) because /1p replaces it
 *      with the external exact-census consumer 1p-feat_nextup_connect.js.
 *      DECISION: CARRY. The clone loads the same replacement, so leaving the
 *      legacy 1.5s-timer copy alive would let two owners repaint the same rows.
 *      Retiring it is what makes the clone behave like /1p, not like a hybrid.
 *  B2. 1p-mls-connect.js:~36939/36973 — the version checker HEAD-probes its own
 *      canonical document instead of production's app-version.json feed, since
 *      that feed names the production shell. DECISION: CARRY, retargeted to
 *      /cloned/. The clone is not the production build either, so comparing it
 *      with the production feed would show a permanent false "newer version".
 *      It still never reloads without an explicit Refresh click.
 *  B3. User-facing wording that names the 1p lane (10 strings). The clone is a
 *      release candidate for real doctors, so lane labels must not appear:
 *        - "The navigation bar is disabled outside the 1p preview." (x2, the
 *          Calm dock refusal) -> "...outside this lane."
 *        - "The old Premium Reviews workspace is retired in 1p. ..." ->
 *          "...is retired here. ..."
 *        - legalpack badges "Free 1p preview - read-only draft workspace" /
 *          "Free 1p preview - fail closed" -> "Free preview - ..."
 *        - legalpack door title "Open the free 1p read-only Legal / IME draft
 *          preview..." -> "Open the free read-only Legal / IME draft preview..."
 *        - marketing eyebrow "1p preview - Free - Draft-only" -> "Preview - ..."
 *        - marketing door title "Open the free 1p Marketing drafting workspace"
 *          -> "Open the free Marketing drafting workspace"
 *        - legalpack success toast "1p Legal / IME draft ready for clinician
 *          review." -> "Legal / IME draft ready..."
 *        - the schedule importer's receipt error "A p1 local metadata write
 *          failed during this pull." -> "A local metadata write failed..."
 *        - the study-provenance EXPORTED receipt header "MLS P1 stored-evidence
 *          coverage receipt" -> "MLS stored-evidence coverage receipt"
 *      The last three were invisible to two successive regex sweeps (two put
 *      the lane name at the START of the literal, where a "separator before 1p"
 *      pattern structurally cannot match; the third spells it "P1"). They were
 *      found by extracting EVERY quoted literal and testing it — which is now a
 *      standing assertion in tests/cloned-lane-contract.test.js, not a habit.
 *      "Free", "preview", "read-only" and "Draft-only" are KEPT: they describe
 *      what those two workspaces actually are (no intake, payment, messaging,
 *      signing, delivery, chart write or Athena write), and deleting an honest
 *      capability disclosure is not a lane rename.
 *
 * NOT CARRIED OVER — verified there is nothing to carry
 * ----------------------------------------------------
 *  - The ?demo=1 / ?preview=1 public sample-workspace sandbox is a PRODUCTION
 *    safety gate (`__MLS_PUBLIC_PREVIEW`). It occurs 5x in the 1p shell and 5x
 *    in ScribeFlow.html, 5x in each bundle: identical, untouched, inherited.
 *    There is no preview-only write block that /1p adds and production lacks.
 *  - No 1p-only gate weakens a safety check. Every marker reference is an
 *    install guard; none disables the three-factor Athena identity check, the
 *    avatar match gate, or the markSolo triage filter.
 *
 * DELIBERATELY LEFT ALONE
 * -----------------------
 *  - `'p1-preview'` (13x bundle, 1x schedimport): the dead fallback in
 *    `?v=' + (window.__MLS_AV || 'p1-preview')`. __MLS_AV is always set by the
 *    shell marker, so this string never reaches a URL. Rewriting live cache
 *    tokens is riskier than leaving an unreachable literal.
 *  - Source COMMENTS that say "1p" (e.g. the p1-ondemand-1.1.0 header). They
 *    are not served behaviour and not user-facing; rewriting prose would make
 *    the derivation harder to review, not easier.
 *
 * ============================================================================
 * REFUSAL
 * ============================================================================
 * Nothing is written if any generated file still contains a 1p-only string
 * (__MLS_P1_PREVIEW, window.__MLS_P1, '/1p, "/1p, 1p-feat_, 1p-mls-connect,
 * p1-live-1.0.0). The offending file:line is printed.
 *
 * --check writes nothing and exits 1 if any file on disk differs.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* gsyn-1.0.0 (2026-08-27). A DERIVATION MAY NOT PRODUCE AN ARTIFACT THAT
 * CANNOT PARSE. See scripts/derive-production-from-1p.js for the full account:
 * production shipped an unparseable ScribeFlow.html on 2026-08-27 and the whole
 * application died - every global undefined, every control a silent no-op, the
 * owner locked out of his own site - even though
 * tests/scribeflow-inline-syntax.test.js already existed, was registered in
 * run-all.js, and flags that exact file. It was simply never run against the
 * DERIVED artifact before the deploy. A gate a ship path can skip is not a
 * gate, so the check lives at the writer. Same rule for /cloned. */
function parseProblems(name, text) {
  const problems = [];
  if (/\.html?$/i.test(name)) {
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m, n = 0;
    while ((m = re.exec(text))) {
      const attrs = m[1] || '';
      if (/\bsrc\s*=/.test(attrs)) continue;
      const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
      if (type && !/^(?:text|application)\/(?:java|ecma)script$|^module$/i.test(type[1].trim())) continue;
      const code = m[2].replace(/^\s*<!--/, '').replace(/-->\s*$/, '');
      if (!code.trim()) continue;
      n++;
      const line = text.slice(0, m.index).split('\n').length;
      /* the same wrapper the shipped suite uses, so the two cannot disagree */
      try { new vm.Script('(function(){\n' + code + '\n})', { filename: name + ':' + line }); }
      catch (e) { problems.push(`${name}: inline <script> at line ${line} does not parse - ${String(e.message).split('\n')[0]}`); }
    }
    /* fail closed: a scanner that matched nothing is broken, not vindicated */
    if (!n) problems.push(`${name}: no inline <script> block was checked - the scanner is broken, not the file`);
  } else if (/\.m?js$/i.test(name)) {
    try { new vm.Script(text, { filename: name }); }
    catch (e) { problems.push(`${name}: does not parse - ${String(e.message).split('\n')[0]}`); }
  }
  return problems;
}
function assertParses(files) {
  const problems = [];
  for (const f of files) problems.push(...parseProblems(f.name, f.text));
  if (problems.length) {
    console.error('REFUSING TO DERIVE - the derivation does not parse:');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
}

const root = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');

const SHELL_SRC = '1pScribeFlow.html';
const SHELL_OUT = 'cloned/index.html';
const CONNECT_SRC = '1p-mls-connect.js';
const CONNECT_OUT = 'cloned-mls-connect.js';
const FORK_RE = /^1p-feat_[A-Za-z0-9_]+\.js$/;

/* The 1p-only strings that may never survive into a generated file. */
const FORBIDDEN = ['__MLS_P1_PREVIEW', 'window.__MLS_P1', "'/1p", '"/1p', '1p-feat_', '1p-mls-connect', 'p1-live-1.0.0'];

function forkSources() {
  return fs.readdirSync(root).filter((n) => FORK_RE.test(n)).sort();
}
function forkOutName(src) {
  return 'cloned-feat_' + src.slice('1p-feat_'.length);
}

/* ---- one substitution, with its expected occurrence count ----
 * Every rewrite states how many times it must fire. A source shape that moved
 * fails here instead of silently generating a half-rewritten clone. */
function subst(text, from, to, want, label) {
  const got = text.split(from).length - 1;
  if (got !== want) {
    throw new Error(`${label}: expected ${want} occurrence(s) of ${JSON.stringify(from.slice(0, 70))}, found ${got}`);
  }
  return text.split(from).join(to);
}
/* Same, but the count is discovered rather than pinned (the marker rename fires
 * a different number of times in every file). Must fire at least `min` times. */
function substAll(text, from, to, min, label) {
  const got = text.split(from).length - 1;
  if (got < min) {
    throw new Error(`${label}: expected at least ${min} occurrence(s) of ${JSON.stringify(from)}, found ${got}`);
  }
  return { text: text.split(from).join(to), count: got };
}

function buildToken(shellText) {
  const m = shellText.match(/ {2}var P1_BUILD='([^']+)';\n/);
  if (!m) throw new Error(`${SHELL_SRC} no longer declares  var P1_BUILD='...';`);
  return m[1];
}

/* ---- lane identity, applied to the bundle and every fork ---- */
function laneIdentity(text, p1Build, TOKEN, label) {
  let out = text;
  const marker = substAll(out, '__MLS_P1_PREVIEW', '__MLS_CLONED', 0, `${label}: lane marker`);
  out = marker.text;
  const asset = substAll(out, '1p-feat_', 'cloned-feat_', 0, `${label}: fork asset name`);
  out = asset.text;
  const bundle = substAll(out, '1p-mls-connect.js', 'cloned-mls-connect.js', 0, `${label}: bundle loader`);
  out = bundle.text;
  const build = substAll(out, p1Build, TOKEN, 0, `${label}: build token`);
  out = build.text;
  return { text: out, counts: { marker: marker.count, asset: asset.count, bundle: bundle.count, build: build.count } };
}

/* ---- route literals (identity item 5) ---- */
const ROUTE_DISJUNCTION_FROM = "(preview.route === '/1p/' || preview.route === '/1pScribeFlow.html')";
const ROUTE_DISJUNCTION_TO = "(preview.route === '/cloned/')";

function routeLiterals(text) {
  let out = text;
  if (out.indexOf(ROUTE_DISJUNCTION_FROM) >= 0) out = out.split(ROUTE_DISJUNCTION_FROM).join(ROUTE_DISJUNCTION_TO);
  if (out.indexOf("fetch('/1p/?nc='") >= 0) out = out.split("fetch('/1p/?nc='").join("fetch('/cloned/?nc='");
  if (out.indexOf("Object.freeze({ route: '/1p/' })") >= 0) {
    out = out.split("Object.freeze({ route: '/1p/' })").join("Object.freeze({ route: '/cloned/' })");
  }
  return out;
}

/* ---- user-facing wording (behaviour decision B3) ---- */
const WORDING = [
  ['1p Legal / IME chronology ready for clinician review.', 'Legal / IME chronology ready for clinician review.'],
  ['The navigation bar is disabled outside the 1p preview.', 'The navigation bar is disabled outside this lane.'],
  ['The old Premium Reviews workspace is retired in 1p. Marketing is not ready, so nothing opened.',
    'The old Premium Reviews workspace is retired here. Marketing is not ready, so nothing opened.'],
  ['Free 1p preview · read-only draft workspace', 'Free preview · read-only draft workspace'],
  ['Free 1p preview · fail closed', 'Free preview · fail closed'],
  ['1p preview · Free · Draft-only', 'Preview · Free · Draft-only'],
  ['Open the free 1p read-only Legal / IME draft preview for the exact active patient',
    'Open the free read-only Legal / IME draft preview for the exact active patient'],
  ['Open the free 1p Marketing drafting workspace', 'Open the free Marketing drafting workspace'],
  /* Found only by the exhaustive string-literal scan (now assertion 11 in
     tests/cloned-lane-contract.test.js). The first two regex sweeps missed all
     three: two put the lane name at the very START of the literal, where a
     "separator before 1p" pattern cannot match, and the third spells it "P1". */
  ['1p Legal / IME draft ready for clinician review.', 'Legal / IME draft ready for clinician review.'],
  ['A p1 local metadata write failed during this pull.', 'A local metadata write failed during this pull.'],
  ['MLS P1 stored-evidence coverage receipt', 'MLS stored-evidence coverage receipt']
];
function wording(text) {
  let out = text;
  let hits = 0;
  for (const [from, to] of WORDING) {
    const n = out.split(from).length - 1;
    if (n) { hits += n; out = out.split(from).join(to); }
  }
  return { text: out, hits };
}

/* ---- the shell's route bootstrap, verbatim from the established clone shape ---- */
const NORMALIZE_BLOCK =
`<!-- cloned-live-1.0.0: GitHub Pages serves this clone at /cloned/. Normalize the
     document to the file-like /cloned URL, then use that exact URL as the base.
     Relative app assets consequently resolve at the site root, while CSS/SVG
     fragment paints still resolve back to this same document (/cloned#id). -->
<script>
(function () {
  try {
    if (location.pathname !== '/cloned') {
      history.replaceState(null, document.title, '/cloned' + (location.search || '') + (location.hash || ''));
    }
  } catch (_) {}
})();
</script>
<base href="/cloned">
`;
const AUTH_ANCHOR = "  window.__mlsAuthHandoff = captured;\n})();\n</script>\n";
const SW_REFUSAL_P1 = "Promise.reject(new Error('1p preview: service worker deliberately not registered')).catch(function(){});";
const SW_REFUSAL_CLONED = "Promise.reject(new Error('cloned lane: service worker deliberately not registered')).catch(function(){});";
const MARKER_COMMENT_P1 = '  /* 1p-1.0.0: the preview owns a distinct immutable asset identity. Reusing a\n';
const MARKER_COMMENT_CLONED = '  /* cloned-1.0.0: the clone owns a distinct immutable asset identity. Reusing a\n';
const MARKER_TAIL_P1 = '     from the production app. This marker changes preview requests only. */\n';
const MARKER_TAIL_CLONED = '     from the production app. This marker changes clone requests only. */\n';

function deriveShell(TOKEN) {
  const src = read(SHELL_SRC);
  const p1Build = buildToken(src);
  let out = src;

  /* 1. the frozen lane marker (name, route, build constant) */
  out = subst(out, MARKER_COMMENT_P1, MARKER_COMMENT_CLONED, 1, 'shell marker comment');
  out = subst(out, MARKER_TAIL_P1, MARKER_TAIL_CLONED, 1, 'shell marker comment tail');
  out = subst(out, `  var P1_BUILD='${p1Build}';\n`, `  var CLONED_BUILD='${TOKEN}';\n`, 1, 'shell build constant');
  out = subst(out,
    "  window.__MLS_P1_PREVIEW=Object.freeze({enabled:true,route:'/1pScribeFlow.html',build:P1_BUILD});\n",
    "  window.__MLS_CLONED=Object.freeze({enabled:true,route:'/cloned/',build:CLONED_BUILD});\n",
    1, 'shell lane marker');
  out = subst(out, '  window.__MLS_AV=P1_BUILD;\n', '  window.__MLS_AV=CLONED_BUILD;\n', 1, 'shell cache token');

  /* 2. the bundle loader */
  out = subst(out, "s.src='1p-mls-connect.js?v='+window.__MLS_AV;", "s.src='cloned-mls-connect.js?v='+window.__MLS_AV;",
    1, 'shell bundle loader');
  /* 2b. (2026-08-17 batch 7) the shell's own comments now NAME the bundle
     ("1p-mls-connect.js's startIso() ...", apptclock-1.0.0). Those are lane
     identity, not behaviour: the clone's bundle IS cloned-mls-connect.js. Rename
     every remaining mention so the forbidden-token audit stays exact. */
  out = out.split('1p-mls-connect.js').join('cloned-mls-connect.js');

  /* 3. the service worker stays an EXPLICIT refusal, renamed to this lane */
  out = subst(out, SW_REFUSAL_P1, SW_REFUSAL_CLONED, 1, 'shell service-worker refusal');

  /* 4. CSP + route bootstrap */
  out = subst(out, "base-uri 'none'", "base-uri 'self'", 1, 'shell CSP base-uri');
  out = subst(out, AUTH_ANCHOR, AUTH_ANCHOR + NORMALIZE_BLOCK, 1, 'shell route bootstrap');

  return { text: out, p1Build };
}

function deriveConnect(TOKEN, p1Build) {
  let out = read(CONNECT_SRC);
  const id = laneIdentity(out, p1Build, TOKEN, 'bundle');
  out = routeLiterals(id.text);
  const w = wording(out);
  return { text: w.text, counts: Object.assign({ wording: w.hits }, id.counts) };
}

function deriveFork(name, TOKEN, p1Build) {
  let out = read(name);
  const id = laneIdentity(out, p1Build, TOKEN, name);
  out = routeLiterals(id.text);
  const w = wording(out);
  return { text: w.text, counts: Object.assign({ wording: w.hits }, id.counts) };
}

/* Every generated file, as {name, text, counts}. Exported so the contract test
   can byte-compare the tree on disk against exactly this. */
function generate(token) {
  const TOKEN = token || currentToken();
  if (!/^cloned-\d{8}-r\d+$/.test(TOKEN)) {
    throw new Error('need a token like cloned-20260817-r3 (pass --token, or have an existing cloned/index.html declare one)');
  }
  const shell = deriveShell(TOKEN);
  const files = [{ name: SHELL_OUT, text: shell.text, counts: { shell: 1 } }];
  const connect = deriveConnect(TOKEN, shell.p1Build);
  files.push({ name: CONNECT_OUT, text: connect.text, counts: connect.counts });
  for (const src of forkSources()) {
    const fork = deriveFork(src, TOKEN, shell.p1Build);
    files.push({ name: forkOutName(src), text: fork.text, counts: fork.counts, from: src });
  }
  return { token: TOKEN, p1Build: shell.p1Build, files };
}

function currentToken() {
  try { return (read(SHELL_OUT).match(/var CLONED_BUILD='([^']+)';/) || [])[1] || ''; } catch (e) { return ''; }
}

/* Refuse to write anything that still names the 1p lane. */
function survivors(files) {
  const bad = [];
  for (const f of files) {
    const lines = f.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const needle of FORBIDDEN) {
        if (lines[i].indexOf(needle) >= 0) bad.push(`${f.name}:${i + 1}: ${needle}`);
      }
    }
  }
  return bad;
}

module.exports = { generate, survivors, forkSources, forkOutName, SHELL_SRC, SHELL_OUT, CONNECT_SRC, CONNECT_OUT, FORBIDDEN };

if (require.main === module) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const i = args.indexOf('--token');
  const tokenArg = i >= 0 ? args[i + 1] : '';
  let built;
  try { built = generate(tokenArg); }
  catch (e) { console.error(String(e.message || e)); process.exit(2); }

  const bad = survivors(built.files);
  if (bad.length) {
    console.error('REFUSED: 1p-only strings survived the derivation:\n  ' + bad.slice(0, 40).join('\n  ') +
      (bad.length > 40 ? `\n  ...and ${bad.length - 40} more` : ''));
    process.exit(2);
  }

  assertParses(built.files);

  if (check) {
    const drift = [];
    for (const f of built.files) {
      const p = path.join(root, f.name);
      if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== f.text) drift.push(f.name);
    }
    console.log(drift.length
      ? `DRIFTED (token ${built.token}): ${drift.join(', ')}`
      : `PRISTINE (token ${built.token}): ${built.files.length} derived file(s) match 1p exactly, modulo lane identity`);
    process.exit(drift.length ? 1 : 0);
  }

  fs.mkdirSync(path.join(root, 'cloned'), { recursive: true });
  let bytes = 0;
  for (const f of built.files) {
    fs.mkdirSync(path.dirname(path.join(root, f.name)), { recursive: true });
    fs.writeFileSync(path.join(root, f.name), f.text, 'utf8');
    bytes += f.text.length;
  }
  console.log(`derived /cloned from /1p (${built.p1Build} -> ${built.token}): ${built.files.length} files, ${bytes} bytes`);
  for (const f of built.files) {
    const c = f.counts || {};
    console.log(`  ${f.name}${f.from ? '  <- ' + f.from : ''}  ${f.text.length}B` +
      (c.marker !== undefined ? `  marker x${c.marker} asset x${c.asset} build x${c.build} wording x${c.wording}` : ''));
  }
}
