/* splice-30108-batcharm.js - ext 3.0.108 batcharm-1.0.0.
 * OWNER RULING 2026-09-01 23:05 (verbatim): "nothing here should be blocked or
 * manual or not attempted once its run." Measured that minute on the Send to
 * Athena sheet: ONE trusted press wrote section 1 of 6 (HPI, verified), then
 * sections 2 and 3 came back 'fresh-trusted-click-required' because the arm
 * minted by that press is consumed by the first execute and dies 20 s later.
 * Cure: the SAME trusted click may mint a BATCH authorization when the exact
 * confirm button carries data-mls-batch-count and data-mls-batch-hashes at the
 * moment of the click - an ordered list of preview hashes, one per checked
 * section, whose first entry must equal the button's own data-mls-preview-hash.
 * Each execute must then carry the NEXT hash on that list, in order; the arm
 * advances one item per successful execute and clears when the list is spent
 * or after ten minutes. Anything off the list, out of order, a different
 * action family, or after expiry is refused exactly as before. A button with no
 * batch attributes keeps today's single-use 20 s arm byte-for-byte. Batches are
 * only ever minted for write_note / save_draft - never for sign_encounter,
 * place_order or stage_billing. The pong announces batchArm so the page can
 * feature-detect. Anchors are single-line exact-count edits; CRLF-aware;
 * ASCII-only inserts.
 */
'use strict';
var fs = require('fs');

function splice(file, edits) {
  var s = fs.readFileSync(file, 'latin1');
  var NL = /\r\n/.test(s) ? '\r\n' : '\n';
  edits.forEach(function (e, i) {
    var find = e.find.split('\n').join(NL);
    var repl = e.repl.split('\n').join(NL);
    if (/[^\x00-\x7f]/.test(e.repl)) { console.error('ABORT ' + file + ' edit ' + i + ': non-ASCII insert'); process.exit(1); }
    var n = s.split(find).length - 1;
    if (n !== e.n) { console.error('ABORT ' + file + ' edit ' + i + ': hits=' + n + ' expected ' + e.n + ' for: ' + e.find.slice(0, 90)); process.exit(1); }
    s = s.split(find).join(repl);
  });
  fs.writeFileSync(file, s, 'latin1');
  console.log('OK ' + file + ' (' + edits.length + ' edits)');
}

splice('content.js', [
  /* 1. mint: read the batch attributes inside the SAME trusted click */
  { n: 1,
    find: "              clientOrderId: String(actionEl.getAttribute('data-mls-client-order-id') || '').slice(0, 160)\n            };",
    repl: "              clientOrderId: String(actionEl.getAttribute('data-mls-client-order-id') || '').slice(0, 160)\n            };\n            /* batcharm-1.0.0 (3.0.108, owner 2026-09-01: nothing blocked or not attempted once its run):\n               the same trusted click may authorize an ORDERED LIST of note sections. Only for the two\n               executable note actions, only when the list is well-formed and begins with this button's own\n               preview hash; otherwise the single-use 20 s arm above stands untouched. */\n            try {\n              if (/^(write_note|save_draft)$/.test(action)) {\n                var __bc = parseInt(String(actionEl.getAttribute('data-mls-batch-count') || ''), 10);\n                var __bh = String(actionEl.getAttribute('data-mls-batch-hashes') || '').split(',').map(function (h) { return String(h || '').trim().slice(0, 160); }).filter(function (h) { return h.length >= 8; });\n                if (__bc >= 2 && __bc <= 24 && __bh.length === __bc && __bh[0] === _mlsAthenaActionGesture.previewHash && !!_mlsAthenaActionGesture.previewHash) {\n                  _mlsAthenaActionGesture.batch = { hashes: __bh, count: __bc, idx: 0 };\n                  _mlsAthenaActionGesture.until = Date.now() + 600000;\n                }\n              }\n            } catch (eBatchArm) {}" },
  /* 2. consume: the next hash on the list, in order; advance instead of clearing */
  { n: 1,
    find: "        var armHashOk = !!arm.previewHash && !!previewHash && arm.previewHash === previewHash;",
    repl: "        var armHashOk = !!arm.previewHash && !!previewHash && arm.previewHash === previewHash;\n        /* batcharm-1.0.0: a batch arm matches the NEXT hash on its ordered list; the action must stay in the\n           executable note family (write_note / save_draft) - a batch never covers sign, order or billing. */\n        var armBatch = (arm.batch && arm.batch.hashes && arm.batch.hashes.length === arm.batch.count && arm.batch.idx < arm.batch.count) ? arm.batch : null;\n        if (armBatch) armHashOk = !!previewHash && armBatch.hashes[armBatch.idx] === previewHash && /^(write_note|save_draft)$/.test(athAction) && /^(write_note|save_draft)$/.test(arm.action);" },
  { n: 1,
    find: "        if (arm.action !== athAction || Date.now() > Number(arm.until || 0) || !armHashOk || !exactOrderArm || !arm.serial) {",
    repl: "        if ((armBatch ? false : arm.action !== athAction) || Date.now() > Number(arm.until || 0) || !armHashOk || !exactOrderArm || !arm.serial) {" },
  { n: 1,
    find: "        gestureProof = arm.serial;\n        _mlsAthenaActionGesture = { action: '', until: 0, serial: '', previewHash: '', rowHash: '', clientOrderId: '' }; // consumed once",
    repl: "        gestureProof = armBatch ? (arm.serial + ':' + armBatch.idx) : arm.serial;\n        if (armBatch) {\n          /* batcharm-1.0.0: one item consumed; the list clears itself when spent */\n          armBatch.idx += 1;\n          if (armBatch.idx >= armBatch.count) _mlsAthenaActionGesture = { action: '', until: 0, serial: '', previewHash: '', rowHash: '', clientOrderId: '' };\n        } else {\n          _mlsAthenaActionGesture = { action: '', until: 0, serial: '', previewHash: '', rowHash: '', clientOrderId: '' }; // consumed once\n        }" },
  /* 3. pong: announce the capability */
  { n: 1,
    find: "capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true, phoneConfirmedWriteV1: true } }); return; }",
    repl: "capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true, phoneConfirmedWriteV1: true, batchArmV1: true }, batchArm: '1.0.0' }); return; }" }
]);
console.log('SPLICE 3.0.108 batcharm-1.0.0 DONE');
