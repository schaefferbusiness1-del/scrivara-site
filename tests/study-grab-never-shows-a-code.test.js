'use strict';
/* grabcode-1.0.0: Study > By procedure > "Search Athena with MLS Assist"
   printed the reader's bare code ("athena-not-open") when no athenaOne tab
   was open. Every failure now reads as a sentence the doctor can act on. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
let checks = 0;
for (const file of ['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const i = src.indexOf("var msg = em==='no-ext'");
  assert(i > 0, file + ': the grab failure wording moved');
  const j = src.indexOf(';', src.indexOf("esc(String(em))", i));
  const expr = src.slice(i, j + 1);
  const say = (em) => { const ctx = { em, esc: (s) => String(s).replace(/</g, '&lt;') }; vm.runInNewContext(expr + '\nthis.out = msg;', ctx); return ctx.out; };
  const notOpen = say('athena-not-open');
  assert(/No signed-in athenaOne tab is open/.test(notOpen) && !/athena-not-open/.test(notOpen), file + ': ' + notOpen); checks++;
  for (const code of ['no-athena-tab', 'reader-timeout', 'grab_failed', 'NO_CANONICAL_STUDY_READER']) {
    const m = say(code);
    assert(!m.includes(code), file + ': a bare code reached the doctor: ' + m); checks++;
  }
  assert(/could not run the athenaOne search/.test(say(undefined)), file + ': no error text gave no sentence'); checks++;
  const sentence = 'The account-owned Study reader is unavailable. Reopen the Study panel and retry.';
  assert.strictEqual(say(sentence), sentence, file + ': a real sentence from the reader was replaced'); checks++;
  assert(/MLS Assist isn/.test(say('no-ext')) && /Timed out/.test(say('timeout')), file + ': the known cases changed'); checks++;
}
console.log('study-grab-never-shows-a-code: ' + checks + ' checks passed');
