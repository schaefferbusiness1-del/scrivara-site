'use strict';
/* loc-1.0.0 - one provider-furniture admission predicate before EVERY lane
 * publishes a provider (Codex reply 26).
 *
 * The mutation fixture proved a location line styled `.appointment-header2`
 * ("Newtown Square, PA") becomes a provider through the header-tier lanes:
 * the v2.9.7 location guard lives only in np()'s last-resort branch, while
 * cleanProvider (readers A/B), the legacy scoped lanes (localOrder,
 * _legacyProviderL) and the header tiers admit on shape alone.
 *
 * The predicate rejects POSITIVE furniture evidence only - ZIP tails, phone/
 * fax numbers, suite/floor/room+digit, facility words without a hard
 * credential, digits or place-terminal words (square/plaza/commons/...)
 * inside a bare ", PA|MD" tail - so exact credentialed human names,
 * including plain "First Last, MD" headers, stay admitted (Codex: never
 * weaken exact credentialed provider recognition). np() KEEPS its stricter
 * v2.9.7 last-resort rule in addition.
 *
 * The predicate text is duplicated verbatim into the injected
 * mlsSchedDomInline scope (injected functions cannot reach worker-scope
 * helpers); both copies carry the same loc-1.0.0 marker so a future edit
 * greps them together. */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let src = fs.readFileSync(file, 'latin1');

function spliceOne(label, findLF, replLF) {
  const findCRLF = findLF.replace(/\n/g, '\r\n');
  const replCRLF = replLF; /* scensus law: inserted blocks stay LF */
  let idx = src.indexOf(findLF);
  let find = findLF, repl = replLF;
  if (idx < 0) { idx = src.indexOf(findCRLF); find = findCRLF; repl = replCRLF; }
  if (idx < 0) throw new Error('loc: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('loc: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

const PRED_WORKER =
  "  /* loc-1.0.0 shared provider-furniture admission predicate (Codex reply\n" +
  "     26): positive evidence only, so exact credentialed names - including\n" +
  "     plain \"First Last, MD\" headers - stay admitted. Duplicated verbatim\n" +
  "     inside mlsSchedDomInline (injected scope) - edit both together. */\n" +
  "  function mlsProviderFurniture(s) {\n" +
  "    var t = String(s || '').trim();\n" +
  "    if (!t) return false;\n" +
  "    if (/\\d{5}(?:-\\d{4})?\\s*$/.test(t)) return true;\n" +
  "    if (/(?:\\(\\d{3}\\)\\s*|\\b\\d{3}[-. ])\\d{3}[-. ]\\d{4}\\b/.test(t)) return true;\n" +
  "    if (/\\b(?:suite|ste|floor|unit|bldg|building|room|rm)\\b\\.?\\s*#?\\s*\\d/i.test(t)) return true;\n" +
  "    var locHard = /\\b(?:MD|DO|PA-C|CRNP|NP|DPM)\\b/;\n" +
  "    var locStripped = t.replace(/,\\s*(?:PA|MD)\\.?\\s*$/, '');\n" +
  "    if (/\\b(?:clinic|center|centre|dept|department|hospital|imaging|radiology|rehab|rehabilitation|therapy|urgent care|medical group|associates|orthopedics|orthopaedics|health system|laboratory|laboratories|pharmacy)\\b/i.test(t) && !locHard.test(locStripped)) return true;\n" +
  "    var locLm = /^([A-Za-z .'\\u2019-]+),\\s*(?:PA|MD)\\.?\\s*$/.exec(t);\n" +
  "    if (locLm && !locHard.test(locLm[1])) {\n" +
  "      if (/\\d/.test(locLm[1])) return true;\n" +
  "      if (/\\b(?:square|plaza|commons|crossing|junction|station|corners|landing|township)\\s*$/i.test(locLm[1].trim())) return true;\n" +
  "    }\n" +
  "    return false;\n" +
  "  }\n";

/* the same predicate compacted for the injected mlsSchedDomInline scope */
const PRED_INJ =
  "    /* loc-1.0.0 shared furniture predicate - twin of worker-scope\n" +
  "       mlsProviderFurniture; edit both together. */\n" +
  "    function locFurn(s){var t=String(s||'').trim();if(!t)return false;if(/\\d{5}(?:-\\d{4})?\\s*$/.test(t))return true;if(/(?:\\(\\d{3}\\)\\s*|\\b\\d{3}[-. ])\\d{3}[-. ]\\d{4}\\b/.test(t))return true;if(/\\b(?:suite|ste|floor|unit|bldg|building|room|rm)\\b\\.?\\s*#?\\s*\\d/i.test(t))return true;var lh2=/\\b(?:MD|DO|PA-C|CRNP|NP|DPM)\\b/;var st2=t.replace(/,\\s*(?:PA|MD)\\.?\\s*$/,'');if(/\\b(?:clinic|center|centre|dept|department|hospital|imaging|radiology|rehab|rehabilitation|therapy|urgent care|medical group|associates|orthopedics|orthopaedics|health system|laboratory|laboratories|pharmacy)\\b/i.test(t)&&!lh2.test(st2))return true;var lm2=/^([A-Za-z .'\\u2019-]+),\\s*(?:PA|MD)\\.?\\s*$/.exec(t);if(lm2&&!lh2.test(lm2[1])){if(/\\d/.test(lm2[1]))return true;if(/\\b(?:square|plaza|commons|crossing|junction|station|corners|landing|township)\\s*$/i.test(lm2[1].trim()))return true;}return false;}\n";

/* 1) worker scope: define after isProviderUiLabel's closing, wire into cleanProvider */
spliceOne('worker-predicate',
  "    return isProviderUiLabel(t) ? '' : t;\n  }",
  "    return (isProviderUiLabel(t) || mlsProviderFurniture(t)) ? '' : t;\n  }\n" + PRED_WORKER.replace(/\n$/, ''));

/* 2) injected scope: define before pui() (anchor on its unique head only) */
spliceOne('injected-predicate',
  "    function pui(s){var t=cl(s).toLowerCase()",
  PRED_INJ +
  "    function pui(s){var t=cl(s).toLowerCase()");

/* 3) np(): reject furniture right after the ui-label check */
spliceOne('np-wire',
  "      if(pui(p))return '';",
  "      if(pui(p))return '';\n      if(locFurn(p))return ''; /* loc-1.0.0 */");

/* 4) legacy single-provider scope lane (localOrder builder) */
spliceOne('legacy-scope-wire',
  "_legacyHeaderTextsL(list).forEach(function(raw){var p=lh(raw)?cp(raw):'';if(p&&!local[p.toLowerCase()])",
  "_legacyHeaderTextsL(list).forEach(function(raw){var p=lh(raw)?cp(raw):'';if(p&&locFurn(p))p='';/* loc-1.0.0 */if(p&&!local[p.toLowerCase()])");

/* 5) legacy grid lane (_legacyProviderL) */
spliceOne('legacy-grid-wire',
  "        function _legacyProviderL(raw){\n          var p=lh(raw)?cp(raw):'';if(!p)return '';",
  "        function _legacyProviderL(raw){\n          var p=lh(raw)?cp(raw):'';if(p&&locFurn(p))p='';/* loc-1.0.0 */if(!p)return '';");

fs.writeFileSync(file, src, 'latin1');
console.log('loc-1.0.0 spliced OK');
