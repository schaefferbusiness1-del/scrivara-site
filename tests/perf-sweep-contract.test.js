'use strict';

/* b366 performance sweep — pins the anti-stutter invariants so a future lane
   cannot silently reintroduce the hot paths. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sf = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'latin1');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const sc = fs.readFileSync(path.join(root, 'feat_mls_store_cache.js'), 'utf8');

/* 1. big list renderers skip identical rebuilds (patients ×2, history, calendar ×3) */
assert((sf.match(/_mlsSig!==/g) || []).length >= 6, 'render signature guards missing');
assert(sf.includes("if(list._mlsSig!==_histHtml||!list.childElementCount)"), 'renderHistory guard missing');
assert((sf.match(/if\(grid\._mlsSig!==h\|\|!grid\.childElementCount\)/g) || []).length === 3, 'calendar grid guards missing');
assert((sf.match(/list\._mlsSig='';/g) || []).length === 2, 'renderHistory empty paths must reset the signature');

/* 2. savePatients LZ verify samples instead of decompressing every save */
assert(sf.includes('__mlsLZVerN'), 'LZ sample-verify counter missing');
assert(sf.includes("(window.__mlsLZVerN%10)!==0)return packed"), 'LZ verify must sample every 10th save');

/* 3. store cache has the version fast path (no getItem/full compare on hit) */
assert(sc.includes('var VER = { n: 1 };'), 'store-cache VER counter missing');
assert(sc.includes('__mlsScVer'), 'localStorage write wrap missing');
assert(sc.includes('cache.ver === VER.n'), 'store-cache version fast path missing');
assert(sc.indexOf('cache.ver === VER.n') < sc.indexOf('s = localStorage.getItem(k)'), 'version check must run BEFORE getItem');

/* 4. importChainFix retires itself: done flag + backstop clear (both lineage copies) */
assert((mc.match(/if \(api\.done\) return;/g) || []).length === 2, 'chainfix done short-circuit missing');
assert((mc.match(/api\.done = 1;/g) || []).length === 2, 'chainfix done stamp missing');
assert((mc.match(/clearInterval\(backstop\)/g) || []).length >= 2, 'chainfix backstop must clear itself');

/* 5. hot observers are rAF-debounced; hot intervals slowed */
assert(mc.includes('var iv=setInterval(tick,2500);'), 'EMR tick interval must stay a slow backstop');
assert(!mc.includes('var iv=setInterval(tick,800);'), 'EMR 800ms tick reintroduced');
assert((mc.match(/setInterval\(fixVeilLogo, 300\)/g) || []).length === 2, 'veil fast pass must stay at 300ms');
assert((mc.match(/setInterval\(fixVeilLogo, 80\)/g) || []).length === 0, '80ms veil poll reintroduced');
assert((mc.match(/setInterval\(inject, 6000\);/g) || []).length === 3, 'agent-bar inject interval must stay a slow backstop');
assert((mc.match(/setInterval\(inject, 1500\);/g) || []).length === 0, '1.5s agent-bar inject poll reintroduced');

/* 6. steady-state satellite pollers stay slow; login-clean downshifts post-auth */
const sv = fs.readFileSync(path.join(root, 'feat_mls_simpleview_global.js'), 'utf8');
const vp = fs.readFileSync(path.join(root, 'feat_mls_viewpersist.js'), 'utf8');
const lc = fs.readFileSync(path.join(root, 'feat_mls_login_clean.js'), 'utf8');
assert(sv.includes('setInterval(tick, 1500)'), 'simpleview steady poll must be >= 1500ms');
assert(vp.includes('setInterval(tick, 1500)'), 'viewpersist steady poll must be >= 1500ms');
assert(lc.includes('__mlsLoginCleanSlow'), 'login-clean post-auth downshift missing');

/* 7. patient-switch block message is non-blocking (no native alert when toast exists) */
for (const f of ['feat_mls_patientlock_b53.js', 'feat_mls_patientlock_b52.js']) {
  const pl = fs.readFileSync(path.join(root, f), 'utf8');
  assert(pl.includes('if (typeof window.toast === "function") window.toast(m, "err"); else window.alert(m);'),
    f + ': blocking alert on switch path reintroduced');
}

console.log('perf-sweep-contract: all assertions passed');
