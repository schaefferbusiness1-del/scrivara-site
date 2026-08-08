/* note-defaults-transport-split
 *
 * WHERE THE NOTE DEFAULTS CAN AND CANNOT REACH, AND WHY.
 *
 * aiCallRaw has two hosted transports and they are not equivalent:
 *
 *   opts.freeform -> POST /api/complete  body {system, user, legal, maxTokens}
 *                    the client's system prompt IS transmitted.
 *   otherwise     -> POST /api/generate  body {transcript, model}
 *                    there is NO system field. The client builds a system
 *                    prompt at ScribeFlow.html (STANDARDS + the practice code
 *                    table + provider preferences) and then THROWS IT AWAY;
 *                    the server composes its own from a fixed SYSTEM_PROMPT
 *                    plus the clinician's specialty.
 *
 * Consequence, measured live on b964 against the real endpoint: for any hosted
 * account -- which is every account, since backendMode() is true whenever
 * BACKEND_URL is set -- the practice billing code table and the Note style
 * preference have NEVER reached MAIN VISIT-NOTE generation. They reach it only
 * for a bring-your-own-API-key device, where aiCallRaw posts messages[] to
 * OpenAI directly. That is not something the client can fix: /api/generate
 * accepts no system input, so closing it needs the endpoint to take (and use)
 * the block. Backend lane, manual deploy.
 *
 * This test does NOT assert the bug is fixed. It pins the transport contract so
 * that (a) nobody credits main-note generation with coverage it does not have,
 * and (b) the day /api/generate starts carrying the block, this fails and tells
 * whoever changed it to update the Settings claim text with it.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sf = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8').replace(/\r/g, '');

let failures = 0;
const fail = m => { console.error('FAIL: ' + m); failures++; };

/* ---- 1. the two transports still exist and still differ ---- */
const i = sf.indexOf('async function aiCallRaw(sys,user,key,opts){');
if (i < 0) { console.error('FAIL: aiCallRaw not found'); process.exit(1); }
const body = sf.slice(i, i + 4000);

const complete = body.indexOf("'/api/complete'");
const generate = body.indexOf("'/api/generate'");
if (complete < 0) fail('the /api/complete transport is gone');
if (generate < 0) fail('the /api/generate transport is gone');

const completeBody = body.slice(complete, complete + 400);
const generateBody = body.slice(generate, generate + 400);

if (!/body:JSON\.stringify\(\{system:sys,user:user/.test(completeBody)) {
  fail('/api/complete no longer sends the client system prompt - every Note-defaults path that works today runs through it');
}
if (/system\s*:/.test(generateBody.split('signal')[0])) {
  fail('/api/generate NOW SENDS A SYSTEM PROMPT. That is good news and this test is the tripwire: ' +
       'main visit-note generation can finally carry the practice code table and the Note style. ' +
       'Update feat_mls_note_defaults_reach to cover it, and only then is the Settings claim ' +
       '"used everywhere MLS drafts or fills codes (notes, ...)" true for hosted accounts.');
}
if (!/body:JSON\.stringify\(\{transcript:user/.test(generateBody)) {
  fail('/api/generate body shape changed - re-measure what main note generation actually transmits');
}

/* ---- 2. the note-generation call really is the non-freeform one ---- */
const gen = sf.indexOf('let content=await aiCallRaw(sys,user,key);');
if (gen < 0) fail('callOpenAI no longer calls aiCallRaw(sys,user,key) with no opts - re-check which transport main note generation takes');

/* ---- 3. and the discarded prompt really does contain the settings ---- */
const sysStart = sf.lastIndexOf('const sys=', gen);
const discarded = sf.slice(sysStart, gen);
if (discarded.indexOf('__mlsCodeTable') < 0) fail('the main-note system prompt no longer builds in the practice code table');
if (discarded.indexOf('docPrefsBlock') < 0) fail('the main-note system prompt no longer builds in the provider preferences');

console.log('PASS note-defaults transport split:');
console.log('  /api/complete  sends {system,user} -> every op-note, letter, AVS, report and');
console.log('                 prior-auth path carries the practice codes and the Note style.');
console.log('  /api/generate  sends {transcript,model} only -> MAIN VISIT-NOTE generation on a');
console.log('                 hosted account carries NEITHER, and cannot until the endpoint');
console.log('                 accepts them. The client builds the block and drops it. OPEN,');
console.log('                 backend lane. Do not credit this path with coverage.');
if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
