const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shareUrl = 'https://www.kickstarter.com/projects/mlsscribe/1281360255?ref=6uxarf&amp;token=d7e65610';

assert(html.includes('id="kickstarter"'), 'sales site must expose a Kickstarter founder-rewards section');
assert(html.split(shareUrl).length >= 3, 'hero and founder section must use the enabled Kickstarter preview URL');
assert(/target="_blank" rel="noopener noreferrer"/.test(html), 'external Kickstarter links must open safely');

for (const amount of ['$135', '$230', '$315', '$810', '$1,575', '$4,000']) {
  assert(html.includes(amount), `founder ladder must include ${amount}`);
}
for (const discount of ['10% off', '21% off', '30% off', '40% off', '50% off', '71% off']) {
  assert(html.includes(discount), `founder ladder must include ${discount}`);
}

assert(html.includes('Up to 8 providers · 5 years · website value $14,000'), 'top reward must match the five-year, eight-provider offer');
console.log('PASS Kickstarter sales contract: working preview URL, full incentive ladder, and safe external links');
