'use strict';
/* mdx-2.0.0 — the 3.0.45 candidate carries the dad's-Mac root fix and the
 * evidence pipeline, byte-pinned. Traced live 2026-08-05/06:
 *   - encounter-index-incomplete root = the self-cancelling stability carry
 *     (regressed 3.0.32): the ehKey pass-signature stripped n=/sameFor= but not
 *     the orchestrator's own outerN=/outerMs= echo, so ehStuckPasses pinned at
 *     <=2 against the gate's >=6. The fingerprint: [unchanged-for-N-passes]
 *     vanished from field reports between 3.0.18 and 3.0.44.
 *   - the evidence (failedIndexes, enumDiag, qp visibility) crossed the bridge
 *     with zero consumers, three times in one day.
 * This suite pins every splice so a future re-stage cannot silently drop one. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cand = fs.readFileSync(path.join(__dirname, '..', 'extension-candidates', '3.0.45', 'background.js'), 'latin1');

/* 1. the root fix: outerN/outerMs stripped from the pass-signature key */
assert(cand.includes(".replace(/;?outerN=[0-9]+/g, '').replace(/;?outerMs=[0-9]+/g, '')"),
  'ehKey must strip the orchestrator carry echo (outerN=/outerMs=) - without this the stability gate is unsatisfiable on re-rendering frames');

/* 2. the stability numbers the gate saw are hoisted onto the result */
assert(cand.includes('effStabN: effStabN, effStabMs: effStabMs, parsedRows: g.rows.length'),
  'visits-list-still-rendering must expose effStabN/effStabMs/parsedRows as fields');

/* 3. the [idx:] tag names the refusing gate and the counters */
assert(cand.includes("'[idx:' + gate + ';'"), 'the encounter-index tag must name the refusing gate');
assert(cand.includes("';eN' + (Number(er.effStabN) || 0)"), 'the tag must carry the effective stability the gate saw');

/* 4. no-chart-frame-answered is reachable without noise frames */
assert(cand.includes("(enNoiseDropped || !enChart.length ? '['"),
  'no-chart-frame-answered must be reachable when zero frames answered and none were noise');

/* 5. qp visibility stamped at the producer and exposed on the receipt */
assert(cand.includes("self.__mlsQpLastVerdict = { v: String(__qpV || ''), at: Date.now() }"),
  'the qpEnsure verdict must be stamped where it is produced');
assert(cand.includes('qpVisibility: (function () { try { var q = self.__mlsQpLastVerdict;'),
  'the visits receipt must expose qpVisibility');

/* 6. noise-surface parity */
assert(cand.includes('stm\\.esp|globalnav|statusbar|inbox|messag|findpatient\\.esp|coordinator|enterprise'),
  'NOISE_SURFACE_RE must cover coordinator/enterprise with escaped dots');

/* 7. the wf3 presence port: export + probe-mode-only guarded call */
assert(cand.includes('self.__mlsFrontAthenaForRead = __mlsFrontAthenaForRead'),
  'the fg front lane must be exported for the write-probe port');
const call = cand.indexOf("if (mode === 'probe' && msg.foregroundOk === true && typeof self.__mlsFrontAthenaForRead === 'function')");
assert(call > 0, 'the action handler must honor foregroundOk on the PROBE path');
const callRegion = cand.slice(call, call + 260);
assert(callRegion.includes('catch (eFgProbe)'), 'the front attempt must be silent-failure');
assert(!cand.includes("mode === 'execute' && msg.foregroundOk"),
  'the execute path must never gain presence machinery');

/* 8. the sx-1.1 base survived all splices */
assert(cand.includes('athena-session-expired') || /sx-1\.1/.test(cand), 'the sx-1.1 per-read liveness base must remain intact');

console.log('candidate-3045-diagnostics-contract: PASS');
