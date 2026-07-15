'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

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
assert(app.includes('const SF_GATE_MIN_MS=2800'), 'readiness-based minimum loading duration was lost');
assert(app.includes("window.__MLS_AV=\"b292\""), 'ScribeFlow loader was not cache-busted to b292');

const nodes = {};
const removed = [];
function element(tag) {
  return {
    tagName: tag,
    id: '',
    style: { cssText: '', display: '' },
    attributes: {},
    innerHTML: '',
    setAttribute(k, v) { this.attributes[k] = String(v); },
    querySelector(sel) {
      if (sel === '#sfGateLoadingInner' && this.innerHTML.includes('id="sfGateLoadingInner"')) return {};
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
assert(bootDriver.includes('#mlsBLwrap{width:260px;max-width:72vw;margin:2px 0 0}'), 'progress driver can reintroduce the split auto-margin layout');
assert(bootDriver.includes('#mlsBLmsg{margin-top:11px;font-size:13px;color:#C9DCD2'), 'progress text is not legible on the green loader');
assert(bootDriver.includes("wrap('sfShowGateLoading',start,true)"), 'late sign-in can mount a static progress bar instead of starting it');
assert(connect.includes("window.__MLS_AV = window.__MLS_AV || 'b292'"), 'shared asset version was not bumped to b292');
assert(connect.includes("var MLS_APP_BUILD='2026-07-15-b292'"), 'app build was not bumped to b292');

console.log('PASS branded boot loader: one centered green MLS logo surface, one progress tree, and readiness ownership preserved');
