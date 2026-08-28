#!/usr/bin/env node
'use strict';
/*
 * Derive PRODUCTION from the /1p lane — the owner's promotion, mechanized.
 *
 *   node scripts/derive-production-from-1p.js [--token main-YYYYMMDD-rN] [--check]
 *
 * Owner, 2026-08-20: "I want cloned to become main ... make it the official
 * new site." /cloned is itself derived from /1p (derive-cloned-from-1p.js),
 * so production == the same derivation with PRODUCTION identity. This script
 * is the whole definition of "production == 1p modulo lane identity", exactly
 * as the cloned derive defines the clone.
 *
 * PRODUCTION IDENTITY (each transform justified):
 *  1. Lane marker __MLS_P1_PREVIEW -> __MLS_MAIN. 104 shell blocks and every
 *     fork gate on the marker predicate; stripping it would disarm the whole
 *     feature set. The decl's route becomes '/ScribeFlow.html'.
 *  2. Fork asset names 1p-feat_*.js -> feat_*.js (the shared production
 *     names). The fork's own data-mls-asset value then EQUALS the old
 *     retire-target, making the retire handshake an idempotent self-reference:
 *     the install guard sees its own tag and returns. Verified per-fork by the
 *     forbidden-token scan plus the gate.
 *  3. Bundle loader 1p-mls-connect.js -> mls-connect.js.
 *  4. Build token p1-20260815-launch-r1 -> PROD token (distinct immutable
 *     identity; __MLS_AV [bNNNN, moved only by scripts/bump-build.js] remains
 *     the cache-bust identity and is inherited untouched).
 *  5. Route literals: the version-checker HEAD-probes '/ScribeFlow.html?nc='
 *     (its own canonical document, same mechanism as the clone); the
 *     fail-closed route disjunctions accept '/ScribeFlow.html' or '/'.
 *  6. SERVICE WORKER RESTORED: the 1p refusal string becomes the real
 *     navigator.serviceWorker.register('sw.js') — byte-shape taken from the
 *     production shell this replaces. Production owns the origin; the lanes
 *     keep refusing.
 *  7. CSP: inherited from 1p verbatim — it is production's CSP plus
 *     'wasm-unsafe-eval', which the promoted avatar model needs.
 *  8. User-facing wording: the cloned derive's table, reused verbatim.
 *
 * REFUSAL: nothing is written if a generated file still contains a 1p-only or
 * cloned-only string. --check writes nothing and exits 1 on any disk drift.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');

const SHELL_SRC = '1pScribeFlow.html';
const SHELL_OUT = 'ScribeFlow.html';
const CONNECT_SRC = '1p-mls-connect.js';
const CONNECT_OUT = 'mls-connect.js';
const FORK_RE = /^1p-feat_[A-Za-z0-9_]+\.js$/;

const FORBIDDEN = ['__MLS_P1_PREVIEW', 'window.__MLS_P1', "'/1p", '"/1p', '1p-feat_', '1p-mls-connect',
  'p1-live-1.0.0', '__MLS_CLONED', 'cloned-feat_', 'cloned-mls-connect'];

function forkSources() {
  return fs.readdirSync(root).filter((n) => FORK_RE.test(n)).sort();
}
function forkOutName(src) {
  return 'feat_' + src.slice('1p-feat_'.length);
}

function subst(text, from, to, want, label) {
  const got = text.split(from).length - 1;
  if (got !== want) {
    throw new Error(`${label}: expected ${want} occurrence(s) of ${JSON.stringify(from.slice(0, 70))}, found ${got}`);
  }
  return text.split(from).join(to);
}
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

function laneIdentity(text, p1Build, TOKEN, label) {
  let out = text;
  const marker = substAll(out, '__MLS_P1_PREVIEW', '__MLS_MAIN', 0, `${label}: lane marker`);
  out = marker.text;
  const asset = substAll(out, '1p-feat_', 'feat_', 0, `${label}: fork asset name`);
  out = asset.text;
  const bundle = substAll(out, '1p-mls-connect.js', 'mls-connect.js', 0, `${label}: bundle loader`);
  out = bundle.text;
  const build = substAll(out, p1Build, TOKEN, 0, `${label}: build token`);
  out = build.text;
  return { text: out, counts: { marker: marker.count, asset: asset.count, bundle: bundle.count, build: build.count } };
}

const ROUTE_DISJUNCTION_FROM = "(preview.route === '/1p/' || preview.route === '/1pScribeFlow.html')";
const ROUTE_DISJUNCTION_TO = "(preview.route === '/ScribeFlow.html' || preview.route === '/')";

function routeLiterals(text) {
  let out = text;
  if (out.indexOf(ROUTE_DISJUNCTION_FROM) >= 0) out = out.split(ROUTE_DISJUNCTION_FROM).join(ROUTE_DISJUNCTION_TO);
  if (out.indexOf("fetch('/1p/?nc='") >= 0) out = out.split("fetch('/1p/?nc='").join("fetch('/ScribeFlow.html?nc='");
  if (out.indexOf("Object.freeze({ route: '/1p/' })") >= 0) {
    out = out.split("Object.freeze({ route: '/1p/' })").join("Object.freeze({ route: '/' })");
  }
  return out;
}

/* the shell marker decl: route names THIS document */
const MARKER_ROUTE_FROM = "route:'/1pScribeFlow.html'";
const MARKER_ROUTE_TO = "route:'/ScribeFlow.html'";

/* SW: the refusal becomes the real registration (byte-shape from the shell
   this file replaces). */
const SW_FROM = "Promise.reject(new Error('1p preview: service worker deliberately not registered')).catch(function(){})";
const SW_TO = "navigator.serviceWorker.register('sw.js').catch(function(){})";

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

function forbid(name, text) {
  for (const f of FORBIDDEN) {
    const i = text.indexOf(f);
    if (i >= 0) {
      const line = text.slice(0, i).split('\n').length;
      throw new Error(`${name}:${line} still contains forbidden token ${JSON.stringify(f)}`);
    }
  }
}

/* gsyn-1.0.0 (2026-08-27). A DERIVATION MAY NOT PRODUCE AN ARTIFACT THAT
 * CANNOT PARSE.
 *
 * On 2026-08-27 production shipped a ScribeFlow.html whose single ~35,000-line
 * inline block carried an orphaned function body - a bare `await` at top level
 * where a signature had been replaced by a comment. The block never parsed, so
 * every global in the application was undefined and every control on the
 * sign-in screen became a silent no-op. The owner could not log in.
 *
 * The infuriating part: the check already existed. tests/scribeflow-inline-
 * syntax.test.js has been in the tree since b295, is registered in
 * run-all.js, and flags that exact file - verified against the broken blob.
 * It simply was never run against the DERIVED artifact before the deploy.
 *
 * A gate a ship path can skip is not a gate. So the check now lives at the
 * WRITER, where it cannot be skipped: --check and a real derivation both run
 * it, and an unparseable artifact can never reach the disk. Measured on the
 * b1088 tree: 309 artifacts, zero false positives. */
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
      /* Same wrapper the shipped suite uses, so the two can never disagree. */
      try { new vm.Script('(function(){\n' + code + '\n})', { filename: name + ':' + line }); }
      catch (e) { problems.push(`${name}: inline <script> at line ${line} does not parse - ${String(e.message).split('\n')[0]}`); }
    }
    /* Fail closed: a scanner that matched nothing is broken, not vindicated. */
    if (!n) problems.push(`${name}: no inline <script> block was checked - the scanner is broken, not the file`);
  } else if (/\.m?js$/i.test(name)) {
    try { new vm.Script(text, { filename: name }); }
    catch (e) { problems.push(`${name}: does not parse - ${String(e.message).split('\n')[0]}`); }
  }
  return problems;
}
function assertParses(outputs) {
  const problems = [];
  for (const o of outputs) problems.push(...parseProblems(o.name, o.text));
  if (problems.length) {
    console.error('REFUSING TO DERIVE - the derivation does not parse:');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  let TOKEN = '';
  const ti = args.indexOf('--token');
  if (ti >= 0) TOKEN = String(args[ti + 1] || '');
  if (!TOKEN) {
    const cur = fs.existsSync(path.join(root, SHELL_OUT)) ? read(SHELL_OUT) : '';
    const m = cur.match(/var P1_BUILD='(main-[^']+)'/) || cur.match(/build:'(main-[^']+)'/);
    if (m) TOKEN = m[1];
  }
  if (!/^main-\d{8}-r\d+$/.test(TOKEN)) {
    console.error('need a token like main-20260820-r1 (pass --token, or have an existing ScribeFlow.html declare one)');
    process.exit(2);
  }

  const shellSrc = read(SHELL_SRC);
  const p1Build = buildToken(shellSrc);
  const outputs = [];

  /* Production's cache-bust identity is the bNNN build, moved only by
     scripts/bump-build.js and pinned by five suites + app-version.json.
     The 1p shell aliases __MLS_AV to its lane token; production restores
     the literal so the whole bump ecosystem keeps its one owner. */
  const av = JSON.parse(read('app-version.json'));
  const bm = /-b(\d+)"?$/.exec(String(av.build || ''));
  if (!bm) throw new Error('app-version.json has no readable bNNN build token');
  const BNNN = 'b' + bm[1];

  /* ---- shell ---- */
  let shell = shellSrc;
  shell = subst(shell, MARKER_ROUTE_FROM, MARKER_ROUTE_TO, 1, 'shell: marker route');
  shell = subst(shell, SW_FROM, SW_TO, 1, 'shell: service worker restore');
  shell = subst(shell, 'window.__MLS_AV=P1_BUILD;', "window.__MLS_AV='" + BNNN + "';", 1, 'shell: __MLS_AV bNNN literal');
  shell = routeLiterals(shell);
  const shellIdent = laneIdentity(shell, p1Build, TOKEN, 'shell');
  shell = shellIdent.text;
  const shellWord = wording(shell);
  shell = shellWord.text;
  forbid(SHELL_OUT, shell);
  outputs.push({ name: SHELL_OUT, text: shell,
    note: `marker x${shellIdent.counts.marker} asset x${shellIdent.counts.asset} build x${shellIdent.counts.build} wording x${shellWord.hits}` });

  /* ---- bundle ---- */
  let connect = read(CONNECT_SRC);
  connect = routeLiterals(connect);
  const cIdent = laneIdentity(connect, p1Build, TOKEN, 'bundle');
  connect = cIdent.text;
  const cWord = wording(connect);
  connect = cWord.text;
  forbid(CONNECT_OUT, connect);
  outputs.push({ name: CONNECT_OUT, text: connect,
    note: `marker x${cIdent.counts.marker} asset x${cIdent.counts.asset} build x${cIdent.counts.build} wording x${cWord.hits}` });

  /* ---- forks ---- */
  for (const src of forkSources()) {
    let t = read(src);
    t = routeLiterals(t);
    const ident = laneIdentity(t, p1Build, TOKEN, src);
    t = ident.text;
    const w = wording(t);
    t = w.text;
    const outName = forkOutName(src);
    forbid(outName, t);
    outputs.push({ name: outName, text: t,
      note: `marker x${ident.counts.marker} asset x${ident.counts.asset} build x${ident.counts.build} wording x${w.hits}` });
  }

  assertParses(outputs);

  if (check) {
    let bad = 0;
    for (const o of outputs) {
      const p = path.join(root, o.name);
      const disk = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      if (disk !== o.text) { bad++; console.error(`DRIFT: ${o.name}`); }
    }
    if (bad) { console.error(`${bad} file(s) differ from the derivation`); process.exit(1); }
    console.log(`PRISTINE (token ${TOKEN}): ${outputs.length} derived file(s) match 1p exactly, modulo lane identity`);
    return;
  }

  for (const o of outputs) {
    fs.writeFileSync(path.join(root, o.name), o.text);
    console.log(`  ${o.name}  <- ${o.name === SHELL_OUT ? SHELL_SRC : (o.name === CONNECT_OUT ? CONNECT_SRC : '1p-' + o.name)}  ${Buffer.byteLength(o.text)}B  ${o.note}`);
  }
  console.log(`derived ${outputs.length} production file(s) from the 1p lane (token ${TOKEN})`);
}

main();
