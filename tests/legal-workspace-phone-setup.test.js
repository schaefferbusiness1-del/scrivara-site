'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('ScribeFlow.html');
const connect = read('mls-connect.js');
assert(app.includes('const MLS_LEGAL_WORKSPACE_RELEASED=false;'), 'networked legal release must remain held');
for (const asset of ['legal-chart-fill-ui.js','feat_mls_legal_exact.js','feat_mls_legal_paywidget.js','feat_mls_legal_pay_setup.js','feat_mls_legalpack.js']) {
  assert(!connect.includes(asset), `production connector still loads ${asset}`);
}
assert(!/label:'(?:Flag legal \/ IME case|Legal requests)'/.test(connect), 'production command surface still exposes Legal');

assert(connect.includes('id="mlsPhEmail"'), 'phone setup email must be a wired button, not a bare mailto link');
assert(connect.includes("$('mlsPhEmail').addEventListener('click', openSetupEmail)"), 'phone setup email button needs a click handler');
assert(connect.includes("bkBase() + '/api/copilot/email'") && connect.includes('to: to, subject: parts.subject, body: parts.body'), 'phone setup button must send the signed-in user the setup link');
assert(connect.includes('https://mail.google.com/mail/?view=cm&fs=1&to='), 'phone setup must open a web-email draft when no desktop mail app is configured');
assert(connect.includes("typeof bkUser !== 'undefined'") && connect.includes('getSessionEmail()'), 'phone setup email must address the signed-in account when available');

const connectednessTick = connect.match(/function tick\(\) \{ try \{ css\(\); fixDayProgress\(\); wrapBrief\(\); fixClinicalTools\(\);[^}]*\}/);
assert(connectednessTick && !connectednessTick[0].includes('legalTick()'), 'Visit must not inject the open-legal-request banner');

console.log('PASS held legal production graph and explicit signed-in phone-setup email');
