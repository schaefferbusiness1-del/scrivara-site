'use strict';

/* clunky2-rooms lifecycle: the Studio title pass must not survive owner
 * retirement, and evaluating the same owner twice must not add a second
 * observer, interval, or click/event listener. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const start = shell.indexOf("var VERSION = 'clunky2-rooms-1.0.0';");
const end = shell.indexOf('</script>', start);
assert.ok(start >= 0 && end > start, 'could not extract clunky rooms owner');
const owner = shell.slice(shell.lastIndexOf('(function(){', start), end);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><div id="appWrap"><div id="studioView"></div><div id="mlsCvNxt_history" data-mls-clunky-hero="1"><span class="mls-cv-big">Choose</span><span class="mls-cv-sub">Pick</span></div></div></body></html>');
    await page.evaluate(() => {
      window.__clunkyObs = [];
      const NativeMO = window.MutationObserver;
      window.MutationObserver = function (cb) {
        const o = new NativeMO(cb);
        const nativeDisconnect = o.disconnect.bind(o);
        o.__cb = cb;
        o.disconnect = function () { o.__disconnected = true; window.__clunkyDisconnects = (window.__clunkyDisconnects || 0) + 1; return nativeDisconnect(); };
        window.__clunkyObs.push(o);
        return o;
      };
      window.__clunkyIntervals = [];
      const nativeSetInterval = window.setInterval;
      const nativeClearInterval = window.clearInterval;
      window.setInterval = function (cb, ms) { const id = nativeSetInterval(cb, ms); window.__clunkyIntervals.push({ id, cb, ms, cleared: false }); return id; };
      window.clearInterval = function (id) { const rec = window.__clunkyIntervals.find(x => x.id === id); if (rec) rec.cleared = true; window.__clunkyClears = (window.__clunkyClears || 0) + 1; return nativeClearInterval(id); };
      window.__clunkyTimeouts = [];
      const nativeSetTimeout = window.setTimeout;
      const nativeClearTimeout = window.clearTimeout;
      window.setTimeout = function (cb, ms) { const id = nativeSetTimeout(cb, ms); window.__clunkyTimeouts.push({ id, cb, ms, cleared: false }); return id; };
      window.clearTimeout = function (id) { const rec = window.__clunkyTimeouts.find(x => x.id === id); if (rec) rec.cleared = true; return nativeClearTimeout(id); };
      window.__clunkyEventCalls = 0;
      window.getActivePtId = () => '';
      window.__clunkyRoute = '';
      window.showView = v => { window.__clunkyRoute = v; };
    });
    await page.addScriptTag({ content: owner });
    const first = await page.evaluate(() => ({
      hasApi: !!window.__mlsClunkyRooms,
      observers: window.__clunkyObs.length,
      intervals: window.__clunkyIntervals.length,
      passes: window.__mlsClunkyRooms.passes()
    }));
    assert.strictEqual(first.hasApi, true, 'owner did not install');
    assert.ok(first.observers >= 1, 'install did not create a body observer');
    assert.strictEqual(first.intervals, 1, 'install did not create exactly one interval');
    await page.evaluate(() => document.querySelector('#mlsCvNxt_history .mls-cv-big').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));

    await page.addScriptTag({ content: owner });
    const duplicate = await page.evaluate(() => ({ observers: window.__clunkyObs.length, intervals: window.__clunkyIntervals.length }));
    assert.deepStrictEqual(duplicate, { observers: first.observers, intervals: 1 }, 'duplicate owner evaluation installed competing lifecycle work');

    const before = await page.evaluate(() => { window.__mlsClunkyRooms.pass(); return window.__mlsClunkyRooms.passes(); });
    await page.evaluate(() => window.__mlsClunkyRooms.revert());
    const retired = await page.evaluate(() => ({
      disconnected: window.__clunkyObs.some(x => x.__disconnected),
      clears: window.__clunkyClears || 0,
      installed: !!window.__mlsClunkyRooms,
      startupCleared: window.__clunkyTimeouts.filter(x => [200, 700, 1500, 3000].includes(x.ms)).every(x => x.cleared)
    }));
    assert.strictEqual(retired.disconnected, true, 'revert did not disconnect the body observer');
    assert.strictEqual(retired.clears, 1, 'revert did not clear the interval');
    assert.strictEqual(retired.installed, false, 'revert left the retired owner globally installed');
    assert.strictEqual(retired.startupCleared, true, 'revert left a startup timeout armed');

    const after = await page.evaluate(async (beforePasses) => {
      window.__clunkyObs[0].__cb([]);
      window.__clunkyIntervals[0].cb();
      window.__clunkyTimeouts.filter(x => x.ms === 60).forEach(x => x.cb());
      window.dispatchEvent(new CustomEvent('mls:view-changed'));
      document.body.appendChild(document.createElement('div'));
      await new Promise(r => setTimeout(r, 100));
      return beforePasses;
    }, before);
    assert.strictEqual(after, before, 'retired observer/timer/event callbacks still ran pass()');
    console.log('clunky rooms lifecycle: 8 checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
