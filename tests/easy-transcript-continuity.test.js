'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const start = source.indexOf('/* =============================================================================\n * __mlsEz3Flow');
const end = source.indexOf('/* =============================================================================\n * __mlsGuidedTour', start);
assert(start >= 0 && end > start, 'easy visit flow module boundary was not found');
const flow = source.slice(start, end);

assert(flow.includes("var VERSION = 'fl-1.5.1'"), 'persistent transcript lifecycle release is not installed');
assert(!flow.includes('function nativeDoctorScreen()'), 'transient native-doctor state still owns transcript mounting');
assert(!/nativeDoctor[\s\S]{0,180}\.ez3fl-record[\s\S]{0,80}remove\(/.test(flow), 'native doctor reconciliation can still remove the transcript lane');
assert(flow.includes("var mountedLanes = body.querySelectorAll('.ez3fl-record')"), 'easy flow does not reconcile one persistent transcript lane');
assert(flow.includes('var mountedLane = mountedLanes.length ? mountedLanes[0] : null'), 'easy flow does not preserve the first mounted transcript node');
assert(flow.includes('for (var laneIndex = 1; laneIndex < mountedLanes.length; laneIndex++) mountedLanes[laneIndex].remove()'), 'easy flow does not remove only accidental duplicate lanes');
assert(flow.includes('syncTopLane(mountedLane)'), 'existing transcript lane is not synchronized in place');
assert(flow.includes("var kill = staff ? '.ez3fl-staffLink,.ez3fl-record' : '.ez3fl-back,.ez3fl-staffbadge'"), 'transcript lane cleanup is not limited to an actual staff-screen transition');

console.log('PASS easy transcript continuity: one lane persists across doctor-state reconciliation and is removed only for staff mode');
