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

// --- Two-card display: Premium $60 + Group rates (owner directive 2026-07-23:
//     "Only keep Premium and Group rates; Premium stays $60; group is a call.")
//     DISPLAY ONLY — the backend PLANS amounts and Stripe configuration are
//     untouched; checkout stays held behind MLS_SALES_RELEASED.
assert(/<div class="tier">Premium<\/div>\s*<div class="amt">\$60<span> \/ provider \/ mo<\/span><\/div>/.test(index),
  'Premium must display $60/provider/mo');
assert(index.includes('$600/yr'), 'Premium must show the $600 annual equivalent');
assert(/<div class="tier">Group rates<\/div>/.test(index), 'the Group rates card must exist');
assert(/Call us for group rates/.test(index), 'group pricing is a call, not a checkout price');
assert(/3\+ providers/.test(index), 'the 3+ provider minimum stays stated');
assert(!/<div class="tier">Lite<\/div>/.test(index) && !/<div class="tier">Standard<\/div>/.test(index)
  && !/<div class="tier">Enterprise<\/div>/.test(index),
  'Lite/Standard/Enterprise cards are retired from display (2026-07-23)');
assert(!/\$30<span> \/ provider \/ mo/.test(index) && !/\$44<span> \/ provider \/ mo/.test(index)
  && !/\$40<span> \/ provider \/ mo/.test(index),
  'retired tier prices must not appear as displayed amounts');
assert(!/Lite — \$30\/mo/.test(index) && !/Standard — \$44\/mo/.test(index) && !/Enterprise — \$40\/provider\/mo/.test(index),
  'retired tiers must not appear in the stat/tooltip copy');
assert(/Group rates — call us/.test(index), 'the stat/tooltip copy must carry the group-rates call CTA');

// --- no false error bars; capability-driven status --------------------------
assert(!index.includes('>Checkout unavailable<'), 'static per-card "Checkout unavailable" bars must be gone');
assert((index.match(/<span class="demolink" data-checkout-note>/g) || []).length === 2, 'each displayed card keeps one truthful note slot');
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
const grantStart = scribe.indexOf('async function adminGrantPlan(');
const clearStart = scribe.indexOf('async function adminClearPlan(', grantStart);
const clearEnd = scribe.indexOf('async function loadAdminUsers(', clearStart);
assert(grantStart >= 0 && clearStart > grantStart && clearEnd > clearStart,
  'admin plan mutation blocks could not be isolated');
const grantBlock = scribe.slice(grantStart, clearStart);
const clearBlock = scribe.slice(clearStart, clearEnd);
const grantConfirm = grantBlock.indexOf("await mlsConfirm('");
const grantWrite = grantBlock.indexOf("adminReadyRequest({action:'grant'");
const clearConfirm = clearBlock.indexOf("await mlsConfirm('");
const clearWrite = clearBlock.indexOf("adminFetch('/api/admin/billing/plan'");
assert(grantConfirm >= 0 && grantWrite > grantConfirm && /Grant[^']*plan/i.test(grantBlock.slice(grantConfirm, grantWrite)),
  'grant-plan mutation must follow an explicit in-app confirmation');
assert(clearConfirm >= 0 && clearWrite > clearConfirm && /Remove the admin override/i.test(clearBlock.slice(clearConfirm, clearWrite)),
  'clear-override mutation must follow an explicit in-app confirmation');
assert(scribe.includes('returns the account to normal billing'), 'the clear action must explain the return-to-billing semantics');

console.log('PASS pricing/billing truth: $40 Enterprise displayed as charged, capability-driven single status with named reasons and a real Retry, no dead CTAs or false bars, and a confirmed+audited admin plan panel with access sources');
