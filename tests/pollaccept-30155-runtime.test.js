'use strict';
/* MLS Assist 3.0.155 — pollaccept-1.0.0: outside the bootstrap lease, the chart identity poll ends at once on a
 * banner-grade candidate whose DOB is exactly the expected DOB and whose name shares at least one token with the
 * expected name; every poll stage carries PHI-free codes (o<shared> d<dob exact>) and every in-loop deadline the
 * poll counters. Pins the seams and exercises the matcher, the overlap coder and the DOB-exact helper. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const ovLine = "        const __nmmOverlap = (a, b) => { const nz = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\\s+/g, ' ').trim(); const ta = nz(a).split(' ').filter(x => x.length > 1), tb = nz(b).split(' ').filter(x => x.length > 1); return { o: ta.filter(x => tb.indexOf(x) >= 0).length, na: ta.length, nb: tb.length }; };";
const nmmLine = "        const nmm = (a, b) => { const r = __nmmOverlap(a, b); return r.o >= 2 || (r.o >= 1 && Math.min(r.na, r.nb) === 1); };";
const dobLine = "        const __dobExactHere = (c) => !!(wantDob && c && mlsExactDobKey(c.dob) && mlsExactDobKey(c.dob) === mlsExactDobKey(wantDob));";
ok(bg.includes(ovLine), 'the overlap coder exists'); ok(bg.includes(nmmLine), 'the tolerant matcher is built on it (unchanged semantics)'); ok(bg.includes(dobLine), 'the DOB-exact helper exists');
const accept = "          if (!bootstrapIdentity && polls >= 2 && cand && cand.name && expectName && (cand.score || 0) >= 0 && /^(?:banner|shadow-banner|shadow-labels)$/.test(String(cand.via || '')) && __dobExactHere(cand) && __nmmOverlap(cand.name, expectName).o >= 1) { ident = cand; __chartStage += ' dob-exact'; try { self.__mlsExpectOpen = null; } catch (eDx) {} break; }";
ok(bg.includes(accept), 'the early acceptance: non-bootstrap, poll 2+, banner-grade, non-junk, DOB exact, one shared token');
const rightLine = "          if (cand && cand.name && expectName && nmm(cand.name, expectName) && (!bootstrapIdentity || (polls >= 2 && bootstrapIdentityReady(cand, identityFrameResults)))) { ident = cand; if (!bootstrapIdentity) try { self.__mlsExpectOpen = null; } catch (e) {} break; }";
ok(bg.indexOf(rightLine) > 0 && bg.indexOf(accept) > bg.indexOf(rightLine) && bg.indexOf(accept) - bg.indexOf(rightLine) < 900, 'it sits right after the ordinary match, before the 42 s catch-all');
ok(bg.indexOf("if (Date.now() - T0 > 42000 && cand && cand.name && (cand.score || 0) >= 0 && (!bootstrapIdentity || bootstrapIdentityReady(cand, identityFrameResults))) { ident = cand; break; }", bg.indexOf(accept)) > 0, 'the catch-all still follows');
ok(bg.includes("' o' + __nmmOverlap(cand.name, expectName).o + 'd' + (__dobExactHere(cand) ? 1 : 0)"), 'poll stages carry the shared-token and DOB-exact codes');
ok(bg.includes("chartFailDeadline('clinical chart load p' + polls + ' n' + noClickRounds + ' b' + (sawBriefing ? 1 : 0))"), 'the load deadline carries the poll counters');
ok(bg.includes("chartFailDeadline('clinical chart readiness p' + polls + ' n' + noClickRounds + ' b' + (sawBriefing ? 1 : 0))"), 'the readiness deadline carries the poll counters');
/* the bootstrap (write-grade) lease bind is untouched */
ok(bg.includes("if (!(exactOpenLease && exactOpenLease.appointmentIdBound && exactOpenLease.requestId === chartRequestId && exactOpenLease.appointmentId === expectedAppointmentId && exactNameMatched && validBannerDob && bannerCandidatesAgree && routeBoundBannerSeen)) {"), 'the bootstrap lease still needs the exact name');

/* runtime: matcher, overlap, DOB-exact */
const keyStart = bg.indexOf('function mlsExactDobKey(value) {');
const helpers = new Function('wantDob', bg.slice(keyStart, bg.indexOf('\n}', keyStart) + 2) + '\n' + ovLine + '\n' + nmmLine + '\n' + dobLine + '\nreturn { nmm: nmm, ov: __nmmOverlap, dx: __dobExactHere };');
const h = helpers('03/24/2006');
eq(h.ov('Bill Souza', 'SOUZA, WILLIAM J').o, 1, 'a preferred first name shares only the surname');
eq(h.nmm('Bill Souza', 'SOUZA, WILLIAM J'), false, 'so the tolerant matcher says other (unchanged)');
eq(h.nmm('Maria Souza', 'SOUZA, MARIA'), true, 'two shared tokens match (unchanged)');
eq(h.nmm('Souza', 'SOUZA, MARIA'), true, 'a single-token expectation matches on one (unchanged)');
eq(h.ov('Ana Lima', 'SOUZA, MARIA').o, 0, 'nothing shared');
eq(h.dx({ dob: '2006-03-24' }), true, 'an ISO banner DOB equals the expected US DOB');
eq(h.dx({ dob: '03/24/2006' }), true, 'same date, same form');
eq(h.dx({ dob: '03/24/2007' }), false, 'a different year is not exact');
eq(h.dx({ dob: '' }), false, 'no banner DOB is not exact');
eq(helpers('').dx({ dob: '03/24/2006' }), false, 'no expected DOB, nothing is exact (the acceptance cannot fire)');
/* the acceptance predicate itself, executed with the helpers */
const pred = new Function('bootstrapIdentity', 'polls', 'cand', 'expectName', '__dobExactHere', '__nmmOverlap',
  'return (' + accept.trim().replace(/^if \(/, '').replace(/\) \{ ident = cand;[\s\S]*$/, '') + ');');
const banner = { name: 'SOUZA, WILLIAM J', dob: '03/24/2006', via: 'shadow-banner', score: 30 };
eq(pred(null, 2, banner, 'Bill Souza', h.dx, h.ov), true, 'preferred-name banner with the exact DOB is accepted');
eq(pred({ x: 1 }, 2, banner, 'Bill Souza', h.dx, h.ov), false, 'never inside the bootstrap lease');
eq(pred(null, 1, banner, 'Bill Souza', h.dx, h.ov), false, 'never on the first poll');
eq(pred(null, 2, Object.assign({}, banner, { via: 'lastfirst' }), 'Bill Souza', h.dx, h.ov), false, 'never on a non-banner grep');
eq(pred(null, 2, Object.assign({}, banner, { score: -1 }), 'Bill Souza', h.dx, h.ov), false, 'never on a junk frame');
eq(pred(null, 2, Object.assign({}, banner, { dob: '03/24/2007' }), 'Bill Souza', h.dx, h.ov), false, 'never on a different DOB');
eq(pred(null, 2, banner, 'Ana Lima', h.dx, h.ov), false, 'never with no shared name token, even with the exact DOB');
console.log('PASS pollaccept-30155-runtime: ' + checks + ' checks');
