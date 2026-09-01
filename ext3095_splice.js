/* ext 3.0.95: instrument the claim/consume token paths (last blind spots). */
const fs = require('fs');
let s = fs.readFileSync('background.js', 'latin1');
let count = 0;
function splice(anchor, replacement, label) {
  const i = s.indexOf(anchor);
  if (i < 0) { console.error('MISSING: ' + label); process.exit(1); }
  if (s.indexOf(anchor, i + 1) >= 0) { console.error('NOT UNIQUE: ' + label); process.exit(1); }
  s = s.slice(0, i) + replacement + s.slice(i + anchor.length);
  count++;
}

// claim gate (token)
splice(
  "        if (!quarantine.available || quarantine.marked) return { ok: false, reason: 'token-state-unavailable', detail: quarantine.marked ? 'prior-claim-storage-outcome-unavailable' : 'authorization-quarantine-unavailable' };",
  "        if (!quarantine.available || quarantine.marked) { tokDiag('claim-quarantine', quarantine.marked ? 'marked' : 'unavailable'); return { ok: false, reason: 'token-state-unavailable', detail: quarantine.marked ? 'prior-claim-storage-outcome-unavailable' : 'authorization-quarantine-unavailable' }; }",
  'claim quarantine');

// claim consume (token)
splice(
  "      if (!(await consumeSessionRecord('token', id, tokenStorageKey(id), claimed))) return { ok: false, reason: 'token-state-unavailable' };",
  "      if (!(await consumeSessionRecord('token', id, tokenStorageKey(id), claimed))) { tokDiag('claim-consume-fail', 'token'); return { ok: false, reason: 'token-state-unavailable' }; }",
  'claim consume');

// proof quarantine string-return site
splice(
  "        if (!quarantine.available || quarantine.marked) return 'token-state-unavailable';",
  "        if (!quarantine.available || quarantine.marked) { tokDiag('proof-quarantine-a', quarantine.marked ? 'marked' : 'unavailable'); return 'token-state-unavailable'; }",
  'proof quarantine a');

// proof quarantine object-return site
splice(
  "        if (!quarantine.available || quarantine.marked) return { ok: false, reason: 'token-state-unavailable' };",
  "        if (!quarantine.available || quarantine.marked) { tokDiag('proof-quarantine-b', quarantine.marked ? 'marked' : 'unavailable'); return { ok: false, reason: 'token-state-unavailable' }; }",
  'proof quarantine b');

// proof consume
splice(
  "      if (!(await consumeSessionRecord('proof', id, noteProofStorageKey(id), claimed))) return { ok: false, reason: 'token-state-unavailable' };",
  "      if (!(await consumeSessionRecord('proof', id, noteProofStorageKey(id), claimed))) { tokDiag('claim-consume-fail', 'proof'); return { ok: false, reason: 'token-state-unavailable' }; }",
  'proof consume');

// consume internal compare failure (the tail after the try blocks): instrument the final return false
const tailAnchor = "    if (!(await markAuthQuarantine(kind, id, terminalRecord && terminalRecord.expiresAt))) return false;";
splice(
  tailAnchor,
  "    if (!(await markAuthQuarantine(kind, id, terminalRecord && terminalRecord.expiresAt))) { tokDiag('consume-mark-fail', kind); return false; }",
  'consume mark');

console.log('spliced sites: ' + count);
console.log('ver sites: ' + (s.split('3.0.94').length - 1));
s = s.split('3.0.94').join('3.0.95');
fs.writeFileSync('background.js', s, 'latin1');
let m = fs.readFileSync('manifest.json', 'latin1');
fs.writeFileSync('manifest.json', m.split('3.0.94').join('3.0.95'), 'latin1');
console.log('OK');
