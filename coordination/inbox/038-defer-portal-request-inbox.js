'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const crossDayPath = path.join(root, 'tests', 'cross-day-appointment-context-runtime.test.js');
const lateSurfacesPath = path.join(root, 'tests', 'late-surfaces-stay-deferred.test.js');
const bootBudgetPath = path.join(root, 'tests', 'boot-script-budget.test.js');

function replaceOne(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': exact source anchor is missing');
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(label + ': exact source anchor is ambiguous');
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const connect = fs.readFileSync(connectPath, 'latin1');
const crossDay = fs.readFileSync(crossDayPath, 'utf8');
const lateSurfaces = fs.readFileSync(lateSurfacesPath, 'utf8');
const bootBudget = fs.readFileSync(bootBudgetPath, 'utf8');

const connectBefore = `;(function(){try{var A='feat_mls_portal_request_inbox.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v=20260717prq102';s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* prq-1.0.0: exact-patient portal request clinician review inbox; no prescribing, pull, extension, or Athena action */`;
const connectAfter = `;(function(){try{var sched=window.requestIdleCallback||function(f){return setTimeout(f,900);};sched(function(){try{var A='feat_mls_portal_request_inbox.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v=20260717prq102';s.setAttribute('data-mls-asset',A);s.async=true;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}},{timeout:2500});}catch(e){}})(); /* 2026-07-29: portal review is idle-deferred past sign-in. */`;

const crossDayBefore = `  const loaderEnd = connectSource.indexOf("\\n;(function(){try{var A='feat_mls_portal_request_inbox.js'", loaderStart);`;
const crossDayAfter = `  const loaderEnd = connectSource.indexOf("\\n;(function(){try{var sched=window.requestIdleCallback||function(f){return setTimeout(f,900);};sched(function(){try{var A='feat_mls_portal_request_inbox.js'", loaderStart);`;

const lateSurfacesBefore = `  'feat_mls_lastseen_unify.js',
  /* 2026-07-29 boot-deferral batch: 34 safe single-line loaders remain on`;
const lateSurfacesAfter = `  'feat_mls_lastseen_unify.js',
  /* 2026-07-29: clinician portal review self-heals after a late load and has
   * no synchronous production consumer, so it stays outside sign-in work. */
  'feat_mls_portal_request_inbox.js',
  /* 2026-07-29 boot-deferral batch: 34 safe single-line loaders remain on`;

const bootBudgetBefore = `/* 234 -> 196 on 2026-07-29: the boot-deferral batch leaves 34 safe
 * single-line loaders in the idle pattern. Patient Reach and Code Table were
 * restored to the ordered eager tail after measured first-use dependency
 * failures. Counted by THIS file's detector after the correction:
 * 196 eager / 49 deferred. Patient Reach is already classified eager because
 * its first textual reference precedes its loader; the exact loader contract
 * is therefore enforced in late-surfaces-stay-deferred.test.js. Floor remains
 * 20 below the ceiling per the failure message's own instruction, so the
 * remaining win cannot erode back one feature at a time. */
const EAGER_CEILING = 196;
const EAGER_FLOOR = 176;`;
const bootBudgetAfter = `/* 234 -> 196 on 2026-07-29: the boot-deferral batch leaves 34 safe
 * single-line loaders in the idle pattern. Patient Reach and Code Table were
 * restored to the ordered eager tail after measured first-use dependency
 * failures.
 * 196 -> 195 on 2026-07-29: Portal Request Inbox is a self-healing late Menu
 * surface with no synchronous production consumer. Counted by THIS file's
 * detector after that deferral: 195 eager / 50 deferred. Patient Reach is
 * already classified eager because its first textual reference precedes its
 * loader; the exact loader contract is therefore enforced in
 * late-surfaces-stay-deferred.test.js. Floor remains 20 below the ceiling per
 * the failure message's own instruction, so the remaining win cannot erode
 * back one feature at a time. */
const EAGER_CEILING = 195;
const EAGER_FLOOR = 175;`;

const nextConnect = replaceOne(connect, connectBefore, connectAfter, 'portal request loader');
const nextCrossDay = replaceOne(crossDay, crossDayBefore, crossDayAfter, 'cross-day loader end anchor');
const nextLateSurfaces = replaceOne(
  lateSurfaces,
  lateSurfacesBefore,
  lateSurfacesAfter,
  'late-surface portal coverage'
);
const nextBootBudget = replaceOne(
  bootBudget,
  bootBudgetBefore,
  bootBudgetAfter,
  'boot eager budget'
);

fs.writeFileSync(connectPath, nextConnect, 'latin1');
fs.writeFileSync(crossDayPath, nextCrossDay, 'utf8');
fs.writeFileSync(lateSurfacesPath, nextLateSurfaces, 'utf8');
fs.writeFileSync(bootBudgetPath, nextBootBudget, 'utf8');

console.log('Applied proposal 038: Portal Request Inbox now loads idle and async.');
