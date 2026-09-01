/* ext3085_c_patch.js - fix (c) encounter-acceptance receipt, latin1 index-splice.
   Run from wt-mrnfirst: node ext3085_c_patch.js
   Exits 1 loudly on any anchor mismatch. Never uses String.replace on unanchored text. */
'use strict';
const fs = require('fs');
const FILE = 'background.js';
let s = fs.readFileSync(FILE, 'latin1');
const before = s.length;

function countOf(hay, needle) { return hay.split(needle).length - 1; }
function must(cond, why) { if (!cond) { console.error('MISS: ' + why); process.exit(1); } }

/* ---------- splice 1: new top-level injected reader before mlsAppointmentNavigationDelta ---------- */
const FN_ANCHOR = '  function mlsAppointmentNavigationDelta(appointmentId, beforeFrames, afterFrames) {';
must(countOf(s, FN_ANCHOR) === 1, 'fn anchor count ' + countOf(s, FN_ANCHOR));
const READER =
"  /* enc-accept-3.0.85 (fix c): read-only encounter-surface reader for the acceptance\n" +
"     path in the exact-appointment open. Returns ONLY non-identity surface evidence\n" +
"     (href, encounter markers, visible date strings) - identity rides the separate\n" +
"     mlsReadChartIdentity injection so the banner-grade bar stays the one the chart\n" +
"     read handler already trusts. Never clicks, never navigates. */\n" +
"  function mlsEncounterAcceptanceReaderFn() {\n" +
"    try {\n" +
"      var href = ''; try { href = String(location.href || '').slice(0, 200); } catch (e0) {}\n" +
"      var t = '';\n" +
"      try { t = String((document.body && document.body.innerText) || '').slice(0, 6000); } catch (e1) {}\n" +
"      var encish = /encounter|intake\\b|exam\\b|sign-?off|checkout|procedure documentation|clinicals/i.test(t) || /encounter|intake|clinicals/i.test(href);\n" +
"      var dates = (t.match(/\\b\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\b/g) || []).slice(0, 12);\n" +
"      return { href: href, encish: encish, dates: dates };\n" +
"    } catch (e) { return { href: '', encish: false, dates: [] }; }\n" +
"  }\n\n";
s = s.slice(0, s.indexOf(FN_ANCHOR)) + READER + s.slice(s.indexOf(FN_ANCHOR));

/* ---------- splice 2: flag declaration ---------- */
const DECL_ANCHOR = 'var appointmentNavigationFrameIds = [];';
must(countOf(s, DECL_ANCHOR) === 1, 'decl anchor count ' + countOf(s, DECL_ANCHOR));
s = s.split(DECL_ANCHOR).join(DECL_ANCHOR + '\n                var encounterAcceptedReceipt = false; /* enc-accept-3.0.85 */');

/* ---------- splice 3: acceptance attempt before the refusal ---------- */
const REFUSAL = "reason: 'appointment-navigation-unverified'";
must(countOf(s, REFUSAL) === 1, 'refusal anchor count ' + countOf(s, REFUSAL));
const refusalIdx = s.indexOf(REFUSAL);
const IF_ANCHOR = 'if (!appointmentNavigationProven) {';
const ifIdx = s.lastIndexOf(IF_ANCHOR, refusalIdx);
must(ifIdx > 0 && (refusalIdx - ifIdx) < 400, 'refusal if-block anchor distance ' + (refusalIdx - ifIdx));
const ACCEPT =
"/* enc-accept-3.0.85 (fix c): a CHECKED-IN row's click lands on the encounter/intake\n" +
"                     surface (or navigates nothing when the encounter is already open), so the URL\n" +
"                     delta above can never carry the appointment id - measured live 2026-08-31\n" +
"                     (EXT_3085_PLAN.md). Accept ONLY when EXACTLY ONE frame proves banner-grade\n" +
"                     identity (the same mlsReadChartIdentity family the chart read trusts) matching\n" +
"                     the requested name AND DOB, on an encounter-ish surface that prints the bound\n" +
"                     schedule date. Anything else - zero frames, two frames, any mismatch, missing\n" +
"                     dob/date inputs, injection timeout - keeps the exact refusal below, verbatim.\n" +
"                     The follow-up chart read then re-proves the banner inside this same frame id\n" +
"                     (routeBoundBannerSeen), unchanged. */\n" +
"                  if (!appointmentNavigationProven && !responseSent) {\n" +
"                    try {\n" +
"                      var eaTok = function (v) { var sfx = /^(?:jr|sr|ii|iii|iv|v|esq|junior|senior)$/; return String(v || '').replace(/\\([^)]*\\)/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\\s+/).filter(function (tk) { return tk && tk.length > 1 && !sfx.test(tk); }); };\n" +
"                      var eaNameOk = function (obs, exp) { var have = eaTok(obs), need = eaTok(exp); if (have.length < 2 || need.length < 2) return false; var c = {}; have.forEach(function (tk) { c[tk] = (c[tk] || 0) + 1; }); for (var qi = 0; qi < need.length; qi++) { if (!c[need[qi]]) return false; c[need[qi]]--; } return true; };\n" +
"                      var eaDobKey = function (v) { var m = /^(\\d{4})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{1,2})$/.exec(String(v || '').trim()); var y, mo, d; if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } else { m = /^(\\d{1,2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{4})$/.exec(String(v || '').trim()); if (!m) return ''; y = +m[3]; mo = +m[1]; d = +m[2]; } if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return ''; return y + '-' + mo + '-' + d; };\n" +
"                      var eaWantDob = eaDobKey(msg.dob || '');\n" +
"                      var eaWantDate = '';\n" +
"                      var eaDm = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(frozenScheduleDate || ''));\n" +
"                      if (eaDm) eaWantDate = String(+eaDm[2]) + '/' + String(+eaDm[3]) + '/' + eaDm[1];\n" +
"                      if (eaWantDob && eaWantDate && (msg.name || '')) {\n" +
"                        var eaFramesSettled = await settleOpen(chrome.webNavigation.getAllFrames({ tabId: tab.id }));\n" +
"                        var eaAll = (eaFramesSettled && eaFramesSettled.ok && eaFramesSettled.value) || [];\n" +
"                        var eaBeforeById = {};\n" +
"                        (beforeAppointmentFrames || []).forEach(function (fr) { if (fr && typeof fr.frameId === 'number') eaBeforeById[fr.frameId] = String(fr.url || ''); });\n" +
"                        var eaChanged = eaAll.filter(function (fr) { return fr && typeof fr.frameId === 'number' && (!(fr.frameId in eaBeforeById) || eaBeforeById[fr.frameId] !== String(fr.url || '')); });\n" +
"                        var eaCand = (eaChanged.length ? eaChanged : eaAll).map(function (fr) { return fr.frameId; }).filter(function (fid) { return typeof fid === 'number' && fid >= 0; }).slice(0, 12);\n" +
"                        if (eaCand.length) {\n" +
"                          var eaIdX = await execOpen({ target: { tabId: tab.id, frameIds: eaCand }, func: mlsReadChartIdentity }, 15000);\n" +
"                          var eaSurX = (eaIdX && eaIdX.timeout) ? { timeout: true } : await execOpen({ target: { tabId: tab.id, frameIds: eaCand }, func: mlsEncounterAcceptanceReaderFn }, 15000);\n" +
"                          if (eaIdX && !eaIdX.timeout && eaSurX && !eaSurX.timeout) {\n" +
"                            var eaSurById = {};\n" +
"                            (eaSurX.r || []).forEach(function (en) { if (en && typeof en.frameId === 'number' && en.result) eaSurById[en.frameId] = en.result; });\n" +
"                            var eaMatches = [];\n" +
"                            (eaIdX.r || []).forEach(function (en) {\n" +
"                              var idr = en && en.result; var sur = (en && typeof en.frameId === 'number') ? eaSurById[en.frameId] : null;\n" +
"                              if (!idr || !sur) return;\n" +
"                              if (!/^(?:banner|shadow-labels|shadow-banner)$/.test(String(idr.via || ''))) return;\n" +
"                              if (!eaNameOk(idr.name, msg.name || '')) return;\n" +
"                              var eaGotDob = eaDobKey(idr.dob);\n" +
"                              if (!eaGotDob || eaGotDob !== eaWantDob) return;\n" +
"                              if (sur.encish !== true) return;\n" +
"                              if ((sur.dates || []).indexOf(eaWantDate) < 0) return;\n" +
"                              eaMatches.push(en.frameId);\n" +
"                            });\n" +
"                            eaMatches = eaMatches.filter(function (v, i, a) { return a.indexOf(v) === i; });\n" +
"                            if (eaMatches.length === 1) {\n" +
"                              appointmentNavigationProven = true;\n" +
"                              appointmentNavigationFrameIds = [eaMatches[0]];\n" +
"                              encounterAcceptedReceipt = true;\n" +
"                              try { sched.diag.encounterAccepted = true; } catch (eEa1) {}\n" +
"                            } else if (eaMatches.length > 1) {\n" +
"                              try { sched.diag.encounterAcceptAmbiguous = eaMatches.length; } catch (eEa2) {}\n" +
"                            }\n" +
"                          }\n" +
"                        }\n" +
"                      }\n" +
"                    } catch (eEncAccept) {}\n" +
"                  }\n" +
"                  ";
s = s.slice(0, ifIdx) + ACCEPT + s.slice(ifIdx);

/* ---------- splice 4: receipt flag on lease + response (exactly 2 sites) ---------- */
const BOUND = 'appointmentIdBound: bootstrapIdentity && appointmentNavigationProven';
must(countOf(s, BOUND) === 2, 'bound anchor count ' + countOf(s, BOUND));
s = s.split(BOUND).join('encounterAccepted: encounterAcceptedReceipt, ' + BOUND);

fs.writeFileSync(FILE, s, 'latin1');
console.log('OK spliced: +' + (s.length - before) + ' bytes; markers=' + countOf(s, 'enc-accept-3.0.85') + ' reader=' + countOf(s, 'function mlsEncounterAcceptanceReaderFn') + ' receiptFlags=' + countOf(s, 'encounterAccepted: encounterAcceptedReceipt'));
