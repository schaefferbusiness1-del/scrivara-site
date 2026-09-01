/* ext 3.0.97: canonical (sorted-key) compare at all three session write-verify
   sites — chrome.storage round-trips via sorted base::Value dicts, so the old
   order-sensitive JSON.stringify equality could never match a record whose
   literal key order is not alphabetical. Content differences still fail closed.
   Plus: persist the tokDiag ring (MV3 worker death wipes the in-memory one). */
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

// 1. canonical serializer, inserted before tokenSessionWrite
splice(
  `  async function tokenSessionWrite(id, rec) {`,
  `  /* canoncmp-3.0.97 (measured live 2026-08-31, tokDiag "tokenSessionWrite-verify
     mismatch len 4350 vs 4350" with every string well-formed): chrome.storage
     round-trips records through base::Value dictionaries, which keep keys
     SORTED - read-back returns the same content with reordered keys, so an
     order-sensitive JSON.stringify equality can never match a record whose
     literal key order is not alphabetical (same length, different sequence -
     the exact measured signature). Compare canonically (sorted keys,
     recursive); any REAL content difference still fails closed. */
  function tokenCanonJson(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) { var arr = []; for (var ai = 0; ai < v.length; ai++) arr.push(tokenCanonJson(v[ai])); return '[' + arr.join(',') + ']'; }
    var ks = Object.keys(v).sort(), ps = [];
    for (var ki = 0; ki < ks.length; ki++) ps.push(JSON.stringify(ks[ki]) + ':' + tokenCanonJson(v[ks[ki]]));
    return '{' + ps.join(',') + '}';
  }
  async function tokenSessionWrite(id, rec) {`,
  'canon fn + tokenSessionWrite');

// 2. tokenSessionWrite verify -> canonical, keep a proof entry when order was the only difference
splice(
  `      var okv = !!actual && JSON.stringify(actual) === JSON.stringify(expected);
      if (!okv) tokDiag('tokenSessionWrite-verify', (actual ? 'mismatch len ' + JSON.stringify(actual).length + ' vs ' + JSON.stringify(expected).length : 'readback-empty'));`,
  `      var okv = !!actual && tokenCanonJson(actual) === tokenCanonJson(expected);
      if (okv && JSON.stringify(actual) !== JSON.stringify(expected)) tokDiag('verify-order-only', 'keys-reordered-content-equal');
      if (!okv) tokDiag('tokenSessionWrite-verify', (actual ? 'canon-mismatch keys ' + Object.keys(actual).sort().join('.').slice(0, 70) : 'readback-empty'));`,
  'tokenSessionWrite verify');

// 3. noteProofSessionWrite verify -> canonical
splice(
  `      return !!actual && JSON.stringify(actual) === JSON.stringify(expected);`,
  `      return !!actual && tokenCanonJson(actual) === tokenCanonJson(expected);`,
  'noteProofSessionWrite verify');

// 4. consumeSessionRecord terminal verify -> canonical
splice(
  `      if (actual && JSON.stringify(actual) === JSON.stringify(expected)) {`,
  `      if (actual && tokenCanonJson(actual) === tokenCanonJson(expected)) {`,
  'consumeSessionRecord verify');

// 5. tokDiag persists the ring (fire-and-forget) so worker death does not erase evidence
splice(
  `  self.tokDiag = self.tokDiag || function (step, extra) { try { self.__mlsTokDiag = (self.__mlsTokDiag || []).slice(-9); self.__mlsTokDiag.push({ t: Date.now(), step: String(step).slice(0, 40), x: String(extra == null ? '' : extra).slice(0, 80) }); } catch (e) {} };`,
  `  self.tokDiag = self.tokDiag || function (step, extra) { try { self.__mlsTokDiag = (self.__mlsTokDiag || []).slice(-9); self.__mlsTokDiag.push({ t: Date.now(), step: String(step).slice(0, 40), x: String(extra == null ? '' : extra).slice(0, 80) }); try { chrome.storage.local.set({ mlsTokDiagV1: self.__mlsTokDiag }); } catch (e2) {} } catch (e) {} };`,
  'tokDiag persist');

// 6. health verb also surfaces the persisted ring
splice(
  `    try { out.tokDiag = (self.__mlsTokDiag || []).slice(-8); } catch (eTd) { out.tokDiag = null; }`,
  `    try { out.tokDiag = (self.__mlsTokDiag || []).slice(-8); try { var tdBag = await chrome.storage.local.get('mlsTokDiagV1'); if (tdBag && Array.isArray(tdBag.mlsTokDiagV1)) out.tokDiagPersist = tdBag.mlsTokDiagV1.slice(-8); } catch (eTd2) {} } catch (eTd) { out.tokDiag = null; }`,
  'health persist read');

console.log('spliced sites: ' + count);
console.log('ver sites: ' + (s.split('3.0.96').length - 1));
s = s.split('3.0.96').join('3.0.97');
fs.writeFileSync('background.js', s, 'latin1');
let m = fs.readFileSync('manifest.json', 'latin1');
fs.writeFileSync('manifest.json', m.split('3.0.96').join('3.0.97'), 'latin1');
console.log('OK');
