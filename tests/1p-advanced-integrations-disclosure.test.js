'use strict';

/* advint-1.0.0 — ONE DISCLOSURE, AND NOTHING LOAD-BEARING SLICED.
 *
 * The readiness audit's "delete or hide" list opened with the Settings
 * developer vocabulary. A second pass proved the list was UNSAFE as written:
 * three separate things depend on markup it proposed to remove.
 *   - #extDlNotes / #extDlVersion / #extDlVersionBtn / #extDlVersionNotes are
 *     read by the SHIPPED drift-correcting refresher at
 *     1p-mls-connect.js:52881-52884; strand them and the card can silently name
 *     a version the site does not serve.
 *   - the literal HTML comment "<!-- Developer API key + MLS Assist" is the
 *     end boundary of a between() slice in
 *     tests/athena-fhir-fallback-frontend.test.js:20 (production shell today,
 *     these shells after promotion).
 *   - the four setup steps are load-bearing, but the canonical extension card
 *     now owns them once; Integrations links there instead of carrying a second
 *     installer. genApiKey() called with no arguments remains the only way to
 *     mint the unscoped key its advanced card documents.
 *
 * So the change is a RESTYLE: same controls, same ids, same handlers, gathered
 * behind the right closed disclosure in physician language. This suite pins
 * both owners: install/update vocabulary lives only in the extension card,
 * while API and bulk-import vocabulary remains under Advanced integrations.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

function span(src, open, close, label) {
  const a = src.indexOf(open);
  assert.ok(a >= 0, `could not find ${label} open`);
  const b = src.indexOf(close, a + open.length);
  assert.ok(b > a, `could not find ${label} close`);
  return src.slice(a, b + close.length);
}

const OPEN = '<!-- ===== advint-1.0.0';
const CLOSE = '<!-- ===== end advint-1.0.0 ===== -->';

/* Each kind of advanced vocabulary has one semantic owner. */
const INSTALL_VOCAB = [
  'Developer mode',
  'Load unpacked'
];
const INTEGRATION_VOCAB = [
  'Generate API key',
  'Paste your old system’s export'
];

const spans = [];
for (const name of SHELLS) {
  const src = fs.readFileSync(path.join(root, name), 'utf8');

  /* -- the block exists exactly once and is delimited ---------------------- */
  eq(src.split(OPEN).length - 1, 1, `${name}: advint-1.0.0 must open exactly once`);
  eq(src.split(CLOSE).length - 1, 1, `${name}: advint-1.0.0 must close exactly once`);
  const block = span(src, OPEN, CLOSE, `${name} advint block`);
  const extensionOwner = span(src, '<div class="set-section" id="extensionDownloadSettings">', '\n    <div class="set-section">', `${name} extension owner`);
  spans.push(block);

  /* -- ONE disclosure, titled in physician language ----------------------- */
  eq(block.split('<details id="advIntegrations"').length - 1, 1,
    `${name}: there must be exactly ONE Advanced integrations disclosure`);
  ok(/<summary[^>]*>[^<]*Advanced integrations/.test(block),
    `${name}: the disclosure is not titled "Advanced integrations"`);
  ok(!/<details/.test(block.replace('<details id="advIntegrations"', '')),
    `${name}: the block nests a second <details> — the point was ONE disclosure, not a fold inside a fold`);
  /* closed by default: a disclosure that ships open hides nothing */
  ok(!/<details id="advIntegrations"[^>]*\sopen[\s>]/.test(block),
    `${name}: the Advanced integrations disclosure ships open`);

  /* -- each developer string is inside its one semantic owner ------------ */
  const outside = src.split(OPEN)[0] + src.split(CLOSE)[1];
  for (const term of INTEGRATION_VOCAB) {
    ok(block.indexOf(term) >= 0, `${name}: "${term}" is not inside the Advanced integrations disclosure`);
    eq(outside.indexOf(term), -1,
      `${name}: "${term}" is still in the open in Settings, outside the disclosure`);
  }
  const integrationsCard = span(src, '<!-- Developer API key + MLS Assist', '<div id="emrPullBox"', `${name} integrations card`);
  const integrationsMarkup = integrationsCard.replace(/<!--[\s\S]*?-->/g, '');
  const extensionMarkup = extensionOwner.replace(/<!--[\s\S]*?-->/g, '');
  for (const term of INSTALL_VOCAB) {
    ok(extensionMarkup.indexOf(term) >= 0, `${name}: "${term}" is not inside the canonical extension setup owner`);
    eq(integrationsMarkup.indexOf(term), -1,
      `${name}: "${term}" is duplicated in Integrations instead of living only in extension setup`);
  }
  ok(/<details(?![^>]*\sopen[\s>])[^>]*>[\s\S]*Developer mode/.test(extensionOwner),
    `${name}: direct-download setup does not start inside a closed disclosure`);
  ok(/data-mls-setup-target="extensionDownloadSettings"/.test(integrationsMarkup),
    `${name}: Integrations route lost its canonical extension-owner target`);
  ok(/onclick="mlsOpenExtensionSetup\(\);/.test(integrationsMarkup),
    `${name}: Integrations route does not activate its Settings group before scrolling`);
  /* The three headings the audit named are gone from the surface outside the
     disclosure. Scoped to `outside` on purpose: the block's own header QUOTES
     all three as the thing it exists to gather, and a scanner that cannot tell
     the record from the defect is the instrument lying first. */
  for (const gone of ['MLS Assist &amp; Developer API key', 'Advanced: Developer API key (FHIR API / server use)', 'Paste a JSON export below']) {
    eq(outside.indexOf(gone), -1, `${name}: the developer heading "${gone}" is still on the open Settings surface`);
    ok(block.indexOf(gone) >= 0,
      `${name}: the advint-1.0.0 header no longer records "${gone}" as one of the strings it gathered — keep the reason where the next reader will look`);
  }

  /* -- and NOTHING load-bearing was sliced -------------------------------- */
  /* (a) the refresher's four ids, still present, still exactly once */
  for (const id of ['extDlNotes', 'extDlVersion', 'extDlVersionBtn', 'extDlVersionNotes']) {
    eq(src.split(`id="${id}"`).length - 1, 1, `${name}: #${id} must exist exactly once — the version refresher reads it by id`);
    ok(connect.indexOf(`'${id}'`) > 0, `1p-mls-connect.js no longer reads #${id} — re-check this pin`);
  }
  /* the changelog text itself stays in the shell, retitled only */
  /* the version literal moves with every extension release train (3.0.62 -> 3.0.63 on
     2026-08-17, scripts/sweep-3063.js); the pin is that the notes text stays in #extDlNotes */
  ok(/id="extDlNotes"[^>]*>v3\.0\.\d+ - /.test(src),
    `${name}: the pinned release-notes text was moved out of #extDlNotes`);
  ok(/<summary[^>]*>What changed in this update/.test(src),
    `${name}: the release-notes disclosure was not retitled to physician language`);
  eq(src.indexOf("What's new in v"), -1, `${name}: the old "What's new in v..." summary is still present`);

  /* (b) the between() boundary comment, byte-for-byte */
  eq(src.split('<!-- Developer API key + MLS Assist').length - 1, 1,
    `${name}: the "<!-- Developer API key + MLS Assist" comment anchor was renamed or removed — it is a between() slice boundary`);

  /* (c) every control that was there is still there, with its handler, exactly
         once, and now inside the disclosure */
  for (const [needle, why] of [
    ['onclick="genApiKey()"', 'the ONLY way to mint the unscoped MLS Assist key the card documents'],
    ['onclick="loadApiKeys()"', 'the key list'],
    ['onclick="copyApiKey()"', 'copying a key that is shown once'],
    ['id="newApiKeyBox"', 'where the one-time key appears'],
    ['id="newApiKey"', 'the key field'],
    ['id="apiKeyList"', 'the key list host'],
    ['id="importJson"', 'the bulk-import textarea'],
    ['id="importResult"', 'the bulk-import result line'],
    ['onclick="importPatients()"', 'the bulk-import action'],
    ['mls-assist-extension', 'the folder the doctor is told to pick']
  ]) {
    eq(src.split(needle).length - 1, 1, `${name}: ${needle} (${why}) was lost or duplicated by the restyle`);
    if (needle === 'mls-assist-extension') ok(extensionOwner.indexOf(needle) >= 0, `${name}: ${needle} (${why}) is not inside canonical extension setup`);
    else ok(block.indexOf(needle) >= 0, `${name}: ${needle} (${why}) is not inside the Advanced integrations disclosure`);
  }
  ok(extensionOwner.indexOf('chrome://extensions') >= 0,
    `${name}: the in-app direct-download setup path disappeared from its canonical owner`);
  eq(integrationsMarkup.indexOf('chrome://extensions'), -1,
    `${name}: the Integrations card duplicates the extension setup path`);
  /* the clinical action stays OUTSIDE the disclosure */
  ok(block.indexOf('id="emrPullBox"') < 0,
    `${name}: "Pull a patient from my EMR" is a clinical action and was swept behind the advanced disclosure`);
  ok(src.indexOf('id="emrPullBox"') > 0, `${name}: #emrPullBox disappeared`);
}

eq(spans[0], spans[1], 'the twins carry different advint-1.0.0 blocks');

console.log(`1p-advanced-integrations-disclosure: ${checks} checks passed`);
