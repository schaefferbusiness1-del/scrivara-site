'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('ScribeFlow.html');
const connect = read('mls-connect.js');
const legal = read('feat_mls_legalpack.js');
const chartFill = read('legal-chart-fill-ui.js');

assert(!app.includes('onclick="generatePatientLegalReport()"'), 'patient profile must not launch legal reports outside Legal requests');
assert(!app.includes('id="legalBtn"'), 'Visit tools must not expose the legacy Legal button');
assert(app.includes("showView('legalreq');"), 'generated legal reports must return to the Legal requests workspace');
assert(app.includes('Nothing drafts until you press <b>Generate report</b>.'), 'fulfill preparation must explain that generation is manual');
assert(app.includes('id="legalModalPatientSel"') && app.includes('setLegalAttachedPatient(this.value)'), 'legal preparation modal must expose an explicit patient attachment control');
assert(app.includes('function ensureLegalRequestWorkspace()') && app.includes("if(v==='legalreq')"), 'base app must keep legal nodes inside Legal requests even if enhancement loading is delayed');

const openRequest = app.slice(app.indexOf('async function openLegalRequest(id)'), app.indexOf('function signAndReturnLegal()', app.indexOf('async function openLegalRequest(id)')));
assert(openRequest.includes('Request opened. Confirm the attached patient'), 'Fulfill must stop at the review/preparation step');
assert(!openRequest.includes('generateLegalReport();'), 'Fulfill must not auto-draft a report');
assert(!openRequest.includes("showView('patients')") && !openRequest.includes("showView('visit')"), 'Fulfill must remain in Legal requests');

const generateLegal = app.slice(app.indexOf('async function generateLegalReport()'), app.indexOf('function legalStripSignature', app.indexOf('async function generateLegalReport()')));
assert(generateLegal.includes("showView('legalreq')") && !generateLegal.includes("showView('visit')"), 'completed legal drafts must remain in Legal requests');
assert(generateLegal.includes('Attorney requests never inherit whichever chart happens to be active elsewhere.'), 'request generation must use only an explicit patient attachment');

const fulfillSource = chartFill.slice(chartFill.indexOf('function fulfillName()'), chartFill.indexOf('function updateBanner()', chartFill.indexOf('function fulfillName()')));
assert(fulfillSource.includes('legalAttachedPatientId'), 'chart-source confirmation must read the explicit Legal attachment');
assert(!fulfillSource.includes('activePatient()'), 'chart-source confirmation must not claim an unrelated active chart is attached');

assert(legal.includes("window.showView('legalreq')"), 'the narrative handoff must remain in Legal requests');
assert(!legal.includes("window.showView('visit')"), 'the legal workflow must never redirect to Visit');
assert(legal.includes("var card = $('legalCard')") && legal.includes('view.insertBefore(card, expert)'), 'the review/sign/PDF card must be moved into Legal requests');
assert(legal.includes("var modal = $('legalModal')") && legal.includes('view.appendChild(modal)'), 'the legal builder modal must be owned by Legal requests');

assert(connect.includes('id="mlsPhEmail"'), 'phone setup email must be a wired button, not a bare mailto link');
assert(connect.includes("$('mlsPhEmail').addEventListener('click', openSetupEmail)"), 'phone setup email button needs a click handler');
assert(connect.includes("bkBase() + '/api/copilot/email'") && connect.includes('to: to, subject: parts.subject, body: parts.body'), 'phone setup button must send the signed-in user the setup link');
assert(connect.includes('https://mail.google.com/mail/?view=cm&fs=1&to='), 'phone setup must open a web-email draft when no desktop mail app is configured');
assert(connect.includes("typeof bkUser !== 'undefined'") && connect.includes('getSessionEmail()'), 'phone setup email must address the signed-in account when available');

const connectednessTick = connect.match(/function tick\(\) \{ try \{ css\(\); fixDayProgress\(\); wrapBrief\(\); fixClinicalTools\(\);[^}]*\}/);
assert(connectednessTick && !connectednessTick[0].includes('legalTick()'), 'Visit must not inject the open-legal-request banner');

console.log('PASS legal workspace placement and phone setup email');
