'use strict';
/* MLS Assist 3.0.162 — gohome-2.0.0: the Home driver keeps the CSRFPROTECT token. Runs the real driver in a fake
 * window: a signed-in top frame navigates itself to the tokened frameset with the practice dashboard as MAIN; a child
 * frame defers to the top; a frame with no token falls back to the logo click. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
function fnBlock(src, start) { const i = src.indexOf(start); assert(i >= 0, 'fn: ' + start); let d = 0, e = i; for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (d === 0) break; } } return src.slice(i, e + 1); }
const driver = fnBlock(bg, 'function mlsGoHomeDriverFn(requestGuard) {');
ok(driver.includes("via: 'tokened-frameset'"), 'the tokened navigation exists');
ok(driver.includes("if (__ghTop !== window) return { clicked: false, found: true, deferredToTop: true, frame: location.hostname };"), 'child frames defer to the top frame');
ok(driver.indexOf("var __ghM = ") < driver.indexOf("var el = document.querySelector('.menuitemlogo')"), 'the tokened path runs before the logo lookup');

function run(opts) {
  const nav = [];
  const win = {}; win.top = opts.isTop ? win : { location: { href: opts.topHref } };
  const location = { href: opts.href, hostname: 'athenanet.athenahealth.com' };
  Object.defineProperty(location, 'href', { get: () => opts.href, set: (v) => nav.push(v) });
  win.location = location;
  const document = { querySelector: () => (opts.logo ? { className: 'menuitemlogo', click: () => nav.push('logo-click'), getBoundingClientRect: () => ({ width: 40, height: 40 }) } : null) };
  const getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  const fn = new Function('window', 'location', 'document', 'getComputedStyle', driver + '\nreturn mlsGoHomeDriverFn({ token: "t", deadline: Date.now() + 60000 });');
  const res = fn(win, location, document, getComputedStyle);
  return { res, nav };
}
const tokened = 'https://athenanet.athenahealth.com/22724/6/globalframeset.esp?CSRFPROTECT=56ea5bb006d78c94de686158e71606e9&MAIN=https%3A%2F%2Fathenanet.athenahealth.com%2F22724%2F6%2Fax%2Fchart%2F1%2F2';
let r = run({ isTop: true, href: tokened, logo: true });
eq(r.res.clicked, true, 'the top frame acts'); eq(r.res.via, 'tokened-frameset', 'by navigating, not clicking');
eq(r.nav.length, 1, 'one navigation');
eq(r.nav[0], 'https://athenanet.athenahealth.com/22724/6/globalframeset.esp?CSRFPROTECT=56ea5bb006d78c94de686158e71606e9&MAIN=https%3A%2F%2Fathenanet.athenahealth.com%2F22724%2F6%2Fax%2Fdashboard', 'to the same frameset with the token kept and MAIN = the practice dashboard');
r = run({ isTop: false, topHref: tokened, href: 'https://athenanet.athenahealth.com/22724/6/ax/chart/1/2', logo: true });
eq(r.res.deferredToTop, true, 'a child frame defers'); eq(r.nav.length, 0, 'and clicks nothing');
r = run({ isTop: true, href: 'https://athenanet.athenahealth.com/22724/6/globalframeset.esp?MAIN=x', logo: true });
eq(r.res.clicked, true, 'no token on the top frame: the legacy logo click'); eq(r.nav[0], 'logo-click', 'logo clicked');
r = run({ isTop: true, href: 'https://athenanet.athenahealth.com/22724/6/globalframeset.esp?MAIN=x', logo: false });
eq(r.res.found, false, 'no token and no logo: honest not-found');
console.log('PASS gohome-30162-runtime: ' + checks + ' checks');
