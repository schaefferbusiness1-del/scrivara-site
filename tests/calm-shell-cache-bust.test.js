'use strict';
/*
 * feat_mls_calm_shell.js must load on a BUILD-VERSIONED url, never an immutable
 * ?v= token.
 *
 * Why this test exists. The shell shipped for six consecutive builds - b565
 * identity cards, b568 modal motion, b571 the folded Ask bubble, b572 the
 * transcript fold, b577 the patient-page density cut - and NONE of it reached a
 * browser. The loader pinned `?v=20260724calm116`, the service worker serves
 * versioned asset urls cache-first, and so every visitor kept the copy cached
 * under that token. Measured live at b577: app-version.json said b577 while the
 * page was still running the b564-era module, and the injected stylesheet
 * contained none of the five changes above.
 *
 * The gate was green every time. The bytes were correct on the server every
 * time. The only thing that was wrong was the URL, and nothing checked it - so
 * the owner kept reporting the same UI problems while we kept "fixing" them.
 *
 * The shell changes on almost every build, so an immutable token guarantees
 * this recurs. It now uses the same `?v=' + (window.__MLS_AV || Date.now())`
 * pattern as feat_mls_easy.js, feat_mls_writeflow.js and feat_mls_visitfix.js.
 *
 * Deliberately NOT a general rule about all satellites: assets listed in
 * immutable-satellite-loader-cache-contract.test.js are pinned on purpose, and
 * that contract exists to keep them pinned. This one covers the modules whose
 * whole job is to change.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* Modules that are rewritten most builds; a frozen token silently strands them. */
const MUST_AUTOBUST = [
  'feat_mls_calm_shell.js',
];

for (const asset of MUST_AUTOBUST) {
  const re = new RegExp("s\\.src\\s*=\\s*'" + asset.replace(/\./g, '\\.') + "\\?v='\\s*\\+\\s*\\(window\\.__MLS_AV");
  assert(re.test(connect),
    asset + ' must load with ?v=\' + (window.__MLS_AV || Date.now()).\n' +
    'A frozen ?v= token is served cache-first by the service worker, so every\n' +
    'change to this file would ship to the server and never reach a browser -\n' +
    'which is exactly what happened for six builds (b565-b577).');

  const frozen = new RegExp(asset.replace(/\./g, '\\.') + "\\?v=[0-9a-z]+'", 'i');
  assert(!frozen.test(connect),
    asset + ' still has a hard-coded ?v= token somewhere in the loader.');
}

/* The shell is not in the immutable list, and must not be added to it. */
const immutablePath = path.join(root, 'tests', 'immutable-satellite-loader-cache-contract.test.js');
if (fs.existsSync(immutablePath)) {
  const immutable = fs.readFileSync(immutablePath, 'utf8');
  assert(!/feat_mls_calm_shell/.test(immutable),
    'feat_mls_calm_shell.js must not be pinned by the immutable-loader contract - it changes every build.');
}

console.log('PASS calm shell cache bust: ' + MUST_AUTOBUST.length + ' build-versioned loader(s), no frozen token');
