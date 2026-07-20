const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const founderStart = html.indexOf('id="kickstarter"');
const priceGridStart = html.indexOf('<div class="price-grid">', founderStart);

assert(founderStart >= 0 && priceGridStart > founderStart, 'pricing page must retain an explicit purchasing-status section');
const founderBlock = html.slice(founderStart, priceGridStart);

assert(!/kickstarter\.com/i.test(html), 'held release must not publish a Kickstarter destination');
assert(!/[?&](?:token|ref)=/i.test(html), 'held release must not publish tokenized or referral sales URLs');
assert(html.includes('Checkout and founder rewards are held until production scope and commercial terms are released.'), 'hero must state that founder rewards are held');
assert(founderBlock.includes('Purchasing held'), 'purchasing-status section must be visibly held');
assert(founderBlock.includes('No subscription or founder package is being sold from this release.'), 'held section must state that no founder package is for sale');
assert(founderBlock.includes('Commercial terms, refunds and production scope must be reviewed before checkout or external reward links are enabled.'), 'held section must explain its release prerequisites');
assert(!/<a\b|<button\b|onclick\s*=|\$[\d,]+|\d+%\s*off/i.test(founderBlock), 'held founder section must not contain a sales action, reward price, or discount ladder');

/* 2026-07-20 rework: startCheckout is now a POLICY GATE. While
   MLS_SALES_RELEASED is false it refuses, says the truth ("Purchasing is
   held"), routes to the demo request, and NEVER contacts a payment service
   from its own body; the released path lives in a separate launchCheckout
   reachable only through the flag. */
const checkoutStart = html.indexOf('function startCheckout(');
const checkoutEnd = html.indexOf('async function submitDemo(', checkoutStart);
assert(checkoutStart >= 0 && checkoutEnd > checkoutStart, 'planning-price buttons need an explicit fail-closed handler');
const checkoutSource = html.slice(checkoutStart, checkoutEnd);
assert(checkoutSource.includes('Checkout is not released.'), 'planning-price handler must state the checkout hold');
assert(checkoutSource.includes("if (!MLS_SALES_RELEASED) {"), 'the hold must be the explicit release flag, not incidental');
assert(checkoutSource.includes("say('Purchasing is held — request a demo below.')"), 'the refusal must tell the user the truthful next action');
assert(!/\bfetch\s*\(|location\s*=|window\.open\s*\(/.test(checkoutSource), 'held checkout handler must not contact or navigate to a payment service');
assert(html.includes('var MLS_SALES_RELEASED = false;'), 'sales stay held until the flag is deliberately flipped');

console.log('PASS purchasing boundary: no Kickstarter/tokenized rewards, visible held status, and fail-closed planning-price controls');
