'use strict';
/* ============================================================================
   currentOrders -> _athenaOrderReviewBundle -> unified manifest   (aorb-1.0.0)

   Owner P0, 2026-08-27, from Codex's cross-layer audit: an eligible accepted
   order was arriving at the main Athena review as manual/blocked.

   THE DEFECT, MEASURED. _athenaOrderReviewBundle() rebuilt every accepted
   draft as {type,fields,summary,originalText,source,complete} and DROPPED
   clientOrderId, reviewStatus, displayLabel, query, catalogCode and catalogId.
   All six are required by the write-flow's canonicalOrder(), so a complete,
   clinician-accepted, catalog-bound imaging order reached the review with
   reviewStatus undefined and was refused as "order-not-reviewed" - it
   degraded to a manual row, and the doctor re-typed into Athena an order MLS
   had already reviewed. The single-order route (_athenaOrderPlacementCandidate
   -> _athenaOpenSingleOrderReview) carried the identity correctly, which is
   why no existing suite caught it: the two routes disagreed.

   WHY THIS SUITE AND NOT A UNIT TEST OF THE BUNDLE. The existing
   orders-unified-review-contract test hands the manifest builder drafts that
   ALREADY carry their identity, so it passes on both sides of this defect.
   The seam that broke is the JOIN, so this walks the whole join in the real
   shell: the app's own currentOrders shape, the app's own bundle, the app's
   own write-flow manifest builder.

   NO GATE IS WEAKENED, AND THIS SUITE PROVES IT BOTH WAYS. An accepted order
   with NO catalog binding must stay off the ready path, and its reason must
   name the real blocker rather than falsely claiming the clinician never
   reviewed it. An unaccepted suggestion must stay blocked.
   ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
const measured = {};
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ---------------------------------------------------------------- PART 1 */
function statics() {
  for (const shell of SHELLS) {
    const src = read(shell);
    ok(/function\s+_athenaOrderReviewBundle\s*\(/.test(src),
      `${shell}: _athenaOrderReviewBundle() is gone - the whole order review rides on it`);
    ok(/function\s+_athenaCarryOrderIdentity\s*\(/.test(src),
      `${shell}: _athenaCarryOrderIdentity() is gone, so the bundle is dropping the order identity again`);
    ok(/_athenaCarryOrderIdentity\(item,o\)/.test(src),
      `${shell}: the bundle no longer calls _athenaCarryOrderIdentity on accepted drafts`);
    ok(/function\s+_athenaOrderPlacementCandidate\s*\(/.test(src),
      `${shell}: _athenaOrderPlacementCandidate() is gone - it is the ONE eligibility computer both order routes must share`);
    /* The identity must come from the shared eligibility computer, never from
       a second, looser copy of the rules living in the bundle. */
    ok(/_athenaOrderPlacementCandidate\(order\)/.test(src),
      `${shell}: the identity carrier no longer consults the shared eligibility computer, so the two order routes can drift apart again`);
  }
}

/* ---------------------------------------------------------------- PART 2 */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      if (p.endsWith('/')) p += 'index.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* The app's own currentOrders shape. Three orders, each one a different
   verdict the review must reach, and none of them PHI. */
function ordersFixture() {
  return [
    {
      id: 'o-census-imaging-1', type: 'imaging',
      fields: { study: 'MRI', region: 'Lumbar spine', indication: 'Persistent radicular symptoms' },
      catalogId: 'athena-catalog-imaging-77', catalogCode: '',
      _src: 'MRI lumbar spine', _source: 'ai-suggestion', _reviewStatus: 'accepted'
    },
    {
      id: 'o-census-pt-1', type: 'pt',
      fields: { dx: 'Lumbar strain', freq: '2x weekly', duration: '4 weeks', modalities: 'Therapeutic exercise' },
      _source: 'provider-entered', _reviewStatus: 'accepted'
    },
    {
      id: 'o-census-ai-1', type: 'referral',
      fields: { specialty: 'Neurosurgery', reason: 'Review after imaging' },
      _src: 'Consider neurosurgery referral', _source: 'ai-suggestion', _ai: true
    }
  ];
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!(window.__mlsWriteFlow && typeof window.__mlsWriteFlow.buildUnifiedManifest === 'function'),
      null, { timeout: 60000 });

    const out = await page.evaluate((orders) => {
      /* A capable MLS Assist. The supervised single-order contract is what
         turns an eligible order into a typed place_order row; without it the
         row is correctly manual, and this suite would be measuring the
         extension rather than the join it is here to measure. */
      window.__mlsExtensionCapabilities = { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true };
      const report = { errs: [] };
      try { window.currentOrders = orders; } catch (e) { report.errs.push('assign:' + e.message); }
      let bundle = null;
      try { bundle = _athenaOrderReviewBundle(orders, ['Consider neurosurgery referral']); }
      catch (e) { report.errs.push('bundle:' + e.message); return report; }
      report.bundle = {
        drafts: bundle.drafts.map((d) => ({
          type: d.type, source: d.source, complete: d.complete,
          clientOrderId: d.clientOrderId || '', reviewStatus: d.reviewStatus || '',
          displayLabel: d.displayLabel || '', query: d.query || '',
          catalogCode: d.catalogCode || '', catalogId: d.catalogId || '',
          blockedReason: d.orderPlacementBlockedReason || ''
        })),
        suggestions: bundle.suggestions.map((s) => ({ type: s.type, source: s.source, summary: s.summary }))
      };
      let manifest = null;
      try {
        manifest = window.__mlsWriteFlow.buildUnifiedManifest({
          patient: { name: 'Ada Sample', dob: '01/02/1970', mrn: 'MRN100000', patientId: 'syn-0' },
          expectedContext: { visitDate: '08/19/2026', provider: 'Sample Provider, MD', appointmentId: '9000' },
          receiptSessionId: 'order-identity-regression', previewHash: 'order-identity-preview',
          plan: [{ kind: 'orders', body: 'Order review', orderDrafts: bundle.drafts, orderSuggestions: bundle.suggestions }]
        });
      } catch (e) { report.errs.push('manifest:' + e.message); return report; }
      report.rows = (manifest.rows || []).filter((r) => r.payload && r.payload.category === 'order').map((r) => ({
        id: r.id, action: r.action, capability: r.capability, reason: r.reason || '',
        reviewStatus: r.payload.reviewStatus || '', orderType: r.payload.orderType || '',
        eligibility: r.payload.orderEligibility || '',
        eligibilityMessage: r.payload.orderEligibilityMessage || '',
        order: r.payload.order ? {
          clientOrderId: r.payload.order.clientOrderId, displayLabel: r.payload.order.displayLabel,
          query: r.payload.order.query, catalogCode: r.payload.order.catalogCode,
          catalogId: r.payload.order.catalogId, reviewStatus: r.payload.order.reviewStatus,
          source: r.payload.order.source
        } : null
      }));
      return report;
    }, ordersFixture());

    measured.bundle = out.bundle;
    measured.rows = out.rows;
    measured.errs = out.errs;
    eq((out.errs || []).length, 0, `the join threw: ${JSON.stringify(out.errs)}`);

    /* ---- the bundle keeps every field the write-flow requires ----------- */
    const drafts = out.bundle.drafts;
    eq(drafts.length, 2, `two clinician-accepted drafts were expected, got ${drafts.length}: ${JSON.stringify(drafts)}`);
    const imaging = drafts.filter((d) => d.type === 'imaging')[0];
    const pt = drafts.filter((d) => d.type === 'pt')[0];
    ok(!!imaging && !!pt, `the accepted imaging and PT drafts did not both survive the bundle: ${JSON.stringify(drafts)}`);

    eq(imaging.clientOrderId, 'o-census-imaging-1', 'the bundle dropped the order\'s immutable local id');
    eq(imaging.reviewStatus, 'accepted', 'the bundle dropped the clinician\'s acceptance, so the review calls a reviewed order unreviewed');
    eq(imaging.displayLabel, 'MRI Lumbar spine', 'the bundle dropped the exact Athena catalog label');
    eq(imaging.query, 'MRI Lumbar spine', 'the bundle dropped the exact Athena catalog search query');
    eq(imaging.catalogId, 'athena-catalog-imaging-77', 'the bundle dropped the durable Athena catalog id');
    eq(imaging.source, 'ai-suggestion-accepted', 'the accepted AI suggestion lost its accepted source label');
    eq(imaging.complete, true, 'the complete imaging draft was not marked complete, so nothing downstream can go ready');

    /* ---- the join reaches the review AS ELIGIBLE ------------------------ */
    const imagingRow = out.rows.filter((r) => r.orderType === 'imaging')[0];
    ok(!!imagingRow, `the imaging order produced no manifest row at all: ${JSON.stringify(out.rows)}`);
    eq(imagingRow.action, 'place_order',
      `an eligible accepted catalog-bound order degraded to a non-typed row (eligibility="${imagingRow.eligibility}", message="${imagingRow.eligibilityMessage}") - this is the exact P0 defect`);
    eq(imagingRow.capability, 'ready',
      `an eligible accepted catalog-bound order reached the main Athena review as "${imagingRow.capability}" instead of ready: ${JSON.stringify(imagingRow)}`);
    eq(imagingRow.reason, '', `a capable exact order is still described as blocked or manual: ${JSON.stringify(imagingRow.reason)}`);
    ok(!!imagingRow.order, 'the ready row carries no canonical order payload');
    eq(imagingRow.order.clientOrderId, 'o-census-imaging-1', 'the manifest row lost the immutable client order id');
    eq(imagingRow.order.query, 'MRI Lumbar spine', 'the manifest row lost the exact catalog query');
    eq(imagingRow.order.catalogId, 'athena-catalog-imaging-77', 'the manifest row lost the durable catalog id');
    eq(imagingRow.order.reviewStatus, 'accepted', 'the manifest row lost the clinician\'s acceptance');

    /* ---- NO GATE WAS WEAKENED, proved from the other side --------------- */
    const ptRow = out.rows.filter((r) => r.orderType === 'pt')[0];
    ok(!!ptRow, `the accepted PT order with no catalog binding produced no row: ${JSON.stringify(out.rows)}`);
    ok(ptRow.action !== 'place_order',
      'an accepted order with NO durable Athena catalog code or id became a typed place_order row - a safety gate was weakened');
    eq(ptRow.order, null, 'an order with no catalog binding must carry no canonical order payload');
    eq(ptRow.eligibility, 'catalog-identity-required',
      `the unbound PT order is refused for the wrong reason ("${ptRow.eligibility}") - the doctor is told the order was never reviewed when the real gap is its catalog binding`);
    ok(/catalog/i.test(ptRow.eligibilityMessage),
      `the refusal message does not name the catalog binding: ${JSON.stringify(ptRow.eligibilityMessage)}`);

    /* ---- an unaccepted suggestion is still not a reviewed draft --------- */
    const suggestionRows = out.rows.filter((r) => /suggestion only/i.test(r.reviewStatus));
    ok(suggestionRows.length >= 1, `the unaccepted AI suggestion did not survive as a suggestion row: ${JSON.stringify(out.rows)}`);
    suggestionRows.forEach((r) => {
      eq(r.capability, 'blocked', `an unaccepted suggestion reached the review as "${r.capability}"`);
      eq(r.action, '', 'an unaccepted suggestion was given an executable action');
      eq(r.order, null, 'an unaccepted suggestion carries a canonical order payload');
    });

    eq(pageErrors.length, 0, `the shell raised page errors during the join: ${pageErrors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

statics();
runtime().then(() => {
  console.log('MEASURED ' + JSON.stringify(measured, null, 1));
  console.log(`1p-athena-order-review-identity-runtime: ${checks} checks passed`);
}).catch((e) => {
  console.error('MEASURED ' + JSON.stringify(measured, null, 1));
  console.error('1p-athena-order-review-identity-runtime FAILED: ' + (e && e.message));
  process.exit(1);
});
