'use strict';
/*
 * THE PRELOAD SCANNER CANNOT READ JAVASCRIPT, AND IT DOES NOT KNOW THAT
 * -----------------------------------------------------------------------------
 * Chrome runs a preload scanner over the raw bytes of an HTML document ahead of
 * the parser, looking for things worth fetching early. It is a byte scanner. It
 * does not evaluate JavaScript, and inside a 16,000-line inline <script> it will
 * happily match an attribute pattern that is really the inside of a string
 * literal.
 *
 * ScribeFlow.html built its branded-export letterhead as
 *
 *     '<img src="'+clinicLogo+'" alt="" style="...">'
 *
 * which is correct JavaScript and produced a correct <img>. But the BYTES
 * contain src="'+clinicLogo+'" - a complete quoted attribute - so Chrome
 * speculatively fetched a file literally named '+clinicLogo+' on every single
 * load of the app. MEASURED with CDP Network.requestWillBeSent, initiator type
 * "parser": one request, 404, every load, against the production origin.
 *
 * It survived because every place a human looks was correct. There is no such
 * <img> element in the DOM, no script content leaked into the body, the export
 * renders the real logo, and the console shows nothing. Only the network panel
 * knew. That is the definition of a defect that needs a test rather than
 * vigilance.
 *
 * THE RULE: in a shipped HTML document, a fetching attribute (src/href/poster/
 * srcset/data) must never be spelled as a quote-delimited literal whose value
 * begins with a JavaScript concatenation. Split the attribute name from its
 * value - '<img '+'src='+'"'+url+'"' - and the scanner has nothing to match
 * while the produced string stays byte-identical.
 *
 * The check is deliberately narrow. It fires ONLY on `attr="'+` and `attr='"+`,
 * i.e. an opening quote immediately followed by a string-close and a plus. A
 * legitimate static attribute, a template literal with ${}, and any attribute
 * built by setAttribute are all untouched, so this cannot become a tax on
 * ordinary markup.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

/* Every HTML document this repo publishes or stages. ScribeFlow_test.html is a
   historical snapshot and is not shipped; it is excluded from _config.yml. */
const DOCUMENTS = ['ScribeFlow.html', 'ScribeFlow-staging.html'];

/* attr = " ' +      or      attr = ' " +
   The opening quote is immediately closed by the other quote and concatenated,
   which only ever happens when the attribute is being built inside JS. */
const SCANNABLE = /\b(src|href|poster|srcset|data|action|formaction)\s*=\s*(?:"'\s*\+|'"\s*\+)/g;

const offences = [];
for (const rel of DOCUMENTS) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    SCANNABLE.lastIndex = 0;
    let m;
    while ((m = SCANNABLE.exec(line))) {
      offences.push(`${rel}:${i + 1}  ${m[1]}=  ...${line.slice(Math.max(0, m.index - 20), m.index + 60).trim()}`);
    }
  });
}

assert.deepStrictEqual(offences, [],
  'These fetching attributes are spelled so the preload scanner reads them as real URLs.\n' +
  'Each one costs a speculative 404 on every page load, against the production origin,\n' +
  'for a path made of JavaScript source text:\n\n  ' + offences.join('\n  ') +
  "\n\nSplit the attribute name from its value - '<img '+'src='+'\"'+url+'\"' - which\n" +
  'produces the identical string and leaves the scanner nothing to match.');

/* The positive control. A test that only ever passes because its pattern is
   wrong is worse than no test, and this one has an easy way to be wrong: a
   regex that quietly stops matching still reports success. Prove it can see the
   exact shape it was written for. */
const PROBE = `  const t=(x)?('<img src="'+x+'" alt="">'):'';`;
SCANNABLE.lastIndex = 0;
assert.ok(SCANNABLE.test(PROBE), 'the detector no longer recognises the very shape it exists to catch');
SCANNABLE.lastIndex = 0;
assert.ok(!SCANNABLE.test(`  const t='<img '+'src='+'"'+x+'" alt="">';`),
  'the detector flags the documented fix, which would make the fix impossible to apply');
SCANNABLE.lastIndex = 0;
assert.ok(!SCANNABLE.test('<img src="logo.png" alt="">'), 'the detector flags ordinary static markup');
SCANNABLE.lastIndex = 0;
assert.ok(!SCANNABLE.test('  el.innerHTML = `<img src="${url}">`;'), 'the detector flags template literals, which the scanner cannot resolve either way');

console.log('PASS no speculative preload of JS strings: ' + DOCUMENTS.length +
  ' shipped documents carry no fetching attribute the preload scanner can mistake for a URL (4 positive/negative controls).');
