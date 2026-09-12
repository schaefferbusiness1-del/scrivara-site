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
    await page.setContent('<!doctype html><html><body><div id="appWrap"><div id="studioView"></div><div id="historyView" style="display:block"><div id="mlsCvNxt_history" data-mls-clunky-hero="1"><span class="mls-cv-big">Choose</span><span class="mls-cv-sub">Pick</span></div></div></div></body></html>');
    await page.evaluate(() => {
      window.__clunkyObs = [];
      const NativeMO = window.MutationObserver;
      window.MutationObserver = function (cb) {
        const o = new NativeMO(cb);
        const nativeDisconnect = o.disconnect.bind(o);
        o.__cb = cb;
        o.disconnect = function () { o.__disconnected = true; window.__clunkyDisconnects = (window.__clunkyDisconnects || 0) + 1; return nativeDisconnect(); };
        o.__owner = String(cb).includes('retired');
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
      window.__clunkyListeners = [];
      window.__clunkyRemovals = [];
      const nativeAdd = EventTarget.prototype.addEventListener;
      const nativeRemove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function (type, cb, opts) {
        const capture = opts === true || !!(opts && opts.capture);
        window.__clunkyListeners.push({ target: this === document ? 'document' : this === window ? 'window' : 'other', type, cb, capture, removed: false });
        return nativeAdd.call(this, type, cb, opts);
      };
      EventTarget.prototype.removeEventListener = function (type, cb, opts) {
        const capture = opts === true || !!(opts && opts.capture);
        const rec = window.__clunkyListeners.find(x => !x.removed && x.target === (this === document ? 'document' : this === window ? 'window' : 'other') && x.type === type && x.cb === cb && x.capture === capture);
        if (rec) { rec.removed = true; window.__clunkyRemovals.push(rec); }
        return nativeRemove.call(this, type, cb, opts);
      };
      window.__clunkyEventCalls = 0;
      window.getActivePtId = () => '';
      window.__clunkyRoute = '';
      window.showView = v => { window.__clunkyRoute = v; };
    });
    await page.addScriptTag({ content: owner });
    await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
    const first = await page.evaluate(() => ({
      hasApi: !!window.__mlsClunkyRooms,
      observers: window.__clunkyObs.length,
      intervals: window.__clunkyIntervals.length,
      passes: window.__mlsClunkyRooms.passes()
    }));
    assert.strictEqual(first.hasApi, true, 'owner did not install');
    assert.ok(first.observers >= 1, 'install did not create a body observer');
    assert.strictEqual(first.intervals, 1, 'install did not create exactly one interval');
    const hero = await page.evaluate(() => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true });
      const dispatched = document.querySelector('#mlsCvNxt_history .mls-cv-big').dispatchEvent(e);
      return { dispatched, defaultPrevented: e.defaultPrevented, route: window.__clunkyRoute };
    });
    assert.deepStrictEqual(hero, { dispatched: false, defaultPrevented: true, route: 'patients' }, 'hero capture handler did not route and suppress the stale action');

    await page.addScriptTag({ content: owner });
    const duplicate = await page.evaluate(() => ({ observers: window.__clunkyObs.length, intervals: window.__clunkyIntervals.length }));
    assert.deepStrictEqual(duplicate, { observers: first.observers, intervals: 1 }, 'duplicate owner evaluation installed competing lifecycle work');

    const before = await page.evaluate(() => { window.__mlsClunkyRooms.pass(); return window.__mlsClunkyRooms.passes(); });
    await page.evaluate(() => { window.__retiredApi = window.__mlsClunkyRooms; window.__mlsClunkyRooms.revert(); });
    const retired = await page.evaluate(() => ({
      disconnected: window.__clunkyObs.filter(x => x.__owner).length > 0 && window.__clunkyObs.filter(x => x.__owner).every(x => x.__disconnected),
      clears: window.__clunkyClears || 0,
      installed: !!window.__mlsClunkyRooms,
      startupCleared: window.__clunkyTimeouts.filter(x => [200, 700, 1500, 3000].includes(x.ms)).every(x => x.cleared),
      listenersBalanced: window.__clunkyListeners.filter(x => (['mls:active-patient-changed', 'mls:view-changed', 'DOMContentLoaded'].includes(x.type) || (x.type === 'click' && x.target === 'document'))).every(x => x.removed)
    }));
    assert.strictEqual(retired.disconnected, true, 'revert did not disconnect every owner observer');
    assert.strictEqual(retired.clears, 1, 'revert did not clear the interval');
    assert.strictEqual(retired.installed, false, 'revert left the retired owner globally installed');
    assert.strictEqual(retired.startupCleared, true, 'revert left a startup timeout armed');
    assert.strictEqual(retired.listenersBalanced, true, 'revert left an owner listener installed');

    const after = await page.evaluate(async (beforePasses) => {
      window.__clunkyObs.forEach(x => x.__cb([]));
      window.__clunkyIntervals.forEach(x => x.cb());
      window.__clunkyTimeouts.forEach(x => x.cb());
      window.__clunkyListeners.filter(x => ['click', 'mls:active-patient-changed', 'mls:view-changed', 'DOMContentLoaded'].includes(x.type)).forEach(x => {
        try { x.cb(new Event(x.type)); } catch (_) {}
      });
      window.__clunkyRoute = '';
      const e = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.querySelector('#mlsCvNxt_history .mls-cv-big').dispatchEvent(e);
      document.body.appendChild(document.createElement('div'));
      await new Promise(r => setTimeout(r, 100));
      return { passes: window.__retiredApi.passes(), defaultPrevented: e.defaultPrevented, route: window.__clunkyRoute };
    }, before);
    assert.strictEqual(after.passes, before, 'retired observer/timer/event callbacks still ran pass()');
    assert.strictEqual(after.defaultPrevented, false, 'retired hero capture handler still prevented the click');
    assert.strictEqual(after.route, '', 'retired hero handler changed routing');

    const reinstall = await page.evaluate(() => {
      const retiredApi = window.__retiredApi;
      const oldPasses = retiredApi.passes();
      retiredApi.pass();
      const oldFrozen = retiredApi.passes() === oldPasses;
      return { oldFrozen, oldObservers: window.__clunkyObs.filter(x => x.__owner && !x.__disconnected).length, oldIntervals: window.__clunkyIntervals.filter(x => !x.cleared).length };
    });
    assert.strictEqual(reinstall.oldFrozen, true, 'retired API pass was not inert');
    assert.strictEqual(reinstall.oldObservers, 0, 'retired owner retained an active observer before reinstall');
    assert.strictEqual(reinstall.oldIntervals, 0, 'retired owner retained an active interval before reinstall');
    await page.addScriptTag({ content: owner });
    const fresh = await page.evaluate(() => ({
      installed: !!window.__mlsClunkyRooms,
      activeObservers: window.__clunkyObs.filter(x => x.__owner && !x.__disconnected).length,
      activeIntervals: window.__clunkyIntervals.filter(x => !x.cleared).length,
      activeListeners: window.__clunkyListeners.filter(x => (['mls:active-patient-changed', 'mls:view-changed', 'DOMContentLoaded'].includes(x.type) || (x.type === 'click' && x.target === 'document')) && !x.removed).length
    }));
    assert.deepStrictEqual(fresh, { installed: true, activeObservers: 1, activeIntervals: 1, activeListeners: 3 }, 'reinstall did not create exactly one active owner');
    await page.evaluate(() => window.__mlsClunkyRooms.revert());
    const final = await page.evaluate(() => ({
      observersDead: window.__clunkyObs.filter(x => x.__owner).every(x => x.__disconnected),
      intervalsDead: window.__clunkyIntervals.every(x => x.cleared),
      listenersDead: window.__clunkyListeners.filter(x => ['mls:active-patient-changed', 'mls:view-changed', 'DOMContentLoaded'].includes(x.type) || (x.type === 'click' && x.target === 'document')).every(x => x.removed)
    }));
    assert.deepStrictEqual(final, { observersDead: true, intervalsDead: true, listenersDead: true }, 'second revert left lifecycle work active');
    console.log('clunky rooms lifecycle: 17 checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
