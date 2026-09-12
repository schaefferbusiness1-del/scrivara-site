'use strict';

/* Practice entitlement refresh through the merged AI Studio route.
 *
 * The premium lock owns the actual lock/unlock markup. The merge must call its
 * public apply() when Practice becomes live, otherwise a late plan response can
 * leave stale premium UI on screen until an unrelated polling tick.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const merge = fs.readFileSync(path.join(root, 'feat_mls_studio_merge.js'), 'utf8');
assert(/function refreshPracticeEntitlement\(\)/.test(merge), 'Practice entitlement refresh helper is missing');
assert(/if \(key === 'practice'\) \{[\s\S]*refreshPracticeEntitlement\(\);/.test(merge),
  'selecting Practice does not refresh the entitlement owner');

(async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body><div id="appWrap"><div id="studioView" class="sx-grid">
      <div class="sx-title">AI Studio</div><div id="copilotCard">Ask</div>
    </div><div id="analysisView"><div class="card">Practice</div></div></div></body></html>`);
    await page.evaluate(() => {
      window.__entitlementPremium = false;
      window.__entitlementApplyCount = 0;
      window.__mlsStudioLock = { apply() {
        window.__entitlementApplyCount++;
        let lock = document.getElementById('mlsStudioPremiumLock');
        if (!window.__entitlementPremium) {
          if (!lock) { lock = document.createElement('div'); lock.id = 'mlsStudioPremiumLock'; document.getElementById('studioView').prepend(lock); }
        } else if (lock) lock.remove();
      }};
    });
    await page.addScriptTag({ content: merge });
    await page.waitForFunction(() => !!window.__mlsStudioMerge);

    await page.evaluate(() => window.__mlsStudioMerge.select('practice'));
    let state = await page.evaluate(() => ({
      applies: window.__entitlementApplyCount,
      locked: !!document.getElementById('mlsStudioPremiumLock'),
      section: document.body.getAttribute('data-mls-sm')
    }));
    assert.strictEqual(state.section, 'practice', 'merged route did not make Practice live');
    assert.ok(state.applies >= 1, 'Practice route did not ask the entitlement owner to refresh');
    assert.strictEqual(state.locked, true, 'non-premium Practice did not show its lock state');

    await page.evaluate(() => {
      window.__entitlementPremium = true;
      window.__mlsStudioMerge.select('ask');
      window.__mlsStudioMerge.select('practice');
    });
    state = await page.evaluate(() => ({
      applies: window.__entitlementApplyCount,
      locked: !!document.getElementById('mlsStudioPremiumLock'),
      section: document.body.getAttribute('data-mls-sm')
    }));
    assert.strictEqual(state.section, 'practice', 'premium route did not return to Practice');
    assert.ok(state.applies >= 2, 'premium Practice route did not refresh after entitlement changed');
    assert.strictEqual(state.locked, false, 'premium Practice still showed the non-premium lock');
    await page.close();
  } finally {
    await browser.close();
  }
  console.log('PASS studio-merge-practice-entitlement-runtime: merged Practice refreshes both non-premium lock and premium unlock states');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
