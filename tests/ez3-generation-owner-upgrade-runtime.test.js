'use strict';

/* Same-document upgrade proof for the actual canonical Easy owner. Mount the
 * shipped IIFE twice in one browser document, retire the first owner through
 * its public __retireForUpgrade seam, and drive the real lifecycle events.
 * This catches listeners that survive an upgrade and repaint from an old
 * S/render closure. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const easyStart = source.indexOf("(function () {\n  'use strict';\n  var VER = '3.7.3'");
const easyEnd = source.indexOf(
  '\n})();\n\n\n/* =========================================================================\n * MLS Scribe — PULL PIPELINE TRUTH PACK',
  easyStart
);
assert(easyStart >= 0 && easyEnd > easyStart, 'could not isolate canonical Easy owner');
const easySource = source.slice(easyStart, easyEnd + '\n})();'.length);

/* The old global completion receipt was not owner-cleaned. The settled
 * receipt below is the canonical engine contract and is the only Easy render
 * path this owner needs. Keep these assertions close to the browser proof so
 * a future reintroduction cannot silently make the regression meaningless. */
assert(!source.includes('__ez3GenEvtWired'), 'legacy global completion listener was reintroduced');
assert(!source.includes("addEventListener('mls:generation-complete'"),
  'legacy completion listener was reintroduced');

function lifecycleCounts(page) {
  return page.evaluate(() => Object.fromEntries(
    Object.entries(window.__ez3GenerationListeners).map(([type, set]) => [type, set.size])
  ));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.setContent(`<!doctype html><html><head></head><body>
      <div id="visitView"></div>
      <textarea id="transcript"></textarea>
      <textarea id="noteBox"></textarea>
      <button id="genBtn" type="button">Generate</button>
    </body></html>`);

    /* Count the exact lifecycle listeners and each render's #ez3Wrap paint.
     * The wrapper delegates to the browser's native methods, so this only
     * observes ownership; it does not replace the event or DOM semantics. */
    await page.evaluate(() => {
      const day = new Date().toISOString().slice(0, 10);
      window.__ez3OwnerLabel = 'old';
      window.__ez3GenerationPaints = [];
      window.__ez3GenerationListeners = Object.create(null);
      window._calAppts = [{
        id: 'upgrade-appt', name: 'Upgrade Patient', dob: '1980-01-01',
        day_local: day, appt_date: day, start_at: new Date().toISOString(),
        patient_external_id: 'upgrade-patient'
      }];
      window._acctTodayKey = () => day;
      window.showView = () => {};

      const nativeAdd = window.addEventListener.bind(window);
      const nativeRemove = window.removeEventListener.bind(window);
      const isGenerationEvent = type => /^mls:generation-/.test(type);
      window.addEventListener = function (type, listener, options) {
        if (isGenerationEvent(type)) {
          (window.__ez3GenerationListeners[type] || (window.__ez3GenerationListeners[type] = new Set())).add(listener);
        }
        return nativeAdd(type, listener, options);
      };
      window.removeEventListener = function (type, listener, options) {
        if (isGenerationEvent(type) && window.__ez3GenerationListeners[type]) {
          window.__ez3GenerationListeners[type].delete(listener);
        }
        return nativeRemove(type, listener, options);
      };

      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
      if (!descriptor || typeof descriptor.set !== 'function') throw new Error('innerHTML setter unavailable');
      Object.defineProperty(Element.prototype, 'innerHTML', {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          if (this.id === 'ez3Wrap') {
            let phase = '';
            try {
              const owner = window.__mlsEasyV32;
              phase = owner && typeof owner.state === 'function' ? owner.state().phase : '';
            } catch (_) {}
            window.__ez3GenerationPaints.push({ label: window.__ez3OwnerLabel, phase });
          }
          return descriptor.set.call(this, value);
        }
      });
    });

    await page.addScriptTag({ content: easySource });
    await page.waitForTimeout(50);
    const oldOwner = await page.evaluate(() => {
      const owner = window.__mlsEasyV32;
      if (!owner || owner.version !== '3.7.3' || owner.installed !== true) {
        throw new Error('canonical Easy owner is not installed');
      }
      owner.remote.startVisitFor('upgrade-appt');
      return owner.state();
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => { window.__ez3GenerationPaints = []; });
    assert.strictEqual(oldOwner.screen, 'doctor', 'old canonical owner did not mount the visit screen');
    assert.deepStrictEqual(await lifecycleCounts(page), {
      'mls:generation-started': 1,
      'mls:generation-refused': 1,
      'mls:generation-settled': 1
    }, 'old owner did not register the cleanup-owned lifecycle listeners');
    assert.strictEqual(await page.evaluate(() =>
      (window.__ez3GenerationListeners['mls:generation-complete'] || new Set()).size), 0,
    'completion event still has an Easy listener');

    const retired = await page.evaluate(() => {
      const owner = window.__mlsEasyV32;
      const receipt = owner.__retireForUpgrade('3.7.4');
      window.dispatchEvent(new CustomEvent('mls:generation-complete'));
      window.dispatchEvent(new CustomEvent('mls:generation-settled', {
        detail: { runId: 7, status: 'success' }
      }));
      return { receipt, ownerPresent: !!window.__mlsEasyV32, paints: window.__ez3GenerationPaints.slice() };
    });
    await page.waitForTimeout(20);
    assert.strictEqual(retired.receipt, true, 'supported same-document retirement did not retire the old owner');
    assert.strictEqual(retired.ownerPresent, false, 'retired Easy owner remained globally installed');
    assert.deepStrictEqual(await lifecycleCounts(page), {
      'mls:generation-started': 0,
      'mls:generation-refused': 0,
      'mls:generation-settled': 0
    }, 'retirement left old lifecycle listeners behind');
    assert.deepStrictEqual(retired.paints, [], 'retired owner repainted from a stale event');

    await page.evaluate(() => { window.__ez3OwnerLabel = 'current'; });
    await page.addScriptTag({ content: easySource });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const owner = window.__mlsEasyV32;
      if (!owner || owner.version !== '3.7.3' || owner.installed !== true) {
        throw new Error('canonical Easy owner is not installed');
      }
      owner.remote.startVisitFor('upgrade-appt');
      document.getElementById('noteBox').value =
        'HPI: current symptoms documented. Exam stable. Assessment and plan follow.';
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => { window.__ez3GenerationPaints = []; });
    assert.deepStrictEqual(await lifecycleCounts(page), {
      'mls:generation-started': 1,
      'mls:generation-refused': 1,
      'mls:generation-settled': 1
    }, 'current owner did not install one listener set after retirement');
    assert.strictEqual(await page.evaluate(() =>
      (window.__ez3GenerationListeners['mls:generation-complete'] || new Set()).size), 0,
    'current owner installed a duplicate completion listener');

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mls:generation-started', {
      detail: { runId: 22 }
    })));
    await page.waitForTimeout(10);
    const afterStart = await page.evaluate(() => window.__ez3GenerationPaints.slice());
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mls:generation-settled', {
      detail: { runId: 7, status: 'failed', code: 'old-run' }
    })));
    await page.waitForTimeout(10);
    const afterStale = await page.evaluate(() => window.__ez3GenerationPaints.slice());
    assert.deepStrictEqual(afterStale, afterStart,
      'current owner repainted from a stale prior-run settled receipt');

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mls:generation-settled', {
      detail: { runId: 22, status: 'success' }
    })));
    await page.waitForTimeout(10);
    const afterCurrentSettle = await page.evaluate(() => window.__ez3GenerationPaints.slice());
    assert.strictEqual(afterCurrentSettle.filter(paint => paint.label === 'current' && paint.phase === 'note').length, 1,
      'current owner did not render exactly one settled note');

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mls:generation-complete')));
    await page.waitForTimeout(10);
    const afterComplete = await page.evaluate(() => window.__ez3GenerationPaints.slice());
    assert.deepStrictEqual(afterComplete, afterCurrentSettle,
      'legacy completion receipt caused a duplicate current-owner repaint');
    assert.deepStrictEqual(afterComplete.filter(paint => paint.label === 'old'), [],
      'old owner repainted after the current owner mounted');
    assert.strictEqual((await page.evaluate(() => window.__mlsEasyV32.state())).phase, 'note',
      'current settled owner did not remain in note phase');

    await page.evaluate(() => window.__mlsEasyV32.__retireForUpgrade('3.7.4'));
    await page.waitForTimeout(10);
    assert.deepStrictEqual(await lifecycleCounts(page), {
      'mls:generation-started': 0,
      'mls:generation-refused': 0,
      'mls:generation-settled': 0
    }, 'current owner lifecycle listeners were not cleanup-owned');
    assert.deepStrictEqual(pageErrors, [], `canonical owner raised page errors: ${pageErrors.join(' | ')}`);
    console.log('PASS ez3-generation-owner-upgrade-runtime: actual Easy owners retire in place; stale runs and legacy completion cannot repaint, and the current owner renders one settled note');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
