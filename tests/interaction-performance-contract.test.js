'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const settings = read('feat_athena_tooltip_dedupe.js');
const centerpiece = read('feat_mls_centerpiece.js');
const fab = read('feat_fab_layout.js');
const connect = read('mls-connect.js');
const app = read('ScribeFlow.html');

const scrollOwner = settings.slice(settings.indexOf('function ensureSettingsScrollGuard()'), settings.indexOf('function selectSettingsGroup'));
assert(scrollOwner.includes("addEventListener('scroll', rememberNativeScroll, { passive: true })"), 'Settings native scroll observer is missing');
assert(!/addEventListener\(['"](?:wheel|touchmove)/.test(scrollOwner), 'Settings still cancels compositor wheel/touch scrolling');

assert(centerpiece.includes("b.className === next.className && b.innerHTML === next.innerHTML"), 'acting-patient banner can still replace identical DOM every frame');
assert(centerpiece.includes("existing.className === node.className && existing.innerHTML === node.innerHTML"), 'patient walk strip can still rebuild identical buttons every frame');
assert(centerpiece.includes("document.getElementById('visitView') || document.body"), 'MLS Easy observer is not scoped to the Visit root');
assert(!centerpiece.includes("_obs.observe(document.body, { childList: true, subtree: true })"), 'MLS Easy still observes every body mutation');

assert(!fab.includes('_pollT = setInterval'), 'floating controls still force layout on a permanent timer');
assert(fab.includes('function scheduleLayout()') && fab.includes('function touchesLauncher('), 'floating controls lack filtered frame-coalesced layout');

assert(!connect.includes('reg[i].f()'), 'navigation still synchronously replays every registered UI timer');
assert(!connect.includes("document.addEventListener('click',onMaybeFlip,true)"), 'navigation still installs the global timer-replay click detector');
const messageFix = connect.slice(connect.indexOf('if(window.__mlsAthenaMsgFix)'), connect.indexOf('/* feat_canon_provider'));
assert(!messageFix.includes("document.querySelectorAll('div,span,p,li,small,em')"), 'one status-text mutation still triggers a whole-document text scan');
assert(messageFix.includes('function queue(node,deep)') && messageFix.includes('fix(batch[i].node,batch[i].deep)'), 'status text repair is not scoped to changed subtrees');
assert(app.includes("window.scrollTo({top:0,behavior:'auto'})"), 'view switches still fight an animated document scroll');

assert(!app.includes('<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>'), 'optional PDF tooling still blocks first paint');
assert(app.includes('function loadPdfJsOnDemand()'), 'PDF upload lost its lazy loader');

console.log('PASS interaction performance: native settings scroll, quiet MLS Easy, filtered layout, native timer semantics, and nonblocking first paint');
