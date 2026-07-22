'use strict';

/* Payments/pricing goal (2026-07-20, Enterprise re-priced 2026-07-21): the
 * pricing page tells the truth from the SERVER capability check — no false
 * per-card "Checkout unavailable" bars, no dead alert() CTAs, one status line
 * for the pricing area, and the $40 Enterprise tier displayed exactly as the
 * backend charges it. The admin screen gains the billing/plan panel wired to
 * the owner-only routes.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scribe = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

// --- Enterprise $40 display, matching the backend PLANS amounts -------------
// (owner directive 2026-07-21: $40/provider/mo and $400/provider/yr; the
//  3-provider minimum and every other tier price stay unchanged)
assert(/<div class="tier">Enterprise<\/div>\s*<div class="amt">\$40<span> \/ provider \/ mo<\/span><\/div>/.test(index),
  'Enterprise must display $40/provider/mo');
assert(index.includes('3+ providers · or $400/yr each'), 'Enterprise must show the $400 annual equivalent and 3+ minimum');
assert(!/\$50<span> \/ provider \/ mo/.test(index), 'the retired $50 Enterprise price must not appear');
assert(!/\$20<span> \/ provider \/ mo/.test(index), 'the retired $20 Enterprise price must not appear');
assert(!index.includes('$100/yr'), 'the retired $100 Enterprise annual must not appear');
assert(!/Enterprise — \$50\/mo/.test(index) && !/Enterprise — \$20\//.test(index),
  'retired Enterprise prices must not appear in the stat/tooltip copy');
assert(/Enterprise — \$40\/provider\/mo \(3\+ providers\)/.test(index),
  'the stat/tooltip copy must carry the current $40 Enterprise price');
// $40 sits above Lite ($30): the card must not claim to undercut EVERY solo tier.
assert(!index.includes('below every solo tier per provider'),
  'the "below every solo tier" claim is false at $40 (Lite is $30) and must stay retired');

// annual equivalents stay present and consistent on every tier
for (const annual of ['$300/yr', '$440/yr', '$600/yr', '$400/yr']) {
  assert(index.includes(annual), 'missing annual equivalent: ' + annual);
}

// --- no false error bars; capability-driven status --------------------------
assert(!index.includes('>Checkout unavailable<'), 'static per-card "Checkout unavailable" bars must be gone');
assert((index.match(/<span class="demolink" data-checkout-note>/g) || []).length === 4, 'each card keeps one truthful note slot');
assert(index.includes('id="pricingStatus"'), 'one pricing-area status line must exist');
assert(index.includes("fetch(BILLING_API + '/api/billing/health'"), 'the status must come from the server capability check');
assert(!/function startCheckout[\s\S]{0,200}alert\(/.test(index), 'the checkout CTA must not be a dead alert()');
assert(index.includes('var MLS_SALES_RELEASED = false;'), 'the sales hold must be an explicit, deliberate flag');
assert(/Purchasing is held pending release of production, legal and refund terms/.test(index),
  'the held state must be stated as policy, not as an error');
assert(/stripe-authentication|Stripe key was rejected/.test(index), 'authentication failures must be named specifically');
assert(/could not reach Stripe|network/i.test(index), 'network failures must be named specifically');
assert(index.includes("retry.onclick = refreshBillingStatus"), 'the network state must carry a real Retry action');
assert(/Checkout and subscriptions are disabled until the production, legal and refund terms are released\./.test(index),
  'the public honesty sentence stays until release');

// --- admin billing panel -----------------------------------------------------
assert(scribe.includes('Admin — Billing &amp; plans'), 'the admin billing panel is missing');
assert(scribe.includes("adminFetch('/api/admin/billing/overview')"), 'the panel must read the owner-only overview');
assert(scribe.includes("action:'grant'") && scribe.includes("action:'clear'"), 'grant and clear-override workflows must both exist');
assert(scribe.includes('Access source'), 'the panel must show WHY each account has access');
assert(scribe.includes("adminFetch('/api/admin/billing/webhooks')"), 'webhook diagnostics must be wired');
/* pin updated 2026-07-22: same explicit confirmation, via the non-blocking
   in-app dialog instead of thread-freezing native confirm() */
assert(/mlsConfirm\('Grant plan/.test(scribe) && /mlsConfirm\('Remove the admin override/.test(scribe),
  'plan changes must be explicitly confirmed');
assert(scribe.includes('returns the account to normal billing'), 'the clear action must explain the return-to-billing semantics');

console.log('PASS pricing/billing truth: $40 Enterprise displayed as charged, capability-driven single status with named reasons and a real Retry, no dead CTAs or false bars, and a confirmed+audited admin plan panel with access sources');
