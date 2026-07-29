/* settings-scheduling-api-contract
 *
 * The Settings → Integrations "Scheduling API — connect another scheduler"
 * card documents and manages the live backend FHIR scheduling surface
 * (scrivara-backend 7c2ac58). House rule under test: the card may not CLAIM
 * anything the system cannot back with a check —
 *   - the readiness line must come from a live probe of GET /fhir/metadata,
 *     and the "reachable" wording may exist ONLY inside the probe's 200
 *     branch (the static HTML ships "Not checked yet.");
 *   - nothing fetches at boot or Settings-open: the probe/key/webhook loads
 *     run only from the card's own <details> ontoggle and buttons;
 *   - key generation goes through the ONE existing genApiKey flow, extended
 *     with scopes (schedule.read read-only default), not a duplicate;
 *   - webhook registration posts the chosen criteria;
 *   - the walkthrough references resolve (booking.html page, /fhir/docs);
 *   - the examples fold teaches the incremental-sync param (_lastUpdated)
 *     and the delivery signature header (X-MLS-Signature).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

/* ---- 1. The card exists, inside the Integrations section ---- */
const secStart = html.indexOf('SECTION: Integrations');
const secEnd = html.indexOf('<!-- /Integrations section -->', secStart);
assert(secStart >= 0 && secEnd > secStart, 'Integrations section markers are missing');
const integrations = html.slice(secStart, secEnd);

const cardStart = integrations.indexOf('id="schedApiCard"');
assert(cardStart >= 0, 'the Scheduling API card must live inside the Integrations section');
assert(integrations.includes('📅 Scheduling API — connect another scheduler'), 'card title is missing');

/* Card region = from the card open to the next .field card (Import patients). */
const cardEnd = integrations.indexOf('Import patients', cardStart);
assert(cardEnd > cardStart, 'could not bound the Scheduling API card region');
const card = integrations.slice(cardStart, cardEnd);

/* ---- 2. Readiness is a PROBE, never a static claim ---- */
assert(html.includes("await fetch(bkBase()+'/fhir/metadata')"), 'the readiness probe must GET /fhir/metadata on the app backend');
assert(card.includes('id="schedApiStatus"') && card.includes('Not checked yet.'), 'the static status line must start unclaimed ("Not checked yet.")');
assert(!card.includes('🟢'), 'the card HTML must not ship a pre-claimed green status');
/* The success wording exists exactly once in the whole file, and only as the
 * direct consequence of the probe answering 200. */
assert.strictEqual(count(html, 'Scheduling API reachable'), 1, 'the "reachable" claim must exist exactly once (the probe success branch)');
assert(html.includes("if(r.status===200){ st.innerHTML='🟢 Scheduling API reachable"), 'the "reachable" wording must be written only in the r.status===200 branch');
/* The closed-gate reply (backend 503s/404s the whole /fhir mount until
 * clinical-use readiness) must be reported as not-enabled, not an error. */
assert(html.includes('r.status===404||r.status===503'), 'the probe must treat 404/503 as "not enabled on this backend yet"');
assert(html.includes('Not enabled on this backend yet'), 'the not-enabled wording is missing');

/* ---- 2b. Zero backend calls until the card is opened ---- */
assert(card.includes('ontoggle="if(this.open)schedApiOpen()"'), 'the tools fold must trigger the lazy load via ontoggle');
assert.strictEqual(count(html, 'schedApiOpen()'), 2, 'schedApiOpen must be invoked ONLY from the ontoggle handler (definition + handler = 2 occurrences)');
assert.strictEqual(count(html, 'schedApiCheckStatus()'), 3, 'the probe must run only from schedApiOpen, its ↻ button, and its own definition');

/* ---- 3. Scope-aware key generation through the ONE existing flow ---- */
assert(html.includes('async function genApiKey(scopes,label)'), 'genApiKey must be extended with (scopes,label), not duplicated');
assert(html.includes('if(Array.isArray(scopes)&&scopes.length) body.scopes=scopes;'), 'genApiKey must send the chosen scopes (and omit them for the legacy no-arg call)');
assert.strictEqual(count(html, "fetch(BACKEND_URL+'/api/fhir/keys',{method:'POST'"), 1, 'exactly one key-generation POST may exist (no duplicate flow)');
assert(html.includes("genApiKey(scopes,'Scheduling API')"), 'the card must generate through genApiKey with its picked scopes');

const pickStart = card.indexOf('id="schedApiScopePick"');
assert(pickStart >= 0, 'scope picker is missing');
const pick = card.slice(pickStart, card.indexOf('</div>', pickStart));
for (const scope of ['schedule.read', 'schedule.write', 'notes.read', 'notes.write', 'task.read', 'task.write']) {
  assert(pick.includes('value="' + scope + '"'), 'scope picker must offer ' + scope);
}
assert.strictEqual(count(pick, ' checked'), 1, 'exactly one scope may be pre-checked');
assert(pick.includes('value="schedule.read" checked'), 'the pre-checked default must be read-only scheduling (schedule.read)');

/* Existing keys must show their server-reported effective scopes. */
assert(html.includes("k.scopes.join(' · ')"), 'the key list must render each key\'s scopes');
assert(html.includes("document.getElementById('schedApiKeyList')"), 'the card must mirror the practice key list');

/* ---- 4. Webhook management posts the chosen criteria ---- */
const hookFn = html.slice(html.indexOf('async function schedApiAddWebhook()'), html.indexOf('async function schedApiDeleteWebhook'));
assert(hookFn.includes("fetch(BACKEND_URL+'/api/fhir/webhooks',{method:'POST'"), 'webhook add must POST /api/fhir/webhooks');
assert(hookFn.includes('body:JSON.stringify({url:url,criteria:criteria})'), 'webhook add must post the chosen criteria');
assert(card.includes('id="schedApiHookCriteria"') && card.includes('value="Appointment"') && card.includes('value="DocumentReference"'), 'the criteria choice must offer Appointment and DocumentReference');
assert(hookFn.includes("/^https:\\/\\//.test(url)"), 'webhook add must refuse non-https URLs before posting');
assert(card.includes('id="schedApiHookList"'), 'the webhook list is missing');
assert(html.includes('last_delivery_at') && html.includes('last_status'), 'the webhook list must show delivery telemetry');

/* ---- 5. The walkthrough references resolve ---- */
assert(card.includes('booking.html?token='), 'the walkthrough must reference the public booking page');
assert(fs.existsSync(path.join(root, 'booking.html')), 'booking.html must exist next to ScribeFlow.html');
assert(card.includes('/fhir/docs'), 'the card must link the hosted API docs');
assert(card.includes('urn:mls:appointment-id'), 'the walkthrough must name the dedupe identifier');

/* ---- 6. Examples fold: incremental sync + signature verification ---- */
const foldStart = card.indexOf('Examples &amp; field mapping');
assert(foldStart >= 0, 'the examples fold is missing');
const fold = card.slice(foldStart);
assert(fold.includes('_lastUpdated=gt'), 'the examples must show the _lastUpdated incremental-sync param');
assert(fold.includes('date=ge2026-07-28'), 'the examples must show a date-window read');
assert(fold.includes('Authorization: Bearer mls_'), 'the examples must show key auth');
assert(fold.includes('"identifier":[{"system":'), 'the POST example must carry identifier[] for idempotent create');
assert(fold.includes('X-MLS-Signature'), 'the examples fold must name the delivery signature header');
assert(card.includes("crypto.createHmac('sha256',secret)"), 'the HMAC verification snippet is missing');

console.log('PASS settings scheduling API: card lives in Integrations, readiness is a measured /fhir/metadata probe (success wording only in the 200 branch), loads are card-open lazy, keys generate scope-aware through the one genApiKey flow with a schedule.read default, webhooks post criteria and show delivery telemetry, and the examples teach _lastUpdated + X-MLS-Signature');
