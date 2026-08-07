'use strict';

/* A clinician whose SURNAME SPELLS A CREDENTIAL must still get a provider key.
 *
 * providerKey stripped every credential-spelled token unconditionally and then
 * required two survivors, so:
 *
 *     providerKey("Anh Do")  === ""     providerKey("Sam Pa") === ""
 *     providerKey("Lee Rn")  === ""     providerKey("Anh Thi Do") === "anh|thi"
 *
 * An empty key fails at provider-unverified, so those clinicians could never
 * run a selected-provider pull — 100% of their imports, since the day it
 * shipped. Measured by the ext-goal lane on 2026-08-06, one axis over from the
 * b908/si-1.7.20 defect where a credential-spelled surname INVENTED a second
 * clinician.
 *
 * THE RULE THIS FILE DEFENDS, in both directions:
 *   1. Credentials are stripped only while the name can SPARE them. If removing
 *      them would leave fewer than two identifying tokens, the token was
 *      carrying name weight and is kept.
 *   2. NEVER WIDEN MATCHING. Every key that resolved before must be
 *      byte-identical after, and two genuinely different clinicians must not
 *      collapse onto one key. A provider matcher that merges two doctors is
 *      worse than one that refuses.
 *
 * Titles are treated separately from credentials on purpose: "Dr"/"Doctor" only
 * ever precede a name and are never a surname, so they are always noise —
 * which is what makes "Dr. Anh Do" key the same as "Anh Do".
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'feat_mls_schedimport_exact.js'), 'utf8');

/* run the SHIPPED function, not a paraphrase of it */
function extract(name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error(name + ' is missing from feat_mls_schedimport_exact.js');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}
const noiseSrc = (src.match(/var PROVIDER_NOISE = \{[\s\S]*?\};/) || [])[0];
const titleSrc = (src.match(/var PROVIDER_TITLE = \{[^}]*\};/) || [])[0];
if (!noiseSrc) throw new Error('PROVIDER_NOISE table not found');
if (!titleSrc) throw new Error('PROVIDER_TITLE table not found — titles must stay separable from credentials');
function safe(f, d) { try { return f(); } catch (e) { return d; } }
/* strict-mode eval scopes its own `var`, so the declarations are rewritten into
   assignments against these bindings. The table CONTENTS and the function body
   are untouched shipped bytes, which is the whole point of reading them out. */
let providerKey, PROVIDER_NOISE, PROVIDER_TITLE;
eval(noiseSrc.replace(/^var /, ''));
eval(titleSrc.replace(/^var /, ''));
eval(extract('providerKey').replace('function providerKey', 'providerKey = function'));

let failures = 0;
function eq(input, want, why) {
  const got = providerKey(input);
  if (got === want) { console.log('  pass  ' + JSON.stringify(input) + ' -> ' + JSON.stringify(got)); return; }
  failures++;
  console.error('  FAIL  ' + JSON.stringify(input) + ' -> ' + JSON.stringify(got) +
    '  (want ' + JSON.stringify(want) + ')' + (why ? '\n        ' + why : ''));
}
function differ(a, b) {
  const ka = providerKey(a), kb = providerKey(b);
  if (ka && kb && ka !== kb) { console.log('  pass  ' + a + ' / ' + b + ' stay apart (' + ka + ' vs ' + kb + ')'); return; }
  failures++;
  console.error('  FAIL  ' + a + ' and ' + b + ' collapsed onto ' + JSON.stringify(ka) +
    ' — a provider matcher must never merge two clinicians');
}

/* ---- 1. the defect: a credential-spelled surname now resolves ----------- */
console.log('a surname that spells a credential:');
eq('Anh Do', 'anh|do', 'was "" — she could never run a selected-provider pull');
eq('Sam Pa', 'pa|sam');
eq('Lee Rn', 'lee|rn');
eq('Kim Ot', 'kim|ot');
eq('Ray Od', 'od|ray');
/* a title is not a surname, so it drops and the key matches the bare name */
eq('Dr. Anh Do', 'anh|do', 'a leading title must not change the identity');
eq('Doctor Anh Do', 'anh|do');

/* ---- 2. NEVER WIDEN: every previously-resolving key is unchanged -------- */
console.log('keys that resolved before must be byte-identical:');
eq('Anh Thi Do', 'anh|thi', 'the credential is genuinely spare here — must not change');
eq('Matthew Schaeffer, MD', 'matthew|schaeffer');
eq('Schaeffer_Matthew_MD', 'matthew|schaeffer');
eq('Schaeffer, Matthew', 'matthew|schaeffer');
eq('John Smith DO', 'john|smith');
eq('Sam Parker PA', 'parker|sam');
eq('Jane Doe NP', 'doe|jane');
eq('Ana Ruiz, CRNP', 'ana|ruiz');

/* ---- 3. an unidentifiable label still REFUSES --------------------------- */
console.log('a label with no identity still refuses:');
eq('Dr Do', '', 'one identifying token is not a clinician');
eq('MD', '');
eq('', '');
eq('All Providers', '');
eq('all providers', '');
eq('   ', '');

/* ---- 4. two DIFFERENT clinicians must never share a key ----------------- */
console.log('different clinicians stay apart:');
differ('Anh Do', 'Anh Doe');
differ('Sam Pa', 'Sam Parker PA');
differ('Lee Rn', 'Lee Ronson');
differ('Anh Do', 'Anh Thi Do');
differ('Matthew Schaeffer MD', 'Michael Schaeffer MD');

/* ---- 5. name ORDER still normalises (the sort is the point) ------------- */
console.log('order variants of one clinician still agree:');
eq('Do Anh', 'anh|do', 'sorted tokens make "Last First" and "First Last" agree');

/* ---- 6. the structural guarantee, stated as an assertion ---------------- */
console.log('structural:');
(function () {
  /* the fallback may only ever ADD a token the raw label already contained —
     it can never invent one, which is what makes widening impossible */
  const samples = ['Anh Do', 'Sam Pa', 'Lee Rn', 'Dr. Anh Do', 'Anh Thi Do', 'Matthew Schaeffer, MD'];
  let ok = true;
  for (const s of samples) {
    const key = providerKey(s);
    if (!key) continue;
    const raw = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    for (const tok of key.split('|')) {
      if (raw.split(/\s+/).indexOf(tok) < 0) { ok = false; console.error('        invented token ' + tok + ' for ' + s); }
    }
  }
  if (ok) console.log('  pass  every key token appears verbatim in its own raw label (no invention)');
  else failures++;
})();

console.log(failures === 0
  ? 'PASS providerKey credential-surname: Do/Pa/Rn/Ot/Od surnames resolve, every prior key is unchanged, and no two clinicians merge'
  : 'FAIL provider-key-credential-surname: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
