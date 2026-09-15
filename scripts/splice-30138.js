'use strict';
/* MLS Assist 3.0.138 - shadowbanner-1.0.0 for the WRITE probe (Fable, 2026-09-14/15).
 * Measured live on the dummy's checked-in encounter (Exam stage open, machine context bound:
 * hetDiag qualified:true, metaPatientMatch:true, appt/prov/date 1): every frame's identity read
 * 'none' or 'ambig', ancestorIdentity 'none-found', and the probe refused 'context-unverified'
 * ("Could not identify one exact patient encounter frame"). Cause: athena's 2026-09-02 release
 * (static_20260902) moved the patient banner into an open shadow-DOM component
 * (.aggressive-start-banner -> @athena/patient-banner: .pb_c_patient-id-module spans "20yo M",
 * "MM-DD-YYYY", "#MRN", and a details popover with the labels "First Name Used", "Legal First
 * Name", "Legal Last Name", "Date of birth", "Patient ID"). The write probe's identityRoots
 * selectors match only the 18 decorative `.chart-header` section headers, none of which parse,
 * so the frame's own identity is 'ambig' and the ancestor walk finds nothing. The READ path
 * already reads this banner (mlsReadChartIdentityShadow, via 'shadow-labels'/'shadow-banner') -
 * that is why pulls kept proving name+DOB while every write refused.
 * Cure: hetAncestorIdentity (expectation-aware, used for the frame itself and the ancestor walk)
 * falls back to the same shadow-banner read when no classic root parses. Acceptance is unchanged
 * in strength: exact name key (used OR legal printed name) AND exact DOB; an MRN conflict between
 * two matching hosts stays ambiguous; a complete identity of a different person stays foreign
 * evidence. Counted in hetDiag.shadowHits. Latin1 seams, inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }

/* 1. the helper, placed right before hetAncestorIdentity inside the V2 driver */
{
  const a = "    function hetAncestorIdentity(frame, expectedPatient) {";
  const N = eolAt(a);
  const L = [
    "    /* shadowbanner-1.0.0 (3.0.138): athena's 2026-09-02 banner is an open shadow-DOM component. Read",
    "       the identities it prints, the same two strategies the READ path trusts (mlsReadChartIdentityShadow):",
    "       A) the label block (First Name Used / Legal First Name / Legal Last Name / Date of birth / Patient ID),",
    "       B) the chip line (\"20yo M | MM-DD-YYYY | #MRN\") with the name lines above it. Returns one entry per",
    "       host that prints a FULL identity (name+dob); altNames carries the other printed name. Values are",
    "       compared by the caller, never logged. */",
    "    function shadowBannerIdentities(doc) {",
    "      var found = [];",
    "      try {",
    "        var els = doc.querySelectorAll('*'), hosts = [];",
    "        var capEls = Math.min(els.length, 20000);",
    "        for (var i = 0; i < capEls; i++) { if (els[i].shadowRoot) hosts.push(els[i]); }",
    "        if (!hosts.length) return found;",
    "        var BLOCK = /^(div|p|li|tr|td|th|section|header|footer|h[1-6]|ul|ol|table|article|aside|nav|form|fieldset|dl|dt|dd|pre|address|hr|br)$/;",
    "        var AGE_CHIP = /\\b(\\d{1,3})\\s*(?:yo|y\\/o|yrs?\\.?|years?\\s*old)\\b/i;",
    "        var BARE_DATE = /\\b([01]?\\d)[\\/\\-\\.]([0-3]?\\d)[\\/\\-\\.](\\d{4})\\b/;",
    "        var MRN_HASH = /#\\s?(\\d{4,})/;",
    "        var PROVCRED = /^(MD|DO|PA|PAC|NP|CRNA|APRN|DPM|DDS|DMD|RN|CRNP|FNP|DNP|PHD|MBBS|OD|MSN|LPN|CNM|DC|DPT|DR|PHYS|PT)$/i;",
    "        var STOP1 = /^(please|the|new|find|create|search|no|today|welcome|inbox|schedule|calendar|department|provider|patient|results|appointment|encounter|billing|orders|messages|close|camera|panel)$/i;",
    "        function dstr(m) { return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + m[3]; }",
    "        function okName(cand) {",
    "          if (!cand || cand.length < 4 || cand.length > 60) return '';",
    "          var m = /^([A-Z][A-Za-z'\\-\\.]*(?:\\s+[A-Z][A-Za-z'\\-\\.]*){1,3})$/.exec(cand);",
    "          if (!m) return '';",
    "          var toks = cand.replace(/,/g, ' ').split(/\\s+/);",
    "          for (var q = 0; q < toks.length; q++) { if (STOP1.test(toks[q])) return ''; }",
    "          if (PROVCRED.test(toks[toks.length - 1].replace(/[.\\-]/g, ''))) return '';",
    "          if (/^DR\\.?$/i.test(toks[0])) return '';",
    "          return cand;",
    "        }",
    "        function collect(root, acc, depth) {",
    "          if (depth > 25 || acc.n > 4000) return;",
    "          var kids = root.childNodes || [];",
    "          for (var k = 0; k < kids.length; k++) {",
    "            if (acc.n > 4000) return;",
    "            var n = kids[k];",
    "            if (n.nodeType === 3) { var s = String(n.nodeValue || '').replace(/\\s+/g, ' ').trim(); if (s) { acc.items.push({ t: s }); acc.n++; } }",
    "            else if (n.nodeType === 1) {",
    "              var tag = (n.tagName || '').toLowerCase();",
    "              if (tag === 'script' || tag === 'style') continue;",
    "              var isB = BLOCK.test(tag);",
    "              if (isB) { acc.items.push({ nl: 1 }); acc.n++; }",
    "              try {",
    "                if (tag === 'slot' && n.assignedNodes) {",
    "                  var an = n.assignedNodes({ flatten: true });",
    "                  for (var a2 = 0; a2 < an.length; a2++) {",
    "                    if (an[a2].nodeType === 3) { var s2 = String(an[a2].nodeValue || '').replace(/\\s+/g, ' ').trim(); if (s2) { acc.items.push({ t: s2 }); acc.n++; } }",
    "                    else if (an[a2].nodeType === 1) collect(an[a2], acc, depth + 1);",
    "                  }",
    "                } else if (n.shadowRoot) collect(n.shadowRoot, acc, depth + 1);",
    "                else collect(n, acc, depth + 1);",
    "              } catch (e) {}",
    "              if (isB) { acc.items.push({ nl: 1 }); acc.n++; }",
    "            }",
    "          }",
    "        }",
    "        function toLines(items) {",
    "          var lines = [], cur = [];",
    "          for (var x = 0; x < items.length; x++) {",
    "            if (items[x].nl) { if (cur.length) { lines.push(cur.join(' ')); cur = []; } }",
    "            else cur.push(items[x].t);",
    "          }",
    "          if (cur.length) lines.push(cur.join(' '));",
    "          return lines;",
    "        }",
    "        function labelVal(lines, re) {",
    "          for (var i2 = 0; i2 < lines.length - 1; i2++) { if (re.test(lines[i2])) return lines[i2 + 1]; }",
    "          return '';",
    "        }",
    "        var isVal = function (s) { return s && s.length <= 40 && /^[A-Z]/.test(s) && !/name|birth|patient|gender|age|detail/i.test(s); };",
    "        for (var h = 0; h < hosts.length; h++) {",
    "          var acc = { items: [], n: 0 };",
    "          collect(hosts[h].shadowRoot, acc, 0);",
    "          var lines = toLines(acc.items);",
    "          if (!lines.length) continue;",
    "          var name = '', dob = '', mrn = '', via = '', altNames = [];",
    "          var first = labelVal(lines, /^first name used$/i) || labelVal(lines, /^legal first name$/i);",
    "          var middle = labelVal(lines, /^middle name$/i);",
    "          var last = labelVal(lines, /^legal last name$/i);",
    "          var legalFirst = labelVal(lines, /^legal first name$/i);",
    "          var dobA = labelVal(lines, /^date of birth$/i);",
    "          var pidA = (labelVal(lines, /^patient id$/i).match(/#?\\s?(\\d{4,})/) || [])[1] || '';",
    "          if (isVal(first) && isVal(last)) {",
    "            var comp = first + ((middle && middle.length <= 20 && isVal(middle)) ? ' ' + middle : '') + ' ' + last;",
    "            var okA = okName(comp.replace(/\\s+/g, ' ').trim());",
    "            var dm = BARE_DATE.exec(dobA || '');",
    "            if (okA && dm) { name = okA; dob = dstr(dm); mrn = pidA; via = 'shadow-labels'; }",
    "            if (name && isVal(legalFirst) && isVal(last) && legalFirst !== first) { var altS = okName((legalFirst + ' ' + last).replace(/\\s+/g, ' ').trim()); if (altS && altS !== name && altNames.indexOf(altS) < 0) altNames.push(altS); }",
    "          }",
    "          if (!name) {",
    "            for (var i3 = 0; i3 < lines.length; i3++) {",
    "              if (!AGE_CHIP.test(lines[i3]) || !BARE_DATE.test(lines[i3])) continue;",
    "              var bd = BARE_DATE.exec(lines[i3]);",
    "              var dobB = dstr(bd);",
    "              var mh = MRN_HASH.exec(lines[i3]);",
    "              var nameB = '';",
    "              for (var kk = 3; kk >= 1 && !nameB; kk--) {",
    "                if (i3 - kk < 0) continue;",
    "                var joinedB = lines.slice(i3 - kk, i3).join(' ').replace(/[()]/g, ' ').replace(/\\s+/g, ' ').trim();",
    "                var partsB = joinedB.split(/legal\\s*:/i).map(function (s) { return s.replace(/\\s+/g, ' ').trim(); }).filter(Boolean);",
    "                for (var pb = 0; pb < partsB.length; pb++) { var candB = okName(partsB[pb]); if (!candB) continue; if (!nameB) nameB = candB; else if (candB !== nameB && altNames.indexOf(candB) < 0) altNames.push(candB); }",
    "              }",
    "              if (nameB) { name = nameB; dob = dobB; mrn = (mh && mh[1]) || ''; via = 'shadow-banner'; break; }",
    "            }",
    "          }",
    "          if (!name || !dob) continue;",
    "          found.push({ name: name, dob: dob, mrn: mrn, altNames: altNames, via: via });",
    "        }",
    "      } catch (e) {}",
    "      return found;",
    "    }"
  ];
  rep(a, L.join(N) + N + a, 'helper');
}

/* 2. the fallback inside hetAncestorIdentity */
{
  const a = "        if (kept) return { identity: kept, ambiguous: false, foreign: sawForeign };" + eolAt("        if (kept) return { identity: kept, ambiguous: false, foreign: sawForeign };") +
            "        return { identity: null, ambiguous: false, foreign: sawForeign };";
  const N = eolAt("        if (kept) return { identity: kept, ambiguous: false, foreign: sawForeign };");
  const L = [
    "        if (kept) return { identity: kept, ambiguous: false, foreign: sawForeign };",
    "        /* shadowbanner-1.0.0 (3.0.138): no classic root parsed (athena's shadow banner) - read the",
    "           banner component with the READ path's two strategies; the acceptance gates are unchanged. */",
    "        var shadowKept = null, shadowConflict = false;",
    "        try {",
    "          var shadowIds = shadowBannerIdentities(frame.doc);",
    "          for (var si = 0; si < shadowIds.length; si++) {",
    "            var sid = shadowIds[si], sdob = dateKey(sid.dob);",
    "            if (!sdob) continue;",
    "            var namesS = [sid.name].concat(sid.altNames || []), matchName = '';",
    "            for (var sn = 0; sn < namesS.length; sn++) { if (nameKey(namesS[sn]) && nameKey(namesS[sn]) === wantName) { matchName = namesS[sn]; break; } }",
    "            if (matchName && sdob === wantDob) {",
    "              var smrn = digits(sid.mrn || '');",
    "              if (shadowKept && smrn && digits(shadowKept.mrn) && smrn !== digits(shadowKept.mrn)) { shadowConflict = true; break; }",
    "              if (!shadowKept || (!digits(shadowKept.mrn || '') && smrn)) shadowKept = { name: matchName, dob: sid.dob, mrn: sid.mrn || '' };",
    "            } else if (nameKey(sid.name) && nameKey(sid.name) !== wantName) sawForeign = true;",
    "          }",
    "        } catch (eShadow) {}",
    "        if (shadowConflict) return { identity: null, ambiguous: true };",
    "        if (shadowKept) { try { hetDiag.shadowHits = (Number(hetDiag.shadowHits) || 0) + 1; } catch (eShadowDiag) {} return { identity: shadowKept, ambiguous: false, foreign: sawForeign, shadow: true }; }",
    "        return { identity: null, ambiguous: false, foreign: sawForeign };"
  ];
  rep(a, L.join(N), 'fallback');
}

let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30138: ' + edits.length + ' verified seams');
