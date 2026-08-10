'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const b18 = fs.readFileSync(path.join(root, 'feat_b18_qa.js'), 'utf8');

const calmBootStart = b18.indexOf('/* __mlsCalmBoot');
const calmBootEnd = b18.indexOf('/* __mlsSearchAssistHint', calmBootStart);
assert(calmBootStart >= 0 && calmBootEnd > calmBootStart, 'b18 readiness compatibility module is missing');
const calmBoot = b18.slice(calmBootStart, calmBootEnd);
assert(calmBoot.includes("visualOwner:'sfGateLoading'"), 'b18 does not defer startup presentation to the canonical gate');
assert(!calmBoot.includes('mlsBootVeil') && !calmBoot.includes('mlsBootBar'), 'b18 can still mount a competing startup visual');
assert(!calmBoot.includes('createElement') && !calmBoot.includes('appendChild'), 'b18 readiness logic still creates startup DOM');
assert(calmBoot.includes('__mlsB18Q.onMutations') && calmBoot.includes('window.__mlsCalmBootDone=1'), 'retiring the b18 visual also removed its nonvisual settle signal');
assert(calmBoot.includes('__mlsB18Q.later(release,4000)'), 'b18 readiness signal lost its bounded failsafe');

const start = app.indexOf('var sfGateLoadingStarted=0');
const end = app.indexOf('function sfHideGateLoading', start);
assert(start >= 0 && end > start, 'secure-login loading owner was not found');
const showSource = app.slice(start, end);

assert(showSource.includes('background:linear-gradient(180deg,#204034 0%,#1E2B24 100%)'), 'secure-login loading screen is not the restored dark-green MLS surface');
assert(showSource.includes('flex-direction:column'), 'loading content can split horizontally again');
assert(showSource.includes('id="sfGateLoadingBrand"'), 'MLS loading brand is missing');
assert(showSource.includes('<svg viewBox="0 0 56 56"'), 'MLS waveform logo is missing');
assert(showSource.includes('MLS <span') && showSource.includes('Scribe</span>'), 'MLS Scribe wordmark is missing');
assert.strictEqual((showSource.match(/id="mlsBLwrap"/g) || []).length, 1, 'secure loader must own exactly one progress wrapper');
assert.strictEqual((showSource.match(/id="mlsBLtrack"/g) || []).length, 1, 'secure loader must own exactly one progress track');
assert.strictEqual((showSource.match(/id="mlsBLbar"/g) || []).length, 1, 'secure loader must own exactly one progress bar');
assert.strictEqual((showSource.match(/id="mlsBLmsg"/g) || []).length, 1, 'secure loader must own exactly one progress message');
assert(!showSource.includes("el.textContent='Loading"), 'the clipped raw Loading text node can still be created');
assert(showSource.includes('html.mls-secure-loading #mlsBusyPill') && showSource.includes('html.mls-secure-loading #mlsLbBar'), 'secondary loading indicators can overlay the full-screen owner');
assert(showSource.includes('html.mls-secure-loading body>:not(#sfGateLoading){visibility:hidden!important}'), 'underlying app controls can leak above the secure loading surface');
assert(showSource.includes('html.mls-secure-loading #mlsCopVoiceBtn') && showSource.includes('html.mls-secure-loading #mlsAsstFab') && showSource.includes('html.mls-secure-loading #mlsDaDock'), 'persistent voice controls can leak above the loading surface');
assert(showSource.includes("bootVeil=document.getElementById('mlsBootVeil'); if(bootVeil) bootVeil.remove()"), 'the secure owner no longer retires the fallback boot veil');
/* Owner directive 2026-07-20: near-instant first load. The veil keeps a small
   anti-flash floor and the bounded max; local-store accounts reveal before
   cloud hydration (startup-hydration-contract pins that path). */
assert(app.includes('const SF_GATE_MIN_MS=300, SF_GATE_MAX_MS=32000, SF_GATE_QUIET_MS=180'), 'bounded, quiet-window loading contract was lost');
assert(app.includes('const SF_GATE_READY_HOLD_MS=40, SF_GATE_FADE_MS=120'), 'Ready-to-app handoff is no longer bounded below 200ms');
assert(showSource.includes('@keyframes sfGateAdvance') && showSource.includes('transform:scaleX('), 'loader progress is not compositor driven');
assert(showSource.includes('animation:sfGateAdvance 4300ms'), 'loader progress no longer matches the faster safe startup floor');
assert(app.includes("[1100,'Loading your schedule…']") && app.includes("[2500,'Preparing your workspace…']") && app.includes("[3900,'Almost ready…']") && app.includes("[8000,'Still preparing your workspace…']"), 'loader stage copy no longer matches the safe startup cadence');
assert(showSource.includes('if(sfGateLoadingVisible&&el.style.display!==\'none\') return el'), 'duplicate startup calls can reset visible progress again');
assert(app.includes("window.dispatchEvent(new Event('mls:loader-ready'))"), 'Ready is not announced before the smooth reveal');
assert(app.includes("window.__mlsLoaderReadyAt=Date.now(); window.dispatchEvent(new Event('mls:loader-ready'))"), 'late optional modules cannot detect an already-completed loader handoff');
assert(!app.slice(app.indexOf('function sfWaitForStableFirstFrame('), app.indexOf('function sfShowGateLoading')).includes('priorityQueued'),
  'noncritical queued presentation work can still hold the secure loader after the critical bundle is ready');
assert(app.includes("showAgreementsGate(true)"), 'compliance handoff can bypass the readiness barrier');
assert(app.includes("window.__MLS_AV='b993'"), 'ScribeFlow loader was not cache-busted to b993');

const sessionStart = app.indexOf('function startSession(email)');
const sessionSource = app.slice(sessionStart, app.indexOf('function logout(force)', sessionStart));
assert(sessionSource.includes("}else if(typeof sfShowGateLoading==='function')") && sessionSource.includes('sfShowGateLoading();'), 'local/demo startup can flash the unfinished app instead of mounting the green loader');
assert(sessionSource.includes("_bundleReadyPromise=typeof window.__mlsEnsureUiBundle==='function'?window.__mlsEnsureUiBundle():Promise.resolve(false)"), 'local/demo startup no longer waits for its on-demand UI bundle');
assert(sessionSource.includes("return typeof sfHideGateLoading==='function'?sfHideGateLoading(false):undefined"), 'local/demo startup cannot retire its green loader after bundle settlement');

const stableStart = app.indexOf('function sfWaitForStableFirstFrame(');
const stableSource = app.slice(stableStart, app.indexOf('function sfShowGateLoading', stableStart));
const readinessCheck = stableSource.indexOf('if(!(bundleReady&&ownerReady&&assetReady&&coreReady&&enhancedReady))');
const layoutSample = stableSource.indexOf('const sig=sfLoaderFrameSignature()');
assert(readinessCheck >= 0 && layoutSample > readinessCheck, 'loader samples layout before the critical UI/asset wave settles');

const nodes = {};
const removed = [];
function element(tag) {
  const classes = new Set();
  const bar = { style: {}, classList: { add(v) { classes.add(v); }, remove(v) { classes.delete(v); } } };
  const msg = { textContent: '' };
  return {
    tagName: tag,
    id: '',
    style: { cssText: '', display: '' },
    attributes: {},
    innerHTML: '',
    offsetWidth: 1,
    classList: { add(v) { classes.add(v); }, remove(v) { classes.delete(v); } },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    querySelector(sel) {
      if (sel === '#sfGateLoadingInner' && this.innerHTML.includes('id="sfGateLoadingInner"')) return {};
      if (sel === '#mlsBLbar' && this.innerHTML.includes('id="mlsBLbar"')) return bar;
      if (sel === '#mlsBLmsg' && this.innerHTML.includes('id="mlsBLmsg"')) return msg;
      return null;
    },
    remove() { removed.push(this.id); delete nodes[this.id]; }
  };
}
nodes.appScreen = element('div');
nodes.appScreen.id = 'appScreen';
nodes.mlsBootVeil = element('div');
nodes.mlsBootVeil.id = 'mlsBootVeil';
nodes.mlsBootFreeze = element('style');
nodes.mlsBootFreeze.id = 'mlsBootFreeze';

const context = {
  Date,
  setTimeout() { return 1; },
  clearTimeout() {},
  document: {
    getElementById(id) { return nodes[id] || null; },
    createElement: element,
    body: { appendChild(el) { nodes[el.id] = el; } },
    documentElement: { classList: { add() {}, remove() {} } }
  }
};
vm.createContext(context);
vm.runInContext(showSource + '\nthis.sfShowGateLoading=sfShowGateLoading;', context);
context.sfShowGateLoading();

const loader = nodes.sfGateLoading;
assert(loader, 'secure-login loading owner was not mounted');
assert(loader.style.cssText.includes('#204034') && loader.style.cssText.includes('#1E2B24'), 'runtime loader did not receive the green background');
assert(loader.style.cssText.includes('flex-direction:column'), 'runtime loader is not a centered column');
assert(loader.innerHTML.includes('sfGateLoadingBrand') && loader.innerHTML.includes('mlsBLwrap'), 'runtime loader did not render the logo and progress as one centered tree');
assert(!/^Loading/.test(loader.innerHTML), 'runtime loader still begins with an orphan Loading label');
assert.deepStrictEqual(removed.sort(), ['mlsBootFreeze', 'mlsBootVeil'], 'competing fallback owners were not retired');
assert.strictEqual(nodes.appScreen.attributes['aria-busy'], 'true', 'app readiness state was lost');
assert.strictEqual(loader.attributes['aria-busy'], 'true', 'loader accessibility state was not activated');

const bootDriver = connect.slice(connect.indexOf('if(window.__mlsBootLoader)'), connect.indexOf('feat_task3_frontsync.js'));
assert(bootDriver.includes("owner:'ScribeFlow'"), 'compatibility layer does not identify the single secure-loader owner');
assert(!bootDriver.includes('setInterval('), 'a second progress interval can fight the secure loader again');
assert(!bootDriver.includes('MutationObserver'), 'a second loader style observer can reset or duplicate the reveal again');
assert(!bootDriver.includes("wrap('sfShowGateLoading'"), 'mls-connect still replaces the secure loader owner');
assert(connect.includes("window.__MLS_AV = window.__MLS_AV || 'b993'"), 'shared asset version was not bumped to b993');
assert(connect.includes("var MLS_APP_BUILD='2026-07-25-b993'"), 'app build was not bumped to b993');

console.log('PASS branded boot loader: one centered green MLS logo surface, one progress tree, and readiness ownership preserved');
