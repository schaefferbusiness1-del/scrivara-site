'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const start = source.indexOf('Canonical MLS feature directory');
const end = source.indexOf('MLS Scribe -- b44', start);
assert(start >= 0 && end > start, 'canonical Help/Find feature directory is missing');
const directory = source.slice(start, end);

assert(directory.includes('Shared by Find and Help'), 'Help and Find no longer share one location source');
assert(directory.includes("where:'Left navigation -> Reviews'") && directory.includes("route:'reach:reviews'"), 'Reviews location is stale or missing');
assert(directory.includes("where:'Left navigation -> Send to patient (or Patient portal in the active-patient bar)'") && directory.includes("route:'reach:send'"), 'Send-to-patient location is stale or missing');
assert(directory.includes("where:'AI Studio -> natural-language study builder at the top'") && directory.includes("route:'study'"), 'natural-language study location is stale or missing');
assert(directory.includes('limited-data draft') && directory.includes('clinician and privacy review are still required'), 'Help/Search overstates study privacy or readiness');
assert(directory.includes("name:'Ask MLS Copilot'") && directory.includes("route:'copilot'"), 'MLS Copilot location is stale or missing');
assert(directory.includes("name:'Manage note and op-note templates'") && directory.includes("where:'Menu -> Templates'"), 'Templates still teaches a retired top-bar location');
assert(directory.includes("name:'Ask MLS Copilot'") && directory.includes("where:'Menu -> Ask'"), 'Ask still teaches a retired top-bar location');
assert(directory.includes("name:'Build a custom widget'") && directory.includes("where:'Menu -> Custom widget (also at the top of AI Studio)'"), 'Custom widget still teaches a retired top-bar location');
assert(!directory.includes("where:'Top bar -> Templates'") && !directory.includes("where:'Top bar -> Ask'") && !directory.includes("where:'Top bar -> Custom widget"), 'canonical directory still contains retired top-bar locations');
assert(directory.includes("route.indexOf('reach:') === 0") && directory.includes("mode:'dialog',source:'feature-directory'"), 'Help/Find context actions must open compact Reach dialogs');
assert(directory.includes("if(typeof window.showView==='function') window.showView('studio')") && directory.includes("document.getElementById('mlsStudyPrompt')"), 'Help/Find cannot navigate to and focus the natural-language study builder');
assert(directory.includes('window.__mlsFeatureDirectory = DIR') && directory.includes('window.mlsFeatureHelpAnswer = helpAnswer') && directory.includes('window.mlsOpenFeature = openFeature'), 'directory is not published to both answer and navigation owners');

console.log('PASS Help/Search locations: one canonical directory routes Reviews, Send, Copilot, and natural-language studies to their exact current UI');
